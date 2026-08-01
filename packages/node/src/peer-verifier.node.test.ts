import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { peerIdFromString } from '@libp2p/peer-id'
import { EnrollmentAuthority, MemoryNetwork, publishCapabilities, requestEnrollment } from '@o2/core'
import type { NodeCertificate, NodeRecords, PublicKeyHex } from '@o2/core'
import { SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { RpcEndpoint, encodeResponse, parseRequest } from '@o2/net'
import type { Libp2p } from '@libp2p/interface'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { PeerVerifier } from './peer-verifier.ts'

/**
 * AUTH-02 — a node verifies a peer's provider-signed certificate offline.
 *
 * Two instruments, used for different things and never interchangeably.
 *
 * **Real `FabricNode`s over real libp2p** are used wherever the subject is a production
 * path: that a certificate really is fetchable from a running node, that an unpinned
 * issuer really is refused, that a node passing the `'serves-no-records'` sentinel really
 * yields `no-records` rather than something else, and — the one that matters most — that
 * verification succeeds with the **provider process stopped**.
 *
 * **A hand-built `records` answer over `MemoryNetwork`** is used wherever the subject is
 * how `PeerVerifier` handles an answer it is given. Those cases need a peer that lies, and
 * a lying mode on `FabricNode` would be a test-only branch in production code —
 * 17-CONTEXT.md is explicit that no `--forge` flag is added to any binary. So the answer
 * is built directly and served from one place, reused by six cases.
 *
 * **The address that machinery serves at is load-bearing, not incidental.** `verify`'s
 * first step runs `nodeKeyForPeerId` over the peer id before anything else, so the serving
 * address must be a real Ed25519 peer id or every case lands on `unidentifiable-peer`
 * instead. This file **CHOOSES** the address — `MemoryNetwork.connect()` takes an
 * arbitrary `localId` string — so it derives one throwaway identity and uses
 * `identity.peerId` as both the `connect()` address and the argument to `verify()`, with
 * all fixture certificates minted for `identity.nodeKey`. One identity, both ends; the
 * invariant is a line rather than an accident.
 *
 * Three of the six hand-built cases must **satisfy** the `nodeKey` check so the refusal
 * under test is reached at all, and one — the borrowed certificate — exists precisely to
 * **violate** it. Same machinery, opposite fixture. They are next to each other on purpose
 * and must not be confused.
 */

/** Fixed patterns, not random — a failing run must be reproducible. */
const FIXTURE_SEED = new Uint8Array(SEED_BYTES).fill(0xd7)
const BORROWED_SEED = new Uint8Array(SEED_BYTES).fill(0xd8)
const UNSERVED_SEED = new Uint8Array(SEED_BYTES).fill(0xd9)
const PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(0xda)
const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xc1)
const OTHER_USER_SEED = new Uint8Array(SEED_BYTES).fill(0xc2)

/** Wait until `predicate` holds, or fail after `timeoutMs`. */
async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

// ---------------------------------------------------------------------------------
// The hand-built answer, written once and reused.
// ---------------------------------------------------------------------------------

interface HandBuilt {
  readonly verifier: PeerVerifier
  /** The address the answer is served at, and the argument every `verify()` call takes. */
  readonly peerId: string
  /** The node key that peer id implies — what a certificate must name to pass step 3. */
  readonly nodeKey: PublicKeyHex
  /** `records` requests this serving side has answered. */
  readonly requests: () => number
  /** Fire a `peer:connect` for an arbitrary peer id, as libp2p would. */
  readonly connect: (peerId: string) => void
  /** Fire the matching `peer:disconnect`. */
  readonly disconnect: (peerId: string) => void
  readonly stop: () => void
}

/**
 * Serve one hand-built `records` answer and point a `PeerVerifier` at it.
 *
 * `rpc.serve` directly rather than through `serveAgent`: the subject here is what
 * `PeerVerifier` does with an answer, and the answer still goes through the same
 * `parseRequest`/`encodeResponse` pair production uses, so nothing about the frame is
 * simulated. `serveAgent` would add six required hooks that none of these cases reads.
 *
 * `libp2p` is a bare `EventTarget`. `PeerVerifier` uses exactly two members of it —
 * `addEventListener` and `removeEventListener` — so a real node adds nothing a test could
 * observe here, and a stub is what makes the `stop()` reading below possible at all.
 */
