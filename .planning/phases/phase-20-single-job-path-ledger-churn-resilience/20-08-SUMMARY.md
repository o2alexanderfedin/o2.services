---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 08
subsystem: job-submission, coverage, owner-accounting
tags: [CHURN-05, WIRE-04, coverage, named-union, per-owner-gate]
requires:
  - "packages/core/src/coverage.ts — coverageOf / describeCoverage / CoverageReport (pre-existing, UNCHANGED)"
  - "packages/core/src/coordinator.ts — the owedByOwner/doneByOwner argument, READ and reproduced, never imported (pre-existing, UNCHANGED)"
  - "packages/core/src/job/verify.ts — executeVerified's three arms, the definition of 'landed' (pre-existing, UNCHANGED)"
  - "packages/core/src/job/submit.ts — 20-01's generation loop and 20-07's speculation and ShardResult.disagreed (extended here)"
provides:
  - "JobResult.coverage — the first production caller of coverageOf anywhere in the tree"
  - "JobCoverage — the named union CoverageReport | 'defines-no-owners'"
  - "landedForItsOwner — the landing predicate, with the degraded axis decided in writing"
  - "the owed-against-done per-owner gate on the one job path"
affects:
  - "20-10 — the live cross-owner reading and the CLI's `covered: X/Y` line consume JobResult.coverage; renderCoverage in submit.test.ts is the shape a display site has to take"
  - "20-12 — the list of coordinator.test.ts CHURN-05 cases now covered here is below, and all three re-target cleanly"
  - "every submitJob caller — JobResult gained a required field; one construction site in the tree, listed below"
tech-stack:
  added: []
  patterns:
    - "a named sentinel arm so a job that was never asked a question does not answer it with an apology"
    - "the per-owner gate lives in the caller, because coverageOf's own signature has already lost the count it would need"
    - "a landing predicate as a named function, so the axis it does NOT read is documented at one site"
    - "a render helper in the test that is the shape of every display site, so the union is exercised rather than only present"
key-files:
  created: []
  modified:
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/net/src/reduce-job.test.ts
decisions:
  - "no new JobSpec field — the owner set is derived from the job's own sovereign shards"
  - "an owner contributes only when done >= owed; one of four is not a contribution"
  - "a named union, not a bare CoverageReport — 0/0 owners PARTIAL on every public job is what the bare shape produces"
  - "degraded does NOT disqualify an owner: the data landed, the verification is what is weaker"
  - "a late disagreement DOES disqualify — 20-07's rule carried one level out; this clause is beyond the plan and carries its own case"
  - "coverage and complete stay separate fields, though one implication between them holds by construction and is recorded"
  - "the barrel was not edited — JobCoverage is exported from submit.ts only, following 20-07's precedent"
metrics:
  duration: ~1h25m
  completed: 2026-08-05
---

# Phase 20 Plan 08: The aggregate carries its denominator Summary

`coverageOf`, `describeCoverage` and `withCoverage` had **zero** production callers. They
have one now. Every job reports how many of its owners contributed, beside its result
rather than instead of it, counting an owner only when **all** of that owner's shards
landed, naming an absent owner by id — and a job with no sovereign shard says
`'defines-no-owners'` by name instead of rendering `covered: 0/0 owners — PARTIAL`.

---

## What landed

### `packages/core/src/job/submit.ts`

**`JobResult.coverage: JobCoverage`**, where `JobCoverage = CoverageReport |
'defines-no-owners'`. The union is not decoration and the measurement is below: with a bare
report, a public job renders `covered: 0/0 owners — PARTIAL (no owners were expected)` —
observed verbatim, not predicted.

**The gate is owed-against-done, per owner, and it lives in the caller.** Two maps built
from the job's own shards: `owedByOwner` counts one per sovereign shard naming an owner,
`doneByOwner` one per such shard that landed, and an owner reaches `coverageOf`'s
`contributed` list only when `done >= owed`. `coordinator.ts`'s argument for that rule is
reproduced at the site and attributed, because 20-12 deletes that module and the sentence
is the clearest statement of the rule anywhere in the tree. The module is **not** imported.

**`landedForItsOwner` is a named function rather than an inline predicate**, so the axes it
reads and the axis it deliberately does not are documented in one place:

- **`agreed`**, and **no late disagreement** (`ShardResult.disagreed`). The second clause is
  **beyond what the plan asked for** — the plan's `<interfaces>` names only
  `verification.status`, which predates the field 20-07 added — and it is 20-07's own rule
  carried one level out: a shard whose losing copy hashed differently is a failed run, not
  a run with a footnote, so its owner's bytes are not in an aggregate anybody should read.
  It has its own case and its own plant; both are below.
- **`degraded` does NOT disqualify.** Decided in writing at the site, because an unstated
  answer here reads as an oversight. A shard that agreed at one replica of two *did* read
  its owner's data; what is weaker is the **verification**, a different question with a
  different remedy, already reported by three other fields. Folding it in would make `2/3`
  ambiguous between *an owner is absent* and *an owner's shard got half the redundancy it
  asked for*, which is the same collapse of two questions into one number that
  `coverage.ts` exists to prevent, running the other way. It would also contradict
  `PROJECT.md`'s split — sovereign data is *owner-attested* rather than redundantly
  executed — by demanding a guarantee the project does not claim, on exactly the shards
  coverage is computed over.

**No new `JobSpec` field**, as ruled. The expected set is `[...owedByOwner.keys()]`.

**The derivation's cost, measured and written into the module header rather than found
later.** It ties one direction of the coverage/completeness pair: an owner is expected only
by having a shard, and that shard sits inside `complete`'s conjunction, so **`complete`
implies fully covered**. The converse fails, which is why the pair still carries
information. See "Claims measured false" — the plan asked for a case in the unreachable
direction.

### `packages/core/src/job/submit.test.ts`

**Seven cases** in a new `CHURN-05` block, each stating what it cannot redden on. The
block's header states the one thing none of them can redden on: `coverageOf`'s own set
arithmetic, which `coverage.test.ts` holds. This file proves the **composition**. Existing
77 cases unedited and green (77 → 84).

`renderCoverage` in the test is the shape every display site has to take — the named arm
handled first, `describeCoverage` reachable only past it. It is not a convenience: it is
the thing under test in the public-job case, and it is what 20-10 will write.

### `packages/net/src/reduce-job.test.ts` — disclosed, outside the declared list

The same `jobWith` factory 20-01 and 20-07 each had to move. It now states
`coverage: 'defines-no-owners'`, which is the **measured** reading rather than a convenient
one: `ShardResult` carries no owner — `reduce-job.ts`'s own header says *"`ShardSpec.ownerId`
exists but `JobResult` does not preserve it"* — so a job assembled from these literals has
no sovereign shard to derive an owner from, and the named arm is exactly what `submitJob`
reports for that job. **No assertion changed.** The file was unmodified in `git status`
before the edit, and no live Phase 20, 21 or 22 plan lists it in `files_modified`
(checked before editing).

---

## The reader fan-out, reconciled — both counts

| Instrument | Count |
|---|---|
| `npx tsc --noEmit` construction sites | **1** |
| `grep -rn 'JobResult'` hits (excluding `ReduceJobResult`) | **80**, across **22 files** |
| whole-object `toEqual`/`toStrictEqual` on a `JobResult` | **1** candidate, harmless — reasoned and then measured |

- **The single construction site** is `packages/net/src/reduce-job.test.ts`'s `jobWith`.
  `agreedJob` also *returns* `JobResult` but delegates to `jobWith` and never names a
  field, so `tsc` correctly did not list it — worth recording, because "functions returning
  the type" (2) and "functions constructing it" (1) are different lists and only the second
  moves.
- **The other 21 files are readers or prose** and none moved: 6 `Promise<JobResult>`
  producers that get their value from `submitJob` itself, 13 reader-annotated helpers
  (`observe`, `resultCids`, `shardCounts`, `agreedOutputs`, `deriveTree`, `jobAnswer`, …),
  and prose mentions in docblocks.
- **The `toEqual` trap Phase 19 recorded three times did not fire here.** The one candidate
  is `packages/net/src/submit-with-egress.test.ts` — `expect(result).toEqual(expected)` —
  and it compares two **live** `submitJob` results on the `no-shards` error path, so a new
  field appears on both sides. Reasoned, then measured: green in the whole-tree run.

**The two lists reconcile.** Phase 19's warning holds in shape — `tsc` enumerated 1 of 22
files — and it cost nothing this time because the 21 it missed are all readers.

---

## Every mutation planted, and the exact text observed

