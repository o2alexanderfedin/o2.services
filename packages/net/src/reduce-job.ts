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
  attestationRank,
  attestationReceipt,
  canonicalCid,
  deriveReduceTree,
  executeReduce,
  verifyCombineAttestation,
} from '@o2/core'
import type {
  AttestationReceipt,
  AttestedResult,
  Blockstore,
  CanonicalValue,
  CombineDispatch,
  JobResult,
  NodeCertificate,
  OwnerId,
  PublicKeyHex,
  ReduceContribution,
  ReduceOutcome,
  ReduceTree,
} from '@o2/core'
import { CID } from 'multiformats/cid'
import { remoteCombineDispatch } from './combine.ts'
import type { RpcEndpoint } from './rpc.ts'

/**
 * The issuers this requestor accepts combine certificates from, or the named statement
 * that it checks no combine signature at all.
 *
 * **Required with a named sentinel, never optional.** `.planning/PROJECT.md`'s rule is
 * that an optional hook with a silent default is a hole, and here the hole has a precise
 * shape: a requestor that omitted this would report an aggregate strength derived from
 * nothing it had checked, which is the exact artifact the combine-signing leg exists to
 * replace. The fan-out is the point rather than the cost — every caller states what it
 * checks against.
 *
 * ## Why `reduceJob` takes this and `submitJob` deliberately does not
 *
 * The two entry points look inconsistent without this paragraph, and the difference is
 * structural rather than stylistic.
 *
 * `submitJob` reaches its trust decision through a seam that already made it.
 * `NodeDescriptor` carries the certificate a node was **discovered** under, and
 * `discoverCandidates` verified that certificate against pinned issuers at the discovery
 * seam. `receiptFor` therefore pins each replica against *that descriptor's own issuer*
 * and takes no issuer argument: a second issuer set on `submitJob` would be a second
 * place one decision is made, able to disagree with the first with nothing able to catch
 * the disagreement.
 *
 * **`reduceJob` has no such seam.** Its {@link ReduceJobOptions.executors} are bare peer
 * id strings, and there is no certificate anywhere on the reduce path — not on the
 * option, not on `CombineTask`, not on `ReduceOutcome`. So this option is the only place
 * the decision can be made, and it is made once, here.
 *
 * The absence of that seam costs one thing more, and it is written down at
 * {@link ReduceJobResult} rather than hidden here: with no descriptor to compare against,
 * nothing binds the certificate a peer presents to the peer that presented it.
 */
export type CombineTrustAnchors = ReadonlySet<PublicKeyHex> | 'checks-no-combine-signatures'

/**
 * What each partial is attributed to — the `contributorId` its leaf is keyed on.
 *
 * **This is the line `contributorFor`'s docstring said would change**, and MR-02 is what
 * changed it. `deriveReduceTree` keys a leaf on `(contributorId, cid)`, so this choice
 * decides what "two contributions" means for a job, and getting it wrong is silent in
 * both directions: too coarse and two batches of rows that summarised alike become one
 * leaf and undercount; too fine and one owner's single partial is counted twice.
 *
 * **Required with a named sentinel, never optional**, for the reason
 * {@link CombineTrustAnchors} gives one option up: a caller that omitted it would get
 * whichever meaning this module happened to prefer, and the meaning is the caller's fact
 * rather than this module's.
 *
 * - `'attributes-each-shard-to-its-own-partition-index'` — a job whose shards all belong
 *   to the requestor. Each shard is its own contributor (`shard-0`, `shard-1`, …), which
 *   is right for a public job and **is not an owner id**: a public job's shards say
 *   nothing about whose data they are, so nothing here could be read as a sovereignty
 *   claim. This is exactly what this module did before the option existed, spelled out.
 * - A `Map` from partition index to {@link OwnerId} — a job whose partials were each
 *   computed by their owner's own node over data pinned there. `reduceSovereignJob`
 *   (`reduce-sovereign.ts`) is the only thing that builds one, and it builds it from
 *   certificates it verified rather than from anything the requestor chose. **Every
 *   agreed shard must appear in it**; a gap is a named refusal rather than a fallback,
 *   because a partial with no attribution has no honest leaf key.
 */
export type ContributorAttribution =
  | 'attributes-each-shard-to-its-own-partition-index'
  | ReadonlyMap<number, OwnerId>

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
  /** See {@link CombineTrustAnchors}. Required, and required here rather than on `submitJob`. */
  readonly trustedIssuers: CombineTrustAnchors
  /** See {@link ContributorAttribution}. Required, with a named sentinel for the public case. */
  readonly contributors: ContributorAttribution
}

