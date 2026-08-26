import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  type CallGraph,
  type ClassifiedExport,
  ENTRY_POINTS,
  type UnreachableVerdict,
  barrelExports,
  buildCallGraph,
  describeUnreachable,
  nodeId,
  reachableFrom,
  unreachableExports,
} from './reachability.ts'
import {
  DISPOSITIONS,
  DISPOSITION_CEILING,
  HIDDEN_BY_DISPATCH,
  disposedKeys,
} from './reachability-dispositions.ts'

/**
 * The reachability guard — Plan 22-02.
 *
 * ## What this guard CANNOT say, stated here rather than in a planning document
 *
 * It reads a **static call graph**, and both of its errors are real and are named rather than
 * left to be inferred:
 *
 * - **A capability reached only through a dispatch this graph cannot see reads as unreachable.**
 *   That is not hypothetical and the site is named: `packages/browser/demo/main.ts` assigns an
 *   object literal to `window.o2`, and `packages/browser/demo/index.html` invokes its methods
 *   from an inline `<script type="module">`. Every symbol behind that hop — consent, environment
 *   probing, artifact loading — has a real caller and no traced path. **Measured 2026-08-08: 12 of
 *   the 20 findings that have callers are chained to that one hop**, and they are a fact about
 *   static tracing rather than about the browser tier.
 * - **A capability called from a reachable but never-executed branch reads as reachable.** The
 *   graph is over paths, not over executions; a call inside `if (false)` is an edge. Nothing here
 *   claims a reached symbol runs.
 *
 * **And liveness is not correctness.** The cases below show the edge set is neither empty nor
 * total. A tracer wrong in some middle way passes every one of them, and the anchors in
 * `reachability.node.test.ts` are what carry correctness.
 *
 * ## The known-FALSE anchor is load-bearing HERE, not only in the tracer's own spec
 *
 * The dangerous failure is an **over-connected** edge set, because that is precisely what a clean
 * run looks like. It is caught by requiring `demo/estimatePi` to stay unreachable. If that symbol
 * is ever reported reachable, this guard has stopped guarding and every green run below is
 * worthless.
 *
 * **Corrected 2026-08-10, and the anchor survives the correction on a different ground.** This
 * sentence read *"`demo/estimatePi` — which nothing anywhere calls"*, and that has been **false
 * since `0d1fcb5`**: `packages/browser/demo/main.ts:841` calls it inside `runPi`. The anchor is
 * still an anchor, because what it needs is a symbol the **static tracer** must not reach, and
 * `estimatePi`'s only caller sits behind the `window.o2` hop no static graph crosses — the same
 * reason `demo/answerOf` is disposed. So the property is unchanged and its justification is not:
 * it holds while the hop is untraced, rather than while nothing calls the symbol. If the inline
 * script is ever extracted, this anchor and the `global-object-hop` register go red together, and
 * both are meant to.
 *
 * ## What is deliberately absent — with one id, and the exception is the rule working
 *
 * No requirement id appears in any title here **except `CRYPTO-03`**.
 * `acceptance-traceability.node.test.ts` counts a title naming an id as strong traceability, and
 * manufacturing that from a guard which asserts nothing about WIRE-02's *behaviour* would corrupt
 * its measurement; `requirements-ledger.node.test.ts` makes the same choice for the same reason.
 * WIRE-02 asks that built capabilities be **wired**, and nothing in this file measures wiring, so
 * a WIRE-02 title would be a claim this file cannot support.
 *
 * `CRYPTO-03` is different in kind, not in degree. Its wording is *"the certificate-lifecycle
 * facades are **ledgered** under the entry-point-reachability convention rather than existing as
 * real-but-uncounted code"* — a requirement **about this convention**, whose subject is counting
 * rather than behaviour. The block at the bottom of this file is its whole mechanism: it names
 * the module, bounds the population it belongs to, and holds the barrel decision still. A title
 * carrying that id reports what actually failed, which is the property the rule above protects.
 * **The rule is not weakened**: an id may appear here only when the thing this file measures —
 * reachability — *is* the requirement, and CRYPTO-03 is the first and so far only one that is.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Every case here builds or reads the call graph, and none of them carried a timeout.
 *
 * The sibling `reachability.node.test.ts` hit this on 2026-08-08 under full-suite contention;
 * this file hit it the same day for a smaller reason — **wiring one more workload into the demo
 * grew the graph just enough to cross the 5 000 ms default.** A guard whose own runtime sits on a
 * cliff reports a timeout instead of a verdict, which is the least useful failure it could give.
 *
 * Sized as headroom against a loaded machine, not as a measurement of the work: a case that
 * genuinely regresses will blow through 60 s, while a contended one that would have taken 6 s
 * simply passes.
 */
const GRAPH_TIMEOUT_MS = 60_000

/**
 * Corpus floors, measured 2026-08-08 at `7f8a74b`, with Phases 20, 21, 23 and 24 landed and
 * Phase 22 otherwise unbuilt. Set **well below** the reading, per
 * `acceptance-traceability.node.test.ts` — a floor catches a collapse, an equality freezes a
 * count that legitimately grows. The measurements were 217 callable exports over 139 files.
 */
const CALLABLE_FLOOR = 200
const FILE_FLOOR = 130

/** The symbol whose unreachability defends this guard against its worst failure mode. */
const KNOWN_FALSE_ANCHOR = 'packages/demo/src/pi.ts#estimatePi'

/** The module holding the `window.o2` literal — the hop this guard cannot follow, by name. */
const DEMO_MAIN = 'packages/browser/demo/main.ts'

let corpusCache: ClassifiedExport[] | undefined
function corpus(): ClassifiedExport[] {
  corpusCache ??= barrelExports()
  return corpusCache
}

let graphCache: CallGraph | undefined
function graph(): CallGraph {
  graphCache ??= buildCallGraph()
  return graphCache
}

/** A planted verdict — the renderer must never need anything but this. */
function verdict(barrel: string, symbol: string, callers: readonly string[] = []): UnreachableVerdict {
  return { barrel, symbol, declaredIn: `packages/${barrel}/src/planted.ts`, callers }
}

