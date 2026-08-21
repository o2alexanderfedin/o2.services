# Open items — Phase 27

**Written 2026-08-10 by Plan 27-10, the ledger-reconciliation wave.** This is the list of
what Phase 27 left open, consolidated out of the nine SUMMARY files and out of
`deferred-items.md`'s thirty entries. Every item carries four things and is not an entry
without them: **what is open**, **what was measured about it**, **what it would cost to
close**, and **who decides**. An open item with no named decider is a note, and a note is
how an open item becomes a closed one by attrition.

`deferred-items.md` is the long form and stays where it is — each entry there carries its
readings, its plant output and its exact wording. This file is the register: it says which
of those are still live, groups them, and puts a decider against each.

**One thing this file must not be read as.** Phase 27 shipped seven surfaces and two of the
items below are load-bearing rather than tidy-up. They are first, and they are written at
length for that reason.

---

## 1. ~~The Primes workload has no dispatch path from a browser tab~~ — CLOSED 2026-08-17

> **The owner decided, and took Option A.** The entry below is kept unedited: it is the record
> of what was open, what was measured, and what closing it would cost — and the cost it names
> is exactly the cost that was paid. `PRIMES_RECORD` is signed, all three demo records were
> re-signed under a new anchor, `TabApi.runPrimes` exists with `demo/main.ts` calling it, and
> `#s-primes` carries the `Count the primes` control UI-SPEC §11 specified and had never
> rendered.
>
> **Closed on a measurement, not on a merge.** `demo-primes.e2e.test.ts` drives Chromium and
> reads `N = 100000, shards = 8, fabric counted 9592, published value 9592` — an equality
> against a value published in the mathematical literature. `demo-liveness.e2e.test.ts`'s P5
> now reports `exercised … colouring, pi, primes, byo`, discovered rather than listed.
>
> **N9 closed too, on the same day and as a second step.** It stayed permanently unavailable
> through Option A because `TabPrimesRun` carried the total and not the shard rows. `perShard`
> was then added — derived from the tab's own shard results, never from the total — so the sum
> of the rows against the aggregate the combine nodes returned is a real check on the reduce.
> `permanentlyUnavailable` now has no members anywhere in the catalogue, and a guard asserts the
> set is empty. The tiling proof still lives in `primes-reduce.node.test.ts`, which is where it
> can assert on the counts rather than merely display them.

**Decider: owner.** This is the headline item and it is the one Phase 27 did not close.

**What is open.** The roadmap calls Primes one of two load-bearing surfaces. The surface
exists — twelve regions, a published π(x) oracle table rendered as `cited`, a stated-weakness
panel — and **it runs nothing.** Eight of its twelve regions are permanent named absences.
Audit finding **G4's primes half** stays open; see the `G4 **split**` row in
`.planning/v1.1-MILESTONE-AUDIT.md`, amended by this plan.

**What was measured** — three facts, each a reading rather than an inference:

1. **No signed record vouches for the prime-counting module.** `packages/demo/src/kernel-record.ts`
   exports `KERNEL_RECORD` and `PI_RECORD` and no third. A tab pins one anchor, so every
   executor — including the tab's own — refuses a prime-counting dispatch for a provenance
   failure.
2. **`runJob` cannot carry the input.** Its shards are `{ value: { a: i } }`; the kernel reads
   an eight-byte block from `buildPrimesInput(n)`. Even with a record, `runJob` sends the
   wrong bytes.
3. **Zero production callers, re-measured 2026-08-10.** `packages/node/src/demo-primes.e2e.test.ts`
   prints it on every run: **17 matches of five symbols across 5 files, 11 of them on a code
   line in 2 files (`packages/demo/src/index.ts`, `packages/demo/src/primes.ts`), production
   callers 0.** The spec's header states it is **expected to FAIL** the day somebody wires the
   workload, and that was demonstrated by planting a real caller — both arms red, naming the
   file and the lines. A stub `runPrimes` on `window.o2` turns **sixteen** assertions red
   across two files.

