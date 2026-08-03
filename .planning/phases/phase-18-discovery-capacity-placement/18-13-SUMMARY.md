---
phase: phase-18-discovery-capacity-placement
plan: 13
subsystem: testing
tags: [instruments, requirements-ledger, sched-03, sched-04, sched-05, net-06, gap-closure, documentation]

requires:
  - phase: phase-18-discovery-capacity-placement/18-06
    provides: "`bin/bench.ts --discover` and the `admit:` wiring the three stale rows denied"
  - phase: phase-18-discovery-capacity-placement/18-08
    provides: "`new GovernedExecutor(counter, governor)` on the Node tier — what SCHED-04 said did not exist"
  - phase: phase-18-discovery-capacity-placement/18-11
    provides: "the non-fatal relay dial whose divergence from the browser tier this plan documents"
  - phase: phase-18-discovery-capacity-placement/18-12
    provides: "the browser-tier wire reading that closes the last measurement gap SCHED-04 was held low for"
provides:
  - "SCHED-03, SCHED-04, SCHED-05 and NET-06 restated against the shipped tree, each with `file:line` evidence"
  - "`requirements-ledger.node.test.ts` reading every row rather than the *Built, not wired* third of them — the widening that found NET-06"
  - "`WITHOUT_A_CHECKABLE_CLAIM` stating the rule it encodes, and covering the whole unreached population"
  - "`discover-arm.node.test.ts` — the `--discover` arm executed and its qualification counts read"
  - "the relay-dial divergence stated on both tiers, each naming the other and the test measuring it"
affects: []

tech-stack:
  added: []
  patterns:
    - "A guard scoped to one marker exempts a row at the moment somebody corrects it — the marker must decide what a row owes, never what gets read"
    - "A row cannot quote the false sentence it is disowning: a text-matching guard reads the quotation as an assertion"
    - "A source-text count cannot tell a working branch from a disabled one; demonstrated by disabling the branch and watching the count stay green"
    - "An exemption list is a promise to re-read by hand, so its comment must state the rule it encodes rather than list ids"

key-files:
  created:
    - packages/node/src/discover-arm.node.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/18-13-SUMMARY.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - packages/node/src/requirements-ledger.node.test.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts

key-decisions:
  - "The claim checks were widened from BUILT_NOT_WIRED to every row. That, not the three stale rows, is the plan's real output: scoping them to one marker meant correcting a row to *Partial* removed it from the guard, so fixing a row was the act of exempting it."
  - "The widening immediately caught a fourth stale row, NET-06, which had been wrong for a day for exactly that reason. Fixed rather than exempted."
  - "No checkbox was ticked. SCHED-04 now has a production path for all three of its clauses and its row says so in words while staying `[ ]` — a marker declared conservative, because ticking requires a re-verification this plan did not run."
  - "SCHED-05 moved *Built, not wired* -> *Partial*, which is a category correction rather than a tick. The header's three-way split moved 15+17+1 -> 14+18+1 with it."
  - "The plan's named inversion for the `--discover` test — deleting `admit:` at bench.ts:723 — was planted and read GREEN. Reported as a finding rather than substituted silently; two mutations that do invert were run instead."
  - "`WITHOUT_A_CHECKABLE_CLAIM` grew 2 -> 17 without any row becoming less checked. The old list was the Built-not-wired slice of a population two thirds of which the guard never looked at."

requirements-completed: []
duration: one session
completed: 2026-08-02
---

# Phase 18 · Plan 13 — The rows were a day's drift; the guard that could not read them was the defect

`18-VERIFICATION.md` left W-1, W-2, I-1 and three stale ledger rows. All three rows
under-reported shipped work — the rarer direction, and the one no guard was watching.

| finding | was | is |
|---|---|---|
| **SCHED-03** | *the requestor does not re-pick; neither entry has a production caller* | offer-stage re-pick wired from `bin/bench.ts:723` -> `submit.ts:340`; the exec stage is what remains, and names `runResilient` so the guard can hold it |
| **SCHED-04** | *`FabricNode` composes no governor; the duty cycle is readonly on both tiers* | every clause has a production path on both tiers; the marker is declared conservative rather than descriptive |
| **SCHED-05** | *Built, not wired — reachable only through `runResilient`* | *Partial* — the gate runs on **both** placers, and the open leg is that no entry point ever labels a shard `sovereign` |
| **NET-06** | *`discoverCandidates` has no production caller* | `bin/bench.ts:680` calls it; open leg is that the reading runs behind `--discover` only |
| **W-1** | the `--discover` arm held by a source-text count | the arm executed, its qualification counts read |
| **W-2** | the relay-dial divergence recorded on neither tier | stated on both, each naming the other and its measuring test |

