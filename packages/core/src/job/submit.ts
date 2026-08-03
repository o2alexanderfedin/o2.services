/**
 * Job submission — MR-01, DATA-01, VER-06, DATA-03, DATA-04.
 *
 * A job is a module plus N shards. Each shard carries its own sovereignty label
 * and executes independently at the job's redundancy factor, and every shard's
 * inputs and outputs are content-addressed so an intermediate is cacheable,
 * dedupable, and recomputable from its CID alone. That last property is what
 * makes churn repair cheap in a later phase — a lost combine is "call the same
 * pure function somewhere else", with no state to migrate.
 *
 * Placement is decided by `sovereignty.ts`'s `planPlacement`/`eligibleNodes` —
 * the single, unit-verified place eligibility is decided. This module never
 * re-derives "who could run this"; it only narrows the executor pool to the
 * nodes the placement plan actually chose.
 *
 * Pure module: the blockstore and executors arrive as ports.
 */

import type { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { NodeCertificate } from '../enrollment.ts'
import type { NameRecord } from '../naming.ts'
import { planWithOffers } from '../placement.ts'
import type { AdmissionControl, Rejection } from '../placement.ts'
import type { Blockstore, Executor, Task } from '../ports.ts'
import { attestationRank, attestationReceipt } from '../quorum.ts'
import type { AttestationReceipt } from '../quorum.ts'
import { verifyResultAttestation } from '../result-attestation.ts'
import type { ResultWork } from '../result-attestation.ts'
import { planPlacement } from '../sovereignty.ts'
import type { NodeDescriptor, OwnerId, Placement, PlacementRequest } from '../sovereignty.ts'
import { executeVerified } from './verify.ts'
import type { AgreeingReplica, VerificationResult } from './verify.ts'

/** One shard's input, carrying the sovereignty label that constrains where it may run. */
export type ShardSpec =
  | { readonly value: CanonicalValue; readonly label: 'public' }
  | { readonly value: CanonicalValue; readonly label: 'sovereign'; readonly ownerId: OwnerId }

export interface JobSpec {
  readonly moduleCid: CID
  /**
   * The signed mapping that vouches for `moduleCid` (DET-03, DATA-08). Copied onto
   * every `Task` this job builds, sovereign and public alike.
   *
   * **Optional here, and deliberately unenforced here.** That is not convenience, and
   * the reason is worth stating because the project's standing rule is that an
   * optional field with a silent default is a hole. `submitJob` runs in the
   * *requestor's own process*. A requestor that omits the record is not attacking
   * anybody — it is about to have its job refused by every node it dispatches to.
   * Enforcing at this line would put the check on the side of the wire the attacker
   * sits on, which is precisely the mistake `guardSovereignty`'s docstring exists to
   * name: "a refusal can be made there rather than trusted to whoever dispatched the
   * task."
   *
   * The enforcement point is `guardModuleProvenance`
   * (`executor/module-provenance.ts`), composed unconditionally by every production
   * node. So omitting this is not harmless and it is not a silent downgrade: a job
   * submitted without a record fails at *every* node it reaches, each refusal naming
   * the missing signed record. Loud, and in the one place that can be trusted to say
   * it.
   */
  readonly moduleRecord?: NameRecord
  /** One shard per element. Length is the partition count. */
  readonly shards: readonly ShardSpec[]
  /**
   * Executors available to run shards. Which ones a given shard actually uses is
   * decided by placement (below), not by this list's order.
   */
  readonly executors: readonly Executor[]
  /**
   * Nodes placement may consider, correlated to `executors` by `nodeId`. Every
   * executor must have a matching descriptor — see `missing-node-descriptor`.
   */
  readonly nodes: readonly NodeDescriptor[]
  /**
   * Replicas requested per shard. 1 disables verification (VER-06). A shard
   * placed at fewer replicas than this is reported `degraded` rather than
   * failing the job — see `ShardResult.degraded`.
   */
  readonly redundancy: number
  /**
   * VER-03 / VER-04. What this caller wants when a public shard asked for
   * verification and the candidate set cannot compose a valid quorum.
   *
   * **Two named choices, and neither of them is "off".** A caller that does not much
   * care still writes one down, which is the whole reason this is required rather
   * than optional with a default — see the last section below.
   *
   * ## `'runs-at-available-redundancy'` — what degrading actually does
   *
   * The shard runs at whatever redundancy the eligible set yields, it is reported
   * `degraded` on its `ShardResult`, and its receipt reports the weaker attestation
   * strength. **The job does not fail.** A caller on this arm gets an answer plus an
   * accurate statement of how well it was checked.
   *
   * ## Why that is the default answer to an uncomposable quorum
   *
   * Phase 12 retired `not-enough-executors` precisely to stop a shard below its
   * requested redundancy from failing a whole job: it is placed at what is available
   * and marked degraded instead. A candidate set too concentrated to verify is the
   * same condition one step further out — and it is a condition the *caller does not
   * control*. Turning it into a refusal would put a refusal in front of the thing it
   * is about, which is the shape the retracted anchor rule had.
   *
   * ## Why degrading here is not silent
   *
   * Criterion 1's load-bearing word is *silently*, not *accepted*.
   * `classifyAttestation` labels a one-operator quorum `owner-attested`, and a
   * multi-certificate one-operator quorum `owner-domain`, rather than `independent` —
   * so the weaker outcome is named by construction, and `degraded` says so a second
   * time on the shard. Nothing about this arm hides anything; it reports a weaker
   * result as weaker.
   *
   * ## When to ask for `'refuses-the-shard'`
   *
   * Only when a weaker answer is worse to this caller than no answer at all — a
   * caller that genuinely requires independent verification and would rather have
   * nothing than something it cannot show to a third party. A caller that would go on
   * to use a degraded result anyway and asks for refusal has chosen to fail jobs it
   * would have accepted.
   *
   * ## Nothing reads this field yet
   *
   * Stated rather than left to be discovered. **Plan 19-06 is where an uncomposable
   * quorum starts consulting it**; until then both arms travel the submission path
   * identically and no branch anywhere tests them. That scheduled arrival is this
   * phase's established shape — Plans 19-13 and 19-14 each landed a type and its
   * fan-out one wave ahead of the code that read it.
   *
   * ## Required rather than optional, and the reason is measured
   *
   * `.planning/PROJECT.md`'s Key Decision **"An optional hook with a silent default is
   * a hole"**, and here the hole has a specific shape this phase has already fallen
   * into twice. Plans 19-01 and 19-13 each made a field optional and omitted it, and
   * each observed **`tsc --noEmit` exit 0 while the behavioural assertion failed**. An
   * optional strictness field would let every existing call site mean *degrade*
   * without ever having said so — a whole tree of callers holding a position none of
   * them stated. Note also that this belongs on `JobSpec` and not on `SubmitOptions`:
   * that object is optional *as a whole*, so a required property inside it would still
   * be omittable by omitting the object, which is the same defect one level down.
   */
  readonly onQuorumShortfall: 'runs-at-available-redundancy' | 'refuses-the-shard'
  /**
   * Consulted before a shard is placed on a node — SCHED-02, SCHED-03.
   *
   * **Present** means every shard is placed by `planWithOffers`: sample `d`
   * candidates by rendezvous rank, take the least-loaded of the sample, offer, and
   * re-pick on refusal, bounded across the shards of this job by what each node
   * published about its own room. **Absent** means `planPlacement` as before — order
   * every eligible node by load and take the best.
   *
   * ## Criterion 5 holds on both arms, and is not what chooses between them
   *
   * `placeWithOffers` calls `eligibleNodes` as its first act (`placement.ts:230`) and
   * `planPlacement` calls the same function first (`sovereignty.ts:169`). That
   * function is exported *"so that there is exactly one of it"*
   * (`sovereignty.ts:124-128`). So sovereignty is filtered before cost is scored on
   * both arms, because on both arms it is filtered by the same line — and a reader
   * looking for the arm that is "the safe one" will not find it, because neither is.
   *
   * ## They are alternatives, and are never composed
   *
   * `planPlacement` returns `ordered.slice(0, redundancy)` (`sovereignty.ts:185`), so
   * feeding its output into `placeWithOffers` would hand the offer loop a pool already
   * narrowed to exactly the nodes it chose — leaving **nothing to re-pick onto**,
   * which is the one behaviour the offer arm exists to have. It would also score cost
   * twice. This is written down because "compose them" is the obvious next idea and it
   * silently removes the re-pick.
   *
   * ## Why optional here is not a hole
   *
   * In the terms `moduleRecord`'s doc above already uses on this same interface:
   * `submitJob` runs in the **requestor's own process**. A requestor that omits this
   * is not attacking anybody — it places without probing, which is what every caller
   * in this repository did before this phase. The bound that binds a *peer* is the
   * serving node's own `LocalCapacity` on `serveAgent`'s `exec` branch, which is
   * unconditional, authoritative, and unaffected by anything a requestor supplies or
   * omits. The absence is also *asserted* rather than reached by omission — see
   * *"a caller that made no offers gets an empty refusal list"* in `submit.test.ts`.
   *
   * ## The limit, in one sentence
   *
   * A requestor that supplies this bounds **itself**; a dishonest one still
   * over-commits and is refused for real at `exec`.
   */
  readonly admit?: AdmissionControl
}

/**
 * The named statement that this requestor holds no verified signed statement about
 * who produced a result — VER-08, VER-09, VER-10.
 *
 * **A statement, never a default.** It says something specific and true: *this
 * requestor cannot account, from signatures it checked, for who ran this shard.* That
 * is a fact about the requestor's own knowledge, not about the nodes — every node in
 * this fabric has equal functionality, and a node reporting `'signed-by-nobody'` is an
 * ordinary node whose executor holds no identity. Reading it as a weak strength would
 * be the conflation this whole phase exists to end, one level down: `owner-attested`
 * over one verified replica of three *sounds stronger* than the truth, which is that
 * two of them are unaccounted for.
 *
 * **It carries its counts because the label alone cannot be acted on.** `agreeing` is
 * how many replicas matched, `verified` how many of those produced a signature that
 * checked out. `0 of 2` and `1 of 2` are different situations with different remedies,
 * and a bare literal would make them the same word.
 */
export interface NoVerifiedAttestation {
  readonly kind: 'holds-no-verified-attestation'
  /** Why, in this module's own words, naming each replica that was not counted. */
  readonly reason: string
  /** Replicas whose outputs matched. `0` when the shard never agreed. */
  readonly agreeing: number
  /** Of those, how many carried a signature over this result that this requestor checked. */
  readonly verified: number
}

/**
 * What a result is attested by, or the named statement that nothing was.
 *
 * **Derived from checked signatures, never declared.** `quorum.ts`'s own doc gives the
 * reason: *a caller that could declare a result independently verified would eventually
 * declare one that was not.* So the receipt arm here is built by
 * `attestationReceipt(...)` over certificates whose holders' signatures over **this
 * task and this output** verified, and there is no path by which a caller supplies one.
 *
 * **It reads the AGREEING set, not the placed set.** A node that was placed and then
 * failed attested nothing, and counting it would report redundancy the result does not
 * have.
 *
 * **What a signature does not say.** It says a certified node computed this output. It
 * says nothing about whether the output is *correct* — correctness is `executeVerified`'s
 * N-version comparison, and a signature on a wrong answer is a signed wrong answer,
 * signed just as convincingly as a right one. Somebody will read "results are signed
 * now" and propose reducing redundancy; attribution tells you whom to stop trusting
 * *after* you know the answer was wrong, and the only thing here that tells you it was
 * wrong is a second independent execution.
 *
 * **This is the map half's receipt and it is NOT the aggregate's.** `submitJob` does not
 * reduce; `reduceJob` is a separate entry point whose aggregation carries its own claim,
 * verified from combine signatures. The two are not one restated — `PROJECT.md`'s split
 * means a sovereign map is `owner-attested` by construction while the aggregation over
 * it can be redundant, so they routinely differ. `reduce.ts`'s own header already writes
 * that split down. Do not unify them.
 */
export type ShardAttestation = AttestationReceipt | NoVerifiedAttestation

export interface ShardResult {
  readonly partitionIndex: number
  readonly inputCid: CID
  readonly verification: VerificationResult
  /**
   * True when this shard's achieved redundancy is below `JobSpec.redundancy`.
   *
   * This field used to say in prose that a degraded shard which nonetheless agreed *"is
   * owner-attested, not independently confirmed"*. {@link ShardResult.attestation} now
   * says so as a **value**, so the prose is gone rather than kept beside it.
   *
   * **The two are not the same test, and neither can be inferred from the other.**
   * `degraded` compares the redundancy achieved against what was **asked for**; the
   * receipt reports what was **established**. A shard can be undegraded and still
   * `owner-domain` — full redundancy across one owner's own nodes is exactly that.
   *
   * See `sovereignty.ts`'s `Placement.degraded` for why this is reported rather than
   * silently tolerated.
   */
  readonly degraded: boolean
  /**
   * How strongly this shard's result is attested, or the named absence.
   *
   * See {@link ShardAttestation}. Required rather than optional: an omitted receipt read
   * as "attested" would make an unsigned result indistinguishable from a signed one at
   * the exact point the distinction is the product.
   */
  readonly attestation: ShardAttestation
  /**
   * The refusals collected on the way to placing this shard, in order, each in the
   * refusing node's own words — SCHED-03.
   *
   * `[]` for a caller that supplied no `JobSpec.admit`, and that is a **truthful
   * answer rather than a default**: no offer was made, so nothing refused. It is also
   * `[]` for a shard held back by the cross-shard headroom bound, for the same reason
   * — a node held back was never asked, so it never refused (`placement.ts`'s
   * `planWithOffers` composes that reason on the placement, never on a `Rejection`).
   *
   * Populated on the placed and unplaceable arms alike: a shard nobody would take is
   * the case where knowing *why* matters most.
   */
  readonly rejections: readonly Rejection[]
}

export interface JobResult {
  readonly moduleCid: CID
  readonly shards: readonly ShardResult[]
  /**
   * The **weakest** of this job's shard receipts, or the named absence if any shard
   * carries one.
   *
   * A job is no stronger than its weakest shard: a caller shown `independent` for a job
   * one of whose shards ran once would be told the stronger guarantee on the strength of
   * the weaker one. The comparison goes through `attestationRank` rather than through a
   * remembered string order, which is what that function exists for.
   */
  readonly attestation: ShardAttestation
  /** True only if every shard reached `agreed` at its full requested redundancy. */
  readonly complete: boolean
  /** Node-seconds spent including redundant work. */
  /**
   * Fuel spent including redundant work — **not seconds**.
   *
   * Fuel is bytes moved across the guest ABI (see `WasmExecutor`), chosen because it
   * is deterministic where wall time is not. These fields were once called
   * `grossNodeSeconds`/`usefulNodeSeconds`, which named a unit they never carried; a
   * benchmark publishing them as seconds would have been wrong by a factor nobody
   * could have guessed. Renamed rather than documented, because a comment does not
   * travel with the number into a report.
   *
   * The *ratio* is meaningful whatever the unit, which is why
   * `verificationMultiplier` was correct all along.
   */
  readonly grossFuel: number
  /** Node-seconds that contributed to the answer. */
  /** Fuel that contributed to the answer. Same unit as `grossFuel`. */
  readonly usefulFuel: number
  /**
   * Measured verification tax: gross / useful. Reported on every job so the cost
   * of verification is always visible rather than discovered later (VER-06).
   */
  readonly verificationMultiplier: number
}

export type SubmitError =
  | { kind: 'no-shards' }
  | { kind: 'bad-redundancy'; redundancy: number }
  | { kind: 'input-not-encodable'; partitionIndex: number; detail: string }
  /** An executor has no matching `NodeDescriptor` — refused rather than let it slip past placement by omission. */
  | { kind: 'missing-node-descriptor'; nodeId: string }
  /**
   * A `'sovereign'` shard reached here with no usable owner id. Only reachable
   * via an `as ShardSpec` cast, since the discriminated union forbids this at
   * compile time — this is the runtime backstop for that cast (T-12-01).
   */
  | { kind: 'shard-missing-owner'; partitionIndex: number }

export type SubmitResult =
  | { ok: true; job: JobResult }
  | { ok: false; error: SubmitError }

/**
 * Build a `PlacementRequest` for one shard without ever assigning an explicit
 * `undefined` to `ownerId` — `exactOptionalPropertyTypes` makes that a
 * different type from omitting the field, and `eligibleNodes` treats a
 * sovereign request whose owner is missing as *broken* rather than
 * unrestricted. Mirrors `coordinator.ts`'s `requestFor`.
 */
function requestFor(shard: ShardSpec, shardId: string, redundancy: number): PlacementRequest {
  return shard.label === 'sovereign'
    ? { shardId, label: shard.label, ownerId: shard.ownerId, redundancy }
    : { shardId, label: shard.label, redundancy }
}

/** A shard that produced no agreement produced nothing to attest. */
function noAgreementToAttest(status: string): NoVerifiedAttestation {
  return {
    kind: 'holds-no-verified-attestation',
    reason: `this shard is ${status} rather than agreed, so there is no agreement to attest`,
    agreeing: 0,
    verified: 0,
  }
}

/**
 * Build a shard's receipt from the replicas that agreed **and proved it**.
 *
 * Four questions per agreeing replica, each with its own name when the answer is no.
 * They are separate because a reader told only "not counted" would go looking at the
 * signature when the real answer is that this requestor holds no certificate for the
 * node at all.
 *
 * 1. **Does this requestor hold a certificate for that node?** The trust anchor is the
 *    descriptor's own `certificate` field, and deliberately **not** a `trustedIssuers`
 *    argument on `submitJob`. The pinned-issuer decision was already made, and already
 *    applied, where the certificate entered — `discoverCandidates`, which verifies
 *    against `trustedIssuers` at the discovery seam. Threading a second issuer set in
 *    here would create *a second place the same decision is made*, which can disagree
 *    with the first with nothing able to catch the disagreement — the same argument that
 *    rejected a parallel `nodeId → certificate` map. It also keeps four production
 *    submitters unchanged, which is the argument that rejected threading certificates
 *    through `JobSpec`.
 * 2. **Did the executor sign anything?** `'signed-by-nobody'` is a truthful statement by
 *    an executor nobody enrolled, not a signature that failed. A replica that signs
 *    nothing has said nothing, and that is not misconduct.
 * 3. **Is the certificate presented the one this node was discovered under?** It looks
 *    redundant beside question 4 and is not: without it a node could answer under some
 *    *other* certificate of its own, and the receipt would report an operator — or a
 *    user key — that this requestor never placed anything with.
 *
 *    Compared on `nodeKey` rather than on the whole certificate, because byte equality
 *    is wrong in one real case: a node that **re-enrolled** between discovery and
 *    execution answers under a fresher certificate with a later `issuedAt`, and a shard
 *    would fall to the named absence though nothing dishonest happened. Pinning *which
 *    node* and then verifying the presented certificate on its own terms accepts the
 *    fresher one and still refuses a substituted one.
 *
 *    **The issuer half is carried by the pinned set below, not by a second comparison
 *    here.** `verifyResultAttestation` is handed exactly the descriptor's own issuer, so
 *    a certificate from any other provider is refused by name as `untrusted-issuer`. An
 *    `issuer !== issuer` test beside it would be a branch nothing could reach, and this
 *    module's neighbours record what a check that cannot fire costs: it reads as a
 *    guarantee while guarding nothing. Widening that set — to every issuer this
 *    requestor knows, say — is what would make such a comparison live again, and is
 *    exactly the change that must not be made quietly.
 * 4. **Does the signature check out over THIS work?** The challenge is rebuilt from the
 *    caller's own task and from `verification.resultCid` — never from anything the
 *    attestation supplies, or it would verify against itself every time. `resultCid` is
 *    the right output to rebuild with because every agreeing replica hashed to it; that
 *    is what agreement means, so no shard output is re-hashed here.
 *
 * A **partial** verification returns the named absence rather than a receipt over
 * whatever happened to check out. A receipt over the subset would overstate or
 * understate, and which of the two would depend on an accident.
 *
 * The transferable half survives this local shortcut: the attestation carries the whole
 * certificate on the wire, so a third party holding only the provider's public key can
 * check the same statement without any of this requestor's descriptors. The shortcut is
 * about what *this* requestor already knows, not about what the artifact contains.
 */
function receiptFor(
  agreeing: readonly AgreeingReplica[],
  work: ResultWork,
  descriptors: ReadonlyMap<string, NodeDescriptor>,
  now: number,
): ShardAttestation {
  const verified: NodeCertificate[] = []
  const unaccounted: string[] = []

  for (const replica of agreeing) {
    const descriptor = descriptors.get(replica.nodeId)
    if (descriptor === undefined) {
      unaccounted.push(`${replica.nodeId}: this requestor holds no descriptor for it`)
      continue
    }
    if (descriptor.certificate === 'carries-no-certificate') {
      unaccounted.push(`${replica.nodeId}: this requestor holds no certificate for it`)
      continue
    }
    if (replica.attestation === 'signed-by-nobody') {
      unaccounted.push(`${replica.nodeId}: the executor stated that it signs nothing`)
      continue
    }
    if (replica.attestation.certificate.nodeKey !== descriptor.certificate.nodeKey) {
      unaccounted.push(
        `${replica.nodeId}: answered under node key ${replica.attestation.certificate.nodeKey}, ` +
          `which is not the ${descriptor.certificate.nodeKey} it was discovered under`,
      )
      continue
    }
    const checked = verifyResultAttestation(
      replica.attestation,
      work,
      new Set([descriptor.certificate.issuer]),
      now,
    )
    if (!checked.ok) {
      unaccounted.push(`${replica.nodeId}: ${checked.reason}`)
      continue
    }
    verified.push(checked.certificate)
  }

  if (unaccounted.length > 0 || verified.length === 0) {
    return {
      kind: 'holds-no-verified-attestation',
      reason:
        verified.length === 0
          ? `no agreeing replica produced a signed statement this requestor could check — ${unaccounted.join('; ')}`
          : `only ${verified.length} of ${agreeing.length} agreeing replicas produced a signed ` +
            'statement this requestor could check, and a strength over that subset would state ' +
            `something this requestor cannot account for — ${unaccounted.join('; ')}`,
      agreeing: agreeing.length,
      verified: verified.length,
    }
  }

  // `attestationReceipt` reports `replicas` from `agreeing.length` and does not dedupe,
  // so two entries for one node would report redundancy the result does not have. The
  // invariant belongs here and not in `quorum.ts`: that module is a pure report over
  // whatever it is handed, and a dedupe inside it would silently repair an assembly bug
  // instead of failing on one. Unreachable through `executeVerified`, which produces one
  // entry per executor and whose executors are keyed by node id one function up — which
  // is why this throws rather than returning a value: it is a defect in this module's own
  // assembly, not a verdict about anything a peer sent, the same call `NotEncodableError`
  // and `WrongSigningKeyError` already make in this package.
  if (new Set(verified.map((certificate) => certificate.nodeKey)).size !== verified.length) {
    throw new Error(
      'two agreeing replicas of one shard verified under the same node key — a receipt built ' +
        'from this set would report redundancy the result does not have',
    )
  }

  return attestationReceipt(verified)
}

/** A job is no stronger than its weakest shard. */
function jobAttestationOf(shards: readonly ShardResult[]): ShardAttestation {
  const absent = shards.find((shard) => 'kind' in shard.attestation)
  if (absent !== undefined) return absent.attestation
  return shards.reduce((weakest, shard) => {
    if ('kind' in weakest.attestation || 'kind' in shard.attestation) return weakest
    return attestationRank(shard.attestation.strength) < attestationRank(weakest.attestation.strength)
      ? shard
      : weakest
  }, shards[0] as ShardResult).attestation
}

/**
 * Submit a job: shard it, place each shard, execute redundantly, verify, return CIDs.
 *
 * Shards run concurrently — they share no state by construction, which is the
 * whole reason the partition is the unit of parallelism.
 */
export interface SubmitOptions {
  /**
   * Where to record that a shard's bytes are sovereign — DATA-10's at-rest half.
   *
   * Optional, and the omission is real rather than a hole: `task-worker.ts` hard-codes
   * `label:'public'` shards into a `MemoryBlockstore`, so it has nothing sovereign to
   * record and no durable place to record it. A caller handling sovereign shards that
   * omits this keeps the pre-13.1 behaviour — it holds the row and nothing guards it —
   * which is why `sovereign-block-refusal.node.test.ts` pins the set of files allowed to
   * call this function at all.
   */
  readonly sovereignCids?: { add(cid: string): Promise<void> }
}

export async function submitJob(
  spec: JobSpec,
  blockstore: Blockstore,
  options?: SubmitOptions,
): Promise<SubmitResult> {
  if (spec.shards.length === 0) return { ok: false, error: { kind: 'no-shards' } }
  if (!Number.isInteger(spec.redundancy) || spec.redundancy < 1) {
    return { ok: false, error: { kind: 'bad-redundancy', redundancy: spec.redundancy } }
  }

  const execByNodeId = new Map(spec.executors.map((e) => [e.nodeId, e] as const))
  // Beside it, and for the receipt rather than for placement: the descriptor is where
  // this requestor's certificate for a node lives, and therefore where the question
  // "did the node that answered me answer under the certificate I discovered it with?"
  // is settled. See {@link receiptFor}.
  const descriptorByNodeId = new Map(spec.nodes.map((n) => [n.nodeId, n] as const))
  for (const executor of spec.executors) {
    if (!spec.nodes.some((n) => n.nodeId === executor.nodeId)) {
      return { ok: false, error: { kind: 'missing-node-descriptor', nodeId: executor.nodeId } }
    }
  }
  // Descriptors with no matching executor are simply excluded from placement —
  // a known node that isn't participating in this job, not an error.
  const candidateNodes = spec.nodes.filter((n) => execByNodeId.has(n.nodeId))

  for (const [i, shard] of spec.shards.entries()) {
    if (shard.label === 'sovereign' && (typeof shard.ownerId !== 'string' || shard.ownerId.length === 0)) {
      return { ok: false, error: { kind: 'shard-missing-owner', partitionIndex: i } }
    }
  }

  const partitionCount = spec.shards.length

  // One instant for the whole job, so two shards cannot disagree about whether a
  // certificate had expired.
  //
  // **This module reads the wall clock, once, and nothing else about it.** It is the
  // first read of a platform clock in `packages/core/src`, and it is deliberate rather
  // than incidental: deciding whether a certificate's validity window is open is the
  // *requestor's* call about its own willingness to count a statement, which is the same
  // call `peer-verifier.ts` makes with `Date.now()` directly. The alternatives were both
  // worse. A clock on `SubmitOptions` would be omittable by omitting the object — the
  // required-field-inside-an-optional-object defect, one level down. A clock on `JobSpec`
  // would be a ninety-four-site fan-out for a value every one of them would fill with
  // this same expression.
  const now = Date.now()

  // Persist every shard input as a block first, so a task is addressed entirely
  // by CID and could be re-dispatched to any node without resending the payload.
  const inputCids: CID[] = []
  for (let i = 0; i < partitionCount; i++) {
    const encoded = await canonicalCid((spec.shards[i] as ShardSpec).value)
    if (!encoded.ok) {
      return {
        ok: false,
        error: {
          kind: 'input-not-encodable',
          partitionIndex: i,
          detail: JSON.stringify(encoded.error),
        },
      }
    }
    await blockstore.put(encoded.bytes)
    // DATA-10, and this is the boundary the node owns. `submit-with-egress.ts` names it
    // as the fix a later phase would make, in exactly these words: *register at a boundary
    // the node owns — the blockstore-put of a shard labelled sovereign*.
    //
    // Here rather than in the guarded wrapper, because THIS is the line that makes the
    // submitter hold the row. A submitter reaching the fabric through bare `submitJob`
    // used to put another owner's raw bytes into its own store and record nothing, and
    // `sovereignty-placement.node.test.ts` has been driving that path and passing for
    // exactly that reason. Registering where the put happens covers every caller instead
    // of every caller that remembered.
    //
    // The bytes are already in hand, so this costs a set insert and one append — the
    // second canonicalisation `submit-with-egress.ts` pays is not repeated here.
    if ((spec.shards[i] as ShardSpec).label === 'sovereign' && options?.sovereignCids !== undefined) {
      await options.sovereignCids.add(encoded.cid.toString())
    }
    inputCids.push(encoded.cid)
  }

  // Placement pass — TWO ARRANGEMENTS OF ONE GATE, selected by whether the caller
  // supplied a way to ask a node anything. What the two arms share is the whole of
  // the rule: both build their `PlacementRequest`s through the same `requestFor`,
  // both hand them to a placer whose first act is `eligibleNodes`, and neither
  // re-derives who could run a shard — this module's standing rule, stated at
  // :11-14. What differs is only how an already-eligible set is narrowed to a
  // choice. They are alternatives and are never composed; `JobSpec.admit`'s doc
  // carries the line that makes composing them lose the re-pick.
  const shardPlacements: Placement[] = []
  // One empty list per shard. On the no-offer arm that is what survives, and it is a
  // truthful reading rather than a default: no offer was made, so nothing refused.
  let shardRejections: readonly (readonly Rejection[])[] = spec.shards.map(() => [])

  if (spec.admit === undefined) {
    // Sequential and synchronous; only execution below needs concurrency.
    // `dispatchCount` spreads shards across a public job's node set the way the old
    // round-robin did, by nudging the load `planPlacement` orders on — it can never
    // widen who is *eligible*, only reorder who is chosen first among
    // already-eligible nodes.
    const dispatchCount = new Map<string, number>()
    for (let i = 0; i < partitionCount; i++) {
      const shard = spec.shards[i] as ShardSpec
      const request = requestFor(shard, String(i), spec.redundancy)
      const nodesForShard = candidateNodes.map((n) => ({
        ...n,
        load: n.load + (dispatchCount.get(n.nodeId) ?? 0),
      }))
      const plan = planPlacement([request], nodesForShard)
      const placement = plan.placements[0] as Placement
      if (placement.status === 'placed') {
        for (const nodeId of placement.nodeIds) {
          dispatchCount.set(nodeId, (dispatchCount.get(nodeId) ?? 0) + 1)
        }
      }
      shardPlacements.push(placement)
    }
  } else {
    // `d` is deliberately not a `JobSpec` field: `placeWithOffers` defaults to
    // `DEFAULT_D`, and what SCHED-02 asks is that placement sample *multiple*
    // candidates — which two is. A knob nobody sets is a knob that drifts from the
    // tests. There is no `dispatchCount` nudge here either: the offer arm's spread
    // comes from the per-shard rendezvous ranking and from the headroom each node
    // published, both of which are better information than a local tally.
    const requests = spec.shards.map((shard, i) => requestFor(shard, String(i), spec.redundancy))
    const offered = await planWithOffers(requests, candidateNodes, { admit: spec.admit })
    shardRejections = offered.map((placement) => placement.rejections)
    for (const placement of offered) shardPlacements.push(placement)
  }

  const shards = await Promise.all(
    inputCids.map(async (inputCid, partitionIndex): Promise<ShardResult> => {
      const placement = shardPlacements[partitionIndex] as Placement
      const rejections = shardRejections[partitionIndex] as readonly Rejection[]
      if (placement.status === 'unplaceable') {
        return {
          partitionIndex,
          inputCid,
          // The reason reaches the caller exactly as an unplaceable shard's always
          // has; what is new is that the refusals that produced it are visible
          // beside it, so "nobody would take it" is distinguishable from "there was
          // nobody".
          verification: { status: 'insufficient', reason: placement.reason, failures: [] },
          degraded: false,
          rejections,
          attestation: noAgreementToAttest('unplaceable'),
        }
      }

      const shard = spec.shards[partitionIndex] as ShardSpec
      const selectedExecutors = placement.nodeIds.map((nodeId) => execByNodeId.get(nodeId) as Executor)
      // Built once and spread into both branches. Never `moduleRecord: spec.moduleRecord`
      // inline — see `requestFor` above for why an explicit `undefined` is a different
      // thing here from an omitted field; downstream, `encodeRequest` would put the
      // first on the wire as a present-but-empty key.
      const provenance = spec.moduleRecord === undefined ? {} : { moduleRecord: spec.moduleRecord }
      const task: Task =
        shard.label === 'sovereign'
          ? {
              moduleCid: spec.moduleCid,
              inputCid,
              partitionIndex,
              partitionCount,
              label: shard.label,
              ownerId: shard.ownerId,
              ...provenance,
            }
          : {
              moduleCid: spec.moduleCid,
              inputCid,
              partitionIndex,
              partitionCount,
              label: shard.label,
              ...provenance,
            }
      const verification = await executeVerified(task, selectedExecutors)
      // Persist an agreed result so it is retrievable by CID like any other block.
      if (verification.status === 'agreed') {
        const out = await canonicalCid(verification.output)
        if (out.ok) await blockstore.put(out.bytes)
      }
      // The receipt, built from the agreeing replicas' checked signatures. `resultCid` is
      // the output every one of them hashed to — that is what agreement means — so the
      // challenge is rebuilt from this requestor's own task and that CID, and nothing the
      // attestations carry is used to say what they are about.
      const attestation =
        verification.status === 'agreed'
          ? receiptFor(
              verification.agreeing,
              {
                moduleCid: spec.moduleCid,
                inputCid,
                partitionIndex,
                outputCid: verification.resultCid,
              },
              descriptorByNodeId,
              now,
            )
          : noAgreementToAttest(verification.status)
      return { partitionIndex, inputCid, verification, degraded: placement.degraded, rejections, attestation }
    }),
  )

  let gross = 0
  let useful = 0
  for (const s of shards) {
    if (s.verification.status === 'agreed') {
      gross += s.verification.grossFuel
      useful += s.verification.usefulFuel
    }
  }

  return {
    ok: true,
    job: {
      moduleCid: spec.moduleCid,
      shards,
      attestation: jobAttestationOf(shards),
      complete: shards.every((s) => s.verification.status === 'agreed' && !s.degraded),
      grossFuel: gross,
      usefulFuel: useful,
      verificationMultiplier: useful === 0 ? 0 : gross / useful,
    },
  }
}