**What it would cost to close — Option A, and it is priced rather than gestured at.** Extend
`scripts/sign-kernel.ts` to sign `primes.wasm`; regenerate `packages/demo/src/kernel-record.ts`
with three records **under a new `KERNEL_TRUST_ANCHOR`**, because the script discards its
private half on every run and the existing records cannot be extended; add
`TabApi.runPrimes({n, shards, redundancy, peerIds})` mirroring `runPi` — map with
`buildPrimesInput`, reduce over `PRIME_COUNT_KEY` with `projectPrimeCount`, read the total
back out of the store. Roughly sixty lines in `packages/browser/demo/main.ts`, one interface
member, one build-time script change. Then the Primes surface must be **replanned**, because
every one of its twelve regions is written as a permanent absence and three guards will go red
by design the moment `runPrimes` exists.

**What blocks it.** It touches the trust root. Re-signing under a new anchor **changes what a
stock `o2 agent` and a stock `o2 seed` will run**, because both default to that anchor. It is
also outside `27-CONTEXT.md`'s statement that *"every API it consumes exists"* — a statement
that should be corrected rather than quietly outgrown.

**Option B was planned and shipped** (UI-SPEC section 10): render the absence honestly, ship no
run control, state the reason on screen. It is what the surface does today, and it is the right
answer to *"do not ship a control that produces refusals discovered as timeouts"* — but
**descoped is not satisfied**, and this entry exists so the descoping stays visible.

---

## 2. An egress reading cannot tell *registered nothing* from *saw nothing leave* — `EGR-01`

> **CLOSED 2026-08-11.** Everything below is preserved as written, because it is the analysis
> the fix was built from and one of its own corrections is why the fix landed in the right
> place. What shipped matches the table below, with one departure named rather than absorbed:
> the field is `EgressManifest.registeredSovereign` (not `registered`), and on the guard's own
> getter it is a **whole-record tally** — every registration taken since the record began,
> cleared by `reset()` — while the per-job figure travels from `submitJobWithEgress` into
> `sliceManifest` as a **required** argument. A sixth file was touched: `surfaces/fabric.ts`'s
> inherited-limit paragraph, which stated a claim this change falsified. The reading and its
> plants are in `REQUIREMENTS.md`'s `EGR-01` row; audit finding `G13` is re-closed with it.

**Decider: owner.** Minted as a requirement id by this plan rather than logged for a fourth
time — see `EGR-01` in `.planning/REQUIREMENTS.md`, both the checkbox and the traceability row.

**What is open.** `egressLines` in `packages/browser/demo/render.ts` emits, verbatim:

```
0 withheld — and this run registered no sovereign data, so that is the
guard reporting it had nothing to hold back, not a proof of sovereignty.
```

That sentence is **true of what the egress guard observed and false of what the run
submitted**, and `EgressManifest` carries no field that would let the function tell the two
apart. The project's own rule one property over is that a bare withheld count *"would read as
a sovereignty proof and would be a lie by omission"*; this is that failure with the sentence
attached, on the surface that carries the project's core claim.

**What was measured.** Plan 27-07 read it off the screen after a bring-your-own dispatch that
**submitted six owner-pinned shards**, and measured why the guard saw nothing — two layers,
both on screen: `attestedNodes` hardcodes `ownerId: 'public'` on every descriptor, so any other
owner id is correctly **unplaceable** (0 frames, 0 bytes); and the placed arm is refused at
authorization before the shard's canonical bytes reach a peer. Plan 27-08 found the sentence
has a **fifth** renderer, F11 on the fabric-state surface, which renders the last run's
manifest whichever surface produced it.

**What it would cost to close — five files in one commit, and the note that stood before today
was wrong about one of them.** `deferred-items.md` said to count *where the guard registers a
sovereign CID*. Measured against the source on 2026-08-10, that is the wrong place:
`EgressGuard.guard()` appends no `EgressEntry`, `submitJobWithEgress` gives every hold back in
a `finally`, and `sliceManifest` recomputes the whole manifest from `entries` alone — so a
figure read off the guard after a job is either zero or a session-lifetime total, and the tab
reads a **sliced** manifest. The count has to be taken in `submitJobWithEgress`, which is the
only code that knows the sovereign shard set, and carried through `sliceManifest` as a per-job
delta the way `totalBytes` already is.

