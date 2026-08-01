---
phase: phase-15-capability-chained-dispatch
plan: 04
subsystem: auth
tags: [capability-chain, delegation, spawn-test, auth-03, roadmap-amendment, mutation-testing]

requires:
  - phase: phase-15-plan-01
    provides: "audienceKeyOf and authorizeCapability — the mechanism this plan measures"
  - phase: phase-15-plan-02
    provides: "RemoteExecutor's required chain argument and CapabilitySupplier"
  - phase: phase-15-plan-03
    provides: "a real authorize hook on both factories, bin/agent.ts --owner-key, and capability-fixture.ts's four chain shapes"
  - phase: phase-14
    provides: "the blockstore-directory instrument for proving 'before instantiate' across a process boundary, and --trust-anchor on bin/agent.ts"
provides:
  - "packages/node/src/capability-dispatch.node.test.ts — all three ROADMAP Phase 15 criteria across two real operating-system processes"
  - "a cross-file argument-equality check on the two factories' authorizers, which catches the scrambling 15-03 measured as invisible"
  - "ROADMAP Phase 15's goal line amended to what the phase delivers, with the declined option and its cost recorded"
  - "ROADMAP Phase 22's entry-point-unreachability finding, named in advance rather than discovered"
affects: [phase-17-enrollment, phase-19-browser-harness, phase-22-reachability]

tech-stack:
  added: []
  patterns:
    - "a cross-process ordering claim is read off the child's own blockstore directory, not inferred from which wrapper sits inside which"
    - "a check that cannot measure a tier's behaviour can still transfer evidence from a tier that has it, provided it says which half it settles"

key-files:
  created:
    - packages/node/src/capability-dispatch.node.test.ts
  modified:
    - packages/node/src/serve-agent-hooks.node.test.ts
    - .planning/ROADMAP.md

key-decisions:
  - "The child's blockstore directory is read as well as the frame count, because Phase 14 already established it for this exact clause and it is a reading on the far side of the boundary rather than an inference from the near side"
  - "Both instruments are named as proxies; criterion 1's 'before instantiate' clause is reported as met at the process boundary, not asserted as measured"
  - "The browser tier's gap is closed for argument scrambling and left open for behaviour, and the summary says which is which"
  - "The ROADMAP goal was amended down to what is true rather than the evidence stretched up to the goal"

# AUTH-03 is NOT completed by this plan. Corrected 2026-07-31 after Phase 15's
# verification found this line contradicting the phase's own amendment note. This plan
# closed AUTH-03's *serving* half; its requestor half — delegate, CapabilitySupplier and
# RemoteExecutor.execute's supplier branch — has zero production callers, and by owner
# ruling it is Phase 23 criterion 5. The requirement stays open.
requirements-completed: []

duration: 27min
completed: 2026-07-31
---

# Phase 15 Plan 04: The Three Criteria, Across Two Real Processes — Summary

**All three of ROADMAP Phase 15's success criteria are now demonstrated between a submitter and a genuine operating-system process spawned from `bin/agent.ts`, and every one of them was watched failing first — under a defect planted before the file's first successful run.**

## Performance

- **Duration:** ~27 min
- **Started:** 2026-07-31T18:19 (worktree spawn); first commit 18:29
- **Completed:** 2026-07-31T18:46
- **Tasks:** 3 of 3
- **Files created/modified:** 3 (1 created, 2 modified)

## Task Commits

| Task | Commit | What |
|---|---|---|
| 1 | `de12846` | `test(15-04): the three criteria, judged by a process that shares only a socket` |
| 2 (deviation) | `0390a40` | `test(15-04): make the browser tier's authorizer arguments answerable to the tier that proved its own` |
| 3 | `3d143e3` | `docs(15-04): amend the goal this phase does not meet, and name the Phase 22 finding now` |

## The measurements, recorded as read

Neither figure is asserted against a literal anywhere, and no arithmetic deriving either is written down. The test prints them on every run so the reading survives rather than becoming a note somebody once took.

