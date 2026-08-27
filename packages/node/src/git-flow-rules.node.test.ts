import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The git-flow rules, exercised rather than read.
 *
 * ## Why this file exists at all
 *
 * Until 2026-08-26 these rules lived inline in `.githooks/pre-commit`, and nothing could
 * reach them: a hook runs only during a commit, so the only way to learn what it accepted
 * was to attempt one and watch. That is not a testable shape, and the consequence was
 * measurable — the naming rule had been a *warning* since it was written, and forty-four of
 * the repository's 108 branches carried names it warned about and admitted anyway.
 *
 * The rules moved to `.githooks/git-flow-rules.sh`, which takes its subject as arguments so
 * this file can run it directly. Every case below is the script itself deciding, not a
 * reimplementation of it agreeing with itself.
 *
 * ## What is NOT held here, stated so nobody reads more into a green run
 *
 * That git *invokes* these hooks. `pre-commit` and `pre-merge-commit` are wired by
 * `core.hooksPath`, and this file asserts that wiring and that both files are executable —
 * but a spec cannot make git run a hook without performing the commit it guards. The
 * invocation was watched by hand instead, and the readings are in the commit that added it.
 */

const RULES = fileURLToPath(new URL('../../../.githooks/git-flow-rules.sh', import.meta.url))

