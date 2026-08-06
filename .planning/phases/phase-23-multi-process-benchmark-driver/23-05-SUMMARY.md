---
phase: phase-23-multi-process-benchmark-driver
plan: 05
subsystem: published-measurements, artifact-provenance, benchmark-driver
tags: [BENCH-07, criterion-1, criterion-2, criterion-3, criterion-4, published-run, frozen-artifact, artifact-guard, source-linkage, calibration-defect]
requires:
  - "packages/node/src/bin/bench.ts — 23-03's process driver, integrity gate and speedup sweeps; 23-04's exclusion reporting, factorial and process-lifetime repairs; 23-06's sovereign leg (all CONSUMED; bin/bench.ts EXTENDED here)"
  - "packages/bench/src/report.ts — the derived driver-named headings and the two provenance columns (UNCHANGED)"
  - "packages/bench/src/integrity.ts — fixtureUniformityViolations, the gate that made the sixteen-budget vector a run condition rather than a memory (UNCHANGED)"
  - "packages/node/src/strip-comments.ts — the shared tokenizer the source-linkage block strips with (UNCHANGED)"
  - ".planning/BENCHMARK-RESULTS.md as committed at 910e3b3 — the 2026-08-01 run, the input to the freeze"
provides:
  - ".planning/BENCHMARK-RESULTS-2026-08-01.md — the 2026-08-01 run byte for byte, at a path no driver writes"
  - ".planning/BENCHMARK-RESULTS.md — the published run: three makespan tables, a process table, a two-driver speedup comparison, the eight-cell factorial, and a link to the frozen artifact"
  - "packages/node/src/bench-results.node.test.ts — eight artifact requirements plus a source-linkage block, each watched reporting"
  - "a calibration that measures the shard it claims to: the label the wire requires, and a check that the call ran"
  - "bench-driver.node.test.ts's eleventh requirement, holding both halves of that repair"
affects:
  - "the phase verifier — BENCH-07 criteria 1, 2, 3 and 4 now have published evidence; criterion 5 is 23-06's"
  - "any later benchmark phase — the frozen artifact is the first figure set in this repository that a re-run cannot overwrite"
tech-stack:
  added: []
  patterns:
    - "a guard over a published artifact rather than a source, with a source-linkage block beside it because an artifact guard cannot see the driver"
    - "a linkage check that caught two sentences assembled across concatenation boundaries rather than written as literals"
    - "a published figure traced to sixteen refused calls by planting a probe, not by reading"
    - "an instrument required to check its own reading, because its failure mode is a plausible number"
    - "three full runs reported as a spread, because the difference between the drivers is smaller than the difference between runs"
decisions:
  - "the frozen artifact is named 2026-08-01 for the run's own stamp, read out of the committed report, not for the date it was frozen and not for the date a previous plan asserted"
  - "the report was re-generated rather than hand-edited on each of the three source repairs, because a report edited by hand is a report whose generator no longer produces it"
  - "run 3 is published although its host was the noisiest of the three: it is the only run whose generator is the committed one and the only one whose ideal bound is measured rather than fabricated"
  - "STATE.md, ROADMAP.md and REQUIREMENTS.md deliberately NOT touched — 23-01 through 23-04 and 23-06 all took the same position"
metrics:
  duration: 43m, measured — 2603 s between a recorded start epoch and the final check, not estimated
  completed: 2026-08-05
---

# Phase 23 Plan 05: Run it, publish it, and hold the published file to its provenance Summary

The benchmark ran, the numbers are in the repository, and the file that carries them is now
held to saying where each one came from. **Three findings, and two of them contradict what
this plan was handed.**

1. **The published "ideal bound" was `sum ÷ max` over sixteen calls that never ran.** Found
   by planting a probe, not by reading: every calibration call came back
   `malformed request` in 1.2–4.3 ms, against the ~90 ms the same shard costs in the rung's
   own dispatch intervals. Cause: `Task.label` is optional in process and **required at the
   wire**, and that call site had none. Repaired, and the repair is measured — the vector now
   reads 84–169 ms per shard.
