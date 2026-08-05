import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  asFabricPartial,
  canonicalCid,
  decodeCanonical,
  deriveReduceTree,
  executeReduce,
  fabricCombiner,
  publicNodes,
  rendezvousRank,
  signName,
  submitJob,
  toHex,
} from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  CombineDispatch,
  CombineProduct,
  CombineTask,
  JobResult,
  NameRecord,
  ReduceContribution,
  ReduceTree,
} from '@o2/core'
import { RemoteExecutor, remoteCombineDispatch } from '@o2/net'
import { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * ROADMAP Phase 20 criterion 6 — a combine result from a **recovered** `bin/agent.ts`
 * process reaches a requestor that has already stopped waiting for it, and costs nothing.
 *
 * Phase 16 measured the dedupe across nine real processes and then said, against its own
 * interest, that *"arriving late"* was staged by the test. Its reason, in
 * `tree-reduce-agents.node.test.ts`'s own header: *"`executeReduce` has no late-arrival
 * channel — it walks the ranking, stops at `wanted` replicas, and there is no production
 * path on which a result arriving after that can be received at all."*
 *
 * **That is true of `executeReduce` and false of the endpoint underneath it.** Search
 * `late or duplicate reply` in `packages/net/src/rpc.ts`: a reply whose pending entry the
 * timeout already deleted is received, decoded and dropped **there**. So this criterion
 * never needed a handler built. It needed a *producer*, and Phase 16 had no recovery path
 * to build one from.
 *
 * This file is that producer: SIGSTOP the process the rendezvous ranking put first for a
 * level-1 combine, let the requestor's `rpcTimeoutMs` elapse, let `executeReduce` walk on
 * and take its replicas from later-ranked agents, then SIGCONT. The reply arrives at a
 * requestor that stopped waiting for it two seconds ago.
 *
 * ---
 *
 * ## The arrival is the reading that can fail, and it is taken first
 *
 * Every harmlessness assertion below — same root CID, same replica count, no error — is
 * **trivially green if the frame never comes**. So the load-bearing instrument is the
 * frame counter, and it is the one proved able to fail: the identical case run **without
 * the SIGCONT** counts zero replies and goes red at `expected false to be true`. That
 * plant was watched, and the observed text is recorded in `20-03-SUMMARY.md`.
 *
 * The counter is `watchInbound`, a second subscriber on the requestor's **transport**.
 * `EgressGuard.onMessage` delegates straight to the inner transport and
 * `Libp2pTransport` keeps its handlers in a `Set`, so this counter and `RpcEndpoint`'s
 * own `#receive` are fed from the same call, on the same frames, in one delivery. It
 * touches no production counter: a counter read only by a test is *built, not wired*,
 * which is the condition this milestone exists to remove.
 *
 * ## Which arm carries the claim — measured, not assumed
 *
 * The plan required this file to fall back to an in-process `MemoryNetwork` fabric, and
 * to label that fallback the weaker model, **if a libp2p stream could not survive the
 * pause**. It survives. Measured 2026-08-04 on four spawned agents:
 * `framesFromVictim` reads `["req","req","req","req","res"]` — the resumed process first
 * asks the requestor for the four input partials it had never seen, *then* answers the
 * combine — and the reply lands **20 ms** after the dispatch that asked for it had already
 * resolved `null`. So **the spawned-process arm carries criterion 6 and no in-process arm
 * was built.**
 *
 * The mechanism, because it is the non-obvious part and a later reader will otherwise
 * assume a race. Two independent budgets are in play and they are deliberately not the
 * same number:
 *
 * - `RpcEndpoint`'s correlation timeout, here `rpcTimeoutMs: 1500`, which deletes the
 *   pending entry and rejects the caller;
 * - `Libp2pTransport`'s `DEFAULT_SEND_TIMEOUT_MS` (20 000), which bounds the whole
 *   transfer — the `dialProtocol` handshake included.
 *
 * A frozen process answers no stream negotiation, so `transport.send` is still in flight
 * when the correlation timer fires. `request` rejects, `remoteCombineDispatch` collapses
 * that to `null`, `executeReduce` moves down the ranking — and the send is *still open*.
 * SIGCONT inside the 20 s send budget lets it complete, and the reply comes back to a
 * correlation table that no longer has an entry for it. **Any pause longer than the send
 * budget would produce silence instead**, which is why the case asserts the ordering
 * `healthy combine < rpcTimeoutMs < pause < send budget` rather than trusting it.
 *
 * ## What this file cannot redden on, so nobody takes it for more than it is
 *
 * - **Not `executeReduce`'s dedupe.** That is Phase 16's nine-process reading and it
 *   stays in `tree-reduce-agents.node.test.ts`. Nothing here re-states it.
 * - **Not the rendezvous ranking.** `rendezvousRank`'s own unit tests hold that; this
 *   file only *reads* the ranking to choose a victim before anything is paused, which is
 *   what makes the pause deterministic rather than a race.
 * - **Not `MR-02`.** Every job here is public, exactly as in the file it copies from.
 *
 * ## Which half of "changes nothing" is a measurement, and which is a conjunct
 *
 * The criterion names the harmlessness readings as a conjunction, so all of them are
 * taken. **They are not equally strong, and pretending otherwise is the failure this
 * paragraph exists to prevent.** Measured by plant, on the run recorded in
 * `20-03-SUMMARY.md`:
 *
 * | reading | moved under a plant? |
 * |---|---|
 * | the arrival count | yes — the SIGCONT withheld reads zero |
 * | no unhandled rejection | yes — `rpc.ts`'s drop turned into a `throw` |
 * | `executedBy` omits the recovered peer | yes — the pause withheld makes it the executor |
 * | `recomputes` above the unpaused run's | yes — same plant, `0` against `0` |
 * | `asked` holds nothing after the resume | yes — one dispatch added after it |
 * | `rootCid` equals the unpaused root | **no** |
 * | `minReplicas`, `combines`, `disagreements` | **no** |
 *
 * The four in the lower half stayed green through every plant available at this seam,
 * and the reason is structural rather than a gap in the plants: `executeReduce` has
 * already `break`ed out of the ranking walk and returned before the frame arrives, so
 * there is no expression left able to fold it into a replica count or an aggregate.
 * They are recorded as **comparative readings against the unpaused run in the same
 * run**, which is the right shape for them, but the sentence *"the late arrival changed
 * nothing"* is carried by the upper half.
 *
 * ## The one reading here that is a wall clock against a constant, and how it is taken
 *
 * `RPC_TIMEOUT_MS` is a constant, so `RPC_TIMEOUT_MS > combine × TIMEOUT_MARGIN` is a
 * ratio only in form: one of its two terms is a millisecond measured on the host of the
 * day. **A ratio against a constant is load-proof exactly as far as the measured term
 * is**, and read the way this file first wrote it — one cold combine, this run's first —
 * it was not load-proof at all. It went red three times under whole-suite load and passed
 * alone each time: `expected 1500 to be greater than 2058.2`, `3403.93` and `4569.14`,
 * i.e. single cold combines of 206 ms, 340 ms and 457 ms against a solo reading of 22 ms.
 * One of the three was taken with `(user+sys)/real` at **0.87**, next to a sibling file
 * reading 1.25 in the same run.
 *
 * **The repair is the estimator and only the estimator.** Six cold combines are taken —
 * both level-1 tree nodes on each of the three non-victim peers, every pair genuinely
 * cold — and the reading is the **fastest of the six**. Neither budget moved and the
 * margin did not move, because both are the thing being guarded: `RPC_TIMEOUT_MS` has to
 * fire *inside* `Libp2pTransport`'s 20 s send budget or no late reply is produced at all,
 * and a margin relaxed to get green would be the guard switched off rather than fixed.
 *
 * ### One-sidedness holds here, but the floor is *not* invariant — measured, not assumed
 *
 * `enrollment-dos.node.test.ts`'s `pairedRatio` is where the licence for a minimum was
 * first established, and it measured a floor that barely moved between host loads 8 and
 * 213. **That result does not transfer unexamined**, and it was re-measured rather than
 * cited: those arms were in-process Ed25519, while a combine here is a round trip through
 * an OS process that is itself being starved. Seven regimes on 2026-08-04, everything
 * under `/usr/bin/time -p`, seven trials of the first, four whole-suite runs, and three or
 * four trials of each burner regime:
 *
 * | regime | `(user+sys)/real` | floor | slowest sample |
 * |---|---|---|---|
 * | this file alone | 1.32 – 1.63 | 14 – 18 ms | 20 – 48 ms |
 * | inside a whole `--project node` run | 0.90 – 1.37 | 24 – 58 ms | 58 – 314 ms |
 * | alone + 12 CPU burners | 0.85 – 1.20 | 36 – 38 ms | 63 – 141 ms |
 * | alone + 24 CPU burners | 0.71 – 0.86 | 40 – 47 ms | 145 – 222 ms |
 * | alone + 48 CPU burners | 0.34 – 0.42 | 36 – 77 ms | 275 – 442 ms |
 * | alone, host saturated by an unrelated LLVM build (load 182) | 0.89 | 59 ms | 100 ms |
 * | a `--project node` run on that same saturated host | 0.51 | **564 ms** | 1311 ms |
 *
 * Two facts, and they are different facts:
 *
 * 1. **Contention only ever adds.** Across every regime and every trial no sample came in
 *    below the solo floor of 14 ms, and the lowest loaded sample anywhere was 24 ms.
 *    There is no discount to average in, so the minimum is the closest available reading
 *    of the work itself.
 * 2. **The floor is not invariant here, unlike AUTH-04's.** It rose about 3× from 14 ms
 *    to 47 ms as the process's CPU share fell from 1.6 to 0.71, and reached 77 ms at
 *    0.34. A share of the machine's scarcity lands on *every* sample, because the agent
 *    process answering the combine is starved too — so this is not occasional stalls and
 *    must not be described as such. **What the minimum buys is the gap between the two
 *    columns**: in the whole-suite runs where the floor read 24–58 ms, a single sample
 *    reached 314 ms.
 *
 * `TIMEOUT_MARGIN` needs the floor under 150 ms. It was 58 ms at worst across four whole
 * `--project node` runs — including one at `(user+sys)/real` **0.90**, the share that
 * produced the recorded failures — and 77 ms under a burner load twice past that, on a
 * run where this file alone took 42 s. So the residual margin is **~2.6× in the regime
 * that occurs** and ~2× at a starvation far beyond it.
 *
 * ### Where this reading stops working, measured rather than left to be discovered
 *
 * The last row of the table is a run that **still fails**, and it is written down instead
 * of being tuned away. One `--project node` run took **754 s** against the 247–341 s of
 * the other four and read `cold combines [564,658,1045,1152,1176,1311]ms floor 564ms`,
 * i.e. `expected 1500 to be greater than 5638.8`. The host was checked rather than
 * guessed at while it ran: a second `vitest` at 58 % of a core and **dozens of unrelated
 * `clang++` processes at ~45 % each**, 1-minute load average 196 on eight cores. **No
 * estimator over those six numbers helps**:
 * their spread is 2.33×, so every sample was uniformly slow and there was no quiet moment
 * for a minimum to find. The whole fabric was slow with them — `standUp` 4 900 ms against
 * a usual 750, `map` 2 565 ms against 180 — and `speculation-agents.node.test.ts` went red
 * in that same run on a wall-clock reading of its own.
 *
 * That is the shape of the residual and it is **not** the defect this file was fixed for:
 * the left side of this comparison is work and the right side is a fixed 1 500 ms of wall
 * clock, so on a host where a combine genuinely costs 564 ms the headroom genuinely is
 * 2.7× and no measurement can say otherwise. Calibrating against another same-run span
 * was tried and does not rescue it — `floor ÷ standUpMs` sits in 0.005–0.031 across every
 * other regime measured and jumps to 0.115 on that run, so the combine path inflated
 * several times harder than the fabric around it and there is nothing in the run to
 * divide it by.
 *
 * **And past that share the case does not reach this assertion at all**, which is the
 * honest end of the range: on the same host at load 127, `runMap` failed its own
 * `job.complete` precondition — the eight-shard map would not finish across four spawned
 * agents — and a whole `--project node` run at `(user+sys)/real` **0.38** took 1 245 s and
 * failed 17 files, the entire spawned-process family (`two-process`, `churn-agents`,
 * `capability-dispatch`, `owner-domain-agents`, this file) at the same `runMap` line. A
 * fabric that cannot complete a map is not a timing estimator's problem.
 *
 * **So read a red here by the printed distribution.** A floor near 60 ms with a wide
 * spread is this host; a floor several hundred milliseconds with a *narrow* spread, beside
 * a `standUp` and `map` that are also multiples of the numbers above, is the host as well
 * and is visible as such. A floor that has moved while `standUp` and `map` have not is the
 * combine, and that is the case this assertion exists to catch.
 *
 * ### The defect reproduced on demand, and the repair observed rescuing it
 *
 * At 48 burners and `(user+sys)/real` **0.42**, one trial read
 * `cold combines [39,50,50,102,273,275]ms floor 39ms first 275ms`. The **first** sample
 * — the whole of what this file used to read — was 275 ms, which is
 * `expected 1500 to be greater than 2750` and red. The floor was 39 ms and green, in the
 * same run, on the same six numbers. The failure is therefore not a rare coincidence of
 * scheduling: it is what reading one draw from that distribution does.
 *
 * ## What is copied, what is imported, and whose numbers these are
 *
 * `standUp`, `spawnAgent`, `stopAgent`, `runMap`, `project`, `partitionOf` and the
 * publisher record are **faithful copies** from `tree-reduce-agents.node.test.ts` —
 * none of them is exported, and importing across spec files would make one file's
 * teardown another's. `deriveTree` is a copy of `reduceJob`'s projection-and-store
 * prologue (`packages/net/src/reduce-job.ts`, search `contributorFor`) for the one reason
 * `reduceJob` cannot be called here: it builds its dispatch internally, and the pause has
 * to be staged in a wrapper around the **production** `remoteCombineDispatch` — the same
 * seam `tree-reduce-agents.node.test.ts`'s criterion-2 case uses for its mid-flight kill.
 *
 * `PROCESS_TEST_TIMEOUT` and the 60 s `afterEach` budget are **that file's numbers, not
 * newly chosen ones**, and its docstrings are where their derivations live.
 *
 * Two numbers *are* this file's own, and both are sited against a reading taken in the
 * same run rather than copied from another host:
 *
 * - **`RPC_TIMEOUT_MS = 1500`**, down from the copied fixture's 10 000. Sited against the
 *   **floor of six cold combines** measured inside the case — **14–18 ms** running alone
 *   and **24–58 ms** inside a whole `--project node` run on 2026-08-04 — so the budget is
 *   26–100× the work it has to cover, and the case asserts the ratio rather than the
 *   millisecond. Why the floor and not this run's first is the section above; it is the
 *   defect this file was fixed for. The other term the budget has to cover is the map's
 *   cold `exec` dispatch — module pull plus WASM compile — and the whole eight-shard map
 *   at redundancy 2 measured **184 ms**, an upper bound on any single dispatch inside it.
 *   The map either completes or `runMap` refuses to proceed, so that term is a
 *   precondition rather than an assertion.
 * - **`AGENT_COUNT = 4`**, down from `standUp`'s eight. At `REDUCE_REDUNDANCY = 2` a
 *   combine whose first-ranked executor is paused needs three peers to reach two
 *   replicas; four leaves one spare. A wider fabric would only make a timeout look like
 *   a flake. Stand-up measured **729 ms** for four.
 *
 * Fixture seed **113**, distinct from every other in the repository — the convention
 * `tree-reduce-agents.node.test.ts` records at its own `publisher`.
 *
 * **One host, four OS processes.** Not a cross-machine result and must never be called
 * one.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * DET-03 is not this file's subject. The record exists so the subject can be reached:
 * `bin/agent.ts` pins the demo's kernel anchor by default, so an unsigned job would have
 * every map dispatch refused before a single partial existed to combine.
 */
const publisher = (() => {
  // Seed 113 — distinct from every other fixture key in the repository.
  const priv = new Uint8Array(32).fill(113)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'late-combine-fixture',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/** See `tree-reduce-agents.node.test.ts` — the pipe on fd 0 is the orphan leash. */
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
async function spawnAgent(name: string): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  const handshake = await new Promise<{ peerId: string; multiaddrs: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)), 60_000)
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
        // Named fields only — the handshake line carries a third this file does not read.
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
 * SIGTERM, then wait for the process to actually be gone.
 *
 * **One line differs from the copied original and it is load-bearing here**: the SIGCONT
 * first. A SIGSTOPped process cannot run `bin/agent.ts`'s SIGTERM handler, so a teardown
 * that only signalled TERM would wait out the full 10 s SIGKILL fallback on every case
 * this file writes. It is a no-op on a process that was never paused.
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

/**
 * SIGSTOP, and **wait until the kernel says the process is stopped**.
 *
 * Awaited for the same reason `tree-reduce-agents.node.test.ts`'s `killAgent` is: signal
 * delivery is asynchronous, so a `kill('SIGSTOP')` that merely returned would leave a
 * race between the freeze and the dial that follows it — and a run that lost that race
 * would report a *completed* combine, i.e. the case would fail for a reason that has
 * nothing to do with what it measures. `SIGSTOP` cannot be caught or ignored, so the
 * only thing to wait for is the state transition itself.
 *
 * **No spec in this repository used SIGSTOP before this one.**
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

/** Read the 4-byte little-endian partition index the fixture guest emits. */
function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) throw new Error('not a partition output')
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The job's projection — an agreed shard output becomes a `{counts, rows}` partial.
 *
 * It decodes the guest's output rather than keying on the partition index, for the reason
 * `tree-reduce-agents.node.test.ts` gives at length: an index-derived projection makes
 * every leaf a function of an integer this process already holds, and nothing any agent
 * computed would enter the aggregate.
 */
