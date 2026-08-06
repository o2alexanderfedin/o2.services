# o2.services — benchmark run

**SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count**

Run at 2026-08-06T03:06:30.872Z. Methodology pre-registered in
[`BENCHMARK-METHODOLOGY.md`](./BENCHMARK-METHODOLOGY.md), committed before
this harness existed.

## What these numbers do NOT establish

- **No parallel speedup is measurable on the memory-transport curve, by construction — and this entry no longer says that about every in-process rig, because that was measured false.** `memoryFabric` builds its executors directly, so its N node identities share one OS process *and* one JavaScript event loop, and its curve measures **coordination cost** rather than parallelism. The real-transport rig does not: it builds each node with `FabricNode.start`, and a `FabricNode` composes a `WorkerExecutor` over its own worker thread, so N in-process nodes are N threads on this host’s cores. The previous wording — *every node in both curves runs inside one OS process on one JavaScript event loop* — was true of the first rig and false of the second, and is corrected here rather than carried forward.
- **What the `process-per-node` driver therefore adds is process isolation, not parallelism where there was none.** Each of its nodes is an operating-system process, checked by reading the pid the child announced on its own handshake line against the pid this driver was handed by `spawn`, and by requiring every built executor to address a node some observed child announced. A rung that failed any of those readings aborts the run and produces no report at all, so a curve existing here is itself part of the claim. The in-process control below is run on the identical fixture, redundancy, ladder and job path precisely so the difference between the two is the one thing that varied.
- **What the `process-per-node` curve does NOT establish is distinct machines.** Its processes share one host, one CPU, one memory bus and one scheduler, so a rung whose observed process count exceeds the logical core count is oversubscribed and a knee there is contention rather than coordination. The observed process count and the core count are both published below, per rung, so a reader can see which rungs those are rather than take a claim about it.
- **BENCH-06’s distinct-machine half is descoped, and unmeasured is not met.** Every rung in this report ran on one host, and a same-host run **cannot detect divergence between machines** whatever its process count: one CPU, one V8 and one libc produce one answer, and a divergence is a disagreement between two. **Spawning an operating-system process per node does not close this**, and no section below should be read as though it did — what process isolation buys is separate address spaces and separate schedulers on the same machine, which is a different property from two machines disagreeing about a float. What would measure it is a second host, and one was not available. Recorded in these words because this is the phase whose report is most likely to be read as having closed it.
- **BENCH-06 (distinct machines) is NOT met.** One machine was available, so every number here is same-machine. The N the ladder counts is N *node identities*, and they share one host — and, per the entry above, one process — so they share a CPU, a memory bus, a scheduler and an event loop. This measures software scaling with contention included and the network excluded, and it is not a measurement of N machines. The label on every table says which of the two it is.
- No hosted relay exists yet, so no WAN browser-tier number is included. The real transport here is libp2p over TCP on loopback.
- The WASM fixture does almost no work, so per-task overhead dominates and the COST crossover is worse than it would be for a realistic workload. Declared in the methodology before these runs, not discovered afterwards.
- The 1-node rung necessarily runs at redundancy 1: verification needs two independent executors, and one node cannot supply them. Its verification tax of 1.0 is therefore a property of the system, not a cheaper configuration — the same reason a sovereign shard with one owner node is owner-attested.
- **A default run of this driver establishes no attestation strength on any rung, and the `attestation` readings above will all say so.** That is a property of the rigs rather than of the fabric, and it is measured rather than assumed: a descriptor carries a certificate only where one was discovered, discovery runs only under `--discover`, and `memoryFabric` builds its descriptors with `publicNodes`, which carries none by construction — so on a default run this requestor holds no certificate for any replica and can account for none of them. The labelled readings — a one-replica rung reading `owner-attested`, a two-operator rung reading `independent` — are available only on a `--discover` run, whose numbers must not be published beside these ones for the reason stated at that flag. What is therefore **unmeasured here** is the attestation of the configuration these curves were taken under; what is measured is that it was not established, which is a different and weaker statement.
- **A `--sovereign` run is not comparable with a default one, and no figure taken under that flag is published beside a default curve.** AUTH-03’s requestor half — `delegate` and `CapabilitySupplier` — has a caller reachable from this entry point: `--discover --sovereign` clears every worker for one owner, mints a chain rooted at the key those workers enrolled under, and dispatches one owner-labelled shard through executors discovery built. **That leg is a dispatch-path demonstration and not a measurement**: it runs once per real rig, during construction and outside every timed region, as a job of its own that no rung reads. What it nonetheless changes is what the rig IS — every worker starts with a per-node clearance it does not otherwise have, and holds one row it does not otherwise hold — which is exactly why the flag exists, why it is off by default, and why every configuration row this report renders — each criterion-3 attempt’s, and each excluded rung’s — carries whether it was in force beside `discover`. **What the leg does NOT establish is a sovereignty claim about data**: the shard carries an owner label and a verified chain, and its value is a fixture row this driver invented. The egress and coverage machinery is what would make a data claim; this is about the dispatch path, and saying so is cheaper than letting a reader assume otherwise.
- **The `aggregate attestation` lines say the same thing on a default run, for a second and independent reason.** A default rig pins no issuer at all — no provider process is started and no worker enrols — so it hands `reduceJob` the `checks-no-combine-signatures` literal and the aggregate receipt is the named absence by construction. That is truthful rather than degraded: a combine signed by nobody is what a fabric of unenrolled nodes produces. The two receipts are printed separately because they are claims about different things — this rig’s map half and its aggregation half can differ, and on a `--discover` run they do.
- **`spec. tax` and `churn/task` are now read from each job, and on a default run they are measurements of a fabric in which nothing went wrong.** Until 20-09 both were literals this driver wrote by hand, and the entry here said so; that sentence is false in the other direction now and this is its replacement. The measurement site reads `JobResult.speculationMultiplier` and `JobResult.redispatches`, which `submitJob` has carried since 20-07 and 20-01 respectively. **What a reader must not conclude from a `1.00` and a `0.00` is that the mechanisms are off.** A job with no straggler reports a multiplier of exactly `1`, and a job in which no lease lapsed reports zero re-dispatches, so these two rows say *this sweep produced no tail and lost no node* — which is what a healthy in-process fabric running a uniform workload should say, and is a weaker statement than the mechanism having fired. A further bound is structural and worth naming: the budget is `floor(shards × 0.1)` and this driver submits 16 shards, so at most one duplicate is affordable per run. **The reading that a straggler really is duplicated across processes, and that the losing copy is still accounted for, lives in `packages/node/src/speculation-agents.node.test.ts`, not here** — and those two call sites are guarded against reverting to constants from the same file.
- **The reduce figures are subject to the same one-process, one-event-loop construction as the makespan figures.** `combine executors` counts distinct *node identities*, not distinct machines and not even distinct OS processes, so a value above 1 says the rendezvous ranking spread the combines across identities — not that any of them ran anywhere else. The eight-process evidence for the tree walk lives in `packages/node/src/tree-reduce-agents.node.test.ts`, not here.
- **`tree depth` and `combines` are decided by `deriveReduceTree` from a shard count and a fanout this sweep never varies.** A column the run shows constant across every rung of both transports carries no information about a configuration, and a constant is not a result. **`spec. tax` and `churn/task` are no longer the same status and the difference is worth keeping straight:** since 20-09 those two are *measured* and merely happen to be constant on this sweep, whereas these two are *decided* by `deriveReduceTree` from inputs the sweep never varies and could not come out otherwise. The reduce columns expected to carry information are `reduce p50`, `reduce p95`, `recomputes` and `combine executors`; read those. Varying the fanout across the sweep would make the other two informative and was rejected for a stated reason: rungs walking differently-shaped trees have incomparable reduce timings, which is the only thing the reduce table is for.
- **The real-transport reduce refusal that emptied this table on 2026-08-01 has been removed, and the rows below are whatever the run above actually produced.** Recorded rather than deleted, because a reader comparing two dated artifacts must be able to tell a figure that changed from a figure that was replaced. What the previous run published here: every real-transport row an em dash, because `serveAgent`’s combine branch refused outright unless its `authorize` hook was the `serves-unauthenticated` sentinel, and every `FabricNode` supplies a real `authorizeCapability` — so every node in the real-transport rig answered `combine requires a capability chain this build cannot verify`, measured as `combines: 0`, `failed: 5`, `executedBy: 0`, `rootCid: null`. 16-05 routed a combine through `options.authorize` like every other request, so a combine is now admitted or refused by the node’s own authorizer rather than by a branch keyed on whether the node had one. **An em dash in this table therefore no longer means "refused"** — it means that rung produced no reduce at all, and the excluded list below is where its reason is named. The two reduce curves are comparable only across rungs both transports measured.

