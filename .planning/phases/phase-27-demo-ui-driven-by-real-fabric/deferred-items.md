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

## C15 and C17 have no catalogue sentence for "the ladder settled nothing"

**Found during:** 27-04 Task 1.

UI-SPEC section 4.2 gives C15's unavailable arm as *"the absence arm, rendered per §5.1"* — a
sentence the kernel composes from a receipt — and leaves C17's unavailable cell empty. Both
read `best.*`, and when the ladder settles no rung at all there is no `best`, so there is no
receipt and no manifest and **no sentence in the catalogue for the state**. Rendering the
`initial` arm there would say *the search has not been run* immediately after running it,
which is the class of untruth this phase exists to remove. So two were composed, both marked
`COMPOSED` in `packages/browser/demo/surfaces/colouring.ts`:

- `colouring/attestation` — *Not established: the fabric settled no rung, so no run produced a
  receipt to read.*
- `colouring/egress` — *Not read: the fabric settled no rung, so no manifest was read back for
  this workload.*

Neither is in `REGIONS`, because the catalogue's `unavailable` arm is defined as *the arm
UI-SPEC names a literal sentence for*, and UI-SPEC names none here.

**Untested, and said rather than left to be found:** the two-tab run in
`demo-liveness.e2e.test.ts` settles, so this branch is reached only by
`colouring-surface.node.test.ts`'s *says the fabric settled nothing rather than that nothing was
run* case, in a unit context. No browser has rendered either sentence.

**What would close it:** UI-SPEC section 4.2 quoting a sentence in C15's and C17's unavailable
cells, or adopting these two.

## P5b exempts the two regions whose catalogue entry holds no unavailable arm

**Found during:** 27-04 Task 3.

P5's second arm — *no reading region still equals its `initial` or its `stopped` sentence after
a run* — cannot apply to a region the catalogue gives no third sentence, because there would be
nothing else for the page to render. Today that exempts exactly `colouring/attestation` and
`colouring/egress`, and both are covered by name in the specific-assertion block instead. The
exemption is derived from the catalogue rather than from a list, so it shrinks on its own if
UI-SPEC ever supplies those two cells — but it also grows on its own if a later surface lands a
reading with no unavailable arm, and nothing reports that it grew.

**What would close it:** an assertion bounding the exempt set, once the surfaces that would
populate it exist.

## `#run-status` puts an undeclared digit on screen after a run

**Found during:** 27-04 Task 2.

`#run-status` reads `settled n = 500` once the ladder stops. UI-SPEC section 4.2 lists it under
*"unchanged and not counted as figure regions"*, alongside `#run` and the two text views, so it
carries no `data-region`. P2 does not catch it because P2 runs on the stopped page, where the
same element reads `start a node first`.

It is not a placeholder — the figure is a real reading of the run that just finished — but it
is a number inside `#main` with no declared ancestor, and the rule P2 enforces has no exception
for *the spec said this element does not count*.

**What would close it:** either a `control` row for `#run-status` in UI-SPEC section 4.2 with
the surface tally moved to 22, or P2 run on a populated page with a stated exemption list.

## Three π sentences were composed, because the catalogue's arm is false in that arm

**Found during:** 27-05 Task 1.

UI-SPEC §4.4 gives P7 one `unavailable` sentence — *No aggregate: a reduce was started and
no combine produced one.* — and §5.3 names it explicitly as the **sibling** of the lone-tab
case, i.e. the case where a reduce *was* started. In the lone-tab arm the sentence is simply
untrue, and a false sentence is worse than a composed one. Two more sit beside it. All three
are marked `COMPOSED` in `packages/browser/demo/surfaces/pi.ts`:

- `pi/combined`, lone-tab arm — *No aggregate: no reduce was attempted — see above.*
- `pi/combines`, reduce-started-and-nothing-combined arm — *No count: a reduce was started
  and no combine produced an aggregate, so the fabric reported no combine count.* `runPi`
  maps `combines` to `0` whenever `outcome.ok` is false, so the zero there is a sentinel and
  not a count.
- `pi/combines`, single-partial arm — *No combine was needed: a single partial is itself the
  aggregate.* `deriveReduceTree` promotes a lone child rather than wrapping it in a pointless
  combine, so this zero is *true* and still reads as a failure beside `combined: true`.

None is in `REGIONS`: the catalogue's `unavailable` arm is defined as *the arm UI-SPEC names
a literal sentence for*, and UI-SPEC names none for these three states. This is the same
shape as C15 and C17 one plan earlier.

**Coverage, stated:** the first is asserted by `demo-pi.e2e.test.ts`'s lone arm on a real
page. The second and third are reached only by `pi-surface.node.test.ts` — the two-tab
fixture combined, so no browser has rendered either.

**What would close it:** UI-SPEC §4.4 quoting sentences for P7's not-attempted arm and P9's
two zero-valued arms, or adopting these three.

## The reduce-tree diagram draws `treeDepth + 1` rows, not `treeDepth`

**Found during:** 27-05 Task 1.

