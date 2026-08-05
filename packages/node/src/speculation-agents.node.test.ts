import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  DEFAULT_SPECULATION_FRACTION,
  DEFAULT_STRAGGLER_FACTOR,
  MIN_SAMPLES,
  canonicalCid,
  median,
  signName,
  speculativeCandidates,
  submitJob,
  toHex,
} from '@o2/core'
import type {
  CanonicalValue,
  Executor,
  JobResult,
  NameRecord,
  NodeDescriptor,
  ShardResult,
  SubmitOptions,
  Task,
} from '@o2/core'
import { RemoteExecutor, rpcAdmission } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_ID, OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'
import { stripComments } from './strip-comments.ts'

/**
 * **Phase 20 criterion 3** — *a straggler task is duplicated speculatively during a live
 * run, the first correct result wins, and the job's reported cost accounting includes the
 * speculation multiplier.*
 *
 * ## The entry point takes the substitution this project has now recorded five times
 *
 * **`bin/agent.ts` submits no job.** It is a serving node whose only stdout is a handshake
 * JSON. So *"during a live run"* across the fabric is satisfiable only as **"a job run
 * *across* `bin/agent.ts` processes"**: an in-process requestor `FabricNode` submitting to
 * spawned agents — the shape `discovery-agents.node.test.ts`, `churn-agents.node.test.ts`,
 * `tree-reduce-agents.node.test.ts` and `owner-domain-agents.node.test.ts` all use. The
 * substitution is stated **here** and not only in a planning document, because Phase 19
 * learned that a substitution living in a plan reaches nobody reading the test.
 *
 * ## There is no delay constant anywhere in this file, and that is the point
 *
 * The plan for this file said to *"tune the straggler's slowness against the measured
 * duration of a healthy shard in the same run — not against a constant"*. What is done
 * here is stronger than tuning: **the straggler's slowness has no duration in it at all.**
 * Two agent processes are SIGSTOPped, so their dispatches are slow by *not running*, and
 * they are SIGCONTed by an **event** — the instant the speculative duplicate answers —
 * rather than after an interval. Nothing in the arrangement encodes this host's speed, so
 * there is no number here for a loaded machine to falsify.
 *
 * Every quantitative reading below is one of three shapes, and never an absolute:
 *
 * - an **equality against the off arm of the same fixture in the same run** (the answers,
 *   the placement, the dispatch counts);
 * - a **ratio inside one run** (the speculation multiplier on against off, the frozen
 *   dispatches against `DEFAULT_STRAGGLER_FACTOR` × the median healthy dispatch measured
 *   by this file's own instrument in the same arm);
 * - a **count of events** (`speculationSpent`, `redispatches`, `copies.length`).
 *
 * Durations are printed on every run and asserted nowhere.
 *
 * ## The two arms, and why they are one fixture
 *
 * `submitJob` gained the off arm in 20-07 precisely so this reading could be taken:
 * `speculation: 'duplicates-no-stragglers'`. **A multiplier of `1` alone says nothing** —
 * it is what a job with no stragglers reports and what a job with speculation disabled
 * reports, which is the same class of defect as a column that cannot tell "nothing was
 * slow enough" from "the mechanism is off". So both arms run over the **same spawned
 * fabric, the same job spec and the same node descriptors**, and the pair is asserted:
 * off reports `1` with `speculationSpent: 0`, on reports `(shards + spent) / shards` with
 * a spend this file's own wrapper counted independently, and every extra dispatch is
 * visible in `attempted`.
 *
 * ## How a straggler is told from a refusal
 *
 * A node that *refuses* produces a re-dispatch, which is criterion 2 and is measured by
 * `churn-agents.node.test.ts`. This file would be re-measuring that criterion and calling
 * it this one if the frozen agents were merely being rejected, so the distinction is
 * asserted rather than assumed: `job.redispatches` is **0** on both arms, the tracked
 * shard ran in **one** generation, the lease history contains no `surrendered`, `expired`
 * or `abandoned` event, and no placement rejection was collected. A SIGSTOPped process
 * cannot answer at all — it is silent, not refusing — which is exactly the condition
 * speculation exists for.
 *
 * ## CHURN-06 in both directions, with the budget confound removed
 *
 * The job carries **two** sovereign shards frozen in the same instant by the same signal,
 * differing in exactly one thing — how many nodes their owner has. That is 20-07's kernel
 * pair on real processes:
 *
 * - `PAIRED_OWNER` has two nodes. Its shard is duplicated, and the duplicate lands on
 *   **that owner's other node** — asserted by node id. A widened eligibility gate would put
 *   it on a worker, and a reason string would stay perfectly plausible while it did.
 * - `SOLO_OWNER` has one. Its shard is **not** duplicated and no second node is ever
 *   dispatched to, which is the correct outcome and the only one available: waiting is the
 *   alternative to breaching the guarantee the whole project rests on.
 *
 * A shard reads `speculated: false` for three different reasons — nothing was slow, the
 * budget was gone, or there was nowhere legal to duplicate to — and `ShardResult` carries
 * no field distinguishing the third. 20-07 recorded that gap. So this fixture removes the
 * other two, by measurement and by construction:
 *
 * - **Nothing was slow** is excluded because `SOLO_OWNER`'s node is frozen in the same
 *   instant, by the same signal, as the others, and its measured dispatch duration is
 *   asserted above `DEFAULT_STRAGGLER_FACTOR` × the median healthy dispatch of the same arm.
 * - **The budget was gone** is excluded because the allowance is {@link ALLOWANCE} — see
 *   {@link SPECULATION_FRACTION} for why that dial is the one production default this
 *   fixture overrides — and the spend is asserted strictly below it, so the ledger
 *   provably still had room at every tick.
 *
 * What is left is the third reason, and it is read off `attempted`: the shard names exactly
 * its owner's node and nothing else. *The absence of an error is not a reading*; a node id
 * in that list is.
 *
 * **Stated precisely, so nobody reads more into it than is there:** `dispatchUnderLease`
 * evaluates `speculativeCandidates` *before* `stragglers`, so a sovereign shard with no
 * spare owner node stops watching before it is ever judged slow. CHURN-06 therefore holds
 * *structurally* — there is no branch that could dispatch elsewhere — and this file's
 * duration reading says the fixture really did present the hard case, not that the code
 * took a decision it in fact never had to take.
 *
 * ## What this file cannot redden on, stated so nobody upgrades it later
 *
 * - **The budget arithmetic and the post-settle comparison.** `SpeculationLedger` and
 *   `compareOutstanding` are held by `packages/core/src/job/submit.test.ts`'s ten kernel
 *   cases (20-07) and by `packages/core/src/speculation.test.ts`. This file runs with an
 *   allowance it cannot exhaust, deliberately — see {@link SPECULATION_FRACTION}.
 * - **The re-dispatch loop.** `redispatches` is asserted to be **zero** here, which is a
 *   precondition rather than a reading of the mechanism. 20-04's
 *   `churn-agents.node.test.ts` and 20-01's kernel cases carry CHURN-01.
 * - **Lease renewal.** Nothing here holds a lease to `RENEW_AT` (two-thirds of
 *   `DEFAULT_LEASE_MS`, i.e. 20 s) — every dispatch is bounded well below it by
 *   {@link RPC_TIMEOUT_MS}. 20-01's kernel pair carries CHURN-04.
 * - **A disagreement between copies.** The guest is deterministic and both copies read
 *   the same content-addressed input, so `disagreed` is unreachable here without a
 *   planted mutation. It was reached by one — see `20-09-SUMMARY.md`.
 *
 * ## Why the guest is `MODULE_WRITES_PARTITION`, and the finding that decided it
 *
 * `MODULE_ECHOES_INPUT` was tried first, on `churn-agents.node.test.ts`'s reasoning that an
 * identity guest makes each shard's output a function of that shard's own bytes. **It is
 * unusable in any job containing a sovereign shard, and the reason is the egress guard
 * working correctly.** Measured 2026-08-04: the owner's own process refused its own result
 * with `egress refused: bafyreibqswyxuij…`, because an identity guest makes the output
 * *byte-identical to the sovereign input*, `takeSovereignHold` had registered exactly those
 * bytes for the duration of the task, and sending the result would therefore have been
 * sending the owner's raw row. The shard ended `no-untried-node` /
 * `every executor failed`. That is DATA-10 refusing a genuine leak and is recorded here
 * rather than worked around, because the obvious workaround — dropping the guard for the
 * owner's own answer — would be the leak.
 *
 * `MODULE_WRITES_PARTITION` emits the 4-byte partition index, which is not the input, so
 * the sovereign shard's answer leaves its owner as an ordinary result. Each shard still has
 * a **distinct** output, because each has a distinct partition index — asserted below, not
 * assumed — so the twenty-one equalities against the off arm are twenty-one readings.
 *
 * **The plant this choice still supports, and the one it does not.** Changing the
 * duplicate's *input* would not change its output, so that plant is unavailable; changing
 * the duplicate's *partition index* changes it directly, and that is the mutation
 * `20-09-SUMMARY.md` records as the disagreement plant. **The honest limit**: the guest
 * ignores its input, so this file cannot tell a node that computed from the shard's data
 * from one that computed from an integer the requestor already held. It does not need to —
 * what it measures is which node computed and when, not what the guest read.
 *
 * ## Budget
 *
 * Eight processes: seven spawned agents plus one in-process requestor. The timeouts are
 * `churn-agents.node.test.ts`'s and `discovery-agents.node.test.ts`'s, **reused rather
 * than newly chosen**. Fixture seed **115**, distinct from every other in the repository —
 * 113 is `late-combine.node.test.ts`, 114 is `churn-agents.node.test.ts`, and 111/112/113
 * are `capability-fixture.ts`'s.
 *
 * **One host, eight OS processes.** Not a cross-machine result and must never be called
 * one.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, copied from `discovery-agents.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000

/** Per-`it` budget, copied from `churn-agents.node.test.ts`. A ceiling, not an estimate. */
const PROCESS_TEST_TIMEOUT = 300_000

