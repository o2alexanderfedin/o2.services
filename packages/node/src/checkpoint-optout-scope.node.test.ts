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
 * ## Rewritten by hand on 2026-08-16, on the event this file said would force it
 *
 * The paragraph below stood here until then, and is kept because the rewrite is only
 * legible against it:
 *
 * > It does **not** close criterion 7, and making the field required did not either.
 * > **Criterion 7 remains PARTIAL and this file is the guard that says so out loud.**
 * > The recovery half is proven; the write half is reachable from nothing an operator
 * > runs.
 *
 * And, of the `toEqual` in both directions: *"closing the write half is exactly the event
 * that should force this file, and criterion 7's score, to be rewritten by hand."* That
 * happened. `browser/demo/main.ts`'s `runColouring` now passes `checkpointsInto(node.store)`
 * — a real sink over the one production store that outlives its process — so two of this
 * file's assertions went red exactly as designed, and both were rewritten rather than
 * relaxed:
 *
 * 1. **`main.ts`'s sentinel count fell from 3 to 2.** That is the `toEqual`-in-both-
 *    directions half doing what it was built for: a file that *stops* saying the sentinel
 *    is a change of scope and has to be restated. `runPi` and the sovereign run still say
 *    it, for the reasons recorded against them below.
 * 2. **`CheckpointSink` is now named by a second production file.** The list is no longer
 *    a statement that the write half is unreachable; it is a statement of *where the sink
 *    is implemented*, and it stays pinned so a third implementation is a decision.
 *
 * ## What this proves, and the two things it does not
 *
 * It proves that exactly the files listed in {@link CHECKPOINT_OPTOUTS} say
 * `'checkpoints-nothing'` and each exactly as many times as it is allowed to; that
 * `CheckpointSink` is named by exactly the definition and the one implementation; and that
 * the shipped colouring run supplies that implementation rather than the sentinel.
 *
 * 1. It does **not** prove that checkpointing works — `checkpoint-agents.node.test.ts`
 *    does that, and `checkpoint.test.ts`'s CHURN-03-write-half block proves what the sink
 *    itself does. This file is about *reachability from something an operator runs*.
 * 2. It does **not** prove the handle goes anywhere a returning tab could find. It does
 *    not, and `checkpointsInto`'s own docblock says so: a blockstore is content-addressed,
 *    so there is no stable key under which the newest handle could be stored. What closes
 *    here is that a shipped entry point writes checkpoint blocks into a store that
 *    survives the tab closing — not that a second requestor can discover them unaided.
 *
 * **Both directions still fail, deliberately**, and for the same reason as before: the day
 * `runPi` or the sovereign run is given a sink is the next day this file must be rewritten
 * by hand.
 *
 * ## Rewritten by hand again on 2026-08-18, on the other event this file said would force it
 *
 * The sentence directly above named `runPi`, and the owner ruled that day that `runPi` and
 * `runPrimes` should both keep checkpoints. Three assertions reddened and all three were
 * rewritten rather than relaxed — which is what the sentence promised and is the only reason
 * it is worth keeping:
 *
 * 1. `main.ts`'s sentinel count fell from 3 to **1**.
 * 2. The at-the-site scan's anti-vacuity floor fell from 7 to **5**, and the property it
 *    protects is unchanged: it is a hand-written census that can still contradict the pin
 *    table above it, which is the one thing a derived figure could not do.
 * 3. The positive reading rose from 1 `checkpointsInto(node.store)` to **3**.
 *
 * The census is now **five sentinel against four sinks** over nine production submit sites.
 * That is a ratio this file states and does not score: the sites that still opt out submit
 * into stores that die with the process (`task-worker.ts`, `perf-workload.ts`,
 * `bin/bench.ts` twice) plus the demo's sovereign run, whose reason was withdrawn with
 * `runPi`'s rather than replaced.
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
    //
    // **Back to 2 on 2026-08-16, and this is the good direction.** `runColouring` now
    // passes `checkpointsInto(node.store)`. It is the right site and the only one of the
    // three: it is the multi-shard run, so it is the only one of the three where partial
    // progress exists to check-point at all. `runPi` and the sovereign run stay on the
    // sentinel for the reasons written above them — one submit, no resumable partial —
    // which are unchanged by anything `runColouring` gained.
    //
    // **Three on 2026-08-17, and the new one is `runPrimes`.** The owner took UI-SPEC section
    // 10's Option A, so the prime-counting workload has a signed record and a dispatch path
    // from a tab — audit finding G4's primes half, closed. Its opt-out is correct on exactly
    // the grounds `runPi`'s is, and it is worth stating rather than inheriting: a primes run
    // is **one submit** whose shards all name the same input block, so there is no partial
    // progress a resume could pick up. What differs from `runColouring` is not the shard
    // count but where the work lives — a colouring ladder walks rungs and can be resumed
    // between them; a single submit either completes or is re-dispatched whole.
    //
    // **ONE on 2026-08-18, and this is the second time the good direction has moved this
    // number.** The owner ruled that `runPi` and `runPrimes` should both keep checkpoints,
    // and both now pass `checkpointsInto(node.store)`. The paragraph above is kept because
    // the ruling overturns an argument written *here* as well as at the sites: *"there is no
    // partial progress a resume could pick up"* is false of the mechanism — `submitJob`
    // writes one checkpoint per **answered shard** and both workloads submit
    // `options.shards` of them. What survives of it is a statement about the *read* half,
    // which neither page path wires: only `runColouring` looks a handle back up.
    //
    // **The one that remains is the sovereign run, and it is now an opt-out with its
    // previous reason withdrawn rather than an opt-out with a reason.** Its comment cited
    // `runPi`'s grounds by name, and those grounds have just been overturned — so the
    // honest state is that the owner ruled on two of the three sites and this one was not
    // in the ruling. What has to be answered before it moves is written at the site and is
    // specific: a checkpoint record is a block in the same `node.store` this tab serves
    // block requests from, and it **names** result CIDs, so whether it is safe here is a
    // question about `sovereignCids` and the serving path — not about the workload's shape.
    // Unmeasured, and recorded as unmeasured.
    count: 1,
    role:
      'the demo page, once: the sovereign run. runColouring left this list on 2026-08-16 and' +
      ' runPi and runPrimes left it on 2026-08-18 — all three supply a real sink over the tab' +
      ' store, which is why they were here',
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

