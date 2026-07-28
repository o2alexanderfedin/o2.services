/**
 * Egress control — DATA-04, DATA-05.
 *
 * Two requirements meet here, and one design satisfies both.
 *
 * **Nothing raw leaves.** A cross-owner job must push filters, projections, and
 * partial aggregation down to the owner's node, so only derived values cross the
 * wire. Proving that means watching the owner's actual network interface, not
 * reasoning about the code that feeds it.
 *
 * **Every job emits a manifest of what left, complete by construction.** The phrase
 * matters. A manifest assembled by instrumenting call sites is complete only for the
 * call sites someone remembered; a manifest produced by the *sole* code path out is
 * complete because there is nowhere else to go. So this is a `Transport` decorator:
 * recording is not something the sender does in addition to sending, it is part of
 * sending. Bypassing the record means bypassing the network.
 *
 * The raw-byte check is a scan of outbound frames for known sovereign block contents.
 * It is deliberately a *detector*, not a *predictor* — the same discipline the rest of
 * this project settled on. It cannot prove that no encoding of a sovereign value
 * could ever slip past; it does catch the failure that actually happens, which is a
 * map step that forgot to aggregate and shipped its input. What it catches, it now
 * refuses: see {@link EgressGuard} for why the detection became a rejected `send`
 * rather than an annotation.
 *
 * Pure module.
 */

import type { Transport } from '@o2/core'

/** One outbound transmission, as recorded at the only exit. */
export interface EgressEntry {
  readonly to: string
  readonly bytes: number
  /**
   * Set when the frame matched a registered sovereign value. Such a frame was not
   * forwarded — the inner transport was never called for it.
   */
  readonly violation?: string
}

/** What left one node during a job. Signed by the owner to make it attributable. */
export interface EgressManifest {
  readonly nodeId: string
  readonly ownerId: string
  readonly entries: readonly EgressEntry[]
  /**
   * What actually left, in bytes.
   *
   * A refused frame contributes zero, because it did not leave — this figure means
   * what it says, and a caller may treat it as the node's real outbound volume.
   * Note that `entries.length` and `totalBytes` therefore answer different
   * questions: a manifest holding one refused frame reads `1` and `0`, which is
   * exactly how a refusal is distinguished from a node that sent nothing at all.
   *
   * There is deliberately **no** `refused` field on {@link EgressEntry}: under this
   * design a `violation` *is* a refusal, by construction, so a second field could
   * only ever drift from the first. Do not add one.
   */
  readonly totalBytes: number
  /**
   * Frames that contained registered sovereign bytes. Non-empty means a leak was
   * attempted and refused — the bytes are still on this node.
   */
  readonly violations: readonly string[]
}

/**
 * Thrown by {@link EgressGuard.send} when a frame carries a registered payload.
 *
 * Shaped after `RpcFailure` on purpose: it carries its detail as fields so callers
 * branch on `instanceof EgressRefusal` or on the values, never on the message
 * string. The message names the destination, the label, and the frame size, so an
 * operator reading a log has all three without attaching a debugger.
 */
export class EgressRefusal extends Error {
  /** The peer the frame was addressed to. */
  readonly to: string
  /** The label of the registered payload the frame contained. */
  readonly violation: string
  /** Size of the frame that did not leave. */
  readonly bytes: number

  constructor(detail: { readonly to: string; readonly violation: string; readonly bytes: number }) {
    super(
      `egress to ${detail.to} refused: ${detail.bytes}-byte frame carries ${detail.violation}`,
    )
    this.name = 'EgressRefusal'
    this.to = detail.to
    this.violation = detail.violation
    this.bytes = detail.bytes
  }
}

