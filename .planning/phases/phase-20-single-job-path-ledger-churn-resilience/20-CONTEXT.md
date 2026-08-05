# Phase 20: Single Job Path, Ledger & Churn Resilience — Context

**Gathered:** 2026-08-04
**Status:** Ready for planning

<domain>
## Phase Boundary

`submitJob` becomes the one job path: a shard whose executor refuses or dies is placed again
under a lease, a straggler is duplicated, coverage over owners is accounted, and `runResilient`
stops existing as a second implementation nothing calls. Every node keeps a real start-outcome
ledger, so a peer's counts reach another node's report instead of being answered with `[]`. And a
combine result from a recovered node finally has somewhere to arrive.

**Read the measured findings below before planning. The ROADMAP's `Research: None` line for this
phase is wrong on one count, and it is the count criterion 1 names first.** It says
*"`runResilient`'s lease/speculation/coverage machinery exists and is unit-verified in Phase 7;
the gap is that nothing calls it"*. That is true of speculation and of coverage. It is **false of
lease renewal** — see the first decision below.
</domain>

<decisions>
## Implementation Decisions

### The entry point needs the same substitution Phases 18 and 19 recorded

`bin/agent.ts` **submits no job**. Measured 2026-08-04: `grep -c 'submitJob\|JobSpec\|
executeVerified' packages/node/src/bin/agent.ts` returns **0**. It is a serving node whose only
stdout is a handshake JSON.

So criterion 1's *"run a job through `bin/agent.ts`"* and criterion 2's *"run through
`bin/agent.ts`"* are satisfiable only as **"a job run *across* `bin/agent.ts` processes"** — an
in-process requestor `FabricNode` submitting to spawned agent processes, the shape
`discovery-agents.node.test.ts`, `quorum-agents.node.test.ts` and `owner-domain-agents.node.test.ts`
all use. **Record the substitution in the test file's own header**, not only here; Phase 19 learned
that a substitution living in a planning document reaches nobody reading the test.

### Lease renewal needs BUILDING, not wiring — and this is the roadmap line's error

**`LeaseTable.renew` and `shouldRenew` have no caller anywhere in the tree except
`lease.test.ts`.** Measured: `grep -rn 'shouldRenew\|\.renew(\|RENEW_AT' packages tools
--include='*.ts'` returns only `lease.ts`'s own definitions, `lease.test.ts`, and the barrel
re-export at `core/src/index.ts`. **`runResilient` never renews a lease** — it grants, completes,
surrenders and reaps, and nothing else.

So criterion 1's clause *"it performs **lease renewal** … internally"* cannot be closed by wiring
an existing caller. There is no existing caller to wire.

**What renewal must mean here, and the trap.** In `runResilient`'s own words the lease *is* the
deadline: *"silence gets a deadline … the only safe response to 'I cannot tell' is to wait a
bounded time."* A renewal extends that deadline. **A renewal granted on a timer alone is a longer
timeout wearing a lease's clothes** — it makes the bound unbounded and it would be dishonest to
present it as CHURN-04. Renewal must be conditional on **evidence that the holder is still
working**.

**The evidence channel already exists and is unauthenticated, so no protocol change is needed.**
`serveAgent`'s `exec` branch keys its capacity slot on `` `${task.inputCid}:${task.partitionIndex}` ``
(`packages/net/src/agent.ts`, search `const slotKey`), and `LocalCapacity.offer` refuses a second
claim on a held key with `` `${offer.shardId} is already in flight here` `` (`placement.ts`, search
`is already in flight here`). A requestor that offers the **same slot key** to the node currently
holding the lease and is refused *as a duplicate* has positive evidence the holder is still
running that exact task. `discovery-agents.node.test.ts` already documents this key derivation
against itself, so the technique is established rather than invented here.

**The requestor's way of asking a node anything is `JobSpec.admit`**, which is optional. So:
renewal is available where `admit` was supplied and the lease lapses on time where it was not.
That asymmetry is a *stated behaviour*, not a default — write it into `JobSpec.admit`'s doc, which
already carries a paragraph of exactly this kind. **Do not add a second optional hook for it.**

