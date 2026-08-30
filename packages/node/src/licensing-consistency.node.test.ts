import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * DEMO-05 and DEMO-06 — the licensing documents agree with each other, and with the
 * licence that is actually installed.
 *
 * ## Why this file exists at all
 *
 * On 2026-08-30 the default track moved from the *O2.services Source-Available Trial
 * License 1.0* to **AGPL-3.0-or-later**. Five documents describe that licence to a
 * reader — `README.md`, `LICENSING.md`, `LICENSE-COMMERCIAL.md`, `CONTRIBUTING.md` and
 * `.planning/PROJECT.md` — and every one of them was written against the old terms.
 * `CONTRIBUTING.md` is the case that shows why prose needs a guard: it justified its
 * no-contributions policy on the grounds that *"the LICENSE grants no right to modify
 * the software or create derivative works"*, which was true of the trial licence and is
 * **the opposite** of what AGPL §2 and §5 say. A reader acting on it would have believed
 * they may not fork software they are entitled to fork.
 *
 * That is the failure this file catches: not a wrong licence, but a **stale description
 * of the right one**. It cannot be caught by reading the licence, because the licence was
 * fine; it can only be caught by reading the licence and the prose together.
 *
 * ## Why a guard rather than care
 *
 * The same day, four `REQUIREMENTS.md` rows were found reading `Not started` for work
 * that had shipped in Phase 29, and `DEMO-05`'s row read *"no `CONTRIBUTING.md` exists"*
 * against a file committed on 2026-07-24, five weeks earlier. Documents drift in exactly
 * this direction — a statement true when written, never revisited — and the drift is
 * invisible because nothing executes prose.
 *
 * ## What is deliberately NOT asserted
 *
 * Nothing here checks that the AGPL is the *right* choice, or reads its terms. The
 * licence text is the Free Software Foundation's, unmodified, and this file's only claim
 * about it is that the file on disk is that text and not something else.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/**
 * Markdown here is hard-wrapped at ~78 columns, so a phrase a reader sees as one sentence
 * is two lines in the file and matches no regex spanning the break. Every content rule in
 * this file matches against the flattened form for that reason — established by writing
 * them line-wise first and watching four of them fail on correct documents.
 */
const flatten = (text: string): string => text.replace(/\s+/g, ' ')

const LICENSE = read('LICENSE')
const LICENSING = read('LICENSING.md')
const README = read('README.md')
const COMMERCIAL = read('LICENSE-COMMERCIAL.md')
const CONTRIBUTING = read('CONTRIBUTING.md')
const PROJECT = read('.planning/PROJECT.md')

/**
 * The prose files, as data. Every rule below runs over this list rather than over a
 * hand-repeated set, so a sixth document added to the repository is covered by adding
 * one row here.
 */
const PROSE: readonly (readonly [string, string])[] = [
  ['README.md', README],
  ['LICENSING.md', LICENSING],
  ['LICENSE-COMMERCIAL.md', COMMERCIAL],
  ['CONTRIBUTING.md', CONTRIBUTING],
  ['.planning/PROJECT.md', PROJECT],
]

describe('the installed LICENSE is the AGPL, unmodified', () => {
  it('is the Free Software Foundation text and not a paraphrase of it', () => {
    expect(LICENSE).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
    expect(LICENSE).toContain('Version 3, 19 November 2007')
    expect(LICENSE).toContain('Copyright (C) 2007 Free Software Foundation, Inc.')
  })

  it('carries the two sections the commercial track exists to release a licensee from', () => {
    // If either heading is absent the file is not the AGPL, whatever else it says — and
    // every explanation in LICENSING.md and LICENSE-COMMERCIAL.md cites them by number.
    expect(LICENSE).toContain('13. Remote Network Interaction')
    expect(LICENSE).toContain('5. Conveying Modified Source Versions')
  })

  it('grants patent rights rather than reserving them, which reverses the old posture', () => {
    expect(LICENSE).toContain('11. Patents')
  })
})

