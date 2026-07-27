import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  MemoryRecordIndex,
  WasmExecutor,
  discoverExecutors,
  planWithOffers,
  publishCapabilities,
  requestEnrollment,
  toHex,
} from '@o2/core'
import type { CanonicalValue, NodeDescriptor, NodeRecords } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import {
  FetchingBlockstore,
  RemoteExecutor,
  RpcBlockSource,
  RpcEndpoint,
  RpcRecordIndex,
  encodeRequest,
  parseResponse,
  rpcAdmission,
  serveAgent,
} from './index.ts'

/**
 * Phase 6 criterion 1, end to end — SCHED-01, SCHED-02, SCHED-03, NET-06.
 *
 * The claim under test is specifically the *absence* of something: the requestor is
 * handed one bootstrap peer id and nothing else. No executor list, no node ids, no
 * addresses. Everything it dispatches to, it worked out from a data CID.
 *
 * A node's transport id here is its public key, which is what a real peer id is. It
 * means a discovery answer is directly dialable, and it removes the temptation to
 * quietly hand the test a key-to-address map that the production path would not have.
 */

const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000
const SEED = 'seed'
const FEATURES = ['bulk-memory', 'simd128']

function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

interface Worker {
  readonly nodeKey: string
  readonly rpc: RpcEndpoint
  readonly capacity: LocalCapacity
  readonly records: NodeRecords
}

interface Fabric {
  readonly requestorRpc: RpcEndpoint
  readonly workers: readonly Worker[]
  readonly inputCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly moduleCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly trustedIssuers: ReadonlySet<string>
  close(): void
}

/**
 * A fabric where the data lives on the workers and the index lives on a seed.
 *
 * Deliberately the shape the design argues for: the input block is *already* on the
 * nodes that will execute, so discovery moves code to data rather than the reverse.
 */
async function fabricOf(options: { workers: number; maxConcurrent?: number }): Promise<Fabric> {
  const network = new MemoryNetwork()
  const providerKey = new Uint8Array(32).fill(60)
  const authority = new EnrollmentAuthority({ providerPrivateKey: providerKey, maxPerWindow: 100 })
  const trustedIssuers = new Set([authority.issuerKey])
  const userKey = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(61)))

  // The seed holds the module and the record index. It executes nothing here, which
  // is a property of this fixture and not of the node — it serves like any other.
  const seedStore = new MemoryBlockstore()
  const moduleCid = await seedStore.put(MODULE_WRITES_PARTITION)
  const index = new MemoryRecordIndex()
  const seedRpc = new RpcEndpoint(network.connect(SEED), { timeoutMs: 5_000 })
  serveAgent({
    rpc: seedRpc,
    executor: new WasmExecutor({ nodeId: SEED, blockstore: seedStore }),
    blockstore: seedStore,
    authorize: 'serves-unauthenticated',
    index,
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  // One dataset block, held by every worker. This is the CID the requestor queries.
  const inputBytes = new Uint8Array([0x80]) // dag-cbor []
  const inputCid = await seedStore.put(inputBytes)

  const workers: Worker[] = []
  for (let i = 0; i < options.workers; i++) {
    const priv = new Uint8Array(32).fill(70 + i)
    const nodeKey = toHex(ed25519.getPublicKey(priv))

    const enrolled = authority.enrol(
      requestEnrollment(priv, {
        userKey,
        operatorId: `op-${i}`,
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)

    const capabilities = publishCapabilities(priv, {
      features: FEATURES,
      sovereignFor: [],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
    })
    const records: NodeRecords = { certificate: enrolled.certificate, capabilities }

    // The worker already holds the data; it pulls only the module, by CID.
    const local = new MemoryBlockstore()
    await local.put(inputBytes)
    const rpc = new RpcEndpoint(network.connect(nodeKey), { timeoutMs: 5_000 })
    const store = new FetchingBlockstore(local, new RpcBlockSource(rpc, () => [SEED]))
    const capacity = new LocalCapacity({
      nodeId: nodeKey,
      maxConcurrent: options.maxConcurrent ?? 4,
    })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: nodeKey, blockstore: store }),
      blockstore: store,
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      capacity,
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })

    index.provide(inputCid, nodeKey)
    index.publish(records)
    workers.push({ nodeKey, rpc, capacity, records })
  }

  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })

  return {
    requestorRpc,
    workers,
    inputCid,
    moduleCid,
    trustedIssuers,
    close() {
      seedRpc.close()
      requestorRpc.close()
      for (const worker of workers) worker.rpc.close()
    },
  }
}

