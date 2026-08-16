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
 * ## The replay gap, and where it was closed
 *
 * `possessionChallenge` encodes `{purpose, nodeKey, userKey}` and nothing else — no
 * nonce, no validity window — so a captured `(nodeKey, proofOfPossession, userKey,
 * ownerProof)` tuple stays valid for that pair **forever**. Anybody who observed one real
 * enrollment held a frame they could resubmit verbatim to spend the provider's budget
 * again. That challenge is deliberately **still** static, and the freshness is a second,
 * separate signature: see {@link ChallengeAnswer}, {@link EnrollmentAuthority.mintChallenge}
 * and {@link EnrollmentAuthority.redeemChallenge}. A provider hands out a nonce, the joiner
 * signs *that* with the same node key, and the provider spends the nonce once.
 *
 * **Where the check runs, said here because it is not here.** `enrol` below verifies who
 * is entitled to a certificate, which is a question about the request alone. Freshness is a
 * property of an **exchange**, and `enrol` has no exchange — it is a pure function of
 * `(request, now)` that an in-process caller invokes with the authority object already in
 * hand, and against such a caller replay protection means nothing: they can simply call it
 * again. The one place a stranger's bytes become a request is `serveAgent`'s `enrol` branch
 * in `@o2/net`, and that branch redeems the challenge before it calls `enrol`. The residual
 * is exact and is not hidden: **a host that wires `enrol` to a transport of its own gets no
 * freshness from this module.** `serveAgent` is the only such wiring in this repository.
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
 * **And half that answer is now a reading. CORRECTED 2026-08-16.** This paragraph opened
 * *"And that answer is untested here. Every fixture in this repository and the demo itself
 * are **single-provider**, so the multi-provider recovery is an argument and not a
 * reading"* — and that became false when `packages/node/src/enrollment-cost.node.test.ts`
 * landed. Its last section spawns a **second** `bin/agent.ts` provider with an issuer key
 * of its own, has the node the exhausted provider refused certified by it, and then reads
 * `verifyCertificate` refusing that certificate `untrusted-issuer` against a peer that
 * pinned only the first. So routing around a starved provider is measured, **and** its
 * cost is measured with it: the peers who are to accept the newcomer must themselves have
 * pinned the provider it went to. The sentence is quoted rather than deleted because it
 * was true when written.
 *
 * **What is still untested is the operational half**, and *unmeasured is not met* applies
 * to a mitigation exactly as much as to a mechanism: nothing shows an operator noticing
 * that a provider is starved, or a fabric re-pinning at scale. No mitigation machinery is
 * built either — no proof-of-work at the enrolment frame, no authenticated enrolment, no
 * per-peer quota; `serveAgent`'s `enrol` branch still takes no authorization step of any
 * kind. The trade was a trade, and the next reader is owed that word rather than a claim
 * of design.
 *
 * **Why a shorter certificate lifetime is not part of this argument** (owner correction
 * 2026-08-02). The attack radius does not pay for renewal churn: results are signed and
 * attributable, integrity rests on N-version comparison rather than on trusting an
 * identity, `composeQuorum` enforces anti-affinity by `operatorId` so N sybils under one
 * operator take exactly one quorum slot, and sovereign data never leaves its owner's
 * node. Revocation is **non-renewal on the certificate's own clock**, not a list and not
 * a shorter clock; `certificateLifetimeMs` keeps its default.
 *
 * Pure module, with **one** stated exception: {@link EnrollmentAuthority.mintChallenge}
 * draws random bytes, because a nonce a caller could predict is not a nonce. Nothing else
 * here reads a clock, a random source, or a platform API — `enrol` still takes `now` as a
 * parameter so the limiter stays deterministic under test.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { NotEncodableError, encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import { fromHex, toHex } from './capability.ts'
import type { PublicKeyHex } from './capability.ts'
import { encodeX509Certificate, encodeX509Tbs } from './x509-encode.ts'
import { decodeX509Certificate, describeX509Failure } from './x509.ts'
import type { X509Failure } from './x509.ts'

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
  /**
   * The same statement, additionally carried as a DER-encoded X.509 v3 certificate —
   * X509-01…07, hex.
   *
   * **Optional, and additive rather than a replacement**, which is 25-CONTEXT.md's own
   * ruling: *"Coexists with the current envelope behind a version tag; X.509 is additive.
   * … A hard replace would break every issued certificate and enrollment itself, for no
   * gain this phase needs."* Its presence is the version tag — a certificate without one
   * is exactly the certificate this repository has always issued, byte-for-byte, because
   * `payloadOf` omits the key entirely when the field is absent rather than encoding a
   * null.
   *
   * **Whoever hands you a certificate chooses whether this field is here, and that is
   * precisely why the check on it is fail-closed.** A peer can attach any bytes it likes.
   * `verifyCertificate` therefore refuses a certificate whose X.509 form does not decode
   * under this profile, does not agree with the envelope field-for-field, or does not
   * carry a signature the named issuer made over its own `TBSCertificate` — it never
   * ignores it, never last-wins it, and never falls back to the envelope alone. Ignoring
   * an unparseable form would make a *malformed* certificate more welcome than an
   * *absent* one, which is backwards for a project whose posture everywhere else is
   * refusal-by-default (`runJob` refuses a module with no pinned record; `serveAgent`
   * refuses a sovereign `combine` by name; the relay admission gate refuses an unknown
   * certificate). Owner ruling, 2026-08-11.
   */
  readonly x509?: string
}

