---
phase: phase-13-egress-manifest-completeness
plan: 05
subsystem: infra
tags: [egress, sovereignty, data-governance, o2-node, refusal, process-boundary]

# Dependency graph
requires:
  - phase: phase-13-egress-manifest-completeness
    plan: "04"
    provides: EgressGuard.send records then rejects with EgressRefusal, so a frame carrying a registered sovereign payload never reaches the inner transport
  - phase: phase-13-egress-manifest-completeness
    plan: "02"
    provides: FabricNode.egress and the registerSovereignInputs composition inside FabricNode.start
  - phase: phase-12-sovereign-placement
    provides: sovereignty-placement.node.test.ts — the spawn scaffolding and the descriptor arrangement that makes ownership the only exclusion
provides:
  - packages/node/src/egress-refusal.node.test.ts — ROADMAP criterion 1 measured across two real bin/agent.ts operating-system processes, with the owner's blockstore seeded on disk before her process opens it
  - packages/node/src/egress-manifest.node.test.ts DATA-05 — the in-process proof that the shard fails *because of* the owner's own recorded refusal, and that it does not relocate
  - A control-job idiom for both files: the same two live nodes, the same budget, one argument different (the module), run *after* the refusal so process death cannot explain the failure
affects: [phase-13-plan-06, phase-13-plan-07, phase-19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A refusal test needs a control job on the same live nodes afterwards: 'insufficient' alone cannot distinguish a refused frame from an unreachable, dead, or slow peer"
    - "Split the claim by what each vantage point can see — the in-process file reads the owner's manifest and proves the mechanism; the spawned-process file cannot and proves the consequence. Neither is asked to carry the other's half"
    - "Seed the owner's blockstore directory from the test process before spawning her agent, and assert the returned CID equals the independently computed one, so a mis-seed cannot pass silently"

key-files:
  created:
    - packages/node/src/egress-refusal.node.test.ts
  modified:
    - packages/node/src/egress-manifest.node.test.ts

key-decisions:
  - "The requestor's RPC budget is chosen per file and justified against its own control job — 5 s in egress-manifest.node.test.ts, 10 s in egress-refusal.node.test.ts. Both were measured: the whole of each test outside the one refused dispatch cost ~105 ms and ~600 ms respectively, so the budget is demonstrably ample rather than assumed to be"
  - "egress-refusal.node.test.ts uses bare submitJob, not submitJobWithEgress. The submitter's own manifest is not the subject, and supplying its guard would invite a reader to think the assertion depends on it"
  - "The spawn scaffolding is duplicated from sovereignty-placement.node.test.ts rather than extracted. This repository already carries two byte-identical copies; a third is cheaper than putting this plan's changes into a file other concurrent work may hold"

patterns-established:
  - "Mutation B (removing registerSovereignInputs from fabric-node.ts) is the only evidence that the spawned-process test's failure depends on registration happening *inside the child*. tsc --noEmit stays at exit 0 under it, so the type-checker would never have caught it"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 14min
completed: 2026-07-28
---

# Phase 13 Plan 05: The Refusal, Measured at Both Levels Summary

**A cross-owner sovereign job now fails from the submitter's own reading across two real `bin/agent.ts` processes — the shard stalls at its owner with exactly one failure naming her, her process is still alive afterwards, and a control job differing only in the module succeeds through the same two processes moments later.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-28T12:58 -0700
- **Completed:** 2026-07-28T13:12 -0700
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **The DATA-05 assertion is inverted, and it is now the criterion's own sentence.** `packages/node/src/egress-manifest.node.test.ts` asserted `'agreed'` while the raw row crossed. It now asserts `'insufficient'`, `job.complete === false`, exactly one failure naming alice, the violation label on alice's own manifest, and the recorded entry carrying that same label.
- **The shard does not relocate.** An idle second node sits in the same job with `canExecuteSovereign: true` and `load: 0` against alice's `load: 1`, so ownership is the only thing left that can exclude it. It is never dispatched to. Asserted in both files: `failures` has length 1, its `nodeId` is alice's, and the second peer appears in no failure at all.
- **`packages/node/src/egress-refusal.node.test.ts` is new and spawns two genuine operating-system processes** from `bin/agent.ts`, following `sovereignty-placement.node.test.ts`'s precedent exactly. Alice is spawned with `--owner-id alice --can-execute-sovereign`; the second process is spawned with no sovereignty arguments at all, the way any node starts. The submitter is a `FabricNode` in the test process because the binary is serving-only and never calls `submitJob`.
- **The owner-pinned premise is made literal rather than assumed.** Alice's blockstore directory is opened with `FsBlockstore` and seeded with the canonical bytes of her row *before* her agent process is spawned, and the CID the put returns is asserted equal to the one the test computed independently. Without that seed, `registerSovereignInputs` inside the child would silently skip and the tap would watch for nothing.
- **The control job is what makes the failure attributable.** In both files it runs *after* the refusal, on the same live nodes, with the same row, owner, descriptors and RPC budget, changing exactly one argument — the module. Four alternative explanations die in one reading: unreachability, process death, module-fetch failure, and a budget too short to finish in. In the spawned-process file alice's `exitCode` and `signalCode` are additionally asserted still `null`.
- **Both production guarantees were watched failing.** Mutation A (delete the refusal throw) and Mutation B (remove `registerSovereignInputs` from `fabric-node.ts`) each made both of this plan's tests fail, with the verbatim output below. `npx tsc --noEmit` stayed at exit 0 under Mutation B, so nothing but these tests would have noticed it.
- **The evidentiary claim 13-03-PLAN.md borrowed by inverting `12-VERIFICATION.md` is gone.** `egress-manifest.node.test.ts`'s header no longer cites a precedent for the in-process standard. It states the actual reason instead: the owner's manifest is not a value anywhere outside her own process, so reading it *requires* in-process, and the process-boundary claim is carried by the new file rather than asserted here.

## Task Commits

1. **Task 1: the in-process proof — the refusal fails the shard, and the shard does not move** — `1937d72` (test)
2. **Task 2: two real `bin/agent.ts` processes — criterion 1 in the form it is written** — `b4d5e99` (test)
3. **Task 3: plant, watch, capture, revert** — no commit, by design. Two mutations were planted, run, captured verbatim below, and reverted with `git checkout --` on the single file each had touched. The task leaves no lasting change, so nothing was staged.

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/node/src/egress-refusal.node.test.ts` — new, 271 lines. Spawn scaffolding copied from `sovereignty-placement.node.test.ts` (`AGENT`, `AgentProcess`, `Agent`, `spawnAgent`, `startSubmitter`, `stopAgent`, the module-level state and the `beforeEach`/`afterEach` pair), `mkdtemp` prefix `o2-refusal-`, one `it` at a 120 s budget. Its own row fixture (`OWNED_ROW`), deliberately distinct from every fixture in `egress-manifest.node.test.ts` so neither file's seeding can satisfy the other's assertion.
- `packages/node/src/egress-manifest.node.test.ts` — the DATA-05 describe block and test rewritten; the file header rewritten; `NodeDescriptor` added to the type import. The three DATA-06 tests are untouched.

## Task 3 — two mutations, planted, run, captured, reverted

Command for both: `npx vitest run packages/node/src/egress-manifest.node.test.ts packages/node/src/egress-refusal.node.test.ts`

Baseline for these two files immediately before Mutation A: **2 files / 5 tests, all passing**, the DATA-05 test at 5105 ms and the spawned-process test at 10592 ms.

### Mutation A — delete the `throw new EgressRefusal(...)` from `EgressGuard.send()`

The guard records the match and forwards the frame anyway, exactly as it did before Plan 13-04.

```
 Test Files  2 failed (2)
      Tests  2 failed | 3 passed (5)
   Duration  1.14s
```

```
 FAIL  |node| packages/node/src/egress-manifest.node.test.ts > DATA-05 — the tap refuses the leaking frame, so the shard fails where it stands > fails the cross-owner shard at its owner, does not relocate it, and carries the refusal on the owner’s own manifest
AssertionError: expected 'agreed' to be 'insufficient' // Object.is equality

Expected: "insufficient"
Received: "agreed"

 ❯ packages/node/src/egress-manifest.node.test.ts:164:40
    162|     // selected executor failed, which is exactly what a refused reply…
    163|     const shard = result.job.shards[0]
    164|     expect(shard?.verification.status).toBe('insufficient')
       |                                        ^
    165|     expect(shard?.verification.status).not.toBe('agreed')
    166|     expect(result.job.complete).toBe(false)
```

```
 FAIL  |node| packages/node/src/egress-refusal.node.test.ts > DATA-05 — the refusal across two real bin/agent.ts processes > fails a cross-owner job at the owner’s own process, leaves that process alive, and runs a control job through the same two processes afterwards
AssertionError: expected 'agreed' not to be 'agreed' // Object.is equality
 ❯ packages/node/src/egress-refusal.node.test.ts:228:44
    226|
    227|     const shard = leaking.job.shards[0]
    228|     expect(shard?.verification.status).not.toBe('agreed')
       |                                            ^
    229|     expect(leaking.job.complete).toBe(false)
    230|     expect(shard?.verification.status).toBe('insufficient')
```

**Read the duration, not only the assertions.** The run fell from ~16 s to 1.14 s. With the frame forwarded, no dispatch waits out an RPC timeout — which is the direct measurement that these two tests are watching a refusal and not a slow node. A test that merely happened to time out would have got *slower* under this mutation, not eleven times faster.

Reverted with `git checkout -- packages/net/src/egress.ts`; `git status --short packages/net/src/egress.ts` empty afterwards.

### Mutation B — remove the `registerSovereignInputs(...)` wrap from `fabric-node.ts`

`executor` becomes the `guardSovereignty(...)` value directly, so nothing is ever registered with the tap and nothing can be refused.

```
 Test Files  2 failed (2)
      Tests  2 failed | 3 passed (5)
   Duration  1.16s
```

```
 FAIL  |node| packages/node/src/egress-manifest.node.test.ts > DATA-05 — the tap refuses the leaking frame, so the shard fails where it stands > fails the cross-owner shard at its owner, does not relocate it, and carries the refusal on the owner’s own manifest
AssertionError: expected 'agreed' to be 'insufficient' // Object.is equality

Expected: "insufficient"
Received: "agreed"

 ❯ packages/node/src/egress-manifest.node.test.ts:164:40
    162|     // selected executor failed, which is exactly what a refused reply…
    163|     const shard = result.job.shards[0]
    164|     expect(shard?.verification.status).toBe('insufficient')
       |                                        ^
    165|     expect(shard?.verification.status).not.toBe('agreed')
    166|     expect(result.job.complete).toBe(false)
```

```
 FAIL  |node| packages/node/src/egress-refusal.node.test.ts > DATA-05 — the refusal across two real bin/agent.ts processes > fails a cross-owner job at the owner’s own process, leaves that process alive, and runs a control job through the same two processes afterwards
AssertionError: expected 'agreed' not to be 'agreed' // Object.is equality
 ❯ packages/node/src/egress-refusal.node.test.ts:228:44
    226|
    227|     const shard = leaking.job.shards[0]
    228|     expect(shard?.verification.status).not.toBe('agreed')
       |                                            ^
    229|     expect(leaking.job.complete).toBe(false)
    230|     expect(shard?.verification.status).toBe('insufficient')
```

```
$ npx tsc --noEmit      # under Mutation B
tsc exit: 0
```

**Why this mutation matters more than it looks, and it is the plan's own threat T-13-09.** `egress-refusal.node.test.ts` cannot read the spawned child's manifest — that is stated in its header and it is not a limitation this plan closes. So the spawned-process test's failure could, on its face, have depended on something in the *test* process rather than on registration happening inside the child. Mutation B is the only evidence that it does not: `registerSovereignInputs` is composed inside `FabricNode.start`, which runs inside the spawned process, and removing it there makes the cross-process job succeed. That in turn is what makes the on-disk seed load-bearing — with no registration the seeded bytes are inert, and the fact that the test goes green proves the seed was the thing the tap was watching for.

It also proves the seed is not merely decorative in the other direction: `tsc --noEmit` exits 0 under this mutation, so the type-checker would never have flagged it. Nothing in the repository except these two tests notices.

Reverted with `git checkout -- packages/node/src/fabric-node.ts`; `git status --short` empty over the whole tree afterwards.

### After both reverts

```
$ git status --short
(empty)

$ npx tsc --noEmit
tsc exit: 0
```

## Verification — real counts from real runs

```
$ npx tsc --noEmit
tsc exit: 0        (no output)

$ npx vitest run packages/node/src/egress-manifest.node.test.ts --reporter=verbose
 ✓ DATA-05 — the tap refuses the leaking frame … 5105ms
 ✓ DATA-06 … a clean pushdown job …               35ms
 ✓ DATA-06 … a public job …                       33ms
 ✓ DATA-06 … a pushdown job's manifest …          33ms
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run packages/node/src/egress-refusal.node.test.ts --reporter=verbose
 ✓ DATA-05 — the refusal across two real bin/agent.ts processes … 10592ms
 Test Files  1 passed (1)
      Tests  1 passed (1)

$ npm test
 Test Files  123 passed (123)
      Tests  1778 passed (1778)
   Duration  296.84s
```

**The counts reconcile exactly.** The repository baseline before this phase's gap plans was 122 files / 1775 tests. Plan 13-04 added 2 tests and left one red (122 / 1777, 1 failing). This plan adds one file and one test and inverts the red one: **123 files / 1778 tests, zero failing.** No other test changed state — the one red test in the tree at this plan's start was the DATA-05 assertion this plan owns and rewrote, and nothing else went red at any point.

**The two budgets are measured, not asserted.** The DATA-05 test runs 5105 ms against a 5 s RPC budget, so three node startups, the dial, two module puts, and the entire control job cost ~105 ms between them. The spawned-process test runs 10592 ms against a 10 s budget, so two process spawns, one `FabricNode` start, two dials and a full cross-process control dispatch cost ~592 ms. In both cases the control job — the thing the budget has to be adequate for — finished in a small fraction of it. That is the evidence that "the budget was too short" cannot explain the refused dispatch.

## Decisions Made

- **Three nodes in the in-process test, not two.** The plan asked for the idle non-owner to be present, and it changes what the test can rule out: with only alice in the job, `failures.length === 1` would be arithmetic rather than a finding. With a second node present, idle, and flagged able to execute sovereign work, the single failure is a measurement of non-relocation.
- **`expect(...).not.toContain(other.peerId)` alongside `toHaveLength(1)`.** Redundant on today's `executeVerified`, deliberately. `toHaveLength(1)` would still pass if a future change replaced alice's failure with the second node's; the `not.toContain` is what names the specific thing being ruled out — the leak moving rather than stopping.
- **The spawned-process test asserts `status` twice — `not.toBe('agreed')` before `toBe('insufficient')`.** The criterion's own sentence is "fails rather than completing as `agreed`", and that is the load-bearing claim; `'insufficient'` is the particular shape it takes today. Ordering the weaker assertion first means the failure message under a mutation reads as the criterion, not as an implementation detail.
- **Both files' control jobs reuse the same sovereign row as the refused job.** A different row would have left "the tap was watching for the wrong bytes" as an explanation for the control succeeding. Same row, same registration, same owner — the module is the only variable.

## Deviations from Plan

None — all three tasks were executed as written. No auto-fix was needed: no bug, no missing critical functionality, and nothing blocked.

Two small things worth recording as choices rather than deviations, since a reader comparing the plan's `<action>` text to the files will see them:

- The plan named the second node "bob" in the descriptor arrangement. The descriptor's `ownerId` is `'bob'` as specified; the *variable* is called `other`, because naming the node after an owner id invites the reading that it is a different kind of node. It is not — it is a node started the way any node starts.
- The plan asked for a comment justifying the `rpcTimeoutMs` choice "against the control job". Both comments do that, and the measured figures are recorded above rather than only in the source, so the justification is checkable after the fact instead of only claimed.

## Issues Encountered

**None red, and nothing adjusted away.** The one failing test in the repository at this plan's start (`egress-manifest.node.test.ts:117`, `expected 'insufficient' to be 'agreed'`) was this plan's Task 1 subject and is now inverted. No other test changed state at any point, under either mutation or after either revert.

**One limit worth stating plainly rather than glossing.** `egress-refusal.node.test.ts` proves the *consequence* crosses a real process boundary. It does not, and cannot, read the spawned child's manifest — there is no wire message that carries one, and this plan did not add one. The attribution of the failure to the tap rather than to some other cause rests on three things together: the control job through the same live processes, alice's `exitCode` being still `null`, and Mutation B. Any summary that reads this file as proving the manifest-level claim across processes is reading it wrong, and its header says so.

## Next Phase Readiness

- **Criterion 1 is now measurable in the form it is written.** A verifier can run `npx vitest run packages/node/src/egress-refusal.node.test.ts` and watch two `bin/agent.ts` processes fail a cross-owner job, then plant either mutation above and watch it pass again.
- **Plan 13-06 still owns the documentation records**, and this plan touched none of them: `.planning/STATE.md`, `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` are untouched. The DATA-05 ledger row that 13-VERIFICATION.md called out as overstating what was built ("fails a running job … when a raw sovereign byte crosses") is now half-true rather than false — the job does fail — but the detection-granularity half of that sentence is still wrong and is 13-06's to correct.
- **Plan 13-07 still owns `#guarded`'s unbounded growth**, and this plan makes it slightly more visible: both new tests register a payload that is never released, and the in-process file now runs two jobs against one guard with the first job's registration still live during the second. That is the intended behavior today and the second job is unaffected by it, but it is the shape 13-07 bounds.
- **Not claimed by this plan:** that a submitter can find out *why* a cross-process dispatch failed. It learns that it failed. The responding leg's silence is an accepted cost recorded in `egress.ts` by Plan 13-04, and nothing here changes it.

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-28*

## Self-Check: PASSED

Both test files verified present on disk. All three commit hashes (`1937d72`, `b4d5e99`,
`a45c866`) verified present in `git log`. `packages/net/src/egress.ts` and
`packages/node/src/fabric-node.ts` verified clean after their mutation reverts, and
`git status --short` was empty over the whole tree at that point and again after this
summary was committed. `vocabulary.node.test.ts` and `purity.node.test.ts` re-run with
this summary committed and therefore inside the scan's own jurisdiction: 38/38 passing.

`.planning/STATE.md`, `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` were not
touched by this plan.
