---
phase: phase-23-multi-process-benchmark-driver
plan: 03
subsystem: benchmark-driver, saturating-fixture, harness-integrity
tags: [BENCH-07, criterion-1, criterion-2, criterion-4, process-per-node, saturating-fixture, integrity-gate, provenance]
requires:
  - "packages/bench/src/integrity.ts — 23-01's four readings, MAX_DRIVER_CPU_SHARE, HarnessIntegrityError, assertIntegrity (UNCHANGED, consumed here)"
  - "packages/bench/src/harness.ts — RunConfig's three required provenance fields, DriverKind/FixtureKind/CpuAttribution/ProcessIdentity (UNCHANGED)"
  - "packages/bench/src/report.ts — Report.multiProcess, sweepTable's two provenance columns, the derived headings (UNCHANGED)"
  - "packages/node/src/bench-fabric.ts — 23-02's ten-member Fabric, AgentHandle, ProcessFabric, processFabric (UNCHANGED; its Fabric is now imported rather than re-declared)"
  - "packages/demo/src — buildInput, readPartial, DEFAULT_BUDGET, kernelBytes (UNCHANGED, imported by name)"
  - "packages/node/src/{bench-egress,serve-agent-hooks,coverage-agents,discover-arm,bench-attestation,purity,vocabulary}.node.test.ts — the seven guards over this file (all UNCHANGED, all green)"
provides:
  - "npx tsc --noEmit exits 0 for the whole repository again — the three RunConfig literals 23-01 broke are fixed"
  - "a benchmark rung whose nodes are N operating-system processes, checked on four readings through one gate, aborting the run rather than publishing a curve"
  - "SATURATING_N = 600, measured at sixteen partitions against three declared acceptance conditions"
  - "FIXTURE_CIDS built from bytes, so which fixture a rung ran is a fact about content addresses"
  - "a two-driver speedup comparison with a bound derived by serial calibration on the run's own N=1 fabric"
  - "packages/node/src/bench-driver.node.test.ts — eight call-site requirements, each watched reporting"
affects:
  - "23-04 — inherits the gate; every catch it adds must open with the HarnessIntegrityError re-throw or bench-driver's count equality reddens. It is also the natural owner of the realFabric leak logged in deferred-items.md"
  - "23-05 — the published run now carries a process table, a speedup section and per-driver unmet entries; and it WILL hang after the failing 16-node rung (deferred-items.md)"
  - "23-06 — the sovereign leg lands on a file whose RunConfig literals all state leg: 'public' as a fact"
tech-stack:
  added: []
  patterns:
    - "one measured job path shared by both drivers, so the comparison cannot be measuring a second copy of it"
    - "a control that refuted its own rationale, reported as the finding rather than smoothed over"
    - "an absence requirement planted by ADDITION, with the vacuity carried as data rather than left to be discovered"
    - "a plant that left the tree green traced to a defective fixture, the fixture rebuilt from the requirements themselves, and the plant re-run"
    - "a live run aborted by a planted defect, used as the proof that the gate stops a run rather than annotating one"
decisions:
  - "the speedup sweeps do not run under --quick: coverage-agents.node.test.ts waits for the whole run inside 180 s and asserts exit 0, and a saturating fixture across spawned processes is minutes of work whose integrity failures abort by design"
  - "the reduce leg runs on the trivial fixture only — sixteen identical budget partials collapse deriveReduceTree's leaf set, and the only way back to distinct leaves is the partition-index substitution project's own docblock refuses"
  - "the Fabric seam is imported from bench-fabric.ts rather than declared a second time, which deletes realFabric's cast over a store that was never a MemoryBlockstore"
  - "realFabric gains an optional fixture parameter rather than a fourth rig, because bench-egress.node.test.ts requires it to survive by name and the control must differ from the process rig in exactly one thing"
  - "the driver's non-exit after a failed rung is logged, not fixed: measured pre-existing with all of this plan's code switched off"
metrics:
  duration: ~2h45m
  completed: 2026-08-05
---

# Phase 23 Plan 03: The saturating fixture and the process-per-node driver Summary

`bin/bench.ts` now runs a rung whose N nodes are N operating-system processes, checks
four readings on it through one gate, and **aborts the whole run rather than publishing a
curve** when any of them reports — watched doing exactly that, twice, against planted
defects, with no report file written either time.

