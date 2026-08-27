import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * WIRE-04 — **the corpus half.** *"The fabric has exactly one job entry point"* is a claim
 * about the fabric, and until 2026-08-05 the only thing holding it read **one** barrel.
 *
 * ## The blind spot, measured rather than argued
 *
 * `packages/core/src/job/submit.test.ts` holds
 * `describe('WIRE-04 — the barrel offers exactly one way to run a job')`. It imports
 * `../index.ts` — `@o2/core`'s barrel — and nothing else. This repository publishes
 * **eight** barrels, and the machinery of the second job implementation WIRE-04 exists
 * because of did not vanish when Plan 20-12 deleted it: `@o2/core`'s own header records
 * that `ShardWork`, `DispatchOutcome` and `ShardDispatch` **moved to `@o2/net`'s
 * `churn.ts`**, and that module's header says its only consumer had been `runResilient`.
 * So the parts of a rival job path live in a package the guard could not see.
 *
 * Enumerated on 2026-08-05, by importing all eight barrels and reading `Object.keys`:
 *
 * ```
 * aot 21 exports []            demo    36 []
 * bench 21 []                  libp2p  26 []
 * browser 37 []                net     39 ["submitJobWithEgress"]
 * core 112 ["executeReduce","executeVerified","runTask","runTaskAndPost","submitJob"]
 * node 33 []
 * ```
 *
 * **A job-shaped export already stood outside the guarded barrel.** `submitJobWithEgress`
 * is not a rival implementation — it is the wrapper `sovereign-block-refusal.node.test.ts`
 * pins as *"the one path that registers a sovereign shard"*, and it calls `submitJob` — but
 * the guard could not have told the difference, because it never looked. That is this
 * repository's named defect shape (#38, #39, #66): **the population a guard acts on is not
 * the population that pays for it.**
 *
 * ## The corpus is a reading, never a belief about who could fire it
 *
 * #66 was written from a *belief* about which guards could be affected, and it carved out
 * the one that mattered. So the barrel set here is not a list of package names. It is
 * `git ls-files packages` filtered to `packages/<anything>/src/index.ts` — a ninth package
 * added tomorrow is in the corpus the moment it is tracked, with nobody remembering to add
 * it. {@link scannedTheWholeWorkspace} asserts the reading found every workspace declared
 * in the root `package.json`, so a filter that silently stopped matching cannot pass.
 *
 * Barrels are imported **by path**, not by package specifier. `@o2/browser` is not a
 * declared dependency of `@o2/node` and must not become one to satisfy a test; the
 * relative-path idiom is the one `sovereign-block-refusal.node.test.ts` already uses to
 * reach `@o2/core`'s fixtures.
 *
 * ## Why namespaces and not source text
 *
 * Inherited verbatim from the core-side guard, because the argument is the same one:
 * `Object.keys` over a namespace yields value bindings and nothing else — types have
 * already vanished — so a comment naming a deleted symbol cannot register and a re-export
 * added by any syntax at all does. Several barrels here name `runResilient` in prose.
 *
 * ## The honest limit, stated rather than papered over
 *
 * "Runs a job" is not decidable from a binding. This pins a **set** of exported callables
 * whose name takes an imperative job-shaped form, exactly as the core-side guard does, and
 * a second entry point called `fabricate` passes here too. What it adds is *reach*: the
 * same predicate, over every barrel a caller can import instead of one.
 *
 * It also does **not** decide whether `submitJobWithEgress` satisfies WIRE-04's *"without
 * the caller choosing between two functions"*. That is an owner question and this file
 * takes no position on it; what this file establishes is that the answer is now inside a
 * guard's corpus instead of outside every guard's corpus. The role recorded for each
 * surviving name below is an argument, not a property this file checks.
 *
 * Node-only: reads tracked files off disk and imports them by absolute path.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The shape a job entry point's name takes.
 *
 * **Duplicated from `submit.test.ts` deliberately, and the duplication is then pinned**
 * by {@link theTwoGuardsShareOneRule} — importing across two spec files would couple them,
 * and leaving two copies unpinned is how a rule drifts into two rules. Deliberately wider
 * than `submit`: the symbol WIRE-04 exists because of was called `runResilient`, so a
 * pattern that only caught `submit*` would have been written by looking at the answer.
 */
const JOB_SHAPED = /^(run|submit|execute|dispatch|perform)[A-Z]/

/** The source that holds the single-barrel guard this file widens. */
const CORE_GUARD = 'packages/core/src/job/submit.test.ts'

/**
 * Every tracked workspace barrel, read rather than listed.
 *
 * `git ls-files` for `sovereign-block-refusal.node.test.ts`'s reason: it excludes
 * `node_modules`, `dist` and everything gitignored for free, and it matches what a reader
 * of the repository sees.
 */
function trackedBarrels(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => /^packages\/[^/]+\/src\/index\.ts$/.test(path))
    .sort()
}

/** The workspace package names the root manifest declares, derived from the same tree. */
function declaredPackages(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => /^packages\/[^/]+\/package\.json$/.test(path))
    .map((path) => path.split('/')[1] ?? '')
    .sort()
}

