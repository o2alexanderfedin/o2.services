---
status: investigating
trigger: "Retake MEASURED_NODE_SPANS: slow-specs.node.test.ts is RED — the node project holds 157 test files, the recorded measurement covered 150. Drift 7 against FILE_COUNT_TOLERANCE = 5. Guard is in .githooks/pre-commit so every commit touching a node spec is refused."
created: 2026-08-05T14:24:00Z
updated: 2026-08-05T14:30:00Z
---

## Current Focus

hypothesis: Not a defect. The recorded measurement is stale by 7 files. The fix is
  a full retake of MEASURED_NODE_SPANS + NODE_MEASUREMENT per the procedure in the
  docblock ("So this is the procedure, and it is not optional"), steps 1-5.
test: Follow the procedure; assert the three acceptance criteria at the end.
expecting: files 150 -> 157, table retaken in ONE run, hook-shadowed files cross-checked solo.
next_action: derive the file count by three independent routes (procedure step 4)

## Symptoms

expected: `npx vitest run --project node packages/node/src/slow-specs.node.test.ts` exits 0
actual: RED — "the node project holds 157 test files, the recorded measurement covered 150"
errors: slow-specs/file-count-drift blocking finding
reproduction: npx vitest run --project node packages/node/src/slow-specs.node.test.ts
started: today, as Phase 23 wave 1 specs landed

## Constraints discovered (read from source, not assumed)

- slow-specs.node.test.ts:313 asserts EVERY MEASURED_NODE_SPANS path is git-TRACKED.
  => the two untracked specs (job-entry-points, opt-in-only-sources) may NOT be added
  to the span table even if they measure above the ~300 ms listing floor.
- slow-specs.node.test.ts:303 says the walk reads the FILESYSTEM not the index, so
  untracked specs legitimately count toward NODE_PROJECT_FILES.length.
  => they MUST be counted in NODE_MEASUREMENT.files.
  These two facts pull in opposite directions and both are honoured.
- unitFiles must equal files - EXCLUDED.length (asserted, line 279)
- sumOfFileSpansMs >= sum of listed spans (asserted, line 282)
- SPANS must be in descending order (asserted, line 188)
- at least one span below the cutoff must remain listed (asserted, line 191)

## Eliminated

## Evidence

- timestamp: 2026-08-05T14:24Z
  checked: host quiescence per procedure step 1
  found: load 8.65/12.28/27.92 on 8 cores. pgrep vitest = none. TWO stray agent.ts
    processes exist (89890 leashed, 90017 unleashed, both PPID 1, orphan-leash temp
    dirs) contradicting the brief's "no stray agent.ts processes" — but both are
    0.0% CPU with 0.27s/0.29s CPU over 12h27m elapsed, state SN (sleeping, nice).
    They are orphan-leash test residue and do not contend.
  implication: agent.ts processes are not a contention risk; do not signal them
    (procedure step 1 forbids killing).

- timestamp: 2026-08-05T14:25Z
  checked: what is actually consuming CPU
  found: cpp2rust from /Volumes/ProjectsSSD/Projects/transpilers/cpp-to-rust at ~90%
    of one core, rolling per-file (PID 23287 -> 24460 between two calls = a sweep
    loop, .planning/scratch/rung2_measure). Chrome renderer ~90%. Adobe CC ~84%.
  implication: host is NOT quiet in the absolute sense. This is the same foreign
    cpp-to-rust project the previous pass waited 46 min for. Must poll and decide.

- timestamp: 2026-08-05T21:26Z
  checked: procedure step 4 — file count by three routes sharing no code
  found: A) `git ls-files` + glob filter = 155 (tracked only).
    B) `find` on the filesystem = 157.
    C) `npx vitest list --project node --filesOnly` = 157, exit 0.
    B and C are byte-identical sets (`diff` empty). B minus A = exactly the two
    untracked specs job-entry-points + opt-in-only-sources.
  implication: the real count is 157. Recorded 150. Drift 7 > tolerance 5. Confirmed.

- timestamp: 2026-08-05T21:27Z
  checked: procedure step 3 — positional hook-shadow analysis over all 157 files
  found: 5 files register a `beforeAll`; 47 have SOME hook running before their first
    case (almost all a top-level `beforeEach` that only `mkdtemp`s). Three do real
    work before the first case:
      aot-dispatch  beforeAll@536 nested, above first case@558
      start-reporting beforeAll@109 top-level, above first case@128
      echo-guest    beforeAll@271 nested, above first case@293
  implication: cross-check set is these 3, matching the previous pass's disagreeing 3.

