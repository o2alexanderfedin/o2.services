/**
 * The measurement harness — BENCH-01, BENCH-03, BENCH-04, BENCH-05.
 *
 * Implements the plan pre-registered in `.planning/BENCHMARK-METHODOLOGY.md`. The
 * constants here are the ones that document names, exported rather than duplicated, so
 * the plan and the code cannot drift apart without a test noticing.
 *
 * ## What this module refuses to do
 *
 * Three of the methodology's rules are enforced structurally rather than trusted:
 *
 * - **An incomplete run never enters makespan statistics.** It is counted separately.
 *   Folding a fast failure in as a fast run is the standard way to make an unreliable
 *   system look quick, and it requires no dishonesty — only carelessness.
 * - **The cold-cache iteration is separated, not averaged in.** It is reported as its
 *   own number, because first-visit cost is a real user experience and burying it in a
 *   mean loses it in both directions.
 * - **Gross and useful node-seconds travel as one value.** `CostReport` has no accessor
 *   for one without the other, the same trick `CoveredAggregate` uses for coverage.
 *
 * ## What it does not know
 *
 * How to build a fabric. The runner is injected, so this module stays portable — the
 * memory-transport and real-transport drivers live where their platforms live, and the
 * harness measures both through one interface. That is also what makes the connectivity
 * tax meaningful: the two curves come from the identical measurement code.
 *
 * Pure module.
 */

import { summarise } from './stats.ts'
import type { Summary } from './stats.ts'

/**
 * The node-count ladder, fixed in the methodology before any data existed.
 *
 * Exported so the sweep cannot quietly acquire a rung that happens to look good. A
 * test asserts this matches the committed plan.
 */
export const NODE_LADDER: readonly number[] = [1, 2, 4, 8, 16]

/** Runs per configuration, per the pre-registered plan. */
export const RUNS_PER_CONFIG = 20

export type TransportKind = 'memory' | 'real'
export type Skew = 'uniform' | 'skewed'
export type CodeCache = 'cold' | 'warm'

export interface RunConfig {
  readonly nodes: number
  readonly shards: number
  /** Replicas per shard. 1 disables verification, which the cost report will show. */
  readonly redundancy: number
  readonly transport: TransportKind
  readonly skew: Skew
}

/** One measured execution. The raw row that gets published. */
export interface Observation {
  readonly makespanMs: number
  /** False when any shard failed. Excluded from makespan stats, counted separately. */
  readonly complete: boolean
  readonly grossNodeSeconds: number
  readonly usefulNodeSeconds: number
  readonly verificationMultiplier: number
  readonly speculationMultiplier: number
  readonly redispatches: number
  readonly codeCache: CodeCache
}

/** Builds and runs one job. Injected so the harness stays platform-free. */
export interface JobRunner {
  (config: RunConfig, codeCache: CodeCache): Promise<Observation>
}

/**
 * Cost, as a single value.
 *
 * There is deliberately no way to obtain `gross` without `useful` — the same structural
 * move `CoveredAggregate` makes for coverage. A cost figure with the redundancy removed
 * is the number a vendor publishes; here the redundancy is the product.
 */
export interface CostReport {
  readonly grossNodeSeconds: number
  readonly usefulNodeSeconds: number
  /** gross / useful from redundant execution. 1.0 means redundancy was off. */
  readonly verificationTax: number
  /** (tasks + duplicates) / tasks. 1.0 means nothing was speculated. */
  readonly speculationTax: number
  /** re-dispatches per task. 0 means nothing had to move. */
  readonly churnTax: number
}

