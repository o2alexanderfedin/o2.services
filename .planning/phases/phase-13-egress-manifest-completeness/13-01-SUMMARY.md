---
phase: phase-13-egress-manifest-completeness
plan: 01
subsystem: infra
tags: [egress, sovereignty, data-governance, o2-net]

# Dependency graph
requires:
  - phase: phase-4-transport-and-egress
    provides: EgressGuard (packages/net/src/egress.ts), a Transport decorator that scans outbound frames for registered sovereign byte patterns
  - phase: phase-12-sovereignty-wired
    provides: guardSovereignty (packages/core/src/executor/sovereignty-guard.ts), the serving-side DATA-09 refusal gate, and Task.label/ownerId surviving the wire
provides:
  - registerSovereignInputs (packages/net/src/sovereign-egress.ts) — the first production caller of EgressGuard.guard(), wrapping an Executor so a sovereign task's input is registered with a node's tap before execution
  - submitJobWithEgress + sliceManifest (packages/net/src/submit-with-egress.ts) — a per-job, delta-sliced EgressManifest attached outside JobResult, without touching @o2/core
affects: [phase-13-plan-02, phase-13-plan-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Executor decorator composed outside guardSovereignty, not inside — registering a task guardSovereignty is about to refuse is harmless, and keeps composition order identical at both production call sites"
    - "Delta-slicing EgressGuard.manifest.entries (fresh array per read) rather than EgressGuard.reset(), so job-scoped manifests compose with concurrent reads instead of discarding shared history"

key-files:
  created:
    - packages/net/src/sovereign-egress.ts
    - packages/net/src/sovereign-egress.test.ts
    - packages/net/src/submit-with-egress.ts
    - packages/net/src/submit-with-egress.test.ts
  modified:
    - packages/net/src/index.ts

key-decisions:
  - "registerSovereignInputs reads from the registration blockstore passed in explicitly, never the executor's own network-fallback store — a missing block is a silent skip (task still runs), not a thrown error, matching 13-CONTEXT.md's owner-pinned-data assumption"
  - "submitJobWithEgress's ok:false branch returns submitJob's own SubmitResult unchanged (no manifests field) via structural typing, rather than re-shaping the error"

patterns-established:
  - "A guard is proven live by never letting a test call guard.guard() directly — every assertion in both new test files traces a violation (or its absence) back to registerSovereignInputs alone"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 12min
completed: 2026-07-27
---

# Phase 13 Plan 01: Egress Manifest Glue Summary

**`EgressGuard.guard()` gets its first production caller (`registerSovereignInputs`), and `submitJobWithEgress` attaches a per-job, delta-sliced manifest without touching `@o2/core` or `JobResult`.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-27T14:27:00-07:00
- **Completed:** 2026-07-27T14:37:40-07:00
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `registerSovereignInputs` wraps an `Executor` so any task labelled `'sovereign'` has its input CID and bytes declared to an `EgressGuard` before `inner.execute` runs — closing the gap where the only `.guard()` caller anywhere in the repo was a test standing in for "the owner declared this payload sovereign"
- `submitJobWithEgress` and `sliceManifest` give every `submitJob` caller a per-job `EgressManifest`, derived from `EgressGuard.manifest`'s before/after entry-count delta, with no new method on `EgressGuard` and no field added to `JobResult`
- Both new modules barrel-exported from `@o2/net`, ready for Plan 13-02 to wire into `FabricNode`/`BrowserNode`
- Six new tests, all built over a real `RpcEndpoint`/`serveAgent`/`EgressGuard` fabric; none calls `guard.guard()` directly — every violation or its absence is a consequence of the new production code alone

## Task Commits

Each task was committed atomically:

1. **Task 1: registerSovereignInputs** - `ade1295` (feat)
2. **Task 2: submitJobWithEgress** - `3146de1` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/net/src/sovereign-egress.ts` - `registerSovereignInputs` + `SovereignEgressOptions`, the production `.guard()` caller
- `packages/net/src/sovereign-egress.test.ts` - three integration behaviors: registers-and-catches, skips-public, skips-when-not-resident
- `packages/net/src/submit-with-egress.ts` - `submitJobWithEgress` + `sliceManifest` + `SubmitWithEgressResult`
- `packages/net/src/submit-with-egress.test.ts` - pushdown-with-real-manifest, sequential-jobs-no-double-count, exact-passthrough-on-failure
- `packages/net/src/index.ts` - barrel-exports both new modules under the existing "Egress control" comment block

## Decisions Made
- Registration blockstore is a caller-supplied parameter, not implicitly the executor's own store — this is what lets Plan 13-02 pass the node's local-only tier (`store`) rather than the network-fallback tier (`blockstore`), per 13-CONTEXT.md's owner-pinned-data rationale
- `sliceManifest` recomputes `totalBytes`/`violations` from the sliced subset rather than reusing the full manifest's totals, since those cover entries outside the slice

## Deviations from Plan

**1. [Rule 3 - Blocking] Plan's verify command referenced a non-existent per-package tsconfig**
- **Found during:** Task 1 verification
- **Issue:** Both tasks' `<verify>` blocks specify `npx tsc --noEmit -p packages/net`, but the repository has a single root `tsconfig.json` (`include: ["packages/*/src/**/*.ts", ...]`) with no per-package `tsconfig.json` files — `-p packages/net` fails with `TS5081: Cannot find a tsconfig.json file`.
- **Fix:** Ran the whole-repo `npx tsc --noEmit` instead, which is how the baseline itself was verified (matches the phase's own `<verification>` instructions, which specify `npx tsc --noEmit` with no `-p` flag).
- **Files modified:** None — verification-only.
- **Verification:** `npx tsc --noEmit` exits 0 both before and after each task's changes.
- **Committed in:** N/A (no code change; documented here per deviation tracking)

---

**Total deviations:** 1 auto-fixed (1 blocking, verification-command-only)
**Impact on plan:** No scope creep. Both tasks' actual code and tests match the plan's `<action>` blocks exactly.

## Issues Encountered
None beyond the verify-command deviation above.

## Next Phase Readiness
- `registerSovereignInputs` and `submitJobWithEgress`/`sliceManifest` are barrel-exported from `@o2/net` and ready for Plan 13-02 to wire into `fabric-node.ts` and `browser-node.ts`
- `.guard()` now has exactly one production caller in the whole repository: `registerSovereignInputs`'s `execute` method (`packages/net/src/sovereign-egress.ts`) — not yet reachable from either node factory until Plan 13-02 composes it in

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 4 created files and both task commit hashes (`ade1295`, `3146de1`) verified present.
