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

`ROADMAP.md` line 495 records four items deferred for want of a multi-browser
environment, with one shared root cause: *"`BrowserNode.start()` needs a real
`indexedDB` and a relay to dial, so it runs in **neither** vitest project."*

Coverage corroborates it from the opposite direction, and a grep confirms the
mechanism: **no test file anywhere in the repository imports `@o2/browser`,
imports `./browser-node`, or constructs a `BrowserNode`.** The four specs that
match the string `BrowserNode` mention it only in prose — e.g.
`serve-agent-hooks.node.test.ts:50`, *"**unmeasured, not met**: `BrowserNode.start`
needs a real `indexedDB` and a…"*.

So `browser-node.ts` at 0/58 statements is not an instrument artefact. It is 58
statements of the browser tier with no runtime execution in any project, and it is
the single largest genuine gap this measurement found.

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
