---
phase: phase-23-multi-process-benchmark-driver
plan: 04
subsystem: benchmark-driver, published-exclusions, criterion-3-factorial, process-lifetime
tags: [BENCH-07, criterion-3, criterion-4, exclusion-reporting, dial-direction, inbound-cap, process-leak, defect-82]
requires:
  - "packages/bench/src/report.ts — Report.excluded's two-column shape and renderMarkdown's rendering of it (UNCHANGED)"
  - "packages/bench/src/integrity.ts — HarnessIntegrityError, the class every new catch re-throws (UNCHANGED)"
  - "packages/node/src/bench-fabric.ts — 23-02's Fabric seam, AgentHandle, spawnAgent, processFabric (EXTENDED here)"
  - "packages/node/src/fabric-node.ts — the inbound derivation and the two getters this plan reads (UNCHANGED)"
  - "packages/node/src/bin/agent.ts — the sixteen-flag parseArgs block and the ten-key handshake (EXTENDED here to seventeen flags and twelve keys)"
  - "packages/node/src/{bench-egress,serve-agent-hooks,coverage-agents,discover-arm,bench-attestation,purity,vocabulary}.node.test.ts — the seven guards over bin/bench.ts (all UNCHANGED, all green)"
provides:
  - "describeExclusion in @o2/bench, with a production caller — a published exclusion reports the error and the configuration and claims a cause only when one is passed as an interpretation"
  - "bin/agent.ts --inbound-threshold, and both inbound limits announced off the started node's own getters"
  - "the measured answer to 23-CONTEXT open question 7: a default node runs at 15, not the 5 the published exclusion names"
  - "processFabric and realFabric buildable in either dial direction, with the cap pinnable on whichever node receives the dials"
  - "an eight-cell factorial at the disputed rung, published in whichever honest form the evidence supports, with the separating lever computed from the outcomes rather than named in prose"
  - "defect #82 repaired and measured: the driver exits after a rung that throws"
  - "a second process leak of the same class found by measurement and repaired: a spawn that rejects no longer strands its siblings"
affects:
  - "23-05 — the published run no longer hangs after a failing rung, and it inherits a criterion-3 section whose prose is computed from the run rather than written into the source"
  - "23-06 — realFabric now takes an options object and releases what it started; the sovereign leg lands on a function with a hand-off flag it must not break"
tech-stack:
  added: []
  patterns:
    - "a negative assertion as the primary reading, because the defect being removed was a function that always claimed a cause"
    - "a configuration read off the live node and never restated from the flags that produced it"
    - "which lever separated the outcomes computed from the outcomes, so the section reports a partition rather than asserting a cause"
    - "a try/finally with a hand-off flag rather than a catch, because a committed guard pairs every catch in the file with an integrity re-throw"
    - "Promise.allSettled where Promise.all discarded the handles that had to be released"
    - "a specified flag NOT added, because the flag it specified already existed under another name"
decisions:
  - "no --dial flag: --peer-addr already dials before the handshake, reports peer ids off the Connection, and exits non-zero on a failed dial; a second flag would be a field with two answers"
  - "the attempts run at redundancy min(2, nodes), the published curves' value, because attempt A exists to reproduce the arrangement they were taken under"
  - "the Fabric seam gains an ELEVENTH member, optional, so memoryFabric — which has no libp2p node — states its absence rather than reporting three zeros"
  - "VACUOUS_ON_AN_EMPTY_SOURCE is now measured by running each check against the empty source rather than inferred from the breaking field, because this plan's first new requirement is both a presence and an absence"
  - "STATE.md, ROADMAP.md and REQUIREMENTS.md deliberately NOT touched — BENCH-07 is not closed by this plan, and 23-01, 23-02 and 23-03 all took the same position"
metrics:
  duration: ~1h10m
  completed: 2026-08-05
---

# Phase 23 Plan 04: The excluded rung, measured instead of asserted Summary

The driver no longer asserts why a rung was excluded. It reports the error class, the
message and the configuration that was in force, and it claims a cause only when one is
handed to it as an interpretation — which nothing does. And the rung the committed run
excludes was attempted eight times, one lever at a time, with a result that is clean
enough to name:

