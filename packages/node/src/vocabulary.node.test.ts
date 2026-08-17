import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocking, commitScope, pathFormProblems, trackedPaths } from './commit-scope.ts'

/**
 * Vocabulary discipline, enforced over the whole repository rather than remembered.
 *
 * The reason is not squeamishness. Coinhive became the second-most-blocked domain
 * across 130M Malwarebytes users; Firefox blocks known cryptominers by default via
 * the Disconnect list; Google banned the whole category from the Chrome Web Store;
 * Salon's opt-in flow was pilloried anyway. Consent did not save any of them — the
 * explicitly opt-in AuthedMine was blocked too. A blocklist entry is origin-level
 * and effectively permanent, and its failure mode is invisible: nobody reports that
 * the page was blocked, it just contributes nothing.
 *
 * The demo ships a policy page written for the human reviewer who decides that.
 * That reviewer greps. They do not read intent, they do not open a design document
 * to check which sense of "token" was meant, and they will not be persuaded that the
 * repository's use of the word was ironic. So the words go, and a test keeps them
 * gone.
 *
 * A rule that cannot express its own exceptions gets disabled the first time it
 * fires wrongly — so the exceptions are data, each carrying the reason it is
 * defensible, and the rule is proved able to fail before it is trusted.
 *
 * ## Scanned repo-wide, blocking on the commit
 *
 * The corpus is every tracked file and stays that way. What narrowed on 2026-08-04 is
 * only what a *commit* is refused for: this guard used to hold whoever committed next,
 * which for a term committed into a root-level `.md` meant refusing every subsequent
 * commit by an agent working on `.ts` files who had not caused it. A finding outside the
 * commit is still printed — see `commit-scope.ts`, and the reason hiding it would be the
 * wrong fix is defect #38, one file over.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The commit these findings are judged against, or `NO_COMMIT_SCOPE` outside a commit.
 *
 * Read once, at module scope, so every case below reads the same answer. Absence is
 * strict: under `npm test` or a verifier there is no scope and every finding blocks.
 */
const SCOPE = commitScope()

/** This file's own path, which is where a dead line exemption is deleted. */
const SELF = 'packages/node/src/vocabulary.node.test.ts'

interface Banned {
  readonly term: string
  readonly pattern: RegExp
  readonly why: string
}

/**
 * The banned vocabulary.
 *
 * Inflections are included because a grep for "miner" finds "miners" and a reviewer
 * scanning for reward language finds "earned" as readily as "earn". What is
 * deliberately *not* here is the pronoun "mine" — "a claim of mine" is English, and
 * banning it would fire on two existing phase retrospectives while catching nothing
 * a reviewer would react to. `\b` anchors keep "determining", "examining",
 * "learning", and "accredited" out.
 */
const BANNED: readonly Banned[] = [
  {
    term: 'mining',
    pattern: /\b(?:crypto[\s-]?)?min(?:ing|er|ers)\b/gi,
    why: 'the single word every cryptojacking blocklist is keyed on',
  },
  {
    term: 'hashrate',
    pattern: /\bhash[\s-]?rates?\b/gi,
    why: 'has no meaning outside proof-of-work and reads as proof-of-work on sight',
  },
  {
    term: 'earn',
    pattern: /\bearn(?:s|ed|ing|ings)?\b/gi,
    why: 'frames volunteered compute as paid work — the claim Coinhive made and could not keep',
  },
  {
    term: 'credits',
    pattern: /\bcredits?\b/gi,
    why: 'a currency word, and the fabric settles nothing; BOINC-style points also invite result-forging',
  },
  {
    term: 'tokens',
    pattern: /\b(?:data)?tokens?\b/gi,
    why: 'reads as cryptocurrency to a reviewer who does not stop to check the sense',
  },
]

interface PathExemption {
  /** Repo-relative path. A trailing `/` exempts the whole tree beneath it. */
  readonly path: string
  readonly reason: string
}

