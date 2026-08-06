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

*Appended 2026-08-04, after the 2026-08-01 run.* The rule above is conditional — "a run
whose 'nodes' **are** processes or tabs" — and the driver that produced
`BENCHMARK-RESULTS.md` meets neither antecedent: `bin/bench.ts` counts **node identities**
(`inventory(Math.max(...NODE_LADDER))`) and runs every one of them inside the single
process that publishes them. It emitted `N processes on 1 host` regardless, so the
published artifact named a unit nothing had counted while denying the one that had been —
and its own `unmet` list said so two lines below the label. `machineLabel` now derives
**`SAME-MACHINE: N nodes on 1 host — a node count, not a machine count`**: the same-machine
disclosure this section makes mandatory and prominent, over the noun that was actually
counted, denying the claim BENCH-06 is actually about. The `N processes` form is reserved
for a driver that counts processes, which is Phase 23's. Only the label was corrected; no
figure in the published artifact was regenerated, replaced or re-run.

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
have incomparable reduce timings, which is the only thing the reduce table is for.

*Appended after the run.* **The full run of 2026-08-01T05:38:05Z printed `tree depth 2`
and `combines 5` on every rung of the memory transport — 1, 2, 4, 8 and 16 nodes alike.**
Both columns are therefore constant across the published ladder and neither carries
information about a configuration; they are recorded here so a later reader can tell that
the constancy was observed rather than assumed. `combine executors` on the same rungs read
**1, 2, 3, 4, 5** — it rises with the node count, which is the column that carries MR-05 —
and `recomputes` read **0** on every rung, meaning no combine had to fall through the
rendezvous ranking. Every rung of the **real** transport is an em dash for a separate
reason given in paragraph 7.

**7. What this run could not measure at all: the reduce over the real transport.**
Recorded here because a table of em dashes with no stated cause is indistinguishable from
a missing feature. `serveAgent`'s combine branch refuses unless its `authorize` hook is the
`serves-unauthenticated` sentinel — an `Authorizer` takes a `Task` and a combine has none,
so a node that authenticates everything else cannot be asked about a combine, and the gap
was deliberately made to fail closed. Every `FabricNode` supplies a real
`authorizeCapability`, so every node in the real-transport rig answered `combine requires a
capability chain this build cannot verify`. Measured on this driver rather than inferred
from the source: every combine failed at level 1, with `combines: 0`, `failed: 5`,
`executedBy: 0` and `rootCid: null`. **The two reduce curves are therefore not comparable
and no connectivity tax is computed over them.** Closing it is AUTH-03, Phase 15. Nothing
was weakened to produce a populated row.

**6. Egress figures move for a new reason.** The requestor now also sends combine requests,
sends one directed `block` request per combine to retrieve each result, and serves leaf
partial blocks — all over the same guarded transport — so the manifest's frame count and
byte total rise for reasons unrelated to the map. **Those two printed figures are not
comparable across this date.** The retrieval leg is named explicitly because it is the half
a reader would under-count: every combine costs a *second* request/response pair, not one,
so "one frame per combine" is wrong.

*Appended after the run.* The full run of 2026-08-01T05:38:05Z printed **3055 frames /
1468983 bytes** for the memory transport and **2367 frames / 1140430 bytes** for the real
transport. Two cautions on reading them. They are **not** comparable with the figures on
the previously published page, which was a `--quick` run (6 iterations, ladders `[1,2,4]`
and `[1,2]`) rather than a full one, so the change across this date mixes the reduce leg
with a fourfold change in iteration count and a longer ladder — the reduce's own
contribution is not separable from these two numbers and no attempt is made here to
separate it. And the real transport's figure includes combine requests that were all
**refused** (paragraph 7), so it counts the request frames of an aggregation that never
happened.

### 2026-08-05 — a second fixture, one that does work (Phase 23, BENCH-07)

