import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signName, submitJob, toHex } from '@o2/core'
import type { NameRecord, NodeDescriptor } from '@o2/core'
import { RemoteExecutor, encodeRequest, parseResponse, rpcAdmission } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative imports — see the note in packages/net/src/distributed.test.ts.
import { MODULE_NEVER_RETURNS, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * ROADMAP criterion 1, in the exact evidentiary form it names: "A job submitted
 * through `bin/agent.ts` whose input carries an owner's sovereignty label places
 * its map task only on that owner's nodes; a test that applies artificial load
 * pressure specifically to force relocation onto a non-owner node fails to move
 * it."
 *
 * `submit.test.ts`'s load-pressure proof (Plan 12-02) runs entirely inside one
 * Vitest process against a hand-written in-memory `Executor` — sufficient to show
 * `submitJob`'s placement engine has no branch that can widen under load, but not
 * sufficient to show that survives a real operating-system process boundary. This
 * file is that closing move, built exactly as `two-process.node.test.ts` proves
 * the non-sovereignty case (NET-01): real `bin/agent.ts` child processes sharing
 * nothing with the submitter but a socket.
 *
 * Discrimination, not placement, is the point. Alice's process is described to
 * `submitJob` as saturated (`load: 1`) and both of bob's as completely idle
 * (`load: 0`) — the exact arrangement a scheduler that treats sovereignty as a
 * preference, not a filter, would react to by relocating the shard. It never
 * moves: `eligibleNodes` (`sovereignty.ts`) filters a sovereign request down to
 * the owner's own nodes *before* load is consulted at all, so there is no code
 * path from "alice is expensive" to "ask bob instead".
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * DET-03 is not this file's subject — placement under sovereignty is. The record
 * exists so that subject can still be reached: every executor below is a
 * `RemoteExecutor` aimed at a spawned `bin/agent.ts`, which pins the demo's anchor by
 * default, so an unsigned job would have every dispatch refused before placement could
 * be observed at all.
 */
const publisher = (() => {
  // Seed 52 — distinct from every other fixture key in the repository.
  const priv = new Uint8Array(32).fill(52)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'sovereignty-placement-fixture',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type: `bin/agent.ts` watches fd 0 and leaves when
 * it closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. Handing it `ignore` would put `/dev/null` on fd 0 and silently opt this file
 * out. See `orphan-leash.node.test.ts`, which demonstrates it and guards this line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Agent {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly dir: string
  readonly child: AgentProcess
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []

/** Spawn an agent process and wait for its one-line address handshake. */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  const handshake = await new Promise<{ peerId: string; multiaddrs: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)), 30_000)
    let stdout = ''
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(stdout.slice(0, newline)) as { peerId: string; multiaddrs: string[] })
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent ${name} exited early with ${String(code)}: ${stderr}`))
    })
  })

  const agent: Agent = { ...handshake, dir, child }
  agents.push(agent)
  return agent
}

async function startSubmitter(): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 30_000,
    // The same value the spawned agents get, rather than the opt-out — a submitter
    // declaring a different authority from the nodes it dispatches to would be a lie
    // in a file nobody would re-read.
    trustAnchors: [publisher.pub],
  })
  nodes.push(node)
  return node
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(agent: Agent): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      agent.child.kill('SIGKILL')
      resolve()
    }, 10_000)
    agent.child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    agent.child.kill('SIGTERM')
  })
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-sov-'))
})

/**
 * Inner 10 s, outer 20 s — and the order is the point.
 *
 * `stopAgent` gives a wedged process 10 s before SIGKILL. Vitest's default `hookTimeout`
 * is also 10 s, so with no explicit budget the two clocks are armed for the same instant
 * and the framework's fires first: the SIGKILL fallback can never run, and a wedged agent
 * is reported as an anonymous hook timeout naming no step. A test arms two clocks and the
 * framework's must be the larger.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

describe('DATA-03/DATA-04 — sovereignty-pinned placement across real bin/agent.ts processes', () => {
  it('places a sovereign shard only on the owner’s process, never on an idle foreign process, under load pressure engineered to force relocation', async () => {
    // Alice's process is started already cleared for herself and pinned to her key —
    // the same `--owner-id`/`--owner-key`/`--can-execute-sovereign` flags a real
    // deployment would pass — so a correctly-placed dispatch can actually complete.
    // `--owner-key` is AUTH-03's addition: without it her process refuses the chain
    // her submitter mints, before placement's outcome could be read at all.
    //
    // Both bob processes stay started with **no sovereignty arguments whatsoever**,
    // and that must not be softened to make anything pass — it is the point of the
    // test: bin/agent.ts's safe default, exactly as a stranger's volunteer node would
    // be. As of Phase 15 they would refuse the shard for two independent reasons, no
    // pinned owner key and no clearance, and neither is ever reached, because
    // placement narrows a sovereign shard to its owner's nodes before load is
    // consulted. That is what the assertions below read.
    const [alice, bob1, bob2] = await Promise.all([
      spawnAgent('alice', ['--owner-id', 'alice', '--owner-key', OWNER_KEY, '--can-execute-sovereign']),
      spawnAgent('bob1'),
      spawnAgent('bob2'),
    ])
    const submitter = await startSubmitter()
    await Promise.all([
      submitter.dial(alice.multiaddrs[0]!),
      submitter.dial(bob1.multiaddrs[0]!),
      submitter.dial(bob2.multiaddrs[0]!),
    ])

    // Only the submitter holds the module — every process must pull it over the
    // wire, exactly as NET-01's two-process test already establishes.
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    const executors = [
      new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId)),
      new RemoteExecutor(bob1.peerId, submitter.rpc, chainSupplierFor(bob1.peerId)),
      new RemoteExecutor(bob2.peerId, submitter.rpc, chainSupplierFor(bob2.peerId)),
    ]

    // The placement-time descriptors `submitJob` sees. Alice's is described as
    // the most loaded node in the set (`load: 1`, i.e. saturated); both of bob's
    // are idle (`load: 0`) and — deliberately — flagged `canExecuteSovereign:
    // true` too, so the only thing that can exclude them is ownership, not
    // clearance. A scheduler that let load override ownership would pick a bob
    // node here every time.
    const nodesDescriptor: readonly NodeDescriptor[] = [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 1, certificate: 'carries-no-certificate' },
      { nodeId: bob1.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: bob2.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]

    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ value: { a: 0 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: nodesDescriptor,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [shard] = result.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status === 'agreed') {
      // Never one of the two idle foreign processes, despite them being the
      // "cheaper" choice by every load signal a naive scheduler would react to.
      expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual([alice.peerId])
    }
  }, 120_000)
})

