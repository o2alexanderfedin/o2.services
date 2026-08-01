import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The ledger's *reasons*, made checkable.
 *
 * `acceptance-traceability.node.test.ts` already asks whether a satisfied row is named
 * by a test. This file asks the other question, the one that went wrong on 2026-08-01:
 * **when a row says a mechanism has no production caller, does it in fact have none?**
 *
 * On that date five of twenty-two rows marked *Built, not wired* were measured against
 * source and every one was false, all in the same direction — the milestone's headline
 * metric under-reported shipped work. `requestEnrollment` and `EnrollmentAuthority` were
 * called by both node factories while two rows said they had no production caller;
 * `verifyCertificate` was reached through `PeerVerifier` while a row said
 * `discoverExecutors` was its only path; and both `serveAgent` hooks the ledger called
 * unsupplied were supplied by both factories, with `serve-agent-hooks.node.test.ts` and
 * four mutation-ledger entries already asserting so. The requirements ledger contradicted
 * the guards, and nothing noticed, because nothing reads prose.
 *
 * The project's own rule names the class: *a comment asserting a fact about every call
 * site is a claim with an expiry date.* A ledger row is that comment, kept in a document
 * a planner reads first.
 *
 * ## What is checked, and what each check is worth
 *
 * Three claim shapes are extracted from the rows themselves — nothing here holds a
 * hand-written list of symbols, because a hand-written list is the failure mode being
 * fixed. A row's own sentence is the specification:
 *
 * | Sentence in the row | Asserted here |
 * |---|---|
 * | `X has no caller` / `has no production caller` / `is never called` | no production file calls `X` |
 * | `X is reachable only through Y` | every production call of `X` is inside `Y`'s own file |
 * | ``no node supplies serveAgent's `H` hook`` | no production `serveAgent(…)` passes a real `H` |
 *
 * **The candidate must be a symbol this repository actually exports.** Rows are English,
 * and a bare `(\w+)` capture harvests `which`, `itself` and `ts` out of them. Filtering
 * against the exported-declaration set makes the extraction self-limiting: a claim about
 * a symbol that does not exist is silently not a claim, and a claim about one that does
 * is always checked.
 *
 * **What this cannot say.** It reads call syntax, not reachability. A symbol called only
 * from dead code counts as called, and a symbol reached through a dynamic dispatch this
 * regex cannot see counts as uncalled. Both errors are in the safe direction for the
 * defect being guarded — the failure being prevented is a row claiming *no* caller while
 * an obvious one exists, and an obvious one is exactly what a regex finds.
 *
 * ## The working tree, not the index — deliberately
 *
 * `vocabulary.node.test.ts` and `acceptance-traceability.node.test.ts` read `git
 * ls-files` on purpose: a traceability claim is about what somebody sees when they clone.
 * This file walks the filesystem instead, because its subject is different. It answers
 * "is the sentence I am about to commit true of the code I am about to commit", and an
 * index read cannot answer that before `git add`. That ordering hazard has already
 * produced a defect in this repository once — a verification pass reported its guards
 * green from a run that could not have read the file it was about to write.
 *
 * ## Instrument liveness
 *
 * Every assertion below is of the shape "this list is empty", which a parse that stopped
 * matching satisfies perfectly. So the parse is proved alive from the other side: known
 * *wired* symbols must be found to have callers, known-supplied hooks must be found
 * supplied, and floors catch a collapse. This repository has shipped a guard whose
 * pattern matched nothing and read green.
 *
 * Requirement ids are kept out of every `describe`/`it` title in this file on purpose:
 * a title naming an id is what `acceptance-traceability.node.test.ts` counts as strong
 * traceability, and manufacturing that from a guard which asserts nothing about the
 * requirement's behaviour would corrupt its measurement.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The ledger, at the path the project keeps it at. */
const LEDGER = '.planning/REQUIREMENTS.md'

const LEDGER_SOURCE = readFileSync(join(ROOT, LEDGER), 'utf8')

// ---------------------------------------------------------------------------
// The production corpus
// ---------------------------------------------------------------------------

