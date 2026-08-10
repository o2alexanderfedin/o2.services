---
phase: 27-demo-ui-driven-by-real-fabric
plan: 1
subsystem: browser-demo
tags: [brow-04, ui-spec-6.2, ui-spec-6.3, viewport-geometry, grid, touch-target, playwright, mutation-proof]
dependency-graph:
  requires: []
  provides:
    - packages/node/src/demo-viewport.e2e.test.ts (B1-B7 of UI-SPEC 6.3 plus B2b and B2c,
      at 320/360/393/768/1280 x 720, in two bar states, over an enumerated surface list
      that degrades to one pass; soft assertions so one run reports every property)
    - "UI-SPEC 6.2's grid contract in packages/browser/demo/index.html: two-column grid,
      minmax(0, 1fr) auto, 44x44 #stop, safe-area block padding, .spacer removed"
    - "the measured answer to the roadmap's mobile defect: in Chromium at a pinned
      viewport the unfixed bar FITS at every width -- one property was red, #stop's
      66.77 x 37.44 against B3's 44x44 target"
    - "the falsification of UI-SPEC 6.2's mutation proof: min-width: 0 is inert under
      minmax(0, 1fr), across three plant arms, not one box moved"
  affects:
    - Plan 27-02 (restructures the page into six surfaces; this spec covers all six the
      day nav#surfaces [role=tab] exists, with no edit -- and B5's arithmetic holds only
      while that nav is position: sticky rather than fixed)
    - "UI-SPEC 6.2 and 6.3 (two corrections owed, logged in deferred-items.md: the
      min-width: 0 mutation proof, and B5's blindness to the footer outside #main)"
tech-stack:
  added: []
  patterns:
    - one BrowserContext per viewport rather than page.setViewportSize, because Playwright
      only accepts deviceScaleFactor at context creation
    - the whole measurement inside ONE page.evaluate, with the bar-state strings re-applied
      immediately before each layout read, because reconcile() rewrites #bar-what and
      #bar-stats on a 1000ms interval and would clobber a state written by a prior round trip
    - expect.soft for every property, so one run reports every violated assertion at every
      width in both states instead of stopping at the first
    - "surface enumeration that degrades to one pass: Math.max(1, nav#surfaces [role=tab])"
    - "bar states derived from the page's own templates rather than invented, with the
      branch each clause came from named in a docblock"
key-files:
  created:
    - packages/node/src/demo-viewport.e2e.test.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
  modified:
    - packages/browser/demo/index.html
decisions:
  - "B2b and B2c were ADDED beyond UI-SPEC 6.3's table, and the sharpest measurement in
    this plan is why. A 600px child planted inside a 320px viewport left B1, B2 AND B3
    green: #bar is position: fixed, so its overflow reaches neither
    documentElement.scrollWidth, nor its own border box, nor the grid tracks that place
    #stop. Every property the table lists was green over a bar three hundred pixels too
    wide. B2b measures the children's boxes against #bar's padding box; B2c measures each
    child's scrollWidth against its own clientWidth."
  - "The required Plant 1 came back GREEN and is reported as green rather than replaced by
    a plant that reddens. Removing min-width: 0 from #bar-what moved nothing; removing it
    with white-space: nowrap forced on produced readings identical to the pixel to the same
    plant with the line kept; removing it from the #bar-stats row that spans both tracks
    likewise. UI-SPEC 6.2 calls the line load-bearing and requires its removal to redden
    6.3 -- that claim is false under 6.2's own grid, because a grid item's automatic
    minimum size is content-based only when it spans a track whose MIN track sizing
    function is auto, and minmax(0, 1fr) fixes that min at 0."
  - "The plan's predicted RED did not occur and the observed RED is narrower. The plan and
    the roadmap expected B2 and B3 to fail at 393 with #bar wider than the viewport and
    #stop past its right edge. In Chromium at a pinned viewport the unfixed bar fits
    exactly: scrollWidth == innerWidth at all five widths, widest child within 0.01px of
    the padding box. The 500px / x=482 reading is iOS Safari shrink-to-fit widening the
    layout viewport, which no instrument in this repository reproduces. The file's header
    says so rather than implying the reading is under guard."
  - "Soft assertions, decided after the first draft measured its own defect. With hard
    assertions B3's 44px target failed first at all five widths and the run said nothing
    whatever about B1, B2, B4, B5, B6 or B7 -- the exact question the file exists to
    answer. It is also what makes Plant 2's proof positive rather than circumstantial: the
    B6-red run contains ZERO B1 failures, which is a reading of B1 rather than an
    observation that B1 was never reached."
  - "Colours were deliberately left alone. UI-SPEC 6.2's CSS block carries
    --color-accent-900 / --color-bg for the bar; this plan kept background: Canvas;
    color: CanvasText and the existing border-top, so that a contrast regression from the
    palette port in 27-02 and a layout regression from this change cannot be confused."
