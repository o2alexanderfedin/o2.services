---
phase: 27-demo-ui-driven-by-real-fabric
plan: 5
subsystem: browser-demo
tags: [mr-03, mr-04, mr-05, mr-06, mr-07, demo-01, data-05, data-06, ui-spec-4-4, ui-spec-5-3, p5, mutation-proof]
dependency-graph:
  requires:
    - 27-01 (the #bar grid contract and demo-viewport.e2e.test.ts's 60 combinations)
    - 27-02 (the six-surface shell and the element-id contract)
    - 27-03 (the 91-region catalogue and demo/render.ts's writer)
    - 27-04 (surfaces/colouring.ts's shape, P5, and demo-region-properties.ts's P6/P7/P8)
  provides:
    - "packages/browser/demo/surfaces/pi.ts — the pure formatter for UI-SPEC section 4.4:
      format(state) -> SurfaceRender covering P1-P14, section 5.3's second-device panel, and
      the reduce-tree rows, with no DOM and no globals"
    - "the pi panel: all 14 declared and wired, one .btn-primary (`Run the reduce`), a
      digit-free #pi-status, and #pi-report as the surface's one text view"
    - "WIRED_SURFACES gains 'pi' — the second surface P5 drives"
    - "window.__o2LastPiRun — the page-side hook demo-pi.e2e.test.ts compares the screen
      against, the same forcing function __o2LastAttestation is for P8"
    - "packages/node/src/demo-pi.e2e.test.ts — the lone-tab arm and the two-tab arm, every
      reading off the screen, with a self-probing refusal-colour scan"
    - "packages/browser/src/pi-surface.node.test.ts — 16 unit cases reaching the
      attempted-but-nothing-combined arm the browser does not produce to order"
    - "a repaired P5: it drives its own navigation, so 'discovered from the DOM' is now true of
      a surface that is not the page's default"
  affects:
    - Plans 27-06 to 27-09 — each appends one line to WIRED_SURFACES and inherits P5's
      navigation fix; without it every one of them would have hit the same 30 s timeout
    - "UI-SPEC sections 4.4 and 9 (four further corrections owed, logged in deferred-items.md)"
tech-stack:
  added: []
  patterns:
    - "a per-surface hook (`window.__o2LastPiRun`) published by the page's own handler, so a
      screen reading is compared against the run rather than against the page itself"
    - "a negative assertion that carries its own probe: the refusal-colour scan paints a
      detached element with --color-refusal and asserts the detector sees it, before the empty
      result over #s-pi is believed"
    - "an absence sentence composed and marked COMPOSED where the catalogue's arm would be
      FALSE in that state — distinct from where the catalogue merely has no arm"
    - "arguments derived from computePeers() such that the CLAIM tightens with peers, not only
      the wall time: terms per shard is fixed, so the series bound falls as devices join"
key-files:
  created:
    - packages/browser/demo/surfaces/pi.ts
    - packages/browser/src/pi-surface.node.test.ts
    - packages/node/src/demo-pi.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/src/demo-regions.ts
    - packages/node/src/demo-liveness.e2e.test.ts
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/deferred-items.md
decisions:
  - "The lone-tab copy was REMOVED from index.html as static prose and is now rendered into
    pi/reduce-attempted out of the run. Left static it would have told a visitor whose reduce
    had just combined that the claim needs a second device, and a spec asserting the sentence
    would have been asserting the markup rather than the run."
  - "The lone-tab fixture uses window.o2.start({relayAddrs: []}) rather than a relay, because
    the relay is itself a FabricNode answering computePeers()'s offer probe — a tab that joins
    one HAS a compute peer and its reduce IS attempted. Joining would have made the arm
    unreachable on purpose."
  - "Three absence sentences were composed rather than transcribed, and the reason is stronger
    than 27-04's: UI-SPEC's P7 arm asserts *a reduce was started*, which is FALSE in the
    lone-tab arm. A false catalogue sentence is worse than a composed one."
  - "The tree diagram draws depth + 1 rows. ReduceTree.depth counts combine layers ABOVE the
    leaves, so `map` plus one row per layer cannot be `depth` rows; drawing `depth` would mean
    dropping the map row UI-SPEC names first, or drawing one fewer layer than the fabric built."
  - "P5's navigation fix is an edit to Plan 27-04's file and is the acceptance criterion firing
    exactly as written. The census rose 1 -> 2 unedited; the DRIVE did not, and that half was a
    defect in the property."
metrics:
  duration: ~85 minutes
  tasks: 3
  files-created: 3
  files-modified: 4
  commits: 5
  completed: 2026-08-10
---

# Phase 27 Plan 5: The π & reduce surface Summary

All fourteen of UI-SPEC section 4.4 are declared, wired and driven by one pure formatter, and
**a lone tab reads the reduce it cannot run as a condition of the topology** — section 5.3's
sentence, the fabric's own reason quoted verbatim, no zero and no refusal tone, all three
measured on a real page rather than argued.

The sharpest result is not the surface. It is that **the acceptance criterion caught the thing
it was written to catch.** P5's census rose from one surface to two with no edit to
`demo-liveness.e2e.test.ts`, exactly as promised — and P5 then could not click the control it
had just discovered, because `nav.ts` hides every panel but the selected one and P5 had only
ever driven the page's default. *Discovered from the DOM* had never been tested anywhere but
colouring.

## P5 discovered π unedited — and the drive was a defect, now fixed

Two halves, and they came apart. Recorded in the order they were observed.

**Half one, unedited, exactly as 27-04 promised.** The very first run of the unmodified
`demo-liveness.e2e.test.ts` against the new surface:

```
[P5] wired surfaces: session, colouring, pi
[P5] exercised (a primary run control was found and driven): colouring, pi
[P5] skipped (no primary run control on the surface): session
```

**Half two, a defect in P5.** The same run, exit **1**, `Tests 5 failed | 1 passed (6)`:

```
TimeoutError: page.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('#s-pi .btn-primary')
    - locator resolved to <button id="run-pi" class="btn btn-primary">Run the reduce</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
```

`nav.ts` renders `panel.hidden = !selected` and the default selection is `colouring`, so a
property that discovers a control generically and then clicks it drives exactly one surface:
the one the page opens on. It would have failed on the second surface whichever one that was —
π was merely first. The four other failures in that run are one cascade: the exception aborted
the case before `driven = collected`, so P6, P7, P8 and the named-region block all reported
against an empty snapshot.

**Fixed in P5, not worked around in π**, and by the visitor's own path — press the tab, which
writes `location.hash`; nothing reaches into `nav.ts` and nothing removes a `hidden` attribute
by hand. Commit `796ede5`. After it, exit **0**, `Tests 6 passed (6)`:

```
[P5] exercised (a primary run control was found and driven): colouring, pi
[P5] 27 of 28 reading regions carry a reading after the run
```

Twenty-eight is sixteen colouring readings plus twelve π readings; the twenty-eighth is C21,
which correctly reads its own `unavailable` sentence because the colouring was not refuted.
**All twelve π readings carry a reading.**

## P6, P7 and P8 — two of the three rose, and the third did not

Measured from the same run, before and after.

| property | 27-04 (colouring only) | 27-05 (colouring + π) | why |
|---|---|---|---|
| P6 — a populated figure occurs in its own text view | `examined 3` | **`examined 4`** | `pi/estimate`'s source ends `.estimate`, which is one of `P6_FIELDS` |
| P7 — a withheld count never appears without its sentence | `examined 1` | **`examined 2`** | `pi/egress` ends `/egress` and carries a count |
| P8 — the attestation region is the fabric's own words | `examined 1` | **`examined 1`** | **unchanged, by design** — π has no attestation region |

**P8 did not rise and must not have.** `runPi` returns no attestation field, so there is no
receipt on this surface to examine; a rise here would have meant a receipt borrowed from
somewhere else. Stated rather than smoothed, because "all three rose" is the sentence a summary
wants to write.

Plant C below measures P6's π contribution rather than inferring it: with `pi/estimate` dropped
from the record, P6 fell from 4 back to 3.

## The fourteen regions, read off the screen

Not inferred. `demo-pi.e2e.test.ts` now prints every `[data-region]` inside `#s-pi`, verbatim,
in both arms — added because 27-04's summary had to be corrected for inferring five regions
from the shipped symbols and then saying it had read them. The two columns below are that
output, with `⏎` for a newline inside a region.

| # | region | lone tab | two tabs |
|---|---|---|---|
| P1 | `pi/terms-arg` | `1000000` | `3000000` |
| P2 | `pi/shards-arg` | `4` | `12` |
| P3 | `pi/terms` | `1000000` | `3000000` |
| P4 | `pi/shards` | `4` | `12` |
| P5 | `pi/complete` | `true` | `true` |
| P6 | `pi/reduce-attempted` | *This claim needs a second device.* ⏎ …the whole of §5.3's body… ⏎ ⏎ `The fabric's own reason: no executor to combine on` | `A reduce was started.` |
| P7 | `pi/combined` | `No aggregate: no reduce was attempted — see above.` (COMPOSED) | `true` |
| P8 | `pi/tree-depth` | `No tree: no reduce was attempted — see above.` | `depth 2 ⏎ map ⏎ lvl 1 ⏎ lvl 2` |
| P9 | `pi/combines` | `No tree: no reduce was attempted — see above.` | `4` |
| P10 | `pi/estimate` | `No estimate: the fabric produced no aggregate to read back.` | `3.141592320` |
| P11 | `pi/error-bound` | `0.000002000` | `0.000000667` |
| P12 | `pi/against-published` | `No comparison: the fabric produced no aggregate to compare.` | `\|estimate − π\| = 0.000000333 · the alternating-series bound for this term count is 0.000000667 · inside the bound ⏎ estimate = 3.141592320 · published π = 3.141592654 — Math.PI, a published mathematical constant and not a reading of this run` |
| P13 | `pi/elapsed` | `54ms` | `358ms` |
| P14 | `pi/egress` | `What left this device: ⏎ 0 frames sent, 0 byte(s) total. ⏎ 0 withheld — and this run registered no sovereign data…` | `…19 frames sent, 9173 byte(s) total. ⏎ 0 withheld — …` |

**Every one of the fourteen carries a reading or a named absence in both arms.** Five of the
lone-tab cells are named absences and every one of them is the right absence for its own state:
the map half reads real figures because a lone tab really did map every shard.

**P14's lone-tab reading is `0 frames sent, 0 byte(s) total`, and that is a measurement rather
than an absence** — nothing left the device because there was no peer to send it to. The
sentence beside the withheld count is in the same region, from the same `egressLines` call, so
P7 examined it and found it whole.

## The lone tab, and the three things about it that are easy to get separately right

`reduceJob` excludes the submitter by contract. Observed, on a page:

```
[lone] terms=1000000 shards=4 complete=true reduceAttempted=false reason="no executor to combine on"
```

- **The sentence is on screen**, rendered out of the run rather than sitting in the markup. The
  static copy the mockup shipped was **removed** from `index.html`: left there it would have
  told a visitor whose reduce had just combined that the claim needs a second device, and a spec
  asserting it would have been asserting the markup.
- **The reason is verbatim, into `textContent`.** `panel).toContain(hook.reduceReason)` compares
  the screen against `window.__o2LastPiRun` — the run, not a string the spec holds — so a
  paraphrase reddens and a fabric that changes its wording does not. `grep -v '^ *[/*]'
  surfaces/pi.ts | grep -c innerHTML` returns **0**.
- **No refusal tone, and the check carries its own probe.** The scan walks every element in
  `#s-pi` for `rgb(203, 75, 22)` in eight computed colour properties, and in the same frame
  paints a detached element `var(--color-refusal)` and asserts the detector **sees** it. A scan
  that finds nothing proves nothing until it has been shown finding something. Both assertions
  green: `probeDetected: true`, `offenders: []`.
- **No zero.** `treeDepth`, `combines` and `estimate` are all `0`/`null` in the reading and none
  of them reaches the screen as a quantity. Plant B below is the proof that this can fail.

## The two-tab run, and the arm it landed on

Recorded, named, and written after the reading:

```
[two-tab] ARM=combined terms=3000000 shards=12 complete=true treeDepth=2 combines=4
          estimate=3.141592320257844 bound=6.666665555555741e-7
```

- **Twelve leaves at the default fanout give three combines at the first layer and one above
  them** — `treeDepth 2`, `combines 4`, which is the arithmetic and not a coincidence.
- **`|estimate − π| = 3.33e-7` against a bound of `6.67e-7`.** Inside, and not by so much that
  the comparison could not have failed — the error is half the bound, which is where the
  Leibniz series actually sits.
- `computePeers()` reported **two** peers rather than one: the relay is itself a `FabricNode`
  serving the agent protocol, which is `attestation-ui.e2e.test.ts`'s documented finding and is
  why `shards` is 12 rather than 8.
- **The spec reports the arm rather than demanding a luckier run.** Had `combined` been false it
  would have asserted UI-SPEC's own `No aggregate: a reduce was started and no combine produced
  one.` and still passed, with `ARM=attempted-no-aggregate` in the output — so a fabric that
  stops combining becomes visible as a pattern across runs instead of as a green.

## The planted mutations

Three. Each snapshotted with `cp` to the session scratchpad **immediately before** the edit,
restored by **the surgical inverse of that edit** — never `cp` back, never `git stash`, never
`git checkout --` — and verified with `cmp`, `EXIT=$?` read on the line immediately after.
**Every `cmp` returned 0**, `git diff -U0 | grep -c '^@@'` returned 1 on each, and
`git status --porcelain` showed only this plan's own files before and after each.

### Plant A — the reason paraphrased instead of quoted: **the e2e red, and the unit spec too**

The plan's nominated plant. `${REASON_LABEL}${reason}` → `${REASON_LABEL}the fabric found nobody
to combine on, so the reduce did not start.` Exit **1**, `Tests 1 failed | 9 passed (10)`:

```
FAIL  |e2e| … > reads section 5.3's sentence with the fabric's own reason quoted verbatim
AssertionError: expected 'This claim needs a second device.\nTh…' to contain 'no executor to combine on'
- no executor to combine on
+ This claim needs a second device.
+ The submitter is excluded from the combine executor set by contract, so a lone tab maps …
+ The fabric's own reason: the fabric found nobody to combine on, so the reduce did not start.
```

**The headline stayed green under it, and that is the finding worth keeping.** A page that
paraphrases the reason still says *This claim needs a second device.* — so an assertion on the
headline alone would have passed a page that had stopped quoting the fabric. The verbatim
comparison against `window.__o2LastPiRun` is what carries the claim.

Same plant, unit spec: exit **1**, `Tests 2 failed | 14 passed (16)`, both the fixed-reason and
the *quotes whatever reason the fabric gives* cases.

### Plant B — the sentinel zero printed as a count: **the no-zero arm red**

`regions['pi/combines'] = absence(…)` → `String(run.combines)` in the lone-tab branch. Exit
**1**, `Tests 1 failed | 9 passed (10)`:

```
FAIL  |e2e| … > shows no zero for the aggregate, the tree or the combines
AssertionError: expected '0' to be 'No tree: no reduce was attempted — se…' // Object.is equality
```

### Plant C — does P5 actually guard π now: **P5b names a π region, and P6 falls 4 → 3**

`regions['pi/estimate'] = estimate` removed. Exit **1**, `Tests 1 failed | 5 passed (6)`:

```
[P5] 26 of 28 reading regions carry a reading after the run
[P6] examined 3 populated figures
AssertionError: a reading region survived a real run still saying it had not been run, or that the node is stopped: expected [ Array(1) ] to deeply equal []
+   "pi/estimate: on screen \"No estimate: this tab's node is stopped.\" — that is its stopped sentence, and this tab has both run and a running node",
```

Two readings in one plant: **P5b covers π**, by name; and **π contributes exactly one to P6's
count**, measured rather than asserted.

## Exit codes, read directly

`EXIT=$?` on the line immediately after each command, output redirected to a file and the file
read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `vitest run --project node pi-surface.node.test.ts` — **before** the formatter existed | **1** — `Cannot find module '../demo/surfaces/pi.ts'` (the RED) |
| the same, after Task 1 | **0** — `Tests 16 passed (16)` |
| `npx tsc --noEmit` after Task 1 | **0** |
| `vitest run --project node vocabulary.node.test.ts` | **0** — `Tests 25 passed (25)` |
| `npx tsc --noEmit` after Task 2 | **0** |
| `vitest run --project e2e demo-regions` | **0** — `Tests 17 passed (17)` |
| `vitest run --project e2e demo-liveness`, **P5 unedited** | **1** — `5 failed \| 1 passed`, `element is not visible` |
| `vitest run --project e2e demo-liveness`, after the P5 fix | **0** — `Tests 6 passed (6)`, 9.47 s real / 19.13 user / 2.78 sys, ratio 2.31 |
| `vitest run --project e2e demo-viewport` | **0** — `Tests 7 passed (7)`, 8.28 s real |
| `vitest run --project e2e demo-viewport --reporter=verbose` | **0** — all five widths named, 60 combinations |
| `npx tsc --noEmit` after Task 3 | **0** |
| `vitest run --project e2e demo-pi`, first attempt | **1** — the two-tab dial timed out; see the deviation below |
| `vitest run --project e2e demo-pi`, after the sequencing fix | **0** — `Tests 10 passed (10)` |
| Plant A, e2e | **1** — the verbatim assertion, text recorded above |
| Plant A, unit | **1** — `2 failed \| 14 passed (16)` |
| `cmp` after the surgical restore | **0** |
| Plant B | **1** — `expected '0' to be 'No tree: …'` |
| `cmp` after restore | **0** |
| Plant C | **1** — P5b names `pi/estimate`; P6 `examined 3` |
| `cmp` after restore (against both the B and the A snapshots) | **0** and **0** |
| `vitest run --project node` pi-surface + slow-specs + vocabulary | **0** — `Tests 50 passed (50)` |
| `vitest run --project e2e` built-bundle + colouring-demo + attestation-ui | **0** — `Tests 18 passed (18)`, 30.45 s real / 46.28 user / 5.17 sys, ratio 1.69 |
| **the plan's verification set, ×4 files** | **0** — `Tests 40 passed (40)`, 20.58 s real / 34.47 user / 7.61 sys, ratio 2.04 |
| `grep -v '^ *[/*]' surfaces/pi.ts \| grep -c innerHTML` | **0** |
| `grep -ci 'simulate' index.html` | **0** |
| `grep -n 'attestation' surfaces/pi.ts` | three hits, all inside the docblock explaining its absence |
| `git show --stat` after each commit | only this plan's own files |

Every `(user+sys)/real` ratio above is greater than one, so no reading was taken from a starved
process. They are recorded as comparability keys, not verdicts.

## Deviations from Plan

### `[deviation - scope] P5 was edited, which is the acceptance criterion firing`

- **Found during:** Task 2's verification, on the first unmodified run.
- **Issue:** P5 discovered `#s-pi .btn-primary` and could not click it — `element is not
  visible`, 30 s, because `nav.ts` hides unselected panels.
- **Fix:** P5 presses `#nav-<surface>` and waits for the panel before driving it. The plan says
  in as many words that this would be a defect in P5 and not in π, so it was fixed there.
- **Files:** `packages/node/src/demo-liveness.e2e.test.ts` (the loop, and a corrected paragraph
  in its header saying what the property had and had not been doing).
- **Commit:** `796ede5`
- **Consequence for later plans:** every one of 27-06 to 27-09 would have hit the identical
  timeout. The fix is theirs as much as this plan's.

### `[Rule 1 - bug] the two-tab dial timed out until the fixture was sequenced`

- **Found during:** Task 3's first run. `page.evaluate: TimeoutError: signal timed out` on
  `window.o2.dial(bAddrs[0])`, with the lone-tab arm entirely green in the same run.
- **Issue:** the fixture opened both tabs and *then* joined both, and it left the lone-tab node
  running in the same chromium while doing it.
- **Fix:** open-and-join one tab at a time, which is `demo-liveness.e2e.test.ts`'s order — a tab
  that has not reserved on the relay is not there to be found — and stop the lone node in an
  `afterAll` before the two-tab describe, as `attestation-ui.e2e.test.ts` stops its provider.
- **Verified:** exit 0, `Tests 10 passed (10)`, and green on every subsequent run (five so far).
- **Honest limit:** the two changes were made together and **not bisected**, so which of them
  the dial needed is unmeasured. Both are defensible on their own terms, and saying that is
  better than attributing the fix to whichever one sounds more likely.

### `[deviation - scope] three absence sentences were composed, and the reason is stronger than 27-04's`

`pi/combined` in the lone-tab arm, and `pi/combines` in two arms. UI-SPEC's P7 sentence is *No
aggregate: **a reduce was started** and no combine produced one*, and §5.3 names it explicitly
as the lone tab's **sibling** case — so in the lone-tab arm the catalogue's own sentence is
false. 27-04's two compositions filled a gap where UI-SPEC named nothing; these three replace a
sentence that would have been untrue. All marked `COMPOSED` in the source and logged.

**Coverage:** the first is asserted on a real page by the lone arm. The other two are reached
only by the unit spec — the two-tab fixture combined, so no browser has rendered either.

### `[deviation - scope] the tree diagram draws `depth + 1` rows, not `depth``

The plan's acceptance criterion says *renders exactly `treeDepth` rows*, and UI-SPEC in the same
breath says each row is labelled `map` / `lvl 1` / …. The two cannot both hold:
`ReduceTree.depth` is `level - 1` in `packages/core/src/reduce.ts` and counts the combine layers
*above* the leaves. Drawing `depth` rows would mean dropping the `map` row or drawing one fewer
layer than the fabric built. The spec asserts the row set against the depth the run reported, so
the shape is still under guard; the criterion is met in substance and not in the letter, and the
letter is logged as a UI-SPEC correction.

### `[deviation - method] a unit spec was added that the plan did not ask for`

`packages/browser/src/pi-surface.node.test.ts`, 16 cases in the `node` project — the same
deviation 27-04 made, for the same reason plus one. It holds the purity claim (it loads the
formatter where `document` does not exist) and it reaches **the arm the browser will not produce
on demand**: `reduceAttempted: true` with `combined: false`. It also carried Task 1's RED, which
was observed: `Cannot find module '../demo/surfaces/pi.ts'`, exit 1, before the formatter
existed.

File-count effect checked rather than assumed: `slow-specs.node.test.ts` passes with the new
file, so the node project is inside its drift tolerance of five.

### `[deviation - scope] the mockup's static lone-tab card lost its copy to a region`

`index.html` carried §5.3's headline and body as static prose from 27-02. It is gone, replaced by
`pi/reduce-attempted`. Static copy on a surface whose reduce has just combined is a placeholder
that used to be true, and a spec asserting a static sentence asserts the markup.

### `[deviation - method] `.scroller` rather than the plan's inline `overflow-x:auto``

The plan's Task 2 says to wrap the diagram and any table in `<div style="overflow-x:auto">`.
`.scroller` in `demo.css` **is** `overflow-x: auto`, it is what UI-SPEC §6.4 and 27-04's cards
use, and an inline style would be a second definition of one rule.

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-16 | **mitigate — met, and measured three ways** | §5.3's panel is rendered from the run; `reduceReason` is compared against `window.__o2LastPiRun` verbatim; the refusal-colour scan is empty **and** its probe was seen firing; no π region reads as the quantity zero. Plant A reddened the verbatim arm, plant B the zero arm. |
| T-27-17 | **mitigate — met** | The surface declares no attestation region: `regions.filter(id => id.includes('attestation'))` off the live panel is `[]`, and P8's examined count is unchanged at 1 rather than rising. The page states why in prose beside the reduce panel, citing `runPi`. |
| T-27-18 | **mitigate — met** | `pi/tree-depth` renders `depth N` and one row per layer, and nothing else. The assertion compares the row set against the depth the run reported, so an invented row reddens. `TabPiRun` carries no per-node field to draw one from, which the card-note says on screen. |
| T-27-19 | **mitigate — met** | `grep -v '^ *[/*]' surfaces/pi.ts \| grep -c innerHTML` returns 0; every string reaches the DOM through `render.ts`'s `textContent` writers. The one `window` outside a comment in that file is the English word *window* inside §5.3's ported copy. |

## Known Stubs

None introduced. All fourteen π regions carry a reading or a named absence in every arm, and
`format` returns an entry for every one of them in every arm, so no region can retain a value
from a previous run. `#pi-report`'s pre-run literal is now `nothing dispatched yet` rather than
*this surface has not been wired to a reading yet*, which had stopped being true.

The three remaining text-view stubs from 27-02 (`#primes-report`, `#byo-report`,
`#fabric-report`) are unchanged and still declared.

## What is NOT done

- **65 → 51 regions still have no element.** Four surfaces remain: primes, bring-your-own,
  fabric state and Benchmarks.
- **P8's count did not rise**, and could not. π has no receipt.
- **The composed sentences for `pi/combines` have never rendered in a browser.** Only the unit
  spec reaches them.
- **`#pi-status` is digit-free by hand.** Nothing enforces it, exactly as nothing enforces
  `#run-status`; both are logged.
- **P5b's exempt set is 15 across the two driven surfaces, not two.** 27-04 recorded two, and
  counting it was this plan's finding rather than its fix — the three lower colouring rungs and
  the three verify readings were already exempt when that number was written. All seven π
  regions in the set are asserted by name in `demo-pi.e2e.test.ts`. Logged.
- **The two-tab dial fix was not bisected.** Two changes, one green.
- **UI-SPEC is not edited.** Four corrections are owed and logged: P7's not-attempted arm, P9's
  two zero-valued arms, the tree diagram's row count, and the exempt-set bound.
- **Only Chromium.** Every `e2e` spec here launches chromium alone; the project's limit, not
  this file's.
- **STATE.md and ROADMAP.md were deliberately not touched.** The operator's instruction for this
  plan forbids the `gsd-sdk query state.*` and `roadmap.*` verbs.

## Commits

| hash | what |
|---|---|
| `21e9f6d` | `feat(27-05)` — the π formatter, and 16 unit cases with no DOM |
| `796ede5` | `fix(27-05)` — P5 discovered a second surface and could not click it |
| `f9fe138` | `feat(27-05)` — the π panel's 14 regions, the run control, `WIRED_SURFACES` |
| `b16aa8d` | `test(27-05)` — both arms of the reduce, and `window.__o2LastPiRun` |
| `e42bde0` | `test(27-05)` — print all fourteen regions, verbatim, per arm |

Each committed with `git commit -m "…" -- <explicit paths>` and each verified with
`git show --stat` to contain only this plan's files.

## Self-Check: PASSED

- `packages/browser/demo/surfaces/pi.ts` — FOUND, 308 lines (`min_lines: 170`), `reduceReason`
  present
- `packages/browser/src/pi-surface.node.test.ts` — FOUND
- `packages/node/src/demo-pi.e2e.test.ts` — FOUND, 506 lines (`min_lines: 180`), `second device`
  present
- `packages/browser/demo/index.html` — FOUND, modified
- `packages/browser/src/demo-regions.ts` — FOUND, modified
- `packages/node/src/demo-liveness.e2e.test.ts` — FOUND, modified
- `deferred-items.md` — FOUND, four entries appended, diff is insertions only
- commits `21e9f6d`, `796ede5`, `f9fe138`, `b16aa8d`, `e42bde0` — all FOUND
- `git status --porcelain` after every plant restore — only this plan's own files, and every
  `cmp` exit 0
