/**
 * AUTH-02 — one named verdict per peer, computed offline against pinned issuer keys.
 *
 * `verifyCertificate` (`@o2/core`) has been complete since Phase 6 with no production
 * caller. This is that caller. It turns "a peer presents a certificate" into a per-peer
 * fact a gate can read, and it does so **offline by construction**: the trust anchors are
 * an argument to `verifyCertificate`, so there is nothing for the verification step to
 * reach out to. The only network call this class makes is the `records` request that
 * *fetches* the certificate; deciding whether to believe it touches nothing.
 *
 * ## Why the five extra failure kinds are here and not in the kernel
 *
 * `CertificateFailure` is about a **certificate**. Its four kinds — `untrusted-issuer`,
 * `bad-signature`, `not-yet-valid`, `expired` — are all statements about a signed
 * document, and they pass through this class unchanged so that a caller reads exactly the
 * name `enrollment.ts` produced.
 *
 * The five added below are about a **conversation**: the mismatch (`nodeKey-mismatch`),
 * the silence (`no-records`), the peer id that names no Ed25519 key
 * (`unidentifiable-peer`), the unparseable answer (`unanswerable-peer`) and the
 * unreachability (`unreachable`). None of them is a fact about the signed statement, so
 * none of them belongs in `@o2/core`. **Five** is the count of non-`CertificateFailure`
 * members of {@link PeerFailure}; if a member is added, this sentence is what has to
 * change with it. That number is exempt from this phase's "measure before you write it
 * down" rule for a stated reason: it enumerates union members declared a few lines below,
 * so a reader checks it by counting what is on the screen and `tsc` sees both. It
 * describes the *type*, never the runtime.
 *
 * ## Why this class issues its own request rather than reusing `RpcRecordIndex`
 *
 * The obvious reuse is `new RpcRecordIndex(rpc, () => [peerId]).recordsFor(expected)` — a
 * single-element thunk does ask exactly one peer. It is wrong, and it looks right until
 * two of that class's lines are read side by side. `#ask` wraps `rpc.request` in a
 * `try/catch` that returns `null` with the comment *"unreachable peer — ask the next
 * one"* (`net/src/discovery.ts:62-68`), and `recordsFor` then falls out of its loop as
 * `undefined` (`:53-60`). So an unreachable peer and a peer answering `records: null` are
 * the same value, and there is no surviving error object for an `unreachable` verdict's
 * `detail` to come from — that arm is not constructible through the class at all.
 * Skip-and-continue is correct for a multi-peer lookup and wrong for a per-peer verdict.
 * `encodeRequest`/`parseResponse` are already on the `@o2/net` barrel, so issuing the
 * frame here costs one import and no new surface.
 *
 * ## Why a node that pins nobody does no work at all
 *
 * `verifyCertificate` refuses against an empty anchor set — `trustedIssuers.has(...)` is
 * its first check — so a verifier that subscribed unconditionally would compute and cache
 * a verdict (`untrusted-issuer`, or `no-records`) for every peer every node in this
 * repository ever connects to, and would emit an unrequested `records` request through
 * `EgressGuard` for a result nothing reads. Not one `FabricNode` in this repository
 * configures an anchor. Gating the subscription is what makes "a node with no trust
 * anchors has no verdicts" true *by construction* — `verdictFor` is undefined because
 * nothing ever computed a verdict, not because a caller asked before the RPC landed. The
 * empty-anchor case then costs exactly nothing, which is the reason this is safe to land.
 *
 * ## Why an already-connected peer is seeded
 *
 * `FabricNode.#compose` dials every `relayAddrs` entry immediately after `createLibp2p`,
 * long before `rpc` and therefore long before this class exists — so every one of those
 * `peer:connect` events fires with no listener attached, and any inbound connection
 * arriving in the same window does the same. The only production consumer of
 * `verifiedPeers` reads the list and never triggers verification. Without the seeding
 * loop, a node configured with both `relayAddrs` and `trustedIssuers` — the browser
 * topology `relayAddrs` exists for — could never fetch a block from the one peer it is
 * reachable through, permanently, with nothing reporting it.
 *
 * ## Why a verdict is re-asked, and what stops that being unbounded
 *
 * Seeding covers a peer that was already connected. It does **not** cover a peer whose
 * *answer* changes afterwards, and that turned out to be the more common case: a node that
 * enrols after a peer has connected to it was excluded by that peer for the life of the
 * connection, silently. It was found by measurement rather than review — a gate dialled a
 * browser tab before the tab's `serveAgent` was up, and the refusal that settled would have
 * stood for ever even though the tab held a valid certificate from the pinned issuer
 * throughout. The same window exists on the Node tier, where `FabricNode` dials its
 * provider inside `resolveCertificate`, also before `serveAgent`.
 *
 * So `verifiedPeers` re-asks. Which verdicts it will re-ask is decided by {@link FINAL},
 * and that split is the same one this comment already draws above: a fact about a **signed
 * document** cannot change while the connection lives, and a fact about the **conversation**
 * can. Three guards keep the cost bounded — an acceptance is never re-asked, a `FINAL`
 * refusal is never re-asked, and nothing is re-asked inside
 * {@link DEFAULT_VERDICT_RETRY_FLOOR_MS}. The ceiling is therefore one request per connected
 * peer per interval, paid only while something is actually fetching blocks.
 *
 * **This is a fabric-wide behaviour, not a local fix**, which is why it was held for an
 * owner ruling rather than patched when it was found (2026-08-01).
 *
 * ## Packaging, stated because it is a finding and not a design
 *
 * This module imports nothing Node-only: `@libp2p/interface` types, `@o2/core`,
 * `@o2/libp2p` and `@o2/net`. It lives in `@o2/node` because that is where Plan 17-04 put
 * it, and `@o2/browser` does not depend on `@o2/node` — so **the browser tier still cannot
 * construct one, and browser-tier verification is still UNMEASURED.** That is a
 * **packaging** fact, not a capability one. Nothing here reads what kind of node a peer is;
 * there is no field to branch on.
 *
 * ### The destination this paragraph used to name is impossible — measured 2026-08-04
 *
 * It read: *"moving this file to `@o2/net` is a barrel change with no code change"*. That
 * is **false**, and it was false for a reason the sentence did not consider: it checked
 * *"nothing Node-only"*, and `@o2/net`'s bar is stricter than that.
 *
 * `purity.node.test.ts` lists `net` in `PORTABLE` and refuses the specifier pattern
 * `/^@libp2p\//` there outright — *"libp2p modules belong in an adapter package"* — because
 * the portable tier must also work over the in-process `MemoryNetwork` transport, not
 * merely in a browser. This module imports `@libp2p/interface`, so the move reddens that
 * guard by name. Four separate comments in `packages/net` already say the same thing about
 * the sibling half (`reduce-job.ts`: *"that derivation lives in `@o2/libp2p`, which
 * `@o2/net` may not import"*; also `discover-candidates.ts`, `capability-authorizer.ts`,
 * `start-report.test.ts`, the last of which calls the edge *"the wrong direction"*).
 *
 * ### The honest destination, and what it actually costs
 *
 * **`@o2/libp2p`.** It is the dual-target middle tier — permitted to use libp2p, forbidden
 * `node:` and `@o2/node` — and *both* `@o2/node` and `@o2/browser` already depend on it, so
 * it delivers exactly what the move was for without `@o2/browser` acquiring `@o2/node`.
 * `nodeKeyForPeerId` is already there, so that import becomes relative.
 *
 * It is **not** free, and the price is why it was not taken inside Plan 24-01:
 *
 *   - `@o2/libp2p` gains a dependency on `@o2/net`, a package edge that does not exist
 *     today. It is acyclic — nothing under `packages/net/src` imports `@o2/libp2p`, only
 *     names it in prose — and it is the permitted direction, but it is a new edge and not a
 *     barrel line.
 *   - Three `mutation-ledger.ts` entries (`M33`, `M34`, `M35`) are keyed on this file's
 *     path, and `mutation-guard.node.test.ts` reads each `entry.file` off disk. Moving the
 *     file without repointing all three reddens that guard. `mutation-ledger.ts` is owned
 *     by an unexecuted plan in Phase 20 at the time of writing.
 *
 * ### The instrument that sees this, which is not `tsc`
 *
 * Recorded because the obvious check does not work and somebody will otherwise rely on it.
 * Planting `import { PeerVerifier } from '@o2/node'` into `browser-node.ts` and running
 * `npx tsc --noEmit` exits **0** — hoisted `node_modules` resolves the specifier whatever
 * `packages/browser/package.json` declares. The instrument that refuses it is
 * `purity.node.test.ts`, which reports *"packages/browser/src/browser-node.ts imports
 * \"@o2/node\" — a dual-target package must not depend on the Node adapters"*. A
 * before/after reading taken with `tsc` alone would pass in both directions and establish
 * nothing.
 */

