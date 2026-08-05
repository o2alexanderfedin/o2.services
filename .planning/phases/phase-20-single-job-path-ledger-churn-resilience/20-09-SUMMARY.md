---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 09
subsystem: benchmark-driver, speculation, cost-accounting
tags: [CHURN-02, CHURN-06, BENCH-03, speculation, straggler, sovereignty, SIGSTOP]
requires:
  - "packages/core/src/job/submit.ts — JobResult.speculationMultiplier / speculationSpent / redispatches, SubmitOptions.speculation, ShardResult.speculated / copies (20-07 and 20-01, UNCHANGED here)"
  - "packages/core/src/speculation.ts — speculativeCandidates, median, DEFAULT_STRAGGLER_FACTOR, DEFAULT_SPECULATION_FRACTION, MIN_SAMPLES (pre-existing, UNCHANGED)"
  - "packages/net/src/submit-with-egress.ts — measured, not assumed, to pass the job through by reference (UNCHANGED)"
  - "packages/node/src/capability-fixture.ts — OWNER_ID / OWNER_KEY / chainSupplierFor (pre-existing, UNCHANGED)"
  - "packages/node/src/strip-comments.ts — the shared tokenizer the column guard scans with (pre-existing, UNCHANGED)"
provides:
  - "criterion 3 measured on a live fabric of seven bin/agent.ts processes — a straggler duplicated mid-run, the loser still read"
  - "CHURN-06 in BOTH directions on real processes: a two-node owner's duplicate lands on its own spare; a one-node owner gets none"
  - "Observation.speculationMultiplier and Observation.redispatches read from the job at bin/bench.ts and perf-workload.ts"
  - "a BENCH-03 call-site guard over both measurement sites, falsifiable by planting"
affects:
  - "20-10 / 20-13 — the two published columns are live; a re-run of the driver will now print measured figures, and the artifact prose already says what a 1.00/0.00 does and does not mean"
  - "any plan re-running bin/bench.ts — .planning/BENCHMARK-RESULTS.md's figures were NOT re-measured here; only two sentences changed"
tech-stack:
  added: []
  patterns:
    - "slowness with no duration in it: SIGSTOP for the freeze, and an EVENT (a duplicate answering) for the thaw"
    - "two independent instruments for one number — a wrapper around the production dispatch, and the job's own fields, asserted equal"
    - "a confound removed by construction (an allowance that cannot be exhausted) and stated, rather than argued away"
    - "a guard placed in the plan's own file when the natural home belongs to another plan, with the displacement written down"
key-files:
  created:
    - packages/node/src/speculation-agents.node.test.ts
  modified:
    - packages/node/src/bin/bench.ts
    - packages/bench/src/perf-workload.ts
    - .planning/BENCHMARK-RESULTS.md
    - packages/node/src/acceptance-traceability.node.test.ts
decisions:
  - "the on/off arms run over ONE spawned fabric with one job spec — only `executors` and the speculation dial differ"
  - "SPECULATION_FRACTION is overridden to 1 in the fixture, so the budget can never explain a `speculated: false`; the cost is that budget exhaustion is not exercised here and is said so"
  - "which copy WINS the race is deliberately not asserted — both compute the same pure function, and the thaw fires job-wide"
  - "the guest is MODULE_WRITES_PARTITION, because MODULE_ECHOES_INPUT makes a sovereign result byte-identical to its input and the owner's own egress guard refuses it"
  - "the BENCH-03 guard lives in this plan's file rather than in bench-reduce.node.test.ts, which this plan does not own"
metrics:
  duration: ~2h
  completed: 2026-08-04
---

# Phase 20 Plan 09: The speculation tax stops being a constant Summary

Two published benchmark columns were literals that read nothing from the job that had
just run. They are reads now. And criterion 3 has a live reading: on a fabric of seven
`bin/agent.ts` processes, three of them frozen by one signal at one instant, a straggler
is duplicated onto a node the placement did not choose, the losing copy is still compared,
and a sovereign shard whose owner has one node is left alone while a sovereign shard whose
owner has two gets its duplicate on that owner's own spare.

**There is no delay constant anywhere in the new file.** The freeze is SIGSTOP — slow by
not running — and the thaw is an *event*, the instant a duplicate answers. Nothing in the
arrangement encodes this host's speed.

---

## What landed

### `packages/node/src/bin/bench.ts` and `packages/bench/src/perf-workload.ts`

