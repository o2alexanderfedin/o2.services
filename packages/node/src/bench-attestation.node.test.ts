import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeAttestation } from '@o2/core'

/**
 * `bin/bench.ts --discover` is executed, and the attestation strength it prints for each
 * rung is read off its own stdout — VER-09, VER-10, criterion 3's CLI half.
 *
 * ## The three readings, and why one of them alone would prove nothing
 *
 * | rung | reads | because |
 * |---|---|---|
 * | every memory rung | the **named absence** | `memoryFabric` builds descriptors with `publicNodes`, which carries no certificate, and nothing enrolled its endpoints |
 * | real transport, 1 node | **`owner-attested`** | `redundancy: Math.min(2, nodes)` is 1 there, so one certificated replica ran and nothing verified it |
 * | real transport, 2 nodes | **`independent`** | two workers enrol under `operatorId: bench-worker-${i}`, so two *separate operators* agreed |
 *
 * **The pair is the point.** `owner-attested` on its own passes against a driver that
 * prints one constant, and so does `independent`; the two together are what make this a
 * distinction rather than a default. And the absence is the third, because *"we cannot
 * say"* and *"one node said so"* are different statements — keeping them different is the
 * whole of VER-10, and a memory rung reporting `owner-attested` is the failure that would
 * look most like success to a reader.
 *
 * The sentences are compared against `describeAttestation` rather than transcribed, so
 * the assertion is that the CLI renders the kernel's words and not that somebody copied
 * them correctly on one day.
 *
 * ## Why `--discover`, and why nothing weaker would do
 *
 * Plan 19-06's receipt needs **two** things of a shard, not one: descriptors carrying
 * certificates, *and* an agreeing replica whose signature over that result verifies. Off
 * the `--discover` arm the first fails — `discoverCandidates` runs only inside
 * `if (DISCOVER)` and the flag is off by default — so every rung reads the absence and
 * criterion 3 is untestable. This is the only rig in the repository that satisfies both
 * from a runnable entry point.
 *
 * ## Why this is a sibling of `discover-arm.node.test.ts` rather than part of it
 *
 * That file reads the `--discover:` qualification line, which is printed while the first
 * real rig is being built — about a second in — and it kills the driver immediately
 * afterwards. Its own header states the rule this file must not break for it: *"this is
 * not a benchmark and must not become one"*.
 *
 * The attestation line for a rung is printed **after that rung's runs complete**, because
 * it is read off a job that happened. So these readings cannot be had at t+1 s, and
 * folding them into that file would have turned a 4 s spec into this one. Measured on
 * this host, 2026-08-03, twice on the same tree at 1-minute load ≈ 5:
 *
 * | reading | run 1 | run 2 |
 * |---|---|---|
 * | memory rungs | t+1 s | t+1 s |
 * | real transport, 1 node | t+61 s | t+62 s |
 * | real transport, 2 nodes | **t+213 s** | **t+153 s** |
 *
 * That spread is the arm's, not this file's: **the first iteration of each real rung
 * stalls exactly `rpcTimeoutMs` (30 s) and comes back incomplete**, and every rung's
 * reduce leg fails and is retried. Both were measured while writing this file and neither
 * is caused by it — deferred item 4 in this phase's `deferred-items.md` files them rather
 * than chasing them.
 *
 * **This file reads labels and counts, never durations.** The numbers above are what the
 * wait costs, recorded so the next reader can price it; nothing here asserts on one.
 *
 * ## The one thing about it that is genuinely host-dependent, and what is done about it
 *
 * A rung has a strength to report only if one of its six iterations **completed** a job.
 * On a quiet host both real rungs do. Inside a full `--project node` run, one of three
 * observed on 2026-08-03 had the 1-node rung complete none of the six — it printed
 * *"none established (agreeing 0, verified 0) — this shard is insufficient rather than
 * agreed"*, which is the correct reading of a rung that established nothing, and is a
 * statement about the stall above rather than about attestation.
 *
 * So a spawn whose real rungs did not read off a completed run is discarded and taken
 * again, at most once. **That retries an observation and never an assertion** — a rung
 * that completed a job and printed the wrong label is kept, and fails. See
 * {@link MAX_ATTEMPTS}, where the line is argued, and {@link everyRealRungCompleted},
 * where it is drawn.
 *
 * ## Why `cwd` is a temporary directory
 *
 * `main()` writes its report under `process.cwd()`. Spawned with the repository as `cwd`,
 * this would overwrite committed measurements with a partial run's — the reason the arm
 * went uncovered for a phase. The temp `cwd` is asserted rather than assumed, and
 * `git status --porcelain` is compared across the run.
 *
 * ## Reddening — what was planted, and what each planting proved
 *
 * All three are in `bin/bench.ts`, all three were run, and each was restored by `cp` +
 * `cmp` — never by `git checkout --`.
 *
 * 1. **The absence falls back to a label.** Replace the named-absence arm of
 *    `attestationReading` with `attestationReceipt([])`, which returns `owner-attested`
 *    for an empty set. Only the first case reddens:
 *    *"memory/1 did not report an absence: owner-attested (replicas 0, operators 0) —
 *    owner-attested — computed once by the data owner and not independently verified"*.
 *    **The most valuable plant here**, because a memory rung reporting `owner-attested` is
 *    not obviously wrong to a reader — it is the failure that looks most like success.
 * 2. **One constant label for every rung.** Return a fixed `owner-attested (replicas 1,
 *    operators 1)` reading from `attestationReading`. **Two cases redden** — the absence
 *    and `independent` (*"expected 'owner-attested' to be 'independent'"*) — and the
 *    `owner-attested` case **passes**. That is this file's own argument, measured: one
 *    reading alone would have been satisfied by exactly this defect.
 * 3. **The rung's redundancy moves under the label.** Force the real sweep to
 *    `redundancy: 2` in place of `Math.min(2, nodes)`. The 1-node rung then cannot place a
 *    second replica at all and its line changes to *"none established (agreeing 0,
 *    verified 0) — this shard is insufficient rather than agreed"*; the `owner-attested`
 *    case names it, and the pair assertion carries `independent` down with it. **The
 *    sweep-shape case stays green**, because the headings did not move — which is what
 *    separates *"the label followed the rig"* from *"the rig moved"*.
 */

