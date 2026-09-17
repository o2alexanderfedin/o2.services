---
phase: 33-three-regions-and-a-relay-killed-on-purpose
plan: 05
subsystem: infra
tags: [cloudflare, durable-objects, libp2p, vitest, github-actions, funnel]

requires:
  - phase: 33-three-regions-and-a-relay-killed-on-purpose
    plan: 04
    provides: "location-claims.ts's rawLocationClaims() and the closed term/verb matcher, run
      here over this plan's own emitted table"

provides:
  - "region-loss-drill.e2e.test.ts — three local wrangler dev children, a floor, an identical
    synthetic population driven through arm A (all three up) and arm B (bootstrap-eu killed
    mid-run), with the loss read as a delta between the two arms rather than against an
    absolute threshold, plus a dialability arm proving three distinct PeerIds before the loss
    and two unchanged survivor PeerIds after it"
  - ".github/workflows/region-loss-drill.yml — schedule (weekly cron) + workflow_dispatch,
    spending nothing, uploading the drill's own two-arm table per run with
    if-no-files-found: error"
  - "region-loss-drill-schedule.node.test.ts — reads the workflow's trigger set, the parsed
    cron cadence, the workflow's OWN referenced spec path resolving on disk, and the absence
    of every spending pattern, independently of disclosure-gate.node.test.ts's own check"
  - "NET-15's ledger row moved from 'Not started' to 'Partial', naming precisely which half is
    built and which half waits on owner act 2"

affects: []

tech-stack:
  added: []
  patterns:
    - "Arm-aligned dial checks inside one test: a kill that must be observed from two angles
      (a funnel population and a libp2p dial) at the same two points in time cannot be split
      across separate it() blocks without assuming vitest's execution order carries state
      across them — so both angles live in one it(), with descriptive expect() messages
      standing in for what separate test titles would otherwise name for a plant"
    - "A workflow-guard's 'resolve' case must read the CITED path out of the workflow's own
      text, never compare the workflow against the guard's own hardcoded constant — the first
      draft of this file's resolve case did the latter and could never have caught a drifted
      citation; caught before commit by trying to plant it and watching a case that could not
      have gone red"

key-files:
  created:
    - packages/cloudflare/src/region-loss-drill.e2e.test.ts
    - .github/workflows/region-loss-drill.yml
    - packages/node/src/region-loss-drill-schedule.node.test.ts
  modified:
    - vitest.config.ts
    - .planning/REQUIREMENTS.md
    - packages/node/src/requirements-ledger.node.test.ts