## Machine inventory

| host | roles | CPU | cores (phys/log) | RAM | OS | runtime |
|---|---|---|---|---|---|---|
| Alexanders-MacBook-Pro.local | worker, requestor, aggregator | Apple M1 Pro | 0/8 | 32.0 GiB | darwin 25.5.0 | node v23.11.0 |

## Makespan — memory transport, in-process driver (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | driver | fixture | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | in-process | trivial | 26.8ms | 35.4ms | 35.4ms | 19 | 0 | 4.519 | 4.519 | 1.00× | 1.00× | 0.00 | 48.1ms |
| 2 | in-process | trivial | 55.2ms | 107.8ms | 107.8ms | 19 | 0 | 18.472 | 9.236 | 2.00× | 1.00× | 0.00 | 68.7ms |
| 4 | in-process | trivial | 51.8ms | 73.3ms | 73.3ms | 19 | 0 | 17.004 | 8.502 | 2.00× | 1.00× | 0.00 | 58.9ms |
| 8 | in-process | trivial | 58.2ms | 131.9ms | 131.9ms | 19 | 0 | 22.042 | 11.021 | 2.00× | 1.00× | 0.00 | 54.3ms |
| 16 | in-process | trivial | 57.0ms | 109.8ms | 109.8ms | 19 | 0 | 19.166 | 9.583 | 2.00× | 1.00× | 0.00 | 55.6ms |

