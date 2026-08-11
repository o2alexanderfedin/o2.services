/**
 * What a node holds between round 1 and round 2 of a commit-reveal ceremony — VER-02.
 *
 * A node that has committed to an answer is holding that answer, unrevealed, for as long
 * as the requestor's barrier takes to close. That hold is the whole mechanism, and it is
 * also the whole cost: an output kept in memory, keyed by a name, at the request of a
 * peer who may never come back for it. This module is where both halves are bounded.
 *
 * ## Three refusals, each with a different subject
 *
 * - **{@link PendingCommitments.reserve} refuses when the store is full.** That is a
 *   statement about *this node* — it is holding as many unrevealed answers as it will —
 *   and it is made before the executor runs, so a flooder pays nothing and gets nothing.
 * - **{@link PendingCommitments.take} refuses a name it never minted.** A reveal for a
 *   handle that expired, was already taken, or never existed.
 * - **{@link PendingCommitments.take} refuses a peer that did not commit.** This is the
 *   serving half of VER-02's actual property: a replica must not be able to read a
 *   co-replica's answer out of the node holding it, and the node holding it is the only
 *   party in a position to say no.
 *
 * ## Refused, never evicted
 *
 * A full store refuses the newcomer rather than dropping the oldest entry, for the reason
 * `protocol.ts`'s `MAX_REPORTED_COUNT` gives about dropping rather than clamping: an
 * eviction policy lets a peer who floods **erase an honest peer's pending answer**, which
 * converts a memory bound into a denial primitive. Expiry is the only thing that removes
 * an entry without its owner asking, and expiry is a clock rather than a competitor.
 *
 * Not a pure module: it reads no clock itself — every method takes `now` — but it does
 * draw randomness for handles. That impurity is stated rather than hidden, for the reason
 * `enrollment.ts` states about `mintChallenge`: a name a caller could predict is not a
 * name, and here the consequence is concrete rather than theoretical (see
 * {@link PendingCommitments.reserve}).
 */

import { randomBytes } from '@noble/hashes/utils.js'
import type { AttestedResult, CanonicalValue } from '@o2/core'

/**
 * How many unrevealed answers one node will hold at once.
 *
 * 64, sited on `DEFAULT_MAX_CONCURRENT_TASKS` (`packages/core/src/placement.ts`), which
 * is the number of tasks a node will run at once. That is the right anchor because a
 * commitment can only be created by a task that *ran*, so 64 is exactly one full
 * generation of this node's own in-flight work committed and awaiting reveal. A node
 * cannot honestly need more outstanding than it can concurrently produce.
 *
 * Deliberately **not** shared with `LocalCapacity`'s slot table, and the distinction is
 * the reason for a second number rather than a re-use. A capacity slot is released the
 * instant the executor returns; a pending commitment starts its life at that same
 * instant and outlives it by however long the requestor's barrier takes. They bound
 * different resources over different lifetimes, and one counter serving both would make
 * a node that is idle refuse work because of answers nobody collected.
 *
 * A deployment where a requestor legitimately holds more than 64 replicas of one node's
 * work open at once would see honest refusals, and this constant is the line to move
 * with it.
 */
export const MAX_PENDING_COMMITMENTS = 64

/**
 * How long a node holds an answer nobody came back for.
 *
 * 120 000 ms — four times `DEFAULT_RPC_TIMEOUT_MS` (`rpc.ts`, 30 000). The bound has to
 * be a multiple of that one rather than an independent guess, because the requestor's
 * side of this exchange is literally an RPC on that budget: a reveal that has not been
 * asked for within one RPC budget after the last commitment landed is one the requestor
 * has already given up on.
 *
 * Four rather than one, and the factor is the barrier. A node's commitment is held until
 * **every** peer in the ceremony has committed, so the honest hold is the slowest
 * committer's full round trip (one budget) plus the requestor's own reveal round trip
 * (a second), and a straggler generation can add another. Four leaves headroom for that
 * without an entry surviving into a second job.
 *
 * The clock is the caller's — every method takes `now` — so this module reads no wall
 * time and stays testable without a fake timer. `serveAgent` already reads `Date.now()`
 * for the enrolment challenge and passes the same reading here.
 */
export const PENDING_COMMITMENT_TTL_MS = 120_000

