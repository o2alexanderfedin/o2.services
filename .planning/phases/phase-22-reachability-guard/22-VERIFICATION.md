---
phase: phase-22-reachability-guard
status: gaps_found
score: 2/3
date: 2026-08-08
verified_at: d7beefe
requirements: [WIRE-02]
---

# Phase 22 — Reachability Guard · Verification

**2 of 3 criteria met. Criterion 1 is DECLINED, and it is declined on the reading rather than on
the instrument.** The guard exists, catches both named defects, and gates every commit. What it
reports is that 67 of 217 callable barrel exports have no traced path from the five entry points,
47 of them with no production caller anywhere. Criterion 1 asks for *"passes clean"*, and this
tree does not.

## Criterion 1 — DECLINED

> *Running the reachability guard after Phases 11-21 land passes clean — every capability exported
> from a package barrel has a traced call path from one of the five runnable entry points.*

**It does not pass clean.** Measured 2026-08-08 at `d7beefe`, over 217 callable exports across
eight barrels, 139 production files, 1 827 declaration nodes and 698 callers:

| | |
|---|--:|
| unreachable from the five entry points | **67** |
| …disposed with a stated cause | 20 |
| …**open, with no production caller anywhere** | **47** |

The 47 are the milestone's own subject seen from the other side: *"Wire What Was Built"* left this
many exported capabilities unwired. `sweepNodeCount` is the clearest single case — its own barrel
documents it as *"a separate question and is not settled here"*.

**RULING A forbids closing this by rewriting the criterion**, and it is not closed. Two things that
are *not* the reason for the decline, said so they are not mistaken for it:

- **Not an instrument failure.** The tracer's resolving power is measured inside one run: the same
  corpus at module granularity reports **0** unreached against the declaration arm's 67, a gap of
  67 against a stated floor of 20 whose breaking value is 0. Five known-TRUE anchors, each on a
  different edge class, all report reachable; two known-FALSE anchors, verified by grep
  independently, report unreachable and can be made to flip.
- **Not a disposition shortfall.** The owner ruled that only symbols with a stated cause get an
  entry. Disposing the other 47 would have made criterion 1 pass and the guard decoration — the
  exact failure `22-CONTEXT.md` § *The disposition register, not an allow-list* names.

**What would close it:** wiring the 47, or retiring the ones that are genuinely superseded. That is
work this milestone did not do, and the ceiling holds the number still meanwhile.

## Criterion 2 — MET

> *Reintroducing the original defect — commenting out a wired call site, or adding a new
> exported-but-uncalled function — fails the guard, naming the unreachable symbol and the barrel it
> came from.*

Both halves, each watched red, each restored and `cmp`-confirmed:

- **Commenting out a wired call site.** `tools/aot/lift.ts:1158`'s `translationCid` call. Two cases
  failed — *"aot/translationCid is wired and must not be reported unreachable"* — and the finding
  count moved 58 → 60.
- **A new exported-but-uncalled function.** Added to `packages/aot/src/cache-key.ts` and exported
  from the barrel the way that barrel already exports things. The message names both halves:
  `@o2/aot exports "plantedCacheSummary" (packages/aot/src/cache-key.ts) — no production code calls
  it, so no path reaches it from any of the 5 entry points`.

Neither substitutes for the other, which is why criterion 2 names both: A is a wiring regression
that adds no symbol, B adds a symbol and breaks no path.

**The naming clause is asserted as two independent `toContain`s**, following `purity.node.test.ts`,
so a wording change cannot turn it into a false red that gets fixed by loosening the guard.

## Criterion 3 — MET, with the substitution stated

> *The guard runs as part of the same CI gate as the rest of the suite, so a future change that
> builds a mechanism without wiring it to an entry point fails CI rather than merging silently.*

**Demonstrated, not asserted.** A real commit adding an unwired export was attempted and the hook
refused it at exit 1, naming `aot/gateProofUnwired` inside the finding list.

**The substitution is stated rather than assumed: there is no CI and there must not be one.**
`disclosure-gate.node.test.ts` asserts `.github/workflows` does not exist — DEMO-04, because public
hosting is public disclosure and the EPO and China have no patent grace period. `.githooks/pre-commit`
is this repository's only gate, and the hook records that so nobody "fixes" the absence.

Cost is comparative, in one run window: six guards **2.96 / 3.13 s**, seven **3.40 s** — +12% wall
clock, +80% CPU, with the breaking value written at the line (more than 2× and it comes out).

## What this phase corrected in its own planning documents

Six claims the plans made about the tree measured false and were reported rather than adjusted
around — the habit the phase exists to enforce, applied to the phase:

1. The corpus was 209 callable / 581 total / 869 files; it is **217 / 604 / 907**.
2. `core/delegate` — the plan's known-FALSE anchor — **changed sides**; Phase 23 gave it a module-scope caller in `bin/bench.ts`.
3. The five-module entry set **no longer holds silently**; the three unnamed runnable modules now rescue four `@o2/aot` symbols. Put to the owner and answered.
4. `runTaskAndPost` is **not** reachable only through the `?worker` edge — it has two independent paths.
5. `estimatePi` is **not** called inside `pi.ts`; nothing calls it anywhere.
6. `FabricNode.start` has **six** production call sites across four files, not one, so the blast-radius plant the plan describes is not obtainable.

## Two defects in the instrument, both found by watching a plant rather than by reading

- The first graph had **zero edges** — a trailing-slash root and the API's lowercased paths. Loud, and the anchors caught it in one run.
- The reference edge class counted **type annotations** as call paths, so `let node: FabricNode | undefined` kept `FabricNode` reachable with its call site removed. Silent, and it moved the reading 58 → 67 once fixed. This is the over-connection failure `22-CONTEXT.md` names as the dangerous one, and it would have shipped as a clean run.

## Unscored, and stated so it is not read as scored

- **WIRE-02 is `Partial`, not `[x]`.** The ledger refused the `[x]` across four
  `acceptance-traceability` cases. The guard is delivered; the finding is open.
- The guard reads a **static** call graph. Everything behind `demo/main.ts`'s `window.o2` assignment
  is unreachable by construction — 12 findings — and that is a fact about static tracing, not about
  the browser tier. Extracting `index.html`'s inline script would close it properly.
- **Liveness is not correctness.** Every liveness case passes for a tracer wrong in some middle way;
  correctness rests on the anchors.

## Evidence

```
tsc --noEmit          exit 0
tracer + guard        exit 0    57 passed
mutation-guard        exit 0   151 passed
slow-specs            exit 0     9 passed
ledger + traceability exit 0    61 passed  (same count before and after the REQUIREMENTS.md edit)
npm run test:unit     exit 0   111 files   1697 passed   real 22.71
gate refusal proof    exit 1   naming aot/gateProofUnwired
```

Plants: 11 planted, 11 watched red, 11 restored by the surgical inverse with `cmp` exit 0.
