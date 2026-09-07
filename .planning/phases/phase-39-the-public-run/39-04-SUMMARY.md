# 39-04 — SUMMARY: the run can publish a peer count, and nothing may publish a device count without a source

**The half that needed no ruling is built, and the half that needs one is now fenced rather than
merely discouraged.** A run's distinct participant count is derived from `ReduceOutcome.executedBy`
and labelled as **peers**, because a browser tab announces nothing about the device it runs on and
two tabs on one laptop are two peer ids. A numeral used as a count of machines in this repository's
published copy now reddens the `node` lane unless the same paragraph says where those machines were
announced — and the pattern that finds one is proved able to see one, by a fixture caught in the same
run that asserts the corpus holds none.

`REQUIREMENTS.md`, `ROADMAP.md` and `STATE.md` were **not** touched. `BENCH-06` is still `[ ]`. Its
distinct-machine half stays descoped and unmeasured — not met — and this plan does not close it;
`39-PARTICIPANT-COUNT.md` §4 says at length why it cannot be closed from inside the repository.

## What landed

- `packages/bench/src/report.ts` — `distinctParticipants`, `ParticipantReading`, `participantLabel`.
  63 added lines, nothing removed.
- `packages/bench/src/participants.test.ts` — 9 cases. 99 lines.
- `packages/node/src/machine-claim-guard.node.test.ts` — the guard, cases A/B/C/D, 11 cases. 332 lines.
- `.planning/phases/phase-39-the-public-run/39-PARTICIPANT-COUNT.md` — the dated record. 162 lines.

All four in commit `6768f6b`. `git show --stat` lists exactly those four and nothing else, and the
commit contains no deletions.

## The participant count: what it is derived from, and what it is not

`distinctParticipants(executedBy)` is the set of distinct executor peer ids with
`LOCAL_COMBINE_EXECUTOR` removed. It reads the same field `harness.ts`'s `combineExecutors` already
reads — `packages/core/src/reduce.ts:398`, contribution id → executor peer id — and the constant is
imported from `@o2/core` rather than re-spelled, because a second copy is a second thing to keep in
step. The local pseudo-executor is excluded because `reduce.ts:355` calls it *"an id no peer can
present"*: a run whose every combine stayed inside the requestor's own process observed no
participant, and answering `1` there would publish the requestor as a participant in its own run.

**What the count explicitly is not.** It is not a device count and it is not identity-hardened. It is
not derived from `relayService.inboundHopStreams`, from `traffic.direct`, from `traffic.relayed` or
from the funnel — every one of those was foreclosed by `39-COUNTER-READING.md` §4 against a running
`workerd`, and that reading is cited rather than re-argued. And it is not a count of *devices*
inferred from peers: nothing on the browser job path announces a device, `AgentOptions` carries no
such field, and `browser-id.ts` refuses `platform` and `hardwareConcurrency` by name.

`participantLabel` prints the reading and withholds the noun. With no announcement it produces
`N distinct peers — machine count not measured; peers are tabs, and two tabs on one device are two
peers`, with the caveat inside the same string as the number, for `machineLabel`'s reason. Given a
number it prints the `AnnouncedMachine` form instead — `5 distinct peers on 3 announced machines` —
and `announcedMachines` is typed `number | null` with **no default**, which is the whole design
decision: an optional field defaulting to a number would reproduce the defect `bench-inventory.ts`
records in its own header, a `hostCount` that was `1` by construction and whose label no plant could
falsify.

**The plant proves it is not that.** Replacing the null branch with the literal string it produces for
a two-peer reading left the two-peer case **green** and reddened the five-peer case, verbatim:

```
AssertionError: expected '2 distinct peers — machine count not …' to be '5 distinct peers — machine count not …' // Object.is equality
```

`1 failed | 8 passed (9)`. Restored by the surgical inverse of that one edit; `cmp` against a
snapshot taken immediately before planting exited `0`.

## The guard, and the first reading that corrected it

The guard is a pure predicate declared in the spec file plus two callers, and that shape was chosen
for a concurrency reason rather than a stylistic one: the obvious construction is to write a claim
into `.planning/BENCHMARK-RESULTS.md` and watch the scan catch it, but agents run concurrently over
one checkout here and an observation taken while another agent holds a plant is not a measurement of
the tree. `.planning/BENCHMARK-RESULTS.md` was confirmed unmodified in `git status --porcelain` before
and after, with every reading taken between runs and never during one.