/**
 * The named statement that this requestor holds no verified signed statement about who
 * performed this **aggregation** — VER-08, VER-09, VER-10.
 *
 * `submitJob`'s `NoVerifiedAttestation` is the same convention one claim over, and the
 * two are deliberately different types with different `kind` strings: a reader handed
 * both must not be able to satisfy an aggregation question with a map answer. The counts
 * differ for the same reason — the map half counts *replicas*, this half counts
 * **combines**, because a tree's weakest step is a step and not a replica.
 *
 * **A statement, never a default.** It says something specific and true: *this requestor
 * cannot account, from signatures it checked, for who performed this aggregation.* A
 * strength computed over the combines that happened to verify would over- or understate
 * depending on which ones did, so a partial verification lands here too, with the counts.
 */
export interface NoVerifiedAggregation {
  readonly kind: 'holds-no-verified-aggregate-attestation'
  /** Why, in this module's own words, naming each combine that was not counted. */
  readonly reason: string
  /** Combines in the derived tree — the steps a receipt would have to account for. */
  readonly combines: number
  /** Of those, how many produced statements this requestor checked all the way through. */
  readonly verified: number
}

/**
 * How strongly this reduction's **aggregation** is attested, or the named absence.
 *
 * **This is not the map half's receipt and must never be read as one.** `PROJECT.md`
 * splits the verification claim, and the split is not a formality: a sovereign map is
 * `owner-attested` by construction — pinning data to one owner removes the second
 * independent executor — while the aggregation *over* those contributions can be
 * redundant, because a combine reads only content-addressed partials and is runnable
 * anywhere. `reduce.ts`'s `ReduceRun.redundancy` states the same thing in the source's
 * own words. So the two receipts routinely differ, and a reduced job reporting only one
 * of them would be making the stronger-sounding claim about the weaker half.
 *
 * **What a signature here does not buy.** It says a certified node performed this
 * aggregation over these partials. It says nothing about whether the aggregation is
 * arithmetically right — that remains `executeReduce`'s `redundancy` and its
 * `disagreements` arm, exactly as a signed `exec` result is not a correct one. Somebody
 * will propose lowering reduce redundancy because combines are signed now; this line is
 * there for them.
 */
export type AggregateAttestation = AttestationReceipt | NoVerifiedAggregation

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
      /**
       * How strongly the **aggregation** is attested — see {@link AggregateAttestation}.
       *
       * **What it establishes, and what the reduce path cannot.** A pass says: nodes
       * these pinned issuers certified performed each merge in this tree, over exactly
       * the partials named, in exactly the order merged. What it does **not** say is
       * that the peer which answered is the node whose certificate it presented. An
       * attestation is transferable by design — `result-attestation.ts` records the
       * replay property as intended, because that is what makes the statement showable
       * to a third party — and this module holds no way to derive a peer id from a node
       * key: that derivation lives in `@o2/libp2p`, which `@o2/net` may not import, and
       * `discover-candidates.ts` takes it as an injected function for exactly that
       * reason. `submitJob` closes the same gap with the descriptor a node was
       * discovered under; there is no descriptor here.
       *
       * What stands in its place is the duplicate-node-key check below: a peer
       * forwarding another's signed statement cannot inflate the replica count, because
       * two entries under one node key make the whole reduction read the named absence.
       */
      readonly aggregateAttestation: AggregateAttestation
    }
  | { readonly ok: false; readonly reason: string }

/**
 * The contributor a shard's partial is attributed to, under the caller's stated
 * {@link ContributorAttribution}, or `null` when the caller's map does not name one.
 *
 * **The sentinel arm is not an owner id, and must not be read as one.** `ShardResult`
 * carries no owner — `ShardSpec.ownerId` exists but `JobResult` does not preserve it —
 * so on that arm there is nothing here to attribute a partial to an owner with, and the
 * sovereignty claim `ReduceContribution`'s own docstring makes is **not** established by
 * it.
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
 * **The map arm is the collection path that docstring said would change this line.**
 * `reduceSovereignJob` derives it from the certified user key of the node that actually
 * ran each map — a signature this requestor checked — rather than from anything the
 * requestor chose. `null` there means the caller's map has a hole, which this module
 * reports as a refusal rather than papering over with the sentinel's answer: a partial
 * silently relabelled `shard-3` in a sovereign reduce would drop out of the coverage
 * report while still counting in the aggregate.
 */
