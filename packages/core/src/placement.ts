/**
 * Power-of-d placement with rejection and re-pick — SCHED-02, SCHED-03, SCHED-05.
 *
 * `planPlacement` in `sovereignty.ts` orders every eligible node by load and takes the
 * best. That is correct and does not scale: it assumes the requestor has a current
 * load figure for the whole fabric, and if several requestors act on the same stale
 * figure they stampede the same "least-loaded" node. Power-of-d-choices fixes both by
 * looking at almost nothing — sample `d` candidates, take the least-loaded of those.
 * Two samples already collapse the worst-case queue length from linear to
 * log-logarithmic in the number of nodes; the third and fourth buy little.
 *
 * ## The sample is derived, not drawn
 *
 * Classic power-of-d draws its candidates at random. Here they come from rendezvous
 * (HRW) ranking on the shard id — the same mechanism the reduce tree uses. Per shard,
 * the ranking is an arbitrary permutation of the nodes, which is what the load result
 * needs; across shards it differs, so work still spreads. What it buys over `random()`:
 *
 * - **No shared state and no clock.** Every requestor derives the same d for a shard,
 *   so two of them racing on the same work converge instead of doubling up.
 *   Re-placing after a crash re-derives the same candidates.
 * - **The tail is the re-pick list**, already ordered, already local. There is nothing
 *   to look up when a candidate refuses.
 * - **Reproducible.** A placement decision can be replayed from the shard id and the
 *   node set, which is the difference between a debuggable scheduler and a haunted one.
 *
 * ## Local information only
 *
 * The `load` on a `NodeDescriptor` is a **hint** — whatever the requestor happens to
 * know, possibly stale. It is never treated as authority. The authority is the offer:
 * the chosen node consults its own counters and accepts or refuses. That is why
 * rejection is not an error path. It is the mechanism by which a guess made from
 * stale data becomes a correct decision.
 *
 * ## Sovereignty is upstream of all of it
 *
 * The first thing this module does is call `eligibleNodes` from `sovereignty.ts` — the
 * same function `planPlacement` calls, deliberately not a copy. Sampling, scoring,
 * rejection and re-pick all operate on the already-narrowed set, so no amount of
 * refusal can widen it. A sovereign shard whose every owner node refuses comes back
 * `unplaceable`, which is a stalled job, and a stalled job is the correct outcome.
 *
 * Pure module.
 */

import { rendezvousRank } from './reduce.ts'
import { eligibleNodes } from './sovereignty.ts'
import type { NodeDescriptor, PlacementRequest } from './sovereignty.ts'

/**
 * Candidates sampled per attempt.
 *
 * Two is where the asymptotic win lives; beyond four the extra probes cost more than
 * the balance they buy. The roadmap states d = 2..4 and `placeWithOffers` refuses
 * anything outside it rather than silently clamping.
 */
export const MIN_D = 2
export const MAX_D = 4
export const DEFAULT_D = 2

/** A node's refusal, with the reason it gave — SCHED-03. */
export interface Rejection {
  readonly nodeId: string
  /** The node's own words. Never synthesised by the requestor. */
  readonly reason: string
}

/** What a node answers when offered work. A refusal must say why. */
export type Admission =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string }

/** An offer of one shard to one node. */
export interface Offer {
  readonly shardId: string
  readonly nodeId: string
}

/** Asks a node whether it will take a shard. */
export interface AdmissionControl {
  (offer: Offer): Admission | Promise<Admission>
}

export type OfferedPlacement =
  | {
      readonly shardId: string
      readonly status: 'placed'
      readonly nodeIds: readonly string[]
      readonly replicas: number
      /** True when fewer replicas were achieved than requested. */
      readonly degraded: boolean
      /** Every refusal collected on the way, in order. */
      readonly rejections: readonly Rejection[]
      /** Nodes actually asked. The cost of the decision, for SCHED-02. */
      readonly probed: number
    }
  | {
      readonly shardId: string
      readonly status: 'unplaceable'
      readonly reason: string
      readonly rejections: readonly Rejection[]
      readonly probed: number
    }

export interface OfferOptions {
  /** Candidates sampled per attempt, 2..4. Defaults to 2. */
  readonly d?: number
  /** Consulted for every offer. Omit to accept everything, for tests. */
  readonly admit?: AdmissionControl
}

/**
 * Sample `d` candidates for a shard from an already-eligible set.
 *
 * Exported because the sampling is worth testing on its own: it must be a function of
 * (shard id, node ids) and nothing else, or the reproducibility claim above is false.
 */
export function sampleCandidates(
  shardId: string,
  eligible: readonly NodeDescriptor[],
  d: number,
): readonly NodeDescriptor[] {
  const byId = new Map(eligible.map((node) => [node.nodeId, node]))
  return rendezvousRank(shardId, [...byId.keys()])
    .slice(0, d)
    .map((nodeId) => byId.get(nodeId) as NodeDescriptor)
}

/** Least-loaded of a sample, ties broken by id so the choice is reproducible. */
function leastLoaded(sample: readonly NodeDescriptor[]): NodeDescriptor | undefined {
  return [...sample].sort((a, b) => a.load - b.load || a.nodeId.localeCompare(b.nodeId))[0]
}

/**
 * Place one shard by sampling, offering, and re-picking on refusal.
 *
 * A refusal never fails the job. The refusing node is dropped from the pool, the next
 * `d` are sampled from what remains, and the loop continues until the requested
 * redundancy is met or the pool is exhausted. Both outcomes are reported with the
 * refusals that produced them, so "nobody would take it" is distinguishable from
 * "there was nobody".
 */
