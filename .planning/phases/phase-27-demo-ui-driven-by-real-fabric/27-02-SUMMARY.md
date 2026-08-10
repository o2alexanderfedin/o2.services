---
phase: 27-demo-ui-driven-by-real-fabric
plan: 2
subsystem: browser-demo
tags: [demo-01, demo-03, brow-01, brow-04, ui-spec-1, ui-spec-2, ui-spec-7, css-port, tablist, contrast, p10, mutation-proof]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract, and demo-viewport.e2e.test.ts's B1-B7)
  provides:
    - "packages/browser/demo/demo.css — the mockup's design as plain CSS: no framework,
      no CDN, no React, no remote font, one palette, six named deviations from the
      imported source each carrying its reason"
    - "packages/browser/demo/nav.ts — installNav() and installViewToggle(): a hash-driven
      role=tablist over six surfaces, roving tabindex, arrows/Home/End, and a two-position
      view toggle that can collapse rendered cards and can never hide a text view"
    - "packages/browser/demo/index.html — the six-surface shell: session header outside
      the surfaces, nav#surfaces, six role=tabpanel sections, the colouring block moved
      unchanged, #report and #refresh-report moved to #s-fabric with the literal
      `not asked yet` intact"
    - "P10 in built-bundle.e2e.test.ts — every request during load and before consent is
      same-origin, asserted over the WHOLE request set rather than a filtered slice,
      watched red against the restored font import"
    - "the contrast block in demo-viewport.e2e.test.ts — seven pairs measured from
      getComputedStyle on the rendered page and composited on a canvas, plus the
      'no --color-accent below 24px inside #main' scan"
    - "B7 is no longer vacuous: one case asserts six tabs, six panels, exactly one
      selected, Colouring visible"
  affects:
    - Plan 27-03 (declares the regions into the shell this plan built; the inline module
      script's relative import of ./nav.ts is proved to survive `vite build`)
    - Plans 27-04 to 27-09 (fill the five surfaces that today carry heading, kicker and
      prose and no figure at all)
    - "UI-SPEC 7.2 and 6.3 (two corrections owed, logged in deferred-items.md: three
      predicted contrast ratios are optimistic and one pair is missing; B5 is vacuous on
      five of every six surface passes now that #main's last child is a hidden panel)"
tech-stack:
  added: []
  patterns:
    - "the port is a COPY: docs/design/mockups/ is read and never written, because both
      guards that name files inside it have dead-entry checks"
    - "text is dimmed with a colour and never with opacity, so a computed-colour reading
      IS the rendered contrast — getComputedStyle knows nothing about an ancestor's opacity"
    - "contrast composited by the browser on a 1x1 canvas rather than by arithmetic in the
      spec, so color-mix's alpha and whatever serialisation the engine chose are the
      engine's problem and this file parses no CSS Color 4"
    - "a click writes location.hash and then renders FROM it: one source of truth, and no
      race between a queued hashchange and a spec that measures one rAF after the click"
    - "a guard's floor stated as an assertion: P10's clean result is only meaningful if the
      request set is non-empty, so the set is required to contain the page's own assets"
key-files:
  created:
    - packages/browser/demo/demo.css
    - packages/browser/demo/nav.ts
  modified:
    - packages/browser/demo/index.html
    - packages/node/src/built-bundle.e2e.test.ts
    - packages/node/src/demo-viewport.e2e.test.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "`.btn-primary` takes `--color-accent-700`, not `--color-accent`, and the swap is a
    measurement rather than a preference. UI-SPEC 1.5 reserves the accent for the primary
    run control and UI-SPEC 7.2's table does not carry the pair that produces:
    `--color-bg` on `--color-accent` is 3.71:1 and fails at the 14px label size. Contrast
    is symmetric, so accent-700 gives the same 5.78:1 that makes accent-700 the safe
    colour for small accent TEXT. The pair is now measured by name."
  - "Every dimmed text colour is a colour and not an `opacity`. The page shipped
    `.sub{opacity:.65}`, `.note{opacity:.75}`, `dt{opacity:.6}`, `pre{opacity:.8}` and
    `#bar-stats{opacity:.75}`; all five are gone. `getComputedStyle` reports the declared
    colour and knows nothing about an ancestor's opacity, so those rules would have made
    the contrast block report full-strength text for captions that are visibly not. The
    one surviving `opacity` is on a DISABLED control, where the contrast minimum does not
    apply and the dimming is the affordance."
  - "The bar's pulse dot is declared in CSS and NOT mounted. `#bar` is a grid with three
    explicitly placed children and B2b/B2c iterate `#bar.children`; a fourth item would be
    auto-placed into a track nobody assigned it, moving geometry 27-01 measured at five
    widths in two states. The `@media (prefers-reduced-motion: reduce)` rule the plan asks
    for is present and the class is there for whichever surface has a reason to mount it."
  - "Table headers take `--color-neutral-700` rather than the source's 60% mix. Measured
    through a probe mounted in the real page: the 60% mix is 4.23:1 at the 11px header
    size and fails; neutral-700 is 5.87:1. No surface ships a table yet, so the rule is
    measured through a probe that is appended to `#s-colouring`, read, and removed — the
    selector prefers a real header the day one exists."
  - "The `@import` line and the font host are NOT quoted anywhere in `demo.css`, not even
    in the comment explaining their deletion. Task 1's acceptance clause greps that file
    for both strings, and a quotation would be indistinguishable from a relapse. The
    comment says so in place of quoting."
  - "The five new surfaces carry NOT ONE FIGURE, and where the mockup's own prose carried
    one the clause was dropped rather than transcribed — `999983, 99991, 9973`,
    `~260 million numbers sieved per second`, `about 5x10^8 units`, the aot exit codes.
    A number in prose is still a number on screen, and P2 lands in Plan 27-03."
metrics:
  duration: ~55 minutes
  tasks: 3
  files-created: 2
  files-modified: 4
  commits: 3
  completed: 2026-08-10
---

# Phase 27 Plan 2: The mockup's design, six surfaces, and nothing contacted Summary

The page now wears the mockup's design as plain CSS with no framework, no CDN and no
remote font; six surfaces sit behind a hash-driven tab strip; and the third-party font
that would have shipped with a verbatim port is held out by an assertion that was watched
fail.

## What was built

**`packages/browser/demo/demo.css`** (485 lines) — the mockup stylesheet ported as a
**copy**, with six deviations each carrying its reason in a comment beside it: the remote
font at-rule deleted for one system stack plus a mono stack; both exempted header comments
reworded; `--space-1…8` re-based off the 3.4px fractional base; `--color-muted` at 70%
replacing the source's 55% mix; `--color-refusal` lifted from today's `#stop` rule;
`color-scheme: light` with the bar's `Canvas`/`CanvasText` gone. `[hidden] { display: none
!important; }` is the first rule, comment carried over verbatim, and the new navigation
depends on it. `#bar`'s geometry declarations are unchanged from 27-01 — only the colours
moved onto the palette.

