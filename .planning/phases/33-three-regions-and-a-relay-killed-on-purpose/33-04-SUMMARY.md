---
phase: 33-three-regions-and-a-relay-killed-on-purpose
plan: 04
subsystem: node
tags: [vitest, typescript, guard, disclosure]

requires:
  - phase: 33-three-regions-and-a-relay-killed-on-purpose
    plan: 01
    provides: HOSTED_OBJECT_NAME (read as text, never imported)

provides:
  - "location-claims.ts — the closed term list, the placement-verb set, and rawLocationClaims(),
    the matcher both tiers of HOST-07's guard share, proved independently of where a file lives"
  - "location-claims.node.test.ts — one command that refuses a listed place name on the
    published surface and in the results (Tier 1), and an address named beside a placement verb
    anywhere in the tracked tree (Tier 2), with an exemption layer, a dead-exemption check, and
    a substituted positive control for each tier"

affects: []

tech-stack:
  added: []
  patterns:
    - "Two independent tiers sharing one matcher: a restricted-corpus term scan and a
      whole-tree attribution scan, so an invented location is caught even when it is not on
      the term list — Tier 2 is proved independent of Tier 1's list by a plant that leaves
      Tier 1 green while it reddens Tier 2"
    - "Exemption phrases keyed on a substring of the offending line, never a line number,
      copied from vocabulary.node.test.ts; for an attribution finding the phrase need only
      cover the placement-verb span, not the address, which keeps an exemption's own source
      line from becoming a second violation of the rule it is exempting"

key-files:
  created:
    - packages/node/src/location-claims.ts
    - packages/node/src/location-claims.node.test.ts
  modified:
    - vitest.config.ts
    - packages/node/src/reachability-guard.node.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "LOCATION_TERMS populated from two measured sources: the platform's own published
    locationHint vocabulary (nine codes, spelled out as the place name a document would
    actually write), plus three names already at risk in this project's own writing, confirmed
    present by grep rather than assumed. All twelve terms grepped against the actual Tier 1
    corpus before being finalized; the result reproduced the plan's stated pre-existing hits
    exactly, file and line, with zero hits from the other nine — convergent evidence the list
    matches what the hits were measured against."
  - "The Tier 2 exemption for packages/libp2p/src/admission-directive.ts keys on the
    placement-verb phrase alone, deliberately omitting the region address it also names.
    Including the address in the phrase would place an address next to that same verb on one
    physical line of this spec's own source, which its own Tier 2 scan then flags about
    itself — caught on first write by the case built for exactly that purpose."
  - "ORPHAN_MODULE_CEILING raised 34 -> 35, naming location-claims.ts, on the precedent already
    accepted for banned-vocabulary.ts/commit-scope.ts/strip-comments.ts: a module whose only
    importer is its own .node.test.ts spec, which the traced production-reachability graph
    does not walk."
  - "HOST-07 marked Done in both the checkbox and the ledger table row — see Requirements
    Ledger section."

requirements-completed: [HOST-07]

duration: ~110min
completed: 2026-09-14
---

# Phase 33 Plan 04: HOST-07's Guard Summary

**One node-lane spec refuses a listed place name anywhere on the published surface or in the results, and independently refuses any tracked line naming one of the three closed region addresses beside a placement verb — catching an invented location as well as a listed one — proved by two real plants watched red and restored, and by a positive control built entirely by substitution.**

## Performance

- **Duration:** ~110 min
- **Tasks:** 2 completed
- **Files modified:** 5 (2 created, 3 modified — one outside the plan's stated file list, see Deviations)

## Accomplishments

- `packages/node/src/location-claims.ts`: `LOCATION_TERMS` (12 rows, each `why` over 20
  characters), `PLACEMENT_VERBS` (one `/gi` alternation over 14 phrasings), and
  `rawLocationClaims(file, content, addresses)` — one walk over the lines producing a `'term'`
  finding for every listed place name and at most one `'attribution'` finding per line for an
  address named beside a placement verb, tagged so a caller can filter either. The module's own
  docblock states why it needs no self-exemption (outside Tier 1's corpus; the addresses arrive
  as a parameter rather than being hard-coded) and what it deliberately does not fire on (a
  visitor's two-letter country code, a different claim about a different subject, citing
  `funnel-collector.ts`).
- `packages/node/src/location-claims.node.test.ts`: the three region addresses are extracted
  from `hosted-object.ts` as text and asserted as the literal `3`. Tier 1's corpus (`README.md`,
  the whole of `docs/`, every per-package demo tree, `packages/browser/index.html`, and the two
  results documents) is asserted non-empty and to contain both results documents and
  `README.md`. Tier 2 runs over every file `git ls-files` reports. An exemption layer (phrase +
  rule, never a line number), a dead-exemption check, a reason-length floor, and a round-trip
  case are all copied from `vocabulary.node.test.ts`'s shapes. Two substituted-fixture controls
  prove the matcher can fail: one line per `LOCATION_TERMS` row returns exactly
  `LOCATION_TERMS.length` term findings, and one address-plus-verb line with no listed term
  returns exactly the literal `1` attribution finding. Both real-corpus plants (below) were
  watched red and restored.
