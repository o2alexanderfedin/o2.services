---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 10
subsystem: benchmark-driver, cli-display, result-attestation
tags: [VER-09, VER-10, criterion-3, display, spawned-cli, span-table]
requires:
  - "packages/core/src/job/submit.ts — the receipt on JobResult (19-06)"
  - "packages/core/src/quorum.ts — describeAttestation, attestationReceipt (pre-existing)"
  - "packages/node/src/fabric-node.ts — attestResults composed at the factory (19-15)"
  - "packages/net/src/discover-candidates.ts — the certificate on NodeDescriptor (19-01)"
provides:
  - "criterion 3's CLI half: owner-attested at one replica, independent at two operators, a named absence at neither — all off a spawned binary's stdout"
  - "ShardAttestation / ShardQuorum / NoVerifiedAttestation re-exported from @o2/core, which 19-11 needs"
  - "the discover arm's two stalls, measured and filed"
  - "a re-measured MEASURED_NODE_SPANS, and the reporter blind spot that nearly hid a 154 s file"
affects:
  - "19-11 (demo UI receipt) — the three types are exported now; read the display-drift note below"
  - "19-12 (mutation ledger) — three find/replace pairs recorded below"
tech-stack:
  added: []
  patterns:
    - "the printed label is read off JobResult, never recomputed from the rig"
    - "a reading carries the population it came from, so a stalled run is not read as an absent signature"
    - "a spawn in beforeAll is invisible to --reporter=json; put the wait inside the cases"
key-files:
  created:
    - packages/node/src/bench-attestation.node.test.ts
  modified:
    - packages/node/src/bin/bench.ts
    - packages/core/src/index.ts
    - packages/node/src/discover-arm.node.test.ts
    - vitest.config.ts
    - .planning/REQUIREMENTS.md
    - .planning/phases/phase-19-quorum-composition-owner-domain-attestation/deferred-items.md
decisions:
  - "the label is read off JobResult.attestation.description, so describeAttestation keeps its (true) claim of no production caller"
  - "the receipt is taken off each rung's FIRST COMPLETED run — makespan's own population — and the line says which"
  - "split into a sibling spec: the readings arrive at t+62 s and t+153 s against discover-arm's 4 s"
  - "a spawn whose real rungs completed no job is discarded and taken again; a spawn that completed and printed the wrong label is kept and fails"
  - "VER-09 and VER-10 deliberately NOT ticked — the demo UI half is 19-11"
metrics:
  duration: ~2h40m
  completed: 2026-08-03
---

# Phase 19 Plan 10: The label on the CLI Summary

The one CLI in this repository that runs jobs now says how strongly each rung's result was
attested, in the kernel's own words, and a spawned run of it was measured printing
**`owner-attested`** for its one-replica rung, **`independent`** for its two-operator rung,
and a **named absence** for every rung whose descriptors carry no certificate. All three
readings come off the child process's own stdout.

```
  memory transport, 1 node(s)…
    attestation (first completed run): none established (agreeing 1, verified 0) — no agreeing
      replica produced a signed statement this requestor could check — n0: this requestor holds
      no certificate for it
  real transport, 1 node(s)…
--discover: 1 of 1 workers qualified from 1 providers
    attestation (first completed run): owner-attested (replicas 1, operators 1) — owner-attested
      — computed once by the data owner and not independently verified
  real transport, 2 node(s)…
--discover: 2 of 2 workers qualified from 2 providers
    attestation (first completed run): independent (replicas 2, operators 2) — independently
      verified — replicas from separate operators agreed
```

(Wrapped here for width; each is one line.)

## The plan's premise was right, and the first measurement of it was not

**The plan predicted `owner-attested` at the 1-node real rung and `independent` at the
2-node one, and both are true — but the first implementation read neither.** Both printed
the named absence, and the reason is worth the whole section, because it is the shape of
defect this milestone exists to remove appearing inside the fix for it.

`jobAttestationOf` reports the **weakest** shard's receipt, and a shard that never agreed
carries `noAgreementToAttest`. So a job with one failed shard reports *"nothing was
established"* — truthfully, and about the wrong thing. The first version took the receipt
off the first run that returned a job, and measured on the `--discover` arm:

| rung | per-iteration makespan, in order (ms) | `complete` |
|---|---|---|
| real, 1 node | **30 044**, 106, 71, 55, 144, 134 | f, f, f, f, **t, t** |
| real, 2 nodes | **30 048**, 109, 258, 285, 263, 223 | f, f, f, **t, t, t** |

