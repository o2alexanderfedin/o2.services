/**
 * The resilient run loop — CHURN-01, and where the other five criteria compose.
 *
 * Every piece of Phase 7 exists separately and is tested separately: leases decide
 * when a task is available again, placement decides who gets it, the ledger decides
 * whether a straggler may be duplicated, coverage decides how the answer must be
 * labelled. This is the loop that uses them, and it is deliberately the *only* thing
 * that knows about all of them — each of those modules can be understood without this
 * one, which is why none of them import each other.
 *
 * ## What the loop actually guarantees
 *
 * **Liveness changes who computes a task and when, never what the answer is.** A node
 * vanishing costs an attempt. A node being slow costs a duplicate. Neither can change
 * the bytes, because a result is a pure function of `(module, input, partition)` and is
 * content-addressed. That is what lets this loop be aggressive: every recovery action
 * it can take is, at worst, wasted work.
 *
 * ## Failure is a fact, silence is a deadline
 *
 * The two are handled differently and it matters. A dispatch that reports failure is
 * *observed* — the node refused, or its connection died — so the lease is surrendered
 * immediately and the task moves on. Silence gets a deadline instead, because silence
 * is indistinguishable from slowness and the only safe response to "I cannot tell" is
 * to wait a bounded time. Conflating them would either waste a full lease on a node
 * known to be gone, or declare a slow node dead on no evidence.
 *
 * **The deadline is the lease, and it is enforced here rather than assumed.** An
 * earlier version of this module stated the rule above and then never checked
 * `expiresAt` anywhere: once speculation became impossible the loop awaited the
 * pending dispatch with no timer at all, so a peer that simply never answered hung
 * the shard, and `Promise.all` hung the job. Nothing bounded it, because the transport
 * timeout belongs to the transport and a caller may not have one.
 *
 * ## Disagreement must survive speculation
 *
 * When a duplicate wins, the loser is *not* abandoned unexamined. That was the other
 * thing this module got wrong: breaking out of the race on the first arrival meant a
 * second copy's answer was never compared, so `disagreed` could not become true on any
 * input — timing alone picked which of two different CIDs became the job's answer, and
 * the run reported clean. That is majority-vote-by-race, the thing this project has
 * explicitly refused.
 *
 * The fix keeps speculation's whole point intact. Waiting for the loser would undo the
 * latency saving — the loser is usually the straggler. So the winner returns
 * immediately and the outstanding copies are compared **after every shard has
 * settled**, which costs nothing because the job was going to wait for its slowest
 * shard anyway. A copy that has still not answered by then is reported as uncompared
 * rather than as agreeing; you cannot compare an answer that never arrived, and saying
 * "no disagreement" about it would be a claim nobody checked.
 *
 * ## Speculation is adaptive, not a fixed timeout
 *
 * A shard is a straggler relative to its *peers*, so the threshold comes from the
 * median of what has already finished. Early in a job nothing has finished and nothing
 * is duplicated — correctly, since there is no tail yet. The loop therefore polls at
 * an interval rather than sleeping once for a precomputed deadline: the threshold it
 * is checking against does not exist yet when the shard starts.
 *
 * Pure module. Time and sleeping arrive as ports, so a churn test is deterministic
 * rather than a race against a real clock.
 */

import { coverageOf } from './coverage.ts'
import type { CoverageReport } from './coverage.ts'
import { LeaseTable } from './lease.ts'
import type { Lease, LeaseEvent } from './lease.ts'
import { DEFAULT_D, placeWithOffers } from './placement.ts'
import type { AdmissionControl, OfferOptions, Rejection } from './placement.ts'
import type { Sleep } from './governor.ts'
import {
  DEFAULT_SPECULATION_FRACTION,
  DEFAULT_STRAGGLER_FACTOR,
  SpeculationLedger,
  settleRace,
  speculativeCandidates,
  stragglers,
} from './speculation.ts'
import type { SpeculativeAnswer } from './speculation.ts'
import type { NodeDescriptor, OwnerId, PlacementRequest } from './sovereignty.ts'

/** How often the loop re-evaluates whether a running shard has become a straggler. */
export const DEFAULT_WATCHDOG_MS = 250

