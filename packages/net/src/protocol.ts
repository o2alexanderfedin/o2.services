/**
 * The agent wire protocol — nine request kinds, nothing more.
 *
 * `exec` dispatches one task; `block` fetches one content-addressed block. That
 * is the entire vocabulary needed to run a distributed map: a task is addressed
 * purely by CID, so a node that has never seen a module or an input can obtain
 * both by asking, and needs no payload pushed to it.
 *
 * Phase 9 adds `reservations`, which is the rendezvous a browser tier cannot do
 * without. A browser binds no listening socket — the only difference between nodes
 * here — so no tab can be dialled cold and none of them will ever announce itself.
 * Somebody has to say who is present, and the node holding their reservations
 * already knows as a consequence of doing its job. Asking over the fabric's own
 * protocol rather than over an HTTP endpoint is what makes this work on a static
 * host, where there is no origin to ask and no server-side process permitted.
 *
 * Phase 9 also adds `report`, which both publishes a start outcome and returns what
 * the answering node has been told (BROW-02). One round trip does both because a node
 * that can reach a peer to publish can read in the same breath, and a node that
 * cannot do the first cannot do the second either — the failure is shared, which is
 * the blind spot the report itself has to state.
 *
 * Phase 6 adds the three that remove the static peer list. `providers` and
 * `records` are the two halves of a lookup — who holds a block, and what a node is
 * allowed and able to do — and `offer` is a node's own answer to "will you take this
 * shard", which is the only authoritative source for that (SCHED-03).
 *
 * Phase 16 adds `combine`, and it exists because of an arity mismatch nothing else
 * could absorb: `exec` carries a `Task`, and a `Task` has exactly one `inputCid`,
 * while a combine has *k*. Its inputs are named by CID and never by payload, which
 * is what lets a node that has never seen a partial run the combine anyway — it
 * asks for the blocks.
 *
 * Two alternatives were rejected, recorded so the next reader need not re-derive
 * them. A **WASM combine module** would need a guest that can decode DAG-CBOR to
 * read *k* partials, and no fixture in this repository has ever been one. A
 * **requestor-assembled input block** — merge the partials into one block, then send
 * an ordinary `exec` over it — would put a payload where the whole point is an
 * address, and would move every partial through the requestor on the way.
 *
 * Phase 17 adds `enrol`, which is how a node **asks** to be certified. It is a request
 * kind rather than a standalone provider binary for a reason outside this file:
 * `.planning/ROADMAP.md`, section `### Phase 22: Reachability Guard`, fixes the
 * reachability guard's universe at five runnable entry points, and a sixth would put
 * that phase in conflict with this one on day one. Whether a given process answers is a
 * per-node setting (`AgentOptions.enroll`), not a kind of node.
 *
 * The parser matters more on this kind than on most. The frame carries a proof of
 * possession and a user's consent, and the answer carries a signed statement about an
 * identity; a parser that accepted a partly-formed request would hand the authority
 * something to sign over that was never what the node sent.
 *
 * Everything arriving here came off a wire, so every field is validated before
 * use. The parsers return `null` rather than throwing — a malformed frame from a
 * peer is an expected condition, not an exception. That matters more for the record
 * kinds than for the others: a certificate is a security input, and a parser that
 * accepted a partially-formed one would hand discovery something to verify that was
 * never what the provider signed.
 *
 * Pure module.
 */

import { CID } from 'multiformats/cid'
import {
  CEREMONY_NONCE_BYTES,
  MAX_COMBINE_INPUTS,
  NotEncodableError,
  START_FAILURES,
  compareExtensionIds,
  decodeCanonical,
  encodeCanonical,
  isStartBrowserLabel,
} from '@o2/core'
import type {
  AttestedResult,
  CanonicalValue,
  CapabilityExtension,
  CapabilityRecord,
  CommitOutcome,
  Delegation,
  Discoverability,
  EnrollmentChallenge,
  EnrollmentRefusal,
  EnrollmentRequest,
  EnrollmentResult,
  ExecutionOutcome,
  Freshness,
  NameRecord,
  NodeCapacity,
  NodeCertificate,
  NodeRecords,
  OutcomeCount,
  PublicKeyHex,
  RevealOutcome,
  StartFailure,
  StartOutcome,
  Task,
} from '@o2/core'

export type AgentRequest =
  | {
      readonly kind: 'exec'
      readonly task: Task
      /** AUTH-03. Absent means unauthenticated, which an authorizing node refuses. */
      readonly capability?: readonly Delegation[]
    }
  /**
   * VER-02 round 1: run this task and tell me only the digest of what you got.
   *
   * The **same** payload as `exec` — one task, one optional chain — and deliberately so.
   * A commit is an exec whose answer is withheld, not a different unit of work, so the
   * two frames go through one builder and one parser (`taskFrame` / `parseTaskFrame`
   * below) and neither can drift into being the lenient one. That matters more here than
   * on most pairs: an authorizer that admitted a `commit` a matching `exec` would have
   * been refused would let a peer run unauthorised work and simply not collect it.
   */
  | {
      readonly kind: 'commit'
      readonly task: Task
      readonly capability?: readonly Delegation[]
    }
  /**
   * VER-02 round 2: now give me what you committed to.
   *
   * Carries **only the handle the answering node itself minted**, and there is nowhere
   * to put a task, a digest, or a node id. Every one of those would be a value the
   * serving node had to take on the requestor's word about a commitment the serving node
   * is the one holding — which is the shape of the ceremony that was deleted in
   * `855cdf5`, where the party doing the checking was also the party doing the minting.
   */
  | { readonly kind: 'reveal'; readonly handle: string }
  | { readonly kind: 'block'; readonly cid: CID }
  /** SCHED-01: who advertises a copy of this block. */
  | { readonly kind: 'providers'; readonly cid: CID }
  /** SCHED-01: the signed records for a node key. */
  | { readonly kind: 'records'; readonly nodeKey: PublicKeyHex }
  /** SCHED-03: will you take this shard? */
  | { readonly kind: 'offer'; readonly shardId: string }
  /** NET-03: who else is reserved on you? The rendezvous a browser cannot do itself. */
  | { readonly kind: 'reservations' }
  /**
   * BROW-02: here is how starting went for me; what have you been told?
   *
   * `outcome: null` asks without telling — the shape a page uses to display an
   * aggregate for a visitor who declined to be counted. Declining to report is
   * therefore not declining to *see*, which is the difference between an optional
   * measurement and a paywalled one.
   */
  | {
      readonly kind: 'report'
      readonly outcome: StartOutcome | null
      /** Visitors this node knows declined to be counted. */
      readonly declined?: number
    }
  /**
   * MR-02…MR-07: merge these *k* partials into one.
   *
   * Inputs are addresses, never payloads — which is what lets this go to a node
   * that has never seen any of them. `combineId` is the derived tree node's id, so
   * two peers asking for the same combine name it identically without agreeing on
   * anything first.
   */
  | {
      readonly kind: 'combine'
      readonly combineId: string
      readonly inputCids: readonly CID[]
      readonly level: number
    }
  /**
   * AUTH-01 / AUTH-04: certify this node, if you hold a provider signing key.
   *
   * Carried as a request kind rather than as a separate provider binary — see this
   * module's header. The frame holds public keys and signatures over a challenge, and
   * never a private key: a provider that could issue without the node proving
   * possession would be able to impersonate every node it ever certified.
   */
  | { readonly kind: 'enrol'; readonly request: EnrollmentRequest }
  /**
   * AUTH-01 freshness: mint me a nonce, so the request I send next cannot be replayed.
   *
   * Carries **nothing**, and there is deliberately nowhere to put anything. A joiner has
   * not proved who it is at this point and would only be asking the provider to trust a
   * field; binding the nonce to a claimed key would let a stranger have nonces minted
   * against somebody else's identity, which is a name for a problem this exchange does not
   * otherwise have. The binding happens on the way back — the *answer* signs the nonce
   * together with the keys the request names ({@link challengeAnswerBytes}), so an answer
   * cannot be lifted onto a different request.
   */
  | { readonly kind: 'enrol-challenge' }

