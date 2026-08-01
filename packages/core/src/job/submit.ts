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
import type { NameRecord } from '../naming.ts'
import { planWithOffers } from '../placement.ts'
import type { AdmissionControl, Rejection } from '../placement.ts'
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
      return { partitionIndex, inputCid, verification, degraded: placement.degraded, rejections }
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