/**
 * ## What the two blocks below add, and what they cannot reach
 *
 * The case above proves the criterion on the **`planPlacement`** arm — the arrangement
 * `submitJob` takes when its caller supplies no `admit`. Plan 18-05 gave it a second
 * arrangement, and a criterion met on one is not met on the other until it is measured
 * there.
 *
 * The shape of the risk is what changes. `planPlacement` has no branch that can widen
 * under load: it orders an already-narrowed set and there is nowhere for a cheaper node to
 * come from. `placeWithOffers` adds a **loop** — a candidate refuses, it is dropped, and
 * the next `d` are sampled from what remains. A loop that re-derived its pool from the full
 * node list would leak a sovereign shard onto a foreign node on the second pass, and the
 * case above would still pass, because nothing in it makes an owner's node refuse.
 *
 * **The cross-process reading of "bob was never asked" is weaker than the in-process one**,
 * and the halves must not be read as one. The offer branch reserves nothing, so a spawned
 * node that was asked and refused leaves exactly the trace of one that was never asked.
 * The strong reading — a counted offer list — is
 * `packages/core/src/sovereign-offers.test.ts`. **This file carries the outcome**: where
 * the work ran, and where it provably did not.
 *
 * What is read from bob's side is his blockstore. Every agent starts with an empty `--dir`
 * and only the submitter holds the module, so a bob process that executed anything must
 * have pulled the module block over the wire to do it. `has(moduleCid)` on his own store,
 * read after his process is stopped, is therefore a genuine reading from the far side
 * rather than the requestor's account of itself.
 *
 * **The owner id here is the operator label `'alice'` and the descriptors are built by this
 * file.** A discovery-derived descriptor carries `certificate.userKey` as its `ownerId`
 * instead (Plan 18-05), so a sovereign job placed from `discoverCandidates` needs its
 * shard's `ownerId` to be that user key. **This file still does not exercise that path,
 * and now says where it is exercised instead**:
 * `packages/node/src/owner-domain-agents.node.test.ts`, added by Plan 19-09, which
 * discovers its candidates, pins its shard to the owner's user key, and reads the receipt
 * two of that owner's processes signed.
 *
 * The unification that made that possible landed in `bin/agent.ts` on 2026-08-03: an
 * enrolling process derives `sovereignty.ownerId` from `--user-key`, and a `--owner-id`
 * that disagrees is exit 2 naming both values. **These agents are unaffected, and that is
 * why the fixture below is unchanged.** None of them enrols — alice is spawned with
 * `--owner-id alice` and no `--provider-addr` — so the derivation never runs and the
 * operator label is still exactly what a node with no certificate is cleared for. Changing
 * this fixture to a hex key would delete the reading rather than modernise it: the point
 * here is that placement narrows a sovereign shard before load is consulted, which is true
 * of any owner id at all, and an unenrolled node cleared by label is a shape a real
 * deployment still has.
 */