## Makespan — real transport, in-process driver (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | driver | fixture | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | in-process | trivial | 49.4ms | 87.3ms | 87.3ms | 19 | 0 | 14.100 | 14.100 | 1.00× | 1.00× | 0.00 | 280.4ms |
| 2 | in-process | trivial | 92.3ms | 139.3ms | 139.3ms | 19 | 0 | 54.275 | 27.137 | 2.00× | 1.00× | 0.00 | 277.3ms |
| 4 | in-process | trivial | 89.9ms | 162.0ms | 162.0ms | 19 | 0 | 54.322 | 27.161 | 2.00× | 1.00× | 0.00 | 323.8ms |
| 8 | in-process | trivial | 96.6ms | 135.4ms | 135.4ms | 19 | 0 | 55.713 | 27.856 | 2.00× | 1.00× | 0.00 | 423.0ms |

## Makespan — real transport, process-per-node driver (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | driver | fixture | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | process-per-node | saturating | 1591.1ms | 1786.1ms | 1786.1ms | 19 | 0 | 264.721 | 264.721 | 1.00× | 1.00× | 0.00 | 1819.6ms |
| 2 | process-per-node | saturating | 980.3ms | 1192.3ms | 1192.3ms | 19 | 0 | 169.334 | 169.334 | 1.00× | 1.06× | 0.00 | 1335.0ms |
| 4 | process-per-node | saturating | 676.0ms | 848.4ms | 848.4ms | 19 | 0 | 117.004 | 117.004 | 1.00× | 1.06× | 0.00 | 931.5ms |
| 8 | process-per-node | saturating | 590.0ms | 755.4ms | 755.4ms | 19 | 0 | 108.022 | 108.022 | 1.00× | 1.03× | 0.00 | 986.5ms |

## Reduce tree — memory transport (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count) — in-process driver, trivial fixture

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | 1.0ms | 3.5ms | 2 | 5 | 0 | 1 |
| 2 | 1.4ms | 5.6ms | 2 | 5 | 0 | 2 |
| 4 | 1.5ms | 1.9ms | 2 | 5 | 0 | 3 |
| 8 | 1.5ms | 3.6ms | 2 | 5 | 0 | 4 |
| 16 | 1.6ms | 4.5ms | 2 | 5 | 0 | 5 |

## Reduce tree — real transport (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count) — in-process driver, trivial fixture

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | 21.5ms | 31.5ms | 2 | 5 | 0 | 1 |
| 2 | 44.6ms | 105.5ms | 2 | 5 | 0 | 2 |
| 4 | 37.4ms | 79.2ms | 2 | 5 | 0 | 3 |
| 8 | 45.8ms | 59.0ms | 2 | 5 | 0 | 3 |

## Configurations excluded, and why — in-process driver, trivial fixture

