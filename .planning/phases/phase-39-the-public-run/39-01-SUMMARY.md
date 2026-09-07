# 39-01 — SUMMARY: the gate written down, and the thing that notices a row losing its evidence

**`RUN-01` is NOT closed by this plan and `.planning/REQUIREMENTS.md` was not touched.** Its box
is still `[ ]`. What landed is the deliverable the requirement names — a dated checklist with the
evidence behind each of the seven conditions — and the guard that refuses to let that document
decay quietly. Whether the owner then reads it and sends the invite is his act, and this plan
does not perform it.

The distinction worth stating first, because it is the whole reason this plan existed: **all
seven conditions were already `Done` with ticked boxes before a line of this was written.** The
engineering was finished in Phases 35 and 36. What did not exist was any place where somebody
other than the author could see, in one reading, which conditions hold and on what evidence.
`RUN-01`'s own sentence is *"a row with no named evidence is a no-go, not a judgement call"*,
and that sentence needs a document with rows in it before it can be applied by anyone.

## What landed

- `.planning/phases/phase-39-the-public-run/39-GO-NO-GO.md` — dated 2026-09-07. A header naming
  why the gate exists (a Telegram-recruited cohort of a few hundred is spendable exactly once;
  SETI@home's move to BOINC lost roughly half of ~600 000 volunteers to added platform
  complexity alone, no bug and no bad actor), the seven-condition table, a separately-headed
  preconditions table, and a closing section naming the guard and stating its citation contract.
- `packages/node/src/go-no-go-checklist.node.test.ts` — 749 lines, 29 cases, in the `node`
  project lane. Modelled on `acceptance-traceability.node.test.ts`: its parse floors and its
  self-exclusion are that file's, copied rather than reinvented.

Both landed in one commit, `57e13da`, with explicit paths. `git show --stat` lists exactly the
two files; a concurrent agent's staged `packages/cloudflare/src/relay-counters.e2e.test.ts` was
in the index at commit time and was not swept in.

## The seven read GO, and the seven are the only rows that are part of the gate

| Condition | Disposition | The evidence the row names |
|---|---|---|
| `BROW-06` | **GO** | `packages/browser/src/gateway-module.ts:206-214`, `packages/node/src/artifact-fetch-gate.e2e.test.ts`, `packages/browser/demo/main.ts:3205-3225` |
| `BROW-07` | **GO** | `packages/browser/src/computing-indicator.ts`, `packages/browser/demo/main.ts:797-821`, `packages/node/src/computing-indicator.e2e.test.ts` |
| `BROW-08` | **GO** | `packages/node/src/hard-stop.e2e.test.ts`, `packages/cloudflare/src/stop-closes-the-billed-socket.e2e.test.ts` |
| `BROW-09` | **GO** | `packages/node/src/disclosure-four-elements.node.test.ts`, `packages/node/src/disclosure-before-optin.e2e.test.ts`, `packages/browser/src/disclosure.ts:194`, `packages/browser/demo/policy.html` |
| `BROW-10` | **GO** | `packages/browser/src/data-cost.ts` |
| `RUN-02` | **GO** | `packages/node/src/kill-switch-regions.e2e.test.ts`, `packages/cloudflare/src/admission-slices.e2e.test.ts`, `packages/browser/src/kill-switch.ts` |
| `RUN-03` | **GO** | `packages/node/src/kill-switch-volunteer.e2e.test.ts`, `packages/node/src/status-page-address.node.test.ts`, `packages/browser/demo/status.html`, `packages/browser/demo/policy.html` |

Every one of those paths was checked to exist before the row was written, and is checked to
exist on every run of the `node` project afterwards. Each row additionally cites the two places
`.planning/REQUIREMENTS.md` says it: the checkbox row carrying the tick, and the traceability row
carrying the reading the evidence was transcribed from.