/**
 * Whole files and trees that are exempt.
 *
 * Chosen over per-line entries in exactly four places, and the choice is the point:
 * a line-level exemption is more auditable, so it is used everywhere it is stable,
 * and a tree-level exemption is only used where line numbers churn faster than
 * anyone would maintain them, or where the file's entire subject *is* the banned
 * vocabulary.
 *
 * The bias is deliberately toward exempting as little as possible, because a
 * reviewer greps the repository and does not read intent. Everything outside these
 * four paths — `docs/`, `README.md`, `CLAUDE.md`, every `packages/*`, every other
 * planning document — is held to per-line discipline below.
 */
const EXEMPT_PATHS: readonly PathExemption[] = [
  {
    path: '.planning/research/',
    reason:
      'the literature review that motivates this rule: ~60 occurrences, every one a citation of Coinhive, Salon, the Disconnect list or the Chrome Web Store ban, several inside source URLs that cannot be reworded',
  },
  {
    path: '.planning/phases/phase-9-public-demo/',
    reason:
      'the planning record for the slice that introduces this rule — its context document specifies the banned list verbatim, and its plan and summary quote it back',
  },
  {
    path: '.planning/HANDOFF.json',
    reason:
      'machine-generated session state that restates the constraint; regenerated wholesale each phase, so line numbers there are meaningless',
  },
  {
    path: '.planning/.continue-here.md',
    reason:
      'machine-generated session state that restates the constraint; regenerated wholesale each phase, so line numbers there are meaningless',
  },
  {
    path: 'packages/node/src/vocabulary.node.test.ts',
    reason:
      'the rule cannot be written down without naming what it bans; a reviewer who greps and lands here finds the prohibition, not a violation',
  },
]

interface LineExemption {
  /** Repo-relative path of the file. */
  readonly file: string
  /**
   * Exact text that must be present on the offending line, and inside which the
   * banned word must fall. Keyed on the phrase rather than a line number because
   * several of these files are edited by concurrent work, and an exemption that
   * fires on an unrelated edit is how a guard gets deleted.
   */
  readonly phrase: string
  readonly reason: string
}

