/**
 * `reduceSovereignJob` — the sovereign arm of the aggregation. MR-02.
 *
 * `PROJECT.md` splits the integrity claim in two, and the split is the whole design:
 *
 * | Data | Mechanism |
 * |---|---|
 * | Public / shared | Full N-version redundant execution with commit-reveal |
 * | Sovereign (owner-pinned) | Map is **owner-attested**; the aggregation *over* contributions is verified |
 *
 * Stated plainly: *the owner's contribution is trusted; the aggregation over
 * contributions is verified.* Phase 16 built the aggregation and only ever ran it over
 * **public** shards — `tree-reduce-agents.node.test.ts` says so against its own interest
 * — so the second row of that table had never executed. This module is that row.
 *
 * ## What "verified aggregation" means here, precisely
 *
 * Three statements, each with a mechanism, and none of them standing in for another.
 *
 * **1. The map is owner-attested, and this module admits a partial on nothing weaker.**
 * A sovereign shard's partial is admitted only when `ShardResult.attestation` is a
 * receipt — a real one, built by `receiptFor` from signatures over *this task and this
 * output*, verified against the issuer each node's own descriptor names — and only when
 * the user keys in that receipt are exactly the one owner the shard was pinned to.
 * `NodeDescriptor.ownerId` **is** `certificate.userKey` on any descriptor
 * `discoverCandidates` built, so the check compares two independently derived facts: what
 * the requestor asked for, and what the certified executor turned out to be. A requestor
 * that hand-built its descriptors — `publicNodes` does, with `ownerId: 'public'` — can
 * widen the first; it cannot forge the second.
 *
 * **2. The aggregation over those partials is redundantly executed and signed.** A
 * sovereign *map* cannot be N-version verified: pinning removes the second independent
 * executor by construction. A *combine* can, because it reads only content-addressed
 * partials and is runnable anywhere. So this arm requires `redundancy >= 2` and refuses
 * a reduction whose weakest combine achieved fewer replicas than that, and it carries
 * `reduceJob`'s `aggregateAttestation` unchanged — the weakest combine's receipt, over
 * statements this requestor verified itself.
 *
 * **3. The sovereignty claim is carried by the egress manifest and the coverage report,
 * never by a quorum.** A quorum over one owner's two nodes resists nothing, which is why
 * `VER-02`'s commit-reveal excludes sovereign shards by design and why nothing here
 * weakens that. What stands in its place: every supplied {@link EgressManifest} must
 * report no violation *and* must report having watched at least this job's owner-pinned
 * rows (`registeredSovereign`, EGR-01) — a manifest reporting zero registrations for a
 * job with sovereign shards is a guard that was never given them, which is the difference
 * EGR-01 exists to make visible. The aggregate then comes back as a
 * {@link CoveredAggregate}, so the number cannot be read without the owners it was
 * computed over.
 *
 * ## What this module does NOT establish, stated rather than left to be assumed
 *
 * - **It does not verify the map's arithmetic.** A signature says a node the owner
 *   controls produced this output. Nothing here says the output is right, and nothing
 *   can: that is what the sovereign half of the split gives up in exchange for the data
 *   never moving.
 * - **It does not verify the projection.** `reduceJob`'s header carries the full
 *   treatment; the gap is the requestor's own projection of a shard output into a
 *   partial, which the aggregation cannot see.
 * - **It does not prove that no raw byte left an owner's node.** The egress guard is a
 *   detector and says so in its own module comment. What a clean manifest reports is that
 *   the guard was watching *n* registered payloads and that no frame it was offered
 *   carried one.
 * - **It reads manifests the caller hands it.** A manifest from a node this requestor
 *   does not run is that node's own account of itself. The manifests
 *   `submitJobWithEgress` returns are the requestor's own guard's, which is the only
 *   guard any in-process caller can reach.
 *
 * Pure module.
 */

