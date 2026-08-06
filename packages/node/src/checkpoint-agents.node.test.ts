import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, publicNodes, signName, submitJob, toHex } from '@o2/core'
import type {
  CanonicalValue,
  Executor,
  JobCheckpoint,
  JobResult,
  JobSpec,
  NameRecord,
  NodeDescriptor,
  ShardResult,
  SubmitOptions,
  SubmitResult,
  Task,
} from '@o2/core'
import { RemoteExecutor, rpcAdmission } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * **CHURN-03** — *coordinator state is checkpointed to content-addressed storage so a
 * departed requestor does not lose the job.*
 *
 * ## The requestor is what goes away here, and that is the whole difference from 20-05
 *
 * `churn-agents.node.test.ts` kills **executors** and asks whether the answer survives.
 * This file kills the **requestor** and asks whether the *job* survives. The two files
 * look alike — same spawn helpers, same fabric shape, same budgets — and they measure
 * opposite halves, so the distinction is stated here rather than left to whoever reads
 * both. Nothing below kills an agent; every agent that comes up stays up.
 *
 * ## The entry point takes the substitution this project has now recorded five times
 *
 * **`bin/agent.ts` submits no job.** Measured 2026-08-04:
 * `grep -c 'submitJob\|JobSpec\|executeVerified' packages/node/src/bin/agent.ts` returns
 * **0** — it is a serving node whose only stdout is a handshake JSON. So a criterion
 * phrased *"through `bin/agent.ts`"* is satisfiable only as **"a job run *across*
 * `bin/agent.ts` processes"**: an in-process requestor `FabricNode` submitting to spawned
 * agents, the shape `discovery-agents.node.test.ts`, `quorum-agents.node.test.ts`,
 * `tree-reduce-agents.node.test.ts`, `owner-domain-agents.node.test.ts` and
 * `churn-agents.node.test.ts` all use. The substitution is stated **here** and not only in
 * a planning document, because Phase 19 learned that a substitution living in a plan
 * reaches nobody reading the test.
 *
 * ## What "the second requestor knows only a CID" means precisely
 *
 * It is a **different process-level identity** — its own `FabricNode`, its own peer id,
 * its own key material, its own connections, dialled after the first requestor was
 * stopped. It inherits **no in-memory state**: no `JobResult`, no lease table, no
 * placement, no executor set, not even a live handle to the first requestor's blockstore.
 * What it is given is the job spec and **one CID**.
 *
 * What it does share is the **directory** the first requestor's blocks are in, opened
 * freshly as its own `FsBlockstore`. That is the honest model of the case CHURN-03 names —
 * a browser tab closes, its IndexedDB persists, a new tab reads it — and it is what
 * *"checkpointed to content-addressed storage"* means when the storage is local.
 *
 * **The limit of that, measured rather than glossed.** The checkpoint block is not fetched
 * over the fabric, and it could not be: the wire has a `block` request that **pulls**
 * (`packages/net/src/protocol.ts`, search `kind: 'block'`) and there is no request that
 * pushes or provides one, so nothing puts a requestor's checkpoint onto a peer. Making the
 * hand-off survive the loss of the first requestor's disk needs a provide path that does
 * not exist today; that is a finding, not a case this file fakes.
 *
 * ## "Correct" is an equality against a control run in the same fixture
 *
 * A pinned expected output encodes the fixture and the kernel of the day it was written.
 * What this file compares is the identical job over the identical inputs, run start to
 * finish by one requestor that never went away, **over the same fabric in the same run**.
 * The control also carries the instrument check: it must dispatch every partition exactly
 * `REDUNDANCY` times, or the once-in-total reading below would prove nothing.
 *
 * ## The load-bearing reading, and where it is taken
 *
 * A resume and a restart produce the **same answer**, so no assertion about the answer can
 * tell them apart. What tells them apart is the **dispatch count**, and it has to span both
 * requestors — the second requestor's own result cannot see what the first one dispatched.
 * So {@link dispatches} is one counter per run, incremented in a wrapper around the
 * *production* `RemoteExecutor` before the call goes out, and the claim is: **for every
 * partition the checkpoint names, the second requestor dispatched it zero times, and the
 * total across both requestors equals what the first requestor alone spent.**
 *
 * **What that instrument is and is not.** It counts dispatches that left a requestor
 * process for an agent. It is not read from the agents' own bookkeeping, because they keep
 * none that is reachable — `bin/agent.ts` writes one handshake line and then logs only
 * failures (measured: `grep -n 'console\.\|process.std' packages/node/src/bin/agent.ts`),
 * and a spawned process's `CountingExecutor` is inside a process this one cannot read. So
 * the counter sits at the last point in this process before the wire, which is the closest
 * a reading can get to the fabric from here, and it is stated rather than dressed up.
 *
 * ## What this file CANNOT redden on
 *
 * - **Recovery to an older handle when the newest checkpoint block is lost.** That arm is
 *   `packages/core/src/job/submit.test.ts`'s — it needs a block hidden from a reader, and
 *   hiding one behind a real `FsBlockstore` would measure the wrapper rather than
 *   `recoverCheckpoint`. This file resumes from exactly one handle, which is also the
 *   ordinary case.
 * - **Executor churn.** No agent is killed here; `churn-agents.node.test.ts` holds that.
 * - **`checkpoint.ts`'s own validation.** `checkpoint.test.ts` holds it. The bad-CID arm
 *   below says only that `submitJob` carries the failure *union* out over the production
 *   path instead of throwing or silently running everything.
 * - **A departed requestor whose disk is also gone.** See the limit above.
 * - **A carried shard reporting the wrong CID, where the wrong CID is its own input.**
 *   `MODULE_ECHOES_INPUT` is the identity function, so a shard's `resultCid` **equals** its
 *   `inputCid` on this fabric. Measured, not reasoned: planting `resultCid: inputCid` into
 *   the carried-shard record left this whole file **green** while reddening six cases in
 *   `packages/core/src/job/submit.test.ts`, whose guest sums rather than echoes. That is
 *   20-07's recorded shape — a plant that survives because a different mechanism produces
 *   the same observable — and it is stated here rather than discovered by whoever next
 *   trusts this file's CID equality to hold that claim. The equality here is still worth
 *   taking: it holds the answers against a control, and every one of them came back over a
 *   wire from a spawned agent. It just is not what holds *that* particular substitution.
 *
 * ## Why the guest is `MODULE_ECHOES_INPUT`
 *
 * `MODULE_WRITES_PARTITION` ignores its input entirely and emits the partition index, so a
 * job's answers would not depend on the data it carried at all. The echo guest makes each
 * shard's output a function of that shard's own bytes, which is what makes the six answers
 * distinct and the per-shard equality six readings rather than one. Its limit is the entry
 * above, and it is the same limit `churn-agents.node.test.ts` records for the same guest.
 *
 * ## No wall-clock threshold anywhere below
 *
 * Every duration is printed and never asserted. The quantitative readings are counts and
 * equalities taken inside one run.
 *
 * ## Budget
 *
 * Eight processes: six spawned agents plus two in-process requestors, only one of which is
 * alive at a time. The timeouts are `churn-agents.node.test.ts`'s and
 * `discovery-agents.node.test.ts`'s, reused rather than newly chosen.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, copied from `discovery-agents.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000

