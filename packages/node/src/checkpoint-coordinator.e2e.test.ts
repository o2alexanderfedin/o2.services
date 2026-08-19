import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { readCheckpoint } from '@o2/core'
import { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * **CHURN-03 / ROADMAP Phase 20 criterion 7** — *a coordinator writes a checkpoint during a
 * live job run **through `bin/agent.ts`**, and a SECOND requestor — given nothing but that
 * checkpoint's CID — finishes only the outstanding shards and returns the same answer the
 * first would have.*
 *
 * ## What is new here, against the file that already covers the mechanism
 *
 * `checkpoint-agents.node.test.ts` proves the *mechanism* and states, correctly, the
 * substitution it had to take: **`bin/agent.ts` submitted no job**, so a criterion phrased
 * *"through `bin/agent.ts`"* was satisfiable only as *"a job run **across** `bin/agent.ts`
 * processes"* — an in-process requestor dispatching to spawned agents.
 * `20-VERIFICATION.md` scored criterion 7 PARTIAL on exactly that difference, and the gap it
 * named was the criterion's **subject**: *"the only coordinator in this repository that
 * writes a checkpoint is a test's."*
 *
 * This file removes the substitution. **Every requestor here is a spawned `bin/agent.ts`
 * process.** Nothing in this file submits a job, holds a `JobSpec`, wraps an `Executor` or
 * touches a `CheckpointSink`; it spawns processes, reads their stdout, and reads one block
 * off a directory. The reason that matters is the reason the criterion was written: a
 * capability reachable from no runnable entry point is the defect this milestone exists to
 * remove, and the difference between "a test can do it" and "a command line can do it" is
 * the whole of the finding.
 *
 * ## Why this is an `.e2e.test.ts` and not a `.node.test.ts`
 *
 * The `e2e` project runs `fileParallelism: false` (see `vitest.config.ts`), and this file
 * spawns five agent processes that dispatch WASM work to each other. Under the `node`
 * project's eight-way parallelism the departure below races the machine rather than the job:
 * the whole reading rests on a SIGKILL landing between two checkpoints roughly 60 ms apart,
 * and a spec sharing a host with seven others cannot promise that. Serialising costs
 * wall-clock and buys the margin the reading needs.
 *
 * ## The five processes, and what each one is for
 *
 * | process | `--dir` | `--job-store` | role |
 * |---|---|---|---|
 * | `a0`, `a1` | own | — | executors. Serve blocks and run cubes. Never killed. |
 * | `control` | own | `control` | runs the job start to finish. The answer everything is compared against, and the instrument check. |
 * | `departed` | own | **shared** | writes checkpoints, then takes SIGKILL mid-job. |
 * | `resumed` | own | **shared** | given the departed process's newest handle and nothing else. |
 * | `restarted` | own | **shared** | the same command line **without** `--resume-from`. |
 *
 * **`--dir` is per-process and `--job-store` is what is shared, and the split is the point.**
 * `--dir` holds this node's identity seed, so two processes pointed at one `--dir` are one
 * peer id wearing two processes — a weaker claim than *"a SECOND requestor"*. What crosses
 * from the departed process to the resumed one is a directory of content-addressed blocks and
 * **one CID**, and the peer ids are asserted to differ.
 *
 * ## The load-bearing reading, and why `restarted` exists
 *
 * A resume and a restart produce the **same answer**, so no assertion about the answer can
 * tell them apart — `checkpoint-agents.node.test.ts` says this and it is still true. Across
 * real processes there is no seam in which to wrap a counting `Executor`, so the count is read
 * off `submitJob`'s **own** record of which nodes it attempted, published on the coordinator's
 * stdout as `attempted`. That is one instrument, so it is not left alone:
 *
 * 1. The **checkpoint block is read off disk by this file**, from the CID alone, through
 *    `readCheckpoint` — the same validating reader a resume uses. That is an artefact written
 *    by the departed process, read by neither coordinator, and it is what says which
 *    partitions were answered before the kill.
 * 2. The **resumed process's own `remaining`** — computed by `remainingWork` inside
 *    `bin/agent.ts` *before* the job runs — must equal the complement of that set.
 * 3. The **`restarted` process is the same command line minus one flag**, over the same store
 *    and the same fabric, in the same run. It attempts every shard. The difference between
 *    arms 2 and 3 is `--resume-from` and nothing else, which is what makes "finished only the
 *    outstanding shards" a measurement rather than a reading of one number.
 *
 * ## What this file CANNOT redden on
 *
 * - **A checkpoint the store never kept.** `checkpointsInto` reads each handle's block back
 *   before the coordinator prints it, so a handle on stdout is already durable. A store that
 *   silently dropped blocks would print `confirmed: false` and this file asserts against that
 *   — but it cannot distinguish a store that keeps everything from one that keeps everything
 *   it is asked for and would have dropped the next one.
 * - **A departed requestor whose disk is also gone.** The wire has a `block` request that
 *   *pulls* and nothing that pushes or provides, so nothing puts a requestor's checkpoint onto
 *   a peer. `checkpoint-agents.node.test.ts` measured this and it is unchanged; the hand-off
 *   here is staged on a shared directory for exactly that reason.
 * - **Lease renewal.** `DEFAULT_LEASE_MS` is 30 s and `RENEW_AT` is two-thirds of it, so a
 *   cube that takes ~60 ms never approaches a renewal. The coordinator supplies `admit`, which
 *   is the *channel* renewal takes its evidence from, and this file witnesses the precondition
 *   and not the renewal. CHURN-04's row says so and this file does not widen it.
 * - **Redundancy, speculation and churn.** This leg runs at redundancy 1 and kills no
 *   executor. Criteria 2, 3 and 5 are other files'.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Long enough that a cold TypeScript strip on a loaded host is not a failure. */
const ANNOUNCE_BUDGET_MS = 90_000
/** Long enough for sixteen cubes over two executors, with the same slack. */
const JOB_BUDGET_MS = 180_000
const PROCESS_TEST_TIMEOUT = 600_000

/**
 * Sixteen shards over **two** executors, and both numbers are chosen for the departure.
 *
 * The kill lands on the first checkpoint line. What has to be true at that instant is that a
 * real remainder is still outstanding, so the fabric must be narrow enough that the job cannot
 * have finished: two executors at redundancy 1 answer at most two cubes at a time, and a cube
 * at `--coordinate-n 300` measured ~60 ms on this host, so sixteen shards take ~950 ms end to
 * end against a kill that lands in tens of milliseconds.
 *
 * It is still a race, and it is not left to be discovered as a flake: the assertion below is
 * `0 < carried < SHARDS` **stated first**, so a departure that caught the whole job fails by
 * name instead of silently making every reading beneath it vacuous.
 */
const SHARDS = 16
const EXECUTORS = 2

/**
 * Publish this many checkpoints, then kill the coordinator.
 *
 * **Not 1, and the reason is the strength of the reading rather than the safety of the race.**
 * A departure caught on the first checkpoint leaves a carried set of one, and "finishes only
 * the outstanding shards" over a single carried shard is a thinner statement than the
 * criterion makes. Six of sixteen leaves a real remainder on both sides.
 *
 * The kill is still bounded away from the end of the job by measurement rather than by hope:
 * checkpoints arrive 30–60 ms apart on this host and ten remain after the sixth, so the
 * process has ~300 ms of work left when the signal is sent. `0 < carried < SHARDS` is asserted
 * before anything rests on it, so a departure that caught the whole job fails by name.
 */
const DEPART_AFTER = 6

/**
 * The problem size, and it is 300 because 300 is the size whose **answers differ per shard**.
 *
 * Measured on this host across 300/350/400/450/600: at 400 and above almost every cube
 * exhausts `DEFAULT_BUDGET` and returns the identical "not found" partial, so every shard's
 * `resultCid` is the same string and the per-shard answer equality below would hold no matter
 * which shard ran which partition. At 300 the CIDs are mostly distinct, which is what makes
 * the comparison against the control a reading. It is also the first rung of the demo's own
 * ladder.
 */
const COORDINATE_N = 300

/**
 * stdin is piped and never written to — `bin/agent.ts` watches fd 0 and leaves when it closes,
 * which is what stops a spawned agent outliving a parent that was killed rather than asked.
 * `orphan-leash.node.test.ts` fails any spawn site that hands it `ignore`.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/** One JSON object off a coordinator's stdout. Keys are read, never assumed. */
type Line = Record<string, unknown>

interface Spawned {
  readonly name: string
  readonly child: AgentProcess
  readonly handshake: Line
  /** Every line after the handshake, in the order the process wrote them. */
  readonly lines: readonly Line[]
  /** Resolve with the first line satisfying `match`, including ones already read. */
  readonly waitFor: (match: (line: Line) => boolean, what: string) => Promise<Line>
  readonly stderr: () => string
}

let workdir: string
const spawned: Spawned[] = []

/**
 * Spawn `bin/agent.ts`, wait for its one-line handshake, and keep reading its stdout.
 *
 * The reader is installed **before** the handshake resolves and is never detached, because a
 * coordinator writes its checkpoint lines within milliseconds of announcing and a reader
 * attached afterwards would miss the first of them — which is the one this file kills on.
 */
async function spawnAgent(name: string, args: readonly string[]): Promise<Spawned> {
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', join(workdir, name), ...args],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  const lines: Line[] = []
  const waiters: { match: (line: Line) => boolean; resolve: (line: Line) => void }[] = []
  let stderr = ''
  let buffer = ''
  let handshake: Line | null = null
  let announce: (line: Line) => void = () => {}
  let announceFailed: (cause: Error) => void = () => {}
  const announced = new Promise<Line>((resolve, reject) => {
    announce = resolve
    announceFailed = reject
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const text = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let line: Line
      try {
        line = JSON.parse(text) as Line
      } catch (cause) {
        announceFailed(
          new Error(`${name} wrote a stdout line that is not JSON: ${text} (${String(cause)})`),
        )
        return
      }
      if (handshake === null) {
        handshake = line
        announce(line)
        continue
      }
      lines.push(line)
      // Spliced rather than filtered, so a waiter cannot fire twice on two lines that both
      // match — the caller asked for the first.
      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i]
        if (waiter !== undefined && waiter.match(line)) {
          waiters.splice(i, 1)
          waiter.resolve(line)
        }
      }
    }
  })
  child.on('exit', (code, signal) => {
    announceFailed(
      new Error(`${name} exited early with ${String(code)}/${String(signal)}: ${stderr}`),
    )
  })

  const timer = setTimeout(
    () => announceFailed(new Error(`${name} did not announce in time: ${stderr}`)),
    ANNOUNCE_BUDGET_MS,
  )
  const line = await announced.finally(() => clearTimeout(timer))

  const agent: Spawned = {
    name,
    child,
    handshake: line,
    lines,
    stderr: (): string => stderr,
    waitFor: (match: (l: Line) => boolean, what: string): Promise<Line> => {
      const already = lines.find(match)
      if (already !== undefined) return Promise.resolve(already)
      return new Promise<Line>((resolve, reject) => {
        const budget = setTimeout(
          () => reject(new Error(`${name} never wrote ${what} — stderr: ${stderr}`)),
          JOB_BUDGET_MS,
        )
        waiters.push({
          match,
          resolve: (l: Line): void => {
            clearTimeout(budget)
            resolve(l)
          },
        })
      })
    },
  }
  spawned.push(agent)
  return agent
}