async function servedBy(options: {
  answer: (nodeKey: PublicKeyHex) => NodeRecords | null
  trustedIssuers: ReadonlySet<PublicKeyHex>
  /** Defaults to the served peer, which is what makes `start`'s seeding loop fire. */
  peers?: (peerId: string) => readonly string[]
}): Promise<HandBuilt> {
  const identity = await identityFromSeed(FIXTURE_SEED)
  const network = new MemoryNetwork()
  const serverRpc = new RpcEndpoint(network.connect(identity.peerId))
  const clientRpc = new RpcEndpoint(network.connect('the-verifier'))

  let requests = 0
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
    nodeKey: identity.nodeKey,
    requests: () => requests,
    connect: (peerId: string) => {
      events.dispatchEvent(new CustomEvent('peer:connect', { detail: peerIdFromString(peerId) }))
    },
    disconnect: (peerId: string) => {
      events.dispatchEvent(new CustomEvent('peer:disconnect', { detail: peerIdFromString(peerId) }))
    },
    stop: () => {
      verifier.stop()
      serverRpc.close()
      clientRpc.close()
    },
  }
}

/** A certificate for `subjectSeed`, issued by the fixture provider at a chosen instant. */
function certificateFor(
  subjectSeed: Uint8Array,
  userSeed: Uint8Array,
  at: number,
  lifetimeMs = 30 * 24 * 3_600_000,
): { readonly authority: EnrollmentAuthority; readonly certificate: NodeCertificate } {
  const authority = new EnrollmentAuthority({
    providerPrivateKey: PROVIDER_SEED,
    certificateLifetimeMs: lifetimeMs,
  })
  const result = authority.enrol(
    requestEnrollment(subjectSeed, userSeed, {
      operatorId: 'harbour-ops',
      discoverability: 'seed',
      relayIds: [],
    }),
    at,
  )
  if (!result.ok) throw new Error(`fixture enrollment refused: ${result.reason}`)
  return { authority, certificate: result.certificate }
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
    }),
  }
}

/** The pinned issuer set every hand-built case uses. */
const PINNED = new Set<PublicKeyHex>([
  certificateFor(FIXTURE_SEED, USER_SEED, Date.now()).authority.issuerKey,
])

// ---------------------------------------------------------------------------------
// Real nodes.
// ---------------------------------------------------------------------------------

