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
 * run looks like. It is caught by requiring `demo/estimatePi` — which nothing anywhere calls — to
 * stay unreachable. If that symbol is ever reported reachable, this guard has stopped guarding
 * and every green run below is worthless.
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
    // green run looks like. `demo/estimatePi` is called by nothing anywhere in the tree — checked
    // by grep independently of this instrument — so a graph that reaches it is over-connected and
    // every other verdict here is worthless.
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
    // Sited at **67**, measured 2026-08-08 with Phases 20, 21, 23 and 24 landed. It read 58 for
    // about an hour, until PLANT A AT `FabricNode.start` failed to redden anything and exposed
    // that type annotations were being counted as call paths; excluding type positions moved it
    // to 67. The earlier figure is recorded because a ceiling whose history is invisible is a
    // ceiling nobody can audit.
    // The ceiling is an equality-ish bound on purpose and it is the crude form of what 22-03
    // replaces it with: a per-symbol register with a reason for each. Until that lands, this is
    // the only thing standing between the guard and a new dead export arriving unnoticed.
    // 19-12's finding is the reason it is asserted rather than commented: the mutation ledger's
    // floor sat stale at 23 against a ledger of 42, and nothing said so.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(
      found.length,
      `the guard found ${found.length} unreachable callable barrel exports; the reading recorded ` +
        'on 2026-08-08 was 67. A HIGHER number means a new exported-but-uncalled symbol arrived — ' +
        `run the guard and read the list. A LOWER number is wiring work landing and the ceiling ` +
        'should be lowered to match it, which is 22-03\'s register rather than an edit here.',
    ).toBeLessThanOrEqual(67)
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
    // 47 callable barrel exports have no production caller at all, in a milestone named "Wire
    // What Was Built". They are not disposed — the owner ruled on 2026-08-08 that only symbols
    // with a stated cause get an entry — so they sit here, counted, named on demand, and unable
    // to grow while nobody is looking. Lowering this number is the work.
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
