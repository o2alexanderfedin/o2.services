---
phase: phase-12-sovereignty-pinned-placement
plan: 04
subsystem: scheduling
tags: [sovereignty, wire-protocol, executor-adapter, submitJob, production-wiring, mutation-testing, typescript, rpc]

# Dependency graph
requires:
  - phase: phase-12-sovereignty-pinned-placement
    plan: "01"
    provides: "submitJob wired through planPlacement/eligibleNodes, ShardSpec union, JobSpec.nodes, Task.label/ownerId"
  - phase: phase-12-sovereignty-pinned-placement
    plan: "02"
    provides: "guardSovereignty(inner, node) — the DATA-09 serving-side gate, unit- and mutation-tested but with zero production callers before this plan"
provides:
  - "Task.label/ownerId survive an RPC round trip intact (encodeRequest/parseRequest, protocol.ts)"
  - "parseRequest refuses an exec request that carries no label — the wire trust boundary, not Task.label itself, is where the label became non-optional"
  - "guardSovereignty wired into BOTH production node constructors (fabric-node.ts, browser-node.ts), each defaulting to cleared-for-nobody when no sovereignty option is supplied — no opt-in required to get the refusal"
  - "criterion 4: a genuine replica holder (holds the block, cleared for nobody) refuses a directly-dispatched sovereign Task over real RPC, and still answers a direct block request for the same CID"
  - "criterion 3: a sovereign shard submitted through submitJob (the live job path) emits a partial smaller than its raw input, observed via the existing EgressGuard tap reused as a test instrument"
affects: [phase-13-egress-manifest, phase-15-auth-03-capability-chains]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wire-boundary validation as the trust enforcement point: Task.label stays optional at the type level (so ~65 unrelated in-process Task literals need no change) but parseRequest refuses any exec request that omits it — the boundary between trusted (in-process) and untrusted (network) input is where the requirement actually belongs"
    - "Guard the single construction point, not the serveAgent call site: both fabric-node.ts and browser-node.ts wrap guardSovereignty where the Executor is built, so serveAgent (remote dispatch) and any in-process caller of node.executor see the identical guard — one source of truth rather than two composition paths that could drift apart"
    - "Safe-default options: NodeSovereignty is an optional start option on both node constructors, defaulting to canExecuteSovereign: false — the unconfigured case is the refusing case, not the permissive one"

key-files:
  created: []
  modified:
    - packages/net/src/protocol.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/net/src/distributed.test.ts
    - packages/net/src/discovery.test.ts
    - packages/net/src/churn.test.ts
    - packages/node/src/fabric-node.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/browser/src/browser-node.ts

key-decisions:
  - "Correction 2 overrides Task 1's own spec: the plan's Task 1 <behavior> said an absent label should parse through with label left undefined ('exactly as today'). The execution context's Correction 2 explicitly supersedes this — an absent label at the wire is now malformed, full stop. Implemented as specified by the correction, not as originally planned."
  - "Reused SOVEREIGN_ROW/sovereignBytes() directly for criterion 3's shard value, not a new fixture: keeps the dispatch checked against the same guarded byte pattern the file's existing falsification test ('catches a map step...') proves the tap can detect, rather than introducing a value the guard has never been registered against."
  - "guardSovereignty wrapped inside GovernedExecutor in browser-node.ts, not around it: BrowserNode.executor must stay typed exactly as GovernedExecutor for BROW-04's .executed/.dutyCycle surface. Wrapping the WasmExecutor/WorkerExecutor before it reaches GovernedExecutor keeps that type intact while still guarding every execution path — RPC dispatch via serveAgent and a page's own local self-dispatch (includeSelf, demo/main.ts) alike."
  - "fabric-node.ts wraps once at the single executor-construction point (not separately for serveAgent), for the same single-source-of-truth reason: node.executor and serveAgent's executor are the same guarded object."
  - "Default sovereignty is {ownerId: '', canExecuteSovereign: false} on both nodes. The placeholder ownerId is never consulted — guardSovereignty's clearance check short-circuits on canExecuteSovereign — documented inline so a reader doesn't mistake the empty string for a meaningful default."

patterns-established:
  - "Mutation-test each correction against a test that would not exist without it: mutation 1 (remove the fabric-node.ts wrap) fails the new real-RPC production-wiring test; mutation 2 (remove parseRequest's label requirement) fails the new omitted-label wire test; mutation 3 (invert guardSovereignty's clearance check) fails every test in this plan that depends on correct clearance, in both directions — cleared-should-execute and uncleared-should-refuse."

