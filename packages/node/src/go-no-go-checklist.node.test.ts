import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `RUN-01`'s go/no-go checklist, made checkable.
 *
 * The requirement is one sentence: *no recruitment invite is sent until `BROW-06`…`BROW-10`,
 * `RUN-02` and `RUN-03` all hold, recorded as a dated go/no-go checklist naming each
 * condition's evidence*, and *"a row with no named evidence is a no-go, not a judgement
 * call."* The engineering behind those seven rows was done in Phases 35 and 36. What did not
 * exist was the document, and a document nothing reads is the weak version of this criterion:
 * it is written once, on the day everything happens to be true, and then it decays silently
 * while the thing it gates — a Telegram-recruited cohort of a few hundred, spendable exactly
 * once — stays irreversible.
 *
 * So this file asks four questions of `39-GO-NO-GO.md`, and refuses on each:
 *
 * 1. Are the seven rows the seven rows? Not six, not eight, not a renamed one.
 * 2. Does every `GO` row name evidence that still resolves on disk?
 * 3. Is every requirement a `GO` row names still `[x]` in `.planning/REQUIREMENTS.md`?
 * 4. Does every `NO-GO` row name a blocker — and does a `NO-GO` row leave the suite green?
 *
 * The fourth question is the one that lets the document exist **before** the run rather than
 * be written after it. A checklist that could only ever be committed all-green would have to
 * wait for the last blocker to clear, which is precisely when nobody needs it any more.
 *
 * ## What this cannot ask, said here rather than left to be found
 *
 * It cannot ask whether a condition is *met*. It reads a path and a checkbox; the reading
 * behind `BROW-08`'s row is a spec that watched CPU fall to zero, and no textual check
 * reaches that. What it can do is refuse to let a `GO` sit with nothing behind it, and refuse
 * to let its own instrument die quietly — which is the failure mode this repository has
 * already shipped: a publish-command pattern that matched nothing and read green.
 *
 * Modelled on `acceptance-traceability.node.test.ts` — the parse floors and the
 * self-exclusion are that file's, copied rather than reinvented.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The checklist, at the path plan 39-01 writes it to and plans 39-05, 39-08 and 39-09 read it from. */
const CHECKLIST = '.planning/phases/phase-39-the-public-run/39-GO-NO-GO.md'

/** The ledger, at the path the project keeps it at. */
const LEDGER = '.planning/REQUIREMENTS.md'

/**
 * This file, excluded from the evidence the checklist may name.
 *
 * It has to be. `GATE_CONDITIONS` below names all seven ids, so a checklist row that cited
 * this file would make the checker its own evidence and every finding here would disappear
 * into a circle. The exclusion is asserted, not assumed, below — and so is the fact that it
 * would have mattered.
 */
const SELF = 'packages/node/src/go-no-go-checklist.node.test.ts'

/**
 * The seven, hand-written, in the order `RUN-01` states them.
 *
 * Written as a literal rather than derived from the document under test, because deriving
 * them would be an assertion reusing the value it tests: a checklist that lost a row would
 * define the expected set to be the set it has, and agree with itself perfectly.
 */
const GATE_CONDITIONS: readonly string[] = [
  'BROW-06',
  'BROW-07',
  'BROW-08',
  'BROW-09',
  'BROW-10',
  'RUN-02',
  'RUN-03',
]

/**
 * Floors, not equalities — and they are the load-bearing half.
 *
 * Almost every assertion below is of the shape "this list is empty". A parse that stops
 * matching satisfies all of them perfectly while checking nothing: a checklist parser that
 * finds zero rows proves that no row lacks evidence, flawlessly and vacuously. The floors are
 * what prove the parse ran. Each is a literal, not a count taken from the same parse it is
 * supposed to police.
 *
 * `ROW_FLOOR` is 7 because `RUN-01` names seven conditions and the count cannot legitimately
 * fall. `PRECONDITION_ROW_FLOOR` is 5 against the seven rows written on 2026-09-07, low
 * enough that a row legitimately closing does not fire it and high enough that a dead parse
 * does. `EVIDENCE_PATH_FLOOR` is 7 — one resolved path per `GO` row is the minimum a
 * seven-row all-`GO` table can produce. `LEDGER_JOIN_FLOOR` is 7 for the same reason: it
 * proves the requirement-id join found ids at all, which is the assertion that would
 * otherwise go quiet if the id pattern stopped matching.
 */