export interface SweepResult {
  readonly config: RunConfig
  /** Over completed runs only, excluding the cold-cache iteration. */
  readonly makespan: Summary
  /** The discarded first iteration, published rather than averaged in. */
  readonly coldStartMs: number | null
  /** Runs that did not complete every shard. Never folded into `makespan`. */
  readonly incomplete: number
  readonly cost: CostReport
  /** Every observation, published so a reader can compute anything else. */
  readonly observations: readonly Observation[]
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length

function costOf(observations: readonly Observation[]): CostReport {
  const gross = observations.reduce((sum, o) => sum + o.grossNodeSeconds, 0)
  const useful = observations.reduce((sum, o) => sum + o.usefulNodeSeconds, 0)
  return {
    grossNodeSeconds: gross,
    usefulNodeSeconds: useful,
    // Derived from the totals rather than averaging per-run ratios: the mean of
    // ratios is not the ratio of means, and the latter is the one that answers
    // "what did this configuration actually cost".
    verificationTax: useful === 0 ? 0 : gross / useful,
    speculationTax: mean(observations.map((o) => o.speculationMultiplier)),
    churnTax: mean(observations.map((o) => o.redispatches)),
  }
}

export interface SweepOptions {
  readonly runs?: number
  /**
   * Discard the first iteration as cold-cache and report it separately.
   *
   * On by default because V8 caches compiled WASM and the first run measures
   * something different from the rest.
   */
  readonly separateColdStart?: boolean
}

/** Measure one configuration `runs` times. */
export async function measure(
  runner: JobRunner,
  config: RunConfig,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const runs = options.runs ?? RUNS_PER_CONFIG
  const separateColdStart = options.separateColdStart ?? true

  const observations: Observation[] = []
  let coldStartMs: number | null = null

  for (let i = 0; i < runs; i++) {
    const cold = separateColdStart && i === 0
    const observation = await runner(config, cold ? 'cold' : 'warm')
    observations.push(observation)
    if (cold) coldStartMs = observation.makespanMs
  }

  const measured = separateColdStart ? observations.slice(1) : observations
  const completed = measured.filter((o) => o.complete)

  return {
    config,
    makespan: summarise(completed.map((o) => o.makespanMs)),
    coldStartMs,
    incomplete: measured.length - completed.length,
    // Cost is over every measured run including failures: work spent on a run that
    // did not finish is still work the fabric spent.
    cost: costOf(measured),
    observations,
  }
}

/** Sweep the pre-registered ladder for one transport. */
export async function sweepNodeCount(
  runner: JobRunner,
  base: Omit<RunConfig, 'nodes'>,
  options: SweepOptions & { readonly ladder?: readonly number[] } = {},
): Promise<readonly SweepResult[]> {
  const ladder = options.ladder ?? NODE_LADDER
  const results: SweepResult[] = []
  for (const nodes of ladder) {
    results.push(await measure(runner, { ...base, nodes }, options))
  }
  return results
}

export type Crossover =
  | { readonly found: true; readonly nodes: number; readonly baselineP50Ms: number; readonly distributedP50Ms: number }
  | {
      readonly found: false
      readonly reason: string
      readonly baselineP50Ms: number
      /** The best the fabric managed, so the size of the gap is visible. */
      readonly bestP50Ms: number
      readonly bestAtNodes: number | null
    }

/**
 * The COST crossover — BENCH-05.
 *
 * The smallest node count whose p50 makespan beats a competent single-threaded
 * implementation of the same job. When there is none, the result says so *and* reports
 * how close the fabric got, because "no crossover" without the gap is unactionable —
 * a factor of 1.2 and a factor of 200 are very different findings.
 */
export function costCrossover(
  baseline: Summary,
  curve: readonly SweepResult[],
): Crossover {
  const usable = curve.filter((point) => point.makespan.n > 0)
  const beating = usable
    .filter((point) => point.makespan.p50 < baseline.p50)
    .sort((a, b) => a.config.nodes - b.config.nodes)[0]

  if (beating !== undefined) {
    return {
      found: true,
      nodes: beating.config.nodes,
      baselineP50Ms: baseline.p50,
      distributedP50Ms: beating.makespan.p50,
    }
  }

  const best = [...usable].sort((a, b) => a.makespan.p50 - b.makespan.p50)[0]
  return {
    found: false,
    reason:
      usable.length === 0
        ? 'no configuration produced a completed run'
        : `no crossover within the measured range (${usable.map((p) => p.config.nodes).join(', ')} nodes)`,
    baselineP50Ms: baseline.p50,
    bestP50Ms: best?.makespan.p50 ?? Number.NaN,
    bestAtNodes: best?.config.nodes ?? null,
  }
}

export interface ConnectivityTax {
  readonly nodes: number
  readonly memoryP50Ms: number
  readonly realP50Ms: number
  /** real ÷ memory. 1.0 would mean the network cost nothing, which it never does. */
  readonly ratio: number
}

/**
 * The gap between the two transports, at equal node count — criterion 1.
 *
 * Published as its own number because it is the honest answer to "how much of your
 * scaling curve is an artifact of the fake network". Node counts present in only one
 * curve are skipped rather than compared against a missing value.
 */
export function connectivityTax(
  memory: readonly SweepResult[],
  real: readonly SweepResult[],
): readonly ConnectivityTax[] {
  const byNodes = new Map(real.map((point) => [point.config.nodes, point]))
  const taxes: ConnectivityTax[] = []

  for (const point of memory) {
    const counterpart = byNodes.get(point.config.nodes)
    if (counterpart === undefined) continue
    if (point.makespan.n === 0 || counterpart.makespan.n === 0) continue
    taxes.push({
      nodes: point.config.nodes,
      memoryP50Ms: point.makespan.p50,
      realP50Ms: counterpart.makespan.p50,
      ratio: counterpart.makespan.p50 / point.makespan.p50,
    })
  }
  return taxes.sort((a, b) => a.nodes - b.nodes)
}