---

## The finding under the finding

**The three rows are a day's drift. The guard that could not read them is structural, and it
was worse than the plan said.**

The plan's diagnosis was that these rows are written in concepts and pronouns, so the
extraction — which binds only exported symbols — has nothing to grip. True, and not the
whole of it. Measured against the tree:

> Both claim-checking cases iterated `BUILT_NOT_WIRED`. A row marked ***Partial* left the
> guard's population entirely** — claims and all.

So the blind spot was not "rows written in prose". It was **rows that had been corrected**.
`SCHED-03` was moved to *Partial* on 2026-08-01; from that moment the guard stopped reading
it, and it went stale by the following day. The act of fixing a row was the act of exempting
it, silently, in the direction of looking more checked.

That is not a hypothesis. Widening the population to every row turned up a **fourth** stale
row nobody had reported:

```
Partial   NET-06: discoverCandidates no-caller -> BROKEN by packages/node/src/bin/bench.ts
```

`NET-06` was corrected to *Partial* on 2026-08-01, its replacement sentence called
`discoverCandidates` callerless, and `bin/bench.ts:680` calls it. The guard read green over
that for a day for the same reason it read green over SCHED-03.

**The exemption list grew from 2 to 17 and nothing became less checked.** The old two were
the *Built, not wired* slice of a population two thirds of which was never looked at. What
the list now encodes is stated in its own comment as a rule rather than as ids: *a row that
says a mechanism is not fully reached is either read by this file or named here, and an id
here is a promise to re-read that row by hand.*

---

## Task 1 — three rows that describe the tree, and a guard that reads them

**Rephrased so the guard binds them (1):** `SCHED-03`. Its open leg is the exec-stage
re-pick, and the mechanism that would close it is `runResilient` — an exported symbol with
no production caller — so the row now says exactly that and the guard holds it. This is the
plan's stated preference and it worked on one of the two rows it named.

**Exempted, with the reason (3):** `SCHED-04`, `SCHED-05`, `NET-06`.

- `SCHED-04` reports **no absence at all**. All three clauses — caps by duty cycle,
  user-adjustable, honoured by the executor — have a production path on both tiers. A row
  with nothing missing has no symbol to name, and rephrasing it around one would have made
  it say something false. It is exempt because it is *complete*, which is a category the
  old two-entry list had no way to express.
- `SCHED-05`'s open leg is that **no runnable entry point labels a shard `sovereign`**
  (`bin/bench.ts:455` records the decision). That is a claim about an *argument value*, and
  no call-site search reads argument values.
- `NET-06`'s open leg is that the reading runs on the `--discover` arm alone. That is a
  claim about *which entry point*, not which caller.

**A constraint discovered while writing them.** My first NET-06 rewrite quoted the false
sentence it was disowning. The guard read the quotation as an assertion and went red — for a
row that was now correct. The rows paraphrase what they disown, and the guard's docblock
records the limit.

### What was not done, and why

**No checkbox moved.** SCHED-04 in particular now reads as satisfied on the evidence, and
the row says so — including that the box is `[ ]` because no re-verification has run since
18-12, not because a leg is missing. Naming a conservative marker as conservative is the
difference between under-reporting and *declaring* that you are under-reporting; the second
is what this plan is for. `SCHED-05` did change **category** (*Built, not wired* -> *Partial*),
because "nothing calls it" was flatly the wrong statement about a gate both placers call.
The header's split moved with it: `15 + 17 + 1` -> `14 + 18 + 1`.

---

## Task 2 — the `--discover` arm, executed rather than counted

`packages/node/src/discover-arm.node.test.ts` spawns `bin/bench.ts --quick --discover` with
`cwd` in a temp directory, reads `--discover: 1 of 1 workers qualified from 1 providers` off
stdout, asserts the four counts, checks the driver's output landed under the temp `cwd` and
that `git status --porcelain` is unmoved, then kills the child.

It reads a **count** and never a duration, so it is safe beside the rest of the suite. The
arm speaks about a second in; the run it declines to wait for is minutes of measurement that
would add no reading.

**Measured span: 1.68 s (file duration 1.82 s).** That is at or above `SLOW_NODE_SPECS`'
stated 1 s cut, so by the config's own rule this file belongs on that list. It was **not**
added, per `deferred-items.md` item 1: the list has nine entries derived when `test:unit` ran
66 files in 6.46 s and now runs 98 in 25.31 s, so adding one entry would make the list look
maintained without making it honest. The whole re-derivation is the fix.