const ROW_FLOOR = 7
const PRECONDITION_ROW_FLOOR = 5
const EVIDENCE_PATH_FLOOR = 7
const LEDGER_JOIN_FLOOR = 7

/** The two section headings the parse is scoped to. Substrings, so the prose around them can change. */
const CONDITIONS_HEADING = 'The seven conditions'
const PRECONDITIONS_HEADING = 'Not one of the seven'

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read, or the empty string.
 *
 * Deliberately not a throw. An absent checklist must fail the *set equality* below, naming
 * all seven ids as missing — that is the observation proving this guard can see an absent
 * document. A `readFileSync` at module scope would instead produce a collection error, which
 * says "the suite could not load" and not "the seven conditions have no rows".
 */
function readOrEmpty(path: string): string {
  try {
    return readFileSync(join(ROOT, path), 'utf8')
  } catch {
    return ''
  }
}

const CHECKLIST_SOURCE = readOrEmpty(CHECKLIST)
const LEDGER_SOURCE = readOrEmpty(LEDGER)

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface Section {
  readonly text: string
  /** 1-based line in the whole document where the section body starts. */
  readonly firstLine: number
}

/**
 * The body under the first `## ` heading containing `needle`, up to the next `## `.
 *
 * The parse is scoped by section rather than run over the whole file, and that is the choice
 * the whole design turns on. The seven conditions and the preconditions are two tables with
 * two different rules — the first must contain exactly the seven ids, the second may name
 * `RUN-06`, `HOST-06` or `NET-12` without becoming an eighth condition — and a single
 * document-wide row parse cannot hold both rules at once.
 *
 * The cost is that a renamed heading empties a section silently. That is what the floors are
 * for, and both sections are additionally asserted to have been *found* rather than merely
 * non-empty.
 */
function section(markdown: string, needle: string): Section | null {
  const lines = markdown.split('\n')
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.startsWith('## ') && line.includes(needle)) {
      start = index + 1
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let index = start; index < lines.length; index += 1) {
    if ((lines[index] ?? '').startsWith('## ')) {
      end = index
      break
    }
  }
  return { text: lines.slice(start, end).join('\n'), firstLine: start + 1 }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface Row {
  /** The first cell's bold span, verbatim — an id in the conditions table, a phrase in the other. */
  readonly label: string
  readonly disposition: string
  /** The second data cell: named evidence on a `GO` row, the blocker on a `NO-GO` one. */
  readonly evidence: string
  /** Everything after it — the conditions table's `Ledger` column, empty in the three-column table. */
  readonly trailing: string
  /** 1-based line in the whole document, so a failure points at the row to argue with. */
  readonly line: number
}

/**
 * A data row: `| **LABEL** | DISPOSITION | … |`.
 *
 * **The choice the plan asks to be stated: the label is anchored to a `**bold**` span filling
 * the whole first cell, not to a bare `SCREAMING-NN` anywhere in the row.** A looser pattern
 * harvests ids out of the surrounding prose — the evidence cells quote requirement ids
 * constantly, and the document's own header paragraph names all seven — and every id it
 * harvests inflates the row count that is supposed to prove the parse is alive. Anchoring to
 * the bold span also gives the header row (`| Condition | Disposition | …`) and the separator
 * row no match at all, so neither has to be filtered by position.
 *
 * Not `/g`: it is applied per line with `RegExp#exec`, and a `/g` pattern would carry
 * `lastIndex` from one line into the next.
 */
const TABLE_ROW = /^\|\s*\*\*([^*|]+)\*\*\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|(.*)$/

