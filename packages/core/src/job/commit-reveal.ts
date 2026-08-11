/**
 * The two-round commit-reveal ceremony — VER-02.
 *
 * ## What was here before, and why this is not that
 *
 * A ceremony shipped under this id in Phase 1 and was **deleted** on 2026-07-30
 * (`855cdf5`) rather than relabelled. Its defect is the specification for this file, so
 * it is restated rather than linked: `runOne` computed `H(nonce ‖ resultCid)` from two
 * values it had just produced, put both in the record, and the reveal phase recomputed
 * the digest from the same two values through the same pure function. The comparison
 * could not be false. That was **measured** — the mismatch branch was made to throw and
 * the whole node project run, 1171 tests, no reach — and the nonce derived from
 * `nodeId:moduleCid:partitionIndex`, all three public, so it hid nothing either.
 *
 * Three things had to change for a ceremony to mean anything, and all three are here:
 *
 * 1. **The commitment is produced by the executor, not by the requestor.** The
 *    requestor receives a digest in round 1 and holds it. It never learns the nonce or
 *    the output until round 2. So the round-2 comparison is between a value it was
 *    *given* and a value it *computes*, which is a comparison that can be false.
 * 2. **The nonce is drawn from the platform CSPRNG** ({@link CEREMONY_NONCE_BYTES}),
 *    inside the executor, and is never derived from anything the requestor or a peer
 *    knows. That is what makes the commitment *hiding*: a digest handed to the
 *    requestor in round 1 discloses nothing about the answer.
 * 3. **There is a barrier.** Every commitment is collected before any reveal is asked
 *    for — `await Promise.all` over round 1, then a second pass. No executor is asked
 *    to reveal while another executor's answer is still unfixed.
 *
 * ## What the property actually is, stated so it is not over-read
 *
 * VER-02: *"Executors commit to a result hash before revealing the result, so a replica
 * cannot plagiarize a peer's answer."*
 *
 * This does **not** prevent a replica from seeing a peer's answer; nothing in a fabric
 * of volunteer nodes can promise that. What it does is fix each replica's answer before
 * any answer exists in revealed form anywhere, so *acting* on what was seen is
 * detectable: a reveal that does not reproduce the digest its own node published in
 * round 1 is refused by name and that node is a `failure`, not a vote.
 *
 * The serving half of the same property lives in `@o2/net`'s `serveAgent`: a pending
 * commitment is revealed **only to the peer that made it**, so one replica cannot read
 * another's answer out of the node holding it.
 *
 * ## The tier this applies to, and the tier it does not
 *
 * **Public/shared shards only.** `.planning/PROJECT.md`'s integrity table splits the
 * claim: public data gets full N-version redundant execution with commit-reveal, while
 * sovereign (owner-pinned) data is *owner-attested* — the map runs on the owner's own
 * nodes and the verified thing is the aggregation over contributions, not the map. A
 * quorum drawn from one owner's own hardware has no plagiarism threat to resist: both
 * replicas are the owner's, the receipt already says `owner-domain` and is explicitly a
 * weaker claim than `independent` (VER-10). Running a ceremony there would spend two
 * round trips to establish a property the trust model does not need, and — worse —
 * would let a reader infer independence from the presence of a ceremony. `submitJob`
 * therefore selects this path for `label: 'public'` shards only, and the requirements
 * row says so rather than implying coverage the sovereign arm does not have.
 *
 * ## What this module does not do
 *
 * It does not time anything. A straggler that never answers round 1 is bounded where
 * the wait actually happens — `DEFAULT_RPC_TIMEOUT_MS` in `@o2/net`'s `rpc.ts` — and a
 * second bound here would be a second number that can disagree with the first. The only
 * bound this file states is {@link MIN_CEREMONY_REPLICAS}, which is a *round* bound and
 * not a clock.
 *
 * Pure module apart from {@link drawCeremonyNonce}, which reads the platform CSPRNG for
 * the reason `enrollment.ts` states about its own single impurity: a nonce a caller
 * could predict is not a nonce.
 */

