---
phase: 46-a-module-declares-its-reach-and-the-data-decides
plan: 05
subsystem: executor
tags: [executor, guard, sovereignty, provenance, network-reach, browser, wasm]

# Dependency graph
requires:
  - phase: 46-a-module-declares-its-reach-and-the-data-decides
    provides: "guardNetworkReach, NetworkReachRefusal, describeNetworkReachRefusal (plan 03); the mutation-ledger entries NR1/NR2 (plan 04)"
provides:
  - "guardNetworkReach composed into both production node factories, byte-identical: guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty) at fabric-node.ts:2934 and browser-node.ts:2540"
  - "packages/core/src/index.ts barrel-exports guardNetworkReach, NetworkReachRefusal, describeNetworkReachRefusal"
  - "fabric-node.node.test.ts's CAP-01 block: the refusal proven over real RPC via RemoteExecutor, the two accepted controls proven through node.executor directly"
  - "network-reach-composition.browser.test.ts: a real BrowserNode's CAP-01 refusal and both controls, all three read through node.executor directly, first browser-project file to combine a real BrowserNode with a real Worker execution"
affects: [46-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A single-byte sovereign-input fixture (0x80) is unsafe to reuse outside the WASI-echo test it was chosen for: 0x80 is both the DAG-CBOR empty-array header and the middle byte of an em dash's UTF-8 encoding, so it can false-positive-match the egress tap against a refusal's own prose rather than against anything executed. Choose a multi-byte, non-CBOR-header value for any new sovereign-input fixture that is not deliberately testing the echo collision."

key-files:
  created:
    - "packages/browser/src/network-reach-composition.browser.test.ts"
  modified:
    - "packages/node/src/fabric-node.ts"
    - "packages/browser/src/browser-node.ts"
    - "packages/core/src/index.ts"
    - "packages/node/src/fabric-node.node.test.ts"
    - "packages/node/src/reachability-guard.node.test.ts"
    - "packages/node/src/reachability-dispositions.ts"

key-decisions:
  - "ORPHAN_MODULE_CEILING lowered 36 -> 35 in the same commit that wires guardNetworkReach in, closing the condition 46-03 recorded when it raised the ceiling — per this plan's inherited obligation 1."
  - "reachability-dispositions.ts gained a HIDDEN_BY_DISPATCH entry for core/describeNetworkReachRefusal, mirroring core/describeModuleRefusal's identical port-member-dispatch shape — a WIRE-02 test failure this plan's own wiring caused (the helper became reachable through guardNetworkReach's own execute member with no call expression naming it) and fixed in the same commit. This file was NOT in the plan's stated files_modified; see Deviations."
  - "The CAP-01 refusal fixture's inputCid uses [0x11, 0x22, 0x33, 0x44], not the [0x80] the DATA-09 block above it uses — see Deviations for the measured collision that forced this."
  - "Both node-tier and browser-tier test blocks start a fresh node per it() rather than sharing one via beforeAll, because this file's module-level afterEach stops every node in the shared running array after every test."

patterns-established: []

requirements-completed: []  # CAP-01 is NOT fully complete by this plan alone — 46-06's full-lane sweep and criteria-to-test accounting remain. requirements.mark-complete was NOT run, matching every prior plan in this phase.

# Metrics
duration: ~35min
completed: 2026-09-23
---

# Phase 46 Plan 05: A module declares its reach — wired into both node factories Summary

**`guardNetworkReach` now runs in production on both tiers — `guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty)` at `fabric-node.ts:2934` and `browser-node.ts:2540`, byte-identical — proven not by the matching text but by a real `FabricNode` refusing a declared module over real RPC and a real `BrowserNode` refusing the identical shape through a real Worker, with both tiers' positive and negative controls passing at full strength.**

## Performance

- **Duration:** ~35 min (three task commits between 13:58:20 and 14:05:47, plus earlier plan/context reading and a mid-Task-2 detour chasing a real egress-tap collision)
- **Completed:** 2026-09-23
- **Tasks:** 3 planned, 3 completed
- **Files modified:** 7 (1 created, 6 modified — two modifications outside the plan's stated `files_modified`; see Deviations)

## Accomplishments

- Both `fabric-node.ts` and `browser-node.ts` compose `guardNetworkReach` at their existing site, wrapping `provenance(abi)` rather than replacing it so M27/M28's `find` text (`provenance(abi)`) stays present exactly once in each file. `packages/core/src/index.ts` barrel-exports `guardNetworkReach`, `NetworkReachRefusal`, `describeNetworkReachRefusal`.
- `ORPHAN_MODULE_CEILING` returned 36 → 35 in the same commit, closing 46-03's own recorded closing condition.
- `fabric-node.node.test.ts` gained a `CAP-01` describe block: case 1 (the refusal) goes over real RPC through `RemoteExecutor` against a cleared, pinned `FabricNode`, with the reason readable at the wire boundary and explicitly discriminated from `guardSovereignty`'s own `'sovereignty violation'` text; cases 2 and 3 (the positive control and the non-declaring control) go through `node.executor.execute` directly, sidestepping DATA-06's egress tap per the DATA-09 block's own established pattern.
- `network-reach-composition.browser.test.ts` (new file) proves the identical property against a real, production-constructed `BrowserNode` — real `IndexedDB`, real Worker via `TaskExecutorWorker`, `PROBE_EMITS_TEN` actually compiled and run (`output: 10`) — the first browser-project file to combine a real node with a real Worker dispatch. All three cases run at full strength (`ok: true`/`ok: false` asserted outright, not the documented fallback), confirmed with a temporary debug print before committing, not assumed.
- Two live RED plants watched and restored (flipping `guardNetworkReach`'s `wantsNetworkReach === true` to `!== true`), one on the Node tier and one across all three browser engines (chromium, webkit, firefox) — see TDD Gate Compliance below.

## Task Commits

Each task was committed atomically, with explicit paths:

1. **Task 1: compose guardNetworkReach into both node factories, and export it** - `17b4f21` (feat) — touches `fabric-node.ts`, `browser-node.ts`, `core/src/index.ts`, `reachability-guard.node.test.ts`, AND `reachability-dispositions.ts` (the last is outside this plan's stated `files_modified`; see Deviations)
2. **Task 2: fabric-node.node.test.ts — the requestor's view for the refusal, node.executor for the controls** - `bd9e82f` (test)
3. **Task 3: a real BrowserNode — the operator's view** - `4d0e099` (test)

## Files Created/Modified

- `packages/node/src/fabric-node.ts` - `guardNetworkReach` added to the `@o2/core` import list; composition line wraps `provenance(abi)` inside `guardNetworkReach`; composition comment extended naming the third layer
- `packages/browser/src/browser-node.ts` - identical edit, own file's voice for the extended comment
- `packages/core/src/index.ts` - new export block for `describeNetworkReachRefusal`/`guardNetworkReach`/`NetworkReachRefusal`, CAP-01-labelled
- `packages/node/src/reachability-guard.node.test.ts` - `ORPHAN_MODULE_CEILING` 36 → 35, with a dated closing-condition entry
- `packages/node/src/reachability-dispositions.ts` - new `HIDDEN_BY_DISPATCH` entry for `core/describeNetworkReachRefusal` (outside stated scope; see Deviations)
- `packages/node/src/fabric-node.node.test.ts` - new `CAP-01` describe block, three cases, a `fixture()` helper, and a corrected fixture byte value (see Deviations)
- `packages/browser/src/network-reach-composition.browser.test.ts` (created) - new `CAP-01` describe block against a real `BrowserNode`, three cases

## Decisions Made

- Lowered `ORPHAN_MODULE_CEILING` in the wiring commit itself rather than a separate one, so the ceiling and the wiring that closes its condition land atomically.
- Added the `HIDDEN_BY_DISPATCH` entry for `describeNetworkReachRefusal` rather than adding a call expression anywhere that would name it directly — following `describeModuleRefusal`'s own precedent exactly, since both are called from inside an `Executor` port's own `execute` member with no call expression in the tree naming them.
- Chose a four-byte input fixture (`[0x11, 0x22, 0x33, 0x44]`) for the Node-tier CAP-01 block rather than the `[0x80]` used elsewhere in the same file — a measured collision, not a style preference; see Deviations.
- Started a fresh node per `it()` in both new test blocks rather than sharing one node across cases, because this file's (and the browser file's own, matching) `afterEach` stops every node in a shared array after every test — sharing would have left cases 2 and 3 dispatching against an already-stopped node.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/node/src/reachability-dispositions.ts` touched outside this plan's stated `files_modified`, to fix a WIRE-02 failure this plan's own wiring caused**

- **Found during:** Task 1's verification, running `reachability-guard.node.test.ts` after the composition edit.
- **Why this is directly caused by this task's own change:** before Task 1's edit, `describeNetworkReachRefusal` had no production caller anywhere and was not yet a reachable barrel export question at all (it was still inside the orphan module `network-reach-guard.ts`, covered by obligation 1's `ORPHAN_MODULE_CEILING` entry instead). Wiring `guardNetworkReach` into both factories gave `network-reach-guard.ts` a production importer, which made `describeNetworkReachRefusal` — called only from inside the object literal `guardNetworkReach` returns, at its own `execute` member, with no call expression anywhere in the tree naming it — a newly-reachable-but-undisposed callable barrel export. `WIRE-02`'s two-direction register check failed with exactly this key: `core/describeNetworkReachRefusal` reported by the walk, present in neither `DISPOSITIONS` nor `OPEN_FINDINGS`.
- **Fix:** added a `HIDDEN_BY_DISPATCH` entry mirroring `core/describeModuleRefusal`'s own row exactly in shape (`cause: 'port-member-dispatch'`, `through: '...network-reach-guard.ts#execute'`, `composedAt` naming both factories' line numbers and the `guardNetworkReach(provenance(abi))` call). This is the identical mechanism the existing `describeModuleRefusal` row already documents for the same reason, applied to the sibling guard this plan wires in.
- **Alternatives considered and rejected:** adding a call expression that names `describeNetworkReachRefusal` directly somewhere in production would resolve the finding differently but is not what the code does — `guardModuleProvenance`'s own equivalent function is called the identical indirect way, and rewriting the mechanism just to satisfy the census would be optimizing for the instrument rather than describing the tree honestly.
- **Files modified:** `packages/node/src/reachability-dispositions.ts` (one new entry, ~12 lines)
- **Verification:** `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts` → `EXIT=0`, 35/35 (was `EXIT=1`, 2 failed, before the fix); `npx tsc --noEmit -p .` → `EXIT=0`.
- **Committed in:** `17b4f21` (same commit as Task 1's wiring, so the disposition and the wiring that requires it land as one atomic change)

**2. [Rule 1 - Bug, discovered via TDD's own required RED/GREEN cycle] The `CAP-01` node-tier refusal fixture's original input byte, `[0x80]`, collided with the egress tap and rewrote the refusal's own reply before it reached the RPC boundary**

- **Found during:** Task 2, first run of the new `CAP-01` describe block against real infrastructure (not a plant — this was the first GREEN attempt).
- **Issue:** The fixture initially reused `[0x80]` for `inputCid`'s content, matching the DATA-09 block directly above it in the same file — but that block's own comment explains `0x80` was chosen *because* it collides with `wasi-echo`'s literal output, a deliberate true-positive test of the egress tap. Case 1 here does not run a WASI-echo module and expects the tap to have nothing to act on (nothing executes on a refusal). It failed instead with the RPC reply rewritten to `egress refused: <inputCid> on <peerId>` — the refusal's own reason string, not any output, tripped the tap.
- **Root cause, measured:** `takeSovereignHold` registers a sovereign task's `inputCid` bytes *before* the executor runs, refused or not. `EgressGuard.violationIn` does a contiguous-byte scan of the candidate reply for those exact bytes. `describeNetworkReachRefusal`'s own prose (plan 03, already committed) contains an em dash; an em dash's UTF-8 encoding is `E2 80 94`, whose middle byte is `0x80` — the exact byte registered. So any reply containing that punctuation mark anywhere collided with a one-byte registered payload, independent of whether anything executed.
- **Fix:** changed the fixture's `inputCid` content to `[0x11, 0x22, 0x33, 0x44]`, a four-byte value chosen to avoid both a common DAG-CBOR structural byte and any plausible UTF-8 continuation byte. `network-reach-guard.ts`'s own prose (out of this plan's `files_modified`) was left untouched.
- **Files modified:** `packages/node/src/fabric-node.node.test.ts` (the one file already in scope for this task)
- **Verification:** re-ran `npx vitest run --project node packages/node/src/fabric-node.node.test.ts` → `EXIT=0`, 18/18, including all three new `CAP-01` cases.
- **Committed in:** `bd9e82f` (Task 2's own commit — the fix landed inside the task it was found in, never as a separate commit)

---

**Total deviations:** 2 (1 Rule 3 blocking, 1 Rule 1 bug found via the required GREEN run). Both are directly caused by this plan's own wiring and fixture choices, not pre-existing or unrelated. No scope creep beyond what each fix required.
**Impact on plan:** `git show --stat` across the three commits lists 7 files total, not the plan's stated 5 — `reachability-dispositions.ts` (Deviation 1) and the already-obligated `reachability-guard.node.test.ts` (from this plan's prompt-level obligation 1, not the plan frontmatter) account for the difference. No file outside what either obligation or deviation required was touched.

## TDD Gate Compliance

Tasks 2 and 3 are `tdd="true"`. Both were watched live RED before being declared GREEN, on the actual behavior each block's own `<behavior>` claims:

- **Task 2 (Node tier):** flipped `guardNetworkReach`'s `task.moduleRecord?.wantsNetworkReach === true` to `!== true` in `network-reach-guard.ts`. Observed: `EXIT=1`, 2 failed / 16 passed. The two cases that reddened — case 1 (the refusal) and case 3 (the non-declaring control) — are exactly the two that construct a `moduleRecord` and depend on this comparison's polarity; case 2 (public label, insensitive to sovereignty-gated logic entirely) stayed green, as expected. Restored by removing exactly the inserted `!`, `cmp` against a pre-plant snapshot → exit 0 (byte-identical), re-ran → `EXIT=0`, 18/18.
- **Task 3 (browser tier):** identical plant, run against all three browser engines. Observed: `EXIT=1`, 6 of 9 failed (case 1 and case 3 on chromium, webkit, and firefox each), case 2 stayed green on all three. Restored the same way, `cmp` → exit 0, re-ran → `EXIT=0`, 9/9.

Both plants targeted the guard's one live `if` condition directly — the same discipline plan 03's own RED plants used — not a write downstream of an early return.

## Verification Performed (actual output, not asserted)

- `grep -c "guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty)" packages/node/src/fabric-node.ts packages/browser/src/browser-node.ts` → `1` each
- `grep -c "provenance(abi)" packages/node/src/fabric-node.ts packages/browser/src/browser-node.ts` → `1` each (M27/M28's `find` text stays well-defined)
- `npx tsc --noEmit -p .` → `EXIT=0` (run after every task's edits, six times total across the plan)
- `npx vitest run --project node packages/node/src/mutation-guard.node.test.ts` → `EXIT=0`, 189/189 (confirms M27/M28 and every other ledger entry still describe real source, run three times)
- `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts` → `EXIT=0`, 35/35 at the restored ceiling of 35
- `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` → `EXIT=0`, 26/26 (run three times, once per task, against every file this plan touched)
- `npx vitest run --project node packages/node/src/fabric-node.node.test.ts` → `EXIT=0`, 18/18, the three new `CAP-01` case titles present in the run's output; case 1's assertions include the `.not.toContain('sovereignty violation')` discrimination
- `npx vitest run --project browser packages/browser/src/network-reach-composition.browser.test.ts` → `EXIT=0`, 9/9 across chromium, webkit, firefox; case 1's assertions are the full non-fallback set on all three engines; cases 2 and 3 confirmed at full strength (`ok: true`, `output: 10`) via a temporary debug print, removed and `cmp`-verified before committing
- Two live RED plants watched and restored per TDD Gate Compliance above, each `cmp`-verified byte-identical after restore
- `git show --stat` on all three commits confirmed the exact file lists reported in Files Created/Modified above
- Pre-commit hook's cheap-guard suite (vocabulary, purity, mutation-ledger, disclosure, ledgers, reachability, traceability, state) ran on all three commits — 405/405 passed each time

**What was NOT done, explicitly:** No `fetch`, no host import, no network access granted to anything — out of this phase's scope per `46-CONTEXT.md` §7. No decision about who may sign a declaration. No deploy, no Cloudflare resource, no release. `.planning/STATE.md`'s frontmatter was not touched by any `gsd-sdk query state.*` mutation command, per this session's own tooling-hazard warning — only this SUMMARY and the plan's own scoped files were written. `requirements.mark-complete` was **not** run for `CAP-01` — this plan wires the guard in and proves it on both tiers, but `46-06-PLAN.md`'s full-lane sweep (the complete `node`-project suite run together, `vitest.config.ts`'s `tests`/`unitTests` counts, and the criteria-to-test accounting for all six roadmap success criteria) has not yet run. The full project-wide vitest suite across all five projects was **not** run in this plan — only the named files this plan's own `<verification>` block specifies, per the same reasoning 46-03's Summary gives for deferring the full-lane sweep to 46-06.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Both production node factories now enforce CAP-01 identically, proven through real dispatches on both tiers rather than through matching text alone — closing the gap `M28`'s own precedent (quoted in this plan's objective) says an isolated unit test and a textual match cannot close on their own. `46-06-PLAN.md` can now run the full `node`-project suite with every edit from plans 01 through 05 landed together, complete `vitest.config.ts`'s `tests`/`unitTests` derivation, and record the criteria-to-test accounting that closes `CAP-01` as a whole. No blockers.

---
*Phase: 46-a-module-declares-its-reach-and-the-data-decides*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/node/src/fabric-node.ts
- FOUND: packages/browser/src/browser-node.ts
- FOUND: packages/core/src/index.ts
- FOUND: packages/node/src/reachability-guard.node.test.ts
- FOUND: packages/node/src/reachability-dispositions.ts
- FOUND: packages/node/src/fabric-node.node.test.ts
- FOUND: packages/browser/src/network-reach-composition.browser.test.ts
- FOUND: 17b4f21 (Task 1 commit)
- FOUND: bd9e82f (Task 2 commit)
- FOUND: 4d0e099 (Task 3 commit)
