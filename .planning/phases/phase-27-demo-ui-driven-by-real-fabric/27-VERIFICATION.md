---
phase: 27-demo-ui-driven-by-real-fabric
verified: 2026-08-10T20:20:00Z
status: gaps_found
score: 10/12 must-haves verified
overrides_applied: 0
gaps:
  - truth: "The demo page shows every workload the fabric can already run — Primes included"
    status: failed
    reason: >-
      Primes ships as a SURFACE and not as a WORKLOAD. `#s-primes` carries zero buttons of any
      class (measured), eight of its twelve figure regions carry `permanentlyUnavailable`, and
      the five primes symbols have zero production callers (re-measured live by this verifier:
      `[G4·primes] 17 match(es) of 5 symbols across 5 file(s) … 11 code-line match(es) in 2
      file(s) … production callers: 0`). The phase says so itself and the roadmap applies
      *descoped is not satisfied* to it in full. This gap is DECLARED, not hidden — four
      mechanisms hold it open and all four were verified — but the goal's own wording is not
      met and widening what counts as passing is what this ledger exists to refuse.
    artifacts:
      - path: "packages/browser/demo/index.html"
        issue: "`#s-primes` (line 425) has 0 `<button>` elements; nothing on the surface runs"
      - path: "packages/demo/src/primes.ts"
        issue: "`buildPrimesInput`, `primesKernelBytes`, `projectPrimeCount`, `readPrimeCount`, `PRIME_COUNT_KEY` — 0 production callers"
    missing:
      - "Option A, and it is an OWNER decision rather than a wiring job: extend `scripts/sign-kernel.ts` to sign `primes.wasm`, regenerate `packages/demo/src/kernel-record.ts` under a NEW `KERNEL_TRUST_ANCHOR` (the script discards its private half, so the existing records cannot be extended), add `TabApi.runPrimes` mirroring `runPi`. It changes what a stock `o2 agent` and a stock `o2 seed` will run."
      - "Replan of the Primes surface the moment Option A lands — `demo-primes.e2e.test.ts` is written to FAIL on that day, by design."
  - truth: >-
      The egress reading never says something weaker than it appears to say — the roadmap names
      this as one of two places the phase's load-bearing rule must hold
    status: partial
    reason: >-
      OBSERVED LIVE by this verifier, not read out of a summary. On the `[sovereign·placed]` arm
      of `demo-byo.e2e.test.ts`, `byo/sovereign-label` reads *sovereign — every shard was
      submitted owner-pinned to public* and, in the same render pass, `byo/egress` reads
      *0 withheld — and this run registered no sovereign data, so that is the guard reporting it
      had nothing to hold back, not a proof of sovereignty.* Both sentences are on screen at
      once and the second is false of the run that produced the first. The mechanism the roadmap
      demanded (the count and its sentence as ONE region and ONE function, P7) is present and
      guarded; the SENTENCE is wrong in that arm. Minted as `EGR-01`, `[ ]` Not started, decider
      owner — so the phase named it rather than shipping past it.
    artifacts:
      - path: "packages/browser/demo/render.ts"
        issue: "`egressLines` has two arms and needs a third; five surfaces render it"
      - path: "packages/net/src/submit-with-egress.ts"
        issue: "the sovereign-shard count is knowable only here and is not carried through `sliceManifest`"
    missing:
      - "The five-file change named verbatim in the `EGR-01` row: `packages/net/src/egress.ts`, `packages/net/src/submit-with-egress.ts`, `packages/browser/demo/render.ts`, `packages/node/src/demo-region-properties.ts` (`EGRESS_SENTENCES`), UI-SPEC §5.2"
      - "Owner sign-off, because it adds a field to an `@o2/net` type and rewrites the fixed copy for the one sentence carrying the sovereignty claim"
human_verification:
  - test: "Decide Option A for the Primes workload (a third signed kernel record under a new trust anchor)"
    expected: "Either Option A is scheduled, or Option B — the named absence — is accepted as the standing answer and the roadmap's *load-bearing surface* language is amended"
    why_human: "It changes what a stock `o2 agent` and a stock `o2 seed` will run. It touches the trust root; no agent may take it."
  - test: "Decide `EGR-01`"
    expected: "Either the five-file change lands, or the copywriting contract is amended to say the sentence is about the guard rather than about the run"
    why_human: "It changes a wire type in `@o2/net` and the fixed wording of the sovereignty claim"
  - test: "Decide MR-03's checkbox"
    expected: "Ticked with the commutative half named as unexercised, or left Partial"
    why_human: "Ticking cascades into four header counts, the traceability verdict and `WITHOUT_A_CHECKABLE_CLAIM` in `requirements-ledger.node.test.ts` — 27-OPEN-ITEMS §11 enumerates the cost and declines to take it"
  - test: "Visual/typographic conformance of the ported design against the mockup"
    expected: "UI-SPEC §12's six checker dimensions signed off"
    why_human: "`UI-SPEC.md` §12 reads **Approval: pending** with all six boxes `[ ]`. Appearance is not programmatically checkable beyond the seven measured contrast pairs."