const BENCH = fileURLToPath(new URL('./bin/bench.ts', import.meta.url))
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * How long one spawn gets to reach the last rung this file reads.
 *
 * Measured at 153 s and 213 s on a quiet host, and 131-163 s inside a full node run
 * (table above). This is headroom for a contended host, not an estimate of the
 * mechanism, and it is a ceiling only reached when a rung stops producing a reading —
 * which is the failure this file is for.
 */
const READINGS_BUDGET_MS = 420_000

/**
 * How many times the driver may be run to obtain the observation.
 *
 * **This retries an observation, never an assertion, and the distinction is the whole
 * justification.** What the cases below check — that the CLI prints the strength its
 * `JobResult` carries — does not depend on the host. What *is* host-dependent is whether
 * a rung completes a job at all, and deferred item 4 measures why: on the `--discover`
 * arm the first iteration of each real rung stalls exactly `rpcTimeoutMs`, and under full
 * suite contention that can take **every** iteration of a rung with it. Observed
 * 2026-08-03 in one full node run of three: the 1-node rung reported *"this shard is
 * insufficient rather than agreed"* — no job of that rung completed, so there was
 * genuinely nothing to attest and the driver said so correctly.
 *
 * A spawn whose real rungs did not all read off a completed run is therefore discarded
 * and taken again. It is **not** discarded for reading the wrong label: a rung that
 * completed a job and printed the wrong strength is kept and fails, which is the case
 * this file exists for. That is the line between acquiring an observation and shopping
 * for one, and it is drawn in {@link everyRealRungCompleted}.
 *
 * Two, not more: a third attempt buys little against a defect this size and turns a
 * failure into a fifteen-minute one.
 */
const MAX_ATTEMPTS = 2

/**
 * Per-case budget, carried by **every** case rather than by a hook — see {@link readings}
 * for why the wait is not in `beforeAll`. Whichever case runs first pays it; the rest
 * resolve immediately and never come near it. Covers {@link MAX_ATTEMPTS} spawns.
 */
const SPAWN_TIMEOUT_MS = 900_000

type BenchProcess = ChildProcessByStdio<Writable, Readable, Readable>

