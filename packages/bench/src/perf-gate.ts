/**
 * The perf gate — the part of `@o2/bench` that can fail.
 *
 * Everything else in this package reports. `harness.ts` measures, `stats.ts`
 * summarises, `report.ts` renders, and until this module existed the throughput of the
 * fabric could halve with the whole suite staying green. This is the comparison, kept
 * pure and separate from the measurement so that it can be tested without standing a
 * fabric up — the slow measurement lives in `perf-workload.ts` and the committed
 * numbers in `perf-baseline.ts`.
 *
 * ## A vacuous pass is the failure mode this module is shaped around
 *
 * The repo has already shipped an instrument that read green because it measured
 * nothing: the disclosure gate's publish-command pattern matched no lines and was
 * reported as "no publish commands found". So three separate ways of measuring nothing
 * are **findings here, not skips**:
 *
 * - a sample too small for the percentile being compared (`stats.ts` already models
 *   this as `Summary.reliable`, and this module defers to it rather than inventing a
 *   second rule),
 * - a rung the baseline names that the run did not measure,
 * - a rung the run measured that the baseline does not name.
 *
 * And {@link judge} returns every comparison it made, passing or failing, so a caller
 * can assert the instrument was live and non-empty rather than trusting an empty
 * findings list.
 *
 * ## Why an incomplete run is a gate failure, not a slow one
 *
 * `harness.ts` keeps failed runs out of the makespan statistics on purpose — folding a
 * fast failure in as a fast run is the standard way to make an unreliable system look
 * quick. That leaves the gate a hole to close: a build in which every shard fails
 * produces a *faster* makespan over the runs that did complete. So `incomplete > 0` is
 * a finding in its own right.
 *
 * Pure module.
 */

import { MIN_RELIABLE_SAMPLES } from './stats.ts'
import type { Summary } from './stats.ts'
import type { PerfBaseline } from './perf-baseline.ts'
import type { RungMeasurement } from './perf-workload.ts'

/**
 * What the gate compares. Named so a regression report says which number moved.
 *
 * Two ratios and one absolute. `perf-baseline.ts` carries the measurements behind that
 * split; the short version is that the absolute p95 of this workload moved over a factor
 * of 8.5 between passes on an otherwise unchanged tree, and the paired ratio's p50 moved
 * over a factor of 1.09.
 */
export type Statistic = 'coordination-ratio-p50' | 'coordination-ratio-p95' | 'makespan-p50-ms'

/** One rung of a measured run, reduced to what the comparison needs. */
export interface GateInput {
  readonly nodes: number
  /** Runs that did not complete every shard. Non-zero is a failure — see the note. */
  readonly incomplete: number
  /** Absolute makespan over completed, warm runs. */
  readonly makespan: Summary
  /** Per-iteration `fabric ÷ local-execution`, the load-normalised statistic. */
  readonly coordinationRatio: Summary
}

/** Adapter from a measured ladder. Keeps {@link judge} free of the rig's types. */
export function gateInputs(measurements: readonly RungMeasurement[]): readonly GateInput[] {
  return measurements.map((measurement) => ({
    nodes: measurement.sweep.config.nodes,
    incomplete: measurement.sweep.incomplete,
    makespan: measurement.sweep.makespan,
    coordinationRatio: measurement.coordinationRatio,
  }))
}

/**
 * One comparison the gate actually performed.
 *
 * Returned whatever the outcome, including `refused-unreliable-sample`, so that "no
 * findings" can be distinguished from "nothing was compared". That distinction is the
 * whole difference between a gate and a decoration.
 */
export interface Check {
  readonly nodes: number
  readonly statistic: Statistic
  readonly measured: number
  readonly baseline: number
  /** `baseline × (1 + headroom)`. Exceeding it is a regression. */
  readonly budget: number
  readonly outcome: 'within-budget' | 'over-budget' | 'refused-unreliable-sample'
}

export type Finding =
  | { readonly kind: 'regressed'; readonly nodes: number; readonly statistic: Statistic; readonly measured: number; readonly baseline: number; readonly budget: number }
  | {
      readonly kind: 'sample-too-small'
      readonly nodes: number
      readonly statistic: Statistic
      readonly n: number
      readonly required: number
    }
  | { readonly kind: 'incomplete-runs'; readonly nodes: number; readonly incomplete: number }
  | { readonly kind: 'unmeasured-rung'; readonly nodes: number }
  | { readonly kind: 'unbaselined-rung'; readonly nodes: number }

export interface GateResult {
  /** Empty means pass — but only in combination with a non-empty `checks`. */
  readonly findings: readonly Finding[]
  readonly checks: readonly Check[]
}

/** Which summary backs which statistic, so the reliability rule is applied once. */
function sampleFor(input: GateInput, statistic: Statistic): Summary {
  return statistic === 'makespan-p50-ms' ? input.makespan : input.coordinationRatio
}

function measuredValue(input: GateInput, statistic: Statistic): number {
  switch (statistic) {
    case 'coordination-ratio-p50':
      return input.coordinationRatio.p50
    case 'coordination-ratio-p95':
      return input.coordinationRatio.p95
    case 'makespan-p50-ms':
      return input.makespan.p50
  }
}

/**
 * Compare a measured ladder against the committed baseline.
 *
 * Every rung named by either side is visited: a baseline rung with no measurement and a
 * measurement with no baseline are both findings, because either one silently shrinks
 * what the gate covers.
 */