function parseRows(from: Section | null): Row[] {
  if (from === null) return []
  const found: Row[] = []
  const lines = from.text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const match = TABLE_ROW.exec(line)
    if (match === null) continue
    const [, label, disposition, evidence, trailing] = match
    if (label === undefined || disposition === undefined || evidence === undefined) continue
    found.push({
      label: label.trim(),
      disposition: disposition.trim(),
      evidence: evidence.trim(),
      trailing: (trailing ?? '').replace(/\|\s*$/, '').trim(),
      line: from.firstLine + index,
    })
  }
  return found
}

const CONDITION_ROWS = parseRows(section(CHECKLIST_SOURCE, CONDITIONS_HEADING))
const PRECONDITION_ROWS = parseRows(section(CHECKLIST_SOURCE, PRECONDITIONS_HEADING))
const ALL_ROWS: readonly Row[] = [...CONDITION_ROWS, ...PRECONDITION_ROWS]

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/**
 * A path citation is a repo-root-relative path **inside a backtick span**, with an optional
 * `:N` or `:N-M` suffix.
 *
 * The backtick requirement is not decoration. A bare path harvested out of prose picks up the
 * punctuation that follows it — `…/data-cost.ts.` at the end of a sentence resolves to
 * nothing and reddens a row that is perfectly honest — and the fix of stripping trailing
 * punctuation then has to know that `:1378` is part of the path while `.` is not. Requiring
 * the backticks makes the boundary explicit and is already how this repository writes paths.
 *
 * Repo-root-relative is the second half of the contract, and it has already bitten once: the
 * ledger's own `BROW-06` row writes `demo/main.ts:2318-2331`, which is relative to
 * `packages/browser/`. Transcribed verbatim it resolves to nothing. The checklist normalises;
 * this is where the requirement to normalise is written down.
 */
const PATH_SHAPE =
  /^(?:packages|demo|tools|scripts|bin|dist|\.planning|\.github)\/[A-Za-z0-9._/-]+(?::\d+(?:-\d+)?)?$/

function citations(cell: string): string[] {
  const found: string[] = []
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const span = match[1]
    if (span !== undefined && PATH_SHAPE.test(span)) found.push(span)
  }
  return found
}

/**
 * How a citation resolves: `null` when it does, a stated reason when it does not.
 *
 * Injected rather than read directly from disk, so the mutation block below can drive the
 * whole verdict with a filesystem whose right answer is known — including the
 * path-stopped-resolving case, which cannot be produced against the live tree without
 * deleting a file another plan owns.
 */
type Resolver = (citation: string) => string | null

const diskResolver: Resolver = (citation) => {
  const [path, span] = citation.split(':')
  if (path === undefined || path.length === 0) return 'the citation has no path'
  const absolute = join(ROOT, path)
  if (!existsSync(absolute)) return 'no such file — the evidence this row names is gone'
  if (span === undefined) return null
  const first = Number(span.split('-')[0])
  if (!Number.isFinite(first)) return null
  const length = readFileSync(absolute, 'utf8').split('\n').length
  if (length < first) {
    return `the file has ${length} lines and the citation points at line ${first}`
  }
  return null
}

// ---------------------------------------------------------------------------
// The ledger's own checkboxes
// ---------------------------------------------------------------------------

/**
 * A checkbox row, anchored exactly as `acceptance-traceability.node.test.ts` anchors it.
 *
 * Copied rather than re-derived: two patterns reading the same ledger would come to disagree
 * the day one of them was widened, and that file's docblock records the widening that
 * already happened once.
 */
const LEDGER_CHECKBOX = /^-[ \t]+\[([ xX])\][ \t]+\*\*([A-Z][A-Z0-9-]*-\d+)\*\*/gm

function parseLedger(markdown: string): Map<string, boolean> {
  const found = new Map<string, boolean>()
  for (const match of markdown.matchAll(LEDGER_CHECKBOX)) {
    const marker = match[1]
    const id = match[2]
    if (marker === undefined || id === undefined) continue
    found.set(id, marker !== ' ')
  }
  return found
}

