---
phase: 46-a-module-declares-its-reach-and-the-data-decides
plan: 02
subsystem: infra
tags: [wire-protocol, canonical-encoding, signing, naming]

# Dependency graph
requires:
  - phase: 46-a-module-declares-its-reach-and-the-data-decides
    provides: "NameRecord.wantsNetworkReach?: true, and payloadOf/encodeNameRecord/decodeNameRecord agreement on it (plan 01)"
provides:
  - "nameRecordToValue and parseNameRecord (packages/net/src/protocol.ts) carry wantsNetworkReach under the identical spread-omit / refuse-on-malformed discipline naming.ts already established"
  - "A named wire round-trip case proving a record declaring wantsNetworkReach crosses encodeRequest/parseRequest intact and still re-verifies via SignedNameResolver.accept"
  - "A named refuse-on-malformed case proving a wantsNetworkReach that is present-and-not-true refuses the whole frame rather than being dropped or coerced"
affects: [46-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The hand-written wire codec (nameRecordToValue/parseNameRecord) must independently restate every field payloadOf covers, using the identical spread-omit encode / refuse-whole-record-on-malformed decode idiom — confirmed again as the load-bearing rule this file's own history names for translationKeyCid and delegation"

key-files:
  created: []
  modified:
    - "packages/net/src/protocol.ts"
    - "packages/net/src/protocol.test.ts"

key-decisions:
  - "Followed the plan's exact spread placement: encode-side spread inserted after the delegation block and before signature; decode-side parse-and-refuse inserted after the delegation parse block and before the return, spread into the return object alongside translationKeyCid/delegation."
  - "Added a case beyond the plan's own two acceptance criteria: Task 1's second behaviour bullet (refuse-on-malformed, T-46-04) had no test exercising it after Task 2's round-trip case landed — a plant proved the gap was real (a false value silently became true), so a third commit closed it rather than leaving T-46-04 asserted-but-unproven."

patterns-established: []

requirements-completed: []  # CAP-01 is NOT fully done by this plan — this is wire-codec half of half 2; network-reach-guard.ts (plan 46-03) and the guard-wiring plans remain. requirements.mark-complete was NOT run.

# Metrics
duration: ~10min
completed: 2026-09-23
---

# Phase 46 Plan 02: The wire codec carries a module's declared reach Summary

**`nameRecordToValue`/`parseNameRecord` in `packages/net/src/protocol.ts` now carry `wantsNetworkReach` under the same spread-omit / refuse-on-malformed discipline `naming.ts`'s `payloadOf` already established, proven by a wire round-trip that re-verifies through `SignedNameResolver.accept` and a malformed-field case that refuses the frame — both proven with an observed RED, not asserted.**

## Performance

- **Duration:** ~10 min (three task commits between 13:30:26 and 13:33:32, plus earlier plan/context reading)
- **Completed:** 2026-09-23
- **Tasks:** 2 planned, 2 completed; one additional test case added beyond the plan's own scope (see Deviations)
- **Files modified:** 2

## Accomplishments
- `nameRecordToValue` now spreads `wantsNetworkReach` onto the wire value exactly when the record carries it, identical in shape to `naming.ts`'s `payloadOf` spread for the same field, so a declaring record and a non-declaring record each hash the same bytes on the wire as they do inside the signature.
- `parseNameRecord` now parses `wantsNetworkReach` off the wire, returning `null` for the whole record when the value is present and not exactly `true` — the same rule `decodeNameRecord` already enforces in `naming.ts`, applied here to the wire form.
- A named round-trip case (`packages/net/src/protocol.test.ts`) signs a record with `wantsNetworkReach: true`, carries it through `encodeRequest`/`parseRequest` inside a real `exec` `AgentRequest`, and asserts `SignedNameResolver.accept` on the parsed-back record still succeeds against the publisher's key — re-verification, not field equality, per the existing DELEGATED case's own stated reason.
- A second named case exercises the refuse-on-malformed branch T-46-04 names: `wantsNetworkReach: false` and `wantsNetworkReach: 'yes'` off the wire both refuse the whole frame.

## Task Commits

Each task was committed atomically, with explicit paths:

1. **Task 1: nameRecordToValue and parseNameRecord carry wantsNetworkReach** - `dc33367` (feat)
2. **Task 2: protocol.test.ts — the wire round trip, re-verified rather than field-compared** - `d8b9f48` (test)
3. **Additional, beyond the plan's own two tasks: refuse-on-malformed case for T-46-04** - `d238dd0` (test)

## Files Created/Modified
- `packages/net/src/protocol.ts` - `nameRecordToValue` gained the spread-omit clause for `wantsNetworkReach`; `parseNameRecord` gained parse-and-refuse-on-malformed logic and the matching return-object spread.
- `packages/net/src/protocol.test.ts` - Added `'carries a NETWORK-REACH declaration across the wire so it still verifies'` (in the `DET-03` describe block) and `'refuses a wantsNetworkReach that is present and not true'` (in the malformed-frame describe block).

## Decisions Made
- Placed the encode-side spread textually identical in shape to `naming.ts`'s `payloadOf` spread, as the plan required, so the two functions' agreement is visible by inspection, not only by test.
- Added the refuse-on-malformed test case not named in the plan's own two tasks — see Deviations below for why.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical coverage] Added a case for Task 1's own second behaviour bullet, which the plan's two named tasks left unproven**
- **Found during:** post-Task-2 review, before writing this Summary.
- **Issue:** Task 1's `<behavior>` names two things: the encode-side spread (proven by Task 2's round-trip case) and the decode-side refuse-on-malformed rule for `wantsNetworkReach !== true` (T-46-04 in the plan's own threat register, disposition `mitigate`). Nothing in the plan's named acceptance criteria exercised the second half. A plant confirmed the gap was real, not decorative: deleting the `if (wantsNetworkReachValue !== true) return null` line left the suite green, with a `wantsNetworkReach: false` record silently parsed back as `wantsNetworkReach: true` — a malformed value coerced into a false declaration rather than refused.
- **Fix:** Added `it('refuses a wantsNetworkReach that is present and not true', ...)` to `protocol.test.ts`'s existing `'a malformed module record refuses the whole frame, one field at a time'` block, using the file's own `recordValue`/`execFrame` helpers, asserting both `false` and `'yes'` refuse the frame.
- **Files modified:** `packages/net/src/protocol.test.ts`
- **Verification:** Planted the exact defect described above, watched `EXIT=1` with 1 failed / 23 passed (the new case failing, not any pre-existing one), restored the deleted line via the surgical inverse of the edit, verified byte-identical against a pre-plant snapshot with `cmp` (exit 0), re-ran and confirmed `EXIT=0` with 24/24.
- **Committed in:** `d238dd0` (test)

---

**Total deviations:** 1 auto-fixed (missing test coverage for an already-implemented, already-threat-registered mitigation)
**Impact on plan:** No change to `nameRecordToValue`/`parseNameRecord`'s implementation — the refuse-on-malformed logic was already correct from Task 1; only test coverage was added. No scope creep into grants, `fetch`, or any file outside `packages/net/src/protocol.ts`/`protocol.test.ts`.

## Issues Encountered

None beyond the coverage gap above.

## TDD Gate Compliance

Both tasks are `tdd="true"`. Git-log commit order for Task 1/Task 2 is **feat-then-test**, the same pattern 46-01's Summary flagged and did not fully correct: `dc33367` (feat, Task 1's implementation) precedes `d8b9f48` (test, Task 2's round-trip case). This plan does not claim a live pre-implementation RED for either committed task; instead, RED was watched **after** implementation, by planting the exact defect each behaviour bullet names and observing the failure, then restoring — twice:

- **Round-trip case (Task 2):** planted by deleting the `wantsNetworkReach` spread from `nameRecordToValue`'s encode side. Observed: `EXIT=1`, 1 failed / 22 passed, failing at `expect(carried.wantsNetworkReach).toBe(true)` with "expected undefined to be true" (the field-presence check, reached before the `.accept()` line — recorded exactly as observed, not upgraded to a signature-mismatch failure it did not reach). Restored via surgical inverse, `cmp` exit 0, re-ran to `EXIT=0`, 23/23.
- **Refuse-on-malformed case (additional, `d238dd0`):** planted by deleting `if (wantsNetworkReachValue !== true) return null`. Observed: `EXIT=1`, 1 failed / 23 passed, a `wantsNetworkReach: false` record parsing back with `wantsNetworkReach: true` instead of `null`. Restored via surgical inverse, `cmp` exit 0, re-ran to `EXIT=0`, 24/24.

Both plants targeted the exact line each behaviour bullet describes, and both observed failures are recorded as they actually read, not paraphrased into a stronger claim.

## Verification Performed (actual output, not asserted)

- `grep -c "wantsNetworkReach" packages/net/src/protocol.ts` → `6` (≥ 4 required)
- `npx tsc --noEmit -p .` → `EXIT=0` (run after Task 1, after Task 2, and after the additional test case)
- `npx vitest run --project node packages/net/src/protocol.test.ts` → `EXIT=0`, 24/24 (23 after Task 2 alone, 24 after the additional case)
- `grep -n "NETWORK-REACH" packages/net/src/protocol.test.ts` → matched the new case's title, line 173
- `grep -n "\.accept(" packages/net/src/protocol.test.ts` → the new case's body calls `.accept(`, confirmed at line 208
- `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` → `EXIT=0`, 26/26 (this plan's code comments and test titles do not trip the five-word guard)
- Pre-commit hook's cheap-guard suite (vocabulary, purity, mutation-ledger, disclosure, ledgers, reachability, traceability, state) ran on all three commits — 403/403 passed each time
- `git show --stat` on each commit confirmed exactly one file per commit: `dc33367` touches only `protocol.ts`; `d8b9f48` and `d238dd0` each touch only `protocol.test.ts`. Combined across all three commits, only `packages/net/src/protocol.ts` and `packages/net/src/protocol.test.ts` were modified — matching the plan's `files_modified` and its own `<verification>` block.
- Two RED plants observed and restored with `cmp` verification — see TDD Gate Compliance above for the exact observed failures.

**What was NOT done, explicitly:** No guard reads `wantsNetworkReach` anywhere yet — that is `network-reach-guard.ts`, plan 46-03, not this plan. No grant logic, no `fetch`, no host import — out of this phase's scope per `46-CONTEXT.md` §7. The full project-wide vitest suite (all five projects) was not run — only `protocol.test.ts` under `--project node` and the vocabulary guard, per this plan's own `<verification>` block and the pre-commit hook's cheap-guard suite (which itself only covers `node`-project guard specs, not the full suite). **CAP-01 is NOT fully complete** — this is the wire-codec half of "half 2"; plan 46-01's own Summary already named network-reach-guard.ts and the guard-wiring work as still remaining, and this plan adds nothing toward that. `requirements.mark-complete` was deliberately **not run** for CAP-01. No `.planning/STATE.md` mutation was made via `gsd-sdk query state.*` — the earlier plan's Summary documents that those commands corrupt the file's hand-written frontmatter, and this plan avoided them entirely rather than re-testing that finding; no metrics row or decision line was hand-appended to STATE.md's body either, since this plan introduced no new decision beyond what is already recorded above. `packages/node/src/mutation-ledger.ts` was **not updated** with an entry for this plan's two plants — `46-CONTEXT.md` §6 permits an entry once a plant is observed, but the file is outside this plan's `files_modified`, and adding to it was judged out of scope for a plan whose own scope fence names only `protocol.ts`/`protocol.test.ts`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`nameRecordToValue`/`parseNameRecord` now agree with `naming.ts` on `wantsNetworkReach` under the identical discipline already used for `translationKeyCid` and `delegation`, and `taskFrame`/`parseTaskFrame` already call these two functions generically — so a `Task.moduleRecord` carrying the declaration crosses the wire end to end with no further wire-level change needed. Plan 46-03 (reading the declaration in a guard, per `46-CONTEXT.md` §3) can now build directly on a `NameRecord` that survives both the signature and the wire intact. No blockers.

---
*Phase: 46-a-module-declares-its-reach-and-the-data-decides*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/net/src/protocol.ts
- FOUND: packages/net/src/protocol.test.ts
- FOUND: dc33367 (Task 1 commit)
- FOUND: d8b9f48 (Task 2 commit)
- FOUND: d238dd0 (additional refuse-on-malformed test commit)
