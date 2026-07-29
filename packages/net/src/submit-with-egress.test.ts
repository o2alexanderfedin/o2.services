import {
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  encodeCanonical,
  guardSovereignty,
  submitJob,
} from '@o2/core'
import type { JobSpec, NodeDescriptor } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { RpcBlockSource, serveAgent } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
import { EgressGuard } from './egress.ts'
import { RemoteExecutor } from './remote-executor.ts'
import { RpcEndpoint } from './rpc.ts'
import { registerSovereignInputs } from './sovereign-egress.ts'
import { submitJobWithEgress } from './submit-with-egress.ts'

/**
 * `submitJobWithEgress` — a per-job, delta-sliced manifest reachable from the call
 * that ran the job, over the full production stack: `registerSovereignInputs`
 * composed around `guardSovereignty`, served through an `EgressGuard`-wrapped
 * transport, dispatched via `submitJob` (unmodified). No test here hand-calls
 * `guard.guard()`.
 */

const OWNER_ID = 'alice'
const SEED = 'seed'

interface Fabric {
  readonly seedStore: MemoryBlockstore
  readonly requestorRpc: RpcEndpoint
  readonly nodeId: string
  readonly guard: EgressGuard
  readonly local: MemoryBlockstore
  readonly executors: readonly RemoteExecutor[]
  readonly nodes: readonly NodeDescriptor[]
  close(): void
}

/**
 * One owner node plus the seed node its `RpcBlockSource` fetches from — the same
 * two-node shape `sovereign-execution.test.ts`'s `ownerFabric` uses, trimmed to what
 * this file's three behaviors need.
 */
function buildFabric(nodeId: string): Fabric {
  const network = new MemoryNetwork()
  const seedStore = new MemoryBlockstore()
  const seedRpc = new RpcEndpoint(network.connect(SEED), { timeoutMs: 5_000 })
  serveAgent({
    rpc: seedRpc,
    executor: new WasmExecutor({ nodeId: SEED, blockstore: seedStore }),
    blockstore: seedStore,
    // The seed's sends go out over the raw transport, so nothing is registered
    // against them. The owner node below is where the tap lives.
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  const guard = new EgressGuard(network.connect(nodeId), OWNER_ID)
  const rpc = new RpcEndpoint(guard, { timeoutMs: 5_000 })
  const local = new MemoryBlockstore()
  const store = new FetchingBlockstore(local, new RpcBlockSource(rpc, () => [SEED]))
  const executor = registerSovereignInputs(
    guardSovereignty(new WasmExecutor({ nodeId, blockstore: store }), {
      ownerId: OWNER_ID,
      canExecuteSovereign: true,
    }),
    { blockstore: local, guard },
  )
  serveAgent({
    rpc,
    executor,
    blockstore: store,
    // The owner node's own tap — the guard `rpc` is built over.
    egress: guard,
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  const requestorRpc = new RpcEndpoint(network.connect(`requestor-${nodeId}`), { timeoutMs: 5_000 })

  return {
    seedStore,
    requestorRpc,
    nodeId,
    guard,
    local,
    executors: [new RemoteExecutor(nodeId, requestorRpc)],
    nodes: [{ nodeId, ownerId: OWNER_ID, canExecuteSovereign: true, load: 0 }],
    close() {
      seedRpc.close()
      requestorRpc.close()
      rpc.close()
    },
  }
}

describe('submitJobWithEgress — a job’s manifest, reachable from the call that ran it', () => {
  it('returns a clean, non-empty manifest for a sovereign shard that legitimately pushes down', async () => {
    const fabric = buildFabric('alice-1')
    try {
      const moduleCid = await fabric.seedStore.put(MODULE_WRITES_PARTITION)

      const shardValue = { ssn: '123-45-6789', salary: 87_000, dob: '1984-02-29' }
      const rawEncoded = encodeCanonical(shardValue)
      if (!rawEncoded.ok) throw new Error('fixture not encodable')
      // The owner-pinned precondition registerSovereignInputs documents: the input
      // must already be resident locally, not fetched over the network in order to
      // be declared sovereign. Pre-seeding `local` with the identical canonical
      // bytes submitJob will itself compute the CID for is what makes registration
      // actually fire here, rather than silently skip.
      await fabric.local.put(rawEncoded.bytes)

      const spec: JobSpec = {
        moduleCid,
        shards: [{ value: shardValue, label: 'sovereign', ownerId: OWNER_ID }],
        executors: fabric.executors,
        nodes: fabric.nodes,
        redundancy: 1,
      }

      const result = await submitJobWithEgress(spec, fabric.seedStore, [fabric.guard])
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const shard = result.job.shards[0]
      expect(shard?.verification.status).toBe('agreed')
      if (shard?.verification.status !== 'agreed') return

      const outputEncoded = encodeCanonical(shard.verification.output)
      if (!outputEncoded.ok) throw new Error('output not encodable')
      // DATA-07 pushdown: what left the node is smaller than the raw sovereign
      // input it was computed from.
      expect(outputEncoded.bytes.length).toBeLessThan(rawEncoded.bytes.length)

      // The empty-manifest trap, guarded explicitly (13-CONTEXT.md decision 3): a
      // clean run must show real, non-empty traffic, not an absence of traffic.
      const manifest = result.manifests[0]
      expect(manifest?.violations).toEqual([])
      expect(manifest?.entries.length).toBeGreaterThan(0)
      expect(manifest?.totalBytes).toBeGreaterThan(0)
    } finally {
      fabric.close()
    }
  })

  it('slices two sequential jobs on the same guard without double-counting', async () => {
    const fabric = buildFabric('alice-2')
    try {
      const moduleCid = await fabric.seedStore.put(MODULE_WRITES_PARTITION)

      const specFor = (value: unknown): JobSpec => ({
        moduleCid,
        shards: [{ value: value as never, label: 'public' }],
        executors: fabric.executors,
        nodes: fabric.nodes,
        redundancy: 1,
      })

      const first = await submitJobWithEgress(specFor({ n: 1 }), fabric.seedStore, [fabric.guard])
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.manifests[0]?.entries.length).toBeGreaterThan(0)
      const firstCount = first.manifests[0]?.entries.length as number

      const second = await submitJobWithEgress(specFor({ n: 2 }), fabric.seedStore, [fabric.guard])
      expect(second.ok).toBe(true)
      if (!second.ok) return

      // The second manifest reflects only its own dispatch, not the cumulative
      // total the guard has recorded since it was constructed.
      expect(second.manifests[0]?.entries.length).toBeGreaterThan(0)
      expect(fabric.guard.manifest.entries.length).toBe(firstCount + (second.manifests[0]?.entries.length as number))
    } finally {
      fabric.close()
    }
  })

  it('passes a validation failure through exactly, with no manifests field', async () => {
    const fabric = buildFabric('alice-3')
    try {
      const spec: JobSpec = {
        moduleCid: await fabric.seedStore.put(MODULE_WRITES_PARTITION),
        shards: [],
        executors: fabric.executors,
        nodes: fabric.nodes,
        redundancy: 1,
      }

      const expected = await submitJob(spec, fabric.seedStore)
      const result = await submitJobWithEgress(spec, fabric.seedStore, [fabric.guard])

      expect(result).toEqual(expected)
      expect(result.ok).toBe(false)
      expect('manifests' in result).toBe(false)
    } finally {
      fabric.close()
    }
  })
})