**Seven rows read `GO` and seven preconditions read `NO-GO`.** The preconditions are the
published page being two disclosure versions behind the tree, the front-door request budget,
the funnel reaching its collector, `RUN-06`'s remaining half, Phase 33's three regions, Phase
34's fallback rungs, and `BENCH-06`'s distinct-machine reading path. Its first sentence says
they are **not part of RUN-01's gate**, so nobody can read the document as having widened the
requirement — and the `RUN-06` row is the case that proves the document is being written before
the run rather than after it: Phase 38's waves 1 and 2 merged at `7396a17` and moved that row
`Not started` → `Partial`, so it is a live `NO-GO` on the day of writing and the tree is green
with it there.

## Three things were re-derived and came back different from the plan

The plan says to transcribe the ledger's evidence and never re-derive it, and that rule is
right — a second derivation is a second source and two sources drift. But three of the figures
it hands over were themselves already stale, and transcribing them would have put a false
sentence into the document that gates the irreversible act.

**The ledger's line numbers had moved.** The plan cites `BROW-06` at `.planning/REQUIREMENTS.md:1931`
through `RUN-03` at `:1938`, read on 2026-09-04. On 2026-09-07 the checkbox rows are at `:1378`,
`:1383`, `:1386`, `:1393`, `:1396`, `:1404` and `:1409`, and the traceability rows carrying the
evidence are at `:2179`–`:2187`. The document cites the current numbers and says what day they
were read.

**`DISCLOSURE_VERSION` is `'8'`, not `'6'`.** The plan and the `BROW-09` ledger row both record
`packages/browser/src/disclosure.ts:143` reading `'6'`. Measured on 2026-09-07 the constant is at
`:194` and reads `'8'`. The row still reads `GO` — the condition is that plain-language
disclosure is shown before opt-in and asserted, and it is — but the document records the
amendment beside the transcription rather than restating a figure that has moved twice since.

**`packages/browser/demo/main.ts`'s two line ranges had drifted by roughly a thousand lines.**
The ledger's `BROW-06` row cites `demo/main.ts:2318-2331` for the consent → fetch reorder; that
docblock is now at `:3205-3225`. `BROW-07`'s `:212-268` for the indicator wiring is now
`:797-821` (`beginComputingIndicator` / `endComputingIndicator`). Both were verified by reading
the lines, not by assuming.

There is a fourth, smaller correction that the guard by design could **not** have caught. The
plan's preconditions text cites `37-RUNBOOK.md`; the phase directory is
`phase-37-the-six-stage-funnel-and-a-frozen-telemetry-schema`, not `phase-37-the-recruitment-funnel`.
The wrong path was written first and found by `ls`. It sits in a `NO-GO` row, and a `NO-GO` row
is deliberately not held to path resolution — a blocker legitimately names something that does
not exist yet — so the suite was green with it wrong. That is a real limit of the instrument and
it is stated in the guard's own docblock rather than left to be discovered.

## The guard, and what it will and will not refuse

It reads the checklist and the ledger from `ROOT` computed exactly as
`acceptance-traceability.node.test.ts` computes it, and refuses four things: a seven-condition
table that is not exactly `BROW-06`, `BROW-07`, `BROW-08`, `BROW-09`, `BROW-10`, `RUN-02` and
`RUN-03`; a disposition that is any word other than `GO` or `NO-GO`; a `GO` row whose evidence
cell names no path, or names one that no longer resolves, or points past the end of the file it
cites; and a `GO` row naming a requirement whose ledger box has come unticked — re-read from the
ledger's own checkbox rather than trusted from the transcription, which is T-39-02's mitigation.

**The parse is scoped by section, and that choice is what makes the whole design work.** The two
tables carry two different rules: the first must hold exactly the seven ids, the second may name
`RUN-06`, `HOST-06` or `NET-12` without any of them becoming an eighth condition. A single
document-wide row parse cannot hold both at once, so `section()` finds each table under its `##`
heading and the rules are applied per table. The cost — a renamed heading empties a section
silently — is covered by asserting both sections were *found* and by a floor on each table's row
count.

