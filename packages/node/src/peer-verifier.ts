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
 * ## Packaging, stated because it is a finding and not a design
 *
 * This module imports nothing Node-only: `@libp2p/interface` types, `@o2/core`,
 * `@o2/libp2p` and `@o2/net`, all of which `@o2/browser` already depends on. It lives in
 * `@o2/node` because that is where Plan 17-04 put it, and `@o2/browser` does not depend on
 * `@o2/node` — so the browser tier cannot currently construct one. That is a **packaging**
 * fact, not a capability one, and moving this file to `@o2/net` is a barrel change with no
 * code change. Until that happens, peer verification is measured for the Node tier and
 * UNMEASURED for the browser tier. Nothing here reads what kind of node a peer is; there
 * is no field to branch on.
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
    // Both maps, deliberately. Dropping only the verdict would leave a settled promise
    // memoised, so a peer that reconnected would be trusted from memory rather than
    // verified again.
    const peerId = event.detail.toString()
    this.#inFlight.delete(peerId)
    this.#verdicts.delete(peerId)
  }

  private constructor(options: PeerVerifierOptions) {
    this.#libp2p = options.libp2p
    this.#rpc = options.rpc
    this.#peers = options.peers
    this.#trustedIssuers = options.trustedIssuers
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
   */
  get verifiedPeers(): readonly string[] {
    if (this.#trustedIssuers.size === 0) return this.#peers()
    return this.#peers().filter((peer) => this.#verdicts.get(peer)?.ok === true)
  }

  /** The settled verdict for a peer, or `undefined` if none has been computed. */
  verdictFor(peerId: string): PeerVerdict | undefined {
    return this.#verdicts.get(peerId)
  }

  /**
   * Verify one peer, at most once per connection.
   *
   * Never rejects. Every outcome — including a peer that could not be reached and an
   * unexpected throw from anything below — arrives as a named verdict, because "every
   * exclusion is named" is worth nothing if one of them arrives as a stack trace.
   */
  verify(peerId: string): Promise<PeerVerdict> {
    const existing = this.#inFlight.get(peerId)
    if (existing !== undefined) return existing

    const settled = this.#decide(peerId)
      .catch((cause: unknown) =>
        refuse(
          { kind: 'unreachable', peerId, detail: describe(cause) },
          `peer ${peerId} could not be asked for its records: ${describe(cause)}`,
        ),
      )
      .then((verdict) => {
        // Only cached if this peer is still one we care about: a `peer:disconnect` that
        // landed while the request was in flight has already dropped the in-flight entry,
        // and re-adding a verdict here would resurrect it.
        if (this.#inFlight.has(peerId)) this.#verdicts.set(peerId, verdict)
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