/** `  real transport, 2 node(s)…` — the rung headings the driver has always printed. */
const HEADING = /^(memory|real) transport, (\d+) node\(s\)…$/
/**
 * `    map attestation (first completed run): …` — the line Plan 19-10 added.
 *
 * **The `map ` prefix arrived with Plan 19-17** and is load-bearing rather than cosmetic.
 * That plan put a second receipt on this stream — the *aggregation's* — and the two are
 * claims about different things that routinely differ, so each line now names which claim
 * it carries. This pattern matches the map half **only**: `^` is what keeps
 * `aggregate attestation (…)` out of the readings below, and dropping the anchor or the
 * word would silently start feeding this file's three strength assertions from the wrong
 * receipt.
 */
const ATTESTATION = /^map attestation \(([^)]+)\): (.+)$/
/** A strength, its counts, and the kernel's sentence. */
const STRENGTH = /^(owner-attested|owner-domain|independent) \(replicas (\d+), operators (\d+)\) — (.+)$/
/** The named absence, with the two counts that decide what to do about it. */
const ABSENCE = /^none established \(agreeing (\d+), verified (\d+)\) — (.+)$/

interface RungReading {
  readonly transport: 'memory' | 'real'
  readonly nodes: number
  /** Which of the rung's runs the receipt came off — `first completed run`, or a weaker arm. */
  readonly population: string
  readonly reading: string
}

/** The rungs this file waits for. The last one decides the wall clock. */
const AWAITED: readonly string[] = ['real/1', 'real/2']

/** `attestationReading`'s own word for a receipt taken off a run that completed. */
const COMPLETED_RUN = 'first completed run'

const keyOf = (transport: string, nodes: number): string => `${transport}/${String(nodes)}`

let workdir: string
let child: BenchProcess | null = null
let collected: readonly RungReading[] = []
/** The headings in the order they were printed — the sweep's shape, as the driver reports it. */
let headings: readonly string[] = []

/** The repository's own view of itself, which this run may not move. */
function repoStatus(): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' })
}

/** SIGTERM, then SIGKILL on a budget, then wait for the process to actually be gone. */
async function stopBench(): Promise<void> {
  const running = child
  child = null
  if (running === null) return
  if (running.exitCode !== null || running.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      running.kill('SIGKILL')
      resolve()
    }, 10_000)
    running.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    running.kill('SIGTERM')
  })
}

/**
 * Spawn the driver in `workdir` and resolve once every awaited rung has spoken.
 *
 * `'pipe'` on fd 0 rather than `'ignore'`, per the guard at the bottom of
 * `orphan-leash.node.test.ts`: an ignored stdin is a character device, which opts a child
 * out of the leash. `bench.ts` is a declared exception there — it is one-shot — but a
 * spawn site that hands over the wrong thing is the defect that guard exists to stop
 * spreading, and it reads sources rather than behaviour.
 */
