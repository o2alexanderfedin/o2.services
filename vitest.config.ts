import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * The measured cut. A file at or above this is excluded by `test:unit`.
 *
 * Read by `MEASURED_NODE_SPANS` below and by
 * `packages/node/src/slow-specs.node.test.ts`, which parses this file's source. The
 * threshold is a stated judgement rather than a discovered boundary — the curve is
 * smooth below `lift.node.test.ts`, so no cut falls in a natural gap.
 */
const SLOW_CUTOFF_MS = 1000

/**
 * The run `MEASURED_NODE_SPANS` came from, as data rather than as prose.
 *
 * Every figure that used to sit in the paragraph below is here instead, because the
 * paragraph is what went wrong: it stated a file count, a test count and a wall clock,
 * all three were false, and nothing read them. `slow-specs.node.test.ts` reads these.
 *
 * `load` is recorded because it changes the answer. See the note on reproducibility in
 * `MEASURED_NODE_SPANS`.
 */
const NODE_MEASUREMENT = {
  date: '2026-08-11',
  /**
   * 1-minute load average, polled every 40 s across the whole run.
   *
   * **Polled, not inferred.** Ten samples on 8 cores: 7.91 → 29.28 → 32.76 → **64.98** →
   * 57.15 → 47.62 → 52.00 → 30.36 → 19.80, ending at 13.55. The peak is two to three
   * minutes in and nearly all of it is this run's own — eight vitest workers plus the child
   * processes the agent specs spawn plus one `docker run` per container spec.
   *
   * **No foreign compile was waited out this time, and that was checked rather than
   * assumed.** `ps -Ao pcpu -r` at the start showed only desktop processes (OneDrive,
   * Finder, WindowServer, two browsers); no build farm, no second vitest. That is the
   * quiet-host condition step 1 of the procedure asks for, and it is recorded as a
   * condition rather than claimed as an ideal.
   *
   * **Measure the process, not the machine.** `/usr/bin/time -p` on the run read
   * `real 387.92  user 463.53  sys 65.60`, i.e. `(user+sys)/real` = **1.36**. That ratio is
   * a comparability key and not a verdict: this suite spends much of its time waiting on
   * spawned children, on sockets and on containers, so a figure near one core is what a
   * healthy run looks like here. It sits beside the previous passes' 1.15, 1.23 and 1.36 on
   * the same host — and beside **1.19** on the run recorded in the flake section of
   * {@link MEASURED_NODE_SPANS}, which is the slowest full run of this tree yet seen and the
   * only one of three that reddened anything other than this guard.
   */
  load: 7.91,
  loadAtEnd: 13.55,
  loadPeak: 64.98,
  /**
   * Files and tests the `node` project ran, i.e. with no `test:unit` exclusions.
   *
   * **Two routes that share no code agree exactly, and for the first time in this field's
   * history they agree with nothing left over**:
   *
   * | route | reading |
   * |---|---|
   * | the filesystem walk `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from | **184** |
   * | `git ls-files packages tools` filtered by the same globs | **184 tracked** |
   * | `git status --porcelain` untracked, filtered by the same globs | **0** |
   *
   * **Every one of the six "counted here, absent from the table" gaps this field carried is
   * now closed**, because every file that caused one has since been committed:
   * `job-entry-points`, `opt-in-only-sources`, `enrolment-needs-no-reservation`,
   * `closed-fabric-agents`, `state-frontmatter` and 26-01's preview1 spec. Each was a
   * measured span that could not be listed, because `slow-specs.node.test.ts` requires every
   * path in the table to be a file git knows about while deriving the population from the
   * filesystem. Both rules were right and they pointed opposite ways; the disagreement
   * closed itself exactly as that note said it would. The table below therefore lists **every**
   * node file above its floor with no exceptions, and `test:unit` stops paying the ~55 s
   * those unlisted rows were costing it.
   *
   * **177 → 184, and this is a full retake rather than a re-site.** The previous six passes
   * moved this count alone and left the spans describing the run of 2026-08-05; the drift
   * check went red at 184 against 177, a drift of 7 against a tolerance of 5, and four
   * commits on `feature/mr-02-sovereign-aggregation` carry `O2_SKIP_GUARDS=1` for it. The
   * repair the guard's own failure message prescribes is a whole-table re-measurement, and
   * that is what this is: every figure in this object and every span in the table below was
   * taken from the one `vitest run --project node --reporter=json` of 2026-08-11 recorded
   * above, plus the solo cross-checks step 3 requires. **The tolerance was not moved**, and
   * moving it was considered and rejected — see `FILE_COUNT_TOLERANCE` in
   * `packages/node/src/slow-specs.node.test.ts`, whose whole argument is that a guard cheap
   * to satisfy by widening is a guard that will be widened again.
   */
  files: 184,
  tests: 2704,
  /**
   * Sum of the per-file costs the table below records — reporter spans for the files the
   * reporter can time, solo wall clocks for the six it structurally cannot.
   *
   * Not a wall clock: vitest runs files in parallel, and the six substituted entries are not
   * commensurable with {@link NODE_MEASUREMENT.wallClockMs} at all — `elfconv-differential`'s
   * 313.8 s and `echo-guest`'s 199.9 s were taken alone, where neither shared a docker daemon
   * with 183 other files.
   *
   * **The 7 943 ms discrepancy five previous passes carried forward is gone**, and it is
   * worth saying how rather than letting it disappear: it was the residue of pinning single
   * rows onto a table taken in an earlier run. This figure is now the exact sum of the 82
   * rows below, computed from them rather than accumulated by addition, so there is nothing
   * left to carry.
   */
  sumOfFileSpansMs: 1_497_520,
  /**
   * What `--reporter=json` alone said the same run summed to, i.e. the same number with the
   * six hook-shadowed files left at the value the reporter gave them.
   *
   * Recorded because the gap **is** the finding: 845 141 against 1 497 520 means the
   * instrument this table is derived from could not see **44 %** of the suite's cost — the
   * largest share this field has ever recorded, against 19 % on the previous pass. The blind
   * spot did not grow; what grew is the number of container specs sitting inside it. Four of
   * the six substituted files are `docker run` inside a top-level `beforeAll`, and three of
   * those four arrived after the last full retake.
   */
  sumOfReportedSpansMs: 845_141,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 387_920,
  /**
   * How many files were cross-checked against a second instrument before their span was
   * written down, and how many of those disagreed with `--reporter=json`.
   *
   * **This is data rather than prose so that skipping the cross-check has to be an edit
   * rather than an omission.** See the method section in {@link MEASURED_NODE_SPANS} for how
   * the eight were selected and what each one read.
   */
  hookShadowCandidates: 8,
  hookShadowDisagreed: 6,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * `unitFiles` is not an independent reading — `slow-specs.node.test.ts` asserts it equals
   * `NODE_MEASUREMENT.files` minus the derived exclusion count, so it moves when the table
   * does. It was **also observed directly** by running `npm run test:unit` against this
   * table, which is the cross-check that keeps this field from being a restatement of the
   * assertion that derives it. Deriving it alone would make that assertion a tautology.
   *
   * **116 → 125 on this pass, derived AND observed.** `NODE_MEASUREMENT.files` moved
   * 177 → 184 while the derived exclusion count moved 61 → 59, so the fast loop grows by
   * nine. The direction is worth naming because it looks wrong: seven files arrived and the
   * loop grew by nine, because two files that were excluded on the old table are no longer
   * above the cut on this one. Both are boundary noise of the kind the run table in
   * {@link MEASURED_NODE_SPANS} documents at length, and neither was edited.
   *
   * `unitTests` is the run's total including any skipped cases, because the figure this
   * field is compared against by hand is what the reporter prints, and it prints the total.
   *
   * **All three were OBSERVED on one green run**, `npm run test:unit` exit **0**,
   * `Test Files 125 passed (125)`, `Tests 2116 passed (2116)`,
   * `/usr/bin/time -p real 11.82 user 40.02 sys 7.59`, `(user+sys)/real` **4.03**, 1-minute
   * load 8.58 → 8.23 on an 8-core host. The 125 is the direct cross-check: the derivation says
   * 125 and the runner says 125, independently.
   *
   * **The fast loop got faster while the project grew by seven files, and that is the whole
   * point of this pass.** 22.52 s → 11.82 s. Almost all of it is four files that were paying
   * into `test:unit` because nothing had measured them: `closed-fabric-agents` (16.6 s, and it
   * could not be listed until it was committed), and the three container specs the reporter
   * called 12 ms, 22 ms and 559 ms files. `(user+sys)/real` rises 2.85 → **4.03** in the same
   * step, which is the same fact from the other side: what left the loop was waiting, not
   * computing.
   *
   * **A first reading was taken at 1-minute load 257 and is recorded rather than passed off
   * as this one** — exit 0, the same 125 / 2116, `real 12.80 user 41.16 sys 7.47`, ratio 3.80.
   * A stray full-suite run left over from an aborted measurement batch was still finishing;
   * it was polled until it exited rather than being used, and the reading above was retaken at
   * load 8.6. The two agree to within 8 %, which is itself the evidence for what this field's
   * history keeps saying: the loop is CPU-bound and barely moves with the machine.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured on
   * a suite that did not pass is not a duration for the suite this field claims to describe.
   * The recorded history is also the reason this object stores a load beside a duration
   * rather than a duration alone — 5.96 s at load 5.6, 9.97 s at 8.4, 7.49 s at 6.1, 8.37 s
   * at 11.7, 9.25 s at **58**, 6.93 s at 5.3, 9.53 s at 4.9, 7.75 s at 6.9, then 25.95 s,
   * 24.59 s, 22.39 s and 22.52 s once the unlisted slow files started running inside it.
   *
   * **TREAT THE WALL CLOCK AS SOFT.** Three readings of one table on this host within an
   * hour once spread 25.69 / 33.68 / 22.39 s — 1.5× end to end. Any comparison against this
   * number that turns on less than half of it is reading the host's weather.
   */
  unitFiles: 125,
  unitTests: 2116,
  unitWallClockMs: 11_820,
} as const

