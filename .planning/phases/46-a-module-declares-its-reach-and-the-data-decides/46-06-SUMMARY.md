---
phase: 46-a-module-declares-its-reach-and-the-data-decides
plan: 06
subsystem: testing
tags: [vitest, full-lane-sweep, mutation-testing, executor-guard, wire-protocol, naming]

# Dependency graph
requires:
  - phase: 46-a-module-declares-its-reach-and-the-data-decides
    provides: "the signed field (01), the wire codec (02), the guard (03), the mutation-ledger entries NR1/NR2 (04), and the wiring into both node factories (05) — everything this sweep runs together"
provides:
  - "The full `node`-project suite proven green with all five prior plans' edits landed together on one tree, not only file by file"
  - "vitest.config.ts's `tests`/`unitTests` completed from this plan's own full-lane run output (3907 -> 3924, 3138 -> 3152), closing the derivation 46-03 deliberately deferred"
  - "A criteria-to-test map naming, for each of the six roadmap success criteria, the real file and case title that carries it — closing CAP-01"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - "vitest.config.ts"

key-decisions:
  - "files/unitFiles were NOT re-derived — 46-03's collection-only readings (271/188) were confirmed directly against this run's own Test Files lines rather than trusted blind, per the plan's own instruction; both matched exactly, no drift found"
  - "tests/unitTests were read off this run's own collected totals (3924/3152), not reconstructed by summing each prior plan's stated per-file deltas — the new dated notes say so explicitly, matching this file's own standing rule that a full-lane figure is not a sum of plan-level arithmetic"

patterns-established: []

requirements-completed: [CAP-01]  # CAP-01 is complete in substance as of this plan — all six roadmap success criteria are named against a real, passing test in the map below. `requirements.mark-complete` was deliberately NOT run and `.planning/REQUIREMENTS.md`'s CAP-01 row was NOT touched — this plan's own scope fence assigns that step to the orchestrator, after the phase is verified.

# Metrics
duration: ~25min
completed: 2026-09-23
---

# Phase 46 Plan 06: The full node lane, in one sweep, and the criteria-to-test map Summary

**`npx vitest run --project node` ran to completion with all five prior plans' edits landed together — 270 files passed, 1 skipped (elfconv-dependent, unrelated to this phase), 3924 collected cases, zero failures — and the same is true of the unit-only lane and the two browser-project files this phase touches; `vitest.config.ts`'s `tests`/`unitTests` are now read off those real runs instead of left deferred, and all six roadmap success criteria are named against a real, passing test case, closing CAP-01.**

## Performance

- **Duration:** ~25 min (three test runs plus tsc plus two guard re-runs; no plant/restore cycle in this plan — nothing here is a `tdd="true"` task)
- **Completed:** 2026-09-23
- **Tasks:** 1 planned, 1 completed
- **Files modified:** 1

## Accomplishments

- **Full `node`-project lane, one sweep, every edit from plans 01-05 present:** `npx vitest run --project node` → `EXIT=0`. `Test Files  270 passed | 1 skipped (271)`. `Tests  3913 passed | 11 skipped (3924)`. The one skipped file is `packages/aot/src/elf-fixtures.node.test.ts` (needs the elfconv image this host does not have, 9 tests). The other 2 skipped tests are pre-existing single skips in `late-combine.node.test.ts` and `transport-bounds.node.test.ts`, unrelated to this phase. `deploy-preserves-enrolment.node.test.ts` and `fs-blockstore.node.test.ts` — named elsewhere in `vitest.config.ts` as sometimes failing on some hosts — both **passed** on this run. Nothing from this phase failed.
- **Unit-only lane:** `O2_UNIT_ONLY=1 npx vitest run --project node` → `EXIT=0`. `Test Files  187 passed | 1 skipped (188)`. `Tests  3143 passed | 9 skipped (3152)`. Same one skipped file, no other skip or failure.
- **The two browser-project files this phase added or touched:** `npx vitest run --project browser packages/browser/src/network-reach-composition.browser.test.ts packages/core/src/executor/network-reach-guard.test.ts` → `EXIT=0`, `Test Files 6 passed (6)`, `Tests 27 passed (27)` (each file runs on chromium, webkit, firefox).
- **`vitest.config.ts` counts confirmed, not silently reconciled:** the full run's own `Test Files (271)` line and the unit run's own `Test Files (188)` line both match 46-03's collection-only readings exactly — no mismatch to report. `tests` moved 3907 → 3924, `unitTests` moved 3138 → 3152, both read directly off the two runs above, with dated derivation notes in the file's established format (quoting the literal `Test Files`/`Tests` lines, naming host conditions, and stating that no single-file arithmetic is asserted to reconstruct the delta).
- **`npx tsc --noEmit -p .` → `EXIT=0`**, run twice (before and after the `vitest.config.ts` edit).
- **Criteria-to-test map** — see below.

