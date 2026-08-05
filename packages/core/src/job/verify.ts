/**
 * Redundant execution and result verification — VER-01, VER-02, VER-05, VER-06.
 *
 * ## What this module does, and what it does not
 *
 * 1. **There is no plagiarism resistance here (VER-02 is not implemented).** The
 *    requestor holds every executor in one process, calls them itself, and mints the
 *    whole record; agreement is therefore compared *post hoc* and nothing in this
 *    function stops a replica copying a peer's answer. Resistance to that is a
 *    two-round protocol *across* nodes — a wire message and a cross-node barrier —
 *    and additionally needs a **hiding** commitment, which is why the ceremony this
 *    module used to carry could never have supplied it: its nonce was derived from
 *    `nodeId:moduleCid:partitionIndex`, all three public, and the requestor computed
 *    both halves and compared them with each other. The comparison was
 *    unconditionally true and both of its failure branches were unreachable —
 *    measured 2026-07-30 by making the mismatch branch throw and running the whole
 *    node project: 1171 tests, no reach. Its shape is not a seam a real ceremony
 *    would plug into, so it is gone rather than kept.
 *
 * 2. **The compared value covers `(task, output)` only (VER-05).** Timing, fuel,
 *    and node identity sit outside it. Including them would make every honest
 *    redundant execution disagree, and the disagreement would be misdiagnosed as
 *    a determinism problem in the guest.
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
      grossFuel: number
      usefulFuel: number
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

  if (groups.size > 1) {
    return {
      status: 'disagreed',
      partitions: [...groups.entries()].map(([resultCid, nodes]) => ({ resultCid, nodes })),
      failures,
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
    grossFuel,
    usefulFuel: winner.fuelUsed,
  }
}
