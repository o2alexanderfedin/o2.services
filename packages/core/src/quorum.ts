/**
 * Quorum composition and how strongly a result is attested — VER-03, VER-04, VER-08,
 * VER-09, VER-10.
 *
 * Redundancy is only worth something if the replicas can actually fail independently.
 * Three nodes run by one operator are one failure domain and one attacker, however
 * many machines that is, so a quorum is composed under three rules:
 *
 *   1. **No two replicas from the same operator.** Otherwise "3 of 3 agreed" can mean
 *      one person agreeing with themselves.
 *   2. **No single relay every member is discovered through.** Not a rule about kinds
 *      of node — **all nodes have equal functionality** and a browser peer fills any
 *      slot a server can. It is a statement about the discovery *graph*: if every
 *      member is found only via relay R, then R failing loses the whole quorum, and
 *      the redundancy was never real. Three browser peers discoverable through three
 *      different relays pass; three servers published behind one do not. The rule
 *      reads the actual discovery paths, never a node's category.
 *   3. **At least one member reachable without any relay at all.** VER-03. Rule 2
 *      stops a quorum being lost when *one* relay fails; it says nothing about a
 *      quorum every path into which is a relay. Three peers on three different
 *      relays satisfy rule 2 completely, and whoever holds those three relays still
 *      holds every way of reaching that quorum — so eclipsing it costs no more than
 *      eclipsing the peers one at a time. Requiring one member a newcomer can dial
 *      cold makes an eclipse cost a compromise of the directly dialable node itself.
 *
 *      Like rule 2 this reads the discovery graph and never a node's category. The
 *      marker is `discoverability`, which is a statement about how a node is *found*
 *      and not about what it may do: a Node process that binds no listening address
 *      is `via-relay` exactly as a tab is, and any node that binds one is an anchor.
 *      A relay-discovered peer is not excluded from anything — it fills any slot but
 *      the anchor's, and rule 3 refuses only the set in which *nobody* is dialable.
 *
 * ## Rules 2 and 3 overlap in one direction only, and neither is redundant
 *
 * Rule 3 implies rule 2 over a chosen member set: `sharedRelay` answers `null` the
 * moment it sees a seed, so once rule 3 holds, rule 2 can no longer refuse anything.
 * The converse fails — the three-peers-on-three-relays set above passes rule 2 and
 * fails rule 3 — which is why rule 3 had to be built rather than read out of the
 * `sharedRelay` check that was already here.
 *
 * The consequence is an ordering, not a deletion. Rule 2 is asked of the **candidate
 * pool**, before rule 3 chooses from it. Asked afterwards it could never fire; asked
 * there it still names the one relay a pool hangs off, which is the more specific
 * refusal and the one a caller can act on. Nothing composable is lost by the move: a
 * pool that shares one relay contains no seed, so rule 3 would refuse it anyway.
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
   * Refuse a quorum whose candidates all depend on one relay. Defaults to true.
   *
   * It is on by default because a quorum with a common single point of failure
   * reports redundancy it does not have.
   *
   * **This waives rule 2 only, and rule 3 is not conditioned on it.** The flag
   * excuses a fixture's *topology*; eclipse resistance has no fixture excuse. So a
   * single-relay fixture is refused with it off exactly as with it on — what the
   * flag decides is which rule speaks, `shared-relay-dependency` or
   * `no-direct-discovery-path`. A caller that needs the anchor rule off needs a new
   * named option carrying its own recorded reason, not a wider reading of this one.
   */
  readonly requireIndependentPaths?: boolean
}