const project = (output: CanonicalValue): CanonicalValue => ({
  counts: { [`partition-${partitionOf(output)}`]: 1 },
  rows: 1,
})

/** The shard count, and therefore the leaf count. Eight at fanout 4 gives L1(4), L1(4), L2(2). */
const SHARDS = 8

/** Map redundancy — two independent processes verify each shard, as in the copied fixture. */
const MAP_REDUNDANCY = 2

/** See the file header: the minimum that leaves one spare at `REDUCE_REDUNDANCY`. */
const AGENT_COUNT = 4

/** Combine redundancy. Two, so `minReplicas` is a reading of the run and not its floor. */
const REDUCE_REDUNDANCY = 2

/** See the file header. Sited against a cold combine measured in the same run. */
const RPC_TIMEOUT_MS = 1_500

/**
 * How far above the **floor** of the run's cold combines `RPC_TIMEOUT_MS` has to sit.
 *
 * A ratio taken inside the run, not a millisecond threshold: an absolute one would encode
 * this host's load on the day it was written. Ten is a stated judgement against a floor
 * measured at 14–18 ms alone and 24–58 ms inside a whole `--project node` run, i.e. a
 * budget that would still hold if a combine got six times slower.
 *
 * **It did not move when the estimator was fixed, and it must not move to get green.**
 * The file header records what the floor reads down to a CPU share of 0.34 — 77 ms
 * against the 150 ms this margin allows — so a red here is a slower combine, not a
 * busier host. Raising this, or lowering `RPC_TIMEOUT_MS`'s partner budget, is widening
 * what counts as passing.
 */
