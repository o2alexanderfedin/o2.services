import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocking, commitScope, pathFormProblems, trackedPaths } from './commit-scope.ts'
import { stripComments } from './strip-comments.ts'

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
 * **Which rows are read, and which are owed a reason.** Every row is read. A row whose
 * verdict says a mechanism is *not fully reached* — `Built, not wired` or `Partial` — is
 * additionally *owed*: it must yield at least one of the three shapes, or be named in
 * `WITHOUT_A_CHECKABLE_CLAIM` below. Until 2026-08-02 the reading was scoped to the
 * *Built, not wired* rows alone, which meant correcting a row to *Partial* removed it
 * from the guard. `NET-06` was corrected that way and its replacement sentence was
 * itself false for a day. **The marker decides what a row owes; it never decides what
 * gets read.**
 *
 * **What this cannot say.** It reads call syntax, not reachability. A symbol called only
 * from dead code counts as called, and a symbol reached through a dynamic dispatch this
 * regex cannot see counts as uncalled. Both errors are in the safe direction for the
 * defect being guarded — the failure being prevented is a row claiming *no* caller while
 * an obvious one exists, and an obvious one is exactly what a regex finds.
 *
 * **That sentence was read as covering more than it does, and the gap was a live
 * fail-open.** It is a claim about *reachability*, and it says nothing about the step that
 * runs before any of it: comment stripping. Until 2026-08-04 the stripper was a regex that
 * treated a comment opener inside a string literal as opening a comment, deleting
 * everything to the next closer anywhere in the file — under which an obvious caller reads
 * as absent and a false "no caller" row PASSES. See {@link CODE} for the measurement and
 * what replaced it.
 *
 * It also cannot tell an asserted claim from a **quoted and refuted** one. A row that
 * reproduces the false sentence it is correcting has that sentence read back as its own,
 * and goes red for saying the right thing. Found while writing this file's own
 * correction to `NET-06`; the rule for row authors is to paraphrase what a row disowns,
 * which those rows now say in line.
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

/**
 * The commit these findings are judged against, or `NO_COMMIT_SCOPE` outside a commit.
 *
 * ## This file is where defect #39 was recorded, so this is where the fix is proved
 *
 * `7717ade`: a row here said nothing calls `translationCid`, and a concurrently running
 * plan had just given it a caller. Both halves of the contradiction are real code, and
 * exactly two people can resolve it — the one editing the row and the one adding the
 * caller. Before 2026-08-04 this guard held **neither of them specifically and everybody
 * generally**: it refused the next commit to arrive, whoever that was, and the recorded
 * outcome is a planner staging only plan documents reaching for `O2_SKIP_GUARDS=1`.
 *
 * So the finding is attributed to the ledger **and** to every caller — the union rule.
 * Naming only the ledger would let the author of the caller through, which is the naive
 * narrowing and is a worse defect than the one being fixed, because it is silent.
 *
 * Absence is strict. Under `npm test`, under a verifier, or under a hook whose
 * environment did not reach the worker, every row is checked against every caller exactly
 * as before.
 *
 * ## What is NOT narrowed — rewritten 2026-08-05, defect #66
 *
 * This section used to read:
 *
 * > *"The header arithmetic below, and the 'every unreached row is checkable or recorded'
 * > set equality, are claims about `.planning/REQUIREMENTS.md` and this file alone. They
 * > cannot fire for anybody who did not edit one of those two, so they are already scoped
 * > to their own author."*
 *
 * **The second half of that was false**, and Plan 20-10 measured it on 2026-08-05. It
 * edited neither `.planning/REQUIREMENTS.md` nor this file, and was refused three times —
 * on *"collected the exported symbols the claims are matched against"* (`expected
 * undefined to be '…/packages/core/src/coordinator.ts'`), on *"extracted claims from the
 * rows rather than matching nothing"* (`expected 5 to be greater than 10`), and on the set
 * equality itself (seven `CHURN-0…`/`SCHED-03` ids appearing). The cause was Plan 20-12's
 * staged deletion of a module 20-10 does not touch. The cost was three `O2_SKIP_GUARDS=1`
 * commits — the exact outcome defect #39 exists to remove, reproduced by an exemption
 * carved out of #39's own design test.
 *
 * **The sentence was written from a belief about who could *trigger* those cases rather
 * than from a reading of what they *consume*.** {@link EXPORTED} is built by walking
 * `packages/` and `tools/`, so all three are claims about the ledger **crossed with the
 * production corpus**, and any agent who moves a production symbol can fire them. That is
 * the third instance of one shape in this repository — #38, a pre-commit trigger narrower
 * than the guard's own corpus; #39, a repo-wide corpus against a narrow commit; #66, an
 * exemption asserted rather than measured. **The population a guard acts on is not the
 * population that pays for it.**
 *
 * All three are partitioned now, and by the union rule alone rather than by a narrower
 * carve-out: a finding names the ledger, this file, and the production file the symbol
 * lives in — or *lived in at HEAD*, when the symbol's disappearance is the cause, which is
 * what {@link headExports} exists for. They still block the agent who caused them; what
 * changed is only who else they block.
 *
 * **What stays unnarrowed, and this half is verified rather than believed.** The header
 * arithmetic below reads {@link LEDGER_SOURCE} and nothing else — {@link numbers},
 * {@link V1_BOXES} and {@link VERDICTS} are each a scan of that one string, and no
 * expression under *"the header states counts that the ledger below it bears out"* reaches
 * {@link CODE}, {@link EXPORTED}, {@link PRODUCTION} or {@link headExports}. It is
 * therefore already scoped to its own author, and wrapping it would add a layer that can
 * only fail open.
 */
const SCOPE = commitScope()

/**
 * This file, in the form a commit scope prints it.
 *
 * Derived rather than written out. A literal would go stale the moment the file moved,
 * and a stale attribution path is the residual fail-open of the whole narrowing: it stays
 * well-formed, matches no commit, and silently makes every finding carrying it foreign.
 *
 * It is in the union of all three newly-partitioned findings because this file holds the
 * other half of each — the probe's expected path, the anti-vacuity floors, and
 * {@link WITHOUT_A_CHECKABLE_CLAIM}. An agent who edits one of those is answerable for
 * what it then says.
 */
const SPEC = fileURLToPath(import.meta.url).slice(ROOT.length)

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
 * Whether a repo-relative path is production TypeScript: not a spec, not a re-export
 * barrel, not a declaration file.
 *
 * Barrels are excluded for `vitest.config.ts`'s stated reason — every statement in all
 * eight is `export … from`, so a symbol's appearance in one says only that the package
 * publishes it, never that anything calls it. Counting a barrel as a caller would make
 * every exported symbol look wired and this whole file vacuous.
 *
 * **One predicate, used twice on purpose.** {@link PRODUCTION} walks the filesystem and
 * {@link headExports} scans the HEAD tree, and the two must agree about what counts as
 * production or the second cannot answer questions about the first. This repository has
 * already paid for the alternative: defect #38 was a guard whose trigger was written in a
 * different place from its corpus, and they drifted.
 */
function isProductionPath(relative: string): boolean {
  if (!relative.endsWith('.ts') || relative.endsWith('.d.ts')) return false
  if (relative.endsWith('.test.ts')) return false
  if (relative.endsWith(`${'/'}index.ts`)) return false
  return relative.startsWith('packages/') || relative.startsWith('tools/')
}

/**
 * Every TypeScript file under the two source roots, absolute, sorted.
 *
 * Walked once and filtered twice. {@link PRODUCTION} and {@link SPECS} are complements
 * over this one list rather than two independent walks, for the reason
 * {@link isProductionPath} already gives about being used from two readers: two walks can
 * disagree about what the tree contains, and a guard whose two halves disagree about its
 * own corpus is defect #38 in miniature.
 */
const TREE_TS: readonly string[] = [
  ...walk(join(ROOT, 'packages')),
  ...walk(join(ROOT, 'tools')),
].sort()

/** Production TypeScript on disk, absolute, sorted. */
const PRODUCTION: readonly string[] = TREE_TS.filter((path) =>
  isProductionPath(path.slice(ROOT.length)),
)

/**
 * The spec corpus — the population that *measures* requirements, which is exactly the
 * population {@link PRODUCTION} excludes.
 *
 * This file's older half reads production code, because its subject is *"does this symbol
 * have a caller"*. {@link REREAD_REGISTER} reads specs, because its subject is the other
 * one: *"has anything in this tree already measured what this row says is unmeasured"*.
 */
const SPECS: readonly string[] = TREE_TS.filter((path) => path.endsWith('.test.ts'))

/**
 * The production corpus with comments removed, which is what every call-site search reads.
 *
 * Not cosmetic — it is the difference between a measurement and a false negative in the
 * direction that matters. This codebase documents heavily, and the symbols named in these
 * rows are discussed by name in dozens of docblocks: `runResilient` appears in comments in
 * `churn.ts`, `combine.ts`, `worker-executor.ts` and `mutation-ledger.ts` and is called by
 * none of them. Without this step every claim would read as violated and the file would be
 * permanently red, which is how a guard gets deleted.
 *
 * ## This file's own stripper produced this file's own defect
 *
 * Until 2026-08-04 the strip was a regex pair, plus a `[^:]` special case bolted on so that
 * a `https://` inside a string literal would not truncate the rest of its line. That
 * special case is the argument against the whole approach rather than a fix for it: it
 * rescued the one input somebody noticed and did nothing for `'a // b'`, which is the same
 * bug one character over. Both are deleted now, because {@link stripComments} preserves
 * string literals outright.
 *
 * The docblock here used to say both of this scan's errors were "in the safe direction".
 * **That was false, and false about this file specifically.** A comment opener inside a
 * string literal made the old regex open a comment the source never opened and delete
 * everything to the next closer anywhere in the file — so an obvious caller read as
 * absent, and a row claiming *"X has no production caller"* PASSED while being false.
 * That is precisely the defect this file exists to prevent, produced by this file's own
 * instrument. Measured 2026-08-04: 70 such openers across 18 tracked source files, four of
 * them inside this corpus.
 *
 * What remains true is the narrower claim the sentence was reaching for: this scan reads
 * call *syntax*, not reachability, so a symbol called only from dead code counts as called
 * and one reached by dynamic dispatch counts as uncalled. Those two errors are in the safe
 * direction, because the failure being prevented is a row claiming *no* caller while an
 * obvious one exists, and an obvious one is exactly what a regex finds. The stripper was
 * never covered by that argument.
 */
const CODE: ReadonlyMap<string, string> = new Map(
  PRODUCTION.map((path) => [path, stripComments(readFileSync(path, 'utf8'))]),
)

/**
 * What an exported value declaration looks like, as one string used from two readers.
 *
 * Kept as source rather than as a `RegExp` because {@link EXPORTED} needs `gm` and
 * {@link headExports} matches one line at a time; a shared `g` instance carries
 * `lastIndex` between calls and would skip declarations non-deterministically.
 */
const DECLARATION = String.raw`^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Za-z_$][\w$]*)`