/** Individual lines that are exempt, each with the reason it is not a violation. */
const EXEMPT_LINES: readonly LineExemption[] = [
  {
    file: '.planning/PROJECT.md',
    phrase: 'operators earned single-digit',
    reason: 'the Coinhive earnings figure is the evidence for the ban, cited to justify it',
  },
  {
    file: '.planning/ROADMAP.md',
    phrase: 'no "mining",',
    reason: 'the roadmap stating this rule; the quoted list is the prohibition itself',
  },
  {
    file: '.planning/ROADMAP.md',
    phrase: '"hashrate", "earn", "credits", or "tokens"',
    reason: 'the roadmap stating this rule; the quoted list is the prohibition itself',
  },
  {
    file: '.planning/phases/phase-8-benchmark/SUMMARY.md',
    phrase: 'rule earned its place',
    reason: 'ordinary English — a retrospective heading about a benchmark rule proving useful',
  },
  {
    file: 'CLAUDE.md',
    phrase: 'capability tokens',
    reason: 'the security sense: SPKI/UCAN object-capabilities, in a row about dag-cbor encoding',
  },
  {
    file: 'docs/p2p-native-cloud-design.md',
    phrase: 'only earn their place',
    reason: 'ordinary English — binary-translation paths justifying their existence, §I.2',
  },
  {
    file: 'docs/p2p-native-cloud-design.md',
    phrase: 'capability tokens',
    reason: 'the security sense: the layer-5 trust-and-attestation row, §2',
  },
  {
    file: 'docs/p2p-native-cloud-design.md',
    phrase: 'Present a token signed by the data owner',
    reason: 'the security sense: an SPKI/UCAN capability chain, §3.4',
  },
  {
    file: 'docs/p2p-native-cloud-design.md',
    phrase: 'single-use enrollment token',
    reason: 'the security sense: the enrollment credential shipped in the client, §3.9',
  },
  {
    file: 'packages/node/src/bin/bench.ts',
    phrase: 'rule earning its place',
    reason: 'ordinary English — a comment about the incomplete-run rule catching a real case',
  },
  {
    file: 'docs/business/o2-vs-aws-study.md',
    phrase: 'https://aws.amazon.com/startups/credits',
    reason:
      "the source URL for AWS's startup programme, in the citation list — the study's prose was reworded to 'allowance' everywhere the word was the author's own, and this is the one occurrence that is somebody else's identifier and cannot be reworded without breaking the link",
  },
  // The two below are the committed renderings of the markdown above, and they carry the
  // same URL for the same reason. They are listed separately rather than by exempting
  // `docs/business/` as a tree, because a tree exemption would also cover the study's own
  // prose — which is held to the rule, and was reworded in seven places to satisfy it.
  {
    file: 'docs/business/o2-vs-aws-study.html',
    phrase: 'https://aws.amazon.com/startups/credits',
    reason: 'generated from the exempted markdown by docs/business/build-study.py',
  },
  {
    file: 'docs/business/o2-vs-aws-study.standalone.html',
    phrase: 'https://aws.amazon.com/startups/credits',
    reason: 'generated from the exempted markdown by docs/story/build-standalone.mjs',
  },
  // The two below are the CSS sense of the word — custom properties on `:root` — in a
  // stylesheet imported verbatim from the Claude Design project that produced the demo
  // mockup. Listed as lines rather than by exempting the vendored `_ds/` tree, for the
  // reason the two entries above give: a tree exemption would also cover whatever prose
  // a future re-import brings with it, and the mockup's own copy is held to the rule.
  // Both fire today; if a re-import reworks these comments the dead-exemption check says so.
  {
    file: 'docs/design/mockups/o2-fabric-demo/_ds/industry-4b1f0d05-e62b-453f-afb5-717eabafadb4/styles.css',
    phrase: 'design-system tokens',
    reason: 'the CSS sense: the file header naming the `--color-*`/`--space-*` custom properties it defines',
  },
  {
    file: 'docs/design/mockups/o2-fabric-demo/_ds/industry-4b1f0d05-e62b-453f-afb5-717eabafadb4/styles.css',
    phrase: 'the tokens above',
    reason: 'the CSS sense: the components banner pointing back at those same custom properties',
  },
  // The lending sense of the word, in an owner-authored RFC. `credit` is banned here as a
  // CURRENCY word — the fabric settles nothing, and BOINC-style points invite result-forging.
  // "credit evaluation" is creditworthiness assessment, listed beside insurance underwriting
  // and inter-bank analysis as a workload two distrustful parties might run inside a Digital
  // White Room. It names a use case the protocol serves, not a thing the fabric pays anyone.
  //
  // Exempted as a LINE rather than by rewording, and rather than by exempting the document:
  // the RFC is the owner's authored text and editing an author's prose to satisfy a lint is
  // not the guard's business, while a whole-file exemption would also cover whatever a future
  // revision brings. Sole occurrence in the file as of 2026-08-09; the dead-exemption check
  // reports it if a later revision drops the line.
  {
    file: 'docs/architecture/Digital_White_Room_RFC_Alexander_Fedin_v0.1.md',
    phrase: 'credit evaluation',
    reason: 'the lending sense: a due-diligence workload example, not a fabric currency',
  },
  // The ACME sense: RFC 8555 §8.1 names the random value a certificate authority issues for a
  // challenge `token`, and `acme-client` reads the field by that name off the JSON. It is a
  // wire field, so it cannot be reworded the way the prose entries above were.
  //
  // Reduced to ONE occurrence before being exempted, which is the part worth stating. The
  // module first carried the word six times — a field declaration, two reads, a construction
  // and a comment. All five of those are renamed to `issuedValue`; the single line below is
  // the JSON key and nothing else. An exemption over a protocol field is auditable; six over
  // a codebase's own identifiers would be a whitelist.
  {
    file: 'packages/node/src/local-acme.ts',
    phrase: 'token: authz.challenge.issuedValue',
    reason:
      "RFC 8555's challenge field name on the wire, where acme-client reads it — the certificate sense, and the only occurrence left after the module's own identifiers were renamed",
  },
]

