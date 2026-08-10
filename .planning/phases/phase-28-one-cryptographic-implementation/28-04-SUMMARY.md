---
phase: 28-one-cryptographic-implementation
plan: 4
subsystem: planning-ledger
tags: [requirements, traceability, reachability, ledger-self-verification, drift-correction]
requires:
  - .planning/phases/phase-28-one-cryptographic-implementation/28-01-SUMMARY.md
  - .planning/phases/phase-28-one-cryptographic-implementation/28-02-SUMMARY.md
  - .planning/phases/phase-28-one-cryptographic-implementation/28-03-SUMMARY.md
provides:
  - "the CRYPTO-01…06 family: six checkbox rows and six traceability rows, proved visible to both ledger readers by a measured +6"
  - "the certificate-lifecycle facades' first ledger row, marked Built, not wired"
  - "WIRE-02's reachability triple corrected against a live re-derivation rather than against a summary"
affects:
  - .planning/REQUIREMENTS.md
  - packages/core/src/ed25519-backend.test.ts
  - .planning/phases/phase-28-one-cryptographic-implementation/deferred-items.md
tech-stack:
  added: []
  patterns:
    - "a ledger mint is proved by a before/after matched-row count, never by a green suite"
    - "a checkable claim is re-derived with the checker's own instrument before it is written"
    - "a traceability gap is closed by naming the id in a test title, never by widening the recorded-findings list"
key-files:
  created:
    - .planning/phases/phase-28-one-cryptographic-implementation/28-04-SUMMARY.md
  modified:
    - .planning/REQUIREMENTS.md
    - packages/core/src/ed25519-backend.test.ts
    - .planning/phases/phase-28-one-cryptographic-implementation/deferred-items.md
decisions:
  - "CRYPTO-04's [x] demanded a test naming it; the id went into a test title rather than into EXPECTED_ABSENT or the box coming off"
  - "The WIRE-02 triple was re-derived live (73 of 225, 26 disposed, 47 open) rather than copied from 28-01's summary"
  - "index.ts:401's stale barrel price is recorded, not fixed — outside this plan's file set, and a third copy of the same triple"
metrics:
  duration: ~65 min
  completed: 2026-08-10
---

# Phase 28 Plan 04: The CRYPTO Mint, and the Phase Closed Honestly — Summary

`CRYPTO-01…06` exist as six checkbox rows in a top-level `## Phase 28 Requirements — One
Cryptographic Implementation` section and six rows in the single Traceability table. Five
are `[x]`, one is `[ ]` **Built, not wired**, and the split follows the
entry-point-reachability convention rather than how much work each row took.

## The measured +6, which is the assertion this task exists to force

A green `acceptance-traceability.node.test.ts` cannot distinguish *"the CRYPTO rows are
checked and pass"* from *"the CRYPTO rows are invisible to the parser."* So the evidence is
a matched-row count taken with the readers' own four regexes, before and after:

| Pattern | Source | Before | After | Δ |
|---|---|---:|---:|---:|
| `REQUIREMENT_ROW` (line-at-a-time) | `requirements-ledger.node.test.ts:800` | **96** | **102** | **+6** |
| `TRACEABILITY_ROW` (line-at-a-time) | `requirements-ledger.node.test.ts:457`, `:826` | **96** | **102** | **+6** |
| `REQUIREMENT_ROW` (global multiline) | `acceptance-traceability.node.test.ts:91` | **96** | **102** | **+6** |
| `TRACEABILITY_ROW` (global multiline) | `acceptance-traceability.node.test.ts:129` | **96** | **102** | **+6** |

Exactly +6 on all four, with zero regression against the original 96. Both readers see the
family; no parser edit was needed, because Plan 25-02's widened `[A-Z][A-Z0-9-]*-\d+` class
already matches `CRYPTO-0N`. **That was re-derived against the tree rather than trusted from
the brief.**

Supporting greps: `grep -c "CRYPTO-0"` returns **13** (≥ 12 required);
`grep -c "^- \[x\] \*\*CRYPTO"` returns **5**; `grep -c "^- \[ \] \*\*CRYPTO"` returns **1**.

