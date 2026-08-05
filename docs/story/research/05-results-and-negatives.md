# o2.services — measurements, benchmarks, and negative results

Mined read-only from `/Volumes/ProjectsSSD/Projects/o2.services` on 2026-08-01 (branch
`feature/bug-fixes-22`). Every number below is quoted from the file named beside it.
Verbatim passages are in blockquotes or marked *(verbatim)*.

---

## 0. Project status figures (README.md:130-142)

- **Milestone v1.1 ("Wire What Was Built") is in progress at 5 of 14 phases verified.**
- *(verbatim)* "v1.0 left 36 capabilities **built but unreachable** — real code, with its
  own tests, that no runnable program ever called. That count is now **22**, with 11 more
  partly wired. Reducing it is what this milestone measures."
- **Requirements ledger: 40 closed, 42 open.**
- *(verbatim)* "A phase closes when an independent pass says so, scored against its own
  success criteria — not when its plans finish. Two phases sit at 'nearly done' and are
  deliberately **not** counted, because one criterion each is only half-proven."
- Eight workspace packages: `@o2/core`, `@o2/net`, `@o2/libp2p`, `@o2/node`, `@o2/browser`,
  `@o2/aot`, `@o2/bench`, `@o2/demo`.
- `.planning/STATE.md` frontmatter (2026-08-01T18:05Z): `total_phases: 14`,
  `completed_phases: 5`, `total_plans: 54`, `completed_plans: 39`, `percent: 36`.
  Phase 13.1 verified 2026-07-31 at **6/7** and stays uncounted; Phase 16 at **3/4**;
  Phase 17 at **1/3**.

---

## 1. What has been demonstrated — verbatim (README.md:144-173)

> ### What is demonstrated
>
> - A redundant, verified map job running in one Node process, in a browser, and in a Worker.
> - The same job across two OS processes over real TCP + Noise + yamux, with the kernel unchanged.
> - Two browser tabs completing a 2×-redundant job over a **direct** WebRTC connection, with the relay proven out of the data path.
> - An iPhone running Safari and a laptop running Chromium completing the same job over direct WebRTC.
> - IndexedDB and filesystem blockstores producing identical CIDs.
> - 16 browser peers holding relay reservations simultaneously.
> - A real elfconv-translated artifact executing against the WASI executor, ABI verified: 23 WASI imports, `_start` and `memory`, every import answered.
> - Sovereign data pinned to its owner: a job whose input never leaves the owning node, with an egress manifest recording what crossed the wire.
> - **Code that runs only if a trusted key vouched for it.** Modules resolve through a signed name→CID mapping; an unsigned or wrongly-signed one is refused *before the bytes are fetched*, shown by finding the node's block directory empty after a refusal — read from a separate process, not inferred.
> - **Tasks that carry their own permission.** A dispatched task presents a chain of delegation rooted in the data owner's key, and the receiving node verifies it before instantiating anything.
> - **Results merged up a derived tree** across eight and nine spawned processes, matching a single-machine reference byte-for-byte.
> - **Nodes with cryptographic identities of their own**, enrolled with a provider and verifiable by other nodes **offline** — proven with the authority process shut down and asserted dead, so nobody could have been consulted.
> - **Browser tabs enrolled on identical terms**, including on a plain-HTTP LAN origin where WebCrypto is unavailable.

Counts extracted: **1** Node process / **2** OS processes / **2** browser tabs / **1**
iPhone + **1** laptop / **16** browser peers on one relay / **23** WASI imports /
**8 and 9** spawned processes for the tree reduce.

The 16-peer number is specific (`packages/node/src/many-tabs.e2e.test.ts:10-27`):
> "Sixteen is the specific number that fails without tuning: libp2p's default is fifteen
> (`DEFAULT_MAX_RESERVATION_STORE_SIZE`), so this measures whether the relay's capacity is
> genuinely configurable rather than nominally so." … "Scope, stated plainly: the criterion
> also asks for peers to *hold* for over an hour under churn, and for relayed byte counters
> per peer. Neither is here — an hour-long test does not belong in this suite, and
> js-libp2p exposes no per-peer relayed byte counter to assert on."

Relay/live-page caveat (README.md:13-21):
> "That page is a real node, but it cannot join anything on its own and it says so. A
> browser cannot accept incoming connections, so two tabs need a publicly reachable Circuit
> Relay v2 peer to exchange WebRTC signalling, and GitHub Pages runs no server process."
> … "The deployed bundle predates Phase 9 — the consent gate, the running bar and the
> colouring job are in this repository but not on that URL."

---

## 2. What is explicitly NOT demonstrated — verbatim (README.md:175-205)

> ### What is explicitly *not* demonstrated
>
> The project distinguishes **descoped** from **satisfied**, and **unmeasured** from **met**. These are recorded as unmet:
>
> - **Peers on genuinely different machines over the public internet.** Needs a hosted relay with automatic TLS.
> - **Cross-machine reproducibility (AOT-03) and distinct-machine benchmarking (BENCH-06).** Descoped to same-machine testing by owner decision; closing either would need hardware the project does not have. A `CROSS_MACHINE_BLIND_SPOT` marker stays attached to every lifted artifact.
> - **V8 WASM code caching.** Measured and *not* observed: at 4.8 MB, `application/wasm`, query-free CID URL, `compileStreaming`, across three visits — no code-cache entry, while the same profile grew a 2 MB JavaScript cache. Reported unmet rather than reworded.
> - **Parallel speedup at scale.** Every published benchmark curve currently runs N nodes on one event loop, so no parallel speedup is measurable at any N. A multi-process driver is planned.
> - **A cost on creating fake identities.** Enrollment is rate-limited and the threshold is stated in the refusal — but the limit is keyed on a user key, which costs one key generation, and the budget is per provider *process*. So the hundredth fake identity costs what the first did. Rate-limiting is measured; cost is not, and the difference is recorded rather than blurred.
> - **Peer-to-peer acceptance across separate processes.** A node rejecting a forged certificate is proven across processes; a node *accepting* a valid one is not, because no command-line flag yet makes one spawned agent dial another. Scheduled, not assumed.
> - **Distribution of large artifacts.** A lifted native program is 5.40 MiB and nothing has yet moved one between machines that did not already have it — the demo embeds its module in the bundle. Content addressing says whether the bytes are right, never whether anyone still holds them.

### 2a. The V8 code-cache negative, in full apparatus

`packages/node/src/code-cache.e2e.test.ts:15-105` (module comment). Key passages:

> "AOT-05, criterion 4 — does a second visit hit V8's code cache? The criterion asks for a
> *measurement*, and a measurement can come back negative. This one does."

