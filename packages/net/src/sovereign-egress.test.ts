import {
  MemoryBlockstore,
  MemoryNetwork,
  WasmExecutor,
  encodeCanonical,
  guardSovereignty,
} from '@o2/core'
import type { Blockstore, Executor, Task } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { EgressGuard } from './egress.ts'
import { RemoteExecutor } from './remote-executor.ts'
import { RpcEndpoint } from './rpc.ts'
import { serveAgent } from './agent.ts'
import { registerSovereignInputs } from './sovereign-egress.ts'

/**
 * `registerSovereignInputs` — proven as a real production caller of
 * `EgressGuard.guard()`, over a genuine `RpcEndpoint`/`serveAgent`/`EgressGuard`
 * fabric. None of these tests calls `guard.guard()` directly: every violation, or
 * lack of one, is a consequence of the wrapper's own decision.
 *
 * A registration is what lets the tap refuse. The first behaviour below is the
 * whole point of registering at all: the serving node's reply would have carried
 * the raw row, so it never leaves, and the dispatch fails instead of succeeding
 * with the row already gone.
 */

const OWNER_ID = 'alice'

/** Alice's sovereign row. Distinctive bytes, so a match in a frame means something. */
const SOVEREIGN_ROW = { ssn: '123-45-6789', salary: 87_000, dob: '1984-02-29' }

interface Node {
  readonly nodeId: string
  readonly rpc: RpcEndpoint
  readonly guard: EgressGuard
  close(): void
}

// One shared network for the whole file is fine: each `it` uses a fresh, distinct
// `nodeId` + requestor pair, so nothing in one test can observe another's frames.
const network = new MemoryNetwork()

/**
 * One serving node, wired exactly the way `fabric-node.ts`/`browser-node.ts` will
 * compose it in Plan 13-02: `registerSovereignInputs(guardSovereignty(...), ...)`
 * feeding `serveAgent`, over an `EgressGuard`-wrapped transport.
 *
 * `executionStore` is what the `WasmExecutor` itself reads module/input bytes from.
 * `registrationStore` is what `registerSovereignInputs` checks before calling
 * `guard.guard()` — separate parameters so behavior 3 below can make them diverge.
 */
function servingNode(options: {
  nodeId: string
  executionStore: Blockstore
  registrationStore: Blockstore
  canExecuteSovereign: boolean
  /**
   * Stands in for the `WasmExecutor` when a behavior needs execution itself to
   * fail. Everything above and below it is unchanged, so the failure travels the
   * production path rather than a shortcut.
   */
  inner?: Executor
}): Node {
  const guard = new EgressGuard(network.connect(options.nodeId), OWNER_ID)
  const rpc = new RpcEndpoint(guard, { timeoutMs: 2_000 })
  const executor = registerSovereignInputs(
    guardSovereignty(
      options.inner ??
        new WasmExecutor({ nodeId: options.nodeId, blockstore: options.executionStore }),
      {
        ownerId: OWNER_ID,
        canExecuteSovereign: options.canExecuteSovereign,
      },
    ),
    { blockstore: options.registrationStore, guard },
  )
  serveAgent({
    rpc,
    executor,
    blockstore: options.executionStore,
    // This node's own tap, the one `rpc` is built over — so the registration
    // `registerSovereignInputs` takes is released once the reply frame has settled.
    egress: guard,
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })
  return {
    nodeId: options.nodeId,
    rpc,
    guard,
    close() {
      rpc.close()
    },
  }
}
function requestor(nodeId: string): { readonly rpc: RpcEndpoint; readonly executor: RemoteExecutor } {
  const rpc = new RpcEndpoint(network.connect(`requestor-${nodeId}`), { timeoutMs: 2_000 })
  return { rpc, executor: new RemoteExecutor(nodeId, rpc) }
}

