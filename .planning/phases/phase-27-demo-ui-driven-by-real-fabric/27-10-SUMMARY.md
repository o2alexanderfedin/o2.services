---
phase: 27-demo-ui-driven-by-real-fabric
plan: 10
subsystem: planning-ledger
tags: [mr-03, mr-04, mr-05, mr-06, mr-07, demo-01, demo-02, egr-01, g4-split, ledger-reconciliation, mutation-proof]
dependency-graph:
  requires:
    - 27-01 through 27-09 (every SUMMARY this plan reconciles, and the deferred-items.md
      the open register is consolidated out of)
  provides:
    - ".planning/REQUIREMENTS.md — MR-03…MR-07's demo clause replaced by one that
      distinguishes the aggregation merge from the first-found-wins scan, each row now
      stating per row what no surface exercises; DEMO-01/DEMO-02 widened; EGR-01 minted"
    - ".planning/v1.1-MILESTONE-AUDIT.md — a dated 2026-08-10 G4 amendment above the
      2026-08-08 one, nothing deleted: runJob half closed, primes half open and measured"
    - ".planning/phases/phase-27-demo-ui-driven-by-real-fabric/27-OPEN-ITEMS.md — eleven
      sections, every entry carrying what is open, what was measured, what closing costs,
      what blocks it and who decides"
    - ".planning/ROADMAP.md — the true G4 outcome row by row, the ten-wave plan list, and
      the Primes disposition as prose in the entry rather than only in the HTML comment"
    - "packages/node/src/trust-anchors.node.test.ts — the provenance opt-out bound raised
      40 → 48, after the full node project found it had been red since Plan 27-01"
  affects:
    - "whoever takes EGR-01 — the five-file change and the four specs are written out and
      the previously-recorded fix is corrected against the source"
    - "whoever takes Option A for Primes — the cost, the blocker and the decider are named
      in three documents rather than one deferred file"
tech-stack:
  added: []
  patterns:
    - "a ledger row amended in place with the superseded text left standing, because a
      wrong finding is worth more visible than deleted — this audit file's own convention"
    - "an open item that names a decider and a cost, because an open item with neither is
      a note, and a note is how an open item closes by attrition"
    - "a deferred fix RE-MEASURED against the source before being filed, so the register
      carries the change that would work rather than the one that was first written down"
    - "the before/after matched-row count recorded as two numbers, because a green suite
      cannot distinguish checked-and-passing from invisible-to-the-parser"
key-files:
  created:
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/27-OPEN-ITEMS.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/v1.1-MILESTONE-AUDIT.md
    - .planning/ROADMAP.md
    - packages/node/src/trust-anchors.node.test.ts
decisions:
  - "All five MR rows stay `[ ]` Partial, and the reason is written per row rather than
    once. Four of the five have criteria no surface exercises — the identical tree across
    participants, the rendezvous ranking, the churn recompute, the duplicate discard. The
    fifth, MR-03, is arguably closeable and is recorded as an owner decision instead of
    ticked, because no surface demonstrates the *commutative* half of its own clause and
    MR-02 — the map half of the same family — is still Built, not wired."
  - "The sovereign-data sentence got disposition (a): filed first-class as EGR-01 in
    REQUIREMENTS.md, not fixed here. The reason is a measurement rather than scheduling —
    the fix as previously written was measured today to be wrong about where the count
    lives, so shipping it would have shipped a `registered` figure reading zero on exactly
    the run that motivated it."
  - "The G4 amendment reconciles TWO descriptions of one finding rather than one. The
    ROADMAP called G4 `runJob has no caller in the page`; the audit's 2026-08-08 amendment
    called the open half the primes entry point. Both are now settled separately and the
    2026-08-08 row is left standing with its stale arithmetic corrected from above."
  - "The provenance opt-out bound was raised rather than the new member exempted. The
    guard's own comment says the figure is a configuration choice, not a measurement, and
    the new member is legitimate for the same reason the other thirty-nine are."
  - "STATE.md was NOT touched, consistently with 27-05 through 27-09, and it is recorded as
    an open item rather than left silent. Its `stopped_at` is a sixty-line YAML block
    scalar under a parseability guard, and the operator's instruction forbids the state
    verbs that would edit it."