2. **The process-per-node driver is NOT about half the speed of the in-process control.**
   That reading (`3.84×` against `7.76×`) was taken by 23-03 at one-minute load 80 with two
   other agents in the tree, and 23-03 said so in as many words. Re-taken three times on a
   quieter host, the two curves are within noise of each other and **crossed twice**. What
   survives from the framing is the part that matters: the control is not flat, because a
   `FabricNode` composes a `WorkerExecutor` on its own worker thread, so these sweeps compare
   **process isolation against threads inside one process** — not parallelism against none.
3. **The excluded rung's published cause does not survive its own factorial**, reproduced
   here for the third time with identical outcomes in every cell. Dial direction partitions
   cleanly; driver and cap placement each appear on both sides.

---

## The published figures, and the conditions they were taken under

**Read the conditions first.** The brief for this plan said the host was quiet and I was
alone. That was true when I started and stopped being true during execution:

```
ps -Ao pcpu,pid,comm -r | head
 95.5 76720 /opt/homebrew/opt/llvm/bin/clang++
 95.3 76721 /opt/homebrew/opt/llvm/bin/clang++
 65.7 83904 OneDrive
```

Two foreign compiler processes holding roughly two of eight logical cores, none of them
mine. **Every absolute in the published file was taken under that contention and is not
reusable.** The ratios are within-run comparisons — N=1 against N=8 in the same run, and
driver A against driver B in the same run — which is the reading the conventions ask for
precisely because it cancels the machine, the load and the I/O weather of the day.

| | published run |
|---|---|
| command | `node --experimental-strip-types packages/node/src/bin/bench.ts`, repository root, no flags |
| exit | **0**, read with `EXIT=$?` on the line immediately after, no pipe |
| timing | `real 207.42  user 371.01  sys 22.10` |
| `(user+sys)/real` | **1.90** |
| 1-min load | **13.52 at the start, 33.25 at the end** |
| `pgrep -f "agent.ts --dir"` after | **0** |
| `pgrep -f "bin/bench.ts"` after | **0** |

### Makespan, memory transport (in-process, trivial)

| nodes | p50 | n | incomplete |
|---|---|---|---|
| 1 | 26.8ms | 19 | 0 |
| 2 | 55.2ms | 19 | 0 |
| 4 | 51.8ms | 19 | 0 |
| 8 | 58.2ms | 19 | 0 |
| 16 | 57.0ms | 19 | 0 |

### Makespan, real transport (in-process, trivial)

| nodes | p50 | n | incomplete |
|---|---|---|---|
| 1 | 49.4ms | 19 | 0 |
| 2 | 92.3ms | 19 | 0 |
| 4 | 89.9ms | 19 | 0 |
| 8 | 96.6ms | 19 | 0 |

`real transport, 16 nodes` excluded on `EncryptionFailedError: read ECONNRESET`, with the
configuration that was in force rendered beside it and **no cause claimed** — that is
23-04's `describeExclusion`, and this is the first published run in which the stored
paragraph is gone.

### Makespan, real transport (process-per-node, saturating)

| nodes | p50 | n | incomplete |
|---|---|---|---|
| 1 | 1591.1ms | 19 | 0 |
| 2 | 980.3ms | 19 | 0 |
| 4 | 676.0ms | 19 | 0 |
| 8 | 590.0ms | 19 | 0 |

### Connectivity tax and COST

1.84× / 1.67× / 1.74× / 1.66× at 1/2/4/8. **No crossover**: best distributed p50 26.8ms at
1 node against a baseline p50 of 0.0040ms — **6702.75×**.

### The process table — criterion 1's evidence

| nodes | observed | oversubscribed | pids |
|---|---|---|---|
| 1 | 2 | no | 32497 |
| 2 | 3 | no | 33942, 33943 |
| 4 | 5 | no | 34928, 34929, 34931, 34930 |
| 8 | **9** | **yes** (8 logical cores) | 35534–35541 |