describe('the failure names the symbol and the barrel, not just a count', () => {
  it('renders both halves for a symbol and barrel that exist nowhere', () => {
    // Deliberately fictional: a renderer that reached for the file system, or that only echoed
    // names it could find, would fail here rather than quietly render something plausible.
    const [line] = describeUnreachable([verdict('nowhere', 'neverDeclared')])
    expect(line).toBeDefined()
    // Asserted as two independent `toContain`s, the way `purity.node.test.ts` does it. A single
    // whole-string equality would turn every future wording change into a false red, and the
    // guard would then be loosened to fix it.
    expect(line).toContain('neverDeclared')
    expect(line).toContain('@o2/nowhere')
    expect(line).toContain('no production code calls it')
  }, GRAPH_TIMEOUT_MS)

  it('distinguishes "nothing calls it" from "its callers are unreachable too"', () => {
    // Two different defects needing two different pieces of work. Collapsing them into one
    // sentence would send a reader looking for a call site that already exists.
    const [orphan] = describeUnreachable([verdict('core', 'orphaned')])
    const [chained] = describeUnreachable([
      verdict('core', 'chained', ['packages/core/src/other.ts#caller']),
    ])
    expect(orphan).toContain('no production code calls it')
    expect(chained).toContain('its only callers are themselves unreachable')
    expect(chained).toContain('packages/core/src/other.ts#caller')
  }, GRAPH_TIMEOUT_MS)

  it('names how many entry points were searched, so the reason is checkable', () => {
    const [line] = describeUnreachable([verdict('net', 'someSymbol')])
    expect(line).toContain(`${ENTRY_POINTS.length} entry points`)
  }, GRAPH_TIMEOUT_MS)

  it('renders nothing for an empty verdict list', () => {
    // The other direction. A renderer that emitted a line for everything would satisfy every
    // case above while being useless. `purity.node.test.ts` carries the same pair.
    expect(describeUnreachable([])).toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('renders a browser finding and a node finding identically', () => {
    // The cardinal rule, asserted rather than trusted: nothing in the verdict or the message
    // keys on node kind. A rule that read differently for `FabricNode` and `BrowserNode` was
    // written once in this repository and retracted at `0314208`.
    const [browser] = describeUnreachable([verdict('browser', 'sameName')])
    const [node] = describeUnreachable([verdict('node', 'sameName')])
    expect(browser?.replace('@o2/browser', 'X').replace('packages/browser/', 'packages/X/')).toBe(
      node?.replace('@o2/node', 'X').replace('packages/node/', 'packages/X/'),
    )
  }, GRAPH_TIMEOUT_MS)
})

describe('the guard cannot report clean because it looked at nothing', () => {
  /**
   * Three ways to produce a clean verdict from a broken instrument, each with its own case.
   * Driven against planted input rather than against the tree, following `purity.node.test.ts`'s
   * "the scanner can fail" block literally.
   */

  it('reads a corpus and a graph big enough to be worth a verdict', () => {
    const callable = corpus().filter((one) => one.kind === 'callable')
    expect(callable.length).toBeGreaterThanOrEqual(CALLABLE_FLOOR)
    expect(graph().files.length).toBeGreaterThanOrEqual(FILE_FLOOR)
    expect(graph().roots.length).toBe(ENTRY_POINTS.length)
  }, GRAPH_TIMEOUT_MS)

  it('finds nothing when the corpus is empty — the failure that reads exactly like success', () => {
    // An empty corpus produces an empty verdict list, which is indistinguishable from a clean
    // tree. It is caught by the floor above, and this case proves the direction: the reading
    // really does collapse to nothing, so the floor is the only thing standing between the guard
    // and a silent pass. `disclosure-gate.node.test.ts` shipped this exact shape once.
    expect(unreachableExports([], graph(), ROOT)).toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('reports EVERY callable unreachable when the entry set is empty — the loud direction', () => {
    const callable = corpus().filter((one) => one.kind === 'callable')
    const rootless: CallGraph = { ...graph(), roots: [] }
    expect(unreachableExports(corpus(), rootless, ROOT).length).toBe(callable.length)
  }, GRAPH_TIMEOUT_MS)

  it('reports EVERY callable unreachable when the edge set is empty', () => {
    const callable = corpus().filter((one) => one.kind === 'callable')
    const edgeless: CallGraph = { ...graph(), calls: new Map() }
    expect(unreachableExports(corpus(), edgeless, ROOT).length).toBe(callable.length)
  }, GRAPH_TIMEOUT_MS)

  it('is defended against over-connection by a symbol that must stay unreachable', () => {
    // THE case that matters, and the hardest to catch, because an over-connected graph is what a
    // green run looks like. A graph that reaches `demo/estimatePi` is over-connected and every
    // other verdict here is worthless.
    //
    // **This comment said "called by nothing anywhere in the tree — checked by grep independently
    // of this instrument" until 2026-08-10, and the grep it cites now returns a caller**:
    // `packages/browser/demo/main.ts:841`, inside `runPi`, landed at `0d1fcb5`. The anchor is
    // sound and its stated reason was not — see this file's header. What makes `estimatePi`
    // unreachable to a STATIC tracer is that its one caller is a method of the object literal
    // assigned to `window.o2`, which is why the same symbol is now disposed under
    // `global-object-hop` in `reachability-dispositions.ts`. Being disposed does not weaken the
    // anchor: dispositions are applied by the callers of `unreachableExports`, which still
    // reports the symbol, and the assertion below reads that report directly.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(found.map((one) => `${one.barrel}/${one.symbol}`)).toContain('demo/estimatePi')

    // And the same case in the direction that proves it is a check rather than a restatement:
    // plant one edge from a root to that node and the guard must stop reporting it.
    const connected = new Map(graph().calls)
    const root = graph().roots[0] ?? ''
    connected.set(root, new Set([...(graph().calls.get(root) ?? []), KNOWN_FALSE_ANCHOR]))
    const overConnected = unreachableExports(corpus(), { ...graph(), calls: connected }, ROOT)
    expect(overConnected.map((one) => `${one.barrel}/${one.symbol}`)).not.toContain('demo/estimatePi')
  }, GRAPH_TIMEOUT_MS)

  it('renders every real finding with its symbol and its barrel', () => {
    // The naming clause on a REAL walk rather than on a planted object — Task 1 proved the
    // renderer, this proves the two are wired to each other.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(found.length).toBeGreaterThan(0)
    const lines = describeUnreachable(found)
    expect(lines.length).toBe(found.length)
    for (let i = 0; i < found.length; i++) {
      const one = found[i]
      const line = lines[i]
      if (one === undefined || line === undefined) continue
      expect(line).toContain(one.symbol)
      expect(line).toContain(`@o2/${one.barrel}`)
    }
  }, GRAPH_TIMEOUT_MS)

  it('does not report a wired capability unreachable', () => {
    // The known-TRUE side, at guard level rather than only in the tracer's own spec. Each of
    // these is reached by a different edge class, so a regression in any one of them shows up
    // here as a named symbol rather than as a count that moved. Commenting out any of their call
    // sites turns THIS case red — which is the first half of criterion 2.
    const reported = new Set(unreachableExports(corpus(), graph(), ROOT).map((one) => `${one.barrel}/${one.symbol}`))
    // `core/executeVerified` joined this list 2026-08-13. It is the fabric's N-version
    // comparison and it runs on **every** shard dispatch — `submitJob` reaches it through
    // `submit.ts#runOn`, a `const`-arrow — and it was reported unreachable until the reference
    // filter learned that a variable initialised with an arrow is callable.
    for (const wired of [
      'aot/translationCid',
      'node/FabricNode',
      'core/submitJob',
      'net/reduceJob',
      'core/runTaskAndPost',
      'core/executeVerified',
    ]) {
      expect(reported.has(wired), `${wired} is wired and must not be reported unreachable`).toBe(false)
    }
  }, GRAPH_TIMEOUT_MS)

  it('refuses to let the finding list grow silently past its stated size', () => {
    // The anti-vacuity ceiling, and it is the second half of criterion 2: a NEW
    // exported-but-uncalled function is a defect that no known-TRUE anchor can catch, because it
    // adds a finding rather than removing a path.
    //
    // ## THIS CEILING NO LONGER CARRIES THAT CLAIM — 2026-08-14, WIRE-02
    //
    // It is kept, and it is now the weaker of two checks over the same population. The block
    // *"WIRE-02 — every unreachable export is named by a register, in both directions"* at the
    // bottom of this file asserts set equality between this walk and
    // `DISPOSITIONS ∪ OPEN_FINDINGS`, so the count below is pinned exactly — at **66** as of
    // 2026-08-18 (it read 68 earlier that day and 66 when this paragraph was first written; the
    // coincidence of the two 66s is arithmetic, not a copy — the population behind them differs,
    // and `OPEN_FINDINGS` is empty in the later one) — by two named registers, and a
    // bound at that same figure can no longer bind. **A ceiling is green about any twenty-four
    // undisposed symbols, not only these twenty-four**, which is the defect the register fixes
    // and the reason this comment says so rather than letting the number look load-bearing.
    //
    // It stays because it is free, because it fails on a *different* wording (a count a reader
    // can compare against the history below), and because deleting a measurement to make room
    // for a better one is how a history stops being auditable. The paragraphs below are that
    // history and they are unchanged.
    //
    // Sited at **75**, measured 2026-08-09 (Plan 25-02). It was 73 from the same day
    // (Plan 25-04), which itself was 67 from 2026-08-08 with Phases 20, 21, 23 and 24
    // landed — that reading moved from 58 after PLANT A AT `FabricNode.start` failed to
    // redden anything and exposed that type annotations were being counted as call
    // paths; excluding type positions moved it to 67, then to 73 when
    // `packages/core/src/ed25519-backend.ts`'s seven barrel exports landed with no
    // production caller yet by design. Raised to 75 (+2, not +5) when Plan 25-02 barrel-
    // exported `x509.ts` for the first time: `decodeX509Certificate` and
    // `describeX509Failure` are the two newly-unreachable callable exports —
    // `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES`/`MAX_EXTENSION_COUNT` are `const`
    // value exports, not functions/classes, so they never entered this "callable"
    // corpus at all, which is why five new exports moved the count by two rather than
    // five. Neither new finding is disposed: this phase deliberately does not wire the
    // decoder into enrollment, issuance, or the demo (out of this phase's named scope;
    // only its bundle cost is measured, in Plan 25-03), matching the ed25519-backend.ts
    // precedent immediately above. The earlier figures are recorded because a ceiling
    // whose history is invisible is a ceiling nobody can audit.
    //
    // **Lowered 75 → 73, measured 2026-08-10 (Phase 28, Plan 28-01).** Two callable
    // barrel exports left `@o2/core` and none arrived: `core/createLibsodiumSyncVerifier`
    // and `core/createSubtleAsyncVerifier`. The first took `libsodium-wrappers` out of
    // the code path; the second was a duplicate `subtle` verify implementation sitting
    // beside the surviving arm's own. **Measured, not derived**: this ceiling was
    // temporarily set to 0 before the merge and the guard reported 75, and again after
    // the merge and it reported 73 — a within-run pair, so the difference is the merge
    // and not the machine. This is a lowering from cleanup adjacent to wiring, not from
    // wiring: nothing became reachable. The assertion message below says a LOWER reading
    // means the ceiling comes down, and this is that, taken rather than left as slack.
    // Nothing was added here on purpose — the merged module's `createCryptoBackend`,
    // `nobleCryptoBackend` and `subtleCryptoBackend` are deliberately off the barrel,
    // because barrel-exporting that surface is an owner non-decision priced at +12 callable
    // exports — 73 → 85 against this ceiling, re-derived 2026-08-10. (This line read "75 → 87"
    // until then, against a bound the same commit had already moved to 73.)
    // The ceiling is an equality-ish bound on purpose and it is the crude form of what 22-03
    // replaces it with: a per-symbol register with a reason for each. Until that lands, this is
    // the only thing standing between the guard and a new dead export arriving unnoticed.
    // 19-12's finding is the reason it is asserted rather than commented: the mutation ledger's
    // floor sat stale at 23 against a ledger of 42, and nothing said so.
    // **74 since 2026-08-11, and the one that moved it is named** — `net/reduceSovereignJob`,
    // MR-02's sovereign aggregation arm. It is uncalled because no rig here stands up two
    // owners; `reachability-dispositions.ts`'s `OPEN_FINDING_CEILING` note carries the
    // measurement and why a disposition would be the wrong shape for it.
    //
    // **Lowered 74 → 72, measured 2026-08-11, and this one IS wiring** — the first lowering in
    // this note's history that is. `core/decodeX509Certificate` and `core/describeX509Failure`
    // arrived undisposed when Plan 25-02 barrel-exported `x509.ts` (the 73 → 75 raise above), and
    // both now have a production caller: `checkX509Form` in `packages/core/src/enrollment.ts`
    // decodes the presented form and describes its refusal, fail-closed, on the trust path.
    // **Measured, not derived**: this ceiling was set to 0 and the guard reported 72, naming all
    // seventy-two with the two symbols visibly absent. The assertion message below says a LOWER
    // reading means the ceiling comes down; this is that, taken rather than left as slack, and
    // 74 − 2 also being 72 was not accepted as the proof.
    // **Lowered 72 → 71, measured 2026-08-13, and this one is neither wiring nor cleanup — the
    // INSTRUMENT was wrong.** `core/executeVerified` is the fabric's N-version comparison and runs
    // on every shard dispatch; it read as dead code because a reference to a `const`-arrow created
    // no edge. Exactly one symbol leaves this population, because the other six the same repair
    // recovered gain a caller without gaining a path and move into the register instead — see
    // `reachability-dispositions.ts`'s `36 → 29` note, which names all seven.
    // **Measured, not derived**: this ceiling was set to 0 and the guard reported *"the guard
    // found 71 unreachable callable barrel exports"*. 72 − 1 is also 71 and that was not the proof.
    //
    // ## Lowered 71 → 69, measured 2026-08-14, and this one is WIRING
    //
    // `net/reduceSovereignJob` has a production caller: `bin/bench.ts`'s `--sovereign` leg calls
    // it after dispatching its owner-pinned rows. `core/withCoverage` leaves with it — the arm
    // was its only caller, so one wire moved two symbols, which is why this is −2 and not −1.
    //
    // **The blocker that held it was false, and the retraction is worth reading before anything
    // here is trusted.** This note said above that the symbol *"is uncalled because no rig here
    // stands up two owners"*. The arm never required two owners; it requires two *contributions*,
    // which one owner supplies with two rows, and `reduce-sovereign.test.ts` now measures exactly
    // that with a planted red behind it. The leg was short of a second **row**, not a second
    // **identity** — so this was wiring work all along, misfiled as an owner decision.
    //
    // Measured on a real run rather than inferred from the graph: `bench.ts --quick --discover
    // --sovereign` prints *"1 combine(s) at 2 replicas, coverage 1/1 owners complete, 2 row(s)
    // watched over 2 pinned"* at the two-worker rung, and names why the one-worker rung cannot
    // carry it. The instrument was then re-read and returned 69.
    //
    // ## Lowered 69 → 67, measured 2026-08-14, and this one is an INSTRUMENT REPAIR
    //
    // Nothing was wired for this two. `node/lanAddresses` and `node/localHostname` run on every
    // `o2 seed` invocation and always did — `bin/seed.ts` reads them through **getters**, so the
    // access is a property read rather than a call, and the tracer kept the `.name` half of a
    // call while dropping it for a read. Repaired at `reachability.ts`'s property-access branch.
    //
    // **Second occurrence in two days of this exact shape** — after `core/executeVerified`, which
    // is the fabric's N-version comparison and read as dead code behind a `const`-arrow. Both
    // times the count was over-stating the gap, and both times the symbol was running in
    // production. Read a finding's call sites before believing it.
    //
    // The rule was measured against the over-connection anchor **before** it was taken:
    // `demo/estimatePi` stays unreachable and the total moves by exactly two.
    //
    // **Lowered 67 → 66 later the same day, and that one IS wiring.**
    // `browser/memoryConsentStore` has a production caller: `pageConsentStore`, which
    // `demo/main.ts` binds. It was reached by fixing a defect rather than by moving a
    // number — a page whose storage silently forgets writes could not read back a consent
    // it had just granted, so a private-browsing visitor was refused after agreeing.
    // ## Raised 66 → 67, measured 2026-08-14, and this one is a NEW SYMBOL — not a repair
    //
    // `browser/enrolledIssuer` is AUTH-02's production anchor read: `demo/main.ts#start` calls it
    // on the line above `BrowserNode.start` to pin the provider this origin enrolled with. It has
    // a real production caller from the day it landed, and it counts here anyway for the reason
    // the fifteen other `browser/` symbols do — the caller is a member of the `api` literal
    // assigned to `window.o2`, and the graph does not trace that assignment. So it is disposed as
    // `global-object-hop` in `reachability-dispositions.ts` and the *undisposed* count is
    // unmoved; this raise is the raw population growing by the one symbol that was added.
    //
    // **Stated so the direction is not misread later:** a raise here is normally the alarm this
    // ceiling exists to sound. This one is not wiring debt arriving. It is a symbol that was
    // wired in the same commit that created it, into a caller the tracer cannot follow, and the
    // evidence is that the derived `global-object-hop` case named it by itself rather than the
    // ceiling being moved to make room.
    // ## Raised 67 → 68, measured 2026-08-16 — the SAME case as the raise above, one row on
    //
    // `core/checkpointsInto` is CHURN-03's sink: `demo/main.ts#runColouring` passes
    // `checkpointsInto(node.store)` as `SubmitOptions.checkpoints`, which is what makes the write
    // half reachable from something an operator runs at all. It has one production caller from
    // the commit that created it, and it counts here anyway for the same reason
    // `browser/enrolledIssuer` does — the caller is a member of the `api` literal assigned to
    // `window.o2`, and the graph does not trace that assignment. Disposed `global-object-hop`, so
    // the *undisposed* count is unmoved; this raise is the raw population growing by one.
    //
    // The direction is not to be misread here either: this is not wiring debt arriving. It is the
    // opposite — a symbol whose whole purpose is to close wiring debt, wired in the commit that
    // created it. The evidence that it is that case and not the alarm case is, again, that the
    // derived `global-object-hop` case named it by itself before this number was touched.
    // ## Raised 68 → 78, measured 2026-08-17 — TEN at once, and the SAME case as the two
    // raises above rather than a new one
    //
    // The visitor-enrolment set: `browser/GrantedEnrolment`, `browser/InsecureOriginError`,
    // `browser/acceptEnrolment`, `browser/canHoldVisitorKey`, `browser/forgetVisitorKey`,
    // `browser/readEnrolment`, `browser/revokeEnrolment`, `browser/visitorKeyPair`,
    // `browser/visitorOperatorId`, `core/generateSubtleKeyPair`. Every one has a production
    // caller from the commit that created it — `TabApi.enrolmentOffer`, `acceptEnrolment` and
    // `declineEnrolment`, plus `main.ts#start` — and every one counts here anyway for the reason
    // the twenty-odd `browser/` symbols before it do: the caller is a member of the `api` literal
    // assigned to `window.o2`, and the graph does not trace that assignment. All ten are disposed
    // `global-object-hop`, so the *undisposed* count is unmoved; this raise is the raw population
    // growing by exactly the symbols that were added.
    //
    // **The direction, stated because ten at once is precisely the shape this ceiling exists to
    // alarm on.** This is not wiring debt arriving. It is the v1.1 milestone audit's B1, B2 and
    // B3 being closed — the browser tier could not enrol at all, so it pinned nobody and took
    // blocks from every connected peer — by ten symbols that were wired in the commit that
    // created them. The evidence that it is that case and not the alarm case is the same as
    // before, and it is not this comment: the derived `global-object-hop` case named all ten by
    // itself, verbatim, before this number was touched.
    // ## Lowered 78 → 68, measured 2026-08-18 — SEVEN out, by two different routes
    //
    // The largest single lowering in this note's history, and the first that mixes wiring with
    // retirement. Two symbols left because production now calls them: `aot/describeRefusal`,
    // which `tools/aot/lift.ts` renders instead of printing a refusal's discriminant, and
    // `core/checkLease`, which `job/submit.ts`'s lease loop now asks instead of hand-inlining
    // `now >= lease.expiresAt` twice. Five left the **corpus** rather than the finding list, by
    // being retired from a barrel with their declarations and specs untouched:
    // `browser/cacheVerdict`, `browser/describeCacheVerdict`, `browser/measureRepeatLoad`,
    // `core/settleRace` and `core/startReport`.
    //
    // **The number this ceiling stood at was not the tree's reading, and subtracting from it
    // would have been wrong.** 78 was recorded on 2026-08-17; the live reading on the morning
    // of 2026-08-18 was **75**, because that day's `--coordinate` change wired
    // `core/remainingWork` and `core/checkpointChain` and moved `core/checkpointsInto` to a
    // traced route, lowering `DISPOSITION_CEILING` 61 → 60 and leaving this one with three
    // entries of slack. So the move recorded here is 75 → 68, seven out, and 78 was never a
    // reading of anything after that commit.
    //
    // **Measured, not derived**: this ceiling was set to 0 and the guard reported, verbatim,
    // *"the guard found 68 unreachable callable barrel exports … expected 68 to be less than or
    // equal to 0"*. 75 − 7 also being 68 was refused as the proof, per this note's own habit.
    //
    // **The names were read separately, and the distinction is worth keeping** — earlier notes
    // here say "naming all N", and this assertion does not name anything: its message carries a
    // count, and the set-equality case beside it prints a vitest-truncated diff. So the list was
    // taken by calling `unreachableExports` over the same corpus and graph outside the runner,
    // and all seven departing symbols are absent from the 68 it returns. A note that claimed the
    // failing assertion named them would be describing output nobody saw.
    //
    // Three **type** exports left `@o2/browser`'s barrel in the same change — `CacheVerdict`,
    // `CompilePair`, `RepeatMeasurement`, the types of the retired measurement — and they move
    // this number by nothing, because a type has no call path by construction and never enters
    // the callable corpus. Eight names left that file and the count moved by three. Recorded
    // because the same arithmetic surprised this note twice before, at `x509.ts` and at the
    // `cert-lifecycle.ts` facades.
    //
    // The direction is unambiguous this time and needs no defending paragraph: nothing was
    // disposed to obtain it, and the undisposed residue moved 15 → 2 in the same change.
    // ## Lowered 68 → 67, measured 2026-08-18 (second lowering that day) — ONE out, wired
    //
    // `core/localDispatch` left, and it left by the only route this note counts as work:
    // production calls it. `@o2/net`'s `reduceJob` composes it as the `dispatch` half of the
    // `prefers-local-combining` placement the owner ruled for on 2026-08-18, so a requestor
    // combines in its own process wherever its own capacity and its own authorizer admit it.
    // Nothing was disposed and nothing was retired from a barrel to obtain this.
    //
    // **Measured, not derived.** The guard's own exported API was called over this tree —
    // `unreachableExports(barrelExports(), buildCallGraph(), ROOT)` — and returned **67**, with
    // `core/localDispatch` absent from the list and `core/isComplete` the single undisposed
    // remainder. 68 − 1 also being 67 was refused as the proof, per this note's standing habit.
    //
    // **The residue is 1 and Phase 22's criterion 1 still does not close.** That is stated here
    // rather than left to the register, because this is the number a reader checks first: the
    // parked owner decision that held `localDispatch` open has been taken, and `core/isComplete`
    // has not — its row below re-read the one site that could take it on 2026-08-18 and found
    // that site already printing the same fact.
    //
    // ## Lowered 67 → 66, measured 2026-08-18 (third lowering that day) — ONE out, RETIRED
    //
    // The sentence directly above is superseded and kept because it is the claim this lowering
    // overturns. `core/isComplete` left `@o2/core`'s barrel after the owner asked for its
    // *purpose* to be reviewed: the review found a whole-job completeness predicate redundant
    // in this design on three measured grounds, and the retirement note in `OPEN_FINDINGS`
    // below carries all three with their line numbers. **The residue is now 0 and Phase 22's
    // criterion 1 closes.**
    //
    // **A retirement is not wiring, and this note refuses to let the two read alike.** Lowering
    // a ceiling by deleting an export is the move that could make this whole instrument
    // decorative, so the direction is stated plainly: nothing gained a call path here, one
    // capability stopped being advertised. What makes it legitimate rather than a number-shrink
    // is that the capability was reviewed and found redundant — not that the guard was noisy —
    // and that the declaration and every one of its cases survive, so the check count did not
    // move. `checkpoint.test.ts` imports from `./checkpoint.ts` module-relatively and is green
    // unchanged.
    //
    // **Measured, not derived.** `unreachableExports(barrelExports(), buildCallGraph(), ROOT)`
    // was called over this tree after the change and returned **66**, with `core/isComplete`
    // absent from the list and the undisposed remainder empty. 67 − 1 also being 66 was refused
    // as the proof, per this note's standing habit.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(
      found.length,
      `the guard found ${found.length} unreachable callable barrel exports against a bound of ` +
        `${UNREACHABLE_CEILING}. A HIGHER number means a new exported-but-uncalled symbol ` +
        'arrived — run the guard and read the list. A LOWER number is wiring work landing and ' +
        "the bound should be lowered to match it, which is 22-03's register rather than an edit " +
        'here. **The bound is named once and read here, as of 2026-08-26.** This sentence used ' +
        "to carry the literal `66` while the assertion below read `74`: the number was written " +
        'twice, the two drifted apart across four raises, and every one of those runs printed a ' +
        'bound that was not the one being applied.',
      // **RAISED 66 -> 67 on 2026-08-20, and the raise is one symbol with a named cause.**
      // AUTH-03's browser half landed: `browser/chainsForOwner` is called only from
      // `demo/main.ts`'s `sovereignChainsFor`, which this graph reaches solely through the
      // `window.o2` object literal it cannot trace. It is dispositioned `global-object-hop`
      // and the hop-tracing arm below reports it flipping, so it has a real production caller.
      //
      // **Its two siblings did NOT move this number, and that is the check on this raise
      // rather than a curiosity.** `core/delegateWith` is called from
      // `browser/dispatch-chain.ts` and `core/DelegationSignerMismatchError` is thrown inside
      // `capability.ts` itself, so both already have call sites this metric counts. Three
      // exports arrived and the number moved by one — if it had moved by three, something
      // other than the hop would be hiding them.
      //
      // **RAISED 67 -> 68 on 2026-08-20, one symbol, same class, same day.**
      // `browser/enrolledUserKey` is `enrolledIssuer`'s sibling: called from `main.ts#start`,
      // hidden by the same `window.o2` assignment, dispositioned `global-object-hop`, and the
      // hop-tracing arm reports it flipping. It has a production reading end to end —
      // `owner-domain-tabs.e2e.test.ts` places a sovereign shard on the owner's own tabs, which
      // is impossible without it.
      //
      // **The check on this raise is the same one the raise above used.** `enrolledUserKey` is
      // the only new barrel export in that change; `main.ts`'s wiring of it is a call, not an
      // export. One export arrived and the number moved by one.
      // 68 -> 69 on 2026-08-21. ONE export arrived — `core/signNameDelegation`, the mint half
      // of task #4's offline-root chain — and the number moved by one, which is the only shape
      // of raise this ceiling accepts. It is named in `OPEN_FINDINGS` above with the reason it
      // has no runtime caller and the concrete change that would give it one, so the register
      // and not this number is what holds it: a different unreachable export cannot take its
      // place under the same bound.
      // 2026-08-23: 69 -> 71. Two rows, `core/keyCommitment` and `core/honoursKeyCommitment`,
      // both named in `OPEN_FINDINGS` with the reason a reader can check — a signed format
      // whose field had to land before certificates circulate, and whose users are a phase
      // nobody has scoped. Raised by exactly the two rows added, so the ceiling still cannot
      // absorb a third arrival silently.
      // 2026-08-25: 71 -> 74. Three rows, all in `packages/cloudflare/src/do-datastore.ts` —
      // `DoDatastore` and its two refusal types — named in `OPEN_FINDINGS` above. Raised by
      // exactly the three that arrived. **These differ from every raise before them in one way
      // worth stating: their closing condition is inside the SAME phase.** Phase 29's criteria
      // 2 and 7 assemble the libp2p node that constructs this store, and until that stream
      // lands the store has no caller for a reason that is scheduled rather than unscoped. So
      // this raise is expected to be REVERSED by wiring within the milestone, not carried; if
      // Phase 29 closes with these three still here, that is a finding about the phase.
      // 2026-08-26, later the same day: 80 -> 84. Four rows, all in
      // `packages/cloudflare/src/websocket-connection.ts` — the inbound listener and its
      // refusal. Raised by exactly the four that arrived. They are in `OPEN_FINDINGS` and not
      // dispositioned for the reason the paragraph below gives about the six before them: the
      // caller is a Worker that nothing deploys.
      // 2026-08-26: 74 -> 80. Six rows, all in `packages/cloudflare/src/`, all named in
      // `OPEN_FINDINGS` above: `HostedNode`, `hostedIdentity`, `loadOrCreateHostedSeed`,
      // `MalformedStoredSeedError`, `stubFor`, `UnknownHostedObjectNameError`. Raised by
      // exactly the six that arrived, so the bound still cannot absorb a seventh silently.
      //
      // **THE RAISE ABOVE PREDICTED A REVERSAL AND GOT AN INCREASE, AND THAT IS THE READING
      // TO TAKE, NOT A NUMBER TO SMOOTH.** The 2026-08-25 note says the three `do-datastore.ts`
      // rows *"are expected to be REVERSED by wiring within the milestone"* and that *"if Phase
      // 29 closes with these three still here, that is a finding about the phase."* The wiring
      // those rows named — *"a Durable Object class constructing `DoDatastore` over its own
      // `state.storage`"* — landed on 2026-08-26 and the three did not move. The reason is in
      // the second half of that same row's sentence, which was written before the wiring and
      // held: *"it closes when the node deploys and dials."* Nothing deploys. Phase 29 criteria
      // 1 and 2 are owner acts at the Cloudflare boundary by owner ruling of 2026-08-25, and
      // the assembly's own symbols joined the register for exactly the reason the store's did.
      //
      // **Why they are not dispositioned instead**, which would have kept this number at 74:
      // a `DISPOSITIONS` cause says a symbol has a real production caller behind a hop the
      // tracer cannot follow, and `global-object-hop`'s symbols do — the demo page runs. These
      // have a caller in `worker.ts` that NOTHING INVOKES, because nothing is deployed. Moving
      // them would have made this number look like wiring and read like progress.
    ).toBeLessThanOrEqual(UNREACHABLE_CEILING)
  }, GRAPH_TIMEOUT_MS)

  it('separates findings that have callers from findings that have none', () => {
    // The split is the guard's contribution over `requirements-ledger.node.test.ts`, which reads
    // call syntax and would call the first group "called". Both groups are non-empty today, and
    // a collapse of either would mean the caller index stopped being computed.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(found.filter((one) => one.callers.length === 0).length).toBeGreaterThan(0)
    expect(found.filter((one) => one.callers.length > 0).length).toBeGreaterThan(0)
  }, GRAPH_TIMEOUT_MS)

  /**
   * The split above is only worth having if `callers` answers the question its own docblock
   * promises — *"empty means nothing in the tree calls it"*. Until 2026-08-11 it did not: the
   * field was built by dropping every caller declared in the finding's own file, so a symbol
   * called once, from the line below it, rendered as **"no production code calls it"**.
   *
   * **This never changed which symbols were reported.** `reached` is computed over the whole
   * graph and tested before the filter runs, and `addEdge` keeps same-file edges — so no wired
   * symbol was ever called unwired, and the carried-forward note claiming the instrument
   * "declined to look in the file the symbol lives in" was wrong about the consequence. What it
   * corrupted is the *reason*, which is what a reader acts on: five of the ten disposed
   * `global-object-hop` symbols printed a false one, and several open findings that are one
   * unwired caller wearing four names read as four independent uncalled symbols.
   *
   * Hand-built rather than taken from the corpus, because the property is about a single edge
   * and `reachableFrom` is pure over its arguments precisely so a planted `Map` can drive it.
   */
  it('names a same-file caller instead of reporting the symbol as uncalled', () => {
    const file = 'packages/x/src/thing.ts'
    const callee = nodeId(file, 'helper')
    const caller = nodeId(file, 'itsOnlyCaller')
    const planted: ClassifiedExport[] = [
      { barrel: 'x', name: 'helper', flags: 0, declaredIn: join(ROOT, file), kind: 'callable' },
    ]
    // `roots: []` — nothing is reachable, so `helper` is a finding either way. The case is
    // about what the finding SAYS, which is the only thing the filter could ever change.
    const oneEdge: CallGraph = {
      nodes: new Set([callee, caller]),
      calls: new Map([[caller, new Set([callee])]]),
      imports: new Map(),
      files: [file],
      roots: [],
      collisions: [],
    }

    const found = unreachableExports(planted, oneEdge, ROOT)
    expect(found).toEqual([{ barrel: 'x', symbol: 'helper', declaredIn: file, callers: [caller] }])
    expect(describeUnreachable(found)).toEqual([
      expect.stringContaining('its only callers are themselves unreachable'),
    ])
    expect(describeUnreachable(found)).not.toEqual([
      expect.stringContaining('no production code calls it'),
    ])
  })
})

// ---------------------------------------------------------------------------
// The three shapes a call flows along that the tracer used not to see
// ---------------------------------------------------------------------------

/**
 * Three blind spots, found 2026-08-13 by reading the 36 open findings back against their source
 * rather than by trusting the count.
 *
 * Each is a case where a symbol **runs in production on every dispatch** and the graph reported
 * *"no production code calls it"*. They are three distinct mechanisms, not one bug with three
 * faces, and each is repaired — or refused — separately below:
 *
 * 1. **A reference to a `const`-arrow was dropped.** `reachability.ts`'s reference filter kept an
 *    edge only when the referenced symbol classified `callable`, and `classify` reads declaration
 *    flags, so `const runOn = () => …` is a `Variable` and its edge went in the bin. The filter now
 *    asks the **declaration** rather than the flags. Widened for exactly the arrow/function-
 *    expression initialiser — a reference to a plain constant still creates nothing, which is the
 *    assertion beside the positive one and the reason this is not the 54-answer coming back.
 * 2. **A port implementation's member is reached only through the interface.** Refused as a graph
 *    edge and disposed instead — see `port-member-dispatch` in `reachability-dispositions.ts` and
 *    the case that holds its shape below.
 * 3. **`await import()` destructuring created no edge at all.** Repaired, and the symbol it
 *    rescues does **not** become reachable: it acquires its first in-edge and thereby joins the
 *    derived `global-object-hop` class, which is a different and more honest place to be than the
 *    open findings.
 */
describe('an edge is added where a call can flow, and only there', () => {
  const SUBMIT = 'packages/core/src/job/submit.ts'
  const VERIFY = 'packages/core/src/job/verify.ts'
  const START_OUTCOME = 'packages/core/src/start-outcome.ts'

  it('follows a reference to a const-arrow, and refuses one to a plain const in the same body', () => {
    // Both halves are read off ONE caller node, which is what makes this a separation rather than
    // two independent readings: `submitJob` names `runOn` (an arrow) and
    // `DEFAULT_SPECULATION_WATCHDOG_MS` (a number) in the same function body, neither as a callee.
    // A filter widened to "any referenced constant" would light up both and would be the
    // 54-answer — *the name appears somewhere in a reachable module* — wearing a new coat.
    //
    // **Watched red twice, 2026-08-13, not reasoned about.** Once before the repair existed, and
    // again with `callableConstReferences` planted to default `false`: this case failed
    // `submitJob passes \`runOn\` to \`dispatchUnderLease\` … expected false to be true`, and three
    // more went with it — `core/executeVerified is wired and must not be reported unreachable`,
    // `the guard found 72 unreachable callable barrel exports … expected 72 to be less than or
    // equal to 71`, and `30 unreachable callable barrel exports carry no disposition, against a
    // ceiling of 29`. Restored by the surgical inverse of that one default; `cmp` exit 0.
    const out = new Set(graph().calls.get(nodeId(SUBMIT, 'submitJob')) ?? [])
    expect(
      out.has(nodeId(SUBMIT, 'runOn')),
      'submitJob passes `runOn` to `dispatchUnderLease`; a variable initialised with an arrow is ' +
        'callable and holding a reference to it IS how it gets called later',
    ).toBe(true)
    expect(
      out.has(nodeId(SUBMIT, 'DEFAULT_SPECULATION_WATCHDOG_MS')),
      'a reference to a plain constant is not a call path — counting it would rebuild the 54-answer',
    ).toBe(false)
    // And the edge that was already there, so the case names the whole path rather than half of
    // it: with the in-edge restored, the fabric's N-version comparison stops reading as dead code.
    expect([...(graph().calls.get(nodeId(SUBMIT, 'runOn')) ?? [])]).toContain(
      nodeId(VERIFY, 'executeVerified'),
    )
  }, GRAPH_TIMEOUT_MS)

  it('resolves a name destructured from `await import(barrel)` to the export the barrel names', () => {
    // `packages/browser/demo/main.ts:687` writes
    // `const { StartOutcomeLedger, describeStartReport } = await import('@o2/core')`. The
    // identifier then resolves to a local BindingElement, so the call below it landed on a node id
    // inside `main.ts` that nothing declares — an edge to nowhere — while the real declaration in
    // `@o2/core` kept an in-degree of zero. A static `import { x } from '@o2/core'` has always
    // resolved through the barrel by alias; this makes the dynamic form do the same thing.
    //
    // **Watched red, 2026-08-13**, with `dynamicImportEdges` planted to default `false`: this case
    // failed `the destructured name must resolve to the declaration @o2/core publishes: expected
    // false to be true`, and the derived hop case failed beside it — `these carry a
    // global-object-hop disposition but do NOT become reachable when the hop is traced … expected
    // [ 'core/describeStartReport' ] to deeply equal []` — the two halves of one repair reddening
    // together. Restored by the surgical inverse of that one default; `cmp` exit 0.
    const out = new Set(graph().calls.get(nodeId(DEMO_MAIN, 'startReport')) ?? [])
    expect(
      out.has(nodeId(START_OUTCOME, 'describeStartReport')),
      'the destructured name must resolve to the declaration @o2/core publishes',
    ).toBe(true)
    expect(
      out.has(nodeId(DEMO_MAIN, 'describeStartReport')),
      'and must stop pointing at the local binding, which declares nothing',
    ).toBe(false)
  }, GRAPH_TIMEOUT_MS)

  /**
   * The third blind spot, **refused as an edge and disposed instead** — and this case is what
   * makes that refusal cost something.
   *
   * `HIDDEN_BY_DISPATCH`'s own docblock argues why each of the three candidate edges
   * over-connects; an argument in a comment is exactly what this repository has retracted before.
   * So every row's mechanism is re-measured here on the real graph, in three legs, and any row
   * whose mechanism has stopped describing the tree reddens:
   *
   * - the member it names **exists and has zero in-edges** — that is what *"nothing in the tree
   *   names it"* means, stated as a number rather than as a claim;
   * - for a port row, the interface member it implements is **reached**, so the port really is
   *   dispatched somewhere in production and the row is not excusing a dead object;
   * - rooting **that one member** makes **that one symbol** flip. This is the leg that stops the
   *   register from pointing at a plausible-looking member that does not actually account for the
   *   finding — the failure `global-object-hop` had for two days when its list was read rather
   *   than derived.
   *
   * **Watched red twice, 2026-08-13.** Once before the rows were wired into `DISPOSITIONS` —
   * `core/signResult has a production caller behind port-member-dispatch and carries no
   * disposition: expected false to be true` — and once with `core/signResult`'s `through` planted
   * to `…attesting-executor.ts#attestResults`, a member the graph *can* see: this case failed
   * `packages/core/src/executor/attesting-executor.ts#attestResults has a caller the graph CAN
   * see, so "port-member-dispatch" is not what hides core/signResult — the row names the wrong
   * mechanism: expected 2 to be +0`, and the case below it failed beside it with `nothing
   * production reaches packages/core/src/ports.ts#attestResults`. Restored by the surgical
   * inverse; `cmp` exit 0.
   */
  it('re-measures every hidden-caller row against the graph it claims to describe', () => {
    const before = unreachableExports(corpus(), graph(), ROOT).map(
      (one) => `${one.barrel}/${one.symbol}`,
    )
    const inDegree = new Map<string, number>()
    for (const [, targets] of graph().calls) {
      for (const target of targets) inDegree.set(target, (inDegree.get(target) ?? 0) + 1)
    }
    expect(HIDDEN_BY_DISPATCH.length).toBeGreaterThan(0)
    for (const row of HIDDEN_BY_DISPATCH) {
      expect(graph().nodes.has(row.through), `${row.through} is not a node at all`).toBe(true)
      expect(
        inDegree.get(row.through) ?? 0,
        `${row.through} has a caller the graph CAN see, so "${row.cause}" is not what hides ` +
          `${row.key} — the row names the wrong mechanism`,
      ).toBe(0)

      const taught = new Map(graph().calls)
      const root = graph().roots[0] ?? ''
      taught.set(root, new Set([...(graph().calls.get(root) ?? []), row.through]))
      const after = new Set(
        unreachableExports(corpus(), { ...graph(), calls: taught }, ROOT).map(
          (one) => `${one.barrel}/${one.symbol}`,
        ),
      )
      expect(
        before.includes(row.key) && !after.has(row.key),
        `${row.key} does not become reachable when ${row.through} is rooted, so that member does ` +
          'not account for this finding',
      ).toBe(true)

      // And it must actually carry the disposition, or the measurement above is describing a
      // symbol that still sits in the open findings claiming nothing calls it.
      expect(
        disposedKeys().has(row.key),
        `${row.key} has a production caller behind ${row.cause} and carries no disposition`,
      ).toBe(true)
    }
  }, GRAPH_TIMEOUT_MS)

  it('grounds every port row on an interface member that IS dispatched in production', () => {
    // The second leg, separated so it fails by itself. Without it a row could name a member of an
    // object nobody composes and the flip test above would still pass — rooting a dead member
    // reaches whatever it calls just as well as rooting a live one. `ports.ts#execute` and
    // `ports.ts#send` carry 13 and 4 in-edges respectively, measured 2026-08-13, which is the fact
    // that says the port is a real dispatch point rather than a shape.
    const PORTS = 'packages/core/src/ports.ts'
    const rows = HIDDEN_BY_DISPATCH.filter((one) => one.cause === 'port-member-dispatch')
    expect(rows.length).toBeGreaterThan(0)
    const reachedNodes = reachableFrom(graph().calls, graph().roots)
    for (const row of rows) {
      const member = row.through.slice(row.through.lastIndexOf('#') + 1)
      expect(
        reachedNodes.has(nodeId(PORTS, member)),
        `${row.key} is disposed on port dispatch, but nothing production reaches ` +
          `${nodeId(PORTS, member)} — there is no dispatch for it to hide behind`,
      ).toBe(true)
    }
  }, GRAPH_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// Plan 22-03 — the register, checked in both directions
// ---------------------------------------------------------------------------

describe('the disposition register describes the tree, or it reddens', () => {
  /**
   * A register is exactly how a guard becomes decoration, so every defence `22-CONTEXT.md` asks
   * for has its own case here. The one that matters most is the first: an entry that has stopped
   * being true is a defect, not a comment.
   */

  it('holds no entry for a symbol that has become reachable', () => {
    // The mirror of `mutation-guard.node.test.ts`'s cheap layer asking whether each entry still
    // DESCRIBES the source. If the demo's inline script is ever extracted, or `bench-lifted.ts`
    // is ever made a root, the symbols below become reachable and their entries must be removed
    // — this case is what stops them sitting there excusing something that no longer needs it.
    const reported = new Set(
      unreachableExports(corpus(), graph(), ROOT).map((one) => `${one.barrel}/${one.symbol}`),
    )
    const stale = [...disposedKeys()].filter((key) => !reported.has(key)).sort()
    expect(
      stale,
      'these symbols carry a disposition but the guard now reaches them — delete the entries',
    ).toEqual([])
  }, GRAPH_TIMEOUT_MS)

  /**
   * **The class is derived, not listed — added 2026-08-10.**
   *
   * `global-object-hop` was, until today, sixteen symbols somebody had noticed. That is how the
   * v1.1 audit's `G14` happened: four π symbols called from `main.ts#runPi` — a method of the very
   * `window.o2` literal this cause is named for, alongside `runColouring`, whose `answerOf` **was**
   * disposed — sat in the open findings and inflated the milestone's headline residue. A register
   * assembled by reading has no way to know which members of its own class it missed, and neither
   * of the two cases above can tell it: they check that each *listed* entry still describes the
   * tree, over a population the list itself defines. **A guard that only ever reads the rows it
   * was given cannot find the rows it was not** — which is the same defect, in a different
   * medium, that the ledger's `[x]`-iff-`Done` join carried until `acceptance-traceability`'s
   * coverage case landed the same day.
   *
   * So the class is computed. `reachability-dispositions.ts` states the closing condition for this
   * cause in its own words — *"extract the inline script into a module the tracer can root on, or
   * **teach the graph the `window.o2` assignment**"* — and that second clause is executable. Root
   * every declaration in `demo/main.ts` and re-run the walk: the symbols that flip from unreachable
   * to reachable are *exactly* the ones this cause is about, because flipping is what the cause
   * predicts. Asserted **in both directions**, since either alone is satisfiable by a broken plant:
   * a flipped symbol with no entry is a `G14` waiting to be found by hand, and an entry that does
   * not flip is a disposition granted on something other than this mechanism.
   *
   * **What this does not establish.** Rooting all of `main.ts` also rescues anything reached only
   * from dead code in that file, so flipping is necessary but not sufficient for the disposition
   * to be honest. The per-symbol walk back to a member of the `api` literal is recorded in
   * `reachability-dispositions.ts`'s `16 → 26` note and is not re-done here — this case guards
   * the *membership*, the note carries the *justification*, and neither is the other.
   */
  it('disposes every symbol the window.o2 hop hides, in both directions', () => {
    const before = unreachableExports(corpus(), graph(), ROOT).map(
      (one) => `${one.barrel}/${one.symbol}`,
    )
    const declarationsInMain = [...graph().calls.keys()].filter((id) => id.startsWith(`${DEMO_MAIN}#`))
    const taught = new Map(graph().calls)
    const root = graph().roots[0] ?? ''
    taught.set(root, new Set([...(graph().calls.get(root) ?? []), ...declarationsInMain]))
    const after = new Set(
      unreachableExports(corpus(), { ...graph(), calls: taught }, ROOT).map(
        (one) => `${one.barrel}/${one.symbol}`,
      ),
    )
    const flipped = before.filter((key) => !after.has(key)).sort()
    const hop = new Set(
      DISPOSITIONS.filter((one) => one.cause === 'global-object-hop').map(
        (one) => `${one.barrel}/${one.symbol}`,
      ),
    )

    expect(
      flipped.filter((key) => !hop.has(key)),
      'these become reachable the moment the window.o2 assignment is traced, so they have a real ' +
        'production caller and are being counted as unwired — add them to GLOBAL_OBJECT_HOP, or ' +
        'say why this one is different',
    ).toEqual([])
    expect(
      [...hop].filter((key) => !flipped.includes(key)).sort(),
      'these carry a global-object-hop disposition but do NOT become reachable when the hop is ' +
        'traced, so whatever keeps them unreachable is not that mechanism — the entry names the ' +
        'wrong cause',
    ).toEqual([])

    // Anti-vacuity, and it is the whole case. A plant that rooted nothing produces an empty
    // `flipped`, which satisfies the first assertion perfectly and would report a register in
    // agreement with a measurement that never happened. The second assertion is what catches
    // that today — it would name all 26 — and these keep it caught if the register ever empties.
    expect(declarationsInMain.length).toBeGreaterThan(20)
    expect(flipped.length).toBe(hop.size)
    expect(flipped.length).toBeGreaterThan(20)
  }, GRAPH_TIMEOUT_MS)

  it('holds no entry for a symbol that is no longer a callable barrel export', () => {
    // The other way an entry rots: the symbol is renamed or stops being exported, and the entry
    // silently stops applying to anything at all.
    const callable = new Set(
      corpus().filter((one) => one.kind === 'callable').map((one) => `${one.barrel}/${one.name}`),
    )
    const orphaned = [...disposedKeys()].filter((key) => !callable.has(key)).sort()
    expect(orphaned, 'these disposition entries name nothing the barrels export').toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('grants every disposition on a mechanism, never on a tier', () => {
    // The criterion, asserted rather than trusted. A cause that named a package or a node kind
    // would be exactly the rule retracted at `0314208`.
    // Compared as whole kebab-case WORDS, not as substrings. The substring form was written
    // first and was wrong in the direction that matters least but still matters: it refused
    // `benchmark-driver-only` because `bench` sits inside `benchmark`, while the cause names a
    // driver under `tools/aot/` and no barrel at all. A check that cries wolf gets deleted, and
    // this one would have taken the criterion's only enforcement with it.
    const barrels = new Set(corpus().map((one) => one.barrel))
    for (const one of DISPOSITIONS) {
      for (const word of one.cause.split('-')) {
        expect(
          barrels.has(word),
          `cause "${one.cause}" names the barrel ${word} — a disposition may not be granted on ` +
            'the basis of which tier a symbol belongs to',
        ).toBe(false)
      }
      expect(one.owner.length).toBeGreaterThan(20)
    }
    // And the positive form: the same cause is granted across more than one barrel, which a
    // tier-based rule could not do.
    const hopBarrels = new Set(
      DISPOSITIONS.filter((one) => one.cause === 'global-object-hop').map((one) => one.barrel),
    )
    expect(hopBarrels.size).toBeGreaterThan(1)
  }, GRAPH_TIMEOUT_MS)

  it('cannot grow the register silently', () => {
    expect(
      DISPOSITIONS.length,
      `the register holds ${DISPOSITIONS.length} entries against a ceiling of ${DISPOSITION_CEILING}`,
    ).toBeLessThanOrEqual(DISPOSITION_CEILING)
    expect(new Set(disposedKeys()).size).toBe(DISPOSITIONS.length)
  }, GRAPH_TIMEOUT_MS)

  it('renders an open finding as a sentence naming the symbol and the barrel', () => {
    // The register does not change the message contract — an open finding reads exactly like any
    // other, so a reader picking one up gets the same sentence whether or not a sibling is disposed.
    //
    // ## Rebuilt on a CONSTRUCTED open finding — 2026-08-18, and this is a repair, not a relaxation
    //
    // This case used to take the live undisposed residue and open with
    // `expect(open.length).toBeGreaterThan(0)`. When `core/isComplete` was retired the residue
    // went to **0** and this case went red — *"AssertionError: expected 0 to be greater than 0"* —
    // while nothing it claims had stopped being true. That is the same defect the anti-vacuity
    // pair further down was corrected for on this same day, in the same direction: a claim about
    // the **renderer** was being read off a **register**, so it held only while the register
    // happened to be non-empty, and criterion 1 closing is precisely the event that empties it.
    //
    // The claim worth holding is *"`describeUnreachable` names the symbol and its barrel, and
    // does not consult any register to decide how"*. That is now read two ways, neither of which
    // can be emptied by wiring or retiring anything:
    //
    // 1. Over a **constructed** finding whose key is in neither register — the literal open case,
    //    available whether or not this tree currently has one.
    // 2. Over the **whole live population**, disposed rows included, asserting every line names
    //    its own symbol and barrel. If the renderer ever branched on disposition the two readings
    //    would disagree, and 66 lines is a wider net than the one line the old form checked.
    const constructed: UnreachableVerdict = verdict('core', 'plantedOpenFindingForRendering')
    expect(
      disposedKeys().has(`${constructed.barrel}/${constructed.symbol}`),
      'the constructed finding must be in no register, or this case is about a disposed row',
    ).toBe(false)
    const [constructedLine] = describeUnreachable([constructed])
    expect(constructedLine).toContain(constructed.symbol)
    expect(constructedLine).toContain(`@o2/${constructed.barrel}`)
    expect(constructedLine).toContain('no production code calls it')

    // And the same contract over every finding the walk actually produces, disposed or not.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(found.length, 'the walk produced nothing to render').toBeGreaterThan(0)
    const lines = describeUnreachable(found)
    expect(lines.length).toBe(found.length)
    for (const [i, one] of found.entries()) {
      const line = lines[i] as string
      expect(line, `${one.barrel}/${one.symbol} is not named by its own rendered line`).toContain(
        one.symbol,
      )
      expect(line).toContain(`@o2/${one.barrel}`)
    }
  }, GRAPH_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// WIRE-02 — the residue held BY NAME, and both directions of the set equality
// ---------------------------------------------------------------------------

/**
 * What the graph found about a symbol's callers, as the register has to state it.
 *
 * The two need **different work** and that is why they are not one flag: `'none'` is a capability
 * nothing anywhere invokes, `'unreachable-only'` is one whose callers exist and are themselves
 * stranded — usually a small island of two or three symbols where wiring the head wires the rest.
 * `describeUnreachable` already renders the distinction; the register commits to it per row so the
 * guard can re-measure it.
 */
type OpenFindingCallers = 'none' | 'unreachable-only'

/** One callable barrel export with no call path and no disposition — named, not counted. */
interface OpenFinding {
  /** `barrel/symbol`, the form the guard's verdict list uses. */
  readonly key: string
  /** Repo-relative file the declaration lives in. Re-measured against the walk. */
  readonly declaredIn: string
  /** What the graph says about its in-edges. Re-measured against the walk. */
  readonly callers: OpenFindingCallers
  /**
   * Why it is unwired, in enough detail that a reader can check the claim without the guard.
   *
   * A row is allowed to say *"nobody has wired this and nobody has decided to"*. It is not allowed
   * to invent a justification: either it cites the source sentence that declines the wiring, or it
   * says plainly that no decision exists.
   */
  readonly reason: string
}

/**
 * The **undisposed residue, named one symbol at a time** — WIRE-02.
 *
 * Every callable barrel export that has no traced path from an entry point *and* no
 * {@link Disposition}. Not an excuse list and not a second dispositions register: a disposition
 * is granted on a mechanism the tracer cannot see, and **nothing here has one**. These are
 * genuinely uncalled, they are the *"Wire What Was Built"* residue, and lowering the list is the
 * work.
 *
 * ## This replaced a ceiling on 2026-08-14, and the replacement is strictly stronger
 *
 * Until today the residue was held by `OPEN_FINDING_CEILING`, a number — the guard asserted
 * `open.length <= 24` and was green about all twenty-four without naming one of them. **A ceiling
 * permits any new unreachable export up to N; a register permits only the ones somebody wrote
 * down.** So symbol #25 arrives red and named, and — the direction a ceiling can never check — a
 * symbol registered here that has since gained a call path is *also* red, because the guard reads
 * set equality in both directions. That is the shape `one-crypto-implementation.node.test.ts`
 * already runs for `ACCEPTED_SIGNATURE_COMPARISONS` and `requirements-ledger.node.test.ts` runs
 * for `WITHOUT_A_CHECKABLE_CLAIM`; it is not new here, it is applied here.
 *
 * The owner's 2026-08-08 ruling to **hold** this residue rather than work it down is untouched.
 * Twenty-four were open under the ceiling and twenty-four are named below; not one symbol was
 * re-caused into {@link DISPOSITIONS} on the way, deliberately — see `node/relayAddrForHost`,
 * which has a live production caller behind a mechanism {@link HIDDEN_BY_DISPATCH} already
 * describes and is **still listed here**, because re-causing a symbol is a decision to put and
 * not one to take in passing. That is this file's own precedent, set for
 * {@link BENCHMARK_DRIVER_ONLY}'s four symbols on 2026-08-13.
 *
 * ## What each field costs, so no row is a shrug
 *
 * - `declaredIn` is **re-measured** against the walk. A symbol that moved file invalidates its row.
 * - `callers` is **re-measured**: `'none'` means nothing in the tree calls it, `'unreachable-only'`
 *   means it is called and every caller is itself unreachable. These need different work, and an
 *   entry claiming `'none'` that has gained an in-edge reddens *before* the symbol becomes
 *   reachable — the halfway-wired state a reachability check alone cannot see.
 * - `reason` is prose, and it is allowed to say *"nobody has wired this and nobody has decided
 *   to"* — that is the honest reading for several rows and it is written as such. What it may not
 *   do is invent a justification: every row either cites the source sentence that declines the
 *   wiring, or says plainly that no decision exists.
 *
 * ## Why this register is in the spec and `DISPOSITIONS` is not — measured, not stylistic
 *
 * A register has to **spell the symbol names it registers**, and four source-scanning guards in
 * this repository read `packages/` and `tools/` for exactly such names. Both collisions below
 * were watched red on 2026-08-14 with the register sitting in `reachability-dispositions.ts`,
 * which is production source:
 *
 * 1. `requirements-ledger.node.test.ts` counts `NAME(` over **comment-stripped** production
 *    source as a call site. Quoting `ed25519-backend.ts`'s own sentence about `initEd25519()`
 *    put that call form in a **string literal**, which the stripper leaves standing, and
 *    CRYPTO-01 reddened: *"initEd25519 is called by
 *    packages/node/src/reachability-dispositions.ts"*. A citation read as a caller.
 * 2. `demo-primes.e2e.test.ts` greps the same two trees for the five G4 primes symbols and
 *    reddens on any file outside the module and the barrel naming one **on a code line**. Three
 *    rows below are `demo/buildPrimesInput`, `demo/projectPrimeCount` and `demo/readPrimeCount`,
 *    and a `key:` line is a code line. **That guard is correct and must not be widened** — its
 *    own words are *"a third entry here is Option A having landed"*, so admitting a citation
 *    would destroy the sentence that makes it worth having.
 *
 * Both scans exclude `*.test.ts` by construction, because a spec is where symbol names get
 * spelled. So the register moved here rather than the guards being loosened, and
 * `ACCEPTED_SIGNATURE_COMPARISONS` — the register whose both-directions shape this one copies —
 * already lives inside its own spec for the same reason. `DISPOSITIONS` stays in the module: no
 * guard in this tree watches the symbols it happens to name, which is luck rather than design
 * and is written down so the next register does not rediscover it.
 *
 * ## The history of this population, kept because a residue nobody can audit is one nobody lowers
 *
 * ## Ratcheted 42 → 40, measured 2026-08-08
 *
 * G7's pair moved from open to disposed, so the open count genuinely fell. **Measured, not
 * derived**: `OPEN_FINDING_CEILING` was temporarily set to 0 and the guard's own verdict read
 * *"40 unreachable callable barrel exports carry no disposition"*, naming all forty. The ceiling
 * follows the measurement down, because a ceiling with slack in it stops binding — a regression
 * of two would have passed silently against 42.
 *
 * **The owner ruled 2026-08-08 to hold this residue rather than work it down.** That governs the
 * *backlog*, not the guard: holding the count still and letting the ceiling drift above it are
 * different things, and only the first was asked for.
 *
 * ## Raised 40 → 47, measured 2026-08-09 (Plan 25-04)
 *
 * Seven new callable barrel exports arrived at once: `core/createLibsodiumSyncVerifier`,
 * `core/createNobleSyncVerifier`, `core/createSubtleAsyncVerifier`,
 * `core/Ed25519NotInitializedError`, `core/getAsyncVerifier`, `core/getSyncVerifier`,
 * `core/initEd25519` — the Ed25519 dual-port verifier `packages/core/src/ed25519-backend.ts`
 * exports from `@o2/core`'s barrel. Not disposed: the module's own docblock already states why
 * it has no production caller yet (a bootstrap-ordering decision across three runtime entry
 * points, not a `deferred-in-source` one-line deferral this register's shape fits), and that
 * statement is this plan's own deliverable rather than something to duplicate here as a second
 * copy that can drift from the first. This is a raise, not a lowering — the residue is larger,
 * honestly, until a future phase wires the port or a disposition is written for it.
 *
 * ## Raised 47 → 49, measured 2026-08-09 (Plan 25-02)
 *
 * `core/decodeX509Certificate` and `core/describeX509Failure` arrived when Plan 25-02
 * barrel-exported `packages/core/src/x509.ts` for the first time. Not disposed, for the
 * same shape of reason as the ed25519-backend.ts raise immediately above: this phase's
 * X.509 profile is fully implemented and tested but has no production caller this
 * phase by design (`.planning/REQUIREMENTS.md`'s X509-01…07 rows state it explicitly —
 * this phase does not wire the decoder into enrollment, issuance, or the demo; that is
 * out of its named scope, and only its bundle cost is measured, in Plan 25-03). Two
 * exports moved the count by exactly two, not five, because
 * `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES`/`MAX_EXTENSION_COUNT` are `const` value
 * exports rather than functions/classes and never entered the "callable" corpus this
 * guard walks.
 *
 * ## Lowered 49 → 47, measured 2026-08-10 (Phase 28, Plan 28-01)
 *
 * `core/createLibsodiumSyncVerifier` and `core/createSubtleAsyncVerifier` left the barrel when
 * Plan 28-01 merged `packages/core`'s two Ed25519 selection paths into one. Both were undisposed
 * findings, so the residue falls by exactly two and nothing arrived to offset it. The five
 * remaining `ed25519-backend.ts` findings — `core/createNobleSyncVerifier`,
 * `core/Ed25519NotInitializedError`, `core/getAsyncVerifier`, `core/getSyncVerifier`,
 * `core/initEd25519` — stay open and stay undisposed for the reason the 40 → 47 note above
 * already gives: the port still has no production caller, and the merge did not change that.
 * The merge is behaviour-neutral in production; it removed a duplication from the package, not a
 * hazard from a trust path, and this lowering should be read as exactly that much.
 *
 * **Measured, not derived, and the arithmetic here is a trap worth naming.** The ceiling was set
 * to 0 before the merge and the guard reported *"49 unreachable callable barrel exports carry no
 * disposition"*, and again after and it reported *"47"*, naming all forty-seven with the two
 * departed symbols visibly absent — a within-run pair, so the difference is the merge. 49 − 2 is
 * also 47, and `reachability-guard.node.test.ts:350` and `.planning/REQUIREMENTS.md:790` have
 * both *said* "47" since before this phase, staled against the 47 → 49 raise above and describing
 * a different population. **Agreement with a stale comment is not confirmation and was not taken
 * as any**; the number here is the one the guard printed.
 *
 * ## Lowered 47 → 37, measured 2026-08-10 — a RECLASSIFICATION, not wiring
 *
 * **Nothing was wired and nothing became reachable.** Ten symbols moved from the open list into
 * {@link GLOBAL_OBJECT_HOP} because they were always members of that class and the class had
 * never been derived; see that constant's `16 → 26` note for the method and the per-symbol
 * chains. The residue this ceiling holds is *"callable barrel exports with no production caller
 * at all"*, and all ten have one — so counting them here was reporting the gap as **larger than
 * it is**, which is the direction the 2026-08-08 re-audit named about itself and the direction
 * `G14` was raised in.
 *
 * **This does not touch the owner's 2026-08-08 ruling to hold the residue rather than work it
 * down.** Holding a count still and correcting what the count is *of* are different acts, and
 * only the second happened here. The 37 that remain are undisposed on the same terms as before.
 *
 * **Measured, not derived, and the trap named in the note above was live again here.** This
 * ceiling was set to 0 before the ten were added and the guard reported *"47 unreachable callable
 * barrel exports carry no disposition"*, and again after and it reported *"37"*, naming all
 * thirty-seven with the ten visibly absent — a within-run pair, so the difference is the
 * reclassification. 47 − 10 is also 37, and the agreement was not taken as the proof.
 *
 * **Raised 37 → 38, 2026-08-11, for `net/reduceSovereignJob` — one symbol, and it is reported
 * as an open finding rather than disposed.** MR-02's sovereign aggregation arm has no
 * production caller. **A disposition would be the wrong shape for that**: this file's own rule is
 * that a disposition is granted on a *mechanism* the graph cannot see, and there is no mechanism
 * here — the symbol is genuinely uncalled. It is measured, across real `bin/agent.ts` processes,
 * by `sovereign-aggregation.node.test.ts`; measured is not wired, and this ceiling says so.
 *
 * ### The blocker written here on 2026-08-11 was FALSE, and it is retracted — 2026-08-14
 *
 * This entry read: *"the blocker was measured rather than assumed: the arm needs a job whose
 * shards are pinned to **two or more** owners, and no rig in this repository stands up two
 * owners … Giving either a second owner changes what a published driver measures or what a
 * visitor's page submits, which is an **owner decision and not a wiring fix**."*
 *
 * **The arm does not require two owners. It requires two CONTRIBUTIONS, and one owner can
 * supply both.** Measured by `reduce-sovereign.test.ts`'s case *"aggregates ONE owner's two
 * distinct partials"*: one owner, two owner-pinned shards, two distinct outputs — the call
 * returns `ok: true` with `tree.nodes: 1`, `minReplicas: 2`, and complete coverage at 1/1. The
 * case was planted red before it was believed: inserting `if (new Set(pinned.values()).size < 2)
 * return refuse(…)` into `reduce-sovereign.ts` reddened it with *"expected false to be true"*,
 * and the plant was restored to a byte-identical file.
 *
 * **Why the false premise survived, stated so the next reader can spot the shape.** The three
 * refusals between a job and an aggregate are each counted over a *different* population:
 * `pinned.size === 0` over owner-pinned **shards**, `tree.nodes.length === 0` over
 * **contributions** (*"a single contribution is promoted rather than combined"*), and
 * `minReplicas < 2` over **combine executors**. None is over distinct owners. Every passing
 * fixture in that spec happened to pin one shard per owner, so owners and contributions moved
 * together in all of them, and the refusal case for the middle branch varied **both at once** —
 * `specPinnedTo([ALICE.ownerId])` is one owner *and* one shard. Nothing in the suite separated
 * them, so a reader checking "does this need a second owner?" found every fixture consistent
 * with yes and none of them testing it.
 *
 * **What is actually true of `bin/bench.ts`.** Its `--sovereign` leg dispatches
 * `shards: [{ … label: 'sovereign', ownerId: BENCH_OWNER_KEY }]` — a **one-element array**
 * (`bin/bench.ts:1549`), and it prints *"of 1 sovereign shards agreed"* (`:1590`). So the leg is
 * short of a *second row*, not short of a *second identity*. That is a wiring fix and not an
 * owner decision, and the sentence above had it backwards.
 *
 * ## Lowered 38 → 36, measured 2026-08-11 — and this one is WIRING, not a reclassification
 *
 * Every prior movement in this note was a raise, a removal, or a correction of what the count was
 * *of*. This is the first that is the work itself. `core/decodeX509Certificate` and
 * `core/describeX509Failure` were raised into this residue by the 47 → 49 note above, on the
 * explicit ground that *"this phase does not wire the decoder into enrollment, issuance, or the
 * demo"*. It is wired now: `checkX509Form` in `packages/core/src/enrollment.ts` calls both — the
 * decoder to parse a presented certificate and the describer to name its refusal — fail-closed,
 * on the trust path. Both symbols leave the open list because they have a production caller, not
 * because anything about them was reclassified.
 *
 * **Measured, not derived.** This ceiling was set to 0 and the guard reported *"36 unreachable
 * callable barrel exports carry no disposition"*, naming all thirty-six with the two visibly
 * absent. 38 − 2 is also 36 and the agreement was not taken as the proof — the 49 → 47 note above
 * records why that coincidence is refused here as a matter of habit.
 *
 * ## Lowered 36 → 29, measured 2026-08-13 — an INSTRUMENT repair, and it is neither of the above
 *
 * Every prior movement was a raise, a reclassification, or wiring. This one is a third kind:
 * **nothing about the tree changed and nothing was reclassified by judgement** — the tracer was
 * repaired, and seven symbols that had a production caller all along stopped being reported as
 * having none. Six could not be seen by any plant, and one was seen only by a plant that had
 * nothing to root:
 *
 * - `core/executeVerified` **leaves the findings entirely** and is not disposed. It is the
 *   fabric's N-version comparison and runs on every shard dispatch; `submitJob` hands `runOn` — a
 *   `const`-arrow at `submit.ts:2933` — to `dispatchUnderLease` at `:3006`, and the reference
 *   filter dropped the edge because `classify` reads declaration flags and an arrow-initialised
 *   `const` is a `Variable`. This is the only symbol in this repair that becomes **reachable**.
 * - `core/describeStartReport` moves to {@link GLOBAL_OBJECT_HOP}; see that constant's `26 → 27`
 *   note. It had an in-degree of zero, so the hop plant could not find it.
 * - `core/signResult`, `core/describeModuleRefusal`, `aot/describeWasiFailure`,
 *   `core/TransportError` and `node/classifyReservationFailure` move to
 *   {@link HIDDEN_BY_DISPATCH}, where each carries the member it is reached through and three
 *   measured legs holding that claim up.
 *
 * **Measured, not derived, and the trap this note names twice above was live a third time.** Both
 * ceilings were set to 0 and the guard reported *"the guard found 71 unreachable callable barrel
 * exports"* and *"29 unreachable callable barrel exports carry no disposition"*, naming all
 * twenty-nine. 36 − 7 is also 29 and the agreement was not taken as the proof.
 *
 * **This does not touch the owner's ruling to hold the residue.** Nothing was worked down; a
 * measuring instrument stopped mis-measuring, and the residue was smaller than reported for as
 * long as the defect existed.
 *
 * **This is where the count of the facades is NOT.** `packages/core/src/cert-lifecycle.ts`
 * publishes nothing to any barrel, so its four facades and three factories were never in this
 * population and no edit here can put them in one. They are ledgered by
 * `reachability-guard.node.test.ts`'s *"a module that reaches no barrel is counted, not
 * invisible"* block, which measures the price of moving them here — **+7, read within one run on
 * 2026-08-11, not the +12 that had been projected** — and holds them out until an owner decides
 * otherwise.
 *
 * > **RETIRED 2026-08-24 — the owner decided, and the answer was neither.** `cert-lifecycle.ts`
 * > was deleted rather than wired: its delegation half duplicated `capability.ts`, its identity
 * > half duplicated `enrollment.ts`, its crypto-backend selection had already been merged into
 * > `ed25519-backend.ts` by Phase 28, and its revocation half is refused by standing ruling. The
 * > paragraph above is preserved because the **+7** it records is a real reading of a real tree
 * > and is the evidence that moving them here was never free — which is part of why they went
 * > instead. No count in this file changed: they were never in this population.
 *
 * ## Lowered 29 → 27, measured 2026-08-14 — WIRING, and the second such lowering here
 *
 * `net/reduceSovereignJob` and `core/withCoverage` both leave the open population, and they leave
 * it together for one reason: the arm was `withCoverage`'s only caller, so giving the arm a caller
 * gave both a path. One wire, two symbols.
 *
 * The caller is `bin/bench.ts`'s `--sovereign` leg, which now dispatches **two** owner-pinned rows
 * instead of one and aggregates them. Measured on a real run — *"1 combine(s) at 2 replicas,
 * coverage 1/1 owners complete, 2 row(s) watched over 2 pinned"* at the two-worker rung, with the
 * one-worker rung naming why it cannot carry an aggregation verified at two replicas — and the
 * instrument re-read afterwards at 27 rather than derived by subtraction.
 *
 * **This lowering is only possible because the blocker recorded above was false**; see the
 * retraction in the `37 → 38` note. Neither symbol was ever blocked on anything.
 *
 * ## Lowered 27 → 25, measured 2026-08-14 — an INSTRUMENT REPAIR, and nothing was wired
 *
 * `node/lanAddresses` and `node/localHostname` were never unwired. Both run on **every `o2 seed`
 * invocation**: `bin/seed.ts` is an entry point and reads `seed.joinUrl` (`:364`, `:368`) and
 * `seed.joinUrlsByIp` (`:365`), which are **getters** — so the reads are property accesses, not
 * calls, and the tracer dropped the `.name` half of a bare read while keeping it for a call.
 * `reachability.ts`'s property-access branch now pushes the member edge for a read too, and the
 * branch carries the measurement.
 *
 * **This is the second time in two days that this count was over-stating the gap, and the shape
 * was identical both times**: live production code reported as an unwired capability because the
 * graph could not see one kind of edge. Yesterday it was `core/executeVerified` — the fabric's
 * N-version comparison, running on every shard dispatch — hidden behind a `const`-arrow. The
 * standing lesson is unchanged and is worth restating where the number lives: **do not treat a
 * reachability finding as a gap without reading the symbol's call sites first.**
 *
 * The over-connection risk was measured before the rule was taken. `demo/estimatePi` — the anchor
 * that must stay unreachable — **still does**, and the total moved 69 → 67, i.e. the rule connects
 * exactly the two getters and nothing else. A rule that connected broadly would have shown as a
 * large drop and been refused, as the object-literal-method rule was.
 *
 * ## Lowered 25 → 24, measured 2026-08-14 — WIRING, and it closed a real refusal
 *
 * `browser/memoryConsentStore` has a production caller. Its own docblock had claimed for
 * months that it was used *"by a page whose storage is denied"*, and that was false —
 * `demo/main.ts` bound `localConsentStore()` unconditionally, whose writes are a silent
 * no-op when storage is unusable. **The unwired symbol and a user-visible defect were the
 * same fact**: `requireConsent()` re-reads the store rather than using what `grantConsent`
 * returned, so a visitor in private browsing pressed *Allow* and then got `no consent` on
 * *Start*. `pageConsentStore` round-trips a probe and falls back to memory; the demo binds
 * it; the symbol is reached because the bug is fixed, not to make a number smaller.
 *
 * ## Held by name rather than by a count, 2026-08-14 — WIRE-02
 *
 * The twenty-four the ceiling was holding are the twenty-four below. Nothing was wired, nothing
 * was re-caused, and the count did not move: what changed is that each of them now has to be
 * written down, and symbol #25 arrives red and named instead of arriving under a bound.
 */
/**
 * The bound the unreachable count is held under — named ONCE and read in both places.
 *
 * It was a literal in the assertion and a different literal in that assertion's own message,
 * and across four raises the two drifted to `74` and `66`. Every run in between printed a
 * bound that was not the one being applied. The register above is what actually holds these
 * symbols; this number exists so a seventh arrival cannot slip in under a bound that was
 * sized for six.
 */
const UNREACHABLE_CEILING = 84

const OPEN_FINDINGS: readonly OpenFinding[] = [
  {
    key: 'cloudflare/DoDatastore',
    declaredIn: 'packages/cloudflare/src/do-datastore.ts',
    // `unreachable-only`, and the graph is what said so — this row claimed `none` first, on
    // the reasoning that nothing outside the package touches it yet. The walk corrected it:
    // `refusedPrefixFor` reads `DoDatastore.refusedKeyPrefixes` at `do-datastore.ts:158`, so a
    // caller exists and is itself stranded. Recording the corrected value rather than the
    // reasoned one, because the field's whole purpose is that `none` and `unreachable-only`
    // need different work.
    callers: 'unreachable-only',
    reason:
      'Phase 29 criterion 3, landed 2026-08-25. The hosted tier reaches Durable Object ' +
      'storage through `interface-datastore`, and no published package binds the two — the ' +
      'last generic async datastore this project reached for hung the enrolment RPC for a ' +
      'week, which is why this is hand-written and small enough to read. IT HAS NO CALLER ' +
      'BECAUSE ITS CONSUMER IS THE SAME PHASE AND IS NOT BUILT YET: criteria 2 and 7 assemble ' +
      'the libp2p node that passes this store to `createLibp2p`, and that assembly is a ' +
      'separate stream. The nameable wiring that closes this row is exactly that — a Durable ' +
      'Object class constructing `DoDatastore` over its own `state.storage` and handing it to ' +
      'the node factory. This must not be closed by exporting a caller; it closes when the ' +
      'node deploys and dials. ' +
      '**THE NAMED WIRING LANDED 2026-08-26 AND THE ROW STAYS OPEN, which is the sentence ' +
      'above doing its job rather than an oversight.** `HostedNode` constructs this store over ' +
      "a Durable Object's `state.storage` and `BootstrapObject` constructs `HostedNode` — " +
      'exactly the wiring this row demanded. What has NOT happened is the second half of the ' +
      'same sentence: nothing deploys and nothing dials, because Phase 29 criteria 1 and 2 are ' +
      'owner acts at the Cloudflare boundary by ruling. Moving this row to `DISPOSITIONS` on ' +
      'the strength of a source-level caller would be closing it by exporting a caller, which ' +
      'is the one repair this row forbids in advance. The six symbols the assembly added are ' +
      'below, in the same position and for the same reason.',
  },
  {
    key: 'cloudflare/RecordShapedKeyRefusedError',
    declaredIn: 'packages/cloudflare/src/do-datastore.ts',
    callers: 'unreachable-only',
    reason:
      'The refusal `DoDatastore.put` raises for a DHT-record-shaped key, and the reason it ' +
      'is a named typed outcome rather than a thrown string is that Phase 29 criterion 3 ' +
      'makes it load-bearing: the store carries the node identity key and holds NO DHT ' +
      'record until Phase 31 lands the sweep beside the record store, so the ' +
      'unbounded-accumulation window never opens. Its thrower is `DoDatastore.put`, which is ' +
      'itself unreachable for the reason in the row above — so this closes on the same day ' +
      'and by the same wiring, not by a separate change. Proved able to fail: emptying the ' +
      'refused-prefix set turns 10 cases red, deleting only the four-line guard in `put` ' +
      'turns 9 red.',
  },
  {
    key: 'cloudflare/StoredValueNotBytesError',
    declaredIn: 'packages/cloudflare/src/do-datastore.ts',
    callers: 'unreachable-only',
    reason:
      'Raised when Durable Object storage answers with something that is not bytes. It ' +
      'exists because this repository forbids type assertions and the real storage API types ' +
      'its reads through a caller-chosen generic, which is an assertion wearing a type ' +
      'parameter — so the value is PROVED to be bytes at runtime instead of being declared to ' +
      'be. Same thrower and same closing condition as the two rows above.',
  },
  {
    key: 'cloudflare/HostedNode',
    declaredIn: 'packages/cloudflare/src/hosted-object.ts',
    callers: 'unreachable-only',
    reason:
      'Phase 29 criteria 2 and 3, landed 2026-08-26 — the assembly the three rows above named ' +
      'as their closing condition. It constructs `DoDatastore` over a Durable Object\'s own ' +
      'storage and derives the node identity from a seed persisted in it. Its caller is ' +
      '`BootstrapObject`, the deployed Durable Object class in `worker.ts`, which is an ENTRY ' +
      'POINT of this walk as of the same day. It is still unreachable for a reason the walk is ' +
      'right about: the Workers runtime invokes the class and the default export, and no call ' +
      'expression in this repository does — the same shape as `global-object-hop`, and the ' +
      'reason that cause exists. It is NOT dispositioned under a mechanism, because those ' +
      'symbols have a caller that RUNS and these do not: nothing deploys yet. The row closes ' +
      'when the object is deployed, which is an owner act by ruling.',
  },
  {
    key: 'cloudflare/hostedIdentity',
    declaredIn: 'packages/cloudflare/src/hosted-identity.ts',
    callers: 'unreachable-only',
    reason:
      "The hosted node's identity, derived from a seed persisted in Durable Object storage. " +
      'Called by `HostedNode.identity`, which is stranded for the reason in the row above. It ' +
      'is what makes criterion 2 possible at all: a plain Worker returned THREE DIFFERENT ' +
      'PeerIds to three consecutive requests because each landed in a fresh isolate, and an ' +
      'address derived from a key that changes per restart is an address nobody can publish. ' +
      'Same closing condition as `HostedNode`.',
  },
  {
    key: 'cloudflare/loadOrCreateHostedSeed',
    declaredIn: 'packages/cloudflare/src/hosted-identity.ts',
    callers: 'unreachable-only',
    reason:
      'The load-or-mint half of the identity, one hop behind `hostedIdentity`. Separate from ' +
      'it because the SEED is what has to survive an eviction and the derivation is pure — ' +
      'the same split `packages/node/src/identity-store.ts` makes between `loadOrCreateSeed` ' +
      'and `identityFromSeed`. Same closing condition.',
  },
  {
    key: 'cloudflare/MalformedStoredSeedError',
    declaredIn: 'packages/cloudflare/src/hosted-identity.ts',
    callers: 'unreachable-only',
    reason:
      'Raised when the stored seed is not exactly 32 bytes. It is a named typed outcome ' +
      'rather than a silent re-mint because the silent behaviour is the dangerous one: a ' +
      'short read reinterpreted as a new identity drops the node out of every peer\'s ' +
      'verified set and out of every bootstrap list naming it, with nothing reporting why. ' +
      'Thrown inside `loadOrCreateHostedSeed`, so it is stranded with it. Proved able to ' +
      'fail: `hosted-identity.test.ts` asserts the rejection and asserts that the malformed ' +
      'bytes are still in the store afterwards.',
  },
  {
    key: 'cloudflare/stubFor',
    declaredIn: 'packages/cloudflare/src/hosted-object.ts',
    callers: 'unreachable-only',
    reason:
      'Phase 29 criteria 4 and 6 — THE one call site in this repository that may obtain a ' +
      "Durable Object stub. An object's location is fixed by its very first `get()` and never " +
      'changes, so a second call site would site an object permanently and the only repair is ' +
      'a new name. Its only caller is the default export of `worker.ts`, invoked by the ' +
      'Workers runtime and by nothing in this tree. Same closing condition.',
  },
  {
    key: 'cloudflare/UnknownHostedObjectNameError',
    declaredIn: 'packages/cloudflare/src/hosted-object.ts',
    callers: 'unreachable-only',
    reason:
      'The refusal `stubFor` raises for a name outside the closed enumeration — criterion 6. ' +
      'The runtime check is not redundant beside the type: a name that arrived from a request ' +
      'is a `string`, the type is erased at exactly that boundary, and only a value check can ' +
      'refuse it. Thrown inside `stubFor` and stranded with it. Proved able to fail: deleting ' +
      "the check turns `hosted-identity.test.ts`'s undeclared-name case red, and that case " +
      'asserts NOTHING WAS SITED rather than only that a throw happened.',
  },
  {
    key: 'cloudflare/CloudflareWebSocketConnection',
    declaredIn: 'packages/cloudflare/src/websocket-connection.ts',
    callers: 'unreachable-only',
    reason:
      'The inbound listener, landed 2026-08-26 — a Cloudflare WebSocket as a libp2p ' +
      '`MultiaddrConnection`. Written here rather than reached inside `@libp2p/websockets`, ' +
      'whose `webSocketToMaConn` is not on its public surface; the base class comes through ' +
      "`@libp2p/utils`' own barrel, so nothing crosses a package boundary. It is stranded for " +
      'the same reason as `HostedNode` above: its caller is the deployed Worker and nothing ' +
      'deploys. Proved able to fail — five plants, one per requirement, each watched red: ' +
      'direction, the client address, the backpressure answer, the binaryType ordering, and ' +
      'the send-side copy.',
  },
  {
    key: 'cloudflare/acceptWebSocket',
    declaredIn: 'packages/cloudflare/src/websocket-connection.ts',
    callers: 'none',
    reason:
      'Sets `binaryType` on the REAL socket before accepting it and wires the frame handlers — ' +
      'the whole listener in one call. It deliberately does NOT call the upgrader: ' +
      '`upgradeInbound` must not be awaited before the 101 is returned, since no byte moves ' +
      'until the response is sent, so awaiting deadlocks by construction. Keeping that at the ' +
      "caller makes the ordering a visible decision. Same closing condition as the row above.",
  },
  {
    key: 'cloudflare/remoteAddrFromRequest',
    declaredIn: 'packages/cloudflare/src/websocket-connection.ts',
    callers: 'none',
    reason:
      'Derives the remote multiaddr from `CF-Connecting-IP`. The consult calls the absence of ' +
      'this "the most consequential defect found in the listener": without it every inbound ' +
      "connection reports as loopback and libp2p's per-host inbound threshold rate-limits the " +
      'entire internet at five connections a second, invisible below that scale. Same closing ' +
      'condition.',
  },
  {
    key: 'cloudflare/MissingClientAddressError',
    declaredIn: 'packages/cloudflare/src/websocket-connection.ts',
    callers: 'unreachable-only',
    reason:
      'The refusal `remoteAddrFromRequest` raises rather than defaulting to loopback. It is a ' +
      'named typed outcome because the alternative is the silent one: a fallback is invisible ' +
      'until the sixth connection of a second, and a refusal is loud at the first. Thrown ' +
      'inside that function and stranded with it.',
  },
  {
    key: 'core/keyCommitment',
    declaredIn: 'packages/core/src/enrollment.ts',
    // `unreachable-only`, and the graph is what said so — this row claimed `none` first, on
    // the reasoning that nothing rotates a key so nothing can call it. The walk corrected it:
    // `honoursKeyCommitment` calls this to recompute the hash it compares against, and that
    // caller is itself unreachable. The distinction is the one this field exists for — a
    // stranded caller already exists here, so closing this row is wiring rather than writing.
    callers: 'unreachable-only',
    reason:
      'AUTH-05 pre-rotation, added 2026-08-23 by owner ruling. A certificate may name the ' +
      'key its node will move to next, so a rotation carries trust across instead of ' +
      'presenting a stranger. NOTHING ROTATES YET, and that is the whole reason this is ' +
      'here rather than wired: the field sits inside the issuer signature, so adding it ' +
      'later means changing a signed format with certificates in circulation, and the ' +
      'owner took it now precisely to avoid that. The format half IS reached — `payloadOf` ' +
      'spreads the field on every issuance and `enrol` carries it from the request, both ' +
      'plant-proofed in `key-rotation.test.ts`. What has no caller is the pair a rotating ' +
      'node would use. The nameable wiring that closes it: a node factory option for the ' +
      'next key plus a re-enrolment under it, which is a phase nobody has scoped and which ' +
      'must not be invented under cover of an export.',
  },
  {
    key: 'core/honoursKeyCommitment',
    declaredIn: 'packages/core/src/enrollment.ts',
    callers: 'none',
    reason:
      'The verify half of the row above, and it is listed separately rather than folded in ' +
      'because the two close on different days: `keyCommitment` is wired by whatever first ' +
      'rotates a key, and this one by whatever first VERIFIES a rotation — `PeerVerifier`, ' +
      'which today re-asks a peer whose certificate expired and has no notion of a peer ' +
      'whose key changed. Exported as a pair because one is useless without the other, and ' +
      'a barrel offering only the commitment would invite a caller to compare hex by hand.',
  },
  {
    key: 'core/signNameDelegation',
    declaredIn: 'packages/core/src/naming.ts',
    // `none`, not `unreachable-only`, and the walk had to say so — this row claimed the latter
    // first because `sign-kernel.ts` calls it in the source, and the graph corrected it: build
    // scripts under `packages/demo/scripts/` are outside the walked corpus entirely, so there is
    // no stranded caller to find. The distinction matters because the two need different work —
    // `unreachable-only` is wiring a caller that already exists, `none` is writing one.
    callers: 'none',
    reason:
      'The MINT side of the offline-root chain, added 2026-08-21 for task #4 half 2. The graph ' +
      'sees NO caller: `packages/demo/scripts/sign-kernel.ts` calls it, but build scripts are ' +
      'outside the walked corpus, and that script is deliberately not an entry point — which ' +
      'is the shape the feature is FOR: a root ' +
      'whose private half never touches a publishing machine is signed somewhere this ' +
      'repository does not run. The VERIFY side is fully reached: `SignedNameResolver.accept` ' +
      'walks the delegation on every record the demo dispatches, and six refusals are ' +
      'plant-proofed in `naming.test.ts`. So this is not a capability nobody wired — it is the ' +
      'half that by construction has no runtime caller. The nameable wiring that would close ' +
      'it: `tools/aot/cli.ts` gaining a mint mode, which today it cannot have without relaxing ' +
      "`parseAotArgs`'s positional requirement (it refuses `no-input` before any flag is read), " +
      'and nobody has decided to do that.',
  },
  // ---------------------------------------------------------------------------------------
  // THIRTEEN ROWS LEFT THIS REGISTER ON 2026-08-18, and the three routes are not equivalent.
  // Each is named here rather than deleted silently, because a register whose history is
  // invisible cannot be audited and because two of the three routes are ones a future reader
  // must be able to tell apart from wiring.
  //
  // **Wired — a real production call site now exists (2).**
  //
  // - `aot/describeRefusal`. `tools/aot/lift.ts`'s `describeLiftFailure` rendered a screening
  //   refusal as `(${failure.reason.kind})` — the discriminant alone — so the sentence this
  //   function exists to produce reached nobody outside `elf.test.ts`. It now renders
  //   `describeRefusal(failure.reason)`, on the same path `tools/aot/cli.ts` prints. The row
  //   said *"Nobody has decided whether the lift driver should print it, and nothing in the
  //   source declines to"*; somebody decided, in the direction the row left open.
  // - `core/checkLease`. The predicate was hand-inlined at two sites in `job/submit.ts`'s
  //   lease loop — `at >= lease.expiresAt` and `woke >= lease.expiresAt` — which is
  //   `checkLease(lease, now).expired` exactly, and `lease.test.ts` pins the boundary case
  //   that makes the two identical. Both sites call it now, beside `shouldRenew`, which the
  //   row itself named as the wired sibling sixteen lines below it in the same module.
  //   **Behaviour-neutral, and the row's own deferral is untouched**: nobody has wired
  //   self-termination into an executor, and this is not that. What closed is the narrower
  //   claim the guard makes — the symbol has a traced path.
  //
  // **Retired from a barrel — the declaration and its spec are untouched (5).**
  //
  // - `browser/cacheVerdict`, `browser/describeCacheVerdict`, `browser/measureRepeatLoad`.
  //   The two-visit code-cache measurement, off `@o2/browser`'s barrel on the in-file
  //   precedent that five sibling symbols of the same kind were already deliberately kept off
  //   it. `streaming-load.browser.test.ts` imports all three module-relative and is unchanged.
  //   **A FALSE REASON went with them and is corrected here rather than carried out of sight**:
  //   `measureRepeatLoad`'s row read *"Driven by `code-cache.e2e.test.ts` as a measurement"*,
  //   and that was never true — `code-cache.e2e.test.ts` imports `loadArtifact` and nothing
  //   else from that module. The only driver of all three is the browser spec named above.
  // - `core/settleRace`. Off `@o2/core`'s barrel because the one site that would consume it
  //   refuses it in writing on a **correctness** ground: `job/submit.ts` compares CIDs
  //   directly rather than re-deriving a winner from arrival instants that could name the
  //   loser on a coarse clock. Publishing it invited the mistake that comment prevents.
  // - `core/startReport`. Superseded by the counts fold on every production path, and kept as
  //   a declaration because `start-outcome.test.ts` uses it as a **differential oracle**
  //   against `StartOutcomeLedger#report()`. Deleting it would remove a check, not dead code;
  //   its docblock now says so at the declaration.
  //
  // **Re-caused into `DISPOSITIONS` — no call path was gained (6).**
  //
  // - `node/relayAddrForHost` → `HIDDEN_BY_DISPATCH`, `proxy-trap-dispatch`. Its row here had
  //   already measured the whole mechanism and said it *"would qualify for a disposition"*,
  //   holding it open because *"re-causing a symbol is a decision to put rather than to take
  //   in passing"*. The decision was taken. The three legs were re-measured on the day it
  //   moved, and the guard re-measures them on every run.
  // - `core/createNobleSyncVerifier`, `core/Ed25519NotInitializedError`,
  //   `core/getAsyncVerifier`, `core/getSyncVerifier`, `core/initEd25519` →
  //   `DEFERRED_IN_SOURCE`. Their shared reason ended *"An open decision, not a decision
  //   against wiring"*, and that was **false when it was written**: CRYPTO-03 had taken the
  //   decision, with the measurement that routing the nine direct verification sites through
  //   the port would select nothing and would only add a failure mode. Wiring them is
  //   affirmatively wrong and would also redden `requirements-ledger.node.test.ts`, which
  //   holds WIRE-02's own sentence that `getSyncVerifier` has no production caller. Retiring
  //   them is blocked by `libsodium-absence.e2e.test.ts`, which imports two of the five
  //   **from the barrel** to build the page CRYPTO-05 gzips.
  //
  // `DISPOSITION_CEILING` moved 60 → 66 for the last six, and its note carries why a raise
  // there sits beside a total moving 75 → 68 and a residue moving 15 → 2.
  // ---------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------
  // THE FOURTEENTH ROW LEFT ON 2026-08-18, AND THE REGISTER IS NOW EMPTY — `core/isComplete`,
  // RETIRED. Read this before concluding that an empty register means the guard stopped
  // guarding: the guard's cases are all derived from a live walk of this tree, and an empty
  // register makes every one of them *stricter*, because the permitted set is now exactly
  // `DISPOSITIONS` and any new unwired barrel export arrives named and red with nothing to
  // absorb it.
  //
  // **Retired, not wired, and the distinction is the whole entry.** The row deleted here had
  // been re-read on 2026-08-18 and held open with *"Neither is work. The deferral quoted above
  // is unchanged."* The owner then asked for the symbol's **purpose** to be reviewed before
  // either route was taken, and the review found the capability redundant in this design on
  // three grounds measured against the tree, not argued:
  //
  // 1. The resume path already avoids the work an early-out would save — `job/submit.ts:2861`
  //    reads `if (carried.has(i) || gate.refusal !== null) continue`, so a fully-carried job
  //    makes zero `planWithOffers` calls and dispatches nothing.
  // 2. A safe early-out cannot run earlier than that anyway. `jobId` is derived FROM the input
  //    CIDs (`jobIdOf`, `submit.ts:1288`) and `resumeState` refuses a handle whose checkpoint
  //    names another job (`checkpoint-names-another-job`, `:1041`). Short-circuiting ahead of
  //    `jobId` would accept a complete checkpoint belonging to a *different* job.
  // 3. The one reporting site is covered — `bin/agent.ts:1555` prints
  //    `remaining: [...remainingWork(...)]`, and an empty array **is** completeness.
  //
  // That is the same structural argument this register already made in the deleted row's own
  // words — *"Nothing else asks whether a whole job is done, because a resume branches per
  // partition rather than on a total."* The row held it open because retiring *"would move the
  // gap out of this instrument"*; with the purpose reviewed there is no gap to move. The
  // declaration and `checkpoint.test.ts` are untouched — that spec imports from
  // `./checkpoint.ts` module-relatively — so no case was lost; only the advertisement is gone.
  // `checkpoint.ts`'s declaration now carries the three grounds so nobody re-exports it.
  //
  // **Phase 22's criterion 1 closes on this**, and it closes on a measurement rather than on
  // this comment: the open set was re-read after the change and is empty. Full working in
  // `.planning/phases/phase-22-reachability-guard/22-VERIFICATION.md`'s 2026-08-18 amendment.
  // ---------------------------------------------------------------------------------------
]

/**
 * `barrel/symbol` for every open finding — the form the guard's verdict list uses.
 *
 * Derived rather than kept as a second array, for the reason `WITHOUT_A_CHECKABLE_CLAIM` derives
 * its own ids: a second hand-maintained list of the same keys is the defect this whole file is
 * about, one level up.
 */
function openFindingKeys(register: readonly OpenFinding[] = OPEN_FINDINGS): Set<string> {
  return new Set(register.map((one) => one.key))
}

// ---------------------------------------------------------------------------

/**
 * The guard fails **per symbol** rather than per population count — 2026-08-14.
 *
 * ## What was wrong with the thing this replaces
 *
 * Until today the undisposed residue was held by `expect(open.length).toBeLessThanOrEqual(24)`.
 * That assertion is green about twenty-four unwired capabilities without naming one of them, and
 * — the part that matters — it is **equally green about any other twenty-four**. Swap a symbol
 * out and a different one in and nothing moves. WIRE-02's row asks that *"a guard test fails when
 * a capability exported from a package barrel has no call path from any runnable entry point"*,
 * and a bound on the size of a set is not a claim about its members.
 *
 * **The owner's decision, 2026-08-14: per-symbol, backed by the register rather than a ceiling.**
 * A ceiling permits any new unreachable export up to N; a named register permits only the ones
 * somebody wrote down. So symbol #25 arrives red and named.
 *
 * ## Both directions, because either alone rots in the direction it does not look
 *
 * This is the shape `one-crypto-implementation.node.test.ts` already runs over
 * `ACCEPTED_SIGNATURE_COMPARISONS`, and it is copied deliberately rather than reinvented — that
 * file watched both of its directions red on 2026-08-10 and records the verbatim text of each.
 *
 * - **Unregistered.** A callable barrel export with no traced path and no entry in either
 *   register is a finding, and it is named.
 * - **Stale.** A registered symbol that has since gained a call path is *also* a finding. It is
 *   the direction a ceiling can never check, and the one that lets a register go decorative: an
 *   entry excusing something that no longer needs excusing is a permission for nothing.
 *
 * And **two weaker re-measurements per row**, which catch a rotting entry before the reachability
 * verdict does:
 *
 * - the file it says the symbol is declared in, so a moved declaration invalidates its row;
 * - whether *anything at all* calls it. A row claiming `'none'` that has gained an in-edge is
 *   half-wired — the symbol is still unreachable, so neither direction of the set equality moves,
 *   and the register has quietly stopped describing the tree.
 *
 * ## The anchor is untouched, and that is checked rather than asserted
 *
 * `demo/estimatePi` must stay unreachable, and it sits in {@link DISPOSITIONS} under
 * `global-object-hop` rather than in {@link OPEN_FINDINGS}. Nothing here is shaped to preserve
 * it: the union below would be satisfied by that symbol living in either register, or by its
 * being reachable and in neither. The anchor keeps its own case, above.
 *
 * ## Three plants, each watched red — 2026-08-14, `--project node`, exit 1 read directly
 *
 * Each was restored by the surgical inverse of its own edit and `cmp`-verified byte-identical
 * against a snapshot taken immediately before it; all three `cmp`s exited 0 and the `shasum -a
 * 256` of each file matched its pre-plant value.
 *
 * **All three were then taken a second time, after the register moved out of
 * `reachability-dispositions.ts` and into this file**, and produced the same failures with the
 * same text. That re-take is the one that describes the code as committed: a proof taken before
 * a move is a proof about a file that no longer exists.
 *
 * ### Plant A — a NEW unwired barrel export. `packages/demo/src/index.ts`, +4 lines:
 * `export function plantedUnwiredCapability(): number { return 25 }`. **3 failed | 32 passed**,
 * and the one that names it:
 *
 * ```
 * AssertionError: these callable barrel exports have no call path from any of the five entry
 * points and are in neither register. Wire them, or add a row to OPEN_FINDINGS with a reason a
 * reader can check — a count no longer covers for them: expected
 * [ 'demo/plantedUnwiredCapability' ] to deeply equal []
 * ```
 *
 * The set-equality case reddened beside it, and so did the old count ceiling — *"the guard found
 * 67 unreachable callable barrel exports … expected 67 to be less than or equal to 66"*. **That
 * is the one thing the ceiling could still catch, and it catches it as a number**: 67 against 66,
 * with no symbol named. The register printed the name.
 *
 * ### Plant B — a registered symbol GAINS a call path. `packages/node/src/bin/seed.ts`, an entry
 * point: `buildPrimesInput` added to its existing `@o2/demo` import and referenced at module
 * scope. **2 failed | 33 passed**:
 *
 * ```
 * AssertionError: these are registered as having no call path and the guard now reaches them —
 * that is wiring landing, so delete the rows rather than leaving a permission for nothing:
 * expected [ 'demo/buildPrimesInput' ] to deeply equal []
 * ```
 *
 * **The count ceiling stayed green under this plant** — 66 became 65, which is still `<= 66`.
 * That is the direction a ceiling structurally cannot see, and it is why this block exists.
 *
 * ### Plant C — a row goes HALF-WIRED. `void isComplete` inserted into `checkpointChain`, one
 * line, same file, no import: `core/isComplete` gains an in-edge from something itself
 * unreachable, so it stays a finding and **both directions of the set equality stay green**.
 * **1 failed | 34 passed**, and only the re-measurement moved:
 *
 * ```
 * AssertionError: these rows disagree with the graph about whether anything calls the symbol —
 * "none" and "unreachable-only" need different work, and a row that has drifted is describing a
 * tree that is not this one: expected [ Array(1) ] to deeply equal []
 * + "core/isComplete: registered \"none\", walked \"unreachable-only\"",
 * ```
 *
 * That plant is the argument for the `callers` column being in the register at all: set equality
 * alone is green about it, and so is the ceiling.
 *
 * ## Four more plants, each watched red — 2026-08-18, `--project node`, exit 1 read directly
 *
 * Taken when thirteen rows left this register, because a register that shrinks needs the same
 * proof as one that grows: the cases have to still fail. Each was restored by the surgical
 * inverse of its own edit, `cmp`-verified byte-identical against a snapshot taken immediately
 * before it, and `shasum -a 256`-matched; all four `cmp`s exited 0 and `git status --porcelain`
 * was empty after each.
 *
 * ### Plant D — a NEWLY-WIRED symbol loses its call site. `tools/aot/lift.ts`, one line: the
 * `describeRefusal(failure.reason)` interpolation replaced by a literal. **3 failed | 32
 * passed**, and the one that names it:
 *
 * ```
 * AssertionError: these callable barrel exports have no call path from any of the five entry
 * points and are in neither register. Wire them, or add a row to OPEN_FINDINGS with a reason a
 * reader can check — a count no longer covers for them: expected
 * [ 'aot/describeRefusal' ] to deeply equal []
 * ```
 *
 * ### Plant E — the same, for the other wire. `packages/core/src/job/submit.ts`, two lines:
 * both `checkLease(lease, …).expired` calls put back to the `>=` comparison they replaced.
 * **3 failed | 32 passed**, naming `[ 'core/checkLease' ]` in the same assertion, with the count
 * ceiling reading *"the guard found 69 … expected 69 to be less than or equal to 68"* beside it.
 *
 * ### Plant F — a NEW unwired barrel export, repeated from Plant A because the population it is
 * asserted over changed. `packages/demo/src/index.ts`, +4 lines. **3 failed | 32 passed**,
 * naming `[ 'demo/plantedUnwiredCapability' ]`.
 *
 * ### Plant G — the NEW hidden-caller row names the wrong member. `relayAddrForHost`'s `through`
 * planted from `…seed-server.ts#configureServer` to `…#bootstrapInfoFor`, which the graph *can*
 * see. **1 failed | 34 passed**, and only the mechanism case moved:
 *
 * ```
 * AssertionError: packages/node/src/seed-server.ts#bootstrapInfoFor has a caller the graph CAN
 * see, so "proxy-trap-dispatch" is not what hides node/relayAddrForHost — the row names the
 * wrong mechanism: expected 1 to be +0
 * ```
 *
 * That last one is the one that matters for a disposition arriving: it proves the row is held
 * against the real graph rather than against its own prose.
 */
describe('WIRE-02 — every unreachable export is named by a register, in both directions', () => {
  /** `barrel/symbol` for every callable barrel export the walk cannot reach. */
  function reportedKeys(): string[] {
    return unreachableExports(corpus(), graph(), ROOT)
      .map((one) => `${one.barrel}/${one.symbol}`)
      .sort()
  }

  /** The two registers together — every symbol somebody wrote down, whatever the reason. */
  function registeredKeys(): string[] {
    return [...new Set([...disposedKeys(), ...openFindingKeys()])].sort()
  }

  it('names every unreachable export in one of the two registers', () => {
    // Direction 1, and the half WIRE-02's row is literally about: a NEW exported-but-uncalled
    // capability. It adds a finding rather than removing a path, so no known-TRUE anchor can
    // catch it — only this can.
    const registered = new Set(registeredKeys())
    const unregistered = reportedKeys().filter((key) => !registered.has(key))
    expect(
      unregistered,
      'these callable barrel exports have no call path from any of the five entry points and are ' +
        'in neither register. Wire them, or add a row to OPEN_FINDINGS with a reason a reader ' +
        'can check — a count no longer covers for them',
    ).toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('holds no stale open finding — a registered symbol that gained a call path fails too', () => {
    // Direction 2, for {@link OPEN_FINDINGS}. Its twin for {@link DISPOSITIONS} is
    // `holds no entry for a symbol that has become reachable`, above; both exist because a
    // register that only ever grows is an allow-list wearing a different hat.
    const reported = new Set(reportedKeys())
    const stale = [...openFindingKeys()].filter((key) => !reported.has(key)).sort()
    expect(
      stale,
      'these are registered as having no call path and the guard now reaches them — that is ' +
        'wiring landing, so delete the rows rather than leaving a permission for nothing',
    ).toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('the reported set and the two registers are the same set', () => {
    // Stated once as an equality as well as twice as a difference, following
    // `one-crypto-implementation.node.test.ts`. It is redundant with the two cases above by
    // construction and it is kept for the same reason that file keeps its own: a failure here
    // prints both sides, which is what a reader picking this up actually needs.
    expect(reportedKeys()).toEqual(registeredKeys())
  }, GRAPH_TIMEOUT_MS)

  it('keeps the two registers disjoint, so neither can borrow the other\'s coverage', () => {
    // Without this, a symbol in both would let the union above pass while one of the two
    // registers said something false about it — and the DISPOSITIONS cases, which walk only
    // their own rows, would never look.
    const disposed = disposedKeys()
    const both = [...openFindingKeys()].filter((key) => disposed.has(key)).sort()
    expect(
      both,
      'a symbol cannot both be reached through a mechanism the tracer misses AND have no caller ' +
        'at all — one of its two rows is wrong',
    ).toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('re-measures where each open finding is declared', () => {
    // The cheap leg, and it is not decoration: a symbol that moved file keeps its name, so the
    // set equality above stays green while the row points at a file that no longer declares it —
    // and the reason, which cites line numbers in that file, silently stops applying.
    const declaredIn = new Map(
      unreachableExports(corpus(), graph(), ROOT).map((one) => [
        `${one.barrel}/${one.symbol}`,
        one.declaredIn,
      ]),
    )
    const wrong = OPEN_FINDINGS.filter(
      (row) => declaredIn.get(row.key) !== undefined && declaredIn.get(row.key) !== row.declaredIn,
    ).map((row) => `${row.key}: registered ${row.declaredIn}, walked ${declaredIn.get(row.key)}`)
    expect(wrong, 'these rows name a file that no longer declares the symbol').toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('re-measures whether anything at all calls each open finding', () => {
    // The leg that fires BEFORE reachability does. A symbol registered `'none'` that acquires an
    // in-edge from somewhere itself unreachable is half-wired: it is still a finding, so neither
    // direction of the set equality moves, and the register has stopped describing the tree
    // without anything saying so. `describeUnreachable` renders the same distinction, so a row
    // that is wrong here also makes the guard's own sentence wrong.
    const callers = new Map(
      unreachableExports(corpus(), graph(), ROOT).map((one) => [
        `${one.barrel}/${one.symbol}`,
        one.callers.length === 0 ? 'none' : 'unreachable-only',
      ]),
    )
    const wrong = OPEN_FINDINGS.filter(
      (row) => callers.get(row.key) !== undefined && callers.get(row.key) !== row.callers,
    ).map((row) => `${row.key}: registered "${row.callers}", walked "${callers.get(row.key)}"`)
    expect(
      wrong,
      'these rows disagree with the graph about whether anything calls the symbol — "none" and ' +
        '"unreachable-only" need different work, and a row that has drifted is describing a tree ' +
        'that is not this one',
    ).toEqual([])

    // Anti-vacuity: both values must actually occur, or the field is a constant and the case
    // above is comparing a column against itself. Measured 2026-08-14 — 14 `none`, 10
    // `unreachable-only`.
    //
    // ## Read over the WALK rather than over the register — corrected 2026-08-18
    //
    // This pair asserted `OPEN_FINDINGS` itself carried both values, and on 2026-08-18 the
    // residue fell to two rows, **both `'none'`**, so the `unreachable-only` half went red on a
    // register that had stopped being wrong about anything. That is the failure mode of a proxy:
    // the claim worth holding is *"the instrument can still tell the two apart"*, and the
    // register exhibiting both was only ever evidence for it while the register was large.
    //
    // So the same claim is now read where it is a fact about the instrument — the whole
    // unreachable population, disposed rows included. Measured 2026-08-18: **10 `none`, 58
    // `unreachable-only`** across 68 findings. The per-row re-measurement above is untouched and
    // is the load-bearing half; it is what Plant C reddened, and it still fails per row on a
    // register of any size. **This is a check moved to where it holds, not a check relaxed**:
    // the previous form was satisfiable by two hand-written rows and this one is not satisfiable
    // by any hand-written row at all.
    const walked = new Set(
      unreachableExports(corpus(), graph(), ROOT).map((one) =>
        one.callers.length === 0 ? 'none' : 'unreachable-only',
      ),
    )
    expect(walked.has('none'), 'the walk stopped producing findings with no caller at all').toBe(
      true,
    )
    expect(
      walked.has('unreachable-only'),
      'the walk stopped distinguishing a finding whose callers are themselves stranded — the ' +
        'caller index is not being computed, and the column above is comparing itself',
    ).toBe(true)
    // And the register's own column must still be one of the two the walk can produce, which is
    // what the per-row comparison above rests on.
    for (const row of OPEN_FINDINGS) expect(walked.has(row.callers)).toBe(true)
  }, GRAPH_TIMEOUT_MS)

  it('gives every open finding a reason and a unique key', () => {
    // A register whose rows say nothing is a ceiling with more typing. The floor is the same 80
    // characters `one-crypto-implementation.node.test.ts` uses for its own reasons — long enough
    // that "unwired" and "TODO" do not pass, short enough that a genuine one-line cross-reference
    // to a sibling row does.
    for (const row of OPEN_FINDINGS) {
      expect(row.reason.length, `${row.key} needs a reason, not a note`).toBeGreaterThan(80)
      expect(row.key, `${row.key} is not in barrel/symbol form`).toMatch(/^[a-z]+\/\S+$/)
    }
    expect(openFindingKeys().size, 'a duplicated key hides a row').toBe(OPEN_FINDINGS.length)
  }, GRAPH_TIMEOUT_MS)
})

// ---------------------------------------------------------------------------
// CRYPTO-03 — the blind spot above the barrel, and the price of closing it
// ---------------------------------------------------------------------------

/**
 * How many production modules nothing in the production corpus imports.
 *
 * Sited at **27**, measured 2026-08-11 at `afe4df6`, by the predicate in
 * {@link orphanModules} — read off the graph, not counted by hand.
 *
 * **Raised to 28 on 2026-08-17, and here is the reason the docblock below demands.**
 * `packages/node/src/local-acme.ts` arrived: an ACME certificate authority, a DNS zone and a
 * p2p-forge stand-in, all on loopback, so NET-03's `auto-acquires a TLS certificate` clause
 * could be measured on a host with no public address. Nothing in production imports it and
 * nothing should — it is a test instrument in the same category as `node/reachability.ts`,
 * `node/strip-comments.ts` and `node/capability-fixture.ts`, three of the population this
 * ceiling already counts.
 *
 * The raise is not a threshold widened to buy a green: the count is a **census**, its own
 * docblock says a 28th must not arrive *unnoticed* rather than must not arrive, and this one
 * is named. What would be illegitimate is raising it without saying which module moved the
 * number, which is why the sentence above names the file and the requirement.
 *
 * **Raised to 29 on 2026-08-21, same terms.** `packages/node/src/e2e-browser-launch.ts`
 * arrived: the single place every e2e fixture launches a browser, carrying the one Chromium
 * switch that stops the suite depending on whether this host's mDNS resolves Chromium's
 * ephemeral `.local` ICE candidate names (task #58, measured in
 * `.planning/consults/2026-08-21-chromium-mdns-ice-blocks-tab-to-tab.md`). Nothing in
 * production imports it and nothing should — it is a test instrument in exactly the category
 * this ceiling already counts, and it is **not** barrel-exported for
 * `capability-fixture.ts`'s stated reason: a barrel-exported fixture hands the reachability
 * guard a finding the fixture itself invented. Trading one counted orphan for 33 copies of a
 * launch flag is the cheaper side, and the copies would have had no single place to record
 * what the flag costs.
 *
 * **A ceiling, on the same terms as `OPEN_FINDING_CEILING`: lowering it is the work, raising
 * it needs a reason written beside it.** The population is deliberately not disposed
 * entry-by-entry. `reachability-dispositions.ts`'s rule is that a disposition is granted on a
 * *mechanism the graph cannot see*, and these 27 have at least four different mechanisms
 * between them — build configuration (`browser/vite.config.ts`), test-only instruments
 * (`node/reachability.ts`, `node/strip-comments.ts`, `node/mutation-guard.mutate.ts`,
 * `aot/src/fixtures/*`), runnable modules deliberately outside {@link ENTRY_POINTS}
 * (`tools/aot/bench-lifted.ts`, `tools/aot/measure-wasi.ts`, and the three named in that
 * constant's own docblock), and genuinely-unwired production code. Writing 27 causes from a
 * reading is the failure mode this file's `global-object-hop` case exists to refuse. The count
 * is held still instead, which is what stops a 28th arriving unnoticed.
 */
// 2026-08-24: 29 → 28, lowered by exactly one and named. `packages/core/src/cert-lifecycle.ts`
// left the tree by owner ruling — see `UNCOUNTED_MODULE` below. Lowered rather than left
// slack, because slack is what lets a 29th arrive unnoticed, which is the whole point of
// holding this number still.
// 2026-08-25: 28 → 30, raised by exactly two and both named. `packages/cloudflare/src/index.ts`
// is the new package's barrel, which nothing imports yet for the same scheduled reason as the
// three `cloudflare/` rows in `OPEN_FINDINGS` — its consumer is Phase 29's own criteria 2 and
// 7. `packages/cloudflare/src/do-storage.fixture.ts` is a test-only instrument, the same
// mechanism as `node/capability-fixture.ts` already on this list, and it is deliberately a
// COMPLETE implementation of the storage interface rather than a partial mock, which is why it
// is a module rather than an inline object. Neither is production code that forgot to be
// wired, and the first is expected to leave this list inside the milestone.
const ORPHAN_MODULE_CEILING = 30

/**
 * A production module that reaches **no barrel at all**, named by path.
 *
 * It is here rather than in the open-findings list because the guard above walks barrel
 * exports, and a module that publishes to none is outside that guard's jurisdiction
 * entirely. This block closes that blind spot, and it needs a **specimen** to prove the
 * detector can see one.
 *
 * > **2026-08-24 — the specimen changed, the need did not.** This was
 * > `packages/core/src/cert-lifecycle.ts`, CRYPTO-03's whole subject, until the owner ruled
 * > that module out of the tree (*"we might wanna unify that"* — one certificate system, not
 * > two) and it was deleted. Deleting a specimen removes the example, never the property, so
 * > this points at another module of **the same shape**: real production code, no production
 * > importer, nothing on any barrel. `wasm-probes.ts` builds probe modules and detects no
 * > engine features, which `fabric-node.ts`'s `ownRecords` docblock already records — so it
 * > is uncounted for the same reason cert-lifecycle was, and is not test machinery, a demo
 * > surface or a build tool, all of which are volatile in this list for reasons that have
 * > nothing to do with wiring.
 */
const UNCOUNTED_MODULE = 'packages/browser/src/wasm-probes.ts'

/** A module that is in the corpus, is not an entry point, and that nothing else imports. */
function orphanModules(built: CallGraph): string[] {
  const imported = new Set<string>()
  for (const [, targets] of built.imports) for (const target of targets) imported.add(target)
  return built.files.filter((file) => !imported.has(file) && !ENTRY_POINTS.includes(file)).sort()
}

/** Every barrel export whose declaration sits in `file`, however it got onto the barrel. */
function barrelExportsDeclaredIn(file: string): ClassifiedExport[] {
  const suffix = `/${file}`.toLowerCase()
  return corpus().filter((one) => one.declaredIn.toLowerCase().endsWith(suffix))
}

describe('CRYPTO-03 — a module that reaches no barrel is counted, not invisible', () => {
  /**
   * **The guard above cannot see this module, and that is the defect — not an omission here.**
   *
   * `unreachableExports` walks *barrel exports*. A module that publishes nothing to
   * `@o2/core`'s barrel is outside that guard's jurisdiction entirely: every case in this file
   * passes with such a module present and passes with it deleted. That is a strictly worse
   * position than an uncalled barrel export, which at least gets counted — and
   * `.planning/REQUIREMENTS.md`'s CRYPTO-03 names it exactly so: *"real-but-uncounted code"*.
   *
   * The module that made this block exist — `cert-lifecycle.ts`, 775 lines, four facades and
   * three factories — was deleted on 2026-08-24 by owner ruling. The block stayed, because
   * what it measures is the blind spot and not that one module.
   *
   * The predicate is import-based rather than reachability-based on purpose. Reachability from
   * {@link ENTRY_POINTS} answers 33 on this tree and cascades — one unimported module drags its
   * whole subtree in, so the count moves for reasons that are not about the module that moved.
   * *"Nothing imports it"* is local, and it is the property that makes a module uncounted.
   *
   * **The graph's file set is production-only** — measured 2026-08-11 as 157 files, of which
   * zero match `.test.`, so a spec's import of the named module cannot rescue it here. A module
   * whose only importer is a spec reads orphan, which is the intended reading.
   */
  it('names an unimported production module among the modules nothing imports', () => {
    const orphans = orphanModules(graph())
    expect(
      orphans,
      'CRYPTO-03: a module that reaches no barrel is ledgered here, because the guard above ' +
        'cannot see it. If this module gains a production importer, that is wiring landing — ' +
        'repoint this expectation at another module of the same shape and say so, rather than ' +
        'editing around it. The specimen is replaceable; the property is not.',
    ).toContain(UNCOUNTED_MODULE)
    expect(
      orphans.length,
      `${orphans.length} production modules have no production importer, against a ceiling of ` +
        `${ORPHAN_MODULE_CEILING}. A HIGHER number means a new uncounted module arrived: ${orphans.join(', ')}`,
    ).toBeLessThanOrEqual(ORPHAN_MODULE_CEILING)
  }, GRAPH_TIMEOUT_MS)

  it('is a predicate that separates, not one that matches everything', () => {
    // Anti-vacuity, and it is the whole case. A predicate that returned every file would satisfy
    // the `toContain` above perfectly while measuring nothing at all. `capability.ts` is imported
    // by `enrollment.ts` and by the barrel; `ed25519-backend.ts` is imported by `enrollment.ts`
    // (`subtleKeyPairSigner`) and by the barrel — it was `cert-lifecycle.ts` and the barrel until
    // 2026-08-24, and the reading is unchanged because the second importer was always the one
    // doing the work. Both must stay out, and the population must stay well under the corpus.
    //
    // **Watched red, 2026-08-11, not reasoned about.** `!imported.has(file)` was planted to
    // `file !== ''` — the predicate that matches everything — and this case failed with
    // `expected [ …(152) ] to not include 'packages/core/src/capability.ts'` while the ceiling
    // case reported `152 production modules have no production importer, against a ceiling of 27`.
    // The `toContain` above stayed green under that plant, which is exactly why this case is
    // separate from it. Restored by the surgical inverse; `cmp` exit 0.
    const orphans = orphanModules(graph())
    expect(orphans).not.toContain('packages/core/src/capability.ts')
    expect(orphans).not.toContain('packages/core/src/ed25519-backend.ts')
    expect(orphans.length).toBeGreaterThan(0)
    expect(orphans.length).toBeLessThan(graph().files.length / 2)
  }, GRAPH_TIMEOUT_MS)

  /**
   * The owner non-decision, held by a check rather than by a comment.
   *
   * **The price was measured on 2026-08-11, not projected**, which is the correction this case
   * carries: the facades were exported into `packages/core/src/index.ts`, both ceilings set to 0,
   * the guard run, and the exports removed and `cmp`-verified against a pre-plant snapshot. Read
   * within one run — 72 → **79** unreachable callable barrel exports, and 36 → **43** open
   * findings. **The price is +7, not the +12 the barrel's own comment has carried since Plan
   * 28-01**, and the seven are named by the guard: `core/Subject`, `core/Issuer`,
   * `core/Verifier`, `core/Directory`, `core/createSubject`, `core/createIssuer`,
   * `core/createVerifier`.
   *
   * **Re-measured 2026-08-13 on a repaired tracer, by the identical plant: 71 → 78 and
   * 29 → 36.** The base under it moved — `reachability.ts` gained two edge classes — so the
   * figures above describe a population that no longer exists, and a price quoted against a stale
   * base is the failure this whole docblock is a record of. **72 − 1 = 71 and 79 − 1 = 78, and the
   * arithmetic agreeing was refused as the proof**; the numbers below are the ones the guard
   * printed. The price itself is unchanged at +7 and names the same seven symbols, which is worth
   * knowing: the repair recovered nothing in this module.
   *
   * **+7 is a lower bound on the uncounted surface, and the two symbols that make it one were
   * measured too.** `signCertificate` and `deriveKeySeeds` are callable exports of the same
   * module that do **not** become findings, because the graph reports their in-module callers —
   * `#generate`, `#deriveFromPassphrase` and `#issue`, all methods of the unreached facade
   * classes — as reached, so the two functions inherit a reachability their callers do not have
   * in production. That is this guard's known over-connection direction, named in the file
   * docblock above, showing up on a concrete pair. `ARGON2_PARAMS` is the third absentee and is a
   * different reason: a `const` is `other-value`, never `callable`, and was never in
   * jurisdiction — the same arithmetic that made `x509.ts`'s five new exports move the count by
   * two.
   */
  it('reads the uncounted module through a second, independent instrument', () => {
    // **Two instruments on one module, and that is the point of keeping this case.** The block
    // above reads the *import graph*: nothing imports it. This reads the *classified export
    // corpus*: it declares nothing that reaches a barrel. The two answers must agree — a module
    // that published to a barrel would be imported by that barrel and would stop reading orphan
    // — so a defect in either instrument shows up as a disagreement rather than as a silence.
    //
    // > **2026-08-24 — repointed with the block above.** This read `cert-lifecycle.ts` and
    // > carried the price of moving its seven facades onto the barrel: **+7 unreachable callable
    // > exports (71 → 78) and +7 open findings (29 → 36)**, re-measured 2026-08-13. That reading
    // > is preserved here rather than deleted, because it is what made "wiring it" a cost rather
    // > than a tidy-up — and the owner's ruling to delete the module instead was taken with that
    // > number on the record.
    expect(
      barrelExportsDeclaredIn(UNCOUNTED_MODULE).map((one) => `${one.barrel}/${one.name}`).sort(),
      'the uncounted module now declares a barrel export, so the two instruments disagree: the ' +
        'import graph still reads it as orphan. Either wiring landed and this block should be ' +
        're-decided, or one of the two instruments is wrong. Do not edit around the disagreement.',
    ).toEqual([])

    // The other half, and without it the case above is satisfiable by a broken path match. The
    // sibling module IS barrel-exported, so the same predicate must find its five callables.
    //
    // **Watched red, 2026-08-11.** `barrelExportsDeclaredIn`'s suffix was planted to
    // `` `/${file}.PLANTED` `` — a path nothing on disk matches — and this line alone failed,
    // `expected 0 to be greater than or equal to 5`, with the `toEqual([])` above passing
    // vacuously beside it. That is the failure this assertion exists for, observed rather than
    // argued. Restored by the surgical inverse; `cmp` exit 0.
    const sibling = barrelExportsDeclaredIn('packages/core/src/ed25519-backend.ts')
    expect(sibling.filter((one) => one.kind === 'callable').length).toBeGreaterThanOrEqual(5)
  }, GRAPH_TIMEOUT_MS)
})
