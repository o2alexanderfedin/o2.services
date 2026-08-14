import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type Node,
  SyntaxKind,
  isArrowFunction,
  isAwaitExpression,
  isBindingElement,
  isCallExpression,
  isClassDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isMethodDeclaration,
  isNewExpression,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isSetAccessorDeclaration,
  isStringLiteral,
  isTypeQueryNode,
  isTypeReferenceNode,
  isVariableDeclaration,
} from 'typescript/unstable/ast'
import {
  API,
  type NodeHandle,
  SignatureKind,
  type Symbol as TsSymbol,
  SymbolFlags,
} from 'typescript/unstable/sync'

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

// ---------------------------------------------------------------------------
// Task 2 — the call graph
// ---------------------------------------------------------------------------

/**
 * The member name of the node holding a module's own top-level code.
 *
 * Top-level code is a caller like any other, and it has to be one: `bin/bench.ts` calls
 * `delegate` at module scope, and a graph whose only callers were named functions would report
 * that symbol unreached while it runs on every invocation of the binary.
 */
export const MODULE_MEMBER = '<module>'

/** A graph node: a **declaration**, not a file — `packages/demo/src/pi.ts#estimatePi`. */
export function nodeId(relFile: string, member: string): string {
  return `${relFile}#${member}`
}

/** The file half of a node id. */
export function fileOf(id: string): string {
  const hash = id.lastIndexOf('#')
  return hash < 0 ? id : id.slice(0, hash)
}

/**
 * One declaration-level call graph over the repository's own TypeScript.
 *
 * `calls` already carries the module→module import edges as edges between the two files'
 * {@link MODULE_MEMBER} nodes, so {@link reachableFrom} is a single plain traversal that a test
 * can drive with a hand-built `Map`. `imports` keeps the same relation file-to-file, because
 * Task 3's module arm has to traverse it *without* the call edges — two traversals of one graph,
 * which is the only arrangement under which comparing them means anything.
 */
export interface CallGraph {
  /** Every declaration node discovered, whether or not anything calls it. */
  readonly nodes: ReadonlySet<string>
  /** Caller node → callee nodes, including module→module import edges. */
  readonly calls: ReadonlyMap<string, ReadonlySet<string>>
  /** Importing file → imported files. Import edges only, for the module arm. */
  readonly imports: ReadonlyMap<string, ReadonlySet<string>>
  /** Repo-relative source files walked. */
  readonly files: readonly string[]
  /** {@link ENTRY_POINTS} as module nodes. */
  readonly roots: readonly string[]
  /**
   * Declarations sharing a file and a name, merged into one node — reported rather than hidden.
   *
   * Two `start` methods on two classes in one file become one node, which can only ever
   * *over*-connect. Measured rather than assumed: the spec pins the count so a refactor that
   * made this common would be a finding instead of a silent loss of resolution.
   */
  readonly collisions: readonly string[]
}

/**
 * Everything reachable from `roots` — **pure over its arguments**, so a planted `Map` can be
 * handed straight to it.
 *
 * That purity is the whole reason this is a separate function. Four of this instrument's
 * failure modes produce a clean verdict — an empty corpus, an empty entry set, an empty edge
 * set, and an edge builder that over-connects — and the first three are only checkable if the
 * traversal can be driven without building a real graph first.
 */
export function reachableFrom(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  roots: readonly string[],
): Set<string> {
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const here = queue.pop()
    if (here === undefined || seen.has(here)) continue
    seen.add(here)
    for (const next of edges.get(here) ?? []) if (!seen.has(next)) queue.push(next)
  }
  return seen
}

/**
 * Which package barrel a repo-relative path belongs to, or `undefined` outside `packages/`.
 *
 * Used to turn `@o2/core` into the file that publishes it. A barrel is a **conduit, never a
 * caller** — every statement in all eight is `export … from`, so nothing in one ever appears as
 * the source of a call edge. It appears only as an import target, which is correct: importing a
 * barrel really does run every module it re-exports.
 */
function barrelFileFor(specifier: string): string | undefined {
  const scope = '@o2/'
  if (!specifier.startsWith(scope)) return undefined
  const pkg = specifier.slice(scope.length)
  if (pkg.length === 0 || pkg.includes('/')) return undefined
  return `packages/${pkg}/src/index.ts`
}

