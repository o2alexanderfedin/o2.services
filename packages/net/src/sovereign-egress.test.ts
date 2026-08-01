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

/**
 * `takeSovereignHold` — proven as a real production caller of
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
 * One serving node, wired exactly the way `fabric-node.ts`/`browser-node.ts` compose
 * it: `guardSovereignty(...)` feeding `serveAgent`, over an `EgressGuard`-wrapped
 * transport, with the tap and the local-only tier handed to `serveAgent` as one
 * option.
 *
 * `executionStore` is what the `WasmExecutor` itself reads module/input bytes from.
 * `registrationStore` is the local-only tier `takeSovereignHold` checks before
 * calling `guard.guard()` — separate parameters so behavior 3 below can make them
 * diverge.
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
  const executor = guardSovereignty(
    options.inner ?? new WasmExecutor({ nodeId: options.nodeId, blockstore: options.executionStore }),
    {
      ownerId: OWNER_ID,
      canExecuteSovereign: options.canExecuteSovereign,
    },
  )
  serveAgent({
    rpc,
    executor,
    blockstore: options.executionStore,
    // This node's own tap, the one `rpc` is built over, plus the local-only tier
    // that says which payloads are sovereign — so the hold the serve path takes is
    // given back once the reply frame has settled, and only that hold.
    egress: { guard, sovereignInputs: options.registrationStore },
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
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
/**
 * `timeoutMs` is a per-behavior choice rather than a file-wide constant because the
 * refusing behavior below measures elapsed wall-clock: its budget is deliberately
 * long, so an elapsed reading well under it cannot be a timeout wearing a disguise.
 */
function requestor(
  nodeId: string,
  timeoutMs = 2_000,
): { readonly rpc: RpcEndpoint; readonly executor: RemoteExecutor } {
  const rpc = new RpcEndpoint(network.connect(`requestor-${nodeId}`), { timeoutMs })
  return { rpc, executor: new RemoteExecutor(nodeId, rpc, 'dispatches-unauthenticated') }
}

describe('takeSovereignHold — a production caller for EgressGuard.guard()', () => {
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
    // Ten seconds, five times this file's default, so an elapsed reading under one
    // second cannot be a timeout that happened to fire early. The budget is the
    // control for the measurement below, not a convenience.
    const { rpc, executor } = requestor('alice-1', 10_000)
    try {
      const task: Task = {
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      }
      const started = performance.now()
      const outcome = await executor.execute(task)
      const elapsed = performance.now() - started
      // The module echoed its input straight back, so the reply frame would have
      // carried the raw row. The tap refused it: the row stayed on the owner's
      // node, and the requestor's dispatch failed as a consequence.
      //
      // NET-10: the requestor is *told*, rather than left to time out. `serveAgent`
      // asks the guard about its candidate reply before handing it to the exit and,
      // on a hit, substitutes a small `{kind:'exec', outcome:{ok:false}}` that by
      // construction cannot carry the payload it refuses. `rpc.ts`'s responding leg
      // still swallows a send failure by documented design, and that cost is still
      // real for every frame `serveAgent` does not pre-scan — see the scoped
      // exception in `egress.ts`'s class comment. It no longer applies here.
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain(node.nodeId)
      // Soft, all three, and for one reason: asserted hard, only the first to fail
      // reaches the report, and the run that matters here is the *failing* one —
      // where the reason string and the elapsed figure are two different readings
      // of the same regression and both belong in the output. This is the idiom
      // Plan 13.1-01 settled on for paired evidence.
      //
      // The wire vocabulary 13.1-CONTEXT.md decision 4 fixes, asserted so it cannot
      // drift — and deliberately distinct from `over-committed: `, which travels as
      // `{kind:'error'}` because it wants the opposite retry policy.
      expect.soft(outcome.reason.startsWith('egress refused: ')).toBe(true)
      expect.soft(outcome.reason).toContain(inputCid.toString())
      // The measurement. Against a 10 s budget, a refusal that arrives in a small
      // fraction of it cannot be the budget expiring.
      expect.soft(elapsed).toBeLessThan(1_000)

      // Refused *and* recorded — the two halves of the ordering guarantee, both
      // reached without this test ever calling guard.guard().
      const manifest = node.guard.manifest
      expect(manifest.violations).toContain(inputCid.toString())
      expect(manifest.entries.some((entry) => entry.violation === inputCid.toString())).toBe(true)

      // Released even though the reply was refused. This is the case a naive
      // implementation leaks, and the leak is not cosmetic: a registration never
      // given back is scanned against every frame this node sends for the rest of
      // its life. The assertion names the label, so growth fails loudly here
      // rather than showing up as a node that slowly got slower.
      expect(node.guard.registrations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
    // 30 s, well past the requestor's 10 s budget, and deliberately so: it exists
    // for the *failing* run, not the passing one. A regression to the old
    // timeout behaviour must report as the elapsed assertion above carrying its
    // number, not as an opaque runner timeout that says nothing about what was
    // measured. Vitest's own 5 s default would have swallowed exactly that.
  }, 30_000)

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

      // Nothing was registered, so nothing is released and nothing is held. A
      // public task must not be able to add to the scan set the serve path pays
      // for on every frame.
      expect(node.guard.registrations).toEqual([])
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

      // Empty because nothing was ever registered — the skip case. The serve path
      // still releases this label unconditionally, and that release finding
      // nothing to give back is exactly why it is written unconditionally.
      expect(node.guard.registrations).toEqual([])
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

  it('releases when the endpoint closes between the outcome and the frame', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const encoded = encodeCanonical(SOVEREIGN_ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')
    const inputCid = await store.put(encoded.bytes)

    // The third exit, and the one with no observable result to assert on: the reply
    // is never sent, so the only evidence anything happened is what the tap holds
    // afterwards. `rpc.ts` keeps its `#closed` check *inside* the try for exactly
    // this reason, and until now that was a comment with nothing behind it — hoist
    // the check above the try and every dispatch interrupted by a shutdown leaves a
    // registration scanned against every frame the node sends for the rest of its
    // life.
    let server: Node | undefined
    const heldWhileRunning: string[][] = []
    const node = servingNode({
      nodeId: 'alice-6',
      executionStore: store,
      registrationStore: store,
      canExecuteSovereign: true,
      inner: {
        nodeId: 'alice-6',
        async execute() {
          // Read before closing: the hold is taken before the executor runs, so
          // this is the only moment it can be observed. Without it "nothing is
          // registered afterwards" is equally true of a node that registered
          // nothing at all.
          heldWhileRunning.push([...(server as Node).guard.registrations])
          ;(server as Node).close()
          return { ok: true, output: 0, fuelUsed: 0 }
        },
      },
    })
    server = node

    // Short, because this requestor is deliberately never answered.
    const { rpc, executor } = requestor('alice-6', 250)
    try {
      const outcome = await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER_ID,
      })

      expect(heldWhileRunning).toEqual([[inputCid.toString()]])
      expect(outcome.ok).toBe(false)
      expect(node.guard.registrations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
  })
})