/** Per-`it` budget, copied from `churn-agents.node.test.ts`. */
const PROCESS_TEST_TIMEOUT = 300_000

/**
 * The requestor's RPC budget — `churn-agents.node.test.ts`'s value, kept for its reason:
 * short enough that a dispatch to a node that is not answering gives up on *this* budget
 * rather than on `DEFAULT_RPC_TIMEOUT_MS` (30 000).
 */
const RPC_TIMEOUT_MS = 10_000

/** How long the fixture will wait for the first requestor to reach its pause point. */
const PAUSE_BUDGET_MS = 120_000

/**
 * Seed 116 — distinct from every other fixture key in the repository.
 *
 * Census taken 2026-08-04 over `packages/` and `tools/`
 * (`grep -rhno 'fill([0-9]\+)' … | sort -n -u`): the whole set is
 * `{0, 1, 7, 9, 19, 20, 21, 31, 32, 33, 41, 42, 49, 51, 52, 53, 56–72, 77, 80–82, 90, 91,
 * 99, 113, 114, 115}`. 113 is `late-combine`, 114 is `churn-agents`, 115 is
 * `speculation-agents`.
 *
 * `bin/agent.ts` pins the demo's kernel anchor by default, so an unsigned job would have
 * every dispatch refused before a single shard existed to checkpoint.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(116)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'checkpoint-agents-fixture',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/**
 * stdin is piped and never written to — `bin/agent.ts` watches fd 0 and leaves when it
 * closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. `orphan-leash.node.test.ts` fails any spawn site that hands it `ignore`.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Agent {
  readonly name: string
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly dir: string
  readonly child: AgentProcess
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []

/** Spawn an agent process and wait for its one-line address handshake. */
async function spawnAgent(name: string): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  const handshake = await new Promise<{ peerId: string; multiaddrs: string[] }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)),
      ANNOUNCE_BUDGET_MS,
    )
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

  const agent: Agent = { ...handshake, name, dir, child }
  agents.push(agent)
  return agent
}