interface OfferFixture {
  readonly alice: Agent
  readonly bobs: readonly [Agent, Agent]
  readonly submitter: FabricNode
  readonly moduleCid: CID
  readonly executors: readonly RemoteExecutor[]
  readonly descriptors: readonly NodeDescriptor[]
}

/**
 * The same arrangement as the case above, stood up separately on purpose.
 *
 * The pre-existing case is what says the `planPlacement` arm did not move, so it is left
 * byte-identical rather than refactored to share this helper. Some duplication is the
 * price of that, and it is the right price.
 */
async function standUpForOffers(aliceArgs: readonly string[] = []): Promise<OfferFixture> {
  const [alice, bob1, bob2] = await Promise.all([
    spawnAgent('alice', [
      '--owner-id',
      'alice',
      '--owner-key',
      OWNER_KEY,
      '--can-execute-sovereign',
      ...aliceArgs,
    ]),
    spawnAgent('bob1'),
    spawnAgent('bob2'),
  ])
  const submitter = await startSubmitter()
  await Promise.all([
    submitter.dial(alice.multiaddrs[0]!),
    submitter.dial(bob1.multiaddrs[0]!),
    submitter.dial(bob2.multiaddrs[0]!),
  ])

  const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

  return {
    alice,
    bobs: [bob1, bob2],
    submitter,
    moduleCid,
    executors: [
      new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId)),
      new RemoteExecutor(bob1.peerId, submitter.rpc, chainSupplierFor(bob1.peerId)),
      new RemoteExecutor(bob2.peerId, submitter.rpc, chainSupplierFor(bob2.peerId)),
    ],
    // Alice saturated, both of bob's idle — the arrangement a scheduler that treats
    // sovereignty as a preference rather than a filter would react to.
    descriptors: [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 1, certificate: 'carries-no-certificate' },
      { nodeId: bob1.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      { nodeId: bob2.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ],
  }
}

/**
 * Did this agent execute anything?
 *
 * Read after the process is stopped, so its own writes have landed. An agent that ran the
 * shard had to pull the module over the wire to do it, and would hold it.
 */
async function ranAnything(agent: Agent, moduleCid: CID): Promise<boolean> {
  const store = await FsBlockstore.open(agent.dir)
  return store.has(moduleCid)
}

/** Ask a node directly whether it would take a shard, and read its own answer. */
async function offerAnswer(
  submitter: FabricNode,
  nodeId: string,
  shardId: string,
): Promise<{ accepted: boolean; capacity: unknown; reason?: string }> {
  const reply = parseResponse(await submitter.rpc.request(nodeId, encodeRequest({ kind: 'offer', shardId })))
  if (reply?.kind !== 'offer') throw new Error(`expected an offer answer, got ${String(reply?.kind)}`)
  return reply
}

