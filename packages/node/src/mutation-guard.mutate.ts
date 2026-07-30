/**
 * Layer 2 of the mutation ledger — the half that actually plants.
 *
 * Run with:  npm run test:mutations            (every entry)
 *            npm run test:mutations -- --only=M1,M4
 *
 * For each entry in `mutation-ledger.ts` this writes the defect into real source,
 * runs **only** that entry's `caughtBy` files, and requires two things of the run:
 * a non-zero exit, and the recorded `signature` somewhere in its output. Then it
 * puts the file back and proves it did.
 *
 * ## Why both conditions, and not just the exit code
 *
 * A non-zero exit is not evidence a guard fired. A port collision, an out-of-memory
 * worker, a flaky 30 s timeout on an unrelated case — all exit non-zero, and all
 * would let a mutation that nothing can see be reported as caught. The signature is
 * a substring observed on a real planted run, so requiring it turns "the suite went
 * red" into "the suite went red *for this reason*". This is the same discipline the
 * repository's own guard tests apply to absence assertions: an empty result can be
 * an absent instrument, and a red run can be an unrelated fire.
 *
 * ## Why this is a script and not a spec
 *
 * A `*.test.ts` that rewrote `agent.ts` would do it while vitest was running other
 * files in the same worker pool, and whichever sibling imported the mutated module
 * next would fail for reasons nobody could reconstruct. The ordinary suite therefore
 * never plants; `mutation-guard.node.test.ts` only checks that each mutation still
 * *applies*, which is cheap and is the failure mode that actually occurs.
 *
 * ## Restoring
 *
 * The snapshot that restores is the one held **in memory**, taken before the first
 * byte is written. A copy also goes to the OS temp directory, and its path is
 * printed if the in-memory restore is ever found not to have produced a
 * byte-identical file — that is the one situation where a human needs a file to copy
 * back by hand. `SIGINT` and `SIGTERM` restore everything outstanding before
 * exiting, so an impatient Ctrl-C does not leave a defect in the tree.
 *
 * The last thing the run does is require `git status --porcelain` to be empty. Every
 * check above is about one file at a time; this is the only one that can see a file
 * the loop forgot.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUTATIONS } from './mutation-ledger.ts'
import type { Mutation } from './mutation-ledger.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCRATCH = mkdtempSync(join(tmpdir(), 'o2-mutation-'))

/** Files currently holding a planted defect, and the bytes that undo it. */
const OUTSTANDING = new Map<string, Buffer>()

/** What one entry's run established. */
interface Verdict {
  readonly id: string
  /** `caught` is the only passing state. Everything else is a finding. */
  readonly status: 'caught' | 'survived' | 'wrong-signature' | 'drifted' | 'not-restored'
  readonly detail: string
  readonly seconds: number
  /** Where this run's full output was written, for the failing cases. */
  readonly log: string
}

function restoreAll(): void {
  for (const [path, bytes] of OUTSTANDING) {
    writeFileSync(path, bytes)
    OUTSTANDING.delete(path)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    restoreAll()
    process.stderr.write(`\n${signal} — restored every planted file before exiting.\n`)
    process.exit(130)
  })
}

/** `--only=M1,M4` selects a subset; absent, everything runs. */
function selected(): readonly Mutation[] {
  const flag = process.argv.slice(2).find((arg) => arg.startsWith('--only='))
  if (flag === undefined) return MUTATIONS
  const wanted = new Set(
    flag
      .slice('--only='.length)
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )
  const chosen = MUTATIONS.filter((entry) => wanted.has(entry.id))
  const unknown = [...wanted].filter((id) => !MUTATIONS.some((entry) => entry.id === id))
  if (unknown.length > 0) {
    process.stderr.write(`unknown mutation id(s): ${unknown.join(', ')}\n`)
    process.exit(2)
  }
  return chosen
}

