import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

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
]

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
    // English words inside a PNG would only produce noise.
    if (bytes.includes(0)) continue

    scanned.push(file)
    violations.push(...scan(file, bytes.toString('utf8'), used))
  }

  return { violations, scanned, used }
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
})

describe('no cryptojacking vocabulary reaches a reviewer who greps', () => {
  for (const { term, why } of BANNED) {
    it(`says "${term}" nowhere — ${why}`, () => {
      expect(REPO.violations.filter((v) => v.term === term).map(render)).toEqual([])
    })
  }
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
    const dead = EXEMPT_LINES.filter((entry) => !REPO.used.has(keyOf(entry))).map(
      (entry) => `${keyOf(entry)} — no longer present; delete this entry (was: ${entry.reason})`,
    )
    expect(dead).toEqual([])
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
