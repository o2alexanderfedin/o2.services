import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attestationRank } from '@o2/core'
import type { AttestationStrength } from '@o2/core'
import { blocking, commitScope, pathFormProblems, trackedPaths } from './commit-scope.ts'
import type { Finding } from './commit-scope.ts'
import { stripComments } from './strip-comments.ts'

/**
 * VER-12, criterion 3's second half: no caller reads an attestation strength by comparing
 * it against a bare string, and a guard says so rather than a reader.
 *
 * ## This KEEPS a property. It does not establish one.
 *
 * Measured 2026-09-16 over the non-test corpus built below: every comparison in the tree
 * already routes through `attestationRank` — `packages/net/src/reduce-job.ts:530` and
 * `packages/core/src/job/submit.ts:2321` — and the only matches are the two exhaustive
 * switches in `packages/core/src/quorum.ts` that DEFINE the ordering and the wording.
 * So the work here is not a sweep. It is an instrument, and an instrument for an absence
 * is worth exactly what its positive control is worth, which is why three of those run
 * below before any absence is asserted.
 *
 * The reason the property matters is the reason the union has four members instead of
 * three as of this phase. A site that reads the label by matching a bare string keeps
 * working, silently, when a value is inserted above or below it — it simply stops
 * answering the question it was written to answer. `attestationRank` has no such failure
 * mode: inserting a value renumbers every comparison at once.
 *
 * ## Why this file is not in its own corpus, and why that is structural
 *
 * A guard whose own prose trips the guard is this repository's most repeated
 * self-inflicted wound: `vocabulary.node.test.ts` reddened twice on comments written
 * during Phase 44, and `packages/cloudflare/wrangler.jsonc`'s header records the same
 * collision twice more. The cheapest structural answer is taken here rather than an
 * exemption: the corpus is **non-test** source, and this file's name ends `.node.test.ts`,
 * so it is outside by construction and no entry in {@link EXEMPT_FUNCTIONS} covers it.
 * That is asserted as a case — see *"is not in its own corpus"* — rather than trusted to
 * a comment, because a comment is not a specification.
 *
 * Test files are outside for a second reason that is not about this file at all: they hold
 * 34 / 26 / 31 occurrences of the three pre-existing strength names, every one an
 * assertion, and every one correct. A guard that reddened those would be deleted the first
 * week.
 *
 * ## The second subject: the release copy
 *
 * The ROADMAP gate paragraph committed at `4ff8a36` says the public copy for the release
 * must not promise an independence the fabric will not report, and that this phase must
 * **check** it rather than assume it. The second `describe` is that check, with both
 * controls, because "the copy is clean" and "the pattern matches nothing" are
 * indistinguishable without them.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** Read a repo-relative path as text. */
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/**
 * The commit these findings are judged against, or `NO_COMMIT_SCOPE` outside a commit.
 *
 * Read once at module scope so every case below reads the same answer. Absence is strict:
 * under `npm test` or a verifier there is no scope and every finding blocks.
 */
const SCOPE = commitScope()

/** This file's own path — the second participant in every finding, and the place a dead exemption is deleted. */
const SELF = 'packages/node/src/attestation-claims.node.test.ts'

/**
 * The strength names, written down **once** in this file.
 *
 * Composed into every pattern below rather than repeated beside each one, so a fifth
 * strength is a single edit here and cannot half-land. The order is weakest to strongest
 * and is read back out of `attestationRank` in a case rather than asserted from memory.
 */
const STRENGTHS = ['owner-attested', 'owner-domain', 'single-issuer', 'independent'] as const

/**
 * `tsc` names a fifth strength here.
 *
 * The parameter is the union and the return is the list's member type, so this function
 * only typechecks while {@link STRENGTHS} covers `AttestationStrength` completely. Add a
 * value to the union without adding it here and the compiler reports this line — which is
 * the one failure mode a runtime guard over a hand-written list cannot see for itself.
 *
 * It is called from the ordering case below rather than left as an unused declaration, so
 * nobody deletes it as decoration.
 */
const coversTheUnion = (strength: AttestationStrength): (typeof STRENGTHS)[number] => strength

/** `.` and `-` are the only characters in the names above that a regex reads specially. */
const escapeForPattern = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')

