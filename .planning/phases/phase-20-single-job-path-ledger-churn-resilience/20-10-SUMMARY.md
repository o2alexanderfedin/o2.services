---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 10
subsystem: coverage, benchmark-driver, cross-owner-jobs
tags: [CHURN-05, DATA-01, coverage, named-union, owed-vs-done, process-fixture]
requires:
  - "packages/core/src/job/submit.ts — JobResult.coverage, JobCoverage, landedForItsOwner, the owed-against-done gate (20-08, UNCHANGED here)"
  - "packages/core/src/coverage.ts — coverageOf / describeCoverage (pre-existing, UNCHANGED)"
  - "packages/core/src/placement.ts — planWithOffers' cross-shard headroom tally, owner ruling D2 (pre-existing, UNCHANGED)"
  - "packages/node/src/owner-domain-agents.node.test.ts — the spawn helper, per-owner --user-key enrolment, stop-then-poll, and the store read (copied, not imported)"
  - "packages/node/src/bin/bench.ts — the per-rung output block as 20-02 and 20-09 left it"
provides:
  - "criterion 4 measured across four spawned processes — 3/3, 2/3 and 1/3 over one fabric with one input moving per step"
  - "the owed-against-done gate read over real processes on a LIVE owner, not only in the kernel"
  - "a CLI decision recorded at the call site: coverage renders only where a job defines owners"
  - "a stdout reading that no benchmark rung prints PARTIAL, paired with a source count so deleting the renderer cannot satisfy it"
affects:
  - "20-12 — coordinator.test.ts's CHURN-05 block now has a process-level counterpart as well as 20-08's kernel one"
  - "20-13 — a new node spec at real 13.82 solo; the node project still holds 150 files, so the slow-specs drift is unchanged at 6"
  - "whoever ticks CHURN-05 — the requirement's live reading exists now; the checkbox is still NOT ticked here"
tech-stack:
  added: []
  patterns:
    - "one closure, three arms, exactly ONE input moving per step — the candidate set, then one integer a node states about its own room"
    - "a fixture arrangement REJECTED BY MEASUREMENT rather than by argument, with the failing text recorded"
    - "an absence read off stdout, paired with a source-text count so that deleting the feature cannot satisfy it"
    - "restoring a plant in a SHARED file by inverse edit, then verifying with cmp — never by clobbering with cp"
    - "a published artifact guarded by its own bytes rather than by git status --porcelain, which two sibling specs pay for"
decisions:
  - "the partial owner is arranged through JobSpec.admit, because a node-side slot count destroys the control — measured, not argued"
  - "the CLI prints a coverage line only where a job defines owners; on this driver that is never, and the silence is the reading"
  - "the drop-poll is kept as a stated precondition after being measured NOT to carry the reading"
  - "the discovery premise is asserted AFTER the coverage reading it explains, so a plant reddens on the denominator"
  - "no plant was made in packages/core/src/job/submit.ts while another agent held uncommitted work in it"
metrics:
  duration: ~1h50m
  completed: 2026-08-05
---

# Phase 20 Plan 10: The partial aggregate says it is partial Summary

A cross-owner job over four spawned `bin/agent.ts` processes now returns **an answer and
the number of owners behind it**. Over one fabric, with one input moving per step:

```
[criterion 4 / coverage] control covered: 3/3 owners — complete
                         stopped covered: 2/3 owners — PARTIAL (missing ca57eed30e…)
                         thinned covered: 1/3 owners — PARTIAL (missing c286554ac7…, ca57eed30e…)
                         shards agreed 4 → 3 → 2 of 4; offers to the two-shard owner 2 → 2 → 1
```

Every figure is a count or a comparison against another arm of the same fixture. Nothing
here is a duration and nothing is a threshold.

---

## What landed

### `packages/node/src/coverage-agents.node.test.ts` — new

Three owners, one spawned agent each, each enrolled under its own `--user-key`; one
provider; one in-process requestor. A job of **four** sovereign shards — one owner owes
one, one owes **two**, one owes one — so the denominator is three owners over four shards.

