import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocking, commitScope, pathFormProblems, trackedPaths } from './commit-scope.ts'

/**
 * `vitest.config.ts`'s exclusion list, held to its own stated rule.
 *
 * ## What went wrong
 *
 * `SLOW_NODE_SPECS` excluded nine files. Its docblock stated the rule — *"every file
 * that came in at or above 1 s"* — and **twenty-three files met it**, including the
 * second and third slowest in the project. Every number in the surrounding prose was
 * also false by then: it claimed `test:unit` ran 66 files / 946 tests in 6.46 s when
 * the real figures were 102 / 1411 / 24.03 s, so the fast inner loop was 3.7× its
 * recorded cost and one unexcluded file accounted for nearly all of it.
 *
 * Nothing was wrongly *listed*. A phase landed fourteen new slow files and nobody
 * re-measured, which is the whole mechanism: **a list maintained beside a rule drifts
 * from the rule.**
 *
 * ## What changed, and what this file is for
 *
 * `SLOW_NODE_SPECS` is no longer written down. It is `MEASURED_NODE_SPANS` filtered by
 * `SLOW_CUTOFF_MS`, so the list cannot disagree with the measurement it claims to come
 * from — that class of drift is now impossible rather than guarded. This file holds the
 * three things the derivation cannot hold by itself:
 *
 * 1. **The derivation is still a derivation.** A future edit that pastes a literal
 *    array back over it fails here.
 * 2. **The measured paths still exist and are still in the `node` project.** A renamed
 *    or deleted file silently excludes nothing; vitest does not complain about an
 *    exclude pattern that matches no file.
 * 3. **The measurement still describes this repository.** This is the one that catches
 *    what actually happened, and it is a *drift* check rather than an equality — see
 *    `FILE_COUNT_TOLERANCE`.
 *
 * ## Why this parses source text instead of importing the config
 *
 * Importing `vitest.config.ts` evaluates `defineConfig` and calls `playwright()`, which
 * is a browser-provider factory this Node-project spec has no business starting. Reading
 * the source is also the established idiom here — `serve-agent-hooks.node.test.ts`
 * counts sentinels in production files exactly this way.
 *
 * ## What this deliberately does not do
 *
 * It does not re-time anything. Re-measuring inside a guard means a ~400 s run on every
 * invocation, and the guard would then be excluded from `test:unit` by the very list it
 * checks. The timings are evidence recorded at a stated date and load; this file checks
 * that the evidence still describes the repository, not that it is still the fastest
 * possible answer.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CONFIG_PATH = join(ROOT, 'vitest.config.ts')
const CONFIG = readFileSync(CONFIG_PATH, 'utf8')

/** `vitest.config.ts` as a commit can name it — every finding here participates in it. */
const CONFIG_FILE = 'vitest.config.ts'

/**
 * The commit these findings are judged against, or `NO_COMMIT_SCOPE` outside a commit.
 *
 * ## This guard's attribution is the least exact of the five, and that is said here
 *
 * Two of the three checks below name a path precisely: a measured span that no longer
 * exists, or that sits outside the node project, is about `vitest.config.ts` and about
 * that one file, and either author can resolve it.
 *
 * The **file-count drift** check is different, and the difference is worth writing down
 * rather than discovering. Its subject is "the project grew since the measurement", which
 * has no single author — and `MEASURED_NODE_SPANS` cannot say which files arrived, because
 * it records ~40 spans for a run that covered 144 files. So there is no data here from
 * which to name the cause exactly. The choice is therefore between attributing it to
 * `vitest.config.ts` alone — which would mean it stops holding the people whose files
 * moved the count, i.e. it stops blocking — and attributing it to the whole node test
 * population, which over-attributes and holds somebody who merely edited an existing
 * spec.
 *
 * **Over-attribution is the correct direction, so that is what it does.** A guard that
 * blocks somebody it need not is an inconvenience; a guard that blocks nobody is a guard
 * that has been switched off with no symptom. It still narrows: a documentation commit, a
 * production-source commit, and a plan-document commit all go through, and those are the
 * commits the recorded `O2_SKIP_GUARDS` instances were.
 */