import { verifyCertificate } from '@o2/core'
import type { CanonicalValue, CertificateFailure, NodeCertificate, PublicKeyHex } from '@o2/core'
import { nodeKeyForPeerId } from '@o2/libp2p'
import { RpcFailure, encodeRequest, parseResponse } from '@o2/net'
import type { RpcEndpoint } from '@o2/net'
import type { Libp2p, PeerId } from '@libp2p/interface'

/**
 * Why a peer is not a verified peer.
 *
 * The four `CertificateFailure` kinds arrive from `@o2/core` unchanged. The five below
 * are facts about the conversation rather than about the signed statement — see the
 * module comment for why they are not in the kernel, and for why the count in that
 * sentence has to move if this union does.
 */
export type PeerFailure =
  | CertificateFailure
  /** The certificate names a key other than the one this peer authenticated with. */
  | { readonly kind: 'nodeKey-mismatch'; readonly expected: PublicKeyHex; readonly presented: PublicKeyHex }
  /** The peer answered, and said it holds no records. */
  | { readonly kind: 'no-records'; readonly nodeKey: PublicKeyHex }
  /** The peer id names no Ed25519 key, so no `nodeKey` could be expected of it. */
  | { readonly kind: 'unidentifiable-peer'; readonly peerId: string }
  /** The peer answered with something that is not a `records` frame. */
  | { readonly kind: 'unanswerable-peer'; readonly peerId: string; readonly detail: string }
  /** The request never got an answer. Distinct from every kind above: nothing was said. */
  | { readonly kind: 'unreachable'; readonly peerId: string; readonly detail: string }

