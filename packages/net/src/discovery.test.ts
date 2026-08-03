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
  const authority = new EnrollmentAuthority({
    providerPrivateKey: providerKey,
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const trustedIssuers = new Set([authority.issuerKey])
  const userPriv = new Uint8Array(32).fill(61)
  const userKey = toHex(ed25519.getPublicKey(userPriv))

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
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index,
    enroll: 'issues-no-certificates',
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
      requestEnrollment(priv, userPriv, {
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
      // 8, not 4: at 4, four workers dispatched four concurrent shards sat
      // exactly on the boundary, and a boundary that happens to hold is not a
      // property anybody chose.
      maxConcurrent: options.maxConcurrent ?? 8,
    })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: nodeKey, blockstore: store }),
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      enroll: 'issues-no-certificates',
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
    // The parameter type here is the user key alone, not a whole certificate, so this
    // helper has nothing to carry. `discoverCandidates` is the producer that does.
    certificate: 'carries-no-certificate',
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
          return new RemoteExecutor(nodeId, fabric.requestorRpc, 'dispatches-unauthenticated').execute({
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

/**
 * The wire-side offer is **advisory**. Since Phase 13.1 it reads the node's
 * counters through `LocalCapacity.would` and reserves nothing; the reservation
 * lives on `serveAgent`'s `exec` branch, where the work does. So a test that
 * wants a node to be busy has to *make* it busy — filling its slots directly is
 * not a fixture shortcut here, it is the only way a probe can see a full node.
 * **That sentence is unchanged and still true.**
 *
 * What owner ruling **D2** (2026-08-01) added is what the answer now *carries*:
 * the node's slot count and in-flight count, from which the requestor bounds its
 * **own** placement across the shards of one job. That bound is advisory too — it
 * lives in one requestor's memory, nothing is reserved by answering, and a
 * requestor that ignored the figure would over-commit exactly as before. The
 * authoritative refusal is still the `exec` branch's, which reserves for real.
 *
 * `d: 4` against four candidates makes the sample the whole pool on every
 * iteration, so the probe order is `placeWithOffers`' documented load-then-id
 * tie-break — ascending `nodeId`, every load being 0. That is what lets the case
 * below occupy exactly the nodes that will be probed first and assert an exact
 * rejection count instead of an inequality.
 *
 * The requestor's bound never pre-empts a node's own refusal, because it is built
 * only from answers already received. Nothing has been learned about any node
 * before the first offer of the first shard, so every candidate is still probed —
 * which is why `'re-picks onto the one node that did not refuse'` below is
 * unedited, and why its `probed` count is load-bearing rather than incidental.
 */
describe('SCHED-03 over the wire — a node refuses for itself', () => {
  it('re-picks onto the one node that did not refuse', async () => {
    const fabric = await fabricOf({ workers: 4, maxConcurrent: 1 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: fabric.trustedIssuers,
        now: NOW,
      })
      expect(found.executors).toHaveLength(4)

      // Occupy the three that will be probed first, leaving the last one free.
      const order = [...found.executors.map((e) => e.nodeKey)].sort((a, b) => a.localeCompare(b))
      const free = order[3] as string
      for (const nodeKey of order.slice(0, 3)) {
        const worker = fabric.workers.find((w) => w.nodeKey === nodeKey)
        expect(worker?.capacity.offer({ shardId: `held-${nodeKey}`, nodeId: nodeKey }).accepted).toBe(
          true,
        )
      }

      const placements = await planWithOffers(
        [{ shardId: 's0', label: 'public', redundancy: 1 }],
        descriptorsOf(found.executors),
        { d: 4, admit: rpcAdmission(fabric.requestorRpc) },
      )

      const placement = placements[0]
      expect(placement?.status).toBe('placed')
      if (placement?.status !== 'placed') return
      expect(placement.nodeIds).toEqual([free])
      expect(placement.probed).toBe(4)
      expect(placement.rejections).toHaveLength(3)
      // Every refusal came from the node itself, in its own words.
      expect(placement.rejections.every((r) => r.reason.includes('over-committed'))).toBe(true)
      expect(placement.rejections.map((r) => r.nodeId).sort((a, b) => a.localeCompare(b))).toEqual(
        order.slice(0, 3),
      )
    } finally {
      fabric.close()
    }
  })

  it('reports the shard unplaceable when every node refuses', async () => {
    const fabric = await fabricOf({ workers: 4, maxConcurrent: 1 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: fabric.trustedIssuers,
        now: NOW,
      })

      for (const worker of fabric.workers) {
        expect(
          worker.capacity.offer({ shardId: `held-${worker.nodeKey}`, nodeId: worker.nodeKey })
            .accepted,
        ).toBe(true)
      }

      const placements = await planWithOffers(
        [{ shardId: 's0', label: 'public', redundancy: 1 }],
        descriptorsOf(found.executors),
        { d: 4, admit: rpcAdmission(fabric.requestorRpc) },
      )

      const stalled = placements[0]
      expect(stalled?.status).toBe('unplaceable')
      if (stalled?.status !== 'unplaceable') return
      expect(stalled.probed).toBe(4)
      expect(stalled.rejections).toHaveLength(4)
      expect(stalled.reason).toContain('refused')
    } finally {
      fabric.close()
    }
  })

  it('bounds placement across shards — one lands on a 1-slot node, three are held back', async () => {
    // **Criterion 2c, and the history of this case is the point of keeping it.**
    //
    // It used to assert the opposite, under this same fixture, and it said so:
    // `placeWithOffers` shrinks `pool` within one shard only and `pool` is rebuilt
    // per request, so once Phase 13.1 moved the offer branch to `would` — which
    // reserves nothing — the cross-shard bound was gone and all four shards landed
    // on `only`. That was recorded as a **consequence**, never as a desired
    // behaviour, and it was written to turn red when the bound was rebuilt.
    //
    // Owner ruling **D2** (2026-08-01) rebuilt it: the offer *answer* now publishes
    // the node's slot count and in-flight count, and the requestor bounds its own
    // placement from what it was told. So this case now asserts the bound.
    //
    // The bound is **advisory**. Nothing is reserved by answering, and a requestor
    // that ignored the published figure would over-commit exactly as before — it
    // would then be refused for real by the `exec` branch's SCHED-06 admission,
    // which is the authoritative bound and did not move.
    const fabric = await fabricOf({ workers: 1, maxConcurrent: 1 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: fabric.trustedIssuers,
        now: NOW,
      })
      const only = found.executors[0]?.nodeKey as string

      const shards = [0, 1, 2, 3].map((i) => ({
        shardId: `s${i}`,
        label: 'public' as const,
        redundancy: 1,
      }))
      const placements = await planWithOffers(shards, descriptorsOf(found.executors), {
        d: 2,
        admit: rpcAdmission(fabric.requestorRpc),
      })

      expect(placements).toHaveLength(4)
      // One placed where four were placed before, over the identical fixture.
      expect(placements.flatMap((p) => (p.status === 'placed' ? p.nodeIds : []))).toEqual([only])

      const held = placements.filter((p) => p.status === 'unplaceable')
      expect(held).toHaveLength(3)
      for (const placement of held) {
        if (placement.status !== 'unplaceable') continue
        // Names the bound, not "no nodes available".
        expect(placement.reason).toContain('headroom')
        // The read count, not the reason string, is what places the bound: these
        // three shards cost **no** probe at all, which is what distinguishes a
        // requestor that held back from one that asked and was refused.
        expect(placement.probed).toBe(0)
        // And a node that was never asked never refused — `Rejection.reason` is
        // fixed as the node's own words.
        expect(placement.rejections).toStrictEqual([])
      }
      // Retained verbatim, and its meaning is what changed: this used to say the
      // offer branch reserves nothing *and therefore bounds nothing*. It now says
      // the offer branch **still** reserves nothing, and the bound is the
      // requestor's own.
      const worker = fabric.workers[0] as Worker
      expect(worker.capacity.inFlight).toBe(0)
      expect(worker.capacity.peakInFlight).toBe(0)
    } finally {
      fabric.close()
    }
  })

  it('places four shards across four 1-slot workers, one each', async () => {
    // The bound has to be shown not refusing as well as refusing, or it is
    // indistinguishable from a placer that stopped working.
    const fabric = await fabricOf({ workers: 4, maxConcurrent: 1 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors({ inputCid: fabric.inputCid }, index, {
        trustedIssuers: fabric.trustedIssuers,
        now: NOW,
      })
      expect(found.executors).toHaveLength(4)

      const shards = [0, 1, 2, 3].map((i) => ({
        shardId: `s${i}`,
        label: 'public' as const,
        redundancy: 1,
      }))
      const placements = await planWithOffers(shards, descriptorsOf(found.executors), {
        d: 4,
        admit: rpcAdmission(fabric.requestorRpc),
      })

      expect(placements.every((p) => p.status === 'placed')).toBe(true)
      const chosen = placements.flatMap((p) => (p.status === 'placed' ? p.nodeIds : []))
      expect(chosen).toHaveLength(4)
      expect(new Set(chosen).size).toBe(4)
      // Still nothing reserved anywhere, on any of the four.
      for (const worker of fabric.workers) expect(worker.capacity.peakInFlight).toBe(0)
    } finally {
      fabric.close()
    }
  })

  it('publishes its real figures in the offer answer, and still takes nothing', async () => {
    // SCHED-02 / owner ruling D2, read over a real endpoint rather than from
    // `LocalCapacity` directly: the claim is about what crosses the wire.
    const fabric = await fabricOf({ workers: 1, maxConcurrent: 1 })
    try {
      const worker = fabric.workers[0] as Worker

      for (let i = 0; i < 5; i++) {
        const body = await fabric.requestorRpc.request(
          worker.nodeKey,
          encodeRequest({ kind: 'offer', shardId: `probe-${i}` }),
        )
        const answer = parseResponse(body)
        expect(answer?.kind).toBe('offer')
        if (answer?.kind !== 'offer') return
        expect(answer.accepted).toBe(true)
        // The same figures every time, because answering consumes nothing.
        expect(answer.capacity).toStrictEqual({ slots: 1, inFlight: 0 })
      }

      // The seed holds the `'accepts-every-offer'` sentinel — no counters to read,
      // so it states no capacity rather than inventing one.
      const seedBody = await fabric.requestorRpc.request(
        SEED,
        encodeRequest({ kind: 'offer', shardId: 'probe' }),
      )
      const seedAnswer = parseResponse(seedBody)
      expect(seedAnswer?.kind).toBe('offer')
      if (seedAnswer?.kind !== 'offer') return
      expect(seedAnswer.accepted).toBe(true)
      expect(seedAnswer.capacity).toBeNull()

      // The regression Phase 13.1 removed, and this plan promises not to restore.
      expect(worker.capacity.inFlight).toBe(0)
      expect(worker.capacity.peakInFlight).toBe(0)
    } finally {
      fabric.close()
    }
  })

  it('publishes a refusal that says how full, from a node that really is full', async () => {
    const fabric = await fabricOf({ workers: 1, maxConcurrent: 1 })
    try {
      const worker = fabric.workers[0] as Worker
      // A test that wants a busy node has to make it busy — see this block's header.
      expect(worker.capacity.offer({ shardId: 'held', nodeId: worker.nodeKey }).accepted).toBe(true)

      const body = await fabric.requestorRpc.request(
        worker.nodeKey,
        encodeRequest({ kind: 'offer', shardId: 's0' }),
      )
      const answer = parseResponse(body)
      expect(answer?.kind).toBe('offer')
      if (answer?.kind !== 'offer') return
      expect(answer.accepted).toBe(false)
      expect(answer.reason).toContain('over-committed')
      expect(answer.capacity).toStrictEqual({ slots: 1, inFlight: 1 })
    } finally {
      fabric.close()
    }
  })

  it('bounds nothing on a node it could not reach', async () => {
    const fabric = await fabricOf({ workers: 1 })
    try {
      const admit = rpcAdmission(fabric.requestorRpc, { probeTimeoutMs: 200 })
      const answer = await admit({ shardId: 's0', nodeId: 'nobody' })

      expect(answer.accepted).toBe(false)
      // A requestor that learned nothing must not bound on a figure it invented.
      // Defaulting this arm to a zero-slot node would make one dead peer look
      // permanently full to every later shard in the same plan.
      expect(answer.capacity).toBe('states-no-capacity')
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