---

## Criterion 2's ratio, and the three runs it took to arrive at one

**Published (run 3):** process-per-node **2.70×** from N=1 to N=8; in-process control
**3.47×**. Derived ideal **9.78×**. Coordination ratio 0.99 / 1.18 / 1.08 / 0.77.

Three full runs of the identical shipped ladder were taken, and the spread across them is
larger than the difference between the drivers. **Publishing one of these as "the" answer
without the other two would be the softening this plan exists to prevent.**

| run | 1-min load | `(user+sys)/real` | proc N1→N8 | control N1→N8 | coordination 1/2/4/8 | calibration mean | derived ideal |
|---|---|---|---|---|---|---|---|
| 1 | 4.68 → 18.75 | 2.27 | 3.68× | 3.77× | 1.00 / 0.99 / 0.99 / 0.98 | 1.6ms *(refused)* | 8.17× *(void)* |
| 2 | 5.60 → 19.95 | 1.95 | 3.83× | 3.76× | 1.01 / 1.09 / 1.20 / 1.03 | 2.3ms *(refused)* | 8.71× *(void)* |
| **3 — published** | 13.52 → 33.25 | 1.90 | **2.70×** | **3.47×** | 0.99 / 1.18 / 1.08 / 0.77 | **103.5ms** | **9.78×** |
| 23-03's reading | 80.15 → 50.83 | — | 3.84× | 7.76× | 1.16 / 0.86 / 0.79 / 0.58 | — | 4.78× *(void)* |

**Why run 3 is the published one even though its host was the noisiest.** It is the only run
whose generator is the committed source, and the only one whose ideal bound is derived from
calls that ran. Runs 1 and 2 were produced by a driver whose calibration was measuring
refusals; their bounds are struck through above for that reason. Re-taking after run 3 was
not available — the host had got *worse*, not better, and re-running until a number looks
better is the failure this project is organised against.

**What the four rows say together.** The two drivers are within a few percent of each other
on a quiet host and cross in both directions. The one large gap in the table — 23-03's
`3.84×` against `7.76×` — was taken at load 80 with two other agents in the tree, and 23-03
itself labelled those figures *"functional readings, not publishable figures"* and told this
plan to re-take them. They are re-taken, and the gap does not reproduce.

### The confound readings, published beside the ratio

| reading | published run |
|---|---|
| `generations` | **1** on every rung of both sweeps — no shard was re-placed |
| `churn/task` | **0.00** on every rung |
| `spec. tax` | 1.00× / 1.06× / 1.06× / 1.03× (process), 1.00× / 1.06× / 1.06× / 1.01× (control) |
| `speculated` | `true` present on **five of eight** rungs — speculation fired |
| driver CPU share | **0.005–0.009** (process) against **0.107–0.324** (control) |

The CPU share is the reading that says the work left the driver process: two orders of
magnitude apart on the same fixture, same ladder, same job path. Speculation firing on the
saturating fixture is the confound 23-CONTEXT open question 4 flagged as unmeasured — the
trivial-fixture run reads `1.00×` everywhere, and this one does not.

### The shard status vector, observed end to end

**Sixteen `budget` results on every saturating rung of every run**, and it is enforced rather
than remembered: `fixtureUniformityViolations` raises `HarnessIntegrityError` out of `main()`
for any other vector, which is what 23-03's planted `SATURATING_N = 300` was watched doing
(`8 of 16 shards ended on something other than budget`). All three runs completed, so all
three passed the gate on every rung. `SATURATING_N` did **not** move, so no fifth amendment
was appended to `.planning/BENCHMARK-METHODOLOGY.md` and nothing in that file changed.

---

## The calibration defect — measured, then repaired, then measured again

