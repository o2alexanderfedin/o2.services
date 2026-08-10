---
phase: 27-demo-ui-driven-by-real-fabric
plan: 4
subsystem: browser-demo
tags: [demo-01, demo-02, ver-06, ver-09, ver-10, data-05, data-06, ui-spec-4-2, p5, liveness, mutation-proof]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract and demo-viewport.e2e.test.ts's 60 combinations)
    - 27-02 (the six-surface shell and the element-id contract)
    - 27-03 (the 91-region catalogue, demo/render.ts's writer, and the guard P5 completes)
  provides:
    - "packages/browser/demo/surfaces/colouring.ts — the pure formatter for UI-SPEC section 4.2:
      format() and formatVerification(), one reading in, one SurfaceRender out, feeding the
      rendered cards and the text view from a single record"
    - "the colouring panel: all 21 of C1-C21 declared and wired, with #run, #run-status,
      #run-report, #verify and #verify-report unchanged in id, label and order"
    - "WIRED_SURFACES gains 'colouring', which turns P1b on for all 21 regions at once"
    - "packages/node/src/demo-liveness.e2e.test.ts — P5, quantified over run controls discovered
      from the DOM, with skipped surfaces named and a minimum-exercised assertion"
    - "packages/node/src/demo-region-properties.ts — P6, P7 and P8 as one implementation, called
      by the stopped-page guard AND by the two-tab run, so they stop being vacuous"
    - "the measured demonstration that demo-regions.e2e.test.ts stays green at 17 passed while
      the whole colouring surface reads as absent — P5's reason for existing, as a reading"
  affects:
    - Plan 27-05 (pi) — its acceptance test is that P5's exercised count rises 1 -> 2 with no
      edit to demo-liveness.e2e.test.ts
    - Plans 27-06 to 27-09 — each appends one line to WIRED_SURFACES and inherits P5, P6, P7, P8
    - "UI-SPEC sections 4.2 and 9 (three further corrections owed, logged in deferred-items.md)"
tech-stack:
  added: []
  patterns:
    - "one surface, one pure formatter: format(state) -> SurfaceRender, no DOM and no window, so
      the purity claim is testable in the node project where document does not exist"
    - "the formatter returns an entry for EVERY region of its surface in every arm, so a region
      cannot keep a value from a previous run — a stale reading is a placeholder that used to be
      true"
    - "a property that reports what it EXAMINED, not only what it found: examined 0 and
      problems [] are the same result to toEqual([]) and are entirely different findings"
    - "run controls discovered from the DOM (#s-<surface> .btn-primary) rather than from a list,
      so a surface that lands later is driven with no edit to the property"
    - "a declared prose caption in place of four undeclared digits — one table caption naming the
      rungs, four digit-free row headers"
key-files:
  created:
    - packages/browser/demo/surfaces/colouring.ts
    - packages/browser/src/colouring-surface.node.test.ts
    - packages/node/src/demo-liveness.e2e.test.ts
    - packages/node/src/demo-region-properties.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/src/demo-regions.ts
    - packages/node/src/demo-regions.e2e.test.ts
    - packages/node/src/mutation-ledger.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "C15's receipt arm renders attestation.description and NOTHING else — not the two-line block
    the text view carries. UI-SPEC section 5.1 asks for the sentence verbatim and P8 compares the
    region against a fresh reading of that exact field; rendering the block would have failed P8
    on the receipt arm while looking like more information."
  - "C10 renders a shape glyph and the status word per cube, in one string. The single-record
    contract makes a region's content a string, so the mockup's coloured swatch DIV grid could
    not survive it. The glyph is a shape rather than a hue and the word is beside it, which is
    what 'colour is never the only carrier' was asking for; the mockup's colour is lost."
  - "The ladder's four rungs are ONE declared prose caption, not four. Labelling each rung card
    `n = 300` would put four undeclared digits inside #main and redden P2; four prose entries
    would be four near-identical catalogue rows. The caption names them in order and the row
    headers are `first rung` through `fourth rung`."
  - "P6, P7 and P8 were EXTRACTED from demo-regions.e2e.test.ts rather than duplicated. That page
    has no relay and no node, so nothing on it is ever populated and all three are vacuous there
    permanently — the extraction is what lets the same three functions run against a page that
    has run. This is an edit to another plan's guard and is recorded as a deviation."
  - "P5b exempts a region whose catalogue entry holds no `unavailable` arm, because there is no
    other sentence for the page to render. Exactly two colouring regions are in that position and
    both are asserted by name in the specific block instead."
  - "The two-tab fixture joins through the page's own #join button reached by ?relay=, not
    through window.o2.start. findPeers is installed by that handler and nothing else, so #peers
    only becomes a live reading down that path — and `2 node(s) computing` is the precondition."
metrics:
  duration: ~75 minutes
  tasks: 3
  files-created: 4
  files-modified: 5
  commits: 3
  completed: 2026-08-10
---

# Phase 27 Plan 4: The Colouring surface, and P5 Summary

All 21 of UI-SPEC section 4.2 are declared, wired and driven by one pure formatter, and **P5
holds**: after a real two-tab run the colouring regions no longer equal their absence text.

The sharpest result is not the surface. It is the plant that measured **why P5 had to exist**:
with `format` returning an empty record — the whole colouring surface rendering nothing after a
real run — `demo-regions.e2e.test.ts` reported `Tests 17 passed (17)` at exit 0. P2, P3 and P4
are satisfied by a page that renders nothing, and that is now a reading rather than an argument.

## Which of C1–C21 render live readings

Taken off the page after the two-tab run, not reasoned about. **20 of 21 carry a reading; the
twenty-first carries its own named `unavailable` arm, correctly.**

**The first draft of this table inferred C1 through C5 from the shipped symbols and from the cube
count, and then said it had read them.** It had not: the spec printed the twelve `reading`
regions and nothing else. The spec now prints the two controls and the three constants too, and
the row below is that output. The inferred figures happened to be right, which is exactly why
the habit is worth catching — a claim that turns out true is still not a measurement.

```
[P5] arguments and constants on screen: cubes-arg=24 · redundancy-arg=2 · budget=5000000 · max-n=8192 · input-bytes=168828
```

| # | region | what it read on the run |
|---|---|---|
| C1 | `colouring/cubes-arg` | `24` — control, refreshed on every discovery round |
| C2 | `colouring/redundancy-arg` | `2` — control |
| C3 | `colouring/budget` | `5000000` — constant, `@o2/demo.DEFAULT_BUDGET` |
| C4 | `colouring/max-n` | `8192` — constant, `@o2/demo.MAX_N` |
| C5 | `colouring/input-bytes` | `168828` — computed in-page from `buildInput(MAX_N, DEFAULT_BUDGET)` |
| C6–C9 | `colouring/rung-300..600` | all four attempted, all four carry `FOUND`/`no answer` with counts and ms |
| C10 | `colouring/cube-grid` | one glyph-and-word per cube, 24 of them |
| C11 | `colouring/status-counts` | `4 found · 0 proved empty · 20 out of budget` |
| C12 | `colouring/best-n` | `500` |
| C13 | `colouring/complete` | `true` |
| C14 | `colouring/verification-multiplier` | `2.00×` (`1.96×` on a second run) |
| C15 | `colouring/attestation` | the absence arm, naming both unaccounted replicas by peer id |
| C16 | `colouring/agreeing` | one line per cube, `no agreement` where empty |
| C17 | `colouring/egress` | `38 frames sent, 31756 byte(s) total. 0 withheld — and this run registered no sovereign data…` (four runs read 38/39/40 frames and 31756–32768 bytes; the frame count is a real per-run quantity, not a fixture) |
| C18 | `colouring/verify-verdict` | `Correct` |
| C19 | `colouring/verify-n` | `500` |
| C20 | `colouring/verify-triples` | `386` |
| C21 | `colouring/verify-violation` | **its `unavailable` sentence** — *No refutation: every triple checked has two colours among its three numbers.* |

C21 is the one region that reads an absence after the run, and that is the right answer: the
colouring was correct, so there is no refutation to name. P5's own count line says
`15 of 16 reading regions carry a reading after the run` — C21 is the sixteenth.

**C15 read the absence arm, not a strength**, and that is a fact about the fixture rather than a
defect: neither tab is enrolled with a certificate issuer, so no replica produced a signed
statement this tab could check. `attestation-ui.e2e.test.ts` is the spec that reads the
*receipt* arm, and it still does — `1 replica`, `1 operator`, `owner-attested`, all four cases
green on the built bundle.

## P6, P7 and P8: they stopped being vacuous, and here is the evidence

They did **not** stop being vacuous where 27-03 left them, and that is the finding.
`demo-regions.e2e.test.ts` runs against a page with no relay and no node. Nothing there is ever
populated, so all three are conditional on a condition that page cannot reach — they were
correct, general, and could not fire, permanently.

So the three bodies moved to `packages/node/src/demo-region-properties.ts` and **both** files
call them. Measured, from the same run, printed by the spec:

| property | on the stopped page | on the two-tab page |
|---|---|---|
| P6 — a populated figure occurs in its own text view | `examined 0`, asserted `toBe(0)` | **`examined 3`** |
| P7 — a withheld count never appears without its sentence | `examined 0`, asserted `toBe(0)` | **`examined 1`** |
| P8 — the attestation region is the fabric's own words | `examined 0`, asserted `toBe(0)` | **`examined 1`**, `hook present` |

The liveness spec asserts `examined > 0` for each, so a future change that stops populating those
fields reddens on the vacuity rather than passing about nothing. Under plant B2 all three
reddened on exactly that assertion — `P6 examined nothing on a page that has run`, and the same
for P7 and P8.

P8's precondition is met: `#run` now publishes `window.__o2LastAttestation`, the hook 27-03 named
as a forcing function. With the hook absent and a populated region, `p8` returns `hookProblem`
naming `window.__o2LastAttestation`.

## P5's form, and the surfaces it discovered

Written over run controls **discovered from the DOM**, never from a list:

```
for each surface in WIRED_SURFACES:  document.getElementById(`s-${surface}`)?.querySelectorAll('.btn-primary')
```

Observed output, verbatim:

```
[P5] wired surfaces: session, colouring
[P5] exercised (a primary run control was found and driven): colouring
[P5] skipped (no primary run control on the surface): session
[P5] 15 of 16 reading regions carry a reading after the run
```

- **Skipped surfaces are named.** `session` has no `#s-session` panel at all, so its `#join`
  button — which *is* a `.btn-primary` — is correctly not discovered as a surface run control.
- **A minimum-exercised assertion:** `expect(exercised.length).toBeGreaterThanOrEqual(1)`, with
  the message *P5 drove no surface at all, so every assertion below is vacuous*.
- **At most one primary per surface** is asserted too: two would make *the* run control ambiguous,
  and a property that guesses can guess wrong.
- `grep -v '^ *[/*]' packages/node/src/demo-liveness.e2e.test.ts | grep -c "'#run'"` returns **0**.
  The string `#run` does not occur in the file at all, in or out of the specific block.

**The 27-05 acceptance criterion:** when π lands with a `.btn-primary` inside `#s-pi` and `'pi'`
in `WIRED_SURFACES`, the exercised line must read `colouring, pi` with no edit to this file. The
one thing that would require an edit is a surface offering two primary controls, and that is
asserted against rather than accommodated.

### Two arms, and one of them is the plan's own addition

- **P5a** — at least one reading on a driven surface differs from *every* catalogue sentence.
- **P5b** — given P5a, no reading still equals its `initial` or its `stopped` sentence. After a
  run on a running node both are untrue, and a region saying either is a survivor.

P5b is what actually catches the plan's nominated plant. The plan says *wire a region to nothing
so it stays absent forever*; because the page paints **stopped** sentences at load (27-03's
stopped-wins rule), the survivor reads its *stopped* sentence, not its *initial* one. A property
written only against `initial` would have missed it.

**P5b's stated exemption:** a region whose catalogue entry holds no `unavailable` arm may fall
back, because the catalogue itself admits there is no other sentence. Exactly two are in that
position today — `colouring/attestation` and `colouring/egress` — and both are asserted by name
in the specific block. Logged, with what would close it.

## The planted mutations

Four arms. Each snapshotted with `cp` to the session scratchpad **immediately before** the edit,
restored by **the surgical inverse of that edit** — never `cp` back, never `git stash`, never
`git checkout --` — and verified with `cmp`, `EXIT=$?` on the line immediately after. **Every
`cmp` returned 0**, and `git status --porcelain` showed only this plan's own intended files
before and after each.

### Plant A — one region wired to nothing: **P5b red and the specific block red, both naming it**

Removed the single line `regions['colouring/verification-multiplier'] = cost`. Exit **1**,
`Tests 2 failed | 4 passed (6)`:

```
FAIL  |e2e| … > drives every run control it can find, names the surfaces it skipped, and leaves no region absent
AssertionError: a reading region survived a real run still saying it had not been run, or that the node is stopped: expected [ Array(1) ] to deeply equal []
+   "colouring/verification-multiplier: on screen \"Not measured: this tab's node is stopped.\" — that is its stopped sentence, and this tab has both run and a running node",

FAIL  |e2e| … > populates the settled rung, the cost, the receipt, the counts and the manifest
+   "colouring/verification-multiplier on screen \"Not measured: this tab's node is stopped.\" — the run produced a reading and the region still reads as absent",
```

### Plant B — the whole surface renders nothing: **the guard stays green, which is the point**

`return { regions: {}, text }` at the end of `format`. Run against **both** specs:

| spec | exit | reading |
|---|---|---|
| `demo-regions.e2e.test.ts` | **0** | `17 passed` — P1, P2, P3, P4 all green over a surface rendering nothing |
| `demo-liveness.e2e.test.ts` | **1** | P5b named **seven** survivors; the specific block named **five**; P7 and P8 reddened on `examined 0` |

That first row is the measurement UI-SPEC section 9 asserts in prose. *P2, P3 and P4 are all
satisfiable by a page that renders nothing* is now a number: seventeen passing tests over a
surface with nothing on it.

P5b's seven, verbatim:

```
+   "colouring/rung-600: on screen \"Not attempted: this tab's node is stopped.\" — that is its stopped sentence, and this tab has both run and a running node",
+   "colouring/cube-grid: on screen \"No per-cube status: this tab's node is stopped.\" …",
+   "colouring/status-counts: on screen \"Not counted: this tab's node is stopped.\" …",
+   "colouring/best-n: on screen \"No settled rung: this tab's node is stopped.\" …",
+   "colouring/complete: on screen \"Not established: this tab's node is stopped.\" …",
+   "colouring/verification-multiplier: on screen \"Not measured: this tab's node is stopped.\" …",
+   "colouring/agreeing: on screen \"No placement: this tab's node is stopped.\" …",
```

**P5a stayed green under plant B, and saying so is the honest reading.** The four verification
regions are written by `formatVerification`, which plant B does not touch, so three of them were
still populated and *at least one region carries a reading* held. P5a is not reachable by
emptying `format` alone.

### Plant B2 — P5a's own arm, reached by a second hunk

Plant B plus `if (!verdict.checked)` → `if (true)`, so the verification card renders its absence
too. Exit **1**, `Tests 5 failed | 1 passed (6)`, `[P5] 0 of 16 reading regions carry a reading
after the run`:

```
FAIL  … > drives every run control it can find …
AssertionError: every reading region on a driven surface still equals one of its named absences — a page that renders nothing satisfies P2, P3 and P4, and this is the property that says so: expected [] to not deeply equal []
FAIL  … > P6 measures something now …: expected 0 to be greater than 0
FAIL  … > P7 measures something now …: expected 0 to be greater than 0
FAIL  … > P8 measures something now …: expected 0 to be greater than 0
```

Both hunks reversed individually; `cmp` against the pre-plant-B snapshot exit **0**.

### Plant C — does `WIRED_SURFACES` gaining `'colouring'` actually do anything: **P1b red**

Removed `data-region="colouring/cubes-arg"` from its `<dd>`. A `control` region the writer never
paints at load, chosen for 27-03's reason: deleting a *painted* region's element makes the writer
throw during page load and the suite fails in `beforeAll` instead, which is a stronger guard and
is **not P1b**. Exit **1**, `Tests 1 failed | 16 passed (17)`:

```
FAIL  |e2e| … > P1b — every catalogue entry of a wired surface resolves to exactly one element
+   "colouring/cubes-arg (control) resolves to 0 element(s); a wired surface's region is exactly one",
```

### M74, re-observed at its new site

`mutation-ledger.ts`'s M74 planted `lines.push(...egressLines(best.egress))` in `index.html`; that
line is now `const egress = egressLines(best.egress)` in `surfaces/colouring.ts`. The entry was
**moved, not weakened** — same call, same substitution — and **re-measured**, because an
observation about a different file is not an observation about this one. Exit **1**,
`Tests 1 failed | 3 passed (4)`:

```
AssertionError: expected '0 peer(s) · 8 cubes per rung\n\nn =  …' to contain 'What left this device:'
```

Identical to the 2026-08-08 reading including the 1/3 split. `cmp` after the surgical restore: 0.

## `#run-report` is unchanged, and how that was measured

Not by a byte diff of two rendered reports — the ms figures and the peer ids differ per run, so
such a diff could only ever fail. Three readings instead:

1. **The push statements, extracted and compared one for one.** The old span in `index.html` and
   the new one in `colouring.ts` produce the same 14 push sites in the same order. Every
   difference is a rename — `lines`→`text`, `peerIds.length`→`state.peers`, `best.n`→`bestN`,
   an inline `toFixed(2)` → `cost`, `attestationLines(best.attestation)` → `attLines`,
   `best.agreeing.slice(0,8).map(…)` → `placement.slice(0,8).map(line => \`  ${line}\`)` — and
   each produces the identical string. `map`-then-`slice` preserves the cube indices that
   `slice`-then-`map` produced.
2. **The literals, asserted.** `colouring-surface.node.test.ts` pins
   `n =  300  FOUND     1 found · 1 proved empty · 1 out of budget  413ms` character for
   character, plus nine more lines by exact text.
3. **The consumers, re-run.** `attestation-ui.e2e.test.ts` (its eleven substrings, across three
   ladders on the built bundle) and `colouring-demo.e2e.test.ts` (its four, plus the `settled`
   prefix on `#run-status`) both pass.

## One reading, one render pass — the property, and its one exception

`format` computes `counts`, `bestN`, `cost`, `placement`, `attLines` and `egress` **once** each,
and both views reference those bindings. P6 measures the consequence on the two fields it
quantifies over and found no disagreement over three populated figures.

The one deliberate difference is **extent, not formatting**: the text view prints the first eight
placement lines and says how many more there are, exactly as it did before this plan, while C16
prints them all. `placementLine(who, i)` produces the string in both cases; the text view adds
two spaces of indentation. One formatter, two extents.

## Geometry, and the bar

`demo-viewport.e2e.test.ts`: **exit 0, 7 tests, all five widths × two bar states × six surfaces =
60 combinations.** This wave added six cards, two tables and three `<pre>` blocks to the
colouring surface and did not re-break B1. Two layout decisions were made *because* of it and are
recorded in the markup:

- explanatory clauses live in a `card-note` under each `<dl>`, never in a `<dt>`, because `dl`'s
  first column is `max-content` and a long term establishes a floor wider than a 320px viewport;
- the cube grid and the placement list are wrapped in `.scroller`, per UI-SPEC section 6.4.

The contrast case also read the new control: `the primary run control (.btn-primary, 14px):
#f2f2f3 on #416180 = 5.78:1`.

## Exit codes, read directly

Every one with `EXIT=$?` on the line immediately after the command, output redirected to a file
and the file read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `npx tsc --noEmit` after Task 1 | **0** |
| `vitest run --project node colouring-surface.node.test.ts` | **0** — `Tests 12 passed (12)` |
| `vitest run --project node vocabulary.node.test.ts` | **0** — `Tests 25 passed (25)` |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e` colouring-demo + attestation-ui + demo-viewport | **0** — `Tests 17 passed (17)`, 29.33 s real / 50.67 user / 7.00 sys, ratio 1.97 |
| `vitest run --project e2e demo-viewport` (verbose, to read the 60 combinations) | **0** — `Tests 7 passed (7)` |
| `vitest run --project e2e demo-regions + built-bundle` | **0** — `Tests 25 passed (25)` |
| M74 plant at the new site | **1** — `1 failed \| 3 passed (4)` |
| `cmp` after restore | **0** |
| `npx tsc --noEmit` after Task 3 | **0** |
| `vitest run --project e2e demo-liveness` first green run | **0** — `Tests 6 passed (6)` |
| Plant A | **1** — P5b and the specific block, both naming the region |
| `cmp` after restore | **0** |
| Plant B, `demo-liveness` | **1** — 7 survivors, 5 named, P7 and P8 on vacuity |
| Plant B, `demo-regions` in the same run | **0** — `17 passed`, over a surface rendering nothing |
| `cmp` after restore | **0** |
| Plant B2 | **1** — `Tests 5 failed \| 1 passed (6)`, `0 of 16 reading regions` |
| `cmp` after restore | **0** |
| Plant C | **1** — P1b, `colouring/cubes-arg … resolves to 0 element(s)` |
| `cmp` after restore | **0** |
| `vitest run --project node` slow-specs + reachability-guard + purity + colouring-surface | **0** — `Tests 63 passed (63)` |
| **the plan's verification set, ×5 files** | **0** — `Tests 40 passed (40)`, 38.67 s real / 70.44 user / 9.52 sys, ratio 2.07 |
| **final set, ×6 files** (adds `built-bundle`) | **0** — `Test Files 6 passed (6)`, `Tests 48 passed (48)`, 45.94 s real / 74.04 user / 10.46 sys, ratio 1.84 |
| `grep -v '^ *[/*]' surfaces/colouring.ts \| grep -c innerHTML` | **0** |
| `grep -c innerHTML` on `demo-liveness` and `demo-region-properties` | **0** and **0** |
| `grep -v '^ *[/*]' demo-liveness.e2e.test.ts \| grep -c "'#run'"` | **0** |
| `vitest run --project node vocabulary.node.test.ts` over the new files | **0** — the five cryptojacking stems it is keyed on appear in none of them |
| `git status --porcelain` after the last restore | only this plan's own files |

The `(user+sys)/real` ratios are recorded as comparability keys, not verdicts: every reading
above held more CPU than wall clock, so none of them was starved.

## What the run actually observed

The reading P5's acceptance criterion asks to be recorded, from the green run:

- **two tabs computing**, asserted on the page (`#peers` reading `2 node(s) computing`) before
  anything was dispatched;
- **settled n = 500** — the ladder climbed 300, 400, 500, reported no answer at 600 and stopped;
- **verification cost 2.00×** (`1.96×` on a second run — the cost is measured gross-over-useful
  fuel, so it moves with what the fabric actually spent);
- **attestation: the stated absence**, naming two peer ids as unaccounted, in the kernel's own
  words and rendered verbatim;
- **24 cubes**, `4 found · 0 proved empty · 20 out of budget`;
- **egress: 38 frames, 31756 bytes, 0 withheld**, with the sentence beside it in the same region;
- **the check: `Correct`, 386 triples re-derived in the tab.**

`computePeers()` reported two peers, not one: the relay is itself a `FabricNode` serving the
agent protocol, so it answers an offer and is counted. That is `attestation-ui.e2e.test.ts`'s
documented finding one file over, it is why `cubes` is 24 rather than 16, and it is why the
attestation names two unaccounted replicas rather than one. Recorded as an observation about the
fixture, not smoothed away.

## Deviations from Plan

### `[deviation - scope] P6, P7 and P8 were extracted, which edits Plan 27-03's guard`

- **Found during:** Task 3, reading `demo-regions.e2e.test.ts`'s harness.
- **Issue:** the plan's context says P6/P7/P8 "should stop being vacuous on your watch". They
  cannot, where they are: that spec drives a page with no relay and no node, so no region is ever
  populated and every one of the three is conditional on a condition that page cannot reach.
- **Fix:** the three bodies moved to `packages/node/src/demo-region-properties.ts`; both specs
  import them. The stopped-page cases now assert `examined === 0` out loud instead of reporting a
  pass about nothing, and the liveness spec asserts `examined > 0`.
- **Files:** `packages/node/src/demo-region-properties.ts` (new),
  `packages/node/src/demo-regions.e2e.test.ts` (three case bodies replaced by calls; its header
  gained a section saying where they went and why).
- **Verified:** the guard still exits 0 at `17 passed`, and reddens correctly under plant C.
- **Commit:** `05114f4`

### `[Rule 3 - blocking] M74's plant site moved with the line it plants`

- **Found during:** Task 2's commit, refused by the cheap mutation-ledger guard.
- **Issue:** M74 plants `lines.push(...egressLines(best.egress))` into `index.html`. That line is
  now in `surfaces/colouring.ts`, so the mutation had stopped applying — *a mutation that cannot
  be planted guards nothing*.
- **Fix:** `file`, `find` and `replace` moved to the new site, and the plant **re-run there**
  rather than carrying forward a verdict about a different file. A first draft of that comment
  recorded an observation that had not been made; it was replaced with a `RE-OBSERVATION PENDING`
  marker, measured, and then written from the real output.
- **Files:** `packages/node/src/mutation-ledger.ts`
- **Commit:** `73ee1dd`

### `[Rule 1 - bug] this summary tripped the vocabulary guard by naming the words it bans`

- **Found during:** committing the summary.
- **Issue:** an exit-code row read *banned stems (…) in the new files — no matches*, spelling all
  five cryptojacking terms. The guard is keyed on the word appearing **anywhere** in a tracked
  file, deliberately: a reviewer greps, and a grep does not read the sentence around the hit.
  Five cases reddened, each naming this file and line 376.
- **Fix:** the row now records the guard's own exit code instead of quoting its vocabulary.
- **Files:** `.planning/phases/phase-27-demo-ui-driven-by-real-fabric/27-04-SUMMARY.md`

### `[Rule 1 - bug] a literal NUL byte in the new spec, caught by the vocabulary guard`

- **Found during:** Task 3's commit.
- **Issue:** `digestOf`'s separators were written as raw `U+0000` and `U+0001`. A source file with
  a NUL reads as binary to the repository-wide vocabulary scan and is **skipped whole** — an
  exemption with no entry and no reason.
- **Fix:** printable separators (`|` and `\n`), with the reason recorded at the function.
- **Files:** `packages/node/src/demo-liveness.e2e.test.ts`
- **Commit:** `05114f4`

### `[deviation - method] a unit spec was added that the plan did not ask for`

`packages/browser/src/colouring-surface.node.test.ts`, twelve cases in the `node` project. Task
1's acceptance criterion is that `format` and `formatVerification` are *callable from a unit
context*, and a spec that loads them where `document` does not exist is the only way to hold
that. It also reaches three arms the browser specs cannot reach on a healthy fabric — a ladder
that settles nothing, a rung that throws, and a ladder that stops short.

**Its TDD ordering is a deviation and is stated:** Task 1 is marked `tdd="true"` and the
formatter was written before the spec. The plan's own `<verify>` for that task is `tsc --noEmit`
alone. What replaces the red-first evidence is Plants A, B and B2, all three of which run
through this formatter.

Its file count effect was checked before it was added: `NODE_PROJECT_FILES` was **177** against
`vitest.config.ts`'s recorded `files: 177`, so one new file leaves `slow-specs.node.test.ts` at
drift 1 of a tolerance of 5. `slow-specs`, `purity` and `reachability-guard` were re-run: 0.

### `[deviation - scope] C10 lost the mockup's colour`

UI-SPEC asks for *one swatch per cube, with a text label beside each — colour is never the only
carrier*. `SurfaceRender.regions` is `Record<string, string>` and `applyRender` writes
`textContent`, so a grid of coloured `div`s cannot come out of the single record — and the single
record is the property P6 exists to hold. C10 renders `■ found · □ exhausted · ▧ budget` per cube:
a shape glyph and the word, one string. The rule is met in the strongest sense (there is no
colour to be the only carrier) and the mockup's visual is not ported.

### `[deviation - scope] two absence sentences were composed, not transcribed`

C15 and C17 read `best.*`, and UI-SPEC gives neither an `unavailable` sentence — C15's is a
receipt the kernel composes, C17's cell is empty. When the ladder settles no rung there is no
receipt and no manifest, and rendering the `initial` arm would say *the search has not been run*
right after running it. Two were composed, both marked `COMPOSED` in the source and logged.
**Untested in a browser:** the two-tab run settles, so only the unit spec reaches that branch.

### `[deviation - scope] the ladder's rungs are one prose region, and the rung labels are ordinals`

Labelling each rung card `n = 300` puts four undeclared digits inside `#main`, which P2 refuses.
Four prose entries would be four near-identical catalogue rows. Instead the table's `<caption>` is
`colouring/prose-ladder`, naming `300, 400, 500, 600` in order, and the four `<th scope="row">`
read `first rung` … `fourth rung`. The catalogue grew by one `prose` entry, which is outside the
91 and leaves `UI_SPEC_TALLY` untouched — the guard's twelve tally numbers still agree exactly.

### `[deviation - method] the two-tab fixture joins through the page, not through window.o2.start`

`colouring-demo.e2e.test.ts` starts its tabs with `window.o2.start(...)`. That path never installs
`findPeers`, so `#peers` never becomes a live reading and `2 node(s) computing` — the precondition
this plan's acceptance criterion names — could not be asserted on the page. The tabs are opened at
`?relay=<multiaddr>` and joined by clicking `#allow` and then `#join`. The relay is the in-process
`FabricNode` rather than `bin/seed.ts`; the reason is recorded in the spec's header.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-12 | **mitigate — met, and now live** | C15's receipt arm is `attestation.description` and nothing else; the absence arm is `attestationLines`' own output ending in `attestation.reason`. P8 compares that region against a fresh `window.__o2LastAttestation` reading taken in the same page, and it examined **1** populated region rather than 0. `attestation-ui.e2e.test.ts`'s three-way comparison still holds on the built bundle. |
| T-27-13 | **mitigate — met, and now live** | The count and its sentence are one region, produced by one `egressLines` call whose result feeds both views. P7 examined **1** populated egress region carrying `0 withheld` and found `registered no sovereign data` beside it. Under plant B, P7 reddened at `examined 0`. |
| T-27-14 | **mitigate — met** | `grep -v '^ *[/*]' surfaces/colouring.ts \| grep -c innerHTML` returns 0; `index.html`'s count is unchanged at 1 (`#explain`'s page-authored static string); `render.ts` is 0. Every peer id and every kernel reason reaches the DOM through `textContent`. |
| T-27-15 | **mitigate — met** | P5 is quantified over run controls discovered from the DOM, names its skipped surfaces, asserts at least one surface was driven and at most one primary per surface, and was watched red on four plants. The demonstration that the suite *could* only fail one way is the plant-B row: `demo-regions.e2e.test.ts` at exit 0, `17 passed`, over a surface rendering nothing. |