export type PeerVerdict =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly failure: PeerFailure; readonly reason: string }

/**
 * The refusals that cannot become an acceptance while this connection lives.
 *
 * The split is the same one the module comment draws between a fact about a **signed
 * document** and a fact about a **conversation**, and it is the whole of what bounds the
 * re-asking below. Each member is here for its own reason, not by category:
 *
 * - `unidentifiable-peer` — a statement about the peer id itself, which is fixed for the
 *   connection. A peer id that names no Ed25519 key cannot start naming one.
 * - `nodeKey-mismatch` — the peer presented a certificate for somebody else's key. This is
 *   the impersonation step 3 exists to catch; re-asking would spend an RPC per interval,
 *   forever, on a peer that already answered dishonestly.
 * - `bad-signature` — the document does not verify. A peer that could produce one that did
 *   would have sent it.
 * - `untrusted-issuer` — signed by a provider this node does not pin. The anchor set is
 *   fixed at construction, so this cannot change without a new verifier.
 *
 * **`expired` and `not-yet-valid` are deliberately absent**, though they are
 * `CertificateFailure`s like the last two. Both are statements about a clock rather than
 * about the document's validity: a not-yet-valid certificate becomes valid by waiting, and
 * an expired one is replaced by a renewal the peer can obtain without reconnecting.
 *
 * A disconnect clears everything regardless — {@link PeerVerifier} drops both maps on
 * `peer:disconnect` — so "final" means *for this connection*, never *forever*.
 */
const FINAL: ReadonlySet<PeerFailure['kind']> = new Set<PeerFailure['kind']>([
  'unidentifiable-peer',
  'nodeKey-mismatch',
  'bad-signature',
  'untrusted-issuer',
])

/**
 * How long a retryable refusal stands before a read of {@link PeerVerifier.verifiedPeers}
 * asks again.
 *
 * This is the only thing bounding the re-ask rate, so it is a real cost knob and not a
 * tuning detail: with N connected peers all holding retryable refusals, this node issues at
 * most N requests per interval, and only while something is actually asking for blocks.
 *
 * Chosen against the value it has to beat rather than by preference. `FabricNode`'s default
 * `rpcTimeoutMs` is 30 s, which is how long the `unreachable` case takes to settle in the
 * worst case; a floor materially longer than that would make a peer that was merely dialled
 * early wait multiples of a timeout it already paid once. Five seconds is short enough that
 * the second ask lands promptly after a peer finishes starting, and long enough that a
 * fetch loop reading this getter per block cannot turn it into a request per block.
 */
