---
phase: phase-21-aot-translation-signing-runtime
plan: 03
subsystem: runtime
tags: [wasm, wasi, executor, abi-routing, aot, sovereignty, provenance]

requires:
  - phase: phase-10-elfconv-aot
    provides: WasiExecutor, the pinned WASI environment, and the wasi-echo fixture
  - phase: phase-14-signed-artifact-resolution
    provides: guardModuleProvenance and the WasiExecutor construction census that fired here
  - phase: phase-15-capability-chains
    provides: the capability authorizer that reordered the DATA-09 block this plan extended
provides:
  - "AbiExecutor — one Executor over a native and a WASI executor, choosing on the module's declared import namespace"
  - "A production call site for WasiExecutor on both tiers, composed innermost"
  - "A node-level proof that a FabricNode from the ordinary factory runs a WASI command module"
  - "The measurement that the sovereignty gate applies to a WASI module and not only a native one"
affects: [phase-21-plan-05, phase-22-reachability, phase-13.1-message-bounds]

tech-stack:
  added: []
  patterns:
    - "ABI dispatch by declared import namespace, per artifact and never per node"
    - "A delegating router that produces no refusal of its own, so no existing reason string moves"

key-files:
  created:
    - packages/aot/src/abi-router.ts
    - packages/aot/src/abi-router.test.ts
  modified:
    - packages/aot/src/index.ts
    - packages/node/src/fabric-node.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/package.json
    - packages/browser/src/browser-node.ts
    - packages/browser/package.json
    - packages/node/src/trust-anchors.node.test.ts
    - packages/node/src/mutation-ledger.ts

key-decisions:
  - "The router delegates on a missing block and on a compile throw rather than answering, so it can never be the component that reports a malformed module"
  - "partitionCount is checked above the block read, so a peer-triggerable refusal still costs one integer comparison"
  - "The native arm on both tiers is the killable-thread executor; the WASI arm runs inline, and that bound is recorded as a gap rather than papered over"
  - "trust-anchors' WasiExecutor guard was updated the way its own comment instructed — conditional on the guard being composed — not by adding the factories to the tool exemption list"

patterns-established:
  - "A line comment in a scanned source file must not contain the two characters that open a block comment: the repo's comment-strippers are non-greedy regexes and one such sequence swallows the file"
  - "A refusal from a *different* gate than the one under test is evidence the task got past the gate under test"

# CORRECTED 2026-08-05. This field read `requirements-completed: [AOT-04]`, which
# contradicted this file's own `## Self-Check` — *"AOT-04 is deliberately not marked
# complete in `REQUIREMENTS.md` by this plan"* — and contradicted the ledger, where AOT-04
# is an unchecked `- [ ]` box carried as **Partial**. The other four Phase 21 summaries
# read `[]`. The original value is retained in this comment, not deleted: retained for the
# reasoning, not the verdict. See `## Correction 2026-08-05` at the foot of this file.
requirements-completed: []

duration: 30min
completed: 2026-08-04
---

# Phase 21 Plan 03: one node, both ABIs, chosen per artifact — Summary

**`AbiExecutor` routes a task to a native or a WASI executor on the module's own declared import namespace, and both node factories now compose it innermost — giving `WasiExecutor` its first production caller on either tier, inside the sovereignty gate and the provenance guard rather than beside them.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-04T08:22Z
- **Completed:** 2026-08-04T08:52Z
- **Tasks:** 2 (both TDD — four commits)
- **Files modified:** 10 (2 created, 8 modified)

## Accomplishments

- `AbiExecutor` exists, is exported from `@o2/aot`, and its spec passes in the `node` project and in all three engines the `browser` project drives (Chromium, Firefox, WebKit) — 16 cases × 3.
- `WasiExecutor` was constructed in eleven places and every one was a test. It now has two production call sites, `fabric-node.ts` and `browser-node.ts`, composed **innermost** so the sovereignty gate, the provenance guard and (in the tab) the duty-cycle governor apply to a translated artifact exactly as they do to a source-compiled one.
- A `FabricNode` from the ordinary factory runs a WASI command module through `node.executor` — the identical object handed to `serveAgent` — with no container, no lifted artifact and no flag.
- The DATA-09 block gained the WASI dispatches that separate a router *inside* the sovereignty gate from one around it.
- All eight of `WasmExecutor`'s refusal reasons are produced unchanged through the router, one assertion each, against a real `WasmExecutor` over the same blocks.