import { randomBytes } from '@noble/hashes/utils.js'
import type { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import { toHex } from '../capability.ts'
import { sha256 } from '../hash.ts'
import type { Executor, Task } from '../ports.ts'
import type { AttestedResult } from '../result-attestation.ts'
import type { AgreeingReplica, VerificationResult } from './verify.ts'

/**
 * Bytes of secret randomness in a commitment nonce.
 *
 * 32, sited against the two other places this repository draws a secret: the enrollment
 * challenge (`enrollment.ts`, `randomBytes(32)`) and the certificate-lifecycle nonce
 * (`cert-lifecycle.ts`, `XCHACHA_NONCE_BYTES`). Matching the enrollment figure is
 * deliberate — one number for "enough entropy that nobody guesses this" is one number to
 * revisit, and a second, smaller one here would be the weakest link nothing pointed at.
 *
 * What it has to be large enough for is narrower than a key: the commitment is
 * `H(nonce ‖ task ‖ resultCid)` over SHA-256, and the attack it resists is a peer who
 * has seen the digest **brute-forcing the nonce to learn which of a small set of
 * plausible outputs was committed to**. A shard's output space is often tiny — a boolean,
 * a count, a sum — so the nonce is doing all the hiding, and 2^256 is what stops the
 * search. Anything under about 16 bytes would make the search a real one.
 */
export const CEREMONY_NONCE_BYTES = 32

/**
 * The fewest replicas a ceremony is run over.
 *
 * Two, because a ceremony over one replica establishes nothing: there is no peer to
 * plagiarize from, so the commitment binds an answer nobody could have copied and the
 * check — while still perfectly falsifiable against a *faulty* node — is not answering
 * VER-02's question. `submitJob` runs the R=1 case through `executeVerified` exactly as
 * it always has (VER-06: redundancy is a dial reaching 1, meaning off), and this
 * function refuses rather than silently degrading, so "the ceremony ran" and "the
 * ceremony was skipped" are never the same return value.
 *
 * This is the module's only bound and it is a **round** bound, not a clock. See the
 * header on why no timeout is stated here.
 */
export const MIN_CEREMONY_REPLICAS = 2

/** 32 bytes of secret randomness. The module's one impure function. */
export function drawCeremonyNonce(): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(CEREMONY_NONCE_BYTES)
  nonce.set(randomBytes(CEREMONY_NONCE_BYTES))
  return nonce
}

/**
 * `H(nonce ‖ moduleCid ‖ inputCid ‖ partitionIndex ‖ resultCid)`, as lowercase hex.
 *
 * ## Why the task is in the preimage
 *
 * Without it a commitment is a statement about *an* answer rather than about **this
 * shard's** answer, and one commitment could be replayed across every shard of a job:
 * an executor computes shard 0 honestly, publishes its digest, and hands the same digest
 * back for shards 1..n, revealing the same nonce and the same output each time. Every
 * check would pass. Binding the task makes that a mismatch on the first shard it is
 * reused for, and `commit-reveal.test.ts` plants exactly that executor.
 *
 * ## Why the node id is NOT in the preimage
 *
 * VER-05's rule — node identity sits outside the compared value — and, independently,
 * it would buy nothing: the nonce is 32 secret bytes drawn per commitment, so two
 * replicas of one shard already produce unrelated digests, and a digest only ever
 * travels from the node that made it to the requestor that asked it.
 *
 * ## Why `partitionCount` is not in it
 *
 * `(moduleCid, inputCid, partitionIndex)` is already the shard's identity — it is the
 * same triple `submitJob` content-addresses a shard input by, and the pair
 * `inputCid:partitionIndex` that `serveAgent` derives its capacity slot key from. Adding
 * the count would make a commitment made under a job of 8 shards fail to check under a
 * resume of the same shard in a job of 8 shards *described* differently, which is a
 * refusal that names the wrong thing.
 */
export async function commitmentDigest(
  nonce: Uint8Array,
  task: Task,
  resultCid: CID,
): Promise<string> {
  const module = task.moduleCid.bytes
  const input = task.inputCid.bytes
  const result = resultCid.bytes
  // The index as four big-endian bytes rather than as decimal text, so that shard 1 and
  // shard 11 cannot produce a preimage one is a prefix of.
  const index = new Uint8Array(4)
  new DataView(index.buffer).setUint32(0, task.partitionIndex, false)
  const buf = new Uint8Array(nonce.length + module.length + input.length + 4 + result.length)
  let at = 0
  for (const part of [nonce, module, input, index, result]) {
    buf.set(part, at)
    at += part.length
  }
  const digest = await sha256.digest(buf)
  return toHex(digest.digest)
}

