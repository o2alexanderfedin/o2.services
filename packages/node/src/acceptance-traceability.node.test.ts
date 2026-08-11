import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The requirements ledger, made checkable.
 *
 * `.planning/REQUIREMENTS.md` carries ~82 rows of the form `- [x] **SCHED-06**: …`.
 * A `[x]` is a claim that the system does something. Until now that claim was prose,
 * and this project's ledger has been measurably wrong about "done" more than once —
 * the v1.0 milestone audit moved 36 rows back to `[ ]` after tracing them from the
 * five runnable entry points and finding that the mechanism had no production caller
 * at all. Requirement ids do appear in test files today, so informal traceability
 * exists; nothing checked it.
 *
 * So this file asks one question of every satisfied row: **is there a test that names
 * you?** It cannot ask the question anyone actually wants answered — "is the
 * requirement met" — and it does not pretend to. What it can do is refuse to let a
 * `[x]` exist with nothing at all behind it, and refuse to let its own instrument
 * die quietly, which is the failure mode this repository has already shipped once:
 * the disclosure gate's publish-command pattern matched nothing and read green.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The ledger, at the path the project keeps it at. */
const LEDGER = '.planning/REQUIREMENTS.md'

/**
 * This file, excluded from the corpus it scans.
 *
 * It has to be. The data below names the very ids it reports on, so an unfiltered
 * scan would find `DET-05` mentioned in a test file — this one — and report the
 * requirement traced. The checker would become its own evidence and every finding
 * would disappear. The exclusion is asserted, not assumed, below.
 */
const SELF = 'packages/node/src/acceptance-traceability.node.test.ts'

/**
 * Floors, not equalities.
 *
 * Every interesting assertion in this file is of the shape "this list is empty".
 * A parse that stops matching satisfies all of them perfectly while checking
 * nothing, which is exactly how an absent instrument reads as a clean one. The
 * floors are the proof that the parse ran. They are set well below what was
 * measured on 2026-07-29 — 82 requirement rows, 86 tracked test files, 1304 test
 * titles, 28 satisfied requirements traced to a title — because a floor exists to
 * catch a *collapse*, not to freeze a count that legitimately grows.
 */
const REQUIREMENT_FLOOR = 60
const TEST_FILE_FLOOR = 60
const TITLE_FLOOR = 600
const TITLED_REQUIREMENT_FLOOR = 15

// ---------------------------------------------------------------------------
// Parsing the ledger
// ---------------------------------------------------------------------------

interface Requirement {
  readonly id: string
  /** `true` for `[x]`. */
  readonly satisfied: boolean
  /** 1-based line in the ledger, so a failure points at the row to argue with. */
  readonly line: number
}

/**
 * A checkbox row.
 *
 * Anchored to the start of a line and to the `**ID**` bold span, which is how every
 * row in the ledger is written. Deliberately narrow: prose elsewhere in the file
 * mentions ids constantly (the traceability table names all 76), and a looser pattern
 * would harvest those as requirements and inflate the count that is supposed to prove
 * the parse is alive.
 *
 * **Widened from `[A-Z]+-\d+` to `[A-Z][A-Z0-9-]*-\d+`, 2026-08-09 (Plan 25-02).** The
 * narrow form is uppercase letters only before the hyphen, so it could not match an id
 * whose prefix carries a digit — `X509-01` dies at the `5`. Plan 25-02 needed to mint
 * exactly such a family, and minting the rows without this fix would have made them
 * pass every check in this file by being invisible to it, never checked at all — the
 * "ledger edited to satisfy its own checker" failure mode this file's own docblock
 * names as a prior real incident. `requirements-ledger.node.test.ts:457/800/826` already
 * used this wider pattern; copied verbatim rather than inventing a second one. Every id
 * the narrow pattern matched, the wider one still matches — the added middle class
 * `[A-Z0-9-]*` is a strict superset of `[A-Z]*`, so no existing row lost its match.
 * Measured directly rather than merely argued: 82 requirement rows matched before this
 * widening and the X509-01…07 mint below, 89 after both, landed in the same commit.
 */
const REQUIREMENT_ROW = /^-[ \t]+\[([ xX])\][ \t]+\*\*([A-Z][A-Z0-9-]*-\d+)\*\*/gm

function parseLedger(markdown: string): Requirement[] {
  const found: Requirement[] = []
  for (const match of markdown.matchAll(REQUIREMENT_ROW)) {
    const marker = match[1]
    const id = match[2]
    if (marker === undefined || id === undefined || match.index === undefined) continue
    const line = markdown.slice(0, match.index).split('\n').length
    found.push({ id, satisfied: marker !== ' ', line })
  }
  return found
}

// ---------------------------------------------------------------------------
// Parsing the traceability table — the ledger's second representation
// ---------------------------------------------------------------------------

/**
 * The same fact, written twice.
 *
 * A requirement's delivery state appears in two places in this file: the checkbox on
 * its row, and the status word in the traceability table at the bottom. The rule
 * relating them is written down at `.planning/REQUIREMENTS.md`'s legend — `[x]` means
 * delivered, `[ ]` + **Partial** and `[ ]` + **Built, not wired** mean it is not — and
 * until this parse nothing read both. Four rows disagreed.
 *
 * The audit above cannot see this class at all. It asks whether *some* tracked test
 * names each `[x]` id, which a mechanism's own unit spec satisfies whether or not the
 * mechanism is reachable from anything a person can run. That is the difference
 * between "there is a test" and "the ledger agrees with itself".
 *
 * **Widened from `[A-Z]+-\d+` to `[A-Z][A-Z0-9-]*-\d+`, 2026-08-09 (Plan 25-02)** — the
 * same fix, for the same reason, as `REQUIREMENT_ROW` immediately above. See that
 * constant's docblock for the full account; the 82→89 measured count applies to both
 * patterns identically, since every ledger id gets a checkbox row and a traceability
 * row in the same commit.
 */
const TRACEABILITY_ROW = /^\|\s*([A-Z][A-Z0-9-]*-\d+)\s*\|([^|]*)\|([^|]*)\|/gm

interface TraceabilityRow {
  readonly id: string
  /** The leading verdict, `**` stripped and any trailing argument cut off. */
  readonly status: string
  readonly line: number
}

/**
 * Read the status cell as a verdict plus an argument, and keep only the verdict.
 *
 * The em dash separates them by convention throughout the table, and the argument
 * routinely contains words that read like verdicts — DATA-05, DATA-06 and DATA-07 all
 * say "unmeasured" or "not met" *after* a `Done`. Searching the whole cell for
 * "Partial" would report those three as offenders, which is why only the leading
 * verdict gets classified.
 */
function parseTraceability(markdown: string): TraceabilityRow[] {
  const found: TraceabilityRow[] = []
  for (const match of markdown.matchAll(TRACEABILITY_ROW)) {
    const id = match[1]
    const cell = match[3]
    if (id === undefined || cell === undefined || match.index === undefined) continue
    const status = (cell.replaceAll('**', '').split('—')[0] ?? '').trim()
    found.push({ id, status, line: markdown.slice(0, match.index).split('\n').length })
  }
  return found
}

