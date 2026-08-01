---
phase: phase-15-capability-chained-dispatch
plan: 03
subsystem: auth
tags: [capability-chain, authorizer, node-factory, browser-factory, sovereignty, auth-03, data-09]

requires:
  - phase: phase-15-plan-01
    provides: "audienceKeyOf (@o2/libp2p) and authorizeCapability (@o2/net) — the two mechanisms this plan wires"
  - phase: phase-15-plan-02
    provides: "RemoteExecutor's required third argument and CapabilitySupplier, exported from @o2/net's only entry point"
  - phase: phase-11
    provides: "the explicit `authorize` hook and the named-sentinel convention this plan burns down"
  - phase: phase-14
    provides: "trustAnchors on both factories, and the composition lines M27/M28 plant at — neither of which moved"
provides:
  - "NodeSovereignty.ownerKey — AUTH-03's pinned trust anchor, on the one record egress, guardSovereignty and the authorizer all read"
  - "a real authorize hook on both node factories; neither production call site says 'serves-unauthenticated' any more"
  - "bin/agent.ts --owner-key <hex>, so verifyChain is reachable from a production entry point"
  - "packages/node/src/capability-fixture.ts — four chain shapes and a per-task supplier for the node tier, deliberately not barrel-exported"
  - "DATA-09's production-path proof restructured onto the one node shape that can still reach guardSovereignty"
affects: [phase-15-plan-04, phase-17-enrollment, phase-19-browser-harness, phase-22-reachability]

tech-stack:
  added: []
  patterns:
    - "a burn-down count to zero is only read next to a positive count of what replaced it"
    - "a refusal assertion names which refusal arrived, not merely that one did, when two stacked gates both answer plausibly"
    - "a source comment does not spell out the literal a substring-counting test greps for"

key-files:
  created:
    - packages/node/src/capability-fixture.ts
    - .planning/phases/phase-15-capability-chained-dispatch/deferred-items.md
  modified:
    - packages/core/src/executor/sovereignty-guard.ts
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/bin/agent.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/src/egress-manifest.node.test.ts
    - packages/node/src/egress-refusal.node.test.ts
    - packages/node/src/sovereignty-placement.node.test.ts
    - packages/node/src/named-refusal.node.test.ts
    - packages/node/src/sovereign-block-refusal.node.test.ts

key-decisions:
  - "ownerKey goes on NodeSovereignty rather than beside it, because ownerId and ownerKey name the same owner and two independently-defaulted copies drift"
  - "The audience is derived once, eagerly, before serveAgent — so the ordering claim is 'no node serves with an underived audience', not 'a bad identity stops the start', which is unmeasured and unmeasurable through either factory"
  - "The browser tier is wired identically despite having no behavioural test, because leaving it on the sentinel is the two-disjoint-capability-sets shape whose deletion fabric-node.ts records"
  - "Fixture seeds are 111/112/113, not the plan's 41/42/43, which fabric-node.node.test.ts already holds"
  - "The unpinned-node assertion names the refusal text, because the two stacked refusals are otherwise indistinguishable at the requestor"

patterns-established:
  - "When two precedence steps produce refusals that satisfy the same assertion, the test names the step — measured by planting the deletion and observing a pass"

requirements-completed: [AUTH-03, DATA-09]

duration: 30min
completed: 2026-07-31
---

# Phase 15 Plan 03: Wiring Both Factories — Summary

**`verifyChain` is now called by a node started from `bin/agent.ts`, on every sovereign dispatch it receives, against a key that node was configured with through `--owner-key` and an audience it derived from its own libp2p identity. Neither production factory says `'serves-unauthenticated'` any more.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-31T17:35 (worktree spawn); first commit 17:39
- **Completed:** 2026-07-31T18:05
- **Tasks:** 3 of 3
- **Files created/modified:** 13 (2 created, 11 modified)

## Task Commits

| Task | Commit | What |
|---|---|---|
| 1 (RED) | `19412e5` | `test(15-03): the sentinel neither factory has stopped saying yet` |
| 1 (GREEN) | `68cdd4b` | `feat(15-03): give both factories a real authorizer and a key to verify against` |
| 2 (RED) | `7daf862` | `test(15-03): the three node shapes DATA-09 and AUTH-03 now need between them` |
| 2 (GREEN) | `457556a` | `feat(15-03): the node tier's four chain shapes and its per-task supplier` |
| 3 | `1ef728a` | `test(15-03): make three suites satisfy the new precondition without changing what they measure` |
| 3 (extra) | `be28a51` | `test(15-03): the two files the plan did not know this refusal breaks` |
| — | `46d28b3` | `test(15-03): name which refusal the unpinned node gave, not merely that it gave one` |

