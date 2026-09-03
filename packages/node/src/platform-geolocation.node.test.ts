import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The operator's own location does not get committed — enforced, not remembered.
 *
 * ## The rule, and why it had nothing behind it
 *
 * `CLAUDE.md` records the finding: *"a local `workerd` populates `request.cf` from the
 * **host's real public address**, so every local run of a Cloudflare spec carries the
 * developer's own city-level geolocation into the object under test… **never dump
 * `request.cf` into a log, a fixture, a snapshot or a committed file**. The hazard is not
 * the code under test; it is the diagnostic somebody adds next to it."*
 *
 * That was the whole of the enforcement: a sentence. `funnel-collector.ts` and
 * `funnel-collector.e2e.test.ts` both name `request.cf` legitimately — they are the code
 * that reads one property and discards thirty-two — so a blunt ban on the identifier
 * would be wrong, and a rule that fires on the code it is protecting gets deleted the
 * first time it fires. This file is the narrower rule the sentence needs.
 *
 * ## Two instruments, because the hazard has two shapes
 *
 * 1. **A dump already in the tree.** A file where two or more of the platform's
 *    sub-country properties appear *with values attached* is a copy of somebody's
 *    location, whatever it is called — a fixture, a docblock, a summary. The value is
 *    what makes it a dump; a list of property names in prose is a discussion of the
 *    hazard and is left alone.
 * 2. **The diagnostic somebody adds next.** A statement that both calls a sink —
 *    `console.log`, `process.stdout.write`, `writeFileSync`, `toMatchSnapshot` — and
 *    names `request.cf` or a binding of it. This is the shape `CLAUDE.md` says the hazard
 *    actually has, and there are zero of them in the tree today; the planted cases below
 *    are what show the instrument can see one.
 *
 * ## What this deliberately cannot see, said here rather than left to be found
 *
 * A bare **value** with no property name beside it — a string like a city name in an
 * assertion list — is invisible to both instruments. Detecting those would mean writing
 * the operator's real city, postal code and coordinates into this file as literals, which
 * is the exact act the rule forbids; a guard that has to commit the secret to look for it
 * is not a guard. `funnel-collector.e2e.test.ts` has such a list, as the *negative*
 * control for a store that must not contain them, and that use is defensible where a
 * fixture supplying them as input is not.
 *
 * The property list also stops short of `region`, `timezone` and `country`. `region` is
 * this repository's own `HostedObjectName` field and appears on hundreds of lines;
 * `timezone` is ordinary configuration; `country` is the **one** property
 * `funnel-collector.ts` is allowed to read, and flagging it would fire on the discarding
 * path itself.
 *
 * ## The plants this file must survive
 *
 * - `console.log(request.cf)` in any tracked file — *flags a diagnostic that prints the
 *   platform object*. Watched by planting synthetic content rather than the tree, on
 *   `vocabulary.node.test.ts`'s pattern, so the plant cannot disturb a concurrent agent.
 * - The same call split across lines, which a line-at-a-time scan misses — *flags a
 *   diagnostic split across lines*.
 * - Two valued properties in one file — *flags a fixture carrying a real location*.
 * - Break the scan (return nothing from `scanRepository`) and the corpus cases go red
 *   rather than every finding-is-empty case passing. A scan that reads nothing passes
 *   exactly as loudly as a scan that finds nothing wrong.
 * - Delete this file's own path exemption and *did not exempt itself out of existence*
 *   still passes, but *carries no exemption that no longer matches anything* reddens —
 *   the exemption is live, because this file names the property list it looks for.
 *
 * ## Not in `scripts/cheap-guards.sh`, on purpose
 *
 * What runs on every commit is a decision with a price on every commit, and that list is
 * asserted on by `slow-specs.node.test.ts`. Adding this file there is the owner's call,
 * not an agent's.
 *
 * Node-only: walks every tracked file off disk.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** This file's own path, which is where a dead exemption is deleted. */
const SELF = 'packages/node/src/platform-geolocation.node.test.ts'

/**
 * The properties of the platform's per-request object that carry **sub-country**
 * precision.
 *
 * Taken from the thirty-three that a local `wrangler dev` was measured supplying, less
 * the three named in the file docblock. Every one of these is a fact about a person's
 * neighbourhood, their network, or the edge they reached — none has an innocent second
 * meaning that appears in this repository with a value beside it, which is what the
 * preview across 1 130 tracked files showed and what the ordinary-text cases below hold.
 */
