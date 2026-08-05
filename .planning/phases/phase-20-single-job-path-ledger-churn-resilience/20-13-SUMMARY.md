---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 13
subsystem: mutation-ledger, requirements-ledger, roadmap, measured-spans
tags: [WIRE-04, CHURN-01, CHURN-02, CHURN-03, CHURN-04, CHURN-05, CHURN-06, BROW-02, MR-04, MR-07, SCHED-03, VER-03, AOT-02, bookkeeping]
requires:
  - "all twelve Phase 20 summaries — the observed failure text of every plant is their record, and where they recorded none nothing was invented"
  - "packages/node/src/mutation-ledger.ts — Mutation, problemsWith, occurrences (pre-existing)"
  - "packages/node/src/requirements-ledger.node.test.ts — WITHOUT_A_CHECKABLE_CLAIM, the claim floor, the set equality (pre-existing)"
  - "vitest.config.ts — MEASURED_NODE_SPANS retaken WHOLE on 2026-08-05 by commit a23167b (pre-existing, UNCHANGED in every figure)"
provides:
  - "27 mutation-ledger entries, each RE-EXECUTED against the current tree rather than transcribed"
  - "the ledger's omissions and its four greens, written into its own prose with the reason for each"
  - "TITLE_SIGNATURE_COUNT / RENDERED_SIGNATURE_COUNT — derived counts replacing a sentence that expired three times"
  - "the anti-vacuity floor at 112, and the signature floor re-sited on the file's own two-thirds rule"
  - "eight Phase 20 requirement rows that say what is true, where it is measured and what is open"
  - "46 file:line citations converted to grep-able symbols, with the rot measured first"
  - "Phase 20's ROADMAP Research line corrected in place a second time, and its thirteen plans listed"
  - "Phase 19's criterion-5 carry-forward to Phase 24, recorded in Phase 19's own entry"
  - "Phase 21's criterion 2 recorded as open and homeless, with no destination invented"
affects:
  - "20-VERIFICATION — every criterion's evidence is now citable by symbol from the rows and the ledger"
  - "tools/aot/lift.node.test.ts — a load-dependent non-result found and attributed, NOT this plan's file, see Findings"
tech-stack:
  added: []
  patterns:
    - "a plant is re-executed before it is encoded, because twelve plans of edits sit between the observation and the ledger"
    - "a count in prose becomes a derived export, because this file has now watched one expire three times"
    - "a citation is a symbol a reader can grep, never an integer that expires silently"
    - "a floor is ratcheted to the count when its job is to make deletion deliberate, and sited by rule when its job is anti-vacuity"
key-files:
  created:
    - .planning/phases/phase-20-single-job-path-ledger-churn-resilience/20-13-SUMMARY.md
  modified:
    - packages/node/src/mutation-ledger.ts
    - packages/node/src/mutation-guard.node.test.ts
    - packages/node/src/requirements-ledger.node.test.ts
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - vitest.config.ts
decisions:
  - "every one of the 27 entries was re-planted and watched go red before being written down; none was encoded from a summary alone"
  - "no handed-over span was pinned onto vitest.config.ts — the table was retaken WHOLE the same day and blending two runs destroys its only property"
  - "the anti-vacuity floor is ratcheted to the exact count (112), as 19-12 did; the signature floor is sited by the file's own two-thirds rule (74) rather than on the count"
  - "20-12's lowered claims floor is re-sited 3 to 5 against a measured 7, NOT reverted to 10 — nine of the fourteen it was sited against were runResilient sentences WIRE-04 required to delete"
  - "CHURN-01/02/05/06 ticked; CHURN-03 and CHURN-04 left unticked with the leg no entry point reaches named"
  - "the SCHED-06 checkbox prose is left alone: v1.1 box text is the milestone's record of the problem, and the traceability row is where state lives"
metrics:
  duration: ~4h
  completed: 2026-08-05
---

# Phase 20 Plan 13: The ledger, the rows, and the roadmap line that was wrong Summary

Twenty-seven plants this phase watched go red are now ledger entries a guard re-checks
every run, and every one of them was **re-planted on 2026-08-05 rather than transcribed**;
eight requirement rows stopped describing a tree that has not existed since 20-01; and the
roadmap line this phase was convened knowing to be false is corrected in place, along with
two carry-forwards that lived only in the documents they were carried *to*.

**This closes Phase 20's plans.** No verification file is written here.

---

## What landed in each of the four files