const TIMEOUT_MARGIN = 10

/** `tree-reduce-agents.node.test.ts`'s number, not a new one — see its docstring. */
const PROCESS_TEST_TIMEOUT = 300_000

interface Fabric {
  readonly agents: readonly Agent[]
  readonly submitter: FabricNode
  readonly moduleCid: CID
  readonly executorIds: readonly string[]
}

/** Spawn `agentCount` agents, start the submitter, dial outward, seed the module. */
async function standUp(agentCount: number): Promise<Fabric> {
  const spawned = await Promise.all(Array.from({ length: agentCount }, (_, i) => spawnAgent(`a${i}`)))

  const submitter = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: RPC_TIMEOUT_MS,
    trustAnchors: [publisher.pub],
  })
  nodes.push(submitter)

  // Outward, one dial per agent — the direction that keeps eight reachable in the file
  // this fixture comes from, and costs nothing at four.
  const dialed = await Promise.all(spawned.map((agent) => submitter.dial(agent.multiaddrs[0] as string)))
  expect([...dialed].sort()).toEqual(spawned.map((a) => a.peerId).sort())

  // Only the submitter has the module. Every agent is a fresh process with an empty
  // directory, so it cannot have it except by asking.
  const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

  return { agents: spawned, submitter, moduleCid, executorIds: spawned.map((a) => a.peerId) }
}