Baseline restored by `cp` + `cmp` after each; **`cmp` exit `0` recorded every time**. Never
`git checkout --`. Every plant was applied, run and restored inside a single shell
invocation so a kill could not leave one live.

Baseline before the plants: `npx vitest run --project node packages/core/src/job/submit.test.ts
packages/core/src/coverage.test.ts` → **exit 0**, `Tests 91 passed (91)`.

### Plant 1 — the per-owner gate: **THE LOAD-BEARING PLANT**

`.filter(([owner, owed]) => (doneByOwner.get(owner) ?? 0) >= owed)` → `.filter(([owner]) =>
(doneByOwner.get(owner) ?? 0) >= 1)`. Count an owner on its first landed shard.

**RED. Exit 1. `Tests 2 failed | 82 passed (84)`.** Observed:

```
× refuses to count an owner who delivered one shard of four — the per-owner gate
× does not count a shard whose losing copy answered DIFFERENTLY, however well it agreed
AssertionError: expected [] to strictly equal [ 'alice' ]
AssertionError: expected 1 to be +0 // Object.is equality
```

The first is the case the plan named as carrying this claim, and it does. The second is my
own extra case, which alice also fails at 9 of 10 — recorded so nobody reads it as a second
independent reading of the gate.

### Plant 2 — the named union is load-bearing

`? 'defines-no-owners'` → `? coverageOf([], [])`. Carry a bare report for a job with no
owners.

**RED. Exit 1. `Tests 1 failed | 83 passed (84)`.** Observed:

```
× says by name that a public job defines no owners, and never renders it as a partial anything
AssertionError: expected { covered: +0, total: +0, …(3) } to be 'defines-no-owners'

- Expected: "defines-no-owners"
+ Received: { "complete": false, "covered": 0, "missing": [], "total": 0, "unexpected": [] }
```

**And then the rendering half was measured separately rather than asserted on faith.** The
run above short-circuits at the union assertion and never reaches the `PARTIAL` reading, so
the same plant was re-run with that one line removed from the test file (restored by `cp` +
`cmp`, exit `0` on both files):

**RED. Exit 1. `Tests 1 failed | 83 passed (84)`.** Observed:

```
AssertionError: expected 'covered: 0/0 owners — PARTIAL (no own…' to be 'this job defines no owners'

Expected: "this job defines no owners"
Received: "covered: 0/0 owners — PARTIAL (no owners were expected)"
```

That received string is the sentence every benchmark rung in this repository would have
started printing. It is now an observation, not a prediction.

### Plant 3 — coverage and completeness are different questions

`complete: shards.every(…)` → derived from `coverage.complete` where a report exists.

**RED. Exit 1. `Tests 3 failed | 81 passed (84)`.** Observed:

```
× reports a degraded, agreed shard rather than an error when redundancy exceeds the owner’s live node count
× reports full coverage on a job that is NOT complete, because a public shard disagreed
× counts an owner whose shard agreed at REDUCED redundancy — the degraded decision, stated
AssertionError: expected true to be false // Object.is equality   (×3)
```

**The plan predicted one case and named the wrong one.** It said *"Task 2's
disagreeing-shard case (public, no owners) must go red"*; a public job takes the sentinel
arm, so under this plant its `complete` is unchanged and it stays green. What reddens is the
two cases that have owners **and** a non-coverage reason to be incomplete — and, usefully, a
**pre-existing 19-era case** (`reports a degraded, agreed shard rather than an error…`),
which means the tree already held an independent guard against this collapse.

### Plant 4 — the owner set comes from the shards, not from the nodes

`[...owedByOwner.keys()]` → `[...new Set(candidateNodes.map((n) => n.ownerId))]`.

**RED. Exit 1. `Tests 4 failed | 80 passed (84)`.** Observed:

```
× names an owner whose nodes are all missing, rather than dropping them from the denominator
× reports full coverage on a job that is NOT complete, because a public shard disagreed
× counts an owner whose shard agreed at REDUCED redundancy — the degraded decision, stated
× derives the owner set from the job’s own shards, never from the owners of its nodes
AssertionError: expected [] to strictly equal [ 'carol' ]
AssertionError: expected false to be true // Object.is equality
AssertionError: expected false to be true // Object.is equality
AssertionError: expected 2 to be 1 // Object.is equality
```

The last line is the anti-vacuity reading: a node-derived set reports `2` owners where the
job defines `1`, and would have sent somebody to find a node that was there all along.

