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
   * **A real peak, polled and not inferred.** Eight samples on 8 cores: 15.46 → 32.83 →
   * 75.01 → **109.21** → 99.46 → 72.20 → 40.29 → 41.83, ending at 43.94. The peak is two
   * to three minutes in, which is the usual shape here, and nearly all of it is *this
   * run's own*: eight vitest workers plus the child processes the agent specs spawn.
   *
   * **The host was waited for rather than assumed, and the wait is the expensive part of
   * this method.** Two things had to clear. A second agent's `--project node` suite was in
   * flight, and — separately — an unrelated LLVM `ninja` build under
   * `~/Projects/transpilers/cpp-to-rust` was holding twenty concurrent `clang++`
   * processes at a machine load average of 130–190. **Neither was killed or signalled.**
   * Polling ran for 46 minutes until the farm exited at 07:45:29Z; the farm then restarted
   * mid-pass and was waited out a second time. `clang` was 0 for six of this run's eight
   * samples and 16 in the last one, as the farm came back.
   *
   * **Measure the process, not the machine.** `/usr/bin/time -p` on the run read
   * `real 293.67  user 313.81  sys 45.99`, i.e. `(user+sys)/real` = **1.23**. That ratio
   * is a comparability key and not a verdict: this suite spends much of its time waiting
   * on spawned child processes and on sockets, so a figure near one core is what a healthy
   * run looks like here, and it sits beside the previous pass's 1.36 on the same host. The
   * peak load of 109.21 against a 1.23 CPU-time ratio is the whole argument for recording
   * both — load average counted runnable *and* I/O-blocked threads across the machine and
   * would have implied a starvation this process never suffered.
   */
  load: 15.46,
  loadAtEnd: 43.94,
  loadPeak: 109.21,
  /** Files and tests the `node` project ran, i.e. with no `test:unit` exclusions. */
  files: 150,
  tests: 2133,
  /**
   * Sum of the per-file costs the table below records — reporter spans for the files the
   * reporter can time, cross-checked wall clocks for the three it structurally cannot.
   * Not wall clock: vitest runs files in parallel, and see {@link NODE_MEASUREMENT} on why
   * this figure is now larger than it used to look.
   */
  sumOfFileSpansMs: 1_492_277,
  /**
   * What `--reporter=json` alone said the same run summed to, i.e. the same number with
   * the three hook-shadowed files left at the value the reporter gave them.
   *
   * Recorded because the gap **is** the finding: 968_848 against 1_492_277 means the
   * instrument this table is derived from could not see **35 %** of the suite's cost, and
   * a pass that trusted it would have said so in a number nobody could check.
   */
  sumOfReportedSpansMs: 968_848,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 293_670,
  /**
   * How many files were cross-checked against a second instrument before their span was
   * written down, and how many of those disagreed with `--reporter=json`.
   *
   * **This is data rather than prose so that skipping the cross-check has to be an edit
   * rather than an omission.** See the method section in {@link MEASURED_NODE_SPANS}: the
   * previous pass's defect was not a wrong number, it was a method that made the wrong
   * number unavoidable and undetectable.
   */
  hookShadowCandidates: 5,
  hookShadowDisagreed: 3,
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
   * `unitWallClockMs` is **one reading of a passing run at a stated load** and is not a
   * bound: 7.75 s at 1-minute load **6.91**, on a run reporting `98 passed (98)` /
   * `1536 passed | 1 skipped` and exit 0. Read it as under ten seconds, and read the
   * recorded history — 5.96 s at load 5.6, then 9.97 s at load 8.4, then 7.49 s at load
   * 6.1, then 8.37 s at load 11.7, then 9.25 s at load **58**, then 6.93 s at load 5.3,
   * then 9.53 s at load 4.9, now 7.75 s at load 6.9 — as the reason this object records a
   * load at all rather than a duration on its own. The 58 and the 5.3 readings together are
   * the strongest evidence the field has produced: twelve times the load moved the fast
   * loop by under two and a half seconds, because what `test:unit` excludes is the part
   * that waits on child processes and what it keeps is CPU-cheap.
   *
   * Measured as a process rather than as a machine: `/usr/bin/time -p` read
   * `real 7.75  user 28.36  sys 5.27`, a `(user+sys)/real` of **4.34**, unchanged from the
   * previous reading's 4.36. The fast loop saturates four cores, so it is bounded by work
   * and not by waiting. Contrast the full run's ratio of 1.23 on the same host: the two
   * projects are limited by different things, which is exactly why a load average alone
   * would have explained neither.
   *
   * **This reading fell while the project grew, and the reason is the cross-check.** The
   * fast loop went 107 files → 98 and 9.53 s → 7.75 s even though seven specs arrived,
   * because six of the seven are above the cut — and one of those six,
   * `start-reporting.node.test.ts`, is only above it because it was cross-checked against
   * `/usr/bin/time -p`. The reporter had it at 143 ms, which would have put it *in* this
   * loop and added its 4.7 s of real node-spawning to every invocation.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured
   * on a suite that did not pass is not a duration for the suite this field claims to
   * describe. That rule bit an earlier pass and is worth keeping: a `test:unit` run taken
   * against a half-updated table came back 7.97 s and **red**, because
   * `slow-specs.node.test.ts` was still holding the previous run's `unitFiles`. Its 7.97 s
   * is not written down anywhere.
   */
  unitFiles: 98,
  unitTests: 1537,
  unitWallClockMs: 7_750,
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
 * `vitest run --project node --reporter=json`, **2026-08-05**, 150 files / 2133 tests, on
 * a **green** run — exit 0, 2131 passed, 2 skipped. Wall clock 293.7 s. Load average
 * polled every 40 s: 15.46 at the start, **109.21 at its peak**, 43.94 at the end, on a
 * host waited for over 46 minutes until a foreign LLVM compile farm and another agent's
 * suite had both exited of their own accord.
 *
 * The measurement replaced covered **144** files / 2077 tests, wall clock 237.9 s, 37
 * files at or above the cut. **The tree grew by six files while that table stood still**,
 * which is what this pass exists to correct: `slow-specs.node.test.ts` reads the
 * filesystem, counted 150 against a recorded 144, and went red at a drift of 6 against its
 * tolerance of 5. The six are `aot-dispatch.node.test.ts`, `commit-scope.node.test.ts`,
 * `speculation-agents.node.test.ts`, `start-reporting.node.test.ts`,
 * `checkpoint-agents.node.test.ts` and `tools/aot/echo-guest.node.test.ts`, with
 * `coverage-agents.node.test.ts` arriving and `packages/core/src/coordinator.test.ts`
 * being deleted while this pass was measuring — the count was 151 for about twenty
 * minutes. **The guard did its job**: nothing here was discovered by anyone noticing, it
 * was discovered by the count.
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
 * Five files register a `beforeAll`; the other 145 register either nothing or a
 * `beforeEach` that only `mkdtemp`s — `relayed-job`, `sovereign-block-refusal`,
 * `fs-blockstore` and `fs-issuance` were read to confirm it, since all four sit below the
 * cut where a shadow would actually change the answer. Every solo figure below is
 * `/usr/bin/time -p`'s `real` less the boot floor of the two trivial-spec runs bracketing
 * it.
 *
 * | file | hook above first case? | this run's span | solo span | solo wall clock | verdict |
 * |---|---|---|---|---|---|
 * | `tools/aot/lift.node.test.ts` | no — all three sit below `the fixtures are the output they claim to be` | 291 680 | 365 524 | 369 826 | **agrees, 1.2 %** |
 * | `bench-attestation.node.test.ts` | no — its hook only `mkdtemp`s; see {@link readings} there | 166 740 | — | — | Σ cases == span |
 * | `aot-dispatch.node.test.ts` | **yes — the `prepareGuest` hook opens `describe.skipIf(!MEASURABLE)`** | 22 452 | 17 881 | **22 393** | hook 4.5 s unseen |
 * | `start-reporting.node.test.ts` | **yes — the top-level `startNode` hook precedes every `describe`** | **143** | 394 | **4 664** | **12× understated** |
 * | `tools/aot/echo-guest.node.test.ts` | **yes — its hook opens `a guest a translated artifact can finish a job with`** | **2 019** | 1 431 | **520 986** | **364× understated** |
 *
 * **`echo-guest.node.test.ts` is the case this whole section exists for.** The reporter
 * calls it a 2 019 ms file. It runs a real elfconv lift in a container from a `beforeAll`
 * above its first case, and alone it costs **524.79 s** of wall clock at
 * `(user+sys)/real` = **0.011** — a process that is waiting, not computing. Recorded at the
 * reporter's figure it would have sat comfortably under the 1 000 ms cut, `test:unit` would
 * have kept running it, and the fast inner loop would have grown by minutes with nothing
 * anywhere saying so. `start-reporting.node.test.ts` is the same failure at smaller
 * amplitude: 143 ms reported, 4 664 ms real, and the cut falls between them.
 *
 * **`lift.node.test.ts` is the control, and it corrects a claim that was made about it.**
 * It was read as *"the same shape, so its recorded 235 551 ms cannot have come from this
 * reporter."* Measurement says otherwise. All three of its `beforeAll`s sit **below** its
 * first case, so the container work falls inside the file's start-to-end window and the
 * reporter charges it: this run gave span 291 680 against Σ case durations of 24 587, a
 * gap of 267 093 ms that is precisely the hook time the reporter *did* see. Run alone the
 * same file read span 365 524 against a wall clock of 369 826 — **agreement within 1.2 %,
 * on two instruments in one process.** The old 235 551 ms is a legitimate reading of this
 * reporter, taken on a quieter host; the file's own docblock independently records 216.83 s
 * alone and 284.29 s under load, and 235 551 sits inside that band. The suspicion was
 * reasonable and it was wrong, which is why the discriminator above is stated positionally
 * rather than as "has a hook".
 *
 * ### The three substituted entries, and what that costs
 *
 * Three entries below carry a solo wall clock rather than this run's span, marked in line.
 * They are **not** commensurable with `wallClockMs`: `echo-guest`'s 520 986 exceeds the
 * whole run's 293 670, because alone it did not share a docker daemon with 149 other
 * files. Inside this run its pre-first-case gap was 266 371 ms against a queue tail of
 * 161 321 ms, so its hook cost *this run* somewhere between 105 s and 266 s — a range, not
 * a reading, which is exactly why the solo figure is the one recorded. The alternative was
 * to record 2 019 ms, and that number is simply false.
 *
 * `sumOfFileSpansMs` therefore sums the corrected values and
 * {@link NODE_MEASUREMENT.sumOfReportedSpansMs} sums what the reporter alone said. The gap
 * between them — 968.8 s against 1 492.3 s — is the size of the blind spot.
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
 * | 2026-08-05 — **the table below** | 15.46 → 109.21 → 43.94, polled every 40 s | **52** |
 *
 * **The 2026-08-05 row is by far the strongest evidence in this table, and it is a whole
 * order of magnitude of load.** Thirty-seven became **fifty-two** while the project grew by
 * six files, only three of which are above the cut. The other twelve crossings are the host:
 * this run peaked at load 109 against the previous run's 38.6, and a marginal file that read
 * 900 ms on a quiet host reads 1 300 ms on a loaded one without a line of it changing.
 * Three of the fifty-two are *not* noise and are named for it — `echo-guest`,
 * `aot-dispatch` and `start-reporting` are new files, and `start-reporting` only appears
 * above the cut because it was cross-checked; the reporter had it at 143 ms.
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
 * The 52 excluded files are **98.7 %** of the 1 486.3 s this table lists (1 466.8 s of it).
 * `echo-guest.node.test.ts` at 521.0 s and `lift.node.test.ts` at 291.7 s are **55 %** of it
 * in two files, and they are the single strongest argument for the cut existing at all —
 * one of which the instrument that built this table could not see.
 *
 * The excluded set went 37 → 52 while the project grew by six files, three of them above
 * the cut. **Twelve of the fifteen are load, not arrivals** (see the run table above). It
 * is left as measured anyway: pinning entries at their old values would make this table a
 * blend of two runs, and its whole worth is that it is *one* run somebody can reproduce.
 *
 * ## Entries below the cut are listed too, on purpose
 *
 * Everything down to roughly 300 ms is here, so the neighbourhood of the boundary is
 * visible and a file that crosses it is a one-line diff against a recorded number rather
 * than a rediscovery. Faster files are omitted.
 *
 * All six of this pass's new files clear that floor and appear below, which is itself a
 * load artefact — at load 109 very little of this project reads under 300 ms. **Every one
 * of the 150 was measured, and the 68 omitted ones were measured too** — the distinction
 * matters, because "not in the table" has to keep meaning "fast" rather than "nobody
 * looked", which is the failure this whole file was rebuilt to prevent.
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
 * **Three entries carry a `// wall clock` note.** Those are the hook-shadowed files: their
 * number is `/usr/bin/time -p`'s `real` from a solo run less the boot floor, because the
 * figure this run's reporter gave them is not a measurement of the file. The reporter's
 * figure is in the note so the size of the gap stays visible.
 */
