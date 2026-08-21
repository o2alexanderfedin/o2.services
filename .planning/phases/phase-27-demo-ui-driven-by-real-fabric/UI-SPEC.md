---
phase: 27
slug: demo-ui-driven-by-real-fabric
status: draft
framework: none
design_source: docs/design/mockups/o2-fabric-demo/ (layout and wording only)
created: 2026-08-10
---

# Phase 27 — UI Design Contract

The demo page, in the imported mockup's design, with **every figure on screen produced by a
live `TabApi` reading or rendered as a named absence.**

This document is the visual and interaction contract. It is prescriptive: where it states a
value, that value is the contract, not a suggestion. Where a decision was left to discretion
by `27-CONTEXT.md`, the decision is taken here and the reason is stated beside it.

---

## 0. The rule this contract exists to make checkable

> Every figure comes from a `TabApi` reading, or is a named absence. Never a default, never a
> surviving placeholder, never a value the page computed a second opinion about.

Operationally, that rule needs three things this document supplies:

1. **An enumeration.** §4 lists every figure region on every surface, with the exact call and
   field it reads, and its copy in three states (no reading yet / node stopped / legitimately
   unavailable). 93 regions, 76 of them live readings.
2. **A machine-readable declaration on each region**, so a guard can enumerate the page
   without having seen the mockup (§3).
3. **Assertable properties**, each with the mutation that proves it can fail (§9).

A **named absence** is a complete sentence that names *why* the figure is not there. It is
never an em-dash, never a zero, never a blank, never a spinner that never resolves. It
contains no digit — that is what makes "a figure region reads as a number" mechanically
detectable.

### The three classes of on-screen number, and the rule for each

| Class | `data-kind` | Where it may come from | Rule |
|---|---|---|---|
| **Reading** | `reading` | A `TabApi` call, one named field, unmodified | Renders its named absence until a reading exists. Digit-free when absent. |
| **Constant** | `constant` | A value imported from the code that uses it (`MAX_N`, `DEFAULT_BUDGET`, `DISCLOSURE_VERSION`, a length computed from the shipped builder) | Always present, always labelled with the symbol it came from. Never described as a result. |
| **Cited** | `cited` | A committed measurement (`docs/perf/prime-and-pi-benchmarks.md`) or a published mathematical constant | Must carry visible provenance: source document and measurement date. Must never sit in a region that could read as this run's output. |

Anything numeric that is not one of the three is a defect, and §9's property P2 is how that
is caught.

---

## 1. Design system

| Property | Value |
|---|---|
| Tool | none — plain CSS, no build step beyond Vite's asset pipeline, no framework |
| Component library | none. Component *classes* ported from the mockup's stylesheet |
| Source of the design | `docs/design/mockups/o2-fabric-demo/_ds/industry-4b1f0d05-e62b-453f-afb5-717eabafadb4/styles.css` |
| Ported to | `packages/browser/demo/demo.css` (new file, linked from `index.html`) |
| Icon library | none. No icon font, no SVG sprite. Status is carried by text and by the mockup's square swatches |
| Font | system stacks only — see §1.3 |
| Runtime | none of the mockup's. No React, no Babel, no `dc-runtime`, no `unpkg.com` |

**shadcn gate:** not applicable and deliberately so. The page is a static-host artifact with no
CDN dependency, no bundler-resident component library and no React; `27-CONTEXT.md` locks that
and the disclosure promise depends on it. `components.json` is absent and stays absent.

### 1.1 Hard constraints on the port

These are not preferences. Each one is a guard, a measured constraint, or a promise in writing.

1. **Copy the mockup directory; never move or delete it.** `packages/node/src/vocabulary.node.test.ts`
   holds two line exemptions naming that stylesheet by path, and
   `packages/node/src/strip-comments.node.test.ts` holds one naming `support.js`. Both have
   dead-entry checks. Deleting or relocating the mockup turns three exemptions dead and both
   guards red.
2. **The ported CSS must not carry the two exempted comment phrases.** Those exemptions are
   keyed to a phrase *and a file path*, so the same phrase in `packages/browser/demo/demo.css`
   is an unexempted violation of the vocabulary rule. Rewrite both header comments in the
   port. More generally: the banned vocabulary (see that guard for the list) applies to every
   line of new CSS, HTML and copy this phase writes.
3. **No remote font, no remote anything.** The mockup's stylesheet opens with an `@import` of
   `fonts.googleapis.com`. Porting it would make the page contact a third party at load —
   before consent — which is precisely what the gate promises does not happen. Drop the
   `@import`; use §1.3's stacks. §9 adds the assertion that nothing today enforces.
4. **`[hidden] { display: none !important }` stays**, first rule in the stylesheet, with its
   existing comment. It is the fix for a shipped defect and the new in-page navigation depends
   on it.
5. **The element-id contract in §8 survives verbatim.** Nineteen ids are read by the e2e
   suite; renaming one rewrites a guard in the same change that rewrites the UI.

### 1.2 Custom properties to port

Ported verbatim from the mockup stylesheet unless the "change" column says otherwise. Property
names are kept identical so the ported component classes need no edits.

| Property | Value | Change from source | Used for |
|---|---|---|---|
| `--color-bg` | `#f2f2f3` | — | Page ground (the 60%) |
| `--color-surface` | `#e9e9ea` | — | Inputs, table header bands (the 30%) |
| `--color-text` | `#1d1f20` | — | All body text |
| `--color-accent` | `#5980a6` | — | The 10%; see §1.5 for what it is reserved for |
| `--color-accent-2` | `#728fab` | — | Second series in the reduce-tree diagram only |
| `--color-divider` | `color-mix(in srgb, #1d1f20 16%, transparent)` | — | Every hairline; the blueprint frame |
| `--color-neutral-100…900` | as source | — | Table rules, muted captions (`700` and darker for text) |
| `--color-accent-100…900` | as source | — | Tags, the fixed bar's ground (`900`), links on dark (`300`) |
| `--color-accent-2-100…900` | as source | — | Second-series tags |
| `--color-muted` | `color-mix(in srgb, var(--color-text) 70%, transparent)` | **new** | Replaces `.text-muted`'s 55% mix — see §7.2, the 55% mix measures 3.70:1 and fails at body size |
| `--color-refusal` | `#cb4b16` | **new**, taken from today's `#stop` rule | Refusals, violations, withheld frames, `state[data-tone=blocked]` |
| `--font-heading` | `ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | **changed** — no remote face | Headings, figure values |
| `--font-heading-weight` | `600` | — | |
| `--font-body` | same stack as heading | **changed** — no remote face | Prose |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` | **new** | Every machine value: peer ids, CIDs, counts in tables, the text views |
| `--space-1…8` | `4 / 8 / 12 / 16 / 24 / 32px` | **changed** — see below | All spacing |
| `--radius-sm/md/lg` | `2 / 4 / 7px` | — | (the blueprint override sets most components to `0`) |
| `--shadow-sm/md/lg` | as source | — | `.elev-*` only; the blueprint look mostly does not use them |

**Why the spacing ramp is re-based.** The source ramp is `3.4 / 6.8 / 10.2 / 13.6 / 20.4 / 27.2px`
— a 3.4px base that puts every step on a fractional pixel. This phase asserts *geometry* (§6:
the bar fits, the Stop control is fully inside the viewport, the target is at least 44px), and
fractional accumulation makes those assertions read differently per device pixel ratio. The
re-based ramp keeps the same property names and the same visual rhythm — the largest step moves
by 4.8px — and makes the measured properties stable. Stated here rather than left as a silent
divergence from the mockup.

### 1.3 Typography

Four sizes, two weights. The mockup declares six heading sizes; the demo needs four roles and
carrying six would be six things to keep consistent for no reader's benefit.

| Role | Size | Weight | Line height | Family | Used for |
|---|---|---|---|---|---|
| Display | `clamp(24px, 4vw, 32px)` | 600 | 1.15 | heading | One per surface: the surface headline |
| Heading | 20px | 600 | 1.2 | heading | Card titles, panel headings |
| Body | 15px | 400 | 1.55 | body | All prose, all named absences |
| Small | 12px | 400 | 1.5 | body | Kickers (uppercase, `.08em` tracking), captions, table headers |

Figure values render at Heading size in `--font-heading` weight 600 — the mockup's device for
making a number read as a result. Machine values (peer ids, CIDs, multiaddrs, counts inside
tables, both text views) render in `--font-mono` at Body or Small size.

The mockup's condensed display face does not ship. Headings are distinguished by size, weight
and `-0.015em` tracking instead.

### 1.4 Spacing

| Property | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Icon-to-label gaps, swatch gaps |
| `--space-2` | 8px | Inside-card element gaps |
| `--space-3` | 12px | Card padding on narrow, table cell padding |
| `--space-4` | 16px | Card padding, grid gutters on narrow |
| `--space-6` | 24px | Grid gutters, panel separation |
| `--space-8` | 32px | Surface-level section breaks |

Exceptions, each named: the fixed bar's vertical padding is `10px` top and
`max(10px, env(safe-area-inset-bottom))` bottom (§6); the Stop control has a `44px` minimum box
that overrides the padding ramp (§6, §7.3); `body`'s bottom padding is set from the bar's
measured height rather than from the ramp (§6).

### 1.5 Colour — the 60/30/10 split and what accent is reserved for

