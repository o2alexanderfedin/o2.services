import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The publication guard — BENCH-06's distinct-machine half, and the figure that may not
 * stand in for it.
 *
 * Phase 39 criterion 4 asks for *"the distinct-machine count published beside the curve"*
 * and then says what happens until the run reports: the half stays **descoped and
 * unmeasured — not met — and a same-host figure may not be published in its place.** That
 * last clause is a rule about the repository's published copy, and a rule nothing enforces
 * is a rule that gets forgotten the first time a number looks quotable. This is the thing
 * that enforces it.
 *
 * ## Why a predicate declared here rather than a plant into published copy
 *
 * The obvious construction is to write a machine claim into `.planning/BENCHMARK-RESULTS.md`
 * and watch the scan catch it. That is the wrong instrument in this working tree: agents
 * run concurrently over one checkout, and *"an observation taken while another agent holds
 * a plant is not a measurement of the tree"*. So the predicate is a pure function over a
 * string, case A feeds it a fixture that contains a claim, and case C feeds it the real
 * corpus. The positive control and the absence assertion then come from the same function
 * in the same run, and nothing tracked has to be damaged to get one.
 *
 * ## The absence is worthless without the control, and this repository has the receipts
 *
 * A pattern that matches nothing satisfies *"no unsourced machine claim exists"* perfectly.
 * This repository has shipped exactly that twice — a guard leg comparing an upper-case
 * needle against a lower-cased haystack, and a register entry promising an inversion that
 * had been read off the guard rather than off its contents. Case A therefore runs first and
 * asserts a **count**, not merely "something was found": a fixture containing one claim
 * produces exactly one hit.
 *
 * ## What "cleared" means, and why clearing is not a loophole
 *
 * A machine count is publishable when something announced the machines. `bench-inventory.ts`
 * is the mechanism that exists — each spawned agent announces its own host on its handshake
 * line and the driver merges those announcements — so a paragraph naming `AnnouncedMachine`,
 * `announcedMachine` or `announced handshake` beside its number is citing a source rather
 * than asserting a total. A paragraph that names none is the case this guard is about.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** This file. It declares the fixture below, so it must never be its own corpus. */
const SELF = 'packages/node/src/machine-claim-guard.node.test.ts'

/**
 * The fixture, spelled once and asserted against in case A.
 *
 * It is a machine claim of exactly the shape criterion 4 forbids: a number, a count of
 * machines, and no source anywhere near it.
 */
const FIXTURE = 'the run spread across 40 distinct machines'

/**
 * Words that may **not** stand between the number and the noun.
 *
 * This list was not designed, it was measured. The first run of this guard over the real
 * corpus returned nine hits and every one of them was the same defect: an unrestricted gap
 * let a numeral bind to a noun phrase whose own determiner sat in between. Verbatim, from
 * `docs/perf/prime-and-pi-benchmarks.md:5` — *"Measured 2026-08-02 on one machine: 8
 * physical cores"* — where the guard read the `02` of a **date** as a count of the machines
 * in *"on one machine"*, whose actual count word is `one`; and from
 * `.planning/phases/phase-29-hosted-tier-assembly-and-first-deploy/29-REPORT.md:118`,
 * *"exits 0 on a machine"*, where the numeral is an **exit code** and `a machine` is not a
 * count at all. Both sentences are honest same-host disclosures — the opposite of the claim
 * this guard exists to catch — so the nine hits were an instrument defect and not findings.
 *
 * The rule that survives the reading: a numeral counts a noun only across **adjectives**.
 * Cross a preposition, an article or a number-word and the numeral is counting something
 * else in a different phrase.
 *
 * **The residual, stated rather than left to be discovered.** This guard sees numerals and
 * not English number-words, so *"the run spread across one machine"* is invisible to it.
 * That is a deliberate boundary: criterion 4's forbidden figure is a distinct-machine
 * *count* published beside a curve, which is written with a numeral, while *"on one
 * machine"* is the same-host sentence this corpus already uses correctly in four places.
 */
const NOT_AN_ADJECTIVE =
  '(?:on|in|of|at|to|for|from|by|with|and|or|a|an|the|one|two|three|four|five|six|seven|eight|nine|ten|per|than|as|is|was|were|are|that|this|these|those|each|another|same|about|over|under|across|between)'

/**
 * A number used as a count of machines.
 *
 * `(?<![\d.])` is not decoration either. `### 3.2 Machine inventory on every run` is a real
 * heading in `.planning/BENCHMARK-METHODOLOGY.md`, and without the lookbehind its `2`
 * reads as a count of machines — a section number is not a measurement. The trailing
 * lookahead drops the uses where `machine` is an adjective rather than the thing counted:
 * `machine inventory`, `machine label`, `machine id`, `machine role`, `machine claim`,
 * and `machine count`, which has its own rule below because only *there* does a following
 * number turn it into a claim.
 */
