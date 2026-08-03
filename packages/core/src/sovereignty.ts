/**
 * Sovereignty — DATA-03 through DATA-06, and the placement rule that enforces them.
 *
 * The project's central promise is that an owner's raw data never leaves their own
 * device. A promise like that cannot rest on a scheduler *choosing* not to move a
 * task, because a scheduler under load pressure is precisely the thing that will
 * eventually choose otherwise. So the guarantee here is structural: for sovereign
 * data there is **no code path that returns a non-owner node**.
 *
 * Concretely, `planPlacement` filters candidates down to the owner's own nodes
 * *before* load is consulted at all, and the load-balancing step then operates on
 * that already-narrowed set. There is no fallback branch, no "if nothing suitable is
 * available" clause, and no threshold at which the rule relaxes. A sovereign shard
 * with no eligible owner node comes back as `unplaceable` — a stalled job, which is
 * the correct outcome, and a much better one than a quiet leak.
 *
 * The decision this file does *not* re-open (see C3 in PROJECT.md): sovereign map
 * tasks are owner-attested rather than redundantly executed, because pinning data to
 * one owner removes the second independent executor by construction. Redundancy
 * applies within an owner's own node set when they have two or more live, and to the
 * aggregation over contributions. That is settled.
 *
 * Pure module. Its one import is `import type`, which erases at build time, so this
 * file still contributes no runtime dependency to anything that loads it — the property
 * the phrase "zero imports" used to stand in for. `enrollment.ts` does not import this
 * file, so the direction is one-way and adds no cycle.
 *
 * The reason the certificate belongs *on* `NodeDescriptor` rather than beside it: a
 * second structure keyed on `nodeId` is a second source of truth about the same node,
 * and nothing in this repository could catch the two disagreeing. One of them would be
 * consulted for placement and the other for verification, and the day they diverge is
 * the day a result is attested against a certificate that did not run it.
 */

import type { NodeCertificate } from './enrollment.ts'

/** Who owns a piece of data. Opaque; identity is established elsewhere. */
export type OwnerId = string

/**
 * How freely a piece of data may be moved.
 *
 * A two-value union rather than a boolean so the sovereign case has to be named at
 * every site that handles it — `if (label === 'sovereign')` reads as a decision,
 * `if (!shard.public)` reads as an oversight waiting to happen.
 */
export type Sovereignty = 'public' | 'sovereign'

/** A node the placer may consider. */
export interface NodeDescriptor {
  readonly nodeId: string
  /** The owner this node belongs to. Sovereign work runs only on its owner's nodes. */
  readonly ownerId: OwnerId
  /**
   * Whether this node can actually decrypt and execute sovereign data for its owner.
   *
   * DATA-09: a backbone node may hold an *encrypted* replica of sovereign data, which
   * makes it useful for availability and useless for execution — running the task
   * would mean handing it the decryption key, which is the very thing sovereignty
   * forbids. Such a replica is `false` here and is therefore never an execution
   * target, while remaining perfectly good as a block source.
   */
  readonly canExecuteSovereign: boolean
  /** Current load in [0, 1]. Used only to choose *among* already-eligible nodes. */
  readonly load: number
  /**
   * The provider-signed certificate that qualified this node, or the statement that
   * this descriptor carries none.
   *
   * **What it buys.** `operatorId` is the unit of quorum diversity and
   * `discoverability` is what makes a member backbone-anchored, so this one field is
   * what carries VER-03, VER-04 and VER-08…VER-10 onto the dispatch path.
   * `composeQuorum`, `attestationReceipt` and `resolveReplicaSets` all take
   * `NodeCertificate[]`, and until this field existed there was no point on the path a
   * job actually runs where any of them could be called at all.
   *
   * **Required, and the absence is a statement rather than a default.** A hook or fact
   * whose absence matters is a value the call site writes, never an omission the type
   * tolerates — the convention Phase 11 recorded on `AgentOptions`. Optional here would
   * let a descriptor reach the quorum step carrying nothing, and the quorum step would
   * then have to guess whether that meant "nobody enrolled this node" or "whoever built
   * this descriptor forgot", which are different facts with different remedies.
   *
   * **`'carries-no-certificate'` is not a node class.** Every node in this fabric has
   * equal functionality and the only difference between them is discovery. What the
   * literal reports is that *this requestor* holds no signed statement about the node —
   * a fact about the requestor's knowledge, which changes the moment it learns one. A
   * descriptor carrying it names a perfectly ordinary node.
   */
  readonly certificate: NodeCertificate | 'carries-no-certificate'
}

