import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalCid, submitJob } from '@o2/core'
import type { CanonicalValue, NodeDescriptor } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * ROADMAP criterion 1, in the evidentiary form the criterion names: "A stream tap
 * installed on the wire between two nodes started via `bin/agent.ts` **refuses the
 * send** when a registered sovereign block would cross it, so the bytes never leave
 * the node, and the running cross-owner job fails rather than completing as
 * `agreed`."
 *
 * "Started via `bin/agent.ts`" means here what `sovereignty-placement.node.test.ts`
 * established it means in this repository: the nodes under test are genuine
 * operating-system processes spawned from that binary, sharing nothing with this
 * process but a socket. The submitter is a `FabricNode` in the test process, as it
 * is in both existing spawn tests, because the binary is serving-only and never
 * calls `submitJob` — there is no third process it could be.
 *
 * **What this file proves, and what it deliberately does not.** It proves the
 * *consequence*: the job fails from the submitter's own reading, the shard stalls at
 * its owner instead of relocating, the owner's process is still alive afterwards,
 * and a control job through the same two processes immediately afterwards succeeds.
 *
 * It cannot read alice's egress manifest and does not imply that it can. Nothing in
 * `protocol.ts` carries a manifest, and a spawned agent's tap is out of reach from
 * here by design. The manifest-level proof of *why* the job failed — the recorded
 * violation label and the recorded entry, on the owner's own tap — lives in
 * `egress-manifest.node.test.ts` and `packages/net/src/egress.test.ts`, where the
 * guard is a value in the same process. The two halves are deliberately separate and
 * neither is asked to carry the other.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** stdin is `ignore`d, so the child's type carries `null` for it. */
type AgentProcess = ChildProcessByStdio<null, Readable, Readable>

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
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

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

/**
 * The submitter, with an RPC budget chosen for this file rather than inherited.
 *
 * **Amended 2026-07-29 by NET-10, because the paragraph that was here described
 * behaviour that no longer happens.** It read: *"the dispatch resolves only when
 * this budget expires"*, which was true while the owner's refusal reached the
 * requestor as nothing at all. It does not now. `serveAgent` asks the tap about its
 * candidate reply before handing it to the exit and substitutes a small named
 * refusal, so the refused dispatch resolves immediately with a reason rather than at
 * this budget's expiry. `rpc.ts`'s responding leg still swallows a send failure by
 * documented design — that cost is unchanged for every frame `serveAgent` does not
 * pre-scan; see the scoped exception in `packages/net/src/egress.ts`.
 *
 * 10 s stays, and its justification is now only the second half of the original
 * one: the control job at the end of the test runs a full cross-process dispatch —
 * exec request out, module block pulled back over the wire by a child that has never
 * seen it, WASM compiled and run in that child, reply returned — on this identical
 * budget, so it cannot fail for want of time. Nothing in this file measures
 * wall-clock, and nothing here should be read as if it did; the wall-clock
 * measurement, taken against the *unshortened* production default, is
 * `named-refusal.node.test.ts`'s whole subject.
 */
async function startSubmitter(): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
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

/**
 * Alice's row, distinct from every fixture in `egress-manifest.node.test.ts`.
 *
 * Deliberately not shared: if the two files used one row, either file's seeding
 * could satisfy the other's assertion, and a failure to seed would be invisible.
 */
