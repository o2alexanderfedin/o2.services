import {
  EnrollmentAuthority,
  LOCAL_COMBINE_EXECUTOR,
  LocalCapacity,
  MAX_PARTIAL_BYTES,
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  canonicalCid,
  decodeCanonical,
  deriveReduceTree,
  fabricCombiner,
  publicNodes,
  rendezvousRank,
  requestEnrollment,
  signCombine,
  submitJob,
} from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  JobResult,
  PublicKeyHex,
  ResultSigner,
  ShardResult,
} from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import, exactly as `distributed.test.ts` does it: `@o2/core`'s
// export map exposes only its public entry, and adding a fixtures export would modify
// the kernel package.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { RpcBlockSource, serveAgent } from './agent.ts'
import type { AuthorizedWork, Authorizer } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
import { encodeResponse, parseRequest } from './protocol.ts'
import { RemoteExecutor } from './remote-executor.ts'
import { reduceJob } from './reduce-job.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * MR-04 / MR-05 / MR-07 — a `JobResult` becomes a reduce over connected peers.
 *
 * **This file is deliberately split in two, and the split is the point.**
 *
 * The *shape* cases build `JobResult` literals: they are exhaustive over a small set of
 * named failures, and a fabric would add nothing to any of them — a projection that
 * throws throws the same way whatever the transport is.
 *
 * The *end-to-end* case builds a real eight-node `MemoryNetwork` fabric and runs a real
 * `submitJob` first, because the property under test **is** the wire and a literal
 * cannot prove it. Every worker's block source is `RpcBlockSource(rpc, () => ['origin'])`
 * over an origin serving a plain `MemoryBlockstore`, so **no executor can see another
 * executor's store** — which is what makes level 2 the interesting level, and is the
 * topology of every fabric in this repository.
 */

/** A fixed CID for literal `JobResult`s, where the content is irrelevant. */
const FIXED_CID = CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')

/** The ten sentinels every `AgentOptions` must write down. */
const SENTINELS = {
  egress: 'holds-no-registrations',
  authorize: 'serves-unauthenticated',
  index: 'serves-no-records',
  capacity: 'accepts-every-offer',
  ledger: 'keeps-no-ledger',
  reservations: 'relays-for-nobody',
  onDispatch: 'reports-no-dispatch',
  attest: 'signs-nothing',
  enroll: 'issues-no-certificates',
  paused: 'never-pauses',
} as const

/**
 * Read the 4-byte little-endian partition index the fixture emits.
 *
 * **Adapted from `distributed.test.ts`, not lifted, and the one difference is
 * load-bearing.** That copy returns `-1` on a shape it does not recognise, which is
 * right where it lives because it feeds an equality check that simply fails. Here a
 * `-1` would produce a `partition--1` key and a perfectly well-formed leaf, so a guest
 * that emitted the wrong shape would silently contribute a bogus partial to the
 * aggregate instead of being reported. Throwing routes it into `reduceJob`'s per-shard
 * try/catch, which turns it into a named failure — which is exactly what the
 * *"a projection that throws"* case below asserts. Do not "restore" the `-1`; it would
 * silently delete a named failure path.
 */
function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) throw new Error('not a partition output')
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The job's projection: an agreed shard output becomes a `{counts, rows}` partial.
 *
 * **Derived from the shard's output, never from its index**, and that difference is the
 * whole reason the eight-node comparison means anything. A projection written
 * `(_output, partitionIndex) => …` makes every leaf a pure function of an integer the
 * test process also holds, so the reference and the measured root would be the same
 * arithmetic computed twice and **nothing any executor produced would enter either
 * side** — a guest returning any agreed output whatsoever would yield the identical
 * root CID. Decoding the output makes the aggregate depend on what the guests actually
 * wrote, which is what the corrupted-output case measures.
 *
 * Distinctness still matters for a second reason: `deriveReduceTree` dedupes, so a
 * projection collapsing two shards to one contribution would shrink the tree and fail
 * the shape assertions for a reason unrelated to the wire. The fixture emits a distinct
 * index per shard, so distinctness is inherited from the guest rather than imposed here.
 */
function project(output: CanonicalValue): CanonicalValue {
  return { counts: { [`partition-${partitionOf(output)}`]: 1 }, rows: 1 }
}

/** A `JobResult` literal whose shards carry the verifications given. */
function jobWith(shards: readonly ShardResult[]): JobResult {
  return {
    moduleCid: FIXED_CID,
    shards,
    complete: shards.every((s) => s.verification.status === 'agreed'),
    // The map half's receipt, which these fixtures state rather than omit. It is the
    // named absence for the same reason every `agreeing` entry below is the unsigned
    // sentinel: nothing enrolled the nodes this fixture stands for. The aggregation's
    // own claim is a different one and is `reduceJob`'s, never a restatement of this.
    attestation: {
      kind: 'holds-no-verified-attestation',
      reason: 'this fixture stands for a job whose executors hold no identity',
      agreeing: shards.length,
      verified: 0,
    },
    grossFuel: 0,
    usefulFuel: 0,
    verificationMultiplier: 1,
    // A fixture job that never had to retry anything, stated rather than omitted: these
    // literals stand for the *output* of a submission, and `submitJob` reports both of
    // these on every job since Phase 20 gave a shard a second generation. `reduceJob`
    // reads neither — it consumes `shards` and `attestation` — so the honest value here
    // is the one a job with no churn produces, which is zero re-dispatches over a
    // history whose only events would be the grants and completions of a clean run.
    redispatches: 0,
    leaseHistory: [],
    // A fixture job that duplicated no straggler, on the same terms. `1` is the identity
    // `SpeculationLedger.multiplier` reports when nothing was spent — the reading a job
    // with no tail gives, which is what these literals stand for. `reduceJob` reads
    // neither; they are stated because `JobResult` requires them and a placeholder here
    // would be a number nobody measured.
    speculationMultiplier: 1,
    speculationSpent: 0,
    // A fixture job that defines no owners, and this is the measured reading rather than
    // a convenient one: `ShardResult` carries no owner — `reduceJob`'s own header says
    // *"`ShardSpec.ownerId` exists but `JobResult` does not preserve it"* — so a job
    // assembled from these literals has no sovereign shard to derive an owner from. The
    // named arm is what `submitJob` reports for exactly that job. A `CoverageReport` of
    // `0/0` here would render `PARTIAL (no owners were expected)` and would be this
    // fixture apologising for a question it was never asked.
    coverage: 'defines-no-owners',
  }
}

/**
 * One agreed shard whose decoded output is `output`.
 *
 * `rejections: []` because this fixture stands for a shard of a job that made no
 * offers — the truthful reading of an empty list, and the same one `submitJob`
 * produces on its no-`admit` arm. It is not a placeholder.
 */
