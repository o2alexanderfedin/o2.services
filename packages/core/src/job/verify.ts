/**
 * Redundant execution and result verification — VER-01, VER-05, VER-06.
 *
 * ## What this module does, and what it does not
 *
 * 1. **There is no plagiarism resistance here, and that is still true.** The requestor
 *    calls every executor itself and mints the whole record; agreement is compared *post
 *    hoc* and nothing in this function stops a replica copying a peer's answer.
 *    Resistance to that is VER-02, and it lives one file over in `commit-reveal.ts` — a
 *    two-round protocol *across* nodes, with a wire message, a cross-node barrier and a
 *    hiding commitment, none of which this function has or should grow.
 *
 *    The two are **siblings, not modes**: `submitJob` selects between them per dispatch
 *    (public shard, at least two replicas, every executor speaking both rounds), they
 *    return the identical {@link VerificationResult}, and falling through to this one is
 *    not a degraded ceremony. What used to stand in this slot was a paragraph explaining
 *    that the ceremony deleted in `855cdf5` could never have become a real one — its
 *    nonce derived from `nodeId:moduleCid:partitionIndex`, all public, and the requestor
 *    computed both halves of a comparison that was therefore unconditionally true, with
 *    both failure branches unreachable, measured over 1171 tests. That diagnosis is now
 *    where it is useful: it is the specification `commit-reveal.ts` was written against,
 *    and it is quoted there.
 *
 * 2. **The compared value covers `(task, output)` only (VER-05).** Timing, fuel,
 *    and node identity sit outside it. Including them would make every honest
 *    redundant execution disagree, and the disagreement would be misdiagnosed as
 *    a determinism problem in the guest.
 *
 * 3. **Host calls and peak memory are carried and summed, and not yet compared.**
 *    `grossHostCalls`/`usefulHostCalls` and `grossPeakMemoryPages`/`usefulPeakMemoryPages`
 *    follow fuel's two rules exactly. Unlike time they are exact and the same on every
 *    engine, so they *could* be held to — but they stay out of the digest for rule 2's
 *    reason until that is decided on its own, and a replica on a build from before them
 *    reports 0 for an answer a current replica reports 7 for.
 *
 * 4. **Execution time is carried, summed and never judged.** `grossExecMs` and
 *    `usefulExecMs` follow `grossFuel` and `usefulFuel` exactly — every answering replica
 *    into gross, the answer's replica into useful — but each figure is a node's own
 *    clock reading and nothing here can check it. It is reported so a requestor can
 *    see what a job cost in time, and read by nothing that decides agreement.
 *
 * Disagreement is surfaced, never majority-voted away (VER-01). The caller
 * decides what to do about it; silently picking a winner would hide exactly the
 * event this mechanism exists to detect.
 */

