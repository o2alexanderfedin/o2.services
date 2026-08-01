---
phase: phase-16-decomposable-tree-reduce-wiring
plan: 02
subsystem: reduce
tags: [reduce, combine, wire, dispatch, MR-03, MR-04, MR-05, MR-06, MR-07]
requires:
  - "16-01: fabricCombiner, asFabricPartial, MAX_COMBINE_INPUTS, the combine request/response frames"
provides:
  - "packages/net/src/agent.ts: runCombine — serveAgent answers a combine, no new AgentOptions field"
  - "@o2/net: remoteCombineDispatch — a CombineDispatch over an RpcEndpoint, with the directed fetch-back"
  - "@o2/net: reduceJob — a JobResult becomes a reduce over connected peers"
  - "MEASURED tree shape over 8 leaves at fanout 4: leaves 8, nodes 3, depth 2"
affects:
  - packages/net/src/agent.ts
  - packages/net/src/combine.ts
  - packages/net/src/reduce-job.ts
  - packages/net/src/index.ts
  - packages/net/src/combine.test.ts
  - packages/net/src/reduce-job.test.ts
  - packages/net/src/combine-wire.test.ts
tech-stack:
  added: []
  patterns:
    - "sequential fetch with early return as a measurable amplification bound, not a paragraph"
    - "directed fetch-back to the one peer known to hold a block, never a fan-out"
    - "ok (a reduce was attempted) kept distinct from outcome.ok (it produced an aggregate)"
key-files:
  created:
    - packages/net/src/combine.ts
    - packages/net/src/reduce-job.ts
    - packages/net/src/combine.test.ts
    - packages/net/src/reduce-job.test.ts
  modified:
    - packages/net/src/agent.ts
    - packages/net/src/index.ts
    - packages/net/src/combine-wire.test.ts
decisions:
  - "Fetch amplification on the combine frame: ACCEPTED and bounded, not closed. Bounded at the parser (k<=64), by a sequential early-return loop (measured 1 fetch not 4), and to zero on a node with a real Authorizer. Not closed for an unauthenticated node; that is SCHED-06's general answer, not a second bound invented for this branch."
  - "reduceJob's contributorId is the partition index, and is documented as NOT an owner id — JobResult preserves none. A constant contributor would dedupe two shards with byte-identical summaries into one leaf and undercount."
  - "remoteCombineDispatch discards every reason a peer gave. What survives is `failed` and `executedBy` — NOT `recomputes`, which was measured reading 0 while the root fell through all eight executors."
metrics:
  duration: ~35 min
  completed: 2026-07-31
  tasks: 3
  commits: 4
---

# Phase 16 Plan 02: The Production Call Path — Summary

`executeReduce`, `deriveReduceTree`, `rendezvousRank` and `Combiner` each have a
production caller for the first time: a node that answers a combine, a dispatcher that
runs one and brings its result home, and a driver that turns a `JobResult` into a tree.

## The measurement the rest of the phase depends on

**Run `deriveReduceTree` over eight leaves at `DEFAULT_FANOUT` (4). Read off, not
computed on paper:**