---

## The planted mutations, what they read, and that they were restored

Every restore was `cp` from a `/tmp` backup followed by `cmp`, never `git checkout --`.

| # | planted | file | read | restored |
|---|---|---|---|---|
| A | `runResilient` -> `submitJob` in SCHED-03's clause | `REQUIREMENTS.md` | **RED**, exit 1 — `SCHED-03: submitJob is called by packages/core/src/executor/task-worker.ts, packages/net/src/submit-with-egress.ts` | `cmp` 0 |
| A2 | **the same clause**, with the first check narrowed back to `BUILT_NOT_WIRED` | `requirements-ledger.node.test.ts` | **GREEN**, exit 0, 16 passed | `cmp` 0 |
| B | *"All three clauses … have a production path"* -> *"No clause … has a production path: neither tier composes a governor"* | `REQUIREMENTS.md` | **GREEN**, exit 0, 16 passed | `cmp` 0 |
| C | `'SCHED-04'` dropped from `WITHOUT_A_CHECKABLE_CLAIM` | `requirements-ledger.node.test.ts` | **RED**, exit 1 — the missing id named in the diff | `cmp` 0 |
| D | `trustedIssuers` emptied inside the `--discover` arm | `bin/bench.ts` | **RED**, exit 1 — `qualified: 0`, `excluded: 1` | `cmp` 0 |
| E | `admit: rpcAdmission(requestor.rpc)` deleted (`bench.ts:723`) | `bin/bench.ts` | **GREEN**, exit 0 | `cmp` 0 |
| F | `if (DISCOVER)` -> `if (false && DISCOVER)` | `bin/bench.ts` | **RED**, exit 1 at 121 s — *no `--discover` line within budget* | `cmp` 0 |
| F' | the same, read by the **source-text count** it replaces | `serve-agent-hooks.node.test.ts` | **GREEN**, exit 0, 9 passed | `cmp` 0 |

**A beside A2 is the plan's central proof, and it is a pair rather than a single reading.**
The identical planted false clause is caught under the widened scope and invisible under the
old one. That is the blind spot exhibited rather than argued.

**B is the exemption declaring itself.** The guard is green over the true SCHED-04 row and
green over a flatly false one. It cannot tell them apart — which is precisely what an entry
in `WITHOUT_A_CHECKABLE_CLAIM` promises, and why the entry is a commitment to re-read by
hand. **C** proves that promise is load-bearing: drop an id and the file fails.

**F beside F' is W-1 exhibited.** With the arm disabled, the source-text count that was its
only guard read 9 passed, exit 0.

---

## Deviations from Plan

### 1. [Rule 1 — Bug] The plan's named inversion for Task 2 does not invert

**Found during:** Task 2, proof step 1.

**Issue.** The plan says *"delete the `admit:` line at `bin/bench.ts:723` and confirm the
test goes RED"*, and the success criteria repeat it. Planted, the run stayed **GREEN**
(mutation E). Deleting it moves `submitJob` from `planWithOffers` to `planPlacement`, and on
a rig where no node ever refuses, the two place identically and print identically. The only
out-of-process trace it removes is offer traffic in the real-transport egress manifest, which
is printed after the entire sweep this test declines to wait for.

**Fix.** Two mutations that do invert were run instead (D and F), and the finding is recorded
in the test file's own docblock rather than left to a summary nobody greps. Also checked
rather than assumed: **nothing else covers that deletion either** — no spec names
`rpcAdmission` together with this driver, and the two mutation-ledger entries on `bin/bench.ts`
(`B1`, `B2`) are keyed on its `LocalCapacity` sites. Named as residual, not closed.

**Commit:** `b9147a9`

### 2. [Rule 2 — Missing critical functionality] NET-06 was stale for the same reason as the three named rows

**Found during:** Task 1, immediately on widening the guard's population.

**Issue.** `NET-06` claimed `discoverCandidates` had no production caller; `bin/bench.ts:680`
calls it. Not in the plan's scope, but a widened guard that reports a real stale row and is
then made to exempt it would be worse than not widening it.

**Fix.** Row corrected, with its two false citations (`index: records ?? 'serves-no-records'`
at `fabric-node.ts:1278` / `browser-node.ts:988`, both drifted — the expression is now
`index: records` at `:1551` / `:1148`).

**Commit:** `a5a70c7`