The first iteration of each real rung stalls **exactly `rpcTimeoutMs`** and comes back
incomplete; later iterations complete. A reading taken off iteration 1 says *"we cannot
say who ran this"* for a rig that names two operators on every subsequent run — and no
reader could tell that apart from a fabric whose nodes genuinely sign nothing. **That is
VER-10's own distinction failing inside the line built to display it.**

The fix is not a filter chosen for the answer it gives: the receipt is taken off the rung's
**first completed run**, which is exactly the population `@o2/bench`'s `measure` computes
`makespan` over — *"an incomplete run never enters makespan statistics"*, its own words —
and the `incomplete` column already publishes how many runs that population dropped. The
printed line carries the population, so `attestation (first completed run)` and
`attestation (no run of this rung completed; first job it returned)` are different
statements on the page.

Both stalls are **pre-existing** — nothing in this plan touches execution, placement,
dialling or the reduce leg, and the first was reproduced before the attestation line
existed. Filed as **deferred item 4**, with a second and larger one beside it: every
real-transport reduce on the `--discover` arm fails and is retried, which is why the
2-node rung takes 91–151 s of wall clock for ~31 s of measured jobs.

## What was built

### Task 1 — the driver says how strongly each rung was attested

**Commit:** `8cb4fb4`

One line per rung, written after that rung's runs, in the indentation the neighbouring
lines already use. It carries the strength, the replica count and the operator count, so a
reader can see *why* the label is what it is without reading the source.

- **The value is the job's.** Every field is read off `JobResult.attestation`. Nothing is
  derived from `config.redundancy`.
- **The sentence is the kernel's.** `attestation.description` is the field
  `attestationReceipt` filled from `describeAttestation`, copied rather than composed —
  which is also why `describeAttestation` still has **no production caller** and both
  ledger rows keep a claim that is still true.
- **A rung that established nothing prints `none established`**, with `agreeing` and
  `verified` (`0 of 2` and `1 of 2` are different situations with different remedies) and
  the kernel's own reason. Never a blank, never a dash, never the weakest label.
- `.planning/bench/raw.json` gains an `attestation` array carrying the same per-rung fact.
  Added to the report object rather than to `SweepResult`, which would have been a required
  field on a `@o2/bench` type outside this plan's declared files.
- **One `unmet` entry**, and it states something genuinely unmeasured rather than restating
  a measurement: a **default** run establishes no strength on any rung, because certificates
  reach a descriptor only through `--discover`, and a `--discover` run's numbers must not be
  published beside a default one. So the attestation of the configuration these published
  curves were taken under is unmeasured; that it was not *established* is measured.
- **The sweep did not move.** Same ladders, same iteration counts, same rungs, same
  redundancy. Asserted, not promised — see Task 2's fourth case.

`ShardAttestation`, `ShardQuorum` and `NoVerifiedAttestation` were re-exported from
`packages/core/src/index.ts`. 19-CONTEXT records the handoff and says whichever of 19-10 /
19-11 runs first adds them; **19-11 should expect them present.**

### Task 2 — three readings, off the spawned driver's own stdout

**Commits:** `0fbb8e4`, `7096c98`

`packages/node/src/bench-attestation.node.test.ts` runs
`bin/bench.ts --quick --discover` with `cwd` in a temp directory, reads the attestation
lines out of the child's stdout, and asserts four things:

1. **Every memory rung reads the named absence** — `verified 0`, no strength parse, and
   none of `describeAttestation`'s three sentences anywhere in the line. All three rungs,
   not one: the 2- and 4-node memory rungs run at redundancy 2, so a driver deriving the
   label from `config.redundancy` would print a *different* wrong answer at 1 node.
2. **The 1-node real rung reads `owner-attested`**, replicas 1, operators 1 — criterion 3's
   CLI half.
3. **The 2-node real rung reads `independent`**, replicas 2, operators 2, with the pair
   asserted together in that case, because either alone passes against a constant.
4. **The rung headings and their order are unchanged**, `.planning/bench` was written into
   the temp `cwd`, and `git status --porcelain` is identical across the run.

Every sentence is compared against `describeAttestation` rather than transcribed.

### Split, rather than folded into `discover-arm.node.test.ts`

That file's header forbids it becoming a benchmark, and it reads its line at t+1 s. A
rung's attestation line is printed **after that rung's runs**, so the readings arrive at
**t+62 s** and **t+153 s** (t+213 s on a second run of the same tree). Folding them in
would have replaced a 4 s spec with a 3-minute one. `discover-arm.node.test.ts` gained a
section saying where they went and why neither file's readings are available from the
other's stopping point.