### `packages/node/src/mutation-ledger.ts` — +794 lines

**27 new entries, in six blocks**, each named for what it guards rather than for the plan
that produced it:

| block | count | what it pins | plants from |
|---|---|---|---|
| `L1`–`L5` | 5 | the peer start-outcome ledger, both bounds the demo's deferral rested on, and the wire answer | 20-02 |
| `R1` | 1 | the late-arrival discard in `rpc.ts` — criterion 6's whole mechanism | 20-03 |
| `D1`–`D3` | 3 | duplication happens at all; the loser is still read; a sovereign duplicate stays inside its owner | 20-07 |
| `X1`, `X2` | 2 | the two published cost columns are read off the job, not written down | 20-09 |
| `O1`–`O7` | 7 | the per-owner gate, the named union, the display site, and the owner set's derivation | 20-08, 20-10 |
| `K1`–`K7` | 7 | the resume, the recovery arm, the chain, the job-id check, the missing block, the named failure | 20-11 |
| `J1`, `J2` | 2 | the `MIN_SAMPLES` floor through `submitJob`, and WIRE-04 at the barrel | 20-12 |

**Counts, as the plan's proof asked for them:**

- **entries encoded: 27**
- **entries re-executed: 27** — all of them, on 2026-08-05, each applied, run against its own
  `caughtBy` files, restored, and the restore compared byte-for-byte with the comparison read.
  Every one went red and every one produced the recorded signature **in the run's own
  output**, checked programmatically rather than by eye.
- **plants deliberately omitted: 11**, in four groups, each named in the ledger's own prose
  with its reason (below).
- **greens recorded: 4**, in the ledger's prose, because a plant that could not fail is the
  more informative result.

The ledger now holds **112 entries — 83 `test-title`, 29 `rendered-at-runtime`.**

**Three corrections to entries that had stopped describing the tree:**

- **`M5`** cited *"the reading `runResilient` retries on"*. 20-12 reported it rather than
  editing a file it did not own. Rewritten: the classification survives its consumer and is
  narrower than it was — `remoteDispatch` is the only thing that reads `DispatchOutcome.kind`
  and now has no production caller, because `Executor.execute` flattens every failure by
  design, so the one job path counts *distinct nodes that failed* instead. The liveness cost
  (a trapping module burns up to three nodes) is stated at the entry.
- **`M18` and `M64`** were re-targeted by 20-12 and **were verified rather than assumed** —
  `find`, `caughtBy` and signature all still describe the tree, confirmed by the guard and
  by the whole-project run.
- **`E1`** held stale numbers, and re-planting it found that one of them was **never
  observable**. See *Claims measured false*.

### `.planning/REQUIREMENTS.md`

Eight Phase 20 rows rewritten, three more corrected, **46 citations converted**, and the
header arithmetic moved with them (45 of 72 checked, 27 unchecked as 1 + 25 + 1).

| row | before | after |
|---|---|---|
| `CHURN-01` | Built, not wired | **Done**, ticked — 30 % killed across ten spawned processes, byte-identical to a control on the same fabric |
| `CHURN-02` | Built, not wired | **Done**, ticked — a frozen worker's shard duplicated across seven spawned processes, one fabric, two arms |
| `CHURN-03` | Built, not wired | **Partial** — measured across processes; **no production submitter supplies `SubmitOptions.checkpoints`** |
| `CHURN-04` | Built, not wired | **Partial** — the lease and the bound are on every path; renewal needs `admit`, which only `bin/bench.ts --discover` supplies |
| `CHURN-05` | Built, not wired | **Done**, ticked — `covered: 2/3` naming the stopped owner against a `3/3` control |
| `CHURN-06` | Built, not wired | **Done**, ticked — both arms in one job: an owner with a spare node and an owner with none |
| `BROW-02` | Partial (20-06 owing a reading) | **Partial** — what 20-02 measured, separated from what 20-06 did not deliver, plus the row-count number |
| `WIRE-04` | **Not started** | **Done**, ticked — and the finding stated: nothing held it for thirteen phases |
| `MR-04`, `MR-07` | Partial | **Partial** — *arriving late* closed, the demo's linear scan kept open for Phase 22 |
| `SCHED-03` | said the exec-stage re-pick lives only in `runResilient` | corrected, third time in the same under-reporting direction |
| `VER-03` | three false sentences, one contradicting `M40` | corrected; rule 2's across-process reading is closed |
| `AOT-02` | *"never been compared across two genuinely different inputs end to end"* | corrected; 21-04 did exactly that |

