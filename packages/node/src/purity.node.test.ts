import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocking, commitScope, pathFormProblems, trackedPaths } from './commit-scope.ts'

/**
 * The portability invariant, enforced structurally.
 *
 * Phase 2's acceptance bar was that adding a real network left `@o2/core`
 * byte-for-byte unchanged. That was true — but "was true once" is worth much less
 * than "cannot quietly stop being true". A single `import { tcp } from
 * '@libp2p/tcp'` in the kernel would compile, pass every Node test, and only fail
 * when someone next builds for a browser.
 *
 * So the rule is checked rather than remembered: the portable packages may not
 * reference a platform. `@o2/node` exists to hold everything that must.
 *
 * ## Scanned across every portable package, blocking on the commit
 *
 * The scan is unchanged and stays whole-package. What narrowed on 2026-08-04 is only what
 * a *commit* is refused for. A forbidden import is an exact, single-path fact — the file
 * that writes the import is the file that has to unwrite it, and no union applies — so
 * narrowing here costs nothing and stops this guard holding an agent editing `@o2/node`
 * for an import somebody else is mid-way through adding to `@o2/core`.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * The commit these findings are judged against, or `NO_COMMIT_SCOPE` outside a commit.
 *
 * Absence is strict: under `npm test` or a verifier every violation in every portable
 * package blocks, exactly as before.
 */
const SCOPE = commitScope()

/**
 * Packages that must run unchanged in Node, a browser, and a Worker — and must not
 * reference libp2p either, because they also have to work over the in-process
 * transport.
 */
const PORTABLE = ['core', 'net', 'bench', 'demo', 'aot']

/**
 * Packages that may use libp2p but still must not touch a platform.
 *
 * `@o2/libp2p` is the middle tier: both `@o2/node` and `@o2/browser` depend on it, so
 * a `node:` import here would break the browser build.
 */
const DUAL_TARGET = ['libp2p', 'browser']

/**
 * Directories under `packages/<pkg>` that this file scans, beyond `src`.
 *
 * `packages/browser/demo` is the Vite build root — `vite.config.ts` sets
 * `root: './demo'`, so `demo/main.ts` is bundled and served to real tabs. It is
 * shipping browser code by every meaning of the phrase, and until 2026-08-01 nothing
 * here looked at it: a `node:` import there would have broken the demo build and
 * passed this file. Scanning `src` alone was an omission, not a scoping decision, so
 * it is corrected rather than documented.
 *
 * `packages/demo` is a different thing despite the name — a package, scanned through
 * `PORTABLE` like any other.
 */
const EXTRA_ROOTS: Readonly<Record<string, readonly string[]>> = {
  browser: ['demo'],
}

/** Absolute directories to scan for one package. */
function rootsOf(pkg: string): string[] {
  return ['src', ...(EXTRA_ROOTS[pkg] ?? [])].map((dir) => join(ROOT, 'packages', pkg, dir))
}

/** One import rule: what to match, and why it is refused. */
interface Rule {
  readonly pattern: RegExp
  readonly why: string
}

/**
 * Import specifiers a portable package may not reference.
 *
 * `node:` covers builtins under the modern prefix. Bare `fs`/`path`-style
 * builtins are not listed because `verbatimModuleSyntax` plus the repo's ESM-only
 * stance makes them unusable anyway, and listing them would false-positive on any
 * local module with a similar name.
 */