const SENSITIVE_PROPERTIES: readonly string[] = [
  'city',
  'postalCode',
  'latitude',
  'longitude',
  'asn',
  'asOrganization',
  'clientTcpRtt',
  'colo',
  'metroCode',
  'regionCode',
  'continent',
]

/**
 * A property name with a literal **value** attached.
 *
 * `name: 'x'`, `name = 'x'`, `name: 42`, `name = -1.5`. The value is the whole
 * distinction: `` `postalCode`, `latitude` and `longitude` `` in a sentence about the
 * hazard is a discussion, and `postalCode: '…'` is a copy of somebody's neighbourhood.
 */
function valuedPattern(): RegExp {
  return new RegExp(String.raw`\b(${SENSITIVE_PROPERTIES.join('|')})\s*[:=]\s*(?:['"\`]|-?\d)`, 'g')
}

/**
 * How many distinct valued properties make a dump.
 *
 * **Two, and it is a judgement rather than a discovered boundary.** One is not enough:
 * `latitude: 0` in an unrelated map utility is a coordinate somebody wrote, not a
 * location the platform handed over. Two together is the platform's object being copied —
 * every real occurrence in the tree carries seven or more. The cost is stated: a lone
 * `postalCode: '…'` is a leak this misses, and the sink instrument does not cover it
 * either.
 */
const CLUSTER_THRESHOLD = 2

/**
 * Calls that put a value somewhere it outlives the process.
 *
 * Call-shaped — each is matched with its opening parenthesis — so that prose about the
 * rule cannot match. `CLAUDE.md`'s own sentence contains the words "log", "fixture" and
 * "snapshot" beside `request.cf`, and must not be a finding; it has no call in it.
 */
const SINKS: readonly string[] = [
  'console.log',
  'console.error',
  'console.warn',
  'console.info',
  'console.debug',
  'console.dir',
  'console.table',
  'process.stdout.write',
  'process.stderr.write',
  'writeFileSync',
  'appendFileSync',
  'writeFile',
  'appendFile',
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toMatchFileSnapshot',
]

function sinkPattern(): RegExp {
  return new RegExp(String.raw`(?:${SINKS.map((sink) => sink.replaceAll('.', String.raw`\.`)).join('|')})\s*\(`)
}

/**
 * The platform object, as a statement can name it.
 *
 * `request.cf`, `req.cf`, and a bare `cf` — the binding `funnel-collector.ts` makes with
 * `const cf = request.cf`. A bare name is loose on its own and precise **inside a sink
 * statement**, which is the only place it is consulted. `_cf_KV`, workerd's storage table
 * name, does not match: an underscore is a word character, so there is no boundary before
 * `cf`.
 */
const SUBJECT = /\b\w+\.cf\b|\bcf\b/

/**
 * Extensions whose files are expected to contain NUL bytes.
 *
 * The same declaration `vocabulary.node.test.ts` makes, for the reason it gives: a NUL in
 * a `.ts` file would otherwise skip that file whole, which is an exemption nobody
 * registered and nobody can audit. A NUL outside these extensions is reported rather than
 * skipped.
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

interface PathExemption {
  /** Repo-relative path. A trailing `/` exempts the whole tree beneath it. */
  readonly path: string
  readonly reason: string
  /**
   * A string that must be PRESENT in the file for the exemption to hold.
   *
   * This is what stops an exemption becoming a hole. A path entry alone says *this file
   * may carry a location-shaped cluster*; a sentinel says *and here is the evidence the
   * cluster is synthetic*. Replace the synthetic values with a real reading and the
   * sentinel goes with them, so the exemption lapses and the file is flagged again — which
   * is the behaviour an exemption for redacted data must have, since the redaction is the
   * only reason the finding was defensible.
   */
  readonly sentinel?: string
}

