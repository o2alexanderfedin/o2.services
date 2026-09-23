---
phase: 46-a-module-declares-its-reach-and-the-data-decides
plan: 04
subsystem: testing
tags: [mutation-testing, regression-proof, wire-protocol, executor-guard]

# Dependency graph
requires:
  - phase: 46-a-module-declares-its-reach-and-the-data-decides
    provides: "the wire codec carrying wantsNetworkReach (plan 02) and guardNetworkReach's refusal (plan 03)"
provides:
  - "NR1 — a mutation-ledger entry proving a regression that drops wantsNetworkReach from the wire codec is caught by protocol.test.ts's NETWORK-REACH round-trip case, re-checkable on demand via npm run test:mutations"
  - "NR2 — a mutation-ledger entry proving a regression that disables guardNetworkReach's sovereign-check condition is caught by network-reach-guard.test.ts's refusal case, re-checkable on demand"
affects: [46-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Both plants target the decision surface (a spread condition, an if condition), not a write downstream of one, per this repository's own stated rule that a plant reachable only after an early return is a blind instrument"

key-files:
  created: []
  modified:
    - "packages/node/src/mutation-ledger.ts"

key-decisions:
  - "Split the two ledger entries into two commits (one per plan task) rather than one combined edit, so each task's own acceptance criteria (cheap-layer count, git show --stat scope) are checkable against its own commit rather than a merged diff."
  - "Used signatureSource: 'test-title' for both entries — each observed failure text is the it() title vitest echoes on its FAIL line, verbatim source text in the caughtBy file, matching XW3/XW4's own choice for the same reason."

patterns-established: []

requirements-completed: []  # CAP-01 is NOT complete by this plan alone — wiring into the node factories (46-05) still remains, per 46-02 and 46-03's own notes. requirements.mark-complete was NOT run.

# Metrics
duration: ~15min
completed: 2026-09-23
---

# Phase 46 Plan 04: The mutation ledger gains two entries — the codec drop and the sovereign check Summary

**Two deliberate defects — the wire codec silently dropping a declared `wantsNetworkReach`, and `guardNetworkReach`'s sovereign-check condition going dead — were each planted for real in `protocol.ts` and `network-reach-guard.ts`, watched go red, restored by the exact-inverse edit with `cmp` confirming byte-identical restoration, and recorded as `NR1`/`NR2` in `mutation-ledger.ts` so either regression is now caught automatically by `npm run test:mutations` instead of rediscovered by hand.**

## Performance

- **Duration:** ~15 min (two task commits, `0f090a0` then `5fe90bb`, ~30s apart; plants and verification runs preceded each commit)
- **Completed:** 2026-09-23
- **Tasks:** 2 planned, 2 completed
- **Files modified:** 1 (`packages/node/src/mutation-ledger.ts`), across two commits

## Accomplishments

- **NR1**: Planted `|| true` onto `nameRecordToValue`'s `wantsNetworkReach` spread condition in `packages/net/src/protocol.ts` (the identical idiom `XW4` uses on `certificate.x509`). Run against `packages/net/src/protocol.test.ts`: `EXIT=1`, `Tests  1 failed | 23 passed (24)`. The failing case was DET-03's `carries a NETWORK-REACH declaration across the wire so it still verifies`, observed assertion `AssertionError: expected undefined to be true` at `protocol.test.ts:205:39`. Restored by removing exactly the ` || true` text added; `cmp` against the pre-plant snapshot exited 0; re-run confirmed `EXIT=0`.
- **NR2**: Planted `false && ` onto `guardNetworkReach`'s one `if` condition in `packages/core/src/executor/network-reach-guard.ts` (this repository's standing `if (false && ...)` idiom, matching `XW1`-`XW3`). Run against `packages/core/src/executor/network-reach-guard.test.ts`: `EXIT=1`, `Tests  1 failed | 5 passed (6)`. Only Case A (`refuses a sovereign task whose module declares network reach, before inner.execute runs`) reddened, observed `AssertionError: expected 1 to be +0` at `network-reach-guard.test.ts:75:21`; the positive control and both declares-nothing controls (Cases B-E) stayed green, as the plan predicted — the plant only removes a refusal, it never adds one. Restored by removing exactly the `false && ` text; `cmp` exited 0; re-run confirmed `EXIT=0`.
- Both entries added to `MUTATIONS` — `NR1` immediately after `XW4`, `NR2` immediately after `NR1` — each carrying a `signature` that is the observed `it()` title (verbatim source text in its `caughtBy` file), `signatureSource: 'test-title'`.
- `npx vitest run --project node packages/node/src/mutation-guard.node.test.ts` (the cheap layer) passed at 188 tests with only `NR1` present, and 189 with both present — confirming each entry's `find` text occurs exactly once in its file and its `caughtBy` files exist.
- `npx tsc --noEmit -p .` and `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` both exit 0 against the final tree.