/**
 * Directories that hold no source, skipped rather than read and discarded.
 *
 * `node_modules` in particular is fatal to walk: in a git worktree it is a tree of
 * symlinks into another checkout, and following it would make this file report on code
 * that is not the code under test.
 */
const SKIP_DIRS: readonly string[] = ['node_modules', '.git', 'dist', 'coverage', '.vite']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.includes(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/**
 * Production TypeScript: everything that is not a spec and not a re-export barrel.
 *
 * Barrels are excluded for `vitest.config.ts`'s stated reason — every statement in all
 * eight is `export … from`, so a symbol's appearance in one says only that the package
 * publishes it, never that anything calls it. Counting a barrel as a caller would make
 * every exported symbol look wired and this whole file vacuous.
 */
const PRODUCTION: readonly string[] = [...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'tools'))]
  .filter((path) => !path.endsWith('.test.ts'))
  .filter((path) => !path.endsWith(`${'/'}index.ts`))
  .sort()

/**
 * Comments removed before any call-site search.
 *
 * Not cosmetic — it is the difference between a measurement and a false negative in the
 * direction that matters. This codebase documents heavily, and the symbols named in
 * these rows are discussed by name in dozens of docblocks: `runResilient` appears in
 * comments in `churn.ts`, `combine.ts`, `worker-executor.ts` and `mutation-ledger.ts`
 * and is called by none of them. Without this step every claim would read as violated
 * and the file would be permanently red, which is how a guard gets deleted.
 *
 * The `[^:]` guard before `//` keeps `https://` inside a string literal from truncating
 * the rest of its line.
 */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const CODE: ReadonlyMap<string, string> = new Map(
  PRODUCTION.map((path) => [path, stripComments(readFileSync(path, 'utf8'))]),
)

/**
 * Every exported value symbol, mapped to the file that declares it.
 *
 * Values only. A row naming a type would not be making a claim about calls, and
 * `export type` has no call sites by construction.
 */
const EXPORTED: ReadonlyMap<string, string> = (() => {
  const declaration = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)/gm
  const found = new Map<string, string>()
  for (const [path, source] of CODE) {
    for (const match of source.matchAll(declaration)) {
      const name = match[1]
      if (name !== undefined && !found.has(name)) found.set(name, path)
    }
  }
  return found
})()

/**
 * Production files that call `symbol`, excluding the file that declares it.
 *
 * A declaring file's own internal use is not what a "no production caller" row is about
 * — `verifyCertificate` calls itself from `resolveReplicaSets` two functions down, and
 * counting that would make the row unsatisfiable while nothing outside `@o2/core` had
 * changed. `(?<![.\w$])` stops `LocalCapacity` matching inside `this.#localCapacity(`
 * and stops a longer identifier ending in the same characters from counting.
 */
function callSites(symbol: string): string[] {
  const declaredIn = EXPORTED.get(symbol)
  const call = new RegExp(String.raw`(?<![.\w$])(?:new\s+)?${symbol}\s*\(`)
  return PRODUCTION.filter((path) => path !== declaredIn)
    .filter((path) => call.test(CODE.get(path) ?? ''))
    .map((path) => path.slice(ROOT.length))
}

// ---------------------------------------------------------------------------
// Extracting the claims from the rows
// ---------------------------------------------------------------------------

/** A backticked-or-bare identifier, as the rows write them — both forms occur. */
const SYMBOL = String.raw`\`?([A-Za-z_$][\w$]*)\`?`

/**
 * The "nothing calls it" family.
 *
 * `(?:itself\s+)?` is not decoration: one row reads *"`runResilient` itself has no
 * caller"*, and without it the capture is the word `itself`, which is not an exported
 * symbol, so the row's only claim would be dropped and the row silently unchecked.
 */
const NO_CALLER: readonly RegExp[] = [
  new RegExp(String.raw`${SYMBOL}\s+(?:and|/)\s+${SYMBOL}\s+have no (?:production )?caller`, 'g'),
  new RegExp(
    String.raw`${SYMBOL}\s+(?:itself\s+)?(?:has no (?:production )?caller|is never called|is called only by itself)`,
    'g',
  ),
]