Two independent observations, **neither a timing**: the profile's `Default/Code Cache/wasm`
directory, and Chromium trace events `v8.wasm.moduleCacheHit`, `v8.wasm.cachedModule`,
`v8.wasm.moduleCacheInvalid`, `v8.wasm.moduleCacheInvalidDigest` — present as string
literals in the driven Chromium binary, "so their absence from a trace is evidence rather
than a guess about naming."

**The result table (verbatim):**

| module size | visits | `Code Cache/wasm` |
|---|---|---|
| 220 KB | 2 | 72 B (index only) |
| 1.1 MB | 2 | 72 B |
| 4.8 MB | 3 | 72 B |
| 10.8 MB | 3, incl. browser restart, headed and headless | 72 B |

> "all with `Content-Type: application/wasm`, `Cache-Control: public, max-age=…`, a
> query-free same-origin URL, `compileStreaming`, and the module executed millions of times
> first so that `wasm.TopTierCompilation` appears in the trace — because blink serialises
> top-tier code, and a module that is never called never tiers up."

**Positive control**, from `phase-10-elfconv-aot/SUMMARY.md:120-126`:

| visit | Code Cache/wasm | Code Cache/js |
|---|---|---|
| 1 | 72 B | 8,545 B |
| 2 | 72 B | 2,078,297 B |
| 3 | 72 B | 2,078,297 B |

**Negative control:** relaunched with `--v8-cache-options=none`, `Code Cache/js` reads
**72 bytes** — "exactly what `Code Cache/wasm` reads on every ordinary run. So 72 bytes is
the measured signature of 'no code cache was written', produced on purpose on the side that
normally works, and it is the number the WASM side returns every time. The negative below
is therefore a reading, not an absence of one."

The test's assertion floors the JS side at 500,000 rather than pinning 2,078,297, "because
the figure is dominated by whatever modules Vite happens to serve."

Self-limitation (verbatim):
> "It does not say Chrome never caches WebAssembly. It says this harness never saw it —
> automation-driven Chromium, a fresh temporary profile, a loopback origin. Any of those
> could be the reason, and none of them was isolated."

A superseded claim, corrected inside the same comment: an earlier control was a 600 KB
module with long cache headers; re-serving it with `Cache-Control: no-store` "was then
expected to collapse the number and did not — the figure is dominated by the modules Vite
serves, and **the claim that the header mattered was wrong**."

`ROADMAP.md:707` records the trap for future planners: "**Do not justify a gateway with V8
code caching.**"

### 2b. No parallel speedup — by construction

`.planning/BENCHMARK-RESULTS.md:11` (verbatim):
> "**No parallel speedup is measurable here, by construction.** Every node in both curves
> runs inside one OS process on one JavaScript event loop — the memory transport is
> in-process by definition, and the real transport creates its libp2p nodes in the same
> process and dials them over loopback. So these curves measure **coordination cost**, not
> parallelism, and the flat makespan across the node ladder is the expected consequence
> rather than a finding about scaling. Demonstrating speedup needs separate processes or
> machines and is not done here."

`.planning/BENCHMARK-RESULTS.md:12`:
> "**BENCH-06 (distinct machines) is NOT met.** One machine was available… Processes on one
> host share a CPU, a memory bus and a scheduler; this measures software scaling with
> contention included and the network excluded, and it is not a measurement of N nodes."

`STATE.md:305-308` (Phase 8): "The scaling claim is therefore **unmeasured** — which is
neither disproved nor supported."

Two taxes are declared to be **identities, not measurements** (BENCHMARK-RESULTS.md:16):
speculation tax 1.0 and churn 0, "because `submitJob` neither speculates nor re-dispatches
and no node was killed during these runs." Likewise the 1-node verification tax of 1.0 "is
a property of the system, not a cheaper configuration."

### 2c. No cost on fake identities

`STATE.md:106-110`: "**Phase 19 criterion 5** — enrolling must cost something an attacker
cannot mint free. AUTH-04's rate limit is fully proven; what it does not buy is the cost
clause. The limit is keyed on `userKey`, which is one `ed25519.keygen()`, and the budget is
per provider **process**, so a second provider defeats it without a second key."

### 2d. Cross-machine reproducibility descoped

`ROADMAP.md:255-260` (Phase 10 outcome): "Criterion 2's cache key MET with a pinned
conformance CID; its cross-machine half is **unmeasured**, carried as a structural blind
spot." And:
> "**Criterion 2 above is left at its original wording deliberately, and the score is
> unchanged at 3 of 4** (2026-07-28). The *requirement* AOT-03 was rewritten to what one
> host establishes under the same-machine testing-standard ruling, but rewording a completed
> phase's criterion to match would convert an unmet half into a met one by editing rather
> than by measuring."

`tools/aot/lift.ts:147-154` — `CROSS_MACHINE_BLIND_SPOT` note (verbatim string):
> "two lifts on one host produced byte-identical artifacts; two lifts on two hosts have
> never been compared, and elfconv promotes virtual registers by iterating a pointer-keyed
> std::unordered_map and a std::set<BBBag*> — nothing here is evidence about a second
> machine"

Same-host reproducibility measured: two lifts of identical bytes ten minutes apart,
byte-identical, `sha256 490eeed5…` (`tools/aot/lift.ts:66-70`).

---

## 3. The benchmark's own honesty problem — why it gates on a ratio

### 3a. The measured spread that forced it

`packages/bench/src/perf-workload.ts:11-22` (verbatim):
> "A gate on absolute milliseconds does not work on a developer machine, and that is a
> measurement rather than an opinion. Under eight busy-wait loops on eight cores, this
> ladder's absolute p50 makespan moved by a factor of **4.03** and its p95 by **4.20**,
> while the paired ratio's p50 moved by **0.56** — that is, downwards. Worse was seen before
> this module was routed through `submitJobWithEgress`: **thirty consecutive passes** of that
> variant, taken while other sessions drove the 1-minute load average **from 9 to 37 on this
> 8-core host**, put the 4-node absolute p95 **between 5.3 ms and 110.6 ms — a factor of
> 13.7, with a median of 8.1 ms**. A threshold loose enough to survive that is decoration;
> one tight enough to mean anything fires on load rather than on a code change. **Raising the
> sample size did not help: at 400 iterations per rung the same statistic still ranged over a
> factor of 3.7 with the worst pass discarded**, because a longer pass simply spans more of
> somebody else's build."

