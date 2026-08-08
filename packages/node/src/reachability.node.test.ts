import { mkdtempSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SymbolFlags } from 'typescript/unstable/sync'
import { describe, expect, it } from 'vitest'
import {
  type CallGraph,
  type ClassifiedExport,
  ENTRY_POINTS,
  type ExportFacts,
  barrelExports,
  barrelNameOf,
  barrelPathsIn,
  buildCallGraph,
  callableConstsIn,
  censusOf,
  classify,
  classifyAll,
  fileOf,
  nodeId,
  reachableFrom,
  resolveSpecifier,
  typescriptVersionIn,
} from './reachability.ts'

/**
 * Plan 22-01 Task 1 — the corpus, and proof that the thing counting it can fail.
 *
 * ## This file asserts nothing about whether the tree is wired
 *
 * Every verdict below is a name and a classification. A green run here is **not** evidence that
 * any capability is reachable, and the summary for this plan may not read it that way. The
 * reachability question is Task 2's; the resolving power that stops it being a tautology is
 * Task 3's.
 *
 * ## Why the floors are floors
 *
 * `purity.node.test.ts` and `acceptance-traceability.node.test.ts` both pin corpus size the same
 * way, for the same reason: a floor catches a collapse, an equality freezes a count that
 * legitimately grows. Every number here was **re-measured on 2026-08-08** rather than inherited —
 * `22-01-PLAN.md`'s `<interfaces>` block recorded 209 callable / 581 total / 869 files from
 * 2026-08-04, and Phases 20, 21 and 23 landed in between. The tree now reads 217 / 604 / 907.
 * The plan anticipated exactly this: it calls its own block *"a starting point, not an
 * authority"*. Following its instruction rather than its figures is the point.
 *
 * ## Four ways this instrument could produce a clean answer while broken
 *
 * The barrel enumeration returns nothing; the classifier stops classifying; alias resolution
 * silently drops out; or the API contract shifts under an import path that says `unstable`. Each
 * gets its own case in the last describe block, and two of them were additionally proved by
 * planting the source and watching it redden — recorded in `22-01-SUMMARY.md`, because a green
 * you did not watch fail is worth less than a gap you reported.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The TypeScript this file's whole API contract was measured against.
 *
 * `typescript` is pinned exactly (no caret) in the root `package.json`, and on 2026-08-08 that
 * pin became load-bearing for a guard: `openProjects` accepting a bare path string, `program`
 * and `checker` being fields rather than getters, and `SymbolFlags.Type` overlapping
 * `SymbolFlags.Class` are all measured facts about this version behind an import path that says
 * `unstable`. Asserted here rather than enforced by editing `package.json`, which is contended.
 */
const MEASURED_TS_VERSION = '7.0.2'

/**
 * Callable exports per barrel, measured 2026-08-08 — **floors**.
 *
 * Sited against: `feature/phase-18-discovery-capacity-placement` at `822b072`, with Phases 20,
 * 21, 23 and 24 landed and Phase 22 unbuilt.
 *
 * ## `node` re-sited 16 → 15 and 42 → 41, 2026-08-08, and how it went unnoticed
 *
 * `36c2800` deleted `hasSeed` to close audit finding G12 — zero callers, zero tests, a
 * deliberate removal — and did not move these two floors with it. A floor is a claim about the
 * tree, so a legitimate deletion lowers it; what is *not* legitimate is leaving it stale, which
 * turns a real guard into a red that the next person is tempted to widen.
 *
 * **It survived six commits because this spec is excluded from the fast loop.** It measures
 * ~6 s, so `MEASURED_NODE_SPANS` puts it past `SLOW_CUTOFF_MS` and `npm run test:unit` does not
 * run it; the `reachability` entry among the pre-commit cheap guards is
 * `reachability-guard.node.test.ts`, a different file that asserts nothing about these census
 * figures. So six green `test:unit` runs and six green commit hooks all reported success over a
 * failing spec. **That is the cost of the exclusion, recorded here rather than in a postmortem**
 * — and it is the argument for running `--project node` in full before believing a milestone is
 * clean, which is how this was actually caught.
 *
 * The aggregate floors below did **not** move, and that is a reading rather than an oversight:
 * `CALLABLE_TOTAL_FLOOR` still passes, so the one symbol `node` lost was offset elsewhere in the
 * corpus. Only the per-barrel claim was falsified, which is exactly what a per-barrel floor is
 * for.
 */
const CALLABLE_FLOOR: Readonly<Record<string, number>> = {
  aot: 13,
  bench: 18,
  browser: 25,
  core: 88,
  demo: 16,
  libp2p: 9,
  net: 32,
  // 16 until 2026-08-08; `hasSeed` deleted at `36c2800` (finding G12). See the note above.
  node: 15,
}

/** Total exports per barrel, same run, same siting — also floors. */
const TOTAL_FLOOR: Readonly<Record<string, number>> = {
  aot: 39,
  bench: 49,
  browser: 75,
  core: 252,
  demo: 40,
  libp2p: 29,
  net: 78,
  // 42 until 2026-08-08, same deletion, same commit.
  node: 41,
}

