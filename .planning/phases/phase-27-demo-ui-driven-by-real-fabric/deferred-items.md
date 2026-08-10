# Deferred items — Phase 27

Out-of-scope discoveries, logged rather than fixed. Each names what was measured and
what would close it.

## B5 is silent about the footer, which sits outside `#main`

**Found during:** 27-01 Task 1, writing the geometry spec against the unfixed page.

UI-SPEC §6.3 defines B5 as *"With the page scrolled to its end, the last element of `#main`
is not covered by `#bar`: its bottom is above `#bar`'s top"*. `#measurements` — the footer
carrying the link to the benchmark page — is a **sibling** of `#main`, not a child of it,
and it is the last rendered thing on the page. So the element most likely to be covered is
the one element the property does not look at.

**This was not theoretical on the unfixed page.** Measured 2026-08-10 at the end of the
page, before the grid contract landed:

| viewport | footer bottom | `#bar` top | covered? | B5 said |
|---|---|---|---|---|
| 320 | 599.81 | 558.94 | **yes, by 40.9px** | green |
| 360 | 600.25 | 558.94 | **yes, by 41.3px** | green |
| 393 | 600.14 | 558.94 | **yes, by 41.2px** | green |
| 768 | 600.00 | 630.13 | no | green |
| 1280 | 600.00 | 659.19 | no | green |

**Task 2's `body { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8.5rem) }`
closed it in the state the page actually reaches.** Re-measured after the fix, idle state:
footer bottom 575.81 / 576.25 / 576.14 / 576.00 / 576.00 against `#bar` tops of 613.81 /
613.81 / 632.41 / 655.00 / 655.00 — clear at all five widths.

**One residue, in the synthetic state only.** At **768px in the `loaded` state** the footer
is still covered: footer bottom 576.00 against `#bar` top 550.25, a 169.75px bar. 768px is
where the three-column arrangement above 40rem first applies, so both text children are in
narrow tracks and both wrap hard. The `loaded` state is a test-time write of the longest
string the bar's templates *can* emit, not a state the page reaches with real activity, so
this is not a live defect — but it is the arithmetic saying that 8.5rem does not cover the
worst case at that one width.

**What would close it:** widen B5 in `demo-viewport.e2e.test.ts` from `#main`'s last element
child to the last rendered element of the page, and re-site `body`'s bottom padding against
what that measures at 768. `footerBottom` is already read and returned by the spec's
`measure()` for exactly this purpose; it is deliberately **not asserted**, because widening
a property mid-plan would have made this plan's red depend on a figure UI-SPEC has not
agreed. That is UI-SPEC §6.3's edit to make, not this plan's.

## UI-SPEC §6.2's claim that `min-width: 0` is load-bearing is false

**Found during:** 27-01 Task 3, running the plant the plan requires.

§6.2 states: *"`min-width: 0` on both text children is load-bearing and is the line most
likely to be removed by someone tidying up. Its removal must turn §6.3 red; that is the
mutation proof."* Three plant arms say otherwise, and none of them moved a box by a pixel:

| arm | result |
|---|---|
| remove `min-width: 0` from `#bar-what` | every property green |
| remove it *and* force `white-space: nowrap` on `#bar-what` | readings **identical to the pixel** to the same plant with `min-width: 0` kept |
| remove it from `#bar-stats`, the row spanning both tracks, with nowrap | B2c red, B2b green — same as with the line present |

The mechanism is in the track definition rather than the child rule: a grid item's
automatic minimum size is content-based only when it spans a track whose **min** track
sizing function is `auto`, and `grid-template-columns: minmax(0, 1fr) auto` fixes that min
at 0. The line is therefore inert under §6.2's own grid, and becomes load-bearing again only
if that track definition changes.

**Not fixed here**, because the line is harmless, is defensive against exactly that future
change, and is written in §6.2's CSS block which Task 2 was told to reproduce verbatim. The
comment in `index.html` that asserted the line was load-bearing **was** corrected in place
(commit `a4fbe56`), because a comment that states a falsified mechanism is worse than none.

**What would close it:** an edit to UI-SPEC §6.2 replacing the `min-width: 0` mutation proof
with the one that actually holds — `white-space: nowrap` on either text child, which turns
B2c red at 320, 360 and 393.

## The roadmap's 500px iPhone reading is not reproducible by any instrument in this repo

**Found during:** 27-01 Task 1.

The reading — `#bar` at 500px on a 393px viewport, `#stop` past x=482 — depends on iOS
Safari widening the layout viewport to fit overflowing content ("shrink-to-fit"). Headless
Chromium at a pinned viewport does not widen: `documentElement.scrollWidth` equalled
`innerWidth` exactly at all five widths, and `#bar`'s widest child ended within 0.01px of
its padding box. Playwright's `isMobile` is Chromium-only and does not add shrink-to-fit.