| configuration | reason |
|---|---|
| real transport, 16 nodes | `EncryptionFailedError`: `read ECONNRESET` — observed under: driver=in-process; dial=workers-to-submitter; nodes=16; shards=16; redundancy=2; fixture=trivial; admissionLimit=64; discover=off; sovereign=off; stagger=none |

## Connectivity tax — in-process driver, trivial fixture

| nodes | memory p50 | real p50 | tax |
|---|---|---|---|
| 1 | 26.8ms | 49.4ms | 1.84× |
| 2 | 55.2ms | 92.3ms | 1.67× |
| 4 | 51.8ms | 89.9ms | 1.74× |
| 8 | 58.2ms | 96.6ms | 1.66× |

## COST crossover — in-process driver, trivial fixture

Single-threaded baseline: p50 0.0040ms · p95 0.015ms · p99 0.015ms (n=19)

**No crossover.** no crossover within the measured range (1, 2, 4, 8, 16 nodes).

Best distributed p50 was 26.8ms at 1 node, against a baseline p50 of 0.0040ms — a factor of 6702.75×.

## Supplementary — where the time goes — in-process driver, trivial fixture, and two runs with no fabric

Not part of the pre-registered plan; included because it decomposes the crossover
rather than flattering it.

- Declared run configuration: **16 shards** per job, and **every node in both rigs admits at 64 concurrent tasks** — the memory rig from one `LocalCapacity` per `serveAgent` endpoint, the real rig from `maxConcurrentTasks` on each `FabricNode.start`, both reading one declared constant in this driver rather than inheriting a default. That is load-bearing for the connectivity tax below: until phase 13.1 wired it, the memory rig ran with admission switched off while the real rig admitted, so the two curves were measured against nodes that behaved differently and nothing in the report said so. Shards were raised from 8 by phase 13.1, above the measured 12-shard cliff the per-peer send gate removed, so the two shard counts are not measuring the same workload as an earlier run.

- Single-threaded, native, no fabric: **0.004ms** p50
- Same work through WASM in-process, no fabric: **58.571ms** p50
- Skewed input, 4 nodes, memory transport: **88.2ms** p50 (uniform at 4 nodes: 51.8ms)

Reading the decomposition: the native baseline and the same work through WASM
in-process differ by more than two orders of magnitude, and the distributed run
adds well under one more on top of the WASM figure. Most of the COST gap is
therefore the guest ABI on a workload that does almost no work — not the fabric.
That is a statement about the fixture, and it is why the methodology declared the
fixture bias in advance rather than discovering it here.

## Processes — process-per-node driver, saturating fixture

Observed, per rung. The host reports **8 logical cores**. A rung whose
observed process count exceeds that is oversubscribed, and a knee there is contention
rather than coordination.

| nodes | node processes observed | oversubscribed | agent process ids |
| --- | --- | --- | --- |
| 1 | 2 | no | 32497 |
| 2 | 3 | no | 33942, 33943 |
| 4 | 5 | no | 34928, 34929, 34931, 34930 |
| 8 | 9 | yes | 35534, 35535, 35536, 35537, 35538, 35539, 35540, 35541 |

The observed count is `nodes + 1`: the submitting node stays in this driver’s process,
because it holds the store the module is put into, exposes the guard the egress manifest
is read off, and owns the endpoint every remote executor is built over. Counting it is
the honest reading of what the host was asked to run.

## Speedup — in-process and process-per-node drivers, fixed redundancy 1, saturating fixture

Two sweeps over one ladder, differing in exactly one thing: whether a node is an
operating-system process. Redundancy is held at **1** on both, so the ratio does not
also vary replication — necessary, and by itself not sufficient, which is what the last
four columns are for.

**Read the control before reading the ratio.** The `in-process` rows are not flat, and
that is a fact about the rig rather than a defect in it: those nodes are built by
`FabricNode.start`, which composes a `WorkerExecutor` on its own worker thread, so N
in-process nodes are N threads on this host’s cores. What the two curves therefore
compare is **process isolation against threads inside one process** — not parallelism
against none. Any reading of the process-per-node column that does not carry that
sentence is overclaiming.

The **driver CPU share** column is this driver’s own `process.cpuUsage()` delta across
the rung, over the gross node-seconds it dispatched. That denominator is a proxy and
not a CPU measurement: gross node-seconds is wall time inside each executor call, so on
a genuine multi-process run it includes network wait. The ceiling the process-per-node
rungs are judged against is **0.5**, declared in the methodology
before any of this data existed. The in-process rungs are **not** judged against it —
their work is in this process by construction — and their share is published so the two
can be compared. The two being different is the reading; neither crossing a line is.