- **Arm 1, the control.** All three up: `3/3`, `missing` empty, `describeCoverage` renders
  `covered: 3/3 owners — complete`, every shard `agreed`, `job.complete` true. Without it
  everything below could be describing a fixture that never covered anything.
- **Arm 2, the stopped owner.** One process SIGTERMed, asserted dead by exit code, the
  requestor polled until it drops the peer, then the **same job over the same requestor**:
  it returns a result — the other owners' three shards agreed — with `covered: 2/3` and the
  absent owner named in `missing` **by the id the fixture derives from its own seed**,
  never read back out of the result it is checking.
- **Arm 3, the partial owner.** Nothing about the fabric changed: the same two processes,
  the same discovered candidate set, the same job. One integer moved — the two-shard
  owner's node states room for **one** shard — and that owner drops out at `1/3` while
  **alive, dialled, and having just agreed a shard**.
- **The sovereignty guard**, labelled in the file as a guard against this fixture's shape
  rather than as criterion 4's content: after the readings, every owner's store is read and
  asserted to hold its own rows and **none of any other owner's**.

**The reading is a pair, everywhere.** Each arm asserts both that the job *returned an
answer* and that its coverage is *not complete*. Either alone is half a reading: a job that
failed outright would also report incomplete coverage.

**`covered: 2/3` comes off `describeCoverage`**, not off transcribed prose —
`bench-attestation.node.test.ts`'s discipline with `describeAttestation`.

### `packages/node/src/bin/bench.ts` — the CLI decision, and it is recorded either way

`coverageReading(held): string | null` returns `null` for the named `'defines-no-owners'`
arm, so **a coverage line is printed only where the job defines owners** and the line's
presence is itself the information. `RungAttestation` carries `JobResult.coverage`
alongside the two receipts **in the same statement**, following that statement's own
recorded rule that the facts a reader compares must come off one job.

Every rung of this driver submits `label: 'public'` shards, so on this driver the line
never prints. That is the decision and not a gap, and both halves of the argument are
written at the call site: a line repeating *"this job defines no owners"* five times a
sweep is noise, and a reader who has learned to skip a line cannot be told anything by it —
while printing nothing at all would leave the CLI with **no reader** for the failure the
named union exists to prevent.

**Where criterion 4's rendered reading actually lives is named in the source**:
`coverage-agents.node.test.ts`, not the driver. Same division as the speculation columns
20-09 landed — the CLI leg says the surface is wired, the process fixture says what it
reports when it has something to report.

---

## Every mutation planted, and the exact text observed

Each applied, run and restored **inside one shell invocation** so a kill could not leave
one live. `cmp` exit `0` recorded every time. Never `git checkout --`, never `git stash`.

Baseline: `npx vitest run --project node packages/node/src/coverage-agents.node.test.ts`
→ **exit 0**, `Tests 2 passed (2)`, `/usr/bin/time -p` `real 14.27  user 12.52  sys 2.11`.

### Plant 1 — the owner's process is not stopped

`await stopAgentNow(spar)` and `expect(isDead(spar)).toBe(true)` removed.

**RED. Exit 1.** Observed:

```
Error: timed out waiting for the requestor to drop 12D3KooWGUxNAPPEoZSq9eyorzBAMWG5Qg…;
it still held ["12D3KooWRqrDoDNEDzh6…","12D3KooWGJDhYpTGEu6C…","12D3KooWGUxNAPPEoZSq…"]
```

**It reddens on the precondition and never reaches the denominator** — the shape 20-09
warned about, arriving. Reported rather than presented as the reading, and the reading was
then taken separately:

### Plant 1b — the stop AND the poll removed, so the coverage is reachable

**RED. Exit 1.** Observed:

```
AssertionError: expected 3 to be 2 // Object.is equality
- Expected: 2   + Received: 3
```

**This is the load-bearing plant.** The second arm reads `3/3` when the owner did not go
away, so the denominator moved *because* the owner went away.

### Plant 2 — the drop-poll removed, the stop kept

