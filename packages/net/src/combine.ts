/**
 * Dispatching a combine over RPC, and bringing its result home — MR-05, MR-06.
 *
 * The remote sibling of `localDispatch` (`@o2/core`, `reduce.ts`). `localDispatch`
 * reads its inputs from one blockstore and decides an executor is gone by asking
 * `liveNodes()`; the remote half gets that second fact for free, because a peer that
 * is gone is a peer whose RPC did not come back.
 *
 * | What happened | Result | Why |
 * |---|---|---|
 * | the RPC threw — timeout, send failed, endpoint closed | `null` | the peer never answered |
 * | the reply did not parse | `null` | a peer talking nonsense is a peer to route around |
 * | the reply was `error` | `null` | reachable, but refusing to serve this |
 * | the reply was some other kind | `null` | same |
 * | `combine` came back with `resultCid: null` | `null` | the node was reachable and could not run it |
 * | `combine` came back with a CID, but that peer would not serve the block | `null` | a result the requestor cannot retrieve is a result the next level cannot use |
 * | `combine` came back with a CID, and the block did not hash to it | `null` | the peer is answering with something other than what it claimed |
 * | the block came back and **this node** could not store it | throws {@link LocalStoreWriteFailed} | not a fact about the peer at all — see below |
 * | `combine` came back with a CID and the block was retrieved | the CID | the aggregate for this node is at that address, **and is resident here** |
 *
 * **The last row is the one that is easy to get wrong, so it is stated twice.** Every
 * other row is a fact about the peer, and `null` says "that executor is gone" — the
 * caller's cue to try the next in the ranking. A local `blockstore.put` that fails
 * says nothing about the peer: the peer answered, and answered correctly. Reporting
 * it as `null` sent `executeReduce` down the whole rendezvous ranking, recomputing on
 * every other executor, failing the identical local write each time, and finally
 * reporting **every executor in the fabric** as failed. A full disk read as a dead
 * fabric. So this one failure throws instead, and the throw names the store.
 *
 * **How this differs from `remoteDispatch`, because a reader will otherwise ask.**
 * `remoteDispatch` preserves the failure *kind* — node, sender, task — because the
 * coordinator it was written for branched on it. That coordinator (`runResilient`) was
 * deleted by Plan 20-12 and `remoteDispatch` now has no caller either, so the contrast
 * below is between two *shapes*, not between two live paths; `churn.ts`'s own header
 * carries the debt and its owner phase. `CombineDispatch` is `Promise<CID | null>` and
 * `executeReduce` has exactly one thing it does with a falsy answer: count an attempt
 * and move to the next node in the rendezvous ranking. So every failure collapses to
 * `null` here, and **the reason string the peer sent is lost by construction.**
 *
 * That is stated as a cost rather than elided. Recovering it would mean widening
 * `CombineDispatch` in `@o2/core`, which is a port change no criterion in this phase
 * asks for; and adding an observer callback instead would be an optional hook with a
 * silent default, which `.planning/PROJECT.md`'s Key Decisions rule out.
 *
 * **What actually survives, corrected against a measurement rather than assumed.** The
 * obvious answer — "`recomputes` plus `executedBy`" — is wrong for the case an operator
 * most needs it in, so it is written down here rather than left to be rediscovered.
 * `executeReduce` adds `attempts` to `recomputes` only for a combine that *eventually
 * produced a CID*; a combine that failed outright takes the `continue` above that line
 * and its attempts are discarded (`reduce.ts:397-406`). Measured 2026-07-31 on an
 * eight-node in-process fabric with this dispatcher's fetch-back removed: the root
 * combine fell through **all eight** executors and the run reported
 * `recomputes: 0`, `combines: 2`, `executedBy.size: 2`, `rootCid: null`, and `failed`
 * naming the root. So the diagnostics that do survive a reduce which failed everywhere
 * are **`failed`** — which combines produced nothing — and **`executedBy`** — who
 * answered for the ones that did. `recomputes` measures churn among *successes* and
 * reads zero on total failure.
 *
 * Pure module — it lives in the portable set `purity.node.test.ts` enforces for
 * `@o2/net`, so no `node:*` and no platform import.
 */

import { CID } from 'multiformats/cid'
import type { Blockstore, CombineDispatch, CombineProduct } from '@o2/core'
import { blockCid } from './block.ts'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { RpcEndpoint } from './rpc.ts'

export interface RemoteCombineOptions {
  readonly rpc: RpcEndpoint
  /**
   * The requestor's own LOCAL store.
   *
   * Each combine's result is fetched into it from the peer that produced it, before
   * this dispatch resolves, so the next level's combine node gets a local hit when it
   * asks the requestor for that CID.
   *
   * Pass the local tier, not a `FetchingBlockstore` wrapper: `put` delegates to local
   * either way, and passing the wrapper only obscures which tier is being written.
   */
  readonly blockstore: Blockstore
}

/**
 * This node could not write a combine result into its own store.
 *
 * Thrown, never returned as `null`, and the distinction is the whole point.
 * `CombineDispatch` resolving to `null` is defined in `@o2/core` (`reduce.ts`) to
 * mean *that executor is gone*; a `put` that fails is a fact about local storage —
 * `FsBlockstore`'s `writeFile`/`rename` on ENOSPC or EACCES, a browser's
 * `QuotaExceededError` — and the peer it would otherwise have accused answered
 * correctly.
 *
 * It carries the tree node rather than the executor id for the same reason: the
 * executor is not what went wrong, and naming it in the message would put the reader
 * back where the `null` did.
 */
