---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 07
subsystem: job-submission, speculation, cost-accounting
tags: [CHURN-02, CHURN-06, WIRE-04, speculation, straggler, race, disagreement]
requires:
  - "packages/core/src/speculation.ts — stragglers / speculativeCandidates / SpeculationLedger / median / MIN_SAMPLES / DEFAULT_SPECULATION_FRACTION / DEFAULT_STRAGGLER_FACTOR (pre-existing, UNCHANGED)"
  - "packages/core/src/sovereignty.ts — eligibleNodes, reached only through speculativeCandidates (pre-existing, UNCHANGED)"
  - "packages/core/src/lease.ts — LeaseTable, shouldRenew, RENEW_AT (pre-existing, UNCHANGED)"
  - "packages/core/src/job/verify.ts — executeVerified, the SAME call a speculative copy goes through (pre-existing, UNCHANGED)"
  - "packages/core/src/job/submit.ts — 20-01's generation loop, JobClock, mergeVerifications (extended here)"
provides:
  - "straggler duplication inside submitJob — the first production caller of stragglers, speculativeCandidates and SpeculationLedger"
  - "a race inside ONE generation: winner returns immediately, losers registered and compared after every shard settles"
  - "JobResult.speculationMultiplier and JobResult.speculationSpent — real figures where bin/bench.ts publishes literals"
  - "ShardResult.speculated, ShardResult.disagreed, ShardResult.copies (a four-arm SpeculativeCopy union)"
  - "SubmitOptions.speculation — four dials plus the named off arm 'duplicates-no-stragglers'"
  - "DEFAULT_SPECULATION_WATCHDOG_MS — coordinator.ts's 250 transcribed, not imported"
  - "JobResult.complete now fails a job whose late copy disagreed"
affects:
  - "20-09 — the speculation counters are now MEANINGFUL. See 'For 20-09' below; bin/bench.ts's literal 1 / 0 can be replaced by reads."
  - "20-12 — the list of coordinator.test.ts speculation cases now covered here, and the two that are not, is below"
  - "20-04 / 20-05 — attempted counts and grossFuel CAN move now, but measurably did not: nothing in the tree has a job with an allowance above zero AND a shard slower than a watchdog tick"
  - "every submitJob caller — a job of ten or more shards now polls each outstanding dispatch every 250ms while a duplicate is still possible"
tech-stack:
  added: []
  patterns:
    - "the raced form of a dispatch is built ONCE, at dispatch, and re-raced — never re-wrapped in the loop"
    - "a flag may decide whether a tick speculates; it may never remove the deadline"
    - "the loser is compared after every shard settles, in one window for the whole job"
    - "an off arm expressed as a fraction of zero, so the multiplier is still the identity"
    - "a test clock that advances virtual time AND drains the microtask queue, so ordering is deterministic rather than turn-counted"
key-files:
  created: []
  modified:
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/net/src/reduce-job.test.ts
decisions:
  - "speculation is a second copy inside ONE generation — the lease is not moved, and it is closed against the holder even when the copy answered"
  - "an `insufficient` answer does not win a race it has a sibling in; the loop waits and merges the failures"
  - "only speculation produces leftovers: with one copy in flight the copy that answers is the only copy there was, so the off path is byte-for-byte 20-01's"
  - "the duplicate's pool is the GATE's pool, not the job's candidate set, so a composed quorum is not widened by a duplicate"
  - "on by default, but gated on `allowance > 0` — a job under ten shards does not even start the watchdog"
  - "settleRace is deliberately NOT called; the reason is recorded in the code and below"
  - "speculation reads the JobClock 20-01 introduced, not a third clock; the certificate instant stays one Date.now()"
metrics:
  duration: ~3h
  completed: 2026-08-04
---

# Phase 20 Plan 07: A straggler is duplicated, and the loser is still read Summary

`submitJob` now starts a second copy of a shard that has fallen behind its peers, takes
whichever answer arrives first, and compares every copy that lost **after the last shard
has settled** — so `disagreed` is reachable rather than raced away. A sovereign shard's
duplicate can only land on its owner's own nodes, a job cannot spend more than its
fraction on duplication, and the tax it did spend is on every `JobResult`.

