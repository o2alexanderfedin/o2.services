---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 05
subsystem: churn-resilience, spawned-agents, leases
tags: [CHURN-01, CHURN-04, criterion-2, SIGKILL, spawned-agents, control-run, retrospective-summary]

status: code-landed-never-self-reported
summary_authorship: >-
  RETROSPECTIVE. Written 2026-08-04 by a different agent, from the committed diff alone. The
  executor was terminated mid-flight by a weekly API usage limit before it wrote a summary, a
  plant record, a span or a single exit code. Nothing below is taken from the plan's intent;
  where the evidence is silent this file says so.
executor_outcome: >-
  Killed at ~12:08 PDT 2026-08-04 by a weekly API limit. The spec file was complete and green
  in the working tree; the second half of Task 2 — the `vitest.config.ts` span entries — was
  not started. No abandoned plant was attributed to this plan; the whole-tree sweep found only
  20-04's.

requires:
  - "packages/core/src/job/submit.ts — the generation loop, `redispatches`, `leaseHistory`, `ShardResult.attempted/generations/ending/degraded`. Landed by 20-01, READ HERE AND NOT MODIFIED"
  - "packages/node/src/tree-reduce-agents.node.test.ts — `spawnAgent`, `stopAgent`, `killAgent` and the mid-flight staging technique, COPIED not imported"
  - "packages/node/src/discovery-agents.node.test.ts — the spawn helper, the pre-seed-before-spawn order and the budget constants, COPIED"
  - "packages/core/src/executor/fixtures.ts — `MODULE_ECHOES_INPUT`, test-only relative import"
  - "packages/net/src/agent.ts + rpcAdmission — the production admission path, so a re-placement discovers a vanished process rather than re-picking a corpse"
provides:
  - "packages/node/src/churn-agents.node.test.ts — criterion 2 across ten real `bin/agent.ts` processes: 30 % killed mid-flight, per-shard results byte-identical to a control run over the same fabric"
  - "the coverage table 20-12 needs — which of `packages/net/src/churn.test.ts`'s behaviours this file now states, and which it does not, IN THE FILE'S OWN HEADER"
  - "a gross-fuel equality reading: the churn tax is paid in round trips, not in recomputation"
  - "a prefix reading proving the kill was mid-flight — the killed run's first generation placed exactly where the control placed"
affects:
  - "20-12 — inherits the churn.test.ts coverage table from this file's header rather than having to search for it"
  - "20-13 / vitest.config.ts — the span entries this plan owed were NEVER WRITTEN. See Outstanding."
  - "slow-specs.node.test.ts — the node project's file count moved again and `NODE_MEASUREMENT.files` was not re-measured"

tech-stack:
  added: []
  patterns:
    - "`correct` is an equality against a control run over the SAME fabric in the SAME run, never a pinned literal"
    - "the control carries the instrument check FIRST — `redispatches === 0` — because a lossy fabric makes every later re-dispatch unattributable"
    - "the victims are the participants that carried the MOST work, by a total order (shards held, then shards placed on, then node id), so the choice is reproducible and adversarial rather than convenient"
    - "the kill is staged from a wrapper around the production dispatch and every executor awaits ONE shared promise, so the kill completes before any frame reaches any agent"
    - "every duration is printed and none is asserted — no wall-clock threshold anywhere in the file"
    - "the guest is `MODULE_ECHOES_INPUT`, because `MODULE_WRITES_PARTITION` ignores its input and would make the change-one-shard's-input plant unfalsifiable"

key-files:
  created:
    - packages/node/src/churn-agents.node.test.ts
  modified: []

decisions:
  - "SIGKILL, not SIGTERM — a SIGTERMed `bin/agent.ts` LEAVES gracefully and the criterion says killing; the vanish is the harder case"
  - "ten agents, because `Math.round(0.3 × 10) === 3` exactly, so the criterion's own figure appears as itself rather than as an approximation"
  - "redundancy 2, not 1 — at redundancy 1 only the `insufficient` trigger is expressible; the top-up trigger a PARTIAL loss produces needs ≥ 2 to exist"
  - "the loss-kind assertion is the DISJUNCTION `expired | surrendered`, because both are correct answers to a vanish; the file's docblock claims the measurement was `surrendered` — see the caveat below"
  - "`rpcAdmission` supplied, so a re-placement discovers a dead node through its own bounded probe; the file records that WITHOUT it `placeAgain` could hand a shard a second corpse, and inherits that rather than repairing it"

