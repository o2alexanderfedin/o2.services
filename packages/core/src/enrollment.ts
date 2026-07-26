/**
 * Enrollment and node identity — AUTH-01, AUTH-02, AUTH-04, AUTH-05.
 *
 * A fabric of volunteer nodes has to answer two questions about a stranger: *is this
 * a real node*, and *whose is it*. Both are answered by a certificate the node carries,
 * and neither costs a network call at verification time.
 *
 * **The private key never leaves the device.** `enrol` takes a public key and a
 * self-signed proof of possession; there is no code path here that accepts, transports,
 * or stores a private key. A provider that could issue a certificate without the node
 * proving possession would be able to impersonate every node it ever enrolled.
 *
 * **Verification is offline.** A certificate is a signed statement, checked against a
 * provider key pinned in advance. No live authority is consulted, which matters because
 * a browser tab joining from a coffee shop cannot depend on reaching one, and because
 * an online check would make the authority a target worth attacking.
 *
 * **Certificates chain to a user key.** Several nodes belonging to one person resolve
 * as a replica set (AUTH-05), which is what lets a sovereign task run redundantly
 * inside its owner's own trust domain — the only place redundancy is available to it.
 *
 * ## What "mass fake-node creation is costly" means here, precisely
 *
 * `EnrollmentAuthority` rate-limits issuance per owner over a sliding window. That
 * makes fake nodes *rate-limited*, not *expensive*: an attacker with many owner
 * identities is not slowed, and the ceiling is a policy number rather than a physical
 * one. Making it genuinely costly needs something the attacker must spend — a
 * proof-of-work, a payment, or an out-of-band identity check — and that is a scope
 * decision, not a coding one. The limit here is the enforcement point those would plug
 * into, and the gap is stated rather than papered over.
 *
 * Pure module.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import { fromHex, toHex } from './capability.ts'
import type { PublicKeyHex } from './capability.ts'

/**
 * **All nodes have equal functionality.** The only thing that varies is how a node can
 * be *discovered*.
 *
 * Every node executes tasks, holds blocks, serves records, hosts reduce combines, and
 * takes quorum slots on identical terms. There is no tier and no lesser node anywhere
 * in this codebase. Once two peers are connected they are indistinguishable in what
 * they can do — a browser peer was dialled at its `/p2p-circuit/webrtc` address from
 * another machine in Phase 3 and ran half of a 2×-redundant job.
 *
 * The one genuine difference is narrower than "reachability": a browser cannot bind a
 * listening socket, so **it cannot act as a seed that a newcomer dials cold**. It has
 * no stable address to publish as a bootstrap entry point, and must instead be found
 * through a relay that does.
 *
 *   `seed`       can be dialled directly as a bootstrap entry point
 *   `via-relay`  discoverable only through the relays named in `relayIds`
 *
 * This is a property of *discovery*, not of capability and not of the connection that
 * results from it. The one place it may legitimately affect a decision is
 * shared-dependency analysis: nodes discoverable only through the same relay are found
 * — and lost — together, which is a fact about the discovery path and would be equally
 * true of two servers published behind one bootstrap host.
 */
export type Discoverability =
  /** Dialable directly; usable as a bootstrap entry point. */
  | 'seed'
  /** Discoverable only through the relays named in `relayIds`. */
  | 'via-relay'

/**
 * A provider's signed statement about one node.
 *
 * `operatorId` is deliberately distinct from `ownerId`. An *owner* is whose data it
 * is; an *operator* is who runs the machine. Quorum diversity is about operators —
 * three nodes run by one operator are one failure domain and one attacker, however
 * many owners' data they hold.
 */
export interface NodeCertificate {
  readonly nodeKey: PublicKeyHex
  /** The user key this node belongs to. Several nodes may share one. */
  readonly userKey: PublicKeyHex
  /** Who runs the hardware. The unit of quorum diversity. */
  readonly operatorId: string
  /** How this node can be discovered. Not a capability statement — see above. */
  readonly discoverability: Discoverability
  /**
   * Relays this node depends on to be reachable. Empty when `direct`.
   *
   * Recorded so shared-dependency analysis can be done on the actual dependency
   * graph rather than on a node's category.
   */
  readonly relayIds: readonly string[]
  readonly issuedAt: number
  readonly expiresAt: number
  readonly issuer: PublicKeyHex
  readonly signature: string
}

