import { MemoryBlockstore, MemoryNetwork, encodeCanonical } from '@o2/core'
import type { Blockstore, ExecutionOutcome, Executor, RecordIndex, Task } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { EgressGuard } from './egress.ts'
import { RpcEndpoint } from './rpc.ts'
import { RpcBlockSource, serveAgent } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
import { encodeRequest, parseResponse } from './protocol.ts'

/**
 * NET-10 — `serveAgent` refuses by name, on both branches whose reply can carry a
 * registered payload.
 *
 * The exec branch's refusal is measured against a real dispatch in
 * `sovereign-egress.test.ts`, where the registration arrives through
 * `takeSovereignHold` the way production takes it. This file measures the
 * other branch and the cost of the mechanism:
 *
 * - **The block branch** (ROADMAP criterion 7). A refusal, a hit and a miss must
 *   stay three distinguishable answers, so all three are asserted here against one
 *   node. Without the refusal a node asked for registered bytes answers with a
 *   silence a requestor cannot tell from absence — the same defect NET-10 exists to
 *   remove, one branch over.
 * - **What an idle node pays.** A node holding no registrations must not encode its
 *   reply a second time merely to ask a question whose answer is already known. The
 *   counting guard below reads that directly, and the reading is paired: the same
 *   counter shows the guard was scanning outbound frames all along, so a zero on the
 *   pre-scan counter is an instrument reporting absence rather than an instrument
 *   nobody connected.
 *
 * **These tests place a registration directly**, unlike `sovereign-egress.test.ts`.
 * That is deliberate and it is scoped: what is under test here is the block
 * branch's *answer* when a registration is held, not where the registration came
 * from. Production's own registration is job-scoped — the serve path
 * takes it before execution and `serveAgent`'s `afterSent` gives it back — so no
 * production path holds one at rest for a later block request to find.
 * 13.1-CONTEXT.md lists refusing a sovereign block at rest, indefinitely, under
 * deferred ideas, and nothing here implies it was closed.
 */

const OWNER_ID = 'alice'

/** Alice's row. Distinctive bytes, so a match inside a frame means something. */
const SOVEREIGN_ROW = { ssn: '640-22-9013', salary: 104_250, dob: '1977-06-04' }

/** A second, unrelated block the same node holds and is free to serve. */
const PUBLIC_ROW = { region: 'north-harbour', quarter: 'Q3', total: 41 }

function encoded(value: Parameters<typeof encodeCanonical>[0]): Uint8Array<ArrayBuffer> {
  const result = encodeCanonical(value)
  if (!result.ok) throw new Error('fixture not encodable')
  return result.bytes
}

/**
 * An `EgressGuard` that counts what it was asked.
 *
 * Two counters, because they answer different questions and one alone would be
 * confounded by the other: `prescans` counts calls to `refuse`, which only
 * `serveAgent`'s pre-scan makes, while `scans` counts every scan including the one
 * `send` performs on its own behalf. Counting `violationIn` alone could not tell a
 * pre-scan from the exit doing its job.
 */
class CountingGuard extends EgressGuard {
  prescans = 0
  scans = 0

  override violationIn(frame: Uint8Array): string | null {
    this.scans += 1
    return super.violationIn(frame)
  }

  override refuse(to: string, frame: Uint8Array): string | null {
    this.prescans += 1
    return super.refuse(to, frame)
  }
}

/** An executor that runs nothing — the pre-scan does not care what produced the outcome. */
function stubExecutor(nodeId: string): Executor {
  return {
    nodeId,
    execute(): Promise<ExecutionOutcome> {
      return Promise.resolve({ ok: true, output: { rows: 3 }, fuelUsed: 0, attestation: 'signed-by-nobody' })
    },
  }
}

interface Node {
  readonly nodeId: string
  readonly guard: CountingGuard
  readonly store: MemoryBlockstore
  /**
   * The store this node actually serves from — the same object `serveAgent` was handed.
   *
   * Identical to `store` unless `fetchesFrom` was supplied, in which case it is the
   * `FetchingBlockstore` wrapper production wires. Exposed so a test can drive a fetch
   * through the very store the serve path answers from, rather than through a second one
   * built to resemble it.
   */
  readonly served: Blockstore
  close(): void
}

// One shared network for the file: every `it` uses a distinct node id and
// requestor pair, so nothing in one test can observe another's frames.
const network = new MemoryNetwork()

/** Parts substituted for ones that fail, so a serving fault has a real source. */
interface Faulty {
  readonly blockstore?: Blockstore
  readonly index?: RecordIndex
  /**
   * Give this node the production wiring: a `FetchingBlockstore` over these peers.
   *
   * A thunk, so a pair of nodes can name each other before either exists — which is also
   * how `fabric-node.ts` and `browser-node.ts` pass `verifiedPeers` and `transport.peers`.
   * Absent, the node serves a bare `MemoryBlockstore` with no network fallback at all,
   * which is what every other case in this file wants and is why this is opt-in.
   */
  readonly fetchesFrom?: () => readonly string[]
}