/** `'x'`, `"x"` or a backtick-quoted `x` — the three ways this tree writes a string. */
const quoted = (alternation: string): string =>
  `(?:'(?:${alternation})'|"(?:${alternation})"|\`(?:${alternation})\`)`

/** What kind of coupling a finding is. Reported, so a red says which rule fired. */
type Coupling = 'comparison' | 'case-label' | 'switch-on-strength'

/**
 * A fresh set of patterns per scan.
 *
 * Built rather than held at module scope because every one of them is `/g`, and a shared
 * `/g` regex carries `lastIndex` from whoever used it last — which hands the next caller a
 * different regex than the one written down.
 */
function patterns(): readonly { readonly kind: Coupling; readonly pattern: RegExp }[] {
  const alternation = STRENGTHS.map(escapeForPattern).join('|')
  const value = quoted(alternation)
  return [
    // Either operand order. `=` alone is excluded deliberately: an assignment or an
    // annotation names a strength without asking a question about one, and the negative
    // control below holds that distinction.
    {
      kind: 'comparison',
      pattern: new RegExp(`(?:===|!==|==|!=)\\s*${value}|${value}\\s*(?:===|!==|==|!=)`, 'g'),
    },
    { kind: 'case-label', pattern: new RegExp(`case\\s+${value}`, 'g') },
    // The shape that would reintroduce the same coupling carrying none of the operators
    // above. Lazy, and the character class excludes `)`, so the reach is bounded by the
    // discriminant's own closing parenthesis — `switch (strength)` on a value already
    // narrowed to the union is not this, and does not match.
    { kind: 'switch-on-strength', pattern: /switch\s*\(\s*[^)]*?\.strength\s*\)/g },
  ]
}

interface FunctionExemption {
  /** Repo-relative path of the file. */
  readonly file: string
  /**
   * The enclosing functions whose findings are suppressed, by NAME.
   *
   * Never by line number. The count inside `quorum.ts` moved from 6 to 8 during this very
   * phase when a fourth strength was inserted into both switches, and a line-shaped entry
   * would have died on that edit — or worse, survived it pointing at the wrong lines.
   */
  readonly functions: readonly string[]
  readonly reason: string
}

/**
 * The one exemption, and its shape is the point.
 *
 * `attestationRank` and `describeAttestation` are the **definition** of the ordering and
 * of the words. A definition has to name its cases; that is what makes it a definition and
 * not a caller. Every other site in the tree asks `attestationRank` instead.
 *
 * Scoped to the two function bodies rather than to the path, and the narrowing is
 * load-bearing: a new string comparison added anywhere else in `quorum.ts` is still a
 * finding, which a whole-file entry would have hidden. A case below plants exactly that
 * and requires it to be found.
 */
const EXEMPT_FUNCTIONS: readonly FunctionExemption[] = [
  {
    file: 'packages/core/src/quorum.ts',
    functions: ['attestationRank', 'describeAttestation'],
    reason:
      'the two exhaustive switches that DEFINE the ordering and the sentences — a definition must name its own cases, and every reader in the tree asks attestationRank rather than repeating them',
  },
]

/** Stable identity of one exempted function, for the dead-exemption check. */
const keyOf = (file: string, name: string): string => `${file} :: ${name}`

interface Span {
  readonly from: number
  readonly to: number
}

/**
 * The inclusive line range of `export function <name>` through its closing brace.
 *
 * Located structurally, never by a recorded line number. The closing brace is the first
 * `}` in column zero after the opener, which is what this tree's formatter emits for a
 * top-level function and what makes the span survive any edit inside the body.
 *
 * `undefined` means the file no longer declares that function — reported by the
 * dead-exemption check rather than treated as "nothing to suppress".
 */
function spanOf(source: string, name: string): Span | undefined {
  const lines = source.split('\n')
  const opener = new RegExp(`^\\s*export function ${escapeForPattern(name)}\\s*\\(`)
  for (let i = 0; i < lines.length; i += 1) {
    if (!opener.test(lines[i] ?? '')) continue
    for (let j = i + 1; j < lines.length; j += 1) {
      if ((lines[j] ?? '') === '}') return { from: i + 1, to: j + 1 }
    }
    return { from: i + 1, to: lines.length }
  }
  return undefined
}

interface SourceFinding extends Finding {
  readonly file: string
  readonly at: number
  readonly kind: Coupling
}

