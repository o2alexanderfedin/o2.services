import { MemoryBlockstore, MemoryNetwork, WasmExecutor, delegate, submitJob } from '@o2/core'
import type { CanonicalValue, Executor, Task } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import. `@o2/core`'s export map exposes only its public
// entry, and adding a fixtures export would modify the kernel package — which
// this phase must leave byte-for-byte unchanged. Reaching the file directly
// keeps the fixture DRY without touching the package it lives in.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import {
  FetchingBlockstore,
  RemoteExecutor,
  RpcBlockSource,
  RpcEndpoint,
  blockCid,
  encodeRequest,
  parseRequest,
  serveAgent,
} from './index.ts'
import type { BlockSource } from './index.ts'

/** A stable CID for encoding round-trips, where the content is irrelevant. */
const FIXED_CID = CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')

/** Read the 4-byte little-endian partition index the fixture emits. */
function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * A two-node fabric on the in-process transport.
 *
 * Deliberately exercises the *same* `RemoteExecutor` / `serveAgent` code the real
 * network uses. Only the transport differs, so a bug in the distributed logic
 * fails here — deterministically, with no sockets — instead of intermittently in
 * the process-spawning test.
 */
async function twoNodeFabric(options: { readonly workers: number } = { workers: 1 }) {
  const network = new MemoryNetwork()

  const originStore = new MemoryBlockstore()
  const moduleCid = await originStore.put(MODULE_WRITES_PARTITION)

  const originRpc = new RpcEndpoint(network.connect('origin'), { timeoutMs: 5_000 })
  // The origin serves blocks. Its executor is never dispatched to in these tests;
  // every task crosses the wire.
  serveAgent({
    rpc: originRpc,
    executor: new WasmExecutor({ nodeId: 'origin', blockstore: originStore }),
    blockstore: originStore,
  })

  const workers: { id: string; rpc: RpcEndpoint; store: FetchingBlockstore }[] = []
  for (let i = 0; i < options.workers; i++) {
    const id = `w${i}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
    // Empty local store: this node has never seen the module or any input, and
    // must pull both from the origin.
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['origin']),
    )
    serveAgent({ rpc, executor: new WasmExecutor({ nodeId: id, blockstore: store }), blockstore: store })
    workers.push({ id, rpc, store })
  }

  const close = () => {
    originRpc.close()
    for (const w of workers) w.rpc.close()
  }

  return { network, originStore, originRpc, moduleCid, workers, close }
}

describe('RpcEndpoint', () => {
  it('correlates a reply with its request', async () => {
    const network = new MemoryNetwork()
    const a = new RpcEndpoint(network.connect('a'), { timeoutMs: 5_000 })
    const b = new RpcEndpoint(network.connect('b'), { timeoutMs: 5_000 })
    try {
      b.serve(async (from, body) => ({ echoed: body, sawFrom: from }))
      const reply = await a.request('b', { n: 41 })
      expect(reply).toEqual({ echoed: { n: 41 }, sawFrom: 'a' })
    } finally {
      a.close()
      b.close()
    }
  })

  it('keeps concurrent requests distinct', async () => {
    const network = new MemoryNetwork()
    const a = new RpcEndpoint(network.connect('a'), { timeoutMs: 5_000 })
    const b = new RpcEndpoint(network.connect('b'), { timeoutMs: 5_000 })
    try {
      b.serve(async (_from, body) => {
        const n = (body as { n: number }).n
        // Reply out of order — later requests answer first.
        await new Promise((r) => setTimeout(r, (5 - n) * 5))
        return { doubled: n * 2 }
      })
      const replies = await Promise.all([1, 2, 3, 4].map((n) => a.request('b', { n })))
      expect(replies).toEqual([{ doubled: 2 }, { doubled: 4 }, { doubled: 6 }, { doubled: 8 }])
    } finally {
      a.close()
      b.close()
    }
  })

  it('times out when the peer never answers', async () => {
    const network = new MemoryNetwork()
    const a = new RpcEndpoint(network.connect('a'), { timeoutMs: 50 })
    network.connect('silent') // registered, but serves nothing
    try {
      await expect(a.request('silent', { hello: true })).rejects.toThrow(/timed out/)
    } finally {
      a.close()
    }
  })

  it('reports a send failure rather than hanging', async () => {
    const network = new MemoryNetwork()
    const a = new RpcEndpoint(network.connect('a'), { timeoutMs: 5_000 })
    try {
      await expect(a.request('nobody', {})).rejects.toThrow(/unknown peer|send/)
    } finally {
      a.close()
    }
  })

  it('rejects in-flight requests when closed', async () => {
    const network = new MemoryNetwork()
    const a = new RpcEndpoint(network.connect('a'), { timeoutMs: 5_000 })
    network.connect('silent')
    const pending = a.request('silent', {})
    a.close()
    await expect(pending).rejects.toThrow(/closed/)
  })

  it('survives a peer sending an undecodable frame', async () => {
    const network = new MemoryNetwork()
    const transport = network.connect('a')
    const a = new RpcEndpoint(transport, { timeoutMs: 50 })
    const b = network.connect('b')
    try {
      a.serve(async () => ({ ok: true }))
      // Not DAG-CBOR at all. Must be dropped, not thrown out of the delivery path.
      await b.send('a', new Uint8Array([0xff, 0xff, 0xff]))
      // The endpoint still works afterwards.
      const c = new RpcEndpoint(network.connect('c'), { timeoutMs: 5_000 })
      try {
        expect(await c.request('a', {})).toEqual({ ok: true })
      } finally {
        c.close()
      }
    } finally {
      a.close()
    }
  })
})

describe('serveAgent', () => {
  it('answers a malformed request with an error rather than crashing', async () => {
    const fabric = await twoNodeFabric()
    try {
      const reply = await fabric.originRpc.request('origin', { kind: 'nonsense' })
      expect(reply).toEqual({ kind: 'error', reason: 'malformed request' })
    } finally {
      fabric.close()
    }
  })

  it('reports a block it does not have as absent, not as an error', async () => {
    const fabric = await twoNodeFabric()
    try {
      const absent = await blockCid(new Uint8Array([9, 9, 9]))
      const reply = await fabric.originRpc.request('origin', { kind: 'block', cid: absent })
      expect(reply).toEqual({ kind: 'block', found: false })
    } finally {
      fabric.close()
    }
  })
})

describe('FetchingBlockstore', () => {
  it('refuses a block whose bytes do not hash to the requested CID', async () => {
    const wanted = await blockCid(new Uint8Array([1, 2, 3]))
    const liar: BlockSource = {
      async fetch() {
        return new Uint8Array([4, 5, 6]) // different bytes, wrong hash
      },
    }
    const store = new FetchingBlockstore(new MemoryBlockstore(), liar)

    expect(await store.get(wanted)).toBeUndefined()
    expect(store.rejected).toBe(1)
    expect(store.fetched).toBe(0)
    // Crucially, the bad bytes were never stored.
    expect(store.size).toBe(0)
  })

  it('collapses concurrent requests for the same CID into one fetch', async () => {
    const bytes = new Uint8Array([7, 7, 7, 7])
    const cid = await blockCid(bytes)
    let calls = 0
    const source: BlockSource = {
      async fetch() {
        calls += 1
        await new Promise((r) => setTimeout(r, 10))
        return bytes
      },
    }
    const store = new FetchingBlockstore(new MemoryBlockstore(), source)

    const results = await Promise.all([store.get(cid), store.get(cid), store.get(cid), store.get(cid)])
    expect(calls).toBe(1)
    expect(store.fetched).toBe(1)
    for (const r of results) expect(r).toEqual(bytes)
  })

  it('does not go to the network for `has`', async () => {
    let calls = 0
    const source: BlockSource = {
      async fetch() {
        calls += 1
        return undefined
      },
    }
    const store = new FetchingBlockstore(new MemoryBlockstore(), source)
    expect(await store.has(await blockCid(new Uint8Array([1])))).toBe(false)
    expect(calls).toBe(0)
  })
})

describe('RemoteExecutor', () => {
  it('runs a task on another node, pulling module and input over the wire', async () => {
    const fabric = await twoNodeFabric({ workers: 1 })
    try {
      const worker = fabric.workers[0]!
      const inputCid = await fabric.originStore.put(new Uint8Array([0x80])) // dag-cbor []
      const task: Task = { moduleCid: fabric.moduleCid, inputCid, partitionIndex: 2, partitionCount: 4 }

      const remote = new RemoteExecutor(worker.id, fabric.originRpc)
      const outcome = await remote.execute(task)

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(partitionOf(outcome.output)).toBe(2)
      // The worker started empty, so both the module and the input crossed the wire.
      expect(worker.store.fetched).toBe(2)
      expect(worker.store.rejected).toBe(0)
    } finally {
      fabric.close()
    }
  })

  it('reports an unreachable node as a failed executor, not a thrown job', async () => {
    const fabric = await twoNodeFabric()
    try {
      const inputCid = await fabric.originStore.put(new Uint8Array([0x80]))
      const remote = new RemoteExecutor('does-not-exist', fabric.originRpc)
      const outcome = await remote.execute({
        moduleCid: fabric.moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain('does-not-exist')
    } finally {
      fabric.close()
    }
  })

  it('carries the remote node id, so verification names the right machine', async () => {
    const fabric = await twoNodeFabric({ workers: 1 })
    try {
      const remote = new RemoteExecutor('w0', fabric.originRpc)
      expect(remote.nodeId).toBe('w0')
    } finally {
      fabric.close()
    }
  })
})

describe('a whole job across nodes', () => {
  it('completes 4 shards at R=2 with every execution remote', async () => {
    const fabric = await twoNodeFabric({ workers: 2 })
    try {
      const executors = fabric.workers.map((w) => new RemoteExecutor(w.id, fabric.originRpc))
      const result = await submitJob(
        {
          moduleCid: fabric.moduleCid,
          shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }],
          executors,
          redundancy: 2,
        },
        fabric.originStore,
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.job.complete).toBe(true)
      expect(result.job.shards.map((s) => (s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1))).toEqual([0, 1, 2, 3])

      // Both workers agreed on every shard, and each shard names two nodes.
      for (const shard of result.job.shards) {
        expect(shard.verification.status).toBe('agreed')
        if (shard.verification.status !== 'agreed') continue
        expect(shard.verification.replicas).toBe(2)
        expect([...shard.verification.agreeing].sort()).toEqual(['w0', 'w1'])
      }

      // Every worker pulled the module exactly once despite 4 concurrent shards,
      // then one block per shard input it was assigned.
      for (const w of fabric.workers) {
        expect(w.store.fetched).toBe(1 + 4)
        expect(w.store.rejected).toBe(0)
      }
    } finally {
      fabric.close()
    }
  })

  it('surfaces disagreement with the dissenting remote node named', async () => {
    const fabric = await twoNodeFabric({ workers: 1 })
    try {
      const honest = new RemoteExecutor(fabric.workers[0]!.id, fabric.originRpc)
      // A liar that is otherwise a perfectly well-behaved Executor.
      const liar: Executor = {
        nodeId: 'liar',
        async execute() {
          return { ok: true, output: { p: new Uint8Array([9, 9, 9, 9]) }, fuelUsed: 1 }
        },
      }

      const result = await submitJob(
        { moduleCid: fabric.moduleCid, shards: [{ a: 0 }], executors: [honest, liar], redundancy: 2 },
        fabric.originStore,
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.job.complete).toBe(false)
      const verification = result.job.shards[0]!.verification
      expect(verification.status).toBe('disagreed')
      if (verification.status !== 'disagreed') return
      expect(verification.partitions).toHaveLength(2)
      expect(verification.partitions.flatMap((p) => [...p.nodes]).sort()).toEqual(['liar', 'w0'])
    } finally {
      fabric.close()
    }
  })
})

describe('protocol validation', () => {
  it('refuses a partition index outside its own count', async () => {
    const fabric = await twoNodeFabric()
    try {
      const reply = await fabric.originRpc.request('origin', {
        kind: 'exec',
        moduleCid: fabric.moduleCid,
        inputCid: fabric.moduleCid,
        partitionIndex: 7,
        partitionCount: 4,
      })
      expect(reply).toEqual({ kind: 'error', reason: 'malformed request' })
    } finally {
      fabric.close()
    }
  })

  it('refuses a request whose CIDs are not CIDs', async () => {
    const fabric = await twoNodeFabric()
    try {
      const reply = await fabric.originRpc.request('origin', {
        kind: 'exec',
        moduleCid: 'not-a-cid',
        inputCid: 'also-not',
        partitionIndex: 0,
        partitionCount: 1,
      })
      expect(reply).toEqual({ kind: 'error', reason: 'malformed request' })
    } finally {
      fabric.close()
    }
  })

  it('round-trips a CID through the wire encoding', async () => {
    const cid = await blockCid(new Uint8Array([1, 2, 3]))
    const parsed = CID.parse(cid.toString())
    expect(parsed.equals(cid)).toBe(true)
  })
})

describe('AUTH-03 — a task is refused before the module is instantiated', () => {
  it('never calls the executor when the capability chain is missing', async () => {
    const network = new MemoryNetwork()
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const inputCid = await store.put(new Uint8Array([0x80]))

    // The ordering is the whole requirement, so the test watches for execution
    // rather than only for the refusal: a node that runs the module and *then*
    // returns "unauthorized" has already read the owner's data.
    let executed = 0
    const watched: Executor = {
      nodeId: 'w0',
      async execute() {
        executed += 1
        return { ok: true, output: null, fuelUsed: 1 }
      },
    }

    const workerRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: 5_000 })
    serveAgent({
      rpc: workerRpc,
      executor: watched,
      blockstore: store,
      authorize: ({ capability }) =>
        capability.length === 0 ? 'no capability chain supplied' : null,
    })

    const callerRpc = new RpcEndpoint(network.connect('caller'), { timeoutMs: 5_000 })
    try {
      const outcome = await new RemoteExecutor('w0', callerRpc).execute({
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })

      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain('unauthorized')
      expect(outcome.reason).toContain('no capability chain')
      // The point of the test.
      expect(executed).toBe(0)
    } finally {
      callerRpc.close()
      workerRpc.close()
    }
  })

  it('runs the task when the authorizer approves', async () => {
    const network = new MemoryNetwork()
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const inputCid = await store.put(new Uint8Array([0x80]))

    const workerRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: 5_000 })
    serveAgent({
      rpc: workerRpc,
      executor: new WasmExecutor({ nodeId: 'w0', blockstore: store }),
      blockstore: store,
      authorize: () => null,
    })

    const callerRpc = new RpcEndpoint(network.connect('caller'), { timeoutMs: 5_000 })
    try {
      const outcome = await new RemoteExecutor('w0', callerRpc).execute({
        moduleCid,
        inputCid,
        partitionIndex: 3,
        partitionCount: 4,
      })
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(partitionOf(outcome.output)).toBe(3)
    } finally {
      callerRpc.close()
      workerRpc.close()
    }
  })

  it('carries a capability chain across the wire intact', async () => {
    const priv = new Uint8Array(32).fill(7)
    const chain = [
      delegate(priv, {
        ownerId: 'alice',
        audience: 'worker-key',
        abilities: ['execute'] as const,
        expiresAt: 2_000_000_000_000,
      }),
    ]

    // Round-tripping matters because a signature is over exact bytes: a field
    // reordered or a number widened in transit invalidates the chain.
    const encoded = encodeRequest({
      kind: 'exec',
      task: { moduleCid: FIXED_CID, inputCid: FIXED_CID, partitionIndex: 0, partitionCount: 1 },
      capability: chain,
    })
    const parsed = parseRequest(encoded)

    expect(parsed).not.toBeNull()
    if (parsed === null || parsed.kind !== 'exec') return
    expect(parsed.capability).toEqual(chain)
  })

  it('refuses a request whose chain is malformed, rather than truncating it', async () => {
    // Dropping the unparseable links and proceeding with the rest would let an
    // attacker prune a chain down to a prefix that happens to verify.
    const parsed = parseRequest({
      kind: 'exec',
      moduleCid: FIXED_CID,
      inputCid: FIXED_CID,
      partitionIndex: 0,
      partitionCount: 1,
      capability: [{ issuer: 'a', audience: 'b', ownerId: 'alice', abilities: ['nope'], expiresAt: 1, signature: 'x' }],
    })
    expect(parsed).toBeNull()
  })
})
