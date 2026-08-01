---
phase: phase-16-decomposable-tree-reduce-wiring
plan: 04
subsystem: benchmark
tags: [reduce, benchmark, methodology, MR-03, MR-04, MR-05]
requires:
  - "@o2/net reduceJob (16-02)"
  - "@o2/core deriveReduceTree, executeReduce (16-01)"
provides:
  - "ReduceObservation / ReduceReport in @o2/bench"
  - "a reduce leg on bin/bench.ts's measured job path"
  - "two Reduce tree tables in the published artifact"
  - "bench-reduce.node.test.ts — 11 requirements over source and artifact"
affects:
  - packages/bench
  - packages/node/src/bin/bench.ts
  - .planning/BENCHMARK-METHODOLOGY.md
  - .planning/BENCHMARK-RESULTS.md
  - .planning/REQUIREMENTS.md
tech-stack:
  added: []
  patterns: [call-site shape guard, published-artifact guard, pre-registered amendment]
key-files:
  created:
    - packages/node/src/bench-reduce.node.test.ts
    - .planning/phases/phase-16-decomposable-tree-reduce-wiring/deferred-items.md
  modified:
    - packages/bench/src/harness.ts
    - packages/bench/src/report.ts
    - packages/bench/src/index.ts
    - packages/bench/src/harness.test.ts
    - packages/bench/src/perf-workload.ts
    - packages/node/src/bin/bench.ts
    - .planning/BENCHMARK-METHODOLOGY.md
    - .planning/BENCHMARK-RESULTS.md
    - .planning/REQUIREMENTS.md
decisions:
  - "makespan keeps its bracket AND its sample: `complete` untouched, reduce verdict in its own field"
  - "the reduce table's unmeasured cells render as em dashes, never zeros"
  - "MEASURED_TREE_DEPTH/COMBINES measured at 16 shards, not transcribed from 16-02's 8"
  - "the real-transport reduce is published as refused, not weakened into a populated row"
metrics:
  duration: ~2h
  completed: 2026-07-31
---

# Phase 16 Plan 04: Make `bin/bench.ts` Measure the Reduce It Runs Summary

The benchmark driver now runs `reduceJob` on every job it measures and publishes tree
depth, combine count, distinct combine executors, recomputes and its own timing — measured
on the memory transport, and published as a **refusal** on the real transport, where every
`FabricNode` fails a combine closed for a named reason.

## What shipped

`Observation` carries a required `reduce` group and `SweepResult` a `ReduceReport`.
`renderMarkdown` emits a reduce table per transport, adjacent to the makespan tables.
`bin/bench.ts` times the reduce in its own `performance.now()` bracket, opened strictly
after the makespan bracket closes. Eleven guard requirements hold the wiring and the
artifact.

## The measured result

Full run, **2026-08-01T05:38:05Z** (single-process driver; Phase 23 adds the
multi-process one and no figure here may be silently replaced by it).

Reduce tree — memory transport, per rung:

| nodes | reduce p50 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|
| 1 | 0.984ms | 2 | 5 | 0 | 1 |
| 2 | 1.3ms | 2 | 5 | 0 | 2 |
| 4 | 1.3ms | 2 | 5 | 0 | 3 |
| 8 | 1.3ms | 2 | 5 | 0 | 4 |
| 16 | 1.4ms | 2 | 5 | 0 | 5 |

`combine executors` rising 1→5 with the node count is the column that carries MR-05.
`tree depth` and `combines` are **constant across the whole ladder** — recorded as observed,
and the `unmet` list, the `ReduceObservation` doc and Amendments ¶5 each warn a reader that
a constant column is not a result.

Reduce tree — real transport: **every rung an em dash on all four measured rungs.**

## Two findings

### 1. The real-transport reduce cannot be measured on this build

Every combine fails at level 1: `combines: 0, failed: 5, executedBy: 0, rootCid: null`.
Cause read off the wire rather than guessed — I instrumented `remoteCombineDispatch` to
print the discarded `reason` and restored it (`cmp`-confirmed):

> `combine requires a capability chain this build cannot verify`

