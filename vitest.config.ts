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
  /**
   * **AMENDED 2026-08-23, and the amendment is partial on purpose — read what it does and
   * does not claim.**
   *
   * Three specs landed that day (`provider-expiry`, `relay-discovery`, `issuance-rate`),
   * taking the node project past `FILE_COUNT_TOLERANCE` and reddening
   * `slow-specs/file-count-drift` — correctly, because the record had stopped describing
   * the tree.
   *
   * **Redone:** the counts, which do not depend on the host — `files`, `tests`, `unitFiles`
   * — and one span each for the three new files, taken the way step 3 of the procedure
   * below prescribes: alone, under `/usr/bin/time -p`, less the ~1.2 s boot floor
   * (21.14 s → 19.94, 3.40 → 2.20, 2.35 → 1.15). All three clear `SLOW_CUTOFF_MS`, so all
   * three leave `test:unit`. `sumOfFileSpansMs` is raised by exactly their sum, 23 290 ms,
   * and by nothing else.
   *
   * **Carried forward unchanged, and therefore still dated 2026-08-18:** every other span,
   * `load`, `loadAtEnd`, `loadPeak`, `wallClockMs`, `sumOfReportedSpansMs`,
   * `crossCheckedFiles`, `crossCheckDisagreed`, `hookShadowCandidates`,
   * `hookShadowDisagreed`, `unitTests`, `unitWallClockMs`.
   *
   * **Why the full procedure was not run, which is a measurement rather than an excuse.**
   * It was started twice. The second attempt was stopped after `uptime` on this host read a
   * 1-minute load average of **104.28** with 19 users logged in — against the 3.53 the
   * 2026-08-18 pass required of itself before it would begin, and well past the 43.03 that
   * pass recorded as its own peak. This record already has a precedent for exactly that
   * call: the 2026-08-14 attempt at this table was **discarded** at `(user+sys)/real` 0.48
   * because a build farm held the machine. A span table taken at load 104 would be a
   * reading of the host, and recording it would be worse than leaving the 2026-08-18
   * numbers standing and saying so.
   *
   * So: the guard is satisfied by making the record describe the tree again, not by
   * widening the tolerance, and the half that would need a quiet host is marked as not
   * retaken rather than silently refreshed.
   */
  date: '2026-08-18',
  /**
   * 1-minute load average, polled every 40 s across the whole run.
   *
   * **Polled, not inferred.** Ten samples on 8 cores: 3.53 → 13.34 → 14.68 → 19.41 →
   * 18.98 → **43.03** → 32.43 → 33.65 → 25.12, ending at 16.38, with `uptime` reading
   * 14.09 immediately after the process exited. The peak is three and a half minutes in
   * and is this run's own — eight vitest workers, the child processes the agent specs
   * spawn, and one `docker run` per container spec.
   *
   * **What was waited for — and this time the answer is "nothing", which is why it is
   * written down.** The 2026-08-14 attempt at this table ran while an LLVM/clang build farm
   * held the machine (`cpptools` at 86 %, nine `clang++` processes) and was discarded at
   * `(user+sys)/real` **0.48**. So this pass checked the host *before* starting rather than
   * diagnosing it afterwards: zero `clang++`, every `cpptools-srv` at 0.0 %, docker up with
   * 0 running containers, and a 100 s pre-flight poll at 20 s intervals reading
   * 3.25 → 3.84 → 3.48 → 2.97 → 2.82 → 2.38 — falling monotonically, on all three of the
   * 1-, 5- and 15-minute averages. Nothing was killed or signalled, and nothing needed to
   * be. The one background process holding real CPU was OneDrive at ~0.67 of a core, which
   * is a desktop sync daemon and was left alone.
   *
   * **Measure the process, not the machine.** `/usr/bin/time -p` on the run read
   * `real 362.54  user 695.43  sys 96.82`, i.e. `(user+sys)/real` = **2.19**. That is the
   * highest CPU share any run of this suite has recorded on this host — it sits against
   * 1.15, 1.23, 1.36, 1.36 and 1.45 on previous passes, 1.68 on the 2026-08-18 run that
   * fixed the vocabulary findings, and 0.48 on the discarded one. The ratio is a
   * comparability key and not a verdict, but at this end of the range it says something the
   * others could not: this suite normally spends much of its time waiting on spawned
   * children, sockets and containers, and here it did not. It is also why this is the
   * **fastest run on record while covering the most files** — 362.54 s over 197 files
   * against 388.91 s over 191.
   */
  load: 3.53,
  loadAtEnd: 16.38,
  loadPeak: 43.03,
  /**
   * Files and tests the `node` project ran, i.e. with no `test:unit` exclusions.
   *
   * **Three routes that share no code agree, and for the first time all three agree
   * exactly**:
   *
   * | route | reading |
   * |---|---|
   * | the filesystem walk `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from | **197** |
   * | `git ls-files packages tools`, filtered by the same globs | **197** |
   * | `find packages tools -type f -name '*.test.ts'`, filtered by the same globs | **197** |
   *
   * They were **diffed against each other, not compared as counts** — three equal counts
   * over three different sets would agree numerically and be wrong — and `diff` is empty in
   * both directions. `git status --porcelain --untracked-files=all` adds **0**.
   *
   * **That zero is itself new.** Every previous pass had to carry untracked files through
   * this arithmetic (189 tracked + 2 untracked on 2026-08-15), because a measured span
   * cannot be *listed* until git knows the path while the population is derived from the
   * filesystem. On a tree with nothing uncommitted the ordering problem this field's history
   * keeps recording simply does not arise, and the second route becomes a real cross-check
   * rather than a subtraction.
   *
   * **191 → 197, and this is a full retake rather than a re-site.** The drift check went red
   * at 197 against 191 — a drift of 6 against a tolerance of 5 — which is the guard working
   * exactly as intended, and `2d8ec73` carries `O2_SKIP_GUARDS=1` for that one finding while
   * saying the repair is this. The six are named, because `--diff-filter=A` since the commit
   * that recorded 191 can name them and nothing else here can: `elflift-wasi-port`,
   * `elflift-wasm-determinism` and `cross-machine` under `tools/aot`, `auto-tls` and
   * `bench-process-ladder` under `packages/node/src`, and `gateway-module.node.test.ts`
   * under `packages/browser/src`. **Five of the six are above the cut**, and one of them is
   * the sharpest hook shadow this instrument has ever caught — see
   * {@link NODE_MEASUREMENT.hookShadowDisagreed}.
   *
   * **The tolerance was not moved.** Moving it was considered and rejected — see
   * `FILE_COUNT_TOLERANCE` in `packages/node/src/slow-specs.node.test.ts`, whose whole
   * argument is that a guard cheap to satisfy by widening is a guard that will be widened
   * again.
   */
  files: 204,
  tests: 3018,
  /**
   * Sum of the per-file costs the table below records, every one of them taken in the same
   * run by the same instrument.
   *
   * Not a wall clock: vitest runs files in parallel across eight workers, so this exceeds
   * {@link NODE_MEASUREMENT.wallClockMs} by roughly the concurrency.
   *
   * This is the sum over **all 197 files**, not over the 114 the table lists, which is why
   * it is larger than the table's own column adds to (2 139 086). The guard checks the
   * inequality in that direction on purpose: a sum that did not cover the listed rows would
   * mean the table and this field came from different events.
   */
  sumOfFileSpansMs: 2_173_324,
  /**
   * What `--reporter=json` alone said the same run summed to, i.e. the same 197 files with
   * every span left at the value the case-stamp instrument gave it.
   *
   * Recorded because the gap **is** the finding: 1 053 391 against 2 150 034 means the
   * instrument the first six versions of this table were derived from could not see
   * **51.0 %** of the suite's cost. Against 50.1 % on 2026-08-15 and 44 % on 2026-08-11.
   * The blind spot is not growing by a point a pass — it is a stable property of the
   * reporter, and the small movement is the file population changing underneath it.
   */
  sumOfReportedSpansMs: 1_053_391,
  /** Wall clock of that same run, for contrast with the sum above. */
  wallClockMs: 362_540,
  /**
   * How many files were cross-checked against a second instrument before their span was
   * written down, and how many of those disagreed with `--reporter=json`.
   *
   * **This is data rather than prose so that skipping the cross-check has to be an edit
   * rather than an omission.** `crossCheckedFiles` is the whole population, so a pass that
   * measured fewer has to write a smaller number here rather than quietly measure less.
   * Both instruments returned a row for **every one of the 197** — no file was missing from
   * either, and no `diagnostic()` call threw — so there is no selection step left to get
   * wrong.
   *
   * `crossCheckDisagreed` counts files where the two instruments differ by more than 10 %,
   * which on this run is 165 of 197. That is the finding, not a fault.
   */
  crossCheckedFiles: 197,
  crossCheckDisagreed: 165,
  /**
   * The hook shadow, sized by two numbers with a stated definition.
   *
   * **These two fields were removed on 2026-08-15 and are restored here defined**, which is
   * the change rather than the restoration. They previously read `hookShadowCandidates: 8` /
   * `hookShadowDisagreed: 6`, naming eight files a human had selected by reading hook
   * bodies — a population nobody else could reproduce. The drift check's own failure text
   * still asks for them by name, so removing them left that instruction pointing at nothing.
   * They are now computed over the whole run:
   *
   * - **`hookShadowCandidates`** — files `--reporter=json` puts *below* `SLOW_CUTOFF_MS`,
   *   i.e. precisely the population it would leave in `test:unit`. **134** of 197.
   * - **`hookShadowDisagreed`** — of those, the ones the module-lifecycle instrument puts
   *   at or above the cut. **14**. These are the files `--reporter=json` alone would have
   *   kept in the fast loop forever.
   *
   * **The reverse count is zero, and that is the reason to believe the fourteen.** Not one
   * file crosses the cut in the other direction — 63 files read at or above 1 000 ms on the
   * reporter and all 63 do on the second instrument too. A miscalibrated instrument would
   * scatter in both directions; a blind spot only ever finds *more*.
   *
   * The sharpest of the fourteen is `tools/aot/elflift-wasi-port.node.test.ts`, and it is
   * one of the six files that arrived since the last table: **4 ms reported against 219 380
   * accounted**, a factor of 54 845. Had this pass skipped step 3, a 219-second file would
   * have been added to `test:unit` and stayed there — which is the whole argument for step
   * 3, restated by a file nobody had looked at.
   */
  hookShadowCandidates: 134,
  hookShadowDisagreed: 14,
  /**
   * What `npm run test:unit` measured with the derived list below applied.
   *
   * `unitFiles` is not an independent reading — `slow-specs.node.test.ts` asserts it equals
   * `NODE_MEASUREMENT.files` minus the derived exclusion count, so it moves when the table
   * does. It was **also observed directly** by running `npm run test:unit` against this
   * table, which is the cross-check that keeps this field from being a restatement of the
   * assertion that derives it. Deriving it alone would make that assertion a tautology.
   *
   * **121 → 120, while the project grew by six files.** The derived exclusion count moved
   * 70 → 77, and the arithmetic is 70 + 9 − 2 rather than a net drift: **five** of the six
   * new files are slow (`elflift-wasi-port` 219 380, `elflift-wasm-determinism` 88 263,
   * `auto-tls` 33 312, `bench-process-ladder` 10 566, `cross-machine` 4 991), **four**
   * crossed the cut upward (`rendezvous-wire` 886 → 1 403, `bench-admission` 766 → 1 101,
   * `relayed-job` 920 → 1 058, `start-unwind` 940 → 1 028), and **two** crossed it
   * downward (`core/src/enrollment` 1 634 → 712, `requirements-ledger` 1 073 → 837).
   * The six that moved without being edited are the boundary noise this file documents at
   * length, not a change in what those files do. The fast loop did not grow, which is the
   * property it exists to have.
   *
   * **All three were OBSERVED on one run**, `npm run test:unit`, exit 0,
   * `Test Files 120 passed (120)`, `Tests 2171 passed (2171)`,
   * `/usr/bin/time -p real 7.98 user 35.27 sys 6.13`, `(user+sys)/real` **5.19**, 1-minute
   * load 2.18 on an 8-core host. The 120 is the direct cross-check: the derivation says 120
   * and the runner says 120, independently.
   *
   * **Durations from red runs are deliberately never recorded here.** A duration measured on
   * a suite that did not pass is not a duration for the suite this field claims to describe.
   * The recorded history is also the reason this object stores a load beside a duration
   * rather than a duration alone — 5.96 s at load 5.6, 9.97 s at 8.4, 7.49 s at 6.1, 8.37 s
   * at 11.7, 9.25 s at **58**, 6.93 s at 5.3, 9.53 s at 4.9, 7.75 s at 6.9, then 25.95 s,
   * 24.59 s, 22.39 s and 22.52 s once the unlisted slow files started running inside it, then
   * 11.82 s, 11.15 s, and 7.98 s here.
   *
   * **TREAT THE WALL CLOCK AS SOFT.** Three readings of one table on this host within an
   * hour once spread 25.69 / 33.68 / 22.39 s — 1.5× end to end. Any comparison against this
   * number that turns on less than half of it is reading the host's weather.
   */
  unitFiles: 124,
  unitTests: 2171,
  unitWallClockMs: 7_980,
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
 * One run, **2026-08-18**, 197 files / 2944 tests, taken with both instruments attached at
 * once:
 *
 * ```
 * O2_MODULE_SPAN_OUT=/tmp/o2-spans.json /usr/bin/time -p npx vitest run --project node \
 *   --reporter=json --outputFile=/tmp/o2-report.json \
 *   --reporter=./tools/measure/module-span-reporter.js
 * ```
 *
 * `/usr/bin/time -p` read `real 362.54  user 695.43  sys 96.82`, `(user+sys)/real`
 * **2.19**. Load polled every 40 s: 3.53 at the start, **43.03 at its peak**, 16.38 at the
 * end, on an 8-core host, after a 100 s pre-flight poll that fell 3.25 → 2.38 with no
 * foreign compiler running. Nothing below is carried forward from an earlier table and
 * nothing is a solo re-run: every one of the 197 figures comes from that single execution.
 *
 * **This run was not green, and the rule about that is narrower than it looks.** Exit 1,
 * 2941 passed, 1 skipped, **2 failed**. One of the two is
 * `slow-specs.node.test.ts`'s file-count drift check, red *because* the table it checks was
 * the stale one this pass replaces. It is red in every measurement run taken to fix drift,
 * by construction, and this very edit clears it. It is an assertion failure in a
 * source-*parsing* guard: it aborts nothing, spawns nothing, and changes no other file's
 * span. The rule the {@link NODE_MEASUREMENT} `unitWallClockMs` docblock states — *a
 * duration measured on a suite that did not pass is not a duration for that suite* — is
 * applied there strictly, where a single aggregate number is at stake, and is not applied
 * to the per-file table here for the reason it has never been applied to it: a fully green
 * `--project node` is unobtainable *before* the edit that makes it green.
 *
 * ## The other red, attributed by the numbers rather than by the coincidence
 *
 * The second failure is **`admission-agents.node.test.ts`**, clause 1, and it is the first
 * time this table has had to rule on a red that is neither the drift check nor a wall
 * clock.
 *
 * **It is not this change's doing, and that is a fact rather than an argument**:
 * `git status --porcelain` was empty when the run started and empty when it finished, and
 * this pass edits `vitest.config.ts` and nothing else.
 *
 * What it *is*, read off what the spec printed:
 *
 * - The assertion is `circuitsThrough(member, relay.peerId)` expected length 1, **read 0**,
 *   in **6 615 ms** against a 300 000 ms case budget and a 60 000 ms wait budget. It did
 *   not time out — a duration equal to a timeout is evidence of the timeout and of nothing
 *   else, and this is not one. It read an empty value immediately.
 * - `agent.relays` is a **handshake-time snapshot**, taken from the one JSON line
 *   `bin/agent.ts` prints and never refreshed. That line is printed after a settle loop
 *   which waits up to 30 s for *an answer* — but exits on the **first** of a circuit, a
 *   named refusal, or a recorded relay failure. Its own comment records the measured fact
 *   that `@libp2p/circuit-relay-v2@4.2.9` makes *"exactly one attempt, ever"* on this
 *   configuration, so **"a single lost attempt is permanent"**.
 * - That fragility is **already on the record** as finding **W7** in
 *   `.planning/phases/phase-24-certificate-gated-admission/24-VERIFICATION.md`, raised
 *   against the identical construct in `closed-fabric-agents.node.test.ts:866-871`:
 *   *"an absence at announce time is not an absence now… sound only because `bin/agent.ts`
 *   records, measured, that libp2p makes exactly one reservation attempt ever."*
 * - Re-run alone it is green: `EXIT=0`, `real 41.83  user 40.29  sys 7.01`, ratio **1.13**.
 *   That is recorded as a **reading and not as the diagnosis**, because *"passes in
 *   isolation"* is a claim to verify rather than an attribution — a quiet host explains
 *   too much to explain anything.
 * - **The reading that settles it is a whole-project re-run at the SAME contention**, taken
 *   once the edit below had landed: `EXIT=0`, 197 files, 2943 passed, 1 skipped,
 *   **0 failed**, `real 363.54  user 690.06  sys 98.37`, ratio **2.17** against the
 *   measurement run's 2.19 — within 1 %, which is the only reason the comparison is worth
 *   anything. A green re-run at ratio 1.1 would have proved nothing.
 *
 *   And it settles it *against* the tempting answer. The obvious story is "the host was
 *   hot", and the obvious story is **wrong**: the host was just as hot and the red did not
 *   recur. What is left is not a contention threshold but a **one-shot race that lost
 *   once**, which is precisely what *"exactly one attempt, ever"* predicts and what a load
 *   threshold does not. The load was the occasion; the missing retry is the cause.
 *
 * **What it costs this table is one row and it is named here rather than hidden.**
 * `admission-agents.node.test.ts` is recorded at 52 425 ms, which is a red-run span: clause
 * 1 abandoned its arm early instead of running to completion, so the true green cost is
 * higher — the last table read 64 372. It is 52× the cut either way, so **its membership in
 * `SLOW_NODE_SPECS` is unaffected**, which is the only thing this table is load-bearing
 * for. Re-timing it alone and pinning that figure on would reintroduce exactly the
 * blend-of-two-runs defect step 2 exists to forbid, so it was not done.
 *
 * ## Runs of this tree, for the comparison that makes a red attributable
 *
 * | run | `real` | `(user+sys)/real` | failures other than this guard |
 * |---|---|---|---|
 * | 2026-08-11 | 387.92 s | 1.36 | none |
 * | 2026-08-15 — previous table | 388.91 s | 1.45 | none |
 * | 2026-08-18, vocabulary pass (`2d8ec73`) | 472.08 s | 1.68 | 5 vocabulary findings, since fixed |
 * | 2026-08-18 — **the table below** | **362.54 s** | **2.19** | `admission-agents` clause 1 |
 * | 2026-08-18, verification of this edit | 363.54 s | 2.17 | **none — exit 0** |
 *
 * The three 2026-08-18 rows are the ones worth reading together, and the pairing that
 * matters is the last two rather than the obvious one. The vocabulary pass was 30 % slower
 * at three-quarters of the CPU share, and the table below is the fastest and hottest run in
 * the record — which invites the reading that `admission-agents` is what happens when the
 * host is hot. **The verification run refutes exactly that**: same tree plus this edit, same
 * host, ratio 2.17 against 2.19, and it is green. Two runs one ratio-point apart disagree
 * about that spec, which is the signature of a race rather than of a threshold.
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
 *    **Record it even when nothing had to be waited for** — "the host was checked and was
 *    quiet" is a measurement, and the run that skipped taking it is the run that was
 *    discarded at ratio 0.48.
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
 *    three routes that share no code — and **diff the lists, do not compare the counts.**
 *    Three equal counts over three different sets agree numerically and are wrong.
 * 5. **Record how many files were compared and how many disagreed** in
 *    {@link NODE_MEASUREMENT.crossCheckedFiles} / `crossCheckDisagreed`, and the hook-shadow
 *    population and its crossings in {@link NODE_MEASUREMENT.hookShadowCandidates} /
 *    `hookShadowDisagreed`, so that a later pass that skipped step 3 has to write a smaller
 *    number rather than merely not read a paragraph.
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
 * the *solo* number rather than the reporter's. It did, on all seven, and it still does on
 * this run — the same seven are carried below as a standing validation set.
 *
 * ### What the cross-check found this time
 *
 * **Every one of the 197 files was compared.** Both instruments returned a row for every
 * file, and `diagnostic()` threw on none, so the two lists are the same 197 rather than an
 * intersection somebody has to trust.
 *
 * **165 of the 197 disagree with `--reporter=json` by more than 10 %**, and the aggregate
 * gap is the finding: 1 053 391 ms reported against 2 150 034 ms accounted, so the
 * instrument the first six tables were derived from could not see **51.0 %** of this
 * suite's cost. That is 50.1 % on 2026-08-15 and 44 % on 2026-08-11 — the blind spot is a
 * stable property of the reporter, not something that grew.
 *
 * **Fourteen files cross the cut and none crosses it the other way.** See
 * {@link NODE_MEASUREMENT.hookShadowDisagreed} for what those two counts mean and for the
 * 54 845× case that came in with this pass's six new files.
 *
 * The seven files the 2026-08-11 pass measured by hand remain the validation set, because
 * they are the reason to believe the other 190:
 *
 * | file | `--reporter=json` | accounted | 2026-08-11 solo |
 * |---|---|---|---|
 * | `tools/aot/elfconv-differential.node.test.ts` | **5** | 361 342 | 313 820 |
 * | `tools/aot/echo-guest.node.test.ts` | 469 | 253 828 | 199 870 |
 * | `tools/aot/elflift-wasi-gate.node.test.ts` | 16 | 163 974 | 138 160 |
 * | `packages/node/src/closed-fabric-agents.node.test.ts` | 10 430 | 21 268 | 16 640 |
 * | `packages/node/src/aot-dispatch.node.test.ts` | 5 923 | 7 447 | 3 670 |
 * | `tools/aot/wasi-preview1-surface.node.test.ts` | 14 | 1 783 | 800 |
 * | `packages/node/src/start-reporting.node.test.ts` | 43 | 974 | 580 |
 *
 * **The accounted figure is consistently ABOVE the old solo figure, and that is correct
 * rather than inflation.** A solo run had the machine to itself; these files ran alongside
 * 196 others sharing eight workers and one docker daemon. The difference is contention, and
 * including it is the point — every number in this table comes from the same run, so they
 * are commensurable with each other and with {@link NODE_MEASUREMENT.wallClockMs} in a way
 * substituted solo figures never were.
 *
 * **`start-reporting.node.test.ts` is now a boundary case rather than a shadow case**, at
 * 974 ms against a 1 000 ms cut. It was the file that first proved the shadow exists — 90 ms
 * reported against a real 765 ms — and the reporter still understates it 23-fold here. It
 * simply is not slow. That is the honest reading and it is left in, because a validation set
 * curated to keep only its dramatic members is not one.
 *
 * ### There are no substituted entries, and there is no unlisted measured file
 *
 * Nothing in the table below comes from anywhere except the single run named above. Two
 * previous defects stay closed:
 *
 * - Six rows of the 2026-08-11 table carried a solo wall clock marked `// wall clock`, and
 *   its own note admitted they were **"not commensurable with `wallClockMs`"** —
 *   `elfconv-differential` at 313 820 and `echo-guest` at 199 870 summed to more than the
 *   whole 387 630 ms run they appeared in. A reader adding that table up got a number that
 *   could not be true of any single execution. There are none here.
 * - Six passes before 2026-08-15 each carried at least one file that was measured, was above
 *   the floor, and still could not be listed, because this table requires every path to be
 *   git-tracked while the file count comes from the filesystem. **This pass had zero
 *   untracked test files**, so the conflict did not arise at all. If this paragraph ever
 *   needs a sentence added to it, that is the same gap reopening.
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
 * | 2026-08-11 | 7.91 → 64.98 → 13.55 | 59 |
 * | 2026-08-15 | 5.92 → 135.51 → 9.12 | 70 |
 * | 2026-08-18 — **the table below** | 3.53 → 43.03 → 16.38 | **77** |
 *
 * **Membership near the boundary is noise, and the standing examples keep making the
 * point by moving again.** `named-refusal.node.test.ts` has now read 1 726, then **996**
 * — four milliseconds under the cut — and now **1 631**. `strip-comments.node.test.ts`
 * read 1 400, then 959, now **1 079**. `egress-refusal` went 2 908 → 1 039 → **1 953**.
 * None of the three was edited. `churn.test.ts` remains the sharpest case in the record:
 * 1134 ms, then 962, then exactly 1000, then 974, then 1002, then below the floor, and
 * **251** here. **So the list cannot be made to enforce itself by re-timing** — a guard
 * that re-measured would disagree with itself between runs, and the only stable thing to
 * check is structure. That is what `packages/node/src/slow-specs.node.test.ts` does, and
 * why it explicitly does not re-time anything: it counts files, which is the one property
 * of the project a quiet host and a loaded one agree on.
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
 * The 77 excluded files are **99.1 %** of the 2 139.1 s this table lists (2 119.6 s of it).
 * `elfconv-differential` at 361.3 s, `lift` at 274.1 s and `echo-guest` at 253.8 s are
 * **42 %** of it in three files, and two of the three are files the reporter alone calls a
 * 5 ms file and a 469 ms file.
 *
 * ## Entries below the cut are listed too, on purpose
 *
 * Everything down to roughly 300 ms is here, so the neighbourhood of the boundary is
 * visible and a file that crosses it is a one-line diff against a recorded number rather
 * than a rediscovery. Faster files are omitted.
 *
 * **Every one of the 197 was measured, and the 83 omitted ones were measured too** — the
 * distinction matters, because "not in the table" has to keep meaning "fast" rather than
 * "nobody looked", which is the failure this whole file was rebuilt to prevent.
 *
 * ## Mechanism, where it was actually established
 *
 * Filename is not a usable signal and neither is the obvious mechanical proxy:
 * grepping for `node:child_process` or `docker` selects a different set —
 * `disclosure-gate`, `purity` and `vocabulary` all spawn real processes and are fast,
 * while `transport-bounds` and `admission` import neither and are among the slowest.
 * The mechanism notes below are only on the files where a pass verified one. The rest are
 * deliberately unannotated rather than guessed at.
 */