let workdir: string
const nodes: FabricNode[] = []
const cleanups: (() => void)[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-verifier-'))
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

const start = async (options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> => {
  const node = await FabricNode.start({
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 10_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/** Stop one node out of turn — the offline reading below needs the provider gone. */
const stop = async (node: FabricNode): Promise<void> => {
  const at = nodes.indexOf(node)
  if (at >= 0) nodes.splice(at, 1)
  await node.stop()
}

const addrOf = (node: FabricNode): string => {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

/** A `PeerVerifier` over a real node's own libp2p and rpc. */
const verifierOn = (node: FabricNode, trustedIssuers: readonly (PublicKeyHex | null)[]): PeerVerifier => {
  const verifier = PeerVerifier.start({
    libp2p: node.libp2p,
    rpc: node.rpc,
    peers: () => node.transport.peers,
    trustedIssuers: new Set(trustedIssuers.filter((key): key is PublicKeyHex => key !== null)),
  })
  cleanups.push(() => verifier.stop())
  return verifier
}

describe('AUTH-02 — a peer with a pinned issuer’s certificate is verified, offline', () => {
  /**
   * The offline property, **measured rather than inspected**: the provider process is
   * stopped before the verifier ever runs. If a live authority were being consulted this
   * could not pass, and that is cheaper and stronger than reading the source for the
   * absence of a network call.
   *
   * **No deletion turns this red, and it is written down rather than claimed.**
   * `verifyCertificate` takes its anchors as an argument and has nothing to reach out to
   * (`core/src/enrollment.ts:339-343`); there is no network call to delete. What this item
   * measures is that no *future* one was added.
   */
  it('verifies a peer’s certificate with the provider stopped, and lists it as verified', async () => {
    const p1 = await start({ blockstoreDir: join(workdir, 'p1'), issuesCertificates: true })
    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      enrollment: {
        userPrivateKey: USER_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(p1),
      },
    })
    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(a))

    const verifier = verifierOn(b, [p1.issuerKey])

    // Gone before a single verdict is computed.
    await stop(p1)

    const verdict = await verifier.verify(a.peerId)
    expect(verdict.ok).toBe(true)
    expect(verdict.ok ? verdict.certificate : null).toStrictEqual(a.certificate)
    expect(verifier.verifiedPeers).toContain(a.peerId)
  }, 40_000)

  /**
   * Reddened by deleting the `if (!trustedIssuers.has(certificate.issuer))` guard at
   * `core/src/enrollment.ts:344`.
   *
   * The exclusion is asserted **next to** the connection, so "absent" reads as a filter
   * and not as an empty list.
   */
  it('refuses a certificate from an unpinned issuer by name, and excludes only that peer', async () => {
    const p1 = await start({ blockstoreDir: join(workdir, 'p1'), issuesCertificates: true })
    const p2 = await start({ blockstoreDir: join(workdir, 'p2'), issuesCertificates: true })
    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: addrOf(p1) },
    })
    const c = await start({
      blockstoreDir: join(workdir, 'c'),
      enrollment: { userPrivateKey: OTHER_USER_SEED, operatorId: 'trawler-ops', providerAddr: addrOf(p2) },
    })
    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(a))
    await b.dial(addrOf(c))

    const verifier = verifierOn(b, [p1.issuerKey])
    expect(p2.issuerKey).not.toBe(p1.issuerKey)

    const verdict = await verifier.verify(c.peerId)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok ? null : verdict.failure).toStrictEqual({
      kind: 'untrusted-issuer',
      issuer: p2.issuerKey,
    })

    // The instrument is shown reading both ways: A is verified, C is not.
    expect((await verifier.verify(a.peerId)).ok).toBe(true)
    expect(b.transport.peers).toContain(c.peerId)
    expect(verifier.verifiedPeers).not.toContain(c.peerId)
    expect(verifier.verifiedPeers).toContain(a.peerId)
  }, 60_000)

  /**
   * "I could not ask" and "it answered badly" must not be the same verdict — both in one
   * test, against two different peers, because being distinguishable is the whole point.
   *
   * Reddened by replacing the direct `rpc.request` in `#decide` with
   * `new RpcRecordIndex(rpc, () => [peerId]).recordsFor(expected)`: both become
   * `no-records`, which is exactly why that adapter is not used.
   */
  it('tells a peer that answered “no records” apart from one it could not ask at all', async () => {
    const p1 = await start({ blockstoreDir: join(workdir, 'p1'), issuesCertificates: true })
    // A perfectly healthy node that never enrolled — it passes the `'serves-no-records'`
    // sentinel and answers `records: null`.
    const silent = await start({ blockstoreDir: join(workdir, 'silent') })
    const b = await start({ blockstoreDir: join(workdir, 'b') })
    await b.dial(addrOf(silent))

    const verifier = verifierOn(b, [p1.issuerKey])

    const answered = await verifier.verify(silent.peerId)
    expect(answered.ok ? null : answered.failure.kind).toBe('no-records')

    // A syntactically real Ed25519 peer id that nothing is serving, so the send itself
    // fails and `RpcFailure`'s typed detail survives into `detail`.
    const nobody = (await identityFromSeed(UNSERVED_SEED)).peerId
    const unasked = await verifier.verify(nobody)
    expect(unasked.ok).toBe(false)
    expect(unasked.ok ? null : unasked.failure).toMatchObject({
      kind: 'unreachable',
      peerId: nobody,
      detail: expect.any(String),
    })
    expect(unasked.ok ? '' : (unasked.failure as { detail: string }).detail.length).toBeGreaterThan(0)
  }, 60_000)
})