export class LocalStoreWriteFailed extends Error {
  /** The *tree node's* combine id — `CombineTask.nodeId`, never a peer id. */
  readonly combineId: string
  /** The result that was retrieved and could not be kept. */
  readonly cid: string
  constructor(combineId: string, cid: string, cause: unknown) {
    super(
      `the local store refused the combine result for tree node ${combineId} (${cid}): ` +
        `${cause instanceof Error ? cause.message : String(cause)} — ` +
        "this is this node's own storage, not the executor that produced it",
      { cause },
    )
    this.name = 'LocalStoreWriteFailed'
    this.combineId = combineId
    this.cid = cid
  }
}

/**
 * A `CombineDispatch` that runs one combine on a peer and retrieves its result.
 *
 * **It carries the peer's attestation home and does not check it**, which is a placement
 * decision rather than an omission. This module holds no trust anchors and has no
 * business acquiring any: a trust decision made here would be made once, invisibly, for
 * every caller, where the whole point of `verifyCombineAttestation` taking its
 * `trustedIssuers` as an argument is that trust in this design is **per verifier and
 * pinned**. What this module does check is the *bytes*, against the CID the peer
 * claimed — content addressing, which it already did and still does. The two questions
 * are orthogonal: one asks whether the answer is what was named, the other who computed
 * it.
 */
export function remoteCombineDispatch(options: RemoteCombineOptions): CombineDispatch {
  return async (task, executorId): Promise<CombineProduct | null> => {
    // The body is wrapped, which covers the RPC rejection *and* an unparseable input
    // CID string. The `CID.parse` calls are deliberately inside the try and not
    // before it: `CombineTask.inputCids` are strings that came from `resolved` inside
    // `executeReduce`, and a malformed one there would otherwise take down the whole
    // level's `Promise.all` instead of costing this one combine an attempt.
    //
    // **What the wrapping does not cover is the local write**, and the `catch` binds
    // its cause so it can say so. Everything the try covers is a fact about the peer;
    // `LocalStoreWriteFailed` is a fact about this node, and collapsing it to `null`
    // is how a full disk came to be reported as a fabric with no live executors. It
    // is re-thrown by type rather than by position so a later edit cannot quietly
    // move a local failure back inside the collapse.
    try {
      const inputCids = task.inputCids.map((cidString) => CID.parse(cidString))

      // `combineId` is `task.nodeId` — `CombineTask.nodeId` is the *tree node's*
      // derived id, not a peer id. The wire field is named `combineId` precisely
      // because carrying `nodeId` across a boundary where "node" means "peer" is how
      // that gets misread.
      const response = parseResponse(
        await options.rpc.request(
          executorId,
          encodeRequest({ kind: 'combine', combineId: task.nodeId, inputCids, level: task.level }),
        ),
      )
      if (response === null || response.kind !== 'combine') return null
      if (response.resultCid === null) return null

      // The result exists only on `executorId`'s local tier: the handler wrote it with
      // `blockstore.put`, and `FetchingBlockstore.put` delegates straight to local.
      // Nothing announces it — every production `serveAgent` passes
      // `index: 'serves-no-records'` — and no fabric in this repository lets one
      // executor's block source see another executor's store. So the next level would
      // find its inputs nowhere. Ask the one peer we know holds it, because it just
      // told us it does.
      //
      // **Directed, never fanned out.** A fan-out would reach non-holding peers, each
      // of which answers a block miss by asking its own only peer — this requestor —
      // straight back, where `FetchingBlockstore`'s in-flight map hands it the promise
      // already blocked on that same peer. That wait is circular and breaks only on a
      // timeout.
      //
      // This is not a payload on the combine wire: a `block` request is the fabric's
      // ordinary retrieval verb, the same one every executor uses to pull a module or
      // an input. The combine request stays four keys of addresses and its reply two,
      // which is what the `Object.keys` guards hold.
      //
      // **What it costs**, stated rather than elided: one small block transfer per
      // combine, and the requestor ends up holding every intermediate result. How many
      // transfers that is for a given tree is a measurement, not an arithmetic claim —
      // count them in a run rather than multiplying anything out here.
      const reply = parseResponse(
        await options.rpc.request(
          executorId,
          encodeRequest({ kind: 'block', cid: response.resultCid }),
        ),
      )
      if (reply === null || reply.kind !== 'block' || reply.bytes === null) return null
      // Verified against the CID that was claimed, for the same reason
      // `FetchingBlockstore` verifies what it fetches: content addressing is a
      // security property only if it is actually checked.
      if (!(await blockCid(reply.bytes)).equals(response.resultCid)) return null

      // `executeReduce` awaits a whole level's `Promise.all` before starting the next,
      // so writing here — before this dispatch resolves — is what makes every result
      // of level N resident at the requestor before level N+1 asks for it. **That
      // ordering is load-bearing**: an edit that made this fetch fire-and-forget would
      // reintroduce the level-2 failure silently, with the reduce failing at a node
      // whose name says nothing about the cause.
      try {
        await options.blockstore.put(reply.bytes)
      } catch (cause) {
        throw new LocalStoreWriteFailed(task.nodeId, response.resultCid.toString(), cause)
      }
      return { cid: response.resultCid, attestation: response.attestation }
    } catch (cause) {
      if (cause instanceof LocalStoreWriteFailed) throw cause
      return null
    }
  }
}
