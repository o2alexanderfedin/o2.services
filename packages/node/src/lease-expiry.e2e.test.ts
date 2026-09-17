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
 *
 * **Both bounds above were derived against a single-threaded executor and one of them did not
 * survive the worker pool.** See {@link COORDINATE_N}: the floor is a *wall-clock* window and
 * a pool divides it by the thread count, while the ceiling — the survivor's queue against its
 * own renewal point — is divided by the same number and so did not move. Raising this
 * constant to compensate was tried and exhausts the fabric; the cube's cost was raised
 * instead.
 */
const SHARDS = 12

/**
 * The demo colouring kernel's problem size — and since 2026-09-05 it is **this fixture's
 * trigger margin**, not merely a workload size copied from `checkpoint-coordinator`.
 *
 * ## What broke, measured
 *
 * `WorkerExecutor` posted to exactly ONE worker when this file was written on 2026-08-18. On
 * 2026-08-28 it became a pool sized by the host's cores. Every number in {@link SHARDS} and
 * {@link BURN_MS} was derived against the single-threaded executor, and the pool invalidated
 * the one that matters: **the holder's queue is no longer `SHARDS x cube` of wall time, it is
 * `SHARDS / threads x cube`.** At twelve shards on eight threads that is two waves — about a
 * tenth of a second — and the trigger cannot land inside it.
 *
 * It failed as `expected 0 to be greater than 0`, which said nothing. With the tally and the
 * CPU reading added to that assertion it says everything: `{"granted":12,"completed":12}` —
 * every shard granted once and answered, nothing lost — **with the silenced executor holding
 * 1290, 1350 and 1440 ms of CPU at the instant it was signalled, against a {@link BURN_MS} of
 * 60**. The poll was not merely late; it was twenty-odd times late, because sixteen compute
 * threads across two executors leave the polling process no core to fork `ps` on.
 *
 * ## The reading, and it is comparative rather than absolute
 *
 * | shard cost | runs | green |
 * |---|---|---|
 * | 300 | 6, across `develop` and the branch | **2** |
 * | 900 | 7 | **7** |
 *
 * Same host, same day, same fixture, one constant differing. The wall clock barely moved —
 * 23.2 to 23.9 s across the seven, against about 20 s for the runs that failed — because a
 * dearer cube costs the survivor the same parallelism it costs the holder.
 *
 * **And the cause was flip-tested rather than inferred.** With `hostCoreCount` forced to
 * return 1 — the pool as it stood before 2026-08-28, nothing else changed — the unmodified
 * fixture passed 3 of 3.
 *
 * ## Two levers that were tried and are wrong, so nobody spends the runs again
 *
 * - **`--max-concurrent-tasks 1` on each executor.** Serialises the holder, and the trigger
 *   then fires honestly at 70 and 110 ms of CPU. But it also throttles the coordinator: the
 *   job reported `{"granted":2,"completed":2}` and stalled, 3 runs of 3. It bounds admission,
 *   which is not the same question as how many threads drain what was admitted.
 * - **{@link SHARDS} scaled by the pool, twelve per thread.** Restores the wall-clock queue
 *   exactly, and 96 shards over two nodes with one of them silenced exhausts the fabric:
 *   `expected 'no-untried-node' to be 'agreed'`. That constant's stated ceiling is real and
 *   the pool did not move it.
 *
 * Raising the cube's cost is the lever that moves the floor without touching the ceiling.
 *
 * ## What this absolute was sited against
 *
 * This file prefers a comparative reading, so the conditions are recorded beside the number:
 * **eight cores, two executors, sixteen compute threads.** A host with many more cores
 * narrows the window again by the same arithmetic, and the failure will then say so in the
 * words above rather than as a bare zero.
 */