| Role | Value | Share | Usage |
|---|---|---|---|
| Dominant | `--color-bg` `#f2f2f3` | ~60% | Page ground, transparent cards over it |
| Secondary | `--color-surface` `#e9e9ea` + `--color-divider` hairlines | ~30% | Inputs, table bands, every card frame and blueprint corner |
| Accent | `--color-accent` `#5980a6` and its ramp | ~10% | The reserved list below |
| Refusal | `--color-refusal` `#cb4b16` | <2% | The reserved list below |

**Accent is reserved for exactly these:**

1. The primary run control on each surface (`.btn-primary`), one per surface.
2. The selected navigation item (`aria-selected="true"`).
3. The `found` cube swatch and the `budget` dashed swatch outline on the colouring grid.
4. The tag on an agreeing peer id.
5. The 2px left rule on any block quoting the fabric's own words (attestation `description`,
   `reduceReason`, a refusal `reason`).
6. The focus ring (`:focus-visible`, 2px, offset 2px).
7. The bar's ground (`--color-accent-900`) and its pulse dot (`--color-accent-300`).

**Accent is not used for body text.** Measured: `#5980a6` on `#f2f2f3` is 3.70:1 — enough for a
UI component boundary and for text ≥24px, not enough for anything smaller. Small accent text
uses `--color-accent-700` `#416180`, measured 5.79:1.

**Refusal is reserved for exactly these:** withheld frames in an egress panel; a refuted
verification verdict; a provenance refusal or shard failure in bring-your-own;
`state[data-tone='blocked']`. It is never used for a control, and never for an absence — an
absence is not an error.

**Colour is never the only carrier.** Every cube swatch, tag and status pill has a text label
beside it or an `aria-label` on it. `prefers-contrast` and colour-vision deficiency are covered
by that, not by the palette.

**One palette.** `:root { color-scheme: light }` and explicit colours everywhere; the current
page's `light dark` plus `Canvas`/`CanvasText` in the bar goes away, because a half-ported dark
mode is how the bar's ground and its Stop control end up at an unmeasured contrast ratio. A dark
map of the eight base properties is a named follow-up, not this phase.

---

## 2. Page architecture

One page. `packages/browser/demo/index.html` stays the single entry point and keeps its inline
module script as the page driver; `main.ts` stays the `window.o2` implementation.

```
<body>
  #gate            the consent gate, unchanged in behaviour, restyled       (hidden until needed)
  #main                                                                     (hidden until consent)
    header.session   #state  #join  #facts  #explain  #peers  — always visible on every surface
    nav#surfaces     six role=tab buttons, hash-driven
    #s-colouring   role=tabpanel   (default)
    #s-primes      role=tabpanel
    #s-pi          role=tabpanel
    #s-byo         role=tabpanel
    #s-fabric      role=tabpanel
    #s-bench       role=tabpanel
  footer#measurements  link to the perf report                              (outside the gate)
  #bar             the always-visible activity bar                          (hidden iff no node)
</body>
```

**Why the session header is outside the surfaces.** `#state`, `#join` and `#explain` are read
and *clicked* by `built-bundle.e2e.test.ts` with locator clicks, which require actionability. A
control behind a navigation choice is not actionable. Beyond the guard: the node's own status is
not a property of whichever workload is on screen.

**Colouring is the default surface**, because `colouring-demo.e2e.test.ts` and
`attestation-ui.e2e.test.ts` locator-click `#run` and `#verify` without navigating.

### 2.1 In-page navigation (discretionary — decided here)

- Six `<button role="tab">` inside `<nav id="surfaces" role="tablist" aria-label="Workloads">`.
  Ids `#nav-colouring`, `#nav-primes`, `#nav-pi`, `#nav-byo`, `#nav-fabric`, `#nav-bench`.
- Each carries `aria-controls="s-<name>"` and `aria-selected`. Panels carry
  `role="tabpanel" tabindex="0" aria-labelledby="nav-<name>"` and the `hidden` attribute when
  not selected.
- **Hash-driven.** A click sets `location.hash = '#/pi'`; a single `hashchange` listener does
  the showing and hiding. Deep links work, the back button works, and no state lives in two
  places. An unknown or empty hash selects Colouring.
- Keyboard: roving `tabindex` across the tabs, `ArrowLeft`/`ArrowRight` move selection,
  `Home`/`End` jump to the ends, `Enter`/`Space` activate. Selection follows focus.
- No framework, no router, no build step. Roughly 30 lines.
- The tab strip may scroll horizontally *within itself* (`overflow-x: auto`) on narrow
  viewports. It may never cause page-level horizontal scroll — §6, property B1.

### 2.2 Rendered view and text view (discretionary — decided here)

**Both views are always present. The toggle collapses the rendered cards; it can never hide a
text view.**

- Each surface carries exactly one `<pre class="text-view">`: `#run-report` (colouring, the
  historical id, never renamed), `#verify-report`, `#primes-report`, `#pi-report`, `#byo-report`,
  `#fabric-report`.
- `attestation-ui.e2e.test.ts` asserts `isVisible('#run-report')` after a run. A toggle able to
  hide it would make that guard pass or fail on which state a test happened to land in. So the
  toggle has two positions — **"Rendered and text"** (default) and **"Text only"** — and
  `#run-report` is visible in both.
- The toggle is `#view-mode`, a two-option `.seg` control in the session header, persisted in
  `sessionStorage`. It sets `data-view="both|text"` on `#main`; the CSS does the rest.
- **One reading, one render pass, both views.** For each surface, a single pure function takes
  the reading and returns a record of already-formatted strings; the rendered regions and the
  text view are both written from that record. Neither view formats anything the other does not
  have. This is what makes P6 (§9) assertable, and it is the same argument
  `TabColouringRun.attestation` makes about the CLI and the page: two formatters of one value are
  two things that can disagree.
- The colouring text view's content is **unchanged**: same lines, same order, same wording,
  produced by the same code. `attestation-ui.e2e.test.ts` reads eleven distinct substrings out of
  it and `colouring-demo.e2e.test.ts` four more. New surfaces get new text views in the same
  style; nothing about `#run-report` moves.

---

## 3. How a region declares itself

Every figure on the page is wrapped in an element carrying four attributes:

```html
<span data-region="pi/estimate"
      data-kind="reading"
      data-source="TabApi.runPi().estimate"
      data-absence="No estimate: the series has not been run in this tab.">No estimate: the series has not been run in this tab.</span>
```

| Attribute | Meaning |
|---|---|
| `data-region` | Unique id, `<surface>/<field>`. The catalogue key. |
| `data-kind` | `reading` \| `constant` \| `cited` \| `control` |
| `data-source` | For `reading`: `TabApi.<method>().<field>`, exactly. For `constant`: the exported symbol (`@o2/demo.MAX_N`). For `cited`: the document path and section. |
| `data-absence` | The named-absence sentence. Required for `reading`. Must contain no digit. |

The catalogue lives at `packages/browser/demo/regions.ts` as
`export const REGIONS: readonly Region[]`. The page imports it to render initial absences; the
guard imports it to enumerate. That shared import cannot catch a *wrong* absence sentence — it
can and does catch a region that renders a number when there is no reading, a region on the page
that is in no catalogue, a catalogue entry with no element, and a source naming a method
`window.o2` does not have. Those are the four ways a placeholder reaches the screen.

---

## 4. The six surfaces, region by region

Column meanings: **reads** is the exact call and field; **before any reading** is what is on
screen when the page loads with a running node and nothing dispatched; **stopped** is what is on
screen when `activity() === null`; **unavailable** is the legitimate-absence arm and the named
reason it shows.

**A rule that applies to every table below.** Most `TabApi` readings throw `node not started`
when there is no node — `peers`, `heldPeers`, `computePeers`, `governor`, `capacity`,
`addresses`, `storedBlocks`, `runColouring`, `runPi`, `runJob`. The page therefore **calls a
reading only when `activity() !== null`**, and renders the stopped absence otherwise. When a call
throws anyway, the region renders the thrown message as its named reason — never a number, never
a blank, never a retained previous value. `activity()`, `consentState()`, `disclosure()`,
`verifyAnswer()`, `isolation()` and `startReport()` are safe with no node and are the only ones
called unconditionally.

### 4.0 Session header — 5 regions

| # | Region | Kind | Reads | Before any reading | Stopped | Unavailable (named reason) |
|---|---|---|---|---|---|---|
| H1 | `session/state` | control-status | page state machine over `discoverRelays()`, `autoStart()`, `stop()` | `checking for a relay…` | `stopped — the thread was ended and the connections closed` | `no relay reachable from this page` (existing copy, `#state`, tone `blocked`) |
| H2 | `session/peer-id` | reading | `TabApi.autoStart().peerId` | `No peer id: this tab has not joined.` | `No peer id: this tab's node is stopped.` | the thrown message from `autoStart` |
| H3 | `session/relay` | reading | `TabApi.discoverRelays().relayAddrs[0]` | `No relay: this page has not been asked yet.` | `No relay: this tab's node is stopped.` | `No relay: this page was served by a static host, which runs none.` (`source === 'none'`) |
| H4 | `session/webrtc-addr` | reading | `TabApi.waitForWebrtcAddr().[0]` | `No address: this tab has not joined.` | `No address: this tab's node is stopped.` | `No address: the relay has not yet produced a reservation.` |
| H5 | `session/peers-sentence` | reading | `connectDiscoveredPeers()` + `computePeers()` + `peers()` | `Not counted yet: no discovery round has run.` | `Not counted: this tab's node is stopped.` | existing copy verbatim (`#peers`) — including the relayed-only and stalled clauses |