UI-SPEC §4.4 says the diagram *"may render `treeDepth` rows"* and, one clause later, that
*"each row is labelled `map` / `lvl 1` …"*. The two cannot both hold. `ReduceTree.depth`
counts the combine layers **above** the leaves — `depth: level - 1` in
`packages/core/src/reduce.ts`, where `level` starts at 1 for the first combine layer — so
`map` plus one row per layer is `depth + 1` rows. Drawing exactly `depth` rows would mean
either dropping the `map` row the same sentence asks for, or drawing one fewer combine layer
than the fabric built.

Measured on the two-tab run: `treeDepth=2 combines=4` over twelve leaves, which at the
default fanout is three combines at the first layer and one above them. The diagram drew
`depth 2 / map / lvl 1 / lvl 2`, and `demo-pi.e2e.test.ts` asserts that row set against the
depth the run reported rather than against a literal.

**What would close it:** UI-SPEC §4.4 saying `depth + 1` rows, or saying the row count is the
map layer plus the depth.

## `#pi-status` is digit-free by hand, and nothing enforces it

**Found during:** 27-05 Task 2.

The deferred item above about `#run-status` says the same thing about the colouring surface:
a status element inside `#main` carries no `data-region`, and P2 runs on the stopped page, so
an undeclared digit written there after a run is invisible to the guard. `#pi-status` was
written digit-free on purpose — `dispatching…`, `mapped — the reduce needs a second device`,
`an aggregate was produced`, `a reduce ran and produced no aggregate`, `the run stopped` —
and a comment beside the element says why, but **that is a convention and not a check**.

**What would close it:** the same thing that would close `#run-status` — P2 run on a
populated page with a stated exemption list, or a `control` row for each status element.

## P5's exempt set is 15 on the driven surfaces, and 27-04 recorded it as two

**Found during:** 27-05 Task 2, counting the set rather than reading the note about it.

27-04 logged that P5b exempts a region whose catalogue entry holds no `unavailable` arm, that
*"exactly two colouring regions are in that position today"* — C15 and C17 — and that the
exemption *"grows on its own … and nothing reports that it grew"*. The second half is right
and the first is wrong, which is exactly what the second half predicted would go unnoticed.

Counted from the committed catalogue, over the two surfaces P5 now drives:

| surface | exempt readings | count |
|---|---|---|
| colouring | `rung-300`, `rung-400`, `rung-500`, `attestation`, `egress`, `verify-verdict`, `verify-n`, `verify-triples` | **8** |
| pi | `terms`, `shards`, `complete`, `reduce-attempted`, `error-bound`, `elapsed`, `egress` | **7** |

So the set was already **8** when 27-04 called it two — the three lower rungs take C9's
sentence and the three verify readings share `COLOURING_NOT_CHECKED` in both arms — and π adds
seven more. Every one of the seven π regions is asserted by name in `demo-pi.e2e.test.ts`,
which is the same remedy and the same reason it is still worth logging.

**What would close it:** the assertion 27-04 already asked for, bounding the exempt set
against a committed list — with the list started at the fifteen above rather than at two.

## The v1.1 audit's G4 row says "two places only", and the tree now says five

**Found during:** 27-06 Task 2, running the audit's own grep rather than quoting its result.

The amended G4 row (`.planning/v1.1-MILESTONE-AUDIT.md` line 187) states that the five primes
symbols *"appear outside `packages/demo/src/primes.ts` in two places only — the barrel
`packages/demo/src/index.ts`, and one doc comment in `pi.ts`"*. Re-measured on 2026-08-10 over
`packages/` and `tools/`, `*.ts`, tests and `dist/` excluded:

| file | matches | on a code line | what it is |
|---|---|---|---|
| `packages/demo/src/primes.ts` | 6 | 6 | the definitions |
| `packages/demo/src/index.ts` | 5 | 5 | the barrel's re-export |
| `packages/demo/src/pi.ts` | 1 | 0 | the doc comment the row names |
| `packages/browser/src/demo-regions.ts` | 1 | 0 | **new** — Plan 27-03's Option B decision block |
| `packages/browser/demo/surfaces/primes.ts` | 4 | 0 | **new** — Plan 27-06's surface header |

**The row's conclusion is still exactly true and its arithmetic is stale.** *Zero production
callers* holds: eleven code-line matches, all of them in the module and the barrel, and neither
is a call. What has changed is that two later files now *name* the symbols in prose, both of
them explaining why nothing calls them — which is the phase doing what it was asked to do, and
is also how a mention count drifts away from a caller count without anybody noticing.

`demo-primes.e2e.test.ts` measures both numbers separately for that reason, and asserts the
file set rather than the count in each.

**What would close it:** an edit to G4's row replacing *"two places only"* with the mention set
and the caller set as two figures — or, better, a pointer to the spec, since the spec is
re-measured on every run and the row is not.

## The new `.citation` treatment is not in the contrast block's asserted pairs

**Found during:** 27-06 Task 1, adding the visual half of UI-SPEC section 0's cited/measured
split.

UI-SPEC section 4.3 requires N10 to render *"in the citation treatment
(`--color-neutral-700`), never in the Heading-size figure treatment a live reading uses"*, so
that a published figure and a measured one are distinguishable without reading the label. There
was no such class: `demo.css` had `--color-neutral-700` on `.card-note` and `.table th` only. A
`.citation` rule was added and `primes/oracle-table` carries it.