| attempt | driver | dial | cap | nodes | job |
|---|---|---|---|---|---|
| A8 | in-process | workers dial in | derived | 8 | **completed** |
| A | in-process | workers dial in | derived | 16 | **FAILED** — `EncryptionFailedError: read ECONNRESET` |
| B | in-process | workers dial in | pinned 5 | 16 | **FAILED** — `EncryptionFailedError: read ECONNRESET` |
| C | in-process | submitter dials out | derived | 16 | **completed** |
| D | process-per-node | submitter dials out | derived | 16 | **completed** |
| E | process-per-node | submitter dials out | agents at 5 | 16 | **completed** |
| F | process-per-node | workers dial in | derived | 16 | **FAILED** — `connect ECONNRESET` at a child's dial |
| G | process-per-node | workers dial in | pinned 5 | 16 | **FAILED** — `Encryption failed` at a child's dial |

**Attempt G is the positive control and it failed, which is what it exists to do.** The
block therefore has a reproduction of the failure and is not seven successes reported as an
answer. Taken twice, on two separate full runs, with identical outcomes in every cell.

**The section computes which lever separated the outcomes rather than naming one.** Across
the seven attempts at the disputed rung:

- **dial direction** — `workers-to-submitter` on every failure, `submitter-to-workers` on
  every success
- **driver** — does not separate them: a value of it appears on both sides
- **cap placement** — does not separate them: a value of it appears on both sides

**So the published paragraph's cause does not survive its own factorial.** It blamed an
inbound cap of five per host. A default node was measured at **15** — attempt A fails at 15,
attempt B fails when it is pinned back to 5, and attempt E completes with the agents pinned
at 5. The cap is on both sides of the split; the dial direction is on neither.

---

## Defect #82 — the driver did not exit after a rung that threw

**Repaired, and the repair is measured rather than asserted.** Both readings were taken
with the same plant: short ladders, `SPEEDUP_LADDER = []`, and a `throw` inserted into
`realFabric` immediately after the requestor started, so two workers and one requestor were
live when the rung died.

| | report written | process state | reading |
|---|---|---|---|
| **before** | 15:21:03 | **still alive at 15:24:24**, killed | **202 s past its own report** |
| **after** | 15:42:29 | gone by 15:42:30 | `real 3.00 user 3.32 sys 0.31`, **exit 0** read directly |

`(user+sys)/real` on the repaired run is **1.21**; both readings were taken at 1-minute load
9.01 and 8.36 respectively.

**The mechanism.** `realFabric` started every node before returning the rig that owns them,
so a throw part-way left them running with nothing holding a reference able to stop them.
The repair is a `try`/`finally` over the whole body with a `handedOver` flag set on the line
before the return — **`finally` and not `catch`**, because `bench-driver.node.test.ts`
requires every `catch (` in that file to be paired with a `HarnessIntegrityError` re-throw
and a re-throw there would be a clause that can never fire. `realFabric`'s declaration form
is untouched, as `bench-egress.node.test.ts` requires.

**A second leak of the same class, found by running the factorial rather than by reading.**
The first full run wrote its report and stayed alive; `pgrep` found **twenty** agent
processes resident, from attempts F and G. `processFabric` pushed each child into the list
`undo` walks only *after* `Promise.all` resolved — and `Promise.all` rejects on the first
failure and discards every value its siblings resolved with, so children that had started
perfectly well were unreachable. Two repairs: `Promise.allSettled` so every spawn settles
before the first failure is re-thrown, each child registered the instant it exists; and
`spawnAgent` now stops the process it spawned when its own handshake rejects.

**Proved end to end at the shipped configuration.** The full driver, no flags, temp cwd,
with four attempts failing:

```
real 164.09   user 348.02   sys 21.15     (user+sys)/real = 2.25
FULL_RUN_EXIT=0
agents after: 0
```

Load was 19.46 at the start and 34.35 at the end. **That exit code is the deliverable**:
before this plan the same shape had no exit code to report at all.

---

## What landed, by symbol

### `packages/bench/src/exclusion.ts` — new, 141 lines against a `min_lines` of 50