So `demo-viewport.e2e.test.ts` cannot see the *page-level* symptom that was reported. What
it does hold is the two properties underneath it — B2c (the bar's content fits) and B3/B4
(Stop is a 44px target and is unoccluded) — and the header of that file says so rather than
implying the roadmap's reading is under guard.

**What would close it:** a real-device or BrowserStack leg against iOS Safari, which this
repository has no harness for. Worth stating that the `browser` project already runs webkit
via Playwright — but desktop WebKit does not implement shrink-to-fit either, so adding an
engine to the `e2e` project would not close this.

## B5 went partly vacuous the day the six panels landed

**Found during:** 27-02 Task 2, reading B5 against the new page shape rather than assuming
it survived the restructure.

B5 measures `document.getElementById('main')?.lastElementChild`. Before Plan 27-02 that was
the start-outcome block, always rendered. It is now `#s-bench`, the last of six
`role="tabpanel"` sections — and five of every six passes select a *different* panel, so
`#s-bench` carries the `hidden` attribute, `getBoundingClientRect()` returns all zeros, and
`0 <= barTopAtEnd` passes without measuring anything.

**So B5 is a real reading on the sixth surface pass and a vacuous one on the other five**,
at each of five widths in each of two states. It is not *lost* — the pass that selects
Benchmarks measures a visible panel against the bar exactly as before — but the count of
honest B5 readings per width went from two to two-of-twelve, and nothing in the file says
so at the point of the assertion.

**Not fixed here** for the same reason the footer gap was not fixed in 27-01: B5's subject
is UI-SPEC §6.3's wording (`#main`'s last element child), and widening it mid-plan would
make this plan's green depend on a property UI-SPEC has not agreed. Two edits would close
it together, which is an argument for doing them in one change rather than two:

**What would close it:** redefine B5 against *the last VISIBLE rendered element of the
page* — which subsumes the footer gap logged above — and assert that the element measured
was actually laid out (a non-zero box) so a `display: none` subject cannot satisfy it.

## UI-SPEC §7.2's contrast table is a prediction, and three of its rows are off

**Found during:** 27-02 Task 3, measuring the ported palette on the rendered page.

Measured at 1280px through `getComputedStyle`, composited on a canvas, WCAG 2.1:

| pair | UI-SPEC §7.2 predicts | measured | verdict |
|---|---|---|---|
| `--color-text` on `--color-bg` | 15.9:1 | **14.79:1** | both pass |
| `--color-muted` (70% mix) on `--color-bg` | 6.28:1 | **5.83:1** | both pass |
| `--color-bg` on `--color-accent-900` (the bar) | 14.6:1 | **12.56:1** | both pass |
| `--color-accent-700` on `--color-bg` | 5.79:1 | 5.78:1 | agrees |
| `--color-neutral-700` on `--color-bg` | 5.84:1 | 5.87:1 | agrees |

Every row still clears its threshold, so nothing is broken and nothing was changed on
account of it. What is worth recording is that the three disagreements all run the same
way — the prediction is optimistic — so a *future* pair predicted at just over 4.5:1 should
not be trusted to clear it without being measured.

**And one pair the table does not carry at all**, which the port had to decide:
`--color-bg` on `--color-accent` — the `.btn-primary` combination UI-SPEC §1.5 reserves the
accent for — measures **3.71:1** and fails at the 14px label size. `.btn-primary` therefore
takes `--color-accent-700` (measured 5.78:1) and the contrast block asserts that pair by
name.

**What would close it:** an edit to UI-SPEC §7.2 replacing the predicted column with the
measured one, and adding the `.btn-primary` row. That is UI-SPEC's edit to make, not this
plan's.

## UI-SPEC section 9's P3, as written, cannot fail — measured under a plant

**Found during:** 27-03 Task 3, arranging P3 before writing it.

Section 9 states P3 as *"every `data-kind="reading"` region's trimmed text equals its
`data-absence`, and matches `/^\D*$/`"*. `render.ts`'s `paintAbsence` writes the sentence
into `textContent` and mirrors it onto `data-absence` in the same call — it must, because a
region has three different absence sentences for three different states — so the first half
of that comparison is true by construction.

**Measured, not argued.** One plant, `sentenceFor` returning
`.replace('node is stopped', 'node is off')`, and both formulations read against the same
page in the same planted state:

| formulation | regions examined | violations | exit |
|---|---|---|---|
| UI-SPEC's, `text === data-absence` | 4 | **0** | 0 |
| the guard's, `text === REGIONS[id].absence.stopped` | 4 | **4** | 1 |

