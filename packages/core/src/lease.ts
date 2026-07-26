/**
 * Task leases and re-dispatch — CHURN-04, and the history CHURN-01 asks to be visible.
 *
 * A volunteer fabric loses nodes constantly and without notice. The scheduler needs an
 * answer to "is anyone still working on this", and the cheapest correct answer is a
 * **lease**: a node holds a task until a deadline, and if it has not reported by then,
 * the task is available again. No liveness protocol, no failure detector, no consensus
 * on who is alive — a deadline is a fact both sides can evaluate alone.
 *
 * ## The invariant that makes all of this safe
 *
 * **Liveness can change who computes a task and when, never what the answer is.** That
 * is true because a result is a pure function of `(module, input, partition)` and is
 * content-addressed, so a re-dispatch recomputes the identical bytes. It is why the
 * lease can be aggressive — expiring a node that was merely slow costs work, never
 * correctness — and it is the property to check first if any of this is ever changed.
 *
 * ## Expiry is not "the node died"
 *
 * An expired lease means *this node has not reported in time*, which is all anyone can
 * actually know. The node may be dead, throttled to a background tab's ~1/min, or on a
 * train. So expiry does not accuse: it releases the task for re-dispatch, and if the
 * original node later reports, its answer is refused as **stale** rather than wrong —
 * it carries the same CID as the recomputed one anyway.
 *
 * Two rules keep that honest:
 *
 * 1. **A completion is checked against the current holder.** A node reporting for a
 *    lease it no longer holds is refused. Without this, a slow node's late arrival
 *    could overwrite a re-dispatch's newer state, which is the one way a churn
 *    mechanism could change an answer. (The *deadline* half of that check is a
 *    contract rule rather than a correctness one — see `complete`, which says exactly
 *    what each half buys and what the strict version gives up.)
 * 2. **Re-dispatch is bounded.** A task that fails everywhere would otherwise be
 *    re-dispatched forever, burning the fabric on work that cannot succeed.
 *    `maxGenerations` turns that into a stated failure.
 *
 * ## Everything is recorded
 *
 * CHURN-01 requires re-dispatches to be "visible in the job history rather than
 * hidden". The table is therefore append-only about its past: every grant, renewal,
 * completion and expiry is an event, and the history is the audit trail that explains
 * why a job cost what it cost. A scheduler that quietly retried would produce correct
 * answers and inexplicable bills.
 *
 * Pure module. The clock is a parameter, never a global — the same discipline as
 * `EnrollmentAuthority`, and what makes expiry deterministic in tests.
 */

/** Default time a node holds a task before it is available again. */
export const DEFAULT_LEASE_MS = 30_000

/**
 * Default cap on how many times one task may be dispatched.
 *
 * Three is two retries. A task that has failed on three independently-chosen nodes is
 * far more likely to be a bad task than three unlucky nodes, and continuing to re-dispatch
 * it spends the fabric on something that will not succeed.
 */
export const DEFAULT_MAX_GENERATIONS = 3

export interface Lease {
  readonly taskId: string
  readonly nodeId: string
  readonly grantedAt: number
  readonly expiresAt: number
  /** Dispatch count for this task, including this one. Starts at 1. */
  readonly generation: number
}

/**
 * Why a task is no longer outstanding.
 *
 * `abandoned` is deliberately distinct from `failed`: the first means nobody finished
 * it in time, the second means the work itself cannot be done. Collapsing them would
 * make an overloaded fabric look like a broken job.
 */
export type LeaseEvent =
  | { readonly kind: 'granted'; readonly taskId: string; readonly nodeId: string; readonly at: number; readonly generation: number }
  | { readonly kind: 'renewed'; readonly taskId: string; readonly nodeId: string; readonly at: number; readonly expiresAt: number }
  | { readonly kind: 'completed'; readonly taskId: string; readonly nodeId: string; readonly at: number; readonly generation: number }
  | { readonly kind: 'expired'; readonly taskId: string; readonly nodeId: string; readonly at: number; readonly generation: number }
  | { readonly kind: 'surrendered'; readonly taskId: string; readonly nodeId: string; readonly at: number; readonly generation: number }
  | { readonly kind: 'stale-completion'; readonly taskId: string; readonly nodeId: string; readonly at: number; readonly heldBy: string | null }
  | { readonly kind: 'abandoned'; readonly taskId: string; readonly at: number; readonly generations: number }

export interface LeaseTableOptions {
  readonly leaseMs?: number
  /** Dispatches allowed per task before it is abandoned. */
  readonly maxGenerations?: number
}

/** A task released by expiry, and whether it may be dispatched again. */
export interface Reaped {
  readonly taskId: string
  readonly previousHolder: string
  readonly generation: number
  /** False once `maxGenerations` is used up — the task is abandoned, not re-dispatched. */
  readonly redispatchable: boolean
}

/**
 * Who holds what, and what has happened to it.
 *
 * Deliberately not a scheduler: it grants, renews, reaps and records, and says nothing
 * about *which* node should get a task next. That choice belongs to placement, which
 * already has the rendezvous ranking and the sovereignty gate — and keeping the two
 * apart is what stops re-dispatch from quietly acquiring its own node-selection rule.
 */