/**
 * Per-file spans from one recorded run, and the **only** hand-maintained data here.
 *
 * `SLOW_NODE_SPECS` is derived from this table by applying `SLOW_CUTOFF_MS`, so the
 * list and the measurement cannot disagree. They did before: the list held nine files
 * while twenty-three met its own stated rule, and every figure in the prose around it
 * was false — it claimed `test:unit` ran 66 files / 946 tests in 6.46 s when the real
 * numbers were 102 / 1411 / 24.03 s. A list maintained beside a rule drifts from the
 * rule; a list computed from the rule cannot.
 *
 * ## The measurement
 *
 * `vitest run --project node --reporter=json`, **2026-08-11**, 184 files / 2704 tests.
 * Wall clock 387.9 s, `/usr/bin/time -p` `real 387.92 user 463.53 sys 65.60`,
 * `(user+sys)/real` **1.36**. Load average polled every 40 s: 7.91 at the start,
 * **64.98 at its peak**, 13.55 at the end, on an 8-core host.
 *
 * **This is the first whole-table retake since 2026-08-05.** Six passes in between moved
 * {@link NODE_MEASUREMENT.files} and pinned single rows on, which is what step 2 below
 * forbids and says why. The count reached 184 against a recorded 177 — a drift of 7
 * against a tolerance of 5 — `slow-specs.node.test.ts` refused every commit touching a node
 * spec, and four commits on `feature/mr-02-sovereign-aggregation` carry `O2_SKIP_GUARDS=1`
 * for exactly that. **The tolerance was not widened.** Every span below comes from the one
 * run named above, or from the solo cross-check step 3 requires, and nothing is carried
 * forward from an earlier table.
 *
 * **This run was not green, and the rule about that is narrower than it looks.** Exit 1,
 * 2702 passed, 1 skipped, **1 failed** — `slow-specs.node.test.ts`'s file-count drift check,
 * red *because* the table it checks was the stale one this pass replaces. It is red in every
 * measurement run taken to fix drift, by construction, and this very edit clears it. It is
 * an assertion failure in a source-*parsing* guard: it aborts nothing, spawns nothing, and
 * changes no other file's span. The rule the {@link NODE_MEASUREMENT} `unitWallClockMs`
 * docblock states — *a duration measured on a suite that did not pass is not a duration for
 * that suite* — is applied there strictly, where a single aggregate number is at stake, and
 * is not applied to the per-file table here for the reason it has never been applied to it:
 * a fully green `--project node` is unobtainable *before* the edit that makes it green.
 *
 * ## Three full runs of this tree, and the two that reddened nothing else
 *
 * Recorded because the difference between them is the only evidence available about which
 * of this suite's reds are the host, and because "passes in isolation" is a claim to verify
 * rather than a diagnosis:
 *
 * | run | `real` | `(user+sys)/real` | failures other than this guard |
 * |---|---|---|---|
 * | 1 | 450.08 s | **1.19** | `churn-agents`, `late-combine`, `reachability` |
 * | 2 | 394.65 s | 1.34 | none |
 * | 3 — **the table below** | 387.92 s | 1.36 | none |
 *
 * The three reds appear only on the slowest run and only at the lowest CPU share, which is
 * suggestive and is not by itself an attribution. Each was attributed separately, by the
 * numbers each spec printed rather than by the coincidence:
 *
 * - **`late-combine`** printed `standUp 3546ms, map 1347ms, cold combines
 *   [221,241,296,382,400,450]ms floor 221ms`. Its own docblock states the discriminator —
 *   *a floor that has moved while `standUp` and `map` have not is the combine*. All three
 *   moved together, 3–5× each, so it is the host by the file's own stated rule, and the
 *   residual that file already documents at length and forbids widening `TIMEOUT_MARGIN` to
 *   hide. Nothing was changed for it.
 * - **`churn-agents`** failed on `new Set(holderOf.values()).size >= 3`, a *placement*
 *   reading and not a wall clock. See the ruling recorded at that assertion.
 * - **`reachability`** was **not** the host, and it is the one this comparison paid for. Its
 *   `THE FIVE-MODULE ENTRY SET…` case was the only member of its block left on vitest's
 *   5 000 ms default while its four siblings carry 60 000 ms — against a block docblock that
 *   states the timeout is *on every case in the block*. In run 3 that case took 2 038 ms and
 *   a sibling in the same block took **6 082 ms**, i.e. already past the default on a quiet
 *   host. A missing argument, not weather; fixed at the case.
 *
 * ## Retaking this table: the obvious method is measurably wrong, and that is the defect
 *
 * **`--reporter=json` does not time a file. It times the file's cases.** A file's
 * `startTime` is stamped when its **first case begins**, not when the worker picks the
 * file up, so every millisecond a hook spends before that first case is attributed to
 * nothing at all — not to the file, not to the run, nowhere.
 *
 * **The discriminator is positional, not structural**, and the distinction is the whole
 * point: *"does this file have a `beforeAll`"* is the wrong question, and answering it is
 * how a previous reading concluded that `lift.node.test.ts`'s span could not have come
 * from this reporter. Proved 2026-08-05 in a throwaway three-file project outside this
 * repository, three arms of one fixture each spending an identical 3 000 ms:
 *
 * | where the 3 000 ms sits | reported span | Σ case durations | pre-first-case |
 * |---|---|---|---|
 * | `beforeAll` **above** the file's first case | **1 ms** | 1 | 3 608 |
 * | `beforeAll` in a describe **after** a case has run | **3 007 ms** | 2 | 526 |
 * | inside the case | **3 030 ms** | 3 030 | 639 |
 *
 * A hook above the first case is understated **3 000-fold**; the identical hook moved
 * below one case is reported exactly. That is a falsifiable comparison rather than an
 * assertion — had the reporter charged hook time to the file, arm one would have read
 * 3 000 ms too.
 *
 * ### So this is the procedure, and it is not optional
 *
 * 1. **Wait for a quiet host and record what was waited for.** Do not kill or signal
 *    another process; poll until it exits. Record the 1-minute load at start, peak and
 *    end, and `/usr/bin/time -p`'s `real`/`user`/`sys` with `(user+sys)/real` beside them.
 * 2. **Retake the WHOLE table in one run.** Pinning new entries onto an old table makes it
 *    a blend of two runs and destroys the only property it has, which is that one person
 *    can reproduce it.
 * 3. **Find every hook-shadowed file and cross-check it.** A file is hook-shadowed when a
 *    `beforeAll` or `beforeEach` registered above its first case does real work — spawn,
 *    container, network, lift. Grepping for `beforeAll` finds the candidates; whether each
 *    one is registered before or after the file's first `it`/`test` decides which of them
 *    are shadowed. **Each one is run alone under `/usr/bin/time -p` and the wall clock wins
 *    over the reporter.**
 *    Bracket every such solo run with a solo run of a trivial spec, because ~0.9–5.4 s of
 *    that `real` is `npx` + node + vitest boot rather than the file, and that boot moves
 *    with load — a difference taken against a floor in the same weather is a reading, an
 *    absolute `real` is a reading plus the hour it was taken.
 * 4. **Re-derive `NODE_MEASUREMENT.files` independently**, at least twice and ideally by
 *    three routes that share no code.
 * 5. **Record the count of candidates and of disagreements** in
 *    {@link NODE_MEASUREMENT.hookShadowCandidates} / `hookShadowDisagreed`, so that a
 *    later pass that skipped step 3 has to delete a field rather than merely not read a
 *    paragraph.
 *
 * ### What the cross-check found this time
 *
 * **The selection was mechanised over all 184 files**, not over the handful that register a
 * `beforeAll`. For each file: the line of its first `it`/`test`, the line and indent of every
 * `beforeAll`/`beforeEach`, and the hook's body. A hook counts as running before the first
 * case if it is written above it **or** is at top level — a root-suite hook runs before the
 * first case wherever it is written, which a purely line-order test misses. That selected
 * **57** files, and then reading the bodies decided: 51 of the 57 are a `beforeEach` that
 * only `mkdtemp`s. Eight candidates survive, counting `lift.node.test.ts`, whose top-level
 * hook is a synchronous `writeAcceptableElf()` while its container work sits in two *nested*
 * hooks below its first case — grep selects, only reading the body decides.
 *
 * Every solo figure below is `/usr/bin/time -p`'s `real` less a boot floor of **1.01 s**,
 * the mean of six solo runs of `packages/core/src/blockstore/memory.test.ts` (1.08, 0.86,
 * 0.85, 1.07, 1.12, 1.07) interleaved through the batch at 1-minute load 4.5–7.4. Two solo
 * runs were taken of every candidate and the **larger** is recorded, as the table's
 * convention is the span a reader would observe rather than the kinder of two.
 *
 * | file | hook before first case? | this run's span | Σ cases | solo `real` ×2 | verdict |
 * |---|---|---|---|---|---|
 * | `tools/aot/lift.node.test.ts` | top-level one is a sync file write; the container hooks are below case 1 | 297 342 | 22 926 | — | **gap 274 416 — the reporter saw it** |
 * | `aot-dispatch.node.test.ts` | **yes — the `prepareGuest` hook opens `describe.skipIf(!MEASURABLE)`** | 5 990 | 5 989 | 4.68 / 4.43 s | **no repair possible — see below** |
 * | `start-reporting.node.test.ts` | **yes — the top-level `startNode` hook precedes every `describe`** | **61** | 61 | 1.54 / 1.59 s | **9.5× understated** |
 * | `closed-fabric-agents.node.test.ts` | **yes — a top-level `beforeAll` standing up nine processes** | **10 388** | 10 389 | 17.65 / 17.38 s | **short by 6.3 s, i.e. 38 % blind** |
 * | `tools/aot/echo-guest.node.test.ts` | **yes — its hook opens `a guest a translated artifact can finish a job with`** | **559** | 558 | 200.88 / 200.31 s | **358× understated** |
 * | `tools/aot/elfconv-differential.node.test.ts` | **yes — one `docker run` at describe level, above case 1** | **12** | 12 | 311.98 / 314.83 s | **26 000× understated** |
 * | `tools/aot/elflift-wasi-gate.node.test.ts` | **yes — same shape, one `docker run`** | **22** | 23 | 139.17 / 138.42 s | **6 300× understated** |
 * | `tools/aot/wasi-preview1-surface.node.test.ts` | **yes — same shape, one `docker run`** | **6** | 6 | 1.81 / 1.70 s | **133× understated, still under the cut** |
 *
 * **`elfconv-differential.node.test.ts` is the sharpest reversal here and it corrects this
 * file's own record.** Its row used to carry *"the reporter agreed here (329.81 s) because
 * vitest attributed the `beforeAll` to `tests`, so this row needs no hook-shadow note"*.
 * Measured again on 2026-08-11 the reporter calls it a **12 ms** file against a solo
 * 314.83 s. Whatever produced the earlier agreement, it is not reproducible, and a row
 * recorded at 12 ms would have moved five and a quarter minutes into every `test:unit` run
 * with nothing anywhere saying so. This is the second time a claim of the form *"the reporter
 * agreed on this one"* has failed to survive its own retake, and it is the argument for step
 * 3 being mechanical rather than remembered.
 *
 * **`aot-dispatch.node.test.ts` is the case where the stated rule does not apply, and saying
 * so is the point.** Step 3 says the solo wall clock wins over the reporter. That rule exists
 * to repair an *understatement*. Here the reporter's in-run span is 5 990 ms while the whole
 * solo run — boot, hook and all three cases on a quiet host — took 4.68 s, i.e. 3.67 s of
 * file. There is no understatement to repair: the reporter already charged the file more than
 * it costs alone, because in-run it shared eight workers and a docker daemon with 183 other
 * files. Substituting the solo figure would replace a valid in-run reading with an out-of-run
 * one and make the table *more* of a blend, not less. Its in-run span is recorded unchanged
 * and it is counted as the one candidate that **agreed**.
 *
 * ### The six substituted entries, and what that costs
 *
 * Six entries below carry a solo wall clock rather than this run's span, marked in line. They
 * are **not** commensurable with {@link NODE_MEASUREMENT.wallClockMs}: `elfconv-differential`'s
 * 313 820 and `echo-guest`'s 199 870 sum to more than the whole run's 387 630, because alone
 * neither shared a docker daemon with 183 other files. The alternative was to record 12 ms and
 * 559 ms, and those numbers are simply false.
 *
 * `sumOfFileSpansMs` therefore sums the corrected values and
 * {@link NODE_MEASUREMENT.sumOfReportedSpansMs} sums what the reporter alone said. The gap
 * between them — 845.1 s against 1 497.5 s — is the size of the blind spot: **44 %**.
 *
 * ## An absolute millisecond cut is not reproducible, and this is the evidence
 *
 * The same rule applied to different runs of the same tree on the same machine selects a
 * different set each time:
 *
 * | run | 1-min load | files at or above 1 s |
 * |---|---|---|
 * | 2026-08-01, run 1 | 53 → 108 | 29 |
 * | 2026-08-01, run 3 | 21 → 42 | 36 |
 * | 2026-08-02 | 50 → 115 → 16 | 28 |
 * | 2026-08-03, run 2 | 7.41 → 30.71 → 5.75 | 40 |
 * | 2026-08-03, run 4 | 13.43 → 59.60 → 23.67 | 35 |
 * | 2026-08-04 | 5.76 → 38.60 → 10.44 | 37 |
 * | 2026-08-05, run 1 | 15.46 → 109.21 → 43.94 | 52 |
 * | 2026-08-05, run 2 | 9.32 → 69.02 → 12.02 | 53 |
 * | 2026-08-11 — **the table below** | 7.91 → 64.98 → 13.55 | **59** |
 *
 * **Membership near the boundary is noise, and this pass adds two more standing examples.**
 * `named-refusal.node.test.ts` read 1 726 ms on the last table and **996** here, four
 * milliseconds under the cut; `strip-comments.node.test.ts` read 1 400 and now **959**.
 * Neither file was edited. In the other direction `egress-refusal` (2 908 → 1 039) stayed in
 * by 39 ms. `churn.test.ts` remains the sharpest case in the record: 1134 ms, then 962, then
 * exactly 1000, then 974, then 1002, and on this run it is below the table's floor entirely.
 * **So the list cannot be made to enforce itself by re-timing** — a guard that re-measured
 * would disagree with itself between runs, and the only stable thing to check is structure.
 * That is what `packages/node/src/slow-specs.node.test.ts` does, and why it explicitly does
 * not re-time anything: it counts files, which is the one property of the project a quiet
 * host and a loaded one agree on.
 *
 * What *is* stable is the shape: a handful of files dominate by more than an order of
 * magnitude, and the marginal ~1 s files barely matter because vitest runs them in
 * parallel. Erring generous is therefore both safe and cheap — over-excluding costs
 * `test:unit` some coverage it was never the last word on, while under-excluding costs
 * the inner loop the thing it exists for. A bare `vitest run` and `npm run test:node`
 * both still see every file, so nothing becomes unreachable either way.
 *
 * ## What the cut buys
 *
 * The 59 excluded files are **98.7 %** of the 1 497.5 s this table lists (1 478.2 s of it).
 * `elfconv-differential` at 313.8 s, `lift` at 297.3 s and `echo-guest` at 199.9 s are
 * **54 %** of it in three files, and two of the three are files the instrument that built
 * this table could not see at all — it called them a 12 ms file and a 559 ms file.
 *
 * ## Entries below the cut are listed too, on purpose
 *
 * Everything down to roughly 300 ms is here, so the neighbourhood of the boundary is
 * visible and a file that crosses it is a one-line diff against a recorded number rather
 * than a rediscovery. Faster files are omitted.
 *
 * **Every one of the 184 was measured, and the 102 omitted ones were measured too** — the
 * distinction matters, because "not in the table" has to keep meaning "fast" rather than
 * "nobody looked", which is the failure this whole file was rebuilt to prevent.
 *
 * **For the first time there is no file that was measured, is above the floor, and still
 * cannot be listed.** Six previous passes each carried at least one, because
 * `slow-specs.node.test.ts` requires every path here to be tracked while requiring the file
 * count to come from the filesystem, and agents forbidden `git add` could satisfy only one of
 * those at a time. Every such file has since been committed. If this paragraph ever needs a
 * sentence added to it, that is the same gap reopening.
 *
 * ## Mechanism, where it was actually established
 *
 * Filename is not a usable signal and neither is the obvious mechanical proxy:
 * grepping for `node:child_process` or `docker` selects a different set —
 * `disclosure-gate`, `purity` and `vocabulary` all spawn real processes and are fast,
 * while `transport-bounds` and `admission` import neither and are among the slowest.
 * The mechanism notes below are only on the files where a pass verified one. The rest are
 * deliberately unannotated rather than guessed at.
 *
 * **Six entries carry a `// wall clock` note.** Those are the hook-shadowed files whose
 * reporter figure was an understatement: their number is `/usr/bin/time -p`'s `real` from the
 * slower of two solo runs less the 1.01 s boot floor, because the figure this run's reporter
 * gave them is not a measurement of the file. The reporter's figure is in the note so the size
 * of the gap stays visible. `aot-dispatch.node.test.ts` is hook-shadowed too and carries no
 * note, for the reason given in the cross-check section: its reporter span already exceeds its
 * whole solo run, so there is nothing to repair.
 */
