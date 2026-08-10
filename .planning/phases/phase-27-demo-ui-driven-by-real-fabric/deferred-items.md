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