interface ScanOptions {
  /** Keys of exemptions that fired, so a dead one can be found and deleted. */
  readonly used?: Set<string>
  /** Off for the case that proves the exemption is suppressing something real. */
  readonly applyExemptions?: boolean
}

/**
 * Every coupling in one file that no exemption covers.
 *
 * The text is run through {@link stripComments} first, so a comment naming a strength is
 * never a finding — which is what lets this file, `quorum.ts`'s own docblocks and every
 * design comment in the tree describe the rule in the words the rule is about.
 *
 * Takes the source as an argument rather than reading it, so the controls below can feed
 * it synthetic text under a real path and watch it decide.
 */
function scanSource(file: string, source: string, options: ScanOptions = {}): SourceFinding[] {
  const applyExemptions = options.applyExemptions ?? true
  const stripped = stripComments(source)
  const lines = stripped.split('\n')

  const spans = EXEMPT_FUNCTIONS.filter((entry) => entry.file === file).flatMap((entry) =>
    entry.functions.map((name) => ({
      key: keyOf(entry.file, name),
      span: spanOf(stripped, name),
    })),
  )

  const found: SourceFinding[] = []
  for (const { kind, pattern } of patterns()) {
    let match = pattern.exec(stripped)
    while (match !== null) {
      const at = stripped.slice(0, match.index).split('\n').length
      const covering = spans.find(
        ({ span }) => span !== undefined && at >= span.from && at <= span.to,
      )
      if (applyExemptions && covering !== undefined) {
        options.used?.add(covering.key)
      } else {
        found.push({
          file,
          at,
          kind,
          // The union rule: the file that carries the coupling, and this file, which is
          // where an exemption for it would have to be registered. Either author is held.
          paths: [file, SELF],
          line: `${file}:${at} ${kind} — ${(lines[at - 1] ?? '').trim().slice(0, 140)}`,
        })
      }
      match = pattern.exec(stripped)
    }
  }
  return found
}

/**
 * The six file-name forms this tree gives a spec, all of which end in one of two suffixes.
 *
 * `.test.ts`, `.node.test.ts`, `.browser.test.ts`, `.e2e.test.ts`, `.perf.test.ts` and
 * `.test.tsx`. Listed as the two suffixes that decide rather than as six, because six
 * entries where two decide is six things to keep in step.
 */
const SPEC_SUFFIXES = ['.test.ts', '.test.tsx'] as const

const isSpec = (file: string): boolean => SPEC_SUFFIXES.some((suffix) => file.endsWith(suffix))

/**
 * Non-test TypeScript under `packages/`, from what git tracks.
 *
 * `git ls-files` rather than a directory walk: it excludes `node_modules` and `dist` for
 * free and matches what a reviewer sees when they clone. Deliberately NOT narrowed to
 * `src/` — `packages/browser/demo/*.ts` is shipped source that sits outside any `src`
 * directory, and a `src/` filter would have quietly dropped the ten files that render the
 * strength to a visitor. A case names one of them.
 */
function corpusPaths(): readonly string[] {
  return [...trackedPaths(ROOT)]
    .filter((file) => file.startsWith('packages/'))
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .filter((file) => !isSpec(file))
    .sort()
}

interface RepoScan {
  readonly findings: readonly SourceFinding[]
  readonly scanned: readonly string[]
  readonly used: ReadonlySet<string>
}

function scanCorpus(): RepoScan {
  const used = new Set<string>()
  const findings: SourceFinding[] = []
  const scanned: string[] = []
  for (const file of corpusPaths()) {
    let source: string
    try {
      source = read(file)
    } catch {
      continue // a staged deletion, or a file this checkout does not have
    }
    scanned.push(file)
    findings.push(...scanSource(file, source, { used }))
  }
  return { findings, scanned, used }
}

const CORPUS: RepoScan = scanCorpus()

const QUORUM = 'packages/core/src/quorum.ts'
const REDUCE_JOB = 'packages/net/src/reduce-job.ts'
const SUBMIT = 'packages/core/src/job/submit.ts'
const LEDGER = 'packages/node/src/mutation-ledger.ts'

/** A path no exemption covers, for the controls. */
const UNEXEMPT = REDUCE_JOB