async function spawnAndRead(): Promise<{
  readings: readonly RungReading[]
  headings: readonly string[]
}> {
  const spawned: BenchProcess = spawn(process.execPath, [BENCH, '--quick', '--discover'], {
    cwd: workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child = spawned

  const gathered: RungReading[] = []
  const seenHeadings: string[] = []

  await new Promise<void>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let consumed = 0
    let pending: { transport: 'memory' | 'real'; nodes: number } | null = null

    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `not every awaited rung spoke within budget. Collected ` +
              `${gathered.map((r) => keyOf(r.transport, r.nodes)).join(', ')}` +
              `\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        ),
      READINGS_BUDGET_MS,
    )

    spawned.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    spawned.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      // Whole lines only, and each one exactly once: a half-arrived line parses to
      // nothing, and re-reading the buffer from the start would record every rung as
      // many times as a chunk arrived after it.
      const lines = stdout.split('\n')
      const whole = lines.slice(consumed, lines.length - 1)
      consumed = lines.length - 1

      for (const raw of whole) {
        const line = raw.trim()
        const heading = HEADING.exec(line)
        if (heading !== null) {
          const transport = heading[1] === 'real' ? 'real' : 'memory'
          const nodes = Number(heading[2])
          seenHeadings.push(keyOf(transport, nodes))
          pending = { transport, nodes }
          continue
        }
        const attested = ATTESTATION.exec(line)
        if (attested === null || pending === null) continue
        gathered.push({
          transport: pending.transport,
          nodes: pending.nodes,
          population: attested[1] ?? '',
          reading: attested[2] ?? '',
        })
        pending = null
        if (AWAITED.every((key) => gathered.some((r) => keyOf(r.transport, r.nodes) === key))) {
          clearTimeout(timer)
          resolve()
          return
        }
      }
    })

    spawned.on('exit', (code) => {
      clearTimeout(timer)
      // Reached when the arm throws — `--discover found no candidates` exits before any
      // rung speaks. Reported with the child's own words, because "exited early" on its
      // own is the uninformative failure this file replaces.
      reject(new Error(`bench exited with ${String(code)} before every rung spoke.\nstderr:\n${stderr}`))
    })
  })

  return { readings: gathered, headings: seenHeadings }
}

/**
 * The condition a spawn must meet to be kept — see {@link MAX_ATTEMPTS}.
 *
 * **A rung that completed a job is kept whatever it printed.** This asks only whether
 * there was a completed job to read a receipt off, which is the driver-stall condition
 * deferred item 4 describes, and it deliberately does not look at the strength: a rung
 * that ran and printed the wrong label must fail, not be spawned again until it agrees.
 */
function everyRealRungCompleted(found: readonly RungReading[]): boolean {
  return AWAITED.every((key) =>
    found.some((r) => keyOf(r.transport, r.nodes) === key && r.population === COMPLETED_RUN),
  )
}

/** Every attempt's real-rung readings, so a double failure reports both. */
const attemptLog: string[] = []

/** Run the driver until its real rungs have a completed job to attest, or give up. */
async function readAttestationLines(): Promise<void> {
  let lastFailure: unknown = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const outcome = await spawnAndRead()
      collected = outcome.readings
      headings = outcome.headings
      attemptLog.push(
        `attempt ${String(attempt)}: ` +
          outcome.readings
            .filter((r) => r.transport === 'real')
            .map((r) => `${keyOf(r.transport, r.nodes)} (${r.population}) ${r.reading}`)
            .join(' | '),
      )
      await stopBench()
      if (everyRealRungCompleted(outcome.readings)) return
    } catch (cause) {
      lastFailure = cause
      attemptLog.push(`attempt ${String(attempt)}: ${cause instanceof Error ? cause.message : String(cause)}`)
      await stopBench()
    }
  }
  // Nothing usable at all — the rungs never spoke. A spawn that spoke but did not
  // complete is left to the cases below, whose failures name the reading.
  if (collected.length === 0) throw lastFailure ?? new Error(attemptLog.join('\n'))
}

/** The reading for one rung, or a failure that names which rung is missing. */
function rung(transport: 'memory' | 'real', nodes: number): RungReading {
  const found = collected.find((r) => r.transport === transport && r.nodes === nodes)
  if (found === undefined) {
    throw new Error(
      `no attestation line for ${keyOf(transport, nodes)}; the driver printed ` +
        `${collected.map((r) => keyOf(r.transport, r.nodes)).join(', ')}`,
    )
  }
  return found
}

/** The strength a rung reported, with its counts and the sentence beside it. */
function strengthOf(transport: 'memory' | 'real', nodes: number): {
  strength: string
  replicas: number
  operators: number
  description: string
} {
  const { reading } = rung(transport, nodes)
  const hit = STRENGTH.exec(reading)
  if (hit === null) {
    throw new Error(
      `${keyOf(transport, nodes)} reported no strength: ${reading}\n${attemptLog.join('\n')}`,
    )
  }
  return {
    strength: hit[1] ?? '',
    replicas: Number(hit[2]),
    operators: Number(hit[3]),
    description: hit[4] ?? '',
  }
}

let before = ''
let inFlight: Promise<void> | null = null

/**
 * One spawn, shared by every case — awaited **inside** each `it` and deliberately not
 * done in `beforeAll`.
 *
 * `beforeAll` is where this obviously belongs and it is the wrong place, for a reason
 * measured here on 2026-08-03 rather than reasoned about: **`--reporter=json` attributes
 * no hook time to a file.** With the spawn in `beforeAll` this file's `endTime -
 * startTime` read **235 ms** against a wall clock of **154 s**, so the run that
 * `MEASURED_NODE_SPANS` is derived from would have recorded it as one of the fastest
 * files in the project and `test:unit` would have kept running it — a 20× regression of
 * the fast inner loop, invisible to the instrument that exists to prevent exactly that.
 *
 * Awaiting a memoised promise inside each case puts the wait where the reporter can see
 * it, without making any case depend on running first: whichever runs first pays, and
 * the rest resolve immediately. Every case therefore carries the spawn budget.
 */
async function readings(): Promise<void> {
  inFlight ??= readAttestationLines()
  await inFlight
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-bench-attestation-'))
  before = repoStatus()
})

afterAll(async () => {
  await stopBench()
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('the driver says how strongly each rung was attested', () => {
  it('reports the named absence for a rung whose descriptors carry no certificate', async () => {
    await readings()
    // Every memory rung, not one: three chances for a constant to show itself, and the
    // 2- and 4-node rungs run at redundancy 2, so a driver deriving the label from
    // `config.redundancy` would print a *different* wrong answer here than at 1 node.
    for (const nodes of [1, 2, 4]) {
      const { reading } = rung('memory', nodes)
      const absent = ABSENCE.exec(reading)
      expect(absent, `memory/${String(nodes)} did not report an absence: ${reading}`).not.toBeNull()
      // `verified 0` is the load-bearing count. `agreeing` is however many replicas
      // matched — the rung ran fine — and none of them could be accounted for.
      expect(Number(absent?.[2])).toBe(0)
      // Not merely "does not parse as a strength": none of the three sentences appears
      // anywhere in the line either, so a driver that appended a label after the absence
      // would be caught as well.
      expect(STRENGTH.test(reading)).toBe(false)
      for (const strength of ['owner-attested', 'owner-domain', 'independent'] as const) {
        expect(reading).not.toContain(describeAttestation(strength))
      }
    }
  }, SPAWN_TIMEOUT_MS)

  it('reads owner-attested off the one-replica rung — criterion 3’s CLI half', async () => {
    await readings()
    const one = strengthOf('real', 1)
    expect(one.strength).toBe('owner-attested')
    // Read from the rung's construction and not transcribed: `redundancy: Math.min(2,
    // nodes)` is 1 at one node, and that one node enrolled under one `operatorId`.
    expect(one.replicas).toBe(1)
    expect(one.operators).toBe(1)
    // The kernel's sentence, compared rather than copied — the CLI and the demo UI must
    // not drift into describing one result differently, and one source of the words is
    // the only thing that can guarantee it.
    expect(one.description).toBe(describeAttestation('owner-attested'))
    // Off a run that completed every shard, which is the population `measure` computes
    // `makespan` over. A reading off a partial run would carry the absence *because the
    // run failed*, which is a true statement about nothing this case is asking.
    expect(rung('real', 1).population, attemptLog.join('\n')).toBe(COMPLETED_RUN)
  }, SPAWN_TIMEOUT_MS)

  it('reads independent off the two-operator rung, which is what makes it a distinction', async () => {
    await readings()
    const two = strengthOf('real', 2)
    expect(two.strength).toBe('independent')
    expect(two.replicas).toBe(2)
    expect(two.operators).toBe(2)
    expect(two.description).toBe(describeAttestation('independent'))
    expect(rung('real', 2).population, attemptLog.join('\n')).toBe(COMPLETED_RUN)

    // Asserted as a pair and deliberately here rather than in a fourth case: either
    // reading alone passes against a driver that prints one constant, and it is the two
    // *differing on one surface* that shows the labels are distinct rather than asserted
    // to be.
    expect([strengthOf('real', 1).strength, two.strength]).toEqual(['owner-attested', 'independent'])
    expect(describeAttestation('owner-attested')).not.toBe(describeAttestation('independent'))
  }, SPAWN_TIMEOUT_MS)

  it('did not move the sweep, and wrote nothing into the repository', async () => {
    await readings()
    // The rungs, in order, up to the last one this file waits for: `LADDER` is [1, 2, 4]
    // and `REAL_LADDER` is [1, 2] under `--quick`. Plan 19-10 adds a printed line and
    // changes no ladder, iteration count, rung or redundancy — a benchmark whose
    // configuration moved between runs has rows that cannot be compared with the ones
    // already published, and this is where that claim is checked rather than promised.
    expect(headings).toEqual(['memory/1', 'memory/2', 'memory/4', 'real/1', 'real/2'])

    // Written where it was told to, and nowhere else.
    expect((await stat(join(workdir, '.planning', 'bench'))).isDirectory()).toBe(true)
    expect(repoStatus()).toBe(before)
  }, SPAWN_TIMEOUT_MS)
})