## Task Commits

1. **Task 1 (RED): the routing spec** — `bb3f79d` (test)
2. **Task 1 (GREEN): `AbiExecutor` + barrel export** — `d47860e` (feat)
3. **Task 2 (RED): the node-level call-site proof** — `f5d4d3b` (test)
4. **Task 2 (GREEN): both factories, both package.json files, and the guards the change invalidated** — `9016f4e` (feat)

## Files Created/Modified

- `packages/aot/src/abi-router.ts` *(new)* — `AbiExecutor`; ~160 lines, most of it the argument for why it is not the deleted static analysis.
- `packages/aot/src/abi-router.test.ts` *(new, 373 lines)* — dual-target, no `.node.` suffix.
- `packages/aot/src/index.ts` — exports `AbiExecutor`/`AbiExecutorOptions`; the barrel comment gained the reason.
- `packages/node/src/fabric-node.ts` — `new AbiExecutor({ blockstore, native: compute, wasi: new WasiExecutor(...) })`, wrapped by `provenance` exactly where `compute` was.
- `packages/browser/src/browser-node.ts` — the same over `worker`.
- `packages/node/package.json`, `packages/browser/package.json` — `"@o2/aot": "*"`.
- `packages/node/src/fabric-node.node.test.ts` — two AOT-04 cases plus 2b/3b/3c in the DATA-09 block.
- `packages/node/src/trust-anchors.node.test.ts` — census and construction guard (see Deviations).
- `packages/node/src/mutation-ledger.ts` — M27/M28 find text (see Deviations).

## What was measured, and what was not

**Measured.**

| Reading | Value |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `vitest run --project node packages/{node,aot,net,core,browser}` | 126 files, 1703 passed, 2 skipped, exit 0, 160.8 s real, (user+sys)/real 1.63 |
| `vitest run --project browser` (all three engines) | 246 files, 3867 passed, exit 0, 38.4 s real, (user+sys)/real 2.86 |
| `npm run build:demo` | exit 0 |
| Demo bundle, before → after | 570.74 kB → **590.35 kB** (gzip 160.77 → **165.88 kB**) — the cost of `@o2/aot` and the WASI shim entering the browser bundle |
| `git diff --stat packages/node/src/bin/agent.ts` | empty — this plan adds no flag |
| Wrong-routing refusal, V8 / Node 24, in process | `instantiation failed: WebAssembly.instantiate(): Import #0 "wasi_snapshot_preview1": module is not an object or function` |
| The same, in the other direction | identical sentence with `"o2"` in place of the namespace |
| Mutation: point the `wasi:` argument at the native arm | **caught** — three cases in `fabric-node.node.test.ts` go red, the first with the string above, relayed verbatim from the killable thread |
| `partitionCount > MAX_PARTITIONS` through the router | **0** blockstore reads |
| Router reads per dispatch | 1, and 2 after two dispatches of the same task — no memoisation |

**Not measured, and unmeasured is not met.**