describe('the source scan is looking at the source', () => {
  /**
   * Everything below asserts an absence. A wrong `ROOT`, a failed `git ls-files` or a glob
   * that excludes the interesting half would satisfy that perfectly while reading nothing.
   */
  it('read the files it claims to have read', () => {
    expect(CORPUS.scanned.length).toBeGreaterThan(50)
    expect(CORPUS.scanned).toContain(QUORUM)
    expect(CORPUS.scanned).toContain(REDUCE_JOB)
    expect(CORPUS.scanned).toContain(SUBMIT)
    // Source that is not under any `src/` directory, and is the copy a visitor reads.
    expect(CORPUS.scanned).toContain('packages/browser/demo/surfaces/fabric.ts')
  })

  it('is not in its own corpus, which is why its prose needs no exemption', () => {
    // Structural, not registered: this file's name ends `.test.ts`, so `isSpec` puts it
    // outside. Nothing in EXEMPT_FUNCTIONS names it and nothing may be added that does —
    // an exemption for a guard's own prose is the shape that makes a guard stop seeing.
    expect(CORPUS.scanned).not.toContain(SELF)
    expect(isSpec(SELF)).toBe(true)
    expect(EXEMPT_FUNCTIONS.map((entry) => entry.file)).not.toContain(SELF)
  })

  it('excludes specs, whose strength names are assertions rather than couplings', () => {
    // 34 / 26 / 31 occurrences of the three pre-existing names live in specs and every one
    // is correct. This states the exclusion is deliberate and total.
    expect(CORPUS.scanned.filter(isSpec)).toEqual([])
    expect(isSpec('packages/core/src/quorum.test.ts')).toBe(true)
    expect(isSpec('packages/node/src/demo-fabric.e2e.test.ts')).toBe(true)
    expect(isSpec(QUORUM)).toBe(false)
  })

  it('emits repo-relative POSIX paths that a commit scope can match', () => {
    // The residual fail-open of narrowing, checked from this guard's end: a `./` prefix or
    // a leading `/` makes every finding foreign and this guard silently stops blocking.
    const emitted = CORPUS.findings.flatMap((finding) => finding.paths)
    expect(pathFormProblems([...CORPUS.scanned, ...emitted, SELF])).toEqual([])
    const tracked = trackedPaths(ROOT)
    expect(CORPUS.scanned.filter((file) => !tracked.has(file))).toEqual([])
    expect(tracked.has(SELF)).toBe(true)
  })
})

describe('no non-test source reads an attestation strength by string', () => {
  it('finds no comparison, no case label and no switch on a strength outside the definition', () => {
    expect(blocking('attestation-claims/strength-literal', CORPUS.findings, SCOPE)).toEqual([])
  })

  /**
   * The property the criterion is actually about, asserted positively.
   *
   * Without this, "nothing compares by string" would also pass in a tree where nothing
   * compares at all — which is the same reading an absence always risks, and the reason
   * `MEMORY.md` records that an absence needs a positive control.
   */
  it('still compares — through attestationRank, at both of the sites that do', () => {
    expect(stripComments(read(REDUCE_JOB))).toContain('attestationRank(')
    expect(stripComments(read(SUBMIT))).toContain('attestationRank(')
  })

  it('leaves the mutation ledger alone, with no exemption at all', () => {
    // Its plant records carry strength names as DATA — a `find` string, a `replace` string
    // and an observed failure signature — not as comparisons. Stated as its own case so a
    // later widening of the patterns that starts reaching the ledger is a red here rather
    // than a quiet new entry in EXEMPT_FUNCTIONS.
    expect(CORPUS.scanned).toContain(LEDGER)
    expect(scanSource(LEDGER, read(LEDGER))).toEqual([])
    expect(EXEMPT_FUNCTIONS.map((entry) => entry.file)).not.toContain(LEDGER)
  })
})

