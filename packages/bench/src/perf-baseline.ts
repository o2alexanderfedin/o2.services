/**
 * The committed performance baseline — data, and the thresholds measured against it.
 *
 * ## Re-baselining is a deliberate human act, never a side effect of a run
 *
 * Nothing in this repository writes to this file. No `--update` flag exists, and the
 * gate has no path that rewrites it. If the gate goes red, the two honest responses are
 * to fix the regression or to decide — in a commit whose message says so — that the new
 * cost is understood and intended, and then edit these numbers by hand. A gate that
 * silently absorbs whatever the last run produced measures nothing: it only ever agrees
 * with the present, which is precisely the property that makes a perf baseline
 * worthless.
 *
 * ## How these numbers were produced
 *
 * `measureGateLadder()` from `perf-workload.ts`, at its committed defaults (101 runs per
 * rung, cold iteration discarded, 100 measured samples), run 27 times end to end from a
 * scratch directory. The published driver `packages/node/src/bin/bench.ts` was also run
 * — `--quick` and full — from a scratch working directory so that
 * `.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json` were not regenerated;
 * both were confirmed byte-identical afterwards with `cmp`. The value stored for each
 * statistic is the **median across the 27 passes**, not the best or the last: a median
 * is what survives one contended pass without needing the contended pass to be excluded
 * by hand.
 *
 * ## Why two of the three gated numbers are ratios
 *
 * Absolute milliseconds are not a stable measurement on a developer machine, and that is
 * a measurement rather than an opinion. Across the same 27 passes the absolute p95
 * makespan at 2 nodes ranged over a factor of **8.5** while the machine was doing other
 * work. Under a deliberately pathological load — eight busy-wait loops on eight cores,
 * load average 116 — it ranged over a factor of 10. There is no threshold on that
 * statistic that is both non-flaky and meaningful.
 *
 * The paired coordination ratio (`fabric ÷ the same shards executed locally, measured
 * microseconds apart`) is far better behaved: its p50 moved over a factor of 1.09 across
 * the same 27 passes and moved *down*, not up, under the pathological load. See
 * {@link PERF_BASELINE.observedSpread} for every figure this paragraph summarises.
 */

/** One rung of the ladder. `nodes` is the key the gate joins on. */
export interface BaselineRung {
  readonly nodes: number
  /**
   * Median of the per-iteration `fabric ÷ local-execution` ratio.
   *
   * The most stable thing measured here and therefore the tightest budget. A change in
   * how much the fabric costs on top of executing the same shards locally shows up here
   * first.
   */
  readonly coordinationRatioP50: number
  /** 95th percentile of the same ratio — the tail, and the looser of the two budgets. */
  readonly coordinationRatioP95: number
  /** Absolute makespan p50, in ms. Gated loosely; the backstop, see the note below. */
  readonly makespanP50Ms: number
  /**
   * Absolute makespan p95, in ms. **Recorded, not gated.**
   *
   * Carried because a baseline that omits it cannot be checked by a human reading the
   * published tables, and because its own spread is the evidence for why the gated
   * statistics are ratios. Measured spread across the 27 passes was up to 8.5×, so any
   * budget wide enough not to fire on load would only fire on an outage.
   */
  readonly makespanP95Ms: number
}

/**
 * Fractional headroom above the baseline before a statistic counts as regressed.
 *
 * `budget = baseline × (1 + headroom)`. Every one of these was chosen from the measured
 * run-to-run spread in {@link PerfBaseline.observedSpread} and not from taste — the
 * reasoning is on each field.
 */
export interface PerfHeadroom {
  /** 0.30 ⇒ budget 1.30×, against a worst observed pass of 1.094×. */
  readonly coordinationRatioP50: number
  /** 1.50 ⇒ budget 2.50×, against a worst observed pass of 2.089×. */
  readonly coordinationRatioP95: number
  /** 5.00 ⇒ budget 6.00×, against a worst observed pass of 4.63×. */
  readonly makespanP50Ms: number
}

