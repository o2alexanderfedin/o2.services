import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripComments } from './strip-comments.ts'

/**
 * CHURN-03, ROADMAP criterion 7 — **the opt-out scope guard for
 * `SubmitOptions.checkpoints`.**
 *
 * `checkpoints` became a required field with a named sentinel on 2026-08-05, on the
 * owner's ruling that silence and consent were otherwise indistinguishable. The type now
 * forces every submitter to *state* whether it checkpoints. It cannot force the statement
 * to be `yes`, and today every production submitter states `'checkpoints-nothing'`.
 *
 * **So this file exists for the same reason `sovereign-block-refusal.node.test.ts`'s
 * call-site scan does, and is written in its idiom.** A required field turns an omission
 * into a written opt-out; a scan is what keeps the set of opt-outs from growing quietly.
 * A new production submitter that writes the sentinel fails here rather than merging,
 * which is the difference between a decision and a default.
 *
 * ## What this proves, and the two things it does not
 *
 * It proves that exactly the files listed in {@link CHECKPOINT_OPTOUTS} say
 * `'checkpoints-nothing'`, that each says it exactly as many times as it is allowed to,
 * and that no production file outside the definition so much as names `CheckpointSink`.
 * The last is the sharpest of the three: a submitter cannot supply a sink it never names,
 * so this is a *direct* reading of criterion 7's write half rather than an inference from
 * an outcome.
 *
 * 1. It does **not** prove that checkpointing works — `checkpoint-agents.node.test.ts`
 *    does that, against sinks that exist only in tests. This file is about reachability
 *    from something an operator runs, which is the half that is missing.
 * 2. It does **not** close criterion 7, and making the field required did not either.
 *    **Criterion 7 remains PARTIAL and this file is the guard that says so out loud.**
 *    The recovery half is proven; the write half is reachable from nothing an operator
 *    runs. What changed on 2026-08-05 is that the gap is now *stated in the source* at
 *    five call sites instead of being invisible in five omissions.
 *
 * **Both directions fail, deliberately.** `toEqual` over the whole set means a file that
 * *stops* saying the sentinel reddens too — including the day a submitter is given a real
 * sink. That is not a false alarm: closing the write half is exactly the event that should
 * force this file, and criterion 7's score, to be rewritten by hand.
 *
 * Node-only: reads tracked source files off disk.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The literal a caller writes to state that it keeps no checkpoints. */
const SENTINEL = "'checkpoints-nothing'"

/**
 * Every production file that may say {@link SENTINEL}, how often, and why.
 *
 * `count` is pinned as well as membership, because a file already on this list is exactly
 * where a *second* silent opt-out is easiest to add — `browser/demo/main.ts` has two
 * submits and would have accepted a third without membership changing at all.
 */
const CHECKPOINT_OPTOUTS: readonly {
  readonly file: string
  readonly count: number
  readonly role: string
}[] = [
  {
    file: 'packages/core/src/job/submit.ts',
    count: 2,
    role: 'the definition — the field type, and the branch that reads the sentinel',
  },
  {
    file: 'packages/core/src/executor/task-worker.ts',
    count: 1,
    role: 'the in-worker caller: submits into a MemoryBlockstore that dies with the task',
  },
  {
    file: 'packages/bench/src/perf-workload.ts',
    count: 1,
    role: 'a measurement driver: a resume would corrupt the makespan it reports',
  },
  {
    file: 'packages/node/src/bin/bench.ts',
    // **Raised from 1 to 2 by Plan 23-06, and this guard is the reason it was a decision.**
    // BENCH-07 criterion 5 gave that driver an opt-in `--sovereign` leg — AUTH-03's
    // requestor half, which had no production caller at all — and the leg dispatches its one
    // owner-labelled shard through a second `submitJobWithEgress` call. This file reddened
    // on it, which is precisely what it is for: a second submitter in a file already on the
    // list is the case `count` exists to catch, and it caught one on its first opportunity.
    //
    // Decided, not defaulted: the sentinel is correct at the new site for the *same* reason
    // it is correct at the measured one and for one more of its own. The store both submits
    // into is the requestor's, built under `mkdtemp(tmpdir(), 'o2-bench-')` and deleted by
    // `close()`, so a handle published from either would name a block that no longer exists
    // by the time anything could resume from it. And the new call is a **one-shard
    // dispatch-path demonstration** run once per rig, outside every timed region — there is
    // no partial progress a resume could pick up, because there is no second shard.
    count: 2,
    role:
      'the CLI measurement driver, twice: the measured job path, and the --sovereign leg’s' +
      ' one-shard dispatch. Both submit into a store that is an mkdtemp close() rm -rf s',
  },
  {
    file: 'packages/browser/demo/main.ts',
    // **Two until 2026-08-08.** `runPi` is the third, and it is the case this pin exists to
    // make somebody state out loud: a browser tab is the only durable store in the fabric,
    // so an opt-out here is the one that could actually lose work. It is correct for the
    // same reason the other two are — a π run is one submit with no resumable partial, and
    // `reduceJob` re-derives the tree from the job rather than from a checkpoint.
    //
    // The count moved because `0d1fcb5` added the site and left the pin at 2, so this guard
    // was red at that commit. It was found by the v1.1 re-audit running the node suite, not
    // at the time — which is the guard working and the commit not reading it.
    count: 3,
    role:
      'the demo page, three times: runColouring, runPi and the sovereign run — the only' +
      ' durable store',
  },
]