Both RED commits were watched failing first, on a resolver proven to read this worktree.

## Accomplishments

- **Both factories install a real authorizer, and the two counts that say so are paired.** `serve-agent-hooks.node.test.ts` reads `'serves-unauthenticated'` at 0 and `authorizeCapability(` at 1 for each, because a zero on its own is equally produced by deleting the `serveAgent` call.

- **`bin/agent.ts --owner-key` reaches a running process across a real boundary.** `sovereignty-placement.node.test.ts` and `egress-refusal.node.test.ts` both spawn alice with the flag and both reach `agreed` on a sovereign shard — which a spawned process cannot do unless the flag arrived, was threaded into `NodeSovereignty.ownerKey`, and the chain the submitter minted verified against it.

- **DATA-09 still has a production-path proof, and it is stronger than the one it replaced.** Four dispatches over three nodes: unpinned refuses at the authorizer, pinned-but-uncleared reaches `guardSovereignty` and refuses there naming itself, pinned-keyed-cleared accepts, and that same node refuses with `no capability chain supplied` when the chain is withheld. The fourth is the control that stops "the cleared node accepts" being explained by an authorizer that accepts everything.

- **The audience is derived from the node's own identity, once, before `serveAgent`.** No enrollment, no key file, no protocol request — the requestor computes the byte-identical key from the `nodeId` string it already holds.

- **No existing assertion was weakened, reworded or deleted.** One was *strengthened* (see Deviation 3). No refusal string was reworded to make anything pass.

- **`guardSovereignty` is byte-for-byte unchanged in behaviour** and its own tests passed untouched throughout — the new field is read by the authorizer and by nothing in that file.

- **No dependency was added.** `package.json`, every `packages/*/package.json` and `package-lock.json` are byte-identical to the base commit; no `npm install` was run in the shared checkout. This is why `capability-fixture.ts` derives public keys through `delegate(...).issuer` rather than `@noble/curves`, which is not a declared dependency of `@o2/node`.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole repository) | **exit 0** |
| `vitest --project node` (whole project) | 91 files, **1316 passed**, 18 skipped, **0 failed** |
| `vitest --project browser` (whole project) | 195 files, **2892 passed** (chromium + firefox + webkit) |
| `serve-agent-hooks.node.test.ts` | passed — both burn-downs at 0, both positives at 1 |
| `mutation-guard.node.test.ts` | passed — **M27/M28 still describe the source**; neither composition line moved, so `mutation-ledger.ts` needed no edit |
| `purity.node.test.ts` | passed — `@o2/core` and `@o2/net` stayed portable |
| `vocabulary.node.test.ts` | passed, run **after** committing so `git ls-files` saw the new files |
| `grep -c "'serves-unauthenticated'"` both factories | **0 and 0** |
| `grep -c "authorizeCapability("` both factories (positive control) | **1 and 1** |
| `grep -n capability-fixture packages/node/src/index.ts` | no hit |
| `grep -n fabric-node packages/node/src/index.ts` (positive control) | 2 hits — the file grepped really is the barrel |
| file deletions vs. base | **none** |
| `package.json` / `package-lock.json` / `packages/*/package.json` | unchanged |
| `.planning/STATE.md`, `.planning/ROADMAP.md` | **untouched** |
| scoped diff vs. base | 13 paths, 734 insertions, 78 deletions — nothing outside them |

**Resolver proof (the inherited trap).** The worktree has no `node_modules`, and symlinking the main install wholesale resolves `@o2/*` back to the main checkout, so `tsc` and `vitest` would report clean without reading a line of this work. A farm was built — 181 third-party entries symlinked at the main install, all 8 `@o2/*` repointed at this worktree's `packages/` — and proved before any test was trusted:

```
OK   @o2/core   -> …/worktrees/agent-aa32b793338c9aac0/packages/core/src/index.ts
OK   @o2/net    -> …/worktrees/agent-aa32b793338c9aac0/packages/net/src/index.ts
…all 8 OK…
     vitest/package.json     -> /Volumes/…/o2.services/node_modules/vitest/package.json
     typescript/package.json -> /Volumes/…/o2.services/node_modules/typescript/package.json
FARM PROVEN
```