const LEDGER_BOXES = parseLedger(LEDGER_SOURCE)

/** Anything id-shaped in a row. Not `/g` at the call site — `matchAll` needs the flag and resets nothing. */
const ID_SHAPE = /[A-Z][A-Z0-9-]*-\d+/g

/**
 * The requirement ids a row names — meaning the id-shaped words the **ledger has a checkbox
 * for**, and no others.
 *
 * The narrowing is deliberate and it is a limit, so it is stated. A row's prose legitimately
 * carries id-shaped words that are not requirements: `T-39-01` from a threat register,
 * `DEMO-01` from a spec's case name, `UTF-8` from anywhere. Treating those as requirements
 * makes the guard fire on honest prose, and a guard that fires wrongly gets deleted.
 *
 * What it cannot see, in exchange: a typo. `BROW-66` is not in the ledger, so it is ignored
 * rather than reported. The set equality on the `Condition` column catches a typo *there*,
 * which is where it matters; a typo in prose is invisible here. `LEDGER_JOIN_FLOOR` is what
 * keeps the narrowing from becoming a hole — it proves the join found real ids at all.
 */
function requirementIdsIn(text: string, ledger: ReadonlyMap<string, boolean>): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(ID_SHAPE)) {
    const id = match[0]
    if (ledger.has(id)) found.add(id)
  }
  return [...found]
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const GO = 'GO'
const NO_GO = 'NO-GO'

/** What a `NO-GO` row is: a recorded blocker, not a suite failure. */
const RECORDED = 'recorded, not failing'
const MUST_RESOLVE = 'GO — its named evidence must resolve'

type Verdict = typeof RECORDED | typeof MUST_RESOLVE

/**
 * The disposition, classified — and the whole point of naming it is the `NO-GO` branch.
 *
 * A checklist that could only be committed all-green would have to wait for the last blocker
 * to clear, which is exactly when it stops being useful. So `NO-GO` is a state the document
 * is allowed to be in and the suite is required not to punish. This function is what the
 * assertion below reads, rather than the absence of a failure, because an absence proves
 * nothing about which branch ran.
 */
function verdictOf(row: Row): Verdict {
  return row.disposition === NO_GO ? RECORDED : MUST_RESOLVE
}

/** Does a `NO-GO` row's blocker cell name something a reader can go and check? */
function namesABlocker(text: string): boolean {
  if (citations(text).length > 0) return true
  if (/OWNER-ACTIONS\.md/.test(text) && /\brow \d+\b/.test(text)) return true
  if (/\bPhase \d+\b/.test(text)) return true
  if (/\bplan \d\d-\d\d\b/i.test(text)) return true
  return false
}

/**
 * Everything wrong with one row, as sentences.
 *
 * Pure over its three inputs — the row, the ledger and the resolver — so the mutation block
 * can drive it with input whose right answer is known. That is not tidiness: every live
 * assertion below is `toEqual([])`, and an empty list is also what a function that stopped
 * working returns.
 */
function problemsFor(row: Row, ledger: ReadonlyMap<string, boolean>, resolve: Resolver): string[] {
  const at = `${row.label} (${CHECKLIST}:${row.line})`
  const out: string[] = []

  if (row.disposition !== GO && row.disposition !== NO_GO) {
    out.push(
      `${at} reads "${row.disposition}" — a disposition is ${GO} or ${NO_GO}, and a third word ` +
        'is a judgement call, which is the thing RUN-01 refuses',
    )
    return out
  }

  if (verdictOf(row) === RECORDED) {
    if (!namesABlocker(row.evidence)) {
      out.push(
        `${at} is ${NO_GO} and names no blocker — a blocker is a path citation, an ` +
          'OWNER-ACTIONS.md row number, a "Phase NN" or a plan number, so that whoever reads ' +
          'this row knows where to go and look',
      )
    }
    return out
  }

  const cited = [...citations(row.evidence), ...citations(row.trailing)]
  if (citations(row.evidence).length === 0) {
    out.push(
      `${at} reads ${GO} and its evidence cell names no path at all — a row with no named ` +
        'evidence is a no-go, not a judgement call',
    )
  }
  for (const citation of cited) {
    const why = resolve(citation)
    if (why !== null) out.push(`${at} cites \`${citation}\` — ${why}`)
  }
  for (const id of requirementIdsIn(`${row.label} ${row.evidence} ${row.trailing}`, ledger)) {
    if (ledger.get(id) === false) {
      out.push(
        `${at} reads ${GO} and names ${id}, whose box in ${LEDGER} is [ ] — the checklist and ` +
          'the ledger disagree about what is delivered',
      )
    }
  }
  return out
}