/**
 * A module specifier resolved to a repo-relative file, or `undefined` when it leaves the repo.
 *
 * Two of the four edge classes live here. **The `?worker` query is stripped**: Vite's
 * `./task-executor.worker.ts?worker` is a real static edge wearing a suffix, and a resolver that
 * does not strip it drops the only path to `runTask` and `runTaskAndPost` — the fabric's entire
 * execution path — and reports the kernel's task runner dead.
 *
 * `node:` builtins and npm packages resolve to `undefined` deliberately. `node_modules` is never
 * followed: in a git worktree it is a tree of symlinks into another checkout, and following it
 * would make this instrument report on code that is not the code under test.
 */
export function resolveSpecifier(fromRelFile: string, specifier: string): string | undefined {
  const query = specifier.indexOf('?')
  const clean = query < 0 ? specifier : specifier.slice(0, query)
  if (clean.startsWith('.')) {
    return normalize(join(dirname(fromRelFile), clean)).split('\\').join('/')
  }
  return barrelFileFor(clean)
}

const SKIP_DIRS: readonly string[] = ['node_modules', '.git', 'dist', 'coverage', '.vite']

/**
 * An absolute path made repo-relative, **case-insensitively**.
 *
 * Two traps, both measured rather than guessed, and each of which produced a graph with zero
 * edges before it was found:
 *
 * 1. `REPO_ROOT` comes from `fileURLToPath(new URL('../../..', …))` and **carries a trailing
 *    slash** — `purity.node.test.ts` records the same fact about its own `ROOT`. Slicing
 *    `root.length + 1` therefore eats the first character of every path, and `getSourceFile`
 *    then returns `undefined` for the entire corpus. Everything reads unreachable, which is the
 *    loud direction and is how this was caught.
 * 2. **The API lowercases `NodeHandle.path`** — it returns `/volumes/projectsssd/…` for a repo
 *    at `/Volumes/ProjectsSSD/…`. A case-sensitive comparison against a disk walk therefore
 *    matches nothing on a host whose path has any capital in it.
 */
function relativeTo(root: string, absolute: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  if (!absolute.toLowerCase().startsWith(base.toLowerCase())) return absolute
  return absolute.slice(base.length)
}

/** Repo-relative `.ts` under `roots`, excluding specs, declarations and the skip list. */
function sourceFilesUnder(root: string, roots: readonly string[]): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.includes(entry)) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
        found.push(relativeTo(root, path))
      }
    }
  }
  for (const dir of roots) walk(join(root, dir))
  return found.sort()
}

/**
 * The declaration kinds that own the calls written inside them.
 *
 * Narrowed with the AST's own `isX` type guards rather than by comparing `kind` and reaching for
 * properties the base `Node` does not declare — the guards are what make `.name` and
 * `.initializer` legal to read at all, and this repository forbids the assertion that would
 * otherwise be needed.
 */
function declaredNameOf(node: Node): string | undefined {
  if (
    isFunctionDeclaration(node) ||
    isClassDeclaration(node) ||
    isMethodDeclaration(node) ||
    isGetAccessorDeclaration(node) ||
    isSetAccessorDeclaration(node)
  ) {
    const name = node.name
    return name !== undefined && isIdentifier(name) ? name.text : undefined
  }
  // A `const f = () => {}` owns its body too — the arrow is the declaration in all but name, and
  // `classify` already records that this repository writes callables in both forms.
  if (isVariableDeclaration(node)) {
    if (!declaresAFunction(node)) return undefined
    return isIdentifier(node.name) ? node.name.text : undefined
  }
  return undefined
}

