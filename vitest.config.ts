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
  date: '2026-08-05',
  /**
   * 1-minute load average, sampled every 40 s across the whole run.
   *
   * **A real peak, polled and not inferred.** Ten samples on 8 cores: 9.32 → 58.47 →
   * **69.02** → 62.28 → 60.93 → 40.27 → 25.19 → 18.53 → 13.30, ending at 12.02. The peak
   * is one to two minutes in and nearly all of it is *this run's own*: eight vitest
   * workers plus the child processes the agent specs spawn.
   *
   * **The foreign process was polled, not signalled, and it was not waited out — that is
   * a deviation and it is recorded rather than buried.** One `cpp2rust` compile under
   * `~/Projects/transpilers/cpp-to-rust` (a `rung2_measure` sweep) held ~90 % of one core
   * of eight for the first four samples and exited of its own accord at 21:36:45Z, seven
   * samples in. It was a **sequential** loop with no bounded end, unlike the twenty-way
   * `clang++` farm at load 130–190 the previous pass waited 46 minutes for, so it was
   * recorded as a condition instead of blocking the retake indefinitely. The solo
   * cross-checks in step 3 were all taken *after* it exited, at load 5.8–7.8.
   *
   * **Measure the process, not the machine.** `/usr/bin/time -p` on the run read
   * `real 375.63  user 372.06  sys 61.49`, i.e. `(user+sys)/real` = **1.15**. That ratio
   * is a comparability key and not a verdict: this suite spends much of its time waiting
   * on spawned child processes and on sockets, so a figure near one core is what a healthy
   * run looks like here, and it sits beside the previous pass's 1.23 and the one before
   * that's 1.36 on the same host. The peak load of 69.02 against a 1.15 CPU-time ratio is
   * the whole argument for recording both — load average counted runnable *and* I/O-blocked
   * threads across the machine and would have implied a starvation this process never
   * suffered.
   */
  load: 9.32,
  loadAtEnd: 12.02,
  loadPeak: 69.02,
  /**
   * Files and tests the `node` project ran, i.e. with no `test:unit` exclusions.
   *
   * **157 includes two untracked files, deliberately, and the table below cannot list
   * them.** `slow-specs.node.test.ts` derives its count by walking the *filesystem*
   * (`NODE_PROJECT_FILES`), so `job-entry-points.node.test.ts` and
   * `opt-in-only-sources.node.test.ts` — both `??` in `git status` while this was
   * measured, both real node specs about to land — count here. But that same spec asserts
   * every path in {@link MEASURED_NODE_SPANS} is *tracked*, because a hand-typed span git
   * does not know about is a typo and a typo there is a permanently foreign finding. Both
   * rules are right and they point opposite ways, so: counted here, absent from the table.
   *
   * Recording 155 instead would have gone stale the moment those two were committed, which
   * is the exact drift this field exists to catch.
   *
   * **The cost is stated rather than hidden:** `job-entry-points.node.test.ts` measured
   * **2 737 ms** in this run, comfortably above `SLOW_CUTOFF_MS`, and it cannot be excluded
   * from `test:unit` until it is tracked. Whoever commits it should add it to the table at
   * that value or re-measure. (`opt-in-only-sources.node.test.ts` read 5 ms and is below
   * the listing floor either way, so it costs the fast loop nothing.)
   *
   * ## Re-sited 2026-08-06 by Plan 24-03 — 157 → 162, **count only**
   *
   * The tree had drifted to 161 files and this plan's own spec makes 162, which lands the
   * drift check on exactly its tolerance of 5. Passing with no headroom left is the state
   * that made three agents reach for `O2_SKIP_GUARDS` last time, so the count was retaken
   * rather than the tolerance widened — the same choice, for the same reason, as the
   * 150 → 157 re-site of 2026-08-05.
   *
   * **Two independent routes, sharing no code, both say 162**: the filesystem walk
   * `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from, and `git ls-files` filtered
   * by the same globs. Half of the paragraph above has expired and half has not, and the
   * difference is worth stating because the paragraph reads as one fact: **both files it
   * names are now tracked**, so the two routes agree exactly instead of differing by two —
   * but `job-entry-points.node.test.ts` is **still absent from the table**, so it is still
   * paying its 2 737 ms into every `test:unit` run. That is a live gap, and it is named here
   * rather than closed: transcribing a span out of a docblock is not measuring one, and this
   * plan did not run that file.
   *
   * **What was NOT retaken, said plainly rather than left to be assumed.** Nothing was
   * re-timed. `load`, `loadPeak`, `tests`, `wallClockMs`, `sumOfReportedSpansMs`, the
   * hook-shadow counts and every span in the table other than the one row added beside this
   * change still describe the **2026-08-05** run. This field and `unitFiles` are the only
   * ones that moved, and they moved because they are *counts* — the one property of this
   * project that can be re-derived without running it, which `slow-specs.node.test.ts` says
   * of itself in its "what this deliberately does not do" section. A full retake by the
   * procedure below is still owed and is still blocked on the same thing it was blocked on
   * in August: a green `--project node` from which a `test:unit` reading can be taken.
   *
   * **162 → 164 on 2026-08-06 by Plan 24-04**, which adds exactly two node-project files —
   * `admission-agents.node.test.ts` and `enrolment-residual.node.test.ts`. Its third file is
   * `gated-admission.e2e.test.ts`, which this project **excludes** and which therefore moves
   * nothing here. Cross-checked by the two routes that share no code: the filesystem walk
   * `slow-specs.node.test.ts` performs, and `git ls-files` filtered by the same globs.
   *
   * `unitFiles` below does **not** move with it, and that is arithmetic rather than an
   * oversight: both new spans sit above `SLOW_CUTOFF_MS`, so the derived exclusion list grows
   * by the same two, and `files - EXCLUDED.length` is unchanged. Both spans were **measured**,
   * not estimated — see the two rows in the table for the reporter reading, its wall-clock
   * cross-check, and the boot floor it was taken against.
   *
   * ## 164 → 166 on 2026-08-06 by Plan 24-05, and **only one of the two is this plan's**
   *
   * Two independent routes agree, as they did at the last two re-sites: the filesystem walk
   * `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from reads **166**, and
   * `git ls-files packages tools` filtered by the same globs reads **165 tracked**, with
   * exactly one untracked node spec in `git status --porcelain` — 165 + 1 = 166. The two
   * routes share no code and disagree by exactly the untracked file, which is the shape they
   * are supposed to have.
   *
   * **The gap was 2, not 1, and the second file is not this plan's.**
   * `packages/node/src/state-frontmatter.node.test.ts` landed in `9af6210` *after* Plan 24-04
   * sited this field at 164, so the tree had already drifted by one before this plan opened.
   * Absorbing it silently into a `+1` would have credited this plan with another agent's file
   * and left the count wrong by one, so both components are named here instead. That file is
   * **not** in the table below either — this plan did not run it and transcribing a span
   * nobody measured is the failure the table exists to prevent.
   *
   * **This plan's own file cannot be listed in the table, and the reason is a live rule
   * rather than an omission.** `packages/node/src/enrolment-needs-no-reservation.node.test.ts`
   * is **untracked** — Plan 24-05 runs in a shared checkout alongside a concurrent agent and
   * is explicitly forbidden `git add`, `git commit` and `git stash` — while
   * `slow-specs.node.test.ts` asserts, as an equality and not a floor, that every path in
   * {@link MEASURED_NODE_SPANS} is a committed file: *"a hand-typed span git does not know
   * about is a typo, and a typo there is a permanently foreign finding"*. Listing it would
   * redden that guard. Counting it here is required by the other rule in the same guard, which
   * derives the population from the **filesystem**. Both rules are right and they point
   * opposite ways, exactly as this docblock already records for `job-entry-points` and
   * `opt-in-only-sources`.
   *
   * **So the span is recorded here rather than in the table, and it was measured rather than
   * estimated.** Reporter span **19 202 ms** (a second solo run read 19 080 ms), whose sum of
   * case durations equals the span to within 1 ms in both runs — so there is **no hook
   * shadow**: the file's only hook is a `beforeEach` that makes a temp directory. Cross-checked
   * against `/usr/bin/time -p` solo `real 20.50` and `20.64`, less a boot floor of **1.13 s**
   * measured by bracketing the pair with two solo runs of
   * `packages/core/src/blockstore/memory.test.ts` (`real 1.20` and `1.06`) in the same session
   * — 19.37 and 19.51, agreeing with the reporter to within 2 %. Load was 4.84 → 5.86 on an
   * 8-core host. `(user+sys)/real` is **0.43**: the file spawns six `bin/agent.ts` children and
   * holds two 5 s absence windows, so most of that wall clock is waiting rather than computing.
   *
   * It is above `SLOW_CUTOFF_MS` by a factor of 19, so **it is paying its 19.2 s into every
   * `test:unit` run** until it is committed and the row can land. That cost is stated rather
   * than hidden, on the same terms as `job-entry-points`' 2 737 ms above. Whoever commits the
   * file should add `['packages/node/src/enrolment-needs-no-reservation.node.test.ts', 19_202]`
   * to the table, add the same figure to `sumOfFileSpansMs`, and drop `unitFiles` by one — or
   * re-measure.
   *
   * ## 166 → 167 on 2026-08-06 by Plan 24-07, and the whole delta is this plan's own file
   *
   * `packages/node/src/closed-fabric-agents.node.test.ts`. Two routes that share no code
   * agree, and they disagree by exactly the untracked file, which is the shape they are
   * supposed to have:
   *
   * | route | reading |
   * |---|---|
   * | the filesystem walk `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from | **167** |
   * | `git ls-files packages tools` filtered by the same globs | **166 tracked** |
   * | `git status --porcelain` untracked, filtered by the same globs | **1** — the file above |
   *
   * **No foreign arrival this time.** The one other file a concurrent agent added while this
   * plan ran is `packages/node/src/gated-seed.e2e.test.ts`, which the `node` project excludes
   * by suffix and which therefore moves nothing here. The count was **derived on the edited
   * tree rather than predicted**, which is how the previous re-site found that it was wrong by
   * one.
   *
   * **The span, measured rather than estimated, and it is a WALL CLOCK reading rather than a
   * reporter span — deliberately, and the gap is the finding.** `--reporter=json` attributes no
   * hook time, and this file's whole nine-process fixture is a single `beforeAll`. The reporter
   * says **10 136 ms** (sum of the two case durations, 10 136 ms, agreeing to within 1 ms — so
   * the reporter is internally consistent and still blind). `/usr/bin/time -p` solo says
   * `real 17.59 / user 9.44 / sys 1.65` and `real 17.43 / user 9.23 / sys 1.63` on two runs,
   * less a boot floor of **0.90 s** measured by bracketing the pair with two solo runs of
   * `packages/core/src/blockstore/memory.test.ts` (`real 0.93` and `0.87`) in the same session.
   * That gives **16 690 ms** and 16 530 ms. **The reporter is short by ~6.5 s, i.e. it cannot
   * see 39 % of this file's cost** — which is precisely the hook shadow
   * {@link NODE_MEASUREMENT.hookShadowCandidates} exists to count, reproduced by design rather
   * than discovered by accident, and disclosed in the file's own header before its readings.
   *
   * Load was 3.82 → 9.16, 1-minute average on an 8-core host. `(user+sys)/real` is **0.63**:
   * eight child processes, two enrolments and a 5 s absence window, so a large share of that
   * wall clock is waiting rather than computing. A comparability key, not a verdict.
   *
   * **Recorded here rather than in `MEASURED_NODE_SPANS`, for the live rule Plan 24-05 hit at
   * this exact spot**: the file is **untracked** — 24-07 runs in a shared checkout and is
   * forbidden `git add`, `git commit` and `git stash` — while `slow-specs.node.test.ts` asserts
   * as an equality that every path in that table is a committed file. Listing it would redden
   * that guard; counting it here is required by the same guard's filesystem-derived population.
   * Both rules are right and they point opposite ways, exactly as this docblock already records
   * for `job-entry-points`, `opt-in-only-sources` and `enrolment-needs-no-reservation`.
   *
   * It is above `SLOW_CUTOFF_MS` by a factor of 17, so **it pays its 16.7 s into every
   * `test:unit` run** until it is committed and a row can land. Whoever commits it should add
   * `['packages/node/src/closed-fabric-agents.node.test.ts', 16_690]` to the table with a
   * `// wall clock, hook-shadowed` note, add the same figure to `sumOfFileSpansMs`, and drop
   * `unitFiles` by one — or re-measure.
   */
  files: 167,
  tests: 2240,
  /**
   * Sum of the per-file costs the table below records — reporter spans for the files the
   * reporter can time, cross-checked wall clocks for the three it structurally cannot.
   * Not wall clock: vitest runs files in parallel, and see {@link NODE_MEASUREMENT} on why
   * this figure is now larger than it used to look.
   *
   * **Moved 2026-08-06 by exactly the one span added below**, 1_364_769 → 1_423_929, and by
   * nothing else. The pre-existing 7 943 ms by which this ran ahead of the table's own sum
   * is carried forward untouched rather than reconciled — it predates this plan, and
   * silently absorbing it into an addition would hide it.
   *
   * **Moved again the same day by Plan 24-04**, 1_423_929 → 1_465_924, which is exactly
   * 34 973 + 7 022 and nothing else. The 7 943 ms discrepancy above is still carried, still
   * unreconciled, and still not this plan's to absorb.
   */
  sumOfFileSpansMs: 1_465_924,
  /**
   * What `--reporter=json` alone said the same run summed to, i.e. the same number with
   * the three hook-shadowed files left at the value the reporter gave them.
   *
   * Recorded because the gap **is** the finding: 1_109_154 against 1_364_769 means the
   * instrument this table is derived from could not see **19 %** of the suite's cost, and
   * a pass that trusted it would have said so in a number nobody could check.
   *
   * The share is smaller than the previous pass's 35 % for one reason worth naming: almost
   * all of it is `echo-guest.node.test.ts`, and this run's solo reading of that file came
   * in at half the previous one (255.5 s against 521.0 s) on a warm container. The blind
   * spot did not shrink — the thing hiding in it did.
   */
  sumOfReportedSpansMs: 1_109_154,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 375_630,
  /**
   * How many files were cross-checked against a second instrument before their span was
   * written down, and how many of those disagreed with `--reporter=json`.
   *
   * **This is data rather than prose so that skipping the cross-check has to be an edit
   * rather than an omission.** See the method section in {@link MEASURED_NODE_SPANS}: the
   * previous pass's defect was not a wrong number, it was a method that made the wrong
   * number unavoidable and undetectable.
   */
  hookShadowCandidates: 6,
  hookShadowDisagreed: 2,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * `unitFiles` is not an independent reading — `slow-specs.node.test.ts` asserts it
   * equals `files` minus the derived exclusion count, so it moves when the table does.
   * It was **also observed directly** by running `npm run test:unit` against this table,
   * which is the cross-check that the derivation and the runner agree. Deriving it alone
   * would make the assertion a tautology.
   *
   * `unitTests` is the run's total including the skipped cases, because the figure this
   * field is compared against by hand is what the reporter prints, and it prints the total.
   *
   * `unitWallClockMs` is **stale as of this pass, and deliberately so.** It is still the
   * previous pass's reading — 7.75 s at 1-minute load **6.91**, on a run reporting
   * `98 passed (98)` / `1536 passed | 1 skipped` and exit 0 — while `unitFiles` beside it
   * now says 104. The two do not describe the same run, and that is the honest state
   * rather than an oversight.
   *
   * **Why it could not be retaken here.** `packages/node/src/bench-reduce.node.test.ts`
   * fails at this commit, with both it and the `bin/bench.ts` it parses byte-identical to
   * `HEAD` — a pre-existing failure this pass neither caused nor may fix. It is fast, so
   * it is *inside* `test:unit`. Every `test:unit` run obtainable at this commit is
   * therefore red, and by the rule below a duration from a red run is not written down.
   * The reading that was taken is not recorded anywhere, including here.
   *
   * The recorded history is the reason this object stores a load beside a duration rather
   * than a duration alone — 5.96 s at load 5.6, then 9.97 s at load 8.4, then 7.49 s at
   * load 6.1, then 8.37 s at load 11.7, then 9.25 s at load **58**, then 6.93 s at load
   * 5.3, then 9.53 s at load 4.9, then 7.75 s at load 6.9. The 58 and the 5.3 readings
   * together are the strongest evidence the field has produced: twelve times the load
   * moved the fast loop by under two and a half seconds, because what `test:unit` excludes
   * is the part that waits on child processes and what it keeps is CPU-cheap.
   *
   * Measured as a process rather than as a machine, that last green reading was
   * `real 7.75  user 28.36  sys 5.27`, a `(user+sys)/real` of **4.34**. The fast loop
   * saturates four cores, so it is bounded by work and not by waiting. Contrast this
   * pass's full run at 1.15 on the same host: the two projects are limited by different
   * things, which is exactly why a load average alone would have explained neither.
   *
   * **The next pass should retake this field first**, once `bench-reduce` is green — it is
   * the cheapest figure here and the only one currently carrying another run's date.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured
   * on a suite that did not pass is not a duration for the suite this field claims to
   * describe. That rule bit an earlier pass and is worth keeping: a `test:unit` run taken
   * against a half-updated table came back 7.97 s and **red**, because
   * `slow-specs.node.test.ts` was still holding the previous run's `unitFiles`. Its 7.97 s
   * is not written down anywhere.
   *
   * **104 → 108 on 2026-08-06, derived and NOT re-observed, which is a weakening of this
   * field and is recorded as one.** `slow-specs.node.test.ts` asserts
   * `unitFiles === files - EXCLUDED.length`, so re-siting `files` to 162 and adding one row
   * above the cut forces this number; the direct `npm run test:unit` cross-check that made
   * it more than a restatement of that assertion was **not** retaken, for the reason the
   * paragraph above already gives. Until it is, this field is a derivation wearing a
   * measurement's clothes, and the next full retake owes it a reading.
   *
   * **108 → 110 on 2026-08-06 by Plan 24-05, derived and NOT re-observed, and the direction
   * is the finding.** `files` moved 164 → 166 while `EXCLUDED.length` did not move at all,
   * because **neither** arriving file is in the table: `state-frontmatter.node.test.ts` was
   * never measured by anyone, and this plan's own spec is untracked and therefore cannot be
   * listed. So `files - EXCLUDED.length` grows by the full two. That is not bookkeeping — it
   * is the arithmetic saying plainly that `test:unit` now runs two more files than it did,
   * one of them a 19.2 s process-spawning spec. See {@link NODE_MEASUREMENT.files} for that
   * span, for how it was measured, and for what closes the gap. This field's own weakness is
   * unchanged and is now two re-sites deep: it is still a derivation, and the
   * `npm run test:unit` cross-check that would make it a measurement has still not been
   * retaken.
   *
   * **110 → 111 on 2026-08-06 by Plan 24-07, and this one WAS observed directly — the first
   * time in three re-sites.** `files` moved 166 → 167 while `EXCLUDED.length` did not move,
   * because this plan's file is untracked and therefore cannot be listed in the table, so
   * `files - EXCLUDED.length` grows by the full one. The derivation says 111; a direct
   * `npm run test:unit` run against this table says {@link NODE_MEASUREMENT.unitTests} below,
   * and the reading beside it is recorded there. Running it was safe to do while a concurrent
   * agent worked in the same checkout **for a checked reason rather than by luck**: the two
   * specs that snapshot `git status --porcelain` around themselves —
   * `bench-attestation.node.test.ts` and `discover-arm.node.test.ts` — are both above the cut
   * and are therefore both **excluded** from `test:unit`, which was verified against the
   * derived exclusion list before the run rather than assumed.
   */
  unitFiles: 111,
  /**
   * **1650 → 1716 and 7 750 → 25 950 on 2026-08-06 by Plan 24-07, both OBSERVED on one green
   * run**, which is the retake the `unitFiles` docblock above has been asking for since the
   * `bench-reduce` failure that blocked it. `npm run test:unit` exited **0** reporting
   * `Test Files 111 passed (111)` and `Tests 1715 passed | 1 skipped (1716)`, at
   * `real 25.95 user 58.30 sys 10.44`, 1-minute load **9.21 → 11.56** on an 8-core host.
   *
   * **The wall clock is not comparable with the 5.96 … 7.75 s history above, and saying so is
   * the point of writing it down.** Roughly **16.7 s of the 25.95 s is one file** —
   * `closed-fabric-agents.node.test.ts`, untracked and therefore unlistable in the table
   * below, so `test:unit` runs it. See {@link NODE_MEASUREMENT.files}. Subtract it and the
   * fast loop is ~9.3 s, which *is* comparable and sits inside the recorded band at this load.
   *
   * `(user+sys)/real` is **2.65**, against **4.34** on the last green reading. The fall is the
   * same one file: it spawns nine children and holds a 5 s window, so it adds wall clock
   * without adding CPU. Measured as a process rather than as a machine, exactly as the rule in
   * this object's own docblock requires.
   */
  unitTests: 1716,
  unitWallClockMs: 25_950,
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
 * `vitest run --project node --reporter=json`, **2026-08-05**, 157 files / 2240 tests.
 * Wall clock 375.6 s. Load average polled every 40 s: 9.32 at the start, **69.02 at its
 * peak**, 12.02 at the end.
 *
 * **This run was not green, and the rule about that is narrower than it looks.** Exit 1,
 * 2236 passed, 2 skipped, **2 failed**, and neither failure is a duration:
 *
 * - `slow-specs.node.test.ts` — the file-count drift guard, red *because* the table it
 *   checks was the stale one this pass replaces. It is red in every measurement run taken
 *   to fix drift, by construction, and this very edit clears it.
 * - `bench-reduce.node.test.ts` — **pre-existing and foreign.** It parses
 *   `packages/node/src/bin/bench.ts` and reports two unmet call-site requirements. Both
 *   that spec and the source it reads are byte-identical to `HEAD` (`git status` on both
 *   is empty), so it fails at this commit independently of anything here, and fixing
 *   another author's spec is not this pass's to do.
 *
 * Both are assertion failures in source-*parsing* guards. Neither aborts the run, spawns
 * anything, or changes another file's span: 2 of 2240 cases, in two files whose own spans
 * are 1.4 s and 0.4 s. The rule the {@link NODE_MEASUREMENT} `unitWallClockMs` docblock
 * states — *a duration measured on a suite that did not pass is not a duration for that
 * suite* — is applied there strictly, where a single aggregate number is at stake. It is
 * **not** applied to the per-file table here, because a fully green `--project node` run
 * is unobtainable at this commit without fixing a foreign defect, and the alternative to
 * recording this table is leaving the previous one in place while it is known to be wrong.
 * That trade is stated rather than taken quietly.
 *
 * The measurement replaced covered **150** files / 2133 tests, wall clock 293.7 s, 52
 * files at or above the cut. **The tree grew by seven files while that table stood still**,
 * which is what this pass exists to correct: `slow-specs.node.test.ts` reads the
 * filesystem, counted 157 against a recorded 150, and went red at a drift of 7 against its
 * tolerance of 5 — refusing every commit that touched a node spec, which three agents hit
 * in one day and two worked around with `O2_SKIP_GUARDS=1`. **The guard did its job**:
 * nothing here was discovered by anyone noticing, it was discovered by the count.
 *
 * ## Four spans Phase 20 handed over, and why not one of them is pinned on
 *
 * Recorded 2026-08-05 by plan 20-13, which owns this file for that phase and was told to
 * add *"any measured span handed over by 20-03, 20-06, 20-09, 20-10 or 20-11"*. **Nothing
 * was added and no figure moved.** Four of the five plans measured a span and handed it
 * over rather than editing this file out of turn, and every one of those four files was
 * then measured again by the whole-table retake above, in one run. Pinning the handed-over
 * value onto a table taken in a different run is the exact failure step 2 of the procedure
 * below forbids, and it would destroy the only property this table has.
 *
 * The four, with what was handed over beside what the retake read — so that a reader who
 * finds the hand-over in a summary does not go looking for a row that is missing, and can
 * see the size of the disagreement rather than being told there is none:
 *
 * | file | handed over | previous table | this table |
 * |---|---|---|---|
 * | `late-combine.node.test.ts` (20-03) | 7 740 ms of test time, 8 490 ms wall, solo | 15 467 | 15 189 |
 * | `speculation-agents.node.test.ts` (20-09) | 13 040 ms, solo `real` under `/usr/bin/time -p` | 12 310 | 13 753 |
 * | `coverage-agents.node.test.ts` (20-10) | 13 820 ms, solo, four quiet runs 13.82–14.29 s | 28 173 | 36 284 |
 * | `checkpoint-agents.node.test.ts` (20-11) | 10 400 ms of test time, 25 130 ms solo `real` | 6 392 | 6 465 |
 *
 * **The disagreements are the host and not the files**, which is the argument this whole
 * docblock already makes at length: the four hand-overs were solo readings on quiet hosts,
 * the retakes ran 150 and then 157 files in parallel, and both directions appear —
 * `coverage-agents` has now trebled its hand-over while `checkpoint-agents` sits at a
 * quarter of its. Two of the four hand-overs are also *test time* rather than a file span,
 * which is a third instrument again. Averaging any of that would produce a number nobody
 * measured.
 *
 * **A third column was added rather than the second being overwritten**, because the pair
 * is now itself evidence: `late-combine` (15 467 → 15 189) and `checkpoint-agents`
 * (6 392 → 6 465) reproduced within 2 % across two independent runs at peak loads of 109
 * and 69, while `coverage-agents` moved 29 % on nothing. Which spans are stable and which
 * are weather is not visible from one run, and it is visible from two.
 *
 * The fifth plan, 20-06, handed over nothing: it recorded no span for
 * `peer-ledger.e2e.test.ts` and says so in its own summary. That file is in the `e2e`
 * project in any case, and this table is the `node` project's.
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
 *    Bracket every such solo run with a solo run of a trivial spec, because ~1.3–5.4 s of
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
 * **The selection was mechanised this time, over all 157 files rather than over the five
 * that register a `beforeAll`.** For each file: the line of its first `it`/`test`, the line
 * and indent of every `beforeAll`/`beforeEach`, and the hook's body. A hook counts as
 * running before the first case if it is written above it **or** is at top level — a
 * root-suite hook runs before the first case wherever it is written, which a purely
 * line-order test misses. That widened the net from 5 to **47**, and then the body decided:
 * 44 of the 47 are a `beforeEach` that only `mkdtemp`s.
 *
 * **Two of the three survivors of the naive rule were false leads, and both are worth
 * recording because both would have been believed.** `peer-dial.node.test.ts` matched a
 * "does real work" pattern on the *string* `'o2-peer-dial-'` inside
 * `mkdtemp(join(tmpdir(), 'o2-peer-dial-'))` — a filename, not a dial. And
 * `lift.node.test.ts` has a genuine **top-level** `beforeAll`, which by the rule above runs
 * before its first case; reading it shows a synchronous `writeAcceptableElf()`, while the
 * container work is in two *nested* hooks at lines 1656 and 2576, below the first case at
 * 342. Grep selects; only reading the body decides.
 *
 * Every solo figure below is `/usr/bin/time -p`'s `real` less a boot floor of **1.18 s**,
 * the mean of three trivial-spec runs (`core/blockstore/memory.test.ts`: 1.12, 1.34, 1.07)
 * bracketing the batch, all taken after the foreign compile exited, at load 5.8–7.8.
 *
 * | file | hook before first case? | this run's span | Σ cases | solo `real` | verdict |
 * |---|---|---|---|---|---|
 * | `tools/aot/lift.node.test.ts` | top-level one is a sync file write; the container hooks are below case 1 | 371 637 | 29 473 | — | **gap 342 163 — the reporter saw it** |
 * | `bench-attestation.node.test.ts` | top-level, but only `mkdtemp` + `repoStatus` | 23 310 | 23 308 | — | Σ cases == span |
 * | `peer-dial.node.test.ts` | top-level, but only `mkdtemp` | 41 817 | 41 817 | — | Σ cases == span |
 * | `aot-dispatch.node.test.ts` | **yes — the `prepareGuest` hook opens `describe.skipIf(!MEASURABLE)`** | 14 514 | 14 514 | 6.13 s | **no repair possible — see below** |
 * | `start-reporting.node.test.ts` | **yes — the top-level `startNode` hook precedes every `describe`** | **90** | 89 | 1.95 s | **8.5× understated** |
 * | `tools/aot/echo-guest.node.test.ts` | **yes — its hook opens `a guest a translated artifact can finish a job with`** | **600** | 600 | 256.77 s | **426× understated** |
 *
 * **`echo-guest.node.test.ts` is the case this whole section exists for, and this run makes
 * the point harder than the last one did.** The reporter called it a **600 ms** file — down
 * from 2 019 ms, i.e. the blind spot got *deeper*, not shallower. It runs a real elfconv
 * lift in a container from a `beforeAll` above its first case, and alone it costs 256.77 s
 * of wall clock at `(user+sys)/real` = **0.015** — a process that is waiting, not computing.
 * Recorded at the reporter's figure it would have sat under the 1 000 ms cut by a factor of
 * 1.7, `test:unit` would have kept running it, and the fast inner loop would have grown by
 * minutes with nothing anywhere saying so.
 *
 * **`aot-dispatch.node.test.ts` is the case where the stated rule does not apply, and
 * saying so is the point.** Step 3 says the solo wall clock wins over the reporter. That
 * rule exists to repair an *understatement*. Here the reporter's in-run span is 14 514 ms
 * while the entire solo run — boot, hook and all three cases on a quiet host — took 6.13 s.
 * There is no understatement to repair: the reporter already charged the file more than it
 * costs alone, because in-run it shared eight workers and a docker daemon with 156 other
 * files. Substituting 4.95 s would replace a valid in-run reading with an out-of-run one
 * and make the table *more* of a blend, not less. Its in-run span is therefore recorded
 * unchanged, and it is counted as a candidate that **agreed**. (The previous pass met no
 * such tension: its reporter and solo figures were 22 452 and 22 393.)
 *
 * **`start-reporting.node.test.ts` reverses last pass's verdict, on four readings against
 * one.** It was recorded at 4 664 ms and excluded. Solo today it reads 1.76, 2.33, 1.82 and
 * 1.87 s — **765 ms** after the boot floor, four consecutive green runs at load 5.8–7.8,
 * all `3 passed (3)`. The file has exactly one commit in its history and was not touched
 * between the two passes, so this is the host and not the file: 4 664 ms is what three
 * in-process `startNode`s and two dials cost on a contended machine. It therefore drops
 * **below** the cut and returns to `test:unit`, costing that loop ~0.8 s. That is the
 * honest consequence of the measurement and it is not worth suppressing — but it is
 * exactly the boundary noise the run table below documents, and the next pass should
 * expect it to move again.
 *
 * ### The two substituted entries, and what that costs
 *
 * Two entries below carry a solo wall clock rather than this run's span, marked in line
 * (the previous pass had three; `aot-dispatch` is no longer one, for the reason above).
 * They are **not** commensurable with `wallClockMs`: `echo-guest`'s 255 540 is two thirds
 * of the whole run's 375 630, because alone it did not share a docker daemon with 156 other
 * files. The alternative was to record 600 ms, and that number is simply false.
 *
 * **`echo-guest`'s own solo figure halved between passes — 520 986 → 255 540 — and that is
 * not a contradiction to resolve by averaging.** At a CPU ratio of 0.015 the file is
 * waiting on a container, so what moved is the container: a warm image against a cold one.
 * Both are legitimate readings of *that* file on *that* day, which is why this table
 * records a date and a load and not a constant.
 *
 * `sumOfFileSpansMs` therefore sums the corrected values and
 * {@link NODE_MEASUREMENT.sumOfReportedSpansMs} sums what the reporter alone said. The gap
 * between them — 1 109.2 s against 1 364.8 s — is the size of the blind spot.
 *
 * ## An absolute millisecond cut is not reproducible, and this is the evidence
 *
 * The same rule was applied to **three** runs of the same tree on the same machine
 * within one hour, and selected a different set each time:
 *
 * | run | 1-min load | files at or above 1 s |
 * |---|---|---|
 * | 2026-07-29 (recorded by the prior pass) | ~9 | 23 |
 * | 2026-08-01, run 1 | 53 → 108 | 29 |
 * | 2026-08-01, run 2 | 10 → 25 | 28 |
 * | 2026-08-01, run 3 — the table until 2026-08-02 | 21 → 42 | 36 |
 * | 2026-08-02 — the table until 2026-08-03 | 50 → 115 → 16 | 28 |
 * | 2026-08-03, run 1 | 8.98 → 11.28, no mid-run sample | 36 |
 * | 2026-08-03, run 2 | 7.41 → 30.71 → 5.75, polled every 40 s | 40 |
 * | 2026-08-03, run 3 — the table until this one | 9.16 → 29.14 → 7.25, polled every 40 s | 34 |
 * | 2026-08-03, run 4 — the table until this one | 13.43 → 59.60 → 23.67, polled every 40 s | 35 |
 * | 2026-08-03, run 5 — the table until this one | 9.60 → 18.47 → 8.07, polled every 40 s | 35 |
 * | 2026-08-04 — the table until this one | 5.76 → 38.60 → 10.44, polled every 40 s | 37 |
 * | 2026-08-05, run 1 — the table until this one | 15.46 → 109.21 → 43.94, polled every 40 s | 52 |
 * | 2026-08-05, run 2 — **the table below** | 9.32 → 69.02 → 12.02, polled every 40 s | **53** |
 *
 * **The two 2026-08-05 rows are the strongest evidence here, because they are the same
 * tree on the same day at half the peak load.** Fifty-two became fifty-three while the
 * project grew by seven files — so neither the arrivals nor the halved load drove the
 * total. Underneath that near-identical number, **nine files crossed**: five in, four out.
 *
 * | crossing | old → new | why |
 * |---|---|---|
 * | `bench-fabric.node.test.ts` in | — → 2 361 | **new file** |
 * | `agent-handshake.node.test.ts` in | — → 1 643 | **new file** |
 * | `sovereign-block-refusal.node.test.ts` in | 839 → 1 013 | **edited** in `e30090c`, after the old table |
 * | `strip-comments.node.test.ts` in | 950 → 1 400 | untouched since 2026-08-04 |
 * | `purity.node.test.ts` in | 940 → 1 014 | untouched since 2026-08-04 |
 * | `start-reporting.node.test.ts` out | 4 664 → 765 | **method** — solo re-read, four times; see the cross-check section |
 * | `net/start-report.test.ts` out | 1 084 → 301 | untouched since 2026-08-04 |
 * | `node-identity.node.test.ts` out | 1 048 → 582 | untouched since 2026-08-04 |
 * | `identity-store.node.test.ts` out | 1 034 → 585 | untouched since 2026-08-04 |
 *
 * So of nine crossings, two are arrivals, one is an edit, one is a corrected measurement —
 * and **five moved on nothing at all**, four of them by more than half.
 *
 * The previous row's own reading of itself is worth keeping beside this: thirty-seven became
 * fifty-two there while the project grew by six files, only three above the cut, and it
 * attributed twelve of the fifteen crossings to a peak load of 109 against 38.6. Run 2
 * tests that claim by halving the peak load to 69 — and the excluded count did **not** fall
 * back; it rose by one. So load alone was never the explanation, and the honest summary is
 * the one the boundary paragraph below already gives: near 1 s, membership is close to a
 * coin toss, and no single run is the last word on it.
 *
 * The rows make the point repeatedly and in both directions. Between run 2 and run 3 —
 * same host, same load shape, one file added — exactly one file crossed *up*, and it was
 * the added one; **seven crossed down**: `core/job/submit` (1771 → 532 ms),
 * `sovereign-block-refusal` (1651 → 579), `rendezvous-wire` (1466 → 613), `fs-blockstore`
 * (1398 → 540), `net/churn` (1114 → 962), and — below 400 ms and therefore out of the
 * table entirely — `core/discovery` (1354 →) and `identity-store` (1038 →). Nothing about
 * any of the seven changed. Between run 3 and run 4, at **twice the load**, two crossed up
 * and one down. Between the two before that, six crossed up and two down, also on nothing.
 *
 * Run 5 is the sharpest row yet, because it moves in the direction nobody expects. The
 * tree grew by **two** files, one of which — `enrollment-cost.node.test.ts` at 11.0 s —
 * is comfortably above the cut, and the excluded count still came out at **35**. Three
 * files crossed *down* to pay for it: `relayed-job` and `wasi-executor` fell out of the
 * table's range entirely, and `churn.test.ts` — which read exactly 1 000 ms in run 4 —
 * read **974**. Nothing about any of the three changed except that the host was quiet.
 *
 * Membership near the boundary is noise, and `churn.test.ts` is the standing example:
 * 1134 ms, then 962, then **exactly 1000**, then 974, now **1002**. Five readings straddling
 * the cut, one of them *on* it, which is as close to a coin toss as a threshold can get.
 * (The file was edited once in that span, in `485130f`, so the last move is not purely
 * noise — but four of the five readings predate the edit and the spread is the same.)
 * **So the list cannot be made to enforce itself by re-timing** — a guard that re-measured
 * would disagree with itself between runs, and the only stable thing to check is structure.
 * That is what `packages/node/src/slow-specs.node.test.ts` does, and why it explicitly does
 * not re-time anything — it counts files, which is the one property of the project that a
 * quiet host and a loaded one agree on.
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
 * The 53 excluded files are **98.8 %** of the 1 356.8 s this table lists (1 340.4 s of it).
 * `lift.node.test.ts` at 371.6 s and `echo-guest.node.test.ts` at 255.5 s are **46 %** of it
 * in two files, and they are the single strongest argument for the cut existing at all —
 * one of which the instrument that built this table could not see, and called a 600 ms file.
 *
 * The excluded set went 52 → 53 while the project grew by seven files, two of them above
 * the cut. **Five of the nine crossings are neither arrivals nor edits** (see the run table
 * above). It is left as measured anyway: pinning entries at their old values would make
 * this table a blend of two runs, and its whole worth is that it is *one* run somebody can
 * reproduce.
 *
 * ## Entries below the cut are listed too, on purpose
 *
 * Everything down to roughly 300 ms is here, so the neighbourhood of the boundary is
 * visible and a file that crosses it is a one-line diff against a recorded number rather
 * than a rediscovery. Faster files are omitted.
 *
 * **Every one of the 157 was measured, and the 77 omitted ones were measured too** — the
 * distinction matters, because "not in the table" has to keep meaning "fast" rather than
 * "nobody looked", which is the failure this whole file was rebuilt to prevent.
 *
 * **Two of the 157 are measured, are above the floor, and still cannot be listed.** They
 * are the untracked pair named in {@link NODE_MEASUREMENT.files}: `job-entry-points`
 * (2 737 ms, above the *cut*) and `opt-in-only-sources` (5 ms). `slow-specs.node.test.ts`
 * requires every path here to be tracked, and requires the file count to come from the
 * filesystem. Listing them would fail the first rule; omitting them from the count would
 * fail the second. The gap is therefore recorded here rather than closed, and it closes
 * itself when those two are committed.
 *
 * ## Mechanism, where it was actually established
 *
 * Filename is not a usable signal and neither is the obvious mechanical proxy:
 * grepping for `node:child_process` or `docker` selects a different set —
 * `disclosure-gate`, `purity` and `vocabulary` all spawn real processes and are fast,
 * while `transport-bounds` and `admission` import neither and are among the slowest.
 * The mechanism notes below are only on the files where a previous pass verified one.
 * The rest are deliberately unannotated rather than guessed at.
 *
 * **Two entries carry a `// wall clock` note.** Those are the hook-shadowed files whose
 * reporter figure was an understatement: their number is `/usr/bin/time -p`'s `real` from a
 * solo run less the boot floor, because the figure this run's reporter gave them is not a
 * measurement of the file. The reporter's figure is in the note so the size of the gap
 * stays visible. `aot-dispatch.node.test.ts` is hook-shadowed too but carries no note, for
 * the reason given in the cross-check section: its reporter span already exceeds its whole
 * solo run, so there is nothing to repair.
 */