## Known Stubs

None introduced on this surface. All 21 colouring regions carry a reading or a named absence in
every state, and `format` returns an entry for every one of them in every arm, so no region can
retain a value from a previous run.

The four text-view stubs 27-02 recorded (`#primes-report`, `#pi-report`, `#byo-report`,
`#fabric-report`) are unchanged and still declared. `#report`'s initial literal is still exactly
`not asked yet`.

## What is NOT done

- **86 → 65 regions still have no element.** Five surfaces remain: primes, pi, bring-your-own,
  fabric state and Benchmarks. `WIRED_SURFACES` is the switch each one's plan flips.
- **P9 is not here.** Plan 27-09.
- **`#run-status` puts an undeclared digit on screen after a run** — `settled n = 500`. UI-SPEC
  lists it under *"not counted as figure regions"*, and P2 does not see it because P2 runs on the
  stopped page. Logged rather than reworded.
- **P5a is not reachable by a one-hunk plant.** Plant B leaves it green because the verification
  card is written by a second function; B2 needed two hunks. Recorded above rather than reported
  as a one-plant proof.
- **C15's receipt arm was not exercised by P5's own run.** Neither tab is enrolled, so the fixture
  produces the absence arm. `attestation-ui.e2e.test.ts` is the spec that reads the receipt arm,
  and it does — but P8 has now examined only the absence arm.