/** The "reachable only through" family — a claim about a path, not about a count. */
const ONLY_THROUGH = new RegExp(String.raw`${SYMBOL}\s+is reachable only through\s+${SYMBOL}`, 'g')

/**
 * The "hook is unsupplied" family.
 *
 * Scanned across *every* traceability row rather than only the *Built, not wired* ones,
 * because the two rows that carried this claim wrongly are now marked `Partial`, and a
 * guard that stopped reading them at the moment they were corrected would be a guard
 * that only ever holds claims nobody has looked at.
 */
const UNSUPPLIED_HOOK = new RegExp(String.raw`no node supplies serveAgent.s \`(\w+)\` hook`, 'g')

interface Row {
  readonly id: string
  readonly builtNotWired: boolean
  readonly noCaller: readonly string[]
  readonly onlyThrough: readonly (readonly [string, string])[]
  readonly unsuppliedHooks: readonly string[]
}

function parseRows(markdown: string): Row[] {
  const rows: Row[] = []
  for (const line of markdown.split('\n')) {
    const match = /^\| ([A-Z][A-Z0-9-]*-\d+) \| ([^|]*) \| (.*) \|$/.exec(line)
    if (match === null) continue
    const [, id, , cell] = match
    if (id === undefined || cell === undefined) continue

    const noCaller = new Set<string>()
    for (const pattern of NO_CALLER) {
      pattern.lastIndex = 0
      for (const hit of cell.matchAll(pattern)) {
        for (const candidate of hit.slice(1)) {
          if (candidate !== undefined && EXPORTED.has(candidate)) noCaller.add(candidate)
        }
      }
    }

    const onlyThrough: (readonly [string, string])[] = []
    ONLY_THROUGH.lastIndex = 0
    for (const hit of cell.matchAll(ONLY_THROUGH)) {
      const [, subject, gate] = hit
      if (subject !== undefined && gate !== undefined && EXPORTED.has(subject) && EXPORTED.has(gate)) {
        onlyThrough.push([subject, gate])
      }
    }

    const hooks = new Set<string>()
    UNSUPPLIED_HOOK.lastIndex = 0
    for (const hit of cell.matchAll(UNSUPPLIED_HOOK)) if (hit[1] !== undefined) hooks.add(hit[1])

    rows.push({
      id,
      builtNotWired: cell.includes('Built, not wired'),
      noCaller: [...noCaller],
      onlyThrough,
      unsuppliedHooks: [...hooks],
    })
  }
  return rows
}

const ROWS = parseRows(LEDGER_SOURCE)
const BUILT_NOT_WIRED = ROWS.filter((row) => row.builtNotWired)

/**
 * Rows marked *Built, not wired* whose reason names no checkable symbol, with the reason
 * each is allowed to.
 *
 * Held as a pinned set rather than waived by a wildcard, so that quietly rephrasing a
 * row until its claim stops parsing fails here instead of passing everywhere. Adding an
 * id is a deliberate act that has to be argued for in this comment.
 *
 * - `MR-02` makes no caller claim at all. Its reason is that the aggregation was
 *   measured over public shards, so nothing distinguished a map that moved data from
 *   one that did not — a statement about what an experiment covered, which no call-site
 *   search can hold.
 * - `SCHED-05` writes its claim as *"the sovereignty gate runs inside `placeWithOffers`,
 *   reachable only through `runResilient`"*. The subject is "the sovereignty gate", a
 *   concept rather than an exported symbol, so the `is reachable only through` pattern
 *   has nothing to bind. The `runResilient` half is held by six other rows.
 */
const WITHOUT_A_CHECKABLE_CLAIM: readonly string[] = ['SCHED-05', 'MR-02']

// ---------------------------------------------------------------------------
// serveAgent hooks
// ---------------------------------------------------------------------------

/**
 * Production files that call `serveAgent`, and what they pass for each hook.
 *
 * A hook is *supplied* when its value is anything but a bare string literal. That rule
 * is the repository's own convention and not an invention here: WIRE-01 requires every
 * hook to be `T | '<named-absence>'`, so a quoted string is by construction the opt-out
 * and anything else is a real implementation. It reads `capacity: admission` and
 * `index: records ?? 'serves-no-records'` as supplied, and `ledger: 'keeps-no-ledger'`
 * as not — which is exactly the distinction the rows are making.
 */
