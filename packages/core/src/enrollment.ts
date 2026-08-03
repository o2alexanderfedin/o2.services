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
 * **Two budgets, answering different questions.** `maxPerWindow` bounds how many
 * certificates **one user key** may obtain in a window. `maxIssuedPerWindow` bounds how
 * many this provider **will sign in a window at all**, whoever asked. Only the second
 * one bounds an attacker, because nothing in an enrolment request is scarce: `userKey`,
 * `operatorId` and `relayIds` are all requester-chosen, and a fresh user key is one
 * `ed25519.keygen()`. Phase 17 measured that — twenty requests under twenty distinct
 * user keys all succeeded, and deleting the per-user guard left the reading unchanged.
 *
 * **What the aggregate budget buys.** Issuance is finite per provider per window, on a
 * quantity no request field can rotate around; and because both budgets read a ledger
 * the **host** owns rather than this object's heap, a provider that restarts can be
 * handed back everything it already issued.
 *
 * **What it does not buy, in the words that have to keep being used for it: a bound made
 * durable, not a per-identity price.** It does not make one identity cost an attacker
 * something they can pay unilaterally. It makes identities finite per provider per
 * window, and makes exhausting them durable and visible. This repository has twice been
 * burned by a mechanism whose description outran its measurement, and the honest
 * description of this one is that short.
 *
 * **What it costs, accepted deliberately rather than mitigated** (owner decision
 * 2026-08-02). `serveAgent` serves enrolment **unauthenticated**, so anyone who can dial
 * a provider can consume its whole window at one `ed25519.keygen()` per attempt — where
 * before the aggregate budget they could consume only *their own* user key's window. An
 * attacker who does that also denies honest enrolment against that provider for the rest
 * of the window. The architectural answer is the one the whole design rests on: trust is
 * pinned **per verifier**, so several independent providers coexist by construction, a
 * starved one is routed around by trusting or running another, and nothing global has to
 * recover because nothing global was ever agreed. It is **not** a shared list of
 * anything, and a reader reaching for one should be sent back to `19-CONTEXT.md`'s
 * NO BLOCKCHAIN constraint.
 *
 * **And that answer is untested here.** Every fixture in this repository and the demo
 * itself are **single-provider**, so the multi-provider recovery is an argument and not a
 * reading. *Unmeasured is not met* — which applies to a mitigation exactly as much as to
 * a mechanism. No mitigation machinery is built: no proof-of-work at the enrolment frame,
 * no authenticated enrolment, no per-peer quota. The trade was a trade, and the next
 * reader is owed that word rather than a claim of design.
 *
 * **Why a shorter certificate lifetime is not part of this argument** (owner correction
 * 2026-08-02). The attack radius does not pay for renewal churn: results are signed and
 * attributable, integrity rests on N-version comparison rather than on trusting an
 * identity, `composeQuorum` enforces anti-affinity by `operatorId` so N sybils under one
 * operator take exactly one quorum slot, and sovereign data never leaves its owner's
 * node. Revocation is **non-renewal on the certificate's own clock**, not a list and not
 * a shorter clock; `certificateLifetimeMs` keeps its default.
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
  /**
   * This provider has signed its stated number of certificates for this window.
   *
   * **Carries nothing about the requester, and that is the point of it being its own
   * kind.** `rate-limited` names a `userKey` because it *is* about that user; this one
   * is about the provider. A requester who met this did nothing wrong, and an operator
   * who read a user key here would go looking in the wrong place. The next action
   * differs too: a rate-limited requester waits, one who met an exhausted provider
   * finds another.
   */
  | { readonly kind: 'issuance-budget-exhausted'; readonly limit: number; readonly windowMs: number; readonly retryAfterMs: number }

export type EnrollmentResult =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly refusal: EnrollmentRefusal; readonly reason: string }

/**
 * How many certificates one authority will sign in a window, **to anybody**.
 *
 * A required union with a named sentinel rather than an optional number, and the reason
 * is specific to this field: an omitted optional would leave the one mechanism that
 * bounds an attacker switched off with **nothing anywhere failing**. This phase measured
 * that shape twice — 19-01 and 19-13 each planted "make it optional and omit it" and each
 * saw `tsc --noEmit` exit 0 while the behavioural assertion failed. A default here would
 * also be a policy nobody chose. A provider that signs without an aggregate budget has to
 * say so in its own construction.
 */
