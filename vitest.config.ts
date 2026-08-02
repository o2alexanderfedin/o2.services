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
  date: '2026-08-01',
  /** 1-minute load average, start and end of the run. It rose while the run went on. */
  load: 20.9,
  loadAtEnd: 42.3,
  /** Files and tests the `node` project ran, i.e. with no `test:unit` exclusions. */
  files: 113,
  tests: 1611,
  /** Sum of per-file spans. Not wall clock — vitest runs files in parallel. */
  sumOfFileSpansMs: 594_300,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 353_000,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * Two consecutive readings at load ~16 gave 7.07 s and 5.35 s. The spread is the
   * same load sensitivity the table's own note is about; the figure here is the
   * faster of the two and should be read as "about five seconds", not as a bound.
   */
  unitFiles: 77,
  unitTests: 1141,
  unitWallClockMs: 5_350,
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
 * `vitest run --project node --reporter=json`, **2026-08-01**, 113 files / 1611 tests,
 * 0 failures. Sum-of-file-spans 594.3 s against 353 s of wall clock, the difference
 * being vitest's own parallelism. Distribution: median 167 ms, p75 2198 ms, p90 8087 ms.
 * Load average 20.9 rising to 42.3 — other agents were building on this host
 * throughout, and that is recorded because it changes the answer.
 *
 * ## An absolute millisecond cut is not reproducible, and this is the evidence
 *
 * The same rule was applied to **three** runs of the same tree on the same machine
 * within one hour, and selected a different set each time:
 *
 * | run | 1-min load | files at or above 1 s |
 * |---|---|---|
 * | 2026-07-29 (recorded by the prior pass) | ~9 | 23 |
 * | this pass, run 1 | 53 → 108 | 29 |
 * | this pass, run 2 | 10 → 25 | 28 |
 * | this pass, run 3 — **the table below** | 21 → 42 | 36 |
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
 * The 36 excluded files are **98.1 %** of the 594.3 s. The 77 that remain total
 * **11.4 s of test time across 1141 tests**, and `npm run test:unit` wall-clocks at
 * about **5 s**. `lift.node.test.ts` alone is 318 s — 54 % of the suite in one file.
 *
 * For contrast with what this replaces: under the old nine-file list the same tree
 * gives 103 files / 1427 tests, which is the 102 / 1411 / 24.03 s the audit recorded
 * plus the two guard files added by this pass.
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
  ['tools/aot/lift.node.test.ts', 318366],                            // 48 `docker` invocations via execFileSync
  ['packages/node/src/enrollment.node.test.ts', 51460],
  ['packages/node/src/certificate-verification.node.test.ts', 30184],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 19828],
  ['packages/demo/src/kernel.test.ts', 17349],                        // heavy WASM build, 120 s testTimeout
  ['packages/node/src/peer-gate.node.test.ts', 12506],
  ['packages/node/src/transport-bounds.node.test.ts', 12141],         // waits out real 3/10/20 s RPC timeouts
  ['packages/node/src/signed-artifact.node.test.ts', 11053],
  ['packages/node/src/capability-dispatch.node.test.ts', 9390],
  ['packages/node/src/admission.node.test.ts', 9160],                 // CPU-bound WASM synthesis, 120 s testTimeout
  ['packages/node/src/fabric-node.node.test.ts', 8501],               // real libp2p nodes, 120 s testTimeout
  ['packages/node/src/two-process.node.test.ts', 8417],               // 8 real `spawn` calls
  ['packages/node/src/orphan-leash.node.test.ts', 8087],
  ['packages/node/src/sovereignty-placement.node.test.ts', 6924],     // 6 real `spawn` calls
  ['packages/node/src/egress-refusal.node.test.ts', 5701],            // 10 real `spawn` calls
  ['packages/node/src/relaying.node.test.ts', 5068],
  ['packages/net/src/enrol-agent.test.ts', 4294],
  ['packages/node/src/egress-manifest.node.test.ts', 4129],
  ['packages/node/src/node-records.node.test.ts', 3583],
  ['packages/node/src/rendezvous-wire.node.test.ts', 3437],
  ['packages/node/src/node-enrollment.node.test.ts', 3436],
  ['packages/net/src/discovery.test.ts', 2991],
  ['packages/node/src/peer-verifier.node.test.ts', 2975],
  ['packages/node/src/execution-deadline.node.test.ts', 2621],
  ['packages/node/src/primes-reduce.node.test.ts', 2372],
  ['packages/node/src/fs-blockstore.node.test.ts', 2320],
  ['packages/aot/src/wasi-executor.test.ts', 2217],
  ['packages/node/src/identity-store.node.test.ts', 2215],
  ['packages/net/src/sovereign-execution.test.ts', 2198],
  ['packages/core/src/discovery.test.ts', 2045],
  ['packages/node/src/node-identity.node.test.ts', 1912],
  ['packages/node/src/relayed-job.node.test.ts', 1417],
  ['packages/node/src/disclosure-gate.node.test.ts', 1330],
  ['packages/node/src/start-unwind.node.test.ts', 1155],
  ['tools/aot/cli.node.test.ts', 1100],
  ['packages/node/src/named-refusal.node.test.ts', 1022],
  // ---- below the cut; listed so the boundary is visible, not excluded ----
  ['packages/net/src/churn.test.ts', 961],                            // 800k-iteration churn loop
  ['packages/aot/src/fixtures/wasi-fixtures.node.test.ts', 797],
  ['packages/net/src/distributed.test.ts', 690],
  ['packages/node/src/purity.node.test.ts', 620],
  ['packages/libp2p/src/identity.test.ts', 603],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 580],
  ['packages/net/src/reduce-job.test.ts', 483],
  ['packages/net/src/remote-executor-contract.test.ts', 423],
  ['packages/net/src/enrol-protocol.test.ts', 417],
  ['packages/core/src/reduce.test.ts', 406],
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