| Figure | Value |
|---|---|
| `tree.leaves.length` | **8** (the shard count — this test's own input) |
| `tree.nodes.length` | **3** |
| `tree.depth` | **2** |
| `tree.fanout` | **4** |
| node layout | `L1(4 children)`, `L1(4 children)`, `L2(2 children)` |

**Plans 16-03 and 16-04 must transcribe `nodes.length = 3` and `depth = 2` from this
table, never from arithmetic.** Both are asserted in `reduce-job.test.ts`, in the
end-to-end case and again in a standalone derivation case.

## What changed

**Task 1 — `serveAgent` answers a combine** (`320af51`)

`runCombine` reads each named input by CID through the blockstore `serveAgent` already
takes, bounds it against `MAX_PARTIAL_BYTES` — the constant's **first production
reader** — merges with `fabricCombiner`, and writes the result to its own local tier.
No `AgentOptions` field was added (`grep -c 'readonly combine'` is `0`), because if
combining were a capability a node could lack, rendezvous ranking would be selecting
among nodes that differ in what they can do.

16-01's placeholder branch and the `describe` asserting its reply were deleted in the
same commit. `grep -c 'not implemented in this build' packages/net/src` is **0**.

**Task 2 — `remoteCombineDispatch`** (`2200ca5`)

The remote sibling of `localDispatch`, plus the step that makes a tree deeper than one
level work at all — see the capture below.

**Task 3 — `reduceJob`** (`1f2f082`)

Projects each agreed shard's decoded output, stores each partial, derives the tree, and
executes it over connected peers, naming the partition indices it skipped rather than
presenting a partial aggregate as complete.

## The capture that shows the fetch-back is load-bearing

The plan required this run to be **watched failing** before the mechanism was trusted.
The eight-node fabric was run with `remoteCombineDispatch` returning the CID alone and
no directed fetch-back. Verbatim:

```
submitJob ok      = true complete = true
result.ok         = true
tree.nodes.length = 3
tree.depth        = 2
outcome.ok        = false
outcome.rootCid   = null
outcome.combines  = 2
outcome.recomputes= 0
outcome.failed    = ["9c382074fe301ddb1ad7345ed4fe07593d8f1eb8a153957878009db077d35045"]
failed contains rootId = true
executedBy.size   = 2
```

Level 1's two combines succeed — their inputs are the leaves, which the requestor
stores and serves. Level 2 fails everywhere, because its inputs are level-1 *results*
that live only on the executors that produced them, that nothing announces, and that no
executor's block source can see on another executor. The healthy run is `combines: 3`,
`executedBy.size: 3`, `failed: []`, `rootCid` non-null.

**Two findings fell out of this capture that were not in the plan.**

1. **`result.ok` is `true` in the total-failure case.** This is exactly why `ok` versus
   `outcome.ok` is documented on the type rather than left to a reader. A caller
   checking `ok` alone would report a job that produced no aggregate as a success.
2. **`recomputes` reads `0` while the root fell through all eight executors** — see the
   correction below.

## A false claim this plan wrote and then corrected against a measurement

Task 2 shipped a `combine.ts` docstring saying the diagnostics surviving the loss of
peer reason strings are *"`ReduceOutcome.recomputes` plus `executedBy`"*. **That is
false, and it is false in the one case an operator most needs it.**

`executeReduce` adds `attempts` to `recomputes` only for a combine that *eventually
produced a CID*; a combine that failed outright takes the `continue` at
`packages/core/src/reduce.ts:399` and its attempts are discarded. The capture above
measured `recomputes: 0` for a run whose root combine walked the entire eight-executor
ranking and got nothing.

Corrected in Task 3's commit: the diagnostics that survive are **`failed`** (which
combines produced nothing) and **`executedBy`** (who answered for the ones that did).
`recomputes` measures churn among *successes* and reads zero on total failure.

This is the same class of defect 16-01 caught twice, produced this time by this plan
rather than inherited — the reason it was caught is that the capture was actually run
instead of predicted.

## The fetch-amplification threat, decided

16-01 flagged this and deliberately left the disposition here, because this is where the
fetches happen. **Decision: accepted and bounded, not closed.** Three properties, all
measurable, all asserted:

1. **`MAX_COMBINE_INPUTS` bounds *k* at the parser** — a frame naming more inputs never
   becomes a request, so the handler is never entered for one.
2. **The loop is sequential with an early return, never a `Promise.all`.** The first
   input the node refuses ends the frame's cost at the inputs before it. **Measured: a
   frame naming five inputs whose second is unobtainable costs 1 block over the wire; an
   eager fetch-then-validate costs 4** — while answering the *identical* null arm, which
   is why the count is asserted and not only the reply.
