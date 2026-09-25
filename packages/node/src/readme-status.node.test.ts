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
 *
 * ## The sibling defect this file was extended to catch
 *
 * `## Status` was not the only section that rotted silently. `### What is explicitly
 * *not* demonstrated` carried three bullets an external reviewer read and repeated as
 * this project's own findings, after this repository's own records had already
 * corrected each one: a hosted relay the bullets said did not exist, a "needs
 * hardware" reason for `AOT-03`/`BENCH-06` that `v1.0-MILESTONE-AUDIT.md` and
 * `REQUIREMENTS.md` had retired in favour of tester-cohort access, and a "multi-process
 * driver is planned" sentence `BENCHMARK-RESULTS.md:36` explicitly retracts.
 *
 * A guard cannot check whether prose is *true*. It can check one mechanical fact: this
 * section names `XXX-NN` requirement ids, and `.planning/REQUIREMENTS.md` has its own
 * checkbox verdict for each of those ids. A bullet claiming a requirement is unmet
 * while the ledger's own checkbox for it reads `[x]` is a contradiction inside this
 * repository's own records, independent of whatever else the prose says — and it is
 * exactly the shape of the three defects above: each one named (or, for the code-cache
 * and peer-acceptance bullets, *should* have named) a requirement whose ledger row had
 * already moved to `Done`.
 *
 * ## Two ways this check itself can go blind, and why both are covered
 *
 * A requirement id that is simply misspelled (`BENCH-60` for `BENCH-06`) would find no
 * ledger row at all — and a lookup that treats "no row found" as "nothing to
 * contradict, therefore pass" would let a typo through for free, the same blind-parser
 * shape `disclosure-gate.node.test.ts` already taught this repository once. So an id
 * with no matching checkbox row reddens exactly as loudly as an id whose row reads
 * `[x]` — both are a "this guard cannot vouch for this bullet" state, and neither is
 * silently accepted as true.
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

/**
 * README's `### What is explicitly *not* demonstrated` section body: from its
 * heading to the next `## ` heading. The heading has literal asterisks around
 * "not", escaped here so the regex matches the character rather than opening an
 * unintended alternation.
 */
function notDemonstratedSectionOf(readme: string): string | null {
  const match = /\n### What is explicitly \*not\* demonstrated\n(.*?)\n## /s.exec(readme)
  return match?.[1] ?? null
}

const NOT_DEMONSTRATED = notDemonstratedSectionOf(README)

/**
 * Every `XXX-NN` requirement id this section names, in first-seen order but
 * de-duplicated — a bullet may cite the same id twice (once naming the blocker,
 * once naming its closer) and that is not two separate claims to check.
 *
 * `\b[A-Z]{2,5}-\d{2}\b` deliberately does not match `v2.0` (lowercase `v`, one
 * digit before the dot) or `CROSS_MACHINE_BLIND_SPOT` (no hyphen), which is what
 * lets this run over the section's free prose rather than a hand-delimited list.
 */
function requirementIdsIn(section: string): readonly string[] {
  const ids = section.match(/\b[A-Z]{2,5}-\d{2}\b/g) ?? []
  return [...new Set(ids)]
}

const NOT_DEMONSTRATED_IDS = NOT_DEMONSTRATED === null ? [] : requirementIdsIn(NOT_DEMONSTRATED)

/**
 * A requirement id's own checkbox verdict in `.planning/REQUIREMENTS.md` —
 * `true` for `- [x] **XXX-01**`, `false` for `- [ ] **XXX-01**`, `null` if no
 * checkbox row for that id exists at all (a typo, or an id that names a phase
 * criterion rather than a ledger requirement).
 *
 * Deliberately the FIRST match, not every match: an id is discussed in prose
 * dozens of times across this file, and exactly one of those mentions is the
 * canonical `- [ ]`/`- [x]` row this repository's own convention treats as the
 * requirement's row. `readmeLedgerOf`'s sibling above already keys on this same
 * shape.
 */
function ledgerVerdictOf(requirements: string, id: string): boolean | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = new RegExp(`^- \\[([x ])\\] \\*\\*${escaped}\\*\\*`, 'm').exec(requirements)
  const box = row?.[1]
  if (box === undefined) return null
  return box === 'x'
}

describe('README.md "not demonstrated" section stays true against the ledger', () => {
  it('has a "not demonstrated" section this guard can actually see — otherwise everything below is vacuous', () => {
    // Ordered first in this describe, deliberately: if the heading regex ever
    // goes blind — a rewording, an extra asterisk, anything — this is the case
    // that reddens, rather than the id-count case below silently reading an
    // empty string as "no ids, nothing to check, pass".
    expect(NOT_DEMONSTRATED).not.toBeNull()
    expect(NOT_DEMONSTRATED?.length ?? 0).toBeGreaterThan(100)
  })

  it('states more than a couple of unmet bullets — otherwise the list has been hollowed out rather than corrected', () => {
    const bullets = NOT_DEMONSTRATED?.match(/^- \*\*/gm)?.length ?? 0
    expect(bullets).toBeGreaterThan(3)
  })

  it('names more than one requirement id in this section — otherwise the id parser below is blind and the checks that depend on it are vacuous', () => {
    // Anti-vacuity with a literal, same shape as LEDGER_CLOSED/LEDGER_OPEN above.
    // Before this rewrite the section named exactly two ids (AOT-03, BENCH-06);
    // a rewrite that dropped every id back to zero would make every case below
    // pass over nothing rather than fail loudly.
    expect(NOT_DEMONSTRATED_IDS.length).toBeGreaterThanOrEqual(2)
  })

  it.each(NOT_DEMONSTRATED_IDS)('%s has a ledger row this guard can find — an id with no row is as unverifiable as one that contradicts the ledger', (id) => {
    expect(ledgerVerdictOf(REQUIREMENTS, id)).not.toBeNull()
  })

  it.each(NOT_DEMONSTRATED_IDS)('%s is not marked Done in the ledger — a bullet in this section claims it unmet', (id) => {
    expect(ledgerVerdictOf(REQUIREMENTS, id)).toBe(false)
  })
})
