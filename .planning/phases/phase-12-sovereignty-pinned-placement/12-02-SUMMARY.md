---
phase: phase-12-sovereignty-pinned-placement
plan: 02
subsystem: scheduling
tags: [sovereignty, executor-adapter, submitJob, mutation-testing, typescript]

# Dependency graph
requires:
  - phase: phase-12-sovereignty-pinned-placement
    plan: "01"
    provides: "submitJob wired through planPlacement/eligibleNodes, ShardSpec union, JobSpec.nodes, Task.label/ownerId"
provides:
  - "guardSovereignty(inner, node) — a pure Executor adapter that refuses a sovereign task before inner.execute runs, unless the task's owner matches the node's own owner and the node is cleared (NodeSovereignty.canExecuteSovereign)"
  - "A load-pressure discrimination test at the submitJob level: owner's only node saturated at load 1, four foreign nodes idle at load 0 — the sovereign shard still places on the owner's node"
  - "A DATA-09 proof that a genuine replica holder (data present in the shared blockstore, canExecuteSovereign: false) is excluded from execution, not merely absent"
  - "Runtime rejection of a sovereign shard with no owner (shard-missing-owner) and of an executor with no matching descriptor (missing-node-descriptor), exercised rather than merely compiled"
affects: [phase-12-plan-04-serving-node-wiring, phase-15-auth-03-capability-chains]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Executor decorator for a serving-side gate: guardSovereignty follows GovernedExecutor's shape — wrap before handing to serveAgent, no port change, no AgentOptions hook"
    - "Mutation-test every new guard: invert the refusal condition (or hardcode the label the guard's mutation defeats), confirm the specific test fails in the expected direction, revert to a byte-identical file, confirm green again"

key-files:
  created:
    - packages/core/src/executor/sovereignty-guard.ts
    - packages/core/src/executor/sovereignty-guard.test.ts
  modified:
    - packages/core/src/index.ts
    - packages/core/src/job/submit.test.ts

key-decisions:
  - "guardSovereignty checks task.label === 'sovereign' first; only then compares ownerId and canExecuteSovereign — a public or unlabelled task never touches the sovereignty check at all, which is what keeps it a true no-op for the ~25 unrelated Task literals across the repo"
  - "Added a fifth submit.test.ts case beyond the plan's four (Rule 2): a DATA-09 test where the excluded node's data genuinely exists in the shared blockstore, so the refusal is proven to be canExecuteSovereign, not absence of data — per the execution context's explicit 'genuine replica holder' requirement, which the plan's Task 2 action list didn't itself enumerate"
  - "Mutated submit.ts's requestFor (not the placement loop's call site) since requestFor is the single per-shard PlacementRequest constructor — hardcoding its sovereign branch to 'public' is the same fault the plan describes ('the wiring forgetting to pass the real label through') expressed at its one point of construction"

patterns-established:
  - "A guard's 'never calls inner.execute' claim is tested by a call counter, not by inspecting the outcome alone — matches distributed.test.ts's AUTH-03 pattern, reused one layer down without RPC"

requirements-completed: [DATA-03, DATA-04, DATA-09]

# Metrics
duration: 20min
completed: 2026-07-27
---

# Phase 12 Plan 02: Sovereignty Guard and Placement Discrimination Proofs Summary