/**
 * `[x]` rows the `[x]`-iff-`Done` join **cannot see**, because they have no row to join to.
 *
 * Pure over its two inputs so the mutation block can drive it with a synthetic ledger whose
 * right answer is known. That is the whole point: the live reading below is an empty list, and
 * an empty list is what a check that stopped working produces too.
 */
function unjoinableCheckboxes(
  requirements: readonly Requirement[],
  rows: readonly TraceabilityRow[],
): string[] {
  const has = new Set(rows.map((row) => row.id))
  return requirements
    .filter((requirement) => requirement.satisfied && !has.has(requirement.id))
    .map(
      (requirement) =>
        `${requirement.id} — [x] at ${LEDGER}:${requirement.line} has no traceability row, so ` +
        'the [x]-iff-Done rule never sees it: the tick is unguarded rather than wrong. Write the ' +
        'row with an honest status, or clear the box — do NOT add the id to ' +
        'CHECKBOXES_WITHOUT_A_ROW, which exempts it from the rule rather than from the row',
    )
}

/** Traceability rows no checkbox anchors — a delivery claim nothing can retract. */
function unanchoredRows(
  rows: readonly TraceabilityRow[],
  requirements: readonly Requirement[],
): string[] {
  const checkboxes = new Set(requirements.map(({ id }) => id))
  return rows
    .filter((row) => !checkboxes.has(row.id))
    .map(
      (row) =>
        `${row.id} at ${LEDGER}:${row.line} reads **${row.status}** with no checkbox row anywhere ` +
        'in the ledger — a delivery claim nothing can retract',
    )
}

/**
 * Every status word the table uses, measured rather than assumed.
 *
 * A status outside this set **fails**, naming the row. That is the half that keeps
 * the join alive: a later `Mostly done` would otherwise be classified as not-Done by
 * a `startsWith('Done')` test and silently exempt its row from nothing at all, and the
 * guard would read exactly like a healthy one. This repository has shipped a
 * classifier that matched nothing once already.
 */
const RECOGNISED_STATUSES: readonly string[] = [
  'Done',
  'Done against the amended criterion',
  'Done against the amended criterion, with its granularity stated',
  'Built, not wired',
  'Partial',
  'Not started',
]

/** The legend's rule: `[x]` iff the traceability verdict begins `Done`. */
const delivered = (status: string): boolean => status.startsWith('Done')

/**
 * Checkbox ids the traceability table has no row for. **Empty as of 2026-08-08.**
 *
 * It held six — `SCHED-06`, `NET-08`, `NET-09`, `NET-10`, `DATA-10`, `BENCH-07`, all minted with
 * v1.1 — and the reason given for holding them was exactly right: *"the only way to go green
 * would be to invent rows — a ledger edited to satisfy its own checker."*
 *
 * **The rows were written rather than invented, which is the distinction that sentence turns
 * on.** The v1.1 milestone audit's three-source cross-reference read the checklist and this
 * table as two independent sources, found the six, and a cross-phase integration pass then
 * located each mechanism by symbol and file — `CountingExecutor` composed outermost for
 * SCHED-06, `readMessage`'s ceiling on the receive path for NET-08, the named `reason` on
 * `AgentResponse` for NET-10, `withholdingFrom` as the block source in both factories for
 * DATA-10, `processRunnerFor` → a spawned `bin/agent.ts` for BENCH-07. Each row states what was
 * found. NET-09 went in as **Partial**, not Done, and its checkbox came *off* — which is the
 * evidence that these were measured rather than fitted to the checker.
 *
 * Kept as an empty set rather than deleted: the assertion below is an equality, so a row
 * disappearing still fails here rather than silently re-opening the hole.
 */
const CHECKBOXES_WITHOUT_A_ROW: readonly string[] = []

const TRACEABILITY_FLOOR = 60

// ---------------------------------------------------------------------------
// Reading the test corpus
// ---------------------------------------------------------------------------

type Corpus = ReadonlyMap<string, string>

/**
 * How a read failure reads in a report — the errno when there is one, the message
 * otherwise. `unknown` because a `catch` binding is `unknown` and pretending it is an
 * `Error` is how a report ends up saying `undefined`.
 */
function readFailure(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code
    return code ?? cause.message
  }
  return String(cause)
}

/**
 * The corpus, plus every tracked test file that could not be read.
 *
 * The second half exists because the first used to swallow a read failure. A test
 * file that never enters the corpus cannot supply traceability for any requirement,
 * so a dropped file makes ids look untraced — or, in the direction that actually
 * hurts, lets `TEST_FILE_FLOOR` be met by a corpus that is quietly one file short
 * while every "no absent requirements" assertion reads as healthy.
 */
interface CorpusScan {
  readonly corpus: Corpus
  readonly unreadable: readonly string[]
}

/**
 * Every test file git tracks, keyed by repo-relative path.
 *
 * `git ls-files` rather than a directory walk, for `vocabulary.node.test.ts`'s
 * reason: it matches what somebody sees when they clone the repository, which is the
 * population a traceability claim is about. The cost is that an untracked test file
 * is not evidence — which is the right direction, because nobody else can read it.
 *
 * A file git tracks that this cannot open is a different thing entirely, and it is
 * reported by name rather than dropped.
 */
function readCorpus(): CorpusScan {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)

  const corpus = new Map<string, string>()
  const unreadable: string[] = []
  for (const path of tracked) {
    if (!path.endsWith('.test.ts')) continue
    if (path === SELF) continue
    try {
      corpus.set(path, readFileSync(join(ROOT, path), 'utf8'))
    } catch (cause) {
      unreadable.push(`${path} — ${readFailure(cause)}`)
    }
  }
  return { corpus, unreadable }
}

/**
 * Does `text` name this requirement?
 *
 * Word-anchored rather than a substring test, so `SCHED-06` is not found inside
 * `SCHED-060` and `NET-10` is not found by a search for a shorter id. Proved by
 * mutation below, because a silent substring hit would manufacture traceability.
 */
function mentions(id: string, text: string): boolean {
  return new RegExp(`\\b${id}\\b`).test(text)
}

/**
 * Titles of `describe` / `it` / `test` blocks.
 *
 * The optional `\([^()]*\)` handles the curried forms this repository actually uses —
 * `it.each([…])('title')`, `it.skipIf(cond)('title')` — where the title is not the
 * first argument. It gives up on a curried argument containing nested parentheses.
 * That limitation is safe in one direction only, and deliberately so: a missed title
 * downgrades a requirement from `titled` to `named`, which *requires* a written
 * exemption below. A parser gap therefore surfaces as a demand for a reason, never as
 * a silent pass.
 */
const TITLE = /\b(?:describe|it|test)(?:\.\w+)*\s*(?:\([^()]*\)\s*)?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g

function titlesOf(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(TITLE)) {
    const title = match[2]
    if (title !== undefined) found.push(title)
  }
  return found
}

// ---------------------------------------------------------------------------
// What counts as traced — the rule, and what it cannot do
// ---------------------------------------------------------------------------

