---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 04
subsystem: job-submission, placement, discovery-agents-spec
tags: [SCHED-06, WIRE-04, criterion-2b, re-pick, generation-cap, retrospective-summary]

status: code-landed-never-self-reported
summary_authorship: >-
  RETROSPECTIVE. Written 2026-08-04 by a different agent, from the committed diff and from
  `18-VERIFICATION.md`'s second amendment. The executor was terminated mid-flight by a weekly
  API usage limit before it wrote anything — no summary, no plant record, no exit codes.
  Nothing below is taken from the plan's intent; where the evidence is silent this file says so.
executor_outcome: >-
  Killed at ~12:08 PDT 2026-08-04 by a weekly API limit. It died BETWEEN PLANTING AND RESTORING
  and left `PLANT 20-04-C` live in `packages/core/src/job/submit.ts`, which had removed the only
  bound on the re-dispatch loop. Recovered, restored and verified by the salvage pass; recorded
  in `9acd85f`'s message and in `.planning/.continue-here.md`.

requires:
  - "packages/core/src/job/submit.ts — the generation loop, `placeAgain`, `collectedRejections`, `mergeVerifications`, `maxGenerations`. Landed by 20-01, READ HERE AND NOT MODIFIED"
  - "packages/core/src/lease.ts — `DEFAULT_MAX_GENERATIONS` (3), imported by the spec rather than restated (pre-existing, UNCHANGED)"
  - "packages/core/src/placement.ts — `LocalCapacity.#decide`, the single composer of `over-committed: N of M slots in use` (pre-existing, UNCHANGED)"
  - "packages/core/src/sovereignty.ts — `planPlacement`, called by the spec to derive which node production places first (pre-existing, UNCHANGED)"
provides:
  - "Phase 18 criterion 2b clause 2 as a BEHAVIOUR rather than an absence — the armed tripwire inverted and closed; Phase 18 moves 8/9 → 9/9"
  - "`discovery-agents.node.test.ts` › `re-picks past a node genuinely at its slot limit, on the production submit path` — a shard whose SELECTED executor refuses at exec reaches a second executor and agrees, across real spawned `bin/agent.ts` processes"
  - "`discovery-agents.node.test.ts` › `criterion 2, bounded — a fabric with no free node, and the control that had one` — the re-pick stops at `DEFAULT_MAX_GENERATIONS` naming every refusal, with a one-node-free control in the same run"
  - "a MEASURED answer to the plan's open question about `shard.rejections`: still placement-stage only, but now TWO entries because a second placement runs"
  - "a measured NEGATIVE: must-have 2 is unreachable at the type level, recorded in the landed test's own words"
affects:
  - "Phase 18 — criterion 2b MET, phase closes 9/9 (`18-VERIFICATION.md`, second amendment, 2026-08-04T19:20Z)"
  - "20-09 — speculation moves `attempted`, and this file asserts that count exactly; the landed test says so at the case"
  - "20-13 — owed the plant record this plan never wrote, and owed the mutation-ledger rows nobody added"
  - "packages/node/src/admission.node.test.ts — its `unmeasured on every path that runs in production` comment is now FALSE and was NOT corrected. Still live. See Outstanding."

tech-stack:
  added: []
  patterns:
    - "the bound is read against the exported constant `DEFAULT_MAX_GENERATIONS`, never a literal, so a cap that moved moves both sides together"
    - "a fabric strictly LARGER than the cap, asserted as a precondition — otherwise `stopped at the cap` and `ran out of untried nodes` are the same reading"
    - "a NAMED untried node, because `fewer than the fabric size` is free in any fabric larger than the cap"
    - "the per-node failure list compared element-by-element against `attempted` rather than counted, so a retry that reported only its last attempt cannot satisfy it"
    - "the lease trail read as an ordered `kind:nodeId` list, substituted for a `failures` field the union does not have — and the substitution named in the file"

key-files:
  created: []
  modified:
    - packages/node/src/discovery-agents.node.test.ts