/**
 * Extensions whose files are expected to contain NUL bytes.
 *
 * The scan below skips any file with a NUL in it, because matching English words
 * inside a PNG is noise. That heuristic is right about binaries and catastrophic
 * about everything else: a `.ts` file with one stray NUL — two argv assertions
 * carrying literal terminators, in this repository's own `wasi-executor.test.ts` —
 * is skipped whole, and becomes an exemption **nobody registered and nobody can see**.
 * A reviewer auditing `EXEMPT_PATHS` would find nothing to audit.
 *
 * So the skip is now a declaration rather than an inference. A NUL inside one of
 * these extensions is a binary; a NUL anywhere else is a violation in its own right,
 * reported under {@link RepoScan.invisible}. The list is deliberately extensions rather than
 * paths: `.wasm` fixtures come and go, but a `.ts` file is never legitimately binary,
 * and that is the whole distinction worth encoding.
 */
const BINARY_EXTENSIONS: readonly string[] = [
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.zip',
  '.gz',
  '.car',
]

function isDeclaredBinary(file: string): boolean {
  return BINARY_EXTENSIONS.some((ext) => file.endsWith(ext))
}

/**
 * What the NUL check decided about one file, as a value rather than a `continue`.
 *
 * Pulled out so the mutation tests can ask it directly. Inline, the invisible case
 * was unreachable from a test without writing a NUL into the working tree.
 */
type NulVerdict = 'text' | 'declared-binary' | 'invisible'

function nulVerdict(file: string, bytes: Buffer): NulVerdict {
  if (!bytes.includes(0)) return 'text'
  return isDeclaredBinary(file) ? 'declared-binary' : 'invisible'
}

interface Violation {
  /** Repo-relative path. */
  readonly file: string
  readonly line: number
  /** Zero-based offset of the match within the line. */
  readonly column: number
  readonly term: string
  readonly match: string
  readonly text: string
}

function exemptPathFor(file: string): PathExemption | undefined {
  return EXEMPT_PATHS.find(({ path }) => (path.endsWith('/') ? file.startsWith(path) : file === path))
}

/** Stable identity of a line exemption, for the "no dead exemptions" check. */
function keyOf(entry: LineExemption): string {
  return `${entry.file} :: ${entry.phrase}`
}

/**
 * Is this specific match covered by a line exemption?
 *
 * The match must fall *inside* the exempted phrase, not merely share a line with
 * it. Otherwise exempting `"hashrate", "earn", "credits", or "tokens"` on a roadmap
 * line would also exempt anything else later added to that line.
 */
function lineExemptionFor(
  file: string,
  lineText: string,
  column: number,
  length: number,
): LineExemption | undefined {
  for (const entry of EXEMPT_LINES) {
    if (entry.file !== file) continue
    let from = 0
    for (;;) {
      const start = lineText.indexOf(entry.phrase, from)
      if (start === -1) break
      if (column >= start && column + length <= start + entry.phrase.length) return entry
      from = start + 1
    }
  }
  return undefined
}

/**
 * Every banned word in `content`, before any exemption is applied.
 *
 * Separated from the exemption layer so the mutation tests can prove the matcher
 * itself fires, independently of where a file happens to live.
 */
function rawMatches(file: string, content: string): Violation[] {
  const found: Violation[] = []
  const lines = content.split('\n')
  for (const [index, text] of lines.entries()) {
    for (const { term, pattern } of BANNED) {
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) continue
        found.push({
          file,
          line: index + 1,
          column: match.index,
          term,
          match: match[0],
          text: text.trim(),
        })
      }
    }
  }
  return found
}

/**
 * Banned words in `content` that no exemption covers.
 *
 * `used` collects the keys of line exemptions that actually fired, so dead
 * exemptions can be found and deleted rather than quietly whitelisting text nobody
 * has read in a year.
 */
function scan(file: string, content: string, used: Set<string> = new Set()): Violation[] {
  if (exemptPathFor(file) !== undefined) return []
  const kept: Violation[] = []
  const lines = content.split('\n')
  for (const violation of rawMatches(file, content)) {
    const text = lines[violation.line - 1] ?? ''
    const entry = lineExemptionFor(file, text, violation.column, violation.match.length)
    if (entry !== undefined) {
      used.add(keyOf(entry))
      continue
    }
    kept.push(violation)
  }
  return kept
}

