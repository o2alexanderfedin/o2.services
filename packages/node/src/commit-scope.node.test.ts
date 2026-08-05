import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  COMMIT_PATHS_VARIABLE,
  NO_COMMIT_SCOPE,
  blocking,
  commitScope,
  isLsFilesForm,
  parseCommitScope,
  partition,
  pathFormProblems,
  reportForeign,
  trackedPaths,
} from './commit-scope.ts'
import type { Finding } from './commit-scope.ts'

/**
 * `commit-scope.ts`, held to the four properties that are the whole safety of defect #39.
 *
 * Narrowing what a guard blocks on is a change that fails **silently** when it fails: a
 * scope that matches nothing, a path form nothing can match, or an attribution that names
 * one file where two participate, all produce a green run in which the guard blocked on
 * nothing at all. None of those has a symptom. So each is planted here and required to
 * behave, and the two that cannot be detected from inside — a plausible-but-wrong scope,
 * and the single-path regression — are held by a case that *watches the fail-open happen*
 * rather than by prose saying it must not.
 *
 * Node-only: reads `git ls-files` and the real filesystem.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** A scope file holding exactly these paths, NUL-separated as `git -z` writes them. */
function scopeFile(...paths: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'o2-scope-'))
  const path = join(dir, 'paths')
  writeFileSync(path, paths.map((entry) => `${entry}\0`).join(''))
  return path
}

/** The `translationCid` case in miniature: a ledger row broken by a new caller. */
const LEDGER_ROW: Finding = {
  paths: ['.planning/REQUIREMENTS.md', 'packages/core/src/manifest.ts'],
  line: 'MR-01: translationCid is called by packages/core/src/manifest.ts',
}

describe('absence means strict — the property the whole change rests on', () => {
  /**
   * Every other case here is about narrowing. This block is about the floor underneath
   * the narrowing: a guard run by `npm test`, by a verifier, or by a hook whose
   * environment did not reach the worker has no way to tell whose commit it is, and the
   * only safe answer to that is "block on everything".
   *
   * The inverse — returning an empty scope, which matches nothing — is the shape of
   * failure that leaves every guard green and guarding nothing.
   */
  it('reads no scope from an environment that does not name a file', () => {
    expect(commitScope({})).toBe(NO_COMMIT_SCOPE)
    expect(commitScope({ [COMMIT_PATHS_VARIABLE]: '' })).toBe(NO_COMMIT_SCOPE)
  })

  it('reads no scope from a file that is not there', () => {
    expect(commitScope({ [COMMIT_PATHS_VARIABLE]: join(tmpdir(), 'o2-no-such-scope-file') })).toBe(
      NO_COMMIT_SCOPE,
    )
  })

  it('reads no scope from an empty file — the /dev/null bypass, closed', () => {
    // `O2_COMMIT_PATHS_FILE=/dev/null` is the obvious way to try to switch the guards
    // off. It switches them to strict instead.
    expect(commitScope({ [COMMIT_PATHS_VARIABLE]: '/dev/null' })).toBe(NO_COMMIT_SCOPE)
    expect(parseCommitScope('')).toBe(NO_COMMIT_SCOPE)
    expect(parseCommitScope('\0\0\0')).toBe(NO_COMMIT_SCOPE)
  })

  it('blocks on every finding when there is no scope', () => {
    const findings: Finding[] = [LEDGER_ROW, { paths: ['docs/unrelated.md'], line: 'elsewhere' }]
    expect(partition(findings, NO_COMMIT_SCOPE).own).toEqual(findings)
    expect(partition(findings, NO_COMMIT_SCOPE).foreign).toEqual([])
    expect(blocking('planted', findings, NO_COMMIT_SCOPE)).toEqual([
      LEDGER_ROW.line,
      'elsewhere',
    ])
  })

  it('blocks on a finding that names no path at all', () => {
    // A guard that forgot to attribute must not thereby stop blocking. This is the
    // failure mode of a future guard added without reading this file.
    const orphan: Finding = { paths: [], line: 'a finding nobody attributed' }
    const scope = parseCommitScope('packages/core/src/manifest.ts\0')
    expect(partition([orphan], scope).own).toEqual([orphan])
    expect(partition([orphan], scope).foreign).toEqual([])
  })
})