/** SIGTERM, then wait for the process to actually be gone. Copied from `churn-agents`. */
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
 * Six agents, which is the smallest count that keeps every reading below honest.
 *
 * `SHARDS × REDUNDANCY` is twelve placements, so every agent participates twice and no
 * shard is forced onto a node another shard is already on for want of anywhere else.
 * Nothing here is killed, so the fabric does not have to be wide enough to survive a loss
 * — that is `churn-agents.node.test.ts`'s constraint and it is not this file's.
 */
const AGENT_COUNT = 6

/** Six shards, so the pause point below leaves a real remainder rather than one shard. */
const SHARDS = 6

/**
 * Redundancy **2**, and the choice matters for the counter rather than for the resume.
 *
 * At redundancy 1 the once-in-total reading is "1 versus 2", which a single spurious
 * re-dispatch would flip. At 2 it is "2 versus 4", and the control's own instrument check
 * — exactly 2 per partition — is what makes the second number mean something. It also
 * matches `churn-agents.node.test.ts`, so the two files' figures are comparable.
 */
const REDUNDANCY = 2

/**
 * Publish this many checkpoints, then hold the requestor still.
 *
 * Three of six: enough that the resume has real work left, and enough that the carried set
 * is more than one shard. The pause is taken **inside the sink** — the production path's
 * own publish call — rather than after a sleep, which is `churn-agents.node.test.ts`'s
 * technique for staging its kill one layer down from the driver.
 */
const PAUSE_AFTER = 3

/**
 * The partitions the first requestor is held back from dispatching until it has departed.
 *
 * **This is what makes the departure mid-job rather than mid-record**, and it was found by
 * measurement rather than reasoned about: without it, six shards over six agents all
 * answered within one turn, the sink's pause caught the job with everything already
 * computed and only the *writing* unfinished, and the departed job reported
 * `complete: true`. A checkpoint hand-off measured against a job that had in fact finished
 * would be measuring nothing.
 *
 * Held one layer down, in a wrapper around the production dispatch — the seam
 * `churn-agents.node.test.ts` stages its kill on. `submitJob` places every shard *first*
 * and only then enters the per-shard loop, so these three are **placed and not yet
 * dispatched** at the instant the requestor goes away, which is `checkpoint.ts`'s own
 * hardest case: *"A task that was in flight when the tab closed is simply outstanding,
 * because its lease expired."*
 */
const HELD = [3, 4, 5]

/** `publicNodes` gives no certificates, so no quorum composes and this dial is never read. */
const SHORTFALL: 'runs-at-available-redundancy' = 'runs-at-available-redundancy'

