import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { publicNodes, signName, submitJob, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * DET-03 is not this file's subject — the transport and the process boundary are. The
 * record exists so this file's real subject can still be reached: every executor below
 * is a `RemoteExecutor` aimed at a spawned `bin/agent.ts`, and that binary pins the
 * demo's anchor by default, so an unsigned job would have every dispatch here refused.
 * The agents are spawned with this key instead and the jobs carry a matching record.
 */
const publisher = (() => {
  // Seed 51 — distinct from every other fixture key in the repository.
  const priv = new Uint8Array(32).fill(51)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'two-process-fixture',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/**
 * NET-01 — the job crosses an operating-system process boundary.
 *
 * Three nodes in one Vitest process share a heap, an event loop, and a module
 * registry. That is enough to exercise the transport but not enough to prove the
 * boundary: a subtle shared-state dependency would pass. Here the executors are
 * separate OS processes that share nothing with the submitter except a socket, so
 * every byte a worker needs — the module included — has to arrive over the wire.
 *
 * The submitter runs in the test process and dispatches nothing locally: both
 * replicas of every shard execute in a child process.
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
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
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
    // The same value the spawned agents get, rather than the opt-out: a submitter
    // declaring a different authority from the nodes it dispatches to would be a lie
    // in a file nobody would re-read. Nothing executes on this node — every executor
    // here is remote — so this states an intent rather than gating anything.
    trustAnchors: [publisher.pub],
  })
  nodes.push(node)
  return node
}

function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
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
  workdir = await mkdtemp(join(tmpdir(), 'o2-proc-'))
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

describe('NET-01 — a job across OS processes', () => {
  it('completes 4 shards at R=2 in two separate agent processes', async () => {
    const [w1, w2] = await Promise.all([spawnAgent('w1'), spawnAgent('w2')])
    const submitter = await startSubmitter()

    // Discovery, such as it is in this phase: an explicit dial to each announced
    // address. Phase 6 removes the static list.
    const dialed = await Promise.all([submitter.dial(w1.multiaddrs[0]!), submitter.dial(w2.multiaddrs[0]!)])
    expect(dialed.sort()).toEqual([w1.peerId, w2.peerId].sort())

    // Only the submitter has the module. Each worker is a fresh process with an
    // empty directory, so it cannot possibly have it except by asking.
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    const executors = [
      new RemoteExecutor(w1.peerId, submitter.rpc),
      new RemoteExecutor(w2.peerId, submitter.rpc),
    ]
    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    expect(
      result.job.shards.map((s) => (s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1)),
    ).toEqual([0, 1, 2, 3])

    // Both worker processes agreed on every shard.
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.replicas).toBe(2)
      expect([...shard.verification.agreeing].sort()).toEqual([w1.peerId, w2.peerId].sort())
    }
    expect(result.job.verificationMultiplier).toBeCloseTo(2, 6)
  }, 120_000)

  it('leaves fetched blocks on disk in the worker process, surviving its death', async () => {
    const worker = await spawnAgent('w1')
    const submitter = await startSubmitter()
    await submitter.dial(worker.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(worker.peerId, submitter.rpc)]
    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ a: 0 }, { a: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      submitter.store,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)

    // Kill the worker process outright, then read its blockstore directory from
    // this process. The blocks were written by a different process and are
    // addressed by the CID this one computed — that is the whole persistence claim.
    await stopAgent(worker)

    const reopened = await FsBlockstore.open(worker.dir)
    expect(reopened.size).toBeGreaterThan(0)
    expect(await reopened.get(moduleCid)).toEqual(MODULE_WRITES_PARTITION)

    // Both shard inputs were pulled across too.
    for (const shard of result.job.shards) {
      expect(await reopened.has(shard.inputCid)).toBe(true)
    }
  }, 120_000)

  it('reports a dead process as a failed replica without failing the job', async () => {
    const [w1, w2] = await Promise.all([spawnAgent('w1'), spawnAgent('w2')])
    const submitter = await startSubmitter()
    await Promise.all([submitter.dial(w1.multiaddrs[0]!), submitter.dial(w2.multiaddrs[0]!)])
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    // A volunteer node vanishing is the normal case in this fabric, not an error.
    await stopAgent(w2)

    const executors = [
      new RemoteExecutor(w1.peerId, submitter.rpc),
      new RemoteExecutor(w2.peerId, submitter.rpc),
    ]
    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const verification = result.job.shards[0]!.verification
    // Verification reports the redundancy it actually achieved — 1, not 2 — rather
    // than claiming agreement it did not get.
    expect(verification.status).toBe('agreed')
    if (verification.status !== 'agreed') return
    expect(verification.replicas).toBe(1)
    expect(verification.agreeing).toEqual([w1.peerId])
  }, 120_000)
})