function problemsAcross(
  rows: readonly Row[],
  ledger: ReadonlyMap<string, boolean>,
  resolve: Resolver,
): string[] {
  return rows.flatMap((row) => problemsFor(row, ledger, resolve))
}

/** Every citation on a `GO` row that resolved — the number the evidence floor is taken over. */
function resolvedCitations(rows: readonly Row[], resolve: Resolver): string[] {
  return rows
    .filter((row) => verdictOf(row) === MUST_RESOLVE)
    .flatMap((row) => [...citations(row.evidence), ...citations(row.trailing)])
    .filter((citation) => resolve(citation) === null)
}

// ===========================================================================
// The document
// ===========================================================================

describe('the checklist this suite reads is the real checklist', () => {
  it('reads it from the path RUN-01 names and the rest of Phase 39 imports', () => {
    expect(
      existsSync(join(ROOT, CHECKLIST)),
      `${CHECKLIST} does not exist — RUN-01's deliverable is the document, and there is none`,
    ).toBe(true)
    expect(CHECKLIST_SOURCE.length).toBeGreaterThan(0)
  })

  it('found both tables, which is what the section-scoped parse depends on', () => {
    expect(
      section(CHECKLIST_SOURCE, CONDITIONS_HEADING),
      `no "## …${CONDITIONS_HEADING}…" heading — the seven-condition table cannot be located, ` +
        'so every assertion over it is vacuous',
    ).not.toBeNull()
    expect(
      section(CHECKLIST_SOURCE, PRECONDITIONS_HEADING),
      `no "## …${PRECONDITIONS_HEADING}…" heading — the preconditions table cannot be located`,
    ).not.toBeNull()
  })
})

// 1 — the seven are the seven.
describe('the seven conditions RUN-01 names each have a row, and nothing else does', () => {
  it('carries exactly the seven, with no eighth and none missing', () => {
    const parsed = new Set(CONDITION_ROWS.map((row) => row.label))
    const expected = new Set(GATE_CONDITIONS)
    const missing = [...expected].filter((id) => !parsed.has(id))
    const unexpected = [...parsed].filter((id) => !expected.has(id))
    expect(
      { missing, unexpected },
      `the seven-condition table does not match RUN-01's list. Missing: ${
        missing.join(', ') || 'none'
      }. Unexpected: ${unexpected.join(', ') || 'none'}`,
    ).toEqual({ missing: [], unexpected: [] })
  })

  it('gives each condition exactly one row', () => {
    const seen = new Map<string, number>()
    for (const row of CONDITION_ROWS) seen.set(row.label, (seen.get(row.label) ?? 0) + 1)
    expect([...seen].filter(([, count]) => count > 1)).toEqual([])
  })
})

// 2 — the disposition vocabulary.
describe('every row reads GO or NO-GO and nothing else', () => {
  it('uses no third word anywhere in either table', () => {
    const offenders = ALL_ROWS.filter(
      (row) => row.disposition !== GO && row.disposition !== NO_GO,
    ).map((row) => `${row.label} (${CHECKLIST}:${row.line}) reads "${row.disposition}"`)
    expect(offenders).toEqual([])
    expect(ALL_ROWS.length).toBeGreaterThanOrEqual(ROW_FLOOR)
  })
})