const COORDINATE_N = 900

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
 * Attempts allowed to land a signal inside the job. See {@link armWithLoss}.
 *
 * **APPLIED TO ALL FOUR ARMS ON 2026-09-15, having been applied to one.** `armWithLoss` was
 * written for the `killed` arm and the other three kept calling {@link runArm} bare, though
 * every one of them depends on the same thing happening: a signal landing while the holder
 * still holds shards. On 2026-09-15 a full `e2e` lane on a quiet host failed `short` and
 * `stopped` on exactly that, one after the other -- `{granted 12, renewed 11, completed 12}`
 * with 130 ms of CPU burned, and `{granted 12, completed 12, renewed 4}` with 3 350 ms.
 * Twelve granted, twelve completed, no loss of either kind: the job was over before the
 * signal arrived.
 *
 * The window this has to hit is small and getting smaller -- a shard here is a few tens of
 * milliseconds of work, and anything that makes execution faster narrows it again. That is
 * why the remedy is a retry rather than a wider margin: `armWithLoss` throws with every
 * attempt's tally when it cannot arrange the experiment, so a fixture that has genuinely
 * run out of window says so in those words instead of presenting as a fabric defect.
 */
const ARM_ATTEMPTS = 3

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
  /**
   * Leases given back on an observed hard failure rather than run out. Same shape as
   * {@link JobLine.expired} and, for this file's purposes, the same fact: a lease the silenced
   * holder lost. Which of the two a loss becomes is a race — see the case docblock.
   */
  readonly surrendered: readonly Expiry[]
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
    surrendered: leases['surrendered'] as readonly Expiry[],
  }
}

/** What one arm produced, plus the identity of the node it silenced. */
interface Arm {
  /** The arm's own label, so a failure names WHICH arm rather than only what it expected. */
  readonly name: string
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

  return { name: tag, job, silencedPeerId: peerIdOf(silenced), burnedMs, survivorMs }
}

/** Every `heldMs` in an arm, with the nulls refused rather than filtered. */
/**
 * Every lease this arm's silenced holder lost, of either kind.
 *
 * **Both kinds, and reading only one is how an assertion went blind.** `heldOf` read
 * `expired` alone. On a run where the killed holder's closed socket returned every
 * outstanding dispatch inside the lease, `expired` was empty, so `heldOf` returned `[]`,
 * `Math.max(...[])` is `-Infinity`, and the assertion that the killed arm is faster passed
 * having looked at nothing. A surrender is a loss whose lease was held for a measurable time
 * exactly as an expiry is, so it belongs in the same list.
 */
function lossesOf(arm: Arm): readonly Expiry[] {
  return [...arm.job.expired, ...arm.job.surrendered]
}

function heldMsOf(losses: readonly Expiry[]): readonly number[] {
  return losses.map((expiry) => {
    if (expiry.heldMs === null) {
      throw new Error(`task ${expiry.taskId} lost a lease with no matching grant in the history`)
    }
    return expiry.heldMs
  })
}

/**
 * How long each lease was held, over losses of BOTH kinds.
 *
 * This is the set for comparing what two SIGNALS cost, because the kinds are precisely what
 * differ: a killed holder closes its socket and surrenders in milliseconds, a stopped one goes
 * quiet and its lease has to run out. Excluding surrenders here would empty the killed arm and
 * leave `Math.max(...[])` returning `-Infinity`, which is less than everything.
 */
function heldOf(arm: Arm): readonly number[] {
  return heldMsOf(lossesOf(arm))
}

/**
 * How long each lease that RAN OUT was held — expiries only.
 *
 * **This is the set every claim about the LEASE belongs to, and separating it cost a red run.**
 * On 2026-09-15 the lease-floor assertion below read `expected 27 to be greater than or equal
 * to 2000` on the killed arm: 27 ms is a surrender, and a surrender is a lease released early
 * on an observed hard failure, so it never waited for the lease and was never going to. The
 * assertion was correct and was being handed the wrong population — `lossesOf` had been widened
 * to cover both kinds for the existence question ("was a lease lost at all?"), and `heldOf`
 * inherited that widening into the duration question, where it does not hold.
 *
 * `heldMs` for an expiry settles at `max(lease, 2/3 x lease + probe)`; that formula is what the
 * short-against-long comparison rests on, so that comparison reads this set too.
 */
function expiryHeldOf(arm: Arm): readonly number[] {
  return heldMsOf(arm.job.expired)
}