### Plant 5 — the late-disagreement clause is consulted

`return shard.verification.status === 'agreed' && !shard.disagreed` → drop the second
clause.

**RED. Exit 1. `Tests 1 failed | 83 passed (84)`.** Observed:

```
× does not count a shard whose losing copy answered DIFFERENTLY, however well it agreed
AssertionError: expected 1 to be +0 // Object.is equality
```

**This plant is why the seventh case exists.** The clause is my addition, and without a case
for it nothing in the tree was holding it — a clause with no reading is a clause nobody is
holding. Reaching a late disagreement takes the only shape that can produce one: ten
sovereign shards (`floor(shards × 0.1)` is the default allowance, so fewer than ten cannot
speculate at all), nine finishing at once so the median clears `MIN_SAMPLES`, and the tenth
held until its duplicate — which lies — has been dispatched.

---

## Claims in the plan measured FALSE

1. **`<proof>` for Task 2: *"A job that is complete but not fully covered (every placed
   shard agreed; one owner had nothing placed)"* — NOT CONSTRUCTIBLE, and the plan's own
   `<interfaces>` states the reasoning that makes it look constructible.** The
   `<interfaces>` line is *"A four-owner job in which one owner is entirely absent can have
   every **placed** shard agree"*, which is true — but that absent owner's shard is still in
   `spec.shards`, still in `JobResult.shards` as `never-placed`/`insufficient`, and
   therefore still inside `complete`'s `shards.every(…)`. So `complete` is false whenever an
   owner is absent. Generalising: an owner is *expected* only by having a shard, and every
   shard is in `complete`'s conjunction, so **`complete === true` implies
   `coverage.complete === true`**. The direction the plan asked for is unreachable on this
   path.

   **What makes it unreachable is the plan's own decision not to add a `JobSpec` owner
   field.** Under `runResilient`'s optional `expectedOwners` a caller could declare an owner
   with no shard, and the pair came apart. That is the price of deriving, it is a price
   worth paying, and it is now written into the module header, into the case's
   `WHAT THIS CANNOT REDDEN ON` note, and here — rather than paid for with a fixture that
   pretends otherwise. **The reachable direction is proved twice**, by two different
   mechanisms (a public shard that disagreed; a sovereign shard that degraded), which is
   what the pair was for.

2. **`<proof>` for Task 1, third item: *"Task 2's disagreeing-shard case (public, no
   owners) must go red"*.** It does not, and it cannot: a public job takes the sentinel arm,
   so `complete` is unaffected by the plant. Detailed under Plant 3, with the three cases
   that do redden named.

3. **`<proof>` for Task 1, fourth item — `unexpected` is NOT reachable, and this is
   reported rather than papered over with an empty-array assertion.** Both the expected and
   the delivered set are derived from `spec.shards[i].ownerId` through one map, so
   `contributed ⊆ expected` holds by construction. **What would make it reachable:** a
   delivered owner read from a *second* source — a `ShardResult` that carried its own owner,
   or an egress manifest — so the derivation and the delivery become two traversals that can
   disagree. The field is kept, and the reason is written at the site: a non-empty
   `unexpected` on a derived set would mean exactly that they had come apart, which nothing
   else in this module would catch. No assertion in this file reads it.

4. **`<interfaces>`: *"`coverageOf(expected, contributed)` — pure set arithmetic"*, and
   `describeCoverage` already emitting `covered: X/Y owners`.** Both true, verified against
   the post-20-07 tree, and `describeCoverage`'s output is compared rather than transcribed.

---

## Assertions found that could not fail

- **Nothing shipped in this file.** All five plants reddened a named case; the one case
  whose reading was hidden behind a short-circuit (the `PARTIAL` render) was measured
  separately by removing the line that hid it, rather than being recorded as covered.
- **One reading deliberately NOT taken:** `unexpected`. Asserting `[]` would transcribe a
  construction, not measure a behaviour. Item 3 above.
- **One case that is weaker than it looks, and says so in the file:** the seventh case
  cannot separate the two halves of `landedForItsOwner`, because alice fails the per-owner
  gate at 9 of 10 as well. It says the late-disagreement clause is *consulted*; the
  partial-owner case is what says the gate is per-owner. Written into the case.

---

## Behaviours `submit.test.ts` now covers, for 20-12's inheritance