export type AgentResponse =
  | { readonly kind: 'exec'; readonly outcome: ExecutionOutcome }
  /**
   * VER-02 round 1's answer: a digest and the name this node filed the answer under.
   *
   * It carries **no output, no nonce and no result CID**, and there is deliberately
   * nowhere on the frame to put any of them. That absence is the hiding property: a
   * requestor holding this frame — and any peer who intercepted it — learns nothing
   * about the answer beyond that one exists.
   */
  | { readonly kind: 'commit'; readonly outcome: CommitOutcome }
  /**
   * VER-02 round 2's answer: the nonce, the output, and what the node signed.
   *
   * **No `resultCid`, deliberately.** The requestor hashes the revealed output itself
   * (`executeCommitReveal`), because a CID accepted from the revealing node would let a
   * plagiarist reveal its own nonce and its own committed CID beside a peer's output —
   * the digest would check out over a value that is not the value being compared.
   */
  | { readonly kind: 'reveal'; readonly outcome: RevealOutcome }
  /** `bytes: null` means "I do not have that block", which is not an error. */
  | { readonly kind: 'block'; readonly bytes: Uint8Array<ArrayBuffer> | null }
  | { readonly kind: 'providers'; readonly nodeKeys: readonly PublicKeyHex[] }
  /** `records: null` means "I hold none for that key", which is not an error. */
  | { readonly kind: 'records'; readonly records: NodeRecords | null }
  /**
   * The verdict, and what the answering node says about its own room — SCHED-02.
   *
   * Three things a reader needs, all of them easy to get wrong:
   *
   * - **The figures are advisory and reserve nothing.** This branch answers through
   *   `LocalCapacity.would`, which takes no slot. A requestor bounds *itself* from
   *   what it reads here; the authoritative refusal is still the `exec` branch's
   *   SCHED-06 admission, which reserves for real and releases in a `finally`.
   * - **`inFlight` is the count from before this offer's own effect**, so two
   *   answers compose and a caller can subtract what it placed without
   *   double-counting.
   * - **`capacity: null` means the node stated nothing, and leaves it unbounded by
   *   the requestor** — not assumed full. The safe-looking alternative is wrong:
   *   assuming full would make every node running the previous build undiscoverable
   *   to a node running this one, which is a fabric that partitions itself on an
   *   upgrade.
   */
  | {
      readonly kind: 'offer'
      readonly accepted: boolean
      readonly reason: string
      readonly capacity: NodeCapacity | null
    }
  /**
   * Peer ids currently holding a reservation on the answering node.
   *
   * Empty from a node that relays for nobody, which is a truthful answer and not an
   * error — and is indistinguishable, deliberately, from a node that does not relay
   * at all. There is no capability flag to read here, because a flag would be a
   * kind to branch on.
   */
  | { readonly kind: 'reservations'; readonly peerIds: readonly string[] }
  /**
   * The counts, never a rendered report.
   *
   * Rates, reliability flags and blind spots are all derived by the reader from
   * these primitives. A peer therefore has no field in which to send a report with
   * its blind spots stripped out — the honest part is not transmissible, so it
   * cannot be lost in transmission.
   */
  | { readonly kind: 'report'; readonly counts: readonly OutcomeCount[]; readonly declined: number }
  /**
   * The combine's result, what the combining node signed about it, or why it did not run.
   *
   * `resultCid: null` is not an error — it is the fallthrough signal the requestor
   * walks its rendezvous ranking on, so it keeps a `reason`: that string is the only
   * thing the requestor learns before trying the next executor.
   *
   * `attestation` is the aggregation's half of VER-08/09/10 — see `runCombine` in
   * `agent.ts`. It is `'signed-by-nobody'` on every refusal arm, because there is no
   * result to make a statement about, and it is a real statement only on the success
   * path.
   */
  | {
      readonly kind: 'combine'
      readonly resultCid: CID | null
      readonly reason: string
      readonly attestation: AttestedResult
    }
  /**
   * AUTH-01 / AUTH-04: a certificate, or the named reason none was issued.
   *
   * A refusal is a `result` on this arm rather than an `error` frame, because it is an
   * answer about the *request* — the node's proof did not check out, the named user did
   * not consent, or the limit was reached — and each names a different next action. A
   * node that holds no signing key at all answers `error` instead: that is a fact about
   * the answering node, not about the request.
   */
  | { readonly kind: 'enrol'; readonly result: EnrollmentResult }
  /**
   * A nonce the answering provider has minted and is holding, and when it stops holding it.
   *
   * A node that issues no certificates answers `error` here, exactly as it does to `enrol`,
   * and for the same reason: it is a fact about the answering node rather than about the
   * request. There is no refusal arm — minting is unconditional for a provider that mints
   * at all, so nothing about *this* frame can be wrong.
   */
  | { readonly kind: 'enrol-challenge'; readonly challenge: EnrollmentChallenge }
  | { readonly kind: 'error'; readonly reason: string }

/** Copy any byte view into a plainly-owned ArrayBuffer-backed one. */
function ownBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy
}

function asRecord(value: CanonicalValue): { readonly [k: string]: CanonicalValue } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value instanceof Uint8Array) return null
  if (CID.asCID(value) !== null) return null
  return value as { readonly [k: string]: CanonicalValue }
}

/** Accepts `undefined` deliberately: an absent field is one of the inputs it rejects. */
function asIndex(value: CanonicalValue | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

/** A list of hex strings off the wire, or `null` if any element is not one. */
function asKeyList(value: CanonicalValue | undefined): readonly string[] | null {
  if (!Array.isArray(value)) return null
  const keys: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    keys.push(entry)
  }
  return keys
}

function asFiniteNumber(value: CanonicalValue | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function certificateToValue(certificate: NodeCertificate): CanonicalValue {
  return {
    nodeKey: certificate.nodeKey,
    userKey: certificate.userKey,
    operatorId: certificate.operatorId,
    discoverability: certificate.discoverability,
    relayIds: [...certificate.relayIds],
    issuedAt: certificate.issuedAt,
    expiresAt: certificate.expiresAt,
    issuer: certificate.issuer,
    signature: certificate.signature,
    // Carried when present, omitted when absent — never `x509: null`. The certificate's
    // own `payloadOf` (`enrollment.ts`) puts this field inside the issuer's signature by
    // exactly the same conditional rule, so a wire encoding that added a key here, or
    // dropped one, would produce a certificate that no longer verifies rather than one
    // that quietly lost its X.509 form. The two rules have to match, and this comment is
    // where a reader changing one is told about the other.
    ...(certificate.x509 === undefined ? {} : { x509: certificate.x509 }),
  }
}

/**
 * Parse a node certificate off the wire.
 *
 * Every field is required and typed. Nothing here judges whether the certificate is
 * *valid* — that is `verifyCertificate`'s job against pinned issuer keys, and keeping
 * the two separate is deliberate: a parser that also verified would tempt a caller to
 * treat "parsed" as "trusted".
 *
 * Exported because this is also the parser the **disk** path uses when a node reloads a
 * persisted certificate (Plan 17-03), so one validator guards both the wire and the file
 * and neither can drift into being the lenient one.
 */
export function parseCertificate(value: CanonicalValue | undefined): NodeCertificate | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nodeKey, userKey, operatorId, discoverability, issuer, signature } = record
  if (typeof nodeKey !== 'string' || typeof userKey !== 'string') return null
  if (typeof operatorId !== 'string' || typeof issuer !== 'string') return null
  if (typeof signature !== 'string') return null
  if (discoverability !== 'seed' && discoverability !== 'via-relay') return null
  const relayIds = asKeyList(record['relayIds'])
  const issuedAt = asFiniteNumber(record['issuedAt'])
  const expiresAt = asFiniteNumber(record['expiresAt'])
  if (relayIds === null || issuedAt === null || expiresAt === null) return null
  // The X.509 form is optional on the type, so an absent key parses; a key holding
  // anything other than a string refuses the whole frame rather than being dropped.
  // Dropping it would be the fail-open this envelope's gate exists to refuse — and it
  // would additionally be undetectable, because a certificate stripped of a field its
  // issuer signed no longer verifies and the reader would be told `bad-signature` about
  // a frame this parser had damaged. Nothing here judges the form's *contents*: that is
  // `verifyCertificate`'s job, and this file's own rule is that a parser which also
  // verified would tempt a caller to read "parsed" as "trusted".
  const x509 = record['x509']
  if (x509 !== undefined && typeof x509 !== 'string') return null
  return {
    nodeKey,
    userKey,
    operatorId,
    discoverability: discoverability satisfies Discoverability,
    relayIds,
    issuedAt,
    expiresAt,
    issuer,
    signature,
    ...(x509 === undefined ? {} : { x509 }),
  }
}

/**
 * Encode what a node said about the result it is returning — VER-08/09/10.
 *
 * The sentinel crosses as **the type's own literal**, not as a `found:`-style
 * discriminant like `offer` and `records` use. Those model a value that is nested *or
 * absent*; `'signed-by-nobody'` is neither — it is a first-class named state meaning
 * *this node signs nothing*, which is a truthful answer from an unenrolled peer and not
 * an error. Spelling it the same way on the wire and in the type is what keeps a reader
 * of a frame and a reader of `ports.ts` looking at one word.
 *
 * **What this costs the wire:** 612 DAG-CBOR bytes per attested exec reply, measured
 * 2026-08-03 against a real certificate from this repository's own `EnrollmentAuthority`
 * — three 64-char hex keys and two 128-char hex signatures, stored as text because they
 * are strings in the certificate the provider signed. Against NET-08's inbound ceiling
 * and the browser tier's 16 KiB per-message WebRTC bound that is under 4% of one
 * message. It is the price of the statement being self-contained, and the alternative —
 * a bare node key the requestor resolves to a certificate out of band — is not checkable
 * by the third party this whole leg exists for.
 */