/**
 * The file whose sentinel occurrences **declare** the opt-out rather than take it.
 *
 * `submit.ts` says the literal twice in code — once in `SubmitOptions.checkpoints`' own
 * union type, once in the branch that reads it — and neither is a submitter deciding
 * anything. Excluding it by name rather than by a heuristic, because a heuristic that
 * guessed which occurrences are "declarations" would be exactly the silent exemption this
 * file exists to refuse: a new submitter could fall into the exemption by accident.
 */
const DECLARES_THE_SENTINEL = 'packages/core/src/job/submit.ts'

/**
 * The contiguous comment block immediately above `index`, or `''` if the line above is code.
 *
 * Walks up over `//` lines and over the interior of a block comment, stopping at the first
 * line that is neither. Blank lines stop it too, on purpose: a reason separated from the
 * site it explains by an empty line is a reason a reader has to guess belongs to it, and
 * the whole point of this case is that the reason be *at* the site.
 */
function commentBlockAbove(lines: readonly string[], index: number): string {
  const block: string[] = []
  for (let above = index - 1; above >= 0; above--) {
    const text = (lines[above] ?? '').trim()
    const isComment =
      text.startsWith('//') || text.startsWith('*') || text.startsWith('/*') || text.endsWith('*/')
    if (!isComment) break
    block.unshift(text)
  }
  return block.join('\n')
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

  it('gives every opt-out its reason at the site, not only in this file', () => {
    // **Added 2026-08-18, because `REQUIREMENTS.md`'s CHURN-03 row claimed this and it was
    // false.** The row said *"Each opt-out carries a written reason and
    // `checkpoint-optout-scope.node.test.ts` pins the set in both directions, so this is
    // scope stated rather than scope hidden"*. The reasons were real — every one of them is
    // written into {@link CHECKPOINT_OPTOUTS} above — but they were written **here**, and a
    // reader of `demo/main.ts` or `bin/bench.ts` found a bare `'checkpoints-nothing'` with
    // nothing above it. Measured that day: of the seven opt-out sites, three carried a
    // sound reason at the site, one carried a reason that had gone stale, and **three
    // carried none at all**.
    //
    // So this case does not add a rule; it moves an existing claim from prose that nobody
    // could check into a reading a machine takes on every run. That is the same move
    // `requirements-ledger.node.test.ts` makes on the ledger's own sentences, one level up:
    // a claim a search can hold is worth more than a claim that is merely true.
    //
    // The marker is the requirement id rather than a form of words, because the id is what
    // a reader greps for and what survives rewriting.
    const missing: string[] = []
    let scanned = 0
    for (const { file } of CHECKPOINT_OPTOUTS) {
      if (file === DECLARES_THE_SENTINEL) continue
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
      // Comments stripped for *finding* the sites and kept for *reading* the reason —
      // `stripComments` preserves line structure, so the two views index alike. Finding
      // them in stripped code is what stops a sentinel quoted inside a docblock (there are
      // several, in `submit.ts` and in this file) from being scored as a site with no reason.
      const code = stripComments(lines.join('\n')).split('\n')
      for (let at = 0; at < lines.length; at++) {
        if (!(code[at] ?? '').includes(SENTINEL)) continue
        scanned += 1
        if (commentBlockAbove(lines, at).includes('CHURN-03')) continue
        missing.push(
          `${file}:${at + 1} opts out of CHURN-03 checkpointing with no reason at the site. ` +
            'The reason may not live only in CHECKPOINT_OPTOUTS above: a reader of the ' +
            'submitter has to find it where the decision is taken. Write it in the comment ' +
            'directly above the sentinel and name CHURN-03 in it.',
        )
      }
    }
    expect(missing).toEqual([])
    // Anti-vacuity, and it is not decoration: the loop above is satisfied by finding no
    // sites at all, which is what a broken `stripComments` or a mis-rooted read would
    // produce. The figure is the census `REQUIREMENTS.md`'s CHURN-03 row states, minus
    // nothing, because `submit.ts`'s two are excluded above and are not submit sites.
    //
    // **Seven until 2026-08-18, five after it**, and the floor moves with the census by
    // hand rather than being derived from `CHECKPOINT_OPTOUTS`: derived, it would agree
    // with the pin table by construction and could no longer contradict it, which is the
    // one thing it is here to be able to do. The owner's ruling gave `runPi` and
    // `runPrimes` a real sink, so nine production submit sites now split **five sentinel,
    // four sink**.
    expect(scanned).toBe(5)
  })

  it('reads criterion 7 directly: the definition and exactly one implementation name CheckpointSink', () => {
    // **The sharpest of the assertions.** A submitter cannot supply a sink whose type it
    // never mentions, so this is a direct reading of the write half's reachability rather
    // than an inference from a job's outcome.
    //
    // **The list held one entry until 2026-08-16**, and the comment here said *"the day
    // this list grows a second entry is the day the write half becomes reachable, and
    // this test is supposed to redden and be rewritten then."* It did, and this is that
    // rewrite. The second entry is `checkpoint.ts` — `checkpointsInto`, the sink
    // `runColouring` supplies. It sits beside `writeCheckpoint` and `readCheckpoint`
    // rather than in the browser package because it needs nothing from a browser: its
    // whole act is a read-back through the `Blockstore` port, and putting it in `browser/`
    // would have made the one durable sink unavailable to every other tier.
    //
    // Still pinned, and still in both directions. A *third* file naming the type is a
    // second sink implementation, which is a decision about which one a submitter gets
    // and belongs in review rather than in a diff.
    const namesTheSink = sources.filter((file) => codeOccurrences(file, 'CheckpointSink') > 0)
    expect(namesTheSink).toEqual([
      'packages/core/src/checkpoint.ts',
      'packages/core/src/job/submit.ts',
    ])
  })

  it('reads the write half positively: the shipped demo runs supply the sink', () => {
    // The three assertions above are all *negative* — they say where the sentinel is not
    // and where the type is not named. A guard built only from those is satisfied by a
    // repository in which nothing checkpoints and nothing submits, which is exactly the
    // state this criterion was stuck in. So the closing evidence is stated positively and
    // names the call: an entry point an operator runs hands a real sink to a real submit.
    const demo = 'packages/browser/demo/main.ts'
    expect(sources).toContain(demo)
    // **One until 2026-08-18, three after it**, and this figure is pinned rather than
    // floored for the reason the sentinel counts are: a site that *stops* passing the sink
    // is a change of scope in the direction nothing else in this file can see. The three
    // are `runColouring`, `runPi` and `runPrimes` — every multi-shard submit the page has.
    // The page's remaining sentinel is the sovereign run, which is one submit of
    // owner-labelled shards and is recorded above as an opt-out whose reason was withdrawn
    // rather than replaced.
    expect(codeOccurrences(demo, 'checkpointsInto(node.store)')).toBe(3)
    // And it is the *store* that outlives the process, not a scratch one built for the
    // call. `browser-node.ts` declares `readonly store: IdbBlockstore`, so naming
    // `node.store` here is naming IndexedDB. The honest claim is that a checkpoint block
    // survives the tab closing — not that it is durable: browsers evict IndexedDB
    // silently under storage pressure, and `navigator.storage.persist()` would exempt the
    // origin from eviction under disk pressure but never from a visitor clearing site data.
    expect(codeOccurrences('packages/browser/src/browser-node.ts', 'readonly store: IdbBlockstore')).toBe(1)
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