key-decisions:
  - "Tasks 1 and 2 landed in one commit rather than two, because the plan's own design makes
    them one temporal flow: the dialability arm is arm-aligned with the funnel population and
    the kill inside a single run, and no tree state in which 'Task 1 only' passed ever
    existed during development. Fabricating one after the fact would be manufactured
    evidence, which this project's own conventions treat as the failure worse than a combined
    commit."
  - "The workflow's TMPDIR is pinned to runner.temp in the vitest step's own env, and the
    artifact-upload path uses the same expression, so the spec's own os.tmpdir() and the
    upload path agree by construction rather than by an assumption about what a GitHub-hosted
    runner leaves unset."
  - "The killed-region dial-failure check uses a manual try/catch and a boolean assertion
    rather than expect(...).rejects.toThrow() — vitest's pretty-printer cannot format a
    resolved libp2p Connection's component internals, so a resolved promise (the exact
    failure the plant produced) turned a clean assertion failure into an opaque
    PrettyFormatPluginError. Found by actually running the plant before deciding the shape
    was final."
  - "NET-15's ledger row was moved to Partial by hand, never through
    requirements.mark-complete — its own checkbox text ('takes the hosted relay out') names
    an act against a deployed relay, and no region has been created. Left unmarked, matching
    HOST-06's standing precedent in this same phase."
  - "REREAD_REGISTER_CEILING raised 7 -> 8 to admit NET-15, which the file's own docblock had
    already named as a boundary case (\"a fourth raise of the same shape\"). Answered rather
    than deferred: the register split the docblock proposes is out of this plan's scope
    (requirements-ledger.node.test.ts is not in this plan's files_modified), and the dated
    note says so and names it for whoever raises the ceiling a fifth time."

requirements-completed: []  # NET-15 deliberately NOT marked [x] — see "Requirements Ledger"
  # section below. Moved to Partial in the ledger table only.

duration: ~3h
completed: 2026-09-14
---

# Phase 33 Plan 05: A Scheduled, Repeated Region-Loss Drill Summary

**A local three-object drill that kills one region mid-run and reports the loss as a delta between two arms of one run — bounded by a fixed literal, not a threshold — now firing on a weekly `schedule:` plus `workflow_dispatch:`, guarded by a spec that reads the trigger set, the cron cadence and the workflow's own citation rather than trusting its prose.**

## Performance

- **Duration:** ~3h
- **Tasks:** 3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- `packages/cloudflare/src/region-loss-drill.e2e.test.ts` boots `bootstrap-us`/`-eu`/`-sam` as
  three local `wrangler dev` children on 8831/8832/8833 (re-verified free by grep at write
  time), takes a six-stage, three-region floor, then drives a 12-report synthetic population
  one-third per region through arm A (all three answering) and arm B (`bootstrap-eu`
  `SIGTERM`'d between the arms, polled down by transport refusal). Four comparative
  assertions carry the reading: the killed region's own arm-A share pinned at the literal `4`;
  each survivor's `entered['wss-bootstrap']` delta identical across both arms; the survivors'
  summed `stalled` re-reports equal to the killed region's share (arithmetic, stated as such
  in the file's own header rather than claimed as a measurement); and `wss-bootstrap` named,
  by iterating all six `FUNNEL_STAGES`, as the only stage whose `stalledAt` moved. The same run
  also dials all three objects before the kill (three distinct PeerIds) and the killed region
  plus both survivors after it (the killed dial fails within a bounded timeout; both survivors
  return the identical PeerIds they returned in arm A) — a degradation, not a partition.
- The emitted two-arm table is written to a fixed path under the OS temp directory, printed to
  stdout, and checked against plan 33-04's `rawLocationClaims` with zero findings of either
  rule before the test can pass — no by-eye branch.
- `.github/workflows/region-loss-drill.yml` carries `schedule: cron '0 6 * * 1'` plus
  `workflow_dispatch:`, one job on `ubuntu-latest`, and uploads the drill's table with
  `if-no-files-found: error`. Its header cites `disclosure-gate.node.test.ts:425-427`'s
  spending-workflow definition by file and line and reproduces neither the regex nor the
  literal it matches — verified programmatically (`deploys()` run against the file's own text
  returns `false`) rather than merely written carefully.
- `packages/node/src/region-loss-drill-schedule.node.test.ts` (12 cases) reads the trigger
  block, the parsed five-field cron (day-of-month `*`, day-of-week exactly one digit), the
  workflow's own `run:` step extracted and confirmed to resolve on disk, and an independent
  re-implementation of the spending-workflow regex — deliberately not imported, so either
  guard alone is a single point.
- `vitest.config.ts`: `files` 265→266, `tests` 3838→3850, `unitFiles` 182→183, `unitTests`
  3074→3086, all re-derived from real runs.
- `.planning/REQUIREMENTS.md`: NET-15's ledger row moved from "Not started" to "Partial",
  naming precisely which half this plan closes and which remains `waits on owner act 2`.

## Task Commits

1. **Tasks 1+2 (combined — see Decisions Made): the three-object arrangement, the kill, and the two-arm comparative reading, plus the dialability arm** - `d01bacb` (test)
2. **Task 3: a weekly schedule and a guard that reads it rather than trusting it** - `37c5e0d` (feat)
3. **Ledger housekeeping: NET-15 moves to Partial, and the re-read register follows** - `34d5543` (docs)

## Files Created/Modified

- `packages/cloudflare/src/region-loss-drill.e2e.test.ts` — created: the drill itself
- `.github/workflows/region-loss-drill.yml` — created: the schedule
- `packages/node/src/region-loss-drill-schedule.node.test.ts` — created: the schedule's guard
- `vitest.config.ts` — counts re-derived (see above)
- `.planning/REQUIREMENTS.md` — NET-15's ledger row updated to Partial
- `packages/node/src/requirements-ledger.node.test.ts` — NET-15 added to `REREAD_REGISTER`,
  `REREAD_REGISTER_CEILING` 7→8

## Decisions Made

- **Tasks 1 and 2 in one commit.** See key-decisions above — the plan's own design (dial
  checks arm-aligned with the funnel population and the kill) makes the two tasks one
  temporal flow inside a single `it()`, and no intermediate "Task 1 only" tree state was ever
  run. Consulted before deciding rather than assumed.
- **TMPDIR pinned in the workflow, not merely hoped to match.** `${{ runner.temp }}` is set
  both as the vitest step's `TMPDIR` env var and as the upload step's `path:`, so the spec's
  own `os.tmpdir()` and the artifact path are the same value by construction.
- **A manual try/catch over `.rejects.toThrow()` for the killed-region dial check** — see
  key-decisions above and the Plant Proofs section below for the observed crash that drove
  this.
- **NET-15 left unmarked**, moved to Partial in the ledger table only — see Requirements
  Ledger section.
- **`REREAD_REGISTER_CEILING` raised 7→8** with a dated note that answers, rather than defers
  a second time, the file's own "fourth raise of the same shape" question — see key-decisions
  above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The schedule guard's own "resolve" case checked a hardcoded constant, not the workflow's citation**
- **Found during:** Task 3, before committing — caught by trying to run the case's own named plant and finding it could not have gone red.
- **Issue:** The first draft of `region-loss-drill-schedule.node.test.ts` asserted `existsSync(join(ROOT, SPEC_PATH))` where `SPEC_PATH` is the guard's own hardcoded string. This checks that a literal the test itself wrote resolves on disk — which is always true regardless of what the workflow file actually names — so a drifted citation in the real workflow could never be caught.
- **Fix:** Added `referencedSpecPath(source)`, which extracts the path from the workflow's own `vitest run --project e2e <path>` invocation by regex, and changed the resolve assertion to check that EXTRACTED value. Re-ran the plant (mutate the workflow's `run:` line by one character): the resolve case now reddens with `AssertionError: packages/cloudflare/src/region-loss-drilll.e2e.test.ts does not resolve on disk`.
- **Files modified:** `packages/node/src/region-loss-drill-schedule.node.test.ts` (found and fixed within the same task that created it — no separate "before" state exists in the tree)
- **Verification:** `npx vitest run --project node packages/node/src/region-loss-drill-schedule.node.test.ts` — 12/12; both plants (below) reddened exactly the cases named for them.
- **Committed in:** `37c5e0d` (Task 3 commit)

**2. [Rule 1 - Bug] `.rejects.toThrow()` produced an illegible crash instead of a clean assertion failure**
- **Found during:** Task 2's own plant (dial a survivor's address instead of the killed region's)
- **Issue:** `expect(promise, message).rejects.toThrow()` needs to format the resolved value when the promise does NOT reject (which is exactly what the plant produces), and vitest's pretty-printer threw `PrettyFormatPluginError: $$typeof not set` trying to format a resolved libp2p `Connection`'s component internals — the test still failed (`EXIT=1`, 1 failed) but with no legible message.
- **Fix:** Replaced with a manual `try/catch` setting a boolean, asserted with a plain `.toBe(true)` and a descriptive message — the same shape already used in `driveArmB` for the analogous transport-failure check.
- **Files modified:** `packages/cloudflare/src/region-loss-drill.e2e.test.ts`
- **Verification:** Re-ran the identical plant after the refactor: `AssertionError: bootstrap-eu's dial must fail within a bounded timeout after the kill: expected false to be true` — clean and specific.
- **Committed in:** `d01bacb` (Tasks 1+2 commit)

**3. [Rule 1 - Bug, caught by the mandated post-call diff] `roadmap.update-plan-progress` flipped Phase 33's own checkbox to `[x]` on plan-count grounds, which is false against the phase's own criteria**
- **Found during:** the state_updates workflow step, reading `git diff --stat -- .planning/ROADMAP.md` immediately after the call, per this phase's own inherited instruction to check every `roadmap.*`/`requirements.*` call rather than trust its return value.
- **Issue:** `gsd-sdk query roadmap.update-plan-progress 33` reported `{"complete": true}` and rewrote `- [ ] **Phase 33: ...**` to `- [x] **Phase 33: ...**` because all five plans now have a SUMMARY file. The checkbox's own text reads present tense — "`bootstrap-us`/`-eu`/`-sam` **exist**" — and this is the same false-present-tense claim `HOST-06`'s row has been refused three waves running for the identical underlying fact: no object has been created. Phase 32's own checkbox, two lines above, is held `[ ]` on criteria grounds despite comparable completion, which is this ROADMAP's own established convention — a phase checkbox reflects the success criteria being TRUE, not the plan count matching the summary count. The tool's predicate is the latter.
- **Fix:** `git checkout -- .planning/ROADMAP.md` (the narrow, sanctioned use of that command on this phase's own uncommitted, unpushed, tool-produced edit — the same precedent `deferred-items.md` already records for the `state.advance-plan` recovery). Replaced with a hand-written "Status 2026-09-14" closing paragraph, on Phase 32's own shape: names what each criterion's built half is and what its owner-gated half is, and states plainly that all four checkboxes (the phase line and the three requirement rows) stay off the same one act. Checked against plan 33-04's `rawLocationClaims` before committing: zero findings.
- **Files modified:** `.planning/ROADMAP.md`
- **Verification:** `git diff -- .planning/ROADMAP.md` after the revert-and-rewrite shows only the hand-written paragraph, not the checkbox flip; the phase-line checkbox reads `[ ]`, unchanged from before this plan.
- **Not committed via `gsd-sdk query commit`** — the final metadata commit below uses a bare `git commit` with explicit paths instead, since this is the second time in this phase a `gsd-sdk` `.planning/*`-touching command has needed a manual recovery.

**4. [Rule 3 - Blocking] `REREAD_REGISTER_CEILING` was at capacity (7 of 7) before this plan's ledger edit**
- **Found during:** the ledger commit's own pre-commit guard sweep
- **Issue:** `requirements-ledger.node.test.ts` requires every `Partial`/`Built, not wired` row to either be machine-readable or registered in `REREAD_REGISTER`, which is capped. NET-15 moving to `Partial` with no exported symbol for the file to read required a new entry, and the register already held 7 of 7.
- **Fix:** Raised the ceiling to 8 with a dated note, per the mechanism this same file's own history already uses (`ORPHAN_MODULE_CEILING`'s precedent in wave 4, `MEASURED_NODE_SPANS`'s in every wave). Addressed rather than ignored the file's own flagged concern about a fourth raise — see key-decisions above.
- **Files modified:** `packages/node/src/requirements-ledger.node.test.ts`
- **Verification:** `npx vitest run --project node packages/node/src/requirements-ledger.node.test.ts` — 27/27.
- **Committed in:** `34d5543` (ledger commit)

---

**Total deviations:** 4 auto-fixed (3 Rule 1, 1 Rule 3), all discovered via this plan's own verification, plant and post-tool-call diff procedures, none narrowing a criterion or weakening a guard.
**Impact on plan:** No scope creep. Deviation 1 made a guard actually test the thing it claimed to; deviation 2 is a readability fix to the exact case a required plant exercises; deviation 3 caught and reverted a tooling-produced false claim before it reached a commit; deviation 4 is the standard raise-with-dated-note mechanism this repository already uses repeatedly, applied to unblock a required ledger edit.

## Issues Encountered

**A whole-`node`-project sweep to derive `vitest.config.ts`'s counts surfaced one unrelated failure on an extremely oversubscribed host.** `npx vitest run --project node` reported `closed-fabric-agents.node.test.ts` timing out waiting for a relay reservation, on a run whose own banner read load/core 26.25 against a 4.00 ceiling. Re-run alone, on the same still-oversubscribed host (load/core 21.61-24.53): 7/7 passed. Attributed by isolated re-run rather than by plausibility, per `CLAUDE.md` § Measurement. Not investigated further — it names nothing this plan created or modified.

**The host stayed heavily oversubscribed for this entire session** (load/core readings from ~9 up to ~26 against an 8-core, 4.00-ceiling host, throughout). Every duration in this SUMMARY that is not explicitly marked otherwise is either a count (load-independent) or read off a run whose own `[host conditions]` banner called the host quiet at the moment that specific file ran alone (the e2e drill and the schedule guard were both run in isolation on quiet readings, ~0.9-1.5 load/core, separately from the full-sweep counts).

## Plant Proofs

**Task 1 — assertion 3's blind-instrument check.**
- Snapshot: `cp region-loss-drill.e2e.test.ts` to a scratchpad path immediately before planting.
- Plant: in `driveArmB`, removed the redirect-to-survivor `stalled` re-report for the killed region's failed sends, leaving them silently dropped.
- Observed, exactly the case named in advance and no other: `AssertionError: assertion 3: the survivors must together absorb exactly the killed region's own share of the population as stalled re-reports — a run that dropped them silently would fail here: expected +0 to be 4`. 1 test file, 1 failed (the file has one test, so "1 failed" is the whole file; the assertion message pinpoints the exact clause).
- Restoration: reversed exactly the removed block. `cmp` against the pre-plant snapshot: byte-identical. Re-run: `EXIT=0`, 1/1 passed.

**Task 2 — the dial-fails case, in two attempts (see Deviation 2 for why there were two).**
- Snapshot: `cp region-loss-drill.e2e.test.ts` to a second scratchpad path, taken after the first plant's restore was already `cmp`-verified.
- Plant: pointed the killed-region dial (post-kill) at the redirect survivor's own address and PeerId instead.
- First attempt (before the try/catch refactor): `EXIT=1`, the test failed, but vitest's own `PrettyFormatPluginError: $$typeof not set` replaced the assertion's message — a real but illegible red, recorded rather than discarded (it is the reason the code has the shape it now has).
- Refactored to a manual try/catch, re-ran clean (`EXIT=0`) to confirm the refactor changed no behavior, took a fresh snapshot, and re-applied the identical plant.
- Second attempt, observed exactly as named in advance: `AssertionError: bootstrap-eu's dial must fail within a bounded timeout after the kill: expected false to be true`.
- Restoration: reversed exactly the one line. `cmp` against the pre-plant (post-refactor) snapshot: byte-identical. Re-run: `EXIT=0`, 1/1 passed.

**Task 3, plant 1 — the schedule case, isolated from a parse case.**
- Snapshot: `cp .github/workflows/region-loss-drill.yml` to a scratchpad path.
- Plant: deleted the `schedule:` key, leaving its `- cron: '0 6 * * 1'` line orphaned under `on:`.
- Observed, exactly the case named in advance: `carries schedule: in its trigger block` reddened — `AssertionError: expected '    - cron: ...\n  workflow…' to contain 'schedule:'` — 11 of 12 cases stayed green, including the "parses a real, non-trivial on: block" case, confirming this is the schedule case and not a parse case.
- Restoration: reversed the one line. `cmp` against the pre-plant snapshot: byte-identical. Re-run: 12/12.

**Task 3, plant 2 — the resolve case, after the fix in Deviation 1.**
- Snapshot: `cp .github/workflows/region-loss-drill.yml` to a second scratchpad path.
- Plant: changed the `run:` step's spec path by one character (`region-loss-drill` → `region-loss-drilll`).
- Observed, exactly the case named in advance: `reads the workflow's OWN run: step and confirms that path RESOLVES on disk` reddened — `AssertionError: packages/cloudflare/src/region-loss-drilll.e2e.test.ts does not resolve on disk: expected false to be true`. A second, related case (`invokes the e2e lane by project...`, which also compares the extracted path against the constant) reddened too — expected, since both read the same mutated substring, and the plan's own wording only required the resolve case to redden, not that it redden alone.
- Restoration: reversed the one character. `cmp` against the pre-plant snapshot: byte-identical. Re-run: 12/12.

No plant stayed green when it was supposed to redden, and no plant reddened a case other than the one(s) named for it in advance.

## User Setup Required

None — no external service configuration required. Every task in this plan is `agent-now`.
The workflow's first real firing — either its first Monday 06:00 UTC `schedule:` trigger or a
manual `workflow_dispatch:` — is a real GitHub Actions event this session cannot produce or
observe; whether `runner.temp`'s path assumption actually holds on a hosted runner is
therefore genuinely unmeasured here, though the `if-no-files-found: error` backstop means a
wrong assumption fails the run loudly rather than passing quietly.

## Requirements Ledger — NET-15 moved to Partial, deliberately not marked Done

`NET-15`'s checkbox text (`.planning/REQUIREMENTS.md:1528`) reads, present tense: *"A
**scheduled, repeated** relay-kill drill takes the hosted relay out and reports bounded,
measured degradation rather than a silent outage."* "Takes the hosted relay out" names an act
against a relay that is deployed. No region has been created by this phase (`HOST-06` stays
unmarked in this same table, for the identical underlying fact — `.planning/OWNER-ACTIONS.md`
row 2's first `get()` has not happened), so that clause is not yet true and the checkbox stays
`[ ]`.

What IS true, and what the ledger table row (line 2207) now states: the ledger row's own prior
sentence — *"Not started — no drill is scheduled"* — became false the moment Task 3 landed, so
leaving it stand would have been a stale claim in the opposite direction this project's own
memory (`i-under-state-o2s-capabilities`) warns against. The row was rewritten to `Partial`,
naming precisely what closes (the schedule, the guard, the local two-arm comparative reading,
the local dialability observation) and what remains `waits on owner act 2` (criterion 3's live
reading against three sited objects, criterion 4's cross-region dialability on the real
fabric) — the same shape `AOT-03`'s row already carries in this table.

## Next Phase Readiness

- The drill and its schedule are complete and green. Whoever performs owner act 2 (creating
  the three regions) can, in the same act, extend this drill's arrangement to the deployed
  objects — the local arrangement's helper shapes (`readSelf`, `readFunnel`, `report`,
  `dialer`, `workerAddress`) are already written against the same `/self`/`/funnel` surface
  the deployed objects serve, so a deployed-object variant is a configuration change (real
  hostnames, no `--persist-to`) rather than a rewrite.
- `REREAD_REGISTER_CEILING` sits at 8, one below where the file's own docblock suggests
  reconsidering whether `experiment-not-run` should carry a separate count. The next plan
  raising it should read that note before adding a ninth entry.
- `.planning/STATE.md` was not touched, per this phase's own standing instruction and the
  measured `state.*` tooling defect prior waves recorded.
- This is the fifth and final plan of Phase 33. `HOST-06` and criterion 3/4's live halves
  remain the phase's only unclosed threads, and all are explicitly owner-gated by this
  phase's own design (`.planning/OWNER-ACTIONS.md` row 2).

---
*Phase: 33-three-regions-and-a-relay-killed-on-purpose*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: `packages/cloudflare/src/region-loss-drill.e2e.test.ts`
- FOUND: `.github/workflows/region-loss-drill.yml`
- FOUND: `packages/node/src/region-loss-drill-schedule.node.test.ts`
- FOUND: `vitest.config.ts`
- FOUND: `.planning/REQUIREMENTS.md`
- FOUND: `packages/node/src/requirements-ledger.node.test.ts`
- FOUND commit: `d01bacb` (Tasks 1+2)
- FOUND commit: `37c5e0d` (Task 3)
- FOUND commit: `34d5543` (ledger housekeeping)