// 3 — a GO row's evidence resolves.
describe('a GO row names evidence, and the evidence is still there', () => {
  it('has no GO row whose evidence cell is empty and no citation that stopped resolving', () => {
    const offenders = problemsAcross(ALL_ROWS, LEDGER_BOXES, diskResolver).filter((problem) =>
      problem.includes(GO),
    )
    expect(offenders).toEqual([])
  })
})

// 4 — a GO row's requirement ids are still ticked.
describe('the checklist and the ledger agree about what is delivered', () => {
  it('names no requirement on a GO row whose ledger box is unticked', () => {
    const offenders = ALL_ROWS.filter((row) => verdictOf(row) === MUST_RESOLVE).flatMap((row) =>
      requirementIdsIn(`${row.label} ${row.evidence} ${row.trailing}`, LEDGER_BOXES)
        .filter((id) => LEDGER_BOXES.get(id) === false)
        .map((id) => `${row.label} (${CHECKLIST}:${row.line}) names ${id}, which is [ ]`),
    )
    expect(offenders).toEqual([])
  })

  it('read the ledger it joins against, in both states', () => {
    expect(LEDGER_BOXES.size).toBeGreaterThan(60)
    expect([...LEDGER_BOXES.values()].filter((ticked) => ticked).length).toBeGreaterThan(0)
    expect([...LEDGER_BOXES.values()].filter((ticked) => !ticked).length).toBeGreaterThan(0)
  })
})

// 5 — a NO-GO row names a blocker, and is not a failure.
describe('a NO-GO row is recorded, not punished', () => {
  it('names a blocker on every NO-GO row', () => {
    const offenders = ALL_ROWS.filter((row) => verdictOf(row) === RECORDED)
      .filter((row) => !namesABlocker(row.evidence))
      .map((row) => `${row.label} (${CHECKLIST}:${row.line}) is ${NO_GO} and names no blocker`)
    expect(offenders).toEqual([])
  })

  it('returns "recorded, not failing" for a NO-GO row taken from the live document', () => {
    // Taken from the document rather than constructed, so this is a statement about the
    // checklist as committed and not about a fixture. If the day comes when nothing is
    // NO-GO, the assertion below says so rather than passing over an empty list.
    const recorded = ALL_ROWS.filter((row) => row.disposition === NO_GO)
    expect(
      recorded.length,
      'no NO-GO row in the document — this case then proves nothing about the NO-GO branch, ' +
        'and the synthetic cases below are the only thing carrying it',
    ).toBeGreaterThan(0)
    for (const row of recorded) {
      expect(verdictOf(row)).toBe(RECORDED)
      expect(problemsFor(row, LEDGER_BOXES, diskResolver)).toEqual([])
    }
  })
})

// 6 — the date.
describe('the checklist is dated, which is half of what RUN-01 asks for', () => {
  it('carries an ISO date in its first 20 lines, and the date parses', () => {
    const head = CHECKLIST_SOURCE.split('\n').slice(0, 20)
    const dated = head.find((line) => /^\*\*Dated:\*\* \d{4}-\d{2}-\d{2}/.test(line))
    expect(dated, 'no "**Dated:** YYYY-MM-DD" line in the first 20 lines').toBeDefined()
    const stamp = /(\d{4}-\d{2}-\d{2})/.exec(dated ?? '')?.[1] ?? ''
    expect(Number.isFinite(Date.parse(stamp))).toBe(true)
  })
})

// 7 — the floors.
describe('the parse ran', () => {
  const vacuous = 'the parse stopped matching — every assertion above is vacuously true'

  it('found at least as many condition rows as RUN-01 names', () => {
    expect(CONDITION_ROWS.length, vacuous).toBeGreaterThanOrEqual(ROW_FLOOR)
  })

  it('found the preconditions table too, which is where the NO-GO rows live', () => {
    expect(PRECONDITION_ROWS.length, vacuous).toBeGreaterThanOrEqual(PRECONDITION_ROW_FLOOR)
  })

  it('resolved evidence paths rather than finding none to resolve', () => {
    expect(resolvedCitations(ALL_ROWS, diskResolver).length, vacuous).toBeGreaterThanOrEqual(
      EVIDENCE_PATH_FLOOR,
    )
  })

  it('joined real requirement ids against the ledger', () => {
    const joined = new Set(
      ALL_ROWS.flatMap((row) =>
        requirementIdsIn(`${row.label} ${row.evidence} ${row.trailing}`, LEDGER_BOXES),
      ),
    )
    expect(joined.size, vacuous).toBeGreaterThanOrEqual(LEDGER_JOIN_FLOOR)
  })
})