/** Exported callables whose name takes that form, sorted. A pure function, so it can be planted against. */
function jobShapedExports(namespace: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(namespace)
    .filter((name) => JOB_SHAPED.test(name) && typeof namespace[name] === 'function')
    .sort()
}

/**
 * The whole set, per barrel, each with the reason it is not a second job entry point.
 *
 * `exports` is a floor and not an equality: a barrel gaining an unrelated export is not
 * this file's business, but a barrel that suddenly published almost nothing would satisfy
 * every "no second runner" reading below perfectly, and that is what the floor refuses.
 */
const BARRELS: readonly {
  readonly file: string
  readonly minExports: number
  readonly jobShaped: readonly { readonly name: string; readonly role: string }[]
}[] = [
  { file: 'packages/aot/src/index.ts', minExports: 15, jobShaped: [] },
  { file: 'packages/bench/src/index.ts', minExports: 15, jobShaped: [] },
  { file: 'packages/browser/src/index.ts', minExports: 25, jobShaped: [] },
  // `minExports: 3` against siblings at 15-100, and the gap is the point rather than an
  // oversight. `packages/cloudflare` arrived 2026-08-25 with Phase 29 criterion 3 and its
  // whole barrel is `DoDatastore` plus the two refusals it raises — a storage binding, not a
  // tier. The floor is set at what the package actually publishes today so it still catches a
  // barrel collapsing to nothing; it is expected to RISE as criteria 2 and 7 add the node
  // assembly, and a floor left at 25 would have been a number nobody measured.
  //
  // `jobShaped: []` is a claim, not a default: a Cloudflare node does not advertise execution
  // at all — runtime WASM compilation is refused by the platform, measured — so this barrel
  // offering a way to run a job would be a defect rather than a second choice under WIRE-04.
  { file: 'packages/cloudflare/src/index.ts', minExports: 3, jobShaped: [] },
  {
    file: 'packages/core/src/index.ts',
    minExports: 100,
    jobShaped: [
      { name: 'executeReduce', role: 'the reduce half of map/reduce, over partials a job already produced' },
      { name: 'executeVerified', role: "one shard's replicas compared — a component submitJob calls once per generation" },
      { name: 'runTask', role: 'the worker side: what a node does with one task it has been handed' },
      { name: 'runTaskAndPost', role: 'the same, posting its answer back to the thread that spawned it' },
      { name: 'submitJob', role: 'THE entry point. Four production submitters call it' },
    ],
  },
  { file: 'packages/demo/src/index.ts', minExports: 25, jobShaped: [] },
  { file: 'packages/libp2p/src/index.ts', minExports: 15, jobShaped: [] },
  {
    file: 'packages/net/src/index.ts',
    minExports: 25,
    jobShaped: [
      {
        name: 'submitJobWithEgress',
        role:
          'the guarded wrapper — it CALLS submitJob and adds the sovereign registration. ' +
          'sovereign-block-refusal.node.test.ts pins it as the one path that registers a ' +
          'sovereign shard, and pins bare submitJob to three files. Whether a wrapper is a ' +
          "second choice under WIRE-04's wording is an owner question this file does not decide",
      },
    ],
  },
  { file: 'packages/node/src/index.ts', minExports: 25, jobShaped: [] },
]

async function namespaceOf(file: string): Promise<Readonly<Record<string, unknown>>> {
  return (await import(pathToFileURL(join(ROOT, file)).href)) as unknown as Readonly<
    Record<string, unknown>
  >
}

/**
 * One barrel pays for the whole workspace graph, and 5 000 ms does not cover it.
 *
 * **Measured 2026-08-17**, plain `node --experimental-strip-types`, no vitest:
 * importing `packages/browser/src/index.ts` cold takes **3 670 ms** and yields 40 exports;
 * importing `packages/core/src/index.ts` immediately afterwards takes **0 ms**. The first
 * barrel to touch the graph type-strips libp2p, Helia and the demo surfaces, and every
 * barrel after it is a cache hit — which is why exactly one of these `it.each` cases can
 * fail and why {@link https://vitest.dev} reports the survivors as instant.
 *
 * So this case sat on vitest's **unsized 5 000 ms default** while doing 3.7 s of real work.
 * On 2026-08-17 it timed out at 5 019 ms, alone on the host, at a measured
 * `(user+sys)/real` of 0.307 — 3.7 s of work plus vitest's own transform is over the line
 * whenever the host is busy, and the browser package grew three exports since this file's
 * header enumerated it at 37.
 *
 * **This is not a widened pass.** Every assertion below is unchanged and none of them is a
 * duration; the only thing raised is how long the harness waits for an `import` it has
 * already been told to perform. `reachability.node.test.ts` paid for this exact lesson on
 * 2026-08-14, where one member of an ablation block was left on the 5 000 ms default while
 * its four siblings carried 60 000 ms.
 *
 * Sized at 16× the measured cold import rather than at a margin over it: the number that
 * matters is "long enough that a contended host cannot reach it", and the case has no
 * timing claim that a generous budget could weaken.
 */
