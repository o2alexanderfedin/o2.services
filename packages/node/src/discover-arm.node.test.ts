import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * `bin/bench.ts --discover` is executed, and its qualification counts are read.
 *
 * ## Why this file exists
 *
 * `18-VERIFICATION.md` W-1: the arm was reachable from a runnable entry point and executed
 * by nothing in CI. What held it was a **source-text count** — a guard asserting the flag
 * still appears in the file. That distinguishes a working arm from a deleted one and from
 * nothing else: it passes over an arm that throws on its first line, over one whose
 * discovery answers zero, and over one whose output no longer means what it says.
 *
 * So this runs the driver and reads the number it prints. `--discover: 1 of 1 workers
 * qualified from 1 providers` is a real intersection of real provider answers with real
 * signed capability records, taken over a block a real worker really holds.
 *
 * ## Why it kills the driver rather than waiting for it
 *
 * The arm's line is printed while the **first real-transport rig is being built**, roughly
 * a second in; the run then spends minutes measuring six iterations across two rungs, a
 * skewed sweep and two baselines. Waiting for that would buy a slower test and no extra
 * reading — the subject is the arm, and the arm has finished speaking. Measured on this
 * host: `o2 benchmark` at t+0, three memory rungs by t+1 s, `--discover:` at t+1 s.
 *
 * **This is not a benchmark and must not become one.** Every number this driver publishes
 * is invalidated by contention, and this file is meant to run beside the rest of the
 * suite. It reads a count, which is contention-independent, and never a duration.
 *
 * ## What is deliberately NOT here, and where it went instead
 *
 * Plan 19-10 added an attestation line per rung — VER-09, VER-10, criterion 3's CLI half —
 * and those readings are in **`bench-attestation.node.test.ts`**, a sibling that spawns
 * the same binary the same way. They are not here because a rung's attestation line is
 * printed *after that rung's runs complete*: measured 2026-08-03, the two real-transport
 * readings arrive at t+62 s and t+153 s (t+213 s on a second run of the same tree). Folding
 * them in would have replaced this 4 s spec with a 3-minute one and broken the rule two
 * paragraphs up — so the fast half stays fast and the slow half carries its own measured
 * span. Neither file's readings are available from the other's stopping point, which is
 * why there are two.
 *
 * ## Why `cwd` is a temporary directory
 *
 * `main()` opens with `mkdir(join(process.cwd(), '.planning', 'bench'))` and the run writes
 * its report there. Spawned with the repository as `cwd`, a test run would overwrite
 * committed measurements with a partial run's — which is the reason the arm was never
 * covered in the first place, recorded in the file's own comment. The temp `cwd` is
 * asserted rather than assumed, and `git status --porcelain` is compared across the run.
 *
 * ## Reddening — what was planted, and what each planting proved
 *
 * 1. Delete the whole `if (DISCOVER) { … }` block in `realFabric`. No `--discover:` line is
 *    ever printed and this file times out on the read. That is `<done>`: removing the arm
 *    fails a run, not only a grep.
 * 2. Replace `trustedIssuers: new Set(provider?.issuerKey == null ? [] : [provider.issuerKey])`
 *    with `new Set()` inside the arm. Discovery qualifies nobody, the driver throws
 *    *"--discover found no candidates"*, and the child exits before printing.
 *
 * **The `admit:` line at `bin/bench.ts:723` is not on that list, and its absence is a
 * finding rather than an omission.** 18-13 planned it as this file's inversion proof; it
 * was planted and the run stayed **green**. Deleting it cannot redden any out-of-process
 * reading of *this* workload — it moves `submitJob` from `planWithOffers` to
 * `planPlacement`, and on a rig where no node ever refuses, the two place identically and
 * print identically. The offer traffic it removes shows up only in the real-transport
 * egress manifest, printed after the whole sweep this file declines to wait for.
 *
 * **Nothing else covers it either**, checked rather than assumed: no spec names
 * `rpcAdmission` together with this driver, and the two mutation-ledger entries on
 * `bin/bench.ts` (`B1`, `B2`) are keyed on its `LocalCapacity` construction sites, not on
 * this line. `discovery-agents.node.test.ts` reddens on `submitJob` ignoring `spec.admit`
 * — the kernel's half of the same wiring — but it builds its own rig and would not notice
 * this driver dropping the argument. So SCHED-02's *entry point* leg rests on the
 * source-text count in `serve-agent-hooks.node.test.ts` and on this file's proof that the
 * arm around it really runs. Closing it needs a reading of the offer traffic, which needs
 * the sweep this file must not wait for; it is named here so the next reader inherits it.
 */

