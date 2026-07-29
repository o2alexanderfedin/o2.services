---
phase: phase-12-sovereignty-pinned-placement
plan: 01
subsystem: scheduling
tags: [placement, sovereignty, submitJob, kernel, typescript]

# Dependency graph
requires:
  - phase: phase-4-sovereignty-gate
    provides: "sovereignty.ts's eligibleNodes/planPlacement — the total, unit-verified placement gate this plan wires onto a runnable path"
  - phase: phase-11-serve-agent-hardening
    provides: "the required authorize hook on serveAgent, and the green 115/1690 baseline this plan must not regress"
provides:
  - "submitJob accepts a per-shard ShardSpec (public | sovereign+ownerId) and a JobSpec.nodes descriptor set"
  - "Placement for every shard goes through sovereignty.ts's planPlacement/eligibleNodes — no other code path selects an executor"
  - "Task carries an optional label/ownerId, threaded to the serving node for the DATA-09 refusal a later phase adds"
  - "ShardResult.degraded and JobResult.complete now express achieved-vs-requested redundancy instead of an upfront not-enough-executors refusal"
  - "publicNodes() so an all-public job caller can express its candidate pool in one call"
affects: [phase-13-egress-manifest, phase-16-reduce-tree, phase-18-node-discovery, phase-19-quorum-attestation, phase-20-runResilient-caller]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Placement-before-dispatch: submitJob now builds one PlacementRequest per shard and calls planPlacement before touching an Executor, mirroring coordinator.ts's requestFor construction so there is exactly one spelling of a labelled shard in the kernel"
    - "exactOptionalPropertyTypes-safe optional construction: ownerId and label are only assigned when a real value exists, never set to explicit undefined, for both PlacementRequest and Task literals"
    - "Load-nudge via a synthetic dispatchCount added to NodeDescriptor.load per shard, reproducing the old round-robin spread across a public job's node set without ever widening eligibility"

key-files:
  created: []
  modified:
    - packages/core/src/ports.ts
    - packages/core/src/sovereignty.ts
    - packages/core/src/job/submit.ts
    - packages/core/src/index.ts
    - packages/core/src/job/submit.test.ts
    - packages/core/src/executor/task-worker.ts
    - packages/core/src/executor/wasm.test.ts
    - packages/demo/src/kernel.test.ts
    - packages/browser/demo/main.ts
    - packages/browser/src/visibility-governor.test.ts
    - packages/aot/src/wasi-executor.test.ts
    - packages/aot/src/admission.test.ts
    - packages/node/src/relaying.node.test.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/src/two-process.node.test.ts
    - packages/net/src/distributed.test.ts
    - packages/node/src/bin/bench.ts

key-decisions:
  - "not-enough-executors is retired entirely; a shard that cannot reach its requested redundancy is placed at what is available, marked degraded on ShardResult, and folds into JobResult.complete instead of failing the whole job (Risk 2's resolution, recorded in 12-CONTEXT.md)"
  - "Task.label/ownerId are optional at the port level so the ~25 unrelated Task literals across the repo keep compiling; the true non-optional guarantee lives at submitJob's own ShardSpec input contract, a compile-time discriminated union"
  - "publicNodes() takes a minimal structural {nodeId} shape rather than importing Executor, keeping sovereignty.ts a zero-import pure module"
  - "admission.test.ts's Task-field-equality assertion grew from four fields to five (adding label) — the assertion's real claim (no kind-dependent field between native and WASI pools) was preserved; only the now-outdated field count changed"

patterns-established:
  - "Every submitJob caller in the repo builds its node descriptor set with publicNodes(executors) rather than hand-rolling NodeDescriptor literals, so there is one place a caller expresses 'this job doesn't care about ownership'"

requirements-completed: [DATA-03, DATA-04]

# Metrics
duration: 25min
completed: 2026-07-27
---

# Phase 12 Plan 01: Sovereignty-Pinned Placement — Wiring Summary