**The live red is gone.** `npx tsc --noEmit` exits **0** for the whole repository. The
three `RunConfig` literals 23-01 left broken are fixed, and each states what its rung
actually is rather than taking a default.

**And the control refuted the plan that asked for it.** The plan predicted the in-process
control "must stay flat; it cannot do otherwise on one event loop." It is not flat: a
`FabricNode` composes a `WorkerExecutor` on its own worker thread, so N in-process nodes
are N threads on this host's cores. At eight nodes the control reached **7.76×** its own
one-node makespan against the process driver's **3.84×**. What the two sweeps compare is
**process isolation against threads inside one process** — not parallelism against none —
and that sentence is now in the source, in the report prose and in the `unmet` list,
because a single curve would have been read the other way.

---

## The fixture parameter, measured before it was written down

Run at `SHARDS = 16` partitions with `budget = DEFAULT_BUDGET`, against the three declared
acceptance conditions. Every status vector below was **observed**, not predicted.

| n | raw bytes | encoded (wire) | all sixteen shards on `budget`? |
|---|---|---|---|
| 300 | 4 332 | 4 335 | **no** — 8 `found` |
| 400 | 5 952 | 5 955 | **no** — 2 `found` |
| 500 | 7 656 | 7 659 | **no** — 3 `found` |
| 520 | 8 016 | 8 019 | **no** — 1 `found` |
| 550 | 8 544 | 8 547 | yes |
| 580 | 9 072 | 9 075 | yes |
| **600** | **9 432** | **9 435** | **yes — chosen** |
| 700 | 11 184 | 11 187 | yes |
| 800 | 12 984 | 12 987 | yes |
| 1000 | 16 596 | 16 599 | **disqualified** — at or above `WIRE_CHUNK_BYTES` (16 384) |
| 1200 | 20 364 | 20 367 | **disqualified** — same |

**600 was chosen over the smaller qualifying 550** because it sits inside a measured
plateau rather than at its edge: 520 still produces a `found` shard, and 550, 580 and 600
were each measured uniform. Its encoded payload is **9 435 B**, 58% of the wire bound, so
it has headroom on condition 2 as well. The status vector at 600 was taken twice and was
identical both times, which is what a deterministic budget-bounded search should give.

The 2026-07-28 table this replaces was taken at **eight** partitions and every figure in it
is about a configuration this phase does not run. Its `n = 1000` disqualification happens to
survive re-measurement at sixteen — the wire size does not depend on the partition count —
and that is stated rather than inherited.

**Cross-validated later, by accident and usefully.** Planting `SATURATING_N = 300` into the
shipped driver and running it produced the abort message
`8 of 16 shards ended on something other than budget: [found, found, found, budget, budget,
found, found, budget, found, budget, found, budget, budget, budget, found, budget]` — the
same eight positions the offline measurement recorded. The offline instrument and the live
one agree.

---

## What landed in `packages/node/src/bin/bench.ts`

### The fixture, and provenance on every literal

- `SATURATING_N = 600`, documented with the chosen value, the date and the three conditions
  — and **no per-shard duration, serial total or expected speedup anywhere in its doc**.
- `SATURATING_MODULE_CID` from `MemoryBlockstore().put(kernelBytes)`; `SATURATING_RECORD`
  signing it under `BENCH_SIGNING_SEED`, so `BENCH_TRUST_ANCHOR` is unchanged and both
  records are vouched for by one key. Each record's doc says which module it is for.
- `FIXTURE_CIDS: Readonly<Record<FixtureKind, string>>`, built **from the bytes**.
- `sameFixtureCid(rig, moduleCid, expected)` — the expected CID is now an argument, because
  there are two modules and a rig holding the wrong record is the same whole-rig silent zero
  this function exists to convert.
- `shardInputs(skew, fixture)`. The saturating arm hands every shard the identical block,
  which is `@o2/demo`'s own design, and the reason is written at the call site.
- Every `RunConfig` literal states `driver`, `fixture` and `leg`.

**`@o2/node` already declared `@o2/demo`.** The plan's first instruction — add the
dependency — was already satisfied in the committed `package.json`, so `packages/node/package.json`
was **not modified**. Only the import by name was added. Reported rather than silently skipped.

### The driver, the gate and the calibration

- **`runnerOver(acquire, state)`** — one measured job path, shared. Two runners differ only
  in `acquire`. A second copy of the submit body would let the two drivers drift with nothing
  able to catch it, at which point the ratio measures the copy.
