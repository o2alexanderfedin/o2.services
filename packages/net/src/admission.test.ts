import { LocalCapacity, MemoryBlockstore, MemoryNetwork, WasmExecutor } from '@o2/core'
import type { Task } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_TRAPS, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { serveAgent } from './agent.ts'
import type { Authorizer } from './agent.ts'
import { CountingExecutor } from './counting-executor.ts'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { AgentResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * SCHED-06 — admission on `serveAgent`'s `exec` branch.
 *
 * The branch that costs a `WebAssembly.compile`, an `instantiate` and a linear
 * memory used to count nothing at all: it authorized and then called
 * `await executor.execute(task)`. The roadmap measured the consequence — four
 * peers each firing 200 concurrent `exec` requests, an instrument inside the node
 * under test reading 800 simultaneous `execute()` calls and zero refusals.
 *
 * ## Which instrument reads which claim
 *
 * Two counters appear below and they are **not** interchangeable:
 *
 * - `CountingExecutor.peakInFlight` counts `execute()` calls that actually
 *   happened. It can read any number, so an assertion about it is falsifiable —
 *   this is the load-bearing reading of criterion 1.
 * - `LocalCapacity.peakInFlight` counts *slots held*, and cannot exceed `slots`
 *   because the refusal returns before the reservation is taken. It is asserted
 *   only to show the limit was **reached** rather than never approached. It is
 *   never evidence that the bound held.
 *
 * Every dispatch in this file arrives over RPC. That matters: a local caller
 * reaching an executor directly takes no admission slot, because admission lives
 * on this branch and a local call never reaches it. `peak <= slots` is a claim
 * about an all-RPC run and nothing else.
 *
 * ## Bare suffix on purpose
 *
 * `serveAgent` is portable and `vitest.config.ts` runs `packages/*&#47;src/**&#47;*.test.ts`
 * in both the `node` and `browser` projects, so this spec runs in Chromium too.
 */

// One shared network for the file: every `it` uses distinct node ids, so nothing
// in one test can observe another's frames.
const network = new MemoryNetwork()

/** dag-cbor `[]` — the one input block every task in this file reads. */
const INPUT_BYTES = new Uint8Array([0x80])

interface ServingNode {
  readonly nodeId: string
  readonly capacity: LocalCapacity
  /** The instrument the concurrency reading is taken off. */
  readonly counter: CountingExecutor
  /** A distinct task per `partitionIndex`, so the slot keys differ. */
  task(partitionIndex: number, partitionCount?: number): Task
  close(): void
}

/**
 * One serving node, wired the way both factories will compose it in Plan 13.1-05:
 * a real `LocalCapacity`, and `CountingExecutor` as the outermost wrapper of the
 * executor the node serves. Every other `AgentOptions` hook is at its sentinel.
 */
async function servingNode(options: {
  nodeId: string
  maxConcurrent: number
  module?: Uint8Array<ArrayBuffer>
  authorize?: Authorizer
}): Promise<ServingNode> {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(options.module ?? MODULE_WRITES_PARTITION)
  const inputCid = await store.put(INPUT_BYTES)

  const capacity = new LocalCapacity({ nodeId: options.nodeId, maxConcurrent: options.maxConcurrent })
  const counter = new CountingExecutor(new WasmExecutor({ nodeId: options.nodeId, blockstore: store }))
  const rpc = new RpcEndpoint(network.connect(options.nodeId), { timeoutMs: 5_000 })
  serveAgent({
    rpc,
    executor: counter,
    blockstore: store,
    capacity,
    authorize: options.authorize ?? 'serves-unauthenticated',
    egress: 'holds-no-registrations',
    index: 'serves-no-records',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  return {
    nodeId: options.nodeId,
    capacity,
    counter,
    task: (partitionIndex, partitionCount = 64) => ({
      moduleCid,
      inputCid,
      partitionIndex,
      partitionCount,
      label: 'public' as const,
    }),
    close() {
      rpc.close()
    },
  }
}

function requestorFor(nodeId: string): RpcEndpoint {
  return new RpcEndpoint(network.connect(`requestor-${nodeId}`), { timeoutMs: 5_000 })
}

/** Dispatch over the wire and read the raw reply, not `RemoteExecutor`'s flattening. */
async function dispatch(rpc: RpcEndpoint, to: string, task: Task): Promise<AgentResponse | null> {
  return parseResponse(await rpc.request(to, encodeRequest({ kind: 'exec', task })))
}

async function offer(rpc: RpcEndpoint, to: string, shardId: string): Promise<AgentResponse | null> {
  return parseResponse(await rpc.request(to, encodeRequest({ kind: 'offer', shardId })))
}

describe('SCHED-06 — the exec branch admits, and gives the slot back', () => {
  it('never runs more tasks at once than its slot count, and refuses the rest by name', async () => {
    const node = await servingNode({ nodeId: 'admit-peak', maxConcurrent: 2 })
    const rpc = requestorFor('admit-peak')
    try {
      const replies = await Promise.all(
        Array.from({ length: 32 }, (_, i) => dispatch(rpc, node.nodeId, node.task(i, 32))),
      )

      // The instrument is live before anything is claimed about what it did not
      // see: work really did reach the executor, and replies really did come back.
      expect(replies).toHaveLength(32)
      expect(replies.some((r) => r?.kind === 'exec' && r.outcome.ok)).toBe(true)
      expect(node.counter.peakInFlight).toBeGreaterThan(0)

      // The load-bearing reading. This counter can read any number at all — under
      // a mutation that removes the acquisition it reads the dispatched request
      // count, which is the roadmap's measured defect reproduced here.
      expect(node.counter.peakInFlight).toBeLessThanOrEqual(2)

      const refusals = replies.filter((r) => r?.kind === 'error')
      expect(refusals.length).toBeGreaterThan(0)
      for (const refusal of refusals) {
        if (refusal?.kind !== 'error') continue
        expect(refusal.reason.startsWith('over-committed: ')).toBe(true)
        expect(refusal.reason).toContain('2 of 2 slots in use')
      }

      // Every slot taken was given back...
      expect(node.capacity.inFlight).toBe(0)
      // ...and the limit was actually reached rather than never approached. This
      // is the only claim this counter can make: `peakInFlight <= slots` is
      // arithmetic in `LocalCapacity` and cannot fail.
      expect(node.capacity.peakInFlight).toBe(2)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('gives the slot back when the module traps', async () => {
    const node = await servingNode({ nodeId: 'admit-trap', maxConcurrent: 1, module: MODULE_TRAPS })
    const rpc = requestorFor('admit-trap')
    try {
      const first = await dispatch(rpc, node.nodeId, node.task(0))
      expect(first?.kind).toBe('exec')
      if (first?.kind !== 'exec') return
      // Instrument live: the task really did fail, and it really did reach the
      // executor — so a slot really was taken and really had to come back.
      expect(first.outcome.ok).toBe(false)
      expect(node.counter.peakInFlight).toBe(1)
      expect(node.capacity.peakInFlight).toBe(1)

      const second = await dispatch(rpc, node.nodeId, node.task(1))
      // A leaked slot would make this `{kind:'error', over-committed: 1 of 1 …}`.
      expect(second?.kind).toBe('exec')
      expect(node.capacity.inFlight).toBe(0)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('gives the slot back when authorize refuses, an exit that never calls the executor', async () => {
    const node = await servingNode({
      nodeId: 'admit-authz',
      maxConcurrent: 1,
      authorize: (request) => (request.task.partitionIndex === 0 ? 'no capability chain' : null),
    })
    const rpc = requestorFor('admit-authz')
    try {
      const refused = await dispatch(rpc, node.nodeId, node.task(0))
      expect(refused?.kind).toBe('exec')
      if (refused?.kind !== 'exec') return
      expect(refused.outcome.ok).toBe(false)
      if (refused.outcome.ok) return
      expect(refused.outcome.reason).toContain('unauthorized')
      // The slot is taken before the `try` the authorize check lives in, so this
      // exit holds one even though the executor was never called.
      expect(node.counter.peakInFlight).toBe(0)
      expect(node.capacity.peakInFlight).toBe(1)
      expect(node.capacity.inFlight).toBe(0)

      // The node is as free as one that has run nothing: the next task executes.
      const allowed = await dispatch(rpc, node.nodeId, node.task(1))
      expect(allowed?.kind).toBe('exec')
      if (allowed?.kind !== 'exec') return
      expect(allowed.outcome.ok).toBe(true)
      expect(node.counter.peakInFlight).toBe(1)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('refuses a replay of the identical task while the first is still running', async () => {
    const node = await servingNode({ nodeId: 'admit-dedupe', maxConcurrent: 4 })
    const rpc = requestorFor('admit-dedupe')
    try {
      const same = node.task(0)
      const [a, b, c] = await Promise.all([
        dispatch(rpc, node.nodeId, same),
        dispatch(rpc, node.nodeId, same),
        dispatch(rpc, node.nodeId, node.task(1)),
      ])

      const replayed = [a, b].filter((r) => r?.kind === 'error')
      expect(replayed).toHaveLength(1)
      const refusal = replayed[0]
      if (refusal?.kind !== 'error') throw new Error('expected an error reply')
      expect(refusal.reason).toContain('already in flight here')
      // The key names the work, not the request: input CID plus partition index.
      expect(refusal.reason).toContain(`${same.inputCid.toString()}:0`)
      // Instrument live: one of the pair really did run.
      expect([a, b].some((r) => r?.kind === 'exec' && r.outcome.ok)).toBe(true)

      // Keyed on the work, not on the node being busy: a *different* task
      // dispatched at the same instant, to the same node, is accepted.
      expect(c?.kind).toBe('exec')
      if (c?.kind !== 'exec') return
      expect(c.outcome.ok).toBe(true)
      expect(node.capacity.inFlight).toBe(0)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('answers an offer from the same counters without occupying one', async () => {
    const node = await servingNode({ nodeId: 'admit-offer', maxConcurrent: 1 })
    const rpc = requestorFor('admit-offer')
    try {
      // Not awaited. `MemoryNetwork` routes synchronously and the exec branch
      // acquires before its first `await`, so the slot is held by the time this
      // expression has returned — which is what makes the probe below a probe of
      // a genuinely busy node rather than a race.
      const running = dispatch(rpc, node.nodeId, node.task(0))
      expect(node.capacity.inFlight).toBe(1)

      const busy = await offer(rpc, node.nodeId, 'probe')
      expect(busy?.kind).toBe('offer')
      if (busy?.kind !== 'offer') return
      expect(busy.accepted).toBe(false)
      expect(busy.reason).toBe('over-committed: 1 of 1 slots in use')

      const ran = await running
      expect(ran?.kind).toBe('exec')

      // The demo's liveness prober sends `{kind:'offer', shardId:'probe'}` to
      // every connected peer on every `computePeers()` call. Fifty of those must
      // not fill this node's slot table, and must not tell the fifty-first that
      // the node is at capacity because of the first.
      for (let i = 0; i < 50; i++) {
        const answer = await offer(rpc, node.nodeId, 'probe')
        expect(answer?.kind).toBe('offer')
        if (answer?.kind !== 'offer') return
        expect(answer.accepted).toBe(true)
        expect(answer.reason).toBe('')
      }
      expect(node.capacity.inFlight).toBe(0)
      // One slot was ever taken, by the `exec` above. Fifty questions took none.
      expect(node.capacity.peakInFlight).toBe(1)
    } finally {
      node.close()
      rpc.close()
    }
  })
})