decisions:
  - "must-have 2 was NOT met and the landed test says so in its own words rather than asserting a field the union does not have — a lease-history reading was substituted"
  - "the fixture's fifth agent E was promoted to a fourth one-slot executor so the fabric is strictly larger than the generation cap; the file argues the change is inert for criterion 1"
  - "the bounded case supplies NO `JobSpec.admit`, which is what makes every refusal it reads an exec-stage refusal — proved by `rejections` being empty"
  - "the exact list `attempted === [victim, answering]` is asserted rather than `toBeGreaterThan(0)`, which a loop re-dispatching unconditionally would satisfy"

requirements-completed: []   # REQUIREMENTS.md was NOT updated — see Outstanding

metrics:
  duration: unknown — the executor was terminated before reporting
  completed: 2026-08-04 (code); summary written retrospectively 2026-08-04
---

# Phase 20 Plan 04: The Armed Tripwire Inverts — Summary (retrospective)

> **Read this line first.** This plan is **complete in code and was never self-reported.** Its
> executor was killed by a weekly API usage limit before it wrote a summary, a plant table, or a
> single exit code. Everything below is derived from the committed diff (`9acd85f`), from the
> commit messages of the salvage pass, and from `18-VERIFICATION.md`'s independent second
> amendment. **No plant table, no observed failure text and no measured span from this executor
> exists, and none is invented here.** Where a claim would have to come from the executor's own
> reporting, this file says *not recorded*.

**Phase 18's criterion 2b closed.** A shard whose *selected* executor refuses at `exec` now
reaches a second executor and agrees, measured across real spawned `bin/agent.ts` processes on
the production `submitJob` path — and the re-pick is bounded by `DEFAULT_MAX_GENERATIONS` with
every refusal named per node. **And the plan fell short of one of its own must-haves; the landed
test says so in its own words**, which is the most useful thing in this summary.

## What landed

One file, one commit.

| file | change | commit |
|---|---|---|
| `packages/node/src/discovery-agents.node.test.ts` | +400 / −54 (net +346) | `9acd85f` |

`9acd85f` is a **salvage commit**, not this plan's own. It carries three executors' work and its
message states in terms that none of them is scoreable. It was made with `O2_SKIP_GUARDS=1`,
stated in the message, because the guards cannot pass on a wave whose ledger rows and
requirements updates live in summaries that were never written.

Nothing else in the tree is this plan's. `packages/core/src/job/submit.ts` is at 20-01's
committed state.

## Asked vs delivered

| # | Plan must-have | Delivered? |
|---|---|---|
| 1 | A shard whose SELECTED executor refuses at exec reaches a second executor and agrees | **YES** |
| 2 | The re-pick does not erase the first executor's named refusal from the shard's `failures` | **NO — unreachable at the type level. Substituted, and the substitution is named in the file.** |
| 3 | The re-pick is bounded; a fabric where every node refuses ends `insufficient` naming each refusal | **YES** |
| 4 | Not vacuous in either direction — the refuser was chosen, the answerer is a different node | **YES** |

### Must-have 1 and 4 — `re-picks past a node genuinely at its slot limit, on the production submit path`

The old case's `stalled` binding became `repicked`, and the assertions inverted. What the case
now reads, in order:

- `repickedShard.attempted[0] === victim` and `repickedShard.rejections` does not contain the
  victim — the refusing node was the one placement chose, and it appears in no placement-stage
  rejection because it *accepted* its offer.
- `repickedShard.verification.status === 'agreed'`, `repicked.job.complete === true`, and the
  agreeing set does not contain the victim.
- `repickedShard.attempted` is exactly `[victim, answering]` — both halves of non-vacuity in one
  statement.
- `repickedShard.generations === 2`, `repicked.job.redispatches === 1`,
  `repickedShard.ending === 'agreed'`, `repickedShard.degraded === false`. The file states why an
  exact count and not `toBeGreaterThan(0)`: the latter is satisfied by a loop that re-dispatches
  unconditionally, which is the thing a bounded re-pick is not.

