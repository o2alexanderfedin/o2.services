import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MAX_CONCURRENT_TASKS,
  canonicalCid,
  encodeCanonical,
  fabricCombiner,
  publicNodes,
  submitJob,
} from '@o2/core'
import type { Blockstore, CanonicalValue, Task } from '@o2/core'
import { RemoteExecutor, encodeRequest, parseResponse, pausedRefusal } from '@o2/net'
import type { AgentResponse } from '@o2/net'
import type { CID } from 'multiformats/cid'
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
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    // DET-03: this file's subject is not provenance, and every dispatch in it is
    // in-process on the node being configured. Stated rather than defaulted — the
    // point of the field being required is that a reader counting this literal learns
    // which tests do not exercise the signed path. No job here carries a
    // `moduleRecord`: a node running with the opt-out has no guard to satisfy.
    trustAnchors: 'runs-unsigned-artifacts',
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
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        blockstoreDir: join(workdir, 'slots-zero'),
        listen: ['/ip4/127.0.0.1/tcp/0'],
        maxConcurrentTasks: 0,
        // DET-03 — see `startNode` above. This node never finishes starting.
        trustAnchors: 'runs-unsigned-artifacts',
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
  it('re-picks onto a node that did not refuse, on the production submit path', async () => {
    // **This ran through `runResilient` until Plan 20-12, and the paragraph here used to
    // say the re-pick was "unmeasured on every path that runs in production". That
    // sentence is now false and this is its correction.**
    //
    // It was true when it was written: `submitJob` placed, ran `executeVerified` once per
    // selected executor and reported, with no retry, no generation and no resample, so
    // the only re-pick in the tree was the coordinator's and this case proved a mechanism
    // rather than a production behaviour. Plan 20-01 gave `submitJob` a generation loop
    // and 20-04 read it across spawned `bin/agent.ts` processes; 20-12 then deleted
    // `runResilient` under WIRE-04. So the driver below is now `submitJob` itself and the
    // reading is a production behaviour. `13.1-05-SUMMARY.md` still says otherwise and is
    // a record of what was true then.
    //
    // **What this case holds that `discovery-agents.node.test.ts` cannot.** That file
    // reads the same clause over spawned agent processes and is the criterion's primary
    // evidence. It cannot read a *node's own* executor counters, because they live inside
    // a process it does not share. These nodes are in-process `FabricNode`s over real
    // tcp + noise + yamux, so `executorPeakInFlight` below is a direct reading that the
    // refusing node never entered its executor at all — the half that says the shard was
    // refused rather than run twice.
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
    // the node, travels the real wire, and the re-pick is `submitJob`'s own.
    const held = busy.admission.offer({ shardId: 'held-by-this-test', nodeId: busy.peerId })
    expect(held.accepted).toBe(true)
    expect(busy.admission.inFlight).toBe(1)

    // ---- The refusal in the node's own words, read before the job runs. ----------
    // `runResilient` carried a `kind` and a `reason` per attempt, so this used to be
    // `shard.failures[0].reason`. `submitJob` has no such field on a shard that ended
    // `agreed` — `VerificationResult`'s `agreed` arm declares no `failures`, which
    // 20-01 recorded as an open item — so a shard that recovered structurally cannot
    // name what refused it. The substitution is a *direct* dispatch of a probe task
    // over the same wire, which reaches the same `LocalCapacity` branch and does carry
    // the sentence. Its `inputCid` differs from the job's, so it takes the
    // over-committed branch rather than the dedupe branch, and it reserves nothing.
    const probe = await new RemoteExecutor(
      busy.peerId,
      requestor.rpc,
      'dispatches-unauthenticated',
    ).execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1, label: 'public' })
    expect(probe.ok).toBe(false)
    if (!probe.ok) expect(probe.reason).toContain('over-committed: 1 of 1 slots in use')

    // ---- The re-pick, on the production submit path. -----------------------------
    // No `admit`, so no offer is ever made: every refusal this reads is an exec-stage
    // refusal, and `rejections` being empty below is the proof of it.
    const executors = [
      new RemoteExecutor(busy.peerId, requestor.rpc, 'dispatches-unauthenticated'),
      new RemoteExecutor(free.peerId, requestor.rpc, 'dispatches-unauthenticated'),
    ]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ value: { repick: 1 }, label: 'public' as const }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    if (shard === undefined) throw new Error('expected one shard result')

    // Both nodes were attempted, busy first. `attempted` is the set ASKED in order
    // across every generation, so the busy node standing first says the placement
    // chose it and the dispatch reached it — without which the reading is satisfiable
    // by a shard that never met the saturated node at all.
    expect(shard.attempted).toEqual([busy.peerId, free.peerId])
    expect(shard.generations).toBe(2)
    expect(result.job.redispatches).toBe(1)

    // The lease trail, substituted for the `failures` field the `agreed` arm does not
    // have — the same substitution 20-04 made in `discovery-agents.node.test.ts`, and
    // the strongest true reading this tree supports: the busy node held generation 1
    // by name and gave it back, and generation 2 went elsewhere and completed. A
    // re-pick that quietly swapped nodes would leave one `granted` in the trail.
    const leaseTrail = result.job.leaseHistory.map((event) =>
      event.kind === 'abandoned' ? `abandoned:${event.taskId}` : `${event.kind}:${event.nodeId}`,
    )
    expect(leaseTrail).toStrictEqual([
      `granted:${busy.peerId}`,
      `surrendered:${busy.peerId}`,
      `granted:${free.peerId}`,
      `completed:${free.peerId}`,
    ])

    // And the shard completed, on the node that did not refuse — read off the agreeing
    // replica rather than off `attempted`, so it says who ANSWERED and not who was asked.
    expect(shard.ending).toBe('agreed')
    if (shard.verification.status !== 'agreed') throw new Error('expected an agreed shard')
    expect(shard.verification.agreeing.map((replica) => replica.nodeId)).toEqual([free.peerId])
    expect(shard.verification.replicas).toBe(1)
    // No offer was made, so nothing refused one; every refusal above came from `exec`.
    expect(shard.rejections).toStrictEqual([])
    // The busy node never ran it: its executor was never entered at all.
    expect(busy.executorPeakInFlight).toBe(0)
    expect(free.executorPeakInFlight).toBeGreaterThan(0)
    // And the saturation still held while the job ran, so the reading above is not a
    // node that had quietly gone free again.
    expect(busy.admission.inFlight).toBe(1)

    busy.admission.release('held-by-this-test')
  }, 120_000)
})

