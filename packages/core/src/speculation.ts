/**
 * Speculative duplication of stragglers — CHURN-02, CHURN-06.
 *
 * A job finishes when its *slowest* task finishes, so one node on a train ruins a
 * thousand-node job. The fix is old and works: when a task is running far longer than
 * its peers, start a second copy elsewhere and take whichever finishes first.
 *
 * ## Why the loser is harmless, precisely
 *
 * Not because anything cancels it. Because the two copies compute the same pure
 * function of the same content-addressed inputs, so they produce **byte-identical
 * results with the same CID**. The loser's answer dedupes into nothing — the same
 * property MR-07 relies on for a late combine. Speculation is therefore safe by
 * construction rather than by careful cleanup, which matters because cleanup is what
 * fails when a node vanishes mid-cancel.
 *
 * And if the two copies *disagree*, that is not a race to resolve — it is a
 * determinism failure or a dishonest node, and it is **reported, never voted on**.
 * First-result-wins picks the winner; the disagreement travels alongside it. Silently
 * taking the first of two different answers would convert the single most informative
 * event this system can observe into a scheduling detail.
 *
 * ## The budget is global, and it is spent, not granted
 *
 * Speculation is pure overhead until it saves something. Unbounded, it doubles a job's
 * cost in exactly the conditions — a slow, loaded fabric — where cost matters most. So
 * the budget is a fraction of the job's task count, held once for the whole job, and
 * every duplicate spends from it. When it is gone, stragglers are simply waited for.
 *
 * The multiplier is reported on every job for the same reason `verificationMultiplier`
 * is: a cost that is not surfaced is a cost that gets discovered later, by someone
 * else, in a bill.
 *
 * ## CHURN-06 — the straggler fix must not become a sovereignty hole
 *
 * A speculative duplicate is a *dispatch*, and dispatch of a sovereign task is
 * constrained. The obvious implementation — "pick any other node, quickly" — would
 * quietly move an owner's data off their machines in exactly the moment the system is
 * under pressure and nobody is watching. So `speculativeCandidates` calls the same
 * `eligibleNodes` gate that `planPlacement` and `placeWithOffers` call. There is no
 * second eligibility rule to drift, and a sovereign task with only one owner node
 * simply cannot be speculated — which is the correct outcome and is asserted by test.
 *
 * Pure module.
 */

import { eligibleNodes } from './sovereignty.ts'
import type { NodeDescriptor, PlacementRequest } from './sovereignty.ts'

/**
 * Extra dispatches allowed, as a fraction of the job's task count.
 *
 * 10% is Hadoop's long-standing default and errs low deliberately: speculation pays
 * off on the tail, and a tail is by definition small. A job that needs to duplicate
 * half its tasks does not have stragglers, it has a broken fabric.
 */
export const DEFAULT_SPECULATION_FRACTION = 0.1

/**
 * How much slower than typical a task must be before it is a straggler.
 *
 * 1.5× the median completed duration. Lower and normal variance triggers duplication;
 * much higher and the tail is already over by the time anything starts.
 */
export const DEFAULT_STRAGGLER_FACTOR = 1.5

/**
 * Completions needed before the median means anything.
 *
 * With two samples the "median" is an average of two numbers and the first slightly
 * slow task looks like a straggler. Waiting for a few real observations costs nothing
 * — early in a job there is no tail to fix yet.
 */
export const MIN_SAMPLES = 3

/** A task running now, from the coordinator's point of view. */
export interface InFlight {
  readonly taskId: string
  readonly nodeId: string
  readonly startedAt: number
}

export interface StragglerOptions {
  /** Durations of tasks that have already finished, in ms. */
  readonly completed: readonly number[]
  readonly factor?: number
  readonly minSamples?: number
}

/** Median of a sample. Empty input is 0, which the callers guard against separately. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/**
 * Tasks running long enough to be worth duplicating.
 *
 * Compares elapsed time against the median *completed* duration. This is the simple
 * heuristic, and its limitation is worth stating rather than hiding: it assumes tasks
 * are roughly equal-sized, which shards of one job usually are and shards of different
 * jobs are not. A progress-rate estimator (LATE) would handle uneven tasks better and
 * needs the guest to report progress, which the ABI does not currently expose.
 */
export function stragglers(
  inFlight: readonly InFlight[],
  now: number,
  options: StragglerOptions,
): readonly InFlight[] {
  const minSamples = options.minSamples ?? MIN_SAMPLES
  if (options.completed.length < minSamples) return []

  const factor = options.factor ?? DEFAULT_STRAGGLER_FACTOR
  const threshold = median(options.completed) * factor
  if (!(threshold > 0)) return []

  return inFlight
    .filter((task) => now - task.startedAt > threshold)
    .sort((a, b) => a.startedAt - b.startedAt || a.taskId.localeCompare(b.taskId))
}

/** What a race can determine about a copy that lost. */
export interface RaceLoser {
  readonly nodeId: string
  /** True when the loser's result differed from the winner's — see the module note. */
  readonly disagreed: boolean
}

/**
 * A duplicate that lost the race, kept so the cost is attributable.
 *
 * Which task it lost is not something a race can know — {@link settleRace} is handed
 * answers, and an answer names a node and a CID and no task. So the id is supplied by
 * {@link SpeculationLedger.discard}, whose caller necessarily holds it, and that is
 * the only path that can mint one of these.
 */
export interface Discarded extends RaceLoser {
  readonly taskId: string
}

