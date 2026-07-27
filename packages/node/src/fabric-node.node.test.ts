import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publicNodes, submitJob } from '@o2/core'
import type { CanonicalValue } from '@o2/core'
import { RemoteExecutor, blockCid } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * NET-01 — the same job, over a real transport.
 *
 * These nodes talk TCP, negotiate noise, multiplex with yamux, and exchange blocks
 * over a real socket. The kernel is the same kernel: `submitJob` is called exactly
 * as the loopback tests call it, and the only difference is that the `Executor`
 * instances it receives happen to reach other machines.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
  })
  running.push(node)
  return node
}

function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-net-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('NET-01 — two nodes over TCP', () => {
  it('exchanges a message over the o2 protocol', async () => {
    const [a, b] = await Promise.all([startNode('a'), startNode('b')])
    const remoteId = await a.dial(b.multiaddrs[0]!)

    expect(remoteId).toBe(b.peerId)
    expect(a.transport.peers).toContain(b.peerId)

    // A block request is the simplest round trip that proves the protocol works.
    const bytes = new Uint8Array([1, 2, 3, 4])
    const cid = await b.store.put(bytes)
    const fetched = await a.blockstore.get(cid)
    expect(fetched).toEqual(bytes)
  }, 30_000)

  it('carries a message larger than the wire chunk size', async () => {
    const [a, b] = await Promise.all([startNode('a'), startNode('b')])
    await a.dial(b.multiaddrs[0]!)

    // 100 KiB — many chunks, so the drain/backpressure path and the reassembly
    // path both run. A framing bug shows up as a truncated or corrupted block,
    // which the CID check turns into a hard failure rather than a silent one.
    const big = new Uint8Array(100 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff
    const cid = await b.store.put(big)

    const fetched = await a.blockstore.get(cid)
    expect(fetched).toEqual(big)
    expect((await blockCid(fetched!)).equals(cid)).toBe(true)
    expect(a.blockstore.rejected).toBe(0)
  }, 30_000)
})

describe('NET-01 — a redundant job with every execution remote', () => {
  it('completes 4 shards at R=2 across two worker nodes', async () => {
    const [submitter, w1, w2] = await Promise.all([startNode('s'), startNode('w1'), startNode('w2')])
    await Promise.all([submitter.dial(w1.multiaddrs[0]!), submitter.dial(w2.multiaddrs[0]!)])

    // Only the submitter holds the module. The workers have empty stores and must
    // pull it — this is "code moves to data", over a socket.
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    expect(await w1.store.has(moduleCid)).toBe(false)
    expect(await w2.store.has(moduleCid)).toBe(false)

    const executors = [
      new RemoteExecutor(w1.peerId, submitter.rpc),
      new RemoteExecutor(w2.peerId, submitter.rpc),
    ]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    expect(
      result.job.shards.map((s) => (s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1)),
    ).toEqual([0, 1, 2, 3])

    // Every shard agreed, and the agreeing nodes are the two remote peer ids —
    // proof the work actually happened on the other machines.
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.replicas).toBe(2)
      expect([...shard.verification.agreeing].sort()).toEqual([w1.peerId, w2.peerId].sort())
    }

    // R=2 over 4 shards is exactly 2x the useful work.
    expect(result.job.verificationMultiplier).toBeCloseTo(2, 6)

    // Blocks crossed the wire: the module once each despite 4 concurrent shards,
    // plus one input block per shard.
    for (const worker of [w1, w2]) {
      expect(await worker.store.has(moduleCid)).toBe(true)
      expect(worker.blockstore.fetched).toBe(1 + 4)
      expect(worker.blockstore.rejected).toBe(0)
    }
  }, 60_000)

  it('degrades to a reported failure when a worker goes away mid-job', async () => {
    const [submitter, w1, w2] = await Promise.all([startNode('s'), startNode('w1'), startNode('w2')])
    await Promise.all([submitter.dial(w1.multiaddrs[0]!), submitter.dial(w2.multiaddrs[0]!)])
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    // Stop one worker before dispatch. Its replica must fail, and because R=2
    // leaves one surviving execution the shard reports agreement at replicas: 1 —
    // never a thrown job, and never a claim of verification it did not achieve.
    await w2.stop()

    const executors = [
      new RemoteExecutor(w1.peerId, submitter.rpc),
      new RemoteExecutor(w2.peerId, submitter.rpc),
    ]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const verification = result.job.shards[0]!.verification
    expect(verification.status).toBe('agreed')
    if (verification.status !== 'agreed') return
    expect(verification.replicas).toBe(1)
    expect(verification.agreeing).toEqual([w1.peerId])
  }, 60_000)
})

describe('NET-01 — persistence across a restart', () => {
  it('keeps blocks written by one process retrievable by CID after a restart', async () => {
    const [submitter, worker] = await Promise.all([startNode('s'), startNode('w')])
    await submitter.dial(worker.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(worker.peerId, submitter.rpc)]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      submitter.store,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)

    const resultCids = result.job.shards.map((s) =>
      s.verification.status === 'agreed' ? s.verification.resultCid : null,
    )
    expect(resultCids.every((c) => c !== null)).toBe(true)

    // The directory this test handed to `startNode`, not one read back off the node.
    // `FabricNode.store` is typed as the `Blockstore` port, so there is no
    // `.directory` to ask for — which is the point: nothing outside the factory gets
    // to know, or branch on, which adapter is behind it.
    const workerDir = join(workdir, 'w')
    const sizeBeforeRestart = worker.store.size
    expect(sizeBeforeRestart).toBeGreaterThan(0)

    // Full stop, then reopen the same directory — a genuinely new store object
    // with no in-memory state carried over.
    await worker.stop()
    const reopened = await FsBlockstore.open(workerDir)

    expect(reopened.size).toBe(sizeBeforeRestart)
    // The module the worker pulled over the wire is still there, still addressed
    // by the CID the submitter computed.
    const persisted = await reopened.get(moduleCid)
    expect(persisted).toEqual(MODULE_WRITES_PARTITION)

    // And the submitter's own results survived on its side too.
    for (const cid of resultCids) {
      if (cid === null) continue
      expect(await submitter.store.has(cid)).toBe(true)
    }
  }, 60_000)
})
