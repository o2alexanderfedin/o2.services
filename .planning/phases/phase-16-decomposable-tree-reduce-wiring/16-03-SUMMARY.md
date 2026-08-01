---
phase: phase-16-decomposable-tree-reduce-wiring
plan: 03
subsystem: reduce
tags: [reduce, combine, process-boundary, MR-04, MR-05, MR-06, MR-07, AUTH-03]
status: BLOCKED — checkpoint returned, criteria 1/2/3 written and skipped
requires:
  - "16-01: fabricCombiner, asFabricPartial, MAX_COMBINE_INPUTS, the combine frames"
  - "16-02: runCombine, remoteCombineDispatch, reduceJob"
provides:
  - "packages/node/src/tree-reduce-agents.node.test.ts: the eight-process harness, standUp/runMap/killAgent, and the projection shared with 16-02 and 16-04"
  - "MEASURED: runCombine refuses every combine on FabricNode and BrowserNode — the reduce has no working production path"
  - "MEASURED: with the gate opened, criteria 1, 2 and 3 all pass across eight/nine bin/agent.ts processes"
  - "Six falsifying mutations, each watched failing against a different assertion"
affects:
  - packages/node/src/tree-reduce-agents.node.test.ts
tech-stack:
  added: []
  patterns:
    - "a criterion that cannot be met is written in full and skipped loudly, never deleted"
    - "the blocker is asserted as a passing test, so it goes red the moment it is fixed"
key-files:
  created:
    - packages/node/src/tree-reduce-agents.node.test.ts
  modified: []
decisions:
  - "Rule 4 checkpoint: opening runCombine's authorize gate is an admission-policy decision, not a test fix. It deletes a refusal 16-02 asserted deliberately and mutation-tested, it sits in the auth path, and it affects both real node classes. Not taken unilaterally."
  - "Criteria 1/2/3 committed as `describe.skip` rather than omitted. A criterion that vanishes between plan and results is indistinguishable from one removed because its result was inconvenient."
  - "Mutation captures were taken on top of the opened gate, because the criteria cannot execute at all otherwise. Stated rather than elided."
metrics:
  duration: ~55 min
  completed: 2026-07-31
  tasks: 3 (Task 1 and 2 written; Task 3 run with six mutations rather than three)
  commits: 2
---

# Phase 16 Plan 03: Eight Real Processes — Summary

**Criteria 1, 2 and 3 are NOT MET, and the reason is a defect this plan is the first
thing in the repository able to see.**

## The finding

**`runCombine` refuses every combine on every real node.** `packages/net/src/agent.ts`
gates the combine branch on `options.authorize !== 'serves-unauthenticated'`, and both
real node classes hardcode a real authorizer:

| `serveAgent` call site | `authorize` | Combines? |
|---|---|---|
| `packages/node/src/fabric-node.ts:764` — **`FabricNode`, what `bin/agent.ts` builds** | `authorizeCapability({…})` | **refused** |
| `packages/browser/src/browser-node.ts:616` — **`BrowserNode`** | `authorizeCapability({…})` | **refused** |
| `packages/node/src/bin/bench.ts:332` | `'serves-unauthenticated'` | served |
| `packages/node/src/bin/bench.ts:371` | `'serves-unauthenticated'` | served |

There is no flag and no configuration by which `bin/agent.ts` produces a node that
answers a combine. So `reduceJob` — the production entry point this phase exists to
wire — has **no working production path at all**.

The gate's own comment states its premise: *"Every production call site passes the
sentinel today, so this is a no-op now and becomes a real refusal the moment a node is
given a real `Authorizer`."* **That premise is false**, and it was false when it was
written: only the two benchmark call sites pass the sentinel, and both real ones predate
the gate (Phase 15 installed them).

**Why 16-02 could not see it.** Every fabric 16-02 tested over is an in-process
`MemoryNetwork` built with `serveAgent({...SENTINELS})`, and
`authorize: 'serves-unauthenticated'` is one of the seven sentinels. A fabric cheaper
than the real thing could not observe a gate keyed on the real thing's configuration —
which is the exact hazard this plan's `<what_you_are_proving>` names.

