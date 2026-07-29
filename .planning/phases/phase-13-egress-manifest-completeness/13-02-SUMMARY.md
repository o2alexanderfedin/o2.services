---
phase: phase-13-egress-manifest-completeness
plan: 02
subsystem: infra
tags: [egress, sovereignty, data-governance, fabric-node, browser-node]

# Dependency graph
requires:
  - phase: phase-13-egress-manifest-completeness
    plan: "01"
    provides: registerSovereignInputs and submitJobWithEgress/sliceManifest, barrel-exported from @o2/net
affects: [phase-13-plan-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A decorator field added alongside an existing concrete-typed field, never replacing it, when downstream callers depend on members the port/wrapper does not declare (egress: EgressGuard beside transport: Libp2pTransport)"
    - "A single sovereignty-default resolution hoisted above every consumer that reads it, so two independently-inlined defaults cannot drift apart"

key-files:
  modified:
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts

key-decisions:
  - "egress is a new field, not a type change to transport — Libp2pTransport-specific members (.stop(), .peers) that EgressGuard does not declare keep working for every existing caller unchanged"
  - "registerSovereignInputs registers against the node's local-only tier (store/IdbBlockstore) in both factories, never the network-fallback tier (blockstore) the executor itself reads from"

patterns-established:
  - "Both node factories now compose registerSovereignInputs(guardSovereignty(inner, sovereignty), {blockstore: store, guard: egress}) identically — one composition pattern, not two, matching the module's own 'why there is no second class' rule"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 7min
completed: 2026-07-27
---

# Phase 13 Plan 02: Wire Both Node Factories Summary

**`FabricNode` and `BrowserNode` both construct their `RpcEndpoint` over a new `egress: EgressGuard` field instead of the raw transport, and both auto-register every sovereign task's input via `registerSovereignInputs` before it runs — closing the two production call sites the phase's roadmap goal names.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-27T14:46:47-07:00
- **Completed:** 2026-07-27T14:53:32-07:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `fabric-node.ts:327` and `browser-node.ts:197` (the two lines 13-CONTEXT.md's finding named) no longer construct `RpcEndpoint` over the raw `Libp2pTransport` — every outbound RPC frame from both node classes is now recorded by construction
- Both factories hoist `options.sovereignty ?? {ownerId: '', canExecuteSovereign: false}` into one resolved local, consumed by both `new EgressGuard(transport, sovereignty.ownerId)` and `guardSovereignty(..., sovereignty)` — no possibility of the two defaults drifting apart
- Every sovereign task either node class runs now has its input declared to that node's own tap via `registerSovereignInputs`, composed outside `guardSovereignty` and reading from the local-only blockstore tier (`store` in `fabric-node.ts`, the `IdbBlockstore` in `browser-node.ts`) — never the network-fallback tier
- `BrowserNode.executor` stays exactly `GovernedExecutor` — `registerSovereignInputs` wraps `guardSovereignty` *inside* `GovernedExecutor`, so BROW-04's `.executed`/`.dutyCycle` surface is unaffected
- Full suite green: 121 test files / 1771 tests (up from the 117/1759 baseline by exactly the 6 tests × 2 vitest projects Plan 13-01 added); `tsc --noEmit` clean across the whole repo; `vocabulary.node.test.ts` and `purity.node.test.ts` both pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire FabricNode.egress and the auto-registered sovereign executor** - `644f833` (feat)
2. **Task 2: Wire BrowserNode.egress and the identical auto-registered sovereign executor** - `7d621b8` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/node/src/fabric-node.ts` - adds `readonly egress: EgressGuard`, hoists `sovereignty` resolution above transport/RPC construction, wraps the served executor in `registerSovereignInputs`
- `packages/browser/src/browser-node.ts` - identical wiring, mirroring `fabric-node.ts`'s composition exactly

## Decisions Made
- `egress` is additive, not a replacement for `transport`'s type — matches 13-CONTEXT.md decision 2's structural corollary and keeps every `.stop()`/`.peers` caller (including `packages/browser/demo/main.ts`'s five call sites reading `n.transport.peers`/`.webrtcAddrs`/`.circuitAddrs`) unaffected
- No change to `blockstore` construction (`FetchingBlockstore(store, new RpcBlockSource(rpc, () => transport.peers))`) in either file — it still reads `transport.peers` directly, per the plan's instruction to minimize the diff since `EgressGuard.peers` would answer identically

## Deviations from Plan
None - plan executed exactly as written. Both tasks matched their `<action>` blocks line for line; no auto-fixes were needed.

## Issues Encountered
None.

## Next Phase Readiness
- Both `FabricNode` and `BrowserNode` expose `.egress` and auto-register sovereign inputs; Plan 13-03 (a separate agent, deliberately) can now write the production-wiring proof and plant the falsification mutations named in this phase's threat register (T-13-04)
- `.guard()` has exactly one production caller in the repository — `registerSovereignInputs` — and it is now reachable from both real node factories, not only from Plan 13-01's own isolated tests

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-27*

## Self-Check: PASSED

Both modified files and both task commit hashes (`644f833`, `7d621b8`) verified present.