## A near-miss worth recording

The very first verification run of NR1 was piped through `tee` for convenience (`npx vitest run ... | tee file`). The suite failed (visible in the printed output), but `$?` captured `tee`'s own exit status, not vitest's, and printed `EXIT=0` — the exact hazard the plan's hard rules warn against. Caught before anything was recorded, by noticing the printed exit code contradicted the failing test list directly above it. Every subsequent run in this plan used plain redirection (`> file 2>&1`) with `EXIT=$?` on the very next line, no pipe.

## Task Commits

Each task was committed atomically, with explicit paths:

1. **Task 1: NR1 — the wire codec's wantsNetworkReach drop, mirroring XW4** - `0f090a0` (test) — touches only `mutation-ledger.ts`; pre-commit cheap guards (9 files, 404 tests) passed
2. **Task 2: NR2 — criterion 5's plant, the sovereign check itself** - `5fe90bb` (test) — touches only `mutation-ledger.ts`; pre-commit cheap guards (9 files, 405 tests) passed

## Files Created/Modified

- `packages/node/src/mutation-ledger.ts` (modified) - two new `Mutation` entries, `NR1` and `NR2`, each with an observed (not predicted) signature

## Deviations from Plan

None — plan executed as written. The plan's own read_first noted the actual source at `protocol.ts` wraps the spread condition across three lines (prettier-formatted) rather than the single-line form the plan's action text quoted; the `find`/`replace` strings in `NR1` use the real multi-line text with embedded `\n' +` concatenation, which has direct precedent elsewhere in the ledger (e.g. the entries around `:405`, `:841-847`), and `mutation-guard.mutate.ts` applies `find`/`replace` via a whole-content `String#split`/`Array#join`, which handles embedded newlines correctly. Not logged as a deviation since it required no judgment call — the plan's own criterion was "exact current text," and that is what was used.

## Self-Check

- `packages/net/src/protocol.ts` — `cmp` against the pre-plant snapshot: exit 0 (both after the initial plant/restore and confirmed via `git diff --stat` against HEAD showing no change)
- `packages/core/src/executor/network-reach-guard.ts` — `cmp` against the pre-plant snapshot: exit 0 (same)
- Commit `0f090a0`: `git show --stat` confirms only `packages/node/src/mutation-ledger.ts` changed
- Commit `5fe90bb`: `git show --stat` confirms only `packages/node/src/mutation-ledger.ts` changed
- `git status --porcelain`: clean at the end of the plan, no plant left behind

## Self-Check: PASSED

## What was NOT done

- **`npm run test:mutations` (the full mutation script) was not run.** It plants every entry in the ledger, which is out of this plan's scope and was not required by its `<verify>` section — only the cheap layer (`mutation-guard.node.test.ts`) was required to pass, and it did. `NR1`/`NR2` were each proven for real by hand, matching exactly what the script would do for those two entries individually.
- **CAP-01 is not complete.** This plan closes roadmap criterion 5 (the mutation-ledger proof) only. Wiring `guardNetworkReach` into the node factories is plan 46-05, not yet run. `requirements.mark-complete` was not invoked.
- **No `state.*` mutation commands were run** (per this session's own tooling-trap warning that they corrupt `STATE.md`'s frontmatter) — `STATE.md` was left for the orchestrator to update through a safe path.
