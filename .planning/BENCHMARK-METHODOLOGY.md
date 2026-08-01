# Benchmark methodology — pre-registered

**Committed before any harness exists and before any number has been produced.** That
ordering is the entire point of this document and is required by BENCH-02. Everything
below — what is measured, what is reported, what would count as failure — is fixed
*now*, while it is still impossible to know which choices would flatter the result.

A benchmark chosen after seeing the data is not a measurement, it is an argument. The
commit that adds this file contains no harness code, so the ordering is checkable in
`git log` by anyone who doubts it.

> Written 2026-07-26, against Phase 8. Amendments are allowed, but only by appending a
> dated entry to **Amendments** at the end, stating what changed and why. Silent edits
> to the plan above would defeat the purpose.

---

## 1. The claim under test

From `PROJECT.md`:

> Usable capacity grows super-linearly with the user base, without any raw data leaving
> its owner's device.

That sentence contains two claims and they are measured differently. This document
covers the first. The second — sovereignty — is not a performance property and is
established by the egress manifest and coverage report, not by any number here.

### 1.1 "Super-linear in the user base" is not "super-linear in node count"

This is the single most important pre-registration decision in this document, because
getting it wrong would produce a headline chart measuring the wrong thing.

A **user** brings both demand and capacity. One more user is one more requestor *and*
one more node. Adding a node without adding a requestor adds only capacity, and capacity
alone cannot produce a super-linear throughput curve — it is bounded above by linear,
and in practice sub-linear once coordination cost appears.

So the two axes are swept **separately** and reported separately:

| Axis | Held fixed | What it can show |
|---|---|---|
| **N nodes**, 1 requestor | one job in flight | makespan vs. parallelism. **Expected sub-linear.** |
| **N users** = N nodes + N requestors | jobs scale with participants | aggregate throughput. Where a super-linear claim could live. |

**Pre-registered expectation:** the node-count axis will be *sub-linear* and will show a
knee where coordination overhead overtakes added parallelism. Predicting that here, in
advance, means the result cannot later be presented as a surprise or as a disappointment
— it is what the model says should happen.

**Pre-registered falsification:** if the user-count axis is also merely linear or worse
across the range we can measure, the super-linear claim is **unsupported by measurement**
and must be reported as such, in those words, in the results document. It may still be
true at scales beyond one laptop; "we could not measure it" is the honest statement and
is not the same as "it is true".

---

## 2. What is measured

### 2.1 Makespan

**Makespan** is wall-clock from job submission to the last shard's result being
available to the requestor. It is the number a user experiences and it is the primary
metric.

- Clock: `performance.now()`, which exists identically in Node, a browser, and a Worker.
  Not `Date.now()` (coarse, wall-clock-adjustable) and not `process.hrtime` (Node only).
- Timing starts when `runResilient` is called and ends when it resolves.
- A run that does not complete every shard is **excluded from makespan statistics and
  counted separately** as an incomplete run. Including a fast failure as a fast run is
  the classic way to make an unreliable system look quick.

### 2.2 Cost, in node-seconds

Reported as two numbers that must always appear together:

- **gross node-seconds** — every second every node spent, including redundant execution,
  re-dispatches after churn, and speculative duplicates that lost.
- **useful node-seconds** — the seconds that contributed to the answer that was returned.

And the three taxes derived from them, each an explicit line item:

| Tax | Definition | Source |
|---|---|---|
| verification | gross / useful from redundant execution | `JobResult.verificationMultiplier` |
| speculation | (tasks + duplicates) / tasks | `CoordinatorOutcome.speculationMultiplier` |
| churn | re-dispatches / tasks | `CoordinatorOutcome.redispatches` |

**Reporting gross without useful, or useful without gross, is forbidden.** A cost figure
with the redundancy removed is the number a vendor publishes; the point of this project's
verification story is that the redundancy is the product, so its cost is not an
adjustment to be excluded.

### 2.3 The connectivity tax

The same job is run over two transports:

- the in-process memory transport (`MemoryNetwork`) — no sockets, no serialisation cost
  beyond encode/decode, no scheduler contention between processes
- the real transport

The **connectivity tax** is the ratio of the two makespans at equal node count. It is
published as its own number, because it is the honest answer to "how much of your
scaling curve is an artifact of the fake network".

---

## 3. What is reported

### 3.1 Percentiles, never a bare mean

**p50, p95 and p99 are reported. A mean is never reported alone.** Straggler-dominated
distributions have means that describe no observed run: a job whose makespan is set by
its slowest shard has a long right tail, and the mean sits in a gap between the typical
case and the tail.

A mean *may* appear beside the percentiles when it is useful for cost arithmetic. It may
never appear as the headline.

Sample size and the raw observations are published with every statistic, so a reader can
compute anything else they want. A percentile over fewer than **10 runs** is reported as
`n=k, percentile unreliable` rather than silently presented as though it meant something
— p99 over 10 samples is the maximum, and pretending otherwise is a lie of arithmetic.

### 3.2 Machine inventory on every run

Every published run carries:

- CPU model, physical and logical core count, total RAM
- OS and kernel version, runtime version (Node / browser build)
- how many nodes ran, and **on how many distinct machines**
- the role of each machine (worker / relay / aggregator / requestor), because relay and
  aggregator hardware are part of the result and omitting them flatters it

### 3.3 The same-machine label is mandatory and prominent

A run whose "nodes" are processes or tabs on one machine is labelled
**`same-machine: N processes on 1 host`** everywhere it appears — in the raw data, in
every table, and in any chart caption.

This is not a footnote. N tabs on one laptop share a CPU, a memory bus, a page cache and
a scheduler. They are a measurement of *software* scaling with the hardware contention
included and the network excluded, which is a legitimate thing to measure and is **not**
a measurement of N nodes. Reporting it as N nodes would be the single most misleading
thing this project could publish, which is why BENCH-06 exists.

### 3.4 Cold vs. warm code cache

V8 caches compiled WASM keyed on the resource URL. A run that reuses a warm cache is
measuring something different from a first visit, and the difference is large.

Every run declares `codeCache: 'cold' | 'warm'`. Cold-start runs discard the first
iteration explicitly rather than averaging it in, and the discarded value is published
separately as the cold-start cost.

### 3.5 Data skew

Real partitions are not equal. A run declares its skew configuration, and at minimum the
suite includes:

- `uniform` — every shard the same size
- `skewed` — one shard substantially larger than the rest

The skewed configuration is where speculation and straggler handling either pay for
themselves or do not, so publishing only the uniform case would hide the case the design
was built for.

---

## 4. The COST crossover — BENCH-05

**COST** = *Configuration that Outperforms a Single Thread* (McSherry, Isard, Murray,
HotOS 2015). The number is: **how many nodes this system needs before it beats one
competent single-threaded implementation of the same job.**

- The baseline is the *same computation*, in-process, no fabric, no verification, no
  content addressing, no network — the fastest honest single-threaded implementation of
  the identical work.
- The crossover is the smallest node count at which distributed **p50 makespan** is below
  the baseline's p50. If no measured node count achieves it, the published answer is
  **"no crossover within the measured range"**, with the range stated.
- The crossover is reported at the *same* cost accounting as everything else — with
  verification included, not excluded to make the number smaller.

**Pre-committed:** this number is published whatever it is. A high crossover is the
expected outcome for a system whose per-task overhead includes hashing, canonical
encoding, signature checks and redundant execution, and whose value proposition is
sovereignty and spare capacity rather than raw speed. Publishing an embarrassing COST
number alongside the reason it is high is more useful, and considerably more credible,
than not publishing one.

---

## 5. Reproducibility

- **Fixed inputs, content-addressed.** Every run's inputs are addressed by CID, so a
  third party can confirm they ran the same bytes.
- **The harness is published with the results**, in this repository, not described.
- **Raw per-run observations are published**, not just the summary statistics.
- **The seed and configuration of every run are recorded** in the raw output.
- A run is reproducible in the weak sense that matters here: same code, same inputs, same
  hardware class → same distribution. Not: identical wall-clock numbers, which no
  benchmark on a preemptive multitasking OS can promise.

---

## 6. Exclusions and known biases, declared in advance

Stated now so that they cannot later be presented as discoveries:

1. **One machine.** At the time of writing, the author has a single development machine.
   Every number produced now is same-machine and labelled so. The distinct-machine
   requirement of BENCH-06 is therefore **not met by these runs** and the results document
   must say so in its opening lines rather than in a footnote.