const NUMBER_THEN_MACHINES = new RegExp(
  String.raw`(?<![\d.])\d+(?:\s+(?!${NOT_AN_ADJECTIVE}\b)[A-Za-z][A-Za-z-]*){0,2}\s+machines?\b(?!\s+(?:counts?|inventor(?:y|ies)|labels?|ids?|descriptors?|roles?|halves|half|claims?))`,
  'gi',
)

/**
 * The noun-first form — `machine count: 12`.
 *
 * A number must actually follow, which is the whole reason the corpus's existing correct
 * sentences survive: `a node count, not a machine count` and `machine count not measured`
 * both name the quantity precisely in order to say it was **not** taken, and neither is
 * followed by one.
 */
const MACHINE_COUNT_THEN_NUMBER =
  /machines?\s+counts?(?:\s*[:=]|\s+(?:is|of|was|were|reached|at))?\s+(?<![\d.])\d+/gi

/**
 * What clears a hit: the paragraph names where the machines were announced.
 *
 * Case-sensitive and listed in both spellings, because `announcedMachine` as a substring
 * test does not see `AnnouncedMachine` — the type and the field differ in their first
 * letter, and a paragraph may cite either. `announcedMachines`, the plural field, contains the singular
 * and is cleared by it.
 */
const ANNOUNCED_SOURCES = ['announcedMachine', 'AnnouncedMachine', 'announced handshake']

export interface MachineClaim {
  readonly line: number
  readonly text: string
}

/**
 * Every machine count in `text` that no nearby source accounts for.
 *
 * Paragraph-scoped clearing rather than line-scoped: published prose wraps, and a citation
 * one line above its number is still a citation. Paragraph-scoped rather than
 * document-scoped for the opposite reason — one `AnnouncedMachine` at the top of a file
 * would otherwise licence every number in it.
 */
export function findMachineClaims(text: string): readonly MachineClaim[] {
  const lines = text.split('\n')
  const claims: MachineClaim[] = []

  let paragraph: string[] = []
  let paragraphStart = 1

  const flush = (): void => {
    const body = paragraph.join('\n')
    paragraph = []
    if (body.trim().length === 0) return
    if (ANNOUNCED_SOURCES.some((source) => body.includes(source))) return
    const seen = new Set<string>()
    for (const pattern of [NUMBER_THEN_MACHINES, MACHINE_COUNT_THEN_NUMBER]) {
      // `matchAll` rather than `exec` in a loop: these patterns are `/g`, so an `exec`
      // leaves `lastIndex` behind and hands the next caller a different regex than the
      // one declared above.
      for (const match of body.matchAll(pattern)) {
        const before = body.slice(0, match.index ?? 0)
        const line = paragraphStart + (before.split('\n').length - 1)
        const key = `${String(line)}:${match[0]}`
        if (seen.has(key)) continue
        seen.add(key)
        claims.push({ line, text: lines[line - 1] ?? match[0] })
      }
    }
  }

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      flush()
      paragraphStart = index + 2
      continue
    }
    if (paragraph.length === 0) paragraphStart = index + 1
    paragraph.push(line)
  }
  flush()

  return claims.sort((a, b) => a.line - b.line)
}

/**
 * The published-copy corpus: markdown and HTML under the four roots that carry claims.
 *
 * `-PLAN.md` is excluded and the exclusion is asserted rather than assumed. A plan is a
 * prompt written to an agent, not a sentence published to a reader — and this guard's own
 * plan quotes the fixture above verbatim in order to specify case A, so without the
 * exclusion the guard would fail on the document that commissioned it. The exclusion is
 * deliberately **not** widened to all of `.planning/phases/`: `39-PARTICIPANT-COUNT.md`
 * and `39-RUN-RECORD.md` are published records and belong in the corpus, and two plans in
 * this phase run this guard over them as an acceptance criterion.
 */
export function inCorpus(path: string): boolean {
  if (path === SELF) return false
  if (path.endsWith('-PLAN.md')) return false
  if (!path.endsWith('.md') && !path.endsWith('.html')) return false
  return (
    path.startsWith('.planning/') ||
    path.startsWith('docs/perf/') ||
    path.startsWith('packages/browser/demo/') ||
    !path.includes('/')
  )
}

interface Scan {
  readonly files: readonly string[]
  readonly lines: number
  readonly hits: readonly string[]
}