/**
 * The exact bytes a provider signs to make a certificate.
 *
 * **Exported since 2026-08-11, and the reason is worth stating rather than shrugging at.**
 * The X.509 gate below refuses a certificate whose two envelopes disagree, and the case
 * that makes that gate load-bearing rather than decorative is a *pinned provider* that
 * signs a wrong X.509 form — a certificate whose envelope signature is perfectly valid.
 * Nothing can construct one without these bytes. Deriving them a second time in a caller
 * would be a second reading of the signed shape, and a signer and a verifier holding two
 * readings of one shape is precisely the drift `encodeCanonical` exists to prevent. It is
 * **not** exported from `@o2/core`'s barrel: a relying party has `verifyCertificate`, and
 * this is the signing side's own detail.
 */
export function certificatePayload(certificate: Omit<NodeCertificate, 'signature'>): Uint8Array<ArrayBuffer> {
  return payloadOf(certificate)
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
    // Conditionally spread, never `x509: undefined`. Two reasons, and both are load-bearing.
    // **Compatibility:** a certificate with no X.509 form must produce the byte-identical
    // payload it produced before this field existed, or every certificate ever issued by
    // this repository stops verifying. **Integrity:** when the form *is* present it is
    // inside the issuer's own signature, so an attacker cannot graft a different X.509
    // form onto somebody else's envelope and have the envelope still verify.
    ...(certificate.x509 === undefined ? {} : { x509: certificate.x509 }),
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

/**
 * How long a minted challenge stays spendable.
 *
 * Sized against the exchange it bounds and nothing else: one round trip on a fabric whose
 * slowest measured leg is a cold browser↔browser WebRTC handshake (~1.04 s), so a minute
 * is roughly two orders of magnitude of headroom for a joiner that has already dialled.
 * It is **not** a security parameter in the way the nonce is — an unexpired nonce is still
 * single-use — it only bounds how long an unanswered mint sits in the provider's map.
 *
 * Exported as a value because the refusal carries it: a joiner told its challenge went
 * stale needs to know the window it missed, and a threshold readable only from the
 * provider's source is not stated to the peer that hit it.
 */
export const ENROLLMENT_CHALLENGE_TTL_MS = 60_000

/**
 * A provider's one-shot invitation to enrol.
 *
 * `nonce` is 32 bytes from the platform CSPRNG, hex-encoded. Its size is chosen so that
 * *guessing* one is not an attack worth describing; what makes it useful is not secrecy
 * but that the provider **remembers issuing it and spends it once**.
 */
export interface EnrollmentChallenge {
  readonly nonce: PublicKeyHex
  /** After this instant the provider will refuse it. See {@link ENROLLMENT_CHALLENGE_TTL_MS}. */
  readonly expiresAt: number
}

/**
 * The bytes a node signs to show it is answering a challenge **this** provider minted.
 *
 * Separate bytes from {@link possessionChallenge}, deliberately, and the alternative is
 * worth naming because it looks tidier: folding the nonce into the possession challenge
 * would change the signed shape of the one thing every honest node already produces, and
 * `possessionChallenge` is also what `result-attestation.ts` copies its shape from. Two
 * challenges with two purposes keep the *entitlement* question ("does this node hold this
 * key, and did the named user consent") answerable from the request alone, which is what
 * lets `enrol` stay a pure function of `(request, now)`.
 *
 * `nodeKey` and `userKey` are inside because the answer must not be transplantable. An
 * answer that signed only the nonce could be lifted off one request and pasted onto
 * another naming different keys, and the provider would accept it.
 */
export function challengeAnswerBytes(
  nonce: PublicKeyHex,
  nodeKey: PublicKeyHex,
  userKey: PublicKeyHex,
): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({ purpose: 'o2-enrol-challenge', nonce, nodeKey, userKey })
  if (!encoded.ok) throw new NotEncodableError('challenge-answer', encoded.error)
  return encoded.bytes
}