H5's rendered sentence is **unchanged from today**, wording and all.
`attestation-ui.e2e.test.ts` reads `1 node(s) computing` and `2 node(s) computing` out of it.

### 4.1 Bar — 3 regions

| # | Region | Kind | Reads | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|---|
| B1 | `bar/what` | reading | `activity().servedFor`, `activity().peers` | existing copy: `running — waiting for work · N peer(s) connected` | *the bar is not rendered at all* | — |
| B2 | `bar/stats` | reading | `activity().dutyCycle`, `.hidden`, `.tasksExecuted`, `.fetched` | existing copy: `…% of one thread · N task(s) done · N block(s) in` | *the bar is not rendered at all* | — |
| B3 | `bar/stop` | control | — | `Stop` | *not rendered* | — |

**The bar has no absence copy, and that is deliberate.** `activity() === null` removes the bar
entirely. A bar reading `idle` while offering to stop a node that does not exist is a shipped
defect this page already fixed once; the fix is that the element's existence *is* the reading.
`built-bundle.e2e.test.ts` asserts `isVisible('#bar') === false` before consent — keep it.

Both regions keep their existing wording. B2's counters update about once a second, which is why
B2 is `aria-live="off"` and B1 is `aria-live="polite"` (§7.4).

### 4.2 Colouring — 17 regions

Reading: one or more `TabApi.runColouring()` results; the ladder is `[300, 400, 500, 600]` and
stops at the first rung the fabric cannot settle. `best` is the last settled run.

| # | Region | Kind | Reads | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|---|
| C1 | `colouring/cubes-arg` | control | argument the page will send: `8 × (1 + computePeers().length)` | `Nothing dispatched yet — this is what would be sent.` | same | — |
| C2 | `colouring/redundancy-arg` | control | argument: `min(2, 1 + computePeers().length)` | `Nothing dispatched yet — this is what would be sent.` | same | — |
| C3 | `colouring/budget` | constant | `@o2/demo.DEFAULT_BUDGET` | always present, labelled `backtracks, fixed, travels in the input` | unchanged | — |
| C4 | `colouring/max-n` | constant | `@o2/demo.MAX_N` | always present, labelled `above it the guest returns "unknown"` | unchanged | — |
| C5 | `colouring/input-bytes` | constant | `buildInput(MAX_N, DEFAULT_BUDGET).length`, computed in-page from the shipped builder | always present, labelled with the expression | unchanged | — |
| C6 | `colouring/rung-300` | reading | `runColouring({n:300}).found`, `.statuses`, `.elapsedMs` | `Not attempted: the ladder has not been run.` | `Not attempted: this tab's node is stopped.` | thrown message from the rung |
| C7 | `colouring/rung-400` | reading | as C6 at n=400 | as C6 | as C6 | as C6 |
| C8 | `colouring/rung-500` | reading | as C6 at n=500 | as C6 | as C6 | as C6 |
| C9 | `colouring/rung-600` | reading | as C6 at n=600 | as C6 | as C6 | `Not attempted: the ladder stopped at an earlier rung.` |
| C10 | `colouring/cube-grid` | reading | `best.statuses[]` — one swatch per cube, three values | `No per-cube status: the search has not been run.` | `No per-cube status: this tab's node is stopped.` | `No per-cube status: no rung settled.` |
| C11 | `colouring/status-counts` | reading | counts of `found` / `exhausted` / `budget` in `best.statuses` | `Not counted: the search has not been run.` | `Not counted: this tab's node is stopped.` | as C10 |
| C12 | `colouring/best-n` | reading | `best.n` | `No settled rung: the search has not been run.` | `No settled rung: this tab's node is stopped.` | `No settled rung: the fabric did not settle any rung of the ladder.` |
| C13 | `colouring/complete` | reading | `best.complete` | `Not established: the search has not been run.` | `Not established: this tab's node is stopped.` | as C12 |
| C14 | `colouring/verification-multiplier` | reading | `best.verificationMultiplier` | `Not measured: the search has not been run.` | `Not measured: this tab's node is stopped.` | as C12 |
| C15 | `colouring/attestation` | reading | `best.attestation` — see §5.1 | `Not established: the search has not been run.` | `Not established: this tab's node is stopped.` | the absence arm, rendered per §5.1 |
| C16 | `colouring/agreeing` | reading | `best.agreeing[]` — peer id tags per cube | `No placement: the search has not been run.` | `No placement: this tab's node is stopped.` | `No placement: no cube reached agreement.` |
| C17 | `colouring/egress` | reading | `best.egress` — see §5.2 | `Nothing measured: nothing has left this device for this workload yet.` | `Nothing measured: this tab's node is stopped.` | — |
| C22 | `colouring/quorum` | reading | `best.quorum` — `describeQuorum` verbatim, see §5.5 | `Not composed: the search has not been run.` | `Not composed: this tab's node is stopped.` | `Not composed: the fabric settled no rung, so no shard was placed.` |
| C23 | `colouring/resume` | reading | `best.resume` — see §5.6 | `Not resumed: the search has not been run.` | `Not resumed: this tab's node is stopped.` | `Not resumed: the fabric settled no rung, so nothing was carried.` |

Plus, unchanged and not counted as figure regions: `#run` (control), `#run-status`
(control-status, existing strings `start a node first` / `ready` / `n = …` / `settled n = …` /
`nothing settled`), `#run-report` (text view), `#verify` (control), `#verify-report` (text view).

**Verification card — 4 further regions** (C18–C21), reading `TabApi.verifyAnswer()`:

| # | Region | Reads | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|
| C18 | `colouring/verify-verdict` | `.ok` (only when `.checked`) | `Not checked: no answer has been produced to check.` | `Not checked: no answer has been produced to check.` (the check needs no node — §5.4) | — |
| C19 | `colouring/verify-n` | `.n` | as C18 | as C18 | — |
| C20 | `colouring/verify-triples` | `.triplesChecked` | as C18 | as C18 | — |
| C21 | `colouring/verify-violation` | `.violation` | as C18 | as C18 | `No refutation: every triple checked has two colours among its three numbers.` |

**Colouring surface count: 23 regions.**

> **Amended 2026-08-14 — C22 added, VER-03 and VER-04.** It is out of numeric order in the
> table above on purpose: it belongs to the run card beside C15, not to the verification card
> C18–C21, and renumbering four committed rows to make one row sort would break every
> reference to them. C22 is the first region on this page reporting a decision the fabric took
> *before* any work was placed. It exists as its own row rather than as a line inside C15
> because the two answer different questions from different inputs — C15 is
> `classifyAttestation` over the certificates of whoever answered and signed, C22 is
> `composeQuorum` over the candidate pool — and **a fabric on which the quorum gate never ran
> produces an identical C15**. Merging them would make the page's strongest claim
> unfalsifiable.

> **Amended 2026-08-17 — C23 added, CHURN-03.** Out of numeric order for C22's reason and
> appended for the same one: it belongs to the run cards, not to the verification card, and
> renumbering committed rows to make one row sort would break every reference to them. See
> §5.6 for why the read half of a checkpoint needs a region rather than only a returned field.

### 4.3 Primes — 12 regions

**Read §10 before implementing this surface.** As of 2026-08-10 there is no path from a tab to
a prime-counting job: `primes.wasm` has no signed `NameRecord`, and `runJob` hardcodes each
shard's value to `{a: <index>}`, so it cannot carry `buildPrimesInput(n)`. The regions below are
specified for both dispositions. Under Option B (no dispatch path) every `reading` region on this
surface renders its **unavailable** copy permanently and the run control is absent, not disabled —
a disabled control with no explanation is a placeholder wearing a different hat.

The unavailable copy for the whole surface, rendered once as a panel above the cards and
repeated per region in short form:

> **This workload has no dispatch path from a browser tab.** The prime-counting module ships in
> this repository and runs in the Node test suite, but no signed record vouches for it, and every
> executor in this fabric refuses a module whose record no pinned anchor signed. The published
> figures below are measurements from a run recorded elsewhere; nothing on this screen is a
> reading from your tab.

