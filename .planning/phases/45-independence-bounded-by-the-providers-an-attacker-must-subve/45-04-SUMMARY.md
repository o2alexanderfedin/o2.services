---
phase: 45-independence-bounded-by-the-providers-an-attacker-must-subve
plan: 04
subsystem: proofs/mutation-ledger
tags: [VER-12, criterion-4, mutation, plant, requirements-ledger, counts]
requires:
  - "packages/core/src/quorum.ts — the issuer refusal and the issuer conjunct, as 45-01 left them"
  - "packages/node/src/mutation-ledger.ts — M40's `false as boolean` idiom and M42's re-sited find"
  - "45-03's handover: slow-specs is GREEN, not the red the plan predicted"
provides:
  - "three plants, each watched red with its text recorded verbatim, each restored by surgical inverse with cmp exit 0"
  - "M81 and M82 — the issuer refusal and the issuer conjunct, with observed signatures"
  - "M42's signature rewritten from a real planted run across spawned processes"
  - "VER-12 `[x]`, its traceability row `Done`, and the header's count sentences re-derived"
  - "vitest.config.ts's four figures counted against the tree this phase leaves, and a fourth plant proving the guard reads them"
affects:
  - "packages/node/src/mutation-guard.node.test.ts — 185 -> 187 cases, one per new entry"
tech-stack:
  added: []
  patterns:
    - "a signature recorded as a TEST TITLE when the same run printed one, because a title is source text the cheap layer can check"
    - "a plant restored by reversing exactly the characters changed, verified by `cmp` against a snapshot taken immediately before"
key-files:
  created:
    - .planning/phases/45-independence-bounded-by-the-providers-an-attacker-must-subve/45-04-SUMMARY.md
  modified:
    - packages/node/src/mutation-ledger.ts
    - .planning/REQUIREMENTS.md
    - vitest.config.ts
decisions:
  - "M81 and M82 carry TEST-TITLE signatures, not the assertion text, because the same run printed both and only a title is checkable"
  - "Task 1 produced no commit: quorum.ts ends byte-identical, so there was nothing to commit"
  - "vitest.config.ts's counts were retaken by two full lane runs rather than derived, and the unit pair was measured rather than computed from the identity"
  - "Both count runs were taken on an oversubscribed host: the DURATIONS are void and none is recorded, the COUNTS stand"
metrics:
  tasks: 3
  commits: 3
  completed: 2026-09-16
---

# Phase 45 Plan 04: Three Plants, Two Ledger Entries, and the Counts This Phase Invalidated — Summary

Criterion 4 asked for one mutation, watched failing. Three were planted, all three reddened,
all three were restored by reversing exactly the characters changed, and `quorum.ts` ends the
plan **byte-identical to what 45-01 committed** — which is the claim, and `git diff` over the
range is the evidence for it rather than a promise in this file.

**No green plant.** Across the whole phase: eleven plants, eleven reds.

---

## What each criterion cost

`EXIT=$?` on the line immediately after every command, with no pipe and no trailing
`echo`/`tail`.

| Criterion | Reading | Exit |
|---|---|---|
| `requirements-ledger` + `mutation-guard`, `--project node` | 214 passed (2 files) | **0** |
| `npx vitest run --project node` (the whole lane) | `Test Files 270 passed (270)`, `Tests 3905 passed \| 2 skipped (3907)` | **0** |
| `O2_UNIT_ONLY=1 npx vitest run --project node` | `Test Files 187 passed (187)`, `Tests 3138 passed (3138)` | **0** |
| `slow-specs.node.test.ts` after the counts moved | 15 passed | **0** |
| the same with `unitFiles` planted at 186 | `AssertionError: expected 186 to be 187` — 1 failed \| 14 passed | **1** |
| `slow-specs.node.test.ts` after the surgical restore | 15 passed | **0** |

**Both lane runs were taken on an oversubscribed host and both banners say so** — load/core
1.65 before / 13.03 after on the full lane, 9.69 / 7.13 on the unit lane, against a ceiling of
4.00; `/usr/bin/time -p` on the unit lane read `real 39.53 user 124.20 sys 15.56`, ratio 3.53.

**That voids every duration in those runs and not the counts, and the distinction is the
reason this paragraph exists rather than a re-run.** A file count and a test count are
*collected*, not *timed*: the summary block reports what the collector found, both lanes
finished with nothing failed and nothing skipped for load, and a contended host cannot make
vitest discover a file that is not there. No wall clock from either run is written down
anywhere, and `unitWallClockMs` was deliberately **left** at its earlier quiet-host reading
rather than overwritten with a number this session cannot support.

---

## Plants — three from this plan, each watched red and restored

`cmp` exit **0** in every case, against a snapshot taken immediately before planting. No `cp`
of a whole file to undo a plant, no `git stash`, no `git checkout --`.

### Plant (a) — the refusal branch, planted in M40's idiom

`composeQuorum`'s issuer guard condition replaced with `if (false as boolean) {`.
Watched red: **1 failed | 31 passed (32), exit 1.**

### Plant (b) — the issuer conjunct in `classifyAttestation`

`if (operators.size >= 2 && issuers.size >= 2) return 'independent'` relaxed to drop the
issuer half. Watched red: **4 failed | 28 passed (32), exit 1.**

### Plant (c) — M42, re-sited, across spawned processes

