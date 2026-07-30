import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MUTATIONS, occurrences, problemsWith } from './mutation-ledger.ts'
import type { Mutation } from './mutation-ledger.ts'

/**
 * Layer 1 of the mutation ledger — the cheap half, and the one that actually bites.
 *
 * This file plants **nothing**. It asks a single question of every entry in
 * `mutation-ledger.ts`: does this mutation still describe the source it claims to
 * mutate? A `find` string that no longer matches is a guard that has silently
 * stopped guarding — `npm run test:mutations` would apply it to nothing, observe a
 * green run, and there is no output that distinguishes "the test caught it" from
 * "the defect was never planted".
 *
 * That is not a hypothetical failure mode in this repository. The disclosure gate
 * shipped with a pattern for `wrangler pages deploy` that required the verb to
 * follow the tool name directly, so it matched nothing; every absence assertion
 * built on it passed for as long as it existed, and the repository read clean the
 * whole time. Same shape, one file over.
 *
 * ## Why this is separate from the script that plants
 *
 * Not speed. Planting rewrites a source file while vitest is running other files in
 * the same worker pool, and a test that edits `agent.ts` while a sibling file
 * imports it is a race, not a test. So the expensive half is
 * `mutation-guard.mutate.ts`, a script, run on demand.
 *
 * Node-only: reads real source files off disk by repo-relative path.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** File text, or `null` when the path is not on disk. */
function readOrNull(relative: string): string | null {
  const path = join(ROOT, relative)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** The `problemsWith` call for one entry, with the disk reads already done. */
function auditOnDisk(entry: Mutation): string[] {
  return problemsWith(
    entry,
    readOrNull(entry.file),
    entry.caughtBy.map((path) => existsSync(join(ROOT, path))),
  )
}

/** A minimal healthy entry, for the checks that prove the checker can fail. */
const HEALTHY: Mutation = {
  id: 'synthetic',
  why: 'a synthetic entry used to prove the checker rejects what it should reject',
  file: 'packages/node/src/does-not-matter.ts',
  find: 'const x = 1',
  replace: 'const x = 2',
  caughtBy: ['packages/node/src/mutation-guard.node.test.ts'],
  signature: 'expected 1 to be 2',
}

describe('the repository root this ledger resolves against is the real one', () => {
  /**
   * Every check below reduces to "no problems were found". A wrong `ROOT` — one `..`
   * too many, an empty directory — would make *every* entry report a missing file,
   * so this one fails loudly rather than subtly. The marker check is here anyway,
   * because it is the difference between a failure that says "the ledger drifted"
   * and one that says "you are looking at the wrong tree".
   */
  it('contains the marker files that only this repository has', () => {
    expect(existsSync(join(ROOT, 'package.json'))).toBe(true)
    expect(existsSync(join(ROOT, 'packages', 'node', 'src'))).toBe(true)
    expect(existsSync(join(ROOT, 'packages', 'net', 'src', 'agent.ts'))).toBe(true)
  })
})

describe('every mutation still describes the source it claims to mutate', () => {
  for (const entry of MUTATIONS) {
    it(`${entry.id} — ${entry.file}`, () => {
      expect(auditOnDisk(entry)).toEqual([])
    })
  }

  it('reports every drifted entry at once, not just the first', () => {
    // The per-entry tests above are the readable form. This is the one whose failure
    // message is worth pasting into a report, because a refactor that moves one line
    // usually moves several.
    expect(MUTATIONS.flatMap(auditOnDisk)).toEqual([])
  })
})

describe('the ledger is a ledger, not an empty list that passes', () => {
  /**
   * Anti-vacuity. Every assertion in the block above is of the form "no problems",
   * and an empty `MUTATIONS` satisfies all of them perfectly while proving nothing.
   * The floor is the count encoded on 2026-07-29 — ten from Phase 13.1's hand-planted
   * exercise plus the two benchmark-driver reversions — so deleting an entry has to
   * be a deliberate act that also edits this number.
   */
  it('carries at least the twelve mutations it was built with', () => {
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(12)
  })

  it('gives every mutation a distinct id', () => {
    const ids = MUTATIONS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every mutation a signature, a reason and at least one catching test', () => {
    // Stated as three separate expectations rather than folded into `problemsWith`,
    // so a failure names which of the three is missing without reading a string.
    for (const entry of MUTATIONS) {
      expect(entry.signature.length, `${entry.id} declares no failure signature`).toBeGreaterThan(0)
      expect(entry.why.length, `${entry.id} declares no reason`).toBeGreaterThan(40)
      expect(entry.caughtBy.length, `${entry.id} names no catching test`).toBeGreaterThan(0)
    }
  })

  it('touches more than one production file, so the ledger is not one guard restated', () => {
    expect(new Set(MUTATIONS.map((entry) => entry.file)).size).toBeGreaterThanOrEqual(6)
  })
})

describe('the script that plants these mutations is reachable', () => {
  /**
   * The two layers are useless apart: this file proves the mutations still apply, and
   * the script proves a test still notices. A ledger whose runner has been renamed
   * out from under it keeps passing here and is never executed anywhere.
   */
  const RUNNER = 'packages/node/src/mutation-guard.mutate.ts'

  it('exists on disk', () => {
    expect(existsSync(join(ROOT, RUNNER))).toBe(true)
  })

  it('is what "npm run test:mutations" runs', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const scripts =
      typeof manifest === 'object' && manifest !== null && 'scripts' in manifest
        ? (manifest as { scripts?: Record<string, string> }).scripts
        : undefined
    expect(scripts?.['test:mutations'] ?? '').toContain(RUNNER)
  })

  it('is not itself a vitest spec, so the ordinary run never plants anything', () => {
    // The whole point of the split. If this file ever ends in `.test.ts`, a bare
    // `vitest run` starts rewriting source files in parallel with the suite.
    expect(RUNNER.endsWith('.test.ts')).toBe(false)
  })
})