metrics:
  duration: ~85 minutes
  tasks: 3
  files-created: 1
  files-modified: 4
  commits: 5
  completed: 2026-08-10
---

# Phase 27 Plan 10: The ledger reconciliation Summary

**The phase's ledger now says what the phase did, and the sharpest result is not any of the
three tasks: it is that `npx vitest run --project node` was red, and had been red since Plan
27-01's first commit, and nine waves closed on top of it.**

Plan 27-09 could not finish that suite — it gave up at a ten-minute command timeout and said
so. Run to completion here, it exited **1**: `packages/node/src/trust-anchors.node.test.ts`,
`expected 40 to be less than 40`. `packages/node/src/demo-viewport.e2e.test.ts` landed in
`d7a20f0` — Plan 27-01, the first commit of the phase — and took the count of test files
naming the provenance opt-out from 39 to 40 against a bound of *less than 40*. Nothing caught
it because that file is not one of the seven cheap guards the pre-commit hook runs, and no
wave ran the project in full. **A phase should not close on a suite that was never finished,
and this is what that costs when it does.**

---

## The full node project, run to completion — both runs, exit codes read directly

`EXIT=$?` on the line immediately after the command in both cases, output redirected to a file
and the file read afterwards — no pipe, no trailing `tail`. Both runs were started on a
**clean** `git status --porcelain`, and nothing was staged or edited while either was in
flight, because `discover-arm.node.test.ts` and `bench-attestation.node.test.ts` snapshot the
index around themselves.

| run | exit | Test Files | Tests | wall | `(user+sys)/real` |
|---|---|---|---|---|---|
| before the fix | **1** | 1 failed \| 178 passed (179) | 1 failed \| 2571 passed \| 1 skipped (2573) | 388.15 s real / 404.13 user / 55.93 sys | **1.19** |
| after the fix | **0** | **179 passed (179)** | **2572 passed \| 1 skipped (2573)** | 357.63 s real / 395.81 user / 52.31 sys | **1.25** |

Both ratios are above one, so neither reading was taken from a starved process. They are
comparability keys, not verdicts.

**The single failure, verbatim:**

```
 FAIL  |node| packages/node/src/trust-anchors.node.test.ts > the provenance opt-out is written
 down only where it is a decision > is spreading no further through the test suite than a bound
 nobody has to maintain
AssertionError: expected 40 to be less than 40
 ❯ packages/node/src/trust-anchors.node.test.ts:332:30
```

**The fix, and why a raise rather than an exemption.** The assertion's own comment states the
rule: *"A **bound**, not an exact count … The figure is a configuration choice, not a
measurement — it says 'well above where we are, well below every test file in the package'."*
`demo-viewport.e2e.test.ts` names the opt-out because it starts a real relay in a Playwright
harness, which is the same reason the other thirty-nine do — a legitimate member, not spread.
Raised **40 → 48** and re-sited against the population measured today: **40 of 217 tracked
test files repo-wide, 111 of them in `packages/node/src`**, so the new figure keeps eight of
headroom instead of one. The whole account, including how long it was red and why nobody saw
it, is in the docblock beside the number rather than only here.

---

## Task 1 — the requirement rows, per row, with the verdict stated

**The matched-row counts, before and after, as numbers.** Taken with the guards' own two
patterns run over `REQUIREMENTS.md` directly, because a green suite cannot distinguish
*checked and passing* from *invisible to the parser*:

| pattern | before | after |
|---|---|---|
| `REQUIREMENT_ROW` | **95** (59 satisfied, 36 open) | **96** (59 satisfied, 37 open) |
| `TRACEABILITY_ROW` | **95** | **96** |

Equal but for the one row added — `EGR-01`, which is `[ ]`, hence the open count moving and
the satisfied count not. Checkbox ids with no traceability row: **0** before and after.
Unrecognised status words: **0** — `RECOGNISED_STATUSES` is a closed list and every amended
cell keeps its leading verdict intact ahead of the first em dash, which is where the parser
cuts.