/**
 * What a node returns from round 1: a digest, and the name it filed the pending
 * commitment under.
 *
 * `handle` is the **executor's own** name for what it is holding, not the requestor's.
 * That direction is load-bearing: the node holding an unrevealed answer is the party
 * that has to be able to refuse a reveal it never promised, and it can only do that
 * against a name it minted. A requestor-minted name would be a value the serving node
 * had to accept on the requestor's word — which is the shape the deleted ceremony had,
 * one level up.
 */
export interface Commitment {
  readonly nodeId: string
  /** Lowercase hex {@link commitmentDigest}. */
  readonly digest: string
  /** Opaque to the requestor. Handed straight back in round 2 and never parsed. */
  readonly handle: string
}

export type CommitOutcome =
  | { readonly ok: true; readonly digest: string; readonly handle: string }
  | { readonly ok: false; readonly reason: string }

export type RevealOutcome =
  | {
      readonly ok: true
      readonly nonce: Uint8Array
      readonly output: CanonicalValue
      readonly fuelUsed: number
      readonly attestation: AttestedResult
    }
  | { readonly ok: false; readonly reason: string }

/**
 * An executor that answers in two rounds.
 *
 * Deliberately **not** declared as an extension of `Executor`. The two ports describe
 * two protocols, and a type that required both would say that every ceremony participant
 * also offers a one-call route — which is true of `@o2/net`'s `RemoteExecutor` and false
 * of the kernel's four, and stating it in the type would make the false half a
 * compile-time obligation rather than a fact to check.
 *
 * `reveal` takes the handle its own `commit` returned. An implementation must refuse a
 * handle it did not mint, must refuse a handle twice, and must refuse a handle to a peer
 * other than the one that committed it — all three are reachable failures and all three
 * are asserted against the real serving path in
 * `packages/net/src/commit-reveal-wire.test.ts`.
 */
export interface CommittingExecutor {
  readonly nodeId: string
  commit(task: Task): Promise<CommitOutcome>
  reveal(handle: string): Promise<RevealOutcome>
}

/**
 * Does this executor speak the two-round protocol?
 *
 * ## Why the question is asked of the object rather than of the caller
 *
 * `JobSpec.executors` is `readonly Executor[]`, so `submitJob` has to decide which of
 * the two paths a shard takes from what it was handed. Three ways to decide were
 * available and two are worse:
 *
 * - **A dial on `JobSpec` or `SubmitOptions`.** Optional, it is the hole
 *   `.planning/PROJECT.md` names — *an optional hook with a silent default* — and the
 *   silence would be the ceremony not running. Required, it is a mandatory field across
 *   the ~180 literals that construct these, every one of which would fill it with the
 *   same value, and the one that did not would be a ceremony skipped by a typo.
 * - **A second executor array beside the first.** Two sources of truth that can
 *   disagree, with nothing able to catch the disagreement — `19-CONTEXT.md`'s recorded
 *   ruling against exactly this shape, one layer up.
 *
 * What is left is to ask the object. The answer is a fact about the executor rather than
 * a value somebody remembered to set, and it cannot drift out of step with what the
 * executor can actually do.
 *
 * ## What this costs, stated rather than left to be found
 *
 * It is a structural check, so an unrelated object that happens to carry `commit` and
 * `reveal` members of the right arity would answer `true` and then fail at the first
 * round trip — reported as that node's `failure`, in its own words, which is where every
 * other foreign-implementation fault in this package already lands. No such object
 * exists in this repository; `remote-executor.ts` is the only implementation, and
 * `commit-reveal-wiring.test.ts` asserts both directions of this predicate against it
 * and against the kernel's `WasmExecutor`.
 */
export function isCommitting(executor: Executor): executor is Executor & CommittingExecutor {
  const candidate = executor as Partial<CommittingExecutor>
  return typeof candidate.commit === 'function' && typeof candidate.reveal === 'function'
}

/** One node's round-1 answer, held by the requestor until the barrier lifts. */
interface Committed {
  readonly executor: CommittingExecutor
  readonly digest: string
  readonly handle: string
}

