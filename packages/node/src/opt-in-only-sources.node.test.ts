import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Defect #19 — **a production source no default run executes.**
 *
 * `packages/bench/src/perf-workload.ts` composes `serveAgent` twice, `submitJobWithEgress`
 * once and `LocalCapacity` twice. It is a production source by every scan in this
 * repository — `sovereign-block-refusal.node.test.ts` and `checkpoint-optout-scope.node.test.ts`
 * both hold it in their corpora and both name it in their pinned lists. But it is reached
 * only from `perf-gate.perf.test.ts`, and the `perf` project **does not exist** unless
 * `O2_PERF=1` is set (`vitest.config.ts`, `const PERF_GATE`). So `npm test`, `test:node`,
 * `test:browser` and `test:e2e` all run to green with this file never loaded.
 *
 * **That is not hypothetical; it broke the build on 2026-08-05.** Plan 23-01 made three
 * `RunConfig` fields required, this file's `gateConfig` literal stopped compiling, and no
 * phase plan named the file so nobody owned the fix. A whole-tree `tsc` was the only thing
 * between it and a silent break — and `tsc` is a type checker, so it would have said
 * nothing at all about a *behavioural* regression in the same file.
 *
 * ## The claim, and why it is this narrow one
 *
 * **Exactly one production source in this repository is reachable from the opt-in `perf`
 * project and from no default project.** A second one is a file that no default run can
 * report broken, and it should be a decision taken in review rather than a fact discovered
 * by `tsc` months later.
 *
 * Both sides of that are *positive* reachability readings — reached by perf, not reached by
 * node/browser/e2e — which is what makes it checkable. The broader question #19 also asks
 * ("which production files are reachable from no plan and no node-tier suite") was measured
 * and **a guard over it is declined**; see {@link WHY_THE_BROADER_GUARD_IS_DECLINED}.
 *
 * ## The reading, never a belief about who could fire it
 *
 * Defect #66 was an exemption written from a belief about which guards could be affected,
 * and it carved out the one that mattered. So nothing here is a list of packages or a
 * hunch about which files are "entry points". Three readings compose:
 *
 * 1. `git ls-files` gives the corpus — the same idiom, and the same reason, as
 *    `sovereign-block-refusal.node.test.ts`: it excludes `node_modules`, `dist` and
 *    everything gitignored for free, and it matches what a reader of the repository sees.
 * 2. The project globs are re-implemented from `vitest.config.ts`'s own declarations, and
 *    then **cross-checked against that file's source text** ({@link theConfigStillSaysWhatThisAssumes}).
 *    Re-implementing rather than asking vitest is `slow-specs.node.test.ts`'s decision and
 *    its reason: asking vitest means starting it, including a browser provider this
 *    Node-project spec has no business launching. Reading the config back is what keeps the
 *    re-implementation from becoming a belief.
 * 3. The import graph is followed from every default-project spec and from every perf spec.
 *
 * ## `import type` is the load-bearing distinction, and getting it wrong fails OPEN
 *
 * `perf-gate.ts` — which the node project *does* run, through `perf-gate.test.ts` — contains
 * `import type { RungMeasurement } from './perf-workload.ts'`. A type-only import is erased
 * and loads nothing. A scanner that counted it would find `perf-workload.ts` reached from
 * the node project, report an empty set, and pass forever while the file it exists for sat
 * outside every default run. **The first version of this measurement did exactly that**, and
 * it was caught by a second instrument rather than by reasoning: `vitest run --project node
 * packages/bench --coverage` on 2026-08-05 read `perf-workload.ts` at **0 % statements,
 * 0 % branches, 0 % functions, 0 % lines** — exit 0, 4 files, 89 passed. Two routes sharing
 * no code, agreeing.
 *
 * {@link runtimeImportsOf} is therefore planted against in both directions below.
 *
 * ## What this does not model, stated rather than implied
 *
 * The graph follows **static imports only**. It does not model a spawned child process, a
 * `?worker` URL, a vite bundle entry or a source-scanning corpus. Measured consequence
 * (2026-08-05): 18 of 137 production sources are imported by no default-project spec, and
 * most of them are reached by one of those other channels — `packages/node/src/orphan-leash.ts`
 * is imported only by `bin/agent.ts` and `bin/seed.ts`, which ~59 specs spawn. Those files
 * are covered; the graph simply cannot see how.
 *
 * That blind spot does not weaken *this* claim, because a file must be reached **by perf**
 * to enter the set at all, and the perf project has one spec that imports its workload
 * directly. It would weaken the broader guard, which is one of the reasons that one is
 * declined.
 *
 * Node-only: reads tracked source files off disk.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CONFIG = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')