The fix (verbatim, same file):
> "So each iteration measures the fabric job **and, immediately after it, the identical work
> through one local `WasmExecutor` with no fabric at all**… The gated statistic is the
> per-iteration ratio of the two. Both numbers move together when the machine is busy, so
> what survives is the quantity a code change actually moves: how much the fabric costs on
> top of executing the same shards locally."

Pairing is explicit (`perf-workload.ts:305-312`): "Paired, not a ratio of the two
summaries: pairing is what makes a load spike cancel, since both halves of a pair are
measured microseconds apart."

Sample-size reasoning (`perf-workload.ts:113-128`): `GATE_RUNS = 101` so 100 samples remain
after the cold discard. "At 20 runs the harness discards one and `percentile` is
nearest-rank, so `ceil(0.95 × 19) = 19` — the reported p95 **is the maximum observation**.
Six passes at that setting put the 1-node p95 **between 3.4 ms and 20.6 ms, a factor of 6**,
because the statistic was a single worst sample by construction." Below 11 samples the
harness marks the sample unreliable and the gate refuses to pass at all.

Other declared constants: `GATE_SHARDS = 16`, `GATE_ADMISSION_LIMIT = 64`,
`GATE_LADDER = [1, 2, 4]` (8 and 16 omitted "on measured grounds: the whole memory ladder is
one process on one event loop").

Why the gate does not use the real transport (`perf-workload.ts:68-71`): "The real-transport
leg of a full driver run took the better part of ten minutes on the machine that baselined
this and excluded its own top rung with `read ECONNRESET`; a gate built on that would be
deleted within a month."

### 3b. The committed baseline (packages/bench/src/perf-baseline.ts)

`PERF_BASELINE.capturedAt: '2026-07-29'`; machine "Apple M1 Pro, 8 logical / 8 physical
cores, macOS 26.5.2, node v23.11.0"; `runsPerRung: 101`, `samplesPerRung: 100`,
`shards: 16`, `admissionLimit: 64`.

Conditions (verbatim): "Shared developer machine with other agent sessions active. The 20
baseline passes were taken at a 1-minute load average of 9 to 13 on 8 cores. **Two orphaned
busy-wait loops from an unrelated session (pids 44484 and 44485, 3 days old at capture time)
were consuming roughly 2 of those cores throughout** and are part of what these numbers
include… it is recorded rather than corrected for."

| rung | coordination ratio p50 | ratio p95 | makespan p50 (ms) | makespan p95 (ms) |
|---|---|---|---|---|
| 1 node | 1.567 | 2.656 | 2.098 | 4.491 |
| 2 nodes | 2.571 | 3.897 | 3.335 | 6.693 |
| 4 nodes | 2.516 | 3.530 | 3.263 | 5.462 |

Observed spread over **32 passes** (20 ambient + 12 during a concurrent
`vitest run --project node`): ratio p50 **1.070×**, ratio p95 **1.673×**, makespan p50
**1.236×**, makespan p95 **2.41×**.
Under **8 busy-wait loops on 8 cores**, 6 passes: ratio p50 **0.561×** (below 1.0 — "the
synchronous reference loses more to CPU starvation than the fabric path does, so this
statistic sags rather than rises under load"), ratio p95 **1.157×**, makespan p50 **4.032×**,
makespan p95 **4.196×**.

Headroom chosen from those spreads, not taste: ratio p50 **+0.30** (budget 1.30×), ratio p95
**+1.50** (budget 2.50×), makespan p50 **+5.00** (budget 6.00×) — "Deliberately a backstop
rather than a gate." Makespan p95 is **recorded, not gated**: "it moved by a factor of 4.20
under CPU saturation, and by 8.5 in the earlier session… Any budget wide enough not to fire
on load would only fire on an outage."

A finding that turned out negative and is reported anyway: "**12 passes while
`vitest run --project node` ran concurrently.** Worth stating because it turned out *not* to
matter — every one of those passes finished in 1.89–2.08 s against 1.75–2.57 s at ambient,
and the widest statistic moved by a factor of 1.67 rather than the several-fold excursion
expected."

Anti-ratchet rule (`perf-baseline.ts:3-13`): "Nothing in this repository writes to this file.
No `--update` flag exists… A gate that silently absorbs whatever the last run produced
measures nothing: it only ever agrees with the present, which is precisely the property that
makes a perf baseline worthless."

### 3c. The pre-registered methodology (.planning/BENCHMARK-METHODOLOGY.md)

Written **2026-07-26**, before any harness existed. Verbatim opening: "A benchmark chosen
after seeing the data is not a measurement, it is an argument. The commit that adds this file
contains no harness code, so the ordering is checkable in `git log` by anyone who doubts it."

Pre-registered expectation (§1.1): the node-count axis "will be *sub-linear* and will show a
knee where coordination overhead overtakes added parallelism." Pre-registered falsification:
"if the user-count axis is also merely linear or worse across the range we can measure, the
super-linear claim is **unsupported by measurement** and must be reported as such, in those
words."

Rules: gross **and** useful node-seconds must always appear together — "Reporting gross
without useful, or useful without gross, is forbidden." p50/p95/p99 always, never a bare
mean; "A percentile over fewer than **10 runs** is reported as `n=k, percentile unreliable`…
p99 over 10 samples is the maximum, and pretending otherwise is a lie of arithmetic."
Same-machine label mandatory and prominent. Analysis plan fixed in advance: ladder
**1, 2, 4, 8, 16**; **≥20 runs** per configuration; first discarded as cold-cache.
Declared bias #6: "**The author is the sole party running these**, with an obvious interest
in the outcome."

Amendment discipline: the 2026-07-31 reduce-leg amendment was committed *before* the run it
describes, with paragraphs appended after marked "*Appended after the run.*" It also records
which columns carry no information: "**The full run of 2026-08-01T05:38:05Z printed `tree
depth 2` and `combines 5` on every rung of the memory transport — 1, 2, 4, 8 and 16 nodes
alike.** Both columns are therefore constant across the published ladder and neither carries
information about a configuration."

### 3d. The published run (.planning/BENCHMARK-RESULTS.md, run 2026-08-01T06:09:01.272Z)

Headline label: "**SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count**"
— corrected 2026-08-04 from "16 processes on 1 host — not 16 nodes", which named a unit
nothing had counted: the label interpolated `nodeCount` into both halves, the driver
counts node identities, and all sixteen ran inside the one process that published them.
The disclosure is the same; only the noun moved, and no figure below changed.
Machine: Alexanders-MacBook-Pro.local, Apple M1 Pro, 0/8 cores reported, 32.0 GiB,
darwin 25.5.0, node v23.11.0 (an off-LTS version, declared in advance as bias #4).

Makespan — memory transport (n=19 each, 0 incomplete):

| nodes | p50 | p95/p99 | gross n·s | useful n·s | verif. tax | cold start |
|---|---|---|---|---|---|---|
| 1 | 22.4 ms | 29.6 ms | 3.883 | 3.883 | 1.00× | 37.8 ms |
| 2 | 44.6 ms | 51.6 ms | 14.493 | 7.246 | 2.00× | 52.7 ms |
| 4 | 44.5 ms | 52.1 ms | 14.640 | 7.320 | 2.00× | 52.3 ms |
| 8 | 45.8 ms | 57.6 ms | 15.064 | 7.532 | 2.00× | 49.7 ms |
| 16 | 44.9 ms | 51.4 ms | 14.646 | 7.323 | 2.00× | 66.6 ms |

Makespan — real transport (libp2p over TCP on loopback):

| nodes | p50 | p95/p99 | gross n·s | useful n·s | cold start |
|---|---|---|---|---|---|
| 1 | 38.2 ms | 99.6 ms | 11.473 | 11.473 | 193.6 ms |
| 2 | 68.8 ms | 79.2 ms | 39.571 | 19.785 | 203.1 ms |
| 4 | 67.2 ms | 94.1 ms | 40.653 | 20.327 | 201.3 ms |
| 8 | 69.5 ms | 122.3 ms | 42.939 | 21.470 | 279.5 ms |

Connectivity tax: 1 node **1.70×**, 2 **1.54×**, 4 **1.51×**, 8 **1.52×**.
(An earlier run recorded 8–10× — `STATE.md:318`.)

**COST crossover: none.** "Single-threaded baseline: p50 0.0032 ms · p95 0.093 ms · p99
0.093 ms (n=19)… **No crossover.** no crossover within the measured range (1, 2, 4, 8, 16
nodes). Best distributed p50 was 22.4 ms at 1 node, against a baseline p50 of 0.0032 ms — a
factor of **7086.14×**." (Phase 8's earlier figure was ~570× — `STATE.md:296`.)

Decomposition: native single-threaded **0.003 ms** p50 → same work through WASM in-process
**20.928 ms** p50 → distributed 4 nodes memory **44.5 ms** p50. Skewed input at 4 nodes:
**47.3 ms** p50 vs uniform 44.5 ms. Conclusion (verbatim): "Most of the COST gap is therefore
the guest ABI on a workload that does almost no work — not the fabric. That is a statement
about the fixture, and it is why the methodology declared the fixture bias in advance rather
than discovering it here."

Reduce tree, memory transport: reduce p50 0.885–1.4 ms, `combine executors` **1, 2, 3, 4, 5**
across the rungs, `recomputes` 0 everywhere. Real transport reduce p50 13.5–24.1 ms.

**A configuration published as excluded, not dropped** (verbatim):
> "| real transport, 16 nodes | `connection error 127.0.0.1:54524: connect ECONNRESET
> 127.0.0.1:54524` — libp2p caps inbound connections at `INBOUND_CONNECTION_THRESHOLD = 5`
> **per host**, and every node here shares one host, so beyond ~5 concurrent dials to the
> requestor the noise handshake is killed and the failure reads like a network fault. A
> same-machine artifact of a documented default, not a property of the fabric. |"

**A table of em dashes that was explained rather than deleted.** The previous run's
real-transport reduce was entirely empty: `serveAgent`'s combine branch refused unless its
`authorize` hook was the `serves-unauthenticated` sentinel, and every `FabricNode` supplies a
real `authorizeCapability`, so every node answered `combine requires a capability chain this
build cannot verify` — "measured as `combines: 0`, `failed: 5`, `executedBy: 0`,
`rootCid: null`." Kept in the document after the fix "because a reader comparing two dated
artifacts must be able to tell a figure that changed from a figure that was replaced."

Egress manifests, full run 2026-08-01T05:38:05Z: **3055 frames / 1,468,983 bytes** (memory),
**2367 frames / 1,140,430 bytes** (real) — declared **not comparable** with the previously
published `--quick` figures (6 iterations, ladders `[1,2,4]` / `[1,2]`), and the real
transport's figure "counts the request frames of an aggregation that never happened."
An earlier `--quick` run recorded 287 frames / 46,438 bytes (memory) and 171 frames /
27,593 bytes (real) — `phase-13-.../13-03-SUMMARY.md:147`.

---

## 4. elfconv findings

### 4a. The exit code is not evidence — 174 addresses on a hello-world

`tools/aot/lift.ts:10-18` (verbatim):
> "`TARGET=aarch64-wasi32 ./exe.sh <elf>` exits 0 on translations it already knows are
> broken, and this was measured, not assumed. Lifting a static `int main(void){ return 42; }`
> — **659 KB from clang-16 `-O0 -static`** — printed six cheerful `INFO` lines, exited 0,
> produced a **5.66 MB** artifact, and left **174 distinct addresses untranslated**. Sampling
> them found real SVE instructions (`ld1b`, `st1b`, `whilelo`, `ptrue`) inside glibc's
> `__memcpy_a64fx`. Each one is a `__ecv_warning` call in the emitted IR, which at runtime is
> `elfconv_runtime_error(...)` — an abort. Nothing on stdout or stderr said so."

`phase-10-elfconv-aot/SUMMARY.md:20-42` gives the fuller count and the verdict line:
- "**174 addresses over 259 call sites** untranslated inside glibc's SVE `__memcpy_a64fx`."
- Verdict printed: `aarch64-wasi32 · 5654531 bytes · 93.6s · RESERVATIONS   exit 2`
- "**Exit 2, not 0**, because a build script checking only for zero would otherwise read
  'translated, but 174 addresses abort if reached' as success — the exact mistake this driver
  exists to stop elfconv making."
- README.md:124-126 states it as a shaping constraint: "**elfconv's exit code is never
  trusted.** It exits `0` on binaries it could not fully translate — 174 unrecovered
  addresses on a hello-world. The driver measures the produced module instead."

Why the driver needs its own probe (`tools/aot/scan.ts:37-45`, verbatim):
> "In `ghcr.io/yomaytk/elfconv:arm64` the two `[WARNING]` forms are compiled out:
> `WARNING_OUTPUT` is commented out at
> `backend/remill/include/remill/BC/HelperMacro.h:10`. So a decode failure in *this* image is
> completely silent — and it is not rare. Lifting a static `int main(void){ return 42; }`
> (659 KB, clang-16 `-O0 -static`) printed nothing at all and still emitted **259
> `__ecv_warning` calls covering 174 distinct addresses**, every sampled one a real SVE
> instruction inside glibc's `__memcpy_a64fx`."

Two greps must agree before the count is called evidence; a `counted-only` probe state exists
precisely because a single grep that stopped matching "would report zero and look like good
news" (`lift.ts:190-222`). A lift with findings is **success with reservations**, not failure:
"the smallest possible input already has 174 of them. A driver that refused those would refuse
everything and be deleted within a week."

Also recorded: `LiftFailure` has a `no-artifact` arm for "Exit 0 and no `.wasm`. Has happened;
it is not a theoretical branch."

### 4b. "Unstripped was wrong"

`packages/aot/src/elf.ts:18-28` (verbatim):
> "## Stripped is not disqualifying — the recorded assumption was wrong
>
> This project's notes said elfconv required unstripped binaries. Measurement says otherwise:
> a stripped input translates fine **as long as `.eh_frame` survives**, because the loader
> recovers function entries from the unwind tables via libdwarf. Stripped *and* without
> `.eh_frame` is the case elfconv rejects outright. So the refusal here is the conjunction,
> and `ElfFacts` reports `stripped` as a *fact* rather than a verdict. Encoding the original
> assumption would have refused a large and perfectly translatable class of input — release
> binaries — which is the expensive kind of wrong for a gate to be, because nobody
> investigates a build that was never attempted."

`ROADMAP.md:260-261`: "**Correction: 'unstripped' was wrong.** A stripped binary lifts fine if
`.eh_frame` survives, because the loader recovers function entries through libdwarf."

The refusal is measured against a real binary
(`packages/aot/src/elf.real.node.test.ts:88-98`): the stripped subject "has no `.symtab` at
all and lifts fine"; the refused subject was produced with
`objcopy --strip-all --remove-section=.eh_frame --remove-section=.eh_frame_hdr`.
A **hollow** `.eh_frame` is also refused — size, not mere presence (`elf.ts:428-433`):
"A zero-length `.eh_frame` is a section header with no unwind entries behind it, and libdwarf
recovers exactly nothing from it." Refusal text (`elf.ts:479`): *"stripped with no .eh_frame
to recover function entries from … — keep either the symbol table or the unwind tables;
stripping one is fine, stripping both is not"*.

### 4c. Other elfconv / AOT measurements

- **Real lift cost:** 2 containers, **93.6 s each**, byte-identical output; artifact
  **5,654,531 bytes**, `aarch64-wasi32`, features bulk-memory / mutable-globals / sign-ext
  (`SUMMARY.md:179-183`). Later measured range for a real lift: **152.7–304.3 s**, "a 2× swing
  with load, so any fixed budget must be sized against the top of that range and not the
  middle" (`STATE.md:816-820`).
- **The emulation tax, measured 2026-07-31** (`STATE.md:842-845`): timing `wasi.start()` alone
  on a 32 MiB memory-and-ALU workload that all three routes agree on (checksum
  `9584708361817009923`): **native 58.78 ms, direct-compiled WASM 65.19 ms (1.11×),
  elfconv-lifted WASM 122.81 ms (2.09× native, 1.88× direct)**.
- **The ~43 ms startup floor cannot be cached away** (`STATE.md:846-856`, `ROADMAP.md:707`):
  "the lifted `_start` alone is **42.83 ms** and instantiate+start is **42.65 ms** —
  indistinguishable, so the entire floor executes *inside* the guest, in elfconv's emulated
  machine-state init, and is re-paid per task. Compile (~4 ms, and V8 compiles lazily) and
  instantiate (~1.8 ms) are not where it lives. **Direct WASM's `_start` for the same program
  is 0.03 ms, ~1400× less.**" And: "under N-version execution it is paid per replica, which
  puts a floor on useful shard size."
- **Size:** the same four lines of C compiled straight to WASM is **504 bytes** against the
  lifted artifact's **5.40 MiB** — "Same program, ~11,000x apart"
  (`tools/aot/bench-lifted.ts:92-93`).
- **A withdrawn conclusion** (`tools/aot/bench-lifted.ts:5-17`, verbatim): "Three hand-rolled
  runs over the same artifact, in the same process shape, on the same host, put the raw
  execution path at **p50 82 ms, then 136 ms, then 37 ms. A 3.7x spread across identical code
  is not a measurement, and it is the reason a 'raw is 2.5x slower than the executor'
  conclusion drawn from two of those runs was withdrawn.**" Replaced with `tinybench`, which
  discards warm-up and reports **rme**: "Two rows whose error bars overlap are not different,
  however far apart their means look." The benchmark prints load average either side.
- **An unmeasurable inter-row confound, published** (`STATE.md:821-824`): "**The benchmark's
  row-order confound.** Load drifted 29→49 during a run, so no inter-row difference under
  ~20% is claimed. Fixing it needs interleaved rows rather than blocks, or a quiet host."
- **What the real artifact taught that fixtures could not** (`SUMMARY.md:104-114`): ABI held
  exactly — **23 WASI imports**, `_start` and `memory`, every import answered. And: "**A
  `printf("hello\n")` imports `clock_time_get` and `poll_oneoff`.** glibc's stdio pulls them
  in whether the program asks or not. Pinning the clock is load-bearing on the very first task
  anyone runs — two nodes on the unpinned shim would read two different wall clocks
  immediately."
- **Distribution is unsolved** (`ROADMAP.md:692-698`): "**OPEN QUESTION FOR THE PLANNER — how
  does a 5.40 MiB artifact reach a node that does not have it?**… **The problem is not content
  addressing — we have that. It is durability and fan-out.** A CID tells you whether you got
  the right bytes; it says nothing about whether anyone still holds them." Also verified
  2026-08-01: "this repository **does not depend on Helia at all today**… no `helia`, no
  `@helia/*`, no `unixfs`, no `bitswap` in any manifest, despite `STACK.md` recommending it at
  length."

---

## 5. Measurements that contradicted an assumption

1. **"Unstripped binaries required."** Wrong — `.eh_frame` alone suffices (§4b). Corrected in
   `CLAUDE.md`, `ROADMAP.md` and the source.
2. **elfconv's exit code means success.** Wrong — exit 0 with 174 untranslated addresses (§4a).
3. **A second visit hits the V8 WASM code cache.** Not observed, four configurations, with a
   positive and a negative control (§2a).
4. **`INBOUND_CONNECTION_THRESHOLD` is per peer.** It is **per host**
   (`packages/libp2p/src/constants.ts:169-192`, verbatim): "the most surprising one in this
   file. It is per *host*, not per peer — so it binds whenever many peers share an IP: every
   tab in a local multi-tab test, all on `127.0.0.1`; and, in production, every volunteer
   behind one NAT — a school, an office, a carrier running CGNAT. For a fabric whose whole
   premise is many browsers, that is not an edge case." Its value is **5**. "Found by
   bisection: **eight simultaneous joins already failed three of eight**, and adding a stagger
   fixed it, while raising the reservation and pending-handshake limits did not." The symptom
   is `EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1 bytes` —
   "indistinguishable from a network fault unless you know to look here."
   Sibling constant: `LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS = 10` — "Ten browser tabs joining
   at once already sit at the edge; the eleventh is dropped part-way through the noise
   handshake." Discovered by 16 browser peers failing against a relay whose reservation limit
   was 32: "Raising reservations alone is not enough."
5. **The benchmark was shipping just under a connection-killing cliff.**
   `packages/node/src/bin/bench.ts:78-89` (verbatim): "Raised from 8 to 16 by phase 13.1.
   **8 was one below a measured cliff: dispatching 12 shards immediately after dial aborted
   the whole libp2p connection with `MaxEarlyStreamsError`**, so the benchmark shipped just
   under a limit that would have killed it, and a published curve would have been measured
   against an unfixed connection-killing bound." The muxer bound is
   `init.maxEarlyStreams ?? 10` in `@libp2p/utils`' `AbstractStreamMuxer` — *not*
   `@chainsafe/libp2p-yamux`'s `defaultConfig.maxEarlyStreams`, "which `YamuxMuxer` declares
   and never reads." Measured N=8 completing, N=12 aborting.
6. **The two published curves were measured against nodes that behaved differently.**
   `BENCHMARK-RESULTS.md:93`: "until phase 13.1 wired it, the memory rig ran with admission
   switched off while the real rig admitted, so the two curves were measured against nodes
   that behaved differently and nothing in the report said so." A connectivity tax computed
   across that pair "is a ratio between two different nodes."
7. **A metric named seconds was measuring bytes.** `STATE.md:311-314`: "`JobResult.
   grossNodeSeconds` named a quantity that was *bytes across the guest ABI*, not seconds —
   deterministic, which is right for a cost metric, and off by a factor nobody could guess if
   published as time. Renamed to `grossFuel`/`usefulFuel`."
8. **A "fast" first benchmark run was 19/19 failures.** `STATE.md:307-310`: "The first full run
   reported 19/19 incomplete at every memory rung rather than a suspiciously fast success: the
   memory workers could not fetch shard inputs. A harness that averaged failures in would have
   published a beautiful fictional curve."
9. **Parallelism would move the colouring wall.** It did not; ordering did.
   `STATE.md:288-291`: "The colouring search first walled at **n = 205** and no parallelism
   moved it: assigning values in increasing order means a cube fixes the *least* constrained
   numbers — 1 and 2 appear in no triple at all — so cubing split the work without splitting
   the difficulty. Ordering by constraint degree moves the wall with cube count: **1 cube →
   300, 8 → 500, 256 → 600**." (`verifyColouring` re-derives **484 triples at n = 600** in
   under a millisecond.)
10. **Background-tab timers are usable.** `STATE.md:292-294`: "**Chromium throttles timers hard
    in a tab that is not in front** — measured, a **400 ms poll produced one tick per second**.
    Anything the always-visible surface depends on is pushed, never polled. This bit twice in
    one phase."
11. **"BrowserNode.start cannot be tested."** False, and it survived four plans.
    `STATE.md:722-731`: "Every plan repeated that `BrowserNode.start` 'needs a real
    `indexedDB` and a relay to dial, so it runs in neither vitest project', and the browser
    tier's authorizer went unproven because of it — **a scrambling mutation left 345 browser
    tests green**. The true statement is narrower: the **`browser`** project cannot host it…
    the **`e2e`** project can… **Six shipped comments carried the false claim, one of them
    sitting directly on the authorize hook.**"
12. **A comment asserting a fact about every call site expired silently.**
    `STATE.md:744-748`: the combine gate's comment read *"Every production call site passes the
    sentinel today, so this is a no-op now."* "Phase 15 installed real authorizers and falsified
    it silently. **A comment asserting a fact about every call site is a claim with an expiry
    date**." Consequence: combine "never worked in production, from the moment the branch was
    written," and no in-process test fabric could see it because they all build
    `serveAgent({...SENTINELS})` — the exact value the branch keyed on.
13. **Tightening auth made a security property worse — measured, not argued.**
    `STATE.md:753-760`: "Routing combine through the `Authorizer` made a security property
    worse… The old refusal had incidentally bounded combine fetches to zero on any real node.
    Removing it widened the residue to every node." And on placement of the fix:
    "16-06 planted its cap *below* the fetch loop: both refusal-text assertions stayed green
    while **reads went 0 → 2**." Same shape as NET-08 — "a cap applied after a loop has already
    paid for the allocation it prevents" (a 64 MiB frame was accepted over the real transport
    before it).
14. **A text census cannot tell a wired guard from a decorative one.** `STATE.md:678-682`:
    "Deleting `provenance(...)` from `browser-node.ts` turns two tab refusals red while
    `trust-anchors.node.test.ts` stays **20/20**, because `guardModuleProvenance(` is still
    textually present, just applied to nothing." Same shape as the disclosure gate whose
    wrangler pattern "missed `wrangler pages deploy` — the command someone would actually type
    — and nothing noticed because every test asserted *absence*, so a pattern matching nothing
    read green" (`STATE.md:895-899`).
15. **"Built, not wired" has a measurable signature, measured in both directions.**
    `STATE.md:683-687`: "Before the phase, emptying both demo trust-anchor sets changed nothing
    across fifteen e2e tests. After it, the same plant takes the colouring job down."
16. **Identity is not behaviour.** `SUMMARY.md:156-166`: `PINNED_WASI_FUNCTIONS` was checked
    only for `pinned[name] !== shim[name]`, "which is satisfied exactly by a replacement
    returning the *wrong value* — `undefined` from a socket call coerces to `0` at the ABI,
    which is ERRNO_SUCCESS, 'your socket is connected'."
17. **A file had silently left the vocabulary guard's jurisdiction.** `SUMMARY.md:146-154`: six
    raw NUL bytes in `wasi-executor.test.ts` made the repository-wide guard skip the whole file
    with no `EXEMPT_PATHS` entry — "The guard's own planted violations kept passing, because
    they scan synthetic content rather than the tree — so it reported itself healthy
    throughout."
18. **Diagnosing the wrong failure.** `tools/aot/lift.ts:268-299`: intermittent
    `docker-unavailable` on a host where Docker worked. Two measured populations settled it and
    do not overlap: spawn refused by the host (`EAGAIN`, 6/6) answers in **0–3 ms**; a spawn
    that succeeds at load average 42.7→54.5 (60/60) costs **p50 116 ms, p90 328 ms, max 456 ms**;
    the timeout needs **5,000/20,000 ms** to fire. "For the timeout to have fired, spawning
    would have had to be two orders of magnitude worse than it measurably is at that exact
    load." Split into a new `host-cannot-spawn` failure kind: "A refusal that names the wrong
    thing is a defect even when the operation correctly fails."
19. **Cloudflare cannot host the relay — and the first analysis of *why* was itself wrong.**
    `STATE.md:874-887`: Workers are ruled out structurally (*"it is not possible to make an
    inbound TCP connection to your Worker"*; no UDP anywhere, which rules out WebRTC-Direct).
    "**Correction to the first pass, which was wrong:** Cloudflare **Containers** are *not*
    ruled out by transport… Containers fail on **lifecycle** instead — no minimum uptime
    guarantee and irregular restarts against a 2-hour reservation TTL." Cost analysis was also
    wrong in both directions: "wall-minutes are not vCPU-minutes (a `lite` instance is 1/16
    vCPU), and the Durable Object figure double-counted — 331,776 GB-s is *inside* the 400,000
    included." Also: "`stun:stun.cloudflare.com:3478` is **already** in `@libp2p/webrtc`'s
    `DEFAULT_ICE_SERVERS`… so 'add Cloudflare STUN' is a no-op — and pinning to it alone would
    cut four independent STUN operators to one."
20. **An unverified upstream suspicion, published as such** (`STATE.md:900-902`):
    "`@libp2p/circuit-relay-v2` appears to write `defaultDurationLimit` in milliseconds into a
    protobuf field the spec defines in seconds, so a dialer computes 33.3 hours where the
    server enforces 120 s."
21. **Phases could not run concurrently after all** (`STATE.md:145-149`): measured 2026-07-31
    from their own `files_modified` — `fabric-node.ts` touched by phases 14/15/17/21,
    `bin/bench.ts` by 14/15/16/17/23, `browser-node.ts` by 14/15/17/21 — "so the earlier note
    that six phases 'can run concurrently' was wrong."
22. **Plan citations drift far worse than assumed** (`STATE.md:709-716`): "**41 wrong
    `file:line` references across four plans** (6, 9, 14, 12)… Assume every citation in an
    unexecuted plan is stale."
23. **A defect a comment could not survive:** `PeerVerifier` "decides a peer's verdict on
    `peer:connect` and never asks again. **So a node that enrols *after* a peer has already
    connected to it is permanently excluded by that peer.** Observed directly, not inferred: an
    enrolled tab holding a valid certificate sat at `'not asked yet'` for **20 s**"
    (`STATE.md:766-776`).
24. **The project's own state tooling corrupts its state file** (`STATE.md:52-70`): three
    separate writers rewrote the frontmatter — `state.begin-phase` "rewrote 25% to 62%",
    `pause-work` "rewrote `total_phases` 14 to 24", `state.record-metric` "rewrote every
    progress count: **percent 36 to 74**." "None of them errored."

---

## 6. Coverage numbers and test counts, with dates

### 6.1 The baseline measurement (.planning/COVERAGE-BASELINE.md)

**Date 2026-07-29.** Tooling `@vitest/coverage-v8@4.1.10`, provider `v8`, command
`npm run test:coverage` → `vitest run --project node --coverage`.
Result of that command: **75 test files, 1080 tests, all passing, 210.65 s.**

> "Coverage has never been measured on this project before. **These numbers are a finding, not
> a target.**"

| Metric | Covered / total | % |
|---|---|---|
| Statements | 3285 / 4270 | **76.93** |
| Branches | 1849 / 2446 | **75.59** |
| Functions | 636 / 816 | **77.94** |
| Lines | 2925 / 3709 | **78.86** |

Per-package (v8 reporter rollups, same date): `packages/core/src` **95.30 / 91.45 / 98.57 /
97.78`; `core/src/canonical` **100 / 96.15 / 100 / 100`; `core/src/job` 97.52; `core/src/
transport` 97.22; `core/src/executor` **67.46**; `packages/aot/src` **94.70 / 84.38 / 92.18 /
94.33**; `packages/demo/src` 98.52; `packages/libp2p/src` 91.72; `packages/net/src` 87.79;
`tools/aot` **86.68 / 74.58 / 93.10 / 88.69**; `packages/node/src` **72.97**;
`packages/bench/src` **50.00**; `packages/browser/src` **26.64**; `packages/node/src/bin`
**0**.

> "The kernel — `packages/core` — is the strongest tier at 95.30 / 91.45, and its `canonical`
> encoder is at 100 % statements with one uncovered branch. That is the right shape for this
> repository: the code whose determinism the whole integrity argument rests on is the code
> most covered."

### 6.2 Re-measurements, each with its reason

- **2026-07-30, after B08–B14:** `node` project **78.62 %** statements (3442 / 4378) /
  **76.86 %** branches (1910 / 2485) / **78.79 %** functions (669 / 849) / **80.53 %** lines
  (3065 / 3806) over **80 test files, 1188 tests, all passing, 206.48 s.** Named movers:
  `verify.ts` now **33 / 33**, `packages/core/src/job` **98.94 %**, `fabric-node.ts` **100 %**,
  `libp2p-transport.ts` **94 %**, `coordinator.ts` **96.25 %**, `enrollment.ts` **92.64 %**,
  `wasm.ts` **86.76 %**.
- **2026-07-30, after B03/B06:** **77.96 %** statements / 76.00 % branches / 78.05 % functions
  / 79.90 % lines over **79 test files, 1157 tests, all passing, 227.26 s.** "It moved *up*,
  and the reason is worth recording because the prediction was that it would move down": two
  new modules read **0 %** and both are correct at 0 % — `core/src/executor/task-run.ts` and
  `node/src/task-executor.worker-thread.ts` "execute **inside a worker thread**, which the v8
  provider does not instrument."
- The 2026-07-29 table is left exactly as measured: "**A baseline that is edited to match the
  present is not a baseline.**"

### 6.3 The first figures were an artefact

> "**Re-measured 2026-07-29, and the first figures were an artefact.** The original run
> reported **75.62 %** overall and **70.38 %** for `packages/node/src`. A later run read
> **54.94 %** for that package on code where nothing covered had changed — the whole 15-point
> swing was `mutation-guard.mutate.ts` reading **0 of 85 statements**… **The tool that measures
> the guards is not itself one of the guards.**"

Also corrected in the same note: "the two orphaned busy-wait loops named in `conditions` below
were killed on 2026-07-29… they had burned **~2 of 8 cores for 3 days 19 hours**. Any timing
recorded here or in the perf baseline predates that."

### 6.4 The instrument cannot reach two of the three projects

`vitest run --project node --project browser --coverage` fails: with firefox and webkit in the
matrix the run produced **212 instances** of
`Error: browserContext.newCDPSession: CDP session is only available in Chromium` and wrote
**no coverage report at all** — `coverage/` did not exist afterwards. Firefox also timed out
under instrumentation (`kernel.test.ts`, 15000 ms).
> "So browser-tier coverage is not merely unmeasured, it is unmeasurable with this provider
> while the portability matrix is in place. Between the two, the portability matrix is worth
> more than the coverage percentage."

**15 files at 0 % statements, classified:** 11 tested by a project the instrument cannot reach
(with statement counts: `idb-blockstore.ts` 26, `streaming-load.ts` 119,
`synthetic-artifact.ts` 51, `worker-executor.ts` 58, `wasm-probes.ts` 23,
`task-executor.worker.ts` 17, `task-worker.ts` 20, `seed-server.ts` 59, `bin/bench.ts` 161,
`bin/agent.ts` 16, `bin/seed.ts` 31), a twelfth structural case (`worker-factory.ts`, 1
statement, Vite-only syntax), and **3 genuinely untested**: `browser-node.ts` **58**,
`perf-gate.ts` 51, `perf-workload.ts` 72.

> "So `browser-node.ts` at 0/58 statements is not an instrument artefact. It is 58 statements
> of the browser tier with no runtime execution in any project, and it is the single largest
> genuine gap this measurement found."

**No threshold is set, deliberately.** "A floor chosen before anyone had seen the number would
be arbitrary in both directions." If one is ever set: per-package, a few points under measured
— roughly `core` 93/89, `net` 85/77, `aot` 92/82, `tools/aot` 84/72 (statements/branches) —
and never on `packages/browser` or `packages/node/src/bin`, because "Flooring them at their
apparent 26.64 % and 0 % would ratify the artefact."

### 6.5 Full-suite test counts over time (all four vitest projects)

| Date / point | Files | Tests | Source |
|---|---|---|---|
| Phase 10 close (2026-07-27) | 111 | 1669 | `phase-10-.../SUMMARY.md:177` |
| Phase 11 baseline | 112 | 1673 | `11-01-SUMMARY.md:157` |
| After Phase 11 | 115 | 1690 | `11-01-SUMMARY.md:157` |
| Phase 12-02 | 116 | 1749 | `12-02-SUMMARY.md:67` |
| Phase 12-04 end | 116 | 1758 | `12-04-SUMMARY.md:161` |
| Phase 13 verification (2026-07-28) | 122 | 1775 | `13-VERIFICATION.md:13` |
| Phase 13 second verification | 124 | 1798 | `13-VERIFICATION-2.md:15` |
| Phase 13.1 pre-phase baseline | 124 | 1801 | `13.1-04-SUMMARY.md:5` |
| Phase 13.1-04 | 134 | 1903 | `13.1-04-SUMMARY.md:4` |
| Phase 14-02 (net+core+demo scope) | 172 | 2363, 0 failures | `14-02-SUMMARY.md:205` |

`README.md:216-219`: "Vitest runs **four** projects from one config — `node`, `browser`
(Playwright: Chromium, Firefox, WebKit), `e2e`, and `perf` (gated behind `O2_PERF=1`)."
`npm test` is "~5 min; the AOT tests really do drive Docker" (README.md:77).

**Mutation-testing counts** (each a caught/planted pair): Phase 10 — 25/26 (elf), 6/6 (pinned
WASI surface), 2/2 (real artifact), 2/2 (NUL guard); "Three adversarial lenses over the phase
produced **27 findings, ~46 mutations**." Phase 9 — 6 planted, 6 caught. Phase 10 reviewer
round — 8 planted, 8 caught. Ledger entries M28 (decorative guard), M29 ("the one ledger entry
that pins a *change* rather than a guard"), M30 (browser-tier authorizer).

### 6.6 Load-sensitive tests, recorded rather than muted

`STATE.md:800-806`: "`churn.test.ts`'s 30 %-killed case failed once at **load 17.5–59.4** and
passed 3/3 in isolation; `transport-bounds.node.test.ts`'s retained-bytes bound failed twice at
**load ~12.4** and passed at **8.72 and 7.70**. Both are wall-clock bounds inside otherwise
deterministic tests — a bound that reads host contention as a defect."

`STATE.md:816-820`: `lift.node.test.ts`'s `INTEGRATION_TIMEOUT_MS` is 15 min and wraps 45 min
of internal budget (5 min compile + 2 × 20 min), "the outer clock is the smaller one, so the
inner budgets can never fire… An earlier attempt to set it to 300 s turned six tests red and
was reverted."

---

## 7. Source index

| Claim family | File |
|---|---|
| Demonstrated / not demonstrated | `README.md:144-205` |
| Pre-registered benchmark plan, amendments | `.planning/BENCHMARK-METHODOLOGY.md` |
| Published run, exclusions, COST | `.planning/BENCHMARK-RESULTS.md` |
| Coverage, its artefacts and its blind spots | `.planning/COVERAGE-BASELINE.md` |
| Ratio-gating rationale, spread numbers | `packages/bench/src/perf-workload.ts:9-72`, `packages/bench/src/perf-baseline.ts` |
| elfconv exit code, blind spots, failure taxonomy | `tools/aot/lift.ts`, `tools/aot/scan.ts` |
| "Unstripped was wrong" | `packages/aot/src/elf.ts:18-28`, `packages/aot/src/elf.real.node.test.ts`, `.planning/ROADMAP.md:260` |
| V8 code-cache negative | `packages/node/src/code-cache.e2e.test.ts:15-105`, `.planning/phases/phase-10-elfconv-aot/SUMMARY.md:118-142` |
| libp2p limits found by bisection | `packages/libp2p/src/constants.ts:20-195` |
| Shard cliff | `packages/node/src/bin/bench.ts:78-89` |
| Lifted-vs-native timing, 43 ms floor | `.planning/STATE.md:842-856`, `.planning/ROADMAP.md:707`, `tools/aot/bench-lifted.ts` |
| Per-phase landings and corrections | `.planning/STATE.md:224-340`, `:640-806`, `:874-902` |
| 16 browser peers | `packages/node/src/many-tabs.e2e.test.ts` |
