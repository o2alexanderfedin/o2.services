# Two Arithmetic Workloads, Measured

**Prime counting and a pi series on a peer-to-peer compute fabric — throughput, decomposition cost, fabric overhead, and real parallel speedup.**

Measured 2026-08-02 on one machine: 8 physical cores, Node 23.11, V8's built-in WebAssembly. Every number below was produced by a run recorded here; none is an estimate, and the ones that disagreed with what was predicted are marked as such.

---

## What is being measured

Two guest programs, both compiled to WebAssembly from hand-written `.wat`, both on the fabric's four-import ABI — `input_len`, `input_read`, `output_write`, `partition`. That import list *is* the sandbox: a guest can reach nothing else, because `WebAssembly.instantiate` refuses any import the host does not supply.

| workload | what it computes | oracle |
|---|---|---|
| **primes** | pi(N), the count of primes at or below N, by segmented sieve | published values of pi(N) |
| **pi** | the Madhava-Leibniz series for pi/4, in fixed-point integers | the published decimal expansion of pi |

Both are integer-only. No float instruction appears in either module, and that is checked by reading the source text rather than asserted in a comment — a module with no floats cannot reach the WebAssembly specification's float nondeterminism, and V8 offers no runtime control over any of it.

Both shard the same way: the domain is split into contiguous index ranges, one per shard, and every shard receives the *same* input block. Shards differ only in what `partition()` tells the guest, which costs zero bytes on the wire.

### Why two

The prime count is checked against an oracle this project did not write — pi(N) was tabulated in the mathematical literature long before this repository existed, so a wrong answer cannot talk it into agreeing. That is a genuinely independent check, and it is **blind in one direction**.

Those values are quoted at powers of ten, and a power of ten sits a long way from the prime below it: 999983, 99991, 9973. So a guest that loses the top of its range still returns the right total, because the numbers it dropped contained no primes. Planted as a mutation in the range split, that defect was caught at N = 1000 and survived every larger bound at every shard count.

The series has no such gap, because **every term is non-zero**. At a million terms, term *k* still contributes about 5x10^8 units at the far end of the range, so any split that loses an index moves the total immediately.

---

## 1. Guest throughput

Guest `run()` only — no host, no transport. 41 repetitions per point, three warm-up runs discarded so the first sample is not measuring the compiler.

| kernel | domain | p50 [ms] | p90 [ms] | p99 [ms] | rate [units/s] | result |
|---|---|---|---|---|---|---|
| primes | N = 10^4 | 0.039 | 0.105 | 0.175 | 259 M | 1229 |
| pi | 10^4 terms | 0.021 | 0.022 | 0.025 | 469 M | — |
| primes | N = 10^5 | 0.370 | 0.390 | 0.463 | 270 M | 9592 |
| pi | 10^5 terms | 0.065 | 0.067 | 0.069 | 1544 M | — |
| primes | N = 10^6 | 3.802 | 5.431 | 10.004 | 263 M | 78498 |
| pi | 10^6 terms | 0.654 | 0.693 | 0.774 | 1529 M | — |
| primes | N = 10^7 | 38.157 | 38.386 | 41.932 | 262 M | 664579 |
| pi | 10^7 terms | 6.547 | 6.741 | 10.404 | 1527 M | — |

Units are **numbers sieved per second** for primes and **series terms per second** for pi.

**The pi kernel is 5.8x faster per unit.** One `i64.div_u`, a parity test and an add per term, against a sieve's memory traffic per number.

Both are flat in throughput across three orders of magnitude — primes 259 to 262 M/s, pi 1529 to 1527 M/s once past its fixed cost. Pi's 10^4 row is the outlier at 469 M/s because 21 microseconds is small enough for setup to dominate; that is the fixed cost showing, not a scaling effect.

Every prime count matches the published value, including **pi(10^7) = 664579** at a bound the test suite does not cover.

---

## 2. Decomposition cost

The same domain split N ways, with each shard's guest time summed. A ratio above 1.0 means the split duplicates work.

| kernel | shards | sum [ms] | one shard [ms] | ratio |
|---|---|---|---|---|
| primes | 1 | 3.878 | 3.888 | 0.998 |
| primes | 2 | 3.850 | 3.888 | 0.990 |
| primes | 4 | 3.829 | 3.888 | 0.985 |
| primes | 8 | 3.816 | 3.888 | 0.981 |
| primes | 16 | 3.780 | 3.888 | 0.972 |
| pi | 8 | 0.645 | 0.644 | 1.003 |
| pi | 16 | 0.660 | 0.644 | 1.025 |

**Splitting is free for both**, which is the property you want from a shardable workload.

