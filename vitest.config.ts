import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * The measured cut. A file at or above this is excluded by `test:unit`.
 *
 * Read by `MEASURED_NODE_SPANS` below and by
 * `packages/node/src/slow-specs.node.test.ts`, which parses this file's source. The
 * threshold is a stated judgement rather than a discovered boundary — the curve is
 * smooth below `lift.node.test.ts`, so no cut falls in a natural gap.
 */
const SLOW_CUTOFF_MS = 1000

/**
 * The run `MEASURED_NODE_SPANS` came from, as data rather than as prose.
 *
 * Every figure that used to sit in the paragraph below is here instead, because the
 * paragraph is what went wrong: it stated a file count, a test count and a wall clock,
 * all three were false, and nothing read them. `slow-specs.node.test.ts` reads these.
 *
 * `load` is recorded because it changes the answer. See the note on reproducibility in
 * `MEASURED_NODE_SPANS`.
 */
const NODE_MEASUREMENT = {
  date: '2026-08-03',
  /**
   * 1-minute load average, sampled every 40 s across the whole run.
   *
   * **A real peak, polled and not inferred** — the discipline three readings ago
   * introduced, followed here. Seven samples on 8 cores: 9.60 → **18.47** → 18.31 →
   * 12.71 → 10.40 → 8.52 → 8.07, with the peak forty to eighty seconds in. The shape is
   * the usual one, contended early and settling later.
   *
   * **This one was taken on a quiet host and replaced a contended one** — the run before
   * it peaked at 59.60 because a second agent was running its own suites throughout. That
   * is the reverse of the previous replacement and it moves the table in the expensive
   * direction: a quiet host gives *smaller* spans, so fewer files clear the cut and
   * `test:unit` keeps more of them. The exclusion count nonetheless went 35 → 35 across a
   * tree that grew by two files, which is the point the table below makes at length.
   *
   * Wall clock came out **248.0 s against the previous 262.6 s**, across a tree that grew
   * by two files and eleven seconds of new test time at a third of the load. That is
   * vitest's parallelism absorbing both, and it is the reason `sumOfFileSpansMs` and
   * `wallClockMs` are both recorded rather than one standing for the other.
   */
  load: 9.6,
  loadAtEnd: 8.07,
  loadPeak: 18.47,
  /** Files and tests the `node` project ran, i.e. with no `test:unit` exclusions. */
  files: 138,
  tests: 1903,
  /** Sum of per-file spans. Not wall clock — vitest runs files in parallel. */
  sumOfFileSpansMs: 741_459,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 248_000,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * `unitFiles` is not an independent reading — `slow-specs.node.test.ts` asserts it
   * equals `files` minus the derived exclusion count, so it moves when the table does.
   * It was **also observed directly** by running `npm run test:unit` against this table,
   * which is the cross-check that the derivation and the runner agree. Deriving it alone
   * would make the assertion a tautology.
   *
   * `unitTests` is the run's total including the skipped cases, because the figure this
   * field is compared against by hand is what the reporter prints, and it prints the total.
   *
   * `unitWallClockMs` is **one reading of a passing run at a stated load** and is not a
   * bound: 6.93 s at 1-minute load **5.34**, on a run reporting `103 passed (103)` /
   * `1596 passed | 1 skipped` and exit 0. Read it as under ten seconds, and read the
   * recorded history — 5.96 s at load 5.6, then 9.97 s at load 8.4, then 7.49 s at load
   * 6.1, then 8.37 s at load 11.7, then 9.25 s at load **58**, now 6.93 s at load 5.3 —
   * as the reason this object records a load at all rather than a duration on its own.
   * The 58 and the 5.3 readings together are the strongest evidence the field has
   * produced: eleven times the load moved the fast loop by under two and a half seconds,
   * because what `test:unit` excludes is the part that waits on child processes and what
   * it keeps is CPU-cheap.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured
   * on a suite that did not pass is not a duration for the suite this field claims to
   * describe. That rule bit an earlier pass and is worth keeping: a `test:unit` run taken
   * against a half-updated table came back 7.97 s and **red**, because
   * `slow-specs.node.test.ts` was still holding the previous run's `unitFiles`. Its 7.97 s
   * is not written down anywhere.
   */
  unitFiles: 103,
  unitTests: 1597,
  unitWallClockMs: 6_930,
} as const