/** Run the map phase across every agent, and refuse to proceed unless it completed. */
async function runMap(fabric: Fabric): Promise<JobResult> {
  const executors = fabric.executorIds.map(
    (id) => new RemoteExecutor(id, fabric.submitter.rpc, 'dispatches-unauthenticated'),
  )
  const result = await submitJob(
    {
      moduleCid: fabric.moduleCid,
      moduleRecord: recordFor(fabric.moduleCid),
      shards: Array.from({ length: SHARDS }, (_, i) => ({ value: { a: i }, label: 'public' as const })),
      executors,
      nodes: publicNodes(executors),
      redundancy: MAP_REDUNDANCY,
      onQuorumShortfall: 'runs-at-available-redundancy',
    },
    fabric.submitter.store,
  )

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('the map did not run')
  expect(result.job.complete).toBe(true)
  return result.job
}

/**
 * `reduceJob`'s projection-and-store prologue, copied rather than called.
 *
 * `reduceJob` builds its dispatch internally — correctly, since a driver taking a
 * caller-supplied dispatch would carry a test-only hook in production code. The pause
 * therefore has to be staged one layer down, around the production
 * `remoteCombineDispatch`, which means this file needs the tree without the driver.
 * `contributorFor`'s `shard-<index>` key is reproduced exactly: a coarser contributor
 * would let two shards with identical partials dedupe into one leaf.
 */
