---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 06
subsystem: browser-demo, start-outcome-ledger, e2e
tags: [BROW-02, BROW-01, criterion-5, three-engines, dom-reading, defect-pinned, retrospective-summary]

status: code-landed-never-self-reported
summary_authorship: >-
  RETROSPECTIVE. Written 2026-08-04 by a different agent, from the two committed diffs. The
  executor was terminated mid-flight by a weekly API usage limit before it wrote a summary, a
  plant record, a span or a single exit code. Nothing below is taken from the plan's intent;
  where the evidence is silent this file says so.
executor_outcome: >-
  Killed at ~12:08 PDT 2026-08-04 by a weekly API limit. Its FEATURE HALF had already landed
  on its own at `0a6a715` (12:02, six minutes before the abort) with a full commit message;
  its SPEC HALF was complete in the working tree and was recovered into the salvage commit
  `9acd85f`. No abandoned plant was attributed to this plan.
superseded_in_part_by: >-
  `f60ccb7` (2026-08-04 16:28, a different agent) rewrote 147 lines of
  `peer-ledger.e2e.test.ts`: `SENTINEL_TAB` → `COARSENED_TAB`, and the control case was
  repurposed because the production defect it depended on was fixed. See Superseded below.

requires:
  - phase: phase-20 plan 02
    provides: "both node factories build a real `StartOutcomeLedger` and record their own start row — the premise without which no render change could make a merged report read above 1"
  - "packages/core/src/start-outcome.ts — `describeStartReport`, `BrowserTally`, `MIN_REPORTS_FOR_RATE` (pre-existing, UNCHANGED)"
  - "packages/net/src/start-report.ts — `publishStartOutcome`, `mergeOverlapping`. Merge policy explicitly NOT changed"
  - "packages/node/src/static-rendezvous.e2e.test.ts — the three-engine fixture shape, the built-in-fixture bundle, the dumb 404-ing file server, the `?relay=` convention, sequential rounds"
provides:
  - "`packages/node/src/peer-ledger.e2e.test.ts` — criterion 5 read OFF THE SCREEN across three engines: a chromium tab's rendered panel carries firefox's and webkit's family rows, and a firefox tab carries chromium's and webkit's"
  - "the demo renders the merged tallies beside `peers answering: N of M asked` again, with the sentence that removed it quoted at the line"
  - "the spent deferral replaced by a statement naming `MAX_REPORTED_COUNT` and `isStartBrowserLabel` and the spec that measures each, plus the row count that is STILL unbounded"
  - "`TabStartReport.byBrowser` — structure, so a family reading does not depend on `describeStartReport`'s prose formatting"
  - "A PINNED DEFECT that was not in the plan: BROW-01's opt-out does not hold on the ledger path"
affects:
  - "BROW-01 — a live, asserted defect record. Whoever gates the own row on consent turns that case red, and the red IS the notification"
  - "20-13 — owed the plant record and the measured span this plan never wrote; `mutation-ledger.ts`'s M19 replacement note points AT THIS FILE for an observed failure text that was never captured"
  - "packages/node/src/two-tabs.e2e.test.ts — its BROW-05 absence case was inverted here"
  - "packages/node/src/mutation-ledger.ts — `M19` deleted, with a note in its place"

tech-stack:
  added: []
  patterns:
    - "a FOREIGN BROWSER FAMILY is the reading; a count is not — a count above 1 is satisfiable by an accident, a double-record or one page opened twice"
    - "three separate `browserType.launch()` calls for the three reading tabs, because three tabs of one engine share a family label and `mergeOverlapping` takes the maximum per key"
    - "`browser.newContext()` for the two special tabs — its own origin storage, its own IndexedDB, its own peer identity, at no extra engine-launch cost"
    - "the load-bearing reading is `#report`'s `textContent` off the live page, with `TabStartReport.byBrowser` read IN ADDITION as the screen-vs-object cross-check `M37` argues for"
    - "the one prose parse is anchored on `describeStartReport`'s own two-space row indent and `: ` separator, so a blind-spot note containing a family word cannot be read as a tally"
    - "an engine that cannot take part is PUBLISHED with its reason and reddens the first case, never dropped"

key-files:
  created:
    - packages/node/src/peer-ledger.e2e.test.ts
  modified:
    - packages/browser/demo/index.html
    - packages/browser/demo/main.ts
    - packages/browser/src/tab-api.ts
    - packages/node/src/mutation-ledger.ts      # outside the plan's file list — forced, stated in the commit
    - packages/node/src/two-tabs.e2e.test.ts    # outside the plan's file list — already red, stated in the commit

