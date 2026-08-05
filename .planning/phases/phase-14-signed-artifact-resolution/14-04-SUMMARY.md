---
phase: phase-14-signed-artifact-resolution
plan: 04
subsystem: security
tags: [provenance, signed-names, browser-tier, demo, e2e, tab-api]

# Dependency graph
requires:
  - phase: phase-14-plan-01
    provides: "guardModuleProvenance / ModuleProvenance — the adapter this plan composes in the browser tier"
  - phase: phase-14-plan-02
    provides: "moduleRecord on JobSpec and on the wire, and KERNEL_RECORD / KERNEL_TRUST_ANCHOR from @o2/demo — what the demo now dispatches and pins"
  - phase: phase-14-plan-03
    provides: "FabricNodeOptions.trustAnchors' required-with-named-sentinel shape, and trust-anchors.node.test.ts's two arrays"
provides:
  - "BrowserNodeOptions.trustAnchors — required, readonly PublicKeyHex[] | 'runs-unsigned-artifacts'"
  - "guardModuleProvenance composed innermost in BrowserNode.start, on every node the browser tier builds"
  - "TabApi.start's optional anchor list, defaulting to the demo's committed authority — and no opt-out at all"
  - "TabApi.runJob's required moduleRecord, and TabNameRecord — the shape that survives page.evaluate"
  - "TabJobReport.failures — the field that tells a refusal from a dropped relay"
  - "runColouring dispatches KERNEL_RECORD; the visitor-facing demo resolves through a signed mapping"
  - "two-tabs.e2e.test.ts's two refusal cases — the browser tier's guard read between two real contexts"
affects: [phase-14-plan-05, phase-15, phase-17, phase-21]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A transport-shaped twin of a domain type, where structured cloning cannot carry the domain one"
    - "A required option below a surface that deliberately exposes no opt-out — the asymmetry is the design"
    - "A replacement property measured through its consequence, when nothing exposes the set to read"
    - "A refusal asserted on named text, with the same field shown reading silence in the same file"

key-files:
  created: []
  modified:
    - packages/browser/src/browser-node.ts
    - packages/browser/src/tab-api.ts
    - packages/browser/src/index.ts
    - packages/browser/demo/main.ts
    - packages/browser/src/start-unwind.browser.test.ts
    - packages/browser/src/browser-node-contract.node.test.ts
    - packages/node/src/trust-anchors.node.test.ts
    - packages/node/src/two-tabs.e2e.test.ts
    - packages/node/src/background-tab.e2e.test.ts

key-decisions:
  - "The plan's `worker ?? new WasmExecutor(...)` does not exist — createWorker is required and the fallback was deleted, so the guard wraps the single executor that resolves"
  - "browser-node.ts needed an EXEMPT_PATHS entry after all: packages/browser cannot index into FabricNodeOptions without depending on packages/node"
  - "The inherited kernel.ts bundle-bytes item is CLOSED, not costed: kernel-build.node.test.ts already proves kernelBytes === kernel.wasm and cid(kernel.wasm) === KERNEL_RECORD.cid, so the committed record vouches for the bundled bytes"
  - "TabNameRecord is exported from @o2/browser because the harness that builds one lives in packages/node"
  - "A comment naming a constructor is a construction to a raw-text scan — the comment was reworded, the assertion was not"

patterns-established:
  - "Measure a wiring claim by planting its negation: empty the anchors, delete the composition, and watch what goes red"
  - "Assert the cheap scan and the expensive e2e are complementary by running both against the same planted defect"

requirements-completed: []

# Metrics
duration: 22min
completed: 2026-07-31
---

# Phase 14 Plan 04: The Browser Tier's Half Summary

**Every `BrowserNode` composes `guardModuleProvenance` innermost, behind a `trustAnchors` option that is required and has no default — and the `TabApi` above it exposes no opt-out at all, so there is no value passable through `window.o2` that starts a tab which resolves a bare CID.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-31T15:49:00-07:00
- **Completed:** 2026-07-31T16:11:00-07:00
- **Tasks:** 3
- **Files modified:** 9 (0 created, 9 modified)

## Task Commits

| Commit | Task | What |
|---|---|---|
| `300b2cf` | 1 | `trustAnchors` required, the guard composed, `TabNameRecord`, both scan arrays |
| `8c29c5c` | 2 | The demo pins its own anchor and dispatches its own record |
| `58dfc80` | 3 | Two real contexts: one signed job accepted, two refused |
| `4265600` | fix | A comment that named a constructor tripped a text scan |