function attestationToValue(attestation: AttestedResult): CanonicalValue {
  return attestation === 'signed-by-nobody'
    ? 'signed-by-nobody'
    : {
        certificate: certificateToValue(attestation.certificate),
        signature: attestation.signature,
      }
}

/**
 * Parse an attestation off an exec reply, or refuse the frame.
 *
 * **A malformed attestation returns `null`, and `parseResponse` turns that into a
 * refused frame rather than degrading to the sentinel.** That choice needs writing down
 * because the other option looks safer and is not. A frame that parsed to "unsigned"
 * would report a peer's *protocol error* as an *unenrolled peer*: the requestor would
 * accept the reply, build a weaker receipt, and never learn the frame was broken. The
 * quiet answer is the worse one. `RemoteExecutor` already renders a `null` parse as
 * `malformed response from <node>`, which is the honest one.
 *
 * The certificate goes through the exported `parseCertificate`, so the wire and the disk
 * path share one validator and neither can drift into being the lenient one. Nothing
 * here judges whether the certificate is *valid* — that is
 * `verifyResultAttestation`'s, against pinned issuers — and keeping the two apart stops a
 * caller reading "parsed" as "trusted".
 *
 * A field added to `ResultAttestation` without being parsed here fails to compile,
 * because the returned literal must satisfy the declared return type.
 */
function parseAttestation(value: CanonicalValue | undefined): AttestedResult | null {
  if (value === 'signed-by-nobody') return 'signed-by-nobody' satisfies AttestedResult
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const certificate = parseCertificate(record['certificate'])
  const signature = record['signature']
  if (certificate === null || typeof signature !== 'string') return null
  return { certificate, signature }
}

/**
 * Encode an enrollment request.
 *
 * `freshness` crosses as **the type's own literal** on the sentinel arm, the way
 * `attestationToValue` sends `'signed-by-nobody'`, rather than as a `found:`-style
 * discriminant. It is not a nested-or-absent value: *this request answers no challenge* is
 * a first-class state with a name, and spelling it identically on the wire and in the type
 * keeps a reader of a frame and a reader of `enrollment.ts` looking at one word.
 *
 * A request carrying the sentinel is well-formed and encodes without complaint. It is
 * refused one layer in, by `EnrollmentAuthority.redeemChallenge` — a parser that pre-empted
 * that would be answering an entitlement question, which is not a parser's.
 */
function enrollmentRequestToValue(request: EnrollmentRequest): CanonicalValue {
  return {
    nodeKey: request.nodeKey,
    userKey: request.userKey,
    operatorId: request.operatorId,
    discoverability: request.discoverability,
    relayIds: [...request.relayIds],
    proofOfPossession: request.proofOfPossession,
    ownerProof: request.ownerProof,
    freshness:
      request.freshness === 'answers-no-challenge'
        ? 'answers-no-challenge'
        : { nonce: request.freshness.nonce, proof: request.freshness.proof },
  }
}

/**
 * Parse the freshness arm, or refuse the frame.
 *
 * **Required at the wire, and `null` rather than the sentinel on anything malformed.** The
 * safe-looking alternative — degrade a broken freshness field to `'answers-no-challenge'`
 * and let the authority refuse it — reports a peer's *protocol error* as a *stale
 * challenge*, which is the same substitution `parseAttestation` refuses one screen up. The
 * joiner would then go and fetch another nonce, answer it with the same broken encoder, and
 * loop. Absent and malformed are different answers and only a parser can tell them apart.
 */
function parseFreshness(value: CanonicalValue | undefined): Freshness | null {
  if (value === 'answers-no-challenge') return 'answers-no-challenge' satisfies Freshness
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nonce, proof } = record
  if (typeof nonce !== 'string' || typeof proof !== 'string') return null
  return { nonce, proof }
}

/**
 * Parse an enrollment request off the wire — `parseCertificate`'s discipline exactly.
 *
 * Every field required and typed; `null` on anything malformed; and **no judgement about
 * whether either signature is valid**. That split matters more here than almost anywhere
 * else in this module: verifying is `EnrollmentAuthority.enrol`'s job, and it checks
 * possession *and* owner consent in a stated order that a parser doing half the work
 * would quietly pre-empt.
 *
 * Both proofs are required. The request carries **two** signatures — the node's over the
 * possession challenge, and the named user's over the identical bytes — and a parser
 * that admitted a request missing the second would hand the authority something to sign
 * over that names a user who never consented to it.
 */
function parseEnrollmentRequest(value: CanonicalValue | undefined): EnrollmentRequest | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nodeKey, userKey, operatorId, discoverability, proofOfPossession, ownerProof } = record
  if (typeof nodeKey !== 'string' || typeof userKey !== 'string') return null
  if (typeof operatorId !== 'string') return null
  if (typeof proofOfPossession !== 'string' || typeof ownerProof !== 'string') return null
  if (discoverability !== 'seed' && discoverability !== 'via-relay') return null
  const relayIds = asKeyList(record['relayIds'])
  if (relayIds === null) return null
  const freshness = parseFreshness(record['freshness'])
  if (freshness === null) return null
  return {
    nodeKey,
    userKey,
    operatorId,
    discoverability: discoverability satisfies Discoverability,
    relayIds,
    proofOfPossession,
    ownerProof,
    freshness,
  }
}

/**
 * Encode an issuance outcome — a certificate, or the refusal that explains its absence.
 *
 * Each refusal arm carries the discriminant plus that kind's own fields and nothing
 * else, so a reader of the frame learns which of the four events happened and the one
 * value that identifies it. The `rate-limited` arm carries its `limit` and `windowMs`
 * deliberately: AUTH-04 asks for a *stated* threshold, and a threshold readable only
 * from the provider's source is not stated to the peer that hit it.
 *
 * `issuance-budget-exhausted` carries the same three numbers for the same reason and
 * **no key of any kind**, because it is a statement about the provider rather than about
 * whoever asked. Copying the `rate-limited` arm and leaving its `userKey` in would put a
 * blameless requester's key on a frame that is not about them.
 */
function enrollmentResultToValue(result: EnrollmentResult): CanonicalValue {
  if (result.ok) {
    return { kind: 'enrol', ok: true, certificate: certificateToValue(result.certificate) }
  }
  const { refusal } = result
  const base = { kind: 'enrol', ok: false, reason: result.reason }
  if (refusal.kind === 'bad-proof-of-possession') {
    return { ...base, refusal: { kind: refusal.kind, nodeKey: refusal.nodeKey } }
  }
  if (refusal.kind === 'bad-owner-proof') {
    return { ...base, refusal: { kind: refusal.kind, userKey: refusal.userKey } }
  }
  if (refusal.kind === 'issuance-budget-exhausted') {
    return {
      ...base,
      refusal: {
        kind: refusal.kind,
        limit: refusal.limit,
        windowMs: refusal.windowMs,
        retryAfterMs: refusal.retryAfterMs,
      },
    }
  }
  // `ttlMs` and no key of any kind, for `issuance-budget-exhausted`'s reason: a joiner
  // whose nonce went stale is not what went wrong, and the one number it needs is the
  // window its next attempt has to answer within.
  if (refusal.kind === 'stale-challenge') {
    return { ...base, refusal: { kind: refusal.kind, ttlMs: refusal.ttlMs } }
  }
  return {
    ...base,
    refusal: {
      kind: refusal.kind,
      userKey: refusal.userKey,
      limit: refusal.limit,
      windowMs: refusal.windowMs,
      retryAfterMs: refusal.retryAfterMs,
    },
  }
}

/**
 * Parse a refusal off the wire.
 *
 * An unrecognised kind returns `null` rather than a partially-populated refusal. This is
 * deliberately the opposite disposition from `parseCounts`, which drops an unknown
 * *result* string and keeps the frame: a metric from a newer peer is worth having in
 * part, whereas a refusal whose kind this build cannot read is a statement about why a
 * node was not certified, and a caller acting on half of one would report the wrong
 * cause. A refusal that names the wrong thing is a defect even when the request
 * correctly failed.
 *
 * **This function is the reader `tsc` cannot find.** Adding a kind to
 * `EnrollmentRefusal` breaks the encoder above — it destructures fields per arm — and
 * leaves this one compiling perfectly while returning `null` for the new kind. The
 * provider refuses correctly, the frame is well formed, and the peer reads nothing. That
 * is the whole of 19-CONTEXT.md's *"`tsc` finds construction sites, not reader sites"*,
 * in the one file a plan that said "no wire change" did not open.
 */