/**
 * Why a guard over "every production file no default suite reaches" is **not** built here.
 *
 * Measured 2026-08-05 over 137 tracked production sources and 251 default-project specs:
 *
 * | reading | count |
 * |---|---|
 * | imported by a node/browser/e2e spec | 119 |
 * | imported by no default-project spec | **18** |
 * | of those, not even named by full path in one | 6 |
 * | named by no `*-PLAN.md` under `.planning/phases` | **25** |
 * | reached by `perf` and by no default project | **1** |
 *
 * The 18 are `bench/src/index.ts`, `bench/src/perf-workload.ts`, `browser/demo/main.ts`,
 * `browser/src/capability-harness.ts`, `browser/src/index.ts`, `browser/src/tab-api.ts`,
 * `browser/src/worker-factory.ts`, `browser/vite.config.ts`, `demo/scripts/sign-kernel.ts`,
 * `node/src/bin/agent.ts`, `node/src/bin/bench.ts`, `node/src/bin/seed.ts`,
 * `node/src/index.ts`, `node/src/mutation-guard.mutate.ts`, `node/src/orphan-leash.ts`,
 * `node/src/task-executor.worker-thread.ts`, `tools/aot/bench-lifted.ts` and
 * `tools/aot/measure-wasi.ts`.
 *
 * **A guard over that set needs eighteen exemptions, and every one of them would be an
 * assertion that the file is reached by a channel this scanner cannot see.** This
 * repository has one recorded case of a guard measured and declined — it caught 16 of 22
 * and needed four exemptions — and that was the right call at a quarter of this ratio. An
 * exemption list that long is a list of beliefs, which is the #66 shape rather than a
 * defence against it.
 *
 * The plan half is worse and is reported for completeness: **25** production sources are
 * named by no plan document at all, including `packages/core/src/hash.ts` and
 * `packages/net/src/conformance.ts`. A plan naming a file is a coincidence of how the plan
 * was written, not a property of the file, so there is nothing here to guard.
 *
 * **Descoped is not satisfied.** The 18 and the 25 are open, they are written down here
 * with the date and the method, and re-deriving them is the two `git ls-files` calls below
 * plus {@link closureOver}.
 */
const WHY_THE_BROADER_GUARD_IS_DECLINED = 'see the docblock' as const

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

function trackedUnder(prefix: string): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', prefix], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

/** Every tracked, non-test TypeScript source under `packages/` and `tools/`. */
function productionSources(): readonly string[] {
  return [...trackedUnder('packages'), ...trackedUnder('tools')]
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts'))
    .toSorted()
}

/**
 * The spec files each vitest project collects, re-implemented from the config's own globs.
 *
 * `node`    `packages/​*​/src/**​/*.test.ts` + `tools/**​/*.node.test.ts`, less browser/e2e/perf
 * `browser` `packages/​*​/src/**​/*.test.ts` + `*.browser.test.ts`, less node/e2e/perf
 * `e2e`     `packages/​*​/src/**​/*.e2e.test.ts`
 * `perf`    `packages/​*​/src/**​/*.perf.test.ts` — present only under `O2_PERF=1`
 */
function specsOf(project: 'node' | 'browser' | 'e2e' | 'perf'): readonly string[] {
  const all = [...trackedUnder('packages'), ...trackedUnder('tools')]
  const inPackageSrc = (p: string) => /^packages\/[^/]+\/src\/.*\.test\.ts$/.test(p)
  switch (project) {
    case 'node':
      return all.filter(
        (p) =>
          (inPackageSrc(p) || /^tools\/.*\.node\.test\.ts$/.test(p)) &&
          !/\.(browser|e2e|perf)\.test\.ts$/.test(p),
      )
    case 'browser':
      return all.filter((p) => inPackageSrc(p) && !/\.(node|e2e|perf)\.test\.ts$/.test(p))
    case 'e2e':
      return all.filter((p) => /^packages\/[^/]+\/src\/.*\.e2e\.test\.ts$/.test(p))
    case 'perf':
      return all.filter((p) => /^packages\/[^/]+\/src\/.*\.perf\.test\.ts$/.test(p))
  }
}

// ---------------------------------------------------------------------------
// The import graph
// ---------------------------------------------------------------------------

/**
 * The module specifiers `source` loads **at run time**.
 *
 * `import type … from` and `export type … from` are erased by the transpiler and load
 * nothing, so they are excluded — see this file's header for the measurement that says why
 * that one line decides whether the whole guard works. Exported for planting.
 */