`demo-regions.e2e.test.ts` therefore compares against the committed catalogue and nowhere
uses `getAttribute('data-absence')` as an expected value; a grep acceptance clause holds it
at 0. The `data-absence` attribute stays, as a mirror a reader can inspect.

**What would close it:** an edit to UI-SPEC section 9's P3 row replacing *its `data-absence`*
with *the catalogue's sentence for its current state*, and to section 3, which describes
`data-absence` as if a region had one sentence rather than three.

## UI-SPEC section 3 puts the catalogue where no spec can import it

**Found during:** 27-03 Task 1.

Section 3 says *"the catalogue lives at `packages/browser/demo/regions.ts`"*. Two reasons it
cannot: `tab-api.ts`'s own opening docblock gives the rule for `src/` — one definition for the
page and the harness, because a mismatch otherwise surfaces only as a timeout inside
`page.evaluate` — and, decisively, `demo/` is outside **every** vitest project's include glob
(`packages/*/src/**`), so a catalogue there could not be imported by the guard at all. It
lives at `packages/browser/src/demo-regions.ts`.

**What would close it:** an edit to UI-SPEC section 3's path.

## UI-SPEC section 4.4's shard-partials absence has copy, no row, and no place in the 91

**Found during:** 27-03 Task 1, transcribing the pi surface.

Section 4.4's prose names an absence — *"No per-shard partials: the reading this page
receives carries the aggregate and not the shard rows."* — and gives it no row in the table
and no place in the tally. The table is P1..P14 and the closing paragraph counts pi at 14.
Adding it would make the surface 15 and the catalogue 92, against a tally UI-SPEC states
about itself and the guard checks. It is **not** in `REGIONS`; the pattern it belongs to is
still under guard through `primes/per-shard` (N9), which does have a row.

**What would close it:** either a P15 row in section 4.4 with the tally moved to 92, or a
sentence in section 4.4 saying the shard-partials copy is prose rather than a region.

## Three of UI-SPEC section 4.6's cells describe a state rather than quoting a sentence

**Found during:** 27-03 Task 1.

F17's two cells read *"always readable — three booleans, no node needed"* and *"unchanged"*;
F18's stopped cell reads *"readable with no node: `asked` is zero and the copy says nobody was
asked"*; F19's says *"as F18"*. Every reading needs a sentence to paint before it has a
reading, so three were composed and each is marked `COMPOSED` at its entry rather than passed
off as a transcription:

- `fabric/isolation`, both arms — *Not read: the page has not yet taken this tab's isolation reading.*
- `fabric/start-reached` and `fabric/start-tallies`, stopped — *Nobody was asked: no peer has been asked for a start outcome.*

**What would close it:** UI-SPEC section 4.6 quoting a sentence in those three cells, or
adopting these.

## `session/relay`'s unavailable arm is unreachable

**Found during:** 27-03 Task 2, writing the stopped-wins rule.

UI-SPEC H3's unavailable copy — *No relay: this page was served by a static host, which runs
none.* — is shown when `discoverRelays()` reports `source: 'none'`. But a page with no relay
cannot start a node, so `activity()` is null in exactly the states in which that sentence is
true, and the writer's stopped-wins rule paints the stopped sentence instead. The arm is in
the catalogue, is digit-free, ends in a full stop, and nothing renders it.

Stopped-wins is deliberate and is not the thing to change: without it a safe reading could
paint an unavailable arm while the node is stopped, and P3 would have to accept two sentences
per region.

**What would close it:** either UI-SPEC dropping H3's unavailable arm, or a state in which a
node outlives its relay discovery — which would also make it reachable.

## The Benchmarks lede quotes a planning identifier on a visitor-facing page

**Found during:** 27-03 Task 2, reading P2's offender list.

`#s-bench`'s lede says *"The figures themselves land with Plan 27-09"*. P2 found it because
`27-09` carries digits. It is declared as `bench/prose-provenance` rather than reworded:
rewording another plan's surface to make this plan's guard green is the failure this guard
exists to prevent, one level up. A visitor has no way to resolve a plan identifier.

**What would close it:** Plan 27-09 replacing that sentence when it lands the figures.

## Two diagnostic pairs were dropped from the session header

**Found during:** 27-03 Task 2.

`setFacts` rendered `relay source` and `secure context` beside the three declared readings.
Neither is among UI-SPEC section 4.0's five regions and no spec reads `#facts`, so both are
gone: an undeclared pair sitting beside three declared ones, on the one header whose whole
point is that every figure is declared, is the wrong thing to leave behind. `#state` and
`#explain` carry what a blocked visitor needs.

**What would close it:** a sixth session region in UI-SPEC section 4.0 if the secure-context
reading is judged worth declaring — `TabApi.isolation()` already carries neighbouring facts
on the Fabric-state surface.