export function judge(baseline: PerfBaseline, measured: readonly GateInput[]): GateResult {
  const findings: Finding[] = []
  const checks: Check[] = []
  const byNodes = new Map(measured.map((input) => [input.nodes, input]))

  for (const rung of baseline.rungs) {
    const input = byNodes.get(rung.nodes)
    if (input === undefined) {
      findings.push({ kind: 'unmeasured-rung', nodes: rung.nodes })
      continue
    }

    if (input.incomplete > 0) {
      findings.push({ kind: 'incomplete-runs', nodes: rung.nodes, incomplete: input.incomplete })
    }

    const budgets: readonly { readonly statistic: Statistic; readonly baseline: number; readonly headroom: number }[] = [
      {
        statistic: 'coordination-ratio-p50',
        baseline: rung.coordinationRatioP50,
        headroom: baseline.headroom.coordinationRatioP50,
      },
      {
        statistic: 'coordination-ratio-p95',
        baseline: rung.coordinationRatioP95,
        headroom: baseline.headroom.coordinationRatioP95,
      },
      {
        statistic: 'makespan-p50-ms',
        baseline: rung.makespanP50Ms,
        headroom: baseline.headroom.makespanP50Ms,
      },
    ]

    for (const { statistic, baseline: reference, headroom } of budgets) {
      const sample = sampleFor(input, statistic)
      const budget = reference * (1 + headroom)
      const measuredNumber = measuredValue(input, statistic)

      // `stats.ts`'s own notion, deferred to rather than re-derived: below
      // MIN_RELIABLE_SAMPLES a p95 is arithmetic over too few points to be information,
      // and green-lighting an unmeasurable run is worse than having no gate.
      if (!sample.reliable) {
        checks.push({
          nodes: rung.nodes,
          statistic,
          measured: measuredNumber,
          baseline: reference,
          budget,
          outcome: 'refused-unreliable-sample',
        })
        findings.push({
          kind: 'sample-too-small',
          nodes: rung.nodes,
          statistic,
          n: sample.n,
          required: MIN_RELIABLE_SAMPLES,
        })
        continue
      }

      const over = !(measuredNumber <= budget)
      checks.push({
        nodes: rung.nodes,
        statistic,
        measured: measuredNumber,
        baseline: reference,
        budget,
        outcome: over ? 'over-budget' : 'within-budget',
      })
      if (over) {
        findings.push({
          kind: 'regressed',
          nodes: rung.nodes,
          statistic,
          measured: measuredNumber,
          baseline: reference,
          budget,
        })
      }
    }
  }

  const baselined = new Set(baseline.rungs.map((rung) => rung.nodes))
  for (const input of measured) {
    if (!baselined.has(input.nodes)) findings.push({ kind: 'unbaselined-rung', nodes: input.nodes })
  }

  return { findings, checks }
}

const round = (value: number): string => (Number.isFinite(value) ? value.toFixed(3) : String(value))

/** One line per finding, carrying the numbers rather than pointing at them. */
export function explain(finding: Finding): string {
  switch (finding.kind) {
    case 'regressed':
      return (
        `${finding.nodes} node(s): ${finding.statistic} is ${round(finding.measured)}, ` +
        `over the budget of ${round(finding.budget)} (baseline ${round(finding.baseline)}). ` +
        `That is ${round(finding.measured / finding.baseline)}× the baseline.`
      )
    case 'sample-too-small':
      return (
        `${finding.nodes} node(s): ${finding.statistic} was measured over n=${finding.n}, ` +
        `below MIN_RELIABLE_SAMPLES=${finding.required}. Refusing to pass on a sample that ` +
        'cannot carry the percentile — a vacuous pass is worse than no gate.'
      )
    case 'incomplete-runs':
      return (
        `${finding.nodes} node(s): ${finding.incomplete} run(s) did not complete every shard. ` +
        'The harness keeps failed runs out of the makespan statistics, so a build where shards ' +
        'fail measures as faster; that is a correctness failure surfacing here, not a timing one.'
      )
    case 'unmeasured-rung':
      return (
        `${finding.nodes} node(s): named by the baseline but not measured by this run. ` +
        'A rung that silently vanishes shrinks what the gate covers without changing its colour.'
      )
    case 'unbaselined-rung':
      return (
        `${finding.nodes} node(s): measured but absent from the baseline, so nothing was ` +
        'compared. Re-baselining is a deliberate act — see perf-baseline.ts.'
      )
  }
}

/**
 * The whole verdict as text, or `null` when the gate passes.
 *
 * `null` requires both an empty findings list **and** at least one comparison actually
 * made. An empty result can be an absent instrument, which is exactly how this repo's
 * disclosure gate once read green.
 */
export function verdict(result: GateResult): string | null {
  if (result.checks.length === 0) {
    return (
      'The perf gate compared nothing. An empty findings list from an instrument that ' +
      'made no comparison is not a pass — it is a missing measurement.'
    )
  }
  if (result.findings.length === 0) return null
  return [
    `perf gate: ${result.findings.length} finding(s) over ${result.checks.length} comparison(s).`,
    ...result.findings.map((finding) => `  - ${explain(finding)}`),
    '',
    'If this is a deliberate, understood change in cost, re-baseline explicitly:',
    'see the re-baselining note at the top of packages/bench/src/perf-baseline.ts.',
  ].join('\n')
}