Every vitest run reported `RUN v4.1.10 /Volumes/…/worktrees/agent-aa32b793338c9aac0` as its root, and every run used `--project node` or `--project browser`. Both RED tests were watched failing on that path — the second as `Cannot find module './capability-fixture.ts' imported from …/worktrees/agent-aa32b793338c9aac0/packages/node/src/fabric-node.node.test.ts`.

## The four files this breaks — the plan said four, the run found six

Observed by running `--project node` whole after Task 1, before any repair. Recorded as read:

| File | Tests red | How it failed |
|---|---|---|
| `fabric-node.node.test.ts` | 1 of 13 | `expected 'unauthorized: no pinned owner key for…' to contain '12D3KooW…'` |
| `egress-manifest.node.test.ts` | **3** of 4 | one `expected [] to include 'bafyrei…'`, two `expected 'insufficient' to be 'agreed'` |
| `egress-refusal.node.test.ts` | 1 of 1 | `expected 'insufficient' to be 'agreed'` — **at the control, `:319`** |
| `sovereignty-placement.node.test.ts` | 1 of 1 | `expected 'insufficient' to be 'agreed'` |
| **`named-refusal.node.test.ts`** | 1 of 2 | **not enumerated anywhere in the phase.** `expected 'unauthorized: no pinned owner key…' to contain 'bafyrei…'` |
| **`sovereign-block-refusal.node.test.ts`** | 1 of 1 | **not enumerated anywhere in the phase.** `expected 'insufficient' to be 'agreed'` |

**15-CONTEXT.md Risk 2 was right, and the failure mode was measured rather than reasoned.** `egress-refusal.node.test.ts` reported *exactly one* failing assertion and it was the control at the bottom. Every assertion about the leaking job — the shard stalls at alice, exactly one failure, `other` never tried, alice still alive — **passed, for the wrong reason**: the job did fail, at the authorizer rather than at the tap. Had that file carried no control, this phase would have deleted DATA-05's cross-process proof and left a green suite behind. That observation is now written into the file's own header, and the control's comment names verification as a fifth alternative explanation it rules out.

## Mutation testing — observed, not predicted

Five planted, run, and restored by `cp` from a scratch baseline in `/tmp`, **outside** the working tree, each restoration confirmed byte-identical with `cmp` **and** against `HEAD` via `git diff --stat`. No `git checkout`, `restore`, `stash`, `reset` or `clean` was used at any point after the sanctioned startup base correction — several agents share this checkout.

