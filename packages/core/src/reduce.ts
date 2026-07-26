/**
 * Decomposable tree-reduce — MR-02 through MR-07.
 *
 * Aggregation across owners has to happen without moving anyone's data, without a
 * shuffle, and without anything to migrate when a machine disappears mid-job. Three
 * ideas do all the work, and each removes a whole category of machinery:
 *
 * **Topology is derived, not agreed.** The tree is a pure function of the sorted
 * partial CIDs, so every participant computes the identical tree independently and
 * *zero* messages are spent reaching agreement. No leader election, no consensus
 * round, no coordinator to lose. Change one partial and the tree changes the same way
 * for everyone at once, because the input to the function changed.
 *
 * **Assignment is derived too.** Rendezvous (HRW) hashing ranks every candidate node
 * for every combine. The winner is the executor; the rest of the ranking *is* the
 * fallback list, already known locally. There is nothing to look up when a node dies.
 *
 * **A combine is a pure function of content-addressed inputs.** So repair is not
 * recovery — there is no state to transfer, no checkpoint to restore, no partial
 * progress to reconcile. Losing an aggregator means calling the same function
 * somewhere else with the same CIDs. A late result from the presumed-dead node is
 * harmless: it carries the same CID as the recomputed one, so it dedupes into
 * nothing.
 *
 * **Associativity is the load-bearing property**, and it is what the reference test
 * checks: merging up a tree must equal merging everything at once, or the aggregate
 * depends on a topology that was only ever an implementation detail.
 *
 * Commutativity is *not* strictly required here, and saying otherwise would be
 * imprecise. Sorted CIDs and deterministic grouping mean every executor — original or
 * recomputing replacement — receives a combine's inputs in the same order, so an
 * order-dependent reducer would still be consistent. It is worth having anyway, since
 * it is what would let the grouping change without silently changing answers, but the
 * property the tests actually enforce is associativity.
 *
 * Pure module. Hashing is synchronous (`@noble/hashes`) so tree derivation needs no
 * `await` — a participant deriving topology should not have to be async to do it.
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import type { CID } from 'multiformats/cid'
import { canonicalCid } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import { toHex } from './capability.ts'
import type { Blockstore } from './ports.ts'

/**
 * Default children per combine.
 *
 * Four keeps a combine's inputs comfortably inside the browser mesh's 16 KiB message
 * ceiling when partials are at the size budget below, while keeping the tree shallow
 * enough that depth does not dominate latency.
 */
export const DEFAULT_FANOUT = 4

/**
 * Largest a reduce partial may be, in bytes.
 *
 * "Single-digit KiB", because the browser tier has to carry these and js-libp2p caps a
 * WebRTC message at 16 KiB. A partial that outgrows this has stopped being a summary
 * and started being data, which is also a sovereignty problem.
 */
export const MAX_PARTIAL_BYTES = 9216

/** A node in the derived tree. Leaves are partial CIDs; internal nodes are combines. */
export interface ReduceTreeNode {
  /** Deterministic id: the hash of this node's children. Stable before execution. */
  readonly id: string
  /** Child ids, in canonical order. */
  readonly children: readonly string[]
  /** 1 for the first combine layer above the leaves. */
  readonly level: number
}

export interface ReduceTree {
  /** Partial CIDs as strings, sorted. The canonical ordering everything derives from. */
  readonly leaves: readonly string[]
  /** Internal nodes, bottom-up. Empty when there is a single partial. */
  readonly nodes: readonly ReduceTreeNode[]
  /** The id whose value is the job's aggregate — a leaf id if there was only one. */
  readonly rootId: string
  readonly fanout: number
  readonly depth: number
}

/** Synchronous hash of a string, hex-encoded. */
function hashOf(input: string): string {
  return toHex(nobleSha256(new TextEncoder().encode(input)))
}

/**
 * Derive the reduce tree from a set of partial CIDs.
 *
 * Deterministic in the strongest sense: the same CIDs in any input order produce a
 * byte-identical tree, because the first thing it does is sort them. That is what lets
 * every participant derive the topology alone.
 */