const SCOPE = commitScope()

// ---------------------------------------------------------------------------
// Parsing the config
// ---------------------------------------------------------------------------

/** `['some/path.test.ts', 1234],` — the measured-span table's entry form. */
const SPAN_ENTRY = /\[\s*'([^']+)',\s*(\d[\d_]*)\s*\]/g

interface Span {
  readonly path: string
  readonly ms: number
}

const SPANS: readonly Span[] = (() => {
  const table = /const MEASURED_NODE_SPANS[\s\S]*?\n\]/.exec(CONFIG)?.[0] ?? ''
  const found: Span[] = []
  for (const match of table.matchAll(SPAN_ENTRY)) {
    const path = match[1]
    const ms = match[2]
    if (path !== undefined && ms !== undefined) found.push({ path, ms: Number(ms.replaceAll('_', '')) })
  }
  return found
})()

const CUTOFF_MS = Number(/const SLOW_CUTOFF_MS = (\d[\d_]*)/.exec(CONFIG)?.[1]?.replaceAll('_', '') ?? NaN)

function measurementField(name: string): number {
  const raw = new RegExp(String.raw`\n\s*${name}:\s*(\d[\d_.]*)`).exec(CONFIG)?.[1]
  return Number((raw ?? '').replaceAll('_', ''))
}

const EXCLUDED = SPANS.filter((span) => span.ms >= CUTOFF_MS)

// ---------------------------------------------------------------------------
// The node project's real file set
// ---------------------------------------------------------------------------

