/**
 * Enrollment and node identity — AUTH-01, AUTH-02, AUTH-04, AUTH-05.
 *
 * A fabric of volunteer nodes has to answer two questions about a stranger: *is this
 * a real node*, and *whose is it*. A certificate the node carries answers the first
 * outright and the second only as far as the issuer is trusted — see below — and
 * neither costs a network call at verification time.
 *
 * ## What `userKey` is evidence of, exactly
 *
 * Issuance requires the named user's own signature (`ownerProof`) over the same
 * challenge the node signs, so a certificate **cannot be obtained** for a user who
 * did not consent. That is the fix for a defect where anyone could obtain a
 * provider-signed certificate naming any victim's user key, which additionally burned
 * the victim's rate-limit window because the limiter keys on that field.
 *
 * But `verifyCertificate` cannot check that binding, because `ownerProof` is not
 * *in* the certificate. A relying party therefore trusts `certificate.userKey`
 * exactly as far as it trusts the issuer, and no further. Carrying the proof inside
 * the certificate is the next step and is not folded in here: it changes `payloadOf`
 * and therefore the signed shape of every certificate in this repository.
 *
 * ## The replay gap, stated rather than left to be found
 *
 * `possessionChallenge` encodes `{purpose, nodeKey, userKey}` and nothing else — no
 * nonce, no validity window. A captured `(nodeKey, proofOfPossession, userKey,
 * ownerProof)` tuple stays valid forever and can be resubmitted to consume the
 * victim's window. That is the same denial as before, now requiring the attacker to
 * first observe one real enrollment of that node. Closing it means a validity window
 * inside the challenge checked against `enrol`'s `now`, or per-`nodeKey` idempotent
 * issuance; both change the limiter's semantics and belong to their own requirement.
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
import { NotEncodableError, encodeCanonical } from './canonical/encode.ts'
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
  if (!encoded.ok) throw new NotEncodableError('certificate', encoded.error)
  return encoded.bytes
}

/** The bytes a node signs to prove it holds the private half of `nodeKey`. */
export function possessionChallenge(nodeKey: PublicKeyHex, userKey: PublicKeyHex): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({ purpose: 'o2-enrol', nodeKey, userKey })
  if (!encoded.ok) throw new NotEncodableError('challenge', encoded.error)
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
  /**
   * The same challenge bytes, signed by the **user's** private key.
   *
   * Deliberately the identical bytes the node signs. That challenge already states
   * "this node belongs to this user" with its own purpose-based domain separation, so
   * one function keeps producing what both halves sign and there is no second
   * encoding to keep canonical.
   */
  readonly ownerProof: string
}

/**
 * Build a request on the node, signing the challenge locally with both keys.
 *
 * `userKey` is **derived** from `userPrivateKey` rather than accepted as a field, so
 * naming somebody else's user key is not a thing this function can be asked to do.
 * An attacker who wants to try it has to hand-assemble a wire record, which is
 * exactly what `enrol` now refuses.
 */
export function requestEnrollment(
  nodePrivateKey: Uint8Array,
  userPrivateKey: Uint8Array,
  fields: Omit<EnrollmentRequest, 'nodeKey' | 'userKey' | 'proofOfPossession' | 'ownerProof'>,
): EnrollmentRequest {
  const nodeKey = toHex(ed25519.getPublicKey(nodePrivateKey))
  const userKey = toHex(ed25519.getPublicKey(userPrivateKey))
  const challenge = possessionChallenge(nodeKey, userKey)
  return {
    ...fields,
    nodeKey,
    userKey,
    proofOfPossession: toHex(ed25519.sign(challenge, nodePrivateKey)),
    ownerProof: toHex(ed25519.sign(challenge, userPrivateKey)),
  }
}

export type EnrollmentRefusal =
  | { readonly kind: 'bad-proof-of-possession'; readonly nodeKey: PublicKeyHex }
  /** The named user did not sign. A different event from the one above — see `enrol`. */
  | { readonly kind: 'bad-owner-proof'; readonly userKey: PublicKeyHex }
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
    // Built **above** both `try`s, and shared by them. `possessionChallenge` throws
    // `NotEncodableError` by design, and inside the `try` that throw would have been
    // caught and reported as `bad-proof-of-possession` — a codec defect in this
    // package accusing the requester of not holding their own key. Out here it
    // propagates under its own name, and the `catch` below is left with exactly the
    // failures it was written for: `fromHex` on a non-hex string, and `ed25519.verify`
    // on a malformed key or signature. Those are the requester's, and only those.
    const challenge = possessionChallenge(request.nodeKey, request.userKey)

    // Possession first. Without it a provider would certify keys the requester does
    // not hold, and could therefore impersonate every node it ever enrolled.
    let holdsKey = false
    try {
      holdsKey = ed25519.verify(fromHex(request.proofOfPossession), challenge, fromHex(request.nodeKey))
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

    // Owner consent second, and **before the limiter is touched**. That ordering is
    // half of what this check is worth: the limiter keys on `request.userKey`, so a
    // cross-user attempt that reached it would consume the victim's window and lock
    // them out of enrolling their own nodes. Verification is pure and cheap, so
    // nothing is lost by doing it first.
    let holdsOwner = false
    try {
      holdsOwner = ed25519.verify(fromHex(request.ownerProof), challenge, fromHex(request.userKey))
    } catch {
      holdsOwner = false
    }
    if (!holdsOwner) {
      return {
        ok: false,
        refusal: { kind: 'bad-owner-proof', userKey: request.userKey },
        reason: `user ${request.userKey} did not consent to node ${request.nodeKey} claiming their key`,
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

  // Above the `try`, not inside it — `payloadOf` throws `NotEncodableError` by
  // design, and a certificate this package cannot encode is not a certificate whose
  // signature was forged. Inside, that throw read as `bad-signature`.
  const payload = payloadOf(certificate)

  let valid = false
  try {
    valid = ed25519.verify(fromHex(certificate.signature), payload, fromHex(certificate.issuer))
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