requirements-completed: []   # REQUIREMENTS.md was NOT updated — see Outstanding

metrics:
  duration: unknown — the executor was terminated before reporting
  completed: 2026-08-04 (code); summary written retrospectively 2026-08-04
---

# Phase 20 Plan 05: Thirty Per Cent of the Fabric Dies and the Answer Is Unchanged — Summary (retrospective)

> **Read this line first.** This plan is **complete in code and was never self-reported.** Its
> executor was killed by a weekly API usage limit before it wrote a summary, a plant table, a
> measured span or a single exit code. Everything below is derived from the committed diff
> (`9acd85f`) and from the salvage pass's own commit message. **No plant record, no observed
> failure text, no `/usr/bin/time -p` figures and no printed run output from this executor
> exist, and none is invented here.**

**Criterion 2 is measured across real operating-system processes.** Ten spawned `bin/agent.ts`
agents run an eight-shard job at redundancy 2; three of them — chosen as the three the scheduler
leaned on hardest — are SIGKILLed at the first dispatch; and the killed run's per-shard result
CIDs come back **equal to a control run over the same fabric in the same run**, with the job
complete, no shard degraded, and every dead process named in the lease history as a loss.

## What landed

One file, new, one commit.

| file | change | commit |
|---|---|---|
| `packages/node/src/churn-agents.node.test.ts` | **new, 773 lines** | `9acd85f` |

`9acd85f` is a **salvage commit**, not this plan's own. It carries three executors' work and its
message states that none of them is scoreable. It was made with `O2_SKIP_GUARDS=1`, stated in the
message.

**`vitest.config.ts` was not touched.** Its last modification anywhere in history is `b17baa3`,
a Phase 19 commit. That is half of Task 2 and it did not happen — see Outstanding.

## The shape of the reading

| element | value | why that value, per the file |
|---|---|---|
| `AGENT_COUNT` | 10 | the smallest count at which `Math.round(0.3 × N)` is a whole number ≥ 2 with no rounding to argue about |
| `KILL_FRACTION` | 0.3 | the criterion's own fraction, asserted against the killed count rather than assumed |
| `SHARDS` | 8 | sixteen placements over ten nodes: every agent participates, and killing three holders leaves each affected shard a live untried node inside the generation budget |
| `REDUNDANCY` | 2 | at 1 only the `insufficient` trigger exists; the top-up trigger a partial replica loss produces needs ≥ 2 |
| `RPC_TIMEOUT_MS` | 10 000 | `tree-reduce-agents`' value, kept — it keeps every dispatch below `RENEW_AT × DEFAULT_LEASE_MS`, which is *why* renewal is unreachable here |
| fixture seed | **114** | with a census of the whole `fill(n)` set in `packages/` and `tools/` recorded at the constant |
| guest | `MODULE_ECHOES_INPUT` | `MODULE_WRITES_PARTITION` ignores its input, so "change one shard's input and watch the equality break" would not be falsifiable over it |

## Asked vs delivered

| # | Plan must-have | Delivered? |
|---|---|---|
| 1 | Killing 30 % of the participating processes mid-job still produces the correct final result | **YES** |
| 2 | Correct means byte-identical to the same job with nobody killed — a comparison, not a constant | **YES**, and strengthened: three independent equalities, not one |
| 3 | The re-dispatches are readable on the job's own output and they name the nodes that vanished | **YES** |
| 4 | The kill is a vanish rather than a shutdown, and the reading fails if the processes were never killed | **YES**, with the honesty label the plan asked for |

### The control comes first, and it is the instrument check

