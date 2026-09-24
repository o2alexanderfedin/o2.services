---
phase: 46-a-module-declares-its-reach-and-the-data-decides
plan: 01
subsystem: core
tags: [naming, signing, canonical-encoding, provenance]

# Dependency graph
requires: []
provides:
  - "NameRecord.wantsNetworkReach?: true — a signed, optional field a publisher uses to declare a module wants network reach"
  - "payloadOf, encodeNameRecord, decodeNameRecord all agree on the field under the spread-omit / refuse-on-malformed discipline"
affects: [46-02, 46-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spread-omit idiom for optional signed fields: `...(x === undefined ? {} : { x })`, never `x: record.x`"
    - "Decode rule for optional signed fields: absent is fine, present-and-unparseable (or present-and-not-the-expected-literal) refuses the whole record rather than dropping the field"

key-files:
  created: []
  modified:
    - "packages/core/src/naming.ts"
    - "packages/core/src/naming.test.ts"

key-decisions:
  - "wantsNetworkReach is typed as the literal `true`, not `boolean` — there is no signed meaning yet for an explicit `false`; absence already carries \"does not declare\""
  - "The field names a wish, not a permission (per 46-CONTEXT.md §2) — no grant logic exists anywhere in this plan's scope"

patterns-established: []

requirements-completed: [CAP-01]  # PARTIAL — this plan is "half 1" of CAP-01 per its own objective; five more plans in phase 46 remain before CAP-01 as a whole is done. requirements.mark-complete was NOT run for CAP-01.

# Metrics
duration: ~6min
completed: 2026-09-23
---

# Phase 46 Plan 01: A module declares its reach — the signed field Summary

**`NameRecord` gained a signed, optional `wantsNetworkReach: true` field, wired through `payloadOf`, `encodeNameRecord` and `decodeNameRecord` under the identical spread-omit / refuse-on-malformed discipline `translationKeyCid` and `delegation` already established — proven by three byte-comparison tests, not by prose.**

## Performance

- **Duration:** ~6 min (two task commits 54s apart; total session including plan/context reading somewhat longer)
- **Completed:** 2026-09-23
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `NameRecord` carries `wantsNetworkReach?: true`, documented with the same "inside the signature, optional and load-bearing" reasoning as `delegation`, plus the field-specific point that it names a wish, never a permission.
- `payloadOf`, `encodeNameRecord`, and `decodeNameRecord` all agree on the field: absent omits the key entirely (not `undefined`, not `null`), present-and-not-literally-`true` (including `false`) refuses the whole record.
- Three new test cases in `naming.test.ts`, mirroring `AOT-02`'s structure line-for-line: signed-so-cannot-be-attached-or-stripped, byte-identical-when-absent, and round-trips-through-the-wire-form-and-refuses-widened-values.

## Task Commits

Each task was committed atomically:

1. **Task 1: NameRecord.wantsNetworkReach, and every naming.ts codec that must agree on it** - `0896b63` (feat)
2. **Task 2: naming.test.ts — the three claims criterion 1 makes, as byte comparisons** - `573b751` (test)

## Files Created/Modified
- `packages/core/src/naming.ts` - Added `NameRecord.wantsNetworkReach?: true` field with docblock; added the matching spread-omit clause to `payloadOf` and `encodeNameRecord`; added parse-and-refuse-on-malformed logic to `decodeNameRecord`
- `packages/core/src/naming.test.ts` - Added `describe('CAP-01 — a module can declare it wants network reach', ...)` block with three `it` cases

## Decisions Made
- Followed the plan's spread-omit idiom exactly rather than any shorthand (`|| true`, ternary-in-place) — CONTEXT.md §6 names that exact mistake as the mutation ledger's template plant.
- `decodeNameRecord`'s check is `wantsNetworkReachValue !== true` after the `undefined` branch, matching the plan's instruction to refuse `false`, strings, and numbers uniformly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking, post-hoc] Watched the RED phase after the fact, not before, and recorded the observed failure**
- **Found during:** self-review after both task commits landed — both tasks are `tdd="true"` and neither commit sequence stopped to watch a failing test before the implementation existed, violating this repository's own rule that "a proof that cannot fail is not a proof."
- **Fix:** snapshotted `naming.ts` to the scratchpad, planted the exact defect the plan's own `<action>` names as the mistake to avoid (`payloadOf`'s new field written unconditionally — `wantsNetworkReach: record.wantsNetworkReach` — instead of the spread-omit form), ran the suite, restored by the surgical inverse (reverting the one line via Edit), and verified the restore with `cmp` against the snapshot.
- **Observed red:** `npx vitest run --project node packages/core/src/naming.test.ts` → `EXIT=1`, **28 of 32 tests failed**, all with `NotEncodableError: name record not encodable: {"kind":"codec-rejected","detail":"`undefined` is not supported by the IPLD Data Model and cannot be encoded"}` thrown from `payloadOf` inside `signName` — the canonical encoder refuses `undefined` outright rather than merely producing a different signature, so nearly every existing fixture in the file (which never sets `wantsNetworkReach`) broke, not only the three new CAP-01 cases. This is a stronger failure than a bare signature mismatch and confirms the spread-omit discipline is load-bearing for every record in the file, not only the new field's own tests.
- **Restore verified:** `cmp` snapshot vs. working file → exit 0 (byte-identical); `git diff --stat -- packages/core/src/naming.ts` → empty; re-run of the suite → `EXIT=0`, 32/32.
- **Files touched during the plant/restore cycle:** `packages/core/src/naming.ts` only, never staged mid-plant, restored before any further commit.
- **Committed in:** no new commit — the file returned to the exact state already committed in `0896b63`.