2. **No hosted relay.** Browser-tier numbers over a real WAN relay cannot be produced
   until one exists (Phase 3's outstanding criterion). LAN measurements are labelled LAN.
3. **The WASM fixtures are tiny.** The hand-assembled test modules do almost no work, so
   per-task overhead dominates and the COST crossover will look worse than it would for a
   realistic workload. A run declares its per-task compute cost so a reader can see how
   much of the makespan is overhead.
4. **Node 23.11.0 is not an LTS release** and is outside the declared support range.
   Recorded in the machine inventory rather than quietly ignored.
5. **No warm-up of the OS page cache is performed** beyond the declared code-cache state.
6. **The author is the sole party running these**, with an obvious interest in the
   outcome. That is precisely why the analysis plan is fixed here in advance and why the
   raw data is published.

---

## 7. Analysis plan, fixed in advance

1. Sweep node count over a pre-declared ladder: **1, 2, 4, 8, 16**. Not chosen after
   seeing where the curve looks best.
2. Run each configuration **≥ 20 times**; discard the first as cold-cache and report it
   separately.
3. Report p50/p95/p99 makespan per configuration, with n.
4. Report gross and useful node-seconds and all three taxes per configuration.
5. Compute the connectivity tax as memory-transport p50 ÷ real-transport p50 at equal N.
6. Compute the COST crossover against the single-threaded baseline's p50.
7. Publish the raw observations.

**No configuration is dropped after the fact.** If a configuration produces a bad number,
the number is published. If a configuration is genuinely invalid — a crash, a
misconfiguration — it is published *as excluded*, with the reason.

---

## 8. What would falsify the project's performance claim

Written down so it is possible to be wrong:

- Aggregate throughput on the **user-count** axis is linear or sub-linear across the
  measured range → the super-linear claim is unsupported by measurement.
- The connectivity tax is so large that the real-transport curve is flat → the system
  scales only in simulation.
- The COST crossover does not exist within a node count anyone could realistically
  assemble → the system is not a compute platform, and its case rests entirely on
  sovereignty and on using capacity that would otherwise be idle. *That would be a
  legitimate case, but it is a different one, and it must then be made in those terms.*

---

## Amendments

*Entries appended here must be dated and must state what changed and why.*

### 2026-07-31 — the reduce leg (Phase 16, MR-03 … MR-07)

**Committed before the run it describes.** This entry is a separate, earlier commit than
the regenerated `BENCHMARK-RESULTS.md`, for the reason the preamble gives: a plan amended
after seeing the number it changed is not a plan. The two paragraphs that record what the
run *printed* are marked as such and were appended afterwards; every **decision** below
was fixed before any reduce number existed.

**1. What was added.** `Observation` gains a required `reduce` group — `ok`, `reduceMs`,
`treeDepth`, `combines`, `recomputes`, `combineExecutors` — and `SweepResult` gains a
`ReduceReport` aggregating it. `renderMarkdown` emits one reduce table per transport,
placed adjacent to the makespan tables. The aggregation rules, so a reader can reproduce
the table from `observations`: `ms` is summarised under makespan's own completeness rule
(completed runs only, cold-cache iteration excluded) and additionally only over runs whose
reduce produced an aggregate; `treeDepth`, `combines` and `combineExecutors` are the
**max** over those runs, because a max makes an outlying run visible where a mean would
average it away; `recomputes` is the **sum**, because it is an event count and a mean of
event counts across runs answers no question anyone asks. `Observation.reduce` is
**required**, not optional-with-zero-defaults, so a driver that stops measuring fails
`tsc` rather than publishing zeros.

**2. What did not change: makespan.** §2.1 still reads *"wall-clock from job submission to
the last shard's result being available to the requestor"*. A combine happens **after** the
last shard's result, so the reduce is timed by its own `performance.now()` pair opened
strictly after the makespan bracket closes, and `makespanMs` means today exactly what it
meant on 2026-07-29. `packages/node/src/bench-reduce.node.test.ts` asserts the source
ordering — the index of `const makespanMs =` precedes the index of `reduceJob(` — because
that is the one property no pattern-based check can express, and a driver that widened the
bracket would satisfy every other requirement in that file.

**3. The argument for the other choice, recorded rather than suppressed.** A user waits for
the aggregate, not for the last shard, so there is a real case for folding the reduce into
makespan. It is **not taken**, and the reason is comparability: it would make every number
published before this date incomparable with every number after, with no column to show the
difference. The two tables are adjacent precisely so a reader who prefers that definition
can add the columns; a reader given only the sum could not subtract them. Either answer is
defensible — leaving the choice implicit is not, which is why it is written here.

**4. What did not change: the makespan *sample*, and `incomplete`.** `complete` still means
"every shard agreed", so `makespan`'s p50/p95/p99 are over the same population they were on
2026-07-29 and the `incomplete` column keeps its meaning across this date. **The rejected
alternative is the subtle one and a later editor will re-propose it:** folding the reduce's
verdict into `complete` would have left each individual `makespanMs` measuring the
identical interval while conditioning the *published statistics* on the reduce having
succeeded — a silent re-sampling of the primary metric that no change to §2.1's wording
would have revealed. The reduce's verdict travels instead as `Observation.reduce.ok`, and
that is what the reduce aggregation filters on. Consequence, stated so the tables are read
correctly: **a row can have a populated makespan and an em-dashed reduce, and that
combination means the map completed and the aggregation did not.** An em dash is never a
zero — a configuration whose reduce was not measured renders every reduce cell as `—`,
because `0` would read as "the reduce ran and did nothing", which is a different claim.

**5. What the reduce columns are, and which of them the run showed constant.** `reduce
p50`, `reduce p95`, `recomputes` and `combine executors` are the columns expected to carry
information. `tree depth` and `combines` are decided by `deriveReduceTree` from a shard
count and a fanout this sweep never varies, so a column the run shows constant is published
for legibility only — the same status `spec. tax` and `churn/task` already carry — and a
reader must not take a constant for a result. The driver's `unmet` list says so in the
artifact itself. The alternative that would make those two columns informative, varying the
fanout across the sweep, was considered and rejected: rungs walking differently-shaped trees
have incomparable reduce timings, which is the only thing the reduce table is for. *The
per-rung values the regenerated run printed are recorded below, after the run.*

**6. Egress figures move for a new reason.** The requestor now also sends combine requests,
sends one directed `block` request per combine to retrieve each result, and serves leaf
partial blocks — all over the same guarded transport — so the manifest's frame count and
byte total rise for reasons unrelated to the map. **Those two printed figures are not
comparable across this date.** The retrieval leg is named explicitly because it is the half
a reader would under-count: every combine costs a *second* request/response pair, not one,
so "one frame per combine" is wrong. *The figures the regenerated run printed are recorded
below, after the run.*
