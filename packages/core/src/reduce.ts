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
import type { AttestedResult } from './result-attestation.ts'

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
 * What one combine produced, and what the node that produced it said about it.
 *
 * The second field is the whole of VER-08/09/10 on the reduce side. `PROJECT.md` states
 * the project's split as *the owner's contribution is trusted; the aggregation over
 * contributions is verified* — and an aggregation nobody signed is not verified by
 * anybody, it is merely reported by whoever asked for it. So a combine's result and the
 * producing node's statement about it travel together, from the dispatch to
 * {@link ReduceOutcome}, and there is no arrangement of this type in which one arrives
 * without the other.
 *
 * `attestation` is `'signed-by-nobody'` when the producing node holds no certificate.
 * That is a truthful answer and not a degraded one — see `result-attestation.ts`, where
 * {@link AttestedResult}'s sentinel is defined.
 */
export interface CombineProduct {
  /** `canonicalCid` of the merged value. Exactly what this dispatch used to return. */
  readonly cid: CID
  /** The producing node's signed statement over `(inputCids, cid)`, or the sentinel. */
  readonly attestation: AttestedResult
}

/**
 * Runs one combine on a named executor.
 *
 * Resolving to `null` means that executor is gone — the caller falls through to the
 * next in the rendezvous ranking and recomputes there. **That meaning did not change
 * when this return widened to {@link CombineProduct}**, and it is written down here
 * because a widened return type is exactly where a recorded distinction gets flattened
 * by accident: an unsigned answer is a `CombineProduct` carrying the sentinel, never a
 * `null`, and `@o2/net`'s `LocalStoreWriteFailed` is still thrown rather than collapsed
 * into either.
 */
export interface CombineDispatch {
  (task: CombineTask, executorId: string): Promise<CombineProduct | null>
}

/**
 * Whether the requestor may perform this combine in its own process, and — when it may
 * not — the named condition that sends the combine to a peer instead.
 *
 * **The reason is required on the refusing arm and has no default**, on the same ground
 * `Admission.standing` is: a refusal that did not say why is a refusal nobody can plan
 * around, and this one decides who computed the number a job returns. Every refusal
 * reaches {@link ReduceOutcome.localRefusals} verbatim, so the condition that sent a
 * combine to a peer is readable off the outcome rather than inferable from its absence.
 */
export type LocalCombineAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/**
 * The requestor's own combiner, and the question it must answer before using it.
 *
 * **Placement policy, owner ruling 2026-08-18:** *"Always prefer local execution, unless
 * it must be executed remotely (requested to do so, or needs certain permissions that
 * cannot be satisfied or data ownership requires, etc.) or the current node is fully
 * loaded."* So {@link admits} is asked **first**, before any peer, and a `true` answer
 * means no peer is contacted at all at `redundancy: 1`.
 *
 * The two halves are separate fields rather than one function that returns `null`,
 * because they answer different questions and only one of them has an answer worth
 * recording: `admits` produces a *named condition* that survives into the outcome, while
 * `dispatch` produces a result or the ordinary `null` every {@link CombineDispatch}
 * produces. Folding them together would collapse "this node was not allowed to" into
 * "this node tried and got nothing", which are the two facts an operator most needs
 * apart.
 *
 * **This module states no policy of its own.** What counts as a permission, and what
 * counts as full, are the adapter's facts — `@o2/net`'s `reduceJob` answers them with
 * the same `Authorizer` and the same `LocalAdmission.would` a peer answers a combine
 * with, so the requestor is admitted to its own work by the rule everybody else is
 * admitted by.
 */
export interface LocalCombinePlacement {
  /** Asked once per combine, before the rendezvous ranking is walked at all. */
  readonly admits: (task: CombineTask) => LocalCombineAdmission | Promise<LocalCombineAdmission>
  /** The requestor's own dispatch. {@link localDispatch} is the one this repository has. */
  readonly dispatch: CombineDispatch
}

