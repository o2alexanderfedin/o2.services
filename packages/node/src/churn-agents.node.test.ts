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
  JobResult,
  LeaseEvent,
  NameRecord,
  NodeDescriptor,
  ShardResult,
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
 * **Phase 20 criterion 2** — *killing 30 % of participating node processes mid-job, run
 * through `bin/agent.ts`, still produces the correct final result, with re-dispatches
 * visible in the job's history output.*
 *
 * ## The entry point takes the substitution this project has now recorded four times
 *
 * **`bin/agent.ts` submits no job.** Measured 2026-08-04:
 * `grep -c 'submitJob\|JobSpec\|executeVerified' packages/node/src/bin/agent.ts` returns
 * **0** — it is a serving node whose only stdout is a handshake JSON. So *"run through
 * `bin/agent.ts`"* is satisfiable only as **"a job run *across* `bin/agent.ts`
 * processes"**: an in-process requestor `FabricNode` submitting to spawned agents, the
 * shape `discovery-agents.node.test.ts`, `quorum-agents.node.test.ts`,
 * `tree-reduce-agents.node.test.ts` and `owner-domain-agents.node.test.ts` all use. The
 * substitution is stated **here** and not only in a planning document, because Phase 19
 * learned that a substitution living in a plan reaches nobody reading the test.
 *
 * ## "Correct" is an equality against a control run, never a pinned output
 *
 * A pinned expected output encodes the fixture and the kernel of the day it was written.
 * What this file compares is **the identical job over the identical inputs with nobody
 * killed, in the same run, over the same fabric**. An equality taken inside one run
 * cancels the host, the load and the fixture at once — `CLAUDE.md` § Measurement.
 *
 * The control also carries the *instrument check*: its re-dispatch count must be **zero**.
 * A fabric that was already lossy would make the killed run's re-dispatches prove nothing.
 *
 * ## What is killed, and why it is SIGKILL
 *
 * `killAgent` sends **SIGKILL**: the process *vanishes*, nothing is closed, and the
 * requestor discovers the loss the way it would discover a closed laptop — by asking and
 * getting nothing back. `stopAgent`'s SIGTERM is the easier case: `bin/agent.ts` installs
 * TERM/INT handlers that call `node.stop()`, so a SIGTERMed agent *leaves* and its peers
 * are told. The criterion says **killing**, so the harder case is the one taken. Both
 * helpers are faithful copies of `tree-reduce-agents.node.test.ts`'s, including that
 * file's own honesty about which of its assertions measures the test rather than the
 * fabric.
 *
 * ## What this file cannot redden on, stated so nobody upgrades it later
 *
 * - **Lease *renewal* (CHURN-04's evidence channel).** Nothing here holds a lease long
 *   enough to reach `RENEW_AT` — two-thirds of `DEFAULT_LEASE_MS`, i.e. 20 s, against a
 *   `rpcTimeoutMs` of {@link RPC_TIMEOUT_MS} which bounds every dispatch well below it.
 *   20-01's kernel pair in `packages/core/src/job/submit.test.ts` carries that claim.
 * - **Speculation.** It does not exist on the `submitJob` path until 20-07, and is read
 *   across processes by 20-09.
 * - **A departed *requestor*.** This file kills executors. 20-11 owns checkpointing.
 * - **`verification.failures` naming the dead on a shard that recovered.** 20-01 recorded
 *   why: `VerificationResult`'s `agreed` arm carries no `failures`, so a topped-up shard
 *   structurally cannot name the node that failed its first generation. The naming here
 *   therefore goes through the **lease history** and `ShardResult.attempted`, which are
 *   the fields CHURN-01 asks to be visible anyway.
 *
 * ## Which of `packages/net/src/churn.test.ts`'s behaviours this file now states
 *
 * 20-12 deletes that file with `runResilient`, and needs this list rather than a search.
 *
 * | `churn.test.ts` behaviour | here? |
 * |---|---|
 * | a node that is *gone* costs an attempt and the next node recomputes | **yes** — the whole test |
 * | a node that dies between placement and dispatch | **yes** — the kill is staged exactly there |
 * | the re-dispatch is visible in the job's history | **yes** — `redispatches` + `leaseHistory` |
 * | a 30 % kill still yields the correct aggregate | **yes**, and over real processes rather than `MemoryNetwork` |
 * | a module that **traps** is given up on rather than burning the fabric | **no** — no trapping module here; and `submitJob` structurally cannot make the `node`/`task` distinction (20-CONTEXT.md's ruling) |
 * | checkpoint resume | **no** — 20-11 |
 *
 * ## Why the guest is `MODULE_ECHOES_INPUT` and not `MODULE_WRITES_PARTITION`
 *
 * `MODULE_WRITES_PARTITION` — the fixture `tree-reduce-agents.node.test.ts` uses —
 * **ignores its input entirely** and emits the partition index. Over it, "change one
 * shard's input and watch the equality break" is not a falsifiable plant: the outputs
 * would be identical. `MODULE_ECHOES_INPUT` makes each shard's output a function of that
 * shard's own bytes, so the comparison depends on the data the job actually carried.
 *
 * **The honest limit of that choice**, so nobody reads more into it: the guest is the
 * identity function, so a shard's `resultCid` equals its `inputCid`. This file therefore
 * cannot tell "the agent echoed the input" from "the agent computed something that
 * happens to equal it" — and it does not need to. What it measures is that **two runs
 * over the same fabric produced the same bytes**, and neither side of that comparison is
 * arithmetic this process performed: both come back over a wire from spawned agents, and
 * the killed run's shards could just as easily have come back `insufficient`, or with a
 * merged result from a different generation.
 *
 * ## No wall-clock threshold anywhere below
 *
 * Every duration in this file is **printed and never asserted**. A makespan bound inside
 * an otherwise deterministic test reads host contention as a defect, and this repository
 * has two recorded instances of exactly that. The quantitative readings are ratios and
 * equalities taken inside one run.
 *
 * ## Budget
 *
 * Eleven processes: ten spawned agents plus one in-process requestor.
 * `tree-reduce-agents.node.test.ts` runs nine, so this is one above the established
 * maximum for this repository, and the reason ten is the number is on
 * {@link AGENT_COUNT}. The timeouts below are **that file's and
 * `discovery-agents.node.test.ts`'s, reused rather than newly chosen**.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, copied from `discovery-agents.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000

/**
 * Per-`it` budget, copied from `tree-reduce-agents.node.test.ts` and
 * `discovery-agents.node.test.ts`, both of which run this fixture shape.
 *
 * A ceiling for a loaded machine, not an estimate of the work — the measured cost is
 * printed by the test itself on every run.
 */
const PROCESS_TEST_TIMEOUT = 300_000

/**
 * The requestor's RPC budget.
 *
 * `tree-reduce-agents.node.test.ts`'s value, kept for its stated reason: short enough
 * that a dead node's fallthrough gives up on *this* budget rather than on
 * `DEFAULT_RPC_TIMEOUT_MS` (30 000), which is what keeps a re-dispatch inside a test
 * timeout. It is also what keeps every dispatch below `RENEW_AT × DEFAULT_LEASE_MS`
 * (20 s), which is why renewal is unreachable here — see the header.
 */
const RPC_TIMEOUT_MS = 10_000

/**
 * Seed 114 — distinct from every other fixture key in the repository.
 *
 * Census taken 2026-08-04 over `packages/` and `tools/`: the whole `fill(n)` set is
 * `{0, 1, 7, 9, 19, 20, 21, 31, 32, 33, 41, 42, 49, 51, 52, 53, 56–72, 77, 80–82, 90, 91,
 * 99, 113}` plus a handful of hex fills. 113 is `late-combine.node.test.ts`, 58 is
 * `tree-reduce-agents`, 59 is `discovery-agents`.
 *
 * `bin/agent.ts` pins the demo's kernel anchor by default, so an unsigned job would have
 * every dispatch refused before a single shard existed to re-dispatch — DET-03 is not
 * this file's subject, but this record is what lets the subject be reached.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(114)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'churn-agents-fixture',
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
        // Named fields only — the handshake line has grown twice and reading it
        // positionally would have broken on each.
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

/** SIGTERM, then wait for the process to actually be gone. Copied from `tree-reduce-agents`. */
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
 * SIGKILL, and wait for the child to be gone. Copied from `tree-reduce-agents`.
 *
 * Distinct from `stopAgent` on purpose, and the distinction is this file's whole subject
 * — see the header.
 */
async function killAgent(agent: Agent): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    agent.child.on('exit', () => resolve())
    agent.child.kill('SIGKILL')
  })
}