/**
 * Whole files that are exempt, each carrying the reason it is not a violation.
 *
 * **The guard was born red on three real findings and they were REDACTED, not exempted.**
 * A guard born green by exempting the violations it found demonstrates nothing and
 * preserves what it was built to remove. All three carried this machine's real city,
 * postal code, coordinates, ASN and network organisation into a PUBLIC repository; the
 * values are now synthetic and documentation-reserved.
 *
 * **The three entries below are therefore not forgiveness — they are the residue of a
 * redaction, and each is CONDITIONAL on its sentinel.** The cluster shape is still there
 * because the fixture still has to be `request.cf`-shaped to prove anything; what is gone
 * is the data. Put a real reading back and the sentinel goes with it, the exemption lapses
 * and the file is flagged again.
 */
const EXEMPT_PATHS: readonly PathExemption[] = [
  {
    path: SELF,
    reason:
      'the rule cannot be written down without naming the properties it looks for; a reader who greps and lands here finds the prohibition, not a copy of a real location',
  },
  {
    path: 'packages/cloudflare/src/funnel-collector.test.ts',
    reason:
      'the fixture must be shaped like the platform object to prove the collector discards it, and its values were redacted to synthetic ones on 2026-09-02; only `country` is load-bearing and a synthetic city proves the property for any city',
    sentinel: 'EXAMPLE-CITY',
  },
  {
    path: 'packages/cloudflare/src/funnel-collector.ts',
    reason:
      'the docblock records what the platform hands the collector, which is the argument for reading one property of thirty-three; redacted to synthetic values on 2026-09-02',
    sentinel: 'EXAMPLE-CITY',
  },
  {
    path: '.planning/phases/phase-37-the-six-stage-funnel-and-a-frozen-telemetry-schema/37-01-SUMMARY.md',
    reason:
      'the phase record states what was measured at the door, which is why criterion 4 has a positive control at all; redacted to synthetic values on 2026-09-02',
    sentinel: 'EXAMPLE-CITY',
  },
]

function exemptPathFor(file: string, content: string): PathExemption | undefined {
  const entry = EXEMPT_PATHS.find(({ path }) =>
    path.endsWith('/') ? file.startsWith(path) : file === path,
  )
  if (entry === undefined) return undefined
  // A sentinel that is no longer in the file means the redaction it stood for is gone, so
  // the exemption does not apply and the finding is reported as if it had never existed.
  if (entry.sentinel !== undefined && !content.includes(entry.sentinel)) return undefined
  return entry
}

// ---------------------------------------------------------------------------
// Instrument 1 — a location already committed
// ---------------------------------------------------------------------------

interface ValuedProperty {
  readonly name: string
  readonly line: number
}

/** Every sensitive property that carries a value, with the line it is on. */
function valuedProperties(content: string): ValuedProperty[] {
  const found: ValuedProperty[] = []
  for (const [index, text] of content.split('\n').entries()) {
    for (const match of text.matchAll(valuedPattern())) {
      const name = match[1]
      if (name !== undefined) found.push({ name, line: index + 1 })
    }
  }
  return found
}

/** Is this content a copy of the platform's location object? */
function isLocationDump(content: string): boolean {
  return new Set(valuedProperties(content).map((property) => property.name)).size >= CLUSTER_THRESHOLD
}

// ---------------------------------------------------------------------------
// Instrument 2 — the diagnostic somebody adds next
// ---------------------------------------------------------------------------

/** Net parenthesis balance of one line. Enough to tell an open call from a closed one. */
function netDepth(line: string): number {
  let depth = 0
  for (const character of line) {
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
  }
  return depth
}

/** How many lines a statement may span before the join gives up. */
const STATEMENT_WINDOW_LINES = 10

interface Statement {
  readonly line: number
  readonly text: string
}

/**
 * Logical statements, so a call split across lines is read as one thing.
 *
 * A line-at-a-time scan sees `console.log(` and `JSON.stringify(request.cf),` as two
 * unrelated lines and finds nothing — which is the shape a diagnostic actually takes once
 * a formatter has been near it. Every line starts a window; the window extends while
 * parentheses are open, up to {@link STATEMENT_WINDOW_LINES}. The bound is what stops an
 * unbalanced parenthesis in prose from swallowing a whole document.
 */