**submitJob now places every shard through sovereignty.ts's planPlacement/eligibleNodes instead of executorsFor's unconditional round-robin, with degraded-not-failed redundancy reporting threaded to JobResult.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-27T18:15:00Z (approx.)
- **Completed:** 2026-07-27T18:40:00Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments
- `submitJob`'s `JobSpec.shards` is now a discriminated `ShardSpec` union (`public` | `sovereign` + `ownerId`), and `JobSpec` gained a required `nodes: NodeDescriptor[]` correlated to `executors` by `nodeId`
- Placement for every shard is decided by one call to `planPlacement` per shard — `executorsFor`'s round-robin is deleted, and there is no other code path in `submit.ts` that selects which node runs a shard
- `Task` gained optional `label`/`ownerId`, so the serving node a later phase hardens can see the sovereignty label without `submitJob` changing the `Executor` port (Phase 2's recorded adapter-first rule, honored)
- `not-enough-executors` is retired: a shard placed below its requested redundancy is reported `degraded: true` on `ShardResult`, and `JobResult.complete` now requires `!degraded` on every shard in addition to `agreed` — the old check's intent (never report verified agreement a job did not achieve) survives through the new mechanism
- All 33 `submitJob` invocations across 13 files (recounted directly from source, not assumed from the plan's file count) were swept to the new shape; `tsc --noEmit` is clean repo-wide and the full suite matches the pre-phase baseline exactly: 115/115 files, 1690/1690 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Redesign the sovereignty-aware job contracts and rewrite submitJob's placement engine** - `6cbea8e` (feat)
2. **Task 2: Sweep every existing submitJob call site to the new JobSpec shape and confirm a green baseline** - `a2f66a7` (feat)

**Plan metadata:** (this commit, following SUMMARY.md)

## Files Created/Modified
- `packages/core/src/ports.ts` - `Task` gains optional `label: Sovereignty` / `ownerId: OwnerId`, documented as intentionally optional at this interface level
- `packages/core/src/sovereignty.ts` - adds `publicNodes()`, unchanged eligibility/placement logic
- `packages/core/src/job/submit.ts` - rewritten: `ShardSpec`, `JobSpec.nodes`, placement-driven `submitJob`, `ShardResult.degraded`, two new `SubmitError` kinds, `not-enough-executors` and `executorsFor` removed
- `packages/core/src/index.ts` - exports `ShardSpec` and `publicNodes`
- 12 caller files (production: `task-worker.ts`, `main.ts` [2 sites], `bin/bench.ts`; the remaining 9 are test files) - mechanically adapted to the new `JobSpec` shape

## Decisions Made
- Retired `not-enough-executors` in favor of per-shard `degraded` reaching `JobResult`, per 12-CONTEXT.md's Risk 2 resolution — an owner with one live node is the expected case, not an error
- Kept `Task.label`/`ownerId` optional at the port level; enforcement of "every shard has a real label" lives at `submitJob`'s `ShardSpec` compile-time contract, not at `Task`
- `publicNodes()` uses a minimal structural parameter type, not `Executor`, so `sovereignty.ts` stays a zero-import pure module
- Updated `admission.test.ts`'s field-count assertion from four to five fields (adding `label`) rather than weakening it — the assertion's actual claim (no kind-dependent field) still holds and is still checked

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<action>` specs were followed literally, including the `exactOptionalPropertyTypes`-safe construction pattern mirrored from `coordinator.ts`'s `requestFor`, and the `admission.test.ts` field-list assertion update the plan's Task 2 `<action>` anticipated ("verify the underlying claim the test is making still holds ... adjust the assertion to check that claim rather than an incidental exact ordering").

## Issues Encountered

During Task 2, `git status` transiently showed an unrelated deleted test file (`packages/aot/src/zz-smoke.node.test.ts`) and a two-line change to `tools/aot/lift.ts` (a Docker `--name` flag), neither touched by this plan. Both resolved back to matching `HEAD` before any commit in this plan was made — the working directory is shared with a live, concurrent editing session outside this agent's control (confirmed via the environment's second working-directory path), not a defect introduced by this plan. Nothing from that activity was staged or committed here; both task commits contain exactly the files listed in the plan's `files_modified`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The sovereignty gate is now on the one production job path (`submitJob`); Phase 13's egress manifest and Phase 16's reduce tree can build on `ShardSpec`/`degraded` without re-deriving eligibility
- Phase 18 (node discovery) still owns producing a real `NodeDescriptor[]` in production — every caller here builds one from whatever it already has (`publicNodes(executors)` for the all-public case), per 12-CONTEXT.md's declared scope boundary
- Phase 19 (VER-08/09/10) still owns naming what a degraded sovereign result is called ("owner-attested" vs. "verified") — this plan makes the fact visible on `ShardResult.degraded` without naming it
- No blockers for Wave 2 (12-02/12-03/12-04, not executed by this agent)

## Self-Check: PASSED

All key files confirmed present on disk (`ports.ts`, `sovereignty.ts`, `job/submit.ts`, `index.ts`, this SUMMARY). Both task commits (`6cbea8e`, `a2f66a7`) confirmed present in `git log`. `vocabulary.node.test.ts` and `purity.node.test.ts` run twice after this file was written — both runs 38/38 passing.

---
*Phase: phase-12-sovereignty-pinned-placement*
*Completed: 2026-07-27*