/** One shard to run, carrying the sovereignty label that constrains where it may go. */
export interface ShardWork {
  readonly shardId: string
  /** The owner whose data this shard reads. Absent for public work. */
  readonly ownerId?: OwnerId
  readonly label: 'public' | 'sovereign'
}

/**
 * What one dispatch produced.
 *
 * The failure kinds are the distinction that makes churn recovery work, and
 * collapsing them into a single `null` — which an earlier version of this module did —
 * makes the 30%-node-loss criterion unachievable. They warrant different policies:
 *
 * - **`node`** — unreachable, refused, connection died. *Whose* fault is the node's,
 *   so the same task on a different node is expected to succeed. Retry freely; the
 *   only bound is running out of untried nodes.
 * - **`task`** — a reachable node ran the task and it failed: the module trapped, an
 *   input was missing, the output would not encode. Retrying this across the whole
 *   fabric burns every node in turn on work that cannot succeed, so it is capped low.
 * - **`sender`** — *this* node did not send, by its own decision: its per-peer send
 *   bound refused. Not the receiver's fault, so blaming it would route a healthy
 *   peer out of the pool; not the task's fault, so counting it against
 *   `DEFAULT_MAX_TASK_FAILURES` would condemn a good shard. Retried like `node`,
 *   because a different peer means a different gate — but *named* differently, and
 *   therefore assertable. That naming is the whole point: the recorded failure
 *   attaches the *attempted* `nodeId`, so with only two kinds the record says the
 *   receiver failed no matter what the reason string says.
 *
 * A rejected promise counts as `node`, because an exception escaping a transport is
 * what an unreachable peer looks like from here.
 */
export type DispatchOutcome =
  | { readonly ok: true; readonly resultCid: string }
  | {
      readonly ok: false
      readonly kind: 'node' | 'task' | 'sender'
      readonly reason: string
    }

/** Run one shard on one node. */
export interface ShardDispatch {
  (shard: ShardWork, nodeId: string, lease: Lease): Promise<DispatchOutcome>
}

/**
 * Task-level failures tolerated before a shard is given up on.
 *
 * Three independently-chosen nodes all running the task and all failing it is far
 * better evidence of a bad task than of three unlucky nodes — the same reasoning as
 * `DEFAULT_MAX_GENERATIONS`, applied to the failure kind it was actually meant for.
 */
export const DEFAULT_MAX_TASK_FAILURES = 3

export interface CoordinatorOptions {
  readonly work: readonly ShardWork[]
  readonly nodes: readonly NodeDescriptor[]
  readonly dispatch: ShardDispatch
  /** The coordinator's clock. A port, so churn tests are deterministic. */
  readonly now: () => number
  /** Supply one to inspect the history afterwards, or let the run make its own. */
  readonly leases?: LeaseTable
  /** Candidates sampled per placement attempt. */
  readonly d?: number
  readonly admit?: AdmissionControl
  /** Task-level failures tolerated per shard. Node failures are bounded by the pool. */
  readonly maxTaskFailures?: number
  readonly speculation?: {
    readonly fraction?: number
    readonly factor?: number
    /** Poll interval. Also the floor on how quickly a straggler can be spotted. */
    readonly watchdogMs?: number
    /**
     * Extra time a losing copy gets to answer once every shard has settled.
     *
     * Only bounds the *comparison*, never the result: the winner is already decided
     * and returned. A copy that misses this window is reported as `uncompared`.
     */
    readonly compareGraceMs?: number
    readonly sleep?: Sleep
  }
  /**
   * Owners the job is defined over — CHURN-05.
   *
   * Omit for a single-owner or public job, where coverage over owners is not the
   * question being asked.
   */
  readonly expectedOwners?: readonly OwnerId[]
}