| file | change |
|---|---|
| `packages/net/src/egress.ts` | a `registered` field on `EgressManifest`, and its value on the guard's own getter |
| `packages/net/src/submit-with-egress.ts` | the per-job count, and its delta in `sliceManifest` |
| `packages/browser/demo/render.ts` | a third arm in `egressLines` |
| `packages/node/src/demo-region-properties.ts` | `EGRESS_SENTENCES`, which asserts the present words exactly |
| `UI-SPEC.md` section 5.2 | the fixed copy, which cannot be amended from inside a surface |

**Four specs re-read in the same pass**, because five surfaces render this sentence:
`packages/node/src/demo-byo.e2e.test.ts`, `packages/node/src/demo-pi.e2e.test.ts`,
`packages/node/src/demo-fabric.e2e.test.ts`, `packages/node/src/demo-liveness.e2e.test.ts`.

**What blocks it.** A new field on a type in `@o2/net` is a Rule 4 architectural boundary, and
UI-SPEC section 5.2's wording is the copywriting contract whose sign-off (section 12) is still
`pending`. Three plans in a row declined to fork the sentence for the right reason — five
surfaces render it from one function, and a sixth author of the sovereignty sentence is exactly
what the one-region-one-function rule exists to stop. **The disposition this plan took is (a):
file it first-class with an id, not (b): fix it here.** The reason is not scheduling — it is
that the fix as previously written would have shipped a `registered` count reading zero on the
very run that motivated it, and a wrong sovereignty figure is worse than a caveated one.

---

## 3. The page driver is not type-checked

**Decider: developer.**

**What is open.** `packages/browser/demo/index.html` carries an inline module script of roughly
four hundred lines — every event handler, every `window.o2` call, `publishReceipt`, the whole
`refreshFabric` pass — and `npx tsc --noEmit` does not see one line of it. Every module this
phase added is typed: `surfaces/colouring.ts`, `pi.ts`, `primes.ts`, `byo.ts`, `fabric.ts`,
`bench.ts`, `render.ts`, `nav.ts`, `src/demo-regions.ts`. The driver that calls them is not.

**What was measured.** Nothing failed on account of it during this phase, and that is the
honest reading — the e2e specs drive the real page, so a type error there surfaces as a
`pageerror` rather than as a silent wrong value. What is unmeasured is how many errors the
script would produce on first compile.

**What it would cost.** Move it to `packages/browser/demo/page.ts` and import it from a
one-line `<script type="module" src="./page.ts">`. Mechanical; the cost is the type errors an
untyped four-hundred-line script produces on first compile, which nobody has counted.

**What blocks it.** Nothing structural. `built-bundle.e2e.test.ts` already proves `vite build`
resolves relative imports out of the inline script, so the packaging half is known to work.

---

## 4. The `byBrowser` row count is unbounded at the wire

**Decider: owner.** Threat `T-27-30`, disposition **accept**, recorded rather than implied.

**What is open.** `parseCounts` bounds each entry's magnitude and validates each label, and
bounds **no array length**. The fabric-state surface renders one row per browser family from
that list.

**What was measured.** 43.90 bytes a row against NET-08's 8 MiB inbound ceiling — a crossover
at **191 099 rows**. Phase 27 accepted the exposure and did not create it; the surface renders
the rows inside a `.scroller`.

**What it would cost.** A length bound on `parseCounts`, plus a decision about what a node does
with a list it truncates — a truncated ledger reading that does not say it was truncated is the
class of quiet default this project keeps removing.

**What blocks it.** The bound is a wire-contract number, not a rendering one. It belongs to
whoever owns NET-08's ceilings.

---

## 5. A dark map of the eight base custom properties

**Decider: developer.** UI-SPEC section 1.5 names it as a follow-up in its own words.

**What is open.** One palette ships, `:root { color-scheme: light }`, and the page's previous
`light dark` plus `Canvas`/`CanvasText` in the bar is gone.