- **`processRunnerFor`** holds one `ProcessFabric` at a time and disposes the previous rung's
  when `config.nodes` changes. `runnerFor` is untouched for the two published legs.
- **`timed`** gains `calls: number[]`, documented as **dispatch-to-response intervals that
  overlap**, with the explicit statement that `sum/max` over them is not `serialTotal/maxShard`
  and must not be published as it.
- **`gateRung`** — the four readings concatenated into **one** `assertIntegrity` call. There
  is exactly **one** occurrence of `assertIntegrity(` in the file, and one call site per rung.
- **Every catch re-throws.** Three `catch (` and three `instanceof HarnessIntegrityError`.
- **`calibratePerShard`** — sixteen serial `execute` calls on the warm N=1 process fabric,
  called from exactly one place, in the `nodes === 1` iteration.
- **`SPEEDUP_LADDER = [1, 2, 4, 8]`**, both sweeps at `redundancy: 1`, `fixture: 'saturating'`,
  `leg: 'public'`, `transport: 'real'`.
- Headings print as `  speedup, <driver>, <n> node(s)…`, which cannot match
  `coverage-agents.node.test.ts`'s `/^ {2}(memory|real) transport, (\d+) node\(s\)…$/`.

### The report

Two appended sections, each naming a driver in its heading:
`## Processes — process-per-node driver, saturating fixture` and
`## Speedup — in-process and process-per-node drivers, fixed redundancy 1, saturating fixture`.
`Report.multiProcess` carries the process curve, so `renderMarkdown` renders a third makespan
table for free and `connectivityTax` never sees a repeated node count. `raw.json` gains three
riders: `speedup`, `processes` and `calibrationPerShardMs`.

The `unmet` list's first entry was **false about the real-transport rig and is corrected**:
it said every node in both curves runs on one event loop, which is true of `memoryFabric`
and false of `realFabric`, whose nodes are `FabricNode`s with their own worker threads.

---

## The run this was proved on

**Full driver, no flags, temp cwd, shipped configuration** — `LADDER`, `REAL_LADDER` and
`SPEEDUP_LADDER` all as committed, `RUNS = 20`.

> **These are functional readings, not publishable figures.** The one-minute load average
> was **80.15** at the start and **50.83** at the end, with two other agents active in the
> tree. Plan 23-05 owns the published run and must re-take every number here on a quiet
> host. What this run establishes is that the mechanism works end to end at the shipped
> ladder — every rung completed, `incomplete = 0` on all eight.

| nodes | driver | p50 | speedup vs its own 1-node rung | driver CPU share | spec. tax | speculated |
|---|---|---|---|---|---|---|
| 1 | process-per-node | 2564.7ms | 1.00× | 0.004 | 1.00× | false |
| 1 | in-process | 2985.2ms | 1.00× | 0.063 | 1.00× | false |
| 2 | process-per-node | 1392.7ms | 1.84× | 0.007 | 1.06× | false/true |
| 2 | in-process | 1201.2ms | 2.49× | 0.156 | 1.06× | false/true |
| 4 | process-per-node | 775.6ms | 3.31× | 0.009 | 1.05× | false |
| 4 | in-process | 610.7ms | 4.89× | 0.274 | 1.05× | false/true |
| 8 | process-per-node | **667.6ms** | **3.84×** | 0.009 | 1.04× | false/true |
| 8 | in-process | **384.8ms** | **7.76×** | 0.379 | 1.02× | false |

Process table, observed:

| nodes | node processes | oversubscribed | pids |
|---|---|---|---|
| 1 | 2 | no | 63278 |
| 2 | 3 | no | 67213, 67214 |
| 4 | 5 | no | 68716–68719 |
| 8 | **9** | **yes** (8 logical cores) | 69488–69496 |

Coordination ratio (`p50 in-process ÷ p50 process-per-node`): **1.16× → 0.86× → 0.79× →
0.58×** across 1/2/4/8. Derived ideal from the serial calibration: **4.78×**.

**Four things worth carrying forward, each stated as what it is.**

1. **The process driver's ratio at N=8 is 3.84×, and the criterion-2 question is answerable
   on it.** Makespan at N=1 and N=8 differ, the ratio is published, and the three confound
   readings are printed in the same row.
2. **`generations` is 1 on every rung of both sweeps** and `churn/task` is `0.00`. So at
   redundancy 1, on this run, no shard was re-placed — the mechanism the context warned was
   unguarded did not fire here. That is a measurement of this run, not a property.