**Committed before the driver that runs it exists, and four waves before the run that
uses it.** The same ordering the 2026-07-31 entry claims, for the same reason, and it is
checkable the same way: this entry's commit contains no fixture parameter and no number
produced by one.

**1. What §6.3 already declared, and what is being done about it.** §6.3's third
known bias reads *"The WASM fixtures are tiny. The hand-assembled test modules do almost
no work, so per-task overhead dominates and the COST crossover will look worse than it
would for a realistic workload."* That bias is not merely unflattering — it makes the
primary question of this phase unaskable. The published sweeps dispatch a guest that
writes its partition index and returns, so there is nothing to divide across nodes and no
node count at which a makespan could fall. A speedup that cannot exist is not evidence
about parallelism; it is evidence about the fixture.

**2. What is added.** A second fixture: `@o2/demo`'s colouring kernel — a committed,
integer-only, budget-bounded search guest — at `budget = DEFAULT_BUDGET`, dispatched over
`SHARDS` partitions. Its per-shard cost is a **declared input** rather than a property of
the host, which is the whole reason it was chosen over a workload that spins for a
duration: a fixture whose cost is a wall-clock constant encodes the machine it was written
on into every ladder it is ever run against.

**3. No parameter is written down here, and the omission is the point.** The problem size
this fixture runs at is chosen **by measurement, in Plan 23-03, at `SHARDS` partitions**,
against three acceptance conditions declared now:

- **every shard returns `budget`** — that is, no cube finishes early, so shard cost is
  uniform across partitions and a makespan ratio is not reading a lopsided split;
- **the encoded input stays under `WIRE_CHUNK_BYTES = 16_384`** — so the transport regime
  does not change between the two fixtures and the connectivity tax stays comparable;
- **the partition count is a power of two** — the guest derives `k = log2(count)` from the
  packed partition word, and `SHARDS = 16` satisfies it.

An earlier draft of this entry quoted a problem size, a per-shard range, a serial total
and a payload size. **Every one of them was measured at eight partitions**, and `SHARDS`
is sixteen, so every one of them describes a configuration this phase does not run. They
are withdrawn rather than adjusted, because an adjusted number is a guess wearing the
clothes of a measurement. The value finally chosen, and the shard status vector observed
at it, are published in the results document beside the curve they produced.

**4. The trivial fixture is kept.** It is not replaced and its curves are not withdrawn.
The COST crossover of §4 and the single-threaded baseline it is measured against stay
defined against the trivial fixture, because that is what every published crossover figure
has meant to date and redefining it silently would make this date a discontinuity in a
number the project quotes. The two fixtures are reported side by side, each row saying
which one it ran.

### 2026-08-05 — a third driver, and two declared dimensions (Phase 23, BENCH-07)

**1. Why a third driver.** Both curves published under Phase 8 built every node inside the
driver's own process. Sixteen node identities sharing one event loop cannot execute two
shards at the same instant, so **no parallel speedup was measurable at any node count**,
and the flat curve the run produced is a property of the harness rather than a finding
about the fabric. This phase adds a **process-per-node** driver that spawns `bin/agent.ts`
as N operating-system processes on one host. The two in-process drivers stay, and their
published numbers stay.

**2. Two declared dimensions.** `RunConfig` gains required `driver` and `fixture` fields.
Required, not optional: the raw observations go to `.planning/bench/raw.json`, which has no
headings to fall back on, and a provenance field that *can* be omitted eventually is — at
the one call site nobody re-reads. Both are rendered as columns in every makespan table,
placed before any number, and every figure-carrying section heading names the driver and
fixture its numbers were derived from, read off the curve rather than written into the
string.

**3. What this does not buy, stated plainly.** A same-host run **cannot** detect divergence
between machines, because it has one CPU, one V8 and one libc. Spawning sixteen processes
changes the scheduler that runs them and nothing about the arithmetic they perform.
BENCH-06's distinct-machine claim is therefore **descoped and unmeasured, and unmeasured is
not met** — it is not closed by this phase, not transferred to it, and nothing this phase
publishes may be read as evidence for it. The same-machine label of §3.3 stays mandatory on
every table, and the process count is disclosed beside the node count rather than in place
of it.

