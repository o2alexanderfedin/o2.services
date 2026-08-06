import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, signName, submitJob, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord, NodeDescriptor } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative imports — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
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
 *
 * ## Why this file mints a capability chain, as of Phase 15
 *
 * As of AUTH-03 the serving node also verifies a capability chain before it executes
 * anything. So this test dispatches with a **valid** one, on purpose: the failure it
 * measures is the egress refusal and nothing else, and alice is spawned with
 * `--owner-key` so her process has something to verify against.
 *
 * That is not tidiness, it is the one change in Phase 15 that would otherwise have
 * broken this file *silently*. The leaking submission below already expects to fail.
 * Drop the chain and it still fails — for a completely different reason, an authorize
 * refusal instead of an egress one — and every assertion around it still holds: the
 * shard still stalls at alice, there is still exactly one failure, `other` is still
 * never tried. The suite would stay green while DATA-05's cross-process proof
 * evaporated. **Measured rather than reasoned:** with the authorizer installed and
 * before this repair, this file reported exactly one failing assertion, and it was the
 * control at the bottom (`'insufficient'` where `'agreed'` was expected) — every
 * assertion about the leaking job passed for the wrong reason, exactly as described.
 *
 * The control is therefore load-bearing twice over. See its own comment below.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * DET-03 is not this file's subject — the egress refusal is. The record exists so that
 * subject can still be reached: every executor below is a `RemoteExecutor` aimed at a
 * spawned `bin/agent.ts`, which pins the demo's anchor by default, so an unsigned job
 * would be refused for provenance before it could be refused for egress — and this
 * file's whole point is which refusal arrives.
 */
const publisher = (() => {
  // Seed 53 — distinct from every other fixture key in the repository.
  const priv = new Uint8Array(32).fill(53)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name,
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
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
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

describe('DATA-05 — the refusal across two real bin/agent.ts processes', () => {
  it('fails a cross-owner job at the owner’s own process, leaves that process alive, and runs a control job through the same two processes afterwards', async () => {
    // The owner-pinned premise, made literal rather than assumed. Inside the
    // spawned process the serve path's `takeSovereignHold` reads the *local* tier only and
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
    // AUTH-03: `--owner-key` is the anchor alice's process judges every chain below
    // against. Without it she refuses each dispatch for want of a pinned key, before
    // her tap is ever consulted — see this file's header for why that would have been
    // invisible.
    const [alice, other] = await Promise.all([
      spawnAgent('alice', ['--owner-id', 'alice', '--owner-key', OWNER_KEY, '--can-execute-sovereign']),
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
      new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId)),
      new RemoteExecutor(other.peerId, submitter.rpc, chainSupplierFor(other.peerId)),
    ]

    // Clearance held equal and load pointing the other way, so ownership is the
    // only thing left that can exclude the idle process. A scheduler treating
    // sovereignty as a preference rather than a filter would pick the idle one.
    const descriptors: readonly NodeDescriptor[] = [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 1, certificate: 'carries-no-certificate' },
      { nodeId: other.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
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
        moduleRecord: recordFor('egress-refusal-echo', echoCid),
        shards: [{ value: OWNED_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
    //
    // **A fifth, as of Phase 15, and it is the one that makes this control the whole
    // file's safety net.** This control job is sovereign and reaches `agreed`, which is
    // only possible if its capability chain verified against the key `--owner-key`
    // pinned in alice's process. So the failure above cannot be an authorize refusal:
    // the same executors carrying the same supplier were accepted here, moments later,
    // by the same process. Without this reading, "alice refused both jobs for want of a
    // valid chain" would explain the failure above just as well as the egress tap does.
    const control = await submitJob(
      {
        moduleCid: aggregateCid,
        moduleRecord: recordFor('egress-refusal-aggregate', aggregateCid),
        shards: [{ value: OWNED_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(control.ok).toBe(true)
    if (!control.ok) return
    const controlShard = control.job.shards[0]
    expect(controlShard?.verification.status).toBe('agreed')
    if (controlShard?.verification.status !== 'agreed') return
    expect(controlShard.verification.agreeing.map((e) => e.nodeId)).toEqual([alice.peerId])
    expect(control.job.complete).toBe(true)
  }, 120_000)
})
