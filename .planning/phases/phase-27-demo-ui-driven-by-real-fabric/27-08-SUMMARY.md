---
phase: 27-demo-ui-driven-by-real-fabric
plan: 8
subsystem: browser-demo
tags: [brow-02, brow-03, brow-05, sched-04, net-05, demo-01, ver-09, ver-10, data-05, data-06, ui-spec-4-6, mutation-proof, p8-per-surface-hook]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract, and B1 — which caught this surface's first draft)
    - 27-02 (the six-surface shell, and the move of #report/#refresh-report onto this panel)
    - 27-03 (the 91-region catalogue, demo/render.ts's writer, and the stopped-wins rule)
    - 27-04 (surfaces/colouring.ts's shape, and demo-region-properties.ts's P6/P7/P8)
    - 27-05 (P5's navigation fix)
    - 27-06 (the greppable WIRED_SURFACES convention)
    - 27-07 (the per-surface attestation-hook defect, logged there and fixed here)
  provides:
    - "packages/browser/demo/surfaces/fabric.ts — the cross-cutting formatter: nine calls,
      the last run's receipt and manifest, and a readings record whose entries may be Error"
    - "the fabric-state panel: eight cards, all twenty-one regions, the duty-cycle slider,
      and NO primary run control"
    - "the per-surface P8 hook — 27-07's logged fix, applied with no edit to either harness"
    - "WIRED_SURFACES gains 'fabric' — the sixth and last reading surface"
    - "packages/node/src/demo-fabric.e2e.test.ts — seventeen cases: eight with no browser,
      nine on a real page with no node and with two tabs"
  affects:
    - "Plan 27-09 (Benchmarks) — the last surface, and the only one left out of WIRED_SURFACES"
    - "Plan 27-10 — carries six new deferred items, including the egress sentence with its
      fix now written out as one change across four contracts"
tech-stack:
  added: []
  patterns:
    - "a formatter over a RECORD of readings, each entry a value or the Error it threw, so the
      try/catch is per reading at the call site and the thrown-message arm is a function call
      rather than a state somebody has to arrange"
    - "a live surface asserted by CONVERGENCE — the screen agrees with a fresh reading taken in
      the same page, within a bound, with the whole comparison inside one page.evaluate so a
      repaint cannot slip between the two halves"
    - "a throwing reading reached by replacing one method on window.o2, with the source plant
      that proves the arm can fail recorded separately"
    - "a reading the page deliberately does NOT take, so the sentence saying it has not stays true"
key-files:
  created:
    - packages/browser/demo/surfaces/fabric.ts
    - packages/node/src/demo-fabric.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/src/demo-regions.ts
    - packages/node/src/demo-region-properties.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "**Stopped wins for F17, against the plan's own behaviour bullet.** UI-SPEC's F17 cells say
    the isolation booleans are always readable; render.ts's stopped-wins rule names `isolation`
    explicitly and P3 enforces it on a page with no node. Rendering the booleans there turns a
    committed guard red — measured under a plant, exit 1 in two specs. So the catalogue sentence
    is on screen while stopped, AND the page does not call isolation() while stopped, because
    that sentence says it has not."
  - "connectDiscoveredPeers, computePeers and startReport are read from what the page already
    did rather than issued by the render pass. One DIALS, one sends an RPC to every peer, and
    one PUBLISHES this tab's outcome to every peer. A surface that polled any of them would be
    a cause of what it displays."
  - "The per-surface P8 hook was applied rather than inherited. This surface is the third
    attestation region on the page and would have made 27-07's luck into a real comparison of
    one surface's receipt against another's."
  - "egressLines was NOT forked, again. Its sovereign-data sentence is unreliable and now has a
    fifth renderer; the fix crosses four contracts including a new field on EgressManifest in
    @o2/net, which is a Rule 4 boundary. Deferred to 27-10 with the change written out, and the
    limit stated in the card's own prose beside the reading."
  - "The duty-cycle slider's minimum is above zero, so the control cannot offer a position the
    fabric refuses. The RangeError arm is still asserted on a real page, by giving the slider a
    value below its own minimum and dispatching a real change event."
metrics:
  duration: ~110 minutes
  tasks: 3
  files-created: 2
  files-modified: 4
  commits: 5
  completed: 2026-08-10
---

# Phase 27 Plan 8: Fabric state Summary

**All twenty-one fabric-state regions render, and the surface with no workload of its own is
the one where "a reading that throws renders its own message" had to be built rather than
described.** Nine different calls, eight of which throw `node not started`, each caught on its
own — proved by a plant that removed exactly one of those catches and froze the whole surface,
with **193 unhandled page errors** and three cases red.

The two results worth reading past the region count are both about what a guard does *not*
see. **The fabric surface is invisible to P5, P6, P7 and P8 in `demo-liveness.e2e.test.ts`** —
measured, not inferred — because that property collects only the panels it drove and this
surface has no run control for it to drive. And **UI-SPEC's F17 row, taken literally, fails
P3**: the two were tested against each other under a plant rather than reconciled on paper.

## Which of F1–F21 render live readings, and which are named absences

Not derived. `demo-fabric.e2e.test.ts` prints every region verbatim on every run; this is the
two-tab read, before any workload had been dispatched. `⏎` is a newline inside a region.

| # | region | on screen |
|---|---|---|
| F1 | `fabric/peers-all` | **reading** — `2 connections` |
| F2 | `fabric/compute-peers` | **reading** — `2 peers` |
| F3 | `fabric/held-peers` | **reading** — `2 peers` |
| F4 | `fabric/peer-rows` | **reading** — `12D3KooWHeVowt31… — can carry a job ⏎ 12D3KooWJcJBj2zc… — can carry a job` |
| F5 | `fabric/relayed-only` | *named absence* — `Every peer this tab holds can carry a job.` (the `unavailable` arm, and a positive statement) |
| F6 | `fabric/attestation-strength` | *named absence* — `Not established: no job has been run in this tab.` |
| F7 | `fabric/attestation-description` | *named absence* — as F6 |
| F8 | `fabric/attestation-counts` | *named absence* — as F6 |
| F9 | `fabric/egress-frames` | *named absence* — `Nothing measured: no job has been run in this tab.` |
| F10 | `fabric/egress-bytes` | *named absence* — as F9 |
| F11 | `fabric/egress-withheld` | *named absence* — as F9 |
| F12 | `fabric/duty-user` | **reading** — `1.00` |
| F13 | `fabric/slots` | **reading** — `64 slots` |
| F14 | `fabric/governor-hidden` | **reading** — `no` |
| F15 | `fabric/governor-duty` | **reading** — `1.00` |
| F16 | `fabric/governor-transitions` | **reading** — `0 transitions · 0 ms slept` |
| F17 | `fabric/isolation` | **reading** — `cross-origin isolated: no · SharedArrayBuffer: no · in an iframe: no` |
| F18 | `fabric/start-reached` | **reading** — `1 of 1 peer asked answered` |
| F19 | `fabric/start-tallies` | **reading** — `other: 1 attempt, 0 failed — too few reports for a rate` |
| F20 | `fabric/blocks` | **reading** — `0 blocks held · 0 pulled · 0 refused for a CID mismatch` |
| F21 | `fabric/addresses` | **reading** — the peer id and three addresses (see below) |

**Fourteen live readings and seven named absences at that moment; six of the seven are the
"no job has been run in this tab" family and they populate as soon as one is.** Read off the
same panel after pressing the colouring surface's own run control:

| # | after a colouring run |
|---|---|
| F6 | `holds-no-verified-attestation` |
| F7 | `no agreeing replica produced a signed statement this requestor could check — 12D3KooWHRm…: this requestor holds no certificate for it; 12D3KooWM2B…: this requestor holds no certificate for it` |
| F8 | `How strongly was it checked: nothing established. 2 replicas agreed on the least-attested cube, and 0 of those produced a signed statement this tab could check.` |
| F9 | `34 frames` |
| F10 | `31598 byte(s)` |
| F11 | `What left this device: ⏎ 34 frames sent, 31598 byte(s) total. ⏎ 0 withheld — and this run registered no sovereign data, …` |

So **twenty of twenty-one carry a live reading once a run has happened**, and the twenty-first
— F5 — carries UI-SPEC's own `unavailable` sentence, which is the correct reading for a fabric
where every peer can work. With **no node**, all twenty-one carry the catalogue's stopped
sentence, asserted region by region and each checked digit-free.

**F21 renders one address twice**, and that is the node's own reading rather than a formatting
fault — `addresses().webrtc` reports the same multiaddr twice. Not de-duplicated: the node
really does advertise it twice, and a page that collapsed the list would be editing a reading
to look tidier than the fabric is. Logged.

## The P5b exempt-set count after this wave: **still twenty-four**, and that number is now the wrong one to watch

Measured against an **unedited** `demo-liveness.e2e.test.ts`, same run shape, before and after:

| | before 27-08 | after 27-08 |
|---|---|---|
| `[P5] wired surfaces` | `session, colouring, pi, primes, byo` | `session, colouring, pi, primes, byo, fabric` |
| `[P5] exercised` | `colouring, pi, byo` | `colouring, pi, byo` |
| `[P5] skipped` | `session, primes` | **`session, primes, fabric`** |
| `[P5] N of M` | `37 of 39` | `37 of 39` |
| `[P6] examined` | 5 | 5 |
| `[P7] examined` | 3 | 3 |
| `[P8] examined` | 2 | 2 |

**The exempt set did not grow, and the reason is worse than growth.** P5 collects
`[data-region]` elements only from the panels it *drove*, so a skipped surface contributes
nothing to P5a, P5b, P6, P7 or P8. The fabric surface's twenty-one regions are outside all
five. Counted from the committed catalogue, **sixteen of the twenty-one hold no `unavailable`
arm** — `peers-all`, `compute-peers`, `held-peers`, all three attestation regions, all three
egress regions, `duty-user`, `slots`, all three governor regions, `isolation`, `blocks` — so
they would every one of them be exempt from P5b if P5 ever saw them. Reporting "still 24"
without that sentence would let a surface that is *entirely* unguarded by P5 look free.

`fabric` being in the skipped list is **correct** — UI-SPEC §11 gives this surface no primary
CTA — and `demo-fabric.e2e.test.ts` asserts that by name: `#s-fabric` holds zero
`.btn-primary`, its only button is `#refresh-report`, and the twenty-one regions are covered
region by region there instead. Written up in `deferred-items.md`.

## P8's hook: the fix was applied, not inherited

27-07 logged that P8 reads one hook value after the whole P5 loop and had begun comparing one
surface's rendered receipt against another surface's reading — *"close to luck"*. This plan
lands `fabric/attestation-description`, which `p8`'s own filter matches, so it would have been
the third consumer. The logged fix is in:

- **`index.html`** publishes `window.__o2LastAttestation` as `{ ...lastReceipt, bySurface }`,
  with `publishReceipt(surface, attestation)` called from the colouring handler, the
  bring-your-own handler, and the fabric refresh.
- **`demo-region-properties.ts`**'s `p8` reads `bySurface[region.surface]` and falls back to
  the flat fields, so a page publishing only the old shape is still checked.
- **Neither harness needed an edit.** Both pass the hook through as an opaque JSON string, and
  both are green unedited.

`demo-fabric.e2e.test.ts` asserts the map really is keyed — `bySurface` contains `fabric` and
`colouring` — so the P8 case over this panel cannot pass on the flat fallback and prove nothing
new. `[P8·fabric] examined 1; hook present`.

**Stated plainly: this removes the luck for the two existing regions as well**, but it does not
make P8 in `demo-liveness.e2e.test.ts` examine any more than the two it already did. That count
is unchanged at 2 and the fabric region is checked in its own spec.

## The sovereign-data sentence: deferred to 27-10, and the reason is arithmetic

`egressLines`' *"this run registered no sovereign data"* is rendered by F11. On this surface it
reports whichever manifest the last run produced, so when that run was a sovereign
bring-your-own dispatch it renders the sentence 27-07 measured to be false of what the run
submitted. **This surface is now the fifth renderer of it.**

It was **not** reworded, and this is the third plan in a row to make that call. The reasons are
the same ones and they have got stronger, not weaker:

1. UI-SPEC §5.2 fixes the copy **verbatim**.
2. `EGRESS_SENTENCES` in `demo-region-properties.ts` asserts those exact words, and P7 examined
   three regions against them in this wave's run.
3. Five surfaces render them from **one** function. A third arm added on this surface alone
   would make `surfaces/fabric.ts` a second author of the sentence that carries the project's
   core claim — the exact failure the one-region-one-function rule exists to stop.
4. The real fix needs a `registered` count on `EgressManifest` in **`@o2/net`** — a new field on
   a type in another package, counted where the guard registers a sovereign CID. That is a
   Rule 4 boundary, not a Rule 1 fix, and this plan's `files_modified` names four files in two
   packages, none of them that one.

**What was done instead, so the claim is not silently propagated:** the egress card carries the
limit in its own prose, beside the reading, in the words *the sentence reports what the egress
guard saw, not what the run submitted*; `surfaces/fabric.ts`'s header carries the measurement;
and `deferred-items.md` now carries the fix as **one change across four contracts** — the field,
the third arm, UI-SPEC §5.2, and `EGRESS_SENTENCES` — with the four specs that must be re-read
in the same pass named. That is the change 27-10 should make, and it is written so it can be
made without re-deriving it.

## The three composed F-row sentences, checked against what the surface renders

The operator's brief asked for this specifically. All three were written by Plan 27-03 because
UI-SPEC §4.6 describes those cells rather than quoting them.

| region | composed sentence | verdict |
|---|---|---|
| `fabric/start-reached`, stopped | `Nobody was asked: no peer has been asked for a start outcome.` | **Correct, and read off the screen** — `[no node] fabric/start-reached: Nobody was asked: …` |
| `fabric/start-tallies`, stopped | same sentence | **Correct**, same arm, asserted in the no-node case |
| `fabric/isolation`, both arms | `Not read: the page has not yet taken this tab's isolation reading.` | **True only because the page was built so that it is** — see below |

F17 is the one that took a decision. **UI-SPEC's F17 cells say the booleans are always readable
and, taken literally, that fails P3.** Measured under a plant rather than argued: one line
passing `isolation: window.o2.isolation()` into the stopped branch turned two specs red with
the same text —

```
fabric/isolation: on screen "cross-origin isolated: no · SharedArrayBuffer: no · in an iframe: no"
  — the catalogue says "Not read: the page has not yet taken this tab's isolation reading."
```

`demo-regions.e2e.test.ts` exit **1** (`1 failed | 16 passed`), `demo-fabric.e2e.test.ts`'s
no-node arm exit **1**. `render.ts`'s stopped-wins rule names `isolation` explicitly and P3
enforces it, so stopped wins — **and the page therefore does not call `isolation()` while the
node is stopped**, because the sentence it would otherwise be hiding behind says the page has
not read it. Taking a reading and concealing it behind that sentence would have been the
cheaper arrangement and a false one.

With a node running, F17 is on screen and asserted character for character against a fresh
`window.o2.isolation()` in the same page. Logged in `deferred-items.md` as an edit UI-SPEC owes.

## The start-outcome cliff: named, and the compromise is named too

F18 reads `Asked, and no peer answered.` when `asked > 0 && reached === 0`, never `0 of N`.
`asked === 0` is a different finding and takes the catalogue's own *nobody was asked* sentence.

**The fixture did not produce the cliff, and the case says so rather than dropping it.** A
two-tab fixture on a healthy relay always has a peer that answers — the observed reading is
`1 of 1 peer asked answered`. The branch is asserted by a **direct render call** in the
formatter block, alongside the other two zero arms, which the plan's own text authorises: *if
the fixture cannot produce that state reliably, say so and assert the branch through a direct
render call instead, naming the compromise rather than dropping the case*. It is also the case
plant A reddened.

## The duty-cycle slider

Driven through the page's own control:

- `page.fill('#duty-slider', '50')` → `capacity().dutyCycle` moves to **0.5**, F12 reads
  `0.50`, and `#duty-status` reads the composition sentence — which is digit-free on purpose,
  because F12 already carries the figure and a second copy would disagree with it the moment
  the tab went into the background.
- `window.o2.setDutyCycle(0)` throws, and **`capacity().dutyCycle` is still 0.5** afterwards.
  That is the half a rendered message cannot carry: *a tab whose call threw is unchanged*.
- Driven through the handler with a value below the slider's own minimum, `#duty-status` reads
  the governor's message **verbatim** and the slider snaps back:

```
[slider] refusal rendered verbatim: dutyCycle must be in (0, 1], got 0
```

Asserted equal to the message the direct call threw, so the page added nothing to it, and the
slider's value read `50` afterwards rather than sitting at the position that was refused.

**The slider's `min` is above zero**, so the control cannot offer a position the fabric
refuses. That is a decision and not an oversight: a control that spells a refusal is the shape
`TabApi.runJob`'s docblock argues against one interface over.

## The planted mutations

Three. Each snapshotted with `cp` to the session scratchpad **immediately before** the edit,
restored by **the surgical inverse of that edit** — never `cp` back, never `git stash`, never
`git checkout --` — and verified with `cmp`, `EXIT=$?` read on the line immediately after.
Every `cmp` returned **0**, `git diff -U0 | grep -c '^@@'` returned **1** on each source plant,
and `git status --porcelain` was checked before and after each.

### Plant A — the cliff shown as a zero: red

`surfaces/fabric.ts`'s `startReached`, one line removed so `reached === 0` falls through to the
figure. Exit **1**, `Tests 1 failed | 7 passed (8)`:

```
FAIL |e2e| demo-fabric.e2e.test.ts > the fabric-state formatter, with no DOM and no node >
  names the start-outcome cliff instead of showing a zero
AssertionError: expected '0 of 4 peers asked answered' to be 'Asked, and no peer answered.'
```

### Plant B — one per-reading `try`/`catch` removed: the whole surface froze

The plan's nominated plant. `governor: attempt(() => window.o2.governor())` →
`governor: window.o2.governor()` in `index.html`. Exit **1**, `Tests 3 failed | 14 passed (17)`:

```
FAIL |e2e| … > renders a thrown message verbatim and leaves the other twenty standing
TimeoutError: page.waitForFunction: Timeout 60000ms exceeded.
FAIL |e2e| … > moves the cap from the slider, and renders a refused one in the governor's own words
TimeoutError: page.waitForFunction: Timeout 60000ms exceeded.
FAIL |e2e| … > carries the last run's receipt and manifest, and F7 is the description verbatim
TimeoutError: page.waitForFunction: Timeout 60000ms exceeded.
```

**The observation that matters is not the three failures, it is what the page did**: the run
printed `[a] page error: planted: the governor is unavailable` **193 times**. The refresh threw
before `applyRender`, so the surface stopped updating entirely and every later wait timed out.
*One throwing call blanks twenty regions* is not a hypothetical about this design — it is what
happened the moment one catch was removed.

**Said plainly, because a timeout is a weaker signal than an assertion:** these three cases went
red by timing out rather than by comparing values. That is the honest shape of this defect — a
frozen surface has nothing wrong on it to assert against, it simply stops changing — and it is
why the case is written as *wait for the message, then compare the neighbours against what they
read before the throw* rather than as a single snapshot.

### Plant C — the reading taken while stopped: two specs red, same line

`formatFabric({ activity: null })` → `formatFabric({ activity: null, isolation: window.o2.isolation() })`.
`demo-regions.e2e.test.ts` exit **1** (`1 failed | 16 passed`) and `demo-fabric.e2e.test.ts`'s
no-node arm exit **1** (`1 failed | 16 skipped`), both with the text quoted under *the three
composed F-row sentences* above. This is the plant that measured UI-SPEC §4.6's F17 row against
`render.ts`'s stopped-wins rule instead of choosing between them on paper.

## The thrown-message arm is a stub, and the distinction is stated

With a node running, no reading on this surface throws, so the arm cannot be reached by
arranging the fabric. It is reached by replacing `window.o2.governor` with one that throws —
a harness intervention on the page's **own object**, with everything downstream of it real: the
page's per-reading `try`/`catch`, the formatter, `render.ts`'s writer, the DOM. Observed:

- all three governor regions read `planted: the governor is unavailable`, verbatim;
- `fabric/peers-all`, `fabric/duty-user`, `fabric/slots` and `fabric/addresses` read **exactly
  what they read before the throw** — compared against the earlier snapshot rather than against
  "not empty", so a blanked region cannot pass by happening to equal an absence sentence;
- the method is restored and the surface recovers on its own next tick, which is also asserted.

Plant B is what proves that case can fail.

## Deviations from Plan

### `[deviation - scope] F17 does NOT carry its three booleans with no node`

The plan's Task 1 `<behavior>` says *"Given no node … F17 carries its three booleans anyway"*.
It does not, and the reason is that the same plan's Task 2 acceptance criteria require
`demo-regions.e2e.test.ts` to exit 0. Those two cannot both hold: P3 in that spec asserts every
reading region equals the catalogue's stopped sentence on a page with no node. Measured under
plant C, both directions. Stopped wins; the page does not take the reading while stopped so the
composed sentence stays true; with a node running the booleans are on screen and asserted.
Full write-up above and in `deferred-items.md`.

### `[deviation - method] the plan's plant reddens by timeout, not by a blank region`

The plan describes the plant as making *"the no-node arm go red because a region reads empty
instead of its named reason"*. With the load-time `paintSurfaceAbsence('fabric', 'stopped')`
in place — which every other surface on this page also does, and which supplies the
`data-absence` mirror — the no-node arm cannot go empty. The plant reddens the **running**
arms instead, and it reddens them harder: the surface freezes and the page throws on every
tick. Plant C covers the no-node direction, from the other side.

### `[deviation - method] Task 1's formatter was written before its cases, and no RED was watched for it`

Task 1 is `tdd="true"`. The formatter was written first and all eight pure cases passed on
their first run. That is recorded rather than dressed up: **no RED was observed for Task 1's
own cases at the time they were written.** What carries the claim instead is plant A, which
reddened one of those eight afterwards, and plants B and C on the wiring. Tasks 2 and 3 are not
`tdd`.

### `[Rule 1 - bug] the first draft's `<dt>` labels pushed the page into a horizontal scroll`

- **Found during:** Task 2, first run of `demo-viewport.e2e.test.ts`. Exit **1**, four
  assertions: `B1 320px / idle / surface 5 of 6: documentElement.scrollWidth 388 exceeds
  innerWidth 320 + 1`, and the same at 360 — the same figure at both widths, because it is an
  intrinsic width.
- **Issue:** `demo.css` sets `dl { grid-template-columns: max-content 1fr }`, so a `<dt>` never
  wraps and its whole phrase sets the first track. The draft used sentences as labels.
- **Fix:** terse labels, with the explanation moved into the card notes, which wrap.
- **Files:** `packages/browser/demo/index.html`. **Commit:** `f1fdd55`.

### `[Rule 1 - bug] "libp2p" put an undeclared digit on screen`

- **Found during:** Task 2, first run of `demo-regions.e2e.test.ts`. Exit **1**:
  `digit at char 10: …every libp2p connection…  in  <dt>every libp2p connection</dt>`.
- **Issue:** P2 has no exception for a digit that is part of a word, and it should not.
- **Fix:** `every connection this tab holds`, with a comment saying why the accurate phrase was
  not used. **Commit:** `f1fdd55`.

### `[Rule 1 - bug] the live cross-check was written as one snapshot and raced`

- **Found during:** Task 3, first full run. Exit **1**: `expected '1 peer' to contain '2'` —
  the pair upgraded from a relay circuit to WebRTC between the paint and the object read.
- **Issue:** the surface is a live view; one snapshot of the screen and one reading of the
  object are two different moments.
- **Fix:** convergence. The comparison is a single `page.evaluate` that snapshots every DOM
  value before asking any object, polled to a bound, so no repaint can slip between the halves
  of one comparison. **Commit:** `4d227af`.

### `[Rule 2 - correctness] the per-surface P8 hook, and demo-region-properties.ts is not in files_modified`

Applied deliberately, on the operator's instruction and on 27-07's written-out fix, because
this surface is the third attestation consumer. Two files outside the plan's list are touched:
`packages/node/src/demo-region-properties.ts` (the `bySurface` lookup) and — within the list —
`index.html`'s `publishReceipt`. The alternative was to land a third region under a comparison
that was already known to be luck.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-29 | **mitigate — met** | `grep -v '^ *[/*]' surfaces/fabric.ts \| grep -c innerHTML` returns **0**. Peer ids, multiaddrs, browser family labels and thrown messages all reach the DOM through `render.ts`'s `textContent` writers. |
| T-27-30 | **accept — recorded, not implied** | The `byBrowser` row count is unbounded at the wire and this surface renders one row per family, inside a `.scroller`. No bound was taken here; the exposure is carried in the plan's register and belongs in `27-OPEN-ITEMS.md`. |
| T-27-31 | **mitigate — met, and proved twice** | Per-reading `try`/`catch` at the call site; the thrown message rendered verbatim and the neighbours compared against their pre-throw values; plant B removed one catch and froze the surface with 193 page errors. |
| T-27-32 | **mitigate — met** | F18 reads `Asked, and no peer answered.`, never `0 of N`. Plant A reddened the figure. The arm is asserted by direct render call and the compromise is named. |

## Exit codes, read directly

`EXIT=$?` on the line immediately after each command, output redirected to a file and the file
read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `vitest run --project e2e demo-liveness` — **baseline, before any change** | **0** — `6 passed`, P5 `colouring, pi, byo`, P6 5 / P7 3 / P8 2 |
| `vitest run --project node slow-specs` — baseline | **0** — `9 passed` |
| `npx tsc --noEmit` after Task 1's formatter | **0** |
| `grep -v '^ *[/*]' surfaces/fabric.ts \| grep -c innerHTML` | **0** |
| `vitest run --project e2e demo-fabric`, the eight pure cases | **0** — `8 passed` |
| Plant A (demo-fabric) | **1** — `1 failed \| 7 passed`, text above |
| `cmp` after the surgical restore | **0** |
| `vitest run --project e2e demo-regions` after Task 2's markup | **1** — P2, the `libp2p` digit |
| the same, after the reword | **0** — `17 passed` |
| the Task 2 set (peer-ledger, two-tabs, viewport, liveness) | **1** — B1 at 320 and 360, `scrollWidth 388` |
| `vitest run --project e2e demo-viewport` after the label fix | **0** — `7 passed`, 60 combinations |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e demo-fabric`, first full run | **1** — `expected '1 peer' to contain '2'` |
| the same, after the convergence rewrite | **0** — `17 passed`, 18.48 real / 21.77 user / 3.60 sys, ratio 1.37 |
| Plant B (demo-fabric) | **1** — `3 failed \| 14 passed`, 193 page errors |
| `cmp` after the surgical restore | **0** |
| Plant C (demo-regions) | **1** — `1 failed \| 16 passed`, text above |
| Plant C (demo-fabric, no-node arm) | **1** — `1 failed \| 16 skipped` |
| `cmp` after the surgical restore | **0** |
| `vitest run --project node` vocabulary + slow-specs + requirements-ledger | **0** — `54 passed` |
| built-bundle + colouring-demo + attestation-ui + demo-pi + demo-primes + demo-byo + duty-cycle-tab | **0** — `58 passed`, 56.35 real / 79.16 user / 12.96 sys, ratio 1.63 |
| `npx tsc --noEmit`, final | **0** |
| **the plan's verification set, ×6 files** | **0** — `Tests 60 passed (60)`, 49.93 real / 66.88 user / 14.39 sys, ratio 1.63 |
| `vitest run --project e2e demo-fabric` with the region dump | **0** — `17 passed` |
| `git show --stat` after each commit | only this plan's own files |

Every `(user+sys)/real` ratio is above one, so no reading was taken from a starved process.
They are comparability keys, not verdicts.

**`built-bundle.e2e.test.ts` is green**, which is the check that `vite build` resolves
`./surfaces/fabric.ts` out of the inline module script and serves it from a dumb static server.
Nothing else in this suite would catch a bundler dropping that import.

## Known Stubs

**None introduced, and the last one on the page is gone.** `#fabric-report`'s literal
*"Nothing to report: this surface has not been wired to a reading yet."* — the one text-view
stub 27-07 recorded as this plan's — now carries the surface's whole content out of the record,
and reads UI-SPEC §11's whole-surface empty state before a node exists.

All twenty-one readings carry a reading, a named absence or a thrown message in every arm, and
`format` returns an entry for every one of them in every arm, so no region can retain a value
from a previous pass. That is asserted directly by the Stop case: after `#stop`, every one of
the twenty-one is back to its stopped sentence and `#fabric-report` back to the whole-surface
sentence.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: peer-authored-into-a-table | `packages/browser/demo/index.html` | F4, F19 and F21 render peer ids, browser family labels and multiaddrs — all peer-authored — into tables. Every one goes through `textContent`; the register anticipated this at T-27-29 and it is flagged only because F19's row count is the unbounded one T-27-30 accepts. |
| threat_flag: page-writable-control | `packages/browser/demo/index.html` | `#duty-slider` calls `setDutyCycle`, which is deliberately the page's own control with **no wire frame that does the same thing** — `serveAgent` serves unauthenticated, so a peer able to dial this tab must not be able to throttle it. Flagged as a note that the asymmetry is intentional and must stay: nothing added here gives a peer that reach. |

## What is NOT done

- **`egressLines`' sovereign-data sentence still renders on this surface.** Deferred to 27-10,
  deliberately, with the fix written out as one change across four contracts. The card states
  the limit in its own prose. This is the item most worth reading in `deferred-items.md`.
- **The whole fabric surface is outside P5, P6, P7 and P8** in `demo-liveness.e2e.test.ts`.
  Measured. Covered by `demo-fabric.e2e.test.ts` instead, by name.
- **The P5b exempt set is still twenty-four and sixteen more are waiting behind a property that
  cannot see them.** Nothing asserts either number.
- **The start-outcome cliff was not produced by the fixture**, only by a direct render call.
- **`#duty-status` renders a digit by design** — the governor's `RangeError` names the value —
  and nothing guards it, as for the other four status elements. Logged.
- **F21 shows one address twice**, because the node advertises it twice. Not de-duplicated.
- **UI-SPEC is not edited.** Six corrections are now owed and logged; F17's is this plan's.
- **Benchmarks is the last surface with no element and no `WIRED_SURFACES` entry** — Plan 27-09.
- **Only Chromium.** Every `e2e` spec here launches chromium alone; the project's limit.
- **STATE.md and ROADMAP.md were deliberately not touched**, and no `gsd-sdk query state.*` or
  `roadmap.*` verb was run — the operator's instruction for this plan forbids them.

## Success criteria

1. **Met.** All twenty-one regions carry a reading, a named absence or a thrown message; the
   table above quotes each one off the screen, and the no-node arm asserts all twenty-one
   against the catalogue and checks each digit-free.
2. **Met, and proved by a plant.** Plant B removed one per-reading catch; the surface froze and
   the page threw 193 times. The green case compares the neighbours against their pre-throw
   values rather than against "not empty".
3. **Met.** `#report` reads `not asked yet` before and after, on a hidden panel, and
   `#refresh-report` is reachable there; `peer-ledger.e2e.test.ts` and `two-tabs.e2e.test.ts`
   are both green unedited.
4. **Met in the form the guards allow, and the difference is recorded.** `startReport()` is read
   with no node in the sense that matters — F18 renders *nobody was asked* rather than a zero.
   `isolation()` is deliberately **not** called while stopped, against the plan's wording and
   with UI-SPEC's F17 row measured against P3 under a plant. The eight that throw are never
   called without a node.
5. **Met.** F18 names the cliff (direct render call, compromise named); F5 names the
   relayed-only condition and reads UI-SPEC's own sentence when there is none.
6. **Met.** The `RangeError` is rendered verbatim, asserted equal to the message the direct call
   threw, and `capacity().dutyCycle` did not move.
7. **Met.** `#s-fabric` holds zero `.btn-primary`, its only button is `#refresh-report`, and
   `[P5] skipped (no primary run control on the surface): session, primes, fabric`.

## Commits

| hash | what |
|---|---|
| `3caa2e7` | `feat(27-08)` — the formatter and eight pure cases |
| `f1fdd55` | `feat(27-08)` — the panel, the slider, `WIRED_SURFACES`, and the per-surface P8 hook |
| `4d227af` | `test(27-08)` — the surface with a node, without one, and with a reading that throws |
| `e907751` | `test(27-08)` — print all twenty-one regions verbatim on every run |
| *(this file)* | `docs(27-08)` — the summary and six deferred items |

Each committed with `git commit -m "…" -- <explicit paths>`, `-m` before `--`, and each verified
with `git show --stat` to contain only this plan's own files.

## Self-Check: PASSED

- `packages/browser/demo/surfaces/fabric.ts` — FOUND, **483 lines** (`min_lines: 220`),
  `isolation` present ×16, `innerHTML` count **0** outside comments
- `packages/node/src/demo-fabric.e2e.test.ts` — FOUND, **877 lines** (`min_lines: 180`),
  `node not started` present
- `packages/browser/demo/index.html` — FOUND, modified; `#report`'s literal unchanged,
  `#refresh-report` unchanged, `grep -c '+ peer\|− peer'` returns **0**
- `packages/browser/src/demo-regions.ts` — FOUND, modified; `'fabric'` in `WIRED_SURFACES`,
  which now holds six entries: session, colouring, pi, primes, byo, fabric
- `packages/node/src/demo-region-properties.ts` — FOUND, modified; `bySurface` lookup in `p8`
- `deferred-items.md` — FOUND, six entries appended
- commits `3caa2e7`, `f1fdd55`, `4d227af`, `e907751` — all FOUND
- `git status --porcelain` after every plant restore — printed only files this plan owns;
  every `cmp` exit **0**