const SKIP_DIRS: readonly string[] = ['node_modules', '.git', 'dist', 'coverage', '.vite']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.includes(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

/**
 * Every file the `node` project would collect, derived from the same globs the config
 * declares: `packages/​*​/src/**​/*.test.ts` plus `tools/**​/*.node.test.ts`, less the
 * `browser`, `e2e` and `perf` suffixes that have their own projects.
 *
 * Reimplemented rather than asked of vitest, because asking vitest means starting it.
 * Verified against a real `--reporter=json` run: both say 112 on 2026-08-01.
 */
/**
 * Repo-relative and slash-free at the front, matching how `MEASURED_NODE_SPANS`
 * writes a path. `ROOT` carries a trailing slash, so the slice already drops it.
 */
const relative = (paths: readonly string[]): readonly string[] =>
  paths
    .filter((path) => !/\.(browser|e2e|perf)\.test\.ts$/.test(path))
    .map((path) => path.slice(ROOT.length).replace(/^\//, ''))
    .sort()

/**
 * **These globs are a REIMPLEMENTATION of the config's, and on 2026-08-25 that cost
 * a silent fail-open.** `tools/**` moved from the `node` project to the new `aot`
 * project, and this constant went on walking `tools/` — so it modelled a project
 * shape that no longer existed, and every assertion below it passed while measuring
 * the wrong population. The guard whose whole job is to notice the node project
 * drifting did not notice the node project being cut by eleven files.
 *
 * There is no cheap way to have vitest hand a project's collected files to a spec
 * inside that project, so the reimplementation stays — what changes is that the two
 * projects are now modelled SEPARATELY and the assertions say which is which. A
 * future move between them reddens `collected the node project the same way the
 * reporter did` rather than passing quietly.
 */
const NODE_PROJECT_FILES: readonly string[] = relative(
  walk(join(ROOT, 'packages')).filter((path) => /\/packages\/[^/]+\/src\/.*\.test\.ts$/.test(path)),
)

/** The `aot` project — `tools/**\/*.node.test.ts`, serialised, see its config docblock. */
const AOT_PROJECT_FILES: readonly string[] = relative(
  walk(join(ROOT, 'tools')).filter((path) => path.endsWith('.node.test.ts')),
)

/**
 * Both together. `MEASURED_NODE_SPANS` was taken from one run that collected all of
 * them, and `SLOW_NODE_SPECS` is derived from it for BOTH projects' `exclude`, so a
 * span whose file has moved between the two is not stray — it is still measured and
 * still excluded. Only a span in neither project is stray.
 */
const MEASURED_PROJECT_FILES: readonly string[] = [...NODE_PROJECT_FILES, ...AOT_PROJECT_FILES].sort()

/**
 * How far the project may grow before the measurement must be retaken.
 *
 * **Equality was considered and rejected**, and the reason is worth stating because the
 * strict version looks more rigorous. Under equality, adding any test file — a fast one,
 * a doc-only guard like this file — fails the suite until somebody runs a ~400 s
 * measurement. A guard that expensive to satisfy gets deleted, and a deleted guard
 * catches nothing; the failure mode of over-strictness here is total, not partial.
 *
 * Five is chosen against the drift that actually happened: the project grew by
 * **thirty-six** files between measurements, of which fourteen were slow. Five catches a
 * phase landing its specs while leaving room for the ordinary one-file change. It is a
 * judgement, not a discovered boundary, and it is the number to argue with.
 */
const FILE_COUNT_TOLERANCE = 5

// ---------------------------------------------------------------------------

describe('the config was really parsed', () => {
  it('found the cutoff and a table of measured spans', () => {
    expect(CUTOFF_MS).toBe(1000)
    // A floor: a parse that stopped matching would satisfy every "list is empty"
    // assertion below perfectly.
    expect(SPANS.length).toBeGreaterThan(30)
    expect(EXCLUDED.length).toBeGreaterThan(20)
  })

  it('read spans as numbers, in descending order, spanning the cutoff', () => {
    for (const span of SPANS) expect(Number.isFinite(span.ms), `${span.path} has no span`).toBe(true)
    const descending = [...SPANS].sort((a, b) => b.ms - a.ms).map((span) => span.path)
    expect(SPANS.map((span) => span.path)).toEqual(descending)
    // Entries below the cutoff are listed on purpose, so the boundary is visible.
    // If they ever vanish, the table has become the answer rather than the evidence.
    expect(SPANS.filter((span) => span.ms < CUTOFF_MS).length).toBeGreaterThan(0)
  })
})

describe('the exclusion list is derived from the measurement, not written beside it', () => {
  it('computes SLOW_NODE_SPECS with the cutoff rather than listing paths', () => {
    const declaration = /const SLOW_NODE_SPECS[\s\S]*?\n\n/.exec(CONFIG)?.[0] ?? ''
    expect(declaration).toContain('MEASURED_NODE_SPANS.filter')
    expect(declaration).toContain('SLOW_CUTOFF_MS')
    // The regression this prevents: a literal array pasted back over the derivation.
    // Any `'…test.ts'` inside the declaration means a hand-maintained path is back.
    expect(declaration).not.toMatch(/'[^']*\.test\.ts'/)
  })
})

describe('every measured path is still a file this project runs', () => {
  it('has no measured path that does not exist on disk', () => {
    // The union: the config names the path, and whoever renamed or deleted the file is
    // the other half. A rename is exactly the in-flight edit this narrowing is for, and
    // `--diff-filter=ACMRD --no-renames` in the hook is what puts the *old* path in the
    // scope — with rename detection on, git prints only the destination and this finding
    // would read as foreign.
    const missing = SPANS.filter((span) => !existsSync(join(ROOT, span.path))).map((span) => ({
      paths: [CONFIG_FILE, span.path],
      line: span.path,
    }))
    expect(blocking('slow-specs/missing-path', missing, SCOPE)).toEqual([])
  })

  it('has no measured path outside the node project', () => {
    // An excluded path the project would not have collected anyway excludes nothing,
    // and reads exactly like a working exclusion.
    const stray = SPANS.filter((span) => !MEASURED_PROJECT_FILES.includes(span.path)).map((span) => ({
      paths: [CONFIG_FILE, span.path],
      line: span.path,
    }))
    expect(blocking('slow-specs/stray-path', stray, SCOPE)).toEqual([])
  })
})

describe('the recorded measurement still describes this repository', () => {
  it('collected the node project the same way the reporter did', () => {
    // Cross-check of the reimplemented globs against the recorded run, which is what
    // makes the drift check below mean anything.
    expect(NODE_PROJECT_FILES.length).toBeGreaterThan(80)
    expect(NODE_PROJECT_FILES).toContain('packages/node/src/fabric-node.node.test.ts')
    expect(NODE_PROJECT_FILES.filter((path) => /\.(browser|e2e|perf)\.test\.ts$/.test(path))).toEqual([])
    // **The boundary between the two projects, asserted from both sides.** Until
    // 2026-08-25 this line read `expect(NODE_PROJECT_FILES).toContain('tools/aot/…')`
    // and it kept passing after `tools/**` had left the node project, because this
    // file's globs are a reimplementation and were not moved with the config. Naming
    // the container spec's project positively AND excluding it from the other is what
    // makes a future move between them go red instead of quiet.
    expect(AOT_PROJECT_FILES).toContain('tools/aot/lift.node.test.ts')
    expect(NODE_PROJECT_FILES.filter((path) => path.startsWith('tools/'))).toEqual([])
    expect(AOT_PROJECT_FILES.filter((path) => !path.startsWith('tools/'))).toEqual([])
  })

  it('reads the config back, so the reimplementation above cannot become a belief', () => {
    // **THIS CHECK DID NOT EXIST UNTIL 2026-08-25, AND ITS ABSENCE IS WHY IT IS HERE.**
    // The globs above are transcribed from `vitest.config.ts`. When `tools/**` moved to
    // the `aot` project this file went on walking `tools/` and every assertion passed —
    // a guard for node-project drift, blind to eleven files leaving the node project.
    // `opt-in-only-sources.node.test.ts` has done this read-back all along and caught the
    // same change the same afternoon; its docblock states the rule this file was missing:
    // "Reading the config back is what keeps the re-implementation from becoming a belief."
    expect(CONFIG).toContain("name: 'node'")
    expect(CONFIG).toContain("include: ['packages/*/src/**/*.test.ts']")
    expect(CONFIG).toContain("name: 'aot'")
    expect(CONFIG).toContain("include: ['tools/**/*.node.test.ts']")
    // The node project must keep refusing `tools/**` explicitly. Without this the two
    // projects would both collect the container specs and each run them.
    expect(CONFIG).toContain("'tools/**',")
  })

  it('has not drifted further from the measured file count than the tolerance allows', () => {
    const recorded = measurementField('files')
    const drift = Math.abs(NODE_PROJECT_FILES.length - recorded)
    // Deliberately over-attributed — see `SCOPE` above. The config is where the fix goes;
    // the node test population is where the cause is, and nothing here can say which of
    // those files is the cause, so all of them participate.
    const drifted =
      drift <= FILE_COUNT_TOLERANCE
        ? []
        : [
            {
              paths: [CONFIG_FILE, ...NODE_PROJECT_FILES],
              line:
                `the node project holds ${NODE_PROJECT_FILES.length} test files, the recorded ` +
                `measurement covered ${recorded}. Re-measure by the procedure in ` +
                `MEASURED_NODE_SPANS's docblock in vitest.config.ts ("So this is the procedure, ` +
                `and it is not optional"), then update MEASURED_NODE_SPANS and NODE_MEASUREMENT ` +
                `there. \`--reporter=json\` is step 2 of that procedure and is not sufficient ` +
                `alone: it stamps a file's startTime at its FIRST CASE, not at file pickup, so ` +
                `a beforeAll registered above that case is charged to nothing — on the ` +
                `2026-08-05 run 2 retake, start-reporting.node.test.ts reported 90 ms against a ` +
                `real 765 ms and echo-guest.node.test.ts 600 ms against 255 540 ms, a factor of ` +
                `426. The ${CUTOFF_MS} ms cutoff falls inside both gaps, so the reporter alone ` +
                `would keep a node-spawning spec in test:unit forever. Step 3 is the one that ` +
                `closes it: find every file whose beforeAll/beforeEach runs BEFORE its first ` +
                `it/test and does real work — the test is positional, not "has a hook", and a ` +
                `TOP-LEVEL hook runs first wherever it is written — then re-run each one alone ` +
                `under \`/usr/bin/time -p\`, bracket it with a solo trivial spec to subtract the ` +
                `~1.2 s boot floor, and let the wall clock win where the reporter UNDERSTATED. ` +
                `Where its span already exceeds the whole solo run there is nothing to repair; ` +
                `aot-dispatch.node.test.ts is that case. Record the counts in ` +
                `NODE_MEASUREMENT.hookShadowCandidates / hookShadowDisagreed.`,
            },
          ]
    expect(blocking('slow-specs/file-count-drift', drifted, SCOPE)).toEqual([])
  })

  it('states figures consistent with the table they came from', () => {
    // The specific failure being prevented: prose figures nothing reads. These are the
    // ones derivable from the table itself; the rest are evidence held by the drift
    // check above.
    // **Project-aware since 2026-08-25.** `EXCLUDED` spans both projects, because
    // `SLOW_NODE_SPECS` feeds both `exclude` lists. Only the ones the NODE project
    // actually holds reduce the node project's unit count; subtracting all of them
    // would charge the node lane for files the `aot` project skips.
    const excludedInNode = EXCLUDED.filter((span) => NODE_PROJECT_FILES.includes(span.path))
    expect(measurementField('unitFiles')).toBe(measurementField('files') - excludedInNode.length)
    // Sum-of-spans must at least cover the files actually listed.
    const listed = SPANS.reduce((total, span) => total + span.ms, 0)
    expect(measurementField('sumOfFileSpansMs')).toBeGreaterThanOrEqual(listed)
    // A load average is recorded, because an absolute-millisecond cut is not
    // reproducible without one. Zero would mean nobody filled it in.
    expect(measurementField('load')).toBeGreaterThan(0)
  })
})

describe('the paths this guard attributes findings to are paths a commit can match', () => {
  /**
   * The residual fail-open of narrowing, checked from this guard's end.
   *
   * Two path-building expressions feed the attributions above, and they disagree about
   * the leading separator by construction: `MEASURED_NODE_SPANS` holds hand-typed
   * strings, while `NODE_PROJECT_FILES` builds its own with `slice(ROOT.length)` followed
   * by an explicit `replace(/^\//, '')`. That `replace` is the load-bearing character. If
   * it goes, every measured-path finding becomes `/packages/…`, matches no commit scope,
   * and this guard silently stops blocking — with nothing else in this file noticing,
   * because a leading slash still resolves on disk through `join`.
   *
   * Membership is a floor because the walk reads the filesystem rather than the index,
   * so a concurrent agent's untracked spec legitimately appears.
   */
  const TRACKED = trackedPaths(ROOT)

  it('emits repo-relative POSIX paths that git also prints', () => {
    const attributable = [CONFIG_FILE, ...SPANS.map((span) => span.path), ...NODE_PROJECT_FILES]
    expect(pathFormProblems(attributable)).toEqual([])
    expect(TRACKED.has(CONFIG_FILE)).toBe(true)
    // Every *measured* path is a committed file, so this half is an equality: a hand-typed
    // span that git does not know about is a typo, and a typo here is a permanently
    // foreign finding.
    expect(SPANS.map((span) => span.path).filter((path) => !TRACKED.has(path))).toEqual([])
    expect(NODE_PROJECT_FILES.filter((path) => TRACKED.has(path)).length).toBeGreaterThan(80)
  })
})