/** Turn a discovery answer into placement candidates. Load is unknown, so zero. */
const descriptorsOf = (
  executors: readonly { nodeKey: string; certificate: { userKey: string } }[],
): readonly NodeDescriptor[] =>
  executors.map((executor) => ({
    nodeId: executor.nodeKey,
    ownerId: executor.certificate.userKey,
    canExecuteSovereign: false,
    load: 0,
  }))

describe('criterion 1 — a requestor with no peer list runs a job', () => {
  it('discovers, places and dispatches from a data CID alone', async () => {
    const fabric = await fabricOf({ workers: 4 })
    try {
      // The requestor's entire starting knowledge: one bootstrap peer.
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])

      const found = await discoverExecutors(
        { inputCid: fabric.inputCid, requiredFeatures: ['simd128'] },
        index,
        { trustedIssuers: fabric.trustedIssuers, now: NOW },
      )
      expect(found.executors).toHaveLength(4)
      expect(found.excluded).toEqual([])

      const shards = [0, 1, 2, 3].map((i) => ({
        shardId: `s${i}`,
        label: 'public' as const,
        redundancy: 1,
      }))
      const placements = await planWithOffers(shards, descriptorsOf(found.executors), {
        d: 2,
        admit: rpcAdmission(fabric.requestorRpc),
      })
      expect(placements.every((p) => p.status === 'placed')).toBe(true)

      // Dispatch each shard to the node placement chose, and check the answers.
      const outputs = await Promise.all(
        placements.map(async (placement, partitionIndex) => {
          if (placement.status !== 'placed') throw new Error('unplaceable')
          const nodeId = placement.nodeIds[0] as string
          // Every node dispatched to came out of discovery, never from a fixture.
          expect(found.executors.some((e) => e.nodeKey === nodeId)).toBe(true)
          return new RemoteExecutor(nodeId, fabric.requestorRpc).execute({
            moduleCid: fabric.moduleCid,
            inputCid: fabric.inputCid,
            partitionIndex,
            partitionCount: 4,
            // Correction 2: parseRequest now refuses an exec request with no
            // label at the wire boundary.
            label: 'public',
          })
        }),
      )

      expect(outputs.every((o) => o.ok)).toBe(true)
      expect(outputs.map((o) => (o.ok ? partitionOf(o.output) : -1))).toEqual([0, 1, 2, 3])
    } finally {
      fabric.close()
    }
  })

  it('excludes a provider whose certificate the requestor does not trust', async () => {
    const fabric = await fabricOf({ workers: 2 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      // Same fabric, a requestor that pinned a different provider. Everything is
      // reachable and every signature is real; none of it is trusted.
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: new Set(['deadbeef']),
        now: NOW,
      })
      expect(found.providers).toBe(2)
      expect(found.executors).toEqual([])
      expect(found.excluded.map((e) => e.reason.kind)).toEqual([
        'invalid-certificate',
        'invalid-certificate',
      ])
    } finally {
      fabric.close()
    }
  })
})

