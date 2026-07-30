import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import {
  EnrollmentAuthority,
  possessionChallenge,
  requestEnrollment,
  resolveReplicaSets,
  verifyCertificate,
} from './enrollment.ts'
import type { NodeCertificate } from './enrollment.ts'

/** AUTH-01, AUTH-02, AUTH-04, AUTH-05. */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(40)
const rogue = keypair(41)
const alice = keypair(42)
const NOW = 1_800_000_000_000

function authority(overrides: { maxPerWindow?: number; windowMs?: number } = {}) {
  return new EnrollmentAuthority({
    providerPrivateKey: provider.priv,
    maxPerWindow: overrides.maxPerWindow ?? 3,
    windowMs: overrides.windowMs ?? 60_000,
  })
}

function enrol(auth: EnrollmentAuthority, seed: number, opts: { operatorId?: string; relayIds?: string[]; at?: number } = {}) {
  const node = keypair(seed)
  const request = requestEnrollment(node.priv, alice.priv, {
    operatorId: opts.operatorId ?? 'alice-op',
    discoverability: (opts.relayIds ?? ['relay-1']).length > 0 ? 'via-relay' : 'seed',
    relayIds: opts.relayIds ?? ['relay-1'],
  })
  return { node, result: auth.enrol(request, opts.at ?? NOW) }
}

describe('AUTH-01 — the private key never leaves the device', () => {
  it('issues from a public key plus a proof of possession', () => {
    const auth = authority()
    const { node, result } = enrol(auth, 1)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.nodeKey).toBe(node.pub)
    expect(result.certificate.issuer).toBe(auth.issuerKey)

    // Nothing in the request carries a secret. If a provider could issue without
    // proof, it could impersonate every node it ever enrolled.
    const request = requestEnrollment(node.priv, alice.priv, { operatorId: 'o', discoverability: 'seed', relayIds: [] })
    expect(Object.values(request).some((v) => v === toHex(node.priv))).toBe(false)
  })

  it('refuses a request that cannot prove it holds the key', () => {
    const auth = authority()
    const victim = keypair(2)
    const attacker = keypair(3)

    // The attacker claims the victim's public key but signs with their own.
    const forged = requestEnrollment(attacker.priv, alice.priv, { operatorId: 'o', discoverability: 'seed', relayIds: [] })
    const result = auth.enrol({ ...forged, nodeKey: victim.pub }, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-proof-of-possession')
  })
})

/**
 * A certificate names a user key. Until this, nothing that user did put it there.
 *
 * The node proved it held its own key and the challenge carried the user key inside
 * it, but the user key's private half never signed anything — so a provider would
 * issue a certificate naming any victim's user key to anybody who asked. Reproduced
 * against these classes before the fix: the attacker got a certificate,
 * `verifyCertificate` accepted it, and the victim was then rate-limited out of
 * enrolling their own node because the limiter keys on the attacker-supplied value.
 */