| Case | Frames the submitter sent to the child |
|---|---|
| criterion 1 — refused (no chain) | **1** |
| criterion 1 — accepted (valid chain) | **2** |
| criterion 2 — absent chain | **1** |
| criterion 2 — expired chain | **1** |
| criterion 2 — control (valid chain) | **2** |

The relation asserted is `accepted > refused >= 1`, nothing more.

## What is measured, and what is only reported

**Criterion 1's "before calling `WebAssembly.instantiate`" clause can only be *reported* as met at this boundary.** Two proxies are read and both are named as proxies in the test's own header:

1. **The child's own blockstore directory.** `FsBlockstore` writes one file per block named by its CID (`fs-blockstore.ts:102`); the executor a `FabricNode` composes resolves `blockstore.get(task.moduleCid)` first (`worker-executor.ts:175`); that blockstore is a `FetchingBlockstore`, which writes a fetched block into the local store on the way through (`block.ts:120`). So the module's CID appearing in the agent's directory says *this process went and got the module's bytes*. It is **absent after every refusal and present after every acceptance**, in all three cases — every `not.toContain` sits beside a `toContain` off the same instrument in the same `it`, so none of them is a silence.

2. **The submitter's outbound frame count.** Only the submitter holds the module (`two-process.node.test.ts:41-52`), so a child that never came back for it never compiled anything.

**This is more than the plan asked for.** The plan specified the frame count alone and stated that a literal `instantiate` counter would need a new hook. That remains true — no instrument in this repository observes `WebAssembly.instantiate` across a process boundary, and none was invented. But the directory reading is Phase 14's worked example for this identical clause, it costs nothing, and it is a reading taken on the *far* side of the boundary rather than an inference from the near side. Adding it was deviation 1 below.

**Whether either proxy *is* the criterion, or stands in for it, is prose rather than a measurement.** The stronger in-process reading — a counting `Executor` at `0` — lives in `packages/net/src/capability-dispatch.test.ts` and `packages/net/src/capability-authorizer.test.ts`, against the same code path minus the process boundary. It is stronger because `packages/core/src/executor/wasm.ts:161` is the only caller of `WebAssembly.instantiate` **on the `serveAgent` dispatch path** — not the only caller in the repository; `packages/aot/src/wasi-executor.ts:827` is a second, off this path.

**Criterion 2 is met at two different strengths, and the split is asserted rather than elided.** The expired refusal names `link 0`; the absent-chain refusal names **no index and cannot**, because `capability.ts:104` produces the literal `'no capability chain supplied'` and an empty chain has no link to index. The absence is asserted (`not.toContain('link ')`) only in the same `it` where the expired case shows the same instrument producing an index.

## The browser-tier gap: half closed, half not, and which is which

15-03 planted a mutation in `browser-node.ts`'s authorizer — owner id and owner key transposed, `audience: 'deadbeef'`, `now: () => 0` — and **nothing in the repository moved**. This plan re-planted that exact mutation and re-measured it, then closed what could be closed.

| Reading | Under 15-03's scrambling, before this plan | After this plan |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 (unchanged — it is type-correct) |
| `occurrences(BROWSER_NODE, 'authorizeCapability(')` | **1** — unmoved | **1** — still unmoved |
| `vitest --project browser packages/browser` | **345 passed** in three engines | **345 passed** — re-measured today, still blind |
| the new argument-equality assertion | did not exist | **RED**, printing all four scrambled lines |

**What was closed.** `serve-agent-hooks.node.test.ts` now reads the argument lines of each factory's `authorizeCapability` call and requires them to be the same text. Verbatim capture under the re-planted scrambling:

```
AssertionError: expected [ …(4) ] to deeply equal [ …(4) ]
-   "ownerId: sovereignty.ownerId,",
-   "...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerKey }),",
-   "audience,",
-   "now: Date.now,",
+   "ownerId: sovereignty.ownerKey ?? '',",
+   "...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerId }),",
+   "audience: 'deadbeef',",
+   "now: () => 0,",
 ❯ packages/node/src/serve-agent-hooks.node.test.ts:182:21
```