**What was measured.** The seven asserted contrast pairs in `demo-viewport.e2e.test.ts`, all
light-mode, all clearing their floor; and the finding that UI-SPEC section 7.2's **predictions
are optimistic on three of five rows**, so a future pair predicted just over 4.5:1 must not be
trusted without measurement.

**What it would cost.** Eight custom properties in a `prefers-color-scheme: dark` block, plus
an eighth-to-fifteenth pair in the contrast block so the dark map is measured rather than
declared.

**What blocks it.** UI-SPEC's own reason, quoted: *"a half-ported dark mode is how the bar's
ground and its Stop control end up at an unmeasured contrast ratio."* Half of this is worse
than none of it.

---

## 6. UI-SPEC section 12's checker sign-off is `pending` — **PASS RUN 2026-08-20, 4 of 6 signed**

> **The pass this entry says nobody had run has been run.** Readings and attribution:
> [`27-CHECKER-2026-08-20.md`](./27-CHECKER-2026-08-20.md). Measured on the live page — real dev
> server, Chromium, consent pressed, computed styles and composited contrast off the DOM, widths on
> fresh loads at each width rather than a resize.
>
> **Signed off: 1 Copywriting, 2 Visuals, 3 Colour, 6 Registry safety.** The headline readings are
> 74 rendered absences with **0** containing a digit; **73 text runs, 0 contrast failures**;
> `--color-accent` used as a text colour on **0** runs; every §1.2 property exact; **0 external
> network requests**.
>
> **Still open, and they are one question asked twice: 4 Typography and 5 Spacing.** This contract
> specifies a fixed-px scale; the page ships an em-relative one off a 15px body. Neither is a
> rendering defect — nothing fails contrast and no geometry assertion breaks. **Decider: owner**, as
> this entry already said. What has changed is that *"nobody has run it"* is no longer the blocker,
> and the entry's own warning about closing by attrition is why it was run.
>
> **The entry below is kept unedited**, including its "What blocks it" line, which was true until
> today.


**Decider: the orchestrator's design checker, then the owner.**

**What is open.** Six dimensions, five of them unchecked boxes: Copywriting, Visuals, Colour,
Typography, Spacing. Dimension 6 (registry safety) is recorded as not applicable with its
reason. **Approval: pending.**

**What was measured.** Dimension 3 is the one with real readings behind it — seven contrast
pairs measured on the rendered page and composited on a canvas, plus the *no accent below 24px*
scan reporting zero offenders. The other four have shipped implementations and no sign-off.

**What it would cost.** One checker pass over the built page. Nothing has to change for the
pass to happen.

**What blocks it.** Nobody has run it. That is the whole of it, and it is why this entry
exists — a `pending` box at the bottom of a 949-line contract is exactly the thing that closes
by attrition.

---

## 7. UI-SPEC corrections this phase owes and did not make

**Decider: developer, for all of them.** Nine, accumulated across seven plans. Every one is a
place where the contract and the shipped page disagree and **the page is right** — which is
why they are corrections to the document rather than defects in the tree. Each has its full
write-up in `deferred-items.md`; the cost of every one is one edit to `UI-SPEC.md`.

