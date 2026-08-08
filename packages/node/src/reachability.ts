import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API, SignatureKind, SymbolFlags } from 'typescript/unstable/sync'

/**
 * The instrument Phase 22 reads: what this repository publishes, and — from Task 2 — what
 * anything actually reaches.
 *
 * ## Why this exists at all, and why the first job is not to take a reading
 *
 * Three cheap approximations of *"which barrel exports are unreached?"* were run over the same
 * corpus and returned **54**, **3** and **102**. The answer was dominated by the tracer's design
 * rather than by the codebase, so a clean verdict from a cheap instrument says nothing. Two of
 * the three are demonstrably wrong at named symbols: the 3-answer scores `estimatePi` reached
 * because its *module* is reachable, and the 102-answer scores `FabricNode` unreached because
 * `bin/agent.ts` enters through `FabricNode.start(…)`, a member expression a bare `NAME(`
 * detector cannot see.
 *
 * That is the whole argument for this file being a module rather than a block inside a spec:
 * every step below is a pure function over its arguments so a test can hand it a planted input
 * and require it to react. {@link barrelExports} is the single exception — the one thin loader —
 * and it is the only thing here that touches disk or spawns a process.
 *
 * ## What this file is NOT
 *
 * It renders no verdict about the tree's health. Everything here is a name, a classification and
 * (from Task 2) an edge. A green run of the spec beside it is not evidence that any capability is
 * wired, and no summary may read it as such.
 */

/** Repo root, from this file's own location — `packages/node/src` is three levels down. */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The five modules the fabric is entered through, from `v1.0-MILESTONE-AUDIT.md`.
 *
 * A list of **modules**, deliberately: not a tier list, and not keyed on node kind.
 * `packages/browser/demo/main.ts` sits here on exactly the same footing as the three
 * `bin/*.ts` files, because all nodes have equal functionality and only discovery differs —
 * a rule that read differently for `FabricNode` and `BrowserNode` was written once and
 * retracted (`0314208`).
 *
 * `packages/browser/demo/index.html` is the real entry; it is represented by the `main.ts` it
 * loads, because the API sees TypeScript and not HTML. The page's inline
 * `<script type="module">` reads `window.o2` and imports no barrel symbol, and `policy.html`
 * imports nothing at all — said here rather than left for a reader to wonder about.
 *
 * **Three further modules are runnable and are deliberately absent**:
 * `packages/node/src/mutation-guard.mutate.ts` (`npm run test:mutations`),
 * `tools/aot/bench-lifted.ts` and `tools/aot/measure-wasi.ts`. The reading that makes their
 * absence defensible is that adding them changes no barrel verdict, and Task 2 pins that reading
 * rather than inheriting it — so the five-module list stops being defensible *silently*.
 */
export const ENTRY_POINTS: readonly string[] = [
  'packages/node/src/bin/agent.ts',
  'packages/node/src/bin/seed.ts',
  'packages/node/src/bin/bench.ts',
  'tools/aot/cli.ts',
  'packages/browser/demo/main.ts',
]

/**
 * What a barrel export is, for the purpose of asking whether anything calls it.
 *
 * `type-only` is **out of jurisdiction** — a type has no call path by construction, and 276 of
 * today's 604 exports are one. That exclusion is stated here rather than implied because a flags
 * predicate that silently stopped classifying would empty the jurisdiction while every downstream
 * verdict read clean. `disclosure-gate.node.test.ts` shipped exactly that failure once, with a
 * pattern that matched nothing.
 */
export type ExportKind = 'callable' | 'other-value' | 'type-only'

/** One barrel export reduced to plain data — no checker object crosses this boundary. */
export interface ExportFacts {
  /** The package whose `src/index.ts` published it: `core`, `net`, … */
  readonly barrel: string
  readonly name: string
  /** `SymbolFlags`, after alias resolution unless the caller asked otherwise. */
  readonly flags: number
  /** Absolute path of the first declaration, or `''` when the symbol declares nowhere. */
  readonly declaredIn: string
}

/** {@link ExportFacts} with {@link classify}'s verdict attached. */
export interface ClassifiedExport extends ExportFacts {
  readonly kind: ExportKind
}

/** One package's export counts, the shape the floors are asserted against. */
export interface BarrelCensus {
  readonly barrel: string
  readonly callable: number
  readonly otherValue: number
  readonly typeOnly: number
  readonly total: number
}

