import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import {
  EnrollmentAuthority,
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

function enrol(auth: EnrollmentAuthority, seed: number, opts: { operatorId?: string; role?: 'backbone' | 'edge'; at?: number } = {}) {
  const node = keypair(seed)
  const request = requestEnrollment(node.priv, {
    userKey: alice.pub,
    operatorId: opts.operatorId ?? 'alice-op',
    role: opts.role ?? 'edge',
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
    const request = requestEnrollment(node.priv, { userKey: alice.pub, operatorId: 'o', role: 'edge' })
    expect(Object.values(request).some((v) => v === toHex(node.priv))).toBe(false)
  })

  it('refuses a request that cannot prove it holds the key', () => {
    const auth = authority()
    const victim = keypair(2)
    const attacker = keypair(3)

    // The attacker claims the victim's public key but signs with their own.
    const forged = requestEnrollment(attacker.priv, { userKey: alice.pub, operatorId: 'o', role: 'edge' })
    const result = auth.enrol({ ...forged, nodeKey: victim.pub }, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-proof-of-possession')
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

    const first = requestEnrollment(keypair(30).priv, { userKey: alice.pub, operatorId: 'a', role: 'edge' })
    expect(auth.enrol(first, NOW).ok).toBe(true)

    const second = requestEnrollment(keypair(31).priv, { userKey: bob.pub, operatorId: 'b', role: 'edge' })
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

describe('a browser peer is a full peer', () => {
  it('enrols with the same certificate shape as a backbone node', () => {
    // Revised 2026-07-26: role describes reachability, not privilege. An edge
    // certificate carries the same fields and the same weight; the only difference
    // is that reaching the node needs a relay.
    const auth = authority({ maxPerWindow: 10 })
    const edge = enrol(auth, 90, { role: 'edge' }).result
    const backbone = enrol(auth, 91, { role: 'backbone' }).result
    expect(edge.ok && backbone.ok).toBe(true)
    if (!edge.ok || !backbone.ok) return

    expect(Object.keys(edge.certificate).sort()).toEqual(Object.keys(backbone.certificate).sort())
    const anchors = new Set([auth.issuerKey])
    expect(verifyCertificate(edge.certificate, anchors, NOW).ok).toBe(true)
    expect(verifyCertificate(backbone.certificate, anchors, NOW).ok).toBe(true)
  })
})
