/**
 * The audit lane's allowlist, read independently of the gate that enforces it.
 *
 * `scripts/audit-gate.sh` replaced a bare `npm audit --omit=dev --audit-level=high` on
 * 2026-10-05, because `npm audit` has no allowlist and an advisory with no fix turns the lane
 * permanently red — at which point nobody reads it and the next reachable advisory hides inside
 * the same red. The gate keeps the refusal and makes each exception a dated entry with a reason.
 *
 * ## What this file adds that the gate does not already do
 *
 * Two things, and neither is a restatement.
 *
 * **A second expiry reading.** The gate compares `until` against today when CI runs it. This
 * spec compares the same field in the node lane, so a lapsed exemption reddens on a developer's
 * own machine and at the pre-push hook rather than only in the audit job. Duplicated on purpose,
 * for the reason `region-loss-drill-schedule.node.test.ts` gives in its own header: either
 * reading alone is a single point.
 *
 * **Every refusal, run against the real program.** The cases below execute
 * `scripts/audit-gate.mjs` itself with synthetic reports written to a temporary directory —
 * never a live `npm audit`, which would dial the registry and break `hermetic-fixtures`' rule.
 * Running the shipped file rather than a copy of its logic is what keeps this spec from drifting
 * away from the thing it guards.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ALLOWLIST_PATH = 'scripts/audit-allowlist.json'
const GATE_SHELL_PATH = 'scripts/audit-gate.sh'
const GATE_PROGRAM_PATH = 'scripts/audit-gate.mjs'
const CI_PATH = '.github/workflows/ci.yml'

const GATE_SHELL = readFileSync(join(ROOT, GATE_SHELL_PATH), 'utf8')
const CI = readFileSync(join(ROOT, CI_PATH), 'utf8')

/** One dated exemption, as the file holds it. */
interface Exemption {
  readonly id: string
  readonly package: string
  readonly until: string
  readonly why: readonly string[]
}

/**
 * The allowlist's entries, validated rather than asserted into shape.
 *
 * A type assertion here would make every case below an assertion about this file's own
 * optimism. The checks are the first case's subject, so a malformed entry fails by name.
 */
function readExemptions(): readonly Exemption[] {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_PATH), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('entries' in parsed)) {
    throw new Error(`${ALLOWLIST_PATH} has no 'entries' key`)
  }
  const { entries } = parsed
  if (!Array.isArray(entries)) throw new Error(`${ALLOWLIST_PATH}'s 'entries' is not an array`)
  return entries.map((entry: unknown, index): Exemption => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${ALLOWLIST_PATH} entry ${String(index)} is not an object`)
    }
    const record: Record<string, unknown> = { ...entry }
    const { id, package: name, until, why } = record
    if (typeof id !== 'string' || typeof name !== 'string' || typeof until !== 'string') {
      throw new Error(`${ALLOWLIST_PATH} entry ${String(index)} is missing id, package or until`)
    }
    if (!Array.isArray(why) || why.some((line: unknown) => typeof line !== 'string')) {
      throw new Error(`${ALLOWLIST_PATH} entry ${id} has no 'why' array of strings`)
    }
    return { id, package: name, until, why: why.filter((line): line is string => typeof line === 'string') }
  })
}

const EXEMPTIONS = readExemptions()

/** Today, in the same UTC form the gate and the `until` field use. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

interface GateRun {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/** A thrown `execFileSync` failure, narrowed without an assertion. */
function spawnFailure(value: unknown): { status?: number | null; stdout?: string; stderr?: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('status' in value) && !('stderr' in value)) return undefined
  const record: Record<string, unknown> = { ...value }
  const status = typeof record['status'] === 'number' ? record['status'] : null
  const stdout = typeof record['stdout'] === 'string' ? record['stdout'] : ''
  const stderr = typeof record['stderr'] === 'string' ? record['stderr'] : ''
  return { status, stdout, stderr }
}

/** Run the shipped gate program over two files. No network, no `npm audit`. */
function runGate(reportPath: string, allowlistPath: string): GateRun {
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, GATE_PROGRAM_PATH), reportPath, allowlistPath], {
      encoding: 'utf8',
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = spawnFailure(error)
    if (failure === undefined) throw error
    return { status: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

let WORK = ''
const write = (name: string, value: unknown): string => {
  const path = join(WORK, name)
  writeFileSync(path, JSON.stringify(value), 'utf8')
  return path
}

/** A report shaped the way `npm audit --json` really shapes one — measured on 2026-10-05. */
const reportWith = (id: string, name: string): unknown => ({
  auditReportVersion: 2,
  vulnerabilities: {
    [name]: {
      name,
      severity: 'high',
      via: [
        {
          source: 1240912,
          name,
          dependency: name,
          title: 'a planted advisory',
          url: `https://github.com/advisories/${id}`,
          severity: 'high',
          range: '*',
        },
      ],
    },
  },
  metadata: { vulnerabilities: { high: 1 }, dependencies: { total: 1 } },
})

const CLEAN_REPORT: unknown = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { high: 0 }, dependencies: { total: 1 } },
}

