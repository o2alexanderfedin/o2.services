---
phase: phase-23-multi-process-benchmark-driver
plan: 01
subsystem: benchmark-harness, report-rendering, pre-registration
tags: [BENCH-07, BENCH-02, BENCH-04, BENCH-06, provenance, integrity, pre-registration]
requires:
  - ".planning/BENCHMARK-METHODOLOGY.md — the `## Amendments` section and its existing 2026-07-31 entry, whose form the four new entries follow (pre-existing, UNCHANGED above the append point)"
  - "packages/bench/src/harness.ts — RunConfig, connectivityTax, SweepResult (extended here)"
  - "packages/bench/src/report.ts — Report, sweepTable, renderMarkdown (extended here)"
  - "packages/node/src/vocabulary.node.test.ts — the BANNED array, which scans the amended methodology (pre-existing, UNCHANGED)"
  - "packages/node/src/purity.node.test.ts — PORTABLE includes `bench`, which is why integrity.ts imports no platform (pre-existing, UNCHANGED)"
provides:
  - "four dated amendment entries committed four waves before the run they constrain, checkable in git log"
  - "RunConfig.driver / .fixture / .leg as REQUIRED fields — a run that does not say which rig produced it does not compile"
  - "Report.multiProcess, and a sweepTable that renders driver and fixture on every row"
  - "five further headings suffixed with the driver and fixture READ OFF the curve each is computed from"
  - "connectivityTax refusing a repeated node count instead of keeping whichever entry came last"
  - "@o2/bench's integrity.ts — four pure readings, one declared threshold, one error class, one gate, all barrel-exported"
affects:
  - "23-03 — supplies the production caller for assertIntegrity, and MUST fix bin/bench.ts's three RunConfig literals (see the blocker below)"
  - "23-04 / 23-05 / 23-06 — every published heading now carries provenance derived from data; a new curve must carry a driver and fixture or it will not compile"
  - "packages/bench/src/perf-workload.ts — BROKEN by this plan and owned by no Phase 23 plan (see the blocker below)"
tech-stack:
  added: []
  patterns:
    - "provenance made structural: required fields rather than an editorial heading, because raw.json has no headings"
    - "a heading derived from the data it labels, proved by rendering the same report twice and asserting the headings differ"
    - "an empty reading treated as a violation, because an absent instrument and a clean run look identical"
    - "one gate function with one call site per rung, chosen because a source-text guard matches identifiers and not data flow"
    - "a plant that stayed green reported and replaced, rather than recorded as a proof"
decisions:
  - "the five suffixed headings put the provenance at the END of the heading, which is what `suffix` says and which leaves the pre-existing `## Reduce tree — memory transport (SAME-MACHINE` assertion passing unchanged"
  - "the three makespan headings derive their driver from the curve too, rather than interpolating the literal the plan wrote out; the plan's exact string still renders, because the multi-process curve carries that driver"
  - "17 planted defects, not the plan's 16: two identity cases legitimately trip two cardinality readings and both are asserted, and a short agent list was added beside the wrong-length one"
  - "the plan's named mutation for the machine label CANNOT redden; a per-heading case was added and the plant re-run against it"
  - "bin/bench.ts and perf-workload.ts left broken: outside files_modified, and the executor was instructed not to touch such a file even to fix something obviously wrong"
metrics:
  duration: ~1h
  completed: 2026-08-05
---

# Phase 23 Plan 01: Pre-registration, declared provenance, and the integrity checker Summary

The plan that constrains this phase's run is now amended, dated, and committed four waves
before the run exists. A `RunConfig` cannot be built without saying which driver, which
fixture and which dispatch leg produced it. Every makespan row carries two provenance
cells, every makespan heading names its driver, and five further headings name the driver
and fixture **read off the curve they are computed from** — proved by rendering the same
report twice and watching the headings diverge. `connectivityTax` no longer collapses two
curves into one row in silence. And `@o2/bench` exports a harness-integrity gate whose
four readings have each been watched reporting a planted defect.

**One thing this plan does not deliver: `npx tsc --noEmit` does not exit 0.** Four
`RunConfig` literals in two files outside this plan's declared list no longer compile. That
is stated first because it is the plan's own verification gate and it is **NOT MET** — see
the blocker section rather than the end of the document.

---

## What landed

### `.planning/BENCHMARK-METHODOLOGY.md` — four dated entries, one diff hunk