3. **A node with a real `Authorizer` pays zero reads** — the refusal precedes the loop,
   proven by a counting blockstore.

**What is not closed, stated rather than inferred:** a node serving unauthenticated
still answers up to `MAX_COMBINE_INPUTS` reads per frame, and each read through a
`FetchingBlockstore` has by then already pulled the block, hash-verified it and written
it locally. So `MAX_PARTIAL_BYTES` bounds what a node will **merge**, never what a peer
can make it transfer or keep. NET-08 **has landed** and bounds one inbound message; no
product of the two is written anywhere, because an unmeasured residency figure is not a
guarantee. This surface is the same *kind* the `exec` and `block` branches already
present, and the general answer is per-request admission (SCHED-06), not a second bound
invented for this branch alone.

## A decision the plan did not anticipate: what a contribution is attributed to

The plan's interfaces block said `deriveReduceTree(partialCids: readonly CID[])`. It
takes `ReduceContribution[]` — `{contributorId, cid}` — so `reduceJob` had to choose a
contributor, and the plan gives no guidance because it predates the change.

**Chosen: the partition index (`shard-${partitionIndex}`), documented in source as
explicitly NOT an owner id.** `ShardResult` carries no owner and `JobResult` does not
preserve `ShardSpec.ownerId`, so nothing here can attribute a partial to an owner, and
`ReduceContribution`'s sovereignty language is **not** established by this line.

The index is nonetheless the right discriminator, and coarser is a bug rather than a
simplification: a public job's shards all belong to the requestor, so a single constant
contributor would make two shards with byte-identical summaries dedupe into one leaf and
undercount — precisely the silent undercount `ReduceContribution` exists to prevent,
arriving from the other direction. Two shards are two batches of rows even when their
summaries coincide.

`result.leaves` stays `readonly CID[]` as 16-03 and 16-04 declare; contributor ids are
visible through `tree.leaves[i].id`.

## How each claim was proven able to fail

Every assertion was watched failing first. Mutations were planted and restored with `cp`
from a scratch baseline, confirmed byte-identical with `cmp` — never `git
checkout`/`restore`/`clean`, because this working tree is shared.

| Claim | Mutation | Result |
|---|---|---|
| the handler exists at all (RED) | none — ran before writing it | 6 red against `'combine not implemented in this build'` |
| a production entry point calls the combine branch | branch answers a literal instead of `runCombine` | 7 red |
| the combine ran remotely, on blocks it asked for | the input read forced to `undefined` | 6 red |
| a refusal precedes the work | `authorize` check moved below the fetch loop | **1 red — `gets` 2, not 0**, while the reason assertion stayed green. Exactly why both are asserted |
| the frame's cost stops at the first refusal | loop replaced by eager `Promise.all` | **1 red — `fetched` 4, not 1**, while the reply stayed the identical null arm |
| `remoteCombineDispatch` exists (RED) | none — ran before writing it | `Cannot find module './combine.ts'` |
| the result is fetched back from the producer | the `block` request deleted | 4 red, incl. residency in a store with no network fallback, and failure causes (f) and (g) |
| a level-2 combine reaches its inputs | same deletion, eight-node fabric | captured verbatim above |
| `reduceJob` exists (RED) | none — ran before writing it | `Cannot find module './reduce-job.ts'` |
| a skipped shard is reported, not dropped | `skipped.push(...)` deleted | 1 red — `[]` vs `[1, 3]` |
| two replicas dedupe rather than disagree | `redundancy` pass-through deleted | 1 red — `minReplicas` 1, not 2 |
| the aggregate depends on what the guests produced | projection keyed on `partitionIndex` | **the assertion inverts** — `expected X not to be X`. Both sides became the same arithmetic |
| associativity is enforced (phase criterion) | `rows = rows * 2 + partial.rows` in `fabricCombiner` | **7 red — both core single-node reference comparisons (`reduce.test.ts:234`, `:263`) AND this plan's eight-node wire-level comparison** |