const FORBIDDEN: readonly Rule[] = [
  { pattern: /^node:/, why: 'a Node builtin does not exist in a browser' },
  { pattern: /^libp2p$/, why: 'libp2p belongs behind the Transport port, not in the kernel' },
  { pattern: /^@libp2p\//, why: 'libp2p modules belong in an adapter package' },
  { pattern: /^@chainsafe\//, why: 'libp2p crypto modules belong in an adapter package' },
  { pattern: /^@o2\/node$/, why: 'a portable package must not depend on the Node adapters' },
]

/** The subset of the above that also applies to the dual-target tier. */
const NO_PLATFORM: readonly Rule[] = [
  { pattern: /^node:/, why: 'a Node builtin does not exist in a browser' },
  { pattern: /^@o2\/node$/, why: 'a dual-target package must not depend on the Node adapters' },
]

/**
 * `*.node.test.ts` is exempt, and only that suffix.
 *
 * The suffix is not a comment, it is the gate: `vitest.config.ts` excludes
 * `**​/*.node.test.ts` from the browser project, so such a file never runs anywhere
 * but Node and never reaches a bundle. `@o2/demo` commits a `.wasm` next to the
 * `.wat` it was compiled from, and the test that proves the two match has to read
 * both off disk. Refusing that would not make the package more portable — it would
 * only mean the committed binary went unchecked, which is a worse trade than the one
 * this rule exists to prevent.
 *
 * **This exemption costs no shipping code.** That is a claim about the suffix and
 * nothing else — it does not say the scan reaches everything the project ships, and
 * it must not be read as saying so. What the scan reaches is stated by `PORTABLE`,
 * `DUAL_TARGET` and {@link EXTRA_ROOTS}, and it was wrong for a while: the sentence
 * that used to sit here read as a universal guarantee while `packages/browser/demo`
 * — bundled by Vite and served to visitors — was outside every root.
 */
const NODE_ONLY_SPEC = /\.node\.test\.ts$/

async function sourceFiles(dirs: readonly string[]): Promise<string[]> {
  const found: string[] = []
  for (const dir of dirs) {
    // `readdir` throws for a root that is not there, and that is the wanted
    // behaviour: a scanned root that has been moved must fail by name rather than
    // contribute nothing and let the remaining roots carry an unchanged assertion.
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      if (NODE_ONLY_SPEC.test(entry.name)) continue
      found.push(join(entry.parentPath, entry.name))
    }
  }
  return found
}

/**
 * Every import/export specifier in a source file.
 *
 * The optional `(` covers `await import('…')`, which the pattern did not reach until
 * 2026-08-01. That was a hole rather than a scoping choice: a portable package could
 * have loaded a Node builtin dynamically and this file would have reported it clean.
 * Five dynamic imports exist across the scanned roots today — `multiformats/cid` in
 * `core/src/reduce.ts` and four in `browser/demo/main.ts` — and none of them is
 * forbidden, so closing the hole changed no verdict. It was found by writing the
 * instrument check below, which is the argument for having one.
 */
function specifiersOf(source: string): string[] {
  const found: string[] = []
  // `from '…'` in imports and re-exports, bare `import '…'`, and `import('…')`.
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier !== undefined) found.push(specifier)
  }
  return found
}

/**
 * The forbidden imports in one file's source, rendered.
 *
 * Split out from the walk for the reason `mutation-ledger.ts` splits `problemsWith`
 * out of its own scan: every assertion in this file has the form
 * `expect(violations).toEqual([])`, and a `specifiersOf` that returned nothing —
 * after a regex edit, or against a syntax its pattern does not reach — would satisfy
 * all of them at once while reading exactly like a clean repository. A pure function
 * over a string can be handed a planted violation and required to find it, which is
 * the only way `[]` means "looked and saw nothing" rather than "did not look".
 */
function violationsIn(label: string, source: string, rules: readonly Rule[]): string[] {
  const found: string[] = []
  for (const specifier of specifiersOf(source)) {
    for (const { pattern, why } of rules) {
      if (pattern.test(specifier)) found.push(`${label} imports "${specifier}" — ${why}`)
    }
  }
  return found
}

/**
 * Repo-relative POSIX, which is the form `git ls-files` prints and a commit scope holds.
 *
 * `ROOT` carries a trailing slash, so the slice already drops the separator. This is the
 * one expression the whole narrowing depends on being right, and it is factored out so
 * that the round-trip case below reads the same code the findings do rather than a copy
 * of it.
 */
function relativeTo(absolute: string): string {
  return absolute.slice(ROOT.length)
}

/** The manifest of one package, as a path a commit can name. */
function manifestPath(pkg: string): string {
  return `packages/${pkg}/package.json`
}