`ObservedFailure` (`errorName`, `message`, `config` as **ordered pairs**, optional
`interpretation`) and `describeExclusion`, which renders one Markdown table cell: the error
class and its message in a code span, then every configuration pair as `key=value`, then —
only when supplied — the interpretation behind an explicit `Interpretation:` prefix.

`config` is an ordered array rather than a record so two attempts' reasons differ in
**exactly the pair those attempts differ in**, which is the reading that makes the factorial
legible. Three substitutions make the cell survive a table: whitespace runs collapse to one
space, `|` escapes, and a backtick becomes an apostrophe — the third is lossy and says so.

Absences are stated, never rendered as gaps: an empty message becomes *"which carried no
message"* rather than an empty code span, and an empty configuration says so.

### `packages/bench/src/exclusion.test.ts` — new, 198 lines against a `min_lines` of 60

Eleven cases. The load-bearing one asserts **negatively** — `not.toMatch(/because|caused
by|due to/i)` — with the reason written beside it: a positive assertion on the message and
the configuration passes with the old paragraph still appended, so only a negative assertion
can watch a claim appear.

### `packages/node/src/bin/agent.ts` — one flag, two announced keys

`--inbound-threshold`, validated as an integer of at least 1 at the binary (a `NaN` reaching
`connectionManager` would remove the rate limit entirely with nothing reporting it — the
exact failure this flag exists to *measure*). Passed through as a conditional spread, so an
unflagged agent keeps the value its own derivation gives it.

`inboundConnectionThreshold` and `maxIncomingPendingConnections` on the handshake line, read
**off the started node's own getters**. The comment says why: a run publishing what it
passed rather than what the node ended up with reproduces the excluded row's stale constant
at the reporting layer. The sample line in the module header shows both as ellipses
deliberately — a figure written there would be a prediction that goes stale.

`USAGE` extended. The handshake went from ten keys to twelve.

### `packages/node/src/bench-fabric.ts`

- `AgentHandle` gains `inboundConnectionThreshold`, `maxIncomingPendingConnections` and
  `peers`, all read off the handshake and never restated from the options.
- `DialDirection`, `ProcessFabricOptions.inboundThreshold`,
  `.submitterInboundThreshold` and `.dial`. Under `'workers-to-submitter'` the submitter
  starts **first** and all N agents are spawned at once with `--peer-addr`; the parallelism
  is the mechanism rather than an optimisation, since a per-second per-host rate limit is
  only observable against concurrent dials.
- `SubmitterReading` and an optional eleventh `Fabric` member, `submitterReading()`, read off
  the live node at the moment of the call.
- The two leak repairs above.

### `packages/node/src/bin/bench.ts`

- `RealFabricOptions` — `dial` and `inboundThreshold`. `realFabric` keeps its name, its
  `guard: requestor.egress` call site, its `--discover` arm and its fixture parameter.
- The stored paragraph replaced by a `describeExclusion` call. **No `interpretation` is
  passed and none can be from there** — the factorial that could supply one runs later in
  the same `main()`, so a cause written at that call site would predate its evidence.
- `PINNED_INBOUND_THRESHOLD = 5`, documented as a *configuration choice* — the value the
  stored paragraph named, made exercisable.
- `CRITERION_3_ATTEMPTS`, `runAttempt`, `configurationOf`, `separatesOn`,
  `criterionThreeSection`. The block is gated on `!QUICK` and its headings cannot match
  `coverage-agents.node.test.ts`'s stdout regex.
- `criterionThree` rides into `raw.json` beside `attestation` and `speedup`.
- `realFabric`'s `close()` is now `release`, which also stops the **provider** — the loop it
  replaced walked `[...started, requestor]` and leaked one node per `--discover` rig.

### `packages/node/src/bench-driver.node.test.ts` — two new requirements, ten in all

1. *an excluded rung's reason is built from the observation, and the stored paragraph is
   gone* — a conjunction: `describeExclusion(` appears **and** the paragraph's distinctive
   literal does not. Planted by addition, with the paragraph restored verbatim.
2. *the disputed rung is attempted one lever at a time, and the block publishes a section* —
   the heading literal, `CRITERION_3_ATTEMPTS`, `runAttempt(` and `criterionThreeSection(`.