## What was built

### The option, and the asymmetry above it

`BrowserNodeOptions.trustAnchors: readonly PublicKeyHex[] | 'runs-unsigned-artifacts'`, required, no `?`, no default — the identical shape `FabricNodeOptions` took in 14-03, for the identical reason. A browser node is not a lesser node, and *"the tab is only the demo"* is precisely the reasoning that would have put the hole here instead of in the Node tier.

`TabApi` is deliberately **stricter** than the option it sits over:

| Surface | Anchors | Record |
|---|---|---|
| `BrowserNodeOptions` | list, `[]`, or the named opt-out | — |
| `TabApi.start` | list, **or nothing → the demo's committed authority** | — |
| `TabApi.runJob` | — | **required** |

There is no value a page or a harness can pass through `window.o2` that yields a tab resolving bare CIDs. The escape hatch belongs to whoever constructs a node in TypeScript and has written down that they want one; it is not part of the tab's contract.

### The composition

```ts
const counter = new CountingExecutor(guardSovereignty(provenance(worker), sovereignty))
```

`provenance` **innermost**, with nothing between it and the executor that reaches `WebAssembly.instantiate`; sovereignty **outside** it, so a tab that may not decrypt an owner's data says *that* whatever module was named. Both orderings mirror `fabric-node.ts` and both are decisions, not accidents.

### `autoStart` pins by omitting

`api.autoStart` passes **no** `trustAnchors` key to `api.start` and must not grow one. A page reached by discovery therefore inherits the demo's authority through `api.start`'s own `?? [KERNEL_TRUST_ANCHOR]`, and there is no parameter through which whatever found the page could hand it a different build authority.

## The inherited open item, resolved rather than costed a fourth time

14-CONTEXT.md Risk 1 — *`packages/demo/src/kernel.ts`'s bundle-embedded bytes have no signed record, and DET-03 has no public-path exemption for them* — was deferred by waves 1, 2 and 3. **It is closed, and it needed no exemption**, because the premise was wrong. The record already covers those bytes, by a two-link chain that `packages/demo/src/kernel-build.node.test.ts` asserts and this plan re-ran (8 passed):

| Link | Assertion | Line |
|---|---|---|
| the bundled base64 decodes to the committed binary | `expect([...kernelBytes]).toEqual([...committed])` | `:43` |
| the committed record vouches for that binary's CID | `expect(KERNEL_RECORD.cid.toString()).toBe(cid.toString())` where `cid = await new MemoryBlockstore().put(committed)` | `:75-76` |

So `cid(kernelBytes) === KERNEL_RECORD.cid`, and what was actually missing was not a record but a **dispatch**: `runColouring` put the bytes and named the resulting CID with nothing attached. It now passes `moduleRecord: KERNEL_RECORD`.

**Read directly, not only inferred.** `two-tabs.e2e.test.ts`'s third case hands `kernelBytes` through `putModule` and asserts `expect(moduleCid).toBe(KERNEL_RECORD.cid.toString())` — in a real browser tab, through the real `IdbBlockstore`, which is the store `runColouring` uses. The chain holds on the browser path and not merely in a Node test.

**What this does not close.** The demo's anchor and the artifact it vouches for ship in the same bundle, so this proves nothing to somebody who does not already trust the repository — `kernel-record.ts`'s own header says so, and that limit is unchanged. DET-03's public path now resolves through a signed mapping; it does not acquire an authority independent of the code that ships it.

## Where the plan was wrong, measured rather than reasoned

### 1. `worker ?? new WasmExecutor(...)` does not exist

The plan's `<interfaces>` block quotes the composition as

```ts
guardSovereignty(worker ?? new WasmExecutor({ nodeId, blockstore }), sovereignty)
```

