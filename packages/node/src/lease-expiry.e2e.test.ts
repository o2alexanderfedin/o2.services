import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LEASE_MS } from '@o2/core'
import { DEFAULT_PROBE_TIMEOUT_MS } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * **CHURN-04** — *"Task ownership is leased and **re-dispatched on lease expiry**"*, measured
 * across real OS processes.
 *
 * ## What was missing, stated as the two facts that made it unmeasurable
 *
 * 1. **No cross-process loss in this repository had ever been an `expired` one.**
 *    `churn-agents.node.test.ts` — eight spawned `bin/agent.ts` processes, SIGKILL — filters
 *    losses on the disjunction `expired || surrendered` and records at its own `:802` that
 *    **every loss it measures is a `surrender`**. The only spec that reached `expired` through
 *    `submitJob` at all was `packages/core/src/job/submit.test.ts:1460`, on a **virtual clock**
 *    whose sole source of advancement is the module's own `sleep`. That is a proof of the
 *    branch, not of a lease expiring between processes.
 * 2. **`leaseMs` reached no production entry point.** `submitJob` built the only production
 *    `LeaseTable` with `maxGenerations` alone, so every shipped job ran at exactly
 *    `DEFAULT_LEASE_MS` = 30 000 ms. With `RENEW_AT` at two-thirds that is a 20 s renewal
 *    point against a ~60 ms cube — a factor of ~330 — so the shipped workload could not reach
 *    an expiry however long it ran.
 *
 * `JobSpec.leaseMs` and `bin/agent.ts --lease-ms` close (2). This file is (1).
 *
 * ## Why this is an `.e2e.test.ts`
 *
 * The same reason `checkpoint-coordinator.e2e.test.ts` gives: the `e2e` project runs
 * `fileParallelism: false`, and this file spawns six agent processes whose reading rests on
 * a signal landing while a dispatch is outstanding. Under the `node` project's eight-way
 * parallelism the stop would race the machine rather than the job. It also keeps
 * `slow-specs.node.test.ts`'s file table untouched — `.e2e.test.ts` is excluded from the
 * `node` project by `vitest.config.ts`.
 *
 * ## The instrument: the holder is found by its own CPU, not by a wall clock
 *
 * The hard part is not silencing a node, it is silencing **the node that is holding a
 * dispatch**, and nothing on the wire says which one that is. Two facts settle it:
 *
 * - **With `spec.admit` supplied — and `bin/agent.ts` always supplies it — a node that is
 *   already silent is never placed on at all.** `rpcAdmission` treats no answer within
 *   `DEFAULT_PROBE_TIMEOUT_MS` as a refusal, so `placeWithOffers` drops it and re-picks.
 *   Measured: stopping an executor before the offer round produced a job with **zero**
 *   expiries. The stop has to land *after* placement.
 * - **An executor running a cube burns CPU and an idle one does not.** So the holder is
 *   identified by polling both executors' own accumulated CPU time — `ps -o time=`, which on
 *   this host reports hundredths of a second — and stopping the first one to spend
 *   {@link BURN_MS} on this job. That is a measurement of the process rather than of the
 *   machine, and it is why this file does not contain a tuned `sleep`.
 *
 * A fixed delay was tried first and is not good enough: a sweep over 100/200/300/400/600/900 ms
 * produced 2, 15, 16, **0**, 11 and 5 expiries. The 0 is the whole argument — placement in this
 * fabric puts every shard on one node when both have room, and which node that is follows the
 * peer ids, which are new on every run.
 *
 * ## What is asserted, and the two comparisons it rests on
 *
 * Every arm reads the coordinator's own `leases` report off stdout: the tally by kind, and per
 * expiry the `taskId`, the `nodeId`, and `heldMs` — the interval between that generation's own
 * `granted` event and its `expired` one, on the **requestor's** clock rather than this file's.
 *
 * | comparison | arms | what it separates |
 * |---|---|---|
 * | the lease | SIGSTOP at {@link SHORT_LEASE_MS} vs at {@link LONG_LEASE_MS} | that the re-dispatch waits for *the lease* and not for something the machine chose |
 * | the signal | SIGSTOP vs SIGKILL, both at {@link SHORT_LEASE_MS} | which kind of loss each one actually produces |
 *
 * And one absolute, which is the knob's own guard: **every `heldMs` is below
 * `DEFAULT_LEASE_MS`.** A production path that ignored the supplied lease and fell back to the
 * constant would still expire, still re-dispatch and still answer — and would fail here.
 *
 * ## What this file CANNOT redden on
 *
 * - **Renewal.** A holder that is silenced cannot answer a renewal probe, so nothing here
 *   drives a lease *renewal* on a live fabric. `submit.test.ts`'s renewal pair carries that,
 *   on the virtual clock, and this file does not widen its claim. The `renewed` events that do
 *   appear in the short-lease arm belong to the shards the surviving node is chewing through.
 * - **The public Amino DHT, relays, or a browser tab.** Three Node processes on one host.
 * - **`complete`.** A re-dispatched shard is degraded, so a job that lost a holder is not
 *   `complete` even when every shard agreed. This asserts per shard, exactly as
 *   `checkpoint-coordinator.e2e.test.ts` does and for the same reason.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Long enough that a cold TypeScript strip on a loaded host is not a failure. */
