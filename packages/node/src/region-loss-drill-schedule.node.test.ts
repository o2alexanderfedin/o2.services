/**
 * `NET-15` — the guard that reads the drill's own schedule rather than trusting it.
 *
 * The ledger row this closes half of (`.planning/REQUIREMENTS.md:2207`) is explicit: *"Scheduled
 * and repeated is the requirement; a single exercise satisfies the letter and not the
 * property."* A schedule that exists today and can be silently narrowed to nothing tomorrow —
 * or silently widened toward something that spends — has not met that requirement either. This
 * file is `tools/aot/cross-host-workflow.node.test.ts`'s own shape, read against
 * `.github/workflows/region-loss-drill.yml` instead: the trigger set, the parsed cadence, the
 * resolving spec path and the artifact upload, each read from the file's own text rather than
 * assumed from its header prose.
 *
 * ## The one thing this file does NOT claim
 *
 * That the workflow has ever run. It has not — a `schedule:` trigger's first firing and a
 * `workflow_dispatch:` are both real GitHub events this repository cannot produce from inside a
 * test. What is guarded is that the trigger IS a schedule plus a manual dispatch and nothing
 * wider, that the cadence is bounded rather than unbounded, that the spec it names still
 * resolves, and that nothing in the file spends.
 *
 * ## `deploys()` is duplicated here on purpose, not imported
 *
 * `packages/node/src/disclosure-gate.node.test.ts` holds the canonical spending-workflow
 * definition and applies it to every workflow in the tree, including this one. That function is
 * not exported. Re-implementing the same regex here, independently, is deliberate: either guard
 * alone is a single point, and a change to one that silently drifted from the other is exactly
 * the class of defect two independent readings catch that one reading cannot.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const WORKFLOW_PATH = '.github/workflows/region-loss-drill.yml'
const SPEC_PATH = 'packages/cloudflare/src/region-loss-drill.e2e.test.ts'
const WORKFLOW = readFileSync(join(ROOT, WORKFLOW_PATH), 'utf8')

/**
 * The `on:` block's own indented lines, up to the next top-level key.
 *
 * By line rather than by a `/m`-anchored regex — `disclosure-gate.node.test.ts`'s own docblock
 * records the defect that shape produced: `^` under `/m` also matches offset 0, so a careless
 * version of this function matched one character and every assertion over the "block" was
 * really an assertion over `'o'`. Duplicated here rather than imported for the reason given in
 * this file's own header: two independent readings, not one shared one.
 */
function triggerBlock(source: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => /^on:\s*$/.test(line))
  if (start === -1) return ''
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z_]/.test(line)) break
    block.push(line)
  }
  return block.join('\n')
}

/** Independently re-implemented — see this file's own header for why it is not imported. */
function deploys(source: string): boolean {
  return /wrangler\s+deploy(?!\s+--dry-run)|gh-pages|peaceiris\/actions-gh-pages/.test(source)
}

/** The `cron:` line's own quoted value, or a thrown refusal naming what was searched. */
function cronExpression(source: string): string {
  const match = /cron:\s*'([^']+)'/.exec(source)
  if (match === null) throw new Error(`no cron: line found in ${WORKFLOW_PATH}`)
  const value = match[1]
  if (value === undefined) throw new Error('cron: regex matched with no captured group')
  return value
}

/** The five POSIX cron fields, split rather than pattern-matched as one opaque string. */
function cronFields(cron: string): readonly string[] {
  return cron.trim().split(/\s+/)
}

/**
 * The spec path the workflow's OWN `run:` step names — read out of the file, never assumed to
 * equal {@link SPEC_PATH}. A citation that drifts from the constant below is exactly what the
 * "resolve" case exists to catch, and it can only catch that by reading the file.
 */
function referencedSpecPath(source: string): string {
  const match = /vitest run --project e2e (\S+)/.exec(source)
  if (match === null) {
    throw new Error(`no 'vitest run --project e2e <path>' invocation found in ${WORKFLOW_PATH}`)
  }
  const value = match[1]
  if (value === undefined) throw new Error("the spec-path regex matched with no captured group")
  return value
}

