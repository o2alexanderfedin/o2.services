import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MAX_CONCURRENT_TASKS, publicNodes, runResilient } from '@o2/core'
import type { ShardWork, Task } from '@o2/core'
import { encodeRequest, parseResponse, remoteDispatch } from '@o2/net'
import type { AgentResponse } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * SCHED-06 and NET-08, against tcp + noise + yamux with real `FabricNode`s.
 *
 * `startNode` below is the same `FabricNode.start` call `bin/agent.ts` makes — no
 * test-only bypass, no hand-built fabric — and here that is the point rather than
 * good hygiene. SCHED-06's criterion 2 asks whether the **production factory** wires
 * its admission control; a hand-built fabric would answer a different question
 * perfectly convincingly. `packages/net/src/admission.test.ts` already answers that
 * different question one layer down over `MemoryNetwork`, and neither file is asked
 * to stand in for the other.
 *
 * ## Which instrument reads which claim
 *
 * - `node.executorPeakInFlight` is the **measurement**. It counts `execute()` calls
 *   that happened, from the `CountingExecutor` the factory composes outermost around
 *   its own executor, so it can read any number at all — 64 as easily as 2 — which
 *   is what makes an assertion about it falsifiable. It is a valid *bound* reading
 *   only because every dispatch in this file arrives over RPC: a caller reaching
 *   `node.executor` directly takes no admission slot, because admission lives on
 *   `serveAgent`'s exec branch and a local call never reaches it.
 * - `node.admission.peakInFlight` is a **reachedness reading, not a bound reading**.
 *   `LocalCapacity.offer()` returns its refusal before the reservation is taken, so
 *   `peakInFlight <= slots` is arithmetic and cannot fail. Anybody tempted to drop
 *   the executor-level assertion because "the capacity peak already proves it" is
 *   about to delete the only falsifiable half of criterion 1 on this path.
 *
 * ## Why there are two requestors, and what the send gate does not do
 *
 * NET-09's per-peer send gate bounds concurrent *streams* toward one peer. It does
 * **not** bound how many `exec` requests are outstanding at the receiver, and no
 * comment in this file may say it does. The call chain, written down so nobody
 * re-derives it: `Transport.send` is a one-way datagram that resolves when
 * `stream.close()` completes; the registered protocol handler awaits `readMessage`
 * and then calls the transport's dispatch synchronously; and `RpcEndpoint`
 * subscribes with `void this.#receive(...)`, so the reply is never awaited through
 * `send`. A stream is released as soon as the request bytes land, long before the
 * task it carries has run. **Request and execution are decoupled, so the number of
 * `exec` requests concurrent at a node is neither bounded by the gate nor
 * predictable from it.** How many actually are concurrent is what
 * `executorPeakInFlight` reads, and only a measured figure may ever be written down.
 *
 * So the second requestor is not there to raise a ceiling. It is there to prove the
 * bound being measured is the **node's** and not any one sender's: with a single
 * sender, a reading of "at most 2" is equally consistent with a per-sender bound
 * nobody declared. Two independent senders, neither of which knows about the other,
 * leave only the node as the thing doing the bounding. This is also why
 * `maxConcurrentTasks` is an option and not only a constant — the refusal has to be
 * made certain rather than hoped for.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    ...extra,
  })
  running.push(node)
  return node
}

/**
 * A dispatch whose reply never arrived, turned into a value so it can be counted.
 *
 * Measured, not anticipated: run against the factory *before* it passed its
 * `LocalCapacity` to `serveAgent`, the 64-request case did not read "zero refusals"
 * — it read
 * `RpcFailure: rpc to 12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q timed out
 * after 20000ms`, because a rejected `rpc.request` inside `Promise.all` rejects the
 * whole batch and destroys every reading in the test. That is the roadmap's defect
 * showing up as latency rather than as a refusal, and it is worth a number rather
 * than a stack trace. So a failed request becomes a countable reply and the
 * assertions below state, separately, that after the fix there are none.
 */
interface NoReply {
  readonly kind: 'no-reply'
  readonly reason: string
}