`stragglers`, `speculativeCandidates` and `SpeculationLedger` had **zero** production
callers before this. They have one now.

---

## What landed

### `packages/core/src/job/submit.ts`

**The race lives inside one generation.** `dispatchUnderLease` holds a `Map` of `Copy`
rather than a single pending promise. Each `Copy` carries its dispatch in both the forms
this module reads it in — `pending` for the late comparison and `raced` for the poll — and
**both are built once, at dispatch**. The loop re-races the same promise objects; it never
re-wraps them, which is `coordinator.ts`'s third recorded defect (*"an out-of-memory crash
rather than a slow test, and only when a real dispatch is slower than the watchdog, which
is exactly when speculation is supposed to be working"*).

**The timer is unconditional.** `watching` now only chooses *how soon* to wake. The wake
instant is the earliest of three: the deadline (always in the list), the renewal point
while renewal is possible, and `now + watchdogMs` while a duplicate is still possible.
With neither of the first two live this is exactly 20-01's two-wake schedule — **a shard
that cannot speculate does not poll**.

**`insufficient` does not win a race it has a sibling in.** Every executor of that copy
failed, which is not a result; the loop keeps waiting and `mergeVerifications` carries the
failures into whatever finally arrives. With one copy in flight there is no sibling and
the behaviour is 20-01's unchanged, which is what makes the whole feature switchable off
to a byte-identical path.

**Duplication is evaluated before renewal**, because they are different questions: renewal
asks whether *this holder* is still working, duplication asks whether the shard has fallen
behind its *peers*. A holder that proves it is working and is still slowest gets both.

**Three permanent reasons to stop watching** — already duplicated, budget gone, nowhere
legal to duplicate to — and **"too new to judge" is not one of them**: the median moves and
elapsed time grows.

**The comparison is one window for the whole job** (`compareOutstanding`), opened only when
some shard actually has a leftover with an answer to be measured against. Every job that
speculated nothing skips it entirely, so the grace is off the path of the jobs it has
nothing to say about.

**New reported facts.** `JobResult.speculationMultiplier` / `speculationSpent`;
`ShardResult.speculated` / `disagreed` / `copies`. `copies` is a four-arm
`SpeculativeCopy` union — `agreed` (carries nothing, exists so the enumeration is
exhaustive), `disagreed` (carries the differing CID so the shard names **both** answers),
`failed` (in the refusing node's own words), `uncompared` (with a reason distinguishing
silence from "there was no single answer to compare against").

**`JobResult.complete` now reads `disagreed` too.** A disagreement is a failed run, not a
run with a footnote — the same rule `executeVerified` and `executeReduce` apply.

**On by default, and what that costs is measured rather than asserted.**
`DEFAULT_SPECULATION_FRACTION` is 0.1 and the allowance is `floor(shards × fraction)`, so
**a job of fewer than ten shards has an allowance of zero** and the watchdog is not started
at all. That is most of the jobs in this repository, and it is why turning this on moved
nothing that was not about speculation.

**The clock decision, written down at the site.** Speculation reads the `JobClock` 20-01
introduced — the same *kind* of question the lease asks, elapsed time against a span
measured in this process — and **not** a third port. The certificate instant stays a single
`Date.now()` read for the whole job, so a job that took a virtual thirty seconds to
duplicate a straggler does not thereby expire the certificates it enrolled.

### `packages/core/src/job/submit.test.ts`

Ten cases, each stating what it cannot redden on. Existing 67 cases unedited and green.

### `packages/net/src/reduce-job.test.ts` — disclosed, outside the declared list