function parseEnrollmentRefusal(value: CanonicalValue | undefined): EnrollmentRefusal | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const kind = record['kind']
  if (kind === 'bad-proof-of-possession') {
    const nodeKey = record['nodeKey']
    if (typeof nodeKey !== 'string') return null
    return { kind, nodeKey }
  }
  if (kind === 'bad-owner-proof') {
    const userKey = record['userKey']
    if (typeof userKey !== 'string') return null
    return { kind, userKey }
  }
  if (kind === 'issuance-budget-exhausted') {
    const limit = asFiniteNumber(record['limit'])
    const windowMs = asFiniteNumber(record['windowMs'])
    const retryAfterMs = asFiniteNumber(record['retryAfterMs'])
    if (limit === null || windowMs === null || retryAfterMs === null) return null
    // No key is read, and none is carried. A peer that received one anyway is talking
    // about somebody the provider had no business naming here.
    return { kind, limit, windowMs, retryAfterMs }
  }
  if (kind === 'stale-challenge') {
    const ttlMs = asFiniteNumber(record['ttlMs'])
    if (ttlMs === null) return null
    return { kind, ttlMs }
  }
  if (kind !== 'rate-limited') return null
  const userKey = record['userKey']
  if (typeof userKey !== 'string') return null
  const limit = asFiniteNumber(record['limit'])
  const windowMs = asFiniteNumber(record['windowMs'])
  const retryAfterMs = asFiniteNumber(record['retryAfterMs'])
  if (limit === null || windowMs === null || retryAfterMs === null) return null
  return { kind, userKey, limit, windowMs, retryAfterMs }
}

/** Parse an issuance outcome, reusing `parseCertificate` for the ok arm. */
function parseEnrollmentResult(record: {
  readonly [k: string]: CanonicalValue
}): EnrollmentResult | null {
  if (record['ok'] === true) {
    const certificate = parseCertificate(record['certificate'])
    if (certificate === null) return null
    return { ok: true, certificate }
  }
  if (record['ok'] !== false) return null
  const refusal = parseEnrollmentRefusal(record['refusal'])
  if (refusal === null) return null
  const reason = record['reason']
  return { ok: false, refusal, reason: typeof reason === 'string' ? reason : 'unspecified' }
}

function capabilitiesToValue(capabilities: CapabilityRecord): CanonicalValue {
  return {
    nodeKey: capabilities.nodeKey,
    features: [...capabilities.features],
    sovereignFor: [...capabilities.sovereignFor],
    issuedAt: capabilities.issuedAt,
    expiresAt: capabilities.expiresAt,
    signature: capabilities.signature,
    // Carried when present, omitted when absent — never `extensions: []`. `@o2/core`'s
    // `capabilityPayload` spreads this field into the node's own signature by exactly the
    // same conditional rule, and the two rules have to match: a wire encoding that added
    // the key here, or dropped one, would produce a record that no longer verifies rather
    // than one that quietly lost an extension. Same trap, same shape, same comment as
    // `certificateToValue`'s `x509` a few hundred lines above.
    ...(capabilities.extensions.length === 0
      ? {}
      : {
          extensions: capabilities.extensions.map((one) => ({
            id: one.id,
            critical: one.critical,
            value: one.value,
          })),
        }),
  }
}

/**
 * The extension list off the wire — **every entry preserved, ids and all, in canonical
 * order**.
 *
 * This is the whole of the forward-compatibility seam on the reading side, and the
 * property that matters is the one that looks like doing nothing: an extension whose `id`
 * means nothing to this build is reconstructed exactly as it arrived, so
 * `capabilityPayload` recomputes the bytes the signer signed and the record **verifies**.
 * A parser that kept only the extensions it recognised would keep exactly the ones it did
 * not need to keep, and every record carrying a newer field would be reported
 * `invalid-capability-record` — a claim about the signer, caused by the reader. That is
 * the misattribution `parseCertificate` already refuses for the sibling record: *"a
 * certificate stripped of a field its issuer signed no longer verifies and the reader
 * would be told `bad-signature` about a frame this parser had damaged."*
 *
 * **Absent means none.** Every peer built before the seam existed sends no key at all, and
 * a record with no extensions signs the payload it signed before the field existed, so the
 * two agree byte for byte.
 *
 * **"Verbatim" is per entry, and the list order is normalised — that distinction is a
 * fix, not a subtlety.** The signature does not depend on wire order: `capabilityPayload`
 * sorts its own copy before it encodes, which is what lets a relay hand on a signed record
 * it did not damage. The consequence is that `verifyCapabilityRecord() === true` says
 * nothing whatever about the order of `record.extensions`, and `discovery.ts` published an
 * exclusion documented *"ordered as the record orders them, which is by id, so the report
 * is reproducible"* — true for records this process signed, false for every record that
 * came off a wire, where the order is whoever-sent-it's. A relay that reorders a signed
 * record's extensions still passes verification (correctly) and used to steer the ids in
 * that report. So the parser sorts with {@link compareExtensionIds}, **the same function
 * `capabilityPayload` sorts with**, and downstream code that hashes, CIDs, dedupes or
 * structurally compares a parsed record gets one answer per record rather than one per
 * sender. Nothing is discarded and nothing is rewritten: an entry is still exactly the
 * `{ id, critical, value }` that arrived.
 *
 * **What is refused rather than tolerated, and why refusing is not the same mistake.** A
 * wrong-typed `id` or `critical`, a missing `value`, a repeated `id`, a fourth key beside
 * the three — each refuses the whole frame. None of them is a *later* build talking: the
 * envelope is closed **because `value` is open**, so anything a later build needs to say
 * goes inside `value` and never as a sibling of it. Dropping any of these would recreate,
 * one level further down and much harder to find, the defect this seam removes.
 *
 * **Every one of those refusals is anonymous and costs the peer its certificate**, for the
 * reason {@link CAPABILITY_KEYS} sets out in full: a `null` from here becomes a `null`
 * frame, becomes an `undefined` from `recordsFor`, becomes a `no-records` exclusion naming
 * neither this build nor the field it refused. Read that note before relaxing or adding a
 * refusal here — the price is paid at a layer this function cannot see.
 */
function asExtensions(value: CanonicalValue | undefined): readonly CapabilityExtension[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const extensions: CapabilityExtension[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const record = asRecord(entry)
    if (record === null) return null
    const { id, critical } = record
    if (typeof id !== 'string' || typeof critical !== 'boolean') return null
    const carried = record['value']
    // `undefined` is absent; `null` is a value a signer may legitimately have signed, and
    // the two are different bytes under DAG-CBOR. Only the first is refused.
    if (carried === undefined) return null
    if (Object.keys(record).length !== 3) return null
    if (seen.has(id)) return null
    seen.add(id)
    extensions.push({ id, critical, value: carried })
  }
  // Sorted after the duplicate check rather than before it, so a refusal names the
  // condition the sender created and not one this function introduced by moving entries.
  return extensions.sort((a, b) => compareExtensionIds(a.id, b.id))
}

/**
 * The keys a capability record may carry on the wire.
 *
 * **A key outside this set refuses the frame rather than being dropped**, and the
 * strictness is what makes the extension seam mean something: after this, the sanctioned
 * way to add a field is an entry in `extensions`, which every build preserves, and a new
 * top-level key would reintroduce exactly the silent drop this file was changed to remove.
 *
 * `parseCertificate` is deliberately *not* strict in the same way, and the asymmetry has a
 * reason rather than being an oversight: `NodeCertificate` has no extension seam, so
 * refusing unknown keys there would forbid extension outright instead of directing it.
 *
 * ## What the strictness costs, stated here rather than discovered downstream
 *
 * **The refusal is anonymous, and it takes the peer's certificate with it.** Every frame
 * this set refuses — and every refusal in {@link asExtensions} — makes `parseCapabilities`
 * return `null`, so `parseResponse` returns `null`, so `RpcRecordIndex.recordsFor` treats
 * the answer as no answer and eventually returns `undefined`, and `discoverExecutors`
 * excludes the peer as `no-records`. The reader's own limit arrives at an operator wearing
 * the shape of an absent index, with nothing naming this build, and the certificate that
 * would have identified the peer is discarded alongside the claims that were refused.
 *
 * That is uncomfortably close to the misattribution this whole change removes, and the
 * honest reading is that the seam **moves** the class rather than eliminating it: below,
 * an unknown extension is preserved and refused *by name*; here, an unknown top-level key
 * is refused *without one*. The commit that introduced this seam claimed *"one condition,
 * two parties, two honest attributions"* for the duplicate-id case, and that claim does
 * not extend to this one — the parser's refusal names neither party.
 *
 * It is still the right trade, on two grounds that are measured rather than asserted.
 * First, **detection beats silence**: dropping the key would leave the record unable to
 * verify with no indication anywhere of why, which is the defect this file was changed to
 * remove, one layer down and harder to find. Second, **nothing can trip it today**:
 * {@link capabilitiesToValue} is the only producer in this repository and emits exactly
 * these seven keys; a peer built before the seam emits six, which is a subset. The cost
 * lands only on a peer that adds a top-level key instead of using `extensions` — which is
 * precisely the mistake this set exists to make loud.
 *
 * **Naming it properly is a port change, not a parser change, and it was declined here.**
 * `RecordIndex.recordsFor` returns `NodeRecords | undefined`; carrying a refusal out of it
 * means widening a shared interface with four production implementations
 * (`RpcRecordIndex`, `FallbackRecordIndex`, `MemoryRecordIndex`, `SelfRecordIndex`), its
 * test doubles, and every caller's `=== undefined` check — for a condition no producer in
 * the tree can currently reach. See
 * `@o2/core`'s `ExclusionReason['no-records']` docblock, which states the same trade from
 * the reader's end so that neither side can quietly stop being true on its own.
 */