`demo-viewport.e2e.test.ts`'s contrast block asserts seven named pairs and **`.citation` is not
one of them.** The colour is the same custom property the table-header row measures at 5.87:1,
at 11px, and `.citation` renders at 13px — so it clears AA by more than the measured row does,
by arithmetic rather than by measurement. Nothing on the page is wrong; what is missing is the
assertion.

Nor does anything assert the *negative* half — that a `cited` region does not render in the
live-figure treatment. That is the half UI-SPEC actually cares about, and it is currently held
by the markup alone.

**What would close it:** an eighth pair in `demo-viewport.e2e.test.ts`'s contrast list naming
`#s-primes .citation`, and a property over every `[data-kind="cited"]` element asserting its
computed colour is `--color-neutral-700` and its font size is not the heading scale. Plan 27-09
lands the second block of cited figures and is the natural place for both.

## Nothing asserts that a surface in `WIRED_SURFACES` with no run control is *deliberately* so

**Found during:** 27-06 Task 1, reading P5's skip list after `primes` joined it.

P5 reports `[P5] skipped (no primary run control on the surface): session, primes` and asserts
nothing about the membership of that list. The skip is visible to a human reading the output and
invisible to the suite: a surface that *should* have a run control and lost it to a refactor
would move from `exercised` to `skipped` and the run would stay green, because
`expect(exercised.length).toBeGreaterThanOrEqual(1)` is satisfied by the other two.

That floor was right when one surface was driven. With four wired and two driven it is now weak
in a specific way — it cannot notice a driven surface becoming an undriven one.

`primes` being on that list is asserted indirectly and adequately by
`demo-primes.e2e.test.ts`'s *carries no run control at all* case, which also carries its own
floor. What has no guard is the other direction, for colouring and π.

**What would close it:** a committed expectation in `demo-liveness.e2e.test.ts` — the set of
surfaces that must be exercised and the set that must be skipped, each named, so a surface
crossing between them reddens and has to be explained.

## UI-SPEC §4.5's Y4 gives `-1` one meaning, and `runJob` produces it for two

**Found during:** 27-07 Task 1, and confirmed by measurement in Task 3.

Y4's row says *"`.partitions[]` (`-1` renders as `no agreement`, never as a number)"*. The
second half is absolute and is honoured. The first half is false of any module that does not
write a partition index: `main.ts`'s expression is

```ts
partitions: result.job.shards.map((s) =>
  s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1)
```

and `partitionOf` returns `-1` whenever `output.p` is not a four-byte value — which is every
module except `MODULE_WRITES_PARTITION`, the core fixture the field was written against.

**Measured 2026-08-10, twice.** Off a bench probe first: the demo's colouring kernel answers
`runJob`'s canonical `{a: <shard index>}` with `{c: 1024 zero bytes, s: [2]}` — a well-formed
partial at status `budget`, deterministic, no `p`. Then on a real two-tab dispatch:
`complete=true`, `failures=0`, and `partitions=[-1,-1,-1,-1,-1,-1]` with **six of six shards
agreeing**. Rendering UI-SPEC's sentence there would say *no agreement* directly beside
`every shard agreed: true`.

`surfaces/byo.ts` therefore reads `partitions[i]` beside `agreeing[i]`: `no agreement` when the
shard did not agree, and the composed *no partition index — this module's output carries no
such field* when it did. Both are asserted per shard in `demo-byo.e2e.test.ts`, which also
prints how many shards were in the second case.

**What would close it:** a second sentence in UI-SPEC §4.5's Y4 cell for the agreed-with-no-
index case, or a `TabJobReport` that distinguishes the two sentinels at source rather than
overloading `-1`.

## Two more sentinel zeros on the bring-your-own reading, and one true zero beside them

**Found during:** 27-07 Task 3, reading the refused arm off the screen.

Same shape as Y4 and both were on screen before they were caught:

| field | how the sentinel is produced | what it rendered |
|---|---|---|
| `replicas[i]` | `main.ts`: `status === 'agreed' ? s.verification.replicas : 0` | `shard 0: 0` beside eighteen refusals |
| `verificationMultiplier` | `submit.ts:3218`: `useful === 0 ? 0 : gross / useful` | `0.00×` — *verification was free* |

Both now read as sentences. `NO_COST_MEASURED` is **composed**, because UI-SPEC's Y7 row names
no unavailable arm — the same position C15/C17 and π's three were in.

**And the sweep that catches them has two stated exemptions**, because `byo/fetched` and
`byo/rejected` are `blockstore` counters whose zero is a real observation: this tab pulled no
block and refused none. Replacing those with prose would be replacing a measurement with a
sentence. `demo-byo.e2e.test.ts` names them and asserts each equals the run's own figure, so
the exemption is not a hole.

**What would close it:** UI-SPEC §4.5 quoting a sentence for Y7's nothing-agreed arm, or
adopting this one.

## The egress panel's withheld branch is still unreachable, and now for a measured reason

**Found during:** 27-07 Task 3. This is the branch Plan 27-07 was expected to make live.