Before anything else the control run is asserted `complete`, `redispatches === 0`, and per shard
`ending === 'agreed'`, `generations === 1`, `attempted` of length `REDUNDANCY`,
`degraded === false`. Then the same thing from the other end: exactly `SHARDS` `granted` events,
exactly `SHARDS` `completed` events, and **no** `expired`, `surrendered` or `abandoned` at all.
Then `resultCids` are asserted all non-null and **all eight distinct**, so the equality below is
eight separate readings rather than one repeated — with distinctness inherited from the guest
rather than imposed.

The file names why this ordering matters: a fabric that was already lossy — an agent that never
received its blocks, one that failed to come up, contention enough to time out a healthy dispatch
— would make every re-dispatch in the killed run unattributable. *"This is the most common way a
file of this class goes quietly wrong."*

### The victims are chosen adversarially, by a total order

`participants` is derived from the control's own `attempted` sets. `holderOf` is derived from the
control's `granted` events. The kill set is then the participants ranked by **shards held**, then
**shards placed on**, then **node id** — a total order, so the choice is reproducible within the
run and not a lucky draw. The file states the choice is *deliberately the adversarial end of the
fixture*: the convenient choice would be three nodes the job barely used.

Asserted around it: `killCount / AGENT_COUNT === KILL_FRACTION` exactly, `killCount >= 2`, enough
distinct holders to draw from so the ranking is a ranking rather than "everything there was",
every victim in `participants`, every victim a holder of at least one lease, and
`killCount / participants.size >= KILL_FRACTION` — 30 % of the fabric **and** at least 30 % of
the participating set.

### The kill is staged from the production dispatch, and it is complete before any frame lands

The wrapper wraps `RemoteExecutor.execute` one layer down from the driver, so the *production*
`RemoteExecutor` still dispatches and the *production* `submitJob` still places; what the wrapper
decides is **when**. Every executor awaits the **same** promise (`killing ??= …`), so the kill
finishes before any frame reaches any agent — deterministic on purpose, because a wrapper that
let the kill overlap the first dispatches would sometimes let a victim answer and the file would
then measure nothing while printing green.

The instant is the one the criterion is about: `submitJob` places every shard first, so the first
`execute` call is the first moment at which the job has been placed and nothing has been
dispatched. That is `churn.test.ts`'s hardest case — *a node that dies between placement and
dispatch*.

**And the mid-flight-ness is read rather than asserted by construction.** Per shard, the killed
run's `attempted` prefix equals the control's `attempted` in full: the killed run's first
generation placed exactly where the control placed, which it could only do by having been placed
while all ten agents were still answering offers.

**The kill precondition is labelled as what it is.** `victim.child.signalCode === 'SIGKILL'` and
`exitCode === null`, with the file stating in a comment that **no deletion in production code
turns those two lines red** — they measure this test's own kill. The plan asked for exactly that
honesty and it is there. `killStagedAt` is separately asserted non-null, so a run in which the
wrapper never fired cannot satisfy the rest by simply never losing a node.

### "Unchanged" is three equalities, not one

- `killedCids` equals `controlCids` — per shard, by result CID.
- `jobAnswer(killed)` equals `jobAnswer(control)` — one CID over `{module, ordered shard CIDs}`,
  which closes wrong-order and wrong-module at once and is still an equality against the control.
- per-shard `usefulFuel` equality — *"the answer cost the same to compute however many
  generations it took to get one"*, a reading a CID equality cannot make because fuel is not part
  of the address.
- **`grossFuel` equality**, which says something sharper: a vanished process produces no receipt
  and therefore no fuel, so **the churn tax is paid in round trips, not in recomputation.** The
  file names what would move it — a merge that unioned more than `REDUNDANCY` answering replicas
  into one shard, which cannot happen while the top-up places only the shortfall.

### The dead are named, and named as losses

- `redispatches > 0` against the control's `0`, in the same run — a ratio inside one run, not a
  threshold sited against a host.
- some shard has `generations > 1`; no node appears twice in any one shard's `attempted`.
- **every** victim appears in a lease event, **and** appears in an `expired`-or-`surrendered`
  event — the assertion that depends on *which* nodes died, not on a count.