describe('portability of @o2/core and @o2/net', () => {
  for (const pkg of PORTABLE) {
    it(`@o2/${pkg} references no platform-specific module`, async () => {
      const files = await sourceFiles(rootsOf(pkg))
      expect(files.length).toBeGreaterThan(0)

      const violations: { paths: string[]; line: string }[] = []
      let specifiers = 0
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        specifiers += specifiersOf(source).length
        const relative = relativeTo(file)
        // One path, exactly: an import is written in one file and removed from that same
        // file. Nothing else participates, so there is no union to take.
        violations.push(
          ...violationsIn(relative, source, FORBIDDEN).map((line) => ({ paths: [relative], line })),
        )
      }

      // The file list being non-empty is not the same as the *specifier* list being
      // non-empty, and it is the specifier list the verdict below is computed from.
      expect(specifiers, `${pkg}: read files but extracted no imports`).toBeGreaterThan(0)
      expect(blocking(`purity/${pkg}`, violations, SCOPE)).toEqual([])
    })

    it(`@o2/${pkg} declares no platform-specific dependency`, () => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }

      const offending = Object.keys(manifest.dependencies ?? {})
        .filter((name) => FORBIDDEN.some(({ pattern }) => pattern.test(name)))
        .map((name) => ({ paths: [manifestPath(pkg)], line: name }))
      expect(blocking(`purity/${pkg}/manifest`, offending, SCOPE)).toEqual([])
    })
  }
})

describe('dual-target packages touch no platform', () => {
  for (const pkg of DUAL_TARGET) {
    it(`@o2/${pkg} references no Node builtin`, async () => {
      const files = await sourceFiles(rootsOf(pkg))
      expect(files.length).toBeGreaterThan(0)

      const violations: { paths: string[]; line: string }[] = []
      let specifiers = 0
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        specifiers += specifiersOf(source).length
        const relative = relativeTo(file)
        violations.push(
          ...violationsIn(relative, source, NO_PLATFORM).map((line) => ({
            paths: [relative],
            line,
          })),
        )
      }
      expect(specifiers, `${pkg}: read files but extracted no imports`).toBeGreaterThan(0)
      expect(blocking(`purity/${pkg}`, violations, SCOPE)).toEqual([])
    })
  }

  it('scans the demo Vite actually bundles, not only packages/browser/src', async () => {
    // `EXTRA_ROOTS` is the whole of what puts `demo/main.ts` in jurisdiction, and a
    // root that quietly stopped resolving would take the file back out while every
    // assertion above stayed green. So the membership is asserted, not assumed.
    const files = await sourceFiles(rootsOf('browser'))
    expect(files.some((file) => file.endsWith('packages/browser/demo/main.ts'))).toBe(true)
  })
})