export async function placeWithOffers(
  request: PlacementRequest,
  nodes: readonly NodeDescriptor[],
  options: OfferOptions = {},
): Promise<OfferedPlacement> {
  const d = options.d ?? DEFAULT_D
  const rejections: Rejection[] = []
  let probed = 0

  const fail = (reason: string): OfferedPlacement => ({
    shardId: request.shardId,
    status: 'unplaceable',
    reason,
    rejections,
    probed,
  })

  if (!Number.isInteger(d) || d < MIN_D || d > MAX_D) {
    return fail(`d must be an integer in [${MIN_D}, ${MAX_D}], got ${d}`)
  }
  if (!Number.isInteger(request.redundancy) || request.redundancy < 1) {
    return fail(`redundancy must be a positive integer, got ${request.redundancy}`)
  }

  // The sovereignty gate, first and shared. Everything below operates on `pool`,
  // which is only ever shrunk — there is no branch that puts a node back.
  let pool = [...eligibleNodes(request, nodes)]
  if (pool.length === 0) {
    return fail(
      request.label === 'sovereign'
        ? `no executable node for owner ${request.ownerId ?? '(unspecified)'}`
        : 'no nodes available',
    )
  }

  const admit = options.admit
  const chosen: string[] = []

  while (chosen.length < request.redundancy && pool.length > 0) {
    const sample = sampleCandidates(request.shardId, pool, d)
    const candidate = leastLoaded(sample)
    if (candidate === undefined) break

    pool = pool.filter((node) => node.nodeId !== candidate.nodeId)
    probed += 1

    const decision = admit === undefined
      ? ({ accepted: true } as const)
      : await admit({ shardId: request.shardId, nodeId: candidate.nodeId })

    if (decision.accepted) chosen.push(candidate.nodeId)
    else rejections.push({ nodeId: candidate.nodeId, reason: decision.reason })
  }

  if (chosen.length === 0) {
    return fail(
      rejections.length > 0
        ? `every eligible node refused ${request.shardId} (${rejections.length} refusals)`
        : `no eligible node for ${request.shardId}`,
    )
  }

  return {
    shardId: request.shardId,
    status: 'placed',
    nodeIds: chosen,
    replicas: chosen.length,
    degraded: chosen.length < request.redundancy,
    rejections,
    probed,
  }
}

/** Place a whole job. Shards are independent, so one stalling does not stop the rest. */
export async function planWithOffers(
  requests: readonly PlacementRequest[],
  nodes: readonly NodeDescriptor[],
  options: OfferOptions = {},
): Promise<readonly OfferedPlacement[]> {
  const placements: OfferedPlacement[] = []
  // Sequential on purpose: admission reserves capacity, so two shards placed
  // concurrently against the same node would both see the pre-offer count and
  // over-commit it — the same concurrency hole the duty-cycle governor had.
  for (const request of requests) {
    placements.push(await placeWithOffers(request, nodes, options))
  }
  return placements
}

export interface CapacityOptions {
  readonly nodeId: string
  /** Tasks this node will run at once when unthrottled. */
  readonly maxConcurrent: number
  /**
   * Duty cycle in (0, 1], mirroring `Governor`. Scales the usable slot count.
   *
   * A node at 25% does not run a quarter of a task; it runs fewer of them. Slots are
   * floored at 1, so a heavily throttled node stays a participant rather than
   * silently disappearing from the fabric.
   */
  readonly dutyCycle?: number
}

/**
 * A node's own admission control — SCHED-03.
 *
 * Takes no ports and makes no calls: the decision is a comparison of two integers
 * this node owns. That is "local information only" as a property of the type, not a
 * promise in a comment — there is nothing here that *could* consult the network.
 *
 * Slots are reserved on accept and must be returned with `release`, so the count
 * reflects work in flight rather than work ever offered.
 */
export class LocalCapacity {
  readonly #nodeId: string
  readonly #slots: number
  readonly #dutyCycle: number
  readonly #inFlight = new Set<string>()

  constructor(options: CapacityOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new RangeError(`maxConcurrent must be a positive integer, got ${options.maxConcurrent}`)
    }
    const dutyCycle = options.dutyCycle ?? 1
    if (!(dutyCycle > 0) || dutyCycle > 1) {
      throw new RangeError(`dutyCycle must be in (0, 1], got ${dutyCycle}`)
    }
    this.#nodeId = options.nodeId
    this.#dutyCycle = dutyCycle
    this.#slots = Math.max(1, Math.floor(options.maxConcurrent * dutyCycle))
  }

  get nodeId(): string {
    return this.#nodeId
  }

  /** Slots actually usable at the current duty cycle. */
  get slots(): number {
    return this.#slots
  }

  get inFlight(): number {
    return this.#inFlight.size
  }

  /** Fraction of usable slots occupied, for publishing as a load hint. */
  get load(): number {
    return this.#inFlight.size / this.#slots
  }

  /** Decide on an offer, reserving a slot when accepted. */
  offer(offer: Offer): Admission {
    if (this.#inFlight.has(offer.shardId)) {
      return { accepted: false, reason: `${offer.shardId} is already in flight here` }
    }
    if (this.#inFlight.size >= this.#slots) {
      const throttled = this.#dutyCycle < 1 ? ` at duty cycle ${this.#dutyCycle}` : ''
      return {
        accepted: false,
        reason: `over-committed: ${this.#inFlight.size} of ${this.#slots} slots in use${throttled}`,
      }
    }
    this.#inFlight.add(offer.shardId)
    return { accepted: true }
  }

  /** Return a slot. Unknown shard ids are ignored — releasing twice is harmless. */
  release(shardId: string): void {
    this.#inFlight.delete(shardId)
  }
}
