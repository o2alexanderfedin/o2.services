# WASM metering bench (2026-09-29)

The harness behind
[`../2026-09-29-what-a-browser-node-can-measure-about-a-guest.md`](../2026-09-29-what-a-browser-node-can-measure-about-a-guest.md).
It is research code: nothing here is imported by the product, and nothing in CI runs it.

## What is here

| File | What it does |
|---|---|
| `gen.mjs` | Writes five variants of two kernels as WAT: `base` (no metering), `bb` (inline gas deduct + trap per basic block), `bbcall` (one local function call per block, the `wasm-instrument` shape), `instr` (a counter bumped before every instruction, no trap), `host` (an imported JS call per block). The kernels are a xorshift32 accumulate loop and a recursive `fib`. |
| `bench.mjs` | Node/V8: instantiates each variant, times `loop(N)` and `fib(F)` (best of 5), reports ns per loop iteration, `fib` ms and instantiate ms. |
| `index.html`, `probe.js`, `worker-api.js` | Browser probe, run inside a dedicated Worker and on the page: `performance.now()` granularity, `crossOriginIsolated`, `SharedArrayBuffer`, `Profiler`, `PressureObserver`, `deviceMemory`, `performance.memory`, `measureUserAgentSpecificMemory`, plus the `base` / `bb` / `instr` kernels with their final gas used and instruction count. |
| `drive.mjs` | Playwright driver: opens the probe in Chromium, Firefox and WebKit, headless, no COOP/COEP, and prints one JSON line per engine. |

## Run it

From this directory, with the repo's dev dependencies installed (`wabt` and `playwright` are already in
the root `package.json`):

```sh
node gen.mjs
for m in base bb bbcall instr host; do npx wat2wasm k_$m.wat -o k_$m.wasm; done
node bench.mjs                                   # V8 overhead numbers
python3 -m http.server 8765 &                    # plain HTTP, no isolation headers
node drive.mjs                                   # three engines
kill %1
```

The `.wat` and `.wasm` files are generated and are not committed.

## What it showed

- The per-block counter (`gasUsed`) and the per-instruction counter (`cnt`) were identical in Chromium 151,
  Firefox 153 and WebKit 26.5: 4 313 086 554 and 4 430 776 098.
- With a finite budget the `bb` module trapped at the same point on every run (checked on Node/V8).
- `SharedArrayBuffer` and `measureUserAgentSpecificMemory` are undefined in all three engines;
  `Profiler` is absent in Workers.

Machine: one 8-core Apple Silicon Mac. "WebKit" is Playwright's build, not Safari; its 2–5 ms timings sit
at a 1 ms clock resolution and are not reliable.