### The verdict per row, decided one at a time

The shared clause *"The demo still merges with a linear scan: `answerOf` … That half is
WIRE-02, Phase 22"* is replaced in all five by one that **distinguishes the two merges**: the
demo's *aggregation* workload is π, it merges through `reduceJob`, and it now has a run
control and `packages/node/src/demo-pi.e2e.test.ts`, which reads `depth 2` over twelve leaves,
`4` combines and an estimate of `3.141592320` inside a series bound of `0.000000667` **off the
screen**. The demo's *colouring* merge is still `answerOf` and stays that way: a colouring is
first-found-wins, so there is nothing to aggregate — a scan **by shape** rather than unwired
residue, which is what `runPi`'s own docblock gives as the reason π is the companion and not
the replacement. The old hand-off is also corrected: `WIRE-02` is the reachability guard, not
a demo-merge item.

| row | verdict | reason |
|---|---|---|
| **MR-03** | **`[ ]` Partial — unchanged, and it is the one that is arguably closeable** | the hierarchical tree merge is on screen and driven by a person's press, which is this row's whole subject, and it is the only one of the five a page button reaches. What no surface shows is the **commutative** half of the clause — one combine order, once — and `MR-02` is still *Built, not wired*, so every partial the tree merges is over a range the page generated rather than over an owner's data. Recorded as an owner decision in `27-OPEN-ITEMS.md` §11, with the full cost of ticking it |
| **MR-04** | **`[ ]` Partial — unchanged** | *every participant computes an identical tree with no consensus* is a claim about two participants deriving the same tree; the page has one requestor deriving it once. Held by `packages/core/src/reduce.test.ts` and `bin/bench.ts`, not by a surface |
| **MR-05** | **`[ ]` Partial — unchanged** | the rendezvous ranking and its ranked fallback list are never on screen, and the two-tab run produced no null combine for the walk to fall through, so the *fallback* half has no reading from the page at all |
| **MR-06** | **`[ ]` Partial — unchanged** | nothing on the page loses a combine to churn; the demo's two-tab run has no arm that stops a combiner mid-reduce |
| **MR-07** | **`[ ]` Partial — unchanged** | the duplicate-combine discard is established by `packages/node/src/late-combine.node.test.ts` across real spawned processes and is not something a page button demonstrates — which is why the demo half moving does not move this box. Its *arriving late* paragraph is untouched and still records that clause as closed |
| **DEMO-01** | **`[x]` Done — evidence widened, box unchanged** | five surfaces named with their specs, plus the two guards that hold the *live* half rather than the *present* half. The owner-observed two-machine parenthetical was **added to, not replaced**, and the machines half is still stated as not captured by a test |
| **DEMO-02** | **`[x]` Done — evidence widened, box unchanged** | two workloads a person can press and watch settle, a third that dispatches a caller-supplied signed module, and Primes named as an absence rather than counted as a fourth task |

No row was closed. No new status word was introduced. No row claims a symbol has no
production caller — checked deliberately, because `egressLines` and the five primes symbols
all appear in the new prose and `egressLines` **does** have five callers.

### EGR-01, minted — and the disposition the sovereign-data sentence got

**Disposition (a): filed first-class with a named requirement id, not (b): fixed here.** The
new `## Phase 27 Requirements` section carries one checkbox and the traceability table carries
its row, following the Phase 25 and Phase 26 precedent for a phase filed outside both
milestones. Verdict **Not started**, which keeps it out of `UNREACHED_VERDICTS` and therefore
out of `requirements-ledger.node.test.ts`'s pinned `WITHOUT_A_CHECKABLE_CLAIM` set — a row
that carries no call-site claim and is not *unreached* owes that guard nothing.

**Why (a), and it is a measurement rather than a scheduling excuse.** `deferred-items.md`
prescribed *"a `registered` count on `EgressManifest`, counted where the guard registers a
sovereign CID"*. Read against the source on 2026-08-10, **that is the wrong place**:

- `EgressGuard.guard()` appends no `EgressEntry` — it only mutates the held-payload map;
- `submitJobWithEgress` gives every hold back in a `finally`, so `registrations` is empty by
  the time anybody reads it;