/**
 * Per-file spans from one recorded run, and the **only** hand-maintained data here.
 *
 * `SLOW_NODE_SPECS` is derived from this table by applying `SLOW_CUTOFF_MS`, so the
 * list and the measurement cannot disagree. They did before: the list held nine files
 * while twenty-three met its own stated rule, and every figure in the prose around it
 * was false — it claimed `test:unit` ran 66 files / 946 tests in 6.46 s when the real
 * numbers were 102 / 1411 / 24.03 s. A list maintained beside a rule drifts from the
 * rule; a list computed from the rule cannot.
 *
 * ## The measurement
 *
 * `vitest run --project node --reporter=json`, **2026-08-03**, 136 files / 1891 tests, on
 * a **green** run — exit 0, 1889 passed, 2 skipped. Sum-of-file-spans 696.4 s against
 * 262.6 s of wall clock, the difference being vitest's own parallelism. Load average
 * polled every 40 s: 13.43 at the start, **59.60 at its peak**, 23.67 at the end — the
 * most contended reading in the history below, because a second agent was running its own
 * suites on the same host throughout.
 *
 * The measurement replaced was taken earlier the same day, 135 files / 1890 tests, sum
 * 693.9 s, wall clock 253.0 s, 34 files at or above the cut, load polled 9.16 → 29.14 →
 * 7.25. The tree grew by exactly one file — `owner-domain-agents.node.test.ts` — and the
 * exclusion count went 34 → 35, which sounds like the added file and **is not**: two files
 * crossed *up* (`owner-domain-agents` at 6 405 ms and `churn.test.ts` at exactly 1 000 ms)
 * and one crossed *down* (`node-enrollment`, 1 107 → 904). Nothing about `churn` or
 * `node-enrollment` changed. That is the point the table below makes at length: membership
 * near a millisecond cut is noise, and the list is evidence rather than a decision anyone
 * made. `churn.test.ts` landing on the boundary **exactly** is the sharpest example this
 * history has produced — it read 1 134 ms, then 962, now 1 000.
 *
 * ## A file whose cost the reporter could not see, which is why one exists here at all
 *
 * `bench-attestation.node.test.ts` was written with its spawn in `beforeAll` and measured
 * — in a `--reporter=json` run taken for this very table — at **235 ms**, against a wall
 * clock of 154 s. **The JSON reporter attributes no hook time to a file.** So the file
 * would have been recorded as one of the fastest in the project, `test:unit` would have
 * gone on running it, and the fast inner loop would have grown from 7 s to over two and a
 * half minutes with nothing anywhere saying so.
 *
 * It was restructured to await a memoised promise inside each case rather than in a hook,
 * which is why it now reads 163.0 s. Anyone adding a slow spec should know the failure
 * mode: **work done in `beforeAll`/`beforeEach` is invisible to the instrument this table
 * is derived from.**
 *
 * ## An absolute millisecond cut is not reproducible, and this is the evidence
 *
 * The same rule was applied to **three** runs of the same tree on the same machine
 * within one hour, and selected a different set each time:
 *
 * | run | 1-min load | files at or above 1 s |
 * |---|---|---|
 * | 2026-07-29 (recorded by the prior pass) | ~9 | 23 |
 * | 2026-08-01, run 1 | 53 → 108 | 29 |
 * | 2026-08-01, run 2 | 10 → 25 | 28 |
 * | 2026-08-01, run 3 — the table until 2026-08-02 | 21 → 42 | 36 |
 * | 2026-08-02 — the table until 2026-08-03 | 50 → 115 → 16 | 28 |
 * | 2026-08-03, run 1 | 8.98 → 11.28, no mid-run sample | 36 |
 * | 2026-08-03, run 2 | 7.41 → 30.71 → 5.75, polled every 40 s | 40 |
 * | 2026-08-03, run 3 — the table until this one | 9.16 → 29.14 → 7.25, polled every 40 s | 34 |
 * | 2026-08-03, run 4 — the table until this one | 13.43 → 59.60 → 23.67, polled every 40 s | 35 |
 * | 2026-08-03, run 5 — **the table below** | 9.60 → 18.47 → 8.07, polled every 40 s | 35 |
 *
 * The rows make the point repeatedly and in both directions. Between run 2 and run 3 —
 * same host, same load shape, one file added — exactly one file crossed *up*, and it was
 * the added one; **seven crossed down**: `core/job/submit` (1771 → 532 ms),
 * `sovereign-block-refusal` (1651 → 579), `rendezvous-wire` (1466 → 613), `fs-blockstore`
 * (1398 → 540), `net/churn` (1114 → 962), and — below 400 ms and therefore out of the
 * table entirely — `core/discovery` (1354 →) and `identity-store` (1038 →). Nothing about
 * any of the seven changed. Between run 3 and run 4, at **twice the load**, two crossed up
 * and one down. Between the two before that, six crossed up and two down, also on nothing.
 *
 * Run 5 is the sharpest row yet, because it moves in the direction nobody expects. The
 * tree grew by **two** files, one of which — `enrollment-cost.node.test.ts` at 11.0 s —
 * is comfortably above the cut, and the excluded count still came out at **35**. Three
 * files crossed *down* to pay for it: `relayed-job` and `wasi-executor` fell out of the
 * table's range entirely, and `churn.test.ts` — which read exactly 1 000 ms in run 4 —
 * read **974**. Nothing about any of the three changed except that the host was quiet.
 *
 * Membership near the boundary is noise, and `churn.test.ts` is the standing example:
 * 1134 ms, then 962, then **exactly 1000** — the third reading is *on* the cut, which is
 * as close to a coin toss as a threshold can get. **So the list cannot be made to enforce
 * itself by re-timing** — a guard that re-measured would disagree with itself between
 * runs, and the only stable thing to check is structure. That is what
 * `packages/node/src/slow-specs.node.test.ts` does, and why it explicitly does not
 * re-time anything.
 *
 * What *is* stable is the shape: a handful of files dominate by more than an order of
 * magnitude, and the marginal ~1 s files barely matter because vitest runs them in
 * parallel. Erring generous is therefore both safe and cheap — over-excluding costs
 * `test:unit` some coverage it was never the last word on, while under-excluding costs
 * the inner loop the thing it exists for. A bare `vitest run` and `npm run test:node`
 * both still see every file, so nothing becomes unreachable either way.
 *
 * ## What the cut buys
 *
 * The 35 excluded files are **98.2 %** of the 741.5 s (728.1 s of it). The 103 that remain
 * total **13.3 s of test time**. `lift.node.test.ts` alone is 245.7 s and
 * `bench-attestation.node.test.ts` 222.2 s — 63 % of the suite in two files, and the
 * single strongest argument for the cut existing at all.
 *
 * The excluded set stayed at 35 while the project grew by two files, one of them above the
 * cut, and the arithmetic is *not* "nothing changed": one file entered and three left (see
 * the table above). It is left as measured anyway: pinning entries at their old values
 * would make this table a blend of two runs, and its whole worth is that it is *one* run
 * somebody can reproduce. That rule is why the whole table was retaken to add a single
 * 11.0 s file.
 *
 * ## Entries below the cut are listed too, on purpose
 *
 * Everything down to roughly 300 ms is here, so the neighbourhood of the boundary is
 * visible and a file that crosses it is a one-line diff against a recorded number rather
 * than a rediscovery. Faster files are omitted.
 *
 * ## Mechanism, where it was actually established
 *
 * Filename is not a usable signal and neither is the obvious mechanical proxy:
 * grepping for `node:child_process` or `docker` selects a different set —
 * `disclosure-gate`, `purity` and `vocabulary` all spawn real processes and are fast,
 * while `transport-bounds` and `admission` import neither and are among the slowest.
 * The mechanism notes below are only on the files where a previous pass verified one.
 * The rest are deliberately unannotated rather than guessed at.
 */
