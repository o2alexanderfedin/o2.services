import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signName, submitJob, toHex } from '@o2/core'
import type { NameRecord, NodeDescriptor } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

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

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('DATA-03/DATA-04 — sovereignty-pinned placement across real bin/agent.ts processes', () => {
  it('places a sovereign shard only on the owner’s process, never on an idle foreign process, under load pressure engineered to force relocation', async () => {
    // Alice's process is started already cleared for herself — the same
    // `--owner-id`/`--can-execute-sovereign` flags a real deployment would pass —
    // so a correctly-placed dispatch can actually complete. Both bob processes
    // are started with no sovereignty option at all: bin/agent.ts's safe default
    // (cleared for nobody), exactly as a stranger's volunteer node would be.
    const [alice, bob1, bob2] = await Promise.all([
      spawnAgent('alice', ['--owner-id', 'alice', '--can-execute-sovereign']),
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
      new RemoteExecutor(alice.peerId, submitter.rpc),
      new RemoteExecutor(bob1.peerId, submitter.rpc),
      new RemoteExecutor(bob2.peerId, submitter.rpc),
    ]

    // The placement-time descriptors `submitJob` sees. Alice's is described as
    // the most loaded node in the set (`load: 1`, i.e. saturated); both of bob's
    // are idle (`load: 0`) and — deliberately — flagged `canExecuteSovereign:
    // true` too, so the only thing that can exclude them is ownership, not
    // clearance. A scheduler that let load override ownership would pick a bob
    // node here every time.
    const nodesDescriptor: readonly NodeDescriptor[] = [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 1 },
      { nodeId: bob1.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0 },
      { nodeId: bob2.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0 },
    ]

    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor(moduleCid),
        shards: [{ value: { a: 0 }, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: nodesDescriptor,
        redundancy: 1,
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
      expect(shard.verification.agreeing).toEqual([alice.peerId])
    }
  }, 120_000)
})