`egressLines`' comment says the withheld branch has no caller because every cube
`runColouring` submits is `label: 'public'`, and that *"wiring `runJob` in later makes the
refusal branch live with no change to this code"*. `runJob` is wired. The branch did not fire,
and the reason is two layers deep — both measured on a real two-tab dispatch:

| owner id submitted | what happened | frames / bytes / violations |
|---|---|---|
| `o2-demo-byo-owner` | every shard **unplaceable** | 0 / 0 / 0 |
| `public` | placed, then refused at authorization | 12 / 6276 / **0** |

1. **`attestedNodes` in `packages/browser/demo/main.ts` hardcodes `ownerId: 'public'` on every
   descriptor it builds.** `eligibleNodes` (`packages/core/src/sovereignty.ts`) places a
   sovereign shard only on a node whose `ownerId` *equals* the shard's, so the only owner id a
   dispatch from this page can be placed for is the literal `public`, and every other one is
   correctly reported unplaceable — *a stalled sovereign shard is the correct outcome*.
2. **Even placed, the executors refuse before the input crosses.** The rendered reasons are
   `sovereignty violation: node … is not cleared to execute sovereign data for owner public`
   and `unauthorized: no pinned owner key for public on this node`. The twelve frames that left
   are dispatch RPC; the shard's canonical bytes never reached a peer, so the egress guard had
   nothing to hold back and reported none.

**The consequence worth stating plainly: `egressLines`' sentence *"this run registered no
sovereign data"* is not reliable on this path.** That run submitted six sovereign shards. The
sentence is true of what the guard *saw* and false of what the run *submitted*, and
`EgressManifest` carries no field that would let the function tell the two apart. It was left
alone on purpose — UI-SPEC §5.2 fixes that copy verbatim, P7 asserts against those exact
words, and four surfaces render it, so forking or rewording it here would be a second author
of the sentence that carries the sovereignty claim. The bring-your-own card says the limit in
its own prose instead, and `demo-byo.e2e.test.ts` records the branch on every run.

**What would close it:** either a `registered` count on `EgressManifest` and a third arm in
`egressLines` (with UI-SPEC §5.2 and P7 amended together, in one change), or a tab that can be
handed a real owner identity — which today `TabApi.start` deliberately has no parameter for,
and which is an owner decision rather than a plan's.

## P5b's exempt set grew by nine with bring-your-own, and P5 still does not report it

**Found during:** 27-07's plant C.

The entry above about the exempt set predicted this and it happened. Dropping
`byo/verification-multiplier` from the surface's record left that region painted with its
`stopped` sentence on a page that had just dispatched — and `demo-liveness.e2e.test.ts`
**stayed green at exit 0**, because Y7's catalogue entry holds no `unavailable` arm and P5b
exempts exactly those. Nine of the eleven bring-your-own readings are in that position (Y3,
Y4, Y5, Y7, Y8, Y9, Y11, Y12, Y13), so the set is now **24** across the three driven surfaces
rather than the fifteen counted in 27-05.

Two things did move and neither is asserted: `[P5] 37 of 39` fell to `36 of 39`, and
`[P6] examined 5` fell to `4`. Both are reported to stderr and read by a human.

What caught the plant was `demo-byo.e2e.test.ts`, at exit 1 in two cases — the same remedy π
used, and the same reason it is still worth logging: the coverage is in the surface's own spec
rather than in the property that claims to be generic.

**What would close it:** the assertion 27-04 first asked for, bounding the exempt set against a
committed list — started at the twenty-four above — plus a floor on `[P5] N of M` so a
population that falls reddens instead of being printed.

## The attestation hook is one value and there are now two attestation regions

**Found during:** 27-07 Task 2, watching `[P8] examined 1` become `2`.

P8 compares **every** populated `/attestation` region against a single reading, taken from
`window.__o2LastAttestation` **after the whole P5 loop has finished**. With one such region on
the page that was exact. With two it is not: `demo-liveness.e2e.test.ts` snapshots the
colouring panel before it drives bring-your-own, so P8 compares a receipt rendered from the
colouring run against a hook holding the bring-your-own run's.

It passes today, and it passes for a reason that is close to luck: both runs are the same two
tabs at redundancy two with neither enrolled, so both produce the same absence arm and the same
`reason` naming the same two node ids in the same order. A run where the two differ — a
different peer set, a different order, one surface enrolling — would redden P8 with a message
about a page that has composed a sentence of its own, which would be false.

**What would close it:** a per-surface hook. The page publishes
`window.__o2LastAttestation` as a map keyed by surface, and `p8` in
`demo-region-properties.ts` reads `bySurface[region.surface]` with the flat value as a
fallback. Both harnesses pass the hook through as an opaque JSON string, so neither
`demo-liveness.e2e.test.ts` nor `demo-regions.e2e.test.ts` needs an edit.

## `#byo-status` is the third digit-free-by-hand status element

**Found during:** 27-07 Task 2.

`#run-status` and `#pi-status` already have entries above. `#byo-status` is the third: it sits
inside `#main`, carries no `data-region`, and P2 runs on the stopped page where it reads `start
a node first`. Its strings are digit-free by hand — `dispatching…`, `every shard agreed`, `the
fabric refused at least one shard — its own words are below`, `the run stopped`, `ready` — and
a comment beside the element says why, but that is a convention and not a check.