describe('AUTH-04 — a certificate names the user who consented to it', () => {
  it('refuses a request naming another user’s key without that user’s signature', () => {
    const auth = authority()
    const attackerNode = keypair(60)

    // Hand-assembled, because `requestEnrollment` can no longer express it: the user
    // key is derived from the private key it is given, not accepted as a field.
    const challenge = possessionChallenge(attackerNode.pub, alice.pub)
    const forged = {
      nodeKey: attackerNode.pub,
      userKey: alice.pub,
      operatorId: 'attacker-op',
      discoverability: 'seed' as const,
      relayIds: [],
      proofOfPossession: toHex(ed25519.sign(challenge, attackerNode.priv)),
      // Signed by the attacker's node key, which is not alice's.
      ownerProof: toHex(ed25519.sign(challenge, attackerNode.priv)),
    }

    const result = auth.enrol(forged, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-owner-proof')
    // Its own discriminant, because "this node lied about itself" and "this node
    // claimed someone else's account" are different events and only the second is an
    // attack on a third party.
    expect(result.refusal.kind).not.toBe('bad-proof-of-possession')
    expect(result.reason).toContain(alice.pub)
  })

  it('does not let a refused cross-user request consume the victim’s window', () => {
    const auth = authority({ maxPerWindow: 3 })
    const challengeFor = (node: { priv: Uint8Array; pub: string }) =>
      possessionChallenge(node.pub, alice.pub)

    for (let i = 0; i < 5; i++) {
      const attackerNode = keypair(70 + i)
      const challenge = challengeFor(attackerNode)
      auth.enrol(
        {
          nodeKey: attackerNode.pub,
          userKey: alice.pub,
          operatorId: 'attacker-op',
          discoverability: 'seed',
          relayIds: [],
          proofOfPossession: toHex(ed25519.sign(challenge, attackerNode.priv)),
          ownerProof: toHex(ed25519.sign(challenge, attackerNode.priv)),
        },
        NOW,
      )
    }

    // The ordering is the whole of this case: verification is pure and cheap, so it
    // costs nothing to do it before the limiter is touched, and doing it after is
    // what turned a forgeable field into a denial of service against its owner.
    expect(auth.issuedWithin(alice.pub, NOW)).toBe(0)
    expect(enrol(auth, 80).result.ok).toBe(true)
  })

  it('names the key it holds, because that is the only key it can name', () => {
    const auth = authority()
    const node = keypair(81)
    const request = requestEnrollment(node.priv, alice.priv, {
      operatorId: 'alice-op',
      discoverability: 'seed',
      relayIds: [],
    })
    const result = auth.enrol(request, NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.userKey).toBe(alice.pub)
  })

  it('cannot be handed a user key through its fields at all', () => {
    const node = keypair(82)
    requestEnrollment(node.priv, alice.priv, {
      operatorId: 'alice-op',
      discoverability: 'seed',
      relayIds: [],
      // @ts-expect-error userKey is derived from the private key, never supplied
      userKey: rogue.pub,
    })
  })
})

describe('AUTH-02 — verification is offline', () => {
  it('verifies against a pinned provider key with no authority call', () => {
    const auth = authority()
    const { result } = enrol(auth, 4)
    if (!result.ok) return

    // The trust anchors are an argument. There is nothing here to reach out to.
    const verdict = verifyCertificate(result.certificate, new Set([auth.issuerKey]), NOW)
    expect(verdict.ok).toBe(true)
  })

  it('refuses a certificate from an unpinned issuer', () => {
    const auth = authority()
    const { result } = enrol(auth, 5)
    if (!result.ok) return

    const verdict = verifyCertificate(result.certificate, new Set([rogue.pub]), NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('untrusted-issuer')
  })

  it('refuses a certificate altered after signing', () => {
    const auth = authority()
    const { result } = enrol(auth, 6, { operatorId: 'honest-op' })
    if (!result.ok) return

    // Changing the operator would defeat quorum diversity if it went unnoticed.
    const tampered: NodeCertificate = { ...result.certificate, operatorId: 'attacker-op' }
    const verdict = verifyCertificate(tampered, new Set([auth.issuerKey]), NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('bad-signature')
  })

  it('refuses an expired or not-yet-valid certificate', () => {
    const auth = new EnrollmentAuthority({ providerPrivateKey: provider.priv, certificateLifetimeMs: 1_000 })
    const { result } = enrol(auth, 7)
    if (!result.ok) return
    const anchors = new Set([auth.issuerKey])

    expect(verifyCertificate(result.certificate, anchors, NOW + 2_000).ok).toBe(false)
    expect(verifyCertificate(result.certificate, anchors, NOW - 1).ok).toBe(false)
    expect(verifyCertificate(result.certificate, anchors, NOW + 500).ok).toBe(true)
  })
})

describe('AUTH-04 — enrollment is rate-limited per user key', () => {
  it('permits up to the limit and then refuses, saying when to retry', () => {
    const auth = authority({ maxPerWindow: 3, windowMs: 60_000 })

    for (let i = 0; i < 3; i++) expect(enrol(auth, 10 + i).result.ok).toBe(true)

    const fourth = enrol(auth, 99)
    expect(fourth.result.ok).toBe(false)
    if (fourth.result.ok) return
    expect(fourth.result.refusal.kind).toBe('rate-limited')
    if (fourth.result.refusal.kind !== 'rate-limited') return
    // A refusal without a retry time makes a caller guess, and guessing means
    // hammering.
    expect(fourth.result.refusal.retryAfterMs).toBeGreaterThan(0)
    expect(fourth.result.reason).toContain('limit 3')
  })

  it('lets the window slide rather than blocking forever', () => {
    const auth = authority({ maxPerWindow: 2, windowMs: 60_000 })
    enrol(auth, 20, { at: NOW })
    enrol(auth, 21, { at: NOW })
    expect(enrol(auth, 22, { at: NOW }).result.ok).toBe(false)

    // Past the window, the earlier issues no longer count.
    expect(enrol(auth, 23, { at: NOW + 60_001 }).result.ok).toBe(true)
  })

  it('counts per user key, so one user cannot exhaust another’s budget', () => {
    const auth = authority({ maxPerWindow: 1 })
    const bob = keypair(50)

    const first = requestEnrollment(keypair(30).priv, alice.priv, { operatorId: 'a', discoverability: 'seed', relayIds: [] })
    expect(auth.enrol(first, NOW).ok).toBe(true)

    const second = requestEnrollment(keypair(31).priv, bob.priv, { operatorId: 'b', discoverability: 'seed', relayIds: [] })
    expect(auth.enrol(second, NOW).ok).toBe(true)

    expect(auth.issuedWithin(alice.pub, NOW)).toBe(1)
    expect(auth.issuedWithin(bob.pub, NOW)).toBe(1)
  })
})

describe('AUTH-05 — certificates chain to a user key, forming a replica set', () => {
  it('groups an owner’s nodes and reports whether redundancy is available', () => {
    const auth = authority({ maxPerWindow: 10 })
    const certs = [enrol(auth, 60).result, enrol(auth, 61).result]
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.certificate)

    const sets = resolveReplicaSets(certs, new Set([auth.issuerKey]), NOW)
    expect(sets).toHaveLength(1)
    expect(sets[0]!.userKey).toBe(alice.pub)
    expect(sets[0]!.certificates).toHaveLength(2)
    // Two live nodes means a sovereign task can run redundantly inside the owner's
    // own trust domain — the only place redundancy is available to it.
    expect(sets[0]!.canVerifyWithinOwnerDomain).toBe(true)
  })

  it('reports a single-node owner as unable to verify within its domain', () => {
    const auth = authority()
    const { result } = enrol(auth, 70)
    if (!result.ok) return
    const sets = resolveReplicaSets([result.certificate], new Set([auth.issuerKey]), NOW)
    expect(sets[0]!.canVerifyWithinOwnerDomain).toBe(false)
  })

  it('will not let an unverifiable certificate inflate a replica count', () => {
    // The dangerous case: a forged extra node making an owner-attested result look
    // like an owner-domain verified one.
    const auth = authority()
    const { result } = enrol(auth, 80)
    if (!result.ok) return
    const forged: NodeCertificate = { ...result.certificate, nodeKey: keypair(81).pub }

    const sets = resolveReplicaSets([result.certificate, forged], new Set([auth.issuerKey]), NOW)
    expect(sets[0]!.certificates).toHaveLength(1)
    expect(sets[0]!.canVerifyWithinOwnerDomain).toBe(false)
  })
})

describe('all nodes have equal functionality', () => {
  it('issues an identical certificate however the node is discovered', () => {
    // The certificate says how a node is found and nothing about what it may do.
    // A relay-discovered peer and a seed differ in one field's value — never in
    // shape, weight, or which checks apply.
    const auth = authority({ maxPerWindow: 10 })
    const relayed = enrol(auth, 90, { relayIds: ['relay-1'] }).result
    const direct = enrol(auth, 91, { relayIds: [] }).result
    expect(relayed.ok && direct.ok).toBe(true)
    if (!relayed.ok || !direct.ok) return

    expect(Object.keys(relayed.certificate).sort()).toEqual(Object.keys(direct.certificate).sort())
    expect(relayed.certificate.discoverability).toBe('via-relay')
    expect(direct.certificate.discoverability).toBe('seed')

    // Both verify by exactly the same path.
    const anchors = new Set([auth.issuerKey])
    expect(verifyCertificate(relayed.certificate, anchors, NOW).ok).toBe(true)
    expect(verifyCertificate(direct.certificate, anchors, NOW).ok).toBe(true)
  })

  it('signs the relay set, so a shared dependency cannot be hidden', () => {
    // Quorum path-diversity reads relayIds. If they were unsigned, a node could
    // understate its discovery dependencies and slip into a quorum it should not
    // share.
    const auth = authority()
    const { result } = enrol(auth, 92, { relayIds: ['relay-1'] })
    if (!result.ok) return
    const understated = { ...result.certificate, relayIds: [] }
    expect(verifyCertificate(understated, new Set([auth.issuerKey]), NOW).ok).toBe(false)
  })
})
