---
phase: 27-demo-ui-driven-by-real-fabric
plan: 6
subsystem: browser-demo
tags: [demo-01, demo-02, ui-spec-4-3, ui-spec-10, g4-open, option-b, p4b, p5-skip, mutation-proof]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract and demo-viewport.e2e.test.ts's 60 combinations)
    - 27-02 (the six-surface shell and the element-id contract)
    - 27-03 (the 91-region catalogue, the twelve primes entries with permanentlyUnavailable,
      and P4b's two inverted arms)
    - 27-04 (demo/render.ts's paintSurfaceAbsence, P5, P6/P7/P8)
    - 27-05 (P5's navigation fix — without it this plan would have hit the same 30 s timeout)
  provides:
    - "packages/browser/demo/surfaces/primes.ts — the Primes formatter, the one on this page
      that takes NO argument, which is the surface's claim in a signature: there is no reading
      to pass it. All twelve regions plus #primes-report out of one record"
    - "the primes panel: twelve regions on screen, ZERO buttons of any class, the section 4.3
      panel and the stated-weakness note written from the module rather than typed in markup"
    - "WIRED_SURFACES gains 'primes' — the first entry that turns on P1b for a surface P5 will
      never drive, and the first name in P5's SKIPPED list that is there by design"
    - "ARG_NOT_DISPATCHED exported from demo-regions.ts — N1/N2 render it permanently, and a
      permanent sentence with two authors is two sentences waiting to differ by a comma"
    - ".citation in demo.css — the visual half of UI-SPEC section 0's cited/measured split"
    - "packages/node/src/demo-primes.e2e.test.ts — the absence asserted across three page
      states, and G4's remaining half MEASURED as a file set that reddens when the gap closes"
  affects:
    - "Plan 27-10 — carries success criterion 5 into 27-OPEN-ITEMS.md and leaves the audit's G4
      row unchanged, because the row is still true"
    - "Plan 27-09 — the second block of cited figures; .citation and its missing contrast
      assertion are logged for it"
    - "any future Option A — P4b and the five-symbol measurement both redden on the day it
      lands, by design"
tech-stack:
  added: []
  patterns:
    - "a formatter with an empty parameter list, as the machine-checkable form of *there is no
      reading here*"
    - "a guard written to FAIL when a gap closes, with a header saying so, rather than a
      sentence in a document saying the gap is open"
    - "a symbol grep split into two measurements — mentions and code-line matches — asserted as
      file SETS, so the red names the file rather than moving a count"
    - "every negative assertion carrying its own floor: the .btn-primary zero is only believed
      after the same selector is shown matching a control one surface over"
key-files:
  created:
    - packages/browser/demo/surfaces/primes.ts
    - packages/node/src/demo-primes.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/demo/demo.css
    - packages/browser/src/demo-regions.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "The section 4.3 panel and the stated-weakness note are written from surfaces/primes.ts
    into empty elements rather than left as static markup. 27-05 removed the lone-tab card's
    static copy for the same reason: a sentence a spec asserts must have one author."
  - "ARG_NOT_DISPATCHED was exported rather than re-typed. On every other surface that copy is
    transient — overwritten with a figure the moment a peer list is discovered — and here it is
    permanent, which is what makes a second author intolerable rather than merely untidy."
  - "'primes' joins WIRED_SURFACES even though P5 will never drive it. Leaving it out would
    also have switched P1b off for twelve regions, so a primes region could silently lose its
    element. A surface that is deliberately absent still has to be there."
  - "The measurement is TWO assertions, not one. The raw mention set caught that the audit's
    'two places only' is now five files; the code-line set is what holds 'zero production
    callers'. One number could not have said both."
  - "N5 and N7 render N3's sentence. UI-SPEC names section 5.3's lone-tab copy and section
    5.1's absence arm for them, and both are composed from a run — under Option B there is no
    run. This decision was taken in 27-03's catalogue and is honoured, not revisited."
metrics:
  duration: ~70 minutes
  tasks: 2
  files-created: 2
  files-modified: 4
  commits: 3
  completed: 2026-08-10
---

# Phase 27 Plan 6: The Primes surface Summary

**This surface is OPEN, not delivered.** Twelve regions render, none of them is a reading, no
button exists, and the plan that shipped it closes nothing: the roadmap calls Primes one of two
load-bearing surfaces and this page still cannot run it. What landed is the *honest rendering*
of that fact plus **four mechanisms that keep it visible** — and every one of the four was
watched failing before it was believed.

The sharpest result is not the surface. It is that the inverting guard has teeth: planting
`runPrimes` onto `window.o2` for ninety seconds turned **sixteen** assertions red across two
files, each naming the region and each ending *the surface must be replanned*.

## The disposition, stated where a reader will find it

Option B, per UI-SPEC section 10, on three facts that are measurements and not inferences:

1. **No signed record vouches for the prime-counting module.** `kernel-record.ts` exports
   `KERNEL_RECORD` and `PI_RECORD` and no third. A tab pins one anchor, so every executor —
   including the tab's own — refuses a prime-counting dispatch for a provenance failure.
2. **`runJob` cannot carry the input.** Its shards are `{ value: { a: i } }`; the kernel reads
   an eight-byte block from `buildPrimesInput(n)`.
3. **Re-signing is not free.** `sign-kernel.ts` discards its private half each run, so a third
   record means a **new trust anchor**, all three records re-signed together, and a change to
   what a stock `o2 agent` and `o2 seed` will run.

**Option A was not begun.** `grep -c 'runPrimes'` returns **0** for both `demo/main.ts` and
`src/tab-api.ts`, and `git status --porcelain packages/demo/src/kernel-record.ts
scripts/sign-kernel.ts` printed nothing — checked before Task 1's commit and again after every
plant restore.

## The twelve regions, read off the screen

Not inferred. `demo-primes.e2e.test.ts` prints every `[data-region]` inside `#s-primes`
verbatim in each of three page states; all three printed **identically**, which is itself the
finding. Below is that output, `⏎` for a newline inside a region.

| # | region | kind | on screen |
|---|---|---|---|
| N1 | `primes/n-arg` | control | `Nothing dispatched yet — this is what would be sent.` |
| N2 | `primes/shards-arg` | control | `Nothing dispatched yet — this is what would be sent.` |
| N3 | `primes/total` | reading | `No count: this workload has no dispatch path from a tab — see above.` |
| N4 | `primes/complete` | reading | as N3 |
| N5 | `primes/reduce-state` | reading | as N3 |
| N6 | `primes/elapsed` | reading | as N3 |
| N7 | `primes/attestation` | reading | as N3 |
| N8 | `primes/egress` | reading | as N3 |
| N9 | `primes/per-shard` | reading | `No per-shard counts: the reading this page receives carries the total and not the shard rows.` |
| N10 | `primes/oracle-table` | **cited** | `x  the count of primes below x ⏎ 10⁴ 1229 ⏎ 10⁵ 9592 ⏎ 10⁶ 78498 ⏎ 10⁷ 664579 ⏎ ⏎ Published in the mathematical literature; not computed here. ⏎ ⏎ The prime-counting module in this repository was measured against all four of these values and matched every one — recorded in docs/perf/prime-and-pi-benchmarks.md, under guest throughput. That was a Node process on one machine, in a run made elsewhere and at another time. It was not this tab, and no part of this screen is a reading from this tab.` |
| N11 | `primes/oracle-compare` | reading | as N3 |
| N12 | `primes/max-n` | **constant** | `2147483647 — @o2/demo.PRIME_MAX_N` |

Plus `primes/report`, the surface's one text view, carrying the same content out of the same
record — thirteen elements in the panel, twelve of them declared figures.

**Six of the eight readings share one sentence**, and that is UI-SPEC's own instruction: its
table says *"as N3"* on N4, N6, N8 and N11, and 27-03's catalogue extended it to N5 and N7
because UI-SPEC names an Option A arm for each of those (section 5.3's lone-tab copy, section
5.1's absence arm) and neither can occur when nothing ran. N9 is the exception and has to be:
its reason is different — the field does not exist on any reading, so there is nothing to wait
for.

**Every figure on screen is `cited` or `constant`.** The only numbers in `#s-primes` are the
four published counts and `PRIME_MAX_N`, both inside declared regions with their provenance in
the same region. P2 — no undeclared digit inside `#main` — stayed green.

## The four open-recording mechanisms, each with the evidence it works

### 1. The inverting guard — P4b, and it fired sixteen times

`window.o2.runPrimes` was planted as a stub on the `api` object in `demo/main.ts` (one hunk,
`git diff -U0 | grep -c '^@@'` = 1). Exit **1**, `Tests 2 failed | 26 passed (28)`.

**Both of P4b's arms fired** — the catalogue-quantified one and the DOM-quantified one — eight
entries each:

```
FAIL |e2e| demo-regions.e2e.test.ts > P4b — every permanently-unavailable reading names a method window.o2 does NOT have
+   "primes/total names TabApi.runPrimes(): the dispatch path this surface was told it does not have now exists — the surface must be replanned",
    … primes/complete, primes/reduce-state, primes/elapsed, primes/attestation,
      primes/egress, primes/per-shard, primes/oracle-compare …
+   "primes/total's data-source names TabApi.runPrimes(): the dispatch path this surface was told it does not have now exists — the surface must be replanned",
    … the same eight again, off the page rather than off the catalogue …
```

And this plan's own arm, in the file a reader opens when asking *why is this surface empty*:

```
FAIL |e2e| demo-primes.e2e.test.ts > P4, inverted — window.o2 has no runPrimes, and the day it does this surface is replanned
AssertionError: before any node: the dispatch path this surface was told it does not have now exists — Option A has become available and the Primes surface must be replanned: expected [ 'runPrimes', 'onChange', …(30) ] to not include 'runPrimes'
```

**The DOM arm was vacuous for primes until this plan.** 27-03 wrote both arms and only the
catalogue one could fire, because there were no primes elements on the page to iterate. Wiring
the surface is what made the second arm real, and the plant is what proved it.

Restored by the surgical inverse of the edit; `cmp` against the pre-plant snapshot exit **0**;
`grep -c runPrimes` back to 0 in both files.

### 2. The grep that notices the gap closing — planted, and it named the file

`demo-primes.e2e.test.ts`'s second describe greps `packages/` and `tools/` for `*.ts`,
excluding `*.test.ts`, `*.node.test.ts`, `*.browser.test.ts`, `*.e2e.test.ts`, `*.perf.test.ts`,
`dist/`, `node_modules/` and `coverage/`, for the five symbols. Its header states it is expected
to pass today and **expected to FAIL** the day somebody wires the workload.

**Observed 2026-08-10** — recorded as numbers and as sets, which is the acceptance criterion:

```
[G4·primes] 17 match(es) of 5 symbols across 5 file(s), over packages/ and tools/, tests excluded:
  packages/browser/demo/surfaces/primes.ts: 4 match(es), 0 on a code line — this surface's own header
  packages/browser/src/demo-regions.ts:     1 match,     0 on a code line — the Option B decision block
  packages/demo/src/index.ts:               5 match(es), 5 on a code line — the barrel's re-export
  packages/demo/src/pi.ts:                  1 match,     0 on a code line — one doc comment
  packages/demo/src/primes.ts:              6 match(es), 6 on a code line — the definitions
[G4·primes] 11 code-line match(es) in 2 file(s): packages/demo/src/index.ts, packages/demo/src/primes.ts
[G4·primes] production callers: 0
```

**The plant.** A throwaway `packages/browser/src/plant-primes-caller.ts` with a real import and
a real call. Exit **1**, `Tests 2 failed | 1 passed | 8 skipped (11)`. **Both** arms red, and
both named the file:

```
AssertionError: a file outside the expected set names one of the five primes symbols. …
+   "packages/browser/src/plant-primes-caller.ts",

AssertionError: a production caller of the primes workload now exists. This is G4's primes half
closing, which is good news and a red here on purpose … Replan the surface before making this green
+   "packages/browser/src/plant-primes-caller.ts:3  import { buildPrimesInput } from '@o2/demo'",
+   "packages/browser/src/plant-primes-caller.ts:5  export const PLANTED_INPUT_BYTES: number = buildPrimesInput(1000).length",
```

Restored by deleting the file it created; `git status --porcelain` clean; the measurement
re-run green, `production callers: 0`, exit **0**.

**Why two assertions and not one.** The raw mention set is what noticed that the audit's *"two
places only"* has become five files — two later plans now name the symbols in prose while
explaining why nothing calls them. The code-line set is what actually holds *zero production
callers*. A single count could not have said both, and the discrepancy is logged rather than
smoothed: the audit's **conclusion** is still exactly true and its **arithmetic** is stale.

### 3. Success criterion 5, marked `(OPEN)`

Recorded in the section below, in the words the plan required, with Option A's exact cost stated
and the owner named as the decider. *Descoped is not satisfied; unmeasured is not met.*

### 4. The ledger and roadmap amendment is 27-10's

Not touched here, by instruction. The audit's G4 row is **left unchanged** because the row is
still true.

## P5 skips Primes by name, and the skip is reported rather than silent

Unedited `demo-liveness.e2e.test.ts`, first run after `WIRED_SURFACES` grew:

```
[P5] wired surfaces: session, colouring, pi, primes
[P5] exercised (a primary run control was found and driven): colouring, pi
[P5] skipped (no primary run control on the surface): session, primes
[P5] 27 of 28 reading regions carry a reading after the run
```

Exit **0**, `Tests 6 passed (6)`. **No edit to P5 was needed** — 27-05's navigation fix already
carried it, and a surface with no control needs no navigation. Twenty-eight remains sixteen
colouring plus twelve π; primes contributes none because P5 does not collect regions from a
surface it did not drive, which is correct: those twelve are covered by `demo-primes` instead.

**The skip is only reported, not asserted**, and that gap is logged — P5 cannot notice a
*driven* surface silently becoming an undriven one. `primes` being on the list is asserted
adequately from the other side, by `demo-primes.e2e.test.ts`'s *carries no run control at all*
case, which carries its own floor.

## P6, P7 and P8 did not move, and must not have

| property | 27-05 | 27-06 | why |
|---|---|---|---|
| P6 — a populated figure occurs in its own text view | `examined 4` | **`examined 4`** | primes has no `.n`/`.estimate`/`.totalBytes`/`.verificationMultiplier` reading that is *populated* — every one is at a named absence |
| P7 — a withheld count never appears without its sentence | `examined 2` | **`examined 2`** | `primes/egress` ends `/egress` and is **not populated**, so `isPopulated` filters it out before the count |
| P8 — the attestation region is the fabric's own words | `examined 1` | **`examined 1`** | `primes/attestation` likewise |

All three counts are structural rather than lucky: `isPopulated` compares against the committed
catalogue, and every primes reading equals one of its catalogue sentences by construction. A
primes region that started carrying a real figure would raise these counts, which is another
place the closure of Option A becomes visible.

## No run control, and the assertion has a floor

`#s-primes` contains **zero** `<button>` elements of any class, enabled or disabled. Asserted in
all three states, and — this is the part that matters — only after the same `.btn-primary`
selector is shown matching a control on `#s-colouring` in the same evaluate. A zero produced by
a selector that has stopped matching anything is not a reading about this surface.

The same shape holds the `runPrimes` absence: `o2Keys.length > 20` is asserted first, so an
empty key set cannot satisfy *does not include*.

## The state that could not move it

Three readings, and the third is the arm with teeth:

| state | how it was reached |
|---|---|
| before any node | consent given, `#join` not yet pressed |
| with a node running | `#join` pressed, `state[data-tone]` reached `live` against a real `FabricNode` relay |
| after a colouring run on another surface | `#run` pressed on `#s-colouring`, waited on `#run-report` changing, then back to `#nav-primes` |

The digests of the eight readings are **byte-identical across all three**. A primes reading that
moved when the colouring ladder ran would mean it is wired to something it must not be wired to,
and nothing else in this suite would have noticed: P5 does not collect from surfaces it did not
drive, and it does not drive this one.

## The planted mutations

Three. Each snapshotted with `cp` to the session scratchpad **immediately before** the edit,
restored by **the surgical inverse of that edit** — never `cp` back, never `git stash`, never
`git checkout --` — and verified with `cmp`, `EXIT=$?` read on the line immediately after. Every
`cmp` returned **0**, `git diff -U0 | grep -c '^@@'` returned **1** on each edit plant, and
`git status --porcelain` showed only this plan's own files before and after each.

### Plant A — one region's rendering changed: the surface block red, and P3 with it

`regions[id] = unavailable(id)` → `regions[id] = id === 'primes/total' ? 'No count yet.' :
unavailable(id)`. Exit **1**, `Tests 2 failed | 26 passed (28)`:

```
FAIL |e2e| demo-primes.e2e.test.ts > renders every reading at its unavailable sentence, in all three states, digit-free
AssertionError: expected [ …(3) ] to deeply equal []
+   "before any node: primes/total reads \"No count yet.\" — the catalogue's unavailable sentence is \"No count: this workload has no dispatch path from a tab — see above.\"",
+   "with a node running: …", "after a colouring run on another surface: …"

FAIL |e2e| demo-regions.e2e.test.ts > P3 — every reading region reads the catalogue's sentence for this state, digit-free
+   "primes/total: on screen \"No count yet.\" — the catalogue says \"No count: this workload has no dispatch path from a tab — see above.\""
```

**A second reading came out of this plant, and it settled a doubt worth recording.**
`demo-regions.e2e.test.ts` runs its whole browser block inside `beforeAll` and completes in
about 1.6 s, which looked too fast to have launched a browser at all — and `--reporter=json`
attributes no hook time, so the per-case durations read `0ms` and prove nothing. The plant
reddening P3 with a sentence that only exists on a rendered page is the measurement that the
browser arm is live. It was checked rather than assumed.

### Plant B — a real caller of the primes workload: the measurement red, naming the file

Recorded in full under mechanism 2 above.

### Plant C — `runPrimes` on `window.o2`: sixteen assertions red across two files

Recorded in full under mechanism 1 above.

## Exit codes, read directly

`EXIT=$?` on the line immediately after each command, output redirected to a file and the file
read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `npx tsc --noEmit` after Task 1 | **0** |
| `vitest run --project e2e demo-regions` after Task 1 | **0** — `Tests 17 passed (17)` |
| the same, `--reporter=verbose` | **0** — all 17 named, both describes |
| `vitest run --project e2e demo-viewport` | **0** — `Tests 7 passed (7)`, 8.10 real / 9.93 user / 3.33 sys, ratio 1.64 |
| `vitest run --project e2e demo-liveness`, **P5 unedited** | **0** — `Tests 6 passed (6)`, primes SKIPPED by name, 9.14 real / 19.06 user / 2.72 sys, ratio 2.38 |
| `grep -c runPrimes main.ts tab-api.ts` | **0** and **0** |
| `git status --porcelain kernel-record.ts sign-kernel.ts` | printed nothing |
| `#s-primes` `.btn-primary` count, off the built page | **0** |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e demo-primes`, first run | **0** — `Tests 11 passed (11)`, 8.13 real / 12.34 user / 1.54 sys, ratio 1.71 |
| Plant A (demo-primes + demo-regions) | **1** — `2 failed \| 26 passed (28)`, text above |
| `cmp` after the surgical restore | **0** |
| Plant B (the measurement) | **1** — `2 failed \| 1 passed \| 8 skipped (11)`, file named |
| the measurement after `rm` | **0** — `3 passed \| 8 skipped`, `production callers: 0` |
| Plant C (demo-primes + demo-regions) | **1** — `2 failed \| 26 passed (28)`, 16 P4b entries |
| `cmp` after the surgical restore | **0** |
| `npx tsc --noEmit` after all restores | **0** |
| **the plan's verification set, ×4 files** | **0** — `Tests 41 passed (41)`, 23.87 real / 41.15 user / 7.31 sys, ratio 2.03 |
| `vitest run --project node` requirements-ledger + slow-specs + vocabulary | **0** — `Tests 54 passed (54)` |
| `vitest run --project e2e` built-bundle + colouring-demo + attestation-ui + demo-pi | **0** — `Tests 28 passed (28)`, 33.70 real / 51.09 user / 6.58 sys, ratio 1.71 |
| `git show --stat` after each commit | only this plan's own files |

Every `(user+sys)/real` ratio is above one, so no reading was taken from a starved process. They
are comparability keys, not verdicts.

**`built-bundle.e2e.test.ts` is green**, which is the check that `vite build` resolves
`./surfaces/primes.ts` out of the inline module script and serves it from a dumb static server.
Nothing else in this suite would have caught a bundler dropping that import.

## Deviations from Plan

### `[Rule 3 - blocking] a `.citation` class had to be added to demo.css`

- **Found during:** Task 1. The plan requires N10 *"rendered in the citation treatment
  (`--color-neutral-700`), never in the Heading-size figure treatment a live reading uses"*.
  **No such class existed** — `--color-neutral-700` was on `.card-note` and `.table th` only,
  and `pre` renders in `--color-text`.
- **Fix:** one rule, `.citation { color: var(--color-neutral-700); }`, with a comment stating
  what it is for and citing the 5.87:1 measurement already recorded for that property at a
  *smaller* size. `demo.css` was not in the plan's `files_modified`; the alternative was to
  claim a visual treatment the page did not have.
- **Honest limit:** the contrast block asserts seven named pairs and this is not one of them,
  and nothing asserts the *negative* half — that a `cited` region is not in the live-figure
  treatment. Both logged.

### `[deviation - method] the section 4.3 panel is written from the module, not typed in markup`

`index.html` carries `<p id="primes-absence">` and `<p id="primes-weakness">` empty, filled from
`NO_DISPATCH_PATH` and `STATED_WEAKNESS` at page init. 27-05 removed the lone-tab card's static
copy for the same reason and it applies harder here: a spec asserting a sentence that is typed
into the markup is asserting the markup. Neither paragraph carries a digit, so P2 is unaffected
by their being undeclared, and neither is a region — UI-SPEC section 4.3 says the
stated-weakness panel is prose, and a thirteenth region would move the catalogue's tally of 91.

### `[deviation - scope] ARG_NOT_DISPATCHED was exported, which edits a shared file`

It was a private constant cited only in comments; every control carrying that copy carried a
hand-typed duplicate in the markup. Tolerable while the copy is transient and not tolerable when
it is permanent, which is what N1 and N2 make it. One export, one docblock saying why, no
behaviour change to any other surface.

### `[deviation - method] the measurement is two assertions rather than one`

The plan asks for *"a real grep … assert on the set of files matched"*. Implemented as **two**
sets — every mention, and code-line matches only — because the first alone would have been
satisfied by a caller added to a file already in the set, and the second alone would have missed
the finding that the audit's file count has moved. The plant reddened both.

### `[deviation - scope] Task 2's TDD RED is the plants, not a missing-module error`

The plan orders the surface before the spec, so `demo-primes.e2e.test.ts` was green on its first
run. The RED that carries this task is the three planted mutations, which is what the task's own
acceptance criteria ask for (*"Both plants were watched red"*) — recorded rather than dressed up
as a red-first cycle that did not happen.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-20 | **mitigate — met, and measured** | The surface states its own unavailability in UI-SPEC's words, verbatim, asserted against the exported constant. Zero buttons of any class, asserted with a floor. The measurement keeps G4's open half visible as two file sets and reddened under a planted caller naming the file. Success criterion 5 is marked `(OPEN)` below. |
| T-27-21 | **mitigate — met** | No control ships. `#s-primes` holds zero `<button>` elements in all three states. `grep -c runPrimes` is 0 in `main.ts` and `tab-api.ts`. |
| T-27-22 | **mitigate — met** | N10 is `cited`, renders in `.citation` (`--color-neutral-700`) rather than the live-figure treatment, and its provenance — *published in the mathematical literature; not computed here*, plus *it was not this tab* — is inside the same region as the four counts, so a figure cannot be lifted out without it. |
| T-27-23 | **accept — and the acceptance is visible** | Option A was not begun: `kernel-record.ts` and `sign-kernel.ts` are untouched, checked by `git status --porcelain` before the first commit and after every plant restore. The row's whole purpose is that the decision is stated rather than implied, and criterion 5 below names the owner as its decider. |

## Known Stubs

**One text-view stub was removed and one class of stub was deliberately created.**

- `#primes-report`'s literal *"Nothing to report: this surface has not been wired to a reading
  yet"* is gone; it now carries the surface's whole content out of the record.
- **The eight reading regions are permanent named absences, and they are not stubs.** A stub is
  a placeholder that will be replaced; these sentences are the surface's finding. They are
  flagged here anyway, because a future reader scanning for stub patterns will find eight
  regions that never carry a value, and the distinction has to be written down somewhere: the
  region is complete, the *workload* is open. Criterion 5 below is where that is recorded.
- The two remaining text-view stubs from 27-02 (`#byo-report`, `#fabric-report`) are unchanged.

## What is NOT done

- **The Primes workload still has no runnable path from a browser tab.** This is the headline
  and it is criterion 5 below.
- **51 → 39 regions still have no element.** Three surfaces remain: bring-your-own, fabric state
  and Benchmarks.
- **P5's skip list is reported and not asserted.** Logged.
- **`.citation` has no contrast assertion and no negative property.** Logged.
- **The audit's G4 row is arithmetically stale** (*"two places only"* is now five files) while
  its conclusion holds. Logged; the row is deliberately **not** edited, per instruction.
- **Only Chromium.** Every `e2e` spec here launches chromium alone; the project's limit.
- **UI-SPEC is not edited.** Nothing new is owed by this plan beyond what 27-03 recorded for N5
  and N7.
- **STATE.md and ROADMAP.md were deliberately not touched**, and no `gsd-sdk query state.*` or
  `roadmap.*` verb was run — the operator's instruction for this plan forbids them.

## Success criteria

1. **Met.** The surface states in plain words that this workload has no dispatch path from a
   browser tab, and carries no run control at all — zero `<button>` elements of any class in all
   three states, asserted with a floor.
2. **Met.** All twelve regions render; every figure shown is `cited` or `constant` with its
   provenance in the same region; every reading is at its catalogue `unavailable` sentence,
   digit-free, in all three states.
3. **Met.** `window.o2` has no `runPrimes`, asserted in this file and in P4b's two arms.
   Demonstrated by plant: sixteen assertions red the moment the key appeared.
4. **Met.** G4's remaining half measured from the demo's side, recorded as numbers and as file
   sets: **17 mentions across 5 files, 11 code-line matches in 2 files, 0 production callers**,
   2026-08-10. Demonstrated by plant: both sets red, naming the file and the lines.

### 5. *(OPEN)* — and this is the plan's real result

**The Primes workload has no runnable path from a browser tab.** The roadmap calls Primes one of
two load-bearing surfaces and this plan does not make it run anything. Audit finding **G4's
primes half stays open**, with Option B recorded as the reason.

**Option A, and its exact cost:** extend `scripts/sign-kernel.ts` to sign `primes.wasm`;
regenerate `packages/demo/src/kernel-record.ts` with three records **under a new
`KERNEL_TRUST_ANCHOR`**, because the script discards its private half each run and the existing
records cannot be extended; add `TabApi.runPrimes({n, shards, redundancy, peerIds})` mirroring
`runPi` — map with `buildPrimesInput`, reduce over `PRIME_COUNT_KEY` with `projectPrimeCount`,
read the total back out of the store. Roughly sixty lines in `main.ts`, one interface member,
one build-time script change. **It changes what a stock `o2 agent` and a stock `o2 seed` will
run**, because both default to that anchor, and it is outside `27-CONTEXT.md`'s statement that
*"every API it consumes exists"* — a statement that should then be corrected rather than quietly
outgrown.

**It is an unowned owner decision.** It touches the trust root of the fabric; it was surfaced
separately and is not this plan's to take. *Descoped is not satisfied; unmeasured is not met.*

Plan 27-10 carries this into `27-OPEN-ITEMS.md` and **leaves the audit's G4 row unchanged**,
because the row is still true.

## Commits

| hash | what |
|---|---|
| `1b4170b` | `feat(27-06)` — the Primes surface as a named absence: twelve regions, no run control |
| `f6a4a53` | `test(27-06)` — the absence asserted, and G4's open half measured from the demo's side |
| *(this file)* | `docs(27-06)` — the summary and four deferred items |

Each committed with `git commit -m "…" -- <explicit paths>`, `-m` before `--`, and each verified
with `git show --stat` to contain only this plan's own files.

## Self-Check: PASSED

- `packages/browser/demo/surfaces/primes.ts` — FOUND, **262 lines** (`min_lines: 110`),
  `no dispatch path` present ×2, `prime-and-pi-benchmarks` present
- `packages/node/src/demo-primes.e2e.test.ts` — FOUND, **565 lines** (`min_lines: 140`),
  `runPrimes` present ×5, `buildPrimesInput` present ×3
- `packages/browser/demo/index.html` — FOUND, modified
- `packages/browser/demo/demo.css` — FOUND, modified
- `packages/browser/src/demo-regions.ts` — FOUND, modified
- `deferred-items.md` — FOUND, four entries appended, diff is **77 insertions, 0 deletions**
- commits `1b4170b`, `f6a4a53` — both FOUND
- `git status --porcelain` after every plant restore — only this plan's own files; every `cmp`
  exit **0**; `packages/browser/src/plant-primes-caller.ts` absent