metrics:
  duration: ~70 minutes
  tasks: 3
  files-created: 2
  files-modified: 1
  commits: 3
  completed: 2026-08-10
---

# Phase 27 Plan 1: The activity bar fits, and Stop is a target Summary

The regression spec for UI-SPEC §6.3 landed RED against the live page, the grid contract
turned it green — and the spec then falsified two of the three things the plan expected it
to prove, which is the substance of this plan rather than an aside.

## What was built

**`packages/node/src/demo-viewport.e2e.test.ts`** — B1–B7 of UI-SPEC §6.3, plus B2b and
B2c added under Task 1's own widening clause, at 320 / 360 / 393 / 768 / 1280 CSS pixels ×
720 (`deviceScaleFactor: 2` on the narrow three), in the `idle` and bounded-maximum
`loaded` bar states, over every surface `nav#surfaces [role="tab"]` offers — zero today, so
one pass, and six passes the day Plan 27-02 lands the nav, with no edit to this file.

A real `FabricNode` relay, a Vite dev server over the source page, and one
`BrowserContext` per viewport. Consent through `#allow`, start through `#join` — the page's
own controls, because the geometry a visitor gets is the geometry a visitor arrives at. No
`page.waitForTimeout` anywhere; every wait is a condition.

**`packages/browser/demo/index.html`** — UI-SPEC §6.2's grid contract: `minmax(0, 1fr) auto`,
`gap: 4px 12px`, `padding: 10px 12px max(10px, env(safe-area-inset-bottom)) 12px`,
`min-width: 0` and `overflow-wrap: anywhere` on both text children, `#stop` at 44×44 with
`justify-self: end`, and the three-column arrangement above 40rem. `body`'s bottom padding
becomes `calc(env(safe-area-inset-bottom, 0px) + 8.5rem)`. `.spacer` is gone, element and
rule. All four ids in UI-SPEC §8.1's contract keep their names and their DOM order.

## The geometry assertions, and their measured values

| # | Property | Unfixed page | After the grid contract |
|---|---|---|---|
| B1 | `documentElement.scrollWidth <= innerWidth + 1` | **green** — equal, exactly, at all five widths | green |
| B2 | `#bar`'s box inside the viewport | **green** — `#bar` width == `innerWidth` at all five | green |
| B2b | the bar's children inside `#bar`'s padding box | **green** — widest child within **0.01px** | green |
| B2c | each child's content inside its own box | **green** | green |
| B3 | `#stop` inside the viewport, ≥ 44×44 | **RED** — `66.77 × 37.44`, all five widths, both states | green — 44px tall |
| B4 | `elementFromPoint` at `#stop`'s centre is `#stop` | green | green |
| B5 | `#main`'s last child above `#bar`'s top at page end | green | green |
| B6 | neither `html` nor `body` computes `overflow-x: hidden` | green — both `visible` | green |
| B7 | `#surfaces` inside the viewport when it exists | vacuous — no such element yet | vacuous |

Measured `#bar` widths and `#stop` right edges on the unfixed page:

| viewport | `#bar` width | `#bar` content | `#stop` x | `#stop` right | `innerWidth` |
|---|---|---|---|---|---|
| 320 | 320.00 | 320 | 235.64 | 302.41 | 320 |
| 360 | 360.00 | 360 | 275.64 | 342.41 | 360 |
| 393 | 393.00 | 393 | 308.64 | 375.41 | 393 |
| 768 | 768.00 | 768 | 683.64 | 750.41 | 768 |
| 1280 | 1280.00 | 1280 | 1195.64 | 1262.41 | 1280 |

## The observed RED, verbatim

`npx vitest run --project e2e packages/node/src/demo-viewport.e2e.test.ts`, `EXIT=$?` read
on the line immediately after, **exit=1**, `Test Files 1 failed (1)` / `Tests 5 failed (5)`,
ten soft failures — one per viewport per state, all the same property:

```
AssertionError: B3 320px / idle / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 320px / loaded / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 360px / idle / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 360px / loaded / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 393px / idle / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 393px / loaded / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 768px  / idle / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 768px  / loaded / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 1280px / idle / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
AssertionError: B3 1280px / loaded / surface 1 of 1: #stop is 37.44px tall, under the 44px target: expected 37.4375 to be greater than or equal to 44
```

**This is not the RED the plan predicted, and the difference is the finding.** The plan and
the roadmap expected B2 and B3 to fail at the narrow widths with `#bar` wider than the
viewport and `#stop` past its right edge. In Chromium at a pinned viewport the unfixed bar
**fits**, in both states, at every width. The roadmap's 500px / x=482 is an iOS Safari
shrink-to-fit reading: Safari widens the layout viewport to fit overflowing content, so a
`position: fixed; inset: auto 0 0 0` element is reported at the widened width. Chromium does
not widen, and Playwright's `isMobile` — Chromium-only — does not add it. Logged in
`deferred-items.md` rather than papered over.

