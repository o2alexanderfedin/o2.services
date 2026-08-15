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
    // **Restored on 2026-08-03 to the three-candidate form it held before
    // 2026-08-02.** It was widened to four, one of them a seed, to survive an anchor
    // rule that has since been retracted — see the block below. Widening it was the
    // right move *given* that rule, and it cost the case its subject: with a seed in
    // the members, the claim "a quorum of relay-discovered peers composes" was no
    // longer the thing being read.
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-2']), cert('n3', 'op-c', ['relay-3'])],
      { size: 3 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toEqual(['n1', 'n2', 'n3'])
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
    // **Restored on 2026-08-03.** Between 2026-08-02 and that date this read that a
    // waived single-relay fixture is refused anyway, by an anchor rule the flag was
    // deliberately not allowed to reach. That rule is gone, and with it the only
    // thing that stood between this fixture and a composition — so the flag does
    // what its name and its docblock have always said again.
    //
    // Both halves are asserted, which is one more than this case carried before
    // 2026-08-02: a waiver that is never observed to change an answer is not
    // evidence the option is wired to anything.
    const singleRelay = [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-1'])]

    const guarded = composeQuorum(singleRelay, { size: 2 })
    expect(guarded.ok).toBe(false)
    if (guarded.ok) return
    expect(guarded.refusal.kind).toBe('shared-relay-dependency')

    const waived = composeQuorum(singleRelay, { size: 2, requireIndependentPaths: false })
    expect(waived.ok).toBe(true)
    if (!waived.ok) return
    expect(waived.members.map((m) => m.nodeKey)).toEqual(['n1', 'n2'])
  })
})

/**
 * The retracted anchor rule, and what stands in its place.
 *
 * Between 2026-08-02 and 2026-08-03 this file carried a `VER-03` block asserting a
 * third composition rule: at least one member whose `discoverability` is `'seed'`,
 * refused otherwise with the kind `no-direct-discovery-path`. It is gone, and the
 * cases below are what remain true once it is.
 *
 * **Why it went.** `discoverability === 'seed'` is a decision keyed on node kind, and
 * `STATE.md:479-480` forbids exactly that: *"if a decision keys on node kind, it is
 * wrong — the only legitimate use is shared-dependency analysis over the discovery
 * graph."* Rule 2 is that analysis. A seed requirement is not; it is a node class
 * wearing a discovery field's clothes, and the counter-example was already recorded
 * three lines from the rule — a browser peer dialled at its `/p2p-circuit/webrtc`
 * address ran half of a 2×-redundant job in Phase 3. The relay is a signalling
 * channel for registration and discovery, not a data path, and it drops out once the
 * peers connect.
 *
 * **What VER-03 actually asks for**, owner ruling 2026-08-03: `backbone-anchored`
 * describes the **replica**, not the node — at least one *copy of the result* pinned
 * somewhere durable, so the verification outlives the nodes that produced it. That is
 * a storage property and a fact that only exists *after* execution. `composeQuorum`
 * runs before execution over `NodeCertificate[]`, and no field on a certificate says
 * whether a node pins durably, so the check is not expressible here at all. Nothing
 * below stands in for it. VER-03 is unimplemented, and that is the honest state.
 */