describe('SCHED-05 — sovereignty survives the offer loop, across real processes', () => {
  it('places a sovereign shard on its owner when placement asks every candidate first', async () => {
    const fixture = await standUpForOffers()
    const { alice, bobs, submitter, moduleCid } = fixture

    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ value: { a: 0 }, label: 'sovereign', ownerId: 'alice' }],
        executors: fixture.executors,
        nodes: fixture.descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
        // The only difference from the case above, and the whole subject of this block.
        admit: rpcAdmission(submitter.rpc),
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [shard] = result.job.shards
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status !== 'agreed') return
    expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual([alice.peerId])

    // Read from bob's own side rather than from the requestor's account of itself.
    await Promise.all(bobs.map((b) => stopAgent(b)))
    for (const bob of bobs) expect(await ranAnything(bob, moduleCid)).toBe(false)
  }, 120_000)

  it('stalls rather than relocating when the owner’s only node refuses', async () => {
    // One slot, so a single held task saturates her.
    const fixture = await standUpForOffers(['--max-concurrent-tasks', '1'])
    const { alice, bobs, submitter, moduleCid } = fixture

    // Saturation is a real held slot, not a reach into the node: nothing can reach into a
    // spawned process. `MODULE_NEVER_RETURNS` loops until alice's own task deadline ends
    // it. Its input differs from the sovereign shard's, which matters — a node's slot key
    // is `inputCid:partitionIndex` and excludes the module, so a held task sharing the
    // shard's input would make the shard meet the DEDUPE branch rather than the
    // over-committed one, and the refusal read below would be the wrong refusal.
    const neverCid = await submitter.store.put(MODULE_NEVER_RETURNS)
    const heldInput = await submitter.store.put(new Uint8Array([0xf1, 0xf2, 0xf3, 0xf4]))
    const held = new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId))
      .execute({
        moduleCid: neverCid,
        inputCid: heldInput,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
        moduleRecord: recordFor(neverCid),
      })
      .catch((cause: unknown) => ({ ok: false as const, reason: String(cause) }))

    // Poll alice's own answer until she reports herself full. A sleep would be a guess.
    const deadline = Date.now() + 30_000
    let answer = await offerAnswer(submitter, alice.peerId, 'precondition')
    while (answer.accepted && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
      answer = await offerAnswer(submitter, alice.peerId, 'precondition')
    }
    expect(answer.accepted).toBe(false)
    expect(answer.capacity).toStrictEqual({ slots: 1, inFlight: 1 })

    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ value: { a: 0 }, label: 'sovereign', ownerId: 'alice' }],
        executors: fixture.executors,
        nodes: fixture.descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: rpcAdmission(submitter.rpc),
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [shard] = result.job.shards
    if (shard === undefined) throw new Error('expected one shard')

    // The shard stalled. That is the CORRECT outcome and a much better one than a quiet
    // leak: two idle foreign processes were available the whole time and neither was
    // reachable from here, because the sovereignty gate ran before the loop did.
    expect(shard.verification.status).toBe('insufficient')
    expect(shard.rejections.map((r) => r.nodeId)).toStrictEqual([alice.peerId])
    expect(shard.rejections[0]?.reason).toContain('over-committed: 1 of 1 slots in use')

    // The precondition still held while the placement ran. `MODULE_NEVER_RETURNS` is
    // ended by alice's own task deadline, so a slower placement would have found her free
    // and every assertion above would have passed while measuring nothing.
    const after = await offerAnswer(submitter, alice.peerId, 'post-placement')
    expect(after.accepted).toBe(false)
    expect(after.capacity).toStrictEqual({ slots: 1, inFlight: 1 })

    // And bob ran nothing, read from bob's own store.
    await Promise.all(bobs.map((b) => stopAgent(b)))
    for (const bob of bobs) expect(await ranAnything(bob, moduleCid)).toBe(false)

    await held
  }, 120_000)
})
