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
  unreachableExports,
} from './reachability.ts'
import {
  DISPOSITIONS,
  DISPOSITION_CEILING,
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
 * ## What is deliberately absent
 *
 * No requirement id appears in any title in this file. `acceptance-traceability.node.test.ts`
 * counts a title naming an id as strong traceability, and manufacturing that from a guard which
 * asserts nothing about WIRE-02's *behaviour* would corrupt its measurement.
 * `requirements-ledger.node.test.ts` makes the same choice for the same reason.
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
    for (const wired of ['aot/translationCid', 'node/FabricNode', 'core/submitJob', 'net/reduceJob', 'core/runTaskAndPost']) {
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
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(
      found.length,
      `the guard found ${found.length} unreachable callable barrel exports; the reading recorded ` +
        'on 2026-08-11 was 74. A HIGHER number means a new exported-but-uncalled symbol arrived — ' +
        `run the guard and read the list. A LOWER number is wiring work landing and the ceiling ` +
        'should be lowered to match it, which is 22-03\'s register rather than an edit here.',
    ).toBeLessThanOrEqual(74)
  }, GRAPH_TIMEOUT_MS)

  it('separates findings that have callers from findings that have none', () => {
    // The split is the guard's contribution over `requirements-ledger.node.test.ts`, which reads
    // call syntax and would call the first group "called". Both groups are non-empty today, and
    // a collapse of either would mean the caller index stopped being computed.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(found.filter((one) => one.callers.length === 0).length).toBeGreaterThan(0)
    expect(found.filter((one) => one.callers.length > 0).length).toBeGreaterThan(0)
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