/** The worst upward multiple of the baseline actually observed, per statistic. */
export interface ObservedSpread {
  /** Passes the figures below were taken over. */
  readonly passes: number
  /** Worst `observed ÷ baseline` across those passes, over all rungs. */
  readonly coordinationRatioP50: number
  readonly coordinationRatioP95: number
  readonly makespanP50Ms: number
  readonly makespanP95Ms: number
  /**
   * The same figures under eight busy-wait loops on eight cores (load average 116),
   * kept because they are the reason the gate's caveat about a saturated machine is a
   * number rather than a worry.
   */
  readonly underCpuSaturation: {
    readonly passes: number
    readonly coordinationRatioP50: number
    readonly coordinationRatioP95: number
    readonly makespanP50Ms: number
    readonly makespanP95Ms: number
  }
}

export interface PerfBaseline {
  /** Date the numbers were taken. Not a version — the machine below is half the fact. */
  readonly capturedAt: string
  /** The machine, in enough detail that a mismatch is obvious to a reader. */
  readonly machine: string
  /** Ambient state during capture, because it bounds what the numbers mean. */
  readonly conditions: string
  /** Runs per rung the numbers were taken at — `GATE_RUNS` at capture time. */
  readonly runsPerRung: number
  /** Measured samples per rung after the cold iteration is discarded. */
  readonly samplesPerRung: number
  /** Shards per job at capture time — `GATE_SHARDS`. */
  readonly shards: number
  /** Admission limit per node at capture time — `GATE_ADMISSION_LIMIT`. */
  readonly admissionLimit: number
  readonly headroom: PerfHeadroom
  readonly observedSpread: ObservedSpread
  readonly rungs: readonly BaselineRung[]
}

/**
 * The baseline.
 *
 * Every number below was measured on the machine and under the conditions named in the
 * object itself. None of them is derived from another, and none was rounded to look
 * tidy.
 */
export const PERF_BASELINE: PerfBaseline = {
  capturedAt: '2026-07-29',
  machine: 'Apple M1 Pro, 8 logical / 8 physical cores, macOS 26.5.2, node v23.11.0',
  conditions:
    'Shared developer machine with other agent sessions active; 1-minute load average ' +
    'ranged from 9 to 114 across the 27 passes. Two orphaned busy-wait loops from an ' +
    'unrelated session (pids 44484, 44485, 3 days old) were consuming ~2 cores for the ' +
    'whole capture and are part of what these numbers include.',
  runsPerRung: 101,
  samplesPerRung: 100,
  shards: 16,
  admissionLimit: 64,
  headroom: {
    // Worst observed 1.094×; 1.30 leaves a 1.19× margin over that and still fires on a
    // 30% rise in what the fabric costs above local execution.
    coordinationRatioP50: 0.3,
    // Worst observed 2.089×; 2.50 leaves a 1.20× margin. Tighter than this fires on
    // load — the tail of an async job path is more load-sensitive than the tail of the
    // synchronous reference, so pairing reduces the sensitivity without removing it.
    coordinationRatioP95: 1.5,
    // Worst observed 4.63×, and 5.68× even under CPU saturation; 6.00 clears both. This
    // is deliberately a backstop rather than a gate: it is the only check that can see a
    // regression in code the fabric and the reference *share* — `WasmExecutor`, the
    // canonical encoder, the blockstore — which any ratio cancels by construction.
    makespanP50Ms: 5,
  },
  observedSpread: {
    passes: 27,
    coordinationRatioP50: 1.094,
    coordinationRatioP95: 2.089,
    makespanP50Ms: 4.627,
    makespanP95Ms: 8.495,
    underCpuSaturation: {
      passes: 10,
      // Below 1.0: the synchronous reference loses more to CPU starvation than the
      // fabric path does, so this statistic sags rather than rises under load. That is
      // why it can carry the tightest budget of the three.
      coordinationRatioP50: 0.794,
      coordinationRatioP95: 2.653,
      makespanP50Ms: 5.677,
      makespanP95Ms: 10.075,
    },
  },
  rungs: [
    { nodes: 1, coordinationRatioP50: 1.467, coordinationRatioP95: 2.858, makespanP50Ms: 2.058, makespanP95Ms: 5.524 },
    { nodes: 2, coordinationRatioP50: 2.534, coordinationRatioP95: 4.078, makespanP50Ms: 3.227, makespanP95Ms: 6.889 },
    { nodes: 4, coordinationRatioP50: 2.419, coordinationRatioP95: 3.414, makespanP50Ms: 3.108, makespanP95Ms: 6.696 },
  ],
}
