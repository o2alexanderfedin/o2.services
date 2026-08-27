import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { delegate, describeAttestation } from '@o2/core'

/**
 * `bin/bench.ts --discover --sovereign` is executed, and the leg's own line is read.
 *
 * ## Why this file exists
 *
 * AUTH-03's requestor half — `delegate` (`@o2/core`) and `CapabilitySupplier` (`@o2/net`) —
 * shipped complete, fuzzed, and verified at the *serving* end in Phase 15, with **zero
 * production callers**. Owner ruling 2026-07-31 declined to accept that as
 * entry-point-unreachable, and BENCH-07 criterion 5 routed the fix into this driver.
 *
 * What would hold that repair without this file is a **source-text count**, and
 * `serve-agent-hooks.node.test.ts` carries four. A count distinguishes a written call site
 * from a deleted one and from nothing else: it passes over a leg that throws on its first
 * line, over one whose chain verifies against nobody, and over one whose printed line no
 * longer means what it says. So this runs the driver and reads the number it prints.
 *
 * ## Why it kills the driver rather than waiting for it
 *
 * The leg speaks while the **first real-transport rig is being built**. The run then goes
 * on to measure two real rungs, a skewed sweep and two baselines. Waiting for that buys a
 * slower test and no extra reading — the subject is the leg, and the leg has finished
 * speaking. **Measured on this host, load 4.5: the `--sovereign:` line arrives at t+1494
 * ms**, and the whole `--quick --discover --sovereign` run takes 6.4 s wall. That number is
 * recorded here and in `23-06-SUMMARY.md` rather than asserted — see the next section.
 *
 * ## Why it is not a benchmark and must not become one
 *
 * Every number this driver publishes is invalidated by contention, and this file is meant
 * to run beside the rest of the suite. It reads **counts and text**, which are
 * contention-independent, and never a duration. `ARM_BUDGET_MS` is a ceiling that is only
 * ever reached when the leg is gone, which is the failure this file is for — not an
 * estimate of how long the leg takes.
 *
 * ## Why `cwd` is a temporary directory
 *
 * `main()` opens with `mkdir(join(process.cwd(), '.planning', 'bench'))` and the run writes
 * its report there. Spawned with the repository as `cwd`, a test run would overwrite
 * committed measurements as a side effect of checking a flag. The temp `cwd` is asserted
 * rather than assumed, and the published report is compared across the run.
 *
 * ## What this file CANNOT prove, and what carries that half instead
 *
 * **It cannot tell a chain that verified from a chain the worker was never asked for.**
 * Both produce an agreed shard, and from stdout the two are the same sentence. A driver
 * that printed `--sovereign: 1 of 1 …` from a constant, with no leg behind it at all, would
 * pass every assertion below — the count is parsed rather than matched, but a constant
 * parses.
 *
 * **The reading that carries that half is the driver's own throw**, and it was watched. The
 * leg throws when its shard did not agree, carrying the fabric's own words, and four
 * mutations were planted against it on 2026-08-05 (observed text in `23-06-SUMMARY.md`):
 *
 * 1. `sovereignSupplierFor` returning nothing → `unauthorized: no capability chain supplied`
 * 2. the chain minted with a **different private key** → `unauthorized: link 0 is issued by
 *    1398f62c…, but the data owner's key is ea4a6c63…`. This is the one that matters: the
 *    leg cannot pass by minting something merely *shaped* like a chain.
 * 3. `canExecuteSovereign: false` → `no executable node for owner ea4a6c63…`
 * 4. the owner's row not seeded onto the owner's own node → `input block missing: bafyreib…`
 *
 * Each of those made both real rungs come back `excluded:` with that text, and the
 * real-transport egress manifest read `0 frames, 0 bytes`.
 *
 * ## Reddening — what was planted against THIS file, and what it proved
 *
 * Delete the `if (SOVEREIGN && fixture === 'trivial') { … }` block from `realFabric`. No
 * `--sovereign:` line is ever printed and Case 1 fails on the read. That is the `<done>`
 * condition: removing the leg fails a run, not only a grep. Observed text is in the summary.
 */