function statementsOf(content: string): Statement[] {
  const lines = content.split('\n')
  const out: Statement[] = []
  for (let start = 0; start < lines.length; start += 1) {
    let text = lines[start] ?? ''
    let depth = netDepth(text)
    let end = start
    while (depth > 0 && end - start < STATEMENT_WINDOW_LINES - 1 && end + 1 < lines.length) {
      end += 1
      const next = lines[end] ?? ''
      text += `\n${next}`
      depth += netDepth(next)
    }
    out.push({ line: start + 1, text })
  }
  return out
}

/** Statements that both call a sink and name the platform object. */
function dumpingStatements(content: string): Statement[] {
  const sink = sinkPattern()
  return statementsOf(content).filter(
    (statement) => sink.test(statement.text) && SUBJECT.test(statement.text),
  )
}

// ---------------------------------------------------------------------------
// The repository scan
// ---------------------------------------------------------------------------

interface Finding {
  /** Repo-relative path. */
  readonly file: string
  readonly line: number
  readonly kind: 'committed-location' | 'dumping-statement'
  readonly detail: string
}

interface RepoScan {
  readonly findings: readonly Finding[]
  readonly scanned: readonly string[]
  /** Files an exemption actually applied to — a sentinel that lapsed is NOT in here. */
  readonly exempted: readonly string[]
  readonly used: ReadonlySet<string>
  /** Tracked files skipped as binary that no declared extension covers. */
  readonly invisible: readonly string[]
  /** Tracked files skipped as binary, legitimately. */
  readonly binary: readonly string[]
}

/**
 * Scans every file git tracks.
 *
 * `git ls-files` rather than a directory walk, on `vocabulary.node.test.ts`'s reasoning:
 * it matches what somebody cloning this repository actually receives, which is the
 * population the rule is about. A dump in an untracked scratch file harms nobody.
 */
function scanRepository(): RepoScan {
  const findings: Finding[] = []
  const scanned: string[] = []
  const exempted: string[] = []
  const invisible: string[] = []
  const binary: string[] = []
  const used = new Set<string>()

  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)

  for (const file of tracked) {
    // Machine-generated dependency graph; nobody writes a diagnostic in it.
    if (file === 'package-lock.json') continue

    let bytes: Buffer
    try {
      bytes = readFileSync(join(ROOT, file))
    } catch {
      continue // staged deletion, or a file this checkout does not have
    }
    if (bytes.includes(0)) {
      if (isDeclaredBinary(file)) {
        binary.push(file)
      } else {
        invisible.push(file)
      }
      continue
    }

    const content = bytes.toString('utf8')
    const exemption = exemptPathFor(file, content)
    scanned.push(file)
    if (exemption !== undefined) exempted.push(file)

    const dump = isLocationDump(content)
    const statements = dumpingStatements(content)
    if (exemption !== undefined) {
      // Recorded as used only when it actually covers something, so a dead exemption is
      // findable — the same discipline `vocabulary.node.test.ts` holds its line
      // exemptions to.
      if (dump || statements.length > 0) used.add(exemption.path)
      continue
    }

    if (dump) {
      const properties = valuedProperties(content)
      const first = properties[0]
      findings.push({
        file,
        line: first?.line ?? 1,
        kind: 'committed-location',
        detail:
          `${String(new Set(properties.map((property) => property.name)).size)} distinct ` +
          `platform location properties carry values here (${[
            ...new Set(properties.map((property) => property.name)),
          ]
            .sort()
            .join(', ')}), across ${String(properties.length)} occurrences`,
      })
    }
    for (const statement of statements) {
      findings.push({
        file,
        line: statement.line,
        kind: 'dumping-statement',
        detail: statement.text.slice(0, 160).replaceAll('\n', ' ⏎ '),
      })
    }
  }

  return { findings, scanned, exempted, used, invisible, binary }
}

const REPO: RepoScan = scanRepository()

function render(finding: Finding): string {
  return `${finding.file}:${String(finding.line)} [${finding.kind}] ${finding.detail}`
}

/** What to do about a finding, said once so both cases say the same thing. */
const REMEDIES =
  'Two remedies, and this guard does not choose between them. (1) REDACT: replace the ' +
  'measured values with synthetic ones — a fixture proves the same thing with ' +
  "`city: 'Metropolis'` as with a real city, and a docblock recording the measurement " +
  'can name the properties without their values. (2) EXEMPT: add a PathExemption in ' +
  `${SELF} with a reason somebody can argue with. What is not available is leaving it ` +
  'unread: CLAUDE.md says never dump request.cf into a log, a fixture, a snapshot or a ' +
  'committed file, and a fixture is one of the four it names.'

