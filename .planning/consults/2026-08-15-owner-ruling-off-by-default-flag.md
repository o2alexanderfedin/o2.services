# Owner ruling: a capability behind an off-by-default flag is NOT shipped

**Ruled 2026-08-15 by the owner.** Asked in plain terms — *"Some capabilities only run when you pass
a command-line flag that is off by default (`--discover`). Does running only behind that flag count
as shipped, or does it have to work with no flag?"* — the answer was:

> **It must work with no flag.**

This file exists because the question had been open for four days with **precedent recorded both
ways**, and because the ruling *costs* rather than pays. Recording only the rulings that close rows
is how a ledger drifts optimistic.

## Why it needed an owner at all

The repository's own instrument cannot answer it. `packages/node/src/reachability-guard.node.test.ts`
states in its header:

> *"A capability called from a reachable but never-executed branch reads as reachable. The graph is
> over paths, not over executions; a call inside `if (false)` is an edge. Nothing here claims a
> reached symbol runs."*

So a flagged capability is **reachable** by the guard's definition and always will be. The milestone
audit says the same in its own words — the finding *"is not among the 47 and never will be… it should
not be closed on the guard's silence."* `STATE.md` deferred the question to "Phase 22's guard", which
is a deferral to an instrument that is structurally blind to it.

## The record contradicted itself, on the same day

Three dated entries, two of which disagree and are hours apart:

| date | where | reading |
|---|---|---|
| 2026-08-08 | `bin/bench.ts`'s `DISCOVER` docblock | **permissive** — "Off by default is SETTLED… The ruling confirms that reading rather than changing it." |
| 2026-08-11 | `v1.1-MILESTONE-AUDIT.md` | **strict** — "a capability that executes only behind an off-by-default flag is NOT wired." |
| 2026-08-11 | `REQUIREMENTS.md`, VER-09's row | **permissive in practice** — the row was ticked on `--discover --sovereign` |

The 2026-08-15 ruling settles it in favour of the strict reading. The 2026-08-08 entry is **not**
deleted: it was a real ruling on a real question and its reasoning — that a published scaling curve
must not be reshaped by an undeclared change — is untouched. What it no longer supports is the
inference that *therefore the capability counts as shipped*.

## What the ruling costs

It closes nothing. It puts work back on the board.

**Rows whose entry-point evidence is `bin/bench.ts --discover` and which the ruling invalidates:**
`SCHED-01`, `SCHED-02`, `SCHED-03` (partially — its exec-stage re-pick is separately wired), `MR-02`,
`VER-09`. Each is currently `[x]`.

**Rows it does NOT close, though they name the flag:** `NET-06`, whose open leg is browser-tier
*selection*, which no Node-tier bench can supply; and audit finding `G5`, whose measured negative
stands under either reading.

**What survives untouched in every affected row:** the *behavioural* half. `discovery-agents.node.test.ts`
runs discovery across seven real spawned `bin/agent.ts` processes and does not care about a flag.
What the ruling denies is the claim that **a runnable entry point reaches it**, never the claim that
the mechanism works.

## The remedy the ruling implies, and it already has a precedent

Three rows — `VER-03`, `VER-04`, `VER-10` — closed on 2026-08-14 by moving the reading onto the demo
page's Run button, where no flag stands in front of it. `REQUIREMENTS.md` calls that what it is:
*"the close is the ruling's own escape rather than its answer."* Under this ruling it stops being an
escape and becomes the method.

So the work each invalidated row now needs is not new mechanism. It is **a default path that
exercises the mechanism the flag currently gates** — which for the scheduling rows means a production
submitter that supplies `admit` without `--discover`, and for `MR-02` means a sovereign aggregation
reachable without two flags.

## What must not happen

The tempting repair is to leave the boxes ticked and add a sentence explaining that the flag is
"only" a benchmark configuration. That is the shape this milestone exists to remove: *descoped is not
satisfied; unmeasured is not met*. A row whose entry point is a flag nobody sets is a row whose entry
point does not exist yet.