It is a **source-text check, and it is not offered as a behavioural one**. What makes it worth more than a substring count is that it is *relational*: `fabric-node.ts`'s side of the equality is behaviourally proven, by `fabric-node.node.test.ts`'s four dispatches over three live nodes and by this plan's three criteria across a real process boundary. So the line transfers evidence from the tier that has it to the tier that has none, and it mechanises the standing rule `fabric-node.ts`'s module comment states in the imperative — all nodes have equal functionality, the only difference is discovery. It is paired with `expect(fabric.length).toBeGreaterThan(0)`, because deleting *both* calls would otherwise satisfy it with two empty lists.

**Its limit, stated rather than left to be found.** It catches *divergence*, never *incorrectness*: a defect planted identically in both factories passes it. And it still says nothing whatever about a dispatch to a browser node.

**What is NOT closed, and why it cannot be closed from here.** The browser tier's authorizer **behaviour** remains **unmeasured**. The barrier is dialability, not startability (15-03's correction, re-confirmed): a `BrowserNode` listens on `['/p2p-circuit', '/webrtc']` alone, so a tab holding no relay reservation has no address any peer can dial and nothing can deliver a frame to its `serveAgent` handler. Arranging a reservation needs a Circuit Relay v2 **server**, which `@libp2p/circuit-relay-v2` states outright will not work in a browser — so the browser vitest project, where the test would have to run, cannot host one. The two ways out are both larger than one plan and are recorded in source beside the assertion: run a relay in the browser-project fixture and dispatch a sovereign task over it with and without a valid chain; or give `BrowserNodeOptions` an injectable `Transport` so a `MemoryNetwork` can stand in for libp2p — the same injection point Phase 17 needs for `privateKey`. **This is a known hole, recorded, not a hole discovered by verification.**

## Mutation testing — observed, not predicted

Four planted, run and restored by `cp` from a scratchpad **outside** the working tree (`~/.claude/gsd-scratch/15-04-acfe/`), each restoration confirmed byte-identical with `cmp`. No `git checkout`, `restore`, `stash`, `reset` or `clean` was used at any point after the sanctioned startup base correction — several agents share this checkout.

### Mutation A — the chain never leaves the requestor

`RemoteExecutor.#requestFor` always sends the no-`capability` form. **Planted before this plan's test file had ever run green**, so the file's first real run was against the defect.

**Observed: 15 tests red across 7 files** (the plan named 6 files).

| File | Red | One verbatim assertion |
|---|---|---|
| `capability-dispatch.node.test.ts` | 3 of 3 | `expected 'unauthorized: no capability chain sup…' to contain 'expired at'` |
| `net/capability-dispatch.test.ts` | 3 of 5 | `expected [] to deeply equal [ { ownerId: 'alice', …(5) } ]` |
| `net/remote-executor-contract.test.ts` | 3 of 7 | `AssertionError: Target cannot be null or undefined.` |
| `egress-manifest.node.test.ts` | 3 of 4 | `expected [] to include 'bafyreiccwgqag45rbtsfri5zatieqprf5yxk…'` |
| `egress-refusal.node.test.ts` | 1 of 1 | `expected 'insufficient' to be 'agreed'` |
| `sovereignty-placement.node.test.ts` | 1 of 1 | (`:234` — the sovereign shard no longer reaches `agreed`) |
| `fabric-node.node.test.ts` | 1 of 13 | `expected 'unauthorized: no capability chain sup…' to contain 'sovereignty'` |

Totals: `Test Files 7 failed | 16 passed (23)`, `Tests 15 failed | 188 passed (203)`.

### Mutation B — the Node factory's authorizer accepts everything

`authorize: () => null` in `fabric-node.ts`.

