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
  - "tests/unitTests are the two runs' own collected totals (3924/3152). The 17/14 deltas were then attributed by measurement, not assumed: each phase-46 file's contribution was confirmed by planting the 707ec0e pre-phase snapshot back, running the file alone, and cmp-restoring — this surfaced a +1 in each lane that is NOT this phase's own (browser-client-publish.node.test.ts, from intervening deploy work never folded in since the 2026-09-16 baseline), which a same-run-total-only approach would have silently mis-attributed to this phase"

patterns-established: []

requirements-completed: [CAP-01]  # CAP-01 is complete in substance as of this plan — all six roadmap success criteria are named against a real, passing test in the map below. `requirements.mark-complete` was deliberately NOT run and `.planning/REQUIREMENTS.md`'s CAP-01 row was NOT touched — this plan's own scope fence assigns that step to the orchestrator, after the phase is verified.

# Metrics
duration: ~25min
completed: 2026-09-23
---

# Phase 46 Plan 06: The full node lane, in one sweep, and the criteria-to-test map Summary

**`npx vitest run --project node` ran to completion with all five prior plans' edits landed together — 270 files passed, 1 skipped (its own `CAN_BUILD` gate: arm64 present, Docker daemon unreachable on this host, unrelated to this phase), 3924 collected cases, zero failures — and the same is true of the unit-only lane and the two browser-project files this phase touches; `vitest.config.ts`'s `tests`/`unitTests` are now read off those real runs instead of left deferred (with the delta attributed per file, not merely trusted), and all six roadmap success criteria are named against a real, passing test case, closing CAP-01.**

## Performance

- **Duration:** ~25 min (three test runs plus tsc plus two guard re-runs; no plant/restore cycle in this plan — nothing here is a `tdd="true"` task)
- **Completed:** 2026-09-23
- **Tasks:** 1 planned, 1 completed
- **Files modified:** 1

## Accomplishments