And it arrives in the shape this project warns about hardest: **the decision keys on what
kind of node something is** — "does this node have an authorizer at all" — rather than on
the mechanism. It is the direct contradiction of 16-CONTEXT decision 2 and of
`serveAgent`'s own docstring, *"A node that serves also **combines**, unconditionally and
with no option to say otherwise."*

### Measured, verbatim

From a spawned `bin/agent.ts` process, raw `combine` frame:

```
{"kind":"combine","resultCid":null,"reason":"combine requires a capability chain this build cannot verify"}
```

Through `reduceJob` over eight agent processes:

| Reading | Value |
|---|---|
| `result.ok` | `true` — *a reduce was attempted* |
| `outcome.ok` | **`false`** |
| `outcome.rootCid` | `null` |
| `outcome.combines` | 0 |
| `outcome.executedBy.size` | 0 |
| `outcome.failed` | all three tree node ids |
| `outcome.recomputes` | **0** |
| `tree.leaves` / `nodes` / `depth` | 8 / 3 / 2 — the map and the tree are fine |

The last row is an **independent cross-process confirmation of 16-02's correction**:
`recomputes` reads 0 while every level-1 combine fell through all eight executors,
because `executeReduce` discards the attempts of a combine that never produced a CID.
`failed` and `executedBy` are the diagnostics that survive; `recomputes` is not one.

## Why this was returned as a checkpoint rather than fixed

Deviation Rule 4. Three independent reasons, any one sufficient:

1. **It is an admission-policy change in the auth path.** A combine would become work a
   node performs for an unauthenticated peer.
2. **It deletes an assertion another plan made deliberately.** `combine.test.ts:328`
   asserts this exact refusal string, and 16-02 mutation-tested it with a counting
   blockstore proving zero reads precede it. Overriding that silently is precisely what
   Rule 4 reserves for the user.
3. **This plan's declared scope is "changes no production source file"**, and the fix
   lives in `packages/net/src/agent.ts` — 16-02's file — while 16-04 runs concurrently.