## The six rows, and the number each cites

| Id | Marker | Verdict | The number it cites |
|---|---|---|---|
| CRYPTO-01 | `[x]` | Done | 28-03's Block 1 match set of **exactly one path**, `packages/core/src/ed25519-backend.ts`, over **153** comment-stripped production files; `crypto_sign_verify_detached` in **zero**; 28-01's planted presence-gate red, `expected 'subtle' to be 'noble'` |
| CRYPTO-02 | `[x]` | Done | verifier gzip delta **28307 B** before the uninstall, **28306 B** after; `removed 2 packages, and audited 282 packages in 784ms`; 16 + 1 = **17** deleted lines; 9 cases in a 399-line guard |
| CRYPTO-03 | `[ ]` | **Built, not wired** | **28** node cases and **114** browser across 6 files, both re-measured this plan; **19** flows, **4** facades; barrel price **+12** callable exports |
| CRYPTO-04 | `[x]` | Done | floor plant red at **1 failed / 31 passed**; weighting **7 reject against 5 accept**; sync/async block at `:883`; backends read `noble, subtle` on all four engines |
| CRYPTO-05 | `[x]` | Done | baseline **127 B**, verifier **28434 B**, delta **28307 B**, libsodium delta **153005 B**; inherited **322427 B** = **2.11×** too large; ceiling **38912 B**; ratio **3.93×** |
| CRYPTO-06 | `[x]` | Done | node/chromium/firefox **MATCHED ×4**, webkit **DIFFERED ×4**; 9 candidates, 8 excluded, **1** registered; ceiling **2**; both directions red at 4/24 and 3/24 |

Every figure comes from a Plan 28-01/02/03 SUMMARY, except the four re-measured here and
labelled as such. **No row describes the phase as having removed a hazard from the trust
path**, and the section intro states the correction explicitly so a later reader finds the
cap rather than having to re-derive it.

## The planted-mutation proof

The `+6` count proves the rows are *parsed*. It does not prove the `has no production
caller` claims are *checked against the tree* — a row can be well-formatted and still make
its claim invisible, which is the failure this repository has already had. So the claim was
planted false and watched red.

**Plant:** in CRYPTO-03's verdict, `` `createVerifier` has no production caller `` →
`` `createCryptoBackend` has no production caller ``. Chosen because `createCryptoBackend`
**does** have a production caller, measured earlier in this plan. Exit **1**:

```
 FAIL  |node| packages/node/src/requirements-ledger.node.test.ts > a row claiming nothing calls a mechanism is right about it > has no row naming a symbol that has since acquired a production caller
AssertionError: expected [ Array(1) ] to deeply equal []

+ [
+   "CRYPTO-03: createCryptoBackend is called by packages/core/src/cert-lifecycle.ts",
+ ]
```

The finding names the new row by id and the caller by path, so the claims are re-derived
from the source rather than trusted. Restored by the **surgical inverse** of the one-phrase
edit — never `cp`, never `git stash`, never `git checkout --` — and `cmp` against a snapshot
taken immediately before planting reported **IDENTICAL to pre-plant snapshot**. Post-restore
re-run: 2 files, 61 passed, exit 0.

### A stale claim caught by re-deriving instead of quoting

28-01's summary says *"Nothing in production calls `initEd25519()`, `getSyncVerifier()`,
`getAsyncVerifier()` or `createCryptoBackend()`."* **The last of those four is no longer
true**: after the merge, `cert-lifecycle.ts` calls `createCryptoBackend`. Had that sentence
been copied into a row, the row would have been false and the guard would have reddened the
commit. It was caught because every claim was re-derived with the ledger's own instrument —
comment-stripped corpus, declaring file excluded, `EXPORTED` membership checked — before
being written. Verified true and used: `createSubject`, `createIssuer`, `createVerifier`,
`getSyncVerifier`, `initEd25519`, `sweepNodeCount`, all with zero production callers and all
present in `EXPECTED`-map form so the claims are read rather than dropped.

## The WIRE-02 correction, re-derived rather than copied

