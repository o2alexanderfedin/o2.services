import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * DEMO-04 — publishing is a human act, and the repository is built so it cannot
 * become an automatic one.
 *
 * Public hosting is public disclosure. EPO and China have no patent grace period,
 * so anything published there is permanently forfeit; the US provisional window is
 * the only one still open. That makes "deploy on push" not a convenience but an
 * irreversible legal event triggered by a `git push`.
 *
 * The constraint is therefore *absence*, not configuration. A workflow that is
 * disabled, commented out, or `workflow_dispatch`-only is one edit — or one
 * well-meaning "let's just re-enable CI" — away from firing. So the file may not
 * exist, and this test is what keeps it from quietly coming back.
 *
 * The same reasoning covers `package.json`: a `deploy` script is a deploy workflow
 * with extra steps. Building is fine and is deliberately *not* restricted — the
 * artifact has to be buildable and testable. Only the step that makes it public is
 * forbidden, and only a human may take it.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Pruned during the walk. `node_modules` alone is ~170 top-level packages of
 * third-party CI config that says nothing about this repository's intent, and
 * `dist` is generated. Neither can cause a disclosure.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist'])

interface Tree {
  /** Repo-relative POSIX paths of every directory reached. */
  readonly dirs: readonly string[]
  /** Repo-relative POSIX paths of every file reached. */
  readonly files: readonly string[]
}

function toPosix(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join('/')
}

/** Whole working tree, pruned — not just what git tracks, because an untracked or
 * gitignored workflow file still deploys. */
function walk(): Tree {
  const dirs: string[] = []
  const files: string[] = []
  const queue: string[] = [ROOT]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        dirs.push(toPosix(path))
        queue.push(path)
      } else if (entry.isFile()) {
        files.push(toPosix(path))
      }
    }
  }
  return { dirs, files }
}

const TREE: Tree = walk()

/** Every path git knows about, as a second independent view of the same question. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)
}

function isUnderDotGithub(path: string): boolean {
  return path.split('/').includes('.github')
}

function isYaml(path: string): boolean {
  return path.endsWith('.yml') || path.endsWith('.yaml')
}

/**
 * Command fragments that make something public. Each carries the reason, because a
 * bare list of tool names invites someone to add a ninth entry without asking
 * whether the list is the point.
 */
const PUBLISHING: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bgh-pages\b/, why: 'gh-pages pushes a build to a branch GitHub serves publicly' },
  { pattern: /\bnpm\s+publish\b/, why: 'npm publish puts the source on a public registry' },
  { pattern: /\bnetlify\s+deploy\b/, why: 'netlify deploy publishes to a public URL' },
  { pattern: /\bvercel\b/, why: 'the vercel CLI deploys by default, with no subcommand' },
  { pattern: /\bwrangler\s+(?:publish|deploy)\b/, why: 'wrangler publishes to Cloudflare' },
  { pattern: /\bfirebase\s+deploy\b/, why: 'firebase deploy publishes to a public URL' },
  { pattern: /\baws\s+s3\s+sync\b/, why: 'an s3 sync is how a static site reaches a public bucket' },
  { pattern: /\bsurge\b/, why: 'surge publishes a static directory to a public URL' },
]

/**
 * Script *names* that are forbidden regardless of what they run. `deploy` is the
 * name a person types when they want the thing this constraint exists to prevent,
 * and naming it that way is how it acquires a body later.
 */
const FORBIDDEN_SCRIPT_NAME = /^deploy(?::|$)/

interface Manifest {
  readonly path: string
  readonly scripts: Readonly<Record<string, string>>
}

function manifests(): Manifest[] {
  const found: Manifest[] = []
  for (const path of TREE.files) {
    if (basename(path) !== 'package.json') continue
    const parsed: unknown = JSON.parse(readFileSync(join(ROOT, path), 'utf8'))
    const scripts =
      typeof parsed === 'object' && parsed !== null && 'scripts' in parsed
        ? (parsed as { scripts?: Record<string, string> }).scripts
        : undefined
    found.push({ path, scripts: scripts ?? {} })
  }
  return found
}

