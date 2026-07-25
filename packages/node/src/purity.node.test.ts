import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Packages that must run unchanged in Node, a browser, and a Worker — and must not
 * reference libp2p either, because they also have to work over the in-process
 * transport.
 */
const PORTABLE = ['core', 'net']

/**
 * Packages that may use libp2p but still must not touch a platform.
 *
 * `@o2/libp2p` is the middle tier: both `@o2/node` and `@o2/browser` depend on it, so
 * a `node:` import here would break the browser build.
 */
const DUAL_TARGET = ['libp2p', 'browser']

/**
 * Import specifiers a portable package may not reference.
 *
 * `node:` covers builtins under the modern prefix. Bare `fs`/`path`-style
 * builtins are not listed because `verbatimModuleSyntax` plus the repo's ESM-only
 * stance makes them unusable anyway, and listing them would false-positive on any
 * local module with a similar name.
 */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /^node:/, why: 'a Node builtin does not exist in a browser' },
  { pattern: /^libp2p$/, why: 'libp2p belongs behind the Transport port, not in the kernel' },
  { pattern: /^@libp2p\//, why: 'libp2p modules belong in an adapter package' },
  { pattern: /^@chainsafe\//, why: 'libp2p crypto modules belong in an adapter package' },
  { pattern: /^@o2\/node$/, why: 'a portable package must not depend on the Node adapters' },
]

/** The subset of the above that also applies to the dual-target tier. */
const NO_PLATFORM: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /^node:/, why: 'a Node builtin does not exist in a browser' },
  { pattern: /^@o2\/node$/, why: 'a dual-target package must not depend on the Node adapters' },
]

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    found.push(join(entry.parentPath, entry.name))
  }
  return found
}

/** Every static import/export specifier in a source file. */
function specifiersOf(source: string): string[] {
  const found: string[] = []
  // Matches `from '…'` in imports and re-exports, plus bare `import '…'`.
  const pattern = /(?:from|import)\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier !== undefined) found.push(specifier)
  }
  return found
}

describe('portability of @o2/core and @o2/net', () => {
  for (const pkg of PORTABLE) {
    it(`@o2/${pkg} references no platform-specific module`, async () => {
      const files = await sourceFiles(join(ROOT, 'packages', pkg, 'src'))
      expect(files.length).toBeGreaterThan(0)

      const violations: string[] = []
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        for (const specifier of specifiersOf(source)) {
          for (const { pattern, why } of FORBIDDEN) {
            if (pattern.test(specifier)) {
              violations.push(`${file.slice(ROOT.length)} imports "${specifier}" — ${why}`)
            }
          }
        }
      }

      expect(violations).toEqual([])
    })

    it(`@o2/${pkg} declares no platform-specific dependency`, () => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }

      const offending = Object.keys(manifest.dependencies ?? {}).filter((name) =>
        FORBIDDEN.some(({ pattern }) => pattern.test(name)),
      )
      expect(offending).toEqual([])
    })
  }
})

describe('dual-target packages touch no platform', () => {
  for (const pkg of DUAL_TARGET) {
    it(`@o2/${pkg} references no Node builtin`, async () => {
      const files = await sourceFiles(join(ROOT, 'packages', pkg, 'src'))
      expect(files.length).toBeGreaterThan(0)

      const violations: string[] = []
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        for (const specifier of specifiersOf(source)) {
          for (const { pattern, why } of NO_PLATFORM) {
            if (pattern.test(specifier)) {
              violations.push(`${file.slice(ROOT.length)} imports "${specifier}" — ${why}`)
            }
          }
        }
      }
      expect(violations).toEqual([])
    })
  }
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
    expect(deps.filter((name) => name.startsWith('@o2/'))).toEqual([])
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
