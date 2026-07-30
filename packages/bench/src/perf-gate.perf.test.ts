import { describe as suite, expect, it } from 'vitest'
import { PERF_BASELINE } from './perf-baseline.ts'
import { gateInputs, judge, verdict } from './perf-gate.ts'
import {
  GATE_ADMISSION_LIMIT,
  GATE_LADDER,
  GATE_RUNS,
  GATE_SHARDS,
  measureGateLadder,
} from './perf-workload.ts'

/**
 * The perf gate — the spec that actually measures, and the only one in this repository
 * that can fail because the fabric got slower.
 *
 * ## Why the suffix is `.perf.test.ts`
 *
 * `vitest.config.ts` splits projects by what a test *needs*, not by what it covers, and
 * this one needs two things no other suffix grants:
 *
 * - **It must not run in the browser project.** Not because it cannot — the rig is
 *   portable and would work — but because a second, slower, contended run of the same
 *   measurement produces a second set of numbers with no baseline behind them.
 * - **It must not run in the default fast layer.** It stands up three fabrics and executes
 *   303 jobs plus 303 reference passes: measured at about 1.8 s at ambient load and about
 *   7 s under eight-way CPU saturation. Small in itself, and still the wrong thing to bolt
 *   onto every `npm test` — a load-dependent assertion in the everything-run is how a perf
 *   gate becomes the reason people stop running the suite.
 *
 * `*.node.test.ts` would have given the first property and not the second, and it would
 * have been a lie besides: nothing here is Node-specific. So `*.perf.test.ts` is excluded
 * from `node` and from `browser`, and the `perf` project that does run it is declared only
 * under `O2_PERF=1` — so a bare `vitest run` never sees this file at all, and
 * `npm run test:perf` is the only way to reach it. Both halves matter: without the
 * exclusions it would run in the default projects anyway, and without the conditional the
 * project itself would join the everything-run.
 *
 * ## What a green result here does and does not mean
 *
 * It means: this workload's cost, relative to executing the same shards locally on the
 * same machine at the same moment, has not risen past the budget in
 * `perf-baseline.ts` — and the sample it was measured over was large enough for that
 * statement to be worth making.
 *
 * It does not mean the published driver is unchanged (this rig is a second rig; see
 * `perf-workload.ts`), and it does not mean a regression in code shared by the fabric and
 * the reference would have been seen. Only the absolute backstop can see those, and it
 * is deliberately loose because the absolute numbers on a shared machine are not stable
 * enough to carry a tight one.
 */

/** Measuring three fabrics × 101 iterations, on a machine that may be busy. */
const MEASUREMENT_TIMEOUT_MS = 300_000

suite('the measured ladder stays inside the committed budget', () => {
  it(
    'measures every baselined rung and finds no regression',
    async () => {
      const measurements = await measureGateLadder()
      const inputs = gateInputs(measurements)

      // ── Anti-vacuity, before any verdict is read ────────────────────────────────
      // An empty or short result must not be able to reach the comparison and come back
      // green. This repo has already shipped one instrument that read clean because it
      // measured nothing, so the assertions that the measurement happened come first.
      expect(inputs.map((input) => input.nodes)).toEqual([...GATE_LADDER])
      for (const input of inputs) {
        // The sample the baseline was taken over, and therefore the sample this
        // comparison is entitled to make. Deliberately *not* an assertion that
        // `reliable` is true: that is the gate's own refusal, and asserting it here
        // first would pre-empt it, so a shrunken sample would fail with "expected false
        // to be true" instead of with the gate explaining what it refused and why.
        expect(input.makespan.n).toBe(PERF_BASELINE.samplesPerRung)
        expect(input.coordinationRatio.n).toBe(PERF_BASELINE.samplesPerRung)
        expect(input.coordinationRatio.p50).toBeGreaterThan(0)
        expect(Number.isFinite(input.coordinationRatio.p95)).toBe(true)
      }

      const result = judge(PERF_BASELINE, inputs)

      // Printed whatever the outcome: a gate that reports only a colour makes the next
      // person re-run it by hand to find out what moved.
      process.stdout.write(
        [
          '',
          `perf gate — ${PERF_BASELINE.rungs.length} rung(s), ${GATE_RUNS - 1} samples each,`,
          `baseline captured ${PERF_BASELINE.capturedAt} on ${PERF_BASELINE.machine}`,
          ...result.checks.map(
            (check) =>
              `  ${String(check.nodes).padStart(2)} node(s)  ${check.statistic.padEnd(22)}` +
              ` measured ${check.measured.toFixed(3).padStart(9)}` +
              `  baseline ${check.baseline.toFixed(3).padStart(9)}` +
              `  budget ${check.budget.toFixed(3).padStart(9)}` +
              `  ${check.outcome}`,
          ),
          '',
        ].join('\n'),
      )

      // Every comparison the baseline calls for was actually made. An empty or short
      // `checks` list is how a gate reads green while measuring nothing.
      expect(result.checks).toHaveLength(PERF_BASELINE.rungs.length * 3)

      // Last, so that a red gate reports the numbers above and the gate's own
      // explanation — a regression, a refused sample, a vanished rung — rather than a
      // bare boolean.
      expect(verdict(result)).toBeNull()
    },
    MEASUREMENT_TIMEOUT_MS,
  )

  it('was compared against a baseline that describes this workload', () => {
    // A baseline taken at a different shard count, admission limit, sample size or
    // ladder is not a baseline for this run — it is three numbers that happen to be
    // adjacent to it. Cheap to check, and the failure names which one drifted.
    expect(PERF_BASELINE.shards).toBe(GATE_SHARDS)
    expect(PERF_BASELINE.admissionLimit).toBe(GATE_ADMISSION_LIMIT)
    expect(PERF_BASELINE.runsPerRung).toBe(GATE_RUNS)
    expect(PERF_BASELINE.rungs.map((rung) => rung.nodes)).toEqual([...GATE_LADDER])
  })
})