**Observed: 5 tests red across 3 files.**

```
FAIL  capability-dispatch.node.test.ts > criterion 1 …
AssertionError: expected true to be false // Object.is equality   (:415 — the unchained dispatch was accepted)
FAIL  capability-dispatch.node.test.ts > criterion 2 …            (:468, same)
FAIL  capability-dispatch.node.test.ts > criterion 3 …            (:546, same)
FAIL  fabric-node.node.test.ts > DATA-09 and AUTH-03's serving half …
AssertionError: expected 'sovereignty violation: node 12D3KooWH…' to contain 'unauthorized'
FAIL  serve-agent-hooks.node.test.ts > fabric-node.ts: real authorizer …
AssertionError: expected +0 to be 1     (:54 — the authorizeCapability count)
```

Totals: `Test Files 3 failed | 21 passed (24)`, `Tests 5 failed | 204 passed (209)`.

**This is the mutation that proves the *wiring* rather than the mechanism, and the evidence is what stayed green.** All of `packages/net` passed — `capability-authorizer.test.ts` and `capability-dispatch.test.ts` included. `verifyChain` and `authorizeCapability` are still correct and still demonstrably correct under it. The only thing that broke is the fact that a production node calls them, which is precisely the class of defect this milestone exists to remove.

Worth recording about the `fabric-node.node.test.ts` failure: the refusal that arrived was `sovereignty violation: node … is not cleared to execute sovereign data for owner alice`. With the authorizer neutered, the dispatch fell through to `guardSovereignty` and was still refused — **the job still failed, for a different reason**. That assertion catches it only because 15-03's Deviation 3 strengthened it to name the refusal rather than merely its kind. The same trap, caught by the same fix.

### Mutation C — the browser factory's authorizer deleted (the plan's third)

`authorize: () => null` in `browser-node.ts`. Whole repository, all projects.

**Observed: 2 tests red of 4268, both in `serve-agent-hooks.node.test.ts`.**

```
Test Files  1 failed | 291 passed | 2 skipped (294)
     Tests  2 failed | 4248 passed | 18 skipped (4268)

FAIL  browser-node.ts: real onDispatch, real admission, three sentinels
AssertionError: expected +0 to be 1 // Object.is equality      (:127 — the count)
FAIL  browser-node.ts hands its authorizer the identical arguments fabric-node.ts hands its own
AssertionError: expected [] to deeply equal [ …(4) ]           (:182 — the new check)
```

The plan predicted only the first, and predicted it as the whole finding. Because the new assertion landed before this mutation was planted, the deletion is now caught twice — but note what that does **not** mean: both are source-text readings, and `tsc` exited 0 and all 345 browser tests passed under it.

### Mutation E — the browser factory's authorizer scrambled (15-03's, re-planted)

The strong one, and the reason this plan added an assertion at all. Captured above. **Observed: exactly 1 test red — the new argument-equality check — with `tsc` at exit 0, the substring count still at 1, and 345 browser tests still passing in three engines.**

Reported as the measurement it is: before this plan, that scrambling was invisible to every instrument in the repository; after it, one instrument sees it, and that instrument reads source text.

## Corrections — every `file:line` was re-grepped before being relied on

The phase-level warning held a fourth time. Reported per the standing rule that a correction living in one SUMMARY reaches no sibling plan.