/** SIGTERM, then wait for the process to actually be gone. Copied from `churn-agents`. */
async function stopAgent(agent: Spawned): Promise<void> {
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

/** SIGKILL, then wait for the process to be gone. This is the departure. */
async function killAgent(agent: Spawned): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    agent.child.on('exit', () => resolve())
    agent.child.kill('SIGKILL')
  })
}

/**
 * How many shards a published checkpoint answers, read off the line itself.
 *
 * Off `completed.length` and not off the number of lines seen: a checkpoint names *every*
 * shard answered so far, including the ones a resume carried into this run, so the block's own
 * count is what says how far the job has got. Counting lines would say how far *this process*
 * has got, which is a different number the moment a resume is involved.
 */
function countOf(line: Line): number {
  const completed = line['completed']
  return Array.isArray(completed) ? completed.length : 0
}

function multiaddrOf(agent: Spawned): string {
  const addrs = agent.handshake['multiaddrs']
  if (!Array.isArray(addrs) || typeof addrs[0] !== 'string') {
    throw new Error(`${agent.name} announced no dialable address`)
  }
  return addrs[0]
}

function peerIdOf(agent: Spawned): string {
  const id = agent.handshake['peerId']
  if (typeof id !== 'string') throw new Error(`${agent.name} announced no peer id`)
  return id
}