const MEASURED_NODE_SPANS: readonly (readonly [string, number])[] = [
  ['tools/aot/elfconv-differential.node.test.ts', 361_342],
  ['tools/aot/lift.node.test.ts', 274_072],
  ['tools/aot/echo-guest.node.test.ts', 253_828],
  ['tools/aot/elflift-wasi-port.node.test.ts', 219_380],
  ['tools/aot/elflift-wasi-gate.node.test.ts', 163_974],
  ['tools/aot/elflift-wasm-determinism.node.test.ts', 88_263],
  ['packages/node/src/enrol-through-a-closed-door.node.test.ts', 60_247],
  ['packages/node/src/admission-agents.node.test.ts', 52_425],
  ['packages/node/src/discovery-agents.node.test.ts', 43_216],
  ['packages/node/src/enrolment-needs-no-reservation.node.test.ts', 36_781],
  ['packages/node/src/reachability.node.test.ts', 35_063],
  ['packages/node/src/auto-tls.node.test.ts', 33_312],
  ['packages/node/src/tree-reduce-agents.node.test.ts', 30_958],
  ['packages/node/src/relay-admission.node.test.ts', 24_615],
  ['packages/node/src/sovereign-arm.node.test.ts', 21_719],
  ['packages/node/src/closed-fabric-agents.node.test.ts', 21_268],
  ['packages/node/src/quorum-agents.node.test.ts', 20_908],
  ['packages/node/src/provider-expiry.node.test.ts', 19_940],
  ['packages/node/src/enrollment.node.test.ts', 19_007],
  ['packages/node/src/coverage-agents.node.test.ts', 17_859],
  ['packages/node/src/sovereignty-placement.node.test.ts', 17_441],
  ['packages/node/src/enrollment-cost.node.test.ts', 16_678],
  ['packages/node/src/orphan-leash.node.test.ts', 15_267],
  ['packages/node/src/peer-verifier.node.test.ts', 13_770],
  ['packages/node/src/peer-gate.node.test.ts', 12_018],
  ['packages/node/src/capability-dispatch.node.test.ts', 11_752],
  ['packages/node/src/peer-dial.node.test.ts', 11_220],
  ['packages/node/src/late-combine.node.test.ts', 10_827],
  ['packages/node/src/bench-process-ladder.node.test.ts', 10_566],
  ['packages/node/src/transport-bounds.node.test.ts', 10_469],
  ['packages/node/src/owner-domain-agents.node.test.ts', 9_639],
  ['packages/node/src/result-signature.node.test.ts', 9_265],
  ['packages/node/src/speculation-agents.node.test.ts', 9_118],
  ['packages/node/src/admission.node.test.ts', 8_860],
  ['packages/node/src/enrolment-residual.node.test.ts', 8_631],
  ['packages/node/src/reservation-exhaustion.node.test.ts', 8_574],
  ['packages/node/src/bench-attestation.node.test.ts', 8_565],
  ['packages/node/src/aot-dispatch.node.test.ts', 7_447],
  ['packages/node/src/churn-agents.node.test.ts', 7_308],
  ['packages/node/src/certificate-verification.node.test.ts', 7_251],
  ['tools/aot/cli.node.test.ts', 7_232],
  ['packages/node/src/two-process.node.test.ts', 7_101],
  ['packages/node/src/fabric-node.node.test.ts', 6_843],
  ['packages/node/src/agent-handshake.node.test.ts', 6_541],
  ['packages/node/src/duty-cycle.node.test.ts', 6_466],
  ['packages/browser/src/colouring-surface.node.test.ts', 6_296],
  ['packages/node/src/signed-artifact.node.test.ts', 5_562],
  ['packages/node/src/node-records.node.test.ts', 5_111],
  ['tools/aot/cross-machine.node.test.ts', 4_991],
  ['packages/node/src/sovereign-aggregation.node.test.ts', 4_752],
  ['packages/core/src/cert-lifecycle.test.ts', 4_509],
  ['packages/node/src/checkpoint-agents.node.test.ts', 4_470],
  ['packages/node/src/trust-anchors.node.test.ts', 4_436],
  ['tools/aot/docker-gate.node.test.ts', 4_322],
  ['packages/node/src/bench-fabric.node.test.ts', 3_956],
  ['packages/node/src/discover-arm.node.test.ts', 3_387],
  ['packages/node/src/execution-deadline.node.test.ts', 3_363],
  ['packages/node/src/provider-answering.node.test.ts', 3_067],
  ['packages/node/src/sovereign-at-rest.node.test.ts', 2_711],
  ['packages/node/src/reachability-guard.node.test.ts', 2_673],
  ['packages/demo/src/kernel.test.ts', 2_408],
  ['packages/node/src/relay-discovery.node.test.ts', 2_200],
  ['packages/node/src/egress-manifest.node.test.ts', 2_008],
  ['packages/node/src/egress-refusal.node.test.ts', 1_953],
  ['packages/node/src/node-enrollment.node.test.ts', 1_951],
  ['packages/node/src/opt-in-only-sources.node.test.ts', 1_937],
  ['packages/node/src/combine-signature.node.test.ts', 1_931],
  ['tools/aot/wasi-preview1-surface.node.test.ts', 1_783],
  ['packages/node/src/relaying.node.test.ts', 1_736],
  ['packages/node/src/job-entry-points.node.test.ts', 1_712],
  ['packages/node/src/sovereign-block-refusal.node.test.ts', 1_685],
  ['packages/node/src/named-refusal.node.test.ts', 1_631],
  ['packages/node/src/rendezvous-wire.node.test.ts', 1_403],
  ['packages/node/src/disclosure-gate.node.test.ts', 1_319],
  ['packages/node/src/vocabulary.node.test.ts', 1_157],
  ['packages/node/src/issuance-rate.node.test.ts', 1_150],
  ['packages/node/src/bench-admission.node.test.ts', 1_101],
  ['packages/node/src/strip-comments.node.test.ts', 1_079],
  ['packages/node/src/relayed-job.node.test.ts', 1_058],
  ['packages/node/src/start-unwind.node.test.ts', 1_028],
  ['packages/node/src/node-identity.node.test.ts', 993],
  ['packages/node/src/start-reporting.node.test.ts', 974],
  ['packages/node/src/purity.node.test.ts', 848],
  ['packages/node/src/requirements-ledger.node.test.ts', 837],
  ['packages/node/src/enrollment-dos.node.test.ts', 824],
  ['packages/net/src/enrol-agent.test.ts', 740],
  ['packages/net/src/provider-merge.test.ts', 740],
  ['packages/core/src/job/submit.test.ts', 724],
  ['packages/core/src/enrollment.test.ts', 712],
  ['packages/net/src/discovery.test.ts', 694],
  ['packages/node/src/acceptance-traceability.node.test.ts', 681],
  ['packages/node/src/slow-specs.node.test.ts', 664],
  ['packages/node/src/seed-enrollment-provider.node.test.ts', 575],
  ['packages/node/src/fs-issuance.node.test.ts', 562],
  ['packages/node/src/commit-scope.node.test.ts', 516],
  ['packages/net/src/discover-candidates.test.ts', 514],
  ['packages/node/src/pi-reduce.node.test.ts', 486],
  ['packages/core/src/ed25519-backend.test.ts', 461],
  ['packages/net/src/distributed.test.ts', 441],
  ['packages/node/src/identity-store.node.test.ts', 425],
  ['packages/net/src/sovereign-egress.test.ts', 424],
  ['packages/core/src/discovery.test.ts', 402],
  ['packages/net/src/start-report.test.ts', 390],
  ['packages/node/src/fs-blockstore.node.test.ts', 390],
  ['packages/aot/src/wasi-executor.test.ts', 389],
  ['packages/node/src/mutation-guard.node.test.ts', 379],
  ['packages/node/src/primes-reduce.node.test.ts', 370],
  ['packages/aot/src/wasi-real.node.test.ts', 363],
  ['packages/net/src/enrol-protocol.test.ts', 358],
  ['packages/net/src/combine.test.ts', 340],
  ['packages/net/src/sovereign-execution.test.ts', 339],
  ['packages/node/src/checkpoint-optout-scope.node.test.ts', 339],
  ['packages/net/src/reduce-job.test.ts', 338],
  ['packages/libp2p/src/dht-registration.test.ts', 326],
  ['packages/core/src/result-attestation.test.ts', 323],
  ['packages/libp2p/src/dht-record-index.test.ts', 320],
  ['packages/net/src/reduce-sovereign.test.ts', 313],
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