describe('AUTH-02 — the kernel’s four refusal names arrive through this class unchanged', () => {
  /**
   * Without these three, a `PeerVerifier` whose failure path hardcoded
   * `{kind: 'untrusted-issuer', issuer: certificate.issuer}` instead of calling
   * `verifyCertificate` at all would leave every other assertion in this file green.
   *
   * All three fixtures satisfy **both** predecessor checks or the refusal under test is
   * never reached: each certificate is issued by the PINNED provider (or
   * `untrusted-issuer` fires first, `enrollment.ts:344`), and each names the `nodeKey` the
   * serving peer id implies (or step 3's `nodeKey-mismatch` fires before
   * `verifyCertificate` is called at all). This is the **opposite** of the borrowed-
   * certificate case below, which reuses the same machinery precisely in order to violate
   * the second condition.
   *
   * All three are reddened by replacing `#decide`'s `verifyCertificate` call with a
   * hardcoded `{kind: 'untrusted-issuer', …}`.
   */
  it('refuses a tampered signature as bad-signature, naming the certificate’s node key', async () => {
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, Date.now())
    const last = certificate.signature.slice(-1)
    const tampered: NodeCertificate = {
      ...certificate,
      signature: certificate.signature.slice(0, -1) + (last === '0' ? '1' : '0'),
    }

    const served = await servedBy({ answer: () => recordsOf(tampered, FIXTURE_SEED), trustedIssuers: PINNED })
    cleanups.push(served.stop)

    const verdict = await served.verifier.verify(served.peerId)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok ? null : verdict.failure).toMatchObject({
      kind: 'bad-signature',
      nodeKey: served.nodeKey,
    })
  })

  it('refuses an expired certificate as expired, with both expiresAt and now populated', async () => {
    const issuedAt = Date.now() - 60_000
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, issuedAt, 1_000)
    expect(certificate.expiresAt).toBeLessThan(Date.now())

    const served = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
    })
    cleanups.push(served.stop)

    const verdict = await served.verifier.verify(served.peerId)
    expect(verdict.ok).toBe(false)
    const failure = verdict.ok ? null : (verdict.failure as { kind: string; expiresAt: number; now: number })
    expect(failure?.kind).toBe('expired')
    expect(failure?.expiresAt).toBe(certificate.expiresAt)
    expect(failure?.now).toBeGreaterThan(certificate.expiresAt)
  })

  it('refuses a not-yet-valid certificate as not-yet-valid, with both issuedAt and now populated', async () => {
    const issuedAt = Date.now() + 600_000
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, issuedAt)
    expect(certificate.issuedAt).toBeGreaterThan(Date.now())

    const served = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
    })
    cleanups.push(served.stop)

    const verdict = await served.verifier.verify(served.peerId)
    expect(verdict.ok).toBe(false)
    const failure = verdict.ok ? null : (verdict.failure as { kind: string; issuedAt: number; now: number })
    expect(failure?.kind).toBe('not-yet-valid')
    expect(failure?.issuedAt).toBe(certificate.issuedAt)
    expect(failure?.now).toBeLessThan(certificate.issuedAt)
  })
})

describe('AUTH-02 — the five peer-level refusals', () => {
  /**
   * The borrowed certificate: genuinely signed by the pinned provider, unexpired, and for
   * somebody else. The **opposite fixture** to the three above, over the same machinery —
   * this one deliberately violates the `nodeKey` condition they all satisfy.
   *
   * Reddened by deleting the `certificate.nodeKey === expected` check in `#decide`. Without
   * it the verifier would accept any valid certificate from any peer, which is not
   * verification, it is a signature test. This is Plan 17-05's Mutation B.
   */
  it('refuses a certificate borrowed from another node as nodeKey-mismatch, naming both keys', async () => {
    const borrower = await identityFromSeed(BORROWED_SEED)
    const { certificate } = certificateFor(BORROWED_SEED, USER_SEED, Date.now())
    expect(certificate.nodeKey).toBe(borrower.nodeKey)

    const served = await servedBy({
      answer: () => recordsOf(certificate, BORROWED_SEED),
      trustedIssuers: PINNED,
    })
    cleanups.push(served.stop)
    expect(borrower.nodeKey).not.toBe(served.nodeKey)

    const verdict = await served.verifier.verify(served.peerId)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok ? null : verdict.failure).toStrictEqual({
      kind: 'nodeKey-mismatch',
      expected: served.nodeKey,
      presented: borrower.nodeKey,
    })
  })

  /** A peer id that names no Ed25519 key. `nodeKeyForPeerId` answers `null` and step 1 refuses. */
  it('refuses a peer id that names no Ed25519 key as unidentifiable-peer', async () => {
    // `peers: () => []` so `start`'s seeding loop issues nothing, and the counter below
    // reads only what `verify('not-a-peer-id')` caused. With the default thunk it reads 1
    // — which is the seeding loop working, and would make the assertion meaningless.
    const served = await servedBy({ answer: () => null, trustedIssuers: PINNED, peers: () => [] })
    cleanups.push(served.stop)

    const verdict = await served.verifier.verify('not-a-peer-id')
    expect(verdict.ok ? null : verdict.failure).toStrictEqual({
      kind: 'unidentifiable-peer',
      peerId: 'not-a-peer-id',
    })
    // And nothing was asked: there was no key to ask about.
    expect(served.requests()).toBe(0)
  })

  /** An answer of the wrong kind is named, not silently treated as an absence. */
  it('refuses an answer that is not a records frame as unanswerable-peer', async () => {
    const identity = await identityFromSeed(FIXTURE_SEED)
    const network = new MemoryNetwork()
    const serverRpc = new RpcEndpoint(network.connect(identity.peerId))
    const clientRpc = new RpcEndpoint(network.connect('the-verifier'))
    serverRpc.serve(async () => encodeResponse({ kind: 'error', reason: 'nope' }))
    const verifier = PeerVerifier.start({
      libp2p: new EventTarget() as unknown as Libp2p,
      rpc: clientRpc,
      peers: () => [],
      trustedIssuers: PINNED,
    })
    cleanups.push(() => {
      verifier.stop()
      serverRpc.close()
      clientRpc.close()
    })

    const verdict = await verifier.verify(identity.peerId)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok ? null : verdict.failure).toMatchObject({
      kind: 'unanswerable-peer',
      peerId: identity.peerId,
    })
  })
})

