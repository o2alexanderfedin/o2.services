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

/**
 * The reduce leg of one measured run — MR-03, MR-04, MR-05.
 *
 * A segment of the same job as {@link Observation.makespanMs}, timed separately and
 * never folded into it. §2.1 of `.planning/BENCHMARK-METHODOLOGY.md` defines makespan
 * to *the last shard's result*; a combine happens after that, so a reduce inside the
 * makespan bracket would silently redefine the primary metric across every number
 * published before the reduce existed.
 */
export interface ReduceObservation {
  /**
   * This run's reduce produced an aggregate.
   *
   * It exists so that a failed aggregation can blank the reduce row **without**
   * touching {@link Observation.complete}, which still means what it has always
   * meant: every shard agreed. The tempting shortcut is to fold the reduce into
   * `complete`, and it silently re-samples the primary metric — `makespan` is
   * summarised over `complete` runs (see `measure` below), so coupling the two would
   * condition every published p50/p95/p99 on the reduce having succeeded and make
   * them incomparable with every number published before this field existed. A run
   * that produced every shard but no aggregate is a complete **map** with a failed
   * **aggregation**, and that is what this field records.
   */
  readonly ok: boolean
  /** Wall-clock of the reduce alone, from the driver's own `performance.now()` pair. */
  readonly reduceMs: number
  /**
   * `ReduceTree.depth` — read off the reduce result, never written down.
   *
   * `deriveReduceTree` decides it from the leaf set and the fanout. Whether this
   * column varies across a sweep is a **measured** question and no value is written
   * here: a sweep that holds both the shard count and the fanout fixed will show it
   * constant, and a column a run shows constant carries no information about a
   * configuration. The driver's `unmet` list says the same where a reader of
   * `.planning/BENCHMARK-RESULTS.md` will find it. The alternative that would make
   * this column carry information — varying the fanout across the sweep — was
   * considered and rejected, because rungs walking differently-shaped trees have
   * incomparable reduce timings, which is the only thing the reduce table is for.
   */
  readonly treeDepth: number
  /**
   * `ReduceOutcome.combines` — combines that produced a result. Read off, never
   * written down, and subject to the same constant-column caveat as
   * {@link ReduceObservation.treeDepth}.
   */
  readonly combines: number
  /**
   * `ReduceOutcome.recomputes` — **failed attempts, not combines re-run.**
   *
   * `executeReduce` adds one per attempt that resolved `null` on a combine that
   * eventually produced a CID, so a value above the combine count is ordinary rather
   * than impossible. It also reads **0** when every combine failed outright, because
   * those attempts are discarded — so it is a churn-among-successes figure and not a
   * health signal for a reduce that failed everywhere.
   */
  readonly recomputes: number
  /** Distinct peer ids in `ReduceOutcome.executedBy` — **distinct**, not the ladder's node count. */
  readonly combineExecutors: number
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
  /**
   * **Required, deliberately.** An optional group with zero defaults would reproduce
   * exactly the "identities, not measurements" problem `speculationMultiplier` and
   * `redispatches` already have to apologise for in the report's `unmet` list. A
   * required field means a driver that stops measuring the reduce fails `tsc` instead
   * of publishing zeros.
   */
  readonly reduce: ReduceObservation
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

/**
 * The reduce leg of one configuration, aggregated.
 *
 * Three aggregation rules, each with a reason rather than a preference:
 *
 * - `ms` follows makespan's rule **exactly** — completed runs only, cold start
 *   excluded, and additionally only runs whose reduce produced an aggregate. A reduce
 *   over a partial leaf set is measuring a different thing, and a reduce that produced
 *   no aggregate produced no measurement at all.
 * - `treeDepth`, `combines` and `combineExecutors` are the **max** over included
 *   observations rather than the mean, because a max makes an outlying run visible
 *   where a mean would average it away.
 * - `recomputes` is the **sum**, because it is an event count and a mean of event
 *   counts across runs answers no question anyone asks.
 */
export interface ReduceReport {
  readonly ms: Summary
  readonly treeDepth: number
  readonly combines: number
  readonly recomputes: number
  readonly combineExecutors: number
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
  /**
   * The reduce segment. `ms.n === 0` means **not measured**, which the report renders
   * as an em dash and never as a zero — unmeasured is not "ran and did nothing".
   */
  readonly reduce: ReduceReport
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

const maxOf = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((max, v) => Math.max(max, v), 0)

/**
 * Aggregate the reduce leg over the observations whose reduce actually produced one.
 *
 * **All three aggregations in this module now use a different population, and that is
 * deliberate rather than sloppy:**
 *
 * - `costOf` is over **every measured** run including failures, since work spent on a
 *   failed run is still work the fabric spent;
 * - `makespan` is over **completed** runs, since a run missing a shard measured a
 *   different thing;
 * - `reduceOf` is over **completed runs whose reduce also succeeded**, since a reduce
 *   that did not produce an aggregate produced no measurement at all.
 *
 * `reduceOf`'s narrower filter must **not** be pushed up into `complete`. That would
 * move the makespan *sample* while leaving each individual `makespanMs` measuring the
 * identical interval — a silent re-sampling of the primary metric, which is exactly
 * what the methodology's pre-registration forbids doing without a dated amendment.
 */
function reduceOf(observations: readonly Observation[]): ReduceReport {
  const reduces = observations.map((o) => o.reduce)
  return {
    ms: summarise(reduces.map((r) => r.reduceMs)),
    treeDepth: maxOf(reduces.map((r) => r.treeDepth)),
    combines: maxOf(reduces.map((r) => r.combines)),
    recomputes: reduces.reduce((sum, r) => sum + r.recomputes, 0),
    combineExecutors: maxOf(reduces.map((r) => r.combineExecutors)),
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
    // A third population, narrower than `completed` and deliberately not pushed up
    // into it — see `reduceOf`. A failed aggregation blanks the reduce row and leaves
    // the makespan row intact, which is also the more useful reading: a reduce that
    // could not find an executor says nothing about how long the map took.
    reduce: reduceOf(completed.filter((o) => o.reduce.ok)),
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