/**
 * Which kind of export this is — pure over its argument, so a planted symbol can be handed to it.
 *
 * ## The order of these two tests is load-bearing, and it is not obvious
 *
 * `SymbolFlags.Type` is a **composite mask** (788968), and it *includes* `SymbolFlags.Class`
 * (32) — `Type & Class === 32`, measured, not assumed. So a class matches both branches, and
 * swapping them would silently move every exported class out of jurisdiction and into
 * `type-only`, emptying much of the corpus while every count still looked like a count.
 * `classifies a class as callable even though it also matches the type mask` in the spec beside
 * this file is the case that holds the order.
 *
 * ## The stated limit, measured rather than waved at
 *
 * This reads declaration flags, so `export const f = () => {}` carries `BlockScopedVariable`
 * and lands in `other-value` despite being callable. **Measured 2026-08-08: exactly one of the
 * 111 `other-value` exports carries a call signature — `core/fabricCombiner`.** The
 * understatement is one symbol, it is named, and `the callable-const understatement is one
 * named symbol` re-measures it rather than trusting this sentence.
 */
export function classify(facts: ExportFacts): ExportKind {
  const flags = facts.flags
  if ((flags & (SymbolFlags.Function | SymbolFlags.Class | SymbolFlags.Method)) !== 0) {
    return 'callable'
  }
  if ((flags & (SymbolFlags.Type | SymbolFlags.Interface | SymbolFlags.TypeAlias)) !== 0) {
    return 'type-only'
  }
  return 'other-value'
}

/** {@link classify} over a set — pure, and the shape the loader hands to the census. */
export function classifyAll(facts: readonly ExportFacts[]): ClassifiedExport[] {
  return facts.map((one) => ({ ...one, kind: classify(one) }))
}

/**
 * Per-package counts, one row per barrel that contributed at least one export.
 *
 * Pure over its argument so the spec can census a planted set. A barrel that vanished
 * contributes no row at all, which is what makes an empty enumeration reddens-by-name rather
 * than reddens-as-a-zero.
 */
export function censusOf(exports: readonly ClassifiedExport[]): BarrelCensus[] {
  const rows = new Map<string, { callable: number; otherValue: number; typeOnly: number }>()
  for (const one of exports) {
    const row = rows.get(one.barrel) ?? { callable: 0, otherValue: 0, typeOnly: 0 }
    if (one.kind === 'callable') row.callable += 1
    else if (one.kind === 'type-only') row.typeOnly += 1
    else row.otherValue += 1
    rows.set(one.barrel, row)
  }
  return [...rows]
    .map(([barrel, row]) => ({
      barrel,
      callable: row.callable,
      otherValue: row.otherValue,
      typeOnly: row.typeOnly,
      total: row.callable + row.otherValue + row.typeOnly,
    }))
    .sort((a, b) => a.barrel.localeCompare(b.barrel))
}

/**
 * Every `packages/*​/src/index.ts` that exists, sorted, absolute — **derived from disk**.
 *
 * Not a hand-written list of eight, for `purity.node.test.ts`'s reason applied here: a ninth
 * package must enter jurisdiction without an edit, and a barrel that moved must fail by name.
 * `readdirSync` throws for a `packagesDir` that is not there, and that is the wanted behaviour —
 * a discovery root that has been moved must fail loudly rather than contribute nothing and let
 * the floors carry an unchanged assertion.
 */
export function barrelPathsIn(packagesDir: string): string[] {
  return readdirSync(packagesDir)
    .map((pkg) => join(packagesDir, pkg, 'src', 'index.ts'))
    .filter((path) => existsSync(path))
    .sort()
}

/** The package name a barrel path belongs to — `…/packages/core/src/index.ts` → `core`. */
export function barrelNameOf(barrelPath: string): string {
  const marker = `${'/'}packages${'/'}`
  const at = barrelPath.lastIndexOf(marker)
  if (at < 0) return barrelPath
  const rest = barrelPath.slice(at + marker.length)
  const slash = rest.indexOf('/')
  return slash < 0 ? rest : rest.slice(0, slash)
}

/**
 * The TypeScript version installed under `root`.
 *
 * The `<interfaces>` contract this file is built on — `openProjects` taking a bare path string,
 * `program`/`checker` being fields rather than getters, `SymbolFlags.Type` overlapping `Class` —
 * was measured against one exact version, and the import path says `unstable`. So the pin in the
 * root `package.json` became load-bearing for a guard on 2026-08-08, and the spec asserts it.
 *
 * **Asserted rather than enforced by editing `package.json`**, which is contended by concurrent
 * agents — and an assertion is the stronger record anyway: it names the version the contract was
 * measured against, which a dependency range cannot.
 */
export function typescriptVersionIn(root: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, 'node_modules', 'typescript', 'package.json'), 'utf8'),
  )
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) {
    throw new Error('node_modules/typescript/package.json has no version field')
  }
  const version = (manifest as { version: unknown }).version
  if (typeof version !== 'string') throw new Error('typescript version is not a string')
  return version
}