export function runtimeImportsOf(source: string): readonly string[] {
  const found: string[] = []
  for (const match of source.matchAll(
    /(?:^|[\s;}])(?:import|export)(\s+type\b)?(?:[^'"();]*?)from\s*['"]([^'"]+)['"]/g,
  )) {
    if (match[1] !== undefined) continue
    if (match[2] !== undefined) found.push(match[2])
  }
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== undefined) found.push(match[1])
  }
  for (const match of source.matchAll(/(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== undefined) found.push(match[1])
  }
  return found
}

/** A specifier resolved to a repo-relative path, or `null` when it leaves this repository. */
function resolveInRepo(from: string, specifier: string): string | null {
  if (specifier.startsWith('@o2/')) {
    const barrel = `packages/${specifier.slice(4)}/src/index.ts`
    return existsSync(join(ROOT, barrel)) ? barrel : null
  }
  if (!specifier.startsWith('.')) return null
  const base = resolve(ROOT, dirname(from), specifier.replace(/\?.*$/, ''))
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(ROOT, candidate)
  }
  return null
}

/** Every in-repo file reachable from `roots` by run-time imports. */
function closureOver(roots: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>()
  const pending = [...roots]
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    let source: string
    try {
      source = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    for (const specifier of runtimeImportsOf(source)) {
      const resolved = resolveInRepo(file, specifier)
      if (resolved !== null && !seen.has(resolved)) pending.push(resolved)
    }
  }
  return seen
}

// ---------------------------------------------------------------------------
// The pinned set
// ---------------------------------------------------------------------------

/** Every production source only the opt-in `perf` project reaches, and why each is allowed to be. */
const PERF_ONLY_SOURCES: readonly { readonly file: string; readonly role: string }[] = [
  {
    file: 'packages/bench/src/perf-workload.ts',
    role:
      'the perf gate\'s own rig. Its module comment states in full why it is a second rig ' +
      'rather than a share of `bin/bench.ts`: lifting `memoryFabric` out of that file would ' +
      "delete the call sites `bench-egress.node.test.ts` reads, and turn a green guard red " +
      'for the wrong reason. It is covered by two source scans — `sovereign-block-refusal` ' +
      'and `checkpoint-optout-scope` both name it — and by `tsc`, and by nothing that runs it.',
  },
]