## The plants, with find/replace pairs for Plan 19-12

All three in `packages/node/src/bin/bench.ts`, all run, each restored by `cp` + `cmp`
(exit 0 each time) and never by `git checkout --`. `git status --short` was empty of
`bench.ts` after each restore.

| # | find | replace | observed |
|---|---|---|---|
| P1 | the named-absence arm of `attestationReading` returning `none established (agreeing …` | the same arm returning `attestationReceipt([])`'s strength/description | **RED on the absence case alone**, the other three green: `memory/1 did not report an absence: owner-attested (replicas 0, operators 0) — owner-attested — computed once by the data owner and not independently verified` |
| P2 | `attestationReading`'s body | an unconditional constant `owner-attested (replicas 1, operators 1) — …` returned first | **RED on two cases**, and the `owner-attested` case **PASSED**: `expected 'owner-attested' to be 'independent'` |
| P3 | `{ nodes, shards: SHARDS, redundancy: Math.min(2, nodes), transport: 'real', …}` | `redundancy: 2` | **RED on the 1-node reading**, sweep-shape case green: `real/1 reported no strength: none established (agreeing 0, verified 0) — this shard is insufficient rather than agreed` |

**P1 is the most valuable and it is the one the plan named as such.** `attestationReceipt([])`
returns `owner-attested` for an empty set, so the planted memory rung reports a label that
is not obviously wrong to a reader — the failure that looks most like success. It reddened
exactly one case and left the two real readings untouched, which is the sharpest possible
demonstration that the absence is asserted on its own terms.

**P2 measured this file's own argument.** A single reading would have been satisfied by a
driver printing one constant; the `owner-attested` case passed under it, and only the pair
plus the absence caught it.

**P3 separates "the label followed the rig" from "the rig moved".** The 1-node rung at
redundancy 2 cannot place a second replica, so nothing agrees and the line becomes the
absence — while the heading sequence is unchanged and the sweep-shape case stays green.

A fourth plant was attempted and **rejected before running**: `if (held !== 'never')` as
the constant-return guard produced five `tsc` errors. `if (true as boolean)` is the form
that plants cleanly, and it is worth knowing for 19-12 — a plant that does not type-check
is a plant whose run proves less than it appears to.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — bug] The receipt was read off a run that had not completed**

- **Found during:** Task 1, on the first measured run of the driver.
- **Issue:** taking the first `ok` job's receipt gave both real rungs the named absence,
  because the first iteration of each stalls `rpcTimeoutMs` and comes back with a shard
  that never agreed. Criterion 3 would have scored PARTIAL for a reason unrelated to
  attestation.
- **Fix:** `RungAttestation` carries `fromCompletedRun`; a completed run replaces a partial
  one and never the reverse; the printed line names the population. Recorded after
  `const complete = result.ok && result.job.complete` so the population is literally
  `Observation.complete` and cannot drift from `makespan`'s.
- **Files:** `packages/node/src/bin/bench.ts`
- **Commit:** `8cb4fb4`

**2. [Rule 3 — blocking] Three types 19-10 and 19-11 need were not exported**

- **Issue:** `ShardAttestation`, `ShardQuorum`, `NoVerifiedAttestation` — 19-06 left them
  out deliberately and 19-CONTEXT records the handoff.
- **Fix:** re-exported from `packages/core/src/index.ts`, types only.
- **Commit:** `8cb4fb4`

**3. [Rule 3 — blocking] `MEASURED_NODE_SPANS` had to be re-measured in full**

- **Issue:** the new spec runs the driver for 163 s and must be excluded from `test:unit`.
  Pasting one entry from another run is the blend the table's docblock forbids.
- **Fix:** full re-measurement, 2026-08-03: 135 files / 1890 tests on a green run,
  sum-of-spans 693.9 s against 253.0 s wall clock, 34 files at or above the cut. Load
  polled every 40 s: 9.16 → **29.14** → 23.92 → 15.74 → 10.63 → 8.39 → 7.25. `test:unit`
  observed **directly** at 101 files / 1578 tests / 8.37 s on a green run at load 11.7.
- **The exclusion count FELL, 40 → 34, while the tree grew by one file.** Seven files
  crossed down on timing alone — `core/job/submit` 1771 → 532 ms, `sovereign-block-refusal`
  1651 → 579, `rendezvous-wire` 1466 → 613, `fs-blockstore` 1398 → 540, `net/churn`
  1114 → 962, and `core/discovery` and `identity-store` below 400 ms and out of the table
  entirely. Nothing about any of them changed. This is the closest pair in that table's
  history — same host, same load shape, one file added — and it still moved seven files.