Appended below the existing `### 2026-07-31 — the reduce leg` entry, in its form. `git diff`
before the commit: **one hunk, `@@ -383,0 +384,206 @@`, 206 insertions, 0 deletions** —
nothing above the append point moved, not a word, not a table cell.

| entry | what it fixes in the pre-registered plan |
|---|---|
| a second fixture | §6.3's declared bias that the WASM fixtures do almost no work, which makes this phase's primary question unaskable |
| a third driver, and two declared dimensions | both published curves built every node in one event loop, so no speedup was measurable at any node count |
| a fixed-redundancy speedup sweep | the existing ladders run `min(2, nodes)`, so a ratio across them varies parallelism *and* replication |
| an opt-in dispatch leg, and a third dimension | AUTH-03's requestor half has no production caller, by owner ruling of 2026-07-31 |

**No per-shard figure and no pre-registered speedup appears anywhere in the new prose**,
and that is the amendment's most load-bearing property. Entry 1 states the fixture
parameter is chosen **by measurement in Plan 23-03**, at `SHARDS` partitions, against three
acceptance conditions declared now (every shard returns `budget`; the encoded input stays
under `WIRE_CHUNK_BYTES = 16_384`; the partition count is a power of two). Entry 3
withdraws the ideal-speedup figure and replaces it with a *method* — `sum / max` over
`SHARDS` per-shard durations from a **serial calibration** on the N=1 process-per-node
fabric — plus the reason the measured job's own per-call times cannot supply it
(`submitJob` dispatches concurrently, so even at N=1 the intervals overlap, and a sum of
overlapping intervals is not a serial total).

Entry 2 declares the three integrity thresholds before any data exists, including
`MAX_DRIVER_CPU_SHARE = 0.5`, and says in the plan's own required words that a same-host
run **cannot** detect divergence between machines and that the distinct-machine claim is
**descoped and unmeasured, and unmeasured is not met**. It also states plainly that this
phase sweeps §1.1's node-count axis only.

### `packages/bench/src/harness.ts`

`DriverKind`, `FixtureKind`, `DispatchLeg` — three exported string unions, each documented
as what the value licenses a reader to conclude rather than as an implementation note.
`DispatchLeg`'s doc says it is a fact about what the rung *dispatched*, that its purpose is
to make the sovereign leg's promise checkable in `raw.json`, and that it is **not a node
kind**.

All three added to `RunConfig` as **required** readonly fields, with the reason written
beside them: `raw.json` has no headings to fall back on, and an optional provenance field
is one that gets omitted at the call site nobody re-reads.

`refuseDuplicateRungs(curve, results)` — a new local, called twice at the head of
`connectivityTax`. It throws a `RangeError` naming the curve and the repeated count. The
docblock states why this is an error and not a merge: the tax is defined over one
configuration per node count per transport, so a second entry means something else varied,
and the function cannot see which to prefer.

### `packages/bench/src/report.ts`

`Report.multiProcess?` — the process-per-node curve, kept apart from `realTransport`, with
the reason recorded (appending it there is exactly what the old `Map` collapsed).

`sweepTable` renders `driver` and `fixture` immediately after `nodes` — fourteen columns
now, header and alignment row moved together. **No `leg` column**, deliberately: its value
is the same in every published row, and the file already says a constant is not a result.

`provenanceOf(curve)` and `driverOf(curve)` — both read the **first result's config**, both
return `no runs` on an empty curve. Three makespan headings name their driver; five further
headings are suffixed with `— <driver> driver, <fixture> fixture`:

| heading | derived from |
|---|---|
| `## Configurations excluded, and why` | `realTransport`, falling back to `memoryTransport` when empty |
| `## Connectivity tax` | `memoryTransport` |
| `## COST crossover` | `memoryTransport` |
| `## Reduce tree — memory transport` | `memoryTransport` |
| `## Reduce tree — real transport` | `realTransport` |

**The suffix goes at the end of the heading, after the machine label.** That is what
*suffix* says, and it has a second benefit that was measured rather than guessed: the
pre-existing assertion `expect(markdown).toContain('## Reduce tree — memory transport
(SAME-MACHINE')` keeps passing **unchanged**. Putting the provenance before the label
parenthesis would have broken it.

### `packages/bench/src/integrity.ts` — new, 335 lines