export function deriveReduceTree(partialCids: readonly CID[], fanout: number = DEFAULT_FANOUT): ReduceTree {
  if (!Number.isInteger(fanout) || fanout < 2) {
    throw new RangeError(`fanout must be an integer >= 2, got ${fanout}`)
  }
  if (partialCids.length === 0) throw new RangeError('a reduce needs at least one partial')

  // Sorting is the whole basis of agreement. Deduped as well, so the same partial
  // offered twice cannot change the shape of anyone's tree.
  const leaves = [...new Set(partialCids.map((cid) => cid.toString()))].sort()

  const nodes: ReduceTreeNode[] = []
  let layer: string[] = leaves
  let level = 1

  while (layer.length > 1) {
    const next: string[] = []
    for (let i = 0; i < layer.length; i += fanout) {
      const children = layer.slice(i, i + fanout)
      if (children.length === 1) {
        // A lone child is promoted rather than wrapped in a pointless combine —
        // combining one value with nothing is work that produces the same bytes.
        next.push(children[0] as string)
        continue
      }
      const id = hashOf(children.join('|'))
      nodes.push({ id, children, level })
      next.push(id)
    }
    layer = next
    level += 1
  }

  return {
    leaves,
    nodes,
    rootId: layer[0] as string,
    fanout,
    depth: level - 1,
  }
}

/**
 * Rank nodes for a key by rendezvous (highest-random-weight) hashing.
 *
 * Returns *all* candidates in preference order, not just the winner: the tail is the
 * fallback list, so when the assigned node dies the next one is already known without
 * asking anybody. Adding or removing a node reshuffles only the keys that node won,
 * which is the property that makes this preferable to modulo assignment.
 */
export function rendezvousRank(key: string, nodeIds: readonly string[]): readonly string[] {
  return [...nodeIds]
    .map((nodeId) => ({ nodeId, score: hashOf(`${key}|${nodeId}`) }))
    .sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : a.nodeId.localeCompare(b.nodeId)))
    .map((entry) => entry.nodeId)
}

/** One combine to execute: merge these inputs into one value. */
export interface CombineTask {
  readonly nodeId: string
  readonly inputCids: readonly string[]
  readonly level: number
}

/**
 * Runs one combine on a named executor.
 *
 * Resolving to `null` means that executor is gone — the caller falls through to the
 * next in the rendezvous ranking and recomputes there.
 */
export interface CombineDispatch {
  (task: CombineTask, executorId: string): Promise<CID | null>
}

export interface ReduceRun {
  readonly tree: ReduceTree
  readonly executors: readonly string[]
  readonly dispatch: CombineDispatch
  /**
   * Executors per combine. Defaults to 1.
   *
   * This is what carries the verification claim for sovereign data. A sovereign map
   * cannot be run twice — pinning data to one owner removes the second independent
   * executor by construction — so those partials are *owner-attested*. The
   * aggregation over them can be redundant, because a combine reads only
   * content-addressed partials and is therefore runnable anywhere. Stated plainly:
   * the owner's contribution is trusted; the aggregation over contributions is
   * verified.
   *
   * Disagreement is reported, never voted on — the same rule as `executeVerified`.
   */
  readonly redundancy?: number
}

export interface ReduceOutcome {
  readonly ok: boolean
  /** CID of the aggregate, or null if some combine could not be placed anywhere. */
  readonly rootCid: string | null
  /** Combines that produced a result. */
  readonly combines: number
  /** Combines that had to be re-run on a fallback executor after a node vanished. */
  readonly recomputes: number
  /** Which executor actually produced each combine. */
  readonly executedBy: ReadonlyMap<string, string>
  readonly failed: readonly string[]
  /**
   * Combines where replicas produced different CIDs, with every distinct answer.
   *
   * Surfaced rather than resolved. A silent majority vote here would hide exactly
   * the event redundancy exists to detect.
   */
  readonly disagreements: readonly { readonly nodeId: string; readonly resultCids: readonly string[] }[]
  /** Replicas actually achieved per combine, lowest first. */
  readonly minReplicas: number
}

/**
 * Execute a derived tree, falling through the rendezvous ranking on failure.
 *
 * A level completes before the next begins, since a combine's inputs are the previous
 * level's outputs. Within a level the combines are independent and run concurrently.
 */