`#byo-validity` is a fourth element of the same kind, and it is worse in one respect: its text
is composed at runtime from field labels, so a future field whose label carried a digit would
put one on screen with nothing to notice. Every label today is digit-free.

**What would close it:** the same thing that would close the other two — P2 run on a populated
page with a stated exemption list, or a `control` row for each status element.

## UI-SPEC §4.6's F17 cells say "always readable"; `render.ts`'s stopped-wins rule says otherwise

**Found during:** 27-08 Task 1, checking the three F-row sentences Plan 27-03 composed against
what this surface actually renders — which is the check 27-03's own entry above asked for.

F17's cells read *"always readable — three booleans, no node needed"* and *"unchanged"*.
`render.ts`'s header states the opposite rule and **names this reading in it**: *when
`activity() === null`, every reading region paints its `stopped` sentence — including the
readings that are safe to call with no node (`discoverRelays`, `verifyAnswer`, `isolation`,
`startReport`)*. That is not decoration. P3 in `demo-regions.e2e.test.ts` runs on a page with no
node and compares every reading region against the catalogue's stopped sentence.

**Measured, both directions, under a plant.** Passing `isolation: window.o2.isolation()` into the
stopped branch of `refreshFabric` — one line — turns both guards red with the same text:

```
fabric/isolation: on screen "cross-origin isolated: no · SharedArrayBuffer: no · in an iframe: no"
  — the catalogue says "Not read: the page has not yet taken this tab's isolation reading."
```

`demo-regions.e2e.test.ts` exit **1** (`1 failed | 16 passed`), and `demo-fabric.e2e.test.ts`'s
no-node arm exit **1** on the same line. So UI-SPEC's F17 cells, taken literally, are a page that
fails a committed guard.

**Stopped wins was chosen, and the page therefore does not take the reading while stopped.** The
composed sentence says the page has not read it, and that sentence is true only if the page has
not — calling `isolation()` and hiding the answer behind it would have been the cheaper
arrangement and a false one. With a node running the three booleans are on screen and
`demo-fabric.e2e.test.ts` asserts them character for character against a fresh reading.

**What would close it:** UI-SPEC §4.6's F17 cells saying what the page does — *the booleans while
a node is running; the stopped sentence otherwise, because stopped wins* — and adopting the
composed sentence, or naming one. The same edit closes 27-03's *"Three of UI-SPEC section 4.6's
cells describe a state rather than quoting a sentence"* for F17; F18's and F19's composed
sentences were checked in the same pass and **are** what the page renders, both read off the
screen (`Nobody was asked: no peer has been asked for a start outcome.`).

## A whole surface — twenty-one regions — is outside P5, P6, P7 and P8

**Found during:** 27-08 Task 2, measuring what appending `'fabric'` to `WIRED_SURFACES` bought.

`demo-liveness.e2e.test.ts` collects `[data-region]` elements from the panels it **drove**, and it
drives a surface only when that surface offers a `.btn-primary`. Fabric state offers none by
design — UI-SPEC §11: *the surface reads, it does not run* — so it lands in P5's skipped list and
contributes **nothing** to P5a, P5b, P6, P7 or P8. Measured before and after the surface landed,
same run shape, unedited harness:

| | before 27-08 | after 27-08 |
|---|---|---|
| `[P5] skipped` | `session, primes` | `session, primes, fabric` |
| `[P5] N of M` | `37 of 39` | `37 of 39` |
| `[P6] examined` | 5 | 5 |
| `[P7] examined` | 3 | 3 |
| `[P8] examined` | 2 | 2 |

**So the P5b exempt-set count did not move: it is still twenty-four**, over the three driven
surfaces. That number is now misleading in a way worth writing down, because the honest figure is
larger and points somewhere else: **sixteen of the fabric surface's twenty-one readings hold no
`unavailable` arm** — `peers-all`, `compute-peers`, `held-peers`, all three attestation regions,
all three egress regions, `duty-user`, `slots`, all three governor regions, `isolation` and
`blocks` — and they would every one of them be exempt if P5 ever saw them. Counting only the
driven surfaces makes a surface that is *entirely* unguarded by P5 look like it costs nothing.

Coverage is instead in `demo-fabric.e2e.test.ts`, which asserts all twenty-one by name in the
stopped arm, asserts the live ones by convergence against a fresh `window.o2` reading, and runs
P6, P7 and P8 over the panel itself (`examined 1 / 1 / 1` after a colouring run). That is the same
remedy π, primes and bring-your-own each used, and the same reason it is still worth logging: the
coverage is in the surface's own spec rather than in the property that claims to be generic.

**What would close it:** the assertion 27-04 first asked for, bounding the exempt set against a
committed list — and, for this case, a committed expectation of which surfaces P5 must exercise
and which it must skip, so *the whole surface is invisible to five properties* is a stated fact
rather than a thing somebody re-derives.

## `#duty-status` is the fifth digit-free-by-hand status element, and the first that must carry a digit

**Found during:** 27-08 Task 2.

