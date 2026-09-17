/**
 * An open ledger row must not name a DELIVERED plan as the thing it is still waiting for.
 *
 * ## The defect this exists to catch, which happened and cost eight days
 *
 * `AUTH-06`'s row said, under the heading *"What is NOT done, and is why the box is not
 * ticked"*, that what remained was plan `42-05`. That plan was delivered on 2026-09-06 with a
 * summary. Nothing updated the row. So for eight days the ledger reported a requirement blocked
 * by work that had landed — and on 2026-09-14 it reached a progress report as **owner-gated**,
 * which it never was. The mechanism had shipped; only the sentence was stale.
 *
 * Nothing in this tree could have caught that. `acceptance-traceability.node.test.ts` checks a
 * checkbox against its row's verdict, and both agreed: both said not done. The disagreement was
 * between the row and `.planning/phases/`, which no guard compared.
 *
 * ## Why the match is narrow on purpose, and what it deliberately does not flag
 *
 * A row citing a delivered plan is **normal and usually correct** — most citations are
 * provenance, *this is where the work was done*. Flagging those would make this guard noise,
 * and a noisy guard gets exempted rather than read. So the match requires the citation to fall
 * inside an **owing phrase**: a heading that says this is what is not done, what is missing,
 * what remains. `RUN-06` and `RUN-07` each cite delivered plans AND undelivered ones in the
 * same row, correctly, and neither is flagged — measured, not hoped for.
 *
 * ## The positive control, run before this file was written
 *
 * The same detector was run against `HEAD~1`, the tree with `AUTH-06` still stale, and against
 * the fixed tree:
 *
 * ```
 * BEFORE the fix: ['AUTH-06 -> 42-05']
 * AFTER the fix: nothing
 * ```
 *
 * An empty result is a reading only because the instrument was seen finding the real one. The
 * control is kept below as a case rather than described, so it cannot rot: it reconstructs the
 * stale sentence and asserts the detector finds it.
 *
 * ## What a failure here means
 *
 * Not that the requirement is done — that is a judgement the guard cannot make. It means the
 * row's own account of what it is waiting for has gone false, and somebody must re-read it and
 * either close it or say what it is ACTUALLY waiting for. The failure message names both.
 */

import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const LEDGER = readFileSync(join(ROOT, '.planning/REQUIREMENTS.md'), 'utf8')
const PHASES = join(ROOT, '.planning/phases')

/** Every plan id that has a summary beside it — i.e. was delivered, not merely written. */
function deliveredPlans(): ReadonlySet<string> {
  const delivered = new Set<string>()
  for (const dir of readdirSync(PHASES, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const file of readdirSync(join(PHASES, dir.name))) {
      const match = /^(\d{2}-\d{2})-SUMMARY\.md$/u.exec(file)
      if (match?.[1] !== undefined) delivered.add(match[1])
    }
  }
  return delivered
}

/**
 * The phrases under which a row says what it is still owed.
 *
 * Taken from the rows themselves rather than invented — these are the headings this ledger
 * actually uses. A citation outside one of them is provenance and is not this guard's business.
 */
const OWING = /(what is not done|is why the box is not ticked|what is missing|what remains)/giu

/** How far past the owing phrase a cited plan still counts as part of that clause. */
const CLAUSE_CHARS = 400

interface Staleness {
  readonly id: string
  readonly plan: string
  readonly clause: string
}

function stalePlanCitations(source: string): readonly Staleness[] {
  const delivered = deliveredPlans()
  const openIds = new Set(
    [...source.matchAll(/^- \[ \] \*\*([A-Z]+-\d+)\*\*/gmu)].map((m) => m[1] ?? ''),
  )
  const found: Staleness[] = []
  // Keyed by row-and-plan. Two owing phrases can sit a few words apart — the real `AUTH-06`
  // sentence carried both *"What is NOT done"* and *"is why the box is not ticked"* — so their
  // clause windows overlap and the same citation is reached twice. One row waiting on one plan
  // is one finding; reporting it twice would make the count a property of the prose.
  const seen = new Set<string>()
  for (const row of source.matchAll(/^\| ([A-Z]+-\d+) \| ([^|]*) \| (.*) \|$/gmu)) {
    const id = row[1] ?? ''
    const verdict = row[3] ?? ''
    if (!openIds.has(id)) continue
    for (const owing of verdict.matchAll(OWING)) {
      const clause = verdict.slice(owing.index, owing.index + CLAUSE_CHARS)
      for (const cite of new Set([...clause.matchAll(/`(\d{2}-\d{2})`/gu)].map((m) => m[1] ?? ''))) {
        if (!delivered.has(cite)) continue
        const key = `${id}/${cite}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ id, plan: cite, clause: clause.slice(0, 220) })
      }
    }
  }
  return found
}

describe('an open row does not name a delivered plan as the work it still awaits', () => {
  it('finds none in this ledger', () => {
    const stale = stalePlanCitations(LEDGER)
    expect(
      stale.map((s) => `${s.id} says it awaits plan ${s.plan}, which HAS a summary`),
      stale
        .map(
          (s) =>
            `\n${s.id}: the row says it is waiting for plan ${s.plan}, and ` +
            `.planning/phases/ holds ${s.plan}-SUMMARY.md — that plan was delivered.\n` +
            `  The clause: "${s.clause}…"\n` +
            `  This does NOT mean the requirement is done; it means the row's account of what ` +
            `it awaits has gone false. Re-read it and either close it or say what it is ` +
            `actually waiting for.`,
        )
        .join('\n'),
    ).toEqual([])
  })

  it('would have caught AUTH-06, which went stale for eight days', () => {
    // The positive control, reconstructed rather than remembered — the sentence as the row
    // carried it from 2026-09-06 to 2026-09-14, with a plan id that really does have a summary.
    const control =
      '- [ ] **AUTH-06**: a fixture row\n' +
      '| AUTH-06 | v2.0 — Phase 42 | **Not started** — the mechanism shipped. ' +
      '**What is NOT done, and is why the box is not ticked**: `42-05` — the record of why ' +
      'this shape was chosen over the two that were not |'
    const caught = stalePlanCitations(control)
    expect(
      caught.map((s) => `${s.id}/${s.plan}`),
      'the detector must find the real defect it was written for, or an empty result on the ' +
        'live ledger is an instrument reading nothing rather than a clean tree',
    ).toEqual(['AUTH-06/42-05'])
  })

  it('does not flag a delivered plan cited as provenance', () => {
    // The other half of the control: most citations say *this is where the work was done*, and
    // flagging those would make this guard noise. `42-05` is delivered and named plainly here.
    const provenance =
      '- [ ] **FAKE-01**: a fixture row\n' +
      '| FAKE-01 | v2.0 — Phase 42 | **Partial** — the shape was weighed in `42-05` and the ' +
      'mechanism landed with it. What is open is an owner ruling |'
    expect(stalePlanCitations(provenance)).toEqual([])
  })

  it('reads a ledger and a phase set big enough for the verdict to mean something', () => {
    // Without this, a guard whose two inputs had gone empty would pass perfectly.
    expect(deliveredPlans().size).toBeGreaterThan(20)
    expect([...LEDGER.matchAll(/^- \[[ x]\] \*\*[A-Z]+-\d+\*\*/gmu)].length).toBeGreaterThan(100)
  })
})
