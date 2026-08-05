# o2.services — benchmark run

**SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count**

Run at 2026-08-01T06:09:01.272Z. Methodology pre-registered in
[`BENCHMARK-METHODOLOGY.md`](./BENCHMARK-METHODOLOGY.md), committed before
this harness existed.

## What these numbers do NOT establish

- **No parallel speedup is measurable here, by construction.** Every node in both curves runs inside one OS process on one JavaScript event loop — the memory transport is in-process by definition, and the real transport creates its libp2p nodes in the same process and dials them over loopback. So these curves measure **coordination cost**, not parallelism, and the flat makespan across the node ladder is the expected consequence rather than a finding about scaling. Demonstrating speedup needs separate processes or machines and is not done here.
- **BENCH-06 (distinct machines) is NOT met.** One machine was available, so every number here is same-machine. The N the ladder counts is N *node identities*, and they share one host — and, per the entry above, one process — so they share a CPU, a memory bus, a scheduler and an event loop. This measures software scaling with contention included and the network excluded, and it is not a measurement of N machines. The label on every table says which of the two it is.
- No hosted relay exists yet, so no WAN browser-tier number is included. The real transport here is libp2p over TCP on loopback.
- The WASM fixture does almost no work, so per-task overhead dominates and the COST crossover is worse than it would be for a realistic workload. Declared in the methodology before these runs, not discovered afterwards.
- The 1-node rung necessarily runs at redundancy 1: verification needs two independent executors, and one node cannot supply them. Its verification tax of 1.0 is therefore a property of the system, not a cheaper configuration — the same reason a sovereign shard with one owner node is owner-attested.
- **`spec. tax` and `churn/task` are now read from each job, and on a default run they are measurements of a fabric in which nothing went wrong.** Until 20-09 both were literals this driver wrote by hand, and the entry here said so; that sentence is false in the other direction now and this is its replacement. The measurement site reads `JobResult.speculationMultiplier` and `JobResult.redispatches`, which `submitJob` has carried since 20-07 and 20-01 respectively. **What a reader must not conclude from a `1.00` and a `0.00` is that the mechanisms are off.** A job with no straggler reports a multiplier of exactly `1`, and a job in which no lease lapsed reports zero re-dispatches, so these two rows say *this sweep produced no tail and lost no node* — which is what a healthy in-process fabric running a uniform workload should say, and is a weaker statement than the mechanism having fired. A further bound is structural and worth naming: the budget is `floor(shards × 0.1)` and this driver submits 16 shards, so at most one duplicate is affordable per run. **The reading that a straggler really is duplicated across processes, and that the losing copy is still accounted for, lives in `packages/node/src/speculation-agents.node.test.ts`, not here** — and those two call sites are guarded against reverting to constants from the same file.
  - **The `1.00×` and `0.00` in the tables below were NOT re-measured for this correction, and no figure in this document has moved.** They were produced by the 2026-08-01 run, when the driver wrote them as literals; they are unchanged bytes. A `--quick` run of the corrected driver on 2026-08-04 printed the same pair on every rung of both transports — read directly, exit `0` — which is why replacing this paragraph does not require replacing them. *A reader comparing two dated artifacts must be able to tell a figure that changed from a figure that was replaced*; this entry exists so that neither has happened silently.
- **The reduce figures are subject to the same one-process, one-event-loop construction as the makespan figures.** `combine executors` counts distinct *node identities*, not distinct machines and not even distinct OS processes, so a value above 1 says the rendezvous ranking spread the combines across identities — not that any of them ran anywhere else. The eight-process evidence for the tree walk lives in `packages/node/src/tree-reduce-agents.node.test.ts`, not here.
- **`tree depth` and `combines` are decided by `deriveReduceTree` from a shard count and a fanout this sweep never varies.** A column the run shows constant across every rung of both transports carries no information about a configuration, and a constant is not a result. **`spec. tax` and `churn/task` are no longer the same status and the difference is worth keeping straight:** since 20-09 those two are *measured* and merely happen to be constant on this sweep, whereas these two are *decided* by `deriveReduceTree` from inputs the sweep never varies and could not come out otherwise. The reduce columns expected to carry information are `reduce p50`, `reduce p95`, `recomputes` and `combine executors`; read those. Varying the fanout across the sweep would make the other two informative and was rejected for a stated reason: rungs walking differently-shaped trees have incomparable reduce timings, which is the only thing the reduce table is for.
- **The real-transport reduce refusal that emptied this table on 2026-08-01 has been removed, and the rows below are whatever the run above actually produced.** Recorded rather than deleted, because a reader comparing two dated artifacts must be able to tell a figure that changed from a figure that was replaced. What the previous run published here: every real-transport row an em dash, because `serveAgent`’s combine branch refused outright unless its `authorize` hook was the `serves-unauthenticated` sentinel, and every `FabricNode` supplies a real `authorizeCapability` — so every node in the real-transport rig answered `combine requires a capability chain this build cannot verify`, measured as `combines: 0`, `failed: 5`, `executedBy: 0`, `rootCid: null`. 16-05 routed a combine through `options.authorize` like every other request, so a combine is now admitted or refused by the node’s own authorizer rather than by a branch keyed on whether the node had one. **An em dash in this table therefore no longer means "refused"** — it means that rung produced no reduce at all, and the excluded list below is where its reason is named. The two reduce curves are comparable only across rungs both transports measured.