/** What {@link barrelExports} may be pointed at. Every field exists so a plant can move it. */
export interface BarrelExportOptions {
  /** Repo root holding `tsconfig.json`. Defaults to this file's own repo. */
  readonly root?: string
  /** Directory scanned for `*​/src/index.ts`. Defaults to `<root>/packages`. */
  readonly packagesDir?: string
  /**
   * Resolve `SymbolFlags.Alias` entries to what they alias before classifying. Default `true`.
   *
   * Load-bearing, and the spec proves it is rather than asserting it: a barrel entry's own flags
   * are `Alias`, which matches neither the callable mask nor the type mask, so **without this
   * step every export in the tree classifies as `other-value`** and the jurisdiction empties
   * while the total stays right. `alias resolution changes the reading, and by how much` records
   * both numbers.
   */
  readonly resolveAliases?: boolean
}

/**
 * The one thin loader: open the project, read every barrel's exports, classify them.
 *
 * Everything else in this module is pure over its arguments precisely so that this function is
 * the only thing a test cannot hand a planted input to — and even this one takes its two roots
 * as options, so the "enumeration came back empty" case is reachable without a source mutation.
 *
 * `api.close()` is not optional: the API spawns a server process, and a spec that leaves one
 * behind per invocation will exhaust the machine long before it exhausts the corpus.
 *
 * Only the eight barrels are read. `node_modules` is never resolved — in a git worktree it is a
 * tree of symlinks into another checkout, and following it would make this file report on code
 * that is not the code under test, which is the hazard `requirements-ledger.node.test.ts`'s
 * `SKIP_DIRS` comment already records.
 */
export function barrelExports(options: BarrelExportOptions = {}): ClassifiedExport[] {
  const root = options.root ?? REPO_ROOT
  const packagesDir = options.packagesDir ?? join(root, 'packages')
  const resolveAliases = options.resolveAliases ?? true

  const api = new API({ cwd: root })
  try {
    const projects = api.updateSnapshot({ openProjects: [join(root, 'tsconfig.json')] }).getProjects()
    // A silent empty snapshot is indistinguishable from a clean tree, which is the single worst
    // failure this instrument can have. `openProjects` takes a bare path string; the documented
    // `DocumentIdentifier` object form returned zero projects in this tree, twice, with no error.
    const project = projects[0]
    if (projects.length !== 1 || project === undefined) {
      throw new Error(
        `expected exactly 1 project from openProjects, got ${projects.length} — ` +
          'the API contract this instrument rests on has changed; do not read past this point',
      )
    }
    const checker = project.checker

    const facts: ExportFacts[] = []
    for (const barrelPath of barrelPathsIn(packagesDir)) {
      const barrel = barrelNameOf(barrelPath)
      const sourceFile = project.program.getSourceFile(barrelPath)
      if (sourceFile === undefined) {
        throw new Error(`${barrelPath} is on disk but outside the TypeScript project`)
      }
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) {
        throw new Error(`${barrelPath} has no module symbol`)
      }
      for (const entry of checker.getExportsOfModule(moduleSymbol)) {
        const resolved =
          resolveAliases && (entry.flags & SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(entry)
            : entry
        facts.push({
          barrel,
          name: entry.name,
          flags: resolved.flags,
          declaredIn: resolved.declarations[0]?.path ?? '',
        })
      }
    }
    return classifyAll(facts)
  } finally {
    api.close()
  }
}

/**
 * The `other-value` exports whose type nonetheless carries a call signature.
 *
 * The measurement behind {@link classify}'s stated limit, kept as code rather than as a number in
 * a comment — *a comment asserting a fact about every call site is a claim with an expiry date*,
 * and this is that class of claim. Read 2026-08-08 as exactly one symbol, `core/fabricCombiner`.
 *
 * Separate from {@link barrelExports} because it costs a `getTypeOfSymbol` per candidate and the
 * corpus does not need it; this is a measurement of the instrument, not part of it.
 */
export function callableConstsIn(options: BarrelExportOptions = {}): string[] {
  const root = options.root ?? REPO_ROOT
  const packagesDir = options.packagesDir ?? join(root, 'packages')

  const api = new API({ cwd: root })
  try {
    const project = api
      .updateSnapshot({ openProjects: [join(root, 'tsconfig.json')] })
      .getProjects()[0]
    if (project === undefined) throw new Error('no project')
    const checker = project.checker

    const found: string[] = []
    for (const barrelPath of barrelPathsIn(packagesDir)) {
      const barrel = barrelNameOf(barrelPath)
      const sourceFile = project.program.getSourceFile(barrelPath)
      if (sourceFile === undefined) continue
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) continue
      for (const entry of checker.getExportsOfModule(moduleSymbol)) {
        const resolved =
          (entry.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(entry) : entry
        if (classify({ barrel, name: entry.name, flags: resolved.flags, declaredIn: '' }) !== 'other-value') {
          continue
        }
        const type = checker.getTypeOfSymbol(resolved)
        if (type === undefined) continue
        if (checker.getSignaturesOfType(type, SignatureKind.Call).length > 0) {
          found.push(`${barrel}/${entry.name}`)
        }
      }
    }
    return found.sort()
  } finally {
    api.close()
  }
}
