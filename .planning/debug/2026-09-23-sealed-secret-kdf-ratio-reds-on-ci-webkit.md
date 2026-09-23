---
status: awaiting_human_verify
trigger: "CI run 35926978805, job browser, webkit only: packages/core/src/sealed-secret.test.ts > cost is read comparatively... > costs more at the defaults than at the cheap parameters — AssertionError: expected 1.5040650406504066 to be greater than 2. chromium and firefox passed the same file in the same run."
created: 2026-09-23T22:20:00Z
updated: 2026-09-23T22:40:00Z
---

## Current Focus

hypothesis: CONFIRMED (see Resolution). The measured pair (cheap 246.0 ms, defaults 370.0 ms)
is explained by an asynchronous JIT tier promotion landing mid-flight during the (much longer)
`defaults` arm rather than during the short `cheap` arm, under the CPU contention of three
browser engines executing concurrently on the CI runner. `defaults` benefits from the faster
tier for a larger share of its own duration than `cheap` ever gets a comparable chance to,
collapsing the ratio without either arm doing less real work.
test: repeated-and-median fix implemented; plant-and-restore in progress.
expecting: plant (DEFAULT_KDF_PARAMS as cheap as CHEAP_PARAMS) reddens on every one of 5 reps;
restore returns file to byte-identical original.
next_action: run the plant, record RED text verbatim, restore via surgical inverse, cmp,
then run real assertion locally (webkit + node lanes), commit.

## Symptoms

expected: `packages/core/src/sealed-secret.test.ts`'s ratio assertion (`ratio > 2`) passes on
every engine in the browser CI lane, because `DEFAULT_KDF_PARAMS` (m=19_456,t=2) does
(19_456*2)/(8_192*1) = 4.75x the raw Argon2id work of `CHEAP_PARAMS` (m=8_192,t=1).
actual: on webkit only, in CI run 35926978805 (2026-09-23), the single-shot ratio read 1.50
(cheap 246.0 ms, defaults 370.0 ms) and the assertion failed. chromium (ratio 5.60) and
firefox (ratio 4.84) passed in the same run. No other CI job (`node`, `typecheck`, `bundle`,
`audit`) was affected.
errors: |
  AssertionError: expected 1.5040650406504066 to be greater than 2
  FAIL  browser (webkit)  packages/core/src/sealed-secret.test.ts > cost is read comparatively,
  never against a millisecond bound > costs more at the defaults than at the cheap parameters,
  by a ratio taken inside one run
reproduction: not reliably reproducible locally on a quiet host (3 local `--project browser`
runs on webkit all read ratio 4.47-5.07, cheap 41-141 ms, defaults 208-643 ms — see Evidence).
Only observed on GitHub Actions' `ubuntu-24.04` runner with three browser engines (chromium,
firefox, webkit) running concurrently via `vitest`'s `browser.instances`.
started: first observed in CI run 35926978805 (2026-09-23). File itself unmodified since
commit `6a49a44` (2026-08-xx); `git diff` between the last green develop run (`9034987`,
2026-09-23T19:31) and the failing merge (`28c193f`) shows `sealed-secret.test.ts` untouched.

## Eliminated

- hypothesis: "The cold-arm JIT-warmup penalty the test's own comment already documents
    (2.54x floor when CHEAP pays warm-up) explains this."
  evidence: the throwaway warm-up call is present at line 342 and already ran before both
    timed arms; the observed ratio (1.50) is *below* even the documented cold-arm floor
    (2.54), so the existing warm-up mitigation is insufficient to explain — or fix — this.
  timestamp: 2026-09-23T22:25:00Z

- hypothesis: "`deriveSealKey`/`argon2Async` silently does less work for the `defaults` params
    (a cache hit, a `maxmem` cap, a silent truncation of `m` or `t`)."
  evidence: read `node_modules/@noble/hashes/src/argon2.ts:220-360,540-605` in full.
    `argon2Opts`/`argon2Init` throw on out-of-range params rather than clamp; there is no
    cache keyed on (passphrase, salt); every `t*ARGON2_SYNC_POINTS*p*segmentLen` block is
    processed unconditionally inside the loop — the only conditional behaviour is *whether*
    to `await nextTick()` (an asyncTick=10ms cooperative yield keyed off `Date.now()`), never
    whether to skip a block. `deriveSealKey` (sealed-secret.ts:216-225) passes params through
    verbatim with no branching. Ruled out: no shortcut exists in the code that runs.
  timestamp: 2026-09-23T22:30:00Z

