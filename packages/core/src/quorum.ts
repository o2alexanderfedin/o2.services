/**
 * Quorum composition and how strongly a result is attested — VER-03, VER-04, VER-08,
 * VER-09, VER-10.
 *
 * Redundancy is only worth something if the replicas can actually fail independently.
 * Three nodes run by one operator are one failure domain and one attacker, however
 * many machines that is, so a quorum is composed under two rules:
 *
 *   1. **No two replicas from the same operator.** Otherwise "3 of 3 agreed" can mean
 *      one person agreeing with themselves.
 *   2. **No single relay whose failure would lose every member.** Not a rule about
 *      kinds of node — **all nodes have equal functionality** and a browser peer fills
 *      any slot a server can. It is a statement about the discovery *graph*: if losing
 *      relay R would take every member with it, then the redundancy was never real.
 *      Three browser peers discoverable through three different relays pass; three
 *      servers published behind one do not. The rule reads the actual discovery paths,
 *      never a node's category.
 *
 * ## Rule 2's sharpest case was invisible to it until 2026-08-14
 *
 * The rule above used to read *"no single relay every member is **discovered
 * through**"*, and `sharedRelay` implemented exactly that: intersect the members'
 * `relayIds`. **That misses the case where the relay is itself a member of the quorum**,
 * which is the browser tier's own topology and the sharpest instance of VER-03 there is.
 *
 * The defect was a namespace mismatch, and it is worth naming precisely because nothing
 * about the code looked wrong. `relayIds` holds **libp2p peer ids** — `fabric-node.ts`
 * and `browser-node.ts` both sign `relayIds: canRelay ? [] : [...relayPeerIds]` — while a
 * member's identity here is its `nodeKey`, an ed25519 public key. Two spellings of one
 * node that never compare equal, so the relay could sit in the member set and no
 * comparison in this file could see that the other members named *it*. Worse, the relay
 * binds a socket, so it enrols `discoverability: 'seed'`, `dependenciesOf` answered `[]`
 * for it, and the function returned `null` — the quorum composed and reported a
 * redundancy that one node's failure would erase.
 *
 * `quorum-ui.e2e.test.ts` carried the mistaken reading as a *finding*: "the relay
 * computes, it binds a socket so it enrols `seed`, `composeQuorum` orders seeds first so
 * it is always a member, and `sharedRelay` answers `null` the moment a member is a seed.
 * That is the rule being *right*, not silent." **It was silent.** A seed's own
 * reachability does not depend on a relay, which is why counting its advertisement
 * relays would be wrong — but *being* the relay is not a dependency on one, it is being
 * the thing everyone else depends on, and losing it loses them anyway.
 *
 * The fix is a mapping, supplied by the caller because core cannot import libp2p: an
 * optional `peerIdOf` that answers a certificate's peer id. Absent, this file behaves
 * exactly as it did — which is what keeps `attestationReceipt` and every pure-core
 * caller reading the same rule they always read.
 *
 * ## The third rule that was here, and why it is not — retracted 2026-08-03
 *
 * Between 2026-08-02 and 2026-08-03 a rule 3 stood here: at least one member whose
 * `discoverability` is `'seed'`, refused otherwise with a kind
 * `no-direct-discovery-path`. It is recorded rather than quietly deleted, because the
 * derivation that produced it is the kind this file exists to prevent.
 *
 * **It keyed on node kind, which `STATE.md:479-480` forbids outright:** *"if a
 * decision keys on node kind, it is wrong — the only legitimate use is
 * shared-dependency analysis over the discovery graph."* Rule 2 **is** that analysis.
 * A seed requirement is not a narrower version of it; it is a node class wearing a
 * discovery field's clothes, and naming the refusal after a missing *path* did not
 * change what the predicate read. The counter-example was already in the repository:
 * a browser peer dialled at its `/p2p-circuit/webrtc` address ran half of a
 * 2×-redundant job in Phase 3. A relay-discovered peer has held a verification slot
 * here. The relay is a signalling channel for registration and discovery, not a data
 * path, and it drops out once the peers connect.
 *
 * **What VER-03 actually asks for.** Owner ruling 2026-08-03: `backbone-anchored`
 * describes the **replica**, not the node. A quorum is anchored when at least one
 * copy of its result is pinned somewhere durable, so the verification outlives the
 * nodes that produced it. That is a **storage** property, not a discovery one, and
 * three tabs behind one relay compose a perfectly good quorum provided one of them
 * pins its result durably.
 *
 * **It cannot be checked here, and nothing below pretends to.** This function runs
 * *before* execution and takes `NodeCertificate[]`. Durability of a result is a fact
 * that only exists *after* one, and no field on a certificate says whether a node
 * pins durably. A precondition on the composer could at best read a *claim*, and this
 * repository has already ruled against exactly that shape — see `discovery.ts`'s
 * owner ruling D1 on why provider records are computed at ask time rather than
 * announced: *a node that evicts a block still reads as a provider until something
 * retracts the announcement.* A node that claimed durable pinning and then evicted
 * would read as an anchor on identical terms. **VER-03's durability half is therefore
 * unimplemented**, deliberately, and belongs where a result is pinned rather than where
 * a quorum is chosen.
 *
 * **Read that sentence as scoped, because an earlier draft of it was not, and the
 * overstatement governed a decision.** It said flatly *"VER-03 is therefore
 * unimplemented"*, and an executor reading it declined to tick the requirement at all.
 * VER-03's wording in `REQUIREMENTS.md` is *"no verification quorum rests on a single
 * shared reachability dependency, so eclipsing a quorum requires compromising more than
 * one of them"* — eclipse resistance — and that half **is** implemented, below, as rule
 * 2. Two halves, one open and one closed; neither sentence may stand in for both. This
 * phase has already retracted one rule that entered the tree as proposal → docblock →
 * implementation, and a comment governing a scoring decision is the same failure wearing
 * different clothes.
 *
 * ## Attestation strength is a label, not a footnote
 *
 * Sovereign data cannot be verified across operators — pinning it to one owner removes
 * the second independent executor by construction. So some results are weaker than
 * others, and criterion 7 requires that a reader can never mistake which:
 *
 * | Strength | Meaning |
 * |---|---|
 * | `independent` | replicas from ≥2 distinct operators agreed — the strong claim |
 * | `owner-domain` | ≥2 of *one owner's* nodes agreed; independent of hardware, not of the owner |
 * | `owner-attested` | one node ran it; the owner's word, unverified |
 *
 * These are three values of one discriminated union rather than a boolean plus a
 * comment, so every site that reports a result has to name which it has.
 *
 * Pure module.
 */