**If a planner or executor concludes that this evidence channel is out of scope, say so and stop —
it is an owner ruling, not a discretionary simplification.** The phrase "lease renewal" is in the
criterion; RULING A forbids lowering a bar to let a phase close.

### The failure kind is lost at the `Executor` port, and the retry policy must not sniff strings

`runResilient` gets `DispatchOutcome` with `kind: 'node' | 'task' | 'sender'` from
`remoteDispatch` (`packages/net/src/churn.ts`), and that distinction is what stops one bad task
from burning the fabric. **`submitJob` does not have it.** `Executor.execute` returns
`ExecutionOutcome`, and `executeVerified` flattens every failure to `{nodeId, reason}` — its own
header says the flattening is deliberate: *"an unreachable replica and a trapping module are both
just 'this node did not agree'."*

**Decision: do not parse `reason` strings for policy, and do not widen the `Executor` port in this
phase.** Approximate the distinction the way `DEFAULT_MAX_TASK_FAILURES`'s own docblock already
argues for it: *"Three independently-chosen nodes all running the task and all failing it is far
better evidence of a bad task than of three unlucky nodes."* Count **distinct nodes that failed**,
not failure kinds. `DEFAULT_MAX_GENERATIONS` (3) is the same number for the same reason and is the
bound to reuse.

**Say in the plan and in the summary what this costs**: a shard whose module traps burns up to
`maxGenerations` nodes instead of being given up on after the first classified `task` failure. That
is a liveness cost bounded by 3, and it is the honest trade for not string-matching. If a later
phase wants the sharp distinction, the mechanism is a kind on `ExecutionOutcome` — a new decision,
not a widening of this one.

### Coverage: derive the owner set from the shards. Do NOT add a required `JobSpec` field

`CoordinatorOptions.expectedOwners` is optional in `runResilient` and defaults to the owners its
`work` names. **The derived answer is the correct one and needs no new field**: a shard is defined
for an owner whether or not that owner's node is up, so an owner with an unplaceable shard is still
*expected* and correctly lands in `CoverageReport.missing`. A required `JobSpec` field here would
be a five-site fan-out (`bin/bench.ts`, `demo/main.ts` ×2, `core/executor/task-worker.ts`,
`bench/perf-workload.ts`) buying nothing that derivation does not already give.

**This is not a contradiction of the `onQuorumShortfall` precedent.** That field encodes a *choice
the caller must state*; this one encodes a *fact already present in the caller's own input*. WIRE-01
is about choices with silent defaults, not about derivable values.

**`CoverageReport` alone is the wrong shape for `JobResult`, and this will be got wrong.**
`coverageOf`'s own comment: *"An empty job is not a complete one — '0 of 0 owners' answers nothing"*
— so `complete: false`, and `describeCoverage` renders `covered: 0/0 owners — PARTIAL (no owners
were expected)` for **every public job in the repository**. Ship that and every benchmark rung
prints PARTIAL. Carry a named union instead — `CoverageReport | 'defines-no-owners'` — so a public
job says what it is rather than failing a test it was never entered for. Same shape as
`'keeps-no-ledger'`, `'signs-nothing'`, `'carries-no-certificate'`.

### The peer ledger cannot merge above 1 until a node records its own row — measured on paper, verify it

Every production node passes `ledger: 'keeps-no-ledger'` to `serveAgent`
(`fabric-node.ts`, `browser-node.ts`, `bin/bench.ts` ×2, `perf-workload.ts` ×2 — six sites, all
count-pinned by `serve-agent-hooks.node.test.ts`). So `agent.ts`'s report branch answers
`counts: []` and `publishStartOutcome` merges nothing.

**Handing those sites a real `StartOutcomeLedger` is necessary and is not sufficient**, and this is
the most likely way to build criterion 5 and watch it read `1`:

`serveAgent` records only what a **peer** told it (`if (request.outcome !== null)
ledger?.record(request.outcome)`). A node's own outcome never enters its own serve-side ledger. So
with two tabs A and B: A publishes to B, so B holds `{A's row}`; B publishes to A, so A holds
`{B's row}`. A then asks B and is handed back **its own row**, and `mergeOverlapping` takes the
maximum per `(browser, result)` key — so A's merged report reads `1`, forever, however many tabs
are open.

