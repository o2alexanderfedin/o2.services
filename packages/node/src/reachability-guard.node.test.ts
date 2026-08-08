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
  })

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
  })

  it('names how many entry points were searched, so the reason is checkable', () => {
    const [line] = describeUnreachable([verdict('net', 'someSymbol')])
    expect(line).toContain(`${ENTRY_POINTS.length} entry points`)
  })

  it('renders nothing for an empty verdict list', () => {
    // The other direction. A renderer that emitted a line for everything would satisfy every
    // case above while being useless. `purity.node.test.ts` carries the same pair.
    expect(describeUnreachable([])).toEqual([])
  })

  it('renders a browser finding and a node finding identically', () => {
    // The cardinal rule, asserted rather than trusted: nothing in the verdict or the message
    // keys on node kind. A rule that read differently for `FabricNode` and `BrowserNode` was
    // written once in this repository and retracted at `0314208`.
    const [browser] = describeUnreachable([verdict('browser', 'sameName')])
    const [node] = describeUnreachable([verdict('node', 'sameName')])
    expect(browser?.replace('@o2/browser', 'X').replace('packages/browser/', 'packages/X/')).toBe(
      node?.replace('@o2/node', 'X').replace('packages/node/', 'packages/X/'),
    )
  })
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
  })

  it('finds nothing when the corpus is empty — the failure that reads exactly like success', () => {
    // An empty corpus produces an empty verdict list, which is indistinguishable from a clean
    // tree. It is caught by the floor above, and this case proves the direction: the reading
    // really does collapse to nothing, so the floor is the only thing standing between the guard
    // and a silent pass. `disclosure-gate.node.test.ts` shipped this exact shape once.
    expect(unreachableExports([], graph(), ROOT)).toEqual([])
  })

  it('reports EVERY callable unreachable when the entry set is empty — the loud direction', () => {
    const callable = corpus().filter((one) => one.kind === 'callable')
    const rootless: CallGraph = { ...graph(), roots: [] }
    expect(unreachableExports(corpus(), rootless, ROOT).length).toBe(callable.length)
  })

  it('reports EVERY callable unreachable when the edge set is empty', () => {
    const callable = corpus().filter((one) => one.kind === 'callable')
    const edgeless: CallGraph = { ...graph(), calls: new Map() }
    expect(unreachableExports(corpus(), edgeless, ROOT).length).toBe(callable.length)
  })

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
  })

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
  })

  it('does not report a wired capability unreachable', () => {
    // The known-TRUE side, at guard level rather than only in the tracer's own spec. Each of
    // these is reached by a different edge class, so a regression in any one of them shows up
    // here as a named symbol rather than as a count that moved. Commenting out any of their call
    // sites turns THIS case red — which is the first half of criterion 2.
    const reported = new Set(unreachableExports(corpus(), graph(), ROOT).map((one) => `${one.barrel}/${one.symbol}`))
    for (const wired of ['aot/translationCid', 'node/FabricNode', 'core/submitJob', 'net/reduceJob', 'core/runTaskAndPost']) {
      expect(reported.has(wired), `${wired} is wired and must not be reported unreachable`).toBe(false)
    }
  })

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
  })

  it('separates findings that have callers from findings that have none', () => {
    // The split is the guard's contribution over `requirements-ledger.node.test.ts`, which reads
    // call syntax and would call the first group "called". Both groups are non-empty today, and
    // a collapse of either would mean the caller index stopped being computed.
    const found = unreachableExports(corpus(), graph(), ROOT)
    expect(found.filter((one) => one.callers.length === 0).length).toBeGreaterThan(0)
    expect(found.filter((one) => one.callers.length > 0).length).toBeGreaterThan(0)
  })
})
