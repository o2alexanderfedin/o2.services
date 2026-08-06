---
status: awaiting_human_verify
trigger: "Three tracked defects: #69 (false citation + WIRE-04 guard blind spot on @o2/net barrel), #65 (four false claims in Phase 21 summaries), #19 (perf-workload.ts orphan production serveAgent sites — build a guard or measure why not)"
created: 2026-08-05T13:33:00Z
updated: 2026-08-05T13:56:00Z
---

## Current Focus

hypothesis: all three investigated; two of the five Phase 21 "false claims" are themselves false diagnoses
test: re-measurement against the tree, not against the reports
expecting: report to owner
next_action: hand over — the node-project file-count drift (156 of a recorded 150, tolerance 5) needs a whole-table retake in `vitest.config.ts` that cannot be taken today

## Symptoms

expected: |
  #69A: citations in packages/core/src/index.ts point at files that exist
  #69B: the WIRE-04 guard's corpus covers every barrel a caller could reach a job entry point through
  #65: Phase 21 summaries state only claims verifiable against the tree/measurements
  #19: production files are reachable from a plan and reported by a node-tier suite, or a guard says which are not
actual: |
  #69A: index.ts cited `job-entry-point.test.ts` — no such file has ever existed
  #69B: the guard imports `../index.ts` and nothing else; @o2/net already exports a job-shaped symbol
  #65: five claims listed by 21-VERIFICATION.md; two confirmed false, one withdrawn, two re-scoped
  #19: packages/bench/src/perf-workload.ts is the ONLY production source only the opt-in perf project reaches
errors: |
  (none — these are claim defects, not runtime failures)
reproduction: |
  node /tmp/reach4.mjs  (reachability); the 8-barrel enumeration; vitest runs recorded below
started: |
  #69A: pre-existing; already recorded FALSE in 20-VERIFICATION.md as W1
  #19: broke the build 2026-08-05 when plan 23-01 made three RunConfig fields required

## Eliminated

- hypothesis: "the Phase 21 COST-crossover figures are stale by an order of magnitude (~570x vs 7086.14x)"
  evidence: grep for 570/7086/crossover across all five Phase 21 summaries returns one hit, `570.74 kB`, a demo bundle size in 21-03. The ~570x staleness was in ROADMAP.md and was already corrected. No Phase 21 summary carries a crossover figure at all.
  timestamp: 2026-08-05

- hypothesis: "21-05's wire elapsed of 158 / 177 / 689 ms is not reproducible at that magnitude (21-VERIFICATION row 2, measured 4657 ms)"
  evidence: four consecutive runs on 2026-08-05 at loads 2.68 / 4.77 / 4.55 / 4.66, exit 0 each — 152, 146, 153, 155 ms. All at or below the LOWEST originally recorded value. The verification's 4657 ms was taken on a host it says itself had three agents editing it.
  timestamp: 2026-08-05

- hypothesis: "perf-workload.ts is reachable from the node project because perf-gate.ts imports it"
  evidence: that import is `import type`, erased at transpile. `vitest run --project node packages/bench --coverage` reads perf-workload.ts at 0% statements / 0% branches / 0% functions / 0% lines, exit 0, 4 files 89 passed.
  timestamp: 2026-08-05

## Evidence

- checked: grep for `job-entry-point` tree-wide
  found: one .ts occurrence, packages/core/src/index.ts. 20-VERIFICATION.md line 777 already records it FALSE (W1).
  implication: #69A real.

- checked: enumerate `Object.keys` of all eight workspace barrels under plain node
  found: aot 21 [], bench 21 [], browser 37 [], core 112 [executeReduce, executeVerified, runTask, runTaskAndPost, submitJob], demo 36 [], libp2p 26 [], net 39 [submitJobWithEgress], node 33 []
  implication: #69B real and stronger than reported — a job-shaped export already stood outside the guarded barrel.

