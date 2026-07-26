import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { canonicalCid } from './canonical/encode.ts'
import { toHex } from './capability.ts'
import {
  discoverExecutors,
  FallbackRecordIndex,
  MemoryRecordIndex,
  publishCapabilities,
  verifyCapabilityRecord,
} from './discovery.ts'
import type { NodeRecords, RecordIndex } from './discovery.ts'
import { EnrollmentAuthority, requestEnrollment } from './enrollment.ts'
import type { NodeCertificate } from './enrollment.ts'

/**
 * SCHED-01 and NET-06 — a requestor with no peer list finds executors from a CID.
 *
 * The discipline this file follows is the project's: every rule is checked by
 * *planting the violation it forbids* and requiring the rule to catch it. A filter
 * that has only ever seen valid input is a filter nobody has tested.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(90)
const alice = keypair(91)
const bob = keypair(92)
const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000

const authority = (): EnrollmentAuthority =>
  new EnrollmentAuthority({ providerPrivateKey: provider.priv, maxPerWindow: 50 })

const trusted = new Set([toHex(ed25519.getPublicKey(provider.priv))])

interface Enrolled {
  readonly priv: Uint8Array
  readonly nodeKey: string
  readonly records: NodeRecords
}

function node(
  auth: EnrollmentAuthority,
  seed: number,
  options: {
    userKey?: string
    operatorId?: string
    features?: readonly string[]
    sovereignFor?: readonly string[]
  } = {},
): Enrolled {
  const key = keypair(seed)
  const userKey = options.userKey ?? alice.pub
  const enrolled = auth.enrol(
    requestEnrollment(key.priv, {
      userKey,
      operatorId: options.operatorId ?? `op-${seed}`,
      discoverability: 'seed',
      relayIds: [],
    }),
    NOW,
  )
  if (!enrolled.ok) throw new Error(`fixture failed to enrol: ${enrolled.reason}`)

  const capabilities = publishCapabilities(key.priv, {
    features: options.features ?? ['simd128', 'bulk-memory'],
    sovereignFor: options.sovereignFor ?? [],
    issuedAt: NOW - 1000,
    expiresAt: NOW + YEAR,
  })

  return {
    priv: key.priv,
    nodeKey: key.pub,
    records: { certificate: enrolled.certificate, capabilities },
  }
}

async function inputCid() {
  const cid = await canonicalCid({ dataset: 'census-2026' })
  if (!cid.ok) throw new Error('fixture cid')
  return cid.cid
}

/** An index holding a set of nodes, all of which provide the block. */
async function indexOf(...nodes: readonly Enrolled[]): Promise<{ index: MemoryRecordIndex; cid: Awaited<ReturnType<typeof inputCid>> }> {
  const index = new MemoryRecordIndex()
  const cid = await inputCid()
  for (const n of nodes) {
    index.provide(cid, n.nodeKey)
    index.publish(n.records)
  }
  return { index, cid }
}