/**
 * Build a candidate pool for an all-public job from whatever already carries a
 * `nodeId` — typically the same `Executor[]` the caller is about to pass to
 * `submitJob`.
 *
 * `ownerId` and `canExecuteSovereign` are placeholders here: `eligibleNodes`
 * never consults either field for a `'public'` request (it returns every node
 * unconditionally), so the values are harmless. This is a convenience for
 * expressing a public job's candidate pool cheaply — every node genuinely has
 * equal functionality (see `fabric-node.ts`'s module comment); this function
 * does not introduce a node class, only a default descriptor shape for the
 * common case where the caller has not modelled per-owner nodes at all.
 *
 * `certificate` is the one field here that is not a placeholder. It is the honest
 * answer: this function builds descriptors from anything carrying a `nodeId`, so
 * there is no certificate for it to pass on, and it says so rather than leaving a
 * reader to infer it from an absent key.
 *
 * Takes the minimal structural shape rather than `Executor` from `ports.ts` so
 * this file's pure-module property is undisturbed.
 */
export function publicNodes(
  executors: readonly { readonly nodeId: string }[],
): readonly NodeDescriptor[] {
  return executors.map((executor) => ({
    nodeId: executor.nodeId,
    ownerId: 'public',
    canExecuteSovereign: true,
    load: 0,
    certificate: 'carries-no-certificate',
  }))
}

/** One unit of work to place, carrying its own sovereignty label. */
export interface PlacementRequest {
  readonly shardId: string
  readonly label: Sovereignty
  /** Required for sovereign shards; ignored for public ones. */
  readonly ownerId?: OwnerId
  /** Replicas wanted. Sovereign shards are capped by the owner's own node count. */
  readonly redundancy: number
}

export type Placement =
  | {
      readonly shardId: string
      readonly status: 'placed'
      readonly nodeIds: readonly string[]
      /** Redundancy actually achieved, which may be below what was asked for. */
      readonly replicas: number
      /**
       * True when the achieved redundancy is below the request.
       *
       * Reported rather than silently tolerated: a sovereign shard with one live
       * owner node is owner-attested, not verified, and the difference has to be
       * visible to whatever consumes the result.
       */
      readonly degraded: boolean
    }
  | {
      readonly shardId: string
      readonly status: 'unplaceable'
      readonly reason: string
    }

/**
 * Nodes eligible to execute a request.
 *
 * The only place eligibility is decided, and deliberately total: every branch either
 * returns the owner's executable nodes or returns nothing. There is no path from a
 * sovereign request to a node belonging to someone else, which is what makes
 * criterion 1 a property of the code rather than of the test.
 *
 * **Exported so that there is exactly one of it.** `placement.ts` adds power-of-d
 * sampling and an offer/reject loop on top of placement, and the temptation there is
 * to re-derive "who could run this" from the candidate list it was handed. Every
 * placer calls *this* function first instead, so a second entry point cannot drift
 * from the rule — SCHED-05 survives the addition rather than being re-argued by it.
 */
export function eligibleNodes(
  request: PlacementRequest,
  nodes: readonly NodeDescriptor[],
): readonly NodeDescriptor[] {
  if (request.label === 'public') return nodes

  const { ownerId } = request
  // A sovereign shard with no owner is not a wide-open shard; it is a broken one.
  if (ownerId === undefined) return []

  return nodes.filter((node) => node.ownerId === ownerId && node.canExecuteSovereign)
}

export interface PlacementPlan {
  readonly placements: readonly Placement[]
  /** True when every shard was placed at its requested redundancy. */
  readonly complete: boolean
}

/**
 * Decide where each shard runs.
 *
 * Load is consulted **only to order nodes that are already eligible**. It can never
 * widen the candidate set, so no amount of pressure on an owner's nodes can push
 * sovereign work off them.
 */
export function planPlacement(
  requests: readonly PlacementRequest[],
  nodes: readonly NodeDescriptor[],
): PlacementPlan {
  const placements = requests.map((request): Placement => {
    if (!Number.isInteger(request.redundancy) || request.redundancy < 1) {
      return {
        shardId: request.shardId,
        status: 'unplaceable',
        reason: `redundancy must be a positive integer, got ${request.redundancy}`,
      }
    }

    const eligible = eligibleNodes(request, nodes)
    if (eligible.length === 0) {
      // A stalled sovereign shard is the correct outcome. The alternative — running
      // it somewhere else — is the failure this whole module exists to prevent.
      return {
        shardId: request.shardId,
        status: 'unplaceable',
        reason:
          request.label === 'sovereign'
            ? `no executable node for owner ${request.ownerId ?? '(unspecified)'}`
            : 'no nodes available',
      }
    }

    // Least-loaded first, tie-broken by id so a plan is reproducible.
    const ordered = [...eligible].sort((a, b) => a.load - b.load || a.nodeId.localeCompare(b.nodeId))
    const chosen = ordered.slice(0, request.redundancy)

    return {
      shardId: request.shardId,
      status: 'placed',
      nodeIds: chosen.map((node) => node.nodeId),
      replicas: chosen.length,
      degraded: chosen.length < request.redundancy,
    }
  })

  return {
    placements,
    complete: placements.every((p) => p.status === 'placed' && !p.degraded),
  }
}