const MEASURED_NODE_SPANS: readonly (readonly [string, number])[] = [
  ['tools/aot/elfconv-differential.node.test.ts', 313_820],  // wall clock; reporter said 12
  ['tools/aot/lift.node.test.ts', 297_342],
  ['tools/aot/echo-guest.node.test.ts', 199_870],  // wall clock; reporter said 559
  ['tools/aot/elflift-wasi-gate.node.test.ts', 138_160],  // wall clock; reporter said 22
  ['packages/node/src/enrol-through-a-closed-door.node.test.ts', 59_570],
  ['packages/node/src/admission-agents.node.test.ts', 48_216],
  ['packages/node/src/discovery-agents.node.test.ts', 36_951],
  ['packages/node/src/relay-admission.node.test.ts', 23_773],
  ['packages/node/src/enrolment-needs-no-reservation.node.test.ts', 22_003],
  ['packages/node/src/reachability.node.test.ts', 21_715],
  ['packages/node/src/quorum-agents.node.test.ts', 19_058],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 18_171],
  ['packages/node/src/enrollment.node.test.ts', 17_068],
  ['packages/node/src/coverage-agents.node.test.ts', 16_743],
  ['packages/node/src/closed-fabric-agents.node.test.ts', 16_640],  // wall clock; reporter said 10 388
  ['packages/node/src/sovereignty-placement.node.test.ts', 15_303],
  ['packages/node/src/orphan-leash.node.test.ts', 14_529],
  ['packages/node/src/transport-bounds.node.test.ts', 10_744],
  ['packages/node/src/enrollment-cost.node.test.ts', 10_428],
  ['packages/node/src/peer-dial.node.test.ts', 10_186],
  ['packages/node/src/late-combine.node.test.ts', 9_399],
  ['packages/node/src/bench-attestation.node.test.ts', 9_264],
  ['packages/node/src/certificate-verification.node.test.ts', 8_909],
  ['packages/node/src/admission.node.test.ts', 8_772],
  ['tools/aot/cli.node.test.ts', 7_968],
  ['packages/node/src/signed-artifact.node.test.ts', 7_499],
  ['packages/node/src/enrolment-residual.node.test.ts', 7_388],
  ['packages/node/src/speculation-agents.node.test.ts', 6_463],
  ['packages/node/src/duty-cycle.node.test.ts', 6_451],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 6_088],
  ['packages/node/src/aot-dispatch.node.test.ts', 5_990],
  ['packages/node/src/sovereign-arm.node.test.ts', 5_644],
  ['packages/node/src/two-process.node.test.ts', 5_214],
  ['packages/node/src/owner-domain-agents.node.test.ts', 5_132],
  ['packages/node/src/churn-agents.node.test.ts', 4_776],
  ['packages/node/src/agent-handshake.node.test.ts', 4_704],
  ['packages/node/src/fabric-node.node.test.ts', 4_639],
  ['packages/node/src/checkpoint-agents.node.test.ts', 4_520],
  ['packages/node/src/trust-anchors.node.test.ts', 4_194],
  ['packages/node/src/result-signature.node.test.ts', 4_189],
  ['packages/node/src/bench-fabric.node.test.ts', 4_108],
  ['packages/node/src/capability-dispatch.node.test.ts', 3_778],
  ['packages/node/src/sovereign-aggregation.node.test.ts', 3_498],
  ['packages/node/src/discover-arm.node.test.ts', 3_477],
  ['packages/node/src/node-records.node.test.ts', 3_359],
  ['packages/core/src/cert-lifecycle.test.ts', 3_110],
  ['packages/node/src/peer-verifier.node.test.ts', 3_070],
  ['packages/node/src/reachability-guard.node.test.ts', 2_718],
  ['packages/browser/src/colouring-surface.node.test.ts', 2_643],
  ['packages/node/src/execution-deadline.node.test.ts', 2_178],
  ['packages/demo/src/kernel.test.ts', 2_152],
  ['packages/node/src/provider-answering.node.test.ts', 2_037],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 1_969],
  ['packages/node/src/egress-manifest.node.test.ts', 1_771],
  ['packages/node/src/peer-gate.node.test.ts', 1_562],
  ['packages/node/src/node-enrollment.node.test.ts', 1_482],
  ['packages/node/src/job-entry-points.node.test.ts', 1_451],
  ['packages/node/src/relaying.node.test.ts', 1_098],
  ['packages/node/src/egress-refusal.node.test.ts', 1_039],
  ['packages/node/src/named-refusal.node.test.ts', 996],
  ['packages/node/src/strip-comments.node.test.ts', 959],
  ['packages/node/src/disclosure-gate.node.test.ts', 829],
  ['tools/aot/wasi-preview1-surface.node.test.ts', 800],  // wall clock; reporter said 6
  ['packages/node/src/enrollment-dos.node.test.ts', 713],
  ['packages/net/src/discovery.test.ts', 703],
  ['packages/core/src/enrollment.test.ts', 702],
  ['packages/node/src/combine-signature.node.test.ts', 672],
  ['packages/core/src/job/submit.test.ts', 637],
  ['packages/node/src/purity.node.test.ts', 588],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 587],
  ['packages/node/src/start-reporting.node.test.ts', 580],  // wall clock; reporter said 61
  ['packages/net/src/provider-merge.test.ts', 571],
  ['packages/node/src/identity-store.node.test.ts', 571],
  ['packages/net/src/enrol-agent.test.ts', 524],
  ['packages/node/src/rendezvous-wire.node.test.ts', 505],
  ['packages/node/src/fs-blockstore.node.test.ts', 460],
  ['packages/core/src/ed25519-backend.test.ts', 401],
  ['packages/node/src/primes-reduce.node.test.ts', 395],
  ['packages/net/src/discover-candidates.test.ts', 342],
  ['packages/node/src/bench-admission.node.test.ts', 337],
  ['packages/node/src/requirements-ledger.node.test.ts', 329],
  ['packages/node/src/mutation-guard.node.test.ts', 326],
]