const BENCH = fileURLToPath(new URL('./bin/bench.ts', import.meta.url))
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * How long the arm gets to speak.
 *
 * Measured at ~1 s on an unloaded host. Two minutes is headroom for a loaded one, not an
 * estimate of the mechanism — and it is a ceiling that is only ever reached when the arm
 * is gone, which is the failure this file is for.
 */
const ARM_BUDGET_MS = 120_000

/** Per-`it` budget: one spawn, one read, one teardown. */
const TEST_TIMEOUT_MS = 180_000

type BenchProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Qualification {
  readonly qualified: number
  readonly workers: number
  readonly providers: number
  readonly excluded: number
}

/** The arm's own sentence, parsed back out of it rather than restated here. */
const ARM_LINE =
  /^--discover: (\d+) of (\d+) workers qualified from (\d+) providers(?:, (\d+) excluded)?$/

let workdir: string
let child: BenchProcess | null = null

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-discover-arm-'))
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

/** The repository's own view of itself, which this run may not move. */
function repoStatus(): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' })
}

/**
 * Spawn the driver in `workdir` and resolve on the arm's line.
 *
 * `'pipe'` on fd 0 rather than `'ignore'`, per the guard at the bottom of
 * `orphan-leash.node.test.ts`: an ignored stdin is a character device, which opts a child
 * out of the leash. `bench.ts` does not arm one — it is a declared exception there, being
 * one-shot — but a spawn site that hands over the wrong thing is the defect that guard
 * exists to stop spreading, and it reads sources rather than behaviour.
 */
async function readArmLine(): Promise<Qualification> {
  const spawned: BenchProcess = spawn(process.execPath, [BENCH, '--quick', '--discover'], {
    cwd: workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child = spawned

  return new Promise<Qualification>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(
      () => reject(new Error(`no --discover line within budget.\nstdout:\n${stdout}\nstderr:\n${stderr}`)),
      ARM_BUDGET_MS,
    )

    spawned.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    spawned.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      // Whole lines only — the arm's line is parsed, and a half-arrived one parses to
      // nothing, which would be read as "no arm" rather than as "not yet".
      for (const line of stdout.split('\n').slice(0, -1)) {
        const hit = ARM_LINE.exec(line.trim())
        if (hit === null) continue
        clearTimeout(timer)
        resolve({
          qualified: Number(hit[1]),
          workers: Number(hit[2]),
          providers: Number(hit[3]),
          excluded: hit[4] === undefined ? 0 : Number(hit[4]),
        })
        return
      }
    })

    spawned.on('exit', (code) => {
      clearTimeout(timer)
      // Reached when the arm throws — `--discover found no candidates` exits before the
      // line is written. Reported with the child's own words, because "exited early" on
      // its own is the uninformative failure this file replaces.
      reject(new Error(`bench exited with ${String(code)} before the arm spoke.\nstderr:\n${stderr}`))
    })
  })
}

describe('the --discover arm runs, and says what it qualified', () => {
  it(
    'intersects real provider answers with real capability records on the first real rig',
    async () => {
      const before = repoStatus()
      const found = await readArmLine()

      // The 1-node rung of `REAL_LADDER` under `--quick`: one worker, given the module
      // block explicitly by the arm, enrolled by the one provider the rig stands up. Every
      // figure is derived from that construction, so an equality is a reading and not a
      // transcription — a rig that answered from zero providers, or qualified zero of one,
      // or excluded somebody, disagrees here.
      expect(found).toEqual({ qualified: 1, workers: 1, providers: 1, excluded: 0 })

      // Written where it was told to, and nowhere else.
      const outDir = join(workdir, '.planning', 'bench')
      expect((await stat(outDir)).isDirectory()).toBe(true)
      expect(repoStatus()).toBe(before)
    },
    TEST_TIMEOUT_MS,
  )
})