describe('SCHED-01 — discovery is the intersection of three facts', () => {
  it('finds executors from a data CID alone, with no peer list', async () => {
    const auth = authority()
    const a = node(auth, 1)
    const b = node(auth, 2)
    const { index, cid } = await indexOf(a, b)

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    // The query carried a CID and nothing else. No node ids were supplied.
    expect(found.executors.map((e) => e.nodeKey).sort()).toEqual([a.nodeKey, b.nodeKey].sort())
    expect(found.excluded).toEqual([])
    expect(found.providers).toBe(2)
  })

  it('excludes a provider that holds the data but is not enrolled', async () => {
    // Planted violation: a node publishes records but its certificate is signed by a
    // key the requestor has not pinned. Holding the block is not identity.
    const rogueAuthority = new EnrollmentAuthority({ providerPrivateKey: keypair(93).priv })
    const auth = authority()
    const honest = node(auth, 1)
    const impostor = node(rogueAuthority, 2)
    const { index, cid } = await indexOf(honest, impostor)

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    expect(found.executors.map((e) => e.nodeKey)).toEqual([honest.nodeKey])
    const excluded = found.excluded.find((e) => e.reason.kind === 'invalid-certificate')
    expect(excluded).toBeDefined()
    expect(excluded?.detail).toContain('untrusted-issuer')
  })

  it('excludes a node whose capability record was signed by someone else', async () => {
    // Planted violation: take a real node's certificate and pair it with a capability
    // record minted by an attacker. Each half verifies; the pairing must not.
    const auth = authority()
    const honest = node(auth, 1)
    const attacker = keypair(94)
    const forged = publishCapabilities(attacker.priv, {
      features: ['simd128', 'bulk-memory', 'threads'],
      sovereignFor: [],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
    })

    const index = new MemoryRecordIndex()
    const cid = await inputCid()
    index.provide(cid, honest.nodeKey)
    index.publish({ certificate: honest.records.certificate, capabilities: forged })

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    expect(found.executors).toEqual([])
    expect(found.excluded[0]?.reason.kind).toBe('certificate-mismatch')
  })

  it('excludes a node whose capability record has a broken signature', async () => {
    const auth = authority()
    const a = node(auth, 1)
    const tampered: NodeRecords = {
      certificate: a.records.certificate,
      // Planted violation: claim a feature the node never signed for.
      capabilities: { ...a.records.capabilities, features: ['simd128', 'bulk-memory', 'threads'] },
    }
    const index = new MemoryRecordIndex()
    const cid = await inputCid()
    index.provide(cid, a.nodeKey)
    index.publish(tampered)

    expect(verifyCapabilityRecord(tampered.capabilities, NOW)).toBe(false)
    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })
    expect(found.executors).toEqual([])
    expect(found.excluded[0]?.reason.kind).toBe('invalid-capability-record')
  })

  it('excludes a node whose engine lacks a required feature, and names it', async () => {
    const auth = authority()
    const modern = node(auth, 1, { features: ['simd128', 'bulk-memory'] })
    const old = node(auth, 2, { features: ['bulk-memory'] })
    const { index, cid } = await indexOf(modern, old)

    const found = await discoverExecutors(
      { inputCid: cid, requiredFeatures: ['simd128'] },
      index,
      { trustedIssuers: trusted, now: NOW },
    )

    expect(found.executors.map((e) => e.nodeKey)).toEqual([modern.nodeKey])
    const excluded = found.excluded[0]
    expect(excluded?.reason.kind).toBe('missing-features')
    if (excluded?.reason.kind === 'missing-features') {
      expect(excluded.reason.missing).toEqual(['simd128'])
    }
  })

  it('reports a provider with no published records rather than dropping it silently', async () => {
    const auth = authority()
    const a = node(auth, 1)
    const index = new MemoryRecordIndex()
    const cid = await inputCid()
    index.provide(cid, a.nodeKey)
    index.provide(cid, 'ffff') // provides the block; never enrolled
    index.publish(a.records)

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    expect(found.executors.map((e) => e.nodeKey)).toEqual([a.nodeKey])
    expect(found.excluded.map((e) => e.reason.kind)).toEqual(['no-records'])
    expect(found.providers).toBe(2)
  })

  it('excludes an expired certificate at the requestor’s clock', async () => {
    const auth = new EnrollmentAuthority({
      providerPrivateKey: provider.priv,
      certificateLifetimeMs: 1000,
    })
    const a = node(auth, 1)
    const { index, cid } = await indexOf(a)

    const later = NOW + 5000
    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: later })

    expect(found.executors).toEqual([])
    expect(found.excluded[0]?.reason.kind).toBe('invalid-certificate')
  })
})

