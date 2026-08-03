import { describe, expect, it } from 'vitest'
import {
  attestationRank,
  attestationReceipt,
  classifyAttestation,
  composeQuorum,
  describeAttestation,
  sharedRelay,
} from './quorum.ts'
import type { Discoverability, NodeCertificate } from './enrollment.ts'

/** VER-03, VER-04, VER-08, VER-09, VER-10 — criteria 5, 6, 7. */

/**
 * A candidate certificate, with its discovery facts stated where the case needs them.
 *
 * `relayIds: []` still means a seed and every existing case relies on that reading, so
 * it stays the default. What is new is `overrides.discoverability`: the combination
 * that matters most to VER-03 — a node that *is* directly dialable and also advertises
 * through relays — cannot be derived from `relayIds` at all, and three cases used to
 * reach it by spreading over the result (`{...cert(…), discoverability: 'seed'}`).
 * Saying it at the call site keeps the fact a case depends on visible in the case,
 * rather than in a shared default that somebody testing something else will change.
 */
function cert(
  nodeKey: string,
  operatorId: string,
  relayIds: readonly string[],
  overrides: { readonly userKey?: string; readonly discoverability?: Discoverability } = {},
): NodeCertificate {
  return {
    nodeKey,
    userKey: overrides.userKey ?? 'user-alice',
    operatorId,
    discoverability: overrides.discoverability ?? (relayIds.length === 0 ? 'seed' : 'via-relay'),
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

  it('does not disqualify relay-discovered peers from the slots of a quorum', () => {
    // The point of the correction this case was written for: browser peers are not
    // disqualified, and fill quorum slots on identical terms.
    //
    // **Fixture widened on 2026-08-02, and the reason is not cosmetic.** It used to
    // be these three alone at `size: 3`. VER-03's anchor rule now refuses a set with
    // no member reachable without a relay, and that refusal is asserted directly in
    // its own case below rather than being absorbed here. Adding a fourth candidate
    // and asking for four keeps all three relay-discovered peers as members, which
    // is the whole of what this case ever claimed.
    const result = composeQuorum(
      [
        cert('n1', 'op-a', ['relay-1']),
        cert('n2', 'op-b', ['relay-2']),
        cert('n3', 'op-c', ['relay-3']),
        cert('n4', 'op-d', []),
      ],
      { size: 4 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.filter((m) => m.discoverability === 'via-relay').map((m) => m.nodeKey)).toEqual([
      'n1',
      'n2',
      'n3',
    ])
    expect(result.members.filter((m) => m.discoverability === 'seed')).toHaveLength(1)
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

  it('can be waived deliberately, and the waiver does not reach the anchor rule', () => {
    // **Changed on 2026-08-02, and the change is the subject.** This case used to
    // read that a single-relay fixture composes with the flag off. It no longer
    // does — not because the waiver stopped working, but because VER-03's anchor
    // rule is deliberately not conditioned on this flag: the flag excuses a
    // fixture's *topology*, and eclipse resistance has no fixture excuse.
    //
    // What the waiver still decides is which rule speaks. Both refusals stay
    // reachable, and asserting both is what stops either being deleted as redundant.
    const singleRelay = [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-1'])]

    const guarded = composeQuorum(singleRelay, { size: 2 })
    expect(guarded.ok).toBe(false)
    if (guarded.ok) return
    expect(guarded.refusal.kind).toBe('shared-relay-dependency')

    const waived = composeQuorum(singleRelay, { size: 2, requireIndependentPaths: false })
    expect(waived.ok).toBe(false)
    if (waived.ok) return
    expect(waived.refusal.kind).toBe('no-direct-discovery-path')
  })
})

describe('VER-03 — a quorum keeps one member a newcomer can reach without a relay', () => {
  it('refuses a candidate set nothing can be reached in without a relay', () => {
    // **The boundary between rule 2 and rule 3, and the reason neither is
    // redundant.** These three depend on three *different* relays, so `sharedRelay`
    // reports no shared dependency and rule 2 has nothing to say — and yet whoever
    // holds those three relays holds every path into this quorum. Delete rule 3 and
    // this composes, which is exactly what it did until 2026-08-02.
    const candidates = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-2']),
      cert('n3', 'op-c', ['relay-3']),
    ]
    expect(sharedRelay(candidates)).toBeNull()

    const result = composeQuorum(candidates, { size: 3 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('no-direct-discovery-path')
    if (result.refusal.kind !== 'no-direct-discovery-path') return
    expect(result.refusal.relayDependent).toBe(3)
    expect(result.reason).toContain('without a relay')
  })

  it('chooses the anchor before the other slots rather than checking after', () => {
    // The seed here advertises through three relays, so fewest-dependencies-first
    // sorts it **last** and the three relay-discovered peers ahead of it. Filling
    // the slots by that preference and *then* looking for an anchor would refuse a
    // set that plainly contains one — a bound applied after the choice has already
    // spent what it was meant to protect. Delete rule 3 and this still composes,
    // but with no seed among its members, which is the reading that matters.
    const result = composeQuorum(
      [
        cert('n1', 'op-a', ['relay-1']),
        cert('n2', 'op-b', ['relay-2']),
        cert('n3', 'op-c', ['relay-3']),
        cert('n4', 'op-d', ['relay-4', 'relay-5', 'relay-6'], { discoverability: 'seed' }),
      ],
      { size: 3 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toContain('n4')
    // It leads the members, because it was chosen first and not filtered in.
    expect(result.members[0]?.nodeKey).toBe('n4')
    // …and it is the one the existing preference would have dropped: sorted by
    // dependency count alone it comes last of the members it is now first of.
    expect(
      [...result.members].sort((a, b) => a.relayIds.length - b.relayIds.length).at(-1)?.nodeKey,
    ).toBe('n4')
  })

  it('composes when the anchor is also what the existing ordering would have picked', () => {
    // The ordinary case, recorded rather than assumed. A seed usually lists no
    // relays, so fewest-dependencies-first puts it first anyway and the two
    // orderings agree. Nothing here would fail if rule 3 were deleted — which is
    // precisely why the case above it exists, and why this one must not be mistaken
    // for evidence that the rule is implemented.
    const result = composeQuorum(
      [cert('n1', 'op-a', []), cert('n2', 'op-b', ['relay-1']), cert('n3', 'op-c', ['relay-2'])],
      { size: 3 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members[0]?.nodeKey).toBe('n1')
    expect(result.members.filter((m) => m.discoverability === 'seed')).toHaveLength(1)
  })

  it('asks for the anchor at size 1 too, where a quorum is one node', () => {
    // Stated uniformly so the function stays total. Whether one replica is a
    // verification quorum at all is a question for whoever composes it, not for
    // this function — and a size-1 composition with no directly dialable member is
    // a result nobody else can reach the producer of.
    //
    // Two candidates for one slot, deliberately: rule 2 is asked first, and a pool
    // of one relay-dependent node shares a relay with itself, so a single-candidate
    // fixture would be refused for the other reason and this case would be reading
    // rule 2's answer while claiming to read rule 3's.
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-2'])],
      { size: 1 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('no-direct-discovery-path')
    // Delete rule 3 and this composes a one-node quorum nobody can dial cold.
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

  it('composes a quorum whose strength its own members support, not a constant', () => {
    // **The defect this replaces.** `composeQuorum`'s ok arm returned the literal
    // `'independent'` for every quorum it ever composed, and `classifyAttestation`
    // — written in the same file, in the same phase, to compute exactly this — was
    // never called from it. The constant was right in every case the other cases
    // here reach, because one node per operator makes a quorum of two or more
    // genuinely independent, and wrong at one: a single node reporting that
    // separate operators agreed with each other.
    const alone = composeQuorum([cert('solo', 'op-a', [])], { size: 1 })
    expect(alone.ok).toBe(true)
    if (!alone.ok) return
    expect(alone.members).toHaveLength(1)
    expect(alone.strength).toBe('owner-attested')

    // …and a real cross-operator quorum still reads independent, so the fix is a
    // correction at one point rather than a downgrade applied everywhere.
    const three = composeQuorum(
      [cert('n1', 'op-a', []), cert('n2', 'op-b', ['relay-1']), cert('n3', 'op-c', ['relay-2'])],
      { size: 3 },
    )
    expect(three.ok).toBe(true)
    if (!three.ok) return
    expect(three.strength).toBe('independent')
    // Pinned to the classifier rather than to a second copy of its answer: restore
    // the constant and this fails at the size-1 reading above, where the two differ.
    expect(three.strength).toBe(classifyAttestation(three.members))
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
      cert('n1', 'op-a', ['relay-1'], { discoverability: 'seed' }),
      cert('n2', 'op-b', ['relay-1'], { discoverability: 'seed' }),
      cert('n3', 'op-c', ['relay-1'], { discoverability: 'seed' }),
    ]

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
      cert('n3', 'op-c', ['relay-1'], { discoverability: 'seed' }),
    ]
    expect(sharedRelay(mixed)).toBeNull()
    expect(composeQuorum(mixed, { size: 3 }).ok).toBe(true)
  })
})
