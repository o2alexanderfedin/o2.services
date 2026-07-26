import { describe, expect, it } from 'vitest'
import {
  attestationRank,
  attestationReceipt,
  classifyAttestation,
  composeQuorum,
  describeAttestation,
} from './quorum.ts'
import type { NodeCertificate, NodeRole } from './enrollment.ts'

/** VER-03, VER-04, VER-08, VER-09, VER-10 — criteria 5, 6, 7. */

function cert(nodeKey: string, operatorId: string, role: NodeRole, userKey = 'user-alice'): NodeCertificate {
  return {
    nodeKey,
    userKey,
    operatorId,
    role,
    issuedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    issuer: 'provider',
    signature: 'sig',
  }
}

describe('VER-08 — no two replicas from the same operator', () => {
  it('refuses a quorum an operator tried to fill alone', () => {
    // The attack this exists to stop: "3 of 3 agreed" meaning one person agreeing
    // with themselves on three machines.
    const result = composeQuorum(
      [
        cert('n1', 'mallory', 'backbone'),
        cert('n2', 'mallory', 'backbone'),
        cert('n3', 'mallory', 'edge'),
      ],
      { size: 3 },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('insufficient-operators')
    if (result.refusal.kind !== 'insufficient-operators') return
    expect(result.refusal.distinctOperators).toBe(1)
    expect(result.reason).toContain('distinct operators')
  })

  it('composes from distinct operators, one node each', () => {
    const result = composeQuorum(
      [
        cert('n1', 'op-a', 'backbone'),
        cert('n2', 'op-a', 'backbone'),
        cert('n3', 'op-b', 'edge'),
        cert('n4', 'op-c', 'edge'),
      ],
      { size: 3 },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new Set(result.operators).size).toBe(3)
    expect(result.strength).toBe('independent')
  })

  it('refuses rather than quietly returning a smaller quorum', () => {
    // Degrading silently would produce a result labelled more trustworthy than it is.
    const result = composeQuorum([cert('n1', 'op-a', 'backbone'), cert('n2', 'op-b', 'edge')], { size: 3 })
    expect(result.ok).toBe(false)
  })
})

describe('VER-09 — every quorum keeps one directly-dialable member', () => {
  it('refuses an all-edge quorum, which shares a single relay dependency', () => {
    const result = composeQuorum(
      [cert('n1', 'op-a', 'edge'), cert('n2', 'op-b', 'edge'), cert('n3', 'op-c', 'edge')],
      { size: 3 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('no-backbone-anchor')
  })

  it('is a durability rule, not a caste rule — edge nodes fill the rest', () => {
    // Revised 2026-07-26: a browser peer is a full peer. The anchor exists because
    // an all-relayed quorum dies with the relay, not because edge nodes count less.
    const result = composeQuorum(
      [cert('n1', 'op-a', 'backbone'), cert('n2', 'op-b', 'edge'), cert('n3', 'op-c', 'edge')],
      { size: 3 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.filter((m) => m.role === 'edge')).toHaveLength(2)
  })

  it('can be switched off deliberately', () => {
    const result = composeQuorum(
      [cert('n1', 'op-a', 'edge'), cert('n2', 'op-b', 'edge')],
      { size: 2, requireBackboneAnchor: false },
    )
    expect(result.ok).toBe(true)
  })
})

describe('VER-10 / criterion 7 — a weaker claim cannot be read as a stronger one', () => {
  it('classifies the three strengths from the certificates, not from a caller’s say-so', () => {
    // Derived, never declared. A caller that could assert "independently verified"
    // would eventually assert one that was not.
    expect(classifyAttestation([cert('n1', 'op-a', 'backbone')])).toBe('owner-attested')
    expect(
      classifyAttestation([cert('n1', 'op-a', 'backbone'), cert('n2', 'op-a', 'edge')]),
    ).toBe('owner-domain')
    expect(
      classifyAttestation([cert('n1', 'op-a', 'backbone'), cert('n2', 'op-b', 'edge')]),
    ).toBe('independent')
  })

  it('ranks the strengths so comparisons never rely on string order', () => {
    expect(attestationRank('owner-attested')).toBeLessThan(attestationRank('owner-domain'))
    expect(attestationRank('owner-domain')).toBeLessThan(attestationRank('independent'))
  })

  it('describes each distinctly, so a reader cannot conflate them', () => {
    const descriptions = (['owner-attested', 'owner-domain', 'independent'] as const).map(describeAttestation)
    expect(new Set(descriptions).size).toBe(3)
    // The weak ones must say so in words, not only in a field a UI might drop.
    expect(descriptions[0]).toContain('not independently verified')
    expect(descriptions[1]).toContain('not across operators')
    expect(descriptions[2]).toContain('separate operators')
  })

  it('builds a receipt carrying the label everywhere a result surfaces', () => {
    const ownerDomain = attestationReceipt([
      cert('n1', 'alice-op', 'backbone'),
      cert('n2', 'alice-op', 'edge'),
    ])
    expect(ownerDomain.strength).toBe('owner-domain')
    expect(ownerDomain.replicas).toBe(2)
    expect(ownerDomain.operators).toEqual(['alice-op'])
    expect(ownerDomain.backboneAnchored).toBe(true)

    const independent = attestationReceipt([
      cert('n1', 'alice-op', 'backbone'),
      cert('n2', 'bob-op', 'edge'),
    ])
    expect(independent.strength).toBe('independent')
    // Two replicas either way — the count alone cannot distinguish them, which is
    // exactly why the label has to travel with the result.
    expect(independent.replicas).toBe(ownerDomain.replicas)
    expect(attestationRank(independent.strength)).toBeGreaterThan(attestationRank(ownerDomain.strength))
  })

  it('does not upgrade a single-node result however it is dressed up', () => {
    const receipt = attestationReceipt([cert('solo', 'alice-op', 'backbone')])
    expect(receipt.strength).toBe('owner-attested')
    expect(receipt.description).toContain('not independently verified')
  })
})
