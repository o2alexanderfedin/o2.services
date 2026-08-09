---
phase: phase-22-reachability-guard
plan: 01
status: complete
date: 2026-08-08
commits:
  - fa9820c  # Task 1 — the corpus
  - 9f30271  # Tasks 2 and 3 — the call graph and the two readings
requirements: [WIRE-02]
---

# 22-01 — The tracer, and proof that it can fail

**This plan renders no verdict about the tree's health, and nothing below may be read as one.**
It built the instrument the other three plans read, and it established that the instrument can be
wrong. The 58 unreached symbols recorded here are a *reading*, not a finding: granting or refusing
a disposition to any of them is 22-03's work, and 22-03 stops for the owner.

## What exists now

| Artifact | What it carries |
|---|---|
| `packages/node/src/reachability.ts` | the corpus, a declaration-level call graph over five edge classes, both granularity arms, and a pure verdict predicate |
| `packages/node/src/reachability.node.test.ts` | 37 cases — floors, anchors in both directions, five ablations, and every plant below |

Exported as the plan specified: `barrelExports`, `reachableFrom`, `ENTRY_POINTS`.

## The readings, and what they were sited against

Sited on `feature/phase-18-discovery-capacity-placement` at `fa9820c`, 2026-08-08, with Phases 20,
21, 23 and 24 landed and Phase 22 otherwise unbuilt.

```
corpus      604 exports — 217 callable, 111 other value, 276 type-only, over 8 barrels
graph       139 files, 1821 nodes, 700 callers, 12 same-name merges
reach       1071 declaration nodes; 118 of 139 modules
arms        declaration unreached 58 · module unreached 0 · GAP 58
cost        real 7.95 / 7.97   user 13.48 / 13.68   sys 3.26 / 3.31   (user+sys)/real 2.10 / 2.13
```

**The plan's own corpus numbers were stale and were re-measured rather than inherited** — it
recorded 209 callable / 581 total / 869 files from 2026-08-04. The growth is `bench` +7 and
`libp2p` +1. The plan anticipated this by calling its interface block *"a starting point, not an
authority"* and demanding floors over equalities; following the instruction rather than the
figures is the whole point, and an agent that had pinned 209 would have shipped a guard that
reddened on arrival.

## Six claims that measured false, all reported rather than adjusted around

1. **`core/delegate` changed sides.** The plan's known-FALSE anchor is now **reachable** —
   `bin/bench.ts` calls it at module scope. Phase 23 criterion 5 delivered exactly what the plan
   predicted. Asserted in its new direction so a flip back is loud. Replaced as known-FALSE by
   `demo/estimatePi` and `demo/piErrorBound`, each verified by grep independently of this
   instrument.
2. **The five-module entry set no longer holds silently — and this one needs the owner.**
   `22-CONTEXT.md` pinned it on the reading that the three runnable-but-unnamed modules gain
   *"ZERO exclusive callable barrel exports"*, and instructed that when that stopped being true
   the set becomes an owner question. **It has stopped being true**: they rescue exactly four,
   all in `@o2/aot`, all through `tools/aot/bench-lifted.ts` — `pinnedWasiImports`,
   `seededStream`, `shardArgv`, `taskSeed`. The case asserts the difference by name.
3. **`core/runTaskAndPost` is not reachable *only* through the `?worker` edge.** It has two
   independent paths, so neither ablation alone flips it. The per-class anchors are the two
   worker *modules* instead.
4. **`estimatePi` is not called inside `pi.ts`.** It is called by nothing anywhere. The
   granularity case still works — and works better — because the module arm reaches its *file*
   rather than its caller.
5. **The member-expression class does not carry the 102-answer on its own.** With reference edges
   present, dropping it changes **no** barrel verdict; without them, 69 → 120. Both halves are
   asserted so neither rots into folklore.
6. **`typescript/unstable/ast` not exporting `forEachChild` is true and incomplete** — it is a
   method on every node. That is what allowed a precise AST walk with the AST's own `isX` type
   guards instead of a text scan, so no regex and no comment stripper is involved anywhere.

## A fifth edge class the plan did not know was needed

`bin/bench.ts` writes `runnerFor(memoryFabric)` — a function handed over rather than called. With
only the plan's four classes, `core/MemoryNetwork` reads unreached while a real benchmark
constructs one on every run. That is **under**-connection, and under-connection is the dangerous
direction for a guard that will gate commits: it manufactures findings that are not real, and a
guard that cries wolf gets deleted. The class costs 69 → 58 findings, eleven of them false.