/**
 * How strongly a requirement id is tied to running code.
 *
 * **The rule chosen.** An id is `titled` when it appears inside a `describe`/`it`
 * title in a file that also contains at least one `expect(`. It is `named` when it
 * appears somewhere else in such a file — almost always a file-level docblock. It is
 * `inert` when the only files naming it contain no assertion at all. It is `absent`
 * when no tracked test file names it.
 *
 * **Why the title.** A title is the only place an id reaches the test *report*. When
 * a titled block fails, the output says `SCHED-06`, and whoever reads it knows which
 * ledger row just became false. A comment appears in no output and survives any
 * rewrite of the assertions beneath it.
 *
 * **What this does not establish, stated plainly.** A title naming an id proves a
 * block exists, runs, and is reported under that name. It does **not** prove the
 * assertions inside it bear on the requirement — `describe('DATA-05', () => it('x',
 * () => expect(1).toBe(1)))` would satisfy this file completely. No textual check can
 * close that gap; only reading the test can, and reading is what the phase
 * verification documents are for. The claim here is narrower and worth exactly what
 * it says: **no satisfied requirement is entirely unaccounted for, and every
 * weakly-accounted one is written down with a reason.**
 */
type Trace = 'titled' | 'named' | 'inert' | 'absent'

interface TraceResult {
  readonly trace: Trace
  /** Files naming the id at all. */
  readonly referencedIn: readonly string[]
  /** Of those, the ones containing at least one `expect(`. */
  readonly assertingIn: readonly string[]
  /** Of those, the ones naming the id in a `describe`/`it` title. */
  readonly titledIn: readonly string[]
}

function classify(id: string, corpus: Corpus): TraceResult {
  const referencedIn: string[] = []
  const assertingIn: string[] = []
  const titledIn: string[] = []

  for (const [path, source] of corpus) {
    if (!mentions(id, source)) continue
    referencedIn.push(path)
    if (!source.includes('expect(')) continue
    assertingIn.push(path)
    if (titlesOf(source).some((title) => mentions(id, title))) titledIn.push(path)
  }

  const trace: Trace =
    referencedIn.length === 0
      ? 'absent'
      : assertingIn.length === 0
        ? 'inert'
        : titledIn.length === 0
          ? 'named'
          : 'titled'

  return { trace, referencedIn, assertingIn, titledIn }
}

// ---------------------------------------------------------------------------
// The exemptions — data, each carrying its reason
// ---------------------------------------------------------------------------

/** Which of this file's two rules an exemption waives. */
type Rule =
  /** A satisfied requirement must be named by at least one asserting test file. */
  | 'named-by-a-test'
  /** …and named inside a `describe`/`it` title, so a failure reports the id. */
  | 'named-in-a-test-title'

interface Exemption {
  readonly id: string
  readonly waives: Rule
  /** Where the requirement's evidence actually lives, so the entry is auditable. */
  readonly evidence: string
  readonly reason: string
}

/**
 * Requirements exempt from a rule, each with the reason it is defensible.
 *
 * Shape copied from `vocabulary.node.test.ts`'s `EXEMPT_LINES`, and for its reason: a
 * rule that cannot express its own exceptions gets deleted the first time it fires
 * wrongly. An entry is *dead* once the requirement satisfies the waived rule on its
 * own, and a dead entry fails below — so improving a test means deleting one line
 * here, and an exemption cannot outlive the situation it describes.
 *
 * `named-by-a-test` — the "genuinely untestable" waiver, for hosting, patents, human
 * acts and anything else no test in this repository could establish — has **no
 * members, and that is a measurement rather than an oversight.** Every one of the 82
 * rows is named by at least one tracked test file today, including the four the
 * ledger itself excludes from v1.1: NET-03 (needs a publicly reachable host) is
 * title-traced by `relaying.node.test.ts` for the browser-dialable half, and
 * BENCH-06, AOT-03 and AOT-05 are all traced for the halves that were measured. An
 * entry was not invented to populate the list. The waiver is defined, exercised by
 * mutation below, and empty — and the two rows that would otherwise want it are
 * recorded as findings instead, because a titled test *could* name them.
 */
const EXEMPT: readonly Exemption[] = [
  {
    id: 'WIRE-01',
    waives: 'named-in-a-test-title',
    evidence: 'packages/net/src/agent-contract.test.ts — seven `@ts-expect-error WIRE-01` markers',
    reason:
      'the proof is a compile failure, not a runtime outcome: omitting a `serveAgent` hook must fail `tsc --noEmit` naming the property, and no runnable title can assert that — the directives are checked by the type-checker, and vitest never sees them. Its runtime companion, serve-agent-hooks.node.test.ts, counts opt-out sentinels at production call sites, which is a different criterion of the same requirement',
  },
  {
    id: 'BENCH-01',
    waives: 'named-in-a-test-title',
    evidence:
      "packages/bench/src/harness.test.ts docblock, and describe('the harness obeys the plan it was pre-registered against')",
    reason:
      'the reproducibility claim is a property of the whole harness spec — the pinned node ladder and runs-per-config — rather than of one block, and the sibling ids BENCH-04/05/06 that do have titles are the specific sub-claims',
  },
  {
    id: 'DEMO-03',
    waives: 'named-in-a-test-title',
    evidence: 'packages/node/src/rendezvous-wire.node.test.ts docblock, paired with NET-03',
    reason:
      'the claim is that two nodes find each other with no server-side process helping, which is the whole file; the titles name the wire behaviour that demonstrates it',
  },
  {
    id: 'DEMO-04',
    waives: 'named-in-a-test-title',
    evidence: 'packages/node/src/disclosure-gate.node.test.ts docblock',
    reason:
      'the entire file is this requirement — absence of a deploy workflow, absence of a publishing script — and its titles name the thing that must not exist rather than the id',
  },
  {
    id: 'AOT-01',
    waives: 'named-in-a-test-title',
    evidence:
      'docblocks of packages/aot/src/elf.test.ts (refusal by name), elf.real.node.test.ts (real linker output), tools/aot/lift.node.test.ts (the toolchain, and its untrustworthy exit code)',
    reason:
      'three files divide the requirement between the screen, real binaries and the driver, and each titles its own subject; the id is the seam between them and belongs in no one title',
  },
]

// ---------------------------------------------------------------------------
// The findings — not exemptions
// ---------------------------------------------------------------------------

interface Finding {
  readonly id: string
  /** When the discrepancy was first recorded here. */
  readonly found: string
  /** Where the requirement's substance does appear to be checked, unlabelled. */
  readonly substance: string
  readonly finding: string
}

/**
 * Ledger rows marked `[x]` that **no test names at all**.
 *
 * These are **not** exemptions. Each one is a defect in the ledger's traceability,
 * recorded here so the suite can stay green while the discrepancy stays visible and
 * enforced — and so nobody has to choose between a red build and deleting the check.
 * The ledger was deliberately **not** edited to make this file pass, and no existing
 * test was relabelled to manufacture the missing link: both would be the exact
 * anti-pattern this file exists to catch, a claim made true by editing the thing that
 * was supposed to verify it.
 *
 * The check that consumes this list is an **exact set equality**, so it fails in both
 * directions. A fourth unnamed `[x]` fails. Any one of these three acquiring a test
 * that names it fails, demanding the entry be deleted. Neither adding to this list
 * nor forgetting to clean it up can pass silently.
 *
 * **What a human has to decide, per row: label the test, or clear the box.** In all
 * three cases the mechanism does appear to be tested — the gap is the link, not
 * necessarily the work — but "appears to be tested" is precisely the judgement a
 * regex may not make on the project's behalf.
 */