/**
 * An arm whose signal actually landed mid-job, retried a bounded number of times if it did not.
 *
 * **This re-arms a failed ARRANGEMENT, and it is not a way of retrying until green.** The case
 * below is about a holder lost *while it was working*. A run where the signal arrives after the
 * holder has already answered every shard produces `granted === completed` and no loss of any
 * kind — it is not a counter-example to the claim, it is a run in which the claim was never put
 * to the test. Measured once in ten runs of the killed arm: `{"granted":12,"completed":12}`, and
 * the assertion message in `readArm` already names that outcome as the margin being spent.
 *
 * **What it cannot hide.** A real regression — a kill that stops costing leases at all — burns
 * every attempt and fails by name, carrying each attempt's own tally. The loss-kind race is
 * untouched: an arm that lost leases is returned on its first attempt whether they expired or
 * were surrendered, so the distribution this case reports is the fabric's and not this
 * helper's. And the grant-accounting identity is checked on whatever arm comes back, so a
 * forgotten lease is still a red rather than a retry.
 *
 * A fresh tag per attempt because `runArm` derives its workdir, its job store and its agent
 * names from it; reusing one would have the second attempt collide with the first's files.
 */
async function armWithLoss(
  tag: string,
  leaseMs: number,
  signal: 'SIGSTOP' | 'SIGKILL',
): Promise<Arm> {
  const tallies: string[] = []
  for (let attempt = 1; attempt <= ARM_ATTEMPTS; attempt += 1) {
    const arm = await runArm(attempt === 1 ? tag : `${tag}-r${String(attempt)}`, leaseMs, signal)
    if (lossesOf(arm).length > 0) return arm
    tallies.push(JSON.stringify(arm.job.kinds))
  }
  throw new Error(
    `could not arrange a mid-job ${signal} for '${tag}' in ${String(ARM_ATTEMPTS)} attempts — ` +
      `every one of them finished the job before the signal landed. Tallies: ${tallies.join(', ')}. ` +
      'This is the fixture failing to set the experiment up, not the fabric failing to lose a ' +
      'lease; if it persists, the work each shard does is too small for the signal to land inside.',
  )
}

/**
 * The assertions every arm shares: the lease bit, the shard came back, and it came back on the
 * lease the operator asked for rather than on the constant.
 */