describe('the repository scan is looking at the repository', () => {
  /**
   * Every interesting assertion below is "nothing matched". A wrong root, a failed
   * `git ls-files`, or a pattern that stopped compiling satisfies all of them perfectly
   * while checking nothing.
   */
  it('read the files it claims to have read', () => {
    expect(REPO.scanned.length).toBeGreaterThan(100)
    expect(REPO.scanned).toContain('CLAUDE.md')
    expect(REPO.scanned).toContain('packages/cloudflare/src/funnel-collector.ts')
    expect(REPO.scanned).toContain('packages/cloudflare/src/funnel-collector.e2e.test.ts')
  })

  it('did not exempt the repository out from under itself', () => {
    const exempt = REPO.exempted
    expect(exempt.length).toBeLessThan(REPO.scanned.length / 4)
  })

  it('holds every sentinel it depends on, so no exemption is standing on a redaction that is gone', () => {
    // A `sentinel` is the evidence that an exempted cluster is synthetic. If one is missing
    // the exemption silently lapses and the file is reported — which is the correct
    // behaviour and also an easy thing to not notice, so it is asserted here by name rather
    // than left to be discovered through the finding list.
    const missing = EXEMPT_PATHS.filter((entry) => entry.sentinel !== undefined).filter(
      (entry) => !REPO.exempted.includes(entry.path),
    )
    expect(
      missing.map((entry) => `${entry.path} no longer contains "${entry.sentinel ?? ''}"`),
      'an exemption in EXEMPT_PATHS carries a sentinel the file no longer holds, so the ' +
        'redaction it stood for has been undone or the file was renamed. Restore the ' +
        'synthetic values, or remove the entry — do not remove the sentinel.',
    ).toEqual([])
  })

  it('has no file that escaped the scan by looking like a binary', () => {
    expect(
      REPO.invisible,
      'these tracked files contain a NUL byte and are not declared binaries, so they are ' +
        'skipped entirely — an exemption with no entry and no reason. Spell the NUL as ' +
        `\\u0000 in source, or add the extension to BINARY_EXTENSIONS in ${SELF}.`,
    ).toEqual([])
  })

  it('still skips the binaries it is meant to skip', () => {
    // The complement. If `invisible` were empty because nothing is ever skipped, the
    // check above would be scanning WASM bytes and its empty result would prove nothing.
    expect(REPO.binary.length).toBeGreaterThan(0)
    expect(REPO.binary.every(isDeclaredBinary)).toBe(true)
  })
})

describe('no committed file carries the operator location', () => {
  it('has no file copying the platform per-request object with values', () => {
    const dumps = REPO.findings.filter((finding) => finding.kind === 'committed-location')
    expect(dumps.map(render), REMEDIES).toEqual([])
  })

  it('has no statement that prints or persists the platform per-request object', () => {
    const dumping = REPO.findings.filter((finding) => finding.kind === 'dumping-statement')
    expect(
      dumping.map(render),
      'a diagnostic here sends the platform per-request object to a log, a file or a ' +
        'snapshot. On a local `wrangler dev` that object is populated from the real public ' +
        'address of the machine running it. Read the one property the code needs and pass ' +
        'that along, as ' +
        '`funnelDimensionsFrom` does. ' +
        REMEDIES,
    ).toEqual([])
  })
})

describe('the exceptions stay honest', () => {
  it('gives every exemption a stated reason, so none can be added silently', () => {
    for (const entry of EXEMPT_PATHS) expect(entry.reason.length).toBeGreaterThan(20)
  })

  it('carries no exemption that no longer matches anything', () => {
    // A dead exemption silently covers a file that no longer says what the reason claims,
    // and the next person to write into that file gets a free pass.
    const dead = EXEMPT_PATHS.filter((entry) => !REPO.used.has(entry.path)).map(
      (entry) => `${entry.path} — nothing here is a finding any more; delete this entry (was: ${entry.reason})`,
    )
    expect(dead).toEqual([])
  })
})

