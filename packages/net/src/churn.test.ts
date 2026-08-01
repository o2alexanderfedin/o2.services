import {
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  checkpointOf,
  isComplete,
  readCheckpoint,
  recoverCheckpoint,
  remainingWork,
  runResilient,
  writeCheckpoint,
} from '@o2/core'
import { SendRefused } from '@o2/core'
import type {
  CompletedShard,
  DispatchOutcome,
  NodeDescriptor,
  ShardWork,
  Task,
  Transport,
} from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_TRAPS, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import {
  EgressRefusal,
  FetchingBlockstore,
  RpcBlockSource,
  RpcEndpoint,
  remoteDispatch,
  serveAgent,
} from './index.ts'

/**
 * CHURN-01 and CHURN-03 against a real fabric.
 *
 * The kernel tests drive `runResilient` with a fake dispatch, which proves the loop.
 * This proves the loop against nodes that actually go away: `rpc.close()` is a real
 * departure, and the requestor discovers it the same way it would discover a closed
 * laptop — by asking and getting nothing back.
 */

const SHARD_COUNT = 8
const T0 = 1_800_000_000_000

/**
 * A real clock, deliberately.
 *
 * The kernel tests use a fake one that advances without waiting, which is correct
 * when the dispatch is fake too. Mixing that with *real* async I/O is not just
 * inaccurate, it is a hot spin: a `sleep` that resolves immediately makes the
 * straggler watchdog fire on every microtask turn while the RPC is still in flight.
 * These tests are about nodes dying and coordinators resuming, not about timing, so
 * they take the real thing and leave speculation at its defaults.
 */
const realTime = () => ({ now: (): number => Date.now() })

interface Fabric {
  readonly network: MemoryNetwork
  readonly requestorRpc: RpcEndpoint
  readonly requestorStore: MemoryBlockstore
  readonly nodes: readonly NodeDescriptor[]
  readonly endpoints: ReadonlyMap<string, RpcEndpoint>
  readonly moduleCid: CID
  readonly inputCid: CID
  close(): void
}

/** N serving nodes plus an origin holding the module, on the in-process transport. */
async function fabricOf(nodeCount: number, module = MODULE_WRITES_PARTITION): Promise<Fabric> {
  const network = new MemoryNetwork()

  const originStore = new MemoryBlockstore()
  const moduleCid = await originStore.put(module)
  const inputCid = await originStore.put(new Uint8Array([0x80])) // dag-cbor []
  const originRpc = new RpcEndpoint(network.connect('origin'), { timeoutMs: 400 })
  serveAgent({
    rpc: originRpc,
    executor: new WasmExecutor({ nodeId: 'origin', blockstore: originStore }),
    blockstore: originStore,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  const endpoints = new Map<string, RpcEndpoint>()
  const nodes: NodeDescriptor[] = []
  for (let i = 0; i < nodeCount; i++) {
    const nodeId = `n${i}`
    const rpc = new RpcEndpoint(network.connect(nodeId), { timeoutMs: 400 })
    const store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(rpc, () => ['origin']),
    )
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId, blockstore: store }),
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      enroll: 'issues-no-certificates',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })
    endpoints.set(nodeId, rpc)
    nodes.push({ nodeId, ownerId: 'alice', canExecuteSovereign: true, load: 0 })
  }

  const requestorStore = new MemoryBlockstore()
  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 400 })

  return {
    network,
    requestorRpc,
    requestorStore,
    nodes,
    endpoints,
    moduleCid,
    inputCid,
    close() {
      originRpc.close()
      requestorRpc.close()
      for (const rpc of endpoints.values()) rpc.close()
    },
  }
}

const work: ShardWork[] = Array.from({ length: SHARD_COUNT }, (_, i) => ({
  shardId: `s${i}`,
  label: 'public' as const,
}))

const partitionOf = (shardId: string): number => Number(shardId.slice(1))

// Correction 2 (Phase 12 Plan 04): `parseRequest` now refuses an exec request
// with no label at the wire boundary — carrying `shard.label` through here is
// no longer optional. Every shard in this file is `'public'`, so `ownerId` is
// never set; mirrors `submit.ts`'s `requestFor`/`coordinator.ts`'s `requestFor`
// conditional-omission style rather than writing an explicit `undefined`.
const taskFor = (fabric: Fabric) => (shard: ShardWork): Task => ({
  moduleCid: fabric.moduleCid,
  inputCid: fabric.inputCid,
  partitionIndex: partitionOf(shard.shardId),
  partitionCount: SHARD_COUNT,
  label: shard.label,
})