The row read **`67 of 217 callable barrel exports unreachable — 20 disposed — 47 OPEN`**.
Three of those four figures were stale. The live guard was run and reported:

| Reading | Stale | **Live, 2026-08-10** | Bound |
|---|---:|---:|---|
| callable barrel exports | 217 | **225** | — |
| unreachable | 67 | **73** | ceiling 73 — exactly at bound |
| disposed | 20 | **26** | `DISPOSITION_CEILING` 26 — exactly at bound |
| open, no production caller | 47 | **47** | `OPEN_FINDING_CEILING` 47 — exactly at bound |

`73 − 26 = 47`, and the disposed 26 split three ways: 16 `global-object-hop`, 4
`benchmark-driver-only`, 6 `deferred-in-source` — the row said *two* causes. It now agrees
with `reachability-guard.node.test.ts`, whose matching copy 28-01 corrected at `:350`.

**The 47 is the one figure that did not move, and the row now says the agreement is a
coincidence rather than evidence** — it was written against a residue of 47, went stale when
Plan 25-02 raised `OPEN_FINDING_CEILING` to 49, and reads true again only because Phase 28's
merge measured it back down. `grep -c "67/20/47"` returns **0**.

**The exemplar drifted with the triple.** The row offered `sweepNodeCount` as *"one of the
47"*. Its checkable claim is still true — `sweepNodeCount` has no production caller — but the
symbol is no longer one of the 47, having moved into the disposed 26 under
`deferred-in-source`. Replaced with `getSyncVerifier`, verified present in the live open list
and verified caller-free. Both facts are stated, because a claim staying true while the
category around it goes stale is exactly how a wrong number survives.

## Deviations from Plan

**1. [Rule 3 — Blocking] The plan's insertion point had moved; a Phase 27 section now exists**

- **The plan said:** insert after the Phase 26 section's closing `---` and before
  `## v2 Requirements (deferred)` at `:670`.
- **The tree:** Phase 27's section was added at `:679` and v2 had moved to `:701`.
- **Fix:** the section went after **Phase 27's** closing `---` and before
  `## v2 Requirements (deferred)`, which is the same parsing-safe placement the plan was
  reaching for. `V1_BOXES` collects boxes only under `## v1 Requirements`, so the header
  arithmetic is untouched either way — confirmed by reading the parser, not by assuming.

**2. [Rule 2 — the guard demanded work, and the work was done rather than the guard widened]
`CRYPTO-04` had no test naming it**

- **Found during:** the first verification run, which failed:
  ```
  AssertionError: expected [ …(3) ] to deeply equal [ …(2) ]
  +   "CRYPTO-04 — marked [x] at .planning/REQUIREMENTS.md:727, and no tracked test file names it"
  ```
- **Why it happened:** minting an `[x]` id creates a demand for a test that names it.
  CRYPTO-01, 02, 05 and 06 already had titled evidence; CRYPTO-03 is `[ ]` and exempt.
  CRYPTO-04's subject is the differential-conformance guard, whose titles carry the threat
  id `T-25-16` but no requirement id.
- **The two ways to go green without doing the work** were to add `CRYPTO-04` to
  `EXPECTED_ABSENT` or to un-tick the box. Both are the *widening what counts as passing*
  move CLAUDE.md § Proofs refuses, and the guard's own docblock says the equality is exact
  precisely so that *"a fixed one fails too."*
- **Fix:** `packages/core/src/ed25519-backend.test.ts`'s weighting case is retitled
  `'the vector corpus stays weighted toward rejection (CRYPTO-04)'`. It is the carrier
  because it asserts one of the requirement's three named clauses **literally**, rather than
  merely running nearby. The id was deliberately **not** put on the `describe` above it,
  whose title is quoted verbatim inside a recorded plant output at `:443` — editing that
  quote would be rewriting an observation nobody re-took. The reasoning is written into the
  docblock so the id is not later "tidied" out as decoration.
- **Scope note:** `packages/core/src/ed25519-backend.test.ts` is outside the plan's
  `files_modified` of `.planning/REQUIREMENTS.md` alone. It is a test-title change with no
  behavioural content, made because the plan's own acceptance criterion could not otherwise
  be met honestly.