describe('the checker can fail — proved by mutation, not assumed', () => {
  it('flags a fixture carrying a real location', () => {
    // Synthetic values, deliberately: a plant that used the measured ones would commit
    // them, which is the act this file exists to prevent.
    const planted = ["  city: 'Metropolis',", "  postalCode: '00000',", "  asOrganization: 'Acme'"].join(
      '\n',
    )
    expect(isLocationDump(planted)).toBe(true)
    expect(valuedProperties(planted).map((property) => property.name)).toEqual([
      'city',
      'postalCode',
      'asOrganization',
    ])
  })

  it('flags a diagnostic that prints the platform object', () => {
    expect(dumpingStatements('console.log(request.cf)').length).toBeGreaterThan(0)
    expect(dumpingStatements('process.stdout.write(String(req.cf))').length).toBeGreaterThan(0)
    expect(dumpingStatements('writeFileSync(path, JSON.stringify(request.cf))').length).toBeGreaterThan(0)
  })

  it('flags a diagnostic split across lines, which a line-at-a-time scan misses', () => {
    // The shape a formatter produces, and the reason `statementsOf` exists.
    const planted = ['console.log(', "  'what did the platform send?',", '  JSON.stringify(cf),', ')'].join(
      '\n',
    )
    expect(dumpingStatements(planted).length).toBeGreaterThan(0)
    // …and the single-line reading of the same text finds nothing, which is the
    // instrument this one replaces.
    const perLine = planted
      .split('\n')
      .filter((line) => sinkPattern().test(line) && SUBJECT.test(line))
    expect(perLine).toEqual([])
  })

  it('does not join a call to something ten lines below it', () => {
    // The window bound, read directly. Without it, one unbalanced parenthesis in a
    // markdown document joins the rest of the file and the guard becomes a keyword
    // co-occurrence search over whole documents.
    const planted = ['console.log(', ...Array.from({ length: 14 }, () => "  'filler',"), '  request.cf,', ')'].join(
      '\n',
    )
    expect(dumpingStatements(planted)).toEqual([])
  })
})

describe('the checker leaves the code it is protecting alone', () => {
  it('does not flag the read that feeds the discarding path', () => {
    // `funnelDimensionsFrom`, in the shape it actually has. This is the code that reads
    // one property and throws thirty-two away; a rule that fires here is a rule that gets
    // deleted.
    const legitimate = [
      'const cf = request.cf',
      'const fromPlatform =',
      "  typeof cf === 'object' && cf !== null",
      '    ? ((cf as Record<string, unknown>)[CF_COUNTRY_PROPERTY] ?? null)',
      '    : null',
    ].join('\n')
    expect(dumpingStatements(legitimate)).toEqual([])
    expect(isLocationDump(legitimate)).toBe(false)
  })

  it('does not flag prose that discusses the hazard', () => {
    // The rule's own sentence, near enough. It names a log, a fixture and a snapshot, and
    // it is the thing that must never be a finding.
    const prose = [
      'A local workerd populates `request.cf` from the real public address of the machine',
      'running it, so every local run carries city-level geolocation into the object under',
      'test. Never dump `request.cf` into a log, a fixture, a snapshot or a committed file.',
      'The properties measured were `city`, `postalCode`, `latitude`, `longitude` and',
      '`asOrganization` — named here without their values, which is the distinction.',
    ].join('\n')
    expect(dumpingStatements(prose)).toEqual([])
    expect(isLocationDump(prose)).toBe(false)
  })

  it('leaves the ordinary vocabulary of this repository alone', () => {
    // Deliberate non-matches. `region` and `timezone` are excluded from the property list
    // for exactly these lines; if any of these start failing, the list has grown teeth it
    // should not have and the rule will be removed the first time it fires on a config.
    const benign = [
      "  region: 'bootstrap-eu',",
      "  timezone: 'UTC',",
      "  country: 'US',",
      "console.log(config.cfg)",
      "const rows = await store.sql.exec('SELECT * FROM _cf_KV')",
      "  latitude: 0,",
    ].join('\n')
    expect(dumpingStatements(benign)).toEqual([])
    // One valued property is under the cluster threshold, on purpose.
    expect(isLocationDump(benign)).toBe(false)
    expect(valuedProperties(benign).map((property) => property.name)).toEqual(['latitude'])
  })
})