export const DEFAULT_VERDICT_RETRY_FLOOR_MS = 5_000

export interface PeerVerifierOptions {
  readonly libp2p: Libp2p
  readonly rpc: RpcEndpoint
  /** The peers currently connected. A thunk, so a peer that arrives later is included. */
  readonly peers: () => readonly string[]
  /**
   * Provider keys this node pins.
   *
   * A set of **issuers**, never of peers: pinning is about who signed, never about who is
   * talking. Empty means this node verifies nobody — see the module comment.
   */
  readonly trustedIssuers: ReadonlySet<PublicKeyHex>
  /**
   * How long a retryable refusal stands before it is asked again.
   *
   * Defaults to {@link DEFAULT_VERDICT_RETRY_FLOOR_MS}. A documented default rather than a
   * named-absence sentinel, following `maxConcurrentTasks`: this is a rate, and every value
   * including zero is meaningful, so there is no absent case for a sentinel to name.
   */
  readonly retryFloorMs?: number
}

function refuse(failure: PeerFailure, reason: string): PeerVerdict {
  return { ok: false, failure, reason }
}

/** Per-peer certificate verdicts, cached, driven by libp2p connect/disconnect. */
export class PeerVerifier {
  readonly #libp2p: Libp2p
  readonly #rpc: RpcEndpoint
  readonly #peers: () => readonly string[]
  readonly #trustedIssuers: ReadonlySet<PublicKeyHex>
  /** One in-flight or settled promise per peer. This is what makes a verdict computed once. */
  readonly #inFlight = new Map<string, Promise<PeerVerdict>>()
  /** The settled verdicts, which is what {@link verdictFor} and {@link verifiedPeers} read. */
  readonly #verdicts = new Map<string, PeerVerdict>()
  /**
   * The most recent ask per peer: when it was issued, and which ask it was.
   *
   * `at` is stamped when the request is **issued** rather than when it returns, so an ask
   * still in flight already holds off the next one — that, and not a separate flag, is what
   * stops a hot read loop from stacking requests on a peer whose answer is slow.
   *
   * `generation` exists because re-asking made a settled promise able to arrive *late*. Two
   * asks for one peer can be in flight at once, they can settle in either order, and without
   * something to tell them apart the older answer would overwrite the newer verdict. Only
   * the ask whose generation is still current writes. Deleting the entry on disconnect makes
   * every outstanding ask non-current at once, which is how the original "a disconnect that
   * landed mid-request must not resurrect a verdict" rule survives.
   *
   * **The counter is per verifier, not per peer, and that is the whole of why it works.**
   * A per-peer counter is the obvious shape and it is wrong: `#onDisconnect` deletes the
   * entry, so the next ask for that peer starts again at 1 and *collides with the ask still
   * in flight from before the disconnect* — precisely the pair this is meant to separate.
   * Measured, not reasoned about: with a per-peer counter, an ask issued before a disconnect
   * overwrites the verdict of an ask issued after the reconnect. Monotone across the whole
   * verifier, a generation is never reissued and the collision cannot occur.
   */
  readonly #lastAsk = new Map<string, { readonly generation: number; readonly at: number }>()
  /** Monotone for the life of this verifier. See {@link PeerVerifier.#lastAsk}. */
  #generations = 0
  readonly #retryFloorMs: number
  #subscribed = false
  #stopped = false

  readonly #onConnect = (event: CustomEvent<PeerId>): void => {
    // The guard is not belt-and-braces; it is the whole of what makes `stop()` work
    // against a real libp2p. See {@link stop}.
    if (this.#stopped) return
    // `verify` resolves for every outcome including failure — the catch is inside it — so
    // there is no rejection here to leave unhandled.
    void this.verify(event.detail.toString())
  }

  readonly #onDisconnect = (event: CustomEvent<PeerId>): void => {
    if (this.#stopped) return
    // All three maps, deliberately. Dropping only the verdict would leave a settled promise
    // memoised, so a peer that reconnected would be trusted from memory rather than
    // verified again — and leaving `#askedAt` behind would make the first ask after a
    // reconnect look like a repeat and be held off by the retry floor.
    const peerId = event.detail.toString()
    this.#inFlight.delete(peerId)
    this.#verdicts.delete(peerId)
    this.#lastAsk.delete(peerId)
  }