const BENCH = fileURLToPath(new URL('./bin/bench.ts', import.meta.url))
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/** The published measurements this run may not touch. Repo-relative, as git prints them. */
const PUBLISHED = ['.planning/BENCHMARK-RESULTS.md', '.planning/bench/raw.json'] as const

/**
 * How long the leg gets to speak.
 *
 * Measured at ~1.5 s on this host. Two minutes is headroom for a loaded one, not an
 * estimate of the mechanism — and it is a ceiling only ever reached when the leg is gone.
 */
const ARM_BUDGET_MS = 120_000

/**
 * The leg's own first word — what says it ran at all.
 *
 * Read out of the driver's output rather than timed, so the discrimination below is about
 * evidence and not about a clock this file refuses to assert on.
 */
const SOVEREIGN_LINE = '--sovereign attestation:'

/** The message that separates a slow machine from an absent leg. Matched, so it is one string. */
const LEG_SPOKE_THEN_STALLED = 'the sovereign leg printed its attestation and the driver then ran out of budget'

/** Per-`it` budget: one spawn, one read, one teardown. */
const TEST_TIMEOUT_MS = 180_000

/**
 * The chain's root, derived here **independently of the driver**.
 *
 * `bin/bench.ts` roots its chain at `BENCH_USER_SEED` — `new Uint8Array(32).fill(7)`, the
 * key every `--discover` worker enrols under — and prints the first eight hex characters of
 * the public half. This re-derives that value the same way the driver does, through
 * `delegate`'s issuer field, so the assertion below compares the printed root against a key
 * computed here rather than against a string transcribed from the driver's output. A leg
 * rooted at any other key disagrees.
 *
 * It is deliberately **not** an import from `bin/bench.ts`: that module's top level starts a
 * benchmark, so importing it would run one.
 */
const EXPECTED_ROOT = delegate(new Uint8Array(32).fill(7), {
  ownerId: 'derives-a-public-key-and-is-never-sent',
  audience: 'derives-a-public-key-and-is-never-sent',
  abilities: ['execute'],
  expiresAt: 1,
}).issuer.slice(0, 8)

type BenchProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface LegReading {
  /** Sovereign shards that agreed. */
  readonly agreed: number
  /** Sovereign shards submitted. */
  readonly submitted: number
  /** How many DISTINCT owners those shards were pinned to — 1 on a one-worker rung, else 2. */
  readonly owners: number
  /** First eight hex characters of the key the chain is rooted at. */
  readonly root: string
  /** The peer id(s) the chain was minted for, or the driver's word for nobody. */
  readonly audience: string
  /** Whether the `--discover:` line appeared too — the arm this leg rides. */
  readonly discovered: boolean
  /**
   * The attestation line the leg prints for its **owner-pinned** shard — VER-09.
   *
   * `null` when no such line arrived, which is a failure and not an absence: the driver
   * prints it unconditionally once the shard has been read, including on the arm that is
   * about to throw. Kept nullable so a missing line fails at an assertion naming it rather
   * than at a regex returning `undefined` two frames away.
   */
  readonly attestation: string | null
}

/**
 * The leg's own sentence, parsed back out of it rather than restated here.
 *
 * **`across N owner(s)` was added on 2026-08-14 and is the reading MR-02's plural claim turns
 * on.** Without it the line is satisfied identically by one owner holding two rows and by two
 * owners holding one each — and those are different claims, only the second of which is what
 * *"each owner computes a local partial over its own data"* says.
 */
const LEG_LINE =
  /^--sovereign: (\d+) of (\d+) sovereign shards agreed across (\d+) owner\(s\), chain rooted at ([0-9a-f]+), audience (\S+)$/

/** The discover arm's sentence, read only for its presence. */
const DISCOVER_LINE = /^--discover: \d+ of \d+ workers qualified from \d+ providers/

/**
 * The leg's receipt line — VER-09.
 *
 * Captures the whole tail rather than the strength word alone, so the replica and operator
 * counts and the kernel's own sentence are all asserted from one reading. A pattern that
 * matched only `owner-attested` would pass over a line reporting that label beside
 * `replicas 2`, which is a different claim about a different job.
 */