decisions:
  - "`TabStartReport` WAS widened, with `byBrowser` passed straight through from `StartReport` — not recomputed, not re-sorted, not filtered to families this build recognises"
  - "the screen stays the criterion's reading; the object is only the cross-check, because the criterion says *viewed*"
  - "`M19` was DELETED rather than left drifting: its `find` no longer occurs, so the pre-commit guard refused the render change and an entry that cannot be planted guards nothing. Its inverse replacement is specified in the note and handed to 20-13"
  - "the `unreliable` small-sample marker is asserted PRESENT rather than worked around"
  - "the relay is a `FabricNode` and therefore a contributor too — its `other` row is read as one more family the browser tabs did not produce, on identical terms"
  - "BROW-01's breach was PINNED as a passing assertion rather than only written down, so the fix cannot land unnoticed"

requirements-completed: []   # REQUIREMENTS.md was NOT updated — see Outstanding

metrics:
  duration: unknown — the executor was terminated before reporting
  completed: 2026-08-04 (code, across two commits); summary written retrospectively 2026-08-04
---

# Phase 20 Plan 06: A Tab Shows Counts It Could Not Have Produced — Summary (retrospective)

> **Read this line first.** This plan is **complete in code and was never self-reported.** Its
> executor was killed by a weekly API usage limit before it wrote a summary, a plant table, a
> measured span or a single exit code. Everything below is derived from the two committed diffs
> (`0a6a715`, `9acd85f`) and from a later commit that changed part of it (`f60ccb7`). **No plant
> record and no observed failure text from this executor's own plants exist, and none is invented
> here** — including the one that `packages/node/src/mutation-ledger.ts` explicitly says is
> recorded in this file. See *The dangling pointer* below.

**Criterion 5 is measured on screen.** Five tabs across three engines discover each other through
a relay with nothing dialled by the harness; each publishes once through the page's own Refresh
control; and the chromium tab's rendered `#report` element carries tally rows for firefox's and
webkit's families — labels the page has no expression to produce. The same reading is taken from
the firefox tab. **And the plan produced a finding it was not looking for: BROW-01's opt-out does
not hold**, and that breach is pinned as an assertion rather than a note.

## What landed, in two commits

| file | change | commit |
|---|---|---|
| `packages/browser/demo/index.html` | `showReportOnly` → `showReport`; the merged tallies rendered beside `peers answering: N of M asked`; the removed sentence quoted; the deferral replaced | `0a6a715` |
| `packages/browser/demo/main.ts` | `byBrowser` carried on both arms of `startReport()` | `0a6a715` |
| `packages/browser/src/tab-api.ts` | `TabStartReport.byBrowser` added; `TabApi.startReport`'s docblock updated | `0a6a715` |
| `packages/node/src/mutation-ledger.ts` | **outside the plan's list** — `M19` deleted, note in its place | `0a6a715` |
| `packages/node/src/two-tabs.e2e.test.ts` | **outside the plan's list** — the BROW-05 absence case inverted | `0a6a715` |
| `packages/node/src/peer-ledger.e2e.test.ts` | **new, 683 lines** | `9acd85f` |

`0a6a715` is this plan's own commit, made at 12:02 — six minutes before the abort — and it carries
a full message that names both out-of-list files and why each was forced. `9acd85f` is the
**salvage** commit; its message states that none of the three plans it carries is scoreable, and
it was made with `O2_SKIP_GUARDS=1`.

## Asked vs delivered

| # | Plan must-have | Delivered? |
|---|---|---|
| 1 | A tab's ledger shows a row for a browser family that tab is not | **YES**, from two reading tabs, plus the Node tier's `other` row from the relay |
| 2 | The reading is taken on screen, not off a returned object | **YES** — `#report`'s `textContent`; the object is read only as a cross-check |
| 3 | A visitor who declined still sees the merged view and still contributes nothing | **HALF.** Sees: YES, asserted. Contributes nothing: **NO — measured false, and pinned as a defect.** |
| 4 | The count beside the report is honest again, restored only because the peers now contribute | **YES**, with the removed sentence quoted at the line |

### Task 1 — the demo renders the merged view and says what it is

`showReportOnly(report.text)` became `showReport(report)`, which renders
`` `${report.text}\n\npeers answering: ${report.reached} of ${report.asked} asked` `` — after a
blank line rather than indented under the summary, because it is not a tally row. Nothing
reformats `describeStartReport`'s output; the CLI renders the same function.