`MAX_DRIVER_CPU_SHARE`, `HarnessIntegrityError`, `assertIntegrity`, and four pure readings
over four observation interfaces. Module comment states what nothing in this repository can
otherwise state: **nothing in CI runs `bin/bench.ts`** (its `main()` executes on import), so
these fire when a human runs the benchmark and not when a change breaks it — which is the
whole argument for pure functions with planted-input tests. It also states what that does
**not** prove and marks it **unmeasured**: that the driver builds its observation from the
live fabric rather than from a constant.

### `packages/bench/src/index.ts`

One new export block for the integrity names, with a comment saying Plan 23-03 supplies the
production caller and that until then every name in it joins `sweepNodeCount` on the
built-not-wired list. **Also added `DispatchLeg`, `DriverKind`, `FixtureKind` to the
existing harness type block** — three names, so later plans can spell the dimensions they
have to fill in. That is one line outside the plan's literal instruction for this file and
is disclosed here rather than left to be noticed.

---

## Every mutation planted, and the exact text observed

Restored by `cp` + `cmp` after each; `cmp` exit `0` recorded every time. Never
`git checkout --`, never `git stash`.

### Task 1 — the methodology

**Plant A — one term from `vocabulary.node.test.ts`'s `BANNED` array appended to a
sentence of the new prose.** The term is the fourth entry of that array; it is **redacted
here on purpose**, because this file is inside the scanned tree and a document quoting the
prohibition is itself a violation — which is the same reason 23-CONTEXT.md refuses to
enumerate the list. **RED, exit 1**, and the guard named the file, the line and the term:

```
FAIL packages/node/src/vocabulary.node.test.ts > no cryptojacking vocabulary reaches a
reviewer who greps > says "‹term›" nowhere — a currency word, and the fabric settles
nothing …
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ ".planning/BENCHMARK-METHODOLOGY.md:576 \"‹term›\" — column: in every published
    curve its value is the same, and a constant is not a result, and no ‹term› change
    hands.", ]
```

**Plant B — the last amendment entry deleted** (from its heading to EOF). The dated-entry
count fell from **4 to 3**, so the verify block's `test "$(grep -c …)" = "4"` gate exited
**1**.

**Plant C — an entry written above the existing 2026-07-31 heading.** `git diff -U0` grew a
second hunk, `@@ -280,0 +281,4 @@`, i.e. an edit outside the append region. After restore,
one hunk again: `@@ -383,0 +384,206 @@`.

### Task 2 — the declared dimensions

**Plant 1 — `readonly driver: DriverKind` deleted from `RunConfig`.** `tsc` **exit 1**,
eight errors inside `packages/bench` alone:

```
harness.test.ts(29,3): error TS2353: Object literal may only specify known properties,
  and 'driver' does not exist in type 'RunConfig'.
perf-workload.ts(316,3): error TS2739: … missing the following properties … fixture, leg
report.ts(164,55): error TS2339: Property 'driver' does not exist on type 'RunConfig'.
```

*(This plant is also how `perf-workload.ts` was found — see the blocker.)*

**Plant 2 — the `driver` cell deleted from `sweepTable`'s row template.** **RED, exit 1**,
four failures, and the split the plan asked for is visible in the first one: the **heading**
assertion above it passed and the **row** assertion failed.

```
AssertionError: expected '# Test run\n\n**SAME-MACHINE: 8 nodes…' to contain
  '| 1 | process-per-node | saturating |'
AssertionError: expected [ 16, 15 ] to have a length of 1 but got 2
```

**Plant 3 — one `provenanceOf(...)` call replaced by a string literal.** **RED, exit 1**:

```
AssertionError: expected '## Connectivity tax — in-process driv…' to not deeply equal
  '## Connectivity tax — in-process driv…'
AssertionError: expected '## Connectivity tax — in-process driv…' to be
  '## Connectivity tax — no runs'
```

**Plant 5 — `refuseDuplicateRungs` calls deleted.** **RED, exit 1**,
`AssertionError: expected [Function] to throw an error`.

### Plant 4 — the one the plan named that CANNOT redden

**`${label}` dropped from a makespan heading. Applied correctly — the rendered heading
line confirmed without it — and the tree stayed GREEN: vitest exit 0, `Test Files 3
passed (3)`, `Tests 63 passed (63)`.**

The plan named this mutation and named
`expect(occurrences).toBeGreaterThanOrEqual(3)` on `SAME-MACHINE` as what holds it. That
assertion counts occurrences **over the whole document**: a top-of-page label plus two
makespan and two reduce headings is five, so dropping one leaves four, which clears the
floor. Adding a third makespan section makes the floor slacker still. **The plan's own
words — "so the existing assertion passes with room to spare rather than by luck" — turn
out to describe why it cannot fail.**