## Criteria-to-test map

| # | Roadmap criterion (paraphrased) | Test file | Case title(s) |
|---|---|---|---|
| 1 | Declaration is inside the signature; an altered declaration fails verification; an absent one hashes byte-identically to before the field existed | `packages/core/src/naming.test.ts` | `'signs it, so it cannot be attached to or stripped from a record after the fact'`; `'leaves a record that declares nothing hashing exactly as it did before the field existed'`; `'round-trips it through the wire form, and refuses a record whose declaration was widened to anything but true rather than dropping it'` — plus `packages/net/src/protocol.test.ts`'s `'carries a NETWORK-REACH declaration across the wire so it still verifies'` (the wire half of the same claim, re-verified through `SignedNameResolver.accept`, not field-compared) |
| 2 | A declaring module against sovereign data is refused whole, by name, before `WebAssembly.instantiate` | `packages/core/src/executor/network-reach-guard.test.ts`'s `'refuses a sovereign task whose module declares network reach, before inner.execute runs'` (unit proof, the ordering claim lives on this case together with the positive control below) — proven at a real node by `packages/node/src/fabric-node.node.test.ts`'s `'refuses over real RPC, before anything executes, a sovereign task whose module declares network reach'` and `packages/browser/src/network-reach-composition.browser.test.ts`'s `'refuses a sovereign task whose module declares network reach, read through node.executor directly'` |
| 3 | Positive control — the same declaring module against a public shard is NOT refused | `packages/core/src/executor/network-reach-guard.test.ts`'s `'the positive control — the same declaring module against a public task reaches inner.execute unchanged'` — and at a real node: `fabric-node.node.test.ts`'s `'runs the identical declaring module as a public task, read through node.executor directly'`, `network-reach-composition.browser.test.ts`'s `'runs the identical declaring module as a public task'`. **Control, not a unit-only claim: both of the real-node cases go through `node.executor.execute` directly on a production-constructed `FabricNode`/`BrowserNode`, not only through the isolated `guardNetworkReach` unit** |
| 4 | A module declaring nothing is unaffected on both labels | `network-reach-guard.test.ts`'s `'a sovereign task whose module record carries no wantsNetworkReach reaches inner.execute unchanged'`, `'a sovereign task whose moduleRecord is entirely absent reaches inner.execute unchanged...'`, and `'the declares-nothing double control — a public task with no moduleRecord reaches inner.execute unchanged'` — and at a real node: `fabric-node.node.test.ts`'s `'runs a sovereign task whose module declares nothing, read through node.executor directly'`, `network-reach-composition.browser.test.ts`'s `'runs a sovereign task whose module declares nothing'`. **Same real-node qualification as criterion 3** — these are not unit-only |
| 5 | A mutation removing the sovereign check turns criterion 2 red; watched failing, restored by the surgical inverse, `cmp` verified | `packages/node/src/mutation-ledger.ts`'s `NR2` entry — plants `false && ` onto `guardNetworkReach`'s one `if` condition; observed `EXIT=1`, `1 failed \| 5 passed (6)`, only the refusal case (Case A) reddening; restored, `cmp` exit 0; re-checkable on demand via `npm run test:mutations` or the cheap layer `packages/node/src/mutation-guard.node.test.ts` (189/189 in this plan's own run, confirming `NR2`'s `find` text still occurs exactly once and its `caughtBy` file still exists) |
| 6 | The refusal is readable by the requestor — a named refusal, not a generic execution failure | `network-reach-guard.test.ts` lines 82-83: `expect(outcome.reason).not.toContain('sovereignty violation')` and `.not.toContain('module provenance refused')`, distinguishing this refusal by name from the two other refusals composed around it — and at a real node, over the wire, `fabric-node.node.test.ts`'s two assertions `expect(overTheWire.reason).not.toContain('sovereignty')` (line 439) and `expect(outcome.reason).not.toContain('sovereignty violation')` (line 562), the second read through `node.executor` directly, the first through a real RPC reply |

