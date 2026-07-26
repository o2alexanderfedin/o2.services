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
 *   2. **No single relay every member is discovered through.** Not a rule about kinds
 *      of node — **all nodes have equal functionality** and a browser peer fills any
 *      slot a server can. It is a statement about the discovery *graph*: if every
 *      member is found only via relay R, then R failing loses the whole quorum, and
 *      the redundancy was never real. Three browser peers discoverable through three
 *      different relays pass; three servers published behind one do not. The rule
 *      reads the actual discovery paths, never a node's category.
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
  // relay already represented.
  const ordered = [...distinct].sort(
    (a, b) => a.relayIds.length - b.relayIds.length || a.nodeKey.localeCompare(b.nodeKey),
  )
  const members = ordered.slice(0, rules.size)

  if (requireIndependentPaths) {
    const shared = sharedRelay(members)
    if (shared !== null) {
      return refuse(
        { kind: 'shared-relay-dependency', relayId: shared },
        `every member of the quorum is discoverable only through relay ${shared}; its failure would lose the whole quorum`,
      )
    }
  }

  return {
    ok: true,
    members,
    operators: members.map((member) => member.operatorId),
    strength: 'independent',
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

  // Start from the first member's relays and intersect down. A directly reachable
  // member has none, so it short-circuits: no relay can be common to all.
  let common: string[] = [...first.relayIds]
  for (const member of members) {
    if (member.relayIds.length === 0) return null
    const relays = new Set<string>(member.relayIds)
    common = common.filter((id) => relays.has(id))
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
