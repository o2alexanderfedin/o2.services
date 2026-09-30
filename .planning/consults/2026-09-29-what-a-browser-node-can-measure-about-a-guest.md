# What a browser node can measure about a guest

**Date:** 2026-09-29
**Asked by:** the owner — "what can we, in principle, measure in WASM, given a minimal environment as a web
page, and without heavy load on our p2p node?"
**Method:** repo reading, official documentation, and a two-kernel benchmark run in Chromium 151,
Firefox 153 and WebKit 26.5 (Playwright, headless, no COOP/COEP) plus Node/V8. Harness and how to rerun
it: [`2026-09-29-wasm-metering-bench/`](2026-09-29-wasm-metering-bench/README.md). No product code was
changed by this consult.
**Related work merged the same day:** PR #39 (disagreeing shards' fuel counted), PR #41
(`grossExecMs` / `usefulExecMs`, self-reported wall time beside fuel).

---

## 0. The short answer

A plain web page **can** measure a guest's cost exactly and identically on every node — if the WASM
binary counts its own work. It **cannot** measure CPU time at all, and wall-clock time is only something
each node says about itself.

The key fact, measured: a per-basic-block counter injected into the module returned **the same number on
all three engines** — 4 313 086 554 (per-instruction counter: 4 430 776 098) — and, given a finite
budget, the module trapped at the same point on every run.

## 1. What the repo already decided

- **Fuel today is bytes, not work.** `fuelUsed: inputBytes.length + output.length`
  (`packages/core/src/executor/wasm.ts:217`, `packages/aot/src/wasi-executor.ts:762`); the doc comment on
  `grossFuel` in `packages/core/src/job/submit.ts` says so. A guest that loops for an hour and returns 8
  bytes costs the same as an instant one.
- **BROW-05** — no COOP/COEP, so no cross-origin isolation and no `SharedArrayBuffer`. The probe confirmed
  `SharedArrayBuffer` and `measureUserAgentSpecificMemory` are undefined in all three engines.
- **Runaway tasks:** [`research/STACK.md:286`](../research/STACK.md) chose "Worker + `terminate()` on a
  wall-clock timeout" over build-time gas instrumentation because "it costs nothing".
  `wasm-metering` was rejected as unmaintained (`STACK.md:399`). Gas metering is still listed as
  **unresolved** in `STACK.md:463` and [`research/SUMMARY.md:360`](../research/SUMMARY.md) — never
  rejected.
- Fuel is deliberately kept outside the compared result (`verify.ts`, VER-05), so a cost difference can
  never look like a guest giving different answers.

## 2. Candidates, cheapest for the node first