Reported rather than recorded as a green, and replaced. A per-heading case now reads every
line starting `## Makespan` and requires the label in each, with an anti-vacuity length
check first. The same mutation re-planted against it — **RED, exit 1**:

```
FAIL … > keeps the derived label in every makespan heading, not merely somewhere
AssertionError: expected '## Makespan — memory transport, in-pr…' to contain 'SAME-MACHINE'
```

The pre-existing occurrence assertion is left standing and unchanged: it is still true, it
was never sufficient, and deleting it would remove the only reading of the top-of-page
label.

*(A first attempt at Plant 4 did not apply at all — perl interpolated `${driverOf(...)}` in
the replacement. The green run it produced is therefore a clean control and nothing else,
and the plant was redone with the substitution on the pattern side only. Recorded because a
plant that did not apply and a plant that applied and stayed green look identical in a log.)*

### Task 3 — the integrity checker

Eleven mutations, each `perl -pi` inside one invocation with `cp` restore and `cmp` in the
same invocation. Every one **RED, exit 1**.

| # | mutation | observed |
|---|---|---|
| M1 | distinctness condition → `false` | `reports a repeated process id`: `expected [] to have a length of 1 but got +0` |
| M2 | `executorNodeIds.length !== expected` → `false` | 3 failures, incl. `reports a fabric that built no executors, which every membership check passes`: `expected [] to have a length of 1 but got +0` |
| M3 | `if (agents.length === 0)` → `if (false)` | `expected '0 agent processes were observed where…' to contain 'no agent'` |
| M4 | `MAX_DRIVER_CPU_SHARE` 0.5 → 5 | `expected [] to have a length of 1`, and `expected 5 to be 0.5` |
| M5 | `shardComputeMs <= 0` → `<= -1` | `reports a shard compute total that read nothing…`: `expected [] to have a length of 1 but got +0` |
| M6 | `driverCpuMs <= 0` → `<= -1` | `reports a driver CPU delta that read nothing…`: `expected [] to have a length of 1 but got +0` |
| M7 | `statuses.filter` → `statuses.slice(0, 1).filter` | `reports a single shard that ended some other way…`: `expected [] to have a length of 1 but got +0` |
| M8 | CID comparison → a comparison of the declared name with itself | `reports a declaration that does not match the module the rung dispatched`: `expected [] to have a length of 1 but got +0` |
| M9 | the `throw` in `assertIntegrity` → `return` | `expected function to throw an error, but it didn't` |
| M10 | the empty-vector early return deleted | `expected 'the shard status vector holds 0 entri…' to contain 'empty'` |
| M11 | `import { cpus } from 'node:os'` added to `integrity.ts` | `purity.node.test.ts`: `+ "packages/bench/src/integrity.ts imports \"node:os\" — a Node builtin does not exist in a browser"` |

M2 and M5/M6 are the two the plan singles out, and both behaved as it predicted: deleting
the executor count makes an empty fabric pass every membership check vacuously, and
deleting either zero check makes a run whose clocks were never sampled clear the ceiling.

---

## Claims in the plan measured FALSE, or deliberately not followed

1. **`<verification>`: "`npx tsc --noEmit` exits 0 for the whole repository."**
   **NOT MET.** It exits **1**, with exactly four errors. See the blocker below. This is a
   contradiction inside the plan itself — the plan makes three `RunConfig` fields required
   *and* defers `bin/bench.ts` to Plan 23-03 *and* asserts a clean whole-tree typecheck, and
   at most two of those three can hold. Stated as unmet rather than reinterpreted.

2. **`<action>`, Task 2: "The label survives the third section. The existing
   `expect(occurrences).toBeGreaterThanOrEqual(3)` on `SAME-MACHINE`, unchanged.
   **Mutation:** drop `${label}` from any makespan heading."** The mutation **does not
   redden**. Measured, above. A per-heading case was added; the pre-existing assertion is
   unchanged and still green.

3. **`<action>`, Task 3: "Sixteen planted defects in all (8 identity + 3 CPU + 3 uniformity
   + 2 provenance)."** **Seventeen**, and the plan says its behavior list is the authority
   where the two disagree. Two departures, both stated in `integrity.test.ts` beside the
   cases:
   - A **short** agent list also short-changes the executor list, so both cardinality
     readings fire. That is correct behaviour rather than leakage, so the case asserts a
     two-entry list, and a separate case with a **long** agent list asserts the one-entry
     form. That is the seventeenth.
   - A fabric that observed **no agents** also built no executors, so that case likewise
     asserts two entries. Engineering the fixture until every plant produced exactly one
     entry would have hidden a real interaction between the two readings the plan calls
     the most important in the file.

