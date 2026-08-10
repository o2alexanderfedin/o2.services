---
phase: 27-demo-ui-driven-by-real-fabric
plan: 9
subsystem: browser-demo
tags: [bench-01, bench-02, bench-03, bench-04, bench-05, demo-01, demo-03, ui-spec-4-7, mutation-proof, p9, b5-vacuity, perf-packaging]
dependency-graph:
  requires:
    - 27-01 (B1–B7 and demo-viewport.e2e.test.ts, whose B5 this plan un-vacuums)
    - 27-02 (the six-surface shell, #s-bench and the footer link that pointed nowhere)
    - 27-03 (the 91-region catalogue, WIRED_SURFACES, and the bench/bar entries it declared)
    - 27-06 (the N10 house pattern for a cited region: pre.citation in a .scroller, provenance inside the region)
    - 27-08 (the seventh surface, and the last WIRED_SURFACES entry before this one)
  provides:
    - "packages/browser/demo/surfaces/bench.ts — K1 and K2 transcribed cell for cell from
      docs/perf/prime-and-pi-benchmarks.md, plus UI-SPEC 4.7's provenance line"
    - "the ./perf/ packaging decision, executed: one committed source, emitted into the bundle
      and served in dev by a plugin in packages/browser/vite.config.ts, build fails without it"
    - "packages/node/src/demo-bench.e2e.test.ts — P9, with a vacuity floor derived from the
      document's own table shapes and two plants"
    - "WIRED_SURFACES holds all eight, and the bar's three elements finally carry data-region"
    - "B5 measures a rendered box on all 60 combinations instead of a zero-size one on 50"
  affects:
    - "Plan 27-10 — carries four new deferred items, including the P1b-with-a-node gap the
      bar's three regions are now waiting behind"
tech-stack:
  added: []
  patterns:
    - "a cited surface whose formatter takes no argument and whose SurfaceRender.text is empty,
      written with writeReading rather than applyRender because there is no text view"
    - "a guard whose expectation is a committed document read off disk, with a vacuity floor
      derived from that document's own table shapes rather than from the transcription"
    - "one committed artifact emitted into a bundle by a Vite plugin and served by the same
      plugin's dev middleware, with a missing source failing the build by name"
    - "a spec importing the shipped vite.config.ts's own plugin factory, so the dev-server half
      is a check on the configuration rather than on a fixture written to agree with it"
key-files:
  created:
    - packages/browser/demo/surfaces/bench.ts
    - packages/node/src/demo-bench.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/demo/demo.css
    - packages/browser/src/demo-regions.ts
    - packages/browser/vite.config.ts
    - packages/node/src/built-bundle.e2e.test.ts
    - packages/node/src/demo-viewport.e2e.test.ts
    - packages/node/src/demo-regions.e2e.test.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "**The links name `./perf/index.html`, not `./perf/`.** A directory URL resolves only where
    the host does directory-index resolution. GitHub Pages does; the deliberately dumb static
    server in `built-bundle.e2e.test.ts` does not. Making that server smarter to satisfy a link
    would be widening the instrument to fit the page, so the page names the file instead — which
    resolves on both, and is measured on the dumb one."
  - "**Nothing on the Benchmarks surface is `rendered-only`.** Every other surface marks its
    cards so the Text-only view collapses them, which is safe there because a text view is left
    standing. This surface has none, so `rendered-only` here would make Text-only render an
    empty surface. The figures are already monospace text; there is nothing to collapse to."
  - "**`'bar'` was appended to WIRED_SURFACES only after its three elements gained `data-region`
    attributes they had never carried.** Appending it while they had none would have been a
    greppable admission that a surface had arrived over three regions that existed only in the
    catalogue — the exact silence the array exists to break."
  - "**B5's reading was changed, in a file outside this plan's `files_modified`.** It measured
    `#main`'s literal last element child, which is the hidden `#s-bench` on five of every six
    passes; a `display: none` box is all zeros and `0 <= barTop` was green without measuring
    anything. It now measures the last child with a client rect."
  - "**UI-SPEC's provenance line ships, and its disagreement with the document's own header
    sentence is reported rather than reconciled.** §11 fixes the string; a plan that quietly
    reworded it would be editing the copywriting contract from inside a surface."
metrics:
  duration: ~85 minutes
  tasks: 3
  files-created: 2
  files-modified: 8
  commits: 5
  completed: 2026-08-10
---

# Phase 27 Plan 9: Benchmarks Summary

**The last surface renders 181 figures and computed none of them — every one occurs verbatim in
`docs/perf/prime-and-pi-benchmarks.md`, checked by reading that document off disk rather than by
trusting the transcription.** The two results worth reading past the region count are both about
guards rather than about the screen: **`./perf/` resolved nowhere in either environment and now
resolves in both from one committed source, with the build failing if that source is absent**; and
**B5 in `demo-viewport.e2e.test.ts` was measuring a zero-size box on 50 of its 60 combinations, and
this surface was the cause.**

## K1 and K2, as rendered, with their provenance

Read off the screen. `#s-bench` carries three regions — the two `cited` groups UI-SPEC §4.7
enumerates, and the `prose` provenance line the catalogue has held since 27-03.

**The provenance line, at the top of the surface, before the first card** (asserted by
`compareDocumentPosition`, not by reading the markup):

```
Measured 2026-08-02 on one machine — 8 physical cores, Node 23.11, V8's built-in WebAssembly.
Every figure on this screen comes from that recorded run. None of them is a reading from your tab.
```

**K1 — `bench/speedup`**, section 5 of the document:

```
Real parallel speedup — separate operating-system processes, one per shard, each
competing for a real core. Best of 3 runs.

  kernel  domain          processes  wall [ms]  sum guest [ms]  straggler [ms]  speedup  efficiency
  primes  N = 3x10^8      1          2915.2     2864.3          2864.3          1.00x    100%
  primes  N = 3x10^8      2          1504.3     2865.7          1449.7          1.94x    97%
  primes  N = 3x10^8      4          861.7      3138.9          800.1           3.38x    85%
  primes  N = 3x10^8      8          800.0      4889.5          693.7           3.64x    46%
  pi      1.5x10^9 terms  1          3510.0     3459.4          3459.4          1.00x    100%
  pi      1.5x10^9 terms  2          1819.3     3500.5          1758.3          1.93x    96%
  pi      1.5x10^9 terms  4          939.5      3469.0          874.0           3.74x    93%
  pi      1.5x10^9 terms  8          904.6      5938.4          774.7           3.88x    49%

Measured in a run recorded elsewhere and at another time; not computed here.
Source: docs/perf/prime-and-pi-benchmarks.md, section 5.
It was not this tab, and no part of this screen is a reading from this tab.
```

**K2 — `bench/overhead`**, sections 4, 2 and 3:

```
Fabric overhead — map and reduce through the real request/response machinery,
measured against a same-moment local reference. 9 repetitions, p50. The tax
column is dimensionless — total divided by local.

  workload     shards  redundancy  local [ms]  map [ms]  reduce [ms]  total [ms]  tax
  primes 10^6  1       1           6.02        6.65      0.10         6.77        1.12x
  primes 10^6  1       2           5.89        11.95     0.03         12.00       2.04x
  primes 10^6  2       1           6.08        6.48      0.46         6.93        1.14x
  primes 10^6  4       1           8.06        8.04      0.38         8.57        1.06x
  primes 10^6  8       1           11.80       8.53      0.76         9.69        0.82x
  primes 10^6  8       2           8.80        16.14     1.27         17.30       1.96x
  pi 10^6      1       1           0.80        0.90      0.03         0.93        1.16x
  pi 10^6      1       2           0.81        1.70      0.02         1.71        2.12x
  pi 10^6      4       1           1.59        1.85      0.30         2.12        1.33x
  pi 10^6      8       2           1.94        3.15      0.86         4.00        2.06x

Decomposition cost — the same domain split N ways, with each shard's guest time
summed. A ratio above 1.0 means the split duplicates work.

  kernel  shards  sum [ms]  one shard [ms]  ratio
  primes  1       3.878     3.888           0.998
  primes  2       3.850     3.888           0.990
  primes  4       3.829     3.888           0.985
  primes  8       3.816     3.888           0.981
  primes  16      3.780     3.888           0.972
  pi      8       0.645     0.644           1.003
  pi      16      0.660     0.644           1.025

Instantiate, cold.

  kernel  p50 [ms]  module [bytes]
  primes  0.060     1187
  pi      0.053     549

Measured in a run recorded elsewhere and at another time; not computed here.
Source: docs/perf/prime-and-pi-benchmarks.md, sections 2, 3 and 4.
It was not this tab, and no part of this screen is a reading from this tab.
```

**Both blocks carry their provenance inside the region** — the N10 shape, one workload over — so a
figure cannot be lifted off this page without the statement of where it came from. The one wording
change from N10 is the first line: N10 says *published in the mathematical literature*, and these
figures were not published by anybody else, so this says *measured in a run recorded elsewhere and
at another time*.

**Section 3's p90 and p99 columns are the only cells of a source table not carried across.** UI-SPEC
K2 asks for the p50 and the module size. That is a transcription of fewer cells, never a different
figure, and it is stated in `surfaces/bench.ts` beside the data.

## Every figure is transcribed, and how that was verified

Three independent checks, in the order they were made:

1. **Before the surface was wired to anything**, a throwaway script imported `format()` and ran the
   same substring test P9 uses against the committed markdown: `figure strings examined: 181`,
   `not in the document: none`. That caught transcription errors while they were still cheap.
2. **P9, on a real page**, does the same thing through the DOM rather than through the module: a
   `TreeWalker` over `#s-bench` collects every non-empty text node, splits each into figure strings,
   and requires each to occur in `docs/perf/prime-and-pi-benchmarks.md`. It reports what it
   examined on every run:

   ```
   [P9] 181 figure string(s) extracted from #s-bench, floor 171
   [P9] by region: bench/prose-provenance=4, bench/speedup=58, bench/overhead=119
   ```
3. **Two plants**, each watched red, below.

**The expectation comes from the document and never from the surface.** The comparison is
`document.includes(figure)`, where `document` is `readFile('docs/perf/prime-and-pi-benchmarks.md')`.
Nothing in the spec holds a copy of a figure.

**The floor is 171**, and it is derived from the *document's* four tables rather than from
`bench.ts`'s arrays — a floor taken from the transcription would shrink with it, and a
transcription that had lost half its rows would still pass:

| source | rows | figure-bearing columns | cells |
|---|---|---|---|
| section 5, real parallel speedup | 8 | 7 — domain, processes, wall, sum guest, straggler, speedup, efficiency | 56 |
| section 4, fabric overhead | 10 | 8 — workload, shards, redundancy, local, map, reduce, total, tax | 80 |
| section 2, decomposition cost | 7 | 4 — shards, sum, one shard, ratio | 28 |
| section 3, instantiate cold | 2 | 2 — p50, module bytes | 4 |
| the provenance line | — | 3 — date, core count, engine version | 3 |
| | | | **171** |

Observed 181. The extra ten are column headers (`p50` twice) and the surface's own prose —
*best of 3 runs*, *9 repetitions, p50*, *a ratio above 1.0* — and `V8` in the provenance line, whose
`8` is why that region reports four figures rather than three.

**The splitter's hole is stated in the spec's header rather than left to be found.** `FIGURE` is
`/\d+(?:[.\-^x]\d+)*(?:x|%)?/g` — a rule over glyphs. The internal `x` is what keeps `3x10^8` whole
and the internal `-` is what keeps `2026-08-02` whole. A figure spelled out in words is invisible
to it, exactly as `DIGIT` is blind to *forty-one*. The floor is what stops the hole mattering.

**What P9 cannot see, said plainly:** it is a subset check. A figure in the document that this
surface fails to render is invisible to it, and a blank surface satisfies *every figure on screen
occurs in the document* perfectly. The floor holds that direction by **count** rather than by
identity — a surface rendering 171 copies of `1187` would pass. That is written into the spec's
header as well.

## The planted mutations

Both in `packages/browser/demo/surfaces/bench.ts`, each snapshotted with `cp` to the session
scratchpad **immediately before** the edit, restored by **the surgical inverse of that edit** —
never `cp` back, never `git stash`, never `git checkout --` — and verified with `cmp`, `EXIT=$?`
read on the line immediately after. `git diff -U0 | grep -c '^@@'` returned **1** on each, and
`git status --porcelain` was checked before and after each.

### Plant A — one figure rounded: red, naming the rounded string

`'3.64x'` → `'3.6x'` in the section-5 row for primes at eight processes. Exit **1**,
`Tests 1 failed | 5 passed (6)`:

```
FAIL |e2e| demo-bench.e2e.test.ts > P9 — the Benchmarks surface cites, and does not compute >
  renders no figure the committed document does not contain
AssertionError: a figure on the Benchmarks surface that does not occur in
docs/perf/prime-and-pi-benchmarks.md. Every figure here is a transcription of that document:
a rounded one is a figure the document does not contain, and so is an invented one.:
expected [ Array(1) ] to deeply equal []
+   "\"3.6x\" in bench/speedup — … 8 800.0 4889.5 693.7 3.6x 46% pi 1.5x10^9 terms 1 3510.0 …"
```

`cmp` after the surgical restore: **0**.

### Plant B — a figure the document does not contain: red, naming it

The plan calls this one the defect UI-SPEC says this surface is most likely to introduce. `'93%'` →
`'87%'` in the section-5 row for pi at four processes — an efficiency percentage that appears
nowhere in the document (`grep -c "87%"` returns **0**). Exit **1**,
`Tests 1 failed | 5 passed (6)`:

```
AssertionError: a figure on the Benchmarks surface that does not occur in
docs/perf/prime-and-pi-benchmarks.md …: expected [ Array(1) ] to deeply equal []
+   "\"87%\" in bench/speedup — … 939.5 3469.0 874.0 3.74x 87% pi 1.5x10^9 terms 8 904.6 5938.4 …"
```

`cmp` after the surgical restore: **0**.

**Both failure messages name the offending string and quote its surroundings**, which is the
difference between a guard that says *something is wrong* and one that can be acted on in a single
run.

## `./perf/` — how it is packaged, and that the build fails without the source

**One committed source, emitted rather than duplicated.** `packages/browser/vite.config.ts` now
exports a `perfReport()` plugin with both halves:

- `generateBundle` emits `docs/perf/prime-and-pi-benchmarks.html` into the bundle as
  `perf/index.html`.
- `configureServer` serves the same bytes in dev.

Nothing is copied into `packages/browser/demo/`. `docs/perf/build-report.py` writes exactly one
file and a second copy in the tree is a second thing to keep in step.
`git status --porcelain docs/perf/` prints nothing: the report is **read**, not regenerated and not
edited.

**A missing source fails the build, naming its generator. Measured, not asserted:** the committed
HTML was moved aside, the build run, and the file moved back.

```
build-without-source exit=1
Error: the demo bundle links ./perf/index.html and
/Volumes/…/docs/perf/prime-and-pi-benchmarks.html is not readable. It is a committed artifact
produced by docs/perf/build-report.py — run that script, or restore the file, before building
the demo.
```

`cmp` against the snapshot taken immediately before the move: **0**.
`git status --porcelain docs/perf/`: empty.

**The link names the file rather than the directory, and that is a decision.** `./perf/` resolves
only where the host performs directory-index resolution. GitHub Pages does; the deliberately dumb
static server in `built-bundle.e2e.test.ts` — *"no module resolution, no transforms, no fallbacks"*
— does not, and teaching it to would be widening the instrument to fit the page. Both the footer
and the Benchmarks surface's provenance card link `./perf/index.html`, which resolves on either.

**The middleware matches on a path suffix, and the reason is a real divergence rather than
laziness.** `npm run dev` uses this config, whose `root` is `./demo`, so the page sits at
`/index.html` and the relative link resolves to `/perf/index.html`. Every e2e spec instead starts
Vite with `root` at the repository root and loads `/packages/browser/demo/index.html`, where the
*same relative link* resolves to `/packages/browser/demo/perf/index.html`. Matching the suffix is
what makes the link the page actually renders resolve in both.

**Both halves measured:**

| environment | check | result |
|---|---|---|
| dev server (with the plugin, as `demo-bench.e2e.test.ts` starts it) | every `perf/` anchor on the page, followed | **200**, body contains `Real parallel speedup` |
| built bundle, dumb static server | `dist/perf/index.html` present | **30 059 bytes** |
| built bundle, dumb static server | `GET /perf/index.html` | **200**, body contains `Real parallel speedup` and `Fabric overhead` |
| built bundle | emitted bytes vs. committed bytes | **identical** |

The bundle case asserts on **section headings, not figures**, deliberately: P9 is the property
about figures and it has the document to compare against. A figure asserted there too would be a
second, weaker copy of P9 — weaker because that file would be comparing a number against a literal
typed into a spec.

## B5: it was measuring nothing, this surface was the cause, and it is fixed

**The finding, printed rather than argued.** A `[B5]` line was added to
`demo-viewport.e2e.test.ts` reporting what the property measured on each of its 60 combinations.
Before any other change:

```
[B5] 320px / idle / surface 1 of 6: measured section#s-bench bottom=0.00 barTop=632.41
[B5] 320px / idle / surface 5 of 6: measured section#s-bench bottom=0.00 barTop=632.41
[B5] 320px / idle / surface 6 of 6: measured section#s-bench bottom=430.91 barTop=632.41
```

**50 of the 60 combinations measured a zero-size box.** UI-SPEC §6.3 defines B5 against `#main`'s
last element child; that child is `section#s-bench`, which is `hidden` on five of every six passes
of the surface loop, and a `display: none` element's bounding box is all zeros. `0 <= barTop` is
green without measuring anything.

**The fix takes the last child of `#main` that has a client rect** — the panel a visitor is
actually looking at when they scroll to the end. A hidden panel cannot be covered by the bar, so
measuring it is not a weaker version of the property; it is not the property at all.

After:

```
[B5] 320px / idle / surface 1 of 6: measured section#s-colouring bottom=431.42 barTop=632.41
[B5] 320px / idle / surface 5 of 6: measured section#s-fabric   bottom=431.16 barTop=632.41
[B5] 1280px / loaded / surface 6 of 6: measured section#s-bench bottom=493.27 barTop=655.00
```

**`grep -c "bottom=0.00"`: 50 before, 0 after.** All 60 combinations green in both runs.

**What the fix does NOT close, and it is unchanged:** `#measurements` — the footer carrying the
perf link — is a **sibling** of `#main`, not a child, so B5 is silent about it in both forms. 27-01
measured the footer under the bar at all three narrow widths with B5 green throughout.
`footerBottom` is still read and still not asserted, because widening a property mid-plan would
make this file's red depend on a figure UI-SPEC has not agreed. Logged.

## P1b's coverage: 99 → 102 of 105, and the three that did not move

Measured on the same run shape, before and after, with a `[P1b]` count added to the property:

| | before 27-09 | after 27-09 |
|---|---|---|
| `[P1b] examined` | **99 of 105** | **102 of 105** |
| wired | session, colouring, pi, primes, byo, fabric | session, colouring, pi, primes, byo, fabric, **bench, bar** |
| `[P5] skipped` | session, primes, fabric | session, primes, fabric, **bench, bar** |
| `[P5] exercised` | colouring, pi, byo | colouring, pi, byo |
| `[P5] N of M` | 37 of 39 | 37 of 39 |
| `[P6] / [P7] / [P8] examined` | 5 / 3 / 2 | **5 / 3 / 2** |

**The jump is three, not five, and the shortfall is the point.** `bench` contributes its two
`cited` regions plus `bench/prose-provenance`. `bar` contributes **nothing**: P1b runs in
`demo-regions.e2e.test.ts` on a page with no node, `#bar` is absent, and
`absenceMode: 'element-removed'` skips all three. The count says so out loud —
`(wired: …, bench, bar; #bar absent)` — and 105 is the catalogue's whole length, 91 figure regions
plus the text-view and prose entries that are not part of the tally.

**P6, P7 and P8 did not move, as the brief required.** This surface renders no attestation, no
egress and no figure that appears in a text view, because it has no text view.

**`bench` and `bar` are reported in P5's skipped list by name**, which is what makes a surface P5
chose not to drive distinguishable from one P5 never saw:

```
[P5] skipped (no primary run control on the surface): session, primes, fabric, bench, bar
```

`demo-bench.e2e.test.ts` asserts the reason directly rather than leaving it to the skip list:
`#s-bench` holds **zero** `.btn-primary` and **zero** `<button>` of any kind, with the floor beside
it — `#s-colouring` still matches the same selector, so a selector that had stopped matching
anything cannot pass this as a clean zero.

## `WIRED_SURFACES` reaches all eight, and `'bar'` needed markup first

Eight entries: session, colouring, pi, primes, byo, fabric, bench, bar.

**`'bar'` had waited eight plans for a reason the plan did not have: the bar's three elements
carried no `data-region` at all.** B1, B2 and B3 have been in the catalogue since 27-03 and no
element on the page carried their ids. Appending `'bar'` while that was true would have been a
greppable admission that a surface had arrived over three regions that existed only in the
catalogue — the exact silence the array exists to break. So `#bar-what`, `#bar-stats` and `#stop`
gained their attributes in the same commit as the array entry.

It buys no coverage today, for the reason in the table above, and that is logged as an item 27-10
can close with one case in `demo-liveness.e2e.test.ts` — the only spec that has a page with the bar
visible.

## Deviations from Plan

### `[deviation - method] Task 3 is `tdd="true"` and no RED was watched for its own cases

`surfaces/bench.ts` and the markup landed in Task 1, which the plan itself orders first, so P9 was
written against a surface that already existed and all six cases passed on their first run. **No
RED was observed for these cases at the time they were written.** Recorded rather than dressed up.
What carries the claim instead is the pair of plants the plan specifies, both watched red with
their text above. The same note is in the spec's own header, so a later reader does not have to
find this file.

### `[deviation - markup] `<caption>` inside a `<table>` became a card kicker above a `<pre>`

Task 1 says *"each wrapped in `<div style="overflow-x:auto">` and each with a `<caption>` naming
its section of the document"*. A `<caption>` only exists on a `<table>`, and a table would need
markup assembled per cell — while `render.ts` has exactly one writer and it assigns `textContent`,
never `innerHTML`, for the reason its header gives at length. The operator's brief names the N10
house pattern to follow and N10 is a `<pre class="citation">` in a `.scroller` (which *is*
`overflow-x: auto`). So: `.scroller` for the wrapper, a `.card-kicker` above each block naming its
section, and the section named **again inside the region** in the citation lines, so the naming
travels with the figures.

### `[deviation - scope] the kickers spell their section numbers as words

`Real parallel speedup · section five of the document`. A card kicker is not a region, and P2
forbids an undeclared digit anywhere inside `#main` — `section 5` there would be a number on screen
that nothing declares, on the surface most likely to trip exactly that. The digits live inside the
region, where the citation block names the section again.

### `[deviation - scope] four files outside `files_modified` were touched

- **`packages/browser/demo/demo.css`** — `.bench-table` and `#s-bench > .card { min-width: 0 }`.
  Forced by a measurement; see the Rule 1 entry below.
- **`packages/node/src/demo-viewport.e2e.test.ts`** — the B5 fix and its `[B5]` reporting line. The
  operator's brief names this surface as B5's cause and asks for it to be fixed or for a plain
  statement of why not.
- **`packages/node/src/demo-regions.e2e.test.ts`** — a `[P1b] examined N of M` line, so the plan's
  *"record the observed number before and after"* is a measurement rather than an arithmetic
  claim.
- **`.planning/…/deferred-items.md`** — four entries.

### `[Rule 1 - bug] the first draft of the tables made the page scroll sideways at four widths

- **Found during:** Task 1, first run of `demo-viewport.e2e.test.ts`. Exit **1**, four cases red:
  `B1 320px / idle / surface 6 of 6: documentElement.scrollWidth 830 exceeds innerWidth 320 + 1`,
  and the same **830** at 360, 393 and 768 in both bar states. The same figure at four widths is
  an intrinsic width, which is what named the cause.
- **Issue:** the fix for the tables was `white-space: pre` on the `<pre>` (the `pre` rule sets
  `pre-wrap`, which would put one record's cells on two lines and stack two records' columns under
  each other — a table saying something the document does not). That was written on the belief that
  a card is a plain block whose width comes from its column. It is not:
  `[role="tabpanel"] { display: grid }` makes every direct child of a surface a **grid item**, and
  a grid item's automatic minimum size is content-based. The widest table row set the track and the
  track set the page.
- **Diagnosis by measurement, not by plausibility:** a throwaway Playwright script printed every
  element whose box or scroll width exceeded the viewport. `section#s-bench.wrap … display=grid`
  and `div.card.blueprint rect=809x` named it in one run.
- **Fix:** `#s-bench > .card { min-width: 0 }`. After: `documentElement.scrollWidth` 320 at 320px,
  and `div.scroller rect=254x scrollW=775` — the table scrolls inside its own scroller.
- **Commit:** `9f961b4`.

### `[Rule 3 - blocking] `tsc --noEmit` reddened the moment the spec imported the Vite config

- **Found during:** Task 3. Exit **1**:
  `packages/browser/vite.config.ts(97,16): error TS9037: Default exports can't be inferred with --isolatedDeclarations.`
- **Issue:** `vite.config.ts` was outside any project's type-check until `demo-bench.e2e.test.ts`
  imported `perfReport` from it. Importing it there is deliberate — it makes the dev-server half a
  check on the shipped configuration rather than on a fixture written to agree with it.
- **Fix:** the default export is bound to `const config: UserConfig` and exported by name.
- **Commit:** `43316f1`.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-33 | **mitigate — met, and proved twice** | P9 reads `docs/perf/prime-and-pi-benchmarks.md` off disk and requires every one of 181 extracted figure strings to occur in it, with a floor of 171 derived from the document's own table shapes. Plant A rounded a figure and plant B invented one; both went red naming the offending string. |
| T-27-34 | **mitigate — met** | The provenance line is the first thing in `#s-bench` and precedes the first card, asserted by `compareDocumentPosition` rather than by reading the markup. Both cited regions compute to `--color-neutral-700` — asserted against a live probe of that custom property — and to a **different** colour from a live reading (`colouring/best-n`), so a cited figure and a measured one differ without reading the label. |
| T-27-35 | **mitigate — met** | The report is emitted into the bundle from the committed source and served from this origin; the emitted bytes are asserted identical to the committed ones. P10 in `built-bundle.e2e.test.ts` is unchanged and green — every pre-consent request is same-origin. |
| T-27-36 | **mitigate — met** | One committed source, read at build and serve time. Nothing is copied into `packages/browser/demo/`; `git status --porcelain docs/perf/` prints nothing; and a missing source fails the build naming `docs/perf/build-report.py`, measured by moving the file aside. |

## Exit codes, read directly

`EXIT=$?` on the line immediately after each command, output redirected to a file and the file read
afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `vitest run --project e2e demo-regions + demo-viewport + demo-liveness` — **baseline** | **0** — `30 passed`, `[P1b] 99 of 105`, 50 of 60 B5 readings `bottom=0.00`, 19.05 real / 32.12 user / 6.82 sys, ratio 2.04 |
| `tsx` pre-check of every figure against the document | **0** — `181 examined, not in the document: none` |
| `npx tsc --noEmit` after Task 1 | **0** |
| the same three specs, first run after Task 1 | **1** — B1 red at 320/360/393/768, `scrollWidth 830` |
| the same three, after `#s-bench > .card { min-width: 0 }` | **0** — `30 passed`, `[P1b] 102 of 105`, **0 of 60** B5 readings zero, 17.43 real / 31.84 user / 6.68 sys, ratio 2.21 |
| `npm run build:demo` after Task 2 | **0** — `dist/perf/index.html`, 30 059 bytes |
| `npm run build:demo` with the committed report moved aside | **1** — message names `docs/perf/build-report.py` |
| `cmp` after moving it back | **0**; `git status --porcelain docs/perf/` empty |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e built-bundle` | **0** — `9 passed`, 10.45 real / 6.10 user / 1.79 sys |
| `vitest run --project e2e demo-bench`, first run | **0** — `6 passed`, `[P9] 181 … floor 171`, 3.12 real / 3.02 user / 1.27 sys, ratio 1.37 |
| Plant A (demo-bench) | **1** — `1 failed \| 5 passed`, text above |
| `cmp` after the surgical restore | **0** |
| Plant B (demo-bench) | **1** — `1 failed \| 5 passed`, text above |
| `cmp` after the surgical restore | **0** |
| `npx tsc --noEmit` after Task 3 | **1** — TS9037 on `vite.config.ts` |
| `npx tsc --noEmit` after the typed default export | **0** |
| `npm run build:demo`, final | **0** |
| **the plan's verification set, ×5 files** | **0** — `Tests 45 passed (45)`, 30.75 real / 41.18 user / 9.66 sys, ratio 1.65 |
| `vitest run --project e2e` × 9 demo specs (attestation-ui, colouring-demo, demo-pi, demo-primes, demo-byo, demo-fabric, duty-cycle-tab, peer-ledger, two-tabs) | **0** — `80 passed`, 76.03 real / 107.67 user / 18.95 sys, ratio 1.67 |
| `vitest run --project browser` | **0** — `4458 passed`, 55.23 real / 105.33 user / 26.12 sys, ratio 2.38 |
| `vitest run --project node` vocabulary + strip-comments + requirements-ledger + slow-specs | **0** — `71 passed` |
| the pre-commit cheap guards, on each of the five commits | **0** — `267 passed` each time |
| `grep -v '^ *[/*]' surfaces/bench.ts \| grep -c innerHTML` | **0** |
| `git show --stat` after each commit | only this plan's own files |

Every `(user+sys)/real` ratio is above one, so no reading was taken from a starved process. They
are comparability keys, not verdicts.

## Known Stubs

**None introduced.** Both regions carry their full transcription in every state of the page,
including with no node — they are `cited`, they have no absence arm, and nothing on this surface
depends on a fabric existing. There is no `data-absence` for them and no state in which they are
empty.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: build-time-file-read | `packages/browser/vite.config.ts` | The plugin reads a path outside the Vite root (`../../docs/perf/…`) and emits its contents into the bundle. The path is a compile-time constant resolved from `import.meta.url`, not derived from any input, and the file is committed — but it is a build step that puts bytes from outside the root into a published artifact, and that is worth a reader's attention on the day somebody parameterises it. |

## What is NOT done

- **P9 is a subset check.** A figure in the document this surface fails to render is invisible to
  it, and the floor holds that direction by count rather than by identity. Stated in the spec.
- **The bar's three regions are declared but nothing checks their elements.** P1b runs only on a
  page with no node. Logged with the one case that would close it.
- **`#measurements` is still outside B5.** The footer was measured under the bar at three narrow
  widths in 27-01 and B5 was green throughout; `footerBottom` is read and not asserted.
- **`./perf/` with a trailing slash resolves in dev and 404s on the harness's dumb static server.**
  The page links `./perf/index.html`, which resolves on both, so nothing on screen depends on the
  difference — but a hand-typed `/perf/` in a browser address bar against `dist/` will not work,
  and would on GitHub Pages.
- **UI-SPEC's provenance line and the document's own header sentence disagree.** UI-SPEC's ships;
  the disagreement is reported, not reconciled. Logged.
- **UI-SPEC is not edited.** Seven corrections are now owed and logged; this plan adds two — the
  provenance-line wording and the B5/`#measurements` scope.
- **`npx vitest run --project node` in full was not run to completion** — it exceeded a ten-minute
  command timeout. The guards that this plan's files could affect were run individually and are in
  the table above, and the cheap-guard hook ran all seven guard files on every commit.
- **Only Chromium.** Every `e2e` spec here launches chromium alone; the project's limit.
- **STATE.md and ROADMAP.md were deliberately not touched**, and no `gsd-sdk query state.*` or
  `roadmap.*` verb was run — the operator's instruction for this plan forbids them.

## Success criteria

1. **Met, proved by two plants.** 181 figure strings, every one occurring verbatim in
   `docs/perf/prime-and-pi-benchmarks.md`; a rounded figure and an invented one each went red
   naming the string.
2. **Met, with a disagreement reported.** The provenance line is the first content in `#s-bench`
   and precedes the first card, asserted by `compareDocumentPosition`. It matches UI-SPEC §4.7
   requirement 1 verbatim and **does not** match the document's own header sentence; the difference
   is written out above and logged.
3. **Met.** Both cited regions compute to `--color-neutral-700`, asserted against a live probe of
   that property, and to a different colour from a live reading region on another surface.
4. **Met.** `./perf/index.html` returns 200 from the dev server and from the built bundle's dumb
   static host, from one committed source, with the build failing by name when that source is
   absent. The trailing-slash form is the stated limit.
5. **Met, recorded as an observed count.** All eight surfaces wired;
   `[P1b] examined 99 of 105` → `102 of 105`, with the three that did not move named and explained.
6. **Met.** `#s-bench` holds zero `.btn-primary` and zero buttons, with a floor beside the zero, and
   `[P5] skipped … session, primes, fabric, bench, bar`.

## Commits

| hash | what |
|---|---|
| `9f961b4` | `feat(27-09)` — the surface, the provenance line, `WIRED_SURFACES` at eight, the bar's attributes, and the `min-width: 0` the B1 red forced |
| `064d0fe` | `test(27-09)` — B5 measures a rendered box; P1b reports its examined count |
| `d1dee6e` | `feat(27-09)` — the perf report emitted and served from one committed source |
| `43316f1` | `test(27-09)` — P9, and the typed default export |
| *(this file)* | `docs(27-09)` — the summary and four deferred items |

Each committed with `git commit -m "…" -- <explicit paths>`, `-m` before `--`, and each verified
with `git show --stat` to contain only this plan's own files.

## Self-Check: PASSED

- `packages/browser/demo/surfaces/bench.ts` — FOUND, **263 lines** (`min_lines: 120`),
  `prime-and-pi-benchmarks` present ×2, `innerHTML` count **0** outside comments
- `packages/node/src/demo-bench.e2e.test.ts` — FOUND, **330 lines** (`min_lines: 140`),
  `verbatim` present
- `packages/browser/vite.config.ts` — FOUND, modified; `prime-and-pi-benchmarks.html` present,
  `perf` present
- `packages/browser/dist/perf/index.html` — FOUND, 30 059 bytes, byte-identical to the committed
  report
- `packages/browser/demo/index.html`, `demo.css`, `src/demo-regions.ts`,
  `packages/node/src/built-bundle.e2e.test.ts`, `demo-viewport.e2e.test.ts`,
  `demo-regions.e2e.test.ts` — all FOUND, modified
- `WIRED_SURFACES` holds eight entries: session, colouring, pi, primes, byo, fabric, bench, bar
- commits `9f961b4`, `064d0fe`, `d1dee6e`, `43316f1` — all FOUND
- `git status --porcelain` after every plant restore — printed only files this plan owns; every
  `cmp` exit **0**; `git status --porcelain docs/perf/` empty throughout