**GREEN. Exit 0.** Same `covered: 2/3 owners — PARTIAL (missing ca57eed30e…)`,
`real 15.31` against the baseline's `14.27`. See *Claims measured FALSE* item 1.

### Plant 3 — the owed-against-done gate, in `submit.ts`

20-08's Plant 1, over processes: `.filter(([owner, owed]) => (doneByOwner.get(owner) ?? 0)
>= owed)` → `.filter(([owner]) => (doneByOwner.get(owner) ?? 0) >= 1)`.

**RED. Exit 1.** Observed, and **the line matters**:

```
AssertionError: expected 2 to be 1 // Object.is equality
 ❯ packages/node/src/coverage-agents.node.test.ts:851:26
    851|     expect(thin.covered).toBe(1)
```

**The partial-owner arm carries the claim and nothing else here does.** The control (`3/3`)
and the stopped arm (`2/3`) both stayed green under this plant, exactly as the plan
predicted: a stopped owner delivers nothing, so it lands in `missing` under the shipped
rule *and* under the wrong one.

### Plant 4 — the named union does not leak onto the operator's surface

`bin/bench.ts`'s `if (coverage === 'defines-no-owners') return null` replaced by
`return describeCoverage(coverageOf([], []))` — a display site that did not handle the arm.

**`npx tsc --noEmit` exit 0 under the plant**, which is half the finding: nothing in the
type system stops a display site rendering the sentinel as an apology.

**RED. Exit 1.** Observed, on **every rung**:

```
  memory transport, 1 node(s)…
    map attestation (first completed run): none established (agreeing 1, verified 0) — …
    aggregate attestation (first completed run): none established (combines 5, verified 0) — …
    owner coverage (first completed run): covered: 0/0 owners — PARTIAL (no owners were expected)
  memory transport, 2 node(s)…
    …
    owner coverage (first completed run): covered: 0/0 owners — PARTIAL (no owners were expected)
```

That is the sentence every published benchmark sweep would have started printing. It is now
an observation on this driver's own stdout, not a prediction.

### Plant 5 — the sovereignty guard can fail

One owner's row copied into another owner's directory just before the guard.

**RED. Exit 1.** Observed:

```
AssertionError: keel holds row 3 (owner another): expected true to be false
```

### Plant 6 — the sentinel does not leak into this reading

`submit.ts`'s `owedByOwner.size === 0` → `>= 0`, i.e. every job reports
`'defines-no-owners'`.

**RED. Exit 1.** Observed:

```
Error: this job reported the no-owners sentinel; it defines four sovereign shards across
three owners, so a sentinel here means the owner set was derived from something other than
the job’s own shards
 ❯ coverageOfJob packages/node/src/coverage-agents.node.test.ts:617:11
```

### Experiment 7 — the arrangement the plan suggested, run rather than argued about

Not a plant on shipped code: the two-shard owner's agent spawned with
`--max-concurrent-tasks 1`, i.e. the partial owner arranged by the **node's own** capacity.

**RED, and on the wrong arm. Exit 1.** Observed:

```
AssertionError: expected 2 to be 3
 ❯ packages/node/src/coverage-agents.node.test.ts:738:26   (expect(full.covered).toBe(3))
