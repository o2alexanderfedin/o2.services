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

/** VER-03, VER-04, VER-08, VER-09, VER-10, VER-12 — criteria 5, 6, 7, and Phase 45's 1–3. */

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
  overrides: {
    readonly userKey?: string
    readonly discoverability?: Discoverability
    readonly issuer?: string
  } = {},
): NodeCertificate {
  return {
    nodeKey,
    userKey: overrides.userKey ?? 'user-alice',
    operatorId,
    discoverability: overrides.discoverability ?? (relayIds.length === 0 ? 'seed' : 'via-relay'),
    relayIds,
    issuedAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    // Overridable since VER-11, and the default stays `'provider'` because that is what
    // every case here has always had: one issuer, which is the fabric's real deployment and
    // therefore the honest default.
    //
    // **Since VER-12 that default is load-bearing rather than incidental.** A pool built
    // from it is a one-issuer pool, so any case composing two or more members from it now
    // meets `single-issuer-quorum` under default rules. Cases below therefore say one of
    // two things out loud: `requireDistinctIssuers: false` where the case's subject is a
    // different rule, or a second issuer where its subject is that independent parties
    // agreed. A case that says neither is asserting what a one-provider fabric really is.
    issuer: overrides.issuer ?? 'provider',
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
    // **Census, VER-12.** This case relied on "two operators is enough for
    // `'independent'`", and that was true of the operator dimension and silent about the
    // provider one — which is what Phase 45 ends. Its subject is the operator rule, so
    // the repair is a second authority rather than a waiver: the number of parties is
    // what the new rule reads, and supplying two restores the case's intent unchanged.
    //
    // The second issuer lands on `n3` and not on `n2`, and that is not cosmetic: `n2` is
    // shadowed by `n1` in the one-per-operator map and never reaches the member set, so
    // an issuer put there would leave the members single-issuer and the case red.
    const result = composeQuorum(
      [
        cert('n1', 'op-a', []),
        cert('n2', 'op-a', []),
        cert('n3', 'op-b', ['relay-1'], { issuer: 'other-provider' }),
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
    //
    // **Census, VER-12.** The case is about path diversity, not about providers, so the
    // issuer refusal is waived to keep its subject visible. It is deliberately NOT given
    // a second issuer: that would change which members the round-robin selects and
    // silently move the `nodeKey` ordering this case asserts.
    const result = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-2']), cert('n3', 'op-c', ['relay-3'])],
      { size: 3, requireDistinctIssuers: false },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toEqual(['n1', 'n2', 'n3'])
    expect(result.members.every((m) => m.discoverability === 'via-relay')).toBe(true)
  })

  it('applies the same rule to seed nodes — no exemption for servers', () => {
    // Symmetry check. What matters is the discovery graph, and a seed node simply
    // has no relay in it.
    //
    // **Census, VER-12.** Both arms waive the issuer refusal: what is being compared is
    // two discovery graphs, and a second provider in either arm would make the pair
    // differ in two things at once.
    const allDirect = composeQuorum(
      [cert('n1', 'op-a', []), cert('n2', 'op-b', []), cert('n3', 'op-c', [])],
      { size: 3, requireDistinctIssuers: false },
    )
    expect(allDirect.ok).toBe(true)

    // One seed member is enough to break a shared discovery dependency.
    const mixed = composeQuorum(
      [cert('n1', 'op-a', ['relay-1']), cert('n2', 'op-b', ['relay-1']), cert('n3', 'op-c', [])],
      { size: 3, requireDistinctIssuers: false },
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

    // **Census, VER-12.** The waived arm carries `requireDistinctIssuers: false` too, and
    // the reason is worth naming: without it the composition is still refused, but by the
    // *issuer* rule — so the case would go on reading `ok === false` while no longer
    // reading anything about `requireIndependentPaths` at all. The guarded arm above needs
    // no waiver, because rule 2 is asked first and still speaks for that fixture.
    const waived = composeQuorum(singleRelay, {
      size: 2,
      requireIndependentPaths: false,
      requireDistinctIssuers: false,
    })
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

    // **Census, VER-12, and this one moved in BOTH ways.** The waiver is needed because
    // the case's subject is the discovery graph and a second issuer would move the
    // `nodeKey` ordering it asserts; the strength then moved from `'independent'` to
    // `'single-issuer'`, because that is what this fixture actually is — three tabs, three
    // operators, one certificate provider. What it was relying on was that three distinct
    // operators make a result independent, and after 2026-09-16 that is not true of this
    // fabric: one party vouched for all three.
    const result = composeQuorum(candidates, { size: 3, requireDistinctIssuers: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toEqual(['n1', 'n2', 'n3'])
    // Three tabs behind three relays are a quorum. Three tabs behind *one* are not,
    // and the case below that one is why.
    expect(result.strength).toBe('single-issuer')
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
    //
    // **Census, VER-12.** Waived, never given a second issuer. The ordering this case
    // reads is the within-group comparator, and a second issuer would put the two
    // candidates in different round-robin groups — which is a different selection and
    // would move `['z9', 'n1']` for a reason that has nothing to do with dependency
    // counts.
    const result = composeQuorum(
      [cert('n1', 'op-b', ['relay-1']), cert('n2', 'op-c', ['relay-1']), cert('z9', 'op-a', [])],
      { size: 2, requireDistinctIssuers: false },
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
    // **Census, VER-12.** This arm relied on "two operators is independent" and now needs
    // to say which two *parties*: its intent is that genuinely independent replicas
    // agreed, so the repair is a second authority. The one-issuer reading of the same
    // shape — two operators, one provider — is `'single-issuer'`, and the VER-12 block
    // below asserts all four labels off one expression.
    expect(
      classifyAttestation([
        cert('n1', 'op-a', []),
        cert('n2', 'op-b', ['relay-1'], { issuer: 'other-provider' }),
      ]),
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
    // **Census, VER-12.** A second authority rather than a waiver: what this arm is for
    // is that a real cross-operator quorum still reads `'independent'`, so the fixture has
    // to be one the label is true of. All three candidates are members at `size: 3`
    // whatever the grouping, so the selection does not move — only the label's input does.
    const three = composeQuorum(
      [
        cert('n1', 'op-a', []),
        cert('n2', 'op-b', ['relay-1'], { issuer: 'other-provider' }),
        cert('n3', 'op-c', ['relay-2']),
      ],
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
    // **VER-12, criterion 3's ordering half.** `'single-issuer'` was inserted BETWEEN the
    // two existing neighbours, and both new inequalities are asserted rather than one:
    // a rank that landed above `'independent'` would still satisfy the second half of the
    // pair, and one that landed below `'owner-domain'` would still satisfy the first.
    // Together they pin the insertion point, and the two assertions above are kept so the
    // old ordering is read by the same case that reads the new.
    expect(attestationRank('owner-domain')).toBeLessThan(attestationRank('single-issuer'))
    expect(attestationRank('single-issuer')).toBeLessThan(attestationRank('independent'))
  })

  it('describes each distinctly, so a reader cannot conflate them', () => {
    // **Re-anchored per literal on 2026-09-16, and the reason is a false green that was
    // one edit away.** This case used to reach into the `descriptions` array by POSITION —
    // the third slot — rather than by strength. Inserting `'single-issuer'` between
    // `'owner-domain'` and `'independent'` moves the single-issuer sentence into that slot,
    // and by Phase 45's specified wording it also contains `separate operators`. So the
    // assertion would have stayed GREEN while silently testing a different strength, and
    // `'independent'` would have been left with no content assertion at all in the very
    // phase that is about it. Every assertion below names its own strength instead, which
    // is the only anchoring an insertion cannot move.
    expect(describeAttestation('owner-attested')).toContain('not independently verified')
    expect(describeAttestation('owner-domain')).toContain('not across operators')
    // The new sentence must name WHICH dimension fell short — criterion 5. A reader who
    // sees `single-issuer` and only `separate operators` cannot tell whether the operators
    // or the providers were the shortfall, so both halves are asserted.
    expect(describeAttestation('single-issuer')).toContain('separate operators')
    expect(describeAttestation('single-issuer')).toContain('one certificate provider')
    expect(describeAttestation('independent')).toContain('separate operators')

    const descriptions = (
      ['owner-attested', 'owner-domain', 'single-issuer', 'independent'] as const
    ).map(describeAttestation)
    expect(new Set(descriptions).size).toBe(4)
    // **The substring property, asserted because a surface depends on it.**
    // `bench-attestation.node.test.ts:544` asserts a rung's line contains NONE of the
    // sentences, one strength at a time — so a `single-issuer` sentence that contained the
    // `independent` one would make that check report a strength the driver never printed.
    expect(describeAttestation('single-issuer')).not.toContain(describeAttestation('independent'))
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

    // **Census, VER-12.** A second authority: the pair below exists to show two receipts
    // that differ only in strength, and the stronger one has to be a fixture the stronger
    // label is true of — two operators AND two providers.
    const independent = attestationReceipt([
      cert('n1', 'alice-op', []),
      cert('n2', 'bob-op', ['relay-1'], { issuer: 'other-provider' }),
    ])
    expect(independent.strength).toBe('independent')
    // Two replicas either way — the count alone cannot distinguish them, which is
    // exactly why the label has to travel with the result.
    expect(independent.replicas).toBe(ownerDomain.replicas)
    expect(attestationRank(independent.strength)).toBeGreaterThan(attestationRank(ownerDomain.strength))
  })

  it('names the providers that vouched for the members, which is one on this fabric', () => {
    // VER-11 reported the issuer dimension; VER-12 acts on it. This case is where the
    // change is visible as a change, so both readings are kept side by side.
    const oneProvider = attestationReceipt([
      cert('n1', 'alice-op', []),
      cert('n2', 'bob-op', ['relay-1']),
    ])
    // **Two operators and ONE issuer, and the receipt says both.** Before this field the
    // strength alone was the whole story, and `'independent'` on this set was true about
    // operators and said nothing about how many parties an attacker would have to reach.
    expect(oneProvider.operators).toHaveLength(2)
    expect(oneProvider.issuers).toEqual(['provider'])
    // **CENSUS ENTRY — this line read `'independent'` until 2026-09-16, and it is the
    // sharpest one in the file.** What it was relying on: that two distinct operators are
    // two independent parties. That was never true of a fabric where one provider mints
    // both, which is what the owner ruled this fabric is (`.planning/OWNER-ACTIONS.md`
    // §3c). The label now says what the set is.
    expect(oneProvider.strength).toBe('single-issuer')

    const twoProviders = attestationReceipt([
      cert('n1', 'alice-op', []),
      cert('n2', 'bob-op', ['relay-1'], { issuer: 'other-provider' }),
    ])
    // Sorted and de-duplicated, as `operators` and `userKeys` are, so a receipt reads the
    // same whatever order the replicas answered in.
    expect(twoProviders.issuers).toEqual(['other-provider', 'provider'])
    expect(twoProviders.strength).toBe('independent')

    // **The assertion here was INVERTED, not extended, and that inversion is the phase.**
    // It read `expect(twoProviders.strength).toBe(oneProvider.strength)` — *"the strength
    // is UNCHANGED across the pair, which is what makes this field worth carrying rather
    // than inferring"*. That sentence was the honest description of Phase 44, where the
    // dimension was visible and inert. It is false now: the two sets differ in exactly one
    // input and the strength follows it, which is the whole of VER-12. Written as literals
    // on both sides above, and compared by rank here, so neither side can be recomputed
    // from the thing under test.
    expect(twoProviders.strength).not.toBe(oneProvider.strength)
    expect(attestationRank(twoProviders.strength)).toBeGreaterThan(
      attestationRank(oneProvider.strength),
    )
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

    //
    // **Census, VER-12.** Waived. Every `composeQuorum` call in this block is about the
    // `seed` reading of `sharedRelay`, and the issuer refusal would answer for all of them
    // at once — which would leave the block green while reading nothing about seeds.
    expect(sharedRelay(seedsAdvertising)).toBeNull()
    expect(composeQuorum(seedsAdvertising, { size: 3, requireDistinctIssuers: false }).ok).toBe(true)
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
    // Census, VER-12 — waived; the subject is the seed reading of rule 2.
    expect(composeQuorum(mixed, { size: 3, requireDistinctIssuers: false }).ok).toBe(true)
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
    //
    // **Census, VER-12.** Both arms waive the issuer refusal, and the control arm is why
    // it matters: its whole job is to compose, so that the refusal below can only have
    // come from the mapping. Under the default issuer rule it would refuse for an
    // unrelated reason and the pair would stop being a comparison.
    expect(sharedRelay(seedIsTheRelay)).toBeNull()
    expect(composeQuorum(seedIsTheRelay, { size: 3, requireDistinctIssuers: false }).ok).toBe(true)

    // With it: the same three certificates, refused, and named by the relay's peer id.
    expect(sharedRelay(seedIsTheRelay, peerIdOf)).toBe('relay-1')
    const refused = composeQuorum(seedIsTheRelay, { size: 3, peerIdOf, requireDistinctIssuers: false })
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
    // Census, VER-12 — waived; the subject is the boundary of rule 2's second arm.
    expect(
      composeQuorum(oneSurvivor, { size: 4, peerIdOf, requireDistinctIssuers: false }).ok,
    ).toBe(true)
  })
})

/**
 * VER-12 — independence is bounded by the number of PROVIDERS an attacker must subvert.
 *
 * Phase 45 criteria 1, 2 and the ordering half of 3. The owner ruled one certificate
 * provider on 2026-09-16 (`.planning/OWNER-ACTIONS.md` §3c), so on this fabric the
 * strongest label a result can carry is `'single-issuer'` and `'independent'` is
 * unreachable until a second provider exists. The rule nevertheless ships at full
 * strength — `requireDistinctIssuers` defaults true — because a default relaxed while
 * waiting for a second provider would report exactly the independence this phase exists
 * to stop claiming.
 *
 * **Three of the cases below are about the WAIVER rather than the rule**, and the
 * distinction they exist to pin is that the waiver turns off the *refusal* and never the
 * *preference*: the issuer-grouped round-robin runs unconditionally, so the day a second
 * provider runs, the live path composes a two-issuer member set with no code change.
 */
describe('VER-12 — a quorum vouched for by one provider is one attacker’s reach', () => {
  it('refuses a one-issuer quorum under the default rule, and composes it when waived', () => {
    // Criterion 1, both halves in one case, because a waiver that is never observed to
    // change an answer is not evidence the option is wired to anything.
    //
    // Three distinct operators — so `insufficient-operators` has nothing to say — all
    // seeds, so rule 2 has nothing to say either. The only thing left that could refuse
    // this pool is the issuer rule, which is what makes the pair a reading of it.
    const oneProvider = [
      cert('n1', 'op-a', [], { issuer: 'sole-provider' }),
      cert('n2', 'op-b', [], { issuer: 'sole-provider' }),
      cert('n3', 'op-c', [], { issuer: 'sole-provider' }),
    ]

    const refused = composeQuorum(oneProvider, { size: 3 })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.refusal.kind).toBe('single-issuer-quorum')
    if (refused.refusal.kind !== 'single-issuer-quorum') return
    // Named, not counted. The issuer string is written as a literal on both sides so the
    // assertion cannot be satisfied by reading the value back out of the thing under test.
    expect(refused.refusal.issuer).toBe('sole-provider')
    expect(refused.reason).toContain('sole-provider')
    expect(refused.reason).toContain('one provider vouched for all of them')

    const waived = composeQuorum(oneProvider, { size: 3, requireDistinctIssuers: false })
    expect(waived.ok).toBe(true)
    if (!waived.ok) return
    expect(waived.members).toHaveLength(3)
    // The composition is a real one and reports what it is: separate operators agreed and
    // one provider vouched for all of them.
    expect(waived.strength).toBe('single-issuer')
  })

  it('lets the older refusals speak first for the pools they already spoke for', () => {
    // The precedence, pinned rather than left to chance. Siting the issuer check last is
    // what keeps every pre-existing refusal saying what it always said, and both arms
    // below are single-issuer pools that the new rule would happily have answered for.

    // One operator, one issuer, three slots. `insufficient-operators` is the truer
    // sentence about this pool: it is also a single-issuer pool, but what is actually
    // wrong with it is that one person is trying to fill a quorum alone, and telling
    // them to find a second provider would be advice that does not fix anything.
    const oneOperator = composeQuorum(
      [cert('n1', 'mallory', []), cert('n2', 'mallory', []), cert('n3', 'mallory', [])],
      { size: 3 },
    )
    expect(oneOperator.ok).toBe(false)
    if (oneOperator.ok) return
    expect(oneOperator.refusal.kind).toBe('insufficient-operators')

    // Three operators, one issuer, and every member reachable only through relay-1. Both
    // rules are true of this set; rule 2 answers, because it is asked first.
    const oneRelay = composeQuorum(
      [
        cert('n1', 'op-a', ['relay-1']),
        cert('n2', 'op-b', ['relay-1']),
        cert('n3', 'op-c', ['relay-1']),
      ],
      { size: 3 },
    )
    expect(oneRelay.ok).toBe(false)
    if (oneRelay.ok) return
    expect(oneRelay.refusal.kind).toBe('shared-relay-dependency')
  })

  it('does not refuse a one-member quorum on an issuer ground', () => {
    // **The decision named, so a later reader does not read the absence as an oversight**
    // — `45-CONTEXT.md` §3, ruled rather than discovered during execution.
    //
    // A one-member set claims no independence at all: `classifyAttestation` answers
    // `owner-attested` for it, and the receipt says in words that the result was computed
    // once and not independently verified. Refusing it because one provider vouched for
    // its single member would refuse a composition that never made the claim. So the rule
    // fires only at two or more members, and this is the case that says so.
    //
    // The candidate is a seed. That is load-bearing rather than incidental: rule 2 is
    // asked first and refuses a one-member quorum that hangs off a relay — a case above
    // pins exactly that — so a relay-discovered candidate here would read the path rule
    // instead of the issuer decision this case exists to name.
    const alone = composeQuorum([cert('solo', 'op-a', [])], { size: 1 })
    expect(alone.ok).toBe(true)
    if (!alone.ok) return
    expect(alone.members).toHaveLength(1)
    expect(alone.strength).toBe('owner-attested')
  })

  it('classifies all four strengths off one expression, operators and issuers together', () => {
    // Criterion 2. Asserted as a SET in one case on `reduce-job.test.ts:768-771`'s stated
    // reasoning: either reading alone is satisfied by a constant, and only the four of
    // them together say the value followed its input.
    expect(classifyAttestation([cert('n1', 'op-a', [])])).toBe('owner-attested')
    expect(
      classifyAttestation([cert('n1', 'op-a', []), cert('n2', 'op-a', ['relay-1'])]),
    ).toBe('owner-domain')
    expect(
      classifyAttestation([cert('n1', 'op-a', []), cert('n2', 'op-b', ['relay-1'])]),
    ).toBe('single-issuer')
    expect(
      classifyAttestation([
        cert('n1', 'op-a', []),
        cert('n2', 'op-b', ['relay-1'], { issuer: 'other-provider' }),
      ]),
    ).toBe('independent')
  })

  it('reads one user key enrolled with two providers as owner-domain, not independent', () => {
    // **The awkward case, and nothing in the tree asserted it before Phase 45.** Two
    // certificates, TWO issuers, ONE `operatorId` — one owner who enrolled the same user
    // key with two providers. Criterion 2 asks for both dimensions above one, and this is
    // the arm that says the conjunction really is a conjunction rather than a disjunction
    // wearing an `&&`.
    //
    // It is not `'independent'`, because two providers vouching for one owner's two
    // machines does not make those machines independent of the owner. It is not
    // `'single-issuer'` either — that label says "separate operators, one provider", and
    // here the operators are not separate. `'owner-domain'` is the only true reading, and
    // it falls out of the branch order with no fourth branch.
    const oneOwnerTwoProviders = [
      cert('n1', 'alice-op', [], { issuer: 'provider' }),
      cert('n2', 'alice-op', ['relay-1'], { issuer: 'other-provider' }),
    ]
    expect(new Set(oneOwnerTwoProviders.map((c) => c.issuer)).size).toBe(2)
    expect(new Set(oneOwnerTwoProviders.map((c) => c.operatorId)).size).toBe(1)
    expect(classifyAttestation(oneOwnerTwoProviders)).toBe('owner-domain')
  })

  it('builds the member set ACROSS issuers rather than checking it afterwards', () => {
    // Four candidates, four operators, all seeds — so neither the operator rule nor the
    // path rule has anything to say and the selection is the only thing being read.
    // Three carry `issuer-a` and one carries `issuer-b`, and all four sort ahead of `b9`
    // by the within-group comparator (equal dependency counts, then `nodeKey`).
    //
    // **Two slots. The old `ordered.slice(0, size)` would have returned `['a1', 'a2']`** —
    // both from one provider, a quorum reporting a redundancy that one party's compromise
    // would erase. The round-robin returns one from each group, which is the same shape
    // "no two replicas from the same operator" already has in this file: a property of the
    // construction, not a check bolted on after.
    //
    // The `nodeKey`s are asserted rather than the issuer count, so the case reads the
    // selection and not merely its outcome — a composer that picked `['a1','a2']` and then
    // refused would also produce a two-issuer *pool*.
    const pool = [
      cert('a1', 'op-a1', [], { issuer: 'issuer-a' }),
      cert('a2', 'op-a2', [], { issuer: 'issuer-a' }),
      cert('a3', 'op-a3', [], { issuer: 'issuer-a' }),
      cert('b9', 'op-b9', [], { issuer: 'issuer-b' }),
    ]

    const result = composeQuorum(pool, { size: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.members.map((m) => m.nodeKey)).toEqual(['a1', 'b9'])
    expect(result.strength).toBe('independent')
  })

  it('composes THE SAME spread across issuers when the refusal is waived — the live path', () => {
    // **THE CASE THE LIVE PATH DEPENDS ON, and nothing else in this plan reaches it.**
    // `packages/core/src/job/submit.ts` passes `requireDistinctIssuers: false` — the owner
    // ruled one provider, and a defaulted refusal there would kill redundant verification
    // on every public shard at `redundancy >= 2`. This is that exact configuration.
    //
    // It differs from the case immediately above in **one field**, and that is the point.
    // `45-CONTEXT.md` §1 and the sentence already committed to `.planning/ROADMAP.md` —
    // *"the day a second provider runs, `independent` becomes reachable with no code
    // change"* — both rest on the waiver turning off the REFUSAL and not the PREFERENCE.
    // The grouping must therefore run outside `if (requireDistinctIssuers)`.
    //
    // **Nesting it inside that flag is a natural, tidy-looking edit that nothing else
    // catches.** `tsc` stays clean; the criterion 1 case above still passes, because its
    // waived half uses a ONE-issuer pool where the round-robin degenerates to one group
    // and proves nothing; the two-issuer default case above still passes, because it does
    // not waive. Only a two-issuer pool under the waiver can see it, and the ROADMAP
    // sentence would otherwise become silently false on the only path that runs.
    const pool = [
      cert('a1', 'op-a1', [], { issuer: 'issuer-a' }),
      cert('a2', 'op-a2', [], { issuer: 'issuer-a' }),
      cert('a3', 'op-a3', [], { issuer: 'issuer-a' }),
      cert('b9', 'op-b9', [], { issuer: 'issuer-b' }),
    ]

    const result = composeQuorum(pool, { size: 2, requireDistinctIssuers: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // (a) The load-bearing assertion: the selected keys are named individually, one from
    // each issuer group. Counting issuers would be satisfied by a pool-level fact; naming
    // `a1` and `b9` reads which members the composer actually chose.
    expect(result.members.map((m) => m.nodeKey)).toEqual(['a1', 'b9'])
    expect(result.members.map((m) => m.issuer)).toEqual(['issuer-a', 'issuer-b'])
    // (b) And the label that follows from it, with no code change between here and a
    // two-provider fabric.
    expect(result.strength).toBe('independent')
  })

  it('reaches independent under the DEFAULT rule the day a second provider runs', () => {
    // The ROADMAP sentence in its *refusing* configuration — no waiver anywhere in this
    // case. Two operators, two providers, both seeds: the strictest rule set this module
    // has, and it composes.
    //
    // This is what the phase is built for. On this fabric the case is hypothetical, which
    // is exactly why it is written down: the property that costs nothing to revisit is
    // only worth claiming if something reads it.
    const twoProviders = composeQuorum(
      [
        cert('n1', 'op-a', [], { issuer: 'provider' }),
        cert('n2', 'op-b', [], { issuer: 'other-provider' }),
      ],
      { size: 2 },
    )
    expect(twoProviders.ok).toBe(true)
    if (!twoProviders.ok) return
    expect(twoProviders.strength).toBe('independent')
    expect(new Set(twoProviders.members.map((m) => m.issuer)).size).toBe(2)
  })
})
