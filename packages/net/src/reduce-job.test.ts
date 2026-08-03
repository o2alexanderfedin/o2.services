import {
  MAX_PARTIAL_BYTES,
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  canonicalCid,
  deriveReduceTree,
  fabricCombiner,
  publicNodes,
  rendezvousRank,
  submitJob,
} from '@o2/core'
import type { CanonicalValue, JobResult, ShardResult } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import, exactly as `distributed.test.ts` does it: `@o2/core`'s
// export map exposes only its public entry, and adding a fixtures export would modify
// the kernel package.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { RpcBlockSource, serveAgent } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
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

/** The seven sentinels every `AgentOptions` must write down. */
const SENTINELS = {
  egress: 'holds-no-registrations',
  authorize: 'serves-unauthenticated',
  index: 'serves-no-records',
  capacity: 'accepts-every-offer',
  ledger: 'keeps-no-ledger',
  reservations: 'relays-for-nobody',
  onDispatch: 'reports-no-dispatch',
  enroll: 'issues-no-certificates',
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
    grossFuel: 0,
    usefulFuel: 0,
    verificationMultiplier: 1,
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
    verification: {
      status: 'agreed',
      resultCid: FIXED_CID,
      output,
      // The sentinel, because nothing enrolled the node this fixture stands for. It is
      // that node's truthful statement rather than a placeholder — the same reading
      // every executor in the tree gives until the signing wrapper is composed.
      agreeing: [{ nodeId: 'w0', attestation: 'signed-by-nobody' }],
      replicas: 1,
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
        },
        fabric.originStore,
      )
      expect(submitted.ok).toBe(true)
      if (!submitted.ok) return
      expect(submitted.job.complete).toBe(true)

      const executorIds = fabric.workers.map((w) => w.id)
      const result = await reduceJob(submitted.job, {
        rpc: fabric.originRpc,
        executors: executorIds,
        blockstore: fabric.originStore,
        project,
        redundancy: 2,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const { outcome, tree, leaves, skipped } = result

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