/**
 * The executor id recorded for a combine the requestor performed itself.
 *
 * **Not a peer id, and deliberately not shaped like one.** {@link ReduceOutcome.executedBy}
 * answers *who produced this combine*, and leaving a locally-combined node out of it would
 * make a combine that succeeded have no producer at all. Putting a plausible-looking peer
 * id in would be worse. So the entry is a string no peer can present, and
 * {@link ReduceOutcome.locallyCombined} carries the same fact in a form a caller can test
 * without string-matching this constant.
 */
export const LOCAL_COMBINE_EXECUTOR = 'the-requestor-itself'

export interface ReduceRun {
  readonly tree: ReduceTree
  readonly executors: readonly string[]
  readonly dispatch: CombineDispatch
  /**
   * Whether the requestor combines in its own process, and how it decides.
   *
   * **Required with a named sentinel, never optional.** `.planning/PROJECT.md`'s rule is
   * that an optional hook with a silent default is a hole, and here the hole has a
   * precise shape in *both* directions: omitted under the pre-2026-08-18 ordering it
   * would be the feature silently absent, and omitted under the current one it would be
   * a caller getting a self-computed aggregate it never asked for. `'combines-nothing-locally'`
   * is that decision recorded — every combine goes to a peer, which is what this function
   * did before this field existed.
   */
  readonly localCombine: LocalCombinePlacement | 'combines-nothing-locally'
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
  /**
   * What each combine's producer **signed** about it — tree node id → attestation.
   *
   * A second map beside {@link executedBy} rather than a widened value, and the two
   * answer different questions: `executedBy` is *the requestor's own record of who
   * answered*, this is *what that answerer said, in a form a third party can check*.
   * Both are filled in one loop in {@link executeReduce} from one accepted result, so
   * they cannot drift apart.
   *
   * **Why a second map here, when Plan 19-14 refused a second array beside
   * `VerificationResult.agreeing`.** The two plans read as inconsistent without this
   * paragraph, and the difference is real. There, a downstream reader could have built a
   * receipt out of the *names* while the signatures sat unread beside them — possible
   * because a requestor's discovery descriptors can turn a node id into a certificate,
   * so a wrong choice genuinely existed. **Here there is no such wrong choice**: this
   * map's sibling holds peer ids, and nothing anywhere in the reduce path can turn a
   * peer id into a certificate. A receipt cannot be built from `executedBy` at all, so
   * separating the two costs a reader nothing and leaves `executedBy` answering exactly
   * the question it always answered.
   *
   * **A combine whose replicas disagreed is absent from this map**, while remaining
   * present in `executedBy` and in {@link disagreements}. `verify.ts`'s standing rule:
   * putting signatures on a disagreement invites somebody to pick a winner from them,
   * and there is no agreed answer to attest.
   *
   * **A signed aggregation is not a correct one.** The signature says a certified node
   * performed this merge over these partials; whether the answer is right is what
   * `redundancy` and `disagreements` are for, exactly as a signed `exec` result is not
   * a correct one.
   */
  readonly attestations: ReadonlyMap<string, AttestedResult>
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
  /**
   * Combines the requestor performed **in its own process** — tree node ids.
   *
   * **This is the load-bearing field of the local-combine policy and it is not a
   * footnote.** `PROJECT.md` splits this project's integrity claim as *the owner's
   * contribution is trusted; the aggregation over contributions is verified*, and an
   * aggregation the requestor performed itself is verified by nobody: {@link localDispatch}
   * signs nothing **on purpose**, because a signature the requestor made would be it
   * attesting to itself. Under the owner ruling of 2026-08-18 that is no longer the rare
   * case — local is the *preferred* placement — so this field is what stands between a
   * caller and a silently weakened claim.
   *
   * It is a third per-combine array beside {@link failed} and {@link disagreements}
   * rather than a new channel, and it is deliberately **not** derived by reading
   * {@link LOCAL_COMBINE_EXECUTOR} back out of {@link executedBy}: a caller testing this
   * property should not have to string-match a constant, and `attestations` records the
   * ordinary `'signed-by-nobody'` sentinel here, which a peer holding no certificate also
   * records. *Unsigned* and *self-computed* are different facts and only this field
   * separates them.
   */
  readonly locallyCombined: readonly string[]
  /**
   * Combines the requestor was **not** admitted to run locally, with the condition that
   * sent each one to a peer.
   *
   * Present for the same reason `Rejection` is present on a placement: "it went remote"
   * and "it went remote *because this node was full*" are different facts, and an
   * operator asking why a tab shipped its combines out cannot answer it from an absence.
   * Every entry is a {@link LocalCombineAdmission} refusal reason verbatim — this module
   * composes none of them.
   */
  readonly localRefusals: readonly { readonly nodeId: string; readonly reason: string }[]
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
      attestations: new Map(),
      failed: [tree.rootId],
      disagreements: [],
      minReplicas: 0,
      // **The local placement is not consulted on this arm, and that is deliberate.**
      // An empty executor set is a caller that named nobody to combine over, which is a
      // different condition from a fabric whose peers are unreachable — `@o2/net`'s
      // `reduceJob` refuses it by name one layer up (`no executor to combine on`) before
      // this function is ever called. Answering it with a local combine would turn a
      // caller's construction error into a silently self-computed aggregate.
      locallyCombined: [],
      localRefusals: [],
    }
  }

  // Tree-node id → the CID its value ended up at. A leaf's value is already stored,
  // so it starts resolved — at its address, which is not its identity.
  const resolved = new Map<string, string>(tree.leaves.map((leaf) => [leaf.id, leaf.cid]))
  const executedBy = new Map<string, string>()
  const attestations = new Map<string, AttestedResult>()
  const failed: string[] = []
  const locallyCombined: string[] = []
  const localRefusals: { nodeId: string; reason: string }[] = []
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
          // No local admission is asked for either, and no refusal is recorded: nothing
          // was placed anywhere, so there is no placement decision to report.
          return {
            node,
            cid: null,
            attempts: 0,
            replicas: 0,
            cids: [],
            combinedLocally: false,
            localRefusal: null,
          }
        }

        const task: CombineTask = {
          nodeId: node.id,
          inputCids: inputCids as string[],
          level: node.level,
        }

        // The ranking *is* the fallback list — no lookup, no coordinator.
        const ranked = rendezvousRank(node.id, executors)
        const wanted = Math.max(1, run.redundancy ?? 1)
        const produced: { cid: string; executorId: string; attestation: AttestedResult }[] = []
        let attempts = 0
        let combinedLocally = false
        let localRefusal: string | null = null

        // ── Local first, by owner ruling 2026-08-18. ──────────────────────────────────
        //
        // *"Always prefer local execution, unless it must be executed remotely (requested
        // to do so, or needs certain permissions that cannot be satisfied or data
        // ownership requires, etc.) or the current node is fully loaded."* So this block
        // sits **above** the ranking walk and not below it, and at `redundancy: 1` an
        // admitted local combine means no peer is contacted for this node at all.
        //
        // **This ordering replaced its own inverse before either shipped**, and the
        // superseded shape is written down because the two are one `if` apart and a later
        // reader will otherwise assume this one was always here: the first design put this
        // block after the ranking as a last resort that *"must never pre-empt a reachable
        // peer"*. It pre-empts one now, deliberately.
        //
        // **What does not change is what a `null` from a dispatch means.** An admitted
        // local combine that produces nothing is recorded as a refusal *with its own
        // reason* and the ranking walk below then runs exactly as it always did — the
        // requestor failing at its own combine is not a fact about any peer, which is the
        // same distinction `@o2/net`'s `LocalStoreWriteFailed` exists to keep.
        if (run.localCombine !== 'combines-nothing-locally') {
          const admission = await run.localCombine.admits(task)
          if (!admission.ok) {
            localRefusal = admission.reason
          } else {
            const product = await run.localCombine.dispatch(task, LOCAL_COMBINE_EXECUTOR)
            if (product === null) {
              localRefusal =
                'this node was admitted to combine locally and its own combiner produced nothing'
            } else {
              combinedLocally = true
              produced.push({
                cid: product.cid.toString(),
                executorId: LOCAL_COMBINE_EXECUTOR,
                attestation: product.attestation,
              })
            }
          }
        }

        // Walk the ranking until `wanted` replicas have answered. A node that is
        // gone costs an attempt and nothing else — the next in the ranking
        // recomputes from the same CIDs.
        //
        // **`null` here still means only one thing**, and the widened return is why it
        // is worth saying: a node that produced a result but signs nothing answers with
        // a `CombineProduct` carrying the sentinel and is a perfectly ordinary replica.
        // Reading an unsigned answer as a dead peer would walk the ranking past every
        // unenrolled node in the fabric.
        for (const executorId of ranked) {
          if (produced.length >= wanted) break
          const product = await dispatch(task, executorId)
          if (product === null) {
            attempts += 1
            continue
          }
          produced.push({ cid: product.cid.toString(), executorId, attestation: product.attestation })
        }

        if (produced.length === 0) {
          return { node, cid: null, attempts, replicas: 0, cids: [], combinedLocally, localRefusal }
        }
        const accepted = produced[0] as { cid: string; executorId: string; attestation: AttestedResult }
        return {
          node,
          cid: accepted.cid,
          attempts,
          combinedLocally,
          localRefusal,
          executorId: accepted.executorId,
          // The accepted replica's own statement, never one composed from several. Under
          // redundancy the replicas that agreed each signed their own bytes; this is the
          // one whose result the outcome carries.
          attestation: accepted.attestation,
          replicas: produced.length,
          cids: [...new Set(produced.map((p) => p.cid))],
        }
      }),
    )

    for (const result of results) {
      // Recorded **before** the failure arm, because a combine that was refused locally
      // and then failed on every peer is precisely the case where the operator most needs
      // to know which of the two happened first.
      if (result.localRefusal !== null) {
        localRefusals.push({ nodeId: result.node.id, reason: result.localRefusal })
      }
      if (result.cid === null) {
        failed.push(result.node.id)
        continue
      }
      // `combinedLocally` is set only where the local dispatch produced the accepted
      // replica, which is `produced[0]` because the local block runs before the ranking
      // walk. A combine whose local attempt failed and whose peer succeeded is absent
      // here and present in `localRefusals` — the two arrays are disjoint by
      // construction, and neither is derivable from the other.
      if (result.combinedLocally) locallyCombined.push(result.node.id)
      resolved.set(result.node.id, result.cid)
      executedBy.set(result.node.id, result.executorId as string)
      combines += 1
      // Every failed attempt is a recompute elsewhere, from the same
      // content-addressed inputs — no state was moved to make it possible.
      recomputes += result.attempts
      minReplicas = Math.min(minReplicas, result.replicas)
      if (result.cids.length > 1) {
        disagreements.push({ nodeId: result.node.id, resultCids: result.cids })
      } else {
        // Recorded on the same pass as the executor, from the same accepted result, so
        // the two maps cannot drift. Deliberately **not** recorded on the disagreement
        // arm above: a signature beside a combine with no agreed answer is an invitation
        // to pick a winner out of the signatures, which `verify.ts` forbids.
        attestations.set(result.node.id, result.attestation as AttestedResult)
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
    attestations,
    failed,
    disagreements,
    minReplicas: Number.isFinite(minReplicas) ? minReplicas : 0,
    locallyCombined,
    localRefusals,
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
 *
 * **It states that it signs nothing, and that is the right answer rather than a gap to
 * be closed later.** This combiner is the requestor's own code running in the
 * requestor's own process: a signature it made would be the requestor attesting to
 * itself, which proves nothing to the only party reading it. The named sentinel is what
 * stops somebody handing this function a signing key on the assumption that more
 * signatures are always better.
 *
 * **That sentence used to describe a function with no production caller, and since
 * 2026-08-18 it does not.** `@o2/net`'s `reduceJob` composes this as the `dispatch` half
 * of a {@link LocalCombinePlacement}, and the owner's placement ruling makes it the
 * *preferred* path rather than a fallback — so the unsigned answer above is now the
 * ordinary answer for a job that runs on a node with headroom. Nothing here changed to
 * make that true, and nothing here should: what changed is that the outcome now says so,
 * in {@link ReduceOutcome.locallyCombined}. Read that field's docstring before assuming
 * `'signed-by-nobody'` alone carries the fact — a peer holding no certificate answers
 * with the same sentinel and is not the requestor.
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
    return { cid: hashed.cid, attestation: 'signed-by-nobody' }
  }
}