- **Full `node`-project lane, one sweep, every edit from plans 01-05 present:** `npx vitest run --project node` → `EXIT=0`. `Test Files  270 passed | 1 skipped (271)`. `Tests  3913 passed | 11 skipped (3924)`. The one skipped file is `packages/aot/src/elf-fixtures.node.test.ts` (9 tests), gated by its own `CAN_BUILD` check — "native arm64 plus a Docker that answers," read from the file's own docblock rather than assumed; this host is arm64 but its Docker daemon did not answer (`docker version` failed to reach the socket), so all nine skip on that one check. The other 2 skipped tests are pre-existing single skips in `late-combine.node.test.ts` and `transport-bounds.node.test.ts`, unrelated to this phase. `deploy-preserves-enrolment.node.test.ts` and `fs-blockstore.node.test.ts` — named elsewhere in `vitest.config.ts` as sometimes failing on some hosts — both **passed** on this run. Nothing from this phase failed.
- **Unit-only lane:** `O2_UNIT_ONLY=1 npx vitest run --project node` → `EXIT=0`. `Test Files  187 passed | 1 skipped (188)`. `Tests  3143 passed | 9 skipped (3152)`. Same one skipped file, no other skip or failure.
- **The two browser-project files this phase added or touched:** `npx vitest run --project browser packages/browser/src/network-reach-composition.browser.test.ts packages/core/src/executor/network-reach-guard.test.ts` → `EXIT=0`, `Test Files 6 passed (6)`, `Tests 27 passed (27)` (each file runs on chromium, webkit, firefox).
- **`vitest.config.ts` counts confirmed, not silently reconciled:** the full run's own `Test Files (271)` line and the unit run's own `Test Files (188)` line both match 46-03's collection-only readings exactly — no mismatch to report. `tests` moved 3907 → 3924, `unitTests` moved 3138 → 3152, both read directly off the two runs above, with dated derivation notes quoting the literal `Test Files`/`Tests` lines and host conditions.
- **The delta was attributed by measurement, not left as an opaque total.** `17 = 16 + 1`: sixteen of `tests`' arriving cases are this phase's own (`naming.test.ts` +3, `protocol.test.ts` +2, `fabric-node.node.test.ts` +3, `network-reach-guard.test.ts` +6 new, `mutation-ledger.ts`'s NR1/NR2 moving `mutation-guard.node.test.ts` +2), each confirmed by checking the pre-phase snapshot (`707ec0e`) back into place, running the file alone, and restoring (`cmp` exit 0 each time) — not assumed from the SUMMARYs' own stated deltas. **The remaining `+1` is not this phase's**: `browser-client-publish.node.test.ts` gained one case (14 → 15) from intervening deploy work that landed on this branch between the `3907` baseline (2026-09-16) and this phase's start, never folded into `vitest.config.ts` until this — the first full-lane run since — surfaced it. The unit lane's `14 = 13 + 1` breaks down the same way, with `fabric-node.node.test.ts`'s `+3` excluded (it starts real processes and is not in the unit set, confirmed absent from that run's own file list).
- **`npx tsc --noEmit -p .` → `EXIT=0`**, run twice (before and after the `vitest.config.ts` edit).
- **Criteria-to-test map** — see below.

## Criteria-to-test map

| # | Roadmap criterion (paraphrased) | Test file | Case title(s) |
|---|---|---|---|
| 1 | Declaration is inside the signature; an altered declaration fails verification; an absent one hashes byte-identically to before the field existed | `packages/core/src/naming.test.ts` | `'signs it, so it cannot be attached to or stripped from a record after the fact'`; `'leaves a record that declares nothing hashing exactly as it did before the field existed'`; `'round-trips it through the wire form, and refuses a record whose declaration was widened to anything but true rather than dropping it'` — plus `packages/net/src/protocol.test.ts`'s `'carries a NETWORK-REACH declaration across the wire so it still verifies'` (the wire half of the same claim, re-verified through `SignedNameResolver.accept`, not field-compared) |
| 2 | A declaring module against sovereign data is refused whole, by name, **with both the declaration and the label in the refusal**, before `WebAssembly.instantiate` | `network-reach-guard.test.ts`'s `'refuses a sovereign task whose module declares network reach, before inner.execute runs'` (unit proof; the ordering claim lives on this case together with the positive control below) — its own body asserts the "by name" half directly: `expect(outcome.reason).toContain('w0')`, `.toContain(MODULE_CID.toString())`, `.toContain('sovereign')`, `.toContain('network reach')`. Proven at a real node by `fabric-node.node.test.ts`'s `'refuses over real RPC, before anything executes, a sovereign task whose module declares network reach'`, whose own body asserts the identical four-part claim over the wire: `expect(outcome.reason).toContain(node.peerId)`, `.toContain(moduleCid.toString())`, `.toContain('sovereign')`, `.toContain('network reach')` — and `network-reach-composition.browser.test.ts`'s `'refuses a sovereign task whose module declares network reach, read through node.executor directly'` |
| 3 | Positive control — the same declaring module against a public shard is NOT refused | `packages/core/src/executor/network-reach-guard.test.ts`'s `'the positive control — the same declaring module against a public task reaches inner.execute unchanged'` — and at a real node: `fabric-node.node.test.ts`'s `'runs the identical declaring module as a public task, read through node.executor directly'`, `network-reach-composition.browser.test.ts`'s `'runs the identical declaring module as a public task'`. **Control, not a unit-only claim: both of the real-node cases go through `node.executor.execute` directly on a production-constructed `FabricNode`/`BrowserNode`, not only through the isolated `guardNetworkReach` unit** |
| 4 | A module declaring nothing is unaffected on both labels | `network-reach-guard.test.ts`'s `'a sovereign task whose module record carries no wantsNetworkReach reaches inner.execute unchanged'`, `'a sovereign task whose moduleRecord is entirely absent reaches inner.execute unchanged...'`, and `'the declares-nothing double control — a public task with no moduleRecord reaches inner.execute unchanged'` — and at a real node: `fabric-node.node.test.ts`'s `'runs a sovereign task whose module declares nothing, read through node.executor directly'`, `network-reach-composition.browser.test.ts`'s `'runs a sovereign task whose module declares nothing'`. **Same real-node qualification as criterion 3** — these are not unit-only |
| 5 | A mutation removing the sovereign check turns criterion 2 red; watched failing, restored by the surgical inverse, `cmp` verified | `packages/node/src/mutation-ledger.ts`'s `NR2` entry — plants `false && ` onto `guardNetworkReach`'s one `if` condition; observed `EXIT=1`, `1 failed \| 5 passed (6)`, only the refusal case (Case A) reddening; restored, `cmp` exit 0; re-checkable on demand via `npm run test:mutations` or the cheap layer `packages/node/src/mutation-guard.node.test.ts` (189/189 in this plan's own run, confirming `NR2`'s `find` text still occurs exactly once and its `caughtBy` file still exists) |
| 6 | The refusal is readable by the requestor — a named refusal, not a generic execution failure | `network-reach-guard.test.ts`'s `'refuses a sovereign task whose module declares network reach, before inner.execute runs'` — the same case criterion 2 cites — carries two negative discriminations beside its four positive assertions: `expect(outcome.reason).not.toContain('sovereignty violation')` and `.not.toContain('module provenance refused')`, distinguishing this refusal by name from the two other refusals composed around it. At a real node, over real RPC, `fabric-node.node.test.ts`'s same CAP-01 case 1 carries the identical discrimination at the wire boundary: `expect(outcome.reason).not.toContain('sovereignty violation')`, with a comment stating this is "CAP-01's own guard, not the sovereignty gate this node was deliberately cleared past." **Correction against this map's first draft**: `fabric-node.node.test.ts:439`'s `expect(overTheWire.reason).not.toContain('sovereignty')` is a different case in a different `describe` block (`DATA-09`'s egress-tap discrimination), not part of the `CAP-01` block (lines 465-598) and not evidence for this criterion — it was cited in error and is corrected here, not left standing |

**Criteria 3 and 4 are the controls the plan asked to be flagged if carried only by a unit test rather than a real node — they are not.** Both are proven at a real, production-constructed `FabricNode` (`node.executor.execute` directly, per `fabric-node.node.test.ts`'s own established pattern for sidestepping the egress tap on non-refusal cases) and a real `BrowserNode` (real IndexedDB, real Worker via `TaskExecutorWorker`), in addition to the unit-level `guardNetworkReach` cases. The map above states that qualification explicitly rather than letting the table imply a unit-only reading.

## Task Commits

1. **Task 1: the full node lane, in one sweep, vitest.config.ts's remaining two counts, and the criteria-to-test map** - `583c9cb` (docs) — touches only `vitest.config.ts`, confirmed via `git show --stat`
2. **Post-review fix: attribute the tests/unitTests deltas by measurement instead of asserting the whole delta was this phase's own; correct the elf-fixtures skip reason and two criteria-map citations** - `39eefe7` (fix) — touches only `vitest.config.ts`; see Deviations below

## Files Created/Modified

- `vitest.config.ts` - two new dated notes (one beside `files`/`tests`, one beside `unitFiles`/`unitTests`) completing the `46-06`-deferred half of the derivation; `tests: 3907 -> 3924`, `unitTests: 3138 -> 3152`; `files`/`unitFiles` unchanged (271/188, confirmed against this run rather than re-measured)

## Decisions Made

- `files`/`unitFiles` were left unchanged and merely confirmed against the two runs' own `Test Files` lines, per the plan's own acceptance criterion that a mismatch would be reported rather than reconciled — none was found, so nothing to report beyond the confirmation itself.
- `tests`/`unitTests` deltas (17 and 14 respectively) are the two runs' own collected totals, matching the file's standing rule that a full-lane figure is not assumed from plan-level deltas. But the delta was then attributed by measurement rather than left opaque: planting `707ec0e` (the commit immediately before `46-01`'s first task) back into each touched file, running it alone, and `cmp`-restoring showed 16/13 of the two deltas are this phase's own and the remaining 1/1 in each lane is a real, correct case from intervening deploy work (`browser-client-publish.node.test.ts`) that landed on this branch between the `3907`/`3138` baseline (2026-09-16) and this phase's start, and was never folded into this table until this — the first full-lane sweep since — measured it. Recorded as such rather than silently absorbed into "this phase's own," avoiding the exact mistake ("a number satisfying its own check is not a reading") the file's history already records once.

## Deviations from Plan

None from the plan's own tasks — the one task's `<action>` and `<acceptance_criteria>` are satisfied in full, as stated below. Three corrections were made after an advisor review of this plan's first draft, before declaring done; recorded here rather than silently folded in, per this repository's own convention (46-05's post-review fix entry is the precedent).

### Post-review corrections

**1. [Self-caught, advisor-prompted] `vitest.config.ts`'s two new notes claimed the full 17/14 test-count deltas were "this phase's own arriving cases" — one case in each lane is not**
- **Found during:** advisor review, before declaring the plan done.
- **Issue:** the first-draft notes read the two runs' collected totals correctly but asserted, without checking, that the whole delta belonged to plans 01-05. Per-file measurement (planting the `707ec0e` pre-phase snapshot back into each touched file, running it alone, `cmp`-restoring) found the true phase-46 contribution is 16 of 17 (`tests`) and 13 of 14 (`unitTests`); the remaining `+1` in each lane is a real, correct case in `browser-client-publish.node.test.ts` (14 → 15) from intervening deploy work (`833591c`/`7a27074`) that landed on this branch between the `3907`/`3138` baseline (2026-09-16) and this phase's start, and was never folded into this table until this — the first full-lane sweep since — surfaced it.
- **Fix:** rewrote both notes in `vitest.config.ts` to state the 16+1 / 13+1 breakdown explicitly, each per-file delta confirmed by the plant/run/restore method above, restored `cmp`-clean before any commit.
- **Files modified:** `vitest.config.ts`
- **Verification:** `npx vitest run --project node packages/node/src/vocabulary.node.test.ts packages/node/src/slow-specs.node.test.ts` → `EXIT=0`, 41/41 (unchanged by the correction); `npx tsc --noEmit -p .` → `EXIT=0`.
- **Committed in:** `39eefe7` (fix)

**2. [Self-caught, advisor-prompted] The criteria-to-test map's criterion 6 row cited a line from a different `describe` block**
- **Found during:** the same advisor review.
- **Issue:** the map cited `fabric-node.node.test.ts:439` as CAP-01 evidence for criterion 6. `grep -n "^describe("` against the file shows line 439 falls inside the `DATA-09` block (287-464), not the `CAP-01` block (465-598) — a different refusal (the egress tap's own discrimination), not `guardNetworkReach`'s.
- **Fix:** replaced the citation with the real `CAP-01` case's own discrimination (`fabric-node.node.test.ts:562`, inside the `CAP-01` block, `expect(outcome.reason).not.toContain('sovereignty violation')`), and the row states the correction explicitly rather than silently swapping the citation.
- **Files modified:** `.planning/phases/46-a-module-declares-its-reach-and-the-data-decides/46-06-SUMMARY.md` (this file)
- **Verification:** `sed -n '465,598p' packages/node/src/fabric-node.node.test.ts` read directly to confirm the corrected line falls inside the `CAP-01` block.
- **Committed in:** the docs commit carrying this corrected SUMMARY — a file cannot cite its own commit hash from inside itself; confirm via `git log -p -- .planning/phases/46-a-module-declares-its-reach-and-the-data-decides/46-06-SUMMARY.md`

**3. [Self-caught, advisor-prompted] Criterion 2's row proved only the negative half of "by name" and criterion 6's row under-cited the browser tier's positive assertions**
- **Found during:** the same advisor review.
- **Issue:** the roadmap's own criterion 2 text requires "both the declaration and the label in the refusal," but the first-draft row named only the ordering/refusal case, not the four `toContain` assertions (`node.peerId`/`w0`, the module CID, `'sovereign'`, `'network reach'`) that actually prove that half.
- **Fix:** both rows now quote the concrete assertions from `network-reach-guard.test.ts` and `fabric-node.node.test.ts`'s own bodies rather than naming the case title alone.
- **Files modified:** `.planning/phases/46-a-module-declares-its-reach-and-the-data-decides/46-06-SUMMARY.md`
- **Committed in:** the same docs commit as item 2

---

**Total deviations:** 0 from the plan's own scope; 3 post-review corrections to this plan's own SUMMARY/config-note prose, all found by re-checking claims already made rather than by new work outside the plan's task.
**Impact on plan:** No change to any test, guard, or production code — `vitest.config.ts`'s numeric values (`271`/`3924`/`188`/`3152`) are unchanged; only the notes explaining the delta and the SUMMARY's criteria-map citations were corrected.

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

**What was NOT done, explicitly:** No deploy, no Cloudflare resource, no release — out of scope per this plan's own scope fence. No `fetch`, no host import, no network access granted anywhere — out of this phase's scope per `46-CONTEXT.md` §7. **`requirements.mark-complete` for `CAP-01` was deliberately NOT run, and `.planning/REQUIREMENTS.md`'s CAP-01 row was NOT touched** — this plan's own scope fence states plainly "the orchestrator owns that after the phase is verified," and that instruction is followed literally rather than read as permission to run the command as part of a standard state-update step. `CAP-01` is complete in substance (see the criteria-to-test map above) but closes formally only when the orchestrator runs that step. No `gsd-sdk query state.*` **mutation** command was run against `.planning/STATE.md` — per the tooling hazard `46-01`'s Summary records (confirmed independently on two commands) and this plan's own scope fence ("Nothing rewrites `.planning/STATE.md`'s frontmatter") — only the body was hand-appended (one metrics row, one decision entry), and `git diff -- .planning/STATE.md` was inspected before staging: every changed line was a `+`, none a `-`, beyond the diff's own `+++`/`---` header pair — confirmed again after commit via `git show --stat 8175f85`, which reports `13 ++` for the file (13 real content insertions; an earlier count of this SUMMARY's own draft misread the diff's `+++` header line as a fourteenth insertion and is corrected here).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

CAP-01 is complete: a module's wish for network reach is a signed, optional field that survives the wire intact; a task whose module declares it, dispatched against sovereign data, is refused whole before instantiation on both production tiers; the refusal is proven distinguishable from every other refusal in the same composition chain and readable by the requestor; a mutation removing the check is caught automatically; and every claim above is now proven together, on one tree, by a full-lane sweep rather than file by file. What this phase explicitly left open — who may sign a declaration, whether a signer can be trusted to declare honestly, and the audience split once refusals consult node-held state — is the next phase's subject, named as such in `46-CONTEXT.md` §4 and §7 and in the roadmap's own "what this does not fix" paragraph. No blockers.

---
*Phase: 46-a-module-declares-its-reach-and-the-data-decides*
*Completed: 2026-09-23*

## Self-Check

- FOUND: vitest.config.ts (modified, confirmed via `git show --stat 583c9cb` and `git show --stat 39eefe7`)
- FOUND: 583c9cb (Task 1 commit — `git show --stat 583c9cb` confirms exactly one file, `vitest.config.ts`)
- FOUND: 39eefe7 (post-review fix commit — `git show --stat 39eefe7` confirms exactly one file, `vitest.config.ts`)
- FOUND: packages/core/src/naming.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/net/src/protocol.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/core/src/executor/network-reach-guard.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/node/src/fabric-node.node.test.ts (cited case titles and line-numbered assertions confirmed present via `grep -n` against the file)
- FOUND: packages/browser/src/network-reach-composition.browser.test.ts (cited case titles confirmed present via `grep -n` against the file)
- FOUND: packages/node/src/mutation-ledger.ts (NR1, NR2 entries confirmed present via `grep -n` and `sed -n`)

## Self-Check: PASSED