`#run-status`, `#pi-status`, `#byo-status` and `#byo-validity` already have entries above: inside
`#main`, no `data-region`, and P2 runs on the stopped page where each reads a digit-free literal.
`#duty-status` is the fifth and it differs in one respect that makes it worse. The other four are
digit-free *by convention*; this one **renders a digit by design**. It carries the governor's
`RangeError` verbatim, and that message names the value it refused:

```
dutyCycle must be in (0, 1], got 0
```

Read off the page, in the fabric's own words, by `demo-fabric.e2e.test.ts`. Paraphrasing it to
avoid the digit would be the page composing a sentence over a refusal, which is the failure UI-SPEC
§11's error-state row exists to prevent — so the digit stays and the gap is recorded instead.

**What would close it:** the same thing that would close the other four — P2 run on a populated
page with a stated exemption list — plus, for this element specifically, an exemption entry saying
that a quoted refusal may carry a figure the fabric put in it.

## `egressLines`' sovereign sentence now has a fifth renderer, and 27-08 deliberately did not fix it

**Found during:** 27-08 Task 1. This restates the 27-07 entry above with what changed.

The fabric surface's F11 renders `egressLines` over the **last run's** manifest, whichever surface
produced it. When that run was a sovereign bring-your-own dispatch, this surface renders *"this
run registered no sovereign data"* about a run that submitted owner-pinned shards — the exact
unreliability 27-07 measured, now on one more screen. Read off the fabric panel after a colouring
run, where the sentence is **true**:

```
What left this device:
  34 frames sent, 31598 byte(s) total.
  0 withheld — and this run registered no sovereign data, so that is the
  guard reporting it had nothing to hold back, not a proof of sovereignty.
```

**It was left alone, and the reason is that fixing it here would have made it worse.** UI-SPEC §5.2
fixes the copy verbatim, `EGRESS_SENTENCES` in `demo-region-properties.ts` asserts those exact
words, and five surfaces now render them. A third arm added on this surface alone would make
`surfaces/fabric.ts` a second author of the sentence that carries the project's core claim, which
is precisely the failure the one-region-one-function rule exists to stop. The card states the limit
in its own prose beside the reading instead.

**What would close it, and it is one change across four contracts rather than four changes:** a
`registered` count on `EgressManifest` (`packages/net/src/egress.ts`), counted where the guard
registers a sovereign CID; a third arm in `egressLines`; the amended sentence in UI-SPEC §5.2; and
the matching entry in `EGRESS_SENTENCES`, with `demo-byo.e2e.test.ts`, `demo-pi.e2e.test.ts`,
`demo-fabric.e2e.test.ts` and `demo-liveness.e2e.test.ts` re-read in the same pass. It is a
Rule 4 boundary — a new field on a type in another package — and Plan 27-10 is where it belongs.

## `addresses().webrtc` reports one address twice, and F21 renders it twice

**Found during:** 27-08 Task 3, reading F21 off the screen rather than counting its lines.

The two-tab fixture's tab reported three dialable addresses and two of them are byte-identical:

```
/ip4/127.0.0.1/tcp/52359/ws/p2p/12D3KooWHRm…/p2p-circuit/webrtc/p2p/12D3KooWM2B…
/ip4/127.0.0.1/tcp/52359/ws/p2p/12D3KooWHRm…/p2p-circuit/webrtc/p2p/12D3KooWM2B…
/ip4/127.0.0.1/tcp/52359/ws/p2p/12D3KooWHRm…/p2p-circuit/p2p/12D3KooWM2B…
```

The duplicate is in `BrowserNode.webrtcAddrs`, not in the formatter — `surfaces/fabric.ts` joins
the list it is handed and adds nothing. **It was not de-duplicated**, and that is a decision rather
than an omission: the node really does advertise the address twice, and a page that quietly
collapsed the list would be editing a reading to make it look tidier than the fabric is. A reader
seeing it twice is seeing something true.

**What would close it:** either `BrowserNode` de-duplicating what it advertises — which is where
the duplicate is and where a fix would also change what peers are told — or a stated decision that
F21 shows the advertised set as advertised, added to UI-SPEC §4.6.

## `dl { grid-template-columns: max-content 1fr }` makes a long `<dt>` a B1 defect

**Found during:** 27-08 Task 2, and B1 caught it, so this is a note rather than a gap.

A `<dt>` never wraps under that rule: its whole phrase sets the first track's width. The fabric
panel's first draft used sentences as labels — *peers held over a connection that can carry a job*
— and `demo-viewport.e2e.test.ts` went red at 320 **and** 360 with `documentElement.scrollWidth
388` at both, the same figure twice because it is an intrinsic width rather than a viewport one.
The labels are terse now and the explanation is in the card note, which wraps.

Worth recording only because the rule is invisible at the call site and the failure looks like a
responsive-layout problem rather than a copy-length one. B1 is a real guard here and it fired
before anything shipped.

## B5 measured a hidden box on 50 of 60 combinations, and `#measurements` is still outside it

**Found during:** 27-09 Task 1, by printing what B5 measured rather than by a failure.

`demo-viewport.e2e.test.ts` took `#main`'s literal `lastElementChild`, which is
`section#s-bench`. That panel is `hidden` on five of every six passes of the surface loop, and a
`display: none` box measures all zeros — so `mainLastBottom` read `0.00` and `0 <= barTop` was
green without measuring anything. Observed, before the fix:

```
[B5] 320px / idle / surface 1 of 6: measured section#s-bench bottom=0.00 barTop=632.41
```

**Fixed here**, by taking the last child of `#main` with a client rect — the panel the visitor is
looking at. After: `0` of 60 combinations read zero, and the tag varies per pass
(`section#s-colouring`, `section#s-primes`, …). Recorded rather than left silent because the fix
edits a spec outside this plan's `files_modified`, and because it is the second time this file's
readings have been more vacuous than they looked.

**Still open, and unchanged by that fix:** `#measurements` — the footer carrying the link to the
perf report — is a **sibling** of `#main`, not a child, so B5 is silent about it in both forms.
27-01 measured the footer's bottom under the bar at all three narrow widths with B5 green
throughout. `footerBottom` is still read and still not asserted. Closing it needs UI-SPEC §6.3 to
say whether B5 is about `#main` or about the end of the page.

## The bar's three regions are declared but nothing checks their elements

**Found during:** 27-09 Task 1, while appending `'bar'` to `WIRED_SURFACES`.

B1, B2 and B3 have been in the catalogue since 27-03 and until this plan **no element on the page
carried their `data-region` ids**. The attributes went onto `#bar-what`, `#bar-stats` and `#stop`
so that appending `'bar'` was a true admission rather than a greppable one.

**It buys no coverage today, measured rather than assumed.** P1b is the only property scoped to
`WIRED_SURFACES`, and it runs in `demo-regions.e2e.test.ts` on a page with **no node**, where
`#bar` is absent and `absenceMode: 'element-removed'` skips all three. The examined count moved
`99 → 102` — bench's two regions and its prose line — and *not* by the bar's three:
`[P1b] examined 102 of 105 catalogue entries (… #bar absent)`.

**What would close it:** a P1b pass on a page with a node running. `demo-liveness.e2e.test.ts`
already has that page and already imports `REGIONS` and `WIRED_SURFACES`; the missing piece is one
case there asserting every catalogue entry of a wired surface resolves to exactly one element while
`#bar` is visible. That is the only run in which the bar's three regions are checkable at all.

## The Benchmarks surface's provenance line does not match the document's own sentence

**Found during:** 27-09 Task 1, comparing UI-SPEC §4.7 requirement 1 against the committed
document's header.

The document opens *"Measured 2026-08-02 on one machine: 8 physical cores, Node 23.11, V8's
built-in WebAssembly. Every number below was produced by a run recorded here; none is an estimate,
and the ones that disagreed with what was predicted are marked as such."*

UI-SPEC's fixed copy is *"Measured 2026-08-02 on one machine — 8 physical cores, Node 23.11, V8's
built-in WebAssembly. Every figure on this screen comes from that recorded run. None of them is a
reading from your tab."*

They differ in the punctuation of the first sentence and entirely in the second. **UI-SPEC's is
what ships**, because §11 fixes it and a plan that quietly reworded a fixed string would be editing
the copywriting contract from inside a surface. The disagreement is reported here rather than
reconciled. Every figure in the shipped line — the date, the core count, the engine version —
occurs in the document, so P9 covers it either way.

**What would close it:** one edit to UI-SPEC §4.7 stating that the line is the contract's own
wording and not a quotation of the document's header.

## 2026-08-10 — B5 read its boxes off the end of the page, and Phase 27 merged with `--project e2e` red

**Found during:** Phase 28, by running `npx vitest run --project e2e` — exit 1, `28 files, 1
failed / 27 passed`. **Fixed** in `dde1ff5`; this entry is the record, including the part that is
about process rather than about pixels.

### What it was

`measure()` scrolled to the end of the page, yielded **two animation frames**, and only then read
the boxes. The page is live across those frames. `reconcile` runs on a 1000 ms interval and
rewrites the fabric surface from the node's own readings, so while `#s-fabric` is on screen and
the node is still acquiring its relay and WebRTC addresses, `fabric/addresses`,
`fabric/peer-rows` and `fabric/relayed-only` turn from one-line absence sentences into multi-line
lists. Measured: **the document grew 703 px at 393 and 663 px at 360 inside that window.**
Chromium leaves `scrollY` where it was, so the page was no longer at its end, and every
viewport-space box below the fold was displaced downward by exactly the shortfall.

### It was the assertion, not the page, and the arithmetic is what says so

A temporary reading of `scrollY`, `scrollMax` and the document height was added on both sides of
the two frames. **Every combination with `short=0.00` passed; only combinations with `short>0`
failed, in every run.**

```
[B5diag] 360px / idle / surface 5 of 6: docH 5783->6446 scrollY=5376 max=5726 short=350.00
[B5diag] 393px / idle / surface 5 of 6: docH 5450->6153 scrollY=4911 max=5433 short=522.00
```

Subtract the shortfall and the failing readings land inside the band their own width produced:

| combination | reported bottom | shortfall | corrected | that width's band |
|---|---|---|---|---|
| 393 / idle / surface 5 | 973.83 | 522.00 | **451.83** | 451.47 – 452.25 |
| 360 / idle / surface 5 | 802.06 | 350.00 | **452.06** | 451.42 – 452.20 |
| 393 footer, same read | 1106.02 | 522.00 | **584.02** | 583.66 – 584.44 |
| 360 footer, same read | 934.25 | 350.00 | **584.25** | 583.61 – 584.36 |

