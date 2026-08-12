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
import type { Governor } from './ports.ts'
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

/**
 * What a node says about its own room, in the answer to an offer — SCHED-02.
 *
 * Two integers the node already had. `LocalCapacity` exposes both as getters and
 * neither is computed for this purpose, so publishing them costs a node nothing.
 *
 * ## What it is for
 *
 * Owner ruling D2. A requestor bounds **its own** placement across shards from it.
 * Before it, `placeWithOffers` shrank its pool within one shard only and
 * `planWithOffers` rebuilt that pool per request, so N shards of one job could all
 * land on a one-slot node — which `net/src/discovery.test.ts` pinned as a recorded
 * consequence of Phase 13.1, and which is now an assertion of the bound.
 *
 * ## It is advisory, and the word is not decoration
 *
 * **Nothing is reserved by answering.** A requestor that ignores this figure, or
 * lies to itself about it, still over-commits — and is refused for real by the
 * `exec` branch's SCHED-06 admission (`net/src/agent.ts`), which reserves, releases
 * in a `finally`, and is the authoritative bound. That bound did not move. What D2
 * removes is wasted round trips, not the bound. Any prose describing this as
 * *preventing* over-commit is wrong wherever it appears.
 *
 * ## Why not a shard id on `exec`
 *
 * The other candidate was carrying a shard id on the exec request so that an offer
 * reservation could be redeemed. That is precisely what Phase 13.1 **removed**: an
 * offer reservation had no release anywhere on the wire, and the demo's liveness
 * probe leaked one slot per peer per call, permanently. Restoring it needs a
 * reservation expiry, a wall-clock bound inside admission, and a way to tell a probe
 * from a real offer — three new mechanisms where this needs one field. Recorded here
 * so it is not re-proposed.
 *
 * ## `inFlight` is read before this offer's own effect
 *
 * So two answers compose: a caller may subtract what it placed without
 * double-counting its own reservation.
 */
export interface NodeCapacity {
  /** Units of work this node will hold at once, at its current duty cycle. */
  readonly slots: number
  /** Units it is holding right now, read before this offer's own effect. */
  readonly inFlight: number
}

/**
 * What a node answers when offered work. A refusal must say why.
 *
 * Both arms carry a capacity, or the stated absence of one. A refusal that did not
 * say how full is a refusal a requestor cannot plan around: it learns that this
 * shard did not fit, and nothing about whether the next one would.
 *
 * `'states-no-capacity'` is a **named absence**, not a default. A requestor that
 * learned nothing bounds nothing — it must not invent a figure, and it must not
 * assume the node is full. Assuming full would make every node running an older
 * build invisible to a node running this one: a fabric that partitions itself on an
 * upgrade.
 */
export type Admission =
  | { readonly accepted: true; readonly capacity: NodeCapacity | 'states-no-capacity' }
  | {
      readonly accepted: false
      readonly reason: string
      readonly capacity: NodeCapacity | 'states-no-capacity'
    }

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

/**
 * Place a whole job. Shards are independent, so one stalling does not stop the rest.
 *
 * ## The cross-shard bound is the requestor's own — SCHED-02, owner ruling D2
 *
 * `placeWithOffers` shrinks its pool within **one** shard, and rebuilds it per
 * request, so nothing there can stop a second shard being offered to a node the
 * first shard just filled. Until Phase 13.1 the thing that did stop it was the
 * reservation the `offer` branch took; that reservation had no release anywhere on
 * the wire and was removed, deliberately.
 *
 * What replaces it is not a reservation. Every `Admission` states the answering
 * node's `slots` and `inFlight`, and this function keeps a running headroom tally
 * from what it was told, offering a later shard only to nodes with room left.
 *
 * **It is advisory.** Nothing is reserved by answering, this tally lives in one
 * requestor's memory, and a requestor that skipped it — or lied to itself about it —
 * would over-commit exactly as before. It is then refused for real by the `exec`
 * branch's SCHED-06 admission (`net/src/agent.ts`), which is the authoritative
 * bound and did not move. What this removes is wasted round trips, not the bound.
 *
 * A node that states no capacity is left **unbounded** rather than assumed full, and
 * a requestor that made no offers learns nothing and bounds nothing.
 *
 * ## Why the loop stays sequential — now for two reasons
 *
 * The first is unchanged: an in-process `admit` that calls `LocalCapacity.offer`
 * directly — the form `placement.test.ts` uses — reserves capacity, so two shards
 * placed concurrently against one node would both read the pre-offer count and
 * over-commit it, the same concurrency hole the duty-cycle governor had.
 *
 * The second is new and belongs to the tally: a shard placed changes the headroom
 * the next shard sees, so placing concurrently would race the tally against itself
 * and reintroduce precisely what it exists to close.
 *
 * ## Why a cross-shard bound is the right shape here
 *
 * Because `submitJob` dispatches every shard of a job under one `Promise.all`
 * (`job/submit.ts`), the shards really are simultaneous — a node's answer to the
 * first is still true when the last is sent. A *sequential* dispatcher would be
 * bounded too tightly by this, because slots it counted as occupied would already
 * have been released, and it would need a different rule. No quantity — shard count,
 * slot count, or any other — is claimed here about any workload.
 */