describe('CHURN-01 — nodes that actually go away, mid-run', () => {
  it('completes every shard with 30% of the fabric killed', async () => {
    const fabric = await fabricOf(10)
    try {
      const time = realTime()
      // Three of ten leave the fabric outright — the machine is gone, which is what
      // a closed laptop looks like: the dial fails rather than hanging. Not a flag
      // the dispatcher consults; the requestor finds out by asking.
      const dead = ['n2', 'n5', 'n8']
      for (const nodeId of dead) {
        fabric.endpoints.get(nodeId)?.close()
        fabric.network.disconnect(nodeId)
      }

      const outcome = await runResilient({
        work,
        nodes: fabric.nodes,
        now: time.now,
        dispatch: remoteDispatch({
          rpc: fabric.requestorRpc,
          blockstore: fabric.requestorStore,
          taskFor: taskFor(fabric),
        }),
      })

      expect(outcome.ok).toBe(true)
      expect(outcome.failed).toEqual([])
      expect(outcome.results.size).toBe(SHARD_COUNT)

      // Every shard produced a *distinct* CID, because the fixture writes its
      // partition index — so a mis-routed re-dispatch would show up as a collision.
      expect(new Set(outcome.results.values()).size).toBe(SHARD_COUNT)
      for (const shard of outcome.shards) expect(dead).not.toContain(shard.nodeId)

      // And the departures are attributed, not merely survived.
      const nodeFailures = outcome.shards.flatMap((s) => s.failures)
      expect(nodeFailures.every((f) => f.kind === 'node')).toBe(true)
      for (const failure of nodeFailures) expect(dead).toContain(failure.nodeId)
    } finally {
      fabric.close()
    }
  })

  it('survives a node that dies between placement and dispatch', async () => {
    const fabric = await fabricOf(8)
    try {
      const time = realTime()
      const killed = new Set<string>()

      const inner = remoteDispatch({
        rpc: fabric.requestorRpc,
        blockstore: fabric.requestorStore,
        taskFor: taskFor(fabric),
      })

      const outcome = await runResilient({
        work,
        nodes: fabric.nodes,
        now: time.now,
        // The node is alive when chosen and silent by the time the request lands —
        // the window a liveness check can never close. Deliberately the *other*
        // failure shape from the test above: the peer stays connected and simply
        // stops answering, so this one costs a full RPC timeout to detect.
        dispatch: async (shard, nodeId, lease) => {
          if (killed.size < 2 && !killed.has(nodeId)) {
            killed.add(nodeId)
            fabric.endpoints.get(nodeId)?.close()
          }
          return inner(shard, nodeId, lease)
        },
      })

      expect(outcome.ok).toBe(true)
      expect(outcome.results.size).toBe(SHARD_COUNT)
    } finally {
      fabric.close()
    }
  })

  it('gives up quickly on a module that traps, instead of burning the fabric', async () => {
    // Ten healthy nodes and a task that cannot succeed on any of them. The node/task
    // distinction is what stops this from costing ten dispatches per shard.
    const fabric = await fabricOf(10, MODULE_TRAPS)
    try {
      const time = realTime()
      const outcome = await runResilient({
        work: [work[0] as ShardWork],
        nodes: fabric.nodes,
        now: time.now,
        dispatch: remoteDispatch({
          rpc: fabric.requestorRpc,
          blockstore: fabric.requestorStore,
          taskFor: taskFor(fabric),
        }),
      })

      expect(outcome.ok).toBe(false)
      expect(outcome.failed).toEqual(['s0'])
      expect(outcome.shards[0]?.attempted).toHaveLength(3)
      expect(outcome.shards[0]?.failures.every((f) => f.kind === 'task')).toBe(true)
    } finally {
      fabric.close()
    }
  })
})

