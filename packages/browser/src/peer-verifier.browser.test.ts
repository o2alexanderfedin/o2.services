import { peerIdFromString } from '@libp2p/peer-id'
import { EnrollmentAuthority, MemoryNetwork, publishCapabilities, requestEnrollment } from '@o2/core'
import type { NodeCertificate, NodeRecords, PublicKeyHex } from '@o2/core'
import { PeerVerifier, SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { RpcEndpoint, encodeResponse, parseRequest } from '@o2/net'
import type { Libp2p } from '@libp2p/interface'
import { describe, expect, it } from 'vitest'

/**
 * AUTH-02's browser leg — a tab reaches a per-peer verdict, measured in a real browser.
 *
 * ## What this file exists to refute
 *
 * `DEFICIENCIES.md` **D09** read *"the browser tier structurally cannot verify peers,
 * because `PeerVerifier` lives in `@o2/node`"*, and `browser-node.ts`'s `enrollment`
 * docblock said the same thing at more length: *"nothing here constructs a peer verifier
 * … so a tab takes blocks from any peer"*. Both were true, and both were **packaging**
 * statements wearing the clothes of capability ones — nothing in `PeerVerifier` reads what
 * kind of node a peer is, and nothing in it touches a Node builtin. On 2026-08-14 the
 * module moved to `@o2/libp2p`, the dual-target tier `@o2/browser` already depended on.
 *
 * A claim that a thing is *possible* in a browser is worth nothing asserted from Node, so
 * this file is `.browser.test.ts` and runs in chromium, firefox and webkit. **The import
 * at the top of this file is itself half the measurement**: it is the specifier that could
 * not be written from this package a day ago.
 *
 * ## Why the peer is hand-built rather than a second real node
 *
 * The same reason `packages/node/src/peer-verifier.node.test.ts` gives, and this file
 * deliberately reuses that file's fixture shape rather than inventing a second one: the
 * subject is what `PeerVerifier` does with an answer, and the cases that matter need a
 * peer that answers *wrongly*. A lying mode on `BrowserNode` would be a test-only branch
 * in production code. `MemoryNetwork` is the portable transport `@o2/core` already ships,
 * `rpc.serve` is the same entry `serveAgent` funnels into, and the frame goes through the
 * production `parseRequest`/`encodeResponse` pair — so nothing about the wire is
 * simulated, only the dishonesty is.
 *
 * `libp2p` is a bare `EventTarget`. `PeerVerifier` uses exactly two of its members, so a
 * real node would add nothing observable here and would drag a relay into a unit test.
 *
 * ## What this file does NOT establish, stated because the gap is the interesting part
 *
 * It measures the **verifier** in a browser. It does not measure `browser-node.ts`'s
 * composition — that `#compose` hands `RpcBlockSource` the *verified* set rather than
 * `transport.peers` — because that line only becomes observable when a tab has a connected
 * peer it refuses, and a tab's only peers arrive over a relay. See this file's last
 * describe block, and the residual recorded with the requirement.
 */

/** Fixed patterns, not random — a failing run must be reproducible. */
const SUBJECT_SEED = new Uint8Array(SEED_BYTES).fill(0xd7)
const PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(0xda)
const OTHER_PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(0xdb)
const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xc1)