Two guards have **no** falsifying deletion, and that is correct rather than an omission:

- the `Object.keys` shape guards on the combine frame and the follow-up `block` frame
  fire on **addition**, which is the direction a payload arrives from;
- the MR-05 assignment identity (`executedBy.get(node.id) === rendezvousRank(...)[0]`)
  compares `executeReduce`'s bookkeeping against the pure function it itself called.
  Plan 16-03's process-level measurement is the one with a deletion.

The egress `releases === 0` assertion across a combine **passed at RED**, and is reported
as a regression guard rather than a new-feature proof. Its positive control is real,
though: `releases >= 1` across a sovereign exec was genuinely red before a macrotask
drain was added, which is what proves the counter is wired rather than silent.

## Citation drift

Every `file:line` in the plan was re-grepped. **The structural claims held; the line
numbers almost all did not** — the same finding as Phase 15 and 16-01.

| Plan citation | Claim | Actual | Verdict |
|---|---|---|---|
| `AgentOptions.egress: EgressGuard \| 'holds-no-registrations'` | interfaces block | `{guard: EgressGuard; sovereignInputs: Blockstore} \| 'holds-no-registrations'` | **WRONG** — structural, not drift. Hit while building the egress test |
| `deriveReduceTree(partialCids: readonly CID[], …)` | interfaces block | `(contributions: readonly ReduceContribution[], …)` | **WRONG** — as 16-01 warned |
| `ReduceTree.leaves: readonly string[]` | interfaces block | `readonly ReduceLeaf[]` (`{id, cid}`) | **WRONG** |
| "the nine sentinel literals every AgentOptions needs" | `distributed.test.ts` | **seven** sentinels (10 fields, 3 without) | **WRONG** |
| `cd /Volumes/…/o2.services && npx tsc --noEmit` | every `<verify>` block | that path is the **main checkout**, not this worktree — it would verify the wrong tree | **WRONG** — ran from the worktree root instead |
| `MAX_PARTIAL_BYTES` "declared in Plan 16-01" | interfaces block | pre-dates 16-01; 16-01 added only `MAX_COMBINE_INPUTS` | minor |
| `purity.node.test.ts:167` | zero `@o2/*` deps in core | `:167` | **correct** |
| `purity.node.test.ts:28` | `@o2/net` in the PORTABLE set | `:28` | **correct** |
| `block.ts:65-67` | `FetchingBlockstore.put` delegates to local | `:65-67` | **correct** |
| `block.ts:74-76` | the in-flight map | `:73-81` | **correct** |
| `distributed.test.ts:70` | `RpcBlockSource(rpc, () => ['origin'])` | `:70` | **correct** |
| `memory.ts:116-118` | `MemoryNetwork.peers` | `:116-118` | **correct** |
| `memory.ts:9-11` | "100+ nodes in one process" docstring | `:9-11` | **correct** |
| `agent.ts:166-201` | the flat else-if ladder | ladder from `:241`; combine branch `:327` pre-edit | drifted |
| `agent.ts:201` | the bare `} else {` | `:336` pre-edit (16-01 already said `:327` for its own insert point) | drifted |
| `agent.ts:201-251` | the exec branch | `:336-467` pre-edit | drifted |
| `reduce.ts:99` / `:102` | `RangeError` fanout / empty | `:194` / `:196` | drifted |
| `reduce.ts:106` | the dedupe | `:204` | drifted |
| `reduce.ts:116-120` | lone-child promotion | `:218-222` | drifted |
| `reduce.ts:98-137` | `deriveReduceTree` | `:189-239` | drifted |
| `reduce.ts:154-169` | `CombineTask` / `CombineDispatch` | `:256-271` | drifted |
| `reduce.ts:219-323` | `executeReduce` | `:321-426` | drifted |
| `reduce.ts:248` | the per-level `Promise.all` | `:351` | drifted |
| `reduce.ts:262-279` / `:271-279` | the ranking walk | `:359-382` / `:374-382` | drifted |
| `reduce.ts:305-307` | disagreement push | `:409` | drifted |
| `reduce.ts:335-366` | `localDispatch` | `:547-570` | drifted |
| `reduce.ts:350` | `liveNodes()` gating | `:554` | drifted |
| `submit.ts:255-268` | `ShardResult` / `JobResult` | `:78-91` / `:93-121` | drifted badly |
| `submit.ts:239-242` | `submitJob` puts each agreed output | `:271` | drifted |
| `verify.ts:110-135` | `VerificationResult` | `:85` | drifted |
| `fabric-node.ts:411` / `:420` / `:376` | `serveAgent` / `serves-no-records` / sovereign registration | `:741` / `:770` / `:749` | drifted badly |
| `browser-node.ts:264` / `:256-262` | `serveAgent` / sovereign registration | `:564` / `:572` | drifted badly |
| `bin/bench.ts:144` / `:170` | the two `serveAgent` call sites | `:320` / `:363` | drifted badly |
| `bin/bench.ts:152` / `:177` | `index: 'serves-no-records'` | `:333` / `:372` | drifted badly |
| `bin/bench.ts:168` / `:147` | worker `RpcBlockSource` / `originStore` | `:361` / `:306` | drifted badly |
| `distributed.test.ts:40-90` | `twoNodeFabric` | `:40-93` | close |
| `distributed.test.ts:509-545` | the AUTH-03 test | `:509-566` | close |
| `distributed.test.ts:52` | origin serves a plain `MemoryBlockstore` | `:43`/`:52` | close |
| `rpc.ts:23` | the timeout declaration | `DEFAULT_RPC_TIMEOUT_MS` at `:25` | drifted (16-01 found the same) |