import { withCoverage } from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  CoveredAggregate,
  JobResult,
  JobSpec,
  OwnerId,
  ReduceOutcome,
  ReduceTree,
  ShardResult,
} from '@o2/core'
import type { CID } from 'multiformats/cid'
import type { EgressManifest } from './egress.ts'
import { reduceJob } from './reduce-job.ts'
import type { AggregateAttestation, CombineTrustAnchors } from './reduce-job.ts'
import type { RpcEndpoint } from './rpc.ts'

/**
 * Replicas every combine in a sovereign reduction must achieve.
 *
 * **Two, and it is the minimum that makes the word "verified" true rather than a
 * preference.** One executor performing a merge and signing it produces a statement that
 * a merge happened; it produces no comparison, so there is nothing for `executeReduce`'s
 * `disagreements` arm to detect. `ReduceRun.redundancy`'s own docstring names this as
 * the field that carries the verification claim for sovereign data.
 *
 * It is deliberately **not** a ceiling and not a default: a caller may ask for more, and
 * a caller asking for less is refused by name rather than quietly upgraded.
 */
export const MIN_SOVEREIGN_COMBINE_REPLICAS = 2

/**
 * The egress manifests this requestor holds for the job, or the named absence.
 *
 * **Required with a named sentinel, and the sentinel is refused.** That reads odd until
 * the alternative is written down: an optional field would let a caller reach a
 * sovereign aggregate without ever stating whether anything watched the owner-pinned
 * rows, and this module would then have to decide on its behalf — which is the silent
 * default `.planning/PROJECT.md` forbids. So the caller writes the words, and this
 * module answers what they cost: a reduction with no manifest cannot carry the
 * sovereignty claim, because the claim *is* the manifest and the coverage report. A
 * caller that does not intend to make the claim wants {@link reduceJob}, which makes
 * none.
 */
export type SovereignEgressEvidence =
  | readonly EgressManifest[]
  | 'holds-no-egress-manifest'

export interface SovereignReduceOptions {
  readonly rpc: RpcEndpoint
  /** Peer ids of the connected agents that may perform combines. See {@link reduceJob}. */
  readonly executors: readonly string[]
  /** The requestor's LOCAL store. See `ReduceJobOptions.blockstore` for its three jobs. */
  readonly blockstore: Blockstore
  /** Per-job projection from an agreed shard output to a `{counts, rows}` partial. */
  readonly project: (output: CanonicalValue, partitionIndex: number) => CanonicalValue
  readonly fanout?: number
  /**
   * Replicas per combine. Defaults to {@link MIN_SOVEREIGN_COMBINE_REPLICAS} and is
   * refused below it — see that constant.
   */
  readonly redundancy?: number
  /** The issuers this requestor accepts combine certificates from. See {@link CombineTrustAnchors}. */
  readonly trustedIssuers: CombineTrustAnchors
  /** See {@link SovereignEgressEvidence}. */
  readonly egress: SovereignEgressEvidence
}

/** What one owner contributed, and what this requestor checked before admitting it. */
export interface SovereignContribution {
  readonly ownerId: OwnerId
  readonly partitionIndex: number
  /** The address of the partial projected from this owner's shard output. */
  readonly partialCid: CID
  /**
   * Operators of the certified nodes that ran this owner's map.
   *
   * Recorded because it is the one thing the receipt says that placement does not: an
   * owner running two machines under two operator ids has an `independent` map, and an
   * owner with one has not. It qualifies the *owner-attested* half rather than upgrading
   * it — see this module's header.
   */
  readonly operators: readonly string[]
}

/** The aggregate itself. Only ever reachable through a {@link CoveredAggregate}. */
export interface SovereignAggregate {
  readonly outcome: ReduceOutcome
  readonly tree: ReduceTree
  /** Contributions admitted, one per agreed sovereign shard, in partition order. */
  readonly contributions: readonly SovereignContribution[]
  /** How strongly the **aggregation** is attested. Never the map half's receipt. */
  readonly aggregateAttestation: AggregateAttestation
  /** What the supplied manifests reported. See {@link SovereignEgressReading}. */
  readonly egress: SovereignEgressReading
}