---

# Phase 27: The Demo UI, Driven by the Real Fabric — Verification Report

**Phase Goal:** The demo page shows every workload the fabric can already run, in the imported
mockup's design, with every figure on screen produced by a live `TabApi` reading — so the gap
closes between what this project can do and what a visitor can see it do

**Verified:** 2026-08-10T20:20:00Z
**Status:** gaps_found — 10/12 verified, 1 failed, 1 partial
**Re-verification:** No — initial verification

## Method, and what it is bounded by

`ROADMAP.md` states no `Success Criteria` block for Phase 27 (`gsd-sdk query roadmap.get-phase 27`
returns `success_criteria: []`). Must-haves were therefore derived from the goal sentence, the
`must_haves.truths` of all ten PLAN frontmatters, and the seven directives this verification was
launched with. **No claim below is scored off a SUMMARY.** Every figure in this report is either
read out of the tree by this verifier or produced by a spec this verifier ran, with `EXIT=$?` on
the line immediately following the command and no pipe.

**Specs run by this verifier, file-scoped, exit codes read directly:**

| command | exit | result |
|---|---|---|
| `--project e2e demo-regions.e2e.test.ts` | **0** | `17 passed (17)` |
| `--project e2e demo-regions + demo-primes` | **0** | `28 passed (28)`, 14.77 s |
| `--project e2e demo-liveness.e2e.test.ts` | **0** | `6 passed (6)`, 11.35 s |
| `--project e2e demo-viewport.e2e.test.ts` | **0** | `7 passed (7)`, 7.70 s, 60 B5 readings |
| `--project e2e demo-pi + demo-byo + demo-fabric + demo-bench` | **0** | `46 passed (46)`, 27.16 s |
| `--project node requirements-ledger + acceptance-traceability` | **0** | `61 passed (61)` |
| `npx tsc --noEmit` | **0** | zero output lines |

**Two bounds, stated rather than left implicit.**

1. **No mutation was planted by this verifier.** `CLAUDE.md` states *"Agents that plant must not
   run in parallel on shared source"* and records the 2026-08-06 session in which two parallel
   planting verifiers manufactured a false security finding that cost 111 executions to refute.
   Two sibling verifiers are live in this tree. The executors' plant records are therefore
   **corroborated rather than reproduced**: what this verifier established independently is that
   the assertions the plants are claimed to have reddened exist, are reached, and carry non-zero
   floors — which is the property a plant demonstrates, arrived at from the other side.
2. **No project was run to completion**, by instruction. The e2e project's other 20 files were
   not run.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Six surfaces exist in the mockup's design as plain CSS — no framework, no CDN, no React, no remote font | ✓ VERIFIED | `demo.css` 28 567 B, `nav.ts` 6 972 B, six `role="tabpanel"` sections at `index.html:151/425/619/851/1143/1461`, six `role="tab"`. A grep for `unpkg`, `cdn`, `https://fonts`, `@import url`, `react`, `babel` over `demo.css` + `index.html` returns **one** hit and it is the prose *"no framework, no CDN, no build step"* |