**3. [Reported, not fixed] `packages/core/src/index.ts:401-402` carries a third copy of the
stale triple**

- It prices the facade barrel decision at *"75 → 87 and OPEN_FINDING_CEILING 49 → 61"*, both
  left-hand figures pre-merge. Against the live readings the same `+12` is **73 → 85 and
  47 → 59**.
- Outside this plan's file set, and it is a comment rather than an assertion, so nothing goes
  red — the 19-12 shape. Recorded in the CRYPTO-03 row and as item 3 of `deferred-items.md`
  rather than reconciled by choosing a number.

**4. [Housekeeping] `deferred-items.md` item 1's "not green" note was superseded**

- It told the next agent the full e2e project is red on this branch. That was true when
  28-02 wrote it and is false now. Closed with this plan's own independent re-measurement
  (28 files, 183 passed, exit 0), with the repair explicitly **not** claimed as Phase 28
  work. A deferred item silently fixed elsewhere is how a stale "known red" outlives the
  defect.

## Verification

`EXIT=$?` was read on the line immediately after every command, with output redirected to a
file and read separately — no pipes, no trailing `tail`. Each project's exit code was written
to **its own file inside the background script**, immediately after its own command, because
28-02 recorded a composite background command returning shell exit 0 while the e2e project
inside it exited 1.

| Command | Exit | Result | `real` | `(user+sys)/real` |
|---|---|---|---|---|
| `npx tsc --noEmit` | **0** | whole repository, zero output lines | — | — |
| `npx vitest run --project node` (**full**) | **0** | **180 files, 2606 passed / 1 skipped (2607)** | 422.85 | 1.05 |
| `npx vitest run --project browser` (**full**) | **0** | **261 files, 4488 passed** | 44.89 | 2.78 |
| `npx vitest run --project e2e` (**full**) | **0** | **28 files, 183 passed** | 468.53 | 0.51 |
| `--project node` requirements-ledger + acceptance-traceability | **0** | 2 files, 61 passed | — | — |
| `--project node` reachability-guard + reachability | **0** | 2 files, 57 passed | — | — |
| `--project node` cert-lifecycle | **0** | 28 passed | — | — |
| `--project browser` cert-lifecycle ×2 | **0** | 6 files, 114 passed | — | — |

**All three projects match their recorded baselines exactly**: node 180/2606+1, browser
261/4488, e2e 28/183. Nothing this plan did moved a count, which is the expected result for a
ledger edit plus a test *title*. The e2e project is green in a **whole-project** run, which
is the reading that matters — a suite run only in slices has no run in which "green" means
the suite is green.

The node run's `(user+sys)/real` of 1.05 is below 28-03's 1.275 for the same suite; the two
runs are not comparable on that key, because this one shared the host with a browser and an
e2e project queued behind it. The pass/fail reading is unaffected.

## Byte-identical, confirmed rather than asserted

The two protected strings were extracted before and after the edit and hashed together:
`md5` **`326c3a410520ab55cc3d69f677de5a38`** both times.

- `**45 of 72 are \`[x]\`.** That is down from the 68 that were checked before the v1.0`
- `**Coverage: 76/76 mapped. No orphans, no duplicates.** (72 v1 + 4 v1.1-only WIRE`

This is the T-28-17 mitigation: the family took its own top-level section, outside
`V1_BOXES`' section-bounded parse, so neither the header arithmetic nor the coverage line
moved — the *"'82' and '72' for the same population"* failure the ledger's own docblock warns
about.

## What Phase 28 did NOT deliver

Stated plainly, because a phase that closes without this list is how *built, not wired*
happens again.

1. **The port is not wired.** Nothing in production calls `initEd25519` or `getSyncVerifier`.
   Owner non-decision, and a real one: wiring it into `verifyChain`/`verifyCertificate` is a
   block / fail-closed / fail-open ruling on a trust path, and the `verifiedPeers` staleness
   window needs a sited constant first. Untouched by all four plans.