- **The browser tier's runtime behaviour.** The composition is *structurally present and unmeasured at runtime*, the same gap `WIRE-03` carries. `abi-router.test.ts` runs in three real engines, so the router itself is measured there; what is not measured is a `BrowserNode` dispatching a WASI module through `node.executor` in a tab. What would measure it: a `packages/browser/src/*.browser.test.ts` starting a `BrowserNode` in a real Chromium context and dispatching `wasiEcho` through `node.executor`, on this machine in a second browser context. That test is not written here.
- **That no *other* construction path can yield a node running one ABI and not the other.** `bin/agent.ts` gaining no flag is measured; the two factories are shown composing the router; and `trust-anchors.node.test.ts` now enumerates every non-test `new WasiExecutor(` in the tree. But nothing bounds the *native* side: `core/src/executor/task-worker.ts`, `browser/src/task-executor.worker.ts` and three sites in `node/src/bin/bench.ts` still build bare native executors, and a comment in `fabric-node.ts` is a note, not a guard. What would measure it: a source-scanning check in `purity.node.test.ts`'s style requiring every `new WasmExecutor(` outside `@o2/core` to appear as an argument to `new AbiExecutor(`, or Phase 22's reachability guard.
- **"No refusal string changed" — the evidence is the enumerated table, not the green suite.** Nine rows, each driven through the router and through a real `WasmExecutor` over the same blocks and compared with `toBe`. A green run before and after is a regression check and is **not** evidence for this claim: nobody captured a baseline and nobody diffed the two runs string by string, so a green-both-times suite is consistent with a reason having moved somewhere nothing asserts.
- **The plan says "exactly eight refusal reasons". That is not exactly right and the spec says so.** `WasmExecutor.execute` has a ninth `return { ok: false, reason }` site which relays `output_write`'s own refusals. Those are unaffected for a structural reason — the router has already delegated by then — but "unaffected for a reason" is not "measured", and the table does not reach them.

## Decisions Made

- **The router delegates rather than answering.** A missing module block and a failed `WebAssembly.compile` both hand the task straight to the native executor. The router reads the block before either executor does, so any reason of its own would change an existing refusal for a change that was meant to be behaviour-preserving.
- **`partitionCount` is hoisted above the read.** Not a duplicated check — the router produces no reason, it delegates to the executor that already refuses. The hoist is about the *cost*: `protocol.ts` validates an incoming exec frame only for `partitionCount !== 0` and `partitionIndex < partitionCount`, so a peer can send `partitionCount: 1e9` and choose when a `FetchingBlockstore` goes to the network.
- **`nodeId` comes from `native.nodeId`.** A fourth constructor argument is a value that can drift from the one it duplicates.
- **No memoisation of `moduleCid → route`,** on the resource bound rather than the difficulty — the roadmap already has an unbounded-map item open against `EgressGuard.#entries`.
- **The measured V8 refusal string is in the router's comment with its date and engine,** and the spec asserts *containment of `WASI_NAMESPACE`* rather than the whole sentence, because that spec runs in three engines and only the containment was measured in all three.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] A `/*` sequence inside a `//` comment blinded three source-scanning guards**

- **Found during:** Task 2.
- **Issue:** I wrote the glob form of "any o2 package" in a line comment in both factories. Several guards strip comments with a non-greedy `/[*] … [*]/` regex, so that sequence opened a block comment which ran to the next real terminator. `trust-anchors.node.test.ts`, `requirements-ledger.node.test.ts` and `mutation-guard.node.test.ts` all reported a composition present three lines away as absent — five failures that looked like real findings.
- **Fix:** Reworded both comments, and wrote the rule down at the browser-tier site with the date it was measured, so the next person does not spend the same twenty minutes.
- **Files modified:** `packages/node/src/fabric-node.ts`, `packages/browser/src/browser-node.ts`.
- **Verification:** the three guards go from 5 failures to 147 passed.
- **Committed in:** `9016f4e`.

**2. [Rule 3 — Blocking] `trust-anchors.node.test.ts`'s `WasiExecutor` census fired, exactly as written**

- **Found during:** Task 2.
- **Issue:** That file carried a guard requiring `new WasiExecutor(` to appear in no non-test, non-tool file, with the comment: *"When Phase 21 gives `WasiExecutor` a production caller, this fails — and that is the point. The fix is to compose `guardModuleProvenance` at that construction site and update the census entry above, not to add a path here."* It also required exactly three module-CID resolvers; `abi-router.ts` is a fourth.
- **Fix:** Followed that instruction rather than weakening it. The census gained `abi-router.ts` with the note that it is the first entry that resolves without executing, and the `wasi-executor.ts` entry's `guardedAt` now names both factories. The construction guard was changed from "the list must be empty" to "the list must be exactly the declared node factories, **and each must compose `guardModuleProvenance` in the same file**" — the exemption is conditional, and an unguarded factory still fails. The weakness of a textual check is stated at the line, with the pointer to M27/M28, which plant the mutation a textual census cannot see.
- **Files modified:** `packages/node/src/trust-anchors.node.test.ts`.
- **Committed in:** `9016f4e`.