export class LeaseTable {
  readonly #leaseMs: number
  readonly #maxGenerations: number
  readonly #held = new Map<string, Lease>()
  /** Dispatch count per task, retained after release so re-dispatch stays bounded. */
  readonly #generations = new Map<string, number>()
  readonly #abandoned = new Set<string>()
  readonly #completed = new Set<string>()
  readonly #history: LeaseEvent[] = []

  constructor(options: LeaseTableOptions = {}) {
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    const maxGenerations = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS
    if (!(leaseMs > 0)) throw new RangeError(`leaseMs must be positive, got ${leaseMs}`)
    if (!Number.isInteger(maxGenerations) || maxGenerations < 1) {
      throw new RangeError(`maxGenerations must be a positive integer, got ${maxGenerations}`)
    }
    this.#leaseMs = leaseMs
    this.#maxGenerations = maxGenerations
  }

  get leaseMs(): number {
    return this.#leaseMs
  }

  /** Every grant, renewal, completion and expiry, in order — CHURN-01. */
  get history(): readonly LeaseEvent[] {
    return this.#history
  }

  /** Leases currently held, whether or not they have expired. */
  get outstanding(): readonly Lease[] {
    return [...this.#held.values()]
  }

  /** Tasks abandoned after exhausting their dispatches. */
  get abandoned(): readonly string[] {
    return [...this.#abandoned].sort()
  }

  /** Re-dispatches so far: every generation beyond the first, summed. */
  get redispatches(): number {
    let total = 0
    for (const generation of this.#generations.values()) total += generation - 1
    return total
  }

  holder(taskId: string): Lease | undefined {
    return this.#held.get(taskId)
  }

  /**
   * Grant a task to a node.
   *
   * Returns `null` when the task is already held by someone whose lease is still
   * live, or has been completed or abandoned. Granting over a live lease would put
   * two nodes on one task with neither told — which is what speculation does
   * *deliberately* and with a budget, and must never happen by accident here.
   */
  grant(taskId: string, nodeId: string, now: number): Lease | null {
    if (this.#completed.has(taskId) || this.#abandoned.has(taskId)) return null
    const existing = this.#held.get(taskId)
    if (existing !== undefined && existing.expiresAt > now) return null

    // An un-reaped expired lease still counts as a used generation; reap it first so
    // the history records why the task became available.
    if (existing !== undefined) this.#expire(existing, now)

    const generation = (this.#generations.get(taskId) ?? 0) + 1
    if (generation > this.#maxGenerations) {
      this.#abandon(taskId, now, generation - 1)
      return null
    }

    const lease: Lease = {
      taskId,
      nodeId,
      grantedAt: now,
      expiresAt: now + this.#leaseMs,
      generation,
    }
    this.#held.set(taskId, lease)
    this.#generations.set(taskId, generation)
    this.#history.push({ kind: 'granted', taskId, nodeId, at: now, generation })
    return lease
  }

  /**
   * Extend a live lease — the heartbeat a working node sends.
   *
   * Refuses to renew an already-expired lease. Renewal is how a node says "still
   * working"; allowing it after expiry would let a node reclaim a task that has
   * already been re-dispatched, putting two holders on one task with the table
   * believing there is one.
   */
  renew(taskId: string, nodeId: string, now: number): Lease | null {
    const lease = this.#held.get(taskId)
    if (lease === undefined || lease.nodeId !== nodeId) return null
    if (lease.expiresAt <= now) return null

    const renewed: Lease = { ...lease, expiresAt: now + this.#leaseMs }
    this.#held.set(taskId, renewed)
    this.#history.push({ kind: 'renewed', taskId, nodeId, at: now, expiresAt: renewed.expiresAt })
    return renewed
  }

  /**
   * Report a task done.
   *
   * Returns false — and records a `stale-completion` — when the reporting node is not
   * the current holder, or its lease has lapsed. The two conditions do different jobs,
   * and it is worth being exact about which:
   *
   * - **The holder check is the correctness one.** Once a task has been reaped and
   *   re-granted, a late report from the previous holder must not land. This is the
   *   one path by which a churn mechanism could change an answer, and it is closed
   *   here.
   * - **The deadline check is the contract one.** It only bites in the narrow window
   *   where a lease has lapsed but nothing has reaped it yet — and in that window
   *   accepting the work would in fact be *safe*, since nobody else holds the task and
   *   the result is deterministic either way.
   *
   * It is still refused, deliberately. A lease whose expiry is sometimes negotiable is
   * not a deadline, and the worker's reason to self-terminate evaporates the moment a
   * late report might still count. Uniform beats marginally cheaper here — but the
   * saving that is being given up is real, and pretending the strict rule prevents a
   * wrong answer would be the more expensive mistake.
   */
  complete(taskId: string, nodeId: string, now: number): boolean {
    const lease = this.#held.get(taskId)
    const stale =
      lease === undefined || lease.nodeId !== nodeId || lease.expiresAt <= now
    if (stale) {
      this.#history.push({
        kind: 'stale-completion',
        taskId,
        nodeId,
        at: now,
        heldBy: lease?.nodeId ?? null,
      })
      return false
    }

    this.#held.delete(taskId)
    this.#completed.add(taskId)
    this.#history.push({ kind: 'completed', taskId, nodeId, at: now, generation: lease.generation })
    return true
  }

  /**
   * Give a task back before its deadline, on an observed hard failure.
   *
   * A deadline is the right answer to *silence*, and the wrong answer to a node that
   * has demonstrably gone — waiting 30 seconds for a lease held by a peer whose
   * connection was refused wastes the whole lease on information already in hand.
   * Surrender is that shortcut, and it is deliberately not a way around expiry: it
   * still consumes the generation, so a task that fails fast on three nodes is
   * abandoned exactly as one that timed out on three.
   *
   * Returns false if the caller does not hold the lease it is trying to give back,
   * which keeps this from becoming a way to knock another node off a task.
   */
  surrender(taskId: string, nodeId: string, now: number): boolean {
    const lease = this.#held.get(taskId)
    if (lease === undefined || lease.nodeId !== nodeId) return false

    this.#held.delete(taskId)
    this.#history.push({
      kind: 'surrendered',
      taskId,
      nodeId,
      at: now,
      generation: lease.generation,
    })
    if (lease.generation >= this.#maxGenerations) this.#abandon(taskId, now, lease.generation)
    return true
  }

  /**
   * Expire everything past its deadline and report what is now free.
   *
   * The caller re-dispatches whatever comes back `redispatchable`, choosing the node
   * through placement as usual. A task that has used its last generation comes back
   * `redispatchable: false` and is recorded as abandoned.
   */
  reap(now: number): readonly Reaped[] {
    const reaped: Reaped[] = []
    for (const lease of [...this.#held.values()]) {
      if (lease.expiresAt > now) continue
      this.#expire(lease, now)
      const redispatchable = lease.generation < this.#maxGenerations
      if (!redispatchable) this.#abandon(lease.taskId, now, lease.generation)
      reaped.push({
        taskId: lease.taskId,
        previousHolder: lease.nodeId,
        generation: lease.generation,
        redispatchable,
      })
    }
    return reaped.sort((a, b) => a.taskId.localeCompare(b.taskId))
  }

  #expire(lease: Lease, now: number): void {
    this.#held.delete(lease.taskId)
    this.#history.push({
      kind: 'expired',
      taskId: lease.taskId,
      nodeId: lease.nodeId,
      at: now,
      generation: lease.generation,
    })
  }

  #abandon(taskId: string, now: number, generations: number): void {
    if (this.#abandoned.has(taskId)) return
    this.#abandoned.add(taskId)
    this.#history.push({ kind: 'abandoned', taskId, at: now, generations })
  }
}

/**
 * What a worker does when its own lease runs out — the node half of CHURN-04.
 *
 * The requirement is that the worker "self-terminates on expiry and releases whatever
 * it has to content-addressed storage rather than writing a stale result". Both halves
 * matter and they are different things:
 *
 * - **Self-terminate.** Stop computing. The task has been re-dispatched; finishing it
 *   spends the volunteer's battery on an answer nobody will accept.
 * - **Release, do not report.** If an output was produced, put the bytes in the
 *   blockstore, where they are addressed by content and cost nothing to keep, and
 *   return the CID marked as released. Do *not* return it as the task's result —
 *   the coordinator's `complete` would refuse it anyway, and a worker that reported
 *   anyway would be relying on that refusal.
 *
 * Note what this is *not* protecting against. A late result is not dangerous: it is
 * byte-identical to the recomputed one, because the computation is deterministic and
 * content-addressed. The reason to stop is **cost**, not correctness — and saying so
 * plainly is better than implying the system would break without it.
 */
export type LeaseCheck =
  | { readonly expired: false; readonly remainingMs: number }
  | { readonly expired: true; readonly overdueMs: number }

/** Whether a held lease still permits work, from the worker's own clock. */
export function checkLease(lease: Lease, now: number): LeaseCheck {
  return lease.expiresAt > now
    ? { expired: false, remainingMs: lease.expiresAt - now }
    : { expired: true, overdueMs: now - lease.expiresAt }
}

/**
 * When a worker should renew, as a fraction of the lease elapsed.
 *
 * Two-thirds leaves a full third of the lease for the renewal to arrive and be
 * processed. Renewing at the deadline would mean every renewal races the expiry it
 * exists to prevent.
 */
export const RENEW_AT: number = 2 / 3

/** Whether a worker holding this lease should send a heartbeat now. */
export function shouldRenew(lease: Lease, now: number): boolean {
  const elapsed = now - lease.grantedAt
  const span = lease.expiresAt - lease.grantedAt
  return span > 0 && elapsed >= span * RENEW_AT && now < lease.expiresAt
}