| nodes | driver | p50 makespan | speedup vs its own 1-node rung | incomplete | driver CPU share | churn/task | spec. tax | generations | speculated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | process-per-node | 1591.1ms | 1.00× | 0 | 0.005 | 0.00 | 1.00× | 1 | false |
| 1 | in-process | 1576.8ms | 1.00× | 0 | 0.107 | 0.00 | 1.00× | 1 | false |
| 2 | process-per-node | 980.3ms | 1.62× | 0 | 0.007 | 0.00 | 1.06× | 1 | false/true |
| 2 | in-process | 1159.1ms | 1.36× | 0 | 0.159 | 0.00 | 1.06× | 1 | false/true |
| 4 | process-per-node | 676.0ms | 2.35× | 0 | 0.009 | 0.00 | 1.06× | 1 | false/true |
| 4 | in-process | 732.3ms | 2.15× | 0 | 0.249 | 0.00 | 1.06× | 1 | false/true |
| 8 | process-per-node | 590.0ms | 2.70× | 0 | 0.009 | 0.00 | 1.03× | 1 | false/true |
| 8 | in-process | 454.3ms | 3.47× | 0 | 0.324 | 0.00 | 1.01× | 1 | false |

**The three confound readings are the last four columns, and they are published beside
the ratio rather than after it.** `redispatches` (`churn/task`) and the speculation
multiplier (`spec. tax`) have been measured per rung since 20-01 and 20-07 and read as
their identity — `0.00` and `1.00×` — on every rung of the published trivial-fixture
run. That establishes the instruments were quiet on that fixture. It does **not**
establish they will be quiet on this one, and the reason is structural: a shard at
redundancy 1 sits in an unconditional generation loop bounded only by the lease table,
and the speculation allowance does not read redundancy at all. The `generations` and
`speculated` columns are the per-shard vectors those two summarise, printed as the
distinct values observed across the rung’s sixteen shards.

### The coordination ratio, per rung

| nodes | in-process p50 | process-per-node p50 | coordination ratio |
| --- | --- | --- | --- |
| 1 | 1576.8ms | 1591.1ms | 0.99× |
| 2 | 1159.1ms | 980.3ms | 1.18× |
| 4 | 732.3ms | 676.0ms | 1.08× |
| 8 | 454.3ms | 590.0ms | 0.77× |

Same fixture, same redundancy, same ladder, same shard count, same job path. A ratio
near 1 at a rung where the process curve was supposed to fall is the reading that says
coordination ate the gain. This is **not** the connectivity tax and must not be read as
one: that figure is computed over the in-process trivial curves at a different
redundancy, so there is no connectivity tax figure for any rung here.

### The ideal bound, derived from this run

**9.78×**, computed as sum ÷ max over **16**
per-shard durations measured on the 1-node process-per-node fabric with exactly
one call in flight at a time, so each measurement is that shard’s own duration and
nothing else’s. Each includes one RPC round trip on top of the shard, and no estimate
of that is subtracted. The block was already resident at the agent from the rung’s
measured runs, so this is compute rather than first fetch. **No pre-registered figure
is published beside it**: the withdrawn one was derived at eight partitions and this
run uses sixteen.

The host reports **8 logical cores**. Rungs whose observed node-process
count exceeded that: 8.

## The excluded rungs, re-measured — in-process and process-per-node drivers, trivial fixture

**Criterion 3 names two rungs, and the committed run of 2026-08-01 excluded one.** Its
real-transport curve carries a working 8-node rung at `n = 19` with `incomplete = 0`, and
the only excluded row is `real transport, 16 nodes`. This phase did not rescue the 8-node
rung and does not claim to have: it was already running before any of this landed. The
scope of the criterion is therefore **one** rung, stated here rather than absorbed —  a
rung that quietly appears between the plan and the results is as unreadable as one that
quietly vanishes.

So attempt A8 below is a control whose outcome is known, and every other attempt sits at
the one rung actually in dispute. Each varies **one** thing from its neighbour, because
three independent levers exist — raise the option, stagger the joins, change which side
receives the dials — and adopting the spawn pattern moves two of them at once.

