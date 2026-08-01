/**
 * `reduceJob` — a `JobResult` becomes a reduce over connected peers. MR-04…MR-07.
 *
 * **Why this lives in `@o2/net` and not `@o2/core`.** `purity.node.test.ts` asserts
 * `packages/core/package.json` declares zero `@o2/*` dependencies, and the executors a
 * combine is ranked over are peer ids on an `RpcEndpoint` — a `@o2/net` type. That is
 * the identical constraint that produced `submitJobWithEgress`, and it gets the
 * identical resolution: a thin helper over an unmodified `@o2/core` function, at the
 * layer where both sides are already in scope.
 *
 * **Why it is kept separate from `submitJobWithEgress` rather than folded into one
 * call.** Each helper stays one thing; a caller that wants both runs them in sequence.
 *
 * **The projection is unverified**, and that gap is real rather than incidental:
 * `executeReduce` verifies the aggregation *over* partials and cannot see whether the
 * requestor projected each shard output faithfully into those partials in the first
 * place. `fabricCombiner`'s own docstring carries the full treatment; it is named here
 * because this is the function that applies one.
 *
 * Pure module.
 */

import {
  DEFAULT_FANOUT,
  MAX_PARTIAL_BYTES,
  asFabricPartial,
  canonicalCid,
  deriveReduceTree,
  executeReduce,
} from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  JobResult,
  ReduceContribution,
  ReduceOutcome,
  ReduceTree,
} from '@o2/core'
import type { CID } from 'multiformats/cid'
import { remoteCombineDispatch } from './combine.ts'
import type { RpcEndpoint } from './rpc.ts'

export interface ReduceJobOptions {
  readonly rpc: RpcEndpoint
  /** Peer ids of the connected agents. The submitter is NOT among them. */
  readonly executors: readonly string[]
  /**
   * The requestor's LOCAL store, and it does three jobs rather than one:
   *
   * - the projected leaves are written here;
   * - a combine node fetches them from here, through the requestor's own `serveAgent`;
   * - and each combine's **result** is fetched back into here from the executor that
   *   produced it, which is the only reason a level-2 combine can reach its inputs.
   *
   * One store serving the whole tree is the fact that makes a tree deeper than one
   * level work at all. Pass the local tier.
   */
  readonly blockstore: Blockstore
  /**
   * Per-job projection from an agreed shard output to a partial the fabric combiner
   * accepts.
   *
   * Given the **decoded output**. A projection that ignores it and keys on
   * `partitionIndex` alone makes every leaf a function of an integer the caller already
   * holds, which is not a measurement of anything the executors did.
   */
  readonly project: (output: CanonicalValue, partitionIndex: number) => CanonicalValue
  readonly fanout?: number
  readonly redundancy?: number
}

/**
 * What a reduce attempt produced.
 *
 * **`ok` says a reduce could be attempted; `outcome.ok` says whether it succeeded.**
 * Conflating the two is the obvious misreading and it is the dangerous one. A reduce
 * that ran and had every combine fail is `{ok: true}` with `outcome.ok === false` and
 * `outcome.failed` naming the nodes; a reduce that never started is `{ok: false}` with
 * a reason. **A caller asking "did the job produce an aggregate" must read
 * `outcome.ok`.**
 */
export type ReduceJobResult =
  | {
      readonly ok: true
      readonly outcome: ReduceOutcome
      readonly tree: ReduceTree
      /** The projected partials' addresses, in shard order, all resident in `blockstore`. */
      readonly leaves: readonly CID[]
      /** Partition indices whose verification was not `'agreed'`. */
      readonly skipped: readonly number[]
    }
  | { readonly ok: false; readonly reason: string }