/**
 * The `node` specs that dominate its wall clock, excluded by `test:unit`.
 *
 * Derived, never edited by hand. To change what is excluded, re-measure and update
 * `MEASURED_NODE_SPANS`; to change the rule, change `SLOW_CUTOFF_MS`.
 */
const SLOW_NODE_SPECS: readonly string[] = MEASURED_NODE_SPANS.filter(
  ([, ms]) => ms >= SLOW_CUTOFF_MS,
).map(([path]) => path)

/**
 * Switched here rather than on the command line because vitest 4.1.10's
 * `--exclude` flag does not do what `--help` says once `projects` are configured.
 * Measured: `--project node --exclude 'tools/aot/lift.node.test.ts'` ran all 74
 * files unchanged, and `--exclude '**\/*.node.test.ts'` *raised* the count to 75
 * and pulled the browser specs into the Node environment — it replaces a project's
 * own `exclude` instead of adding to it. A `test:unit` built on that flag would
 * silently run the full set and still print green.
 */
const UNIT_ONLY = process.env['O2_UNIT_ONLY'] === '1'

/**
 * The `perf` project exists only when asked for — `npm run test:perf`.
 *
 * Switched here in the config rather than by a CLI flag, because a project declared
 * unconditionally is part of a bare `vitest run` and
 * `packages/bench/src/perf-gate.perf.test.ts` must not be. It stands up three fabrics and
 * runs 303 jobs plus 303 reference passes, its numbers are only meaningful against the
 * committed baseline in `perf-baseline.ts`, and a wall-clock measurement folded into the
 * everything-run would add minutes and a load-dependent failure mode to every change.
 *
 * `*.perf.test.ts` is therefore excluded from `node` and from `browser` as well. Both
 * halves are needed: the exclusions keep the file out of the default projects, and the
 * conditional keeps the project that does run it out of the default run. Either one alone
 * leaves the gate either running everywhere or reachable nowhere.
 */