**For 16-03 and 16-04:** the two reference comparisons in `packages/core/src/reduce.test.ts`
are now at `:234` (*matches a one-shot reduction over the same eight partials*) and
`:263` (*is unchanged by fanout*), inside the `describe` at `:233`. 16-01 recorded `:268`
and `:454`; those are stale.

## Verification

Run against a resolver **proven** to read this worktree. The worktree had no
`node_modules`, and the obvious fix is silently wrong — the main install's `@o2/*`
entries are *relative* symlinks (`@o2/core -> ../../packages/core`) resolving back to the
main checkout, so a wholesale symlink would have type-checked and tested the wrong tree
and reported clean without reading a line of this work. A farm was built instead:
third-party absolute-symlinked from the main install, every `@o2/*` repointed here.
Proof, via `createRequire`:

```
@o2/core   -> …/agent-a2f5def53755ca51f/packages/core/src/index.ts
@o2/net    -> …/agent-a2f5def53755ca51f/packages/net/src/index.ts
@o2/libp2p -> …/agent-a2f5def53755ca51f/packages/libp2p/src/index.ts
multiformats -> /Volumes/ProjectsSSD/Projects/o2.services/node_modules/…
```

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (whole repository, worktree root) | **exit 0** |
| `vitest run --project node packages/net` | **216 passed** (21 files; was 189/19) |
| `vitest run --project node packages/net/src/combine.test.ts` | 19 passed |
| `vitest run --project node packages/net/src/reduce-job.test.ts` | 9 passed |
| `vitest run --project node packages/core/src/reduce.test.ts` | 28 passed, unchanged |
| `vitest run --project node` — `vocabulary` + `purity` (run **after** commit) | 38 passed |
| `vitest run --project browser` (combine + reduce-job) | **84 passed**, 6 files — the new modules are portable |
| `O2_UNIT_ONLY=1 vitest run --project node` (full) | **1214 passed, 18 skipped, 0 failed** |