**How it was found.** The published per-shard calibration read 1.2–4.3 ms while the same
rung's own dispatch-to-response intervals formed a staircase 119, 208, 303 … 1504 ms — a
~90 ms step per shard. A number 70× too small is not a number to reason about; it is a
number to probe.

**The probe.** `calibratePerShard` instrumented to print each outcome, ladders shortened to
one rung, run in a `mktemp -d` cwd, restored with `cp` and confirmed with `cmp` (exit 0) in
the same shell invocation:

```
  PROBE shard 0: ok=false REFUSED: remote error from 12D3KooWAjubnrLY…: malformed request
  … all sixteen, identical
```

**The cause, cited by symbol.** `parseRequest`'s exec branch in `packages/net/src/protocol.ts`
refuses a frame whose `label` is neither `public` nor `sovereign` — T-12-07 Correction 2, so
that an unlabelled task cannot reach `guardSovereignty` as a no-op. `Task.label` stays
optional in process, and this call site had none. Every call was a refusal round trip.

**Why it was invisible.** `Executor.execute` reports failure by **returning**
`{ok: false, reason}` and never by throwing (`packages/core/src/ports.ts`), and the loop
discarded the outcome. A refusal is fast, so the defect's symptom is a plausible bound rather
than an error.

**The repair, both halves.** The label is now stated at the call site, and the function
throws if any call did not run — *a bound derived from calls that were refused is not a
bound, and the failure has to be loud because its symptom is a plausible number.*

**The repair measured.** The vector now reads
`110.9, 86.1, 105.6, 110.9, 106.8, 84.0, 97.3, 92.4, 84.1, 87.0, 104.6, 95.8, 91.8, 121.1, 169.4, 108.7` ms
— mean 103.5 ms, against the ~93 ms step in the same rung's own staircase. The two
instruments now agree.

**It cannot regress silently.** `bench-driver.node.test.ts` gains an eleventh requirement
holding both halves. Its comments-only count moved **7 → 8** with the reason written beside
it, because a number that moves without its comment is how a guard becomes decoration — that
file's own thesis about itself.

---

## Criterion 3 — the factorial, reproduced a third time

| attempt | driver | dial | cap | nodes | job |
|---|---|---|---|---|---|
| A8 | in-process | workers dial in | derived | 8 | **completed** |
| A | in-process | workers dial in | derived | 16 | **FAILED** — `EncryptionFailedError: read ECONNRESET` |
| B | in-process | workers dial in | pinned 5 | 16 | **FAILED** — `EncryptionFailedError: read ECONNRESET` |
| C | in-process | submitter dials out | derived | 16 | **completed** |
| D | process-per-node | submitter dials out | derived | 16 | **completed** |
| E | process-per-node | submitter dials out | agents at 5 | 16 | **completed** |
| F | process-per-node | workers dial in | derived | 16 | **FAILED** — `read ECONNRESET` at a child's dial |
| G | process-per-node | workers dial in | pinned 5 | 16 | **FAILED** — `connect ECONNRESET` at a child's dial |

Identical to 23-04's two runs, cell for cell — three independent takes now.

- **dial direction** — `workers-to-submitter` on every failure, `submitter-to-workers` on every success
- **driver** — does not separate them
- **cap placement** — does not separate them

**Attempt G is the positive control and it failed**, so the block has a reproduction rather
than seven successes reported as an answer. The published paragraph blamed
`INBOUND_CONNECTION_THRESHOLD = 5` per host; a default node announces **15**, A fails at 15,
B fails pinned back to 5, and E completes with the agents at 5. **The cap is on both sides of
the split and the dial direction is on neither.**

**Criterion 3 is one rung, not two, and the report says so in its own words**: the
2026-08-01 run's real-transport curve carries a working 8-node rung at `n = 19`,
`incomplete = 0`, and its only excluded row is `real transport, 16 nodes`. The section states
that scope change rather than absorbing it — *a rung that quietly appears between the plan
and the results is as unreadable as one that quietly vanishes*. Staggering is named as a
lever this phase did not exercise, and the agents' inbound connection counts are recorded as
not instrumented.