**Four floors, each a literal.** `ROW_FLOOR = 7`, `PRECONDITION_ROW_FLOOR = 5`,
`EVIDENCE_PATH_FLOOR = 7`, `LEDGER_JOIN_FLOOR = 7`. They exist because almost every assertion in
the file is of the shape *this list is empty*, and **a checklist parser that finds zero rows
proves that no row lacks evidence, flawlessly and vacuously**. None of the four is derived from
the parse it polices.

**What it cannot see, stated rather than left to be found.** An id-shaped word in a row is
checked against the ledger only if the ledger has a checkbox for it. That narrowing is deliberate
— a row's prose legitimately carries `T-39-01` from a threat register or `DEMO-01` from a case
name, and a guard that fires on honest prose gets deleted the first time it fires. The price is
that a typo like `BROW-66` is ignored rather than reported. The set equality on the `Condition`
column catches a typo where it matters; `LEDGER_JOIN_FLOOR` is what keeps the narrowing from
becoming a hole, by proving the join found real ids at all.

**The citation contract is backticked and repo-root-relative**, optionally suffixed `:N` or
`:N-M`. Requiring the backticks is not decoration: a bare path harvested from prose picks up the
full stop that follows it, and `…/data-cost.ts.` resolves to nothing and reddens a row that is
perfectly honest. Requiring repo-root-relative has already been paid for once — the ledger's own
`BROW-06` row writes `demo/main.ts:2318-2331`, which is relative to `packages/browser/` and
resolves to nothing from the root. The document normalises; the guard is where the requirement
to normalise is written down.

## What was watched red

**The instrument itself, against a checklist that did not exist.** The guard was written and run
before the document. `EXIT=1`; 10 of 29 cases failed and 19 passed. The failure the plan asks to
be recorded is the set equality, verbatim:

```
AssertionError: the seven-condition table does not match RUN-01's list. Missing: BROW-06,
BROW-07, BROW-08, BROW-09, BROW-10, RUN-02, RUN-03. Unexpected: none: expected
{ missing: [ 'BROW-06', …(6) ], …(1) } to deeply equal { missing: [], unexpected: [] }
```

That the file is read defensively rather than thrown on is what produces this message instead of
a collection error: an absent checklist must fail as *the seven conditions have no rows*, not as
*the suite could not load*. The 19 that passed in the same run are the synthetic block, which is
the point of it — the instrument's failure modes are provable against input whose right answer is
known, with no live document present at all.

**The `GO`-with-no-evidence plant.** With the document in place and green (`EXIT=0`, 29/29), the
preconditions row `**The funnel reaches its collector**` was flipped from `NO-GO` to `GO` and its
evidence cell emptied, one line, line 53. `EXIT=1`, exactly one case red:

```
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "The funnel reaches its collector (.planning/phases/phase-39-the-public-run/39-GO-NO-GO.md:53)
+    reads GO and its evidence cell names no path at all — a row with no named evidence is a
+    no-go, not a judgement call",
+ ]
```

Restored by the surgical inverse — the same one line put back from a copy of itself taken
immediately before planting, not a whole-file `cp` — and `cmp` against the pre-plant snapshot was
**silent**. Re-run after restore: `EXIT=0`, 29/29.

**The remaining failure shapes were driven with synthetic input rather than by planting into the
live document.** A `GO` row whose citation stopped resolving, a `GO` row naming an unticked
requirement, a disposition that is a third word, and a `NO-GO` row naming nothing each have a
case, because producing the first of those against the live tree would mean deleting a file
another plan owns. The resolver is injected for exactly this reason. No plant stayed green.

**The case that carries the property the whole document depends on** is *"does not hold a `NO-GO`
row to the evidence rule a `GO` row is held to"*: a `NO-GO` row cites a path that does not
resolve, names an unticked requirement, and is still not a failure. Beside it, a case takes every
`NO-GO` row **from the live document** and asserts the verdict function returns the literal
`recorded, not failing` — and asserts first that there is at least one such row, so that the day
nothing is `NO-GO` this case says so rather than passing over an empty list.

## The red the plan predicted did not happen, and the arithmetic says why