describe('the union rule — a finding names every path that participates', () => {
  /**
   * The real fail-open of a naive narrowing, and the reason {@link Finding.paths} is
   * plural. `7717ade`: a requirements row said nothing calls `translationCid`, and a
   * concurrently running plan had just given it a caller. Two people participate — the
   * one who wrote the row and the one who wrote the caller — and the guard must hold
   * whichever of them is committing.
   */
  it('blocks the author of the caller', () => {
    const scope = parseCommitScope('packages/core/src/manifest.ts\0packages/core/src/other.ts\0')
    expect(partition([LEDGER_ROW], scope).own).toEqual([LEDGER_ROW])
  })

  it('blocks the author of the ledger row', () => {
    const scope = parseCommitScope('.planning/REQUIREMENTS.md\0')
    expect(partition([LEDGER_ROW], scope).own).toEqual([LEDGER_ROW])
  })

  it('does not block somebody who staged neither', () => {
    const scope = parseCommitScope('.planning/phases/phase-21/21-04-PLAN.md\0')
    expect(partition([LEDGER_ROW], scope).own).toEqual([])
    expect(partition([LEDGER_ROW], scope).foreign).toEqual([LEDGER_ROW])
  })

  it('watches the single-path regression fail open, rather than forbidding it in prose', () => {
    // The same finding attributed to the ledger alone — which is what a `path:` field
    // instead of a `paths:` array produces. The author of the caller now walks free and
    // nothing anywhere goes red. This case exists so that reducing the attribution is a
    // change somebody has to make against a test that already demonstrates its cost.
    const single: Finding = { paths: ['.planning/REQUIREMENTS.md'], line: LEDGER_ROW.line }
    const callerOnly = parseCommitScope('packages/core/src/manifest.ts\0')
    expect(partition([single], callerOnly).own).toEqual([])
    expect(partition([LEDGER_ROW], callerOnly).own).toEqual([LEDGER_ROW])
  })
})

describe('a scope this reader cannot trust is no scope', () => {
  /**
   * The producer is `git diff-index --name-only -z` in a shell script and the reader is
   * here. When they disagree the disagreement is silent, so every disagreement this
   * reader can detect is turned into strictness rather than into a scope that matches
   * fewer things than it should.
   */
  it('refuses a newline-separated file — the missing -z', () => {
    // Without `-z` git also C-quotes odd paths, but the newline is the form a
    // hand-written or "simplified" producer reaches for first.
    expect(parseCommitScope('a.ts\nb.ts\n')).toBe(NO_COMMIT_SCOPE)
  })

  it('refuses an absolute or dot-prefixed path', () => {
    expect(parseCommitScope('/Volumes/x/packages/core/src/a.ts\0')).toBe(NO_COMMIT_SCOPE)
    expect(parseCommitScope('./packages/core/src/a.ts\0')).toBe(NO_COMMIT_SCOPE)
    expect(parseCommitScope('packages\\core\\src\\a.ts\0')).toBe(NO_COMMIT_SCOPE)
  })

  it('discards the whole scope for one malformed entry, not just that entry', () => {
    // A partial discard leaves a scope that looks healthy and blocks on less than it
    // should. There is no reading of a malformed producer that justifies trusting the
    // rest of what it wrote.
    expect(parseCommitScope('packages/core/src/a.ts\0/etc/passwd\0')).toBe(NO_COMMIT_SCOPE)
  })

  it('accepts what git actually writes', () => {
    const path = scopeFile('packages/core/src/a.ts', 'docs/b.md')
    const scope = commitScope({ [COMMIT_PATHS_VARIABLE]: path })
    expect(scope).not.toBe(NO_COMMIT_SCOPE)
    expect(scope === NO_COMMIT_SCOPE ? [] : [...scope].toSorted()).toEqual([
      'docs/b.md',
      'packages/core/src/a.ts',
    ])
  })
})