**`guardSovereignty` — a pure `Executor` adapter enforcing DATA-09's refusal-before-execution — plus a `submitJob`-level load-pressure test proving sovereign placement cannot be forced onto a non-owner node, with both guards mutation-tested against the exact fault they exist to catch.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-27T11:56:00Z (approx.)
- **Completed:** 2026-07-27T12:01:30Z (approx.)
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `guardSovereignty(inner: Executor, node: NodeSovereignty): Executor` exists as a pure module in `@o2/core` (no platform imports) — a sovereign task from an uncleared or wrong owner is refused before `inner.execute` is ever called; every other task (`public`, or `label` absent entirely) passes through unchanged, keeping the guard a true no-op outside the sovereign case
- The refusal reason names the node id, the owner id, and the word "sovereignty", verified by direct string assertion, not merely `ok: false`
- A `submitJob`-level test saturates the owner's only node at load 1 and idles four foreign nodes at load 0, then asserts the sovereign shard's `verification.agreeing` is exactly `['alice-1']` — never one of the four "cheaper" idle nodes
- A fifth test (beyond the plan's four, added per Rule 2 — see Deviations) proves DATA-09's harder case: a node with `canExecuteSovereign: false` whose data genuinely exists in the shared blockstore (`store.has(inputCid)` is `true`) is still never dispatched to execute, so the refusal is provably about clearance, not about the node lacking data
- Both the guard's refusal condition and `submit.ts`'s per-shard `PlacementRequest` construction were mutation-tested: each mutation produced the specific, expected failure and nothing else, then was reverted to a byte-identical file
- Full suite: `tsc --noEmit` clean; `116/116` test files, `1749/1749` tests passing — up from the pre-plan baseline of `114/114` files, `1727/1727` tests (net `+2` files, `+22` tests, exactly the two new test files' contribution across the node+browser project matrix)

## Task Commits

Each task was committed atomically, following TDD for Task 1:

1. **Task 1 (RED): failing test for guardSovereignty** - `f956b42` (test)
2. **Task 1 (GREEN): implement guardSovereignty** - `fd169c9` (feat)
3. **Task 2: submitJob discrimination and rejection proofs** - `2eaf345` (test)

**Plan metadata:** (this commit, following SUMMARY.md)

## Files Created/Modified
- `packages/core/src/executor/sovereignty-guard.ts` - `guardSovereignty`/`NodeSovereignty`; wraps an `Executor`, refuses before calling `inner.execute` for a sovereign task the node isn't cleared for
- `packages/core/src/executor/sovereignty-guard.test.ts` - five behaviors, call-counter-based "never calls inner.execute" proofs
- `packages/core/src/index.ts` - exports `guardSovereignty`/`NodeSovereignty` alongside the existing sovereignty exports
- `packages/core/src/job/submit.test.ts` - new `describe('DATA-03/DATA-04 — sovereignty wired onto submitJob', ...)` block: discrimination, DATA-09 replica-holder addition, degraded-not-error, missing-owner rejection, missing-node-descriptor rejection

## Decisions Made
- `guardSovereignty` is built exactly as CONTEXT.md specifies: an adapter behind the unchanged `Executor` port, no new `serveAgent`/`AgentOptions` hook, distinct from AUTH-03 (Phase 15) — this checks what the node may decrypt, not who authorised the caller
- Kept the plan's exact five behaviors as the guard's test surface; did not add speculative cases beyond what DATA-09 requires
- Documented in the module comment (not just the SUMMARY) that the check-then-maybe-call ordering is the entire "before instantiation" claim, since a real `WasmExecutor.execute` is what reaches `WebAssembly.instantiate`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a DATA-09 "genuine replica holder" test to submit.test.ts**
- **Found during:** Task 2
- **Issue:** The plan's Task 2 `<action>` enumerates exactly four tests (discrimination, degraded, missing-owner, missing-node-descriptor). The execution context's `<the_task_that_matters>` section — reiterating 12-CONTEXT.md's "Specific Ideas" — explicitly states: "DATA-09 needs a genuine replica holder... If your test's replica node holds nothing, the refusal is satisfied by the node simply not having the data and the criterion is untested." None of the plan's four tests, nor Task 1's guard test (which has no blockstore at all), demonstrates this: the discrimination test's "foreign" nodes are a different owner entirely (would be excluded by ownership even if data-holding were irrelevant), so it doesn't isolate `canExecuteSovereign` as the reason for exclusion.
- **Fix:** Added a fifth test in the same `describe` block: a node `replica-1` owned by `alice` (same owner as the executing node) with `canExecuteSovereign: false`, alongside `alice-1` (`canExecuteSovereign: true`). Because `submitJob` unconditionally persists every shard's input to the shared blockstore before placement, `replica-1` genuinely has access to the sovereign shard's data (`store.has(shard.inputCid)` asserted `true`) — the test proves the exclusion is `canExecuteSovereign`, not absence of data, and a call-counter confirms `replica-1`'s executor is never invoked.
- **Files modified:** `packages/core/src/job/submit.test.ts`
- **Verification:** Test passes; mutation-tested alongside the discrimination test (see Mutation Test Results) and fails in the expected direction (the excluded node's own id appears in `agreeing` instead of the owner's) when `submit.ts`'s label-passthrough is defeated.
- **Committed in:** `2eaf345` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality, Rule 2)
**Impact on plan:** Strengthens the plan's own DATA-09 criterion using the architecture as it exists (a single shared `Blockstore` across all nodes, not a per-node model) rather than inventing new port surface. No scope creep — no files outside the plan's declared `files_modified` were touched.

## Mutation Test Results (this plan's real deliverable)

**Task 1 — `sovereignty-guard.ts`'s refusal condition, mutated via `sovereignty-guard.ts`:**
Temporarily negated the boolean: `const cleared = !(task.ownerId === node.ownerId && node.canExecuteSovereign)`. `npx vitest run packages/core/src/executor/sovereignty-guard.test.ts` then reported:
```
Test Files  2 failed (2)
     Tests  6 failed | 6 passed (12)
```
The 6 failures were exactly the three sovereign-case tests (cleared-owner passes, uncleared-owner refused, wrong-owner refused), doubled across the node+browser projects — each failed in the expected direction (a call-count of 0 became 1, or 1 became 0). The two public/unlabelled tests and the `nodeId` passthrough test were unaffected, confirming the mutation's blast radius matched exactly what it should touch. Reverted; `diff` against the pre-mutation file byte-identical; `npx vitest run packages/core/src/executor/sovereignty-guard.test.ts` then passed 12/12 again.

**Task 2 — `submit.ts`'s `requestFor` (per-shard `PlacementRequest` construction), mutated via `submit.ts`:**
Temporarily hardcoded the sovereign branch's label to the literal `'public'`: `shard.label === 'sovereign' ? { shardId, label: 'public', redundancy } : { shardId, label: shard.label, redundancy }` (dropping `ownerId` from the constructed request as a side effect, since a `'public'` request never needs one). `npx vitest run packages/core/src/job/submit.test.ts` then reported:
```
Test Files  2 failed (2)
     Tests  4 failed | 48 passed (52)
```
Both failures were in the two tests that assert a specific winning node — the discrimination test (`expected [ 'alice-1' ] ... received [ 'bob-1' ]`, doubled across node+browser) and the added DATA-09 replica-holder test (`expected [ 'alice-1' ] ... received [ 'replica-1' ]`, doubled across node+browser). With the sovereign label defeated, `planPlacement` ran ordinary least-loaded selection over the full candidate set, and in both cases the idle/uncleared node outranked the saturated/cleared owner node — exactly the leak DATA-03/DATA-09 exist to prevent. The other 48 tests (degraded, missing-owner, missing-node-descriptor, and all pre-existing tests) were unaffected. Reverted; `diff` against the pre-mutation file byte-identical; `npx vitest run packages/core/src/job/submit.test.ts` then passed 52/52 again.

Both mutations produced the specific, expected failure and nothing else — neither guard is vacuous, and the DATA-09 addition's mutation result is itself informative: it shows the same fault that would leak a sovereign shard to a foreign node would equally leak it to an uncleared same-owner replica, which is the sharper of the two failure modes.

## Issues Encountered

None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 12-04 has a ready-to-wrap adapter: whoever constructs a serving node's `Executor` in production calls `guardSovereignty(realExecutor, {ownerId, canExecuteSovereign})` before handing it to `serveAgent`. No `serveAgent`/`AgentOptions` change was needed or made.
- `submitJob`'s sovereignty discrimination is now proven under the specific load-pressure arrangement the ROADMAP's criterion 1 asks for, at the actual call path (`submitJob`), not only at `planPlacement` (Phase 4 already covered that layer).
- Phase 15's AUTH-03 capability-chain work has a clean boundary to build against: `guardSovereignty`'s module comment and this SUMMARY both record that it is deliberately not a caller-authorization check.
- No blockers for Plans 12-03/12-04 (not executed by this agent).

---
*Phase: phase-12-sovereignty-pinned-placement*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 5 files claimed as created/modified verified present on disk (`sovereignty-guard.ts`, `sovereignty-guard.test.ts`, `index.ts`, `submit.test.ts`, this SUMMARY). All 3 task commit hashes (`f956b42`, `fd169c9`, `2eaf345`) verified present in `git log`.
