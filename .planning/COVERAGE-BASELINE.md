# Coverage baseline — first measurement

> **Re-measured 2026-07-29, and the first figures were an artefact.** The original run reported
> 75.62 % overall and 70.38 % for `packages/node/src`. A later run read 54.94 % for that package
> on code where nothing covered had changed — the whole 15-point swing was
> `mutation-guard.mutate.ts` reading 0 of 85 statements. It is the driver behind
> `npm run test:mutations`, deliberately not a `*.test.ts` because it rewrites source while
> vitest runs files in parallel, so no spec loads it and the v8 provider scored it zero.
> `**/*.mutate.ts` is now excluded with that reason recorded in `vitest.config.ts`, and the
> table above is the honest re-measurement. **The tool that measures the guards is not itself
> one of the guards.**
>
> Also corrected: the two orphaned busy-wait loops named in `conditions` below were killed on
> 2026-07-29. They were leftovers from a Claude Code session whose own
> `kill %1 %2 %3 %4` could not work in a non-interactive `zsh -c`, and they had burned ~2 of 8
> cores for 3 days 19 hours. Any timing recorded here or in the perf baseline predates that.


**Date:** 2026-07-29
**Tooling:** `@vitest/coverage-v8@4.1.10` (pinned to the installed `vitest@4.1.10`), provider `v8`
**Command:**

```
npm run test:coverage      # → vitest run --project node --coverage
```

Result of that command: **75 test files, 1080 tests, all passing**, 210.65 s.