It is bounded so it does not become the 54-answer: an `import { X } from …` or `export { X } from …`
**names** a symbol without using it, so specifier statements contribute no reference edges. Without
that exclusion a barrel becomes a caller, `estimatePi` reads REACHED, and the granularity case
silently turns into a tautology — measured, not theorised.

## Two defects in my own instrument, both found by watching something redden

- **The first graph had zero edges and every anchor read unreachable.** The loud direction, caught
  in one run by the anchors. Two causes: `REPO_ROOT` carries a trailing slash, so
  `slice(root.length + 1)` ate the first character of every path; and **the API lowercases
  `NodeHandle.path`**, so a case-sensitive comparison against a disk walk matches nothing.
- **The reference class swallowed the member class**, collecting `start` out of `FabricNode.start`
  as a bare reference. The member ablation then changed nothing and its case went red —
  `expected true to be false`. The `.name` half of `X.y` now belongs to the member class and the
  object half to the reference class, which is what makes either provable.

Also pinned: `program.getSourceFileNames()` **grows lazily** — 907 then 963 within one session — so
the file corpus is walked from disk. A corpus that changes size depending on what you looked at
first cannot carry a floor.

## Plants — every one watched, with the observed text

| # | Plant | Observed |
|---|---|---|
| A | barrel discovery → `index.PLANTED.ts` | 6 failed — *"no exports at all were read for @o2/aot"*, *"expected 0 to be greater than or equal to 8"* |
| B | `classify`'s two branches swapped | 3 failed — **callable fell 217 → 171**: `SymbolFlags.Type` is a composite that includes `Class`, so 46 exported classes match both and the order is load-bearing |
| C | alias resolution forced off | 3 failed — callable **0**, type-only **0**, *while the 604 total stayed satisfied* |
| D | `MEASURED_TS_VERSION` +1 patch digit | 1 failed, naming both versions |
| E | declaration arm delegates to module arm | 2 failed — *"module granularity called 0 symbols reached that declaration granularity does not. Floor 20; the breaking value is 0…"* |
| — | member ablation stopped flipping its anchor | *unplanned, and the most valuable*: `expected true to be false` exposed defect 2 above |

Each restored by the **surgical inverse** of my own edit and verified with `cmp` against a
snapshot taken immediately before planting — `b5da0036`/`978fff67` for A–D, `e3f0142f` for E.

The no-edges direction and the collapsed-graph direction are **standing cases, not mutations**,
because `reachableFrom` is pure over its arguments and can be handed a built `Map`. So is the
known-FALSE-can-flip case: plant one edge from a root to `estimatePi` and it reports reached, in
the same run in which the unplanted graph reports it unreached.

## What this task cannot redden on

- Task 1 says nothing about reachability — every symbol there is a name and a classification.
- Task 2's anchors are known-TRUE-heavy; a tracer returning "reachable" for everything would
  satisfy most of them. That is Task 3's job.
- Task 3 cannot say the declaration arm is *correct*, only that it differs from the module arm.
  Correctness rests on Task 2's anchors.
- `classify` reads declaration flags, so `export const f = () => {}` lands in `other-value`.
  Measured: exactly one of 111 — `core/fabricCombiner` — and the spec asserts that list rather
  than repeating the number.
- Reachability here is **static**. `packages/browser/demo/main.ts` hands its API to `window.o2`
  and `index.html` invokes it from an inline script, so everything behind that hop is
  declaration-unreachable by construction. That is a fact about static tracing, not about the
  browser tier, and it is 22-03's to dispose of.

## Handed forward

- **To 22-03 (owner decision):** whether `tools/aot/bench-lifted.ts` is an entry point. Four
  `@o2/aot` symbols turn on it.
- **To 22-04:** this spec runs ~7 s, over the 1000 ms cutoff, so it needs a `MEASURED_NODE_SPANS`
  row and belongs in `SLOW_NODE_SPECS`. `NODE_MEASUREMENT` is now two files and 37 tests behind
  (`unitFiles` 111 vs 112, `unitTests` 1694 vs 1731). Flagged, not silently fixed — that table is
  out of scope here and has an open debug session (`retake-measured-node-spans`) against it.
- **Recorded, not diagnosed:** `closed-fabric-agents.node.test.ts` timed out once at 60 s inside a
  full loop whose total test time was 142 s against 76 s and 90 s either side — a loaded host. Not
  reproduced in three subsequent runs. Attribution to this work is **not** established, and
  *"passes in isolation"* is written here as an observation rather than as a diagnosis.

```
tsc --noEmit       exit 0
reachability       exit 0   37 passed
npm run test:unit  exit 0   112 files   1731 passed   (two readings: 24.57 s, 26.72 s)
```
