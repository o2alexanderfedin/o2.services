import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `README.md`'s `## Status` section stays true against `.planning/STATE.md` and
 * `.planning/REQUIREMENTS.md`, rather than aging silently the way it did until
 * 2026-09-24.
 *
 * ## Why this exists
 *
 * An external reviewer quoted this section faithfully in a submission — *"v1.1 is in
 * progress at 5 of 14 phases"*, *"40 closed, 42 open"* — seven weeks after v1.1
 * shipped 15/15 and two milestones after the ledger had moved to 123/13. The numbers
 * in their document were wrong because this repository's own front door was wrong.
 * Nothing had reread the Status section since it was written, and nothing would have
 * noticed had the reviewer not quoted it back.
 *
 * ## The pattern this follows
 *
 * `state-frontmatter.node.test.ts` was extended on 2026-09-23 to compare
 * `.planning/STATE.md`'s `milestone`/`milestone_name` against `ROADMAP.md`'s last
 * `## Milestone` heading, through one reader every case shares, with an anti-vacuity
 * case ahead of every comparison that would otherwise pass over nothing. This file
 * reuses that shape rather than inventing a second one: one reader per fact, an
 * anti-vacuity case with a literal threshold before any comparison depends on the
 * reader having found something, and comparisons that read module-scope constants
 * rather than recomputing inline.
 *
 * `milestone`/`milestone_name` are not re-derived here — they are read once, from
 * `STATE.md`, and `state-frontmatter.node.test.ts` already proves those two values
 * name the same milestone the roadmap is on. This file chains onto that already-
 * checked value instead of re-reading the roadmap a second way.
 *
 * ## The instrument that has gone blind in this repository before
 *
 * `disclosure-gate.node.test.ts`'s pattern for a deploy command once required the
 * verb to follow the tool name directly, matched nothing, and every absence
 * assertion built on it passed for as long as it existed. A regex that finds zero
 * matches is not evidence of an empty section — it is evidence of nothing, and this
 * file's "sees more than zero" cases exist so a blinded parser reddens instead of
 * agreeing for free with a Status section that also says nothing.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')
const STATE = readFileSync(join(ROOT, '.planning/STATE.md'), 'utf8')
const REQUIREMENTS = readFileSync(join(ROOT, '.planning/REQUIREMENTS.md'), 'utf8')

/** README's `## Status` section body: from its heading to the next `## ` heading. */
function statusSectionOf(readme: string): string | null {
  const match = /\n## Status\n(.*?)\n## /s.exec(readme)
  return match?.[1] ?? null
}

const STATUS = statusSectionOf(README)

/** What README's Status section names as the current milestone. */
interface ReadmeMilestone {
  readonly version: string
  readonly name: string
}

/**
 * Reads `**Current milestone: vX.Y — Name**` out of the Status section. The shape
 * mirrors `ROADMAP.md`'s own `## Milestone vX.Y — Name (Phases …)` heading on
 * purpose, so this repository states the same fact the same way in both places.
 */
function readmeMilestoneOf(status: string): ReadmeMilestone | null {
  const heading = /\*\*Current milestone: (v\d+\.\d+) — (.+?)\*\*/.exec(status)
  const version = heading?.[1]
  const name = heading?.[2]
  if (version === undefined || name === undefined) return null
  return { version, name }
}

const README_MILESTONE = STATUS === null ? null : readmeMilestoneOf(STATUS)

/**
 * A top-level frontmatter field from `.planning/STATE.md`, read the same way
 * `state-frontmatter.node.test.ts`'s `topLevelFields` does: sliced to the
 * frontmatter block first, and only non-indented lines considered. Without the
 * slice, a value quoted inside `stopped_at`'s free-form prose — which has
 * happened before, is exactly this kind of false positive — could satisfy the
 * regex instead of the real field.
 */