| # | Mutation | Plan predicted | **Observed** |
|---|---|---|---|
| A | substitute `'serves-unauthenticated'` back at `fabric-node.ts`'s `serveAgent` | "the two `FABRIC_NODE` assertions go red, and every refusal case Task 2 builds goes red" | **2 tests red.** The burn-down (`expected 1 to be +0`) and the DATA-09/AUTH-03 block. The *manner* is the finding: the unpinned node's reason reverted to `'sovereignty violation: node 12D3KooWK…'` — the pre-Phase-15 text the test's own comment warns must not be restored by rewording. (One `it`, so it stops at its first failing assertion rather than reporting all four dispatches.) |
| B | delete `ownerKey` from `NodeSovereignty` | "`tsc --noEmit` fails at both factories and at `bin/agent.ts`; a compile-time guard, not a test" | **11 `tsc` errors, exit 1**, in 6 files: both factories (`TS2339`), and `egress-manifest` ×3, `fabric-node.node.test` ×2, `named-refusal`, `sovereign-block-refusal` (`TS2353`). `bin/agent.ts` did **not** error — its conditional spread reads `values['owner-key']`, not the interface. Reported as a compile-time guard, not a test. |
| C | delete `'owner-key'` from `bin/agent.ts`'s `parseArgs` options | "`sovereignty-placement` and `egress-refusal` go red" | **Both red, exactly as predicted — plus 2 `tsc` errors** the plan did not name (`TS7053`, the conditional spread indexing a key `parseArgs` no longer types). So this one is guarded twice. |
| D | delete the `ownerKey === undefined` precedence step in `capability-authorizer.ts` | "the `defaultNode` case goes red" | **It did not.** 1 `tsc` error and 1 red in `capability-authorizer.test.ts` (15-01's), but `fabric-node.node.test.ts` **passed**. See Deviation 3 — the assertion was strengthened and the mutation re-planted, after which it fails as `expected 'unauthorized: task names owner alice,…' to contain 'no pinned owner key'`. |
| E | give `browser-node.ts`'s authorizer wrong arguments — `ownerId: sovereignty.ownerKey`, `ownerKey: sovereignty.ownerId`, `audience: 'deadbeef'`, `now: () => 0` | "only the substring count moves, and only if the literal disappears" | **Nothing turned red at all.** `tsc` exit 0. `serve-agent-hooks.node.test.ts` 6/6 passed. `vitest --project browser packages/browser` **345/345 passed in three engines.** A browser factory verifying chains against a hardcoded 8-character audience, with the owner id and owner key transposed and a clock frozen at zero, is invisible to every instrument in this repository. |

**Mutation E is the measurement, not a mutation caught,** and it is reported as such. It is a deliberately *stronger* mutation than the plan's (which deleted the call and would at least have moved the substring count) precisely because the interesting question is whether anything checks the arguments. Nothing does. That reading is written verbatim into `browser-node.ts`'s own comment at the call site and into `serve-agent-hooks.node.test.ts`'s `BROWSER_NODE` row, so the count cannot be cited as evidence the browser tier works.

## Corrections — every `file:line` was re-grepped before being relied on

The phase-level warning was correct again. Reported per the standing rule that a correction living in one SUMMARY reaches no sibling plan — **Plan 15-04 should re-grep rather than trust either copy.**

| Plan said | Actually | Load-bearing? |
|---|---|---|
| **"no test in the repository constructs a `BrowserNode` at all"**, and `grep -rnF 'BrowserNode.start(' packages` returns the single line `demo/main.ts:169` | **False.** That grep returns **four** lines: `packages/browser/src/start-unwind.browser.test.ts:157`, `:170`, `:195`, and `packages/browser/demo/main.ts:230`. The last two *start the factory to success* with `relayAddrs: []`, and were measured running in three engines today (3 files, 15 tests). | **Yes, and the most important one.** The plan instructed these exact words into shipped source. They were not written; the corrected reason was. See below. |
| `grep -rn 'BrowserNode.start' packages` returns **four** lines, three of them prose at `net/src/sovereign-egress.ts:22`, `demo/main.ts:309`, `fabric-node.ts:399` | Returns **twelve**. None of the three named locations is among them — `sovereign-egress.ts` contains no such string at all. | Yes — the plan asked for this grep's output to be reported |
| the demo labels both its jobs `'public'` at `demo/main.ts:315` and `:557` | **`:427` and `:630`** | Minor; the claim itself holds |
| `fabric-node.ts:344-355` / `:411-425` are the two edit sites | **`:595` / `:704-732`** (pre-edit numbering) | Yes |
| `browser-node.ts:213-220` / `:264-278` are the mirrored pair | **`:405` / `:546-555`** (pre-edit numbering) | Yes |
| `browser-node.ts:207-210` is where `relayAddrs` are dialled | **`:391`**; the listen list is `:378` | Yes — cited in shipped source, so the shipped comment carries the corrected numbers |
| `bin/agent.ts:22-55` is the flag block, usage at `:39`, sovereignty object at `:47-54` | **`:23-54`**, usage at **`:58`**, sovereignty object at **`:71-78`** (pre-edit) | Minor |
| `sovereignty-guard.ts:34-39` is `NodeSovereignty` | **`:34-39`** — correct | — |
| `serve-agent-hooks.node.test.ts:27-35` / `:37-45` are the two assertions | **`:43-56` / `:58-70`** (pre-edit) | Minor |
| `fabric-node.node.test.ts:228-264` is the DATA-09 block | **`:274-319`** | Yes |
| `egress-refusal.node.test.ts:216` / `:255` / `:228-239` | **`:276` / `:319` / `:289-291`**; the file is 325 lines, not 271 | Yes |
| `sovereignty-placement.node.test.ts:136` is the spawn, `:152-154` the executors | **`:177` / `:193-195`** | Yes |
| `egress-manifest.node.test.ts` alice nodes at `:107`, `:241`, `:310` | **`:115`, `:249`, `:318`** | Yes |
| `capability.test.ts:12-41` and `:165-174` | **correct** — `:12-15` `keypair`, `:28-30` `directChain`, `:33-41` `delegatedChain` | — |
| use fixture seeds **41, 42, 43** | **Collides.** `fabric-node.node.test.ts:56-57` — this module's first importer — already declares `publisher = keypair(41)` and `impostor = keypair(42)`, under a comment claiming they are distinct from every other fixture key in the repository. Used **111/112/113**, re-grepped free. | **Yes.** See Deviation 1 |

**Re-verified correct** and worth recording: `capability.ts:92` is the `broken-link` kind, `:107-108` its text, `:162-167` where it is reached, `:104` exactly `'no capability chain supplied'`, `:118` the `not-delegable` text, `:193-198` the delegate check; `capability-authorizer.ts` is 108 lines with the four-step precedence intact; `purity.node.test.ts:25/34` show `packages/node` in neither `PORTABLE` nor `DUAL_TARGET`, so the fixture is unconstrained; `packages/core/src/executor/fixtures.ts` is the test-only-module-beside-production precedent; `grep -rln sovereign packages/browser/src packages/browser/demo` returns `browser-node.ts` alone; neither factory passes `privateKey` to `createLibp2p`, so `audienceKeyOf`'s throwing branches remain unreachable through both; `mutation-ledger.ts:613-639` (M27/M28) plants on `provenance(compute)` / `provenance(worker)`, **neither of which this plan moved**.

The phase-level warning's own table was re-verified and holds, with the pre-edit numbers now shifted by this plan's insertions.

## Decisions Made

- **The plan's words about the browser tier were not written into source, because they are false.** The plan's `<action>` specifies, "in these words", that no test constructs a `BrowserNode`. `start-unwind.browser.test.ts` constructs three and starts two to success in three engines. Shipping that sentence would have put a measurably false claim into a comment whose entire purpose is honesty about what is unmeasured. The **narrower and true** statement was written instead, and it survives the correction: a started `BrowserNode` listens on `['/p2p-circuit', '/webrtc']` alone after dialling the relays it was given, so with `relayAddrs: []` it has no address any peer can dial and nothing can deliver a frame to its `serveAgent` handler. The barrier is *dialability*, not *startability*. Both remedies the plan names are recorded unchanged.

- **`bin/bench.ts`'s two sentinels stay at 2, and the row now says why in the file.** Three production `serveAgent` sites, two burned to 0 and one not, reads as unfinished work unless the reason is beside it: `bench.ts` dispatches `label: 'public'` shards exclusively, so `authorizeCapability`'s first precedence step returns `null` regardless, and installing one would add per-dispatch cost to the published curves in exchange for a branch that can never refuse.

- **Two clocks, sized after measuring the host.** `uptime` read a 1-minute load average of **3.60** at session start and **10.95** at the end. No new timing bound was introduced by this plan — every timeout touched is pre-existing (`60_000` on the DATA-09 block, `120_000` on `egress-refusal`), and the framework's bound remains strictly the larger of each pair. Nothing here measures wall-clock.

- **The fixture is not barrel-exported, and the check is paired.** `grep -n capability-fixture packages/node/src/index.ts` returns nothing — which a renamed or relocated barrel would also produce — so it is read next to `grep -n fabric-node`, which returns two hits and proves the file being grepped is the barrel.

- **A source comment must not spell out the literal a substring test greps for.** The first draft of `browser-node.ts`'s call-site comment quoted `occurrences(BROWSER_NODE, 'authorizeCapability(') === 1` verbatim, which made the count read **2** and failed the assertion it was describing. The name is now described rather than written, with a note saying why — the same rule `browser-node-contract.node.test.ts` and `trust-anchors.node.test.ts` already write down for their own matchers.

## Deviations from Plan

Four, all reported rather than silently absorbed. None required a checkpoint.

**1. [Rule 1 — bug] The plan's fixture seeds collide with the file that imports the fixture**
- **Found during:** Task 2, on the mandated re-grep.
- **Issue:** The plan specifies seeds 41, 42 and 43, "distinct from `capability.test.ts`'s 1/2/3/9". They are — but `fabric-node.node.test.ts:56-57`, this module's first importer, already holds `publisher = keypair(41)` and `impostor = keypair(42)`. Two fixtures sharing a seed share a key, which is exactly the failure the plan's own justification for distinct seeds describes.
- **Fix:** Used 111/112/113, verified free by grep across all `fill(n)` / `keypair(n)` sites. The comment records the collision and the re-grepped list of taken seeds so the next reader does not re-derive it.
- **Files:** `packages/node/src/capability-fixture.ts` — **Commit:** `457556a`

**2. [Rule 3 — blocking issue] Two more files break than the phase enumerated**
- **Found during:** the whole-project `--project node` run after Task 3's three named files were green.
- **Issue:** 15-CONTEXT.md and the plan both enumerate four breaking files. `named-refusal.node.test.ts` and `sovereign-block-refusal.node.test.ts` also dispatch sovereign work through an in-process `FabricNode` and both went red on `unauthorized: no pinned owner key for alice`. Neither appears in any file list, count or criterion in this phase.
- **Fix:** Repaired the same deliberate way — `ownerKey` on the serving node, `chainSupplierFor` on the executor, and a header paragraph in each stating that the chain is a precondition the file now satisfies rather than a property it covers, so neither is later cited as AUTH-03 evidence. `named-refusal`'s criterion-7 block issues a raw block request and reaches no authorizer, so that node is deliberately left unpinned and the header says so.
- **Files:** `packages/node/src/named-refusal.node.test.ts`, `packages/node/src/sovereign-block-refusal.node.test.ts` — **Commit:** `be28a51`

**3. [Rule 2 — missing critical functionality] The unpinned-node assertion could not tell two refusals apart**
- **Found during:** Mutation D, which the plan predicted would turn this case red and did not.
- **Issue:** A node started with no `sovereignty` option resolves to `ownerId: ''`. With the no-pinned-key step deleted, the authorizer falls through to the *next* step and answers `task names owner alice, but this node is pinned to owner ` — also prefixed `unauthorized`, also containing `alice`. The two assertions I had written were satisfied by both refusals, so the test could not distinguish the safe default from a wrong-owner refusal, and the plan's stated proof was untrue.
- **Fix:** Added `expect(unpinned.reason).toContain('no pinned owner key')`, with a comment recording the measurement that motivated it. Re-planted Mutation D afterwards and watched it fail as `expected 'unauthorized: task names owner alice,…' to contain 'no pinned owner key'`. **This is a strengthened assertion, not a weakened one.**
- **Files:** `packages/node/src/fabric-node.node.test.ts` — **Commit:** `46d28b3`

**4. [Reporting obligation, not a rule] The plan's browser-tier premise is false**
- The plan's Task 1 `<action>` instructs, "in these words", that no test in the repository constructs a `BrowserNode`. Measured today: `start-unwind.browser.test.ts` constructs three and starts two to success across chromium, firefox and webkit.
- **Action taken:** the false sentence was **not** written into shipped source. The corrected, narrower reason was — and it supports the same conclusion, so nothing the plan depends on changes. Recorded here and in `deferred-items.md` because the same stale claim sits in five other places.

**No existing assertion was weakened, reworded or deleted, and no refusal string was reworded to make anything pass.** The old DATA-09 assertions were replaced rather than softened: the `'sovereignty'` reading did not disappear, it moved onto `pinnedNode`, the one node shape that can still reach `guardSovereignty`.

## Files Created/Modified

- `packages/core/src/executor/sovereignty-guard.ts` — `NodeSovereignty.ownerKey` with the three-part doc; the module comment's AUTH-03 paragraph moved from future to present tense and now names the consequence (this guard's refusal is observable only on a pinned-keyed-uncleared node).
- `packages/node/src/fabric-node.ts` — `audienceKeyOf` and `authorizeCapability` imports; the eager audience derivation with its long statement of what is *not* measured; the real `authorize` argument; `FabricNodeOptions.sovereignty`'s doc corrected where it contradicted the code.
- `packages/browser/src/browser-node.ts` — the identical pair, plus the honest account of what checks it and what would.
- `packages/node/src/bin/agent.ts` — `--owner-key`, the usage line, the public-key rule, and the recorded `--trust-anchor` flag collision.
- `packages/node/src/capability-fixture.ts` (new, 244 lines) — four chain shapes and the per-task supplier; test-only, not barrel-exported.
- `packages/node/src/serve-agent-hooks.node.test.ts` — two burn-downs to 0 with paired positives; the `BROWSER_NODE` row's account of its own worth; `BENCH`'s permanence stated.
- `packages/node/src/fabric-node.node.test.ts` — the DATA-09 block rewritten as four dispatches over three nodes, plus the discriminating assertion.
- Five node-tier suites — owner keys and chains supplied, headers extended, nothing else moved.
- `.planning/phases/phase-15-capability-chained-dispatch/deferred-items.md` (new) — the five stale `BrowserNode.start` comments.

## Known Stubs

**None.** No hardcoded empty value flows to a UI, no placeholder text was introduced, no component was left without a data source.

The three `'serves-unauthenticated'` occurrences remaining in `bin/bench.ts` and the five `'dispatches-unauthenticated'` production sentinels from Plan 15-02 are explicitly **not** stubs and are documented as such in source: they are the correct, permanent value for public work, not placeholders awaiting wiring.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: auth-path | `packages/node/src/bin/agent.ts` | `--owner-key` is a new operator-supplied trust anchor. A wrong value refuses everything; there is deliberately no path by which it accepts more than it should. **This node cannot tell a correct pin from a wrong one** — it is configuration, and making the anchor itself verifiable is AUTH-01/02, Phase 17. Recorded in `NodeSovereignty.ownerKey`'s own doc. |
| threat_flag: auth-path | `packages/browser/src/browser-node.ts` | A new authorization decision point whose arguments **nothing in this repository checks** — Mutation E transposed the owner id and key, hardcoded the audience and froze the clock, and every test still passed. Not a new attack surface (it can only refuse more, never less), but a guard with no instrument behind it. |

## Issues Encountered

1. **The worktree resolver trap** (inherited warning, hit as described). Resolved by building a per-package farm and proving `@o2/*` resolution before trusting any test.
2. **Base commit correction at startup.** The worktree spawned at `c62bae5`, whose merge-base with the required base `f9df09a` was `bbb7b2a`. The working tree was clean, so the sanctioned startup `git reset --hard f9df09a` was applied. It was the only `git reset` in the session and it preceded all work.
3. **A comment that broke the test it was describing.** Quoting the grep needle verbatim took `occurrences(BROWSER_NODE, 'authorizeCapability(')` to 2. Caught immediately by the assertion; the fix is to describe the name rather than write it, and the comment now says so.
4. **`require.resolve('libp2p/package.json')` and `'@noble/curves/package.json'` throw `ERR_PACKAGE_PATH_NOT_EXPORTED`** — those packages' `exports` maps declare no such subpath. The farm proof resolves entry points instead, producing a clean positive reading rather than an informative failure.

## Next Phase Readiness

- **Plan 15-04 has everything it needs.** `capability-fixture.ts` exports all four chain shapes — `directChainFor`, `delegatedChainFor`, `undelegableChainFor`, `brokenLinkChainFor` — plus `chainSupplierFor`, `OWNER_ID` and `OWNER_KEY`. All three chains for criterion 3 are length 2 and all parse. `bin/agent.ts` takes `--owner-key`, and `sovereignty-placement.node.test.ts` and `egress-refusal.node.test.ts` are the two working examples of spawning with it.
- **15-04 Task 2's Mutation C is already answered, more strongly than planned.** Deleting the browser authorizer would at least move the substring count; transposing its arguments moves nothing at all. Re-planting the weaker version is still worth doing for the record, but the finding is above.
- **15-04 Task 3's roadmap edits: re-grep first.** 15-02 measured Phase 22's block at `:529-542` with criterion 1 at `:536` — **not** `:507-516`, which is Phase 20 — and Phase 15's goal line at `:413` with the checklist line at `:54`. Those were not re-measured by this plan.
- **`deferred-items.md` carries one finding 15-04 should not re-discover:** five shipped comments claim `BrowserNode.start` runs in no vitest project, and it runs in three engines. One of them is in `mutation-ledger.ts`, whose description text should agree with reality.
- **Unchanged and still true:** no production `RemoteExecutor` call site supplies a chain, so AUTH-03's requestor half ends the phase with a production adapter and no production caller. 15-02 recorded it in `remote-executor.ts`'s class comment; 15-04 Task 3 records it in the roadmap.
- **No blockers.**

## Self-Check: PASSED

All 13 changed paths and this SUMMARY exist on disk; all 7 commit hashes are present in `git log`. Verified by direct filesystem and `git log` reading, not by recollection.

---
*Phase: phase-15-capability-chained-dispatch*
*Completed: 2026-07-31*