`CHURN-05`'s row was *"submitJob … does not speculate or re-dispatch"* — false since 20-01
and 20-07, as the brief said. All six CHURN rows carried that same sentence.

### `.planning/ROADMAP.md`

- **Phase 20's `Research:` line corrected in place, a second time**, and the correction names
  four separate things rather than one: renewal *was* built (20-01 is the first production
  caller of `LeaseTable.renew`, `shouldRenew` and `RENEW_AT`); a clause left ungrammatical by
  the 2026-08-04 edit is retired rather than repaired; *"`ledger` … is supplied by no node in
  production"* became false in 20-02; and `runResilient` no longer exists, so every sentence
  naming it is now history.
- **`Plans: TBD` replaced by the thirteen plans**, each with a one-line objective and 20-06's
  non-delivery stated on its own line rather than left to a verifier to discover.
- **Phase 19's carry-forward recorded in Phase 19's own entry.** `Phase 24` appeared nowhere
  in that section; Phase 24's entry carried the whole ruling and Phase 19's carried none of
  it, so a reader scoring Phase 19 from its own entry found an open criterion with no home.
  Written the way Phase 18's entry names Phase 20 criterion 1, with the arithmetic (~3.0 and
  ~1397) and the explicit note that this is a carry-forward and not a closure.
- **Phase 21's criterion 2 recorded as open and needing an owner ruling.** Phases 22, 23 and
  24 were read; none contains a goal, criterion or requirement touching image resolution,
  `RepoDigests` or AOT-02, so **no destination was invented**. The two routes an owner can
  choose between are stated, and descoping is named as not being a third.

### `vitest.config.ts` — **no figure moved**

The table was retaken **whole** on 2026-08-05 (`a23167b`) and every file the earlier plans
handed a span for was measured in that run. Pinning the handed-over values on would blend two
runs, which is exactly what step 2 of the file's own procedure forbids. So the hand-overs are
**discharged and recorded** rather than applied, in a new docblock section, with both readings
side by side so nobody goes looking for a missing row:

| file | handed over | the retaken table |
|---|---|---|
| `late-combine.node.test.ts` (20-03) | 7 740 ms test time, 8 490 ms wall, solo | 15 467 |
| `speculation-agents.node.test.ts` (20-09) | 13 040 ms solo `real` | 12 310 |
| `coverage-agents.node.test.ts` (20-10) | 13 820 ms solo | 28 173 |
| `checkpoint-agents.node.test.ts` (20-11) | 10 400 ms test time, 25 130 ms solo `real` | 6 392 |

**The disagreements run in both directions** — `coverage-agents` doubled, `checkpoint-agents`
more than halved — which is itself the argument: solo readings on quiet hosts against 150
files in parallel at a peak load of 109, and two of the four hand-overs are *test time*
rather than a file span, a third instrument again. 20-06 handed over nothing and says so.

**The diff is comment-only, proved rather than asserted**: every added line in
`git diff -- vitest.config.ts` begins with ` *`. `SLOW_CUTOFF_MS`, the `SLOW_NODE_SPECS`
derivation, `UNIT_ONLY`, `PERF_GATE`, all four `projects` blocks and `coverage` are
byte-identical.

---

## The anti-vacuity floor — raised to 112

`MUTATIONS.length >= 67` became **`>= 112`**, ratcheted to the exact count as 19-12 did,
because that floor's job is to make deleting an entry an edit to that line rather than a
silent subtraction.

**The slack it closes is forty-five entries.** Phase 20 added entries in five plans and the
floor sat at 67 throughout, so by the time it moved the ledger held 112 and forty-five could
have gone quietly. 20-01 reported the staleness in its summary rather than editing a file it
did not own — correct behaviour, and also the reason the gap grew: a floor nobody owns is a
floor nobody ratchets. That is written into the docblock.

**The signature floor moved differently, and deliberately so.** `>= 45` became **`>= 74`**,
which is the docblock's own stated rule — *"two thirds of the way up the ledger"* — applied
literally to 112, against a measured 83. It is **not** ratcheted to 83: its job is
anti-vacuity, and a floor sitting exactly on the count fails for arithmetic rather than for
the property it guards. The case now also asserts that the two derived constants agree with
the array they are derived from, so the derivation cannot rot into a second transcription.