const MEASURED_NODE_SPANS: readonly (readonly [string, number])[] = [
  ['tools/aot/lift.node.test.ts', 245_713],
  ['packages/node/src/bench-attestation.node.test.ts', 222_179],
  ['packages/node/src/discovery-agents.node.test.ts', 32_152],
  ['packages/node/src/certificate-verification.node.test.ts', 25_712],
  ['packages/node/src/enrollment.node.test.ts', 24_291],
  ['packages/node/src/sovereignty-placement.node.test.ts', 21_881],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 18_147],
  ['packages/node/src/orphan-leash.node.test.ts', 14_281],
  ['packages/node/src/peer-gate.node.test.ts', 11_140],
  ['packages/node/src/peer-dial.node.test.ts', 11_074],
  ['packages/node/src/enrollment-cost.node.test.ts', 11_039],
  ['packages/node/src/transport-bounds.node.test.ts', 10_796],
  ['packages/node/src/quorum-agents.node.test.ts', 10_120],
  ['packages/node/src/admission.node.test.ts', 8_326],
  ['packages/node/src/duty-cycle.node.test.ts', 5_125],
  ['packages/node/src/fabric-node.node.test.ts', 4_463],
  ['packages/node/src/two-process.node.test.ts', 4_406],
  ['packages/node/src/discover-arm.node.test.ts', 4_217],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 4_073],
  ['packages/node/src/capability-dispatch.node.test.ts', 3_925],
  ['packages/node/src/owner-domain-agents.node.test.ts', 3_871],
  ['packages/node/src/node-records.node.test.ts', 3_561],
  ['packages/node/src/signed-artifact.node.test.ts', 3_523],
  ['packages/node/src/result-signature.node.test.ts', 3_513],
  ['packages/node/src/peer-verifier.node.test.ts', 2_919],
  ['packages/demo/src/kernel.test.ts', 2_371],
  ['packages/node/src/trust-anchors.node.test.ts', 2_307],
  ['packages/node/src/execution-deadline.node.test.ts', 2_305],
  ['packages/node/src/provider-answering.node.test.ts', 2_145],
  ['packages/node/src/egress-manifest.node.test.ts', 1_993],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 1_968],
  ['packages/node/src/egress-refusal.node.test.ts', 1_353],
  ['packages/node/src/relaying.node.test.ts', 1_214],
  ['packages/node/src/named-refusal.node.test.ts', 1_019],
  ['packages/node/src/combine-signature.node.test.ts', 1_012],
  // ---- below the cut; listed so the boundary is visible, not excluded ----
  ['packages/net/src/churn.test.ts', 974],
  ['packages/node/src/node-enrollment.node.test.ts', 965],
  ['packages/core/src/enrollment.test.ts', 688],
  ['packages/node/src/disclosure-gate.node.test.ts', 610],
  ['tools/aot/cli.node.test.ts', 581],
  ['packages/net/src/discovery.test.ts', 578],
  ['packages/net/src/provider-merge.test.ts', 536],
  ['packages/node/src/rendezvous-wire.node.test.ts', 528],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 461],
  ['packages/node/src/fs-blockstore.node.test.ts', 427],
  ['packages/core/src/job/submit.test.ts', 395],
  ['packages/aot/src/wasi-real.node.test.ts', 379],
  ['packages/net/src/discover-candidates.test.ts', 358],
  ['packages/net/src/sovereign-egress.test.ts', 304],
]