/**
 * The job-wide speculation budget.
 *
 * Holds the allowance, records what was spent, and refuses once it is gone. It does
 * *not* decide which tasks to duplicate — that is `stragglers` — and it does not pick
 * nodes. Three small things that each do one job, rather than a `SpeculativeScheduler`
 * that does all three and cannot be tested apart.
 */
export class SpeculationLedger {
  readonly #allowance: number
  readonly #tasks: number
  readonly #duplicated = new Set<string>()
  readonly #discarded: Discarded[] = []
  #spent = 0

  constructor(options: { readonly tasks: number; readonly fraction?: number }) {
    const fraction = options.fraction ?? DEFAULT_SPECULATION_FRACTION
    if (!Number.isInteger(options.tasks) || options.tasks < 0) {
      throw new RangeError(`tasks must be a non-negative integer, got ${options.tasks}`)
    }
    if (!(fraction >= 0)) throw new RangeError(`fraction must be >= 0, got ${fraction}`)
    this.#tasks = options.tasks
    this.#allowance = Math.floor(options.tasks * fraction)
  }

  /** Duplicates permitted for the whole job. */
  get allowance(): number {
    return this.#allowance
  }

  get spent(): number {
    return this.#spent
  }

  get remaining(): number {
    return this.#allowance - this.#spent
  }

  /** Duplicates that lost, with whether they agreed. */
  get discarded(): readonly Discarded[] {
    return this.#discarded
  }

  /**
   * Cost accounting — total dispatches over useful ones, mirroring
   * `verificationMultiplier`.
   *
   * 1.0 means speculation cost nothing. Reported whether or not it was used, so its
   * absence from a job is visible rather than assumed.
   */
  get multiplier(): number {
    if (this.#tasks === 0) return 0
    return (this.#tasks + this.#spent) / this.#tasks
  }

  /**
   * Ask to duplicate a task.
   *
   * Refuses when the budget is exhausted, and when this task has already been
   * duplicated — a second duplicate of the same straggler spends twice for the same
   * tail, and a task slow on two nodes is unlikely to be fixed by a third.
   */
  request(taskId: string): boolean {
    if (this.#spent >= this.#allowance) return false
    if (this.#duplicated.has(taskId)) return false
    this.#duplicated.add(taskId)
    this.#spent += 1
    return true
  }

  /** Whether this task already has a speculative copy running. */
  duplicated(taskId: string): boolean {
    return this.#duplicated.has(taskId)
  }

  /** Record the copy that lost, and whether its answer matched the winner's. */
  discard(taskId: string, nodeId: string, disagreed: boolean): void {
    this.#discarded.push({ taskId, nodeId, disagreed })
  }
}

/**
 * Nodes a speculative duplicate may run on — CHURN-06.
 *
 * Routes through `eligibleNodes`, the one eligibility gate, so a sovereign task's
 * duplicate can only ever land on its owner's own executable nodes. Then excludes
 * whoever is already running it, because a duplicate on the same node is not a
 * duplicate.
 *
 * A sovereign task whose owner has one node therefore yields **no** candidates and
 * cannot be speculated. That is the correct answer: the alternatives are to wait, or
 * to breach the guarantee the whole project rests on.
 */
export function speculativeCandidates(
  request: PlacementRequest,
  nodes: readonly NodeDescriptor[],
  excluding: readonly string[],
): readonly NodeDescriptor[] {
  const excluded = new Set(excluding)
  return eligibleNodes(request, nodes).filter((node) => !excluded.has(node.nodeId))
}

/** One copy's answer in a speculative race. */
export interface SpeculativeAnswer {
  readonly nodeId: string
  /** CID of the result, as a string. `null` means this copy failed or vanished. */
  readonly resultCid: string | null
  /** When it arrived, on the coordinator's clock. */
  readonly at: number
}

export type RaceOutcome =
  | {
      readonly settled: true
      readonly winner: string
      readonly resultCid: string
      /** Copies that arrived later, or arrived with a different answer. */
      readonly losers: readonly RaceLoser[]
      /**
       * True when a loser produced a *different* CID.
       *
       * Reported, never resolved. Two copies of a deterministic function over
       * content-addressed inputs must agree; that they did not is the most
       * informative event this system can observe, and first-result-wins must not
       * bury it.
       */
      readonly disagreed: boolean
    }
  | { readonly settled: false; readonly reason: string }

/**
 * Settle a speculative race: earliest arrival with a result wins.
 *
 * Takes answers rather than promises, so the ordering under test is the arrival
 * ordering rather than the scheduler's. Ties break on node id, so a settled race is
 * reproducible from its inputs.
 */
export function settleRace(answers: readonly SpeculativeAnswer[]): RaceOutcome {
  const arrived = answers.filter(
    (answer): answer is SpeculativeAnswer & { resultCid: string } => answer.resultCid !== null,
  )
  if (arrived.length === 0) {
    return { settled: false, reason: 'no copy of the task produced a result' }
  }

  const ordered = [...arrived].sort((a, b) => a.at - b.at || a.nodeId.localeCompare(b.nodeId))
  const winner = ordered[0] as SpeculativeAnswer & { resultCid: string }
  const losers = ordered.slice(1).map((answer) => ({
    nodeId: answer.nodeId,
    disagreed: answer.resultCid !== winner.resultCid,
  }))

  return {
    settled: true,
    winner: winner.nodeId,
    resultCid: winner.resultCid,
    losers,
    disagreed: losers.some((loser) => loser.disagreed),
  }
}