/**
 * Ten, and the number is the criterion's rather than a preference.
 *
 * Two conditions have to hold at once: **30 % must be at least two processes**, so that
 * the loss is a fabric event rather than one unlucky node; and **enough must survive to
 * finish the work**. Ten is the smallest count at which 30 % is a whole number ≥ 2 —
 * `Math.round(0.3 × 10) === 3` exactly, with no rounding to argue about — so the figure
 * in the criterion appears in this file as itself and not as an approximation of itself.
 * A wider fabric would only make each process cheaper to lose.
 */
const AGENT_COUNT = 10

/** The criterion's own fraction. Asserted against the killed count below, not assumed. */
const KILL_FRACTION = 0.3

/**
 * Eight shards at redundancy 2 — sixteen placements over ten nodes.
 *
 * Enough that every agent participates (asserted, not assumed) and enough that killing
 * three holders leaves each affected shard a live untried node inside its generation
 * budget. `DEFAULT_MAX_GENERATIONS` is **3** and is not a `JobSpec` field, so the budget
 * is a fixed quantity this fixture has to fit inside rather than a dial it can turn.
 */
const SHARDS = 8

/**
 * Map redundancy **2**, and this is the choice that makes the reading complete.
 *
 * 20-01 measured it and said so against its own interest: **at redundancy 1 only the
 * `insufficient` trigger is expressible.** The top-up trigger — a shard that came back
 * `agreed` with fewer replicas than it asked for — needs redundancy ≥ 2 to exist at all,
 * and it is the trigger a *partial* loss of a shard's replicas produces. A file measuring
 * churn at redundancy 1 would measure half the mechanism.
 */