```

**The control is destroyed.** See *Claims measured FALSE* item 3.

### How the two plants in `submit.ts` were restored, and why it is not `cp`

`submit.ts` is a **shared** file — 20-11 held 544 uncommitted lines in it when this plan
began, and 20-12 was editing it minutes later. A `cp` restore from a snapshot silently
reverts anything a concurrent agent wrote inside the window.

So both were restored by the **inverse textual edit**, asserted to match exactly one site,
and `cmp` against the snapshot was used as a *check* rather than as the restore — with the
rule that a non-zero `cmp` would be reported, never clobbered. Both read `cmp` exit `0`,
and the file's mtime was read before and after each. **Both plants were taken in the
window after 20-11 committed (`f906d66`) and before 20-12 began**, verified by
`git status` at the time; the exposure was one ~14 s run each.

---

## Claims in the plan measured FALSE

1. **`<proof>` item 2: *"the offline precondition can fail — reddened by asserting coverage
   before the requestor has dropped the peer; the run reads 3/3 intermittently."*
   **FALSE, measured.** Deleting the poll leaves the file green — exit 0, the identical
   `covered: 2/3`, `real 15.31` against `14.27` — because a dead process closes its
   connection on exit and answers no provider query either, so discovery excludes it
   whether or not the requestor's verdict has caught up. The poll is **kept**, and the file
   now says what it actually buys: a *stated precondition* rather than the thing that
   carries the reading. Leaving it looking load-bearing was the specific failure the plan
   asked to avoid, arriving from the other direction.

2. **`<proof>` item 1's mechanism: *"Reddened by not stopping the agent: the second run also
   reads 3/3 and the case fails."*** Half true. Not stopping the agent reddens on the
   **drop-poll**, 30 s earlier, on a fact about the peer set rather than about the
   denominator. Reaching the coverage reading takes removing the poll as well (Plant 1b),
   and that is where `expected 3 to be 2` comes from. Recorded rather than reported as
   though the first plant had produced it.

3. **`<behavior>`: the partial-owner case *"arranged by saturating or stopping only part of
   that owner's node set"* — NEITHER of those arrangements works, and one of them was
   measured failing.**
   - **A node-side slot count destroys the control**, measured as Experiment 7 above: the
     flag sets one number and that number binds in *every* arm, because `serveAgent`'s
     `exec` branch reserves a slot around the executor call and `submitJob` dispatches every
     shard under one `Promise.all`. The owner is partial before anything has gone wrong.
   - **Stopping part of an owner's node set cannot do it either**: give the owner two nodes
     and stop one, and 20-01's generation loop places the orphaned shard on the survivor —
     the repair is that plan's entire subject.
   What does work is a *requestor-side* dial, which is what `JobSpec.admit` is for in its
   own words (*"a requestor that supplies this bounds itself"*), through `planWithOffers`'
   headroom tally — owner ruling D2. **The admission control is this fixture's dial and not
   its subject**, and the file says so: what is under test is what `submitJob` reports about
   an owner that delivered one shard of two.

4. **`<interfaces>`: *"`owner-domain-agents.node.test.ts` … already does most of what this
   plan needs."*** True, and the largest single saving in this plan. Its `spawnAgent`,
   `stopAgent`, `until`, `writeUserKey`, its budgets and its stop-then-poll-then-read
   sequence are faithful copies (never imports — importing from another `.test.ts`
   re-registers that file's suite). What had to be **new** is the per-owner capability
   supplier: that file closes over one owner's key, and three owners' shards through one
   candidate set need the root selected per `task.ownerId`.

5. **`<interfaces>`: *"`describeCoverage` emits `covered: X/Y owners …` — criterion 4's
   literal string."*** True, verified against the post-20-08 tree and compared through the
   function on every arm.

---

## Assertions that could not fail, and what was done about each

- **The CLI stdout case is an absence, and an absence alone is satisfied by a driver that
  never learned to render coverage.** So it is paired with a source-text count
  (`coverageReading(` appears twice: its definition and its one call site) and with the
  literal named-arm line. Neither half is worth much alone; the pair is what makes the
  silence a measurement. **Both halves were watched**: Plant 4 reddens the stdout half,
  and deleting the call site would take the count to 1.
- **The discovery premise was in the wrong position and was moved**, before any plant was
  taken. `expect(withoutSpar.providersPerShard).toStrictEqual([1, 1, 1, 0])` sat immediately
  after discovery, where a plant leaving the owner alive would have reddened it first — and
  this file would have proved that *discovery noticed*, which is
  `discovery-agents.node.test.ts`'s claim, not that the denominator moved. It now sits
  below the coverage reading and says what the reading was taken over. Same correction
  20-09 made, for the same reason.
- **`CoverageReport.unexpected` is deliberately NOT asserted.** 20-08 measured it
  structurally unreachable — both sets derive from `spec.shards[i].ownerId` through one map
  — and declined to ship `toStrictEqual([])` as a tautology. That decision is inherited
  rather than quietly reversed; nothing here reads the field.
- **The sovereignty guard's non-vacuity is asserted in the same expression that guards it**:
  each store is required to hold its own owner's rows and none of any other's, so an empty
  or unreadable directory fails rather than passes. Watched by Plant 5.

---

## What this file cannot redden on, said in the file and repeated here

- **`coverageOf`'s set arithmetic** — `packages/core/src/coverage.test.ts`'s.
- **The per-owner gate as a kernel property** — `submit.test.ts`'s seven CHURN-05 cases.
  This file proves the composition *over real processes*.
- **Sovereignty placement itself** — Phase 12's. The guard here says a row is not where it
  should not be; that a sovereign shard is narrowed *before load is consulted* would survive
  every assertion in this file.
- **`describeCoverage`'s wording** — compared through the function, so this file says the
  driver and the fixture render the kernel's sentence, not that somebody transcribed it.

---

## Did any published figure change

**No.** `.planning/BENCHMARK-RESULTS.md` is untouched — `git status --porcelain` on that
path is empty and its last commit is still 20-09's `5d51215`. Three independent reasons it
could not have moved:

1. The driver was only ever spawned with `cwd` in a temporary directory, and it writes both
   `raw.json` and the results file under `process.cwd()`.
2. The new field lands in `attested`, which is carried into `raw.json` and is **not part of
   `@o2/bench`'s `Report` type at all** — `renderMarkdown` never saw it before this plan and
   does not now.
3. On every rung of every arm the coverage line renders `null` and prints nothing, so even
   the terminal output is byte-identical. Confirmed twice: by this plan's own `--quick`
   reading, and by `bench-attestation.node.test.ts` passing on the `--discover` arm with its
   heading sequence and three strength readings unchanged.

---

## The regression the owner asked to be told about — defect #39 does NOT cover this guard

**The pre-commit hook refused this plan's first commit**, and the cause is another agent's
staged deletion of `packages/core/src/coordinator.ts` (plan 20-12's declared work).

`mutation-guard` and `slow-specs` behaved exactly as #39's fix promises:

```
⚠️  mutation-guard/M18: 2 finding(s) outside this commit — reported, not blocking.
⚠️  slow-specs/file-count-drift: 1 finding(s) outside this commit — reported, not blocking.
```

**`requirements-ledger.node.test.ts` did not**, and its own docblock says why it does not:

> *"What is deliberately NOT narrowed, and why. The header arithmetic below, and the 'every
> unreached row is checkable or recorded' set equality, are claims about
> `.planning/REQUIREMENTS.md` and this file alone. They cannot fire for anybody who did not
> edit one of those two…"*

**That reasoning is false, and this commit is the counter-example.** All three refusals were
those exempted cases, and this commit edits neither of those two files:

```
× collected the exported symbols the claims are matched against
  AssertionError: expected undefined to be '…/packages/core/src/coordinator.ts'
× extracted claims from the rows rather than matching nothing
  AssertionError: expected 5 to be greater than 10
× leaves every unreached row either checkable or recorded as not
  + "CHURN-01" … "CHURN-06", "SCHED-03"
```

`EXPORTED` is built by **walking `packages/`**, so it is a claim about the ledger *crossed
with the production corpus* — and any agent can move the corpus. The observed cost is
precisely the one #39 was fixed to remove: *"the concurrent writer was refused, the author
of the violation was not."*

**`O2_SKIP_GUARDS=1` was used on all three commits, with the reason written into the commit
messages** so `git log --all --grep=O2_SKIP_GUARDS` — the project's own instrument for
counting these — stays accurate. Before skipping, the guard set was run by hand and every
failure attributed: `vocabulary`, `purity`, `disclosure-gate` green; `mutation-guard` and
`slow-specs` scoped and reporting; the three above foreign. And
`serve-agent-hooks`, `speculation-agents`, `bench-reduce`, `bench-egress`, `harness` and
`acceptance-traceability` were run against this plan's own files and all passed.

**Not fixed here** — `requirements-ledger.node.test.ts` is nobody's file this wave, and
narrowing those three cases is a decision about the union rule, not a repair.

---

## Runs, read directly

`npx tsc --noEmit` → **exit 0** (final; it read **exit 1** with 26 errors mid-session, all
in `packages/net/src/churn.test.ts` and `packages/node/src/admission.node.test.ts` naming
`runResilient`/`DispatchOutcome`/`ShardWork` — 20-12 mid-edit, **zero** in this plan's two
files, and green again once that agent settled).

`npx vitest run --project node` → **exit 1** (read on the line immediately after the
command), `Test Files 4 failed | 146 passed (150)`, `Tests 9 failed | 2118 passed | 2
skipped (2129)`, `/usr/bin/time -p` `real 261.77  user 333.37  sys 45.73` →
`(user+sys)/real` = **1.45**, so this process held more than a core.

**`packages/node/src/coverage-agents.node.test.ts` passed in that run.** Every failure
attributed by reading its message, and each re-run:

| file | attribution | re-run |
|---|---|---|
| `mutation-guard.node.test.ts` (4) | foreign — `M18: packages/core/src/coordinator.ts is not on disk`, `M64 — packages/net/src/churn.ts`. 20-12's staged deletion and edit. | still red, correctly |
| `requirements-ledger.node.test.ts` (3) | foreign — same deletion, via `EXPORTED.get('runResilient')` → `undefined` | still red, correctly |
| `slow-specs.node.test.ts` (1) | **real, and 20-13's** — file-count drift, below | still red, correctly |
| `bench-attestation.node.test.ts` (1) | foreign — it snapshots `git status --porcelain` and the diff named exactly two moving files, `packages/node/src/mutation-ledger.ts` and `packages/node/src/requirements-ledger.node.test.ts`, both 20-12's, staged mid-run. **Neither of mine appears in the diff.** | **exit 0, 4 passed, `real 173.89`** — and the run was bracketed by `git status --porcelain` before and after, which did not move. Attributed by measurement, not by plausibility. |

**Every file this plan wrote, changed, or is read by, run together with a settled index** —
`coverage-agents`, `serve-agent-hooks`, `speculation-agents`, `bench-reduce`,
`bench-egress`, `discover-arm`, `acceptance-traceability`, `harness` → **exit 0**,
`Test Files 8 passed (8)`, `Tests 116 passed (116)`, `real 26.55  user 26.52  sys 4.88`
→ `(user+sys)/real` = 1.18.

**20-09's BENCH-03 call-site guard is green**, and so are `serve-agent-hooks`'s fifteen
substring counts over `bin/bench.ts` — checked directly as well as by running them:
`guarded(new WasmExecutor(` 3, `'dispatches-unauthenticated'` 3, `new RemoteExecutor(` 2,
`new LocalCapacity(` 2, `attest:` 2, `guardModuleProvenance(` 1, `'keeps-no-ledger'` 2,
`'signs-nothing'` 2, `await discoverCandidates(` 1 — every one unmoved.

---

## The new spec's span, for 20-13

`/usr/bin/time -p` on `--project node` restricted to this file, on a quiet host:
**`real 13.82  user 12.51  sys 2.17`** → `(user+sys)/real` = **1.06**. Four consecutive
quiet-host runs read 13.82, 14.02, 14.27, 14.29. A fifth, taken while another agent's suite
was running, read `real 23.95  user 13.19  sys 2.38` → **0.65** — the same work waiting
rather than starving. Both are handed over: the first is the span, the second is the spread.

**Above the 1 000 ms cut, so it is an exclusion** rather than a `MEASURED_NODE_SPANS` row.

**The file-count drift did not move.** `npx vitest list --project node` reports **150**
files against the recorded 144 — drift 6 against `FILE_COUNT_TOLERANCE` 5, exactly what
20-09 handed over. This plan added one file and 20-12 deleted `coordinator.test.ts` in the
same window, so the two cancelled. `vitest.config.ts` was not touched, per this plan's
execution context.

---

## Costs and consequences, stated rather than left to be found

1. **A third spec now spawns `bin/bench.ts`.** `discover-arm` and `bench-attestation` were
   the first two, and both pay a recurring price this one does not: they snapshot
   `git status --porcelain` across their run, which turns any concurrent agent's staging
   into a red. This file compares the **bytes of `.planning/BENCHMARK-RESULTS.md`** instead
   — the one file the risk is actually about — and adds a `git status --porcelain --` on
   that single path. It cost ~9 s of the file's 14 s span.
2. **`bin/bench.ts` gained a field and a function and prints nothing new.** Its stdout is
   byte-identical on every arm, which is why nothing that reads it moved.
3. **The partial-owner arm depends on `JobSpec.admit`'s headroom tally.** If owner ruling
   D2's cross-shard bound is ever removed, this arm stops being a partial owner and the case
   fails loudly rather than silently — the shard would land and `thin.covered` would read 2.
4. **No field says *why* an owner is missing.** 20-08 recorded this and it is visible here:
   `missing` reads the same word for the stopped owner and for the saturated one, and the
   two arms are told apart only by `JobResult.shards`. Deriving a reason remains a new
   decision.

---

## Deferred / found, not closed here

- **`requirements-ledger.node.test.ts`'s three unnarrowed cases** — the finding above. Its
  docblock's stated reason is false and the fix is a decision about the union rule.
- **CHURN-05's checkbox is NOT ticked, and neither is DATA-01 touched.** This plan closes
  the *live reading* half; `.planning/REQUIREMENTS.md` is outside its declared file list and
  its CHURN-05 row is still the stale *"runResilient has no caller; submitJob … does not
  speculate or re-dispatch"* 20-08 flagged. Ticking it here would be widening what counts as
  passing.
- **The CLI has a coverage renderer no rung exercises.** That is the decision, argued at the
  call site — but it means the *rendering* half of `describeCoverage` on the CLI is held by
  a plant and by the process fixture, never by a green run of the driver. What would change
  it is a sovereign rung in the sweep, which `bin/bench.ts:455` already records a decision
  against: it would change what the published curves measure.
- **`unexpected` still has no reachable reading**, unchanged from 20-08.

## Known Stubs

None. Every value read here is produced by a live job over spawned processes, and the one
constructed value — the fixture's `AdmissionControl` — is a production interface answering
with figures the file states and then reads back off the offers it recorded.

## TDD Gate Compliance

The plan marks Task 1 `tdd="true"`. **There is no `test(...)` RED commit before the
implementation**, and retro-fitting one would be a fiction — the same position 20-01, 20-07,
20-08 and 20-09 each recorded. What stands in its place is what the plan actually asked
for: **six defects planted, each watched going red with its output pasted above, each
restored with `cmp` exit `0` recorded**, plus one plan-specified plant reported as reddening
the wrong assertion (and the assertion *moved*), one plan-specified plant measured **green**
and reported as a false claim rather than dropped, and one plan-specified fixture
arrangement **run and measured to destroy the control** rather than argued away.

## Commits

| Commit | What |
|---|---|
| `af305c7` | `feat(20-10)` — the driver renders a denominator only where a job has owners |
| `e76f969` | `test(20-10)` — a cross-owner job says how many owners are behind its answer |
| `5442667` | `docs(20-10)` — record the arrangement that was tried and destroys the control |

Committed with **explicit paths** (`git commit … -- <path>`) and verified with
`git show --stat`: one file each, only my own, on a shared index that held another agent's
staged deletion throughout. `git commit -F -` was not used. `O2_SKIP_GUARDS=1` **was** used,
on all three, for the reason recorded above and written into each message.

## Self-Check: PASSED

- `packages/node/src/coverage-agents.node.test.ts` — FOUND
- `packages/node/src/bin/bench.ts` — FOUND
- `.planning/phases/phase-20-single-job-path-ledger-churn-resilience/20-10-SUMMARY.md` — FOUND
- commits `af305c7`, `e76f969`, `5442667` — all FOUND in `git log`
