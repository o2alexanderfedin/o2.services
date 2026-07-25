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

/** Packages that must run unchanged in Node, a browser, and a Worker. */
const PORTABLE = ['core', 'net']

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

describe('the kernel is unchanged by the arrival of a network', () => {
  it('has no uncommitted or committed change to packages/core on this branch', () => {
    // Criterion 1 of Phase 2 stated as an executable check. `develop` is the
    // pre-phase baseline; a non-empty diff means the transport swap needed the
    // kernel's help, which would mean the port boundary was drawn wrong.
    //
    // Skipped rather than failed once the branch has been merged and `develop`
    // has moved on — at that point the claim is history, not a live invariant.
    const merged = execFileSync('git', ['branch', '--contains', 'HEAD', '--list', 'develop'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    if (merged !== '') return

    const diff = execFileSync('git', ['diff', '--name-only', 'develop', '--', 'packages/core'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()

    expect(diff).toBe('')
  })
})