/**
 * A variable declaration that **owns a function body** — `const f = () => {}` or
 * `const f = function () {}`.
 *
 * Extracted from {@link declaredNameOf} on 2026-08-13 so the two sides of one relation cannot
 * drift: the walk creates a node for exactly these, and the reference filter in
 * {@link buildCallGraph} now creates an edge *into* exactly these. Before the extraction only the
 * first half existed, and the consequence was not academic — `packages/core/src/job/submit.ts`
 * hands `runOn`, an arrow declared at `:2933`, to `dispatchUnderLease` at `:3006`; the edge was
 * dropped because {@link classify} reads declaration **flags** and a `const`-arrow carries
 * `BlockScopedVariable`. `core/executeVerified`, the fabric's N-version comparison, therefore ran
 * on every shard dispatch and read as dead code.
 *
 * **Narrow on purpose, and this is the whole design of the repair.** It asks what the initialiser
 * *is*, not what the symbol's type *carries*: `const handler: Handler = somethingImported` has a
 * call signature and declares no body, and widening to "the type is callable" — or worse, to
 * constants generally — would rebuild the 54-answer that `buildCallGraph`'s reference filter
 * exists to refuse. `refuses one to a plain const in the same body` in
 * `reachability-guard.node.test.ts` reads both halves off one caller node so the separation is
 * measured rather than asserted.
 */
export function declaresAFunction(node: Node): boolean {
  if (!isVariableDeclaration(node)) return false
  const initializer = node.initializer
  if (initializer === undefined) return false
  return isArrowFunction(initializer) || isFunctionExpression(initializer)
}

/**
 * {@link declaresAFunction} over a declaration that may have failed to resolve.
 *
 * A handle that does not resolve answers **no**, deliberately: an unresolvable declaration is a
 * declaration nobody has read, and manufacturing an edge from one would be the over-connection
 * direction taken on the strength of a missing measurement.
 */
function initialisesAFunction(node: Node | undefined): boolean {
  return node !== undefined && declaresAFunction(node)
}

/**
 * The barrel export a name destructured from `await import('<specifier>')` actually names.
 *
 * `packages/browser/demo/main.ts:687` writes
 * `const { StartOutcomeLedger, describeStartReport } = await import('@o2/core')` and calls
 * `describeStartReport(report)` eight lines later. The identifier resolves to a **local
 * BindingElement**, so the edge landed on a node id inside `main.ts` that nothing declares, and
 * `packages/core/src/start-outcome.ts#describeStartReport` kept an in-degree of **zero** — not
 * merely unrooted, which is why the `global-object-hop` class's stated closing condition would
 * never have rescued it. A static `import { x } from '@o2/core'` has always resolved through the
 * barrel because the identifier's symbol is an `Alias`; this teaches the dynamic form the same
 * trick.
 *
 * Pure over its argument, and it answers `undefined` for every shape that is not this one:
 * `const m = await import(…)` followed by `m.x` is a property access on a namespace and is
 * deliberately not handled, because the member-expression class already resolves that through the
 * checker.
 */
export function dynamicImportBinding(
  node: Node,
): { readonly specifier: string; readonly exportName: string } | undefined {
  if (!isBindingElement(node)) return undefined
  // `const { a: b } = …` names `a` in the module and `b` here; the module's name is the one that
  // resolves. `propertyName` is absent for the shorthand, where the two coincide.
  const named = node.propertyName ?? node.name
  if (named === undefined || !isIdentifier(named)) return undefined
  const pattern = node.parent
  if (pattern === undefined || !isObjectBindingPattern(pattern)) return undefined
  const declaration = pattern.parent
  if (declaration === undefined || !isVariableDeclaration(declaration)) return undefined
  const initializer = declaration.initializer
  if (initializer === undefined) return undefined
  // `await import(…)` and a bare `import(…)` — the second only appears under a `then`, but the
  // shape costs one line to accept and refusing it would be a distinction without a reason.
  const call = isAwaitExpression(initializer) ? initializer.expression : initializer
  if (call === undefined || !isCallExpression(call)) return undefined
  if (call.expression.kind !== SyntaxKind.ImportKeyword) return undefined
  const first = call.arguments.at(0)
  if (first === undefined || !isStringLiteral(first)) return undefined
  return { specifier: first.text, exportName: named.text }
}

/** Every callee identifier in a subtree, paired with the declaration that wrote the call. */
interface CallSite {
  readonly caller: string
  readonly callee: Node
  /** True when this identifier came from a property access — `X.y()` contributes two sites. */
  readonly member: boolean
}