/** Dispatch over the real wire and read the raw reply, not `RemoteExecutor`'s flattening. */
async function dispatch(from: FabricNode, to: string, task: Task): Promise<AgentResponse | NoReply | null> {
  try {
    return parseResponse(await from.rpc.request(to, encodeRequest({ kind: 'exec', task })))
  } catch (cause) {
    return { kind: 'no-reply', reason: cause instanceof Error ? cause.message : String(cause) }
  }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-admission-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('SCHED-06 — the production factory declares its limit', () => {
  it('defaults to the shipped constant and honours an override', async () => {
    const [byDefault, overridden] = await Promise.all([
      startNode('slots-default'),
      startNode('slots-two', { maxConcurrentTasks: 2 }),
    ])
    // The default is a value the node can be *asked* for, not an implicit one.
    expect(byDefault.admission.slots).toBe(DEFAULT_MAX_CONCURRENT_TASKS)
    expect(overridden.admission.slots).toBe(2)
    // No duty cycle is fed in, on either. `slots` is `maxConcurrent` untouched.
    expect(byDefault.admission.inFlight).toBe(0)
  }, 30_000)

  it('refuses a nonsense limit at construction rather than absorbing it', async () => {
    // `LocalCapacity`'s own constructor guard, reached because the factory passes the
    // option straight through instead of clamping it to something plausible.
    await expect(
      FabricNode.start({
        blockstoreDir: join(workdir, 'slots-zero'),
        listen: ['/ip4/127.0.0.1/tcp/0'],
        maxConcurrentTasks: 0,
      }),
    ).rejects.toThrow(/maxConcurrent must be a positive integer, got 0/)
  }, 30_000)
})

describe('SCHED-06 criterion 1 — 64 concurrent exec requests from two real peers', () => {
  it('refuses with its own words, and never ran more than its slot count at once', async () => {
    const [nodeUnderTest, alpha, beta] = await Promise.all([
      startNode('under-test', { maxConcurrentTasks: 2 }),
      startNode('alpha'),
      startNode('beta'),
    ])
    await Promise.all([
      alpha.dial(nodeUnderTest.multiaddrs[0] as string),
      beta.dial(nodeUnderTest.multiaddrs[0] as string),
    ])

    // Each requestor holds the module and **its own** input block.
    //
    // Distinct `inputCid`s are load-bearing and the reason is easy to get wrong. The
    // exec slot key is derived — an `exec` frame carries no shard id — from
    // `inputCid` plus `partitionIndex`. With one shared `inputCid`, alpha's index 5
    // and beta's index 5 would produce the *same* key, all 32 pairs would collide,
    // and the replies would read `already in flight here` rather than
    // `over-committed: 2 of 2 slots in use`. Two requestors submitting two different
    // jobs is also the more realistic shape. If the reason-string assertion below
    // ever fails, check these are still distinct before changing anything else.
    const moduleCid = await alpha.store.put(MODULE_WRITES_PARTITION)
    await beta.store.put(MODULE_WRITES_PARTITION)
    const alphaInput = await alpha.store.put(new Uint8Array([0x80])) // dag-cbor []
    const betaInput = await beta.store.put(new Uint8Array([0x81, 0x00])) // dag-cbor [0]
    expect(alphaInput.toString()).not.toBe(betaInput.toString())

    const PER_REQUESTOR = 32
    const taskFor = (inputCid: typeof alphaInput, partitionIndex: number): Task => ({
      moduleCid,
      inputCid,
      partitionIndex,
      partitionCount: PER_REQUESTOR,
      label: 'public',
    })

    const replies = await Promise.all([
      ...Array.from({ length: PER_REQUESTOR }, (_, i) =>
        dispatch(alpha, nodeUnderTest.peerId, taskFor(alphaInput, i)),
      ),
      ...Array.from({ length: PER_REQUESTOR }, (_, i) =>
        dispatch(beta, nodeUnderTest.peerId, taskFor(betaInput, i)),
      ),
    ])

    // The instrument is live before anything is claimed about what it did not see:
    // every dispatch came back, and work really did reach the executor.
    expect(replies).toHaveLength(PER_REQUESTOR * 2)
    expect(replies.some((r) => r?.kind === 'exec' && r.outcome.ok)).toBe(true)
    expect(nodeUnderTest.executorPeakInFlight).toBeGreaterThan(0)
    // Every dispatch was *answered*. Soft, and reported with its reasons, because
    // this is the reading that changed shape when the factory started refusing: a
    // node that runs everything at once answers late enough to time out, and a node
    // that refuses answers immediately. See `NoReply` above for the measurement.
    expect
      .soft(replies.filter((r) => r?.kind === 'no-reply').map((r) => (r as NoReply).reason))
      .toEqual([])

    // The two readings that are the measurement, paired with `expect.soft` so a
    // mutation run reports **both** rather than only whichever comes first. A peak
    // alone passes trivially if nothing was dispatched; refusals alone pass if the
    // bound held by luck.
    const refusals = replies.filter((r) => r?.kind === 'error')
    expect.soft(nodeUnderTest.executorPeakInFlight).toBeLessThanOrEqual(2)
    expect.soft(refusals.length).toBeGreaterThan(0)
    for (const refusal of refusals) {
      if (refusal?.kind !== 'error') continue
      expect(refusal.reason.startsWith('over-committed: ')).toBe(true)
    }
    expect(
      refusals.some((r) => r?.kind === 'error' && r.reason.includes('2 of 2 slots in use')),
    ).toBe(true)

    // The limit was actually *reached* rather than never approached. That is the
    // only claim this counter can make — `peakInFlight <= slots` is arithmetic in
    // `LocalCapacity` and cannot fail, so it is never evidence the bound held.
    expect(nodeUnderTest.admission.peakInFlight).toBe(2)
    // Every slot taken was given back.
    expect(nodeUnderTest.admission.inFlight).toBe(0)
    expect(nodeUnderTest.executorInFlight).toBe(0)
  }, 120_000)

  it('refuses a replay of the identical task while the first is still running', async () => {
    const [node, caller] = await Promise.all([
      startNode('dedupe-node', { maxConcurrentTasks: 4 }),
      startNode('dedupe-caller'),
    ])
    await caller.dial(node.multiaddrs[0] as string)

    const moduleCid = await caller.store.put(MODULE_WRITES_PARTITION)
    const inputCid = await caller.store.put(new Uint8Array([0x80]))
    const same: Task = { moduleCid, inputCid, partitionIndex: 0, partitionCount: 2, label: 'public' }

    const [a, b] = await Promise.all([
      dispatch(caller, node.peerId, same),
      dispatch(caller, node.peerId, same),
    ])

    // Instrument live: one of the pair really did run. Without this, "exactly one
    // refusal" would also be satisfied by a node that refused both for some other
    // reason entirely.
    expect([a, b].some((r) => r?.kind === 'exec' && r.outcome.ok)).toBe(true)
    const refused = [a, b].filter((r) => r?.kind === 'error')
    expect(refused).toHaveLength(1)
    const only = refused[0]
    if (only?.kind !== 'error') throw new Error('expected an error reply')
    expect(only.reason).toContain('already in flight here')
    // The key names the work, not the request: input CID plus partition index.
    expect(only.reason).toContain(`${inputCid.toString()}:0`)
    expect(node.admission.inFlight).toBe(0)
  }, 60_000)
})

describe('SCHED-06 criterion 1, second clause — the requestor re-picks', () => {
  it('re-picks onto a node that did not refuse, on the coordinator path', async () => {
    // **This is the coordinator path, and it is the only path on which a re-pick is
    // demonstrable at all.** `runResilient` and `remoteDispatch` have no production
    // caller; the production `submitJob` path places, runs `executeVerified` once
    // per selected executor and reports, with no retry, no generation and no
    // resample. So criterion 1's second clause is *unmeasured on every path that
    // runs in production*, and this test proves a mechanism rather than a production
    // behaviour. See 13.1-05-SUMMARY.md, which says so in those words.
    const [requestor, first, second] = await Promise.all([
      startNode('repick-req'),
      startNode('repick-w1', { maxConcurrentTasks: 1 }),
      startNode('repick-w2', { maxConcurrentTasks: 1 }),
    ])
    await Promise.all([
      requestor.dial(first.multiaddrs[0] as string),
      requestor.dial(second.multiaddrs[0] as string),
    ])

    const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
    const inputCid = await requestor.store.put(new Uint8Array([0x80]))

    // Which worker is probed first is deterministic, not lucky: `placeWithOffers`
    // samples by rendezvous rank and `leastLoaded` breaks the all-zero-load tie by
    // ascending node id. So the worker with the lexicographically smaller peer id is
    // attempted first, and that is the one to saturate.
    const [busy, free] = [first, second].sort((a, b) => a.peerId.localeCompare(b.peerId)) as [
      FabricNode,
      FabricNode,
    ]

    // Saturation is *declared*, not raced. The slot is reserved directly on the
    // node's own `LocalCapacity` — the same object `serveAgent`'s exec branch
    // reserves against — under a key that is not any task's derived key, so the
    // incoming request meets the over-committed branch and not the dedupe branch.
    // A test that is *usually* saturated is worse than one that says how it made
    // certain, and every other part of this run is real: the refusal is composed by
    // the node, travels the real wire, is classified by `remoteDispatch`, and the
    // re-pick is `runResilient`'s own.
    const held = busy.admission.offer({ shardId: 'held-by-this-test', nodeId: busy.peerId })
    expect(held.accepted).toBe(true)
    expect(busy.admission.inFlight).toBe(1)

    const work: ShardWork[] = [{ shardId: 's0', label: 'public' }]
    const outcome = await runResilient({
      work,
      nodes: publicNodes([{ nodeId: busy.peerId }, { nodeId: free.peerId }]),
      now: () => Date.now(),
      dispatch: remoteDispatch({
        rpc: requestor.rpc,
        blockstore: requestor.store,
        taskFor: () => ({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1, label: 'public' }),
      }),
    })

    expect(outcome.ok).toBe(true)
    const shard = outcome.shards[0]
    if (shard === undefined) throw new Error('expected one shard outcome')

    // Both nodes were attempted, busy first, and the busy one's refusal is recorded
    // as a **node** condition — the same task on another node succeeds, which is
    // exactly what happened next.
    expect(shard.attempted).toEqual([busy.peerId, free.peerId])
    expect(shard.failures).toHaveLength(1)
    expect(shard.failures[0]?.nodeId).toBe(busy.peerId)
    expect(shard.failures[0]?.kind).toBe('node')
    expect(shard.failures[0]?.reason).toContain('over-committed: 1 of 1 slots in use')

    // And the shard completed, on the node that did not refuse.
    expect(shard.resultCid).not.toBeNull()
    expect(shard.nodeId).toBe(free.peerId)
    // The busy node never ran it: its executor was never entered at all.
    expect(busy.executorPeakInFlight).toBe(0)
    expect(free.executorPeakInFlight).toBeGreaterThan(0)

    busy.admission.release('held-by-this-test')
  }, 120_000)
})

describe('NET-08 — the receive cap is reachable from the factory', () => {
  it('a node started with a small maxMessageBytes refuses a frame a default node accepts', async () => {
    // 100 KiB, the same block `fabric-node.node.test.ts` carries deliberately: above
    // the override below and far under the shipped default, so the two nodes give
    // opposite answers to one identical request.
    const big = new Uint8Array(100 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff

    const [src, capped, plain] = await Promise.all([
      startNode('cap-src'),
      // A short RPC budget only for the capped node: the refused reply never
      // arrives, so its `rpc.request` resolves by timing out and there is nothing to
      // be gained from waiting the production 30 s to find that out.
      startNode('cap-small', { maxMessageBytes: 65_536, rpcTimeoutMs: 5_000 }),
      startNode('cap-default'),
    ])
    await Promise.all([
      capped.dial(src.multiaddrs[0] as string),
      plain.dial(src.multiaddrs[0] as string),
    ])

    const bigCid = await src.store.put(big)
    const smallCid = await src.store.put(new Uint8Array([1, 2, 3, 4]))

    expect(capped.transport.refusedInbound).toBe(0)
    expect(await capped.blockstore.get(bigCid)).toBeUndefined()
    // The instrument that says *why* it came back empty: the cap fired, rather than
    // the peer simply not having the block.
    expect(capped.transport.refusedInbound).toBe(1)
    // ...and the connection survived the abort. A small block over the same
    // connection still arrives, which is what distinguishes "aborted the stream"
    // from "killed the connection".
    expect(await capped.blockstore.get(smallCid)).toEqual(new Uint8Array([1, 2, 3, 4]))

    // The paired positive: the identical request against a node started with no
    // override is answered in full, so the refusal above is the option taking
    // effect and not a property of the block or of the transport.
    expect(await plain.blockstore.get(bigCid)).toEqual(big)
    expect(plain.transport.refusedInbound).toBe(0)
  }, 120_000)
})
