# o2.services — benchmark run

**SAME-MACHINE: 16 processes on 1 host — not 16 nodes**

Run at 2026-07-27T02:09:08.103Z. Methodology pre-registered in
[`BENCHMARK-METHODOLOGY.md`](./BENCHMARK-METHODOLOGY.md), committed before
this harness existed.

## What these numbers do NOT establish

- **No parallel speedup is measurable here, by construction.** Every node in both curves runs inside one OS process on one JavaScript event loop — the memory transport is in-process by definition, and the real transport creates its libp2p nodes in the same process and dials them over loopback. So these curves measure **coordination cost**, not parallelism, and the flat makespan across the node ladder is the expected consequence rather than a finding about scaling. Demonstrating speedup needs separate processes or machines and is not done here.
- **BENCH-06 (distinct machines) is NOT met.** One machine was available, so every number here is same-machine. Processes on one host share a CPU, a memory bus and a scheduler; this measures software scaling with contention included and the network excluded, and it is not a measurement of N nodes.
- No hosted relay exists yet, so no WAN browser-tier number is included. The real transport here is libp2p over TCP on loopback.
- The WASM fixture does almost no work, so per-task overhead dominates and the COST crossover is worse than it would be for a realistic workload. Declared in the methodology before these runs, not discovered afterwards.
- The 1-node rung necessarily runs at redundancy 1: verification needs two independent executors, and one node cannot supply them. Its verification tax of 1.0 is therefore a property of the system, not a cheaper configuration — the same reason a sovereign shard with one owner node is owner-attested.
- Speculation and churn taxes are 1.0 and 0 because `submitJob` neither speculates nor re-dispatches and no node was killed during these runs. They are identities, not measurements.

## Machine inventory

| host | roles | CPU | cores (phys/log) | RAM | OS | runtime |
|---|---|---|---|---|---|---|
| Alexanders-MacBook-Pro.local | worker, requestor | Apple M1 Pro | 0/8 | 32.0 GiB | darwin 25.5.0 | node v23.11.0 |

## Makespan — memory transport (SAME-MACHINE: 16 processes on 1 host — not 16 nodes)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1.3ms | 3.8ms | 3.8ms | 19 | 0 | 0.133 | 0.133 | 1.00× | 1.00× | 0.00 | 8.2ms |
| 2 | 2.1ms | 5.0ms | 5.0ms | 19 | 0 | 0.376 | 0.188 | 2.00× | 1.00× | 0.00 | 2.4ms |
| 4 | 1.6ms | 3.1ms | 3.1ms | 19 | 0 | 0.314 | 0.157 | 2.00× | 1.00× | 0.00 | 2.6ms |
| 8 | 1.4ms | 4.3ms | 4.3ms | 19 | 0 | 0.305 | 0.152 | 2.00× | 1.00× | 0.00 | 1.9ms |
| 16 | 1.6ms | 4.0ms | 4.0ms | 19 | 0 | 0.354 | 0.177 | 2.00× | 1.00× | 0.00 | 2.0ms |

## Makespan — real transport (SAME-MACHINE: 16 processes on 1 host — not 16 nodes)

| nodes | p50 | p95 | p99 | n | incomplete | gross n·s | useful n·s | verif. tax | spec. tax | churn/task | cold start |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 10.3ms | 21.6ms | 21.6ms | 19 | 0 | 1.324 | 1.324 | 1.00× | 1.00× | 0.00 | 48.8ms |
| 2 | 15.4ms | 22.4ms | 22.4ms | 19 | 0 | 4.027 | 2.014 | 2.00× | 1.00× | 0.00 | 43.8ms |
| 4 | 15.8ms | 19.4ms | 19.4ms | 19 | 0 | 4.020 | 2.010 | 2.00× | 1.00× | 0.00 | 42.5ms |

## Configurations excluded, and why

| configuration | reason |
|---|---|
| real transport, 8 nodes | `read ECONNRESET` — libp2p caps inbound connections at `INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one host, so beyond ~5 concurrent dials to the requestor the noise handshake is killed and the failure reads like a network fault. A same-machine artifact of a documented default, not a property of the fabric. |
| real transport, 16 nodes | `read ECONNRESET` — libp2p caps inbound connections at `INBOUND_CONNECTION_THRESHOLD = 5` **per host**, and every node here shares one host, so beyond ~5 concurrent dials to the requestor the noise handshake is killed and the failure reads like a network fault. A same-machine artifact of a documented default, not a property of the fabric. |

## Connectivity tax

| nodes | memory p50 | real p50 | tax |
|---|---|---|---|
| 1 | 1.3ms | 10.3ms | 8.12× |
| 2 | 2.1ms | 15.4ms | 7.46× |
| 4 | 1.6ms | 15.8ms | 9.67× |

## COST crossover

Single-threaded baseline: p50 0.0022ms · p95 0.022ms · p99 0.022ms (n=19)

**No crossover.** no crossover within the measured range (1, 2, 4, 8, 16 nodes).

Best distributed p50 was 1.3ms at 1 node, against a baseline p50 of 0.0022ms — a factor of 573.16×.

## Supplementary — where the time goes

Not part of the pre-registered plan; included because it decomposes the crossover
rather than flattering it.

- Single-threaded, native, no fabric: **0.002ms** p50
- Same work through WASM in-process, no fabric: **0.609ms** p50
- Skewed input, 4 nodes, memory transport: **1.6ms** p50 (uniform at 4 nodes: 1.6ms)

Reading the decomposition: the native baseline and the same work through WASM
in-process differ by more than two orders of magnitude, and the distributed run
adds well under one more on top of the WASM figure. Most of the COST gap is
therefore the guest ABI on a workload that does almost no work — not the fabric.
That is a statement about the fixture, and it is why the methodology declared the
fixture bias in advance rather than discovering it here.