- `vitest.config.ts`: `files` 264→265, `tests` 3820→3838, both counted off a real
  `npx vitest run --project node`; `MEASURED_NODE_SPANS` gains an entry for the new file at a
  comparative-delta reading (see Deviations — the host was oversubscribed for the whole
  session); `unitFiles`/`unitTests` hold at 182/3074, confirmed behaviourally with a real
  `O2_UNIT_ONLY=1` run.
- `packages/node/src/reachability-guard.node.test.ts`: `ORPHAN_MODULE_CEILING` 34→35, one dated
  entry naming `location-claims.ts` (see Deviations).
- `.planning/REQUIREMENTS.md`: `HOST-07` marked Done, checkbox and ledger row both.

## Task Commits

1. **Task 1: The term list, the placement verbs, and the matcher both tiers share** - `6b0882c` (feat)
2. **Task 2: Scan the published surface and the results, and watch the guard find a planted claim first** - `3160781` (test)
3. **Fix: name HOST-07 in a running test title** - `05efc5b` (fix, deviation 7, found after `HOST-07` was marked `[x]`)
4. **Fix: re-read AOT-03's stale promise, discharged by touching the ledger** - `a59686d` (fix, deviation 8)

## Files Created/Modified

- `packages/node/src/location-claims.ts` — created: term list, placement verbs, shared matcher
- `packages/node/src/location-claims.node.test.ts` — created: the two-tier scan, exemption
  layer, dead-exemption check, and both plants
- `vitest.config.ts` — `files`/`tests` counted up, one `MEASURED_NODE_SPANS` entry,
  `unitFiles`/`unitTests` confirmed unchanged by a real run