function agreed(partitionIndex: number, output: CanonicalValue): ShardResult {
  return {
    partitionIndex,
    inputCid: FIXED_CID,
    degraded: false,
    rejections: [],
    // One generation, one node, no re-dispatch — the shape of a shard that agreed the
    // first time it was asked. `'w0'` is the same node `verification.agreeing` names
    // below, because the set attempted and the set that answered coincide exactly when
    // nothing failed, and inventing a second name here would describe a retry this
    // fixture did not have.
    attempted: ['w0'],
    generations: 1,
    ending: 'agreed',
    // Nothing was slow enough to duplicate, so there is no second copy and nothing was
    // left over to compare. `[]` is the truthful reading of "no copy was started", the
    // same reading `rejections: []` gives above.
    speculated: false,
    disagreed: false,
    copies: [],
    attestation: {
      kind: 'holds-no-verified-attestation',
      reason: 'the executor this fixture stands for signs nothing',
      agreeing: 1,
      verified: 0,
    },
    // These fixtures stand for shards of a job whose caller supplied no certificates,
    // which is the condition under which no quorum is attempted at all.
    quorum: {
      kind: 'not-attempted',
      reason: 'this fixture holds no certificate for any candidate',
    },
    verification: {
      status: 'agreed',
      resultCid: FIXED_CID,
      output,
      // The sentinel, because nothing enrolled the node this fixture stands for. It is
      // that node's truthful statement rather than a placeholder — the same reading
      // every executor in the tree gives until the signing wrapper is composed.
      agreeing: [{ nodeId: 'w0', attestation: 'signed-by-nobody' }],
      replicas: 1,
      // This fixture stands for a shard whose single executor answered, so nothing
      // refused. `[]` is the fixture's own statement and not a filler.
      failures: [],
      grossFuel: 0,
      usefulFuel: 0,
    },
  }
}

/** One shard that never reached agreement. */
function insufficient(partitionIndex: number): ShardResult {
  return {
    partitionIndex,
    inputCid: FIXED_CID,
    degraded: true,
    // Empty for the same reason as `agreed` above: no offer was made here.
    rejections: [],
    // A shard nobody would take, so nothing was ever attempted and no generation ran.
    // `'never-placed'` rather than `'no-untried-node'`: this fixture stands for the
    // unplaceable arm, which is reached before the generation loop is entered at all.
    attempted: [],
    generations: 0,
    ending: 'never-placed',
    // A shard nobody would take never ran, so nothing about it was ever slow.
    speculated: false,
    disagreed: false,
    copies: [],
    attestation: {
      kind: 'holds-no-verified-attestation',
      reason: 'this shard is insufficient rather than agreed, so there is no agreement to attest',
      agreeing: 0,
      verified: 0,
    },
    quorum: {
      kind: 'not-attempted',
      reason: 'this fixture holds no certificate for any candidate',
    },
    verification: { status: 'insufficient', reason: 'nobody answered', failures: [] },
  }
}

/** An output the fixture would have produced for `partitionIndex`. */
function partitionOutput(partitionIndex: number): CanonicalValue {
  const p = new Uint8Array(4)
  new DataView(p.buffer).setUint32(0, partitionIndex, true)
  return { p }
}