**Decision: a node records its own start outcome into its own serve-side ledger at construction.**
Then B answers with `{B's own row, A's row}` and A's merged report holds a row A could not have
produced. Carry the outcome as a required union with a named sentinel —
`startOutcome: StartOutcome | 'reports-no-start-outcome'` — never an optional. Both tiers, on
identical terms; `currentBrowserLabel()` (`packages/browser/src/browser-id.ts`) supplies the
browser tier's label and `BROWSER_FAMILIES` already contains `'other'` for the Node tier.

**The load-bearing reading for criterion 5 is a row for a family the reading tab is not.** A
chromium tab whose merged report contains a `firefox` row cannot have produced that row locally;
there is no expression in the page that could. Assert *that*, not `reported > 1` — a count is
satisfiable by accident and a foreign family label is not.

**The demo's own deferral condition is now satisfied, and this must be stated rather than
stepped over.** `demo/index.html`'s `refreshReport` comment defers the serve-side ledger *"behind
the magnitude bound and the label whitelist, because publishing per-peer start outcomes across the
fabric before those land is the fingerprint the disclosure promise in `start-outcome.ts` exists to
prevent."* **Both landed.** `MAX_REPORTED_COUNT` (65 536) and `isStartBrowserLabel` are both
enforced in `protocol.ts`'s `parseCounts`. The plan that flips those sites must quote the
deferral, name both bounds by symbol, and replace that comment — a stale deferral left in place
reads as an open decision to the next person.

**What is still unbounded, and it is not this phase's to close unless a plan chooses to.**
`StartOutcomeLedger`'s docblock: *"The row count is a separate matter and is still unbounded — only
a cap at the wire boundary closes that, and it is not here."* `parseCounts` caps each entry's
magnitude and validates each label but does not cap the array length; today the only bound is
NET-08's inbound message ceiling. **Measure whether NET-08 actually bounds it before writing either
"bounded" or "unbounded" in a summary.**

### The late-arrival channel exists, one layer below `executeReduce`

`tree-reduce-agents.node.test.ts`'s header says *"`executeReduce` has **no late-arrival channel** —
it walks the ranking, stops at `wanted` replicas, and there is no production path on which a result
arriving after that can be received at all."* **That is true of `executeReduce` and false of the
endpoint underneath it.** `packages/net/src/rpc.ts` — search `late or duplicate reply` — is:

```
if (entry === undefined) return // late or duplicate reply
```

A reply whose pending entry the timeout already deleted **is received, is decoded, and is
dropped there**. That line is criterion 6's mechanism and it already exists. The clause was never
"build a late-arrival handler"; it was "produce a real late arrival and read what happens to it",
and Phase 16 could not produce one because it had no recovery path.

**The recovered node.** SIGSTOP the process holding rank 0 of a combine's rendezvous ranking, let
the requestor's `rpcTimeoutMs` elapse, let `executeReduce` walk on and collect `wanted` from
later-ranked agents, then SIGCONT. Its reply arrives at a requestor that has stopped waiting.
`tree-reduce-agents.node.test.ts` already stages a mid-flight `killAgent` *"one layer down, wrapping
the **production** dispatch"* — copy that technique; it is the same seam.

**This is the part to measure rather than assume.** Whether a libp2p stream survives a SIGSTOP long
enough for the reply to arrive after SIGCONT is **unverified**, and the plan says so. If it does
not, that is a finding to report, not a case to fake: fall back to an in-process fabric whose
transport withholds and later releases the frame, and **label which arm carries the claim**.

### `runResilient`'s removal takes two test files and one adapter with it — decide, do not discover

- `packages/core/src/coordinator.test.ts` — **26** `runResilient({…})` calls.
- `packages/net/src/churn.test.ts` — **6**.
- `packages/node/src/admission.node.test.ts:319` drives `remoteDispatch` through `runResilient`.
- `packages/net/src/churn.ts`'s `remoteDispatch` exists to preserve a failure kind `submitJob`
  cannot use (above). Its only consumers are those tests.