const ANNOUNCE_BUDGET_MS = 90_000
/**
 * Long enough for the longest arm plus a **plant**.
 *
 * Not merely long enough for a green run: the mutation that makes the production path ignore
 * `--lease-ms` and fall back to `DEFAULT_LEASE_MS` produces a job that takes ~30 s per shard
 * generation, and a budget below that would turn a caught mutation into a timeout. A named
 * assertion failure and a hang are both red; only one of them says what is wrong.
 */
const JOB_BUDGET_MS = 180_000
const PROCESS_TEST_TIMEOUT = 600_000

/**
 * Twelve shards over two executors, and the number is squeezed from both sides.
 *
 * **The floor is the trigger's margin.** A cube measures ~60 ms, so a holder's queue is ~720 ms
 * of CPU while {@link BURN_MS} stops it after ~60 ms of it. The failure that buys against is
 * real and was observed: at eight shards, with the CPU baseline still taken before the
 * coordinator's dials, a full `e2e` sweep produced an arm where the holder had answered
 * **everything** before the poll saw it, and it failed on `expected 0 to be greater than 0` —
 * correctly, by name, and still a flake.
 *
 * **The ceiling is the survivor's queue.** Every stranded shard is re-placed on the surviving
 * node at once, and the shard at the back of that queue waits `SHARDS × cube` before it starts.
 * Past {@link SHORT_LEASE_MS}'s renewal point that node lapses its own lease — measured at
 * sixteen, three runs out of three. See {@link SHORT_LEASE_MS} for the arithmetic that pairs
 * the two constants.
 *
 * `DEFAULT_MAX_CONCURRENT_TASKS` (64) is a third bound and is nowhere near binding here.
 */
const SHARDS = 12

/** The demo colouring kernel's problem size — `checkpoint-coordinator.e2e.test.ts`'s reasoning. */
const COORDINATE_N = 300

/**
 * The short lease — sized against the **queue**, not against the clock, and the arithmetic is
 * the point rather than the number.
 *
 * When the silenced node's shards are re-placed they all land on the survivor at once, so the
 * shard at the back of that queue waits `SHARDS × cube` before it is even started. `RENEW_AT`
 * is two-thirds, so a lease shorter than that makes a **working** node miss its own renewal
 * point and lapse — which is not a test artefact but exactly what sizing a lease means, and it
 * is the failure this constant was moved for. At `SHARDS` 16 and a 1 s lease it happened on
 * three consecutive runs: the arm reported one more expiry than it had re-dispatches, because
 * a shard that lapsed on its **second** generation had no third node to go to.
 *
 * So: twelve cubes at ~60 ms is ~720 ms of queue, and the renewal point sits at 1 333 ms.
 * The margin is deliberate and this is where it is written down.
 */
const SHORT_LEASE_MS = 2_000

/**
 * The long lease, chosen so the two arms are separated by more than the probe timeout.
 *
 * A silenced holder's expiry does not land at exactly the lease: at `RENEW_AT` the requestor
 * offers it the task's own slot key and waits `DEFAULT_PROBE_TIMEOUT_MS` for an answer that
 * never comes, so `heldMs` settles at `max(lease, ⅔ × lease + probe)`. At 2 000 that is ~3 330
 * and at 6 000 it is ~6 000 — a gap far wider than either arm's spread, which is what makes
 * `min(long) > max(short)` a reading rather than a coin toss.
 */
const LONG_LEASE_MS = 6_000