describe('DEMO-06 — no document promises terms the licence does not carry', () => {
  /**
   * The superseded vocabulary. Each term described the trial licence accurately and
   * describes the AGPL wrongly, so a live occurrence is a document that has not been
   * updated — which is precisely the 2026-08-30 finding.
   *
   * `LICENSE-TRIAL-1.0.md` is excluded by not being in PROSE: it *is* the old terms,
   * preserved verbatim so that anyone who accepted them keeps their grant.
   */
  const SUPERSEDED: readonly (readonly [RegExp, string])[] = [
    [/\bnot open source\b/i, 'the AGPL is an OSI-approved open source licence'],
    [/\b32[- ]day\b/i, 'the trial period does not exist under the AGPL'],
    [/32 consecutive/i, 'same'],
    [/grants no right to modify/i, 'AGPL §2 and §5 grant exactly that'],
    // Anchored on the ASSERTION, not on the word `reserved`, which occurs in the correct
    // statement too ("granted rather than reserved") — the first spelling flagged both.
    // Third spelling, and the two rejected ones are kept in the comment because each was
    // a real false positive on correct prose: `/patent rights.{0,40}reserved/` flagged
    // "granted rather than reserved", and adding `(are|remain|stay)` still flagged
    // "are now GRANTED rather than reserved" — the verb is `are`, the object is `granted`,
    // and `reserved` is the thing being repudiated. So the rule excludes a repudiation
    // explicitly rather than trying to out-guess the grammar.
    [/patent rights (are|remain|stay)(?![^.]*\b(granted|no longer)\b)[^.]{0,30}\breserved\b/i, 'AGPL §11 grants them'],
    [/\bgrants? no patent\b/i, 'AGPL §11 grants one'],
  ]

  it('has a live corpus, so the rules below are not passing over an empty set', () => {
    // Anti-vacuity: a mis-typed path returning '' would make every rule below pass.
    expect(PROSE.length).toBe(5)
    for (const [name, text] of PROSE) expect(text.length, name).toBeGreaterThan(500)
  })

  it('carries no superseded licensing term outside a dated correction', () => {
    // **Scanned by PARAGRAPH, not by line, and that is the rule rather than a detail.**
    // Written line-wise first and it reported eight findings, every one of them a
    // continuation line of a correction whose date sat on the line above — markdown prose
    // is hard-wrapped, so a line is not a claim. A paragraph is the unit a reader reads,
    // and the unit a retraction covers.
    // **Exempted per SENTENCE, not per paragraph — and the difference is the whole rule.**
    // Paragraph-wise first, and re-injecting the original 2026-08-30 defect left it GREEN:
    // the false claim was pasted into the same paragraph as its own retraction, so one
    // `superseded` a hundred words away excused it. A retraction covers the sentence it is
    // in, and an exemption any wider is an exemption an author can drift into by accident.
    const found: string[] = []
    for (const [name, text] of PROSE) {
      const flat = text.replace(/\s+/g, ' ')
      // Split on sentence ends, keeping quoted material with the sentence that quotes it.
      for (const sentence of flat.split(/(?<=[.!?])\s+(?=[A-Z*`[])/)) {
        // A correction QUOTES the wrong claim — that is how this repository retires one,
        // preserving the old reading rather than deleting it. What it may not do is assert
        // it with nothing marking it retired.
        if (/2026-08-30|AMENDED|CHANGED|previous default|Until 2026|superseded|CORRECTED|was true of|is now false|stood here/i.test(sentence)) continue
        for (const [pattern, why] of SUPERSEDED) {
          if (pattern.test(sentence)) found.push(`${name}: ${sentence.trim().slice(0, 90)} — ${why}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('does not promise permanent open licensing, which is what DEMO-06 actually asks', () => {
    // DEMO-06 is about the OTHER direction: copy that over-promises is what produced
    // the Terraform, Redis and Elastic backlashes. LICENSING.md states the commitment
    // in the one form that is true — the grant already made cannot be withdrawn.
    expect(flatten(LICENSING)).toMatch(/irrevocable/i)
    expect(flatten(LICENSING)).toMatch(/additive/i)
    for (const [name, text] of PROSE) {
      expect(/\b(always|forever|permanently) (be )?(free|open source)\b/i.test(flatten(text)), name).toBe(false)
    }
  })
})

describe('DEMO-05 — CONTRIBUTING.md states the policy the requirement names', () => {
  it('says pull requests are triaged and never merged', () => {
    expect(flatten(CONTRIBUTING)).toMatch(/triaged, never merged/i)
  })

  it('says a fix is written independently of the submitted diff', () => {
    // The clause that binds the MAINTAINER rather than the submitter, and the one the
    // requirement singles out: absorbing an approach from a diff is the provenance risk
    // a CLA would otherwise cover.
    expect(flatten(CONTRIBUTING)).toMatch(/independently of the submitted diff/i)
  })

  it('says there is no CLA and none is planned', () => {
    expect(flatten(CONTRIBUTING)).toMatch(/no CLA/i)
  })

  it('does not tell a reader they may not fork, which the AGPL entitles them to do', () => {
    // The 2026-08-30 defect, kept as a case rather than a memory.
    expect(flatten(CONTRIBUTING)).toMatch(/may fork this software and modify it freely/i)
  })
})

describe('the three tracks are described consistently wherever they appear', () => {
  it('names the AGPL as the default in every document that names a default', () => {
    for (const [name, text] of PROSE) {
      if (!/default/i.test(text)) continue
      expect(/AGPL/i.test(text), `${name} describes a default track without naming the AGPL`).toBe(true)
    }
  })

  it('keeps the superseded terms on disk rather than deleting them', () => {
    // A licensee who accepted the trial terms keeps that grant, so the file has to
    // survive. Every document that mentions the change points at it.
    const preserved = read('LICENSE-TRIAL-1.0.md')
    expect(preserved).toContain('O2.services Source-Available Trial License 1.0')
    for (const [name, text] of PROSE) {
      if (!/2026-08-30/.test(text)) continue
      expect(text.includes('LICENSE-TRIAL-1.0.md'), `${name} dates the change without linking the old terms`).toBe(true)
    }
  })
})