- `sliceManifest` recomputes `entries`, `totalBytes` and `violations` from the sliced entry
  list **alone**, and the tab reads a sliced manifest (`packages/browser/demo/main.ts` calls
  `submitJobWithEgress`, not bare `submitJob`).

So a figure read off the guard after a job is either zero or a session-lifetime total, and
**shipping it would have put a `registered: 0` beside six owner-pinned shards** — the same
untruth in a new field. The count has to be taken in `submitJobWithEgress`, which is the only
code that knows the sovereign shard set, and carried through `sliceManifest` as a per-job
delta the way `totalBytes` already is. The row names **five files** (not four) and the **four
specs** to re-read, and says the decider is the owner, because it adds a field to a type in
`@o2/net` and rewrites the copywriting contract's fixed wording for the one sentence that
carries the sovereignty claim.

**Said plainly: this is not "logged".** It is a requirement id in `REQUIREMENTS.md`, item 2 of
`27-OPEN-ITEMS.md` with its own cost table, and a bullet in the ROADMAP entry. Three ledgers, a
named decider, and a corrected fix — which is more than option (b) would have produced if the
third arm had gone in reading zero.

---

## Task 2 — G4, split the way it is split in fact

`.planning/v1.1-MILESTONE-AUDIT.md` keeps its own convention: **nothing was deleted to make
room.** The 2026-08-08 amendment and the struck-through original both still stand, and a dated
2026-08-10 row sits above them, exactly as the 2026-08-08 row sits above the original.

**What the amendment says, and no more:**

1. **The `runJob` half is CLOSED.** `#byo-form`'s submit handler in
   `packages/browser/demo/index.html` calls `window.o2.runJob` — one call site, cited by
   symbol rather than by line, because this repository converted every `file:line` citation to
   a greppable symbol after measuring 41 of 46 coordinates landing on a blank line or a brace.
   *(The line the operator's brief carried, `index.html:1733`, is itself an instance: the call
   is now at 2325, because waves 27-08 and 27-09 grew the file.)* Driven by
   `packages/node/src/demo-byo.e2e.test.ts` on four arms — a record this tab pins, dispatched,
   six of six shards agreeing in 271 ms; a record signed by a key this tab does not pin,
   **refused in the fabric's own words in 142 ms against that 271 ms in the same run**, so the
   refusal is read and not discovered as a timeout; and two sovereign arms. P5 in
   `demo-liveness.e2e.test.ts` drives the same control on every run.
2. **The primes half is OPEN and measured.** `packages/node/src/demo-primes.e2e.test.ts` prints
   its own reading on every run, taken again for this plan — **17 matches of five symbols
   across 5 files, 11 on a code line in 2 files (`packages/demo/src/index.ts`,
   `packages/demo/src/primes.ts`), production callers 0**, `Tests 11 passed (11)`, exit **0**.
   The spec is **expected to FAIL** the day somebody wires the workload.
3. **Why it is open, and who decides.** Option B was planned and shipped. Option A's exact cost
   is stated, including that re-signing under a new anchor changes what a stock `o2 agent` and
   a stock `o2 seed` will run. It is an owner decision, surfaced separately, and it was not
   begun.

**The arithmetic, fixed from above rather than by editing the row.** The 2026-08-08 row says
the five symbols appear outside their module *"in two places only"*. That is now **five
files** — Plan 27-03's Option B decision block and Plan 27-06's surface header both name them
in prose while explaining why nothing calls them. The row's **conclusion holds exactly**: zero
production callers. Wave 6 deliberately left the row alone and it was right to; the correction
is in the new amendment, with the argument for citing the spec rather than a figure, because
the spec is re-measured on every run and the row is not.

**An independent recount, reported because it disagrees in a way worth knowing.** A grep
written for this plan — same symbol set, same file population, counting *every match on a
line* rather than per symbol — read **21 mentions and 12 code-line matches** against the
spec's 17 and 11. The **file sets are identical** (5 and 2), and the file sets are what the
spec asserts, for exactly this reason: a count moves with how you count, a set does not.

