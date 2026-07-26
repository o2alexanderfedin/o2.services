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
 *   2. **At least one backbone-anchored replica.** Not because edge nodes are worth
 *      less — a browser peer is a full peer, and one ran half of a 2×-redundant job
 *      across devices in Phase 3. The reason is narrower and is about *reachability
 *      under failure*: every edge node is reachable only through a relay, so a quorum
 *      composed entirely of them shares a single dependency, and a relay outage takes
 *      the whole quorum with it. One directly-dialable member removes that shared
 *      failure. It is a durability rule, not a caste rule.
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
  /** Require at least one `backbone` replica. Defaults to true. */
  readonly requireBackboneAnchor?: boolean
}

export type QuorumRefusal =
  | {
      readonly kind: 'insufficient-operators'
      readonly wanted: number
      readonly distinctOperators: number
    }
  | { readonly kind: 'no-backbone-anchor' }
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

  const requireAnchor = rules.requireBackboneAnchor ?? true

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

  // Backbone first only so the anchor requirement is met by ordering rather than by
  // a retry loop. Beyond satisfying that one rule, edge nodes are equal members and
  // fill the remaining slots on the same terms.
  const ordered = [...distinct].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'backbone' ? -1 : 1
    return a.nodeKey.localeCompare(b.nodeKey)
  })
  const members = ordered.slice(0, rules.size)

  if (requireAnchor && !members.some((member) => member.role === 'backbone')) {
    return refuse(
      { kind: 'no-backbone-anchor' },
      'quorum contains no backbone-anchored replica; edge-only quorums are refused',
    )
  }

  return {
    ok: true,
    members,
    operators: members.map((member) => member.operatorId),
    strength: 'independent',
  }
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
  readonly backboneAnchored: boolean
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
    backboneAnchored: agreeing.some((c) => c.role === 'backbone'),
  }
}