| # | Region | Kind | Reads (Option A) | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|---|
| N1 | `primes/n-arg` | control | argument | `Nothing dispatched yet — this is what would be sent.` | same | — |
| N2 | `primes/shards-arg` | control | argument | same | same | — |
| N3 | `primes/total` | reading | `runPrimes().total` | `No count: the sieve has not been run in this tab.` | `No count: this tab's node is stopped.` | `No count: this workload has no dispatch path from a tab — see above.` |
| N4 | `primes/complete` | reading | `runPrimes().complete` | `Not established: the sieve has not been run in this tab.` | `Not established: this tab's node is stopped.` | as N3 |
| N5 | `primes/reduce-state` | reading | `runPrimes().reduceAttempted`, `.reduceReason`, `.combined` | `Not attempted: the sieve has not been run in this tab.` | `Not attempted: this tab's node is stopped.` | §5.3's lone-tab copy, or the fabric's own `reduceReason` |
| N6 | `primes/elapsed` | reading | `runPrimes().elapsedMs` | `Not timed: the sieve has not been run in this tab.` | `Not timed: this tab's node is stopped.` | as N3 |
| N7 | `primes/attestation` | reading | `runPrimes().attestation` | `Not established: the sieve has not been run in this tab.` | `Not established: this tab's node is stopped.` | §5.1's absence arm |
| N8 | `primes/egress` | reading | `runPrimes().egress` | `Nothing measured: nothing has left this device for this workload yet.` | `Nothing measured: this tab's node is stopped.` | as N3 |
| N9 | `primes/per-shard` | reading | **no field exists** | `No per-shard counts: the reading this page receives carries the total and not the shard rows.` | same | same |
| N10 | `primes/oracle-table` | cited | published π(x) at 10⁴, 10⁵, 10⁶, 10⁷ | always present, marked `published in the mathematical literature; not computed here` | unchanged | — |
| N11 | `primes/oracle-compare` | reading | N3 against N10's row for the same x | `No comparison: there is no count from this tab to compare.` | same | as N3 |
| N12 | `primes/max-n` | constant | `@o2/demo.PRIME_MAX_N` | always present | unchanged | — |

**N9 is the pattern for "the mockup drew something the reading does not carry."** The mockup's
per-shard table is not available from any `TabApi` shape; it is not silently dropped, and it is
not filled with plausible rows. It states which reading it would need. Same treatment applies
anywhere else a mockup panel outruns the contract.

**The stated-weakness panel** (the oracle is blind above a power of ten) ports verbatim from the
mockup as prose. It is not a figure region.

### 4.4 π and reduce — 14 regions

Reading: `TabApi.runPi({terms, shards, redundancy, peerIds})` → `TabPiRun`.

| # | Region | Kind | Reads | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|---|
| P1 | `pi/terms-arg` | control | argument | `Nothing dispatched yet — this is what would be sent.` | same | — |
| P2 | `pi/shards-arg` | control | argument | same | same | — |
| P3 | `pi/terms` | reading | `.terms` | `Not dispatched: the series has not been run in this tab.` | `Not dispatched: this tab's node is stopped.` | — |
| P4 | `pi/shards` | reading | `.shards` | as P3 | as P3 | — |
| P5 | `pi/complete` | reading | `.complete` — the MAP half | `Not established: the series has not been run in this tab.` | `Not established: this tab's node is stopped.` | — |
| P6 | `pi/reduce-attempted` | reading | `.reduceAttempted` **and** `.reduceReason` | `Not attempted: the series has not been run in this tab.` | `Not attempted: this tab's node is stopped.` | §5.3 — the second-device panel, carrying `reduceReason` verbatim |
| P7 | `pi/combined` | reading | `.combined` | as P6 | as P6 | `No aggregate: a reduce was started and no combine produced one.` |
| P8 | `pi/tree-depth` | reading | `.treeDepth` | `No tree: no reduce was attempted.` | `No tree: this tab's node is stopped.` | `No tree: no reduce was attempted — see above.` |
| P9 | `pi/combines` | reading | `.combines` | as P8 | as P8 | as P8 |
| P10 | `pi/estimate` | reading | `.estimate` (null-safe) | `No estimate: the series has not been run in this tab.` | `No estimate: this tab's node is stopped.` | `No estimate: the fabric produced no aggregate to read back.` |
| P11 | `pi/error-bound` | reading | `.errorBound` | `No bound: the series has not been run in this tab.` | `No bound: this tab's node is stopped.` | — |
| P12 | `pi/against-published` | reading + cited | \|P10 − π\| shown against P11; π quoted as a published constant with both operands on screen | `No comparison: there is no estimate from this tab to compare.` | same | `No comparison: the fabric produced no aggregate to compare.` |
| P13 | `pi/elapsed` | reading | `.elapsedMs` | `Not timed: the series has not been run in this tab.` | `Not timed: this tab's node is stopped.` | — |
| P14 | `pi/egress` | reading | `.egress` — §5.2 | `Nothing measured: nothing has left this device for this workload yet.` | `Nothing measured: this tab's node is stopped.` | — |

Two mockup panels are constrained:

- **The reduce-tree diagram** may render `treeDepth` rows and nothing else. It may not draw
  per-combine node states — `TabPiRun` carries no per-node reading, and boxes with invented
  states are exactly the class of thing this phase exists to keep off the screen. If the diagram
  is drawn, each row is labelled `map` / `lvl 1` … and the caption states that depth and combine
  count are the whole of what the reading carries.
- **The shard-partials table has no reading** and is treated as N9 is: `No per-shard partials:
  the reading this page receives carries the aggregate and not the shard rows.`

`runPi` returns no attestation field, unlike `runColouring`. The π surface therefore shows no
attestation region and says so in one sentence beside the reduce panel: *the aggregation's own
claim is carried by the reduce, and the reading this page receives does not include the map's
receipt.* An attestation panel filled from the colouring run's receipt would be a receipt for a
different job.

### 4.5 Bring-your-own — 13 regions

Reading: `TabApi.runJob({moduleCid, moduleRecord, peerIds, shards, redundancy, includeSelf, sovereign})`
→ `TabJobReport`. This surface is what closes audit finding G4: `runJob` gains a caller in the page.

**The form requires both a module CID and a complete signed record.** `runJob` requires
`moduleRecord` by construction; a CID-only form would produce nothing but refusals discovered as
timeouts. Six record fields, all required: `name`, `cid`, `version`, `expiresAt`, `signer`,
`signature`. The form's submit control stays disabled until all seven inputs are non-empty and
`cid` matches `moduleCid`, and the disabled state carries a visible reason naming which field is
missing — a disabled control with no reason is the same defect as a placeholder.

**Copy that must appear above the form, because it is true and discovering it as a timeout is
the failure this surface exists to prevent:**

> This tab pins one build authority — the demo's own, shipped in this bundle. A module whose
> record was signed by any other key is refused by every executor it reaches, including this
> tab's own. The refusal is shown below in the fabric's own words. To dispatch your own module
> you sign it with a key this tab pins; there is no value you can enter here that turns the check
> off.

| # | Region | Kind | Reads | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|---|
| Y1 | `byo/pinned-anchor` | constant | `@o2/demo.KERNEL_TRUST_ANCHOR` (the value `start()` pins when none is supplied) | always present | unchanged | — |
| Y2 | `byo/shard-input` | constant | the literal shape `runJob` sends per shard: `{a: <shard index>}` | always present, with the sentence: *every shard receives this canonical value; this path carries no caller-supplied input* | unchanged | — |
| Y3 | `byo/complete` | reading | `.complete` | `Not dispatched: no job has been submitted from this form.` | `Not dispatched: this tab's node is stopped.` | — |
| Y4 | `byo/partitions` | reading | `.partitions[]` (`-1` renders as `no agreement`, never as a number) | `No partitions: no job has been submitted from this form.` | `No partitions: this tab's node is stopped.` | — |
| Y5 | `byo/replicas` | reading | `.replicas[]` | `No replica counts: no job has been submitted from this form.` | `No replica counts: this tab's node is stopped.` | — |
| Y6 | `byo/agreeing` | reading | `.agreeing[]` | `No placement: no job has been submitted from this form.` | `No placement: this tab's node is stopped.` | `No placement: no shard reached agreement.` |
| Y7 | `byo/verification-multiplier` | reading | `.verificationMultiplier` | `Not measured: no job has been submitted from this form.` | `Not measured: this tab's node is stopped.` | — |
| Y8 | `byo/fetched` | reading | `.fetched` | `Not counted: no job has been submitted from this form.` | `Not counted: this tab's node is stopped.` | — |
| Y9 | `byo/rejected` | reading | `.rejected` | as Y8 | as Y8 | — |
| Y10 | `byo/failures` | reading | `.failures[]` — `nodeId` and `reason`, the fabric's own words, verbatim | `No refusals: no job has been submitted from this form.` | `No refusals: this tab's node is stopped.` | `No refusals: every shard reached agreement.` |
| Y11 | `byo/attestation` | reading | `.attestation` — §5.1 | `Not established: no job has been submitted from this form.` | `Not established: this tab's node is stopped.` | §5.1's absence arm |
| Y12 | `byo/egress` | reading | `.egress` — §5.2 | `Nothing measured: nothing has left this device for this job yet.` | `Nothing measured: this tab's node is stopped.` | — |
| Y13 | `byo/sovereign-label` | reading | whether the submitted job carried `sovereign` | `Not dispatched: no job has been submitted from this form.` | `Not dispatched: this tab's node is stopped.` | — |

**The sovereign option.** A checkbox plus an owner-id field, the two inseparable in the form as
they are inseparable on the contract — `submitJob` refuses a sovereign shard with no owner by
name. When it is set, Y12's egress panel is the one place in this demo where a non-empty
`violations` list can appear; §5.2's refusal arm covers it and needs no change to be correct.

The mockup's second bring-your-own card (`tools/aot`, "CLI only") ports as prose with no figure
regions. It describes a build-time pipeline that has no page-side reading, and it says so.

### 4.6 Fabric state — 21 regions

The surface with no workload of its own: it renders the cross-cutting readings.