interface RepoScan {
  readonly violations: readonly Violation[]
  readonly scanned: readonly string[]
  readonly used: ReadonlySet<string>
  /** Tracked files skipped as binary that no declared binary extension covers. */
  readonly invisible: readonly string[]
  /** Tracked files skipped as binary, legitimately. */
  readonly binary: readonly string[]
}

/**
 * Scans every file git tracks.
 *
 * `git ls-files` rather than a directory walk: it excludes `node_modules`, `dist`,
 * and everything gitignored for free, and — more importantly — it matches what a
 * reviewer sees when they clone the repository, which is the population this rule
 * is actually about.
 */
function scanRepository(): RepoScan {
  const used = new Set<string>()
  const violations: Violation[] = []
  const scanned: string[] = []
  const invisible: string[] = []
  const binary: string[] = []

  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)

  for (const file of tracked) {
    // A lockfile is a machine-generated dependency graph; nobody writes prose in it
    // and a package name is not a claim this project makes.
    if (file === 'package-lock.json') continue

    let bytes: Buffer
    try {
      bytes = readFileSync(join(ROOT, file))
    } catch {
      continue // staged deletion, or a file this checkout does not have
    }
    // Binary files: a NUL byte anywhere is the cheap, reliable signal, and matching
    // English words inside a PNG would only produce noise. But the skip has to be
    // *declared* — see BINARY_EXTENSIONS — or it is an exemption with no entry.
    const verdict = nulVerdict(file, bytes)
    if (verdict === 'declared-binary') {
      binary.push(file)
      continue
    }
    if (verdict === 'invisible') {
      invisible.push(file)
      continue
    }

    scanned.push(file)
    violations.push(...scan(file, bytes.toString('utf8'), used))
  }

  return { violations, scanned, used, invisible, binary }
}

const REPO: RepoScan = scanRepository()

function render(violation: Violation): string {
  return `${violation.file}:${violation.line} "${violation.match}" — ${violation.text.slice(0, 120)}`
}

describe('the repository scan is looking at the repository', () => {
  /**
   * The whole suite asserts "nothing matched". A wrong root, a failed `git ls-files`,
   * or an over-broad exemption would satisfy that perfectly while checking nothing.
   */
  it('read the files it claims to have read', () => {
    expect(REPO.scanned.length).toBeGreaterThan(100)
    expect(REPO.scanned).toContain('docs/p2p-native-cloud-design.md')
    expect(REPO.scanned).toContain('README.md')
    expect(REPO.scanned).toContain('packages/browser/demo/index.html')
  })

  it('did not exempt the repository out from under itself', () => {
    const exempt = REPO.scanned.filter((file) => exemptPathFor(file) !== undefined)
    // Five paths are exempt; if that ever covers a large share of the repository,
    // the rule has stopped meaning anything.
    expect(exempt.length).toBeLessThan(REPO.scanned.length / 4)
  })

  /**
   * The exemption nobody could have audited.
   *
   * `wasi-executor.test.ts` was committed carrying two raw NUL bytes — literal argv
   * terminators inside a template string — and the binary skip above swallowed the
   * whole file. Nothing failed. No entry appeared in `EXEMPT_PATHS`. The
   * planted-violation tests below kept passing, because they scan synthetic content
   * rather than the tree, so the guard reported itself healthy while one file had
   * quietly left its jurisdiction.
   *
   * The failure message names the file, because "some file is invisible" is not
   * actionable and this is exactly the check somebody will hit at an inconvenient
   * moment.
   */
  it('has no file that escaped the scan by looking like a binary', () => {
    expect(
      blocking(
        'vocabulary/invisible',
        REPO.invisible.map((file) => ({
          // The file itself, and this one — the two places the fix can be made: spell
          // the NUL, or declare the extension in `BINARY_EXTENSIONS` here.
          paths: [file, SELF],
          line:
            `${file} contains a NUL byte and is not a declared binary — it is being skipped ` +
            'entirely, which is an exemption with no entry and no reason. Spell the NUL ' +
            `\\u0000 in source, or add its extension to BINARY_EXTENSIONS.`,
        })),
        SCOPE,
      ),
    ).toEqual([])
  })

  it('still skips the binaries it is meant to skip', () => {
    // The complement of the check above. If `invisible` were empty because nothing is
    // ever skipped, the guard would be scanning WASM bytes for English and the empty
    // result would prove nothing.
    expect(REPO.binary.length).toBeGreaterThan(0)
    expect(REPO.binary.every(isDeclaredBinary)).toBe(true)
  })
})