describe('the path form is checked from both ends, because its drift has no symptom', () => {
  /**
   * The failure mode most likely to actually happen. A future `./` prefix or a leading
   * `/` in one guard makes every finding foreign — nothing goes red, nothing is printed,
   * and the guard stops blocking. Nothing about a passing run distinguishes it.
   *
   * So the assertion is a round trip against real git output rather than a spell-check:
   * form alone would accept `src/foo.ts` for a file at `packages/node/src/foo.ts`, which
   * is well-formed and matches nothing.
   */
  const TRACKED = trackedPaths(ROOT)

  it('accepts every path git tracks, and there are enough of them to mean something', () => {
    expect(TRACKED.size).toBeGreaterThan(300)
    expect(pathFormProblems([...TRACKED])).toEqual([])
  })

  it('round-trips git ls-files output through the scope parser unchanged', () => {
    const raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    const scope = parseCommitScope(raw)
    expect(scope).not.toBe(NO_COMMIT_SCOPE)
    expect(scope === NO_COMMIT_SCOPE ? 0 : scope.size).toBe(TRACKED.size)
    // Marker paths, so that "the set is the right size" is not the whole reading. Both
    // are long-tracked files: naming this file instead would make the case depend on
    // whether it happens to be staged, which is the one thing a round trip must not
    // depend on.
    expect(scope === NO_COMMIT_SCOPE ? false : scope.has('packages/node/src/strip-comments.ts')).toBe(
      true,
    )
    expect(scope === NO_COMMIT_SCOPE ? false : scope.has('.githooks/pre-commit')).toBe(true)
  })

  it('rejects each drift form by name, so a failure says which one happened', () => {
    expect(isLsFilesForm('packages/node/src/commit-scope.ts')).toBe(true)
    expect(isLsFilesForm('/packages/node/src/commit-scope.ts')).toBe(false)
    expect(isLsFilesForm('./packages/node/src/commit-scope.ts')).toBe(false)
    expect(isLsFilesForm('packages\\node\\src\\commit-scope.ts')).toBe(false)
    expect(isLsFilesForm('packages//node/src/commit-scope.ts')).toBe(false)
    expect(isLsFilesForm('packages/node/../node/src/commit-scope.ts')).toBe(false)
    expect(isLsFilesForm('')).toBe(false)
    expect(pathFormProblems(['ok/a.ts', './b.ts']).length).toBe(1)
    expect(pathFormProblems(['./b.ts'])[0]).toContain('silently stop blocking')
  })
})

describe('a run that blocked on nothing says so out loud', () => {
  /**
   * The bypass this cannot detect, made visible instead.
   *
   * `O2_COMMIT_PATHS_FILE` pointing at a file with one unrelated path is a scope that is
   * syntactically perfect and semantically a lie — every finding reads as foreign and the
   * guards block on nothing. It is equivalent to `O2_SKIP_GUARDS=1` with none of its
   * visibility.
   *
   * It is also exactly what the NUL hazard produces by accident: measured on `/bin/bash`
   * 3.2.57, `V=$(cat nul-separated)` turns `a.ts` and `b.ts` into the single well-formed
   * path `a.tsb.ts`. Detection is not available — that string is a legal path. Printing
   * the scope size is.
   */
  function capture(run: () => void): string {
    let written = ''
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
    try {
      run()
    } finally {
      spy.mockRestore()
    }
    return written
  }

  it('prints the scope size beside the findings it did not block on', () => {
    const concatenated = parseCommitScope('a.tsb.ts\0')
    // The rendered line is a stand-in rather than a real vocabulary finding: writing an
    // actual banned word here would make this file a violation of the guard it is
    // demonstrating, which the guard proved by refusing the first draft of this commit.
    const written = capture(() => {
      reportForeign('vocabulary', ['docs/x.md:4 <a banned word>'], concatenated)
    })
    expect(written).toContain('commit scope: 1 path(s)')
    expect(written).toContain('1 finding(s) outside this commit')
    expect(written).toContain('docs/x.md:4 <a banned word>')
  })

  it('says nothing when there is nothing outside the commit', () => {
    expect(capture(() => reportForeign('vocabulary', [], parseCommitScope('a.ts\0')))).toBe('')
  })

  it('reports the foreign half and returns the blocking half from one call', () => {
    const scope = parseCommitScope('packages/core/src/manifest.ts\0')
    const outside: Finding = { paths: ['docs/x.md'], line: 'a finding somewhere else' }
    let written = ''
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
    let held: string[] = []
    try {
      held = blocking('planted', [LEDGER_ROW, outside], scope)
    } finally {
      spy.mockRestore()
    }
    expect(held).toEqual([LEDGER_ROW.line])
    expect(written).toContain('a finding somewhere else')
    expect(written).not.toContain(LEDGER_ROW.line)
  })
})