/**
 * Wraps a `Transport` so nothing can leave the node unrecorded — and so a frame
 * carrying a registered sovereign payload cannot leave at all.
 *
 * Register sovereign payloads with `guard()` and every outbound frame is scanned for
 * them. A match is recorded and then **refused**: `send` rejects with an
 * {@link EgressRefusal} and the inner transport is never called.
 *
 * This class used to record a match and forward the frame anyway, on the reasoning
 * that the point was to *observe* what a job actually did. 13-VERIFICATION.md
 * measured what that bought: the leaking shard completed as `agreed`, and
 * `manifest.violations` had zero production readers, so nothing could turn the
 * observation into an outcome. An observer that reports after the fact is not what
 * "data stays on the owner's device" promises. ROADMAP criterion 1 was amended on
 * 2026-07-28 to require the refusal instead, and a refusal costs one branch.
 *
 * **Why a rejected `send` is the right shape.** A refusal *is* a send that did not
 * happen, and the layer above already models exactly that — on two legs, with an
 * observable difference between them:
 *
 * - The **requesting** leg (`rpc.ts:114-126`) turns a rejected `Transport.send` into
 *   `RpcFailure{kind:'send-failed'}` immediately, carrying this error's message. A
 *   node refusing its own outbound request therefore learns the violated label at
 *   once and can branch on it, rather than sitting out a timeout.
 * - The **responding** leg (`rpc.ts:189-194`) swallows a send failure by documented
 *   design — throwing there would surface inside the transport's delivery path — so
 *   the requester waits out its own timeout instead. The dispatcher learns that the
 *   dispatch failed, but not why.
 *
 * That second case is a known and accepted cost, and naming it is the point rather
 * than an apology for it. Closing it would mean changing every peer's response-leg
 * failure semantics in order to fix a latency and legibility complaint, not a
 * correctness one — a larger change than this criterion needs. On both legs the
 * bytes stay on this node, which is the guarantee.
 *
 * **A node that has executed a sovereign task will thereafter refuse to serve that
 * block to any peer that asks for it.** That is the owner's ruling of 2026-07-28,
 * recorded here as a rule and not as a side effect: it is intended, and it is
 * unconditional. Raw sovereign bytes do not cross the wire — not even between two
 * nodes the same owner controls. "Pinned to their own device" is read literally, and
 * the owner's other machine is still a different device. There is no path under this
 * refusal on which that does not hold. What the rule costs redundant sovereign
 * execution is recorded in `.planning/PROJECT.md` and against the Phase 19 roadmap
 * entry by Plan 13-06; this comment states the rule and points there rather than
 * restating a consequence for a phase nobody has planned yet.
 *
 * **The registered set is unbounded until Plan 13-07.** `#guarded` is never released
 * today, so every sovereign payload a node has ever been handed stays on the path
 * that decides whether a frame may leave. Plan 13-07 releases each registration from
 * the serve path once its reply frame has settled, which bounds the scan set by
 * in-flight sovereign tasks rather than by node uptime. Until that lands, this plan
 * knowingly moves an unbounded set onto the correctness path; saying so here is what
 * keeps it a scheduled fix rather than an undiscovered one.
 */
export class EgressGuard implements Transport {
  readonly #inner: Transport
  readonly #ownerId: string
  readonly #entries: EgressEntry[] = []
  /** Sovereign payloads that must never appear in an outbound frame, by label. */
  readonly #guarded = new Map<string, Uint8Array>()

  constructor(inner: Transport, ownerId: string) {
    this.#inner = inner
    this.#ownerId = ownerId
  }

  get localId(): string {
    return this.#inner.localId
  }

  /** Mark a payload as sovereign. Any outbound frame containing it is a violation. */
  guard(label: string, payload: Uint8Array): void {
    this.#guarded.set(label, payload)
  }

  async send(to: string, message: Uint8Array<ArrayBuffer>): Promise<void> {
    // Scan before sending. Recording after a successful send would miss exactly the
    // frames that failed mid-flight, which are still frames that left.
    const violation = this.#scan(message)
    // The push happens before the refusal below, and that order is load-bearing: a
    // refused send is still a fact the manifest carries. An implementation that
    // returned early before pushing would stop the leak and leave the node with no
    // record that it had — a manifest silent about the exact event it exists to
    // record.
    this.#entries.push(
      violation === null
        ? { to, bytes: message.byteLength }
        : { to, bytes: message.byteLength, violation },
    )
    if (violation !== null) {
      throw new EgressRefusal({ to, violation, bytes: message.byteLength })
    }
    await this.#inner.send(to, message)
  }

  onMessage(handler: (from: string, message: Uint8Array<ArrayBuffer>) => void): () => void {
    return this.#inner.onMessage(handler)
  }

  get peers(): readonly string[] {
    return this.#inner.peers
  }

  /** Everything that has left this node so far. */
  get manifest(): EgressManifest {
    const entries = [...this.#entries]
    return {
      nodeId: this.localId,
      ownerId: this.#ownerId,
      entries,
      // Only what actually left. A refused frame is present in `entries` and
      // contributes zero here — see `EgressManifest.totalBytes`.
      totalBytes: entries.reduce(
        (sum, entry) => (entry.violation === undefined ? sum + entry.bytes : sum),
        0,
      ),
      violations: entries
        .map((entry) => entry.violation)
        .filter((label): label is string => label !== undefined),
    }
  }

  /** Discard the record, e.g. between jobs. */
  reset(): void {
    this.#entries.length = 0
  }

  /** The label of the first guarded payload contained in `frame`, or `null`. */
  #scan(frame: Uint8Array): string | null {
    for (const [label, payload] of this.#guarded) {
      if (payload.byteLength === 0 || payload.byteLength > frame.byteLength) continue
      if (contains(frame, payload)) return label
    }
    return null
  }
}

/** Whether `haystack` contains `needle` as a contiguous run. */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  const limit = haystack.byteLength - needle.byteLength
  outer: for (let start = 0; start <= limit; start++) {
    for (let i = 0; i < needle.byteLength; i++) {
      if (haystack[start + i] !== needle[i]) continue outer
    }
    return true
  }
  return false
}
