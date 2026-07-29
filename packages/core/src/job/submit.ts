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
import type { Blockstore, Executor, Task } from '../ports.ts'
import { planPlacement } from '../sovereignty.ts'
import type { NodeDescriptor, OwnerId, Placement, PlacementRequest } from '../sovereignty.ts'
import { executeVerified } from './verify.ts'
import type { VerificationResult } from './verify.ts'

/** One shard's input, carrying the sovereignty label that constrains where it may run. */
export type ShardSpec =
  | { readonly value: CanonicalValue; readonly label: 'public' }
  | { readonly value: CanonicalValue; readonly label: 'sovereign'; readonly ownerId: OwnerId }

export interface JobSpec {
  readonly moduleCid: CID
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
}

export interface ShardResult {
  readonly partitionIndex: number
  readonly inputCid: CID
  readonly verification: VerificationResult
  /**
   * True when this shard's achieved redundancy is below `JobSpec.redundancy`.
   *
   * A degraded shard that nonetheless `agreed` has NOT been verified at the
   * requested strength — it is owner-attested, not independently confirmed. See
   * `sovereignty.ts`'s `Placement.degraded` for why this is reported rather than
   * silently tolerated.
   */
  readonly degraded: boolean
}

export interface JobResult {
  readonly moduleCid: CID
  readonly shards: readonly ShardResult[]
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

/**
 * Submit a job: shard it, place each shard, execute redundantly, verify, return CIDs.
 *
 * Shards run concurrently — they share no state by construction, which is the
 * whole reason the partition is the unit of parallelism.
 */
export async function submitJob(
  spec: JobSpec,
  blockstore: Blockstore,
): Promise<SubmitResult> {
  if (spec.shards.length === 0) return { ok: false, error: { kind: 'no-shards' } }
  if (!Number.isInteger(spec.redundancy) || spec.redundancy < 1) {
    return { ok: false, error: { kind: 'bad-redundancy', redundancy: spec.redundancy } }
  }

  const execByNodeId = new Map(spec.executors.map((e) => [e.nodeId, e] as const))
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
    inputCids.push(encoded.cid)
  }

  // Placement pass — sequential and synchronous; only execution below needs
  // concurrency. `dispatchCount` spreads shards across a public job's node set
  // the way the old round-robin did, by nudging the load `planPlacement` orders
  // on — it can never widen who is *eligible*, only reorder who is chosen first
  // among already-eligible nodes.
  const dispatchCount = new Map<string, number>()
  const shardPlacements: Placement[] = []
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

  const shards = await Promise.all(
    inputCids.map(async (inputCid, partitionIndex): Promise<ShardResult> => {
      const placement = shardPlacements[partitionIndex] as Placement
      if (placement.status === 'unplaceable') {
        return {
          partitionIndex,
          inputCid,
          verification: { status: 'insufficient', reason: placement.reason, failures: [] },
          degraded: false,
        }
      }

      const shard = spec.shards[partitionIndex] as ShardSpec
      const selectedExecutors = placement.nodeIds.map((nodeId) => execByNodeId.get(nodeId) as Executor)
      const task: Task =
        shard.label === 'sovereign'
          ? {
              moduleCid: spec.moduleCid,
              inputCid,
              partitionIndex,
              partitionCount,
              label: shard.label,
              ownerId: shard.ownerId,
            }
          : {
              moduleCid: spec.moduleCid,
              inputCid,
              partitionIndex,
              partitionCount,
              label: shard.label,
            }
      const verification = await executeVerified(task, selectedExecutors)
      // Persist an agreed result so it is retrievable by CID like any other block.
      if (verification.status === 'agreed') {
        const out = await canonicalCid(verification.output)
        if (out.ok) await blockstore.put(out.bytes)
      }
      return { partitionIndex, inputCid, verification, degraded: placement.degraded }
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
      complete: shards.every((s) => s.verification.status === 'agreed' && !s.degraded),
      grossFuel: gross,
      usefulFuel: useful,
      verificationMultiplier: useful === 0 ? 0 : gross / useful,
    },
  }
}