**Two more sentences corrected.** The `demo/main.ts` row in the end-to-end flow table is
re-measured — three workloads now have a control a person can press, two more surfaces read
rather than run, and *Primes is still unreachable from this page* stands because it is still
true. And line 376's *"Phase 27 addresses G4's remaining half"* — which is precisely the
sentence the whole defect consists of — now names **which** half: the `runJob` half addressed
and closed, the primes half not addressed and open.

`grep -n "G4"` over the amended file leaves no sentence reporting the two halves as one.

---

## Task 3 — `27-OPEN-ITEMS.md`, and the Primes disposition in the roadmap as prose

`27-OPEN-ITEMS.md` is **324 lines**, eleven sections. Every entry carries four things and is
not an entry without them: what is open, what was measured, what closing costs, and **who
decides**.

| § | what | decider |
|---|---|---|
| 1 | the Primes workload has no dispatch path from a browser tab | **owner** |
| 2 | the egress reading cannot tell *registered nothing* from *saw nothing leave* — `EGR-01` | **owner** |
| 3 | the page driver is not type-checked | developer |
| 4 | the `byBrowser` row count is unbounded at the wire (T-27-30, crossover at 191 099 rows) | **owner** |
| 5 | a dark map of the eight base custom properties | developer |
| 6 | UI-SPEC §12's checker sign-off, still `Approval: pending` | design checker, then owner |
| 7 | ten UI-SPEC corrections the phase owes, as a table with what was measured against each | developer |
| 8 | seven guard-coverage gaps — the P5b exempt set, the unasserted skip list, a whole surface outside five properties, the bar's three unchecked regions, five status elements P2 cannot see, the missing contrast pairs, P9's subset direction | developer |
| 9 | ten surface and fixture limits — Chromium only, the unreproducible iPhone reading, three composed sentences no browser has rendered, the start-outcome cliff, the withheld branch, the duplicated address, and more | developer, four marked **owner** |
| 10 | **what closed while the phase ran** — seven items, so the file is not read as a list of live gaps that quietly includes dead ones | — |
| 11 | the one ledger decision this plan deliberately did not take: MR-03's checkbox | **owner** |

**The ROADMAP entry.** The `**Requirements**` line said G4 *"closes here or is restated with a
reason"*. It did **both**, so the line is amended row by row — MR-03…MR-07 with the two merges
distinguished and all five still `[ ]`, DEMO-01/DEMO-02 widened, G4's `runJob` half closed and
its primes half restated, and `EGR-01` minted. The original sentence is quoted inside the
amendment rather than deleted.

The **Primes disposition is three paragraphs of prose in the entry itself**, not in the HTML
comment: *this phase shipped a Primes surface and did not ship a Primes workload*, the three
measured reasons, Option A as an owner decision that was not begun, and the fact that the
absence is held mechanically — the spec re-measures the caller count on every run and is
expected to fail the day somebody wires it. A reader who opens no plan file gets that.

The entry also gains `**Plans:** 10/10 plans executed` and a ten-wave plan list, one line per
plan, matching the nine SUMMARY files that exist plus this one — following the Phase 25 entry's
shape. Wave 6's line carries **(the workload itself is OPEN — see the disposition above)** in
place of a bare tick.

---

## The planted mutations

Three, in two files. Each snapshotted with `cp` to the session scratchpad **immediately
before** the edit, restored by **the surgical inverse of that edit** — never `cp` back, never
`git stash`, never `git checkout --` — and verified with `cmp`, `EXIT=$?` read on the line
immediately after. **Every `cmp` returned 0.**

### Plant A — `EGR-01` ticked while its verdict is *Not started*: **red, two assertions, both naming it**

`- [ ] **EGR-01**` → `- [x] **EGR-01**`, one character. Exit **1**, `Tests 2 failed | 59 passed (61)`:

```
FAIL |node| acceptance-traceability.node.test.ts > … > has no [x] requirement that no test names…
+   "EGR-01 — marked [x] at .planning/REQUIREMENTS.md:689, and no tracked test file names it",

FAIL |node| acceptance-traceability.node.test.ts > … > marks no requirement [x] whose traceability status is not Done
+   "EGR-01 — [x] at .planning/REQUIREMENTS.md:689 against **Not started** at .planning/REQUIREMENTS.md:843",
```