interface Fabric {
  readonly agents: readonly Agent[]
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
  readonly nodes: readonly NodeDescriptor[]
  readonly shardValues: readonly CanonicalValue[]
  /**
   * The content address of each shard's input, in shard order.
   *
   * Kept so the departure probe below can dispatch a task the fabric can **actually run**.
   * That matters more than it looks: the probe's first form addressed the *module* block as
   * its input, which every live agent also refuses — the guest echoes its input and the
   * module's bytes are not a canonical value — so the assertion read `ok: false` whether the
   * endpoint was up or down. It was found by planting, not by reading: keeping the first
   * requestor alive left it green.
   */
  readonly inputCids: readonly CID[]
}

/** The value shard `i` carries. Distinct per shard, so a mixed-up shard is visible. */
function shardValue(i: number): CanonicalValue {
  return { checkpoint: 'checkpoint-agents', partition: i }
}

/**
 * Every partition a run dispatched, and how many times.
 *
 * One map per run — control, departed, resumed — because the claim is about the *sum* over
 * two of them against a third, and a single shared counter could not express it.
 */
type Dispatches = Map<number, number>

/** Wrap the production dispatch and count it. Nothing else about it changes. */
function counted(inner: Executor, into: Dispatches): Executor {
  return {
    nodeId: inner.nodeId,
    execute: async (task: Task) => {
      into.set(task.partitionIndex, (into.get(task.partitionIndex) ?? 0) + 1)
      return inner.execute(task)
    },
  }
}

/**
 * A checkpoint sink that stops the world on the `pauseAfter`-th publish.
 *
 * `submitJob` awaits `publish`, so blocking inside it freezes the job at a **known**
 * number of answered shards rather than at whatever a sleep happened to catch. That is the
 * seam this fixture stages the departure on.
 */
function pausingSink(pauseAfter: number): {
  readonly sink: NonNullable<SubmitOptions['checkpoints']>
  readonly handles: CID[]
  readonly written: JobCheckpoint[]
  readonly reached: Promise<void>
  readonly release: () => void
} {
  const handles: CID[] = []
  const written: JobCheckpoint[] = []
  let arrive = (): void => {}
  let letGo = (): void => {}
  const reached = new Promise<void>((resolve) => {
    arrive = resolve
  })
  const gate = new Promise<void>((resolve) => {
    letGo = resolve
  })
  return {
    handles,
    written,
    reached,
    release: (): void => letGo(),
    sink: {
      publish: async (handle: CID, checkpoint: JobCheckpoint): Promise<void> => {
        handles.push(handle)
        written.push(checkpoint)
        if (handles.length === pauseAfter) {
          arrive()
          await gate
        }
      },
    },
  }
}

/** Spawn the fabric and pre-seed every agent. Order copied from `churn-agents`. */
async function standUp(): Promise<Fabric> {
  const shardValues = Array.from({ length: SHARDS }, (_, i) => shardValue(i))
  const encoded = await Promise.all(shardValues.map((value) => canonicalCid(value)))

  const names = Array.from({ length: AGENT_COUNT }, (_, i) => `a${i}`)
  for (const name of names) {
    // Before the spawn, never after: seeding afterwards races the agent's own open of the
    // same directory, and that race has cost this repository a debugging session before
    // (`discovery-agents.node.test.ts` records it).
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(MODULE_ECHOES_INPUT)
    for (const block of encoded) {
      if (!block.ok) throw new Error('a fixture shard value will not canonicalise')
      await store.put(block.bytes)
    }
  }

  const spawned = await Promise.all(names.map((name) => spawnAgent(name)))
  const moduleCid = await (await FsBlockstore.open(join(workdir, 'module'))).put(MODULE_ECHOES_INPUT)

  return {
    agents: spawned,
    moduleCid,
    moduleRecord: recordFor(moduleCid),
    // Built **once** and reused by every run. Placement is a pure function of this input,
    // so reusing it removes the question of whether two runs were handed equal-but-distinct
    // node sets entirely.
    nodes: publicNodes(spawned.map((agent) => ({ nodeId: agent.peerId }))),
    shardValues,
    inputCids: encoded.map((block) => {
      if (!block.ok) throw new Error('a fixture shard value will not canonicalise')
      return block.cid
    }),
  }
}

