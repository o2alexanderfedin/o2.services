---
phase: 27-demo-ui-driven-by-real-fabric
plan: 3
subsystem: browser-demo
tags: [demo-01, demo-02, brow-01, ui-spec-3, ui-spec-4, ui-spec-9, anti-placeholder, catalogue, mutation-proof]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract and demo-viewport.e2e.test.ts)
    - 27-02 (the six-surface shell, nav.ts, demo.css — the page the catalogue is declared into)
  provides:
    - "packages/browser/src/demo-regions.ts — the complete 91-region catalogue as committed
      data, plus seven text-view and six prose entries, DIGIT, FIGURE_KINDS, UI_SPEC_TALLY
      and WIRED_SURFACES"
    - "packages/browser/demo/render.ts — regionElement / paintAbsence / writeReading /
      paintSurfaceAbsence / applyRender, textContent only, plus attestationLines and
      egressLines moved out of index.html body-and-comments identical"
    - "packages/node/src/demo-regions.e2e.test.ts — seven catalogue self-checks with no
      browser and ten properties against the live page: P1a, P1b, P2, P3, P4a, P4b, P6, P7, P8"
    - "the session header wired: H1-H5 declared and routed through the writer, setFacts gone,
      three fixed dd pairs painted from the catalogue instead of a list rebuilt per state"
    - "the measured refutation of UI-SPEC section 9's P3 as written: under one plant it exits
      0 with zero violations over four regions while the catalogue-sourced form exits 1 with
      four"
  affects:
    - Plans 27-04 to 27-09 (each appends one line to WIRED_SURFACES, which turns P1b on for
      all of that surface's regions at once — a surface cannot half-land)
    - Plan 27-04 (owns P5, the liveness property; P2, P3 and P4 are all satisfiable by a page
      that renders nothing and P5 is what stops them being vacuous)
    - Plan 27-09 (owns P9, and owns replacing the Benchmarks lede's plan identifier)
    - "UI-SPEC sections 3, 4.4, 4.6 and 9 (four corrections owed, logged in deferred-items.md)"
tech-stack:
  added: []
  patterns:
    - "the guard's expectation is the committed catalogue and never the element under test —
      a guard that reads its expectation off the thing it is checking cannot fail"
    - "WIRED_SURFACES as a greppable switch: one line per surface, appended by the plan that
      lands it, turning P1b on for that surface's regions all at once"
    - "permanentlyUnavailable INVERTS the source check, so a descoped surface is a positive
      checkable claim rather than a silence"
    - "P6, P7 and P8 quantified over a named field set and over region id suffix, never over
      a surface list, so surfaces that land later inherit them unwritten"
    - "a property that asserts its own precondition: P8 fails, naming the hook it needs, if an
      attestation region is populated and no page-side reading is published"
    - "the writer throws on a missing region element rather than skipping it, so a region that
      would silently never render halts the page and names itself in page.on('pageerror')"
key-files:
  created:
    - packages/browser/src/demo-regions.ts
    - packages/browser/demo/render.ts
    - packages/node/src/demo-regions.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "P3 compares the element against the CATALOGUE, not against its own data-absence, and the
    reason is a measurement rather than an argument. Under one plant — `sentenceFor` returning
    .replace('node is stopped', 'node is off') — UI-SPEC's formulation examined four regions
    and reported zero violations at exit 0, because paintAbsence writes textContent and
    data-absence in the same call. The catalogue-sourced form reported four, at exit 1."
  - "`control-status` is not a kind. UI-SPEC's H1 and B3 rows name it and its own closing
    tally counts 74 reading + 6 constant + 3 cited + 8 control = 91, which only adds up if
    those two are `control`. Adopted, and the measured breakdown then agrees with UI-SPEC
    exactly on every one of the twelve numbers."
  - "Stopped wins. When activity() === null every reading paints its stopped sentence,
    including the readings that are safe with no node. The alternative would make P3's
    expectation depend on which readings happen to be safe, so P3 would have to accept two
    sentences per region — and a property that accepts two answers is most of the way to
    accepting any. Cost: session/relay's unavailable arm becomes unreachable, logged."
  - "P4's inverted arm is quantified over the CATALOGUE rather than over elements on the page.
    No Primes region is drawn yet, so an element-scoped check would have been vacuous and the
    required plant would not have reddened. Over the catalogue it names all eight."
  - "pi's shard-partials absence is NOT in REGIONS. UI-SPEC section 4.4 gives it copy in prose,
    no row in its table, and no place in its tally; adding it would make the surface 15 and the
    catalogue 92 against a count UI-SPEC states about itself. The pattern stays under guard
    through primes/per-shard (N9), which does have a row. Reported, not reconciled."
  - "P12 (pi/against-published) is `reading`, not `cited`. UI-SPEC's row says 'reading +
    cited', which is not one of the four kinds; counting it as cited would give 4 cited and 73
    reading against the stated 3 and 74."
  - "Option B for Primes, as UI-SPEC section 10 and this phase's plan set decide: N3-N9 and N11
    carry permanentlyUnavailable, name TabApi.runPrimes(), and render section 4.3's unavailable
    copy in all three arms. TabApi.runPrimes was NOT added — Option A touches the trust root."
  - "The seven text views were declared in this plan although only `session` is wired. They are
    elements that already exist and already render exactly what the catalogue says they do, and
    P6 needs to be able to find a surface's text view the day that surface lands. The bar's
    three regions were deliberately NOT declared: they read activity() but are not routed
    through the writer, and declaring without wiring is the half-landing WIRED_SURFACES exists
    to prevent."
metrics:
  duration: ~80 minutes
  tasks: 3
  files-created: 3
  files-modified: 2
  commits: 3
  completed: 2026-08-10
---

# Phase 27 Plan 3: The catalogue, the writer, and the guard — before the screens Summary

The complete 91-region catalogue is committed data, the session header is the first surface
wired through the writer, and the anti-placeholder guard landed **before** the screens it will
hold. The sharpest result is not any of the three: it is that **UI-SPEC's own formulation of
P3 was measured passing under a plant the catalogue-sourced form caught.**

## The catalogue's counts, against UI-SPEC's tally

UI-SPEC section 4 states its own numbers and this is the measurement of them. **They agree
exactly — all twelve.** Nothing was reconciled, because nothing disagreed.

| surface | UI-SPEC states | measured |
|---|---|---|
| session header | 5 | 5 |
| bar | 3 | 3 |
| colouring | 21 | 21 |
| primes | 12 | 12 |
| pi | 14 | 14 |
| bring-your-own | 13 | 13 |
| fabric state | 21 | 21 |
| Benchmarks | 2 | 2 |
| **total** | **91** | **91** |

| kind | UI-SPEC states | measured |
|---|---|---|
| `reading` | 74 | 74 |
| `constant` | 6 | 6 |
| `cited` | 3 | 3 |
| `control` | 8 | 8 |

Read with `node --experimental-strip-types` over the parsed catalogue, and asserted in the
guard against `UI_SPEC_TALLY`, which holds UI-SPEC's claim as data so a future transcription
error reddens rather than being argued about.

Plus **10 additive entries outside the 91** — 7 `text-view`, 6 `prose`… which is 13, and the
arithmetic is the point: three of the prose entries were added *after* P2 measured the page.
**104 entries total.** 174 absence sentences, every one digit-free under `DIGIT` and every one
ending in a full stop, verified by a script over the parsed catalogue rather than by reading.

**Two counts UI-SPEC states that this catalogue does not meet, both reported rather than
reconciled**, and neither is a transcription error:

- **`control-status` is not a kind.** UI-SPEC's H1 and B3 rows name it. It is not one of the
  four its closing tally counts, and with it the 8-control figure does not add up. H1 and B3
  are `control`.
- **pi's shard-partials absence has copy, no row, and no place in the tally.** Section 4.4's
  prose names the sentence; the table is P1..P14 and the tally says 14. It is **not** in
  `REGIONS`. Logged.

## What is live, and what is generic-and-waiting

`WIRED_SURFACES` is `['session']`. One line, appended by the plan that lands each surface.

| property | state today | what makes it live |
|---|---|---|
| catalogue self-checks (7 cases) | **live**, no browser | always |
| P1a — every `[data-region]` is in the catalogue | **live** over 21 elements on the page | always |
| P1b — every catalogue entry of a wired surface resolves to one element | **live** over the 5 session regions | one line in `WIRED_SURFACES` per surface |
| P2 — no undeclared digit inside `#main` | **live**; found 7 offenders, all now declared | always |
| P3 — every reading reads the catalogue's stopped sentence | **live** over the 4 session readings | grows with `WIRED_SURFACES` |
| P4a — an ordinary reading names a method `window.o2` has | **live** over the 4 session readings | grows with `WIRED_SURFACES` |
| P4b — a permanently-unavailable reading names one it does NOT | **live over all 8 catalogue entries today** — quantified over the catalogue, not the DOM | already live |
| P6 — a populated figure occurs in its surface's text view | **generic, conditional on population** — vacuous today | the first surface that populates `best.n`, `verificationMultiplier`, `estimate` or `egress.totalBytes` |
| P7 — a withheld count never appears without its sentence | **generic, conditional on population** — vacuous today | the first populated `/egress` or `*-withheld` region |
| P8 — an attestation region carries the fabric's own words | **generic, and asserts its own precondition** — vacuous today | the first populated `/attestation` region, which must also publish `window.__o2LastAttestation` or P8 reddens naming it |
| P5 — liveness | **not here.** Plan 27-04 | — |
| P9 — Benchmarks figures verbatim in the committed document | **not here.** Plan 27-09 | — |

P6, P7 and P8 name no surface in their bodies — verified by grep over each case with comments
stripped. They quantify over a field set (`n`, `verificationMultiplier`, `estimate`,
`totalBytes`) and over id suffix (`/egress`, `-withheld`, `/attestation`), so pi,
bring-your-own and fabric-state inherit them with no edit to that file.

**P5's absence is the honest caveat on all of the above: P2, P3 and P4 are every one of them
satisfiable by a page that renders nothing.** The guard's header says so at the top.

## The planted mutations

Six arms. Each snapshotted to the session scratchpad immediately before the edit, restored by
**the surgical inverse of that edit** — never `cp`, never `git stash`, never `git checkout --`
— and verified with `cmp` against that snapshot, `EXIT=$?` on the line immediately after.
**Every `cmp` returned exit 0**, and `git status --porcelain` was empty before each plant and
after the last restore.

### Plant 1 — a mockup literal pasted into a panel: **P2 red, P1a green**

One added line, `<p class="note">41 cubes agreed · peer-4a91 · 785398163231095</p>`, in
`#s-colouring`. Exit **1**:

```
FAIL  |e2e| … > P2 — no undeclared digit is on screen inside #main
AssertionError: a number on screen with no data-region ancestor: it is neither a reading, nor a constant, nor a citation, nor declared prose: expected [ Array(1) ] to deeply equal []
+   "digit at char 0: …41 cubes agreed · peer-4a91 · 7853981632…  in  <p class=\"note\">41 cubes agreed · peer-4a91 · 785398163231095</p>",
```

`Tests 1 failed | 16 passed (17)`. **UI-SPEC section 9 files this plant under P1, and P1a
stayed green.** That is a reading of P1a rather than an observation that it was not reached:
P1a constrains elements that *carry* `data-region`, and a pasted literal carries none. **P2 is
the load-bearing property for this failure and P1 is not**, which is worth knowing before
somebody decides P2 duplicates P1.

### Plant 2 — a zero in place of an absence sentence: **P3 red, both clauses**

`writeReading('session/peers-sentence', '0')` after the initial paint. Exit **1**:

```
FAIL  |e2e| … > P3 — every reading region reads the catalogue's sentence for this state, digit-free
+   "session/peers-sentence: on screen \"0\" — the catalogue says \"Not counted: this tab's node is stopped.\"",
+   "session/peers-sentence: a reading region with no reading carries a digit — \"0\"",
```

P2 was **green** in that run: the zero sits inside a declared region, so no ancestor is
missing. Which is the argument for P3 existing beside P2.

### Plant 2b — the P3 non-vacuity demonstration, and the reason it was needed

Plant 2 does not distinguish the two formulations of P3: `writeReading` leaves `data-absence`
alone, so UI-SPEC's comparison would have reddened too. So a second plant was run whose whole
purpose is to separate them — `sentenceFor` returning
`.replace('node is stopped', 'node is off')`, one line in `render.ts`. `paintAbsence` writes
`textContent` and `data-absence` from that one return value, so the two agree perfectly and
disagree with the catalogue.

Both formulations, read against the same planted page in the same state:

| formulation | regions examined | violations | exit |
|---|---|---|---|
| UI-SPEC section 9's, `text === data-absence` | 4 | **0** | **0** |
| this guard's, `text === REGIONS[id].absence.stopped` | 4 | **4** | **1** |

UI-SPEC's arm was measured with a throwaway probe under `tmp/` (gitignored, deleted after the
reading), driving the same vite server and the same consent path:

```
UI-SPEC P3 as written — regions examined: 4
UI-SPEC P3 as written — violations: 0
  session/peer-id: text="No peer id: this tab's node is off." data-absence="No peer id: this tab's node is off."
  session/relay: text="No relay: this tab's node is off." data-absence="No relay: this tab's node is off."
  session/webrtc-addr: text="No address: this tab's node is off." data-absence="No address: this tab's node is off."
  session/peers-sentence: text="Not counted: this tab's node is off." data-absence="Not counted: this tab's node is off."
```

and the guard's, verbatim:

```
FAIL  |e2e| … > P3 — every reading region reads the catalogue's sentence for this state, digit-free
+   "session/peer-id: on screen \"No peer id: this tab's node is off.\" — the catalogue says \"No peer id: this tab's node is stopped.\"",
+   "session/relay: on screen \"No relay: this tab's node is off.\" — the catalogue says \"No relay: this tab's node is stopped.\"",
+   "session/webrtc-addr: on screen \"No address: this tab's node is off.\" — the catalogue says \"No address: this tab's node is stopped.\"",
+   "session/peers-sentence: on screen \"Not counted: this tab's node is off.\" — the catalogue says \"Not counted: this tab's node is stopped.\"",
```

`grep -v '^ *[/*]' packages/node/src/demo-regions.e2e.test.ts | grep -c "getAttribute('data-absence')"`
returns **0**.

### Plant 3a — an ordinary region pointed at a method that does not exist: **P4a red**

`session/peer-id`'s `data-source` changed from `TabApi.autoStart().peerId` to
`TabApi.runPrimes().peerId`. Exit **1**:

```
FAIL  |e2e| … > P4a — every ordinary reading names a method window.o2 actually has
+   "session/peer-id: data-source names TabApi.runPrimes(), and window.o2 has no such method — this region would have been discovered as a timeout inside page.evaluate",
```

### Plant 3b — the inverted arm: a stub `runPrimes` on `window.o2`: **P4b red, all eight**

`window.o2.runPrimes = async () => ({ total: 0 })` after the page installs the contract. Exit
**1**, eight failures:

```
FAIL  |e2e| … > P4b — every permanently-unavailable reading names a method window.o2 does NOT have
+   "primes/total names TabApi.runPrimes(): the dispatch path this surface was told it does not have now exists — the surface must be replanned",
+   "primes/complete names TabApi.runPrimes(): … must be replanned",
+   "primes/reduce-state names TabApi.runPrimes(): … must be replanned",
+   "primes/elapsed names TabApi.runPrimes(): … must be replanned",
+   "primes/attestation names TabApi.runPrimes(): … must be replanned",
+   "primes/egress names TabApi.runPrimes(): … must be replanned",
+   "primes/per-shard names TabApi.runPrimes(): … must be replanned",
+   "primes/oracle-compare names TabApi.runPrimes(): … must be replanned",
```

**Both arms matter and the second is the Primes disposition's teeth.** `runPrimes` is exactly
the method Option A would add. Together the two arms are the mechanical statement that it does
not exist *and* that its arrival would be noticed — a descoped surface as a positive claim
rather than a silence. It reddens over the catalogue whether or not anybody has drawn the
surface, which is why the arm is quantified over `REGIONS` and not over the DOM; scoped to
elements it would have been vacuous today and this plant would have produced nothing.

### Plant 4 — a deleted region element: **two arms, and only the second proves P1b**

**Arm A, the plan's own instruction — delete the H4 `<dd>` from the session header.** Exit
**1**, and the failure is *not* P1b:

```
[page error] demo-regions: no element carries data-region="session/webrtc-addr"
 > regionElement packages/browser/demo/render.ts:83:33
 > paintAbsence packages/browser/demo/render.ts:122:18
 > paintSurfaceAbsence packages/browser/demo/render.ts:149:4
FAIL  |e2e| … > the page, with the fabric stopped
TimeoutError: page.click: Timeout 30000ms exceeded. … waiting for locator('#allow') … element is not visible
```

`17 tests | 9 skipped`. The writer's throw halted the module script before the gate rendered,
so the suite failed in `beforeAll` and **P1b was never evaluated**. The plant reddens the file
and names the exact region, and that is a stronger guard than P1b — but it is not P1b, and
reporting it as P1b red would have been false.

**Arm B — remove `data-region="session/state"` from H1**, a `control` the writer never paints,
so the page loads normally and P1b is the property under test. Exit **1**:

```
FAIL  |e2e| … > P1b — every catalogue entry of a wired surface resolves to exactly one element
+   "session/state (control) resolves to 0 element(s); a wired surface's region is exactly one",
```

`Tests 1 failed | 16 passed (17)`. **P1b is proved by arm B and only by arm B.**

## The defect this plan found in its own guard

**P2's first draft reported the page clean over `N = 7824`.** The in-page collector pushed
`raw.slice(0, 160)` and the `DIGIT` filter then ran over the truncation; the colouring card's
second paragraph carries its first digit at **character 272**. The first run reported 6
offenders; with the truncation moved out of the measurement and into the failure message, the
same page reported **7**.

That is worth stating plainly: a guard landed to catch numbers was, in its first form, blind to
any number past the 160th character of a text node — and the tree already contained one.
Fixed under Rule 1, and the message now prints the character offset and forty characters either
side, because a guard whose message does not say *which* number costs more to act on than it
saves.

## What P2 found, and what reading the markup had missed

All seven, on the live page with the fabric stopped:

| offender | element | declared as |
|---|---|---|
| `Circuit Relay v2` | `<strong>` inside `#explain` | `session/prose-explain` |
| `o2 seed` | `<code>` inside `#explain` | same element |
| `Workload A · Pythagorean-triple 2-colouring` | the colouring kicker | `colouring/prose-kicker` |
| `1 to N`, `a² + b² = c²` | the colouring problem paragraph | `colouring/prose-problem` |
| `N = 7824`, `7825`, `200-terabyte` at char 272 | the colouring bound paragraph | `colouring/prose-bound` |
| `AArch64` | the bring-your-own card title | `byo/prose-lift-target` |
| `Plan 27-09` at char 158 | the Benchmarks lede | `bench/prose-provenance` |

**Reading the markup found four of these. P2 found seven.** The three the reading missed are
the instructive ones: a `2` inside the word *2-colouring* in a kicker, a `v2` inside a protocol
name, and a plan identifier in prose. None of them is a placeholder and all of them are
legitimate — which is exactly why the rule is *declare it*, not *remove it*. Without the
`prose` kind, *wrap it in a paragraph* is the loophole that makes the whole property
unenforceable.

## The session header, wired

- `#state` (H1, `control`), the three `#facts` `dd`s (H2/H3/H4) and `#peers` (H5) carry
  `data-region`, `data-kind` and `data-source`. **None carries absence text in the markup**:
  the sentences live in the catalogue and the writer paints both the text and the
  `data-absence` mirror from there, so no sentence is written in two places.
- `#facts` is three fixed pairs rather than a list rebuilt per state. `setFacts` is gone.
- **On stop the header paints its stopped sentences instead of emptying.** `setFacts([])`
  used to leave three empty `dd`s, and an empty `dd` is exactly the blank a named absence
  replaces.
- `(none yet)` — a blank wearing a parenthesis — became H4's own unavailable arm.
- `#peers` keeps its sentence **verbatim**, wording and all; `attestation-ui.e2e.test.ts`
  still reads `1 node(s) computing` and `2 node(s) computing` out of it. Its catch branch now
  paints the thrown message as the region's named reason rather than leaving a stale count.
- The join-failure branch paints H2 and H4 back to their stopped sentences.

## `innerHTML`, before and after

| file | before this plan | after |
|---|---|---|
| `packages/browser/demo/index.html` | **1** | **1** — `#explain`'s existing static, page-authored string, the one permitted assignment |
| `packages/browser/demo/render.ts` | — | **0** |

Counted with `grep -v '^ *[/*]' <file> | grep -c 'innerHTML'`. Every fabric-supplied string —
`attestation.description`, `attestation.reason`, `reduceReason`, `failures[].reason` — reaches
the DOM through `textContent`. The writer's header says why the mistake is tempting: the
contract's word is *verbatim*, and verbatim into `textContent` is a quotation while verbatim
into `innerHTML` is an injection.

## `attestationLines` and `egressLines`, moved

Extracted as spans and `diff`ed after de-indenting the HTML copy by six spaces. **Three lines
differ and all three are signatures**; every comment line and every body line is byte-identical:

```
-const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
+const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
-const attestationLines = (attestation) =>
+export const attestationLines = (attestation: ShardAttestation): string[] =>
-const egressLines = (egress) => {
+export const egressLines = (egress: EgressManifest | null | undefined): string[] => {
```

`plural` moved with them: both call it and nothing else in `index.html` did.

## Exit codes, read directly

Every one with `EXIT=$?` on the line immediately after the command, output redirected to a
file and the file read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `npx tsc --noEmit` after Task 1 | **0** |
| catalogue readout via `node --experimental-strip-types` | 91 figures, breakdowns as tabled |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e` attestation-ui + colouring-demo + built-bundle | **0** — `Tests 18 passed (18)` |
| the guard, first run | **1** — P2, 6 offenders |
| the guard, after P2's truncation defect was fixed | **1** — P2, **7** offenders |
| the guard, after the six prose declarations | **0** — `Tests 17 passed (17)` |
| Plant 1 | **1** — P2 red, P1a green |
| `cmp` after restore | **0** |
| Plant 2 | **1** — P3 red, both clauses |
| `cmp` after restore | **0** |
| Plant 2b, the guard | **1** — P3 red, four regions |
| Plant 2b, UI-SPEC's P3 probe | **0** — four regions examined, zero violations |
| `cmp` after restore | **0** |
| Plant 3a | **1** — P4a red |
| `cmp` after restore | **0** |
| Plant 3b | **1** — P4b red, eight regions |
| `cmp` after restore | **0** |
| Plant 4 arm A | **1** — writer threw in `beforeAll`; P1b not evaluated |
| `cmp` after restore | **0** |
| Plant 4 arm B | **1** — P1b red |
| `cmp` after restore | **0** |
| `git status --porcelain` after the last restore | **empty** |
| `vitest run --project e2e` × 5 files (final) | **0** — `Test Files 5 passed (5)`, `Tests 42 passed (42)` |
| `vitest run --project node vocabulary.node.test.ts` | **0** — `Tests 25 passed (25)` |
| `npx tsc --noEmit` (final) | **0** |
| `grep -c 'demo-regions' packages/browser/src/index.ts` | **0 matches** |
| `grep -v '^ *[/*]' demo-regions.e2e.test.ts \| grep -c "getAttribute('data-absence')"` | **0 matches** |
| surface names in P6/P7/P8 bodies, comments stripped | **none** |

`demo-viewport.e2e.test.ts` is in the final set: its 60 combinations still pass, so this plan
did not re-break the bar.

## Deviations from Plan

### `[Rule 1 - bug] P2 truncated the text before testing it`

- **Found during:** Task 3, reading the first offender list against the markup and noticing
  `N = 7824` was not in it.
- **Issue:** the in-page collector pushed `raw.slice(0, 160)` and the `DIGIT` filter ran over
  the truncation. Any digit past character 160 of a text node was invisible, and the tree
  already contained one at character 272.
- **Fix:** the whole text node is returned and tested; truncation happens only when composing
  the failure message, which now names the character offset and the surrounding forty
  characters either side.
- **Files:** `packages/node/src/demo-regions.e2e.test.ts`
- **Commit:** `ed1c992`

### `[deviation - method] Plant 4 needed a second arm, and only the second proves P1b`

The plan says *delete one session-header region element; expect P1b red*. Deleting the H4
`<dd>` makes `paintSurfaceAbsence` throw at page load, which halts the module script before
the gate renders; the suite then fails in `beforeAll` on a `#allow` timeout and P1b is never
evaluated. Both arms are recorded above. Arm B removes `data-region` from `#state`, a
`control` the writer does not paint, so the page loads and P1b is the property that reddens.

### `[deviation - method] Plant 2 needed a second arm to demonstrate P3's non-vacuity`

Plant 2 (`0` in place of a sentence) reddens both formulations of P3, so it does not
demonstrate that the catalogue-sourced form is stronger. Plant 2b does, and it is measured on
both sides rather than reasoned about.

### `[deviation - scope] pi's shard-partials row is not in the catalogue`

The plan's Task 1 names *"`primes/per-shard` (N9) and π's shard-partials row"* as two entries
carrying `permanentlyUnavailable`. UI-SPEC section 4.4 gives the shard-partials absence copy
in prose, no row in its table, and no place in its tally of 14. Including it would make the
catalogue 92 against Task 1's own acceptance criterion that the count prints 91 and the
per-surface breakdown matches. UI-SPEC's tally wins; the omission is documented at the pi
surface in the catalogue and logged in `deferred-items.md`. N9 keeps the pattern under guard.

### `[deviation - scope] Three absence sentences were composed, not transcribed`

UI-SPEC section 4.6's F17 (both arms), F18 (stopped) and F19 (stopped) describe a state rather
than quoting a sentence, and every reading needs one to paint. Three were composed, each
marked `COMPOSED` at its catalogue entry, and logged. Everything else in section 4 is
transcribed.

### `[deviation - scope] Two diagnostic pairs dropped from the session header`

`relay source` and `secure context` are not among UI-SPEC section 4.0's five regions and no
spec reads `#facts`. Both are gone rather than left undeclared beside three declared readings.
Logged.

### `[deviation - method] No relay in the guard's harness`

The plan says the browser leg stands up *"vite dev server, relay, one Playwright context"*.
No `FabricNode` relay is started: the leg deliberately does not start a node, nothing dials a
relay, and `/bootstrap.json` 404s on a plain dev server exactly as it does on a static host —
which is the `source: 'none'`, `activity() === null` state every property is about. A relay
nothing dials would be seconds of setup buying no coverage. Said in the file's `beforeAll`.

### `[deviation - addition] P8 names a page-side hook this plan does not create`

P8 compares a rendered attestation against a fresh reading, and there is no `TabApi` accessor
for *the last run's receipt* — a run returns it once. So P8 asserts its own precondition: a
populated attestation region with no `window.__o2LastAttestation` reddens, naming the hook.
It is vacuous today and it is a forcing function on whichever plan populates the first
attestation region, in the same shape as `WIRED_SURFACES`.

### `[deviation - scope] The bar's three regions were not declared`

They read `activity()` and are the one other place readings already exist, but they are not
routed through the writer. Declaring an element without wiring it is the half-landing
`WIRED_SURFACES` exists to prevent, so `bar` stays out of both.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-08 | **mitigate — met** | `render.ts` writes with `textContent` only; the grep gate over the render path returns 0, and `index.html`'s count is unchanged at 1 (`#explain`'s page-authored static string). The writer's header states why *verbatim* makes the mistake tempting. |
| T-27-09 | **mitigate — met** | P2 requires every digit-bearing text node in `#main` to have a declared ancestor — watched red on a pasted `41 · peer-4a91 · 785398163231095`, and it found seven real offenders on the unmodified page. P3 requires every reading to equal the catalogue's stopped sentence and to be digit-free — watched red on `0`, both clauses firing. |
| T-27-10 | **mitigate — met, and the disposition is the finding** | The guard's expectations come from the committed catalogue. UI-SPEC's own P3 was **measured** passing at exit 0 with zero violations under a plant the catalogue-sourced form caught at exit 1 with four. Six plant arms watched red in total. |
| T-27-11 | **mitigate — met** | P4a resolves every `data-source` against `Object.keys(window.o2)` in the live page — watched red naming `TabApi.runPrimes()`. P4b inverts it over the catalogue — watched red on all eight Primes entries when a stub `runPrimes` was added. A Node-side arm checks the same two claims against the parsed `TabApi` interface with no browser. |