  private constructor(options: PeerVerifierOptions) {
    this.#libp2p = options.libp2p
    this.#rpc = options.rpc
    this.#peers = options.peers
    this.#trustedIssuers = options.trustedIssuers
    this.#retryFloorMs = options.retryFloorMs ?? DEFAULT_VERDICT_RETRY_FLOOR_MS
  }

  /**
   * Build a verifier and, unless this node pins nobody, start verifying.
   *
   * The first step is a **return, not a subscription** — see the module comment's
   * "a node that pins nobody does no work at all". The seeding loop runs *after* the
   * listeners are attached, so a connection arriving in between is caught by one or the
   * other; both paths funnel into the same memoised {@link verify}, so a peer seen twice
   * is verified once.
   */
  static start(options: PeerVerifierOptions): PeerVerifier {
    const verifier = new PeerVerifier(options)
    if (options.trustedIssuers.size === 0) return verifier
    verifier.#subscribe()
    for (const peer of options.peers()) void verifier.verify(peer)
    return verifier
  }

  #subscribe(): void {
    this.#libp2p.addEventListener('peer:connect', this.#onConnect)
    this.#libp2p.addEventListener('peer:disconnect', this.#onDisconnect)
    this.#subscribed = true
  }

  /**
   * The connected peers this node will fetch a block from.
   *
   * Two branches, and both need saying. With **no anchors** this returns the connected
   * set unchanged: a node that pins nobody states that it verifies nobody, which is what
   * every node in this repository did before this phase and what every existing test
   * relies on. With anchors it is fail-closed by construction — a peer whose verification
   * has not finished is not yet verified, which is the right default for a gate, and the
   * cost is one RPC round trip because the consumer reads this thunk per fetch.
   *
   * **Reading this getter can start a request**, which is unusual enough to say plainly.
   * See `#refresh` below for why the trigger lives here and what bounds it. The filter
   * still reads only settled verdicts, so the value returned is never affected by the
   * request the same call may have just issued — a re-ask in flight leaves the *old*
   * verdict standing, and a peer under re-verification therefore stays excluded until it
   * verifies. Fail-closed is preserved across the retry, not merely at the first ask.
   *
   * ## The relay does not share this reading, and the difference is a type
   *
   * The first line below is **fail-open**: pinned nobody ⇒ trust everybody. That is
   * deliberate here and is what makes *"a node with no trust anchors has no verdicts"* true
   * by construction — see the module comment's "why a node that pins nobody does no work at
   * all". It is also **confined to this gate, which decides who to *use*.**
   *
   * `RelayAdmission` (`@o2/libp2p`) decides who gets *in*, and it never reads an empty set
   * as permission: an empty set there admits nobody, and the open posture has its own name,
   * `'admits-any-peer'`. So the two mechanisms do not read one value two ways — they read
   * **different types**, which is the entire reason that one is a union rather than a set.
   *
   * **Do not "fix" this early return to match it.** Flipping it globally breaks every
   * unpinned node in this repository and re-opens a fabric-wide behaviour that was already
   * ruled on. The matching half of this paragraph is written at `RelayAdmission`'s own
   * docblock, because an asymmetry recorded at only one of two lines gets reverted from the
   * other.
   */
  get verifiedPeers(): readonly string[] {
    if (this.#trustedIssuers.size === 0) return this.#peers()
    const peers = this.#peers()
    for (const peer of peers) this.#refresh(peer)
    return peers.filter((peer) => this.#verdicts.get(peer)?.ok === true)
  }

  /**
   * Ask again about one peer, if asking again could change the answer.
   *
   * This exists because **a verdict is a fact with an expiry date and the first version of
   * this class treated it as permanent**. A peer is verified at `peer:connect`, and a node
   * that enrols *after* a peer connected to it was then excluded by that peer for the life
   * of the connection, with nothing reporting it. Measured rather than reasoned about: a
   * gate dialled a tab before the tab's `serveAgent` was up, the `records` request went
   * unanswered for the full 30 s RPC budget, and the `unreachable` that eventually settled
   * would have stood forever even though the tab held a valid certificate from the pinned
   * issuer the whole time.
   *
   * Three guards, each closing a different way this could become unbounded:
   *
   * 1. **A settled acceptance is never re-asked.** Verification is monotone here — nothing
   *    below revokes — so a peer that verified stays verified until it disconnects.
   * 2. **A {@link FINAL} refusal is never re-asked**, which is what keeps a peer that
   *    presented a forged or borrowed certificate from costing an RPC per interval forever.
   * 3. **Nothing is re-asked inside the retry floor.** Because {@link verify} stamps
   *    `#askedAt` when it *issues* rather than when it settles, this also covers the
   *    in-flight case: a slow answer holds off the next ask by itself.
   *
   * The `undefined` branch is the one worth reading twice. No settled verdict means either
   * an ask is in flight or no ask was ever made — and those are not the same. The second
   * happens when a peer is in `peers()` without this verifier having seen its
   * `peer:connect`, which is exactly the window `start`'s seeding loop exists for and
   * cannot cover on its own: `peers()` is read once at construction, so a peer that arrives
   * between that read and the listener taking effect belongs to neither path.
   * `#inFlight.has` distinguishes them, and the floor makes the recovery cost one ask.
   */
  #refresh(peerId: string): void {
    if (this.#stopped) return
    const settled = this.#verdicts.get(peerId)

    if (settled === undefined) {
      // Never asked at all — ask now. An ask already in flight is left alone.
      if (!this.#inFlight.has(peerId)) void this.verify(peerId)
      return
    }
    if (settled.ok) return
    if (FINAL.has(settled.failure.kind)) return
    if (Date.now() - (this.#lastAsk.get(peerId)?.at ?? 0) < this.#retryFloorMs) return

    // Drop the memo so `verify` issues a fresh request. The verdict itself stays until the
    // new one settles, which is what keeps the gate closed across the retry.
    this.#inFlight.delete(peerId)
    void this.verify(peerId)
  }

  /** The settled verdict for a peer, or `undefined` if none has been computed. */
  verdictFor(peerId: string): PeerVerdict | undefined {
    return this.#verdicts.get(peerId)
  }

  /**
   * Verify one peer. Concurrent callers share one request; a settled answer is memoised.
   *
   * **This used to say "at most once per connection", and that was the defect** — see
   * `#refresh`. The memo is still what makes concurrent callers cheap, but it is no longer
   * permanent: `#refresh` drops it when re-asking could change the answer. Nothing here
   * re-asks on its own, so calling `verify` twice still costs one request.
   *
   * Never rejects. Every outcome — including a peer that could not be reached and an
   * unexpected throw from anything below — arrives as a named verdict, because "every
   * exclusion is named" is worth nothing if one of them arrives as a stack trace.
   */
  verify(peerId: string): Promise<PeerVerdict> {
    const existing = this.#inFlight.get(peerId)
    if (existing !== undefined) return existing

    this.#generations += 1
    const generation = this.#generations
    this.#lastAsk.set(peerId, { generation, at: Date.now() })

    const settled = this.#decide(peerId)
      .catch((cause: unknown) =>
        refuse(
          { kind: 'unreachable', peerId, detail: describe(cause) },
          `peer ${peerId} could not be asked for its records: ${describe(cause)}`,
        ),
      )
      .then((verdict) => {
        // Only cached if this is still the current ask for a peer we still care about.
        // Two things make an answer stale, and the generation check covers both: a
        // `peer:disconnect` that landed while the request was in flight has dropped the
        // entry entirely, and re-adding a verdict here would resurrect it; and a retry
        // issued a newer ask, whose answer must not be overwritten by this older one
        // finishing second.
        if (this.#lastAsk.get(peerId)?.generation === generation) this.#verdicts.set(peerId, verdict)
        return verdict
      })

    this.#inFlight.set(peerId, settled)
    return settled
  }

  async #decide(peerId: string): Promise<PeerVerdict> {
    // 1. Which key this peer is allowed to present. The peer id is derived from the public
    //    key libp2p authenticated over Noise, so this is not a guess — it is the standing
    //    proof of possession, re-read on every dial.
    const expected = nodeKeyForPeerId(peerId)
    if (expected === null) {
      return refuse(
        { kind: 'unidentifiable-peer', peerId },
        `peer id ${peerId} names no Ed25519 key, so no node key can be expected of it`,
      )
    }

    // 2. Ask exactly that peer, directly — not through `RpcRecordIndex`. See the module
    //    comment for why the single-element-thunk reuse loses a whole failure kind.
    let body: CanonicalValue
    try {
      body = await this.#rpc.request(peerId, encodeRequest({ kind: 'records', nodeKey: expected }))
    } catch (cause) {
      const detail = cause instanceof RpcFailure ? `${cause.detail.kind}: ${cause.message}` : describe(cause)
      return refuse(
        { kind: 'unreachable', peerId, detail },
        `peer ${peerId} could not be asked for its records: ${detail}`,
      )
    }

    const response = parseResponse(body)
    if (response === null || response.kind !== 'records') {
      const detail = response === null ? 'an unparseable frame' : `a ${response.kind} frame`
      return refuse(
        { kind: 'unanswerable-peer', peerId, detail },
        `peer ${peerId} answered a records request with ${detail}`,
      )
    }
    if (response.records === null) {
      return refuse(
        { kind: 'no-records', nodeKey: expected },
        `peer ${peerId} holds no records for ${expected}`,
      )
    }

    // 3. The certificate must name the key this peer authenticated with.
    //
    //    Not redundant with the signature check below, and the difference is the whole of
    //    what verification means here. The peer has already proved possession of exactly
    //    one key over Noise; a certificate naming a different one is a certificate for
    //    somebody else — presented, perhaps, by a node that copied it off the wire.
    //    Without this the verifier would accept any valid certificate from any peer, which
    //    is not verification, it is a signature test.
    const { certificate } = response.records
    if (certificate.nodeKey !== expected) {
      return refuse(
        { kind: 'nodeKey-mismatch', expected, presented: certificate.nodeKey },
        `peer ${peerId} presented a certificate for ${certificate.nodeKey}, but its peer id implies ${expected}`,
      )
    }

    // 4. Offline. `verifyCertificate` takes its anchors as an argument and has nothing to
    //    reach out to, and its result is returned **unchanged** so the four kernel refusal
    //    names arrive at the caller exactly as `enrollment.ts` produced them.
    const verdict = verifyCertificate(certificate, this.#trustedIssuers, Date.now())
    if (!verdict.ok) return refuse(verdict.failure, verdict.reason)
    return { ok: true, certificate: verdict.certificate }
  }

  /**
   * Stop reacting to connections. A no-op when nothing was ever attached.
   *
   * **The flag is load-bearing and `removeEventListener` alone would not work**, which was
   * measured rather than assumed after the real-libp2p reading in
   * `peer-gate.node.test.ts` failed while the stub-`EventTarget` reading in
   * `peer-verifier.node.test.ts` passed.
   *
   * `Libp2p` extends `TypedEventEmitter` from `main-event` (`libp2p/dist/src/libp2p.js:25`,
   * `main-event@1.0.4`). Its `addEventListener` registers an **anonymous wrapper** with
   * `super.addEventListener` (`main-event/dist/src/index.js:89-104`), and its
   * `removeEventListener` passes the *caller's* listener to `super.removeEventListener`
   * (`:116-124`) — a function that was never registered on the underlying `EventTarget`.
   * So removal prunes only the internal bookkeeping array, and the listener keeps firing.
   * Measured directly against the installed package: after `removeEventListener`,
   * `listenerCount` reads `0` **and the listener is still called**, while a plain
   * `EventTarget` control stops at the first call. A counter that reports success beside a
   * listener that still fires is the worst possible shape, and it is pinned by a test in
   * `peer-verifier.node.test.ts` so an upgrade that fixes it is noticed.
   *
   * `removeEventListener` is still called, because it is correct against a conforming
   * `EventTarget` and because it does keep libp2p's own `listenerCount` honest. But the
   * guarantee this method makes must not depend on a third party's listener-removal
   * implementation, so the two handlers check {@link PeerVerifier.stop}'s flag first.
   */
  stop(): void {
    this.#stopped = true
    if (!this.#subscribed) return
    this.#libp2p.removeEventListener('peer:connect', this.#onConnect)
    this.#libp2p.removeEventListener('peer:disconnect', this.#onDisconnect)
    this.#subscribed = false
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
