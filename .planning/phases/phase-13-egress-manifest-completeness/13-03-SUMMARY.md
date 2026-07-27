---
phase: phase-13-egress-manifest-completeness
plan: 03
subsystem: testing
tags: [egress, sovereignty, data-governance, fabric-node, falsification]

# Dependency graph
requires:
  - phase: phase-13-egress-manifest-completeness
    plan: "01"
    provides: registerSovereignInputs and submitJobWithEgress/sliceManifest, barrel-exported from @o2/net
  - phase: phase-13-egress-manifest-completeness
    plan: "02"
    provides: FabricNode.egress and BrowserNode.egress, both auto-registering sovereign inputs before dispatch
provides:
  - egress-manifest.node.test.ts — the production-wiring proof for DATA-05/DATA-06 over real FabricNode instances and real TCP, dispatched through submitJobWithEgress with no test-side guard.guard() call
  - Two observed, documented, reverted mutation cycles proving both of Plan 13-02's guards (registerSovereignInputs, the EgressGuard transport wrap) can actually fail
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sovereign test fixtures must be pre-seeded onto the executing node's own local-only store (node.store, not node.blockstore) before dispatch — registerSovereignInputs reads only the local tier by design (owner-pinned semantics), and skips silently if the block is not yet resident, which is only true before a network fetch has happened"

key-files:
  created:
    - packages/node/src/egress-manifest.node.test.ts
  modified: []

key-decisions:
  - "Every sovereign-labelled test seeds its row directly onto the owner node's local store (not only onto the requestor's store, where submitJob itself puts shard inputs) — verified experimentally: removing the seed makes the falsification test fail with an empty violations array instead of one containing the leaked CID, confirming registerSovereignInputs's documented silent-skip behavior actually applies to the real dispatch path"
  - "The pushdown test compares only encodeCanonical(output) against encodeCanonical(rawRow) — not manifest.totalBytes against either — because totalBytes sums every frame the node sent (including the unrelated module block-fetch request), so it does not isolate the aggregate's own size; this mirrors sovereign-execution.test.ts's own criterion-3 comparison rather than inventing a new, less precise one"

patterns-established:
  - "A mutation is planted, its produced failure captured verbatim, and only then reverted — never adjusted to match a prediction. Mutation 2 (the EgressGuard transport wrap) broke all four tests in this file, not only the one the plan named; that broader blast radius is reported as observed, not narrowed to fit"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 25min
completed: 2026-07-27
---

# Phase 13 Plan 03: The Proof Plan Summary

**Four tests against real `FabricNode` instances over real TCP prove DATA-05/DATA-06 through `submitJobWithEgress` with zero test-side `guard.guard()` calls; both of Plan 13-02's guards were planted-failing and reverted — and neither `bin/bench.ts` nor the browser demo actually calls `submitJobWithEgress` yet, which this summary reports plainly rather than papers over.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-27T22:15:54Z
- **Tasks:** 2
- **Files modified:** 1 created, 0 net changes to production code (both mutations reverted)