---

## The frozen artifact

`.planning/BENCHMARK-RESULTS-2026-08-01.md` — the report as committed at `910e3b3`, copied
byte for byte, `cmp` exit **0**.

**Named for the run's own stamp, read out of the file.** The committed report's preamble
reads `Run at 2026-08-01T06:09:01.272Z`, confirmed before the copy was named. The previous
version of this plan named `BENCHMARK-RESULTS-2026-07-27.md` and asserted `573.16×` and
`| 1 | 1.3ms |` against it; **no file in this tree supports that run date and none of those
values is in the committed report.**

**Its values were verified against the committed report, not transcribed from any brief.**
Each `grep -cF` was run against the frozen file directly:

| value | occurrences |
|---|---|
| `7086.14×` | 1 |
| `\| 1 \| 22.4ms \|` | 2 (memory makespan row, connectivity-tax row) |
| `\| 8 \| 69.5ms \|` | 1 |
| `\| 16 \| 44.9ms \|` | 1 |
| `0.0032ms` | 2 |

**No driver writes that path.** `main()`'s two `writeFile` calls name
`.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json` and nothing else, so a later
phase's benchmark run cannot take those figures with it either. `shasum -c` over the frozen
file: **exit 0** before the first run, after each of the three runs, and after the whole-suite
run.

**The second mutation, recorded rather than run.** Freezing *after* the benchmark would leave
the value greps finding the new run's numbers and passing — which is precisely why Task 0 is
ordered first and why the guard asserts the **values** rather than the row shapes. Task 2 was
not run first.

---

## The guard, and the unmet list it was watched producing

`packages/node/src/bench-results.node.test.ts` — 538 lines, eight artifact requirements and a
source-linkage block.

**Against the report as committed before this phase measured anything, six of the eight were
unmet**, verbatim from the failure output:

```
1. every makespan heading names the driver its numbers came from
2. every section carrying a figure names a driver in its heading
3. the 2026-08-01 values survive in the frozen artifact, and this report points at it
5. criterion 1’s process evidence is in the published file, not only in raw.json
6. the speedup section names its ladder, its derived ideal, how that ideal was
   measured, and the three confounds
8. the limits of a one-host run are stated in the words the requirement uses
```

Requirements 4 (a 16-node rung in the memory makespan table) and 7 (three or more
`SAME-MACHINE` labels) passed against the pre-run file, and that is the honest reading: the
2026-08-01 run was also a full ladder and also carried the derived label.

**The section scan found exactly eight non-exempt figure-carrying sections in the pre-run
file** — the two makespan tables, the two reduce trees, the exclusions, the connectivity tax,
the COST crossover and the supplementary decomposition — and **all eight failed**, which is
what the plan predicted. The floor is asserted at eight rather than an equality; the published
file has eleven.

**The third figure form is what makes it worth having.** `## COST crossover` has no table row
and its only bolded text is `**No crossover.**`, which carries no digit — so a scan matching
only tables and bolded digits would have exempted the section carrying the largest number in
the file. The decimal-with-a-unit form catches it, and one of the three planted reports is
exactly that shape.

---

## Every mutation planted, and the exact text observed

Each applied, run and restored **inside one shell invocation**, with `cmp` exit `0` recorded
every time. Never `git stash`, never `git checkout --`.

| plant | result | observed |
|---|---|---|
| the guard run against the pre-run report | **RED, exit 1** | six requirements named, listed above; and the linkage block naming four absent literals |
| `7086.14×` deleted from the frozen fixture | reports **only** requirement 3 | `expect(unmet).toEqual([REQUIREMENTS[2].name])`, with `unmet.length > 0` asserted first |
| a `## Latency` section with a numeric table and no driver | reports **only** requirement 2 | same shape |
| a section whose only figure is `a factor of 91.4×` in plain prose | reports **only** requirement 2 | same shape — the mutation an earlier draft could not have caught |
| **the label dropped from the calibration task** | **RED, exit 1** | `missing: the calibration labels its task and reads whether each call ran` |
| **the `if (!outcome.ok)` check deleted** | **RED, exit 1** | the same requirement, named again — both halves fail it independently |
| the live probe on `calibratePerShard` | **all sixteen refused** | `PROBE shard 0: ok=false REFUSED: … malformed request` ×16 |