const OWNED_ROW: CanonicalValue = {
  ssn: '907-31-4455',
  salary: 142_900,
  dob: '1969-11-08',
  branch: 'north-harbour',
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-refusal-'))
})

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('DATA-05 — the refusal across two real bin/agent.ts processes', () => {
  it('fails a cross-owner job at the owner’s own process, leaves that process alive, and runs a control job through the same two processes afterwards', async () => {
    // The owner-pinned premise, made literal rather than assumed. Inside the
    // spawned process `registerSovereignInputs` reads the *local* tier only and
    // runs before execution, so an input that is not already on the owner's disk
    // registers nothing and the tap has nothing to watch for — which would make a
    // job that "cleanly" completed prove nothing at all. Writing the canonical
    // bytes into alice's directory before her process opens it is what makes the
    // registration fire on the first dispatch. The CID is computed here from the
    // same bytes that are seeded, never read back off the code under test.
    const input = await canonicalCid(OWNED_ROW)
    if (!input.ok) throw new Error('fixture not encodable')
    const aliceStore = await FsBlockstore.open(join(workdir, 'alice'))
    const seeded = await aliceStore.put(input.bytes)
    expect(seeded.toString()).toBe(input.cid.toString())

    // Alice is started already cleared for herself — the same flags a real
    // deployment passes. The second process is started with no sovereignty
    // arguments at all, the way any node starts before anyone has told it whose
    // data it may touch.
    const [alice, other] = await Promise.all([
      spawnAgent('alice', ['--owner-id', 'alice', '--can-execute-sovereign']),
      spawnAgent('other'),
    ])
    const submitter = await startSubmitter()
    await Promise.all([
      submitter.dial(alice.multiaddrs[0]!),
      submitter.dial(other.multiaddrs[0]!),
    ])

    // Only the submitter holds the modules, so each child must pull whichever one
    // it needs over the wire — the property `two-process.node.test.ts` establishes
    // for NET-01, reused here.
    const echoCid = await submitter.store.put(MODULE_ECHOES_INPUT)
    const aggregateCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    const executors = [
      new RemoteExecutor(alice.peerId, submitter.rpc),
      new RemoteExecutor(other.peerId, submitter.rpc),
    ]

    // Clearance held equal and load pointing the other way, so ownership is the
    // only thing left that can exclude the idle process. A scheduler treating
    // sovereignty as a preference rather than a filter would pick the idle one.
    const descriptors: readonly NodeDescriptor[] = [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 1 },
      { nodeId: other.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0 },
    ]

    // Bare `submitJob`, not `submitJobWithEgress`. The submitter's own manifest is
    // not the subject here and supplying its guard would invite a reader to think
    // this assertion depends on it. What this process can see is the job outcome;
    // what it cannot see is alice's tap, which lives in her process and has no
    // wire representation. The amended criterion is reachable without one,
    // because the refusal makes the failure observable right here.
    const leaking = await submitJob(
      {
        moduleCid: echoCid,
        shards: [{ value: OWNED_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
      },
      submitter.store,
    )

    expect(leaking.ok).toBe(true)
    if (!leaking.ok) return

    const shard = leaking.job.shards[0]
    expect(shard?.verification.status).not.toBe('agreed')
    expect(leaking.job.complete).toBe(false)
    expect(shard?.verification.status).toBe('insufficient')
    if (shard?.verification.status !== 'insufficient') return

    // The shard stalled where it stands. Exactly one failure, naming alice's
    // spawned process; the idle second process never runs it, and could not be
    // asked to — a sovereign shard is narrowed to its owner's nodes before load
    // is consulted, and each selected executor runs once with no retry.
    expect(shard.verification.failures).toHaveLength(1)
    expect(shard.verification.failures[0]?.nodeId).toBe(alice.peerId)
    expect(shard.verification.failures.map((failure) => failure.nodeId)).not.toContain(other.peerId)

    // A refused frame, not a crashed node. Without this reading, "the process
    // died mid-dispatch" would explain the failure above just as well.
    expect(alice.child.exitCode).toBeNull()
    expect(alice.child.signalCode).toBeNull()

    // The control, ordered after the refusal on purpose: one that ran first would
    // leave alice's death during the refused dispatch standing as an explanation.
    // Same row, same owner, same descriptors, same submitter and the same budget —
    // the module is the only argument that changes. Four alternative explanations
    // for the failure above die here at once: unreachability, process death,
    // module-fetch failure, and a budget too short to finish in.
    const control = await submitJob(
      {
        moduleCid: aggregateCid,
        shards: [{ value: OWNED_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
      },
      submitter.store,
    )

    expect(control.ok).toBe(true)
    if (!control.ok) return
    const controlShard = control.job.shards[0]
    expect(controlShard?.verification.status).toBe('agreed')
    if (controlShard?.verification.status !== 'agreed') return
    expect(controlShard.verification.agreeing).toEqual([alice.peerId])
    expect(control.job.complete).toBe(true)
  }, 120_000)
})