The mechanism the case leans on is unchanged from Phase 18's: `admitThenSaturate` lets the node
accept the offer, then occupies it with a real long-running `exec`, then polls `untilFull` until
**the node itself** says it is full, so the dispatch meets a node genuinely at its limit. The
shard carries `EXEC_STAGE_VALUE`, a slot key distinct from the occupying task's, so the refusal
is the over-committed one and not the duplicate-in-flight one.

The comments were rewritten with the case, as the plan required. The paragraph beginning *"This
is the assertion that inverts the day WIRE-04 lands"* is gone; what replaced it keeps one
sentence of the history (the clause was carried under RULING A, and the instrument it replaced
was confined to `{0,1}` at the type level) and adds the observed arrival text —
`expected 'agreed' to be 'insufficient'` — as the tripwire firing rather than a regression.

### Must-have 2 — NOT MET, and this is the finding

The plan asked that *"the refusal is still recorded: the re-pick does not erase the first
executor's named refusal from the shard's failures."* **It is erased, and the half erased is the
`over-committed` text.** The landed test says so at the assertion:

> *"It erases half of it, and the half it erases is the over-committed text."*

The reason is structural, not a gap in effort. `VerificationResult`'s `agreed` arm
(`packages/core/src/job/verify.ts`, search `export type VerificationResult`) declares
`resultCid`, `output`, `agreeing`, `replicas`, `grossFuel`, `usefulFuel` — **and no `failures`
field at all** — while `disagreed` and `insufficient` both have one. A shard that ends agreed has
nowhere to carry a previous generation's refusal text. `mergeVerifications` folds a failed
generation into a later agreement by keeping the winner. Asserting a `failures` entry there would
be asserting a field the union does not have.

**What was substituted, and it is named in the file rather than passed off:** the lease history.

```
granted:victim → surrendered:victim → granted:answering → completed:answering
```

asserted with `toStrictEqual` as an ordered list. This is CHURN-01's *"visible in the job history
rather than hidden"*, and it is the strongest true reading this tree supports today. The
independent verifier's second amendment checked the discriminator rather than taking it: in
`submit.ts`, `leases.surrender(...)` is reachable only on the `dispatched.kind === 'answered'`
arm — the lapse arm calls `leases.reap(...)` and produces a different event — so
`surrendered:${victim}` says the victim **answered with a failure**, not that it went quiet.

Recorded in `18-VERIFICATION.md` as an honest deviation that does **not** reduce criterion 2b,
which asks for the refusal and the re-pick, not for both in one `ShardResult`. It is Phase 20's
to settle.

### Must-have 3 — `criterion 2, bounded — a fabric with no free node, and the control that had one`

A new `describe` beside the first, one `it`, two arms in one run on one fixture.

- **The fabric is strictly larger than the cap, and that precondition is asserted**:
  `found.executors` has 4, and `found.executors.length > DEFAULT_MAX_GENERATIONS` (3). Without
  it, *stopped at the cap* and *ran out of untried nodes* would be the same reading and every
  assertion in the case would pass against a loop with no cap at all.
- **Arm one, the control**: every node but the first-placed one saturated. The shard agrees,
  `attempted === [spare]`, `generations === 1`, `redispatches === 0`, `ending === 'agreed'`.
- **Arm two**: the same submission with that last node saturated too. `insufficient`.
- **And it says why, per node**: `failures.map(nodeId)` is compared with `toStrictEqual` against
  `attempted` — element by element, in the order tried, not counted — and every `failure.reason`
  contains `over-committed: 1 of 1 slots in use`.
- **The bound is read, not inferred**: `attempted` has length `DEFAULT_MAX_GENERATIONS`,
  `generations === DEFAULT_MAX_GENERATIONS`, `redispatches === DEFAULT_MAX_GENERATIONS - 1`,
  `ending === 'generations-spent'`, and a **named untried node** remains — "fewer than the fabric
  size" is free in any fabric larger than the cap; a named untried node is not.