| # | Region | Kind | Reads | Before any reading | Stopped | Unavailable |
|---|---|---|---|---|---|---|
| F1 | `fabric/peers-all` | reading | `peers().length` | `Not counted: no discovery round has run.` | `Not counted: this tab's node is stopped.` | thrown message |
| F2 | `fabric/compute-peers` | reading | `computePeers().length` | as F1 | as F1 | as F1 |
| F3 | `fabric/held-peers` | reading | `heldPeers().length` | as F1 | as F1 | as F1 |
| F4 | `fabric/peer-rows` | reading | `heldPeers()[]` — `peer` and `carriesWork`, one row each | `No peers held: no discovery round has run.` | `No peers held: this tab's node is stopped.` | `No peers held: this tab holds no connection to another node.` |
| F5 | `fabric/relayed-only` | reading | `connectDiscoveredPeers().relayedOnly`, `.stalled` | `Not known: no discovery round has run.` | `Not known: this tab's node is stopped.` | `Every peer this tab holds can carry a job.` |
| F6 | `fabric/attestation-strength` | reading | last run's `attestation.strength`, or the absence arm's `kind` | `Not established: no job has been run in this tab.` | `Not established: this tab's node is stopped.` | §5.1 |
| F7 | `fabric/attestation-description` | reading | `attestation.description`, **verbatim** | as F6 | as F6 | §5.1's `reason`, verbatim |
| F8 | `fabric/attestation-counts` | reading | `attestation.replicas`, `.operators`, `.sharedRelay` | as F6 | as F6 | absence arm: `.agreeing` and `.verified` |
| F9 | `fabric/egress-frames` | reading | last run's `egress.entries.length` | `Nothing measured: no job has been run in this tab.` | `Nothing measured: this tab's node is stopped.` | — |
| F10 | `fabric/egress-bytes` | reading | `egress.totalBytes` | as F9 | as F9 | — |
| F11 | `fabric/egress-withheld` | reading | `egress.violations` — §5.2, figure and sentence in **one** region | as F9 | as F9 | — |
| F12 | `fabric/duty-user` | reading | `capacity().dutyCycle` | `Not read: this tab's node is stopped.` | `Not read: this tab's node is stopped.` | thrown message |
| F13 | `fabric/slots` | reading | `capacity().slots` | as F12 | as F12 | as F12 |
| F14 | `fabric/governor-hidden` | reading | `governor().hidden` | as F12 | as F12 | as F12 |
| F15 | `fabric/governor-duty` | reading | `governor().dutyCycle` | as F12 | as F12 | as F12 |
| F16 | `fabric/governor-transitions` | reading | `governor().transitions`, `.sleptMs` | as F12 | as F12 | as F12 |
| F17 | `fabric/isolation` | reading | `isolation().crossOriginIsolated`, `.hasSharedArrayBuffer`, `.inIframe` | always readable — three booleans, no node needed | unchanged | — |
| F18 | `fabric/start-reached` | reading | `startReport().reached` and `.asked` | `Not asked yet.` (existing `#report` initial string) | readable with no node: `asked` is zero and the copy says *nobody was asked* | `Asked, and no peer answered.` — the cliff, named |
| F19 | `fabric/start-tallies` | reading | `startReport().byBrowser[]`, one row per family | `Not asked yet.` | as F18 | `No rows: no node has reported an outcome.` |
| F20 | `fabric/blocks` | reading | `storedBlocks()`, `activity().fetched`, `activity().rejected` | `Not counted: this tab's node is stopped.` | same | thrown message |
| F21 | `fabric/addresses` | reading | `addresses().peerId`, `.webrtc`, `.circuit` | `No addresses: this tab's node is stopped.` | same | `No dialable address: the relay has produced no reservation.` |

Also on this surface, not figure regions: `#report` (the existing start-outcome text view, moved
here from the colouring section — `peer-ledger.e2e.test.ts` and `two-tabs.e2e.test.ts` reach it
by `getElementById(...).click()` and `textContent`, both of which work on a hidden panel, so the
move is safe and must stay safe), `#refresh-report` (control), `#fabric-report` (text view), and
the duty-cycle slider (control → `setDutyCycle`, `RangeError` from the governor rendered
verbatim if it throws).

**Two mockup bar controls do not ship: `+ peer` and `− peer`.** They synthesise peers. There is
no reading behind them and no fabric operation they correspond to; a control that invents a peer
is a placeholder with a click handler. The mockup's *"Simulate a second device joining"* button on
the π surface goes the same way, replaced by §5.3's copy.

### 4.7 Benchmarks — 2 region groups, all `cited`

Renders the committed figures of `docs/perf/prime-and-pi-benchmarks.md`. Blocks nothing, reads
nothing, and must never look like a live reading.

| # | Region | Kind | Content |
|---|---|---|---|
| K1 | `bench/speedup` | cited | Real parallel speedup, §5 of the document: 1 / 2 / 4 / 8 processes, wall, speedup, efficiency, for both kernels |
| K2 | `bench/overhead` | cited | Overhead and cost: fabric overhead at redundancy 1 and 2, decomposition ratio, cold instantiate p50, module sizes |

Requirements on this surface:

1. A provenance line at the top of the surface, not in a footnote:
   **Measured 2026-08-02 on one machine — 8 physical cores, Node 23.11, V8's built-in
   WebAssembly. Every figure on this screen comes from that recorded run. None of them is a
   reading from your tab.**
2. Every figure carries the same visual treatment as a citation (`--color-neutral-700`, not the
   Heading-size figure treatment used for live readings), so a live figure and a cited one are
   distinguishable without reading the label.
3. A link to `docs/perf/prime-and-pi-benchmarks.html`, alongside the existing footer link.
4. Figures are transcribed from the committed document and nowhere else. A number on this
   surface that is not in that document is the defect this surface is most likely to introduce;
   P9 in §9 is the check.

**Total regions enumerated: 93.** By surface: 5 session header, 3 bar, 23 colouring, 12 primes,
14 π, 13 bring-your-own, 21 fabric state, 2 Benchmarks. By kind: **76 `reading`** — the ones the
anti-placeholder guard holds to a named absence — 6 `constant`, 3 `cited`, 8 `control`.

*(91/74/21-colouring until 2026-08-14, when C22 landed; 92/75/22 until 2026-08-17, when C23 did.
`demo-regions.ts`'s `UI_SPEC_TALLY` is a transcription of these three figures and the guard
asserts the catalogue against them in both directions — so this paragraph is a claim under
test, not a note.)*

---

## 5. The four cases that are the whole point

### 5.1 Attestation — the page composes no sentence of its own

The receipt arm renders `attestation.description` **verbatim**, in a block with the accent left
rule, with `strength`, `replicas`, `operators.length` and `sharedRelay` beside it as separate
labelled regions. The page adds no adjective, no re-ordering, no "in other words".

The absence arm (`kind: 'holds-no-verified-attestation'`) renders exactly what today's
`attestationLines` renders: how many replicas agreed on the least-attested shard, how many of
those produced a signed statement this tab could check, and then `attestation.reason` verbatim.
It is a statement, not a blank and not a weaker label.

This is the existing established pattern and it is preserved, in the words its own source gives:
one source of the words, and neither the CLI nor this page holds a copy. P8 in §9 asserts it.

### 5.2 Egress — the withheld figure and its sentence are one region

`0 withheld` may never be rendered without the sentence explaining *why* it is zero. The bare
figure reads as a sovereignty proof and would be a lie by omission.

The contract that makes it structural rather than remembered: **the count and the sentence are
one region and one template function.** `F11` / `C17` / `P14` / `Y12` / `N8` render:

- No sovereign data registered:
  `0 withheld — and this run registered no sovereign data, so that is the guard reporting it had
  nothing to hold back, not a proof of sovereignty.`
- Sovereign data registered, none withheld:
  `0 withheld — and this run registered N sovereign shard(s), so the guard was watching for those
  bytes and saw none of them leave. That is a clean scan of what crossed, not a proof about what
  could not.`
- Frames withheld:
  `N frame(s) WITHHELD: <ids>. Those bytes are still on this device. They were not sent
  anywhere.` — rendered in `--color-refusal`.

The same function produces all three views, on every surface. P7 in §9 asserts that the count
never appears without its sentence.

**Amended 2026-08-10 — EGR-01. The middle arm did not exist and its absence was a false
sentence, not a gap.** This section fixed two arms split on `violations.length`, and the empty
one said *the run registered no sovereign data*. That is a statement about **what the run
submitted**; `violations` is a reading of **what the guard saw leave**. They coincide on a public
dispatch, which is why the wording survived Plans 27-04, 27-05, 27-07 and 27-08 — and Phase 27's
verifier then printed it off a bring-your-own dispatch that had submitted **six** owner-pinned
shards, beside `byo/sovereign-label` reading *sovereign — every shard was submitted owner-pinned*
in the same render pass. The prior text of this section is preserved above in its first and third
bullets, which are unchanged to the character; what was added is the arm that was missing and the
`registeredSovereign` count on `EgressManifest` that makes it decidable. The one-region-one-
function rule is **not** relaxed by the addition: `egressLines` still owns all three, no surface
composes a sentence of its own, and P7 still ranges over all of them.

### 5.3 A lone tab cannot run the π reduce