| § | What the contract says | What was measured |
|---|---|---|
| 3 | the catalogue lives at `packages/browser/demo/regions.ts` | `demo/` is outside every vitest project's include glob, so a catalogue there could not be imported by the guard at all; it lives at `packages/browser/src/demo-regions.ts` |
| 4.4 | the shard-partials absence has copy, no row and no place in the tally of 14 | adding it would make the surface 15 and the catalogue 92 against a count the document states about itself and the guard checks |
| 4.4 | the reduce diagram *"may render `treeDepth` rows"*, each labelled `map` / `lvl 1` / … | the two cannot both hold: `ReduceTree.depth` counts combine layers **above** the leaves, so `map` plus one row per layer is `depth + 1`. Measured at `treeDepth=2 combines=4` over twelve leaves |
| 4.5 | Y4's `-1` renders as `no agreement` | measured twice — `partitionOf` returns `-1` for **two** situations, and on a real dispatch `partitions=[-1,-1,-1,-1,-1,-1]` with **six of six shards agreeing**. Y7 likewise names no unavailable arm for the nothing-agreed case |
| 4.6 | F17's isolation booleans are *"always readable — three booleans, no node needed"* | taken literally that **fails P3**, measured under a plant: two specs red on the same line. Stopped wins, and the page therefore does not take the reading while stopped |
| 4.7 | a provenance line whose wording is fixed | it does not match the committed document's own header sentence, in punctuation and entirely in the second clause. UI-SPEC's ships; the disagreement is reported, not reconciled |
| 6.2 | `min-width: 0` is load-bearing and its removal must turn 6.3 red | **falsified across three plant arms** — not one box moved. A grid item's automatic minimum is content-based only when the track's min sizing function is `auto`, and `minmax(0, 1fr)` fixes it at 0. The proof that does hold is `white-space: nowrap`, which reddens B2c at 320, 360 and 393 |
| 6.3 | B5 is about `#main`'s last element child | `#measurements`, the footer carrying the perf link, is a **sibling** of `#main`, so B5 is silent about it in both the old and the fixed form. 27-01 measured the footer under the bar by ~41px at all three narrow widths with B5 green throughout |
| 7.2 | five predicted contrast ratios | three are optimistic (14.79 against 15.9, 5.83 against 6.28, 12.56 against 14.6 — all still clearing their floor), and the table carries no row for `--color-bg` on `--color-accent`, which measures **3.71:1** and fails at 14px |
| 9 | P3 compares a region's text against its own `data-absence` | **measured passing under a plant the catalogue-sourced form caught**: four regions examined, zero violations, exit 0, against four violations at exit 1 |

Two more cells the contract simply does not fill, each of which forced a composed sentence
marked `COMPOSED` in the source: C15/C17's unavailable arms on the colouring surface, and P7's
not-attempted plus P9's two zero-valued arms on π. Adopting the composed sentences is the
cheapest close.

---

## 8. Guard-coverage gaps

**Decider: developer, for all of them.** Each is a place where a property is narrower than it
reads. None is a defect in the tree; all are defects in what the tree can notice.

| gap | measured | cost to close |
|---|---|---|
| **P5b's exempt set is unbounded and unreported.** A region whose catalogue entry holds no `unavailable` arm is exempt from P5b, because there is no other sentence to render | recorded as 2 by 27-04, recounted at 15 by 27-05, at **24** by 27-07 — and 27-08 found the honest figure is larger still: **sixteen more** on the fabric surface, which P5 never sees | one committed list in `demo-liveness.e2e.test.ts`, started at 24, so a set that grows reddens and has to be explained |
| **P5 reports its skip list and asserts nothing about it.** A driven surface that lost its run control to a refactor would move from `exercised` to `skipped` with the run still green | `[P5] skipped … session, primes, fabric, bench, bar`, printed and unasserted; `[P5] 37 of 39` and `[P6] examined 5` both **moved under a plant and neither was asserted** | a committed expectation of which surfaces must be exercised and which must be skipped, plus a floor on `[P5] N of M` |
| **A whole surface is outside P5, P6, P7 and P8.** `demo-liveness.e2e.test.ts` collects regions only from panels it drove, and fabric state offers no run control by design | measured before and after 27-08, unedited harness: skipped list grew, every examined count unchanged | the same committed expectation as the row above |
| **The bar's three regions are declared and nothing checks their elements.** P1b runs on a page with no node, where `#bar` is absent and all three are skipped | `[P1b] examined 99 → 102 of 105`; the jump is three, contributed entirely by `bench` | one case in `demo-liveness.e2e.test.ts` — the only spec with a page where `#bar` is visible — asserting every wired catalogue entry resolves to exactly one element |
| **Five status elements carry digits P2 cannot see.** `#run-status`, `#pi-status`, `#byo-status`, `#byo-validity`, `#duty-status` sit inside `#main`, carry no `data-region`, and P2 runs on the stopped page | `#run-status` reads `settled n = 500` after a run; `#duty-status` **must** carry a digit, because it quotes the governor's `dutyCycle must be in (0, 1], got 0` verbatim | P2 run on a populated page with a stated exemption list, plus an entry saying a quoted refusal may carry a figure the fabric put in it |
| **`.citation` and `.refusal` have no contrast-ratio assertion.** The negative half of `.citation` **is** now held — `demo-bench.e2e.test.ts` asserts both cited regions compute to `--color-neutral-700` and to a different colour from a live reading | the ratio itself is argued from the table header's measured 5.87:1 at a *smaller* size, not measured at 13px | an eighth and ninth pair in `demo-viewport.e2e.test.ts`'s contrast list |
| **P9 is a subset check.** A figure in the committed document the surface fails to render is invisible to it | 181 figure strings extracted, floor **171** derived from the document's own four table shapes — which holds the direction by count, not by identity | an identity-level comparison, or an accepted statement that the floor is the answer |

