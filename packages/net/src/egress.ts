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
 * **A registration has a lifetime, and the bound that follows from it.** Per-frame
 * scan cost is proportional to the sovereign tasks this node has **in flight**, not
 * to how long the node has been running. That is a bound rather than a hope only
 * because every registration is released again from the serve path: `serveAgent`'s
 * exec branch attaches an `afterSent` callback to its reply, and `rpc.ts` invokes it
 * in a `finally` around the response send. `serveAgent` decides *what* to release
 * because it is the only layer that parsed the task and knows the label; `rpc.ts`
 * decides *when* because it is the only layer that knows the reply frame has settled.
 * Neither can do the other's half.
 *
 * **The trap, named so nobody has to rediscover it.** Releasing where the guard and
 * the label are both already in scope — inside `registerSovereignInputs`, the moment
 * `inner.execute` resolves — is a full frame too early. The frame the registration
 * exists to catch is the reply, and at that moment the reply has not been sent yet:
 * it would be scanned against an empty set and forwarded, which is precisely the leak
 * this whole phase closes. Somebody will propose that refactor because it is tidier.
 * Plan 13-07 built it, watched it let the leak through in three files, and reverted
 * it; the capture is in `13-07-SUMMARY.md`, so this paragraph is evidence and not an
 * opinion.
 */
export class EgressGuard implements Transport {
  readonly #inner: Transport
  readonly #ownerId: string
  readonly #entries: EgressEntry[] = []
  /**
   * Sovereign payloads that must never appear in an outbound frame, by label.
   *
   * `holds` counts registrations, not registrants: two concurrent dispatches of one
   * input register the same label twice, and the payload stays guarded until both
   * have released. A plain `delete` would let whichever dispatch finished first
   * unguard the one still running.
   */
  readonly #guarded = new Map<string, { readonly payload: Uint8Array; holds: number }>()

  constructor(inner: Transport, ownerId: string) {
    this.#inner = inner
    this.#ownerId = ownerId
  }

  get localId(): string {
    return this.#inner.localId
  }

  /**
   * Mark a payload as sovereign. Any outbound frame containing it is a violation.
   *
   * Registering a label already held takes a second hold on it rather than replacing
   * the first, so the payload survives until every holder has called
   * {@link EgressGuard.release}.
   */
  guard(label: string, payload: Uint8Array): void {
    const held = this.#guarded.get(label)
    if (held === undefined) {
      this.#guarded.set(label, { payload, holds: 1 })
      return
    }
    this.#guarded.set(label, { payload, holds: held.holds + 1 })
  }

  /**
   * Give back one hold on `label`, dropping the payload when the last one goes.
   *
   * A label this guard does not hold is a no-op, deliberately: the serve path
   * releases unconditionally on the task's input label rather than re-testing
   * whether registration happened, because a release that cannot be wrong is
   * cheaper than a condition that has to be kept in step with
   * `registerSovereignInputs`' own.
   *
   * There is deliberately **no** eviction, cap, or least-recently-used policy here,
   * and there must not be one. A guard that silently stops guarding is the shape
   * this project keeps removing — the same reasoning `.planning/PROJECT.md` records
   * for `serveAgent`'s hooks under "An optional hook with a silent default is a
   * hole" applies unchanged: an implicit limit is a silent default, and the failure
   * it produces is a frame that left. The set is bounded by releasing it, which is
   * a bound somebody can be shown, not by dropping entries nobody asked to drop.
   */
  release(label: string): void {
    const held = this.#guarded.get(label)
    if (held === undefined) return
    if (held.holds <= 1) {
      this.#guarded.delete(label)
      return
    }
    this.#guarded.set(label, { payload: held.payload, holds: held.holds - 1 })
  }