**`packages/browser/demo/nav.ts`** (190 lines, no framework, no router) —
`installNav()` and `installViewToggle()`, both idempotent and both safe to call before
`#main` is shown. Six `role="tab"` buttons over six `role="tabpanel"` sections, hash-driven
(`#/pi`), roving `tabindex`, `ArrowLeft`/`ArrowRight`/`Home`/`End`/`Enter`/`Space` with
selection following focus, and an unknown or empty hash selecting Colouring.

**`packages/browser/demo/index.html`** — the inline `<style>` is gone for a same-origin
`<link>`. The session header (`#state`, `#join`, `#facts`, `#explain`, `#peers`,
`#view-mode`) sits outside the surfaces because `built-bundle.e2e.test.ts` locator-clicks
three of those and a control behind a navigation choice is not actionable. Colouring's
block moved unchanged. `#report` and `#refresh-report` moved to `#s-fabric`.

**P10** in `built-bundle.e2e.test.ts`, and the **contrast block** in
`demo-viewport.e2e.test.ts`.

## The font import: how it was eliminated, and what holds it

The mockup stylesheet's **second line** imports two display faces from Google's font host.
It is **deleted**, not proxied and not self-hosted: `--font-heading` and `--font-body` both
take `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, and
`--font-mono` is new for every machine value. The mockup's condensed display face does not
ship; headings are distinguished by size, weight and `-0.015em` tracking.

**The assertion that holds it is P10**, and its *shape* is the point rather than its text.
The case immediately above it in the same file collects every request and then asserts on
two **filtered slices** — `bootstrap.json` and anything starting `ws`. Those two filters are
exactly right about what the node would do and structurally blind to everything else,
because a filter can only refuse what it was told to look for. P10 asserts on the **whole
set**: every URL collected from `goto` until the page is sitting at the gate has the page's
own origin, excepting only `about:`, `data:` and `blob:`, which never leave the process.

It carries its own floor, because an empty request list satisfies "no foreign origin"
perfectly: the collection is also required to contain more than one same-origin request, so
a page that failed to load cannot report a clean result.

## The planted mutation, and the red it produced

`demo.css` was snapshotted **outside the repository** to the session scratchpad
(`cmp` exit **0** on the copy), then the mockup's line 2 was re-inserted verbatim,
immediately after the file header comment and **before any rule** — an at-rule placed after
a rule is invalid and would be ignored, so a plant that did not fetch would have proved
nothing. `diff` against the snapshot showed exactly the plant and nothing else:

```
57a58,59
> @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600&display=swap');
>
```

`npx vitest run --project e2e packages/node/src/built-bundle.e2e.test.ts -t "makes no
request to any origin but its own"`, `EXIT=$?` on the line immediately after, **exit=1**:

```
 FAIL  |e2e| packages/node/src/built-bundle.e2e.test.ts > BROW-01 — nothing runs, and nothing is contacted, before consent > makes no request to any origin but its own, over the whole request set
AssertionError: P10: the page contacted 1 foreign origin(s) before consent — https://fonts.googleapis.com. Every request during load must have the page's own origin (http://127.0.0.1:58955); the gate promises in writing that nobody learns a visitor is present until they agree.: expected [ Array(1) ] to deeply equal []
```

`Tests  1 failed | 7 skipped (8)`.

Restored by the **surgical inverse of that edit** — the same two lines removed, never
`cp`, never `git stash`, never `git checkout --` — and verified:

```
cmp <snapshot> packages/browser/demo/demo.css
EXIT=$?   →   cmp exit=0
```

## B7 passes for real, and it is asserted rather than claimed

`demo-viewport.e2e.test.ts` enumerates surfaces as `nav#surfaces [role="tab"]`. Until today
that was empty, the loop ran once, and B7's own failure message called itself *"vacuous
until Plan 27-02"*. The nav now exists, so the geometry file runs **six passes per bar state
per viewport** — sixty combinations instead of ten — and B7 measures a real box every time.

That would still have been a promise, so a case was added that makes it a reading: six
tabs, six `role="tabpanel"` panels, exactly one `aria-selected="true"` at load, and
`s-colouring` the only visible panel. Delete the nav and that case goes red instead of B7
quietly going vacuous again.

## Contrast, measured — and where UI-SPEC's prediction disagrees

Read from `getComputedStyle` on the live page at 1280px, composited by the browser on a
1×1 canvas (white, then every ancestor's `background-color` from the document element down,
then the text colour), WCAG 2.1. Printed by the spec on every run:

| pair | selector | size | measured | floor | UI-SPEC §7.2 predicts |
|---|---|---|---|---|---|
| body prose on the page ground | `#s-colouring .card-body` | 14px | **14.79:1** | 4.5 | 15.9:1 |
| a caption in `--color-muted` | `#main .note` | 13px | **5.83:1** | 4.5 | 6.28:1 |
| a table header | probe `.table th` | 11px | **5.87:1** | 4.5 | 5.84:1 |
| the bar's headline on the bar's ground | `#bar-what` | 14px | **12.56:1** | 4.5 | 14.6:1 |
| the bar's counters on the bar's ground | `#bar-stats` | 12px | **11.50:1** | 4.5 | — |
| `#stop`'s label on `#stop`'s background | `#stop` | 14px | **12.56:1** | 4.5 | — |
| the primary run control | `.btn-primary` | 14px | **5.78:1** | 4.5 | — |

**Three rows disagree with UI-SPEC §7.2 and all three run the same way — the prediction is
optimistic**: `--color-text` on `--color-bg` is 14.79 against a predicted 15.9;
`--color-muted` is 5.83 against 6.28; the bar is 12.56 against 14.6. Every one still clears
its threshold, so nothing was changed on account of it and nothing is broken. What it means
practically is that a *future* pair predicted at just over 4.5:1 must not be trusted to
clear it without being measured. Two rows agree closely: `--color-accent-700` at 5.78
against 5.79, `--color-neutral-700` at 5.87 against 5.84. Reported, not reconciled; logged
in `deferred-items.md` as an edit UI-SPEC owes itself.

**And one pair UI-SPEC's table does not carry at all**, which the port had to decide:
`--color-bg` on `--color-accent` — the `.btn-primary` combination UI-SPEC §1.5 reserves the
accent for — is **3.71:1** and fails at 14px. `.btn-primary` takes `--color-accent-700`
instead and the pair is now measured by name.

The accent scan reports **zero offenders**: no element inside `#main` with a computed
`font-size` below 24px carries `--color-accent` as its text colour.