- checked: static runtime-import closure over 251 default-project specs vs 1 perf spec, 137 production sources
  found: perf-only set = {packages/bench/src/perf-workload.ts}, size 1. Not-imported-by-any-default-spec = 18. Named by no *-PLAN.md = 25.
  implication: a size-1 guard is tractable; an 18-exemption guard is not.

- checked: 21-03-SUMMARY.md frontmatter vs its own body vs REQUIREMENTS.md
  found: `requirements-completed: [AOT-04]` against `- [ ] **AOT-04**` and a **Partial** row and the file's own Self-Check saying the opposite.
  implication: #65 row 1 real.

- checked: `ddca460` and every `describeKey` occurrence
  found: tools/aot/lift.ts pushes `key as hashed: ${describeKey(...)}` inside describeLift, with a comment naming 21-02.
  implication: #65 row 4 real.

- checked: `npx vitest run --project node packages/node/src/slow-specs.node.test.ts`
  found: EXIT=0, 9 passed at 13:38 (154 files). EXIT=1 after adding two guard files (156 of a recorded 150, tolerance 5).
  implication: the two new guards tipped the drift check. Retake unavailable — another agent's full node suite and an unrelated ninja build were live at load 51.89.

## Resolution

root_cause: |
  #69A — a comment written as evidence, never checked; the cited file never existed.
  #69B — the WIRE-04 guard imports `../index.ts` and nothing else, so seven of eight barrels
         were outside its corpus. Same family as #38 / #39 / #66.
  #65  — two genuinely false claims (21-03 frontmatter, 21-02's describeKey decision); one
         refutation that was itself false (21-05's wire elapsed); two dated snapshots
         mis-labelled as false claims.
  #19  — perf-workload.ts is production surface executed only by an opt-in project, so no
         default run can report it broken; a whole-tree tsc is the only cover, and tsc says
         nothing about behaviour.

fix: |
  - packages/core/src/index.ts — the false citation replaced by two grep-able symbols, with
    the original recorded as the defect it was.
  - packages/node/src/job-entry-points.node.test.ts — new: the same WIRE-04 predicate over all
    eight barrels, corpus read from `git ls-files`, cross-pinned to the core-side guard's regex.
  - packages/node/src/opt-in-only-sources.node.test.ts — new: exactly one production source may
    be reachable only from the opt-in perf project. The broader 18-file guard is declined with
    the measurement.
  - Four planning documents corrected in place, dated, originals retained.

verification: |
  tsc --noEmit EXIT=0, zero errors.
  job-entry-points: EXIT=0, 12 passed. Plant A (deprecation shim in @o2/node barrel) EXIT=1,
    restore cmp 0. Plant B (corpus shrunk to core, the #66 shape) EXIT=1, restore cmp 0.
  opt-in-only-sources: EXIT=0, 5 passed. Plant C (a second perf-only source) EXIT=1, restore
    cmp 0. Plant D (count type-only imports, the fail-open) EXIT=1 on two cases, restore cmp 0.
  core-side WIRE-04 guard after the barrel edit: EXIT=0, 2 passed.
  ten tree-scanning guards: 9 of 10 EXIT=0; slow-specs red on file-count drift, which is this
    work's own consequence and is reported rather than absorbed.

files_changed:
  - packages/core/src/index.ts
  - packages/node/src/job-entry-points.node.test.ts (new)
  - packages/node/src/opt-in-only-sources.node.test.ts (new)
  - .planning/phases/phase-21-aot-translation-signing-runtime/21-02-SUMMARY.md
  - .planning/phases/phase-21-aot-translation-signing-runtime/21-03-SUMMARY.md
  - .planning/phases/phase-21-aot-translation-signing-runtime/21-04-SUMMARY.md
  - .planning/phases/phase-21-aot-translation-signing-runtime/21-05-SUMMARY.md
  - .planning/phases/phase-21-aot-translation-signing-runtime/21-VERIFICATION.md