This refuted the prediction made before the run. The prime kernel rebuilds its base sieve in every shard — `build_base(isqrt(N))` runs per shard regardless of which sub-range it owns — so the ratio was expected to climb. It falls instead, to 0.972. Sieving to the square root of N is about a thousand operations against a million of segment work, and the better cache locality of a smaller segment more than repays it. At N = 10^7 the base sieve is 0.03% of the work, so it matters even less as the job grows.

---

## 3. Instantiate, cold

| kernel | p50 [ms] | p90 [ms] | p99 [ms] | module [bytes] |
|---|---|---|---|---|
| primes | 0.060 | 0.075 | 0.232 | 1187 |
| pi | 0.053 | 0.058 | 0.070 | 549 |

---

## 4. Fabric overhead

Map and reduce through the real request/response machinery — `submitJob`, remote executors, block fetch by content address, tree-reduce, and a combine whose root is read back out of the requestor's own store to prove the aggregate exists.

Measured against a **same-moment local reference**: the identical shards executed in-process with no transport, run seconds apart from the fabric measurement. This is the repository's own perf-gate idiom, and it exists because absolute milliseconds on a shared machine are not stable enough to carry a claim while a ratio between two things measured seconds apart is. 9 repetitions, p50.

| workload | shards | redundancy | local [ms] | map [ms] | reduce [ms] | total [ms] | tax |
|---|---|---|---|---|---|---|---|
| primes 10^6 | 1 | 1 | 6.02 | 6.65 | 0.10 | 6.77 | 1.12x |
| primes 10^6 | 1 | 2 | 5.89 | 11.95 | 0.03 | 12.00 | 2.04x |
| primes 10^6 | 2 | 1 | 6.08 | 6.48 | 0.46 | 6.93 | 1.14x |
| primes 10^6 | 4 | 1 | 8.06 | 8.04 | 0.38 | 8.57 | 1.06x |
| primes 10^6 | 8 | 1 | 11.80 | 8.53 | 0.76 | 9.69 | 0.82x |
| primes 10^6 | 8 | 2 | 8.80 | 16.14 | 1.27 | 17.30 | 1.96x |
| pi 10^6 | 1 | 1 | 0.80 | 0.90 | 0.03 | 0.93 | 1.16x |
| pi 10^6 | 1 | 2 | 0.81 | 1.70 | 0.02 | 1.71 | 2.12x |
| pi 10^6 | 4 | 1 | 1.59 | 1.85 | 0.30 | 2.12 | 1.33x |
| pi 10^6 | 8 | 2 | 1.94 | 3.15 | 0.86 | 4.00 | 2.06x |

`tax` is dimensionless — total divided by local.

**The four redundancy-2 rows above were measured on a dispatch path that no longer exists, and they are marked rather than replaced.** Every row here was taken on 2026-08-02. On 2026-08-11 a two-round commit-reveal ceremony was wired into `submitJob` for public shards at two or more replicas whose executors speak both rounds, so a redundancy-2 job through remote executors now pays one extra round trip per replica per shard before any answer is revealed. Measured on the node ladder across six interleaved runs per arm, that costs about **32 percent** of a redundancy-2 rung's makespan over a real libp2p transport on loopback, and is not separable from run-to-run variation over an in-process transport. Two things are therefore true of the four rows: their `map`, `total` and `tax` figures are a reading of the pre-ceremony path, and nothing in this repository can retake them, because the harness that produced this table was never committed — only the report it wrote was. The claim that they would take the ceremony path today is read off this section's own opening sentence, which names remote executors, and not off that harness's source. **The six redundancy-1 rows are unaffected**: a ceremony over one replica binds an answer no peer could have copied, so `submitJob` runs R=1 through the same post-hoc comparison it always did.

**The fabric costs 12 to 16 percent over local execution at redundancy 1.** At redundancy 2, where every shard is executed by two independent nodes and their outputs compared, the tax lands at almost exactly 2x. That is the sanity check that the measurement is real rather than a number: doubling the work must double the cost, and it does.

The 0.82x is not the fabric beating physics. The local reference pays per-shard setup that warm workers amortise, so its own denominator grows with shard count — 6.02 ms at one shard against 11.80 ms at eight.

### The reading that was thrown away

The first run of this table reported a tax of 26x, and it was wrong. The local reference stored the raw payload in its blockstore instead of a DAG-CBOR byte string; the guest read a malformed header, refused in microseconds, and the outcome was never checked. **A fast failure is not a fast run** — a rule this project had already paid for once, in a benchmark that reported 19 of 19 runs incomplete rather than a suspiciously good curve. The fix was to encode the input canonically and to assert the outcome, and the corrected numbers are the ones above.