---

## 9. Surface and fixture limits

**Decider: developer, except where marked.**

| limit | measured | cost to close |
|---|---|---|
| **Only Chromium.** Every `e2e` spec launches chromium alone | the project's limit, not any one file's; the `browser` project does run three engines | a second engine in the `e2e` project's launch list, and whatever that reddens |
| **The roadmap's 500px iPhone reading is not reproducible here.** It depends on iOS Safari's shrink-to-fit | headless Chromium at a pinned viewport does not widen: `documentElement.scrollWidth` equalled `innerWidth` **exactly** at all five widths. Desktop WebKit does not implement it either | a real-device or BrowserStack leg, which this repository has no harness for. **Decider: owner** |
| **Three composed sentences have never rendered in a browser.** `colouring/attestation` and `colouring/egress` in the settled-nothing arm; `pi/combines` in two arms | reached only by `colouring-surface.node.test.ts` and `pi-surface.node.test.ts`, in a unit context | a fixture that settles no rung, and one whose reduce is attempted and combines nothing |
| **The start-outcome cliff was not produced by the fixture.** F18's `Asked, and no peer answered.` | a two-tab fixture on a healthy relay always has a peer that answers; observed `1 of 1 peer asked answered`. The branch is asserted by a direct render call and the compromise is named in the spec | a fixture with a peer that is asked and does not answer |
| **`egressLines`' withheld branch has never fired**, and now for a measured reason rather than for want of a caller | `[sovereign·unowned]` 0 frames / 0 bytes; `[sovereign·placed]` 12 frames / 6276 bytes / **0 violations** — the dispatch RPC left and the shard's canonical bytes did not | a tab that can be handed a real owner identity, which `TabApi.start` deliberately has no parameter for. **Decider: owner** |
| **`addresses().webrtc` reports one address twice, and F21 renders it twice** | the two-tab fixture's tab reported three dialable addresses, two byte-identical. The duplicate is in `BrowserNode.webrtcAddrs`, not in the formatter | either `BrowserNode` de-duplicating what it advertises — which also changes what peers are told — or a stated decision in UI-SPEC section 4.6 that F21 shows the advertised set as advertised. **Decider: owner** |
| **`session/relay`'s unavailable arm is unreachable.** A page with no relay cannot start a node, so the stopped-wins rule paints the stopped sentence instead | the arm is in the catalogue, is digit-free, ends in a full stop, and nothing renders it | UI-SPEC dropping H3's unavailable arm, or a state in which a node outlives its relay discovery |
| **`./perf/` with a trailing slash resolves in dev and 404s on the harness's dumb static server** | the page links `./perf/index.html`, which resolves on both, so nothing on screen depends on the difference | nothing, unless a hand-typed `/perf/` against `dist/` is judged to matter |
| **The two-tab dial fix was not bisected.** Two changes were made together and one green followed | stated in 27-05 rather than attributed to whichever change sounded more likely | one run per change |
| **Two diagnostic pairs were dropped from the session header** — `relay source` and `secure context` | neither is among UI-SPEC section 4.0's five regions and no spec reads `#facts` | a sixth session region, if the secure-context reading is judged worth declaring |
| **`.planning/STATE.md` is stale about this phase.** Plans 27-05 through 27-10 each recorded that they did not touch it | its `stopped_at` is a sixty-line YAML block scalar under `packages/node/src/state-frontmatter.node.test.ts`'s parseability guard, and seven `gsd-sdk query state.*` verbs are measured to corrupt the file while reporting success | a hand edit to the position and `stopped_at` fields, made with the frontmatter guard run before and after. **Decider: owner**, because the corrupting verbs are the normal path and taking the hand path is a standing exception rather than a one-off |
| **The full `--project node` suite was red for the whole phase and no wave ran it.** Fixed by Plan 27-10; the process that allowed it is not | `trust-anchors.node.test.ts` is not one of the seven cheap guards the pre-commit hook runs, and every wave verified with targeted spec paths. Red from `d7a20f0` (Plan 27-01, the first commit) to `ce638ba` — nine waves | either the full suite in a phase's closing wave as a stated obligation, or that file added to the cheap-guard set — it runs in about a second. **Decider: owner** |