- **Files:** `vitest.config.ts`
- **Commit:** `2387df4`

**4. [Rule 1 — bug] A 154 s file the span instrument could not see**

- **Found during:** the re-measurement above, against itself.
- **Issue:** with the spawn in `beforeAll`, `--reporter=json` attributed **235 ms** to
  `bench-attestation.node.test.ts` against a wall clock of **154 s**. The JSON reporter
  counts no hook time. The file would have been recorded as one of the *fastest* in the
  project, `test:unit` would have gone on running it, and the fast inner loop would have
  grown from 7 s to over two and a half minutes with nothing anywhere saying so — the exact
  drift `MEASURED_NODE_SPANS` exists to make impossible, arriving through a door it does not
  watch.
- **Fix:** the spawn moved behind a memoised promise awaited **inside each case**, where the
  reporter can see it. It now reads 163.0 s. Recorded in the table's docblock as a standing
  warning: *work done in `beforeAll`/`beforeEach` is invisible to the instrument this table
  is derived from.*
- **Files:** `packages/node/src/bench-attestation.node.test.ts`, `vitest.config.ts`
- **Commit:** `2387df4`

**5. [Rule 1 — bug] The new spec was contention-sensitive**

- **Found during:** the first full `--project node` verification run.
- **Issue:** the 1-node real rung completed **none** of its six iterations under full-suite
  contention and printed `none established (agreeing 0, verified 0) — this shard is
  insufficient rather than agreed`. That is the *correct* reading of a rung that established
  nothing, and it is deferred item 4's stall rather than anything about attestation. One
  full run in three.
- **Fix:** a spawn whose real rungs did not read off a completed run is discarded and taken
  again, at most once. **This retries an observation and never an assertion** — the
  discard condition looks at the *population* and never at the label, so a rung that
  completed a job and printed the wrong strength is kept and fails, which is the case the
  file exists for. Every attempt's readings are carried into the failure message.
- **Files:** `packages/node/src/bench-attestation.node.test.ts`
- **Commit:** `7096c98`

### Deliberate departures from the plan's letter

- **The plan's Task 2 named one file; this landed two.** The plan's own text authorises the
  split — *"keep the fast `--discover:` reading here and put the attestation readings in a
  sibling spawn spec with its own measured span"* — and the measured cost is why: 62 s and
  153 s against `discover-arm.node.test.ts`'s 4 s.
- **The plan asked for the reddening list in `discover-arm.node.test.ts` to gain Task 1's
  plant.** It did not, because Task 1's plants do not redden that file — nothing there reads
  an attestation line. Its header instead records where the readings went and why. Adding a
  plant that cannot fail a file is the defect this repository has recorded twice.
- **The `admit:` line was not touched, and it moved by one line.** Measured rather than
  assumed: it was at **`:739`** before this plan (not `:723` — it had already drifted 16
  lines under the reference in `discover-arm.node.test.ts`'s header, before this plan
  existed) and is at **`:740`** now. The single line is the `ShardAttestation` type import;
  everything else this plan adds to that file sits below `realFabric`. Defect #31 is
  unaffected and its finding stays where it is recorded, untouched — including the stale
  `:723` in that header, which is not this plan's to correct.
- **`describeAttestation` is deliberately NOT called.** The line reads
  `attestation.description`, which `attestationReceipt` filled from it. That is the recorded
  decision *"the label is read off `JobResult`, never derived"* taken one level further, and
  it has a second effect worth flagging to **19-11**: if the demo UI calls
  `describeAttestation` directly, `requirements-ledger.node.test.ts` will refuse the commit
  until VER-09's and VER-10's rows drop that claim. Rendering `receipt.description` avoids
  it and keeps the two surfaces on one source of the words.

## The observer rule, honoured

`discover-arm.node.test.ts` snapshots `git status --porcelain` around itself, and so does
the new spec. 19-08 recorded a red full-suite run caused by a `git add` in another shell
moving a path's porcelain code from ` M ` to `M  ` mid-run.

**Every `git add` in this plan was between runs, never during one**, and the index was
verified stable (`git status --short`) before each full-suite and each measurement run. The
guard never fired for that reason. Both files passed in every green run taken here,
including the two `--reporter=json` measurement runs.

## The known flake, observed — and this time the instrument printed