import type { NodeCertificate } from './enrollment.ts'
import type { PublicKeyHex } from './capability.ts'

/**
 * How much a result's agreement is actually worth.
 *
 * Ordered weakest to strongest by `attestationRank`, so comparisons never depend on
 * remembering the order of a string union.
 */
export type AttestationStrength = 'owner-attested' | 'owner-domain' | 'independent'

/** Higher is stronger. Exposed so callers compare by rank, not by string. */
export function attestationRank(strength: AttestationStrength): number {
  switch (strength) {
    case 'owner-attested':
      return 0
    case 'owner-domain':
      return 1
    case 'independent':
      return 2
  }
}

/** A one-line description fit to surface next to a result. */
export function describeAttestation(strength: AttestationStrength): string {
  switch (strength) {
    case 'owner-attested':
      return 'owner-attested — computed once by the data owner and not independently verified'
    case 'owner-domain':
      return 'owner-domain agreement — replicated across the owner’s own nodes, not across operators'
    case 'independent':
      return 'independently verified — replicas from separate operators agreed'
  }
}

export interface QuorumRules {
  /** Replicas wanted. */
  readonly size: number
  /**
   * Refuse a quorum whose members all depend on one relay. Defaults to true.
   *
   * Turn off only when the shared dependency is acceptable — a single-relay test
   * fixture, say. It is on by default because a quorum with a common single point of
   * failure reports redundancy it does not have.
   *
   * Between 2026-08-02 and 2026-08-03 this flag was near-inert: a retracted third
   * rule refused every set it could have waived, so what it decided was which
   * refusal spoke rather than whether one did. It waives rule 2 again, which is what
   * its name has always said.
   */
  readonly requireIndependentPaths?: boolean
  /**
   * A certificate's **peer id**, when the caller can supply one — VER-03.
   *
   * `relayIds` names relays by peer id; a member is identified here by `nodeKey`. Those
   * are two spellings of one node that never compare equal, so without this hook the
   * rule cannot see the case where the relay every other member depends on is *itself*
   * a member. See this module's header for what that cost.
   *
   * **A function rather than a `Map<PublicKeyHex, string>`** so this file states what it
   * needs (one answer per certificate) rather than how the caller stores it, and so a
   * caller holding descriptors keyed the other way round pays no re-index. `null` means
   * "this certificate's peer id is not known to me" and is treated as *no match* — never
   * as a match against another unknown.
   *
   * **Optional, and its absence is behaviour rather than a default.** Core cannot import
   * libp2p (`CLAUDE.md`'s one-codebase constraint), so it cannot derive a peer id from a
   * key itself; a caller that has no mapping gets precisely the rule that shipped before
   * this parameter existed, which is what lets `attestationReceipt` and the unit cases
   * below go on reading it unchanged.
   */
  readonly peerIdOf?: (certificate: NodeCertificate) => string | null
}