const FINDINGS: readonly Finding[] = [
  {
    id: 'DET-05',
    found: '2026-07-29',
    substance: 'packages/core/src/canonical/encode.test.ts',
    finding:
      'no tracked test file names DET-05. `encode.test.ts` asserts the strict DAG-CBOR rules the row claims — NaN, Infinity and -Infinity refused with the offending path named, one float width — but nothing ties those assertions to the id, and the row also claims "protobuf bytes are never hashed", which is a separate property no test in that file addresses',
  },
  // VER-02 sat here until 2026-07-30, on the strength of `verify.ts` implementing
  // commit-then-reveal. It did not: the requestor minted both halves and compared
  // them with each other, so the check was unconditionally true and both of its
  // failure branches were unreachable. The row is now `[ ]` and the ceremony is
  // deleted, which takes it out of this list's subject — these are `[x]` rows that
  // no test names, and an unchecked row claims nothing to trace.
  {
    id: 'BENCH-02',
    found: '2026-07-29',
    substance:
      "packages/bench/src/harness.test.ts — describe('the harness obeys the plan it was pre-registered against')",
    finding:
      'no tracked test file names BENCH-02. That describe pins `NODE_LADDER` and `RUNS_PER_CONFIG` to the values committed in `.planning/BENCHMARK-METHODOLOGY.md`, which is the checkable half. The other half — that the methodology was committed *before* the first published number — is an ordering of human acts recorded in git history, and nothing reads that history',
  },
]

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

interface Audit {
  /** Satisfied, named by no test, not waived — rendered for a legible failure. */
  readonly absent: readonly string[]
  /** Satisfied, named only by files that assert nothing. Never waivable. */
  readonly inert: readonly string[]
  /** Satisfied, named only outside titles, with no written exemption. */
  readonly untitled: readonly string[]
  /** Satisfied and title-traced — the strong form, counted so it stays load-bearing. */
  readonly titled: readonly string[]
  /** Exemptions the requirement no longer needs. */
  readonly dead: readonly string[]
  /** Exemptions naming an id the ledger does not contain. */
  readonly unknown: readonly string[]
  /** Title-waivers whose requirement has since lost its test entirely. */
  readonly overtaken: readonly string[]
}

function audit(
  requirements: readonly Requirement[],
  corpus: Corpus,
  exemptions: readonly Exemption[],
): Audit {
  const traces = new Map<string, TraceResult>()
  for (const requirement of requirements) traces.set(requirement.id, classify(requirement.id, corpus))

  const waived = (id: string, rule: Rule): boolean =>
    exemptions.some((entry) => entry.id === id && entry.waives === rule)

  const absent: string[] = []
  const inert: string[] = []
  const untitled: string[] = []
  const titled: string[] = []

  for (const { id, satisfied, line } of requirements) {
    if (!satisfied) continue
    const result = traces.get(id) as TraceResult
    switch (result.trace) {
      case 'titled':
        titled.push(id)
        break
      case 'absent':
        if (!waived(id, 'named-by-a-test')) {
          absent.push(`${id} — marked [x] at ${LEDGER}:${line}, and no tracked test file names it`)
        }
        break
      case 'inert':
        inert.push(
          `${id} — marked [x] at ${LEDGER}:${line}, named only by ${result.referencedIn.join(', ')}, ` +
            'which contain no expect() at all',
        )
        break
      case 'named':
        if (!waived(id, 'named-in-a-test-title')) {
          untitled.push(
            `${id} — marked [x] at ${LEDGER}:${line}, named only outside any test title in ` +
              `${result.assertingIn.join(', ')}; put the id in a describe/it title so a failure ` +
              'reports it, or add an EXEMPT entry saying why not',
          )
        }
        break
    }
  }

  const dead: string[] = []
  const unknown: string[] = []
  const overtaken: string[] = []

  for (const entry of exemptions) {
    const result = traces.get(entry.id)
    if (result === undefined) {
      unknown.push(`${entry.id} is exempt from "${entry.waives}" but is not a row in the ledger`)
      continue
    }
    if (entry.waives === 'named-in-a-test-title') {
      if (result.trace === 'titled') {
        dead.push(
          `${entry.id} is now named in a title by ${result.titledIn.join(', ')} — delete this ` +
            `exemption (was: ${entry.reason})`,
        )
      } else if (result.trace === 'absent') {
        overtaken.push(
          `${entry.id} is exempt from needing a title but has lost its test entirely — the ` +
            'exemption no longer describes reality',
        )
      }
      continue
    }
    if (result.trace !== 'absent') {
      dead.push(
        `${entry.id} is now named by ${result.referencedIn.join(', ')} — it is testable after ` +
          `all; delete this exemption (was: ${entry.reason})`,
      )
    }
  }

  return { absent, inert, untitled, titled, dead, unknown, overtaken }
}

// ---------------------------------------------------------------------------
// The live run
// ---------------------------------------------------------------------------

const LEDGER_SOURCE = readFileSync(join(ROOT, LEDGER), 'utf8')
const REQUIREMENTS = parseLedger(LEDGER_SOURCE)
const TRACEABILITY = parseTraceability(LEDGER_SOURCE)
const CORPUS_SCAN = readCorpus()
const CORPUS = CORPUS_SCAN.corpus
const LIVE = audit(REQUIREMENTS, CORPUS, EXEMPT)

function locate(id: string): Requirement | undefined {
  return REQUIREMENTS.find((requirement) => requirement.id === id)
}

/** The findings, rendered exactly as `audit` renders an unnamed requirement. */
const EXPECTED_ABSENT: readonly string[] = FINDINGS.map(({ id }) => {
  const line = locate(id)?.line
  return `${id} — marked [x] at ${LEDGER}:${line ?? 'MISSING'}, and no tracked test file names it`
})