## Known Stubs

None introduced. The four text-view stubs 27-02 recorded (`#primes-report`, `#pi-report`,
`#byo-report`, `#fabric-report`) are unchanged and now **declared** — each carries its
`data-region`, so a guard can find it and P6 can render through it the day its surface lands.
Their literals are unchanged and still contain no digit.

`#report`'s initial literal is still exactly `not asked yet` — lowercase, no full stop. It was
not "corrected" to UI-SPEC's `Not asked yet.`, and the catalogue entry for it says why:
`peer-ledger.e2e.test.ts` and `two-tabs.e2e.test.ts` both wait on
`textContent !== 'not asked yet'`. UI-SPEC's sentence is F18's, which is a different region on
a different element.

## What is NOT done

- **P5 is not here**, and it is the property that stops the others being vacuous. Plan 27-04.
- **P9 is not here.** Plan 27-09.
- **86 of the 91 regions have no element yet.** That is this plan's scope boundary and the
  whole point of the ordering: the catalogue is committed *before* the screens, so it cannot
  be written to fit them. `WIRED_SURFACES` is the switch each surface's plan flips.
- **`session/relay`'s unavailable arm is unreachable** under the stopped-wins rule and in fact.
  Logged rather than deleted.
- **B5 is still partly vacuous** — 27-02's finding, unchanged and not this plan's to fix.
- **UI-SPEC is not edited.** Four further corrections are owed and logged: section 3's
  catalogue path, section 4.4's shard-partials row, section 4.6's three describing cells, and
  section 9's P3.
- **Only Chromium.** The `e2e` project launches `chromium` alone.

## Commits

| hash | what |
|---|---|
| `5687808` | `feat(27-03)` — the 91-region catalogue, before any screen exists |
| `6103fe0` | `feat(27-03)` — the region writer, and the session header wired through it |
| `ed1c992` | `test(27-03)` — the guard, P2's truncation defect fixed, six prose regions declared |

Each committed with `git commit -m "…" -- <explicit paths>` and each verified with
`git show --stat` to contain only this plan's files.

## Self-Check: PASSED

- `packages/browser/src/demo-regions.ts` — FOUND
- `packages/browser/demo/render.ts` — FOUND
- `packages/node/src/demo-regions.e2e.test.ts` — FOUND
- `packages/browser/demo/index.html` — FOUND, modified
- `.planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md` — FOUND, modified
- commit `5687808` — FOUND
- commit `6103fe0` — FOUND
- commit `ed1c992` — FOUND
- `git status --porcelain` after every plant restore — empty, and every `cmp` exit 0