/**
 * What the egress manifests said, kept beside the aggregate rather than checked and
 * discarded.
 *
 * A refusal already fired for a violation or a shortfall, so these fields describe a
 * clean reading — and a clean reading is exactly the thing that is worth carrying,
 * because `violations.length === 0` alone cannot tell *this run registered no sovereign
 * data* from *this run registered sovereign data and none of it left*. That is EGR-01's
 * whole subject, and it is why {@link registeredSovereign} travels here rather than being
 * recomputed from anything.
 */
export interface SovereignEgressReading {
  /** Manifests read. */
  readonly manifests: number
  /** The lowest `registeredSovereign` across them — what the weakest guard was watching. */
  readonly registeredSovereign: number
  /** Owner-pinned shards this job defined, which the figure above is measured against. */
  readonly pinnedShards: number
  /** Bytes that actually left, summed across the manifests. */
  readonly totalBytes: number
}

export type SovereignReduceResult =
  | { readonly ok: true; readonly aggregate: CoveredAggregate<SovereignAggregate> }
  | { readonly ok: false; readonly reason: string }

/** `{ok: false}` with a reason, spelled once. */
function refuse(reason: string): SovereignReduceResult {
  return { ok: false, reason }
}

/**
 * The owner a shard's map was **attested** to, or the reason this requestor cannot say.
 *
 * Reads `ShardResult.attestation` and nothing else. `verification.agreeing` carries the
 * raw `AttestedResult`s, and reading those instead would mean re-verifying signatures
 * this module holds no issuer set for — `receiptFor` already did it at the seam that
 * has one, and a second verification here could disagree with the first with nothing
 * able to catch it.
 */
function attestedOwnerOf(
  shard: ShardResult,
  pinnedTo: OwnerId,
): { readonly ok: true; readonly operators: readonly string[] } | { readonly ok: false; readonly reason: string } {
  const receipt = shard.attestation
  if ('kind' in receipt) {
    // The named absence. `submitJob` produces it for a shard nobody signed, for a shard
    // whose signatures did not verify, and for a shard verified under one node key twice
    // — each of which is a different way of not knowing who ran the map, and none of
    // which this module may treat as *the owner ran it*.
    return {
      ok: false,
      reason:
        `shard ${String(shard.partitionIndex)} is pinned to owner ${pinnedTo} but carries no verified ` +
        `attestation, so this requestor cannot say the owner's own node produced it — ${receipt.reason}`,
    }
  }
  const keys = receipt.userKeys
  if (!keys.includes(pinnedTo)) {
    return {
      ok: false,
      reason:
        `shard ${String(shard.partitionIndex)} is pinned to owner ${pinnedTo} but its map was attested ` +
        `under user key(s) ${keys.join(', ')}, which do not include that owner`,
    }
  }
  if (keys.length > 1) {
    return {
      ok: false,
      reason:
        `shard ${String(shard.partitionIndex)} is pinned to owner ${pinnedTo} but its map was also attested ` +
        `under ${keys.filter((key) => key !== pinnedTo).join(', ')}; a partial the owner did not solely ` +
        'produce is not owner-attested',
    }
  }
  return { ok: true, operators: receipt.operators }
}

/**
 * Aggregate a job's **owner-pinned** partials, with the sovereignty claim attached.
 *
 * `spec` is required beside `job` because `ShardResult` carries no owner and no label:
 * the shard's *pinned* owner is the job's own definition and lives only here. The
 * *delivered* owner is read from the shard's verified receipt, and the two being
 * separate sources is what makes the comparison in {@link attestedOwnerOf} a check
 * rather than a restatement.
 */