/**
 * Every tracked, non-test TypeScript source under `packages/`.
 *
 * `git ls-files` rather than a directory walk, for the reason
 * `sovereign-block-refusal.node.test.ts` gives: it excludes `node_modules`, `dist` and
 * everything gitignored for free, and it matches what a reader of the repository sees.
 * `.d.ts` is excluded — an ambient declaration submits nothing.
 */
function trackedProductionSources(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts'))
}

/**
 * How many times `file` says `needle` in **code**, comments stripped.
 *
 * Stripping is load-bearing here and not hygiene: `submit.ts`'s own docblock names the
 * sentinel eight times while its code says it twice, so a raw-text count would be
 * dominated by prose about the decision rather than by the decision. `stripComments` is
 * the shared tokenizer — it tracks string and template state, so it cannot open a comment
 * the source never opened, which is the failure mode
 * `sovereign-block-refusal.node.test.ts` records having failed OPEN on.
 */
function codeOccurrences(file: string, needle: string): number {
  return stripComments(readFileSync(join(ROOT, file), 'utf8')).split(needle).length - 1
}

describe('the set of production files that opt out of checkpointing is pinned', () => {
  const sources = trackedProductionSources()

  it('scanned the repository it claims to have scanned', () => {
    // Anti-vacuity, in `sovereign-block-refusal.node.test.ts`'s idiom: every assertion
    // below is of the form "exactly these files", which a scan that found nothing would
    // also satisfy. A mis-rooted `git ls-files` returns nothing and would pass silently.
    expect(sources.length).toBeGreaterThan(50)
    expect(sources).toContain('packages/net/src/agent.ts')
    expect(sources).toContain('packages/node/src/fabric-node.ts')
    for (const { file } of CHECKPOINT_OPTOUTS) expect(sources).toContain(file)
  })

  it('finds the sentinel in exactly the files that may say it', () => {
    const expected = CHECKPOINT_OPTOUTS.map(({ file }) => file).sort()
    const found = sources.filter((file) => codeOccurrences(file, SENTINEL) > 0).sort()
    const unexpected = found.filter((file) => !expected.includes(file))
    expect(
      unexpected.map(
        (file) =>
          `${file} says ${SENTINEL}. That is a new production submitter opting out of ` +
          'CHURN-03 checkpointing. The field was made required on 2026-08-05 so that this ' +
          'would be a decision rather than a default — so decide it here, in review, and ' +
          'add the file to CHECKPOINT_OPTOUTS with the reason it keeps no checkpoints. If ' +
          'it should checkpoint, give it a real CheckpointSink instead and rewrite ' +
          "criterion 7's score, which is PARTIAL precisely because nothing does.",
      ),
    ).toEqual([])
    // Both directions: a file that *stopped* saying it is equally a change of scope, and
    // is what the day someone wires a real sink looks like from here.
    expect(found).toEqual(expected)
  })

  it('pins how many times each of them may say it', () => {
    // Membership alone would let a file already on the list grow a second silent opt-out.
    const counts = Object.fromEntries(
      CHECKPOINT_OPTOUTS.map(({ file }) => [file, codeOccurrences(file, SENTINEL)]),
    )
    expect(counts).toEqual(
      Object.fromEntries(CHECKPOINT_OPTOUTS.map(({ file, count }) => [file, count])),
    )
  })

  it('reads criterion 7 directly: no production file outside the definition names CheckpointSink', () => {
    // **The sharpest of the three assertions.** A submitter cannot supply a sink whose
    // type it never mentions, so this is a direct reading of the write half's
    // reachability rather than an inference from a job's outcome. The day this list grows
    // a second entry is the day the write half becomes reachable, and this test is
    // supposed to redden and be rewritten then.
    const namesTheSink = sources.filter((file) => codeOccurrences(file, 'CheckpointSink') > 0)
    expect(namesTheSink).toEqual(['packages/core/src/job/submit.ts'])
  })

  it('can report a new opt-out, and is not satisfied by prose describing one', () => {
    // The scan is only worth having if it has been watched reporting something. Both
    // halves are planted, because they fail differently: a real statement must be found,
    // and the same text inside a comment must not be.
    expect(stripComments(`const o = { checkpoints: ${SENTINEL} }`).includes(SENTINEL)).toBe(true)
    expect(
      stripComments(`// this submitter used to pass ${SENTINEL} before it kept a sink`).includes(
        SENTINEL,
      ),
    ).toBe(false)
    expect(stripComments(`/* checkpoints: ${SENTINEL} */ const n = 1`).includes(SENTINEL)).toBe(
      false,
    )
    // The over-stripping case `sovereign-block-refusal.node.test.ts` failed OPEN on: a
    // statement preceded by a string literal holding a comment opener. A stripper that
    // treats `'/*.ts'` as opening a comment swallows the line below it, the file drops out
    // of `found`, and — because a NEW file was never in `expected` — nothing reddens.
    expect(
      stripComments(
        `const glob = '/*.ts'\nconst o = { checkpoints: ${SENTINEL} }\n/** why */\n`,
      ).includes(SENTINEL),
    ).toBe(true)
  })
})