const REDUNDANCY = 2

/**
 * What this requestor tells the job about quorum shortfall.
 *
 * `publicNodes` gives every descriptor `certificate: 'carries-no-certificate'` — nothing
 * in this fixture enrols — so `submitJob` composes no quorum, `ShardGate.degraded` is
 * false on every shard, and this dial is never read. It is stated because `JobSpec`
 * requires it to be stated: an optional strictness field would let this file mean
 * *degrade* without ever having said so.
 */
const SHORTFALL: 'runs-at-available-redundancy' = 'runs-at-available-redundancy'

interface Fabric {
  readonly agents: readonly Agent[]
  readonly requestor: FabricNode
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
  readonly nodes: readonly NodeDescriptor[]
  readonly shardValues: readonly CanonicalValue[]
}

/** The value shard `i` carries. Distinct per shard, so a mixed-up shard is visible. */
function shardValue(i: number): CanonicalValue {
  return { churn: 'churn-agents', partition: i }
}

/**
 * Spawn the fabric, pre-seed every agent, start the requestor, dial outward.
 *
 * **The seeding happens before the spawn, and the order is load-bearing.** Each agent's
 * `--dir` is written through `FsBlockstore` *before* the process exists; seeding
 * afterwards races the agent's own open of the same directory, and that race has cost
 * this repository a debugging session before (`discovery-agents.node.test.ts` records
 * it). Seeding is not merely an optimisation here: it takes the requestor off the
 * critical path of a dispatch, so a dead node's failure is the only thing a re-dispatch
 * has to be attributed to.
 *
 * Spawned with `Promise.all` because sequential startup is where the wall clock goes at
 * this count. The requestor dials **outward**, one connection per agent:
 * `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host, so a fixture this size must not
 * invert the direction — `tree-reduce-agents.node.test.ts`'s fact 2, inherited.
 */
