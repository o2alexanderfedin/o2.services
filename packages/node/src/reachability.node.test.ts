import { mkdtempSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SymbolFlags } from 'typescript/unstable/sync'
import { describe, expect, it } from 'vitest'
import {
  ENTRY_POINTS,
  type ClassifiedExport,
  type ExportFacts,
  barrelExports,
  barrelNameOf,
  barrelPathsIn,
  callableConstsIn,
  censusOf,
  classify,
  classifyAll,
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
 */
const CALLABLE_FLOOR: Readonly<Record<string, number>> = {
  aot: 13,
  bench: 18,
  browser: 25,
  core: 88,
  demo: 16,
  libp2p: 9,
  net: 32,
  node: 16,
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
  node: 42,
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