**4. The axis this phase sweeps.** §1.1's node-count axis only, one requestor, one job in
flight. The user-count axis — where §1.1 says a super-linear claim could live — is **not
swept by this phase**, and no figure produced here bears on it. The process driver makes
that second axis buildable for the first time, which is a reason to name it as the next
benchmark question and not a reason to imply it was answered.

**5. The integrity thresholds this phase will judge its own runs against, fixed before any
data exists.** A rung is **rejected**, and the run produces no report at all, when any of
these hold:

- **the observed process identity is wrong** — the child process count does not match the
  rung's node count, a process id repeats, the driver's own process id appears among the
  children, a child's announced identity does not match the process that announced it, or
  the executor set does not correspond one-for-one with processes that were observed. A
  run that silently fell back to in-process nodes fails here rather than reporting a curve;
- **the driver's own CPU time exceeds half the shard compute time it dispatched** —
  `MAX_DRIVER_CPU_SHARE = 0.5`. This is a **declared threshold**, chosen now precisely
  because no data exists to tune it against, and it is deliberately **not** a figure worked
  out from how a driver is expected to behave. What the share actually comes to at each
  rung is a quantity the run measures and publishes beside the rung;
- **the fixture's shard status vector is anything other than `SHARDS` `budget` results** —
  a non-uniform or short vector means the fixture is mis-parameterised for this host, and a
  ratio taken over it would be reading the split rather than the parallelism.

A rejection is not an excluded row. §7's exclusion rule covers a configuration that could
not be **measured**; these three say the measurement that came back is not of the thing it
claims, and publishing that as a rung with a caveat is how a harness defect becomes a
finding about a fabric.

### 2026-08-05 — a fixed-redundancy speedup sweep, and the two mechanisms that make fixing redundancy insufficient (Phase 23, BENCH-07)

**1. Why the existing ladders cannot carry a speedup ratio.** Both published sweeps run at
`redundancy = min(2, nodes)`. The 1-node rung is therefore R=1 and every other rung is
R=2, so a ratio taken between the ends of that ladder varies **two** things at once —
parallelism and replication — and attributes the whole difference to the first. The
headline N=1 ↔ N=8 ratio this phase publishes comes instead from a **dedicated sweep at
R = 1 across the full ladder**, run under both the in-process and the process-per-node
driver on the same fixture, so the multi-process curve has an in-process control that
differs from it in exactly one declared dimension.

**2. Holding redundancy at 1 is necessary and it is not sufficient.** This is
pre-registered as part of the plan rather than added afterwards as a caveat, because it
changes what the ratio is allowed to be published with. Two mechanisms vary a shard's
dispatch count without varying redundancy:

- **Re-placement.** `placeAgain` sits inside `submitJob`'s unconditional per-shard
  generation loop. There is no `redundancy === 1` branch anywhere on that path;
  `LeaseTable` is the only bound and it bounds *generations*, at
  `DEFAULT_MAX_GENERATIONS = 3`.
- **Straggler speculation.** `speculativeCandidates` does not read redundancy at all, and
  `SpeculationLedger`'s allowance is `floor(tasks × DEFAULT_SPECULATION_FRACTION)`, which
  at `SHARDS = 16` and a fraction of `0.1` is **one**. Below ten shards the allowance is
  zero and the watchdog never starts; sixteen is above that threshold, so speculation is
  **on** for every job this driver submits.

So a shard at R=1 can be placed as many as three times and duplicated once.

**3. What the ratio must be published with.** Per rung: `redispatches` and
`speculationMultiplier` — both already measured on this path and already rendered as
`churn/task` and `spec. tax` — **and** a reading of `ShardResult.generations` and
`ShardResult.speculated`, which exist on the result and are not yet surfaced by the driver.
A ratio published without them is a finding about the harness rather than about the fabric,
which is exactly what this phase's second success criterion forbids. The published
trivial-fixture run reports zero for both existing columns; that establishes the
instruments are wired and were quiet on that fixture, and it establishes nothing about a
saturating fixture on an oversubscribed host, which is the regime where a straggler
appears.