**2. [Rule 3 - Blocking] `gsd-sdk query state.record-session` corrupted `.planning/STATE.md`, including sections unrelated to this plan**
- **Found during:** the state-update step of this workflow, following the standard `<state_updates>` instructions.
- **Issue:** `state.record-session` and (in combination with an earlier `state.update-progress` call) rewrote content outside the live frontmatter: the top frontmatter's hand-written `stopped_at:` block — explicitly flagged in this plan's `files_to_read` as "never rewrite that block" — was replaced wholesale with `Completed 46-01-PLAN.md`, `status` flipped `planning` → `completed`, `last_activity` reset to a stale 2026-08-25 value, and a **second, unrelated** historical section far down the file (a quoted "Prior session" snapshot) had its own `total_phases: 15` line overwritten with a progress-bar string and its own `Stopped at:` line overwritten with the same session string. Root cause: the SDK's field-replacement helpers match the first textual occurrence of a field name case-insensitively across the whole file, and this file embeds multiple historical frontmatter-shaped quotations using the same field vocabulary as the live frontmatter.
- **Fix:** immediately reverted with `git checkout -- .planning/STATE.md` (permitted here per `CLAUDE.md`'s destructive-git section — I was the sole writer of these uncommitted changes and no other agent shares this working tree this session) and confirmed `git diff HEAD -- .planning/STATE.md` was empty afterward. No further `state.record-session` or `state.advance-plan` calls were made. `state.update-progress`, `state.record-metric`, and `state.add-decision` were re-run individually afterward with their diffs inspected before staging (each is narrowly scoped: `update-progress` matches the *first* `progress:` block, which is the live one at line 447; `record-metric` matches the unique `## Performance Metrics` header; `add-decision` matches the first `### Decisions` section only) — see the STATE.md update section below.
- **Files modified:** `.planning/STATE.md` (reverted, then hand-verified narrow additions only)
- **Verification:** `git diff HEAD -- .planning/STATE.md` after revert → 0 lines
- **Committed in:** not committed — the corrupted state was never staged or committed; this is reported as a process finding, not a code change

---

**Total deviations:** 2 (1 post-hoc TDD-gate compliance fix, 1 tooling-safety finding)
**Impact on plan:** Neither touched the plan's own two files beyond the already-committed content. The TDD gap is now closed with an observed red. The STATE.md incident is a finding about this repository's tooling, not about this plan's code, and is reported per this repository's own testing/measurement conventions rather than smoothed over.

## TDD Gate Compliance

Both tasks are `tdd="true"`. The GREEN commits (`0896b63`, `573b751`) exist; the RED phase was not watched **before** those commits, only reconstructed afterward via the plant described above. The plant's observed failure (28/32 tests red on the exact defect the plan's `<action>` warns against) stands in for the missing live RED gate. Future plans in this phase should watch RED before GREEN, not after.

## Issues Encountered