const MEASURED_NODE_SPANS: readonly (readonly [string, number])[] = [
  ['tools/aot/lift.node.test.ts', 371_637],
  ['tools/aot/echo-guest.node.test.ts', 255_540],  // wall clock; reporter said 600
  ['packages/node/src/discovery-agents.node.test.ts', 86_064],
  // Added 2026-08-06 by Plan 24-03 — see NODE_MEASUREMENT.files on what was retaken with
  // it. Reporter span, solo, no hook shadow: this file registers a `beforeEach` (a cheap
  // `mkdtemp`) and no top-level `beforeAll`, so the reporter's start is the file's start.
  // Cross-checked against `/usr/bin/time -p` real 60.73 / 60.87 s across two runs, less the
  // ~1.2 s boot floor — the reporter and the wall clock agree here, which is why this row
  // carries no `// wall clock` note.
  //
  // **Almost none of it is CPU.** `(user+sys)/real` is 0.043. Two of its five cases wait out
  // libp2p's own hard-coded clocks — a reservation refresh fixed at 30 s by
  // `REFRESH_TIMEOUT_MIN` and a 40 s TTL expiry — and neither can be shortened, which is
  // stated at those cases. It is a slow file that costs the machine nearly nothing.
  ['packages/node/src/enrol-through-a-closed-door.node.test.ts', 59_160],
  ['packages/node/src/quorum-agents.node.test.ts', 56_427],
  ['packages/node/src/enrollment.node.test.ts', 53_559],
  ['packages/node/src/peer-dial.node.test.ts', 41_817],
  ['packages/node/src/enrollment-cost.node.test.ts', 37_140],
  ['packages/node/src/coverage-agents.node.test.ts', 36_284],
  // Measured 2026-08-06 by Plan 24-04, at 1-minute load 4.37 on an 8-core host. Reporter span
  // 34_973, cross-checked against a solo `/usr/bin/time -p real 36.30` less a boot floor
  // measured in the same session at `real 1.49` — 34.81, agreeing to within 0.5 %. Its heavy
  // work is inside each `it`, not in a top-level hook, so there is no hook shadow to correct.
  ['packages/node/src/admission-agents.node.test.ts', 34_973],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 32_880],
  ['packages/node/src/orphan-leash.node.test.ts', 24_079],
  ['packages/node/src/bench-attestation.node.test.ts', 23_310],
  ['packages/node/src/sovereignty-placement.node.test.ts', 23_031],
  ['packages/node/src/certificate-verification.node.test.ts', 21_222],
  ['packages/node/src/two-process.node.test.ts', 19_455],
  ['packages/node/src/capability-dispatch.node.test.ts', 16_363],
  ['packages/node/src/result-signature.node.test.ts', 15_700],
  ['packages/node/src/late-combine.node.test.ts', 15_189],
  ['packages/node/src/fabric-node.node.test.ts', 14_701],
  ['packages/node/src/signed-artifact.node.test.ts', 14_633],
  ['tools/aot/cli.node.test.ts', 14_631],
  ['packages/node/src/aot-dispatch.node.test.ts', 14_514],
  ['packages/node/src/speculation-agents.node.test.ts', 13_753],
  ['packages/node/src/owner-domain-agents.node.test.ts', 12_603],
  ['packages/node/src/transport-bounds.node.test.ts', 12_294],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 11_428],
  ['packages/node/src/admission.node.test.ts', 11_104],
  ['packages/demo/src/kernel.test.ts', 10_753],
  ['packages/node/src/churn-agents.node.test.ts', 9_548],
  ['packages/node/src/duty-cycle.node.test.ts', 9_222],
  // Measured 2026-08-06 by Plan 24-04, same session as the entry above. Reporter span 7_022,
  // cross-checked against a solo `real 8.57` less the 1.49 boot floor — 7.08, agreeing to
  // within 1 %. No hook shadow: its `beforeEach` makes a temp directory and nothing else.
  ['packages/node/src/enrolment-residual.node.test.ts', 7_022],
  ['packages/node/src/checkpoint-agents.node.test.ts', 6_465],
  ['packages/node/src/discover-arm.node.test.ts', 5_603],
  ['packages/node/src/node-records.node.test.ts', 4_978],
  ['packages/node/src/trust-anchors.node.test.ts', 4_937],
  ['packages/node/src/peer-verifier.node.test.ts', 4_521],
  ['packages/node/src/egress-refusal.node.test.ts', 2_908],
  ['packages/node/src/egress-manifest.node.test.ts', 2_769],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 2_552],
  ['packages/node/src/bench-fabric.node.test.ts', 2_361],
  ['packages/node/src/execution-deadline.node.test.ts', 2_345],
  ['packages/node/src/provider-answering.node.test.ts', 2_261],
  ['packages/node/src/relaying.node.test.ts', 2_209],
  ['packages/node/src/peer-gate.node.test.ts', 2_186],
  ['packages/node/src/combine-signature.node.test.ts', 1_871],
  ['packages/node/src/named-refusal.node.test.ts', 1_726],
  ['packages/node/src/node-enrollment.node.test.ts', 1_709],
  ['packages/node/src/agent-handshake.node.test.ts', 1_643],
  ['packages/node/src/enrollment-dos.node.test.ts', 1_538],
  ['packages/node/src/strip-comments.node.test.ts', 1_400],
  ['packages/core/src/enrollment.test.ts', 1_329],
  ['packages/core/src/job/submit.test.ts', 1_098],
  ['packages/node/src/disclosure-gate.node.test.ts', 1_063],
  ['packages/node/src/purity.node.test.ts', 1_014],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 1_013],
  // ---- below the cut; listed so the boundary is visible, not excluded ----
  ['packages/net/src/reduce-job.test.ts', 997],
  ['packages/node/src/rendezvous-wire.node.test.ts', 940],
  ['packages/node/src/relay-admission.node.test.ts', 923],
  ['packages/aot/src/wasi-real.node.test.ts', 919],
  ['packages/core/src/discovery.test.ts', 884],
  ['packages/aot/src/wasi-executor.test.ts', 817],
  ['packages/node/src/relayed-job.node.test.ts', 768],
  ['packages/node/src/start-reporting.node.test.ts', 765],  // wall clock; reporter said 90
  ['packages/net/src/discovery.test.ts', 744],
  ['packages/net/src/discover-candidates.test.ts', 659],
  ['packages/net/src/provider-merge.test.ts', 648],
  ['packages/node/src/start-unwind.node.test.ts', 628],
  ['packages/node/src/fs-blockstore.node.test.ts', 603],
  ['packages/node/src/fs-issuance.node.test.ts', 586],
  ['packages/node/src/identity-store.node.test.ts', 585],
  ['packages/node/src/node-identity.node.test.ts', 582],
  ['packages/net/src/enrol-agent.test.ts', 514],
  ['packages/node/src/pi-reduce.node.test.ts', 479],
  ['packages/core/src/reduce.test.ts', 458],
  ['packages/node/src/requirements-ledger.node.test.ts', 432],
  ['packages/node/src/primes-reduce.node.test.ts', 404],
  ['packages/node/src/mutation-guard.node.test.ts', 403],
  ['packages/net/src/sovereign-execution.test.ts', 389],
  ['packages/node/src/commit-scope.node.test.ts', 366],
  ['packages/core/src/result-attestation.test.ts', 349],
  ['packages/net/src/enrol-protocol.test.ts', 303],
  ['packages/net/src/start-report.test.ts', 301],
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