describe('the checker is not its own evidence', () => {
  /**
   * The loophole, closed and asserted in both halves.
   *
   * This file names all seven ids in `GATE_CONDITIONS`, and it is a tracked file under a path
   * shape the citation parser recognises. A checklist row citing it would therefore satisfy
   * "names evidence that resolves" by pointing at the thing doing the checking — a circle
   * that reads exactly like a healthy row. So: the file names the ids (the exclusion would
   * have mattered), and no row cites it (the exclusion holds).
   */
  it('names every gate condition, so citing it would have closed the circle', () => {
    const own = readFileSync(join(ROOT, SELF), 'utf8')
    for (const id of GATE_CONDITIONS) expect(own).toContain(id)
  })

  it('is cited by no row in the checklist', () => {
    const offenders = ALL_ROWS.filter((row) =>
      [...citations(row.evidence), ...citations(row.trailing)].some((citation) =>
        citation.startsWith(SELF),
      ),
    ).map(
      (row) =>
        `${row.label} (${CHECKLIST}:${row.line}) cites ${SELF} as evidence — the checker would ` +
        'be certifying the checklist by quoting itself',
    )
    expect(offenders).toEqual([])
  })
})

// ===========================================================================
// The checker can fail — proved by mutation, not assumed
// ===========================================================================