4. **`<action>`, Task 2: the third makespan heading given as a literal,
   `` `## Makespan — real transport, process-per-node driver (${label})` ``.** Implemented as
   a **derivation** from the curve instead, for the reason the plan gives two paragraphs
   later about the other five headings. The plan's exact string still renders, because the
   curve carries that driver — the assertion
   `toContain('## Makespan — real transport, process-per-node driver')` passes. The two
   pre-existing makespan headings derive their driver the same way; a `no runs` fallback
   covers an empty curve, which several pre-existing tests supply.

5. **`<action>`, Task 3, "In `packages/bench/src/index.ts` … does not restructure the
   existing ones."** Three type names — `DispatchLeg`, `DriverKind`, `FixtureKind` — were
   added to the existing `harness.ts` type block. Disclosed above.

---

## BLOCKER handed onward — four `tsc` errors this plan caused and may not fix

```
packages/bench/src/perf-workload.ts(316,3): error TS2739: … missing driver, fixture, leg
packages/node/src/bin/bench.ts(1477,9):     error TS2739: … missing driver, fixture, leg
packages/node/src/bin/bench.ts(1503,11):    error TS2739: … missing driver, fixture, leg
packages/node/src/bin/bench.ts(1535,5):     error TS2739: … missing driver, fixture, leg
```

Making the three provenance fields **required** is this plan's central `must_haves` truth
and the thing the whole task exists for. Four `RunConfig` literals elsewhere therefore stop
compiling. **Neither file is in this plan's `files_modified`**, and this executor's
instructions were explicit that a file outside that list is not to be touched *even to fix
something obviously wrong* — report it instead. So neither was touched.

**The remedy is three properties per literal**, and every one of these rungs is an
in-process, trivial-fixture, public-leg run, so the values are determinate today:

```ts
driver: 'in-process',
fixture: 'trivial',
leg: 'public',
```

- **`bin/bench.ts`'s three belong to Plan 23-03**, which owns that file and whose job is
  precisely to supply these call sites. Nothing extra is needed there.
- **`perf-workload.ts`'s one, in `gateConfig`, is owned by no Phase 23 plan.** It is the
  one that will otherwise stay broken. It is exercised by `--project perf`, not
  `--project node`, so no node-tier suite reports it and only a whole-tree `tsc` does.
  At runtime the missing fields would render as blank driver and fixture cells in any
  report built from a `gateConfig` — `perf-gate` computes ratios rather than markdown, so
  nothing renders one today.

Also recorded in `deferred-items.md`, as a new dated section **appended** below 23-02's.
That file was created untracked by the concurrently-running 23-02; it is committed here
rather than left on disk, because a blocker record that only exists in a working tree is
one an interrupted session loses. 23-02's own two entries ride along unaltered, and the
commit message says so.

---

## Readings taken, exit codes read directly

Every exit code below was captured by `EXIT=$?` on the line immediately after the command,
with no pipe and no trailing filter between them.

| what | exit | timing | load (1 min) |
|---|---|---|---|
| `tsc --noEmit`, baseline before any edit | **0** | `real 1.09 user 1.79 sys 0.42` | 5.59 |
| `vitest --project node vocabulary.node.test.ts`, after Task 1 | **0**, 25 passed | `real 1.89 user 1.05 sys 0.28` | 5.15 |
| `vitest --project node packages/bench`, Task 2 RED | **1**, 8 failed / 55 passed | — | — |
| `vitest --project node packages/bench`, Task 2 GREEN | **0**, 63 passed | — | 3.90 |
| `vitest --project node packages/bench`, Task 3 RED | **1**, module not found | — | — |
| `vitest --project node packages/bench`, Task 3 GREEN | **0**, 89 passed | — | — |
| `vitest --project node purity.node.test.ts` | **0**, 22 passed | — | 4.26 |
| **every spec touching the changed modules** (see below) | **0**, 10 files / 216 passed | `real 2.81 user 2.97 sys 0.66` | **45.73** |
| `vitest --project browser packages/bench/src/integrity.test.ts` | **0**, 3 files / 75 passed | `real 5.54 user 5.55 sys 2.25` | — |
| `tsc --noEmit`, final | **1**, the four errors above | — | — |