describe('the checker can fail — three plants it must find', () => {
  const PLANTED: readonly { readonly what: string; readonly source: string }[] = [
    { what: 'an equality', source: "if (receipt.strength === 'independent') {}" },
    { what: 'an inequality', source: "const weak = a.strength !== 'owner-domain'" },
    {
      what: 'a switch on a strength',
      source: "switch (receipt.strength) { case 'single-issuer': }",
    },
  ]

  for (const { what, source } of PLANTED) {
    it(`reports ${what}`, () => {
      expect(scanSource(UNEXEMPT, source).length).toBeGreaterThan(0)
    })
  }

  it('reports from three plants, and the three is written down', () => {
    const reporting = PLANTED.filter(({ source }) => scanSource(UNEXEMPT, source).length > 0)
    // The literal, not `PLANTED.length`. An assertion that recomputes the number it tests
    // moves with it and proves nothing — twice in one day in this repository a plant stayed
    // green because both sides moved together.
    expect(reporting.length).toBe(3)

    // FOUR findings from three plants, and the discrepancy is the measurement rather than
    // an accident: the third plant trips two rules at once, because a switch on a strength
    // is also a file that carries a case label. Written as a literal for the reason above.
    const found = PLANTED.flatMap(({ source }) => scanSource(UNEXEMPT, source))
    expect(found.length).toBe(4)
    // All three rules have a control. Without this, two of them could be dead and the
    // count above would still be satisfied by the third firing twice.
    expect(new Set(found.map((finding) => finding.kind))).toEqual(
      new Set(['comparison', 'case-label', 'switch-on-strength']),
    )
  })

  it('finds every one of the four names, not only the one somebody tested with', () => {
    const found = STRENGTHS.flatMap((strength) =>
      scanSource(UNEXEMPT, `if (r.strength === '${strength}') {}`),
    )
    expect(found.length).toBe(4)
  })
})

describe('the checker does not over-fire — three legitimate shapes it must ignore', () => {
  it('says nothing about a comparison that goes through attestationRank', () => {
    expect(
      scanSource(UNEXEMPT, 'return attestationRank(a.strength) < attestationRank(b.strength)'),
    ).toEqual([])
  })

  it('says nothing about an annotation, which asks no question', () => {
    // A single `=` is an assignment. The rule is about a site that BRANCHES on the name.
    expect(scanSource(UNEXEMPT, "const s: AttestationStrength = 'independent'")).toEqual([])
  })

  it('says nothing about a comment carrying all four names', () => {
    // The stripComments link, proved rather than asserted. Without it this guard's own
    // docblocks would be findings in any corpus that held them, and `quorum.ts`'s tables
    // would be findings in the corpus that does.
    const comment = `/** ${STRENGTHS.map((s) => `x === '${s}'`).join(', ')} */\nexport const y = 1`
    expect(scanSource(UNEXEMPT, comment)).toEqual([])
    // …and the same text outside a comment is still found, so the case above is about
    // comments and not about the pattern having stopped working.
    expect(scanSource(UNEXEMPT, `const z = x === '${STRENGTHS[3]}'`).length).toBe(1)
  })
})