Coverage has never been measured on this project before. **These numbers are a
finding, not a target.** Nothing in this file is a threshold, and
`vitest.config.ts` deliberately declares no `thresholds` block — see
[What a floor would have to be](#what-a-floor-would-have-to-be).

---

## Headline

> **Re-measured 2026-08-19, at the point v1.1 closed 15/15 phases and 50/50 requirements —
> and the first finding is that this command had been failing for two weeks.**
> `npm run test:coverage` exited **1**, while `--project node` on the identical tree passed
> **2961 of 2961**. Five cases in `colouring-surface.node.test.ts`'s formatter block cost
> 11 402, 7 763, 6 588, 13 716 and 7 155 ms under V8 instrumentation and all five failed on
> vitest's 5 000 ms **default**. The run's own `(user+sys)/real` was **1.375** — squarely
> healthy — so it was instrument overhead, not host starvation and not a regression: the same
> nineteen cases cost 7.25 s uninstrumented against a recorded span of 6 296 ms. Fixed at
> `dce7d80` by sizing the whole block against the measurement rather than the five that
> happened to fail. **Nobody knew, because the measurement below this one is dated
> 2026-08-04 and predates 117 of the current 197 spec files.** A guard nothing runs is a
> guard that has stopped guarding, and this file is where that would have been visible.
>
> After the fix: **EXIT=0, 197 files, 2961 passed, 1 skipped**, 570.86 s.
>
> | metric | covered / total | % |
> |---|--:|--:|
> | statements | 7 571 / 10 152 | **74.57 %** |
> | branches | 4 348 / 6 235 | 69.73 % |
> | functions | 1 346 / 1 856 | 72.52 % |
> | lines | 6 769 / 8 932 | 75.78 % |
>
> **This is NOT a fall from the 78.62 % below it, and reading it as one is the mistake this
> paragraph exists to prevent.** The instrumented denominator went from 4 378 statements to
> 10 152 as the tree grew from 80 spec files to 197. The two populations are not comparable
> file-for-file, and no single number spans them.
>
> | package | statements | % |
> |---|--:|--:|
> | `aot/src` | 358 / 375 | 95.47 % |
> | `libp2p/src` | 363 / 383 | 94.78 % |
> | `demo/src` | 206 / 218 | 94.50 % |
> | `core/src` | 2 628 / 2 809 | 93.56 % |
> | `net/src` | 1 366 / 1 480 | 92.30 % |
> | `bench/src` | 317 / 401 | 79.05 % |
> | `tools/aot` | 627 / 913 | 68.67 % |
> | `node/src` | 1 394 / 2 634 | 52.92 % |
> | `browser/src` | 312 / 939 | 33.23 % |
>
> **The bottom two are the artefact this file has warned about since 2026-08-04, now
> quantified rather than asserted.** Coverage instruments the `node` project only, so a module
> exercised by the `browser` or `e2e` projects reads zero while being genuinely tested. Five
> files carry it: `bin/bench.ts` **0 / 619**, `bin/agent.ts` **0 / 302**, `bin/seed.ts`
> **0 / 58** — all three driven by spawned-process e2e specs — plus `browser-node.ts`
> **2 / 199** and `synthetic-artifact.ts` **0 / 98**, covered by the browser project's 5 169
> tests. Those five are **1 276 of the 2 581 uncovered statements, 49 % of the entire
> shortfall, in five files out of the whole tree.** The logic that is in the instrumented
> project's jurisdiction sits at 92–95 %.
>
> Still deliberately **no `thresholds` block**. A floor is a separate act taken against a
> number that exists, and it would have to be stated per package to mean anything at all —
> one figure spanning `core/src` at 93.56 % and `browser/src` at 33.23 % would certify a real
> regression in the first as passing.


> **Re-measured 2026-07-30, after the second bug group landed** (B08–B14). The `node`
> project reads **78.62 %** statements (3442 / 4378) / 76.86 % branches (1910 / 2485) /
> 78.79 % functions (669 / 849) / 80.53 % lines (3065 / 3806) over **80 test files,
> 1188 tests, all passing**, 206.48 s. Instrument and command unchanged.
>
> This one was re-measured rather than assumed for a specific reason: B08–B14 **deleted**
> a block in `packages/core/src/job/verify.ts` whose lines the suite executed on every
> run and never falsified — a commitment recomputed from the two values it was minted
> from, so both of its failure branches were unreachable while every statement in them
> counted as covered. Removing covered statements moves numerator and denominator
> together, so it cannot raise a figure below 100 %; `verify.ts` now reads **33 / 33**
> and `packages/core/src/job` **98.94 %**. The rise is elsewhere and is new tests, not
> the deletion: `fabric-node.ts` 100 % (start-unwind), `libp2p-transport.ts` 94 %
> (the per-peer accumulation budget), `coordinator.ts` 96.25 %, `enrollment.ts`
> 92.64 %, `wasm.ts` 86.76 %.
>
> Two figures that did **not** move and are the same artefact this file already records:
> `browser-node.ts` stays at **0 / 69** — its unwind is covered by construction review
> only, because `BrowserNode.start` needs a real `indexedDB` and a relay to dial and runs
> in neither instrumented project — and `seed-server.ts` at 54.28 % is bounded by the
> same reach. Neither is evidence the code is untested; both are evidence of where the
> instrument stops.
>
> **Re-measured 2026-07-30, after the wall-clock execution deadline landed** (B03/B06).
> The `node` project now reads **77.96 %** statements / 76.00 % branches / 78.05 %
> functions / 79.90 % lines over **79 test files, 1157 tests, all passing**, 227.26 s.
>
> It moved *up*, and the reason is worth recording because the prediction was that it
> would move down: two new modules read **0 %** and both are correct at 0 %.
> `packages/core/src/executor/task-run.ts` and
> `packages/node/src/task-executor.worker-thread.ts` execute **inside a worker thread**,
> which the v8 provider does not instrument — the same blindness `task-worker.ts` has
> always had, and the same class of artefact this file already records for
> `*.mutate.ts`. Their statements are genuinely exercised, by
> `worker-executor.browser.test.ts` and `execution-deadline.node.test.ts`, in a place
> the instrument cannot see. The rise comes from `fabric-node.ts` and
> `worker-executor.ts` gaining covered lines that outweigh them.
>
> The 2026-07-29 table below is left exactly as measured. **A baseline that is edited
> to match the present is not a baseline.**

| Metric | Covered / total | % |
|---|---|---|
| Statements | 3285 / 4270 | **76.93** |
| Branches | 1849 / 2446 | **75.59** |
| Functions | 636 / 816 | **77.94** |
| Lines | 2925 / 3709 | **78.86** |

**Read this with the scope caveat below.** The headline is the `node` project only.
It is a floor on the repository's real coverage, not an estimate of it.

---

## Per-package numbers

Directory rollups exactly as the v8 reporter emitted them.

| Package | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| `packages/aot/src` | 94.70 | 84.38 | 92.18 | 94.33 |
| `packages/bench/src` | 50.00 | 53.84 | 55.38 | 50.00 |
| `packages/browser/src` | 26.64 | 37.70 | 25.66 | 26.41 |
| `packages/core/src` | 95.30 | 91.45 | 98.57 | 97.78 |
| `packages/core/src/canonical` | 100 | 96.15 | 100 | 100 |
| `packages/core/src/executor` | 67.46 | 55.17 | 53.33 | 73.68 |
| `packages/core/src/job` | 97.52 | 90.56 | 100 | 97.16 |
| `packages/core/src/transport` | 97.22 | 90 | 100 | 100 |
| `packages/demo/src` | 98.52 | 80.24 | 100 | 100 |
| `packages/libp2p/src` | 91.72 | 75.47 | 90.90 | 92.62 |
| `packages/net/src` | 87.79 | 79.76 | 95.37 | 95.57 |
| `packages/node/src` | 72.97 | 66.02 | 72.60 | 73.36 |
| `packages/node/src/bin` | 0 | 0 | 0 | 0 |
| `tools/aot` | 86.68 | 74.58 | 93.10 | 88.69 |

The kernel — `packages/core` — is the strongest tier at 95.30 / 91.45, and its
`canonical` encoder is at 100 % statements with one uncovered branch. That is the
right shape for this repository: the code whose determinism the whole integrity
argument rests on is the code most covered.

---

## Scope caveat — the instrument cannot reach two of the three projects

`test:coverage` runs the **`node` project only**, and that is a measured
constraint rather than a choice.

Running `vitest run --project node --project browser --coverage` fails. The v8
coverage provider collects through the Chrome DevTools Protocol, and with firefox
and webkit in the matrix the run produced **212 instances** of:

```
Error: browserContext.newCDPSession: CDP session is only available in Chromium
```

and wrote **no coverage report at all** — `coverage/` did not exist afterwards.
Firefox also timed out under the added instrumentation overhead
(`kernel.test.ts`, 15000 ms). So browser-tier coverage is not merely unmeasured,
it is unmeasurable with this provider while the portability matrix is in place.
Between the two, the portability matrix is worth more than the coverage percentage.

**Consequence:** every source file whose only tests live in `*.browser.test.ts` or
`*.e2e.test.ts` reads 0 % here while being genuinely tested. `packages/browser/src`
at 26.64 % is almost entirely this artefact, and `packages/node/src/bin` at 0 % is
entirely this artefact.

### The 15 files at 0 % statements, classified

Each was checked by grepping for the module name across the browser and e2e specs.
Two categories, and only the second is a gap.

**A — tested, but by a project this instrument cannot reach (11 files):**

| File | Stmts | Reached by |
|---|---:|---|
| `packages/browser/src/idb-blockstore.ts` | 26 | `idb-blockstore.browser.test.ts` |
| `packages/browser/src/streaming-load.ts` | 119 | `streaming-load.browser.test.ts`, `code-cache.e2e.test.ts` |
| `packages/browser/src/synthetic-artifact.ts` | 51 | `streaming-load.browser.test.ts`, `code-cache.e2e.test.ts` |
| `packages/browser/src/worker-executor.ts` | 58 | `worker-executor.browser.test.ts` |
| `packages/browser/src/wasm-probes.ts` | 23 | `worker-executor.browser.test.ts` |
| `packages/browser/src/task-executor.worker.ts` | 17 | `worker-executor.browser.test.ts` |
| `packages/core/src/executor/task-worker.ts` | 20 | `worker.browser.test.ts` |
| `packages/node/src/seed-server.ts` | 59 | `seed-discovery.e2e.test.ts` |
| `packages/node/src/bin/bench.ts` | 161 | `e2e`, plus source-text assertions in `bench-egress.node.test.ts` |
| `packages/node/src/bin/agent.ts` | 16 | `e2e` |
| `packages/node/src/bin/seed.ts` | 31 | `e2e` |

`packages/browser/src/worker-factory.ts` (1 statement) is a twelfth, structural
case: it imports `./task-executor.worker.ts?worker`, which is Vite-only syntax, so
by construction it cannot be loaded outside a bundler. Its own doc comment says so.

**B — genuinely untested (3 files):**

| File | Stmts | Note |
|---|---:|---|
| `packages/browser/src/browser-node.ts` | **58** | See below — this is the recorded four-phase debt |
| `packages/bench/src/perf-gate.ts` | 51 | New, still untracked at measurement time; its spec does not exist yet |
| `packages/bench/src/perf-workload.ts` | 72 | Same. These two are why `packages/bench/src` reads 50 % |

### `browser-node.ts` — coverage independently confirms a known debt

> **Both claims below expired, and are corrected here on 2026-08-01 rather than
> deleted, because what the measurement found was real when it was taken.** The
> root cause was retired in the source by Plan 15-05, and the grep was re-run.

`ROADMAP.md`'s Phase 19 constraints record four items deferred for want of a
multi-browser environment. Their shared root cause was recorded as *"`BrowserNode.start()`
needs a real `indexedDB` and a relay to dial, so it runs in **neither** vitest
project"* — **false, and now corrected in `ROADMAP.md` and `REQUIREMENTS.md`**: the
`browser` project cannot host such a test because a Circuit Relay v2 server does not
run in a browser, but the `e2e` project can and needs no relay.

**The grep no longer says what it said.** At measurement time no test file imported
`@o2/browser`, imported `./browser-node`, or constructed a `BrowserNode`. Re-run
2026-08-01: `packages/browser/src/start-unwind.browser.test.ts:2` imports
`BrowserNode` and starts it to success in three engines, and
`packages/node/src/browser-capability.e2e.test.ts` drives the factory in a live tab.

So `browser-node.ts` at 0/58 statements **was** a genuine gap and not an instrument
artefact — it was the single largest one this measurement found. It is no longer 0,
and this document does not say what it is now: coverage has not been re-measured
since 2026-07-29, and quoting a number nobody took is the error this whole file is
supposed to be evidence against. The figure in the table above is the 2026-07-29
reading and should be read with its date.

---

## Exclusions, and why each one

Declared in `vitest.config.ts` under `test.coverage.exclude`.

| Pattern | Reason |
|---|---|
| `**/*.test.ts` | Test files measure; they are not the thing measured. A test file is by construction fully executed by its own run, so counting them inflates every number. |
| `**/index.ts` | Re-export barrels. **Verified by reading all eight** (`aot`, `bench`, `browser`, `core`, `demo`, `libp2p`, `net`, `node`): every statement is `export … from`. No branch, no behaviour. A barrel reads 100 % or 0 % purely on whether something imported it, and neither number means anything. |
| `**/*fixture*.ts`, `**/fixtures/**` | Test inputs, not tested logic. A fixture's correctness is asserted by the tests that consume it; covering the fixture itself measures nothing. |
| `**/*.d.ts` | Declarations emit no runtime code, so there is nothing to execute. |
| `**/kernel-bytes.ts`, `**/wasi-fixture-bytes.ts` | Generated byte blobs — `Uint8Array` literals of compiled WASM emitted by a build script. No logic to cover, and their size would dominate any line count they appeared in. |

`coverage.include` is set explicitly to `packages/*/src/**/*.ts` and
`tools/**/*.ts`. Without it the v8 provider reports only files a test happened to
load, so a source file with no test at all vanishes from the denominator and the
percentage flatters itself. The zeros above exist *because* `include` is pinned.

---

## What a floor would have to be

**No threshold is set, deliberately.** A floor chosen before anyone had seen the
number would be arbitrary in both directions — high enough to block work that is
fine, or low enough to certify a regression as passing. Setting one is a separate
deliberate act, taken against a number that now exists.

When that act happens, three things follow from the measurement above:

1. **A single global floor would encode the instrument's blind spot as a quality
   target.** 76.93 % mixes "untested" with "tested by a project CDP cannot reach".
   Ratchet the global number and the cheapest way to satisfy it is to delete a
   browser-only module's Node-side siblings, which makes the repository worse.
   Prefer per-package floors on the packages the `node` project genuinely covers:
   `core`, `net`, `aot`, `demo`, `libp2p`, `tools/aot`.

2. **Set each floor a few points under its measured value, not at it.** Coverage
   drifts by a percent or two on unrelated edits, and a floor that equals the
   measurement turns every such edit into a red build. From the table above, floors
   of roughly `core` 93 / 89, `net` 85 / 77, `aot` 92 / 82, `tools/aot` 84 / 72
   (statements / branches) would sit just below today's numbers.

3. **Do not floor `packages/browser` or `packages/node/src/bin` on this
   instrument.** Their real coverage is not visible to it. Flooring them at their
   apparent 26.64 % and 0 % would ratify the artefact.

The honest single-sentence summary of the gap this measurement found:
*the kernel is well covered, the browser tier is unmeasured by construction, and
`browser-node.ts` is genuinely uncovered — which is the debt `ROADMAP.md` line 495
already names.*

---

## Reproducing

```
npm run test:coverage
```

Writes `coverage/coverage-summary.json` and prints the table. `coverage/` is
gitignored; the committed record of a measurement is this file.