async function deriveTree(job: JobResult, store: Blockstore): Promise<ReduceTree> {
  const contributions: ReduceContribution[] = []
  for (const shard of job.shards) {
    if (shard.verification.status !== 'agreed') throw new Error(`shard ${shard.partitionIndex} did not agree`)
    const partial = project(shard.verification.output)
    if (asFabricPartial(partial) === null) throw new Error('the projection did not produce a partial')
    const hashed = await canonicalCid(partial)
    if (!hashed.ok) throw new Error('the projection will not canonicalise')
    await store.put(hashed.bytes)
    contributions.push({ contributorId: `shard-${shard.partitionIndex}`, cid: hashed.cid })
  }
  return deriveReduceTree(contributions)
}

/**
 * The combine a tree node names, with its children resolved from leaf identities to
 * addresses.
 *
 * `ReduceTreeNode.children` are `contributorId\0cid` identities and a combine reads
 * addresses, so the resolution goes through `tree.leaves` rather than parsing the id.
 */
function taskFor(tree: ReduceTree, nodeIndex: number): CombineTask {
  const node = tree.nodes[nodeIndex]
  if (node === undefined) throw new Error(`no tree node at ${nodeIndex}`)
  return {
    nodeId: node.id,
    inputCids: node.children.map((child) => {
      const leaf = tree.leaves.find((candidate) => candidate.id === child)
      if (leaf === undefined) throw new Error(`node ${nodeIndex} child ${child} is not a leaf`)
      return leaf.cid
    }),
    level: node.level,
  }
}

/**
 * What the production combiner computes for `task`, from the requestor's own store.
 *
 * The single-process reference. A remote process answering with *something* does not
 * pass — the CID it names is compared against this.
 */
async function referenceCombine(store: Blockstore, task: CombineTask): Promise<string> {
  const inputs: CanonicalValue[] = []
  for (const cidString of task.inputCids) {
    const bytes = await store.get(CID.parse(cidString))
    if (bytes === undefined) throw new Error(`the requestor does not hold ${cidString}`)
    inputs.push(decodeCanonical(bytes))
  }
  const hashed = await canonicalCid(fabricCombiner(inputs))
  if (!hashed.ok) throw new Error('the reference will not canonicalise')
  return hashed.cid.toString()
}

/** One cold combine, timed. `product` is `null` only if that combine failed outright. */
interface ColdSample {
  readonly task: CombineTask
  readonly executorId: string
  readonly ms: number
  readonly product: CombineProduct | null
}

/**
 * One cold combine per `(task, executorId)` pair, timed, in that nesting order.
 *
 * **Every pair is genuinely cold and that is what makes the samples comparable.** The
 * partials were projected in *this* process by `deriveTree` and written to the
 * requestor's store; no agent has ever seen them, so each peer answering each task must
 * first pull four blocks it does not hold. A second dispatch of the same task to the
 * same peer would find both the inputs and the product already local and would therefore
 * be measuring a different, cheaper thing — which is why this sweeps pairs rather than
 * repeating one.
 *
 * Serial, not `Promise.all`. Concurrent samples would contend with **each other**, which
 * is the one source of contention this file can remove rather than measure around.
 *
 * The reading taken from the result is the **minimum**, never the first and never the
 * mean — see the file header. `enrollment-dos.node.test.ts`'s `pairedRatio` is where the
 * one-sidedness that licenses a minimum was first measured; this file measures it again
 * for its own workload, because that one was in-process crypto and this one is four OS
 * processes and a real transport.
 */
async function sampleColdCombines(
  dispatch: CombineDispatch,
  tasks: readonly CombineTask[],
  executorIds: readonly string[],
): Promise<readonly ColdSample[]> {
  const samples: ColdSample[] = []
  for (const task of tasks) {
    for (const executorId of executorIds) {
      const started = performance.now()
      const product = await dispatch(task, executorId)
      samples.push({ task, executorId, ms: performance.now() - started, product })
    }
  }
  return samples
}

interface InboundFrame {
  readonly from: string
  readonly kind: unknown
  readonly atMs: number
}

/**
 * Every frame the requestor's transport hands up, decoded far enough to tell `req` from
 * `res`, with the instant it arrived.
 *
 * **A second subscriber, not a production counter.** `Libp2pTransport.onMessage` keeps
 * handlers in a `Set` and `EgressGuard.onMessage` delegates straight to it, so this and
 * `RpcEndpoint`'s own `#receive` are fed from one delivery of one frame. Nothing in
 * `@o2/net` learns that a test is watching.
 */
function watchInbound(node: FabricNode): { readonly frames: readonly InboundFrame[]; stop: () => void } {
  const frames: InboundFrame[] = []
  const stop = node.transport.onMessage((from, message) => {
    let decoded: CanonicalValue
    try {
      decoded = decodeCanonical(message)
    } catch {
      return
    }
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return
    const record = decoded as { readonly [k: string]: CanonicalValue }
    frames.push({ from, kind: record['k'], atMs: performance.now() })
  })
  return { frames, stop }
}