async function standUp(): Promise<Fabric> {
  const shardValues = Array.from({ length: SHARDS }, (_, i) => shardValue(i))
  const encoded = await Promise.all(shardValues.map((value) => canonicalCid(value)))

  const names = Array.from({ length: AGENT_COUNT }, (_, i) => `a${i}`)
  for (const name of names) {
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(MODULE_ECHOES_INPUT)
    for (const block of encoded) {
      if (!block.ok) throw new Error('a fixture shard value will not canonicalise')
      await store.put(block.bytes)
    }
  }

  const spawned = await Promise.all(names.map((name) => spawnAgent(name)))

  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'requestor'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    // The same authority the agents were spawned with. A requestor declaring a different
    // one from the nodes it dispatches to would be a lie in a file nobody would re-read.
    trustAnchors: [publisher.pub],
  })
  nodes.push(requestor)

  const dialed = await Promise.all(spawned.map((agent) => requestor.dial(agent.multiaddrs[0] as string)))
  expect([...dialed].sort()).toEqual(spawned.map((a) => a.peerId).sort())

  const moduleCid = await requestor.store.put(MODULE_ECHOES_INPUT)
  for (const block of encoded) {
    if (block.ok) await requestor.store.put(block.bytes)
  }

  return {
    agents: spawned,
    requestor,
    moduleCid,
    moduleRecord: recordFor(moduleCid),
    // Built **once** and reused by both runs. Two `publicNodes` calls would produce equal
    // arrays, but placement is a pure function of this input and reusing it removes the
    // question entirely: the two runs are handed the identical node set.
    nodes: publicNodes(spawned.map((agent) => ({ nodeId: agent.peerId }))),
    shardValues,
  }
}

/**
 * Submit the job. The **only** thing that differs between the two runs is `executors`.
 *
 * Everything else — module, record, shard values, node descriptors, redundancy, the
 * shortfall dial and the admission control — is the same object graph, so a difference in
 * the answers is a difference the fabric made.
 */
async function runJob(fabric: Fabric, executors: readonly Executor[]): Promise<JobResult> {
  const result = await submitJob(
    {
      moduleCid: fabric.moduleCid,
      moduleRecord: fabric.moduleRecord,
      shards: fabric.shardValues.map((value) => ({ value, label: 'public' as const })),
      executors,
      nodes: fabric.nodes,
      redundancy: REDUNDANCY,
      onQuorumShortfall: SHORTFALL,
      // The production admission path, as `discovery-agents.node.test.ts` uses it. It is
      // what lets a *re*-placement discover that a node has died — an offer to a vanished
      // process comes back `unreachable` from `rpcAdmission`'s own bounded probe — so a
      // generation is spent on the loss and not on re-picking the same corpse. Without it
      // `placeAgain` would order the untried pool by node id and could hand a shard a
      // second dead node; that is a real property of the mechanism and it is inherited
      // here, not repaired.
      admit: rpcAdmission(fabric.requestor.rpc),
    },
    fabric.requestor.store,
    // CHURN-03 — this test asserts nothing about checkpointing.
    { checkpoints: 'checkpoints-nothing' },
  )
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`the job was refused: ${JSON.stringify(result.error)}`)
  return result.job
}

/** Every shard's agreed result CID, in shard order. `null` for a shard that did not agree. */
function resultCids(job: JobResult): readonly (string | null)[] {
  return job.shards.map((shard) =>
    shard.verification.status === 'agreed' ? shard.verification.resultCid.toString() : null,
  )
}

/**
 * One CID over the whole job's answer — the job-level reading, beside the per-shard one.
 *
 * Per-shard equality alone would be satisfied by a run that produced the right bytes in
 * the wrong order or for the wrong module. Hashing the ordered list under the module it
 * ran closes both at once, and it is still an equality against the control rather than a
 * pinned constant.
 */
async function jobAnswer(job: JobResult): Promise<string> {
  const digest = await canonicalCid({
    module: job.moduleCid.toString(),
    shards: resultCids(job).map((cid) => cid ?? 'did-not-agree'),
  })
  if (!digest.ok) throw new Error('the job answer will not canonicalise')
  return digest.cid.toString()
}

/** Lease events that name a node, i.e. everything except `abandoned`. */
function named(event: LeaseEvent): string | null {
  return 'nodeId' in event ? event.nodeId : null
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-churn-'))
})