/**
 * CPU an executor must have spent **since the coordinator announced** before it is silenced.
 *
 * About one cube, which is deliberately less than one: the first thing a dispatched executor
 * does is fetch the module and compile it, so a trigger at this level fires while the holder is
 * getting ready to answer rather than after it has answered several times. Everything the
 * holder has not answered is then stranded, which is the widest window this fixture can have.
 *
 * **The baseline it is measured from is taken after the coordinator's handshake, and that is
 * load-bearing rather than tidy.** `bin/agent.ts` dials every `--peer-addr` *before* it writes
 * that line — its own comment at the dial loop says so, *"the line is written after the dials,
 * so a parent knows the dial happened before it asserts anything about the dial's
 * consequences"* — and a Noise handshake is tens of milliseconds of CPU on the executor. A
 * baseline taken earlier counts that, and the trigger then fires **before placement**, which
 * silences a node the offer round has not reached yet. `rpcAdmission` refuses a silent node,
 * every shard goes to the survivor, and the arm reports zero expiries. That is the opposite
 * failure from the one {@link SHARDS} guards, and both have been observed.
 */
const BURN_MS = 60

/** stdin is piped and never written to — `orphan-leash.node.test.ts` fails a spawn that ignores it. */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/** One JSON object off an agent's stdout. Keys are read, never assumed. */
type Line = Record<string, unknown>

interface Spawned {
  readonly name: string
  readonly child: AgentProcess
  readonly handshake: Line
  readonly lines: readonly Line[]
  readonly waitFor: (match: (line: Line) => boolean, what: string) => Promise<Line>
  readonly stderr: () => string
}

let workdir: string
const spawned: Spawned[] = []

/** Spawn `bin/agent.ts`, wait for its one-line handshake, and keep reading its stdout. */
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

/**
 * SIGCONT first, then SIGTERM, then wait.
 *
 * The SIGCONT is not decoration: a process this file stopped will never see SIGTERM until it
 * is continued, so without it every stopped executor would ride the 10 s fallback into SIGKILL
 * and the teardown would cost ten seconds per arm.
 */