### 3. [Rule 1 — Bug] A comment in `serve-agent-hooks.node.test.ts` became false

**Found during:** Task 2.

**Issue.** Its docblock read *"No test executes the `--discover` arm"* and went on to
describe, correctly, the temp-`cwd` test that would. Shipping that test without deleting the
sentence would leave a claim about another file with an expired date — the repository's own
named anti-pattern.

**Fix.** Rewritten to point at `discover-arm.node.test.ts` and to say what each half of the
pair is now worth.

**Commit:** `b9147a9`

### 4. [Rule 3 — Blocking] Stale citations in SCHED-03

`fabric-node.ts:1300` / `browser-node.ts:1009` / `fabric-node.ts:986` / `browser-node.ts:899`
had all drifted. Re-measured to `:1573` / `:1169` / `:1178` / `:1028` before reuse.

---

## Test Results

Every exit code was captured on the line immediately after its command — no pipe, no
trailing `echo`. Load was read before the long run: `load averages: 3.65 4.80 5.14`.

| Command | Result | Exit |
|---|---|---|
| `npx vitest run --project node requirements-ledger + acceptance-traceability + vocabulary` | `Test Files 3 passed (3)` / `Tests 81 passed (81)`, 705 ms | 0 |
| `npx vitest run --project node discover-arm.node.test.ts` | `Test Files 1 passed (1)` / `Tests 1 passed (1)`, 1.82 s | 0 |
| `npx vitest run --project node discover-arm + serve-agent-hooks + orphan-leash` | `Test Files 3 passed (3)` / `Tests 16 passed (16)`, 12.35 s | 0 |
| `npx vitest run --project node reservation-exhaustion --reporter=verbose` | 1 passed, the cross-process case at 2005 ms | 0 |
| `npx vitest run --project browser start-unwind.browser.test.ts` | `Test Files 3 passed (3)` / `Tests 15 passed (15)` — three engines | 0 |
| `npx vitest run --project node reservation-exhaustion + start-unwind.node + vocabulary` | `Test Files 3 passed (3)` / `Tests 32 passed (32)` | 0 |
| `npx tsc --noEmit` (run after each task) | clean | 0 |
| **`npx vitest run --project node`** | **`Test Files 129 passed (129)` / `Tests 1786 passed \| 2 skipped (1788)`, 212.56 s** | **0** |

Every run used `--project`; no bare-path invocation was made.

**`tools/aot/lift.node.test.ts` passed.** It was expected red per `deferred-items.md` item 2
as re-measured by 18-12. It was not. That is one more data point for the item's open
question and changes nothing about it — a file that fails intermittently has not been fixed
by passing once.

---

## What this plan did NOT do

- **Tick anything.** No checkbox moved. SCHED-04's row explains why its marker is low.
- **Touch `.planning/STATE.md`.** Hand-maintained; its prose is stale by one phase (I-2) and
  that is its maintainer's call.
- **Amend criterion text in `ROADMAP.md`.** Only the plan checklist at `:584` and the plan
  list under it.
- **Add to `SLOW_NODE_SPECS`**, though the new file qualifies. `deferred-items.md` item 1
  explains why a partial application is worse than none.
- **Close `tools/aot/lift.node.test.ts`.** `deferred-items.md` item 2, Phase 21.

---

## Three things a later plan should pick up

1. **`bench.ts:723`'s `admit:` is covered by nothing.** Named in `discover-arm.node.test.ts`.
   Closing it needs a reading of offer traffic, which needs the sweep that test must not
   wait for.
2. **SCHED-04 looks satisfied and is unticked.** A re-verification, not a wiring plan.
3. **Sixteen rows sit in `WITHOUT_A_CHECKABLE_CLAIM` that were never individually argued** —
   they were invisible before this plan, so nobody has re-read them by hand yet. The list
   makes that debt visible; it does not pay it. Several look rephraseable (`AOT-04`'s *"no
   production node constructs a `WasiExecutor`"* is one symbol away from binding).

---

## Self-Check: PASSED

| Claim | Checked |
|---|---|
| `packages/node/src/discover-arm.node.test.ts` | FOUND |
| `.planning/phases/phase-18-discovery-capacity-placement/18-13-SUMMARY.md` | FOUND |
| commit `a5a70c7` | FOUND |
| commit `b9147a9` | FOUND |
| commit `548e119` | FOUND |
| `bin/bench.ts`, `fabric-node.ts`, `browser-node.ts` restored / intentionally edited only | `cmp` 0 on every planted mutation |