export async function executeReduce(run: ReduceRun): Promise<ReduceOutcome> {
  const { tree, executors, dispatch } = run
  if (executors.length === 0) {
    return {
      ok: false,
      rootCid: null,
      combines: 0,
      recomputes: 0,
      executedBy: new Map(),
      failed: [tree.rootId],
      disagreements: [],
      minReplicas: 0,
    }
  }

  // Tree-node id → the CID its value ended up at. Leaves already are CIDs.
  const resolved = new Map<string, string>(tree.leaves.map((leaf) => [leaf, leaf]))
  const executedBy = new Map<string, string>()
  const failed: string[] = []
  const disagreements: { nodeId: string; resultCids: readonly string[] }[] = []
  let combines = 0
  let recomputes = 0
  let minReplicas = Number.POSITIVE_INFINITY

  const maxLevel = tree.nodes.reduce((max, node) => Math.max(max, node.level), 0)

  for (let level = 1; level <= maxLevel; level++) {
    const atLevel = tree.nodes.filter((node) => node.level === level)

    const results = await Promise.all(
      atLevel.map(async (node) => {
        const inputCids = node.children.map((child) => resolved.get(child))
        // A missing input means a child combine failed outright; nothing to do here.
        if (inputCids.some((cid) => cid === undefined)) {
          return { node, cid: null, attempts: 0, replicas: 0, cids: [] }
        }

        const task: CombineTask = {
          nodeId: node.id,
          inputCids: inputCids as string[],
          level: node.level,
        }

        // The ranking *is* the fallback list — no lookup, no coordinator.
        const ranked = rendezvousRank(node.id, executors)
        const wanted = Math.max(1, run.redundancy ?? 1)
        const produced: { cid: string; executorId: string }[] = []
        let attempts = 0

        // Walk the ranking until `wanted` replicas have answered. A node that is
        // gone costs an attempt and nothing else — the next in the ranking
        // recomputes from the same CIDs.
        for (const executorId of ranked) {
          if (produced.length >= wanted) break
          const cid = await dispatch(task, executorId)
          if (cid === null) {
            attempts += 1
            continue
          }
          produced.push({ cid: cid.toString(), executorId })
        }

        if (produced.length === 0) return { node, cid: null, attempts, replicas: 0, cids: [] }
        return {
          node,
          cid: (produced[0] as { cid: string }).cid,
          attempts,
          executorId: (produced[0] as { executorId: string }).executorId,
          replicas: produced.length,
          cids: [...new Set(produced.map((p) => p.cid))],
        }
      }),
    )

    for (const result of results) {
      if (result.cid === null) {
        failed.push(result.node.id)
        continue
      }
      resolved.set(result.node.id, result.cid)
      executedBy.set(result.node.id, result.executorId as string)
      combines += 1
      // Every failed attempt is a recompute elsewhere, from the same
      // content-addressed inputs — no state was moved to make it possible.
      recomputes += result.attempts
      minReplicas = Math.min(minReplicas, result.replicas)
      if (result.cids.length > 1) {
        disagreements.push({ nodeId: result.node.id, resultCids: result.cids })
      }
    }
  }

  const rootCid = resolved.get(tree.rootId) ?? null
  return {
    // A disagreement is a failed reduce, not a reduce with a footnote.
    ok: rootCid !== null && failed.length === 0 && disagreements.length === 0,
    rootCid,
    combines,
    recomputes,
    executedBy,
    failed,
    disagreements,
    minReplicas: Number.isFinite(minReplicas) ? minReplicas : 0,
  }
}

/**
 * Merges a set of partial values into one.
 *
 * **Must be associative** — see the note at the top of this file. Commutativity is
 * recommended but is not what the tree relies on.
 */
export interface Combiner {
  (inputs: readonly CanonicalValue[]): CanonicalValue
}

/**
 * A `CombineDispatch` backed by a local blockstore and a pure combiner.
 *
 * `liveNodes` decides which executors are reachable; anything else resolves `null` and
 * triggers the fallback path. Writing the result is idempotent because the blockstore
 * is content-addressed — which is exactly why a late duplicate from a node presumed
 * dead costs nothing: same inputs, same bytes, same CID, no second entry.
 */
export function localDispatch(options: {
  readonly blockstore: Blockstore
  readonly combiner: Combiner
  readonly decode: (bytes: Uint8Array<ArrayBuffer>) => CanonicalValue
  readonly liveNodes: () => ReadonlySet<string>
}): CombineDispatch {
  return async (task, executorId) => {
    if (!options.liveNodes().has(executorId)) return null

    const inputs: CanonicalValue[] = []
    for (const cidString of task.inputCids) {
      const { CID } = await import('multiformats/cid')
      const bytes = await options.blockstore.get(CID.parse(cidString))
      if (bytes === undefined) return null
      inputs.push(options.decode(bytes))
    }

    const merged = options.combiner(inputs)
    const hashed = await canonicalCid(merged)
    if (!hashed.ok) return null
    await options.blockstore.put(hashed.bytes)
    return hashed.cid
  }
}