const CALLABLE_TOTAL_FLOOR = 217
const EXPORT_TOTAL_FLOOR = 604

/**
 * Type-only exports, count-pinned as a floor.
 *
 * The pin's purpose is **not** to police type deletion — it is that a flags predicate which
 * stopped classifying would send this to zero while every other count still looked like a count,
 * emptying the jurisdiction with the guard reading clean. If a real refactor ever drives this
 * below the floor, that is a finding to look at, not a number to quietly lower.
 */
const TYPE_ONLY_FLOOR = 276

/** The one real load, shared: the API is cheap but not free, and eight barrels is eight barrels. */
let cached: ClassifiedExport[] | undefined
function corpus(): ClassifiedExport[] {
  cached ??= barrelExports()
  return cached
}

/** A planted export, so the classifier and the census can be driven without touching disk. */
function planted(barrel: string, name: string, flags: number): ExportFacts {
  return { barrel, name, flags, declaredIn: `planted/${name}.ts` }
}

describe('the corpus: every callable export the eight barrels publish', () => {
  it('discovers the barrels from disk rather than from a list written here', () => {
    const paths = barrelPathsIn(join(ROOT, 'packages'))
    // A floor, not an equality: a ninth package must enter jurisdiction without an edit here.
    expect(paths.length).toBeGreaterThanOrEqual(8)
    for (const path of paths) expect(path.endsWith('/src/index.ts')).toBe(true)
    // And every package the floors name must be among them, by name — a barrel that moved has
    // to fail saying which, rather than contributing nothing to an unchanged total.
    const found = paths.map(barrelNameOf)
    for (const barrel of Object.keys(CALLABLE_FLOOR)) {
      expect(found, `@o2/${barrel} publishes no src/index.ts`).toContain(barrel)
    }
  })

  it('counts callable exports per package at or above the measured floor', () => {
    const census = censusOf(corpus())
    for (const [barrel, floor] of Object.entries(CALLABLE_FLOOR)) {
      const row = census.find((one) => one.barrel === barrel)
      expect(row, `no exports at all were read for @o2/${barrel}`).toBeDefined()
      expect(
        row?.callable ?? 0,
        `@o2/${barrel} published ${row?.callable ?? 0} callable exports, floor ${floor}`,
      ).toBeGreaterThanOrEqual(floor)
    }
  })

  it('counts total exports per package at or above the measured floor', () => {
    const census = censusOf(corpus())
    for (const [barrel, floor] of Object.entries(TOTAL_FLOOR)) {
      const row = census.find((one) => one.barrel === barrel)
      expect(row, `no exports at all were read for @o2/${barrel}`).toBeDefined()
      expect(
        row?.total ?? 0,
        `@o2/${barrel} published ${row?.total ?? 0} exports, floor ${floor}`,
      ).toBeGreaterThanOrEqual(floor)
    }
  })

  it('states the type-only exclusion at the line and pins its size', () => {
    const all = corpus()
    const typeOnly = all.filter((one) => one.kind === 'type-only')
    const callable = all.filter((one) => one.kind === 'callable')

    // The exclusion, said out loud: a type has no call path by construction, so it is outside
    // this guard's jurisdiction. That is 276 of 604 today — a plurality, not a rounding error,
    // which is why silently losing the classification would be catastrophic and invisible.
    expect(typeOnly.length).toBeGreaterThanOrEqual(TYPE_ONLY_FLOOR)
    expect(callable.length).toBeGreaterThanOrEqual(CALLABLE_TOTAL_FLOOR)
    expect(all.length).toBeGreaterThanOrEqual(EXPORT_TOTAL_FLOOR)

    // The three kinds partition the corpus. A fourth bucket appearing, or one emptying, would
    // otherwise leave the three floors above individually satisfiable.
    const other = all.filter((one) => one.kind === 'other-value')
    expect(typeOnly.length + callable.length + other.length).toBe(all.length)
    expect(other.length).toBeGreaterThan(0)
  })

  it('resolves every export to a declaring file', () => {
    // `declaredIn` is what Task 2's graph keys its nodes on. An empty string here is a symbol
    // the tracer could never place, and it would silently read as unreachable forever.
    const homeless = corpus()
      .filter((one) => one.declaredIn === '')
      .map((one) => `${one.barrel}/${one.name}`)
    expect(homeless).toEqual([])
  })

  it('names five entry-point modules that exist on disk', () => {
    // Task 2 roots its graph here. A typo in one of these paths would silently remove a root
    // and turn a large part of the tree unreachable, which reads exactly like a real finding.
    expect(ENTRY_POINTS.length).toBe(5)
    for (const entry of ENTRY_POINTS) {
      expect(existsSync(join(ROOT, entry)), `${entry} is named as an entry point but is not on disk`).toBe(true)
    }
  })
})