describe('the exemption stays narrow and stays honest', () => {
  const QUORUM_SOURCE = read(QUORUM)

  it('is exactly one entry, scoped to two function names and not to a path or a line', () => {
    // The literal, for the same reason as the three above: a count recomputed from the
    // array it describes cannot report that the array grew.
    expect(EXEMPT_FUNCTIONS.length).toBe(1)
    const entry = EXEMPT_FUNCTIONS[0]
    expect(entry?.file).toBe(QUORUM)
    expect(entry?.functions).toEqual(['attestationRank', 'describeAttestation'])
    expect(entry?.reason.length).toBeGreaterThan(20)
  })

  it('suppresses something real, all of it inside the two named bodies', () => {
    const unexempted = scanSource(QUORUM, QUORUM_SOURCE, { applyExemptions: false })
    const stripped = stripComments(QUORUM_SOURCE)
    const spans = ['attestationRank', 'describeAttestation'].map((name) => spanOf(stripped, name))
    expect(spans.filter((span) => span === undefined)).toEqual([])

    // Asserted BEFORE the count, because this is the property and the count is a
    // measurement: everything the entry hides is inside one of the two bodies it names.
    const outside = unexempted.filter(
      (finding) =>
        !spans.some((span) => span !== undefined && finding.at >= span.from && finding.at <= span.to),
    )
    expect(outside.map((finding) => finding.line)).toEqual([])

    // Eight: four case labels in each of the two switches. It was SIX before this phase
    // inserted `single-issuer` into both, and the move from six to eight is exactly why the
    // entry above names functions rather than lines. Written as a literal so a switch that
    // silently stops being exhaustive reddens here.
    expect(unexempted.length).toBe(8)

    // With the entry applied, the definition is quiet.
    expect(scanSource(QUORUM, QUORUM_SOURCE)).toEqual([])
  })

  it('still reports a comparison outside both bodies — the narrowness a path entry would hide', () => {
    const planted =
      `${QUORUM_SOURCE}\n` +
      'export function readsTheLabelByString(receipt: { strength: string }): boolean {\n' +
      "  return receipt.strength === 'independent'\n" +
      '}\n'
    const found = scanSource(QUORUM, planted)
    expect(found.length).toBe(1)
    expect(found[0]?.kind).toBe('comparison')
    expect(found[0]?.line).toContain('receipt.strength')
    expect(found[0]?.paths).toEqual([QUORUM, SELF])
  })

  it('carries no exemption that no longer suppresses anything', () => {
    /**
     * A dead exemption is worse than no exemption: it covers a body that no longer says
     * what the reason claims, and the next person to write a comparison there gets a free
     * pass. Held per FUNCTION rather than per entry — stricter than "neither function
     * fires" — so that `describeAttestation` being rewritten as a lookup demands its name
     * be removed rather than leaving half an entry alive on the other half's findings.
     */
    const dead = EXEMPT_FUNCTIONS.flatMap((entry) =>
      entry.functions
        .filter((name) => !CORPUS.used.has(keyOf(entry.file, name)))
        .map((name) => ({
          paths: [entry.file, SELF],
          line:
            `${keyOf(entry.file, name)} — suppresses nothing; either the function no longer ` +
            `names the strengths, or it is gone. Delete the name from EXEMPT_FUNCTIONS ` +
            `(was: ${entry.reason})`,
        })),
    )
    expect(blocking('attestation-claims/dead-exemption', dead, SCOPE)).toEqual([])
  })

  it('would report the entry dead if the function stopped naming the strengths', () => {
    // The dead-exemption check's own positive control. Without it, "no dead exemptions"
    // is satisfied by a `used` set that nothing ever writes to.
    const used = new Set<string>()
    scanSource(QUORUM, 'export function attestationRank(): number {\n  return 0\n}\n', { used })
    expect(used.has(keyOf(QUORUM, 'attestationRank'))).toBe(false)
    expect(CORPUS.used.has(keyOf(QUORUM, 'attestationRank'))).toBe(true)
    expect(CORPUS.used.has(keyOf(QUORUM, 'describeAttestation'))).toBe(true)
  })
})

describe('the ordering callers depend on, read from the module', () => {
  it('ranks the four strictly weakest to strongest', () => {
    const ranks = STRENGTHS.map((strength) => attestationRank(coversTheUnion(strength)))
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i] ?? 0).toBeGreaterThan(ranks[i - 1] ?? 0)
    }
    // Four distinct numbers, written as a literal: a rank function returning a constant
    // would satisfy neither, but a rank function that collapsed two values would satisfy
    // the loop above if the collapse were at the ends.
    expect(new Set(ranks).size).toBe(4)
    expect(STRENGTHS.length).toBe(4)
  })
})

/* -------------------------------------------------------------------------------------- */

/**
 * The release copy, checked against the independence this fabric will now report.
 *
 * The obligation is the ROADMAP's, committed at `4ff8a36`: *"the public copy for the
 * release must not promise an independence the fabric will not report — that copy is Phase
 * 39's, and this phase must check it rather than assume it."*
 *
 * ## The distinction that is the whole difficulty
 *
 * The promise refused here is an independent **verification** claim — that some result was
 * checked by a party the first one does not control. It is NOT the project's core-value
 * sentence about independently-**owned** devices, which is true, is the point of the
 * project, and appears in `README.md` today. Nor is it *"independent cubes"*, a statement
 * that the search space partitions. So the patterns below name verbs of checking, and the
 * negative controls are built out of those two real sentences rather than invented.
 *
 * ## What it deliberately DOES fire on, which reads like an over-fire and is not
 *
 * `describeAttestation('owner-attested')` ends *"not independently verified"* — a refusal
 * of the promise, and these patterns would report it. That is intended. A release page
 * carrying any arm of the kernel's sentence statically has a copy of words whose author is
 * `quorum.ts`, and this phase has already found one such copy that drifted:
 * `docs/design/mockups/o2-fabric-demo/o2 Fabric Demo.dc.html` hardcodes three of the four
 * and now disagrees with the kernel by a whole arm. The demo's own attestation card does
 * the right thing instead — it is a `data-kind="reading"` region and prints whatever the
 * kernel hands it, so it holds no sentence for this scan to find.
 */