/** A requestor: a `FabricNode` of its own, dialled outward at one connection per agent. */
async function standUpRequestor(fabric: Fabric, name: string): Promise<FabricNode> {
  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    trustAnchors: [publisher.pub],
  })
  nodes.push(requestor)
  // Outward, one connection per agent: `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host,
  // so a fixture this size must not invert the direction.
  const dialed = await Promise.all(
    fabric.agents.map((agent) => requestor.dial(agent.multiaddrs[0] as string)),
  )
  expect([...dialed].sort()).toEqual(fabric.agents.map((a) => a.peerId).sort())
  return requestor
}

/**
 * The job. The only things that ever differ between runs are the executors and the
 * options — the module, the record, the shard values, the descriptors, the redundancy and
 * the shortfall dial are one object graph.
 */
function specFor(
  fabric: Fabric,
  requestor: FabricNode,
  into: Dispatches,
  hold?: { readonly partitions: readonly number[]; readonly until: Promise<void> },
): JobSpec {
  return {
    moduleCid: fabric.moduleCid,
    moduleRecord: fabric.moduleRecord,
    shards: fabric.shardValues.map((value) => ({ value, label: 'public' as const })),
    executors: executorsFor(fabric, requestor, into, hold),
    nodes: fabric.nodes,
    redundancy: REDUNDANCY,
    onQuorumShortfall: SHORTFALL,
    // The production admission path, as `discovery-agents.node.test.ts` and
    // `churn-agents.node.test.ts` use it. It is also the evidence channel lease renewal
    // runs on, though nothing here holds a lease near `RENEW_AT`.
    admit: rpcAdmission(requestor.rpc),
  }
}

/** The counted, production `RemoteExecutor` set for one requestor. */
function executorsFor(
  fabric: Fabric,
  requestor: FabricNode,
  into: Dispatches,
  hold?: { readonly partitions: readonly number[]; readonly until: Promise<void> },
): readonly Executor[] {
  return fabric.agents.map((agent) => {
    const wire = counted(new RemoteExecutor(agent.peerId, requestor.rpc, 'dispatches-unauthenticated'), into)
    if (hold === undefined) return wire
    return {
      nodeId: wire.nodeId,
      execute: async (task: Task) => {
        // The gate is **before** the counter, so a dispatch that has not yet left is not
        // counted as one that did. See {@link HELD}.
        if (hold.partitions.includes(task.partitionIndex)) await hold.until
        return wire.execute(task)
      },
    }
  })
}