describe('DATA-09 — providing sovereign data is not clearance to execute it', () => {
  it('excludes a node holding an encrypted replica it cannot decrypt', async () => {
    const auth = authority()
    // Both provide the block. Only one is cleared to execute for Alice — the other
    // holds the encrypted replica, which makes it a fine block source and an
    // impossible executor.
    const cleared = node(auth, 1, { sovereignFor: [alice.pub] })
    const replicaOnly = node(auth, 2, { sovereignFor: [] })
    const { index, cid } = await indexOf(cleared, replicaOnly)

    const found = await discoverExecutors(
      { inputCid: cid, sovereignFor: alice.pub },
      index,
      { trustedIssuers: trusted, now: NOW },
    )

    expect(found.executors.map((e) => e.nodeKey)).toEqual([cleared.nodeKey])
    const excluded = found.excluded[0]
    expect(excluded?.reason.kind).toBe('not-cleared-for-owner')
    expect(excluded?.detail).toContain(alice.pub)
  })

  it('does not let clearance for one owner leak into another', async () => {
    const auth = authority()
    const forAlice = node(auth, 1, { sovereignFor: [alice.pub] })
    const { index, cid } = await indexOf(forAlice)

    const found = await discoverExecutors(
      { inputCid: cid, sovereignFor: bob.pub },
      index,
      { trustedIssuers: trusted, now: NOW },
    )

    expect(found.executors).toEqual([])
  })
})

describe('NET-06 — the fallback chain keys on availability, never on node kind', () => {
  /** An index that is reachable or not, exactly like a real peer. */
  function source(name: string, index: RecordIndex, reachable: () => boolean) {
    return { name, index, available: reachable }
  }

  it('serves from a peer’s own index when that peer is reachable', async () => {
    const auth = authority()
    const a = node(auth, 1)
    const { index: local, cid } = await indexOf(a)
    const backbone = new MemoryRecordIndex()

    const chain = new FallbackRecordIndex([
      source('local', local, () => true),
      source('backbone', backbone, () => true),
    ])

    const found = await discoverExecutors({ inputCid: cid }, chain, { trustedIssuers: trusted, now: NOW })
    expect(found.executors.map((e) => e.nodeKey)).toEqual([a.nodeKey])
    expect(chain.lastSource).toBe('local')
  })

  it('falls through when the local index cannot currently be served from', async () => {
    // A browser tab that has not obtained a relay reservation: its records are real,
    // but no peer can reach it to ask, so the lookup delegates.
    const auth = authority()
    const a = node(auth, 1)
    const { index: backbone, cid } = await indexOf(a)
    const local = new MemoryRecordIndex()

    let hasReservation = false
    const chain = new FallbackRecordIndex([
      source('local', local, () => hasReservation),
      source('backbone', backbone, () => true),
    ])

    const found = await discoverExecutors({ inputCid: cid }, chain, { trustedIssuers: trusted, now: NOW })
    expect(found.executors.map((e) => e.nodeKey)).toEqual([a.nodeKey])
    expect(chain.lastSource).toBe('backbone')

    // And once it is reachable it serves for itself, with no code path changed.
    hasReservation = true
    local.provide(cid, a.nodeKey)
    local.publish(a.records)
    await chain.providers(cid)
    expect(chain.lastSource).toBe('local')
  })

  it('treats a listening server with an unavailable index exactly the same', async () => {
    // The symmetry assertion. If this behaved differently from the browser case
    // above, `available()` would be encoding a node tier rather than a state.
    const auth = authority()
    const a = node(auth, 1)
    const { index: peer, cid } = await indexOf(a)
    const serverLocal = new MemoryRecordIndex()
    serverLocal.provide(cid, a.nodeKey)
    serverLocal.publish(a.records)

    let listening = false
    const chain = new FallbackRecordIndex([
      source('local', serverLocal, () => listening),
      source('peer', peer, () => true),
    ])

    await chain.providers(cid)
    expect(chain.lastSource).toBe('peer')

    listening = true
    await chain.providers(cid)
    expect(chain.lastSource).toBe('local')
  })

  it('falls through an available index that simply knows nothing', async () => {
    // Partial knowledge is the normal condition for a node that just joined. An
    // empty answer from a reachable peer is not authoritative.
    const auth = authority()
    const a = node(auth, 1)
    const { index: backbone, cid } = await indexOf(a)

    const chain = new FallbackRecordIndex([
      source('empty', new MemoryRecordIndex(), () => true),
      source('backbone', backbone, () => true),
    ])

    const found = await discoverExecutors({ inputCid: cid }, chain, { trustedIssuers: trusted, now: NOW })
    expect(found.executors.map((e) => e.nodeKey)).toEqual([a.nodeKey])
    expect(chain.lastSource).toBe('backbone')
  })

  it('returns nothing, not an error, when no source is reachable', async () => {
    const cid = await inputCid()
    const chain = new FallbackRecordIndex([
      source('local', new MemoryRecordIndex(), () => false),
      source('backbone', new MemoryRecordIndex(), () => false),
    ])

    const found = await discoverExecutors({ inputCid: cid }, chain, { trustedIssuers: trusted, now: NOW })
    expect(found.executors).toEqual([])
    expect(found.providers).toBe(0)
    expect(chain.lastSource).toBeNull()
  })
})