**Seven ids joined the named `rendered-at-runtime` set** (`L1`–`L5`, `R1`, `K7`) with the
justification that case demands, written per pair rather than as one reason restated:
`L1`/`L2` because their signatures are *opposite inversions of the same case title*, which a
title could not tell apart; `L3`/`L4`/`L5` because each names the specific row that crossed
and the alternatives are width-truncated list diffs; `R1`/`K7` on `M40`'s logic, being caught
by files whose one or two `it`s drive spawned processes with dozens of assertions apiece.

---

## The `claims` floor — 20-12's weakest change, decided

20-12 lowered it from `> 10` to `> 3` and **named it as its weakest change and the line to
revert**. My decision: **re-sited to `> 5` against a measured 7, not reverted to 10**, and the
reason is a finding rather than a convenience.

A revert to 10 **is not available**. Nine of the fourteen claims that floor was sited against
were the sentence *"`runResilient` has no caller"* repeated across seven rows, and WIRE-04's
entire content is that `runResilient` must stop existing. The population did not drift; it was
deliberately reduced by a requirement. A floor of 10 would now assert that the ledger still
contains nine sentences the milestone was written to delete.

Measured after the rewrite: **7**. `CHURN-03` contributes two — *`checkpointChain` and
`remainingWork` have no production caller*, which is the honest shape of what is still unwired
about checkpointing, and which the guard re-derives from the corpus rather than taking on
trust. `> 5` recovers two thirds of the drop and leaves two claims of headroom.