- **The nothing-settled branch of `format` has never rendered in a browser.** Only the unit spec
  reaches it.
- **Only Chromium.** Every `e2e` spec launches chromium alone; that is the project's limit, not
  this file's.
- **UI-SPEC is not edited.** Three further corrections are owed and logged: C15's and C17's
  unavailable cells, P5b's exempt set, and `#run-status`'s undeclared digit.

## Commits

| hash | what |
|---|---|
| `3dbbc35` | `feat(27-04)` — the colouring formatter, and twelve unit cases with no DOM |
| `73ee1dd` | `feat(27-04)` — the colouring panel's 21 regions, `WIRED_SURFACES`, M74's moved site |
| `05114f4` | `test(27-04)` — P5, and P6/P7/P8 extracted so they measure something |

Each committed with `git commit -m "…" -- <explicit paths>` and each verified with
`git show --stat` to contain only this plan's files.

## Self-Check: PASSED

- `packages/browser/demo/surfaces/colouring.ts` — FOUND
- `packages/browser/src/colouring-surface.node.test.ts` — FOUND
- `packages/node/src/demo-liveness.e2e.test.ts` — FOUND
- `packages/node/src/demo-region-properties.ts` — FOUND
- `packages/browser/demo/index.html` — FOUND, modified
- `packages/browser/src/demo-regions.ts` — FOUND, modified
- `packages/node/src/demo-regions.e2e.test.ts` — FOUND, modified
- `packages/node/src/mutation-ledger.ts` — FOUND, modified
- commit `3dbbc35` — FOUND
- commit `73ee1dd` — FOUND
- commit `05114f4` — FOUND
- `git status --porcelain` after every plant restore — only this plan's own files, and every
  `cmp` exit 0