- `core/src/index.ts` re-exports `runResilient`, `CoordinatorOptions`, `CoordinatorOutcome`,
  `DispatchOutcome`, `ShardDispatch`, `ShardOutcome`, `ShardWork`.

WIRE-04's wording is *"without the caller choosing between two functions"*, so **a barrel export
that lets a caller bypass `submitJob` is the requirement's own failure mode.** The exports go.

**Each of those 32 kernel cases states a behaviour that must survive somewhere.** The plan that
removes `runResilient` must, for each case, either re-target it at `submitJob` or record why the
behaviour no longer exists — a list, in the summary, case by case. Deleting a suite because its
subject was deleted is how a phase loses a guard and calls it cleanup.

### Blast radius — `submitJob` behaves differently now, and the whole tree reads it

`submitJob` has four production submitters and is exercised by most `*.node.test.ts` files. A
re-dispatch turns shards that used to end `insufficient` into shards that agree; speculation
changes dispatch totals, `grossFuel` and `verificationMultiplier`; a new `JobResult` field breaks
every construction site.

- **Every plan touching `submit.ts` owns a full `npx vitest run --project node` run**, not just its
  own files, and either fixes or annotates what moves.
- **`tsc` finds construction sites, not reader sites.** Phase 19 measured this twice — 19-13 found
  three `toEqual` sites that compiled clean and failed at runtime; 19-14's `tsc` worklist
  enumerated 4 of 34 readers. **Run a grep for the symbol beside the type-check and reconcile the
  two lists.**
- **`mutation-guard.node.test.ts` reddens the moment `submit.ts`'s
  `const verification = await executeVerified(task, selectedExecutors)` line changes**, because
  that string is `M36`'s `find`. That is not a surprise to diagnose; it is the scheduled arrival.

### Comparative readings, and citation by symbol

Both are standing rules (`CLAUDE.md` § Measurement) and both bite here.

- A churn or speculation reading is timing-shaped, and an absolute millisecond threshold encodes
  the host. Prefer **a ratio taken inside one run**: the same fabric with and without the kill; the
  same job with speculation enabled and disabled; a shard's re-dispatch count against its own
  attempt count. Where an absolute is unavoidable, **say what it was sited against**.
- **Cite by grep-able symbol, never by line number.** Line citations in this repository drifted
  three times in one day, twice inside the very commits written to correct drift (19-VERIFICATION
  W7, W8, W9). Every citation in every Phase 20 plan and summary names a symbol or a quoted string.

### Claude's Discretion

- Whether the merged loop lives inline in `submit.ts` or in a private module beside it that
  `submit.ts` is the only importer of. **Not** discretionary: it must not remain reachable from the
  barrel.
- The exact field names added to `JobResult`, provided a public job cannot be made to read PARTIAL.
- Whether the renewal probe reuses `JobSpec.admit` or an argument derived from it.
- Fixture sizes, spawn counts and which existing `*-agents.node.test.ts` fixture to copy.

</decisions>

<code_context>
## Existing Code Insights

### The symbols, measured rather than assumed (2026-08-04)

| symbol | definition | production callers |
|---|---|---|
| `runResilient` | `packages/core/src/coordinator.ts` | **zero** (barrel re-export only) |
| `LeaseTable.renew` / `shouldRenew` / `RENEW_AT` | `packages/core/src/lease.ts` | **zero — including `runResilient`** |
| `SpeculationLedger` / `stragglers` / `speculativeCandidates` / `settleRace` | `packages/core/src/speculation.ts` | **zero** outside `coordinator.ts` |
| `coverageOf` / `describeCoverage` / `withCoverage` | `packages/core/src/coverage.ts` | **zero** outside `coordinator.ts` |
| `checkpointOf` / `writeCheckpoint` / `readCheckpoint` / `remainingWork` / `recoverCheckpoint` / `checkpointChain` | `packages/core/src/checkpoint.ts` | **zero** — `coordinator.ts` does not even import it |
| `remoteDispatch` | `packages/net/src/churn.ts` | **zero** (tests only) |
| `StartOutcomeLedger` | `packages/core/src/start-outcome.ts` | constructed once, inside `publishStartOutcome`, per call |
| `publishStartOutcome` | `packages/net/src/start-report.ts` | one — `demo/main.ts`'s `startReport()` |