`quorum-agents.node.test.ts` printed the recorded signature at `:734`, in *degrades to
owner-domain on the default dial…* — **1 failed, 3 passed (4), exit 1**, 14.44 s on a host its
own banner called quiet (load/core 0.70 before, 0.73 after).

**Observed text, and this is the whole reason the entry was re-sited rather than left:**

    expected 'single-issuer' to be 'owner-domain'

M42's stored signature had read `expected 'independent' to be 'owner-domain'` — true of the
tree before this phase and false after it. **The re-siting was not cosmetic.** Left on the
`independent` return, the same relaxation is **inert on every one-issuer fixture**: the
`issuers.size >= 2` conjunct is false, control falls through, and the answer does not move —
the exact shape that left a Phase 44 plant green. It lands on the `single-issuer` return
instead, and the run above is what proves it can fail there.

### A fourth plant, added by the orchestrator when finishing Task 3

`unitFiles: 187` → `186`. Watched red — `AssertionError: expected 186 to be 187`, 1 failed |
14 passed, exit 1 — restored by the surgical inverse, `cmp` exit 0, green again afterwards.

**Why it was worth planting at all**, given 45-03 measured this guard as tolerant: it reports
a **tolerance of five on `files`** and **no reader at all on `tests`**, so a number written
into this file is not automatically a number anything checks. The plant establishes that
`unitFiles` specifically **is** read, and therefore that this figure was worth measuring
rather than estimating. It says nothing about `tests`, which remains unasserted — recorded
here rather than left for the next reader to assume otherwise.

---

## The counts, and why they were counted rather than derived

Four figures moved, all in `vitest.config.ts`:

| Field | Was | Is |
|---|---|---|
| `files` | 269 | **270** |
| `tests` | 3 865 | **3 907** |
| `unitFiles` | 186 | **187** |
| `unitTests` | 3 102 | **3 138** |

One file arrived across the whole phase: `packages/node/src/attestation-claims.node.test.ts`
(45-03's guard). It reads tracked source off disk with no subprocess, so it clears
`SLOW_CUTOFF_MS` and joins the unit set — which is why both file figures move by exactly one.

**The 42-test rise is four plans' worth of cases, not one file's**: 25 in the arriving file,
the rest in `quorum.test.ts` (24 → 32), the census arms added across the node project, and the
two `mutation-guard` cases the new `M81`/`M82` ledger entries generate one each.

**`unitFiles` was measured, not computed from `files - excludedInNode`.** That identity is
what `slow-specs.node.test.ts` checks, and a number satisfying its own check is not a reading.
Measured 187; the identity gives `270 - 83 = 187` and is reported as **agreeing with** the
reading rather than as its source.

---

## Where the plan disagreed with the tree

### 1. `slow-specs.node.test.ts` did not go red between the waves

45-03 measured both sides and handed the finding forward: `FILE_COUNT_TOLERANCE = 5` and a
drift of 1, plus `tests` having no reader at all. The plan had predicted a red and directed
that its failure text be recorded. **There was no failure text because there was no failure**,
and the counts were retaken anyway — a guard tolerating a stale number is not a reason to
leave one.

### 2. Task 1 produced no commit, and that is the correct outcome

The plan lists three tasks and this SUMMARY records three commits, not four. A plant that is
restored leaves nothing to commit: `quorum.ts` is byte-identical across the plan. The absence
of a commit **is** the evidence that every plant came out.

---

## Success criteria

- [x] **ROADMAP criterion 4 is met.** Three plants, each watched going red with its observed
      text recorded verbatim, each restored by the surgical inverse and `cmp`-verified
- [x] The ledger's new entries carry signatures **taken from runs that were watched**, never
      predicted — including M42's, which was wrong in the tree until this plan re-ran it
- [x] VER-12 is `[x]`, its traceability row opens exactly `**Done** — `, and the header's
      count sentences were re-derived rather than adjusted to fit
- [x] `requirements-ledger.node.test.ts` and `mutation-guard.node.test.ts` green, 214 cases
- [x] `vitest.config.ts`'s four figures **counted** against the tree this phase leaves, with
      a dated derivation note naming the arriving file and the host conditions
- [x] `.planning/STATE.md` and `.planning/ROADMAP.md` **not** modified

---

## Commits

| Commit | Task |
|---|---|
| `46bb578` | `test(45-04)` — the two issuer decisions enter the ledger with signatures off real runs |
| `f447a47` | `docs(45-04)` — VER-12 is closed, and the header's counts are re-derived rather than adjusted |
| this one | `chore(45-04)` — the four lane counts, measured, and this SUMMARY |

All with **explicit paths**, `git show --stat` read afterwards. `git add` happened only
**between** vitest runs, never during one. The untracked `.gitkeep` in the phase directory was
left alone.

---

## One thing this plan did NOT do, named rather than left to be discovered

**Task 3's second half was finished by the orchestrator, not by the plan's executor.** The
executor committed Tasks 1 and 2 and the requirements ledger, then stopped mid-Task-3 with a
SUMMARY on disk whose frontmatter already claimed `vitest.config.ts` was modified. **It was
not** — the file was untouched. The claim was found by reading the tree rather than the
report, and the work was then done by measurement: two full lane runs, a plant proving the
guard reads the figure, and this rewritten SUMMARY. The frontmatter's original claim is the
one thing in this phase where a summary got ahead of the tree, and it is recorded here because
a summary that overstates is exactly what the rest of this phase exists to make impossible.