const ATTESTATION_LINE = /^--sovereign attestation: (.+)$/

/**
 * The receipt the leg must print — VER-09.
 *
 * Composed here from `describeAttestation`, imported from `@o2/core`, rather than
 * transcribed from a run. That is the same move `EXPECTED_ROOT` makes one constant up: the
 * assertion then compares the driver's output against a value **this file derived**, so a
 * driver that stopped reading `ShardResult.attestation` and started printing a string of
 * its own would have to reproduce the kernel's sentence exactly in order to pass.
 *
 * The two counts are literals and are the honest ones for this leg, not a transcription
 * either: the leg submits its owner-pinned shards at `redundancy: 1` — stated in
 * `bin/bench.ts` as the honest figure, because every worker in the rig enrols under one
 * user key and pinning data to one owner removes the second independent executor — and the
 * requestor holds a certificate for exactly the one node it placed on.
 *
 * **The counts are per-SHARD and did not move when the leg went from one row to two on
 * 2026-08-14.** A strength is computed for each shard on its own, so a second owner-pinned
 * row alongside the first changes neither `replicas 1` nor `operators 1`; the driver still
 * prints the strength of shard 0. Said explicitly because "the leg now submits two" and
 * "the receipt still reads one replica" look contradictory until the per-shard scope is
 * named — and a reader who assumed otherwise would 'fix' this constant and break it.
 */
const EXPECTED_RECEIPT = `owner-attested (replicas 1, operators 1) — ${describeAttestation('owner-attested')}`

/** The driver's own report of a rung that threw. Reached when the leg refuses to report a zero. */
const EXCLUDED_LINE = /^\s*excluded: --sovereign:/

let workdir: string
let child: BenchProcess | null = null

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-sovereign-arm-'))
})

afterEach(async () => {
  await stopBench()
  await rm(workdir, { recursive: true, force: true })
})

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
 * The repository's view of the two published files, and only those.
 *
 * **Narrowed to the paths at risk, deliberately.** `discover-arm.node.test.ts` and
 * `bench-attestation.node.test.ts` both snapshot the *whole* tree's porcelain and both went
 * red during Plan 20-09's runs because a concurrent agent staged a file mid-run — a fact
 * about this shared checkout and not about the driver. `coverage-agents.node.test.ts`
 * records that reason and narrows; this follows it.
 */
function publishedStatus(): string {
  return execFileSync('git', ['status', '--porcelain', '--', ...PUBLISHED], {
    cwd: REPO,
    encoding: 'utf8',
  })
}

/**
 * Spawn the driver in `workdir` and resolve on the leg's line.
 *
 * `'pipe'` on fd 0 rather than `'ignore'`, per the guard at the bottom of
 * `orphan-leash.node.test.ts`: an ignored stdin is a character device, which opts a child
 * out of the leash. `bench.ts` does not arm one — it is a declared exception there, being
 * one-shot — but a spawn site that hands over the wrong thing is the defect that guard
 * exists to stop spreading.
 */