function frontmatterFieldOf(state: string, key: string): string | null {
  const frontmatter = /^---\n(.*?)\n---\n/s.exec(state)?.[1] ?? ''
  const re = new RegExp(`^${key}: ?(.*)$`, 'm')
  const lines = frontmatter.split('\n').filter((line) => !line.startsWith(' '))
  const value = re.exec(lines.join('\n'))?.[1]
  return value === undefined ? null : value.trim()
}

const STATE_MILESTONE = frontmatterFieldOf(STATE, 'milestone')
const STATE_MILESTONE_NAME = frontmatterFieldOf(STATE, 'milestone_name')

/** The `N closed, M open` figures README's Status section states. */
interface ReadmeLedger {
  readonly closed: number
  readonly open: number
}

function readmeLedgerOf(status: string): ReadmeLedger | null {
  const counts = /(\d+) closed, (\d+) open/.exec(status)
  const closed = counts?.[1]
  const open = counts?.[2]
  if (closed === undefined || open === undefined) return null
  return { closed: Number(closed), open: Number(open) }
}

const README_LEDGER = STATUS === null ? null : readmeLedgerOf(STATUS)

/**
 * The ledger's own counted truth. Same checkbox shape `.planning/REQUIREMENTS.md`
 * uses throughout: `- [x] **XXX-01**` for closed, `- [ ] **XXX-01**` for open.
 */
const LEDGER_CLOSED = REQUIREMENTS.match(/^- \[x\] \*\*[A-Z]+-\d+\*\*/gm)?.length ?? 0
const LEDGER_OPEN = REQUIREMENTS.match(/^- \[ \] \*\*[A-Z]+-\d+\*\*/gm)?.length ?? 0

describe('README.md Status section stays true', () => {
  it('has a Status section this guard can actually see — otherwise everything below is vacuous', () => {
    // Without this, a `## Status` heading that failed to match would silently
    // produce `null` and every case below would compare against nothing.
    expect(STATUS).not.toBeNull()
    expect(STATUS?.length ?? 0).toBeGreaterThan(100)
  })

  it('names a milestone in a shape this guard can parse — otherwise the comparison below is vacuous', () => {
    expect(README_MILESTONE).not.toBeNull()
    expect(README_MILESTONE?.version).toMatch(/^v\d+\.\d+$/)
    expect(README_MILESTONE?.name.length).toBeGreaterThan(0)
  })

  it('names the same milestone version STATE.md declares', () => {
    // STATE.md's `milestone` is itself already checked against ROADMAP.md's last
    // `## Milestone` heading by state-frontmatter.node.test.ts — this chains onto
    // that already-verified value rather than re-reading the roadmap a second way.
    expect(STATE_MILESTONE).not.toBeNull()
    expect(README_MILESTONE?.version).toBe(STATE_MILESTONE)
  })

  it('names the same milestone name STATE.md declares', () => {
    expect(STATE_MILESTONE_NAME).not.toBeNull()
    expect(README_MILESTONE?.name).toBe(STATE_MILESTONE_NAME)
  })

  it('states ledger figures in a shape this guard can parse — otherwise the count below is vacuous', () => {
    expect(README_LEDGER).not.toBeNull()
  })

  it('reads more than a handful of closed and open requirements from the ledger — otherwise a blinded parser and an empty README figure would agree for free', () => {
    // Anti-vacuity with literals: if the checkbox regex above were blinded — by a
    // reformatted ledger, a renamed field, anything — LEDGER_CLOSED and
    // LEDGER_OPEN would both silently read 0, and a stale "0 closed, 0 open" in
    // the README would then match the broken parser instead of reddening it.
    expect(LEDGER_CLOSED).toBeGreaterThan(50)
    expect(LEDGER_OPEN).toBeGreaterThan(0)
  })

  it('states the same closed count the ledger counts', () => {
    expect(README_LEDGER?.closed).toBe(LEDGER_CLOSED)
  })

  it('states the same open count the ledger counts', () => {
    expect(README_LEDGER?.open).toBe(LEDGER_OPEN)
  })
})