`serveAgent`'s combine branch refuses unless `authorize` is the `serves-unauthenticated`
sentinel, because an `Authorizer` takes a `Task` and a combine has none. That gap was made
to fail closed by 16-02 and routed to **AUTH-03, Phase 15**. Every `FabricNode` supplies a
real `authorizeCapability`, so the whole real-transport rig refuses.

**Nothing was weakened to populate that row.** Passing `serves-unauthenticated` to
`FabricNode` would have removed authorization from the production node factory. The em dash
is the honest rendering, and this is precisely the case Task 1's rendering rule was built
for — without it those rows would read `0 0 0 0`, i.e. "the reduce ran and combined
nothing".

**This also predicts something for 16-03:** `bin/agent.ts` starts a `FabricNode`, so eight
spawned agents will refuse combines the same way. That is 16-03's finding to make; flagged
here because it is the same root cause.

### 2. The driver has a pre-existing liveness defect (out of scope, logged)

Recorded in `deferred-items.md`. The process does not exit after a full run (artifact
written at 14 s, still alive and idle 73 s later), and the leg after the real ladder
**intermittently** stalls for tens of minutes — two runs of the identical configuration
differed by ~2400× under different machine load. The reduce is present and healthy in every
fast case (1.3 ms against a 45 ms map), so it is not the cause. Routed to Phase 23, whose
per-rung process isolation would make both symptoms structurally impossible.

## Deviations from plan

### [Rule 1 — Bug] The plan's tree figures were for the wrong shard count

The plan instructed transcribing 16-02's `nodes: 3, depth: 2` into the guard's
`MEASURED_TREE_DEPTH`/`MEASURED_COMBINES`. **16-02 measured 8 leaves; `bin/bench.ts` ships
`SHARDS = 16`** (raised from 8 by phase 13.1). Transcribing `3` would have failed the guard
against a *correct* run. I measured instead — the production `deriveReduceTree` over the
production projection's output at 16 contributions, fanout 4: `nodes: 5, depth: 2`. The
same method at 8 leaves reproduces 16-02 exactly, which is what licenses using it at 16.
Confirmed end to end by the published run.

Both the plan's `<interfaces>` block *and* the orchestrator's briefing state `SHARDS = 8`.
Both are wrong.

### [Rule 3 — Blocking] A third `Observation` constructor the plan never mentions

`packages/bench/src/perf-workload.ts` also builds an `Observation`, so the required field
broke it. The perf gate deliberately gets a **not-measured sentinel** rather than a reduce
leg: its assertions are wall-clock comparisons against the committed `perf-baseline.ts`, and
a second timed segment would report a change of workload as a change of speed.

The plan also said one edit to `observation()` would close the compile break; `point()`, the
`SweepResult` factory, needed one too.

### [Rule 1 — Bug] My REQUIREMENTS.md rows broke the traceability guard

Caught by the unit sweep, not by tsc. `acceptance-traceability.node.test.ts` reads a status
cell as `Verdict — argument` and fails any leading verdict outside a measured set. Fixed by
writing the rows in the table's own convention — **not** by adding my words to
`RECOGNISED_STATUSES`, since that array's docstring says widening it to fit new data is the
failure it exists to prevent. MR-03…MR-07 read **Partial**; MR-02 keeps **Built, not
wired**. No checkbox changed.

### [Rule 3 — Blocking] Environment

The worktree had no `node_modules`. Built a farm of relative symlinks with `@o2/*` pointing
at *this* worktree and proved it with `createRequire(...).resolve` — all five `@o2` packages
resolve under the worktree root; `vitest`/`typescript` come from the main install.

### A third `unmet` entry, beyond the plan's "two entries, and only two"

Finding 1 made two entries insufficient: a wholly em-dashed real-transport table with no
stated cause is indistinguishable from a missing feature. Amendments gained a matching ¶7.

## What was watched failing first

Every assertion, by planting and restoring (`cp`, `cmp`-confirmed):

| Mutation | Caught by |
|---|---|
| `complete` coupled to `reduce.ok` in `measure` | `makespan.n` 3 → 2 |
| em-dash rule removed from `reduceTable` | row rendered `0 0 0 0` |
| max/sum → mean in `reduceOf` | `combines` 5 → 4 |
| each of the 6 call-site requirements omitted | reported by name, `toEqual` |
| `complete` grows `&& reduce.ok` | the forbidden-pattern half |
| makespan bracket widened past the reduce | the order assertion **only** — all six patterns stayed green, which is why it exists separately |
| artifact requirements vs. the committed 2026-07-29 page | all four RED, then green after regeneration |