| attempt | driver | dial | cap pinned | nodes | job completed | observed inbound/pending | connections held by the driver’s node |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A8 | in-process | workers-to-submitter | derived-on-every-node | 8 | yes | 15/15 (driver’s node), no agent (agents) | 8 |
| A | in-process | workers-to-submitter | derived-on-every-node | 16 | **no** | unread (driver’s node), no agent (agents) | no-node-survived-to-be-read |
| B | in-process | workers-to-submitter | pinned-on-the-receiving-node | 16 | **no** | unread (driver’s node), no agent (agents) | no-node-survived-to-be-read |
| C | in-process | submitter-to-workers | derived-on-every-node | 16 | yes | 15/15 (driver’s node), no agent (agents) | 16 |
| D | process-per-node | submitter-to-workers | derived-on-every-node | 16 | yes | 15/15 (driver’s node), 15 (agents) | 16 |
| E | process-per-node | submitter-to-workers | pinned-on-every-agent | 16 | yes | 15/15 (driver’s node), 5 (agents) | 16 |
| F | process-per-node | workers-to-submitter | derived-on-every-node | 16 | **no** | unread (driver’s node), no agent (agents) | no-node-survived-to-be-read |
| G | process-per-node | workers-to-submitter | pinned-on-the-receiving-node | 16 | **no** | unread (driver’s node), no agent (agents) | no-node-survived-to-be-read |

What each attempt is in the table to answer, and what any of them that failed reported:

| attempt | asks | reported |
| --- | --- | --- |
| A8 | the control: whether the rung that already runs still runs against today’s code | the job completed |
| A | the arrangement every published number was taken under — whether the exclusion still reproduces at all | `EncryptionFailedError`: `read ECONNRESET` — observed under: driver=in-process; dial=workers-to-submitter; cap=derived-on-every-node; nodes=16; shards=16; redundancy=2; fixture=trivial; admissionLimit=64; observedSubmitterInbound=no-node-survived-to-be-read; observedSubmitterPending=no-node-survived-to-be-read; submitterConnectionsHeld=no-node-survived-to-be-read; observedAgentInbound=no-agent-announced-a-limit; stagger=none; discover=off; sovereign=off |
| B | the cap pinned back to the value the published exclusion blames, on the node that receives the dials | `Error`: `connection error 127.0.0.1:54345: connect ECONNRESET 127.0.0.1:54345` — observed under: driver=in-process; dial=workers-to-submitter; cap=pinned-on-the-receiving-node; nodes=16; shards=16; redundancy=2; fixture=trivial; admissionLimit=64; observedSubmitterInbound=no-node-survived-to-be-read; observedSubmitterPending=no-node-survived-to-be-read; submitterConnectionsHeld=no-node-survived-to-be-read; observedAgentInbound=no-agent-announced-a-limit; stagger=none; discover=off; sovereign=off |
| C | the dial direction alone, with the process split held at one process | the job completed |
| D | this phase’s headline configuration | the job completed |
| E | the cap pinned on the agents — kept because its failure would inform, not because its success would | the job completed |
| F | N processes on one host opening connections to one node, at the derived limit | `Error`: `agent in /var/folders/0s/tfrwn0013mv7f4msz96r_2z40000gn/T/o2-bench-proc-nzjowK/node-14 exited early with 2: (node:41060) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time (Use 'node --trace-warnings ...' to show where the warning was created) agent.ts: --peer-addr /ip4/127.0.0.1/tcp/54452/p2p/12D3KooWCRE9eVF3GBYJmFbSTYEiukXAQkPtz7tGVEaeaz7w9xRe could not be dialled: connection error 127.0.0.1:54452: connect ECONNRESET 127.0.0.1:54452 usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id — the enrolled user key when --user-key is given> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates --max-issued-per-window <n>] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...] [--peer-addr <multiaddr> ...] [--max-concurrent-tasks <n>] [--inbound-threshold <n>] [--duty-cycle <n>] [--relay-addr <multiaddr> ...]` — observed under: driver=process-per-node; dial=workers-to-submitter; cap=derived-on-every-node; nodes=16; shards=16; redundancy=2; fixture=trivial; admissionLimit=64; observedSubmitterInbound=no-node-survived-to-be-read; observedSubmitterPending=no-node-survived-to-be-read; submitterConnectionsHeld=no-node-survived-to-be-read; observedAgentInbound=no-agent-announced-a-limit; stagger=none; discover=off; sovereign=off |
| G | the positive control — the attempt that is supposed to fail | `Error`: `agent in /var/folders/0s/tfrwn0013mv7f4msz96r_2z40000gn/T/o2-bench-proc-CznYjb/node-1 exited early with 2: (node:41396) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time (Use 'node --trace-warnings ...' to show where the warning was created) agent.ts: --peer-addr /ip4/127.0.0.1/tcp/54485/p2p/12D3KooWGFChDmc2fsJG9dKBdhWuExV88cAcDHfdZQBzk4qAEBJN could not be dialled: Encryption failed usage: agent.ts --dir <blockstore-dir> [--port <n>] [--owner-id <id — the enrolled user key when --user-key is given> [--owner-key <hex>] [--can-execute-sovereign]] [--trust-anchor <hex> ...] [--issues-certificates --max-issued-per-window <n>] [--provider-addr <multiaddr> --user-key <path> --operator-id <id>] [--trusted-issuer <hex> ...] [--peer-addr <multiaddr> ...] [--max-concurrent-tasks <n>] [--inbound-threshold <n>] [--duty-cycle <n>] [--relay-addr <multiaddr> ...]` — observed under: driver=process-per-node; dial=workers-to-submitter; cap=pinned-on-the-receiving-node; nodes=16; shards=16; redundancy=2; fixture=trivial; admissionLimit=64; observedSubmitterInbound=no-node-survived-to-be-read; observedSubmitterPending=no-node-survived-to-be-read; submitterConnectionsHeld=no-node-survived-to-be-read; observedAgentInbound=no-agent-announced-a-limit; stagger=none; discover=off; sovereign=off |