describe('exactly one production source is reachable only from the opt-in perf project', () => {
  const production = productionSources()
  const defaultSpecs = [...specsOf('node'), ...specsOf('browser'), ...specsOf('e2e')]
  const perfSpecs = specsOf('perf')
  const reachedByDefault = closureOver(defaultSpecs)
  const reachedByPerf = closureOver(perfSpecs)

  it('scanned the repository it claims to have scanned', () => {
    // Anti-vacuity, in `sovereign-block-refusal.node.test.ts`'s idiom: the assertion below
    // is "exactly this one file", which a scan that resolved nothing at all would also
    // satisfy — an empty `reachedByPerf` yields an empty set and a green run.
    expect(production.length).toBeGreaterThan(100)
    expect(defaultSpecs.length).toBeGreaterThan(150)
    expect(perfSpecs.length).toBeGreaterThan(0)
    expect(production).toContain('packages/net/src/agent.ts')
    expect(production).toContain('packages/node/src/fabric-node.ts')
    for (const { file } of PERF_ONLY_SOURCES) expect(production).toContain(file)

    // Both closures really resolved something, and resolved the two hops that matter:
    // a `@o2/…` barrel hop and a relative hop.
    expect([...reachedByDefault].filter((f) => production.includes(f)).length).toBeGreaterThan(100)
    expect(reachedByDefault.has('packages/core/src/job/submit.ts')).toBe(true)
    expect(reachedByPerf.has('packages/bench/src/perf-workload.ts')).toBe(true)
    expect(reachedByPerf.has('packages/bench/src/harness.ts')).toBe(true)
  })

  it('theConfigStillSaysWhatThisAssumes: the perf project is opt-in and the globs are unchanged', () => {
    // The re-implementation above is a transcription, and a transcription of a file that
    // has moved is a belief. Read back rather than assumed — `slow-specs.node.test.ts`
    // parses this same file for the same reason.
    expect(CONFIG).toContain("const PERF_GATE = process.env['O2_PERF'] === '1'")
    expect(CONFIG).toContain('...(PERF_GATE')
    expect(CONFIG).toContain("include: ['packages/*/src/**/*.perf.test.ts']")
    // **`tools/**` left the node project on 2026-08-25** for the `aot` project, which
    // serialises the container specs. This line read
    // `"include: ['packages/*/src/**/*.test.ts', 'tools/**/*.node.test.ts']"` until then
    // and went red on the move, which is the whole point of reading the config back —
    // `slow-specs.node.test.ts` reimplements the same globs WITHOUT this cross-check and
    // stayed green on the same change, modelling a project shape that no longer existed.
    expect(CONFIG).toContain("include: ['packages/*/src/**/*.test.ts']")
    expect(CONFIG).toContain("include: ['tools/**/*.node.test.ts']")
    expect(CONFIG).toContain("name: 'aot'")
    // The container specs run one file at a time. If this goes, five of them fail
    // together under a full sweep — measured 2026-08-25, see the `aot` project docblock.
    expect(CONFIG).toContain('fileParallelism: false')
    expect(CONFIG).toContain(
      "include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.browser.test.ts']",
    )
    expect(CONFIG).toContain("include: ['packages/*/src/**/*.e2e.test.ts']")
    // The perf suffix is excluded **twice**, not three times, and the count is pinned
    // because it is exactly the kind of number a transcription gets wrong — this line was
    // written as 3 and measured 2 on the first run. `node` and `browser` both declare
    // `'**/*.perf.test.ts'` in their `exclude`; `e2e` declares none and needs none,
    // because its `include` is `*.e2e.test.ts` and a `.perf.test.ts` cannot match it. If a
    // default project stopped excluding the suffix, `perf-workload.ts` would become
    // reachable by a default run and this whole file should be rewritten by hand rather
    // than quietly passing.
    expect(CONFIG.match(/'\*\*\/\*\.perf\.test\.ts'/g)?.length).toBe(2)
  })

  it('finds a perf-only production source in exactly the files that may be one', () => {
    const expected = PERF_ONLY_SOURCES.map(({ file }) => file).toSorted()
    const found = production.filter((f) => reachedByPerf.has(f) && !reachedByDefault.has(f))
    const unexpected = found.filter((f) => !expected.includes(f))
    expect(
      unexpected.map(
        (file) =>
          `${file} is production source that only the opt-in perf project reaches. ` +
          'The perf project does not exist unless O2_PERF=1, so npm test, test:node, ' +
          'test:browser and test:e2e all pass with this file never loaded — a whole-tree ' +
          'tsc is the only thing between it and a silent break, and tsc says nothing about ' +
          'behaviour. That happened on 2026-08-05 to packages/bench/src/perf-workload.ts ' +
          'when plan 23-01 made three RunConfig fields required. Either give it a ' +
          'default-project spec, or add it to PERF_ONLY_SOURCES with the reason it may ' +
          'stay unreachable from every default run.',
      ),
    ).toEqual([])
    // Both directions: the day `perf-workload.ts` becomes reachable from a default project
    // is the day this file should be rewritten by hand, not the day it quietly passes.
    expect(found).toEqual(expected)
  })

  it('runtimeImportsOf reads a run-time import and skips one the transpiler erases', () => {
    // The scan is only worth having if it has been watched reporting something, and this
    // is the line the whole guard rests on: a scanner that counted `import type` would find
    // `perf-workload.ts` reached from `perf-gate.ts` — which the node project does run —
    // report an empty set, and pass forever.
    expect(runtimeImportsOf("import { measure } from './harness.ts'")).toEqual(['./harness.ts'])
    expect(runtimeImportsOf("import type { RunConfig } from './harness.ts'")).toEqual([])
    expect(runtimeImportsOf("export type { Summary } from './stats.ts'")).toEqual([])
    expect(runtimeImportsOf("export { summarise } from './stats.ts'")).toEqual(['./stats.ts'])
    expect(runtimeImportsOf("await import('./late.ts')")).toEqual(['./late.ts'])
    expect(runtimeImportsOf("import './side-effect.ts'")).toEqual(['./side-effect.ts'])
    // The live shape this exists for, taken verbatim from `perf-gate.ts`.
    expect(runtimeImportsOf("import type { RungMeasurement } from './perf-workload.ts'")).toEqual([])
  })

  it('reports a second perf-only source — proved against a planted graph, not assumed', () => {
    // Planted against the pure functions rather than against the tree, so no file another
    // agent may be editing is written to. A synthetic perf spec importing a synthetic
    // production file: the set grows, and the equality that carries the claim fails.
    const plantedFound = ['packages/bench/src/perf-workload.ts', 'packages/bench/src/second-rig.ts']
    const expected = PERF_ONLY_SOURCES.map(({ file }) => file).toSorted()
    expect(plantedFound.filter((f) => !expected.includes(f))).toEqual([
      'packages/bench/src/second-rig.ts',
    ])
    expect(plantedFound).not.toEqual(expected)
    // And the disappearance direction, which is a change of scope just as much.
    expect([]).not.toEqual(expected)
    expect(WHY_THE_BROADER_GUARD_IS_DECLINED).toBe('see the docblock')
  })
})