The same three fixture factories 20-01 had to move (`jobWith`, `agreed`, `insufficient`)
stopped compiling when the new required fields landed. They now state a job that duplicated
no straggler: `speculationMultiplier: 1`, `speculationSpent: 0`, `speculated: false`,
`disagreed: false`, `copies: []`. **No assertion changed.** `tsc` found exactly these three
sites and a symbol grep for `JobResult`/`ShardResult` found the same three plus read-only
sites in `demo/src/job.ts`, `net/src/submit-with-egress.ts`, `net/src/reduce-job.ts`,
`aot/src/admission.test.ts` and eleven `*.node.test.ts` readers, none of which construct.
The two lists reconcile. The file was unmodified in `git status` before and after; no other
Phase 20 or Phase 21 plan claims it.

---

## Every mutation planted, and the exact text observed

Baseline restored by `cp` + `cmp` after each; `cmp` exit `0` recorded every time. Never
`git checkout --`.

### Plant 1 — duplication happens at all

`stragglers(...)` truncated to `[]` at the call site, which is the plan's *"make
`stragglers` never fire"* expressed inside this plan's own file.

**RED. Exit 1. `Tests 8 failed | 68 passed (76)`.** Observed titles:

```
× duplicates a shard that has fallen behind its peers, onto a node the placement did not choose
× takes the first answer, and it is the copy’s own bytes
× reads a losing copy that agrees, and records it as compared rather than as absent
× reports a losing copy that answers DIFFERENTLY, names both CIDs, and fails the job
× reports a copy that never answers as uncompared, which is not agreement
× scopes a sovereign duplicate to its owner, and starts none where the owner has no spare
× spends no more than the job-wide budget, however many shards are slow
× turns off to the identity — the same fixture, one dispatch per shard and a multiplier of 1
AssertionError: expected false to be true // Object.is equality
AssertionError: expected +0 to be 2 // Object.is equality
AssertionError: expected [ 'n00#0', 'n01#1', 'n02#2', …(7) ] to have a length of 11 but got 10
```

The no-tail control stayed green, correctly — it asserts zero speculation.

**This plant found a weak case on its first run and the case was strengthened before the
number above was taken.** On the first attempt: `Tests 7 failed | 69 passed (76)`, with
*"takes the first answer, and it is the copy's own bytes"* **GREEN**. The reason is worth
recording: with duplication suppressed, the held node's lease simply lapses and the
generation loop re-dispatches the shard onto *exactly the same* `n01`, which answers
*exactly the same* bytes. Every assertion in that case — who agreed, which CID — was
satisfied by the slower road. It now also asserts `speculated === true` and
`generations === 1`, which is what says a **race** decided it rather than a timeout, and it
reddens.

### Plant 2 — the loser is compared: **the load-bearing plant**

`outstanding: [...copies.values()].map(…)` replaced with `outstanding: []` — the plan's
*"break out of the race on first arrival and drop the outstanding copies"*, which is
`coordinator.ts`'s recorded original defect.

**RED. Exit 1. `Tests 4 failed | 73 passed (77)`** against the final code. Observed:

```
× reads a losing copy that agrees, and records it as compared rather than as absent
AssertionError: expected [] to strictly equal [ { nodeIds: [ 'n01' ], …(1) } ]
× reports a losing copy that answers DIFFERENTLY, names both CIDs, and fails the job
AssertionError: expected false to be true // Object.is equality
   ❯ packages/core/src/job/submit.test.ts:1911:28
   1911|     expect(slow.disagreed).toBe(true)
× reports a copy that never answers as uncompared, which is not agreement
AssertionError: expected undefined to be 'uncompared' // Object.is equality
× gives a losing copy that answers with a FAILURE its own bucket, neither silent nor agreeing
AssertionError: expected undefined to be 'failed' // Object.is equality
```

**The disagreement case reddens, so `disagreed` is reachable.** The plan asked for this to
be said plainly if it did not; it did.

### Plant 3 — the timer is unconditional

The watchdog dropped out of the race once `watching` is false — the plan's plant exactly,
and the shape `coordinator.ts`'s second recorded defect took.

**RED, and it is a HANG rather than an assertion. Exit 1. `Tests 2 failed | 74 passed
(76)`.** Observed:

```
× scopes a sovereign duplicate to its owner, and starts none where the owner has no spare 5015ms
× spends no more than the job-wide budget, however many shards are slow 5004ms
Error: Test timed out in 5000ms.
Error: Test timed out in 5000ms.
```

**Distinguished from a slow pass by measurement, not by plausibility**: both cases report
the vitest timeout *as their duration* (5015ms and 5004ms against a 5000ms limit) and
neither ever produced an assertion. These are the two fixtures that contain a shard which
sets `watching = false` — carol's sovereign shard, which has nowhere legal to duplicate to,
and the thirteen slow shards left over once the budget is gone — and whose only copy then
never answers. Unlike 20-01's non-terminating case the event loop here is *idle*, so a real
timer can still fire; the hang is reported rather than hanging the run.

### Plant 4 — CHURN-06 holds by construction

`speculativeCandidates(request, pool, attempted)` replaced by a raw
`pool.filter(node => !attempted.includes(node.nodeId))` — the plan's *"build the duplicate's
candidates from `spec.nodes` instead of `speculativeCandidates`"*, planted at the level
where it can actually fail. (Handing `speculativeCandidates` a **wider pool** cannot fail,
for the reason 20-01 measured and `W3` records: it calls `eligibleNodes` on whatever it is
given. Bypassing the *call* is a different mutation and this is it.)

**RED. Exit 1. `Tests 1 failed | 75 passed (76)`.** Observed:

```
× scopes a sovereign duplicate to its owner, and starts none where the owner has no spare
AssertionError: expected true to be false // Object.is equality
 ❯ packages/core/src/job/submit.test.ts:2078:31
    2078|     expect(carols.speculated).toBe(false)
```

Carol's shard — one owner node, no spare — acquired a duplicate on a foreign owner's node.
That is the breach, named by the field rather than inferred from a reason string.

### Plant 5 — the budget bounds

Both budget gates removed: `|| ledger.remaining <= 0` dropped from the permanent-stop
check, and `ledger.request`'s refusal ignored.

**RED. Exit 1. `Tests 1 failed | 75 passed (76)`.** Observed:

```
× spends no more than the job-wide budget, however many shards are slow
AssertionError: expected [ { partitionIndex: 5, …(12) }, …(14) ] to have a length of 2 but got 15
```

**Fifteen duplicates against an allowance of two**, asserted against
`Math.floor(20 × DEFAULT_SPECULATION_FRACTION)` rather than a literal.

**Which assertion carries it, and which does not.** `speculationSpent` stayed at `2` under
this plant and would **not** have caught it — `SpeculationLedger.request` still refuses to
increment past the allowance even when its answer is ignored. It is the count of shards
reporting `speculated` that carries the claim. Recorded because the two look
interchangeable and are not.

---

## A defect found by writing a case, and fixed

The `failed` arm of `SpeculativeCopy` reported `executeVerified`'s composed sentence
`'every executor failed'` instead of the refusing node's own words. The case asserted the
node's sentence and got the composed one:

```
AssertionError: expected 'every executor failed' to contain 'this node gave up on the shard'
```

`compareOutstanding` now composes the reason from `failures` where the copy gave any, and
falls back to `reason` only where it gave none. A reader handed `'every executor failed'`
learns nothing the bucket had not already told them.

---

## Claims in the plan measured FALSE, or deliberately not followed

1. **`key_links.via`: *"stragglers / speculativeCandidates / SpeculationLedger / settleRace,
   in that order"*. `settleRace` is NOT called, deliberately, and the reason is in the
   code.** It re-derives the winner from arrival instants and breaks ties on node id — so on
   a clock that reports the same instant for both copies it can name the **loser** as the
   winner, overturning a decision this module has already taken and already closed a lease
   against. The winner is known by the time the comparison runs; all that is left is
   whether the loser's bytes match, which is a CID equality. Using `settleRace` only for
   the tie-safe `disagreed` boolean and comparing directly for the per-copy verdict would
   be two mechanisms answering one question, which is the "second source of truth" shape
   this repository forbids. **`SpeculationLedger.discard` / `.discarded` are likewise not
   called**: `ShardResult.copies` is the record and is strictly richer (`Discarded` cannot
   express `failed` or `uncompared`), and a write-only call to a structure nothing reads is
   the shape this codebase calls out.