export async function reduceSovereignJob(
  job: JobResult,
  spec: JobSpec,
  options: SovereignReduceOptions,
): Promise<SovereignReduceResult> {
  const wanted = options.redundancy ?? MIN_SOVEREIGN_COMBINE_REPLICAS
  if (wanted < MIN_SOVEREIGN_COMBINE_REPLICAS) {
    return refuse(
      `a sovereign aggregation asks for at least ${String(MIN_SOVEREIGN_COMBINE_REPLICAS)} replicas per ` +
        `combine and this one asked for ${String(wanted)}; the aggregation over contributions is what ` +
        'carries the verification claim for owner-pinned data, and one executor verifies nothing',
    )
  }

  // The job's own definition: which shards are owner-pinned, and to whom.
  const pinned = new Map<number, OwnerId>()
  spec.shards.forEach((shard, index) => {
    if (shard.label === 'sovereign') pinned.set(index, shard.ownerId)
  })
  if (pinned.size === 0) {
    return refuse(
      'this job pins no shard to an owner, so there is no sovereign contribution to aggregate — ' +
        'running this arm over public shards would report a sovereignty claim about a job that made none',
    )
  }

  // ── The egress evidence, before any partial is projected. ──────────────────────────
  if (options.egress === 'holds-no-egress-manifest') {
    return refuse(
      'this requestor holds no egress manifest, and a sovereign aggregate’s claim is carried by the ' +
        'manifest and the coverage report rather than by a quorum — use reduceJob if the claim is not wanted',
    )
  }
  const manifests = options.egress
  if (manifests.length === 0) {
    return refuse(
      'an empty manifest list is not a manifest: nothing watched this job’s owner-pinned rows, so there ' +
        'is no reading to attach to the aggregate',
    )
  }
  for (const manifest of manifests) {
    if (manifest.violations.length > 0) {
      return refuse(
        `node ${manifest.nodeId} (owner ${manifest.ownerId}) attempted to send ${String(manifest.violations.length)} ` +
          `frame(s) carrying registered sovereign payload(s) — ${[...new Set(manifest.violations)].join(', ')}; ` +
          'the bytes stayed home but the aggregate would be reporting a run whose map tried to move data',
      )
    }
  }
  // EGR-01's figure, used rather than counted a second time. The weakest guard is the
  // reading, for the reason the aggregate receipt takes the weakest combine: a set of
  // guards is no better evidence than the one that was watching least.
  const registeredSovereign = manifests.reduce(
    (least, manifest) => Math.min(least, manifest.registeredSovereign),
    Number.POSITIVE_INFINITY,
  )
  if (registeredSovereign < pinned.size) {
    return refuse(
      `this job pins ${String(pinned.size)} shard(s) to an owner but the weakest guard reports having ` +
        `registered ${String(registeredSovereign)}; a guard that was never given the rows cannot report that ` +
        'none of them left, and an empty violations list from it means only that it was watching nothing',
    )
  }

  // ── Admission, per owner-pinned shard. ─────────────────────────────────────────────
  const contributions: Omit<SovereignContribution, 'partialCid'>[] = []
  const attribution = new Map<number, OwnerId>()
  for (const shard of job.shards) {
    const owner = pinned.get(shard.partitionIndex)
    if (owner === undefined) {
      // A public shard in a job this arm was asked to aggregate. Refused rather than
      // skipped: the aggregate would silently be over a different set than the coverage
      // report describes, which is the exact failure `coverage.ts` exists to prevent.
      return refuse(
        `shard ${String(shard.partitionIndex)} is not owner-pinned; a sovereign aggregation over a mixed ` +
          'job would compute one number and report coverage for another',
      )
    }
    // An owner whose shard did not agree contributed nothing, and that is a hole in the
    // dataset rather than a refusal — it is what the coverage report is for. Left out of
    // the attribution map so `reduceJob` never sees it.
    if (shard.verification.status !== 'agreed') continue

    const attested = attestedOwnerOf(shard, owner)
    if (!attested.ok) return refuse(attested.reason)

    attribution.set(shard.partitionIndex, owner)
    // The partial's address is not known until `reduceJob` has projected it, so this
    // entry is deliberately incomplete — `Omit<…, 'partialCid'>` rather than a placeholder
    // value, so nothing can read a CID that has not been computed.
    contributions.push({
      ownerId: owner,
      partitionIndex: shard.partitionIndex,
      operators: attested.operators,
    })
  }

  if (contributions.length === 0) {
    return refuse(
      `no owner-pinned shard agreed: this job defined ${String(pinned.size)} of them and none produced an ` +
        'output to summarise',
    )
  }

  // ── The aggregation itself, on the shared path. ────────────────────────────────────
  const reduced = await reduceJob(job, {
    rpc: options.rpc,
    executors: options.executors,
    blockstore: options.blockstore,
    project: options.project,
    ...(options.fanout === undefined ? {} : { fanout: options.fanout }),
    redundancy: wanted,
    trustedIssuers: options.trustedIssuers,
    // The whole reason `ContributorAttribution` exists: a leaf keyed on the owner whose
    // data produced it, taken from a certificate this requestor verified.
    contributors: attribution,
  })
  if (!reduced.ok) return refuse(reduced.reason)

  // `reduceJob` returns its leaves in shard order over exactly the shards it did not
  // skip, and it skips exactly the non-agreed ones — the same predicate the loop above
  // used. So the two arrays are index-aligned, and this asserts it rather than assuming:
  // a mismatch means the two predicates have drifted, and a contribution paired with
  // another owner's partial is the worst thing this module could return.
  if (reduced.leaves.length !== contributions.length) {
    return refuse(
      `this arm admitted ${String(contributions.length)} contribution(s) but the reduce projected ` +
        `${String(reduced.leaves.length)} partial(s); the two disagree about which shards agreed`,
    )
  }
  const admitted: SovereignContribution[] = contributions.map((contribution, index) => ({
    ...contribution,
    partialCid: reduced.leaves[index] as CID,
  }))

  // One owner's two partials that address alike would collide on one leaf —
  // `deriveReduceTree` keys a leaf on (contributor, cid) — and the aggregate would count
  // that owner's data once instead of twice. Named here rather than left to be noticed
  // as a number that is quietly too small.
  const seen = new Set<string>()
  for (const contribution of admitted) {
    const key = `${contribution.ownerId}\u0000${contribution.partialCid.toString()}`
    if (seen.has(key)) {
      return refuse(
        `owner ${contribution.ownerId} contributed two partials with the same address ` +
          `(${contribution.partialCid.toString()}); a reduce tree keys a leaf on (contributor, cid), so these ` +
          'merge into one leaf and the aggregate would count that owner’s data once instead of twice',
      )
    }
    seen.add(key)
  }

  if (reduced.tree.nodes.length === 0) {
    return refuse(
      'this reduction merged nothing — a single contribution is promoted rather than combined, so no ' +
        'aggregation was performed and there is nothing for this arm to verify',
    )
  }
  if (reduced.outcome.minReplicas < MIN_SOVEREIGN_COMBINE_REPLICAS) {
    return refuse(
      `the weakest combine in this tree was performed by ${String(reduced.outcome.minReplicas)} executor(s), ` +
        `below the ${String(MIN_SOVEREIGN_COMBINE_REPLICAS)} a sovereign aggregation is verified at; the ` +
        'aggregation over contributions is the only half of this job’s claim that redundancy can carry',
    )
  }

  // ── Coverage, over owners, derived and never declared. ─────────────────────────────
  //
  // Expected is what the job was defined over; contributed is who was admitted above.
  // `unexpected` is structurally empty here and that is a property of the refusals rather
  // than of the arithmetic: a shard whose attested owner is not the one it was pinned to
  // never reaches this line. It is carried through anyway, because a non-empty one would
  // mean the admission loop and this derivation had come apart.
  const value: SovereignAggregate = {
    outcome: reduced.outcome,
    tree: reduced.tree,
    contributions: admitted,
    aggregateAttestation: reduced.aggregateAttestation,
    egress: {
      manifests: manifests.length,
      registeredSovereign,
      pinnedShards: pinned.size,
      totalBytes: manifests.reduce((sum, manifest) => sum + manifest.totalBytes, 0),
    },
  }
  return {
    ok: true,
    aggregate: withCoverage(
      value,
      [...new Set(pinned.values())],
      admitted.map((contribution) => contribution.ownerId),
    ),
  }
}