### Reusable assets

- `packages/node/src/discovery-agents.node.test.ts` — the spawned-provider + spawned-agents +
  in-process-requestor fixture, with `ANNOUNCE_BUDGET_MS`, `PROCESS_TEST_TIMEOUT`,
  `VERDICT_DEADLINE_MS` and the pre-seeding order recorded. **It also holds the armed tripwire.**
- `packages/node/src/tree-reduce-agents.node.test.ts` — `standUp(8)`, `spawnAgent`, `stopAgent`
  (SIGTERM, a *leave*), `killAgent` (SIGKILL, a *vanish*), `runMap`, a submitter at
  `rpcTimeoutMs: 10_000`, and the mid-flight kill staged by wrapping the production dispatch.
- `packages/net/src/churn.test.ts` — a `MemoryNetwork` fabric with `remoteDispatch`, real
  `WasmExecutor`s, a 30 %-kill case and a checkpoint resume case. The behaviours to preserve.
- `packages/node/src/static-rendezvous.e2e.test.ts` — three engines (chromium, firefox, webkit),
  own `browserType.launch()` each, a dumb 404-ing file server over `dist/`, `?relay=` as the only
  address supplied, and **no `window.o2.dial` anywhere**. The fixture shape criterion 5 needs.
- `packages/core/src/coverage.ts`'s `describeCoverage` already emits
  `covered: X/Y owners` — criterion 4's literal string.

### Guards that will read this phase's edits

- `packages/node/src/mutation-guard.node.test.ts` — reddens when any ledger entry's `find` no
  longer matches its file. `M36`'s `find` is a line `submit.ts` is about to change.
- `packages/node/src/serve-agent-hooks.node.test.ts` — count-pins `'keeps-no-ledger'` at 1 in
  `fabric-node.ts`, 1 in `browser-node.ts`, 2 in `bin/bench.ts`, 2 in `perf-workload.ts`, and pins
  the argument lists of both factories against each other.
- `packages/node/src/requirements-ledger.node.test.ts` — parses REQUIREMENTS.md rows and
  re-derives call sites; scope was widened to *Partial* rows on 2026-08-02.
- `packages/node/src/slow-specs.node.test.ts` — parses `vitest.config.ts`'s source, so
  `SLOW_NODE_SPECS` / `MEASURED_NODE_SPANS` edits are guarded. Never write a span you did not
  measure.
- `packages/node/src/sovereign-block-refusal.node.test.ts` — pins the set of files allowed to call
  `SubmitOptions.sovereignCids`.
- `packages/node/src/discover-arm.node.test.ts` and `bench-attestation.node.test.ts` snapshot
  `git status --porcelain` around themselves. **`git add` only between runs, never during one.**

### Integration points

- `submitJob` — `packages/core/src/job/submit.ts`. Path: `spec.nodes` → `candidateNodes` → the
  job-level quorum gate → `planPlacement` (no `admit`) / `planWithOffers` (`admit` present) →
  `executeVerified` → `receiptFor` → `ShardResult` → `JobResult`.
- `executeVerified` — `packages/core/src/job/verify.ts`. Returns `insufficient` only when **every**
  executor failed; otherwise `agreed` with `replicas: answered.length`, which can already be below
  the requested redundancy. **Both are re-dispatch triggers**, and treating only `insufficient` as
  one leaves a silently under-replicated shard.
- `Observation.speculationMultiplier` is the literal `1` and `Observation.redispatches` the literal
  `0` at `bin/bench.ts` and at `perf-workload.ts`, each with a comment saying why. `harness.ts`
  averages them into `speculationTax` / `churnTax` and `report.ts` prints both columns. **The
  surface for criterion 3's cost accounting already exists and is publishing constants.**

</code_context>

<specifics>
## Specific Ideas

### The three clauses carried into this phase, and who owns each