/** The per-shard rows off a coordinator's `job` line, sorted by partition. */
interface ShardRow {
  readonly partitionIndex: number
  readonly ending: string
  readonly attempted: number
  readonly status: string
  readonly resultCid: string | null
}

function jobOf(line: Line): {
  readonly complete: boolean
  readonly redispatches: number
  readonly shards: readonly ShardRow[]
  readonly confirmed: readonly string[]
  readonly chain: number
} {
  const job = line['job'] as Record<string, unknown>
  if (job['ok'] !== true) throw new Error(`the coordinated job was refused: ${JSON.stringify(job)}`)
  const checkpoints = job['checkpoints'] as Record<string, unknown>
  return {
    complete: job['complete'] === true,
    redispatches: job['redispatches'] as number,
    shards: [...(job['shards'] as ShardRow[])].sort((a, b) => a.partitionIndex - b.partitionIndex),
    confirmed: checkpoints['confirmed'] as readonly string[],
    chain: checkpoints['chain'] as number,
  }
}

/**
 * Every shard of this job answered — read per shard, and **not** off `JobResult.complete`.
 *
 * **`complete` is unavailable to the resumed arm by construction, and the source says so
 * against its own interest.** `submit.ts`'s `'carried-from-checkpoint'` doc: *"The shard's
 * verification is `agreed` at `replicas: 0` — this requestor obtained no replica of its own —
 * which is also why such a shard is degraded and why a resumed job is never complete."*
 * Measured here rather than taken from the comment: the resumed arm reports
 * `complete: false` with `redispatches: 0` and every shard agreed.
 *
 * A second, independent reason it is the wrong reading for the control and restart arms: a
 * re-dispatch also degrades a shard, and a re-dispatch is an ordinary event on a two-node
 * fabric — the first run of this file recorded `attempted [.,.,.,.,.,2,…]` with every shard
 * agreed. That is criterion **2**'s subject, not criterion 7's.
 *
 * So what is asserted is the thing criterion 7 actually names: every partition has an agreed
 * answer with a CID.
 */