async function stopAgent(agent: Spawned): Promise<void> {
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

/**
 * Each process's own accumulated CPU time in milliseconds, off one `ps -o pid=,time=` call.
 *
 * **This is the file's synchronisation point**, so its parsing is strict rather than lenient at
 * both ends: an unrecognised TIME throws by name rather than returning a zero that would make
 * every poll look like an idle executor, and a pid `ps` did not report throws rather than
 * being skipped — a process that has exited is a fact this file must fail on, not poll past.
 * Darwin prints `M:SS.ss`; the pattern also accepts the `D-HH:MM:SS` and `HH:MM:SS` forms other
 * `ps` implementations use, and treats a missing fraction as zero.
 */
function cpuOf(pids: readonly number[]): readonly number[] {
  const raw = execFileSync('ps', ['-o', 'pid=,time=', '-p', pids.join(',')]).toString()
  const byPid = new Map<number, number>()
  for (const line of raw.split('\n')) {
    const row = /^\s*(\d+)\s+(\S+)\s*$/.exec(line)
    if (row === null) continue
    byPid.set(Number(row[1]), parseCpu(row[2] as string))
  }
  return pids.map((pid) => {
    const value = byPid.get(pid)
    if (value === undefined) throw new Error(`ps reported no TIME for pid ${String(pid)}: ${JSON.stringify(raw)}`)
    return value
  })
}

/** `M:SS.ss`, `HH:MM:SS` or `D-HH:MM:SS` in milliseconds. */
function parseCpu(raw: string): number {
  const parsed = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/.exec(raw)
  if (parsed === null) throw new Error(`ps printed a TIME this file cannot read: ${JSON.stringify(raw)}`)
  const [, days, hours, minutes, seconds, fraction] = parsed
  const whole =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes) * 60 +
    Number(seconds)
  return whole * 1_000 + (fraction === undefined ? 0 : Number(`0.${fraction}`) * 1_000)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The peer id an agent announced. */
function peerIdOf(agent: Spawned): string {
  const id = agent.handshake['peerId']
  if (typeof id !== 'string') throw new Error(`${agent.name} announced no peer id`)
  return id
}

function multiaddrOf(agent: Spawned): string {
  const addrs = agent.handshake['multiaddrs']
  if (!Array.isArray(addrs) || typeof addrs[0] !== 'string') {
    throw new Error(`${agent.name} announced no dialable address`)
  }
  return addrs[0]
}

/** One expiry as the coordinator reports it. */
interface Expiry {
  readonly taskId: string
  readonly nodeId: string
  readonly generation: number
  readonly heldMs: number | null
}

interface ShardRow {
  readonly partitionIndex: number
  readonly ending: string
  readonly attempted: number
  readonly status: string
  readonly resultCid: string | null
}

interface JobLine {
  readonly complete: boolean
  readonly redispatches: number
  readonly shards: readonly ShardRow[]
  readonly kinds: Readonly<Record<string, number>>
  readonly expired: readonly Expiry[]
}

function jobOf(line: Line): JobLine {
  const job = line['job'] as Record<string, unknown>
  if (job['ok'] !== true) throw new Error(`the coordinated job was refused: ${JSON.stringify(job)}`)
  const leases = job['leases'] as Record<string, unknown>
  return {
    complete: job['complete'] === true,
    redispatches: job['redispatches'] as number,
    shards: [...(job['shards'] as ShardRow[])].sort((a, b) => a.partitionIndex - b.partitionIndex),
    kinds: leases['kinds'] as Readonly<Record<string, number>>,
    expired: leases['expired'] as readonly Expiry[],
  }
}

/** What one arm produced, plus the identity of the node it silenced. */
interface Arm {
  readonly job: JobLine
  readonly silencedPeerId: string
  /** CPU the silenced executor had spent on the job at the instant it was silenced. */
  readonly burnedMs: number
  /** CPU the *surviving* executor had spent at that same instant. */
  readonly survivorMs: number
}

/**
 * One reading: stand up two executors and a coordinator, silence whichever executor is doing
 * the work, and read the coordinator's job line.
 *
 * Fresh executors per arm rather than shared ones. A continued process would carry a stopped
 * peer's half-written frames into the next arm's fabric, and an arm that inherited another
 * arm's state is not a second reading of the same fixture.
 */
async function runArm(
  tag: string,
  leaseMs: number,
  signal: 'SIGSTOP' | 'SIGKILL',
): Promise<Arm> {
  const executors = await Promise.all([spawnAgent(`${tag}-x0`, []), spawnAgent(`${tag}-x1`, [])])
  expect(new Set(executors.map(peerIdOf)).size).toBe(2)

  const coordinator = await spawnAgent(tag, [
    ...executors.flatMap((agent) => ['--peer-addr', multiaddrOf(agent)]),
    '--coordinate',
    String(SHARDS),
    '--coordinate-n',
    String(COORDINATE_N),
    '--lease-ms',
    String(leaseMs),
    '--job-store',
    join(workdir, `${tag}-job-store`),
  ])

  // **The baseline is taken here and nowhere earlier.** `spawnAgent` resolves on the
  // coordinator's handshake line, which `bin/agent.ts` writes *after* it has dialled every
  // `--peer-addr`, so every millisecond counted below is work these executors did for this
  // job rather than for a Noise handshake. See {@link BURN_MS}.
  const pids = executors.map((agent) => agent.child.pid as number)
  const baseline = cpuOf(pids)

  const startedAt = performance.now()
  let holder = -1
  let spent: readonly number[] = baseline.map(() => 0)
  for (;;) {
    // One `ps` call for both processes rather than one each: the poll interval is the
    // resolution of this instrument, and halving the syscalls halves it.
    const now = cpuOf(pids)
    spent = now.map((value, i) => value - (baseline[i] as number))
    // The **busiest** executor once any of them has crossed, not the first one in the list.
    // Placement in this fabric normally puts every shard on one node, so the two are the same
    // reading; where a job does split, `findIndex` would silence whichever happened to be at
    // index 0 and could pick the one doing less of the work.
    if (spent.some((value) => value >= BURN_MS)) {
      holder = spent.indexOf(Math.max(...spent))
      break
    }
    if (performance.now() - startedAt > JOB_BUDGET_MS) {
      throw new Error(
        `neither executor spent ${String(BURN_MS)}ms of CPU on ${tag}'s job — nothing was dispatched, so there is nothing to silence. coordinator stderr: ${coordinator.stderr()}`,
      )
    }
    await sleep(5)
  }

  const survivor = holder === 0 ? 1 : 0
  const silenced = executors[holder] as Spawned
  const burnedMs = spent[holder] as number
  const survivorMs = spent[survivor] as number
  silenced.child.kill(signal)

  const job = jobOf(await coordinator.waitFor((line) => 'job' in line, `${tag}'s job line`))
  if (signal === 'SIGSTOP') silenced.child.kill('SIGCONT')

  return { job, silencedPeerId: peerIdOf(silenced), burnedMs, survivorMs }
}

/** Every `heldMs` in an arm, with the nulls refused rather than filtered. */
function heldOf(arm: Arm): readonly number[] {
  return arm.job.expired.map((expiry) => {
    if (expiry.heldMs === null) {
      throw new Error(`task ${expiry.taskId} expired with no matching grant in the history`)
    }
    return expiry.heldMs
  })
}

/**
 * The assertions every arm shares: the lease bit, the shard came back, and it came back on the
 * lease the operator asked for rather than on the constant.
 */
function readArm(arm: Arm, leaseMs: number): void {
  // **Stated first, so an arm whose signal landed too late fails by name** instead of making
  // every reading beneath it vacuously true.
  expect(arm.job.expired.length).toBeGreaterThan(0)
  // The instrument check: the node that was silenced is the one that was doing the work.
  //
  // **Not `survivorMs < BURN_MS`, and the difference is a flake this file already carries the
  // scar of.** That form asserts the surviving node was *idle*, which is a fact about
  // placement rather than a precondition of this reading — a job whose shards split across both
  // nodes is legitimate, and silencing either of two working nodes measures the same thing.
  // What has to hold is that the trigger picked a node doing the job's work, which is these
  // two lines and nothing more.
  expect(arm.burnedMs).toBeGreaterThanOrEqual(BURN_MS)
  expect(arm.burnedMs).toBeGreaterThanOrEqual(arm.survivorMs)

  // Every expiry names the node this arm silenced. An expiry on the *surviving* node would be
  // a different fabric failure reported under this requirement's name.
  for (const expiry of arm.job.expired) {
    expect(expiry.nodeId).toBe(arm.silencedPeerId)
  }

  // ── The requirement's own words: *re-dispatched* on lease expiry, and answered ──────────
  //
  // `taskId` is the shard id, which `submitJob` sets to `String(partitionIndex)`, so an
  // expiry is joined to its shard rather than counted beside it.
  expect(arm.job.redispatches).toBeGreaterThanOrEqual(arm.job.expired.length)
  for (const expiry of arm.job.expired) {
    const shard = arm.job.shards.find((row) => row.partitionIndex === Number(expiry.taskId))
    expect(shard).toBeDefined()
    // Two nodes attempted: the one that was silenced, and the one that answered.
    expect(shard?.attempted).toBeGreaterThanOrEqual(2)
    // And the second one came **after** this expiry rather than beside it. Stated against
    // the expiry's own generation rather than as the literal `2`, so a shard that took a
    // third generation still has to show a dispatch following the lease that lapsed —
    // `attempted` counts nodes and `generation` counts dispatches of this task, so
    // `attempted > generation` is exactly "something was tried after this one lapsed".
    expect(shard?.attempted).toBeGreaterThan(expiry.generation)
    expect(shard?.ending).toBe('agreed')
    expect(shard?.status).toBe('agreed')
    expect(shard?.resultCid).not.toBeNull()
  }

  // Nothing was lost on the way: every shard of the job has an answer, including the ones the
  // surviving node held all along.
  expect(arm.job.shards).toHaveLength(SHARDS)
  for (const shard of arm.job.shards) {
    expect(shard.status).toBe('agreed')
    expect(shard.resultCid).not.toBeNull()
  }

  for (const held of heldOf(arm)) {
    // The lease was **honoured**: a shard is never taken off a node before its lease elapses.
    expect(held).toBeGreaterThanOrEqual(leaseMs)
    // ── The knob's guard ────────────────────────────────────────────────────────────────
    // The supplied lease reached the table. A production path that dropped `--lease-ms` and
    // fell back to `DEFAULT_LEASE_MS` would still expire, still re-dispatch and still answer
    // every assertion above; it fails here and only here.
    expect(held).toBeLessThan(DEFAULT_LEASE_MS)
  }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-lease-expiry-'))
})