1214 = 16-01's 1187 baseline + 28 new − 1 deleted placeholder test. `agent-contract.test.ts`
and `distributed.test.ts` pass **with no edit**, which is the measured form of "no hook was
added".

**Boundary gates, all reported and all held.** `git diff --stat` against this plan's base
touches exactly the seven files the plan names:

```
packages/net/src/agent.ts             | 148 ++-
packages/net/src/combine-wire.test.ts |  54 +--
packages/net/src/combine.test.ts      | 719 +++++
packages/net/src/combine.ts           | 142 +++
packages/net/src/index.ts             |   8 +
packages/net/src/reduce-job.test.ts   | 383 +++
packages/net/src/reduce-job.ts        | 200 +++
```

No `fabric-node.ts`, no `browser-node.ts`, no `bin/bench.ts` — the four production
`serveAgent` call sites inherit the combine handler with no edit, which is the whole
content of 16-CONTEXT.md decision 2. No `placement.ts`, no `coordinator.ts` — the
placement chain was not crossed. `grep -c 'readonly combine' packages/net/src/agent.ts`
is `0`; `grep -c 'not implemented in this build' packages/net/src` is `0`.

No existing assertion was weakened. The only change to a pre-existing test file was the
deletion of the placeholder `describe` in `combine-wire.test.ts`, which the plan
requires and which this plan makes false.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] The plan's `<verify>` commands `cd` to the main checkout.** Every
`<verify>` block opens `cd /Volumes/ProjectsSSD/Projects/o2.services && …`, which is the
main working tree, not this worktree. Running them as written would have verified code
this plan never touched. Ran every gate from the worktree root against the proven farm.

**2. [Rule 2 — Correctness] Refused to write the plan's `MAX_PARTIAL_BYTES` comment.**
The plan's `<action>` directs the handler comment to say *"There is no wire byte ceiling
underneath — … NET-08 (Phase 13.1) has not landed."* NET-08 **has** landed
(`MAX_INBOUND_MESSAGE_BYTES` in `@o2/libp2p`), exactly as 16-01 recorded. Writing it
would have shipped a false security claim into source for the second time in one phase.
The measured truth was written instead.

**3. [Rule 1 — Bug] Corrected a false claim this plan itself shipped.** The `recomputes`
sentence in `combine.ts`, detailed above. Found by running the capture the plan asked
for rather than predicting its numbers.

**4. [Rule 2 — Correctness] Added an amplification-bound test the plan did not specify.**
The plan asks for the fetch-amplification threat to be "explicitly decided and stated". A
stated disposition with nothing measuring it is a comment, so the sequential early-return
property was made an assertion with a falsifying mutation (1 fetch vs 4).