describe('the ledger this suite parses is the real ledger', () => {
  it('reads it from the path the project keeps it at', () => {
    expect(existsSync(join(ROOT, LEDGER))).toBe(true)
    expect(LEDGER_SOURCE).toContain('# Requirements — o2.services P2P Native Cloud')
  })

  /**
   * The anti-vacuity check this whole file rests on. Every finding below is a list
   * that must be empty; a `REQUIREMENT_ROW` that stopped matching would empty all of
   * them at once and report a perfectly satisfied ledger. Proved mutable below.
   */
  it('found far more requirements than a broken pattern could', () => {
    expect(REQUIREMENTS.length).toBeGreaterThan(REQUIREMENT_FLOOR)
  })

  it('kept the distinction between a satisfied row and an open one', () => {
    const satisfied = REQUIREMENTS.filter((requirement) => requirement.satisfied)
    const open = REQUIREMENTS.filter((requirement) => !requirement.satisfied)
    // Both directions matter. A parse that read every row as `[ ]` would have nothing
    // to check and pass; one that read every row as `[x]` would demand tests for work
    // that has not started. Neither can be told apart from a healthy parse by an
    // empty violation list.
    expect(satisfied.length).toBeGreaterThan(0)
    expect(open.length).toBeGreaterThan(0)
    expect(satisfied.length + open.length).toBe(REQUIREMENTS.length)
  })

  it('found the ids that are certainly in the ledger, in the state the ledger gives them', () => {
    // Spot-checked against the file rather than trusted, and deliberately two ids per
    // state across two sections: a parse that only reads the v1 section fails on the
    // v1.1 pair, and a parse stuck on one answer fails on whichever pair disagrees.
    //
    // `SCHED-06` used to carry both the open role and the late-minted role at once,
    // which is why closing it broke this check rather than merely dating it. An id's
    // state is not a fixture — it changes when a verifier says so — and this check has
    // now been re-aimed twice for that reason, which is the mechanism working rather
    // than the check being brittle.
    //
    // `DATA-10` held the late-minted-and-open role until 2026-08-02, when the at-rest
    // half closed and 13.1's criterion 7 went from PARTIAL to MET. It passed to
    // `BENCH-07`, and on 2026-08-06 to `WIRE-02` — the third re-aiming, and the first
    // where the *reason recorded here was false* rather than merely outdated.
    //
    // What stood here said `BENCH-07` was open "for a reason no phase can retire on its
    // own: it needs a second machine." BENCH-07 needs nothing of the sort. Its own
    // scoping sentence is **"Needs only separate processes on one host"**, and the
    // second-machine condition belongs to BENCH-06, whose distinct-machine half remains
    // descoped and unmeasured. This comment was the last surviving copy of a misreading
    // the roadmap had already diagnosed and moved on from, and because it sat in a guard
    // it read as a rule. `23-VERIFICATION.md` ruled it: a comment is not a specification,
    // and when the two disagree the requirement wins.
    //
    // `WIRE-02` now holds the role — of the ten ids minted with v1.1, eight are `[x]`;
    // only `WIRE-02` and (until today) `BENCH-07` were open. It stays open until Phase 22
    // lands, and Phase 22 runs last.
    expect(locate('DATA-05')?.satisfied).toBe(true) // v1 section, closed
    expect(locate('MR-02')?.satisfied).toBe(false) // v1 section, open
    expect(locate('SCHED-06')?.satisfied).toBe(true) // v1.1 section, closed
    expect(locate('WIRE-02')?.satisfied).toBe(false) // v1.1 section, open
    expect(locate('BENCH-07')?.satisfied).toBe(true) // v1.1 section, closed 2026-08-06
    expect(locate('DATA-10')?.satisfied).toBe(true) // v1.1 section, closed 2026-08-02
    expect(locate('WIRE-01')?.satisfied).toBe(true)
  })

  it('gives every id exactly one row', () => {
    const seen = new Map<string, number>()
    for (const { id } of REQUIREMENTS) seen.set(id, (seen.get(id) ?? 0) + 1)
    expect([...seen].filter(([, count]) => count > 1)).toEqual([])
  })
})

describe('the test corpus was really read', () => {
  it('holds every test file git tracks', () => {
    expect(CORPUS.size).toBeGreaterThan(TEST_FILE_FLOOR)
    expect([...CORPUS.keys()]).toContain('packages/core/src/job/submit.test.ts')
    expect([...CORPUS.keys()]).toContain('packages/node/src/disclosure-gate.node.test.ts')
    expect([...CORPUS.keys()]).toContain('tools/aot/lift.node.test.ts')
    for (const [path, source] of CORPUS) {
      expect(source.length, `${path} read as empty`).toBeGreaterThan(0)
    }
  })

  it('dropped no tracked test file it could not read', () => {
    // `TEST_FILE_FLOOR` above catches the corpus collapsing. It cannot catch it
    // losing one file, and one file is the whole of what a traceability claim about
    // that file's requirements rests on. So a read failure is named here instead of
    // becoming a slightly smaller population that still clears the floor.
    //
    // Normally empty, and therefore unable to audit itself. Proved able to fail on
    // 2026-08-01 by `git add`-ing a `.test.ts` file and deleting it from disk before
    // the run: `git ls-files` still lists it, `readFileSync` throws `ENOENT`, and
    // this case named the file and the errno. Before the change the plant was green.
    expect(CORPUS_SCAN.unreadable).toEqual([])
  })

  it('extracted titles from them, so the strong form of the rule is live', () => {
    const titles = [...CORPUS.values()].flatMap(titlesOf)
    expect(titles.length).toBeGreaterThan(TITLE_FLOOR)
  })

  /**
   * The loophole that would have swallowed every finding.
   *
   * This file names `DET-05`, `VER-02` and `BENCH-02` in its own data, and it is a
   * `*.test.ts` file that git tracks. Left in the corpus it would answer its own
   * question: each of those ids would be "named by a test", the findings list would
   * have to be emptied, and the check would certify the ledger by quoting itself. So
   * the exclusion is load-bearing, and both halves of it are asserted — that the file
   * is out of the corpus, and that it would have mattered.
   */
  it('does not count itself as evidence', () => {
    expect([...CORPUS.keys()]).not.toContain(SELF)
    const own = readFileSync(join(ROOT, SELF), 'utf8')
    for (const { id } of FINDINGS) expect(mentions(id, own)).toBe(true)
    // …and with itself in the corpus, every recorded finding evaporates.
    const selfIncluded = new Map(CORPUS).set(SELF, own)
    const survivors = audit(REQUIREMENTS, selfIncluded, EXEMPT).absent.filter((row) =>
      FINDINGS.some(({ id }) => row.startsWith(`${id} `)),
    )
    expect(survivors).toEqual([])
  })
})

describe('every requirement marked [x] resolves to a test that names it', () => {
  /**
   * The headline rule, and the finding it currently carries. Exact equality, so a
   * fourth unnamed `[x]` fails and a fixed one fails too — see FINDINGS.
   */
  it('has no [x] requirement that no test names, beyond the three recorded findings', () => {
    expect(LIVE.absent).toEqual(EXPECTED_ABSENT)
  })

  it('has no [x] requirement whose only mention sits in a file that asserts nothing', () => {
    // Empty today. An empty result from an absent instrument is this repository's own
    // recorded failure mode, so the classifier is proved able to return `inert` by
    // mutation below rather than trusted because this list is short.
    expect(LIVE.inert).toEqual([])
  })

  it('names each [x] requirement in a running test title, or records why it cannot', () => {
    expect(LIVE.untitled).toEqual([])
  })

  it('still traces most [x] requirements the strong way, so the weak form cannot take over', () => {
    // Without this, every satisfied row could migrate to a docblock plus an EXEMPT
    // entry and the file would still be green while asserting almost nothing.
    expect(LIVE.titled.length).toBeGreaterThan(TITLED_REQUIREMENT_FLOOR)
    expect(LIVE.titled.length).toBeGreaterThan(EXEMPT.length)
  })
})