function hookSuppliers(hook: string): string[] {
  const serveAgentCall = /(?<![.\w$])serveAgent\s*\(/
  const assignment = new RegExp(String.raw`\n\s*${hook}:\s*([^\n]*)`, 'g')
  const sentinelOnly = /^'[^']*',?$/

  const suppliers: string[] = []
  for (const path of PRODUCTION) {
    const source = CODE.get(path) ?? ''
    if (!serveAgentCall.test(source)) continue
    assignment.lastIndex = 0
    for (const hit of source.matchAll(assignment)) {
      const value = (hit[1] ?? '').trim()
      if (value.length > 0 && !sentinelOnly.test(value)) {
        suppliers.push(path.slice(ROOT.length))
        break
      }
    }
  }
  return suppliers
}

// ---------------------------------------------------------------------------
// The prose in "How to read the checkboxes", parsed
// ---------------------------------------------------------------------------

/**
 * The header states five numbers as fact. Each is parsed back out of the sentence that
 * states it, so the sentence is the assertion rather than a copy of it.
 *
 * The regexes are narrow on purpose. A rewrite that drops one of these phrasings fails
 * the "the header still states its counts" case below rather than silently exempting
 * itself — which is what happened to the arithmetic these replace: the prose said 35
 * checked, down from 68, with 37 moved, and 68 − 35 is 33.
 */
const CHECKED_OF_TOTAL = /\*\*(\d+) of (\d+) are `\[x\]`\.\*\*/
const MOVED_AND_NEVER = /Of the (\d+) now unchecked, \*\*(\d+) moved\*\* and \*\*(\d+) were never checked\*\*/
const UNCHECKED_SPLIT = /\*\*The (\d+) unchecked boxes are (\d+) \+ (\d+) \+ (\d+)\*\*/
const MARKER_SPLIT = /(\d+) are \*Built, not wired\*, (\d+) are \*Partial\*/

/** The count of `[x]` before the v1.0 audit, which the header quotes as its baseline. */
const CHECKED_BEFORE_AUDIT = 68

function numbers(pattern: RegExp): number[] {
  const match = pattern.exec(LEDGER_SOURCE)
  if (match === null) return []
  return match.slice(1).map(Number)
}

/**
 * Checkbox rows of the v1 section only — the section the header's counts are about.
 *
 * The section boundary is load-bearing. `v1.1 Requirements` adds ten more boxes and six
 * more traceability rows, and folding them in is how "82" and "72" get quoted for the
 * same population in the same document.
 */
const V1_BOXES = (() => {
  const boxes = new Map<string, boolean>()
  let inV1 = false
  for (const line of LEDGER_SOURCE.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading !== null) inV1 = heading[1] === 'v1 Requirements'
    if (!inV1) continue
    const box = /^- \[([x ])\] \*\*([A-Z][A-Z0-9-]*-\d+)\*\*/.exec(line)
    if (box !== null && box[2] !== undefined) boxes.set(box[2], box[1] === 'x')
  }
  return boxes
})()

const V1_CHECKED = [...V1_BOXES.values()].filter(Boolean).length
const V1_UNCHECKED = V1_BOXES.size - V1_CHECKED

/** Leading verdict of a status cell, `**` stripped and the argument after the em dash cut. */
function verdict(cell: string): string {
  return (cell.replaceAll('**', '').split('—')[0] ?? '').trim()
}

/**
 * Traceability verdicts, counted over the v1 ids only.
 *
 * Restricted to the same population the boxes are counted over, or the split cannot
 * close: `WIRE-02`, `WIRE-03` and `WIRE-04` are `Not started` too, and counting them
 * makes the ledger's own three-way split add up to more than the boxes it describes.
 * That is the merge-two-populations error in miniature, found by this file against
 * itself on first run.
 */