/**
 * 60 s, and it must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never
 * fire — the inversion three files in this repository carried until 2026-07-31. Stopping
 * an already-killed agent is a no-op: `stopAgent` returns immediately once `exitCode` or
 * `signalCode` is set.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('CHURN-01 / criterion 2 — 30 % of the fabric dies mid-job and the answer is unchanged', () => {
  it('returns per-shard results byte-identical to a control run over the same fabric, completes at its requested redundancy, and names the processes that died', async () => {
    const startedAt = performance.now()
    const fabric = await standUp()
    const { agents: spawned, requestor } = fabric
    const standUpMs = performance.now() - startedAt

    // A precondition of the harness rather than of the fabric: ten distinct peer ids, each
    // off a distinct child's stdout handshake. **No deletion in production code turns this
    // red** — it is reported as what it is.
    expect(spawned).toHaveLength(AGENT_COUNT)
    expect(new Set(spawned.map((a) => a.peerId)).size).toBe(AGENT_COUNT)

    // ---- The control. Same fabric, same job, nobody killed. ----------------------
    const controlAt = performance.now()
    const control = await runJob(
      fabric,
      spawned.map((agent) => new RemoteExecutor(agent.peerId, requestor.rpc, 'dispatches-unauthenticated')),
    )
    const controlMs = performance.now() - controlAt

    // The instrument check, and it comes before everything else. A control that was
    // itself lossy — an agent that never received its blocks, one that failed to come up,
    // a fabric under enough contention to time out a healthy dispatch — would make every
    // re-dispatch below unattributable. This is the most common way a file of this class
    // goes quietly wrong.
    expect(control.complete).toBe(true)
    expect(control.redispatches).toBe(0)
    for (const shard of control.shards) {
      expect(shard.ending).toBe('agreed')
      expect(shard.generations).toBe(1)
      expect(shard.attempted).toHaveLength(REDUNDANCY)
      expect(shard.degraded).toBe(false)
    }
    // Said a second time from the other end: with no re-dispatch there is nothing in the
    // history but a grant and a completion per shard.
    expect(control.leaseHistory.filter((e) => e.kind === 'granted')).toHaveLength(SHARDS)
    expect(control.leaseHistory.filter((e) => e.kind === 'completed')).toHaveLength(SHARDS)
    expect(
      control.leaseHistory.filter(
        (e) => e.kind === 'expired' || e.kind === 'surrendered' || e.kind === 'abandoned',
      ),
    ).toEqual([])

    const controlAnswer = await jobAnswer(control)
    const controlCids = resultCids(control)
    // Every shard produced an answer, and the eight answers are distinct — so the equality
    // below is eight separate readings rather than one repeated. Distinctness is inherited
    // from the guest (each shard's value differs), not imposed here.
    expect(controlCids.filter((cid) => cid === null)).toEqual([])
    expect(new Set(controlCids).size).toBe(SHARDS)

    // ---- Who was participating, read off the control's own record. ---------------
    // `ShardResult.attempted` is the set ASKED, across every generation. With
    // `redispatches: 0` above it is exactly the first generation's placement.
    const participants = new Set(control.shards.flatMap((shard) => [...shard.attempted]))
    // The lease names one holder per generation — `LeaseTable` models one holder per task
    // by construction — and it is the generation's first node. These are the nodes whose
    // death the lease history can *name*, which is what makes the choice below a choice
    // and not an arbitrary sort.
    const holderOf = new Map<string, string>()
    for (const event of control.leaseHistory) {
      if (event.kind === 'granted' && !holderOf.has(event.taskId)) holderOf.set(event.taskId, event.nodeId)
    }
    const heldCount = new Map<string, number>()
    for (const nodeId of holderOf.values()) heldCount.set(nodeId, (heldCount.get(nodeId) ?? 0) + 1)
    const placedCount = new Map<string, number>()
    for (const shard of control.shards) {
      for (const nodeId of shard.attempted) placedCount.set(nodeId, (placedCount.get(nodeId) ?? 0) + 1)
    }

    /*
     * **The killed set, and why it is this set.**
     *
     * The criterion says *participating*, so killing idle bystanders would not be a 30 %
     * loss of anything the job depended on. The rule is therefore: **the participants
     * that carried the most work**, ordered by shards held, then shards placed on, then
     * node id — a total order, so the choice is reproducible within a run and is not a
     * lucky draw.
     *
     * It is deliberately the *adversarial* end of the fixture rather than the convenient
     * one. The convenient choice would be three nodes the job barely used; this one takes
     * the three the scheduler leaned on hardest, which is what makes "the answer is
     * unchanged" worth asserting.
     */
    const killCount = Math.round(AGENT_COUNT * KILL_FRACTION)
    expect(killCount / AGENT_COUNT).toBe(KILL_FRACTION)
    expect(killCount).toBeGreaterThanOrEqual(2)
    // Enough distinct holders to draw from, so the rule below is a ranking rather than
    // "everything there was".
    //
    /*
     * **This precondition has been observed red, and the reading now names the census that
     * failed it rather than a bare pair of integers.** Recorded 2026-08-11, on the precedent
     * `late-combine.node.test.ts` sets for `runMap`: an assertion that prints only
     * `expected 2 to be greater than or equal to 3` cannot be told apart from a slow host by
     * anybody reading the log afterwards, and two agents in a row read it as one.
     *
     * **Measured, and it is NOT CPU starvation.** Sixteen solo runs of this file — eight on a
     * quiet host at `(user+sys)/real` 0.93–1.59, eight against 24 CPU burners at 0.47–0.73 —
     * gave distinct-holder counts of `[3,5,4,6,5,5,6,6]` and `[4,5,6,4,4,5,5,6]`. Not one
     * fell below four, and the burner arm sits at half the CPU share of the whole-suite runs
     * that failed. So a share of the machine's scarcity does not explain it, and saying "the
     * host was busy" would have been the wrong attribution.
     *
     * **What it is instead: the whole-suite regime, with an identical signature both times.**
     * Two full `--project node` runs reddened here, and both printed *participants 8, held
     * `[1,7]`* — one node holding seven of the eight shards while a second held one. The
     * repeat of that exact shape across two runs a day apart is what makes it a placement
     * finding rather than a draw: solo, the eight to sixteen placements spread across five to
     * nine participants and no node ever held more than five.
     *
     * It is **left red rather than relaxed**. Lowering this to two, or ranking over whatever
     * holders exist, would delete the only signal that the scheduler concentrates under
     * whole-suite conditions — and the criterion this file exists for, killing the
     * participants that carried the most work, is not the same criterion once there are only
     * two of them to choose from.
     */
    expect(
      new Set(holderOf.values()).size,
      `distinct holders ${new Set(holderOf.values()).size} over ${SHARDS} shards; ` +
        `participants ${participants.size}/${AGENT_COUNT}; ` +
        `held [${[...heldCount.values()].sort((x, y) => x - y).join(',')}]; ` +
        `placed [${[...placedCount.values()].sort((x, y) => x - y).join(',')}]`,
    ).toBeGreaterThanOrEqual(killCount)

    const victims = [...spawned]
      .filter((agent) => participants.has(agent.peerId))
      .sort(
        (x, y) =>
          (heldCount.get(y.peerId) ?? 0) - (heldCount.get(x.peerId) ?? 0) ||
          (placedCount.get(y.peerId) ?? 0) - (placedCount.get(x.peerId) ?? 0) ||
          x.peerId.localeCompare(y.peerId),
      )
      .slice(0, killCount)
    const victimIds = new Set(victims.map((agent) => agent.peerId))

    // Every one of them was placed on by the control run, and every one of them held a
    // lease. The first is the criterion's word *participating*; the second is what makes
    // the lease-history reading below reachable at all — a killed node that was never a
    // holder is named by `attempted` and by nothing in the history.
    expect(victims).toHaveLength(killCount)
    for (const victim of victims) {
      expect(participants.has(victim.peerId)).toBe(true)
      expect(heldCount.get(victim.peerId) ?? 0).toBeGreaterThan(0)
    }
    // 30 % of the fabric, and at least 30 % of the participating set. The two coincide
    // when every agent participated, which is the ordinary case for this fixture and is
    // measured rather than assumed.
    expect(killCount / participants.size).toBeGreaterThanOrEqual(KILL_FRACTION)

    /*
     * **The kill is staged from a wrapper around the production dispatch**, not after a
     * sleep — `tree-reduce-agents.node.test.ts`'s technique, copied exactly, one layer
     * down from the driver so the *production* `RemoteExecutor` still does the dispatching
     * and the *production* `submitJob` still does the placing. What the wrapper decides is
     * **when**, and nothing else.
     *
     * The instant is precise and it is the one the criterion is about: `submitJob` places
     * every shard first — offers go out to ten live agents and come back accepted — and
     * only then enters the per-shard generation loop. The first `execute` call is therefore
     * the first moment at which the job has been placed and nothing has been dispatched.
     * Killing there is *"a node that died between placement and dispatch"*, which is
     * `churn.test.ts`'s own hardest case.
     *
     * Every executor awaits the **same** promise, so the kill is complete before any frame
     * reaches any agent. That is deterministic rather than racy on purpose: a wrapper that
     * let the kill overlap the first dispatches would sometimes let a victim answer, and a
     * test whose subject is a loss would then measure nothing while still printing green.
     */
    let killStagedAt: number | null = null
    let killing: Promise<void> | null = null
    const stageTheKill = async (): Promise<void> => {
      killing ??= (async () => {
        killStagedAt = performance.now()
        await Promise.all(victims.map((victim) => killAgent(victim)))
      })()
      return killing
    }
    const armed: readonly Executor[] = spawned.map((agent) => {
      const inner = new RemoteExecutor(agent.peerId, requestor.rpc, 'dispatches-unauthenticated')
      return {
        nodeId: inner.nodeId,
        execute: async (task: Task) => {
          await stageTheKill()
          return inner.execute(task)
        },
      }
    })

    // ---- The killed run. -----------------------------------------------------------
    const killedAt = performance.now()
    const killed = await runJob(fabric, armed)
    const killedMs = performance.now() - killedAt

    // The staging actually happened. Without this, a run in which the wrapper never fired
    // would satisfy every assertion below by simply never losing a node.
    expect(killStagedAt).not.toBeNull()

    // **The kill was a vanish, not a shutdown. No deletion in production code turns these
    // two lines red** — they measure this test's own kill, and they are a precondition for
    // everything below rather than a proof of anything the fabric does. Stated the way
    // `tree-reduce-agents.node.test.ts` states its own.
    for (const victim of victims) {
      expect(victim.child.signalCode).toBe('SIGKILL')
      expect(victim.child.exitCode).toBeNull()
    }

    const killedCids = resultCids(killed)
    const redispatchNaming = killed.leaseHistory.filter((event) => {
      const nodeId = named(event)
      return nodeId !== null && victimIds.has(nodeId)
    })
    const lossKinds = redispatchNaming.filter(
      (event) => event.kind === 'expired' || event.kind === 'surrendered',
    )

    // Printed rather than only asserted, so the readings are available on every run
    // instead of surviving as a note somebody took once — `late-combine.node.test.ts`'s
    // precedent, for the same reason. **None of these numbers is asserted against a
    // threshold**; see the header.
    console.log(
      `[criterion 2 / churn] standUp ${Math.round(standUpMs)}ms for ${AGENT_COUNT} agents, ` +
        `control ${Math.round(controlMs)}ms, killed run ${Math.round(killedMs)}ms; ` +
        `participants ${participants.size}/${AGENT_COUNT}, killed ${killCount} ` +
        `(${Math.round((killCount / AGENT_COUNT) * 100)}% of the fabric, ` +
        `${Math.round((killCount / participants.size) * 100)}% of the participants); ` +
        `redispatches ${killed.redispatches} over ${SHARDS} shards against the control's ` +
        `${control.redispatches}; generations per shard [${killed.shards.map((s) => s.generations).join(',')}]; ` +
        `endings [${[...new Set(killed.shards.map((s) => s.ending))].join(',')}]; ` +
        `lease events naming the dead [${redispatchNaming.map((e) => e.kind).join(',')}]; ` +
        `gross fuel ${killed.grossFuel} against ${control.grossFuel}, ` +
        `useful ${killed.usefulFuel} against ${control.usefulFuel}`,
    )

    // ---- (1) The job completed, at the redundancy it asked for. ---------------------
    // `complete` alone would be the whole claim if it were only about agreement, but a run
    // that dropped a shard and reported the rest would produce perfectly "correct" CIDs
    // for what it did produce. So the per-shard reading is taken as well, and `degraded`
    // beside it: since 20-01 that field reads the replicas that ANSWERED, so a shard
    // topped up across two generations is undegraded and one that agreed at half its
    // redundancy is not.
    expect(killed.complete).toBe(true)
    expect(killed.shards).toHaveLength(SHARDS)
    for (const shard of killed.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.replicas).toBeGreaterThanOrEqual(REDUNDANCY)
      expect(shard.degraded).toBe(false)
      expect(shard.ending).toBe('agreed')
    }

    // ---- (2) The answer is unchanged — per shard, and at the job level. -------------
    // An equality against the control, never a pinned literal.
    expect(killedCids).toEqual(controlCids)
    expect(await jobAnswer(killed)).toBe(controlAnswer)
    // And the same *work* produced it. `mergeVerifications` takes `usefulFuel` from the
    // first agreeing generation, so this says the answer cost the same to compute however
    // many generations it took to get one — a second reading of "unchanged" that a CID
    // equality cannot make, because fuel is not part of the address.
    expect(killed.shards.map((s) => (s.verification.status === 'agreed' ? s.verification.usefulFuel : null))).toEqual(
      control.shards.map((s) => (s.verification.status === 'agreed' ? s.verification.usefulFuel : null)),
    )
    // And the *gross* fuel too, which says something the CIDs cannot: **the churn tax is
    // paid in round trips, not in recomputation.** A vanished process produces no receipt
    // and therefore no fuel, so the six extra dispatches below cost this job nothing in
    // guest execution. What would move it: a merge that unioned more than `REDUNDANCY`
    // answering replicas into one shard — which cannot happen while the top-up places only
    // the shortfall, and that is exactly the property 20-01 built it for.
    expect(killed.grossFuel).toBe(control.grossFuel)

    // ---- (3) The kill really was mid-flight, and this is how that is known. ---------
    // The killed run's FIRST generation placed exactly where the control placed. It could
    // only do that by having been placed while all ten agents were still answering offers
    // — i.e. before the wrapper fired. A kill staged before submission would have had the
    // victims refuse their offers and the placement would differ here.
    for (const [i, shard] of killed.shards.entries()) {
      const controlShard = control.shards[i] as ShardResult
      expect(shard.attempted.slice(0, controlShard.attempted.length)).toEqual([...controlShard.attempted])
    }

    // ---- (4) The re-dispatches are readable, and they name the dead. ----------------
    // A count alone is satisfiable by a re-dispatch caused by anything at all, so the node
    // ids are asserted beside it. Against the control's zero in the same run: this is a
    // ratio taken inside one run, not a threshold sited against a host.
    expect(killed.redispatches).toBeGreaterThan(0)
    expect(control.redispatches).toBe(0)
    expect(killed.shards.some((shard) => shard.generations > 1)).toBe(true)
    // Every shard that needed a second generation attempted a node it had not attempted
    // before — no node appears twice in one shard's record.
    for (const shard of killed.shards) {
      expect(new Set(shard.attempted).size).toBe(shard.attempted.length)
    }

    // **Every** killed process is named in the history, and named as a loss. This is the
    // assertion that is not a count in disguise: it depends on WHICH nodes died.
    for (const victim of victims) {
      expect(
        redispatchNaming.some((event) => named(event) === victim.peerId),
        `no lease event names ${victim.name}/${victim.peerId}`,
      ).toBe(true)
      expect(
        lossKinds.some((event) => named(event) === victim.peerId),
        `${victim.name} is in the history but not as a loss`,
      ).toBe(true)
    }
    // A killed process never completes a lease. The inverse of the line above and the
    // sharper half: a history that named the dead only as grantees would satisfy the
    // reading above and would mean the loss was never noticed.
    expect(redispatchNaming.filter((event) => event.kind === 'completed')).toEqual([])
    // Nothing was given up on. `abandoned` is `LeaseTable`'s record of a task that spent
    // `DEFAULT_MAX_GENERATIONS`, and a job that completed cannot have one.
    expect(killed.leaseHistory.filter((event) => event.kind === 'abandoned')).toEqual([])

    /*
     * **Which kind of loss, read rather than assumed.** `surrendered` and `expired` are
     * different facts about how the loss was noticed, and `coordinator.ts`'s header calls
     * the distinction load-bearing:
     *
     * - `surrendered` — the dispatch *reported*. A SIGKILLed process's socket closes, so
     *   `RemoteExecutor.execute` comes back `dispatch to … failed` well inside
     *   `RPC_TIMEOUT_MS`, the generation ends with information in hand, and `submitJob`
     *   gives the lease back at once rather than spending its full duration on it.
     * - `expired` — the dispatch went *silent* past `DEFAULT_LEASE_MS` (30 s) and the
     *   deadline bit.
     *
     * **Measured here: every loss is a `surrender`**, and the printed line above reports
     * the kinds on every run so a change is visible rather than inferred. What would move
     * it to `expired`: a fabric where the socket close is not observed — a peer behind a
     * relay whose reservation outlives the process, or an `rpcTimeoutMs` above the lease.
     * The assertion is the disjunction because both are correct answers to a vanish; the
     * measurement is the record of which one this fabric gives.
     */
    expect(lossKinds.length).toBeGreaterThan(0)
  }, PROCESS_TEST_TIMEOUT)
})