```
speculationMultiplier: result.ok ? result.job.speculationMultiplier : 0,
redispatches:          result.ok ? result.job.redispatches : 0,
```

replacing `1` and `0`. The `: 0` arm follows `verificationMultiplier`'s: a refused
submission ran no job, and `SpeculationLedger.multiplier` itself reports `0` for a job of
zero tasks, so the two agree.

The comments that explained the literals are replaced by ones that say what the numbers
now are and since when, and — the care the originals took, pointed the other way — that
**a run in which nothing straggled still prints `1.00`, and that is now a measurement
rather than the identity**, with `JobResult.speculationSpent` named as what separates them.

The driver's `unmet` entry that said the site *"sets both by hand and reads neither from
the job"* is replaced, and so is the reduce-table entry that cross-referenced it (it
claimed `tree depth` and `combines` carry *"the same status `spec. tax` and `churn/task`
carry above"* — they no longer do: those two are measured and happen to be constant on
this sweep, these two are decided by `deriveReduceTree` and could not come out otherwise).

### `packages/node/src/speculation-agents.node.test.ts` — new

Seven spawned agents plus an in-process requestor. Four public workers, two nodes for one
sovereign owner, one for another. 20 public shards + 2 sovereign. Redundancy 1, so every
extra entry in `attempted` is a duplicate and nothing else.

**The off arm first** — `speculation: 'duplicates-no-stragglers'`, nobody frozen. It is
three things at once: the correctness reference, the placement the victim is chosen from,
and the instrument check (`off.redispatches === 0`, every shard `agreed` in one
generation, `speculationMultiplier` exactly 1 **with** `speculationSpent: 0` beside it —
because a multiplier of 1 alone is also what an idle job reports).

**Then the on arm**, over the identical fabric and job spec, with three processes
SIGSTOPped from a wrapper around the production `RemoteExecutor` at the first `execute`
call — after placement, before any frame is sent. The thaw fires when any duplicate's own
`execute` resolves.

### `.planning/BENCHMARK-RESULTS.md` — two sentences, no figures

Committed separately and loudly (`5d51215`). See *"Did any published figure change"* below.

---

## Every mutation planted, and the exact text observed

Restored by `cp` + `cmp` after each; `cmp` exit `0` recorded every time. Never
`git checkout --`.

### Plant A — duplication happened on this fabric

The on arm switched to `'duplicates-no-stragglers'`, i.e. the mechanism turned off against
the identical freeze.

**RED. Exit 1.** Observed:

```
AssertionError: no duplicate was dispatched. completed-before-judgement 21 against
MIN_SAMPLES 3; budget spent 0 of 22; eligible untried nodes existed (public →
12D3KooWK9ZCe…, paired → 12D3KooWKuAiw…); the frozen public dispatch ran 10001ms
against a threshold of 35ms
…
#21 no-untried-node [12D3KooWFppB2…] insufficient: every executor failed | …: dispatch
to 12D3KooWFppB2… failed: rpc to 12D3KooWFppB2… timed out after 10000ms:
expected 0 to be greater than or equal to 2
```

and the printed reading: `spent 0; multiplier 1.0000 against the off arm's 1.0000;
redispatches 11 against 0`.

**This plant found an assertion in the wrong place on its first run and the file was
changed before the number above was taken.** On the first attempt it reddened at
`expect(thawedAt).not.toBeNull()` — a fact about this file's own staging, not about
duplication, because nothing resumes a frozen process when nothing duplicates. The thaw
assertion now sits *after* the duplication reading, with the reason written beside both.
This is the shape 20-07 warned about, arriving as predicted.

### Plant B — the answer did not change, and a disagreement is reachable