/** A certificate for `subjectSeed`, issued by a chosen provider at a chosen instant. */
function certificateFor(
  providerSeed: Uint8Array,
  subjectSeed: Uint8Array,
  at: number,
): { readonly issuerKey: PublicKeyHex; readonly certificate: NodeCertificate } {
  const authority = new EnrollmentAuthority({
    providerPrivateKey: providerSeed,
    certificateLifetimeMs: 30 * 24 * 3_600_000,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const result = authority.enrol(
    requestEnrollment(subjectSeed, USER_SEED, {
      operatorId: 'harbour-ops',
      discoverability: 'seed',
      relayIds: [],
    }),
    at,
  )
  if (!result.ok) throw new Error(`fixture enrollment refused: ${result.reason}`)
  return { issuerKey: authority.issuerKey, certificate: result.certificate }
}

/** Wrap a certificate as the `NodeRecords` a `records` answer carries. */
function recordsOf(certificate: NodeCertificate, subjectSeed: Uint8Array): NodeRecords {
  return {
    certificate,
    capabilities: publishCapabilities(subjectSeed, {
      features: [],
      sovereignFor: [],
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      extensions: [],
    }),
  }
}

interface Served {
  readonly verifier: PeerVerifier
  /** The address the answer is served at — a real Ed25519 peer id, which step 1 requires. */
  readonly peerId: string
  /** `records` requests the serving side has answered. */
  readonly requests: () => number
  readonly stop: () => void
}

/**
 * Serve one hand-built `records` answer in this tab and point a `PeerVerifier` at it.
 *
 * The serving address is load-bearing rather than incidental: `#decide`'s first step runs
 * `nodeKeyForPeerId` over the peer id, so an arbitrary string would land every case on
 * `unidentifiable-peer` instead of the refusal under test. One derived identity is used as
 * both the `MemoryNetwork.connect()` address and the subject of every fixture certificate.
 */
async function servedBy(options: {
  answer: (nodeKey: PublicKeyHex) => NodeRecords | null
  trustedIssuers: ReadonlySet<PublicKeyHex>
  /** Defaults to the served peer alone, which is what makes `start`'s seeding loop fire. */
  peers?: (peerId: string) => readonly string[]
}): Promise<Served> {
  const identity = await identityFromSeed(SUBJECT_SEED)
  const network = new MemoryNetwork()
  const serverRpc = new RpcEndpoint(network.connect(identity.peerId))
  const clientRpc = new RpcEndpoint(network.connect('the-tab'))

  let requests = 0
  // `async` because `RpcHandler` returns a promise — the answers below are all synchronous
  // and none of the timing cases the Node-tier spec carries is reproduced here.
  serverRpc.serve(async (_from, body) => {
    const request = parseRequest(body)
    if (request === null || request.kind !== 'records') {
      return encodeResponse({ kind: 'error', reason: `unexpected request ${String(request?.kind)}` })
    }
    requests += 1
    return encodeResponse({ kind: 'records', records: options.answer(request.nodeKey) })
  })

  const events = new EventTarget()
  const verifier = PeerVerifier.start({
    libp2p: events as unknown as Libp2p,
    rpc: clientRpc,
    peers: () => (options.peers ?? ((id: string) => [id]))(identity.peerId),
    trustedIssuers: options.trustedIssuers,
  })

  return {
    verifier,
    peerId: identity.peerId,
    requests: () => requests,
    stop: () => {
      verifier.stop()
      serverRpc.close()
      clientRpc.close()
    },
  }
}

describe('AUTH-02 — a tab reaches a named verdict about a peer', () => {
  it('accepts a peer whose certificate chains to an issuer this tab pins', async () => {
    const { issuerKey, certificate } = certificateFor(PROVIDER_SEED, SUBJECT_SEED, Date.now())
    const served = await servedBy({
      answer: () => recordsOf(certificate, SUBJECT_SEED),
      trustedIssuers: new Set([issuerKey]),
    })
    try {
      const verdict = await served.verifier.verify(served.peerId)
      // The acceptance carries the certificate rather than a boolean, so a caller can say
      // *which* document it acted on — the same shape the Node tier returns.
      expect(verdict.ok).toBe(true)
      if (!verdict.ok) throw new Error(verdict.reason)
      expect(verdict.certificate.nodeKey).toBe(certificate.nodeKey)
      // And the gate agrees with the verdict, which is the reading that matters: this is
      // the exact getter `#compose` hands to `RpcBlockSource`.
      expect(served.verifier.verifiedPeers).toEqual([served.peerId])
    } finally {
      served.stop()
    }
  })

  it('excludes a peer whose certificate chains to an issuer this tab does not pin, and names why', async () => {
    // Signed by a real provider, correctly, for the right subject — and simply not the
    // provider this tab pinned. That is the case a tab could not previously reach at all,
    // and it is fail-closed: the peer is connected and is still not in the block source.
    const other = certificateFor(OTHER_PROVIDER_SEED, SUBJECT_SEED, Date.now())
    const pinned = certificateFor(PROVIDER_SEED, SUBJECT_SEED, Date.now())
    expect(other.issuerKey).not.toBe(pinned.issuerKey)

    const served = await servedBy({
      answer: () => recordsOf(other.certificate, SUBJECT_SEED),
      trustedIssuers: new Set([pinned.issuerKey]),
    })
    try {
      const verdict = await served.verifier.verify(served.peerId)
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('a certificate from an unpinned issuer was accepted')
      // Named, not merely refused. `untrusted-issuer` arrives from `@o2/core`'s
      // `verifyCertificate` unchanged, which is what makes a browser refusal and a Node
      // refusal the same string rather than two dialects.
      expect(verdict.failure.kind).toBe('untrusted-issuer')
      expect(served.verifier.verifiedPeers).toEqual([])
      expect(served.verifier.verdictFor(served.peerId)?.ok).toBe(false)
    } finally {
      served.stop()
    }
  })

  it('excludes a peer presenting a certificate minted for somebody else', async () => {
    // Step 3, and the one that separates verification from a signature test: the document
    // verifies perfectly and names a key this peer never proved possession of. A browser
    // reaching this verdict is the impersonation case, and it is the reason the gate is
    // not simply "did anything valid arrive".
    const borrowed = certificateFor(PROVIDER_SEED, new Uint8Array(SEED_BYTES).fill(0xd8), Date.now())
    const served = await servedBy({
      answer: () => recordsOf(borrowed.certificate, new Uint8Array(SEED_BYTES).fill(0xd8)),
      trustedIssuers: new Set([borrowed.issuerKey]),
    })
    try {
      const verdict = await served.verifier.verify(served.peerId)
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('a borrowed certificate was accepted')
      expect(verdict.failure.kind).toBe('nodeKey-mismatch')
      expect(served.verifier.verifiedPeers).toEqual([])
    } finally {
      served.stop()
    }
  })
})

describe('AUTH-02 — a tab that pins nobody keeps working exactly as it did', () => {
  /**
   * The crux of wiring a verifier into a tab, and the thing that would have broken the
   * demo if `PeerVerifier` had been fail-closed on an empty anchor set.
   *
   * A tab's only peer is the relay it reserved on. If `verifiedPeers` returned `[]` for a
   * node that pinned nobody, every existing page — every `BrowserNode` in this repository,
   * none of which passes `trustedIssuers` — would have an **empty block source** and would
   * stop fetching blocks, with no refusal named anywhere and nothing distinguishing it
   * from a network outage. That is the failure shape NET-05 exists to eliminate one tier
   * down, and it is why `PeerVerifier.verifiedPeers` opens with an early return rather
   * than a filter.
   *
   * So this is not a smoke test of an unused branch. It is the case that decides whether
   * the default `BrowserNode` still works, and it is measured in a browser rather than
   * argued from the Node tier's reading of the same line.
   */
  it('hands back the connected set unchanged and asks nobody anything', async () => {
    const served = await servedBy({
      answer: () => {
        throw new Error('a tab that pins nobody must not issue a records request')
      },
      trustedIssuers: new Set<PublicKeyHex>(),
      peers: (peerId) => [peerId, 'a-second-connected-peer'],
    })
    try {
      // Unchanged means unchanged — order and membership, not "a non-empty subset".
      expect(served.verifier.verifiedPeers).toEqual([served.peerId, 'a-second-connected-peer'])
      // Read twice, because the getter is documented as able to issue a request and the
      // claim here is that this branch never does. A second read is where a filter that
      // "warms up" would show itself.
      expect(served.verifier.verifiedPeers).toEqual([served.peerId, 'a-second-connected-peer'])
      // No verdict was computed, rather than a verdict that happened to be an acceptance.
      // The distinction is the whole of "a tab that pins nobody does no work at all": the
      // `answer` above throws, so a single request would have surfaced as a rejection.
      expect(served.requests()).toBe(0)
      expect(served.verifier.verdictFor(served.peerId)).toBeUndefined()
    } finally {
      served.stop()
    }
  })
})
