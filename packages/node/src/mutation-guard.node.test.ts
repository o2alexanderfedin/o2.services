import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { blocking, commitScope, pathFormProblems, trackedPaths } from './commit-scope.ts'
import {
  MUTATIONS,
  RENDERED_SIGNATURE_COUNT,
  TITLE_SIGNATURE_COUNT,
  occurrences,
  problemsWith,
} from './mutation-ledger.ts'
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

/**
 * The commit these findings are judged against, or `NO_COMMIT_SCOPE` outside a commit.
 *
 * Drift here is the purest instance of defect #39: an entry goes stale the moment
 * somebody edits the line it pins, and until now that refused every *other* agent's
 * commit while leaving the author of the edit free. Absence is strict — under `npm test`
 * or a verifier every entry blocks, as it always did.
 */
const SCOPE = commitScope()

/** Where the entries themselves live, and therefore one place any drift can be fixed. */
const LEDGER = 'packages/node/src/mutation-ledger.ts'

/**
 * Every path an entry's drift can be attributed to — the union rule, in its clearest form.
 *
 * Three parties participate in a drifted entry and any one of them can be the committer:
 * whoever moved the line in `entry.file`, whoever renamed the test in one of
 * `entry.caughtBy`, and whoever is editing the ledger row itself. Naming only
 * `entry.file` would let a rename in a catching file go through unheld, which is exactly
 * the `B1`/`B2` shape this file already carries a case for.
 */
function participantsIn(entry: Mutation): string[] {
  return [LEDGER, entry.file, ...entry.caughtBy]
}