`reduceJob` excludes the submitter from the combine executor set by contract, so the first
visitor gets `reduceAttempted: false` with the fabric's own reason. **This is presented as a
condition of the topology, not as a failure and not as a zero.** No refusal colour, no error
tone, no `0`.

The panel (mockup layout, accent border, ported verbatim):

> **This claim needs a second device.**
> The submitter is excluded from the combine executor set by contract, so a lone tab maps every
> shard and combines none. This is the ordinary state of the first tab on the page, not a
> failure. Open this page on another device, in another browser, or in a private window, and the
> tree has somewhere to run.
>
> The fabric's own reason: *«`reduceReason`, verbatim»*

`reduceReason` is rendered verbatim and is never paraphrased — the page has no better words for
it than the fabric's. When `reduceAttempted` is true and `combined` is false, the panel does not
appear; P7's sibling case is that `combined: false` renders `No aggregate: a reduce was started
and no combine produced one.` The three booleans stay separate on screen for the reason the
contract keeps them separate.

The same panel, worded for its own workload, covers `primes/reduce-state` under Option A.

### 5.4 The check that needs nothing

`verifyAnswer()` needs no node, no peer and no network. Its card is therefore **not** disabled
when the fabric is stopped, and its absence copy says *no answer has been produced to check* —
never *the node is stopped*, which would be untrue and would misdescribe the one control on the
page that works with the fabric disconnected. `colouring-demo.e2e.test.ts` asserts exactly this
property; the copy must not contradict it.

### 5.5 The quorum verdict is not the attestation, and the page must not let them merge

*Added 2026-08-14 with C22 — VER-03, VER-04.*

C15 and C22 sit in adjacent cards and answer questions that sound like one question. They are
not, and the distinction is the requirement rather than a nicety:

| | C15 — attestation | C22 — quorum |
|---|---|---|
| Computed by | `classifyAttestation` | `composeQuorum` |
| From | the certificates of the replicas that **answered and signed** | the **candidate pool**, before anyone was asked |
| When | after the work came back | before any shard was placed |
| Reads `owner-domain` when | two replicas of one owner agreed | — |
| Reads `[shared-relay-dependency]` when | — | every member it could pick hangs off one relay |

**The reason this section exists at all is a measurement.** `AttestationReceipt` carries a
`sharedRelay` field, and the fabric surface already renders it as `· shared relay: <peer id>`.
That line reads like VER-03's evidence and is not: it is derived from certificates, so deleting
`composeQuorum` outright would leave it printing exactly the same string. **A reading that would
be identical if the mechanism never ran is not evidence of the mechanism.** VER-03 is answered by
C22 or it is not answered.

Both regions render the kernel's own words verbatim — `attestation.description` and
`describeQuorum(quorum)` — and the page composes no sentence of its own in either, per §5.1.
`describeQuorum` emits the refusal **kind** in brackets before the composer's prose, so a guard
can assert *which* refusal occurred rather than pattern-matching a sentence.

### 5.6 A resume must be visible, or it is indistinguishable from a restart

*Added 2026-08-17 with C23 — CHURN-03.*

The write half of CHURN-03 landed on 2026-08-16: `runColouring` passes
`checkpointsInto(node.store)`, so a checkpoint block is written into this tab's IndexedDB as
each cube is answered. Nothing could read one back. A blockstore is content-addressed, so
there was no stable key under which the newest handle could be left for a returning tab to
find — `packages/browser/src/idb-checkpoints.ts` is that key space, one record per job id.

**Why it needs a region and not only a returned field.** From outside the tab, a fabric that
checkpoints and a fabric that does not looked exactly alike, because nothing ever read one
back. That is the gap. Closing it in `TabColouringRun` alone would move the gap one layer up:
a resume nobody can see is a resume nobody can distinguish from a restart, and *picks up where
it left off* would still be a claim about source code rather than a reading on a screen.

C23 renders two lines from `TabResume`, and the count and its sentence are **one region** on
§5.2's rule — `0 of 8` alone reads as a failed resume on a first visit where there was nothing
to resume:

| `TabResume` | The line |
|---|---|
| `refused !== null` | `Started over: a stored checkpoint was refused (<kind>) and dropped, so every cube ran.` |
| `offered === null` | `Started from nothing: this tab had stored no checkpoint for this job.` |
| otherwise | `Resumed from <handle>: <carried> of <cubes> cube(s) came out of it and were dispatched nowhere.` |
| `remembered === null` | `Nothing stored for a next run: this run confirmed no handle.` |
| otherwise | `Stored for a next run: <handle>` |

**`carried` is counted off the shards, never off the pointer.** `main.ts` counts
`ShardResult.ending === 'carried-from-checkpoint'` in `submitJob`'s own answer. The pointer
says what was asked for; the shards say what was carried, and the two disagree exactly when a
checkpoint named fewer shards than the pointer promised — the case a page must not paper over.

**A resumed run reads weaker above C23, and that is correct.** A carried cube was dispatched to
nobody, so this requestor holds no signature over it and `complete` is false. The card note
beside C23 says so, because a visitor who saw the receipt weaken with no explanation would read
a working resume as a broken fabric.

---

## 6. Responsive rules, and the bar

### 6.1 The measured defect

Measured 2026-08-08 at a 393px iPhone viewport: `#bar` is 500px wide, `#bar-what` and
`#bar-stats` are non-wrapping flex children, and `#stop` sits past x=482 — off screen. Stop is
the control the consent gate promises in writing: *"The Stop control in the bar. It ends the
thread and closes the connections immediately."*

`index.html` already carries a comment about an earlier `#bar` defect: *"Reported from an iPhone;
not caught here, because the tests asserted the `hidden` attribute rather than whether anything
was on screen."* **This is the same blind spot one property over: nothing asserts the bar fits.**

**Likely mechanism, stated as a hypothesis and not as the contract.** A flex child's default
`min-width: auto` refuses to shrink below its content's minimum, so two long single-line strings
in one flex row establish a floor wider than the viewport, and `flex-wrap: wrap` never engages
because the row's *items* are what overflow. The contract is §6.3's assertions; they hold
whatever the mechanism turns out to be.

### 6.2 The CSS contract for the bar

```
#bar {
  position: fixed; inset: auto 0 0 0;
  box-sizing: border-box; width: 100%; max-width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;   /* content | Stop */
  gap: 4px 12px;
  padding: 10px 12px max(10px, env(safe-area-inset-bottom)) 12px;
  background: var(--color-accent-900); color: var(--color-bg);
  border-top: 1px solid var(--color-accent-700);
}
#bar-what  { grid-column: 1; min-width: 0; overflow-wrap: anywhere; }
#bar-stats { grid-column: 1 / -1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
#stop      { grid-column: 2; grid-row: 1; justify-self: end; align-self: start;
             min-width: 44px; min-height: 44px;
             background: var(--color-bg); color: var(--color-accent-900);
             border: 1px solid var(--color-bg); }
@media (min-width: 40rem) {
  #bar { grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto; }
  #bar-what  { grid-column: 1; }
  #bar-stats { grid-column: 2; grid-row: 1; }
  #stop      { grid-column: 3; }
}
body { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8.5rem); }
```

- **`min-width: 0` on both text children is load-bearing** and is the line most likely to be
  removed by someone tidying up. Its removal must turn §6.3 red; that is the mutation proof.
- **`overflow-x: hidden` on `html` or `body` is forbidden.** It makes B1 pass while the defect
  is intact — the page stops scrolling sideways and the Stop control is still off screen. §9's
  property B6 asserts the rule is absent, so the fix cannot be faked by hiding it.
- `.spacer` is dropped in the grid layout; the id `#stop` and the DOM order stay as they are.

### 6.3 Assertable geometry

At viewport widths **320, 360, 393, 768, 1280** (×720 height, `deviceScaleFactor: 2` for the
narrow three), in both states — node running with no work, and node running with work in flight:

| # | Property |
|---|---|
| B1 | `document.documentElement.scrollWidth <= window.innerWidth + 1` — the page does not scroll sideways |
| B2 | `#bar`'s box: `x >= 0` and `x + width <= innerWidth + 1` |
| B3 | `#stop`'s box is fully inside the viewport on both axes, and `width >= 44 && height >= 44` |
| B4 | `document.elementFromPoint(centre of #stop)` is `#stop` or a descendant — nothing overlays the promised control |
| B5 | With the page scrolled to its end, the last element of `#main` is not covered by `#bar`: its bottom is above `#bar`'s top |
| B6 | Neither `html` nor `body` has a computed `overflow-x` of `hidden` |
| B7 | The nav strip may scroll within itself; `#surfaces`'s box is inside the viewport (B1 already forbids it escaping) |

These run on every surface, not only Colouring — a surface whose widest table forces page-level
horizontal scroll is the same defect one screen over.

### 6.4 Layout rules for the surfaces

- Content column: `max-width: 1240px`, `margin-inline: auto`, `padding-inline: var(--space-4)`.
- Card grids: `repeat(auto-fit, minmax(300px, 1fr))` with `gap: var(--space-6)`, exactly as the
  mockup. At 320px that collapses to one column with no media query.
- Every table that can exceed its column is wrapped in `<div style="overflow-x:auto">` — the
  mockup already does this and it is what keeps B1 true on the primes and π tables.
- Long machine values (peer ids, CIDs, multiaddrs) use `overflow-wrap: anywhere`. A peer id that
  forces a horizontal scrollbar is B1's most likely failure after the bar.
