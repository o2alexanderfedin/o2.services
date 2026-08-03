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
   * 1-minute load average, sampled at the run's two endpoints only.
   *
   * **This reading was taken on a contended host and is the weaker of the two, and the
   * previous one was quiet** — the exact reverse of the sentence that stood here, and it
   * is said plainly rather than left for a reader to infer from the numbers. It began at
   * 8.98 on 8 cores and ended at 11.28. Sum-of-spans rose from 416.7 s to 689.4 s and wall
   * clock from 210.5 s to 306.8 s for **six more files**, so most of that movement is the
   * host rather than the tree.
   *
   * **`loadPeak` here is the highest figure actually sampled, not a peak.** The previous
   * reading polled every 15 s and could report a real mid-run maximum; this one did not,
   * and inventing one would be the class of number this whole object exists to stop. What
   * *is* known is that the 5-minute average read 16.13 and the 15-minute average 14.10 at
   * the moment the run ended, both above every 1-minute figure sampled — so the true peak
   * was higher than 11.28 and is **unmeasured**.
   *
   * ## Why a weaker reading replaced a better one
   *
   * Not by choice. Plan 19-15 added `result-signature.node.test.ts`, which took the node
   * project from 132 files to 133 against a recorded 127 — past
   * `slow-specs.node.test.ts`'s tolerance of 5, which had already been sitting exactly at
   * its limit. The alternatives were to raise the tolerance, which is weakening a guard to
   * avoid work, or to paste one measured entry into a table from another run, which
   * `MEASURED_NODE_SPANS` explicitly refuses: *"pinning entries at their old values would
   * make this table a blend of two runs, and its whole worth is that it is one run
   * somebody can reproduce."* A noisy span is recoverable by re-measuring on a quiet host;
   * a stale inventory decides whether a file is excluded **at all**.
   */
  load: 8.98,
  loadAtEnd: 11.28,
  loadPeak: 11.28,
  /** Files and tests the `node` project ran, i.e. with no `test:unit` exclusions. */
  files: 133,
  tests: 1883,
  /** Sum of per-file spans. Not wall clock — vitest runs files in parallel. */
  sumOfFileSpansMs: 689_390,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 306_830,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * `unitFiles` is not an independent reading — `slow-specs.node.test.ts` asserts it
   * equals `files` minus the derived exclusion count, so it moves when the table does.
   * It was **also observed directly at 97** by running `npm run test:unit` against this
   * table, which is the cross-check that the derivation and the runner agree. Deriving
   * it alone would make the assertion a tautology.
   *
   * `unitTests` is the run's total including the one skipped case — 1514 passed, 1 skipped
   * — because the figure this field is compared against by hand is what the reporter
   * prints, and it prints the total.
   *
   * `unitWallClockMs` is **one reading of a passing run at a stated load** — 9.97 s at
   * 1-minute load 8.38 rising to 10.70 across the run — and is not a bound. Read it as
   * "about ten seconds", and read the fact that the previous recorded figure was 5.96 s at
   * load 5.6 as the reason this object records a load at all rather than a duration on its
   * own: the tree grew by six files between the two, and the host by three points of load.
   *
   * **Durations from red runs are deliberately never recorded here.** Two candidates were
   * discarded on that rule during an earlier session — 6.24 s taken while three assertions
   * were failing, and 5.91 s taken while `slow-specs` itself was failing on the very count
   * this field feeds. A duration measured on a suite that did not pass is not a duration
   * for the suite this field claims to describe. The 9.97 s above is from a green run:
   * `97 passed (97)`, exit 0.
   */
  unitFiles: 97,
  unitTests: 1515,
  unitWallClockMs: 9_970,
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
 * `vitest run --project node --reporter=json`, **2026-08-03**, 133 files / 1883 tests.
 * Sum-of-file-spans 689.4 s against 306.8 s of wall clock, the difference being vitest's
 * own parallelism. Distribution: median 164 ms, p75 1124 ms, p90 8062 ms. Load average
 * 8.98 at the start and 11.28 at the end, **with no mid-run sample** — see
 * `NODE_MEASUREMENT.load`, which records what that costs and why the number was not
 * invented.
 *
 * **This run was taken on a contended host and is the weaker of the two readings**, and
 * it replaced a quiet one — which is the reverse of the last two replacements and is the
 * reason `NODE_MEASUREMENT` carries a paragraph about why a worse reading was taken. The
 * short version: the node project reached 133 files against a recorded 127, past
 * `slow-specs.node.test.ts`'s tolerance, and a stale inventory is a worse failure than a
 * noisy span because the inventory is what decides whether a file is excluded *at all*.
 *
 * The measurement replaced was taken on 2026-08-02 on a quiet host at load 5.7→5.8, peak
 * 14.1: 127 files / 1782 tests, sum 416.7 s, wall clock 210.5 s, and 28 files at or above
 * the cut. **Re-measuring this table on a quiet host is worth doing** and needs no
 * decision from anybody — it is one command and this docblock is the instruction.
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
 * | 2026-08-03 — **the table below** | 8.98 → 11.28, no mid-run sample | 36 |
 *
 * The last two rows make the point twice over and in opposite directions. The 2026-08-02
 * run held **seven more files** than the run above it and selected **eight fewer** as
 * slow; the 2026-08-03 run holds **six more files still** and selects **eight more**,
 * putting the count back exactly where the 2026-08-01 run had it. Both movements are the
 * host. In the first, eleven files crossed from above the cut to below it without being
 * touched — `enrol-agent`, `fs-blockstore`, `identity-store`, `primes-reduce`,
 * `wasi-executor`, `sovereign-execution`, `node-identity`, `core/discovery`,
 * `disclosure-gate`, `start-unwind`, `relayed-job`. Nothing about them changed; the
 * host did. In the second, eight crossed back the other way, and only one of the
 * thirty-six — `result-signature.node.test.ts` — is genuinely new.
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
 * The 36 excluded files are **97.4 %** of the 689.4 s. The 97 that remain total
 * **18.1 s of test time**. `lift.node.test.ts` alone is 305.3 s — 44 % of the suite in
 * one file, and the single strongest argument for the cut existing at all.
 *
 * The excluded set grew from 28 back to 36 while the project grew by six files, which
 * pulls the inner loop the right way this time — but for the wrong reason, since eight of
 * those files re-crossed the cut on a timing difference rather than on a change to them.
 * It is left as measured anyway: pinning entries at their old values would make this
 * table a blend of two runs, and its whole worth is that it is *one* run somebody can
 * reproduce.
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
  ['tools/aot/lift.node.test.ts', 305_276],
  ['packages/node/src/discovery-agents.node.test.ts', 49_403],
  ['packages/node/src/enrollment.node.test.ts', 42_017],
  ['packages/node/src/certificate-verification.node.test.ts', 33_369],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 27_091],
  ['packages/node/src/orphan-leash.node.test.ts', 25_100],
  ['packages/node/src/peer-dial.node.test.ts', 23_287],
  ['packages/node/src/sovereignty-placement.node.test.ts', 22_196],
  ['packages/node/src/transport-bounds.node.test.ts', 13_819],
  ['packages/node/src/peer-gate.node.test.ts', 13_386],
  ['packages/node/src/signed-artifact.node.test.ts', 12_140],
  ['packages/node/src/admission.node.test.ts', 10_823],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 9735],
  ['packages/node/src/two-process.node.test.ts', 8672],
  ['packages/node/src/fabric-node.node.test.ts', 8062],
  ['packages/node/src/capability-dispatch.node.test.ts', 7564],
  ['packages/node/src/discover-arm.node.test.ts', 6616],
  ['packages/node/src/duty-cycle.node.test.ts', 6076],
  ['packages/node/src/result-signature.node.test.ts', 6066],
  ['packages/node/src/trust-anchors.node.test.ts', 4930],
  ['packages/node/src/node-records.node.test.ts', 3918],
  ['packages/demo/src/kernel.test.ts', 3642],
  ['packages/node/src/peer-verifier.node.test.ts', 3469],
  ['packages/node/src/egress-refusal.node.test.ts', 2814],
  ['packages/node/src/relaying.node.test.ts', 2508],
  ['packages/node/src/egress-manifest.node.test.ts', 2495],
  ['packages/node/src/execution-deadline.node.test.ts', 2405],
  ['packages/node/src/provider-answering.node.test.ts', 2118],
  ['packages/node/src/node-enrollment.node.test.ts', 2077],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 1971],
  ['packages/node/src/named-refusal.node.test.ts', 1961],
  ['packages/core/src/enrollment.test.ts', 1851],
  ['tools/aot/cli.node.test.ts', 1204],
  ['packages/node/src/combine-signature.node.test.ts', 1124],
  ['packages/node/src/rendezvous-wire.node.test.ts', 1078],
  ['packages/net/src/churn.test.ts', 1061],
  // ---- below the cut; listed so the boundary is visible, not excluded ----
  ['packages/net/src/discovery.test.ts', 893],
  ['packages/node/src/fs-blockstore.node.test.ts', 880],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 816],
  ['packages/net/src/discover-candidates.test.ts', 815],
  ['packages/core/src/job/submit.test.ts', 757],
  ['packages/node/src/disclosure-gate.node.test.ts', 744],
  ['packages/core/src/discovery.test.ts', 720],
  ['packages/node/src/pi-reduce.node.test.ts', 691],
  ['packages/node/src/node-identity.node.test.ts', 677],
  ['packages/net/src/enrol-agent.test.ts', 655],
  ['packages/aot/src/wasi-real.node.test.ts', 651],
  ['packages/net/src/provider-merge.test.ts', 642],
  ['packages/node/src/start-unwind.node.test.ts', 547],
  ['packages/node/src/primes-reduce.node.test.ts', 517],
  ['packages/net/src/sovereign-execution.test.ts', 493],
  ['packages/node/src/identity-store.node.test.ts', 457],
  ['packages/core/src/result-attestation.test.ts', 439],
  ['packages/aot/src/wasi-executor.test.ts', 435],
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