Nothing was covered. **That it is not the panel's height is a second reading rather than an
inference:** at 393/`loaded` the same panel is 172 px *taller* than the failing idle reading —
5256.97 against 5085.22 — and B5 is green there, because at the true end of the page the last
child's bottom is pinned by the document's trailing padding and the footer, not by the panel.

**Shape of the failing set, which is the diagnostic.** One or two of 60, never more; always
`section#s-fabric`, the one surface whose content arrives asynchronously; always the `idle` pass,
which is the earlier of the two and runs while the addresses are still landing. It moved between
runs — 393 alone in the first, 360 and 393 in the second — so it is a race, and a red that names
a different combination each time was never going to be a layout constant.

### The defect is older than the plan that exposed it

`window.scrollTo(0, document.body.scrollHeight)` followed by two frames is **original to 27-01**
(`d7a20f0`). It was harmless only because B5 measured a `display: none` box on 50 of 60
combinations. 27-09 (`064d0fe`) made B5 measure a rendered box, and the pre-existing instrument
defect became reachable — with the fabric surface, which had not been the measured child before,
now the measured child on one pass in six. **27-09 did not introduce this; it removed the vacuity
that was hiding it.** Its own "all 60 green in both runs" reading is consistent with that: the
race needs the addresses to land inside a ~32 ms window, and it does not fire every run.

### The fix, and what was deliberately not done

The scroll and every box below it are now **one synchronous turn** — a timer callback cannot
interleave between a synchronous `scrollTo` and a synchronous `getBoundingClientRect`, and both
`scrollHeight` and the rects flush layout before they answer. Two latent instances of the same
defect rode along: the target is now the **scrolling element's** `scrollHeight` rather than
`document.body`'s, which in standards mode is the body's own content box and can be shorter than
the document's scrollable height; and `behavior: 'instant'`, so the guarantee does not rest on the
page never setting `scroll-behavior: smooth`.

**Nothing was narrowed, and B5's precondition is now asserted rather than assumed.**
`endShortfall` is read in the same turn as the boxes and required to be `<= 1`, so a reading taken
off the end of the page reddens *by name* instead of arriving as a false covering. Relaxing B5
back toward vacuity was available and was not taken — it is the failure this property has already
had once.

Three plants, one at a time, each restored by the surgical inverse of its own edit and verified
with `cmp`:

| plant | result |
|---|---|
| `#bar { min-height: 320px }` | **B5 red at all 60**, `short=0.00` throughout — the property still bites |
| scroll to `scrollHeight - 200` | **green, and for the wrong reason**: `200 < clientHeight`, so it clamped to the end anyway. Written down rather than quietly re-rolled |
| scroll to `scrollMax - 200` | **`endShortfall` red at all 60**, and it manufactured **54 false "the bar covers it" findings out of 60** — the observed bug, on demand |

### The process finding, which matters as much as the fix

**Phase 27 merged with `--project e2e` red, and no wave ran that project to completion.** Every
e2e invocation recorded across all ten Phase 27 summaries is **file-scoped** — `--project e2e
demo-viewport`, `--project e2e demo-regions`, `--project e2e` × 6 named files, and so on. A grep
for a bare `--project e2e` with no file argument returns **nothing in any of the ten**. The merge
commit says so in its own subject line: *"Merge Phase 27 — the demo driven by the real fabric, and
the suite nobody ran"* (`5422f9e`).

A per-file run cannot see this class of defect at all. The failure needs the whole project's
timing — and more to the point, a suite that is only ever run in slices has no run in which
"green" means the suite is green. The red then survives a merge, and the next phase inherits it
and has to spend a control arm establishing that it did not cause it, which Phase 28 Plan 02 did.

**What would close it:** one bare `npx vitest run --project e2e`, exit code read directly, as a
gate before a phase merges — not a slice, and not a composite background command, which returned
shell exit 0 while the e2e project inside it exited 1 during Phase 28.

### And a sharper statement of the `#measurements` gap already logged above

Planting `padding-bottom: 0` on the rule whose own comment reads *"Bottom padding clears the fixed
bar… B5 in `demo-viewport.e2e.test.ts` is what measures whether it is enough"* put the footer
under the bar on **all 60** combinations — `footerBottom` ~720 against `barTop` 592.75 / 606.03 /
613.81 / 632.41 / 655.00, i.e. under by 65 to 127 px — and **B5 caught 6 of 60**, all at
768/`loaded`, the one bar tall enough that `#main`'s own last child crossed it too.

So the gap is not merely that B5 is silent about the footer. **Deleting the entire line the
comment says B5 holds leaves B5 green on 54 of 60.** `footerBottom` is now printed on the `[B5]`
line on every run so the number is in front of a reader rather than in an interface comment. It is
still **not asserted**, for the reason 27-01 and 27-09 both gave: widening the property needs
UI-SPEC §6.3 to say whether B5 is about `#main` or about the end of the page. **What would also
close it:** correcting `demo.css`'s comment, which currently names a guard that does not hold it.
