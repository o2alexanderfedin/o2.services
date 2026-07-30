import {
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  canonicalCid,
  encodeCanonical,
  guardSovereignty,
  submitJob,
} from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  ExecutionOutcome,
  Executor,
  JobSpec,
  NodeDescriptor,
  Task,
} from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { RpcBlockSource, serveAgent } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
import { EgressGuard } from './egress.ts'
import { RemoteExecutor } from './remote-executor.ts'
import { RpcEndpoint } from './rpc.ts'
import { takeSovereignHold } from './sovereign-egress.ts'
import { submitJobWithEgress } from './submit-with-egress.ts'

/**
 * `submitJobWithEgress` — a per-job, delta-sliced manifest reachable from the call
 * that ran the job, over the full production stack: `takeSovereignHold`
 * composed around `guardSovereignty`, served through an `EgressGuard`-wrapped
 * transport, dispatched via `submitJob` (unmodified). No test here hand-calls
 * `guard.guard()`.
 *
 * **Two groups, and they are built differently on purpose.** The first (`buildFabric`)
 * exercises the manifest over that whole stack. The second — DATA-10's
 * submitter-side registration — needs to read `guard.registrations` *while
 * `submitJob` is still running*, because the registration is job-scoped and a
 * reading taken after the call returns has already had the `finally` fire on it. The
 * only object in a job with a hook inside that window is the executor, so that group
 * supplies a stub `Executor` that snapshots the guards on entry and returns
 * immediately. It observes nothing about WASM, the wire, or `serveAgent`, and it is
 * not asked to: the two-real-node measurement of what actually crossed is
 * `packages/node/src/sovereign-block-refusal.node.test.ts`. Neither group carries the
 * other's half.
 *
 * The `guard.guard()` rule above holds for both groups. The submitter-side group's
 * registrations come from `submitJobWithEgress` itself, and the one place a serve-side
 * label is produced for comparison, it is produced by calling
 * `takeSovereignHold` — the production path — not by hand.
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
  const executor = guardSovereignty(new WasmExecutor({ nodeId, blockstore: store }), {
    ownerId: OWNER_ID,
    canExecuteSovereign: true,
  })
  serveAgent({
    rpc,
    executor,
    blockstore: store,
    // The owner node's own tap — the guard `rpc` is built over — plus the local-only
    // tier a sovereign input has to be resident in before the serve path declares it.
    egress: { guard, sovereignInputs: local },
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
      // The owner-pinned precondition takeSovereignHold documents: the input
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

/**
 * A sovereign row for the submitter-side group, distinct from every other fixture in
 * this file and in `packages/node`'s node tests.
 *
 * Deliberately not shared: if two cases used one row, either one's registration
 * could satisfy the other's assertion, and a failure to register would be invisible.
 */
const SUBMITTED_ROW: CanonicalValue = {
  ssn: '702-31-5588',
  salary: 74_250,
  dob: '1990-11-04',
  branch: 'north-mill',
}

/** A second sovereign row, for the two-distinct-labels case. */
const OTHER_ROW: CanonicalValue = { ssn: '311-92-4471', salary: 51_900, dob: '1972-06-08' }

/** A public shard's value — the thing that must never be registered. */
const OPEN_ROW: CanonicalValue = { region: 'north-mill', quarter: 'Q3', headcount: 24 }

/**
 * An `Executor` that runs `observe` at the one moment that matters — inside the job.
 *
 * `submitJobWithEgress`'s registration is job-scoped, so `guard.registrations` read
 * after the call has already had the `finally` fire on it and would read empty
 * whether the registration ever happened or not. This is the hook that sees the
 * window, and every "during the job" assertion below is taken through it.
 */
class WatchingExecutor implements Executor {
  readonly nodeId: string
  readonly #observe: () => void

  constructor(nodeId: string, observe: () => void) {
    this.nodeId = nodeId
    this.#observe = observe
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    this.#observe()
    return { ok: true, output: { partition: task.partitionIndex }, fuelUsed: 1 }
  }
}

/** A guard over its own `MemoryNetwork` connection — nothing is ever sent through it. */
function scratchGuard(nodeId: string): EgressGuard {
  return new EgressGuard(new MemoryNetwork().connect(nodeId), OWNER_ID)
}