const VERDICTS = (() => {
  const counts = new Map<string, number>()
  for (const line of LEDGER_SOURCE.split('\n')) {
    const match = /^\| ([A-Z][A-Z0-9-]*-\d+) \| ([^|]*) \| (.*) \|$/.exec(line)
    if (match === null || match[1] === undefined || match[3] === undefined) continue
    if (!V1_BOXES.has(match[1])) continue
    const key = verdict(match[3])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
})()

// ---------------------------------------------------------------------------
// The instrument is alive
// ---------------------------------------------------------------------------

describe('the corpus and the ledger were really read', () => {
  it('reads the ledger from the path the project keeps it at', () => {
    expect(LEDGER_SOURCE).toContain('# Requirements — o2.services P2P Native Cloud')
  })

  it('walked the production tree without following the worktree symlink farm', () => {
    // A floor, not an equality: production files legitimately grow. 112 on 2026-08-01.
    expect(PRODUCTION.length).toBeGreaterThan(80)
    expect(PRODUCTION).toContain(join(ROOT, 'packages/node/src/fabric-node.ts'))
    expect(PRODUCTION).toContain(join(ROOT, 'packages/browser/src/browser-node.ts'))
    // No spec and no barrel may enter the corpus, or a symbol's own test would count
    // as its caller and every claim below would read as violated.
    expect(PRODUCTION.filter((path) => path.endsWith('.test.ts'))).toEqual([])
    expect(PRODUCTION.filter((path) => path.endsWith('/index.ts'))).toEqual([])
    // node_modules is a symlink farm into another checkout inside a git worktree.
    expect(PRODUCTION.filter((path) => path.includes('node_modules'))).toEqual([])
  })

  it('collected the exported symbols the claims are matched against', () => {
    expect(EXPORTED.size).toBeGreaterThan(200) // 378 on 2026-08-01
    expect(EXPORTED.get('runResilient')).toBe(join(ROOT, 'packages/core/src/coordinator.ts'))
    expect(EXPORTED.get('LocalCapacity')).toBe(join(ROOT, 'packages/core/src/placement.ts'))
  })

  it('strips comments, without which every claim would read as violated', () => {
    const stripped = stripComments("const a = 1 // runResilient(x)\n/* runResilient(y) */\nconst b = 'https://x'")
    expect(stripped).not.toContain('runResilient')
    expect(stripped).toContain("'https://x'")
  })

  it('finds callers of symbols that are wired, so an empty result means something', () => {
    // The positive control. Every symbol here is one this file's own subject matter
    // proved wired on 2026-08-01; if the call-site search breaks, these go to zero and
    // the "no caller" assertions below would pass while checking nothing.
    for (const wired of [
      'requestEnrollment',
      'EnrollmentAuthority',
      'verifyCertificate',
      'LocalCapacity',
      'EgressGuard',
      'submitJob',
    ]) {
      expect(callSites(wired), `${wired} should have production callers`).not.toEqual([])
    }
  })

  it('reads serveAgent hook supply, and tells a real value from a named absence', () => {
    // Also a positive control: these were the two hooks the ledger wrongly called
    // unsupplied, and both are supplied by both node factories.
    expect(hookSuppliers('capacity')).toContain('packages/node/src/fabric-node.ts')
    expect(hookSuppliers('capacity')).toContain('packages/browser/src/browser-node.ts')
    expect(hookSuppliers('index')).toContain('packages/node/src/fabric-node.ts')
    // `ledger: 'keeps-no-ledger'` is a named absence at every call site, so the same
    // machinery must report it unsupplied — the negative control for the same reader.
    expect(hookSuppliers('ledger')).toEqual([])
  })

  it('extracted claims from the rows rather than matching nothing', () => {
    expect(ROWS.length).toBeGreaterThan(60) // 76 on 2026-08-01
    expect(BUILT_NOT_WIRED.length).toBeGreaterThan(5)
    const claims = BUILT_NOT_WIRED.reduce(
      (total, row) => total + row.noCaller.length + row.onlyThrough.length,
      0,
    )
    expect(claims).toBeGreaterThan(10) // 15 on 2026-08-01
  })
})

// ---------------------------------------------------------------------------
// The claims themselves
// ---------------------------------------------------------------------------

describe('a row claiming nothing calls a mechanism is right about it', () => {
  it('has no row naming a symbol that has since acquired a production caller', () => {
    const broken: string[] = []
    for (const row of BUILT_NOT_WIRED) {
      for (const symbol of row.noCaller) {
        const callers = callSites(symbol)
        if (callers.length > 0) broken.push(`${row.id}: ${symbol} is called by ${callers.join(', ')}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('has no row claiming a path is the only one when another path exists', () => {
    const broken: string[] = []
    for (const row of BUILT_NOT_WIRED) {
      for (const [subject, gate] of row.onlyThrough) {
        const elsewhere = callSites(subject).filter((path) => join(ROOT, path) !== EXPORTED.get(gate))
        if (elsewhere.length > 0) {
          broken.push(`${row.id}: ${subject} is reached outside ${gate} by ${elsewhere.join(', ')}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('leaves every Built-not-wired row either checkable or recorded as not', () => {
    const unchecked = BUILT_NOT_WIRED.filter(
      (row) => row.noCaller.length === 0 && row.onlyThrough.length === 0,
    ).map((row) => row.id)
    expect(unchecked.toSorted()).toEqual([...WITHOUT_A_CHECKABLE_CLAIM].toSorted())
  })
})

describe('a row claiming a serveAgent hook is unsupplied is right about it', () => {
  it('has no row calling a hook unsupplied that a production node supplies', () => {
    const broken: string[] = []
    for (const row of ROWS) {
      for (const hook of row.unsuppliedHooks) {
        const suppliers = hookSuppliers(hook)
        if (suppliers.length > 0) broken.push(`${row.id}: ${hook} is supplied by ${suppliers.join(', ')}`)
      }
    }
    expect(broken).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The header's arithmetic
// ---------------------------------------------------------------------------

describe('the header states counts that the ledger below it bears out', () => {
  it('still states them in the shapes this file parses', () => {
    // If a rewrite drops a phrasing, that is a failure here rather than a silent
    // exemption — the whole defect class is a number nothing reads.
    expect(numbers(CHECKED_OF_TOTAL)).toHaveLength(2)
    expect(numbers(MOVED_AND_NEVER)).toHaveLength(3)
    expect(numbers(UNCHECKED_SPLIT)).toHaveLength(4)
    expect(numbers(MARKER_SPLIT)).toHaveLength(2)
  })

  it('counts the checked and total v1 boxes correctly', () => {
    const [checked, total] = numbers(CHECKED_OF_TOTAL)
    expect(checked).toBe(V1_CHECKED)
    expect(total).toBe(V1_BOXES.size)
  })

  it('splits the unchecked boxes into moved and never-checked, and the split closes', () => {
    const [unchecked, moved, never] = numbers(MOVED_AND_NEVER)
    expect(unchecked).toBe(V1_UNCHECKED)
    expect(moved).toBe(CHECKED_BEFORE_AUDIT - V1_CHECKED)
    // The arithmetic this replaces did not close: it read 35 checked, down from 68,
    // with 37 moved. 68 − 35 is 33, and the missing 4 are the boxes never checked.
    expect((moved ?? 0) + (never ?? 0)).toBe(V1_UNCHECKED)
  })

  it('splits the unchecked boxes across the three markers, and that split closes too', () => {
    const [unchecked, builtNotWired, partial, notStarted] = numbers(UNCHECKED_SPLIT)
    expect(unchecked).toBe(V1_UNCHECKED)
    expect((builtNotWired ?? 0) + (partial ?? 0) + (notStarted ?? 0)).toBe(V1_UNCHECKED)
    expect(builtNotWired).toBe(VERDICTS.get('Built, not wired'))
    expect(partial).toBe(VERDICTS.get('Partial'))
    expect(notStarted).toBe(VERDICTS.get('Not started'))
  })

  it('repeats the two marker counts consistently rather than merging them', () => {
    const [builtNotWired, partial] = numbers(MARKER_SPLIT)
    expect(builtNotWired).toBe(VERDICTS.get('Built, not wired'))
    expect(partial).toBe(VERDICTS.get('Partial'))
    // The merge is the specific error being prevented: 22 + 14 was quoted as one
    // figure of 36, which described neither state and let both drift unnoticed.
    expect(builtNotWired).not.toBe((builtNotWired ?? 0) + (partial ?? 0))
  })
})