/** Put a canonical value into `store` and return its CID. */
async function putValue(store: Blockstore, value: CanonicalValue): Promise<CID> {
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new Error(`fixture will not canonicalise: ${JSON.stringify(encoded.error)}`)
  return store.put(encoded.bytes)
}

describe('SCHED-06 — the combine branch admits too, on the production factory', () => {
  it('refuses a combine at the slot limit without fetching a block, and combines the identical frame once a slot frees', async () => {
    // **This has to be a real `FabricNode` and not an in-process fabric, and the
    // reason is this phase's own history.** 16-05's defect — a combine refused on any
    // node holding a real `Authorizer` — survived two milestones precisely because
    // every in-process rig passed `authorize: 'serves-unauthenticated'`, so no cheap
    // fabric could see a gate keyed on the real thing's configuration. The node below
    // is started by the same `FabricNode.start` `bin/agent.ts` calls: it installs
    // `authorizeCapability`, which admits every combine, so the only thing that can
    // refuse the frame here is the admission bound under test.
    //
    // `packages/net/src/combine.test.ts` measures the same bound one layer down over
    // `MemoryNetwork` with a counting blockstore. Neither file stands in for the other:
    // that one can count individual reads, this one can say the production factory
    // wires it.
    const [server, client] = await Promise.all([
      startNode('combine-bound', { maxConcurrentTasks: 1 }),
      startNode('combine-client'),
    ])
    await client.dial(server.multiaddrs[0] as string)

    // Held by the client alone. The server's blockstore is a `FetchingBlockstore` over
    // its peers, so anything it merges it must pull over this connection — which is
    // what makes `server.blockstore.fetched` a reading of what the frame cost.
    const a: CanonicalValue = { counts: { alpha: 1 }, rows: 1 }
    const b: CanonicalValue = { counts: { beta: 2 }, rows: 2 }
    const aCid = await putValue(client.store, a)
    const bCid = await putValue(client.store, b)
    expect(server.blockstore.fetched).toBe(0)

    const askCombine = async (): Promise<AgentResponse | null> =>
      parseResponse(
        await client.rpc.request(
          server.peerId,
          encodeRequest({ kind: 'combine', combineId: 'tree-node-a', inputCids: [aCid, bCid], level: 1 }),
        ),
      )

    // Saturation is *declared*, not raced — the same technique the re-pick case above
    // uses, on the same object `serveAgent` reserves against, under a key no combine
    // derives so the frame meets the over-committed branch and not the dedupe branch.
    const held = server.admission.offer({ shardId: 'held-by-this-test', nodeId: server.peerId })
    expect(held.accepted).toBe(true)

    const refused = await askCombine()

    // The combine reply shape, never an `error` frame: `executeReduce` reads a null
    // result as "try the next executor", which is the right answer from a busy node.
    expect(refused?.kind).toBe('combine')
    if (refused?.kind !== 'combine') throw new Error('expected a combine reply')
    expect(refused.resultCid).toBeNull()
    // The **text**, composed by `LocalCapacity` and carried across a real TCP + noise +
    // yamux connection unchanged. Asserted by text and not by kind, because a refusal
    // naming the wrong thing is a defect here even when the combine correctly fails.
    expect(refused.reason).toBe('over-committed: 1 of 1 slots in use')
    // Zero blocks crossed the wire for it. This is the bound the owner ruled for,
    // measured on a real node rather than argued: the slot is taken before the fetch
    // loop, so a refused combine costs the transfers it exists to prevent nothing.
    expect(server.blockstore.fetched).toBe(0)

    // The paired positive control. Without it, `fetched === 0` is equally satisfied by
    // a node that never fetches, and the refusal by a node that refuses everything.
    server.admission.release('held-by-this-test')
    const admitted = await askCombine()

    const reference = await canonicalCid(fabricCombiner([a, b]))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return
    expect(admitted?.kind).toBe('combine')
    if (admitted?.kind !== 'combine') throw new Error('expected a combine reply')
    expect(admitted.reason).toBe('')
    // Bit-for-bit against a reference computed in this process from the production
    // combiner, so "stopped refusing" cannot pass for "computed the right aggregate".
    expect(admitted.resultCid?.toString()).toBe(reference.cid.toString())
    // ...and it really did have to fetch both inputs to do it.
    expect(server.blockstore.fetched).toBe(2)

    // Taken, and given back. A slot that leaked would leave this node refusing every
    // later combine forever, with the reduce quietly running out of executors.
    expect(server.admission.inFlight).toBe(0)
    // The limit was reached rather than never approached — the only claim this counter
    // can make, since `peakInFlight <= slots` is arithmetic in `LocalCapacity`.
    expect(server.admission.peakInFlight).toBe(1)
    // The combine branch never touches the executor, on either exit.
    expect(server.executorPeakInFlight).toBe(0)
  }, 120_000)
})