---

## 10. What closed while this phase ran

Recorded so this file is not read as a list of live gaps that quietly includes dead ones. Each
was an open item in `deferred-items.md` and is not any more.

| item | closed by | how |
|---|---|---|
| **B5 measured a hidden box on 50 of 60 combinations** | 27-09 | B5 now takes the last child of `#main` **with a client rect**. `grep -c "bottom=0.00"`: 50 before, 0 after |
| **P8 compared one surface's receipt against another's hook** | 27-08 | a per-surface hook, `window.__o2LastAttestation.bySurface`, with a flat fallback and no edit to either harness |
| **The Benchmarks lede quoted a planning identifier on a visitor-facing page** | 27-09 | the lede is now `bench/prose-provenance`, carrying UI-SPEC section 4.7's dated provenance line |
| **`./perf/` resolved nowhere** | 27-09 | one committed source, emitted into the bundle and served in dev by the same Vite plugin; the build fails by name when the source is absent |
| **P5 could not click a control on a surface that was not the page's default** | 27-05 | P5 presses the tab and waits for the panel before driving it |
| **The v1.1 audit's G4 row reported two halves as one** | 27-10 | the `G4 **split**` row, and the correction to *"Phase 27 addresses G4's remaining half"* |
| **The MR-03…MR-07 rows called the demo's colouring merge unwired residue** | 27-10 | the rows now distinguish the aggregation merge from the first-found-wins scan, and each states what no surface exercises |

---

## 11. One ledger decision this plan deliberately did not take

**MR-03's checkbox. Decider: owner.**

`MR-03` reads *"Partials merge up a hierarchical tree via an associative, commutative
combine"*, and it has been `[ ]` **Partial** since Phase 16 on a clause that Phase 27 made
false: *"the demo still merges with a linear scan."* The demo's aggregation workload now merges
through `reduceJob`, a person can press the control, and `demo-pi.e2e.test.ts` reads `depth 2`
over twelve leaves and `4` combines off the screen. On this repository's stated convention —
`[x]` iff reachable from a runnable entry point — the row is arguably closeable, and it is the
**only** one of the five that is: MR-04's identical-tree-across-participants, MR-05's rendezvous
ranking, MR-06's churn recompute and MR-07's duplicate discard are each exercised by process-level
specs and by no page button.

**Why the plan did not tick it.** Two reasons, and the second is the substantive one.

1. **Cost.** Ticking it is not one edit. It is the checkbox, the traceability verdict, four
   header counts the ledger states about itself and `requirements-ledger.node.test.ts` parses
   back out (`45 of 72`, `27 now unchecked`, `1 + 25 + 1`, and the marker split), and the
   removal of `MR-03` from `WITHOUT_A_CHECKABLE_CLAIM` in that guard — a source file outside
   this plan's `files_modified`.
2. **The clause.** No surface demonstrates the **commutative** half: the demo runs one combine
   order, once. And `MR-02` — the map half of the same family — is still *Built, not wired*, so
   every partial this tree merges is over a range the page generated rather than over an owner's
   own data, which is the property the MR family exists for.

*Descoped is not satisfied; unmeasured is not met.* The row's sentence is now true and its box is
still off, and which of those to change is the owner's call rather than the reconciliation wave's.