export type QuorumRefusal =
  | {
      readonly kind: 'insufficient-operators'
      readonly wanted: number
      readonly distinctOperators: number
    }
  | { readonly kind: 'shared-relay-dependency'; readonly relayId: string }
  | { readonly kind: 'no-candidates' }

export type QuorumResult =
  | {
      readonly ok: true
      readonly members: readonly NodeCertificate[]
      readonly operators: readonly string[]
      readonly strength: AttestationStrength
    }
  | { readonly ok: false; readonly refusal: QuorumRefusal; readonly reason: string }

/**
 * Compose a cross-operator verification quorum.
 *
 * Refuses rather than degrades. A quorum that quietly returns two members when three
 * were asked for produces a result labelled as more trustworthy than it is, which is
 * the failure this whole module exists to prevent.
 */
export function composeQuorum(
  candidates: readonly NodeCertificate[],
  rules: QuorumRules,
): QuorumResult {
  const refuse = (refusal: QuorumRefusal, reason: string): QuorumResult => ({ ok: false, refusal, reason })

  if (candidates.length === 0) return refuse({ kind: 'no-candidates' }, 'no candidate nodes')

  const requireIndependentPaths = rules.requireIndependentPaths ?? true

  // One node per operator, chosen deterministically. Taking the first per operator
  // — rather than the first N candidates — is what makes "no two from the same
  // operator" a property of the construction rather than a check bolted on after.
  const perOperator = new Map<string, NodeCertificate>()
  for (const candidate of [...candidates].sort((a, b) => a.nodeKey.localeCompare(b.nodeKey))) {
    if (!perOperator.has(candidate.operatorId)) perOperator.set(candidate.operatorId, candidate)
  }

  const distinct = [...perOperator.values()]
  if (distinct.length < rules.size) {
    return refuse(
      { kind: 'insufficient-operators', wanted: rules.size, distinctOperators: distinct.length },
      `quorum of ${rules.size} needs ${rules.size} distinct operators, found ${distinct.length}`,
    )
  }

  // Fewest discovery dependencies first — a seed depends on none, so it sorts ahead
  // naturally. This is path diversity, not a preference for a kind of node: a peer
  // discoverable through an otherwise-unused relay sorts ahead of a second peer on a
  // relay already represented. A preference, never a requirement — a member set with
  // no directly dialable node in it composes, and a case asserts that it does.
  const ordered = [...distinct].sort(
    (a, b) => a.relayIds.length - b.relayIds.length || a.nodeKey.localeCompare(b.nodeKey),
  )

  const members = ordered.slice(0, rules.size)

  // Rule 2, asked of the members and not of the pool they came from.
  //
  // **It sat on the pool between 2026-08-02 and 2026-08-03**, ahead of a third rule
  // that has since been retracted. That placement was correct while rule 3 stood,
  // because rule 3 admitted only member sets containing a seed and `sharedRelay`
  // answers `null` the moment it sees one — so a check standing after it could never
  // fire again. With rule 3 gone the position is not merely unnecessary, it is a
  // hole, and the measurement is recorded rather than reasoned: a pool of three on
  // relay-1, relay-1 and relay-2 has no shared dependency, and the two members drawn
  // from it at `size: 2` both hang off relay-1. Asked of the pool, that composes and
  // reports a redundancy of two against a single point of failure.
  //
  // The member set is what the caller receives and what the failure domain is a
  // property of. Pool-refusal implies member-refusal — members are a subset, so a
  // relay common to every candidate is common to every member — and the converse is
  // the case above, which is what makes this position strictly the stronger one.
  if (requireIndependentPaths) {
    const shared = sharedRelay(members, rules.peerIdOf)
    if (shared !== null) {
      // Two sentences for one refusal, because the two shapes of it are genuinely
      // different facts and a reader who cannot tell them apart cannot act on either.
      // The *kind* is one — `shared-relay-dependency` — and every test and surface that
      // discriminates does so on the kind, which is why the wording can afford to be
      // specific. The first string is verbatim what shipped before 2026-08-14 and
      // `quorum-agents.node.test.ts:1087` reads it exactly, so the pre-existing case
      // says what it always said.
      const relayIsMember =
        rules.peerIdOf !== undefined && members.some((member) => rules.peerIdOf?.(member) === shared)
      return refuse(
        { kind: 'shared-relay-dependency', relayId: shared },
        relayIsMember
          ? `relay ${shared} is itself a member of the quorum and every other member is discoverable only through it; its failure would lose the whole quorum`
          : `every member of the quorum is discoverable only through relay ${shared}; its failure would lose the whole quorum`,
      )
    }
  }

  return {
    ok: true,
    members,
    operators: members.map((member) => member.operatorId),
    // Derived, not declared. This arm returned the literal `'independent'` from
    // Phase 6 until 2026-08-02 while `classifyAttestation` sat unused two functions
    // below, written in the same file in the same phase to compute exactly this. The
    // constant was right in every case the unit tests reached — one node per
    // operator makes a quorum of two or more genuinely independent — and wrong at
    // size 1, which is one node reporting that separate operators agreed with each
    // other, and wrong for any future caller reaching here with a pool the map does
    // not diversify. A defect that is correct wherever it is looked at is a defect
    // nothing finds.
    strength: classifyAttestation(members),
  }
}