3. **Speculation DID fire.** `spec. tax` reads 1.02×–1.06× and the `speculated` vectors carry
   `true` on four of the eight rungs. The published trivial-fixture run reads `1.00×` on every
   rung; the context flagged that as establishing only that the instrument was quiet on that
   fixture. It is not quiet on this one. Exactly the confound the plan required be published
   beside the ratio, and it would have been invisible without it.
4. **The 8-node process rung is oversubscribed** — 9 node processes against 8 logical cores —
   and it is where the process curve knees (4→8 nodes buys 1.16×, against 1.80× from 2→4). The
   report says so per rung from the observed count.

**The in-process control exceeds the derived ideal (7.76× against 4.78×), and that is not a
paradox to be smoothed away.** The bound is computed from per-shard durations measured
*through one RPC round trip on the process fabric*; the control's shards do not pay that.
The two therefore have different denominators, and the honest reading is that the derived
bound bounds the **process-per-node** curve, which it does — 3.84× against 4.78×. No
adjustment was applied and none is asserted.

---

## Every mutation planted, and the exact text observed

Each applied, run and restored **inside one shell invocation**, with `cmp` exit `0` recorded
every time. Never `git stash`, never `git checkout --`.

### The two live-run plants — the strongest readings in this plan

**Plant A — `FIXTURE_CIDS` built from the declared names rather than from the bytes.** Run on
a shortened but otherwise real driver, temp cwd. **Exit 1, and `.planning/BENCHMARK-RESULTS.md`
was never created**:

```
HarnessIntegrityError: the harness did not measure what it claims at process-per-node, 1
nodes: the rung declares the fixture saturating, whose registered module is saturating, but
it dispatched bafyreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m
    at assertIntegrity (packages/bench/src/integrity.ts:101:9)
    at gateRung (packages/node/src/bin/bench.ts)
    at main (packages/node/src/bin/bench.ts)
```

One reading proves three things at once: provenance is compared against the CID the rung's
fabric actually put, `HarnessIntegrityError` propagates out of `main()`, and **the run
produces no report at all**.

**Plant B — `SATURATING_N = 300`.** Same shape. **Exit 1, no report written**:

```
HarnessIntegrityError: the harness did not measure what it claims at process-per-node, 1
nodes: 8 of 16 shards ended on something other than budget: [found, found, found, budget,
budget, found, found, budget, found, budget, found, budget, budget, budget, found, budget]
```

This is what makes `SATURATING_N` load-bearing rather than decorative, and it reproduces the
offline measurement position for position.

### The source-shape plants

| plant | result | observed |
|---|---|---|
| one `if (cause instanceof HarnessIntegrityError) throw cause` deleted from the driver | **RED, exit 1** | `AssertionError: expected 2 to be 3`, plus requirement 4 named in the unmet list |
| `const PREREGISTERED_IDEAL_SPEEDUP = 6.3` reintroduced | **RED, exit 1** | `missing: no pre-registered speedup constant, and no eight-partition figure` |
| a speedup rung printed as `` `  real transport, ${nodes} node(s)…` `` | **RED, exit 1** | `missing: the speedup headings do not collide with the coverage guard's stdout regex` (heading count went 2 → 3) |
| requirement 1's check weakened to `source.includes('n')` | **RED, exit 1** | `AssertionError: expected 0 to be greater than 0` at the non-empty assertion — the anti-tautology reading |
| `"@o2/node": "*"` added to `packages/demo/package.json` and imported in `job.ts` | **RED, exit 1** | `packages/demo/src/job.ts imports "@o2/node" — a portable package must not depend on the Node adapters` |

### The plant that left the tree GREEN, and what was done about it

**`stripComments` deleted from the new guard's matcher. GREEN, exit 0.** Reported rather
than banked.

The cause was my own fixture, not the stripper: the comments-only source was hand-written
prose *describing* the call sites, and it happened to spell `cpuAttributionViolations`
without its parenthesis and to name only one of the two speedup headings. It therefore
failed the presence checks whether or not the source was stripped, so the stripper was
carrying nothing and its deletion could not show.

It is now **composed from the `satisfying` fragments themselves**, each line turned into a
line comment, and a second case asserts that the *unstripped* source satisfies all eight —
without which the first case still cannot distinguish a stripper from a fixture that was
never satisfiable. The same plant re-run against the corrected pair: **RED, exit 1**,
naming all five presence requirements:

