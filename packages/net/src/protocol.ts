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
import { MAX_COMBINE_INPUTS, START_FAILURES, isStartBrowserLabel } from '@o2/core'
import type {
  CanonicalValue,
  CapabilityRecord,
  Delegation,
  Discoverability,
  EnrollmentRefusal,
  EnrollmentRequest,
  EnrollmentResult,
  ExecutionOutcome,
  NameRecord,
  NodeCapacity,
  NodeCertificate,
  NodeRecords,
  OutcomeCount,
  PublicKeyHex,
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

export type AgentResponse =
  | { readonly kind: 'exec'; readonly outcome: ExecutionOutcome }
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
   * The combine's result, or why it did not run.
   *
   * `resultCid: null` is not an error — it is the fallthrough signal the requestor
   * walks its rendezvous ranking on, so it keeps a `reason`: that string is the only
   * thing the requestor learns before trying the next executor.
   */
  | { readonly kind: 'combine'; readonly resultCid: CID | null; readonly reason: string }
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
  }
}

function enrollmentRequestToValue(request: EnrollmentRequest): CanonicalValue {
  return {
    nodeKey: request.nodeKey,
    userKey: request.userKey,
    operatorId: request.operatorId,
    discoverability: request.discoverability,
    relayIds: [...request.relayIds],
    proofOfPossession: request.proofOfPossession,
    ownerProof: request.ownerProof,
  }
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
  return {
    nodeKey,
    userKey,
    operatorId,
    discoverability: discoverability satisfies Discoverability,
    relayIds,
    proofOfPossession,
    ownerProof,
  }
}

/**
 * Encode an issuance outcome — a certificate, or the refusal that explains its absence.
 *
 * Each refusal arm carries the discriminant plus that kind's own fields and nothing
 * else, so a reader of the frame learns which of the three events happened and the one
 * value that identifies it. The `rate-limited` arm carries its `limit` and `windowMs`
 * deliberately: AUTH-04 asks for a *stated* threshold, and a threshold readable only
 * from the provider's source is not stated to the peer that hit it.
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
  }
}

function parseCapabilities(value: CanonicalValue | undefined): CapabilityRecord | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nodeKey, signature } = record
  if (typeof nodeKey !== 'string' || typeof signature !== 'string') return null
  const features = asKeyList(record['features'])
  const sovereignFor = asKeyList(record['sovereignFor'])
  const issuedAt = asFiniteNumber(record['issuedAt'])
  const expiresAt = asFiniteNumber(record['expiresAt'])
  if (features === null || sovereignFor === null) return null
  if (issuedAt === null || expiresAt === null) return null
  return { nodeKey, features, sovereignFor, issuedAt, expiresAt, signature }
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
  const { task } = request
  const base: { readonly [k: string]: CanonicalValue } = {
    kind: 'exec',
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
  if (request.capability === undefined) return vouched
  return { ...vouched, capability: request.capability.map(delegationToValue) }
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

  if (record['kind'] !== 'exec') return null
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
  if (capabilityValue === undefined) return { kind: 'exec', task }
  if (!Array.isArray(capabilityValue)) return null
  const capability: Delegation[] = []
  for (const value of capabilityValue) {
    const link = parseDelegation(value)
    // A malformed chain is refused outright rather than silently truncated to the
    // links that happened to parse.
    if (link === null) return null
    capability.push(link)
  }
  return { kind: 'exec', task, capability }
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
    case 'reservations':
      return { kind: 'reservations', peerIds: [...response.peerIds] }
    case 'combine':
      return response.resultCid === null
        ? { kind: 'combine', found: false, reason: response.reason }
        : { kind: 'combine', found: true, resultCid: response.resultCid, reason: response.reason }
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
    case 'exec':
      return response.outcome.ok
        ? {
            kind: 'exec',
            ok: true,
            output: response.outcome.output,
            fuelUsed: response.outcome.fuelUsed,
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
    case 'report': {
      const counts = parseCounts(record['counts'])
      if (counts === null) return null
      return { kind: 'report', counts, declined: asReportedCount(record['declined']) ?? 0 }
    }
    case 'combine': {
      const reason = record['reason']
      const stated = typeof reason === 'string' ? reason : 'unspecified'
      if (record['found'] !== true) return { kind: 'combine', resultCid: null, reason: stated }
      const resultCid = CID.asCID(record['resultCid'] ?? null)
      // Refused, not folded into the null arm. The null arm is the fallthrough signal
      // the requestor walks its ranking on, so a peer able to turn a corrupt answer
      // into an ordinary "I could not" would be indistinguishable from an honest one
      // that had nothing — and the requestor would count it as a normal miss.
      if (resultCid === null) return null
      return { kind: 'combine', resultCid, reason: stated }
    }
    case 'exec': {
      if (record['ok'] === true) {
        const output = record['output']
        const fuelUsed = record['fuelUsed']
        if (output === undefined || typeof fuelUsed !== 'number' || !Number.isFinite(fuelUsed)) {
          return null
        }
        return { kind: 'exec', outcome: { ok: true, output, fuelUsed } }
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