describe('the release copy promises no independence this fabric will not report', () => {
  /**
   * Named by path, because the release copy is small, fixed, and the ROADMAP names it.
   * A path that goes missing must redden rather than silently shrink the corpus.
   */
  const RELEASE_COPY: readonly string[] = [
    'docs/recruitment/telegram-invite.md',
    'packages/browser/demo/index.html',
    'packages/browser/demo/policy.html',
    'packages/browser/demo/status.html',
    'README.md',
  ]

  /**
   * Markdown here is hard-wrapped at ~78 columns and the HTML is indented, so a phrase a
   * reader sees as one sentence is two lines in the file and matches no line-wise rule.
   * `licensing-consistency.node.test.ts` established this by writing four rules line-wise
   * first and watching them fail on correct documents.
   */
  const flatten = (text: string): string => text.replace(/\s+/g, ' ')

  const CLAIMS: readonly { readonly promise: string; readonly pattern: RegExp }[] = [
    { promise: 'independent verification', pattern: /independently verified/ },
    { promise: 'independent verification', pattern: /independent verification/ },
    { promise: 'independent verification', pattern: /verified independently/ },
    { promise: 'an independent check', pattern: /independently checked/ },
    // `(?!list)` so an independent checklist — an ordinary document — is not a claim.
    { promise: 'an independent check', pattern: /independent check(?!list)/ },
    { promise: 'independent operators having agreed', pattern: /independent operators agreed/ },
  ]

  function copyFindings(file: string, text: string): Finding[] {
    const flat = flatten(text)
    const found: Finding[] = []
    for (const { promise, pattern } of CLAIMS) {
      const search = new RegExp(pattern.source, 'gi')
      let match = search.exec(flat)
      while (match !== null) {
        found.push({
          paths: [file, SELF],
          line:
            `${file} promises ${promise} — "${match[0]}" in: ` +
            `…${flat.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100)}…`,
        })
        match = search.exec(flat)
      }
    }
    return found
  }

  /** The slice of flattened text around `phrase`, for a control lifted from a real file. */
  function around(flat: string, phrase: string): string {
    const at = flat.indexOf(phrase)
    if (at === -1) return ''
    return flat.slice(Math.max(0, at - 180), at + phrase.length + 180)
  }

  it('has every named path on disk, so an absence is a red and not a silent skip', () => {
    const missing = RELEASE_COPY.filter((file) => {
      try {
        read(file)
        return false
      } catch {
        return true
      }
    })
    expect(missing).toEqual([])
    expect(RELEASE_COPY.length).toBe(5)
  })

  it('reports a planted promise — the control without which a clean read means nothing', () => {
    const planted = 'Every answer is independently verified by separate operators.'
    const found = copyFindings('README.md', planted)
    expect(found.length).toBe(1)
    expect(found[0]?.line).toContain('independent verification')
    expect(found[0]?.paths).toEqual(['README.md', SELF])
  })

  it('leaves the two true independence sentences this tree already carries alone', () => {
    // Lifted out of the files rather than transcribed, and each control is checked alive
    // first: a control that silently found nothing would report "no finding" for the wrong
    // reason, which is the failure this whole describe is built against.
    const ownership = around(flatten(read('README.md')), 'independently-owned nodes')
    expect(ownership).toContain('independently-owned nodes')
    expect(copyFindings('README.md', ownership)).toEqual([])

    const cubes = around(flatten(read('packages/browser/demo/index.html')), 'independent cubes')
    expect(cubes).toContain('independent cubes')
    // The same slice carries the redundancy claim — "every cube is run on two of them and
    // the two must agree" — which is about REPLICAS rather than providers, is true, and is
    // untouched by this phase. It must not be a finding either.
    expect(cubes).toContain('the two must agree')
    expect(copyFindings('packages/browser/demo/index.html', cubes)).toEqual([])
  })

  it('makes no independent-verification promise anywhere in the release copy', () => {
    const findings = RELEASE_COPY.flatMap((file) => copyFindings(file, read(file)))
    expect(blocking('attestation-claims/release-copy', findings, SCOPE)).toEqual([])
  })
})