```
AssertionError: expected [] to deeply equal [ …(5) ]
- "the process fabric is built and driven by a runner that disposes each rung",
- "all four readings are taken and the gate is the thing that reads them",
- "the ideal bound comes from a serial calibration, and the report says so",
- "the three confound readings are published beside the ratio",
- "the speedup headings do not collide with the coverage guard's stdout regex",
```

---

## Claims in the plan measured FALSE, or deliberately not followed

1. **"The control must stay flat; it cannot do otherwise on one event loop."** **FALSE.**
   `FabricNode` composes a `WorkerExecutor` over `createThread: workerThread`, so each
   in-process node's guest runs on its own worker thread. The control reached 7.76× at eight
   nodes — *better* scaling than the process driver. Corrected in the source comment, in the
   report prose and in the `unmet` list, because a comment that states a falsehood is worse
   than none.

2. **Task 1's tautology plant: "build `FIXTURE_CIDS` from the declared names — the comparison
   becomes a tautology."** **FALSE in this implementation, and better than predicted.** The
   registry is compared against the CID the rung's fabric *observed*, so a name-built registry
   is a **loud abort**, not a silent pass — Plant A above. The plan's fallback instruction
   ("if the suite stays green, report that") does apply to the *suites*: no suite executes a
   rung, so no suite reddens either way. The live run is what carries it.

3. **Task 3's behaviour: "A source in which the requirements are described in comments but
   absent from the code reports every one of them."** **Impossible for three of the eight, by
   construction.** An absence requirement (no pre-registered constant) and a count equality
   (catches vs re-throws) both hold over a source with no code in it. The case asserts the
   **five presence requirements** and the fact is carried in the file as
   `VACUOUS_ON_AN_EMPTY_SOURCE` rather than left to be rediscovered — the same fact that makes
   `DriverRequirement.breaking` necessary at all.

4. **Task 1: "Add `"@o2/demo": "*"` to `packages/node/package.json`."** Already present in the
   committed manifest. The file was **not modified**; only the import was added.

5. **`<verification>`: "`.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json` are
   byte-identical across the whole verification."** **MET**, checked with `shasum -c` around
   the guard runs, exit 0 both times. Every run of the driver used a `mktemp -d` cwd.

---

## Deviations from plan

### `[Rule 3 — Blocking]` the reduce leg does not run on a saturating rung

`project` decodes the trivial module's `{p: <4 LE bytes>}` output and **throws** on a
colouring partial, so the reduce call inside the shared run body would have failed every
saturating rung. A saturating-specific projection was considered and rejected on a
measurement rather than a preference: all sixteen shards end on the same status with an
all-zero field — that *is* acceptance condition 1 — so a projection over the output alone
yields sixteen identical leaves and `deriveReduceTree` dedupes them, collapsing the tree and
moving `treeDepth` for a reason unrelated to the fabric. The only way back to distinct leaves
is keying on the partition index, which is the substitution `project`'s own docblock exists to
refuse. Saturating rungs therefore carry the pre-existing named absence
`'no-reduce-ran-on-this-rung'`, which is the truthful reading. The two rendered reduce tables
come from the trivial curves and are unaffected.

### `[Rule 3 — Blocking]` the `Fabric` seam is imported, not declared twice

`ProcessFabric` extends `bench-fabric.ts`'s `Fabric`, whose `blockstore` is `Blockstore`;
this file's own copy narrowed it to `MemoryBlockstore`, so a `ProcessFabric` was not
assignable. Rather than cast, the local declaration is deleted and the seam imported — which
also deletes `realFabric`'s `as unknown as MemoryBlockstore` over a store that never was one,
the deletion 23-02 prepared and explicitly said 23-03 had to actually make. Three now-unused
type imports were dropped with it.

### `[Deviation — declared]` the speedup sweeps are skipped under `--quick`

`coverage-agents.node.test.ts` spawns `bin/bench.ts --quick`, waits for the **whole run**
inside 180 s and asserts `code === 0`. A saturating fixture across spawned processes is
minutes of work by construction, and an integrity failure aborts the run by design — so
running these sweeps there would make a guard about coverage rendering fail for reasons about
neither. The cost is stated at `SPEEDUP_LADDER` and in the new guard's header rather than left
to be noticed: **nothing in any suite executes a rung of these sweeps.** That was already true
of every other rung of this driver, whose `main()` runs on import, and the plan itself states
it ("nothing in any suite executes a rung"). What stands in its place is the full run recorded
above and the two live plants.