describe('a NUL byte cannot buy a file its way out of the scan', () => {
  const NUL = String.fromCharCode(0)

  it('calls a NUL in a source file invisible, not binary', () => {
    // The mutation that matters: this is the exact shape the real defect had.
    expect(nulVerdict('packages/aot/src/wasi-executor.test.ts', Buffer.from(`x${NUL}y`))).toBe(
      'invisible',
    )
    expect(nulVerdict('docs/p2p-native-cloud-design.md', Buffer.from(NUL))).toBe('invisible')
    expect(nulVerdict('packages/browser/demo/index.html', Buffer.from(NUL))).toBe('invisible')
  })

  it('calls a NUL in a declared binary a binary', () => {
    expect(nulVerdict('packages/demo/src/kernel.wasm', Buffer.from(NUL))).toBe('declared-binary')
    expect(nulVerdict('docs/diagram.png', Buffer.from(NUL))).toBe('declared-binary')
  })

  it('leaves ordinary text alone whatever its extension', () => {
    expect(nulVerdict('packages/aot/src/elf.ts', Buffer.from('no terminators here'))).toBe('text')
    expect(nulVerdict('packages/demo/src/kernel.wasm', Buffer.from('not really wasm'))).toBe('text')
  })

  it('would have caught the real thing: banned words hidden behind a NUL', () => {
    // Before this check existed, a file could carry both a NUL and every banned word
    // and the scan would report zero violations for it. Prove the two halves connect:
    // the content *is* a violation, and the verdict is what decides whether anyone
    // ever looks at it.
    const content = `start mining today${NUL}`
    expect(scan('packages/browser/demo/index.html', content).map((v) => v.term)).toContain('mining')
    expect(nulVerdict('packages/browser/demo/index.html', Buffer.from(content))).toBe('invisible')
  })
})

describe('no cryptojacking vocabulary reaches a reviewer who greps', () => {
  for (const { term, why } of BANNED) {
    it(`says "${term}" nowhere — ${why}`, () => {
      // One path, and it is exact: a banned word is in the file it is in, and the person
      // who put it there is the person who can take it out. No union applies.
      const findings = REPO.violations
        .filter((violation) => violation.term === term)
        .map((violation) => ({ paths: [violation.file], line: render(violation) }))
      expect(blocking(`vocabulary/${term}`, findings, SCOPE)).toEqual([])
    })
  }
})

describe('the paths this guard attributes findings to are paths a commit can match', () => {
  /**
   * The residual fail-open of narrowing, checked from the guard's end.
   *
   * A `./` prefix, a leading `/`, or a Windows separator in the corpus makes every
   * finding foreign and this guard silently stops blocking — no red, no output, nothing
   * that distinguishes it from a clean repository. Form alone is not enough either:
   * `src/index.html` for a file at `packages/browser/demo/index.html` is well-formed and
   * matches nothing. So the reading is a round trip against the same `git ls-files` a
   * commit scope is built from.
   */
  const TRACKED = trackedPaths(ROOT)

  it('emits repo-relative POSIX paths that git also prints', () => {
    expect(pathFormProblems(REPO.scanned)).toEqual([])
    // Every scanned path came from `git ls-files`, so all of them round-trip. A floor
    // rather than an equality only because the corpus grows.
    expect(REPO.scanned.filter((file) => TRACKED.has(file)).length).toBeGreaterThan(100)
    expect(REPO.scanned.filter((file) => !TRACKED.has(file))).toEqual([])
  })
})