afterEach(async () => {
  await Promise.all(spawned.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('CHURN-04 — a lease expires across real OS processes and the shard is re-dispatched', () => {
  it('re-dispatches a silenced holder\'s shards after the lease the operator asked for, and waits longer when that lease is longer', async () => {
    const short = await runArm('short', SHORT_LEASE_MS, 'SIGSTOP')
    readArm(short, SHORT_LEASE_MS)
    const long = await runArm('long', LONG_LEASE_MS, 'SIGSTOP')
    readArm(long, LONG_LEASE_MS)

    /**
     * **The comparison, and it is the whole reason two arms exist.**
     *
     * Each arm on its own shows a re-dispatch happening some milliseconds after a node went
     * quiet, and a fabric that re-dispatched on a fixed internal timer would satisfy it.
     * Taken together they say the interval *follows the lease*: every expiry in the long arm
     * waited longer than every expiry in the short one, on the same fixture, in the same run,
     * with `--lease-ms` the only thing that differs.
     */
    const shortHeld = heldOf(short)
    const longHeld = heldOf(long)
    expect(Math.min(...longHeld)).toBeGreaterThan(Math.max(...shortHeld))
    // And the gap is the lease's, not a constant offset: `heldMs` settles at
    // `max(lease, ⅔ × lease + probe)`, so raising the lease by 5 000 must move it by at least
    // the two-thirds share of that. Stated as a floor rather than an equality because the
    // probe leg is a timeout and a host may answer the last poll late, never early.
    expect(Math.min(...longHeld) - Math.max(...shortHeld)).toBeGreaterThan(
      ((LONG_LEASE_MS - SHORT_LEASE_MS) * 2) / 3 - DEFAULT_PROBE_TIMEOUT_MS,
    )
  }, PROCESS_TEST_TIMEOUT)

  it('reports what each signal actually produces — a stopped holder and a killed one are both an expiry on this fabric, and the killed one is faster', async () => {
    /**
     * **This case exists because the obvious answer is wrong, and it was measured rather than
     * assumed.**
     *
     * `churn-agents.node.test.ts:795-806` records that every cross-process loss it sees is a
     * `surrender`, on the ground that *"a SIGKILLed process's socket closes, so
     * `RemoteExecutor.execute` comes back … well inside `RPC_TIMEOUT_MS`"*. That file's own
     * `RPC_TIMEOUT_MS` is 10 000 against a 30 000 ms lease, so what reports there is the RPC
     * budget, and the surrender follows from that ordering rather than from the signal.
     *
     * Measured here at `--lease-ms 1000`, with the lease *below* the RPC budget instead of
     * above it: **SIGKILL produces `expired`, not `surrendered`** — the outstanding dispatch
     * does not come back at all inside the lease. So the note's own prediction is confirmed in
     * the direction it named (*"an `rpcTimeoutMs` above the lease"*), reached from the other
     * side, and the belief that the signal decides the kind is not.
     *
     * What the signal *does* decide is measured too, and it is the renewal probe rather than
     * the dispatch. A stopped process holds its socket open, so the probe at `RENEW_AT` waits
     * the full `DEFAULT_PROBE_TIMEOUT_MS` for an answer that never comes; a killed one's
     * socket is closed, so the same probe fails at once. `heldMs` therefore lands near
     * `⅔ × lease + probe` for SIGSTOP and near the lease itself for SIGKILL — which is why
     * SIGSTOP is the honest instrument for *silence*, and why this file uses it everywhere
     * else.
     */
    const stopped = await runArm('stopped', SHORT_LEASE_MS, 'SIGSTOP')
    readArm(stopped, SHORT_LEASE_MS)
    const killed = await runArm('killed', SHORT_LEASE_MS, 'SIGKILL')
    readArm(killed, SHORT_LEASE_MS)

    // It really was killed: SIGKILL runs no handler, so this is the process saying it was
    // killed rather than that it chose to leave.
    expect(killed.job.expired.length).toBeGreaterThan(0)
    // No loss on this fabric was reported as a surrender in either arm. Recorded as an
    // assertion rather than as a sentence, so the day the transport starts propagating a
    // closed socket into an outstanding request this file says so instead of the comment
    // quietly going stale.
    expect(stopped.job.kinds['surrendered']).toBeUndefined()
    expect(killed.job.kinds['surrendered']).toBeUndefined()

    // The probe, not the dispatch, is what the signal changes: every killed-arm expiry landed
    // sooner than every stopped-arm one, at the same lease.
    expect(Math.max(...heldOf(killed))).toBeLessThan(Math.min(...heldOf(stopped)))
  }, PROCESS_TEST_TIMEOUT)
})