export interface ShardOutcome {
  readonly shardId: string
  readonly resultCid: string | null
  /** Which node's answer was taken. */
  readonly nodeId: string | null
  /** Nodes asked, in order, across every generation and any duplicate. */
  readonly attempted: readonly string[]
  /** Why each attempt failed, so a shard's history explains itself. */
  readonly failures: readonly {
    readonly nodeId: string
    readonly kind: 'node' | 'task' | 'sender'
    readonly reason: string
  }[]
  readonly rejections: readonly Rejection[]
  /** True when a speculative duplicate was started for this shard. */
  readonly speculated: boolean
  /** True when a duplicate produced a *different* CID — reported, never resolved. */
  readonly disagreed: boolean
  /**
   * Copies that had still not answered when the job finished comparing.
   *
   * Deliberately distinct from "agreed". An unfinished copy tells us nothing, and
   * folding it into agreement would assert something nobody checked.
   */
  readonly uncompared: readonly string[]
}

export interface CoordinatorOutcome {
  readonly ok: boolean
  readonly shards: readonly ShardOutcome[]
  /** shardId → result CID, for shards that produced one. */
  readonly results: ReadonlyMap<string, string>
  readonly failed: readonly string[]
  /** Dispatches beyond the first per task — CHURN-01's "visible, not hidden". */
  readonly redispatches: number
  /** The full lease history: every grant, expiry, surrender and completion. */
  readonly history: readonly LeaseEvent[]
  /** Total dispatches over useful ones, in the shape `verificationMultiplier` uses. */
  readonly speculationMultiplier: number
  readonly speculationSpent: number
  /** Owners that contributed against owners expected — CHURN-05. */
  readonly coverage: CoverageReport
  /** Shards whose replicas produced different CIDs. Never voted on. */
  readonly disagreements: readonly string[]
}

/**
 * `ownerId` is omitted rather than set to `undefined` when absent.
 *
 * Not a style choice: `exactOptionalPropertyTypes` makes the two different types, and
 * `eligibleNodes` treats a sovereign request whose owner is missing as *broken* rather
 * than unrestricted. Passing an explicit `undefined` through would be the one shape
 * that could turn a public shard's path into a sovereign shard's by accident.
 */
const requestFor = (shard: ShardWork, redundancy = 1): PlacementRequest =>
  shard.ownerId === undefined
    ? { shardId: shard.shardId, label: shard.label, redundancy }
    : { shardId: shard.shardId, label: shard.label, ownerId: shard.ownerId, redundancy }

/** One copy's answer, plus why it failed if it did. */
interface Attempt {
  readonly answer: SpeculativeAnswer
  readonly failure: { readonly kind: 'node' | 'task' | 'sender'; readonly reason: string } | null
}