| Plan said | Actually | Load-bearing? |
|---|---|---|
| ROADMAP Phase 22 is at `:507-515`, criterion 1 at `:514` | **`:529-539`**, criterion 1 at **`:536`**. `:503` is Phase 20 | **Yes — this is the one that would have rewritten the wrong phase's criteria.** Re-grepped with `grep -n "^### Phase"` before editing; the heading landed on is `### Phase 22: Reachability Guard` |
| ROADMAP Phase 15 is "around `:405-415`" | heading `:412`, goal `:413`, `**Plans**` `:422` | Yes |
| `wasm.ts:106` is the only `WebAssembly.instantiate` caller on the dispatch path | **`wasm.ts:161`** | **Yes** — cited in shipped source |
| `wasm.ts:66-68` reads `task.inputCid` unconditionally | **`:88-90`** | **Yes** — cited in shipped source |
| `egress-refusal.node.test.ts:26-29` states what "started via `bin/agent.ts`" means | **`:27-32`** | Yes — cited in shipped source |
| `two-process.node.test.ts:17-27` is the "only the submitter holds the module" property | **`:41-52`** (the NET-01 doc comment). `:17-27` is imports and the DET-03 note | Yes — cited in shipped source |
| `capability.ts:107-108` is the `broken-link` text | **`:108`**; `:107` is the `case` label | Minor |
| `Blockstore.has` is on the port at `ports.ts:20` | **`:22`**; `:20` is `put` | Minor |
| the harness lives at `egress-refusal.node.test.ts:45 / :62-95 / :109-117 / :120-133 / :148-156 / :168-172 / :243-244` | **`:68` / `:107-144` / `:168-180` / `:182-196` / `:211-228` / `:240-244` / `:320-321`** | Yes — copied from the real lines |
| `sovereignty-placement.node.test.ts:136` is the spawn flag form | **`:177`** (15-03 already corrected this; re-confirmed) | Minor |
| `fabric-node.ts:351-355` builds `rpc` over `egress`; `:359` is the `FetchingBlockstore` | **`:635-639`** and **`:643`** | Yes — cited in shipped source |
| `submit.ts:178` is where `submitJob` writes shard bytes into the submitter's store | not verified; the claim was not needed and is not cited in shipped source | No — dropped rather than repeated unchecked |

**One plan claim is wrong rather than drifted, and it is about mechanism.** The plan states that on an authorize refusal *"`registerSovereignInputs` never runs, nothing is registered, and the reply frame is scanned against nothing."* **False.** `takeSovereignHold` runs at `agent.ts:382-388`, **before** the `authorize` call at `:402-408`, so the owner's tap *does* hold the seeded row across every refused dispatch in this file. The conclusion the plan draws survives for a different reason, now written into the test's header: a refusal frame carries only `unauthorized: <text>` and none of the owner's bytes, so the scan passes it and the refusal reaches the submitter as a returned outcome. Phase 13.1's criterion 6 still does not apply to this path — but the mechanism is the reply's *contents*, not the absence of a registration.

**Re-verified correct** and worth recording, because the phase's claims rest on them: `capability.ts:104` is exactly `'no capability chain supplied'`; `:112` the expired text; `:118` the `not-delegable` text; `:92` the `broken-link` kind and `:162-167` where it is reached; `:56` the "absolute rather than a duration so it cannot drift" comment; `agent.ts:419` composes the `unauthorized: ` prefix; `remote-executor.ts:139` returns the outcome verbatim; `wasi-executor.ts:827` is the second `instantiate` caller, off this path; `fs-blockstore.ts:45` filters `.tmp-` and `:102` names a block file by CID; `worker-executor.ts:175` is the module fetch; `block.ts:120` is the local write-through; `vocabulary.node.test.ts:360` is the `git ls-files -z` enumeration; `submit-with-egress.ts:110` is `sliceManifest`; `egress.ts:32-40` is `EgressEntry`; ROADMAP `:332-336` is the Phase 13 amendment's measured-byte-figure item.

## The vocabulary reading, taken again rather than quoted

The plan carried a 2026-07-28 reading (`??` for the whole phase directory) and 15-CONTEXT.md carried a 2026-07-29 correction (five files tracked). **Both are stale. Measured 2026-07-31:** `git ls-files` on `.planning/phases/phase-15-capability-chained-dispatch/` lists **nine** files — four plans, the CONTEXT, `deferred-items.md`, and all three prior SUMMARYs — and `git status --short` on that directory reports nothing. So the guard already covered the whole directory before this plan wrote a line. The only file outside its reach was this SUMMARY, until this commit.