- `packages/node/src/reachability-guard.node.test.ts` — `ORPHAN_MODULE_CEILING` raised by one,
  dated and named (outside this plan's stated file list — see Deviations)
- `.planning/REQUIREMENTS.md` — `HOST-07` checkbox and ledger row both marked Done

## Decisions Made

- `LOCATION_TERMS`'s two-source population — see key-decisions above.
- The Tier 2 exemption phrase for `admission-directive.ts` omits the address it also names —
  see key-decisions above.
- `ORPHAN_MODULE_CEILING` raised rather than the module added to `ENTRY_POINTS` — the latter
  was refused by the plan that created that list, quoted in the guard's own history, for the
  same reason it applies here: a root added to shrink one number shrinks what the whole
  instrument can see.
- `HOST-07` closed on this plan's own reading of the inherited instruction that this row is the
  guard itself, unlike `HOST-06` which asserts an owner act — see Requirements Ledger below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan's stated verify command, `npx tsc --noEmit -p packages/node`, does not resolve — no such tsconfig exists**
- **Found during:** Task 1, first verification attempt
- **Issue:** `packages/node/tsconfig.json` does not exist; only `packages/cloudflare/` has its
  own tsconfig among the packages this phase touches. The root `tsconfig.json` covers
  `packages/*/src/**/*.ts` in one program with no per-package project reference for `node`.
- **Fix:** Used `npx tsc --noEmit -p .` instead, the whole-workspace check this same phase's
  inherited refusals already established as the meaningful signal (`deferred-items.md`'s
  `packages/cloudflare` isolation finding).
- **Files modified:** none (verification command only)
- **Verification:** `npx tsc --noEmit -p .` exits `0` after every task.
- **Committed in:** `6b0882c`, `3160781`

**2. [Rule 3 - Blocking] The pre-commit reachability guard refused Task 1's commit with the new module unimported**
- **Found during:** Task 1, first commit attempt
- **Issue:** `location-claims.ts` is imported only by its own `.node.test.ts` spec (added in
  Task 2), which the traced production-reachability graph does not count as a production
  importer — `ORPHAN_MODULE_CEILING` was at 34 with 35 real orphans once the file existed.
- **Fix:** Raised `ORPHAN_MODULE_CEILING` 34→35 with a dated, named entry, the mechanism this
  guard's own history already used for `banned-vocabulary.ts`/`commit-scope.ts`/
  `strip-comments.ts`/`mutation-guard.mutate.ts`.
- **Files modified:** `packages/node/src/reachability-guard.node.test.ts` (outside this plan's
  stated `files_modified` — a pre-commit gate on Task 1's own new file, not a scope expansion
  of what Task 1 does)
- **Verification:** `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts` — 35/35.
- **Committed in:** `6b0882c`

**3. [Rule 1 - Bug] The spec's own docblock named an identifier a different, pre-existing guard also scans the tree for**
- **Found during:** Task 2, the required full-`node`-project run
- **Issue:** A docblock explaining the address-derivation technique named the platform siting
  call by its exact identifier, in prose. `hosted-tier-deploy.node.test.ts`'s own two-file
  closed-set guard for that identifier scans every tracked `.ts` file for it and refused the
  commit with a third file in the list.
- **Fix:** Reworded the docblock to reference the technique without naming the identifier.
- **Files modified:** `packages/node/src/location-claims.node.test.ts`
- **Verification:** `npx vitest run --project node packages/node/src/hosted-tier-deploy.node.test.ts` back to its own two-file count; full `node`-project run confirmed only the two
  pre-existing, unrelated failures remained (see Issues Encountered).
- **Committed in:** `3160781`

### Reported Findings (not narrowed, not silently absorbed)

**4. Three unanticipated Tier 2 attribution hits — the plan named four pre-existing hits and the corpus held seven**
- `.planning/OWNER-ACTIONS.md`, `.planning/PROJECT.md` and
  `packages/libp2p/src/admission-directive.ts` each name a region address on the same line as a
  word from `PLACEMENT_VERBS`, discovered by running the real scan rather than anticipated by
  the plan. None attributes a place to the address it names — each is a phrase-keyed line
  exemption with a dated reason, disposition given in the code and repeated here: the owner-
  actions line is the guard's own description of itself, the project row is a general statement
  about the Durable Objects platform model in the same table cell as (not attributing a place
  to) the three addresses, and the libp2p comment's verb names which source file a constant is
  defined in, not a physical location.

**5. The success criterion "the spec needs no path exemption, because it types no listed term" is unsatisfiable as literally written for a spec with a phrase-keyed exemption layer**
- The plan's stated reasoning is `check-copy.node.test.ts`'s measured precedent — a spec built
  entirely by substitution needs no `EXEMPT_PATHS` entry. That precedent holds for a spec with
  no exemption layer at all. `location-claims.node.test.ts` is structurally the other shape,
  the same shape `vocabulary.node.test.ts` is: it carries phrase-keyed exemptions for real
  pre-existing hits, and the containment check that decides an exemption applies requires the
  phrase to literally cover the matched text — so a Tier 1 exemption phrase necessarily
  contains the exact place name it excuses, the same reason `vocabulary.node.test.ts` registers
  itself in its own `EXEMPT_PATHS`. Considered and rejected: splitting a term across a string
  concatenation so no single source line contains it whole — this would satisfy the letter but
  makes the exemption un-greppable, which is a worse property for a reviewer than the one being
  guarded against. **What DOES hold, and is what actually binds this file mechanically:** no
  `EXEMPT_PATHS` entry is needed (asserted), because Tier 1 structurally never reads
  `packages/node/src/`; and this spec's own Tier 2 attribution is asserted clean by scanning its
  own real source — which caught a genuine self-violation on first draft (deviation 6) and is
  green now. The plan's causal clause does not hold for the reason stated; the outcome the
  criterion cares about does.

**6. [Rule 1 - Bug, caught by the spec's own self-check] The admission-directive.ts exemption's first draft repeated the address in its phrase, making this spec's own source a Tier 2 violation of itself**
- **Found during:** Task 2, first run of the full spec (18 tests, 2 failed)
- **Issue:** the exemption's original `phrase` value named the third region address
  immediately followed, on the same line of source, by the placement verb it was keying on —
  which is exactly the shape Tier 2 exists to refuse, now written into this spec's own tracked
  file. The "produces no attribution finding when the real scan reads its own source" case
  reddened at `location-claims.node.test.ts:272`, naming the `attribution` rule, the address,
  and the verb — the case built for exactly this purpose caught it before commit.
- **Fix:** Narrowed the phrase to `'— lives in'`, which still covers the verb-match span
  (the only thing the containment check needs) without naming the address.
- **Files modified:** `packages/node/src/location-claims.node.test.ts`
- **Verification:** the same case, green; full spec 18/18.
- **Committed in:** `3160781`

**7. [Rule 1 - Bug] `HOST-07` was named only in prose, never in a running test title**
- **Found during:** the final commit's own pre-commit guard sweep, after `HOST-07` was marked
  `[x]`
- **Issue:** `acceptance-traceability.node.test.ts` requires every `[x]` requirement to resolve
  to a test whose title names it, so a failure reports which requirement broke rather than
  reading as an unrelated red. `HOST-07` was named only in docblocks and comments across three
  files (`hosted-tier-deploy.node.test.ts`, `location-claims.node.test.ts`,
  `reachability-guard.node.test.ts`), none of them a running title.
- **Fix:** Prefixed both of `location-claims.node.test.ts`'s top-level `describe` titles with
  `HOST-07,`, on `hosted-tier-deploy.node.test.ts`'s own established naming convention.
- **Files modified:** `packages/node/src/location-claims.node.test.ts`
- **Verification:** `npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts packages/node/src/location-claims.node.test.ts` — 65/65.
- **Committed in:** `05efc5b`

**8. [Rule 3 - Blocking] Editing `.planning/REQUIREMENTS.md` pulled in an unrelated, already-15-day-old stale-promise finding as blocking for this commit**
- **Found during:** the final commit's own pre-commit guard sweep, after `HOST-07` was marked
  `[x]`
- **Issue:** `requirements-ledger.node.test.ts`'s stale-promise finding attributes itself to
  BOTH the spec and `.planning/REQUIREMENTS.md`, by design — "the agent editing the ledger…
  is the one who can discharge it." `AOT-03`'s promise (last re-read 2026-08-30, bound 14 days)
  had been reported as a non-blocking warning by every prior commit in this phase because none
  of them touched `.planning/REQUIREMENTS.md`; this plan's own commit does, so the finding
  became blocking here.
- **Fix:** Read `AOT-03`'s row and its three witnesses. Nothing has moved since the 2026-08-30
  reading — the cross-host workflow is still dispatch-only and undispatched, the row's verdict
  is still `Partial` for the reason it already states, and the dispatch is still an owner act
  on a public repository. Added a dated re-read comment recording that reading and bumped the
  register's `reread` date to today, on the same convention every prior re-read in that array
  already uses. `AOT-03` itself was NOT resolved — only re-recorded as still, accurately, open.
- **Files modified:** `packages/node/src/requirements-ledger.node.test.ts`
- **Verification:** `npx vitest run --project node packages/node/src/requirements-ledger.node.test.ts` — 27/27.
- **Committed in:** `a59686d`

---

**Total deviations:** 5 auto-fixed (Rules 1/3), 3 reported findings (not narrowed).
**Impact on plan:** No criterion was narrowed to make it pass. Deviation 5 is a measured
correction to the plan's stated *reason*, not to its *requirement* — the requirement (no
`EXEMPT_PATHS` entry for this spec) holds exactly as written.

## Issues Encountered

**Pre-existing, unrelated failures surfaced by the required full-sweep counts (not
investigated further, out of scope).** `npx vitest run --project node` (264→265 files)
surfaced three failures, two of them the same two files across two full runs:
`packages/node/src/requirements-ledger.node.test.ts` (the same dated `AOT-03` stale-promise
finding every commit in this phase has already surfaced as "outside this commit, not
blocking") and `packages/node/src/switch-observation.node.test.ts` (two cases that failed only
inside the full run — re-run alone, on the same still-oversubscribed host: 25/25 green,
attributed by isolated re-run rather than by plausibility). Neither names anything this plan
created or modified. The frozen results document, `.planning/BENCHMARK-RESULTS-2026-08-01.md`,
was checked for a Tier 1 hit against every `LOCATION_TERMS` row and carries none — no line
exemption was needed for it.

**The host was extremely oversubscribed for the whole of this session** — `uptime` read
directly at multiple points showed load averages from 29 up to 105 against an 8-core ceiling.
Every duration quoted in this SUMMARY that is not explicitly marked otherwise is either a count
(load-independent) or a comparative delta taken specifically to survive that contention; no
absolute wall-clock reading from this session is treated as precise.

## Plant Proofs

**Task 2, plant 1 — Tier 1, a term substituted into the real published corpus.**
- Snapshot: `cp README.md` to a scratchpad path outside the repository.
- Plant: appended one line built by a small script reading `LOCATION_TERMS` and substituting
  its own `São Paulo` row's term into a sentence — no place name typed by hand or left in shell
  history.
- Observed, exactly the case named in advance and no other: `finds no term violation after the
  exemption layer` reddened, reporting the planted line at `README.md:352` under the `term`
  rule, naming the substituted row and quoting the appended sentence verbatim in the assertion
  output. 17/18 passed; the Tier 2 attribution case and every other case stayed green.
- Restoration: `git diff` confirmed exactly the two appended lines (350→352); deleted exactly
  those two lines (the surgical inverse of the append). `cmp` against the pre-plant snapshot:
  byte-identical. `git status --porcelain -- README.md`: clean. Re-run: 18/18.

**Task 2, plant 2 — Tier 2, an address named beside a placement verb, with no listed term.**
- Snapshot: `cp README.md` to a second scratchpad path, taken after plant 1's restore was
  already `cmp`-verified.
- Plant: appended one line built by a small script reading the derived region addresses and
  substituting the first one into a sentence naming it beside the verb phrase "hosted
  in" — no listed place name anywhere in the planted text.
- Observed, exactly the case named in advance: `finds no attribution violation after the
  exemption layer` reddened, reporting the planted line under the `attribution` rule with the
  address it named and the verb phrase it was found beside. **The Tier 1 term case stayed
  green** — the planted line carries no `LOCATION_TERMS` match, which is what this plant is for:
  proving Tier 2 is not merely Tier 1 in disguise. 17/18 passed.
- Restoration: `git diff` confirmed exactly the two appended lines. Deleted them; `cmp` against
  the second snapshot: byte-identical. `git status --porcelain -- README.md`: clean. Re-run:
  18/18.

Both plants were performed sequentially by this one agent; `git status --porcelain` was read
before and after each plant and each restoration. No plant stayed green when it was supposed to
redden, and no plant reddened a case other than the one named for it in advance.

## User Setup Required

None — no external service configuration required. Both tasks in this plan were `agent-now`;
nothing deploys, dials a real endpoint, or reads an account.

## Requirements Ledger — HOST-07 marked Done

`HOST-07`'s row is different from `HOST-06`'s, per the inherited instruction this plan started
from: `HOST-06`'s checkbox text asserts objects **are created**, present tense, an owner act
none of this phase's plans perform. `HOST-07`'s text asserts that nothing published claims
where a hosted object runs — and the row's own reasoning is that the claim should be refused
**before there is an opportunity to make it**, which is now, ahead of any deploy. This plan's
deliverable is exactly that refusal, built and proved without creating, deploying, or reading
anything. Checkbox and ledger table row both marked Done; `HOST-06` stays unmarked, unchanged
from waves 1-3.

## Next Phase Readiness

- The guard is in the tree and green, and is now part of what a future plan's own full-suite
  run checks — any later plan (including this phase's own remaining plan, or the drill plan)
  that writes a document naming where a hosted object runs will be caught by Tier 1 if it
  publishes a listed place name, and by Tier 2 regardless of which place it names, as long as
  the line also names one of the closed region addresses.
- The three unanticipated Tier 2 hits (deviation 4) are a reminder that this guard's Tier 2 is
  genuinely whole-tree, including this phase's own planning prose — a later plan's PLAN/SUMMARY
  text is bound by it too, and should be checked against `location-claims.node.test.ts` before
  being trusted, the same way this SUMMARY's own prose was written to survive it (see the note
  in `<output>` this plan itself carries).
- `.planning/STATE.md` was not touched, per this phase's own standing instruction and the
  measured `state.*` tooling defect prior waves recorded.

---
*Phase: 33-three-regions-and-a-relay-killed-on-purpose*
*Completed: 2026-09-14*

## Self-Check: PASSED

- FOUND: `packages/node/src/location-claims.ts`
- FOUND: `packages/node/src/location-claims.node.test.ts`
- FOUND commit: `6b0882c` (Task 1)
- FOUND commit: `3160781` (Task 2)