describe('the checker can fail, driven with input whose right answer is known', () => {
  /**
   * Every live assertion above is `toEqual([])`, and a `problemsFor` that returned `[]`
   * unconditionally would satisfy all of them. These cases are what show it does not.
   *
   * The ids are `FAKE-nn` rather than the real seven, for two reasons: the real ones would
   * make this block a second, disagreeing statement about the ledger, and the acceptance
   * check on this file counts each gate id as a quoted literal exactly once — in
   * `GATE_CONDITIONS`, where it belongs.
   */
  const SYNTHETIC_LEDGER = new Map<string, boolean>([
    ['FAKE-01', true],
    ['FAKE-02', false],
  ])

  const PRESENT = 'packages/node/src/go-no-go-checklist.node.test.ts'
  const ABSENT = 'packages/node/src/no-such-evidence.ts'

  const syntheticResolver: Resolver = (citation) =>
    citation.split(':')[0] === PRESENT ? null : 'no such file'

  const row = (label: string, disposition: string, evidence: string, trailing = ''): Row => ({
    label,
    disposition,
    evidence,
    trailing,
    line: 1,
  })

  const problems = (input: Row): string[] => problemsFor(input, SYNTHETIC_LEDGER, syntheticResolver)

  it('passes a well-formed GO row', () => {
    expect(problems(row('FAKE-01', GO, `measured, see \`${PRESENT}\``))).toEqual([])
  })

  it('fails a GO row whose evidence cell is empty — the plant Task 2 watches red', () => {
    const found = problems(row('FAKE-01', GO, ''))
    expect(found.length).toBe(1)
    expect(found[0]).toContain('no path at all')
  })

  it('fails a GO row whose evidence stopped resolving', () => {
    const found = problems(row('FAKE-01', GO, `see \`${ABSENT}\``))
    expect(found.length).toBe(1)
    expect(found[0]).toContain('no such file')
  })

  it('fails a GO row naming a requirement whose ledger box is unticked', () => {
    const found = problems(row('FAKE-02', GO, `see \`${PRESENT}\``))
    expect(found.length).toBe(1)
    expect(found[0]).toContain('is [ ]')
  })

  it('fails a disposition that is neither word', () => {
    const found = problems(row('FAKE-01', 'probably', `see \`${PRESENT}\``))
    expect(found.length).toBe(1)
    expect(found[0]).toContain('a third word')
  })

  it('passes a NO-GO row that names a blocker, in each of the four shapes', () => {
    expect(problems(row('a label', NO_GO, `blocked by \`${ABSENT}\``))).toEqual([])
    expect(problems(row('a label', NO_GO, 'blocked by `.planning/OWNER-ACTIONS.md` row 2'))).toEqual(
      [],
    )
    expect(problems(row('a label', NO_GO, 'blocked by Phase 34'))).toEqual([])
    expect(problems(row('a label', NO_GO, 'blocked by plan 39-04'))).toEqual([])
  })

  it('fails a NO-GO row that names nothing', () => {
    const found = problems(row('a label', NO_GO, 'not yet'))
    expect(found.length).toBe(1)
    expect(found[0]).toContain('names no blocker')
  })

  it('does not hold a NO-GO row to the evidence rule a GO row is held to', () => {
    // The property that lets this document exist before the run: a NO-GO row cites nothing
    // that resolves, names an unticked requirement, and is still not a failure.
    const recorded = row('a label', NO_GO, `FAKE-02 is open — see \`${ABSENT}\`, Phase 34`)
    expect(verdictOf(recorded)).toBe(RECORDED)
    expect(problems(recorded)).toEqual([])
  })

  it('parses a table it has never seen, and ignores the header and separator rows', () => {
    const synthetic = [
      '## The seven conditions, for a document that does not exist',
      '',
      '| Condition | Disposition | Named evidence | Ledger |',
      '| --- | --- | --- | --- |',
      '| **FAKE-01** | GO | `packages/node/src/go-no-go-checklist.node.test.ts` | `.planning/REQUIREMENTS.md:1` |',
      '| **FAKE-02** | NO-GO | Phase 34 | — |',
      '',
      '## Something else',
      '',
      '| **FAKE-03** | GO | not in the first section | — |',
    ].join('\n')
    const parsed = parseRows(section(synthetic, 'The seven conditions'))
    expect(parsed.map((entry) => entry.label)).toEqual(['FAKE-01', 'FAKE-02'])
    expect(parsed.map((entry) => entry.disposition)).toEqual([GO, NO_GO])
    expect(parsed[0]?.evidence).toBe('`packages/node/src/go-no-go-checklist.node.test.ts`')
    expect(parsed[0]?.trailing).toBe('`.planning/REQUIREMENTS.md:1`')
    // The heading scoping is real: the third row is under a different heading.
    expect(parsed.map((entry) => entry.label)).not.toContain('FAKE-03')
  })

  it('reports nothing at all when the document is gone — which is what the floors catch', () => {
    expect(parseRows(section('', CONDITIONS_HEADING))).toEqual([])
    expect(section('# a document with no such heading', CONDITIONS_HEADING)).toBeNull()
  })

  it('reads a path citation only inside backticks, and only repo-root-relative', () => {
    expect(citations('`packages/node/src/x.ts`')).toEqual(['packages/node/src/x.ts'])
    expect(citations('`packages/node/src/x.ts:12-40`')).toEqual(['packages/node/src/x.ts:12-40'])
    // Bare prose is not a citation — the trailing full stop would be part of the path.
    expect(citations('packages/node/src/x.ts.')).toEqual([])
    // Not repo-root-relative: the ledger's own BROW-06 row writes this shape.
    expect(citations('`main.ts:2318-2331`')).toEqual([])
    // A backtick span that is not a path is a symbol, not evidence.
    expect(citations('`fetchModuleForDispatch`')).toEqual([])
  })

  it('reads a line-suffixed citation as a claim about the file length', () => {
    expect(diskResolver(SELF)).toBeNull()
    expect(diskResolver(`${SELF}:1`)).toBeNull()
    expect(diskResolver(`${SELF}:999999`)).toContain('points at line 999999')
    expect(diskResolver('packages/node/src/no-such-evidence.ts')).toContain('no such file')
  })
})