- no victim appears in a `completed` event — *"a history that named the dead only as grantees
  would satisfy the reading above and would mean the loss was never noticed."*
- `abandoned` is empty: a job that completed cannot have spent a task's generations.

### The `churn.test.ts` coverage table 20-12 needs is in the file's header

Delivered where 20-12 will actually find it rather than in a planning document. It marks four
behaviours **yes**, and two **no** with reasons: the trapping-module case (no trapping module
here, and `submitJob` structurally cannot make the node/task distinction per 20-CONTEXT.md's
ruling) and checkpoint resume (20-11).

### The entry-point substitution is stated in the file

With the measurement beside it: `grep -c 'submitJob\|JobSpec\|executeVerified'` over
`packages/node/src/bin/agent.ts` returns **0**, so *"run through `bin/agent.ts`"* is satisfiable
only as *"a job run across `bin/agent.ts` processes."* The plan required this be said in the file
and not only in a plan, *"because Phase 19 learned that a substitution living in a plan reaches
nobody reading the test."*

## What could NOT be determined from the evidence

**Do not fill these by inference.**

- **No plant record exists.** The plan required three plants — return the first generation's
  result unchanged; change one shard's input in the killed run; attribute every failure to a fixed
  placeholder node id — and *"record every observed failure text for 20-13."* **Not one line of
  observed failure text from this executor survives.** No abandoned plant was attributed to this
  plan either; the whole-tree sweep found only 20-04's.
- **No `/usr/bin/time -p` figures, no `real`/`user`/`sys`, no `(user+sys)/real` ratio** — all four
  required by the plan's `<execution_context>` and `<verification>`. Not recorded.
- **No measured span for the file.** This is the input Task 2 needed for `vitest.config.ts` and
  the reason that half did not land.
- **No printed run output.** The file emits one `console.log` per run carrying `standUp` ms,
  control ms, killed-run ms, participant and kill counts, `redispatches` against the control's,
  per-shard `generations`, the endings, the lease-event kinds naming the dead, and gross/useful
  fuel against the control's. **Nobody wrote down a run.** Every one of those numbers is
  obtainable in one run today and none of them is in the record.
- **No `tsc --noEmit` or vitest exit code from this executor.**

### One claim in the landed file that the record does not support

The docblock above the loss-kind assertion states: **"Measured here: every loss is a
`surrender`."** There is **no surviving run output** behind that sentence, and the assertion
underneath it is the *disjunction* (`expired | surrendered`) — so a green run does not establish
it either. Treat it as an unverified claim in a comment until somebody runs the file and reads
the printed `lease events naming the dead [...]` list. Flagged here rather than repeated as fact,
because this repository has closed ten defects whose recorded diagnosis was wrong and three of
those false claims sat in a comment that read like evidence.

## Evidence that it passes, and its exact scope

`9acd85f`'s message records the whole node project after restoration at **142 files, 2024 passed,
2 skipped, ONE failed** — and states the failure is `enrollment-dos.node.test.ts`, unrelated to
this work. `churn-agents.node.test.ts` runs in the `node` project, so it **is** covered by that
reading. That is the only recorded evidence that this file is green, it was taken by the salvage
pass rather than by this plan, and it does not isolate this file.

## Outstanding — work this plan owed and did not do

1. **`vitest.config.ts` — the whole second half of Task 2.** The plan gave this plan sole
   ownership of that file for wave 2 and required:
   - this file's measured span added to `MEASURED_NODE_SPANS` if above `SLOW_CUTOFF_MS` (1 000);
   - **20-03's handed-over span** for `packages/node/src/late-combine.node.test.ts` — measured by
     that plan at **8.49 s wall / 7.74 s of test time** and explicitly not edited there because
     20-05 owned the file.

   Neither landed. `vitest.config.ts` is untouched since Phase 19 (`b17baa3`). A ten-process
   spawned-agent spec is very unlikely to sit under a 1 000 ms cutoff, but **its span was never
   measured**, so even the eligibility is unestablished.