/**
 * The `node` specs that dominate its wall clock, excluded by `test:unit`.
 *
 * Derived, never edited by hand. To change what is excluded, re-measure and update
 * `MEASURED_NODE_SPANS`; to change the rule, change `SLOW_CUTOFF_MS`.
 */
const SLOW_NODE_SPECS: readonly string[] = MEASURED_NODE_SPANS.filter(
  ([, ms]) => ms >= SLOW_CUTOFF_MS,
).map(([path]) => path)

/**
 * Switched here rather than on the command line because vitest 4.1.10's
 * `--exclude` flag does not do what `--help` says once `projects` are configured.
 * Measured: `--project node --exclude 'tools/aot/lift.node.test.ts'` ran all 74
 * files unchanged, and `--exclude '**\/*.node.test.ts'` *raised* the count to 75
 * and pulled the browser specs into the Node environment — it replaces a project's
 * own `exclude` instead of adding to it. A `test:unit` built on that flag would
 * silently run the full set and still print green.
 */
const UNIT_ONLY = process.env['O2_UNIT_ONLY'] === '1'

/**
 * The `perf` project exists only when asked for — `npm run test:perf`.
 *
 * Switched here in the config rather than by a CLI flag, because a project declared
 * unconditionally is part of a bare `vitest run` and
 * `packages/bench/src/perf-gate.perf.test.ts` must not be. It stands up three fabrics and
 * runs 303 jobs plus 303 reference passes, its numbers are only meaningful against the
 * committed baseline in `perf-baseline.ts`, and a wall-clock measurement folded into the
 * everything-run would add minutes and a load-dependent failure mode to every change.
 *
 * `*.perf.test.ts` is therefore excluded from `node` and from `browser` as well. Both
 * halves are needed: the exclusions keep the file out of the default projects, and the
 * conditional keeps the project that does run it out of the default run. Either one alone
 * leaves the gate either running everywhere or reachable nowhere.
 */