function servingNode(nodeId: string, faulty: Faulty = {}): Node {
  const guard = new CountingGuard(network.connect(nodeId), OWNER_ID)
  const rpc = new RpcEndpoint(guard, { timeoutMs: 2_000 })
  const store = new MemoryBlockstore()
  const served =
    faulty.blockstore ??
    (faulty.fetchesFrom === undefined
      ? store
      : new FetchingBlockstore(store, new RpcBlockSource(rpc, faulty.fetchesFrom)))
  serveAgent({
    paused: 'never-pauses',
    rpc,
    executor: stubExecutor(nodeId),
    blockstore: served,
    // This file takes holds directly, so the store the serve path would declare
    // from is deliberately empty: nothing here is meant to register through a task.
    egress: { guard, sovereignInputs: new MemoryBlockstore(), sovereignCids: 'forgets-sovereignty-between-jobs' },
    authorize: 'serves-unauthenticated',
    index: faulty.index ?? 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })
  return {
    nodeId,
    guard,
    store,
    served,
    close() {
      rpc.close()
    },
  }
}

describe('criterion 7 — a refusal, a hit and a miss stay three distinguishable answers', () => {
  it('names the refusal for registered bytes, serves an unregistered block, and reports a miss as a miss', async () => {
    const node = servingNode('alice-block')
    const rpc = new RpcEndpoint(network.connect('requestor-block'), { timeoutMs: 2_000 })
    try {
      const sovereign = encoded(SOVEREIGN_ROW)
      const sovereignCid = await node.store.put(sovereign)
      const publicCid = await node.store.put(encoded(PUBLIC_ROW))
      // Held by nobody — the CID is computed from bytes this node never stores.
      const absentCid = await new MemoryBlockstore().put(encoded({ nothing: 'here' }))

      node.guard.guard(sovereignCid.toString(), sovereign)

      // 1. The refusal, by name.
      const refused = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'block', cid: sovereignCid })),
      )
      expect(refused?.kind).toBe('error')
      if (refused?.kind !== 'error') return
      expect(refused.reason.startsWith('egress refused: ')).toBe(true)
      expect(refused.reason).toContain(sovereignCid.toString())
      expect(refused.reason).toContain(node.nodeId)

      // 2. The hit. The same node, still serving what it is free to serve — so the
      //    refusal above is specific to the registration and not this node having
      //    stopped answering block requests.
      const hit = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'block', cid: publicCid })),
      )
      expect(hit?.kind).toBe('block')
      if (hit?.kind !== 'block') return
      expect(hit.bytes).toEqual(encoded(PUBLIC_ROW))

      // 3. The miss, still a miss. A refusal must not be readable as absence and
      //    absence must not be readable as a refusal.
      const miss = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'block', cid: absentCid })),
      )
      expect(miss?.kind).toBe('block')
      if (miss?.kind !== 'block') return
      expect(miss.bytes).toBeNull()

      // The refusal is on the node's own tap too, with its label, contributing no
      // bytes — the same entry a send-time refusal would have produced.
      const manifest = node.guard.manifest
      expect(manifest.violations).toEqual([sovereignCid.toString()])
      expect(manifest.entries.some((entry) => entry.violation === sovereignCid.toString())).toBe(true)
      // Paired: the three replies that *did* leave are on the same manifest, so a
      // single violation entry is not a manifest that recorded only failures.
      expect(manifest.entries.length).toBeGreaterThan(1)
      expect(manifest.totalBytes).toBeGreaterThan(0)
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('a serving fault is a fourth answer, not a fourth flavour of miss', () => {
  /** Fails the way a disk does: on the read, with a path in the message. */
  const unreadableStore: Blockstore = {
    put: () => Promise.reject(new Error('EIO: disk write failed')),
    get: () => Promise.reject(new Error('EIO: disk read failed on /var/o2/blocks/ab/cd')),
    has: () => Promise.reject(new Error('EIO: disk read failed on /var/o2/blocks/ab/cd')),
    size: 0,
  }

  it('names a blockstore read failure instead of reporting the block absent', async () => {
    const node = servingNode('unreadable-node', { blockstore: unreadableStore })
    const rpc = new RpcEndpoint(network.connect('requestor-unreadable'), { timeoutMs: 2_000 })
    try {
      const cid = await new MemoryBlockstore().put(encoded(PUBLIC_ROW))

      const answer = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'block', cid })),
      )
      expect(answer?.kind).toBe('error')
      if (answer?.kind !== 'error') return
      // The prefix is wire vocabulary beside `egress refused: ` and
      // `over-committed: `, pinned here so it cannot drift.
      expect(answer.reason.startsWith('serving failed on ')).toBe(true)
      expect(answer.reason).toContain('EIO')
      expect(answer.reason).toContain(node.nodeId)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('is a property of the handler rather than of the block branch', async () => {
    // A second branch, so the evidence is about the class. One branch covered would
    // be exactly the weakness of catching per branch in the first place.
    const failingIndex: RecordIndex = {
      providers: () => Promise.reject(new Error('EIO: index read failed')),
      recordsFor: () => Promise.reject(new Error('EIO: index read failed')),
    }
    const node = servingNode('unreadable-index', { index: failingIndex })
    const rpc = new RpcEndpoint(network.connect('requestor-index'), { timeoutMs: 2_000 })
    try {
      const answer = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'records', nodeKey: 'ab12' })),
      )
      expect(answer?.kind).toBe('error')
      if (answer?.kind !== 'error') return
      expect(answer.reason.startsWith('serving failed on ')).toBe(true)
      expect(answer.reason).toContain('EIO')
      expect(answer.reason).toContain(node.nodeId)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('still lets a multi-peer fetch step over the broken node to the one that holds it', async () => {
    // Load-bearing pair: naming the fault must not be bought by turning one bad peer
    // into a fetch that fails for everybody. `RpcBlockSource` treating any non-block
    // reply as a miss is the documented degrade, and this pins it.
    const broken = servingNode('broken-holder', { blockstore: unreadableStore })
    const holder = servingNode('good-holder')
    const rpc = new RpcEndpoint(network.connect('requestor-fallback'), { timeoutMs: 2_000 })
    try {
      const cid = await holder.store.put(encoded(PUBLIC_ROW))
      const source = new RpcBlockSource(rpc, () => [broken.nodeId, holder.nodeId])
      expect(await source.fetch(cid)).toEqual(encoded(PUBLIC_ROW))
    } finally {
      broken.close()
      holder.close()
      rpc.close()
    }
  })
})