const CAPABILITY_KEYS: ReadonlySet<string> = new Set([
  'nodeKey',
  'features',
  'sovereignFor',
  'issuedAt',
  'expiresAt',
  'extensions',
  'signature',
])

function parseCapabilities(value: CanonicalValue | undefined): CapabilityRecord | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nodeKey, signature } = record
  if (typeof nodeKey !== 'string' || typeof signature !== 'string') return null
  const features = asKeyList(record['features'])
  const sovereignFor = asKeyList(record['sovereignFor'])
  const issuedAt = asFiniteNumber(record['issuedAt'])
  const expiresAt = asFiniteNumber(record['expiresAt'])
  const extensions = asExtensions(record['extensions'])
  if (features === null || sovereignFor === null) return null
  if (issuedAt === null || expiresAt === null || extensions === null) return null
  if (Object.keys(record).some((key) => !CAPABILITY_KEYS.has(key))) return null
  return { nodeKey, features, sovereignFor, issuedAt, expiresAt, extensions, signature }
}

/** A start result off the wire, or `null` if it is not one this build knows. */
function asStartResult(value: CanonicalValue | undefined): 'started' | StartFailure | null {
  if (typeof value !== 'string') return null
  if (value === 'started') return 'started'
  const known = START_FAILURES.find((failure) => failure === value)
  return known ?? null
}

/**
 * The largest count one wire entry may carry.
 *
 * The negative count already dropped here and the enormous one that was not are the
 * same attack from opposite ends — one erases another peer's evidence, the other
 * buries it — and the second is the more effective, because `mergeOverlapping` takes
 * the largest count it is shown. One entry claiming four billion therefore decided
 * every rate in a merged report on its own.
 *
 * Unlike `MAX_RESERVED_PEERS_PER_ANSWER` (rendezvous.ts), which truncates no truthful
 * answer because no relay in this repository can hold more than it allows, **this
 * ceiling can discard a true count**, and there is no honest bound that would not:
 * a node's row grows by one for every visitor that ever reported to it, forever. So
 * the line is drawn where the number stops describing a fabric this repository has
 * ever run. The busiest node here is configured for 64 concurrent peers
 * (`seed-server.ts`, quoted by `MAX_RESERVED_PEERS_PER_ANSWER`); this allows 1024
 * complete turnovers of that population through one node before its evidence is
 * refused. A deployment that genuinely exceeds it goes uncounted by its readers, and
 * this constant is the line to change with it. Written out rather than imported from
 * rendezvous.ts, which imports *this* module.
 *
 * Dropped rather than clamped, deliberately. Clamping would leave the row in the
 * merge at the ceiling — and since the merge takes the maximum, the loudest peer
 * would still own it, so the bound would cap the size of the lie without removing
 * it. Dropping is also what every other malformed field in this parser gets.
 */
export const MAX_REPORTED_COUNT = 65_536

/** A count off the wire: a positive integer no larger than what a peer could hold. */
function asReportedCount(value: CanonicalValue | undefined): number | null {
  const count = asIndex(value)
  if (count === null || count === 0 || count > MAX_REPORTED_COUNT) return null
  return count
}

/**
 * Parse the compact counts.
 *
 * An unrecognised result string drops that entry rather than the whole frame: a
 * newer peer naming a cause this build has never heard of is a peer worth talking
 * to, and refusing the frame would make the metric go dark exactly when the fabric
 * is most heterogeneous. Malformed *counts* are a different matter and are dropped
 * too — a negative one would let a peer erase another's evidence, and one past
 * {@link MAX_REPORTED_COUNT} would swamp it. A browser label outside the coarse
 * range goes the same way, and for a further reason: the disclosure promise rests on
 * the label being too blunt to name a visitor.
 */
function parseCounts(value: CanonicalValue | undefined): readonly OutcomeCount[] | null {
  if (!Array.isArray(value)) return null
  const counts: OutcomeCount[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (record === null) return null
    const browser = record['browser']
    const result = asStartResult(record['result'])
    const count = asReportedCount(record['count'])
    if (!isStartBrowserLabel(browser) || count === null) continue
    if (result === null) continue
    counts.push({ browser, result, count })
  }
  return counts
}

export function encodeRequest(request: AgentRequest): CanonicalValue {
  if (request.kind === 'block') {
    return { kind: 'block', cid: request.cid }
  }
  if (request.kind === 'providers') {
    return { kind: 'providers', cid: request.cid }
  }
  if (request.kind === 'records') {
    return { kind: 'records', nodeKey: request.nodeKey }
  }
  if (request.kind === 'offer') {
    return { kind: 'offer', shardId: request.shardId }
  }
  if (request.kind === 'reservations') {
    return { kind: 'reservations' }
  }
  if (request.kind === 'report') {
    const declined = request.declined ?? 0
    if (request.outcome === null) return { kind: 'report', declined }
    return {
      kind: 'report',
      declined,
      browser: request.outcome.browser,
      result:
        request.outcome.result.kind === 'started' ? 'started' : request.outcome.result.cause,
    }
  }
  if (request.kind === 'combine') {
    // Four keys, all of them addresses or the position they sit at in the tree. A
    // fifth key is how a payload would arrive, so there is deliberately nowhere to
    // put one.
    return {
      kind: 'combine',
      combineId: request.combineId,
      inputCids: [...request.inputCids],
      level: request.level,
    }
  }
  if (request.kind === 'enrol') {
    return { kind: 'enrol', request: enrollmentRequestToValue(request.request) }
  }
  if (request.kind === 'enrol-challenge') {
    return { kind: 'enrol-challenge' }
  }
  if (request.kind === 'reveal') {
    return { kind: 'reveal', handle: request.handle }
  }
  if (request.kind === 'commit') {
    return taskFrame('commit', request.task, request.capability)
  }
  return taskFrame('exec', request.task, request.capability)
}

/**
 * The bytes an `exec` and a `commit` share.
 *
 * One builder for both frames, paired with one parser (`parseTaskFrame`), for the reason
 * `parseCertificate` states about the wire and the disk: two encoders for one payload
 * drift, and the one that drifts is the one nobody is reading. Here the drift would be a
 * security hole with a name — a `commit` whose capability chain or sovereignty label was
 * encoded differently from the `exec` carrying the identical task would be admitted or
 * refused on different terms by the same authorizer.
 */
function taskFrame(
  kind: 'exec' | 'commit',
  task: Task,
  capability: readonly Delegation[] | undefined,
): CanonicalValue {
  const base: { readonly [k: string]: CanonicalValue } = {
    kind,
    moduleCid: task.moduleCid,
    inputCid: task.inputCid,
    partitionIndex: task.partitionIndex,
    partitionCount: task.partitionCount,
  }
  // DATA-07/DATA-09: carry the sovereignty label to the serving node, so a
  // refusal can be made there (`guardSovereignty`, sovereignty-guard.ts) rather
  // than trusted to whoever dispatched the task. Never an explicit `undefined`
  // key — this project's canonical encoding treats that as a different shape
  // from "absent". A `'sovereign'` task with no `ownerId` deliberately encodes
  // with no `ownerId` key at all, so `parseRequest`'s mirrored check refuses it
  // (the wire-side twin of `submitJob`'s `shard-missing-owner`) instead of the
  // parser guessing one.
  //
  // DET-03/DATA-08: `moduleRecord` travels for the same reason and under the same
  // rule. It is the signed mapping `guardModuleProvenance` (module-provenance.ts)
  // reads before the serving node fetches a single byte of the module, so a node
  // that never receives one refuses the task rather than resolving a bare CID. A
  // task with no record therefore encodes with no `moduleRecord` key at all —
  // absent and malformed are different answers, and only the parser gets to tell
  // them apart.
  const labelled: { readonly [k: string]: CanonicalValue } =
    task.label === undefined
      ? base
      : task.label === 'sovereign' && task.ownerId !== undefined
        ? { ...base, label: task.label, ownerId: task.ownerId }
        : { ...base, label: task.label }
  const vouched: { readonly [k: string]: CanonicalValue } =
    task.moduleRecord === undefined
      ? labelled
      : { ...labelled, moduleRecord: nameRecordToValue(task.moduleRecord) }
  if (capability === undefined) return vouched
  return { ...vouched, capability: capability.map(delegationToValue) }
}

/**
 * Name records are plain records, but must be listed explicitly to stay canonical.
 *
 * Same reason as `delegationToValue`, and it bites harder here: a spread would encode
 * whatever the object happens to hold, in whatever order it holds it, and the
 * signature covers the canonical encoding of five of these six fields. An extra key
 * or a reordered one is a record that no longer verifies.
 */