/**
 * `new URL('<rel>', import.meta.url)` — the fourth edge class, and not an import at all.
 *
 * `worker-thread.ts` writes `const ENTRY = new URL('./task-executor.worker-thread.ts',
 * import.meta.url)` and then `new Worker(ENTRY)`. No import statement mentions that file, so a
 * resolver reading only `sourceFile.imports` never sees the Node tier's worker entry.
 */
function workerUrlSpecifier(node: Node): string | undefined {
  if (!isNewExpression(node)) return undefined
  const callee = node.expression
  if (!isIdentifier(callee) || callee.text !== 'URL') return undefined
  const first = node.arguments?.at(0)
  if (first === undefined || !isStringLiteral(first)) return undefined
  return first.text
}

/**
 * Walk one file: collect call sites attributed to their enclosing declaration, the declaration
 * nodes themselves, and any `new URL` module edge.
 *
 * **A member call is an edge to both halves.** `FabricNode.start(…)` reaches `FabricNode` *and*
 * `start`, because a bare `NAME(` detector excludes static-method entry by construction — and
 * that single omission is most of the naive tracer's 102 false findings.
 */
function walkFile(
  statements: readonly Node[],
  relFile: string,
  calls: CallSite[],
  references: CallSite[],
  declared: string[],
  urlEdges: string[],
): void {
  const visit = (node: Node, caller: string, inSpecifierStatement: boolean): void => {
    let here = caller
    // An `import { X } from …` or `export { X } from …` NAMES a symbol without using it. Letting
    // those contribute reference edges would make a barrel a CALLER, which is the one thing this
    // repository has already settled: every statement in all eight barrels is `export … from`, so
    // counting one as a caller makes every exported symbol look wired and the guard vacuous.
    // Measured: without this exclusion `estimatePi` reads REACHED, because `@o2/demo`'s barrel
    // re-exports it by name.
    //
    // **This line read "`estimatePi` — which nothing anywhere calls" until 2026-08-10, and that
    // clause has been false since `0d1fcb5`**: `packages/browser/demo/main.ts:841` calls it
    // inside `runPi`. The measurement it reports is unaffected — a barrel re-export would make
    // the symbol read REACHED whether or not anything called it, which is the entire point of
    // the exclusion — but the parenthetical was doing work it had no right to, since a reader
    // could take it as evidence about the tree rather than about this branch. `estimatePi` is
    // unreachable *to this tracer* because its one caller is a method of the object literal
    // assigned to `window.o2`; it is disposed under `global-object-hop` in
    // `reachability-dispositions.ts`, and `reachability-guard.node.test.ts` derives that class
    // rather than listing it.
    // A TYPE POSITION is not a call path, and this is the second thing that had to be excluded
    // for the reference class to mean anything. `bin/agent.ts` writes `let node: FabricNode |
    // undefined`; counting that annotation as a reference kept `FabricNode` reachable even with
    // its only real call site removed, so PLANT A AT `FabricNode.start` CHANGED NOTHING AT ALL.
    // The plant is what found it — reading the code did not.
    const specifierStatement =
      inSpecifierStatement ||
      isImportDeclaration(node) ||
      isExportDeclaration(node) ||
      isTypeReferenceNode(node) ||
      isTypeQueryNode(node)
    const name = declaredNameOf(node)
    if (name !== undefined) {
      here = nodeId(relFile, name)
      declared.push(here)
    }
    const workerSpecifier = workerUrlSpecifier(node)
    if (workerSpecifier !== undefined) urlEdges.push(workerSpecifier)

    // A bare identifier that is not the callee of this node. In JavaScript, holding a reference
    // to a function IS how you call it later — `bench.ts` writes `runnerFor(memoryFabric)`, and
    // a tracer that only sees `NAME(` reports `memoryFabric` and everything below it dead. That
    // is an UNDER-connection, and under-connection is the dangerous direction for a guard that
    // gates commits: it manufactures findings that are not real, and a guard that cries wolf
    // gets deleted. Kept switchable so its cost is measured rather than assumed.
    if (isIdentifier(node) && !specifierStatement) {
      references.push({ caller: here, callee: node, member: false })
    }

    if (isCallExpression(node) || isNewExpression(node)) {
      const callee = node.expression
      if (isIdentifier(callee)) {
        calls.push({ caller: here, callee, member: false })
      } else if (isPropertyAccessExpression(callee)) {
        // Both halves. `FabricNode.start(…)` reaches the class AND the method — a bare `NAME(`
        // detector excludes static-method entry by construction, and that one omission is most
        // of the naive tracer's 102 false findings.
        const member = callee.name
        if (isIdentifier(member)) calls.push({ caller: here, callee: member, member: true })
        const object = callee.expression
        if (isIdentifier(object)) calls.push({ caller: here, callee: object, member: true })
      }
    }
    // The `.name` half of `X.y` belongs to the MEMBER class, never to the reference class.
    // Without this split the two are not separable: collecting `start` from `FabricNode.start`
    // as a bare reference made the member ablation change nothing at all, so a class the plan
    // calls load-bearing could not be shown to be. The object half (`FabricNode`) IS a genuine
    // reference and keeps its own edge, which is why the two ablations flip different anchors.
    if (isPropertyAccessExpression(node)) {
      visit(node.expression, here, specifierStatement)
      return
    }
    node.forEachChild((child) => {
      visit(child, here, specifierStatement)
      return undefined
    })
  }
  for (const statement of statements) visit(statement, nodeId(relFile, MODULE_MEMBER), false)
}