const PERF_GATE = process.env['O2_PERF'] === '1'

/**
 * DET-07 — the identical suite runs under every target.
 *
 * The kernel has no platform imports, so the same test files run unchanged in
 * Node and in a real browser. Any test that only passes in one of them means a
 * platform assumption leaked into `@o2/core`, which is exactly what this config
 * exists to catch.
 *
 * The provider comes from `@vitest/browser-playwright` as a *function*. The
 * `provider: 'playwright'` string form is vitest 3.x and silently does nothing on
 * 4.x.
 *
 * Four projects, split by what a test needs rather than by what it covers:
 *
 *   node     everything that runs in a plain Node process
 *   browser  the same portable specs, in real Chromium
 *   e2e      specs that drive Playwright themselves — see below
 *   perf     the perf gate, present only under `O2_PERF=1` — see `PERF_GATE`
 */
export default defineConfig({
  test: {
    /**
     * Coverage is an instrument, not a gate — see `.planning/COVERAGE-BASELINE.md`
     * for the first measurement this project has ever taken and for what a floor
     * would have to be worth before it is set.
     *
     * Deliberately no `thresholds` block. A floor picked before anyone had seen the
     * number would be arbitrary in both directions: high enough to block work that
     * is fine, or low enough to certify a regression as passing. Setting one is a
     * separate deliberate act, taken against a number that exists.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      /**
       * Named explicitly rather than left to default. The v8 provider otherwise
       * reports only files a test happened to load, so a source file with no test
       * at all is absent from the denominator and the percentage flatters itself.
       * An honest baseline has to count the untested files as zero.
       */
      include: ['packages/*/src/**/*.ts', 'tools/**/*.ts'],
      exclude: [
        // Test files measure; they are not the thing measured. Counting them
        // inflates every number, because a test file is by construction fully
        // executed by its own run.
        '**/*.test.ts',
        // Re-export barrels only. Verified by reading all eight: every statement is
        // `export ... from`, so there is no branch and no statement that a test
        // could meaningfully exercise. A barrel reads as 100% or 0% depending on
        // whether anything imported it, and neither number says anything.
        '**/index.ts',
        // Test inputs, not tested logic. A fixture's correctness is asserted by the
        // tests that consume it; covering the fixture itself measures nothing.
        '**/*fixture*.ts',
        '**/fixtures/**',
        // Type declarations emit no runtime code, so there is nothing to execute.
        '**/*.d.ts',
        // Generated byte blobs — a `Uint8Array` literal of compiled WASM produced by
        // a build script. There is no logic here to cover, and the file's size would
        // dominate any line count it appeared in.
        '**/kernel-bytes.ts',
        '**/wasi-fixture-bytes.ts',
        // The mutation-planting driver behind `npm run test:mutations`. It is
        // deliberately NOT a `*.test.ts`, because it rewrites source files and vitest
        // runs test files in parallel — a spec that edits `agent.ts` while another
        // file imports it is chaos. Being a plain script, no spec loads it, so the v8
        // provider read it as 0 of 85 statements and dragged `packages/node/src` from
        // 70.38% to 54.94% on a run where no covered code had changed. The tool that
        // measures the guards is not itself one of the guards.
        '**/*.mutate.ts',
      ],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          // `tools/` holds the build-time drivers — they shell out to containers and
          // could not run in a browser even in principle, so only this project sees
          // them. Their suffix still has to say `.node.test.ts`, so the rule stays
          // one rule.
          include: ['packages/*/src/**/*.test.ts', 'tools/**/*.node.test.ts'],
          // `?worker` is a browser bundling concern; that target runs in the
          // browser project only. `*.e2e.test.ts` has its own project.
          //
          // `SLOW_NODE_SPECS` is appended only under `test:unit` (O2_UNIT_ONLY=1).
          // A bare `vitest run` sees the full set, so the everything-run count is
          // unchanged and no spec becomes unreachable by default.
          exclude: [
            '**/*.browser.test.ts',
            '**/*.e2e.test.ts',
            // The perf gate has its own project — see `PERF_GATE`.
            '**/*.perf.test.ts',
            ...(UNIT_ONLY ? SLOW_NODE_SPECS : []),
          ],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.browser.test.ts'],
          // `@o2/node` holds the adapters that exist precisely because a browser
          // cannot do these things — real sockets, a filesystem, child processes.
          // Its specs are Node-only by definition; the symmetric counterpart of
          // the browser project's `*.browser.test.ts`.
          exclude: ['**/*.node.test.ts', '**/*.e2e.test.ts', '**/*.perf.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            /**
             * Three engines, per STACK.md line 111 and the owner ruling recorded in
             * ROADMAP.md line 495. Chromium alone was the standing state and is what
             * the ruling calls out as blocking four deferred items.
             *
             * Three engines on one host are three independent implementations with
             * three independent storage backends. They are **not** three machines,
             * and no result obtained here may be labelled cross-machine or
             * distributed-hardware — the ruling is explicit about that.
             *
             * A spec that fails in only one engine is the finding this matrix exists
             * to produce. Narrowing the matrix back to hide such a failure would
             * destroy the only instrument that can see it.
             */
            instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
          },
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['packages/*/src/**/*.e2e.test.ts'],
          /**
           * One file at a time.
           *
           * Each of these launches its own Chromium, its own relay, and its own
           * Vite server. Run in parallel they contend for CPU and sockets, and the
           * symptom is a timeout in whichever one lost — a flake that looks like a
           * WebRTC or relay bug and is neither. Observed once under load from a
           * concurrent `git push`, which is exactly the kind of intermittency that
           * is expensive to chase later.
           *
           * Serialising costs wall-clock and buys determinism. For tests whose
           * whole job is to prove real network behaviour, that is the right trade.
           */
          fileParallelism: false,
        },
      },
      ...(PERF_GATE
        ? [
            {
              test: {
                name: 'perf',
                environment: 'node',
                include: ['packages/*/src/**/*.perf.test.ts'],
                /**
                 * One file at a time, for the same reason `e2e` serialises and a
                 * sharper one: this project's assertions *are* wall-clock
                 * measurements. Two perf files running concurrently would contend for
                 * the CPU they are measuring, and each would report the other's cost
                 * as its own.
                 */
                fileParallelism: false,
              },
            },
          ]
        : []),
    ],
  },
})
