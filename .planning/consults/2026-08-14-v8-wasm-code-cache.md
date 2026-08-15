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

---

## RUN 2026-08-14 — the conclusion holds, the mechanism does not

Recorded here as the consult asked. Full apparatus, tables and residuals live in the module
comment of `packages/node/src/code-cache.e2e.test.ts`; this is the verdict on what was asked.

**Flags verified before use, not assumed.** All three exist in this Node's V8 with the semantics
quoted above. In Google Chrome for Testing 151.0.7922.34, `--js-flags` demonstrably reaches the
renderer (`--expose-gc` makes `typeof globalThis.gc` `'function'`, `'undefined'` without it), and
V8 emits `Error: unrecognized flag <name>` for a deliberately bogus flag while emitting nothing
for the wasm-caching flags. `--trace-wasm-compilation-times` does report native code bytes, as
claimed — the per-function `codesize` field.

**The headline prediction was right.** With `--wasm-caching-timeout-ms=0 --wasm-caching-threshold=1`,
500x400 and 250x250 both cache: write on visit 1, all three read events on visit 2. Every one of
the four shapes is a cacheable module, and the trigger policy was the whole obstacle.

**The operative knob is isolated, and it is the timer.** Run separately: `--wasm-caching-timeout-ms=0`
*alone* caches all four. `--wasm-caching-threshold=1` *alone* does not — 500x400 and 250x250 stay
at the 72-byte index-only floor. A ladder on the timer alone gives a monotone, per-shape flip
point: 500x400 caches at 1000 ms but not 2000, 250x250 at 250 ms but not 1000.

**The explanation offered is NOT supported, even though its conclusion was.** The proposed cause was
that TurboFan compile time scales non-linearly with function size, so 400-op functions "finish far
apart" and the bytes trickle. Measured, that is not what happens: 500x400's 500 TurboFan upgrades
total 4 ms of compile time and 250x250's 250 total 1 ms. No individual job is slow. Something keeps
compilation from going quiet inside the window, and it is not per-function TurboFan cost.

**A rival explanation died on the falsifying arm, and is recorded because it fit.** V8's own
accounting puts the committed 2000x100 shape at 1,009,052 B of top-tier code — 9,052 B over the
1,000,000 B `--wasm-caching-hard-threshold`, and the only one of the four to cross it. That
explains every row of the original table. Raising the hard threshold to 2,000,000 left 2000x100
caching, byte-identically at 61,483 B. It does not reach the cache by that door.

**Still open:** why compilation fails to go quiet inside 2000 ms for these shapes. Total top-tier
bytes does not order them either — 500x400 produces more than 1000x150 and is the harder to cache.