**What the fix probably is**, offered as analysis and not applied: every `Authorizer` in
this repository admits public work with no chain (`capability-authorizer.ts:85`, *"A
public task is never asked for a chain"*). A combine reads only content-addressed public
partials and has no owner and no sovereign label, so consulting the admission model —
if a combine could be consulted about, which it cannot, since `Authorizer` takes a
`Task` — yields *admit*. The gate's premise was that refusing costs nothing until AUTH-03
lands. It costs the whole feature.

## What was measured anyway, so the decision unlocks everything at once

**With the gate opened locally, all three criteria pass.** The opened gate was restored
byte-exact and is not in any commit.

| Criterion | Result | Wall clock |
|---|---|---|
| 1 — eight processes, one tree, bit-identical aggregate, one holder | **PASS** | 1491 ms |
| 2 — SIGKILL mid-reduce, repaired elsewhere, reduce completes | **PASS** | 1606 ms |
| 3 — two replicas dedupe, ninth process re-answer costs nothing | **PASS** | 1867 ms (9 agents) |
| the blocker measurement (in this commit, green) | PASS | 1297 ms |

All three are committed as `describe.skip` with the blocker named in the file. They are
written exactly as they will run; nothing in them is conditional on the blocker and
nothing was weakened. **Removing the three `.skip`s is the whole of the re-enablement.**

### The tree shape, confirmed against 16-02

Transcribed from 16-02-SUMMARY.md, never computed here, and **this run agreed with both
figures**: `tree.nodes.length` **3**, `tree.depth` **2**, over `tree.leaves` **8** at
fanout **4**. Layout `L1(4)`, `L1(4)`, `L2(2)`. No disagreement to reconcile.

### Six mutations, each watched failing against a different assertion

Planted one at a time on top of the opened gate — **stated plainly, because the criteria
cannot execute without it** — restored with `cp` from a scratch baseline and confirmed
byte-exact with `cmp`. No `git checkout`, `restore`, `stash`, `reset` or `clean` was run.

| # | Mutation | File | Assertion turned red | Reading |
|---|---|---|---|---|
| A | combine computed locally instead of over RPC | `combine.ts` | criterion 1, measurement 3(ii) | `holders` `[]` vs `["12D3KooWCy5M9Yw…"]` |
| B | `deriveReduceTree` layer loop → left fold | `reduce.ts` | criterion 1, shape | `nodes` **7** vs 3 |
| C | `runCombine` returns its first input | `agent.ts` | criterion 1, bit-for-bit | `bafyreih3rmjlem…` vs `bafyreicdiznyeq…` |
| D | null dispatch `break`s the ranking walk | `reduce.ts` | criterion 2, (c) `outcome.ok` | `false` vs `true` |
| E | `redundancy` pass-through deleted | `reduce-job.ts` | criterion 3, `minReplicas` | **1** vs 2 |
| F | directed fetch-back `put` deleted | `combine.ts` | criterion 3, **first** probe delta | **+0** vs +1 |

**What still passed under each, which is the record of why no measurement is redundant:**

- **Under A, measurement 3(i) still passed** — `executeReduce` records the executor the
  ranking chose regardless of who did the work. That is why 3(ii) exists beside it, and
  it is the difference between an assertion that checks the ranking against itself and
  one that measures.
- **Under B, `reduce.test.ts` kept 26 of 28 green**, including **both** single-node
  reference comparisons (`:234` *matches a one-shot reduction*, `:263` *is unchanged by
  fanout*). A fold is a valid association of an associative combiner, so the bit-for-bit
  comparison cannot substitute for the shape assertion. The two that did fail were a
  shape assertion and *a genuinely non-associative reducer diverges from the reference*,
  which is itself shape-dependent.
- **Under C, measurements 1, 2 and 3 all still passed** — tree shape and assignment are
  unaffected — so the bit-for-bit reference cannot be dropped either.
- **Under F, the criterion-3 statement went red at its positive control rather than at
  its claim**, which is the correct place: the instrument must be shown connected before
  a +0 is read as a reading.

### A finding the plan did not anticipate: 3(i) *does* have a falsifying deletion

16-02 recorded the `executedBy`/`rendezvousRank` identity as having **no** falsifying
deletion, because in process it compares `executeReduce`'s bookkeeping against the pure
function `executeReduce` itself called. **At process level it has one.** Under Mutation F,
criterion 1 failed at 3(i) with the root executed by a peer the ranking never named:

```
Expected: "12D3KooWKRB6BW3ZyDbFuJAGzEaSdyFLnMva2UJeH89w7ycrFwu5"
Received: "12D3KooWHDvwFoUGf4z8jKKemKVwqRxubAVXBsEHUdENPFzTfr34"
```

The ranked-first peer could not reach its inputs — a level-1 result lives only on the
executor that produced it — so the walk fell through to a peer that happened to hold both
level-1 results locally. **`outcome.ok` and `failed` stayed green through this**, which
is exactly the "three green assertions, zero aggregate" hazard the plan warned about,
arriving from an angle it did not predict.

### The fan-out residue, measured rather than predicted

The plan says that if a run ever enters the path for a block nobody holds, its cost must
be measured and recorded. Mutation F puts it there. Measured:

| Run | Healthy | Under Mutation F | Factor |
|---|---|---|---|
| criterion 3 | 1.87 s | **32.1 s** | 17× |
| criterion 1 | 1.49 s | **61.5 s** | 41× |

That is the accepted, previously-unmeasured residue `combine.ts` documents, now with a
number and a date attached to it.

## The per-host connection ceiling was NOT hit — published rather than assumed

`LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host and
`LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS` is 10. Neither bit. The submitter dials
**outward**, so each agent sees exactly one inbound connection and the submitter makes
eight (criterion 3: nine) outbound dials, which nothing caps. The dial assertion in
`standUp` passed on every run, including the nine-agent one.

**`MaxEarlyStreamsError` (NET-09) never appeared**, at map redundancy **2**, with combine
streams on top. The plan's contingency — drop map redundancy to 1 — was therefore **not
used**, and the map stays verified. The plan was honest that its headroom argument was
untested arithmetic; the measurement is that it fits.

No configuration was excluded and no rung was dropped. Eight processes is what was asked
for and eight is what ran.

## Timeouts, sized against measurements taken here

| Clock | Value | Basis |
|---|---|---|
| `afterEach` hook | 60 s | **Measured teardown 4–33 ms (8 agents), 5 ms (9)** — nowhere near it. Sized against the pathological case: one wedged child costs the inner 10 s SIGKILL fallback, and the hard requirement is only that the framework's clock exceed the inner one. |
| `stopAgent` inner | 10 s | Unchanged from the three-process files. |
| per-test | 300 s | ~160× the measured 1.5–1.9 s. A ceiling for a loaded machine, not an estimate; the file says so and says not to raise it over a stall. |
| `spawnAgent` handshake | 60 s | Raised from the three-process files' 30 s for eight concurrent spawns. Never approached. |

Both clocks and their ordering are stated in the `afterEach` docstring, with the reason
the framework's must be the larger.

## Citation drift

Re-grepped from this worktree. **The structural claims mostly held; the line numbers
mostly did not, and four claims were structurally wrong.**

| Plan citation | Claim | Actual | Verdict |
|---|---|---|---|
| `bin/agent.ts` "parses exactly four options (`dir`, `port`, `owner-id`, `can-execute-sovereign`)" | CLI surface | **six**: `dir`, `port`, `owner-id`, `owner-key`, `can-execute-sovereign`, `trust-anchor` | **WRONG** — structural |
| `bin/agent.ts` "prints one line: `{peerId, multiaddrs}`" | handshake | **three** fields — `trustAnchors` too (`:112`) | **WRONG** — structural |
| `FabricNode.start({blockstoreDir; listen?; rpcTimeoutMs?; sovereignty?})` | interfaces block | omits **`trustAnchors`, which is required with no default**; without it the agents refuse the fixture module and no partial exists to combine | **WRONG** — structural, and blocking |
| "the test spawns each agent with exactly `[AGENT, '--dir', dir]`" | the measured no-flag substitute | must also pass `--trust-anchor`, as `two-process` and `sovereignty-placement` already do | **WRONG** — structural |
| `runCombine` "every production call site passes the sentinel today" (in `agent.ts`, quoted by the plan's premise) | — | two of four do; the two real ones do not | **WRONG** — this is the finding |
| `purity.node.test.ts:167-174` keeps the `Executor` port narrow | — | `:167` is *has no dependency edge from `@o2/core` to any adapter package* | **WRONG** (orchestrator's warning confirmed) |
| `constants.ts:65` `INBOUND_CONNECTION_THRESHOLD = 5` | libp2p constant | line correct; symbol is `LIBP2P_INBOUND_CONNECTION_THRESHOLD` | name drifted |
| `bin/bench.ts:424-430` publishes the ladder exclusion | — | `:660-743`; the threshold sentence at `:681` | drifted badly |
| `two-process.node.test.ts:17-27` argues the process boundary | docstring | `:41-52` (`:19-25` is the DET-03 note) | drifted |
| `two-process.node.test.ts:126-132` outward dial | — | `:173` | drifted |
| `two-process.node.test.ts:170-204` reopening a dead process's store | — | `:213-248` | drifted |
| `two-process.node.test.ts:190-200` / `:194-198` | stop-then-read | `:238-247` | drifted |
| `sovereignty-placement.node.test.ts:56-126` harness | — | `:82-149` | drifted |
| `sovereignty-placement.node.test.ts:135-139` spawns three | — | `:186-188` | drifted |
| `sovereignty-placement.node.test.ts:141-145` outward dial | — | past `:190` | drifted |
| `bin/agent.ts:61-68` SIGTERM/SIGINT handlers | — | `:115-126` | drifted |
| `fabric-node.ts:411` `serveAgent` | — | `:741` (16-02 found the same) | drifted badly |
| `rpc.ts:23` the timeout | — | `DEFAULT_RPC_TIMEOUT_MS` at `:25` (16-01 and 16-02 found the same) | drifted |
| `reduce.ts:98-152` `deriveReduceTree` + `rendezvousRank` | — | `:189-254` | drifted badly |
| `reduce.ts:112-136` the layer loop | — | `:214-230` | drifted |
| `reduce.ts:116-120` lone-child promotion | — | `:218-222` | drifted |
| `reduce.ts:106` the dedupe | — | `:204` | drifted |
| `reduce.ts:245-309` `executeReduce`'s level loop | — | `:321-426` | drifted badly |
| `reduce.ts:248` per-level `Promise.all` | — | `:351` | drifted |
| `reduce.ts:271-279` / `:275-277` the ranking walk / the `continue` | — | `:374-382` / `:377-380` | drifted |
| `reduce.ts:297-299` / `:303` `executedBy` / `recomputes` | — | `:401-403` / `:406` | drifted |
| `reduce.ts:305-306`, `:313-315` `rootCid` null | — | `:414`, `:417-418` | drifted |
| `reduce.test.ts:255-300` the in-process originals; `:255` the victim | — | victim at `:332`; `store.size` at `:367-375` | drifted |
| `reduce.test.ts:177-183` the reference assertion | — | `:234` and `:263` (16-02 already corrected this) | drifted |
| `memory.ts:37` re-put leaves `size` unchanged | — | `:37` | **correct** |
| `fs-blockstore.ts:60-68` returns before `#count++` | — | `#count += 1` at `:68` | **correct** |
| `block.ts:120` writes the block locally on the way past | — | `:120` | **correct** |
| `block.ts:70-71` local hit before consulting source | — | `:70-71` | **correct** |
| `block.ts:74-76` the in-flight map | — | `:74-80` | close |
| `combine.test.ts` asserts the refusal string | — | `:328` | **correct** |
| `capability-authorizer.ts` "a public task is never asked for a chain" | — | `:80-85` | **correct** |
| every `<verify>` block's `cd /Volumes/…/o2.services` | — | that is the **main checkout**, not this worktree | **WRONG** — ran everything from the worktree root |

## Verification

Run against a resolver **proven** to read this worktree. The worktree had no
`node_modules`, and the obvious fix is silently wrong — the main install's `@o2/*` are
*relative* symlinks resolving back to the main checkout. A farm was built instead:
third-party absolute-linked from the main install, every `@o2/*` repointed here. Proof
via `createRequire` + `realpathSync`:

```
@o2/core   -> …/agent-a547a777efb601499/packages/core/src/index.ts
@o2/net    -> …/agent-a547a777efb601499/packages/net/src/index.ts
@o2/libp2p -> …/agent-a547a777efb601499/packages/libp2p/src/index.ts
@o2/demo   -> …/agent-a547a777efb601499/packages/demo/src/index.ts
multiformats/cid -> /Volumes/ProjectsSSD/Projects/o2.services/node_modules/multiformats/…
libp2p           -> /Volumes/ProjectsSSD/Projects/o2.services/node_modules/libp2p/…
```

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (whole repository, worktree root) | **exit 0** |
| `vitest run --project node` — new file + `packages/net` + `reduce.test.ts` | **245 passed, 3 skipped** (23 files) |
| `vitest run --project node` — `vocabulary` + `purity`, run **after** commit | **38 passed** |
| `O2_UNIT_ONLY=1 vitest run --project node` (full) | **1215 passed, 21 skipped, 0 failed** (85 files) |

1215 = 16-02's 1214 baseline + 1 (the blocker measurement). 21 skipped = 16-02's 18 + 3
(the three criteria). No existing test changed and **no existing assertion was weakened**.

**Restore check — the measured one.** `cmp` against scratch copies, exit 0 for all four
planted files: `packages/net/src/agent.ts`, `packages/net/src/combine.ts`,
`packages/core/src/reduce.ts`, `packages/net/src/reduce-job.ts`. (`reduce-job.ts` is a
fourth file the plan did not list; Mutation E required it.)

**Reported, not measured** (a shared working tree cannot attribute a diff):
`git status --short` before commit showed exactly one entry, `??
packages/node/src/tree-reduce-agents.node.test.ts`. No file owned by 16-04 was touched —
no `packages/bench/**`, no `bin/bench.ts`, no `bench-reduce.node.test.ts`, no
`.planning/BENCHMARK-*.md`. `STATE.md` and `ROADMAP.md` were not modified.

## Deviations from Plan

### Rule 4 — STOPPED, decision required

**1. The combine gate.** Detailed above. Not applied.

### Auto-fixed

**2. [Rule 3 — Blocking] The worktree was created off the wrong base and had no
`node_modules`.** HEAD was `c62bae5` (a `main` merge), not `4f1a63d` (16-02's merge), so
16-01's and 16-02's work was absent entirely. The working tree was clean, so the
startup-sanctioned `git reset --hard` lost nothing. Farm built as above.

**3. [Rule 3 — Blocking] The plan's spawn arguments would not start a usable agent.**
`[AGENT, '--dir', dir]` leaves the agent pinned to the demo's kernel anchor, which
refuses the fixture module, so the map would fail before any partial existed.
`--trust-anchor` added, matching `two-process` and `sovereignty-placement`. The no-flag
claim is preserved and restated in measured form: the argument list contains no combine
flag, no reduce flag and no timeout flag, and `bin/agent.ts` grew none for this phase.

**4. [Rule 1 — Bug] The plan's `<verify>` blocks `cd` to the main checkout.** Every one
opens `cd /Volumes/ProjectsSSD/Projects/o2.services && …`, which would verify a tree this
plan never touched and report clean. Every gate was run from the worktree root. (Same
deviation 16-02 recorded; the plans were not corrected.)

**5. [Rule 2 — Correctness] Six mutations instead of the plan's three.** The plan's
Task 3 names A, B and C, all landing on criterion 1. D, E and F were added because
criteria 2 and 3 would otherwise have had no falsifying deletion at all, and an assertion
nobody watched fail is not a guarantee.

**6. [Rule 2 — Correctness] Corrected a number this plan's own file had written before
measuring it.** A first draft of the `afterEach` docstring claimed measured teardown of
1.2 s. Instrumented and measured: 4–33 ms. The instrumentation was removed and the
measured range written in its place. Recorded because writing an unmeasured quantity into
a comment is the exact failure this phase's plans open by prohibiting.

### Not deviations, but worth stating

- The mutation captures were taken with the combine gate opened. There is no way to take
  them otherwise, and the summary says so rather than presenting them as taken against
  the shipped tree.
- Criterion 3's *"arriving late"* clause remains **reported, never measured**:
  `executeReduce` has no late-arrival channel, so the duplicate is staged by the test.
  The dedupe property is what is measured. This is stated in the test file as well.
- **MR-02 is not claimed and is not listed.** Every job here is public; data moves
  map-side by construction.
- This is a **one-host** result. Eight OS processes share no heap, no event loop and no
  module registry, which is the boundary the criterion is about — but it is not
  cross-machine and the file's docstring says so in those words.

## Known Stubs

None. The three skipped `describe`s are not stubs — they are complete, executed,
verified-passing tests gated on a production defect, and both the gate and the
re-enablement step are named in the file.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| threat_flag: combine-unreachable-on-every-real-node | `packages/net/src/agent.ts` | **Availability, not confidentiality.** The combine branch refuses on `FabricNode` and `BrowserNode`, so the reduce cannot run in production. Recorded as a threat flag because the *fix* has a security dimension: admitting combines unauthenticated adds a CPU-spend surface beside the existing unauthenticated `exec` and `block` surfaces that 16-02 already recorded as an open residue. Whichever way it is decided, it should be decided rather than inherited. |

## What 16-04 and the verifier inherit

- **The blocker.** Any benchmark that drives `reduceJob` against `bin/agent.ts` or
  `FabricNode` will measure zero combines. `packages/bench/src/perf-workload.ts` builds
  its own `serveAgent` — check which `authorize` it passes before concluding anything
  from a reduce number.
- **The tree shape is confirmed**, not merely transcribed: `nodes` 3, `depth` 2 over 8
  leaves at fanout 4.
- **Wall clocks to size against**, measured with the gate open: 1.5 s (8 agents,
  criterion 1), 1.6 s (criterion 2), 1.9 s (9 agents, criterion 3). Teardown 4–33 ms.
- **The fan-out residue has a number now**: 17–41× the healthy run, measured under
  Mutation F.
- **Eight and nine concurrent agents are fine on one host** — no inbound-connection
  ceiling, no `MaxEarlyStreamsError`, at map redundancy 2.
- Seeds 41, 42, 111, 112, 113 remain taken; this plan added **58**.
- `partitionOf` here matches 16-02's throwing version exactly. Do not "restore" the `-1`.

## Self-Check: PASSED

- `packages/node/src/tree-reduce-agents.node.test.ts` — FOUND (984 lines, 1 green test + 3 skipped criteria)
- `.planning/phases/phase-16-decomposable-tree-reduce-wiring/16-03-SUMMARY.md` — FOUND
- Commit `3c01379` — FOUND
- `cmp` exit 0 — `agent.ts`, `combine.ts`, `reduce.ts`, `reduce-job.ts`
- `git status --short` — only this plan's own files