Both halves of the join fired, and the second is the one that matters: the new row is inside
the checkbox↔traceability join rather than beside it. `cmp` after the surgical restore: **0**.

### Plant B — a banned stem in `27-OPEN-ITEMS.md`: **red, naming the file and the line**

The acceptance criterion for Task 3 asserts that this phase's planning directory is *not* in
the vocabulary guard's `EXEMPT_PATHS` and that every word of these files is held to the rule.
That is a claim worth measuring rather than quoting — and it had a real trap in it: the guard
builds its corpus from `git ls-files`, so **an untracked file is not scanned at all** and the
first green run over the new file was vacuous. The file was staged first, and only then
planted: one appended sentence carrying one of the five refused stems. Exit **1**,
`Tests 1 failed | 24 passed (25)`, the failure naming `27-OPEN-ITEMS.md:326`, the offending
word and the whole line. Restored by deleting exactly the appended sentence; `cmp`: **0**;
the guard back to exit **0**, `Tests 25 passed (25)`.

### Plant C — the raised bound, watched both ways at its new site

Not a re-observation of the failure that was already read. The question this arm answers is
whether the assertion still evaluates the real population after the edit, or whether raising
the number quietly neutered it:

| arm | exit | observed |
|---|---|---|
| bound `41` | **0** | `Tests 29 passed (29)` — the population is 40, so 41 is the first value that passes |
| bound `40` | **1** | `AssertionError: expected 40 to be less than 40` at the new line 348 |

So the bound is measuring exactly 40 and bites at exactly the right place. Restored to 48 by
the surgical inverse; `cmp` against the snapshot taken immediately before the plant: **0**.

---

## Exit codes, read directly

`EXIT=$?` on the line immediately after each command, output redirected to a file and the file
read afterwards — no pipe, no trailing `tail`.

| command | exit |
|---|---|
| `vitest run --project node` acceptance-traceability + requirements-ledger (Task 1) | **0** — `Tests 61 passed (61)` |
| Plant A, the same two files | **1** — `2 failed \| 59 passed (61)`, text above |
| `cmp` after the surgical restore | **0** |
| `vitest run --project e2e demo-primes` (the G4 reading for Task 2) | **0** — `Tests 11 passed (11)`, `production callers: 0` |
| `vitest run --project node` requirements-ledger + vocabulary (Task 2) | **0** — `Tests 45 passed (45)` |
| `vitest run --project node vocabulary` — new file **untracked** | **0**, and **vacuous**; recorded rather than counted |
| `vitest run --project node` vocabulary + acceptance-traceability + requirements-ledger, file staged (Task 3) | **0** — `Tests 86 passed (86)` |
| Plant B, vocabulary | **1** — `1 failed \| 24 passed (25)`, file and line named |
| `cmp` after the surgical restore | **0** |
| `vitest run --project node vocabulary` after restore | **0** — `Tests 25 passed (25)` |
| `npx tsc --noEmit`, before the full run | **0** |
| **`npx vitest run --project node` — IN FULL, first completion** | **1** — `1 failed \| 178 passed (179)` files, `1 failed \| 2571 passed \| 1 skipped (2573)` tests, 388.15 real / 404.13 user / 55.93 sys |
| `vitest run --project node trust-anchors` after the bound raise | **0** — `Tests 29 passed (29)` |
| `npx tsc --noEmit` after the bound raise | **0** |
| Plant C arm 1, bound `41` | **0** — `Tests 29 passed (29)` |
| Plant C arm 2, bound `40` | **1** — `expected 40 to be less than 40` |
| `cmp` after the surgical restore | **0** |
| **`npx vitest run --project node` — IN FULL, confirming** | **0** — `Test Files 179 passed (179)`, `Tests 2572 passed \| 1 skipped (2573)`, 357.63 real / 395.81 user / 52.31 sys |
| the pre-commit cheap guards, on each of the four commits | **0** — `Tests 267 passed (267)` each time |
| `git show --stat` after each commit | only this plan's own files |