- `leaseHistory` carries exactly one `abandoned` event.
- `rejections` is `[]`, which is what makes the whole case an exec-stage reading: **no
  `JobSpec.admit` is supplied**, so no offer was ever made and every refusal it read came from
  `exec`.
- **The saturation is re-read after both arms ran** — an offer probe per node asserting
  `{slots: 1, inFlight: 1}` — because `MODULE_NEVER_RETURNS` is ended by the node's own task
  deadline and a slow run could otherwise have met a node that went free again and measured
  nothing while printing green.

## Deviations from the plan, found in the diff

### 1. The fixture was changed, and the plan said not to touch anything else

The plan's Task 1 `<action>` says **"Touch nothing else in this file."** `standUp` changed:
`enrol('e', 0x95, p2)` became `enrol('e', 0x95, p2, holderArgs)`, so E is now a holder and a
fourth one-slot executor. The file argues the change at the line: E was already seeded with both
blocks and differs from A/B/C only in its issuer; criterion 1 calls `standUp()` with no
arguments; and the case that passes `--max-concurrent-tasks 1` places only on A, B and C.

Whether that inertness was *measured* rather than argued is **not recorded**. What is known
independently: the whole node project passed at 2024 tests with one unrelated failure after this
landed, and an independent verifier re-ran the file on 2026-08-04 and reported no regression on
criterion 1.

### 2. The bounded case trusts the second issuer, in its own call only

To reach a fourth executor the case passes both `p.issuerKey` and `p2.issuerKey` into its own
`discoverCandidates` `trustedIssuers` set — never into the requestor's peer gate. The file states
that criterion 1's reading of the issuer gate is a different call with a different set and is
untouched.

### 3. The plan asked a question; the executor measured it

The plan's `<interfaces>` said of `shard.rejections`: *"Check whether 20-01 changed that … Measure
it; do not assume either way."* Measured, and recorded in the file: the field is **still filled
from placement-stage refusals only**, so an exec-stage refusal remains structurally invisible
there. What the generation loop changed is that a **second placement now runs** and its refusals
accumulate into the same list (`submit.ts`, search `collectedRejections`) — measured as **two
entries, both `busy`**, one per placement stage. The invariant is asserted first (every node in
`rejections` is one the shard never dispatched to) and the exact list second, with a note naming
`generations` as the assertion to consult if the count ever reads 1.

## What could NOT be determined from the evidence

These are gaps in the record, not gaps in the work. **Do not fill them by inference.**

- **No plant table exists.** Task 1 required two plants and Task 2 required three, with *"the
  observed failure text of both plants verbatim for 20-13."* **Not one line of observed failure
  text from this executor survives.**
- **One plant's identity is known; its result is not.** The salvage pass found `PLANT 20-04-C`
  live in `packages/core/src/job/submit.ts`: it *"replaced the `grant`-returns-null exit with a
  fabricated lease, removing the only bound on the re-dispatch loop."* That is, in substance,
  Task 2's first proof (*"remove the `grant`-returns-null exit from `submit.ts`'s loop. The
  saturated arm's attempt count must exceed the cap"*). **Whether it was ever run, and what
  attempt count it produced, is not recorded.** The plan explicitly said *"it looped" is not a
  measurement* — and no measurement exists.
- **The letter `C` suggests two earlier plants.** This repository letters plants A, B, C… within a
  plan (20-03 recorded A–F). That is a convention, not a measurement; **no record of plants A or B
  survives**, and their existence should be treated as unestablished.
- **No `tsc --noEmit` or vitest exit code from this executor is recorded**, nor any duration, nor
  any `/usr/bin/time -p` reading.
- **The two full-run readings that do exist are not this plan's.** `9acd85f` records the node
  project after salvage at **142 files, 2024 passed, 2 skipped, 1 failed** — the failure being
  `enrollment-dos.node.test.ts`, unrelated. A later reading in the same session reports 2059
  passed with 0 failures after unrelated fixes. Both are the salvage/handoff pass's, taken over
  three executors' work at once, and neither isolates this file.

## The falsifiability proof exists — and a verifier took it, not this plan