const MEASURED_NODE_SPANS: readonly (readonly [string, number])[] = [
  ['tools/aot/echo-guest.node.test.ts', 520_986],  // wall clock; reporter said 2_019
  ['tools/aot/lift.node.test.ts', 291_680],
  ['packages/node/src/bench-attestation.node.test.ts', 166_740],
  ['packages/node/src/discovery-agents.node.test.ts', 39_775],
  ['packages/node/src/quorum-agents.node.test.ts', 31_121],
  ['packages/node/src/coverage-agents.node.test.ts', 28_173],
  ['packages/node/src/enrollment.node.test.ts', 24_225],
  ['packages/node/src/aot-dispatch.node.test.ts', 22_393],  // wall clock; reporter said 22_452
  ['packages/node/src/certificate-verification.node.test.ts', 20_533],
  ['packages/node/src/owner-domain-agents.node.test.ts', 19_638],
  ['tools/aot/cli.node.test.ts', 18_936],
  ['packages/node/src/orphan-leash.node.test.ts', 17_985],
  ['packages/node/src/sovereignty-placement.node.test.ts', 17_971],
  ['packages/node/src/late-combine.node.test.ts', 15_467],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 14_109],
  ['packages/node/src/result-signature.node.test.ts', 13_486],
  ['packages/node/src/capability-dispatch.node.test.ts', 13_288],
  ['packages/node/src/speculation-agents.node.test.ts', 12_310],
  ['packages/node/src/peer-gate.node.test.ts', 11_670],
  ['packages/node/src/transport-bounds.node.test.ts', 11_152],
  ['packages/node/src/discover-arm.node.test.ts', 10_807],
  ['packages/node/src/fabric-node.node.test.ts', 10_721],
  ['packages/node/src/signed-artifact.node.test.ts', 10_471],
  ['packages/node/src/enrollment-cost.node.test.ts', 9_988],
  ['packages/node/src/peer-dial.node.test.ts', 9_536],
  ['packages/node/src/churn-agents.node.test.ts', 9_483],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 9_300],
  ['packages/node/src/duty-cycle.node.test.ts', 8_802],
  ['packages/node/src/admission.node.test.ts', 8_603],
  ['packages/demo/src/kernel.test.ts', 6_481],
  ['packages/node/src/checkpoint-agents.node.test.ts', 6_392],
  ['packages/node/src/node-records.node.test.ts', 5_357],
  ['packages/node/src/peer-verifier.node.test.ts', 5_095],
  ['packages/node/src/trust-anchors.node.test.ts', 4_919],
  ['packages/node/src/two-process.node.test.ts', 4_761],
  ['packages/node/src/start-reporting.node.test.ts', 4_664],  // wall clock; reporter said 143
  ['packages/node/src/egress-manifest.node.test.ts', 3_708],
  ['packages/node/src/egress-refusal.node.test.ts', 3_643],
  ['packages/node/src/execution-deadline.node.test.ts', 2_683],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 2_415],
  ['packages/node/src/provider-answering.node.test.ts', 2_251],
  ['packages/node/src/relaying.node.test.ts', 2_125],
  ['packages/core/src/job/submit.test.ts', 1_800],
  ['packages/node/src/combine-signature.node.test.ts', 1_556],
  ['packages/node/src/node-enrollment.node.test.ts', 1_431],
  ['packages/node/src/enrollment-dos.node.test.ts', 1_320],
  ['packages/node/src/named-refusal.node.test.ts', 1_310],
  ['packages/core/src/enrollment.test.ts', 1_271],
  ['packages/net/src/start-report.test.ts', 1_084],
  ['packages/node/src/disclosure-gate.node.test.ts', 1_082],
  ['packages/node/src/node-identity.node.test.ts', 1_048],
  ['packages/node/src/identity-store.node.test.ts', 1_034],
  // ---- below the cut; listed so the boundary is visible, not excluded ----
  ['packages/node/src/pi-reduce.node.test.ts', 990],
  ['packages/node/src/start-unwind.node.test.ts', 962],
  ['packages/node/src/strip-comments.node.test.ts', 950],
  ['packages/node/src/purity.node.test.ts', 940],
  ['packages/node/src/relayed-job.node.test.ts', 897],
  ['packages/net/src/discover-candidates.test.ts', 896],
  ['packages/net/src/discovery.test.ts', 892],
  ['packages/node/src/rendezvous-wire.node.test.ts', 857],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 839],
  ['packages/net/src/provider-merge.test.ts', 815],
  ['packages/node/src/relay-admission.node.test.ts', 743],
  ['packages/node/src/primes-reduce.node.test.ts', 730],
  ['packages/net/src/reduce-job.test.ts', 712],
  ['packages/node/src/fs-blockstore.node.test.ts', 712],
  ['packages/core/src/result-attestation.test.ts', 652],
  ['packages/net/src/sovereign-execution.test.ts', 637],
  ['packages/aot/src/wasi-executor.test.ts', 608],
  ['packages/net/src/enrol-agent.test.ts', 564],
  ['packages/net/src/distributed.test.ts', 561],
  ['packages/core/src/discovery.test.ts', 537],
  ['packages/aot/src/wasi-real.node.test.ts', 462],
  ['packages/libp2p/src/identity.test.ts', 462],
  ['packages/node/src/fs-issuance.node.test.ts', 455],
  ['packages/node/src/mutation-guard.node.test.ts', 438],
  ['packages/aot/src/fixtures/wasi-fixtures.node.test.ts', 430],
  ['packages/aot/src/abi-router.test.ts', 424],
  ['packages/node/src/commit-scope.node.test.ts', 363],
  ['packages/net/src/combine.test.ts', 347],
  ['packages/aot/src/admission.test.ts', 333],
  ['packages/core/src/reduce.test.ts', 306],
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