/**
 * A relay whose failure would lose every member, or `null` if their paths are independent.
 *
 * **Two ways a member goes down with relay R**, and the second is why `peerIdOf` exists:
 *
 *   - it is discoverable **only** through R — `discoverability: 'via-relay'` naming R;
 *   - it **is** R — its own peer id is the id the others named.
 *
 * A member that is neither survives R, and one surviving member is enough for the answer
 * to be `null`: the quorum did not rest on a single reachability dependency.
 *
 * `peerIdOf` is optional and defaults to answering `null` for everything, which reduces
 * this to the reading that shipped before 2026-08-14 — the intersection of the members'
 * relay dependencies. `attestationReceipt` below calls it that way deliberately: its
 * `sharedRelay` field describes the certificates of whoever **answered**, a display fact,
 * while the reading VER-03 rests on is the composer's and is where the mapping is passed.
 */
export function sharedRelay(
  members: readonly NodeCertificate[],
  peerIdOf: (certificate: NodeCertificate) => string | null = () => null,
): string | null {
  // A seed has *no* discovery dependency, whatever relays it happens to list.
  //
  // This distinction is the whole correctness of the rule. A seed may advertise
  // through relays as a convenience — more ways to be found — but it stays directly
  // dialable, so losing those relays costs it nothing. Counting them would refuse a
  // perfectly independent quorum: three seeds that share an advertisement channel are
  // not three nodes that vanish together. Only a node whose *sole* discovery path is a
  // relay actually depends on it.
  //
  // Note what is deliberately *not* narrowed here: a `via-relay` member listing two
  // relays would survive losing one of them, yet this counts it as depending on both.
  // That over-refusal predates this function's rewrite — the old intersection had the
  // identical property — and it errs toward refusing a quorum that would have held,
  // which is the safe direction for a rule about redundancy. Changing it is a separate
  // decision and would need its own case.
  const dependsOn = (member: NodeCertificate, relayId: string): boolean =>
    member.discoverability !== 'seed' && member.relayIds.includes(relayId)

  // The second arm. `peerIdOf` answering `null` — the default, and the answer for any
  // certificate the caller cannot place — can never equal a relay id, so an absent
  // mapping leaves `lostWith` exactly equal to `dependsOn` and this whole function
  // exactly equal to the intersection it used to compute.
  const lostWith = (member: NodeCertificate, relayId: string): boolean =>
    dependsOn(member, relayId) || peerIdOf(member) === relayId

  // Only relays somebody actually depends on are candidates. A relay named by nobody
  // cannot lose a quorum, and a member's *own* peer id is not a candidate on its own —
  // a node is not a single point of failure for a quorum it is merely a member of.
  const named = new Set<string>()
  for (const member of members) {
    if (member.discoverability === 'seed') continue
    for (const relayId of member.relayIds) named.add(relayId)
  }

  const fatal = [...named].filter((relayId) => members.every((member) => lostWith(member, relayId)))
  // Sorted so a set with more than one such relay names the same one on every run —
  // the determinism the previous implementation got from sorting its intersection.
  return fatal.sort()[0] ?? null
}

