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
 * `measureGateLadder()` from `perf-workload.ts`, at its committed defaults — 101 runs per
 * rung, cold iteration discarded, 100 measured samples — run from a scratch directory by
 * the byte-identical committed code, in three conditions:
 *
 * - **20 passes at ambient load** (1-minute load average 9 to 13 on 8 cores). The stored
 *   value for every statistic is the **median of these 20**, not the best and not the
 *   last: a median is what survives one contended pass without anyone having to decide
 *   by hand which pass to throw away.
 * - **12 passes while `vitest run --project node` ran concurrently.** Worth stating
 *   because it turned out *not* to matter — every one of those passes finished in
 *   1.89–2.08 s against 1.75–2.57 s at ambient, and the widest statistic moved by a
 *   factor of 1.67 rather than the several-fold excursion expected.
 * - **6 passes under eight busy-wait loops on eight cores.** Deliberately pathological,
 *   and the only condition in which the absolute numbers moved several-fold.
 *
 * The published driver `packages/node/src/bin/bench.ts` was also run, `--quick` and full,
 * from a scratch working directory so that `.planning/BENCHMARK-RESULTS.md` and
 * `.planning/bench/raw.json` were not regenerated; both were confirmed byte-identical
 * afterwards with `cmp`.
 *
 * ## Why two of the three gated numbers are ratios
 *
 * Absolute milliseconds are not a stable measurement on a developer machine, and that is
 * a measurement rather than an opinion. Under CPU saturation the absolute p50 makespan
 * moved by a factor of 4.03 and the p95 by 4.20, while the paired coordination ratio's
 * p50 moved by a factor of 0.56 — that is, *down*: the synchronous reference loses more
 * to CPU starvation than the fabric path does. Across the 32 unsaturated passes the
 * ratio's p50 never rose more than 7 % above its baseline.
 *
 * An earlier capture session, on a variant of this rig that had not yet been routed
 * through `submitJobWithEgress`, saw the absolute p95 range over a factor of 8.5 and the
 * ratio's p95 reach 2.09, while other sessions on this host drove the 1-minute load
 * average as high as 114. What was running was not identified and is not claimed. Those
 * numbers are not stored below, because they were not produced by this code — but the p95
 * budget is set wide enough to clear them, deliberately.
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
   * statistics are ratios: it moved by a factor of 4.20 under CPU saturation, and by 8.5
   * in the earlier session described at the top of this file. Any budget wide enough not to fire on load
   * would only fire on an outage.
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
  /** 0.30 ⇒ budget 1.30×, against a worst observed pass of 1.070×. */
  readonly coordinationRatioP50: number
  /** 1.50 ⇒ budget 2.50×, against a worst observed pass of 1.673×. */
  readonly coordinationRatioP95: number
  /** 5.00 ⇒ budget 6.00×, against a worst observed pass of 4.032× under CPU saturation. */
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
   * The same figures under eight busy-wait loops on eight cores, kept because they are
   * the reason the gate's caveat about a saturated machine is a number rather than a
   * worry. `coordinationRatioP50` below 1.0 is not a typo — see the field's comment.
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
    'Shared developer machine with other agent sessions active. The 20 baseline passes ' +
    'were taken at a 1-minute load average of 9 to 13 on 8 cores. Two orphaned busy-wait ' +
    'loops from an unrelated session (pids 44484 and 44485, 3 days old at capture time) ' +
    'were consuming roughly 2 of those cores throughout and are part of what these ' +
    'numbers include — the fabric is measured against a reference on the same machine at ' +
    'the same instant, so that is a smaller distortion than it sounds, and it is recorded ' +
    'rather than corrected for.',
  runsPerRung: 101,
  samplesPerRung: 100,
  shards: 16,
  admissionLimit: 64,
  headroom: {
    // Worst observed 1.070× over 32 passes, and it falls under CPU saturation rather
    // than rising. 1.30 leaves a 1.21× margin and still fires on a 30 % rise in what the
    // fabric costs above executing the same shards locally. This is the check that does
    // the work; the other two are a tail and a backstop.
    coordinationRatioP50: 0.3,
    // Worst observed 1.673× over the same 32 passes. 2.50 is wider than that needs — it
    // is set to also clear the 2.09× seen in the earlier capture session described above,
    // under a load heavier than anything reproduced here. The tail of an async job path is
    // more load-sensitive than the tail of the synchronous reference, so pairing reduces
    // that sensitivity without removing it, and a tighter tail budget would fire on
    // somebody else's build rather than on a code change.
    coordinationRatioP95: 1.5,
    // Worst observed 1.236× at ambient load but 4.032× under CPU saturation; 6.00 clears
    // both with a 1.49× margin. Deliberately a backstop rather than a gate: it is the only
    // check that can see a regression in code the fabric and the reference *share* —
    // `WasmExecutor`, the canonical encoder, the blockstore — which any ratio cancels by
    // construction. It fires on an order-of-magnitude change, and that is its whole scope.
    makespanP50Ms: 5,
  },
  observedSpread: {
    // 20 ambient + 12 during a concurrent `vitest run --project node`.
    passes: 32,
    coordinationRatioP50: 1.07,
    coordinationRatioP95: 1.673,
    makespanP50Ms: 1.236,
    makespanP95Ms: 2.41,
    underCpuSaturation: {
      passes: 6,
      // Below 1.0: the synchronous reference loses more to CPU starvation than the fabric
      // path does, so this statistic sags rather than rises under load. That is why it can
      // carry the tightest budget of the three.
      coordinationRatioP50: 0.561,
      coordinationRatioP95: 1.157,
      makespanP50Ms: 4.032,
      makespanP95Ms: 4.196,
    },
  },
  rungs: [
    { nodes: 1, coordinationRatioP50: 1.567, coordinationRatioP95: 2.656, makespanP50Ms: 2.098, makespanP95Ms: 4.491 },
    { nodes: 2, coordinationRatioP50: 2.571, coordinationRatioP95: 3.897, makespanP50Ms: 3.335, makespanP95Ms: 6.693 },
    { nodes: 4, coordinationRatioP50: 2.516, coordinationRatioP95: 3.53, makespanP50Ms: 3.263, makespanP95Ms: 5.462 },
  ],
}