## Accomplishments
- `packages/node/src/egress-manifest.node.test.ts`: four tests, two real `FabricNode.start()` instances per test (the identical factory `bin/agent.ts` calls), dispatched over real TCP through `submitJobWithEgress` — no hand-built fabric, no direct `guard.guard()` call anywhere in the file
- DATA-05 falsification: a sovereign row pre-seeded on the owner node's local store, run through `MODULE_ECHOES_INPUT`, produces `result.manifests[0].violations` containing the row's independently-computed CID — proof that `registerSovereignInputs`, wired into `FabricNode.start` by Plan 13-02, is the thing that caught it, not a test-side stand-in
- DATA-06: a clean sovereign job, a public job, and a pushdown job all pair `violations == []` with `entries.length > 0` — the empty-manifest trap this whole phase exists to close
- Criterion 3: the pushdown job's output, re-encoded independently, is strictly smaller than the raw sovereign row's own canonical encoding, with zero violations
- Both required mutations were planted, run, and their real output captured verbatim, then reverted — `git status --short` empty and `tsc --noEmit` clean both times
- Full suite: 122 test files / 1775 tests (up from the 121/1771 baseline by exactly this plan's 4 new tests), `tsc --noEmit` clean, `vocabulary.node.test.ts` and `purity.node.test.ts` both green

## Task Commits

1. **Task 1: The production-wiring proof** — `deef8d5` (test)
2. **Task 2: Prove both guards can fail** — no commit. Both mutations were planted in `packages/node/src/fabric-node.ts`, run, observed, and reverted with `git checkout --`; the task produces no lasting code change by design, so nothing was staged.

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `packages/node/src/egress-manifest.node.test.ts` — the four-test production-wiring proof described above

## Decisions Made
- Pre-seeded every sovereign-labelled test's row onto the executing node's own `store` (the local-only tier) before dispatch, in addition to whatever `submitJob` itself puts onto the requestor's store as part of building the job. This is not explicit in the plan's literal `<action>` text, which only names seeding the module onto `requestor.store`. It is required: `registerSovereignInputs` reads exclusively from the local-only tier and silently skips registration if the block is not yet resident (documented in `sovereign-egress.ts` as intentional — the input might still be fetched by the executor itself). Verified by direct experiment: temporarily removing the seed from the falsification test reproduces the exact predicted failure (`violations` stays `[]` even though the job still runs and `agreed`), confirming the seed is load-bearing, not decorative.
- Dropped a `manifest.totalBytes < rawEncoded.bytes.length` assertion from the pushdown test that I initially considered adding beyond the plan's spec. `totalBytes` sums every frame the node sent during the job, including the unrelated module block-fetch request/response, so it does not isolate the aggregate's own size and is not a reliable proxy for the pushdown claim. Matched `sovereign-execution.test.ts`'s own criterion-3 test instead, which compares only `encodeCanonical(output)` against `encodeCanonical(rawInput)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plan's literal test setup would not have exercised the registration path it claims to test**
- **Found during:** Task 1, before first test run
- **Issue:** The plan's `<action>` block instructs putting only the module onto `requestor.store`, with the sovereign row's input landing on `requestor.store` automatically via `submitJob`'s own `blockstore.put`. Tracing `registerSovereignInputs`'s actual composition in `fabric-node.ts` (`{ blockstore: store, guard: egress }` — the *local-only* tier, constructed *before* `WasmExecutor`'s network-fallback fetch runs) shows this ordering means the guard's registration check would find nothing resident and silently skip — the documented, intentional "silent skip" behavior. A falsification test built this way would still pass the job (`agreed`) but never populate `violations`, regardless of whether the module leaks.
- **Fix:** Independently computed each sovereign row's canonical CID/bytes in the test and put those bytes directly onto the owner node's own `store` before calling `submitJobWithEgress`, for every sovereign-labelled test (falsification, clean-job, pushdown). This matches real owner-pinned semantics and `sovereign-execution.test.ts`'s own `ownerFabric` helper (`await local.put(sovereignBytes())`).
- **Files modified:** `packages/node/src/egress-manifest.node.test.ts` (written this way from the start; no separate fix commit)
- **Verification:** Temporarily removed the seed line from the falsification test and reran it in isolation — it failed with `expected [] to include '<cid>'` (empty violations, task still `agreed`), the exact predicted failure. Restored the seed; all 4 tests pass. Diff confirmed identical to the pre-experiment file afterward.
- **Committed in:** `deef8d5` (the file was written correctly from the start; the experiment above was verification-only, not a separate commit)

---

**Total deviations:** 1 auto-fixed (1 bug, caught before any test was committed in a non-working state)
**Impact on plan:** No scope creep — the fix is entirely inside the one file Task 1 was already scoped to write, and makes the file's tests actually exercise what they claim to.

## Issues Encountered

**Mutation 2's blast radius is broader than the plan predicted.** The plan's Task 2 `<action>`/`<done>` text expects removing the `EgressGuard` transport wrap (`new RpcEndpoint(transport, ...)` instead of `new RpcEndpoint(egress, ...)`) to break only the DATA-06 clean-job test, via its `entries.length > 0` assertion, "not the violations assertion." Observed behavior: it broke **all four tests in the file**, including the DATA-05 falsification test — via its `violations` assertion, not `entries.length` (that test never checks `entries.length` directly). This is mechanically inevitable, not a test defect: once `rpc` sends over the raw `transport` instead of `egress`, `alice.egress`/`defaultNode.egress` never receive a single `send()` call for the whole job, so every field of every manifest read from those guards — `entries`, `totalBytes`, and consequently `violations` too — reads as empty/zero, regardless of which specific claim a given test happens to check. Reported here as observed rather than narrowed to fit the plan's prediction, per this plan's own falsifier instructions. Both mutations were still reverted cleanly (`git status --short` empty, `tsc --noEmit` clean) after their real output was captured.

## Next Phase Readiness

**A real gap, not introduced by this plan but newly confirmed by it:** `submitJobWithEgress` is barrel-exported, `tsc`-clean, and now proven correct against real `FabricNode` instances by this plan's own tests — but grepping the whole repository shows **it is called nowhere in production code**. `packages/node/src/bin/agent.ts` never calls `submitJob` at all (it is serving-only). `packages/node/src/bin/bench.ts:226` and `packages/browser/demo/main.ts:307,541` — the exact three call sites 13-CONTEXT.md's decision 2 named as candidates — all still call the bare `submitJob`, not `submitJobWithEgress`. Read literally, ROADMAP Phase 13's criterion 2 ("every job run through `bin/agent.ts` or the browser demo emits an egress manifest ... retrievable from the job's own result metadata") is **not yet true of the running system**: a user who runs `bin/bench.ts` or opens the browser demo today gets a `JobResult` with no manifest attached. The *mechanism* is proven and correct (this plan's own tests, run outside any hand-built harness, demonstrate the manifest reaching a real caller's return value over real RPC) — but it is not wired into any of the repository's actual job-submission entry points. This is out of this plan's assigned task list (Task 1 writes one test file; Task 2 mutates and reverts `fabric-node.ts`) and was not attempted here. Flagging it for whoever plans next: wiring `bin/bench.ts` and the two demo call sites to call `submitJobWithEgress` instead of `submitJob` is a small, mechanical change now that the function exists and is proven.

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-27*

## Self-Check: PASSED

`packages/node/src/egress-manifest.node.test.ts` and task commit `deef8d5` both verified present. `git status --short` at self-check time showed only this SUMMARY as untracked (`fabric-node.ts` clean — both mutations fully reverted).