## Citation drift

Every `file:line` in the plan was re-grepped. Line numbers are pre-edit.

| Plan citation | Actual | Verdict |
|---|---|---|
| `SHARDS = 8` at `bin/bench.ts:64` | `SHARDS = 16` at `:81` | **value wrong** |
| `.planning/BENCHMARK-RESULTS.md` is "a FULL run, dated 2026-07-27, all five rungs" | a **`--quick`** run dated **2026-07-29**, three memory rungs, n=5 | **substantively wrong** |
| block source `() => ['requestor']` at `:168` | `:361` | drifted |
| `MemoryBlockstore` at `:147` | `:307`/`:318` | drifted |
| identity comment at `:302-306` | `:549-553` | drifted |
| `unmet` list at `:462-487` | `:717-742` | drifted |
| makespan bracket at `:266`/`:278` | `:509`/`:525` | drifted |
| `deriveReduceTree` at `reduce.ts:98-131` | `:189-239` | drifted |
| dedupe at `reduce.ts:106` | `:201-205` | drifted |
| `recomputes` increment at `reduce.ts:303` | `:406` | drifted |
| `harness.ts:154` / `:161` | `:156` / `:160` | close |
| `harness.ts:60` (`complete` doc) | `:61-62` | close |
| `REQUIREMENTS.md:581-586` MR rows | `:583-588` | drifted |
| `REQUIREMENTS.md:371` milestone slice | `:373` | drifted |
| `BENCHMARK-METHODOLOGY.md:55-70` §2.1 | `:59-72` | close |
| `BENCHMARK-METHODOLOGY.md:255-268` Amendments | `:264-266` | drifted |
| `distributed.test.ts:25-30` projection | `:24-29`, and it does return `-1` | close, content correct |
| `demo/src/job.ts:231-238` `answerOf` | `:231` | correct |
| `browser/demo/main.ts:331` `answerOf` call | `:443` (import at `:37`) | drifted |
| `harness.test.ts:25-45`, `harness.ts:155-167`, `harness.ts:40`, `bin/bench.ts:517` | as stated | correct |
| `Fabric` interface listing | omits `moduleRecord` | incomplete |
| Task 1 `<verify>`: `tsc --noEmit -p packages/bench` | no tsconfig in `packages/bench` — command cannot run | **broken** |
| every `<verify>` block | `cd`s to the MAIN checkout | **would verify the wrong tree** |

## Verification

- `npx tsc --noEmit` clean, against a resolver proven to read this worktree.
- `vitest --project node`: `packages/bench` + `bench-reduce` + `bench-egress` + `vocabulary`
  → **100 passed**. `vocabulary.node.test.ts` run after committing, since it scans `git ls-files`.
- Full unit sweep `O2_UNIT_ONLY=1 --project node` → **1237 passed**, 18 skipped, 0 failed.
- Not run: the `perf` project (`O2_PERF=1`). Its assertions are wall-clock and the machine
  was under contention from a parallel worktree; `perf-workload.ts`'s change is additive and
  type-checked, and nothing there reads `SweepResult.reduce`.

## Left for Phase 23, deliberately

- **Extracting the ladder loop from `main()`** behind an exported function a test could
  drive. Until then no test can establish that the reduce was measured *on this commit* —
  the artifact guard proves only what the last published run contained, and its docstring
  says so in those words.
- **The liveness defect** in `deferred-items.md` (non-exiting process; intermittent stall).
- `renderMarkdown`'s section order, `Observation`/`SweepResult` shape and `runnerFor`'s
  closure were **added to, never restructured**, per the plan's merge-shape obligation.

## What criterion 4 does not measure

Its second clause — *"rather than bypassing `executeReduce` the way the demo currently
does"* — is **unmeasured, and unmeasured is not met.** `answerOf` keeps its sole production
caller in `packages/browser/demo/main.ts`; both `packages/demo` and `packages/browser` are
untouched (confirmed by `git diff --stat`). Routed to **WIRE-02, Phase 22**, and the
requirement rows now say so rather than closing on half a reason.