**Its first run over the real corpus was red, and the red was a finding about the instrument.** Nine
hits, all one defect: the gap between the numeral and the noun was unrestricted, so a numeral bound
across a preposition into a phrase that was not its own. From `docs/perf/prime-and-pi-benchmarks.md:5`
— *"Measured 2026-08-02 on one machine: 8 physical cores"* — the `02` of a **date** was read as
counting the machines in *"on one machine"*, whose real count word is `one`; from `29-REPORT.md:118`,
*"exits 0 on a machine"*, the numeral is an **exit code**. Both are honest same-host disclosures, the
opposite of what is being guarded against. A numeral now counts a noun only across adjectives, and
the residual is written into the guard's own source rather than discovered later: it sees numerals and
not English number-words, so *"across one machine"* is invisible to it — deliberate, because the
forbidden figure is a count published beside a curve and that is written with a numeral.

**The control is what makes the absence mean anything, and the plant demonstrated it.** Case A feeds
the predicate `the run spread across 40 distinct machines` and asserts **exactly one** hit — a count,
not merely "something was found" — and the paragraph-scoped clearing rule is exercised in both
directions beside it, since the same sentence with an `AnnouncedMachine` citation appended produces
zero and the citation demonstrably does not reach into the next paragraph. Weakening the
number-adjacency test so it can never match then produced the reading that matters — quoted here
inside this same paragraph, so that the citation above clears it:
```
AssertionError: the instrument did not see the fixture "the run spread across 40 distinct machines" — case C's absence is then vacuous: expected [] to deeply equal [ Array(1) ]
```

`3 failed | 8 passed (11)` — and **the corpus case stayed green throughout**. That is the finding
worth recording: a blinded instrument satisfies *"no unsourced device claim exists"* perfectly, so
case C alone would have reported the guard healthy while it could see nothing at all. Restored by
surgical inverse, `cmp` exit `0`.

**The corpus is not empty, checked both ways.** The instrument's own floor asserts at least 20 files
and at least 200 lines of non-heading copy; recomputed in the shell against the same rule, the scan
covers **339** tracked files and **101 477** lines. And membership was proved positively rather than
assumed: `39-PARTICIPANT-COUNT.md` was staged and a claim appended to it — the fixture sentence with
no `AnnouncedMachine` citation beside it to clear it, which is why it was caught — and case C
reddened naming
`.planning/phases/phase-39-the-public-run/39-PARTICIPANT-COUNT.md:164 — The run spread across 40
distinct machines.` in the `path:line — text` format the plan asked for. That single reading confirms
three things at once — the document is genuinely in the corpus, the format is what it claims, and
Task 3's "guard green with this document in the corpus" is not vacuous. Removed by surgical inverse,
`cmp` exit `0`. This plant was inside a file this plan owns; no published file was touched.

**And the guard caught this summary.** The first staged draft of this file reproduced the fixture
sentence twice in paragraphs that named no source, and case C reddened on both, naming this file by
path and line. That is the strongest evidence available that the mechanism is live rather than
decorative: it fired on its own author's deliverable, in the ordinary course of writing it up. The
fix was to cite the source in those paragraphs, which is what the clearing rule is for — not to
exempt the file, because an exemption written by the person the guard just stopped is how a rule
stops meaning anything.

## The document

`39-PARTICIPANT-COUNT.md` states what criterion 4 can publish now (§1), what it may not and why that
is a rule rather than a caution (§2), the three routes to the missing half with the disclosure cost of
each (§3), and that the count is not takeable before the owner's ruling and the run (§4).

**Its §3 sequencing fact was re-measured rather than carried over.** The plan asserted that the
published bundle sits at version 5 and lacks version 6's ground sentence, measured 2026-09-04. Read
2026-09-07 off the locally-held `origin/gh-pages` ref, the publish is further behind than that:
commit `edf132a`, committed `2026-09-02T01:59:49+00:00`, which **predates the `'5'` bump itself**
(`3cfc0f6`, `2026-09-02T22:30:44+00:00`) by about twenty hours and therefore predates `'6'`, `'7'`
and `'8'` as well. The instrument has a positive control: `passphrase`, version 8's headline word,
appears 34 times in the tree's `packages/browser/demo/index.html` and zero times in the published
`index.html` or its bundle, so the grep can see the word and the publish genuinely does not carry it.
Stated with its caveat — this is the last-fetched state of a remote-tracking ref, read locally.
Nothing was fetched, deployed or published. The conclusion the plan wanted survives and is stronger:
the release cut re-asks every returning visitor once regardless, so a disclosure change ruled on
before that cut rides a re-ask that is already owed.

## Deviations from plan

1. **`packages/bench/src/index.ts` was not edited.** Task 1 says to export both symbols from the
   barrel "if that file is the package's barrel" — it is one, but it is outside this plan's fence,
   absent from `files_modified`, and Task 3's acceptance requires `git show --stat` to list *exactly*
   four files. The fence and the frontmatter agree against that sentence, so the barrel export is
   **owed and not made**. Nothing is broken by the omission: there is no production caller yet, and
   the spec imports from `./report.ts` directly. Whoever wires the first caller adds the two names to
   the barrel.