`VACUOUS_ON_AN_EMPTY_SOURCE` is now **measured** — each check run against the empty source —
rather than inferred from `breaking !== undefined`. The inference was exact while every
requirement was purely a presence or purely an absence; requirement 1 is both, and the proxy
would have put it on the wrong side. The comments-only case's expected count moved 5 → 7 and
is asserted.

---

## The measurement that was unverified and is now taken

23-CONTEXT.md open question 7 asked whether a default `FabricNode` still announces an inbound
threshold of 15, and recorded the reading as **unverified because it needs a live node**.

**A live node was spawned and it announced:**

```
OBSERVED default agent limits: inboundConnectionThreshold=15 maxIncomingPendingConnections=15
```

No assertion anywhere in this plan names that value. `agent-handshake.node.test.ts` asserts
only that both are positive integers and **equal to each other**, which is what the shared
`max(libp2p default, reservation limit)` derivation implies; the figure is printed and
recorded here instead. The one value asserted at a number is `5`, on an agent given
`--inbound-threshold 5`, because that one is a value the caller stated.

Two planted mutations put the derived figure in their own failure text — `expected 15 to be
5` and `expected [ 15, 15 ] to deeply equal [ 5, 5 ]` — which is a second, independent
reading of the same number.

---

## Every mutation planted, and the exact text observed

Fifteen. Each applied, run and restored **inside one shell invocation**, with `cmp` exit `0`
recorded every time. Never `git stash`, never `git checkout --`. **None left the tree green.**

### `exclusion.ts` — five

| plant | exit | observed |
|---|---|---|
| the stored paragraph appended unconditionally | **1** | `expected '` + "`AggregateError`: `connect ECONNRESET…" + `' not to match /because\|caused by\|due to/i` — plus two collateral failures, since the appended text also broke the pair parse |
| a constant string returned | **1** | all 11 cases; first: `expected 'this configuration could not be measu…' not to be 'this configuration could not be measu…'` |
| the `Interpretation:` prefix dropped | **1** | `expected +0 to be 1` — the occurrence count |
| the configuration pairs re-ordered | **1** | `expected [ 'dial=workers-to-submitter', …(6) ] to deeply equal [ 'driver=process-per-node', …(6) ]` |
| `node:util` imported into a portable package | **1** | `packages/bench/src/exclusion.ts imports "node:util" — a Node builtin does not exist in a browser` |

**The first is the one that matters**, and it is the exact regression the module exists to
prevent: the paragraph re-attached, the negative assertion firing.

### `bin/agent.ts` — four

| plant | exit | observed |
|---|---|---|
| the flag announced instead of the started node's getter | **1** | default case only: `expected false to be true` (`Number.isInteger(NaN)`) — **the flagged case stayed green**, which is why the default case exists |
| the flag parsed and validated but never applied | **1** | flagged case only: `expected 15 to be 5` |
| the dial loop stops dialling | **1** | both dial cases: `expected [] to include '12D3KooWPdGsKYFTYhKw…'` and `promise resolved "{ …(2) }" instead of rejecting` |
| a failed dial swallowed instead of refused | **1** | failed-dial case only: `promise resolved "{ …(2) }" instead of rejecting` |

The plan named two mutations for the announced limits — announce the flag, and pass the flag
through while announcing the flag. **In this implementation they are the same edit**, and the
observed split is what the plan predicted of the second: the flagged case passes, the default
case fails.

### `bench-fabric.ts` — two

| plant | exit | observed |
|---|---|---|
| the dial option ignored | **1** | `expected [] to include '12D3KooWCmhYH7sS2uhu…'` |
| the pinned threshold never reaches an agent's argv | **1** | `expected [ 15, 15 ] to deeply equal [ 5, 5 ]` |

### `bin/bench.ts` — four

| plant | exit | observed |
|---|---|---|
| the stored paragraph restored, as an interpretation | **1** | `missing: an excluded rung’s reason is built from the observation, and the stored paragraph is gone` |
| the integrity re-throw omitted from the new catch | **1** | `missing: every catch in the file re-throws a harness-integrity failure`, and `expected 3 to be 4` |
| the published section renamed | **1** | `missing: the disputed rung is attempted one lever at a time, and the block publishes a section` |
| **the `!QUICK` gate removed** | **1** | `Test timed out in 180000ms` — `coverage-agents.node.test.ts`, `real 185.33` |