function payloadOf(certificate: Omit<NodeCertificate, 'signature'>): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    nodeKey: certificate.nodeKey,
    userKey: certificate.userKey,
    operatorId: certificate.operatorId,
    discoverability: certificate.discoverability,
    relayIds: [...certificate.relayIds].sort(),
    issuedAt: certificate.issuedAt,
    expiresAt: certificate.expiresAt,
    issuer: certificate.issuer,
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new Error(`certificate not encodable: ${JSON.stringify(encoded.error)}`)
  return encoded.bytes
}

/** The bytes a node signs to prove it holds the private half of `nodeKey`. */
export function possessionChallenge(nodeKey: PublicKeyHex, userKey: PublicKeyHex): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({ purpose: 'o2-enrol', nodeKey, userKey })
  if (!encoded.ok) throw new Error('challenge not encodable')
  return encoded.bytes
}

/** What a node sends to enrol. Contains a public key and a proof, never a secret. */
export interface EnrollmentRequest {
  readonly nodeKey: PublicKeyHex
  readonly userKey: PublicKeyHex
  readonly operatorId: string
  readonly discoverability: Discoverability
  readonly relayIds: readonly string[]
  /** Signature over `possessionChallenge`, by the node's own private key. */
  readonly proofOfPossession: string
}

/** Build a request on the node, signing the challenge locally. */
export function requestEnrollment(
  nodePrivateKey: Uint8Array,
  fields: Omit<EnrollmentRequest, 'nodeKey' | 'proofOfPossession'>,
): EnrollmentRequest {
  const nodeKey = toHex(ed25519.getPublicKey(nodePrivateKey))
  const challenge = possessionChallenge(nodeKey, fields.userKey)
  return { ...fields, nodeKey, proofOfPossession: toHex(ed25519.sign(challenge, nodePrivateKey)) }
}

export type EnrollmentRefusal =
  | { readonly kind: 'bad-proof-of-possession'; readonly nodeKey: PublicKeyHex }
  | { readonly kind: 'rate-limited'; readonly userKey: PublicKeyHex; readonly limit: number; readonly windowMs: number; readonly retryAfterMs: number }

export type EnrollmentResult =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly refusal: EnrollmentRefusal; readonly reason: string }

export interface AuthorityOptions {
  readonly providerPrivateKey: Uint8Array
  /** Certificates one user key may obtain per window. */
  readonly maxPerWindow?: number
  readonly windowMs?: number
  readonly certificateLifetimeMs?: number
}

/**
 * Issues node certificates, rate-limited per user key.
 *
 * The clock is a parameter rather than a global, so the limiter's behaviour is
 * deterministic in tests and the module stays free of platform time.
 */
export class EnrollmentAuthority {
  readonly #privateKey: Uint8Array
  readonly #issuer: PublicKeyHex
  readonly #maxPerWindow: number
  readonly #windowMs: number
  readonly #lifetimeMs: number
  /** Issue timestamps per user key, pruned to the window on each request. */
  readonly #history = new Map<PublicKeyHex, number[]>()

  constructor(options: AuthorityOptions) {
    this.#privateKey = options.providerPrivateKey
    this.#issuer = toHex(ed25519.getPublicKey(options.providerPrivateKey))
    this.#maxPerWindow = options.maxPerWindow ?? 5
    this.#windowMs = options.windowMs ?? 3_600_000
    this.#lifetimeMs = options.certificateLifetimeMs ?? 30 * 24 * 3_600_000
  }

  get issuerKey(): PublicKeyHex {
    return this.#issuer
  }