- The sticky nav is `position: sticky; top: 0` with the page background; it must not be `fixed`,
  or B5's arithmetic acquires a second exception.

---

## 7. Accessibility

### 7.1 Structure

- One `<h1>` (the page title), one `<h2>` per surface (its headline), `<h3>` for card titles. No
  level is skipped.
- Each surface panel is `role="tabpanel"`, labelled by its tab, and `tabindex="0"` so a keyboard
  user can reach a panel whose first control is far down.
- The bar is `<div id="bar" role="status">` — a live region, not a landmark, and never inside a
  panel.
- Every table has a caption or a preceding heading that names it; header cells are `<th
  scope="col">`.

### 7.2 Contrast — measured, not assumed

| Pair | Ratio | Verdict |
|---|---|---|
| `--color-text` `#1d1f20` on `--color-bg` `#f2f2f3` | 15.9:1 | body text — pass |
| `--color-accent` `#5980a6` on `--color-bg` | 3.70:1 | **fails at body size**; permitted only for ≥24px text, borders and non-text UI |
| `--color-accent-700` `#416180` on `--color-bg` | 5.79:1 | small accent text — pass |
| `--color-neutral-700` `#5d5d60` on `--color-bg` | 5.84:1 | captions and table headers — pass |
| the mockup's `.text-muted` (55% mix) on `--color-bg` | 3.70:1 | **fails**; replaced by `--color-muted` at 70% |
| `--color-muted` (70% mix) on `--color-bg` | 6.28:1 | pass |
| `--color-bg` on `--color-accent-900` `#1d2d3d` (the bar) | 14.6:1 | pass |
| `--color-refusal` `#cb4b16` on `--color-bg` | 4.05:1 | permitted for ≥18.66px bold or ≥24px, and for borders; refusal *prose* uses `--color-text` with a refusal-coloured left rule |

The `.text-muted` change is a required deviation from the imported stylesheet, not a preference:
at 12px caption size the source value is below the threshold, and captions are where this page
puts its named absences.

### 7.3 Targets and pointers

- `#stop`: minimum 44×44 (§6.2), and B3/B4 assert it.
- Every other control: minimum 40px in the smaller dimension, or 32px with at least 8px of
  clear space on all sides.
- Nav tabs: 44px tall on viewports below 40rem.
- No hover-only affordance anywhere. Every state a hover reveals is also revealed by focus.

### 7.4 Live regions and motion

- `#bar-what` is `aria-live="polite"`. `#bar-stats` is `aria-live="off"` — it changes about once
  a second, and a screen reader announcing a task counter continuously is worse than silence.
- `#run-status` and each surface's run-status equivalent are `role="status"`.
- A run's completion announces once, through the surface's status element, not through the
  region that changed.
- The bar's pulse dot: `@media (prefers-reduced-motion: reduce) { animation: none }`. It is the
  only animation on the page and it must be the only one.
- Nothing auto-scrolls, nothing steals focus. When a run finishes, focus stays where the visitor
  put it.

### 7.5 Forms (bring-your-own)

- Every input has a visible `<label>` with `for`, not a placeholder standing in for one.
- The submit control's disabled state is accompanied by visible text naming what is missing,
  and by `aria-describedby` pointing at it.
- A refusal from the fabric is rendered in the region, associated with the form by
  `aria-describedby`, and announced once via `role="status"`.

---

## 8. What must not break

### 8.1 The element-id contract

These ids are read by the e2e project. Renaming or removing one rewrites a guard in the same
change that rewrites the UI, which is how a guard stops guarding.

| Id | Read by | Requirement |
|---|---|---|
| `#gate`, `#gate-terms`, `#allow`, `#decline`, `#reporting` | built-bundle, attestation-ui | Present, and the gate is the only thing on screen before consent |
| `#main` | built-bundle, peer-ledger, two-tabs | Present, `hidden` until consent |
| `#state`, `#join`, `#explain` | built-bundle | Visible on every surface (§2), copy unchanged for the no-relay case |
| `#peers` | attestation-ui | Copy unchanged, including `N node(s) computing` |
| `#run`, `#run-status` | colouring-demo, attestation-ui | Actionable without navigating (Colouring is the default surface) |
| `#run-report` | colouring-demo, attestation-ui | **Visible after a run in every view mode**; content unchanged, line for line |
| `#verify`, `#verify-report` | colouring-demo | Actionable and readable with the fabric stopped |
| `#report`, `#refresh-report` | peer-ledger, two-tabs | May move to the Fabric-state panel; both are reached via `getElementById(...).click()` / `textContent`, which work on a hidden panel |
| `#bar`, `#bar-what`, `#bar-stats` | colouring-demo, built-bundle | Present while a node exists, absent otherwise; `of one thread` and `running work for` substrings preserved |
| `#stop` | built-bundle | Present, and §6's geometry holds |

### 8.2 The two mockup-directory guards

- `packages/node/src/vocabulary.node.test.ts` — two line exemptions naming the mockup's
  stylesheet by path. The directory stays; the port is a **copy**; the ported file does not carry
  the exempted phrases.
- `packages/node/src/strip-comments.node.test.ts` — one entry naming the mockup's `support.js`.
  That file is not ported and not touched. No new file in `packages/browser/demo/` declares a
  comment stripper of its own.

Both have dead-entry checks, so an attempt to tidy the mockup away reports itself rather than
going quietly green.

---

## 9. Assertable properties, and the mutation that proves each

The anti-placeholder guard lands **before** the screens. Written afterwards it would be written
to fit them, and *"the mockup is now wired"* would be satisfiable by CSS.

Suggested placement (discretionary): `packages/node/src/demo-regions.e2e.test.ts` for P1–P9,
`packages/node/src/demo-viewport.e2e.test.ts` for B1–B7, and one new case inside the existing
`packages/node/src/built-bundle.e2e.test.ts` for P10, which already records every request. Run
by project: `npx vitest run --project e2e`.

| # | Property | Plant that must turn it red |
|---|---|---|
| P1 | Every `REGIONS` entry resolves to exactly one element; every `[data-region]` element is in `REGIONS` | Add a card with a number and no `data-region` |
| P2 | With the fabric stopped, no text node containing a digit inside `#main` has an ancestor carrying `data-region` of kind `control`/`constant`/`cited` or `data-kind="reading"` — i.e. **no undeclared digit is on screen** | Paste any mockup literal (`41`, `peer-4a91`, `785398163231095`) into a panel |
| P3 | With the fabric stopped, every `data-kind="reading"` region's trimmed text equals its `data-absence`, and matches `/^\D*$/` | Render `0` instead of the absence sentence in any one region |
| P4 | Every reading region's `data-source` starts `TabApi.` and names a method present on `window.o2` | Point a region at `TabApi.runPrimes()` while no such method exists |
| P5 | **Liveness.** After a real two-tab run, the colouring regions no longer equal their absence text | Wire a region to nothing so it stays absent forever |
| P6 | For each of a named set of fields (`best.n`, `verificationMultiplier`, `estimate`, `egress.totalBytes`), the string in the rendered region also occurs in that surface's text view | Format the same value twice, differently |
| P7 | Whenever an egress region's text contains the withheld count, it also contains one of §5.2's three sentences: `registered no sovereign data` (nothing registered), `saw none of them leave` (registered, none withheld), or `They were not sent anywhere.` (withheld) | Split the count and its sentence into two elements |
| P8 | The attestation region's text equals `attestation.description` (receipt arm) or contains `attestation.reason` verbatim (absence arm), compared against a fresh `window.o2` reading taken in the same page | Compose a sentence in the page from `strength` |
| P9 | Every figure on the Benchmarks surface occurs verbatim in `docs/perf/prime-and-pi-benchmarks.md` | Round one figure, or add one the document does not contain |
| P10 | During load and before consent, every request the page makes is same-origin | Restore the mockup's font `@import` |
| B1–B7 | §6.3 | Remove `min-width: 0` from `#bar-what`; separately, add `overflow-x: hidden` to `body` and confirm B6 goes red while B1 stays green |

Each plant is watched red, restored by the surgical inverse of the edit, and verified with `cmp`
against a snapshot taken immediately before planting — per this repository's conventions, and
because the hunk count is a one-way alarm rather than a check.

**P5 exists because P2, P3 and P4 are all satisfiable by a page that renders nothing.** A guard
that can only fail in one direction is half a guard.

---

## 10. The one question this contract could not resolve from the sources

**The Primes surface has no dispatch path from a tab, and closing that is not "wiring".**
Measured, not inferred:

1. **No signed record for the prime-counting module.** `packages/demo/src/kernel-record.ts`
   exports `KERNEL_RECORD` (colouring) and `PI_RECORD`, both signed by `KERNEL_TRUST_ANCHOR`.
   There is no third record. `primesKernelBytes` exists and is checked against `primes.wat`, but
   nothing vouches for it. A tab pins that one anchor (`start()` defaults to it, `autoStart()`
   grows no parameter for another), so every executor — including this tab's own — refuses a
   prime-counting dispatch for a provenance failure.
2. **`runJob` cannot carry the input.** Its shards are built as
   `{ value: { a: i }, label: 'public' }`. The prime kernel reads an 8-byte input block from
   `buildPrimesInput(n)`. So even with a record, `runJob` dispatches the wrong bytes.