function nameRecordToValue(record: NameRecord): CanonicalValue {
  return {
    name: record.name,
    cid: record.cid,
    version: record.version,
    expiresAt: record.expiresAt,
    signer: record.signer,
    signature: record.signature,
  }
}

/** Delegations are plain records, but must be listed explicitly to stay canonical. */
function delegationToValue(link: Delegation): CanonicalValue {
  return {
    issuer: link.issuer,
    audience: link.audience,
    ownerId: link.ownerId,
    abilities: [...link.abilities],
    expiresAt: link.expiresAt,
    signature: link.signature,
  }
}

/** Parse a delegation off the wire. Every field validated — this is a security input. */
function parseDelegation(value: CanonicalValue): Delegation | null {
  const record = asRecord(value)
  if (record === null) return null
  const { issuer, audience, ownerId, expiresAt, signature } = record
  if (typeof issuer !== 'string' || typeof audience !== 'string') return null
  if (typeof ownerId !== 'string' || typeof signature !== 'string') return null
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
  const abilities = record['abilities']
  if (!Array.isArray(abilities)) return null
  const parsed: ('execute' | 'read' | 'delegate')[] = []
  for (const ability of abilities) {
    if (ability !== 'execute' && ability !== 'read' && ability !== 'delegate') return null
    parsed.push(ability)
  }
  return { issuer, audience, ownerId, abilities: parsed, expiresAt, signature }
}

/**
 * Parse a signed name record off the wire. Every field validated — a security input.
 *
 * The same rule `parseDelegation` carries, for the same reason: a parser that accepted
 * a partially-formed record would hand `SignedNameResolver` something to verify that is
 * not what the build authority signed. `version` goes through `asIndex` rather than
 * `asFiniteNumber` because a negative version is one no monotonic check can order — it
 * would let a peer offer a record the resolver's rollback protection cannot rank.
 */
function parseNameRecord(value: CanonicalValue): NameRecord | null {
  const record = asRecord(value)
  if (record === null) return null
  const { name, signer, signature } = record
  if (typeof name !== 'string' || typeof signer !== 'string') return null
  if (typeof signature !== 'string') return null
  const cid = CID.asCID(record['cid'] ?? null)
  const version = asIndex(record['version'])
  const expiresAt = asFiniteNumber(record['expiresAt'])
  if (cid === null || version === null || expiresAt === null) return null
  return { name, cid, version, expiresAt, signer, signature }
}

export function parseRequest(body: CanonicalValue): AgentRequest | null {
  const record = asRecord(body)
  if (record === null) return null

  if (record['kind'] === 'block') {
    const cid = CID.asCID(record['cid'] ?? null)
    if (cid === null) return null
    return { kind: 'block', cid }
  }

  if (record['kind'] === 'providers') {
    const cid = CID.asCID(record['cid'] ?? null)
    if (cid === null) return null
    return { kind: 'providers', cid }
  }

  if (record['kind'] === 'records') {
    const nodeKey = record['nodeKey']
    if (typeof nodeKey !== 'string') return null
    return { kind: 'records', nodeKey }
  }

  if (record['kind'] === 'offer') {
    const shardId = record['shardId']
    if (typeof shardId !== 'string') return null
    return { kind: 'offer', shardId }
  }

  if (record['kind'] === 'reservations') {
    return { kind: 'reservations' }
  }

  if (record['kind'] === 'report') {
    // The same ceiling as a count, and the cheaper attack of the two: a count grows
    // by one per request, while one request carrying `declined: 4e9` is added to the
    // answering node's ledger outright (`agent.ts`) and served to everyone who asks
    // it afterwards. The blind-spot line is the report's most load-bearing sentence,
    // so a peer does not get to write it.
    const declined = asReportedCount(record['declined']) ?? 0
    const browser = record['browser']
    const result = asStartResult(record['result'])
    // Both halves or neither. A browser with no result, or a result with no
    // browser, is a report that could only be filed under a guess — and so is one
    // whose label is outside the coarse range `StartOutcome.browser` declares.
    if (!isStartBrowserLabel(browser) || result === null) {
      return { kind: 'report', outcome: null, declined }
    }
    return {
      kind: 'report',
      outcome: {
        browser,
        result: result === 'started' ? { kind: 'started' } : { kind: 'failed', cause: result },
      },
      declined,
    }
  }

  if (record['kind'] === 'combine') {
    const combineId = record['combineId']
    if (typeof combineId !== 'string' || combineId.length === 0) return null

    // `ReduceTreeNode.level` is documented as 1 for the first combine layer above
    // the leaves, so 0 is not a level any derived tree produces.
    const level = asIndex(record['level'])
    if (level === null || level < 1) return null

    const inputCids = record['inputCids']
    if (!Array.isArray(inputCids)) return null

    // The floor of two: `deriveReduceTree` promotes a lone child rather than
    // wrapping it, so a one-input combine cannot come from a tree anybody derived.
    // Running one would re-canonicalise its single input — work an unauthenticated
    // peer could ask for and get nothing from.
    //
    // The ceiling: a combine request makes the receiving node fetch *k* blocks, each
    // potentially a network round trip, before anything can be merged. Refusing here
    // rather than in the handler means the frame does not become a request at all —
    // the same disposition this parser already gives a partition index outside its
    // own count. NET-08 is *not* the general form of this bound and does not cover
    // it: NET-08 caps the bytes of one inbound message, while this caps how many
    // fetches one in-limit message may provoke.
    if (inputCids.length < 2 || inputCids.length > MAX_COMBINE_INPUTS) return null

    const parsed: CID[] = []
    for (const element of inputCids) {
      const cid = CID.asCID(element ?? null)
      if (cid === null) return null
      parsed.push(cid)
    }
    return { kind: 'combine', combineId, inputCids: parsed, level }
  }

  if (record['kind'] === 'enrol') {
    const request = parseEnrollmentRequest(record['request'])
    if (request === null) return null
    return { kind: 'enrol', request }
  }

  if (record['kind'] === 'enrol-challenge') {
    return { kind: 'enrol-challenge' }
  }

  if (record['kind'] === 'reveal') {
    const handle = record['handle']
    // Bounded here rather than in the handler, so a frame naming a handle no node could
    // have minted does not become a request at all — the disposition `combine`'s input
    // ceiling already takes one screen up. See {@link MAX_COMMITMENT_HANDLE_CHARS}.
    if (typeof handle !== 'string' || handle.length === 0) return null
    if (handle.length > MAX_COMMITMENT_HANDLE_CHARS) return null
    return { kind: 'reveal', handle }
  }

  if (record['kind'] === 'commit') {
    const frame = parseTaskFrame(record)
    if (frame === null) return null
    return frame.capability === undefined
      ? { kind: 'commit', task: frame.task }
      : { kind: 'commit', task: frame.task, capability: frame.capability }
  }

  if (record['kind'] !== 'exec') return null
  const frame = parseTaskFrame(record)
  if (frame === null) return null
  return frame.capability === undefined
    ? { kind: 'exec', task: frame.task }
    : { kind: 'exec', task: frame.task, capability: frame.capability }
}

/**
 * The longest handle a `reveal` frame may name.
 *
 * 128 characters. `serveAgent` mints handles as `commit-<hex counter>` and the only other
 * producer of one is a test double, so nothing honest comes anywhere near this — the
 * bound exists for the dishonest case, and the shape of that case decides the number
 * rather than any measurement of the honest one.
 *
 * A handle is a **map key on the serving node**, so an unbounded one is a peer choosing
 * how many bytes this node allocates and hashes per frame, on a request that is refused
 * anyway. `MAX_PENDING_COMMITMENTS` bounds how many entries a peer can leave behind;
 * without this, one refused frame could still be a megabyte of key. Two bounds because
 * they are two different resources, which is the same reason `combine` carries both an
 * input ceiling and NET-08's byte ceiling and says the second is not the general form of
 * the first.
 *
 * Refused rather than truncated, for `MAX_REPORTED_COUNT`'s reason: a truncated handle is
 * a *different* handle, so truncation would turn a malformed frame into a well-formed
 * request naming somebody else's pending commitment.
 */
export const MAX_COMMITMENT_HANDLE_CHARS = 128

/**
 * The half of a frame an `exec` and a `commit` share, parsed once.
 *
 * The twin of `taskFrame`, and the reason for the pairing is stated there: a `commit`
 * validated more leniently than the `exec` carrying the identical task would be admitted
 * by an authorizer that would have refused the exec, and the peer would get its answer by
 * asking the other way round.
 */