function soleOwnerNode(nodeId: string): readonly NodeDescriptor[] {
  return [{ nodeId, ownerId: OWNER_ID, canExecuteSovereign: true, load: 0 }]
}

describe('submitJobWithEgress — a submitter does not serve the row it submitted (DATA-10)', () => {
  it('holds the sovereign shard’s input CID on every supplied guard while the job runs, and nothing for the public shard', async () => {
    const guards = [scratchGuard('guard-a'), scratchGuard('guard-b')]
    const store = new MemoryBlockstore()
    // One entry per `execute` call; each entry is one label list per guard.
    const during: string[][][] = []
    const executor = new WatchingExecutor('watcher', () => {
      during.push(guards.map((guard) => [...guard.registrations]))
    })

    const sovereign = await canonicalCid(SUBMITTED_ROW)
    const open = await canonicalCid(OPEN_ROW)
    if (!sovereign.ok || !open.ok) throw new Error('fixture not encodable')

    const result = await submitJobWithEgress(
      {
        moduleCid: await store.put(MODULE_WRITES_PARTITION),
        shards: [
          { value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER_ID },
          { value: OPEN_ROW, label: 'public' },
        ],
        executors: [executor],
        nodes: soleOwnerNode('watcher'),
        redundancy: 1,
      },
      store,
      guards,
    )

    expect(result.ok).toBe(true)
    // Liveness before absence: an empty `during` is exactly what an executor that
    // never ran produces, and every reading below is one this instrument took.
    expect(during).toHaveLength(2)

    for (const perGuard of during) {
      expect(perGuard).toHaveLength(2)
      for (const held of perGuard) {
        // Both halves in one assertion: the sovereign label is there, and it is the
        // *only* thing there — a public shard's input CID is not registered, so an
        // all-public workload pays no scan.
        expect(held).toEqual([sovereign.cid.toString()])
        expect(held).not.toContain(open.cid.toString())
      }
    }

    // Given back on the way out, on every guard, so a submitter's guard does not
    // grow with every job it runs.
    for (const guard of guards) expect(guard.registrations).toEqual([])
  })

  it('registers the same label the serve path would use for the same shard', async () => {
    // Two registration paths, one payload, and they must agree.
    // `takeSovereignHold` keys on `task.inputCid.toString()` read from the
    // node's local store; `submitJobWithEgress` keys on `canonicalCid(shard.value)`.
    // If either were ever renamed, one node that both submits and serves the same
    // row would hold it under two labels and the first release would unguard the
    // payload the other path is still watching for. The serve-side label here is
    // produced by calling the production wrapper, not written down by hand.
    const submitterGuard = scratchGuard('submitter')
    const serverGuard = scratchGuard('server')
    const store = new MemoryBlockstore()

    const duringSubmit: string[][] = []
    const executor = new WatchingExecutor('watcher', () => {
      duringSubmit.push([...submitterGuard.registrations])
    })

    const result = await submitJobWithEgress(
      {
        moduleCid: await store.put(MODULE_WRITES_PARTITION),
        shards: [{ value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER_ID }],
        executors: [executor],
        nodes: soleOwnerNode('watcher'),
        redundancy: 1,
      },
      store,
      [submitterGuard],
    )
    expect(result.ok).toBe(true)
    expect(duringSubmit).toHaveLength(1)

    // The serve path, on the same bytes: the owner's local tier already holds the
    // row, which is the precondition `takeSovereignHold` documents.
    const sovereign = await canonicalCid(SUBMITTED_ROW)
    if (!sovereign.ok) throw new Error('fixture not encodable')
    const local = new MemoryBlockstore()
    await local.put(sovereign.bytes)
    await takeSovereignHold(
      {
        moduleCid: sovereign.cid,
        inputCid: sovereign.cid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      },
      { blockstore: local, guard: serverGuard },
    )

    // Non-empty first: two empty lists are equal, and that comparison would pass
    // with neither path having registered anything at all.
    expect(serverGuard.registrations).toHaveLength(1)
    expect(duringSubmit[0]).toEqual(serverGuard.registrations)
  })

  it('gives the registration back when submitJob throws', async () => {
    const guard = scratchGuard('thrower')
    const sovereign = await canonicalCid(SUBMITTED_ROW)
    if (!sovereign.ok) throw new Error('fixture not encodable')

    // `submitJob`'s first act after validation is to content-address every shard
    // input and `put` it. A store that refuses puts is therefore the cheapest way to
    // make `submitJob` *reject* rather than return `ok:false` — and the snapshot
    // taken inside `put` is a genuine mid-job reading, which is what makes the
    // "released" assertion below admissible: it proves the registration existed to
    // be released, rather than never having been taken.
    const observed: string[][] = []
    const failing: Blockstore = {
      async put(): Promise<CID> {
        observed.push([...guard.registrations])
        throw new Error('blockstore is gone')
      },
      async get(): Promise<Uint8Array<ArrayBuffer> | undefined> {
        return undefined
      },
      async has(): Promise<boolean> {
        return false
      },
      size: 0,
    }

    await expect(
      submitJobWithEgress(
        {
          moduleCid: await new MemoryBlockstore().put(MODULE_WRITES_PARTITION),
          shards: [{ value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER_ID }],
          executors: [new WatchingExecutor('watcher', () => {})],
          nodes: soleOwnerNode('watcher'),
          redundancy: 1,
        },
        failing,
        [guard],
      ),
    ).rejects.toThrow('blockstore is gone')

    expect(observed).toEqual([[sovereign.cid.toString()]])
    expect(guard.registrations).toEqual([])
  })

  it('takes one hold per sovereign shard and gives every hold back, including two shards of one value', async () => {
    const guard = scratchGuard('holds')
    const store = new MemoryBlockstore()
    const during: string[][] = []
    const executor = new WatchingExecutor('watcher', () => {
      during.push([...guard.registrations].sort())
    })

    const first = await canonicalCid(SUBMITTED_ROW)
    const second = await canonicalCid(OTHER_ROW)
    if (!first.ok || !second.ok) throw new Error('fixture not encodable')

    const result = await submitJobWithEgress(
      {
        moduleCid: await store.put(MODULE_WRITES_PARTITION),
        shards: [
          { value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER_ID },
          { value: OTHER_ROW, label: 'sovereign', ownerId: OWNER_ID },
          { value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER_ID },
        ],
        executors: [executor],
        nodes: soleOwnerNode('watcher'),
        redundancy: 1,
      },
      store,
      [guard],
    )

    expect(result.ok).toBe(true)
    expect(during).toHaveLength(3)
    const expected = [first.cid.toString(), second.cid.toString()].sort()
    // Two distinct values, two labels — the third shard repeats the first value, and
    // `#guarded` is keyed by label, so it appears once however many holds it carries.
    for (const held of during) expect(held).toEqual(expected)

    // The falsification for hold *counting*: three shards took three holds on two
    // labels. An implementation that guarded per shard and released per distinct
    // label would leave the repeated row registered here for the rest of this
    // process's life.
    expect(guard.registrations).toEqual([])
  })

  it('leaves the guard untouched throughout an all-public job', async () => {
    const guard = scratchGuard('public-only')
    const store = new MemoryBlockstore()
    const during: string[][] = []
    const executor = new WatchingExecutor('watcher', () => {
      during.push([...guard.registrations])
    })

    const result = await submitJobWithEgress(
      {
        moduleCid: await store.put(MODULE_WRITES_PARTITION),
        shards: [
          { value: { n: 1 }, label: 'public' },
          { value: { n: 2 }, label: 'public' },
          { value: OPEN_ROW, label: 'public' },
        ],
        executors: [executor],
        nodes: soleOwnerNode('watcher'),
        redundancy: 1,
      },
      store,
      [guard],
    )

    expect(result.ok).toBe(true)
    // Three readings, all empty. The count is the liveness half: without it, "every
    // reading was empty" is also true of a job that never dispatched a shard.
    expect(during).toHaveLength(3)
    for (const held of during) expect(held).toEqual([])
    expect(guard.registrations).toEqual([])
  })
})