/**
 * The requestor's RPC budget — `churn-agents.node.test.ts`'s value, kept for its reason.
 *
 * Short enough that a genuinely dead node gives up on *this* budget rather than on
 * `DEFAULT_RPC_TIMEOUT_MS` (30 000), and well below `RENEW_AT × DEFAULT_LEASE_MS` (20 s),
 * which is why renewal is unreachable here.
 *
 * It is also the bound that makes the **plant** for this file terminate: with speculation
 * disabled in the on arm nothing resumes the frozen agents, and their dispatches fail on
 * this budget instead of hanging the suite.
 */
const RPC_TIMEOUT_MS = 10_000

/**
 * Seed 115 — distinct from every other fixture key in the repository.
 *
 * `bin/agent.ts` pins the demo's kernel anchor by default, so an unsigned job would have
 * every dispatch refused before a single shard existed to be slow. DET-03 is not this
 * file's subject; this record is what lets the subject be reached.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(115)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'speculation-agents-fixture',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/**
 * The owner whose data has **two** nodes, and the owner whose data has **one**.
 *
 * The pair is 20-07's kernel case reproduced across processes: a sovereign shard whose
 * owner has a spare node may be duplicated onto *that owner's other node*, and a sovereign
 * shard whose owner has none may not be duplicated at all. Both arms in one job, so the
 * difference between them cannot be a difference between two runs.
 *
 * `PAIRED_OWNER` is `capability-fixture.ts`'s {@link OWNER_ID} because its chains default
 * to it; `SOLO_OWNER` is a second id rooted at the **same** fixture key, which is what
 * `chainSupplierFor` mints for whatever owner a task names.
 */
const PAIRED_OWNER = OWNER_ID
const SOLO_OWNER = 'carol'

/**
 * Four public workers, plus two nodes for `PAIRED_OWNER` and one for `SOLO_OWNER`.
 *
 * Seven agents is one more than `churn-agents.node.test.ts`'s ten minus the requestor's
 * share, and well inside what this repository has stood up. Four workers is the smallest
 * count that leaves, for the one frozen worker, both a shard of its own and three untried
 * peers for its duplicate to land on.
 */
const WORKER_COUNT = 4
const AGENT_COUNT = WORKER_COUNT + 3

/**
 * Twenty public shards plus one per sovereign owner — twenty-two.
 *
 * Twenty is comfortably above `MIN_SAMPLES` ({@link MIN_SAMPLES}), so a median exists long
 * before the frozen dispatches are judged against it, and it is enough that the public
 * shards spread over more than one worker under `sampleCandidates`' `d = 2`.
 */
const PUBLIC_SHARDS = 20
const SHARDS = PUBLIC_SHARDS + 2

/**
 * The speculation budget, **as a fraction of one**, and this is the one production default
 * this fixture deliberately overrides.
 *
 * `DEFAULT_SPECULATION_FRACTION` is 0.1, so a job of this size ships an allowance of
 * `floor(22 × 0.1)` = 2. That is enough to duplicate the two shards this fixture *means*
 * to duplicate, and **not** enough to survive a third straggler arriving for a reason
 * nobody arranged — a worker paying a cold WASM compile while the median is already warm,
 * on a host somebody else is building on. With the budget exhausted, a shard reading
 * `speculated: false` becomes ambiguous between "there was nowhere legal to go" (CHURN-06,
 * which is what this file measures) and "there was no budget left", and 20-07 recorded
 * that `ShardResult` carries no field distinguishing them.
 *
 * A fraction of `1` removes the ambiguity by construction: the allowance is the shard count,
 * so `ledger.remaining` is provably above zero at every tick of every shard, and the
 * assertion below reads it rather than assuming it. **What it gives up** is stated rather
 * than hidden: this file no longer exercises budget exhaustion, which is
 * `packages/core/src/job/submit.test.ts`'s *"spends no more than the job-wide budget"* case
 * and `speculation.test.ts`'s ledger cases. It is arithmetic over a counter, and arithmetic
 * over a counter is the last thing that needs seven OS processes to check.
 */
const SPECULATION_FRACTION = 1

/** The job-wide duplicate budget this fixture runs with, derived rather than typed. */
const ALLOWANCE = Math.floor(SHARDS * SPECULATION_FRACTION)

/** What the shipped default would have allowed, for the comment above to be checkable. */
const DEFAULT_ALLOWANCE = Math.floor(SHARDS * DEFAULT_SPECULATION_FRACTION)

/**
 * Redundancy **1**, and this is a deliberate narrowing rather than a convenience.
 *
 * Speculation is *not* redundancy — `speculation.ts` says so at its own head — and at
 * redundancy 1 there is exactly one dispatch per shard per generation, so every extra
 * entry in `attempted` is a duplicate and nothing else. At redundancy 2 the same list
 * would mix replicas with copies and the count that carries this criterion would have to
 * be inferred instead of read. `churn-agents.node.test.ts` measures churn at redundancy 2
 * for the opposite and equally deliberate reason.
 */
const REDUNDANCY = 1

/**
 * What this requestor tells the job about quorum shortfall.
 *
 * Never read: no descriptor here carries a certificate and the redundancy is 1, so
 * `submitJob` composes no quorum. Stated because `JobSpec` requires it to be stated.
 */
const SHORTFALL: 'runs-at-available-redundancy' = 'runs-at-available-redundancy'

/**
 * How much room the comparison window gets, as a multiple of a duration measured in the
 * same run.
 *
 * The window bounds the **comparison** and never the result — the winner has already
 * returned by the time it opens — so a generous one costs nothing when the losing copy
 * answers and costs one tick when it does not. It is expressed as a factor over the
 * slowest healthy dispatch **of this run's own off arm** rather than as a millisecond
 * count, for the reason the whole file is built on: a millisecond here would encode this
 * host. Twenty is a stated judgement, not a discovered boundary.
 */