## Exit codes, read directly

Every one taken with `EXIT=$?` on the line immediately after the command, output redirected
to a file and the file read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `vitest run --project node vocabulary + strip-comments` (Task 1) | **0** — `Tests 42 passed (42)` |
| `vitest run --project e2e` × 6 files (Task 2) | **0** — `Test Files 6 passed (6)`, `Tests 35 passed (35)` |
| `npx tsc --noEmit` (Task 2) | **0** |
| `vitest run --project e2e built-bundle + demo-viewport` (Task 3) | **0** — `Tests 15 passed (15)` |
| the P10 plant | **1** — the red quoted above |
| `cmp` after the surgical restore | **0** |
| `vitest run --project e2e` × 6 files (final) | **0** — `Test Files 6 passed (6)`, `Tests 38 passed (38)` |
| `vitest run --project node vocabulary + strip-comments` (final) | **0** — `Tests 42 passed (42)` |
| `npx tsc --noEmit` (final) | **0** |
| `grep -c 'fonts.googleapis.com\|unpkg.com\|@import' demo.css` | **0 matches** |
| `grep -c 'react\|unpkg\|babel\|dc-runtime' index.html` | **0 matches** |
| `git status --porcelain docs/design/mockups/` | **empty** |
| `head -1 demo.css` | a comment; `grep -n '^\[hidden\]'` → line 67, before any selector |

## Deviations from Plan

### `[Rule 2 — missing critical functionality] The accent is wrong for `.btn-primary`, measured`

- **Found during:** Task 1, computing the palette's pairs before writing them down.
- **Issue:** UI-SPEC §1.5 reserves `--color-accent` for the primary run control and UI-SPEC
  §7.2's table has no row for `--color-bg` on `--color-accent`. It measures 3.71:1 and
  fails at the 14px label size the control uses. The "no accent below 24px" rule the plan
  asks for checks the *text colour* and would not have caught an accent *background*.
- **Fix:** `.btn-primary` takes `--color-accent-700`; the pair was added to the measured
  set so the decision is a reading rather than a comment.
- **Files:** `packages/browser/demo/demo.css`, `packages/node/src/demo-viewport.e2e.test.ts`
- **Commits:** `5fd6576`, `076a30a`

### `[Rule 2 — missing critical functionality] Opacity would have made the contrast block dishonest`

- **Found during:** Task 1, porting today's inline `<style>`.
- **Issue:** the page dimmed five kinds of text with `opacity`. `getComputedStyle` reports
  the declared colour and knows nothing about an ancestor's opacity, so every one of those
  would have measured as full-strength text and passed a check it visibly fails.
- **Fix:** every text `opacity` replaced by a colour (`--color-muted`,
  `--color-neutral-700`, `--color-accent-200` on the bar). The rule and its reason are
  written into the stylesheet header. The one surviving `opacity` is on a disabled control.
- **Files:** `packages/browser/demo/demo.css`
- **Commit:** `5fd6576`

### `[Rule 2 — missing critical functionality] B7's non-vacuity is asserted, not narrated`

- **Found during:** Task 2.
- **Issue:** B7 degrades to a pass when `#surfaces` is absent and says so in its own
  message. Landing the nav makes it real *today*; deleting the nav tomorrow would make it
  vacuous again with every run still green.
- **Fix:** one case in `demo-viewport.e2e.test.ts` asserting six tabs, six panels, one
  selected, Colouring visible.
- **Files:** `packages/node/src/demo-viewport.e2e.test.ts`
- **Commit:** `076a30a`

### `[deviation — method] The table-header pair is measured through a probe`

No surface ships a `.table` yet, so `.table th` has no element on the page. Rather than ship
an empty table — which is the class of placeholder this phase exists to prevent — or leave
the ported rule unmeasured, the spec appends a one-cell table **into `#s-colouring` on the
real page**, reads it under the real cascade with every custom property resolved as the page
resolves them, and removes it. The selector prefers a real header the day one exists. Said
here rather than left to be discovered in the failure text.

### `[deviation — scope] The mockup's prose was ported with its figures removed`

The plan says the five new surfaces get the mockup's prose and no figures. Four of the
mockup's paragraphs carry a figure inside the prose itself. Those clauses were dropped
rather than transcribed, because a number in a sentence is still a number on screen and P2
lands in Plan 27-03. Nothing else about the wording changed.

### `[deviation — structure] `<h2>The job</h2>` became an `<h3>` card title`