**`WITHOUT_A_CHECKABLE_CLAIM`: five of 20-12's seven ids removed, two kept.** `CHURN-01/02/05/06`
leave by leaving the population (their verdicts are `Done`); `CHURN-03` leaves by acquiring a
readable claim, which is the direction the list's own rule was written for. `CHURN-04` and
`SCHED-03` stay, with their reasons rewritten rather than inherited: `CHURN-04`'s open leg is
an **argument value** (`SCHED-05`'s bucket), `SCHED-03`'s is a **tier** (`AUTH-02`'s bucket).

---

## The citation rot — measured, then converted

**Measured before touching anything: 41 of the 46 `file:line` citations landed on a blank
line, a closing brace, a `*/`, or prose inside a comment.** The five that were still right
were right by accident of which files nobody had edited. Offsets ran 51, 138 and 226 lines in
three different directions, so no single correction could have been applied across the file.

Examples, since the shape matters: `fabric-node.ts:1284` was cited for `new EgressGuard(` and
pointed at `? new MemoryBlockstore()`; `fabric-node.ts:1178` was cited for `new LocalCapacity`
and pointed at `get issuerKey()`; `bin/bench.ts:455` was cited for the sovereign-leg decision,
which is 148 lines further down.

**Every underlying claim was re-derived by symbol during the conversion and every one held.**
The rot was documentary throughout — which is precisely what let it survive two previous
re-measurement passes, one of which was a line-by-line correction of twenty-three coordinates.

**All 46 are now grep-able symbols or quoted strings**, and **64 anchors were verified against
the tree** by script after the conversion — every `search X` target, every named symbol, every
file path and every mutation-ledger id the rows now cite. Zero missing. The header paragraph
that described this defect now records that it was converted rather than re-measured a fourth
time, and states that there are no coordinates left for the guard to be silent about.

---

## Every plant, and what it produced

All twenty-seven were re-executed on 2026-08-05. Each was applied, run and restored **inside a
single Node invocation**, with `readFileSync` equality against the snapshot read after every
restore — reported as `[restore clean]` on all twenty-seven. Never `git checkout --`, never
`git stash`, never `git clean`.

| id | file | observed on the re-run |
|---|---|---|
| `L1` | `fabric-node.ts` | 2 failed — `expected +0 to be 1 // Object.is equality` |
| `L2` | `fabric-node.ts` | 1 failed of 11 — `expected 1 to be +0 // Object.is equality` |
| `L3` | `net/agent.ts` | 7 failed — `expected [ 'chromium 141' ] to include 'firefox 130'` |
| `L4` | `net/protocol.ts` | 2 failed — `expected [ 'safari 18', 'firefox 130', …(1) ] to not include 'safari 18'` |
| `L5` | `core/start-outcome.ts` | 3 failed — `expected { kind: 'report', …(2) } to deeply equal { kind: 'report', outcome: null, …(1) }`, signature present |
| `R1` | `net/rpc.ts` | 2 failed — `expected [ 'Error: late reply' ] to deeply equal []` |
| `D1` | `job/submit.ts` | 8 failed, 89 passed |
| `D2` | `job/submit.ts` | 5 failed, 92 passed — `expected [] to strictly equal [ { nodeIds: [ 'n01' ], …(1) } ]` |
| `D3` | `job/submit.ts` | 1 failed, 96 passed — `expected true to be false` at `expect(carols.speculated)` |
| `X1` | `bin/bench.ts` | 1 failed, 5 passed — `expected [ Array(1) ] to deeply equal []` |
| `X2` | `bin/bench.ts` | 1 failed, 5 passed — same, naming the other requirement |
| `O1` | `job/submit.ts` | 3 failed across **two** files — `expected [] to strictly equal [ 'alice' ]`, and `expected 2 to be 1` across processes |
| `O2` | `job/submit.ts` | 1 failed — `expected { covered: +0, total: +0, …(3) } to be 'defines-no-owners'` |
| `O3` | `job/submit.ts` | 8 failed, 89 passed |
| `O4` | `job/submit.ts` | 4 failed, 93 passed — `expected [] to strictly equal [ 'carol' ]` |
| `O5` | `job/submit.ts` | 1 failed, 96 passed — `expected 1 to be +0` |
| `O6` | `job/submit.ts` | 1 failed, 1 passed — the thrown sentinel Error, verbatim |
| `O7` | `bin/bench.ts` | 1 failed — `not to match /covered: \d+\/\d+ owners/`, with the PARTIAL line on every rung |
| `K1` | `job/submit.ts` | 6 failed across **two** files — `expected [ +0, 1, 2, 3, 4, 5, 6, 7 ] to deeply equal [ 4, 5, 6, 7 ]` |
| `K2` | `job/submit.ts` | 1 failed, 96 passed — `expected false to be true` |
| `K3` | `job/submit.ts` | 6 failed, 91 passed |
| `K4` | `job/submit.ts` | 1 failed, 96 passed — `expected true to be false` |
| `K5` | `job/submit.ts` | 1 failed, 96 passed — `expected [] to deeply equal [ +0 ]` |
| `K6` | `job/submit.ts` | 8 failed, 89 passed |
| `K7` | `job/submit.ts` | 1 failed — `expected 'block-missing' to be 'malformed'` |
| `J1` | `core/speculation.ts` | 2 files failed, 1 case each — `expected 1 to be +0` |
| `J2` | `core/index.ts` | 1 failed, 96 passed — `+ "runResilient"` in the printed diff |

### Two plants had to be reconstructed, and both are recorded as reconstructions

- **`O7`.** 20-10's replacement called `coverageOf`, which `bin/bench.ts` does not import — the
  plant threw `ReferenceError: coverageOf is not defined` and the case reddened on the wrong
  thing. Rewritten to render an inline `CoverageReport` with the same five fields, which
  reproduces the observed sentence exactly and is the same defect (*a display site that did not
  handle the arm*). Re-executed red.
- **`K2`.** 20-11 described the mutation prose-only (*"`recoverCheckpoint(...)` → `readCheckpoint(handles[0], …)`
  only"*); the encoded form is written against the real signatures. Re-executed red, producing
  20-11's recorded `expected false to be true`.

### The guard can fail — proved, not assumed

`K1`'s `find` corrupted by one character (`carried` → `carrieD`). Observed:

```
× K1 — packages/core/src/job/submit.ts
"K1: packages/core/src/job/submit.ts no longer contains its find text — this mutation has
 stopped applying, and a mutation that cannot be planted guards nothing.
 Was: \"  const carrieD = resumed.carried\""
Tests  2 failed | 141 passed (143)
```

Restored by `cp`, `cmp` exit **0**.

### The rows can fail — proved, not assumed

`CHURN-03`'s claim changed from *`checkpointChain` and `remainingWork`* to *`checkpointChain`
and `submitJob`*. Observed:

```
× has no row naming a symbol that has since acquired a production caller
"CHURN-03: submitJob is called by packages/core/src/executor/task-worker.ts,
 packages/net/src/submit-with-egress.ts"
Tests  1 failed | 19 passed (20)
```

Restored by `cp`, `cmp` exit **0**.

---

## Plants deliberately NOT encoded — eleven, in four groups

**This is the Phase 19 treatment applied, and it is the largest such group this ledger has
carried.** All of it is written into the ledger's own prose, not only here.

1. **20-04, 20-05 and 20-06 contributed nothing.** Each was required to record the observed
   failure text of its plants and none did; all three say so in their own summaries, against
   their own interest. This includes **the entry `M19`'s replacement note asks for by name** —
   `peers: () => running.transport.peers` replaced by `peers: () => []` in `demo/main.ts`'s
   `startReport`, `caughtBy` the three-engine `peer-ledger.e2e.test.ts`. The note is **left
   standing rather than quietly satisfied**, because an entry invented from a plan's intent
   satisfies `problemsWith` perfectly and proves nothing.
2. **20-07's budget plant — omitted for a structural reason.** Its recorded red (fifteen
   duplicates against an allowance of two) required *two* sites mutated together, 27 lines
   apart. `Mutation` encodes one site, neither half alone was measured, and 20-07 records that
   `SpeculationLedger.request` refuses to increment past the allowance even when its answer is
   ignored — so a single-site form is if anything likely to stay green.
3. **20-11's plants 7 and 8.** Both recorded a red *count* and named the cases; neither
   recorded a signature string. A count is not a signature.
4. **Plants on a spec's own fixture** — 20-03's A/C/D/E/F, 20-09's A/B/C, 20-10's 1/1b/2/5,
   20-11's B/C1/C2 and 20-02's plant 3 (a `tsc` reading, which `Mutation.project` admits no
   entry for). `S1`–`S4` are this ledger's only test-file entries and each rewrites one import;
   that is a narrow exception, not a precedent.

## The greens — four, recorded as results

1. **20-02's plant 7.** The magnitude case probed at `MAX_REPORTED_COUNT + 1`, so raising the
   constant raised the probe and the case stayed green — it could see the check *deleted* and
   never the ceiling *moved*, in the very plan that spent a deferral conditional on that
   ceiling. Re-anchored on an absolute with the relational assertion placed **last**; `L4` is
   the entry that can now fail.
2. **20-09's plant E, and it is still open.** `submit-with-egress.ts` rebuilt to drop
   `speculationMultiplier`: `tsc --noEmit` exit **0**, no test in the tree failed,
   `bin/bench.ts --quick` exit **0**, and the only thing that moved was the `spec. tax` column
   turning into an em dash on every rung. **The wrapper's pass-through is guarded by a printed
   table and by nothing executable.**
3. **20-10's plant 2.** The drop-poll deleted with the owner's process still stopped: green,
   identical `covered: 2/3`. The poll is a precondition, not the instrument.
4. **20-11's plant C2.** Green against the process file, red against the kernel — the process
   fixture runs the identity module, so a shard's result CID *equals* its input CID and the
   corruption is invisible there.

---

## Claims measured FALSE

1. **`E1`'s `why` claimed a figure that was never observable.** It said the plant *"collapses
   the measured verification tax from 56–146× to about 1"*. Re-planted 2026-08-05: **the tax is
   never computed under that plant.** The case reddens at its own positive control — the
   short-proof arm, which must be refused for `bad-proof-of-possession`, is refused by the
   hoisted budget instead — and returns before `pairedRatio` is called. Withdrawn rather than
   restated. Also: `56–146×` was the **superseded summing estimator's** spread; the
   fastest-of-36 estimator in force reads 102.8×, 114.0×, 106.9×. And *"from 3.0 to 0.02"*
   understated the collapse in one direction and over-precised the clean value in the other:
   the clean exchange rate is a band of **2.96–3.16** across nine readings, and the planted
   value read **0.011853416149359378** today against **0.003615248196637649** on 2026-08-04 —
   two orders of magnitude below a floor of 1.5 on both runs, which is what the entry claims.
2. **The plan's Task 2 asked for `SCHED-06`'s row. There is no `SCHED-06` row.** SCHED-06 is a
   v1.1 id with a checkbox and no traceability row; the sentence the plan describes —
   *the exec-stage re-pick is unmeasured on every production path* — lives in **`SCHED-03`**,
   which is exactly the row 20-12 handed over and which the plan's own frontmatter omits. The
   handover was right and the plan was wrong; SCHED-03 is corrected.
3. **The plan's Task 2 asked that `CHURN-03`'s row say no success criterion names it and that
   its scoring is an open owner question. That stopped being true before this plan ran.** The
   owner added **criterion 7** to Phase 20 on 2026-08-04 for exactly this reason. Writing the
   stale sentence would have re-opened a closed ruling, so the row records the closure instead.
4. **`VER-03`'s row contradicted the `M40` entry it cites in the same breath**, and the ledger
   was the correct one. Three sentences were false: that rule 2 has no across-process reading;
   that 19-08's executors are in-process `FabricNode`s; and that `bin/agent.ts` passes a listen
   list unconditionally. 19-19 changed all three on 2026-08-04.
5. **`AOT-02`'s row said the emitted CID had never been compared across two genuinely different
   inputs end to end.** 21-04 did exactly that, and 21-VERIFICATION scored that clause MET. The
   row's *checkable* claim (`describeKey` reachable only through `describeLift`) was re-derived
   by symbol and still holds.

---

## Findings, recorded not fixed

**`tools/aot/lift.node.test.ts` produces a load-dependent non-result, and its own absorber
cannot absorb it.** Attributed by measurement, not by plausibility, because the first thing
that came to mind was wrong twice:

| reading | load (1/5/15 min) | result |
|---|---|---|
| `--project node`, 03:07 | 7.37 / 13.92 / 19.39 | **4 failed** — four cases, each `docker image inspect did not answer within 20000 ms` |
| the file alone, 03:13 | ~11 / ~16 | **1 failed**, same mechanism, `(user+sys)/real` = **0.013** |
| the one failing case, ×3, 03:18 | 5.24 / 7.09 / 12.97 | **exit 0** each time, `real 1.84 / 1.49 / 1.49` |
| `--project node`, 03:18 | 4.53 / 6.81 / 12.73 | **exit 0**, 150 files, 2158 passed |

*"Passes in isolation"* was **false at the file level** and only true at the case level, which
is the trap `CLAUDE.md` records. The cases stub `docker` with a shell script, so the 20 s is a
process spawn that did not complete while the same file's real elfconv container lifts were in
flight. `despiteAFullProcessTable` exists to absorb exactly this, and by its own arithmetic it
cannot: a first attempt costing 20 006 ms inside a 30 000 ms envelope leaves no room for a
second, so it reports *"this case never ran"* rather than retrying. **Not this plan's file** —
`20-CONTEXT.md` assigns `tools/aot` to Phase 21 — and nothing either commit touched reaches it:
the `vitest.config.ts` diff is comment-only, proved line by line.

**Two guard metrics are looser than they read, and both were noticed rather than exploited.**
`requirements-ledger.node.test.ts` counts *rows marked Built, not wired* by substring, so a row
that **quotes** the phrase while carrying a different verdict inflates it — `VER-03`, `NET-06`
and `SCHED-05` already did, and the six rewritten CHURN rows now do too, because each records
what it used to say. The verdict count is 1 (`MR-02`); the substring count is 7. Separately,
`MARKER_SPLIT` forces the sentence *"1 are \*Built, not wired\*"*, which is ungrammatical and is
left that way with a note, because the sentence is parsed back out of itself.

**The ROADMAP `Progress` table is stale across the board** and was left alone. Phases 14–22 all
read `Not started` or `0/TBD` while several are complete; correcting one row would make it the
only accurate row among nine. `roadmap.update-plan-progress` was **not** run: the brief
prohibits `gsd-sdk query state.*` after `state.advance-plan` corrupted `STATE.md`, and a
writer mangling a 1 300-line hand-maintained document is a worse outcome than a stale table
that is stale in a visible, uniform way. **This is a hand-over, not a fix.**

**`STATE.md` was not touched**, per the same instruction.

---

## Whole-tree readings, taken after the last commit

Host: 8 cores, other agents idle. `/usr/bin/time -p` on each, exit read on the line
immediately after the command with no pipe.

| run | exit | files / tests | real | user | sys | (user+sys)/real |
|---|---|---|---|---|---|---|
| `npx tsc --noEmit` | **0** | — | 0.94 | 1.98 | 0.34 | 2.47 |
| `--project node` | **0** | 150 / 2158 passed, 2 skipped | 288.88 | 322.77 | 45.69 | **1.276** |
| `--project browser` | **0** | 243 / 3930 | 37.24 | 91.88 | 19.77 | 3.00 |
| `--project e2e` | **0** | 15 / 72 | 178.79 | 95.81 | 20.84 | 0.652 |
| `O2_PERF=1 --project perf` | **0** | 1 / 2, nine readings all within budget | 2.42 | 2.28 | 0.97 | 1.343 |

The node project's 1.276 sits beside the previous pass's 1.23 on the same host; e2e's 0.652 is
a process waiting on browsers and relays, which is what a healthy run looks like there. Node
test count moved 2133 → 2160, which is exactly the 27 per-entry mutation-guard cases this plan
added.

---

## The criteria — what I believe is met, and what is not

**This is my reading, not a verification.** No `20-VERIFICATION.md` is written here.

| # | criterion | my reading |
|---|---|---|
| 1 | `submitJob` is the only job entry point, performing renewal, speculation and coverage internally | **MET, with one question for the verifier.** `runResilient` and `coordinator.ts` are deleted, the barrel offers one runner and `J2` guards it. All three mechanisms are inside `submitJob`. The question: **lease renewal is reachable only where `JobSpec.admit` is supplied**, and the sole production supplier is `bin/bench.ts --discover`, off by default. The criterion says *"it performs lease renewal … internally"*, which it does — whether a default path must exercise it is a scoring call I should not make |
| 2 | 30 % killed mid-job still produces the correct result, re-dispatches visible | **MET.** Ten spawned processes, per-shard results byte-identical to a control on the same fabric, `redispatches` published as `churn/task` and pinned by `X2` |
| 3 | a straggler duplicated live, first result wins, cost accounting includes the multiplier | **MET.** Seven spawned processes, one fabric, on/off arms; `spec. tax` reads the job and `X1` pins it |
| 4 | a cross-owner job with owners offline returns `covered: X/Y` | **MET.** `covered: 2/3` naming the stopped owner against a `3/3` control, plus the driver rendering it and `O7` pinning the display site |
| 5 | the demo's peer ledger across two or more tabs shows merged counts from every peer | **NOT ESTABLISHED.** The wire half landed (20-02) and is measured in-process; `peer-ledger.e2e.test.ts` exists and `--project e2e` is green at 15/72. But **20-06 recorded no plant, no observed text, no span and no exit code**, and its own summary says its claims cannot be established from its evidence. A green nobody has shown can go red is the thing this project refuses to count. **This is the criterion a verifier should look at first** |
| 6 | a late combine result from a recovered node is received and discarded harmlessly | **MET.** Real SIGSTOP/SIGCONT across spawned processes, and `R1` is the plant that makes it a reading rather than a silence — it reddens only if the frame actually arrived |
| 7 | a checkpoint written during a live run, and a second requestor given only the CID finishes the outstanding shards | **MET as a reading, with a wiring caveat.** Measured across real processes against an uninterrupted control per shard. The caveat is `CHURN-03`'s: **no production submitter supplies `SubmitOptions.checkpoints`**, so the sink in that reading is the test's, not a runnable entry point's. `tsc --noEmit` exits 0 with every production submitter omitting it — measured, not predicted |

**Also carried and now closed:** Phase 18 criterion 2b's re-pick (the tripwire inverted, 20-04)
and Phase 16 criterion 3's *arriving late* clause (criterion 6 above), with `MR-04`/`MR-07`
keeping their Phase 22 half open.

---

## Commits

| hash | what |
|---|---|
| `3fd5607` | `test(20-13)`: 27 entries re-executed rather than transcribed; `M5` and `E1` corrected; floors at 112 and 74; counts derived |
| `d27c9f9` | `docs(20-13)`: eight rows rewritten, 46 citations converted, claims floor re-sited, ROADMAP's three corrections, spans recorded not pinned |

Both committed with **explicit paths** and verified with `git show --stat`: `3fd5607` carries
two files, `d27c9f9` carries four, and nothing else. Never a bare `git commit`, never
`git commit -F -`. The pre-commit guard refused the first attempt at `3fd5607` for two uses of
a banned word in new prose, which is the guard working; both were reworded and the commit
re-taken.

## Self-Check: PASSED

- `.planning/phases/…/20-13-SUMMARY.md` — created
- `3fd5607`, `d27c9f9` — both FOUND in `git log`
- `packages/node/src/mutation-ledger.ts` — 112 entries, 83 `test-title`, 29 `rendered-at-runtime`, counted from the array
- 27 new entries — every one re-executed RED with its signature present in the run's output
- 64 symbol citations in `.planning/REQUIREMENTS.md` — all verified present in the tree, 0 missing
- 0 `file:line` citations remain in `.planning/REQUIREMENTS.md`
- both plants restored by `cp` + `cmp`, `cmp` exit 0 observed each time
- `git status --short` — clean
- `npx tsc --noEmit` — exit **0**
- `npx vitest run --project node` — exit **0**, 150 files, 2158 passed, 2 skipped
- `--project browser` exit **0**, `--project e2e` exit **0**, `O2_PERF=1 --project perf` exit **0**