describe('CHURN-03 — the requestor’s tab closes and the job survives', () => {
  it('resumes from a checkpoint and finishes only the outstanding shards', async () => {
    const fabric = await fabricOf(6)
    try {
      const dispatch = remoteDispatch({
        rpc: fabric.requestorRpc,
        blockstore: fabric.requestorStore,
        taskFor: taskFor(fabric),
      })

      // --- First coordinator: runs half the job, then checkpoints and "closes". ---
      const firstHalf = work.slice(0, 4)
      const before = await runResilient({
        work: firstHalf,
        nodes: fabric.nodes,
        now: realTime().now,
        dispatch,
      })
      expect(before.ok).toBe(true)

      const completed: CompletedShard[] = [...before.results].map(([shardId, resultCid]) => ({
        partitionIndex: partitionOf(shardId),
        resultCid,
      }))
      const checkpoint = checkpointOf({
        jobId: 'job-churn',
        moduleCid: fabric.moduleCid.toString(),
        partitionCount: SHARD_COUNT,
        completed,
        at: T0,
      })
      const handle = await writeCheckpoint(checkpoint, fabric.requestorStore)

      // The tab closes. Nothing is released; nothing needs to be. A lease is a
      // deadline, so the outstanding shards simply become available again.
      // --- Second coordinator: knows only the checkpoint CID. ---
      const resumed = await readCheckpoint(handle, fabric.requestorStore)
      expect(resumed.ok).toBe(true)
      if (!resumed.ok) return

      expect(isComplete(resumed.checkpoint)).toBe(false)
      const outstanding = remainingWork(resumed.checkpoint)
      expect(outstanding).toEqual([4, 5, 6, 7])

      const time = realTime()
      const after = await runResilient({
        work: outstanding.map((i) => ({ shardId: `s${i}`, label: 'public' as const })),
        nodes: fabric.nodes,
        now: time.now,
        dispatch,
      })
      expect(after.ok).toBe(true)

      // Only the outstanding work ran the second time — resuming is not restarting.
      expect(after.results.size).toBe(4)
      expect([...after.results.keys()].sort()).toEqual(['s4', 's5', 's6', 's7'])

      const finalCheckpoint = checkpointOf({
        jobId: 'job-churn',
        moduleCid: fabric.moduleCid.toString(),
        partitionCount: SHARD_COUNT,
        completed: [
          ...resumed.checkpoint.completed,
          ...[...after.results].map(([shardId, resultCid]) => ({
            partitionIndex: partitionOf(shardId),
            resultCid,
          })),
        ],
        at: T0 + 1_000,
        previous: handle.toString(),
      })
      expect(isComplete(finalCheckpoint)).toBe(true)

      // The shards the first coordinator finished are still retrievable by CID —
      // the checkpoint names results, it does not carry them. That is the whole
      // reason a departed coordinator loses nothing.
      for (const shard of resumed.checkpoint.completed) {
        expect(await fabric.requestorStore.has(CID.parse(shard.resultCid))).toBe(true)
      }
    } finally {
      fabric.close()
    }
  })

  it('recovers from an older handle when the newest checkpoint block is lost', async () => {
    const fabric = await fabricOf(4)
    try {
      const older = await writeCheckpoint(
        checkpointOf({
          jobId: 'job-churn',
          moduleCid: fabric.moduleCid.toString(),
          partitionCount: SHARD_COUNT,
          completed: [{ partitionIndex: 0, resultCid: 'bafyA' }],
          at: T0,
        }),
        fabric.requestorStore,
      )
      // Written somewhere the requestor cannot read — the newest handle is a dead end.
      const newer = await writeCheckpoint(
        checkpointOf({
          jobId: 'job-churn',
          moduleCid: fabric.moduleCid.toString(),
          partitionCount: SHARD_COUNT,
          completed: [
            { partitionIndex: 0, resultCid: 'bafyA' },
            { partitionIndex: 1, resultCid: 'bafyB' },
          ],
          at: T0 + 1,
          previous: older.toString(),
        }),
        new MemoryBlockstore(),
      )

      const recovered = await recoverCheckpoint([newer, older], fabric.requestorStore)
      expect(recovered?.skipped).toBe(1)
      // An older *complete* view: partition 1 is outstanding again, which costs a
      // recompute and never a wrong answer.
      expect(remainingWork(recovered?.checkpoint as never)).toContain(1)
    } finally {
      fabric.close()
    }
  })
})

/**
 * NET-09 criterion 5 — a send *this node* refused is not the receiver's failure.
 *
 * Every case below drives `remoteDispatch` against an `RpcEndpoint` built over a
 * transport that rejects, because the classification lives in `remoteDispatch`'s
 * `catch` and that is the only way to reach it. The interesting half is the
 * negative space: `send-refused` is the *only* thing that produces `'sender'`, and
 * the cases that must keep producing `'node'` are asserted one by one, because a
 * branch that swallowed the general case into `'sender'` would look identical on
 * the happy path.
 */