`18-VERIFICATION.md`'s second amendment (2026-08-04T19:20Z) treated this work as *unreviewed
code* and asked the question 20-04 never answered. It planted a `break` in
`packages/core/src/job/submit.ts` immediately before the *"How much is still missing"* comment,
so the first generation runs and is returned unchanged, and ran the file:

```
FAIL … > re-picks past a node genuinely at its slot limit, on the production submit path
AssertionError: expected 'insufficient' to be 'agreed'
FAIL … > stops at the generation cap naming every refusal, beside a control with one node free
AssertionError: expected [ Array(1) ] to have a length of 3 but got 1
Test Files  1 failed (1)   Tests  2 failed | 1 passed (3)
```

`PLANTED_EXIT=1`, captured on the line immediately after the command; restored from a `cp`
backup, `cmp` exit 0. **That failure is the exact inverse of the tripwire** — the tripwire read
`expected 'agreed' to be 'insufficient'`. The amendment also re-derived structurally that
`attempted`, `generations`, `redispatches` and `leaseHistory` are unbounded accumulators, none
confined by `redundancy`: the tautology's shape is gone rather than renamed.

**Attribution matters here.** This is the strongest evidence that 20-04's assertions can fail, and
it was produced by an independent verification pass on 2026-08-04, **not** by this plan. Nothing
in this summary should be read as 20-04 having proved its own work.

**Result: Phase 18 criterion 2b PARTIAL → MET; Phase 18 closes at 9/9.**

## Outstanding — work this plan owed and did not do

1. **`packages/node/src/admission.node.test.ts` still carries a comment that is now false.** In
   `describe('SCHED-06 criterion 1, second clause — the requestor re-picks')` it reads: *"the
   production `submitJob` path places, runs `executeVerified` once per selected executor and
   reports, with no retry, no generation and no resample. So criterion 1's second clause is
   unmeasured on every path that runs in production."* All three negations are false since 20-01,
   and this plan measured the re-pick on that very path. The plan's `<verification>` block
   required it be *"corrected or explicitly handed to 20-12 with a reason."* **Neither happened.
   Verified live at HEAD.**
2. **`.planning/REQUIREMENTS.md` was not updated.** The `WIRE-04` traceability row still reads
   *"Not started — new requirement, minted 2026-07-27."* The `SCHED-03` row still describes the
   exec-stage re-pick as the outstanding half.
3. **No mutation-ledger rows were added.** 20-13 owns that file; it inherits an empty hand-off
   from this plan.
4. **`.planning/STATE.md` and `.planning/ROADMAP.md` were not advanced** for this plan.

## Out of scope, untouched

`packages/core/src/job/submit.ts` (read only — and restored after the abandoned plant),
Phase 18's criterion-1 cases in the same file, `vitest.config.ts`, `mutation-ledger.ts`,
`REQUIREMENTS.md`, `STATE.md`, `ROADMAP.md`.

## Self-Check: PASSED (performed by the retrospective writer, not by the executor)

- `packages/node/src/discovery-agents.node.test.ts` — FOUND, modified
- commit `9acd85f` — FOUND
- `describe('criterion 2 — sample, refuse, re-pick, complete')` — FOUND at HEAD
- `it('re-picks past a node genuinely at its slot limit, on the production submit path')` — FOUND at HEAD
- `describe('criterion 2, bounded — a fabric with no free node, and the control that had one')` — FOUND at HEAD
- `it('stops at the generation cap naming every refusal, beside a control with one node free')` — FOUND at HEAD
- `DEFAULT_MAX_GENERATIONS = 3` in `packages/core/src/lease.ts` — FOUND
- `VerificationResult`'s `agreed` arm declares no `failures` field — VERIFIED at HEAD
- `admission.node.test.ts`'s `unmeasured on every path that` comment — **STILL PRESENT at HEAD** (this is the finding, not a failure of the check)
- **NOT verified, because no such record exists:** any plant, any observed failure text, any exit
  code or any duration reported by this plan's executor.