/**
 * SCHED-03 — **the reading that says a deployment can refuse a combine at all.**
 *
 * `16-VERIFICATION.md` carried a gap from 2026-08-01, re-measured 2026-08-06 and still
 * `failed`: *"A deployment can refuse combines by supplying an authorizer that does"* —
 * 16-05's threat-flag sentence — with the measurement beside it that `FabricNodeOptions`
 * had 25 fields and no `authorize` among them, so **no node this repository could start
 * could refuse a combine**.
 *
 * The authorizer half of that sentence is not what closed it and must not be read as
 * having closed. Owner ruling 2026-07-31 (`3b54897`, and the ruling is quoted in
 * `runCombine`'s own body in `packages/net/src/agent.ts`) rejected the fix by name:
 * *"not an `authorize` override on the node factories that would reopen the door Phase 15
 * closed by hardcoding `authorizeCapability`"*, on the ground that a combine's inputs are
 * the outputs of public map tasks and are already public by construction, so **there is
 * nothing on that frame to authorize**; what a peer can provoke is CPU and transfer,
 * which is a capacity question. `authorizeCapability` therefore admits every combine
 * still, deliberately, and the case above is what reads that.
 *
 * What closed the *substance* is two per-node controls that both landed after that gap
 * was written and neither of which is an authorizer:
 *
 * - **capacity** — `maxConcurrentTasks`, measured in the case above at
 *   `over-committed: 1 of 1 slots in use` and zero blocks fetched;
 * - **pause** — SCHED-03, `1043772` on 2026-08-11, which put `combine` in
 *   `DeclinedWhilePaused`. That is what this case reads, through `FabricNodeOptions.paused`
 *   on the same `FabricNode.start` call `bin/agent.ts` makes.
 *
 * **Neither is per-kind, and this file does not pretend otherwise.** A paused node
 * declines `exec`, `commit`, `combine` and `offer` together, and one slot pool bounds
 * combines and execs alike. There is no way on this build to refuse combines while
 * serving execs, and by the ruling above there is not meant to be. The claim these two
 * cases jointly carry is the narrower, true one: *a deployment can refuse a combine, and
 * the refusal costs the node nothing it was trying not to spend.*
 *
 * `packages/net/src/paused.test.ts` measures the same disposition one layer down over
 * `MemoryNetwork` with hand-supplied `AgentOptions`. Neither file stands in for the other,
 * for the reason the SCHED-06 block above states about its own pair: that one can hold the
 * hook directly, this one can say the **production factory** wires it — which is the exact
 * half the gap was about, since the gap was never that `serveAgent` lacked a hook.
 */