  /** Certificates issued to this user key inside the current window. */
  issuedWithin(userKey: PublicKeyHex, now: number): number {
    return (this.#history.get(userKey) ?? []).filter((at) => at > now - this.#windowMs).length
  }

  enrol(request: EnrollmentRequest, now: number): EnrollmentResult {
    // Possession first. Without it a provider would certify keys the requester does
    // not hold, and could therefore impersonate every node it ever enrolled.
    let holdsKey = false
    try {
      holdsKey = ed25519.verify(
        fromHex(request.proofOfPossession),
        possessionChallenge(request.nodeKey, request.userKey),
        fromHex(request.nodeKey),
      )
    } catch {
      holdsKey = false
    }
    if (!holdsKey) {
      return {
        ok: false,
        refusal: { kind: 'bad-proof-of-possession', nodeKey: request.nodeKey },
        reason: `node ${request.nodeKey} did not prove possession of its key`,
      }
    }

    const recent = (this.#history.get(request.userKey) ?? []).filter((at) => at > now - this.#windowMs)
    if (recent.length >= this.#maxPerWindow) {
      const oldest = Math.min(...recent)
      return {
        ok: false,
        refusal: {
          kind: 'rate-limited',
          userKey: request.userKey,
          limit: this.#maxPerWindow,
          windowMs: this.#windowMs,
          retryAfterMs: oldest + this.#windowMs - now,
        },
        reason: `user ${request.userKey} has enrolled ${recent.length} nodes in the last ${this.#windowMs}ms (limit ${this.#maxPerWindow})`,
      }
    }

    const unsigned = {
      nodeKey: request.nodeKey,
      userKey: request.userKey,
      operatorId: request.operatorId,
      discoverability: request.discoverability,
      relayIds: [...request.relayIds].sort(),
      issuedAt: now,
      expiresAt: now + this.#lifetimeMs,
      issuer: this.#issuer,
    }
    const certificate: NodeCertificate = {
      ...unsigned,
      signature: toHex(ed25519.sign(payloadOf(unsigned), this.#privateKey)),
    }

    this.#history.set(request.userKey, [...recent, now])
    return { ok: true, certificate }
  }
}

export type CertificateFailure =
  | { readonly kind: 'untrusted-issuer'; readonly issuer: PublicKeyHex }
  | { readonly kind: 'bad-signature'; readonly nodeKey: PublicKeyHex }
  | { readonly kind: 'expired'; readonly expiresAt: number; readonly now: number }
  | { readonly kind: 'not-yet-valid'; readonly issuedAt: number; readonly now: number }

export type CertificateResult =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly failure: CertificateFailure; readonly reason: string }

/**
 * Verify a node certificate **offline**, against pinned provider keys.
 *
 * No network call, by construction — the function takes the trust anchors as an
 * argument and has nothing to reach out to.
 */
export function verifyCertificate(
  certificate: NodeCertificate,
  trustedIssuers: ReadonlySet<PublicKeyHex>,
  now: number,
): CertificateResult {
  if (!trustedIssuers.has(certificate.issuer)) {
    return {
      ok: false,
      failure: { kind: 'untrusted-issuer', issuer: certificate.issuer },
      reason: `certificate issued by ${certificate.issuer}, which is not a pinned provider`,
    }
  }

  let valid = false
  try {
    valid = ed25519.verify(fromHex(certificate.signature), payloadOf(certificate), fromHex(certificate.issuer))
  } catch {
    valid = false
  }
  if (!valid) {
    return {
      ok: false,
      failure: { kind: 'bad-signature', nodeKey: certificate.nodeKey },
      reason: `certificate for ${certificate.nodeKey} has an invalid signature`,
    }
  }

  if (certificate.issuedAt > now) {
    return {
      ok: false,
      failure: { kind: 'not-yet-valid', issuedAt: certificate.issuedAt, now },
      reason: `certificate is not valid until ${certificate.issuedAt}, now ${now}`,
    }
  }
  if (certificate.expiresAt <= now) {
    return {
      ok: false,
      failure: { kind: 'expired', expiresAt: certificate.expiresAt, now },
      reason: `certificate expired at ${certificate.expiresAt}, now ${now}`,
    }
  }

  return { ok: true, certificate }
}

/** The nodes belonging to one user key — AUTH-05. */
export interface ReplicaSet {
  readonly userKey: PublicKeyHex
  readonly certificates: readonly NodeCertificate[]
  /** True when the owner has two or more live nodes, so redundancy is available. */
  readonly canVerifyWithinOwnerDomain: boolean
}

/**
 * Group verified certificates into per-user replica sets.
 *
 * Only certificates that verify are grouped; an unverifiable one must not be able to
 * inflate an owner's apparent replica count, which would make an owner-attested result
 * look verified.
 */
export function resolveReplicaSets(
  certificates: readonly NodeCertificate[],
  trustedIssuers: ReadonlySet<PublicKeyHex>,
  now: number,
): readonly ReplicaSet[] {
  const byUser = new Map<PublicKeyHex, NodeCertificate[]>()
  for (const certificate of certificates) {
    if (!verifyCertificate(certificate, trustedIssuers, now).ok) continue
    const existing = byUser.get(certificate.userKey)
    if (existing) existing.push(certificate)
    else byUser.set(certificate.userKey, [certificate])
  }

  return [...byUser.entries()]
    .map(([userKey, certs]) => ({
      userKey,
      certificates: [...certs].sort((a, b) => a.nodeKey.localeCompare(b.nodeKey)),
      canVerifyWithinOwnerDomain: certs.length >= 2,
    }))
    .sort((a, b) => a.userKey.localeCompare(b.userKey))
}