**3. [Rule 3 — Blocking] Mutation ledger M27/M28 find text had drifted**

- **Found during:** Task 2.
- **Issue:** Both entries plant `provenance(compute)` → `compute` and `provenance(worker)` → `worker`. The guard now wraps the router, so neither find text existed and neither mutation could be planted.
- **Fix:** Both `find` values follow the guard to `provenance(abi)`, with `replace: 'abi'`. Each `why` records the move, its date, and that the mutation is now *stronger* — unwrapping it exempts a translated artifact as well as a source-compiled one. The pre-existing measured counts are left as taken rather than renumbered against a run nobody performed.
- **Files modified:** `packages/node/src/mutation-ledger.ts`.
- **Committed in:** `9016f4e`.

### Departures from the plan's text, with the measurement that forced each

**4. The composition sites had moved, and the plan's quoted code no longer exists.**
The plan quotes `new WasmExecutor({ nodeId, blockstore })` at `fabric-node.ts:376-379` and `browser-node.ts:256-261`. Neither is there: both tiers now build a killable-thread executor (`WorkerExecutor` / `browserWorkerExecutor`) at roughly `:1507` and `:1044`, and `browser-node-contract.node.test.ts` requires the raw text `new WasmExecutor(` to occur **zero** times in `browser-node.ts`. The edit was made by symbol, as the plan's own cross-phase note instructed, and the native arm is the killable-thread executor on both tiers.

**5. The plan's DATA-09 instruction named the wrong node.**
It said to dispatch the sovereign WASI task to `defaultNode` and require `sovereignty` in the reason. Since Phase 15, `defaultNode` refuses one step earlier — `unauthorized … no pinned owner key` — and it is `pinnedNode` that reaches `guardSovereignty`. 2b therefore goes to `pinnedNode`, and its reason is asserted **byte-identical to the native refusal beside it** rather than by substring.

**6. The plan's 3b could not pass, and the reason is a measurement worth keeping.**
The plan required the cleared node to answer `ok: true` over RPC. It answers `egress refused: <inputCid> on <peerId>`. `wasi-echo` returns its input, and this task's input *is* the sovereign payload — so the reply body carries that payload off the node and DATA-06's egress tap refuses it by name. That is the tap working, and picking a fixture that slipped past it would have been a worse test. It is also a **stronger** reading than `ok: true` would have been: the tap runs on the reply body, after execution, so a refusal naming the sovereign input CID means the body contained that value, which it can only do if the WASI module ran and echoed it — a run that failed at instantiate would have egressed cleanly. 3b asserts that, plus `not.toContain('sovereignty')` to show a *different* gate answered; 3c reads the value itself through `clearedNode.executor`, where no frame leaves the node and nothing egresses.

**7. Which assertion carries the "router is inside the gate" claim.**
The plan says the pre-existing native assertions cannot separate the two compositions and that the WASI pair can. That is right, and the roles are: **2b** is the reading that goes red on a router composed outside the guard with an unguarded WASI arm (an uncleared WASI task would run instead of being refused); **3b/3c** are its controls, without which "the WASI task was refused" is equally well explained by a node that cannot run WASI at all.

---

**Total deviations:** 3 auto-fixed (1 × Rule 1, 2 × Rule 3) + 4 plan-text departures forced by measurement.
**Impact on plan:** No scope creep. Every auto-fix was a guard that this plan's change legitimately invalidated, and each was updated in the direction its own comment specified rather than weakened.

## Known Gaps

**The WASI arm is not bounded by a wall-clock deadline, on either tier.** BROW-04/SCHED-06 put guest execution on a thread the node can kill, and `WorkerExecutor` arms a per-task deadline against it. The router's *native* arm is that executor; its *WASI* arm runs inline. So a WASI guest that never returns holds the thread it is on — the tab's main thread in a browser, the agent's main thread in Node — and nothing can interrupt it, which is precisely the condition `worker-executor.ts` exists to remove for native modules.