function contributorFor(
  partitionIndex: number,
  attribution: ContributorAttribution,
): string | null {
  if (attribution === 'attributes-each-shard-to-its-own-partition-index') {
    return `shard-${partitionIndex}`
  }
  return attribution.get(partitionIndex) ?? null
}

/**
 * What one combine's replicas answered, kept so the requestor can check what they signed.
 *
 * **Why this is recorded here and not read off {@link ReduceOutcome}.** A combine
 * attestation covers `(inputCids in merge order, resultCid, nodeKey)`, and `ReduceOutcome`
 * carries neither of the first two per combine: `executedBy` is peer ids, `attestations`
 * is the accepted replica's statement alone, and the map from a tree node to the CID its
 * value resolved to never leaves `executeReduce`. Only a **level-1** combine's inputs and
 * only the **root's** result are recoverable from the tree, so a deeper tree would have
 * nothing checkable in it at all. Widening `ReduceOutcome` was the alternative and is
 * `@o2/core`'s to make, not this module's; wrapping the dispatch this module already
 * constructs costs one `Map` and no port change.
 *
 * The replicas are held **in dispatch order**, which is the order `executeReduce` walks
 * the rendezvous ranking in, so the first entry is the `produced[0]` it accepts.
 */
interface CombineObservation {
  /** As merged. **Never sorted** — see `combineChallenge`. */
  readonly inputCids: readonly CID[]
  readonly replicas: { readonly resultCid: CID; readonly attestation: AttestedResult }[]
}

/**
 * The aggregate receipt, over combine statements this requestor checked itself.
 *
 * Four questions per replica, each named when the answer is no, in the shape
 * `submitJob`'s `receiptFor` already uses for the map half — the two should read alike
 * because they are one idea applied to two claims.
 *
 * **The aggregate is the weakest combine's, by `attestationRank`.** A tree is no better
 * attested than its least-attested step, and averaging would let one unverifiable combine
 * disappear under a strong root — which is precisely the shape a tree makes easy to hide.
 */