- timestamp: 2026-08-05T21:27Z
  checked: two detector false leads, run down rather than accepted
  found: (a) my work-regex flagged `peer-dial` on the literal string 'o2-peer-dial-'
    inside `mkdtemp(join(tmpdir(),'o2-peer-dial-'))` — the hook is cheap, NOT shadowed.
    (b) `lift` has a TOP-LEVEL beforeAll@1364, which by the "top-level runs first" rule
    would be shadowed — but its body is `stubElfPath = writeAcceptableElf()`, a
    synchronous write. Its expensive container hooks are at 1656/2576, nested and BELOW
    first case@342, so the reporter charges them. This is exactly why the docblock's
    control (span 291_680 vs solo wall clock 369_826, agreeing 1.2%) held.
    (c) `bench-attestation` beforeAll@424 is top-level and above first case@435 but only
    `mkdtemp` + `repoStatus()`.
  implication: "has a hook" and even "has a top-level hook" both over-select. The
    operative test is pre-first-case AND does real work. Three files, not 47, not 5.

- timestamp: 2026-08-05T21:31Z
  checked: procedure step 1 — host, polled not assumed
  found: 6 samples over 3 min: load 6.66, 7.53, 7.04, 8.69, 10.61, 9.62. vitest=0
    throughout. cpp2rust=1 throughout — a SEQUENTIAL foreign sweep holding ~90% of one
    core of eight, not the 20-way clang++ farm at load 130-190 the previous pass waited
    46 min for.
  implication: proceeding and recording the condition, rather than waiting on a
    sequential sweep with no bounded end. Justified by the convention's own rule —
    record (user+sys)/real beside the span so the machine cancels out. Stated as a
    deviation in the report, not hidden.

## Resolution

root_cause: Not a code defect. NODE_MEASUREMENT recorded 150 files; the tree holds 157
  (confirmed by three independent routes). Drift 7 > FILE_COUNT_TOLERANCE 5, so the
  pre-commit guard refused every commit touching a node spec.

fix: Whole-table retake per the procedure, in ONE run.
  - files 150 -> 157, tests 2133 -> 2240, wallClock 293_670 -> 375_630
  - load 15.46/109.21/43.94 -> 9.32/69.02/12.02
  - sumOfReportedSpansMs 968_848 -> 1_109_154; sumOfFileSpansMs 1_492_277 -> 1_364_769
  - hookShadowCandidates 5 -> 6; hookShadowDisagreed 3 -> 2
  - unitFiles 98 -> 104 (directly observed: test:unit ran "103 passed (104)")
  - unitTests 1537 -> 1650 (observed count, not a duration)
  - unitWallClockMs LEFT at 7_750 and labelled stale — see gap below
  - excluded set 52 -> 53; table now 80 entries

verification:
  - tsc --noEmit exit 0 (twice, after each edit round)
  - slow-specs.node.test.ts exit 0, 9 passed  [ACCEPTANCE 1]
  - cheap guard set (6 files) exit 0, 234 passed  [ACCEPTANCE 2]
  - PLANT: files 157 -> 100, confirmed applied (grep count 1), run exit 1 with
    "holds 157 test files, the recorded measurement covered 100", 2 failed / 7 passed,
    restored byte-identical (cmp exit 0). Re-run after the slow-specs edit: same result.

gaps (stated, not closed):
  1. A fully green `--project node` run is UNOBTAINABLE at this commit.
     bench-reduce.node.test.ts fails at HEAD with both it and the bin/bench.ts it parses
     byte-identical to HEAD. Foreign, pre-existing, not mine to fix. Consequence:
     unitWallClockMs could not be retaken (the rule forbids durations from red runs), so
     it still carries the previous pass's 7.75 s beside a unitFiles of 104. The reading
     that was taken is recorded nowhere, per the precedent in that field's own docblock.
  2. job-entry-points.node.test.ts measured 2_737 ms — above the cut — but is untracked,
     and slow-specs asserts every span path is tracked. Counted in `files`, absent from
     the table, cost documented in the config for whoever commits it.
  3. The host was not fully quiet: a sequential foreign cpp2rust sweep held ~1 of 8 cores
     for the first 4 of 10 samples and exited unsignalled mid-run. Recorded, with
     (user+sys)/real = 1.15 beside it. All solo cross-checks were taken after it exited.

files_changed:
  - vitest.config.ts
  - packages/node/src/slow-specs.node.test.ts (advisory text cited superseded figures)