import type { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { Executor, Task } from '../ports.ts'
import type { AttestedResult } from '../result-attestation.ts'

/**
 * What one executor's run of a task came to.
 *
 * `attestation` is what the node itself said about the output — a signature checkable
 * against its provider-issued certificate, or `'signed-by-nobody'`. It reaches a caller
 * on {@link AgreeingReplica}, one `.map` below, and this array is the only place it
 * comes from.
 *
 * It is deliberately outside the compared value. `resultCid` is what replicas are
 * compared on (VER-05); two honest replicas of one shard produce the same `resultCid`
 * and different attestations, and always will, because the signer is in the challenge.
 */
export type Receipt =
  | {
      ok: true
      nodeId: string
      resultCid: CID
      output: CanonicalValue
      fuelUsed: number
      /** The node's own reading of its run — see `ExecutionOutcome.execMs`. */
      execMs: number
      /** Host calls the guest made — see `ExecutionOutcome.hostCalls`. */
      hostCalls: number
      /** The guest's memory at the end, in 64 KiB pages — see `ExecutionOutcome.peakMemoryPages`. */
      peakMemoryPages: number
      attestation: AttestedResult
    }
  | { ok: false; nodeId: string; reason: string }

/** Run one executor and content-address what it produced. */
async function runOne(executor: Executor, task: Task): Promise<Receipt> {
  let outcome
  try {
    outcome = await executor.execute(task)
  } catch (cause) {
    // The port says a failure is a value; an implementation is foreign code and can
    // still throw. Converted here because this is the only place the node id is in
    // scope — one replica's collapse must not discard its co-replicas' completed
    // work, and a rejection carries no name. The same conversion `RemoteExecutor`,
    // `coordinator`'s `attempt` and `serveAgent`'s exec branch already make.
    return {
      ok: false,
      nodeId: executor.nodeId,
      reason: `execute threw on ${executor.nodeId}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
  if (!outcome.ok) {
    return { ok: false, nodeId: executor.nodeId, reason: outcome.reason }
  }
  const hashed = await canonicalCid(outcome.output)
  if (!hashed.ok) {
    // A non-finite float in the output is refused by the codec, so it can never
    // reach a comparison. Report it as this node's failure, not as divergence.
    return {
      ok: false,
      nodeId: executor.nodeId,
      reason: `output not encodable: ${JSON.stringify(hashed.error)}`,
    }
  }
  return {
    ok: true,
    nodeId: executor.nodeId,
    resultCid: hashed.cid,
    output: outcome.output,
    fuelUsed: outcome.fuelUsed,
    execMs: outcome.execMs,
    hostCalls: outcome.hostCalls,
    peakMemoryPages: outcome.peakMemoryPages,
    attestation: outcome.attestation,
  }
}

/**
 * One replica that agreed, and what that replica signed.
 *
 * ## Why the signature lives on the same element as the node id
 *
 * The cheaper change was to leave `agreeing` a `readonly string[]` and add a sibling
 * `attestations` array beside it. It is refused for the reason `19-CONTEXT.md` gives
 * against a parallel `nodeId → certificate` map — *a second source of truth that can
 * disagree, with nothing able to catch the disagreement* — which here would be a
 * **positional** correspondence that drifts silently. And it would leave a downstream
 * reader a **choice** between building a receipt from names and building one from
 * signatures. A receipt derived from names is the submitter's word about itself, which
 * is the artifact this leg exists to replace, so the choice is removed rather than
 * documented.
 *
 * `executeVerified` is the only producer, and both halves come off the same `answered`
 * array in one expression. That is what makes one field safe where two would not have
 * been: the ids and the attestations are two projections of one array and cannot drift
 * apart.
 *
 * ## Three things a reader must not assume
 *
 * - **This is the set that MATCHED, never the set that was placed.** The grouping above
 *   is keyed on `resultCid`, so a node that was asked and answered differently is in a
 *   partition, and a node that was asked and failed is in `failures`. A receipt computed
 *   over this array is therefore a statement about agreement, not about dispatch.
 * - **`'signed-by-nobody'` is a truthful statement, not a degraded reading.** It says a
 *   replica nobody enrolled ran this work; it is not a signature that failed, and
 *   `verifyResultAttestation` refuses it by its own name, `not-attested`. The four
 *   kernel executors report it by construction.
 * - **An attestation is NOT part of the compared digest.** VER-05's rule is unchanged:
 *   what replicas are compared on covers `(task, output)` and nothing else. An
 *   attestation is per node — two honest replicas of one shard sign different bytes by
 *   design — so folding it into the comparison would make every honest redundant
 *   execution disagree. It travels beside the compared value, and the two sit adjacent
 *   here precisely because they are easy to confuse.
 */
export interface AgreeingReplica {
  /** The replica's node id — the same string this field carried before it grew a record. */
  readonly nodeId: string
  /** What this replica said about the output, or its statement that it signs nothing. */
  readonly attestation: AttestedResult
}

export type VerificationResult =
  | {
      status: 'agreed'
      resultCid: CID
      output: CanonicalValue
      /** Replicas whose reveals matched, each with what it signed. */
      agreeing: readonly AgreeingReplica[]
      /** Redundancy actually achieved. */
      replicas: number
      /**
       * Nodes that were asked and refused, each in its own words — **on the agreed arm
       * too, and that is the whole of the fix**.
       *
       * This arm carried no such field until it was measured not to. A shard whose first
       * executor refused by name and whose re-pick then succeeded came back `agreed` with
       * the refusal nowhere in the result: `ShardResult.attempted` said node `n1` had been
       * asked and `ShardResult.generations` said a retry had happened, but the reason `n1`
       * gave was unreachable from the returned value. That is exactly the silent filtering
       * Phase 6's rule forbids — *"silent filtering leaves a requestor unable to tell a
       * dead network from a wrong clock from a module nobody can run"* — arriving one
       * layer up, where a caller is least likely to look for it because the job succeeded.
       *
       * **The loss was never only across generations.** `executeVerified` computes this
       * array for every dispatch and used it on two arms of three, so a *single* dispatch
       * at redundancy 2 with one replica failing and one agreeing dropped the failure just
       * as thoroughly. That is why the field lives on the type rather than being
       * accumulated by `submitJob`'s generation loop: a `ShardResult`-shaped repair would
       * have closed the half that was easy to see and left the half below it open.
       *
       * **Required, not optional**, for the reason `ShardResult.attestation` gives: an
       * omitted array read as `[]` makes *nobody refused* indistinguishable from *nobody
       * recorded it*, at the exact point the distinction is what the caller wanted.
       *
       * `[]` on the ordinary reading, and it is a measurement rather than a default —
       * every executor that was asked answered.
       *
       * **Not the same set as `agreeing`'s complement.** A node that answered with a
       * *different* result is not a failure and does not appear here; that case is the
       * `disagreed` arm. This is the set that produced no answer at all.
       */
      failures: readonly { nodeId: string; reason: string }[]
      grossFuel: number
      usefulFuel: number
      /**
       * Milliseconds every answering replica reported running for, summed — the time
       * counterpart of `grossFuel`, over the same replicas. **Self-reported**: each term
       * is one node's own clock reading, and a node can inflate or deflate it unseen.
       */
      grossExecMs: number
      /** The answer's replica's reported milliseconds — the replica `usefulFuel` is read from. */
      usefulExecMs: number
      /**
       * Host calls every answering replica's guest made, summed — over the same replicas
       * `grossFuel` sums. A count, exact per run.
       */
      grossHostCalls: number
      /** The answer's replica's host calls — the replica `usefulFuel` is read from. */
      usefulHostCalls: number
      /**
       * Every answering replica's peak linear memory, in 64 KiB pages, summed — a sum of
       * per-run peaks (page-runs), **not** the most memory any one run held at once.
       */
      grossPeakMemoryPages: number
      /** The answer's replica's peak memory, in 64 KiB pages. */
      usefulPeakMemoryPages: number
    }
  | {
      status: 'disagreed'
      /**
       * Every distinct result, with the nodes that produced it.
       *
       * **Node ids only, and deliberately.** A shard that did not agree has no agreement
       * to attest, and signatures here would invite a reader to pick the side with the
       * better-attested nodes — which is the majority vote this module's header refuses
       * to take, wearing different clothes.
       */
      partitions: readonly { resultCid: string; nodes: readonly string[] }[]
      failures: readonly { nodeId: string; reason: string }[]
      /**
       * Fuel every answering replica burned, summed across the split — the same sum the
       * `agreed` arm carries. A replica that answered differently still did the work, and
       * this arm once dropped the sum it had just computed, so a job whose shards
       * disagreed reported a gross fuel of zero for work that was paid in full. No
       * `usefulFuel` here: no run produced the answer, because there is none.
       */
      grossFuel: number
      /**
       * Milliseconds every answering replica reported, summed across the split — carried
       * here for `grossFuel`'s reason. Self-reported, as on the `agreed` arm.
       */
      grossExecMs: number
      /** Host calls every answering replica made, summed across the split — `grossFuel`'s reason. */
      grossHostCalls: number
      /** Every answering replica's peak memory in 64 KiB pages, summed across the split. */
      grossPeakMemoryPages: number
    }
  | {
      status: 'insufficient'
      reason: string
      failures: readonly { nodeId: string; reason: string }[]
    }

/**
 * Execute one task across `executors` and verify agreement.
 *
 * Redundancy is however many executors are supplied — a single executor is the
 * R=1 case (verification off, VER-06), and returns `agreed` with `replicas: 1`.
 */
export async function executeVerified(
  task: Task,
  executors: readonly Executor[],
): Promise<VerificationResult> {
  if (executors.length === 0) {
    return { status: 'insufficient', reason: 'no executors supplied', failures: [] }
  }

  const receipts = await Promise.all(executors.map((e) => runOne(e, task)))

  const failures = receipts
    .filter((r): r is Extract<Receipt, { ok: false }> => !r.ok)
    .map((r) => ({ nodeId: r.nodeId, reason: r.reason }))

  const answered = receipts.filter((r): r is Extract<Receipt, { ok: true }> => r.ok)
  if (answered.length === 0) {
    return { status: 'insufficient', reason: 'every executor failed', failures }
  }

  // Group by result. More than one group is disagreement — reported, not voted on.
  const groups = new Map<string, string[]>()
  for (const answer of answered) {
    const key = answer.resultCid.toString()
    const nodes = groups.get(key)
    if (nodes) nodes.push(answer.nodeId)
    else groups.set(key, [answer.nodeId])
  }

  const grossFuel = answered.reduce((sum, r) => sum + r.fuelUsed, 0)
  const grossExecMs = answered.reduce((sum, r) => sum + r.execMs, 0)
  const grossHostCalls = answered.reduce((sum, r) => sum + r.hostCalls, 0)
  const grossPeakMemoryPages = answered.reduce((sum, r) => sum + r.peakMemoryPages, 0)

  if (groups.size > 1) {
    return {
      status: 'disagreed',
      partitions: [...groups.entries()].map(([resultCid, nodes]) => ({ resultCid, nodes })),
      failures,
      grossFuel,
      grossExecMs,
      grossHostCalls,
      grossPeakMemoryPages,
    }
  }

  const winner = answered[0] as Extract<Receipt, { ok: true }>
  return {
    status: 'agreed',
    resultCid: winner.resultCid,
    output: winner.output,
    // One `.map` over one array: the node id and the attestation are two projections of
    // the same receipt and cannot be assembled from different orders. See
    // {@link AgreeingReplica} for why that is the whole argument for one field.
    agreeing: answered.map((r) => ({ nodeId: r.nodeId, attestation: r.attestation })),
    replicas: answered.length,
    // The **same** array the other two arms return, off the same `receipts` pass above.
    // It was computed here and used on two arms of three, so a dispatch at redundancy 2
    // that got one refusal and one answer reported the answer and discarded the refusal.
    // See {@link VerificationResult}'s `failures` for why that had to be fixed on the
    // type rather than in the caller.
    failures,
    grossFuel,
    usefulFuel: winner.fuelUsed,
    grossExecMs,
    usefulExecMs: winner.execMs,
    grossHostCalls,
    usefulHostCalls: winner.hostCalls,
    grossPeakMemoryPages,
    usefulPeakMemoryPages: winner.peakMemoryPages,
  }
}