/**
 * `git ls-files` rather than a directory walk, for `vocabulary.node.test.ts`'s reason: it
 * excludes `node_modules`, `dist` and everything gitignored for free, and it matches what
 * a reader sees when they clone. It also means a new document is in the corpus from the
 * moment it is staged, which is how this phase's own records get scanned.
 */
function scanCorpus(): Scan {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)
    .filter(inCorpus)

  const files: string[] = []
  const hits: string[] = []
  let lines = 0

  for (const file of tracked) {
    let text: string
    try {
      text = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      continue // a staged deletion, or a file this checkout does not have
    }
    files.push(file)
    // Headings are not prose and `grep -c` would count them; the floor below is about
    // how much published *copy* was actually read.
    lines += text
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.startsWith('#')).length
    for (const claim of findMachineClaims(text)) {
      hits.push(`${file}:${String(claim.line)} — ${claim.text.trim()}`)
    }
  }

  return { files, lines, hits }
}

const CORPUS: Scan = scanCorpus()

describe('A — the pattern can see a machine claim', () => {
  /**
   * The control, and it runs first on purpose. Case C asserts an absence, and an absence
   * measured with a blind instrument is the failure mode this project has a standing note
   * about: a phase criterion nearly closed on an empty read whose positive control later
   * showed the read could not have been non-empty.
   */
  it('flags the fixture claim exactly once', () => {
    const found = findMachineClaims(FIXTURE)
    expect(
      found.map((claim) => claim.text),
      `the instrument did not see the fixture "${FIXTURE}" — case C's absence is then vacuous`,
    ).toEqual([FIXTURE])
    expect(found.length).toBe(1)
  })

  it('flags the other shapes a machine count is written in', () => {
    for (const claim of [
      'sixteen was wrong: 16 distinct machines answered',
      'the job ran across 40 machines',
      'measured on 40 independent machines',
      'machine count: 12',
    ]) {
      expect(findMachineClaims(claim).length, claim).toBeGreaterThan(0)
    }
  })

  it('clears a claim whose paragraph names where the machines were announced', () => {
    // Same sentence, same number, one added citation. If clearing did nothing this case
    // would be indistinguishable from case A.
    const cited = `${FIXTURE}, each read off its own AnnouncedMachine handshake line`
    expect(findMachineClaims(cited)).toEqual([])
    // …and the citation does not reach into the next paragraph.
    expect(findMachineClaims(`a run using AnnouncedMachine\n\n${FIXTURE}`).length).toBe(1)
  })
})

describe('B — the sentences already published are not claims', () => {
  const CORRECT = [
    'SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count',
    "BENCH-06's distinct-machine half is descoped",
    'the distinct-machine half is descoped, and unmeasured is not met',
    '5 distinct peers — machine count not measured; peers are tabs, and two tabs on one device are two peers',
    '### 3.2 Machine inventory on every run',
  ]

  for (const sentence of CORRECT) {
    it(`does not flag: ${sentence.slice(0, 60)}`, () => {
      expect(findMachineClaims(sentence)).toEqual([])
    })
  }
})

describe('C — the published corpus carries no uncleared machine claim', () => {
  it('holds no machine count with nothing behind it', () => {
    expect(CORPUS.hits).toEqual([])
  })

  it('applies its exclusions by rule, not by the file listing of the day', () => {
    expect(existsSync(join(ROOT, SELF)), `SELF is not a real path: ${SELF}`).toBe(true)
    expect(inCorpus(SELF)).toBe(false)
    expect(inCorpus('.planning/phases/phase-39-the-public-run/39-04-PLAN.md')).toBe(false)
    // The two records this phase publishes into the same directory stay in.
    expect(inCorpus('.planning/phases/phase-39-the-public-run/39-PARTICIPANT-COUNT.md')).toBe(
      true,
    )
    expect(inCorpus('.planning/phases/phase-39-the-public-run/39-RUN-RECORD.md')).toBe(true)
    expect(inCorpus('.planning/BENCHMARK-RESULTS.md')).toBe(true)
    expect(inCorpus('packages/browser/demo/index.html')).toBe(true)
    expect(inCorpus('packages/core/src/reduce.ts')).toBe(false)
  })
})

describe('D — the corpus enumeration returned something', () => {
  it('read enough published copy for case C to mean anything', () => {
    expect(
      CORPUS.files.length,
      'the corpus enumeration returned nothing — case C is vacuously true',
    ).toBeGreaterThanOrEqual(20)
    expect(
      CORPUS.lines,
      'the corpus enumeration returned nothing — case C is vacuously true',
    ).toBeGreaterThanOrEqual(200)
    expect(CORPUS.files).toContain('.planning/BENCHMARK-RESULTS.md')
    expect(CORPUS.files).toContain('packages/browser/demo/index.html')
  })
})