/**
 * Every exported value symbol, mapped to the file that declares it.
 *
 * Values only. A row naming a type would not be making a claim about calls, and
 * `export type` has no call sites by construction.
 */
const EXPORTED: ReadonlyMap<string, string> = (() => {
  const declaration = new RegExp(DECLARATION, 'gm')
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
 * The same map, taken at HEAD — which is the only place a symbol this commit **deletes**
 * can still be found.
 *
 * ## Why a second corpus exists at all
 *
 * This is the mechanism defect #66 turned on. {@link EXPORTED} is the working tree, so a
 * symbol a commit removes is simply absent from it, and a finding caused by that removal
 * has no production path to name. Attributing it to the ledger and this file alone would
 * let the author of the removal through with no red anywhere — the silent fail-open, and
 * strictly worse than the over-blocking it replaced. Attributing it to nothing at all
 * leaves it blocking everybody, which is the defect being fixed.
 *
 * HEAD is the right pre-image and not an approximation: `.githooks/pre-commit` computes
 * the scope as `git diff-index --cached … "$BASE"` with `$BASE` = HEAD, so the paths a
 * scope can contain are exactly the paths that differ between HEAD and the index. A file
 * this commit deletes is in the scope **and** in this map, and in nothing else.
 *
 * ## `null` means attribution refused, not attribution empty
 *
 * Every failure to read HEAD returns `null`, and every caller turns `null` into an empty
 * `paths` array — which {@link Scoped} defines as "could not attribute" and
 * {@link partition} treats as own. So a broken git, a detached or empty HEAD, or a
 * `maxBuffer` overrun all block on everything. There is no path through here that widens
 * what this guard tolerates.
 *
 * ## Two stated limits, because a false claim of totality here is the defect this fixes
 *
 * The scan is `git grep '^export' HEAD`, matched line by line against
 * {@link DECLARATION}, so it reads the file **unstripped** — a line beginning `export` at
 * column zero inside a block comment counts. {@link EXPORTED} strips comments first and
 * would not. The disagreement can only *add* a candidate declaring file, i.e. widen who
 * is blocked, never narrow it. And it reads only `packages` and `tools`, which is what
 * {@link isProductionPath} admits anyway.
 */
const headExports: () => ReadonlyMap<string, string> | null = (() => {
  let cached: ReadonlyMap<string, string> | null | undefined
  return () => {
    if (cached !== undefined) return cached
    let output: string
    try {
      // `-z` so the name is NUL-separated from the matched line: a path holding a colon
      // would otherwise be indistinguishable from the `HEAD:` tree-ish prefix git adds.
      output = execFileSync('git', ['grep', '-z', '^export', 'HEAD', '--', 'packages', 'tools'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      cached = null
      return cached
    }
    const declaration = new RegExp(DECLARATION)
    const matched: (readonly [string, string])[] = []
    for (const record of output.split('\n')) {
      const nul = record.indexOf('\0')
      if (nul < 0) continue
      const named = record.slice(0, nul)
      // The prefix is why this map is checked for path form below rather than trusted:
      // left on, `HEAD:packages/…` is well-formed to `isLsFilesForm`, matches no commit
      // scope, and every vanished-symbol finding reads as somebody else's.
      const path = named.startsWith('HEAD:') ? named.slice('HEAD:'.length) : named
      if (!isProductionPath(path)) continue
      matched.push([path, record.slice(nul + 1)])
    }
    // Sorted before first-wins, so the tie-break rule is byte-identical to the one
    // `EXPORTED` gets from iterating the sorted `PRODUCTION`.
    matched.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const found = new Map<string, string>()
    for (const [path, line] of matched) {
      const name = declaration.exec(line)?.[1]
      if (name !== undefined && !found.has(name)) found.set(name, path)
    }
    cached = found
    return cached
  }
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
  /** The leading verdict of the status cell — `Done`, `Partial`, `Built, not wired`, … */
  readonly verdict: string
  readonly builtNotWired: boolean
  readonly noCaller: readonly string[]
  readonly onlyThrough: readonly (readonly [string, string])[]
  readonly unsuppliedHooks: readonly string[]
  /**
   * Every identifier the claim patterns captured out of this row, **before** the
   * `EXPORTED` filter — so `which`, `itself` and `ts` are in here beside `submitJob`.
   *
   * Kept because the filter throws away exactly the information attribution needs. A row
   * stops being checkable when a symbol it names leaves {@link EXPORTED}, and the filtered
   * lists cannot say which symbol that was, so they cannot name the file it left. The
   * English words cost nothing: {@link declaringPathsAtHead} resolves a candidate against
   * a map of real export declarations, which is the same self-limiting rule the filter
   * applies, one step later.
   */
  readonly candidates: readonly string[]
}

function parseRows(markdown: string): Row[] {
  const rows: Row[] = []
  for (const line of markdown.split('\n')) {
    const match = /^\| ([A-Z][A-Z0-9-]*-\d+) \| ([^|]*) \| (.*) \|$/.exec(line)
    if (match === null) continue
    const [, id, , cell] = match
    if (id === undefined || cell === undefined) continue

    const candidates = new Set<string>()
    const noCaller = new Set<string>()
    for (const pattern of NO_CALLER) {
      pattern.lastIndex = 0
      for (const hit of cell.matchAll(pattern)) {
        for (const candidate of hit.slice(1)) {
          if (candidate === undefined) continue
          candidates.add(candidate)
          if (EXPORTED.has(candidate)) noCaller.add(candidate)
        }
      }
    }

    const onlyThrough: (readonly [string, string])[] = []
    ONLY_THROUGH.lastIndex = 0
    for (const hit of cell.matchAll(ONLY_THROUGH)) {
      const [, subject, gate] = hit
      if (subject !== undefined) candidates.add(subject)
      if (gate !== undefined) candidates.add(gate)
      if (subject !== undefined && gate !== undefined && EXPORTED.has(subject) && EXPORTED.has(gate)) {
        onlyThrough.push([subject, gate])
      }
    }

    const hooks = new Set<string>()
    UNSUPPLIED_HOOK.lastIndex = 0
    for (const hit of cell.matchAll(UNSUPPLIED_HOOK)) if (hit[1] !== undefined) hooks.add(hit[1])

    rows.push({
      id,
      verdict: verdict(cell),
      builtNotWired: cell.includes('Built, not wired'),
      noCaller: [...noCaller],
      onlyThrough,
      unsuppliedHooks: [...hooks],
      candidates: [...candidates],
    })
  }
  return rows
}

/**
 * The production files that declare the symbols these rows name, **here, now**.
 *
 * This is the half of the union that answers *"a row became checkable"*: a symbol that
 * was not exported and now is has a file on disk, and the agent who exported it is one of
 * the two people who can resolve the contradiction.
 */
function declaringPathsHere(rows: readonly Row[]): string[] {
  const paths = new Set<string>()
  for (const row of rows) {
    for (const candidate of row.candidates) {
      const declaredIn = EXPORTED.get(candidate)
      if (declaredIn !== undefined) paths.add(declaredIn.slice(ROOT.length))
    }
  }
  return [...paths]
}

/**
 * The production files that declared these rows' symbols **at HEAD** and no longer do.
 *
 * The other half of the union, and the one defect #66 was actually about: it answers
 * *"a row stopped being checkable"*. Deliberately restricted to candidates that are
 * **not** in {@link EXPORTED} — a symbol that is still exported did not cause the row to
 * stop parsing, and naming its file would hold an agent who changed nothing relevant.
 *
 * `null` is attribution refused, not attribution empty: it propagates from
 * {@link headExports} and every caller turns it into an empty `paths`, which blocks on
 * everything. Returning `[]` here instead would be a fail-open with no symptom.
 */
function declaringPathsAtHead(rows: readonly Row[]): string[] | null {
  const head = headExports()
  if (head === null) return null
  const paths = new Set<string>()
  for (const row of rows) {
    for (const candidate of row.candidates) {
      if (EXPORTED.has(candidate)) continue
      const declaredIn = head.get(candidate)
      if (declaredIn !== undefined) paths.add(declaredIn)
    }
  }
  return [...paths]
}

/**
 * The union rule applied to the two halves: this file, the ledger, and every production
 * path that participates — or an empty array, which means "could not attribute" and
 * therefore blocks everybody.
 */
function attribute(participants: readonly string[] | null): string[] {
  if (participants === null) return []
  return [SPEC, LEDGER, ...participants]
}

const ROWS = parseRows(LEDGER_SOURCE)
const BUILT_NOT_WIRED = ROWS.filter((row) => row.builtNotWired)

/**
 * The verdicts that assert something is *not* fully reached.
 *
 * A row carrying one of these owes the reader a reason, and the reason is what this file
 * checks. A `Done` row asserts no absence and is therefore owed nothing — it is still read
 * by the claim checks below, because a `Done` row that happens to name an uncalled symbol
 * is a contradiction worth catching, but it is not required to name one.
 */
const UNREACHED_VERDICTS: readonly string[] = ['Built, not wired', 'Partial']

/** Every row whose verdict says a mechanism is not fully reached. */
const UNREACHED = ROWS.filter((row) => UNREACHED_VERDICTS.includes(row.verdict))

// ---------------------------------------------------------------------------
// What membership costs — the re-read register
// ---------------------------------------------------------------------------

/**
 * A test title, in the form `acceptance-traceability.node.test.ts` reads them.
 *
 * Copied in shape rather than imported because that file exports nothing; the two must
 * agree about what "a spec names this requirement in a title" means, and the shared
 * definition is stated here rather than left to two regexes that look alike.
 */
const TITLE = /\b(?:describe|it|test)(?:\.\w+)*\s*(?:\([^()]*\)\s*)?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g

/**
 * Every `describe`/`it`/`test` title in each spec, joined — read once, scanned many times.
 *
 * **Comment-stripped, and this file's first run is why.** The `NET-03` entry below carries
 * a comment quoting its witness's own title, ``describe('NET-03 — …')``, as evidence of
 * what that spec asserts. Unstripped, {@link TITLE} read the quotation as a title *of this
 * file*, and the drift case reddened naming `requirements-ledger.node.test.ts` as a new
 * witness to `NET-03`. That is the same defect {@link CODE} documents one screen up — a
 * comment discussing a thing by name is not the thing — arriving in a new scanner within
 * an hour of it being written, which is the argument for stripping being the default here
 * rather than a special case bolted on later.
 *
 * The direction of the error is worth naming: unstripped, this scan **invents** witnesses,
 * so it reddens loudly rather than passing quietly. It was still wrong.
 */
const SPEC_TITLES: ReadonlyMap<string, string> = new Map(
  SPECS.map((path) => {
    TITLE.lastIndex = 0
    const source = stripComments(readFileSync(path, 'utf8'))
    const titles = [...source.matchAll(TITLE)].map((hit) => hit[2] ?? '')
    return [path, titles.join('\n')]
  }),
)

/**
 * The specs that name a requirement id **in a test title** — its witnesses.
 *
 * Titles rather than whole files, and the difference was measured rather than assumed.
 * `AUTH-03` is mentioned *somewhere* in 27 specs and title-named in 9; `NET-06` in 4 and
 * 1 respectively. A docblock that mentions an id in passing is not a spec claiming to
 * measure it, and a register whose witness lists were mention-shaped would move under
 * every unrelated comment edit — which is how a list gets satisfied mechanically. A title
 * naming an id is what `acceptance-traceability.node.test.ts` already counts as *strong*
 * traceability, and it is the same claim read from the other side.
 *
 * The boundary is not decoration: a bare `includes` would read `MR-04` out of `MR-041`.
 */
function titleWitnesses(id: string): string[] {
  const named = new RegExp(String.raw`(?<![A-Za-z0-9-])${id}(?![0-9])`)
  return SPECS.filter((path) => named.test(SPEC_TITLES.get(path) ?? '')).map((path) =>
    path.slice(ROOT.length),
  )
}

/**
 * Why a row's reason cannot be read — the three buckets the docblock above sets out, as
 * **data rather than prose**.
 *
 * Required per entry, so that *"nothing at all"* cannot be a membership reason. `SCHED-04`
 * sat here for nine days with exactly that, and its own entry said so: *"for `SCHED-04` —
 * nothing at all, the row stating in words that its marker is conservative rather than
 * descriptive"*. A row with no reason is a row waiting on a re-measurement, and it should
 * have been unable to enter this register in that state.
 */
type Because = 'experiment-not-run' | 'entry-point-not-driven' | 'tier-or-configuration'

/** One outstanding promise to re-read a row by hand. */
interface UnreadRow {
  readonly id: string
  /** Which bucket. The type is the constraint: there is no `'none'`. */
  readonly because: Because
  /** `YYYY-MM-DD`, the day this row was last read by hand against the tree. */
  readonly reread: string
  /**
   * The specs that title-named this id at that re-read, **measured, not typed**.
   *
   * This is the field that makes membership cost something. Writing it requires running
   * the scan and looking at what comes back, and what comes back is the material a hand
   * re-read consumes. `BROW-02` is the proof that this is not ceremony: on the day it was
   * added to this list its witness set was already exactly
   * `packages/node/src/peer-ledger.e2e.test.ts` — **the spec that refuted it** — and an
   * author made to write that path down would have had the refutation in hand. Nobody was
   * made to, and the row stood wrong for six days.
   */
  readonly witnesses: readonly string[]
}

/**
 * How long a promise to re-read a row by hand may stay outstanding.
 *
 * ## Sited against the four lapses this register was built from, not against a feeling
 *
 * The residue sweep of 2026-08-11 closed four rows that were stale in the **pessimistic**
 * direction — `SCHED-03`, `SCHED-04`, `SCHED-05`, `BROW-02` — and every one of them had
 * been sitting in this list unexamined: 6, 9, 9 and 6 days respectively. Fourteen is
 * longer than all four, deliberately. **A bound tighter than the observed lapse fires on
 * entries nobody has yet had a chance to re-read**, and a guard that reddens weekly across
 * fifteen rows is one that gets satisfied by editing dates, which is the theatre this is
 * supposed to avoid. Read honestly: at fourteen days this guard is *slower than a diligent
 * human and faster than nine days of silence*. It would have caught `SCHED-04` and
 * `SCHED-05` on 2026-08-16 — five days after a hand sweep found them — and the other two
 * on 2026-08-19. That is what it buys, and it is not more than that.
 *
 * ## Why this is a countdown at all, when a drift check would be cheaper to justify
 *
 * Because drift does not catch it, and that was **measured before this was written**. The
 * witness sets of all four were recomputed at the revision each was listed at and again at
 * the pre-sweep tree: `SCHED-03` 3 → 3, `SCHED-04` 1 → 1, `BROW-02` 1 → 1, and only
 * `SCHED-05` moved (1 → 2, `sovereignty-placement.node.test.ts` arriving). **One in four.**
 * Three of them were stale against evidence that was *already in the tree when the entry
 * was written*. So the defect is not that the evidence changed; it is that membership never
 * required reconciling against the evidence that already existed, and nothing counted how
 * long that had gone unreconciled. {@link witnessDrift} is kept as the cheap secondary that
 * catches the fourth case; the countdown is what covers the other three.
 *
 * ## The satisfying action, and why it is not "edit the date"
 *
 * When this fires, the finding hands over the row's verdict and its current witness specs
 * — the whole of what a hand re-read reads. Clearing it means reading those and then
 * either **ticking the row** (it leaves the population, and the set equality below makes
 * the removal compulsory) or **re-recording the re-read**, which also means re-recording
 * {@link UnreadRow.witnesses} from a fresh scan. It remains true, and is stated rather than
 * hidden, that nothing here can force a reader to actually read. What it can do is refuse
 * to let the promise be silently indefinite, which is the property that was missing.
 */
const REREAD_INTERVAL_DAYS = 14

/** Midnight UTC of a `YYYY-MM-DD` date, or `NaN` for anything this parser does not accept. */
function utcMidnight(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN
  const at = Date.parse(`${date}T00:00:00Z`)
  return at
}

/** Whole days between a recorded re-read and the day this run happens on. */
function daysOutstanding(reread: string, now: number): number {
  const at = utcMidnight(reread)
  if (Number.isNaN(at)) return Number.NaN
  const today = Math.floor(now / 86_400_000) * 86_400_000
  return Math.round((today - at) / 86_400_000)
}

/** The specs that title-name an id now but did not at its last re-read, and the reverse. */
function witnessDrift(entry: UnreadRow): { arrived: string[]; departed: string[] } {
  const now = titleWitnesses(entry.id)
  return {
    arrived: now.filter((path) => !entry.witnesses.includes(path)),
    departed: entry.witnesses.filter((path) => !now.includes(path)),
  }
}

/**
 * How large this register may grow before something reddens.
 *
 * Sited at the register's own size with **no slack**, the same way
 * `reachability-dispositions.ts` sites {@link DISPOSITION_CEILING} and for the same reason:
 * the set equality below already forces a *required* addition to arrive with a red naming
 * the id, so slack could only let a discretionary one land quietly. Raising it needs a
 * reason written next to it; lowering it is the work.
 *
 * **Lowered 15 → 14 on 2026-08-11, in the same commit that sited it.** `AOT-05` left the
 * register on the first run of the countdown that this ceiling was written beside, so the
 * ceiling follows the measurement down rather than keeping the slack the departure opened.
 * That is `OPEN_FINDING_CEILING`'s stated rule — *a ceiling with slack in it stops binding*
 * — applied on day one rather than the next time somebody notices.
 *
 * **Raised 14 → 15 on 2026-08-14 for `MR-02`, and the reason is the uncomfortable one.** A
 * raise here is supposed to be rare and is supposed to be justified, so: MR-02 left this
 * register on 2026-08-11 because its row had acquired the checkable claim *"`reduceSovereignJob`
 * has no production caller"*. Wiring the arm made that claim **false**, so the row lost its
 * checkability *by having its claim satisfied* — a direction this register had no prior
 * instance of, and one that a rule reading "rows only ever become more checkable" does not
 * anticipate.
 *
 * The residual gap is genuinely unphraseable as a symbol claim: MR-02 says *each **owner***,
 * every entry point runs one owner, and no exported symbol names "two owners". So the
 * exemption is the correct device rather than a way of dodging the check — and the honest
 * cost of using it is this +1, taken visibly instead of by finding some symbol to point at.
 *
 * **Lowered 15 → 14 the same day, once MR-02's gap was closed rather than exempted.** The
 * driver now runs two owners, so the row is `Done` and its entry is gone. The ceiling follows
 * the measurement straight back down rather than keeping the slack the departure opened —
 * `OPEN_FINDING_CEILING`'s rule that *a ceiling with slack in it stops binding*, applied within
 * the hour instead of the next time somebody notices.
 */
const REREAD_REGISTER_CEILING = 14

/**
 * ## The rule this list encodes
 *
 * **A row that says a mechanism is not fully reached is either read by this file or
 * named here.** Nothing in between. The three shapes above are the whole of what can be
 * read; a row whose reason is written in concepts, pronouns, dates or file paths names
 * no exported symbol, and no call-site search can hold it. Such a row is not forbidden —
 * several of them are saying something a call-site search could not express — but it
 * must appear here, because **an id in this list is a promise to re-read that row by
 * hand.** A row that is neither parsed nor listed is a claim nobody checks and nobody
 * knows nobody checks, which is the failure this file exists to prevent.
 *
 * Held as a pinned set rather than waived by a wildcard, so that quietly rephrasing a
 * row until its claim stops parsing fails here instead of passing everywhere.
 *
 * ## Why the list grew from two to seventeen on 2026-08-02
 *
 * It did not grow. It was **two-thirds hidden**, and the hiding had a mechanism: the
 * claim checks below used to iterate the *Built, not wired* rows only, so a row moved to
 * *Partial* left the guard's population entirely. Correcting a row was therefore the act
 * that exempted it — silently, and in the direction of looking more checked.
 *
 * That is not hypothetical. `NET-06` was moved to *Partial* on 2026-08-01 and its
 * replacement sentence called `discoverCandidates` callerless; `bin/bench.ts:680` calls
 * it, and this file read green over that for a day because the row was no longer
 * *Built, not wired*. `SCHED-03` and `SCHED-04` went stale the same way. Widening the
 * population to every row is what found them, and the seventeen below are what the old
 * scope was concealing.
 *
 * ## The entries, by the reason each cannot be read
 *
 * - **A statement about what an experiment covered.** `MR-02` — the aggregation was
 *   measured over public shards, so nothing distinguished a map that moved data from one
 *   that did not. `AOT-03` and `BENCH-06` — a cross-machine half descoped and unmeasured.
 *   No call-site search can hold "this was never tried".
 * - **A statement about which entry point, not which caller.** `NET-06`, `AOT-05`,
 *   `MR-03`…`MR-07`. The symbol has callers and the row says so; what is open is that the
 *   caller is behind a flag, or is a test rather than a page, or is one of two merge paths.
 *
 *   **`SCHED-05` was the clearest example of this bucket and is no longer in it, which is
 *   worth keeping rather than deleting.** It read: *`eligibleNodes` is called by both
 *   placers, and the open leg is that no entry point ever labels a shard `sovereign` — a
 *   claim about an argument value, which this file does not read.* Every clause of that is
 *   still true of the mechanism and the middle one stopped being true of the tree in Phase
 *   23, when `bin/bench.ts` began submitting `label: 'sovereign'`. So the entry sat here,
 *   correctly exempt from a call-site check, while the row it exempted went stale in the
 *   one way a call-site check could never have caught — **which is what this list is for
 *   and also its whole cost**: an id here is a promise to re-read the row by hand, and that
 *   promise went unkept for five days. The row is `Done` as of 2026-08-11 and the id is
 *   gone from the list below.
 *
 *   **`VER-08` and `AUTH-05` were here for one day and are not any more, which is the
 *   whole lifecycle this list is supposed to have.** Both carried a checkable claim —
 *   *`attestResults` has no production caller* — until Plan 19-15 composed that wrapper
 *   at both node factories and made it false; correcting each row on 2026-08-03 left it
 *   saying only the argument-value claim it had always also said, so both were added
 *   here in the same commit. Plan 19-09 then satisfied that claim too — a sovereign
 *   shard pinned to a real owner's user key, placed on a discovered replica set of two
 *   `bin/agent.ts` processes — so both rows are now `Done`, are no longer *unreached*,
 *   and dropping out of this list is the assertion below noticing. **A row losing its
 *   checkable claim by being *satisfied* must be added here in the same commit, and
 *   removed in the same commit as the tick.** Neither direction can pass silently: the
 *   check is a set equality.
 *
 *   `VER-09` and `VER-10` went the other way in the same 19-15 commit and are
 *   deliberately *not* here: their remaining absence is the display half, and it is
 *   expressible as a call-site fact — `describeAttestation` renders the three labels for
 *   a human and nothing calls it.
 * - **A statement about a tier or a configuration.** `AUTH-02`, `AUTH-03`, `AUTH-04`,
 *   `NET-03`, `AOT-04`. Both tiers construct the mechanism; what differs is a host
 *   requirement or a measurement not yet taken. A row that reports no absence has no
 *   absence to name.
 *
 *   **`SCHED-04` was the degenerate member of this bucket and closed on 2026-08-11.** Its
 *   entry read *"for `SCHED-04` — nothing at all, the row stating in words that its marker
 *   is conservative rather than descriptive"*, and that is the one case where membership
 *   here was a **countdown rather than a category**: a row with no absence to name is a row
 *   waiting on a re-measurement, and this list has no field for how long one has waited. It
 *   waited nine days. Re-measured and ticked; the id is gone from the list below.
 *
 *   **`AUTH-03`'s membership here was true by accident until 2026-08-06, and the audit is
 *   worth keeping.** Its row *did* name an absence — *"`delegate`, `CapabilitySupplier`
 *   and `RemoteExecutor.execute`'s supplier branch have a production adapter and zero
 *   production callers"* — and that absence had become false when Phase 23 gave the leg a
 *   caller. Nothing failed. `23-VERIFICATION.md` ran the two {@link NO_CALLER} patterns
 *   against the literal row and both returned **zero matches**: three subjects in one
 *   clause, and *"zero production callers"* rather than *"has no production caller"*, are
 *   outside the shapes `parseRows` reads. So the row sat exempt under a stated reason that
 *   was not its real one, which is this repository's most-repeated defect wearing a
 *   different coat — the population a guard acts on was not the population that paid for
 *   it. The row's prose was corrected in the same commit as this note and **no longer
 *   claims a call-site absence at all**, which is what makes its membership here honest
 *   rather than lucky. What remains unproven for `AUTH-03` is a measurement (the browser
 *   factory's authorizer) and a pending ruling (Phase 22 on entry-point reachability) —
 *   genuinely this bucket. **If a future edit reintroduces a call-site claim to that row,
 *   phrase it as ``` `X` has no production caller ``` so the parser can read it, and
 *   delete `AUTH-03` from this list in the same commit.**
 *
 * `BROW-02` **was** deliberately not here, on the stated ground that its reason was the
 * hook shape: no node supplied `serveAgent`'s `ledger` hook, and the third shape read
 * that. Plan 20-02 satisfied it — both node factories now build a real
 * `StartOutcomeLedger` and record their own start row into it — so the row lost its only
 * checkable claim **by being satisfied**, which is the direction this list's own rule
 * says must be recorded in the same commit. Its remaining absence was then a measurement
 * not yet taken (a tab showing counts it could only have obtained from a peer, Plan
 * 20-06), which put it in the tier-or-configuration bucket rather than in any of the
 * three call-site shapes. Left visible rather than rewritten, because a reader who finds
 * only the new sentence cannot tell a row that never had a claim from one that closed the
 * claim it had.
 *
 * **And the measurement had been taken.** `packages/node/src/peer-ledger.e2e.test.ts`
 * quotes Phase 20 criterion 5 in its own header and reads two foreign browser families
 * off a live page in each of two engines. The row went on citing 20-06's absence, and
 * this entry went on citing the row — **an id here is a promise to re-read the row by
 * hand, and the promise was the only thing holding it.** That is the third such lapse
 * recorded on this list in one sweep (`SCHED-04`, `SCHED-05`, `BROW-02`), which is a fact
 * about the device rather than about the three rows: this list has no expiry and nothing
 * counts how long an entry has sat. `BROW-02` is `Done` as of 2026-08-11 and is removed
 * below.
 *
 * ## What membership costs, from 2026-08-11 — the sentence above is now enforced
 *
 * *"An id in this list is a promise to re-read that row by hand"* was, until this date,
 * **prose with no mechanism under it**, and the paragraph immediately above says what that
 * cost: four rows stale in the same sweep, all four in the **pessimistic** direction — a
 * `[ ]` too modest, which no other guard in this repository can see, because nothing fails
 * when a row under-claims. This is no longer a list of ids. Every entry is an
 * {@link UnreadRow}: a bucket ({@link Because}, so *"nothing at all"* cannot be a reason),
 * a dated re-read, and a **measured** witness list. Three cases below hold it —
 * {@link REREAD_INTERVAL_DAYS} bounds how long a promise may stay outstanding,
 * {@link witnessDrift} reddens when the evidence under a row moves, and the register is
 * well-formed and capped at {@link REREAD_REGISTER_CEILING}.
 *
 * ## Why this defect landed here and in no sibling register — checked, not assumed
 *
 * The four registers that behave alike were read on 2026-08-11 against **what their guards
 * consume**, not against what their docblocks claim, and none of them has this property:
 *
 * | Register | What re-derives its members every run |
 * |---|---|
 * | `reachability-dispositions.ts` `DISPOSITIONS` | `reachability-guard.node.test.ts` re-derives the whole `global-object-hop` class and reddens in **both** directions; a disposed symbol that becomes reachable is `stale`, one that stops being a callable barrel export is `orphaned`; ceiling with no slack |
 * | `ACCEPTED_SIGNATURE_COMPARISONS` | exact set equality against a live scan, each entry anchored on **source text** rather than a line, plus a stale-entry case and a ceiling sited at size + 1 |
 * | `CHECKBOXES_WITHOUT_A_ROW` | holds **no members at all**, kept as an empty set under an equality so that one appearing fails |
 * | `EXPECTED_ABSENT` | not hand-maintained — derived from `FINDINGS`, so membership is not a choice |
 *
 * `acceptance-traceability.node.test.ts`'s `FINDINGS` is the near miss and is worth naming
 * rather than quietly passing over. Its entries carry a `found` date that **nothing reads**,
 * and its docblock states a hand obligation — *"label the test, or clear the box"* — with no
 * bound on it, which is this defect's shape. But its substantive claim, *"no tracked test
 * file names this id"*, is re-derived every run by an exact set equality, so the claim
 * cannot go quietly false; only the remediation is unbounded. **That is a different and
 * smaller thing, and it was left alone deliberately** — a countdown there would redden on
 * work rather than on a lapse, which is the theatre this file is trying not to build.
 *
 * **The structural reason, which is why no sibling needed fixing.** Every one of those
 * registers holds entries carrying a claim a machine re-derives, so staleness reddens by
 * construction. This register is the one whose **membership criterion is literally that the
 * entry's claim cannot be machine-checked**. It could not inherit the others' defence, and
 * the defect landed in the only place with no defence available. That is not a coincidence
 * to guard against everywhere; it is the definition of this set, and the countdown is the
 * substitute for a re-derivation that cannot exist.
 *
 * ## The seed dates are derived, not invented
 *
 * No entry here recorded when it was last examined, because until 2026-08-11 there was no
 * field to record it in. Inventing one would be the worst available option — a fresh date
 * on every row would reset all fifteen countdowns to zero and make the first sweep vacuous,
 * which is exactly the shape of guard this file exists to refuse. So each `reread` is
 * seeded with **the day that row's traceability line was last edited in
 * `.planning/REQUIREMENTS.md`**, derived by scanning `git log -p` over that file for the
 * last commit to add a line matching `| <id> |`. That is the last date somebody
 * demonstrably had the row in front of them, it is a fact about the history rather than a
 * guess, and it is the conservative choice in the direction that matters: a row edited
 * without a re-read reads here as *more* recently examined than it was, so this register
 * understates its own backlog rather than overstating it.
 */
const REREAD_REGISTER: readonly UnreadRow[] = [
  // ── Added 2026-08-05 by Plan 20-12 and RESOLVED the same day by Plan 20-13 ──────────
  //
  // Seven ids stood here for a few hours: `CHURN-01`…`CHURN-06` and `SCHED-03`. They did
  // not lose their claim by being satisfied and did not lose it by being rephrased — they
  // lost it because **the symbol they named was deleted.** Every one read *"`runResilient`
  // has no caller"* or similar, 20-12 removed `runResilient` and its module under WIRE-04,
  // `EXPORTED` stopped holding the name, and `parseRows` stopped extracting the claim. That
  // was this list doing its job loudly rather than seven rows going quietly unread, and
  // 20-12 recorded it as a hand-over with the standing rule attached: **delete them in the
  // same commit that gives them a claim again.**
  //
  // Five are gone, in the two different ways the rule allows:
  //
  // - `CHURN-01`, `CHURN-02`, `CHURN-05` and `CHURN-06` are no longer *unreached* at all.
  //   Their verdicts are `Done`, so they leave this list by leaving the population — the
  //   set equality below is what makes that removal compulsory rather than optional.
  // - `CHURN-03` is still *Partial* and now carries a claim a search can read: its row says
  //   `checkpointChain` and `remainingWork` have no production caller, which is true and is
  //   the shape of what is genuinely still unwired about it — a checkpoint mechanism whose
  //   history nothing walks, because no production submitter supplies `SubmitOptions.
  //   checkpoints` at all.
  //
  // Two stay, with the reason each stays rewritten rather than inherited:
  //
  // - `CHURN-04` — its open leg is an **argument value**: renewal is conditional on
  //   `JobSpec.admit`, which is optional, and only `bin/bench.ts --discover` — off by
  //   default — supplies it in production. Every symbol the row names has a caller. That is
  //   the `SCHED-05` bucket exactly, one requirement over.
  // - `SCHED-03` stood here on the same reasoning — its open leg was a **tier**, the browser
  //   factory's refusal never having been driven — and it is **REMOVED on 2026-08-11**,
  //   because the row is `Done` and has left the *unreached* population. The sentence that
  //   kept it here was quoted, as the thing it came to refute, in the header of the very
  //   spec that closed it (`tab-refusals.e2e.test.ts`), and neither this list nor the row
  //   noticed for five days. Fourth instance in one sweep. **An id here is a promise to
  //   re-read a row by hand, and nothing in this file counts how long the promise has been
  //   outstanding** — which is the one thing that would have caught all four.
  // **Re-read 2026-08-16, and the leg this row was kept for is CLOSED — the entry stays for
  // a narrower reason.** The sentence above says the open leg is an *argument value*: renewal
  // is conditional on `JobSpec.admit`, and *"only `bin/bench.ts --discover` — off by default —
  // supplies it in production"*. That stopped being true on 2026-08-16.
  // `browser/demo/main.ts#runColouring` now passes `admit: rpcAdmission(node.rpc)` with no flag
  // in front of it, so an ordinary visitor's cube ladder probes lease holders and renews on
  // evidence. The owner's 2026-08-15 ruling — a capability reachable only behind an
  // off-by-default flag is not shipped — is what makes that a change of state rather than a
  // second instance of the same one.
  //
  // **What is still not driven, stated so the row is not read as closed.** The *renewal* the
  // probe grants is proven by `packages/core/src/lease.test.ts` and by `submit.test.ts`'s
  // renewal pair, both against fixtures. Nothing measures a renewal happening on a live tab
  // fabric — that needs a peer tab held past a lease deadline while still executing, which no
  // spec in this repository stages. So `because` reads true on its second word only, exactly
  // as the AUTH-02 row below does, and the promise this id carries is now to drive *that*.
  //
  // The new witness is the weaker of the two on purpose and says so in its own docblock: it is
  // a source-text reading of the shipped call, not a measurement of a renewal. It is here
  // because it is the only instrument that sees whether a production caller still exists, and
  // that is the fact the previous sentence got wrong for eleven days.
  {
    id: 'CHURN-04',
    because: 'entry-point-not-driven',
    reread: '2026-08-16',
    witnesses: [
      'packages/core/src/lease.test.ts',
      'packages/browser/src/colouring-surface.node.test.ts',
    ],
  },
  // ── The pre-existing entries ───────────────────────────────────────────────────────
  // **Re-read 2026-08-14, and the promise this entry carries was partly discharged rather
  // than renewed.** `because: 'tier-or-configuration'` named a real thing: `PeerVerifier`
  // sat in `@o2/node`, `@o2/browser` does not depend on that package, so the browser tier
  // reached no verdict about any peer and the asymmetry was a package boundary. The module
  // moved to `@o2/libp2p` on 2026-08-14 and a tab now verifies on identical terms.
  //
  // **The entry stays, and the reason it stays is not the one it was written for.** What
  // remains open is a *configuration* fact and no longer a tier one: a tab that passes no
  // `trustedIssuers` still takes blocks from every connected peer — stated, not defaulted,
  // because a fail-closed default would empty the block source of the relay a fresh tab's
  // only peer is. So the row keeps a legitimately unreached leg, and `because` still reads
  // true on its second word only. Rewriting it to `configuration` alone is the ledger
  // owner's call, not this file's, because the row's verdict lives in `REQUIREMENTS.md`.
  //
  // Two witnesses arrived with the move, and the second is the weaker of the two on purpose
  // — see its own docblock. `peer-verifier.browser.test.ts` measures the verifier in three
  // real engines; `browser-node-contract.node.test.ts` counts the composition literal.
  //
  // **That sentence used to end "…which is the only instrument that sees which thunk the
  // block source was handed", and it stopped being true on 2026-08-14.**
  // `tab-pinning.e2e.test.ts` sees it *behaviourally*: a live tab pinning an issuer is
  // asked for a block held only by a connected-but-unverified peer, and does not get it.
  // The source-text count is still worth keeping — it fails faster and names the literal —
  // but it is no longer the only thing standing between that line and a silent revert.
  // Measured, not asserted: reverting the thunk to `() => transport.peers` reddens the e2e
  // with *"expected 48 to be null"*.
  //
  // **What re-reading the row against the new spec established, recorded because it is a
  // gap and not a tick.** AUTH-02's own text asks that a node a person can run verify a
  // certificate. A Node agent does, given `--trusted-issuer`. A browser tab now does too —
  // `demo/main.ts` passes `trustedIssuers` from `enrolledIssuer` — **but only from the
  // start after it has enrolled**, and the demo page carries no enrolment UI at all
  // (`index.html` names `enrollment` zero times). So on the visitor path the argument is
  // always empty and the tab still pins nobody. The call site is real and measured; the
  // visitor's *route to it* is not built.
  {
    id: 'AUTH-02',
    because: 'tier-or-configuration',
    reread: '2026-08-14',
    witnesses: [
      'packages/browser/src/browser-node-contract.node.test.ts',
      'packages/browser/src/peer-verifier.browser.test.ts',
      'packages/core/src/enrollment.test.ts',
      'packages/node/src/bench-admission.node.test.ts',
      'packages/node/src/browser-enrollment.e2e.test.ts',
      'packages/node/src/certificate-verification.node.test.ts',
      'packages/node/src/enrol-through-a-closed-door.node.test.ts',
      'packages/node/src/gated-admission.e2e.test.ts',
      'packages/node/src/gated-seed.e2e.test.ts',
      'packages/node/src/peer-dial.node.test.ts',
      'packages/node/src/peer-gate.node.test.ts',
      'packages/node/src/peer-verifier.node.test.ts',
      'packages/node/src/relay-admission.node.test.ts',
      'packages/node/src/tab-pinning.e2e.test.ts',
    ],
  },
  {
    id: 'AUTH-03',
    because: 'tier-or-configuration',
    reread: '2026-08-11',
    witnesses: [
      'packages/core/src/capability.test.ts',
      'packages/net/src/capability-dispatch.test.ts',
      'packages/net/src/combine.test.ts',
      'packages/net/src/distributed.test.ts',
      'packages/node/src/browser-capability.e2e.test.ts',
      'packages/node/src/capability-dispatch.node.test.ts',
      'packages/node/src/fabric-node.node.test.ts',
      'packages/node/src/serve-agent-hooks.node.test.ts',
      'packages/node/src/tree-reduce-agents.node.test.ts',
    ],
  },
  {
    id: 'AUTH-04',
    because: 'tier-or-configuration',
    reread: '2026-08-06',
    witnesses: [
      'packages/browser/src/idb-issuance.browser.test.ts',
      'packages/core/src/enrollment.test.ts',
      'packages/net/src/enrol-agent.test.ts',
      'packages/node/src/enrol-through-a-closed-door.node.test.ts',
      'packages/node/src/enrollment-cost.node.test.ts',
      'packages/node/src/enrollment-dos.node.test.ts',
      'packages/node/src/enrollment.node.test.ts',
      'packages/node/src/enrolment-residual.node.test.ts',
      'packages/node/src/fs-issuance.node.test.ts',
    ],
  },
  // **Flagged by the first run of this register at 16 days outstanding, re-read
  // 2026-08-11, and it STANDS.** The row says the relay is browser-dialable and that
  // AutoTLS needs a public host. Its one witness carries the first half by name —
  // `describe('NET-03 — a listening node presents a browser-dialable address')` in
  // `relaying.node.test.ts`, which asserts a WebSockets listen address and no `/certhash/`
  // literal. The second half was checked in the direction that matters, the pessimistic
  // one: `git grep -il 'autoTLS|libp2p.direct|letsencrypt|acme'` over `packages` and
  // `tools` returns three files and **none of them is an implementation** — two generated
  // base64 fixtures and one protocol spec whose match is incidental. No `@ipshipyard/
  // libp2p-auto-tls` dependency exists in any `package.json`. The row is not stale; the
  // open leg is a hosting decision, which is what `tier-or-configuration` means.
  {
    id: 'NET-03',
    because: 'tier-or-configuration',
    reread: '2026-08-11',
    witnesses: ['packages/node/src/relaying.node.test.ts'],
  },
  {
    id: 'NET-06',
    because: 'entry-point-not-driven',
    reread: '2026-08-05',
    witnesses: [
      'packages/core/src/discovery.test.ts',
      'packages/net/src/discovery.test.ts',
      'packages/node/src/static-rendezvous.e2e.test.ts',
    ],
  },
  {
    // **Re-read 2026-08-14, `because` corrected, and the row's own text is what is now in
    // question rather than the tree.**
    //
    // The open clause is *"every participant computes an identical tree with no consensus is a
    // claim about two participants deriving the same tree, and the page has one requestor
    // deriving it once"* — a statement about an experiment nobody has run, hence
    // `'experiment-not-run'`. It is also an experiment nobody **can** run as the row is
    // written: `deriveReduceTree` has exactly one production call site and it is inside the
    // requestor, and the projection closure never crosses a wire, so no second participant can
    // compute even one leaf CID to derive from. The row additionally says the tree is derived
    // *"from sorted partial CIDs"*, and the sort is on `contributorId NUL cid` — the contributor
    // string, with the CID only breaking ties (`reduce.ts` `leafId`).
    //
    // Under the owner ruling of 2026-08-14 the property that sentence protects is **routing
    // stability and dedup**, not fraud prevention, so the resolution is a reword on VER-03's
    // precedent rather than an experiment. Drafted and returned for the owner; not applied.
    id: 'MR-04',
    because: 'experiment-not-run',
    reread: '2026-08-14',
    witnesses: [
      'packages/core/src/reduce.test.ts',
      'packages/net/src/reduce-job.test.ts',
      'packages/node/src/late-combine.node.test.ts',
      'packages/node/src/tree-reduce-agents.node.test.ts',
    ],
  },
  {
    id: 'MR-06',
    because: 'entry-point-not-driven',
    reread: '2026-08-10',
    witnesses: [
      'packages/core/src/reduce.test.ts',
      'packages/net/src/combine-wire.test.ts',
      'packages/net/src/combine.test.ts',
      'packages/node/src/tree-reduce-agents.node.test.ts',
    ],
  },
  // **Re-read 2026-08-11 at 15 days outstanding, and it stays.** The row was read against
  // its witness. `harness.test.ts:17` does exercise `isSameMachine`, `machineLabel` and
  // `hostCount`, so the row's *same-machine* claim — the label stays derived from the
  // inventory rather than declared — is genuinely measured. That is the half that is met.
  //
  // **It does not discharge the promise, and the reason is worth stating because it is the
  // tempting error.** What holds this row open is the *distinct-machine* half, and the row
  // itself says why that is structural rather than pending: a same-host run has one CPU,
  // one V8 and one libc, so the variables a cross-machine benchmark exists to expose are
  // held constant by construction. No spec can acquire that claim by being written. Citing
  // the same-machine witness to retire this entry would be escaping the register on the
  // strength of the half that was never in question — the overclaim this file exists to
  // catch. So: re-recorded, not removed, and not ticked.
  //
  // **Second witness arrived 2026-08-14, and the `reread` date deliberately did not move.**
  // `bench-fabric.node.test.ts` began title-naming this row because the same-machine half
  // acquired something it did not have on 2026-08-11. The re-read above found that half
  // "genuinely measured" on the strength of `harness.test.ts`, which exercises
  // `machineLabel` over *synthetic* inventories — and that was true of the renderer and
  // false of the run. `bin/bench.ts` built the published `Inventory` from a **one-element
  // array** over its own `hostname()`, with no code path able to add a second host, so
  // `hostCount` was `1` by construction and the published SAME-MACHINE label could not have
  // come out any other way. Replacing `machineLabel(report.inventory)` with the literal
  // string it always produced would have left every published byte identical and no spec
  // red. What is now measured is the missing half of the same-machine claim: agents
  // announce their own host, the driver folds the announcements, and the new witness
  // watches the label follow them.
  //
  // **The date stays at 2026-08-11 on purpose.** Bumping it would buy fourteen days of
  // silence on the strength of work that changed nothing about what holds this row open —
  // the distinct-machine half is still structural, still unmeasured, and still the only
  // reason the row is here. A register whose countdown can be reset by improving the half
  // that was never in question is a register that rewards the overclaim it exists to catch.
  // So: witness added, clock untouched.
  {
    id: 'BENCH-06',
    because: 'experiment-not-run',
    reread: '2026-08-11',
    witnesses: ['packages/bench/src/harness.test.ts', 'packages/node/src/bench-fabric.node.test.ts'],
  },
  // **The one entry with no witness at all**, and it is the honest reading rather than a
  // gap in the scan: no spec in this repository title-names `AOT-03`. Every other entry
  // here has at least one spec claiming to measure its requirement, so its promise is a
  // promise to reconcile against something. `AOT-03`'s is a promise to reconcile against
  // nothing, which is what *"a cross-machine half descoped and unmeasured"* means when it
  // is read off the tree instead of off the row.
  //
  // **Re-read 2026-08-11 at 15 days outstanding, and it stays — for BENCH-06's reason.**
  // The scan above is by *title*, and it is right that no spec title-names `AOT-03`. But
  // the row's substantive claim is not unmeasured: `CROSS_MACHINE_BLIND_SPOT` stays on
  // every artifact, and `tools/aot/lift.node.test.ts` asserts exactly that — `:2678`
  // `expect(artifact.blindSpots).toContainEqual(CROSS_MACHINE_BLIND_SPOT)`, with `:977`
  // pinning it as the *only* spot and `:907` checking the note's own words.
  //
  // **That is the blind spot being declared, not the cross-machine half being measured**,
  // and the two are opposites: the assertion's whole content is that this artifact has
  // never been compared against a second machine. A row cannot leave this register by
  // pointing at a test which certifies that the thing it promises remains unmeasured.
  // Re-recorded. The witness list stays empty deliberately — writing `lift.node.test.ts`
  // into it would record a measurement of the open half that does not exist.
  {
    id: 'AOT-03',
    because: 'experiment-not-run',
    reread: '2026-08-11',
    witnesses: [],
  },
  {
    id: 'AOT-04',
    because: 'tier-or-configuration',
    reread: '2026-08-11',
    witnesses: [
      'packages/aot/src/admission.test.ts',
      'packages/aot/src/wasi-executor.test.ts',
      'packages/node/src/aot-dispatch.node.test.ts',
      'packages/node/src/fabric-node.node.test.ts',
    ],
  },
  // `AOT-05` was here until 2026-08-11 and is **REMOVED**, and it is the first id this
  // register itself closed rather than a hand sweep. Flagged at 15 days outstanding; the
  // re-read found its open leg was a call-site fact all along and had merely never been
  // phrased as one — the demo loads its kernel from `primes-bytes.ts`/`pi-bytes.ts` and
  // `loadArtifact` has no production caller at all, its only two occurrences outside the
  // barrel being inside `streaming-load.ts`, which declares it. The row says so now, in
  // the shape `parseRows` reads, so `AOT-05` leaves by the first of the two exits the rule
  // allows — a row acquiring a checkable claim. **This is the whole point of the device:
  // nothing about the tree changed, and the row had been exempt from a check it could
  // always have passed.**
]

/**
 * The ids alone, which is what the set equality against the ledger reads.
 *
 * Derived rather than kept beside {@link REREAD_REGISTER}, so the two cannot disagree —
 * a second hand-maintained list of the same ids is the defect this whole file is about,
 * one level up.
 */
const WITHOUT_A_CHECKABLE_CLAIM: readonly string[] = REREAD_REGISTER.map((entry) => entry.id)

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
  // **Seeded at zero, and that is not a convenience.** A bucket can legitimately empty —
  // *Not started* did on 2026-08-11, when VER-02 became *Partial* — and an unseeded map
  // answers `undefined` there, which `toBe(0)` fails on. Reading `?? 0` at each call site
  // would have been the other repair and is the wrong one: it makes a **typo'd verdict
  // string** indistinguishable from an empty bucket, so a row whose marker was misspelled
  // would take its whole bucket to zero and the prose would be "corrected" to match. The
  // three keys are the three markers the header defines, written once, so an unseeded key
  // appearing in the table is still a count of its own and still has to be accounted for.
  const counts = new Map<string, number>([
    ['Built, not wired', 0],
    ['Partial', 0],
    ['Not started', 0],
  ])
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

/**
 * Symbols whose declaring file is pinned, so an `EXPORTED` that stopped collecting is a
 * failure here rather than a silent pass everywhere.
 *
 * Repo-relative, because that is the form a commit scope is in and these paths are
 * attributed with. `runResilient` → `packages/core/src/coordinator.ts` stood in the first
 * slot until 2026-08-05, when Plan 20-12 deleted that module under WIRE-04 and the
 * reading became `undefined`. Re-sited on `submitJob`, which is the symbol that replaced
 * it and the one every claim about the job path now has to be read against — a probe
 * naming a deleted module measures nothing.
 */
const EXPORT_PROBES: readonly (readonly [string, string])[] = [
  ['submitJob', 'packages/core/src/job/submit.ts'],
  ['LocalCapacity', 'packages/core/src/placement.ts'],
]

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
    const findings: { paths: string[]; line: string }[] = []
    // A corpus collapse names no path and *cannot*: nothing here can say whose absence
    // took the count under the floor. An empty `paths` is `Scoped`'s "could not
    // attribute", which `partition` treats as own — so this one blocks everybody, which
    // is the right answer when the instrument is dead rather than merely disagreeing.
    if (EXPORTED.size <= 200) {
      // 378 on 2026-08-01, 458 on 2026-08-05.
      findings.push({
        paths: [],
        line: `EXPORTED holds ${EXPORTED.size} symbols, under the floor of 200 — the corpus collapsed`,
      })
    }
    for (const [symbol, expected] of EXPORT_PROBES) {
      const declaredIn = EXPORTED.get(symbol)
      const actual = declaredIn === undefined ? undefined : declaredIn.slice(ROOT.length)
      if (actual === expected) continue
      findings.push({
        // The union. `expected` is where the symbol was when the probe was written, so
        // the agent deleting or renaming that file holds one half; this file holds the
        // other, because the expected path is a literal here. `actual` joins when the
        // symbol merely moved rather than vanished.
        //
        // **This is the exact shape of the 2026-08-05 refusal.** The probe then read
        // `runResilient` → `packages/core/src/coordinator.ts`; that path was in Plan
        // 20-12's commit, which deleted it, and in nobody else's — yet the case was
        // unnarrowed and refused 20-10 instead.
        paths: [SPEC, expected, ...(actual === undefined ? [] : [actual])],
        line: `${symbol} is declared in ${actual ?? 'no production file at all'}, not in ${expected}`,
      })
    }
    expect(blocking('requirements-ledger/export-probe', findings, SCOPE)).toEqual([])
  })

  it('reads HEAD too, so a symbol this commit deletes can still be attributed', () => {
    // The instrument the #66 fix rests on, proved alive from the other side. A HEAD scan
    // that stopped matching returns an empty map, every "the symbol vanished" finding
    // then names the ledger and this file only, and the agent who deleted the symbol goes
    // through with no red anywhere. That failure has no symptom of its own, so it is held
    // here rather than left to the cases that consume it.
    const head = headExports()
    expect(head).not.toBeNull()
    expect(head?.size ?? 0).toBeGreaterThan(200) // 458 on 2026-08-05
    // A comparative reading inside one run, not an absolute pin on one symbol. Pinning
    // `submitJob` to its HEAD path would go red for whoever legitimately moves it — this
    // file's own defect reproduced one layer down — while a bare size floor would be
    // satisfied by a map of the wrong thing entirely. Agreement with the working tree
    // over most of the corpus is the reading that distinguishes those.
    const agreeing = [...EXPORTED].filter(([name, path]) => head?.get(name) === path.slice(ROOT.length))
    expect(agreeing.length).toBeGreaterThan(200)
    // Self-limiting in the same way `EXPORTED.has` is one step earlier: the rows are
    // English and the claim patterns harvest words out of them, so it is this map that
    // decides a word is not a symbol and therefore not an attribution.
    expect(head?.has('itself')).toBe(false)
    expect(head?.has('which')).toBe(false)
  })

  it('strips comments, without which every claim would read as violated', () => {
    // Unchanged input, and it now passes for a different reason. The `'https://x'` arm
    // used to be carried by a `[^:]` special case written for this one string; strings
    // are preserved outright now, so the arm measures the property rather than the patch.
    // The comparative reading — this input under the regex that was here before — is in
    // `strip-comments.node.test.ts`, which requires the two to disagree.
    const stripped = stripComments("const a = 1 // runResilient(x)\n/* runResilient(y) */\nconst b = 'https://x'")
    expect(stripped).not.toContain('runResilient')
    expect(stripped).toContain("'https://x'")
    // The case the special case never covered, and the reason it was the wrong shape of fix.
    expect(stripComments("const divider = 'a // b'")).toContain("'a // b'")
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
    // The negative control, and Plan 20-02 made it **sharper** rather than deleting it.
    //
    // It used to read `hookSuppliers('ledger')).toEqual([])` — a named absence at every
    // production call site. Both node factories now supply a real `StartOutcomeLedger`,
    // so that reading is gone, and an empty-result control taken over some *other* hook
    // would be a different reader on a different string.
    //
    // What replaces it is a **comparative reading of the same hook inside one run**: the
    // two node factories supply it, the two benchmark rigs state the named opt-out, and
    // the reader has to tell them apart. A reader that stopped discriminating breaks both
    // halves at once — reporting the rigs as suppliers, or the factories as not — which
    // an equality against `[]` on some unrelated hook could not have caught.
    expect(hookSuppliers('ledger')).toContain('packages/node/src/fabric-node.ts')
    expect(hookSuppliers('ledger')).toContain('packages/browser/src/browser-node.ts')
    expect(hookSuppliers('ledger')).not.toContain('packages/node/src/bin/bench.ts')
    expect(hookSuppliers('ledger')).not.toContain('packages/bench/src/perf-workload.ts')
  })

  it('extracted claims from the rows rather than matching nothing', () => {
    const findings: { paths: string[]; line: string }[] = []
    /**
     * A floor whose only participants are the ledger it counts and the file the number is
     * written in. Nothing in the production corpus can move these three: they are counts
     * of rows and of verdicts, both read out of `LEDGER_SOURCE`.
     */
    const ledgerFloor = (actual: number, min: number, what: string): void => {
      if (actual > min) return
      findings.push({ paths: [SPEC, LEDGER], line: `${what}: ${actual}, floor ${min}` })
    }
    ledgerFloor(ROWS.length, 60, 'rows parsed out of the ledger') // 76 on 2026-08-01
    ledgerFloor(BUILT_NOT_WIRED.length, 5, 'rows marked Built, not wired')
    // Counted over every row, because that is the population the checks below read.
    // Counting it over `BUILT_NOT_WIRED` while checking `ROWS` would leave the widening
    // itself unguarded — a floor that cannot see the rows it was widened to reach.
    const claims = ROWS.reduce((total, row) => total + row.noCaller.length + row.onlyThrough.length, 0)
    // **Re-sited 2026-08-05 from `> 10`, and the reason is not that it became
    // inconvenient.** It was sited against 14 on 2026-08-02. Plan 20-12 deleted
    // `runResilient` under WIRE-04, and nine of those fourteen claims were sentences
    // naming it across seven rows — `CHURN-01`…`CHURN-06` and `SCHED-03` — so `EXPORTED`
    // stopped holding the name and `parseRows` stopped extracting them. **Measured
    // immediately after the deletion: 5.** Keeping `> 10` would assert a fact about the
    // ledger that stopped being true, and would stay red until 20-13 rewrote those rows.
    //
    // **Lowering it costs nothing this file was relying on**, and that is the part worth
    // checking rather than asserting. This is an anti-vacuity floor — its case title is
    // *"rather than matching nothing"* — and the failure mode of a row silently ceasing
    // to be parsed is held by the **set equality** in *"leaves every unreached row either
    // checkable or recorded as not"*, which is strictly stronger: it names which rows have
    // no claim rather than counting how many do. So what moved was the weaker of two
    // overlapping guards, and the stronger one caught the same event in the same run.
    //
    // ── Re-sited AGAIN to `> 5` on 2026-08-05 by Plan 20-13, which owns those rows ─────
    //
    // 20-12 named `> 3` as its weakest change and named this line as the one to revert.
    // **A revert to `> 10` is not available, and that is a finding rather than an excuse.**
    // Nine of the fourteen claims the old floor was sited against were the sentence
    // *"`runResilient` has no caller"* repeated across seven rows, and WIRE-04's entire
    // content is that `runResilient` must stop existing. The population did not drift; it
    // was deliberately reduced, by a requirement, and a floor of 10 would now assert that
    // the ledger still contains nine sentences the milestone was written to delete.
    //
    // **Measured after the rewrite: 7.** `CHURN-03` contributes two — `checkpointChain`
    // and `remainingWork` have no production caller, which is the honest shape of what is
    // still unwired about checkpointing — and the other five are `VER-03`, `VER-04`,
    // `VER-09`, `VER-10` and `AOT-02`, unchanged. Sited at `> 5`: below the measurement by
    // two, above 20-12's emergency floor by two, and it recovers two thirds of the drop
    // without asserting a fact about a symbol this milestone removed on purpose.
    if (claims <= 5) {
      // 7 on 2026-08-05 after 20-13; 5 immediately after 20-12; 14 on 2026-08-02 before it.
      //
      // **This is the floor that refused Plan 20-10** — `expected 5 to be greater than
      // 10`, on a commit that touched neither the ledger nor this file. The count falls
      // when a symbol a row names leaves `EXPORTED`, and the symbol that left had been
      // deleted by somebody else in the same working tree. So the union is the ledger
      // (its sentences are what is counted), this file (the floor is written here) and
      // the file each vanished symbol was declared in **at HEAD** — which is the only
      // place a deleted declaration can still be read, and is a path the deleting commit
      // carries.
      //
      // Only the vanished candidates, never the ones still exported: a symbol that is
      // still there did not lower the count, and naming its file would hold an agent who
      // changed nothing relevant. `null` from `attribute` means HEAD was unreadable, and
      // is an empty `paths` — unattributed, therefore own, therefore blocking.
      findings.push({
        paths: attribute(declaringPathsAtHead(ROWS)),
        line: `checkable claims parsed out of the rows: ${claims}, floor 5`,
      })
    }
    ledgerFloor(UNREACHED.length, BUILT_NOT_WIRED.length, 'rows whose verdict says not fully reached') // 32 vs 14
    expect(blocking('requirements-ledger/claim-floor', findings, SCOPE)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The claims themselves
// ---------------------------------------------------------------------------

describe('a row claiming nothing calls a mechanism is right about it', () => {
  // Every row, not the *Built, not wired* ones only. Scoping these two to that marker
  // meant that correcting a row to *Partial* dropped it out of the guard — so the act of
  // fixing a row was the act of exempting it, and `NET-06` sat wrong for a day inside a
  // file written to catch exactly that. A row asserts what it asserts whatever its
  // marker; the marker decides what is *owed*, never what is *read*.
  it('has no row naming a symbol that has since acquired a production caller', () => {
    const broken: { paths: string[]; line: string }[] = []
    for (const row of ROWS) {
      for (const symbol of row.noCaller) {
        const callers = callSites(symbol)
        if (callers.length > 0) {
          broken.push({
            // The union, and the whole of the `translationCid` fix: the row is one half
            // of the contradiction and each caller is the other. Whichever of them this
            // commit contains, it is held. A `paths: [LEDGER]` here would let the author
            // of the caller through with no red anywhere — the silent fail-open.
            paths: [LEDGER, ...callers],
            line: `${row.id}: ${symbol} is called by ${callers.join(', ')}`,
          })
        }
      }
    }
    expect(blocking('requirements-ledger/no-caller', broken, SCOPE)).toEqual([])
  })

  it('has no row claiming a path is the only one when another path exists', () => {
    const broken: { paths: string[]; line: string }[] = []
    for (const row of ROWS) {
      for (const [subject, gate] of row.onlyThrough) {
        const elsewhere = callSites(subject).filter((path) => join(ROOT, path) !== EXPORTED.get(gate))
        if (elsewhere.length > 0) {
          broken.push({
            paths: [LEDGER, ...elsewhere],
            line: `${row.id}: ${subject} is reached outside ${gate} by ${elsewhere.join(', ')}`,
          })
        }
      }
    }
    expect(blocking('requirements-ledger/only-through', broken, SCOPE)).toEqual([])
  })

  it('leaves every unreached row either checkable or recorded as not', () => {
    // `unsuppliedHooks` counts as checkable: `BROW-02` names no symbol but does name a
    // hook, and the hook shape below reads it. Omitting it here would list a row as
    // unread while another case in this same file reads it.
    const unchecked = UNREACHED.filter(
      (row) =>
        row.noCaller.length === 0 && row.onlyThrough.length === 0 && row.unsuppliedHooks.length === 0,
    )
    const uncheckedIds = new Set(unchecked.map((row) => row.id))
    const recorded = new Set(WITHOUT_A_CHECKABLE_CLAIM)
    const byId = new Map(ROWS.map((row) => [row.id, row]))

    // Still a set equality, held in both directions — the direction that catches a row
    // quietly losing its claim, and the direction that catches a list entry outliving the
    // reason it was added. What changed on 2026-08-05 is only that each half is a
    // separately attributed finding rather than an array diff, because an array diff can
    // name no paths and therefore blocks whoever arrives next.
    const findings: { paths: string[]; line: string }[] = []

    for (const row of unchecked) {
      if (recorded.has(row.id)) continue
      // **The refusal Plan 20-10 recorded**: seven ids appeared here because Plan 20-12
      // had staged the deletion of the module declaring the symbol they name. The union
      // is the ledger (the row's sentence is one half of the contradiction), this file
      // (`WITHOUT_A_CHECKABLE_CLAIM` is the other), and the file each of the row's
      // now-unresolvable symbols was declared in at HEAD — the deleting commit's own path.
      findings.push({
        paths: attribute(declaringPathsAtHead([row])),
        line: `${row.id} is ${row.verdict} and carries no claim this file can read, and is not recorded as such`,
      })
    }

    for (const id of WITHOUT_A_CHECKABLE_CLAIM) {
      if (uncheckedIds.has(id)) continue
      const row = byId.get(id)
      const stillUnreached = row !== undefined && UNREACHED_VERDICTS.includes(row.verdict)
      // Two different causes, so two different unions rather than one loose one. A row
      // that stopped being *unreached*, or left the ledger, moved because somebody edited
      // the ledger — no production file participates. A row that is still unreached and
      // has become checkable moved because a symbol it names **appeared** in `EXPORTED`,
      // and the agent who exported it is answerable along with the two document authors.
      findings.push({
        paths: stillUnreached ? attribute(declaringPathsHere([row])) : [SPEC, LEDGER],
        line:
          row === undefined
            ? `${id} is recorded as carrying no checkable claim, but is not a row in the ledger`
            : stillUnreached
              ? `${id} is recorded as carrying no checkable claim, but now carries one`
              : `${id} is recorded as carrying no checkable claim, but its verdict is now ${row.verdict}`,
      })
    }

    expect(blocking('requirements-ledger/unread-row', findings, SCOPE)).toEqual([])
  })
})

/**
 * ## Proved by mutation, and two of the four reds were not planted
 *
 * A guard about unexamined promises that could not itself fail would be the joke this
 * repository keeps writing about itself, so each case below was watched red and the
 * observed text recorded here rather than described.
 *
 * **Unplanted, first run, 2026-08-11** — the countdown, against the real register:
 *
 * > `NET-03 (tier-or-configuration) has been an unexamined promise for 16 days, bound 14`
 * > `AOT-05 (entry-point-not-driven) has been an unexamined promise for 15 days, bound 14`
 *
 * Both were then re-read against the tree. `NET-03` stands and is re-recorded; `AOT-05`'s
 * open leg turned out to be a call-site fact that had never been phrased as one, so it
 * left this register entirely. **The device's first act was to close a row.**
 *
 * **Unplanted, same day** — the drift case, which caught a defect in its own author's
 * work: the `NET-03` entry's comment quotes its witness's ``describe('NET-03 — …')`` title
 * as evidence, and an unstripped scan read that quotation as a title of *this* file:
 *
 * > `NET-03 was last re-read on 2026-08-11, and packages/node/src/`
 * > `requirements-ledger.node.test.ts now names it in a test title`
 *
 * {@link SPEC_TITLES} strips comments now, and says why.
 *
 * **Planted, watched, restored by surgical inverse, `cmp` clean against a snapshot taken
 * immediately before each plant:**
 *
 * 1. `NET-03`'s `reread` → `'2026-07-01'`:
 *    `NET-03 (tier-or-configuration) has been an unexamined promise for 41 days, bound 14`
 * 2. `packages/node/src/peer-verifier.node.test.ts` deleted from `AUTH-02`'s witnesses:
 *    `AUTH-02 was last re-read on 2026-08-06, and packages/node/src/peer-verifier.node.`
 *    `test.ts now names it in a test title — read the row against it, then re-record`
 * 3. `BENCH-06`'s `reread` → `'2026-7-28'`, the one-character typo that would otherwise
 *    make `daysOutstanding` return `NaN` and skip the countdown *silently*, because
 *    `NaN > bound` and `NaN <= bound` are both false:
 *    `BENCH-06 reread 2026-7-28: expected true to be false`
 */
describe('a promise to re-read a row by hand is visible, witnessed and finite', () => {
  it('records a witness list that is what the spec corpus says now, not what it said once', () => {
    // The cheap secondary, and its yield is stated rather than implied: measured against
    // the four rows this register was built from, drift catches exactly one — `SCHED-05`,
    // when `sovereignty-placement.node.test.ts` began title-naming it. The other three
    // were stale against specs that already existed. So this case is not the guard; it is
    // the half of the guard that fires *without waiting for the countdown*, and it is
    // worth its 84 ms for that.
    const findings: { paths: string[]; line: string }[] = []
    for (const entry of REREAD_REGISTER) {
      const { arrived, departed } = witnessDrift(entry)
      // The union rule, exactly as the `translationCid` case applies it one describe up:
      // a spec that began measuring this requirement is the other half of the
      // contradiction, and its author is answerable with the two document authors.
      if (arrived.length > 0) {
        findings.push({
          paths: [SPEC, LEDGER, ...arrived],
          line:
            `${entry.id} was last re-read on ${entry.reread}, and ${arrived.join(', ')} ` +
            `now names it in a test title — read the row against it, then re-record`,
        })
      }
      if (departed.length > 0) {
        findings.push({
          paths: [SPEC, LEDGER, ...departed],
          line:
            `${entry.id} records ${departed.join(', ')} as a witness, and it no longer ` +
            `names the requirement in a test title`,
        })
      }
    }
    expect(blocking('requirements-ledger/witness-drift', findings, SCOPE)).toEqual([])
  })

  it('holds no promise outstanding longer than the bound', () => {
    const now = Date.now()
    const byId = new Map(ROWS.map((row) => [row.id, row]))
    const findings: { paths: string[]; line: string }[] = []
    for (const entry of REREAD_REGISTER) {
      const days = daysOutstanding(entry.reread, now)
      if (Number.isNaN(days) || days <= REREAD_INTERVAL_DAYS) continue
      // The finding IS the re-read brief. It hands over the row's current verdict and
      // every spec that claims to measure the requirement, because that is what a hand
      // re-read reads — and because `BROW-02` proves the material is the whole point: its
      // one witness was the spec that refuted it, and nothing ever put that path in front
      // of anybody. Attributed to the two documents rather than to the witnesses: an
      // outstanding promise is nobody's new defect, it is this register's own backlog, and
      // the agent editing the ledger or this file is the one who can discharge it.
      const row = byId.get(entry.id)
      const witnesses = entry.witnesses.length === 0 ? 'no spec at all' : entry.witnesses.join(', ')
      findings.push({
        paths: [SPEC, LEDGER],
        line:
          `${entry.id} (${entry.because}) has been an unexamined promise for ${days} days, ` +
          `bound ${REREAD_INTERVAL_DAYS} — its row is ${row?.verdict ?? 'absent from the ledger'} ` +
          `and it is measured by ${witnesses}; read those against the row, then tick it or re-record`,
      })
    }
    expect(blocking('requirements-ledger/stale-promise', findings, SCOPE)).toEqual([])
  })

  it('keeps the register well-formed, unduplicated and under its ceiling', () => {
    // Not partitioned, and for the reason the header arithmetic is not: every expression
    // here reads `REREAD_REGISTER` and nothing else, so it is already scoped to its own
    // author and a partition layer could only fail open.
    expect(REREAD_REGISTER.length).toBeLessThanOrEqual(REREAD_REGISTER_CEILING)
    expect(new Set(WITHOUT_A_CHECKABLE_CLAIM).size).toBe(REREAD_REGISTER.length)
    const today = Date.now()
    for (const entry of REREAD_REGISTER) {
      // A malformed date reads `NaN` from `daysOutstanding`, and `NaN <= bound` is false
      // *and* `NaN > bound` is false — so a typo would skip the countdown silently in the
      // one direction that matters. Caught here instead.
      expect(Number.isNaN(utcMidnight(entry.reread)), `${entry.id} reread ${entry.reread}`).toBe(
        false,
      )
      // A date in the future is a promise that can never come due.
      expect(daysOutstanding(entry.reread, today), `${entry.id} reread ${entry.reread}`,
      ).toBeGreaterThanOrEqual(0)
      expect(pathFormProblems([...entry.witnesses])).toEqual([])
    }
  })

  it('read titles out of the spec corpus, so an empty witness list means empty', () => {
    // Every assertion above is of the shape "this list agrees with a scan", which a scan
    // that stopped matching satisfies for fourteen of fifteen entries — every pinned
    // witness would read as `departed`, which is loud, but a *new* register written
    // against a dead scan would pin `[]` everywhere and be permanently, silently green.
    // Floors and a pinned probe, the same defence the export scan gets above.
    expect(SPECS.length).toBeGreaterThan(150)
    expect(SPECS.filter((path) => (SPEC_TITLES.get(path) ?? '').length > 0).length).toBeGreaterThan(
      150,
    )
    // `BROW-02` rather than a current member, on purpose: it is the historical case this
    // whole register exists for, and it is independent of the register's own data. On the
    // day `BROW-02` was listed as carrying no checkable claim, this one path was already
    // its entire witness set — the spec that refuted it. A probe that goes red here means
    // the scan can no longer see what an author should have been made to write down.
    expect(titleWitnesses('BROW-02')).toEqual(['packages/node/src/peer-ledger.e2e.test.ts'])
    // The boundary, checked rather than asserted: `MR-0` is a prefix of five ids in this
    // register and must resolve to none of them.
    expect(titleWitnesses('MR-0')).toEqual([])
  })
})

describe('a row claiming a serveAgent hook is unsupplied is right about it', () => {
  it('has no row calling a hook unsupplied that a production node supplies', () => {
    const broken: { paths: string[]; line: string }[] = []
    for (const row of ROWS) {
      for (const hook of row.unsuppliedHooks) {
        const suppliers = hookSuppliers(hook)
        if (suppliers.length > 0) {
          broken.push({
            paths: [LEDGER, ...suppliers],
            line: `${row.id}: ${hook} is supplied by ${suppliers.join(', ')}`,
          })
        }
      }
    }
    expect(blocking('requirements-ledger/unsupplied-hook', broken, SCOPE)).toEqual([])
  })
})

describe('the paths this guard attributes findings to are paths a commit can match', () => {
  /**
   * The residual fail-open of narrowing, checked from this guard's end.
   *
   * Every path here is built by `path.slice(ROOT.length)` in {@link callSites} and
   * {@link hookSuppliers}. That expression is one character away from emitting
   * `/packages/…`, which is well-formed as a string, matches no commit scope, and would
   * make **every** row-versus-caller finding foreign — this guard would then pass on a
   * false ledger row with no output at all. Nothing else in this file would notice.
   *
   * Membership is a floor rather than an equality because {@link PRODUCTION} walks the
   * filesystem rather than the index, so a concurrently-running agent's untracked source
   * file legitimately appears here. Holding an equality would redden this guard for
   * somebody else's scratch file, which is the very defect being fixed.
   */
  const TRACKED = trackedPaths(ROOT)
  const ATTRIBUTABLE = [
    LEDGER,
    SPEC,
    ...EXPORT_PROBES.map(([, expected]) => expected),
    ...PRODUCTION.map((path) => path.slice(ROOT.length)),
    // The witness lists are attributed with too — `witness-drift` names an arriving or
    // departing spec in its `paths`, so a witness path in the wrong form is the same
    // residual fail-open as a caller path in the wrong form: well-formed, matching no
    // commit, and making every drift finding read as somebody else's.
    ...REREAD_REGISTER.flatMap((entry) => [...entry.witnesses]),
  ]

  it('emits repo-relative POSIX paths that git also prints', () => {
    expect(pathFormProblems(ATTRIBUTABLE)).toEqual([])
    expect(ATTRIBUTABLE.filter((path) => TRACKED.has(path)).length).toBeGreaterThan(80)
    // Named markers, so "most of them are tracked" is not the whole reading: these are
    // the two files the positive controls above are stated against.
    expect(TRACKED.has(LEDGER)).toBe(true)
    // Added 2026-08-05 with defect #66. This file is now in the union of three findings,
    // and `SPEC` is derived from `import.meta.url` — a resolution that lands one
    // directory out is still well-formed, still matches no commit, and would silently
    // drop this file from every one of those unions.
    expect(TRACKED.has(SPEC)).toBe(true)
    // The probes' expected paths are attributed with, so a typo in one is not merely a
    // wrong expectation — it is a finding that names a path no commit can hold.
    for (const [symbol, expected] of EXPORT_PROBES) {
      expect(TRACKED.has(expected), `${symbol} expected at ${expected}`).toBe(true)
    }
    expect(ATTRIBUTABLE).toContain('packages/node/src/fabric-node.ts')
    expect(ATTRIBUTABLE).toContain('packages/browser/src/browser-node.ts')
  })

  it('builds the same form from a real call-site search, not merely from the corpus', () => {
    // The round trip that matters is the one the findings actually use. `submitJob` is
    // one of the positive controls above and is called from several production files.
    const callers = callSites('submitJob')
    expect(callers.length).toBeGreaterThan(0)
    expect(pathFormProblems(callers)).toEqual([])
    expect(callers.filter((path) => TRACKED.has(path))).toEqual(callers)
  })

  it('strips the tree-ish off the HEAD scan, which git prints and a commit never does', () => {
    // The #66 attribution path, checked from the same end as the others. `git grep
    // <pattern> HEAD` names every hit `HEAD:packages/…`, and `isLsFilesForm` has no
    // opinion about a colon — so a prefix left on would produce a path that passes every
    // form check, matches no commit scope, and makes every vanished-symbol finding read
    // as somebody else's.
    //
    // **Which assertion carries that, measured rather than assumed.** The strip was
    // deleted (`const path = named`) and this case went red — on
    // `expected 0 to be greater than 80`, **not** on either colon filter below. The
    // filters cannot fire, because `isProductionPath` requires a `packages/` or `tools/`
    // prefix and `HEAD:packages/…` has neither, so the whole map empties one step
    // earlier. They are kept as a statement of the form this map must be in, and the
    // claim is actually carried by the two floors — here and in *"reads HEAD too"*, which
    // failed in the same run on `expected 0 to be greater than 200`. Saying otherwise
    // would be a comment that reads like evidence and is not.
    const head = headExports()
    expect(head).not.toBeNull()
    const paths = [...new Set((head === null ? [] : [...head.values()]))]
    expect(paths.length).toBeGreaterThan(80)
    expect(pathFormProblems(paths)).toEqual([])
    expect(paths.filter((path) => path.startsWith('HEAD:'))).toEqual([])
    expect(paths.filter((path) => path.includes(':'))).toEqual([])
    // A floor, and it cannot be an equality in either direction: this map's whole purpose
    // is to hold files that are at HEAD and **not** in the index, which is exactly what a
    // staged deletion looks like. Requiring every entry to be tracked would make the
    // instrument red in precisely the case it exists for.
    expect(paths.filter((path) => TRACKED.has(path)).length).toBeGreaterThan(80)
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
