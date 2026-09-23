---
phase: 46-a-module-declares-its-reach-and-the-data-decides
plan: 03
subsystem: core
tags: [executor, guard, sovereignty, provenance, network-reach]

# Dependency graph
requires:
  - phase: 46-a-module-declares-its-reach-and-the-data-decides
    provides: "NameRecord.wantsNetworkReach?: true, signed and wire-carried (plans 01, 02)"
provides:
  - "guardNetworkReach, NetworkReachRefusal, describeNetworkReachRefusal (packages/core/src/executor/network-reach-guard.ts) — refuses a sovereign task whose module declares network reach, before inner.execute runs"
  - "network-reach-guard.test.ts — the watched()-counter proof for the refusal, the positive control, and the declares-nothing double control"
affects: [46-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Third composed adapter between guardSovereignty (outermost) and guardModuleProvenance (innermost) — same Executor-wrapping shape, no new port method"
    - "Reading an unverified signed field is safe only in a refuse-never-grant guard; the reasoning is written in the guard's own docblock, not only in the plan"

key-files:
  created:
    - "packages/core/src/executor/network-reach-guard.ts"
    - "packages/core/src/executor/network-reach-guard.test.ts"
  modified:
    - "vitest.config.ts"
    - "packages/node/src/reachability-guard.node.test.ts"

key-decisions:
  - "guardNetworkReach reads task.moduleRecord.wantsNetworkReach unverified — safe only because this guard refuses and never grants; that argument is written into the file's own docblock, matching two exact sentences the plan's acceptance criteria grep for"
  - "Raised ORPHAN_MODULE_CEILING 35 -> 36 in reachability-guard.node.test.ts, outside this plan's stated files_modified — see Deviations"
  - "vitest.config.ts's files/unitFiles moved from a collection-only vitest list reading (271/188); tests/unitTests deliberately left at 3907/3138, deferred to 46-06's full-lane sweep"

patterns-established: []

requirements-completed: []  # CAP-01 is NOT fully complete — this is "half 3" of 6 plans; wiring (46-05) and the mutation ledger (46-04) remain. requirements.mark-complete was NOT run.

# Metrics
duration: ~20min
completed: 2026-09-23
---

# Phase 46 Plan 03: A module declares its reach — the guard Summary

**`guardNetworkReach` wraps an `Executor` so a task whose module signed `wantsNetworkReach: true` is refused whole, before `inner.execute` ever runs, exactly when the task is labelled sovereign — proven by a five-case counter proof with two watched decision-flip plants, not by prose, and composed as a third adapter between `guardSovereignty` and `guardModuleProvenance` per 46-CONTEXT.md §3.**

## Performance

- **Duration:** ~20 min (two task commits, `7bf5274` then `3a4ee39`, ~3 min apart; total session longer including plan/context reading and an advisor consult on a mid-task blocker)
- **Completed:** 2026-09-23
- **Tasks:** 2 planned, 2 completed
- **Files modified:** 4 (2 created, 2 modified — one modification outside the plan's stated `files_modified`, see Deviations)

## Accomplishments

- `packages/core/src/executor/network-reach-guard.ts`: `guardNetworkReach(inner)` returns an `Executor` whose entire refusal logic is one `if (task.label === 'sovereign' && task.moduleRecord?.wantsNetworkReach === true)`, refusing before `inner.execute` and falling through unconditionally to `inner.execute(task)` otherwise. `NetworkReachRefusal` / `describeNetworkReachRefusal` copy `module-provenance.ts`'s discriminated-union shape exactly, one variant today (`'declared-against-sovereign'`).
- The file's own docblock carries, verbatim to the plan's grep criteria: the composition order (`guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty)` at both `fabric-node.ts:2929` and `browser-node.ts:2532`), why it sits inside `guardSovereignty`, why it is a separate adapter rather than a branch inside `guardModuleProvenance` (naming `runs-unsigned-artifacts` explicitly), and the safety argument for reading an unverified field — "safe only because this phase refuses and never grants" and "a grant must never be made at a point that reads an unverified record", both present as exact single-line substrings.
- `packages/core/src/executor/network-reach-guard.test.ts`: five named cases plus a `nodeId` passthrough check, following `sovereignty-guard.test.ts`'s `watched()`/`baseTask` shape verbatim. Case A (refusal) and Case B (the positive control — same declaring module, public label, reaches `inner.execute`) are the two the ordering claim lives on; Cases C, D, E are the declares-nothing double control on both labels.
- `vitest.config.ts`'s `files`/`unitFiles` moved 270/187 -> 271/188, measured by collection-only `vitest list --project node --filesOnly` (never a full-lane run), with a dated derivation note in the established format; `tests`/`unitTests` left unchanged at 3907/3138 with an explicit deferral to `46-06-PLAN.md`.

## Task Commits

Each task was committed atomically, with explicit paths:

1. **Task 1: guardNetworkReach — the refusal, and why reading an unverified record here is safe** - `7bf5274` (feat) — touches `network-reach-guard.ts` AND `reachability-guard.node.test.ts` (see Deviations; the plan's own `files_modified` names only the former)
2. **Task 2: network-reach-guard.test.ts — the watched()-counter proof, and vitest.config.ts's count** - `3a4ee39` (test) — touches `network-reach-guard.test.ts` and `vitest.config.ts`, matching the plan's `files_modified` for this task

## Files Created/Modified

- `packages/core/src/executor/network-reach-guard.ts` (created) - `guardNetworkReach`, `NetworkReachRefusal`, `describeNetworkReachRefusal`, and the required docblock reasoning
- `packages/core/src/executor/network-reach-guard.test.ts` (created) - five behavior cases + nodeId passthrough
- `vitest.config.ts` (modified) - `files`/`unitFiles` incremented with dated derivation notes; `tests`/`unitTests` unchanged, deferred
- `packages/node/src/reachability-guard.node.test.ts` (modified, **outside this plan's stated `files_modified`**) - `ORPHAN_MODULE_CEILING` raised 35 -> 36 with a dated, named entry

## Decisions Made

- Followed `module-provenance.ts`'s exact refusal-union shape (no `default` arm in `describe*`) rather than inventing a variant shorthand.
- Wrote the two load-bearing sentences the plan's acceptance criteria grep for (`safe only because this phase refuses and never grants`; `must never be made at a point that reads an unverified record`) each on a single un-wrapped comment line — the first draft split them across a JSDoc line wrap and both greps returned 0 until fixed. Recorded as a self-caught defect, not a deviation, since it never reached a commit.
- Chose to raise `ORPHAN_MODULE_CEILING` rather than use `O2_SKIP_GUARDS=1` or stop at a checkpoint — see Deviations below for the full reasoning, confirmed against an advisor consult mid-task.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/node/src/reachability-guard.node.test.ts` touched outside this plan's stated `files_modified`, to raise `ORPHAN_MODULE_CEILING`**

- **Found during:** Task 1's commit attempt. The pre-commit hook's cheap-guard suite refused the commit: staging `network-reach-guard.ts` alone (no production importer yet — wiring into `fabric-node.ts`/`browser-node.ts` is explicitly `46-05`'s subject, out of this plan's scope fence) pushed the count of production modules with no production importer to 36 against a hard-coded `ORPHAN_MODULE_CEILING = 35` in `reachability-guard.node.test.ts`.
- **Why this is directly caused by this task's own change, not a pre-existing or unrelated failure:** before staging, `orphanModules` read 35 (the tree's existing state); after staging exactly this task's one new file, it read 36. The guard's own docblock states a spec importing a module "cannot rescue it here" — so Task 2's test file, arriving later in the same plan, does not resolve this either; the orphan reading is a direct, mechanical consequence of adding an unwired production module.
- **Fix:** raised `ORPHAN_MODULE_CEILING` 35 -> 36 with a dated, named entry following the file's own established precedent verbatim in shape — `location-claims.ts` (34 -> 35) and `check-copy.ts` (33 -> 34) are both prior entries for the identical situation: "a module whose only importer is its own `.test.ts`/`.node.test.ts` spec, which the traced graph does not walk because specs are not production." The new entry names `network-reach-guard.ts`, states the mechanism, and records a checkable closing condition: the ceiling returns 36 -> 35 when `46-05-PLAN.md` wires `guardNetworkReach` into both node factories, and that plan's own `files_modified` should include this file for that reason.
- **Alternatives considered and rejected:** `O2_SKIP_GUARDS=1` would leave the tree at 36 orphans against a ceiling of 35, redlining the *next* commit by whoever runs it next for a module they did not write — the same failure mode `banned-vocabulary.ts`'s own docblock names as the reason per-file exemptions are dated and reasoned rather than silent. Stopping at a checkpoint was considered and rejected as disproportionate to a mechanical, fully-precedented one-line ceiling raise; confirmed via an advisor consult mid-task, whose full reasoning is reflected in the fix above.
- **Files modified:** `packages/node/src/reachability-guard.node.test.ts` (comment + one constant, `35` -> `36`)
- **Verification:** `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts -t "names an unimported production module"` -> `EXIT=0`; full file (35 tests) -> `EXIT=0`; `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` -> `EXIT=0` (the new comment does not trip the five-word guard); `npx tsc --noEmit -p .` -> `EXIT=0`.
- **Committed in:** `7bf5274` (same commit as Task 1's implementation, so the ceiling raise is bound to the module it names and the pre-commit hook sees a consistent tree)

**Impact on plan:** The plan's own `<verification>` block states `git show --stat` after commit should list exactly three files across the plan (`network-reach-guard.ts`, `network-reach-guard.test.ts`, `vitest.config.ts`). Across the two actual commits, a fourth file — `reachability-guard.node.test.ts` — was also touched, for the reason above. **This is a genuine deviation from the plan's stated verification, not an omission**: `git show --stat 7bf5274` lists two files, `git show --stat 3a4ee39` lists two files, four files total across the plan. No other file outside the plan's scope was touched. `46-05-PLAN.md` should carry `packages/node/src/reachability-guard.node.test.ts` in its own `files_modified` to lower the ceiling back to 35 once wiring lands.

---

**Total deviations:** 1 (Rule 3, blocking, outside stated `files_modified`, documented above with full reasoning and an advisor consult)

## TDD Gate Compliance

Both tasks are `tdd="true"`. Implementation landed in Task 1 (`7bf5274`, feat) and the test file in Task 2 (`3a4ee39`, test) — the same feat-then-test commit order 46-01's and 46-02's own Summaries flagged and did not fully correct. This plan does not claim a live pre-implementation RED; instead, RED was watched **after** both files existed, via two separate decision-flip plants on the guard's own `if` condition, each restored by surgical inverse and verified `cmp`-clean against a pre-plant snapshot before the commit:

- **Plant 1 — the label comparison:** `task.label === 'sovereign'` -> `task.label === 'public'`. Observed: `EXIT=1`, 2 failed / 4 passed. The two cases that reddened are exactly the two the ordering claim lives on — Case A (the refusal) and Case B (the positive control) — confirming those are the cases sensitive to this line, and that the other three (C, D, E) are correctly insensitive to it. Restored via surgical inverse edit, `cmp` against the pre-plant snapshot -> exit 0, suite green again (6/6).
- **Plant 2 — the `wantsNetworkReach` comparison:** `=== true` -> `!== true`. Observed: `EXIT=1`, 3 failed / 3 passed. Cases A, C, D reddened (all three that construct a `moduleRecord`); Case B (public label) and Case E (no moduleRecord) stayed green, as expected since neither depends on this comparison's polarity to reach its asserted outcome by the same path. Restored via surgical inverse edit, `cmp` against the pre-plant snapshot -> exit 0, suite green again (6/6), `npx tsc --noEmit -p .` -> `EXIT=0`.

No plant was made "downstream of an early return" — both targeted the one `if` condition directly, per this repository's own rule that a plant of that shape is unreachable-with-a-wrong-value and stays green regardless of test quality.

## Verification Performed (actual output, not asserted)

- `grep -n "if (task.label === 'sovereign' && task.moduleRecord?.wantsNetworkReach === true) {" packages/core/src/executor/network-reach-guard.ts` -> matched exactly once
- `grep -c "safe only because this phase refuses and never grants" packages/core/src/executor/network-reach-guard.ts` -> `1`
- `grep -c "must never be made at a point that reads an unverified record" packages/core/src/executor/network-reach-guard.ts` -> `1`
- `grep -c "runs-unsigned-artifacts" packages/core/src/executor/network-reach-guard.ts` -> `2` (>= 1 required)
- `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` -> `EXIT=0`, 26/26 (run four times across this plan, after every file edit)
- `npx tsc --noEmit -p .` -> `EXIT=0` (run after every task's edits, five times total)
- `npx vitest run --project node packages/core/src/executor/network-reach-guard.test.ts` -> `EXIT=0`, 6/6 (5 named cases from `<behavior>` + nodeId passthrough), all five titles present in output
- `npx vitest list --project node --filesOnly | wc -l` -> `271` (post-edit), matching the new `files` value; pre-edit baseline measured `270`, matching the recorded value
- `O2_UNIT_ONLY=1 npx vitest list --project node --filesOnly | wc -l` -> `188` (post-edit), matching the new `unitFiles` value; pre-edit baseline measured `187`, matching the recorded value — **both counts moved by exactly 1, as expected, measured on their own and not inferred from the `unitFiles === files - excludedInNode` identity**
- `grep -c "declared-against-sovereign\|network reach" packages/core/src/executor/network-reach-guard.test.ts` -> `5` (>= 5 required)
- `npx vitest run --project node packages/core/src/executor/network-reach-guard.test.ts packages/node/src/slow-specs.node.test.ts` -> `EXIT=0`, 21/21 (the plan's own combined `<verification>` command)
- `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts` -> `EXIT=0`, 35/35, after the `ORPHAN_MODULE_CEILING` raise
- `git show --stat 7bf5274` and `git show --stat 3a4ee39` -> confirmed exactly two files each, four total across the plan, matching the file list in the Deviations section (not the plan's stated three, for the recorded reason)
- Pre-commit hook's cheap-guard suite ran on both commits (vocabulary, purity, mutation-ledger, disclosure, ledgers, reachability, traceability, state) — 403/403 passed both times

**What was NOT done, explicitly:** No wiring into `fabric-node.ts` or `browser-node.ts` — that is `46-05-PLAN.md`'s subject, out of this plan's scope fence, and the guard remains an intentional orphan until then (tracked by the `ORPHAN_MODULE_CEILING` entry's closing condition). No mutation-ledger entry was added for either RED plant — `46-CONTEXT.md` §6 permits an entry once a plant is observed, but `packages/node/src/mutation-ledger.ts` is outside this plan's `files_modified` and is explicitly `46-04`'s subject per the plan's frontmatter dependency graph. `tests`/`unitTests` in `vitest.config.ts` were deliberately left unmoved at 3907/3138, deferred to `46-06-PLAN.md`'s full-lane sweep — no full `--project node` run was taken in this plan, only the two named-file runs and the collection-only `vitest list` reads, per the plan's own instruction to avoid the full lane. `requirements.mark-complete` was **not run** for `CAP-01` — this plan is "half 3" of six; `46-04` (mutation ledger) and `46-05` (wiring) remain before `CAP-01` is complete. `.planning/STATE.md` mutation via `gsd-sdk query state.*` was avoided entirely per the documented tooling hazard from `46-01`'s Summary — only this file and the state-update commands specified below were used, with diffs inspected before staging.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`guardNetworkReach` is a proven, pure `@o2/core` adapter ready to compose. `46-05-PLAN.md` can now wire `guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty)` into both `fabric-node.ts:2929` and `browser-node.ts:2532` unchanged from the shape this plan's own docblock states — and its `files_modified` should include `packages/node/src/reachability-guard.node.test.ts` to lower `ORPHAN_MODULE_CEILING` back to 35 once that wiring lands. `46-04` (mutation ledger entries for this guard's two now-observed plants) can build directly on the two plant records in this Summary's TDD Gate Compliance section. No blockers.

---
*Phase: 46-a-module-declares-its-reach-and-the-data-decides*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/executor/network-reach-guard.ts
- FOUND: packages/core/src/executor/network-reach-guard.test.ts
- FOUND: .planning/phases/46-a-module-declares-its-reach-and-the-data-decides/46-03-SUMMARY.md
- FOUND: 7bf5274 (Task 1 commit)
- FOUND: 3a4ee39 (Task 2 commit)