/**
 * Run one task across `committers` as a two-round ceremony, and verify agreement.
 *
 * Returns the **same** {@link VerificationResult} `executeVerified` returns, so every
 * downstream reader — `submitJob`'s grouping, `attestationReceipt`, `classifyAttestation`,
 * the two display surfaces — is untouched by which of the two produced it. That is
 * composition rather than a parallel path: a second result shape would be a second thing
 * to render and a second thing to get wrong.
 *
 * ## The five ways this refuses, all of them reachable
 *
 * 1. **Fewer than {@link MIN_CEREMONY_REPLICAS} executors supplied** — `insufficient`.
 *    A statement about the request, made before anything runs.
 * 2. **A node's round 1 failed** — that node is a `failure` in its own words and the
 *    ceremony continues without it, exactly as a failed `execute` does today.
 * 3. **No commitment arrived at all** — `insufficient`, the same shape and the same
 *    reason as `executeVerified`'s "every executor failed". The floor is deliberately
 *    *not* re-applied to the survivors; the block below the round-1 barrier says why at
 *    length, because getting it wrong is a regression that reads like a safeguard.
 * 4. **A node's round 2 failed** — a `failure`, named by the node.
 * 5. **A reveal does not reproduce its own commitment** — a `failure` naming the node
 *    and the round the digest was published in. This is VER-02's actual refusal.
 *
 * A sixth, `output not encodable`, is inherited from `runOne`'s discipline in
 * `verify.ts` and is reported as that node's failure rather than as divergence.
 *
 * ## The one thing that is structural rather than checked
 *
 * The barrier. Round 2 begins after `await Promise.all` over round 1 and there is no
 * arrangement of the arguments that reorders it, so there is no branch to plant. What
 * *is* checked is the consequence: `commit-reveal.test.ts` hands this function executors
 * that record the global order of every call and asserts that no `reveal` was entered
 * before the last `commit` returned, and that assertion was watched go red against an
 * interleaved implementation. A structural property with a measured consequence is the
 * strongest form available here; claiming a branch that cannot fire would be the exact
 * defect that removed the previous ceremony.
 */