## The plants

Six arms, one at a time, each snapshotted to the session scratchpad immediately before the
edit, restored by the **surgical inverse of that edit** (never `cp`, never `git stash`,
never `git checkout --`), and verified with `cmp <snapshot> packages/browser/demo/index.html`
with `EXIT=$?` on the line immediately after. **Every `cmp` returned exit=0.** After the
last restore, `index.html` was additionally `cmp`-clean against the snapshot taken before
the *first* plant, and `git status --porcelain` showed the file unmodified.

### Plant 2 (required) — `overflow-x: hidden` on `body`: **B6 red, B1 green, same run**

Exit **1**. Ten soft failures, all B6 on `body`, zero B1 failures anywhere in the run:

```
AssertionError: B6 320px / idle / surface 1 of 1: body has computed overflow-x: hidden, which makes B1 pass while Stop can still be off screen — UI-SPEC 6.2 forbids it: expected 'hidden' not to be 'hidden' // Object.is equality
AssertionError: B6 393px / loaded / surface 1 of 1: body has computed overflow-x: hidden, which makes B1 pass while Stop can still be off screen — UI-SPEC 6.2 forbids it: expected 'hidden' not to be 'hidden' // Object.is equality
… the same at 360, 768 and 1280, in both states
```

Because every property is a soft assertion, the absence of a B1 failure in that run is a
**reading of B1**, not an observation that B1 was never reached. That pairing is the whole
point: the page can be made to stop scrolling sideways while the promised control is still
off screen, and B6 is what refuses the fake.

### Plant 1 (required) — remove `min-width: 0` from `#bar-what`: **GREEN**

Exit **0**, `Tests 5 passed (5)`. Nothing moved. Reported as green rather than replaced,
and then chased down rather than left as a shrug — three further arms:

| arm | exit | observed |
|---|---|---|
| `white-space: nowrap` on `#bar-what`, `min-width: 0` **kept** | 1 | `B2c 320px / idle: strong#bar-what's content measures 393px inside a 217px box` · `320px / loaded: 565px inside a 217px box` · same at 360 (257px box) and 393 (290px box). B2b, B1, B2, B3 all green |
| `white-space: nowrap` on `#bar-what`, `min-width: 0` **removed** | 1 | **identical to the pixel** — 393px/565px inside 217/257/290px boxes |
| `white-space: nowrap` on `#bar-stats`, `min-width: 0` **removed** | 1 | `B2c 320px / loaded: span#bar-stats's content measures 585px inside a 296px box`, and at 360/393/768. B2b green |
| `grid-template-columns: auto auto` instead of `minmax(0, 1fr) auto` | 0 | green — the track definition is not what carries it either |

**`min-width: 0` is inert under UI-SPEC §6.2's own grid.** A grid item's automatic minimum
size is content-based only when it spans a track whose **min** track sizing function is
`auto`; `minmax(0, 1fr)` fixes that min at 0. The line stays — it costs nothing and becomes
load-bearing again if the track definition changes — and the comment in `index.html` that
asserted otherwise was corrected in place. UI-SPEC §6.2's mutation proof is owed a
replacement, logged in `deferred-items.md`.

### The widening, and the plant that proves it

Task 1's acceptance clause says a green Plant 1 means the spec is not holding the property
and must be widened. **B2c** was added: each child of `#bar` must have its content inside
its own box. It is what reddens under `nowrap` — 393px of text in a 217px box — while B2b,
B1, B2 and B3 stay green.

**B2b had not been watched fail by any arm, so a sixth was run**: `width: 600px` on
`#bar-what`. Exit **1**:

```
AssertionError: B2b 320px / idle / surface 1 of 1: the bar's widest child reaches x=612.00 against #bar's padding box which ends at x=308.00 — the bar's content does not fit inside the bar: expected 612 to be less than or equal to 309
```

and at 360 and 393. **B1, B2 and B3 were green in that run** — a 612px child in a 320px
viewport, and every property UI-SPEC §6.3 lists said the page was fine. That is the single
strongest argument for B2b and B2c existing, and it is a measurement rather than an
argument.

## Exit codes, read directly

Every one taken with `EXIT=$?` on the line immediately after the command, output redirected
to a file rather than piped:

| command | exit |
|---|---|
| the spec, before the CSS (RED) | **1** |
| the spec, after the CSS | **0** |
| the spec + `built-bundle.e2e.test.ts` + `colouring-demo.e2e.test.ts` | **0** — `Test Files 3 passed (3)`, `Tests 18 passed (18)` |
| `npx tsc --noEmit` | **0** |
| `grep -v '^ *//' index.html \| grep -c 'overflow-x: *hidden'` | **0 matches** |
| `grep -c 'class="spacer"' index.html` | **0 matches** |
| every `cmp` after every restore | **0** |
| the final spec run | **0** |