function everyShardAnswered(rows: readonly ShardRow[]): void {
  expect(rows).toHaveLength(SHARDS)
  expect(rows.map((shard) => shard.partitionIndex)).toEqual(
    Array.from({ length: SHARDS }, (_, i) => i),
  )
  for (const shard of rows) {
    expect(shard.status).toBe('agreed')
    expect(shard.resultCid).not.toBeNull()
  }
}

/** The argv a coordinator takes. Everything but `--dir`, which `spawnAgent` supplies. */
function coordinatorArgs(
  jobStore: string,
  executors: readonly Spawned[],
  resumeFrom?: string,
): readonly string[] {
  return [
    ...executors.flatMap((agent) => ['--peer-addr', multiaddrOf(agent)]),
    '--coordinate',
    String(SHARDS),
    '--coordinate-n',
    String(COORDINATE_N),
    '--job-store',
    jobStore,
    ...(resumeFrom === undefined ? [] : ['--resume-from', resumeFrom]),
  ]
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-checkpoint-coordinator-'))
})

afterEach(async () => {
  await Promise.all(spawned.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('criterion 7 — a coordinator through bin/agent.ts checkpoints, departs, and a second process finishes from the CID', () => {
  it('writes checkpoints from a live run, hands off on one CID to a different peer id that runs only the outstanding shards, and matches an uninterrupted control per shard', async () => {
    const startedAt = performance.now()
    const executors = await Promise.all(
      Array.from({ length: EXECUTORS }, (_, i) => spawnAgent(`a${String(i)}`, [])),
    )
    const standUpMs = performance.now() - startedAt

    // A precondition of the harness rather than of the fabric.
    expect(new Set(executors.map(peerIdOf)).size).toBe(EXECUTORS)

    // ---- The control: one coordinator process, start to finish, nobody departs. -------
    const controlStore = join(workdir, 'control-job-store')
    const controlAt = performance.now()
    const control = await spawnAgent('control', coordinatorArgs(controlStore, executors))
    const controlJob = jobOf(
      await control.waitFor((line) => 'job' in line, 'its job line (control)'),
    )
    const controlMs = performance.now() - controlAt

    // **The instrument check, and everything below is unattributable without it.** A control
    // that left shards unrun would make "the resume ran only the outstanding ones" true of a
    // job that ran nothing.
    everyShardAnswered(controlJob.shards)
    for (const shard of controlJob.shards) {
      expect(shard.ending).toBe('agreed')
      expect(shard.attempted).toBeGreaterThanOrEqual(1)
    }
    // A checkpoint per answered shard, every one of them read back out of the store before it
    // was printed — this is criterion 7's **first clause**, measured on a process an operator
    // starts from a command line.
    expect(controlJob.confirmed).toHaveLength(SHARDS)
    expect(controlJob.chain).toBe(SHARDS)
    // The control ran at `COORDINATE_N`'s stated purpose: distinct answers per shard exist, so
    // the equality below is a comparison and not a tautology. Not `=== SHARDS`: cubes that
    // exhaust the budget legitimately agree on the same "not found" partial.
    const controlCids = controlJob.shards.map((shard) => shard.resultCid)
    expect(new Set(controlCids).size).toBeGreaterThan(1)

    // ---- The departure: a coordinator killed on its first published checkpoint. -------
    //
    // The shared store — the only thing besides one CID that crosses to the second requestor.
    const sharedStore = join(workdir, 'shared-job-store')
    const departedAt = performance.now()
    const departed = await spawnAgent('departed', coordinatorArgs(sharedStore, executors))
    await departed.waitFor(
      (line) => 'checkpoint' in line && countOf(line) >= DEPART_AFTER,
      `${String(DEPART_AFTER)} checkpoint lines`,
    )
    await killAgent(departed)
    const departedMs = performance.now() - departedAt

    // It really departed: SIGKILL runs no handler, so `signalCode` is the process saying it
    // was killed rather than that it chose to leave.
    expect(departed.child.signalCode).toBe('SIGKILL')
    expect(departed.child.exitCode).toBeNull()
    // And it never reached its own job line — a departed requestor is precisely one that does
    // not get a `JobResult`.
    expect(departed.lines.filter((line) => 'job' in line)).toEqual([])

    const published = departed.lines.filter(
      (line) => 'checkpoint' in line && line['confirmed'] === true,
    )
    expect(published.length).toBeGreaterThanOrEqual(1)
    const handle = published[published.length - 1]?.['checkpoint']
    if (typeof handle !== 'string') throw new Error('the departed coordinator published no handle')

    // ---- What the block itself says, read off the directory by this file. -------------
    //
    // **The independent artefact.** Neither coordinator's report is consulted here: this is
    // the block the departed process wrote, addressed by the CID it printed, decoded through
    // the same validating reader `resumeState` uses. If the two disagree, this is the one that
    // is true.
    const read = await readCheckpoint(CID.parse(handle), await FsBlockstore.open(sharedStore))
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error(`the published handle did not read back: ${read.reason}`)
    const carried = read.checkpoint.completed
      .map((shard) => shard.partitionIndex)
      .sort((a, b) => a - b)
    const outstanding = Array.from({ length: SHARDS }, (_, i) => i).filter(
      (i) => !carried.includes(i),
    )

    // **Stated before anything rests on it.** A departure that caught the whole job would make
    // every reading below vacuously true, so it fails by name here instead.
    expect(carried.length).toBeGreaterThan(0)
    expect(carried.length).toBeLessThan(SHARDS)
    expect(read.checkpoint.partitionCount).toBe(SHARDS)

    // ---- The second requestor: a new process, a different peer id, and one CID. -------
    const resumedAt = performance.now()
    const resumed = await spawnAgent('resumed', coordinatorArgs(sharedStore, executors, handle))
    expect(peerIdOf(resumed)).not.toBe(peerIdOf(departed))

    // What `bin/agent.ts` said about the handle **before** running anything, via
    // `remainingWork` — the first production caller that module has had.
    const offered = (
      await resumed.waitFor((line) => 'coordinating' in line, 'its coordinating line')
    )['coordinating'] as Record<string, unknown>
    expect(offered['resumeFrom']).toEqual([handle])
    const recovered = offered['recovered'] as Record<string, unknown>
    expect(recovered['from']).toBe(handle)
    expect(recovered['skipped']).toBe(0)
    expect(recovered['carried']).toEqual(carried)
    expect(recovered['remaining']).toEqual(outstanding)

    const resumedJob = jobOf(await resumed.waitFor((line) => 'job' in line, 'its job line'))
    const resumedMs = performance.now() - resumedAt

    // ---- The restart arm: the same command line, minus `--resume-from`. ---------------
    const restartedAt = performance.now()
    const restarted = await spawnAgent('restarted', coordinatorArgs(sharedStore, executors))
    const restartedJob = jobOf(
      await restarted.waitFor((line) => 'job' in line, 'its job line (restarted)'),
    )
    const restartedMs = performance.now() - restartedAt

    console.log(
      `[criterion 7 / coordinator] standUp ${standUpMs.toFixed(0)}ms for ${String(EXECUTORS)} agents, ` +
        `control ${controlMs.toFixed(0)}ms, departed ${departedMs.toFixed(0)}ms, ` +
        `resumed ${resumedMs.toFixed(0)}ms, restarted ${restartedMs.toFixed(0)}ms;\n` +
        `  the checkpoint named [${carried.join(',')}] and left [${outstanding.join(',')}];\n` +
        `  attempted per partition — control [${controlJob.shards.map((s) => s.attempted).join(',')}], ` +
        `resumed [${resumedJob.shards.map((s) => s.attempted).join(',')}], ` +
        `restarted [${restartedJob.shards.map((s) => s.attempted).join(',')}];\n` +
        `  resumed endings [${resumedJob.shards.map((s) => s.ending).join(',')}];\n` +
        `  chain — departed published ${String(published.length)}, resumed reports ${String(resumedJob.chain)};\n` +
        `  complete/redispatches — control ${String(controlJob.complete)}/${String(controlJob.redispatches)}, ` +
        `resumed ${String(resumedJob.complete)}/${String(resumedJob.redispatches)}, ` +
        `restarted ${String(restartedJob.complete)}/${String(restartedJob.redispatches)}`,
    )

    // **The load-bearing reading.** For every partition the checkpoint names, this second
    // process attempted it ZERO times and says so by name; for every partition it does not
    // name, this process ran it.
    everyShardAnswered(resumedJob.shards)
    for (const shard of resumedJob.shards) {
      if (carried.includes(shard.partitionIndex)) {
        expect(shard.ending).toBe('carried-from-checkpoint')
        expect(shard.attempted).toBe(0)
      } else {
        expect(shard.ending).toBe('agreed')
        expect(shard.attempted).toBeGreaterThanOrEqual(1)
      }
    }

    // **The same answer the first would have**, per shard, against a control run over the same
    // fabric in the same run — never a pinned literal.
    expect(resumedJob.shards.map((shard) => shard.resultCid)).toEqual(controlCids)

    // **The chain crosses the hand-off.** `checkpointLogOf` seeds this run's first checkpoint
    // with the handle it resumed from as its `previous`, so walking back from the resumed
    // process's newest handle reaches the departed process's history. A restart cannot produce
    // this: its chain is only as long as its own publishes.
    expect(resumedJob.confirmed).toHaveLength(outstanding.length)
    expect(resumedJob.chain).toBeGreaterThan(resumedJob.confirmed.length)
    expect(resumedJob.chain).toBe(SHARDS)

    // **The arm that makes "only the outstanding shards" a measurement.** One flag differs.
    everyShardAnswered(restartedJob.shards)
    expect(restartedJob.shards.filter((s) => s.ending === 'carried-from-checkpoint')).toEqual([])
    for (const shard of restartedJob.shards) expect(shard.attempted).toBeGreaterThanOrEqual(1)
    expect(restartedJob.shards.map((shard) => shard.resultCid)).toEqual(controlCids)
    // And it is strictly more work than the resume did, counted the same way in the same run.
    const worked = (rows: readonly ShardRow[]): number =>
      rows.reduce((total, shard) => total + shard.attempted, 0)
    expect(worked(resumedJob.shards)).toBeLessThan(worked(restartedJob.shards))
  }, PROCESS_TEST_TIMEOUT)

  it('refuses a --resume-from that is not a CID at the command line, and one that is not this job’s checkpoint on the production path', async () => {
    const executors = await Promise.all(
      Array.from({ length: 1 }, (_, i) => spawnAgent(`b${String(i)}`, [])),
    )
    const jobStore = join(workdir, 'refusal-job-store')

    // ---- A malformed handle never reaches the fabric. --------------------------------
    //
    // Exit 2 **with the usage line**, which is this binary's one word for "your command line
    // is wrong". Read as a completed process rather than as a promise that a node did not
    // start: a started node holds a socket and a worker thread, so the distinction matters.
    const malformed = spawn(
      process.execPath,
      [
        AGENT,
        '--dir',
        join(workdir, 'malformed'),
        ...coordinatorArgs(jobStore, executors, 'not-a-cid'),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let malformedErr = ''
    malformed.stderr.on('data', (chunk: Buffer) => {
      malformedErr += chunk.toString()
    })
    const code = await new Promise<number | null>((resolve) => {
      malformed.on('exit', (exit) => resolve(exit))
    })
    expect(code).toBe(2)
    expect(malformedErr).toContain('--resume-from not-a-cid is not a CID')
    expect(malformedErr).toContain('usage: agent.ts')

    // ---- A well-formed CID that is not this job's checkpoint is refused by name. ------
    //
    // The module block's own CID: a real block, in the store, that decodes to something that
    // is not a checkpoint. This is the production refusal path (`checkpoint-unreadable`) and
    // the process reports it rather than running the job.
    const store = await FsBlockstore.open(jobStore)
    const notACheckpoint = await store.put(new Uint8Array([1, 2, 3, 4, 5]))
    const refusing = await spawnAgent(
      'refusing',
      coordinatorArgs(jobStore, executors, notACheckpoint.toString()),
    )
    const line = await refusing.waitFor((l) => 'job' in l, 'its job line (refusal)')
    const job = line['job'] as Record<string, unknown>
    expect(job['ok']).toBe(false)
    expect((job['error'] as Record<string, unknown>)['kind']).toBe('checkpoint-unreadable')
    // Nothing ran: a refused resume does not half-run the job.
    expect(refusing.lines.filter((l) => 'checkpoint' in l)).toEqual([])
  }, PROCESS_TEST_TIMEOUT)
})