describe('registerSovereignInputs — a production caller for EgressGuard.guard()', () => {
  it('registers a sovereign task’s input before it runs, and the tap refuses the leaking reply', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_ECHOES_INPUT)
    const encoded = encodeCanonical(SOVEREIGN_ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')
    const inputCid = await store.put(encoded.bytes)

    const node = servingNode({
      nodeId: 'alice-1',
      executionStore: store,
      registrationStore: store,
      canExecuteSovereign: true,
    })
    const { rpc, executor } = requestor('alice-1')
    try {
      const task: Task = {
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      }
      const outcome = await executor.execute(task)
      // The module echoed its input straight back, so the reply frame would have
      // carried the raw row. The tap refused it: the row stayed on the owner's
      // node, and the requestor's dispatch failed as a consequence.
      //
      // The requestor waits out this endpoint's 2s timeout rather than being told
      // why, because the refusal happens on the *responding* leg, which `rpc.ts`
      // swallows by documented design — see `egress.ts`'s own statement of that
      // cost. The added seconds here are an understood consequence, not a slow
      // test nobody has looked at.
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain(node.nodeId)

      // Refused *and* recorded — the two halves of the ordering guarantee, both
      // reached without this test ever calling guard.guard().
      const manifest = node.guard.manifest
      expect(manifest.violations).toContain(inputCid.toString())
      expect(manifest.entries.some((entry) => entry.violation === inputCid.toString())).toBe(true)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('never registers or touches the guard for a public task', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const inputCid = await store.put(new Uint8Array([1, 2, 3]))

    const node = servingNode({
      nodeId: 'alice-2',
      executionStore: store,
      registrationStore: store,
      canExecuteSovereign: true,
    })
    const { rpc, executor } = requestor('alice-2')
    try {
      const task: Task = {
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      }
      const outcome = await executor.execute(task)
      expect(outcome.ok).toBe(true)

      // The executor genuinely produced output that legitimately crossed the wire
      // in the RPC response — a real send happened, just not a registration.
      expect(node.guard.manifest.entries.length).toBeGreaterThan(0)
      expect(node.guard.manifest.violations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('skips registration, without failing the task, when the input is not locally resident', async () => {
    const executionStore = new MemoryBlockstore()
    const moduleCid = await executionStore.put(MODULE_ECHOES_INPUT)
    const encoded = encodeCanonical(SOVEREIGN_ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')
    const inputCid = await executionStore.put(encoded.bytes)

    // Distinct from executionStore, and deliberately empty — the registration
    // lookup must miss even though the executor's own store holds the block.
    const registrationStore = new MemoryBlockstore()

    const node = servingNode({
      nodeId: 'alice-3',
      executionStore,
      registrationStore,
      canExecuteSovereign: true,
    })
    const { rpc, executor } = requestor('alice-3')
    try {
      const task: Task = {
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      }
      const outcome = await executor.execute(task)
      expect(outcome.ok).toBe(true)
      expect(node.guard.manifest.violations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('the registration is released after the reply frame has settled', () => {
  it('releases after a sovereign reply that was sent, and the reply still left', async () => {
    const store = new MemoryBlockstore()
    // Aggregating module: the reply carries a partition write, not the row, so this
    // is the sovereign path that is *supposed* to succeed.
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const encoded = encodeCanonical(SOVEREIGN_ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')
    const inputCid = await store.put(encoded.bytes)

    const node = servingNode({
      nodeId: 'alice-4',
      executionStore: store,
      registrationStore: store,
      canExecuteSovereign: true,
    })
    const { rpc, executor } = requestor('alice-4')
    try {
      const outcome = await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      })
      expect(outcome.ok).toBe(true)

      // The reply really left — a release that worked by never registering would
      // satisfy the emptiness check below just as well.
      expect(node.guard.manifest.entries.length).toBeGreaterThan(0)
      expect(node.guard.manifest.violations).toEqual([])

      // Read after the dispatch resolved rather than trusting the call order. That
      // the registration was still present *during* the scan is what the refusing
      // behavior above measures; this is the other half.
      expect(node.guard.registrations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('turns a throwing executor into a named failure and still releases', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const encoded = encodeCanonical(SOVEREIGN_ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')
    const inputCid = await store.put(encoded.bytes)

    const node = servingNode({
      nodeId: 'alice-5',
      executionStore: store,
      registrationStore: store,
      canExecuteSovereign: true,
      inner: {
        nodeId: 'alice-5',
        execute(): Promise<never> {
          return Promise.reject(new Error('disk went away mid-task'))
        },
      },
    })
    const { rpc, executor } = requestor('alice-5')
    try {
      const outcome = await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      })

      // A named failure, not a frame the requestor gives up on. Before this the
      // throw reached `rpc.ts`'s handler catch, which replies `{error: …}` — a
      // shape `parseResponse` does not recognise, so the requestor reported the
      // response malformed and the actual reason was lost.
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain('disk went away mid-task')
      expect(outcome.reason).not.toContain('malformed')

      // The error exit is an exit. A node that forgot to forget on it would grow
      // its watch list every time a task failed.
      expect(node.guard.registrations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
  })
})