**Attempt E is not a control and the table must not be read as though it were.** Under D
and E the submitting node dials outward, so the agents are the dial targets and each is
dialled from one host. What that does to a per-second per-host cap is not derived here,
so E succeeding establishes nothing about the cap. It is kept because it is cheap and
because its *failure* would have informed: **agent-side cap pinned, exercise not
established — the agents’ inbound connection counts were not instrumented under this
direction.**

**At least one attempt failed, and its error and configuration are in the table above.** The pair a reader wants is the failing attempt beside its nearest neighbour: the two reasons differ in exactly the pair the two attempts differ in, which is what makes the lever legible.

**Which lever the outcomes separate on, read off the block rather than argued for.**
Taken across the attempts at the disputed rung alone, since the 8-node control is the
one cell at a rung nobody disputes:

- **dial direction** — workers-to-submitter on every failure, submitter-to-workers on every success
- **driver** — does not separate them: a value of it appears on both sides
- **cap placement** — does not separate them: a value of it appears on both sides

Only dial direction partitions the outcomes cleanly. **A lever whose value appears on both sides cannot be what separated them**, which is what every entry above reading "does not separate" is saying about itself.

Attempt G — the positive control — failed, which is what it exists to do.

**Two levers this block did not exercise, named rather than left unmentioned.**
Staggering the joins is a real third lever and every attempt above records
`stagger: none`; naming it is not measuring it. And **the agents’ inbound connection
counts were not instrumented**: the agents are child processes, nothing announces their
counts, and the only connection population this rig can read is the driver’s own node’s.
No attempt’s outcome above is explained by a count nobody read.

Every attempt ran with the discovery arm **off**. A discovering run
starts a provider and enrols every worker, so its rung holds a different node population
from these — stated because a reader comparing the two would otherwise be comparing
different fabrics.

## Earlier run — frozen (in-process driver, trivial fixture)

The run stamped `2026-08-01T06:09:01.272Z` published a memory ladder over 1/2/4/8/16
nodes and a real-transport ladder over 1/2/4/8, both in-process on the trivial fixture.
**Every rung it published has been re-measured by the run above and overwritten in this
file.** Its own figures survive byte for byte in
[`BENCHMARK-RESULTS-2026-08-01.md`](./BENCHMARK-RESULTS-2026-08-01.md), which this
driver does not write and no later run of it will.

**Do not read the tables above as still containing those values.** They are a second
measurement of the same configurations, taken on a different day, under a different
load, by a driver this phase changed — so a reader comparing the two artifacts is
comparing two runs, which is the only honest comparison available. What a reader must
be able to tell apart is a figure that *changed* from a figure that was *replaced*, and
both files existing is what makes that possible.
