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
 * | real transport, 2 nodes | **`owner-domain`** | two workers of the same user key agreed — replicated across one person's machines, independent of hardware failure and not of the owner |
 *
 * > **THE SECOND ROW READ `independent` UNTIL 2026-09-16 AND THE REASON IT GAVE WAS FALSE.
 * > Qualified rather than deleted, VER-11, Phase 44.** It said: *"two workers enrol under
 * > `operatorId: bench-worker-${i}`, so two separate operators agreed."* The first clause was
 * > true and the inference was not. `ownerOfWorker` (`bin/bench.ts`) returns the **same**
 * > `BENCH_USER_SEED` for every worker unless `--sovereign` is passed, and this rung is
 * > `--discover`. So the two workers were two processes of one user, differing in a string the
 * > provider copied without checking — and this file, which exists to stop a driver printing a
 * > label nothing in it supports, was reading one.
 * >
 * > A provider now derives `operatorId` from the user key, and the rung reports what those two
 * > processes are. **The rig was not changed to restore the old word, and that was a decision
 * > rather than an omission**: a test fixture may supply as many owners as the rule under test
 * > needs, because the number of operators is the thing it is checking; this driver publishes a
 * > reading of a real rig, so its labels have to describe the rig — and the rig is one person's
 * > processes on one machine. `independent` over N volunteers is the multi-machine demo's to
 * > show, not this one's.
 *
 * **The pair is the point.** `owner-attested` on its own passes against a driver that
 * prints one constant, and so does `owner-domain`; the two together are what make this a
 * distinction rather than a default. The pair survived the change unweakened — two different
 * strings off one surface is what it has always asserted. And the absence is the third, because *"we cannot
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
 *    [There are **four** labels since 2026-09-16, VER-12 — `single-issuer` sits between
 *    `owner-domain` and `independent` — so a plant of this shape today has one more wrong
 *    answer available to it than it had when this was observed. The observation stands as
 *    taken; it was not re-run against the fourth label.]
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
/**
 * VER-04's line — what the quorum came to, distinct from the strength it produced.
 *
 * Deliberately does NOT anchor on the arm word: all three arms (`composed across`,
 * `not composed`, `not attempted`) are read through one pattern, so a driver that stopped
 * printing one of them fails on a missing rung rather than on a regex that silently never
 * matched.
 */
const QUORUM = /^quorum \(([^)]+)\): (.+)$/
/**
 * A strength, its counts, and the kernel's sentence.
 *
 * **Both halves of this pattern moved on 2026-09-16, VER-12, and they had to move together.**
 * The alternation gained `single-issuer` — a fourth label the driver can now print — and the
 * parenthetical gained a third count group, because `strengthReading` in `bin/bench.ts` now
 * emits `issuers K` beside the other two.
 *
 * Moving only the alternation is the dangerous edit and it is a **silent** one. The measured
 * failure, taken against this file on the commit that changed the driver and not this pattern:
 * `strengthOf` threw `real/1 reported no strength: owner-attested (replicas 1, operators 1,
 * issuers 1) — …` in two cases — loud — while the absence case at the top of the `describe`
 * **passed**, because its only instrument is `STRENGTH.test(reading)` and a pattern that
 * matches no real line makes `toBe(false)` true for free. That is the shape the note above
 * warns about, observed rather than reasoned about: one arm of this file went vacuous and the
 * run still reported it green.
 */
const STRENGTH =
  /^(owner-attested|owner-domain|single-issuer|independent) \(replicas (\d+), operators (\d+), issuers (\d+)\) — (.+)$/
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

/**
 * Its word for a rung that returned a job which did **not** complete.
 *
 * `Observation.complete` means *every shard agreed, undegraded*, and since VER-11 the
 * two-worker rung cannot be undegraded: its workers share one user key, so they are one
 * operator, so the quorum gate refuses `insufficient-operators` and the default dial degrades
 * the shard rather than failing it. The work still runs at two replicas and they still agree —
 * what is missing is the verification, which is exactly what the rung has to say.
 *
 * **This is information, not damage.** A benchmark rung whose runs cannot be independently
 * verified should report that where the numbers are read, and this driver now does. The
 * alternative — handing each worker its own user key so the gate composes again — would make
 * the rig state a population it does not have, on the one surface whose whole job is to report
 * what the rig established.
 */