/**
 * Bytes of randomness in a handle.
 *
 * 16, giving a 32-character hex name. Handles used to be describable as a counter, and a
 * counter is what this constant exists to refuse: `take` pins the committer, but a
 * guessable name means an attacker can *enumerate* live commitments and learn how much
 * unrevealed work a node is holding and for whom. 128 bits is past enumeration, and it is
 * half of `CEREMONY_NONCE_BYTES` (32, `@o2/core`) deliberately rather than equal to it —
 * the nonce hides an answer against *offline* search over a small output space, this only
 * names a map entry against *online* guessing at one round trip per attempt. Writing them
 * as one number would invite a later reader to lower both to the weaker requirement.
 */
const HANDLE_BYTES = 16

const HEX = '0123456789abcdef'

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 0x0f]!
  return out
}

/** One answer, produced and withheld. */
export interface PendingCommitment {
  /** The peer that asked for the commitment. Only this peer may take it back. */
  readonly committedBy: string
  readonly nonce: Uint8Array<ArrayBuffer>
  readonly output: CanonicalValue
  readonly fuelUsed: number
  readonly attestation: AttestedResult
  /** When {@link PendingCommitments.file} recorded it, in the caller's clock. */
  readonly at: number
}

export type ReserveOutcome =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly reason: string }

export type TakeOutcome =
  | { readonly ok: true; readonly pending: PendingCommitment }
  | { readonly ok: false; readonly reason: string }

/**
 * The node's pending commitments.
 *
 * One per `serveAgent`, so two nodes in one process cannot see each other's — which is
 * not a nicety in this repository's test estate, where a "fabric" is routinely several
 * nodes in one Vitest worker and a shared map would make the committer pin untestable by
 * making it unnecessary.
 */
export class PendingCommitments {
  readonly #entries = new Map<string, PendingCommitment>()
  readonly #nodeId: string

  constructor(nodeId: string) {
    this.#nodeId = nodeId
  }

  /** Live entries after expiring anything older than the TTL. Test and bound reads. */
  size(now: number): number {
    this.#expire(now)
    return this.#entries.size
  }

  /**
   * Claim a name for an answer this node is about to produce, or refuse.
   *
   * Called **before** the executor runs. A node that is already holding its limit
   * declines the work rather than performing it and then discovering it has nowhere to
   * put the result — the same ordering `serveAgent`'s exec branch takes with admission,
   * and for the same reason: a refusal after execution has already spent the CPU it was
   * meant to protect.
   */
  reserve(now: number): ReserveOutcome {
    this.#expire(now)
    if (this.#entries.size >= MAX_PENDING_COMMITMENTS) {
      return {
        ok: false,
        reason: `commit refused: ${String(this.#entries.size)} of ${String(MAX_PENDING_COMMITMENTS)} commitments already pending on ${this.#nodeId}`,
      }
    }
    return { ok: true, handle: toHex(randomBytes(HANDLE_BYTES)) }
  }

  /** Record the produced answer under a name {@link reserve} minted. */
  file(handle: string, pending: PendingCommitment): void {
    this.#entries.set(handle, pending)
  }

  /**
   * Hand the answer back to the peer that asked for it, once, or refuse by name.
   *
   * **One-shot, and deleted only on the entitled path.** A second reveal of the same
   * handle gets the unknown-name refusal, which is what makes a replay of a captured
   * round-2 frame worth nothing. A *wrong-peer* request deliberately leaves the entry
   * where it is: consuming it would let any peer able to guess a handle destroy an
   * honest exchange without ever seeing its contents, which is a denial primitive built
   * out of a check that exists to prevent disclosure.
   */
  take(handle: string, by: string, now: number): TakeOutcome {
    this.#expire(now)
    const pending = this.#entries.get(handle)
    if (pending === undefined) {
      return {
        ok: false,
        reason: `no commitment pending under that name on ${this.#nodeId}`,
      }
    }
    if (pending.committedBy !== by) {
      // Left in place deliberately — see this method's docblock. And the reason names
      // neither the committer nor the answer: the whole point of the refusal is that
      // this peer learns nothing about a commitment that is not its own.
      return {
        ok: false,
        reason: `that commitment was made to another peer on ${this.#nodeId}`,
      }
    }
    this.#entries.delete(handle)
    return { ok: true, pending }
  }

  #expire(now: number): void {
    for (const [handle, pending] of this.#entries) {
      if (now - pending.at >= PENDING_COMMITMENT_TTL_MS) this.#entries.delete(handle)
    }
  }
}