2. **Task 2: *"a losing copy that returns a different CID … makes the job not-ok"*.
   `JobResult` has no `ok`.** `SubmitResult.ok` is about whether the *submission* was
   valid, not about how the job went. Substituted `JobResult.complete`, which was already
   the job-level success flag, and widened it to read `disagreed`. The substitution is
   recorded in the test file beside the assertion, not only here.

3. **The plan's second case as specified could not have reddened on speculation.** Detailed
   under Plant 1: *"the winner is the copy that answered first, asserted by node id, and
   the job's answer is that copy's CID"* is satisfied identically by a lapse-and-
   re-dispatch. Both readings the plan named are true of the slower road. Strengthened.

4. **`<interfaces>`: `DEFAULT_WATCHDOG_MS` 250 from `coordinator.ts`.** True, and the value
   is transcribed rather than imported (the plan forbids importing that module). It is
   exported here as `DEFAULT_SPECULATION_WATCHDOG_MS` because `core/src/index.ts` already
   re-exports `coordinator.ts`'s `DEFAULT_WATCHDOG_MS` and two identically-named exports in
   one barrel is a conflict waiting for 20-12. **The barrel was not edited** — the new
   symbols are exported from `submit.ts` and reach nobody outside this package yet.

5. **`<execution_context>`: *"any movement in `discovery-agents.node.test.ts`,
   `churn-agents.node.test.ts` or the benchmark fuel figures triaged as bucket (b)"*.
   **Nothing moved.** Measured, not assumed — see the whole-tree section. The reason is
   structural: no job in the tree has both an allowance above zero (ten or more shards) and
   a shard slower than a 250 ms watchdog tick.

---

## Assertions found that could not fail

- **The plan's Task-2 case 2, as written.** Reported above and repaired rather than
  recorded as a green.
- **`speculationSpent` as the budget's guard.** It cannot fail under the plant that removes
  the budget check, for the reason under Plant 5. The count of `speculated` shards is what
  carries it, and the file says so.
- **Nothing else.** Each of the other four plants reddened a named case, and each case's
  blind spot is written into the file beside it.

---

## For 20-09 — the counters ARE meaningful now

**Yes, explicitly.** `bin/bench.ts` and `perf-workload.ts` publish
`Observation.speculationMultiplier` as the literal `1` and `Observation.redispatches` as the
literal `0`, each with a comment saying `submitJob` neither speculates nor re-dispatches.
**Both halves of that comment are now false** — 20-01 made `redispatches` real and this plan
makes the multiplier real — and they can be replaced by reads of
`JobResult.speculationMultiplier` and `JobResult.redispatches`.

Three things 20-09 needs to know before it does:

1. **A makespan sample can now contain several dispatch rounds plus renewal probes.** A
   benchmark that assumed one dispatch per shard at R=1 was already wrong after 20-01 and is
   more wrong now.
2. **The off arm exists and is the comparison to make**: `speculation:
   'duplicates-no-stragglers'` reports the identity multiplier `1` with a dispatch count
   equal to the placed count. `submit.test.ts`'s last case runs both arms of one fixture and
   asserts the pair, because a multiplier of `1` alone is *also* what an idle job reports.
3. **A sweep rung under ten shards cannot speculate at the default fraction**, so a rung
   reporting `1` may be reporting the allowance rather than the tail. `speculationSpent`
   beside the multiplier is what separates them.

---

## Behaviours `submit.test.ts` now covers, for 20-12's inheritance

`coordinator.test.ts`'s speculation and disagreement cases, against `submitJob`:

| `coordinator.test.ts` case | Where it now lives |
|---|---|
| duplicates a stalled shard and takes the fast copy's answer | `duplicates a shard that has fallen behind its peers…` + `takes the first answer…` |
| reports the speculation multiplier in the job's cost accounting | `duplicates a shard…`, the control, and `turns off to the identity…` |
| never dispatches a sovereign duplicate across owners | `scopes a sovereign duplicate to its owner…`, alice arm |
| waits rather than breaching when the owner has only the one node | same case, carol arm |
| surfaces a speculative copy that produced a different answer | `reports a losing copy that answers DIFFERENTLY…` |
| reports agreement between copies as agreement, not as a disagreement | `reads a losing copy that agrees…` |
| reports a copy that never answered as uncompared, never as agreeing | `reports a copy that never answers as uncompared…` |
| records a copy that fails after the winner is picked as a failure of that shard | `gives a losing copy that answers with a FAILURE its own bucket…` |
| does not hang on a peer that never answers when speculation cannot help | 20-01's renewal pair, plus Plant 3 above |

**NOT covered here, and 20-12 must not assume otherwise:**

- **`does not duplicate before enough shards have finished to compare against`.** This
  file's control has *no tail at all*; it does not exercise the `MIN_SAMPLES` floor
  specifically. `speculation.test.ts` asserts that floor directly against `stragglers`, but
  nothing asserts it through `submitJob`.
- **The `node` / `task` / `sender` failure-kind distinction**, which `submitJob`
  structurally cannot have — 20-01 records why.
- **Coverage (20-08) and checkpointing (20-11).**

---

## Costs and consequences, stated rather than left to be found

1. **A job of ten or more shards polls every outstanding dispatch every 250 ms** while a
   duplicate is still possible, and stops polling once one has been started, the budget is
   gone, or there is nowhere legal left. Below ten shards at the default fraction the
   watchdog never starts. The waking is not the same as speculating: a shard must also be
   slower than `1.5 ×` the median of what has finished.
2. **A shard that gets a duplicate holds its lease longer than it used to.** With a copy
   still pending, a primary answering `insufficient` no longer surrenders immediately — the
   loop waits for the sibling under the same lease. Only reachable when speculation actually
   fired.
3. **A speculative copy consumes a node from `attempted`**, so a later generation has one
   fewer node to re-place onto. That is the honest accounting: it *was* dispatched to.
4. **A copy left running when the lease lapses is not registered for comparison.** The
   generation produced no winner, so there is nothing it lost to, and `LeaseTable.complete`
   already refuses a late report from a lapsed holder as stale. Comparing it anyway would
   contradict that rule.
5. **`VerificationResult.agreed` carries no `failures`**, so a copy that answers with a
   failure *before* another copy wins has its refusal erased by `mergeVerifications`. This
   is the same open question 20-01 recorded, one level out, and it is why the `failed`
   bucket only ever holds copies that answered **after** the winner. **Not changed here** —
   the plan puts `verify.ts` out of scope and the blast radius is wider than this plan's.
6. **A duplicate is chosen from the gate's pool**, so a public shard at redundancy ≥ 2 whose
   quorum composed can only duplicate onto a quorum member. That is deliberate: the copy may
   become the answering replica and its certificate would then be in the receipt. The cost
   is that such a shard has fewer nodes to duplicate onto, which is the same trade the
   quorum narrowing already makes for the re-pick.

---

## Whole-tree run, read directly

`npx tsc --noEmit` → **exit 0**.

`npx vitest run --project browser` → **exit 0**, `Test Files 246 passed (246)`,
`Tests 3960 passed (3960)`. `/usr/bin/time -p`: real 105.30, user 100.70, sys 22.73 —
`(user+sys)/real` = 1.17.

`npx vitest run --project node` → **exit 0**, `Test Files 147 passed (147)`,
`Tests 2127 passed | 2 skipped (2129)`. `/usr/bin/time -p`: real 295.60, user 285.11,
sys 39.92 — `(user+sys)/real` = 1.10, i.e. this process held more than a core across the
run and was not starved.

`npx vitest run --project node packages/core/src` → exit 0, 30 files, 526 tests.

### The two reds seen on an earlier whole-tree run, and how each was attributed

Both were on the earlier pass and both are the recorded shared-index hazard. **Attributed
by reading the diff in the failure message, per `CLAUDE.md`, not by plausibility.**