describe('AUTH-02 — a node that pins nobody does no verification work at all', () => {
  /**
   * Decision 9's third row, made a **measurement** rather than a race.
   *
   * The zero is what turns the `undefined` assertion into a reading. If `start` subscribed
   * unconditionally, `verdictFor` would become defined — `untrusted-issuer`, because
   * `verifyCertificate` refuses against an empty anchor set at `enrollment.ts:344` — as
   * soon as the in-flight RPC landed, and the `undefined` assertion would pass only by
   * finishing first. The zero is paired with a known positive in the same test, so it is a
   * reading and not a counter nobody incremented.
   *
   * Reddened by deleting the `if (options.trustedIssuers.size === 0) return verifier` line
   * in `start`.
   */
  it('issues zero records requests and has no verdicts, beside a pinning verifier that issues one', async () => {
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, Date.now())

    const pinsNobody = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: new Set<PublicKeyHex>(),
    })
    cleanups.push(pinsNobody.stop)

    // A verifier that pins nobody treats every connected peer as usable, exactly as every
    // node in this repository did before this phase.
    expect(pinsNobody.verifier.verifiedPeers).toStrictEqual([pinsNobody.peerId])
    expect(pinsNobody.verifier.verdictFor(pinsNobody.peerId)).toBeUndefined()
    expect(pinsNobody.requests()).toBe(0)

    const pins = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
    })
    cleanups.push(pins.stop)
    await until(
      () => pins.verifier.verdictFor(pins.peerId) !== undefined,
      5_000,
      'the pinning verifier’s seeded verdict',
    )

    // The same counter, on the same machinery, reading one.
    expect(pins.requests()).toBe(1)
    expect(pins.verifier.verdictFor(pins.peerId)?.ok).toBe(true)

    // And the zero above has not moved while that ran.
    expect(pinsNobody.requests()).toBe(0)
    expect(pinsNobody.verifier.verdictFor(pinsNobody.peerId)).toBeUndefined()
  })
})

describe('AUTH-02 — one verification per connection', () => {
  /**
   * Reddened by deleting the memo lookup at the top of `verify`.
   *
   * `start`'s seeding loop has already issued one request by the time this runs, so the
   * count below is the total for three routes into `verify` — the seed and two explicit
   * calls — and it is one.
   */
  it('computes a verdict once per peer and returns the same object', async () => {
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, Date.now())
    const served = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
    })
    cleanups.push(served.stop)

    const first = await served.verifier.verify(served.peerId)
    const second = await served.verifier.verify(served.peerId)
    expect(second).toBe(first)
    expect(served.requests()).toBe(1)
  })

  /**
   * A verdict dropped on disconnect, so a peer that reconnects is verified again rather
   * than trusted from memory.
   *
   * Reddened by deleting the `#verdicts.delete` / `#inFlight.delete` pair in the
   * disconnect handler.
   */
  it('drops the cached verdict on peer:disconnect and verifies again on reconnect', async () => {
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, Date.now())
    const served = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
      peers: () => [],
    })
    cleanups.push(served.stop)

    served.connect(served.peerId)
    await until(() => served.verifier.verdictFor(served.peerId) !== undefined, 5_000, 'the first verdict')
    expect(served.requests()).toBe(1)

    served.disconnect(served.peerId)
    expect(served.verifier.verdictFor(served.peerId)).toBeUndefined()

    served.connect(served.peerId)
    await until(() => served.verifier.verdictFor(served.peerId) !== undefined, 5_000, 'the second verdict')
    expect(served.requests()).toBe(2)
  })
})