export async function executeCommitReveal(
  task: Task,
  committers: readonly CommittingExecutor[],
): Promise<VerificationResult> {
  if (committers.length < MIN_CEREMONY_REPLICAS) {
    return {
      status: 'insufficient',
      reason: `a commit-reveal ceremony needs at least ${String(MIN_CEREMONY_REPLICAS)} executors, ${String(committers.length)} supplied`,
      failures: [],
    }
  }

  const failures: { nodeId: string; reason: string }[] = []

  // ── Round 1: commit ───────────────────────────────────────────────────────────
  // Every executor is asked, and the results are all awaited, before a single line
  // below this block runs. That `await` is the barrier.
  const round1 = await Promise.all(
    committers.map(async (executor): Promise<Committed | { readonly failed: string }> => {
      let outcome: CommitOutcome
      try {
        outcome = await executor.commit(task)
      } catch (cause) {
        // The port says a failure is a value; an implementation is foreign code and can
        // still throw. Converted here for `runOne`'s reason in `verify.ts`: one
        // replica's collapse must not discard its co-replicas' work, and a rejection
        // carries no name.
        return {
          failed: `commit threw on ${executor.nodeId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }
      }
      if (!outcome.ok) return { failed: outcome.reason }
      return { executor, digest: outcome.digest, handle: outcome.handle }
    }),
  )

  const committed: Committed[] = []
  for (const [i, entry] of round1.entries()) {
    const executor = committers[i] as CommittingExecutor
    if ('failed' in entry) failures.push({ nodeId: executor.nodeId, reason: entry.failed })
    else committed.push(entry)
  }

  if (committed.length === 0) {
    // Every executor failed round 1. The shape `executeVerified` returns when every
    // executor failed, and for the same reason: there is nothing to reveal.
    return { status: 'insufficient', reason: 'every executor failed to commit', failures }
  }

  // **The floor is on how many were ASKED, not on how many survived**, and that
  // distinction was got wrong once here before it was measured. A floor on `committed`
  // was written first, and it turned a peer dying mid-job — which `fabric-node.node.test.ts`
  // and `two-process.node.test.ts` each place deliberately and expect to survive — into
  // `insufficient` where the tree had always reported `agreed` at `replicas: 1`. That is
  // VER-06's honest degradation being spent to buy nothing:
  //
  // - the property the barrier carries is an **ordering** one. Round 1 has fully settled
  //   before this line: every executor has either committed or failed. Opening round 2
  //   now discloses nothing to anybody who has not already fixed their answer, whether
  //   one node committed or five did.
  // - a surviving replica's answer *was* bound before it revealed. That is a true
  //   statement about that replica and does not become false because a co-replica died.
  // - what a one-replica outcome must not do is *claim* independent agreement, and it
  //   does not: `replicas: 1` is reported, and `classifyAttestation` reads one replica as
  //   `owner-attested` rather than `independent` (VER-09/VER-10) from the same expression
  //   it always did.
  //
  // {@link MIN_CEREMONY_REPLICAS} is therefore checked once, at the top, against the
  // executor set this function was handed — where it answers "was a ceremony the right
  // thing to run at all" — and never again against the survivors.

  // ── Round 2: reveal ───────────────────────────────────────────────────────────
  const answered: {
    nodeId: string
    resultCid: CID
    output: CanonicalValue
    fuelUsed: number
    attestation: AttestedResult
  }[] = []

  const round2 = await Promise.all(
    committed.map(async (entry): Promise<RevealOutcome> => {
      try {
        return await entry.executor.reveal(entry.handle)
      } catch (cause) {
        return {
          ok: false,
          reason: `reveal threw on ${entry.executor.nodeId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }
      }
    }),
  )

  for (const [i, outcome] of round2.entries()) {
    const entry = committed[i] as Committed
    const { nodeId } = entry.executor
    if (!outcome.ok) {
      failures.push({ nodeId, reason: outcome.reason })
      continue
    }
    const hashed = await canonicalCid(outcome.output)
    if (!hashed.ok) {
      failures.push({ nodeId, reason: `output not encodable: ${JSON.stringify(hashed.error)}` })
      continue
    }
    // **The requestor hashes the revealed output itself.** It does not accept a
    // `resultCid` from the revealing node and it deliberately has nowhere to put one:
    // a plagiarist could otherwise reveal `(its own nonce, its own cid, a peer's
    // output)` and the digest would check out over a value nobody compared. This line
    // is what ties the commitment to the bytes that are actually grouped below.
    const expected = await commitmentDigest(outcome.nonce, task, hashed.cid)
    if (expected !== entry.digest) {
      failures.push({
        nodeId,
        reason: `reveal does not match the commitment ${nodeId} published in round 1`,
      })
      continue
    }
    answered.push({
      nodeId,
      resultCid: hashed.cid,
      output: outcome.output,
      fuelUsed: outcome.fuelUsed,
      attestation: outcome.attestation,
    })
  }

  if (answered.length === 0) {
    return { status: 'insufficient', reason: 'no reveal matched its commitment', failures }
  }

  // Grouping is `executeVerified`'s, verbatim in behaviour: keyed on `resultCid`, more
  // than one group is disagreement, and disagreement is reported rather than voted on
  // (VER-01). Deliberately not factored into a shared helper — the two functions differ
  // in what they had to do to *get* here, and a shared tail would invite a future reader
  // to assume they differ in nothing else.
  const groups = new Map<string, string[]>()
  for (const answer of answered) {
    const nodes = groups.get(answer.resultCid.toString())
    if (nodes) nodes.push(answer.nodeId)
    else groups.set(answer.resultCid.toString(), [answer.nodeId])
  }

  if (groups.size > 1) {
    return {
      status: 'disagreed',
      partitions: [...groups.entries()].map(([resultCid, nodes]) => ({ resultCid, nodes })),
      failures,
    }
  }

  const winner = answered[0] as (typeof answered)[number]
  const agreeing: readonly AgreeingReplica[] = answered.map((r) => ({
    nodeId: r.nodeId,
    attestation: r.attestation,
  }))
  return {
    status: 'agreed',
    resultCid: winner.resultCid,
    output: winner.output,
    agreeing,
    replicas: answered.length,
    failures,
    grossFuel: answered.reduce((sum, r) => sum + r.fuelUsed, 0),
    usefulFuel: winner.fuelUsed,
  }
}
