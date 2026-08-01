/**
 * Decomposable tree-reduce — MR-02 through MR-07.
 *
 * Aggregation across owners has to happen without moving anyone's data, without a
 * shuffle, and without anything to migrate when a machine disappears mid-job. Three
 * ideas do all the work, and each removes a whole category of machinery:
 *
 * **Topology is derived, not agreed.** The tree is a pure function of the sorted
 * contributions, so every participant computes the identical tree independently and
 * *zero* messages are spent reaching agreement. No leader election, no consensus
 * round, no coordinator to lose. Change one partial and the tree changes the same way
 * for everyone at once, because the input to the function changed.
 *
 * A contribution is **(contributor, partial)** and not the partial alone. Keying a
 * leaf on the bytes cannot tell "one owner offered this twice" from "four owners each
 * summarised their own rows and got the same answer" — the ordinary case for count,
 * sum, exists and histogram — and it silently counted the second as the first. The
 * price is stated rather than left to be discovered: the tree is no longer a pure
 * function of content alone, so derivation now assumes participants agree on
 * contributor ids, which is the assumption `executors` already carries.
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
 * **Idempotence is explicitly not assumed.** A value appearing under two contributors
 * is two contributions, and combining it with itself must double it. That is the
 * whole reason a leaf carries who offered it.
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

/**
 * Most inputs one combine may merge. A **configuration choice**; no arithmetic
 * produces it.
 *
 * It exists because {@link deriveReduceTree} emits nodes with at most `fanout`
 * children and `fanout` is a caller parameter with no ceiling of its own. A frame
 * off the wire therefore needs a bound that does not depend on the sender having
 * derived its tree the way everybody else did.
 *
 * The bound belongs at the **parser**, not at the handler: a frame naming more
 * inputs than this does not become a request at all, which is the disposition
 * `parseRequest` already gives a partition index outside its own count. Refusing
 * later would mean refusing after the fetches it exists to prevent.
 *
 * **What it bounds, stated precisely, because the obvious reading is wrong.** This
 * is a ceiling on the *number of inputs* one combine may **merge**. It is not a
 * ceiling on what one combine frame may cause to be transferred or to stay
 * resident. A combine names its inputs by CID, and the handler reads each one
 * through a blockstore that — for a fetching blockstore — has by then already
 * pulled the block over the wire, hash-verified it and written it to the local
 * store; only afterwards can {@link MAX_PARTIAL_BYTES} refuse the merge.
 *
 * There *is* a wire ceiling underneath, and it is worth naming precisely so nobody
 * reads more into this constant than it carries: NET-08 has landed, and
 * `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`) bounds any single inbound message,
 * with a per-peer cap on concurrent accumulation beside it. What NET-08 bounds is
 * *one message*; what this constant bounds is *how many* a single frame may
 * provoke. No product of the two is written here, because a residency figure that
 * nobody measured against a running node is not a guarantee — if one is ever
 * wanted, measure it and record it with its date.
 */
export const MAX_COMBINE_INPUTS = 64

/**
 * One partial, and whose data produced it.
 *
 * `contributorId` means **the owner whose data produced this partial**, never the
 * machine that ran the map. Under redundancy and speculation two executors answer for
 * the same shard with the same bytes, and an executor-keyed leaf would count that
 * shard twice — the mirror of the defect this type exists to close.
 *
 * **Nothing authenticates this field.** One peer can invent N ids for one partial and
 * inflate the aggregate N-fold, which is this fix's cost: a silent undercount becomes
 * a forgeable overcount. Under the project's own split — a sovereign map is
 * owner-attested and the aggregation over contributions is verified — the only honest
 * source for this value is the Noise-authenticated peer the partial arrived from, and
 * the collection path that would mint it does not exist yet. Do not populate it from
 * anything a requestor chose.
 */
export interface ReduceContribution {
  readonly contributorId: string
  readonly cid: CID
}

/**
 * A leaf: what identifies it, and where its value lives.
 *
 * The tree already keeps these apart one level up — an internal node's `id` is a hash
 * of its children while its value resolves to a CID at execution time. Only the leaf
 * layer conflated them, which is why two contributors offering the same bytes became
 * one node.
 */
export interface ReduceLeaf {
  /** Distinct per contribution. What combine layers and `executedBy` are keyed by. */
  readonly id: string
  /** The partial's address, as a string. What a combine actually reads. */
  readonly cid: string
}

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
  /** Contributions, sorted by id. The canonical ordering everything derives from. */
  readonly leaves: readonly ReduceLeaf[]
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
 * A leaf's identity: who contributed, and what.
 *
 * NUL separator, so no contributor id can be spelled to make two distinct
 * contributions collide on one leaf. Same idiom as `StartOutcomeLedger`'s key.
 */
function leafId(contributorId: string, cid: CID): string {
  return `${contributorId}\u0000${cid.toString()}`
}

/**
 * Derive the reduce tree from a set of contributions.
 *
 * Deterministic in the strongest sense: the same contributions in any input order
 * produce a byte-identical tree, because the first thing it does is sort them. That is
 * what lets every participant derive the topology alone.
 */