/**
 * Classify how strongly a set of agreeing replicas attests a result.
 *
 * Deliberately derived from the certificates rather than passed in. A caller that
 * could *declare* a result independently verified would eventually declare one that
 * was not.
 */
export function classifyAttestation(
  agreeing: readonly NodeCertificate[],
): AttestationStrength {
  if (agreeing.length <= 1) return 'owner-attested'
  const operators = new Set(agreeing.map((certificate) => certificate.operatorId))
  if (operators.size >= 2) return 'independent'
  // Two or more nodes, one operator: replicated across the owner's own machines.
  // Independent of hardware failure, not of the owner.
  return 'owner-domain'
}

/** A receipt a reader can act on without knowing how the quorum was built. */
export interface AttestationReceipt {
  readonly strength: AttestationStrength
  readonly description: string
  readonly replicas: number
  readonly operators: readonly string[]
  readonly userKeys: readonly PublicKeyHex[]
  /** A relay every replica depended on, or `null` when their paths were independent. */
  readonly sharedRelay: string | null
}

/** Build the receipt that accompanies a result wherever it surfaces. */
export function attestationReceipt(agreeing: readonly NodeCertificate[]): AttestationReceipt {
  const strength = classifyAttestation(agreeing)
  return {
    strength,
    description: describeAttestation(strength),
    replicas: agreeing.length,
    operators: [...new Set(agreeing.map((c) => c.operatorId))].sort(),
    userKeys: [...new Set(agreeing.map((c) => c.userKey))].sort(),
    sharedRelay: sharedRelay(agreeing),
  }
}