and spends a paragraph of `<action>` on guarding the `??` as a whole rather than one arm. That expression is gone: `createWorker` became required and the main-thread fallback was **deleted outright** — `BrowserNodeOptions.createWorker`'s doc records why, and `browser-node-contract.node.test.ts` asserts `occurrences(BROWSER_NODE, 'new WasmExecutor(') === 0`. The real line was `new CountingExecutor(guardSovereignty(worker, sovereignty))`, and `worker` is the only arm there is.

The instruction's *point* was still served — guard the executor that reaches instantiation — and the plan's `## What this plan does not measure` entry about "the factory-less arm exercised by no test" is now moot rather than accepted: there is no such arm.

### 2. `EXEMPT_PATHS` needed the entry after all, and 14-03 named the condition

14-03 predicted an entry might be unnecessary "if that plan references `BrowserNodeOptions['trustAnchors']` as `seed-server.ts` does". It cannot: `BrowserNodeOptions` lives in `packages/browser`, which does not depend on `packages/node` and must not — an indexed access would create that dependency in a package the purity rules keep free of the backbone. The union is written out longhand, and the exemption states that reason rather than restating `fabric-node.ts`'s.

### 3. Two construction sites the plan's file list omitted

Neither `packages/browser/src/browser-node-contract.node.test.ts` (1 site) nor `packages/browser/src/start-unwind.browser.test.ts` (5 sites) is in the plan's `files_modified`, and nothing compiled without them — six `TS2741`s. Both now state anchors they never consult, with the reason written down. `start-unwind` reads one named constant, `UNWIND_ANCHORS`, exactly as its Node twin does, so five sites cannot drift apart.

### 4. `packages/browser/src/index.ts` also had to change

Not in the plan's file list either. `TabNameRecord` has a caller outside its package — the e2e harnesses in `packages/node` — and a hand-written object literal there would drift from `runJob`'s parameter silently, which is the exact failure `tab-api.ts`'s own header says the file exists to prevent.

## Measurements

Every reading below was taken on this worktree. None is derived.

### The emptied-anchors probe now fails — which is the point

14-03 measured both demo-tier anchor sets being replaced with `[]` and **all 15 e2e tests still passing**, i.e. neither set was ever consulted. The equivalent probe against this plan's work — `api.start`'s default replaced with `[]`, which is now the demo tier's only anchor decision:

| `packages/browser/demo/main.ts` default | `colouring-demo.e2e.test.ts` |
|---|---|
| `options.trustAnchors ?? [KERNEL_TRUST_ANCHOR]` (as shipped) | **6 passed** |
| `options.trustAnchors ?? []` (planted) | **1 failed** — `run.complete` expected `true`, received `false` |
| restored, `cmp` silent against a baseline copy | **6 passed** |

The demo tier's anchor set is consulted on every cube of every run.

### The guard was already refusing before the tests were adapted

Task 3's RED, taken by running the two e2e files **unedited** against the composition Task 1 had landed — jobs dispatching bare CIDs at tabs pinned to the demo's anchor:

```
Test Files  2 failed (2)
     Tests  3 failed | 4 passed (7)
```

GREEN, after both files sign their fixtures: **9 passed (9)** — the two pre-existing job tests plus two new refusal cases, with every pre-existing assertion in both files unedited.

### The composition line is what the refusal cases read

`provenance(...)` deleted from `browser-node.ts`'s composition, everything else untouched:

| Assertion | With the composition | With it deleted |
|---|---|---|
| `two-tabs.e2e.test.ts` — "refuses a job whose record no tab pinned" | pass | **fail** — `expected true to be false` |
| `two-tabs.e2e.test.ts` — "refuses the demo's own genuine record" | pass | **fail** — `expected true to be false` |
| `trust-anchors.node.test.ts` (whole file) | 20 passed | **20 passed** |

The third row is the one worth keeping. The cheap scan stays green because `guardModuleProvenance(` is still present in the file — inside the `provenance` const it now no longer applies to anything. That is exactly what `trust-anchors.node.test.ts`'s own comment claims (*"a present call site is not a working one"*), turned from a claim into a reading: the scan catches a deleted call, the e2e catches the deletion that left the call behind, and neither substitutes for the other.

Restored by `cp` from a baseline copy; `cmp` silent, `git status --short` clean. **`git clean`, `git checkout --`, `git restore` and `git reset` were not used on any source file during this plan.**

### An existing assertion caught this plan's comment

The composition comment quoted the plan's stale expression verbatim, including `new WasmExecutor(`. `browser-node-contract.node.test.ts` counts that string as raw text across the whole file and requires zero:

```
AssertionError: expected 1 to be +0
 ❯ packages/browser/src/browser-node-contract.node.test.ts:74:60
```

Its own comment reads *"Zero **constructions**, not zero mentions"* — the intent is right and the instrument cannot tell the two apart. **The assertion was not weakened.** The comment was reworded to make the same point without spelling the call, and now says why. This is the hazard 14-03 hit from the other side, where a scan named its own query.

## Verification

| Check | Result |
|---|---|
| The resolver reads *this* worktree | `@o2/core -> .../agent-a6371f06fe86e0300/packages/core/src/index.ts`; `typescript -> /Volumes/.../o2.services/node_modules/…` |
| Baseline `npx tsc --noEmit` on the untouched tree, before any edit | exit 0 |
| `npx tsc --noEmit` (whole repository, final) | **exit 0** |
| `npx vitest run --project node` (86 files) | **1280 passed, 18 skipped, 0 failed** |
| `npx vitest run --project browser packages/browser` (chromium + firefox + webkit) | **342 passed (30 files)** |
| `npx vitest run --project e2e` (all 7 files) | **38 passed (7 files)** — was 36 before the two new cases |
| `vocabulary` + `purity` + `trust-anchors` scans, run **after** committing | **58 passed** |
| `packages/demo/src/kernel-build.node.test.ts` | 8 passed — the chain the inherited item turned on |
| Assertions weakened | **none** — see below |
| `packages/node/src/signed-artifact.node.test.ts` | **not touched** — 14-05 owns it; it does not exist on this worktree |
| `STATE.md` / `ROADMAP.md` | **not touched** — the orchestrator owns those writes |

Host load was between 6.5 and 12.9 on 8 cores throughout (plan 14-05 running in parallel), read with `uptime` before every timing-sensitive run. No timing bound was set from a number that was not measured here; `background-tab.e2e.test.ts`'s existing `throttledWithinMs < 1_000` passed unedited at load 8.72.

### No assertion was weakened

Every deleted line across all nine modified files, in full:

```
$ git diff 04c2b22..HEAD -- <the nine files> | grep '^-' | grep -v '^---'
-import { DEFAULT_MAX_CONCURRENT_TASKS, LocalCapacity, guardSovereignty } from '@o2/core'   (import, re-added wider)
-import type { NodeSovereignty } from '@o2/core'                                            (import, re-added wider)
-    const counter = new CountingExecutor(guardSovereignty(worker, sovereignty))             (guard inserted)
-  start(options: { relayAddrs: string[]; blockstoreName: string }): Promise<string>         (gained an optional field)
-  runJob(options: {                                                                          (gained a required field)
-    moduleCid: string
-        moduleCid: CID.parse(options.moduleCid),                                            (record added beside it)
-  return { relayAddrs: [], createWorker }                                                   (anchors added)
-      const node = await BrowserNode.start({ relayAddrs: [], createWorker, … })             (anchors added, ×5)
-const GUARDED_CONSTRUCTION_SITES: readonly string[] = ['packages/node/src/fabric-node.ts']  (array gained a second entry)
- * One entry today. Plan 14-04 Task 1 adds … as the second, …                               (doc, now stale — rewritten)
- * *Not `packages/browser/src/browser-node.ts` either — yet.* …                             (doc, now stale — rewritten)
-      return window.o2.start({ relayAddrs: [address!], blockstoreName: store! })            (anchors added, ×3)
-    [relayAddr, `o2-${name}`],                                                              (arg tuple gained the anchor)
-        window.o2.runJob({ moduleCid: cid!, peerIds: [peer!], … })                          (record added, ×2)
```

Imports re-added wider, construction calls that gained a field, an array that gained an entry, and two doc comments whose text said "14-04 will add this" and had to stop saying so once it had. **No `expect` was changed, relaxed or removed anywhere**, and the two comment rewrites are in `trust-anchors.node.test.ts`'s prose, not its assertions.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] The worktree had no `node_modules`**

Built a symlink farm: 184 third-party entries from the main install, `@o2/*` repointed at this worktree's `packages/*`. Proved rather than assumed — `createRequire(...).resolve('@o2/core')` reports the worktree path while `typescript` and `vitest` report the main install — and the baseline `tsc --noEmit` was run on the untouched tree before any edit. No tracked file changed (`node_modules/` is gitignored; `git status --short` was empty afterwards).

**2. [Rule 3 — Blocking] Six construction sites in two files the plan's list omitted**

`browser-node-contract.node.test.ts` (1) and `start-unwind.browser.test.ts` (5). Nothing compiled without them. Commit `300b2cf`.

**3. [Rule 2 — Missing critical] `TabNameRecord` exported from `@o2/browser`**

Not in the plan. Without it the e2e harnesses — in a different package — would hand-write the object literal `runJob` requires, and the two would drift with no compile error. That is the failure `tab-api.ts` exists to prevent, applied to the type this plan added to it.

**4. [Rule 1 — Bug] A comment that named a constructor**

Described in full above. Commit `4265600`.

### Corrections to the plan's stated facts

Four, all in *Where the plan was wrong*. None changed the plan's structure, scope or intent.

### Out of scope, logged not fixed

`packages/node/src/transport-bounds.node.test.ts`'s retained-bytes bound failed twice at host load ~12.4 and passed at 8.72 and 7.70, and passed in the final 86-file sweep. It imports `@o2/libp2p`, `@o2/core` and `@o2/net` — **this plan modifies no file in any of the three**. Logged to `deferred-items.md` with all four readings.

## What this plan does not measure

Stated in these words because unmeasured is not met.

- **`BrowserNode.start` still has no unit test.** It builds a real libp2p node and dials a relay. The composition is proved only end to end. A defect that broke it in a way both e2e runs tolerated would not be caught — though the deletion probe above narrows that: the specific defect of removing the guard *is* caught.
- **"Refused before `WebAssembly.instantiate`" is not observed in a browser.** Nothing in a page can watch that call. The property is carried by `module-provenance.test.ts`'s call counters and by 14-05's never-fetched module block; neither runs in a browser and this plan claims neither.
- **`runColouring`'s record-versus-bytes mismatch branch is unmeasured.** No test executes it, and its own comment says so. Drift itself is detected by `kernel-build.node.test.ts`; what is unread is the *wording* this throw would produce and the fact that it fires before dispatch rather than after.
- **No assertion reads a tab's pinned anchor list, because nothing exposes one.** The replacement property is measured through its consequence — a genuinely-signed demo record refused by a harness-pinned tab — which proves the demo anchor is *absent*, not that the set holds exactly one entry. Adding a reader would put node configuration on `window.o2`.
- **`bin/seed.ts`'s printed anchors line is still unasserted**, unchanged from 14-03 and not this plan's to fix.

## Requirements

`requirements-completed` is **empty**, deliberately. DET-03 and DATA-08 are now wired on both tiers and on the demo's public path, but 14-05 is the plan that reads them across a real process boundary and plants the deletions that prove the readings are not vacuous. Marking them here would assert a verification this plan did not perform. The browser tier's half is done; the phase's own proof is not.

## Known Stubs

None. Every export this plan adds is reached on a live path: `trustAnchors` is read by `BrowserNode.start` and observed through three e2e cases plus the emptied-anchors probe, `TabNameRecord` crosses `page.evaluate` in two files, `TabJobReport.failures` is asserted both empty and non-empty in the same file, and `KERNEL_RECORD` is dispatched by every `runColouring` call the demo makes.

## Threat Flags

None. This plan opens no network endpoint, no auth path, no file access pattern and no schema at a trust boundary. It removes surface: every browser-tier executor now refuses a module no pinned anchor vouched for, and the tab API gained no way to switch that off. `TabApi.start`'s new `trustAnchors` parameter is a list of public keys supplied by whoever already controls the page.

## Next Plan Readiness

- **14-05** owns `packages/node/src/signed-artifact.node.test.ts`, which this plan did not touch and which does not exist on this worktree. Its Task 2 gate runs `trust-anchors.node.test.ts`; that file now has **20** tests and its `GUARDED_CONSTRUCTION_SITES` array has **two** entries. If 14-05 planted the deletion of `fabric-node.ts`'s call, it should expect one failure from that array, not two — deleting `browser-node.ts`'s `provenance(...)` application does **not** fail the scan, as measured above.
- **The wave-3/wave-4 window 14-03's plan warned about is closed.** `browser-node.ts` names the opt-out literal and carries its exemption, in the same commit.
- **Phase 15** edits two `RemoteExecutor` construction sites in `demo/main.ts`; neither is near this plan's changes, which are in `api.start`, `runColouring`'s module put, and `runJob`'s spec.
- **Phases 15, 17, 21** share `browser-node.ts`'s options block and executor composition. The field and the wrapper were added as separate lines and nothing was restructured.

## Self-Check: PASSED

All nine modified files exist on disk and appear in `git diff --name-only 04c2b22..HEAD`. All four commit hashes — `300b2cf`, `8c29c5c`, `58dfc80`, `4265600` — resolve in `git log`. `packages/browser/src/browser-node.ts` contains `guardModuleProvenance(` and `provenance(worker)`; `packages/browser/demo/main.ts` contains `KERNEL_TRUST_ANCHOR` and `moduleRecord: KERNEL_RECORD`; `packages/node/src/trust-anchors.node.test.ts` names `packages/browser/src/browser-node.ts` in both of its arrays. `packages/node/src/signed-artifact.node.test.ts` is absent from this worktree and from every commit above. `STATE.md` and `ROADMAP.md` are unmodified.