describe('the kernel does not depend on its adapters', () => {
  /**
   * Phase 2's criterion — "the kernel is byte-for-byte unchanged" — was verified at
   * the time with `git diff --name-only develop -- packages/core` returning empty,
   * and is recorded in `phases/phase-2-real-network/SUMMARY.md`. It is deliberately
   * *not* asserted here as a standing rule: that would forbid legitimate kernel
   * fixes, and it already did — Phase 3's blockstore conformance suite found a real
   * aliasing defect in `MemoryBlockstore` that had to be corrected in `@o2/core`.
   *
   * What endures is the dependency direction. Adapters may depend on the kernel;
   * the kernel may never depend on an adapter. That is what keeps a transport swap
   * a one-package change, and it is checked rather than remembered.
   */
  it('has no dependency edge from @o2/core to any adapter package', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages', 'core', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }

    const deps = Object.keys(manifest.dependencies ?? {})
      .filter((name) => name.startsWith('@o2/'))
      .map((name) => ({ paths: [manifestPath('core')], line: name }))
    expect(blocking('purity/core/dependency-direction', deps, SCOPE)).toEqual([])
  })

  it('is checked into git, so the Phase 2 claim stays reproducible', () => {
    // The verification above is only meaningful against real history. If the
    // kernel were untracked, `git diff` would have trivially returned empty and
    // the Phase 2 criterion would have been vacuously "met".
    const tracked = execFileSync('git', ['ls-files', 'packages/core/src'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(tracked.split('\n').filter((f) => f.endsWith('.ts')).length).toBeGreaterThan(5)
  })
})

describe('the scanner can fail — proved against planted source, not assumed', () => {
  /**
   * Every verdict in this file is "no violations", and there are three separate ways
   * to produce that from an instrument that is not working: `specifiersOf`'s regex
   * could stop matching, the rule list could stop being applied, or the two could be
   * wired together wrongly. None of them changes what a passing run looks like.
   *
   * This is the check `vocabulary.node.test.ts` and `disclosure-gate.node.test.ts`
   * both carry and this file did not. The gap mattered: this repository has already
   * shipped a pattern that matched nothing — the disclosure gate's
   * `wrangler pages deploy` — and every absence assertion built on it passed for as
   * long as it existed.
   */
  it('extracts the specifier forms the repository actually writes', () => {
    const source = [
      "import { readFileSync } from 'node:fs'",
      "import type { Foo } from '@o2/core'",
      "export { bar } from './local.ts'",
      "import '@libp2p/peer-id'",
      'const lazy = await import("node:path")',
    ].join('\n')
    expect(specifiersOf(source)).toEqual(['node:fs', '@o2/core', './local.ts', '@libp2p/peer-id', 'node:path'])
  })

  it('finds a planted Node builtin in a portable package', () => {
    const violations = violationsIn('planted.ts', "import { readFile } from 'node:fs/promises'\n", FORBIDDEN)
    expect(violations.length).toBe(1)
    // The refusal has to name the specifier and the reason. "A violation was found"
    // would leave a reader grepping for which import, in a package of hundreds.
    expect(violations[0]).toContain('node:fs/promises')
    expect(violations[0]).toContain('does not exist in a browser')
  })

  it('finds a planted libp2p import in a portable package', () => {
    const violations = violationsIn('planted.ts', "import { tcp } from '@libp2p/tcp'\n", FORBIDDEN)
    expect(violations.length).toBe(1)
    expect(violations[0]).toContain('@libp2p/tcp')
  })

  it('lets the dual-target tier import libp2p while still refusing a builtin', () => {
    // The two rule lists are different, and a test that only ever drove one of them
    // would not notice them being swapped.
    expect(violationsIn('planted.ts', "import { tcp } from '@libp2p/tcp'\n", NO_PLATFORM)).toEqual([])
    expect(violationsIn('planted.ts', "import { join } from 'node:path'\n", NO_PLATFORM).length).toBe(1)
  })

  it('reports nothing for source that imports nothing forbidden', () => {
    // The other direction. A classifier that flagged everything would also turn the
    // planted cases above green while being useless.
    expect(violationsIn('planted.ts', "import { publicNodes } from '@o2/core'\n", FORBIDDEN)).toEqual([])
  })

  it('emits repo-relative POSIX paths that a commit scope can match', async () => {
    // The residual fail-open of narrowing, checked from this guard's end. `relativeTo` is
    // one character away from emitting `/packages/…`: well-formed as a string, matching
    // no commit scope, and every violation in every portable package would then read as
    // somebody else's with no red and no output anywhere.
    //
    // A floor rather than an equality on membership, because `sourceFiles` walks the
    // filesystem rather than the index and a concurrent agent's untracked source file
    // legitimately appears. An equality would redden this guard for a file that is not
    // this commit's — which is the defect being fixed, reintroduced by its own check.
    const tracked = trackedPaths(ROOT)
    const attributable = [
      ...(await sourceFiles(rootsOf('core'))).map(relativeTo),
      ...PORTABLE.map(manifestPath),
      ...DUAL_TARGET.map(manifestPath),
    ]
    expect(pathFormProblems(attributable)).toEqual([])
    expect(attributable.filter((path) => tracked.has(path)).length).toBeGreaterThan(10)
    expect(attributable).toContain('packages/core/package.json')
    expect(attributable.some((path) => path.startsWith('packages/core/src/'))).toBe(true)
  })

  it('does not mistake a type annotation for an import', () => {
    // `packages/browser/demo/main.ts:61` is `let node: BrowserNode | null = null`,
    // which contains `node:` and is not an import of anything. Newly in jurisdiction
    // as of the `demo` root, so the false positive it would have caused is written
    // down here rather than discovered by a confusing red.
    expect(violationsIn('planted.ts', 'let node: BrowserNode | null = null\n', FORBIDDEN)).toEqual([])
  })
})