/** What {@link buildCallGraph} may be pointed at. */
export interface CallGraphOptions {
  readonly root?: string
  /** Directories walked for source. Defaults to `packages` and `tools`. */
  readonly sourceRoots?: readonly string[]
  /** Entry-point modules. Defaults to {@link ENTRY_POINTS}. */
  readonly entryPoints?: readonly string[]
  /** Include `new URL(…)` worker edges. Default `true` — a switch so the class can be planted off. */
  readonly urlWorkerEdges?: boolean
  /** Include `?worker` import edges. Default `true` — likewise. */
  readonly viteWorkerEdges?: boolean
  /** Resolve member-expression calls. Default `true` — likewise. */
  readonly memberEdges?: boolean
  /** Resolve static import / barrel re-export edges. Default `true` — likewise. */
  readonly importEdges?: boolean
  /**
   * Treat a reference to a callable declaration as an edge. Default `true`.
   *
   * The fifth class, and it is not in 22-01's plan because the plan did not know it was needed.
   * It was added after measurement, not before: without it `bin/bench.ts`'s
   * `runnerFor(memoryFabric)` creates no edge and `MemoryNetwork` reads unreached while a real
   * benchmark builds one on every run. The spec records what turning it off costs.
   */
  readonly referenceEdges?: boolean
  /**
   * Count a reference to a `const`-arrow as a reference to a callable. Default `true`.
   *
   * The **sixth** class, added 2026-08-13, and switchable for the same reason the five above are:
   * so its cost can be planted off and measured rather than argued about. Turning it off drops
   * `core/executeVerified` — see {@link declaresAFunction} for what that symbol is and why the
   * repair is narrower than "the referenced constant has a call signature".
   */
  readonly callableConstReferences?: boolean
  /**
   * Resolve a name destructured from `await import(…)` to the module export it names.
   * Default `true`.
   *
   * The **seventh**, added 2026-08-13. Turning it off restores the state in which
   * `core/describeStartReport` had an in-degree of zero — see {@link dynamicImportBinding}.
   */
  readonly dynamicImportEdges?: boolean
}

/**
 * Build the graph — the second of this module's two loaders.
 *
 * Callees are resolved **through the checker**, in one batched request per file, not by matching
 * names. That is what makes a barrel a conduit for free: a call to `submitJob` in a file that
 * imported `@o2/core` resolves straight to `packages/core/src/job/submit.ts#submitJob`, and the
 * barrel never appears as a caller. It is also what makes `FabricNode.start` land on the method
 * rather than on a same-named method somewhere else in the tree.
 */
