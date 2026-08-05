import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { publicNodes, signName, submitJob, toHex } from '@o2/core'
import type { NameRecord } from '@o2/core'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * DET-03 / DATA-08 — all three of Phase 14's ROADMAP criteria, across a real
 * operating-system process boundary.
 *
 * In the ROADMAP's own words:
 *
 * 1. *"A production node resolving a task's module CID does so through a signed
 *    `key → CID` mapping; resolving a bare, unsigned CID directly is refused, with the
 *    refusal naming the missing signature."*
 * 2. *"A mapping signed by a key outside the node's pinned trust anchors is refused at
 *    resolution time, before `WebAssembly.instantiate` runs, rather than being accepted
 *    because the CID itself is well-formed."*
 * 3. *"Running `bin/agent.ts` against a real signed artifact resolves and executes it
 *    end to end, proving `signName`/`SignedNameResolver` sit on the production dispatch
 *    path rather than only in their own spec."*
 *
 * **What "started via `bin/agent.ts`" means here.** What
 * `sovereignty-placement.node.test.ts` and `egress-refusal.node.test.ts` established it
 * means in this repository: the node under test is a genuine operating-system process
 * spawned from that binary, sharing nothing with this process but a socket. The
 * submitter is a `FabricNode` in the test process, as it is in both of those files,
 * because the binary is serving-only and never calls `submitJob` — there is no second
 * process it could be.
 *
 * **The instrument, and why it is a reading rather than an inference.** Every refusal
 * below also reads the spawned agent's own blockstore directory. `FsBlockstore` writes
 * one file per block, named by its CID string (`fs-blockstore.ts:101-103`); the
 * executor a `FabricNode` composes resolves `blockstore.get(task.moduleCid)` as the
 * first thing it does (`packages/core/src/executor/worker-executor.ts:175` — **not**
 * `WasmExecutor`, see the correction note below); and that blockstore is a
 * `FetchingBlockstore`, which pulls a block it does not hold from its peers and writes
 * it into the local store on the way through (`packages/net/src/block.ts:120`). So a
 * file named for the module's CID appearing in the agent's directory says *this process
 * went and got the module's bytes*, and its absence says *it did not*. A guard refusing
 * before `inner.execute` produces the absence; a guard refusing after would produce the
 * presence. The accepted case reads the same directory and finds the block there, so
 * every `not.toContain` below is an instrument shown taking both values rather than a
 * silence.
 *
 * **What this file does not prove.** It does not observe `WebAssembly.instantiate`. No
 * test in any process can — the call is inside a Worker inside a spawned child, and
 * there is no seam to watch it through. What it observes is that the bytes that would
 * have been instantiated were never fetched. That is a stronger reading than a layering
 * argument about which wrapper sits inside which, and a weaker one than watching the
 * call, and it should be read as exactly that and nothing more. The complementary
 * reading — that the inner executor was never *called* — is
 * `packages/core/src/executor/module-provenance.test.ts`'s call counter, in a different
 * process and a different plan.
 *
 * **`bin/seed.ts`'s no-flag runtime behaviour is measured, but not here.** That binary
 * writes the identical default expression `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]`,
 * and `trust-anchors.node.test.ts` both compares the two binaries' source textually *and*
 * spawns the seed to read what it actually pins — the same reading the two `trustAnchors`
 * assertions below take from `bin/agent.ts`. This file's subject is dispatch rather than
 * hosting, so the seed is named here and asserted there.
 *
 * This paragraph used to say that reading was not done anywhere, because spawning the seed
 * boots a Vite dev server. That much is true; the cost attached to it was not. It was
 * measured at **590 ms** to a complete banner, against an estimate of a minute.
 *
 * **A correction to the plan this file was written from, recorded rather than absorbed.**
 * Plan 14-05 states in its objective and again in Task 1 that `WasmExecutor`'s first act
 * is `blockstore.get(task.moduleCid)` and that this is what the directory reading
 * instruments. `WasmExecutor` is not what a `FabricNode` composes —
 * `fabric-node.ts:664-670` builds a `WorkerExecutor`, which resolves the module CID at
 * `worker-executor.ts:175`. The instrument is unaffected (both resolve through the same
 * `FetchingBlockstore`), but the file:line the plan cites names a class that is not on
 * this path. Plan 14-03 recorded the identical correction; it had not reached this plan.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