| 2 | The activity bar fits and Stop is a 44×44 on-screen target at five widths in two bar states, guarded | ✓ VERIFIED | `demo-viewport.e2e.test.ts` exit **0**, 7 tests, **60** `[B5]` readings all `short=0.00`; `#bar` grid contract `minmax(0, 1fr) auto` present |
| 3 | The anti-placeholder guard landed BEFORE the screens it holds, and is not satisfiable by a page rendering nothing | ✓ VERIFIED (bounded) | Guard `ed1c992` **07:16:12**; first surface formatter `3dbbc35` **07:43:20** — 27 minutes, same day, ordering confirmed by commit timestamp not by narration. The complement exists and bites: P5a/P5b in `demo-liveness.e2e.test.ts`, plus `expect(exercised.length).toBeGreaterThanOrEqual(1)` and three `expect(examined).toBeGreaterThan(0)` floors. Live: `[P6] examined 5`, `[P7] examined 3`, `[P8] examined 2` — none vacuous. See the bound in §"P5's measured coverage" |
| 4 | Every figure on screen is a declared `reading`/`constant`/`cited` or a named absence; no undeclared number inside `#main` | ✓ VERIFIED (bounded) | `demo-regions.e2e.test.ts` P1a, P1b, P2, P3, P4a, P4b — exit **0**, `[P1b] examined 102 of 105 catalogue entries`. Catalogue self-checks assert 91 figure regions / 74 reading / 6 constant / 3 cited / 8 control against `UI_SPEC_TALLY`, and that no absence sentence contains a digit. Bound: P2 runs on the **stopped** page; five status elements (`#run-status`, `#pi-status`, `#byo-status`, `#byo-validity`, `#duty-status`) carry digits after a run that P2 cannot see — recorded, 27-OPEN-ITEMS §8 |
| 5 | Colouring, π and bring-your-own each have a run control and produce live readings on a real two-tab page | ✓ VERIFIED | `demo-liveness.e2e.test.ts` exit **0**: `[P5] exercised … colouring, pi, byo`, `[P5] 37 of 39 reading regions carry a reading after the run`, `settled n: 500`, `verification cost: 2.00×`, `verdict: Correct · triples 386`. Exactly one `.btn-primary` per driven surface, counted out of the markup: colouring 1 (`#run`), pi 1 (`#run-pi`), byo 1 (`#run-byo`) |
| 6 | Fabric state renders 21 live readings; Benchmarks renders cited figures checked verbatim against the committed document | ✓ VERIFIED | Catalogue: `fabric` = 21 `reading` + 2 `text-view`; `demo-fabric.e2e.test.ts` green. `[P9] 181 figure string(s) extracted from #s-bench, floor 171`, `by region: bench/prose-provenance=4, bench/speedup=58, bench/overhead=119`. `vite.config.ts` `perfReport()` emits `perf/index.html` from the one committed `docs/perf/prime-and-pi-benchmarks.html` and **fails the build by name** when it is absent |
| 7 | **The demo shows every workload the fabric can already run — Primes included** | ✗ **FAILED** | Primes ships as a surface, not a workload. `#s-primes`: **0 `<button>` elements of any class**, measured out of the markup. 8 of its 12 figure regions carry `permanentlyUnavailable`. Live: `[G4·primes] production callers: 0`. Declared, not hidden — see §"Primes" |
| 8 | Primes' openness is held mechanically by four independent mechanisms, not by a paragraph | ✓ VERIFIED | All four exist; three re-measured live by this verifier. See §"Primes" |
| 9 | G4 is split in the ledger the way it is split in fact, and no sentence reports the halves as one | ✓ VERIFIED | `v1.1-MILESTONE-AUDIT.md:187` `G4 **split**`; the one sentence that conflated them (*"Phase 27 addresses G4's remaining half"*) is corrected **in place** at :376-377 with the defect named. The `runJob` half is cited **by symbol**: `#byo-form`'s submit handler, confirmed at `index.html:2289` calling `window.o2.runJob({ moduleCid, moduleRecord, peerIds, shards, redundancy, includeSelf, …sovereign })` |
| 10 | MR-03…MR-07 stay Partial, each stating what no surface exercises; MR-03's non-tick is recorded with its reason | ✓ VERIFIED | All five rows `**Partial**` at `REQUIREMENTS.md:821-825`. MR-03's row names the unexercised half verbatim: *"What no surface shows is the **commutative** half — the demo runs one combine order, once"*. 27-OPEN-ITEMS §11 gives both reasons and enumerates the cost of ticking. Both ledger parsers green: `requirements-ledger` + `acceptance-traceability`, **61 passed**, exit 0 |
| 11 | `EGR-01` is a first-class ledger row with the fix named, not a log line | ✓ VERIFIED as a row / ⚠️ **PARTIAL** as rule compliance | Declaration `REQUIREMENTS.md:689` `[ ]`; traceability row :875 names **five files in one commit** and **four specs to re-read**, decider **owner**. But the defect it names is **live on screen today** — observed by this verifier, see §"EGR-01, observed" |
| 12 | The process finding — Phase 27 merged with `--project e2e` RED, no wave ran that project to completion — is recorded | ✓ VERIFIED | `deferred-items.md:872-990`, with a section headed *"The process finding, which matters as much as the fix"*, the merge commit quoted by subject (`5422f9e` — *"the suite nobody ran"*), the grep result (*a bare `--project e2e` with no file argument returns nothing in any of the ten summaries*), and the closing action named. Fix `dde1ff5` present; re-run green, 60/60 `short=0.00` |

**Score: 10/12 truths verified.** One FAILED (7), one PARTIAL (11).

---

## The crux: is the anti-placeholder guard real, or satisfiable by a page rendering nothing?

**It is real, and it is bounded — and the bound is the executors' own measurement, not a
discovery of this verification.**

The stopped-page guard is genuinely half a guard, and says so at the top of its own file:
*"P2, P3 and P4 are all satisfiable by a page that renders nothing."* Wave 4 turned that into a
number by planting `return { regions: {}, text }` at the end of `format` and watching
`demo-regions.e2e.test.ts` report **17 passed at exit 0** over a surface with nothing on it.
**This verifier reproduced the denominator**: `demo-regions.e2e.test.ts` alone is exactly
`Tests 17 passed (17)` on the unmutated tree. The plant record's arithmetic is consistent with
the tree as it stands.

P5 supplies the missing direction and it is not decorative:

- **P5a** — at least one `reading` region on a driven surface differs from *every* sentence its
  catalogue entry holds. Live: `37 of 39`.
- **P5b** — no `reading` region on a driven surface still equals its `initial` or `stopped`
  sentence.
- **Three floors that make vacuity itself a failure**: `exercised.length >= 1`, and
  `examined > 0` on each of P6, P7, P8. Live: `5 / 3 / 2`.