async function readLegLine(): Promise<LegReading> {
  const spawned: BenchProcess = spawn(
    process.execPath,
    [BENCH, '--quick', '--discover', '--sovereign'],
    { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child = spawned

  return new Promise<LegReading>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let discovered = false
    let attestation: string | null = null
    const timer = setTimeout(
      () =>
        reject(
          new Error(`no --sovereign line within budget.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
        ),
      ARM_BUDGET_MS,
    )

    spawned.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    spawned.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      // Whole lines only — the leg's line is parsed, and a half-arrived one parses to
      // nothing, which would read as "no leg" rather than as "not yet".
      for (const line of stdout.split('\n').slice(0, -1)) {
        const trimmed = line.trim()
        if (DISCOVER_LINE.test(trimmed)) discovered = true
        // Read before the leg line, because the driver prints it before the leg line. If
        // that order is ever inverted this stays `null` and Case 1 fails naming it, which
        // is the right failure: a receipt printed after the line this promise resolves on
        // is a receipt this file never sees.
        const receipt = ATTESTATION_LINE.exec(trimmed)
        if (receipt !== null) attestation = receipt[1] ?? null
        // Reached when the leg threw *before* printing — the owner-key cross-check, or a
        // row that would not encode. Rejecting on it turns a two-minute timeout into an
        // immediate failure carrying the driver's own words, which is what a reader acts on.
        if (EXCLUDED_LINE.test(line)) {
          clearTimeout(timer)
          reject(new Error(`the leg excluded its rung before speaking:\n${line.trim()}`))
          return
        }
        const hit = LEG_LINE.exec(trimmed)
        if (hit === null) continue
        clearTimeout(timer)
        resolve({
          agreed: Number(hit[1]),
          submitted: Number(hit[2]),
          owners: Number(hit[3]),
          root: hit[4] ?? '',
          audience: hit[5] ?? '',
          discovered,
          attestation,
        })
        return
      }
    })

    spawned.on('exit', (code) => {
      clearTimeout(timer)
      // Reached when the leg throws before the line is written, or when the driver dies for
      // a reason of its own. Reported with the child's own words, because "exited early" on
      // its own is the uninformative failure this file replaces.
      reject(
        new Error(
          `bench exited with ${String(code)} before the leg spoke.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      )
    })
  })
}

/** The aggregation half's line, one per rung of `REAL_LADDER`. */
const AGGREGATION_LINE = /^--sovereign aggregation: (.+)$/

/**
 * Run the driver **to completion** and return every aggregation line it printed.
 *
 * Separate from {@link readLegLine}, which resolves on the *first* leg line and kills the
 * child — and the first rung is exactly the one that cannot aggregate. `REAL_LADDER` under
 * `--quick` is `[1, 2]`: the one-worker rung has a single combine executor, below the two a
 * sovereign aggregation is verified at, so a reader that stopped there would witness only
 * the refusal and could never see the arm run. Reading to exit is what makes the passing
 * rung observable at all.
 */
async function readWholeRun(): Promise<{
  readonly aggregation: readonly string[]
  readonly owners: readonly number[]
}> {
  const spawned: BenchProcess = spawn(
    process.execPath,
    [BENCH, '--quick', '--discover', '--sovereign'],
    { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child = spawned

  return new Promise<{ readonly aggregation: readonly string[]; readonly owners: readonly number[] }>(
    (resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        // **THE BUDGET'S OWN STATED RULE, MOVED INTO THE CONDITION — 2026-08-26.** This file's
        // header says `ARM_BUDGET_MS` *"is a ceiling that is only ever reached when the leg is
        // gone, which is the failure this file is for — not an estimate of how long the leg
        // takes."* A whole-lane run that night reached it with the leg plainly PRESENT: the
        // captured stdout carried `--sovereign attestation: owner-attested (replicas 1,
        // operators 1)` and `--sovereign: 2 of 2 sovereign shards agreed`, and the driver was
        // still walking its ladder. The file passes SOLO in 18.5 s against a 120 s ceiling, so
        // the run was 6.5x its own quiet figure.
        //
        // The discriminator needs no host calibration, and that is the point: it is the LEG'S
        // OWN OUTPUT, which is exactly what this file says it reads — *"counts and text, which
        // are contention-independent"*. A driver that printed the sovereign lines and then ran
        // out of clock is a slow machine; a driver that printed none of them is the leg being
        // gone, which is the failure this file exists for and still rejects.
        reject(
          new Error(
            `${stdout.includes(SOVEREIGN_LINE) ? LEG_SPOKE_THEN_STALLED : 'driver did not exit within budget'}.` +
              `\nstdout:\n${stdout}`,
          ),
        )
      }, ARM_BUDGET_MS)
      spawned.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      spawned.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      spawned.on('exit', (code) => {
        clearTimeout(timer)
        // A non-zero exit is reported rather than parsed past. The lines this function
        // returns are only evidence about a run that finished; harvesting them from a driver
        // that died would report the aggregation of a job that was cut short.
        if (code !== 0) {
          reject(
            new Error(`bench exited with ${String(code)}.\nstdout:\n${stdout}\nstderr:\n${stderr}`),
          )
          return
        }
        const aggregation: string[] = []
        const owners: number[] = []
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim()
          const agg = AGGREGATION_LINE.exec(trimmed)
          if (agg !== null && agg[1] !== undefined) aggregation.push(agg[1])
          // The owner count per rung, read off the leg line the same way — so the two arrays
          // are index-aligned by rung and a case can assert that the rung which aggregated is
          // the rung that had two owners.
          const leg = LEG_LINE.exec(trimmed)
          if (leg !== null && leg[3] !== undefined) owners.push(Number(leg[3]))
        }
        resolve({ aggregation, owners })
      })
    },
  )
}

