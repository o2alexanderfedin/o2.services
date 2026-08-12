import { LocalCapacity, MemoryBlockstore, MemoryNetwork, WasmExecutor, placeWithOffers } from '@o2/core'
import type { NodeDescriptor, Task } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { serveAgent } from './agent.ts'
import { rpcAdmission } from './discovery.ts'
import { encodeRequest, parseResponse } from './protocol.ts'
import type { AgentResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * SCHED-03 / SCHED-06 — PAUSED, a node that is alive, reachable, unchanged in what
 * it can do, and declining all work right now.
 *
 * ## What this file measures, and against what
 *
 * `LocalCapacity.slots` floors at 1 and says why at the getter: *"at zero slots
 * `#decide` would refuse everything, which is a node that has left rather than a
 * node that is going slowly."* So the capacity mechanism deliberately cannot express
 * a deliberate stop, and before this file an operator who wanted one had to kill the
 * process — losing discoverability and reservations — or throttle, which the floor
 * makes impossible. The three states are distinct facts and each wants a different
 * answer from a requestor:
 *
 * | state | what it is | what a requestor should do |
 * |---|---|---|
 * | busy | at capacity, load drains | retry soon |
 * | **paused** | declining all work, by choice | drop from this shard's candidates, keep the node known |
 * | off | unreachable | let the transport re-dial |
 *
 * Every assertion below is therefore paired: the same node, the same capacity, the
 * same eligibility, measured with the pause on and with it off. A refusal read only
 * in the paused arm would be indistinguishable from a node that refuses everything.
 *
 * ## Why the refusal text is asserted rather than a type
 *
 * `paused: ` joins `over-committed: `, `egress refused: `, `unauthorized: ` and
 * `unreachable: ` as wire vocabulary — composed in exactly one place and asserted
 * here by text so it cannot drift. What that deliberately does **not** buy is
 * control flow: `agent.ts` already records that a requestor "cannot tell
 * `malformed request` from `over-committed: …` without reading the string", and a
 * reason string is consumed as an explanation and never as a decision. The
 * requestor-side half of the table above — *do not retry soon* — is consequently
 * **not** delivered by this mechanism and is not claimed anywhere below.
 *
 * ## Bare suffix on purpose
 *
 * `serveAgent` is portable and `vitest.config.ts` runs `packages/&#42;/src/&#42;&#42;/&#42;.test.ts` in
 * both the `node` and `browser` projects, so this spec runs in Chromium too.
 */

/** One shared network: every `it` uses distinct node ids, so nothing observes another's frames. */
const network = new MemoryNetwork()

/** dag-cbor `[]` — the one input block every task in this file reads. */
const INPUT_BYTES = new Uint8Array([0x80])

/**
 * Two combine inputs, dag-cbor `[1]` and `[2]`.
 *
 * Two rather than one because `parseRequest` refuses a combine naming fewer than two
 * inputs — `deriveReduceTree` promotes a lone child rather than wrapping it — and
 * distinct from {@link INPUT_BYTES} so the CIDs differ.
 */
const PARTIAL_BYTES = new Uint8Array([0x81, 0x01])
const SECOND_PARTIAL_BYTES = new Uint8Array([0x81, 0x02])

interface ServingNode {
  readonly nodeId: string
  readonly capacity: LocalCapacity
  /** Flipped by a test between requests — the whole point of the thunk. */
  pause(value: boolean): void
  task(partitionIndex: number): Task
  /** Blocks this node holds and will serve, paused or not. Also the combine's inputs. */
  readonly heldCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly secondHeldCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  close(): void
}

/**
 * One serving node with a real `LocalCapacity` and a live pause thunk.
 *
 * `maxConcurrent` is deliberately generous everywhere in this file: the claim under
 * test is that a node with room to spare still refuses, so a node that could have
 * been full for an unrelated reason would prove nothing.
 */
async function servingNode(options: {
  nodeId: string
  maxConcurrent?: number
  pausedAtStart?: boolean
}): Promise<ServingNode> {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(MODULE_WRITES_PARTITION)
  const inputCid = await store.put(INPUT_BYTES)
  const heldCid = await store.put(PARTIAL_BYTES)
  const secondHeldCid = await store.put(SECOND_PARTIAL_BYTES)

  let paused = options.pausedAtStart ?? false
  const capacity = new LocalCapacity({
    nodeId: options.nodeId,
    maxConcurrent: options.maxConcurrent ?? 8,
  })
  const rpc = new RpcEndpoint(network.connect(options.nodeId), { timeoutMs: 5_000 })
  serveAgent({
    rpc,
    executor: new WasmExecutor({ nodeId: options.nodeId, blockstore: store }),
    blockstore: store,
    capacity,
    // Read on every request, never captured: an operator toggles this at runtime.
    paused: () => paused,
    authorize: 'serves-unauthenticated',
    egress: 'holds-no-registrations',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })

  return {
    nodeId: options.nodeId,
    capacity,
    heldCid,
    secondHeldCid,
    pause(value) {
      paused = value
    },
    task: (partitionIndex) => ({
      moduleCid,
      inputCid,
      partitionIndex,
      partitionCount: 8,
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

async function ask(rpc: RpcEndpoint, to: string, body: Parameters<typeof encodeRequest>[0]): Promise<AgentResponse | null> {
  return parseResponse(await rpc.request(to, encodeRequest(body)))
}

describe('a paused node declines work it has room for', () => {
  it('refuses an offer it accepts when not paused, with the same slots free', async () => {
    const node = await servingNode({ nodeId: 'pause-offer' })
    const rpc = requestorFor('pause-offer')
    try {
      // The control arm. Without it a refusal below could be a node that refuses
      // everything for some reason nothing here named.
      const running = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      expect(running?.kind).toBe('offer')
      if (running?.kind !== 'offer') throw new Error('fixture')
      expect(running.accepted).toBe(true)

      node.pause(true)
      const stopped = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (stopped?.kind !== 'offer') throw new Error('fixture')
      expect(stopped.accepted).toBe(false)

      // Nothing was consumed by either question, so the second refusal is about the
      // posture and not about a slot the first one took.
      expect(node.capacity.inFlight).toBe(0)
      expect(node.capacity.peakInFlight).toBe(0)
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('names the refusal `paused:` and never `over-committed:`, on all three work branches', async () => {
    const node = await servingNode({ nodeId: 'pause-named', pausedAtStart: true })
    const rpc = requestorFor('pause-named')
    try {
      const offered = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.reason).toBe('paused: pause-named is declining all work right now')

      // A **node** condition, the same shape and the same retry policy the capacity
      // refusal takes on this branch: the identical task on another node succeeds.
      const executed = await ask(rpc, node.nodeId, { kind: 'exec', task: node.task(0) })
      expect(executed?.kind).toBe('error')
      if (executed?.kind !== 'error') throw new Error('fixture')
      expect(executed.reason).toBe('paused: pause-named is declining all work right now')

      // The *combine* shape and not an `error` frame — `executeReduce` reads
      // `resultCid: null` as "try the next executor in the ranking", which is the
      // right answer from a node that has stepped out.
      const combined = await ask(rpc, node.nodeId, {
        kind: 'combine',
        combineId: 'c0',
        inputCids: [node.heldCid, node.secondHeldCid],
        level: 1,
      })
      if (combined?.kind !== 'combine') throw new Error('fixture')
      expect(combined.resultCid).toBe(null)
      expect(combined.reason).toBe('paused: pause-named is declining all work right now')

      // The misattribution this state exists to prevent: a paused node is not full,
      // and must never say it is.
      for (const reason of [offered.reason, executed.reason, combined.reason]) {
        expect(reason).not.toContain('over-committed')
        expect(reason).not.toContain('slots in use')
      }
    } finally {
      node.close()
      rpc.close()
    }
  })

  it('states its capacity unchanged while paused — the refusal is posture, not room', async () => {
    const node = await servingNode({ nodeId: 'pause-capacity', maxConcurrent: 4 })
    const rpc = requestorFor('pause-capacity')
    try {
      const running = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (running?.kind !== 'offer') throw new Error('fixture')
      expect(running.capacity).toEqual({ slots: 4, inFlight: 0 })

      node.pause(true)
      const stopped = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (stopped?.kind !== 'offer') throw new Error('fixture')
      // Read next to the refusal, deliberately. The capacity figure alone is also what
      // an unpaused node says, so on its own this assertion is satisfied by a node that
      // never paused at all.
      expect(stopped.accepted).toBe(false)
      // Byte-for-byte what it said when it was taking work. "My capabilities are
      // unchanged" is a claim this frame has to carry, or a requestor cannot tell a
      // paused node from one that has shrunk to nothing.
      expect(stopped.capacity).toEqual({ slots: 4, inFlight: 0 })
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('pausing declines work, and nothing else', () => {
  it('still answers blocks, records, providers, reservations and reports while paused', async () => {
    const node = await servingNode({ nodeId: 'pause-alive', pausedAtStart: true })
    const rpc = requestorFor('pause-alive')
    try {
      // The whole difference from an unreachable node: every one of these gets an
      // answer, and it is the same answer an unpaused node gives.
      const block = await ask(rpc, node.nodeId, { kind: 'block', cid: node.heldCid })
      expect(block?.kind).toBe('block')
      if (block?.kind !== 'block') throw new Error('fixture')
      expect(block.bytes).toEqual(PARTIAL_BYTES)

      const providers = await ask(rpc, node.nodeId, { kind: 'providers', cid: node.heldCid })
      expect(providers?.kind).toBe('providers')

      const records = await ask(rpc, node.nodeId, { kind: 'records', nodeKey: 'ff' })
      expect(records?.kind).toBe('records')

      const reservations = await ask(rpc, node.nodeId, { kind: 'reservations' })
      expect(reservations?.kind).toBe('reservations')

      const report = await ask(rpc, node.nodeId, { kind: 'report', outcome: null })
      expect(report?.kind).toBe('report')
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe("'never-pauses' is today's behaviour, stated", () => {
  it('accepts and executes exactly as before', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)
    const inputCid = await store.put(INPUT_BYTES)
    const rpc = new RpcEndpoint(network.connect('never-pauses'), { timeoutMs: 5_000 })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: 'never-pauses', blockstore: store }),
      blockstore: store,
      capacity: new LocalCapacity({ nodeId: 'never-pauses', maxConcurrent: 4 }),
      paused: 'never-pauses',
      authorize: 'serves-unauthenticated',
      egress: 'holds-no-registrations',
      index: 'serves-no-records',
      enroll: 'issues-no-certificates',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
      attest: 'signs-nothing',
    })
    const client = requestorFor('never-pauses')
    try {
      const offered = await ask(client, 'never-pauses', { kind: 'offer', shardId: 's0' })
      if (offered?.kind !== 'offer') throw new Error('fixture')
      expect(offered.accepted).toBe(true)
      expect(offered.reason).toBe('')

      const executed = await ask(client, 'never-pauses', {
        kind: 'exec',
        task: { moduleCid, inputCid, partitionIndex: 0, partitionCount: 8, label: 'public' as const },
      })
      if (executed?.kind !== 'exec') throw new Error('fixture')
      expect(executed.outcome.ok).toBe(true)
    } finally {
      rpc.close()
      client.close()
    }
  })
})

describe('un-pausing restores acceptance without a restart', () => {
  it('accepts again on the same served endpoint, with no reconstruction', async () => {
    const node = await servingNode({ nodeId: 'pause-toggle', pausedAtStart: true })
    const rpc = requestorFor('pause-toggle')
    try {
      const first = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (first?.kind !== 'offer') throw new Error('fixture')
      expect(first.accepted).toBe(false)

      node.pause(false)

      // Same endpoint, same `serveAgent` registration, same `LocalCapacity`. If the
      // thunk had been read once at construction this would still refuse.
      const second = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (second?.kind !== 'offer') throw new Error('fixture')
      expect(second.accepted).toBe(true)

      const executed = await ask(rpc, node.nodeId, { kind: 'exec', task: node.task(0) })
      if (executed?.kind !== 'exec') throw new Error('fixture')
      expect(executed.outcome.ok).toBe(true)

      // And back again, in the same run: the toggle is not one-way.
      node.pause(true)
      const third = await ask(rpc, node.nodeId, { kind: 'offer', shardId: 's0' })
      if (third?.kind !== 'offer') throw new Error('fixture')
      expect(third.accepted).toBe(false)
    } finally {
      node.close()
      rpc.close()
    }
  })
})

describe('placement re-picks past a paused node', () => {
  it('places the shard on the next candidate and records the refusal by name', async () => {
    const paused = await servingNode({ nodeId: 'repick-paused', pausedAtStart: true })
    const taking = await servingNode({ nodeId: 'repick-taking' })
    const rpc = requestorFor('repick')
    try {
      // The paused node is the *preferred* candidate — least loaded — so a placement
      // that lands elsewhere landed there by re-picking and not by ordering.
      const nodes: readonly NodeDescriptor[] = [
        {
          nodeId: paused.nodeId,
          ownerId: 'public',
          canExecuteSovereign: false,
          load: 0,
          certificate: 'carries-no-certificate',
        },
        {
          nodeId: taking.nodeId,
          ownerId: 'public',
          canExecuteSovereign: false,
          load: 0.5,
          certificate: 'carries-no-certificate',
        },
      ]

      const placement = await placeWithOffers(
        { shardId: 's0', label: 'public', redundancy: 1 },
        nodes,
        { d: 2, admit: rpcAdmission(rpc, { probeTimeoutMs: 2_000 }) },
      )

      // A paused node does not fail the shard — that is the whole difference from a
      // fabric with nowhere to put the work.
      expect(placement.status).toBe('placed')
      if (placement.status !== 'placed') throw new Error('fixture')
      expect(placement.nodeIds).toEqual([taking.nodeId])
      expect(placement.probed).toBe(2)

      // The refusal is carried through in the node's own words, so "why did this land
      // here" stays answerable after the fact.
      expect(placement.rejections).toEqual([
        { nodeId: paused.nodeId, reason: 'paused: repick-paused is declining all work right now' },
      ])
    } finally {
      paused.close()
      taking.close()
      rpc.close()
    }
  })
})