Colouring's block moved "unchanged, line for line" as the plan requires — except that its
two `<h2>`s became `<h3 class="card-title">`, because each surface now has one `<h2>` (its
headline) and UI-SPEC §7.1 forbids skipping a level. No wording changed and no id moved.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-04 | **mitigate — met** | The at-rule is deleted, system stacks replace it, and P10 asserts every pre-consent request is same-origin over the whole request set. Watched red against the restored line, which named `https://fonts.googleapis.com`. |
| T-27-05 | **mitigate — met** | None of the mockup's runtime is ported: `grep -c 'react\|unpkg\|babel\|dc-runtime' index.html` is 0, and P10 covers any re-introduction because it asserts on origins rather than on a list of hosts. |
| T-27-06 | **mitigate — met** | `vocabulary.node.test.ts` and `strip-comments.node.test.ts` both pass with their dead-entry checks silent, so both mockup-path exemptions still fire against an untouched source. `git status --porcelain docs/design/mockups/` is empty. |
| T-27-07 | **mitigate — met** | Measured on the rendered page from computed colours, seven pairs plus the `--color-accent`-below-24px scan, which reports zero offenders. The trap the threat names was found one step over — as an accent *background* under a 14px label — and closed. |

## Known Stubs

Four `<pre class="text-view">` elements ship with an initial literal and no data source:

| id | file:line | literal | resolved by |
|---|---|---|---|
| `#primes-report` | `packages/browser/demo/index.html:198` | `Nothing to report: this surface has not been wired to a reading yet.` | Plan 27-05 |
| `#pi-report` | `packages/browser/demo/index.html:237` | same | Plan 27-06 |
| `#byo-report` | `packages/browser/demo/index.html:271` | same | Plan 27-07 |
| `#fabric-report` | `packages/browser/demo/index.html:305` | same | Plan 27-08 |

Each is a **named absence** by UI-SPEC's definition — one sentence, names the cause,
contains no digit — so it is honest on screen today rather than a blank or a spinner. They
are recorded here because they are nonetheless unwired, and because UI-SPEC §2.2 requires
each to become the second rendering of its surface's single reading record.

The five new surfaces likewise carry no figure regions at all. That is this plan's scope
boundary and not an omission: Plan 27-03 declares the regions, Plans 27-04 to 27-09 wire
them.

## What is NOT done

- **UI-SPEC is not edited.** Two corrections are owed and logged in `deferred-items.md`
  rather than applied: §7.2's three optimistic ratios plus its missing `.btn-primary` row,
  and §6.3's B5 now measuring a hidden panel on five of every six surface passes.
- **B5 went partly vacuous** with this restructure, measured and reported rather than
  quietly absorbed — see `deferred-items.md`. It is a real reading on the Benchmarks pass
  and a zero-box pass on the other five.
- **No figures anywhere new.** The bring-your-own heading still reads *"wired but not
  exposed on this page"*, which is true as of this commit and becomes false when Plan 27-07
  gives `runJob` a caller; that surface owns replacing it.
- **The Benchmarks provenance line carries no figures yet.** UI-SPEC §4.7 requires a dated
  line naming the machine; transcribing those figures is Plan 27-09's, and until then the
  surface states its provenance in words and shows no number.
- **The bar's pulse dot is declared and not mounted** — see the decision above.
- **Only Chromium.** The `e2e` project launches `chromium` alone.

## Commits

| hash | what |
|---|---|
| `5fd6576` | `feat(27-02)` — the mockup's design as plain CSS, six deviations, no remote font |
| `ec06e79` | `feat(27-02)` — six surfaces behind a hash-driven tab strip, design linked in |
| `076a30a` | `test(27-02)` — P10 over the whole request set, and contrast measured on the page |

Each committed with `git commit -m "…" -- <explicit paths>` and each verified with
`git show --stat` to contain only this plan's files.

## Self-Check: PASSED

- `packages/browser/demo/demo.css` — FOUND
- `packages/browser/demo/nav.ts` — FOUND
- `packages/browser/demo/index.html` — FOUND, modified
- `packages/node/src/built-bundle.e2e.test.ts` — FOUND, modified
- `packages/node/src/demo-viewport.e2e.test.ts` — FOUND, modified
- `.planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md` — FOUND, modified
- commit `5fd6576` — FOUND
- commit `ec06e79` — FOUND
- commit `076a30a` — FOUND
- the four Known Stubs line numbers were **wrong when first written** (216 / 248 / 279 /
  314, guessed rather than read) and were corrected to 198 / 237 / 271 / 305 against
  `grep -n` before this check was signed. Recorded rather than silently fixed.