## Machine inventory

| host | roles | CPU | cores (phys/log) | RAM | OS | runtime |
|---|---|---|---|---|---|---|
| Alexanders-MacBook-Pro.local | worker, requestor, aggregator | Apple M1 Pro | 0/8 | 32.0 GiB | darwin 25.5.0 | node v23.11.0 |

## Makespan — memory transport (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 22.4ms | 29.6ms | 29.6ms | 19 | 0 | 3.883 | 3.883 | 1.00× | 1.00× | 0.00 | 37.8ms |
| 2 | 44.6ms | 51.6ms | 51.6ms | 19 | 0 | 14.493 | 7.246 | 2.00× | 1.00× | 0.00 | 52.7ms |
| 4 | 44.5ms | 52.1ms | 52.1ms | 19 | 0 | 14.640 | 7.320 | 2.00× | 1.00× | 0.00 | 52.3ms |
| 8 | 45.8ms | 57.6ms | 57.6ms | 19 | 0 | 15.064 | 7.532 | 2.00× | 1.00× | 0.00 | 49.7ms |
| 16 | 44.9ms | 51.4ms | 51.4ms | 19 | 0 | 14.646 | 7.323 | 2.00× | 1.00× | 0.00 | 66.6ms |

## Makespan — real transport (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 38.2ms | 99.6ms | 99.6ms | 19 | 0 | 11.473 | 11.473 | 1.00× | 1.00× | 0.00 | 193.6ms |
| 2 | 68.8ms | 79.2ms | 79.2ms | 19 | 0 | 39.571 | 19.785 | 2.00× | 1.00× | 0.00 | 203.1ms |
| 4 | 67.2ms | 94.1ms | 94.1ms | 19 | 0 | 40.653 | 20.327 | 2.00× | 1.00× | 0.00 | 201.3ms |
| 8 | 69.5ms | 122.3ms | 122.3ms | 19 | 0 | 42.939 | 21.470 | 2.00× | 1.00× | 0.00 | 279.5ms |

## Reduce tree — memory transport (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | 0.885ms | 3.0ms | 2 | 5 | 0 | 1 |
| 2 | 1.3ms | 3.2ms | 2 | 5 | 0 | 2 |
| 4 | 1.2ms | 1.9ms | 2 | 5 | 0 | 3 |
| 8 | 1.2ms | 2.1ms | 2 | 5 | 0 | 4 |
| 16 | 1.4ms | 1.9ms | 2 | 5 | 0 | 5 |

## Reduce tree — real transport (SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count)

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | 13.5ms | 24.8ms | 2 | 5 | 0 | 1 |
| 2 | 23.3ms | 40.4ms | 2 | 5 | 0 | 2 |
| 4 | 23.7ms | 34.6ms | 2 | 5 | 0 | 3 |
| 8 | 24.1ms | 27.5ms | 2 | 5 | 0 | 4 |

## Configurations excluded, and why

| configuration | reason |
|---|---|
| real transport, 16 nodes | `connection error 127.0.0.1:54524: connect ECONNRESET 127.0.0.1:54524` — libp2p caps inbound connections at `INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one host, so beyond ~5 concurrent dials to the requestor the noise handshake is killed and the failure reads like a network fault. A same-machine artifact of a documented default, not a property of the fabric. |

## Connectivity tax

| nodes | memory p50 | real p50 | tax |
|---|---|---|---|
| 1 | 22.4ms | 38.2ms | 1.70× |
| 2 | 44.6ms | 68.8ms | 1.54× |
| 4 | 44.5ms | 67.2ms | 1.51× |
| 8 | 45.8ms | 69.5ms | 1.52× |

## COST crossover

Single-threaded baseline: p50 0.0032ms · p95 0.093ms · p99 0.093ms (n=19)

**No crossover.** no crossover within the measured range (1, 2, 4, 8, 16 nodes).

Best distributed p50 was 22.4ms at 1 node, against a baseline p50 of 0.0032ms — a factor of 7086.14×.

## Supplementary — where the time goes

Not part of the pre-registered plan; included because it decomposes the crossover
rather than flattering it.

- Declared run configuration: **16 shards** per job, and **every node in both rigs admits at 64 concurrent tasks** — the memory rig from one `LocalCapacity` per `serveAgent` endpoint, the real rig from `maxConcurrentTasks` on each `FabricNode.start`, both reading one declared constant in this driver rather than inheriting a default. That is load-bearing for the connectivity tax below: until phase 13.1 wired it, the memory rig ran with admission switched off while the real rig admitted, so the two curves were measured against nodes that behaved differently and nothing in the report said so. Shards were raised from 8 by phase 13.1, above the measured 12-shard cliff the per-peer send gate removed, so the two shard counts are not measuring the same workload as an earlier run.

- Single-threaded, native, no fabric: **0.003ms** p50
- Same work through WASM in-process, no fabric: **20.928ms** p50
- Skewed input, 4 nodes, memory transport: **47.3ms** p50 (uniform at 4 nodes: 44.5ms)

Reading the decomposition: the native baseline and the same work through WASM
in-process differ by more than two orders of magnitude, and the distributed run
adds well under one more on top of the WASM figure. Most of the COST gap is
therefore the guest ABI on a workload that does almost no work — not the fabric.
That is a statement about the fixture, and it is why the methodology declared the
fixture bias in advance rather than discovering it here.