The ten node-tier files run together: `packages/bench` (harness, integrity, stats),
`purity.node.test.ts`, `vocabulary.node.test.ts`, `bench-reduce.node.test.ts`,
`acceptance-traceability.node.test.ts`, `bench-egress.node.test.ts`,
`serve-agent-hooks.node.test.ts`. Those last four are the guards over the benchmark driver
and its report; none of them moved.

`(user+sys)/real` on the ten-file run is **1.29** — above one because vitest forks, and
taken at 1-minute load **45.73** with a second agent active in the same tree. It is a
comparability key and not a verdict.

**The browser reading matters for one claim only:** `integrity.test.ts` carries no `.node.`
suffix and the plan asserts it runs under both projects. It does — three files, 75 tests,
exit 0.

**No whole-tree `--project node` run was taken.** The plan's verification block does not ask
for one, and a second agent was committing to `packages/node` throughout; the four guards
over the benchmark driver were run instead, which is the population this plan can be
answerable for.

---

## The shared-tree hazards, and what was done about them

- **`git add` was run only between test runs, never during one.** `discover-arm.node.test.ts`
  and `bench-attestation.node.test.ts` snapshot `git status --porcelain` around themselves;
  neither was run by this plan, and no staging happened while any run was in flight.
- **Every commit used explicit paths** (`git commit … -- <path>`) and every one was read
  back with `git show --stat`. Each contains only this plan's own files.
- **The concurrent agent's files were never touched.** `packages/node/src/bench-fabric.ts`
  and `bench-fabric.node.test.ts` appeared and were committed by 23-02 mid-execution; an
  early `tsc` run reported fourteen errors in them, which had vanished by the next run.
  Recorded because it is exactly the "re-run before diagnosing" case, and diagnosing on the
  first reading would have produced a false finding.
- **`deferred-items.md` was appended to, not rewritten, and not staged.** It is 23-02's
  untracked file.

---

## Known Stubs

None. Every value this plan renders is read from data supplied by the caller, and the two
`no runs` strings are the truthful reading of an empty curve rather than a placeholder.

## TDD Gate Compliance

Both `tdd="true"` tasks have a real RED gate, committed before its implementation:

- **Task 2** — `ad0f406` `test(23-01)`, observed **exit 1**, `Tests 8 failed | 55 passed`,
  each failure named above. Then `4d6c64a` `feat(23-01)`, exit 0.
- **Task 3** — `34fbb25` `test(23-01)`, observed **exit 1**,
  `Cannot find module './integrity.ts'`. Then `6c1752e` `feat(23-01)`, exit 0.

`d0c623f` is a second `test(...)` commit *after* a `feat(...)`, and that ordering is
deliberate: it carries the case that replaced a plant measured unable to fail, which could
not have been written before the measurement that motivated it. No REFACTOR commit — there
was nothing to clean up that the GREEN commits did not already carry.

## Commits

| Commit | What |
|---|---|
| `afef35e` | `docs(23-01)` — four dated amendment entries, one diff hunk, nothing above the append point |
| `ad0f406` | `test(23-01)` — RED for the declared dimensions and the tax that cannot collapse |
| `4d6c64a` | `feat(23-01)` — `RunConfig`'s three required fields, `Report.multiProcess`, two columns, eight provenance-bearing headings, `refuseDuplicateRungs` |
| `d0c623f` | `test(23-01)` — the per-heading label case the occurrence count could not carry |
| `34fbb25` | `test(23-01)` — RED for the integrity gate, before the gate existed |
| `6c1752e` | `feat(23-01)` — `integrity.ts` and the barrel block |

## Self-Check: PASSED

- `.planning/BENCHMARK-METHODOLOGY.md` — FOUND, 4 entries dated 2026-08-05
- `packages/bench/src/harness.ts` — FOUND
- `packages/bench/src/report.ts` — FOUND
- `packages/bench/src/integrity.ts` — FOUND, 335 lines (min 140)
- `packages/bench/src/integrity.test.ts` — FOUND, 318 lines (min 140)
- `packages/bench/src/index.ts` — FOUND
- `packages/bench/src/harness.test.ts` — FOUND
- commits `afef35e`, `ad0f406`, `4d6c64a`, `d0c623f`, `34fbb25`, `6c1752e` — all FOUND in
  `git log`