export type IssuanceBudget =
  /** Certificates this authority will sign per window, whoever asks. */
  | number
  /** This authority signs with no aggregate budget: only the per-user window bounds it. */
  | 'issues-without-an-aggregate-budget'

export interface AuthorityOptions {
  readonly providerPrivateKey: Uint8Array
  /** Certificates one user key may obtain per window. */
  readonly maxPerWindow?: number
  /**
   * Certificates this authority will sign per window in total. See {@link IssuanceBudget}
   * for why this one is required while the per-user limit above is not.
   */
  readonly maxIssuedPerWindow: IssuanceBudget
  /** The window **both** budgets are measured over, so an operator has one period to reason about. */
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
  readonly #maxIssuedPerWindow: IssuanceBudget
  readonly #windowMs: number
  readonly #lifetimeMs: number
  /** Issue timestamps per user key, pruned to the window on each request. */
  readonly #history = new Map<PublicKeyHex, number[]>()

  constructor(options: AuthorityOptions) {
    this.#privateKey = options.providerPrivateKey
    this.#issuer = toHex(ed25519.getPublicKey(options.providerPrivateKey))
    this.#maxPerWindow = options.maxPerWindow ?? 5
    this.#maxIssuedPerWindow = options.maxIssuedPerWindow
    this.#windowMs = options.windowMs ?? 3_600_000
    this.#lifetimeMs = options.certificateLifetimeMs ?? 30 * 24 * 3_600_000
  }

  get issuerKey(): PublicKeyHex {
    return this.#issuer
  }

  /** Certificates issued to this user key inside the current window. */
  issuedWithin(userKey: PublicKeyHex, now: number): number {
    return this.#recentFor(userKey, now).length
  }

  /**
   * Certificates this authority has issued inside the current window, whoever asked.
   *
   * The sibling of {@link issuedWithin}, and it exists for the same reason a refusal
   * carries its own threshold: a provider that cannot report its own budget cannot be
   * measured from outside, and a bound nobody can read is a bound nobody can check.
   */
  issuedToAnybodyWithin(now: number): number {
    return this.#recentForAnybody(now).length
  }

  /** Issue timestamps for one user key, pruned to the window. */
  #recentFor(userKey: PublicKeyHex, now: number): number[] {
    return (this.#history.get(userKey) ?? []).filter((at) => at > now - this.#windowMs)
  }

  /** Issue timestamps for anybody, pruned to the window. */
  #recentForAnybody(now: number): number[] {
    const recent: number[] = []
    for (const times of this.#history.values()) {
      for (const at of times) if (at > now - this.#windowMs) recent.push(at)
    }
    return recent
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

    const recent = this.#recentFor(request.userKey, now)
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

    // The aggregate budget, **after** the per-user window and immediately before
    // signing. Both orderings are correct on state — nothing above writes history, so
    // no refusal consumes anybody's budget — so the choice is purely about **which
    // reason a requester is told when both bind**, and the more specific true statement
    // about *this* request is the right one. Their next actions differ: a requester
    // whose own window is full waits, or uses a second user key of their own; one who
    // met an exhausted provider has to find another provider. Reversing these two would
    // send the first requester after a provider that was never their problem.
    if (this.#maxIssuedPerWindow !== 'issues-without-an-aggregate-budget') {
      const issued = this.#recentForAnybody(now)
      if (issued.length >= this.#maxIssuedPerWindow) {
        const oldest = Math.min(...issued)
        return {
          ok: false,
          refusal: {
            kind: 'issuance-budget-exhausted',
            limit: this.#maxIssuedPerWindow,
            windowMs: this.#windowMs,
            retryAfterMs: oldest + this.#windowMs - now,
          },
          // Names no user key and no node key, deliberately. See the refusal's own
          // docblock: this requester is not what went wrong.
          reason: `this provider has issued ${issued.length} certificates in the last ${this.#windowMs}ms (limit ${this.#maxIssuedPerWindow})`,
        }
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
