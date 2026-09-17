import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCATION_TERMS, PLACEMENT_VERBS, rawLocationClaims, type LocationClaim } from './location-claims.ts'

/**
 * `HOST-07`'s guard — one command that refuses any published document, result or tracked line
 * claiming **where** a hosted object physically runs.
 *
 * ## Two corpora, because the criterion names two failures
 *
 * - **Tier 1** — {@link isPublishedSurface}'s corpus: the published copy and the results,
 *   scanned for a `'term'` finding (a listed place name, anywhere on the line).
 * - **Tier 2** — every tracked file, scanned for an `'attribution'` finding (one of the three
 *   region addresses on the same line as a placement verb, whatever place it names or does
 *   not name).
 *
 * Both read `rawLocationClaims` from `location-claims.ts`; this file owns the corpus
 * definitions, the exemption layer, the substituted positive controls, and the dead-exemption
 * check — `vocabulary.node.test.ts`'s shapes, copied rather than reinvented.
 *
 * ## This file types no place name
 *
 * Every fixture below is built by substituting {@link LOCATION_TERMS} entries and
 * {@link PLACEMENT_VERBS}-matching phrases into ordinary sentences, on
 * `check-copy.node.test.ts:19-46`'s measured finding: a spec built this way needs no
 * `EXEMPT_PATHS` entry, because it contains none of the terms itself. Checked explicitly below
 * rather than only argued.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** This file's own repo-relative path — the one place a dead exemption is deleted. */
const SELF = 'packages/node/src/location-claims.node.test.ts'

// ── the three region addresses, derived rather than retyped ──────────────────────────────

/**
 * `packages/node` does not depend on `@o2/cloudflare` — read 2026-09-13 from
 * `packages/node/package.json`, the same constraint `hosted-tier-deploy.node.test.ts` already
 * works under. The three addresses are read out of `hosted-object.ts` as TEXT, the same
 * technique that file already uses for its own call-site counting (its `.get(` case, and the
 * one-call-site guard for the platform siting call HOST-08 names — not repeated verbatim
 * here, because that exact identifier is itself the subject of a two-file closed-set guard in
 * `hosted-tier-deploy.node.test.ts`, and a third file naming it would be this file).
 */
const HOSTED_OBJECT_SOURCE: string = readFileSync(
  join(ROOT, 'packages/cloudflare/src/hosted-object.ts'),
  'utf8',
)

/**
 * Every distinct `'bootstrap-…'` string literal in the file, de-duplicated. A derivation that
 * silently produced two would make every attribution case below scan for less than it claims —
 * asserted as the literal `3`, not `ADDRESSES.length`, in the first case below.
 */