/** Reply frames from one peer that arrived after `sinceMs`. */
function repliesFrom(frames: readonly InboundFrame[], peerId: string, sinceMs: number): readonly InboundFrame[] {
  return frames.filter((frame) => frame.from === peerId && frame.kind === 'res' && frame.atMs > sinceMs)
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
 * Rejections nobody handled, collected across a window.
 *
 * Part of "changes nothing" and the half most easily missed: `RpcEndpoint` subscribes as
 * `void this.#receive(...)`, so anything the receive path throws on a frame **becomes an
 * unhandled rejection and nothing else**. There is no caller left to catch it — the
 * request it belonged to was rejected by the timeout a second and a half ago. This is
 * also the listener the `rpc.ts` throw-plant reddens; see `20-03-SUMMARY.md`.
 */
function watchRejections(): { readonly seen: readonly unknown[]; stop: () => void } {
  const seen: unknown[] = []
  const onRejection = (reason: unknown): void => {
    seen.push(reason)
  }
  process.on('unhandledRejection', onRejection)
  return {
    seen,
    stop: () => {
      process.off('unhandledRejection', onRejection)
    },
  }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-late-combine-'))
})

/** Inner 10 s, outer 60 s — `tree-reduce-agents.node.test.ts`'s relationship, unchanged. */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('MR-04 — a paused process answers after the request that asked for it gave up', () => {
  /**
   * The arrival, established before anything is claimed about it.
   *
   * Four readings, in this order, because each is the precondition of the next:
   *
   * (i) six cold combines on agents that have never seen these partials all complete,
   *     and the **fastest** of them is what `RPC_TIMEOUT_MS` is sited against — see the
   *     file header for why the fastest and not this run's first;
   * (ii) the same combine dispatched to a paused agent resolves `null`, and does so at
   *      the budget rather than at the transport's;
   * (iii) after SIGCONT, a `res` frame arrives from that peer **after** the dispatch had
   *       already resolved — this is the reading that can fail;
   * (iv) the same agent, unpaused, answers with the CID the production combiner computes
   *      here. Without (iv), (ii) would read the same on an agent that was simply broken.
   */
  it('delivers a reply the requestor had already timed out, and the pause is what caused it', async () => {
    const standUpStart = performance.now()
    const fabric = await standUp(AGENT_COUNT)
    const standUpMs = performance.now() - standUpStart
    const { agents: spawned, submitter, executorIds } = fabric

    const mapStart = performance.now()
    const job = await runMap(fabric)
    const mapMs = performance.now() - mapStart

    const tree = await deriveTree(job, submitter.store)
    // A tree, not a one-level merge: two level-1 combines and a root above them.
    expect(tree.leaves).toHaveLength(SHARDS)
    expect(tree.nodes).toHaveLength(3)
    expect(tree.depth).toBe(2)

    const task = taskFor(tree, 0)
    // Computed before anything is stopped, which is what makes the pause deterministic
    // rather than a race. `rendezvousRank` is pure and every participant derives it alike.
    const ranked = rendezvousRank(task.nodeId, executorIds)
    const victimId = ranked[0] as string
    const understudyId = ranked[1] as string
    const victim = spawned.find((agent) => agent.peerId === victimId)
    if (victim === undefined) throw new Error('the ranking named a peer that is not an agent')

    const dispatch = remoteCombineDispatch({ rpc: submitter.rpc, blockstore: submitter.store })
    const watch = watchInbound(submitter)
    const rejections = watchRejections()

    // (i) — cold combines, one per (level-1 combine, non-victim peer) pair. Six of them,
    // and the reading `RPC_TIMEOUT_MS` is sited against is the **fastest**, not this
    // run's first. See the file header: the first is what used to be read, and reading it
    // is what made this case fail under load three times.
    //
    // The victim is excluded on purpose. It has to reach the pause never having seen
    // these partials, because its four `req` frames after the resume are what show the
    // combine request crossed the pause rather than being re-sent.
    const coldTasks = [task, taskFor(tree, 1)]
    const coldPeers = ranked.slice(1)
    const cold = await sampleColdCombines(dispatch, coldTasks, coldPeers)
    expect(cold).toHaveLength(coldTasks.length * coldPeers.length)
    // A `null` sample is a combine that hit the very timeout this reading sites, so a
    // floor taken over the survivors would be the one case where it must not be taken.
    expect(cold.filter((sample) => sample.product === null)).toEqual([])
    const coldSpans = [...cold.map((sample) => sample.ms)].sort((a, b) => a - b)
    const healthyCombineMs = coldSpans[0] as number

    // The first sample is `task` on the understudy — the pair the two assertions below
    // are about. Asserted rather than assumed: `sampleColdCombines` nests task-major, and
    // an edit that swapped the loops would silently compare a different combine's CID.
    const first = cold[0] as ColdSample
    expect(first.executorId).toBe(understudyId)
    expect(first.task).toBe(task)
    const healthyProduct = first.product
    expect(healthyProduct).not.toBeNull()
    expect(healthyProduct?.cid.toString()).toBe(await referenceCombine(submitter.store, task))

    // (ii) — the pause. Awaited to the kernel's `T` state, so the freeze precedes the dial.
    const pauseStart = performance.now()
    await pauseAgent(victim)
    const pausedStart = performance.now()
    const pausedProduct = await dispatch(task, victimId)
    const pausedDispatchMs = performance.now() - pausedStart
    const timedOutAt = performance.now()
    expect(pausedProduct).toBeNull()
    await resumeAgent(victim)
    const pauseMs = performance.now() - pauseStart

    // (iii) — THE READING THAT CAN FAIL. Zero here means the stream did not survive the
    // pause and this arm cannot carry criterion 6.
    const arrived = await waitFor(() => repliesFrom(watch.frames, victimId, timedOutAt).length > 0, 15_000)
    const late = repliesFrom(watch.frames, victimId, timedOutAt)
    const fromVictim = watch.frames.filter((frame) => frame.from === victimId)
    watch.stop()

    // Printed rather than only asserted, so the reading is available on every run instead
    // of surviving as a note somebody took once — `capability-dispatch.node.test.ts`'s
    // precedent, for the same reason.
    console.log(
      `[criterion 6 / arrival] standUp ${Math.round(standUpMs)}ms, map ${Math.round(mapMs)}ms, ` +
        `cold combines [${coldSpans.map((ms) => Math.round(ms)).join(',')}]ms ` +
        `floor ${Math.round(healthyCombineMs)}ms first ${Math.round(first.ms)}ms ` +
        `spread ${(Math.max(...coldSpans) / healthyCombineMs).toFixed(2)}×, ` +
        `paused dispatch ${Math.round(pausedDispatchMs)}ms ` +
        `against rpcTimeoutMs ${RPC_TIMEOUT_MS}, pause ${Math.round(pauseMs)}ms, ` +
        `late replies ${late.length} at +${late.map((f) => Math.round(f.atMs - timedOutAt)).join(',')}ms, ` +
        `frames from the paused peer [${fromVictim.map((f) => String(f.kind)).join(',')}]`,
    )

    expect(arrived).toBe(true)
    // Exactly one request was left outstanding on that peer, so exactly one reply is owed.
    expect(late).toHaveLength(1)
    // Every frame this peer ever sent arrived after it was resumed — it was frozen before
    // the dial and sent nothing until SIGCONT. The `req` frames are its own block fetches
    // for the four partials it had never seen, which is independent evidence that the
    // combine request itself crossed the pause rather than being re-sent.
    expect(fromVictim.filter((frame) => frame.atMs < timedOutAt)).toEqual([])
    expect(fromVictim.filter((frame) => frame.kind === 'req').length).toBeGreaterThan(0)

    // (iv) — alive, and it would have answered. Without this, (ii) is indistinguishable
    // from a broken agent.
    const afterProduct = await dispatch(task, victimId)
    expect(afterProduct).not.toBeNull()
    expect(afterProduct?.cid.toString()).toBe(healthyProduct?.cid.toString())

    // The three budgets, in the order the mechanism requires. Ratios, not milliseconds.
    //
    // `healthyCombineMs` is the **floor** of the six cold samples, not the first of them.
    // Reading the first is what made this line fail three times under whole-suite load;
    // the file header carries the five-regime measurement that licenses the minimum and
    // states where its own margin runs out.
    expect(RPC_TIMEOUT_MS).toBeGreaterThan(healthyCombineMs * TIMEOUT_MARGIN)
    expect(pausedDispatchMs).toBeGreaterThanOrEqual(RPC_TIMEOUT_MS)
    expect(pauseMs).toBeGreaterThan(RPC_TIMEOUT_MS)

    rejections.stop()
    expect(rejections.seen.map((reason) => String(reason))).toEqual([])
  }, PROCESS_TEST_TIMEOUT)
})