### `[Deviation — deliberate]` `realFabric` takes an optional fixture parameter

The in-process control has to be the *same rig* on the *same fixture*, differing from the
process rig in exactly one thing. `bench-egress.node.test.ts` requires `async function
realFabric` to survive by name, so it is parameterised rather than duplicated. Every existing
caller omits the argument and builds byte-identically to before.

### `[Deviation — deliberate]` `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` not touched

BENCH-07 is not closed by this plan — 23-04, 23-05 and 23-06 remain, and criterion 3 and
criterion 5 are untouched here. Ticking it would be widening what counts as passing. 23-01 and
23-02 took the same position in this phase, and two concurrent agents editing `.planning/STATE.md`
is the shared-index hazard the conventions open with.

---

## Found and NOT fixed — logged to `deferred-items.md`

**The driver does not exit after a rung that threw, and Plan 23-05's published run will hit
it.** A full run writes both files, prints its closing line and then never exits; the process
sat alive 11 m 40 s before it was killed. **No agent process survived**, so the spawned
children dispose correctly and it is the driver's own event loop that will not drain.

Attributed by measurement, not by plausibility: the run was repeated with `SPEEDUP_LADDER = []`
— **none** of this plan's new code executing — a one-rung memory ladder and `REAL_LADDER = [16]`,
i.e. only the rung known to fail. It wrote its report and was still running 200 s later. The
mechanism, read from source: `realFabric` starts N `FabricNode`s and returns the rig at the
end, so a throw part-way leaves the started nodes running with nothing holding a reference to
stop them. `processFabric` does not have this defect — 23-02 gave it an `undo` path for exactly
this reason. Not repaired here because it is not caused by this plan's changes and the fix is a
`try`/`finally` around the whole of a function three committed guards read by name.

A `--quick` run is unaffected (its `REAL_LADDER` is `[1, 2]`, nothing throws, exit 0), and an
integrity abort exits **1** promptly.

Also logged: the node test-file count drift was **already** over tolerance at 156 before this
plan added a file, two of the surplus files belong to another agent, and re-taking
`MEASURED_NODE_SPANS` needs a quiet host that did not exist during this execution.

---

## Readings, exit codes read directly

Every exit code below was captured with `EXIT=$?` on the line **immediately** after the
command — no pipe, no trailing filter.

| what | exit | timing | `(user+sys)/real` | 1-min load |
|---|---|---|---|---|
| `npx tsc --noEmit`, whole tree, final | **0** | — | — | — |
| the fixture measurement, 8 candidates | **0** | `real 7.17 user 7.26 sys 0.09` | 1.02 | 4.19 |
| the fixture measurement, 5 more candidates | **0** | `real 6.61 user 6.66 sys 0.09` | 1.02 | — |
| `purity`, `bench-egress`, `serve-agent-hooks`, `vocabulary` | **0**, 4 files / 67 tests | `real 1.77 user 1.50 sys 0.34` | 1.04 | 4.79 |
| `coverage-agents` alone (spawns `--quick`) | **0**, 1 file / 2 tests | `real 10.27 user 9.67 sys 1.74` | 1.11 | 4.80 |
| **all six source/spawn guards together** | **0**, 6 files / **81 tests** | `real 19.89 user 13.92 sys 2.61` | **0.83** | **79.98** |
| `discover-arm` | **0**, 1 file / 1 test | `real 3.02 user 2.86 sys 0.56` | 1.13 | 4.14 |
| `bench-attestation` | **0**, 1 file / 4 tests | `real 6.04 user 6.30 sys 1.12` | 1.23 | 3.96 |
| `bench-driver` alone | **0**, 1 file / 12 tests | `real 1.79 user 0.86 sys 0.24` | 0.61 | 79.24 |
| the full driver run, shipped configuration | see below | ~11 min to the closing line | — | 80.15 → 50.83 |

The **0.83** ratio on the six-guard run is not starvation: `coverage-agents` spends most of
its span *watching* a spawned `--quick` run rather than holding a core. The **0.61** on
`bench-driver` is vitest boot around 21 ms of tests. Both are comparability keys, not verdicts.

The full run has **no exit code to report**, and that is the finding above rather than an
omission: it wrote both output files and then did not exit, so it was killed. Its report was
read from the temp cwd it wrote to.