Every duplicate dispatched with `partitionIndex + 1`. (The plan asked for *"a different
module"*; over `MODULE_WRITES_PARTITION` a different **index** is what changes the output,
and a different *input* would not — the substitution is recorded in the file's header.)

**RED. Exit 1.** Observed:

```
AssertionError: expected [ …(22) ] to deeply equal [ …(22) ]
-   "bafyreieyhi24rcvbcsxmtsudvjg5r5jh2ew5ehe3l45uqdvydmos3xf4ue"
-   "bafyreidetx45yzbfzamxht2fa7lp22xr3zqpfuic3gr6pcxbmwph5koq4a"
+   "bafyreidvmhjzqhcwwcfxpveyatrlm357oyzoux3c5ub5d3ugqjjoalm7rm"
+   "bafyreiflran4s5jiqzuew2srzsdt7ywt262hbkfn7jujelmmbdw245pen4"
```

and the printed reading: `losing copies [disagreed,disagreed,disagreed,disagreed,
disagreed,disagreed,disagreed,disagreed,disagreed]`.

**The plan asked for this to be said plainly if the copies had reported agreement instead
— they did not.** The losers are compared on the live path, across processes, and
`disagreed` is reachable there. That is 20-07's post-settle comparison confirmed outside
its own kernel fixture.

### Plant C — the instrument check is not decoration

`RPC_TIMEOUT_MS` cut from 10 000 to 400.

**RED. Exit 1.** Observed:

```
AssertionError: expected 9 to be +0
 ❯ packages/node/src/speculation-agents.node.test.ts:791:30
    791|     expect(off.redispatches).toBe(0)
```

The **off arm** went lossy — nine re-dispatches on a fabric nobody froze — and the check
that exists to stop an already-lossy fabric making everything after it unattributable is
what caught it.

### Plant D — the two columns, and the load-bearing finding

Both reads in `bin/bench.ts` reverted to the literals.

- `bench-reduce.node.test.ts`, `bench-egress.node.test.ts`, `harness.test.ts`,
  `serve-agent-hooks.node.test.ts` — **exit 0, `Test Files 4 passed (4)`,
  `Tests 66 passed (66)`.** Nothing in the tree noticed.
- The new guard — **RED, exit 1**:

```
AssertionError: expected [ …(2) ] to deeply equal []
+ "packages/node/src/bin/bench.ts — missing: the speculation multiplier is read from the
   job. Why it matters: CHURN-02’s cost accounting is published as the `spec. tax` column…"
+ "packages/node/src/bin/bench.ts — missing: the re-dispatch count is read from the job.
   Why it matters: CHURN-01’s figure, published as `churn/task`…"
```

The same measurement was also taken **before** the reads landed, as the RED gate for the
guard itself: same failure, same two entries, exit 1; and after the reads landed, exit 0.

### Plant E — the egress wrapper preserves the fields, measured rather than assumed

`submit-with-egress.ts`'s `job: result.job` replaced by a **rebuild** that drops
`speculationMultiplier` — *"a wrapper that rebuilds a result would drop the new fields
silently"*, planted at the level where it can actually happen. `tsc --noEmit` exit **0**
under the plant, which is half the finding.

`bin/bench.ts --quick` into a temp cwd, **exit 0**, `real 5.10  user 4.23  sys 0.73`:

| | clean | under plant E |
|---|---|---|
| `spec. tax`, every rung, both transports | `1.00×` | **`—`** |
| `churn/task`, every rung | `0.00` | `0.00` |

`report.ts`'s `ratio` renders a non-finite number as an em dash, so a dropped field turns
the column into "unmeasured". **The driver still exits 0 and no test in the tree fails.**
So the wrapper's pass-through is guarded by the published artifact and by nothing else —
recorded rather than closed, since `submit-with-egress.ts` is not this plan's file.

Restored, `cmp` exit `0`. The clean CLI reading was retaken after restore: **exit 0**,
`real 4.69  user 4.00  sys 0.69`, `(user+sys)/real` = **1.00**, `spec. tax 1.00×` and
`churn/task 0.00` on all five rungs.

---

## Assertions found that could not fail, and one that is structurally unfalsifiable

- **The thaw precondition, in its first position.** Reported under Plant A and *moved*
  rather than recorded as a green.
- **The "straggler, not a refusal" block — no plant reddens it while everything above
  stays green, and this is structural.** Any mutation that turns the freeze into a refusal
  removes the silence, and a dispatch that answers is not a straggler, so the duplication
  assertions redden first and this block is never reached. Written into the file beside the
  block, with the two watched observations that bear on it: Plant A's `redispatches 11
  against 0` (the same silence read as churn) and Plant C's `expected 9 to be +0` on the
  off arm.
- **The first draft of the column guard could not report an absence at all.** It named a
  requirement per (file, field) pair, and its own planting cases went red: the two files'
  call sites have the same *shape*, so a synthetic source built from the other three
  fragments still satisfied the omitted one. Two requirements checked against two sources
  is the fix, and the mistake is recorded in the file.

---

## Claims in the plan measured FALSE, or deliberately not followed

1. **`must_haves.truths`: *"The re-dispatch count reported to the benchmark is the job's
   own, instead of the literal 0"* — landed, but the plan's framing that this is what makes
   `churnTax` stop being an identity is **not what a run shows**. A `--quick` run of the
   corrected driver still prints `0.00` on every rung, because nothing in that sweep loses
   a node. The column is now a measurement *of zero* rather than a literal zero, and that
   distinction is invisible in the artifact — which is why the `unmet` entry states it.

2. **`<action>`: *"if a rung can be made to straggle from the CLI, read a multiplier above
   1 off that stdout"* — **no rung can, and that is reported as the limit the plan asked
   for.** Two independent reasons, both structural: the driver submits `SHARDS = 16` shards,
   so at the shipped fraction the allowance is `floor(16 × 0.1) = 1`; and the workload is
   uniform over an in-process or loopback fabric where nothing is slow enough to clear
   `1.5 ×` the median. Every rung of both transports printed `1.00×`. **The live reading is
   in Task 1's file, and the CLI leg establishes only that the column is wired.**

3. **`<interfaces>`: *"`bin/bench.ts` submits through `submitJobWithEgress` … whatever
   field `submitJob` now carries must survive that wrapper. Check that it does."* Checked
   two ways and **it does**: by reading (`job: result.job` is a reference pass-through, not
   a rebuild) and by Plant E, which shows what the artifact looks like when it is not.

4. **`<action>`: *"If `.planning/BENCHMARK-METHODOLOGY.md` needs a line, add it."*
   **Not edited, and the finding is that its citation was already wrong for this driver.**
   Its source column names `CoordinatorOutcome.speculationMultiplier` and
   `CoordinatorOutcome.redispatches` — `runResilient`'s type, which `bin/bench.ts` has
   never called. The column *definitions* — `(tasks + duplicates) / tasks` and
   `re-dispatches / tasks` — are unchanged by this plan, so BENCH-02's pre-registration is
   intact and no published column changed meaning. What is stale is a citation, and the
   file is outside this plan's declared list. **Surfaced for whoever owns it next.**

5. **The plan's fixture assumption — *"one frozen worker holding exactly one shard"* — is
   not obtainable on this fabric.** `placeWithOffers` takes the rendezvous top-2 and then
   the least loaded, and with equal loads the tie breaks on node id, so one worker takes
   roughly half the shards. Measured across runs: 5, 5, 7, 7, 8 of 20 on the busiest
   worker, and on one run **no worker held exactly one**. The fixture was rebuilt around
   owner-scoped pools instead, which is a hard partition rather than a preference.

---

## Two decisions worth arguing with

**`SPECULATION_FRACTION` is overridden to 1.** At the shipped 0.1 this job's allowance is
2, which is enough for the two duplicates the fixture *means* to start and not enough to
survive a third arriving because a worker paid a cold WASM compile. With the budget
exhausted, a `speculated: false` becomes ambiguous between CHURN-06 and "no budget left",
and 20-07 recorded that `ShardResult` carries no field distinguishing them. A fraction of 1
makes `ledger.remaining > 0` provable, and the test *reads* it (`spent < ALLOWANCE`)
rather than assuming it. **What it gives up:** budget exhaustion is not exercised here.
That is `submit.test.ts`'s *"spends no more than the job-wide budget"* case — arithmetic
over a counter, which is the last thing that needs seven OS processes.

**Which copy wins is not asserted.** The thaw is job-wide, so from the instant any
duplicate answers, every frozen primary is racing its own duplicate and either may arrive
first. What is asserted is that the race settled on an answer, that the answer equals the
off arm's, and that **both** copies are named — the winner in `verification.agreeing` and
the loser in `copies`. That is a more precise statement than "the duplicate won", and it is
`speculation.ts`'s own argument: two copies of a pure function over content-addressed input
are interchangeable.

---

## A finding the guest choice produced

`MODULE_ECHOES_INPUT` was the first choice, on `churn-agents.node.test.ts`'s reasoning.
**It is unusable in any job containing a sovereign shard.** Measured:

```
#20 no-untried-node [12D3KooWH9Tzf…] insufficient: every executor failed |
12D3KooWH9Tzf…: egress refused: bafyreibqswyxuijiotnyzyhvu7j5c4bqm5wjgsgi3ugkeyaen4ekcltw74
on 12D3KooWH9Tzf…
```

The owner's own process refused its own result, because an identity guest makes the output
byte-identical to the sovereign input, `takeSovereignHold` had registered exactly those
bytes for the duration of the task, and returning the result would have been returning the
owner's raw row. **DATA-10 refusing a genuine leak.** Recorded in the file's header rather
than worked around — the obvious workaround, exempting the owner's own answer, *is* the
leak. `MODULE_WRITES_PARTITION` emits the partition index and is used instead.

---

## The live reading, taken on a passing run

```
[criterion 3 / speculation] standUp 2787ms for 7 agents, off arm 681ms, on arm 1650ms;
allowance 22 over 22 shards (the shipped fraction would have allowed 2), spent 10;
multiplier 1.4545 against the off arm's 1.0000; redispatches 0 against 0; dispatches 32
against 22 shards; frozen worker held 7 public shard(s); median healthy dispatch 43ms over
21 samples, straggler threshold 64ms; frozen public shard 832ms, paired-owner shard 868ms,
solo-owner shard 809ms; compare grace 620ms; losing copies [agreed × 10]
```

Every reading is comparative or a count. The frozen dispatches sit ~13× above the straggler
threshold *of the same run*; the multiplier is a ratio against the off arm of the same
fixture; `spent` is asserted equal to the wrapper's own independent count of duplicate
dispatches.

**Stability**: five consecutive green runs, `spent` ∈ {8, 8, 9, 10, 10}, every losing copy
`agreed` on all five.

**The file's own cost**, `/usr/bin/time -p` on `--project node` restricted to it:
`real 13.04  user 10.12  sys 1.81` → `(user+sys)/real` = **0.92**, taken at 1-minute load
average **35.90**. A spawn-heavy spec waits rather than starves, so a ratio near one core is
what a healthy run looks like here; the figure is a comparability key, not a verdict.
**Not written into `vitest.config.ts`** — this plan's execution context forbids editing that
file: *"20-05 measured spans in wave 2; hand any new one to 20-13."*

**And that guard has now tripped — for 20-13, not for this plan to close.** See the
blocker below.

---

## Did any published figure change

**No.** `.planning/BENCHMARK-RESULTS.md` changed by three lines, all prose, in its own
commit (`5d51215`) whose message says so in capitals. The `1.00×` and `0.00` in the tables
are the 2026-08-01 run's bytes, unchanged; a `--quick` run of the corrected driver printed
the same pair on every rung, which is why the sentence could be corrected without
re-running the sweep, and the artifact now says that too.

**Pre-existing, deliberately not fixed:** the driver's `unmet` array holds **eleven**
entries and the published document **nine**. The two missing are the attestation paragraphs
added after the 2026-08-01 run. Publishing them means republishing the run, which is
exactly what this plan must not do as a side effect.

---

## Outside the declared file list, disclosed

- **`packages/node/src/acceptance-traceability.node.test.ts`** — one exemption deleted,
  seven lines. It waived BENCH-03's *"named in a test title"* rule; the new file names
  BENCH-03 in a title, and the guard reported it by name: *"BENCH-03 is now named in a
  title by packages/node/src/speculation-agents.node.test.ts — delete this exemption"*. The
  edit is the one the guard's own message asks for and is caused directly by this plan.
  Re-run in isolation: exit 0, 41 passed. Committed alone (`bd3c8e1`).
- **`packages/bench/src/perf-workload.ts`'s `serveAgent` sites** — **not touched.** Only
  the two `Observation` fields and their comment moved. `serve-agent-hooks.node.test.ts`'s
  count assertions over both files are green.

---

## Whole-tree runs, read directly

`npx tsc --noEmit` → **exit 0** (four times across the work; the last after every restore).

`npx vitest run --project node`, first pass → **exit 1**, `Test Files 3 failed | 146 passed
(149)`, `Tests 4 failed | 2139 passed | 2 skipped (2145)`, `real 773.18  user 325.99
sys 68.52`. **Each failure attributed by reading its diff, not by plausibility:**

| file | attribution | re-run in isolation |
|---|---|---|
| `acceptance-traceability.node.test.ts` | **mine** — the dead BENCH-03 exemption, above | exit 0, 41 passed |
| `bench-attestation.node.test.ts` | foreign — it snapshots `git status --porcelain` and its diff named exactly one moving file, `packages/core/src/job/submit.ts`, which is 20-08's and was staged mid-run. None of mine appeared. | exit 0, 4 passed |
| `late-combine.node.test.ts` | foreign — another agent's file, `M` in `git status` before this plan began and throughout | exit 0, 2 passed |

`npx vitest run --project node`, second pass (after the exemption fix) → **exit 1**,
`Test Files 5 failed | 144 passed (149)`, `real 1116.98  user 361.13  sys 100.09`,
`(user+sys)/real` = **0.41** — a run spending most of its time waiting, on a host under
concurrent agent load 44 % heavier in wall clock than the pass before it. Five files,
attributed:

| file | attribution |
|---|---|
| `slow-specs.node.test.ts` | **real, and handed to 20-13** — the file-count drift above. Not closable here by plan instruction. |
| `bench-attestation.node.test.ts` | **half mine, and my own doing**: it snapshots `git status --porcelain` and the moving entries were `?? .planning/…/20-09-SUMMARY.md` — this file, written while the run was in flight — and `?? packages/node/src/checkpoint-agents.node.test.ts`, 20-11's. **None of my three source files appeared in the diff.** The convention is *`git add` only between test runs*, and writing an untracked summary mid-run breaks it the same way staging does. Recorded rather than excused. |
| `late-combine.node.test.ts` | foreign — `expected 1500 to be greater than 2665.19`, its own load-sited RPC margin against a healthy combine that took 2.7 s on a contended host. Its file was another agent's and mid-edit throughout. Passed in isolation earlier in this session: exit 0, 2 passed. |
| `tools/aot/echo-guest.node.test.ts` | foreign — `Hook timed out in 900000ms` in a `beforeAll` that drives a container toolchain. Phase 21's. |
| `tools/aot/lift.node.test.ts` | foreign — same, `Hook timed out in 900000ms` at `lift.node.test.ts:2477`. Phase 21's, and the single slowest file in the project at a recorded 235 s. |

`npx vitest run --project node`, **third and final pass**, taken with this plan's own tree
fully committed → **exit 1** (read directly on the line after the command),
`Test Files 7 failed | 143 passed (150)`, `Tests 5 failed | 2133 passed | 18 skipped
(2156)`, `real 1116.86  user 379.95  sys 104.78`, `(user+sys)/real` = **0.43**. Seven
files, every one attributed by reading its message rather than by plausibility, and **every
one re-run**:

| file | attribution | re-run |
|---|---|---|
| `slow-specs.node.test.ts` | **real, and handed to 20-13** — the file-count drift below. Not closable here by plan instruction. | still red, correctly |
| `discover-arm.node.test.ts` | foreign — snapshots `git status --porcelain`, and its diff moved by exactly one character: `MM packages/core/src/job/submit.ts` → `M  packages/core/src/job/submit.ts`. Another agent staged 20-08's file mid-run. **None of mine appeared.** | exit 0 |
| `two-process.node.test.ts` | foreign — `result.job.complete` false on a 4-shard R=2 job. Four shards give an allowance of zero, so speculation never starts and this plan changed no production job code; `submit.ts` was `MM` and being edited throughout by 20-08. **Attributed by re-running, not by that argument.** | exit 0, 3 passed |
| `late-combine.node.test.ts` | foreign — `expected 1500 to be greater than 2301.82`, its own load-sited RPC margin against a healthy combine that took 2.3 s on a contended host. Another agent's file, `M` throughout. | exit 0 earlier in this session, 2 passed |
| `tools/aot/echo-guest.node.test.ts` | foreign — `Hook timed out in 900000ms` in a `beforeAll` driving a container toolchain. Phase 21's. | not re-run; not this phase's |
| `tools/aot/lift.node.test.ts` | foreign — same, at `lift.node.test.ts:2477`. Phase 21's, and the slowest file in the project at a recorded 235 s. | not re-run; not this phase's |
| `tools/aot/cli.node.test.ts` | foreign — `Test timed out in 5000ms` on its symlink case, against a recorded file span of 5 663 ms. A 5 s per-case budget on a host at load ~36. Phase 21's. | not re-run; not this phase's |

**Every file this plan wrote, changed, or is read by, run together with a settled index:**
`speculation-agents`, `discover-arm`, `bench-reduce`, `bench-egress`, `harness.test`,
`serve-agent-hooks`, `acceptance-traceability` → **exit 0**, `Test Files 7 passed (7)`,
`Tests 114 passed (114)`.

---

## BLOCKER handed to 20-13 — `slow-specs.node.test.ts`'s file-count drift has tripped

```
FAIL packages/node/src/slow-specs.node.test.ts > the recorded measurement still describes
this repository > has not drifted further from the measured file count than the tolerance
allows
+ "the node project holds 150 test files, the recorded measurement covered 144.
   Re-measure with `npx vitest run --project node --reporter=json --outputFile=…` and
   update MEASURED_NODE_SPANS and NODE_MEASUREMENT in vitest.config.ts."
```

**Drift 6 against `FILE_COUNT_TOLERANCE` 5.** This is the guard doing exactly what it was
built for — *"nothing here was discovered by anyone noticing, it was discovered by the
count"* — and it is **deliberately over-attributed** to the whole node test population, as
its own `SCOPE` docblock argues at length.

**One of the six files is this plan's.** The count was **147** before it, so five had
already landed since the 2026-08-04 measurement; `packages/node/src/checkpoint-agents.node.test.ts`
(20-11's, untracked at the time of the run) is a sixth that arrived while this plan was
executing.

**Not fixed here, and the reason is a plan instruction rather than a judgement:** this
plan's `<execution_context>` says *"Do not edit `vitest.config.ts`. 20-05 measured spans in
wave 2; hand any new one to 20-13."* Re-measuring means a ~15-minute `--reporter=json` run
on a quiet host and a rewrite of `MEASURED_NODE_SPANS` and `NODE_MEASUREMENT`, and a table
retaken on a contended host is the failure mode that file's own history documents five
times over. **20-13 owns it.** The span this plan can hand over, cross-checked against a
second instrument the way that file requires: `speculation-agents.node.test.ts` at
`real 13.04` solo under `/usr/bin/time -p`, i.e. **above the 1 000 ms cut and therefore an
exclusion**.

---

## Deferred / found, not closed here

- **`.planning/BENCHMARK-METHODOLOGY.md` cites `CoordinatorOutcome` for two columns the
  driver reads off `JobResult`.** A stale citation, not a changed definition. Outside this
  plan's list.
- **`submit-with-egress.ts`'s pass-through is guarded by the published artifact and nothing
  else.** Plant E compiles, runs, exits 0, and only the artifact shows it.
- **The `--quick` driver cannot produce a straggler.** Closing that would mean a skewed or
  larger workload on the published sweep, which changes what the curves measure.
- **`FILE_COUNT_TOLERANCE` has one file of headroom left** (148 against a recorded 144).

## Known Stubs

None. Every field this plan reads is written from a measured value on every path, and the
`: 0` arms are the truthful reading of a submission that ran no job.

## TDD Gate Compliance

The plan marks Task 1 `tdd="true"`. **There is a real RED gate for the guard half**: the
column requirements were written and watched failing against the literals before the reads
landed (exit 1, both entries named), then watched passing after (exit 0). There is **no
separate `test(...)` RED commit for the live fabric case**, and retrofitting one would be a
fiction. What stands in its place is what the plan asked for: five mutations planted, each
watched going red with its output pasted above, each restored by `cp` + `cmp` with exit `0`
recorded — plus one assertion reported as being in the wrong position and *moved* rather
than recorded as a green, and one structurally unfalsifiable block named as such in the
file itself.

## Commits

| Commit | What |
|---|---|
| `ca655fc` | `feat(20-09)` — both `Observation` sites read the job; the comments and the driver's `unmet` entries corrected |
| `417462a` | `test(20-09)` — `speculation-agents.node.test.ts`, the live fabric case and the BENCH-03 column guard |
| `5d51215` | `docs(20-09)` — two sentences in the published artifact, no figure moved |
| `bd3c8e1` | `chore(20-09)` — the dead BENCH-03 exemption its own guard asked to delete |
| `4c5c181` | `docs(20-09)` — this summary |

Committed with **explicit paths** (`git commit … -- <path>`) and verified with
`git show --stat`: only my own files landed in each. `O2_SKIP_GUARDS` was not used.

**Defect #39's fix works, confirmed on the summary commit.** `slow-specs`'s file-count
drift is a real finding against the working tree and against a file this commit does not
touch, and the hook printed:

```
⚠️  slow-specs/file-count-drift: 1 finding(s) outside this commit — reported, not blocking.
   commit scope: 1 path(s). These are real findings against the working tree; somebody
   else's commit is answerable for them, and this one is not held for it.
```

then `✅ cheap guards passed` and the commit landed. It reported and did not block, which is
what that fix promised.
