---
phase: phase-22-reachability-guard
plan: 03
status: complete
date: 2026-08-08
commits: [7e03562]
requirements: [WIRE-02]
---

# 22-03 — The reading, and what it is honest to say about it

**Criterion 1 does not pass clean, and this plan says so in the code rather than only in prose.**

## The reading

**67 of 217 callable barrel exports have no traced path from the five entry points.** 20 are
disposed with a stated cause; **47 are left open**. Forty-seven exported capabilities with no
production caller anywhere, in a milestone named *"Wire What Was Built"* — that is the residue, and
`OPEN_FINDING_CEILING` holds it still rather than disposing it away.

## Owner decisions, taken 2026-08-08, recorded in the file

1. **The entry-point set stays at five.** `tools/aot/bench-lifted.ts` rescues four `@o2/aot`
   symbols and is nonetheless not an entry point — a benchmark driver is not a way the fabric is
   entered. `22-CONTEXT.md` predicted this exact moment and asked for the question to be put; it
   was put and answered.
2. **Only symbols with a stated cause are disposed.** Everything else stays open.
3. The `window.o2` class is disposed **on the mechanism** (my call, on "best practice"): extracting
   `index.html`'s inline script would close it properly and is a change to the demo, not to a
   guard; leaving it open would block 22-04 for something that is not a wiring defect.

## Two causes, both mechanisms, neither a tier

`global-object-hop` is granted across `@o2/browser`, `@o2/demo` **and** `@o2/net` — and the spec
asserts that spread rather than trusting the sentence, because a tier-based rule could not do it.
That is the criterion *"no disposition is granted on the basis of which tier or which factory a
symbol belongs to"*, enforced rather than stated.

## WIRE-02 is not marked `[x]`, and the ledger is what refused it

Marking it delivered failed **four** `acceptance-traceability` cases at once: `[x]` demands a
`Done` status, a requirement id in a running test title — which 22-02 deliberately forbids in that
file, because manufacturing a title would corrupt that guard's own measurement — and a recognised
status word. The guard is delivered; the finding is open; **Partial** is the honest word. The row
now carries three claims the ledger checks for itself: `estimatePi`, `piErrorBound` and
`sweepNodeCount` each have no production caller.

**The wave note's hazard was real and was measured both ways.** Editing a `REQUIREMENTS.md` row can
remove it from the checked population — Phase 18's ledger guard failed exactly so. Before: 61
passed. After: 61 passed.

## Three plants against the register's own defences

| Plant | Observed |
|---|---|
| F — dispose a symbol that **is** reachable | *"these symbols carry a disposition but the guard now reaches them — delete the entries: expected [ 'core/submitJob' ]…"* |
| G — dispose a symbol no barrel exports | *"these disposition entries name nothing the barrels export…"* |
| H — a tier-based cause, `browser-tier` | *"cause \"browser-tier\" names the barrel browser — a disposition may not be granted on the basis of which tier a symbol belongs to"* |

All restored, `cmp` exit 0, sha back to `1f6d8dd3`.

**My own tier check was wrong first and the suite caught it.** It compared substrings, so it
refused `benchmark-driver-only` because `bench` sits inside `benchmark` — while that cause names a
driver under `tools/aot/` and no barrel at all. A check that cries wolf gets deleted, and this one
would have taken the criterion's only enforcement with it. It compares whole kebab-case words now.

```
ledger + traceability  exit 0  61 passed, before AND after the REQUIREMENTS.md edit
npm run test:unit      exit 0  113 files  1751 passed
```