**Criteria 3 and 4 are the controls the plan asked to be flagged if carried only by a unit test rather than a real node — they are not.** Both are proven at a real, production-constructed `FabricNode` (`node.executor.execute` directly, per `fabric-node.node.test.ts`'s own established pattern for sidestepping the egress tap on non-refusal cases) and a real `BrowserNode` (real IndexedDB, real Worker via `TaskExecutorWorker`), in addition to the unit-level `guardNetworkReach` cases. The map above states that qualification explicitly rather than letting the table imply a unit-only reading.

## Task Commits

1. **Task 1: the full node lane, in one sweep, vitest.config.ts's remaining two counts, and the criteria-to-test map** - `583c9cb` (docs) — touches only `vitest.config.ts`, confirmed via `git show --stat`

## Files Created/Modified

- `vitest.config.ts` - two new dated notes (one beside `files`/`tests`, one beside `unitFiles`/`unitTests`) completing the `46-06`-deferred half of the derivation; `tests: 3907 -> 3924`, `unitTests: 3138 -> 3152`; `files`/`unitFiles` unchanged (271/188, confirmed against this run rather than re-measured)

## Decisions Made

- `files`/`unitFiles` were left unchanged and merely confirmed against the two runs' own `Test Files` lines, per the plan's own acceptance criterion that a mismatch would be reported rather than reconciled — none was found, so nothing to report beyond the confirmation itself.
- `tests`/`unitTests` deltas (17 and 14 respectively) are stated in the new notes as read directly off each run's own collected total, with an explicit disclaimer that no single-file arithmetic is asserted to reconstruct either number — matching this file's own standing rule that a full-lane figure is not a sum of plan-level deltas, and avoiding the exact mistake ("a number satisfying its own check is not a reading") the file's history already records once.

## Deviations from Plan

None — plan executed exactly as written. The one task's `<action>` and `<acceptance_criteria>` are satisfied in full: both full-lane runs exit 0, the browser-lane command exits 0, `vitest.config.ts`'s two remaining counts are read off real output with a dated note in the established format, `files`/`unitFiles` confirmed rather than silently reconciled, and the SUMMARY's criteria-to-test table names all six roadmap criteria with at least one concrete file/case per row.

## Issues Encountered

None. Host load spiked between the full-lane run (load/core 0.97 before, 11.23 after) and the unit-only run taken immediately after (load/core 8.38 before, 6.64 after) — both runs' own banners flagged the host as oversubscribed and both are reported per this repository's rule that an oversubscribed host voids DURATION and not counts. No wall-clock figure from either run is quoted in `vitest.config.ts` or here.

## TDD Gate Compliance

Not applicable — this plan's one task is not `tdd="true"` and adds no behavior; it runs existing tests and completes a documentation-only field pair in `vitest.config.ts`.

## Verification Performed (actual output, not asserted)

- `git status --porcelain` before starting → clean (confirmed no plant left mid-restore by an earlier plan)
- `npx vitest run --project node` → `EXIT=0`, `Test Files 270 passed | 1 skipped (271)`, `Tests 3913 passed | 11 skipped (3924)`; banner: `HOST WAS OVERSUBSCRIBED — load/core 0.97 before, 11.23 after (8 cores, ceiling 4.00)`
- `O2_UNIT_ONLY=1 npx vitest run --project node` → `EXIT=0`, `Test Files 187 passed | 1 skipped (188)`, `Tests 3143 passed | 9 skipped (3152)`; banner: `HOST WAS OVERSUBSCRIBED — load/core 8.38 before, 6.64 after (8 cores, ceiling 4.00)`
- `npx vitest run --project browser packages/browser/src/network-reach-composition.browser.test.ts packages/core/src/executor/network-reach-guard.test.ts` → `EXIT=0`, `Test Files 6 passed (6)`, `Tests 27 passed (27)` across chromium/webkit/firefox; banner: `HOST WAS OVERSUBSCRIBED — load/core 5.80 before, 5.47 after (8 cores, ceiling 4.00)`
- `npx tsc --noEmit -p .` → `EXIT=0` (run twice, before and after the `vitest.config.ts` edit)
- `npx vitest run --project node packages/node/src/vocabulary.node.test.ts packages/node/src/slow-specs.node.test.ts` → `EXIT=0`, `41/41` — confirms the two new dated notes trip neither the five-word guard nor the drift assertion against the file's own new `files`/`tests`/`unitFiles`/`unitTests` values
- `npx vitest run --project node packages/node/src/mutation-guard.node.test.ts packages/node/src/reachability-guard.node.test.ts` → `EXIT=0`, `224/224` — the cheap layer, confirming `NR1`/`NR2` and every other ledger entry still describe real source and every reachability finding is still accounted for, unaffected by this plan's own edit
- `EXIT=$?` read on the line immediately after every command above, no pipe, no trailing `tail`/`echo` — the near-miss `46-04`'s Summary records (a `tee` swallowing a real exit code) was avoided by using plain redirection throughout

**What was NOT done, explicitly:** No deploy, no Cloudflare resource, no release — out of scope per this plan's own scope fence. No `fetch`, no host import, no network access granted anywhere — out of this phase's scope per `46-CONTEXT.md` §7. **`requirements.mark-complete` for `CAP-01` was deliberately NOT run, and `.planning/REQUIREMENTS.md`'s CAP-01 row was NOT touched** — this plan's own scope fence states plainly "the orchestrator owns that after the phase is verified," and that instruction is followed literally rather than read as permission to run the command as part of a standard state-update step. `CAP-01` is complete in substance (see the criteria-to-test map above) but closes formally only when the orchestrator runs that step. No `gsd-sdk query state.*` **mutation** command was run against `.planning/STATE.md` — per the tooling hazard `46-01`'s Summary records (confirmed independently on two commands) and this plan's own scope fence ("Nothing rewrites `.planning/STATE.md`'s frontmatter") — only the body was hand-appended (one metrics row, one decision entry), and `git diff` confirmed the change was additions-only (14 `+` lines, 0 `-` content lines beyond the diff header) before staging.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

CAP-01 is complete: a module's wish for network reach is a signed, optional field that survives the wire intact; a task whose module declares it, dispatched against sovereign data, is refused whole before instantiation on both production tiers; the refusal is proven distinguishable from every other refusal in the same composition chain and readable by the requestor; a mutation removing the check is caught automatically; and every claim above is now proven together, on one tree, by a full-lane sweep rather than file by file. What this phase explicitly left open — who may sign a declaration, whether a signer can be trusted to declare honestly, and the audience split once refusals consult node-held state — is the next phase's subject, named as such in `46-CONTEXT.md` §4 and §7 and in the roadmap's own "what this does not fix" paragraph. No blockers.

---
*Phase: 46-a-module-declares-its-reach-and-the-data-decides*
*Completed: 2026-09-23*

## Self-Check

- FOUND: vitest.config.ts (modified, confirmed via `git show --stat 583c9cb`)
- FOUND: 583c9cb (Task 1 commit — `git log --oneline --all | grep 583c9cb` matches)
- FOUND: packages/core/src/naming.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/net/src/protocol.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/core/src/executor/network-reach-guard.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/node/src/fabric-node.node.test.ts (cited case titles and line-numbered assertions confirmed present via `grep -n` against the file)
- FOUND: packages/browser/src/network-reach-composition.browser.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/node/src/mutation-ledger.ts (NR1, NR2 entries confirmed present via `grep -n` and `sed -n`)

## Self-Check: PASSED