export function buildCallGraph(options: CallGraphOptions = {}): CallGraph {
  const root = options.root ?? REPO_ROOT
  const sourceRoots = options.sourceRoots ?? ['packages', 'tools']
  const entryPoints = options.entryPoints ?? ENTRY_POINTS
  const wantUrlWorker = options.urlWorkerEdges ?? true
  const wantViteWorker = options.viteWorkerEdges ?? true
  const wantMember = options.memberEdges ?? true
  const wantImports = options.importEdges ?? true
  const wantReferences = options.referenceEdges ?? true
  const wantCallableConsts = options.callableConstReferences ?? true
  const wantDynamicImports = options.dynamicImportEdges ?? true

  const files = sourceFilesUnder(root, sourceRoots)
  // Lower-cased index, for the reason {@link relativeTo} records: the API hands back lowercased
  // paths, so membership has to be asked case-insensitively while the graph keeps disk casing.
  const fileIndex = new Map(files.map((file) => [file.toLowerCase(), file]))
  const inCorpus = (candidate: string): string | undefined => fileIndex.get(candidate.toLowerCase())
  const api = new API({ cwd: root })
  try {
    const projects = api.updateSnapshot({ openProjects: [join(root, 'tsconfig.json')] }).getProjects()
    const project = projects[0]
    if (projects.length !== 1 || project === undefined) {
      throw new Error(`expected exactly 1 project, got ${projects.length}`)
    }
    const checker = project.checker

    const nodes = new Set<string>()
    const calls = new Map<string, Set<string>>()
    const imports = new Map<string, Set<string>>()
    const seenNames = new Map<string, number>()
    const collisions: string[] = []

    const addEdge = (map: Map<string, Set<string>>, from: string, to: string): void => {
      if (from === to) return
      const set = map.get(from) ?? new Set<string>()
      set.add(to)
      map.set(from, set)
    }

    // A declaration handle resolved to its AST node, memoised. Two of the edge classes below have
    // to read the declaration rather than the symbol's flags, and the same handle is asked about
    // once per reference to the name — `runOn` alone is asked twice, and a shared helper is asked
    // hundreds of times. Keyed on path + index because that pair IS the handle's identity.
    const nodeCache = new Map<string, Node | undefined>()
    const declarationNode = (handle: NodeHandle): Node | undefined => {
      const key = `${handle.path}:${handle.index}`
      if (nodeCache.has(key)) return nodeCache.get(key)
      const resolved = handle.resolve()
      nodeCache.set(key, resolved)
      return resolved
    }

    // One module's export table, by name, memoised. Only ever built for a file some
    // `await import(…)` actually names, so the eight barrels are the realistic population.
    const exportTables = new Map<string, ReadonlyMap<string, TsSymbol> | undefined>()
    const exportsOf = (relTarget: string): ReadonlyMap<string, TsSymbol> | undefined => {
      const cached = exportTables.get(relTarget)
      if (cached !== undefined || exportTables.has(relTarget)) return cached
      const targetFile = project.program.getSourceFile(join(root, relTarget))
      const moduleSymbol =
        targetFile === undefined ? undefined : checker.getSymbolAtLocation(targetFile)
      const table =
        moduleSymbol === undefined
          ? undefined
          : new Map(checker.getExportsOfModule(moduleSymbol).map((entry) => [entry.name, entry]))
      exportTables.set(relTarget, table)
      return table
    }

    for (const relFile of files) {
      const sourceFile = project.program.getSourceFile(join(root, relFile))
      if (sourceFile === undefined) continue
      const moduleNode = nodeId(relFile, MODULE_MEMBER)
      nodes.add(moduleNode)

      // --- module → module, three of the four edge classes ---
      for (const specifier of sourceFile.imports ?? []) {
        if (!isStringLiteral(specifier)) continue
        const text = specifier.text
        const isViteWorker = text.includes('?worker')
        if (isViteWorker && !wantViteWorker) continue
        if (!isViteWorker && !wantImports) continue
        const resolvedSpecifier = resolveSpecifier(relFile, text)
        const target = resolvedSpecifier === undefined ? undefined : inCorpus(resolvedSpecifier)
        if (target === undefined) continue
        addEdge(imports, relFile, target)
        addEdge(calls, moduleNode, nodeId(target, MODULE_MEMBER))
      }

      // --- declarations and call sites ---
      const callSites: CallSite[] = []
      const referenceSites: CallSite[] = []
      const declared: string[] = []
      const urlEdges: string[] = []
      walkFile([...(sourceFile.statements ?? [])], relFile, callSites, referenceSites, declared, urlEdges)
      // References are resolved in the same batch as calls, and only kept when the resolved
      // symbol is itself CALLABLE — a reference to a type or a constant is not a call path.
      const sites: CallSite[] = wantReferences ? [...callSites, ...referenceSites] : callSites

      for (const declaredId of declared) {
        const count = (seenNames.get(declaredId) ?? 0) + 1
        seenNames.set(declaredId, count)
        if (count === 2) collisions.push(declaredId)
        nodes.add(declaredId)
      }

      if (wantUrlWorker) {
        for (const specifier of urlEdges) {
          const resolvedSpecifier = resolveSpecifier(relFile, specifier)
          const target = resolvedSpecifier === undefined ? undefined : inCorpus(resolvedSpecifier)
          if (target === undefined) continue
          addEdge(imports, relFile, target)
          addEdge(calls, moduleNode, nodeId(target, MODULE_MEMBER))
        }
      }

      if (sites.length === 0) continue
      const resolved: (TsSymbol | undefined)[] = checker.getSymbolAtLocation(
        sites.map((site) => site.callee),
      )
      for (let i = 0; i < sites.length; i++) {
        const site = sites[i]
        let symbol = resolved[i]
        if (site === undefined || symbol === undefined) continue
        // The member-expression edge class, switchable so it can be planted off on its own.
        if (site.member && !wantMember) continue
        if ((symbol.flags & SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol)
        let declaration = symbol.declarations[0]
        if (declaration === undefined) continue
        // `const { x } = await import('@o2/core')` — the identifier resolves to a local
        // BindingElement, so without this hop the edge lands on a node id in the importing file
        // that nothing declares, and the module's real declaration keeps an in-degree of ZERO.
        // Redirected to the export before anything downstream reads the symbol, so the classify
        // filter, the declaration path and the callee name all see the published declaration —
        // which is exactly the state a static `import { x } from '@o2/core'` arrives in, by alias.
        if (wantDynamicImports && declaration.kind === SyntaxKind.BindingElement) {
          const bindingNode = declarationNode(declaration)
          const binding = bindingNode === undefined ? undefined : dynamicImportBinding(bindingNode)
          const specified =
            binding === undefined
              ? undefined
              : resolveSpecifier(relativeTo(root, declaration.path), binding.specifier)
          const targetFile = specified === undefined ? undefined : inCorpus(specified)
          const entry =
            targetFile === undefined || binding === undefined
              ? undefined
              : exportsOf(targetFile)?.get(binding.exportName)
          if (entry !== undefined) {
            const published =
              (entry.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(entry) : entry
            const publishedDeclaration = published.declarations[0]
            if (publishedDeclaration !== undefined) {
              symbol = published
              declaration = publishedDeclaration
            }
          }
        }
        // A reference only counts when what it names can actually be called. Referencing a type
        // or a plain constant is not a path to anything, and counting it would rebuild the
        // 54-answer: "the name appears somewhere in a reachable module".
        //
        // **A `const`-arrow is the exception, and it is asked of the DECLARATION rather than of
        // the flags.** `classify` reads `SymbolFlags`, where `const f = () => {}` is a
        // `BlockScopedVariable` and classifies `other-value`; the arrow it initialises is a
        // callable body all the same. {@link declaresAFunction} is the same predicate the walk
        // uses to decide this declaration deserves a node at all, so the two halves of the
        // relation cannot drift apart.
        if (
          i >= callSites.length &&
          classify({ barrel: '', name: symbol.name, flags: symbol.flags, declaredIn: '' }) !==
            'callable' &&
          !(
            wantCallableConsts &&
            declaration.kind === SyntaxKind.VariableDeclaration &&
            initialisesAFunction(declarationNode(declaration))
          )
        ) {
          continue
        }
        // Only edges into the walked corpus. A call into `node:fs` or a dependency is real and
        // is deliberately not a node here: this instrument answers a question about this
        // repository's own declarations.
        const target = inCorpus(relativeTo(root, declaration.path))
        if (target === undefined) continue
        const calleeId = nodeId(target, symbol.name)
        addEdge(calls, site.caller, calleeId)
        nodes.add(calleeId)
      }
    }

    return {
      nodes,
      calls,
      imports,
      files,
      roots: entryPoints.map((entry) => nodeId(entry, MODULE_MEMBER)),
      collisions: collisions.sort(),
    }
  } finally {
    api.close()
  }
}

// ---------------------------------------------------------------------------
// Plan 22-02 — the verdict, and the sentence a reader can act on
// ---------------------------------------------------------------------------

/** One unreachable barrel export, as data rather than as a rendered string. */
export interface UnreachableVerdict {
  /** The package barrel that publishes it — `core`, `browser`, … */
  readonly barrel: string
  /** The exported name. */
  readonly symbol: string
  /** Repo-relative file the declaration lives in. */
  readonly declaredIn: string
  /**
   * Production callers the graph found, if any. Empty means nothing in the tree calls it;
   * non-empty means it is called, but only from somewhere itself unreachable — a materially
   * different fact, and one a reader has to have in order to act.
   *
   * **Same-file callers count, and until 2026-08-11 they were dropped here.** The field was
   * built by filtering out every caller declared in the finding's own file, which made a symbol
   * called from the line below it render as *"no production code calls it"* — the one sentence
   * this docblock exists to keep honest. Restored by `reachability-guard.node.test.ts`'s
   * one-edge case, which was watched red against the filter before it was removed.
   */
  readonly callers: readonly string[]
}

/**
 * One line per finding: the symbol, the barrel it came from, and the reason.
 *
 * **Pure over a plain object.** No path, no file system, no walk — so a planted verdict can be
 * handed straight to it. That is `purity.node.test.ts`'s reason for splitting `violationsIn` out
 * of its scan, and it is the only thing that makes `expect(list).toEqual([])` mean *"looked and
 * saw nothing"* rather than *"did not look"*.
 *
 * The message names both halves because a count cannot be acted on: this corpus is 604 exports
 * across eight barrels, and *"a violation was found"* would leave a reader grepping. The two
 * reasons are kept distinct for the same purpose — *"nothing calls it"* and *"its only callers
 * are themselves unreachable"* need different work from whoever picks them up.
 *
 * **Nothing here keys on node kind.** A finding about `browser/BrowserNode` and one about
 * `node/FabricNode` render identically and are excused on identical terms — see `22-CONTEXT.md`
 * § the cardinal rule, and the retraction at `0314208`.
 */
export function describeUnreachable(verdicts: readonly UnreachableVerdict[]): string[] {
  return verdicts.map((verdict) => {
    const reason =
      verdict.callers.length === 0
        ? 'no production code calls it'
        : `its only callers are themselves unreachable (${verdict.callers.slice(0, 2).join(', ')})`
    return (
      `@o2/${verdict.barrel} exports "${verdict.symbol}" (${verdict.declaredIn}) — ` +
      `${reason}, so no path reaches it from any of the ${ENTRY_POINTS.length} entry points`
    )
  })
}

/**
 * The guard's reading: every callable barrel export with no traced path from an entry point.
 *
 * Pure over the three things it needs, so the guard can drive it with a planted corpus, a planted
 * graph, or both — which is what makes the empty-corpus and empty-edge-set cases checkable at all.
 */
export function unreachableExports(
  exports: readonly ClassifiedExport[],
  graph: CallGraph,
  root: string,
): UnreachableVerdict[] {
  const reached = reachableFrom(graph.calls, graph.roots)
  const callers = new Map<string, string[]>()
  for (const [from, targets] of graph.calls) {
    for (const target of targets) {
      const list = callers.get(target) ?? []
      list.push(from)
      callers.set(target, list)
    }
  }
  const found: UnreachableVerdict[] = []
  for (const one of exports) {
    if (one.kind !== 'callable') continue
    const file = relativeTo(root, one.declaredIn)
    const id = nodeId(file, one.name)
    if (reached.has(id)) continue
    found.push({
      barrel: one.barrel,
      symbol: one.name,
      declaredIn: file,
      // Copied before sorting — `callers` holds the index's own arrays, and `sort` is in place.
      callers: [...(callers.get(id) ?? [])].sort(),
    })
  }
  return found.sort((a, b) => `${a.barrel}/${a.symbol}`.localeCompare(`${b.barrel}/${b.symbol}`))
}