**The test's own result:** `vocabulary.node.test.ts` — 24 passed, run **after** committing the ROADMAP edit, since the edit is what could break it. Its true scope: it enumerates tracked files with `git ls-files -z` (`vocabulary.node.test.ts:360`), so it covers `.planning/ROADMAP.md`, every source file this phase touched, and the whole phase directory as listed above.

**The manual reading, separate and by hand,** with the five `BANNED` patterns read programmatically *out of* that file rather than transcribed into this one, and applied by walking the filesystem rather than `git ls-files`:

```
patterns read from the guard: 5
files scanned: 10   (the 9 phase-directory files + .planning/ROADMAP.md)
hit count: 5        — all 5 in .planning/ROADMAP.md:224-225, all pre-existing (Phase 9's
                      entry, which is what the rule is about), none in the phase directory,
                      none on any line this plan wrote
```

Those two lines are unshifted by this plan's edits, which begin at `:413`.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole repository) | **exit 0** |
| `npx vitest run` (all projects: node, browser, e2e, perf) | 292 files, **4250 passed**, 18 skipped, **0 failed** |
| `vitest --project node` (whole project) | 90 files, **1319 passed**, 18 skipped — 15-03 left it at 1316; +3 is exactly this plan's file |
| `capability-dispatch.node.test.ts` | 3 passed (591 ms / 547 ms / 720 ms) |
| `serve-agent-hooks.node.test.ts` | **7 passed** (was 6) |
| `vocabulary.node.test.ts` | 24 passed, run after committing |
| `cmp` vs scratchpad — `remote-executor.ts` | exit 0 |
| `cmp` vs scratchpad — `fabric-node.ts` | exit 0 |
| `cmp` vs scratchpad — `browser-node.ts` | exit 0 |
| `git diff --stat` on those three paths | **empty** (a secondary reading; all three were clean at task start, so it is meaningful here) |
| file deletions vs. base | **none** |
| `package.json` / `package-lock.json` / `packages/*/package.json` | unchanged; no `npm install` run |
| `.planning/STATE.md` | **untouched** |