describe('the repository root this suite is checking is the real one', () => {
  /**
   * Every assertion below is of the form "nothing matched". A wrong `ROOT` — an
   * empty temp directory, a path with one `..` too many — satisfies all of them
   * perfectly. So the path is proved before it is trusted.
   */
  it('contains the marker files that only this repository has', () => {
    expect(existsSync(join(ROOT, 'package.json'))).toBe(true)
    expect(existsSync(join(ROOT, '.planning'))).toBe(true)
    expect(existsSync(join(ROOT, 'packages', 'node', 'src'))).toBe(true)
  })

  it('was actually walked, so an empty scan cannot pass for a clean scan', () => {
    // If pruning or a permissions error silently emptied the walk, every check
    // below would pass while checking nothing.
    expect(TREE.files.length).toBeGreaterThan(100)
    expect(TREE.dirs).toContain('packages/node/src')
    expect(TREE.files).toContain('package.json')
  })

  it('is a git repository with tracked files, so the git-side view is real too', () => {
    expect(trackedFiles().length).toBeGreaterThan(100)
  })
})

describe('no deploy workflow exists, so no push can publish', () => {
  it('has no .github/workflows directory — absence, not a disabled workflow', () => {
    // A disabled or `workflow_dispatch`-only workflow is one edit from firing, and
    // firing once is permanent. The file has to not be here.
    expect(existsSync(join(ROOT, '.github', 'workflows'))).toBe(false)
  })

  it('has no .github directory at all, at the root or anywhere below it', () => {
    // Checked at every depth rather than only at the root: a nested `.github` is
    // still read by GitHub for some features, and more to the point, "we moved it"
    // is exactly the shape this constraint erodes into.
    expect(TREE.dirs.filter(isUnderDotGithub)).toEqual([])
    expect(trackedFiles().filter(isUnderDotGithub)).toEqual([])
  })

  it('has no workflow file under any .github path, tracked or untracked', () => {
    // Untracked counts. A gitignored workflow file still runs, and would not show
    // up in `git ls-files` at all.
    const fromDisk = TREE.files.filter((path) => isUnderDotGithub(path) && isYaml(path))
    const fromGit = trackedFiles().filter((path) => isUnderDotGithub(path) && isYaml(path))
    expect([...fromDisk, ...fromGit]).toEqual([])
  })

  it('has no file anywhere that is a GitHub Actions workflow by content', () => {
    /**
     * The directory checks above are defeated by renaming the directory. This one
     * is not: it asks what the file *is* rather than where it sits. A GitHub
     * Actions workflow is identifiable by a top-level `jobs:` map together with a
     * runner or an action reference — specific enough that an ordinary YAML config
     * (a linter, a CI-less tool) does not match.
     */
    const workflows = TREE.files.filter((path) => {
      if (!isYaml(path)) return false
      const source = readFileSync(join(ROOT, path), 'utf8')
      const declaresJobs = /^jobs:\s*$/m.test(source)
      const declaresRunner = /^\s*(?:runs-on:|uses:\s*actions\/)/m.test(source)
      return declaresJobs && declaresRunner
    })
    expect(workflows).toEqual([])
  })
})

describe('no package script publishes anything', () => {
  const found = manifests()

  it('finds the root manifest and every workspace manifest', () => {
    // Anti-vacuity again: zero manifests would make the next two checks silent.
    expect(found.map((m) => m.path)).toContain('package.json')
    expect(found.length).toBeGreaterThanOrEqual(7)
  })

  it('runs no publishing command from any manifest, root or workspace', () => {
    const violations: string[] = []
    for (const { path, scripts } of found) {
      for (const [name, body] of Object.entries(scripts)) {
        for (const { pattern, why } of PUBLISHING) {
          if (pattern.test(body)) violations.push(`${path} → "${name}": ${body} — ${why}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('declares no script named "deploy", whatever it might contain', () => {
    const violations: string[] = []
    for (const { path, scripts } of found) {
      for (const name of Object.keys(scripts)) {
        if (FORBIDDEN_SCRIPT_NAME.test(name)) {
          violations.push(`${path} → "${name}" — publishing is a human act, not a script`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

describe('the demo is buildable, because building is not publishing', () => {
  /**
   * The constraint is deliberately asymmetric. Anyone must be able to produce the
   * artifact and test it against a static host; only a human, step by step, may put
   * it somewhere the public can reach. So `build:demo` is required to exist — its
   * absence would push someone toward improvising a one-off command that grows a
   * publish step.
   */
  const root = manifests().find((m) => m.path === 'package.json')

  it('offers a build:demo script', () => {
    expect(root?.scripts['build:demo']).toBeDefined()
  })

  it('builds and stops there, with nothing that reaches the network', () => {
    const body = root?.scripts['build:demo'] ?? ''
    expect(body).toContain('vite build')
    for (const { pattern } of PUBLISHING) expect(pattern.test(body)).toBe(false)
  })
})