**The control that makes the three artifact plants mean anything.** A synthetic report and a
synthetic frozen artifact are asserted to satisfy **all eight** before anything is planted
into them. Without it, a fixture failing a requirement for its own reasons reports the same
name the plant would, and the case passes while measuring the fixture — which is exactly what
23-03 hit and reported.

**One plant is recorded as not attempted, deliberately.** The plan's second Task 0 mutation —
freeze after the run — would corrupt the published artifact to prove a point the ordering
already makes. The reasoning is recorded above instead.

**A plant that could not be built, stated rather than skipped.** `bench-egress`'s
comments-only control has no analogue here: a Markdown report has no comments. The three
plants above are its replacement, and the plan named them for that reason.

---

## Claims in the plan measured FALSE, or deliberately not followed

1. **"the sentence explaining why it exists belongs in the *new* report, which Plan 23-03's
   `## Earlier run — frozen` section writes."** **FALSE — that section did not exist.** No
   occurrence of `Earlier run`, `frozen` or `re-measured` appears anywhere in `packages/`.
   Written here as `frozenRunSection()`, because requirement 3 demands the new report link
   the artifact and state the re-measurement, and nothing wrote either.

2. **"Fix both patterns to whatever strings Plan 23-03 actually put in the `unmet` list."**
   **FALSE — 23-03 put neither there.** The list said *"BENCH-06 (distinct machines) is NOT
   met"*, which is true but is not the sentence the requirement names. An entry carrying
   `cannot detect divergence between machines` and `unmeasured is not met` as literals was
   added, and both are now guarded at the artifact **and** at the source.

3. **`## Supplementary — where the time goes` carried no driver in its heading.** The plan
   counted it among the eight sections that must gain one and no plan in the phase gave it
   one, so requirement 2 would have failed after the run. The heading now names the driver
   and the fixture — *and says the other two readings run no fabric at all*, because two of
   its three bullets have no driver to name and claiming one would be false.

4. **"The process-per-node driver is about HALF the speed of the in-process control."**
   **NOT REPRODUCED.** See the four-run table above. What reproduces is the reframing, not
   the gap.

5. **The report has ten `##` sections.** True of the pre-run file, confirmed by
   `grep -c "^## "` → 10. The published file has **fifteen**.

6. **"`--quick` writes under its own `process.cwd()`."** True and relied on: a `--quick`
   pre-flight run in a `mktemp -d` cwd was used to read the rendered headings before
   committing to a full ladder, and it is what showed `## Supplementary` failing the scan
   before an eleven-minute run could have.

---

## Deviations from plan

### `[Rule 1 — Bug]` the published ideal bound was derived from refused calls

The largest defect this plan found, and it was in a figure this plan publishes. Repaired at
both halves, watched reddening at both, and measured after. Full account above.

### `[Rule 3 — Blocking]` three renderers the plan assumed existed did not

`## Earlier run — frozen`, the BENCH-06 sentence in the `unmet` list, and a driver in the
supplementary heading. All three are required by requirements 2, 3 and 8 of the guard the
plan specifies, and none was present. Added to `bin/bench.ts` — never to the report by hand.

### `[Rule 2 — Missing correctness check]` `bench-driver.node.test.ts` gained a requirement

Outside the plan's declared file list, and taken for the reason 23-04 took the same step: the
repair above lives behind a `main()` that runs on import, no suite executes a rung, and a
calibration that silently reverts to measuring refusals is indistinguishable from one that
works. The count that moved is documented at the assertion.