describe('the instrument can fail — proved against planted input, not assumed', () => {
  /**
   * Everything above is a floor, and a floor is satisfied by any large number. These cases drive
   * the pieces directly, because `purity.node.test.ts`'s reasoning applies verbatim: a count that
   * came back right for the wrong reason reads exactly like a count that came back right.
   */

  it('reports an empty corpus for a packages directory holding no barrel', () => {
    // The loud direction, and the one a floor is supposed to catch. `barrelExports` takes its
    // discovery root as an option precisely so this is reachable without mutating the source.
    const empty = mkdtempSync(join(tmpdir(), 'o2-reachability-'))
    const found = barrelExports({ packagesDir: empty })
    expect(found).toEqual([])
    expect(censusOf(found)).toEqual([])
  })

  it('throws rather than returning nothing when the discovery root is gone', () => {
    // `readdirSync` throwing is the wanted behaviour, not an inconvenience: a scanned root that
    // has been moved must fail by name rather than contribute zero and let the floors carry an
    // unchanged assertion. Same reasoning as `sourceFiles` in `purity.node.test.ts`.
    expect(() => barrelPathsIn(join(ROOT, 'packages-that-do-not-exist'))).toThrow()
  })

  it('classifies a type-only barrel as zero callable, and moves when given a callable', () => {
    // Two directions in one case, deliberately. A predicate that answered "callable" for
    // everything would satisfy the second half alone; one that answered "type-only" for
    // everything would satisfy the first.
    const typesOnly = classifyAll([
      planted('planted', 'Alpha', SymbolFlags.Interface),
      planted('planted', 'Beta', SymbolFlags.TypeAlias),
      planted('planted', 'Gamma', SymbolFlags.TypeAlias),
    ])
    const before = censusOf(typesOnly)[0]
    expect(before?.callable).toBe(0)
    expect(before?.typeOnly).toBe(3)

    const withOne = classifyAll([
      ...typesOnly,
      planted('planted', 'run', SymbolFlags.Function),
    ])
    const after = censusOf(withOne)[0]
    expect(after?.callable).toBe(1)
    expect(after?.typeOnly).toBe(3)
  })

  it('classifies a class as callable even though it also matches the type mask', () => {
    // `SymbolFlags.Type` is a composite that INCLUDES `Class`, so `classify`'s two tests are
    // ordered rather than exclusive. Asserted rather than trusted, because swapping the two
    // branches is a one-line edit that moves every exported class out of jurisdiction while
    // leaving the total export count untouched — a collapse no total-based floor would see.
    expect(SymbolFlags.Type & SymbolFlags.Class).not.toBe(0)
    expect(classify(planted('planted', 'FabricNode', SymbolFlags.Class))).toBe('callable')
    expect(classify(planted('planted', 'runTask', SymbolFlags.Function))).toBe('callable')
    expect(classify(planted('planted', 'start', SymbolFlags.Method))).toBe('callable')
    expect(classify(planted('planted', 'JobSpec', SymbolFlags.Interface))).toBe('type-only')
    expect(classify(planted('planted', 'NodeId', SymbolFlags.TypeAlias))).toBe('type-only')
    // The third bucket is real and is not a dumping ground for the unclassifiable: a `const`
    // export is a value with no call path this predicate can see, which is a different fact
    // from "it is a type".
    expect(classify(planted('planted', 'DEFAULTS', SymbolFlags.BlockScopedVariable))).toBe('other-value')
  })

  it('alias resolution changes the reading, and by how much', () => {
    // The step is load-bearing and this case is what makes saying so honest. A barrel entry's
    // own flags are `Alias`, which matches neither mask, so WITHOUT resolution every export in
    // the tree lands in `other-value` — the jurisdiction empties while the total stays exactly
    // right, which is the silent failure this whole describe block exists for.
    const resolved = corpus()
    const unresolved = barrelExports({ resolveAliases: false })

    expect(unresolved.length).toBe(resolved.length)
    const resolvedCallable = resolved.filter((one) => one.kind === 'callable').length
    const unresolvedCallable = unresolved.filter((one) => one.kind === 'callable').length

    // Recorded as a comparative reading inside one run rather than as two absolutes: the two
    // arms read the same barrels through the same loader and differ in exactly one step.
    expect(
      resolvedCallable - unresolvedCallable,
      `alias resolution moved ${resolvedCallable - unresolvedCallable} exports into "callable" ` +
        `(${unresolvedCallable} without it, ${resolvedCallable} with it)`,
    ).toBeGreaterThan(100)
  })

  it('the callable-const understatement is one named symbol', () => {
    // `classify` reads declaration flags, so `export const f = () => {}` is `other-value`
    // despite being callable. The honest thing is to measure the size of that gap rather than
    // describe it, and to let the measurement redden if it grows: a docblock claiming "only one"
    // is a claim with an expiry date, which is the exact class of defect this repository keeps
    // finding in its own prose.
    const hidden = callableConstsIn()
    expect(hidden).toEqual(['core/fabricCombiner'])
  })

  it('asserts the TypeScript version its API contract was measured against', () => {
    // Plant target: change MEASURED_TS_VERSION by one patch digit and this must redden naming
    // both versions. A message reading only "expected true to be false" would leave a reader
    // grepping for which of the six API claims had moved.
    const installed = typescriptVersionIn(ROOT)
    expect(
      installed,
      `this instrument's API contract was measured against typescript ${MEASURED_TS_VERSION}, ` +
        `but ${installed} is installed — re-verify openProjects, program/checker and SymbolFlags ` +
        'before trusting any count in this file',
    ).toBe(MEASURED_TS_VERSION)
  })

  it('refuses to read past a snapshot that did not open exactly one project', () => {
    // The worst failure available to this instrument, and the one the plan says to stop on: a
    // silent empty snapshot is indistinguishable from a clean tree. Driven here by pointing the
    // loader at a root with no tsconfig.json, which is the same shape as the contract shifting.
    const nowhere = mkdtempSync(join(tmpdir(), 'o2-reachability-noconfig-'))
    expect(() => barrelExports({ root: nowhere, packagesDir: join(ROOT, 'packages') })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Task 2 — the call graph
// ---------------------------------------------------------------------------

/**
 * Graph shape, measured 2026-08-08 at `fa9820c` — floors, for the reason the corpus floors are.
 *
 * `files` is walked from disk rather than read off `program.getSourceFileNames()`, and that is
 * not a style choice: the program's file list **grows lazily** as more files are touched — the
 * same call returned 907 and then 963 within one session. A corpus that changes size depending
 * on what you looked at first cannot carry a floor.
 */
const FILE_FLOOR = 139
const NODE_FLOOR = 1800
const CALLER_FLOOR = 690

/** Anchors that must be REACHED, each chosen for a different edge class. Re-measured 2026-08-08. */
const KNOWN_TRUE: readonly (readonly [string, string])[] = [
  ['node', 'FabricNode'], // member-expression entry from bin/agent.ts
  ['core', 'submitJob'],
  ['net', 'reduceJob'], // called from bin/bench.ts
  ['core', 'runTaskAndPost'], // through the worker edges
  ['aot', 'translationCid'], // through tools/aot/lift.ts
  ['core', 'MemoryNetwork'], // through a FUNCTION REFERENCE — see the reference-edge case
]

/**
 * Anchors that must be unreached — and **`core/delegate` is deliberately not among them**.
 *
 * The plan named `delegate` as its known-FALSE anchor, on the reading that its only callers sat
 * in `capability-fixture.ts`, which no entry point imports. **That has changed sides**, exactly
 * as the plan warned it might: `bin/bench.ts` now calls it at module scope, so it is reachable
 * from an entry point without passing through anything. Phase 23 criterion 5 delivered that, and
 * the plan's own instruction is that a moved anchor is *a finding to report, not an assertion to
 * quietly adjust*. It is reported in `22-01-SUMMARY.md` and asserted below in its new direction.
 *
 * Both replacements were verified **independently of this instrument**, by grepping the tree for
 * call sites: neither has one anywhere outside a spec.
 */
const KNOWN_FALSE: readonly (readonly [string, string])[] = [
  ['demo', 'estimatePi'],
  ['demo', 'piErrorBound'],
]

let graphCache: CallGraph | undefined
function graph(): CallGraph {
  graphCache ??= buildCallGraph()
  return graphCache
}

/**
 * How many callable barrel exports one graph reports unreached.
 *
 * A **comparative** reading by construction: every ablation below asserts this against the
 * baseline taken in the same run, never against an absolute. An absolute would encode the tree
 * on the day it was written, which is exactly what 22-01's own stale corpus numbers demonstrate.
 */
function unreachedCount(built: CallGraph): number {
  const reached = reachableFrom(built.calls, built.roots)
  let count = 0
  for (const one of corpus()) {
    if (one.kind !== 'callable') continue
    if (!reached.has(nodeId(relativeToRoot(one.declaredIn), one.name))) count += 1
  }
  return count
}

/** A barrel export's declaration node id, or `undefined` if it is not a callable export. */
function nodeFor(barrel: string, name: string): string | undefined {
  const found = corpus().find(
    (one) => one.barrel === barrel && one.name === name && one.kind === 'callable',
  )
  if (found === undefined) return undefined
  return nodeId(relativeToRoot(found.declaredIn), name)
}

/**
 * The API hands back lowercased absolute paths; the graph keys on disk-cased repo-relative ones.
 * Kept here as one expression so the spec compares the same way the module does.
 */
function relativeToRoot(absolute: string): string {
  const base = ROOT.endsWith('/') ? ROOT : `${ROOT}/`
  return absolute.toLowerCase().startsWith(base.toLowerCase()) ? absolute.slice(base.length) : absolute
}

describe('the call graph: a path through functions, not through modules', () => {
  it('walks the production corpus and finds declarations and callers', () => {
    const built = graph()
    expect(built.files.length).toBeGreaterThanOrEqual(FILE_FLOOR)
    expect(built.nodes.size).toBeGreaterThanOrEqual(NODE_FLOOR)
    expect(built.calls.size).toBeGreaterThanOrEqual(CALLER_FLOOR)
    expect(built.roots.length).toBe(5)
    // Specs are outside the graph on purpose: a test calling something does not make it
    // entry-point reachable, and counting it would make this whole file vacuous.
    expect(built.files.filter((file) => file.endsWith('.test.ts'))).toEqual([])
  })

  it('reports every known-TRUE anchor reachable', () => {
    const reached = reachableFrom(graph().calls, graph().roots)
    for (const [barrel, name] of KNOWN_TRUE) {
      const id = nodeFor(barrel, name)
      expect(id, `${barrel}/${name} is not a callable barrel export any more`).toBeDefined()
      expect(reached.has(id ?? ''), `${barrel}/${name} (${id ?? '?'}) should be reachable`).toBe(true)
    }
  })

  it('reports every known-FALSE anchor unreachable', () => {
    const reached = reachableFrom(graph().calls, graph().roots)
    for (const [barrel, name] of KNOWN_FALSE) {
      const id = nodeFor(barrel, name)
      expect(id, `${barrel}/${name} is not a callable barrel export any more`).toBeDefined()
      expect(reached.has(id ?? ''), `${barrel}/${name} (${id ?? '?'}) should NOT be reachable`).toBe(false)
    }
  })

  it('records that core/delegate changed sides, rather than adjusting around it', () => {
    // The plan's known-FALSE anchor, asserted in the direction the tree now supports. If this
    // ever flips back, that is a Phase 23 regression and it must be loud rather than absorbed.
    const reached = reachableFrom(graph().calls, graph().roots)
    const id = nodeFor('core', 'delegate')
    expect(id).toBe('packages/core/src/capability.ts#delegate')
    expect(
      reached.has(id ?? ''),
      'core/delegate was the plan\'s known-FALSE anchor and is now reachable from bin/bench.ts ' +
        'at module scope — Phase 23 criterion 5 delivered that. A flip back is a regression.',
    ).toBe(true)
  })

  it('separates a declaration from its module — estimatePi, both halves in one case', () => {
    // THE case that decides granularity. If the declaration half ever reports reached, the
    // tracer has degraded to module granularity and Task 3's reading becomes a tautology.
    const built = graph()
    const reached = reachableFrom(built.calls, built.roots)
    const modules = reachableFrom(built.imports, built.roots.map(fileOf))

    const id = nodeFor('demo', 'estimatePi')
    expect(id).toBe('packages/demo/src/pi.ts#estimatePi')
    expect(reached.has(id ?? ''), 'estimatePi is called by nothing and must read unreached').toBe(false)
    expect(
      modules.has('packages/demo/src/pi.ts'),
      'pi.ts must be a reachable MODULE — without that half this case proves nothing',
    ).toBe(true)
  })

  it('pins the declarations merged by sharing a file and a name', () => {
    // Merging can only ever over-connect, so it is bounded and named rather than left to grow.
    const built = graph()
    expect(built.collisions.length).toBeLessThanOrEqual(12)
    expect(built.collisions).toContain('packages/core/src/discovery.ts#providers')
  })
})

describe('each edge class is load-bearing — one ablation per class', () => {
  /**
   * A single "disable everything" plant proves only that the graph exists. Each class is turned
   * off on its own and required to flip **its own** anchor while leaving the others alone, which
   * is the only arrangement that says the classes are independent rather than jointly decorative.
   *
   * ## Every case here carries {@link ABLATION_TIMEOUT_MS}, added 2026-08-08
   *
   * **Found by running `--project node` in full, which nothing in the fast loop does.** The
   * heaviest case below — the one that builds the graph four times — took **6 350 ms against the
   * 5 000 ms default** under full-suite contention and failed as `Test timed out in 5000ms`. Alone
   * it fits, which is exactly what made it invisible: `test:unit` excludes this file for being
   * slow, so the only run that exercises it is the one nobody does before committing.
   *
   * **The timeout is on every case in the block, not only the one that failed.** Each constructs
   * at least one fresh `buildCallGraph`, so they differ from the failing case in degree and not
   * in kind; fixing the single observed red would leave four cases sitting at the same cliff and
   * would turn the next contended run into the same investigation. Sizing is deliberate: this is
   * **not** a measurement of how long the work takes, it is headroom against a machine doing
   * fourteen other things, which is the distinction `CLAUDE.md` draws between measuring the
   * process and measuring the machine. A case that genuinely regresses will blow through 60 s.
   */
  const ABLATION_TIMEOUT_MS = 60_000
  const MEMBER_OBJECT = 'packages/node/src/fabric-node.ts#FabricNode'
  const MEMBER_METHOD = 'packages/node/src/fabric-node.ts#start'
  const VITE_WORKER = 'packages/browser/src/task-executor.worker.ts#<module>'
  const URL_WORKER = 'packages/node/src/task-executor.worker-thread.ts#<module>'

  it('member-expression: the METHOD half of FabricNode.start goes unreachable', () => {
    // `FabricNode.start(…)` contributes two edges from two different classes, and the split is
    // the finding: the OBJECT half (`FabricNode`) is an ordinary value reference, while the
    // METHOD half (`start`) exists only because this class reads property access. So the anchor
    // is the method, not the class — asserting the class here would have been satisfied by the
    // reference class and proved nothing.
    const off = buildCallGraph({ memberEdges: false })
    const reachedOff = reachableFrom(off.calls, off.roots)
    expect(reachedOff.has(MEMBER_METHOD)).toBe(false)
    expect(reachedOff.has(MEMBER_OBJECT)).toBe(true)
    // The other classes' anchors are untouched — that is what makes this ablation this class's.
    expect(reachedOff.has(VITE_WORKER)).toBe(true)
    expect(reachedOff.has(URL_WORKER)).toBe(true)
  }, ABLATION_TIMEOUT_MS)

  it('measures what member-expression is worth when references are not there to cover it', () => {
    // Measured, and it corrects the plan. 22-01 attributes most of the naive tracer's 102 false
    // findings to this one missing class — true of a tracer with NO reference edges, and false
    // of this one: with references present, dropping member edges changes **no** barrel verdict,
    // because a class named in `X.y()` is already referenced by name. The class holds its place
    // on the METHOD edge above and on this comparison, not on the headline count.
    const withoutReferences = unreachedCount(buildCallGraph({ referenceEdges: false }))
    const withoutEither = unreachedCount(buildCallGraph({ referenceEdges: false, memberEdges: false }))
    expect(withoutEither).toBeGreaterThan(withoutReferences + 40)
    // And the honest other half of that sentence, asserted so it cannot rot into folklore:
    expect(unreachedCount(buildCallGraph({ memberEdges: false }))).toBe(unreachedCount(graph()))
  }, ABLATION_TIMEOUT_MS)

  it('Vite ?worker: the browser worker module goes unreachable and nothing else does', () => {
    const off = buildCallGraph({ viteWorkerEdges: false })
    const reachedOff = reachableFrom(off.calls, off.roots)
    expect(reachedOff.has(VITE_WORKER)).toBe(false)
    expect(reachedOff.has(URL_WORKER)).toBe(true)
    expect(reachedOff.has(MEMBER_METHOD)).toBe(true)
  }, ABLATION_TIMEOUT_MS)

  it('new URL worker entry: the Node worker module goes unreachable and nothing else does', () => {
    const off = buildCallGraph({ urlWorkerEdges: false })
    const reachedOff = reachableFrom(off.calls, off.roots)
    expect(reachedOff.has(URL_WORKER)).toBe(false)
    expect(reachedOff.has(VITE_WORKER)).toBe(true)
    expect(reachedOff.has(MEMBER_METHOD)).toBe(true)
  }, ABLATION_TIMEOUT_MS)

  it('static import: both worker modules go unreachable, the member entry does not', () => {
    const off = buildCallGraph({ importEdges: false })
    const reachedOff = reachableFrom(off.calls, off.roots)
    expect(reachedOff.has(VITE_WORKER)).toBe(false)
    expect(reachedOff.has(URL_WORKER)).toBe(false)
    // `FabricNode.start` survives because callees are resolved through the CHECKER, not by
    // following imports — which is also why a barrel never appears as a caller.
    expect(reachedOff.has(MEMBER_METHOD)).toBe(true)
  }, ABLATION_TIMEOUT_MS)

  it('function references: MemoryNetwork needs them, estimatePi must not', () => {
    // The fifth class, added after measurement rather than from the plan. `bin/bench.ts` writes
    // `runnerFor(memoryFabric)` — a function handed over rather than called — and without this
    // class `MemoryNetwork` reads unreached while a real benchmark constructs one every run.
    // That is an UNDER-connection, and it manufactures findings that are not real.
    const off = buildCallGraph({ referenceEdges: false })
    const reachedOff = reachableFrom(off.calls, off.roots)
    expect(reachedOff.has('packages/core/src/transport/memory.ts#MemoryNetwork')).toBe(false)
    expect(unreachedCount(off)).toBeGreaterThan(unreachedCount(graph()))

    // The other direction, and it is the one that keeps this class from becoming the 54-answer:
    // a barrel's `export { estimatePi } from …` names the symbol without using it, so import and
    // export statements contribute no reference edges. Without that exclusion `estimatePi` reads
    // REACHED and the granularity case above silently becomes a tautology.
    const reached = reachableFrom(graph().calls, graph().roots)
    expect(reached.has('packages/demo/src/pi.ts#estimatePi')).toBe(false)
  }, ABLATION_TIMEOUT_MS)

  it('THE FIVE-MODULE ENTRY SET NO LONGER HOLDS SILENTLY — it is now an owner question', () => {
    // 22-CONTEXT.md pinned this reading on 2026-08-04: adding the three runnable-but-unnamed
    // modules "gains 4 modules and ZERO exclusive callable barrel exports, so no verdict changes
    // today", and instructed that when it stopped being true the pin should redden and the entry
    // set become an owner question rather than a silent inheritance.
    //
    // **It has stopped being true.** Measured 2026-08-08: the three rescue exactly four symbols,
    // all in `@o2/aot`, all reached from `tools/aot/bench-lifted.ts`. So the five-module list is
    // no longer defensible on the grounds the context document gave for it, and whether
    // `bench-lifted.ts` is an entry point is a judgement for the owner — 22-03 is the plan that
    // stops for one. This case asserts the DIFFERENCE, so neither the count nor the membership
    // can drift without saying so.
    const wider = buildCallGraph({
      entryPoints: [
        ...ENTRY_POINTS,
        'packages/node/src/mutation-guard.mutate.ts',
        'tools/aot/bench-lifted.ts',
        'tools/aot/measure-wasi.ts',
      ],
    })
    expect(wider.roots.length).toBe(8)

    const reachedWide = reachableFrom(wider.calls, wider.roots)
    const reachedFive = reachableFrom(graph().calls, graph().roots)
    const rescued = corpus()
      .filter((one) => one.kind === 'callable')
      .filter((one) => {
        const id = nodeId(relativeToRoot(one.declaredIn), one.name)
        return !reachedFive.has(id) && reachedWide.has(id)
      })
      .map((one) => `${one.barrel}/${one.name}`)
      .sort()
    expect(rescued).toEqual([
      'aot/pinnedWasiImports',
      'aot/seededStream',
      'aot/shardArgv',
      'aot/taskSeed',
    ])
  })
})

describe('the traversal can fail — driven with planted graphs, no build involved', () => {
  /**
   * `reachableFrom` is pure over its arguments precisely so these four cases exist. Three of the
   * four ways this instrument can report a clean tree while broken are checked here, and none of
   * them needs a real graph: an empty edge set, an empty root set, and a graph whose edges do
   * not connect to the roots.
   */
  it('lets a known-FALSE anchor be made to go green, so it is a check and not a restatement', () => {
    // A known-FALSE assertion that could never flip is a description of today's tree rather than
    // a check on it. `reachableFrom` is pure over its arguments precisely so this is reachable:
    // plant one edge from a root to `estimatePi` and it must report reached.
    const built = graph()
    const planted = new Map(built.calls)
    const root = built.roots[0] ?? ''
    planted.set(root, new Set([...(built.calls.get(root) ?? []), 'packages/demo/src/pi.ts#estimatePi']))
    expect(reachableFrom(planted, built.roots).has('packages/demo/src/pi.ts#estimatePi')).toBe(true)
    // And unplanted it must still be unreached, in the same run, so the two readings are comparable.
    expect(reachableFrom(built.calls, built.roots).has('packages/demo/src/pi.ts#estimatePi')).toBe(false)
  })

  it('reaches nothing but the roots when the edge set is empty', () => {
    expect([...reachableFrom(new Map(), ['a#<module>'])]).toEqual(['a#<module>'])
  })

  it('reaches nothing at all when the root set is empty', () => {
    const edges = new Map([['a#<module>', new Set(['b#f'])]])
    expect(reachableFrom(edges, []).size).toBe(0)
  })

  it('follows a planted chain and stops at the end of it', () => {
    const edges = new Map([
      ['a#<module>', new Set(['b#f'])],
      ['b#f', new Set(['c#g'])],
      ['d#orphan', new Set(['e#h'])],
    ])
    const reached = reachableFrom(edges, ['a#<module>'])
    expect([...reached].sort()).toEqual(['a#<module>', 'b#f', 'c#g'])
    expect(reached.has('e#h')).toBe(false)
  })

  it('terminates on a cycle rather than spinning', () => {
    const edges = new Map([
      ['a#f', new Set(['b#g'])],
      ['b#g', new Set(['a#f'])],
    ])
    expect(reachableFrom(edges, ['a#f']).size).toBe(2)
  })

  it('resolves the specifier forms the four edge classes are written in', () => {
    // Pure over its arguments, so each form is checked directly rather than inferred from a
    // reachability verdict two layers away.
    expect(resolveSpecifier('packages/browser/src/worker-factory.ts', './task-executor.worker.ts?worker')).toBe(
      'packages/browser/src/task-executor.worker.ts',
    )
    expect(resolveSpecifier('packages/node/src/worker-thread.ts', './task-executor.worker-thread.ts')).toBe(
      'packages/node/src/task-executor.worker-thread.ts',
    )
    expect(resolveSpecifier('packages/node/src/bin/agent.ts', '../fabric-node.ts')).toBe(
      'packages/node/src/fabric-node.ts',
    )
    expect(resolveSpecifier('packages/node/src/bin/agent.ts', '@o2/core')).toBe('packages/core/src/index.ts')
    // Off the map, and deliberately: node_modules is never followed, because in a worktree it is
    // a tree of symlinks into another checkout.
    expect(resolveSpecifier('packages/core/src/reduce.ts', 'node:fs')).toBeUndefined()
    expect(resolveSpecifier('packages/core/src/reduce.ts', 'multiformats/cid')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Task 3 — resolving power: the same corpus at two granularities, in one run
// ---------------------------------------------------------------------------

/**
 * The gap floor, sited against **58**, measured 2026-08-08 at `fa9820c` with Phases 20, 21, 23
 * and 24 landed and Phase 22 unbuilt.
 *
 * **The value that would break this reading is 0** — the two arms returning the same set means
 * the declaration arm has degraded to module granularity, and the phase would have built the
 * 3-answer while believing it built the other. The floor sits well below the measurement rather
 * than at it, deliberately: wiring work that legitimately reaches some of these symbols must be
 * able to land without reddening a guard about the *instrument*. A collapse to module
 * granularity does not go from 58 to 40; it goes to 0.
 */
const GAP_FLOOR = 20

/** Both arms over one graph, in one traversal each — never two graphs, which would agree by construction. */
function twoArms(built: CallGraph): {
  readonly declarationUnreached: readonly string[]
  readonly moduleUnreached: readonly string[]
  readonly gap: readonly string[]
} {
  const reached = reachableFrom(built.calls, built.roots)
  const modules = reachableFrom(built.imports, built.roots.map(fileOf))
  const declarationUnreached: string[] = []
  const moduleUnreached: string[] = []
  const gap: string[] = []
  for (const one of corpus()) {
    if (one.kind !== 'callable') continue
    const file = relativeToRoot(one.declaredIn)
    const label = `${one.barrel}/${one.name}`
    const byDeclaration = reached.has(nodeId(file, one.name))
    const byModule = modules.has(file)
    if (!byDeclaration) declarationUnreached.push(label)
    if (!byModule) moduleUnreached.push(label)
    if (!byDeclaration && byModule) gap.push(label)
  }
  return { declarationUnreached, moduleUnreached, gap }
}

describe('resolving power — measured, not assumed', () => {
  it('separates the two granularities by more than the floor, in one run', () => {
    const arms = twoArms(graph())
    expect(
      arms.gap.length,
      `module granularity called ${arms.gap.length} symbols reached that declaration ` +
        `granularity does not. Floor ${GAP_FLOOR}; the breaking value is 0, which would mean ` +
        'the declaration arm has collapsed into the module arm and this phase is measuring nothing.',
    ).toBeGreaterThanOrEqual(GAP_FLOOR)

    // Stated rather than left implicit: on this tree the module arm reaches EVERYTHING, because
    // every entry point imports a barrel and a barrel imports its whole package. So module
    // granularity answers "0 unreached" — which is the 3-answer's failure in its purest form,
    // and the reason the plan refuses to let it be the instrument.
    expect(arms.moduleUnreached.length).toBeLessThan(arms.declarationUnreached.length)
  })

  it('is red when the two arms agree because nothing connects at all', () => {
    // The other direction, and the one that stops the gap floor being satisfiable by a broken
    // instrument. With no edges every symbol is unreached under BOTH arms, the arms agree
    // perfectly, and a floor that only knew how to detect over-connection would sail through.
    const empty: CallGraph = {
      nodes: graph().nodes,
      calls: new Map(),
      imports: new Map(),
      files: graph().files,
      roots: graph().roots,
      collisions: [],
    }
    const arms = twoArms(empty)
    expect(arms.declarationUnreached.length).toBe(arms.moduleUnreached.length)
    expect(arms.gap.length).toBe(0)
    expect(arms.gap.length).toBeLessThan(GAP_FLOOR)
  })

  it('is red when the declaration arm is made to delegate to the module arm', () => {
    // The single most important plant in the plan, and it is a standing case rather than a
    // source mutation because `twoArms` reads a graph handed to it. A declaration arm that
    // answered by module would report the same set as the module arm and the gap would vanish.
    const built = graph()
    const collapsed = new Map(built.calls)
    // Give every declaration node an edge from its own module node: reaching the module now
    // reaches every declaration in it, which IS module granularity wearing declaration clothes.
    for (const node of built.nodes) {
      const moduleNode = nodeId(fileOf(node), '<module>')
      const set = new Set(collapsed.get(moduleNode) ?? [])
      set.add(node)
      collapsed.set(moduleNode, set)
    }
    const arms = twoArms({ ...built, calls: collapsed })
    expect(arms.gap.length).toBe(0)
    expect(arms.gap.length).toBeLessThan(GAP_FLOOR)
  })

  it('reports the findings as symbols, not as a number', () => {
    // A count with no names cannot be acted on, and 22-03 has to grant dispositions per symbol.
    const arms = twoArms(graph())
    expect(arms.declarationUnreached).toContain('demo/estimatePi')
    expect(arms.declarationUnreached).not.toContain('core/delegate')
    for (const symbol of arms.declarationUnreached) expect(symbol).toMatch(/^[a-z0-9]+\/\S+$/)
  })
})