describe('capability records are worthless alone and that is the design', () => {
  it('verifies a well-formed record against its own key', () => {
    const key = keypair(95)
    const record = publishCapabilities(key.priv, {
      features: ['simd128'],
      sovereignFor: [],
      issuedAt: NOW - 1,
      expiresAt: NOW + YEAR,
    })
    expect(record.nodeKey).toBe(key.pub)
    expect(verifyCapabilityRecord(record, NOW)).toBe(true)
  })

  it('rejects a record outside its validity window', () => {
    const key = keypair(96)
    const record = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + 1000,
    })
    expect(verifyCapabilityRecord(record, NOW - 1)).toBe(false)
    expect(verifyCapabilityRecord(record, NOW + 1000)).toBe(false)
    expect(verifyCapabilityRecord(record, NOW + 999)).toBe(true)
  })

  it('lets an attacker mint a perfectly valid record for a key nobody vouched for', async () => {
    // Stated as a test because it is the reason the intersection exists. This record
    // verifies. It buys nothing, because discovery also demands a certificate from a
    // pinned provider for the same key.
    const attacker = keypair(97)
    const record = publishCapabilities(attacker.priv, {
      features: ['simd128', 'bulk-memory'],
      sovereignFor: [alice.pub],
      issuedAt: NOW - 1,
      expiresAt: NOW + YEAR,
    })
    expect(verifyCapabilityRecord(record, NOW)).toBe(true)

    const index = new MemoryRecordIndex()
    const cid = await inputCid()
    index.provide(cid, attacker.pub)
    // No certificate to publish, because no provider issued one.
    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })
    expect(found.executors).toEqual([])
    expect(found.excluded[0]?.reason.kind).toBe('no-records')
  })

  it('does not let a certificate for one node vouch for another', async () => {
    const auth = authority()
    const real = node(auth, 1)
    const attacker = keypair(98)
    const attackerRecord = publishCapabilities(attacker.priv, {
      features: ['simd128'],
      sovereignFor: [],
      issuedAt: NOW - 1,
      expiresAt: NOW + YEAR,
    })

    const index = new MemoryRecordIndex()
    const cid = await inputCid()
    index.provide(cid, attacker.pub)
    // Planted violation: publish under the attacker's key, but carry the real node's
    // certificate. `publish` keys on the certificate, so look the attacker up.
    const mixed: { certificate: NodeCertificate; capabilities: typeof attackerRecord } = {
      certificate: real.records.certificate,
      capabilities: attackerRecord,
    }
    const forgedIndex: RecordIndex = {
      providers: async () => [attacker.pub],
      recordsFor: async () => mixed,
    }

    const found = await discoverExecutors({ inputCid: cid }, forgedIndex, {
      trustedIssuers: trusted,
      now: NOW,
    })
    expect(found.executors).toEqual([])
    expect(found.excluded[0]?.reason.kind).toBe('certificate-mismatch')
    void index
  })
})