const PERF_GATE = process.env['O2_PERF'] === '1'

/**
 * DET-07 — the identical suite runs under every target.
 *
 * The kernel has no platform imports, so the same test files run unchanged in
 * Node and in a real browser. Any test that only passes in one of them means a
 * platform assumption leaked into `@o2/core`, which is exactly what this config
 * exists to catch.
 *
 * The provider comes from `@vitest/browser-playwright` as a *function*. The
 * `provider: 'playwright'` string form is vitest 3.x and silently does nothing on
 * 4.x.
 *
 * Four projects, split by what a test needs rather than by what it covers:
 *
 *   node     everything that runs in a plain Node process
 *   browser  the same portable specs, in real Chromium
 *   e2e      specs that drive Playwright themselves — see below
 *   perf     the perf gate, present only under `O2_PERF=1` — see `PERF_GATE`
 */
export default defineConfig({
  test: {
    /**
     * Coverage is an instrument, not a gate — see `.planning/COVERAGE-BASELINE.md`
     * for the first measurement this project has ever taken and for what a floor
     * would have to be worth before it is set.
     *
     * Deliberately no `thresholds` block. A floor picked before anyone had seen the
     * number would be arbitrary in both directions: high enough to block work that
     * is fine, or low enough to certify a regression as passing. Setting one is a
     * separate deliberate act, taken against a number that exists.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      /**
       * Named explicitly rather than left to default. The v8 provider otherwise
       * reports only files a test happened to load, so a source file with no test
       * at all is absent from the denominator and the percentage flatters itself.
       * An honest baseline has to count the untested files as zero.
       */
      include: ['packages/*/src/**/*.ts', 'tools/**/*.ts'],
      exclude: [
        // Test files measure; they are not the thing measured. Counting them
        // inflates every number, because a test file is by construction fully
        // executed by its own run.
        '**/*.test.ts',
        // Re-export barrels only. Verified by reading all eight: every statement is
        // `export ... from`, so there is no branch and no statement that a test
        // could meaningfully exercise. A barrel reads as 100% or 0% depending on
        // whether anything imported it, and neither number says anything.
        '**/index.ts',
        // Test inputs, not tested logic. A fixture's correctness is asserted by the
        // tests that consume it; covering the fixture itself measures nothing.
        '**/*fixture*.ts',
        '**/fixtures/**',
        // Type declarations emit no runtime code, so there is nothing to execute.
        '**/*.d.ts',
        // Generated byte blobs — a `Uint8Array` literal of compiled WASM produced by
        // a build script. There is no logic here to cover, and the file's size would
        // dominate any line count it appeared in.
        '**/kernel-bytes.ts',
        '**/wasi-fixture-bytes.ts',
        // The mutation-planting driver behind `npm run test:mutations`. It is
        // deliberately NOT a `*.test.ts`, because it rewrites source files and vitest
        // runs test files in parallel — a spec that edits `agent.ts` while another
        // file imports it is chaos. Being a plain script, no spec loads it, so the v8
        // provider read it as 0 of 85 statements and dragged `packages/node/src` from
        // 70.38% to 54.94% on a run where no covered code had changed. The tool that
        // measures the guards is not itself one of the guards.
        '**/*.mutate.ts',
      ],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          // `tools/` holds the build-time drivers — they shell out to containers and
          // could not run in a browser even in principle, so only this project sees
          // them. Their suffix still has to say `.node.test.ts`, so the rule stays
          // one rule.
          include: ['packages/*/src/**/*.test.ts', 'tools/**/*.node.test.ts'],
          // `?worker` is a browser bundling concern; that target runs in the
          // browser project only. `*.e2e.test.ts` has its own project.
          //
          // `SLOW_NODE_SPECS` is appended only under `test:unit` (O2_UNIT_ONLY=1).
          // A bare `vitest run` sees the full set, so the everything-run count is
          // unchanged and no spec becomes unreachable by default.
          exclude: [
            '**/*.browser.test.ts',
            '**/*.e2e.test.ts',
            // The perf gate has its own project — see `PERF_GATE`.
            '**/*.perf.test.ts',
            ...(UNIT_ONLY ? SLOW_NODE_SPECS : []),
          ],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.browser.test.ts'],
          // `@o2/node` holds the adapters that exist precisely because a browser
          // cannot do these things — real sockets, a filesystem, child processes.
          // Its specs are Node-only by definition; the symmetric counterpart of
          // the browser project's `*.browser.test.ts`.
          exclude: ['**/*.node.test.ts', '**/*.e2e.test.ts', '**/*.perf.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            /**
             * Three engines, per STACK.md line 111 and the owner ruling recorded in
             * ROADMAP.md line 495. Chromium alone was the standing state and is what
             * the ruling calls out as blocking four deferred items.
             *
             * Three engines on one host are three independent implementations with
             * three independent storage backends. They are **not** three machines,
             * and no result obtained here may be labelled cross-machine or
             * distributed-hardware — the ruling is explicit about that.
             *
             * A spec that fails in only one engine is the finding this matrix exists
             * to produce. Narrowing the matrix back to hide such a failure would
             * destroy the only instrument that can see it.
             */
            instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
          },
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['packages/*/src/**/*.e2e.test.ts'],
          /**
           * One file at a time.
           *
           * Each of these launches its own Chromium, its own relay, and its own
           * Vite server. Run in parallel they contend for CPU and sockets, and the
           * symptom is a timeout in whichever one lost — a flake that looks like a
           * WebRTC or relay bug and is neither. Observed once under load from a
           * concurrent `git push`, which is exactly the kind of intermittency that
           * is expensive to chase later.
           *
           * Serialising costs wall-clock and buys determinism. For tests whose
           * whole job is to prove real network behaviour, that is the right trade.
           */
          fileParallelism: false,
        },
      },
      ...(PERF_GATE
        ? [
            {
              test: {
                name: 'perf',
                environment: 'node',
                include: ['packages/*/src/**/*.perf.test.ts'],
                /**
                 * One file at a time, for the same reason `e2e` serialises and a
                 * sharper one: this project's assertions *are* wall-clock
                 * measurements. Two perf files running concurrently would contend for
                 * the CPU they are measuring, and each would report the other's cost
                 * as its own.
                 */
                fileParallelism: false,
              },
            },
          ]
        : []),
    ],
  },
})
