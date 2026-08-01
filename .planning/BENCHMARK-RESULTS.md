# o2.services — benchmark run

**SAME-MACHINE: 16 processes on 1 host — not 16 nodes**

Run at 2026-08-01T05:38:05.751Z. Methodology pre-registered in
[`BENCHMARK-METHODOLOGY.md`](./BENCHMARK-METHODOLOGY.md), committed before
this harness existed.

## What these numbers do NOT establish

- **No parallel speedup is measurable here, by construction.** Every node in both curves runs inside one OS process on one JavaScript event loop — the memory transport is in-process by definition, and the real transport creates its libp2p nodes in the same process and dials them over loopback. So these curves measure **coordination cost**, not parallelism, and the flat makespan across the node ladder is the expected consequence rather than a finding about scaling. Demonstrating speedup needs separate processes or machines and is not done here.
- **BENCH-06 (distinct machines) is NOT met.** One machine was available, so every number here is same-machine. Processes on one host share a CPU, a memory bus and a scheduler; this measures software scaling with contention included and the network excluded, and it is not a measurement of N nodes.
- No hosted relay exists yet, so no WAN browser-tier number is included. The real transport here is libp2p over TCP on loopback.
- The WASM fixture does almost no work, so per-task overhead dominates and the COST crossover is worse than it would be for a realistic workload. Declared in the methodology before these runs, not discovered afterwards.
- The 1-node rung necessarily runs at redundancy 1: verification needs two independent executors, and one node cannot supply them. Its verification tax of 1.0 is therefore a property of the system, not a cheaper configuration — the same reason a sovereign shard with one owner node is owner-attested.
- Speculation and churn taxes are 1.0 and 0 because `submitJob` neither speculates nor re-dispatches and no node was killed during these runs. They are identities, not measurements.
- **The reduce figures are subject to the same one-process, one-event-loop construction as the makespan figures.** `combine executors` counts distinct *node identities*, not distinct machines and not even distinct OS processes, so a value above 1 says the rendezvous ranking spread the combines across identities — not that any of them ran anywhere else. The eight-process evidence for the tree walk lives in `packages/node/src/tree-reduce-agents.node.test.ts`, not here.
- **`tree depth` and `combines` are decided by `deriveReduceTree` from a shard count and a fanout this sweep never varies.** A column the run shows constant across every rung of both transports carries no information about a configuration, and a constant is not a result — the same status `spec. tax` and `churn/task` carry above. The reduce columns expected to carry information are `reduce p50`, `reduce p95`, `recomputes` and `combine executors`; read those. Varying the fanout across the sweep would make the other two informative and was rejected for a stated reason: rungs walking differently-shaped trees have incomparable reduce timings, which is the only thing the reduce table is for.
- **The real-transport reduce is NOT measured, and its every row is an em dash for one named reason rather than for a missing feature.** `serveAgent`’s combine branch refuses outright unless its `authorize` hook is the `serves-unauthenticated` sentinel — a deliberate fail-closed gap, since an `Authorizer` takes a `Task` and a combine has none, so a node that authenticates everything else cannot be asked about a combine. Every `FabricNode` supplies a real `authorizeCapability`, so every node in the real-transport rig answers `combine requires a capability chain this build cannot verify`. Measured on this run, not inferred: every combine at level 1 failed, `combines: 0`, `failed: 5`, `executedBy: 0`, `rootCid: null`. The memory-transport rig passes the sentinel and is measured normally, so the two reduce curves are **not** comparable and no connectivity tax is computed over them. Closing it is **AUTH-03, Phase 15** — whatever capability shape `exec` gets, `combine` reuses it. Nothing here was weakened to produce a populated row; an em dash is the honest rendering of a refusal.

## Machine inventory

| host | roles | CPU | cores (phys/log) | RAM | OS | runtime |
|---|---|---|---|---|---|---|
| Alexanders-MacBook-Pro.local | worker, requestor, aggregator | Apple M1 Pro | 0/8 | 32.0 GiB | darwin 25.5.0 | node v23.11.0 |