/** File text, or `null` when the path is not on disk. */
function readOrNull(relative: string): string | null {
  const path = join(ROOT, relative)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** The `problemsWith` call for one entry, with the disk reads already done. */
function auditOnDisk(entry: Mutation): string[] {
  return problemsWith(entry, readOrNull(entry.file), entry.caughtBy.map(readOrNull))
}

/** The same audit, attributed, so a commit is held only for its own drift. */
function findingsFor(entry: Mutation): { paths: string[]; line: string }[] {
  return auditOnDisk(entry).map((line) => ({ paths: participantsIn(entry), line }))
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
      expect(blocking(`mutation-guard/${entry.id}`, findingsFor(entry), SCOPE)).toEqual([])
    })
  }

  it('reports every drifted entry at once, not just the first', () => {
    // The per-entry tests above are the readable form. This is the one whose failure
    // message is worth pasting into a report, because a refactor that moves one line
    // usually moves several.
    expect(blocking('mutation-guard', MUTATIONS.flatMap(findingsFor), SCOPE)).toEqual([])
  })

  /**
   * The residual fail-open of narrowing, checked from this guard's end.
   *
   * Unlike every other partitioned guard, these paths are *hand-written* — a ledger entry
   * names its file as a string somebody typed. So the drift this checks for is not a
   * refactor of a path-building expression but a typo, and it has the same symptom, which
   * is none: a `./` prefix on one entry makes that entry permanently foreign and it stops
   * blocking anybody, silently. The round trip against `git ls-files` is what turns that
   * into a red.
   */
  it('names paths in the form a commit scope can match', () => {
    const named = MUTATIONS.flatMap(participantsIn)
    expect(pathFormProblems(named)).toEqual([])
    const tracked = trackedPaths(ROOT)
    expect(named.filter((path) => !tracked.has(path))).toEqual([])
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
   *
   * **Raised to 112 on 2026-08-05 by Plan 20-13**, and the slack it is closing is the same
   * slack again, one phase later. Phase 20 added entries in five separate plans — `W1`…`W5`
   * as they landed, then twenty-seven at the end — and the floor sat at 67 throughout, so by
   * the time it was moved the ledger held 112 and **forty-five entries could have gone
   * quietly**. Plan 20-01 reported the staleness in its own summary rather than fixing a file
   * it did not own, which is the correct behaviour and is also why the gap was allowed to
   * reach forty-five: a floor nobody owns is a floor nobody ratchets. Ratcheted to the exact
   * count here, as 19-12 did, because that is what makes deleting an entry an edit to this
   * line rather than a silent subtraction.
   */
  it('carries at least the hundred and twelve mutations it was built with', () => {
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(112)
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
   * title, 14 carried assertion or runner output. It has been re-measured three times
   * since, and **every one of those readings was written into prose that then expired** —
   * 45 of 67 (2026-08-03, already two stale when read), 48 of 72 (2026-08-04), and the
   * ledger's own header carried the same defect twice more. So the readings are no longer
   * transcribed here: `TITLE_SIGNATURE_COUNT` and `RENDERED_SIGNATURE_COUNT` are derived
   * from `MUTATIONS` in the ledger itself, and this case asserts against them. **On
   * 2026-08-05 they read 83 and 29 of 112**, and that sentence is allowed to go stale
   * precisely because nothing depends on it.
   *
   * It is a floor rather than an equality because new entries should be free to land in
   * either arm, and it is deliberately **not ratcheted to the current count**: the number's
   * job is anti-vacuity — to stop somebody re-declaring a drifted signature
   * `rendered-at-runtime` to make it green — and a floor two thirds of the way up the
   * ledger already does that. A floor moved to sit exactly on the current count would
   * start failing for arithmetic rather than for the property it guards. So the rule this
   * file has always stated is applied literally: **two thirds of the ledger, floor 74 at
   * 112 entries**, which leaves nine entries of headroom against the 83 measured.
   */
  it('checks the signature of at least two thirds of the ledger', () => {
    expect(TITLE_SIGNATURE_COUNT).toBe(
      MUTATIONS.filter((entry) => entry.signatureSource === 'test-title').length,
    )
    expect(RENDERED_SIGNATURE_COUNT).toBe(MUTATIONS.length - TITLE_SIGNATURE_COUNT)
    expect(TITLE_SIGNATURE_COUNT).toBeGreaterThanOrEqual(74)
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
      //
      // `E1` and `E2` were added 2026-08-04 for defect #20, and the justification is the
      // `M36`/`M37` one sharpened by what their catching file contains. Both are caught
      // by `enrollment-dos.node.test.ts`, whose first two cases assert **wall-clock
      // ratios** — a verification tax and a provider-versus-attacker exchange rate. A
      // title-keyed signature there would accept a red produced by a timing floor, which
      // is precisely the red a contended host can produce on its own, and the script
      // would then report a guard as having fired when what fired was the machine. The
      // assertion strings pin the exact inversions instead and neither can be rendered by
      // a slow run: `expected 'issuance-budget-exhausted' to be 'bad-proof-of-possession'`
      // is a budget check hoisted above the signature verifications, and
      // `to deeply equal [ 'exec' ]` is an authorization step appearing on the enrol
      // branch. Neither string exists in any source file, so `test-title` would also have
      // been a false declaration.
      // Two left this arm on 2026-08-04 by Phase 20 plan 01, in opposite directions and
      // for opposite reasons. `M36` is **gone from the ledger entirely**: it pinned the
      // absence of a re-dispatch on the production submit path, that absence is closed,
      // and its own `why` named its deletion as the correct end. `M45` **moved into the
      // checked arm**: its entry had recorded its own signature as the weakest here —
      // `expected false to be true`, which a flake could also render — and said in as
      // many words that closing it was "a matter of re-planting and pasting the FAIL
      // line". Re-planting it against the rewritten `degraded` expression was forced
      // anyway, so the FAIL line was pasted and the entry now keys on a title. That is
      // the direction this case exists to encourage, and it is recorded here because a
      // name leaving this list silently is the same defect as one arriving silently.
      //
      // ── Seven arrived on 2026-08-05 with Phase 20's ledger (Plan 20-13) ────────────
      //
      // Twenty of that phase's twenty-seven entries went into the CHECKED arm, which is
      // the direction this case exists to encourage. These seven did not, and the reason
      // differs by pair rather than being one reason restated.
      //
      // `L1` and `L2` are caught by `serve-agent-hooks.node.test.ts`, whose cases are
      // structural counts over a source file: each `it` asserts a dozen occurrence counts
      // and a cross-tier list equality, so a title-keyed signature would accept a red
      // produced by any hook in the file. The observed strings pin the exact count that
      // moved — `expected +0 to be 1` is the node's own start row never recorded, and
      // `expected 1 to be +0` is the `ledger` hook back at its named opt-out — and they are
      // opposite inversions of the same case title, so a title could not have told them
      // apart at all. The second failure each plant produced was a width-truncated list
      // diff (`[ …(14) ]`), which is exactly the shape `E2` records as unusable.
      //
      // `L3`, `L4` and `L5` are caught by `start-report.test.ts`, where three separate
      // cases redden under `L3` and two under each of the others. The signatures name the
      // specific row that crossed — a foreign browser family arriving, an over-large count
      // surviving, a full user-agent string surviving — and each is the one assertion in
      // its file that distinguishes the bound from its neighbour. `L4`'s and `L5`'s are
      // deliberately the right-hand side of the assertion alone, on `E2`'s precedent: the
      // left half is vitest's terminal-width truncation and a signature keyed on it would
      // stop matching when somebody resized a window.
      //
      // `R1` and `K7` are the `M40` case. Each is caught by a file whose one or two `it`s
      // drive real spawned `bin/agent.ts` processes with dozens of assertions apiece, so a
      // title would accept a red produced by contention — which this repository has already
      // recorded happening more than once. `R1`'s `expected [ 'Error: late reply' ] to
      // deeply equal []` can only be rendered by a frame actually arriving after the
      // requestor stopped waiting, and `K7`'s `expected 'block-missing' to be 'malformed'`
      // can only be rendered by two distinct checkpoint failures collapsing into one.
      // Neither string exists in any source file, so `test-title` would also have been a
      // false declaration — see the case above that rejects exactly that mistake.
      [
        'E1', 'E2',
        'K7',
        'L1', 'L2', 'L3', 'L4', 'L5',
        'M1', 'M11', 'M12', 'M2a', 'M20', 'M22', 'M27', 'M3a', 'M30', 'M32', 'M37',
        'M4', 'M40', 'M42', 'M43', 'M44', 'M5', 'M51', 'M7', 'M9',
        'R1',
      ].sort(),
    )
  })
})