export type QuorumRefusal =
  | {
      readonly kind: 'insufficient-operators'
      readonly wanted: number
      readonly distinctOperators: number
    }
  | { readonly kind: 'shared-relay-dependency'; readonly relayId: string }
  /**
   * No candidate can be reached without going through a relay — rule 3.
   *
   * Named for what the candidate set *lacked*, deliberately. A refusal reading as a
   * demand for a kind of node would be the node tier this project does not have,
   * restated as an error string; what is missing here is a discovery path, and any
   * node that binds a listening address supplies one.
   */
  | { readonly kind: 'no-direct-discovery-path'; readonly relayDependent: number }
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

  // Rule 2, asked of the pool rather than of the members chosen below it.
  //
  // The order is load-bearing and the module comment says why: rule 3 admits only
  // member sets containing a seed, and `sharedRelay` answers `null` the moment it
  // sees one, so this check placed after rule 3 could never fire. Asked here it
  // still names the single relay a pool hangs off. It refuses nothing that would
  // otherwise compose — a pool sharing one relay holds no seed, so rule 3 refuses it
  // regardless — and it no longer refuses a pool whose *chosen* members happened to
  // share a relay while the pool held an anchor the old ordering had left out.
  if (requireIndependentPaths) {
    const shared = sharedRelay(distinct)
    if (shared !== null) {
      return refuse(
        { kind: 'shared-relay-dependency', relayId: shared },
        `every candidate is discoverable only through relay ${shared}; its failure would lose the whole quorum`,
      )
    }
  }

  // Fewest discovery dependencies first — a seed depends on none, so it sorts ahead
  // naturally. This is path diversity, not a preference for a kind of node: a peer
  // discoverable through an otherwise-unused relay sorts ahead of a second peer on a
  // relay already represented.
  const ordered = [...distinct].sort(
    (a, b) => a.relayIds.length - b.relayIds.length || a.nodeKey.localeCompare(b.nodeKey),
  )

  // Rule 3, chosen rather than checked.
  //
  // Taking the anchor out of the pool *before* the remaining slots are filled is the
  // same move the per-operator map makes for rule 1: the property holds by
  // construction. Filling `size` slots by the preference above and then asking
  // whether an anchor landed among them would refuse sets that contain one — a seed
  // that advertises through several relays sorts *last* by dependency count, so the
  // preference drops it precisely when it is the only anchor there is. This
  // repository has recorded that shape twice under other names (NET-08, 16-06): a
  // bound applied after the choice has already spent what it was meant to protect.
  //
  // Deterministic by the same tie-break as the preference, because `ordered` is
  // already sorted: fewest dependencies, then node key.
  const anchor = ordered.find((candidate) => candidate.discoverability === 'seed')
  if (anchor === undefined) {
    return refuse(
      { kind: 'no-direct-discovery-path', relayDependent: distinct.length },
      `no candidate can be reached without a relay; all ${distinct.length} are discoverable only through the relays they name, so whoever holds those relays holds every path into the quorum`,
    )
  }

  const members = [anchor, ...ordered.filter((candidate) => candidate !== anchor)].slice(0, rules.size)

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
 * A relay every member is discovered through, or `null` if their paths are independent.
 *
 * A seed node depends on no relay to be found, so its presence alone means there is no
 * single shared discovery path and the answer is `null`.
 */
export function sharedRelay(members: readonly NodeCertificate[]): string | null {
  const first = members[0]
  if (first === undefined) return null

  // A seed has *no* discovery dependency, whatever relays it happens to list.
  //
  // This distinction is the whole correctness of the rule. A seed may advertise
  // through relays as a convenience — more ways to be found — but it stays directly
  // dialable, so losing those relays costs it nothing. Counting them would refuse a
  // perfectly independent quorum: three seeds that share an advertisement channel are
  // not three nodes that vanish together. Only a node whose *sole* discovery path is a
  // relay actually depends on it.
  const dependenciesOf = (member: NodeCertificate): readonly string[] =>
    member.discoverability === 'seed' ? [] : member.relayIds

  let common: string[] = [...dependenciesOf(first)]
  for (const member of members) {
    const relays = dependenciesOf(member)
    if (relays.length === 0) return null
    const lookup = new Set<string>(relays)
    common = common.filter((id) => lookup.has(id))
    if (common.length === 0) return null
  }
  return [...common].sort()[0] ?? null
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