**The removed sentence is quoted at the line**, as the plan required — *"`no start outcomes
reported` directly above `peers answering: 2 of 2 asked`"* — with the point stated: *"The lie was
the juxtaposition, not the fields"*, and what changed is not the render but that the peers now
genuinely contribute.

**The deferral was replaced, not deleted.** The new text names `MAX_REPORTED_COUNT` and
`isStartBrowserLabel` as both enforced in `protocol.ts`'s `parseCounts`, and names the spec that
measures each over the wire — `start-report.test.ts` › `lifting the deferral does not lift the
bounds it was conditional on` (verified present at HEAD). And it states plainly what is **still
unbounded**: the row *count*. `parseCounts` bounds each entry and validates each label and bounds
no array length; 20-02 measured 43.90 bytes a row against NET-08's 8 MiB inbound ceiling, a
crossover at 191 099 rows, so that ceiling does not meaningfully bound it. *"Closing it is a
decision nobody has taken, and this note is here so nobody assumes it was."*

**`TabStartReport` was widened.** The plan left the choice open and said to say which; the choice
is `byBrowser`, argued at the field: with only `text` on the interface a spec could assert a
family only by regexing prose, *"which would make the criterion depend on a formatting decision
that is free to change and that nothing would then re-check."* It is `StartReport.byBrowser`
passed straight through on **both** arms of `startReport()` — including the no-node arm, so a
caller reads one shape and tells the two apart by `asked`. Not recomputed, not re-sorted, and not
filtered to families this build recognises, *"because a peer that named a family this build has
never heard of is a finding."*

### Task 2 — three engines, five tabs, one merged view read on screen

Modelled on `static-rendezvous.e2e.test.ts`: the bundle is built inside the fixture (so the spec
fails when *sources* break the bundle), served by a deliberately dumb 404-ing file server over
`dist/`, and the relay address reaches the page only through its own `?relay=` query string.
Nothing is dialled by the harness. Discovery runs sequentially, for the reason that file records
about a measured ICE loss on simultaneous firefox↔webkit dials.

Five tabs: three separate `browserType.launch()` calls for chromium, firefox and webkit — because
for those the point is three independent WebRTC implementations — and two `browser.newContext()`
tabs on the already-launched chromium for the two special cases, since a context is its own origin
storage, IndexedDB and peer identity. **One host, three engines, explicitly not three machines**,
disclosed in the header.

The cases, in file order:

1. **`runs all three engines the standard names, or publishes the one it could not`** — exclusions
   asserted empty and named if not; five distinct peer ids; the relay's `capacity.granted` at
   least five; and the three reading tabs' labels asserted **distinct**, without which every
   foreign-family assertion below would be satisfiable by a tab's own row.
2. **`every tab holds every other tab, with no harness dial anywhere`** — the fixture precondition
   asserted as one rather than claimed, so an absence in the controls has one explanation rather
   than two. The relay is asserted present in every tab's peer set.
3. **`shows, on screen, tally rows for two browser families the reading tab is not`** — the
   reading the file exists for, taken from chromium and again from firefox so the property is not
   an artefact of one engine's ordering. `familiesOnScreen` parses the panel anchored on
   `describeStartReport`'s two-space row indent and `: ` separator. The relay's `other` row is
   asserted too — the Node tier holding a ledger on identical terms, which is what makes this a
   *fabric* reading rather than a browser one.
4. **`reports more than any one tab holds, with the small-sample warning left visible`** — the
   count asserted **beside** the family and never instead of it, with the file stating in terms
   that `reported > 1` is satisfiable with no merge at all. The summary denominator is asserted
   `>= 4` as a **floor rather than an equality**, with the reason given: the leak recorded two
   cases below could grow, and the assertion must not silently start passing because it did.
   `unreliable` is asserted present on every rendered rate — five tabs is far below
   `MIN_REPORTS_FOR_RATE` (10), and that constant's docblock refuses exactly the move of hiding a
   small-`n` warning. The screen-vs-object cross-check runs here.
5. **the control** (see *Superseded* — this case has since been repurposed).
6. **`a declining visitor still sees the merged view, and counts their own decline locally`** —
   all three reading families plus `other` on the declining tab's screen; `not counted: 1` present
   as the blind spot; and the restored contributor reading **parsed rather than matched**, because
   `0 of 0 asked` renders just as happily as a real fan-out.

### The finding that was not in the plan — BROW-01's opt-out does not hold

`it('RECORDS A DEFECT — a declining visitor's family reaches every peer anyway (BROW-01)')`.

`DISCLOSURE.reporting` promises, in the words a visitor reads before deciding, *"Off unless you
turn it on."* The declining tab turned it off. Its family is on every other tab's screen anyway.

**Mechanically:** two things send that line and only one is gated. `demo/main.ts`'s `startReport`
sends `outcome: allowed ? outcome : null`, which honours the choice. But `browser-node.ts` records
this node's own row into its own **serve-side** ledger at construction — before any peer is
contacted, with no reference to consent, because `BrowserNodeOptions` carries none — and
`serveAgent`'s report branch hands that ledger to every peer that asks. **The page withholds the
line and the node serves it.**

Three things make this the most valuable thing in the plan:

- **It is asserted, not merely written down.** The case passes today; whoever gates the own row on
  consent turns it red, and the red is the notification. The docblock says exactly how to invert
  it when that happens and which sections to delete.
- **It names precisely what it is not evidence of.** The request path is implemented and correct.
  What is measured is that the request path's correctness is currently *unobservable from any
  screen* — *"which is also why a plant that removes the `allowed ? … : null` gate does not redden
  anything in this repository today."*
- **The label is unique in the fixture** (`edge 120`, from an `Edg/` marker appended to the real
  user agent), so its presence on another tab's screen has exactly one source.

The docblock records this as reported to the owner as a BROW-01 finding, and says the fix is *a
decision rather than a repair*. **No owner ruling on it is recorded anywhere in `.planning/`.**

## The two files outside the plan's list, both stated in the commit

**`packages/node/src/mutation-ledger.ts`.** `M19` pinned the **absence** of a peer count beside the
panel. Its `find` string — `showReportOnly(report.text)` — no longer occurs, so the pre-commit
guard refused the render change; an entry that cannot be planted guards nothing. Deleted with a
note in its place, the way `M36` was, recording that its `why` rested on a premise 20-02 removed,
and specifying the inverse replacement for 20-13, which owns that file: replace
`peers: () => running.transport.peers` in `demo/main.ts` with `peers: () => []`.

**`packages/node/src/two-tabs.e2e.test.ts`.** Its case asserted the same absence and **was already
red before this plan touched anything**, on 20-02's change alone. That failure text *was* captured,
in the commit message: `expected '0 of 2 reported starts failed (0.0%)…' to contain 'no start
outcomes reported'`. Inverted to `renders the merged aggregate a declining tab could not have
produced`, with the old sentence and the reason kept in the docblock, and with the load-bearing
row being `other` — the Node tier's family, arriving from the relay, which no chromium tab could
report. The docblock also states what that file does **not** carry: criterion 5's reading, because
two tabs of one engine share a family label.

## The dangling pointer

`packages/node/src/mutation-ledger.ts`'s `M19` replacement note ends: *"The observed failure text
is recorded in `20-06-SUMMARY.md`."*

**It is not, because it was never captured.** This file is that pointer's destination and this
paragraph is the honest answer. The note was written at 12:02, in `0a6a715`, and describes the
inverse plant's effect in the past tense — *"the page still shows a plausible report, `reached`
and `asked` both read 0, and every foreign family row disappears"* — but the only spec named as
its `caughtBy`, `peer-ledger.e2e.test.ts`, did not exist until the salvage commit two hours and
forty-nine minutes later. **Whether that plant was ever applied and watched, and against what,
cannot be established from the evidence.** Treat it as unverified until 20-13 applies it and
records the text.

## What could NOT be determined from the evidence

**Do not fill these by inference.**

- **No plant record exists.** The plan required the `browser-node.ts` skip-own-row plant (20-02's
  second, re-applied), the sentinel control's non-vacuity, and *"record the observed failure text
  of each plant for 20-13."* None survives.
- **The specific corroboration the plan asked for was not recorded**: that
  `serve-agent-hooks.node.test.ts` stays **green** under that plant — the divergence that is the
  whole argument for taking the reading off a screen.
- **No measured span for `peer-ledger.e2e.test.ts`**, which the plan required be reported and
  handed to 20-13 (it was forbidden from editing `vitest.config.ts`, which 20-05 owned). The file
  measures `setupMs` and writes it to stderr on every run; nobody wrote down a run.
- **No `tsc --noEmit` or vitest exit code from this executor.**
- **The green claim's scope.** `9acd85f` asserts all three salvaged files were *"measured green"*,
  but the whole-project reading it prints — 142 files, 2024 passed, 2 skipped, 1 failed — is the
  **node** project's, and `peer-ledger.e2e.test.ts` runs in the **e2e** project. That reading
  therefore does **not** cover this file. The first recorded exit code that does is `f60ccb7`'s
  *"e2e exit 0"*, taken at 16:28 by a different agent **after** it had changed 147 lines of the
  file.

## Superseded in part — `f60ccb7`, four hours later

A later commit rewrote the control tab, and the reason is a real defect found downstream of this
plan's own reasoning. It is recorded here so a verifier reading 20-06 against HEAD is not
confused.

20-06's landed header argued that `ownStartOutcome`'s `'reports-no-start-outcome'` arm was
*"reachable in production on this tier and on no other"*, and built `SENTINEL_TAB` — a chromium
context with the major forced to five digits — on that reachability. `f60ccb7` measured the same
mechanism and named it a defect on the *composer's* side: `browserLabel` composed `${family}
${major}` with no bound while `isStartBrowserLabel` admitted four digits, so a real five-digit
visitor started and then **reported nothing at all** on both paths at once. *"A metric built to
make a blocklist's silence visible was manufacturing silence."*

The composer was bounded by `MAX_BROWSER_MAJOR` and now drops a version past the ceiling rather
than clamping it, so such a visitor is counted under its family alone. Consequences for this
plan's file:

- `SENTINEL_TAB` → `COARSENED_TAB`; the case
  `a peer that holds no row of its own is absent from every other screen, and still answers`
  **no longer exists at HEAD**. It is now
  `a visitor past the publishable range is counted under its family, on every other screen`.
- 20-06's own statement that the sentinel arm is production-reachable is **no longer true**:
  `f60ccb7` records that there is now no production path to that arm on either tier.
- The declining-visitor cases and the BROW-01 defect case are **unchanged** and still present.

**20-06's sentinel control depended on a production defect.** That is not a criticism of the
control — it was a correct reading of the tree it was written against — but a verifier must score
the file at HEAD, not at `9acd85f`.

## Outstanding — work this plan owed and did not do

1. **`.planning/REQUIREMENTS.md` was not updated.** The `BROW-02` traceability row still reads
   *"Partial — … What is still outstanding is the reading, not the wire — no tab has yet been
   shown displaying counts it could only have learned from a peer, which is Plan 20-06."* That
   reading landed. The Partials table row says the same thing.
2. **The BROW-01 breach has no requirement-level record.** It exists only as a passing assertion
   in `peer-ledger.e2e.test.ts` and in this summary. Nothing in `.planning/` files it, and no
   owner ruling on it is recorded.
3. **No mutation-ledger row replaces `M19`.** The replacement is *specified* in the note and
   handed to 20-13, but the entry does not exist and the observed text it needs was never
   captured.
4. **The measured span was not handed to 20-13.**
5. **`.planning/STATE.md` and `.planning/ROADMAP.md` were not advanced** for this plan.

## Out of scope, untouched

`publishStartOutcome`'s merge policy (`mergeOverlapping` over `mergeDisjoint`, explicitly not
changed), the `OutcomeCount` wire shape, any new bound, `vitest.config.ts` (20-05 owned it this
wave and did not edit it either), and multi-engine coverage for the other e2e specs.

## Self-Check: PASSED (performed by the retrospective writer, not by the executor)

- `packages/node/src/peer-ledger.e2e.test.ts` — FOUND, new in `9acd85f`
- commits `0a6a715` and `9acd85f` — both FOUND
- `packages/browser/src/tab-api.ts` › `TabStartReport.byBrowser` — FOUND at HEAD
- `packages/browser/demo/index.html` › `showReport` and `peers answering: ${report.reached} of ${report.asked} asked` — FOUND at HEAD
- `packages/net/src/start-report.test.ts` › `lifting the deferral does not lift the bounds it was conditional on` — FOUND at HEAD
- `it('RECORDS A DEFECT — a declining visitor's family reaches every peer anyway (BROW-01)')` — **FOUND at HEAD**, still passing per `f60ccb7`'s e2e run
- `M19` — CONFIRMED ABSENT from `packages/node/src/mutation-ledger.ts`; the replacement note is present and its pointer to this summary is answered above
- `a peer that holds no row of its own is absent from every other screen, and still answers` —
  **CONFIRMED ABSENT at HEAD**, replaced by `f60ccb7` (this is the finding, not a failure of the check)
- **NOT verified, because no such record exists:** any plant, any observed failure text from this
  plan's own plants, any span, or any exit code covering the `e2e` project at the moment this
  plan's work was committed.