- **Expectations come from the committed catalogue**, imported across packages
  (`../../browser/src/demo-regions.ts`), never from the element's own `data-absence` — which is
  the arrangement that makes P3 a measurement rather than a restatement. Confirmed in source at
  `demo-regions.e2e.test.ts:397-409` and `demo-region-properties.ts:126-129`.
- **P6/P7/P8 have one implementation and two harnesses** (`demo-region-properties.ts`), so the
  stopped page and the populated page cannot come to check different things. This is real and
  is the right shape.

### P5's measured coverage — recorded, not buried

The orchestrator's second directive asked whether these limits are recorded. **They are, four
times in the long form and once consolidated with a decider**, and this verifier re-derived every
figure from the committed catalogue rather than reading them back:

| claim | recorded at | this verifier's independent measurement |
|---|---|---|
| P5b exempts any reading whose catalogue entry holds no `unavailable` arm | `demo-liveness.e2e.test.ts:74-79` (source), `deferred-items.md:291` | mechanism confirmed at `demo-liveness.e2e.test.ts:415` — `if (region.absence.unavailable === undefined) continue` |
| the exempt set is **24** across the three driven surfaces | `deferred-items.md:386` (15), `:581` (24), `27-OPEN-ITEMS.md` §8 | **24** — colouring 8, pi 7, byo 9, enumerated by id from `REGIONS` |
| the whole 21-reading fabric surface is outside P5a/P5b/P6/P7/P8, and **16** of them have no `unavailable` arm | `deferred-items.md:680` | **16**, enumerated by id. Live confirmation: `[P5] skipped … session, primes, fabric, bench, bar` |
| the skip list is **reported, not asserted** | `deferred-items.md:466`, `27-OPEN-ITEMS.md` §8 row 2 | confirmed in source: `skipped` is written to `process.stderr` at `demo-liveness.e2e.test.ts:282-286` and appears in **no** `expect` |
| `[P5] N of M` and `[P6] examined` both moved under a plant and neither was asserted | `deferred-items.md:581` | confirmed: no assertion references either count; the live values `37 of 39` and `5` are printed only |

**Verdict on directive 2: recorded, and recorded better than most phases record what works.**
27-OPEN-ITEMS §8 is a seven-row table, each row carrying *what is open / what was measured / what
it would cost*, all under a named decider.

**One thing the tree still says that is false, and it is in the source rather than in the
planning files.** `demo-liveness.e2e.test.ts:77-79` still reads *"Two colouring regions are in
that position — C15 and C17."* Counted from the committed catalogue on 2026-08-10, **eight**
colouring readings are in that position (`rung-300`, `rung-400`, `rung-500`, `attestation`,
`egress`, `verify-verdict`, `verify-n`, `verify-triples`). `deferred-items.md:386` corrected the
figure on 2026-08-05 and the docblock was not updated with it. *A comment is not a
specification* — and here the comment understates the guard's own blind spot by a factor of
four, in the one file a reader would open to find out how large that blind spot is. **WARNING.**

---

## Primes — is it honestly OPEN?

**Yes, and this is the strongest part of the phase's bookkeeping.** All four mechanisms exist;
three were executed by this verifier rather than read.

| # | mechanism | verified how |
|---|---|---|
| 1 | **P4b, inverted.** Every `permanentlyUnavailable` reading must name a method `window.o2` does **not** have | Source `demo-regions.e2e.test.ts:440-472`, **two** arms — one over the catalogue (so it is not vacuous while a surface is unwired) and one over the live elements. Ran green. 8 primes readings carry `permanentlyUnavailable`, all naming `TabApi.runPrimes(…)` |
| 2 | **The five-symbol grep**, re-run on every test run | **Executed:** `[G4·primes] 17 match(es) of 5 symbols across 5 file(s) … 11 code-line match(es) in 2 file(s): packages/demo/src/index.ts, packages/demo/src/primes.ts … production callers: 0`. **Byte-identical to the figure the roadmap and the audit both quote.** The spec asserts the *file set*, not the count, so prose drift cannot silently close it |
| 3 | **Criterion 5 `(OPEN)`** | `27-06-PLAN.md:307-315`, under a heading that reads *"OPEN — not satisfied, and deliberately recorded as such"*, quoting *"Descoped is not satisfied; unmeasured is not met"* |
| 4 | **The G4 split** | `v1.1-MILESTONE-AUDIT.md:187`, with the primes half's Option A costed to the trust root and marked unowned, and `git status --porcelain packages/demo/src/kernel-record.ts scripts/sign-kernel.ts` recorded as empty before and after every plant |

**Nothing in the tree counts Primes as delivered.** Checked in every place a reader would look:
the ROADMAP's plan list annotates 27-06 *"(the workload itself is OPEN)"*; the ROADMAP disposition
paragraph states it at length; `DEMO-02`'s ledger row calls it *"a **named absence**"*; the audit's
entry-point table says *"Primes is still unreachable from this page (G4's open half)"*;
27-OPEN-ITEMS item 1 is first in the file and is written at length for that reason.