`packages/node/src/reservation-exhaustion.node.test.ts` (defect #33) **fired**, on the
second full node run of three. Nothing was adjusted, no timeout raised, no load gate
added. The armed diagnostic from `5997b30` produced the string seven clean runs had failed
to:

```
FAIL packages/node/src/reservation-exhaustion.node.test.ts > NET-05 criterion 4 —
  a full seed refuses a real joiner by name > grants the first joiner, refuses the second
  as at-capacity, and names an unreachable relay without dying

Error: timed out waiting for b to be refused by name; b's stderr was
"(node:56613) ExperimentalWarning: Type Stripping is an experimental feature and might
change at any time\n(Use `node --trace-warnings ...` to show where the warning was
created)\nagent.ts: no relay granted a reservation yet; still serving directly\n"

 ❯ until packages/node/src/reservation-exhaustion.node.test.ts:156:9
 ❯ packages/node/src/reservation-exhaustion.node.test.ts:228:5
```

**The whole of agent `b`'s stderr is those three lines.** It printed
`agent.ts: no relay granted a reservation yet; still serving directly` — and **not** the
at-capacity refusal the case waits for. So on the failing run `b` did not receive a *named*
refusal at all; its reservation attempt simply ended with nothing granted and the binary
fell through to its "serving directly" path. That distinguishes two hypotheses the previous
seven runs could not: this is **not** the refusal arriving late, it is the refusal not
arriving. The file ran 48 177 ms on that run. Recorded, not chased.

## Verification

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node` (final) | **exit 0** — 135 files, 1888 passed, 2 skipped, 241 s |
| `npx vitest run --project node` (previous) | exit 1 — **flake #33 only**, 134 passed, quoted in full above |
| `npx vitest run --project node --reporter=json` (the span measurement) | **exit 0** — 135 files, 1890 tests, 253 s wall |
| `npx vitest run --project browser` | **exit 0** — 240 files, 3756 passed, 39.9 s |
| `npm run test:unit` | **exit 0** — 101 files, 1577 passed, 1 skipped, 7.07 s |
| `npx vitest run --project node packages/node/src/bench-attestation.node.test.ts` | **exit 0** — 4 tests, 183.9 s |
| `npx vitest run --project node packages/node/src/bench-reduce.node.test.ts …` (Task 1 gate) | **exit 0** — 9 files, 174 tests |

Every exit code was read with `EXIT=$?` on the line immediately after the command, never
through a pipe and never after a trailing `tail`.

## Requirements deliberately NOT ticked

**VER-09 and VER-10 keep their `Built, not wired` verdict and their unchecked boxes.** The
display half has two sites and this plan closed one; the demo UI is 19-11. Ticking a box for
half a half would put a false checkbox in a ledger this repository guards, and *unmeasured is
not met* applies to a checkbox as much as to a mechanism — 19-15's and 19-08's precedent,
followed here. Both rows were **edited** to say what is now closed and what is not, and both
keep their checkable claim: `describeAttestation` still has no production caller, and
`requirements-ledger.node.test.ts` passes on that claim.

`.planning/STATE.md` and `.planning/ROADMAP.md` were **not** touched, per the executor brief.

## What this does not establish

- **The demo UI.** 19-11. Nothing here renders a receipt in a browser.
- **That a *default* run of the driver attests anything.** It does not, by construction, and
  the report's `unmet` list now says so. The published curves in
  `.planning/BENCHMARK-RESULTS.md` were not re-run and were not touched.
- **Why the `--discover` arm stalls, or why its reduce leg fails.** Deferred item 4. Both
  measured, neither diagnosed.
- **`owner-domain` on this surface.** No rung of this driver produces two nodes under one
  operator — every `--discover` worker enrols with a distinct `operatorId` — so the middle
  label is displayed by nothing here. `quorum-agents.node.test.ts` reads it off
  `ShardResult`; the CLI has no rung that would.
- **That the label survives a contended host without a retry.** It does not, one run in
  three, and the reason is the driver's and not the label's. Stated at the retry, in the
  test file's header, and in deferred item 4.

## Self-Check: PASSED

- `packages/node/src/bench-attestation.node.test.ts` — FOUND
- `.planning/phases/…/19-10-SUMMARY.md` — FOUND
- `8cb4fb4`, `0fbb8e4`, `2387df4`, `eda4068`, `7096c98` — FOUND in `git log`
- working tree clean after every plant restore (`cp` + `cmp` exit 0, `git status --short` free of `bench.ts`)