export function deriveReduceTree(
  contributions: readonly ReduceContribution[],
  fanout: number = DEFAULT_FANOUT,
): ReduceTree {
  if (!Number.isInteger(fanout) || fanout < 2) {
    throw new RangeError(`fanout must be an integer >= 2, got ${fanout}`)
  }
  if (contributions.length === 0) throw new RangeError('a reduce needs at least one partial')

  // Sorting is the whole basis of agreement. Deduped as well, so the *same
  // contributor* offering the same partial twice cannot change the shape of anyone's
  // tree — which is what makes a late result from a presumed-dead node harmless.
  const byId = new Map<string, ReduceLeaf>()
  for (const { contributorId, cid } of contributions) {
    const leaf: ReduceLeaf = { id: leafId(contributorId, cid), cid: cid.toString() }
    byId.set(leaf.id, leaf)
  }
  const leaves = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const nodes: ReduceTreeNode[] = []
  // Combine layers are built over leaf *identities*, so every id within a layer is
  // distinct and no two combines can hash to the same node id.
  let layer: string[] = leaves.map((leaf) => leaf.id)
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

  // Tree-node id → the CID its value ended up at. A leaf's value is already stored,
  // so it starts resolved — at its address, which is not its identity.
  const resolved = new Map<string, string>(tree.leaves.map((leaf) => [leaf.id, leaf.cid]))
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
 *
 * **Must not assume its inputs are distinct.** Two contributors reaching the same
 * summary is the ordinary case, and a combiner is handed both — `{count:5}` twice is
 * `{count:10}`. A combiner that deduplicates its inputs would put back the defect the
 * leaf key removed, one layer up.
 */
export interface Combiner {
  (inputs: readonly CanonicalValue[]): CanonicalValue
}

/** The shape the fabric's one merge accepts: a count map and the rows behind it. */
export interface FabricPartial {
  readonly counts: { readonly [key: string]: number }
  readonly rows: number
}

/**
 * A partial off the wire, or `null` if it is not one.
 *
 * Exported as its own predicate rather than inlined into {@link fabricCombiner}
 * because it has **two callers with two different dispositions**, and that split is
 * the design rather than an accident:
 *
 * - **On the wire**, inside `fabricCombiner`, a `null` here contributes zero and the
 *   merge continues. Bytes that arrived from a peer must not be able to abort a
 *   combine — one malformed partial would otherwise take down an aggregate that
 *   every other contributor answered honestly.
 * - **At the requestor**, where a local projection produced the value, the same
 *   `null` must be a *named failure*. There the value was authored here, so a
 *   diagnosis is possible and silently contributing zero would turn a bug in the
 *   projection into a quietly wrong answer.
 *
 * Neither disposition is the "correct" one to standardise on. Do not later
 * "fix" one into the other.
 */
export function asFabricPartial(value: CanonicalValue): FabricPartial | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value instanceof Uint8Array) return null
  const record = value as { readonly [k: string]: CanonicalValue }
  const rows = record['rows']
  if (typeof rows !== 'number' || !Number.isFinite(rows)) return null
  const counts = record['counts']
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) return null
  if (counts instanceof Uint8Array) return null
  const entries = counts as { readonly [k: string]: CanonicalValue }
  const checked: { [k: string]: number } = {}
  for (const [word, n] of Object.entries(entries)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    checked[word] = n
  }
  return { counts: checked, rows }
}

/**
 * The one merge the fabric offers: key-wise sum of counts, plus a row total.
 *
 * **Why exactly one, and not a per-job choice.** If two nodes could hold different
 * combiners, the mismatch would surface only as an {@link executeReduce}
 * `disagreement` with nothing to name the cause — the tree is *derived, never
 * agreed*, so there is no negotiation step at which two combiners could be compared
 * and found different. Failing loud with no diagnosis is worse than having no
 * configuration knob at all.
 *
 * Per-job semantics arrive instead as a requestor-side **projection**. The map
 * output shape and the partial shape are not the same thing — `MODULE_WRITES_PARTITION`
 * emits `{p: <4 LE bytes>}` while this monoid consumes `{counts, rows}` — so the
 * projection is where a job says what its numbers mean. The projection never crosses
 * a wire; the combiner never varies.
 *
 * **Nothing verifies the projection, and that gap is real.** `executeReduce` verifies
 * the aggregation *over* partials; it cannot see whether the requestor projected each
 * shard output faithfully into those partials in the first place. A requestor that
 * projected its own outputs unfaithfully would not be caught. For a public job the
 * requestor is the job's own author and has no reason to corrupt its own answer —
 * that stops being true the moment a third party submits on someone else's behalf.
 * The closure is the deferred content-addressed combine module, where the projection
 * would itself be guest code carrying a CID.
 *
 * Total by construction: anything {@link asFabricPartial} rejects contributes zero
 * rather than throwing, because a combine must survive one bad partial among many.
 */
export const fabricCombiner: Combiner = (inputs) => {
  const counts = new Map<string, number>()
  let rows = 0
  for (const input of inputs) {
    const partial = asFabricPartial(input)
    if (partial === null) continue
    rows += partial.rows
    for (const [word, n] of Object.entries(partial.counts)) {
      counts.set(word, (counts.get(word) ?? 0) + n)
    }
  }
  // Sorted keys so *this object* has a stable iteration order for any reader that
  // looks at it without encoding it first.
  //
  // It is deliberately **not** what makes the CID order-independent, and the comment
  // this replaced said it was. Measured 2026-07-31: `@ipld/dag-cbor` sorts map keys
  // itself at encode time, so `encode({x,z,y})` and `encode({y,x,z})` are byte-equal
  // and the CID is order-independent with or without this line. Deleting the `.sort()`
  // leaves every test in `reduce.test.ts` green — which is the evidence, and also the
  // reason not to describe this line as load-bearing for determinism.
  const merged: { [k: string]: number } = {}
  for (const key of [...counts.keys()].sort()) merged[key] = counts.get(key) as number
  return { counts: merged, rows }
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