**And yet truth 7 is FAILED, and that is not a contradiction.** The phase's disclosure is
excellent and the goal's wording is still unmet: *shows every workload the fabric can already
run*. The roadmap says so in its own voice — *"The roadmap calls Primes one of two load-bearing
surfaces and this phase did not make it run anything, so descoped is not satisfied applies to it
in full."* Scoring it VERIFIED would be widening what counts as passing, which is the one move
this repository's conventions name explicitly.

---

## `EGR-01`, observed rather than cited

The directive asked whether `EGR-01` is a first-class ledger row with the fix named, or merely a
log line. **It is a row, and the defect is live.** From this verifier's own run of
`demo-byo.e2e.test.ts`, one arm, two regions rendered in the same pass:

```
[sovereign·placed] byo/sovereign-label = sovereign — every shard was submitted owner-pinned to public.
[sovereign·placed] byo/egress = What left this device:
  12 frames sent, 6276 byte(s) total.
  0 withheld — and this run registered no sovereign data, so that is the
  guard reporting it had nothing to hold back, not a proof of sovereignty.
```

The run submitted six owner-pinned sovereign shards. The egress sentence says it registered
none. The sentence is true of the **guard** — the shards were refused at authorization before
their canonical bytes crossed — and false of the **run**, and the page gives a reader no way to
tell those apart. The roadmap names this exact sentence as one of the two places the phase's
load-bearing rule must hold.

What the ledger does with it is right: `REQUIREMENTS.md:689` declares `EGR-01` `[ ]`, and :875
names **five files in one commit** (`packages/net/src/egress.ts`,
`packages/net/src/submit-with-egress.ts`, `packages/browser/demo/render.ts`,
`packages/node/src/demo-region-properties.ts`, UI-SPEC §5.2), **four specs to re-read**, and
decider **owner** — plus a correction of the earlier deferred note, which had put the count in
the wrong place (`EgressGuard.guard()` appends no `EgressEntry`). That is a fix specified to the
file, not a wish.

**It is PARTIAL rather than VERIFIED because the row is the mitigation and not the fix**, and the
mechanism the roadmap demanded — count and sentence as one region, one function, guarded by P7 —
is present while the sentence it emits is wrong in one reachable arm.

---

## Anything overstated

Three, in descending order of consequence.

**1. *"Five surfaces now carry live readings driven through the page's own controls."***
ROADMAP Phase 27 Requirements line, echoed in `DEMO-01`'s ledger row. Measured against the
catalogue and the markup:

| surface | reading regions | primary run control |
|---|---|---|
| colouring | 16 | `#run` |
| pi | 12 | `#run-pi` |
| byo | 11 | `#run-byo` |
| fabric | 21 | **none** — secondary `#refresh-report` and a 1 s reconciler; P5 skips it by name |
| bench | **0** | **none** — its three regions are 2 `cited` + 1 `prose` |

So **three** surfaces carry live readings driven through a run control; a fourth carries live
readings driven by a reconciler; the fifth carries **no live readings at all**. `DEMO-01`'s row
does disclose the fifth in its own enumeration (*"a cited benchmark transcription"*), which keeps
it from being a false row — but the lead clause, and the ROADMAP line that has no such
enumeration, both overstate. **WARNING, wording.**

**2. `demo-liveness.e2e.test.ts:77-79` — *"Two colouring regions … C15 and C17."*** Eight, on
the current catalogue; corrected in `deferred-items.md` on 2026-08-05 and not in the file. The
understatement sits in the docblock of the property whose blind spot it describes. **WARNING.**

**3. `STATE.md:1134` still says Phase 27 *"Closes the demo half of MR-03…MR-07 … and audit
finding G4."*** Both clauses are now known false — all five MR rows stay Partial, and G4 closed
one of two halves. 27-OPEN-ITEMS §9 records *"`.planning/STATE.md` is stale about this phase"*
with its reason (seven `gsd-sdk query state.*` verbs measured to corrupt the file while reporting
success) and its decider, so the staleness is disclosed — but this **specific** false claim is not
named, and it is the sentence a reader greps. **WARNING.**

*Not* overstated, though it looks like it: `v1.1-MILESTONE-AUDIT.md:188`'s *"two places only"*.
The `G4 **split**` row directly above it says the arithmetic is stale, gives the five-file set,
and states why the row is left unedited (the spec is re-measured every run and the row is not).
A knowingly-stale figure carrying its own correction is not an overstatement.

---

## Anything the tree does not support

**Nothing.** Every load-bearing figure quoted in the ROADMAP entry and in the ten summaries that
this verification checked reproduced against the tree or against a live run:

| claim | source | reproduced |
|---|---|---|
| 17 matches / 5 symbols / 5 files, 11 code-line in 2 files, production callers 0 | ROADMAP + audit G4 | **exact**, live |
| `demo-regions.e2e.test.ts` = 17 tests (the plant-B denominator) | 27-04-SUMMARY | **exact** |
| `[P5] exercised … colouring, pi, byo`; skipped `session, primes, fabric, bench, bar` | 27-08 + 27-09 | **exact**, live |
| `[P5] 37 of 39`, `[P6] 5`, `[P7] 3`, `[P8] 2` | `deferred-items.md:680` table | **exact**, live |
| `[P1b] examined 102 of 105` | 27-OPEN-ITEMS §8 | **exact**, live |
| 181 figures, floor 171 | 27-09-SUMMARY | **exact**, live |
| 60 B5 combinations, all `short=0.00` after `dde1ff5` | `deferred-items.md:930` | **exact**, live |
| `#s-primes` carries zero buttons of any class | ROADMAP disposition | **exact**, counted out of the markup |
| 91 figure regions / 74 reading / 6 constant / 3 cited / 8 control | UI-SPEC §0 + catalogue self-check | **exact** |
| exempt set 24 on driven surfaces, +16 on fabric | `deferred-items.md:581/:680` | **exact**, recomputed from `REGIONS` |
| guard landed before the screens | ROADMAP wave 3 | **exact** — `ed1c992` 07:16 vs `3dbbc35` 07:43 |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/browser/src/demo-regions.ts` | the committed catalogue, importable by both page and guard | ✓ VERIFIED | 1 560 lines, 105 entries / 91 figure regions, `WIRED_SURFACES` all 8 |
| `packages/browser/demo/render.ts` | region writer, one-reading-one-render-pass, shared formatters | ✓ VERIFIED | 13 092 B; `textContent` only — **zero** `innerHTML` assignments across `render.ts`, all six surfaces, `nav.ts` and `demo-regions.ts` |
| `packages/browser/demo/surfaces/{colouring,pi,primes,byo,fabric,bench}.ts` | six pure formatters | ✓ VERIFIED | 11.8–22.9 KB each, all six present, all typed (`tsc` exit 0) |
| `packages/browser/demo/index.html` | the single page, six tabpanels, the drivers | ✓ VERIFIED (with a gap) | 154 KB, six `role="tabpanel"`. **Gap:** ~400 lines of inline module script are outside `tsc` — 27-OPEN-ITEMS §3, decider developer |
| `packages/browser/demo/demo.css`, `nav.ts` | ported design, hash-driven nav | ✓ VERIFIED | 28.5 KB / 7.0 KB, no CDN, no remote font |
| `packages/node/src/demo-region-properties.ts` | P6/P7/P8 as one implementation, two harnesses | ✓ VERIFIED | 262 lines, imported by both e2e files |
| `packages/node/src/demo-{regions,liveness,pi,primes,byo,fabric,bench,viewport}.e2e.test.ts` | eight specs | ✓ VERIFIED | all eight present, **all eight run green by this verifier** |
| `.planning/phases/…/UI-SPEC.md` | the interface contract | ✓ VERIFIED (unsigned) | 66 KB, 13 sections. §12 **Approval: pending**, six `[ ]` boxes |
| `.planning/phases/…/deferred-items.md` | the long form | ✓ VERIFIED | 59 KB, **38** entries |
| `.planning/phases/…/27-OPEN-ITEMS.md` | the register, each item with cost/blocker/decider | ✓ VERIFIED | 27 KB, 11 items, every one carrying a named decider |
| `.planning/v1.1-MILESTONE-AUDIT.md` | G4 split | ✓ VERIFIED | `G4 **split**` row at :187 plus the in-place correction at :376 |

---

## Key Link Verification

| From | To | Via | Status | Detail |
|---|---|---|---|---|
| `index.html` `#byo-form` | `window.o2.runJob` | submit handler | ✓ WIRED | `index.html:2289`; full argument object incl. `moduleRecord`, `includeSelf`, conditional `sovereign` |
| `index.html` `#run-pi` | `window.o2.runPi` | click handler | ✓ WIRED | driven live by P5 and by `demo-pi.e2e.test.ts` |
| `demo-regions.e2e.test.ts` | `browser/src/demo-regions.ts` | relative cross-package import | ✓ WIRED | expectations are the catalogue, never the DOM's own attributes |
| `demo-liveness.e2e.test.ts` | run controls | discovered from the DOM, tab pressed first | ✓ WIRED | `#nav-<surface>` click then `waitForSelector` visible — the 27-05 defect is fixed in the file |
| surfaces → `render.ts` | `applyRender` | one record, both views | ✓ WIRED | P6 enforces it: a populated figure must occur in its own surface's text view (`examined 5`) |
| attestation regions → `window.__o2LastAttestation` | P8 | per-surface map + flat fallback | ✓ WIRED | `publishReceipt('byo', …)` present; P8 `examined 2`, `hook present` |
| `vite.config.ts` | `docs/perf/prime-and-pi-benchmarks.html` | `perfReport()` plugin | ✓ WIRED | build fails **by name** when the committed source is absent |
| `demo-primes.e2e.test.ts` | `packages/demo/src/primes.ts` | the five-symbol grep | ✓ WIRED | asserts the **file set**, not the count |

