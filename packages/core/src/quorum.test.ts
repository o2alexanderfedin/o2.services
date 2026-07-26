import { describe, expect, it } from 'vitest'
import {
  attestationRank,
  attestationReceipt,
  classifyAttestation,
  composeQuorum,
  describeAttestation,
  sharedRelay,
} from './quorum.ts'
import type { NodeCertificate } from './enrollment.ts'

/** VER-03, VER-04, VER-08, VER-09, VER-10 — criteria 5, 6, 7. */

/** `relayIds: []` means a seed node; otherwise the relays it is discovered through. */
function cert(
  nodeKey: string,
  operatorId: string,
  relayIds: readonly string[],
  userKey = 'user-alice',
): NodeCertificate {
  return {
    nodeKey,
    userKey,
    operatorId,
    discoverability: relayIds.length === 0 ? 'seed' : 'via-relay',
    relayIds,
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
        cert('n1', 'mallory', []),
        cert('n2', 'mallory', []),
        cert('n3', 'mallory', ['relay-1']),
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
        cert('n1', 'op-a', []),
        cert('n2', 'op-a', []),
        cert('n3', 'op-b', ['relay-1']),
        cert('n4', 'op-c', ['relay-1']),
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
    const result = composeQuorum([cert('n1', 'op-a', []), cert('n2', 'op-b', ['relay-1'])], { size: 3 })
    expect(result.ok).toBe(false)
  })
})

describe('VER-09 — no single relay may be the only way to find a whole quorum', () => {
  it('refuses when every member is discoverable only through the same relay', () => {
    // Not a rule about kinds of node. Three nodes, three operators, all findable
    // only via one relay: if it fails they all vanish, and the redundancy was never
    // real.
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-1']), cert('n3', 'op-c', ['relay-1'])],
      { size: 3 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('shared-relay-dependency')
    if (result.refusal.kind !== 'shared-relay-dependency') return
    expect(result.refusal.relayId).toBe('relay-1')
  })

  it('accepts a quorum entirely of relay-discovered peers on different relays', () => {
    // The point of the correction: browser peers are not disqualified. Three of
    // them, independently discoverable, make a perfectly good quorum.
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-2']), cert('n3', 'op-c', ['relay-3'])],
      { size: 3 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.every((m) => m.discoverability === 'via-relay')).toBe(true)
  })

  it('applies the same rule to seed nodes — no exemption for servers', () => {
    // Symmetry check. What matters is the discovery graph, and a seed node simply
    // has no relay in it.
    const allDirect = composeQuorum(
      [cert('n1', 'op-a', []), cert('n2', 'op-b', []), cert('n3', 'op-c', [])],
      { size: 3 },
    )
    expect(allDirect.ok).toBe(true)

    // One seed member is enough to break a shared discovery dependency.
    const mixed = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-1']), cert('n3', 'op-c', [])],
      { size: 3 },
    )
    expect(mixed.ok).toBe(true)
  })

  it('reports the shared relay for a set, and null when paths are independent', () => {
    expect(sharedRelay([cert('a', 'op-a', ['r1']), cert('b', 'op-b', ['r1', 'r2'])])).toBe('r1')
    expect(sharedRelay([cert('a', 'op-a', ['r1']), cert('b', 'op-b', ['r2'])])).toBeNull()
    // A node discoverable via a second relay is not solely dependent on the first.
    expect(sharedRelay([cert('a', 'op-a', ['r1', 'r2']), cert('b', 'op-b', ['r2', 'r3'])])).toBe('r2')
    expect(sharedRelay([cert('a', 'op-a', [])])).toBeNull()
  })

  it('can be waived deliberately for a single-relay fixture', () => {
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-1'])],
      { size: 2, requireIndependentPaths: false },
    )
    expect(result.ok).toBe(true)
  })
})

describe('VER-10 / criterion 7 — a weaker claim cannot be read as a stronger one', () => {
  it('classifies the three strengths from the certificates, not from a caller’s say-so', () => {
    // Derived, never declared. A caller that could assert "independently verified"
    // would eventually assert one that was not.
    expect(classifyAttestation([cert('n1', 'op-a', [])])).toBe('owner-attested')
    expect(
      classifyAttestation([cert('n1', 'op-a', []), cert('n2', 'op-a', ['relay-1'])]),
    ).toBe('owner-domain')
    expect(
      classifyAttestation([cert('n1', 'op-a', []), cert('n2', 'op-b', ['relay-1'])]),
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
      cert('n1', 'alice-op', []),
      cert('n2', 'alice-op', ['relay-1']),
    ])
    expect(ownerDomain.strength).toBe('owner-domain')
    expect(ownerDomain.replicas).toBe(2)
    expect(ownerDomain.operators).toEqual(['alice-op'])
    // One member is a seed, so no relay is common to all — the receipt reports the
    // dependency truthfully rather than naming a relay only some rely on.
    expect(ownerDomain.sharedRelay).toBeNull()

    const independent = attestationReceipt([
      cert('n1', 'alice-op', []),
      cert('n2', 'bob-op', ['relay-1']),
    ])
    expect(independent.strength).toBe('independent')
    // Two replicas either way — the count alone cannot distinguish them, which is
    // exactly why the label has to travel with the result.
    expect(independent.replicas).toBe(ownerDomain.replicas)
    expect(attestationRank(independent.strength)).toBeGreaterThan(attestationRank(ownerDomain.strength))
  })

  it('does not upgrade a single-node result however it is dressed up', () => {
    const receipt = attestationReceipt([cert('solo', 'alice-op', [])])
    expect(receipt.strength).toBe('owner-attested')
    expect(receipt.description).toContain('not independently verified')
  })
})

describe('a seed has no discovery dependency, whatever relays it lists', () => {
  it('does not refuse seeds that merely advertise through one relay', () => {
    // Regression. `sharedRelay` originally read relayIds without consulting
    // discoverability, so three directly-dialable seeds that happened to share an
    // advertisement relay were refused as if they would vanish together. They would
    // not: losing the relay costs a seed nothing, because it can still be dialled.
    const seedsAdvertising = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-1']),
      cert('n3', 'op-c', ['relay-1']),
    ].map((c) => ({ ...c, discoverability: 'seed' as const }))

    expect(sharedRelay(seedsAdvertising)).toBeNull()
    expect(composeQuorum(seedsAdvertising, { size: 3 }).ok).toBe(true)
  })

  it('still refuses when the same relay is the members’ only way to be found', () => {
    // The distinction that makes the rule meaningful: identical relayIds, opposite
    // verdicts, decided by whether the node can be reached without them.
    const onlyViaRelay = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-1']),
      cert('n3', 'op-c', ['relay-1']),
    ]
    expect(onlyViaRelay.every((c) => c.discoverability === 'via-relay')).toBe(true)
    expect(sharedRelay(onlyViaRelay)).toBe('relay-1')
    expect(composeQuorum(onlyViaRelay, { size: 3 }).ok).toBe(false)
  })

  it('lets one seed break a shared dependency among relay-discovered peers', () => {
    const mixed = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-1']),
      { ...cert('n3', 'op-c', ['relay-1']), discoverability: 'seed' as const },
    ]
    expect(sharedRelay(mixed)).toBeNull()
    expect(composeQuorum(mixed, { size: 3 }).ok).toBe(true)
  })
})