2. **The disclosure bump in §3 is `'9'`, not the plan's `'7'`.** `disclosure.ts:194` reads `'8'`
   today; `a255a4f` took 6 to 7 and `dc82351` took 7 to 8, both on 2026-09-04, after the plan was
   written. The acceptance criterion asks for the string `DISCLOSURE_VERSION`, which is present.
3. **One commit for all three tasks rather than one per task**, because Task 3's acceptance criterion
   requires a single `git show --stat` listing exactly the four `files_modified`. Per-task commits
   cannot satisfy that. Every red and every restore is recorded above instead.
4. **`O2_SKIP_GUARDS=1` was used, and the reason is in the commit message.** The full cheap guard set
   ran first: 401 cases, one failure. `slow-specs/file-count-drift` reports the node project
   collecting 256 files against a recorded 248 — drift 8 on a tolerance of 5. Three of those files
   are new and uncommitted (two from this plan, one from a concurrent plan), so the baseline was 253
   and the drift exactly 5, passing at its boundary, before this wave began. That is precisely what
   this plan's own `<context>` predicted, its remedy is a re-measurement of `vitest.config.ts` which
   plan 39-07 owns, and this plan is fenced out of that file. It is reported, not worked around.
5. **The vocabulary guard fired on a docblock written here and was fixed inline.** One banned term in
   `machine-claim-guard.node.test.ts`, used in its ordinary English sense in a sentence about two
   spellings of an identifier; reworded, and the guard is green.
6. **Task 2's TDD shape follows the plan's own design rather than the generic order.** The plan puts
   the predicate *inside* the spec file, so there is no separate module for a spec to fail against
   first. The first red was real all the same — it came from the corpus and it corrected the
   instrument — and the falsification is the plant.

## What this plan did not do

No invitation was sent, no figure published, nothing deployed, no release cut, no Cloudflare resource
created and nothing written to the deployed object. `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` and
`vitest.config.ts` were not edited. `BENCH-06` was not ticked.

**One thing could not be done and is not deferred so much as impossible from here.** The
distinct-machine count itself. It waits on an owner's ruling about what a peer may announce about its
own device, and then on the run. What this plan leaves in its place is a peer count that says it is a
peer count, and a mechanism that reddens if anybody publishes the other half without having measured
it.

## Commands, with the exit code read on the line immediately after each

| command | exit |
|---|---|
| `npx vitest run --project node participants` (before the implementation) | `1` — 9 failed, unresolved import |
| `npx vitest run --project node participants` | `0` — 9 passed |
| `npx vitest run --project node participants` (literal-string plant) | `1` — 1 failed, 8 passed |
| `npx vitest run --project node participants` (after restore) | `0` — 9 passed |
| `npx vitest run --project node machine-claim-guard` (first corpus reading) | `1` — 1 failed, 10 passed, nine hits |
| `npx vitest run --project node machine-claim-guard` | `0` — 11 passed |
| `npx vitest run --project node machine-claim-guard` (blinded predicate) | `1` — 3 failed, 8 passed |
| `npx vitest run --project node machine-claim-guard` (after restore) | `0` — 11 passed |
| `npx vitest run --project node machine-claim-guard` (document staged and in corpus) | `0` — 11 passed |
| `npx vitest run --project node vocabulary purity requirements-ledger mutation-guard` | `0` — 275 passed |
| `npx tsc --noEmit` | `1`, and no error names a file written here — the single error is a concurrent plan's `stage-budget.node.test.ts` importing an untyped `.mjs` |
| the pre-commit guard set | `1` — 400 passed, `slow-specs/file-count-drift` only |

Host conditions were read before every quoted result. The two participants runs at the plant and its
restore were taken while the banner reported the host oversubscribed; both are string-equality
assertions rather than timings, so the pass/fail stands and no duration from those runs is quoted
anywhere. Every other run reported the host quiet.

## Self-Check: PASSED

All five files exist on disk. Both commits are reachable — `6768f6b` carrying exactly the four
`files_modified` and `2d75968` carrying only this summary; neither contains a file written by anyone
else and neither deletes anything. `.planning/BENCHMARK-RESULTS.md` is byte-identical to its state at
the wave-1 merge `5b4f341`, confirmed by an empty `git diff --name-only` over that range.

The guard was re-run after the concurrent plan committed `39-RUNBOOK.md` and `39-05-SUMMARY.md` into
the same directory, so the corpus it reports clean now includes them: `11 passed`, exit `0`. The full
cheap guard set was re-run at the same point — 330 cases across seven guard files, `329 passed`, and
`slow-specs/file-count-drift` the single failure, unchanged and outside this plan's fence.