---

## Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data? | Status |
|---|---|---|---|---|
| `surfaces/colouring.ts` | `TabColouringRun` | `window.o2.runColouring` | yes — `settled n: 500`, `2.00×`, `386` triples off the screen | ✓ FLOWING |
| `surfaces/pi.ts` | `TabPiRun` | `window.o2.runPi` → `reduceJob` | yes — `depth 2`, 4 combines, `3.141592320` | ✓ FLOWING |
| `surfaces/byo.ts` | `TabJobReport` | `window.o2.runJob` | yes — 18 provenance refusals verbatim, 12 frames / 6 276 B | ✓ FLOWING |
| `surfaces/fabric.ts` | 21 readings | `activity/capacity/governor/isolation/…` | yes — `demo-fabric.e2e.test.ts` asserts live values converge against a fresh `window.o2` read | ✓ FLOWING |
| `surfaces/primes.ts` | — | none by design | **no dispatch path** | ✓ NAMED ABSENCE (not a stub — 8 regions carry `permanentlyUnavailable` and P4b inverts on them) |
| `surfaces/bench.ts` | 181 cited figures | `docs/perf/prime-and-pi-benchmarks.md` | committed document, read off disk by P9 | ✓ CITED, provenance on screen |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| The anti-placeholder guard passes on the current tree | `vitest run --project e2e demo-regions` | exit 0, `17 passed` | ✓ PASS |
| Primes' openness is measured on every run | `vitest run --project e2e demo-primes` | exit 0, `production callers: 0` | ✓ PASS |
| P5 drives real run controls on a real two-tab page | `vitest run --project e2e demo-liveness` | exit 0, `exercised … colouring, pi, byo`, `37 of 39` | ✓ PASS |
| B5 no longer reads off the end of the page | `vitest run --project e2e demo-viewport` | exit 0, 60/60 `short=0.00` | ✓ PASS |
| π, byo, fabric and bench surfaces work | `vitest run --project e2e demo-pi demo-byo demo-fabric demo-bench` | exit 0, `46 passed` | ✓ PASS |
| Both ledger parsers read the amended rows | `vitest run --project node requirements-ledger acceptance-traceability` | exit 0, `61 passed` | ✓ PASS |
| The typed tree compiles | `npx tsc --noEmit` | exit 0, zero output | ✓ PASS |
| A planted placeholder reddens P5 | — | **not run** — `CLAUDE.md` forbids parallel planting agents; two siblings live | ? SKIP (bounded, see Method) |

---

## Requirements Coverage

| Requirement | Source plan | Status | Evidence |
|---|---|---|---|
| DEMO-01 | 27-01…09 | ✓ SATISFIED (`[x]`, widened) | five surfaces named in the row with their specs; two guards named. **Wording overstated — see §Anything overstated** |
| DEMO-02 | 27-03/04/06/10 | ✓ SATISFIED (`[x]`, widened) | three pressable workloads; the fourth explicitly a named absence |
| DEMO-03 | 27-02, 27-09 | ✓ SATISFIED | same-origin request set (P10), `./perf/` resolving from dev and from the bundle |
| BROW-01/02/03/04/05 | 27-02/07/08 | ✓ SATISFIED | consent has no test-only bypass (every harness clicks `#allow`); viewport guard; fabric readings |
| MR-03 | 27-05, 27-10 | ⚠️ PARTIAL, deliberately | tree merge on screen and pressable; **commutative half unexercised**; checkbox is an owner decision, cost enumerated |
| MR-04, MR-05, MR-06, MR-07 | 27-05, 27-10 | ⚠️ PARTIAL | each row states what no surface exercises |
| DET-03, DATA-08, WIRE-03 | 27-07 | ✓ SATISFIED | signed-record dispatch; unpinned key refused in the fabric's own words |
| DATA-05, DATA-06, VER-06/09/10 | 27-04/05/07/08 | ✓ SATISFIED | egress region + attestation region, P7/P8 non-vacuous |
| SCHED-04, NET-05 | 27-08 | ✓ SATISFIED | start-outcome cliff and `relayedOnly`/`stalled` surfaced |
| BENCH-01…05 | 27-09 | ✓ SATISFIED | 181 figures, each checked against the committed document |
| **EGR-01** | minted by 27-10 | ✗ **BLOCKED** (`[ ]` Not started) | the fix is named to the file; the defect is live on screen |