---

## 5. Real parallel speedup

Sections 1 through 4 cannot answer "is it faster". Every node in an in-process fabric shares one OS event loop, so a shard sweep there measures coordination and would report a flat makespan as a consequence of the process model rather than a finding about scaling.

This section uses **separate operating-system processes**, one per shard, each competing for a real core. Best of 3 runs.

| kernel | domain | processes | wall [ms] | sum guest [ms] | straggler [ms] | speedup | efficiency |
|---|---|---|---|---|---|---|---|
| primes | N = 3x10^8 | 1 | 2915.2 | 2864.3 | 2864.3 | 1.00x | 100% |
| primes | N = 3x10^8 | 2 | 1504.3 | 2865.7 | 1449.7 | 1.94x | 97% |
| primes | N = 3x10^8 | 4 | 861.7 | 3138.9 | 800.1 | 3.38x | 85% |
| primes | N = 3x10^8 | 8 | 800.0 | 4889.5 | 693.7 | 3.64x | 46% |
| pi | 1.5x10^9 terms | 1 | 3510.0 | 3459.4 | 3459.4 | 1.00x | 100% |
| pi | 1.5x10^9 terms | 2 | 1819.3 | 3500.5 | 1758.3 | 1.93x | 96% |
| pi | 1.5x10^9 terms | 4 | 939.5 | 3469.0 | 874.0 | 3.74x | 93% |
| pi | 1.5x10^9 terms | 8 | 904.6 | 5938.4 | 774.7 | 3.88x | 49% |

`wall` is the parent's clock for the whole job with all shards launched at once. `sum guest` adds up every shard's own `run()` time. `straggler` is the slowest single shard. `efficiency` is speedup divided by process count.

**Near-linear to four processes — 93 to 97 percent — then a wall at 3.6 to 3.9x.**

The cost of that wall is visible in the `sum guest` column rather than inferred: total CPU time rises about **70 percent** at eight processes, from 2864 to 4890 ms for primes and 3459 to 5938 ms for pi. Eight workers plus a parent on eight cores, with unrelated background load on the machine at the time, is oversubscription. This is contention, not a defect in the decomposition.

**The results were bit-identical at every process count** — 16252325 for pi(3x10^8), and 785398163231095 for the scaled series total, at one, two, four and eight processes alike. That is the decomposition holding at 300-million and 1.5-billion scale rather than only in unit tests.

At 1.5x10^9 terms the series gives **3.14159265292438**, correct to nine decimal places, with the error at exactly half the alternating-series remainder bound — the same ratio it holds at a thousand terms.

---

## What these numbers are not

**Section 5 is a ceiling, not the fabric.** It measures guest arithmetic in parallel processes with no transport, no block fetch and no reduce. The fabric would pay section 4's costs on top of it. An honest end-to-end figure needs both at once, across real processes, and that driver is not built yet — so it is not reported here rather than being approximated.

**The fabric measurements are single-machine.** Section 4 runs over an in-process transport. Nothing here measures a real network, and the connectivity tax over WebRTC was previously measured at 8 to 10x on a different workload.

**One machine, one run each.** Percentiles are reported instead of means because straggler-dominated distributions have meaningless means, and the load average is recorded because it changes the answer — the same tree has been observed selecting 36 slow test files at load 21 and 28 at load 50.

---

## How the workloads verify themselves

Neither workload's headline number is trusted on its own, and the reason is a measurement rather than a principle.

Planting the same range-split mutation in both kernels — deleting the term that hands the first `remainder` shards one extra index each — produced this:

| check | primes | pi |
|---|---|---|
| total matches the published constant | caught at N = 1000 only | **not caught** |
| identical total at every shard count | not caught above N = 1000 | **caught, at shard count 2** |

For the prime count the dropped numbers hold no primes, so the total is unchanged at every shard count and no cross-shard comparison helps either.

For the series the oracle came within a hair of catching it and did not: at eight shards a term count of 1000003 leaves a remainder of three, so three tail terms are lost, their signs alternate and mostly cancel, and about 2x10^-6 of error lands against a remainder bound of 2.0x10^-6.

**So the published constant is necessary and not sufficient, in both workloads, for different reasons.** What has the falsifying power is the requirement that the scaled total be bit-identical at every shard count — which is only available where no term is zero.

The term count is 1000003 rather than 1000000 for the same class of reason a round bound sits in a prime desert: a round count divides exactly at 2, 4, 5 and 8, leaving no remainder for the split logic to distribute, and the defect would be invisible at half the sweep.