2. **The node project's file count has now drifted past the tolerance —
   `slow-specs.node.test.ts` IS RED, measured while writing this summary.**

   `NODE_MEASUREMENT.files` is **138** in `vitest.config.ts`; `FILE_COUNT_TOLERANCE` is **5** in
   `slow-specs.node.test.ts`. 20-03 handed over a reading of 141 (drift 3); `9acd85f` records 142
   after this file landed (drift 4). Measured 2026-08-04 20:47 by running the spec directly:

   ```
   FAIL |node| packages/node/src/slow-specs.node.test.ts > the recorded measurement still
        describes this repository > has not drifted further from the measured file count than
        the tolerance allows
   AssertionError: the node project holds 144 test files, the recorded measurement covered 138.
   … expected 6 to be less than or equal to 5
   Test Files  1 failed (1)   Tests  1 failed | 7 passed (8)
   ```

   **This is not a claim about who added the last two files.** The guard globs the filesystem
   rather than the index, so it counts a concurrent agent's untracked specs too — one such file
   was present on disk when the reading was taken. What *is* attributable to this plan is that
   the tolerance had already been consumed to 4 of 5 with no re-measurement, because the
   `vitest.config.ts` half of Task 2 never landed. The guard's own remedy is the work this plan
   owed: *"Re-measure … and update `MEASURED_NODE_SPANS` and `NODE_MEASUREMENT` in
   `vitest.config.ts`."*

   It now blocks every agent's commits repo-wide until somebody re-measures — defect **#39**'s
   shape, arriving from a gap this plan left rather than from a foreign in-flight file. 20-07
   through 20-11 are still to run and each may add specs.
3. **`.planning/REQUIREMENTS.md` was not updated.** The `CHURN-01` and `CHURN-04` traceability
   rows both still read *"Built, not wired — runResilient has no caller; submitJob is the only
   job path and does not speculate or re-dispatch."* That is false of the tree since 20-01 and
   this plan measured it false across ten processes.
4. **No mutation-ledger rows were added.** 20-13 inherits an empty hand-off from this plan on top
   of the missing plant texts.
5. **`.planning/STATE.md` and `.planning/ROADMAP.md` were not advanced** for this plan.

## Out of scope, untouched

`packages/core/src/job/submit.ts`, `packages/net/src/churn.test.ts` (20-12 deletes it),
`vitest.config.ts` (owed, not done), speculation (20-07/20-09), coverage (20-08/20-10),
checkpointing and a departed *requestor* (20-11 — this plan kills executors, not the submitter).

The file states what it cannot redden on and the statements are checkable: lease **renewal**
(nothing here holds a lease near `RENEW_AT`, because `RPC_TIMEOUT_MS` 10 000 bounds every
dispatch well below 20 s), speculation (no production path at this wave), a departed requestor,
and `verification.failures` naming the dead on a shard that recovered (the `agreed` arm carries
no `failures` field — the same type-level fact 20-04 hit).

## Self-Check: PASSED (performed by the retrospective writer, not by the executor)

- `packages/node/src/churn-agents.node.test.ts` — FOUND, 773 lines, new in `9acd85f`
- commit `9acd85f` — FOUND
- `describe('CHURN-01 / criterion 2 — 30 % of the fabric dies mid-job and the answer is unchanged')` — FOUND at HEAD
- `AGENT_COUNT`, `KILL_FRACTION`, `SHARDS`, `REDUNDANCY`, `RPC_TIMEOUT_MS`, `stageTheKill`, `killAgent`, `jobAnswer`, `resultCids` — all FOUND at HEAD
- `vitest.config.ts` — **UNCHANGED since `b17baa3`** (this is the finding, not a failure of the check)
- `NODE_MEASUREMENT.files: 138` in `vitest.config.ts` and `FILE_COUNT_TOLERANCE = 5` in `slow-specs.node.test.ts` — both VERIFIED at HEAD
- **NOT verified, because no such record exists:** any plant, any observed failure text, any
  span, any exit code, any printed run output, or the "every loss is a `surrender`" measurement
  claim in the file's own docblock.