describe('NET-15 — the region-loss drill fires on a schedule that cannot silently narrow or widen', () => {
  it('reads a file big enough for the assertions below to mean something', () => {
    // The anti-vacuity floor. A truncated or emptied workflow would satisfy every `not.toContain`
    // below by having nothing to contain anything.
    expect(WORKFLOW.length).toBeGreaterThan(500)
    expect(existsSync(join(ROOT, WORKFLOW_PATH)), `${WORKFLOW_PATH} does not exist`).toBe(true)
  })

  it('parses a real, non-trivial `on:` block', () => {
    const on = triggerBlock(WORKFLOW)
    expect(on.length, `${WORKFLOW_PATH}'s on: block parsed to ${String(on.length)} characters`).toBeGreaterThan(2)
  })

  it('carries `schedule:` in its trigger block', () => {
    // PLANT (33-05 Task 3, watched red then restored): delete the `schedule:` key. This case,
    // and only this one, must redden — not a parse failure, because the block still holds a
    // (now orphaned) `cron:` line and is still non-empty.
    expect(triggerBlock(WORKFLOW)).toContain('schedule:')
  })

  it('carries a `cron:` line beside `schedule:`', () => {
    expect(triggerBlock(WORKFLOW)).toContain('cron:')
  })

  it('carries `workflow_dispatch:` beside the schedule, for an on-demand run', () => {
    expect(triggerBlock(WORKFLOW)).toContain('workflow_dispatch:')
  })

  it('carries none of push:, pull_request: or pull_request_target: in its trigger block', () => {
    const on = triggerBlock(WORKFLOW)
    expect(on).not.toMatch(/^\s*push:/m)
    expect(on).not.toMatch(/^\s*pull_request:/m)
    expect(on).not.toMatch(/^\s*pull_request_target:/m)
  })

  it('parses the cron expression into five fields, and reads a REPEATED rather than a one-off cadence', () => {
    const fields = cronFields(cronExpression(WORKFLOW))
    expect(fields.length, `cron expression '${cronExpression(WORKFLOW)}' did not split into five fields`).toBe(5)
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
    expect(minute).toBeDefined()
    expect(hour).toBeDefined()
    expect(month).toBeDefined()
    // Day-of-month `*` and day-of-week a single day: fires once a week, every week — repeated,
    // not a one-off exercise and not an unbounded every-minute cadence.
    expect(dayOfMonth, `day-of-month field '${String(dayOfMonth)}' must be * for a weekly cadence`).toBe('*')
    expect(
      dayOfWeek,
      `day-of-week field '${String(dayOfWeek)}' must name exactly one day (0-6)`,
    ).toMatch(/^[0-6]$/)
  })

  it('names the drill spec, by the constant this file itself expects', () => {
    expect(WORKFLOW, `${WORKFLOW_PATH} does not name ${SPEC_PATH}`).toContain(SPEC_PATH)
  })

  it("reads the workflow's OWN run: step and confirms that path RESOLVES on disk", () => {
    // PLANT (33-05 Task 3, watched red then restored): change the named path by one character
    // in the run: step. `referencedSpecPath` reads the mutated value from the file — a citation
    // that stops resolving is `go-no-go-checklist.node.test.ts`'s own failure mode, read here
    // rather than assumed by comparing the file against this test's own constant.
    const referenced = referencedSpecPath(WORKFLOW)
    expect(existsSync(join(ROOT, referenced)), `${referenced} does not resolve on disk`).toBe(true)
  })

  it('invokes the e2e lane by project, never by a bare path', () => {
    expect(WORKFLOW).toContain(`npx vitest run --project e2e ${SPEC_PATH}`)
    // The referenced path itself must agree with the constant this file expects — a workflow
    // that runs SOME e2e spec under `--project e2e` but not this drill's own spec would satisfy
    // every other case here while testing nothing about NET-15's own drill.
    expect(referencedSpecPath(WORKFLOW)).toBe(SPEC_PATH)
  })

  it('spends nothing — no wrangler deploy outside --dry-run, no gh-pages, no peaceiris — checked over the WHOLE file including comments', () => {
    // Covers the header prose too, which is where the literal is most likely to arrive: a
    // header explaining the spending rule in the rule's own words would trip this exact case.
    expect(
      deploys(WORKFLOW),
      `${WORKFLOW_PATH} matches the spending-workflow definition at ` +
        'packages/node/src/disclosure-gate.node.test.ts:425-427 — cite that rule, do not quote it',
    ).toBe(false)
  })

  it('uploads the two-arm table with `if-no-files-found: error`, so a run that measured nothing fails', () => {
    expect(WORKFLOW).toContain('if-no-files-found: error')
    expect(WORKFLOW).toContain('two-arm-table.csv')
  })
})