describe('the exceptions stay honest', () => {
  /**
   * A dead exemption is worse than no exemption: it silently covers a line that no
   * longer says what the reason claims, and the next person to write that line gets
   * a free pass. The cost of this check is that fixing an exempted line also means
   * deleting its entry — a one-line edit, and the failure message says which one.
   *
   * Only *line* exemptions are held to this. Path exemptions cover trees whose
   * contents legitimately come and go.
   */
  it('carries no line exemption that no longer matches anything', () => {
    const dead = EXEMPT_LINES.filter((entry) => !REPO.used.has(keyOf(entry))).map((entry) => ({
      // The union: an exemption dies either because somebody edited the line it covers
      // or because somebody should delete the entry here. Both participate, so whichever
      // of the two is committing is held.
      paths: [entry.file, SELF],
      line: `${keyOf(entry)} — no longer present; delete this entry (was: ${entry.reason})`,
    }))
    expect(blocking('vocabulary/dead-exemption', dead, SCOPE)).toEqual([])
  })

  it('gives every exemption a stated reason, so none can be added silently', () => {
    for (const entry of EXEMPT_PATHS) expect(entry.reason.length).toBeGreaterThan(20)
    for (const entry of EXEMPT_LINES) expect(entry.reason.length).toBeGreaterThan(20)
  })
})

describe('the checker can fail — proved by mutation, not assumed', () => {
  /**
   * A guard is worth nothing until something shows it can fail. Every check above
   * passes trivially if `rawMatches` returns nothing, if a regex was mistyped, or if
   * the exemption layer swallows everything. So each banned word is planted in
   * synthetic content, in a file path no exemption covers, and the scanner is
   * required to catch it.
   */
  const UNEXEMPT = 'packages/browser/demo/index.html'

  const PLANTED: readonly { readonly term: string; readonly content: string }[] = [
    { term: 'mining', content: '<p>Start mining in your browser today.</p>' },
    { term: 'hashrate', content: '<span id="hashrate">0 H/s</span>' },
    { term: 'earn', content: '<p>Leave this tab open and earn while you read.</p>' },
    { term: 'credits', content: '<p>You have 42 credits.</p>' },
    { term: 'tokens', content: '<p>Contributed compute is settled in tokens.</p>' },
  ]

  for (const { term, content } of PLANTED) {
    it(`flags "${term}" in text that no exemption covers`, () => {
      const found = scan(UNEXEMPT, content)
      expect(found.map((v) => v.term)).toContain(term)
    })
  }

  it('flags every inflection, not only the dictionary form', () => {
    const found = scan(
      UNEXEMPT,
      [
        'miners and cryptomining and cryptominers',
        'hash rate and hashrates',
        'she earns, he earned, they are earning, the earnings',
        'one credit, many credits',
        'one token, many tokens, and datatokens',
      ].join('\n'),
    )
    expect(found.length).toBeGreaterThanOrEqual(13)
    expect(new Set(found.map((v) => v.term))).toEqual(
      new Set(['mining', 'hashrate', 'earn', 'credits', 'tokens']),
    )
  })

  it('does not flag an allowlisted phrase in the file it is allowlisted for', () => {
    const line = 'Present a token signed by the data owner — SPKI/UCAN, delegatable.'
    expect(scan('docs/p2p-native-cloud-design.md', line)).toEqual([])
    // …and the same sentence elsewhere is still a violation, because the exemption
    // is scoped to the file that earned it.
    expect(scan(UNEXEMPT, line).length).toBeGreaterThan(0)
  })

  it('does not let an allowlisted phrase shelter the rest of its line', () => {
    // The exemption covers the phrase, not the line. Anything appended to that line
    // is scanned normally — otherwise an exemption would be a permanent hole.
    const found = scan(
      'docs/p2p-native-cloud-design.md',
      'Present a token signed by the data owner, then start mining.',
    )
    expect(found.map((v) => v.term)).toEqual(['mining'])
  })

  it('leaves the pronoun "mine" and ordinary English alone', () => {
    // Deliberate non-matches. If any of these start failing, the patterns have grown
    // teeth they should not have, and the rule will be deleted the first time it
    // fires on a phase retrospective.
    const benign = [
      'A claim of mine that was wrong.',
      'A bad type assertion of mine.',
      'Determining the minimum, examining the mineral, learning by doing.',
      'The reminder was accredited to the wrong streaming job.',
    ].join('\n')
    expect(scan(UNEXEMPT, benign)).toEqual([])
  })
})