No orphaned requirements: `REQUIREMENTS.md` maps exactly one ID to Phase 27 (`EGR-01`), and it
appears in 27-10's plan.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` | — | **none**, across all phase-27 source and spec files |
| — | — | `TODO` / `HACK` | — | **none**. Every `placeholder` hit is prose *about* the anti-placeholder rule |
| `demo-liveness.e2e.test.ts` | 77-79 | stale docblock: *"Two colouring regions"* vs a measured **eight** | ⚠️ WARNING | understates the guard's own blind spot fourfold in the file a reader opens to size it |
| `.planning/STATE.md` | 1134 | *"Closes the demo half of MR-03…MR-07 … and audit finding G4"* | ⚠️ WARNING | both clauses now false; staleness disclosed generically in 27-OPEN-ITEMS §9, this sentence not named |
| ROADMAP Phase 27 / `DEMO-01` | — | *"Five surfaces now carry live readings driven through the page's own controls"* | ⚠️ WARNING | `bench` has 0 readings; `fabric` has no run control |
| `packages/browser/demo/index.html` | ~400-line inline module script | outside `tsc` | ⚠️ WARNING | ledgered, 27-OPEN-ITEMS §3, decider developer |

---

## Human Verification Required

### 1. Option A for the Primes workload

**Test:** Decide whether to mint a third signed kernel record for `primes.wasm`.
**Expected:** Either Option A is scheduled, or Option B (the named absence) is accepted as the
standing answer and the roadmap's *load-bearing surface* language is amended so the goal and the
tree agree.
**Why human:** It regenerates `kernel-record.ts` under a **new** `KERNEL_TRUST_ANCHOR` and
changes what a stock `o2 agent` and a stock `o2 seed` will run. It touches the trust root.

### 2. `EGR-01`

**Test:** Decide the five-file change, or amend UI-SPEC §5.2's fixed copy.
**Expected:** The egress reading distinguishes *the run registered no sovereign data* from
*the guard saw none leave*.
**Why human:** It adds a field to an `@o2/net` type and rewrites the fixed wording of the one
sentence that carries the sovereignty claim.

### 3. MR-03's checkbox

**Test:** Tick, or leave Partial.
**Expected:** A recorded ruling either way.
**Why human:** Ticking cascades into four self-describing header counts, the traceability
verdict, and `WITHOUT_A_CHECKABLE_CLAIM` in `requirements-ledger.node.test.ts`. 27-OPEN-ITEMS §11
enumerates the cost and declines to take it.

### 4. UI-SPEC §12 checker sign-off

**Test:** Walk the six dimensions against the rendered page.
**Expected:** Six boxes ticked, **Approval** no longer `pending`.
**Why human:** Visual and typographic conformance beyond the seven measured contrast pairs is not
programmatically checkable.

### 5. The e2e gate before a phase merges

**Test:** Adopt one bare `npx vitest run --project e2e`, exit code read directly, as a merge gate.
**Expected:** A stated obligation, not a slice and not a composite background command.
**Why human:** It is a process rule, and the phase's own record shows a slice-only convention let a
red project survive a merge.

---

## Gaps Summary

**The phase is substantially delivered and the two gaps are the ones the phase declares about
itself.** Five of six surfaces are wired to live `TabApi` readings, three carry pressable run
controls, and eight e2e spec files run green today against a real relay and two real browser
contexts. The anti-placeholder guard is not decoration: it landed 27 minutes before the first
surface formatter, its expectations come from a committed catalogue imported across packages, and
its liveness complement carries floors that make vacuity itself a failure. The documentation is
of unusual quality — thirty-eight deferred entries and an eleven-item register in which **every
item carries a decider** — and every load-bearing figure this verification checked reproduced
exactly against the tree or against a live run. The process finding is recorded with more rigour
than most phases record their features.

**What keeps this at `gaps_found` is two things, and neither is a bookkeeping quibble.**

*Primes.* The goal says *shows every workload the fabric can already run*. It does not. The
surface exists, twelve regions render, eight are permanent absences, `#s-primes` carries zero
buttons, and the workload has zero production callers — a figure this verifier re-measured live.
The phase says all of this in its own voice and applies *descoped is not satisfied* to itself.
Scoring it VERIFIED would be widening what counts as passing.

*`EGR-01`.* The egress sentence is wrong in a reachable arm, and this verifier watched it be
wrong: a run that submitted six owner-pinned sovereign shards renders *this run registered no
sovereign data* beside *sovereign — every shard was submitted owner-pinned*. The roadmap names
that sentence as one of the two places the phase's load-bearing rule must hold. The row is
correct, the fix is specified to the file, and the fix is not in.

**Honest read: the goal is PARTIALLY met.** *In the mockup's design* — met. *Every figure from a
live reading or a named absence* — met, as amended by UI-SPEC §0's three-class rule
(reading / constant / cited-with-visible-provenance), mechanically guarded, with the guard's
coverage limits measured and published rather than argued. *Every workload the fabric can already
run* — **not met**, by one workload, deliberately, with the cost priced and the decision routed
to the owner.

Three wordings overstate what the tree supports and should be corrected before the milestone
audit reads them: the *"five surfaces carry live readings"* line, the stale *"two colouring
regions"* docblock, and `STATE.md`'s claim that this phase closed MR-03…MR-07 and G4.

---

_Verified: 2026-08-10T20:20:00Z_
_Verifier: Claude (gsd-verifier) — goal-backward, FORCE stance_