3. **Re-signing is not free.** `scripts/sign-kernel.ts` mints a **new** ed25519 key on every run
   and discards the private half, so the existing records cannot be extended. Adding a third
   record means a new anchor, all three records re-signed, and one commit — and it changes what a
   stock `o2 agent` and a stock `o2 seed` will run, because both default to
   `KERNEL_TRUST_ANCHOR`.

> **RULED 2026-08-17 — Option A was taken.** Phase 27 shipped Option B, and the owner closed
> audit finding G4's primes half by taking Option A on top of it. All three facts above have been
> answered: `PRIMES_RECORD` is signed by `KERNEL_TRUST_ANCHOR`, all three demo records were
> re-signed together under a new anchor, and `TabApi.runPrimes` builds the eight-byte input itself
> rather than asking `runJob` to carry it. The trust-root cost stated in fact 3 was paid
> knowingly and once.
>
> The two dispositions are kept below **unedited**, because they are the record of a decision and
> not a to-do list. What changed in the tree: `#s-primes` carries one primary control
> (`Count the primes`, §11's copy, which was specified for this and had never been rendered);
> N3–N8 and N11 are ordinary readings with ordinary absences; and `demo-primes.e2e.test.ts` drives
> a real run and asserts the fabric's count **equal** to the published value.
>
> **N9 took one more step, on the same day.** It stayed permanently unavailable through Option A
> because `TabPrimesRun` carried the total and not the shard rows — true, and not reason enough
> to leave a permanent absence on a surface that had just started working. `perShard` was added
> to the reading, **derived from the tab's own shard results and never from the total**, so the
> sum of the rows against the aggregate the combine nodes returned is a real check on the reduce
> rather than a decomposition that would agree by construction. The surface renders both operands
> and names a disagreement.
>
> **`permanentlyUnavailable` therefore has no members left in the catalogue.** The mechanism
> stays — the field, `render.ts`'s handling, and the guards in both directions — and
> `demo-regions.e2e.test.ts` asserts the set is empty, so the next region to claim a permanent
> absence must be added deliberately and cannot arrive unnoticed.

Two dispositions, and the ruling is the planner's or the owner's:

- **Option A — make it real.** Extend `sign-kernel.ts` to sign `primes.wasm`, regenerate
  `kernel-record.ts` (new anchor, three records, one commit), and add
  `TabApi.runPrimes({n, shards, redundancy, peerIds})` mirroring `runPi` — map with
  `buildPrimesInput`, reduce over `PRIME_COUNT_KEY` with `projectPrimeCount`, read the total back
  out of the store rather than recomputing it. Roughly 60 lines in `main.ts`, one interface, one
  build-time script change. It touches neither a kernel's bytes, nor the fabric, nor a wire
  protocol — but it is outside `27-CONTEXT.md`'s statement that *"every API it consumes exists"*,
  and that statement should be corrected rather than quietly outgrown.
- **Option B — ship the absence.** The Primes surface renders §4.3's unavailable copy on every
  reading region, shows the published π(x) oracle and the committed benchmark figures as
  `cited`, and states in plain words why no button exists. Honest, small, and consistent with the
  rule — but it leaves one of the two surfaces the roadmap calls load-bearing unable to run
  anything, and *descoped is not satisfied*.

This document specifies both so neither is blocked on it. What it will not do is specify a
Primes surface with a run control that produces refusals discovered as timeouts — that is the
same failure the bring-your-own form's required record exists to prevent, one workload over.

**A smaller open item, recorded rather than decided:** the footer links `./perf/`, and the
built bundle contains no `perf/` directory — `docs/perf/build-report.py` writes the HTML into
`docs/perf/`. Whether the Benchmarks surface links the committed HTML, inlines the figures only,
or the build gains a copy step, is a packaging question this contract leaves to the plan. The
contract's requirement is only that the surface's figures carry visible provenance and a link
that resolves wherever the page is served from.

---

## 11. Copywriting contract — the fixed strings

| Element | Copy |
|---|---|
| Primary CTA, Colouring | `Run the search` (existing `#run` label, unchanged) |
| Primary CTA, Primes | `Count the primes` (Option A only; absent under Option B) |
| Primary CTA, π | `Run the reduce` |
| Primary CTA, Bring-your-own | `Dispatch this module` |
| Primary CTA, Fabric state | none — the surface reads, it does not run |
| Secondary CTA | `Check this answer myself` (existing `#verify` label, unchanged) |
| Stop | `Stop` (the word the disclosure uses; it may not be softened to `Pause` or `End`) |
| View toggle | `Rendered and text` / `Text only` |
| Empty state, per figure | §4's `data-absence` column — one sentence, names the cause, contains no digit |
| Empty state, whole surface (no node) | `This tab's node is stopped. Start it from the panel at the top of the page to take a reading.` |
| Error state, a run that threw | `The run stopped: «the thrown message, verbatim».` — the fabric's words, never a paraphrase |
| Error state, a refused shard | `«nodeId»: «reason»` — from `TabJobReport.failures`, verbatim |
| Lone-tab reduce | §5.3, headline `This claim needs a second device.` |
| Egress, nothing withheld | §5.2, count and sentence inseparable |
| Destructive action | there is none. Stop ends a thread and closes connections; it destroys no data and asks for no confirmation, because a confirmation dialog in front of a promised stop control is a delay on a promise |
| Consent gate | every string comes from `TabApi.disclosure()` — headline, question/answer lines, the reporting question and answer, the affirm and decline labels. The page holds no copy of them, so the text a visitor reads, the version a stored consent answered, and the policy page cannot drift apart |

Tone rules, taken from the page's existing voice and from the roadmap's own language: state the
limit, never round it away; prefer the fabric's words to the page's; say *this claim needs a
second device*, never *failed*; say *ran out of steps*, never *no solution exists*.

---

## 12. Checker sign-off

**Pass run 2026-08-20** on the live page — real dev server, Chromium, consent pressed, computed
styles and composited contrast read off the DOM, widths on fresh loads. Full readings and their
attribution: [`27-CHECKER-2026-08-20.md`](./27-CHECKER-2026-08-20.md).

- [x] Dimension 1 Copywriting — §11, plus every `data-absence` in §4
      — **PASS.** Every fixed string verbatim; `Stop` unsoftened; Fabric state offers no primary
      control; **74 absences rendered, 0 containing a digit**.
- [x] Dimension 2 Visuals — §1, §6.4
      — **PASS.** 1240px column on all five `.wrap` holders; `.cards` auto-fit at gap 24px; nav
      `sticky`/`top: 0`, not fixed; table wrapped; `scrollWidth == clientWidth` at 360/390/768 and
      **321 vs 320 at 320px with zero uncontained elements** — inside B1's stated 1px tolerance,
      and `demo-viewport.e2e.test.ts` was re-run for this pass at EXIT 0 / 7 tests. **0 external
      network requests.**
- [x] Dimension 3 Colour — §1.5, §7.2 (measured ratios)
      — **PASS.** Every §1.2 property exact; `color-scheme: light`; **73 text runs measured, 0
      contrast failures**; `--color-accent` used as a text colour on **0** runs; §7.2's accent-700
      row corroborated at **5.78:1** against its stated 5.79.
- [ ] Dimension 4 Typography — §1.3
      — **DOES NOT PASS as written, and the divergence is specific rather than wholesale.** The
      Display and Heading sizes both exist and are correct (`h2` is the clamp, `h3` is 20px). What
      diverges: **`.card-title` overrides `h3` to 17px for the exact role Heading names**; `h1`
      (`clamp(22px, 3.2vw, 28px)`) and `h4`/`#gate dt` (17px) are two roles this table does not
      carry; and table headers render `11px/700`, a third weight. Mechanism: `body` is 15px and
      components size in `em` off it. **Owner decides: move the page to the four sizes, or amend
      this section to the em-relative scale that shipped and say why.**
- [ ] Dimension 5 Spacing — §1.4
      — **PARTIAL. The ramp is exactly right** — `4 / 8 / 12 / 16 / 24 / 32px` on the live page, so
      §1.2's re-base is in. **Nine values in use do not come from it**, five of them fractional
      (`14.4` · `9` · `4.55` · `4.2` · `1.3` · `1.2` · `6` · `10` · `2px`), because `.btn`,
      `.seg-opt`, `<code>` and the nav size padding in `em` and never consult the ramp. **`10px` is
      a borrowed exception** — §1.4 grants it to the bar by name, and the nav buttons take it
      anyway. **Owner decides: adopt the ramp in those components, or name them here as further
      exceptions the way the bar and the Stop control already are.**
- [x] Dimension 6 Registry safety — not applicable: no component registry, no third-party
      component source, no CDN. §1.1 constraint 3 is the equivalent obligation and §9's P10 is
      its check. **Corroborated by measurement rather than left as an assertion: 0 external
      network requests over a full load.**

**Approval:** pending — **and now pending on two named things rather than on nobody having looked.**
Four dimensions are signed off. Dimensions 4 and 5 are the same question asked twice: this contract
specifies a fixed-px scale and the page ships an em-relative one derived from a 15px body. Neither
is a rendering defect — every run passes contrast and no geometry assertion breaks — so this is a
contract-versus-implementation decision, and a checker does not get to take it.