describe('SCHED-03 — a deployment can refuse a combine, on the production factory', () => {
  it('refuses a combine on a node its deployment paused, fetching nothing, and combines the identical frame once it un-pauses', async () => {
    // The deployment's own state, read through the thunk on every request — which is
    // what makes this an operator control rather than a start-time flag, and what lets
    // one node give both answers to one identical frame inside one run. A second node
    // started un-paused would prove far less: two nodes differ in their peer ids, their
    // stores and their ports, and any of those could be the thing that moved.
    let declining = true
    const [server, client] = await Promise.all([
      startNode('paused-combine', { paused: () => declining }),
      startNode('paused-combine-client'),
    ])
    await client.dial(server.multiaddrs[0] as string)

    // Held by the client alone, exactly as in the SCHED-06 case above, so
    // `server.blockstore.fetched` is a reading of what this frame cost the server.
    const a: CanonicalValue = { counts: { alpha: 1 }, rows: 1 }
    const b: CanonicalValue = { counts: { beta: 2 }, rows: 2 }
    const aCid = await putValue(client.store, a)
    const bCid = await putValue(client.store, b)
    expect(server.blockstore.fetched).toBe(0)

    const askCombine = async (): Promise<AgentResponse | null> =>
      parseResponse(
        await client.rpc.request(
          server.peerId,
          encodeRequest({ kind: 'combine', combineId: 'tree-node-a', inputCids: [aCid, bCid], level: 1 }),
        ),
      )

    const refused = await askCombine()

    // The combine reply shape and never an `error` frame — `executeReduce` reads a null
    // result as "try the next executor in the ranking", which is the right answer from a
    // node that has stopped taking work.
    expect(refused?.kind).toBe('combine')
    if (refused?.kind !== 'combine') throw new Error('expected a combine reply')
    expect(refused.resultCid).toBeNull()
    // **By text, against the one place the string is composed**, carried across a real
    // TCP + noise + yamux connection unchanged. A refusal naming the wrong thing is a
    // defect here even when the combine correctly fails.
    expect(refused.reason).toBe(pausedRefusal(server.peerId))
    // And it is *not* the at-capacity string. This is the discrimination the state exists
    // for and it is asserted rather than assumed: a paused node is not full, and one that
    // said it was would send a requestor back to resample it as soon as a slot freed.
    expect(refused.reason).not.toContain('over-committed')
    // Zero blocks crossed the wire for it — the pause is checked before the branch is
    // entered, so a refused combine costs the transfers it exists to decline nothing.
    expect(server.blockstore.fetched).toBe(0)
    // And it took no slot on the way to refusing, which is the other half of "not full".
    expect(server.admission.peakInFlight).toBe(0)

    // **The paired positive control, and the whole reason this is a measurement.**
    // Without it, `fetched === 0` and a null result are equally satisfied by a node that
    // cannot combine at all — which is precisely the pre-16-05 defect this repository
    // shipped for two milestones and did not notice.
    declining = false
    const admitted = await askCombine()

    const reference = await canonicalCid(fabricCombiner([a, b]))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return
    expect(admitted?.kind).toBe('combine')
    if (admitted?.kind !== 'combine') throw new Error('expected a combine reply')
    expect(admitted.reason).toBe('')
    // Bit-for-bit against a reference computed in this process from the production
    // combiner, so "stopped refusing" cannot pass for "computed the right aggregate".
    expect(admitted.resultCid?.toString()).toBe(reference.cid.toString())
    // ...and it really did have to fetch both inputs to do it, so the zero above was a
    // reading of a refusal and not of a node that never fetches.
    expect(server.blockstore.fetched).toBe(2)
    // The combine branch never touches the executor, on either exit.
    expect(server.executorPeakInFlight).toBe(0)
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
