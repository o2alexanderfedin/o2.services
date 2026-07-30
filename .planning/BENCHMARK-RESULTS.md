# o2.services — benchmark run

**SAME-MACHINE: 4 processes on 1 host — not 4 nodes**

Run at 2026-07-29T23:28:11.179Z. Methodology pre-registered in
[`BENCHMARK-METHODOLOGY.md`](./BENCHMARK-METHODOLOGY.md), committed before
this harness existed.

## What these numbers do NOT establish

- **No parallel speedup is measurable here, by construction.** Every node in both curves runs inside one OS process on one JavaScript event loop — the memory transport is in-process by definition, and the real transport creates its libp2p nodes in the same process and dials them over loopback. So these curves measure **coordination cost**, not parallelism, and the flat makespan across the node ladder is the expected consequence rather than a finding about scaling. Demonstrating speedup needs separate processes or machines and is not done here.
- **BENCH-06 (distinct machines) is NOT met.** One machine was available, so every number here is same-machine. Processes on one host share a CPU, a memory bus and a scheduler; this measures software scaling with contention included and the network excluded, and it is not a measurement of N nodes.
- No hosted relay exists yet, so no WAN browser-tier number is included. The real transport here is libp2p over TCP on loopback.
- The WASM fixture does almost no work, so per-task overhead dominates and the COST crossover is worse than it would be for a realistic workload. Declared in the methodology before these runs, not discovered afterwards.
- The 1-node rung necessarily runs at redundancy 1: verification needs two independent executors, and one node cannot supply them. Its verification tax of 1.0 is therefore a property of the system, not a cheaper configuration — the same reason a sovereign shard with one owner node is owner-attested.
- Speculation and churn taxes are 1.0 and 0 because `submitJob` neither speculates nor re-dispatches and no node was killed during these runs. They are identities, not measurements.
- **The two curves were NOT measured under the same node behaviour, so the connectivity tax below is a ratio taken across that difference as well as across the transport.** The real-transport rig went through `FabricNode.start` and admitted at `maxConcurrentTasks: 64`; every `serveAgent` call in the memory-transport rig was handed the `capacity` opt-out and ran with admission switched off entirely. Fixed in `packages/node/src/bin/bench.ts` on 2026-07-29 — both rigs now take the same declared limit from one constant, and a quick run under it reported `incomplete: 0` on every rung of both ladders — but **the numbers on this page predate that fix and were deliberately not regenerated**, so the caveat applies to every figure here. This bullet was added by hand after the run; the next full run rewrites this file and drops it, because the condition it describes will no longer hold.

## Machine inventory

| host | roles | CPU | cores (phys/log) | RAM | OS | runtime |
|---|---|---|---|---|---|---|
| Alexanders-MacBook-Pro.local | worker, requestor | Apple M1 Pro | 0/8 | 32.0 GiB | darwin 25.5.0 | node v23.11.0 |

## Makespan — memory transport (SAME-MACHINE: 4 processes on 1 host — not 4 nodes)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4.0ms | 7.1ms | 7.1ms | 5 | 0 | 0.219 | 0.219 | 1.00× | 1.00× | 0.00 | 12.3ms |
| 2 | 5.6ms | 8.8ms | 8.8ms | 5 | 0 | 0.615 | 0.308 | 2.00× | 1.00× | 0.00 | 14.5ms |
| 4 | 4.0ms | 4.9ms | 4.9ms | 5 | 0 | 0.349 | 0.175 | 2.00× | 1.00× | 0.00 | 7.9ms |

## Makespan — real transport (SAME-MACHINE: 4 processes on 1 host — not 4 nodes)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 27.5ms | 34.0ms | 34.0ms | 5 | 0 | 1.807 | 1.807 | 1.00× | 1.00× | 0.00 | 82.9ms |
| 2 | 40.7ms | 53.5ms | 53.5ms | 5 | 0 | 6.064 | 3.032 | 2.00× | 1.00× | 0.00 | 103.0ms |

## Connectivity tax

| nodes | memory p50 | real p50 | tax |
|---|---|---|---|
| 1 | 4.0ms | 27.5ms | 6.83× |
| 2 | 5.6ms | 40.7ms | 7.34× |

## COST crossover

Single-threaded baseline: p50 0.0040ms · p95 0.015ms · p99 0.015ms (n=5) — n < 10, tail percentiles unreliable

**No crossover.** no crossover within the measured range (1, 2, 4 nodes).

Best distributed p50 was 4.0ms at 4 nodes, against a baseline p50 of 0.0040ms — a factor of 991.59×.

## Supplementary — where the time goes

Not part of the pre-registered plan; included because it decomposes the crossover
rather than flattering it.

- Declared run configuration, **as this run actually ran**: **16 shards** per job; every node in the real-transport rig started with **maxConcurrentTasks: 64**; every node in the memory-transport rig ran with **admission switched off**. Both were stated by the driver rather than inherited from a default, and they are still two different node configurations — see the last bullet of "What these numbers do NOT establish". Shards were raised from 8 by phase 13.1, above the measured 12-shard cliff the per-peer send gate removed, so the two shard counts are not measuring the same workload as an earlier run.

- Single-threaded, native, no fabric: **0.004ms** p50
- Same work through WASM in-process, no fabric: **1.450ms** p50
- Skewed input, 4 nodes, memory transport: **7.5ms** p50 (uniform at 4 nodes: 4.0ms)

Reading the decomposition: the native baseline and the same work through WASM
in-process differ by more than two orders of magnitude, and the distributed run
adds well under one more on top of the WASM figure. Most of the COST gap is
therefore the guest ABI on a workload that does almost no work — not the fabric.
That is a statement about the fixture, and it is why the methodology declared the
fixture bias in advance rather than discovering it here.