/** An eight-node fabric whose workers can reach the origin and nobody else. */
async function nodeFabric(count: number) {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()
  const moduleCid = await originStore.put(MODULE_WRITES_PARTITION)

  const originRpc = new RpcEndpoint(network.connect('origin'), { timeoutMs: 5_000 })
  serveAgent({
    ...SENTINELS,
    rpc: originRpc,
    executor: new WasmExecutor({ nodeId: 'origin', blockstore: originStore }),
    blockstore: originStore,
  })

  const workers: { readonly id: string; readonly rpc: RpcEndpoint; readonly store: FetchingBlockstore }[] = []
  for (let i = 0; i < count; i++) {
    const id = `w${i}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['origin']),
    )
    serveAgent({ ...SENTINELS, rpc, executor: new WasmExecutor({ nodeId: id, blockstore: store }), blockstore: store })
    workers.push({ id, rpc, store })
  }

  const close = () => {
    originRpc.close()
    for (const w of workers) w.rpc.close()
  }

  return { network, originStore, originRpc, moduleCid, workers, close }
}

describe('MR-04 / MR-05 / MR-07 — eight shards reduce over eight peers that cannot see each other', () => {
  it('produces a root CID bit-identical to a single-process reference', async () => {
    const fabric = await nodeFabric(8)
    try {
      const executors = fabric.workers.map(
        (w) => new RemoteExecutor(w.id, fabric.originRpc, 'dispatches-unauthenticated'),
      )
      const submitted = await submitJob(
        {
          moduleCid: fabric.moduleCid,
          shards: Array.from({ length: 8 }, (_, i) => ({ value: { a: i }, label: 'public' as const })),
          executors,
          nodes: publicNodes(executors),
          redundancy: 2,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        fabric.originStore,
        // CHURN-03 — this test asserts nothing about checkpointing.
        { checkpoints: 'checkpoints-nothing' },
      )
      expect(submitted.ok).toBe(true)
      if (!submitted.ok) return
      expect(submitted.job.complete).toBe(true)

      const executorIds = fabric.workers.map((w) => w.id)
      const result = await reduceJob(submitted.job, {
        // MR-05/MR-06 — this case measures the *fabric's* combine placement, so it states the
        // clause of the 2026-08-18 placement ruling that keeps combines on peers. A
        // local-preferring requestor would answer every combine in-process and there would be
        // no rendezvous assignment and no churn repair left to observe.
        placement: 'requires-remote-combining',
        rpc: fabric.originRpc,
        executors: executorIds,
        blockstore: fabric.originStore,
        project,
        redundancy: 2,
        // Every agent in this fabric passes `attest: 'signs-nothing'`, so there is no
        // combine signature here to check against anything. The sentinel is the honest
        // statement of that — an issuer set would say this requestor checked signatures
        // and found none, which is a different (and false) claim about the run.
        trustedIssuers: 'checks-no-combine-signatures',
        // MR-02 — public shards, so a partial is attributed to its own partition index.
        contributors: 'attributes-each-shard-to-its-own-partition-index',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const { outcome, tree, leaves, skipped } = result

      // The `ok: true` arm's whole surface, asserted as a key set rather than as a
      // whole-object `toEqual` — `outcome` carries two `Map`s and `tree` carries every
      // leaf, so an object literal here would be unreadable and would be rewritten
      // rather than read. The property worth keeping is the one a `toMatchObject`
      // throws away: a field added to this arm and reported nowhere fails here.
      expect(Object.keys(result).sort()).toEqual([
        'aggregateAttestation',
        'leaves',
        'ok',
        'outcome',
        'skipped',
        'tree',
      ])

      expect(skipped).toEqual([])
      // The leaf count is the shard count — this test's own input, not a derived figure.
      expect(tree.leaves).toHaveLength(8)

      // **The shape is measured here, never asserted from a figure written in a plan.**
      // These two numbers are read off `deriveReduceTree` for these eight leaves and
      // recorded in 16-02-SUMMARY.md as the phase's single source; 16-03 transcribes
      // them from there.
      expect(tree.nodes).toHaveLength(3)
      expect(tree.depth).toBe(2)
      // What separates a tree from a one-level merge without needing a figure at all.
      expect(tree.depth).toBeGreaterThan(1)

      // Identities a linear scan (zero combines, empty executedBy) cannot satisfy.
      expect(outcome.combines).toBe(tree.nodes.length)
      expect(outcome.executedBy.size).toBe(tree.nodes.length)
      expect(outcome.failed).toEqual([])
      expect(outcome.disagreements).toEqual([])

      // Two independent executors produced each combine and their answers deduped,
      // because they carry the same CID.
      expect(outcome.minReplicas).toBe(2)

      // **Two replicas per combine and no aggregate strength**, which is the pair worth
      // asserting together: redundancy is not attestation. These agents sign nothing, so
      // this requestor holds no statement about who performed the aggregation, and the
      // receipt says so instead of reading the redundancy off `minReplicas`.
      expect(result.aggregateAttestation).toEqual({
        kind: 'holds-no-verified-aggregate-attestation',
        reason:
          'this requestor checks no combine signatures, so it holds no statement about who ' +
          'performed this aggregation',
        combines: tree.nodes.length,
        verified: 0,
      })

      // Every leaf is resident in the store the combine nodes fetch from.
      for (const leaf of leaves) expect(await fabric.originStore.has(leaf)).toBe(true)

      // Bit-for-bit against a single-process reference over the same eight outputs.
      const outputs = submitted.job.shards.map((s) =>
        s.verification.status === 'agreed' ? s.verification.output : null,
      )
      const reference = await canonicalCid(fabricCombiner(outputs.map((o) => project(o as CanonicalValue))))
      if (!reference.ok) throw new Error('reference will not canonicalise')
      expect(outcome.rootCid).toBe(reference.cid.toString())

      // **The aggregate depends on what the guests produced.** Corrupt one output and
      // the reference moves — without this, a projection keyed only on the partition
      // index would make the whole comparison one arithmetic identity compared with
      // itself.
      const corrupted = [...outputs]
      corrupted[3] = partitionOutput(999)
      const corruptedReference = await canonicalCid(
        fabricCombiner(corrupted.map((o) => project(o as CanonicalValue))),
      )
      if (!corruptedReference.ok) throw new Error('reference will not canonicalise')
      expect(corruptedReference.cid.toString()).not.toBe(outcome.rootCid)

      // MR-05 — rendezvous assignment reached a real dispatch. **No single deletion
      // turns this red, and that is the finding rather than an omission**: it compares
      // `executeReduce`'s bookkeeping against the pure function `executeReduce` itself
      // called. Plan 16-03's process-level measurement is the one with a deletion.
      for (const node of tree.nodes) {
        expect(outcome.executedBy.get(node.id)).toBe(rendezvousRank(node.id, executorIds)[0])
      }
    } finally {
      fabric.close()
    }
  })
})

describe('reduceJob names what it could not do, rather than presenting a partial aggregate', () => {
  const opts = (over: Partial<Parameters<typeof reduceJob>[1]> = {}) => ({
    rpc: new RpcEndpoint(new MemoryNetwork().connect('requestor'), { timeoutMs: 50 }),
    executors: ['w0'],
    blockstore: new MemoryBlockstore(),
    project,
    // These cases are about the named failures a reduce reports before any combine is
    // dispatched, so nothing here has a signature to check. Stated rather than defaulted:
    // the option is required precisely so a caller cannot arrive at a receipt without
    // having said what it checks against.
    trustedIssuers: 'checks-no-combine-signatures' as const,
    // MR-02 — these shards are the requestor's own and carry no owner, so each partial
    // is attributed to its own partition index. Stated for the same reason as the line
    // above: the option is required so a caller cannot arrive at a leaf key by default.
    contributors: 'attributes-each-shard-to-its-own-partition-index' as const,
    // Every case in this block refuses *before* a combine is placed anywhere, so the
    // placement never runs. The remote sentinel is nonetheless the honest statement for
    // them: a local-preferring fixture would be claiming these refusals hold on a path
    // that combines in-process, which is a different claim and one this block does not
    // measure. `describe('the owner's placement ruling …')` below is where that path is.
    placement: 'requires-remote-combining' as const,
    ...over,
  })

  it('reduces a single agreed shard to that shard, with no combine at all', async () => {
    const result = await reduceJob(jobWith([agreed(0, partitionOutput(0))]), opts())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The degenerate case `deriveReduceTree` already handles: a lone leaf is promoted
    // rather than wrapped in a combine that would produce the same bytes.
    expect(result.tree.nodes).toEqual([])
    expect(result.tree.depth).toBe(0)
    expect(result.tree.rootId).toBe(result.tree.leaves[0]?.id)
    expect(result.outcome.combines).toBe(0)
    expect(result.outcome.rootCid).toBe(result.leaves[0]?.toString())
    expect(result.outcome.ok).toBe(true)
  })

  it('refuses a job in which no shard agreed, rather than letting a RangeError escape', async () => {
    // `resolves`, not a try/catch, so a throw fails the assertion rather than being
    // caught by it.
    await expect(reduceJob(jobWith([insufficient(0), insufficient(1)]), opts())).resolves.toEqual({
      ok: false,
      reason: 'no agreed shard produced a partial',
    })
  })

  it('names every partition it skipped, in ascending order', async () => {
    const result = await reduceJob(
      jobWith([
        agreed(0, partitionOutput(0)),
        insufficient(1),
        agreed(2, partitionOutput(2)),
        insufficient(3),
        agreed(4, partitionOutput(4)),
      ]),
      opts(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // A driver that quietly dropped these would pass every other assertion in the file
    // while presenting a partial aggregate as a complete one.
    expect(result.skipped).toEqual([1, 3])
  })

  it('names the shard whose projection did not produce a partial', async () => {
    const result = await reduceJob(jobWith([agreed(0, partitionOutput(0)), agreed(2, partitionOutput(2))]), {
      ...opts(),
      // A bare number is not a `{counts, rows}` partial. On the wire that would
      // contribute zero; **at the requestor it must be a named failure**, because the
      // value was authored here and a diagnosis is possible.
      project: (_output: CanonicalValue, partitionIndex: number) => (partitionIndex === 2 ? 7 : project(_output)),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('2')
  })

  it('names the shard whose projection threw, and what it threw', async () => {
    const result = await reduceJob(
      jobWith([agreed(0, partitionOutput(0)), agreed(2, { not: 'a partition output' })]),
      opts(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('2')
    expect(result.reason).toContain('not a partition output')
  })

  it('names the shard whose projection is larger than the partial budget', async () => {
    const result = await reduceJob(jobWith([agreed(0, partitionOutput(0)), agreed(2, partitionOutput(2))]), {
      ...opts(),
      project: (output: CanonicalValue, partitionIndex: number) =>
        partitionIndex === 2
          ? { counts: { big: 1 }, rows: 1, padding: new Uint8Array(MAX_PARTIAL_BYTES + 512) }
          : project(output),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('2')
    expect(result.reason).toContain(String(MAX_PARTIAL_BYTES))
  })

  it('refuses an empty executor list by name, rather than by an outcome that says nothing', async () => {
    const result = await reduceJob(jobWith([agreed(0, partitionOutput(0))]), opts({ executors: [] }))
    // `executeReduce` already handles this by returning `ok: false` with
    // `failed: [tree.rootId]`, which is true and tells the caller nothing about why.
    expect(result).toEqual({ ok: false, reason: 'no executor to combine on' })
  })
})

// ─── VER-08 / VER-09 / VER-10 — the AGGREGATION's own receipt ────────────────────────
//
// **Two receipts, and conflating them would be worse than having one.** The map half's
// receipt is `submitJob`'s and rides on `JobResult.attestation`; this half is
// `reduceJob`'s and is about a different claim. `PROJECT.md` splits them because they
// routinely differ: a sovereign map is owner-attested by construction — pinning data to
// one owner removes the second executor — while the aggregation over it can be redundant,
// since a combine reads only content-addressed partials and is runnable anywhere.
// `reduce.ts`'s `ReduceRun.redundancy` doc states the same split in the source's own
// words. Every fixture below therefore carries the map half's **named absence** (see
// `jobWith`) while asserting a real strength for the aggregation, which is the pairing
// that would be impossible if one receipt stood for both.

/** The provider every fixture worker below enrols with. */
const FIXTURE_PROVIDER_SEED = new Uint8Array(32).fill(41)
/** One user key across the fixture's nodes — the operator id is what diversity is about. */
const FIXTURE_USER_SEED = new Uint8Array(32).fill(42)

/**
 * How one fixture peer answers a `combine`.
 *
 * `'the production agent'` is `serveAgent`, which is what makes the three label readings
 * measurements of production code rather than of this file. The object arm is a
 * hand-written peer, and it exists for the two properties `serveAgent` **cannot** be
 * asked to produce: a node that refuses a particular level of the tree, and a node whose
 * signature covers an input order it did not merge in.
 */
type FixtureBehaviour =
  | 'the production agent'
  | {
      /** Answer `resultCid: null` at this level, the way an over-capacity node does. */
      readonly refusesLevel: number | 'refuses-nothing'
      readonly signsOver: 'the inputs as merged' | 'the inputs reversed'
    }

interface FixtureWorker {
  readonly operatorId: string
  /** The byte its 32-byte node seed is filled with. Two workers may share one — see the duplicate case. */
  readonly seedByte: number
  readonly behaviour: FixtureBehaviour
}

/**
 * A hand-written combine peer.
 *
 * Serves exactly two verbs, because that is all a reduce asks of a peer: `block`, so the
 * requestor can fetch the merge back, and `combine`. It merges **honestly** with the
 * fabric's own `fabricCombiner` in every arm — a peer that answered with the wrong bytes
 * would be refused by `remoteCombineDispatch`'s content-address check long before any
 * signature was looked at, which would prove nothing about the receipt.
 */
function serveFixtureCombiner(options: {
  readonly rpc: RpcEndpoint
  readonly blockstore: Blockstore
  readonly signer: ResultSigner
  readonly refusesLevel: number | 'refuses-nothing'
  readonly signsOver: 'the inputs as merged' | 'the inputs reversed'
}): void {
  options.rpc.serve(async (_from, body) => {
    const request = parseRequest(body)
    if (request === null) return encodeResponse({ kind: 'error', reason: 'malformed request' })
    if (request.kind === 'block') {
      const bytes = await options.blockstore.get(request.cid)
      return encodeResponse({ kind: 'block', bytes: bytes ?? null })
    }
    if (request.kind !== 'combine') {
      return encodeResponse({ kind: 'error', reason: 'this fixture serves only block and combine' })
    }
    if (options.refusesLevel !== 'refuses-nothing' && request.level === options.refusesLevel) {
      // The combine reply shape and not an `error` frame, exactly as `agent.ts`'s own
      // admission refusal does it — and with the sentinel, because a combine this peer
      // did not run is not a merge it can make a statement about.
      return encodeResponse({
        kind: 'combine',
        resultCid: null,
        reason: `this fixture refuses level ${String(request.level)}`,
        attestation: 'signed-by-nobody',
      })
    }
    const inputs: CanonicalValue[] = []
    for (const cid of request.inputCids) {
      const bytes = await options.blockstore.get(cid)
      if (bytes === undefined) {
        return encodeResponse({
          kind: 'combine',
          resultCid: null,
          reason: `combine input ${cid.toString()} not held`,
          attestation: 'signed-by-nobody',
        })
      }
      inputs.push(decodeCanonical(bytes))
    }
    const hashed = await canonicalCid(fabricCombiner(inputs))
    if (!hashed.ok) throw new Error('fixture merge is not encodable')
    await options.blockstore.put(hashed.bytes)
    // **The whole of the dishonest arm is the ORDER**, and nothing else: the result is
    // the honest merge and hashes to what is claimed. `fabricCombiner` is commutative,
    // so a reversed input list produces the identical bytes — which is what makes this a
    // statement about a merge that did not happen rather than a wrong answer, and is
    // exactly what `combineChallenge`'s never-sort rule exists to catch.
    const signedOver =
      options.signsOver === 'the inputs as merged' ? request.inputCids : [...request.inputCids].reverse()
    return encodeResponse({
      kind: 'combine',
      resultCid: hashed.cid,
      reason: '',
      attestation: signCombine(options.signer, signedOver, hashed.cid),
    })
  })
}

/** A requestor that serves its own blocks, plus N enrolled combine peers. */
async function combineFabric(workers: readonly FixtureWorker[]) {
  const network = new MemoryNetwork()
  const authority = new EnrollmentAuthority({
    providerPrivateKey: FIXTURE_PROVIDER_SEED,
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })

  const requestorStore = new MemoryBlockstore()
  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
  serveAgent({
    ...SENTINELS,
    rpc: requestorRpc,
    executor: new WasmExecutor({ nodeId: 'requestor', blockstore: requestorStore }),
    blockstore: requestorStore,
  })

  const endpoints: RpcEndpoint[] = [requestorRpc]
  const ids: string[] = []
  const signers: ResultSigner[] = []

  for (const [index, worker] of workers.entries()) {
    const id = `w${String(index)}`
    const nodeSeed = new Uint8Array(32).fill(worker.seedByte)
    // Enrolled at the real clock, because `reduceJob` verifies at the real clock: a
    // fixed fixture epoch would make every certificate here `not-yet-valid` or `expired`
    // and every reading below the named absence for a reason unrelated to attestation.
    const enrolled = authority.enrol(
      await requestEnrollment(nodeSeed, FIXTURE_USER_SEED, {
        operatorId: worker.operatorId,
        discoverability: 'seed',
        relayIds: [],
      }),
      Date.now(),
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
    const signer: ResultSigner = { nodeSeed, certificate: enrolled.certificate }

    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
    // The requestor is where the leaves live, so it is the one place a combine peer
    // fetches from — the same topology every fabric in this repository has.
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['requestor']),
    )
    if (worker.behaviour === 'the production agent') {
      serveAgent({
        ...SENTINELS,
        rpc,
        executor: new WasmExecutor({ nodeId: id, blockstore: store }),
        blockstore: store,
        attest: signer,
      })
    } else {
      serveFixtureCombiner({
        rpc,
        blockstore: store,
        signer,
        refusesLevel: worker.behaviour.refusesLevel,
        signsOver: worker.behaviour.signsOver,
      })
    }
    endpoints.push(rpc)
    ids.push(id)
    signers.push(signer)
  }

  return {
    requestorRpc,
    requestorStore,
    ids,
    signers,
    trustedIssuers: new Set<PublicKeyHex>([authority.issuerKey]),
    close: () => {
      for (const rpc of endpoints) rpc.close()
    },
  }
}

/** A job of `count` agreed shards, each with a distinct partition output. */
function agreedJob(count: number): JobResult {
  return jobWith(Array.from({ length: count }, (_, i) => agreed(i, partitionOutput(i))))
}

describe('a reduction reports how strongly its own AGGREGATION is attested', () => {
  /**
   * The three labels are one expression on three inputs.
   *
   * Asserted in one case rather than three, because either reading alone is satisfied by
   * a constant: a driver hardcoding `'owner-attested'` passes the first, one hardcoding
   * `'independent'` passes the third, and only the set of them together says the value
   * followed its input. `describeAttestation`'s own sentence is compared rather than
   * transcribed, so the two surfaces cannot drift.
   */
  it('reads owner-attested at one producer, owner-domain within one operator, independent across two', async () => {
    const readings: string[] = []
    const cases: readonly { readonly workers: readonly FixtureWorker[]; readonly redundancy: number }[] = [
      {
        workers: [{ operatorId: 'alice-op', seedByte: 120, behaviour: 'the production agent' }],
        redundancy: 1,
      },
      {
        workers: [
          { operatorId: 'alice-op', seedByte: 121, behaviour: 'the production agent' },
          { operatorId: 'alice-op', seedByte: 122, behaviour: 'the production agent' },
        ],
        redundancy: 2,
      },
      {
        workers: [
          { operatorId: 'alice-op', seedByte: 123, behaviour: 'the production agent' },
          { operatorId: 'bob-op', seedByte: 124, behaviour: 'the production agent' },
        ],
        redundancy: 2,
      },
    ]

    for (const { workers, redundancy } of cases) {
      const fabric = await combineFabric(workers)
      try {
        const result = await reduceJob(agreedJob(2), {
          // MR-05/MR-06 — this case measures the *fabric's* combine placement, so it states the
          // clause of the 2026-08-18 placement ruling that keeps combines on peers. A
          // local-preferring requestor would answer every combine in-process and there would be
          // no rendezvous assignment and no churn repair left to observe.
          placement: 'requires-remote-combining',
          rpc: fabric.requestorRpc,
          executors: fabric.ids,
          blockstore: fabric.requestorStore,
          project,
          redundancy,
          trustedIssuers: fabric.trustedIssuers,
          contributors: 'attributes-each-shard-to-its-own-partition-index',
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.outcome.ok).toBe(true)
        // One combine over two leaves, so the tree has exactly one step and "the weakest
        // step" is not doing any hiding in this case.
        expect(result.tree.nodes).toHaveLength(1)
        const receipt = result.aggregateAttestation
        if ('kind' in receipt) throw new Error(`expected a strength, got ${receipt.reason}`)
        readings.push(receipt.strength)
        expect(receipt.replicas).toBe(redundancy)
      } finally {
        fabric.close()
      }
    }

    expect(readings).toEqual(['owner-attested', 'owner-domain', 'independent'])
  })

  it('does not count a combine whose signature covers an input order it did not merge', async () => {
    // **The assertion the whole combine-signing leg exists for.** This peer merged
    // honestly and its result hashes to what it claimed, so every check that came before
    // signatures passes; the only thing wrong is what it signed. A requestor that counted
    // the certificate without checking the signature reports a strength on its own
    // say-so — see the `verifyCombineAttestation` call this reddens.
    const fabric = await combineFabric([
      {
        operatorId: 'alice-op',
        seedByte: 125,
        behaviour: { refusesLevel: 'refuses-nothing', signsOver: 'the inputs reversed' },
      },
    ])
    try {
      const result = await reduceJob(agreedJob(2), {
        // MR-05/MR-06 — this case measures the *fabric's* combine placement, so it states the
        // clause of the 2026-08-18 placement ruling that keeps combines on peers. A
        // local-preferring requestor would answer every combine in-process and there would be
        // no rendezvous assignment and no churn repair left to observe.
        placement: 'requires-remote-combining',
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        trustedIssuers: fabric.trustedIssuers,
        // MR-02 — public shards, so a partial is attributed to its own partition index.
        contributors: 'attributes-each-shard-to-its-own-partition-index',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // The aggregation itself succeeded — this is not a failed reduce with a footnote.
      expect(result.outcome.ok).toBe(true)
      expect(result.outcome.rootCid).not.toBeNull()

      const receipt = result.aggregateAttestation
      expect('kind' in receipt).toBe(true)
      if (!('kind' in receipt)) return
      expect(receipt.kind).toBe('holds-no-verified-aggregate-attestation')
      expect(receipt.combines).toBe(1)
      expect(receipt.verified).toBe(0)
      // The kernel's own words for a signature that does not check out, forwarded rather
      // than restated — `verifyCombineAttestation`'s `bad-result-signature` reason.
      expect(receipt.reason).toContain('did not sign')
    } finally {
      fabric.close()
    }
  })

  it('is set by the weakest step, so a weak leaf-level combine cannot hide under a strong root', async () => {
    // Five leaves make a two-level tree: one level-1 combine over four leaves, and a root
    // over that node plus the promoted fifth leaf. `bob` refuses **level 1** only, so the
    // level-1 combine gets one producer and the root gets two from two operators.
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 126, behaviour: 'the production agent' },
      {
        operatorId: 'bob-op',
        seedByte: 127,
        behaviour: { refusesLevel: 1, signsOver: 'the inputs as merged' },
      },
    ])
    try {
      const result = await reduceJob(agreedJob(5), {
        // MR-05/MR-06 — this case measures the *fabric's* combine placement, so it states the
        // clause of the 2026-08-18 placement ruling that keeps combines on peers. A
        // local-preferring requestor would answer every combine in-process and there would be
        // no rendezvous assignment and no churn repair left to observe.
        placement: 'requires-remote-combining',
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 2,
        trustedIssuers: fabric.trustedIssuers,
        // MR-02 — public shards, so a partial is attributed to its own partition index.
        contributors: 'attributes-each-shard-to-its-own-partition-index',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.outcome.ok).toBe(true)
      // Measured off `deriveReduceTree`, not asserted from a figure on paper.
      expect(result.tree.depth).toBe(2)
      expect(result.tree.nodes).toHaveLength(2)
      // The shape the case depends on: the two levels really did achieve different
      // redundancy, or the reading below would be about nothing.
      expect(result.outcome.minReplicas).toBe(1)

      const receipt = result.aggregateAttestation
      if ('kind' in receipt) throw new Error(`expected a strength, got ${receipt.reason}`)
      // The root alone reads `independent`; the tree reads its weakest step.
      expect(receipt.strength).toBe('owner-attested')
    } finally {
      fabric.close()
    }
  })

  it('refuses to read two replicas out of one node key, however many peers presented it', async () => {
    // Two peers, one identity: `attestationReceipt` reports `replicas` from the set it is
    // handed and cannot know, so a requestor that skipped this check would report a
    // redundancy of two for an aggregation one node attested. It is reachable rather than
    // hypothetical — an attestation is transferable by design, so a peer can forward
    // another's signed statement verbatim, and `reduceJob`'s executors are bare peer ids
    // with no certificate to compare against.
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 128, behaviour: 'the production agent' },
      { operatorId: 'bob-op', seedByte: 128, behaviour: 'the production agent' },
    ])
    try {
      const result = await reduceJob(agreedJob(2), {
        // MR-05/MR-06 — this case measures the *fabric's* combine placement, so it states the
        // clause of the 2026-08-18 placement ruling that keeps combines on peers. A
        // local-preferring requestor would answer every combine in-process and there would be
        // no rendezvous assignment and no churn repair left to observe.
        placement: 'requires-remote-combining',
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 2,
        trustedIssuers: fabric.trustedIssuers,
        // MR-02 — public shards, so a partial is attributed to its own partition index.
        contributors: 'attributes-each-shard-to-its-own-partition-index',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Both peers answered and agreed — the inflation is available to be reported.
      expect(result.outcome.minReplicas).toBe(2)

      const receipt = result.aggregateAttestation
      expect('kind' in receipt).toBe(true)
      if (!('kind' in receipt)) return
      expect(receipt.verified).toBe(0)
      expect(receipt.reason).toContain('under one node key')
    } finally {
      fabric.close()
    }
  })

  it('answers the no-checking sentinel with the named absence, beside a checking run of the same rig', async () => {
    // The two configurations are shown to differ rather than assumed to: one fabric, one
    // job, two requestors. Without the pair, "the sentinel reads the absence" would be
    // satisfied by a rig that never establishes anything.
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 129, behaviour: 'the production agent' },
    ])
    try {
      const common = {
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        contributors: 'attributes-each-shard-to-its-own-partition-index' as const,
        // This case is about what a requestor can establish from a *peer's* combine
        // signature, so the combine has to happen on a peer.
        placement: 'requires-remote-combining' as const,
      }
      const checking = await reduceJob(agreedJob(2), { ...common, trustedIssuers: fabric.trustedIssuers })
      const unchecking = await reduceJob(agreedJob(2), {
        ...common,
        trustedIssuers: 'checks-no-combine-signatures',
      })
      expect(checking.ok && unchecking.ok).toBe(true)
      if (!checking.ok || !unchecking.ok) return

      const established = checking.aggregateAttestation
      if ('kind' in established) throw new Error(`expected a strength, got ${established.reason}`)
      expect(established.strength).toBe('owner-attested')

      const absent = unchecking.aggregateAttestation
      expect('kind' in absent).toBe(true)
      if (!('kind' in absent)) return
      expect(absent.reason).toContain('checks no combine signatures')
      expect(absent.verified).toBe(0)
    } finally {
      fabric.close()
    }
  })

  it('says a reduction that merged nothing has no aggregation to attest, rather than reading a strength', async () => {
    // A single contribution is promoted rather than combined, so no node performed an
    // aggregation at all. `owner-attested` here would be a claim about a step that never
    // ran — the same conflation the named absence exists to prevent one level up.
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 130, behaviour: 'the production agent' },
    ])
    try {
      const result = await reduceJob(agreedJob(1), {
        // MR-05/MR-06 — this case measures the *fabric's* combine placement, so it states the
        // clause of the 2026-08-18 placement ruling that keeps combines on peers. A
        // local-preferring requestor would answer every combine in-process and there would be
        // no rendezvous assignment and no churn repair left to observe.
        placement: 'requires-remote-combining',
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        trustedIssuers: fabric.trustedIssuers,
        // MR-02 — public shards, so a partial is attributed to its own partition index.
        contributors: 'attributes-each-shard-to-its-own-partition-index',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.tree.nodes).toEqual([])
      const receipt = result.aggregateAttestation
      expect('kind' in receipt).toBe(true)
      if (!('kind' in receipt)) return
      expect(receipt.combines).toBe(0)
      expect(receipt.reason).toContain('merged nothing')
    } finally {
      fabric.close()
    }
  })
})

describe('the tree derived over these eight leaves — the phase’s one measurement of the shape', () => {
  it('has the nodes.length and depth 16-02-SUMMARY.md records', async () => {
    // Read off `deriveReduceTree`, not computed on paper: a left fold over the sorted
    // leaves and a linear scan each give a different shape from the layer loop.
    const contributions = []
    for (let i = 0; i < 8; i++) {
      const hashed = await canonicalCid(project(partitionOutput(i)))
      if (!hashed.ok) throw new Error('fixture will not canonicalise')
      contributions.push({ contributorId: `shard-${i}`, cid: hashed.cid })
    }
    const tree = deriveReduceTree(contributions)
    expect(tree.leaves).toHaveLength(8)
    expect(tree.nodes).toHaveLength(3)
    expect(tree.depth).toBe(2)
    expect(tree.fanout).toBe(4)
  })
})

/**
 * The owner's placement ruling of 2026-08-18, and each of its escapes on its own case.
 *
 * > *"Always prefer local execution, unless it must be executed remotely (requested to do
 * > so, or needs certain permissions that cannot be satisfied or data ownership requires,
 * > etc.) or the current node is fully loaded."*
 *
 * **The escapes are asserted one per case and never in combination**, because a single
 * broken predicate hides perfectly inside a conjunction: a run whose combine went remote
 * satisfies "the capacity check works" and "the authorizer check works" identically, and
 * only a case where *every other* escape admits can say which one refused. So each case
 * below admits on all the others and refuses on exactly one, and reads the refusal's own
 * text out of `outcome.localRefusals` rather than inferring it from placement.
 *
 * **`localRefusals` is what makes that readable at all.** Without it "the combine went to
 * a peer" is one bit for four different reasons — which is the failure `Rejection` exists
 * to prevent one layer over, and the reason this array is not derived from anything.
 */
describe("the requestor combines its own job unless a named condition sends it out", () => {
  /** Room for four, which no case here exhausts by accident. */
  const roomy = (): LocalCapacity => new LocalCapacity({ nodeId: 'requestor', maxConcurrent: 4 })

  /**
   * A node with exactly one slot, already spent — so `would` refuses in the real class's
   * own words rather than in a fixture's.
   *
   * Occupied through `offer()` on a shard id that is **not** a combine key, so nothing
   * here could be mistaken for the reduce having taken its own slot: the point is a node
   * that is busy with other work, which is what "fully loaded" means to a tab that is
   * also executing shards.
   */
  const full = (): LocalCapacity => {
    const capacity = new LocalCapacity({ nodeId: 'requestor', maxConcurrent: 1 })
    const taken = capacity.offer({ shardId: 'some-other-work', nodeId: 'requestor' })
    expect(taken.accepted).toBe(true)
    return capacity
  }

  /** Records every question asked of it, so a case can assert it was never asked. */
  const counting = (
    inner: Authorizer | 'serves-unauthenticated',
  ): { authorize: Authorizer; asked: AuthorizedWork[] } => {
    const asked: AuthorizedWork[] = []
    return {
      asked,
      authorize: (request) => {
        asked.push(request)
        return inner === 'serves-unauthenticated' ? null : inner(request)
      },
    }
  }

  it('combines every node in its own process while a peer sits there answering', async () => {
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 140, behaviour: 'the production agent' },
    ])
    try {
      const common = {
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        trustedIssuers: fabric.trustedIssuers,
        contributors: 'attributes-each-shard-to-its-own-partition-index' as const,
      }

      // ── The control arm, and it is the whole reason this case is not vacuous. ───────
      //
      // The same fabric, the same job, the only difference the placement. It establishes
      // that `w0` really does answer combines and really does sign them — so when the
      // local arm below shows `w0` producing nothing, that is the requestor pre-empting a
      // reachable peer rather than a peer that was never there.
      const remote = await reduceJob(agreedJob(5), {
        ...common,
        placement: 'requires-remote-combining',
      })
      expect(remote.ok).toBe(true)
      if (!remote.ok) return
      expect(remote.outcome.ok).toBe(true)
      expect([...new Set(remote.outcome.executedBy.values())]).toEqual(['w0'])
      expect(remote.outcome.locallyCombined).toEqual([])
      // A real receipt, not the named absence: a peer signed each merge and this
      // requestor verified it against the issuer it pinned.
      expect('kind' in remote.aggregateAttestation).toBe(false)

      // ── The local arm. ────────────────────────────────────────────────────────────
      const local = await reduceJob(agreedJob(5), {
        ...common,
        placement: { kind: 'prefers-local-combining', capacity: roomy(), authorize: 'serves-unauthenticated' },
      })
      expect(local.ok).toBe(true)
      if (!local.ok) return
      expect(local.outcome.ok).toBe(true)

      // Every combine, not merely the root. Five leaves at fanout 4 derive a **two-level**
      // tree — four leaves merge, the fifth is promoted, and the root merges the two — so
      // the second level read an input that the first level had written into the
      // requestor's own store. A one-level tree would leave that unmeasured.
      expect(local.tree.nodes).toHaveLength(2)
      expect(local.tree.depth).toBe(2)
      expect([...local.outcome.locallyCombined].sort()).toEqual(
        [...local.tree.nodes.map((node) => node.id)].sort(),
      )
      expect([...new Set(local.outcome.executedBy.values())]).toEqual([LOCAL_COMBINE_EXECUTOR])
      // Nothing was refused, so nothing fell through — the ranking was not walked at all.
      expect(local.outcome.localRefusals).toEqual([])
      expect(local.outcome.recomputes).toBe(0)

      // **The answer is the same answer.** Preferring local changes who computed the
      // aggregate and not what it is, which is the property that makes the placement a
      // placement rather than a second implementation.
      expect(local.outcome.rootCid).toBe(remote.outcome.rootCid)

      // ── The marker, on the ordinary path rather than an exotic one. ───────────────
      //
      // This is the load-bearing assertion of the whole ruling. A locally combined
      // aggregate is self-attested — `localDispatch` signs nothing on purpose — and the
      // one thing that must never happen is for that to be absorbed into a generic
      // absence. The same requestor, pinning the same issuers, reads a real receipt on
      // the remote arm above and this on the local one.
      const attestation = local.aggregateAttestation
      expect('kind' in attestation).toBe(true)
      if (!('kind' in attestation)) return
      expect(attestation.kind).toBe('holds-no-verified-aggregate-attestation')
      expect(attestation.verified).toBe(0)
      expect(attestation.combines).toBe(2)
      expect(attestation.reason).toContain('this requestor combined it in its own process')
      expect(attestation.reason).toContain('the party that wanted the answer')
      // Named for every combine, so a tree with one local step among many could not read
      // as a tree with none.
      for (const node of local.tree.nodes) expect(attestation.reason).toContain(node.id)
    } finally {
      fabric.close()
    }
  })

  it('sends every combine out when the caller requires remote, without asking its own ports', async () => {
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 141, behaviour: 'the production agent' },
    ])
    try {
      const result = await reduceJob(agreedJob(5), {
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        trustedIssuers: fabric.trustedIssuers,
        contributors: 'attributes-each-shard-to-its-own-partition-index',
        placement: 'requires-remote-combining',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.outcome.ok).toBe(true)
      expect(result.outcome.locallyCombined).toEqual([])
      expect([...new Set(result.outcome.executedBy.values())]).toEqual(['w0'])
      // The refusal is recorded per combine rather than left as an empty array, which is
      // what lets *this* reason be told apart from a full node's below.
      expect(result.outcome.localRefusals.map((entry) => entry.nodeId).sort()).toEqual(
        [...result.tree.nodes.map((node) => node.id)].sort(),
      )
      for (const entry of result.outcome.localRefusals) {
        expect(entry.reason).toBe(
          'this caller requires remote combining, so the requestor did not offer itself this combine',
        )
      }
      // **No "the ports were never asked" assertion here, and its absence is deliberate.**
      // An earlier draft built a capacity and an authorizer, passed neither — the sentinel
      // arm carries no ports, by construction — and then asserted they were untouched.
      // That assertion could not fail, which makes it worse than no assertion: it reads
      // like evidence of an ordering. The ordering claim on this arm is a *type-level* one
      // — `'requires-remote-combining'` has nowhere to put a port — and the runtime claim
      // that capacity is asked before authorisation is carried by the full-node case
      // below, where both ports are supplied and the authorizer is measurably never
      // reached.
    } finally {
      fabric.close()
    }
  })

  it('sends the combine out when the local node is full, naming the capacity refusal', async () => {
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 142, behaviour: 'the production agent' },
    ])
    try {
      const authorizer = counting('serves-unauthenticated')
      const result = await reduceJob(agreedJob(5), {
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        trustedIssuers: fabric.trustedIssuers,
        contributors: 'attributes-each-shard-to-its-own-partition-index',
        // Everything else admits. Only headroom refuses.
        placement: { kind: 'prefers-local-combining', capacity: full(), authorize: authorizer.authorize },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // The ranking is walked exactly as it was before this feature existed, so the
      // reduce still completes — on the peer.
      expect(result.outcome.ok).toBe(true)
      expect(result.outcome.locallyCombined).toEqual([])
      expect([...new Set(result.outcome.executedBy.values())]).toEqual(['w0'])

      // `LocalCapacity`'s own words, composed in `LocalCapacity.#decide` and not here —
      // the same string a peer's refusal carries, which is the point of answering an
      // offer to yourself through the same port.
      expect(result.outcome.localRefusals).toHaveLength(2)
      for (const entry of result.outcome.localRefusals) {
        expect(entry.reason).toContain('over-committed')
        expect(entry.reason).toContain('1 of 1')
      }

      // The authorizer was never reached, which is `runCombine`'s ordering: capacity is
      // asked first because a refusal there costs nothing else.
      expect(authorizer.asked).toEqual([])
    } finally {
      fabric.close()
    }
  })

  it('sends the combine out when its own authorizer refuses, naming the refusal', async () => {
    const fabric = await combineFabric([
      { operatorId: 'alice-op', seedByte: 143, behaviour: 'the production agent' },
    ])
    try {
      // An authorizer that refuses combines and nothing else, so the refusal cannot be a
      // blanket one that would pass this case for the wrong reason.
      const authorizer = counting((request) =>
        request.kind === 'combine' ? 'this fixture admits no combine' : null,
      )
      const result = await reduceJob(agreedJob(5), {
        rpc: fabric.requestorRpc,
        executors: fabric.ids,
        blockstore: fabric.requestorStore,
        project,
        redundancy: 1,
        trustedIssuers: fabric.trustedIssuers,
        contributors: 'attributes-each-shard-to-its-own-partition-index',
        // Room to spare. Only the permission refuses.
        placement: { kind: 'prefers-local-combining', capacity: roomy(), authorize: authorizer.authorize },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.outcome.ok).toBe(true)
      expect(result.outcome.locallyCombined).toEqual([])
      expect([...new Set(result.outcome.executedBy.values())]).toEqual(['w0'])

      expect(result.outcome.localRefusals).toHaveLength(2)
      for (const entry of result.outcome.localRefusals) {
        // The `unauthorized: ` prefix is `combineAdmitted`'s, so one authorizer's text
        // reads identically whether the requestor or a peer consulted it.
        expect(entry.reason).toBe('unauthorized: this fixture admits no combine')
      }

      // It was asked about the combine and about nothing else, with the work shape a
      // peer's authorizer is handed — the tree node's id, the inputs as merged, the
      // level, and the empty chain this build's combine frame cannot carry.
      expect(authorizer.asked).toHaveLength(2)
      for (const [index, asked] of authorizer.asked.entries()) {
        expect(asked.kind).toBe('combine')
        if (asked.kind !== 'combine') return
        expect(asked.capability).toEqual([])
        expect(asked.combine.combineId).toBe(result.tree.nodes[index]?.id)
        expect(asked.combine.inputCids.length).toBeGreaterThan(0)
      }
    } finally {
      fabric.close()
    }
  })

  it('falls through to the ranking without pre-empting it when nothing local is offered', async () => {
    // The pre-ruling behaviour, kept as a case rather than as a memory: a requestor that
    // states the remote sentinel gets exactly what `reduceJob` did before the placement
    // existed, including the failure when no peer answers. `executors: ['w0']` names a
    // peer nothing is serving.
    const result = await reduceJob(agreedJob(5), {
      rpc: new RpcEndpoint(new MemoryNetwork().connect('requestor'), { timeoutMs: 50 }),
      executors: ['w0'],
      blockstore: new MemoryBlockstore(),
      project,
      trustedIssuers: 'checks-no-combine-signatures',
      contributors: 'attributes-each-shard-to-its-own-partition-index',
      placement: 'requires-remote-combining',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome.ok).toBe(false)
    expect(result.outcome.rootCid).toBeNull()
    expect(result.outcome.locallyCombined).toEqual([])
    // And the same job, on a requestor that offers itself the work, completes with no
    // peer involved at all — which is the difference the ruling makes, measured on one
    // fixture rather than argued.
    const offered = await reduceJob(agreedJob(5), {
      rpc: new RpcEndpoint(new MemoryNetwork().connect('requestor'), { timeoutMs: 50 }),
      executors: ['w0'],
      blockstore: new MemoryBlockstore(),
      project,
      trustedIssuers: 'checks-no-combine-signatures',
      contributors: 'attributes-each-shard-to-its-own-partition-index',
      placement: { kind: 'prefers-local-combining', capacity: roomy(), authorize: 'serves-unauthenticated' },
    })
    expect(offered.ok).toBe(true)
    if (!offered.ok) return
    expect(offered.outcome.ok).toBe(true)
    expect(offered.outcome.rootCid).not.toBeNull()
    expect(offered.outcome.locallyCombined).toHaveLength(2)
  })
})