function readArm(arm: Arm, leaseMs: number): void {
  // **Stated first, so an arm whose signal landed too late fails by name** instead of making
  // every reading beneath it vacuously true.
  expect(
    lossesOf(arm).length,
    `arm '${arm.name}' recorded no lease loss of EITHER kind. What the fabric DID record: `
      + `${JSON.stringify(arm.job.kinds)}, with the silenced executor holding `
      + `${String(arm.burnedMs)}ms of CPU at the instant it was signalled and the survivor `
      + `${String(arm.survivorMs)}ms. A tally of granted === completed and nothing else means `
      + 'the signal landed after the holder had already answered everything — the margin '
      + '{@link SHARDS} exists to buy, spent. A `surrendered` entry instead would mean the '
      + 'loss came back as a closed socket inside the lease rather than as a lease running '
      + 'out, which is the ordering this case exists to pin — see the case docblock.',
  ).toBeGreaterThan(0)
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

  // Every loss names the node this arm silenced — of either kind, because a surrender by the
  // SURVIVING node is a different fabric failure and would otherwise be reported under this
  // requirement's name. Read over `expired` alone this said nothing at all about the run where
  // every loss was a surrender.
  for (const loss of lossesOf(arm)) {
    expect(loss.nodeId).toBe(arm.silencedPeerId)
  }

  // ── The requirement's own words: *re-dispatched* on lease expiry, and answered ──────────
  //
  // **This arrangement has ZERO placement slack, and the arithmetic is worth stating before
  // somebody meets the symptom.** Two executors stand up and one is silenced, so every shard
  // whose lease lapses has exactly one node left to go to. `submitJob` places again over the
  // eligibility gate with `new Set(attempted)` removed (`job/submit.ts:3301`), and `attempted`
  // grows by every node the shard was PLACED on (`:3236`) whatever the dispatch then did — a
  // node that answered `over-committed` is spent as surely as one that ran the work. So a
  // shard needing a THIRD placement has nowhere to go and ends `no-untried-node`.
  //
  // **Observed twice in 44 runs on 2026-09-15.** Once as a shard ending `no-untried-node`
  // instead of `agreed`, and once as a killed arm reading `{granted 23, expired 9,
  // surrendered 3, completed 11}` — eleven completions where twelve were placed, which is the
  // same shard dying with nowhere left to go. Neither occurrence was captured with its shard
  // rows, so WHY the survivor came back short is **unmeasured**. What is established is read
  // from the source above rather than inferred from the symptom: the pool arithmetic leaves no
  // room for one hiccup.
  //
  // Deliberately NOT fixed by standing a third executor up. The arms either side of this one
  // read CPU off exactly two processes and compare them, so a third node changes what those
  // readings mean. Naming the arithmetic is the honest half; changing the fixture is a
  // decision about what this file measures.
  //
  // `taskId` is the shard id, which `submitJob` sets to `String(partitionIndex)`, so an
  // expiry is joined to its shard rather than counted beside it.
  expect(arm.job.redispatches).toBeGreaterThanOrEqual(lossesOf(arm).length)
  for (const expiry of lossesOf(arm)) {
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

  // Expiries only. An arm with none is a killed arm, whose losses came back as surrenders —
  // that arm's claim is carried by `lossesOf(killed).length > 0` at its own call site, and by
  // the signal comparison at the end of this file. `readArm`'s first assertion already refuses
  // an arm with no loss of either kind, so an empty set here can only mean surrenders.
  for (const held of expiryHeldOf(arm)) {
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
    const short = await armWithLoss('short', SHORT_LEASE_MS, 'SIGSTOP')
    readArm(short, SHORT_LEASE_MS)
    const long = await armWithLoss('long', LONG_LEASE_MS, 'SIGSTOP')
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
    const shortHeld = expiryHeldOf(short)
    const longHeld = expiryHeldOf(long)
    // **Both sets must be non-empty before a min/max reads them.** `Math.min(...[])` is
    // `Infinity` and `Math.max(...[])` is `-Infinity`, so the comparison below passes on two
    // empty arms without anything having been measured — a blind instrument, and this file has
    // carried one before.
    expect(shortHeld.length, 'the short arm recorded no EXPIRY to compare').toBeGreaterThan(0)
    expect(longHeld.length, 'the long arm recorded no EXPIRY to compare').toBeGreaterThan(0)
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
     * **SUPERSEDED 2026-09-15, and only the sentence in bold above.** That reading is left
     * standing because it is what four runs showed on the day it was taken; it is wrong as a
     * rule. Re-measured across four runs of this case with the surrendering node's identity
     * emitted, the killed arm read `expired 12 / surrendered 0` twice and `expired 11 /
     * surrendered 1` twice — and the surrendering node was the SILENCED peer itself, on the
     * last shard, the one in flight when the signal landed. So a closed socket **sometimes**
     * returns the outstanding dispatch inside the lease. Which way it goes is the transport's
     * race rather than the signal's property, and `churn-agents.node.test.ts`' opposite
     * reading is that same race seen from its other side. The lease constant is also no longer
     * 1 000: `SHARDS`-wide runs use `SHORT_LEASE_MS`, which is 2 000.
     *
     * What survives untouched is the paragraph below — the signal decides the **probe**, not
     * the dispatch — and it is what the `heldMs` assertion at the end of this case reads.
     *
     * What the signal *does* decide is measured too, and it is the renewal probe rather than
     * the dispatch. A stopped process holds its socket open, so the probe at `RENEW_AT` waits
     * the full `DEFAULT_PROBE_TIMEOUT_MS` for an answer that never comes; a killed one's
     * socket is closed, so the same probe fails at once. `heldMs` therefore lands near
     * `⅔ × lease + probe` for SIGSTOP and near the lease itself for SIGKILL — which is why
     * SIGSTOP is the honest instrument for *silence*, and why this file uses it everywhere
     * else.
     */
    const stopped = await armWithLoss('stopped', SHORT_LEASE_MS, 'SIGSTOP')
    readArm(stopped, SHORT_LEASE_MS)
    const killed = await armWithLoss('killed', SHORT_LEASE_MS, 'SIGKILL')
    readArm(killed, SHORT_LEASE_MS)

    // **It really was killed — asserted over losses of EITHER kind, because the kind is the
    // race and the loss is the fact.** This read `expired.length > 0` and failed on a run whose
    // killed arm recorded `{granted 23, surrendered 11, completed 12}`: twelve shards, eleven
    // losses, not one of them an expiry. `readArm` above already refuses an arm with no loss
    // at all and names what the fabric did record, so this line is the narrower claim it was
    // always meant to be.
    expect(lossesOf(killed).length).toBeGreaterThan(0)
    // **The day this file wrote itself a letter about has arrived, and the letter is why the
    // arms are now asserted differently.**
    //
    // Both arms used to assert `kinds['surrendered']` was undefined, with the note that it was
    // written as an assertion *"so the day the transport starts propagating a closed socket
    // into an outstanding request this file says so instead of the comment quietly going
    // stale"*. It said so. Measured across four runs of this case on a quiet host, with the
    // surrendering node's identity emitted for the reading:
    //
    // | run | stopped            | killed              |
    // |-----|--------------------|---------------------|
    // | 1   | expired 12, surr 0 | expired 12, surr 0  |
    // | 2   | expired 12, surr 0 | expired 11, surr 1  |
    // | 3   | expired 12, surr 0 | expired 12, surr 0  |
    // | 4   | expired 12, surr 0 | expired 11, surr 1  |
    //
    // The surrendering `nodeId` was the SILENCED peer itself, every time, and always on the
    // same task — the last shard, the one in flight when the signal landed. So the docblock's
    // *"SIGKILL produces `expired`, not `surrendered`"* is true of the run it was measured on
    // and false as a rule: a closed socket sometimes returns the outstanding dispatch inside
    // the lease and sometimes does not, and which one happens is the transport's race, not the
    // signal's property. `churn-agents.node.test.ts`' opposite reading is the same race seen
    // from its other side.
    //
    // **The SIGSTOP arm keeps the strict assertion**, because there the mechanism forbids the
    // race rather than merely losing it: a frozen process holds its socket open, so nothing
    // comes back and every loss is silence. Four of four agree, and if that ever changes it is
    // a finding about the transport worth a red.
    expect(
      stopped.job.kinds['surrendered'],
      'a SIGSTOPped holder surrendered a lease. Its socket stays OPEN, so no dispatch can come ' +
        'back and every loss must be silence — a surrender here means the transport reported a ' +
        'hard failure against a process that is merely frozen.',
    ).toBeUndefined()

    // **What the killed arm asserts instead, and the first version of THIS was wrong too.**
    //
    // It first read `expired + surrendered === SHARDS`, on the strength of eight readings that
    // all showed twelve losses over twelve shards. Soaked, it failed 2/4 with `expired 8,
    // surrendered 3` — eleven, not twelve — and the eleven is correct: a shard that finished
    // on its FIRST holder, before the signal landed, never lost a lease at all. Twelve was an
    // accident of how far the job had got when the kill arrived, and a number that agrees with
    // a theory is not the theory's proof.
    //
    // What is actually invariant is the lease table's bookkeeping: every grant ends exactly
    // once, and `lease.ts` gives it exactly three endings — `completed`, `expired`,
    // `surrendered`. `renewed` extends a grant rather than ending one and `abandoned` is a
    // property of the task, so neither belongs in the sum. A grant that ends in none of the
    // three is a lease the table forgot, which is the defect this case would actually want to
    // hear about — and unlike the shard count it does not move with the timing of the signal.
    const ends = (['completed', 'expired', 'surrendered'] as const).reduce(
      (total, kind) => total + (killed.job.kinds[kind] ?? 0),
      0,
    )
    expect(
      ends,
      `the killed arm granted ${String(killed.job.kinds['granted'])} leases and ended ` +
        `${String(ends)} of them: ${JSON.stringify(killed.job.kinds)}. Every grant ends exactly ` +
        'once — completed, expired or surrendered — so a grant in none of the three is a lease ' +
        'the table lost track of.',
    ).toBe(killed.job.kinds['granted'] ?? 0)

    // The probe, not the dispatch, is what the signal changes: every killed-arm expiry landed
    // sooner than every stopped-arm one, at the same lease.
    // Same ±Infinity guard as the arm comparison above, for the same reason.
    expect(heldOf(killed).length, 'the killed arm recorded no loss to time').toBeGreaterThan(0)
    expect(heldOf(stopped).length, 'the stopped arm recorded no loss to time').toBeGreaterThan(0)
    expect(Math.max(...heldOf(killed))).toBeLessThan(Math.min(...heldOf(stopped)))
  }, PROCESS_TEST_TIMEOUT)
})