// Seeds 54 and 55 — distinct from every other fixture key in the repository, and
// adjacent to 51/52/53 so the three spawn files' keys read as one family.
const publisher = keypair(54)
const impostor = keypair(55)

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type: `bin/agent.ts` watches fd 0 and leaves when
 * it closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. Handing it `ignore` would put `/dev/null` on fd 0 and silently opt this file
 * out. See `orphan-leash.node.test.ts`, which demonstrates it and guards this line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * The whole parsed handshake, not just the two fields the other spawn files keep.
 *
 * `trustAnchors` is what `bin/agent.ts` passed to `FabricNode.start`, printed by that
 * process rather than restated from its source — which is the only way "the flag
 * replaces the default" becomes a measurement instead of a reading of an argv line.
 */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly trustAnchors: readonly string[]
}

interface Agent extends Handshake {
  readonly dir: string
  readonly child: AgentProcess
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []

/**
 * Spawn an agent process and wait for its one-line handshake.
 *
 * Deliberately **not** passing `--trust-anchor` unless a caller asks for it — unlike
 * the copy in `egress-refusal.node.test.ts`, which always supplies one. One case below
 * is precisely about what a process with no flag pins, so the flag cannot be baked in
 * here.
 *
 * Two clocks: this handshake budget is 30 s, and it is the *inner* one. The outer one
 * is each `it`'s 120 s `testTimeout` (below). Sized that way round on purpose — if the
 * inner budget were the larger, a child that never announced would surface as an
 * anonymous framework timeout naming no step, instead of as this function's message
 * carrying the child's stderr.
 */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const handshake = await new Promise<Handshake>((resolve, reject) => {
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
        resolve(JSON.parse(stdout.slice(0, newline)) as Handshake)
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
 * The submitter.
 *
 * `trustAnchors` is the publisher's key rather than the opt-out: a submitter declaring
 * a different authority from the nodes it dispatches to would be a lie in a file nobody
 * would re-read. It is not what any assertion here turns on — every refusal below is
 * taken on the spawned process's side of the socket — but `submitJob` runs in this
 * process and a reader is entitled to see which authority it claims.
 *
 * 30 s RPC budget, the larger of the two figures the existing spawn files use
 * (`sovereignty-placement` 30 s, `egress-refusal` 10 s), because the accepted case runs
 * a full cross-process dispatch — exec request out, module block pulled back over the
 * wire by a child that has never seen it, WASM compiled and run in that child, reply
 * returned — and must not fail for want of time. It is a bound, not a measurement:
 * nothing in this file times anything, and nothing here should be read as if it did.
 */
async function startSubmitter(): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 30_000,
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
 * The CIDs of the blocks an agent's store holds on disk.
 *
 * Filters `.tmp-` exactly as `FsBlockstore.open` does (`fs-blockstore.ts:45`), because
 * a write interrupted mid-rename leaves one behind and it is not a block.
 *
 * Every assertion against this is **containment by CID string, never a count**. A count
 * would couple each reading to how many input blocks a dispatch happens to persist —
 * the accepted case's executor fetches the task's input right after its module
 * (`worker-executor.ts:175-180`) — which is not what is under test.
 */
async function blockNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir)
  return entries.filter((name) => !name.startsWith('.tmp-'))
}

function recordFor(name: string, priv: Uint8Array, cid: CID): NameRecord {
  return signName(priv, { name, cid, version: 1, expiresAt: Date.now() + 3_600_000 })
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-signed-'))
})