const COMPARE_GRACE_FACTOR = 20

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
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
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

/**
 * SIGTERM, then wait for the process to actually be gone.
 *
 * **The SIGCONT first is load-bearing and is `late-combine.node.test.ts`'s line, copied**:
 * a SIGSTOPped process cannot run `bin/agent.ts`'s TERM handler, so a teardown that only
 * signalled TERM would wait out the full 10 s SIGKILL fallback on every case here. It is a
 * no-op on a process that was never paused.
 */
async function stopAgent(agent: Agent): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  agent.child.kill('SIGCONT')
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

/** `ps` state for a pid, or `''` once it is gone. `T` is the stopped state. */
function processState(pid: number): string {
  try {
    return execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function waitFor(predicate: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = performance.now() + budgetMs
  while (performance.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

/**
 * SIGSTOP, and **wait until the kernel says the process is stopped** —
 * `late-combine.node.test.ts`'s helper, copied.
 *
 * Awaited rather than fired: signal delivery is asynchronous, so a `kill('SIGSTOP')` that
 * merely returned would leave a race between the freeze and the dispatch that follows it,
 * and a run that lost that race would report a job with no straggler in it — a failure for
 * a reason that has nothing to do with what is measured. `SIGSTOP` cannot be caught or
 * ignored, so the only thing to wait for is the state transition itself.
 */
async function pauseAgent(agent: Agent): Promise<void> {
  const pid = agent.child.pid
  if (pid === undefined) throw new Error('the agent process has no pid')
  agent.child.kill('SIGSTOP')
  const stopped = await waitFor(() => processState(pid).startsWith('T'), 10_000)
  if (!stopped) throw new Error(`agent ${String(pid)} did not stop: state ${processState(pid)}`)
}

/** SIGCONT, and wait until the kernel says the process is running again. */
async function resumeAgent(agent: Agent): Promise<void> {
  const pid = agent.child.pid
  if (pid === undefined) throw new Error('the agent process has no pid')
  agent.child.kill('SIGCONT')
  const running = await waitFor(() => {
    const state = processState(pid)
    return state !== '' && !state.startsWith('T')
  }, 10_000)
  if (!running) throw new Error(`agent ${String(pid)} did not resume: state ${processState(pid)}`)
}

interface Fabric {
  /** The public workers. Most public shards land on one of these. */
  readonly workers: readonly Agent[]
  /** `PAIRED_OWNER`'s two nodes. The first holds its shard; the second is where a duplicate may go. */
  readonly paired: readonly [Agent, Agent]
  /** `SOLO_OWNER`'s only node. */
  readonly solo: Agent
  readonly requestor: FabricNode
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
  readonly nodes: readonly NodeDescriptor[]
  readonly shardValues: readonly CanonicalValue[]
}

/** The value shard `i` carries. Distinct per shard, so a mixed-up shard is visible. */
function shardValue(i: number): CanonicalValue {
  return { speculation: 'speculation-agents', partition: i }
}

/**
 * The descriptors `submitJob` places over, and the three properties they are arranged for.
 *
 * **1. Which of `PAIRED_OWNER`'s two nodes holds its shard is decided, not drawn.** Both are
 * eligible, `sampleCandidates` returns both at `d = 2`, and `placeWithOffers` then takes the
 * least loaded — so `paired[0]` at `load: 0` holds it and `paired[1]` at `load: 0.5` is the
 * spare. That makes the frozen node and the duplicate's target both known before the run,
 * which is what lets the assertion below name a node id rather than a set.
 *
 * **2. The owner nodes are described as loaded and every worker as idle**, so a sample
 * containing an owner node and any worker resolves to the worker. This is
 * `sovereignty-placement.node.test.ts`'s arrangement reused for the opposite purpose: there
 * it forces a relocation that must not happen, here it keeps public work off the frozen
 * processes. **It is a preference and not a filter** — a shard whose rendezvous top-2 are
 * *both* owner nodes still lands on one, which the load ordering cannot prevent and this
 * file does not pretend it does. Such a shard becomes an extra straggler, gets a duplicate
 * of its own out of a budget that cannot run out, and is counted rather than asserted.
 *
 * **3. The workers come FIRST in the array, and that is not cosmetic.** A speculative
 * duplicate goes to `speculativeCandidates(...)[0]`, which preserves the pool's own order,
 * so a *public* shard's duplicate lands on the first worker it has not already attempted.
 * Owner nodes last means a public duplicate never targets one of them by array position.
 */
function descriptorsFor(fabric: {
  workers: readonly Agent[]
  paired: readonly [Agent, Agent]
  solo: Agent
}): readonly NodeDescriptor[] {
  return [
    ...fabric.workers.map(
      (agent): NodeDescriptor => ({
        nodeId: agent.peerId,
        ownerId: 'public',
        canExecuteSovereign: true,
        load: 0,
        certificate: 'carries-no-certificate',
      }),
    ),
    {
      nodeId: fabric.paired[0].peerId,
      ownerId: PAIRED_OWNER,
      canExecuteSovereign: true,
      load: 1,
      certificate: 'carries-no-certificate',
    },
    {
      nodeId: fabric.paired[1].peerId,
      ownerId: PAIRED_OWNER,
      canExecuteSovereign: true,
      // Above its sibling's, so the sibling holds the shard and this one is the spare.
      load: 1.5,
      certificate: 'carries-no-certificate',
    },
    {
      nodeId: fabric.solo.peerId,
      ownerId: SOLO_OWNER,
      canExecuteSovereign: true,
      load: 1,
      certificate: 'carries-no-certificate',
    },
  ]
}

/**
 * Spawn the fabric, pre-seed every agent, start the requestor, dial outward.
 *
 * **The seeding happens before the spawn, and the order is load-bearing.** Each agent's
 * `--dir` is written through `FsBlockstore` *before* the process exists; seeding
 * afterwards races the agent's own open of the same directory, and that race has cost this
 * repository a debugging session before (`discovery-agents.node.test.ts` records it).
 *
 * Seeding is more than an optimisation here. It takes the requestor off the critical path
 * of a dispatch, so a **frozen** node's silence is the only thing a straggler can be
 * attributed to — a node that had to fetch its blocks first would be slow for a second
 * reason this file could not separate out.
 *
 * Every agent is seeded with every input, including the two sovereign ones. That is a
 * fixture convenience and **not** a claim: `submitJob` puts every shard input into the
 * requestor's own store anyway, so a foreign agent could fetch a sovereign row over the
 * wire regardless — the standing limitation `submit-with-egress.ts` names for bare
 * `submitJob` and `sovereignty-placement.node.test.ts` records. What this file measures is
 * *placement*, and `attempted` is where it reads it: a node that was never dispatched to
 * never ran the task, whatever its blockstore holds.
 *
 * The requestor dials **outward**, one connection per agent:
 * `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host, so a fixture this size must not
 * invert the direction — `tree-reduce-agents.node.test.ts`'s fact 2, inherited.
 */
async function standUp(): Promise<Fabric> {
  const shardValues = Array.from({ length: SHARDS }, (_, i) => shardValue(i))
  const encoded = await Promise.all(shardValues.map((value) => canonicalCid(value)))
  for (const block of encoded) {
    if (!block.ok) throw new Error('a fixture shard value will not canonicalise')
  }

  const workerNames = Array.from({ length: WORKER_COUNT }, (_, i) => `w${i}`)
  const ownerNames = ['p0', 'p1', 's0']
  for (const name of [...workerNames, ...ownerNames]) {
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(MODULE_WRITES_PARTITION)
    for (const block of encoded) if (block.ok) await store.put(block.bytes)
  }

  const spawnedAll = await Promise.all([
    ...workerNames.map((name) => spawnAgent(name)),
    // The same `--owner-id`/`--owner-key`/`--can-execute-sovereign` flags a real
    // deployment would pass, so a correctly-placed sovereign dispatch can complete.
    // Without `--owner-key` the process refuses the chain this submitter mints, before
    // placement's outcome could be read at all (AUTH-03). One key roots both owners'
    // chains — `chainSupplierFor` mints for whatever owner the task names — while the
    // pinned `--owner-id` is what `guardSovereignty` matches the task against.
    spawnAgent('p0', ['--owner-id', PAIRED_OWNER, '--owner-key', OWNER_KEY, '--can-execute-sovereign']),
    spawnAgent('p1', ['--owner-id', PAIRED_OWNER, '--owner-key', OWNER_KEY, '--can-execute-sovereign']),
    spawnAgent('s0', ['--owner-id', SOLO_OWNER, '--owner-key', OWNER_KEY, '--can-execute-sovereign']),
  ])
  const workers = spawnedAll.slice(0, WORKER_COUNT)
  const p0 = spawnedAll[WORKER_COUNT]
  const p1 = spawnedAll[WORKER_COUNT + 1]
  const solo = spawnedAll[WORKER_COUNT + 2]
  if (p0 === undefined || p1 === undefined || solo === undefined || workers.length !== WORKER_COUNT) {
    throw new Error('the fabric did not stand up')
  }
  const paired: readonly [Agent, Agent] = [p0, p1]

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

  const dialed = await Promise.all(
    spawnedAll.map((agent) => requestor.dial(agent.multiaddrs[0] as string)),
  )
  expect([...dialed].sort()).toEqual(spawnedAll.map((a) => a.peerId).sort())

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
  for (const block of encoded) if (block.ok) await requestor.store.put(block.bytes)

  return {
    workers,
    paired,
    solo,
    requestor,
    moduleCid,
    moduleRecord: recordFor(moduleCid),
    // Built **once** and reused by both arms. Two calls would produce equal arrays, but
    // placement is a pure function of this input and reusing it removes the question
    // entirely: the two arms are handed the identical node set.
    nodes: descriptorsFor({ workers, paired, solo }),
    shardValues,
  }
}

/** Where the sovereign shards sit in the shard list — the last two, paired then solo. */
const PAIRED_INDEX = PUBLIC_SHARDS
const SOLO_INDEX = PUBLIC_SHARDS + 1

/**
 * Submit the job. The **only** things that differ between the arms are `executors` and
 * the `speculation` dial.
 *
 * Everything else — module, record, shard values, node descriptors, redundancy, the
 * shortfall dial and the admission control — is the same object graph, so a difference in
 * the answers is a difference the fabric made.
 */
async function runJob(
  fabric: Fabric,
  executors: readonly Executor[],
  speculation: SubmitOptions['speculation'],
): Promise<JobResult> {
  const result = await submitJob(
    {
      moduleCid: fabric.moduleCid,
      moduleRecord: fabric.moduleRecord,
      shards: fabric.shardValues.map((value, i) =>
        i < PUBLIC_SHARDS
          ? { value, label: 'public' as const }
          : {
              value,
              label: 'sovereign' as const,
              ownerId: i === PAIRED_INDEX ? PAIRED_OWNER : SOLO_OWNER,
            },
      ),
      executors,
      nodes: fabric.nodes,
      redundancy: REDUNDANCY,
      onQuorumShortfall: SHORTFALL,
      // The production admission path, as `churn-agents.node.test.ts` and
      // `discovery-agents.node.test.ts` use it. It is also what makes this fixture
      // possible at all: without it `submitJob` takes `planPlacement`, which sorts the
      // whole eligible set by load and hands the **same** first node every public shard —
      // one node holding twenty shards, and no fabric to be a straggler relative to.
      admit: rpcAdmission(fabric.requestor.rpc),
    },
    fabric.requestor.store,
    speculation === undefined ? undefined : { speculation },
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
 * Every shard's ending and, where it did not agree, the fabric's own words.
 *
 * Attached to the assertion messages rather than printed, so a failure names the shard and
 * the reason in the same line that failed. A `complete: false` with no reason beside it
 * sends a reader to add a `console.log` and run a seven-process fixture again.
 */
function describeShards(job: JobResult): string {
  return job.shards
    .map((shard) => {
      const v = shard.verification
      const detail =
        v.status === 'agreed'
          ? `agreed x${v.replicas}`
          : v.status === 'disagreed'
            ? `disagreed`
            : `insufficient: ${v.reason}${v.failures.map((f) => ` | ${f.nodeId}: ${f.reason}`).join('')}`
      return `#${shard.partitionIndex} ${shard.ending} [${shard.attempted.join(' ')}] ${detail}`
    })
    .join('\n')
}

/** One `execute` call this file's wrapper saw, and what became of it. */
interface Dispatch {
  readonly nodeId: string
  readonly partitionIndex: number
  readonly startedAt: number
  /** Null while the call is still outstanding. */
  settledAt: number | null
  /**
   * True when this call arrived for a shard that already had an **unsettled** call on a
   * different node.
   *
   * That is precisely a speculative duplicate and not a re-dispatch: a re-dispatch is
   * placed only after the previous generation ended, so its predecessor has settled. The
   * distinction is read from the wrapper's own record rather than from any field the
   * fabric reports, which is what makes it an independent instrument.
   */
  readonly duplicate: boolean
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-spec-'))
})

/**
 * 60 s, and it must exceed `stopAgent`'s inner 10 s or the SIGKILL fallback could never
 * fire — the inversion three files in this repository carried until 2026-07-31.
 * `stopAgent` sends SIGCONT first, so a case that failed mid-freeze still tears down.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('CHURN-02 / criterion 3 — a straggler is duplicated mid-run across real bin/agent.ts processes', () => {
  it('duplicates a frozen node’s shard onto a node the placement did not choose, takes the first answer, accounts for the loser, keeps a sovereign duplicate inside its owner, and starts none where the owner has no spare', async () => {
    const startedAt = performance.now()
    const fabric = await standUp()
    const standUpMs = performance.now() - startedAt
    const { workers, paired, solo, requestor } = fabric
    const everyAgent = [...workers, ...paired, solo]

    // Preconditions of the harness rather than of the fabric. **No deletion in production
    // code turns these lines red** — they measure this file's own spawn and arithmetic.
    expect(workers).toHaveLength(WORKER_COUNT)
    expect(new Set(everyAgent.map((a) => a.peerId)).size).toBe(AGENT_COUNT)
    expect(PUBLIC_SHARDS).toBeGreaterThan(MIN_SAMPLES)
    // The allowance this fixture runs with cannot be exhausted, and the shipped default's
    // could have been — which is the whole argument in `SPECULATION_FRACTION`, checked
    // rather than only asserted in prose.
    expect(ALLOWANCE).toBe(SHARDS)
    expect(DEFAULT_ALLOWANCE).toBeLessThan(SHARDS)

    const plain = (): readonly Executor[] =>
      everyAgent.map(
        (agent) => new RemoteExecutor(agent.peerId, requestor.rpc, chainSupplierFor(agent.peerId)),
      )

    // ---- The off arm. Same fabric, same job, nobody frozen, duplication disabled. ----
    //
    // First, because it is three things at once: the correctness reference every answer
    // below is compared against, the placement this fixture chooses its victim from, and
    // the instrument check — a fabric that was already lossy would make everything after
    // it unattributable.
    const offAt = performance.now()
    const off = await runJob(fabric, plain(), 'duplicates-no-stragglers')
    const offMs = performance.now() - offAt

    expect(off.complete, `the off arm did not complete:\n${describeShards(off)}`).toBe(true)
    expect(off.redispatches).toBe(0)
    // The identity, and **both halves of it**: a multiplier of 1 is also what an idle job
    // reports, so the spend beside it is what says duplication was off rather than unused.
    expect(off.speculationMultiplier).toBe(1)
    expect(off.speculationSpent).toBe(0)
    for (const shard of off.shards) {
      expect(shard.ending).toBe('agreed')
      expect(shard.generations).toBe(1)
      expect(shard.attempted).toHaveLength(REDUNDANCY)
      expect(shard.speculated).toBe(false)
      expect(shard.disagreed).toBe(false)
      expect(shard.copies).toEqual([])
      expect(shard.degraded).toBe(false)
    }
    expect(
      off.leaseHistory.filter(
        (e) => e.kind === 'expired' || e.kind === 'surrendered' || e.kind === 'abandoned',
      ),
    ).toEqual([])

    const offCids = resultCids(off)
    expect(offCids.filter((cid) => cid === null)).toEqual([])
    // Twenty-two **distinct** answers, so the equality asserted after the on arm is
    // twenty-two separate readings rather than one repeated. Distinctness comes from the
    // guest emitting each shard's own partition index, and is measured here rather than
    // assumed — see the note on the guest in the header.
    expect(new Set(offCids).size).toBe(SHARDS)

    // ---- Who held what, read off the off arm's own record. -------------------------
    //
    // The two sovereign shards went to their owners and nowhere else with speculation off.
    // The on arm repeats this under pressure; here it is the control for it, and it is also
    // what says `descriptorsFor`'s load arrangement put the paired shard on `paired[0]`
    // rather than on its spare.
    expect((off.shards[PAIRED_INDEX] as ShardResult).attempted).toEqual([paired[0].peerId])
    expect((off.shards[SOLO_INDEX] as ShardResult).attempted).toEqual([solo.peerId])

    const heldBy = new Map<string, number[]>()
    for (const shard of off.shards.slice(0, PUBLIC_SHARDS)) {
      const nodeId = shard.attempted[0] as string
      heldBy.set(nodeId, [...(heldBy.get(nodeId) ?? []), shard.partitionIndex])
    }
    // More than one node took public work, so a public duplicate has somewhere to go that
    // is neither the frozen node nor a node its shard already ran on.
    expect(heldBy.size).toBeGreaterThan(1)

    /*
     * **The frozen worker: the one that took the most public shards.**
     *
     * The most rather than the fewest, and the choice is adversarial on purpose — it is the
     * node the scheduler leaned on hardest, which is `churn-agents.node.test.ts`'s rule for
     * choosing its victims. Ties break on node id, so the choice is a total order and not a
     * lucky draw. Freezing it guarantees at least one **public** straggler, which is the
     * general case of the mechanism: a public shard's duplicate may go to any eligible node,
     * where a sovereign one may not.
     */
    const workerHoldings = [...heldBy.entries()]
      .filter(([nodeId]) => workers.some((w) => w.peerId === nodeId))
      .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    const chosen = workerHoldings[0]
    expect(
      chosen,
      `no worker took any public shard in the off arm:\n${describeShards(off)}`,
    ).not.toBeUndefined()
    if (chosen === undefined) return
    const [victimId, victimShards] = chosen
    const trackedIndex = victimShards[0] as number
    const victim = workers.find((agent) => agent.peerId === victimId) as Agent

    /*
     * **Where each duplicate must land, derived by calling the production function.**
     *
     * `speculativeCandidates` is what `dispatchUnderLease` calls, handed the shard's own
     * placement request, the gate's pool — which at redundancy 1 over uncertificated
     * descriptors is the whole candidate set — and the nodes already attempted. Its first
     * entry is the target. Re-implementing that rule here would be a second source of truth
     * about placement, which is the shape this repository forbids; calling it means a change
     * to the rule shows up as a failed assertion rather than as a passing test measuring the
     * old rule.
     */
    const publicDuplicateTarget = speculativeCandidates(
      { shardId: String(trackedIndex), label: 'public', redundancy: 1 },
      fabric.nodes,
      [victimId],
    )[0] as NodeDescriptor
    expect(publicDuplicateTarget.nodeId).not.toBe(victimId)
    // A worker, so the duplicate lands somewhere that is running. Owner nodes are last in
    // the descriptor array precisely so this holds — see `descriptorsFor`.
    expect(workers.map((w) => w.peerId)).toContain(publicDuplicateTarget.nodeId)
    // And the sovereign pair, through the same gate: the paired owner's spare, and nothing
    // at all for the solo owner.
    expect(
      speculativeCandidates(
        { shardId: String(PAIRED_INDEX), label: 'sovereign', ownerId: PAIRED_OWNER, redundancy: 1 },
        fabric.nodes,
        [paired[0].peerId],
      ).map((n) => n.nodeId),
    ).toEqual([paired[1].peerId])
    expect(
      speculativeCandidates(
        { shardId: String(SOLO_INDEX), label: 'sovereign', ownerId: SOLO_OWNER, redundancy: 1 },
        fabric.nodes,
        [solo.peerId],
      ),
    ).toEqual([])

    // The comparison window, sited against the slowest healthy dispatch this run already
    // measured rather than against a millisecond count — see `COMPARE_GRACE_FACTOR`.
    const offSpanMs = offMs / SHARDS
    const compareGraceMs = Math.ceil(COMPARE_GRACE_FACTOR * Math.max(1, offSpanMs))

    /*
     * **The freeze is staged from a wrapper around the production dispatch**, one layer
     * down from the job, so the *production* `RemoteExecutor` still does the dispatching
     * and the *production* `submitJob` still does the placing — `churn-agents.node.test.ts`
     * and `tree-reduce-agents.node.test.ts`'s technique, copied. What the wrapper decides
     * is **when**, and nothing else.
     *
     * The instant is the one this criterion is about. `submitJob` places every shard first
     * — offers go out to seven live agents and come back accepted — and only then enters
     * the per-shard dispatch. The first `execute` call is therefore the first moment at
     * which the job has been placed and nothing has been dispatched. Every executor awaits
     * the **same** promise, so the freeze is complete before any frame reaches any agent; a
     * wrapper that let the freeze overlap the first dispatches would sometimes let a victim
     * answer, and a test whose subject is slowness would then measure nothing while still
     * printing green.
     *
     * **Three processes are frozen**: the worker holding the most public shards, the paired
     * owner's holder, and the solo owner's only node. All three by one signal at one
     * instant, so the difference between what happens to their shards is a difference in
     * how many nodes their owner has, and nothing else.
     *
     * The **thaw** is an event and not an interval: the frozen processes are resumed the
     * moment any duplicate's own `execute` resolves. It is why no delay constant appears
     * anywhere in this file. **It cannot fail to fire**: the paired owner's spare is never
     * frozen, so its duplicate always lands on a running process.
     */
    const log: Dispatch[] = []
    const frozen = [victim, paired[0], solo]
    let freezing: Promise<void> | null = null
    let thawing: Promise<void> | null = null
    let frozenAt: number | null = null
    let thawedAt: number | null = null
    const freeze = async (): Promise<void> => {
      freezing ??= (async () => {
        frozenAt = performance.now()
        await Promise.all(frozen.map((agent) => pauseAgent(agent)))
      })()
      return freezing
    }
    const thaw = (): void => {
      thawing ??= (async () => {
        thawedAt = performance.now()
        await Promise.all(frozen.map((agent) => resumeAgent(agent)))
      })()
    }

    const armed: readonly Executor[] = everyAgent.map((agent) => {
      const inner = new RemoteExecutor(agent.peerId, requestor.rpc, chainSupplierFor(agent.peerId))
      return {
        nodeId: inner.nodeId,
        execute: async (task: Task) => {
          await freeze()
          const siblings = log.filter((d) => d.partitionIndex === task.partitionIndex)
          const duplicate =
            siblings.some((d) => d.settledAt === null) && !siblings.some((d) => d.nodeId === inner.nodeId)
          const record: Dispatch = {
            nodeId: inner.nodeId,
            partitionIndex: task.partitionIndex,
            startedAt: performance.now(),
            settledAt: null,
            duplicate,
          }
          log.push(record)
          try {
            return await inner.execute(task)
          } finally {
            record.settledAt = performance.now()
            if (duplicate) thaw()
          }
        },
      }
    })

    // ---- The on arm. --------------------------------------------------------------
    const onAt = performance.now()
    const on = await runJob(fabric, armed, { fraction: SPECULATION_FRACTION, compareGraceMs })
    const onMs = performance.now() - onAt
    // Awaited rather than left dangling: a resume still in flight at teardown would race
    // `stopAgent`, and an unawaited promise is a rejection nobody is holding.
    await thawing

    // The freeze really happened. Without this a run in which the wrapper never fired would
    // satisfy much of what follows by simply never being slow.
    //
    // **The thaw is deliberately NOT asserted here**, and the ordering was chosen by
    // planting rather than by taste: with speculation disabled in the on arm, nothing
    // resumes the frozen processes and `thawedAt` stays null — so a `thawedAt` precondition
    // in this position reddens *first* and the plant would be reporting a fact about this
    // file's own staging instead of about duplication. It is asserted below, after the
    // duplication reading it is a consequence of.
    expect(frozenAt).not.toBeNull()

    // ---- The instrument's own reading, independent of anything the job reports. ----
    const frozenIds = new Set(frozen.map((a) => a.peerId))
    const duplicates = log.filter((d) => d.duplicate)
    const primaryOf = (partition: number): Dispatch =>
      log.find((d) => d.partitionIndex === partition && !d.duplicate) as Dispatch
    const trackedPrimary = primaryOf(trackedIndex)
    const pairedCall = primaryOf(PAIRED_INDEX)
    const soloCall = primaryOf(SOLO_INDEX)
    const healthyMs = log
      .filter((d) => !frozenIds.has(d.nodeId) && d.settledAt !== null)
      .map((d) => (d.settledAt as number) - d.startedAt)
    const medianHealthyMs = median(healthyMs)
    const stragglerThresholdMs = DEFAULT_STRAGGLER_FACTOR * medianHealthyMs
    const durationOf = (d: Dispatch): number => (d.settledAt as number) - d.startedAt

    // Printed rather than only asserted, so the readings are available on every run rather
    // than surviving as a note somebody took once — `late-combine.node.test.ts`'s
    // precedent. **None of these numbers is asserted against a threshold**; see the header.
    console.log(
      `[criterion 3 / speculation] standUp ${Math.round(standUpMs)}ms for ${AGENT_COUNT} agents, ` +
        `off arm ${Math.round(offMs)}ms, on arm ${Math.round(onMs)}ms; ` +
        `allowance ${ALLOWANCE} over ${SHARDS} shards (the shipped fraction would have ` +
        `allowed ${DEFAULT_ALLOWANCE}), spent ${on.speculationSpent}; ` +
        `multiplier ${on.speculationMultiplier.toFixed(4)} against the off arm's ` +
        `${off.speculationMultiplier.toFixed(4)}; redispatches ${on.redispatches} against ` +
        `${off.redispatches}; dispatches ${log.length} against ${SHARDS} shards; ` +
        `frozen worker held ${victimShards.length} public shard(s); ` +
        `median healthy dispatch ${Math.round(medianHealthyMs)}ms over ${healthyMs.length} ` +
        `samples, straggler threshold ${Math.round(stragglerThresholdMs)}ms; ` +
        `frozen public shard ${Math.round(durationOf(trackedPrimary))}ms, paired-owner shard ` +
        `${Math.round(durationOf(pairedCall))}ms, solo-owner shard ` +
        `${Math.round(durationOf(soloCall))}ms; compare grace ${compareGraceMs}ms; ` +
        `losing copies [${on.shards.flatMap((s) => s.copies.map((c) => c.outcome)).join(',')}]`,
    )

    // If speculation did not fire, say **why** rather than reaching for a longer delay.
    // Each clause is a different answer and only one of them is a fixture problem.
    const diagnosis =
      `completed-before-judgement ${healthyMs.length} against MIN_SAMPLES ${MIN_SAMPLES}; ` +
      `budget spent ${on.speculationSpent} of ${ALLOWANCE}; eligible untried nodes existed ` +
      `(public → ${publicDuplicateTarget.nodeId}, paired → ${paired[1].peerId}); the frozen ` +
      `public dispatch ran ${Math.round(durationOf(trackedPrimary))}ms against a threshold of ` +
      `${Math.round(stragglerThresholdMs)}ms\n${describeShards(on)}`
    expect(duplicates.length, `no duplicate was dispatched. ${diagnosis}`).toBeGreaterThanOrEqual(2)

    // ---- (1) The duplicates were live: dispatched while the first copy was still running.
    // Read off the wrapper, so this does not depend on any field the job reports.
    for (const duplicate of duplicates) {
      const primary = primaryOf(duplicate.partitionIndex)
      expect(duplicate.nodeId).not.toBe(primary.nodeId)
      expect(duplicate.startedAt).toBeGreaterThan(primary.startedAt)
      expect(duplicate.startedAt).toBeLessThan(primary.settledAt as number)
    }
    const trackedDuplicate = duplicates.find((d) => d.partitionIndex === trackedIndex) as Dispatch
    const pairedDuplicate = duplicates.find((d) => d.partitionIndex === PAIRED_INDEX) as Dispatch
    expect(trackedDuplicate, `the frozen worker's shard was not duplicated. ${diagnosis}`).toBeDefined()
    expect(pairedDuplicate, `the paired owner's shard was not duplicated. ${diagnosis}`).toBeDefined()
    // Nothing was duplicated for the solo owner, at the level of the wire.
    expect(duplicates.filter((d) => d.partitionIndex === SOLO_INDEX)).toEqual([])
    // The event-driven thaw fired, which is a *consequence* of a duplicate having answered
    // rather than an independent fact — see the note beside the freeze assertion above.
    expect(thawedAt).not.toBeNull()

    // ---- (2) The job reports the same events, and names the nodes placement did not pick.
    const tracked = on.shards[trackedIndex] as ShardResult
    expect(tracked.speculated).toBe(true)
    expect(tracked.generations).toBe(1)
    expect(tracked.attempted).toEqual([victimId, publicDuplicateTarget.nodeId])
    expect(trackedDuplicate.nodeId).toBe(publicDuplicateTarget.nodeId)
    expect(tracked.ending).toBe('agreed')

    // ---- (3) The first result won, whichever copy produced it, and it is correct. ----
    //
    // **Which copy won is deliberately not asserted.** The thaw fires when the first
    // duplicate anywhere in the job answers, so the frozen primary is racing its own
    // duplicate from that instant and either may arrive first. What matters is that the
    // race was settled by an answer and that the answer is the one the off arm produced —
    // both copies compute the same pure function of the same content-addressed input, which
    // is `speculation.ts`'s whole argument for why a loser is harmless.
    expect(tracked.verification.status).toBe('agreed')
    if (tracked.verification.status === 'agreed') {
      expect(tracked.attempted).toContain(tracked.verification.agreeing[0]?.nodeId)
    }
    // The whole job's answers, against the off arm of the same fixture in the same run —
    // an equality, never a pinned literal.
    expect(resultCids(on)).toEqual(offCids)

    // ---- (4) Every loser is accounted for by name. ---------------------------------
    // A straggler whose copy vanishes from the record is the loss of exactly the evidence
    // speculation exists to produce. `agreed`, `failed` and `uncompared` are all truthful
    // answers depending on whether the losing process beat the comparison window;
    // `disagreed` is not, and is asserted against separately because it is the one outcome
    // that would mean the answers above cannot be trusted.
    for (const duplicate of duplicates) {
      const shard = on.shards[duplicate.partitionIndex] as ShardResult
      expect(shard.copies).toHaveLength(1)
      const loser = shard.copies[0] as (typeof shard.copies)[number]
      // The loser is the copy that did **not** win, and both are in `attempted`.
      expect(shard.attempted).toEqual(expect.arrayContaining([...loser.nodeIds]))
      expect(['agreed', 'failed', 'uncompared']).toContain(loser.outcome)
      expect(shard.disagreed).toBe(false)
    }
    // Exactly the duplicated shards carry copies — no shard that was never duplicated
    // acquired one, and no duplicated shard lost its record. Sorted numerically on both
    // sides: `Array.prototype.sort`'s default is lexicographic and would put 10 before 2.
    const ascending = (a: number, b: number): number => a - b
    expect(
      on.shards.filter((s) => s.copies.length > 0).map((s) => s.partitionIndex).sort(ascending),
    ).toEqual([...new Set(duplicates.map((d) => d.partitionIndex))].sort(ascending))

    /*
     * ---- (5) A straggler, not a refusal. -------------------------------------------
     *
     * Without this the file could be re-measuring criterion 2 and calling it criterion 3.
     * A SIGSTOPped process answers nothing at all — it does not refuse — and these are the
     * readings that say the fabric saw it that way.
     *
     * **These four lines have no plant that reddens them while everything above stays
     * green, and the reason is structural rather than a gap somebody can close.** Any
     * mutation that turns the freeze into a refusal removes the silence, and a dispatch
     * that answers is not a straggler — so the duplication assertions above go red first
     * and this block is never reached. What was watched instead, and recorded in
     * `20-09-SUMMARY.md` with its output:
     *
     * - with speculation disabled in the on arm and the identical freeze, this fixture
     *   reported `redispatches 11 against 0` and left the solo owner's shard
     *   `no-untried-node` on an rpc timeout — the same silence read as churn, which is what
     *   these lines exist to exclude;
     * - with the rpc budget cut to 400 ms, `expect(off.redispatches).toBe(0)` above went
     *   red at **9**, i.e. the instrument check catches a fabric that was already lossy
     *   before the on arm ran.
     */
    expect(on.redispatches).toBe(0)
    expect(
      on.leaseHistory.filter(
        (e) => e.kind === 'expired' || e.kind === 'surrendered' || e.kind === 'abandoned',
      ),
    ).toEqual([])
    expect(on.shards.flatMap((s) => s.rejections)).toEqual([])
    for (const shard of on.shards) expect(shard.generations).toBe(1)

    // ---- (6) The cost accounting carries the measurement, as a ratio between arms. ---
    //
    // The spend is the wrapper's own count of duplicate dispatches — two instruments, one
    // number. A ledger that incremented without dispatching, or a dispatch the ledger never
    // charged for, breaks the equality.
    expect(on.speculationSpent).toBe(duplicates.length)
    // Strictly below the allowance, which is what stops the solo-owner reading below being
    // explained by an exhausted budget rather than by CHURN-06.
    expect(on.speculationSpent).toBeLessThan(ALLOWANCE)
    expect(on.speculationMultiplier).toBeCloseTo((SHARDS + duplicates.length) / SHARDS, 12)
    expect(on.speculationMultiplier).toBeGreaterThan(off.speculationMultiplier)
    expect(on.speculationMultiplier / off.speculationMultiplier).toBeCloseTo(
      (SHARDS + duplicates.length) / SHARDS,
      12,
    )
    // The same fact counted a third way, from the dispatch side: the off arm's one call per
    // shard plus one call per duplicate, and `attempted` agreeing with both.
    expect(log).toHaveLength(SHARDS + duplicates.length)
    expect(on.shards.reduce((total, s) => total + s.attempted.length, 0)).toBe(
      off.shards.reduce((total, s) => total + s.attempted.length, 0) + duplicates.length,
    )

    // ---- (7) CHURN-06, both arms of it. ---------------------------------------------
    //
    // The paired owner's shard WAS duplicated, and the duplicate went to that owner's other
    // node — not to any of the four idle workers, which a widened eligibility gate would
    // have reached for. A node id, not a reason string.
    const pairedOn = on.shards[PAIRED_INDEX] as ShardResult
    expect(pairedOn.speculated).toBe(true)
    expect(pairedOn.attempted).toEqual([paired[0].peerId, paired[1].peerId])
    expect(pairedDuplicate.nodeId).toBe(paired[1].peerId)

    // The solo owner's shard was NOT, and no second node was ever dispatched to.
    const soloOn = on.shards[SOLO_INDEX] as ShardResult
    expect(soloOn.speculated).toBe(false)
    expect(soloOn.copies).toEqual([])
    expect(soloOn.attempted).toEqual([solo.peerId])
    expect(soloOn.verification.status).toBe('agreed')
    if (soloOn.verification.status === 'agreed') {
      expect(soloOn.verification.agreeing.map((e) => e.nodeId)).toEqual([solo.peerId])
    }
    // All three frozen dispatches cleared the production straggler rule against a median
    // this file measured in this same arm — so "nothing was slow enough" is excluded for
    // the solo owner's shard by measurement rather than by argument. With the budget
    // excluded at (6), what remains is that there was nowhere legal to duplicate to.
    expect(medianHealthyMs).toBeGreaterThan(0)
    expect(durationOf(trackedPrimary)).toBeGreaterThan(stragglerThresholdMs)
    expect(durationOf(pairedCall)).toBeGreaterThan(stragglerThresholdMs)
    expect(durationOf(soloCall)).toBeGreaterThan(stragglerThresholdMs)
    // No duplicate, anywhere in the job, landed on a node belonging to a different owner
    // from the shard it copied. Read across every duplicate rather than only the two named
    // above, so a sovereign leak on any shard is caught here.
    for (const duplicate of duplicates) {
      if (duplicate.partitionIndex < PUBLIC_SHARDS) continue
      const ownerNodes =
        duplicate.partitionIndex === PAIRED_INDEX ? paired.map((a) => a.peerId) : [solo.peerId]
      expect(ownerNodes).toContain(duplicate.nodeId)
    }

    // ---- (8) The job as a whole is unchanged by having duplicated something. --------
    expect(on.complete, `the on arm did not complete:\n${describeShards(on)}`).toBe(true)
    expect(on.shards).toHaveLength(SHARDS)
    for (const shard of on.shards) expect(shard.degraded).toBe(false)
    // The on arm's first placement is the off arm's, shard for shard. It could only be that
    // if the freeze happened after placement — a freeze staged earlier would have had the
    // three victims fail their offers and the placement would differ here.
    for (const [i, shard] of on.shards.entries()) {
      const control = off.shards[i] as ShardResult
      expect(shard.attempted.slice(0, control.attempted.length)).toEqual([...control.attempted])
    }
  }, PROCESS_TEST_TIMEOUT)
})

// ---------------------------------------------------------------------------
// The two published cost columns, guarded at their call sites.
// ---------------------------------------------------------------------------

/**
 * `Observation.speculationMultiplier` and `Observation.redispatches` are read from the
 * job — BENCH-03, CHURN-01, CHURN-02.
 *
 * ## Why this guard exists at all, and why it is here
 *
 * Until this plan both figures were **literals** at both measurement sites, with a comment
 * saying why, and `harness.ts` averaged them into `speculationTax` and `churnTax` while
 * `report.ts` printed two columns of them. Replacing a literal with a read is a one-line
 * change in each file — and reverting it is a one-line change too. **Measured before this
 * block was written: with both reads reverted to the literals, `bench-reduce`,
 * `bench-attestation`, `bench-egress`, `harness.test` and `serve-agent-hooks` all stay
 * green.** The columns were unguarded, and a benchmark column nothing guards is a constant
 * waiting to come back.
 *
 * It lives beside criterion 3's live reading rather than in `bench-reduce.node.test.ts`,
 * which is the more natural home and already owns this driver's call-site shapes, because
 * this plan does not own that file. The idiom is that file's, deliberately: a named
 * requirement per shape, a reason that says what the shape *carries* rather than that it is
 * there, and a `satisfying` fragment used to prove the scan can report its absence.
 *
 * **Two requirements, checked against two sources — not four requirements.** The first
 * draft named a requirement per (file, field) pair and its own planting cases went red:
 * the two files' call sites have the *same shape*, so a synthetic source built from the
 * other three fragments still satisfied the omitted one. The file a finding belongs to is
 * carried by which source was scanned, and the requirement is the shape. Recorded because
 * it is the same mistake as keeping two structures that answer one question.
 *
 * ## Why it strips comments first
 *
 * Both files name these identifiers in their own prose — that is how the literals were
 * explained for as long as they stood. Match raw text and a reader could revert both call
 * sites, leave the paragraphs describing them, and keep this green.
 * {@link stripComments} is the shared tokenizer; `strip-comments.node.test.ts` measures it.
 *
 * ## What a green result here does NOT say
 *
 * That the columns are *correct*. It says the driver reads them from the job it ran rather
 * than writing them down. Whether the figure the job reports is itself measured is the
 * case above, and `packages/core/src/job/submit.test.ts`'s.
 */
const BENCH_SOURCE: string = readFileSync(fileURLToPath(new URL('./bin/bench.ts', import.meta.url)), 'utf8')
const PERF_WORKLOAD_SOURCE: string = readFileSync(
  fileURLToPath(new URL('../../bench/src/perf-workload.ts', import.meta.url)),
  'utf8',
)

interface ColumnRequirement {
  /** Named so whoever broke one knows which call site to open. */
  readonly name: string
  /** Every pattern must match. */
  readonly patterns: readonly RegExp[]
  /**
   * Patterns that must **not** match — the literal coming back.
   *
   * Both halves are needed and they fail differently: the presence pattern catches the
   * read being deleted, the forbidden pattern catches it being replaced by the constant
   * it used to be. A source with neither the read nor the literal fails the first; a
   * source with both fails the second.
   */
  readonly forbidden: readonly RegExp[]
  readonly reason: string
  /** A minimal fragment satisfying it, used to build the planted sources below. */
  readonly satisfying: string
}

const COLUMN_REQUIREMENTS: readonly ColumnRequirement[] = [
  {
    name: 'the speculation multiplier is read from the job',
    patterns: [/speculationMultiplier:\s*result\.ok\s*\?\s*result\.job\.speculationMultiplier/],
    forbidden: [/speculationMultiplier:\s*1\s*[,\n]/],
    reason:
      'CHURN-02’s cost accounting is published as the `spec. tax` column of every rung of both ' +
      'transports in .planning/BENCHMARK-RESULTS.md. A literal there prints 1.00 whatever the job ' +
      'did — and 1.00 is also what an honest run with no stragglers reports, so nothing in the ' +
      'artifact could distinguish a measured identity from a hardcoded one. That is the same class ' +
      'of defect as a column labelled with the wrong noun.',
    satisfying: '      speculationMultiplier: result.ok ? result.job.speculationMultiplier : 0,\n',
  },
  {
    name: 'the re-dispatch count is read from the job',
    patterns: [/redispatches:\s*result\.ok\s*\?\s*result\.job\.redispatches/],
    forbidden: [/redispatches:\s*0\s*[,\n]/],
    reason:
      'CHURN-01’s figure, published as `churn/task`. It has been real on the `submitJob` path since ' +
      '20-01 — a shard whose lease lapses is re-placed and `JobResult.redispatches` counts the ' +
      'generations beyond the first — so a literal 0 here is not an identity but a wrong number ' +
      'that happens to be right on a healthy run.',
    satisfying: '      redispatches: result.ok ? result.job.redispatches : 0,\n',
  },
]

/**
 * The two sources that must satisfy every requirement above, and why both.
 *
 * They fail independently. The driver publishes the artifact; the perf gate publishes
 * nothing and asserts only ratios over makespan, so a reverted gate would leave no visible
 * symptom anywhere at all. `perf-workload.ts`'s own header records that it is a *second*
 * rig on purpose, and this is the cost of that decision paid in guards.
 */
const COLUMN_SOURCES: readonly (readonly [string, string])[] = [
  ['packages/node/src/bin/bench.ts', BENCH_SOURCE],
  ['packages/bench/src/perf-workload.ts', PERF_WORKLOAD_SOURCE],
]

/** The requirements `source` does not satisfy, in declaration order. */
function unmetColumns(source: string): string[] {
  const stripped = stripComments(source)
  return COLUMN_REQUIREMENTS.filter(
    ({ patterns, forbidden }) =>
      !patterns.every((pattern) => pattern.test(stripped)) ||
      forbidden.some((pattern) => pattern.test(stripped)),
  ).map(({ name }) => name)
}

/** Every fragment except `omit`, joined — a source satisfying all but one. */
function plantedColumns(omit: string): string {
  return COLUMN_REQUIREMENTS.filter(({ name }) => name !== omit)
    .map(({ satisfying }) => satisfying)
    .join('')
}

function describeUnmetColumns(file: string, names: readonly string[]): string[] {
  return names.map((name) => {
    const reason = COLUMN_REQUIREMENTS.find((requirement) => requirement.name === name)?.reason ?? ''
    return `${file} — missing: ${name}. Why it matters: ${reason}`
  })
}

describe('BENCH-03 — the speculation and churn columns are read from the job, not written down', () => {
  it('satisfies every call-site requirement in both real sources', () => {
    // Anti-vacuity: a truncated or replaced file would make "nothing unmet" mean nothing,
    // and readFileSync would not have thrown on it.
    expect(BENCH_SOURCE.length).toBeGreaterThan(5_000)
    expect(BENCH_SOURCE).toContain('async function memoryFabric')
    expect(PERF_WORKLOAD_SOURCE.length).toBeGreaterThan(5_000)
    expect(PERF_WORKLOAD_SOURCE).toContain('export async function measureGateLadder')

    for (const [file, source] of COLUMN_SOURCES) {
      expect(describeUnmetColumns(file, unmetColumns(source))).toEqual([])
    }
  })

  for (const { name } of COLUMN_REQUIREMENTS) {
    it(`reports exactly "${name}" when only that read is gone`, () => {
      // `toEqual` rather than `toContain`: it asserts the sibling requirement is still
      // satisfied by the same source, so one planted case doubles as the control for the
      // other.
      expect(unmetColumns(plantedColumns(name))).toEqual([name])
    })
  }

  it('reports both requirements when the literals come back beside the reads', () => {
    // The failure the forbidden patterns exist for, and the one a presence-only check
    // cannot see: the reads are still there and a literal has been added beside each. This
    // is what a partial revert looks like, and it is the shape a merge produces.
    const reverted = COLUMN_REQUIREMENTS.map(({ satisfying }) => satisfying)
      .join('')
      .concat('      speculationMultiplier: 1,\n', '      redispatches: 0,\n')
    expect(unmetColumns(reverted)).toEqual(COLUMN_REQUIREMENTS.map(({ name }) => name))
  })

  it('reports every requirement when the reads appear only inside a comment', () => {
    // Both real files explain these fields in prose. Without stripping, a source that had
    // reverted both call sites and kept its paragraphs would read as satisfied.
    const commentsOnly = [
      '/*',
      ' * The driver used to write speculationMultiplier: result.ok ? result.job.speculationMultiplier : 0',
      ' * and redispatches: result.ok ? result.job.redispatches : 0 into every Observation.',
      ' */',
      'const theReadsThemselvesAreGone = true',
    ].join('\n')

    expect(unmetColumns(commentsOnly)).toEqual(COLUMN_REQUIREMENTS.map(({ name }) => name))
  })
})