const DEGRADED_RUN = 'no run of this rung completed; first job it returned'

/**
 * The strongest population each real rung can now reach.
 *
 * Per rung rather than one constant, because the two differ for a reason that is now permanent:
 * `real/1` asks for redundancy 1, so there is no quorum to compose, nothing to degrade, and a
 * completed run; `real/2` asks for 2 and is one operator. Asserting `COMPLETED_RUN` of both
 * would be asserting something no honest run of this rig can produce; asserting `DEGRADED_RUN`
 * of both would lose the stall guard on the rung that *can* complete.
 */
const EXPECTED_POPULATION: ReadonlyMap<string, string> = new Map([
  ['real/1', COMPLETED_RUN],
  ['real/2', DEGRADED_RUN],
])

const keyOf = (transport: string, nodes: number): string => `${transport}/${String(nodes)}`

let workdir: string
let child: BenchProcess | null = null
let collected: readonly RungReading[] = []
/** The headings in the order they were printed — the sweep's shape, as the driver reports it. */
let headings: readonly string[] = []

/** VER-04 — the quorum sentence each rung printed, keyed as {@link keyOf} writes them. */
let quorums: ReadonlyMap<string, string> = new Map()

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
  /** VER-04 — one quorum sentence per rung key, keyed as {@link keyOf} writes them. */
  quorums: ReadonlyMap<string, string>
}> {
  const spawned: BenchProcess = spawn(process.execPath, [BENCH, '--quick', '--discover'], {
    cwd: workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child = spawned

  const gathered: RungReading[] = []
  const seenHeadings: string[] = []
  /** VER-04 — one quorum sentence per rung key, in the driver's own words. */
  const quorums = new Map<string, string>()

  await new Promise<void>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let consumed = 0
    let pending: { transport: 'memory' | 'real'; nodes: number } | null = null
    /** The rung the last map-attestation line named — what a quorum line belongs to. */
    let lastRung: string | null = null

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
        // VER-04's line arrives AFTER the map attestation for the same rung, so it is
        // matched against the rung the last attestation named rather than against
        // `pending` — which that line has already cleared. Recorded before the resolve
        // check below, and the check now waits for it: a promise that resolved on the
        // attestation alone would return before this rung's quorum line was ever read,
        // which is the shape of bug that makes a case pass by never seeing its subject.
        const quorumLine = QUORUM.exec(line)
        if (quorumLine !== null && lastRung !== null) {
          quorums.set(lastRung, quorumLine[2] ?? '')
          if (
            AWAITED.every(
              (key) =>
                gathered.some((r) => keyOf(r.transport, r.nodes) === key) && quorums.has(key),
            )
          ) {
            clearTimeout(timer)
            resolve()
            return
          }
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
        lastRung = keyOf(pending.transport, pending.nodes)
        pending = null
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

  return { readings: gathered, headings: seenHeadings, quorums }
}

/**
 * The condition a spawn must meet to be kept — see {@link MAX_ATTEMPTS}.
 *
 * **A rung that reached the population it is capable of is kept whatever it printed.** This
 * asks only whether there was a job to read a receipt off, which is the driver-stall condition
 * deferred item 4 describes, and it deliberately does not look at the strength: a rung that ran
 * and printed the wrong label must fail, not be spawned again until it agrees.
 *
 * **It compared against `COMPLETED_RUN` for both rungs until VER-11, 2026-09-16, and that is
 * now a condition `real/2` cannot meet** — see {@link DEGRADED_RUN}. Left as it was, this
 * predicate would spawn the driver `MAX_ATTEMPTS` times on every green run and then fail, which
 * is a stall guard that has become the stall. It is narrowed per rung rather than weakened to
 * *returned anything*: `real/1` still has to complete, so the guard keeps its teeth on the one
 * rung that can.
 */
function everyRealRungCompleted(found: readonly RungReading[]): boolean {
  return AWAITED.every((key) =>
    found.some((r) => keyOf(r.transport, r.nodes) === key && r.population === EXPECTED_POPULATION.get(key)),
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
      quorums = outcome.quorums
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

/**
 * The strength a rung reported, with its counts and the sentence beside it.
 *
 * `issuers` arrived with the third count group on 2026-09-16 and the description capture moved
 * from index 4 to index 5 with it — a group inserted ahead of one already read renumbers it, and
 * a record still reading `hit[4]` would silently start returning the issuer digit where the
 * kernel's sentence belongs.
 */
function strengthOf(transport: 'memory' | 'real', nodes: number): {
  strength: string
  replicas: number
  operators: number
  issuers: number
  description: string
} {
  const { reading } = rung(transport, nodes)
  return parseStrength(reading, `${keyOf(transport, nodes)} reported no strength`)
}

/**
 * {@link STRENGTH} applied to one line, by the same code path whatever the line's origin.
 *
 * Split out of {@link strengthOf} so the VER-12 case below can put a **synthetic** line through
 * the identical parser it puts the real rungs through. A control that parsed its own input some
 * other way would be testing a second reader rather than this one.
 */
function parseStrength(
  reading: string,
  context: string,
): { strength: string; replicas: number; operators: number; issuers: number; description: string } {
  const hit = STRENGTH.exec(reading)
  if (hit === null) {
    throw new Error(`${context}: ${reading}\n${attemptLog.join('\n')}`)
  }
  return {
    strength: hit[1] ?? '',
    replicas: Number(hit[2]),
    operators: Number(hit[3]),
    issuers: Number(hit[4]),
    description: hit[5] ?? '',
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
      // Four labels since 2026-09-16, VER-12. Enumerated exhaustively rather than sampled: a
      // driver that started appending the label this phase introduced would otherwise walk
      // straight past a check written to catch exactly that.
      for (const strength of [
        'owner-attested',
        'owner-domain',
        'single-issuer',
        'independent',
      ] as const) {
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

  it('reads owner-domain off the two-worker rung, which is what makes it a distinction', async () => {
    await readings()
    const two = strengthOf('real', 2)
    // `independent` / `operators: 2` until 2026-09-16 — see this file's header for why that was
    // a label nothing about the rig supported. **Two replicas, and the job still completed**: the quorum
    // refuses and the shard degrades rather than failing, which is `runs-at-available-redundancy`
    // working. A rung that reported `owner-domain` at ONE replica would be a different defect
    // and is why the count is asserted beside the word.
    expect(two.strength).toBe('owner-domain')
    expect(two.replicas).toBe(2)
    expect(two.operators).toBe(1)
    expect(two.description).toBe(describeAttestation('owner-domain'))
    // `COMPLETED_RUN` until 2026-09-16. The rung's job now DEGRADES — the quorum refuses
    // `insufficient-operators` on one operator, and the default dial runs at the redundancy
    // available rather than failing — so `Observation.complete` is false while both replicas
    // still ran and agreed. Asserted rather than tolerated: a rung that silently went back to
    // completing would mean the gate had stopped refusing.
    expect(rung('real', 2).population, attemptLog.join('\n')).toBe(DEGRADED_RUN)

    // Asserted as a pair and deliberately here rather than in a fourth case: either
    // reading alone passes against a driver that prints one constant, and it is the two
    // *differing on one surface* that shows the labels are distinct rather than asserted
    // to be.
    expect([strengthOf('real', 1).strength, two.strength]).toEqual(['owner-attested', 'owner-domain'])
    expect(describeAttestation('owner-attested')).not.toBe(describeAttestation('owner-domain'))
  }, SPAWN_TIMEOUT_MS)

  /**
   * **VER-04 — and the reason it needed its own line is that the case above cannot carry it.**
   *
   * A strength is computed by `classifyAttestation` from who **answered and signed**, so it
   * prints identically on a fabric where the quorum gate never ran at all — the operators that
   * happened to be asked read exactly like operators selected under anti-affinity. So every
   * assertion in this file, before this one, was satisfied by a driver that composed no quorum
   * whatever. (It read `independent (replicas 2, operators 2)` when that was written; the rung
   * reads `owner-domain (replicas 2, operators 1)` since VER-11, and the argument is unchanged
   * — a strength cannot evidence the gate whatever its value.)
   *
   * VER-04's claim is about **composition**: one operator cannot supply a whole quorum. The
   * line read here is the composer's own verdict, and `ShardQuorum`'s docblock argues the
   * separation this depends on — *"`operators` here are the operators that were **asked**;
   * `ShardAttestation` reports who **answered and signed**"*, and reading a strength off the
   * gate *"would be the exact conflation this phase exists to end"*.
   *
   * **WHICH ARM THIS CASE READS CHANGED ON 2026-09-16, VER-11, and the paragraph it replaces is
   * kept because it was true and because what replaced it is the stronger reading.** It said:
   *
   * > this rig gives every worker a distinct `operatorId`, so the gate's refusal arm —
   * > `insufficient-operators`, the arm that fires when one operator would supply the whole
   * > quorum — is never reached here. That arm is carried by `quorum-agents.node.test.ts`
   * > against a fabric built for it. What is established is that the gate **ran, composed, and
   * > named the operators it composed over** on a real entry point.
   *
   * The rig gave every worker a distinct `operatorId` **string**; it gave them all one user
   * key. A provider now derives the field, so this rung IS one operator and the gate reaches
   * exactly the arm the paragraph says it never could. **The composed arm's reading on this
   * driver is therefore gone, and that is recorded rather than restored**: `quorum-ui.e2e.test.ts`
   * carries it — two independently-run relays, four distinct owners, on the surface a visitor
   * reads — and it is the evidence `VER-04`'s own ledger row cites as closing.
   *
   * **What is gained is not a consolation.** `insufficient-operators` had no reader on this
   * driver at all, and this file's own history says what that cost: `bin/bench.ts` rendered
   * the refusal arm as `not composed (${quorum.refusal})` — interpolating the object — so
   * every refusal it ever printed said `[object Object]`, and nothing caught it because no
   * assertion here read that arm. It reads it now.
   */
  it('VER-04 — reads the quorum gate refusing this rig, which the strength beside it cannot evidence', async () => {
    await readings()

    const composed = quorums.get('real/2')
    expect(
      composed,
      `no quorum line for real/2. Lines seen: ${JSON.stringify([...quorums])}\n${attemptLog.join('\n')}`,
    ).toBeDefined()

    // The gate RAN and reached a verdict about this rig — `not attempted` is the arm that means
    // it never ran, and is what the one-node rung reads. Asserted before the sentence so a
    // driver that skipped the gate fails here, naming that, rather than at a `toContain`.
    expect(composed).not.toContain('not attempted')

    // **The refusal in the kernel's own words, verbatim.** Measured off a real run, written as
    // a literal: a fixture that rebuilt this sentence from `describeQuorum` would move with any
    // rewording and could never fail. `[object Object]` is what this line said for weeks while
    // nothing read it.
    expect(composed).toContain('not composed [insufficient-operators]')
    expect(composed).toContain('quorum of 2 needs 2 distinct operators, found 1')

    // **And the job completed anyway**, which is the half a refusal alone does not show: the
    // default dial degrades rather than failing, so the rung still reports two replicas at a
    // weaker strength. The case above asserts that pair; named here so a reader of this one
    // does not conclude the refusal cost the run.

    // And the rung that cannot compose says so, with a reason rather than by silence.
    // `redundancy: Math.min(2, nodes)` is 1 at one node, so there is nothing to verify —
    // the gate's own first condition. This is the pair that makes the line a distinction
    // rather than a constant, exactly as the strength cases above are asserted in pairs.
    const one = quorums.get('real/1')
    expect(one, `no quorum line for real/1\n${attemptLog.join('\n')}`).toBeDefined()
    expect(one).toContain('not attempted')
    expect(one).not.toContain('composed across')

    // Both readings came off runs that returned a job, so neither is a statement about a
    // driver that stalled — and each is asserted against the strongest population its own rung
    // can reach, which stopped being the same value on 2026-09-16.
    expect(rung('real', 2).population, attemptLog.join('\n')).toBe(DEGRADED_RUN)
    expect(rung('real', 1).population, attemptLog.join('\n')).toBe(COMPLETED_RUN)
  }, SPAWN_TIMEOUT_MS)

  /**
   * **VER-12 — the rungs are MEASURED to sit below the issuer rule, not believed to.**
   *
   * `45-CONTEXT.md` §4 draws the line this case stands on: a test fixture may be handed a
   * second certificate authority, because the number of parties is the thing the rule counts —
   * but a driver that publishes a reading of a real rig may not, because its labels have to
   * describe the rig. `bin/bench.ts` is such a driver, and the belief about it is that its real
   * rungs cannot reach `single-issuer` at all: every worker enrols under `BENCH_USER_SEED`
   * unless `--sovereign` is passed, so a `--discover` rung is **one operator**, and the label
   * that needs two operators and one authority is unreachable before the authority count is
   * even consulted. §4 says in as many words: *verify that, do not assume it.*
   *
   * ## An absence is worth exactly what its control is worth
   *
   * Two assertions of a negative — no rung reports the label, no rung refuses on the issuer
   * ground — are both satisfied by an instrument that cannot see the label at all. This file
   * has already paid for that lesson once, and recently: on the commit that added a third count
   * to the driver and left {@link STRENGTH} at two, the absence case at the top of this
   * `describe` went **green while its only instrument matched nothing**. So the negative here is
   * carried by two controls, and they answer two different questions:
   *
   * - **shape** — a `single-issuer` line whose parenthetical is a real rung's own bytes,
   *   lifted out of a reading the driver just emitted rather than typed here. If the driver's
   *   template moves, this control moves with it and fails against a stale pattern, which is
   *   precisely what a control typed beside the pattern could never do.
   * - **groups** — a line whose three counts are three *different* numbers, so the parsed
   *   record proves the groups are the ones this file thinks they are. The shape control cannot
   *   ask this: every count on the real rungs is 1 or 2, and a pattern with its groups
   *   transposed reads those back indistinguishably.
   *
   * Both go through {@link parseStrength}, the same call the real rungs go through — a control
   * that parsed its input some other way would be a reading of a second parser.
   */
  it('VER-12 — no real rung reaches single-issuer, and the instrument could have seen it', async () => {
    await readings()

    // ---- the control, first, so a stale instrument fails HERE and names itself -------------
    //
    // Deliberately before the absence below. A vacuous instrument that is asked for the
    // negative first reports the negative, truthfully and uselessly, and the run is green.
    const emitted = rung('real', 1).reading
    const opened = emitted.indexOf(' (')
    const closed = emitted.indexOf(') — ')
    expect(opened, `no parenthetical in the driver's own line: ${emitted}`).toBeGreaterThan(0)
    expect(closed, `no parenthetical in the driver's own line: ${emitted}`).toBeGreaterThan(opened)
    // The driver's bytes, not this file's: everything between its own parentheses, carried
    // across verbatim under a different label and the kernel's sentence for that label.
    const shapeControl =
      `single-issuer ${emitted.slice(opened + 1, closed + 1)} — ${describeAttestation('single-issuer')}`
    const shaped = parseStrength(shapeControl, 'the shape control did not parse')
    expect(shaped.strength).toBe('single-issuer')
    expect(shaped.description).toBe(describeAttestation('single-issuer'))

    // Three different numbers, so a transposed or misnumbered group cannot read back as the
    // right answer — which all-ones and the 2/1/1 of the real rungs both would.
    const groupControl =
      `single-issuer (replicas 5, operators 3, issuers 2) — ${describeAttestation('single-issuer')}`
    const grouped = parseStrength(groupControl, 'the group control did not parse')
    expect(grouped.strength).toBe('single-issuer')
    expect(grouped.replicas).toBe(5)
    expect(grouped.operators).toBe(3)
    expect(grouped.issuers).toBe(2)
    expect(grouped.description).toBe(describeAttestation('single-issuer'))

    // ---- and now the absence, on an instrument just shown to be able to see it -------------
    for (const nodes of [1, 2]) {
      const reading = strengthOf('real', nodes)
      expect(reading.strength, `real/${String(nodes)}: ${rung('real', nodes).reading}`).not.toBe(
        'single-issuer',
      )
      // The mechanism, asserted rather than left to the label: one operator is why the rung
      // cannot reach a label that needs two, and one authority is what the fabric currently
      // has. Both as literals — a count recomputed from the reading would agree with itself.
      expect(reading.operators).toBe(1)
      expect(reading.issuers).toBe(1)
      // And the composer never refused on the issuer ground either. A rung that refused there
      // would be a rig the rule DOES reach, whatever label survived the degrade.
      expect(quorums.get(`real/${String(nodes)}`) ?? '').not.toContain('single-issuer-quorum')
    }

    // The sentence too, not only the word: a driver appending the label's own sentence after a
    // weaker strength would pass every assertion above.
    for (const nodes of [1, 2]) {
      expect(rung('real', nodes).reading).not.toContain(describeAttestation('single-issuer'))
    }
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