const ADDRESSES: readonly string[] = [
  ...new Set(
    [...HOSTED_OBJECT_SOURCE.matchAll(/'(bootstrap-[a-z]+)'/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  ),
]

describe('the three region addresses are derived from hosted-object.ts, never retyped', () => {
  it('extracts exactly three, asserted as the literal rather than its own length', () => {
    expect(ADDRESSES.length).toBe(3)
    expect(new Set(ADDRESSES).size).toBe(3)
  })
})

// ── the corpus ─────────────────────────────────────────────────────────────────────────────

const TRACKED: readonly string[] = execFileSync('git', ['ls-files', '-z'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter((path) => path.length > 0)

/**
 * Tier 1's corpus: the published surface and the results.
 *
 * Derived from what `scripts/deploy-pages.sh` actually publishes — `DIST`/`PUBLIC` there are
 * `packages/browser/dist` (build output, untracked) and `packages/browser/demo/public`
 * (also untracked); the tracked source it builds FROM is `packages/browser/index.html` and
 * every per-package demo file vite bundles in (`packages/<name>/demo/**`). `README.md`, the
 * whole of `docs/`, and the
 * two results documents `bench-results.node.test.ts` reads round out the list.
 *
 * `docs/` stays WHOLE rather than carved by sub-directory — see `33-04-PLAN.md`'s context —
 * so a fifth pre-existing hit would redden this suite rather than being silently out of scope.
 */
function isPublishedSurface(file: string): boolean {
  if (file === 'README.md') return true
  if (file.startsWith('docs/')) return true
  if (file === 'packages/browser/index.html') return true
  if (file === '.planning/BENCHMARK-RESULTS.md') return true
  if (file === '.planning/BENCHMARK-RESULTS-2026-08-01.md') return true
  return /^packages\/[^/]+\/demo\//.exec(file) !== null
}

/**
 * Declared binary extensions, copied from `vocabulary.node.test.ts`'s own list and mechanism
 * rather than reinvented — that file's header states why a skip must be declared rather than
 * inferred from a stray NUL byte. Duplicated rather than imported: that file exports neither
 * name, and the list itself is identical.
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

type NulVerdict = 'text' | 'declared-binary' | 'invisible'

function nulVerdict(file: string, bytes: Buffer): NulVerdict {
  if (!bytes.includes(0)) return 'text'
  return isDeclaredBinary(file) ? 'declared-binary' : 'invisible'
}

// ── the exemption layer ────────────────────────────────────────────────────────────────────

/** A whole file or tree exempt from every check. Empty today — see the note below. */
interface PathExemption {
  readonly path: string
  readonly reason: string
}

/**
 * Whole-file/tree exemptions. Empty, and that is a finding rather than an omission.
 *
 * `location-claims.ts` was the one candidate — `vocabulary.node.test.ts`'s equivalent module,
 * `banned-vocabulary.ts`, needs an entry because ITS corpus is `git ls-files` in full. This
 * guard's Tier 1 never reads `packages/node/src/`, and this module never writes a region
 * address next to a placement verb (the addresses arrive as a parameter), so an unconditional
 * entry would be dead by construction — see `location-claims.ts`'s own docblock. The scan
 * below confirms it: no entry is needed, and the dead-exemption check would report one if it
 * were added anyway.
 */
const EXEMPT_PATHS: readonly PathExemption[] = []

/** One line, exempt from one of the two rules, with the reason it is not a violation. */
interface LineExemption {
  readonly file: string
  readonly rule: 'term' | 'attribution'
  /**
   * Exact text that must be present on the offending line, and inside which the finding must
   * fall. Keyed on the phrase rather than a line number because several of these files are
   * edited by concurrent work — `vocabulary.node.test.ts`'s own stated reason.
   */
  readonly phrase: string
  readonly reason: string
}

/**
 * Individual lines exempt from one tier, each with the reason it is not a violation.
 *
 * ## The four known pre-existing hits — anticipated by `33-04-PLAN.md`, grepped 2026-09-13
 *
 * `docs/business/o2-vs-aws-study.md` and its two generated HTML twins, on the hiring-market
 * phrase; `docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md`, on its
 * worked-example phrases (four occurrences, one line carrying two so it needs two entries).
 * **No path exemption over `docs/business/` or `docs/superpowers/`** — `docs/` stays whole in
 * Tier 1 so a fifth hit reddens.
 *
 * ## Three attribution hits the plan did not anticipate — found by running the scan
 *
 * `.planning/OWNER-ACTIONS.md`, `.planning/PROJECT.md` and
 * `packages/libp2p/src/admission-directive.ts` each name a region address on the same line as
 * a word from {@link PLACEMENT_VERBS}, and none of the three attributes a place to it — see
 * each entry's reason. Reported as a finding in `33-04-SUMMARY.md` rather than silently
 * absorbed: the plan named four hits and the corpus held seven.
 */
const EXEMPT_LINES: readonly LineExemption[] = [
  {
    file: 'docs/business/o2-vs-aws-study.md',
    rule: 'term',
    phrase: 'materially higher in Eastern Europe than in the US market',
    reason:
      '2026-09-13: a hiring-market comparison in a cost study — about where engineers live, not about where a hosted object runs',
  },
  {
    file: 'docs/business/o2-vs-aws-study.html',
    rule: 'term',
    phrase: 'materially higher in Eastern Europe than in the US market',
    reason: '2026-09-13: generated from the exempted markdown above by docs/business/build-study.py; inherits its reason',
  },
  {
    file: 'docs/business/o2-vs-aws-study.standalone.html',
    rule: 'term',
    phrase: 'materially higher in Eastern Europe than in the US market',
    reason: '2026-09-13: generated from the exempted markdown above by docs/story/build-standalone.mjs; inherits its reason',
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'near the London Museum',
    reason:
      "2026-09-13: a worked example in a geographic-discovery design whose entire subject is places, not a claim about where a hosted object runs",
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'In Miami, finding drivers nearby',
    reason:
      '2026-09-13: a worked example in a geographic-discovery design whose entire subject is places, not a claim about where a hosted object runs',
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'the node holding a London',
    reason:
      "2026-09-13: half of the sentence that argues this phase's own point — a node holding a listing need not be where the listing's name suggests",
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'listing need not be in London.',
    reason: '2026-09-13: the other half of the same sentence — a worked example, not a claim about where a hosted object runs',
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'Uber (Miami)',
    reason:
      '2026-09-13: a worked example in a geographic-discovery design whose entire subject is places, not a claim about where a hosted object runs',
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'AirBnB (London from SF)',
    reason:
      '2026-09-13: a worked example in a geographic-discovery design whose entire subject is places, not a claim about where a hosted object runs',
  },
  {
    file: 'docs/superpowers/specs/2026-08-11-h3-geographic-discovery-design.md',
    rule: 'term',
    phrase: 'holds the London cell block',
    reason: '2026-09-13: the second occurrence on the same worked-example line, a distinct match needing its own entry',
  },
  {
    file: '.planning/OWNER-ACTIONS.md',
    rule: 'attribution',
    phrase: 'an object physically runs',
    reason:
      "2026-09-13: this line IS the guard's own description of itself, transcribed from HOST-07's row — not a claim that any object actually runs anywhere",
  },
  {
    file: '.planning/PROJECT.md',
    rule: 'attribution',
    phrase: 'A Durable Object lives in one datacenter',
    reason:
      '2026-09-13: a general statement about the Durable Objects platform model, in the same table cell as — but not attributing a place to — the three region addresses named later in the same cell for an unrelated reason (they are temporary, not where they run)',
  },
  {
    file: 'packages/libp2p/src/admission-directive.ts',
    rule: 'attribution',
    // Deliberately does NOT include the region address this line also names: the finding's
    // match/column are the placement-verb span, and a phrase carrying the address too would
    // put an address next to this same verb on one line of THIS spec's own source, which
    // Tier 2 would then flag about this file — see the "finds nothing wrong with its own
    // spec file" case below, which is what caught that the first time this was written.
    phrase: '— lives in',
    reason: "2026-09-13: 'lives in' names which SOURCE FILE the closed name set is defined in, not a physical location",
  },
]

function keyOf(entry: LineExemption): string {
  return `${entry.file} :: ${entry.rule} :: ${entry.phrase}`
}

/**
 * Is this specific finding covered by a line exemption?
 *
 * The finding's match must fall INSIDE the exempted phrase, not merely share a line with it —
 * `vocabulary.node.test.ts`'s own rule, so exempting one occurrence never shelters a second,
 * unrelated one on the same line.
 */
function lineExemptionFor(
  file: string,
  rule: 'term' | 'attribution',
  lineText: string,
  column: number,
  length: number,
): LineExemption | undefined {
  for (const entry of EXEMPT_LINES) {
    if (entry.file !== file || entry.rule !== rule) continue
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
 * Every location claim in `content` that no exemption covers.
 *
 * Re-splits `content` for the RAW (untrimmed) line text rather than reading
 * {@link LocationClaim.text}, which `rawLocationClaims` trims — `vocabulary.node.test.ts`'s
 * `scan()` does the same, for the same reason: `column` is an offset into the untrimmed line,
 * and a trimmed copy would shift it.
 */
function scanForClaims(
  file: string,
  content: string,
  addresses: readonly string[],
  used: Set<string>,
): LocationClaim[] {
  const lines = content.split('\n')
  const kept: LocationClaim[] = []
  for (const claim of rawLocationClaims(file, content, addresses)) {
    const lineText = lines[claim.line - 1] ?? ''
    const entry = lineExemptionFor(claim.file, claim.rule, lineText, claim.column, claim.match.length)
    if (entry !== undefined) {
      used.add(keyOf(entry))
      continue
    }
    kept.push(claim)
  }
  return kept
}

interface RepoScan {
  readonly termClaims: readonly LocationClaim[]
  readonly attributionClaims: readonly LocationClaim[]
  readonly tier1Scanned: readonly string[]
  readonly allScanned: readonly string[]
  readonly used: ReadonlySet<string>
  readonly invisible: readonly string[]
  readonly binary: readonly string[]
}

/** Scans every file `git` tracks, exactly once, for both tiers at once. */
function scanRepository(addresses: readonly string[]): RepoScan {
  const used = new Set<string>()
  const termClaims: LocationClaim[] = []
  const attributionClaims: LocationClaim[] = []
  const tier1Scanned: string[] = []
  const allScanned: string[] = []
  const invisible: string[] = []
  const binary: string[] = []

  for (const file of TRACKED) {
    if (file === 'package-lock.json') continue

    let bytes: Buffer
    try {
      bytes = readFileSync(join(ROOT, file))
    } catch {
      continue // staged deletion, or a file this checkout does not have
    }

    const verdict = nulVerdict(file, bytes)
    if (verdict === 'declared-binary') {
      binary.push(file)
      continue
    }
    if (verdict === 'invisible') {
      invisible.push(file)
      continue
    }

    const content = bytes.toString('utf8')
    allScanned.push(file)
    const isTier1 = isPublishedSurface(file)
    if (isTier1) tier1Scanned.push(file)

    for (const claim of scanForClaims(file, content, addresses, used)) {
      if (claim.rule === 'term' && isTier1) termClaims.push(claim)
      if (claim.rule === 'attribution') attributionClaims.push(claim)
    }
  }

  return { termClaims, attributionClaims, tier1Scanned, allScanned, used, invisible, binary }
}

const REPO: RepoScan = scanRepository(ADDRESSES)

function render(claim: LocationClaim): string {
  return `${claim.file}:${claim.line} [${claim.rule}/${claim.term}] "${claim.match}" — ${claim.text.slice(0, 140)}`
}

// ── anti-vacuity: the scan is looking at the repository ───────────────────────────────────

describe('the repository scan is looking at the repository', () => {
  it('read files it claims to have read', () => {
    expect(REPO.allScanned.length).toBeGreaterThan(500)
    expect(REPO.tier1Scanned.length).toBeGreaterThan(50)
    expect(REPO.tier1Scanned).toContain('README.md')
    expect(REPO.tier1Scanned).toContain('.planning/BENCHMARK-RESULTS.md')
    expect(REPO.tier1Scanned).toContain('.planning/BENCHMARK-RESULTS-2026-08-01.md')
    expect(REPO.tier1Scanned).toContain('docs/business/o2-vs-aws-study.md')
  })

  it('has no file that escaped the scan by looking like a binary', () => {
    expect(REPO.invisible).toEqual([])
  })

  it('still skips the binaries it is meant to skip', () => {
    expect(REPO.binary.length).toBeGreaterThan(0)
    expect(REPO.binary.every(isDeclaredBinary)).toBe(true)
  })
})

// ── Tier 1 — the published surface and the results ────────────────────────────────────────

describe('HOST-07, Tier 1 — no listed place name survives on the published surface or in the results', () => {
  it('finds no term violation after the exemption layer', () => {
    expect(REPO.termClaims.map(render)).toEqual([])
  })
})

// ── Tier 2 — attribution, over the whole tracked tree ──────────────────────────────────────

describe('HOST-07, Tier 2 — no region address is attributed a placement anywhere in the tracked tree', () => {
  it('finds no attribution violation after the exemption layer', () => {
    expect(REPO.attributionClaims.map(render)).toEqual([])
  })
})

// ── the exceptions stay honest ──────────────────────────────────────────────────────────────

describe('the exceptions stay honest', () => {
  it('carries no line exemption that no longer matches anything', () => {
    const dead = EXEMPT_LINES.filter((entry) => !REPO.used.has(keyOf(entry))).map(keyOf)
    expect(dead).toEqual([])
  })

  it('gives every exemption a reason longer than 20 characters', () => {
    for (const entry of EXEMPT_PATHS) expect(entry.reason.length).toBeGreaterThan(20)
    for (const entry of EXEMPT_LINES) expect(entry.reason.length).toBeGreaterThan(20)
  })

  it('holds no EXEMPT_PATHS entry under docs/business/ or docs/superpowers/', () => {
    for (const entry of EXEMPT_PATHS) {
      expect(entry.path.startsWith('docs/business')).toBe(false)
      expect(entry.path.startsWith('docs/superpowers')).toBe(false)
    }
  })

  it('round-trips: every EXEMPT_PATHS entry still exists in the corpus', () => {
    for (const entry of EXEMPT_PATHS) {
      const stillTracked = entry.path.endsWith('/')
        ? REPO.allScanned.some((file) => file.startsWith(entry.path))
        : REPO.allScanned.includes(entry.path)
      expect(stillTracked, `${entry.path} no longer exists in the corpus`).toBe(true)
    }
  })
})

// ── this spec types no place name ───────────────────────────────────────────────────────────

describe('the guard finds nothing wrong with its own spec file', () => {
  it('has no EXEMPT_PATHS entry for its own file, or for location-claims.ts', () => {
    expect(EXEMPT_PATHS.some((entry) => entry.path === SELF)).toBe(false)
    expect(EXEMPT_PATHS.some((entry) => entry.path === 'packages/node/src/location-claims.ts')).toBe(false)
  })

  /**
   * The claim `33-04-PLAN.md` makes is that this spec needs no `EXEMPT_PATHS` entry, on
   * `check-copy.node.test.ts`'s measured precedent. Tier 1 never reads
   * `packages/node/src/`, so a `'term'` finding here is structurally impossible regardless of
   * what this file's own `EXEMPT_LINES` phrases quote — and, like `vocabulary.node.test.ts`'s
   * own exemption entries, several of those phrases necessarily contain the exact flagged
   * text, because the containment check that decides an exemption applies requires the
   * phrase to literally cover the match it excuses. What is checked here, and is the part of
   * the claim that actually binds THIS file, is Tier 2: no line of this spec's own source may
   * carry a region address next to a placement verb. It found one on first write — the
   * `admission-directive.ts` exemption's phrase originally repeated the address it was
   * keying on — and this case is what caught it, watched red before the phrase was narrowed.
   */
  it('produces no attribution finding when the real scan reads its own source', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const found = rawLocationClaims(SELF, source, ADDRESSES).filter((claim) => claim.rule === 'attribution')
    expect(found.map(render)).toEqual([])
  })
})

// ── every pattern is global, so it carries a lastIndex ──────────────────────────────────────

describe('every pattern in the shared vocabulary is global', () => {
  it('every LOCATION_TERMS pattern carries the g flag', () => {
    for (const row of LOCATION_TERMS) expect(row.pattern.flags).toContain('g')
  })

  it('PLACEMENT_VERBS carries the g flag', () => {
    expect(PLACEMENT_VERBS.flags).toContain('g')
  })
})

describe('LOCATION_TERMS is a floor proved by reading it, not assumed', () => {
  it('has at least 8 rows, each with a why longer than 20 characters', () => {
    expect(LOCATION_TERMS.length).toBeGreaterThanOrEqual(8)
    for (const row of LOCATION_TERMS) expect(row.why.length).toBeGreaterThan(20)
  })
})

// ── the matcher can fail — proved by a fixture built from the module itself ─────────────────

describe('the matcher can fail — proved by a fixture built by substitution, not assumed', () => {
  it('returns one term finding per row when every term is substituted into a sentence', () => {
    const lines = LOCATION_TERMS.map(
      (row, i) => `Report ${i}: this line names ${row.term} and nothing else notable.`,
    )
    const found = rawLocationClaims('synthetic-tier1.md', lines.join('\n'), ADDRESSES).filter(
      (claim) => claim.rule === 'term',
    )
    // The per-term count, read from the array rather than hard-coded — a sixth row that
    // failed to match its own term would leave this short, and a row added without a case
    // above would leave it long.
    expect(found.length).toBe(LOCATION_TERMS.length)
  })

  it('returns exactly one attribution finding for an address next to a placement verb, with no listed term', () => {
    const address = ADDRESSES[0]
    if (address === undefined) throw new Error('no address derived — see the derivation case above')
    const content = `The bundle serving ${address} is hosted in a fast facility today.`
    const found = rawLocationClaims('synthetic-tier2.md', content, ADDRESSES).filter(
      (claim) => claim.rule === 'attribution',
    )
    // The literal `1`, not `found.length` compared to itself — an assertion that reuses the
    // value it tests moves with it and proves nothing. This line is the one place a second,
    // silently-added attribution finding on the same line would be caught.
    expect(found.length).toBe(1)
    expect(found.map((claim) => claim.term)).toEqual([address])
  })

  it('the term fixture above carries no listed region address, so it cannot double as an attribution case', () => {
    const lines = LOCATION_TERMS.map((row, i) => `Report ${i}: this line names ${row.term} and nothing else notable.`)
    const found = rawLocationClaims('synthetic-tier1.md', lines.join('\n'), ADDRESSES).filter(
      (claim) => claim.rule === 'attribution',
    )
    expect(found).toEqual([])
  })
})