This is a **new** surface: before this plan, no production path could run a WASI module at all. It cannot be closed at the composition site: `WorkerExecutor` posts to a thread running `@o2/core`'s `runTask`, and `@o2/core` may declare no dependency on any other `@o2` package (`purity.node.test.ts`), so the killable path cannot reach `WasiExecutor` from where it stands. Closing it means moving the ABI choice into `runTask`, which is a change to the kernel's dependency shape. **The two tiers carry the identical bound and the identical gap**, so this is one node's asymmetry between two artifacts and not a difference in capability between a tab and a server. It is written at both call sites and is not measured by any test in this plan.

## Issues Encountered

**`bench-attestation.node.test.ts` fails on the full `--project node` run, and it is not this plan's.** That spec snapshots `git status --porcelain` before and after itself and requires them equal. A concurrent agent modified `tools/aot/lift.node.test.ts` during the 226 s run, so the two snapshots differ by exactly that line:

```
+  M tools/aot/lift.node.test.ts
   ?? .planning/phases/phase-20-single-job-path-ledger-churn-resilience/
```

None of this plan's files appear in the diff, and this plan's working tree is clean. The targeted run of the five packages this plan touches — `packages/{node,aot,net,core,browser}`, 126 files — is exit 0.

## Next Phase Readiness

- **Plan 21-05** has what it needs: a production node that constructs a real `WasiExecutor`, and the mutation that falsifies the claim (point the `wasi:` argument at the native arm) is planted and caught, so 21-05's Mutation A has a working target. What 21-05 still owes is the artifact `elfconv` actually produced, across real processes.
- **Phase 22's reachability guard** will find the answer already written down in `fabric-node.ts`: the router is reachable from `bin/agent.ts` and from the browser demo, and deliberately not from `bin/bench.ts`, which measures the native ABI on purpose.
- **Phase 13.1** should know that the browser bundle grew 19.6 kB raw / 5.1 kB gzipped from `@o2/aot` entering it, and that the WASI arm's missing deadline is an unbounded hold rather than an unbounded allocation.

## Self-Check: PASSED

Every file this summary claims exists, exists on disk; every commit hash it names is in
`git log`. `git diff --stat bb3f79d^..HEAD -- packages/node/src/bin/agent.ts` is empty
across the whole plan, not merely at its end. `abi-router.test.ts` is 373 lines against
the plan's `min_lines: 120`. `vocabulary.node.test.ts` is green with this document staged.

**AOT-04 is deliberately not marked complete in `REQUIREMENTS.md` by this plan.** What
landed here is the wiring half, which the plan itself scopes that way: the requirement's
runtime clause is about an artifact `elfconv` actually produced, dispatched to a live node
started via `bin/agent.ts`, and that is Plan 21-05's measurement. Marking it here would
report a criterion as met on the strength of a hand-written fixture.

`STATE.md` and `ROADMAP.md` were not modified, per the execution instruction for this
shared working tree.

## Correction 2026-08-05 — the frontmatter contradicted the body

**Original wording, retained verbatim:**

```yaml
requirements-completed: [AOT-04]
```

**Measured false**, and the evidence is in three places that all disagree with it:

1. This file's own `## Self-Check`, four paragraphs above: *"**AOT-04 is deliberately not
   marked complete in `REQUIREMENTS.md` by this plan.** … Marking it here would report a
   criterion as met on the strength of a hand-written fixture."*
2. `.planning/REQUIREMENTS.md` carries `- [ ] **AOT-04**` — an unchecked box — and its
   traceability row reads **Partial**, naming the outstanding clause as *"the ABI verified
   against a real elfconv artifact rather than a hand-written fixture, across real
   processes (Plan 21-05)."*
3. `21-01`, `21-02`, `21-04` and `21-05` all read `requirements-completed: []`.

**This is the machine-readable half of a document contradicting the prose above it** —
`21-VERIFICATION.md`'s finding W4, confirmed here by re-reading the tree rather than by
re-reading that report. Nothing in the tree parses this field, so the correction moves no
behaviour; what it moves is what a reader of the record is told.

The field now reads `[]`. Retained for the reasoning, not the verdict.

---
*Phase: phase-21-aot-translation-signing-runtime*
*Completed: 2026-08-04*
*Corrected: 2026-08-05*