/** The script's verdict on one question: `true` for allowed, `false` for refused. */
function decides(args: readonly string[]): boolean {
  try {
    execFileSync('bash', [RULES, ...args], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** What the script printed while refusing — its message is half of what it is for. */
function refusalText(args: readonly string[]): string {
  try {
    execFileSync('bash', [RULES, ...args], { stdio: 'pipe' })
    return ''
  } catch (error) {
    const e: unknown = error
    if (typeof e === 'object' && e !== null && 'stderr' in e) {
      const { stderr } = e as { stderr: unknown }
      return stderr instanceof Buffer ? stderr.toString() : String(stderr)
    }
    return ''
  }
}

describe('the git-flow rules are reachable, and they are rules rather than advice', () => {
  it('is wired as the hooks path and both hooks are executable', () => {
    // **Resolved rather than compared as a string, and that is not pedantry.** The first
    // version of this case asserted the literal `.githooks` and went red against
    // `/Volumes/.../o2.services/.githooks` — git had stored an ABSOLUTE path. Which form is
    // stored matters below; what this line asserts is only that it points here.
    const configured = execFileSync('git', ['config', 'core.hooksPath'], {
      encoding: 'utf8',
    }).trim()
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim()
    expect(resolve(root, configured)).toBe(join(root, '.githooks'))
    for (const hook of ['pre-commit', 'pre-merge-commit', 'git-flow-rules.sh']) {
      const path = fileURLToPath(new URL(`../../../.githooks/${hook}`, import.meta.url))
      expect(existsSync(path), `${hook} is missing`).toBe(true)
      // A hook git cannot execute is a hook that silently does nothing, which is the one
      // failure mode a reader would never notice.
      expect(statSync(path).mode & 0o111, `${hook} is not executable`).not.toBe(0)
    }
  })

  /**
   * **A clone gets no enforcement until something wires it, and that was measured here.**
   *
   * `core.hooksPath` lives in `.git/config`, which is not part of the repository — so a
   * fresh clone has hooks on disk and nothing pointing git at them. Every rule in this file
   * would be inert and the tree would look identical. The `prepare` script is what closes
   * it: npm runs it on a plain `npm install`, which is the first thing anybody does.
   *
   * It ends in `|| true` deliberately. A clone without git, or an install from a tarball,
   * would otherwise fail on a line that is about discipline rather than about the build —
   * and the case above is what catches the wiring being absent, so the silence is covered.
   */
  it('wires a fresh clone through npm rather than assuming a machine already knows', () => {
    const pkg: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    )
    expect(typeof pkg === 'object' && pkg !== null && 'scripts' in pkg).toBe(true)
    if (typeof pkg !== 'object' || pkg === null || !('scripts' in pkg)) return
    const { scripts } = pkg as { scripts: Record<string, unknown> }
    expect(scripts['prepare']).toBe('git config core.hooksPath .githooks || true')
  })

  /**
   * The prefixes the work actually produces, all of them.
   *
   * `fix`, `chore`, `docs` and `test` are NOT git-flow's own four and are here because the
   * branches were: fifteen, thirteen, twelve and one of them on 2026-08-26. A list that
   * excluded them would be the old warning again, wearing a refusal's clothes.
   */
  const ALLOWED_PREFIXES = [
    'feature',
    'release',
    'hotfix',
    'bugfix',
    'support',
    'fix',
    'chore',
    'docs',
    'test',
  ] as const

  for (const prefix of ALLOWED_PREFIXES) {
    it(`admits ${prefix}/<name>`, () => {
      expect(decides(['check-name', `${prefix}/something-descriptive`])).toBe(true)
    })
  }

  it("admits the harness's own branch shape, which no person types", () => {
    expect(decides(['check-name', 'worktree-agent-a0b0d6213ce31a7b4'])).toBe(true)
  })

  it('refuses a prefix nobody declared, and says how to rename', () => {
    expect(decides(['check-name', 'wip/quick-thing'])).toBe(false)
    expect(refusalText(['check-name', 'wip/quick-thing'])).toContain('git branch -m')
  })

  it('refuses a bare name with no prefix at all', () => {
    expect(decides(['check-name', 'my-branch'])).toBe(false)
  })

  it('refuses a prefix with nothing after it', () => {
    // `feature/` is a prefix, not a branch. Admitting it would let the rule pass on a name
    // that says nothing about the work.
    expect(decides(['check-name', 'feature/'])).toBe(false)
  })

  it('refuses a harness-shaped name that is not the harness shape', () => {
    // The suffix is hex in every one this repository has produced. Matching loosely would
    // turn one exception into a free prefix anybody could reach for.
    expect(decides(['check-name', 'worktree-agent-not-hex'])).toBe(false)
  })
})

describe('merge direction — the rule the missing hook could not apply', () => {
  it('lets main take develop', () => {
    expect(decides(['check-merge', 'main', 'develop'])).toBe(true)
  })

  for (const source of ['hotfix/1.2.3', 'release/2.0.0']) {
    it(`lets main take ${source}`, () => {
      expect(decides(['check-merge', 'main', source])).toBe(true)
    })
  }

  for (const source of ['feature/anything', 'chore/anything', 'fix/anything']) {
    it(`refuses main taking ${source}`, () => {
      expect(decides(['check-merge', 'main', source])).toBe(false)
    })
  }

  it('names the route rather than only refusing', () => {
    expect(refusalText(['check-merge', 'main', 'feature/x'])).toContain('THROUGH develop')
  })

  it('lets develop take a topic branch', () => {
    expect(decides(['check-merge', 'develop', 'feature/x'])).toBe(true)
  })

  it('refuses develop taking main, because that inverts the flow', () => {
    // **This case carries the rule, and the HOOK cannot carry it.** In a healthy tree
    // `git merge-base main develop` is develop, so merging main into develop is a
    // fast-forward — and git does not invoke `pre-merge-commit` for one. Watched on
    // 2026-08-26: the merge printed `Already up to date.`, made a commit, exited 0, and the
    // hook never ran; `--no-ff` did not change it. The rule is still right and still fires
    // the moment the two have genuinely diverged, which is the only time the merge would
    // carry content. See `check_merge` for why `reference-transaction`, which could catch
    // the fast-forward, is deliberately not used.
    expect(decides(['check-merge', 'develop', 'main'])).toBe(false)
  })

  it('names the merge source from the environment, which is where a merge hook finds it', () => {
    // Measured on git 2.33.0: `MERGE_HEAD` does not exist yet when `pre-merge-commit` runs,
    // and `GITHEAD_<sha>=<name>` does. The first version of `merge_source` read only
    // MERGE_HEAD, gave up on every merge, and let two forbidden ones through while a green
    // spec said the rules were sound.
    const named = execFileSync('bash', [RULES, 'merge-source'], {
      encoding: 'utf8',
      env: { ...process.env, GITHEAD_0123456789abcdef: 'feature/from-the-environment' },
    }).trim()
    expect(named).toBe('feature/from-the-environment')
  })

  it('leaves topic-to-topic merges alone', () => {
    // A branch merging another branch is ordinary work and is not this rule's subject.
    expect(decides(['check-merge', 'feature/a', 'feature/b'])).toBe(true)
    expect(decides(['check-merge', 'fix/a', 'develop'])).toBe(true)
  })
})