function parseTaskFrame(record: {
  readonly [k: string]: CanonicalValue
}): { task: Task; capability?: readonly Delegation[] } | null {
  const moduleCid = CID.asCID(record['moduleCid'] ?? null)
  const inputCid = CID.asCID(record['inputCid'] ?? null)
  const partitionIndex = asIndex(record['partitionIndex'])
  const partitionCount = asIndex(record['partitionCount'])
  if (moduleCid === null || inputCid === null) return null
  if (partitionIndex === null || partitionCount === null) return null
  // A partition index outside its own count is incoherent — refuse it here rather
  // than letting the executor derive a nonsensical shard.
  if (partitionCount === 0 || partitionIndex >= partitionCount) return null

  // T-12-07 (Correction 2): the label is not optional at the wire, even though
  // it stays optional on `Task` itself (kept that way so the ~65 unrelated
  // in-process `Task` literals across the repo need no change). A task that
  // crossed the network without one would reach `guardSovereignty`
  // (sovereignty-guard.ts) unlabelled and pass through it as a no-op — that is
  // exactly "trusted to whoever dispatched the task", the thing the guard's own
  // docstring says it exists so a refusal does not have to be. So this parser
  // refuses the whole request rather than defaulting the label or leaving it
  // absent; every exec request that survives parsing carries one.
  const labelValue = record['label']
  if (labelValue !== 'public' && labelValue !== 'sovereign') return null

  // DET-03/DATA-08. Decoded *before* the task literal so neither branch below has to
  // assign an explicit `undefined` under `exactOptionalPropertyTypes`.
  //
  // A record that is present but will not parse refuses the whole frame. The
  // alternative — drop the malformed record, admit the task — is the dangerous one:
  // it converts "this frame is corrupt" into "this task arrived unsigned", and
  // `guardModuleProvenance` would then refuse it as `no-record`, naming a problem the
  // dispatcher does not have and hiding the one it does. Absent and malformed are
  // different answers, and only this line is in a position to tell them apart.
  const recordValue = record['moduleRecord']
  let provenance: { readonly moduleRecord?: NameRecord } = {}
  if (recordValue !== undefined) {
    const moduleRecord = parseNameRecord(recordValue)
    if (moduleRecord === null) return null
    provenance = { moduleRecord }
  }

  let task: Task
  if (labelValue === 'sovereign') {
    const ownerId = record['ownerId']
    // The wire-side mirror of `submitJob`'s `shard-missing-owner`: a sovereign
    // label with no owner is not a wide-open task, it is a broken one.
    if (typeof ownerId !== 'string' || ownerId.length === 0) return null
    task = {
      moduleCid,
      inputCid,
      partitionIndex,
      partitionCount,
      label: 'sovereign',
      ownerId,
      ...provenance,
    }
  } else {
    task = { moduleCid, inputCid, partitionIndex, partitionCount, label: 'public', ...provenance }
  }

  const capabilityValue = record['capability']
  if (capabilityValue === undefined) return { task }
  if (!Array.isArray(capabilityValue)) return null
  const capability: Delegation[] = []
  for (const value of capabilityValue) {
    const link = parseDelegation(value)
    // A malformed chain is refused outright rather than silently truncated to the
    // links that happened to parse.
    if (link === null) return null
    capability.push(link)
  }
  return { task, capability }
}

export function encodeResponse(response: AgentResponse): CanonicalValue {
  switch (response.kind) {
    case 'error':
      return { kind: 'error', reason: response.reason }
    case 'block':
      return response.bytes === null
        ? { kind: 'block', found: false }
        : { kind: 'block', found: true, bytes: response.bytes }
    case 'providers':
      return { kind: 'providers', nodeKeys: [...response.nodeKeys] }
    case 'records':
      return response.records === null
        ? { kind: 'records', found: false }
        : {
            kind: 'records',
            found: true,
            certificate: certificateToValue(response.records.certificate),
            capabilities: capabilitiesToValue(response.records.capabilities),
          }
    case 'offer':
      // The `found`-style discriminant this file uses for every nested-or-absent
      // value. Emitting `slots`/`inFlight` as explicit `undefined` keys instead
      // would be a different shape from absent under the canonical encoding.
      return response.capacity === null
        ? { kind: 'offer', accepted: response.accepted, reason: response.reason, bounded: false }
        : {
            kind: 'offer',
            accepted: response.accepted,
            reason: response.reason,
            bounded: true,
            slots: response.capacity.slots,
            inFlight: response.capacity.inFlight,
          }
    case 'enrol':
      return enrollmentResultToValue(response.result)
    case 'enrol-challenge':
      return {
        kind: 'enrol-challenge',
        nonce: response.challenge.nonce,
        expiresAt: response.challenge.expiresAt,
      }
    case 'reservations':
      return { kind: 'reservations', peerIds: [...response.peerIds] }
    case 'combine':
      // The refusal arm carries no `attestation` key at all, rather than the sentinel
      // spelled out. The `exec` arm does the same with its `ok: false` shape and for the
      // same reason: a refusal has no result, so a field naming what was signed about it
      // would be a field about nothing. The parse below supplies the sentinel on this
      // arm, so the type stays total without the wire paying for it.
      return response.resultCid === null
        ? { kind: 'combine', found: false, reason: response.reason }
        : {
            kind: 'combine',
            found: true,
            resultCid: response.resultCid,
            reason: response.reason,
            attestation: attestationToValue(response.attestation),
          }
    case 'report':
      return {
        kind: 'report',
        declined: response.declined,
        counts: response.counts.map((entry) => ({
          browser: entry.browser,
          result: entry.result,
          count: entry.count,
        })),
      }
    case 'commit':
      // The success arm carries a digest and a handle and **nothing else**. Adding an
      // output, a nonce or a result CID here would not be an extra field, it would be
      // the end of the hiding property — round 1 would disclose the answer it exists to
      // withhold. There is nowhere on this frame to put one, which is the point.
      return response.outcome.ok
        ? {
            kind: 'commit',
            ok: true,
            digest: response.outcome.digest,
            handle: response.outcome.handle,
          }
        : { kind: 'commit', ok: false, reason: response.outcome.reason }
    case 'reveal':
      return response.outcome.ok
        ? {
            kind: 'reveal',
            ok: true,
            // Copied into an owned buffer for `ownBytes`' reason on the `block` arm: what
            // goes on the wire must not alias a view the caller can still write through.
            nonce: ownBytes(response.outcome.nonce),
            output: response.outcome.output,
            fuelUsed: response.outcome.fuelUsed,
            attestation: attestationToValue(response.outcome.attestation),
          }
        : { kind: 'reveal', ok: false, reason: response.outcome.reason }
    case 'exec':
      return response.outcome.ok
        ? {
            kind: 'exec',
            ok: true,
            output: response.outcome.output,
            fuelUsed: response.outcome.fuelUsed,
            attestation: attestationToValue(response.outcome.attestation),
          }
        : { kind: 'exec', ok: false, reason: response.outcome.reason }
  }
}