function runOne(entry: Mutation): Verdict {
  const abs = join(ROOT, entry.file)
  const log = join(SCRATCH, `${entry.id}.log`)
  const started = Date.now()
  const elapsed = (): number => Math.round((Date.now() - started) / 100) / 10

  // In memory first, and before anything is written. A snapshot taken after the
  // write, or read back off disk later, would restore the mutation.
  const originalBytes = readFileSync(abs)
  const originalText = originalBytes.toString('utf8')
  writeFileSync(join(SCRATCH, `${entry.id}.orig`), originalBytes)

  const parts = originalText.split(entry.find)
  if (parts.length !== 2) {
    // Not planted, so nothing to restore. `mutation-guard.node.test.ts` is supposed
    // to catch this in the ordinary suite; reaching it here means that check was
    // skipped or the tree changed under the run.
    return {
      id: entry.id,
      status: 'drifted',
      detail: `find text occurs ${parts.length - 1}× in ${entry.file}; expected exactly once`,
      seconds: elapsed(),
      log,
    }
  }

  let output = ''
  let exitCode: number | null = null
  try {
    OUTSTANDING.set(abs, originalBytes)
    writeFileSync(abs, parts.join(entry.replace))
    const run = spawnSync('npx', ['vitest', 'run', '--project', 'node', ...entry.caughtBy], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    })
    exitCode = run.status
    output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  } finally {
    writeFileSync(abs, originalBytes)
    OUTSTANDING.delete(abs)
  }

  writeFileSync(log, output)

  if (!readFileSync(abs).equals(originalBytes)) {
    return {
      id: entry.id,
      status: 'not-restored',
      detail: `${entry.file} is not byte-identical after restore — copy back ${join(SCRATCH, `${entry.id}.orig`)}`,
      seconds: elapsed(),
      log,
    }
  }

  if (exitCode === 0) {
    return {
      id: entry.id,
      status: 'survived',
      detail: `${entry.caughtBy.length} file(s) ran and every test passed with the defect in place`,
      seconds: elapsed(),
      log,
    }
  }

  if (!output.includes(entry.signature)) {
    return {
      id: entry.id,
      status: 'wrong-signature',
      detail: `exit ${String(exitCode)}, but the run never printed ${JSON.stringify(entry.signature)}`,
      seconds: elapsed(),
      log,
    }
  }

  return {
    id: entry.id,
    status: 'caught',
    detail: `exit ${String(exitCode)} with the recorded signature`,
    seconds: elapsed(),
    log,
  }
}

function table(verdicts: readonly Verdict[]): string {
  const rows = verdicts.map((verdict) => ({
    id: verdict.id,
    mark: verdict.status === 'caught' ? 'PASS' : 'FAIL',
    status: verdict.status,
    seconds: `${verdict.seconds.toFixed(1)}s`,
    detail: verdict.detail,
  }))
  const width = (key: 'id' | 'mark' | 'status' | 'seconds'): number =>
    Math.max(key.length, ...rows.map((row) => row[key].length))
  const line = (row: (typeof rows)[number]): string =>
    `${row.id.padEnd(width('id'))}  ${row.mark.padEnd(width('mark'))}  ` +
    `${row.status.padEnd(width('status'))}  ${row.seconds.padStart(width('seconds'))}  ${row.detail}`
  const header =
    `${'id'.padEnd(width('id'))}  ${'mark'.padEnd(width('mark'))}  ` +
    `${'status'.padEnd(width('status'))}  ${'seconds'.padStart(width('seconds'))}  detail`
  return [header, '-'.repeat(header.length), ...rows.map(line)].join('\n')
}

const entries = selected()
process.stdout.write(
  `Planting ${entries.length} mutation(s) from the ledger. Logs: ${SCRATCH}\n\n`,
)

const verdicts: Verdict[] = []
for (const entry of entries) {
  process.stdout.write(`  ${entry.id}  ${entry.file} … `)
  const verdict = runOne(entry)
  verdicts.push(verdict)
  process.stdout.write(`${verdict.status} (${verdict.seconds.toFixed(1)}s)\n`)
}

process.stdout.write(`\n${table(verdicts)}\n`)

const survivors = verdicts.filter((verdict) => verdict.status !== 'caught')

// The whole-tree check. Everything above is per file; this is the only reading that
// can see a file some other path forgot to put back.
const status = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
const dirt = (status.stdout ?? '').trim()
if (dirt.length > 0) {
  process.stdout.write(`\ngit status --porcelain is NOT empty after the run:\n${dirt}\n`)
} else {
  process.stdout.write('\ngit status --porcelain is empty — the tree is as it was found.\n')
}

if (survivors.length > 0) {
  process.stdout.write(
    `\n${survivors.length} of ${verdicts.length} mutation(s) were not caught as recorded:\n` +
      survivors.map((verdict) => `  ${verdict.id}: ${verdict.detail}  (log: ${verdict.log})`).join('\n') +
      '\nA survivor is a finding about the test suite, not about this script. Report it by ' +
      'id rather than deleting the entry.\n',
  )
}

process.exit(survivors.length > 0 || dirt.length > 0 ? 1 : 0)