requirements-completed: [DATA-07, DATA-09]

# Metrics
duration: ~100min
completed: 2026-07-27
---

# Phase 12 Plan 04: Sovereignty Over the Wire, Production Wiring, and the Wire Trust Boundary Summary

**`Task.label`/`ownerId` now survive an RPC round trip and are mandatory at `parseRequest`'s trust boundary; `guardSovereignty` is wired into both production node constructors (`fabric-node.ts`, `browser-node.ts`) with a safe cleared-for-nobody default, closing the exact "built, not wired" gap the v1.0 audit found in `guardSovereignty` itself.**

## Performance

- **Duration:** ~100 min
- **Tasks:** 2 plan tasks + 2 mandatory corrections
- **Files modified:** 8
- **Commits:** 4

## Accomplishments

- `encodeRequest`/`parseRequest` (`protocol.ts`) carry `Task.label`/`ownerId` across the wire, byte-for-byte unchanged in shape when absent, with `label`/`ownerId` present only when the task actually carries them.
- **Correction 2** (mandatory amendment to Task 1's own spec): `parseRequest` now refuses (`return null`) an exec request that carries no label at all, rather than reconstructing a `Task` with `label` left `undefined`. An absent label would otherwise reach `guardSovereignty` unlabelled and pass through it as a no-op — trusting whoever dispatched the task not to omit the one field the refusal depends on, which is exactly what `guardSovereignty`'s own docstring says it exists to not do. `Task.label` itself stays optional at the type level; only the wire boundary enforces it.
- Every existing exec-over-RPC test in `distributed.test.ts`, `discovery.test.ts`, and `churn.test.ts` that previously dispatched an unlabelled `Task` now carries one — these were not incidental; each was a real caller that would otherwise be refused as malformed under the new rule. Two new tests prove both directions explicitly: a labelled request round-trips (`'public'` and `'sovereign'`), and one with the label omitted is refused before it ever reaches the executor (call-counter proof, mirroring the file's own AUTH-03 pattern).
- `ownerFabric` (`sovereign-execution.test.ts`) wraps every owned node's executor with `guardSovereignty(..., {canExecuteSovereign: true})` and Bob's foreign node with `canExecuteSovereign: false`, confirmed a true no-op for all four pre-existing tests before adding anything new.
- **Criterion 4**: Bob — a genuine replica holder of Alice's block (his own `MemoryBlockstore` holds it, proven by a direct `block` RPC request returning the bytes) — refuses a directly-dispatched sovereign `Task` naming both the node id and "sovereignty", bypassing placement entirely.
- **Criterion 3**: a sovereign shard submitted through `submitJob` (not hand-called `executeVerified`) emits a partial (8 bytes, fixed) smaller than its raw input (~50+ bytes), and the existing `EgressGuard` — reused as a test instrument, not newly wired into production (that stays Phase 13's job) — reports zero violations and a non-empty manifest for the run.
- **Correction 1** (mandatory): `guardSovereignty` had zero production callers before this plan — it appeared only in its own definition, spec, and a barrel re-export, verbatim the v1.0 audit's "built, not wired" test. Both `fabric-node.ts` and `browser-node.ts` now wrap the `Executor` each hands to `serveAgent` with `guardSovereignty`, taking an optional `sovereignty: NodeSovereignty` start option that defaults to `{ownerId: '', canExecuteSovereign: false}` — cleared for nobody — when omitted. `bin/agent.ts` starts a node with no `sovereignty` option and gets the guarded, refusing behavior automatically; no caller has to opt in to get the safety.
- A new real-TCP-RPC test in `fabric-node.node.test.ts` starts one node via the same `FabricNode.start()` factory `bin/agent.ts` uses, with no `sovereignty` option, and one started explicitly cleared for `'alice'`; dispatches an identical sovereign `Task` at both from a third node over real sockets. The default node refuses; the cleared node accepts. No hand-built fabric, no test-only bypass.
- All three required mutations produced the specific, expected failure (full transcripts below), then were reverted to byte-identical files.

## Task Commits

1. **Task 1 + Correction 2: carry Task.label/ownerId over the wire; require it at parseRequest** — `fa8ea36` (feat)
2. **Task 2: wire guardSovereignty into ownerFabric; prove criteria 3 and 4** — `701f653` (test)
3. **Correction 1: guard the production serving executor by default** — `e51852b` (feat)
4. **Correction 1: prove the production serving executor is guarded, over real RPC** — `3b000ae` (test)

**Plan metadata:** (this commit, following SUMMARY.md)

## Files Created/Modified

- `packages/net/src/protocol.ts` — `encodeRequest`/`parseRequest`'s exec branches carry and require `label`/`ownerId`
- `packages/net/src/sovereign-execution.test.ts` — `ownerFabric` wraps both owned and foreign nodes with `guardSovereignty`; two new criterion 3/4 tests; four pre-existing hand-built `Task` literals now carry `label`/`ownerId`; `Fabric` exposes `seedStore`
- `packages/net/src/distributed.test.ts` — existing exec-over-RPC tests carry `label`; two new protocol-validation tests (round-trip both directions, omitted-label refusal with a call-counter)
- `packages/net/src/discovery.test.ts` — one existing dispatch carries `label: 'public'`
- `packages/net/src/churn.test.ts` — `taskFor`'s constructed `Task` now carries `shard.label` (Rule 1 bug fix — see Deviations)
- `packages/node/src/fabric-node.ts` — `sovereignty` start option; `guardSovereignty` wraps the executor at its single construction point
- `packages/node/src/fabric-node.node.test.ts` — `startNode` accepts extra options; new DATA-09 production-wiring test
- `packages/browser/src/browser-node.ts` — `sovereignty` start option; `guardSovereignty` wraps the inner executor inside `GovernedExecutor`

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: Correction 2 is a direct, intentional override of Task 1's own written `<behavior>` spec (which said an absent label should parse through unchanged) — implemented per the execution context's explicit instruction that this correction is mandatory, not per the plan text as originally written.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `churn.test.ts`'s `taskFor` dropped `shard.label` when constructing the dispatched `Task`**
- **Found during:** Correction 2 (making `parseRequest` require a label broke `churn.test.ts` at runtime)
- **Issue:** `taskFor` built a `Task` from a `ShardWork` (which does carry `label`) but never copied it onto the constructed `Task` — the exact "wiring forgetting to pass the real label through" class of bug the sovereignty design exists to prevent, now caught by the wire boundary rather than silently working because the field was optional.
- **Fix:** `taskFor` now includes `label: shard.label`. All shards in this file are `'public'`, so no `ownerId` branch was needed.
- **Files modified:** `packages/net/src/churn.test.ts`
- **Verification:** All 5 `churn.test.ts` tests pass; `npx tsc --noEmit` clean.
- **Committed in:** `fa8ea36`

**2. [Rule 2 - Missing Critical] Added explicit round-trip and omitted-label tests to `distributed.test.ts`**
- **Found during:** Correction 2's own text ("Test both directions...")
- **Issue:** The correction explicitly requires proving both directions of the new wire behavior. Fixing existing callers to carry a label proves the "present" direction only incidentally; nothing proved the "omitted → refused before reaching the executor" direction directly, nor gave the required mutation (#2) a test to fail against.
- **Fix:** Added `'round-trips label and ownerId when present, in both directions'` (unit-level, both `'public'` and `'sovereign'`) and `'refuses an exec request with the label omitted, before it reaches the executor'` (real RPC, call-counter proof mirroring the file's own AUTH-03 pattern) to the `protocol validation` describe block.
- **Files modified:** `packages/net/src/distributed.test.ts`
- **Verification:** Both tests pass; mutation 2 (below) fails the second one in the expected direction.
- **Committed in:** `fa8ea36`

**3. [Rule 2 - Missing Critical] Added a real-RPC production-wiring test for `fabric-node.ts`**
- **Found during:** Correction 1's explicit requirement ("A test wrapping it does not count... must produce a guarded executor without anyone opting in")
- **Issue:** Wiring `guardSovereignty` into `fabric-node.ts`/`browser-node.ts` alone is a code change with no runtime proof that the composition is correct (right object wrapped, right default, actually reachable over RPC).
- **Fix:** Added a test to `fabric-node.node.test.ts` using the same `FabricNode.start()` factory `bin/agent.ts` calls, over real TCP sockets, proving both the default-refuses and cleared-accepts directions. `startNode`'s helper signature was extended to accept extra options for this.
- **Files modified:** `packages/node/src/fabric-node.node.test.ts`
- **Verification:** Test passes; mutation 1 (below) fails it in the expected direction.
- **Committed in:** `3b000ae`

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing critical). All directly required to make the two mandatory corrections land without weakening or leaving unproven the exact behavior they specify. No scope creep beyond what the corrections themselves demanded.

## Known Gap (disclosed, not silently accepted)

**`browser-node.ts`'s `guardSovereignty` wiring has no dedicated real-transport test.** The code change is symmetric with `fabric-node.ts`'s (same `guardSovereignty` function, same safe-default pattern, `npx tsc --noEmit` clean against `Executor`/`NodeSovereignty`), and it is exercised indirectly by every existing e2e test that already runs `BrowserNode.start()` (`two-tabs.e2e.test.ts`, `many-tabs.e2e.test.ts`, `colouring-demo.e2e.test.ts`, `background-tab.e2e.test.ts` — none of which dispatch a sovereign-labelled task, so none currently observe the guard's refusal path). `BrowserNode.start()` unconditionally calls `IdbBlockstore.open()` (requires a real `indexedDB`) and dials a real relay — it cannot run in the `node` vitest project at all, and vitest's browser-mode project runs a single page with no Node-side relay to dial. A genuine runtime proof would require either a new dependency (`fake-indexeddb`) or extending the `window.o2` demo API with a sovereignty-aware dispatch path and adding a new e2e scenario — both judged out of scope for this plan given the mutation-testing requirement was scoped explicitly to `fabric-node.ts` (mutation 1) and the time/flakiness budget already flagged for the e2e tier. Flagging this explicitly rather than silently declaring it proven: the `grep` in the deliverables confirms a genuine production call site exists in `browser-node.ts`, but call-site existence and composition-correctness are not the same claim, and only the former is verified for this file.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: authorization-configuration | `packages/node/src/fabric-node.ts`, `packages/browser/src/browser-node.ts` | New `sovereignty` start option determines a node's DATA-09 execution clearance. The default (`canExecuteSovereign: false`) is safe, but an operator who sets `canExecuteSovereign: true` with the wrong `ownerId` silently misconfigures which owner's data this node is cleared for — nothing at `start()` validates the id against any external record. Not a regression (no such option existed before this plan to misconfigure), but new surface outside the plan's original `<threat_model>`, which covered only the wire boundary (T-12-07) and the egress tap (T-12-08). |

## Issues Encountered

None beyond the deviations documented above, all anticipated by the two corrections themselves.

## User Setup Required

None — no external service configuration required.

## Mutation Test Results (the plan's explicit deliverable)

**Baseline measured before any change:** `npx tsc --noEmit` clean; `npx vitest run` → **116 test files, 1749 tests, all passing** (matches the execution context's stated baseline exactly).

**Final state after all four commits:** `npx tsc --noEmit` clean; `npx vitest run` → **116 test files, 1758 tests, all passing** (+9 tests, 0 files added — the 5 new `it()` blocks in `packages/net/src/*.test.ts` each run under both the `node` and `browser` vitest projects, 4 new tests × 2 = 8, plus 1 new node-only test in `fabric-node.node.test.ts` = 9). Nothing went pass→fail.

**Mutation 1 — removed the `guardSovereignty` wrap from `fabric-node.ts`:**
```ts
// before: const executor = guardSovereignty(new WasmExecutor({...}), options.sovereignty ?? {...})
const executor = new WasmExecutor({ nodeId: libp2p.peerId.toString(), blockstore })
```
`npx vitest run packages/node/src/fabric-node.node.test.ts --project node -t "DATA-09"`:
```
FAIL packages/node/src/fabric-node.node.test.ts > DATA-09 — the production serving executor is guarded without opting in > a node started with no sovereignty option refuses; one started cleared for the owner accepts
AssertionError: expected true to be false
- false
+ true
  at fabric-node.node.test.ts:257:24  (expect(refused.ok).toBe(false))
```
The "default" node executed the sovereign task instead of refusing it — exactly the wiring gap this correction exists to close. Reverted; `diff` against the pre-mutation file byte-identical; test passes again (6/6).

**Mutation 2 — removed `parseRequest`'s label requirement:**
```ts
// before: if (labelValue !== 'public' && labelValue !== 'sovereign') return null
// after: unlabelled records fall through to a Task with label/ownerId both absent
```
`npx vitest run packages/net/src/distributed.test.ts --project node -t "refuses an exec request with the label omitted"`:
```
FAIL protocol validation > refuses an exec request with the label omitted, before it reaches the executor
AssertionError: expected { ok: true, kind: 'exec', … } to deeply equal { kind: 'error', reason: 'malformed request' }
  at distributed.test.ts:491:21  (expect(reply).toEqual({kind: 'error', ...}))
```
The unlabelled request reached the watched executor and executed (`executed` incremented, reply `ok: true`) instead of being refused as malformed. Reverted; `diff` byte-identical; test passes again (25/25).

**Mutation 3 — inverted `guardSovereignty`'s clearance check:**
```ts
// before: const cleared = task.ownerId === node.ownerId && node.canExecuteSovereign
const cleared = !(task.ownerId === node.ownerId && node.canExecuteSovereign)
```
`npx vitest run packages/net/src/sovereign-execution.test.ts packages/node/src/fabric-node.node.test.ts --project node`:
```
Test Files  2 failed (2)
     Tests  7 failed | 5 passed (12)
```
Every test in this plan that depends on the clearance check's correct direction failed: the three criterion 6/7 tests and criterion 3 (owner-cleared nodes now wrongly refused — `verification.status` `'insufficient'` instead of `'agreed'`), the "catches a map step" test (`outcome.ok` false instead of true), criterion 4 (Bob now wrongly *cleared* — his dispatch was attempted and failed on a missing module block rather than being refused for sovereignty, since his bare `MemoryBlockstore` was never meant to serve execution), and the new `fabric-node.node.test.ts` production-wiring test (the "default" node now wrongly cleared). Reverted; `diff` byte-identical; all 12 tests pass again.

## Verification Confirmation (deliverables requirement)

```
$ grep -rn 'guardSovereignty' packages/ --include='*.ts' | grep -v test
packages/net/src/protocol.ts:291:  // ... (`guardSovereignty`, sovereignty-guard.ts) ...
packages/net/src/protocol.ts:403:  // ... reach `guardSovereignty` ...
packages/core/src/index.ts:64:export { guardSovereignty } from './executor/sovereignty-guard.ts'
packages/browser/src/browser-node.ts:34:import { WasmExecutor, guardSovereignty } from '@o2/core'
packages/browser/src/browser-node.ts:229:      guardSovereignty(
packages/core/src/executor/sovereignty-guard.ts:49:export function guardSovereignty(...)
packages/node/src/fabric-node.ts:79:import { MemoryBlockstore, WasmExecutor, guardSovereignty } from '@o2/core'
packages/node/src/fabric-node.ts:345:    const executor = guardSovereignty(
```
Confirmed: a genuine production call site in each node (`fabric-node.ts:345`, `browser-node.ts:229`), beyond the definition/export/import lines.

`npx vitest run packages/node/src/vocabulary.node.test.ts packages/node/src/purity.node.test.ts` — 38/38 passing, run twice (before and after the mutation tests) to satisfy the plan's "run the guard after writing your SUMMARY, then again" instruction.

`npx vitest run packages/node/src/colouring-demo.e2e.test.ts` in isolation — **6/6 passing.** Also passed as part of the full 1758-test run. No flakiness observed in this session, consistent with the prior report that it flakes only under Playwright contention.

## Next Phase Readiness

- All four ROADMAP criteria for Phase 12 are now demonstrated on the live `submitJob` path, per the plan's `<success_criteria>`: placement discrimination (12-02/12-03), non-optional labelling (12-02), pushdown without the Phase 13 manifest (this plan, criterion 3), and backbone execution-ineligibility at a genuine replica holder over real RPC (this plan, criterion 4).
- `guardSovereignty` now has real production callers in both node types — the "built, not wired" gap the v1.0 audit found is closed for this specific symbol. `browser-node.ts`'s wiring lacks a dedicated real-transport proof (see Known Gap); recommend either a `fake-indexeddb`-based unit test or a `window.o2` API extension + new e2e scenario as a small, well-scoped follow-up if that gap needs closing before the next milestone's verification pass.
- Phase 13's egress-manifest work has a clean point to build from: `fabric-node.ts:311` (comment marker preserved) and `browser-node.ts:181`-equivalent are still the named integration points; this plan explicitly did not wire `EgressGuard` into either production node, only reused it as this file's own test instrument, matching the plan's own "Position on Risk 1" text.
- No blockers.

---
*Phase: phase-12-sovereignty-pinned-placement*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 8 modified files plus this SUMMARY verified present on disk. All 4 task commit hashes
(`fa8ea36`, `701f653`, `e51852b`, `3b000ae`) verified present in `git log`. Vocabulary guard
(`vocabulary.node.test.ts`) run twice after writing this SUMMARY, 24/24 passing both times.