describe('composition never keys on how a node is discovered', () => {
  it('composes a quorum no member of which can be dialled cold', () => {
    // **The counter-example the retracted rule denied.** Three peers, three
    // operators, none directly dialable, each found through a different relay.
    // `sharedRelay` is null — their discovery paths really are independent — so
    // the shared-dependency analysis has nothing to object to, and neither does
    // anything else. Reinstate a seed requirement and this is the first case to
    // redden.
    const candidates = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-2']),
      cert('n3', 'op-c', ['relay-3']),
    ]
    expect(sharedRelay(candidates)).toBeNull()
    expect(candidates.every((c) => c.discoverability === 'via-relay')).toBe(true)

    const result = composeQuorum(candidates, { size: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toEqual(['n1', 'n2', 'n3'])
    // Three tabs behind three relays are a quorum. Three tabs behind *one* are not,
    // and the case below that one is why.
    expect(result.strength).toBe('independent')
  })

  it('refuses a quorum whose own members share a relay the wider pool does not', () => {
    // **This is what decides where rule 2 is asked.** The pool's three candidates
    // do not share a relay — `sharedRelay` over all three is null, because n3 is
    // found through relay-2 — so rule 2 asked of the *pool* passes and the two
    // members it then hands back both hang off relay-1. That composition reports a
    // redundancy of two against a single point of failure, which is the exact thing
    // VER-09 exists to refuse.
    //
    // Asked of the members, the same fixture is refused and names the relay. The
    // member set is what the caller receives and what the failure domain is a
    // property of, so that is where the question belongs.
    const pool = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-1']),
      cert('n3', 'op-c', ['relay-2']),
    ]
    expect(sharedRelay(pool)).toBeNull()

    const result = composeQuorum(pool, { size: 2 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('shared-relay-dependency')
    if (result.refusal.kind !== 'shared-relay-dependency') return
    expect(result.refusal.relayId).toBe('relay-1')
    expect(result.reason).toContain('member')
  })

  it('refuses a one-member quorum that hangs off a single relay', () => {
    // The same reading at the smallest size the function is total at. Two
    // candidates on two relays for one slot: the pool is independent and the one
    // member chosen out of it is not, because a quorum of one has exactly the
    // failure domain of its only member.
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-2'])],
      { size: 1 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('shared-relay-dependency')
  })

  it('prefers the fewest discovery dependencies when filling the slots', () => {
    // The ordering preference, which is production behaviour and is otherwise
    // unpinned now that the anchor selection that used to reorder around it is
    // gone. It is a *preference* — the first case in this block proves a member set
    // with no directly dialable node composes — and this is what it buys.
    //
    // `z9` is named to sort last alphabetically and depends on nothing, so the two
    // orderings disagree and the case can tell them apart. Two slots for three
    // candidates: by dependency count the members are `z9` and `n1`, whose paths are
    // independent. By node key alone they would be `n1` and `n2`, who share relay-1
    // — so the preference is what keeps a composable set out of a refusal here,
    // rather than a cosmetic ordering nothing reads.
    const result = composeQuorum(
      [cert('n1', 'op-b', ['relay-1']), cert('n2', 'op-c', ['relay-1']), cert('z9', 'op-a', [])],
      { size: 2 },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toEqual(['z9', 'n1'])
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

  it('refuses when the seed that broke the dependency IS the relay the others name', () => {
    // VER-03's sharpest case, and the one rule 2 could not see until 2026-08-14.
    //
    // The fixture is the case above with **one** thing added: a statement of which peer
    // id the seed answers to, and it is `relay-1` — the id the other two named. Nothing
    // else moves. The seed is still a seed, still lists no relay of its own, and still
    // depends on nobody to be found; what changed is that it is now *the* thing the
    // other two depend on, so losing it loses all three at once. That is exactly one
    // shared reachability dependency, which is VER-03's sentence.
    //
    // **The three cases above stay green for a reason worth stating rather than
    // observing.** None of them supplies `peerIdOf`, and its absence is not a
    // convenience default — `sharedRelay` reduces to the intersection it always
    // computed, because `null` can never equal a relay id. So they read the identical
    // rule they read before this case existed, and this case's refusal cannot have come
    // from a widened predicate: it can only have come from the mapping.
    const seedIsTheRelay = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-1']),
      cert('n3', 'op-c', [], { discoverability: 'seed' }),
    ]
    const peerIdOf = (certificate: NodeCertificate): string | null =>
      certificate.nodeKey === 'n3' ? 'relay-1' : `peer-${certificate.nodeKey}`

    // Without the mapping: the seed's presence answers `null` — the old reading, kept
    // here as the control so the pair below is a comparison rather than an assertion.
    expect(sharedRelay(seedIsTheRelay)).toBeNull()
    expect(composeQuorum(seedIsTheRelay, { size: 3 }).ok).toBe(true)

    // With it: the same three certificates, refused, and named by the relay's peer id.
    expect(sharedRelay(seedIsTheRelay, peerIdOf)).toBe('relay-1')
    const refused = composeQuorum(seedIsTheRelay, { size: 3, peerIdOf })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.refusal.kind).toBe('shared-relay-dependency')
    if (refused.refusal.kind !== 'shared-relay-dependency') return
    expect(refused.refusal.relayId).toBe('relay-1')
    // The words distinguish this shape from the pre-existing one, whose sentence says
    // every member is discoverable *through* the relay — untrue of a relay that is a
    // member. The kind is what a caller discriminates on; the reason is what a reader
    // gets, and it should not be a sentence that is false about the case it describes.
    expect(refused.reason).toContain('is itself a member of the quorum')
    expect(refused.reason).not.toContain('every member of the quorum is discoverable only through')
  })

  it('does not refuse a member merely for being some peer’s relay when another survives it', () => {
    // The boundary, and without it the case above would pass under a rule that refused
    // any quorum containing a named relay. Four members: the relay `n3`, one peer that
    // depends on it, and one peer — `n4` — that is a seed depending on nobody and is not
    // the relay. Losing `relay-1` costs the quorum two of its four members and leaves
    // `n4` standing, so the redundancy did not rest on a single dependency and the
    // answer is `null`.
    const oneSurvivor = [
      cert('n1', 'op-a', ['relay-1']),
      cert('n2', 'op-b', ['relay-1']),
      cert('n3', 'op-c', [], { discoverability: 'seed' }),
      cert('n4', 'op-d', [], { discoverability: 'seed' }),
    ]
    const peerIdOf = (certificate: NodeCertificate): string | null =>
      certificate.nodeKey === 'n3' ? 'relay-1' : `peer-${certificate.nodeKey}`

    expect(sharedRelay(oneSurvivor, peerIdOf)).toBeNull()
    expect(composeQuorum(oneSurvivor, { size: 4, peerIdOf }).ok).toBe(true)
  })
})