describe('the ledger agrees with itself about what is delivered', () => {
  const statusOf = new Map(TRACEABILITY.map((row) => [row.id, row]))

  it('uses only status words this join recognises', () => {
    const unrecognised = TRACEABILITY.filter(
      (row) => !RECOGNISED_STATUSES.includes(row.status),
    ).map((row) => `${row.id} at ${LEDGER}:${row.line} reads ${JSON.stringify(row.status)}`)
    expect(unrecognised).toEqual([])
  })

  it('marks no requirement [x] whose traceability status is not Done', () => {
    const offenders = REQUIREMENTS.filter((requirement) => requirement.satisfied)
      .map((requirement) => ({ requirement, row: statusOf.get(requirement.id) }))
      .filter(({ row }) => row !== undefined && !delivered(row.status))
      .map(
        ({ requirement, row }) =>
          `${requirement.id} — [x] at ${LEDGER}:${requirement.line} against ` +
          `**${(row as TraceabilityRow).status}** at ${LEDGER}:${(row as TraceabilityRow).line}`,
      )
    expect(offenders).toEqual([])
  })

  it('marks no requirement [ ] whose traceability status is Done', () => {
    const offenders = REQUIREMENTS.filter((requirement) => !requirement.satisfied)
      .map((requirement) => ({ requirement, row: statusOf.get(requirement.id) }))
      .filter(({ row }) => row !== undefined && delivered(row.status))
      .map(
        ({ requirement, row }) =>
          `${requirement.id} — [ ] at ${LEDGER}:${requirement.line} against ` +
          `**${(row as TraceabilityRow).status}** at ${LEDGER}:${(row as TraceabilityRow).line}`,
      )
    expect(offenders).toEqual([])
  })

  it('read enough traceability rows, in enough states, for the join to mean anything', () => {
    // Every assertion above is "this list is empty", which a parse that stopped
    // matching satisfies perfectly. These are what prove it ran.
    expect(TRACEABILITY.length).toBeGreaterThan(TRACEABILITY_FLOOR)
    expect(new Set(TRACEABILITY.map((row) => row.status)).size).toBeGreaterThan(1)
    expect(TRACEABILITY.some((row) => delivered(row.status))).toBe(true)
    expect(TRACEABILITY.some((row) => !delivered(row.status))).toBe(true)
  })

  it('leaves exactly the recorded checkboxes without a traceability row', () => {
    const orphans = REQUIREMENTS.filter(({ id }) => !statusOf.has(id)).map(({ id }) => id)
    expect(orphans).toEqual([...CHECKBOXES_WITHOUT_A_ROW])
  })

  /**
   * **Coverage, with no escape hatch — added 2026-08-10.**
   *
   * The two rules above both filter on `row !== undefined`, so a checkbox with no
   * traceability row is not judged leniently: **it is not judged at all.** That is exactly
   * how `SCHED-06`, `NET-08`, `NET-09`, `NET-10`, `DATA-10` and `BENCH-07` sat `[x]` and
   * unguarded from the day they were minted until `3a66549` wrote their rows — six ticks
   * that no assertion in this file ever read, while every assertion here was green.
   *
   * The case immediately above already catches that, and it caught it honestly. **What it
   * cannot catch is itself being relaxed.** `CHECKBOXES_WITHOUT_A_ROW` is a mutable list
   * with no required reason, no evidence field and no date — unlike `EXEMPT`, which this
   * file makes argue for itself in three ways. Anyone meeting that red can go green by
   * appending an id to it, and the effect of doing so is not "this row is exempt from
   * having a row" but *"this row is exempt from the headline rule of this file"*, silently,
   * with the whole suite still passing. The six were never *waived* — nobody decided
   * anything — and a hatch that reopens the hole by one line is how they would come back.
   *
   * So this asserts the population instead of the exception: the number of `[x]` rows the
   * `[x]`-iff-`Done` join actually **evaluated** must equal the number of `[x]` rows the
   * ledger holds. It shares no data with the case above, so relaxing that one does not
   * relax this one, and there is nothing here to append an id to.
   */
  it('applies the [x]-iff-Done rule to every [x] row, with none exempt by having no row', () => {
    const satisfied = REQUIREMENTS.filter((requirement) => requirement.satisfied)
    expect(unjoinableCheckboxes(REQUIREMENTS, TRACEABILITY)).toEqual([])
    // The positive form, and it is the half that cannot be satisfied by a parse that died:
    // an empty `skipped` is also what a ledger with zero `[x]` rows produces.
    const evaluated = satisfied.filter((requirement) => statusOf.has(requirement.id))
    expect(evaluated.length).toBe(satisfied.length)
    expect(evaluated.length).toBeGreaterThan(TRACEABILITY_FLOOR)
  })

  /**
   * The same join, read from the other end — **unguarded until 2026-08-10**.
   *
   * A traceability row saying `Done` is a delivery claim in its own right, and until now
   * nothing required one to have a checkbox. A row for an id with no checkbox is inert in
   * both rules above (they iterate checkboxes), so it would claim delivery that no tick
   * asserts and no tick could ever retract — the mirror of the defect that motivated the
   * case above, and reachable by the same one-line edit in the other file.
   *
   * Empty today, measured rather than assumed: 102 checkbox rows, 102 traceability rows,
   * 102 distinct ids, and the two sets are equal.
   */
  it('carries no traceability row for an id the checklist does not have', () => {
    expect(unanchoredRows(TRACEABILITY, REQUIREMENTS)).toEqual([])
    expect(TRACEABILITY.length).toBeGreaterThan(TRACEABILITY_FLOOR)
  })

  it('states a headline count that matches the v1 section it counts', () => {
    const start = LEDGER_SOURCE.indexOf('\n## v1 Requirements')
    const end = LEDGER_SOURCE.indexOf('\n## v1.1 Requirements')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const section = LEDGER_SOURCE.slice(start, end)
    const rows = parseLedger(section)
    const stated = LEDGER_SOURCE.match(/\*\*(\d+) of (\d+) are `\[x\]`\.\*\*/)
    expect(stated, 'the headline count is no longer written in the shape this reads').not.toBeNull()
    const claim = stated as RegExpMatchArray
    expect(Number(claim[2])).toBe(rows.length)
    expect(Number(claim[1])).toBe(rows.filter(({ satisfied }) => satisfied).length)
  })
})

describe('the recorded findings are findings, not exemptions', () => {
  it('each names a row the ledger actually marks [x]', () => {
    for (const { id } of FINDINGS) {
      expect(locate(id), `${id} is recorded as a finding but is not in the ledger`).toBeDefined()
      expect(locate(id)?.satisfied, `${id} is no longer marked [x]`).toBe(true)
    }
  })

  it('each points at where the substance appears to be checked, so it can be audited', () => {
    for (const { id, substance, finding, found } of FINDINGS) {
      expect(finding.length, `${id} carries no written finding`).toBeGreaterThan(80)
      expect(found).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // The named file must exist, or the finding cites nothing.
      const path = substance.split(/[\s,]/)[0] ?? ''
      expect(existsSync(join(ROOT, path)), `${id} cites a missing path: ${path}`).toBe(true)
    }
  })

  it('records no finding for a requirement that some test does name', () => {
    // The dead-finding direction, checked directly as well as through the set
    // equality above: a finding that has been fixed must be deleted, not left to
    // describe a state that no longer holds.
    const fixed = FINDINGS.filter(({ id }) => classify(id, CORPUS).trace !== 'absent').map(
      ({ id }) => `${id} is now named by a test — delete its FINDINGS entry`,
    )
    expect(fixed).toEqual([])
  })
})