describe('the checker can fail — proved against synthetic entries, not assumed', () => {
  /**
   * `problemsWith` returning `[]` is the entire content of this file's verdict. A
   * mistyped predicate, an early `return`, or a `find` comparison against the wrong
   * string all return `[]` too, and read exactly like a healthy ledger.
   *
   * So each failure it is supposed to detect is constructed and required to be
   * detected. This is the same instrument check `disclosure-gate.node.test.ts`
   * performs on its publishing patterns and `vocabulary.node.test.ts` performs on its
   * banned words, for the same reason: an absence assertion cannot audit itself.
   */
  it('accepts an entry whose find text is present exactly once', () => {
    expect(problemsWith(HEALTHY, 'before\nconst x = 1\nafter\n', [true])).toEqual([])
  })

  it('rejects an entry whose find text has disappeared — the drift case', () => {
    const problems = problemsWith(HEALTHY, 'the line was renamed\n', [true])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('no longer contains its find text')
  })

  it('rejects an entry whose find text matches twice — the ambiguous case', () => {
    const problems = problemsWith(HEALTHY, 'const x = 1\nconst x = 1\n', [true])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('2 times')
  })

  it('rejects an entry whose file is gone', () => {
    const problems = problemsWith(HEALTHY, null, [true])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('is not on disk')
  })

  it('rejects an entry naming a catching test that is not on disk', () => {
    const problems = problemsWith(HEALTHY, 'const x = 1\n', [false])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('which is not on disk')
  })

  it('rejects an entry that declares no signature', () => {
    const problems = problemsWith({ ...HEALTHY, signature: '' }, 'const x = 1\n', [true])
    expect(problems.some((line) => line.includes('declares no failure signature'))).toBe(true)
  })

  it('rejects an entry that names no catching test', () => {
    const problems = problemsWith({ ...HEALTHY, caughtBy: [] }, 'const x = 1\n', [])
    expect(problems.some((line) => line.includes('names no test that catches it'))).toBe(true)
  })

  it('rejects an entry whose reason is a placeholder', () => {
    const problems = problemsWith({ ...HEALTHY, why: 'because' }, 'const x = 1\n', [true])
    expect(problems.some((line) => line.includes('too short to be a reason'))).toBe(true)
  })

  it('rejects a mutation that mutates nothing', () => {
    const problems = problemsWith({ ...HEALTHY, replace: HEALTHY.find }, 'const x = 1\n', [true])
    expect(problems.some((line) => line.includes('find and replace are identical'))).toBe(true)
  })

  it('counts literal occurrences, including the deleting form with a trailing newline', () => {
    // `M3a` deletes a whole line, so its find text ends in `\n`. A counter that
    // trimmed or normalised line endings would report zero for it and the entry
    // would fail for a reason that has nothing to do with the source.
    expect(occurrences('a\n  stream.abort(error)\nb\n', '  stream.abort(error)\n')).toBe(1)
    expect(occurrences('nothing here', 'x')).toBe(0)
    expect(occurrences('xx', '')).toBe(0)
  })
})