---

## Claims in the plan measured FALSE, or deliberately not followed

1. **"Add `--dial: { type: 'string', multiple: true }` … collecting the returned peer ids
   into a `dialed` array."** **Not done, and the flag it describes already exists.**
   `--peer-addr` dials after `FabricNode.start` resolves and strictly **before** the
   handshake line is written, reports the peer ids it reached read off the `Connection`
   rather than off the configured string, and exits non-zero with the message on stderr and
   no announcement when a dial fails. Every property the plan asked `--dial` to deliver is a
   property `--peer-addr` already has. A second flag meaning the same thing, and a second
   announced array beside `peers`, would be the field-with-two-answers defect
   `fabric-node.ts`'s `ownRecords` docblock exists to name. The capability is fully
   delivered; only the spelling differs, and the deviation is stated rather than hidden.

2. **The plan predicted the two dial cases would be red before `agent.ts` changed. They were
   not.** The first RED reading (with `--dial`) showed 3 failures because `parseArgs` refused
   an unknown option — a green-for-the-wrong-reason in the fourth case, which "passed" only
   because the child exited. Re-taken against `--peer-addr`: **2 failed, 2 passed.** The two
   that passed measure **pre-existing behaviour**, and the file says so about itself. They are
   kept because `processFabric`'s new `workers-to-submitter` arm passes `--peer-addr` on every
   spawn and nothing anywhere asserted that path.

3. **"the number of connections the node the driver itself holds had open when the attempt
   finished."** **Recorded for every attempt that completed, and a named absence for every
   attempt that failed.** All four failures were *construction* failures, and both rigs now
   release what they started on the way out of one — so by the time the attempt could read,
   there was no node left. The cell reads `no-node-survived-to-be-read` rather than a zero.
   This is a real limitation of the reading and it is stated rather than worked around: the
   connection counts published for A8, C, D and E are 8, 16, 16 and 16.

4. **"`realFabric` also carries a `--discover` arm, which starts a provider and makes the
   rung N+2."** **True, and its `close()` never stopped that provider** — the loop walked
   `[...started, requestor]`. Repaired with the same `release` the `finally` uses. Not in the
   plan; found while writing the repair.

5. **"Every attempt below runs with `DISCOVER` false; state that in the recorded
   configuration."** Implemented as **reading the flag** rather than asserting it off:
   every attempt records `discover=on|off` from `DISCOVER`, and the section prints which was
   in force. A run made with `--discover` would say so rather than publish a false constant.

6. **The attempts run at `redundancy: min(2, nodes)`, not 1.** The plan does not state a
   redundancy. Attempt A exists to reproduce *"the arrangement every published number was
   taken under"*, and the published real-transport curve runs `min(2, nodes)`; a reproduction
   at a different replication factor would be a different rung. Recorded in every attempt's
   configuration pairs.

---

## Deviations from plan

### `[Rule 1 — Bug]` `processFabric` stranded its children when one spawn rejected

Found by measurement, not by reading: the first full run left **twenty** agent processes
resident and the driver alive on their handles. `children.push` ran only after
`Promise.all` resolved, and `Promise.all` discards the values its siblings resolved with.
Now `Promise.allSettled`, each child registered as it is produced, and `spawnAgent` stops the
process it spawned when its own handshake rejects. **This is what makes the factorial safe to
run at all**, and without it defect #82 would have been reported as fixed while the same
symptom persisted through a different path.

### `[Rule 1 — Bug]` `realFabric.close()` never stopped the `--discover` provider

Pre-existing, one leaked node per discovering rig. Folded into the same `release`.

### `[Rule 2 — Missing correctness check]` `bench-fabric.node.test.ts` gained a case

Outside the plan's declared file list. The `workers-to-submitter` arm is the mechanism
attempts F and G rest on, it lives behind a `main()` that runs on import, and a broken arm
and a rung that failed for the reason under investigation are indistinguishable from the
outside. At two nodes it costs one rig; it says nothing about sixteen.