1. **Phase 18 criterion 2b's re-pick — owned by plans 20-01 (mechanism) and 20-04 (reading).**
   The refusal half is closed and measured (SCHED-06). The re-pick is not, because `submitJob`
   calls `executeVerified` exactly once per shard.
   **A tripwire is already armed**: `discovery-agents.node.test.ts` asserts a shard ends
   `insufficient` with the refusal in `verification.failures`, on a shard whose **selected**
   executor refuses at exec. **Adding the re-pick makes that test go RED, and that is CORRECT** —
   it is the scheduled clause arriving, not a regression. 20-04 rewrites the assertion to require
   the re-pick.
   `M36` is that defect planted deliberately; its own `why` says *"When WIRE-04 really lands, this
   entry is the thing to delete — not the assertion, which by then has a behaviour to describe."*
   **Read M36 before writing 20-01.** The instrument it replaced was a tautology —
   `expect(shard.verification.agreeing).toHaveLength(1)` where `agreeing ⊆ placement.nodeIds` whose
   length **is** `redundancy` = 1, under an `agreed` narrowing that excluded 0. Do not replace it
   with another one.

2. **Phase 16 criterion 3 → this phase's criterion 6 — owned by plan 20-03.** Phase 16 established
   the dedupe across nine real processes and said, against its own interest, that *"arriving late"*
   was staged by the test. MR-04 and MR-07 stay open on that account.

3. **The `admit:` finding at `bin/bench.ts` — CLOSED. Do not re-plan it.** 19-17 guarded it in
   `bench-reduce.node.test.ts`, which proves each requirement falsifiable via `plantedSource`.
   It is noted here only so nobody re-opens it after reading Phase 18's or Phase 19's deferred
   lists, where it is still described as open.

### CHURN-03 has no criterion, and that is a gap in the phase's contract

`CHURN-03` — *"Coordinator state is checkpointed to content-addressed storage so a departed
requestor does not lose the job"* — is on Phase 20's `Requirements:` line and is named by **none**
of the six success criteria. Its REQUIREMENTS row reads *"Built, not wired — `checkpoint.ts` is not
even imported by `coordinator.ts`, and `runResilient` itself has no caller."*

It is planned here (20-11) because the requirements line claims it, and because
`PROJECT.md`'s recorded ordering decision places *"coordinator checkpointing in the churn phase"*
and this is that phase. **But a verifier scoring criteria will not score it**, and the project's own
rule is that *the count is over criteria, never over requirements*. Surfaced for an owner ruling:
either criterion 7 is added, or CHURN-03 is explicitly deferred with its row left honest. **Do not
resolve this by dropping the plan.**

### Not this phase's, listed so they are not re-found

- **Phase 19 criterion 5 (enrolment cost)** — still PARTIAL and awaiting an owner ruling between a
  built per-identity price and an amendment to the bound-made-durable reading. Untouched here.
- **`#39`** — a repo-wide guard blocks every agent when any one has an in-flight violation.
  Operational, not Phase 20's.
- **W7–W11 from `19-VERIFICATION.md`** — four are stale line citations and one
  (`reservation-exhaustion.node.test.ts`'s unasserted "still serving directly") is a measured
  hole. None is Phase 20's unless a plan happens to touch the file.
- **`tools/aot/lift.node.test.ts`** — Phase 21 owns `tools/aot`.
</specifics>

<deferred>
## Deferred Ideas

- **A failure kind on `ExecutionOutcome`.** Would restore `runResilient`'s sharp `node`/`task`
  distinction to `submitJob`. Deliberately not done here; the distinct-node count is the honest
  approximation and its cost is stated above.
- **A row-count cap on inbound report frames.** `parseCounts` bounds each entry's magnitude and
  validates each label but not the array length. Measure whether NET-08's ceiling covers it; if it
  does not, that is a finding, and closing it is a new decision.
- **Giving the browser tier a real `reservations` thunk.** Phase 19's deferral stands unchanged.
- **Multi-browser coverage for the remaining nine e2e specs.** Criterion 5 brings the standard to a
  second file; retrofitting the rest is its own measured task.
</deferred>