## Deviations from Plan

### `[Rule 2 - missing critical functionality] B2b and B2c added beyond UI-SPEC 6.3's table`

- **Found during:** Task 1, and confirmed by the sixth plant arm in Task 3.
- **Issue:** every property in UI-SPEC §6.3 was green over a bar 300px too wide for its
  viewport. `#bar` is `position: fixed`, so its overflow reaches neither
  `documentElement.scrollWidth` (B1), nor its own border box (B2), nor the grid tracks that
  place `#stop` (B3).
- **Fix:** B2b — the bar's children against `#bar`'s padding box. B2c — each child's
  `scrollWidth` against its own `clientWidth`. Both watched red.
- **Files:** `packages/node/src/demo-viewport.e2e.test.ts`
- **Commits:** `d7a20f0` (B2b), `a4fbe56` (B2c)

### `[Rule 1 - bug] The index.html comment asserting min-width: 0 is load-bearing was false`

- **Found during:** Task 3, Plant 1 and its three follow-up arms.
- **Issue:** the comment written in Task 2 restated UI-SPEC §6.2's mechanism, which the
  plants falsified. A comment stating a falsified mechanism is worse than none.
- **Fix:** rewritten to state the measurement, the three arms, and the track-sizing reason.
- **Files:** `packages/browser/demo/index.html`
- **Commit:** `a4fbe56`

### `[deviation - method] Soft assertions rather than hard`

The plan requires B1, B4, B5, B6 and B7 to be *"separate assertions with their own
messages, not folded into one"*. They are — and they are `expect.soft`, which the plan does
not mention. With hard assertions the first draft reported only B3 at all five widths and
said nothing about any other property. It is also what makes Plant 2's `B6 red / B1 green`
a positive reading rather than a claim about an assertion that was never evaluated.

### `[deviation - scope, declined] B5 does not measure the footer`

Measured and **not fixed**: on the unfixed page the footer outside `#main` was under the bar
by ~41px at 320, 360 and 393, and B5 was green throughout. Task 2's padding change closed it
in the state the page reaches (footer clear at all five widths, idle), leaving one residue at
768 in the synthetic `loaded` bound. Widening B5 mid-plan would have made this plan's red
depend on a figure UI-SPEC has not agreed. `footerBottom` is read and returned by the spec
for whoever closes it. Logged in `deferred-items.md`.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-01 | mitigate | `#stop` is 44×44 and inside the viewport at five widths in two bar states; B3 and B4 assert it, and B3 was watched red against the unfixed page at all ten combinations |
| T-27-02 | mitigate | B6 asserts `overflow-x: hidden` is absent from `html` and `body`; Plant 2 turned B6 red at all five widths with **zero B1 failures in the same run** |
| T-27-03 | mitigate | **Not met as written, and reported rather than descoped.** Plant 1 established the opposite of what the plan expected: `min-width: 0` is inert under `minmax(0, 1fr)`. The tampering the threat names — silent removal in a tidy-up — is therefore harmless under the current grid, and the property that *is* at risk (content that cannot wrap) is held by B2c, watched red |

## What is NOT done

- **The iPhone reading itself is not under guard.** No instrument in this repository
  reproduces iOS Safari's shrink-to-fit. B2c, B3 and B4 hold the properties underneath it.
- **UI-SPEC §6.2 and §6.3 are not edited.** Two corrections are owed and are logged rather
  than applied: the `min-width: 0` mutation proof, and B5's blindness to the footer.
- **B7 is vacuous today.** `#surfaces` does not exist until Plan 27-02. The assertion is
  present, degrades to a pass, and names itself as vacuous in its own failure message.
- **Only Chromium.** The `e2e` project launches `chromium` alone; the three-engine matrix
  belongs to the `browser` project.

## Commits

| hash | what |
|---|---|
| `d7a20f0` | `test(27-01)` — the spec, RED at exit 1 against the live page |
| `17b5a96` | `fix(27-01)` — the grid contract, spec green at exit 0 |
| `a4fbe56` | `test(27-01)` — B2c, and the corrected `min-width: 0` comment |

Each committed with `git commit -m "…" -- <explicit paths>` and each verified with
`git show --stat` to contain only this plan's files.

## Self-Check: PASSED

- `packages/node/src/demo-viewport.e2e.test.ts` — FOUND
- `packages/browser/demo/index.html` — FOUND, modified
- `.planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md` — FOUND
- commit `d7a20f0` — FOUND
- commit `17b5a96` — FOUND
- commit `a4fbe56` — FOUND