describe('SCHED-03 over the wire — a node refuses for itself', () => {
  it('re-picks when a node reports it is over-committed', async () => {
    const fabric = await fabricOf({ workers: 4, maxConcurrent: 1 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: fabric.trustedIssuers,
        now: NOW,
      })

      // Fill one node's single slot before placing anything, so a refusal is
      // certain rather than dependent on which node the sampler happens to draw.
      const busy = found.executors[0]?.nodeKey as string
      const filled = fabric.workers.find((w) => w.nodeKey === busy)
      filled?.capacity.offer({ shardId: 'pre-existing', nodeId: busy })

      const shards = [0, 1, 2, 3].map((i) => ({
        shardId: `s${i}`,
        label: 'public' as const,
        redundancy: 1,
      }))
      const placements = await planWithOffers(shards, descriptorsOf(found.executors), {
        d: 2,
        admit: rpcAdmission(fabric.requestorRpc),
      })

      // Three free slots, four shards: three land, one finds nobody. The point is
      // that the job reports it rather than throwing, and that every refusal came
      // from the node itself with its own words.
      const placed = placements.filter((p) => p.status === 'placed')
      expect(placed).toHaveLength(3)
      expect(new Set(placed.flatMap((p) => (p.status === 'placed' ? p.nodeIds : [])))).not.toContain(
        busy,
      )

      const reasons = placements.flatMap((p) => p.rejections.map((r) => r.reason))
      expect(reasons.length).toBeGreaterThan(0)
      expect(reasons.every((reason) => reason.includes('over-committed'))).toBe(true)

      const stalled = placements.find((p) => p.status === 'unplaceable')
      expect(stalled?.status).toBe('unplaceable')
      if (stalled?.status !== 'unplaceable') return
      expect(stalled.reason).toContain('refused')
    } finally {
      fabric.close()
    }
  })

  it('treats an unreachable node as a stated refusal, not a crash', async () => {
    const fabric = await fabricOf({ workers: 3 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: fabric.trustedIssuers,
        now: NOW,
      })

      // A node that was discoverable a moment ago and is now gone — the normal
      // condition in a volunteer fabric, not an exceptional one.
      const gone = found.executors[0]?.nodeKey as string
      fabric.workers.find((w) => w.nodeKey === gone)?.rpc.close()

      const placements = await planWithOffers(
        [{ shardId: 's0', label: 'public', redundancy: 3 }],
        descriptorsOf(found.executors),
        // A short probe deadline is the whole point: the dead node must cost the
        // placement a moment, not the full RPC timeout.
        { d: 2, admit: rpcAdmission(fabric.requestorRpc, { probeTimeoutMs: 200 }) },
      )

      const placement = placements[0]
      expect(placement?.status).toBe('placed')
      if (placement?.status !== 'placed') return
      expect(placement.nodeIds).not.toContain(gone)
      expect(placement.replicas).toBe(2)
      expect(placement.degraded).toBe(true)
      expect(placement.rejections.map((r) => r.nodeId)).toEqual([gone])
      expect(placement.rejections[0]?.reason).toContain('unreachable')
    } finally {
      fabric.close()
    }
  })
})

describe('NET-06 — any node can be asked, and answers truthfully', () => {
  it('answers an empty provider list rather than an error when it holds no index', async () => {
    const fabric = await fabricOf({ workers: 1 })
    try {
      // Workers in this fixture serve no index. Asking one is legitimate and the
      // answer is "I know of none" — which is what lets a fallback chain move on
      // without any node needing to be classified in advance.
      const worker = fabric.workers[0] as Worker
      const body = await fabric.requestorRpc.request(
        worker.nodeKey,
        encodeRequest({ kind: 'providers', cid: fabric.inputCid }),
      )
      const response = parseResponse(body)
      expect(response?.kind).toBe('providers')
      if (response?.kind !== 'providers') return
      expect(response.nodeKeys).toEqual([])

      const records = parseResponse(
        await fabric.requestorRpc.request(
          worker.nodeKey,
          encodeRequest({ kind: 'records', nodeKey: worker.nodeKey }),
        ),
      )
      expect(records?.kind).toBe('records')
      if (records?.kind !== 'records') return
      expect(records.records).toBeNull()
    } finally {
      fabric.close()
    }
  })

  it('round-trips a signed record set across the wire without disturbing its signature', async () => {
    const fabric = await fabricOf({ workers: 1 })
    try {
      const worker = fabric.workers[0] as Worker
      const response = parseResponse(
        await fabric.requestorRpc.request(
          SEED,
          encodeRequest({ kind: 'records', nodeKey: worker.nodeKey }),
        ),
      )
      expect(response?.kind).toBe('records')
      if (response?.kind !== 'records') return
      // Byte-identical after encode/parse. A codec that reordered `relayIds` or
      // dropped a field would still verify against a re-sorted payload, so the
      // equality check is the stronger assertion.
      expect(response.records).toEqual(worker.records)
    } finally {
      fabric.close()
    }
  })
})