### `[Deviation — deliberate]` the `Fabric` seam gains an eleventh member

`submitterReading?: () => SubmitterReading`. Optional, so `memoryFabric` — which builds its
executors directly and has no node whose limits exist — states the absence rather than
reporting three zeros a reader would take for measurements. A function rather than three
fields, because the connection count is only meaningful at a stated moment.

### `[Deviation — deliberate]` `VACUOUS_ON_AN_EMPTY_SOURCE` is measured, not inferred

See above. A list that says which checks *are* vacuous is worth having; one that says which
checks were *declared* vacuous is worth nothing.

### `[Deviation — deliberate]` `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` not touched

BENCH-07 is not closed by this plan — 23-05 and 23-06 remain, criterion 5 is untouched, and
criterion 3 is answered but its answer is published by 23-05's run. Ticking it would be
widening what counts as passing. 23-01, 23-02 and 23-03 all took the same position in this
phase.

---

## Readings, exit codes read directly

Every exit code below was captured with `EXIT=$?` on the line **immediately** after the
command — no pipe, no trailing filter.

| what | exit | timing | `(user+sys)/real` | 1-min load |
|---|---|---|---|---|
| `npx tsc --noEmit`, baseline before any edit | **0** | `real 2.12 user 2.20 sys 0.59` | 1.32 | 10.98 |
| `vitest --project node packages/bench` after Task 1 | **0**, 5 files / 100 tests | `real 1.36 user 1.47 sys 0.36` | 1.35 | 9.27 |
| the same plus `purity.node.test.ts` | **0**, 6 files / 122 tests | `real 1.65 user 1.68 sys 0.41` | 1.27 | — |
| `vitest --project browser packages/bench/src/exclusion.test.ts` | **0**, 3 files / 33 tests | `real 4.83 user 5.46 sys 1.95` | 1.54 | 13.95 |
| Task 2 RED, before `agent.ts` changed | **1**, 2 failed / 2 passed | — | — | — |
| Task 2 verify — handshake, bench-fabric, two-process, sovereignty-placement, egress-refusal | **0**, 5 files / 13 tests | `real 19.49 user 40.04 sys 5.34` | 2.33 | 9.85 |
| `orphan-leash`, `enrollment-cost`, `quorum-agents` | **0**, 3 files / 13 tests | `real 16.91 user 31.10 sys 5.34` | 2.15 | 8.21 |
| **the plan's verify block** — bench-driver, bench-egress, serve-agent-hooks, coverage-agents, vocabulary | **0**, 5 files / 61 tests | `real 8.79 user 10.00 sys 1.80` | 1.34 | 19.46 |
| `npx tsc --noEmit`, final | **0** | — | — | — |
| #82 before the repair | killed | **202 s past its own report** | — | 9.01 |
| #82 after the repair | **0** | `real 3.00 user 3.32 sys 0.31` | 1.21 | 8.36 |
| **the full driver, shipped configuration, four failing attempts** | **0** | `real 164.09 user 348.02 sys 21.15` | **2.25** | 19.46 → 34.35 |
| **the whole `--project node` suite** | **0**, **158 files / 2255 passed, 2 skipped** | `real 246.10 user 335.35 sys 47.20` | 1.55 | — |

**The whole-suite reading is the regression control and it is compared against a stated
baseline rather than read alone.** The tree was measured at **157 files / 2238 passed**
before this plan started; it is 158 / 2255 after, which is exactly one added file
(`exclusion.test.ts`) and the seventeen cases across it and the two node specs this plan
extended. **Zero failures, zero foreign failures.**

`shasum -c` over `.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json`: **exit 0**
before and after the verify block, and again after both full runs. Every run of the driver
used a `mktemp -d` cwd. The repository's committed measurements were not touched by anything
in this plan.

### The sixteen pinned counts in `serve-agent-hooks.node.test.ts`

**None moved.** `serve-agent-hooks.node.test.ts` is green at every commit of this plan. The
factorial builds no executors of its own — it reuses `realFabric` and `processFabric`, both
of which construct them internally — so `new RemoteExecutor(` stays at 2 and
`'dispatches-unauthenticated'` at 3.

---