describe('NET-09 — classifying a refusal this node made, against every other failure', () => {
  const shard: ShardWork = { shardId: 's0', label: 'public' }

  /** A transport whose `send` always rejects with `cause`. Nothing else is used. */
  const rejecting = (cause: unknown): Transport => ({
    localId: 'local-node',
    send: async () => {
      throw cause
    },
    onMessage: () => () => {},
    peers: [],
  })

  const dispatchOver = async (cause: unknown): Promise<DispatchOutcome> => {
    const rpc = new RpcEndpoint(rejecting(cause), { timeoutMs: 500 })
    try {
      return await remoteDispatch({
        rpc,
        blockstore: new MemoryBlockstore(),
        taskFor: (): Task => ({
          moduleCid: CID.parse('bafkqaaa'),
          inputCid: CID.parse('bafkqaaa'),
          partitionIndex: 0,
          partitionCount: 1,
          label: 'public',
        }),
      })(shard, 'n0', undefined as never)
    } finally {
      rpc.close()
    }
  }

  it('classifies a gate refusal as sender, naming which node’s bound refused', async () => {
    const outcome = await dispatchOver(
      new SendRefused('local-node refused a send to n0: 8 of 8 streams in use', {
        to: 'n0',
        by: 'local-node',
      }),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('sender')
    // The reader learns *whose* bound it was, even though the recorded nodeId
    // still names the peer that was attempted.
    expect(outcome.reason).toContain('local-node')
    expect(outcome.reason).toContain('8 of 8 streams in use')
  })

  it('still classifies a dial to an unreachable peer as node', async () => {
    // The case that makes `send-failed` the wrong discriminator. `rpc.ts`'s catch
    // is bare and `Libp2pTransport.send` awaits `dialProtocol`, so a dead receiver
    // arrives by the same route a gate refusal does.
    const outcome = await dispatchOver(new Error('Can not dial n0: no valid addresses'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies an ordinary send failure as node', async () => {
    const outcome = await dispatchOver(new Error('the stream has been reset'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies an EgressRefusal raised by this node’s own tap as node', async () => {
    // Called out by name: this plan does **not** reclassify an egress refusal. It
    // reaches `rpc.ts` as `send-failed` and therefore stays `'node'`. If a later
    // phase decides it deserves `'sender'`, it makes `EgressRefusal` carry the
    // `SendRefused` marker; it does not widen the `send-failed` branch.
    const outcome = await dispatchOver(new EgressRefusal({ to: 'n0', violation: 'alice-row', bytes: 138 }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies a closed endpoint as node', async () => {
    const rpc = new RpcEndpoint(rejecting(new Error('unused')), { timeoutMs: 500 })
    rpc.close()
    const outcome = await remoteDispatch({
      rpc,
      blockstore: new MemoryBlockstore(),
      taskFor: (): Task => ({
        moduleCid: CID.parse('bafkqaaa'),
        inputCid: CID.parse('bafkqaaa'),
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      }),
    })(shard, 'n0', undefined as never)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies a timeout as node', async () => {
    // A transport that accepts the send and never answers.
    const silent: Transport = {
      localId: 'local-node',
      send: async () => {},
      onMessage: () => () => {},
      peers: [],
    }
    const rpc = new RpcEndpoint(silent, { timeoutMs: 100 })
    try {
      const outcome = await remoteDispatch({
        rpc,
        blockstore: new MemoryBlockstore(),
        taskFor: (): Task => ({
          moduleCid: CID.parse('bafkqaaa'),
          inputCid: CID.parse('bafkqaaa'),
          partitionIndex: 0,
          partitionCount: 1,
          label: 'public',
        }),
      })(shard, 'n0', undefined as never)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.kind).toBe('node')
    } finally {
      rpc.close()
    }
  })

  it('retries a sender refusal like a node failure and never burns the task budget', async () => {
    // Through `runResilient`, not by reading the field: what matters is the policy
    // the kind selects, and `coordinator.ts` reads `kind` in exactly one place.
    const nodes: NodeDescriptor[] = Array.from({ length: 5 }, (_, i) => ({
      nodeId: `n${i}`,
      ownerId: 'alice',
      canExecuteSovereign: true,
      load: 0,
    }))
    let attempts = 0
    const outcome = await runResilient({
      work: [shard],
      nodes,
      now: realTime().now,
      dispatch: async (_shard, nodeId): Promise<DispatchOutcome> => {
        attempts += 1
        // The first four refuse from this node's own gate; the fifth answers.
        if (attempts <= 4) {
          return {
            ok: false,
            kind: 'sender',
            reason: `dispatch to ${nodeId} refused by local-node's own send bound`,
          }
        }
        return { ok: true, resultCid: 'bafy-s0' }
      },
    })

    // Five attempts is more than DEFAULT_MAX_TASK_FAILURES (3). A `'task'` kind
    // would have given up at three; `'sender'` retries like `'node'`.
    expect(outcome.ok).toBe(true)
    expect(attempts).toBe(5)
    expect(outcome.results.get('s0')).toBe('bafy-s0')
    // And the history says whose bound it was, even though nodeId names the peer.
    const failures = outcome.shards[0]?.failures ?? []
    expect(failures).toHaveLength(4)
    expect(failures.every((f) => f.kind === 'sender')).toBe(true)
    expect(failures.every((f) => nodes.some((n) => n.nodeId === f.nodeId))).toBe(true)
  })
})