`coordinator.test.ts`'s `CHURN-05 — the aggregate carries its coverage` block, all three
cases, against `submitJob`:

| `coordinator.test.ts` case | Where it now lives |
|---|---|
| `reports partial coverage when an owner contributes nothing` | `names an owner whose nodes are all missing, rather than dropping them from the denominator` |
| `refuses to call an owner covered when only some of their shards landed` | `refuses to count an owner who delivered one shard of four — the per-owner gate` |
| `reports complete coverage only when every owner contributed` | `reports full coverage on a job that is NOT complete…` and `derives the owner set from the job’s own shards…` |

**All three re-target cleanly, and this was checked rather than assumed:** each passes
`expectedOwners` explicitly, and in all three the declared set is exactly the set derived
from `work`. So nothing in that block rests on a *declared* owner set, and `submitJob`'s
lack of one costs those cases nothing.

**NOT covered here, and 20-12 must not assume otherwise:**

- **A declared owner set with no shard behind it.** `CoordinatorOptions.expectedOwners`
  allows it and `submitJob` cannot express it, by decision. No coordinator case exercises
  it, so nothing is lost today — but the *capability* goes with `runResilient`, and that is
  a deletion, not a migration.
- Speculation's `MIN_SAMPLES` floor (20-07's open item), the `node`/`task`/`sender`
  failure-kind distinction (20-01's), and checkpointing (20-11).

---

## Costs and consequences, stated rather than left to be found

1. **`JobResult` gained a required field.** One construction site in the tree; 21 reader
   files unaffected. Any *future* literal must state the arm, and `'defines-no-owners'` is
   the truthful one for a fixture with no sovereign shard.
2. **Coverage is computed after `compareOutstanding`**, because `ShardResult.disagreed` is
   half of what "landed" means and is only known then. Two map builds and a filter over
   shards already in hand — no second pass over anything, no clock, no I/O.
3. **A `complete` job's coverage adds no information.** Its information content is entirely
   in the incomplete cases. That is an argument for reading both, not for merging them: the
   converse fails, and a caller told only "incomplete" cannot tell a missing owner from a
   disagreeing shard.
4. **The barrel was not edited.** `JobCoverage` is exported from `submit.ts` only, following
   20-07's precedent and for its reason — `core/src/index.ts` is a shared file and this plan
   does not own it. `JobResult` is already re-exported, so the field's type is reachable
   structurally (`JobResult['coverage']`, which is how the test names it) and `CoverageReport`
   is already in the barrel. 20-10 may want the alias there; that is a one-line decision for
   whoever owns that file next.
5. **A public job's coverage is a sentinel, not a zero.** Anything summing or averaging
   coverage across jobs has to handle the arm. That is the union doing its job.

---

## Deferred / found, not closed here

- **CHURN-05's checkbox is NOT ticked, and neither is WIRE-04's.** This plan closes the
  *mechanism* half by its own title; the requirement reads *"a cross-owner job over
  unavailable owners **returns** a coverage report"* and the live cross-owner reading plus
  the CLI surface are 20-10's, WIRE-04's barrel removal is 20-12's. Ticking either here
  would be widening what counts as passing.
- **CHURN-05's traceability row is stale in a way this plan did not cause and did not fix.**
  It reads *"Built, not wired — runResilient has no caller; submitJob is the only job path
  and does not speculate or re-dispatch"*. Both halves of the last clause have been false
  since 20-01 and 20-07, and the first half is now false for coverage too.
  `requirements-ledger.node.test.ts` is green against it, so nothing is broken — but the row
  is misleading and belongs to whoever ticks the box. `.planning/REQUIREMENTS.md` is outside
  this plan's declared file list and was not touched.
- **`unexpected` has no reachable reading.** Item 3 under claims measured false, with the
  mechanism that would give it one.
- **20-01's finding still stands unrepaired**: substituting the job's node set for
  `gate.pool` silently widens the **quorum** pool and nothing in the tree catches it. This
  plan touches neither.
- **No field says *why* an owner is missing** — every node offline, one shard of four
  failed, or a late disagreement are three different facts and `missing` reports one word
  for all three. `JobResult.shards` holds the evidence; deriving a reason would be a new
  decision.

---

## Whole-tree run, read directly

`npx tsc --noEmit` → **exit 0**.

`npx vitest run --project browser` → **exit 0**, `Test Files 246 passed (246)`,
`Tests 3981 passed (3981)`. `/usr/bin/time -p`: real 119.94, user 96.26, sys 19.68 —
`(user+sys)/real` = **0.97**. Below 1, and below 20-07's 1.17 on the same suite: this
process was *waiting*, not starving, on a host running three other agents' suites. Reported
as the comparability key it is, not as a verdict.

`npx vitest run --project node` → **exit 1**, `Test Files 3 failed | 146 passed (149)`,
`Tests 8 failed | 2137 passed | 2 skipped (2147)`. `/usr/bin/time -p`: real 275.12, user
297.74, sys 42.25 — `(user+sys)/real` = **1.24**, so this process held more than a core.

### Every red attributed by measurement, not by plausibility — none is this plan's

1. **`packages/node/src/speculation-agents.node.test.ts`** (5 failures) — **plan 20-09's own
   subject, unfinished.** The file is `??` untracked and `bin/bench.ts` / `perf-workload.ts`
   are ` M`; all three are 20-09's declared `files_modified`, and that plan is live in this
   same wave. Its failing assertion greps `bin/bench.ts`'s *source text* for
   `speculationMultiplier: result.ok ? result.job.speculationMultiplier` and reports it
   absent. Measured: `grep -c coverage packages/node/src/speculation-agents.node.test.ts` →
   **0**. It cannot be caused by a field it never names.

2. **`packages/node/src/bench-attestation.node.test.ts`** (1 failure) — the recorded
   shared-tree hazard, and **attributed by reading the diff in the failure message**, per
   `CLAUDE.md`. My three files appear **byte-identical in expected and received** on every
   occurrence. The moving entries were `packages/bench/src/perf-workload.ts` and
   `packages/node/src/bin/bench.ts` (20-09 editing), and on an isolated re-run minutes later
   `packages/aot/src/abi-router.ts` (a Phase 21 agent editing). **No `git add` of mine
   occurred during any run** — the index was staged before the run and left alone, per the
   convention.

3. **`packages/node/src/aot-dispatch.node.test.ts`** (1 failure) — a Phase 21 agent's file,
   `??` untracked at the time, failing on `rpc … timed out after 60000ms` across spawned
   agent processes. `grep -c coverage` → **0**. **Measured green afterwards**: that agent
   committed (`b0dd390`), and a re-run gives **exit 0** (below).

### Re-runs after the foreign files settled

- `npx vitest run --project node packages/core/src packages/net/src` → **exit 0**,
  `Test Files 55 passed (55)`, `Tests 843 passed (843)`. `/usr/bin/time -p`: real 15.77,
  user 16.66, sys 2.81 — `(user+sys)/real` = 1.23.
- `npx vitest run --project node` over the eight `JobResult` readers and the guards that
  watch this file — `aot-dispatch`, `churn-agents`, `pi-reduce`, `primes-reduce`,
  `tree-reduce-agents`, `mutation-guard`, `requirements-ledger`, `serve-agent-hooks` →
  **exit 0**, `Test Files 8 passed (8)`, `Tests 165 passed (165)`. `/usr/bin/time -p`: real
  44.16, user 58.80, sys 9.88 — `(user+sys)/real` = 1.56. **`aot-dispatch` passes here**,
  which is the measurement that attributes its whole-tree red to the other agent rather than
  to me.
- `npx vitest run --project node packages/aot/src/abi-router.test.ts` → **exit 0**,
  `16 passed (16)`, after that agent's commit. It had been red mid-edit.

`mutation-guard.node.test.ts` is green: `M43`, `M44`, `M45` and `W1`–`W5` all still match
their `find` strings. Nothing this plan added sits on a pinned line — the new code is a
type, a helper and a block immediately above the `return`.

**20-01's scheduled tripwire in `discovery-agents.node.test.ts` is green**, so 20-04 has
landed. Recorded because 20-01's summary left it red by design.

---

## Concurrency, as asked

Verified at start and again at commit: **nobody else was in `submit.ts` or
`submit.test.ts`**, before or after. 20-09 is live on `bin/bench.ts` / `perf-workload.ts` /
`speculation-agents.node.test.ts` — disjoint, and the source of five of the eight
whole-tree reds. Another agent is on `late-combine.node.test.ts` — disjoint, and green in my
whole-tree run. Two Phase 21 agents were mid-edit on `packages/aot/src/abi-router.ts` and
`packages/node/src/aot-dispatch.node.test.ts` during my runs and committed as `b0dd390`;
both are green now. **The branch is `feature/phase-18-discovery-capacity-placement`, not the
`feature/bug-fixes-22` named in this executor's spawn context** — another agent moved the
shared checkout before I started. I did not switch branches, and 20-01's and 20-07's commits
are in this branch's history, which is what my `depends_on` needed.

**Defect #39's fix held.** The pre-commit guard ran, reported nothing foreign, and passed —
`6 files, 205 tests`. `O2_SKIP_GUARDS` was not used. `git commit -F -` was not used.

---

## A STATE.md writer corrupted it **while reporting an error** — found, reverted, recorded

`STATE.md` was not updated by this plan, and the reason is a finding rather than an
omission.

`gsd-sdk query state.advance-plan` was run as the executor's own protocol asks. It printed
`{"error": "Cannot parse Current Plan or Total Plans in Phase from STATE.md"}` — and **wrote
to the file anyway**. Measured from the diff: nine frontmatter lines replaced with an older
snapshot (`status` `executing` → `verifying`; `stopped_at` replaced by a Phase-14-era
sentence; `last_activity` regressed 2026-08-04 → 2026-07-31; `total_phases` 14 → 24,
`completed_phases` 6 → 10, `total_plans` 76 → 99, `completed_plans` 72 → 88, `percent`
**43 → 89**), plus 37 blank lines inserted by a markdown reformatter. Zero prose lines added
or removed by anybody — checked line by line before touching it, so nothing of another
agent's was in the delta.

**This is a new data point against `STATE.md`'s own comment block**, which lists three
writers that have corrupted it and ends *"Each was caught that way and not by the tool
reporting a failure. **None of them errored.**"* This one errored and corrupted anyway, so
"it reported an error, therefore it did not write" is not a safe inference either.

**Reverted by `cp` from `git show HEAD:.planning/STATE.md`, `cmp` exit `0`**, and `git
status` clean for that path. **No `git checkout --`** — the file is shared and the
prohibition stands even when the delta is provably one's own.

No further state mutator was run. `state.record-metric` is already named in that comment
block as a corrupter (*"asked for a single metrics row, it also rewrote `status` and
`stopped_at` … percent 36 to 74"*), and `roadmap.update-plan-progress` has no per-plan
progress table to update — `ROADMAP.md`'s Phase 20 entry is a checkbox and a details block.
`requirements.mark-complete` was deliberately not run, for the reason under *Deferred*.
This matches what 20-01, 20-07 and 21-04 each did: the per-plan commit carries the SUMMARY,
and `STATE.md` is moved by hand at a wave boundary.

## Known Stubs

None. Every value on the new field is written from a measured quantity on every path,
including `'defines-no-owners'`, which is the truthful reading of a job that defines no
owners rather than a placeholder for one that does.

## TDD Gate Compliance

The plan marks both tasks `tdd="true"`. **There is no `test(...)` RED commit**, and
retro-fitting one would be a fiction — the same position 20-01 and 20-07 recorded. What
stands in its place is what the plan actually asked for: **five defects planted into the
shipped implementation, each watched going red with its output pasted above, each restored
by `cp` + `cmp` with exit `0` recorded** — plus one reading measured separately because a
short-circuit hid it, one plan-specified plant target reported as naming the wrong case, and
one plan-specified case reported as unconstructible rather than faked.

## Commits

| Commit | What |
|---|---|
| `51bed18` | `feat(20-08)` — owner coverage on the one job path, the named union, the per-owner gate, seven kernel cases, the `reduce-job.test.ts` construction site |

Committed with **explicit paths** (`git commit … -- <path> <path> <path>`) and verified with
`git show --stat`: `3 files changed, 626 insertions(+)`, only my own. The shared index held
another agent's staged file at the time; a bare `git commit` would have swept it in.

## Self-Check: PASSED

- `packages/core/src/job/submit.ts` — FOUND
- `packages/core/src/job/submit.test.ts` — FOUND
- `packages/net/src/reduce-job.test.ts` — FOUND
- `.planning/phases/phase-20-single-job-path-ledger-churn-resilience/20-08-SUMMARY.md` — FOUND
- commit `51bed18` — FOUND in `git log`
</content>
</invoke>