describe('a node holding no registrations pays nothing for the pre-scan', () => {
  it('never asks the guard about a reply, on either branch, while the guard is demonstrably live', async () => {
    const node = servingNode('idle-node')
    const rpc = new RpcEndpoint(network.connect('requestor-idle'), { timeoutMs: 2_000 })
    try {
      const blockCid = await node.store.put(encoded(PUBLIC_ROW))
      const moduleCid = await node.store.put(new Uint8Array([0, 97, 115, 109]))
      const task: Task = {
        moduleCid,
        inputCid: blockCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      }

      const block = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'block', cid: blockCid })),
      )
      expect(block?.kind).toBe('block')

      const exec = parseResponse(await rpc.request(node.nodeId, encodeRequest({ kind: 'exec', task })))
      expect(exec?.kind).toBe('exec')
      if (exec?.kind !== 'exec') return
      expect(exec.outcome.ok).toBe(true)

      // The absence, and the proof the instrument was live for it. `scans` is the
      // positive control on the same object: the guard scanned every frame that
      // actually left, so `prescans === 0` reports a question that was never asked
      // rather than a counter nobody attached.
      expect(node.guard.scans).toBeGreaterThan(0)
      expect(node.guard.prescans).toBe(0)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('does ask, on the same instrument, once something is registered', async () => {
    // The other half of the pair. Without this the zero above would be satisfied by
    // a helper that never calls the guard at all.
    const node = servingNode('busy-node')
    const rpc = new RpcEndpoint(network.connect('requestor-busy'), { timeoutMs: 2_000 })
    try {
      const blockCid = await node.store.put(encoded(PUBLIC_ROW))
      node.guard.guard('unrelated-label', encoded(SOVEREIGN_ROW))

      const block = parseResponse(
        await rpc.request(node.nodeId, encodeRequest({ kind: 'block', cid: blockCid })),
      )
      // Registered, but not *this* payload — so the reply is served, and the
      // pre-scan is nonetheless recorded as having been taken.
      expect(block?.kind).toBe('block')
      if (block?.kind !== 'block') return
      expect(block.bytes).toEqual(encoded(PUBLIC_ROW))
      expect(node.guard.prescans).toBeGreaterThan(0)
      expect(node.guard.manifest.violations).toEqual([])
    } finally {
      node.close()
      rpc.close()
    }
  })
})