Both full-suite `(user+sys)/real` ratios are above one, so neither was taken from a starved
process. They are comparability keys, not verdicts.

---

## Deviations from Plan

### `[Rule 2 — missing critical functionality] a requirement id was minted, which the plan does not ask for`

- **Found during:** Task 1, on the operator's explicit direction that the sovereign-data
  sentence must not close as a log line.
- **Issue:** the plan's `requirements` frontmatter is `[MR-03…MR-07, DEMO-01, DEMO-02]` and
  contains no mechanism for a finding that has no row to attach to. The egress sentence had
  been measured by 27-07, restated by 27-08 and deferred by both, and a fourth deferral would
  have made it a habit.
- **Fix:** a `## Phase 27 Requirements` section following the Phase 25 / Phase 26 precedent,
  one id, `[ ]` **Not started**, with a traceability row carrying the five-file change, the
  four specs and the decider.
- **Verified:** the checkbox↔traceability join holds in both directions — plant A.

### `[Rule 1 — bug] the full node project was red, and it was red because of this phase`

- **Found during:** the verification the operator required, after Plan 27-09 could not finish it.
- **Issue:** `expected 40 to be less than 40` in `trust-anchors.node.test.ts`, caused by
  `demo-viewport.e2e.test.ts` in Plan 27-01's first commit. Red for the whole phase.
- **Fix:** bound raised 40 → 48 with the account and the re-siting in the docblock beside it.
- **Files:** `packages/node/src/trust-anchors.node.test.ts` — outside this plan's
  `files_modified`, and the alternative was to close the phase on a red suite.
- **Commit:** `ce638ba`

### `[deviation — scope] the operator's `index.html:1733` was stale, and a symbol was cited instead`

`window.o2.runJob` is now at line 2325; waves 27-08 and 27-09 grew the file. Rather than
record a coordinate that will rot again, the amendment cites `#byo-form`'s submit handler —
which is the answer `REQUIREMENTS.md` itself reached after measuring 41 of 46 of its own
citations landing on a blank line, a brace or prose inside a comment.

### `[deviation — method] the first vocabulary run over the new file proved nothing, and it is reported`

`vocabulary.node.test.ts` builds its corpus from `git ls-files`. The first green run over an
**untracked** `27-OPEN-ITEMS.md` was therefore a pass about a file the guard never opened. The
file was staged and the run repeated, and only then planted. Recorded rather than quietly
re-run, because the vacuous green is the same shape as the defect the plant exists to refuse.

### `[deviation — scope] `STATE.md` was not touched`

Consistent with 27-05 through 27-09, all of which recorded the same, and with the operator's
instruction that the state verbs are measured to corrupt the file. Its `stopped_at` is a
sixty-line YAML block scalar under `state-frontmatter.node.test.ts`'s parseability guard, and
it is not in this plan's `files_modified`. **It is stale about this phase**, and that is
recorded in `27-OPEN-ITEMS.md` rather than left silent.

---

## Threat Model — dispositions met

| Threat ID | Disposition | How it was met |
|---|---|---|
| T-27-37 | **mitigate — met** | Every row was decided one at a time with its verdict and reason written out, and **no row was closed**. The four rows whose criteria no surface exercises are named individually with what is missing; the fifth is recorded as an owner decision rather than ticked. The two ledger guards were run against the result and the green shown to be the checked kind by an observed matched-row count of 95 → 96 on both patterns, plus plant A. |
| T-27-38 | **mitigate — met** | G4 is amended in place with both halves named — the closed one citing `demo-byo.e2e.test.ts` and four arms, the open one citing `demo-primes.e2e.test.ts`'s own printed reading — following this file's keep-the-original convention: the 2026-08-08 amendment and the struck original are both still legible and nothing was deleted. `grep -n "G4"` leaves no sentence reporting the two halves as one. |
| T-27-39 | **mitigate — met** | Every entry in `27-OPEN-ITEMS.md` names a decider and a cost, including the eight items inside tables, which carry a decider per section and per row where it differs. Section 10 lists what **closed**, so the register cannot silently accumulate dead entries either. |