/** A node's answer to one minted challenge. */
export interface ChallengeAnswer {
  /** The nonce being spent — the provider looks this up in what it minted. */
  readonly nonce: PublicKeyHex
  /** Signature over {@link challengeAnswerBytes}, by the node's own private key. */
  readonly proof: string
}

/**
 * Whether a request answers a live challenge, or says by name that it answers none.
 *
 * A required union with an explicit sentinel rather than an optional field, on the same
 * reasoning {@link IssuanceHistory} gives: an omitted optional would let a request that
 * proves nothing about freshness look exactly like one that was never asked to, and the
 * one reader that has to tell them apart would have to guess. The sentinel is what
 * {@link requestEnrollment} produces, because at the moment a node signs its own keys it
 * has not yet spoken to any provider and has no nonce to answer.
 */
export type Freshness =
  | ChallengeAnswer
  /** This request answers no provider's challenge. Refused at any wire boundary. */
  | 'answers-no-challenge'

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
  /**
   * The provider-minted nonce this request spends, or the named admission that it spends
   * none. See {@link Freshness}, and {@link EnrollmentAuthority.redeemChallenge} for who
   * checks it.
   */
  readonly freshness: Freshness
}

/**
 * A request that has been signed but not yet addressed to a provider.
 *
 * It **is** an {@link EnrollmentRequest} — everything an authority needs to decide
 * entitlement is already signed — plus the one thing that can only be done after a
 * provider has spoken: answering the nonce it mints. Modelled as a subtype rather than as
 * a fourth parameter to {@link requestEnrollment} so that the two-round-trip exchange
 * could be introduced without moving the node's private key any closer to the network:
 * `enrolOverRpc` receives the ability to sign one specific challenge, and never the key.
 *
 * **`answering` returns the answer, not a finished request**, and that is load-bearing
 * rather than stylistic. A closure that rebuilt the whole request would snapshot the
 * fields as they were at signing time, so `{...pending, ownerProof: forged}` — how every
 * negative case in this repository is written — would be silently undone on the way to the
 * wire and the case would pass while measuring nothing.
 */