const BARREL_IMPORT_TIMEOUT_MS = 60_000

describe('WIRE-04 — every barrel in the workspace offers at most one way to run a job', () => {
  const barrels = trackedBarrels()

  it('scannedTheWholeWorkspace: one barrel per declared package, none missed', () => {
    // Anti-vacuity, and it is the assertion this whole file exists because of. Every
    // check below is of the form "exactly these names", which a corpus that found the
    // core barrel and stopped would also satisfy — that is precisely the state the
    // single-barrel guard was in.
    const packages = declaredPackages()
    expect(packages.length).toBeGreaterThan(5)
    expect(barrels).toEqual(packages.map((name) => `packages/${name}/src/index.ts`))
    expect(barrels).toEqual(BARRELS.map(({ file }) => file))
    // The two named in `@o2/core`'s own WIRE-04 header, so a rename cannot quietly
    // shrink the corpus to the one barrel that was already covered.
    expect(barrels).toContain('packages/core/src/index.ts')
    expect(barrels).toContain('packages/net/src/index.ts')
  })

  it('theTwoGuardsShareOneRule: the core-side guard still uses this exact predicate', () => {
    // Two copies of one rule drift into two rules. This pins them as one by reading the
    // other file rather than importing it, which is `slow-specs.node.test.ts`'s idiom for
    // holding a constant that lives somewhere a spec must not evaluate.
    const source = readFileSync(join(ROOT, CORE_GUARD), 'utf8')
    expect(source).toContain(`const JOB_SHAPED = ${JOB_SHAPED.toString()}`)
    expect(source).toContain("describe('WIRE-04 — the barrel offers exactly one way to run a job'")
  })

  it.each(BARRELS)('$file publishes exactly the job-shaped names it may', async (barrel) => {
    const namespace = await namespaceOf(barrel.file)
    expect(Object.keys(namespace).length).toBeGreaterThanOrEqual(barrel.minExports)

    const expected = barrel.jobShaped.map(({ name }) => name).toSorted()
    const found = jobShapedExports(namespace)
    const unexpected = found.filter((name) => !expected.includes(name))
    expect(
      unexpected.map(
        (name) =>
          `${barrel.file} exports ${name}, which takes a job entry point's name. WIRE-04 ` +
          'asks that submitting a job get lease renewal, speculation and coverage accounting ' +
          '"without the caller choosing between two functions", and a barrel export is exactly ' +
          "a caller's choice. Either route it through submitJob, or add it to BARRELS with the " +
          'argument for why it is not a second way to run a job. That argument is reviewed here, ' +
          'not asserted by this file.',
      ),
    ).toEqual([])
    // Both directions. `toEqual` on the whole set is what catches a *disappearance* —
    // the day `submitJob` stops being exported is equally a change of scope.
    expect(found).toEqual(expected)
  }, BARREL_IMPORT_TIMEOUT_MS)

  it('finds submitJob in exactly one barrel', async () => {
    const holders: string[] = []
    for (const barrel of barrels) {
      const namespace = await namespaceOf(barrel)
      if (typeof namespace['submitJob'] === 'function') holders.push(barrel)
    }
    // "Exactly one" counted rather than forbidden: a workspace exporting no way to run a
    // job satisfies "no second runner" and fails this.
    expect(holders).toEqual(['packages/core/src/index.ts'])
    // Budgeted like its siblings even though it has never been the case that paid: which of
    // these four touches the graph first depends on ordering and on any `-t` filter, so
    // sizing only the one that failed on the day would leave the same trap for the next
    // filter that happens to run this one alone.
  }, BARREL_IMPORT_TIMEOUT_MS)

  it('reports a second job runner in a barrel other than core — proved by planting', async () => {
    // The plant goes in `@o2/net`, because that is the barrel this file exists for: the
    // one holding the deleted implementation's types, and the one the core-side guard
    // cannot see. Planted against the namespace rather than the file, so the run needs no
    // write to a package another agent may be editing.
    const net = await namespaceOf('packages/net/src/index.ts')
    const planted: Record<string, unknown> = { ...net, runResilient: () => undefined }
    expect(jobShapedExports(planted)).toEqual(['runResilient', 'submitJobWithEgress'])
    expect(jobShapedExports(planted)).not.toEqual(['submitJobWithEgress'])

    // And the shape a deprecation shim takes — a re-export under the old name — which is
    // what `submit.test.ts` plants at `@o2/core` and what this file plants one package over.
    const shim: Record<string, unknown> = { ...net, runResilient: net['submitJobWithEgress'] }
    expect(jobShapedExports(shim)).toContain('runResilient')

    // A barrel that merely *names* the symbol in prose must not register. `@o2/core`'s own
    // header says `runResilient` twice, which is the shape a text scan gets wrong.
    const core = await namespaceOf('packages/core/src/index.ts')
    expect(readFileSync(join(ROOT, 'packages/core/src/index.ts'), 'utf8')).toContain('runResilient')
    expect(jobShapedExports(core)).not.toContain('runResilient')
  }, BARREL_IMPORT_TIMEOUT_MS)
})