/**
 * 20 s, stated rather than left to Vitest's 10 s hook default, because `stopAgent`'s
 * own SIGKILL fallback is 10 s and a hook budget equal to the work it awaits can never
 * let that fallback fire — the same two-clock inversion the spawn helper's comment
 * names, in the other direction. Inner 10 s, outer 20 s.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

/**
 * Each case below spawns **its own agent into its own directory**, and no fixture is
 * shared between them beyond the workdir the `beforeEach` mints fresh. That is what
 * makes the directory reading attributable: a module block fetched by an earlier case
 * living on in a shared store would make a later `not.toContain` fail — or, worse, make
 * a later `toContain` pass — for a reason that has nothing to do with the case being
 * read.
 */
describe('DET-03/DATA-08 — signed artifact resolution across a real bin/agent.ts process', () => {
  it('runs a signed artifact end to end, and the agent it ran on pins exactly the flag it was given', async () => {
    const agent = await spawnAgent('accepted', ['--trust-anchor', publisher.pub])

    // ROADMAP criterion 2's other half, and the reason it is asserted here rather than
    // in its own case: this is the one agent in the file started *with* the flag, so it
    // is the only process that can show the field taking the non-default value. Read
    // against the no-flag case below, that is one handshake field observed taking both
    // values across a real process boundary — which is what makes "replaces rather than
    // extends" a measurement. `toEqual`, never `toContain`: the claim is *exactly this
    // set and no other*, and a containment check would pass against a merged set, which
    // is precisely the defect the reading exists to catch.
    expect(agent.trustAnchors).toEqual([publisher.pub])

    const submitter = await startSubmitter()
    await submitter.dial(agent.multiaddrs[0]!)

    // Only the submitter holds the module, so the child must pull it over the wire —
    // the property `two-process.node.test.ts` establishes for NET-01, and the
    // precondition for the directory reading meaning anything at all.
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(agent.peerId, submitter.rpc, 'dispatches-unauthenticated')]

    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor('signed-artifact-accepted', publisher.priv, moduleCid),
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status !== 'agreed') return
    // The agreeing node is the spawned process, not the submitter. Without this the
    // whole file would be compatible with the job having quietly run in-process.
    expect(shard.verification.agreeing.map((e) => e.nodeId)).toEqual([agent.peerId])

    // The positive reading of the instrument every refusal below relies on.
    expect(await blockNames(agent.dir)).toContain(moduleCid.toString())
  }, 120_000)

  it('refuses a bare CID, naming the missing record and the module it was missing for', async () => {
    const agent = await spawnAgent('bare-cid', ['--trust-anchor', publisher.pub])
    const submitter = await startSubmitter()
    await submitter.dial(agent.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(agent.peerId, submitter.rpc, 'dispatches-unauthenticated')]

    // The accepted case's job with exactly one argument removed. `moduleRecord` is
    // optional on `JobSpec` by design — the refusal is on the far side of the wire,
    // where it can be trusted — so this compiles, dispatches, and is refused there.
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('insufficient')
    if (shard?.verification.status !== 'insufficient') return

    // Substrings taken from the production wording (`describeModuleRefusal`'s
    // `no-record` arm), never a whole sentence — a whole-sentence assertion turns every
    // wording improvement into a test failure, which is how a test stops being
    // maintained.
    expect(shard.verification.failures[0]?.nodeId).toBe(agent.peerId)
    expect(shard.verification.failures[0]?.reason).toContain('signed name record')
    expect(shard.verification.failures[0]?.reason).toContain(moduleCid.toString())

    // Criterion 2's "before instantiation", read off the far side of the boundary: the
    // bytes were reachable — the submitter holds them and the socket is open — and the
    // agent never went and got them.
    expect(await blockNames(agent.dir)).not.toContain(moduleCid.toString())
  }, 120_000)

  it('refuses a record signed by a key it was not started with, naming that key', async () => {
    const agent = await spawnAgent('unpinned-key', ['--trust-anchor', publisher.pub])
    const submitter = await startSubmitter()
    await submitter.dial(agent.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(agent.peerId, submitter.rpc, 'dispatches-unauthenticated')]

    // A structurally perfect record — correct CID, unexpired, version 1, and a genuine
    // Ed25519 signature that verifies against its own signer. The only thing wrong with
    // it is who signed it, which is the entire content of criterion 2.
    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor('signed-artifact-unpinned', impostor.priv, moduleCid),
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('insufficient')
    if (shard?.verification.status !== 'insufficient') return

    expect(shard.verification.failures[0]?.nodeId).toBe(agent.peerId)
    expect(shard.verification.failures[0]?.reason).toContain(impostor.pub)
    expect(shard.verification.failures[0]?.reason).toContain('not a pinned trust anchor')

    expect(await blockNames(agent.dir)).not.toContain(moduleCid.toString())
  }, 120_000)

  it('refuses a valid record that vouches for a different artifact, naming both CIDs', async () => {
    const agent = await spawnAgent('substitution', ['--trust-anchor', publisher.pub])
    const submitter = await startSubmitter()
    await submitter.dial(agent.multiaddrs[0]!)

    // Both modules go into the submitter's store, so both are fetchable over the wire.
    // That is deliberate: a block the agent could not have obtained anyway would make
    // the two `not.toContain` readings below prove nothing.
    const writesCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const echoCid = await submitter.store.put(MODULE_ECHOES_INPUT)
    expect(echoCid.toString()).not.toBe(writesCid.toString())

    const executors = [new RemoteExecutor(agent.peerId, submitter.rpc, 'dispatches-unauthenticated')]

    // The attack a signature check alone does not catch, and what 14-CONTEXT.md calls
    // the entire point of the check: the record is signed by the key the agent pins, is
    // unexpired, is version 1, and verifies — it simply vouches for a *different*
    // module than the one the task dispatches.
    const result = await submitJob(
      {
        moduleCid: writesCid,
        moduleRecord: recordFor('signed-artifact-substitution', publisher.priv, echoCid),
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('insufficient')
    if (shard?.verification.status !== 'insufficient') return

    // Both CIDs, and the conjunction is the assertion: a reason naming only the signed
    // one would mean the guard read the record and never looked at the task, and a
    // reason naming only the dispatched one would mean it never read the record.
    // Either way it would have compared nothing.
    expect(shard.verification.failures[0]?.nodeId).toBe(agent.peerId)
    expect(shard.verification.failures[0]?.reason).toContain(echoCid.toString())
    expect(shard.verification.failures[0]?.reason).toContain(writesCid.toString())

    const held = await blockNames(agent.dir)
    expect(held).not.toContain(writesCid.toString())
    expect(held).not.toContain(echoCid.toString())
  }, 120_000)

  it('pins exactly the demo anchor when started with no flag, and refuses a record signed by anyone else', async () => {
    // No `--trust-anchor` at all — a stock agent, started the way a volunteer would
    // start one.
    const agent = await spawnAgent('no-flag')

    // The binary's default, observed *in the process* rather than inferred from the
    // source. `toEqual` for the same reason as the accepted case: this asserts the set
    // is the demo's anchor and nothing else, which is what makes the flag's effect in
    // the accepted case a replacement rather than an addition.
    expect(agent.trustAnchors).toEqual([KERNEL_TRUST_ANCHOR])

    const submitter = await startSubmitter()
    await submitter.dial(agent.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(agent.peerId, submitter.rpc, 'dispatches-unauthenticated')]

    // Byte-for-byte the accepted case's job — correct key, correct CID, valid
    // signature, unexpired. The only thing that changed is which process it was sent
    // to, and that process was never told about `publisher`.
    const result = await submitJob(
      {
        moduleCid,
        moduleRecord: recordFor('signed-artifact-accepted', publisher.priv, moduleCid),
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('insufficient')
    if (shard?.verification.status !== 'insufficient') return

    expect(shard.verification.failures[0]?.nodeId).toBe(agent.peerId)
    expect(shard.verification.failures[0]?.reason).toContain(publisher.pub)
    expect(shard.verification.failures[0]?.reason).toContain('not a pinned trust anchor')

    expect(await blockNames(agent.dir)).not.toContain(moduleCid.toString())
  }, 120_000)
})