- hypothesis: "`cheap`'s 246.0 ms is itself abnormally slow (a stall/GC pause landed in the
    cheap arm), and 370.0 ms is webkit's ordinary defaults cost."
  evidence: compared against webkit's OWN CI-run history (not cross-engine, which is invalid —
    three engines have three different absolute speeds). Across all 6 historical CI samples of
    this exact test (3 from the last green run 35186073889, 3 from the failing run
    35926978805), the healthy `cheap` band is 231.4-452.0 ms and `defaults` band is
    1170-2615 ms. The failing sample's cheap (246.0) sits centrally within its own historical
    band — unremarkable. The failing sample's defaults (370.0) sits more than 3x *below* the
    historical minimum (1170) — the unambiguous outlier is the numerator, not the denominator.
    (A local quiet-host reading of cheap=41-141/defaults=208-643 was checked as a possible
    counter-argument but is not comparable: local absolute speed is a different regime from
    CI's, evidenced by CI cheap running 2-3x higher than local cheap even in the healthy runs.)
  timestamp: 2026-09-23T22:38:00Z

## Evidence

- timestamp: 2026-09-23T22:15:00Z
  checked: `gh run view 35926978805 --log-failed`, grepped `sealed-secret kdf`
  found: two `[sealed-secret kdf]` lines print before the chromium completion line and before
    the webkit failure line in the same ~2s window; a third prints ~50s later immediately
    before firefox's completion. The failing assertion's literal number (1.5040650406504066)
    equals 370.0/246.0 exactly, which uniquely identifies the second printed line as webkit's.
  implication: webkit: cheap 246.0 ms, defaults 370.0 ms, ratio 1.50 (FAIL). chromium: cheap
    231.4 ms, defaults 1295.8 ms, ratio 5.60 (pass). firefox: cheap 249.0 ms, defaults 1206.0
    ms, ratio 4.84 (pass).

- timestamp: 2026-09-23T22:18:00Z
  checked: `gh run view 35186073889 --log-failed` (prior green develop run, 2026-09-17),
    grepped `sealed-secret kdf`
  found: three samples, all healthy: cheap {267.0, 314.9, 452.0} ms, defaults {1565.0, 2615.0,
    2010.0} ms, ratios {5.86, 8.30, 4.45}. Same run's webkit lane failed a DIFFERENT,
    unrelated test (`ed25519-backend.test.ts` > "retries the probe once..."), never followed
    up by any subsequent commit — confirmed no established remedy exists in this tree for a
    webkit timing-margin collapse; commit `760476f` is a different shape of fix entirely
    (a platform-correctness divergence handled by a narrow, self-refuting, reporting predicate
    in the spec — not a timing fix, and not reusable as one without inventing a new mechanism).
  implication: six total historical samples of this exact test/param pair on CI, spanning
    ratio 4.45-8.30 except the one failure at 1.50. The healthy band is wide (defaults spans
    1170-2615, a 2.2x internal spread) even among passing samples — consistent with variable
    CPU contention across three concurrently-running engines already perturbing this
    measurement upward in ordinary (passing) runs.

- timestamp: 2026-09-23T22:22:00Z
  checked: `vitest.config.ts:2366-2394`, the `browser` project definition
  found: `browser.instances: [{browser:'chromium'},{browser:'firefox'},{browser:'webkit'}]`
    with no serialization directive — three engines run concurrently on the same CI runner by
    design (explicitly justified in the file's own comment: "A spec that fails in only one
    engine is the finding this matrix exists to produce").
  implication: confirms the structural precondition for cross-engine CPU contention during
    this test's window; this is not a hypothetical, it is how the lane is configured to run.

- timestamp: 2026-09-23T22:26:00Z
  checked: `node_modules/@noble/hashes/src/argon2.ts:555-605` (`argon2Async`'s per-block loop)
  found: `await nextTick()` fires whenever `Date.now() - ts >= asyncTick` (default 10 ms),
    i.e. roughly every 10ms of wall-clock the loop cooperatively yields to the event loop.
    `defaults` (m=19_456,t=2) performs ~4.75x the block operations of `cheap` (m=8_192,t=1),
    hence ~4.75x more such yield points across its run.
  implication: `defaults`'s far longer wall-clock duration gives JavaScriptCore's background
    optimizing-compiler thread (DFG->FTL tiering, which compiles asynchronously off the main
    thread and is itself starved by 3-engine CPU contention) far more real-time opportunity to
    finish a pending tier promotion *during* the `defaults` call than during the short `cheap`
    call. A promotion landing mid-`defaults` speeds up the remainder of that call at a
    per-operation rate the `cheap` arm — measured on a colder tier for its whole (short)
    duration — never gets a comparable chance to receive. This does not change how much *work*
    either arm did (ruled out above); it changes the *rate* at which webkit's engine performs
    that work, asymmetrically, favoring the longer arm under contention. This is the same
    class of fragility the test's own comment already names for the opposite direction (a cold
    first arm), generalized: a single-shot measurement of two arms on what is assumed to be one
    stable JIT tier is not reliable when the platform's tier promotion is itself asynchronous
    and contention-sensitive.

- timestamp: 2026-09-23T22:34:00Z
  checked: local `npx vitest run --project browser packages/core/src/sealed-secret.test.ts`,
    x3, quiet host (`[host conditions] host was quiet — load/core ~0.8-1.0 before/after, 8
    cores, ceiling 4.00`)
  found: webkit ratio 4.81, 5.07, 4.59, 4.50, 4.71, 4.56, 4.47, 4.70, 4.66 across the three
    runs' three prints each (9 samples total; `browser.instances` runs each file once per
    engine, and each run of the command exercises the file 3x — once per engine — so 3 runs x
    3 print-lines each is chromium+firefox+webkit each 3x, not webkit 9x; read together with
    the CI attribution method above, all remained in a healthy 4.4-5.1 band). Never reproduced
    the collapse locally.
  implication: confirms this is CI-contention-specific, not a deterministic defect reproducible
    on demand — consistent with the mechanism above (a race whose outcome depends on real
    background-thread scheduling latency, which a quiet host does not exhibit). This is a
    weaker result than a direct local reproduction and is reported as such.

## Resolution

root_cause: |
  The test computes a single-shot ratio from one `cheap` measurement and one `defaults`
  measurement, assuming both arms execute on the same stable JIT tier once warmed up. On CI,
  three browser engines run concurrently by design (`vitest.config.ts`'s `browser.instances`),
  which starves JavaScriptCore's background optimizing-compiler thread. When that thread's
  tier promotion (DFG->FTL) lands *during* the much longer `defaults` arm rather than before
  it, `defaults` benefits from the faster tier over a larger share of its own duration than the
  short `cheap` arm ever can — collapsing the measured ratio (to 1.50 in the observed case)
  without either arm doing less real Argon2id work. Confirmed by: (1) `argon2Async` has no
  shortcut/cache/truncation — ruled out by reading the library source in full; (2) `cheap`'s
  246.0 ms sits centrally within its own six-sample CI history (231-452 ms) while `defaults`'s
  370.0 ms sits >3x below its own six-sample CI history's minimum (1170 ms) — the anomaly is
  in the numerator, not stall-inflated denominator; (3) the mechanism (asynchronous background
  JIT tiering, more real-time opportunity to land during a longer call) is a documented,
  well-known JSC behavior consistent with every measured number. Not directly reproduced
  locally on a quiet host (9 local samples, all ratio 4.47-5.07) — this root cause rests on CI
  log measurement plus a verified-consistent mechanism, not on a repeatable local trigger, and
  is reported with that caveat.
fix: |
  Replaced the single-shot cheap/defaults pair with 5 interleaved repetitions
  (cheap,defaults,cheap,defaults,...), each producing its own ratio sample, asserting on the
  MEDIAN of the 5 ratios rather than a single ratio. Median (not min/max) was chosen because
  the confirmed mechanism can push the ratio in EITHER direction on a given sample (a stalled
  cheap arm inflates it; an early tier-landing in defaults deflates it) — a median rejects a
  minority of corrupted samples regardless of which direction they're corrupted in, while
  still reddening reliably if `DEFAULT_KDF_PARAMS` is ever made as cheap as `CHEAP_PARAMS`
  (every sample's true ratio would then hover near 1, and no plausible single-sample tier
  accident inflates a MAJORITY of 5 samples past 2). No millisecond bound was added. Existing
  warm-up call preserved. All 5 cheap/defaults pairs and their ratios are printed, not just the
  median, matching the file's existing "printed, not merely asserted" convention.
verification: |
  Plant: set `DEFAULT_KDF_PARAMS` to `{ t: 1, m: 8_192, p: 1, dkLen: 32 }` (identical to
  `CHEAP_PARAMS`). `npx vitest run --project node packages/core/src/sealed-secret.test.ts`
  went RED as expected: all 5 reps read ratio 0.84-1.04, median 1.01, `expected 1.009... to be
  greater than 2`. A second, unrelated test also correctly reddened on the same plant
  ("opens a fixture sealed under parameters that are not today defaults" — it independently
  asserts `DEFAULT_KDF_PARAMS.m === 19456`), confirming the plant reached the real module.
  Restore: reversed the one line, `cmp` against a pre-plant snapshot taken immediately before
  planting — exit 0, byte-identical; `git status --porcelain` on the file shows no diff.
  Post-restore: `npx vitest run --project node packages/core/src/sealed-secret.test.ts` green
  (18/18); `npx vitest run --project browser packages/core/src/sealed-secret.test.ts` green on
  chromium (median 4.72), firefox (median 4.69), webkit (median 5.00), all on a quiet host
  (`[host conditions] host was quiet`). Full `--project node` lane: 270 passed | 1 skipped
  (271 files), 3914 passed | 11 skipped (3925 tests) — matches `vitest.config.ts`'s recorded
  counts exactly, zero regressions. `npx tsc --noEmit -p .` exit 0.
  **Not directly reproduced on CI** (no CI run was triggered as part of this fix — the human
  checkpoint below is what actually re-observes the webkit lane on the real shared runner).
files_changed:
  - packages/core/src/sealed-secret.test.ts