/**
 * Two nodes wired to each other answer "not held" instead of waiting out the deadline.
 *
 * ## The reading that was wrong, and why it was wrong in a way this repo has seen before
 *
 * The reported symptom was *"two connected nodes each ask the other for a block neither
 * holds — 60 s timeout with no refusal"*, and the recorded diagnosis read that as a
 * missing refusal branch. It is not one: `serveAgent`'s block arm has answered
 * `{ kind: 'block', bytes: bytes ?? null }` all along, and `RpcBlockSource` has always
 * treated that `null` as a miss and moved to the next peer. **Both halves of the named
 * refusal were already correct.** What was wrong is that control never reached them.
 *
 * The 60 s was never a fact about blocks. It is `packages/browser/demo/main.ts`'s own
 * `rpcTimeoutMs: 60_000`, and re-siting the bound moves the reading with it — the fixture
 * below reads ~2 002 ms against a 2 000 ms budget. *A duration equal to a timeout is
 * evidence of the timeout*, the rule this repository already paid for once on
 * `lift.node.test.ts` (defect #30), applied to a second sighting of the same shape.
 *
 * ## What actually happened, measured rather than reasoned
 *
 * In production `serveAgent`'s blockstore is a `FetchingBlockstore`, so a node asked for a
 * block it did not hold went to the network to find one *for the peer that had just asked
 * it*. A's `get` registers the CID in its in-flight map and asks B; B's serve path calls
 * its own `get`, which asks A; A's serve path calls `get` again and the in-flight map
 * hands it back the very promise that is waiting on B. Neither can resolve, so only the
 * RPC timer ends it.
 *
 * **The two arms below are the differentiator, and they run in one call** so the machine,
 * the load and the I/O weather cancel. A cycle and a chain of the same depth-2 shape: if
 * the deadlock were really "block fetches are slow", both would wait; only the cycle does.
 */
describe('a node answers for what it holds, not for what its peers might hold', () => {
  it('resolves a mutual fetch by name instead of by deadline, against a chain that never cycled', async () => {
    // Chain: A -> B -> C, and C has no fallback at all, so the walk terminates on its own.
    // This arm is the control. It shares every ingredient with the cycle below except the
    // cycle, so a slow reading here would mean the block path is slow and the diagnosis is
    // about something else entirely.
    const chainC = servingNode('chain-c')
    const chainB = servingNode('chain-b', { fetchesFrom: () => [chainC.nodeId] })
    const chainA = servingNode('chain-a', { fetchesFrom: () => [chainB.nodeId] })
    // Cycle: A <-> B, which is what any two peers of one mesh are.
    const cycleA = servingNode('cycle-a', { fetchesFrom: () => ['cycle-b'] })
    const cycleB = servingNode('cycle-b', { fetchesFrom: () => ['cycle-a'] })
    try {
      // Held by nobody: the CID is computed from bytes no node in this case ever stores.
      const absent = await new MemoryBlockstore().put(encoded({ nothing: 'here' }))

      const chainAt = Date.now()
      const chainGot = await chainA.served.get(absent)
      const chainMs = Date.now() - chainAt

      const cycleAt = Date.now()
      const cycleGot = await cycleA.served.get(absent)
      const cycleMs = Date.now() - cycleAt

      // Both report absence — that half was never broken and is asserted so a regression
      // cannot buy promptness by inventing bytes or by throwing.
      expect(chainGot).toBeUndefined()
      expect(cycleGot).toBeUndefined()

      // The claim. Comparative within one run rather than an absolute: the cycle must not
      // cost meaningfully more than the chain that did the same amount of real work. The
      // endpoints are built at `timeoutMs: 2_000`, so the defect reads ~2 002 ms here and
      // the fix reads single-digit milliseconds — three orders of magnitude of headroom
      // for a slow or contended host before this becomes flaky.
      expect(cycleMs).toBeLessThan(chainMs + 500)
      // And an absolute floor under the pair, so a future change that made BOTH arms wait
      // out the deadline could not satisfy the comparison above by moving them together.
      expect(cycleMs).toBeLessThan(1_000)
    } finally {
      chainA.close()
      chainB.close()
      chainC.close()
      cycleA.close()
      cycleB.close()
    }
  })

  it('still serves a block it does hold, so the gate did not simply stop answering', async () => {
    // The positive control the case above cannot supply: a node wired for fetching, asked
    // for something it holds locally, must still serve the bytes. Without this, deleting
    // the block branch outright would pass every assertion above.
    const holder = servingNode('cycle-holder', { fetchesFrom: () => ['cycle-asker'] })
    const asker = servingNode('cycle-asker', { fetchesFrom: () => ['cycle-holder'] })
    try {
      const cid = await holder.store.put(encoded(PUBLIC_ROW))
      // Asked across the same mutually-wired pair that deadlocks on an absent CID.
      expect(await asker.served.get(cid)).toEqual(encoded(PUBLIC_ROW))
    } finally {
      holder.close()
      asker.close()
    }
  })
})
