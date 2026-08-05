import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { delegate } from '@o2/core'

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
  /** Sovereign shards submitted. The leg submits exactly one. */
  readonly submitted: number
  /** First eight hex characters of the key the chain is rooted at. */
  readonly root: string
  /** The peer id(s) the chain was minted for, or the driver's word for nobody. */
  readonly audience: string
  /** Whether the `--discover:` line appeared too — the arm this leg rides. */
  readonly discovered: boolean
}

/** The leg's own sentence, parsed back out of it rather than restated here. */
const LEG_LINE =
  /^--sovereign: (\d+) of (\d+) sovereign shards agreed, chain rooted at ([0-9a-f]+), audience (\S+)$/

/** The discover arm's sentence, read only for its presence. */
const DISCOVER_LINE = /^--discover: \d+ of \d+ workers qualified from \d+ providers/

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
          root: hit[3] ?? '',
          audience: hit[4] ?? '',
          discovered,
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

      // One submitted, and the denominator is asserted rather than read past: the leg is
      // designed around exactly one owner-labelled shard, and a run that labelled every
      // shard sovereign would be measuring a different job.
      expect(leg.submitted).toBe(1)
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