/**
 * The contributor a shard's partial is attributed to.
 *
 * **This is not an owner id, and must not be read as one.** `ShardResult` carries no
 * owner — `ShardSpec.ownerId` exists but `JobResult` does not preserve it — so there is
 * nothing here to attribute a partial to an owner with, and the sovereignty claim
 * `ReduceContribution`'s own docstring makes is **not** established by this line.
 *
 * The partition index is nonetheless the right discriminator for a job's own shards,
 * and keying on anything coarser is a bug rather than a simplification. A public job's
 * shards all belong to the requestor, so a single constant contributor would make two
 * shards that happened to produce byte-identical partials dedupe into one leaf
 * (`deriveReduceTree` dedupes on `contributorId` + cid) and undercount the aggregate —
 * which is precisely the silent undercount `ReduceContribution` was introduced to
 * prevent, arriving from the other direction. Two shards are two batches of rows even
 * when their summaries coincide.
 *
 * When a collection path exists that carries a real per-contribution owner — the
 * Noise-authenticated peer a partial arrived from — **this is the line that changes.**
 */
function contributorFor(partitionIndex: number): string {
  return `shard-${partitionIndex}`
}

/** Turn a completed job into a reduce over `options.executors`. */
export async function reduceJob(job: JobResult, options: ReduceJobOptions): Promise<ReduceJobResult> {
  // Named here rather than left to `executeReduce`, which handles it by returning
  // `ok: false` with `failed: [tree.rootId]` — true, and it tells the caller nothing
  // whatsoever about the cause.
  if (options.executors.length === 0) return { ok: false, reason: 'no executor to combine on' }

  const contributions: ReduceContribution[] = []
  const leaves: CID[] = []
  const skipped: number[] = []

  for (const shard of job.shards) {
    // Reported, never inferred. A driver that quietly dropped these would present a
    // partial aggregate as a complete one — the failure mode `CoveredAggregate` exists
    // to prevent elsewhere in this repository.
    if (shard.verification.status !== 'agreed') {
      skipped.push(shard.partitionIndex)
      continue
    }

    let partial: CanonicalValue
    try {
      partial = options.project(shard.verification.output, shard.partitionIndex)
    } catch (cause) {
      return {
        ok: false,
        reason: `the projection for shard ${shard.partitionIndex} threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }

    // `asFabricPartial`'s **requestor-side** disposition: refuse loudly here, where the
    // value was authored locally and a diagnosis is possible. Its wire-side disposition
    // — inside `fabricCombiner`, where a null contributes zero so one malformed partial
    // cannot abort a combine every other contributor answered honestly — is the other
    // half of the same pair. The two are deliberately different; do not later "unify"
    // them.
    if (asFabricPartial(partial) === null) {
      return {
        ok: false,
        reason: `the projection for shard ${shard.partitionIndex} did not produce a {counts, rows} partial`,
      }
    }

    const hashed = await canonicalCid(partial)
    if (!hashed.ok) {
      return {
        ok: false,
        reason: `the projection for shard ${shard.partitionIndex} is not encodable: ${JSON.stringify(hashed.error)}`,
      }
    }
    // Refused here so the requestor learns *which* shard is oversized. Letting it
    // through would mean every combine node refuses it independently and the requestor
    // sees only a reduce that failed everywhere, with nothing naming the cause.
    if (hashed.bytes.byteLength > MAX_PARTIAL_BYTES) {
      return {
        ok: false,
        reason: `the projection for shard ${shard.partitionIndex} is ${hashed.bytes.byteLength} bytes, over the ${MAX_PARTIAL_BYTES} byte partial budget`,
      }
    }

    await options.blockstore.put(hashed.bytes)
    leaves.push(hashed.cid)
    contributions.push({ contributorId: contributorFor(shard.partitionIndex), cid: hashed.cid })
  }

  // This exists to keep `deriveReduceTree`'s `RangeError` from escaping as an exception
  // where every other failure in this module is a value.
  if (contributions.length === 0) return { ok: false, reason: 'no agreed shard produced a partial' }

  const tree = deriveReduceTree(contributions, options.fanout ?? DEFAULT_FANOUT)

  // The same store the leaves were written to is the one each combine's result is
  // fetched back into. One store, serving the whole tree — this is the call site a
  // reader arrives at first, so it is stated here as well as in `combine.ts`.
  const outcome = await executeReduce({
    tree,
    executors: options.executors,
    dispatch: remoteCombineDispatch({ rpc: options.rpc, blockstore: options.blockstore }),
    ...(options.redundancy === undefined ? {} : { redundancy: options.redundancy }),
  })

  return { ok: true, outcome, tree, leaves, skipped }
}