**5. [Rule 3 — Blocking] Worktree had no `node_modules` and was created off the wrong
base.** HEAD was `c62bae5` (a `main` merge) rather than the expected `f1150c9`
(16-01's merge), so 16-01's work was absent. The working tree was clean, so the
startup-sanctioned `git reset --hard` lost nothing. Dependency farm built as above.

### Not deviations, but worth stating

- The plan's `<behavior>` for Task 2 lists an unreachable-peer case timing out. That test
  arms two clocks — a 50 ms RPC budget against vitest's default 5 s test timeout — and the
  framework's is deliberately the larger.
- `combine.test.ts` needed one macrotask drain (`setTimeout(…, 0)`) before reading the
  egress release counter. `MemoryNetwork.route` delivers synchronously, so the serving
  side's post-send `finally` is a microtask that can be queued behind the requesting
  side's continuation. This waits on a queue, not a duration, and is commented as such.
- `localDispatch` still has no production caller and is kept, per the plan's explicit
  `## Out of scope` ruling.

## Known Stubs

None. 16-01's single stub — the placeholder combine branch — was the thing this plan
replaced, and the test asserting it was deleted in the same commit.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| threat_flag: unauthenticated-fetch-amplification (**disposition recorded, residue open**) | `packages/net/src/agent.ts` | 16-01's flag is now decided: bounded at the parser (k≤64), by a sequential early-return loop (measured 1 fetch vs 4), and to zero under a real `Authorizer`. **Residue:** an unauthenticated node still answers up to `MAX_COMBINE_INPUTS` reads per frame, each already resident before `MAX_PARTIAL_BYTES` can refuse the merge. Same kind as the pre-existing `exec`/`block` surface; the general answer is SCHED-06 per-request admission, not a bound invented for this branch. |
| threat_flag: requestor-serves-the-whole-tree | `packages/net/src/reduce-job.ts` | The requestor stores every projected leaf **and**, after the directed fetch-back, every intermediate aggregate, in a blockstore it serves to peers. Any connected peer can fetch any of them by CID. **Accepted:** a partial is by construction a summary — what `MAX_PARTIAL_BYTES` exists to keep true — and a sovereign input never becomes a leaf, because `reduceJob` projects the shard's agreed *output* and a sovereign task's raw input never left its owner's node. |
| threat_flag: unverified-projection | `packages/net/src/reduce-job.ts` | `reduceJob` applies a caller-supplied function to its own shard outputs and stores the results as the leaves everything else derives from. Nothing verifies it. Pre-existing and named in `fabricCombiner`'s docstring; restated here because this is the function that applies one. |
| threat_flag: aggregation-unverified-at-redundancy-1 | `packages/net/src/reduce-job.ts` | At `redundancy: 1` there is no second executor and nothing checks a combine node's answer, so a wrong answer that looks right is undetected. The mechanism against it is `redundancy >= 2`, asserted by the `minReplicas`/`disagreements` pair. The parameter is the caller's, and so is the exposure. |

## What 16-03 and 16-04 inherit

- **The tree shape, measured:** `nodes.length = 3`, `depth = 2` over 8 leaves at fanout 4.
  Transcribe from the table at the top of this file. Never compute it.
- `reduceJob(job, {rpc, executors, blockstore, project, fanout?, redundancy?})` →
  `{ok: true, outcome, tree, leaves, skipped} | {ok: false, reason}`.
- **`ok` is not `outcome.ok`.** Measured: the level-2 failure reports `ok: true` with
  `outcome.ok: false`. A proof-table row asserting the former while describing the latter
  is the misreading the type doc exists to prevent — 16-03's criterion-2 measurement 4
  already calls this out and it is correct to.
- **`recomputes` is not a total-failure diagnostic.** It reads 0 when every attempt on a
  combine failed. Use `failed` and `executedBy`.
- `reduceJob` passes its `blockstore` straight to `remoteCombineDispatch`, whose
  fetch-back ends in `put`. 16-03's warning that `submitter.store` is disqualified as a
  delta instrument is **confirmed correct** — use the empty probe store.
- Deleting `await options.blockstore.put(reply.bytes)` in `combine.ts` is the live
  falsifying mutation for "a level-2 combine reaches its inputs", exactly as 16-03 states.
- Seeds 41, 42, 111, 112, 113 remain taken; this plan added no seeded test.

## Self-Check: PASSED

- `packages/net/src/agent.ts` — FOUND (`runCombine` at `:277`, combine branch at `:457`)
- `packages/net/src/combine.ts` — FOUND (`remoteCombineDispatch` exported)
- `packages/net/src/reduce-job.ts` — FOUND (`reduceJob` exported)
- `packages/net/src/combine.test.ts` — FOUND (19 tests)
- `packages/net/src/reduce-job.test.ts` — FOUND (9 tests)
- `packages/net/src/index.ts` — FOUND (both new export blocks)
- `packages/net/src/combine-wire.test.ts` — FOUND (placeholder `describe` deleted)
- Commit `320af51` — FOUND
- Commit `2200ca5` — FOUND
- Commit `1f2f082` — FOUND