**4. No expected speedup figure is declared, and the previous one is withdrawn.** An
earlier draft of this entry pre-registered an ideal speedup derived from an eight-partition
measurement. `SHARDS` is sixteen; the figure is withdrawn and **nothing replaces it as a
number**. What is pre-registered instead is the *method*. The ideal bound is `sum / max`
over `SHARDS` per-shard durations obtained by a **serial calibration** on the N=1
process-per-node fabric — one call in flight at a time — taken by the same run that
publishes the ratio it constrains.

**5. Why the measured job's own per-call times cannot supply that bound.** `submitJob`
dispatches shards concurrently, so even at N=1 the recorded per-call intervals overlap in
wall-clock time. A sum of overlapping intervals is not a serial total, and dividing by the
maximum of them yields a bound that is wrong in an unknown direction. The calibration is
therefore a separate, deliberately serial pass, and it is stated here so that a later
reader cannot mistake it for an extra measurement someone added to make a ratio look
better.

**6. What does not change.** The existing memory-transport and real-transport ladders keep
`redundancy = min(2, nodes)` and keep every number they have published. The R=1 sweep is an
addition beside them, labelled as its own configuration, and no figure moves between the
two. On the R=1 sweep the verification tax of §2.2 is reported as the identity `1.00×`,
exactly as the 1-node rung of the existing ladders already is: BENCH-04 is satisfied by
gross and useful node-seconds both appearing with their ratio, not by that ratio exceeding
one.

### 2026-08-05 — an opt-in dispatch leg, and a third declared dimension (Phase 23, AUTH-03)

**1. Why a benchmark document is describing a capability chain.** Phase 15 wired AUTH-03's
serving end and verified it end to end, and left its requestor half — `delegate`,
`CapabilitySupplier`, and the supplier branch of `RemoteExecutor.execute` — with **no
production caller at all**. Every production dispatch site in the repository labels its
shards public, and a public shard has no owner, so there is no root key a chain could be
rooted at. Owner ruling 2026-07-31 routed the fix into this phase rather than shipping the
adapter as accepted-unreachable, and it lands here because this phase already rewrites the
driver's node construction and that file is the most contended in the repository.

**2. What is added.** `bin/bench.ts` gains an **opt-in leg, off by default**, that
configures per-node clearance, mints a real capability chain against each worker's own
identity, and dispatches one owner-labelled shard through it. It is not a node kind and it
is not a second rig: every node in either leg is the same node, built by the same code
path, and what differs is the label on one shard and the clearance the nodes were started
with.

**3. The third declared dimension.** `RunConfig` gains a required `leg` field recording
what the rung actually **dispatched** — whether every shard it submitted was public and
every dispatch named the unauthenticated sentinel, or whether at least one shard carried an
owner and went through a real chain. It is a fact about the dispatch, not about what the
operator intended, and it exists so that the promise in the next paragraph is **checkable
in `raw.json` rather than asserted in prose**. It is deliberately not rendered as a table
column: in every published curve its value is the same, and a constant is not a result.

**4. The property the leg is held to.** *The default curve is unchanged in shape by the
leg's existence.* That is a claim about a run made with the flag absent — such a run must
build exactly what it built before the flag existed, down to the extra process not being
started and the enrolment round trip not happening at all. It is checked by spawning the
driver and reading its output, not by asserting it here. If the leg moves the default
measurement, it has been built wrong, and the correct response is to fix the leg rather
than to re-baseline the curve.

**5. No figure produced under the leg is published beside a default curve.** The two runs
build different rigs and therefore measure different things, for exactly the reason the
existing discovery arm's own report line already gives about itself. A run made under the
leg says so in its own report, and its numbers are not folded into the ladder.