describe('the exemptions stay honest', () => {
  it('carries none the requirement no longer needs', () => {
    expect(LIVE.dead).toEqual([])
  })

  it('carries none for an id the ledger does not have', () => {
    expect(LIVE.unknown).toEqual([])
  })

  it('carries no title-waiver for a requirement that has lost its test altogether', () => {
    expect(LIVE.overtaken).toEqual([])
  })

  it('gives every exemption a stated reason and named evidence, so none can be added silently', () => {
    for (const entry of EXEMPT) {
      expect(entry.reason.length, `${entry.id} carries no reason`).toBeGreaterThan(60)
      expect(entry.evidence.length, `${entry.id} names no evidence`).toBeGreaterThan(20)
    }
  })

  it('exempts one id from one rule at most once', () => {
    const keys = EXEMPT.map((entry) => `${entry.id} :: ${entry.waives}`)
    expect(keys.length).toBe(new Set(keys).size)
  })
})

describe('the checker can fail — proved by mutation, not assumed', () => {
  /**
   * Nothing above is worth anything until something shows it can fail. The ledger
   * parse, the trace classifier, the exemption layer and the dead-entry check are
   * each driven with synthetic input whose right answer is known, in the shapes that
   * would otherwise pass silently.
   */
  const SYNTHETIC_LEDGER = [
    '# Requirements',
    '',
    '- [x] **FAKE-01**: satisfied, and a test titles it',
    '- [x] **FAKE-02**: satisfied, named only in a docblock',
    '- [x] **FAKE-03**: satisfied, and no test names it at all',
    '- [x] **FAKE-04**: satisfied, named only by a file that asserts nothing',
    '- [ ] **FAKE-05**: open, and no test names it',
    '',
    '| FAKE-06 | a row in the traceability table, not a requirement |',
  ].join('\n')

  const SYNTHETIC_CORPUS: Corpus = new Map([
    [
      'pkg/titled.test.ts',
      "describe('FAKE-01 — the id reaches the report', () => {\n" +
        "  it('asserts something', () => { expect(1).toBe(1) })\n})",
    ],
    [
      'pkg/named.test.ts',
      '/** FAKE-02 — named where no failure message will ever show it. */\n' +
        "describe('prose only', () => { it('asserts something', () => { expect(2).toBe(2) }) })",
    ],
    ['pkg/notes.test.ts', '// FAKE-04 is mentioned here, and this file asserts nothing.\n'],
  ])

  const SYNTHETIC = parseLedger(SYNTHETIC_LEDGER)

  it('parses a ledger it has never seen, keeping both markers apart', () => {
    expect(SYNTHETIC.map(({ id }) => id)).toEqual([
      'FAKE-01',
      'FAKE-02',
      'FAKE-03',
      'FAKE-04',
      'FAKE-05',
    ])
    expect(SYNTHETIC.filter(({ satisfied }) => satisfied).map(({ id }) => id)).toEqual([
      'FAKE-01',
      'FAKE-02',
      'FAKE-03',
      'FAKE-04',
    ])
    // The table row is prose about a requirement, not a requirement.
    expect(SYNTHETIC.some(({ id }) => id === 'FAKE-06')).toBe(false)
  })

  it('reports nothing when the ledger format changes — which is what the floor catches', () => {
    // The exact mutation the floor exists for: a pattern that stops matching. Every
    // "this list is empty" assertion in this file would pass on this input.
    const mutated = LEDGER_SOURCE.replaceAll('- [x] **', '* [x] ').replaceAll('- [ ] **', '* [ ] ')
    expect(parseLedger(mutated)).toEqual([])
    expect(parseLedger(mutated).length).toBeLessThan(REQUIREMENT_FLOOR)
    expect(audit(parseLedger(mutated), CORPUS, EXEMPT).absent).toEqual([])
  })

  it('collapses to nothing to check when every row reads as satisfied or as open', () => {
    // Both halves of the distinction check, shown to be load-bearing.
    const allOpen = LEDGER_SOURCE.replaceAll('- [x] **', '- [ ] **')
    expect(parseLedger(allOpen).filter(({ satisfied }) => satisfied)).toEqual([])
    const allDone = LEDGER_SOURCE.replaceAll('- [ ] **', '- [x] **')
    expect(parseLedger(allDone).filter(({ satisfied }) => !satisfied)).toEqual([])
  })

  it('classifies each degree of traceability, including the two that are empty in the repository', () => {
    expect(classify('FAKE-01', SYNTHETIC_CORPUS).trace).toBe('titled')
    expect(classify('FAKE-02', SYNTHETIC_CORPUS).trace).toBe('named')
    expect(classify('FAKE-03', SYNTHETIC_CORPUS).trace).toBe('absent')
    // `inert` and `absent` are both empty in the live run above. Without this, an
    // empty list could mean the classifier never returns them.
    expect(classify('FAKE-04', SYNTHETIC_CORPUS).trace).toBe('inert')
  })

  it('does not accept a longer id as a mention of a shorter one', () => {
    // A substring test would find SCHED-06 inside SCHED-060 and invent traceability.
    const corpus: Corpus = new Map([
      ['pkg/x.test.ts', "describe('SCHED-060 — a different requirement', () => { expect(1) })"],
    ])
    expect(classify('SCHED-06', corpus).trace).toBe('absent')
    expect(classify('SCHED-060', corpus).trace).toBe('titled')
  })

  it('flags a satisfied requirement no test names, and names the id', () => {
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, [])
    expect(result.absent).toHaveLength(1)
    expect(result.absent[0]).toContain('FAKE-03')
    expect(result.absent[0]).toContain('no tracked test file names it')
  })

  it('flags a satisfied requirement named only in a comment, and names the id', () => {
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, [])
    expect(result.untitled).toHaveLength(1)
    expect(result.untitled[0]).toContain('FAKE-02')
    expect(result.untitled[0]).toContain('pkg/named.test.ts')
  })

  it('flags a satisfied requirement whose only mention asserts nothing', () => {
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, [])
    expect(result.inert).toHaveLength(1)
    expect(result.inert[0]).toContain('FAKE-04')
    expect(result.inert[0]).toContain('no expect() at all')
  })

  it('demands nothing of a requirement still marked open', () => {
    // FAKE-05 has no test and must not be reported: an unchecked box is a claim that
    // the work is not done, and holding it to a test would make the ledger lie in the
    // other direction.
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, [])
    expect([...result.absent, ...result.inert, ...result.untitled].join(' ')).not.toContain(
      'FAKE-05',
    )
  })

  it('lets an exemption waive exactly the rule it declares, and no more', () => {
    const titleOnly: readonly Exemption[] = [
      {
        id: 'FAKE-02',
        waives: 'named-in-a-test-title',
        evidence: 'pkg/named.test.ts docblock',
        reason: 'synthetic entry, long enough to satisfy the stated-reason check on exemptions',
      },
    ]
    const waivedTitle = audit(SYNTHETIC, SYNTHETIC_CORPUS, titleOnly)
    expect(waivedTitle.untitled).toEqual([])
    // …and it does not silence the requirement that no test names at all.
    expect(waivedTitle.absent).toHaveLength(1)
    expect(waivedTitle.absent[0]).toContain('FAKE-03')

    const anyTest: readonly Exemption[] = [
      {
        id: 'FAKE-03',
        waives: 'named-by-a-test',
        evidence: 'nothing — this is the hosting/human-act shape of waiver',
        reason: 'synthetic entry, long enough to satisfy the stated-reason check on exemptions',
      },
    ]
    const waivedAny = audit(SYNTHETIC, SYNTHETIC_CORPUS, anyTest)
    expect(waivedAny.absent).toEqual([])
    // …and it does not silence the comment-only requirement.
    expect(waivedAny.untitled).toHaveLength(1)
    expect(waivedAny.untitled[0]).toContain('FAKE-02')
  })

  it('reports an exemption as dead once the requirement satisfies the rule on its own', () => {
    const stale: readonly Exemption[] = [
      {
        id: 'FAKE-01',
        waives: 'named-in-a-test-title',
        evidence: 'pkg/titled.test.ts',
        reason: 'synthetic entry, long enough to satisfy the stated-reason check on exemptions',
      },
      {
        id: 'FAKE-02',
        waives: 'named-by-a-test',
        evidence: 'pkg/named.test.ts',
        reason: 'synthetic entry, long enough to satisfy the stated-reason check on exemptions',
      },
    ]
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, stale)
    expect(result.dead).toHaveLength(2)
    expect(result.dead.join(' ')).toContain('FAKE-01 is now named in a title')
    expect(result.dead.join(' ')).toContain('FAKE-02 is now named by')
  })

  it('reports an exemption for an id the ledger does not have', () => {
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, [
      {
        id: 'FAKE-99',
        waives: 'named-in-a-test-title',
        evidence: 'nowhere',
        reason: 'synthetic entry, long enough to satisfy the stated-reason check on exemptions',
      },
    ])
    expect(result.unknown).toHaveLength(1)
    expect(result.unknown[0]).toContain('FAKE-99')
  })

  it('reports a title-waiver whose requirement has lost its test altogether', () => {
    const result = audit(SYNTHETIC, SYNTHETIC_CORPUS, [
      {
        id: 'FAKE-03',
        waives: 'named-in-a-test-title',
        evidence: 'a file that no longer names it',
        reason: 'synthetic entry, long enough to satisfy the stated-reason check on exemptions',
      },
    ])
    expect(result.overtaken).toHaveLength(1)
    expect(result.overtaken[0]).toContain('FAKE-03')
    // The waiver was for the weaker rule, so the stronger one still fires.
    expect(result.absent).toHaveLength(1)
    expect(result.absent[0]).toContain('FAKE-03')
  })

  /**
   * The two coverage checks, driven with a ledger whose right answer is known.
   *
   * Both read as an empty list on the real ledger, which is indistinguishable from a check
   * that never ran — the failure mode this whole block exists for. The synthetic ledger below
   * is deliberately shaped like the defect that motivated them: one `[x]` row with a matching
   * traceability row, one `[x]` row with none (the six unguarded ticks), one `[ ]` row with
   * none (which must NOT be reported — an unchecked box claims nothing), and one traceability
   * row for an id the checklist does not have (the mirror defect).
   */
  const COVERAGE_LEDGER = [
    '# Requirements',
    '',
    '- [x] **COV-01**: satisfied, and the table has a row for it',
    '- [x] **COV-02**: satisfied, and the table has no row for it',
    '- [ ] **COV-03**: open, and the table has no row for it',
    '',
    '| Requirement | Phase | Status |',
    '|---|---|---|',
    '| COV-01 | Phase 1 | Done |',
    '| COV-99 | Phase 1 | Done — a row anchored to no checkbox at all |',
  ].join('\n')

  const COVERAGE_REQUIREMENTS = parseLedger(COVERAGE_LEDGER)
  const COVERAGE_ROWS = parseTraceability(COVERAGE_LEDGER)

  it('parses the coverage fixture into both representations, so the diff below is real', () => {
    expect(COVERAGE_REQUIREMENTS.map(({ id }) => id)).toEqual(['COV-01', 'COV-02', 'COV-03'])
    // The header separator `|---|---|---|` must not read as a requirement row, or every
    // table in the ledger would contribute a phantom id.
    expect(COVERAGE_ROWS.map((row) => row.id)).toEqual(['COV-01', 'COV-99'])
  })

  it('flags an [x] row the join cannot see, and refuses to flag an open one', () => {
    const skipped = unjoinableCheckboxes(COVERAGE_REQUIREMENTS, COVERAGE_ROWS)
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toContain('COV-02')
    expect(skipped[0]).toContain('the [x]-iff-Done rule never sees it')
    // COV-03 is open and equally rowless. Reporting it would demand a delivery record for
    // work that has not started — the ledger lying in the other direction.
    expect(skipped.join(' ')).not.toContain('COV-03')
  })

  it('flags a traceability row with no checkbox to retract it', () => {
    const unanchored = unanchoredRows(COVERAGE_ROWS, COVERAGE_REQUIREMENTS)
    expect(unanchored).toHaveLength(1)
    expect(unanchored[0]).toContain('COV-99')
    expect(unanchored[0]).toContain('a delivery claim nothing can retract')
  })

  it('reports nothing at all when both parses die — which is what the floors catch', () => {
    // The direction that matters: a broken parse empties both lists at once and every
    // assertion in the two coverage cases passes. The `toBeGreaterThan(TRACEABILITY_FLOOR)`
    // half of each is the only thing standing between that and a silent green.
    expect(unjoinableCheckboxes([], [])).toEqual([])
    expect(unanchoredRows([], [])).toEqual([])
  })

  it('finds titles in the curried forms this repository uses', () => {
    // `it.each([…])('title')` and `it.skipIf(cond)('title')` put the title in a
    // second call. A parser that only reads the first argument would classify these
    // as comment-only and demand an exemption for a requirement that is titled.
    const corpus: Corpus = new Map([
      [
        'pkg/each.test.ts',
        "it.each([1, 2])('FAKE-07 — parameterised %p', (n) => { expect(n).toBeGreaterThan(0) })",
      ],
      [
        'pkg/skip.test.ts',
        "describe.skipIf(false)('FAKE-08 — conditional', () => { it('a', () => { expect(1) }) })",
      ],
    ])
    expect(classify('FAKE-07', corpus).trace).toBe('titled')
    expect(classify('FAKE-08', corpus).trace).toBe('titled')
  })
})
