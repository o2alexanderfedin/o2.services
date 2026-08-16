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
  date: '2026-08-15',
  /**
   * 1-minute load average, polled every 40 s across the whole run.
   *
   * **Polled, not inferred.** Ten samples on 8 cores: 5.92 → 36.30 → 72.20 → **135.51** →
   * 113.44 → 69.45 → 59.97 → 40.67 → 22.89, ending at 13.46. The peak is two minutes in and
   * is this run's own — eight vitest workers, the child processes the agent specs spawn, and
   * one `docker run` per container spec.
   *
   * **A foreign compile WAS waited out this time, and that is why the start figure is low.**
   * The previous attempt at this table, on 2026-08-14, ran while an LLVM/clang build farm
   * held the machine — `cpptools` at 86 % and nine `clang++` processes — and produced
   * `real 1436.35 user 558.09 sys 131.76`, i.e. `(user+sys)/real` of **0.48**. That run was
   * discarded rather than recorded. A poller waited 930 s for the load to fall below 12 and
   * gave up; the reading here was taken the following morning once the farm had finished.
   * Nothing was killed or signalled.
   *
   * **Measure the process, not the machine.** `/usr/bin/time -p` on the run read
   * `real 388.91  user 490.10  sys 75.06`, i.e. `(user+sys)/real` = **1.45**. That ratio is a
   * comparability key and not a verdict: this suite spends much of its time waiting on
   * spawned children, on sockets and on containers, so a figure near one core is what a
   * healthy run looks like here. It sits beside the previous passes' 1.15, 1.23, 1.36 and
   * 1.36 on the same host, and against the discarded run's 0.48 — which is what a starved
   * one looks like, and the reason that run is not this one.
   */
  load: 5.92,
  loadAtEnd: 9.12,
  loadPeak: 135.51,
  /**
   * Files and tests the `node` project ran, i.e. with no `test:unit` exclusions.
   *
   * **Three routes that share no code agree**:
   *
   * | route | reading |
   * |---|---|
   * | the filesystem walk `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from | **191** |
   * | `git ls-files packages tools` filtered by the same globs | **189 tracked** |
   * | `git status --porcelain` untracked, filtered by the same globs | **2** |
   *
   * 189 + 2 = 191. The two untracked files are `dht-record-index.test.ts` and
   * `dht-registration.test.ts`, uncommitted at the moment of measurement and committed in
   * the same change as this table — which is the ordering this field's history keeps
   * demanding, because a measured span cannot be *listed* until git knows the path while the
   * population is derived from the filesystem.
   *
   * **184 → 191, and this is a full retake rather than a re-site.** The drift check went red
   * at 190 against 184 — a drift of 6 against a tolerance of 5 — the moment the DHT specs
   * landed, which is the guard working exactly as intended. **The tolerance was not moved**,
   * and moving it was considered and rejected — see `FILE_COUNT_TOLERANCE` in
   * `packages/node/src/slow-specs.node.test.ts`, whose whole argument is that a guard cheap
   * to satisfy by widening is a guard that will be widened again.
   */
  files: 191,
  tests: 2869,
  /**
   * Sum of the per-file costs the table below records, every one of them taken in the same
   * run by the same instrument.
   *
   * Not a wall clock: vitest runs files in parallel across eight workers, so this exceeds
   * {@link NODE_MEASUREMENT.wallClockMs} by roughly the concurrency.
   *
   * **The "not commensurable" caveat five previous tables carried is gone.** It existed
   * because six entries were solo wall clocks spliced into a table of in-run spans —
   * `elfconv-differential`'s 313.8 s and `echo-guest`'s 199.9 s summed to more than the
   * whole run they were listed in. Every figure here is now an in-run reading, so the sum,
   * the wall clock and the individual rows all describe one event.
   */
  sumOfFileSpansMs: 1_994_263,
  /**
   * What `--reporter=json` alone said the same run summed to, i.e. the same 191 files with
   * every span left at the value the case-stamp instrument gave it.
   *
   * Recorded because the gap **is** the finding: 995 250 against 1 994 263 means the
   * instrument the first six versions of this table were derived from could not see
   * **50.1 %** of the suite's cost. Against 44 % on 2026-08-11 — and the blind spot did not
   * grow by six points, the *measurement of it* did, because it now covers all 191 files
   * rather than the eight somebody selected by reading hook bodies.
   */
  sumOfReportedSpansMs: 995_250,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 388_910,
  /**
   * How many files were cross-checked against a second instrument before their span was
   * written down, and how many of those disagreed with `--reporter=json`.
   *
   * **This is data rather than prose so that skipping the cross-check has to be an edit
   * rather than an omission.** That intent is unchanged; what changed on 2026-08-15 is that
   * the cross-check now covers **every** file instead of a hand-picked eight, because the
   * second instrument is no longer a solo run — see {@link MEASURED_NODE_SPANS}'s method
   * section. The previous fields were `hookShadowCandidates: 8` / `hookShadowDisagreed: 6`,
   * naming the eight files a human selected by reading hook bodies. Selecting by hand is
   * what these two numbers now make unnecessary.
   *
   * `crossCheckedFiles` is the whole population, so a pass that measured fewer has to say a
   * smaller number here rather than quietly measure less. `crossCheckDisagreed` counts files
   * where the two instruments differ by more than 10 %, which on this run is most of them —
   * that is the finding, not a fault.
   */
  crossCheckedFiles: 191,
  crossCheckDisagreed: 162,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * `unitFiles` is not an independent reading — `slow-specs.node.test.ts` asserts it equals
   * `NODE_MEASUREMENT.files` minus the derived exclusion count, so it moves when the table
   * does. It was **also observed directly** by running `npm run test:unit` against this
   * table, which is the cross-check that keeps this field from being a restatement of the
   * assertion that derives it. Deriving it alone would make that assertion a tautology.
   *
   * **125 → 121, and the loop got SMALLER while the project grew by seven files.** The
   * derived exclusion count moved 59 → 70, because the instrument can now see the cost of
   * files it previously called 3 ms and 5 ms. Eleven files that were paying into the fast
   * loop with nobody able to measure what they cost have left it.
   *
   * **All three were OBSERVED on one run**, `npm run test:unit`,
   * `Test Files 121 passed (121)`, `Tests 2090 passed (2090)`,
   * `/usr/bin/time -p real 11.15 user 38.49 sys 7.07`, `(user+sys)/real` **4.08**, 1-minute
   * load 7.07 on an 8-core host. The 121 is the direct cross-check: the derivation says 121
   * and the runner says 121, independently.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured on
   * a suite that did not pass is not a duration for the suite this field claims to describe.
   * The recorded history is also the reason this object stores a load beside a duration
   * rather than a duration alone — 5.96 s at load 5.6, 9.97 s at 8.4, 7.49 s at 6.1, 8.37 s
   * at 11.7, 9.25 s at **58**, 6.93 s at 5.3, 9.53 s at 4.9, 7.75 s at 6.9, then 25.95 s,
   * 24.59 s, 22.39 s and 22.52 s once the unlisted slow files started running inside it, then
   * 11.82 s once they were listed and 11.15 s here.
   *
   * **TREAT THE WALL CLOCK AS SOFT.** Three readings of one table on this host within an
   * hour once spread 25.69 / 33.68 / 22.39 s — 1.5× end to end. Any comparison against this
   * number that turns on less than half of it is reading the host's weather.
   */
  unitFiles: 121,
  unitTests: 2090,
  unitWallClockMs: 11_150,
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
 * 3. **Take the spans from the module lifecycle, not from the case stamps.** Attach a
 *    second reporter implementing `onTestModuleEnd` and record, per file,
 *    `prepareDuration + collectDuration + setupDuration + duration` from
 *    `TestModule.diagnostic()`. `duration` is documented as *"accumulated duration of all
 *    tests **and hooks** in the module"* and `collectDuration` as the module's import — so
 *    together they cover both halves of the blind spot by construction. Run it in the
 *    **same** run as `--reporter=json` so the two instruments can be compared without the
 *    weather changing between them.
 * 4. **Re-derive `NODE_MEASUREMENT.files` independently**, at least twice and ideally by
 *    three routes that share no code.
 * 5. **Record how many files were compared and how many disagreed** in
 *    {@link NODE_MEASUREMENT.crossCheckedFiles} / `crossCheckDisagreed`, so that a later
 *    pass that skipped step 3 has to write a smaller number rather than merely not read a
 *    paragraph.
 *
 * **Step 3 replaced a hand-selection on 2026-08-15, and the old text is worth keeping in
 * view because it explains what the replacement buys.** It read: find every file whose
 * `beforeAll`/`beforeEach` runs before its first case and does real work, then *"each one is
 * run alone under `/usr/bin/time -p` and the wall clock wins over the reporter"*, bracketed
 * by a trivial spec to subtract a ~1.01 s boot floor. That procedure was correct and it had
 * three costs the new one does not: it selected by **reading hook bodies**, so a file nobody
 * thought to look at kept a false span; it produced figures **out of run**, which the
 * previous table's own note admits are *"not commensurable with `wallClockMs`"* — two
 * substituted files summed to more than the whole run; and it cost a solo re-run of a 314 s
 * file and a 200 s file, twice each, so it was expensive enough to be skipped.
 *
 * The replacement was **validated before it was trusted**, on a criterion stated in advance:
 * for the seven files the 2026-08-11 pass measured by hand, the accounted figure must track
 * the *solo* number rather than the reporter's. It did, on all seven — `elfconv-differential`
 * 3 ms reported against 387 284 accounted, `echo-guest` 398 against 289 730,
 * `wasi-preview1-surface` 5 against 2 263. Had they tracked the reporter instead, the
 * instrument would have been no better than the one it replaces and this note would say so.
 *
 * ### What the cross-check found this time
 *
 * **Every one of the 191 files was compared**, because the second instrument now runs
 * inside the same run rather than being a solo re-execution somebody had to choose to
 * perform. There is no selection step left to get wrong.
 *
 * The reporter is committed at `tools/measure/module-span-reporter.js`, so step 3 is a
 * command rather than a description:
 *
 * ```
 * O2_MODULE_SPAN_OUT=/tmp/spans.json npx vitest run --project node \
 *   --reporter=json --outputFile=/tmp/report.json \
 *   --reporter=./tools/measure/module-span-reporter.js
 * ```
 *
 * **162 of the 191 disagree with `--reporter=json` by more than 10 %**, and the aggregate
 * gap is the finding: 995 250 ms reported against 1 994 263 ms accounted, so the instrument
 * the previous six tables were derived from could not see **50.1 %** of this suite's cost.
 * That is up from the 44 % recorded on 2026-08-11, and the blind spot did not grow — the
 * measurement of it did, because it now covers every file instead of eight.
 *
 * The seven files the 2026-08-11 pass measured by hand are the validation set, and they are
 * kept here because they are the reason to believe the other 184:
 *
 * | file | `--reporter=json` | accounted | 2026-08-11 solo |
 * |---|---|---|---|
 * | `tools/aot/elfconv-differential.node.test.ts` | **3** | 387 284 | 313 820 |
 * | `tools/aot/echo-guest.node.test.ts` | 398 | 289 730 | 199 870 |
 * | `tools/aot/elflift-wasi-gate.node.test.ts` | 17 | 217 014 | 138 160 |
 * | `packages/node/src/closed-fabric-agents.node.test.ts` | 10 436 | 25 755 | 16 640 |
 * | `packages/node/src/aot-dispatch.node.test.ts` | 6 283 | 7 790 | 3 670 |
 * | `tools/aot/wasi-preview1-surface.node.test.ts` | 5 | 2 263 | 800 |
 * | `packages/node/src/start-reporting.node.test.ts` | 39 | 807 | 580 |
 *
 * **The accounted figure is consistently ABOVE the old solo figure, and that is correct
 * rather than inflation.** A solo run had the machine to itself; these files ran alongside
 * 190 others sharing eight workers and one docker daemon. The difference is contention, and
 * including it is the point — every number in this table now comes from the same run, so
 * they are commensurable with each other and with {@link NODE_MEASUREMENT.wallClockMs} in a
 * way the substituted solo figures never were.
 *
 * **`aot-dispatch.node.test.ts` stops being a special case.** The previous pass recorded it
 * as the one candidate where the rule *"the solo wall clock wins"* had to be suspended,
 * because its in-run reporter span (5 990 ms) already exceeded its whole solo run (4.68 s)
 * and substituting would have made the table more of a blend, not less. With both readings
 * taken in one run there is nothing to suspend: 6 283 reported against 7 790 accounted, the
 * same shape as every other row.
 *
 * ### There are no substituted entries any more, and that is the change
 *
 * Six rows of the previous table carried a solo wall clock instead of that run's span,
 * marked in line with a `// wall clock` note. They are gone — not because the files became
 * cheap, but because the instrument can now see them in the run. Nothing in the table below
 * comes from anywhere except the single run named above.
 *
 * That removes a stated defect rather than a cosmetic one. The old note admitted the
 * substituted figures were **"not commensurable with `wallClockMs`"**: `elfconv-differential`
 * at 313 820 and `echo-guest` at 199 870 summed to more than the whole 387 630 ms run they
 * appeared in, because alone neither shared a docker daemon with 183 other files. A reader
 * adding up that table got a number that could not be true of any single execution.
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
  ['tools/aot/elfconv-differential.node.test.ts', 387_284],
  ['tools/aot/lift.node.test.ts', 303_071],
  ['tools/aot/echo-guest.node.test.ts', 289_730],
  ['tools/aot/elflift-wasi-gate.node.test.ts', 217_014],
  ['packages/node/src/admission-agents.node.test.ts', 64_372],
  ['packages/node/src/discovery-agents.node.test.ts', 64_329],
  ['packages/node/src/enrol-through-a-closed-door.node.test.ts', 60_358],
  ['packages/node/src/coverage-agents.node.test.ts', 41_003],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 34_459],
  ['packages/node/src/quorum-agents.node.test.ts', 27_671],
  ['packages/node/src/reachability.node.test.ts', 26_312],
  ['packages/node/src/closed-fabric-agents.node.test.ts', 25_755],
  ['packages/node/src/enrollment.node.test.ts', 25_730],
  ['packages/node/src/relay-admission.node.test.ts', 23_698],
  ['packages/node/src/sovereign-arm.node.test.ts', 22_687],
  ['packages/node/src/enrolment-needs-no-reservation.node.test.ts', 21_376],
  ['packages/node/src/enrollment-cost.node.test.ts', 17_473],
  ['packages/node/src/sovereignty-placement.node.test.ts', 16_569],
  ['packages/node/src/late-combine.node.test.ts', 15_789],
  ['packages/node/src/peer-gate.node.test.ts', 14_979],
  ['packages/node/src/orphan-leash.node.test.ts', 14_410],
  ['packages/node/src/peer-verifier.node.test.ts', 13_295],
  ['packages/node/src/transport-bounds.node.test.ts', 11_056],
  ['packages/node/src/bench-attestation.node.test.ts', 10_748],
  ['packages/node/src/peer-dial.node.test.ts', 10_256],
  ['packages/node/src/admission.node.test.ts', 9_189],
  ['packages/browser/src/colouring-surface.node.test.ts', 9_136],
  ['packages/node/src/duty-cycle.node.test.ts', 8_379],
  ['packages/node/src/agent-handshake.node.test.ts', 8_285],
  ['packages/node/src/enrolment-residual.node.test.ts', 7_834],
  ['packages/node/src/aot-dispatch.node.test.ts', 7_790],
  ['packages/node/src/speculation-agents.node.test.ts', 7_326],
  ['packages/node/src/certificate-verification.node.test.ts', 7_230],
  ['packages/node/src/two-process.node.test.ts', 6_903],
  ['tools/aot/cli.node.test.ts', 6_537],
  ['packages/core/src/cert-lifecycle.test.ts', 6_332],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 6_254],
  ['packages/node/src/result-signature.node.test.ts', 5_631],
  ['packages/node/src/churn-agents.node.test.ts', 5_470],
  ['packages/node/src/node-enrollment.node.test.ts', 5_401],
  ['packages/node/src/bench-fabric.node.test.ts', 5_166],
  ['packages/node/src/signed-artifact.node.test.ts', 4_945],
  ['packages/node/src/checkpoint-agents.node.test.ts', 4_914],
  ['packages/node/src/combine-signature.node.test.ts', 4_778],
  ['packages/node/src/sovereign-aggregation.node.test.ts', 4_736],
  ['packages/node/src/owner-domain-agents.node.test.ts', 4_718],
  ['packages/node/src/fabric-node.node.test.ts', 4_661],
  ['packages/demo/src/kernel.test.ts', 4_450],
  ['packages/node/src/capability-dispatch.node.test.ts', 4_417],
  ['tools/aot/docker-gate.node.test.ts', 4_411],
  ['packages/node/src/trust-anchors.node.test.ts', 4_344],
  ['packages/node/src/reachability-guard.node.test.ts', 4_167],
  ['packages/node/src/relaying.node.test.ts', 4_014],
  ['packages/node/src/node-records.node.test.ts', 3_293],
  ['packages/node/src/discover-arm.node.test.ts', 2_855],
  ['packages/node/src/execution-deadline.node.test.ts', 2_591],
  ['packages/node/src/provider-answering.node.test.ts', 2_420],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 2_277],
  ['tools/aot/wasi-preview1-surface.node.test.ts', 2_263],
  ['packages/node/src/opt-in-only-sources.node.test.ts', 2_207],
  ['packages/node/src/named-refusal.node.test.ts', 1_803],
  ['packages/node/src/job-entry-points.node.test.ts', 1_715],
  ['packages/core/src/enrollment.test.ts', 1_634],
  ['packages/node/src/egress-refusal.node.test.ts', 1_461],
  ['packages/node/src/egress-manifest.node.test.ts', 1_443],
  ['packages/node/src/vocabulary.node.test.ts', 1_288],
  ['packages/node/src/disclosure-gate.node.test.ts', 1_226],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 1_188],
  ['packages/node/src/requirements-ledger.node.test.ts', 1_073],
  ['packages/node/src/strip-comments.node.test.ts', 1_009],
  ['packages/node/src/start-unwind.node.test.ts', 940],
  ['packages/node/src/relayed-job.node.test.ts', 920],
  ['packages/node/src/rendezvous-wire.node.test.ts', 886],
  ['packages/net/src/provider-merge.test.ts', 859],
  ['packages/node/src/start-reporting.node.test.ts', 807],
  ['packages/node/src/bench-admission.node.test.ts', 766],
  ['packages/net/src/discovery.test.ts', 758],
  ['packages/core/src/job/submit.test.ts', 752],
  ['packages/node/src/acceptance-traceability.node.test.ts', 726],
  ['packages/node/src/node-identity.node.test.ts', 697],
  ['packages/node/src/purity.node.test.ts', 676],
  ['packages/node/src/enrollment-dos.node.test.ts', 633],
  ['packages/node/src/seed-enrollment-provider.node.test.ts', 612],
  ['packages/net/src/enrol-agent.test.ts', 592],
  ['packages/node/src/mutation-guard.node.test.ts', 585],
  ['packages/libp2p/src/dht-registration.test.ts', 567],
  ['packages/net/src/distributed.test.ts', 531],
  ['packages/demo/src/kernel-build.node.test.ts', 527],
  ['packages/node/src/fs-issuance.node.test.ts', 509],
  ['packages/net/src/discover-candidates.test.ts', 502],
  ['packages/aot/src/wasi-executor.test.ts', 500],
  ['packages/node/src/identity-store.node.test.ts', 482],
  ['packages/aot/src/wasi-real.node.test.ts', 477],
  ['packages/net/src/reduce-job.test.ts', 472],
  ['packages/core/src/ed25519-backend.test.ts', 460],
  ['packages/node/src/checkpoint-optout-scope.node.test.ts', 457],
  ['packages/node/src/fs-blockstore.node.test.ts', 452],
  ['packages/demo/src/pi-build.node.test.ts', 450],
  ['packages/net/src/sovereign-execution.test.ts', 441],
  ['packages/net/src/sovereign-egress.test.ts', 424],
  ['packages/node/src/pi-reduce.node.test.ts', 414],
  ['packages/libp2p/src/identity.test.ts', 403],
  ['packages/node/src/commit-scope.node.test.ts', 398],
  ['packages/net/src/paused.test.ts', 391],
  ['packages/core/src/executor/attesting-executor.test.ts', 371],
  ['packages/net/src/remote-executor-contract.test.ts', 364],
  ['packages/node/src/constants.node.test.ts', 361],
  ['packages/core/src/discovery.test.ts', 360],
  ['packages/net/src/reduce-sovereign.test.ts', 350],
  ['packages/net/src/capability-extension-wire.test.ts', 346],
  ['packages/net/src/start-report.test.ts', 341],
  ['packages/libp2p/src/dht-record-index.test.ts', 339],
  ['packages/net/src/commit-reveal-wire.test.ts', 337],
  ['packages/node/src/one-crypto-implementation.node.test.ts', 336],
  ['packages/net/src/capability-authorizer.test.ts', 335],
  ['packages/core/src/result-attestation.test.ts', 334],
  ['packages/net/src/churn.test.ts', 329],
  ['packages/node/src/primes-reduce.node.test.ts', 326],
  ['packages/core/src/job/verify.test.ts', 324],
  ['packages/core/src/executor/worker-executor.test.ts', 323],
  ['packages/aot/src/abi-router.test.ts', 315],
  ['packages/net/src/combine.test.ts', 311],
  ['packages/core/src/reduce.test.ts', 307],
  ['packages/node/src/slow-specs.node.test.ts', 306],
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