---

## Known Stubs

**None introduced.** This plan writes no page code and adds no region. `EGR-01` is an open
requirement rather than a stub: nothing on screen is a placeholder for it, and the limit it
names is already stated in the bring-your-own card's own prose and in the fabric card's, beside
the reading each renders.

---

## What Phase 27 did NOT deliver

Written as a list rather than distributed through eleven sections, because this is the part a
reader is owed in one place.

1. **A Primes workload.** Twelve regions, zero buttons, nothing runs. The roadmap calls Primes
   one of two load-bearing surfaces. Option A was costed and not begun.
2. **A ticked MR row.** All five are still `[ ]`. The phase changed the demo half of a clause
   and did not change the boxes, and MR-03's tick is an unowned owner decision.
3. **A fix for the sovereign-data sentence.** Five surfaces still render *this run registered
   no sovereign data* on dispatches that carried sovereign shards. It has an id, a corrected
   five-file change and a decider, and it is not fixed.
4. **A UI-SPEC that agrees with the page.** Ten corrections are owed, every one a place where
   the contract is wrong and the page is right. Not one was applied; the contract's §12
   sign-off is still `pending`.
5. **A guard set that can see what it claims to.** P5b's exempt set is at least 24 and nothing
   asserts it; P5's skip list is printed and unasserted; the whole fabric surface is outside
   five properties; the bar's three regions resolve to nothing checkable; five status elements
   carry digits P2 never runs against.
6. **A type-checked page driver.** Four hundred lines of untyped JavaScript inside
   `index.html` calls every typed module the phase added.
7. **More than one browser engine.** Every `e2e` spec launches chromium alone, so nothing in
   this phase has been seen in Firefox or WebKit — and the mobile defect that motivated Plan
   27-01 is an iOS Safari behaviour no instrument here reproduces.
8. **The withheld egress branch.** Never fired, now for a measured reason: a tab cannot be
   handed a real owner identity, and `TabApi.start` deliberately has no parameter for one.
9. **A current `STATE.md`.** Not touched, by instruction and by precedent, and stale about
   this phase.
10. **A suite that had been run.** Nine waves closed on a red `--project node`. That one is
    fixed, and it is listed here because *the fix is not the finding* — the finding is that
    the phase's own verification convention allowed it.

---

## Commits

| hash | what |
|---|---|
| `837a70e` | `docs(27-10)` — the MR rows distinguish two merges; DEMO-01/02 widened; `EGR-01` minted |
| `80778a8` | `docs(27-10)` — G4 split in the ledger the way it is split in fact |
| `c742bec` | `docs(27-10)` — `27-OPEN-ITEMS.md`, and the Primes disposition in the roadmap as prose |
| `ce638ba` | `fix(27-10)` — the provenance opt-out bound, red since 27-01 and unseen by nine waves |
| *(this file)* | `docs(27-10)` — the summary |

Each committed with `git commit -m "…" -- <explicit paths>`, `-m` before `--`, never bare, and
each verified with `git show --stat` to contain only this plan's own files.

## Self-Check: PASSED

- `.planning/phases/phase-27-demo-ui-driven-by-real-fabric/27-OPEN-ITEMS.md` — FOUND, **324
  lines** (`min_lines: 60`), `Option A` present
- `.planning/v1.1-MILESTONE-AUDIT.md` — FOUND, modified; `G4` present; both the 2026-08-08
  amendment and the struck original still present
- `.planning/REQUIREMENTS.md` — FOUND, modified; `MR-03` present; `demo-pi` present; `EGR-01`
  present in both the checkbox section and the traceability table
- `.planning/ROADMAP.md` — FOUND, modified; the Primes disposition present as prose in the
  Phase 27 entry, outside the HTML comment
- `packages/node/src/trust-anchors.node.test.ts` — FOUND, modified
- commits `837a70e`, `80778a8`, `c742bec`, `ce638ba` — all FOUND
- `git status --porcelain` clean before both full-suite runs and after every plant restore;
  every `cmp` exit **0**