### `[Deviation — declared]` the benchmark ran three times

Not to get a better number. Run 1 was superseded by a source repair the linkage block
demanded — two sentences assembled across concatenation boundaries; run 2 by the calibration
repair. Each re-run followed the plan's own rule that a prose or source fault *"is wrong in
`bin/bench.ts` and is fixed there and re-run — a report edited by hand is a report whose
generator no longer produces it."* **All three runs' headline figures are published in the
table above**, so no run is hidden and the spread is visible.

### `[Deviation — deliberate]` `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` not touched

BENCH-07 is closed by a verifier, not by its last plan. 23-01 through 23-04 and 23-06 all took
the same position, and this checkout is shared.

---

## Readings, exit codes read directly

Every exit code below was captured with `EXIT=$?` on the line **immediately** after the
command — no pipe, no trailing filter.

| what | exit | timing | `(user+sys)/real` | 1-min load |
|---|---|---|---|---|
| `npx tsc --noEmit` after the guard was written | **0** | — | — | — |
| the guard against the **pre-run** report | **1**, 2 failed / 8 passed | `183ms` | — | — |
| `--quick` pre-flight, `mktemp -d` cwd | **0** | `real 4.87 user 4.13 sys 0.72` | 1.00 | 4.95 |
| full run 1 | **0** | `real 161.30 user 345.77 sys 20.64` | **2.27** | 4.68 → 18.75 |
| full run 2 | **0** | `real 180.15 user 351.65 sys 23.93` | **2.09** | 5.60 → 19.95 |
| **full run 3 — published** | **0** | `real 207.42 user 371.01 sys 22.10` | **1.90** | 13.52 → 33.25 |
| the probe run, one rung, `mktemp -d` cwd | **0** | — | — | — |
| the plan's verify block — `bench-results`, `vocabulary` | **0**, 2 files / 35 tests | `921ms` | — | — |
| six source/artifact guards together | **0**, 6 files / 93 tests | `1.79s` | — | 21.6 |
| `npx tsc --noEmit`, final | **0** | — | — | — |
| **the whole `--project node` suite** | **0**, **160 files / 2269 passed, 2 skipped** | `real 356.33 user 342.41 sys 56.40` | **1.12** | 14.77 → 29.85 |

**The whole-suite reading is the regression control and is compared against a stated
baseline.** The tree was **159 files / 2258 passed / 2 skipped** before this plan; it is
**160 / 2269 / 2** after. That is exactly one added file (`bench-results.node.test.ts`, ten
tests) plus one added planted case in `bench-driver.node.test.ts` — **+1 file, +11 tests, zero
failures, zero foreign failures**.

The **1.12** ratio on the whole suite is not starvation: much of that span is spent watching
spawned agent processes rather than holding a core, and the same file set reads 1.55 in
23-04's table on a differently-loaded host. It is a comparability key, not a verdict.

**`pgrep` after every full run: `agent.ts --dir` → 0, `bin/bench.ts` → 0.** 23-04's two
process-leak repairs hold at the shipped configuration; the driver exits.

**`shasum -c` over `.planning/BENCHMARK-RESULTS-2026-08-01.md`: exit 0** before the first run,
after each of the three, and after the whole-suite run.

---

## The shared-tree hazards, and what was done about each

- **Every commit used explicit paths** (`git commit -F <a file outside the repo> -- <path>`)
  and each was read back with `git show --stat`: three commits, three disjoint file sets,
  only this plan's files in each. `git commit -F -` was not used and **no backtick appears in
  any message**.
- **`O2_SKIP_GUARDS` was NOT used.** The pre-commit guard set passed on all three commits
  (`Test Files 6 passed`, `Tests 234 passed`).
- **`git add` ran only between test runs, never during one**, and this summary was written
  **after** the whole-suite run rather than during it, so `discover-arm.node.test.ts` and
  `bench-attestation.node.test.ts` saw the same `git status --porcelain` on both sides of
  their own runs.