describe('AUTH-02 — a peer connected before the verifier existed still gets a verdict', () => {
  /**
   * The relay case. `FabricNode.#compose` dials every `relayAddrs` entry before `rpc` and
   * therefore before any verifier exists, so those `peer:connect` events fire with nobody
   * listening. Without the seeding loop, a node configured with both `relayAddrs` and
   * `trustedIssuers` could never fetch a block from the one peer it is reachable through,
   * permanently, with no error anywhere.
   *
   * Reddened by deleting `for (const peer of options.peers()) void verifier.verify(peer)`
   * from `start`.
   */
  it('verifies a peer already present in peers() at construction, with no connect event', async () => {
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, Date.now())
    const served = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
    })
    cleanups.push(served.stop)

    // No `connect()` call anywhere in this test: the peer was already in the thunk.
    await until(
      () => served.verifier.verdictFor(served.peerId) !== undefined,
      5_000,
      'a verdict for an already-connected peer',
    )
    expect(served.verifier.verdictFor(served.peerId)?.ok).toBe(true)
    expect(served.verifier.verifiedPeers).toStrictEqual([served.peerId])
  })
})

describe('AUTH-02 — stopping removes the listeners', () => {
  /**
   * The absence is paired with a presence, so an inert instrument cannot pass: a connect
   * event **before** `stop` produces a verdict, and the same event after it does not.
   * Asserting only that `verifiedPeers` is empty after `stop` would be satisfied by a
   * verifier that never worked.
   *
   * **Which reading this is.** The plan offers dispatching `peer:connect` by hand on a real
   * libp2p object, or driving the same pair through `PeerVerifier` with a stub
   * `EventTarget`. This file takes the second: `PeerVerifier` uses exactly
   * `addEventListener` and `removeEventListener`, so a real node adds nothing observable,
   * and hand-dispatching a synthetic `peer:connect` on a live libp2p object would also be
   * seen by libp2p's own internal listeners.
   *
   * Reddened by making `stop()` a no-op — the second peer acquires a verdict too.
   */
  it('produces a verdict for a connect before stop, and none for a connect after it', async () => {
    const { certificate } = certificateFor(FIXTURE_SEED, USER_SEED, Date.now())
    const served = await servedBy({
      answer: () => recordsOf(certificate, FIXTURE_SEED),
      trustedIssuers: PINNED,
      peers: () => [],
    })
    cleanups.push(served.stop)

    served.connect(served.peerId)
    await until(
      () => served.verifier.verdictFor(served.peerId) !== undefined,
      5_000,
      'a verdict for the peer that connected before stop',
    )

    served.verifier.stop()

    // A second, different peer id. Nothing serves it, so if the listener were still
    // attached the verdict would be `unreachable` — defined, which is the reading.
    const after = (await identityFromSeed(UNSERVED_SEED)).peerId
    served.connect(after)
    await new Promise((r) => setTimeout(r, 200))
    expect(served.verifier.verdictFor(after)).toBeUndefined()

    // And the earlier verdict, taken before stop, is still there — so this is not a
    // verifier that never worked.
    expect(served.verifier.verdictFor(served.peerId)?.ok).toBe(true)
  })

  /**
   * The stub above is a **conforming** `EventTarget`, and saying so is the point: this
   * reading passes whether or not `stop()` carries its flag, because `removeEventListener`
   * genuinely removes a listener here. The reading that falsifies `stop()` needs a real
   * libp2p object, and lives in `peer-gate.node.test.ts` next to the pin for why.
   */
  it('removes a listener from a conforming EventTarget, which is what makes the reading above weaker than the real one', () => {
    const plain = new EventTarget()
    let calls = 0
    const listener = (): void => {
      calls += 1
    }
    plain.addEventListener('peer:connect', listener)
    plain.dispatchEvent(new CustomEvent('peer:connect', { detail: 'one' }))
    plain.removeEventListener('peer:connect', listener)
    plain.dispatchEvent(new CustomEvent('peer:connect', { detail: 'two' }))
    expect(calls).toBe(1)
  })
})