describe('MR-07 — the late duplicate is unsolicited, and it costs nothing', () => {
  /**
   * The same event inside a whole reduce, read against the identical tree reduced with
   * nobody paused **in the same run**.
   *
   * The pause is staged by the dispatch wrapper — the seam
   * `tree-reduce-agents.node.test.ts`'s criterion-2 case uses for its mid-flight kill.
   * The wrapper decides *when* to freeze and never substitutes what is dispatched; the
   * production `remoteCombineDispatch` is what runs, over the production combine handler,
   * on a tree the production derivation produced.
   *
   * **Unsolicited is asserted by construction, not argued.** The wrapper records every
   * `(nodeId, executorId)` it was asked for with the instant it was asked, and the
   * recovered agent is resumed only after `executeReduce` has returned — after which the
   * wrapper cannot run again, because nothing calls it. So *every* request that peer ever
   * received predates its resume, and the count of late replies equals the count of
   * requests it was left holding.
   */
  it('leaves the root CID, the executor record and the process error state identical to an unpaused run', async () => {
    const fabric = await standUp(AGENT_COUNT)
    const { agents: spawned, submitter, executorIds } = fabric
    const job = await runMap(fabric)
    const tree = await deriveTree(job, submitter.store)

    const production = remoteCombineDispatch({ rpc: submitter.rpc, blockstore: submitter.store })

    // The reference: the identical tree, nobody paused, in this run. **A reference that
    // is itself null proves nothing**, so its non-nullity is the instrument check that
    // comes before every comparison below.
    const healthy = await executeReduce({
      tree,
      executors: executorIds,
      dispatch: production,
      redundancy: REDUCE_REDUNDANCY,
    })
    expect(healthy.ok).toBe(true)
    expect(healthy.rootCid).not.toBeNull()
    expect(healthy.recomputes).toBe(0)
    const healthyRoot = healthy.rootCid as string

    const pausedNode = tree.nodes[0] as { readonly id: string }
    const victimId = rendezvousRank(pausedNode.id, executorIds)[0] as string
    const victim = spawned.find((agent) => agent.peerId === victimId)
    if (victim === undefined) throw new Error('the ranking named a peer that is not an agent')

    // The positive control for the executor readings, taken on the healthy run.
    // Undisturbed, this combine *is* executed by the peer about to be paused; without
    // this line `not.toBe(victimId)` would also pass on a run where the ranking never
    // chose it.
    expect(healthy.executedBy.get(pausedNode.id)).toBe(victimId)

    const asked: { readonly nodeId: string; readonly executorId: string; readonly atMs: number }[] = []
    let frozen = false
    const dispatch: CombineDispatch = async (task, executorId) => {
      if (!frozen && executorId === victimId) {
        frozen = true
        // Awaited to the kernel's stopped state — the process is frozen before we dial it.
        await pauseAgent(victim)
      }
      asked.push({ nodeId: task.nodeId, executorId, atMs: performance.now() })
      return production(task, executorId)
    }

    const watch = watchInbound(submitter)
    const rejections = watchRejections()

    const paused = await executeReduce({
      tree,
      executors: executorIds,
      dispatch,
      redundancy: REDUCE_REDUNDANCY,
    })
    const reduceReturnedAt = performance.now()

    // The staging happened. Without this a run in which the wrapper never fired would
    // satisfy every assertion below by simply never losing a node.
    expect(frozen).toBe(true)

    // Nothing dispatches after this line. The resume is the last thing that happens to
    // that process before the arrival window is read.
    await resumeAgent(victim)

    const victimAsks = asked.filter((entry) => entry.executorId === victimId)
    const arrived = await waitFor(
      () => repliesFrom(watch.frames, victimId, reduceReturnedAt).length >= victimAsks.length,
      15_000,
    )
    const late = repliesFrom(watch.frames, victimId, reduceReturnedAt)
    watch.stop()

    console.log(
      `[criterion 6 / harmlessness] tree ${tree.nodes.length} combines, ` +
        `paused peer asked ${victimAsks.length}× (${victimAsks.map((a) => a.nodeId.slice(0, 8)).join(',')}), ` +
        `late replies ${late.length} at +${late.map((f) => Math.round(f.atMs - reduceReturnedAt)).join(',')}ms, ` +
        `recomputes ${paused.recomputes} against ${healthy.recomputes} unpaused`,
    )

    // ── RECEIVED ──────────────────────────────────────────────────────────────────
    // Non-zero across the window that begins when `executeReduce` returned.
    expect(arrived).toBe(true)
    expect(late.length).toBeGreaterThan(0)
    // One reply per request left outstanding — no reply this test did not provoke, and
    // none of the outstanding ones lost.
    expect(late).toHaveLength(victimAsks.length)

    // ── UNSOLICITED ───────────────────────────────────────────────────────────────
    expect(victimAsks.length).toBeGreaterThanOrEqual(1)
    // Every request the recovered peer ever received was issued before it was resumed.
    // `asked` is the complete record: the wrapper is the only thing `executeReduce`
    // dispatches through, and it cannot run after `executeReduce` returned.
    expect(asked.filter((entry) => entry.atMs > reduceReturnedAt)).toEqual([])
    expect(victimAsks.every((entry) => entry.atMs < reduceReturnedAt)).toBe(true)
    // And each of those was a distinct combine, so no request was retried at it.
    expect(new Set(victimAsks.map((entry) => entry.nodeId)).size).toBe(victimAsks.length)

    // ── DISCARDED HARMLESSLY ──────────────────────────────────────────────────────
    // (a) the aggregate is the same aggregate — a comparative reading, not a constant.
    expect(paused.ok).toBe(true)
    expect(paused.rootCid).toBe(healthyRoot)
    expect(paused.failed).toEqual([])
    // (b) the recovered peer executed nothing, and the combine it was ranked first for
    //     was executed by a peer that answered in time.
    expect(paused.executedBy.get(pausedNode.id)).not.toBe(victimId)
    expect(executorIds).toContain(paused.executedBy.get(pausedNode.id))
    expect([...paused.executedBy.values()]).not.toContain(victimId)
    // (c) the late answer did not become a replica, and no combine was recorded twice.
    expect(paused.minReplicas).toBe(REDUCE_REDUNDANCY)
    expect(paused.minReplicas).toBe(healthy.minReplicas)
    expect(paused.combines).toBe(healthy.combines)
    expect(paused.combines).toBe(tree.nodes.length)
    expect(paused.disagreements).toEqual([])
    // (d) the pause cost attempts and the unpaused run cost none — the reading that
    //     separates "this run lost a node" from "this run was ordinary".
    expect(paused.recomputes).toBeGreaterThan(healthy.recomputes)
    expect(paused.recomputes).toBeGreaterThanOrEqual(victimAsks.length)

    // ── ALIVE, AND IT WOULD HAVE ANSWERED ─────────────────────────────────────────
    // Otherwise "harmless" is indistinguishable from "the node was dead". Compared
    // against what the production combiner computes here, so answering with *something*
    // does not pass.
    const revivedTask = taskFor(tree, 0)
    const revived = await production(revivedTask, victimId)
    expect(revived).not.toBeNull()
    expect(revived?.cid.toString()).toBe(await referenceCombine(submitter.store, revivedTask))

    // ── NO UNHANDLED REJECTION ────────────────────────────────────────────────────
    // The half most easily missed. `rpc.ts` drops the late frame with a bare `return`;
    // a `throw` there surfaces here and nowhere else, because `#receive` is invoked as
    // `void this.#receive(...)` and the request that would have caught it was rejected
    // by the timeout long ago. See `watchRejections`.
    rejections.stop()
    expect(rejections.seen.map((reason) => String(reason))).toEqual([])
  }, PROCESS_TEST_TIMEOUT)
})