- **Every run of the driver that was not the published one used a `mktemp -d` cwd** — the
  `--quick` pre-flight and the probe run — and each temp directory was removed afterwards.
- **No `git` command that writes was run during Task 0 or Task 2**, as both required.
- **`git status --short` was clean of foreign files throughout.** The foreign load on this
  host is compiler processes outside this repository, not another agent in this tree.

---

## Known Stubs

None. Every figure in the published report is read from the run that published it: the pids
are what each child announced on its own handshake line, the process counts are what each rig
held, the confound vectors are read off `ShardResult`, the excluded rung's reason is built
from the error that was seen, the factorial's separating lever is computed from the outcome
vector, and the ideal bound is now computed from sixteen measurements of calls that ran.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema at a trust boundary. The
one behavioural change to a dispatch path — `label: 'public'` on the calibration task —
narrows what the wire accepts from that call site rather than widening it: the frame was
previously refused outright, and it now carries the same label every other shard this driver
dispatches carries.

## TDD Gate Compliance

Task 1 is `tdd="true"`, and its RED gate is the point of the task rather than a formality: the
guard was written first and **watched failing against the report as committed**, with its
unmet list transcribed above, because *a guard over a published artifact that has only ever
been run against a satisfying artifact has never been shown to read anything*. There is no
knowingly-red `test(...)` commit, for the reason 23-02, 23-03 and 23-04 all recorded — this
branch is shared and a knowingly-red commit on a shared branch is the hazard `CLAUDE.md`
opens with. Gate order in `git log`: `test(23-05)` `290cea6`, then `fix(23-05)` `631459b`,
then `docs(23-05)` `6346ceb`.

## Commits

| Commit | What |
|---|---|
| `290cea6` | `test(23-05)` — a guard that reads the published file, and the sentences it must not lose |
| `631459b` | `fix(23-05)` — the ideal bound was sixteen refused calls, and the instrument never asked |
| `6346ceb` | `docs(23-05)` — the published run, and the 2026-08-01 figures frozen beside it |

## What this plan did NOT establish

- **BENCH-06's distinct-machine half.** Descoped and unmeasured — not met. Said in those
  words in the published report, at the artifact and at the source.
- **A reusable absolute.** Every absolute figure published was taken with a foreign compiler
  holding roughly two of eight cores. The ratios are within-run and survive it; the
  milliseconds do not.
- **That the two drivers differ.** Across three runs on this host the difference between them
  is smaller than the difference between runs. A fourth run on a genuinely idle machine is
  what would settle it, and no such machine was available.
- **That the calibration repair is exercised by anything.** Nothing in any suite runs a rung.
  The eleventh `bench-driver` requirement makes a *deleted* check red; it cannot make a
  *broken* one red. The live probe is what carries the claim, and it was run by hand.

## Self-Check: PASSED

- `.planning/BENCHMARK-RESULTS-2026-08-01.md` — FOUND, 105 lines, `shasum -c` exit 0
- `.planning/BENCHMARK-RESULTS.md` — FOUND, 301 lines, 15 `##` sections
- `.planning/bench/raw.json` — FOUND, regenerated by the published run
- `packages/node/src/bench-results.node.test.ts` — FOUND, 538 lines (min 160)
- `packages/node/src/bin/bench.ts` — FOUND, modified
- `packages/node/src/bench-driver.node.test.ts` — FOUND, modified
- `.planning/BENCHMARK-METHODOLOGY.md` — deliberately **UNCHANGED**; `SATURATING_N` did not move
- commits `290cea6`, `631459b`, `6346ceb` — all FOUND in `git log`
- `npx tsc --noEmit` — exit **0**, whole repository
- `npx vitest run --project node` — exit **0**, 160 files / 2269 passed, 2 skipped
- `pgrep -f "agent.ts --dir"` and `pgrep -f "bin/bench.ts"` — **0** and **0**