describe('the audit lane refuses an advisory unless a dated entry names it', () => {
  beforeAll(() => {
    WORK = mkdtempSync(join(tmpdir(), 'o2-audit-gate-'))
  })

  it('reads three real files, so the cases below are reading something', () => {
    // The anti-vacuity floor. A renamed or emptied script would satisfy several assertions
    // below by having nothing in it to contradict them.
    expect(existsSync(join(ROOT, GATE_SHELL_PATH)), `${GATE_SHELL_PATH} does not exist`).toBe(true)
    expect(existsSync(join(ROOT, GATE_PROGRAM_PATH)), `${GATE_PROGRAM_PATH} does not exist`).toBe(true)
    expect(existsSync(join(ROOT, ALLOWLIST_PATH)), `${ALLOWLIST_PATH} does not exist`).toBe(true)
    expect(GATE_SHELL.length).toBeGreaterThan(500)
  })

  it('names every exemption by a GHSA id, a package and a reason, not by a bare id', () => {
    for (const entry of EXEMPTIONS) {
      expect(entry.id, `${entry.id} is not a GHSA id`).toMatch(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/)
      expect(entry.package.length, `${entry.id} names no package`).toBeGreaterThan(0)
      expect(entry.until, `${entry.id}'s until is not YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // A reason long enough to carry a measurement rather than a shrug. The number is a floor
      // on prose, which is weak on its own — the case below is what makes it mean something.
      expect(entry.why.join(' ').length, `${entry.id}'s reason is too short to be one`).toBeGreaterThan(200)
      expect(
        entry.why.join(' '),
        `${entry.id}'s reason does not say what was measured or where`,
      ).toMatch(/Measured|measured/)
    }
  })

  it('holds no exemption whose date has passed — the second reading, beside the gate itself', () => {
    const today = todayUtc()
    const lapsed = EXEMPTIONS.filter((entry) => entry.until < today).map(
      (entry) => `${entry.id} expired ${entry.until}`,
    )
    expect(lapsed, `today is ${today}`).toEqual([])
  })

  it("has CI run the gate, and no bare `npm audit` outside a comment", () => {
    expect(CI, `${CI_PATH} does not run ${GATE_SHELL_PATH}`).toContain(`run: ${GATE_SHELL_PATH}`)
    const steps = CI.split('\n').filter((line) => /^\s*-\s*run:/.test(line))
    expect(
      steps.filter((line) => line.includes('npm audit')),
      'a step runs npm audit directly, which has no allowlist',
    ).toEqual([])
  })

  it('has the shell gate hand the program the same allowlist this spec reads', () => {
    // The two files can disagree about where the list lives, and then each would be guarding a
    // different file while both stayed green.
    expect(GATE_SHELL).toContain(ALLOWLIST_PATH)
    expect(GATE_SHELL).toContain(GATE_PROGRAM_PATH)
  })

  it('passes a real report with nothing found and nothing exempted', () => {
    const run = runGate(write('clean.json', CLEAN_REPORT), write('none.json', { entries: [] }))
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('no high or critical advisory')
  })

  it('refuses an advisory no entry names', () => {
    const report = write('unlisted.json', reportWith('GHSA-aaaa-bbbb-cccc', 'left-pad'))
    const run = runGate(report, write('empty.json', { entries: [] }))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('GHSA-aaaa-bbbb-cccc')
    expect(run.stderr).toContain('not in the allowlist')
  })

  it('refuses an entry whose date has passed, even though it names the advisory', () => {
    const report = write('expired-report.json', reportWith('GHSA-aaaa-bbbb-cccc', 'left-pad'))
    const allow = write('expired.json', {
      entries: [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', until: '2000-01-01', why: ['x'] }],
    })
    const run = runGate(report, allow)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('expired on 2000-01-01')
  })

  it('refuses an entry that matches nothing any more, so an exemption cannot outlive its reason', () => {
    const allow = write('dead.json', {
      entries: [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', until: '2099-01-01', why: ['x'] }],
    })
    const run = runGate(write('clean2.json', CLEAN_REPORT), allow)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('matches nothing any more')
  })

  it('refuses an entry whose advisory has moved to another package', () => {
    const report = write('moved-report.json', reportWith('GHSA-aaaa-bbbb-cccc', 'right-pad'))
    const allow = write('moved.json', {
      entries: [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', until: '2099-01-01', why: ['x'] }],
    })
    const run = runGate(report, allow)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('now reports against right-pad')
  })

  it('refuses a report that is not a report, so a failed audit cannot read as a clean tree', () => {
    // The positive control, and the case most worth having. An audit that could not reach the
    // registry writes an error object, and an error object holds no advisories — which is the
    // shape of success. This repository has already nearly closed a criterion on an empty read.
    const broken = runGate(write('broken.json', {}), write('none2.json', { entries: [] }))
    expect(broken.status).toBe(1)
    expect(broken.stderr).toContain('not an audit result')

    const networkError = runGate(
      write('neterr.json', { error: { code: 'ENETUNREACH', summary: 'request failed' } }),
      write('none3.json', { entries: [] }),
    )
    expect(networkError.status).toBe(1)
    expect(networkError.stderr).toContain('not an audit result')
  })
})