**Resolver proof (the inherited trap).** The worktree has no `node_modules`, and symlinking the main install wholesale resolves `@o2/*` back to the main checkout — so `tsc` and `vitest` would report clean without reading a line of this work, which for a proof plan is the worst possible failure. A farm was built (180 third-party entries symlinked at the main install, all 8 `@o2/*` repointed at this worktree's `packages/`) and proved before any test was trusted:

```
OK  @o2/core   -> …/worktrees/agent-acfe8a609ed50f808/packages/core/src/index.ts
OK  @o2/net    -> …/worktrees/agent-acfe8a609ed50f808/packages/net/src/index.ts
…all 8 OK…
    vitest/package.json     -> /Volumes/…/o2.services/node_modules/vitest/package.json
    typescript/package.json -> /Volumes/…/o2.services/node_modules/typescript/package.json
FARM PROVEN
```

Every vitest run reported `RUN v4.1.10 /Volumes/…/worktrees/agent-acfe8a609ed50f808` as its root, and the RED run's failures cite `packages/node/src/capability-dispatch.node.test.ts:430` **in this worktree**. Every run used `--project node` or `--project browser`, or was the deliberate whole-repository run Mutation C requires.

**Clocks.** `uptime` read a 1-minute load average of **7.82** at session start and **7.09** at the end. No new timing bound was invented: the submitter's 10 s RPC budget is `egress-refusal.node.test.ts`'s figure, the 30 s handshake and 120 s `testTimeout` are the two existing spawn files' figures, and the `afterEach` is 20 s so the framework's clock is strictly larger than `stopAgent`'s 10 s SIGKILL fallback. Nothing in this file measures wall-clock.

## Deviations from Plan

Three, all reported rather than silently absorbed. None required a checkpoint.

**1. [Rule 2 — missing critical functionality] The plan's only cross-process instrument for criterion 1 was the weaker of the two available**
- **Found during:** Task 1, reading `signed-artifact.node.test.ts` as instructed.
- **Issue:** The plan specifies the submitter's frame count and states that a stronger cross-process reading would need a new hook. Phase 14 built one for this identical clause and needs no new hook: the child's own `FsBlockstore` directory. A frame count is a reading on the *submitter's* side about what the child *probably* did; the directory is a reading on the child's side of what it did. Shipping only the weaker one, in the plan that is the phase's evidence, would have left the strongest available reading on the floor.
- **Fix:** Both are read, in all three cases. The module CID is asserted absent from the agent's directory after every refusal and present after every acceptance, so no `not.toContain` stands without a `toContain` off the same instrument in the same `it`. Both are still named as proxies, and the criterion's clause is still reported rather than claimed.
- **Files:** `packages/node/src/capability-dispatch.node.test.ts` — **Commit:** `de12846`

**2. [Rule 2 — missing critical functionality] The browser tier's authorizer had one instrument and it could not see a scrambled authorizer**
- **Found during:** Task 2, planting Mutation C and reading 15-03's Mutation E finding.
- **Issue:** 15-03 recorded this as a `threat_flag: auth-path` — an authorization decision point whose arguments nothing in the repository checks. Re-measured today and confirmed: transposed owner id and key, a hardcoded audience and a frozen clock leave `tsc` at 0, the substring count at 1, and 345 browser tests green. Reporting Mutation C's thinness and stopping there would have recorded the hole accurately and left it open when something could be done about it.
- **Fix:** A cross-file argument-equality assertion in `serve-agent-hooks.node.test.ts`, paired with a non-empty reading of the fabric side. Watched failing on the re-planted scrambling **and** on the outright deletion. Its scope, its worth and its limit are written at the call site: it is a source-text check that catches divergence and not incorrectness, it transfers evidence from the behaviourally-proven tier, and the behavioural half stays unmeasured with the reason and the two ways out recorded.
- **Files:** `packages/node/src/serve-agent-hooks.node.test.ts` — **Commit:** `0390a40`
- **Also corrected in the same commit:** that file's `BROWSER_NODE` row claimed to be "the **only** check in this repository on the browser tier's authorizer". Adding a second made it false, so it was rewritten rather than left. **No assertion was weakened; one was added.**

**3. [Rule 1 — bug] ROADMAP's Phase 15 checklist line repeated the false clause the plan sends this task to fix**
- **Found during:** Task 3, on the mandated re-read.
- **Issue:** The plan names three edits and does not include `.planning/ROADMAP.md:54`, which says of Phase 15 "both ends wired for the first time" — the identical clause the plan amends at `:413` for being false. 15-02's Next Phase Readiness flagged it and no plan picked it up. Amending one and leaving the other would have left the file self-contradicting on the same fact.
- **Fix:** Amended to match, pointing at the amendment note rather than restating it.
- **Files:** `.planning/ROADMAP.md` — **Commit:** `3d143e3`

**No existing assertion was weakened, reworded or deleted, and no refusal string was reworded to make an assertion pass.** Every string this plan asserts on is `describeFailure`'s own text, checked against `capability.ts` first.

## Files Created/Modified

- `packages/node/src/capability-dispatch.node.test.ts` (new, 611 lines) — the harness copied from `egress-refusal.node.test.ts`; a header stating in full what is measured, what is proxied and what is unmeasured; one `it` per criterion at 120 s each; publisher seed **56**, re-grepped free.
- `packages/node/src/serve-agent-hooks.node.test.ts` — one helper, one new `it`, and one corrected comment. The six pre-existing `it`s are unchanged line for line apart from that comment.
- `.planning/ROADMAP.md` — Phase 15's goal line, its checklist line, its `**Plans**` line, a 30-line amendment note in the Phase 13 entry's HTML-comment form, and one finding paragraph under Phase 22's criteria. No other phase's entry was touched; nothing was restructured or reflowed.

## Known Stubs

**None.** No hardcoded empty value flows to a UI, no placeholder text was introduced, no component was left without a data source.

The five `'dispatches-unauthenticated'` production sentinels and the two in `bin/bench.ts` are explicitly **not** stubs and are documented as such in source and now in the roadmap: they are the correct, permanent value for public work, not placeholders awaiting wiring.

## Threat Flags

None new. This plan adds no network endpoint, no auth path, no file access pattern and no schema change at a trust boundary — it measures ones that already exist.

15-03's two flags are updated rather than repeated:

| Flag | File | Status after this plan |
|------|------|---|
| `threat_flag: auth-path` | `packages/node/src/bin/agent.ts` | **Unchanged.** `--owner-key` is operator-supplied configuration; this node still cannot tell a correct pin from a wrong one, and making the anchor itself verifiable is AUTH-01/02, Phase 17. |
| `threat_flag: auth-path` | `packages/browser/src/browser-node.ts` | **Narrowed, not cleared.** A scrambled authorizer is now caught, by a source-text equality against a behaviourally-proven call site. A *dispatch* to a browser node is still unmeasured and still cannot be measured without a relay reservation. Phase 19's browser harness. |

## Issues Encountered

1. **The worktree resolver trap** (inherited, hit as described). Resolved by building a per-package farm and proving `@o2/*` resolution before trusting a single test — and re-proved at the end.
2. **Base commit correction at startup.** The worktree spawned at `c62bae5`, whose merge-base with the required base `cd28697` was `bbb7b2a`. The working tree was clean, so the sanctioned startup `git reset --hard cd28697` was applied. It was the only `git reset` in the session and it preceded all work.
3. **The plan's `it` 3 helper could not be typed as written.** `readonly ReturnType<typeof directChainFor>[number][]` does not express "a chain"; `Delegation` is exported from `@o2/core` and the helper takes `readonly Delegation[]`. Caught by `tsc`, not by a test.
4. **The three spawn cases run in ~600 ms each**, which reads as too fast for a real child process until the cause is known: Node 24 strips types natively, so `node bin/agent.ts` needs no transpiler process, and the run prints `ExperimentalWarning: Type Stripping` once per spawned child. The reading that settles it is not the timing but the module block: it appears in the child's directory only after an accepted dispatch, and the only route it can take is a fetch over the socket from the submitter.

## Next Phase Readiness

- **AUTH-03's serving half is wired and proved**, across two operating-system processes, at all three criteria, with every guarantee watched failing.
- **AUTH-03's requestor half ends the phase entry-point-unreachable**, and that is now what the roadmap's Phase 15 goal line, its checklist line, Phase 22's entry and `remote-executor.ts`'s class comment all say. **Phase 22 will find `delegate` unreachable and should not treat it as a discovery** — the decision, the two rejected options and the natural fix (an opt-in sovereign leg on `bin/bench.ts`, off by default) are recorded in advance.
- **Phase 19 / WIRE-03 inherits one measured hole:** the browser tier's authorizer behaviour. What would close it is written at the call site and in `serve-agent-hooks.node.test.ts`. `deferred-items.md`'s finding — five shipped comments claiming `BrowserNode.start` runs in no vitest project, when it runs in three engines — is still open and untouched by this plan.
- **Phase 17 gains a second reason for the same injection point.** An injectable `privateKey` on the node factories would also make `audienceKeyOf`'s two throwing branches reachable, which is the third thing this phase records as unmeasured: a start-time refusal on an identity that cannot yield an audience key is unreachable through either factory, because neither passes `privateKey` to `createLibp2p`.
- **No blockers.**

## Self-Check: PASSED

All 3 changed paths and this SUMMARY exist on disk; all 3 task commit hashes are present in `git log`. Verified by direct filesystem and `git log` reading, not by recollection.

---
*Phase: phase-15-capability-chained-dispatch*
*Completed: 2026-07-31*
