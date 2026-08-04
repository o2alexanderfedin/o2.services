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
  return problemsWith(entry, readOrNull(entry.file), entry.caughtBy.map(readOrNull))
}

/**
 * A minimal healthy entry, for the checks that prove the checker can fail.
 *
 * Its signature is declared `rendered-at-runtime` so that the cases below vary one
 * field at a time: an entry in that arm has no signature check to satisfy, so a
 * failure any of them reports is the field that case changed and nothing else.
 */
const HEALTHY: Mutation = {
  id: 'synthetic',
  why: 'a synthetic entry used to prove the checker rejects what it should reject',
  file: 'packages/node/src/does-not-matter.ts',
  find: 'const x = 1',
  replace: 'const x = 2',
  caughtBy: ['packages/node/src/mutation-guard.node.test.ts'],
  signature: 'expected 1 to be 2',
  signatureSource: 'rendered-at-runtime',
}

/** Stand-in for a `caughtBy` file's text — the third argument is now content, not presence. */
const SOME_TEST_FILE = "it('a title the ledger could name', () => {})\n"

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
   * The floor was the count encoded on 2026-07-29 — ten from Phase 13.1's hand-planted
   * exercise plus the two benchmark-driver reversions — and was raised to 23 on
   * 2026-07-30 when seven bug fixes each added their own entry. Deleting an entry has
   * to be a deliberate act that also edits this number; leaving the floor behind the
   * count would let the newest entries go quietly, which is the failure this whole
   * block exists to prevent.
   *
   * **Raised to 67 on 2026-08-03 by Plan 19-12**, which added twenty-five entries — one
   * per defect Phase 19 planted and watched go red. It was left at 23 through Phase 18,
   * which is exactly the slack this docblock warns about: the count had reached 42 while
   * the floor still described a tree of 23, so nineteen entries could have gone quietly.
   */
  it('carries at least the sixty-seven mutations it was built with', () => {
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(67)
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
    expect(problemsWith(HEALTHY, 'before\nconst x = 1\nafter\n', [SOME_TEST_FILE])).toEqual([])
  })

  it('rejects an entry whose find text has disappeared — the drift case', () => {
    const problems = problemsWith(HEALTHY, 'the line was renamed\n', [SOME_TEST_FILE])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('no longer contains its find text')
  })

  it('rejects an entry whose find text matches twice — the ambiguous case', () => {
    const problems = problemsWith(HEALTHY, 'const x = 1\nconst x = 1\n', [SOME_TEST_FILE])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('2 times')
  })

  it('rejects an entry whose file is gone', () => {
    const problems = problemsWith(HEALTHY, null, [SOME_TEST_FILE])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('is not on disk')
  })

  it('rejects an entry naming a catching test that is not on disk', () => {
    const problems = problemsWith(HEALTHY, 'const x = 1\n', [null])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('which is not on disk')
  })

  it('rejects an entry that declares no signature', () => {
    const problems = problemsWith({ ...HEALTHY, signature: '' }, 'const x = 1\n', [SOME_TEST_FILE])
    expect(problems.some((line) => line.includes('declares no failure signature'))).toBe(true)
  })

  it('rejects an entry that names no catching test', () => {
    const problems = problemsWith({ ...HEALTHY, caughtBy: [] }, 'const x = 1\n', [])
    expect(problems.some((line) => line.includes('names no test that catches it'))).toBe(true)
  })

  it('rejects an entry whose reason is a placeholder', () => {
    const problems = problemsWith({ ...HEALTHY, why: 'because' }, 'const x = 1\n', [SOME_TEST_FILE])
    expect(problems.some((line) => line.includes('too short to be a reason'))).toBe(true)
  })

  it('rejects a mutation that mutates nothing', () => {
    const problems = problemsWith({ ...HEALTHY, replace: HEALTHY.find }, 'const x = 1\n', [SOME_TEST_FILE])
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

describe('a test-title signature is compared to the test, not merely counted', () => {
  /**
   * The `B1`/`B2` hole, closed and then proved closed.
   *
   * Both entries named `… five sentinels twice` for four commits after `e34660f`
   * renamed the test to `six`. Every ordinary run was green throughout, because the
   * only thing anyone checked about a signature was that it had a non-zero length —
   * a reading of the string's *size* standing in for a reading of its *content*. The
   * first case below is that exact defect in synthetic form.
   *
   * These are synthetic on purpose. Asserting against the real ledger would prove
   * only that the ledger is currently healthy, which the block at the top of this
   * file already establishes; it would not prove that an unhealthy one is rejected,
   * and those are different claims.
   */
  const TITLED: Mutation = {
    ...HEALTHY,
    signature: 'refuses a frame a default node accepts',
    signatureSource: 'test-title',
  }
  const CONTAINING = `it('${TITLED.signature}', () => {\n  expect(1).toBe(1)\n})\n`

  it('accepts a title the catching file still contains', () => {
    expect(problemsWith(TITLED, 'const x = 1\n', [CONTAINING])).toEqual([])
  })

  it('rejects a title the catching file no longer contains — the B1/B2 defect', () => {
    const problems = problemsWith(TITLED, 'const x = 1\n', ["it('refuses a frame a big node accepts', () => {})\n"])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('no longer contains')
    // The refusal must name the text that went missing. A message that said only
    // "a signature drifted" would send a reader back to a 900-line ledger to find
    // out which word moved, which is the search this whole entry exists to spare.
    expect(problems[0]).toContain('refuses a frame a default node accepts')
  })

  it('rejects a title that is in no catching file even when one of several is readable', () => {
    const problems = problemsWith({ ...TITLED, caughtBy: ['a.test.ts', 'b.test.ts'] }, 'const x = 1\n', [
      'unrelated\n',
      'also unrelated\n',
    ])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('no longer contains')
  })

  it('accepts a title found in the second of two catching files', () => {
    // `caughtBy` is a set of files that were measured to fail together, and the
    // title only ever lives in one of them. Requiring it in every file would fail
    // `M1`, which names two.
    const entry = { ...TITLED, caughtBy: ['a.test.ts', 'b.test.ts'] }
    expect(problemsWith(entry, 'const x = 1\n', ['unrelated\n', CONTAINING])).toEqual([])
  })

  it('accepts a compound describe > it signature whose halves are both present', () => {
    // `M2c`'s form. Vitest joins the nested titles with ` > ` on the FAIL line, so
    // the recorded signature is two source strings and matches neither as a whole.
    const entry = { ...TITLED, signature: 'the outer block > the inner case' }
    const file = "describe('the outer block', () => {\n  it('the inner case', () => {})\n})\n"
    expect(problemsWith(entry, 'const x = 1\n', [file])).toEqual([])
  })

  it('rejects a compound signature when only one half survives', () => {
    // The half-drift, and the reason both halves are required. Renaming the inner
    // case while the describe stands is the ordinary refactor, and a check that
    // accepted "some part matched" would be held up by the part nobody touched.
    const entry = { ...TITLED, signature: 'the outer block > the inner case' }
    const file = "describe('the outer block', () => {\n  it('the renamed case', () => {})\n})\n"
    const problems = problemsWith(entry, 'const x = 1\n', [file])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('the inner case')
    // And it names only the half that moved.
    expect(problems[0]).not.toContain('the outer block')
  })

  it('rejects an entry that claims its signature is rendered when the literal is right there', () => {
    // The escape hatch, closed. `rendered-at-runtime` switches the check off, so an
    // entry that declares it while the string sits in the file has either been
    // copied from a neighbour or been demoted to make a red go away. Either way the
    // stronger arm was available.
    const problems = problemsWith({ ...TITLED, signatureSource: 'rendered-at-runtime' }, 'const x = 1\n', [CONTAINING])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain("say 'test-title' instead")
  })

  it('checks nothing about a rendered-at-runtime signature that is absent, which is the normal case', () => {
    // Stated as a case rather than left implicit, because "this arm is unchecked" is
    // a property of the guard a reader should be able to find a test for. `M1`'s
    // `expected 32 to be less than or equal to 2` is assertion output and appears in
    // no file; only a planted run can say anything about it.
    const entry = { ...HEALTHY, signature: 'expected 32 to be less than or equal to 2' }
    expect(problemsWith(entry, 'const x = 1\n', ['nothing like it\n'])).toEqual([])
  })

  it('reports a missing file rather than a drifted signature when the catching file is gone', () => {
    // Two problems would name two causes for one fact. A file that is not on disk
    // cannot contain a title, and reporting both would send a reader looking for a
    // rename that did not happen.
    const problems = problemsWith(TITLED, 'const x = 1\n', [null])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('which is not on disk')
  })
})

describe('the signature check applies to most of the ledger, not to a corner of it', () => {
  /**
   * Anti-vacuity for the arm itself. `signatureSource` is per entry, so the cheapest
   * way to make a drifted signature green again is to declare it
   * `rendered-at-runtime` — and if that happened to every entry, the block above
   * would still pass while checking nothing at all.
   *
   * The floor was the reading taken on 2026-08-01: 26 of the 40 entries carried a test
   * title, 14 carried assertion or runner output. **Re-measured 2026-08-03 by Plan
   * 19-12: 45 of 67 carry a title, 22 carry rendered output** — and the old sentence was
   * already two entries stale when it was read, because 18-12 added `M36` and `M37`
   * without moving it. It is a floor rather than an equality because new entries should
   * be free to land in either arm.
   */
  it('checks the signature of at least forty-five entries', () => {
    const checked = MUTATIONS.filter((entry) => entry.signatureSource === 'test-title')
    expect(checked.length).toBeGreaterThanOrEqual(45)
  })

  it('keeps the unchecked arm a minority, and names what is in it', () => {
    // Named rather than counted, so that moving an entry into the unchecked arm is
    // an edit somebody has to justify here.
    const rendered = MUTATIONS.filter((entry) => entry.signatureSource === 'rendered-at-runtime').map((e) => e.id)
    expect(rendered.length).toBeLessThan(MUTATIONS.length / 2)
    expect([...rendered].sort()).toEqual(
      // `M36` and `M37` were added by 18-12, and the justification this case asks for is
      // that a title would have been the WEAKER key for both. Each catches a defect in a
      // file whose one `it` carries dozens of assertions — `discovery-agents.node.test.ts`
      // has 40 — so a title-keyed signature would accept a red produced by any of them,
      // including one produced by load: this repository already has a test that fails
      // under full-suite contention and passes alone. The assertion strings pin the exact
      // inversion instead. `expected 'agreed' to be 'insufficient'` is the shard reaching
      // a second executor, and nothing else in that file can render it; `expected
      // { slots: 8 … } to deeply equal { slots: 2 … }` is a tab advertising an uncapped
      // slot count, and it is the *only* reading in its file that moves when the wire
      // answer and the page answer diverge. Neither string exists in any source file, so
      // `test-title` would also have been a false declaration — see the case above that
      // rejects the opposite mistake.
      //
      // `M40`, `M42`, `M43`, `M44`, `M45` and `M51` were added by 19-12, and the
      // justification this case asks for is the same one in five of the six cases: each
      // catches a defect in `quorum-agents.node.test.ts`, whose three `it`s each carry
      // dozens of assertions across three spawned-agent fabrics, so a title-keyed
      // signature would accept a red produced by any of them — including one produced by
      // contention, which this file has already recorded happening. The assertion strings
      // pin the exact inversion instead: `expected 'composed' to be 'not-composed'` is
      // rule 2 gone, `expected 'independent' to be 'owner-domain'` is one operator read as
      // two, and the `'agreed'`/`'insufficient'` pair is the shortfall dial inverted in
      // each direction. `M45` is the exception and says so in its own `why`: the run that
      // observed it recorded `expected false to be true` and nothing sharper, which is the
      // weakest signature in this ledger and is written down as one rather than dressed
      // up. `M51`'s signature is a template-literal title assembled per file at run time,
      // so no literal exists to compare against and `test-title` would be a false
      // declaration — the case above rejects exactly that mistake.
      [
        'M1', 'M11', 'M12', 'M2a', 'M20', 'M22', 'M27', 'M3a', 'M30', 'M32', 'M36', 'M37',
        'M4', 'M40', 'M42', 'M43', 'M44', 'M45', 'M5', 'M51', 'M7', 'M9',
      ].sort(),
    )
  })
})