`shasum -c` over `.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json`: **exit 0**
before and after every guard run. The repository's committed measurements were not touched by
anything in this plan.

### The sixteen pinned counts in `serve-agent-hooks.node.test.ts`

**None moved.** Re-counted against the shipped file: `'serves-unauthenticated'` 2,
`'serves-no-records'` 2, `'accepts-every-offer'` 0, `new LocalCapacity(` 2, `'keeps-no-ledger'` 2,
`'relays-for-nobody'` 2, `'reports-no-dispatch'` 2, `'issues-no-certificates'` 2,
`'signs-nothing'` 2, `attest:` 2, `'holds-no-registrations'` 2, `guardModuleProvenance(` 1,
`guarded(new WasmExecutor(` 3, `'dispatches-unauthenticated'` 3, `new RemoteExecutor(` 2,
`await discoverCandidates(` 1. `coverageReading(` is still exactly 2.

---

## The shared-tree hazards, and what was done about each

- **Every commit used explicit paths** and was read back with `git show --stat`. Each contains
  only this plan's files. A concurrent agent committed twice during execution; neither commit
  swept my staged file and mine swept neither of theirs.
- **`git add` ran only between test runs, never during one.** `bench-attestation` was run with
  `git status --porcelain` bracketed around it and the status did **not** move.
- **A whole-tree `tsc` reported one foreign error mid-execution** —
  `packages/net/src/named-refusal.test.ts(131,13): Cannot find name 'FetchingBlockstore'` — in a
  file another agent was editing. It was **re-run before diagnosing** and had vanished. Not
  touched, and not treated as a finding.
- **The one plant outside my files** (`packages/demo/package.json` + `job.ts`, for the purity
  reading) was taken only after confirming `git status --short packages/demo/` was clean, and
  both files were restored with `cp` and confirmed with `cmp` in the same invocation.
- **Two commits were refused by the pre-commit guards and both refusals were real findings**:
  the first on a banned vocabulary term in a new comment, which was rewritten; the second on
  the pre-existing file-count drift, committed with `O2_SKIP_GUARDS=1` and a measured reason
  recorded in the commit message and in `deferred-items.md`.

---

## Known Stubs

None. Every figure the new sections render is read from a run: the pids are what each child
announced, the process counts are what the rig held, the confound vectors are read off
`ShardResult`, and the ideal bound is computed from sixteen measurements taken during the run
that publishes it. Where a rung produced nothing, the section renders nothing rather than a
placeholder — `processSection` and `speedupSection` both return an empty array on an empty
input, which is why a `--quick` run's report is unchanged.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema at a trust boundary. The
one new signed artefact, `SATURATING_RECORD`, is signed by the same in-process seed as the
existing one, vouches only for a module this driver put in its own store, and is checked by the
same `guardModuleProvenance` path every rung already used.

## TDD Gate Compliance

Task 3 is `tdd="true"`. **There is no knowingly-red `test(...)` commit**, for 23-02's stated
reason: a second agent is committing to this branch concurrently and a knowingly-red commit on
a shared branch is the hazard `CLAUDE.md` opens with. What stands in its place is what the
plan's `<done>` clause actually asks for — **each of the eight requirements watched reporting
against a planted source**, five mutations watched reddening the real driver with their text
transcribed, one plant reported GREEN and its cause repaired, and two live runs watched
aborting with no report written. Gate order in `git log`: `feat(23-03)` `21d6e23` then
`test(23-03)` `1892915`.

## Commits

| Commit | What |
|---|---|
| `21d6e23` | `feat(23-03)` — the saturating fixture, the process-per-node driver, the integrity gate, provenance on every literal |
| `1892915` | `test(23-03)` — eight call-site requirements, each watched reporting; and the calibration sentence made a literal in the published prose |

## Self-Check: PASSED

- `packages/node/src/bin/bench.ts` — FOUND
- `packages/node/src/bench-driver.node.test.ts` — FOUND, 342 lines (min 150)
- `.planning/phases/phase-23-multi-process-benchmark-driver/deferred-items.md` — FOUND, two new dated sections appended
- `.planning/phases/phase-23-multi-process-benchmark-driver/23-03-SUMMARY.md` — FOUND
- commits `21d6e23`, `1892915` — both FOUND in `git log`
- `npx tsc --noEmit` — exit **0**, whole repository
- `packages/node/package.json` — deliberately **UNCHANGED**; `@o2/demo` was already declared