  /**
   * The labels currently held.
   *
   * Named rather than counted on purpose: an assertion that this is empty after a
   * job fails with the label that leaked, which is actionable, where a number is
   * not.
   */
  get registrations(): readonly string[] {
    return [...this.#guarded.keys()]
  }

  /**
   * The label of the first registered payload contained in `frame`, or `null`.
   *
   * A pure query: it records nothing, so it may be asked as often as a caller
   * likes. Two callers exist — {@link EgressGuard.send}, which asks about a frame
   * it is about to forward, and `serveAgent`'s pre-scan, which asks about a
   * *candidate* reply it can still replace with a smaller one.
   *
   * **Why asking about a reply body is no less sensitive than asking about the
   * whole frame.** `send` sees the encoded `{k:'res', id, body}` envelope, while
   * `serveAgent` asks about the encoded body alone. {@link contains} is a
   * contiguous-run search, and dag-cbor encodes a byte string as a header followed
   * by the raw bytes — so a payload present in the body is present as the *same*
   * contiguous run once that body is nested inside the frame. The pre-scan is
   * therefore not a weaker check than the send-time one; it is the same check,
   * earlier.
   */
  violationIn(frame: Uint8Array): string | null {
    for (const [label, held] of this.#guarded) {
      if (held.payload.byteLength === 0 || held.payload.byteLength > frame.byteLength) continue
      if (contains(frame, held.payload)) return label
    }
    return null
  }

  /**
   * Scan `frame` and, on a hit, record the refusal without sending anything.
   *
   * **What this is for.** A caller holding a *candidate* frame that it can still
   * replace with a smaller one — `serveAgent`, on the two branches whose replies
   * can carry a registered payload. Refusing here turns what would otherwise be
   * the requestor's timeout into a named outcome, because the substitute reply can
   * carry the violated label out while the payload stays home (NET-10).
   *
   * **What this is not.** It is not a way to suppress the send-time check.
   * {@link EgressGuard.send} keeps its own scan and refuses on its own; a caller
   * that pre-scans is taking a fast path, not taking over the guarantee. Remove
   * every pre-scan in the repository and the bytes must still not leave.
   *
   * Records **only** on a hit, which is the one asymmetry with `send`: `send` is
   * this node's sole exit and has to account for every frame that crossed it,
   * whereas `refuse` is asked about a frame that has not been offered to the exit
   * yet and may never be. Recording clean answers here would count every reply
   * twice.
   */
  refuse(to: string, frame: Uint8Array): string | null {
    const violation = this.violationIn(frame)
    if (violation === null) return null
    this.#record(to, frame.byteLength, violation)
    return violation
  }

  async send(to: string, message: Uint8Array<ArrayBuffer>): Promise<void> {
    // Scan before sending. Recording after a successful send would miss exactly the
    // frames that failed mid-flight, which are still frames that left.
    const violation = this.violationIn(message)
    // The record happens before the refusal below, and that order is load-bearing:
    // a refused send is still a fact the manifest carries. An implementation that
    // returned early before recording would stop the leak and leave the node with
    // no record that it had — a manifest silent about the exact event it exists to
    // record. The same holds on the other producer: {@link EgressGuard.refuse}
    // records its hit before its caller can substitute a different frame.
    this.#record(to, message.byteLength, violation)
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

  /**
   * Discard the record, e.g. between jobs.
   *
   * Clears `#entries` only, and leaves the registrations alone. The two are about
   * different things — reset is about the record, {@link EgressGuard.release} is
   * about the watch list — and conflating them would make a between-jobs reset
   * silently stop the tap.
   */
  reset(): void {
    this.#entries.length = 0
  }

  /**
   * The single place an {@link EgressEntry} is constructed.
   *
   * Two producers reach it — `send` for every frame it is handed, `refuse` for a
   * candidate frame that matched — and there is deliberately only one constructor
   * so the two can never disagree about what a refusal looks like on the manifest.
   */
  #record(to: string, bytes: number, violation: string | null): void {
    this.#entries.push(violation === null ? { to, bytes } : { to, bytes, violation })
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