2. **The facades are not barrel-exported.** Owner non-decision, projected cost 12 callable
   exports (73 → 85, 47 → 59). CRYPTO-03 is `[ ]` for exactly this reason and the phase
   deliberately did not improve its own marker by side effect.
3. **Criterion 5's "order of magnitude" is NOT met.** Plan 28-02 required the ceiling to sit
   ≥10× below the removed weight; measured, it is **3.93×** (5.41× against the raw delta),
   and unreachable at any legal headroom — 4.5× even at the tightest permitted 1.2×. Recorded
   unmet in the CRYPTO-05 row. Neither constant was bent to rescue it.
4. **The merge removed no hazard from the trust path.** Neither selection layer was ever in
   it; production verification calls `@noble/curves` directly at six sites. The phase removed
   a duplication from a package and a dependency from a tree, and the ledger says so in three
   places so it cannot be re-inflated later.
5. **CRYPTO-04's backend floor does not bind today.** Every measured host reports two
   backends, so the vacuity it closes is **INFERRED** from reading the selection logic, never
   observed.
6. **WebKit's signature divergence is reported, not resolved.** Byte-equality of Ed25519
   signatures is asserted in neither direction, deliberately. The finding is guarded, not
   fixed — and it cannot be fixed from this side.
7. **The 47-symbol reachability residue is unchanged.** 73 unreachable, 26 disposed, 47 open,
   all three exactly at their bounds. Two symbols left the barrel through cleanup adjacent to
   wiring; nothing became reachable. Lowering that number is still the work.
8. **`index.ts:401`'s stale barrel price is still stale.** Third copy of a triple that has now
   drifted in three places.
9. **The `demo-viewport.e2e.test.ts` B5 repair is not Phase 28 work** and is not claimed as
   such, though this plan independently re-measured the branch green.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change at a trust
boundary. Nothing outside `.planning/` and one test title changed. The plan's four registered
threats are mitigated and three of the four were watched working rather than reasoned about:

- **T-28-15** (ledger self-verification): the +6 matched-row count on all four patterns, taken
  before and after, not a green suite.
- **T-28-16** (`has no production caller` claims): every claim re-derived with the checker's
  own instrument, and the mechanism watched red by planting a symbol that really does have a
  caller.
- **T-28-17** (header arithmetic): both protected strings `md5`-identical before and after.
- **T-28-18** (status inflation): five `[x]` on properties of the module graph, the manifest
  or a running guard; the one row about code nothing calls is `[ ]` **Built, not wired**, and
  each verdict states its reasoning so a later reader can disagree with the argument rather
  than only with the marker. Accepted-with-mitigation, as filed.

## Known Stubs

None.

## Commits

- `538a2ad` — `docs(28-04): mint CRYPTO-01…06, and the rows are proved visible to both readers`
  (3 files: `.planning/REQUIREMENTS.md`, `deferred-items.md`,
  `packages/core/src/ed25519-backend.test.ts`; 74 insertions, 2 deletions).
  `git show --stat` read after: only this plan's files, and
  `git diff --diff-filter=D` empty — no tracked file deleted. The repository's pre-commit
  cheap guards ran and passed: 7 files, 267 tests.

Both commits were made with `git commit -m "msg" -- <paths>`, `-m` before `--`, never bare.

## Self-Check: PASSED

- `.planning/REQUIREMENTS.md`, `packages/core/src/ed25519-backend.test.ts`,
  `deferred-items.md` and this summary all present on disk.
- `538a2ad` present in `git log`.
- Row counts re-read after the commit: 102 on all four patterns.
- `grep -c "CRYPTO-0"` = 13; `[x]` CRYPTO rows = 5; `[ ]` CRYPTO rows = 1;
  `grep -c "67/20/47"` = 0.
- Protected-line `md5` unchanged at `326c3a410520ab55cc3d69f677de5a38`.
- `git status --porcelain` was clean before each `git add`, and no `git add` was issued while
  a test run was in flight.
- **`STATE.md` and `ROADMAP.md` are not updated, and no `gsd-sdk query state.*` or
  `roadmap.update-plan-progress` verb was run** — the executing brief barred them, recording
  that seven had corrupted `STATE.md` while reporting success.
