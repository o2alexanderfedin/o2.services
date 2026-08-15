# Consultation — what governs V8 WASM code caching (Google AI Mode, 2026-08-14)

Asked because AOT-05 closed with a stated open residual: 2000x100 (621,623 B) caches while
500x400 (604,223 B) and 250x250 (189,423 B) do not, at near-identical size and identical total
operation counts, all chained and all heated 60,000 calls. We recorded "the governing variable is
unknown" rather than implying function count was the answer.

## The hypothesis it offers, which is testable rather than plausible

Not function count. **The RATE at which top-tier bytes accumulate, against a quiescence timer.**

- Every wasm function gets its own tier-up budget; Liftoff compiles everything immediately and
  TurboFan recompiles a function only when its budget hits zero.
- V8 accumulates `bytes_since_last_chunk_` (`src/wasm/module-compiler.cc`) as each background
  TurboFan job completes, and flags an intent to cache when it passes `--wasm-caching-threshold`.
- Serialization is then **delayed until quiescence**, governed by `--wasm-caching-timeout-ms=2000`.
- TurboFan compile time scales non-linearly with function size (register allocation, optimisation
  graphs). So 400-op functions finish far apart, the bytes trickle, and the timeout defers or drops
  serialization entirely. 100-op functions finish in a flood and cross the chunk threshold inside
  the window.

## Why this matters more than the answer

**It is falsifiable with one run.** Set `--wasm-caching-timeout-ms=0` (documented as disabling the
delay logic) and `--wasm-caching-threshold=1`. If the rate hypothesis holds, 500x400 and 250x250
should then cache. If they still do not, the hypothesis is dead and function count survives as an
unexplained correlation.

## How to observe the accounting directly instead of inferring it

    chrome --js-flags="--trace-wasm-compilation-times --trace-wasm \
                       --wasm-caching-threshold=1 --wasm-caching-timeout-ms=0"

`--trace-wasm-compilation-times` reports each function's Liftoff -> TurboFan upgrade and the native
code bytes it generated — which is the quantity our measurement has only ever inferred. Trace
events to look for: `WasmCompileTopTier`, `WasmCodeSerialize`.

## Treat as unverified until run

These flag semantics and the source citation are an AI's account. Verify the flags exist on the
Chromium Playwright drives here (`node --v8-options` and `chrome://version`) before building a
claim on them, and record the result either way. The value of this consult is the EXPERIMENT it
makes possible, not the explanation it offers.