export async function planWithOffers(
  requests: readonly PlacementRequest[],
  nodes: readonly NodeDescriptor[],
  options: OfferOptions = {},
): Promise<readonly OfferedPlacement[]> {
  const placements: OfferedPlacement[] = []
  // Absent from this map means "nothing learned about that node", which is
  // unbounded — never zero. Defaulting it to a finite number would bound a node
  // on a figure the requestor invented.
  const headroom = new Map<string, number>()
  const admit = options.admit
  const recording: AdmissionControl | undefined =
    admit === undefined
      ? undefined
      : async (offer) => {
          const decision = await admit(offer)
          if (decision.capacity !== 'states-no-capacity') {
            headroom.set(
              offer.nodeId,
              Math.max(0, decision.capacity.slots - decision.capacity.inFlight),
            )
          }
          // The node's figure was read before this offer's own effect, so an
          // acceptance has to be subtracted here. On an unlearned node that
          // subtraction is from infinity and changes nothing, which is correct.
          if (decision.accepted) {
            headroom.set(
              offer.nodeId,
              Math.max(0, (headroom.get(offer.nodeId) ?? Number.POSITIVE_INFINITY) - 1),
            )
          }
          return decision
        }

  for (const request of requests) {
    const available = nodes.filter(
      (node) => (headroom.get(node.nodeId) ?? Number.POSITIVE_INFINITY) > 0,
    )

    if (available.length === 0 && nodes.length > 0) {
      // Composed by the **requestor**, and therefore on `OfferedPlacement.reason`,
      // which is already requestor-composed. It must never be pushed into a
      // `Rejection`: that field's doc fixes it as the node's own words, and a node
      // held back here was never asked, so it never refused. `probed: 0` and an
      // empty rejection list are the honest record of a shard nobody was asked about.
      placements.push({
        shardId: request.shardId,
        status: 'unplaceable',
        reason: `no candidate for ${request.shardId} has headroom left; all ${nodes.length} are at the capacity they stated`,
        rejections: [],
        probed: 0,
      })
      continue
    }

    // The narrowed set goes through the sovereignty gate inside `placeWithOffers`,
    // as the full set did. Narrowing before that gate can only shrink the pool, so
    // no amount of headroom accounting can widen a sovereign shard's candidates.
    const perShard: OfferOptions =
      recording === undefined ? { ...options } : { ...options, admit: recording }
    placements.push(await placeWithOffers(request, available, perShard))
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
   *
   * ## A number or a `Governor` — one field, two ways of stating one quantity
   *
   * A number is a duty cycle that will not change; a `Governor` is one that may.
   * They mean the same thing and only the second needs re-reading, so they share a
   * field. The alternative — a `dutyCycle` option *and* a `governor` option — would
   * be one quantity with two answers, and a class that had to decide which of them
   * wins when both are given. `fabric-node.ts` records that shape as a defect
   * repeatedly; this does not add another instance of it.
   *
   * Given a `Governor`, the slot count is derived on every read rather than at
   * construction, so a cap the user lowers at runtime reaches the figure this node
   * publishes in its next offer answer with nothing else to wire — SCHED-04's
   * *honoured immediately* half, and the observable the requirement names.
   */
  readonly dutyCycle?: number | Governor
}

/**
 * A node's own admission control — SCHED-03.
 *
 * Takes no ports: the decision is a comparison of two integers this node owns, and
 * this class opens nothing.
 *
 * **This paragraph claimed more than that until 2026-08-11, and the stronger claim was
 * already false when it was written.** It read *"makes no calls… there is nothing here
 * that could consult the network"*, offered as a property of the type rather than a
 * promise in a comment. But `dutyCycle` is `number | Governor`, so `#dutyCycleNow()`
 * invokes a **caller-supplied getter** on every read of {@link LocalCapacity.slots} —
 * and `slots` is read on every `#decide`. A `Governor` may do whatever its author
 * wrote. The `Governor` arm removed the guarantee; the sentence outlived it.
 *
 * What survives is the part that matters and is checkable: **no port is taken here**,
 * so nothing this class *itself* does reaches the network. A caller handing it a
 * `Governor` that dials is describing its own object, not this one — which is a real
 * difference, and smaller than the sentence it replaces.
 *
 * **The arithmetic clause was still too strong on 2026-08-11 and is narrowed here.** It
 * read *"the arithmetic is over integers this node owns"*, and
 * `slots = Math.max(1, Math.floor(maxConcurrent * dutyCycleNow()))` is neither: on the
 * `Governor` arm `#dutyCycleNow()` returns a non-integer in `(0, 1]` read out of an
 * object this node does **not** own. What is true is the first paragraph's version and
 * nothing wider — the **decision**, `#inFlight.size >= slots`, is a comparison of two
 * integers. The `Math.floor` is what makes the right-hand side one; the multiplication
 * that produced it is neither integer nor locally owned. A correction to a correction is
 * worth the line: the first pass narrowed the network claim and carried the arithmetic
 * claim across unexamined.
 *
 * Slots are reserved on accept and must be returned with `release`, so the count
 * reflects work in flight rather than work ever offered.
 *
 * ## A lowered cap bounds starting and never retracts a grant
 *
 * When the duty cycle is a `Governor`, `slots` can fall below `inFlight`. What that
 * means is fixed here and asserted in `placement.test.ts`: the next request is
 * refused, and **every key already held stays releasable**. Nothing in flight is
 * abandoned, cancelled or forgotten. It is the same property `GovernedExecutor`
 * states for pacing — it yields *between* tasks and never inside one, because a WASM
 * call cannot be suspended part-way — and the two halves are deliberately the same
 * rule: lowering a cap changes what this node *starts*, never what it is doing.
 *
 * The visible consequence is that `load` reads above 1 while the excess drains. That
 * is reported rather than clamped, for a reason given at the getter.
 */
export class LocalCapacity {
  readonly #nodeId: string
  readonly #maxConcurrent: number
  readonly #dutyCycle: number | Governor
  readonly #inFlight = new Set<string>()
  #peak = 0

  constructor(options: CapacityOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new RangeError(`maxConcurrent must be a positive integer, got ${options.maxConcurrent}`)
    }
    const dutyCycle = options.dutyCycle ?? 1
    // The numeric arm's guard, byte-for-byte what it was. A `Governor` checked its
    // own cap when it was built and checks it again on every set, so a second check
    // here would be a second place for one rule to live — and the two would drift
    // the first time either moved.
    if (typeof dutyCycle === 'number' && (!(dutyCycle > 0) || dutyCycle > 1)) {
      throw new RangeError(`dutyCycle must be in (0, 1], got ${dutyCycle}`)
    }
    this.#nodeId = options.nodeId
    this.#maxConcurrent = options.maxConcurrent
    this.#dutyCycle = dutyCycle
  }

  get nodeId(): string {
    return this.#nodeId
  }

  /** The duty cycle in force right now — a constant, or whatever a governor reads. */
  #dutyCycleNow(): number {
    return typeof this.#dutyCycle === 'number' ? this.#dutyCycle : this.#dutyCycle.dutyCycle
  }

  /**
   * Slots actually usable at the current duty cycle.
   *
   * Derived on every read rather than remembered from the constructor, because the
   * duty cycle may be a `Governor` whose reading moves under this object. A figure
   * captured at construction would be the answer to "what could this node run when
   * it started", and what an offer has to answer is "what can it run now".
   *
   * Floored at 1. A heavily throttled node stays a participant rather than silently
   * disappearing from the fabric — at zero slots `#decide` would refuse everything,
   * which is a node that has left rather than a node that is going slowly. The floor
   * predates this getter and moving the derivation must not lose it.
   *
   * **Two production readers now, and the second is on a path that takes no decision.**
   * `#decide` is the first, and it reads this once per decision for that reason. The
   * second arrived with SCHED-03: `net/src/agent.ts`' `pausedAnswer` publishes
   * `{slots, inFlight}` on the offer refusal of a **paused** node, which is a node
   * stating what it could do rather than deciding anything. It reads this getter and
   * `inFlight` as two independent reads instead of through `#capacity(slots)`, which is
   * private — so a `Governor` that moved between them would publish a pair that held at
   * no instant. Recorded on both sides; that call site says the same and says why it is
   * harmless today.
   */
  get slots(): number {
    return Math.max(1, Math.floor(this.#maxConcurrent * this.#dutyCycleNow()))
  }

  get inFlight(): number {
    return this.#inFlight.size
  }

  /**
   * Fraction of usable slots occupied, for publishing as a load hint.
   *
   * **May exceed 1**, and is deliberately not clamped. A cap lowered below what is
   * already in flight leaves this node over its new bound until the excess drains,
   * and that window is exactly the state a requestor most needs to see. `load` is a
   * hint used only to order nodes that are *already* eligible (`sovereignty.ts`), so
   * an honest reading above 1 sorts such a node last, which is correct. Clamped to 1
   * it would sort level with a node that is merely full, and the requestor would
   * spend an offer finding out what this number could have told it.
   */
  get load(): number {
    return this.#inFlight.size / this.slots
  }

  /**
   * The high-water mark of concurrent reservations, which never decreases.
   *
   * What it is for: SCHED-06's criterion 1 is read off an instrument *inside* the
   * node under test, because a `FabricNode`'s internal executor is not reachable
   * from outside the factory by design. The count of slots concurrently held
   * around `executor.execute` is the honest reading available to a test that
   * started a real node.
   *
   * What it is **not**: it measures slots held, not `execute` invocations. The two
   * coincide only because `serveAgent`'s exec branch acquires immediately before
   * the call and releases in a `finally` immediately after — a property of
   * `net/src/agent.ts`, not of this class. Since 16-06 they do not coincide at all
   * on a node that has served a combine: that branch holds a slot from the same
   * table and never reaches an executor, so a reading here can rise with no
   * `execute` having happened.
   *
   * **On a node whose duty cycle is a constant it also cannot exceed `slots`**,
   * because `#decide` returns the refusal before `#inFlight.add` is ever reached,
   * so `peakInFlight <= slots` is arithmetic and can never fail. Reading it as
   * evidence that a bound held is therefore wrong; what it can say is that the
   * limit was actually *reached* rather than never approached. A count that can
   * exceed the bound — and so falsify it — has to come from around the executor
   * itself (`@o2/net`'s `CountingExecutor`).
   *
   * **The `Governor` arm removes even that arithmetic**, and the qualifier above is
   * not decoration. `slots` is a reading now, so a cap lowered below what is in
   * flight leaves `peakInFlight > slots` legitimately, for as long as the excess
   * takes to drain. Every construction in this repository today passes a number or
   * omits the field, which is why the surrounding comments in `@o2/net` and the two
   * node factories that state the bound unconditionally are still accurate about
   * their own rigs — but anything that starts passing a governor must not carry the
   * unconditional form across.
   *
   * It never decreases on release. A high-water mark that could fall would answer
   * "was this node ever saturated?" with whatever happened to be true at the
   * moment somebody read it.
   */
  get peakInFlight(): number {
    return this.#peak
  }

  /**
   * Decide on an offer **without** reserving anything — the non-reserving twin of
   * `offer`.
   *
   * Caller: `serveAgent`'s `offer` branch (`net/src/agent.ts`). An offer is a
   * *question*, and answering a question must not consume the thing being asked
   * about.
   *
   * Why this exists rather than the offer branch comparing `slots` and `inFlight`
   * inline: the refusal string `over-committed: N of M slots in use` is
   * wire-visible and SCHED-06 requires it by name. A second construction of it in
   * `@o2/net` would drift from this one with nothing failing.
   *
   * The trap it closes, recorded because it is this phase's largest risk and will
   * otherwise be reintroduced: reserving on `offer` **leaks**. An `exec` request
   * carries no shard id (`net/src/protocol.ts` encodes `moduleCid`, `inputCid`,
   * `partitionIndex`, `partitionCount`, `label`, `ownerId`, `capability` — no
   * shard id), so no serving node can correlate an offer reservation with the
   * exec that would redeem it. And there is a live prober: `browser/demo/main.ts`
   * sends `{kind:'offer', shardId:'probe'}` to every connected peer on every
   * `computePeers()` call. A reserving offer branch would let one demo tab
   * permanently occupy a slot named `probe` on every peer it can see, after which
   * every later tab's probe is refused with `probe is already in flight here` —
   * a node that fills its own slot table from liveness probes and then refuses
   * all work.
   */
  would(offer: Offer): Admission {
    return this.#decide(offer)
  }

  /**
   * Decide on an offer, reserving a slot when accepted.
   *
   * Two production callers, both in `net/src/agent.ts` and both releasing in a
   * `finally`: `serveAgent`'s `exec` branch around the executor call, and its
   * `combine` branch around the fetch-and-merge (added in 16-06 — a combine's
   * inputs are already public, so what it opens is a capacity surface rather than
   * an authorisation one). Everything that reserves must release, or the node
   * admits correctly for exactly `slots` requests and then refuses everything
   * forever.
   *
   * They share one slot table deliberately: it is one node's CPU, and a bound a
   * peer could spend twice by choosing which verb to send would not be a bound.
   * Their keys are namespaced apart at the call sites so neither can dedupe-refuse
   * the other's work.
   */
  offer(offer: Offer): Admission {
    const decision = this.#decide(offer)
    if (!decision.accepted) return decision
    this.#inFlight.add(offer.shardId)
    this.#peak = Math.max(this.#peak, this.#inFlight.size)
    // Returned unchanged, so the capacity it carries is the one `#decide` read
    // **above** the reservation on the line before. Re-reading it here would
    // publish this offer's own effect and make two answers stop composing.
    return decision
  }

  /**
   * This node's own room, as it stands right now — SCHED-02. Reserves nothing.
   *
   * Takes the slot count rather than reading it, so that one decision is built from
   * one reading of a figure that may move. A governor lowered between the comparison
   * and the answer would otherwise let a node refuse `4 of 2` while publishing some
   * third number — two answers to one question, from the same call.
   */
  #capacity(slots: number): NodeCapacity {
    return { slots, inFlight: this.#inFlight.size }
  }

  /** The decision half, shared by `offer` and `would`. Mutates nothing. */
  #decide(offer: Offer): Admission {
    // One reading of each moving figure, used for the comparison, the refusal
    // string and the published capacity alike.
    const slots = this.slots
    const dutyCycle = this.#dutyCycleNow()
    // Every arm states the capacity, refusals included. The refusal strings
    // themselves are untouched: `over-committed: N of M slots in use` is
    // wire-visible and SCHED-06 requires it by name, so it stays composed in
    // exactly this one place.
    if (this.#inFlight.has(offer.shardId)) {
      return {
        accepted: false,
        reason: `${offer.shardId} is already in flight here`,
        capacity: this.#capacity(slots),
      }
    }
    if (this.#inFlight.size >= slots) {
      // The live duty cycle, not the one this object was built with. A node
      // throttled after construction that named its original rate here would be
      // explaining its refusal with a number that is no longer true.
      const throttled = dutyCycle < 1 ? ` at duty cycle ${dutyCycle}` : ''
      return {
        accepted: false,
        reason: `over-committed: ${this.#inFlight.size} of ${slots} slots in use${throttled}`,
        capacity: this.#capacity(slots),
      }
    }
    return { accepted: true, capacity: this.#capacity(slots) }
  }

  /** Return a slot. Unknown shard ids are ignored — releasing twice is harmless. */
  release(shardId: string): void {
    this.#inFlight.delete(shardId)
  }
}

/**
 * The admission limit a node ships with when its factory is given no override.
 *
 * **This is a configuration choice, not a derived quantity.** No arithmetic over
 * shard counts, replica counts or peer counts produced it, and none may be
 * written into this doc, into any other comment, or into a summary. Three
 * separate attempts to derive a per-node concurrent-`exec` figure from real code
 * produced three different wrong answers; the most recent was wrong because
 * `planPlacement` takes `ordered.slice(0, redundancy)` over *distinct* nodes
 * (`sovereignty.ts`), so no node ever holds two replicas of one shard.
 *
 * What may be stated is the shipped value — 64 — and the measured defect it sits
 * below: the roadmap's probe fired 4 peers × 200 concurrent `exec` requests at
 * one node and an instrument inside that node read **800 simultaneous
 * `execute()` calls and zero refusals**. 800 is that probe's reading, not a model
 * of anything. If a workload's peak is ever stated at all, it must be a figure
 * that was *measured*, carrying the date it was measured on.
 *
 * **Why an admission bound is needed at all**, as a structural fact read from
 * source and carrying no arithmetic: a job's whole dispatch set is genuinely
 * concurrent. `submitJob` runs every shard through one `Promise.all`
 * (`job/submit.ts`) and `executeVerified` runs every replica of a shard through
 * another (`job/verify.ts`), so nothing staggers them. That says the set arrives
 * together; it says **nothing** about how large the set is, and no size may be
 * computed from it. It is also why a spec that dispatches 32 or 64 requests at
 * once is a realistic shape rather than a synthetic stress — that is how a job
 * already arrives.
 *
 * **Where the bound applies**, also structural: a tab's own local executor takes
 * **no** admission slot. Admission lives on `serveAgent`'s exec branch, and a
 * local call never reaches it (`browser/demo/main.ts` puts `node.executor` in the
 * executor list directly). A slot count is therefore a statement about work
 * *peers sent this node*, and a reading taken from a node that is also executing
 * locally is a reading of two different things unless the local path is excluded.
 *
 * **What it is not derived from.** It is **not** derived from the per-peer send
 * gate Phase 13.1 adds to `Libp2pTransport`, and nothing may say that gate bounds
 * how many `exec` requests reach a node. The gate bounds concurrent *streams*
 * toward one peer. Request and execution are decoupled all the way down:
 * `Transport.send` is a one-way datagram that resolves when `stream.close()`
 * completes, the registered handler awaits `readMessage` and dispatches
 * synchronously, and `RpcEndpoint` subscribes with `void this.#receive(...)`. A
 * stream is released as soon as the request bytes have landed, long before the
 * task it carries has run. How many `exec` requests are consequently in flight at
 * a node under any given workload is a **measured** quantity, and it is not
 * predicted here.
 *
 * **The consequence, stated rather than left to be discovered: refusal without a
 * re-pick turns a previously slow job into a failed job on the production submit
 * path.** `submitJob` calls `executeVerified(task, selectedExecutors)` exactly
 * once with no retry; `net/src/remote-executor.ts` flattens the `{kind:'error'}`
 * refusal into `{ok:false, reason}`; `job/verify.ts` records it against
 * `executor.nodeId` and the shard is not `agreed`, so `job.complete` is false.
 * Before this phase a saturated node queued the work and eventually answered.
 *
 * **This default is not claimed to put that refusal out of reach.** Whether the
 * refusal is reached under any workload this project runs is **unmeasured**:
 * nothing in this repository reads a node's concurrent `exec` count under a demo
 * or benchmark workload, and no arithmetic substitutes for reading it. What would
 * measure it is `@o2/net`'s `CountingExecutor` reading exposed on the node, taken
 * from a multi-tab demo run — which needs the browser e2e harness (WIRE-03,
 * Phase 19). What would *remove* it rather than measure it is a re-pick on the
 * production submit path (WIRE-04, Phase 20).
 *
 * It is a **default**: both node factories accept an override, and `bin/bench.ts`
 * declares its own value explicitly rather than inheriting this one — a published
 * scaling curve shaped by an undeclared admission limit is exactly the failure
 * this milestone exists to remove.
 */
export const DEFAULT_MAX_CONCURRENT_TASKS = 64