The plan states that `packages/node/src/slow-specs.node.test.ts` passes *at its boundary* — 241
collectable files against `NODE_MEASUREMENT.files` recording 236, drift exactly 5 against a
tolerance of 5 — and that this plan's spec takes the drift to 6 and reddens it, to be recorded
and left for 39-07.

**It did not redden.** `npx vitest run --project node slow-specs` → `EXIT=0`, 15/15. The premise
moved between the plan being written on 2026-09-04 and today: `vitest.config.ts:484` now records
`files: 248`, not 236. Reproducing the guard's own walk gives **252** files in the node project
with this plan's spec included — it is counted, the walk is a filesystem walk and not
`git ls-files` — so the drift is **4**, inside the tolerance of 5.

Recorded rather than acted on, and one number is worth passing to 39-07: the headroom is now
**one file**. 39-02's `packages/browser/src/funnel-probe.test.ts` matches the node project's
include and takes the drift to 5, which is the boundary the plan believed this plan was already
at. `vitest.config.ts` was not touched.

## Every command, with the exit code read on the line immediately after it

| Command | Exit | What it showed |
|---|---|---|
| `npx vitest run --project node go-no-go-checklist` (no document) | **1** | 10 failed, 19 passed — the watched red for the instrument |
| `npx vitest run --project node go-no-go-checklist` (document in place) | **0** | 29 passed |
| `npx vitest run --project node go-no-go-checklist` (planted) | **1** | 1 failed, 28 passed — the watched red for the plant |
| `cmp <snapshot> 39-GO-NO-GO.md` after restore | **0** | silent |
| `npx vitest run --project node go-no-go-checklist` (restored) | **0** | 29 passed |
| `npx tsc --noEmit` | **0** | no output at all, so no error names any file and the run did not die early on another agent's mid-edit parse |
| `npx vitest run --project node slow-specs` | **0** | 15 passed — the predicted red did not occur |
| `git commit … -- <two paths>` | **0** | the pre-commit guard set ran 401 cases across 9 files, all green; no `O2_SKIP_GUARDS` was needed |

The `[host conditions]` banner read **quiet** on every run — `load/core` between 0.63 and 0.92
against a ceiling of 4.00 on 8 cores — so the durations quoted above stand rather than being
void. They are all under a second in any case; nothing here is a timing claim.

Acceptance greps, each run directly: each of the seven ids appears at least once in the document
under `grep -v '^#'` (4, 2, 2, 2, 3, 3, 3); `awk '/^\| Condition/,/^$/' | grep -c '^| '` is **9**,
which is 7 data rows plus header and separator; `not part of RUN-01's gate` appears **1** time;
`grep -c 'GATE_CONDITIONS'` on the spec is **6**; `grep -v '^ *\*' | grep -c "'BROW-06'"` is
exactly **1**, so each gate id is a quoted literal in one place only, `GATE_CONDITIONS`.

## Threat register — what held

`T-39-01` (tampering with the checklist) and `T-39-04` (the parse dying and reading as clean) are
mitigated and each was watched red: the first by the `GO`-with-no-evidence plant, the second by
the four literal floors plus a synthetic case asserting the parse reports nothing at all when the
document is gone. `T-39-02` (evidence transcribed across two files that drift) is mitigated by
re-reading the ledger's own checkbox, and the three stale figures found above are the same threat
observed live — the transcription had already drifted and the document says so. `T-39-03` and
`T-39-05` were accepted and nothing changed that: the document names only files and requirement
ids already public in this repository, carries no credential and no location claim, and neither
file has a runtime caller.

## What was not done

`.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` and `.planning/STATE.md` were not touched, on
instruction — the owner moves the ledger after reading this. `vitest.config.ts` was not touched.
No invite was sent, nothing was deployed or published, no Cloudflare resource was created, and
nothing was written to the deployed Durable Object. The only reading taken against anything
outside this repository is the published-bundle grep recorded in the first preconditions row,
which is transcribed from the plan as a dated 2026-09-04 measurement and was not re-taken here.
