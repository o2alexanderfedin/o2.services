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
  OPEN_FINDING_CEILING,
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
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(
      found.length,
      `the guard found ${found.length} unreachable callable barrel exports; the reading recorded ` +
        'on 2026-08-14 was 66. A HIGHER number means a new exported-but-uncalled symbol arrived — ' +
        `run the guard and read the list. A LOWER number is wiring work landing and the ceiling ` +
        'should be lowered to match it, which is 22-03\'s register rather than an edit here.',
    ).toBeLessThanOrEqual(66)
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

  it('reports the residue as open findings and holds it still', () => {
    // **Criterion 1 does not pass clean on this tree, and this case is where that is said.**
    // 37 callable barrel exports have no production caller at all, in a milestone named "Wire
    // What Was Built". They are not disposed — the owner ruled on 2026-08-08 that only symbols
    // with a stated cause get an entry — so they sit here, counted, named on demand, and unable
    // to grow while nobody is looking. Lowering this number is the work.
    //
    // This figure has now drifted twice and the history is kept because a ceiling nobody can
    // audit is a ceiling nobody will lower. It said "47" written against a residue of 47, went
    // stale when Plan 25-02 raised `OPEN_FINDING_CEILING` to 49, said nothing because it is a
    // comment, and then read true again by coincidence when Phase 28's merge measured the
    // residue back to 47 — see `reachability-dispositions.ts`'s 49 → 47 note for why that
    // agreement was refused as evidence.
    //
    // **47 → 37, measured 2026-08-10, and this one is a reclassification rather than a
    // lowering**: the ten symbols the derived `global-object-hop` case above recovered have real
    // production callers behind the `window.o2` hop, so counting them as "no production caller
    // at all" over-reported the residue. Nothing was wired. The owner's ruling to hold the
    // residue is untouched — what the count is *of* changed, not how hard it is held.
    const disposed = disposedKeys()
    const open = unreachableExports(corpus(), graph(), ROOT)
      .map((one) => `${one.barrel}/${one.symbol}`)
      .filter((key) => !disposed.has(key))
    expect(
      open.length,
      `${open.length} unreachable callable barrel exports carry no disposition, against a ` +
        `ceiling of ${OPEN_FINDING_CEILING}. A HIGHER number means a new one arrived: ${open.join(', ')}`,
    ).toBeLessThanOrEqual(OPEN_FINDING_CEILING)
  }, GRAPH_TIMEOUT_MS)

  it('renders an open finding as a sentence naming the symbol and the barrel', () => {
    // The register does not change the message contract — an open finding reads exactly like any
    // other, so a reader picking one up gets the same sentence whether or not a sibling is disposed.
    const disposed = disposedKeys()
    const open = unreachableExports(corpus(), graph(), ROOT).filter(
      (one) => !disposed.has(`${one.barrel}/${one.symbol}`),
    )
    expect(open.length).toBeGreaterThan(0)
    const [line] = describeUnreachable(open)
    const first = open[0]
    if (first === undefined || line === undefined) return
    expect(line).toContain(first.symbol)
    expect(line).toContain(`@o2/${first.barrel}`)
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
const ORPHAN_MODULE_CEILING = 27

/**
 * The certificate-lifecycle module, by path — CRYPTO-03's whole subject.
 *
 * It is here rather than in the open-findings list because it reaches **no barrel at all**, and
 * the guard above walks barrel exports. That is the blind spot this block closes.
 */
const CERT_LIFECYCLE = 'packages/core/src/cert-lifecycle.ts'

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
   * `unreachableExports` walks *barrel exports*. `cert-lifecycle.ts` publishes nothing to
   * `@o2/core`'s barrel, so its 775 lines, four facades and three factories are outside that
   * guard's jurisdiction entirely: every case in this file passes with the module present and
   * passes with it deleted. That is a strictly worse position than an uncalled barrel export,
   * which at least gets counted — and `.planning/REQUIREMENTS.md`'s CRYPTO-03 names it exactly
   * so: *"real-but-uncounted code"*.
   *
   * The predicate is import-based rather than reachability-based on purpose. Reachability from
   * {@link ENTRY_POINTS} answers 33 on this tree and cascades — one unimported module drags its
   * whole subtree in, so the count moves for reasons that are not about the module that moved.
   * *"Nothing imports it"* is local, and it is the property that makes a module uncounted.
   *
   * **The graph's file set is production-only** — measured 2026-08-11 as 157 files, of which
   * zero match `.test.`, so no spec's import of `cert-lifecycle.ts` can rescue it here. Its one
   * importer in the repository *is* a spec, which is precisely why it reads orphan.
   */
  it('names cert-lifecycle.ts among the modules nothing imports', () => {
    const orphans = orphanModules(graph())
    expect(
      orphans,
      'CRYPTO-03: the certificate-lifecycle facades are ledgered here because they reach no ' +
        'barrel. If this module gains a production importer, that is wiring landing — delete ' +
        'this expectation and re-decide the row rather than editing around it.',
    ).toContain(CERT_LIFECYCLE)
    expect(
      orphans.length,
      `${orphans.length} production modules have no production importer, against a ceiling of ` +
        `${ORPHAN_MODULE_CEILING}. A HIGHER number means a new uncounted module arrived: ${orphans.join(', ')}`,
    ).toBeLessThanOrEqual(ORPHAN_MODULE_CEILING)
  }, GRAPH_TIMEOUT_MS)

  it('is a predicate that separates, not one that matches everything', () => {
    // Anti-vacuity, and it is the whole case. A predicate that returned every file would satisfy
    // the `toContain` above perfectly while measuring nothing at all. `capability.ts` is imported
    // by `enrollment.ts` and by the barrel; `ed25519-backend.ts` is imported by `cert-lifecycle.ts`
    // and by the barrel. Both must stay out, and the population must stay well under the corpus.
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
  it('holds the certificate-lifecycle facades off the barrel, at a measured price', () => {
    expect(
      barrelExportsDeclaredIn(CERT_LIFECYCLE).map((one) => `${one.barrel}/${one.name}`).sort(),
      'the certificate-lifecycle facades are on a barrel. Re-measured 2026-08-13, that costs +7 ' +
        'unreachable callable exports (71 → 78) and +7 open findings (29 → 36), and it takes an ' +
        'owner non-decision by side effect. Both ceilings must move with it, and the reason goes ' +
        'in REQUIREMENTS.md CRYPTO-03 rather than here.',
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