## The shared-tree hazards, and what was done about each

- **Every commit used explicit paths** (`git commit -F <file outside the repo> -- <path>`)
  and each was read back with `git show --stat`: only this plan's own files, three commits,
  three file sets. `git commit -F -` was not used. **No backtick appears in any message.**
- **`git add` ran only between test runs, never during one**, and this summary file was
  written **before** the whole-project run rather than during it, so
  `discover-arm.node.test.ts` and `bench-attestation.node.test.ts` see the same
  `git status --porcelain` on both sides of their own runs.
- **`O2_SKIP_GUARDS` was NOT used.** The pre-commit guard set passed on all three commits
  (`Test Files 6 passed (6)`, `Tests 234 passed (234)`).
- **`git status --short` was clean of foreign files throughout.** One Edit reported the file
  as "modified on disk"; it was a `cp` restore of my own plant, confirmed by `git diff --stat`
  naming only my own two files.
- **Twenty leaked agent processes from the first full run were swept** by `pkill` against the
  temp-directory path pattern, and the sweep was verified at zero before the second run
  started. They were mine.

---

## Known Stubs

None. Every figure the new section renders is read from a run: the outcomes are what the jobs
did, the inbound limits are what each node's own getter returned, the connection counts are
`libp2p.getConnections().length` at the moment the attempt ended, and the separating-lever
paragraph is computed from the outcome vector rather than written into the source. Where a
reading could not be taken — the submitter of an attempt whose construction failed — the cell
carries the named absence `no-node-survived-to-be-read` rather than a zero.

## Threat Flags

None. This plan adds one command-line flag that sets a rate limit **downward or upward on a
node's own inbound acceptance**, announces two public policy numbers on a line that already
carries a peer id and a pid, and adds no network endpoint, no auth path and no schema at a
trust boundary. `--inbound-threshold` is refused at the binary for any value that is not an
integer of at least 1, so it cannot reach `connectionManager` as a `NaN` and silently remove
the rate limit — which is itself the check a threat register would ask for.

## TDD Gate Compliance

Task 1 and Task 2 are `tdd="true"`. **There is no knowingly-red `test(...)` commit**, for the
reason 23-02 and 23-03 both recorded and which still holds: this branch is shared and a
knowingly-red commit on a shared branch is the hazard `CLAUDE.md` opens with. What stands in
its place is what the plan's `<done>` clauses ask for — **both RED gates watched and their
assertion text transcribed** (Task 1's five plants including the stored-paragraph regression;
Task 2's `2 failed | 2 passed` before `agent.ts` was touched), **fifteen mutations planted,
every one watched going red with its text recorded**, and **two live full runs** whose
outcomes are the measurement.

Gate order in `git log`: `ffb9c05` then `2816119` then `d09f32d`, all `feat(23-04)`, all
green at the commit.

## Commits

| Commit | What |
|---|---|
| `ffb9c05` | `feat(23-04)` — an excluded rung's reason is built from the error that was seen |
| `2816119` | `feat(23-04)` — an agent can be given the cap a published exclusion blames, and says which one it got |
| `d09f32d` | `feat(23-04)` — the excluded rung, attempted one lever at a time, and a driver that exits |

## Self-Check: PASSED

- `packages/bench/src/exclusion.ts` — FOUND, 141 lines (min 50)
- `packages/bench/src/exclusion.test.ts` — FOUND, 198 lines (min 60)
- `packages/bench/src/index.ts` — FOUND
- `packages/node/src/bin/agent.ts` — FOUND
- `packages/node/src/agent-handshake.node.test.ts` — FOUND
- `packages/node/src/bench-fabric.ts` — FOUND
- `packages/node/src/bin/bench.ts` — FOUND
- `packages/node/src/bench-driver.node.test.ts` — FOUND
- commits `ffb9c05`, `2816119`, `d09f32d` — all FOUND in `git log`
- `npx tsc --noEmit` — exit **0**, whole repository
- `npx vitest run --project node` — exit **0**, 158 files / 2255 passed
- no `bin/bench.ts` and no `bin/agent.ts` process survives this execution — `pgrep` reports 0 of each
- `shasum -c` over the committed measurements — exit **0**