describe('the --sovereign leg runs, and says what it dispatched', () => {
  it(
    'mints a chain rooted at the enrolled owner key and gets one owner-labelled shard agreed',
    async () => {
      // Asserted before anything is spawned: a misconfigured `cwd` would have the driver
      // overwrite the repository's committed measurements as a side effect of this check.
      expect(workdir.startsWith(tmpdir())).toBe(true)

      const before = publishedStatus()
      const published = join(REPO, '.planning', 'BENCHMARK-RESULTS.md')
      const publishedBytes = await readFile(published)

      const leg = await readLegLine()

      // **The anti-vacuity reading, and it is the reason the leg rides `--discover`.** A
      // sovereign shard is placed only against a descriptor carrying a real owner id, and
      // only the discover arm builds one. If that arm did not run, the sovereign line means
      // nothing whatever it says.
      expect(leg.discovered).toBe(true)

      // **Two submitted, and the denominator is asserted rather than read past**: the leg is
      // designed around exactly two owner-labelled shards, and a run that labelled every
      // shard sovereign would be measuring a different job.
      //
      // **This read `toBe(1)` until 2026-08-14, and the count moved for a reason worth
      // stating here rather than only in the driver.** One contribution is *promoted rather
      // than combined*, so a one-shard leg could never reach `reduceSovereignJob` at all —
      // MR-02's aggregation half ran nowhere in production. Two is the smallest count at
      // which the leg demonstrates what MR-02 is about. Both shards are still pinned to the
      // **same** owner: the arm needs two contributions, not two owners, so no second
      // identity was enrolled and `BENCH_USER_SEED` is untouched.
      expect(leg.submitted).toBe(2)
      // Rung 1 has one worker and therefore one owner; the two-owner reading is the
      // whole-run case below, which reads every rung rather than the first.
      expect(leg.owners).toBe(1)
      // At least one agreed. Parsed out of the line rather than matched as a fixed string,
      // so a leg reporting `0 of 1` fails here rather than passing on the presence of a
      // line — which is the whole difference between this file and a source-text count.
      expect(leg.agreed).toBeGreaterThanOrEqual(1)

      // The chain is rooted at the key the workers enrol under, derived here independently.
      // See `EXPECTED_ROOT`.
      expect(leg.root).toBe(EXPECTED_ROOT)

      // The chain was minted for a node, not for nobody. `nobody` is what the driver prints
      // when the shard was never placed, so this distinguishes *dispatched and admitted*
      // from *unplaceable and reported*.
      expect(leg.audience).not.toBe('nobody')
      expect(leg.audience).toMatch(/^12D3Koo\w+$/)

      // Written where it was told to, and nowhere else.
      expect((await stat(join(workdir, '.planning', 'bench'))).isDirectory()).toBe(true)
      expect(publishedStatus()).toBe(before)
      expect(await readFile(published)).toStrictEqual(publishedBytes)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'VER-09 — prints owner-attested for the owner-pinned shard, over one replica from one operator',
    async () => {
      expect(workdir.startsWith(tmpdir())).toBe(true)

      const leg = await readLegLine()

      // The anti-vacuity reading again, and for the same reason: without the discover arm
      // no descriptor carries an owner, the shard is unplaceable, and any label printed
      // beside it would be a statement about a job that never ran.
      expect(leg.discovered).toBe(true)
      expect(leg.agreed).toBeGreaterThanOrEqual(1)

      // The line arrived at all. Asserted separately from its content so a driver that
      // stopped printing it fails here, naming the line, rather than at a `toContain`
      // against `null` that reads like a wrong label.
      expect(leg.attestation, `no --sovereign attestation line in the run`).not.toBeNull()
      const receipt = leg.attestation ?? ''

      // **The reading VER-09 was held open for.** Every strength this driver had printed
      // before today was of a *public* rung; this one is of a shard the requestor pinned to
      // an owner, placed on the single node holding that owner's row. `classifyAttestation`
      // computes the label from what the requestor could account for, so the three numbers
      // have to agree with each other: one replica, one operator, and the weakest of the
      // three labels.
      // An equality over the whole line, not a `toContain` on the label. Three reasons, and
      // the third is the one that decided it:
      //
      // 1. `owner-attested` is a **prefix** of nothing and a **substring** of nothing, but
      //    its own description ends *"not independently verified"* — so a naive
      //    `not.toContain('independent')` written to refuse the strongest label would fail
      //    against the correct line. An equality cannot be got wrong that way.
      // 2. The counts are what make the label mean anything. `owner-attested` beside
      //    `replicas 2` is a different claim about a different job, and a substring match
      //    over the label alone reads both as the same pass.
      // 3. The description is the **kernel's** sentence, filled by `attestationReceipt`
      //    from `describeAttestation`. Restating it here as a literal is what makes this a
      //    reading of the fabric's own words rather than of this driver's formatting: if
      //    the kernel's wording moves and the driver keeps printing its own, this fails.
      expect(receipt).toBe(EXPECTED_RECEIPT)

      // And it is a receipt rather than an absence, said separately because the equality
      // above would report a mismatch without saying which kind. `none established` is what
      // this driver prints for a rung whose replicas it could not account for — every
      // *memory* rung reads exactly that — so a sovereign leg printing it would mean the
      // chain, the certificate or the issuer pin had gone, not that the label was weak.
      expect(receipt).not.toContain('none established')
    },
    TEST_TIMEOUT_MS,
  )

  /**
   * **MR-02's aggregation half, which had no production caller until 2026-08-14.**
   *
   * Everything above this case reads the *map* half: a partial computed by the node holding
   * the owner's row, which `PROJECT.md` calls **owner-attested** rather than verified. The
   * half that carries the verification claim for owner-pinned data is the aggregation
   * **over** those partials, and `reduceSovereignJob` ran nowhere outside
   * `sovereign-aggregation.node.test.ts` — so the driver could print a full sovereign leg
   * while the verified half of the claim was never exercised by anything an operator runs.
   *
   * This case is what makes that observable from outside the process.
   */
  it(
    'MR-02 — the two-owner rung aggregates each owner’s own partial, and the one-owner rung says why it cannot',
    async (ctx) => {
      expect(workdir.startsWith(tmpdir())).toBe(true)
      const before = publishedStatus()

      // The one case in this file that reads the driver **to exit** rather than to its first
      // leg line, so it is the one the budget can run out on. See `ARM_BUDGET_MS`'s timer for
      // why a stall with the leg PRESENT is a different fact from a stall with it absent.
      let run: Awaited<ReturnType<typeof readWholeRun>>
      try {
        run = await readWholeRun()
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : String(cause)
        if (!text.includes(LEG_SPOKE_THEN_STALLED)) throw cause
        // `process.stdout.write`, not `console.log` and not `ctx.skip(note)` — measured on
        // vitest 4.1.10, both are swallowed on a skipped test. A skip nobody can read is a
        // fail-open, and this file's whole subject is a leg that might not be there.
        process.stdout.write(
          `[MR-02 / driver stalled] the sovereign leg RAN — its attestation line is in the ` +
            `captured output — and the driver then failed to exit inside ${ARM_BUDGET_MS}ms. ` +
            `This file passes alone in about 18s against that ceiling, so a stall here is the ` +
            `machine and not the leg, and the aggregation lines this case reads never arrived ` +
            `to be read. Re-run this file on its own. This is NOT a verdict about MR-02.\n`,
        )
        ctx.skip()
        return
      }
      const { aggregation: lines, owners } = run

      // One per rung of `REAL_LADDER`, which is `[1, 2]` under `--quick`. Asserted as an
      // equality rather than a lower bound: a driver that printed the line once would pass
      // a `>= 1` while having silently stopped attempting the arm on one of its rungs.
      expect(lines, `aggregation lines: ${JSON.stringify(lines)}`).toHaveLength(2)

      // **MR-02's plural claim, and it is the reading this whole leg exists for.** The rungs
      // are `[1, 2]` workers and `ownerOfWorker` alternates owners across them, so the
      // one-worker rung has one owner and the two-worker rung has two. Asserted as the exact
      // pair rather than "at least one rung had two", because a driver that quietly stopped
      // varying the owner would still satisfy a lower bound on the larger rung.
      expect(owners, `owner counts per rung: ${JSON.stringify(owners)}`).toStrictEqual([1, 2])

      // **The one-worker rung names its own limit rather than skipping.** A rung that
      // printed nothing is indistinguishable from a leg that was never wired — the same
      // rule the driver's zero-refusal is built on.
      const [first, second] = lines
      expect(first).toContain('not attempted')
      expect(first).toContain('combine executor(s)')

      // **The reading this whole case exists for.** The two-worker rung ran the arm: a real
      // combine, at the two replicas a sovereign aggregation is verified at, over partials
      // whose coverage is complete, with the egress guard having watched at least as many
      // rows as the job pinned.
      //
      // Asserted against the *fabric's* numbers rather than a fixed string, so a driver
      // that kept the wording and lost the arm fails here: `at 2 replicas` is
      // `MIN_SOVEREIGN_COMBINE_REPLICAS` achieved and not merely asked for, and `1/1 owners
      // complete` is coverage derived from the partials that were admitted.
      expect(second, `second rung's aggregation line: ${String(second)}`).not.toContain(
        'not attempted',
      )
      expect(second).not.toContain('refused')
      // **`2/2 owners complete`, not `1/1`.** The denominator is the count of DISTINCT owners
      // the job was defined over, derived by `reduceSovereignJob` from the shards it admitted
      // rather than declared — so this single assertion carries both halves of MR-02 at once:
      // two owners each contributed, and the aggregation over their contributions was
      // verified at two replicas. A one-owner rig reads `1/1` here and would fail.
      expect(second).toMatch(/^\d+ combine\(s\) at 2 replicas, coverage 2\/2 owners complete,/)
      expect(second).toContain('2 row(s) watched over 2 pinned')

      // Written where it was told to, and nowhere else — the same guard every case here
      // carries, because this one runs the driver to completion rather than killing it
      // early and so has the most opportunity to write.
      expect(publishedStatus()).toBe(before)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'refuses --sovereign without --discover, by name and with a non-zero exit',
    async () => {
      expect(workdir.startsWith(tmpdir())).toBe(true)
      const before = publishedStatus()

      const spawned: BenchProcess = spawn(process.execPath, [BENCH, '--sovereign'], {
        cwd: workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child = spawned

      let stdout = ''
      let stderr = ''
      spawned.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      spawned.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      const code = await new Promise<number | null>((resolve) => {
        spawned.on('exit', resolve)
      })

      // **This is the case that proves the flag refuses rather than implies**, and it is
      // cheap: the process exits before building anything. Replace the refusal with
      // `DISCOVER ||= SOVEREIGN` and the exit code becomes 0 and this fails.
      expect(code, `stdout:\n${stdout}\nstderr:\n${stderr}`).not.toBe(0)
      expect(code).not.toBe(null)

      // Named, and naming **both** flags: a refusal that said only "bad arguments" would
      // leave an operator to find the dependency by reading the source.
      expect(stderr).toContain('--sovereign')
      expect(stderr).toContain('--discover')

      // And the leg never spoke — the topology cannot have changed for a reason nobody
      // typed. Asserted on stdout rather than inferred from the exit code, because a
      // driver that ran the leg and *then* failed would also exit non-zero.
      expect(stdout).not.toContain('--sovereign:')

      // Nothing was written at all: `main()` is never reached, so not even the output
      // directory exists.
      await expect(stat(join(workdir, '.planning', 'bench'))).rejects.toThrow()
      expect(publishedStatus()).toBe(before)
    },
    TEST_TIMEOUT_MS,
  )
})
