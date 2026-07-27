# Phase 8 — Benchmark Harness

**Status:** COMPLETE — 4 of 5 criteria met, criterion 5 partial (one machine available)
**Requirements:** BENCH-01 … BENCH-05 done; BENCH-06 partial
**Branch:** `feature/phase-8-benchmark`

```
tsc --noEmit  clean
801 tests     all green (was 745)
```

| # | Criterion | Status |
|---|---|---|
| 1 | Makespan vs node count, both transports, connectivity tax reported | **met** |
| 2 | p50/p95/p99 never a bare mean; raw data and harness published | **met** |
| 3 | Verification tax explicit; gross and useful shown together | **met** |
| 4 | COST crossover published, with skew and cold-vs-warm disclosure | **met** |
| 5 | Machine inventory on every run; same-machine labelled as such | **met for labelling**, and the label says the runs are same-machine |

BENCH-06 asks for two things. The labelling half is enforced structurally and derived
from the host count. The distinct-machine half is **not met** and cannot be until a
second machine exists — stated in the report's opening section, not a footnote.

## The ordering was the requirement

`BENCHMARK-METHODOLOGY.md` was committed in a commit containing **no harness code and no
number**. That is checkable in `git log`, which is the point: a benchmark whose analysis
is chosen after seeing the data is an argument, not a measurement.

Three pre-registered predictions, all of which held:

- the node axis would be sub-linear — it was flat
- the COST crossover would be embarrassing — no crossover, ~570×
- the fixture bias would dominate — it did, and the decomposition shows it

Predicting them in advance is what stops the flat curve from being spun as a surprise
and the missing crossover from being quietly omitted.

## What the harness refuses to do

Each of these is a structural guard, not a note asking the author to be careful:

- **No function returns a mean.** `Summary` carries the field under the name
  `meanForCostArithmeticOnly` — unwieldy on purpose, because a name annoying to type
  into a chart title does more work than a comment.
- **Nearest-rank percentiles**, so every published number is a value some run actually
  produced. An interpolated p99 is a number nobody observed.
- **An incomplete run never enters makespan statistics.** It is counted separately.
- **The same-machine label is derived from the host count**, never declared, and is
  emitted into every table heading so copy-paste cannot separate it from the numbers.
- **Gross and useful node-seconds are adjacent columns.** BENCH-04 as a property of the
  layout rather than of the author remembering.

## The incomplete-run rule earned its place immediately

The first full run reported **19 of 19 incomplete at every memory-transport rung**. The
memory workers had a local blockstore holding the module but no way to fetch shard
*inputs* — the real transport worked because `FabricNode` wires a network fallback and
the hand-rolled memory fabric did not.

A harness that folded failures into the makespan would have published a beautiful,
entirely fictional curve of very fast runs. The rule that a fast failure is not a fast
run is the reason the bug surfaced as a bug.

## A misnamed field, caught before it was published

`JobResult` exposed `grossNodeSeconds` and `usefulNodeSeconds`. The underlying
`fuelUsed` is **bytes moved across the guest ABI** — deterministic, which is exactly
right for a cost metric that must never make honest nodes disagree, and not seconds.

Publishing it as node-seconds would have been wrong by a factor nobody could have
guessed, and it is precisely the failure this phase exists to prevent. Renamed to
`grossFuel`/`usefulFuel`; the driver now measures real node-seconds itself with
`performance.now()`. The *ratio* was always sound, which is why `verificationMultiplier`
needed no change.

## Two rungs published as excluded, not dropped

Real transport at 8 and 16 nodes dies with `ECONNRESET`. The cause is already in this
project's own notes from Phase 3: libp2p caps inbound connections at
`INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one host.

They are published in an "excluded, and why" table because the methodology commits to
it. A rung that vanishes between the plan and the results is indistinguishable, to a
reader, from a rung removed because its number was inconvenient.

## The headline caveat is what the numbers cannot show

Every node in both curves runs inside **one OS process on one JavaScript event loop**.
The memory transport is in-process by definition; the real transport creates its libp2p
nodes in the same process and dials them over loopback.

So **no parallel speedup is measurable here at all**, and the flat makespan across the
ladder is the expected consequence of that rather than a finding about scaling. Saying
so plainly is the difference between a benchmark and a brochure — and it means the
scaling claim remains *unmeasured*, which is not the same as disproved and not the same
as supported.

## The numbers

- **Connectivity tax: 8–10×.** Real libp2p over loopback TCP against the in-process
  transport, at equal node count. A genuine, publishable figure.
- **COST crossover: none**, best distributed p50 ~573× the single-threaded baseline.
- **Decomposition:** native 0.002ms → WASM in-process 0.61ms → distributed 1.3ms. Most
  of the gap is the guest ABI on a fixture that does almost no work, not the fabric.
  That is a statement about the fixture, declared as a bias before the run.
- **Skew made almost no difference** (1.6ms vs 1.6ms at 4 nodes), which follows from
  there being no real parallelism to disturb.

## What would make these numbers mean something

1. A second machine — turns the same-machine label off and makes speedup measurable.
2. Separate OS processes even on one host — cheaper than a second machine and would
   already show real parallelism.
3. A fixture that does non-trivial work, so the COST crossover measures the fabric
   rather than the ABI.
