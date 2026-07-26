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
 * Pure module.
 */

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
 */
function eligibleNodes(
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