/** Every shard's agreed result CID in shard order. `null` where the shard did not agree. */
function cidsOf(job: JobResult): readonly (string | null)[] {
  return job.shards.map((shard) =>
    shard.verification.status === 'agreed' ? shard.verification.resultCid.toString() : null,
  )
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-checkpoint-'))
})

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('CHURN-03 — the requestor goes away and a second one finishes the job from a CID', () => {
  it('finishes only the outstanding shards over the same live agents, matches an uninterrupted control per shard, and refuses a CID that is not this job’s checkpoint', async () => {
    const startedAt = performance.now()
    const fabric = await standUp()
    const standUpMs = performance.now() - startedAt

    // A precondition of the harness rather than of the fabric: six distinct peer ids, each
    // off a distinct child's stdout handshake. **No deletion in production code turns this
    // red** — it is reported as what it is.
    expect(fabric.agents).toHaveLength(AGENT_COUNT)
    expect(new Set(fabric.agents.map((a) => a.peerId)).size).toBe(AGENT_COUNT)

    const first = await standUpRequestor(fabric, 'requestor-1')

    // ---- The control: one requestor, start to finish, nobody departs. ---------------
    const controlDispatches: Dispatches = new Map()
    const controlAt = performance.now()
    const control = await submitJob(
      specFor(fabric, first, controlDispatches),
      await FsBlockstore.open(join(workdir, 'control-store')),
      { checkpoints: 'checkpoints-nothing',},
    )
    const controlMs = performance.now() - controlAt
    expect(control.ok).toBe(true)
    if (!control.ok) throw new Error(`the control job was refused: ${JSON.stringify(control.error)}`)

    // Printed before the instrument check below, so a lossy control says *which* shard was
    // lossy rather than only that one was. A control that fails this check invalidates every
    // count in the file, so the first thing anybody debugging it needs is this line.
    console.log(
      `[CHURN-03 / control] endings [${control.job.shards.map((s) => s.ending).join(',')}]; ` +
        `statuses [${control.job.shards.map((s) => s.verification.status).join(',')}]; ` +
        `degraded [${control.job.shards.map((s) => (s.degraded ? 'y' : 'n')).join(',')}]; ` +
        `redispatches ${control.job.redispatches}; ` +
        `lease events [${control.job.leaseHistory.map((e) => e.kind).join(',')}]`,
    )

    // THE INSTRUMENT CHECK, and it comes first. A control that was itself lossy — an agent
    // that never got its blocks, a fabric under enough contention to time out a healthy
    // dispatch — would make every count below unattributable, and this is the most common
    // way a file of this class goes quietly wrong.
    expect(control.job.complete).toBe(true)
    expect(control.job.redispatches).toBe(0)
    for (let i = 0; i < SHARDS; i++) expect(controlDispatches.get(i)).toBe(REDUNDANCY)
    const controlCids = cidsOf(control.job)
    expect(controlCids.filter((cid) => cid === null)).toEqual([])
    // Six distinct answers, so the per-shard equality below is six readings and not one
    // repeated. Distinctness comes from the guest — `MODULE_ECHOES_INPUT` makes a shard's
    // output a function of its own bytes — not from anything asserted here.
    expect(new Set(controlCids).size).toBe(SHARDS)

    // ---- The departure. --------------------------------------------------------------
    //
    // The shared, durable, content-addressed store: the only thing besides one CID that
    // crosses from the first requestor to the second. Opened separately by each of them,
    // so no in-memory handle is inherited.
    const coordinatorDir = join(workdir, 'coordinator-store')
    const departedDispatches: Dispatches = new Map()
    const log = pausingSink(PAUSE_AFTER)
    let openHeld = (): void => {}
    const heldUntil = new Promise<void>((resolve) => {
      openHeld = resolve
    })
    const departedAt = performance.now()
    // NOT awaited. This is the job that never returns to its requestor, which is the whole
    // case: a `JobResult` is exactly what a departed requestor does not get, and it is why
    // the handle leaves through the sink rather than on the result.
    const abandoned: Promise<SubmitResult> = submitJob(
      specFor(fabric, first, departedDispatches, { partitions: HELD, until: heldUntil }),
      await FsBlockstore.open(coordinatorDir),
      { checkpoints: log.sink },
    )
    // Attached immediately so an eventual failure of an abandoned promise cannot surface as
    // an unhandled rejection in an unrelated test file.
    const settled: Promise<SubmitResult | null> = abandoned.catch(() => null)

    await Promise.race([
      log.reached,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`the first requestor published fewer than ${PAUSE_AFTER} checkpoints`)),
          PAUSE_BUDGET_MS,
        )
        timer.unref()
      }),
    ])

    const pausedAt = performance.now()
    // The handle, captured at a known point: the production sink's own `publish` call, held
    // open. Everything the second requestor is given is on the next three lines.
    const handle = log.handles[PAUSE_AFTER - 1] as CID
    const carriedByCheckpoint = (log.written[PAUSE_AFTER - 1] as JobCheckpoint).completed.map(
      (shard) => shard.partitionIndex,
    )
    expect(carriedByCheckpoint).toHaveLength(PAUSE_AFTER)
    // **Measures this test's own staging, not the fabric.** The held partitions cannot have
    // answered, so the checkpoint names exactly their complement — which is what makes the
    // readings below deterministic rather than "whatever had settled when we looked".
    expect([...carriedByCheckpoint].sort((x, y) => x - y)).toEqual(
      Array.from({ length: SHARDS }, (_, i) => i).filter((i) => !HELD.includes(i)),
    )

    // **The departure is real, and these two assertions measure THIS TEST'S OWN ACTION
    // rather than anything the fabric does.** No deletion in production code turns them
    // red. They are a precondition for everything below: without them the file would be
    // measuring a continuation rather than a recovery.
    await first.stop()
    log.release()
    // The held dispatches are let go **after** the endpoint is shut, so they go out over a
    // stopped node and fail — which is what an outstanding task belonging to a departed
    // requestor actually does. Nothing cancels them; nothing has to.
    openHeld()
    // **The endpoint is shut, read as a binary.** Dialling a peer this node is already
    // connected to resolves on a live node and rejects on a stopped one, so this reads the
    // endpoint and nothing else.
    //
    // It replaced a probe that dispatched a task and required `ok: false`, which was an
    // assertion that could not fail: a dispatch to a *live* endpoint also comes back
    // `ok: false` here, and keeping the first requestor alive left the whole file green.
    // Found by planting exactly that, twice — once with the module's own CID as the input
    // (refused by every agent, since the guest echoes its input and a module is not a
    // canonical value) and once with a real task, which is still refused for a reason this
    // file never pinned down and therefore must not rest on.
    const stillReachable = await first
      .dial(fabric.agents[0]?.multiaddrs[0] as string)
      .then(
        () => true,
        () => false,
      )
    expect(stillReachable).toBe(false)

    // ---- The second requestor: a new node, and one CID. ------------------------------
    //
    // The abandoned job is still unwinding on a dead endpoint while this runs, which is the
    // truthful arrangement: nobody told it to stop and nothing could. It is awaited at the
    // end, where what it came to is read.
    const second = await standUpRequestor(fabric, 'requestor-2')
    expect(second.peerId).not.toBe(first.peerId)

    const resumedDispatches: Dispatches = new Map()
    const resumedAt = performance.now()
    const resumed = await submitJob(
      specFor(fabric, second, resumedDispatches),
      // Opened fresh, over the directory the departed requestor wrote into. A new object,
      // a new file-descriptor set, no inherited state — the storage, not the coordinator.
      await FsBlockstore.open(coordinatorDir),
      { checkpoints: 'checkpoints-nothing', resumeFrom: [handle] },
    )
    const resumedMs = performance.now() - resumedAt
    expect(resumed.ok).toBe(true)
    if (!resumed.ok) throw new Error(`the resumed job was refused: ${JSON.stringify(resumed.error)}`)

    const outstanding = Array.from({ length: SHARDS }, (_, i) => i).filter(
      (i) => !carriedByCheckpoint.includes(i),
    )

    // The abandoned job has had the whole of the second requestor's stand-up and run to
    // unwind on a dead endpoint. Awaited **here**, ahead of every assertion, so the printed
    // line below is produced on a failing run as well as a passing one — a diagnostic that
    // only appears when everything already worked is a diagnostic nobody gets to use.
    const departed = await settled
    expect(departed?.ok).toBe(true)
    if (departed === null || !departed.ok) throw new Error('the departed job did not produce a result')

    // Printed rather than asserted, so the readings are on every run instead of surviving
    // as a note somebody took once — `churn-agents.node.test.ts`'s precedent, for its
    // reason. **None of these is compared against a threshold.**
    console.log(
      `[CHURN-03 / checkpoint] standUp ${Math.round(standUpMs)}ms for ${AGENT_COUNT} agents, ` +
        `control ${Math.round(controlMs)}ms, departed run reached its pause after ` +
        `${Math.round(pausedAt - departedAt)}ms and unwound by ` +
        `${Math.round(performance.now() - departedAt)}ms, resumed run ${Math.round(resumedMs)}ms; ` +
        `the checkpoint named [${carriedByCheckpoint.join(',')}] and the resume ran ` +
        `[${outstanding.join(',')}]; the departed requestor agreed ` +
        `${cidsOf(departed.job).filter((cid) => cid !== null).length} of ${SHARDS} shards; ` +
        `dispatches per partition — control ` +
        `[${Array.from({ length: SHARDS }, (_, i) => controlDispatches.get(i) ?? 0).join(',')}], ` +
        `departed [${Array.from({ length: SHARDS }, (_, i) => departedDispatches.get(i) ?? 0).join(',')}], ` +
        `resumed [${Array.from({ length: SHARDS }, (_, i) => resumedDispatches.get(i) ?? 0).join(',')}]`,
    )

    // ---- (1) THE ONCE-IN-TOTAL READING. ---------------------------------------------
    // For every partition the checkpoint names: the second requestor dispatched it to
    // nobody, and the total across the two requestors is what the first one alone spent.
    // This is the reading that distinguishes a resume from a restart, and it cannot be
    // taken from the second requestor's own result.
    for (const i of carriedByCheckpoint) {
      expect(resumedDispatches.get(i) ?? 0).toBe(0)
      expect(departedDispatches.get(i) ?? 0).toBe(REDUNDANCY)
    }
    // And it did run the rest — the anti-vacuity half, so "dispatched nothing" is not
    // satisfied by a resume that dispatched nothing at all.
    for (const i of outstanding) expect(resumedDispatches.get(i) ?? 0).toBeGreaterThanOrEqual(1)
    expect(outstanding.length).toBeGreaterThan(0)

    // ---- (2) The carried shards say so by name. --------------------------------------
    // `generations: 0` with an empty `attempted` reads identically on a shard nobody would
    // take, so the ending is what says "somebody already did this".
    for (const i of carriedByCheckpoint) {
      const shard = resumed.job.shards[i] as ShardResult
      expect(shard.ending).toBe('carried-from-checkpoint')
      expect(shard.attempted).toEqual([])
    }
    for (const i of outstanding) {
      expect((resumed.job.shards[i] as ShardResult).ending).toBe('agreed')
    }

    // ---- (3) The answer, per shard by CID, against the control in this same run. ------
    expect(cidsOf(resumed.job)).toEqual(controlCids)

    // ---- (4) What the departed requestor's own job came to. --------------------------
    // It never finished: the three shards it was holding were placed and then had nowhere
    // to go, so a requestor that departs really does lose its job — and the point of the
    // record is that the *job* does not lose it.
    expect(departed.job.complete).toBe(false)
    for (const i of HELD) {
      expect((departed.job.shards[i] as ShardResult).verification.status).not.toBe('agreed')
    }
    // Said from the other end: the carried shards' answers are the ones the departed
    // requestor produced, retrieved by CID rather than recomputed.
    for (const i of carriedByCheckpoint) {
      expect(cidsOf(resumed.job)[i]).toBe(cidsOf(departed.job)[i])
    }


    // ---- (5) A bad CID is refused BY NAME, on the production path. --------------------
    // A shard input of this very job: a real block that decodes and is not a checkpoint,
    // which reaches `readCheckpoint`'s field validation rather than stopping at the lookup.
    const notACheckpoint = await canonicalCid(shardValue(0))
    expect(notACheckpoint.ok).toBe(true)
    if (!notACheckpoint.ok) throw new Error('a fixture shard value will not canonicalise')
    const refusedDispatches: Dispatches = new Map()
    const refused = await submitJob(
      specFor(fabric, second, refusedDispatches),
      await FsBlockstore.open(coordinatorDir),
      { checkpoints: 'checkpoints-nothing', resumeFrom: [notACheckpoint.cid] },
    )
    expect(refused.ok).toBe(false)
    if (refused.ok) throw new Error('a resume against a non-checkpoint was accepted')
    expect(refused.error.kind).toBe('checkpoint-unreadable')
    if (refused.error.kind !== 'checkpoint-unreadable') throw new Error('wrong refusal')
    // The KIND, not merely that something went wrong: `malformed` naming `jobId` says the
    // block was found and decoded and does not describe a job — a different remedy from a
    // block that is simply absent.
    expect(refused.error.failure.kind).toBe('malformed')
    if (refused.error.failure.kind !== 'malformed') throw new Error('wrong failure kind')
    expect(refused.error.failure.field).toBe('jobId')
    // And nothing ran: a refused resume does not half-run the job.
    expect(refusedDispatches.size).toBe(0)
  }, PROCESS_TEST_TIMEOUT)
})