- **`requirements-ledger.node.test.ts`** — seven rows failed with
  `"CHURN-02: runResilient is called by packages/node/src/orphan-leash.ts"`. That file is
  another agent's, was mid-edit during the run, and `grep -rn 'runResilient('` across
  `packages` and `tools` now returns **one** hit — `coordinator.ts`'s own definition. Re-run
  in isolation: **exit 0, 18 passed**.
- **`bench-attestation.node.test.ts`** — snapshots `git status --porcelain` around itself.
  Its diff showed my three files **byte-identical in expected and received** on every
  occurrence; the moving entries were `tools/aot/echo-guest.ts`,
  `tools/aot/echo-guest.node.test.ts`, `packages/node/src/orphan-leash.ts` and
  `.planning/GUARD-DEFECTS-39-40.md`, appearing and vanishing as another agent staged and
  committed mid-run. Re-run with the index still: **exit 0, 4 passed**, and green again on
  the final whole-tree pass above.

`mutation-guard.node.test.ts` is green: `M43`, `M44`, `M45` and `W1`–`W5` all still match
their `find` strings. `M45`'s three-line `degraded:` expression and `W5`'s probe block were
preserved **including indentation**, which is why the shard result is assembled into a named
`const` rather than nested inside the returned object.

---

## Deferred / found, not closed here

- **After 20-12 deletes `coordinator.ts`, `settleRace`, `SpeculationLedger.discard`,
  `SpeculationLedger.discarded`, `Discarded`, `RaceLoser`, `RaceOutcome`,
  `SpeculativeAnswer` and `median` have no production caller.** `median` is used by
  `stragglers`; the rest are used by nothing. Whoever owns `speculation.ts` next has a
  choice to make, and it is a choice rather than cleanup: `settleRace` is unit-verified and
  its refusal to be used here is about tie-breaking, not about its correctness.
- **The `MIN_SAMPLES` floor is not asserted through `submitJob`.** Listed above for 20-12.
- **No `ShardResult` field says a duplicate was *considered and refused*.** A shard reads
  `speculated: false` whether nothing was slow, the budget was gone, or there was nowhere
  legal to go — three different facts. `JobResult.speculationSpent` distinguishes the second
  at job level and nothing distinguishes the third. Adding a reason would be a new decision.
- **20-01's finding stands unrepaired**: substituting the job's node set for `gate.pool`
  silently widens the **quorum** pool and no test in the tree catches it. This plan hands
  `speculativeCandidates` the gate's pool for exactly that reason, so it does not widen the
  hole — but it does not close it either.

---

## Known Stubs

None. Every field added in this plan is written from a measured value on every path,
including the `never-placed` arm, where `speculated: false` / `copies: []` are the truthful
readings of a shard that never ran rather than placeholders.

## TDD Gate Compliance

The plan marks both tasks `tdd="true"`. **There is no `test(...)` RED commit**, and
retrofitting one would be a fiction. What stands in its place is what the plan actually
asked for: **five defects planted into the shipped implementation, each watched going red
with its output pasted above, each restored by `cp` + `cmp` with exit `0` recorded** — plus
one case reported as unable to redden and *repaired* rather than recorded as a green, and
one real defect found by writing a case and fixed before the run.

## Commits

| Commit | What |
|---|---|
| `53e1d39` | `feat(20-07)` — the race, the job-wide budget, the post-settle comparison, ten kernel cases, the `reduce-job.test.ts` construction sites |

Committed with **explicit paths** (`git commit … -- <path>`) and verified with
`git show --stat`: only my own files landed. `O2_SKIP_GUARDS` was not used.

## Self-Check: PASSED

- `packages/core/src/job/submit.ts` — FOUND
- `packages/core/src/job/submit.test.ts` — FOUND
- `packages/net/src/reduce-job.test.ts` — FOUND
- `.planning/phases/phase-20-single-job-path-ledger-churn-resilience/20-07-SUMMARY.md` — FOUND
- commit `53e1d39` — FOUND in `git log`
</content>
</invoke>