export interface PendingEnrollment extends EnrollmentRequest {
  /** Sign one provider's challenge with the node key this request already names. */
  readonly answering: (challenge: EnrollmentChallenge) => ChallengeAnswer
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
  fields: Omit<
    EnrollmentRequest,
    'nodeKey' | 'userKey' | 'proofOfPossession' | 'ownerProof' | 'freshness'
  >,
): PendingEnrollment {
  const nodeKey = toHex(ed25519.getPublicKey(nodePrivateKey))
  const userKey = toHex(ed25519.getPublicKey(userPrivateKey))
  const challenge = possessionChallenge(nodeKey, userKey)
  return {
    ...fields,
    nodeKey,
    userKey,
    // The sentinel, not a nonce: nothing has been asked of a provider yet. A caller that
    // sends this over a wire is refused by name — see `Freshness`.
    freshness: 'answers-no-challenge',
    proofOfPossession: toHex(ed25519.sign(challenge, nodePrivateKey)),
    ownerProof: toHex(ed25519.sign(challenge, userPrivateKey)),
    answering: (minted) => ({
      nonce: minted.nonce,
      proof: toHex(ed25519.sign(challengeAnswerBytes(minted.nonce, nodeKey, userKey), nodePrivateKey)),
    }),
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
  /**
   * The nonce this request spends is not one this provider is still holding.
   *
   * **One kind for three states, and that is honest rather than lazy**: answered no
   * challenge at all, answered one that expired, and answered one already spent are
   * indistinguishable *to the provider*, because spending a nonce is deleting it. Keeping
   * them apart would mean retaining every nonce ever redeemed — unbounded state, in
   * exchange for telling an attacker which of their guesses was closest.
   *
   * Names no key, for {@link EnrollmentRefusal}'s `issuance-budget-exhausted` reason: a
   * joiner whose challenge went stale did nothing wrong, and the next action is the same
   * in all three cases — ask for a challenge and enrol again. `ttlMs` is carried so that
   * next attempt knows the window it has to answer within.
   */
  | { readonly kind: 'stale-challenge'; readonly ttlMs: number }

export type EnrollmentResult =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly refusal: EnrollmentRefusal; readonly reason: string }

/** The refused half of {@link EnrollmentResult}, named so a refusal can be returned alone. */
export type EnrollmentRefused = Extract<EnrollmentResult, { readonly ok: false }>

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

/**
 * Where an authority's issuance history lives — **the host's, not the authority's**.
 *
 * Both budgets read this. The authority holds no history of its own, which is what lets
 * a provider that restarts be handed back everything it already issued: how a host makes
 * a write durable is the host's problem, on each tier.
 *
 * **Synchronous is a requirement, not a preference.** `packages/net/src/agent.ts` records
 * at its `enrol` branch that `EnrollmentAuthority.enrol` is fully synchronous, *and* that
 * this is **why** the branch takes no capacity slot — nothing can interleave around a
 * synchronous call, so a slot taken there would be a reported bound rather than a
 * measured one. An `await` inside this port would silently invalidate that recorded
 * argument in a file nothing here opens.
 *
 * **Pruning to the window is the authority's, not the ledger's.** A ledger that pruned
 * would need to know `windowMs`, which is the authority's policy — and a host that got it
 * wrong would silently widen or narrow *both* budgets with nothing anywhere failing. So a
 * ledger returns everything it holds and this module filters. The consequence, stated
 * rather than left to be found: an implementation accumulates one timestamp per
 * certificate issued, for as long as it is kept. Compaction is the host's, beside
 * durability, and neither is decided here.
 */
export interface IssuanceLedger {
  /** Every issue timestamp recorded for one user key. Unpruned. */
  issuedTo(userKey: PublicKeyHex): readonly number[]
  /** Every issue timestamp recorded for anybody. Unpruned. */
  issuedToAnybody(): readonly number[]
  /** Record one issuance. Called only after a certificate has been signed. */
  record(userKey: PublicKeyHex, at: number): void
}

/**
 * A host's issuance history, or the named admission that there is not one.
 *
 * The sentinel means *this authority remembers only within this process*, and taking it
 * reproduces the pre-Phase-19 behaviour **exactly** — which is the point of it being a
 * sentinel rather than a default. Phase 17 measured that behaviour as defeating the
 * limit: a second provider process starts with an empty history, so the same user key is
 * accepted again immediately. That is now something a caller has to **ask for by name**.
 *
 * The failure mode a reader must not reintroduce: make this optional and default it to
 * the in-process implementation, and the mechanism degrades to exactly the per-process
 * budget Phase 17 measured as defeated, **with nothing anywhere failing**. That is why it
 * is required, and why a host with nothing durable to offer writes the sentinel rather
 * than omitting a field.
 */
export type IssuanceHistory = IssuanceLedger | 'remembers-only-within-this-process'

/**
 * The window **both** budgets are measured over unless a caller states another.
 *
 * Exported as a value rather than left as a literal in the `??` below, because a **host**
 * needs to read it. {@link IssuanceLedger} says a ledger must not prune — pruning to the
 * window is policy and belongs to the authority — but it also says **compaction is the
 * host's**: an implementation that kept one line per certificate for ever would grow with
 * the provider's whole history rather than with one window. A host that wants to discard
 * what can no longer decide anything has to know which entries those are, and a host that
 * *guessed* would silently widen or narrow both budgets with nothing anywhere failing.
 *
 * So there is one number, read by the default here and by whatever each tier keeps, and the
 * two cannot disagree because there is only one of them. The rule a host must not break is
 * the direction: it may retain **more** than the authority's window and never less.
 */
export const DEFAULT_ISSUANCE_WINDOW_MS = 3_600_000

/** What the sentinel selects: a history that lives and dies with this object. */
class InProcessIssuance implements IssuanceLedger {
  readonly #byUser = new Map<PublicKeyHex, number[]>()
  readonly #anybody: number[] = []

  issuedTo(userKey: PublicKeyHex): readonly number[] {
    return this.#byUser.get(userKey) ?? []
  }

  issuedToAnybody(): readonly number[] {
    return this.#anybody
  }

  record(userKey: PublicKeyHex, at: number): void {
    const existing = this.#byUser.get(userKey)
    if (existing === undefined) this.#byUser.set(userKey, [at])
    else existing.push(at)
    this.#anybody.push(at)
  }
}

export interface AuthorityOptions {
  readonly providerPrivateKey: Uint8Array
  /** Certificates one user key may obtain per window. */
  readonly maxPerWindow?: number
  /**
   * Certificates this authority will sign per window in total. See {@link IssuanceBudget}
   * for why this one is required while the per-user limit above is not.
   */
  readonly maxIssuedPerWindow: IssuanceBudget
  /**
   * Where both budgets read their history from. See {@link IssuanceHistory} for why this
   * is required, and for what the sentinel costs a caller who takes it.
   */
  readonly issuance: IssuanceHistory
  /**
   * The window **both** budgets are measured over, so an operator has one period to reason
   * about. Defaults to {@link DEFAULT_ISSUANCE_WINDOW_MS}, which a durable
   * {@link IssuanceLedger} also reads so its compaction cannot outrun this bound.
   */
  readonly windowMs?: number
  readonly certificateLifetimeMs?: number
  /**
   * How long a minted challenge stays spendable. Defaults to
   * {@link ENROLLMENT_CHALLENGE_TTL_MS}.
   *
   * Optional, unlike {@link AuthorityOptions.issuance} above, and the asymmetry is the
   * point rather than an inconsistency. That field is required because forgetting issuance
   * history **accepts more**: an omitted value would switch a bound off with nothing
   * anywhere failing, which Phase 17 measured. Forgetting a challenge **accepts less** — an
   * unknown nonce is refused — so every way of getting this one wrong, omission included,
   * fails closed. A required sentinel here would be ceremony charged to forty-odd
   * construction sites against a hazard that does not exist.
   */
  readonly challengeTtlMs?: number
  /**
   * Whether this provider additionally mints the X.509 v3 form of every certificate it
   * signs — {@link NodeCertificate.x509}, X509-01…07.
   *
   * **Defaults to omitting it, and the default is about wire cost rather than about
   * confidence in the profile.** The X.509 form is ~550 bytes of DER carried as ~1100
   * characters of hex, against a certificate that measures 612 DAG-CBOR bytes on an
   * attested `exec` reply today (`net/src/protocol.ts`) — so issuing it unconditionally
   * would roughly triple the per-reply certificate cost on a tier whose WebRTC data
   * channel caps a message at 16 KiB. That is a price a provider should choose, not
   * inherit.
   *
   * **The asymmetry with verification is deliberate and is the whole shape of the
   * ruling.** Issuing is opt-in; *checking* is not. `verifyCertificate` refuses a
   * malformed X.509 form on every certificate that carries one, whoever issued it and
   * whatever this option says, because the peer presenting a certificate is the one who
   * decides whether the field is there.
   */
  readonly x509?: 'issues-the-x509-form' | 'omits-the-x509-form'
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
  /** The host's issuance history. **Not this object's** — see {@link IssuanceHistory}. */
  readonly #issuance: IssuanceLedger
  readonly #challengeTtlMs: number
  readonly #issuesX509: boolean
  /**
   * Challenges minted and not yet spent: nonce → the instant it stops being spendable.
   *
   * **This object's own heap, and deliberately not a host port** — the opposite call from
   * {@link IssuanceHistory} one field up, for the opposite reason. Issuance history is
   * handed to the host because a provider that restarts must be given back what it already
   * signed; a restart that forgot it would issue past its budget. A restart that forgets
   * *these* refuses every nonce it minted before going down, and a joiner mid-exchange asks
   * for another one. **Forgetting is the safe direction**, so making it durable would buy
   * nothing and would cost the one thing worth protecting: an outstanding challenge written
   * to disk is an attacker's window widened from a minute to however long that row survives.
   *
   * Same map on both tiers, and that is the browser-tier answer in full: there is no
   * storage port to implement, no IndexedDB row, and nothing for a tab to do differently
   * from a server. A browser provider mints, remembers and spends exactly as this does.
   *
   * Growth is bounded by mint rate × TTL and is pruned on every mint — see
   * {@link EnrollmentAuthority.mintChallenge}.
   */
  readonly #challenges = new Map<PublicKeyHex, number>()

  constructor(options: AuthorityOptions) {
    this.#privateKey = options.providerPrivateKey
    this.#issuer = toHex(ed25519.getPublicKey(options.providerPrivateKey))
    this.#maxPerWindow = options.maxPerWindow ?? 5
    this.#maxIssuedPerWindow = options.maxIssuedPerWindow
    this.#windowMs = options.windowMs ?? DEFAULT_ISSUANCE_WINDOW_MS
    this.#lifetimeMs = options.certificateLifetimeMs ?? 30 * 24 * 3_600_000
    this.#challengeTtlMs = options.challengeTtlMs ?? ENROLLMENT_CHALLENGE_TTL_MS
    this.#issuesX509 = options.x509 === 'issues-the-x509-form'
    this.#issuance =
      options.issuance === 'remembers-only-within-this-process'
        ? new InProcessIssuance()
        : options.issuance
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
    return this.#issuance.issuedTo(userKey).filter((at) => at > now - this.#windowMs)
  }

  /** Issue timestamps for anybody, pruned to the window. */
  #recentForAnybody(now: number): number[] {
    return this.#issuance.issuedToAnybody().filter((at) => at > now - this.#windowMs)
  }

  /**
   * Minted challenges that have not been spent and have not expired.
   *
   * The sibling of {@link issuedToAnybodyWithin}, and it exists for the same stated reason:
   * a provider that cannot report the size of its own state cannot be measured from
   * outside, and a bound nobody can read is a bound nobody can check. It is also the only
   * way a test can see that spending a nonce *removes* it rather than merely refusing it.
   */
  outstandingChallenges(now: number): number {
    let live = 0
    for (const expiresAt of this.#challenges.values()) if (expiresAt > now) live++
    return live
  }

  /**
   * Mint a challenge, remember it, and drop whatever has expired — AUTH-01 freshness.
   *
   * **The one impure function in this module.** `randomBytes` is the platform CSPRNG
   * (`crypto.getRandomValues` on both tiers, present on insecure origins as well as
   * secure ones), and it is here rather than behind a port because a nonce a caller can
   * supply is a nonce an attacker can supply. There is no injectable-seed variant for
   * tests: a test that could fix the nonce would be measuring a different mechanism.
   *
   * **Pruning happens here, not on a timer.** A timer would be a platform dependency in a
   * module that has none, and would run in a browser tab that is not enrolling anybody.
   * Sweeping on mint bounds the map by the mint rate over one TTL, and an authority nobody
   * asks stops growing altogether — which is the correct behaviour and not a coincidence:
   * the sweep is paid for by the request that made it necessary.
   *
   * **Minting is deliberately free and unauthenticated**, matching the enrol branch it
   * serves. See this module's header on the accepted DoS surface: a peer that mints
   * without answering costs this provider 32 random bytes and one map entry for a minute,
   * which is strictly less than the two signature verifications an unanswerable enrolment
   * frame already costs it.
   */
  mintChallenge(now: number): EnrollmentChallenge {
    for (const [nonce, expiresAt] of this.#challenges) {
      if (expiresAt <= now) this.#challenges.delete(nonce)
    }
    const nonce = toHex(randomBytes(32))
    const expiresAt = now + this.#challengeTtlMs
    this.#challenges.set(nonce, expiresAt)
    return { nonce, expiresAt }
  }

  /**
   * Spend the challenge a request answers, or say why it could not be spent.
   *
   * `null` means *spent, proceed* — the caller then calls {@link enrol}, which decides
   * entitlement. Splitting the two is what this module's header explains: freshness is a
   * property of an exchange and `enrol` has no exchange. **A wire boundary must call this
   * first**; `serveAgent`'s `enrol` branch is the only one in this repository that has to.
   *
   * Three orderings here were chosen rather than fallen into:
   *
   * - **Verify the answer's signature before deleting the nonce.** Deleting first would let
   *   anybody holding a live nonce burn it with a junk signature. That is only reachable
   *   for a nonce the attacker minted themselves — which is theirs to waste — but the
   *   cheap ordering is also the correct one.
   * - **Delete on the way to `enrol`, not after it succeeds.** A nonce is spent by being
   *   *answered*, not by being certified. Holding it back on a rate-limited refusal would
   *   leave that request replayable until the TTL ran out, which is the defect in miniature.
   * - **Expiry is checked against the caller's `now`**, the same clock `enrol` is given, so
   *   a test that moves time moves both.
   */
  redeemChallenge(request: EnrollmentRequest, now: number): EnrollmentRefused | null {
    const stale = (why: string): EnrollmentRefused => ({
      ok: false,
      refusal: { kind: 'stale-challenge', ttlMs: this.#challengeTtlMs },
      reason: `enrolment challenge ${why}; ask this provider for another and answer it within ${this.#challengeTtlMs}ms`,
    })

    const { freshness } = request
    if (freshness === 'answers-no-challenge') return stale('was never asked for')

    const expiresAt = this.#challenges.get(freshness.nonce)
    // One reason for both, because the provider genuinely cannot tell them apart: spending
    // a nonce deletes it, so "already used" and "never minted here" are the same lookup.
    if (expiresAt === undefined) return stale('is not one this provider is holding')
    if (expiresAt <= now) return stale('expired')

    let answered = false
    try {
      answered = ed25519.verify(
        fromHex(freshness.proof),
        challengeAnswerBytes(freshness.nonce, request.nodeKey, request.userKey),
        fromHex(request.nodeKey),
      )
    } catch {
      answered = false
    }
    // Not `stale-challenge`: the nonce was live and this is a claim about the *key*, so it
    // is the same event `enrol` reports when possession does not check out. Telling a
    // joiner its challenge went stale when its signature was wrong would send it to fetch
    // another nonce for ever.
    if (!answered) {
      return {
        ok: false,
        refusal: { kind: 'bad-proof-of-possession', nodeKey: request.nodeKey },
        reason: `node ${request.nodeKey} did not prove possession of its key`,
      }
    }

    this.#challenges.delete(freshness.nonce)
    return null
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

    const fields = {
      nodeKey: request.nodeKey,
      userKey: request.userKey,
      operatorId: request.operatorId,
      discoverability: request.discoverability,
      relayIds: [...request.relayIds].sort(),
      issuedAt: now,
      expiresAt: now + this.#lifetimeMs,
      issuer: this.#issuer,
    }
    // Minted **before** the envelope signature, because the X.509 form is inside the
    // payload that signature covers (see `payloadOf`). Signing first and attaching after
    // would produce a certificate whose own issuer had not signed the form it carries —
    // exactly the graft `verifyCertificate`'s gate exists to refuse.
    const unsigned: Omit<NodeCertificate, 'signature'> = this.#issuesX509
      ? { ...fields, x509: toHex(encodeX509Certificate(fields, ed25519.sign(encodeX509Tbs(fields), this.#privateKey))) }
      : fields
    const certificate: NodeCertificate = {
      ...unsigned,
      signature: toHex(ed25519.sign(payloadOf(unsigned), this.#privateKey)),
    }

    // Recorded only on success, and recorded where the **host** can read it. Both halves
    // matter: no refusal consumes anybody's budget, which is what makes the two checks
    // above orderable on reason rather than on state; and a certificate this provider
    // signed is not something a restart may hand back.
    this.#issuance.record(request.userKey, now)
    return { ok: true, certificate }
  }
}

export type CertificateFailure =
  | { readonly kind: 'untrusted-issuer'; readonly issuer: PublicKeyHex }
  | { readonly kind: 'bad-signature'; readonly nodeKey: PublicKeyHex }
  | { readonly kind: 'expired'; readonly expiresAt: number; readonly now: number }
  | { readonly kind: 'not-yet-valid'; readonly issuedAt: number; readonly now: number }
  /**
   * The certificate carries an X.509 form that is not hex at all — refused before a
   * single byte is decoded, let alone parsed. Separate from `x509-profile-refused`
   * because the profile never saw it: there were no bytes to hand it.
   */
  | { readonly kind: 'x509-not-hex' }
  /**
   * The X.509 form decoded far enough to be refused **by name** by the profile. The
   * `profile` field carries `x509.ts`'s own typed refusal unchanged — this is where
   * X509-01, 02, 03, 04, 06 and 07 surface on the trust path, and forwarding rather
   * than re-describing is what keeps one vocabulary for one refusal.
   */
  | { readonly kind: 'x509-profile-refused'; readonly profile: X509Failure }
  /**
   * The X.509 form is a conformant certificate, but not a certificate about *this*
   * node: some field disagrees with the envelope the issuer signed. `field` names which.
   */
  | { readonly kind: 'x509-mismatch'; readonly field: string; readonly envelope: string; readonly presented: string }
  /** The X.509 form's own `signatureValue` is not a signature the named issuer made over its `TBSCertificate`. */
  | { readonly kind: 'x509-bad-signature'; readonly nodeKey: PublicKeyHex }

export type CertificateResult =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly failure: CertificateFailure; readonly reason: string }

/** A human-readable account of a refusal about the X.509 form, naming the offending value. */
function describeX509CertificateFailure(failure: CertificateFailure): string {
  switch (failure.kind) {
    case 'x509-not-hex':
      return 'the certificate carries an x509 field that is not lowercase hex of even length'
    case 'x509-profile-refused':
      return `the certificate's X.509 form is refused by this profile: ${describeX509Failure(failure.profile)}`
    case 'x509-mismatch':
      return `the certificate's X.509 form disagrees with the envelope about ${failure.field}: envelope says ${failure.envelope}, the X.509 form says ${failure.presented}`
    case 'x509-bad-signature':
      return `the X.509 form for ${failure.nodeKey} is not signed by the issuer that signed the envelope`
    default:
      // Unreachable: this describer is only ever called with the four kinds above. Kept
      // total rather than cast, so a fifth X.509 kind added later cannot silently return
      // an empty string.
      return `certificate refused: ${failure.kind}`
  }
}

/**
 * The X.509 form's gate — **fail-closed**, X509-01…07's production caller.
 *
 * ## Why a refusal and never a shrug
 *
 * A certificate arrives from a stranger, and the stranger chooses whether to attach an
 * X.509 form. Three answers were available for one that does not hold up: ignore the
 * field and verify the envelope alone; prefer whichever half verifies; or refuse the
 * certificate outright. The first two are fail-open, and taking either would make this
 * the **only** place in the project where a *malformed* certificate is treated more
 * leniently than an *absent* one — while `runJob` refuses a module with no pinned
 * record, `serveAgent` refuses a sovereign `combine` by name, and the relay admission
 * gate refuses a certificate it does not recognise. Owner ruling, 2026-08-11: refuse.
 * The decoder is bounded and hand-written precisely so that refusing is cheap and total.
 *
 * ## What this catches that the envelope signature does not — the case that makes it
 * load-bearing rather than decorative
 *
 * `payloadOf` puts `x509` inside the issuer's own signature, so a *stranger* who edits
 * the form breaks the envelope signature too, and would be refused a step later anyway.
 * That is not the case this gate is for. The case it is for is a **pinned issuer whose
 * X.509 form is wrong** — malformed, or saying something different from the envelope it
 * is stapled to. That certificate's envelope signature verifies perfectly, every existing
 * check passes, and only this gate notices that the two halves of one statement disagree.
 * A provider is pinned to be believed about *who a node is*; it is not pinned to be
 * well-formed. And the relying party that matters most cannot check the envelope at all:
 * a third party handed only the DER has nothing but this profile, which is the whole
 * reason the profile has to be load-bearing.
 *
 * ## Order inside the gate, and why it is this order
 *
 * The profile decode runs **first**, so all six refusal obligations surface by their own
 * name rather than as a generic disagreement, and so `MAX_CERTIFICATE_BYTES` bounds the
 * parse before any recursive descent happens — the same "cheapest refusal first" ordering
 * `MAX_CHAIN_DEPTH` established at `capability.ts:186-192`. Field agreement runs second,
 * because a conformant certificate about the wrong node is a different complaint from a
 * malformed one. The whole-`TBSCertificate` byte comparison runs third as the catch-all
 * for everything the named fields do not cover — `version`, `serialNumber`, and any
 * encoding difference the profile permits. The X.509 signature runs **last**, because it
 * is the only expensive step and there is no reason to pay for it over bytes already
 * known not to describe this node.
 */
function checkX509Form(certificate: NodeCertificate): CertificateFailure | null {
  const { x509 } = certificate
  if (x509 === undefined) return null

  if (x509.length % 2 !== 0 || !/^[0-9a-f]*$/.test(x509)) return { kind: 'x509-not-hex' }
  const decoded = decodeX509Certificate(fromHex(x509))
  if (!decoded.ok) return { kind: 'x509-profile-refused', profile: decoded.failure }

  const presented = decoded.certificate
  // Whole seconds, because UTCTime carries no milliseconds and the encoder truncates.
  // Comparing at full precision would refuse every certificate whose `issuedAt` is not
  // exactly on a second — i.e. essentially all of them.
  const second = (ms: number): number => Math.floor(ms / 1000) * 1000
  const relayIds = [...certificate.relayIds].sort()

  const disagreements: readonly (readonly [string, string, string])[] = [
    ['subjectPublicKey', certificate.nodeKey, presented.subjectPublicKey],
    ['subject commonName', certificate.nodeKey, presented.subjectCommonName],
    ['issuer commonName', certificate.issuer, presented.issuerCommonName],
    ['userKey', certificate.userKey, presented.userKey],
    ['operatorId', certificate.operatorId, presented.operatorId],
    ['discoverability', certificate.discoverability, presented.discoverability],
    ['relayIds', relayIds.join(' '), [...presented.relayIds].join(' ')],
    ['notBefore', String(second(certificate.issuedAt)), String(presented.notBefore)],
    ['notAfter', String(second(certificate.expiresAt)), String(presented.notAfter)],
  ]
  for (const [field, envelope, shown] of disagreements) {
    if (envelope !== shown) return { kind: 'x509-mismatch', field, envelope, presented: shown }
  }

  // Rebuilt from the envelope and compared byte-for-byte. This is what covers everything
  // the named fields above do not — and it is only sound because `encodeX509Tbs` is the
  // one encoder both sides use, so "what this node would have signed" and "what the
  // issuer did sign" are one tree serialized by one function rather than two readings of
  // one grammar that have to be trusted to agree.
  const expected = encodeX509Tbs({
    nodeKey: certificate.nodeKey,
    userKey: certificate.userKey,
    operatorId: certificate.operatorId,
    discoverability: certificate.discoverability,
    relayIds,
    issuedAt: certificate.issuedAt,
    expiresAt: certificate.expiresAt,
    issuer: certificate.issuer,
  })
  if (toHex(expected) !== toHex(decoded.tbsBytes)) {
    return {
      kind: 'x509-mismatch',
      field: 'tbsCertificate bytes',
      envelope: `${expected.length} bytes re-encoded from the envelope`,
      presented: `${decoded.tbsBytes.length} bytes presented`,
    }
  }

  let valid = false
  try {
    valid = ed25519.verify(fromHex(presented.signature), decoded.tbsBytes, fromHex(certificate.issuer))
  } catch {
    valid = false
  }
  if (!valid) return { kind: 'x509-bad-signature', nodeKey: certificate.nodeKey }

  return null
}

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

  // The X.509 form, before any signature work — see `checkX509Form` for the ruling this
  // ordering carries. Above the envelope signature specifically because the profile's
  // ceilings are the cheapest refusal available here, and because a certificate whose two
  // halves disagree must not be able to pass on the strength of one of them.
  const x509Failure = checkX509Form(certificate)
  if (x509Failure) {
    return { ok: false, failure: x509Failure, reason: describeX509CertificateFailure(x509Failure) }
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