## Makespan — memory transport (SAME-MACHINE: 16 processes on 1 host — not 16 nodes)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 23.4ms | 33.1ms | 33.1ms | 19 | 0 | 3.989 | 3.989 | 1.00× | 1.00× | 0.00 | 37.5ms |
| 2 | 45.2ms | 59.5ms | 59.5ms | 19 | 0 | 14.849 | 7.424 | 2.00× | 1.00× | 0.00 | 53.9ms |
| 4 | 45.3ms | 55.9ms | 55.9ms | 19 | 0 | 14.909 | 7.454 | 2.00× | 1.00× | 0.00 | 51.0ms |
| 8 | 45.6ms | 58.2ms | 58.2ms | 19 | 0 | 15.228 | 7.614 | 2.00× | 1.00× | 0.00 | 47.5ms |
| 16 | 44.9ms | 66.2ms | 66.2ms | 19 | 0 | 15.026 | 7.513 | 2.00× | 1.00× | 0.00 | 46.6ms |

## Makespan — real transport (SAME-MACHINE: 16 processes on 1 host — not 16 nodes)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 39.7ms | 51.1ms | 51.1ms | 19 | 0 | 11.074 | 11.074 | 1.00× | 1.00× | 0.00 | 201.3ms |
| 2 | 71.5ms | 93.4ms | 93.4ms | 19 | 0 | 41.430 | 20.715 | 2.00× | 1.00× | 0.00 | 210.1ms |
| 4 | 70.8ms | 83.5ms | 83.5ms | 19 | 0 | 41.540 | 20.770 | 2.00× | 1.00× | 0.00 | 216.6ms |
| 8 | 75.8ms | 97.5ms | 97.5ms | 19 | 0 | 44.957 | 22.479 | 2.00× | 1.00× | 0.00 | 280.5ms |

## Reduce tree — memory transport (SAME-MACHINE: 16 processes on 1 host — not 16 nodes)

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | 0.984ms | 4.6ms | 2 | 5 | 0 | 1 |
| 2 | 1.3ms | 3.2ms | 2 | 5 | 0 | 2 |
| 4 | 1.3ms | 2.0ms | 2 | 5 | 0 | 3 |
| 8 | 1.3ms | 2.0ms | 2 | 5 | 0 | 4 |
| 16 | 1.4ms | 1.9ms | 2 | 5 | 0 | 5 |

## Reduce tree — real transport (SAME-MACHINE: 16 processes on 1 host — not 16 nodes)

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — |
| 4 | — | — | — | — | — | — |
| 8 | — | — | — | — | — | — |

## Configurations excluded, and why

| configuration | reason |
|---|---|
| real transport, 16 nodes | `read ECONNRESET` — libp2p caps inbound connections at `INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one host, so beyond ~5 concurrent dials to the requestor the noise handshake is killed and the failure reads like a network fault. A same-machine artifact of a documented default, not a property of the fabric. |

## Connectivity tax

| nodes | memory p50 | real p50 | tax |
|---|---|---|---|
| 1 | 23.4ms | 39.7ms | 1.70× |
| 2 | 45.2ms | 71.5ms | 1.58× |
| 4 | 45.3ms | 70.8ms | 1.56× |
| 8 | 45.6ms | 75.8ms | 1.66× |

## COST crossover

Single-threaded baseline: p50 0.0040ms · p95 0.015ms · p99 0.015ms (n=19)

**No crossover.** no crossover within the measured range (1, 2, 4, 8, 16 nodes).

Best distributed p50 was 23.4ms at 1 node, against a baseline p50 of 0.0040ms — a factor of 5912.06×.

## Supplementary — where the time goes

Not part of the pre-registered plan; included because it decomposes the crossover
rather than flattering it.

- Declared run configuration: **16 shards** per job, and **every node in both rigs admits at 64 concurrent tasks** — the memory rig from one `LocalCapacity` per `serveAgent` endpoint, the real rig from `maxConcurrentTasks` on each `FabricNode.start`, both reading one declared constant in this driver rather than inheriting a default. That is load-bearing for the connectivity tax below: until phase 13.1 wired it, the memory rig ran with admission switched off while the real rig admitted, so the two curves were measured against nodes that behaved differently and nothing in the report said so. Shards were raised from 8 by phase 13.1, above the measured 12-shard cliff the per-peer send gate removed, so the two shard counts are not measuring the same workload as an earlier run.

- Single-threaded, native, no fabric: **0.004ms** p50
- Same work through WASM in-process, no fabric: **22.487ms** p50
- Skewed input, 4 nodes, memory transport: **44.8ms** p50 (uniform at 4 nodes: 45.3ms)

Reading the decomposition: the native baseline and the same work through WASM
in-process differ by more than two orders of magnitude, and the distributed run
adds well under one more on top of the WASM figure. Most of the COST gap is
therefore the guest ABI on a workload that does almost no work — not the fabric.
That is a statement about the fixture, and it is why the methodology declared the
fixture bias in advance rather than discovering it here.