function aggregateAttestationOf(
  tree: ReduceTree,
  outcome: ReduceOutcome,
  observed: ReadonlyMap<string, CombineObservation>,
  trustedIssuers: CombineTrustAnchors,
  now: number,
): AggregateAttestation {
  const combines = tree.nodes.length

  // A lone contribution is *promoted* rather than wrapped in a combine (`deriveReduceTree`
  // says so at the promotion), so no node performed an aggregation at all. `owner-attested`
  // here would be a claim about a step that never ran — the same conflation the named
  // absence exists to prevent one level up.
  if (combines === 0) {
    return {
      kind: 'holds-no-verified-aggregate-attestation',
      reason:
        'this reduction merged nothing — a single contribution is promoted rather than combined, ' +
        'so there is no aggregation to attest',
      combines: 0,
      verified: 0,
    }
  }

  if (trustedIssuers === 'checks-no-combine-signatures') {
    return {
      kind: 'holds-no-verified-aggregate-attestation',
      reason:
        'this requestor checks no combine signatures, so it holds no statement about who ' +
        'performed this aggregation',
      combines,
      verified: 0,
    }
  }

  const receipts: AttestationReceipt[] = []
  const unaccounted: string[] = []

  for (const node of tree.nodes) {
    // A combine absent from `outcome.attestations` either produced nothing at all or had
    // its replicas disagree. `executeReduce` records no statement for either — putting
    // signatures on a disagreement invites somebody to pick a winner out of them — and
    // this receipt does not invent one where that module declined to.
    if (!outcome.attestations.has(node.id)) {
      unaccounted.push(`${node.id}: no agreed statement was recorded for this combine`)
      continue
    }
    const seen = observed.get(node.id)
    if (seen === undefined || seen.replicas.length === 0) {
      unaccounted.push(`${node.id}: this requestor recorded no replica answer for this combine`)
      continue
    }

    const verified: NodeCertificate[] = []
    for (const replica of seen.replicas) {
      if (replica.attestation === 'signed-by-nobody') {
        unaccounted.push(`${node.id}: a replica stated that it signs nothing`)
        continue
      }
      const checked = verifyCombineAttestation(
        replica.attestation,
        // The caller's own view of the merge, never anything the attestation supplies —
        // `inputCids` as dispatched and `resultCid` as this requestor retrieved and
        // hash-checked it. An attestation that could name its own work would verify
        // against itself every time.
        seen.inputCids,
        replica.resultCid,
        trustedIssuers,
        now,
      )
      if (!checked.ok) {
        unaccounted.push(`${node.id}: ${checked.reason}`)
        continue
      }
      verified.push(checked.certificate)
    }

    // `attestationReceipt` reports `replicas` from the set it is handed and does not
    // dedupe, so two entries carrying one node's certificate would report redundancy this
    // aggregation does not have. **Reachable rather than defensive, and that is the
    // difference from the map half**: an attestation is transferable by design, and with
    // no descriptor to compare a peer against, one peer can forward another's signed
    // statement verbatim. So it is answered as a named absence rather than thrown —
    // `submitJob` throws on the same condition because there it is an assembly defect
    // this repository's own code would have to have caused, whereas here it is a verdict
    // about what peers sent.
    const keys = new Set(verified.map((certificate) => certificate.nodeKey))
    if (keys.size !== verified.length) {
      unaccounted.push(
        `${node.id}: ${String(verified.length)} replicas verified under one node key ` +
          `(${[...keys].join(', ')}), and a receipt built from that set would report redundancy ` +
          'this aggregation does not have',
      )
      continue
    }
    if (verified.length === 0) continue
    receipts.push(attestationReceipt(verified))
  }

  if (unaccounted.length > 0 || receipts.length !== combines) {
    return {
      kind: 'holds-no-verified-aggregate-attestation',
      reason:
        receipts.length === 0
          ? `no combine in this tree produced a statement this requestor could check — ${unaccounted.join('; ')}`
          : `only ${String(receipts.length)} of ${String(combines)} combines produced statements this ` +
            'requestor could check, and a strength over that subset would state something this ' +
            `requestor cannot account for — ${unaccounted.join('; ')}`,
      combines,
      verified: receipts.length,
    }
  }

  return receipts.reduce((weakest, receipt) =>
    attestationRank(receipt.strength) < attestationRank(weakest.strength) ? receipt : weakest,
  )
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

    // Read before the store write, so a job with a hole in its attribution refuses
    // without having put a partial nobody can attribute into the requestor's store.
    const contributorId = contributorFor(shard.partitionIndex, options.contributors)
    if (contributorId === null) {
      return {
        ok: false,
        reason: `shard ${shard.partitionIndex} agreed but the caller's attribution names no contributor for it`,
      }
    }

    await options.blockstore.put(hashed.bytes)
    leaves.push(hashed.cid)
    contributions.push({ contributorId, cid: hashed.cid })
  }

  // This exists to keep `deriveReduceTree`'s `RangeError` from escaping as an exception
  // where every other failure in this module is a value.
  if (contributions.length === 0) return { ok: false, reason: 'no agreed shard produced a partial' }

  const tree = deriveReduceTree(contributions, options.fanout ?? DEFAULT_FANOUT)

  // The same store the leaves were written to is the one each combine's result is
  // fetched back into. One store, serving the whole tree — this is the call site a
  // reader arrives at first, so it is stated here as well as in `combine.ts`.
  const combining = remoteCombineDispatch({ rpc: options.rpc, blockstore: options.blockstore })

  // VER-08/09/10 — what each replica answered, kept so its statement can be checked
  // against the merge this requestor actually asked for. See {@link CombineObservation}
  // for why the reading is taken here and not off `ReduceOutcome`.
  const observed = new Map<string, CombineObservation>()
  const dispatch: CombineDispatch = async (task, executorId) => {
    const product = await combining(task, executorId)
    if (product === null) return null
    let entry = observed.get(task.nodeId)
    if (entry === undefined) {
      // `CID.parse` is safe here and would not be above: a non-null product means the
      // dispatch already parsed these same strings inside its own `try`, so a malformed
      // one has been turned into a `null` and never reaches this line.
      entry = { inputCids: task.inputCids.map((cidString) => CID.parse(cidString)), replicas: [] }
      observed.set(task.nodeId, entry)
    }
    entry.replicas.push({ resultCid: product.cid, attestation: product.attestation })
    return product
  }

  const outcome = await executeReduce({
    tree,
    executors: options.executors,
    dispatch,
    ...(options.redundancy === undefined ? {} : { redundancy: options.redundancy }),
  })

  // One clock read for the whole reduction, so every certificate in one receipt is judged
  // against one instant rather than against a window that drifts down the tree. The
  // second clock read in production `@o2/net` — `agent.ts`'s enrolment branch is the
  // other, and states the same reasoning: `@o2/core` takes its clock as a parameter
  // precisely so an adapter supplies it, and `Date.now()` behaves identically in both
  // targets this package has to run in.
  const aggregateAttestation = aggregateAttestationOf(
    tree,
    outcome,
    observed,
    options.trustedIssuers,
    Date.now(),
  )

  return { ok: true, outcome, tree, leaves, skipped, aggregateAttestation }
}