/** A dispatch that never rejects — an escaping exception is what a dead peer looks like. */
async function attempt(
  dispatch: ShardDispatch,
  shard: ShardWork,
  nodeId: string,
  lease: Lease,
  now: () => number,
): Promise<Attempt> {
  let outcome: DispatchOutcome
  try {
    outcome = await dispatch(shard, nodeId, lease)
  } catch (cause) {
    outcome = {
      ok: false,
      kind: 'node',
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }

  return outcome.ok
    ? { answer: { nodeId, resultCid: outcome.resultCid, at: now() }, failure: null }
    : {
        answer: { nodeId, resultCid: null, at: now() },
        failure: { kind: outcome.kind, reason: outcome.reason },
      }
}

/**
 * What the inner race produced: a dispatch answered, or the watchdog fired.
 *
 * A discriminated union rather than a sentinel value, so the two outcomes cannot be
 * confused by a `null` answer — which is a perfectly ordinary dispatch result here.
 */
type Raced = { readonly tick: true } | { readonly tick: false; readonly attempt: Attempt }

/**
 * Run every shard, recovering from failure and slowness, and report both.
 *
 * Shards run concurrently — they share no state by construction, which is the whole
 * reason the partition is the unit of parallelism. What they *do* share is the
 * speculation budget and the lease table, both of which are job-wide on purpose.
 */
export async function runResilient(options: CoordinatorOptions): Promise<CoordinatorOutcome> {
  // The table's generation cap is a *backstop* against a task looping forever; the
  // loop's real bound is running out of untried nodes. Sizing it to the pool keeps
  // the backstop from firing before the policy does — two caps that both bite would
  // make "why did this shard stop" unanswerable. A caller supplying their own table
  // is choosing their own cap, deliberately.
  const leases =
    options.leases ?? new LeaseTable({ maxGenerations: Math.max(1, options.nodes.length) })
  const maxTaskFailures = options.maxTaskFailures ?? DEFAULT_MAX_TASK_FAILURES
  const ledger = new SpeculationLedger({
    tasks: options.work.length,
    fraction: options.speculation?.fraction ?? DEFAULT_SPECULATION_FRACTION,
  })
  const watchdogMs = options.speculation?.watchdogMs ?? DEFAULT_WATCHDOG_MS
  const compareGraceMs = options.speculation?.compareGraceMs ?? watchdogMs
  const factor = options.speculation?.factor ?? DEFAULT_STRAGGLER_FACTOR
  const sleep: Sleep = options.speculation?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const offerOptions: OfferOptions =
    options.admit === undefined
      ? { d: options.d ?? DEFAULT_D }
      : { d: options.d ?? DEFAULT_D, admit: options.admit }

  /** Durations of shards that have finished, shared so the median means something. */
  const completedDurations: number[] = []

  /**
   * Shards each owner contributed, against shards each owner *owes*.
   *
   * Counting an owner as covered the moment any one of their shards lands overstates
   * coverage exactly where it matters most: an owner with four shards, three of which
   * failed, would be reported as having contributed, and `complete` would be true over
   * a quarter of their data. That is the failure `coverage.ts` exists to prevent,
   * arriving through the composition rather than through `coverageOf`.
   */
  const owedByOwner = new Map<OwnerId, number>()
  const doneByOwner = new Map<OwnerId, number>()
  for (const shard of options.work) {
    if (shard.ownerId === undefined) continue
    owedByOwner.set(shard.ownerId, (owedByOwner.get(shard.ownerId) ?? 0) + 1)
  }

  /** Speculative copies that lost the race and have not been compared yet. */
  const outstanding: {
    readonly shardId: string
    readonly nodeId: string
    readonly winnerCid: string
    readonly copy: Promise<Raced>
  }[] = []

  const runShard = async (shard: ShardWork): Promise<ShardOutcome> => {
    const attempted: string[] = []
    const failures: { nodeId: string; kind: 'node' | 'task' | 'sender'; reason: string }[] = []
    const rejections: Rejection[] = []
    let speculated = false
    let disagreed = false
    let taskFailures = 0

    // Each pass is one generation: place, grant, dispatch, maybe duplicate. The loop
    // ends when a result arrives, when no untried eligible node is left, or when the
    // task itself has failed often enough to be judged broken rather than unlucky.
    for (;;) {
      if (taskFailures >= maxTaskFailures) break
      // Nodes already tried are removed before placement, not after.
      //
      // Placement is deterministic — rendezvous ranking on the shard id — which is
      // exactly what makes re-placement reproducible, and exactly why a re-dispatch
      // would otherwise pick the node that just failed, every time, until the
      // generations ran out. Narrowing the input can only narrow further: the
      // sovereignty gate still runs inside `placeWithOffers` on whatever it is
      // given, so constraint-first ordering survives this.
      const tried = new Set(attempted)
      const remaining = options.nodes.filter((candidate) => !tried.has(candidate.nodeId))
      const placement = await placeWithOffers(requestFor(shard), remaining, offerOptions)
      rejections.push(...placement.rejections)
      if (placement.status !== 'placed') break

      const nodeId = placement.nodeIds[0] as string
      const lease = leases.grant(shard.shardId, nodeId, options.now())
      // Null means the task is completed or has used its generations — either way
      // this shard is done being dispatched.
      if (lease === null) break

      attempted.push(nodeId)
      const startedAt = options.now()

      // Each dispatch is wrapped into its `Raced` form **once**, at creation. Wrapping
      // inside the loop allocates a fresh closure and promise per iteration, which
      // turns a fast watchdog into unbounded allocation — an out-of-memory crash
      // rather than a slow test, and only when a real dispatch is slower than the
      // watchdog, which is exactly when speculation is supposed to be working.
      const dispatchOn = (target: string): Promise<Raced> =>
        attempt(options.dispatch, shard, target, lease, options.now).then(
          (result): Raced => ({ tick: false, attempt: result }),
        )

      const pending = new Map<string, Promise<Raced>>([[nodeId, dispatchOn(nodeId)]])
      const answers: SpeculativeAnswer[] = []

      /**
       * Whether a tick can still *speculate* for this shard.
       *
       * Once a duplicate is running, the budget is spent, or there is no eligible node
       * left to duplicate onto, no further tick can start one — and each of those is
       * permanent, because the budget only shrinks and `attempted` only grows. So the
       * flag skips the evaluation.
       *
       * It emphatically does **not** stop the timer. An earlier version used it to
       * drop the watchdog out of the race entirely, which left the loop awaiting a
       * promise that might never settle — the flag was doing double duty as an
       * optimisation and as a (broken) termination argument. Termination is the
       * lease deadline's job, and only its job.
       */
      let watching = true
      /** Set when the lease deadline passed with nothing having answered. */
      let lapsed = false

      while (pending.size > 0) {
        // The timer is unconditional. `watching` only decides whether a tick may
        // *speculate*; it must never remove the deadline, or a peer that simply
        // never answers hangs this shard and, through Promise.all, the whole job.
        const raced: Raced = await Promise.race<Raced>([
          ...pending.values(),
          sleep(watchdogMs).then((): Raced => ({ tick: true })),
        ])

        if (raced.tick) {
          // The bounded wait the module header promises, actually enforced.
          if (options.now() >= lease.expiresAt) {
            for (const stalledOn of pending.keys()) {
              failures.push({
                nodeId: stalledOn,
                kind: 'node',
                reason: `no answer before the lease expired at ${lease.expiresAt}`,
              })
            }
            lapsed = true
            break
          }

          if (!watching) continue

          if (ledger.duplicated(shard.shardId) || ledger.remaining <= 0) {
            watching = false
            continue
          }

          // CHURN-06: the candidate set comes from the one eligibility gate, so a
          // sovereign shard's duplicate can only land on its owner's own nodes.
          const candidates = speculativeCandidates(requestFor(shard), options.nodes, [
            ...pending.keys(),
            ...attempted,
          ])
          if (candidates.length === 0) {
            // Nowhere legal to duplicate to. For a sovereign shard this is the
            // correct outcome and waiting is the only move.
            watching = false
            continue
          }

          // Being too new to judge is the one non-permanent reason to do nothing:
          // the median moves and elapsed time grows, so keep watching.
          const slow = stragglers([{ taskId: shard.shardId, nodeId, startedAt }], options.now(), {
            completed: completedDurations,
            factor,
          })
          if (slow.length === 0) continue
          if (!ledger.request(shard.shardId)) {
            watching = false
            continue
          }

          const target = candidates[0] as NodeDescriptor
          speculated = true
          attempted.push(target.nodeId)
          pending.set(target.nodeId, dispatchOn(target.nodeId))
          continue
        }

        const { answer, failure } = raced.attempt
        answers.push(answer)
        pending.delete(answer.nodeId)
        if (failure !== null) {
          failures.push({ nodeId: answer.nodeId, ...failure })
          // `'sender'` deliberately falls through to the same retry treatment as
          // `'node'` — a different peer means a different gate, so trying another
          // node is exactly right. That is a decision, not an omission: this is the
          // only place `kind` is read for policy, and the value of the third kind
          // is that the *record* names it, not that it changes what happens next.
          if (failure.kind === 'task') taskFailures += 1
        }
        // First result wins — but the copies still running are *registered*, not
        // forgotten. Nothing is cancelled: a losing copy carries the same CID and
        // dedupes into nothing, and if it does not, that is the single most
        // informative event this system can observe. See the module note.
        if (answer.resultCid !== null) break
      }

      const settled = settleRace(answers)
      if (settled.settled) {
        disagreed = disagreed || settled.disagreed
        for (const loser of settled.losers) {
          ledger.discard(shard.shardId, loser.nodeId, loser.disagreed)
        }
        for (const [copyOn, promise] of pending) {
          outstanding.push({
            shardId: shard.shardId,
            nodeId: copyOn,
            winnerCid: settled.resultCid,
            copy: promise,
          })
        }
        // The winner may be a speculative copy rather than the lease holder, so the
        // lease is closed against whoever actually holds it.
        const holder = leases.holder(shard.shardId)
        if (holder !== undefined) leases.complete(shard.shardId, holder.nodeId, options.now())
        completedDurations.push(Math.max(1, options.now() - startedAt))
        if (shard.ownerId !== undefined) {
          doneByOwner.set(shard.ownerId, (doneByOwner.get(shard.ownerId) ?? 0) + 1)
        }
        return {
          shardId: shard.shardId,
          resultCid: settled.resultCid,
          nodeId: settled.winner,
          attempted,
          failures,
          rejections,
          speculated,
          disagreed,
          uncompared: [],
        }
      }

      // The lease ran out with nothing to show. Reap *this* task only — a global
      // sweep from inside one shard's loop would expire a sibling's live lease.
      if (lapsed) {
        leases.reap(options.now(), shard.shardId)
        continue
      }

      // Observed failure, not silence: give the lease back now rather than spending
      // its full duration on information already in hand.
      if (!leases.surrender(shard.shardId, nodeId, options.now())) break
    }

    return {
      shardId: shard.shardId,
      resultCid: null,
      nodeId: null,
      attempted,
      failures,
      rejections,
      speculated,
      disagreed,
      uncompared: [],
    }
  }

  const settledShards = await Promise.all(options.work.map(runShard))

  // Every shard has finished. Now compare the speculative copies that lost, which
  // costs nothing extra: the job was already waiting for its slowest shard, and by
  // now the losers have had that whole time to answer.
  const lateDisagreements = new Map<string, string[]>()
  const lateUncompared = new Map<string, string[]>()
  await Promise.all(
    outstanding.map(async (copy) => {
      const settled = await Promise.race<Raced | null>([
        copy.copy,
        sleep(compareGraceMs).then(() => null),
      ])
      const answer = settled === null || settled.tick ? null : settled.attempt.answer
      const record = (into: Map<string, string[]>): void => {
        const existing = into.get(copy.shardId)
        if (existing) existing.push(copy.nodeId)
        else into.set(copy.shardId, [copy.nodeId])
      }

      if (answer === null || answer.resultCid === null) {
        // Never answered, or failed. Not evidence of agreement either way — and
        // recording it as agreement would assert something nobody checked.
        if (answer === null) record(lateUncompared)
        return
      }
      const disagrees = answer.resultCid !== copy.winnerCid
      ledger.discard(copy.shardId, copy.nodeId, disagrees)
      if (disagrees) record(lateDisagreements)
    }),
  )

  const shards: ShardOutcome[] = settledShards.map((shard) => {
    const late = lateDisagreements.get(shard.shardId)
    const unseen = lateUncompared.get(shard.shardId)
    if (late === undefined && unseen === undefined) return shard
    return {
      ...shard,
      disagreed: shard.disagreed || late !== undefined,
      uncompared: unseen ?? [],
    }
  })

  const results = new Map<string, string>()
  const failed: string[] = []
  const disagreements: string[] = []
  for (const shard of shards) {
    if (shard.resultCid === null) failed.push(shard.shardId)
    else results.set(shard.shardId, shard.resultCid)
    if (shard.disagreed) disagreements.push(shard.shardId)
  }

  const expectedOwners =
    options.expectedOwners ??
    [...new Set(options.work.map((shard) => shard.ownerId).filter((id): id is OwnerId => id !== undefined))]

  return {
    // A disagreement is a failed run, not a run with a footnote — the same rule
    // `executeReduce` and `executeVerified` apply.
    ok: failed.length === 0 && disagreements.length === 0,
    shards,
    results,
    failed,
    redispatches: leases.redispatches,
    history: leases.history,
    speculationMultiplier: ledger.multiplier,
    speculationSpent: ledger.spent,
    coverage: coverageOf(expectedOwners, [...owedByOwner]
      .filter(([owner, owed]) => (doneByOwner.get(owner) ?? 0) >= owed)
      .map(([owner]) => owner)),
    disagreements,
  }
}