export function parseResponse(body: CanonicalValue): AgentResponse | null {
  const record = asRecord(body)
  if (record === null) return null

  switch (record['kind']) {
    case 'error': {
      const reason = record['reason']
      return { kind: 'error', reason: typeof reason === 'string' ? reason : 'unspecified' }
    }
    case 'block': {
      if (record['found'] !== true) return { kind: 'block', bytes: null }
      const bytes = record['bytes']
      if (!(bytes instanceof Uint8Array)) return null
      return { kind: 'block', bytes: ownBytes(bytes) }
    }
    case 'providers': {
      const nodeKeys = asKeyList(record['nodeKeys'])
      if (nodeKeys === null) return null
      return { kind: 'providers', nodeKeys }
    }
    case 'records': {
      if (record['found'] !== true) return { kind: 'records', records: null }
      const certificate = parseCertificate(record['certificate'])
      const capabilities = parseCapabilities(record['capabilities'])
      // Half a record is not a record. Returning one would leave discovery holding a
      // certificate with nothing to check it against, or claims with no identity.
      if (certificate === null || capabilities === null) return null
      return { kind: 'records', records: { certificate, capabilities } }
    }
    case 'offer': {
      const accepted = record['accepted']
      const reason = record['reason']
      if (typeof accepted !== 'boolean') return null
      const stated = typeof reason === 'string' ? reason : ''
      if (record['bounded'] !== true) return { kind: 'offer', accepted, reason: stated, capacity: null }
      const slots = asIndex(record['slots'])
      const inFlight = asIndex(record['inFlight'])
      // Refused, not folded into the absent arm — the same disposition the
      // `combine` arm takes below. A peer able to turn a corrupt capacity into an
      // ordinary "I state nothing" would be indistinguishable from an honest node
      // that states nothing, and the requestor treats that node as unbounded.
      if (slots === null || inFlight === null) return null
      return { kind: 'offer', accepted, reason: stated, capacity: { slots, inFlight } }
    }
    case 'reservations': {
      const peerIds = asKeyList(record['peerIds'])
      if (peerIds === null) return null
      return { kind: 'reservations', peerIds }
    }
    case 'enrol': {
      const result = parseEnrollmentResult(record)
      if (result === null) return null
      return { kind: 'enrol', result }
    }
    case 'enrol-challenge': {
      const nonce = record['nonce']
      const expiresAt = asFiniteNumber(record['expiresAt'])
      // Refused rather than defaulted on either half. A nonce with no expiry would be
      // answered by a joiner that could not tell it had already gone stale, and an expiry
      // with no nonce is nothing at all.
      if (typeof nonce !== 'string' || nonce.length === 0 || expiresAt === null) return null
      return { kind: 'enrol-challenge', challenge: { nonce, expiresAt } }
    }
    case 'report': {
      const counts = parseCounts(record['counts'])
      if (counts === null) return null
      return { kind: 'report', counts, declined: asReportedCount(record['declined']) ?? 0 }
    }
    case 'combine': {
      const reason = record['reason']
      const stated = typeof reason === 'string' ? reason : 'unspecified'
      // A refusal carries no statement, and the sentinel is supplied here rather than
      // sent. It is the truthful reading of that frame: nothing was produced, so nothing
      // was signed.
      if (record['found'] !== true) {
        return { kind: 'combine', resultCid: null, reason: stated, attestation: 'signed-by-nobody' }
      }
      const resultCid = CID.asCID(record['resultCid'] ?? null)
      // Refused, not folded into the null arm. The null arm is the fallthrough signal
      // the requestor walks its ranking on, so a peer able to turn a corrupt answer
      // into an ordinary "I could not" would be indistinguishable from an honest one
      // that had nothing — and the requestor would count it as a normal miss.
      if (resultCid === null) return null
      // Refused, never downgraded — the disposition the `exec` arm takes below, for the
      // reason `parseAttestation`'s docblock gives. A frame whose attestation does not
      // parse is a peer's protocol error; degrading it to the sentinel would report that
      // as an honest unenrolled peer, and the requestor would record an unsigned combine
      // and never learn the frame was broken.
      //
      // **What this costs the wire:** one certificate per attested combine reply — 612
      // DAG-CBOR bytes, the figure measured for the `exec` reply and identical here
      // because it is the same `certificateToValue`. Against NET-08's inbound ceiling
      // and the browser tier's 16 KiB per-message WebRTC bound that is under 4% of one
      // message, and it does not grow with the number of inputs merged.
      const attestation = parseAttestation(record['attestation'])
      if (attestation === null) return null
      return { kind: 'combine', resultCid, reason: stated, attestation }
    }
    case 'commit': {
      if (record['ok'] === true) {
        const digest = record['digest']
        const handle = record['handle']
        // Every field required and typed, and **refused rather than degraded to the
        // failure arm** — `parseAttestation`'s disposition, for its reason. A commit
        // frame that parsed to `ok: false` would report a peer's protocol error as an
        // honest refusal to commit, and the requestor would drop that replica from the
        // ceremony and never learn the frame was broken.
        if (typeof digest !== 'string' || digest.length === 0) return null
        if (typeof handle !== 'string' || handle.length === 0) return null
        if (handle.length > MAX_COMMITMENT_HANDLE_CHARS) return null
        return { kind: 'commit', outcome: { ok: true, digest, handle } }
      }
      if (record['ok'] !== false) return null
      const reason = record['reason']
      return {
        kind: 'commit',
        outcome: { ok: false, reason: typeof reason === 'string' ? reason : 'unspecified' },
      }
    }
    case 'reveal': {
      if (record['ok'] === true) {
        const nonce = record['nonce']
        const output = record['output']
        const fuelUsed = record['fuelUsed']
        if (!(nonce instanceof Uint8Array)) return null
        // **Exactly** `CEREMONY_NONCE_BYTES`, not a ceiling. The commitment preimage is
        // `nonce ‖ moduleCid ‖ inputCid ‖ index ‖ resultCid` with no length prefixes, so
        // a variable-length nonce makes the concatenation ambiguous: a peer could split
        // the same bytes between the nonce and the CID that follows it and produce one
        // preimage from two different claims. A fixed length removes that degree of
        // freedom at the only place it can be removed — before the bytes become a
        // request.
        if (nonce.byteLength !== CEREMONY_NONCE_BYTES) return null
        if (output === undefined || typeof fuelUsed !== 'number' || !Number.isFinite(fuelUsed)) {
          return null
        }
        const attestation = parseAttestation(record['attestation'])
        if (attestation === null) return null
        return {
          kind: 'reveal',
          outcome: { ok: true, nonce: ownBytes(nonce), output, fuelUsed, attestation },
        }
      }
      if (record['ok'] !== false) return null
      const reason = record['reason']
      return {
        kind: 'reveal',
        outcome: { ok: false, reason: typeof reason === 'string' ? reason : 'unspecified' },
      }
    }
    case 'exec': {
      if (record['ok'] === true) {
        const output = record['output']
        const fuelUsed = record['fuelUsed']
        if (output === undefined || typeof fuelUsed !== 'number' || !Number.isFinite(fuelUsed)) {
          return null
        }
        // Refused, never downgraded. A frame whose attestation does not parse is a
        // protocol error, and reporting it as an honest peer that holds no certificate
        // would hand the requestor a weaker receipt with nothing to indicate why.
        const attestation = parseAttestation(record['attestation'])
        if (attestation === null) return null
        return { kind: 'exec', outcome: { ok: true, output, fuelUsed, attestation } }
      }
      if (record['ok'] !== false) return null
      const reason = record['reason']
      return {
        kind: 'exec',
        outcome: { ok: false, reason: typeof reason === 'string' ? reason : 'unspecified' },
      }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// `NodeRecords` as standalone bytes — the form a distributed index stores
// ---------------------------------------------------------------------------

/**
 * One node's signed records, encoded to canonical bytes.
 *
 * ## Why this exists beside `encodeResponse`
 *
 * A DHT stores a value, not a frame. `encodeResponse({ kind: 'records', … })` produces a
 * *response* — it carries a `kind` and a `found` discriminant that mean nothing to a
 * key/value store, and a stored copy of them would be a frame pretending to be a record.
 * This pair encodes the record itself and nothing else.
 *
 * ## It reuses the frame's own builders, deliberately
 *
 * `certificateToValue` / `capabilitiesToValue` and `parseCertificate` /
 * `parseCapabilities` are the same functions the `records` response goes through. That is
 * the whole point: **a record has one encoding in this repository, not one per transport.**
 * A second builder would be a second thing to keep in step with the signature payloads,
 * and the failure would be silent — a record that verifies over one wire and not the other.
 *
 * ## Encoded once, then carried opaquely
 *
 * These bytes are the record's identity. Whatever envelope carries them — a libp2p DHT
 * `Record`, an RPC frame, a block — carries *these* bytes without decoding and re-encoding
 * them. Re-encoding is the cost worth avoiding; wrapping is a length prefix and a copy.
 *
 * ## What this does NOT do
 *
 * It does not verify. A caller that decodes a record off an untrusted index must still
 * check both signatures — `verifyCertificate` and `verifyCapabilityRecord` — exactly as it
 * would for a record that arrived over RPC. Decoding proves the bytes were well-formed and
 * says nothing whatever about who wrote them.
 *
 * @throws NotEncodableError if the record will not canonically encode, which is a defect in
 * this package rather than a statement about any peer — see the type's own docblock.
 */
export function encodeNodeRecords(records: NodeRecords): Uint8Array<ArrayBuffer> {
  const result = encodeCanonical({
    certificate: certificateToValue(records.certificate),
    capabilities: capabilitiesToValue(records.capabilities),
  })
  if (!result.ok) throw new NotEncodableError('node-records', result.error)
  return result.bytes
}

/**
 * Read back what {@link encodeNodeRecords} wrote, or `null` if it is not that.
 *
 * `null` covers every way the bytes can fail to be a record — not canonical CBOR, not a
 * map, a missing half, a field of the wrong type. The caller cannot act differently on any
 * of them, and a store returning bytes we cannot parse is one answer: *this is not a
 * record*.
 *
 * **Half a record is not a record**, which is `parseResponse`'s rule at its own `records`
 * branch and is repeated here rather than shared, because sharing it would mean routing a
 * stored value through a frame parser. A certificate with no capabilities leaves discovery
 * holding an identity with no claims; the reverse leaves claims with no identity.
 */
export function decodeNodeRecords(bytes: Uint8Array<ArrayBuffer>): NodeRecords | null {
  let value: CanonicalValue
  try {
    value = decodeCanonical(bytes)
  } catch {
    return null // not canonical CBOR at all
  }
  // `asRecord` is this file's own narrowing, used by every parser above. Reusing it is
  // what keeps "is this a map" answered one way rather than once per call site — it
  // already refuses arrays, byte strings and CIDs, each of which is an `object` that is
  // not a record.
  const record = asRecord(value)
  if (record === null) return null
  const certificate = parseCertificate(record['certificate'])
  const capabilities = parseCapabilities(record['capabilities'])
  if (certificate === null || capabilities === null) return null
  return { certificate, capabilities }
}