`gsd-sdk query state.record-session` (and, in combination, an earlier `state.update-progress` call) corrupted `.planning/STATE.md` outside the scope of this plan's two files — see Deviations item 2 above for the full account, root cause, and the revert. No code files were affected; only the planning-state file, and it was fully reverted before any commit.

## Verification Performed (actual output, not asserted)

- `grep -n "readonly wantsNetworkReach?: true" packages/core/src/naming.ts` → matched exactly once (line 177)
- `grep -c "wantsNetworkReach" packages/core/src/naming.ts` → `10` (≥ 6 required)
- `npx tsc --noEmit -p .` → `EXIT=0` (run twice, after each task's edits)
- `npx vitest run --project node packages/core/src/naming.test.ts` → `EXIT=0`, 32/32 tests passed (29 pre-existing + 3 new)
- RED phase reconstructed after the fact (see Deviations item 1): planted the plan's own named defect, `EXIT=1` with 28/32 failing on `NotEncodableError`, restored via surgical inverse Edit, verified with `cmp` (exit 0) against a pre-plant snapshot, suite green again (`EXIT=0`, 32/32)
- `npx vitest run --project node packages/core/src/naming.test.ts --reporter=verbose` → confirmed the three new `it` titles appear verbatim: "signs it, so it cannot be attached to or stripped from a record after the fact", "leaves a record that declares nothing hashing exactly as it did before the field existed", "round-trips it through the wire form, and refuses a record whose declaration was widened to anything but true rather than dropping it"
- `grep -c "wantsNetworkReach: false" packages/core/src/naming.test.ts` → `1`
- `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` → `EXIT=0`, 26/26 (run before and after the test-file edit; this plan's prose and the docblocks added to `naming.ts` do not trip the five-word guard)
- Pre-commit hook's cheap-guard suite ran on both commits (vocabulary, purity, mutation-ledger, disclosure, ledgers, reachability, traceability, state) — 403/403 passed both times
- `git show --stat` on each commit confirmed exactly one file per commit, matching the plan's `files_modified`

**What was NOT done, explicitly:** No wire codec changes (`packages/net/src/protocol.ts`'s `nameRecordToValue`/`parseNameRecord`) — that is plan 46-02, named in this plan's own objective as the next reader of this interface. No guard reads `wantsNetworkReach` anywhere (that is `network-reach-guard.ts`, plan 46-03). No grant logic, no `fetch`, no host import — out of this phase's scope per CONTEXT.md §7. The full project-wide vitest suite (all five projects) was not run — only `naming.test.ts` under `--project node` and the vocabulary guard were run directly, per the plan's own `<verification>` block, which names exactly those two commands. **CAP-01 is NOT fully complete** — this plan is "half 1" by its own objective (see frontmatter `requirements-completed`, and read it as partial: five more plans in this phase remain before CAP-01 as a whole is done); `requirements.mark-complete` was deliberately **not run** for CAP-01. The live frontmatter's `total_phases`/`completed_phases`/plan counters in `.planning/STATE.md` were deliberately **not touched** by automation this session (see Deviations item 2) — only a metrics-table row and two decision-log lines were hand-appended to STATE.md's body.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`NameRecord.wantsNetworkReach` is now a settled interface that 46-02 (wire codec) and 46-03 (`network-reach-guard.ts`) can read against. 46-02 must add the identical field to `nameRecordToValue`/`parseNameRecord` in `packages/net/src/protocol.ts` under the same discipline — CONTEXT.md §1 already names the exact transport bug that results if that codec drifts from `naming.ts`'s. No blockers.

**A tooling finding for whoever runs the next plan's state update:** avoid `gsd-sdk query state.record-session` and `state.advance-plan` against this repository's `.planning/STATE.md` — see Deviations item 2. Prefer hand-appending to the body (metrics table, decisions section) and leaving the live frontmatter counters to the owner, exactly as `STATE.md`'s own hand-written block already instructs for `stopped_at`.

---
*Phase: 46-a-module-declares-its-reach-and-the-data-decides*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/naming.ts
- FOUND: packages/core/src/naming.test.ts
- FOUND: .planning/phases/46-a-module-declares-its-reach-and-the-data-decides/46-01-SUMMARY.md
- FOUND: 0896b63 (Task 1 commit)
- FOUND: 573b751 (Task 2 commit)