| Measure | Load on the node | Availability (page and Worker) | Precision | Same on every replica? | Checkable by replicas? |
|---|---|---|---|---|---|
| Bytes across the guest ABI (today's fuel) | none | all | exact | yes | yes, if compared |
| Host-function call count | one increment per call | all | exact | yes | yes |
| Peak memory (`memory.buffer.byteLength` after the run; it never shrinks) | none | all | 64 KiB pages | yes, unless a grow fails on host limits | yes |
| Memory cap written into the module at publish time | none (engine enforces it) | all | exact | yes | yes |
| Wall clock, `performance.now()` | none | all; Worker = page | measured: Chromium 0.1 ms, Firefox 1 ms, WebKit 1 ms | no | no — self-reported, easy to fake |
| CPU time | — | **no web API exists** | — | — | — |
| **Per-block counter with trap at budget** | measured: tight loop +0–7 %; call-heavy code 2.0× (Chromium), ~1.4× (Firefox); ~9 extra bytes per result; one-time rewrite | all | exact | **yes — identical on 3 engines** | **yes** |
| Per-instruction counter | measured 5.6–7× (Chromium), 7–13× (Firefox); 37–6350× if each step calls into JS ([Titzer, ASPLOS'24](https://arxiv.org/pdf/2403.07973)) | all | exact | yes | yes — too slow to use |
| Sampling / engine-side interruption | **not possible**: a busy Worker can't be read without `SharedArrayBuffer`; `Profiler` is absent in Workers (measured) and needs a `Document-Policy` header | — | — | — | — |
| `performance.memory` | none | Chromium only, deprecated, JS heap only | coarse | no | no |
| `measureUserAgentSpecificMemory` | — | needs cross-origin isolation → unavailable | — | — | — |
| `hardwareConcurrency`, `deviceMemory` | none | cores everywhere; device memory Chromium only, rounded | coarse | no | no; fingerprinting risk |
| Compute Pressure | small | Chromium only (page and Worker, measured); blocked in third-party frames by default | 4 states | no | no |
| Long Tasks / Long Animation Frames, Battery | — | page thread / Chromium only; never see Worker work | — | — | — |
| Compile / instantiate time | none | all | 0.1–1 ms | no | no |

## 3. Recommendation (respecting "no heavy load on the node")

1. **Now, at no cost.** Add the host-call count and peak memory (pages) beside today's byte count, and
   write a memory cap into the module at publish time. Keep PR #41's wall-clock milliseconds as
   self-reported telemetry for scheduling only — never in cost, verification or reputation.
2. **Next: the per-block counter as the primary, verifiable cost unit.** Bytes across the ABI remain the
   I/O part.
   - **Where the rewrite happens:** once per module at publish time, by the build authority that already
     signs `key → CID` (DET-03). The signed CID *is* the counted module, cached by that hash. Nodes do no
     rewrite work. (`STACK.md` already treats binaryen as build-time only.)
   - **Not the submitter, not the nodes:** a submitter-side rewrite is acceptable only for pricing (leaving
     charges out cheats only their own bill); per-node rewriting is unnecessary work.
   - **How replicas check it:** compare the count as its own field with its own disagreement kind, and
     include it in the commit-reveal hash (VER-02) so a replica cannot copy another's. Keep it out of the
     output digest, so `verify.ts`'s reasoning stays intact.
   - **Budgets become real:** start the counter at the task's budget. Every replica traps at the same
     instruction, so "budget exhausted" is an agreed, checkable outcome — closing the gap `ports.ts` names
     ("V8 has no fuel metering"). The Worker `terminate()` timeout stays as the backstop.
3. **To keep node load lower still:** charge only at function entry and loop headers, not every block.
   Every non-terminating run passes through one of them, so budgets still hold and cost stays roughly
   proportional. *Proposal — not measured.*

Per-instruction counting and sampling are ruled out.

## 4. Risks and costs

- **Call-heavy guests pay the most.** The 2× figure is a lower bound: the recursive kernel was charged only
  at function entry; a real pass also charges inside branches. The tight-loop ~0 % is a best case — the
  loop's own dependency chain hides the counter.
- **Engines can stop at different points** on stack overflow depth and failed `memory.grow`. Needs a
  stack-height limiter ([`wasm-instrument`](https://github.com/paritytech/wasm-instrument) has one) plus
  the memory cap — the same class of problem as the NaN / relaxed-SIMD handling already done at publish.
- **Tooling must be chosen or built.** [`wasm-metering`](https://github.com/ewasm/wasm-metering) is
  orphaned; `wasm-instrument` (Rust, Parity) was not checked for maintenance
  ([its issue #11](https://github.com/paritytech/wasm-instrument/issues/11)); otherwise a pass on binaryen
  or walrus.
- **Cost weights must be versioned** and pinned inside the signed module. Modules published without
  counting need an explicit "unmetered" marker, never `0`.
- **Wall clock misleads in background tabs.** Hidden tabs lower process priority, and `performance.now()`
  keeps ticking through OS sleep only on Windows ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)).
  Elapsed time is not CPU time.

## 5. Not established

- The one-time rewrite cost was not measured (a single linear pass, but no number).
- Only two microbenchmarks; no real guests.
- "Safari" is Playwright's WebKit on one 8-core Mac; its 2–5 ms timings sit at 1 ms resolution.
- Background-tab throttling was not measured.
- Claims that Safari/Firefox fingerprinting protection caps the reported core count were not verified.
- No published numbers were found for per-block counting on V8; the overhead figures above are this
  consult's own.

## 6. Sources

- MDN: [`performance.now()`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now) ·
  [`measureUserAgentSpecificMemory`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory) ·
  [JS Self-Profiling](https://developer.mozilla.org/en-US/docs/Web/API/JS_Self-Profiling_API) ·
  [Compute Pressure](https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API)
- Timer precision: [W3C hr-time #56 (Safari 1 ms)](https://github.com/w3c/hr-time/issues/56) ·
  [Firefox bug 1440863](https://bugzilla.mozilla.org/show_bug.cgi?id=1440863)
- Metering overhead: [Titzer, ASPLOS'24](https://arxiv.org/pdf/2403.07973) ·
  [VM Matters (metering dominates eWASM run time)](https://arxiv.org/pdf/2012.01032) ·
  [NEAR #4410 (host call per block is ">order-of-magnitude" slower)](https://github.com/near/nearcore/issues/4410) ·
  [Gryaznov, Wasm gas metering](https://agryaznov.com/posts/wasm-gas-metering/)
- Wasmtime for comparison: [1.0 performance (epoch interruption ~2× cheaper than fuel)](https://bytecodealliance.org/articles/wasmtime-10-performance) ·
  [interrupting execution](https://docs.wasmtime.dev/examples-interrupting-wasm.html) ·
  [#4109](https://github.com/bytecodealliance/wasmtime/issues/4109)
- Tools: [paritytech/wasm-instrument](https://github.com/paritytech/wasm-instrument) ·
  [ewasm/wasm-metering (orphaned)](https://github.com/ewasm/wasm-metering)
