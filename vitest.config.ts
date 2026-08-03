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
   * **A real peak, polled and not inferred** — the discipline the previous reading
   * introduced, followed here. Seven samples on 8 cores: 9.16 → **29.14** → 23.92 →
   * 15.74 → 10.63 → 8.39 → 7.25. Same shape as the reading it replaces — contended for
   * the first ninety seconds, quiet by the end — which is what makes the two comparable
   * despite everything else about them differing.
   *
   * The wall clock came out **identical to the run before it, 253 s**, across a tree that
   * grew by one file and 163 s of new test time. That is vitest's parallelism absorbing a
   * long file that spends almost all of its span waiting on a child process, and it is the
   * reason `sumOfFileSpansMs` and `wallClockMs` are both recorded rather than one standing
   * for the other.
   */
  load: 9.16,
  loadAtEnd: 7.25,
  loadPeak: 29.14,
  /** Files and tests the `node` project ran, i.e. with no `test:unit` exclusions. */
  files: 135,
  tests: 1890,
  /** Sum of per-file spans. Not wall clock — vitest runs files in parallel. */
  sumOfFileSpansMs: 693_872,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 253_000,
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
   * bound: 8.37 s at 1-minute load 11.70 rising to 15.03, on a run reporting
   * `101 passed (101)` and exit 0. Read it as under ten seconds, and read the recorded
   * history — 5.96 s at load 5.6, then 9.97 s at load 8.4, then 7.49 s at load 6.1, now
   * 8.37 s at load 11.7 over **seven more files** — as the reason this object records a
   * load at all rather than a duration on its own.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured
   * on a suite that did not pass is not a duration for the suite this field claims to
   * describe. That rule bit on the way to this reading and is worth recording: the first
   * `test:unit` run against this table came back 7.97 s and **red**, because
   * `slow-specs.node.test.ts` was still holding the previous run's `unitFiles`. Its 7.97 s
   * is not written down anywhere.
   */
  unitFiles: 101,
  unitTests: 1578,
  unitWallClockMs: 8_370,
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
 * `vitest run --project node --reporter=json`, **2026-08-03**, 135 files / 1890 tests, on
 * a **green** run — exit 0, 1888 passed, 2 skipped. Sum-of-file-spans 693.9 s against
 * 253.0 s of wall clock, the difference being vitest's own parallelism. Load average
 * polled every 40 s: 9.16 at the start, **29.14 at its peak forty seconds in**, 7.25 at
 * the end.
 *
 * The measurement replaced was taken earlier the same day, 134 files / 1886 tests, sum
 * 565.3 s, wall clock 263.0 s, 40 files at or above the cut, load polled 7.41 → 30.71 →
 * 5.75. The two are the same tree plus `bench-attestation.node.test.ts` and the same
 * load shape, so this pair is the most comparable in the history below — and **the
 * exclusion count still fell, 40 to 34**, while the tree grew. Seven files crossed down on
 * timing alone. That is the point the table below makes at length: membership near a
 * millisecond cut is noise, and the list is evidence rather than a decision anyone made.
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
 * | 2026-08-03, run 2 — the table until this one | 7.41 → 30.71 → 5.75, polled every 40 s | 40 |
 * | 2026-08-03, run 3 — **the table below** | 9.16 → 29.14 → 7.25, polled every 40 s | 34 |
 *
 * The rows make the point repeatedly and in both directions. Between the last two —
 * **the closest pair in this table, same host, same load shape, one file added** — exactly
 * one file crossed *up*, and it is the added one; **seven crossed down**:
 * `core/job/submit` (1771 → 532 ms), `sovereign-block-refusal` (1651 → 579),
 * `rendezvous-wire` (1466 → 613), `fs-blockstore` (1398 → 540), `net/churn` (1114 → 962),
 * and — below 400 ms and therefore out of the table entirely — `core/discovery` (1354 →)
 * and `identity-store` (1038 →). Nothing about any of the seven changed. Between the two
 * before that, six crossed up and two down, also on nothing.
 *
 * Membership near the boundary is noise: `churn.test.ts` read 1134 ms in one run and
 * 961 ms in the next, crossing the cut without changing. **So the list cannot be made
 * to enforce itself by re-timing** — a guard that re-measured would disagree with
 * itself between runs, and the only stable thing to check is structure. That is what
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
 * The 34 excluded files are **97.9 %** of the 693.9 s. The 101 that remain total
 * **14.3 s of test time**. `lift.node.test.ts` alone is 250.2 s and
 * `bench-attestation.node.test.ts` 163.0 s — 60 % of the suite in two files, and the
 * single strongest argument for the cut existing at all.
 *
 * The excluded set **fell** from 40 to 34 while the project grew by one file, and every
 * one of the seven that left re-crossed the cut on a timing difference rather than on a
 * change to it. It is left as measured anyway: pinning entries at their old values would
 * make this table a blend of two runs, and its whole worth is that it is *one* run
 * somebody can reproduce.
 *
 * ## Entries below the cut are listed too, on purpose
 *
 * Everything down to 400 ms is here, so the neighbourhood of the boundary is visible
 * and a file that crosses it is a one-line diff against a recorded number rather than
 * a rediscovery. Files under 400 ms are omitted.
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
  ['tools/aot/lift.node.test.ts', 250_184],
  ['packages/node/src/bench-attestation.node.test.ts', 162_984],
  ['packages/node/src/discovery-agents.node.test.ts', 36_281],
  ['packages/node/src/enrollment.node.test.ts', 29_033],
  ['packages/node/src/certificate-verification.node.test.ts', 27_600],
  ['packages/node/src/sovereignty-placement.node.test.ts', 22_641],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 19_558],
  ['packages/node/src/orphan-leash.node.test.ts', 15_625],
  ['packages/node/src/peer-dial.node.test.ts', 14_756],
  ['packages/node/src/quorum-agents.node.test.ts', 12_665],
  ['packages/node/src/peer-gate.node.test.ts', 11_147],
  ['packages/node/src/transport-bounds.node.test.ts', 10_761],
  ['packages/node/src/admission.node.test.ts', 8_694],
  ['packages/node/src/duty-cycle.node.test.ts', 5_192],
  ['packages/node/src/capability-dispatch.node.test.ts', 4_699],
  ['packages/node/src/result-signature.node.test.ts', 4_662],
  ['packages/node/src/signed-artifact.node.test.ts', 4_421],
  ['packages/node/src/fabric-node.node.test.ts', 4_174],
  ['packages/node/src/discover-arm.node.test.ts', 4_003],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 3_238],
  ['packages/node/src/node-records.node.test.ts', 3_237],
  ['packages/node/src/two-process.node.test.ts', 3_121],
  ['packages/node/src/peer-verifier.node.test.ts', 2_722],
  ['packages/node/src/trust-anchors.node.test.ts', 2_214],
  ['packages/node/src/execution-deadline.node.test.ts', 2_187],
  ['packages/demo/src/kernel.test.ts', 2_077],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 2_067],
  ['packages/node/src/provider-answering.node.test.ts', 1_966],
  ['packages/node/src/egress-manifest.node.test.ts', 1_717],
  ['packages/node/src/egress-refusal.node.test.ts', 1_503],
  ['packages/node/src/relaying.node.test.ts', 1_195],
  ['packages/node/src/node-enrollment.node.test.ts', 1_107],
  ['packages/node/src/combine-signature.node.test.ts', 1_079],
  ['packages/node/src/named-refusal.node.test.ts', 1_062],
  // ---- below the cut; listed so the boundary is visible, not excluded ----
  ['packages/core/src/enrollment.test.ts', 984],
  ['packages/net/src/churn.test.ts', 962],
  ['packages/node/src/disclosure-gate.node.test.ts', 699],
  ['packages/node/src/rendezvous-wire.node.test.ts', 613],
  ['tools/aot/cli.node.test.ts', 605],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 579],
  ['packages/net/src/discovery.test.ts', 560],
  ['packages/node/src/fs-blockstore.node.test.ts', 540],
  ['packages/core/src/job/submit.test.ts', 532],
  ['packages/net/src/provider-merge.test.ts', 503],
  ['packages/net/src/enrol-agent.test.ts', 501],
  ['packages/aot/src/wasi-real.node.test.ts', 466],
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
