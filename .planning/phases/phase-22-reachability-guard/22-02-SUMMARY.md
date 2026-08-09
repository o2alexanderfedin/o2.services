---
phase: phase-22-reachability-guard
plan: 02
status: complete
date: 2026-08-08
commits: [a5fa2bd]
requirements: [WIRE-02]
---

# 22-02 — The guard, and the two defects it must catch

**Closes criterion 2, in full.**

## What exists

`describeUnreachable(verdicts)` renders one line per finding naming the **symbol**, the **barrel**,
the file and the reason; `unreachableExports(exports, graph, root)` is the reading. Both pure over
plain arguments — `purity.node.test.ts`'s reason for splitting `violationsIn` out of its scan, and
the only thing that makes an empty list mean *"looked and saw nothing"*.

```
@o2/aot exports "plantedCacheSummary" (packages/aot/src/cache-key.ts) — no production code
calls it, so no path reaches it from any of the 5 entry points
```

Two reasons are kept distinct because they need different work: *"nothing calls it"* and *"its only
callers are themselves unreachable"*.

## The plant found a defect that reading the code did not

**Plant A at `FabricNode.start` changed nothing — 14 passed, twice.** `bin/agent.ts` writes
`let node: FabricNode | undefined`, and the reference edge class was counting that **type
annotation** as a call path. A type position is not a call path. Excluding `TypeReference` and
`TypeQuery` moved the reading **58 → 67**: nine browser symbols were being held reachable by their
own annotations. That is over-connection — the silent direction, and the one `22-CONTEXT.md` names
as dangerous. It would have shipped as a clean run.

**And the plan's second plant site is not obtainable as described.** It expects removing
`FabricNode.start` from `bin/agent.ts` to make many symbols unreachable. There are **six production
call sites across four files** — `bin/agent.ts`, `seed-server.ts`, `bench-fabric.ts` and three in
`bin/bench.ts` — so no single-site plant can flip it. Reported rather than swapped for a plant that
would have looked like it worked. The member class's worth is measured by ablation in
`reachability.node.test.ts` instead.

## Criterion 2, both halves, watched

| Plant | Observed | Restore |
|---|---|---|
| A — `tools/aot/lift.ts:1158`, the `translationCid` call | 2 failed: *"aot/translationCid is wired and must not be reported unreachable"*, ceiling 58 → 60 | `cmp` 0, sha `c1075323` |
| B — a new exported-but-uncalled function in `cache-key.ts`, exported from the barrel | 1 failed: ceiling 67 → 68, message naming the direction and the remedy | `cmp` 0 on both files |

Before-reading green in each case. Neither substitutes for the other: A is a wiring regression that
adds no symbol; B adds a symbol and breaks no path. The known-TRUE anchor set catches A; the
anti-vacuity ceiling catches B.

## What the guard says it cannot say, from measurement

Named in its own header, not in a planning document: a capability reached only through a dispatch
the graph cannot see reads as unreachable — **the site is named**, `demo/main.ts` → `window.o2` →
`index.html`'s inline script, carrying 12 of the 20 findings that have callers. A capability called
from a reachable but never-executed branch reads as reachable. And **liveness is not correctness**:
every case here passes for a tracer wrong in some middle way.

## Handed forward

The standing per-symbol assertion is 22-03's register. This plan leaves the guard green behind a
ceiling deliberately — 22-04 must not arm a red guard in `.githooks/pre-commit`, which is guard
defect #39's shape and seven recorded `O2_SKIP_GUARDS=1` commits.

```
tsc --noEmit       exit 0
guard + tracer     exit 0   51 passed
npm run test:unit  exit 0   113 files   1745 passed
```
