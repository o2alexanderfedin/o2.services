---
phase: phase-16-decomposable-tree-reduce-wiring
verified: 2026-08-01T06:30:00Z
amended: 2026-08-19T04:10:00Z # SECOND amendment. Code for it is `3f11901` on branch feature/phase-20-checkpoint-agent. Both remaining `gaps:` entries CLOSE — one by BUILDING the guard that
                             # was missing, one by WITHDRAWING a claim an owner ruling had already rejected the repair for.
                             # See the last AMENDMENT in this file. The FIRST amendment (2026-08-06) moved criterion 3
                             # PARTIAL -> MET in the body and left this frontmatter untouched, which is why `score` below
                             # is corrected here to what that amendment already declared. No criterion verdict moves today.
status: passed # was `gaps_found`; every `gaps:` entry below is now closed and the score is unchanged at 4/4 criteria
score: >-
  4/4 criteria MET (0 PARTIAL, 0 FAILED). Criteria 1, 2 and 4 MET 2026-08-01; criterion 3 PARTIAL -> MET
  2026-08-06 after Phase 20 criterion 6 landed. **The count is over criteria and it did not move today** —
  the three `gaps:` entries are not criteria and never were. Closed 2026-08-06 (the arriving-late one) and
  2026-08-19 (the other two).
original_status: gaps_found
original_score: 3/4 criteria met (1 partial)
overrides_applied: 0
verifier_host_load: "3.84–10.16 on 8 cores across the session; every reading below is pass/fail, never a timing bound"
amendment_runs: # 2026-08-19. `EXIT=$?` on the line IMMEDIATELY after each command — no pipes, no trailing tail/echo
  - command: "npx tsc --noEmit"
    exit: 0
    result: "no output"
  - command: "npx tsc --noEmit  # PLANT A: `readonly ownerId?: string` added to CombineWork"
    exit: 1
    result: >-
      one error, at the new guard: capability-authorizer.test.ts(227,11) TS2741 Property 'ownerId' is missing
      in type '{ combineId: true; inputCids: true; level: true; }' but required in type 'EveryCombineKey'.
      Restored by surgical inverse; cmp exit 0
  - command: "npx vitest run --project node packages/net/src/capability-authorizer.test.ts  # PLANT A still in place"
    exit: 0
    result: "11 passed (11) — DISCLOSURE: the guard is a typecheck guard, not a vitest guard. A type is erased at runtime"
  - command: "npx vitest run --project node packages/net/src/capability-authorizer.test.ts"
    exit: 0
    result: "1 file, 11 passed (11)"
  - command: "/usr/bin/time -p npx vitest run --project node packages/node/src/admission.node.test.ts"
    exit: 0
    result: "1 file, 8 passed (8) — the new SCHED-03 case at 533 ms. real 9.96 user 3.61 sys 0.66, (user+sys)/real 0.43"
  - command: "npx vitest run --project node .../admission.node.test.ts -t 'refuses a combine on a node its deployment paused'  # PLANT B: fabric-node.ts drops options.paused"
    exit: 1
    result: >-
      1 failed | 7 skipped (8). AssertionError: expected CID(bafyreiavz2vd27fwoehe5ho2bvd7tmoar4iuni2bt5yimeozajvamunqia)
      to be null — the paused node combined anyway, which is the gap's own original state reproduced as a red test.
      Restored by surgical inverse; cmp exit 0
  - command: "npx vitest run --project node .../admission.node.test.ts -t 'refuses a combine on a node its deployment paused'"
    exit: 0
    result: "1 passed | 7 skipped (8) — after the restore"
  - command: "/usr/bin/time -p npx vitest run --project node <the eight-gate guard set>"
    exit: 0
    result: "8 files, 364 passed (364). real 6.40 user 7.01 sys 1.57, (user+sys)/real 1.34"
  - command: "/usr/bin/time -p npx vitest run --project node  # first attempt"
    exit: 1
    result: >-
      1 failed | 196 passed (197); 1 failed | 2961 passed | 1 skipped (2963). The one failure is
      admission-agents.node.test.ts clause 1 — a spawn-heavy relay-circuit arrival, no overlap with
      anything this pass touched. real 639.50 user 721.24 sys 115.36, ratio 1.31. ATTRIBUTED BY THE
      PAIR OF RUNS, not by "passes in isolation" — see the amendment's own section
  - command: "/usr/bin/time -p npx vitest run --project node packages/node/src/admission-agents.node.test.ts"
    exit: 0
    result: "1 file, 6 passed (6); the failing clause at 12336 ms against 15588 ms. real 57.22 user 49.92 sys 8.76, ratio 1.02"
  - command: "/usr/bin/time -p npx vitest run --project node  # repeat, nothing edited between the two"
    exit: 0
    result: >-
      197 files, 197 passed; 2962 passed | 1 skipped (2963) against a baseline of 197 files,
      2961 passed, 1 skipped — file count identical, tests +1, which is the one case added to an
      existing file. real 545.04 user 687.43 sys 109.85, ratio 1.46
  - command: "/usr/bin/time -p npx vitest run --project e2e"
    exit: 0
    result: "36 files, 232 passed (232) — matches the baseline exactly. real 854.59 user 446.46 sys 85.58, ratio 0.62"
gaps:
  - truth: "A test fails the day `CombineWork` gains a field that could carry sovereignty"
    status: met # CLOSED 2026-08-19 by BUILDING the guard, route 1 of this entry's own `missing:`.
                # The tautology is gone; an exhaustive mapped type is in its place; the same M2 plant
                # that falsified the old claim was re-planted and watched go RED at exit 1.
                # ONE THING IS NARROWED AND SAID OUT LOUD RATHER THAN SMOOTHED: the guard fires at
                # `npx tsc --noEmit`, NOT in a vitest run — with the plant in place the file is still
                # 11 passed. `CombineWork` is a type, types are erased, so no runtime assertion in any
                # spec could ever have caught this. The tree's claim is now "this stops compiling",
                # which is exactly what was measured. See the 2026-08-19 AMENDMENT.
    original_status: failed
    reason: >-
      16-05-SUMMARY.md and `capability-authorizer.test.ts:194-197` both claim the
      combine key-set case "stops compiling" if `CombineWork` grows a sovereignty
      field, and that claim is the stated mitigation for the ruling clause 16-05
      reported unmeetable. Mutation M2 falsifies it: adding `readonly ownerId?: string`
      to `CombineWork` leaves `npx tsc --noEmit` at exit 0 and all 11 tests in that
      file green. The assertion is a tautology — a three-element array literal
      compared to itself — and `(keyof X)[]` stays satisfied when `X` gains a key.
      Optional is the form this repository actually uses for sovereignty on a work
      shape (`ports.ts:50-51`, `Task.label`/`Task.ownerId`, optional by a stated
      decision), so the mutation is the realistic one, not a contrived one.
    artifacts:
      - path: "packages/net/src/capability-authorizer.test.ts"
        issue: "Lines 198-199 assert nothing about `CombineWork`; the comment at 194-197 claims they do"
      - path: ".planning/phases/phase-16-decomposable-tree-reduce-wiring/16-05-SUMMARY.md"
        issue: "Lines 218-220 present the guard as 'a failing test rather than a sentence in a summary'"
    missing:
      - "A guard that actually fails on an added optional field — e.g. an exhaustive mapped-type check, or a runtime `Object.keys` assertion over a constructed `CombineWork` literal, in the shape `combine-wire.test.ts` already uses for the frame"
      - "Or: withdraw the claim from both the test comment and the summary, leaving the unmeetable clause standing on its own without a mitigation it does not have"
  - truth: "A duplicate combine result ARRIVING LATE from a recovered node is discarded harmlessly"
    status: met # CLOSED 2026-08-06 by the FIRST amendment, after Phase 20 criterion 6 landed MET. This line is
                # bookkeeping only: that amendment already recorded the closure in the body and in criterion 3's
                # verdict, and left this entry unedited. Nothing about it is re-decided today.
    original_status: partial
    reason: >-
      The dedupe property is fully measured on real processes (same inputs → same
      bytes → same CID → probe store grows by 0), and the job completes without
      double-counting or erroring. The "arriving late" clause is not: `executeReduce`
      walks the rendezvous ranking, stops at `wanted` replicas, and has no channel on
      which a result arriving after that could be received. The duplicate is solicited
      by the test through `remoteCombineDispatch`, not arriving unbidden. The test
      file states this itself at `:867-875` and calls it unmet; this verification
      agrees rather than softening it.
    artifacts:
      - path: "packages/node/src/tree-reduce-agents.node.test.ts"
        issue: "Lines 877-994 stage the duplicate; the late-arrival path does not exist to be measured"
    missing:
      - "Either a late-arrival channel in `executeReduce` (new machinery no criterion asks for), or a ROADMAP amendment narrowing criterion 3 to the dedupe property that is measurable"
  - truth: "A deployment can refuse combines by supplying an authorizer that does"
    status: corrected # CLOSED 2026-08-19 by route 2 of this entry's own `missing:` — the claim is WITHDRAWN from
                      # 16-05-SUMMARY.md's threat-flag row, not made true. Route 1 (an `authorize` option on the node
                      # factories) was NOT taken, and not for cost: OWNER RULING 2026-07-31, commit `3b54897`, quoted
                      # verbatim inside `runCombine` in packages/net/src/agent.ts, rejects it BY NAME — "not an
                      # `authorize` override on the node factories that would reopen the door Phase 15 closed by
                      # hardcoding `authorizeCapability`". Building it would have overruled an owner, not delivered one.
                      # WHAT DID CHANGE, and it changed AFTER both readings of this gap were taken: `1043772`
                      # (2026-08-11) put `combine` in `DeclinedWhilePaused`, so the sentence "no node this repository
                      # can start can refuse a combine" stopped being true on 2026-08-11. Measured end-to-end today on
                      # a real `FabricNode.start`, with the factory's `paused: options.paused` line planted away and
                      # watched go RED. STILL FALSE AND NOT CLOSED BY THIS: there is no per-KIND combine refusal — a
                      # paused node declines exec, commit, combine and offer together — and by the ruling above there
                      # is not meant to be. See the 2026-08-19 AMENDMENT.
    original_status: failed
    reason: >-
      16-05's threat-flag states this as the mitigation that makes unconditional
      admission acceptable. There is no injection point. `FabricNodeOptions` has no
      `authorize` field and neither does the browser equivalent; `fabric-node.ts:764`
      and `browser-node.ts:616` both hardcode `authorizeCapability(...)`, which
      returns `null` for every combine at `capability-authorizer.ts:100`. No node this
      repository can start — via `bin/agent.ts`, `FabricNode.start` or `BrowserNode` —
      can refuse a combine. Only a direct `serveAgent` caller could, and no production
      path is one. OWNER DECISION REQUESTED, see "Judgement on the two deviations".
    artifacts:
      - path: "packages/node/src/fabric-node.ts"
        issue: "Hardcodes `authorizeCapability` at :764; `FabricNodeOptions` exposes no `authorize`"
      - path: ".planning/phases/phase-16-decomposable-tree-reduce-wiring/16-05-SUMMARY.md"
        issue: "Threat-flag row claims a deployment-level opt-out that does not exist on this build"
    missing:
      - "Either an `authorize` option on `FabricNodeOptions`/`BrowserNodeOptions` so the claim becomes true, or a correction to the threat-flag text so it stops claiming a control this build does not offer"
deferred:
  - truth: "MR-02 — each owner computes a local partial over its own data with no map-side data movement"
    addressed_in: "Not this phase, by the phase's own record"
    evidence: >-
      `tree-reduce-agents.node.test.ts:72-78` states MR-02 is unmeasured by this file
      (every job is public, inputs travel to executors by CID). REQUIREMENTS.md:583
      records it as "Built, not wired" needing a sovereign map with an egress
      manifest. `acceptance-traceability.node.test.ts:621` spot-checks MR-02 as open.
      Left open; not counted against Phase 16's four criteria.
  - truth: "The demo still merges with a linear scan (`answerOf`, packages/demo/src/job.ts)"
    addressed_in: "Phase 22 (WIRE-02)"
    evidence: "REQUIREMENTS.md:373 and :584-588 name WIRE-02/Phase 22 for the demo half of MR-03…MR-07"
---

# Phase 16: Decomposable Tree-Reduce Wiring — Verification Report

**Phase Goal:** A live multi-node job merges its shard partials by walking `executeReduce`'s derived tree, replacing the demo's linear scan
**Verified:** 2026-08-01T06:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification
**Mode:** ROADMAP marks this phase `mode: mvp`, but its goal is not in User Story form. MVP-mode User Flow Coverage is therefore not produced; the four ROADMAP Success Criteria are the contract verified below.

---

## Criterion 1 — MET

> A job run through `bin/agent.ts` across 8 or more live nodes merges its shard partials by walking the derived reduce tree — not a linear scan — and the aggregate matches a single-node reference computation bit-for-bit

**Evidence — eight real OS processes, not an in-process fabric.**
`packages/node/src/tree-reduce-agents.node.test.ts:143` resolves `./bin/agent.ts`;
`:192-200` spawns it with `process.execPath` and `stdio: ['ignore','pipe','pipe']`,
one child per node, reading each child's own stdout handshake. `standUp(8)`
(`:368-390`) spawns eight and asserts eight distinct peer ids off eight distinct
children (`:620-622`). `bin/agent.ts:84` starts a `FabricNode`, and
`fabric-node.ts:764` installs a real `authorizeCapability` — so these are production
nodes, which is precisely what an in-process `serveAgent({...SENTINELS})` fabric could
not be.

**Evidence — a tree, not a linear scan.** `reduce-job.ts:187` derives the tree with
`deriveReduceTree` and `:192` walks it with `executeReduce`. `reduce.ts:206` sorts and
dedupes leaves; `:214-230` chunks each layer at `fanout` and emits a combine per chunk,
one level at a time. `executeReduce` (`reduce.ts:348-394`) runs each level's nodes
under one `Promise.all` and only then starts the next — a level-by-level walk, not a
sequential fold. The test pins the shape at `:651-659`: `leaves = 8`, `nodes = 3`,
`depth = 2`, `depth > 1`, `combines === nodes.length`, `executedBy.size === nodes.length`.
The stated numbers check out: 8 leaves at fanout 4 → `nodes: 3, depth: 2`.

**Evidence — bit-for-bit against a single-node reference.** `referenceRoot`
(`:431-435`) merges all eight projected outputs in **one** `fabricCombiner` call — a
different association from the tree's two-level one — and `:688` compares it to
`outcome.rootCid`. The dependency is proved rather than asserted: `:694-696` corrupts
one of the eight agreed outputs and requires the reference to move.

**Command and result:**
```
$ npx vitest run --project node packages/node/src/tree-reduce-agents.node.test.ts
Test Files  1 passed (1)      Tests  4 passed (4)      Duration 7.27s
```
(uptime read immediately before: `load averages: 3.84 5.08 5.99` on 8 cores)

**Falsified twice** — see Mutations M1 and M3 below. Both turn this criterion red, at
different assertions.

---

## Criterion 2 — MET

> Killing a combine node mid-job during a run through `bin/agent.ts` causes its combine to be recomputed elsewhere from content-addressed inputs with no state transfer, and the job still completes with the correct aggregate

**Evidence.** `tree-reduce-agents.node.test.ts:722-861`.

| Clause | Where | How |
|---|---|---|
| instrument check first | `:742-745` | a healthy run's root must be non-null before anything is compared to it — `null === null` would otherwise pass on a run that aggregated nothing |
| positive control | `:757` | undisturbed, the victim *is* the executor for `tree.nodes[0]`; without this, `not.toBe(victimId)` is a silence |
| killed mid-flight | `:783-787` | SIGKILL awaited inside the dispatch wrapper, before the dial; `:794` asserts the wrapper fired, `:798` that it was a vanish (`signalCode === 'SIGKILL'`) not a shutdown |
| recomputed elsewhere | `:806` | `executedBy.get(nodes[0].id)` is not the victim |
| job completes, correct aggregate | `:802-809` | `ok`, `failed: []`, `rootCid === healthyRoot`, `recomputes > 0`, and `rootCid === referenceRoot(agreedOutputs(job))` recomputed in this run |
| no state transfer, wire side | `:815-825` | the frame for the recomputed task carries exactly `['combineId','inputCids','kind','level']`; every input is a CID. Fires on **addition**, the direction a payload arrives from |
| no state transfer, receiver side | `:852-860` | the replacement process's on-disk blockstore holds every input of the combine it recomputed, and it was never sent any of them — it asked by CID |
| production entry point | `:833-843` | the whole reduce re-run through `reduceJob` with the victim already dead; `second.outcome.ok`, not merely `second.ok` |

**Command and result:** included in the 4-passed run above. Turned red by M1
(`expected null not to be null`) and by M3 (bit-for-bit CID mismatch).

---

## Criterion 3 — PARTIAL

> A duplicate combine result arriving late from a recovered node is discarded harmlessly because it carries the same CID — observable as the job completing without double-counting or erroring

**What IS measured, on real processes.** `tree-reduce-agents.node.test.ts:877-994`.
The reduce runs at `redundancy: 2` with `minReplicas === 2` and `disagreements === []`
(`:894-898`); exactly two of the eight agent directories hold the root (`:993`), read
after the processes are gone. The dedupe is then measured against an empty
`MemoryBlockstore` probe — deliberately not `submitter.store`, whose disqualification
is argued at `:938-942` — with three deltas: `+1` (instrument connected), `+0` (a
ninth, freshly spawned process that has never seen these inputs answers with the
**identical CID** and the store does not grow), `+1` (a different combine still grows
it, so the `+0` is a reading and not a store that never grows). The `+0` is flanked by
two positive controls, which is what makes it a measurement.

**Why PARTIAL.** The clause is *"arriving late"*. `executeReduce` walks the ranking,
stops at `wanted` replicas (`reduce.ts:374-382`), and has no channel on which a result
arriving after that could be received at all. The duplicate above is **solicited** by
the test through `remoteCombineDispatch` — a fresh process asked to recompute — not one
arriving unbidden. The test file says this in its own words at `:867-875` and calls the
clause unmet; this verification does not soften that.

The substantive property the criterion exists to protect — no double-counting, no
error, harmless because content-addressed — is established. The literal scenario is not
reproducible on this build without new machinery no criterion asks for. Recorded as a
gap for an owner decision (narrow the criterion, or build the channel), not as a defect.

**Command and result:** included in the 4-passed run above. Turned red by M1
(`expected false to be true`).

---

## Criterion 4 — MET

> `bin/bench.ts` reports the reduce-tree combine step (rendezvous-assigned executors, tree depth) as part of its measured job path, rather than bypassing `executeReduce`

**Evidence — the driver runs it.** `bin/bench.ts:613-629` opens its own
`performance.now()` bracket and calls `reduceJob`, which is `deriveReduceTree` +
`executeReduce` (`reduce-job.ts:187`, `:192`). Nothing is stubbed: the executors are
`fabric.executors` node ids and the blockstore is the requestor's own.

**Evidence — it reports what the criterion names.** `:634-643` records
`treeDepth: reduced.tree.depth` and
`combineExecutors: new Set(reduced.outcome.executedBy.values()).size`. `executedBy` is
populated by `executeReduce` from `rendezvousRank(node.id, executors)` (`reduce.ts:366`),
so `combine executors` is a count of rendezvous-assigned executors by construction.
`report.ts:146,149` emits the row.

**Evidence — it is not credited when it did not happen.** `:634` requires
`reduced.ok && reduced.outcome.ok`, with the reason stated on the line: `ok` alone
means only that a reduce was attempted. `harness.ts:298` then aggregates the reduce
over `completed.filter((o) => o.reduce.ok)` — a fast failure is excluded, not recorded
as a fast run. Guarded by `packages/node/src/bench-reduce.node.test.ts`, which reads the
real driver source and the committed artifact and proves it can report absence
(`:236-256`) and a wrong value, not only a missing one (`:421`).

### Adversarial check of the published run

| Project rule | Finding |
|---|---|
| Methodology change is a separate, **earlier** commit | **Holds.** `772a060` touches only `packages/node/src/bin/bench.ts` (the note the driver emits) and its message states *"Nothing is asserted here about what the next run will show."* `725410d` carries the numbers, after it. |
| No published figure silently replaced | **Holds.** BENCHMARK-RESULTS.md:19 retains what the previous run published (four em dashes) and why, and states that an em dash no longer means "refused". The real-transport reduce table is a **first** publication, not a replacement. |
| Every figure states its driver | **Holds.** Line 11 states every node in both curves is in one OS process on one event loop; line 17 states `combine executors` counts identities, not machines or processes, and points at the eight-process file for the tree-walk evidence. |
| Excluded rungs published with reason | **Holds.** The real-transport 16-node rung is published as excluded with its ECONNRESET reason (`:69`), unchanged in substance from 16-04. |
| Percentiles, not means | **Holds.** p50/p95/p99 throughout; `recomputes` is a sum and `treeDepth`/`combines`/`combineExecutors` are maxima, each with a stated reason (`harness.ts:165-176`). |
| A fast failure is not a fast run | **Holds.** Verified from `.planning/bench/raw.json`: every rung of both curves reads `makespan n 19, incomplete 0` **and** `reduce n 19`. No rung's reduce sample is short. |
| The contended-host justification | **Holds, and I checked it rather than accepting it.** Against 16-04's published run (`git show 9c83854`): memory makespan p50 22.4/44.6/44.5/45.8/44.9 vs 23.4/45.2/45.3/45.6/44.9 → −4.3%/−1.3%/−1.8%/+0.4%/0.0%. Real makespan p50 38.2/68.8/67.2/69.5 vs 39.7/71.5/70.8/75.8 → −3.8%/−3.8%/−5.1%/−8.3%. Within the stated ~4%/~8%, several rungs *faster* — the direction that makes contention a conservative rather than a flattering influence. |
| The numbers in the objection brief | **Both confirmed.** `bin/bench.ts:90` ships `SHARDS = 16`, not 8; the artifact and raw.json both read `tree depth 2, combines 5` on every rung, which is `deriveReduceTree` over 16 leaves at fanout 4. The eight-leaf case (`nodes: 3, depth: 2`) is the process test's, asserted at `tree-reduce-agents.node.test.ts:652-653`. |

**Command and result:**
```
$ npx vitest run --project node packages/node/src/bench-reduce.node.test.ts \
    packages/net/src/combine.test.ts packages/net/src/capability-authorizer.test.ts \
    packages/net/src/reduce-job.test.ts packages/core/src/reduce.test.ts
Test Files  5 passed (5)      Tests  83 passed (83)
```

---

## Mutations planted by this verification

Every mutation was planted one at a time, restored with `cp` from `/tmp/o2-verify-baseline/`,
and confirmed byte-exact with `cmp` (exit 0) and `md5`. **No `git checkout`, `restore`,
`stash`, `reset` or `clean` was run at any point** — this working tree is shared.
`git status --short` is empty at the end of this verification.

### M1 — the pre-16-05 gate, restored verbatim (re-plant of 16-05's mutation E)

Replaced the `options.authorize({kind:'combine',…})` call at `agent.ts:350-362` with the
gate 16-05 deleted, recovered verbatim from `git show 8558b59`:
`if (options.authorize !== 'serves-unauthenticated') return {kind:'combine', resultCid:null, reason:'combine requires a capability chain this build cannot verify'}`.

```
Tests  4 failed (4)
  AUTH-03 frame:  expected 'combine requires a capability chain t…' to be ''
  criterion 1:    expected +0 to be 3          ← outcome.combines
  criterion 2:    expected null not to be null
  criterion 3:    expected false to be true
```

**16-05's reported reading is independently reproduced, down to the failure text.**
All four process tests are gated on this fix and on nothing else. This is the central
mechanism of the phase and it is load-bearing.

### M2 — a sovereignty-capable field added to `CombineWork` (novel; falsifies a 16-05 claim)

`capability-authorizer.test.ts:194-197` claims: *"if `CombineWork` ever gains a field
that could carry sovereignty, this stops compiling"*. 16-05-SUMMARY.md:218-220 offers
that test as the reason the unmeetable ruling clause is acceptable —
*"a failing test rather than a sentence in a summary nobody re-reads"*.

**M2a — optional field** (`readonly ownerId?: string` added to `CombineWork`):
```
npx tsc --noEmit                                                  → exit 0
npx vitest run --project node .../capability-authorizer.test.ts   → 11 passed (11)
```
**The claim is false.** Nothing compiles-fails and nothing goes red.

The assertion is a tautology:
```ts
const combineKeys: (keyof AuthorizedWorkCombine['combine'])[] = ['combineId', 'inputCids', 'level']
expect(combineKeys).toEqual(['combineId', 'inputCids', 'level'])
```
A three-element array literal is compared to itself. The type annotation only requires
each element to *be* a key — widening `keyof` by adding a key leaves all three valid.

The optional form is the realistic one, not a contrived one: `ports.ts:38-51` makes
`Task.label` and `Task.ownerId` **optional** by an explicit decision, precisely so
existing literals keep compiling. Whoever grows the combine frame will reach for the
same shape, and this guard will wave it through.

**M2b — required field** (`readonly label: 'public' | 'sovereign'`): tsc fails with three
`TS2741`s at `agent.ts:357` and `capability-authorizer.test.ts:177,207` — i.e. at the
**construction sites**, which is ordinary structural typing that would fire with or
without this test. Line 198's `combineKeys` declaration is not among the errors. So even
in the case where something breaks, the guard is not what breaks it.

### M3 — an order-dependent, non-associative combiner (novel; tests the bit-for-bit claim)

`reduce.ts:520`: `rows += partial.rows` → `rows = rows * 2 + partial.rows`. This makes
`fabricCombiner` non-associative, so one merge over eight partials and a two-level tree
merge over the same eight can no longer agree.

```
packages/core/src/reduce.test.ts                    → 6 failed | 22 passed (28)
packages/node/src/tree-reduce-agents.node.test.ts   → 2 failed | 2 passed (4)
  criterion 1: expected 'bafyreia7mev5lteiw5v7gzwdxe47kneohjon…'
               to be    'bafyreiau4aauedqt73po6h76vynak4dfg25q…'
  criterion 2: same CID mismatch
```

**The single-node reference comparison is real and load-bearing.** It goes red on an
association change alone, with every other assertion in criteria 1 and 2 — tree shape,
`executedBy`, `failed`, holder counts — staying green. That is exactly the failure mode
a shape-only test would miss, and it confirms the comment at `:424-429`: associativity
is the reduce contract, and the bit-for-bit comparison is the only thing enforcing it.

Consistent with the brief's note that an order-dependence mutation turned tests red
before 16-05 — it still does, and it now does so at the process level too.

### Restoration proof

```
$ md5 packages/net/src/agent.ts packages/core/src/reduce.ts packages/net/src/capability-authorizer.ts
e7941995bb5a36dd2f96d981e0330960  packages/net/src/agent.ts
91f3677dc972a0d669dde2734aae057a  packages/core/src/reduce.ts
54bc34d053cb77ea7a10287c54f9964e  packages/net/src/capability-authorizer.ts
   (identical to /tmp/o2-verify-baseline/*.ts)
$ git status --short
   (empty)
$ npx tsc --noEmit
   exit 0
```

---

## Judgement on the two deviations from the owner's ruling

**The ruling (owner, 2026-07-31):** route combine through the same `Authorizer` as
`exec`, passing whatever `Task`-shaped value a combine legitimately presents; a sovereign
combine without a chain is refused by the same code that refuses a sovereign exec.

### Deviation 1 — `Authorizer` widened to a union rather than a `Task` fabricated: **JUSTIFIED**

I checked the claim rather than accepting it. `Task` (`ports.ts:29-51`) requires
`moduleCid`, `inputCid`, `partitionIndex` and `partitionCount`. A combine has none of
them: it runs the fabric's fixed `fabricCombiner` (`agent.ts:404`) and not a module, so
there is no `moduleCid`; it reads `request.inputCids` — plural, up to
`MAX_COMBINE_INPUTS` — so there is no single `inputCid`; and it sits at a tree `level`
(`reduce.ts:225`), which is not a `partitionIndex` out of a `partitionCount`. There is
no legitimate `Task`-shaped value here.

A fabricated `moduleCid` would be a CID naming nothing, and `authorizeCapability` rule
4 (`capability-authorizer.ts:132-139`) is a function that reads the work's fields and
returns text about them — so an authorizer that later keyed on it would refuse or admit
on the strength of an address for bytes that do not exist. This repository's own rule
is that a refusal naming the wrong thing is a defect even when the job correctly fails.
Widening the exported type in a pre-1.0 sole-authorship repository with no external
implementers is the cheaper error. **The deviation is right, and 16-05's reasoning for
it survives inspection.**

Cost verified as stated: the blast radius was four files, `authorizeCapability` narrows
on `kind` at `:100`, and `capability-authorizer.test.ts`'s five original cases read
unchanged through an `execWork(task, chain)` helper (`:87-89`). No assertion was
weakened — I compared them against the pre-16-05 versions.

### Deviation 2 — the sovereign-combine clause reported unmeetable: **CORRECTLY DIAGNOSED, INADEQUATELY MITIGATED, AND THE RESULTING BEHAVIOUR NEEDS AN OWNER DECISION**

**Both halves of the brief's question, answered plainly.**

**Half A — does a combine genuinely flow through `options.authorize`, and would it
refuse if an authorizer refused? YES.** `agent.ts:350-362` calls the hook before any
block is read, and `:363-369` turns a refusal into `unauthorized: <text>` in the combine
reply shape. This is tested three ways in `combine.test.ts:352-420`: the hook is obeyed
when it admits (a real combine, matched against a local `fabricCombiner` reference), the
hook's own refusal text comes back verbatim under the shared `unauthorized: ` prefix
with **zero** blockstore reads, and the hook is told the combine's own three addresses
and no fabricated task. The structure the owner asked for is genuinely in place.

**Half B — can anything in this repository currently make one refuse? NO.**
`authorizeCapability` returns `null` for every combine at `capability-authorizer.ts:100`,
unconditionally, before it looks at anything. It is the only `Authorizer` implementation
outside tests. `fabric-node.ts:764` and `browser-node.ts:616` both hardcode it, and
**neither `FabricNodeOptions` nor the browser equivalent exposes an `authorize` field** —
I grepped for one and there is none. So no node startable through `bin/agent.ts`,
`FabricNode.start` or `BrowserNode` can refuse a combine, and 16-05's threat-flag
sentence *"a deployment can refuse combines by supplying an authorizer that does"* is
true only of a hypothetical direct `serveAgent` caller, which no production path is.
That over-claim is recorded as a gap above.

**Therefore: today's behaviour is indistinguishable from the option the owner rejected
("open the gate unconditionally"), even though the structure is the one they chose.**
16-05 says as much in the code comment at `:90-99` and I confirm it. What was actually
gained is real but narrower than the summary's framing: the decision moved from a branch
keyed on *whether the node had an authorizer* — which made a production node strictly
less capable than a test node — to a hook that is consulted on every node alike. That is
the correct shape. It is not yet a control.

**The mitigation does not hold.** 16-05 argues the gap is acceptable because it wrote a
test that fails the day the frame grows a sovereignty field. Mutation M2 proves that
test does not do this for the optional-field form, which is the form this repository's
own `Task` uses. So the unmeetable clause currently stands with **no** enforced guard
behind it — only a comment.

**My judgement, offered for an owner decision rather than asserted:**

1. The diagnosis is correct and honestly reported. A sovereign combine is not
   expressible on this build — `protocol.ts:565` parses four keys and
   `combine-wire.test.ts` holds that shape — so the clause could not have been met
   without a wire change, and 16-05 was right to report it rather than fake it with a
   custom authorizer refusing for an invented reason.
2. Rejecting the wire widening was defensible on its stated second ground — nothing in
   this repository would set the new fields, since `reduce-job.ts`'s `contributorFor` is
   explicitly not an owner id — but that argument's force depends entirely on the guard
   that M2 falsifies. Fix the guard, and the deferral is sound. Leave it, and the only
   thing standing between this build and a silently-admitted sovereign combine is a
   comment.
3. **Recommendation:** accept deviation 1 outright; accept deviation 2's *diagnosis*
   but treat its *mitigation* as an open gap. Either give `FabricNodeOptions` an
   `authorize` override so the threat-flag's claimed control becomes real, or correct
   the threat-flag text — and in either case replace the tautological key-set assertion
   with one that fails on an added optional field.

### The fetch-amplification consequence — CONFIRMED in substance, with one attribution corrected

16-05 states the confidentiality half of 16-03's threat flag is not closed. **The
substance is right and is in fact slightly understated; the attribution is imprecise.**

16-03's flag (16-03-SUMMARY.md:381) is explicitly labelled *"Availability, not
confidentiality"*, so it had no confidentiality half to leave open. What 16-05 actually
did was remove a mitigation that **16-02's** `unauthenticated-fetch-amplification` flag
depended on: that flag (16-02-SUMMARY.md:390) recorded the surface as bounded *"to zero
under a real `Authorizer`"* — true only while every real authorizer refused every
combine. It no longer is. The residue therefore widened from unauthenticated nodes to
**every node this repository can start**.

This is disclosed accurately in the code: `agent.ts:305-308` corrects its own bound-3
text to name the refusing case only, and `:310-323` states what is not closed. The
general answer named there — per-request admission (SCHED-06) — is the right one, and
inventing a bound for this branch alone would not be. **Confirmed: not closed.**

---

## Requirements coverage

Nothing was ticked. `.planning/REQUIREMENTS.md` lines 232-243 are left exactly as found.

| Req | Verdict | Why not ticked |
|---|---|---|
| MR-02 | **NOT established** | No partial in this phase was computed over an owner's own data — every job is public and inputs travel by CID (`tree-reduce-agents.node.test.ts:72-78`). REQUIREMENTS.md:583 already records this. `acceptance-traceability.node.test.ts:621` spot-checks MR-02 as **open**; ticking it would turn `develop` red, which is the failure a previous verification caused. |
| MR-03 | **Established for the aggregation path only** | `fabricCombiner` merges associatively up a derived tree on the wired path. The demo still merges by linear scan (`answerOf`, `packages/demo/src/job.ts`) — WIRE-02, Phase 22, per REQUIREMENTS.md:584. Row already reads "Partial"; a tick would contradict its own text. |
| MR-04 | **Established for the aggregation path only** | Sorted, deduped, consensus-free derivation verified at `reduce.ts:198-206` and pinned at `tree-reduce-agents.node.test.ts:651-653`. Same demo-half deferral. |
| MR-05 | **Established for the aggregation path only** | `reduce.ts:366` ranks by rendezvous and `:371-382` uses the tail as the fallback list; asserted per tree node at `tree-reduce-agents.node.test.ts:681-683` and independently at bench scale (`combine executors` 1→4/1→5). Same demo-half deferral. |
| MR-06 | **Established for the aggregation path only** | Criterion 2's SIGKILL evidence above. Same demo-half deferral. |
| MR-07 | **Partially established** | Dedupe measured; "arriving late" not expressible — see criterion 3. Same demo-half deferral. |

**Note on MR-03's wording (INFO, pre-existing, not this phase's to fix):**
REQUIREMENTS.md:234-235 says *"associative, **commutative** combine"*. No production
source in `packages/*/src` makes a commutativity claim — I grepped, zero matches — and
`tree-reduce-agents.node.test.ts:429` states commutativity *"is not claimed and must not
be reintroduced"*. `fabricCombiner` happens to be commutative (key-wise sum), so the
requirement text is factually satisfied; it is the requirement wording, not the code,
that is out of step with the project's stated contract.

**`acceptance-traceability.node.test.ts` spot-check was read at `:610-625` before any
consideration of editing the ledger, and no ledger edit was made. Run afterwards:**
```
$ npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts \
    packages/node/src/mutation-guard.node.test.ts \
    packages/node/src/vocabulary.node.test.ts packages/node/src/purity.node.test.ts
Test Files  4 passed (4)      Tests  132 passed (132)
```

---

## Anti-patterns and disconfirmation pass

| File:line | Finding | Severity |
|---|---|---|
| `packages/node/src/tree-reduce-agents.node.test.ts:79-141` | **Stale file header.** Still reads *"READ THIS BEFORE READING THE SKIPPED TEST BELOW"*, *"Criteria 1, 2 and 3 are **NOT MET**"*, and *"the criterion is the second and it is skipped, loudly, so that a reader cannot mistake an unmeasured criterion for a met one"*. `git show ca07f88` confirms 16-05 rewrote only from line 514 down. There are no skips (`grep describe.skip` → no match) and all three criteria pass. The file's own header now says the opposite of what the file measures — the precise reading error the header exists to prevent. | ⚠️ WARNING |
| `packages/net/src/capability-authorizer.test.ts:198-199` | A test that passes but does not test its stated behaviour. See gap 1 and mutation M2. | 🛑 BLOCKER (for the deviation-2 acceptance argument, not for the four criteria) |
| `16-05-SUMMARY.md` threat-flag row | Claims a deployment-level opt-out (`supplying an authorizer that does`) with no injection point on this build. See gap 3. | ⚠️ WARNING |
| `packages/net/src/combine.ts:92-93` | A combine refusal reason is discarded; `remoteCombineDispatch` returns `null` for a refusal, a dead node, a missing input, an oversized partial and a decode failure alike. This is exactly the channel that hid this phase's own defect for two milestones. **Chesterton's fence applies:** it is disclosed at `combine.ts:25` — *"the reason string the peer sent is lost by construction"* — and `CombineDispatch`'s contract (`reduce.ts:264-268`) is built on `null` meaning "gone". Pre-existing, documented, not introduced or worsened by this phase. | ℹ️ INFO |
| Debt markers | `grep -E "\bTBD\b|\bFIXME\b|\bXXX\b|\bTODO\b|\bHACK\b|PLACEHOLDER"` across every file in `git diff --name-only 7a986e4..HEAD` → **no matches**. | — |
| Skipped tests | `grep describe.skip\|it.skip` in the process-test file → no match. 16-05's count reconciliation (1237 → 1245) accounts for every delta; the 18 skipped is the pre-existing baseline. No test was skipped to make this pass. | — |

**One requirement only partially met:** MR-07 — see criterion 3.
**One test that passes without testing its stated behaviour:** `capability-authorizer.test.ts:183-211` — proven by M2.
**One error path with weak coverage:** the `unauthorized:` refusal reaches `executeReduce` as an untyped `null` and is counted as an attempt against a node that is not gone; a run in which every node refuses reports `ok: true`, `combines: 0`, `failed: [all]`, `rootCid: null` (measured under M1) with nothing naming the cause. Documented rather than undisclosed.

---

## Gates run by this verification

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **exit 0** (run twice: at entry, and after all mutations were restored) |
| Eight/nine-process criteria | `npx vitest run --project node packages/node/src/tree-reduce-agents.node.test.ts` | **4 passed** |
| Reduce / combine / authorizer / bench guard | `npx vitest run --project node .../bench-reduce.node.test.ts .../combine.test.ts .../capability-authorizer.test.ts .../reduce-job.test.ts .../reduce.test.ts` | **83 passed** |
| Repo guards | `npx vitest run --project node .../acceptance-traceability .../mutation-guard .../vocabulary .../purity` | **132 passed** |
| `@o2/net` package | `npx vitest run --project node packages/net/src` | **220 passed** (21 files) — matches 16-05's reading |
| Working tree | `git status --short` | empty; `md5` identical to scratch baselines |

Host load across the session: 3.84 → 10.16 on 8 cores (`uptime` read before each timed
run). No timing bound was set or changed by this verification, and no verdict above
rests on a duration.

---

## Gaps Summary

The phase's central mechanism is real and I falsified it three ways. The combine gate
that made every real node refuse is genuinely gone (`agent.ts:350-370`); reverting it
turns all four process tests red at the exact failure 16-05 reported; a non-associative
combiner turns the bit-for-bit reference comparisons red while every shape assertion
stays green; and the reduce leg is measured, reported and guarded in `bin/bench.ts` with
a published run whose methodology ordering and contended-host control both survive
checking. Criteria 1, 2 and 4 are met on evidence I ran.

Three things are not settled.

**The guard 16-05 offered in place of the ruling clause it could not meet does not
guard.** Adding an optional sovereignty field to `CombineWork` — the form this
repository's own `Task` uses — passes `tsc` and passes all eleven tests in the file
that claims it would not. The unmeetable clause is therefore currently protected by a
comment, not by a test.

**Nothing on this build can refuse a combine.** The hook is consulted on every node,
which is the right structure and a genuine improvement over a branch keyed on the node's
configuration. But the only production `Authorizer` returns `null` for every combine
unconditionally, and no node factory exposes a way to supply a different one. The
observable behaviour today is the option the owner rejected. This should be an owner
decision, not a verifier's.

**Criterion 3's "arriving late" clause is not expressible on this build,** as the test
file itself records. The dedupe property behind it is fully measured across nine real
processes; the arrival path is not, because there is none.

**Score: 3/4** — criteria 1, 2 and 4 MET; criterion 3 PARTIAL.

---

_Verified: 2026-08-01T06:30:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Amendment — 2026-08-06: criterion 3 is MET, and the score is 4/4 criteria

**Score: 3/4 → 4/4 criteria.** Everything above is the 2026-08-01 initial pass and is left
standing; nothing in it is retracted. The frontmatter above still reads `score: 3/4 criteria met
(1 partial)` and `status: gaps_found`, and **only the first of those changes here**. What moves is
criterion 3 (PARTIAL → **MET**). What does not move is `status`, and the reason is recorded under
*"What this amendment does NOT close"* below: two of the three `gaps:` entries above are **not
criteria**, they were re-measured today, and they are unchanged.

This is a re-verification triggered by the destination phase landing, on the pattern
`18-VERIFICATION.md` set on 2026-08-04. It is an independent pass: **every reading below was
executed in this verifier's own process** and none of it is transcribed from
`20-VERIFICATION.md`, `20-03-SUMMARY.md` or any summary.

### The criterion text is unchanged, checked rather than assumed

`.planning/ROADMAP.md:478` and the quotation at `16-VERIFICATION.md:153` were extracted to files
and byte-compared: `cmp` **exit 0**. `git log -L478,478:.planning/ROADMAP.md` returns exactly one
commit — `c3e6fe1` *("docs: create milestone v1.1 roadmap")* — so the line has never been edited
since the milestone was written.

> 3. A duplicate combine result arriving late from a recovered node is discarded harmlessly
>    because it carries the same CID — observable as the job completing without double-counting
>    or erroring

`criterion_text_unchanged: true`. This amendment scores against the same contract the 2026-08-01
pass did.

### The destination, and why the bar lifted

The carry is an owner ruling with a commit behind it, not a summary sentence. `a3fc168`
(2026-07-31, *"docs(roadmap): Phase 16's unmeasurable clause goes to Phase 20, not into a softer
criterion"*) adds `.planning/ROADMAP.md:945` and nothing else:

> 6. **A combine result arriving from a recovered node *after* `executeReduce` has already
>    collected its `wanted` replicas is received and discarded harmlessly** — an unsolicited late
>    duplicate, not one the test asked for. Routed here by owner ruling 2026-07-31 from Phase 16's
>    criterion 3, which scored PARTIAL for this clause alone

`git log -L945,945` returns that one commit; the destination text has not been edited either. Its
message states the scope: *"Owner ruling 2026-07-31: schedule it, do not rewrite it… Phase 16
keeps MR-04 open on this account."*

`20-VERIFICATION.md` (2026-08-05, head `8616049`) scores criterion 6 **MET** at 6/7 overall.
RULING A's condition is criterion-level, not phase-level — the STATE.md text is *"a carried
criterion stays PARTIAL until its destination **phase lands**"*, and the Phase 24 precedent applies
it per criterion (*"criterion 8 landed PARTIAL, and so all three stay PARTIAL together"*), while
Phase 18 closed at 9/9 on 2026-08-04 with Phase 20 not yet verified at all. So Phase 20 standing at
6/7 on **criterion 7** does not hold this one open. Criterion 6 landed, and it landed MET.

### The crux: do the two clauses actually match?

This is the question that could have gone the other way, and it was asked of the source rather
than of the two roadmap sentences.

**Criterion 3 decomposes into five parts.** Where each is measured, and whether the reading can
fail:

| # | Clause of Phase 16 criterion 3 | Measured where | Falsifiable? |
|---|---|---|---|
| a | "A duplicate combine result" | P16 `tree-reduce-agents.node.test.ts` (two independent producers, one CID); P20 `late-combine.node.test.ts` MR-07 (the combine the paused peer was asked for was completed by another peer, `paused.combines === tree.nodes.length`) | yes |
| b | "arriving late from a recovered node" | **P20 only** — this is the carried clause | yes — **M2 below** |
| c | "is discarded harmlessly" | P20 `rpc.ts`'s `late or duplicate reply` drop; `rejections.seen` empty | yes — **M1 below** |
| d | "because it carries the same CID" | **P16 only** — `expect(duplicateProduct?.cid).toBe(firstProduct?.cid)` with probe-store deltas `+1 / +0 / +1` | yes |
| e | "the job completing without double-counting or erroring" | P16 (probe `+0`, two holders at redundancy 2); P20 MR-07 (`ok`, `rootCid === healthyRoot`, `failed []`, `disagreements []`, `executedBy` omits the victim, `recomputes 3 against 0`) | **partly** — see below |

**Clause (b) is what Phase 20 measured, and it is the clause, not a neighbour.** Read in
`packages/node/src/late-combine.node.test.ts`:

- **recovered node, not a substitute for one** — `pauseAgent` sends `SIGSTOP` to a spawned
  `bin/agent.ts` child and *waits for `ps` to report state `T`*, so the freeze precedes the dial;
  `resumeAgent` sends `SIGCONT` and waits for the state to leave `T`.
- **late, against a requestor that stopped waiting** — the reply frame is timestamped and filtered
  by `repliesFrom(frames, victimId, reduceReturnedAt)`, a window that opens when `executeReduce`
  *returned*.
- **unsolicited, by construction rather than by argument** — `expect(asked.filter((e) => e.atMs >
  reduceReturnedAt)).toEqual([])`, where `asked` is the complete record because the wrapper is the
  only thing `executeReduce` dispatches through and it cannot run after `executeReduce` returned.
  This is precisely the property Phase 16 said its own duplicate lacked.

None of that is adjacent to the carried clause. It is stronger than the clause: criterion 3 says
"arriving late", and the destination additionally proves nobody asked for it.

**Clause (d) is the one finding that cuts against the criterion's own wording, and it is recorded
rather than smoothed over.** On the late path, CID identity is **causally inert**. `rpc.ts:280`
drops the frame because `this.#pending.get(key)` returns `undefined` — the correlation entry was
deleted by the timeout — and it does so *before* the payload matters. A late reply carrying a
*different* CID would be discarded identically. The instrument agrees: `watchInbound` records only
`from`, `kind` and `atMs`, never the decoded CID, so **no assertion anywhere in the tree reads the
late frame's CID**. The same-CID property is measured on a *re-dispatch after the resume*
(`afterProduct?.cid === healthyProduct?.cid` in MR-04; `revived?.cid === referenceCombine(...)` in
MR-07) and, falsifiably, in Phase 16's probe-store case — never on the late frame itself.

Two readings of "because it carries the same CID" are available and they score differently:

1. *"the drop is triggered by CID comparison"* — **false of this build**, and it should be. It
   would require a mechanism that does not exist and whose absence is what makes the discard
   unconditional.
2. *"the duplicate is harmless because content-addressing makes it redundant"* — **true, and
   measured**: an independent producer answers with the identical CID (P16, `+0` against `+1`/`+1`
   controls), and the run in which the late frame arrives is identical to an unpaused control of
   the same tree in the same run (P20 MR-07).

**This amendment takes reading 2**, and says so out loud rather than letting the "because" pass
unexamined. Under reading 1 the criterion could never close on any build that is correct, which is
not a bar the project set. This is the one place where the union of the two phases does not
literally exhibit criterion 3's own sentence, and an owner who disagrees with reading 2 should say
so — the verdict below turns on it.

**Clause (e) is measured, but its counting half is structurally unfalsifiable in the late case,
and that is disclosed by the tree already.** `late-combine.node.test.ts`'s own header carries a
table of which harmlessness readings moved under a plant, and records `rootCid`, `minReplicas`,
`combines` and `disagreements` as **not** movable — because `executeReduce` has already returned
before the frame lands, so no expression remains that could fold it into a count.
`.planning/REQUIREMENTS.md`'s MR-04 and MR-07 rows record the same limit in the same words. The
"without double-counting" observable in the **late** case is therefore carried by the readings that
*can* fail — the arrival count, `executedBy` omitting the recovered peer, `recomputes` strictly
above the unpaused run's, and `asked` empty after the resume — and by Phase 16's probe-store `+0`
for the dedupe itself. Stated plainly: the unfalsifiable four are comparative controls, not the
proof, and the file says so about itself.

### What was run, with exit codes read directly

`EXIT=$?` on the line immediately after each command. No pipes, no trailing `tail`, no `echo` on
the same line. Every invocation used `--project node`; no bare-path run was made. Every command
was wrapped in `/usr/bin/time -p`.

| # | Command | Result | `real` / `user` / `sys` | Exit |
|---|---|---|---|---|
| 1 | `npx vitest run --project node packages/node/src/late-combine.node.test.ts --reporter=verbose` | `Test Files 1 passed (1)` / `Tests 2 passed (2)` | 14.35 / 12.94 / 2.57 | **0** |
| 2 | the same, **M1 planted** in `packages/net/src/rpc.ts` | `Test Files 1 failed (1)` / `Tests 2 failed (2)` | 12.21 / 12.63 / 2.90 | **1** |
| 3 | the same, `-t 'delivers a reply the requestor had already timed out'`, **M2 planted** in the spec | `Test Files 1 failed (1)` / `Tests 1 failed \| 1 skipped (2)` | 21.02 / 7.15 / 1.66 | **1** |
| 4 | `npx vitest run --project node packages/node/src/tree-reduce-agents.node.test.ts --reporter=verbose` (Phase 16's own four cases, regression check) | `Test Files 1 passed (1)` / `Tests 4 passed (4)` | 17.65 / 39.93 / 6.54 | **0** |
| 5 | run 1 repeated after both restores | `Test Files 1 passed (1)` / `Tests 2 passed (2)` | 9.45 / 10.75 / 1.96 | **0** |

**Host conditions, recorded beside the timings because this host is shared.** `uptime` read
immediately before runs 1, 4 and 5: load averages **44.47**, **14.26** and **21.74** on 8 cores.
The ambient load was not another test suite: eight
`transpilers/cpp-to-rust/…/test_c_corpus_parity` processes at 70–77 % of a core each, unrelated to
this repository and **not signalled or killed**. `(user+sys)/real` was 1.08 on run 1 and 2.63 on
run 4 (run 4 spawns nine children and reaps their CPU); run 3's 0.42 is the 15 000 ms arrival
`waitFor` polling, i.e. waiting rather than starving. **No verdict here rests on a duration.**

The readings this pass took are **not** the readings `20-VERIFICATION.md` recorded, which is what
makes them a measurement rather than a transcription. Its harmlessness line read `paused peer asked
2×, late replies 2 at +163,163ms`; this pass read:

```
[criterion 6 / arrival] standUp 1744ms, map 413ms, cold combines [71,71,78,80,118,142]ms floor 71ms,
paused dispatch 1501ms against rpcTimeoutMs 1500, pause 1874ms, late replies 1 at +222ms,
send window 1722ms of 20000, frames from the paused peer [req,req,req,req,res]

[criterion 6 / harmlessness] tree 3 combines, paused peer asked 3× spread over 1654ms,
late replies 3 at +166,169,169ms, send window 3381ms of 20000, recomputes 3 against 0 unpaused
```

Three asks and three late replies against their two and two: the assertion is
`expect(late).toHaveLength(victimAsks.length)`, a relation taken inside the run, so a different
rendezvous draw changes both sides together. `[req,req,req,req,res]` is the resumed process
fetching the four partials it had never seen and only then answering — independent evidence that
the combine request crossed the pause rather than being re-sent.

### The two mutations, planted one at a time and watched go red

Backups taken to `/tmp/o2-verify16-baseline/` before either plant; each restored with `cp` and
confirmed byte-identical with `cmp` (exit 0) and `md5`. **No `git add`, `git commit`, `git stash`,
`git checkout --`, `git restore`, `git reset` or branch switch was run at any point.** `HEAD` was
`8d6ae20` at entry and `8d6ae20` at exit.

#### M1 — the silent drop made loud (re-execution of `20-VERIFICATION.md`'s P5, not a transcription)

`packages/net/src/rpc.ts:280`,
`if (entry === undefined) return // late or duplicate reply`
→
`if (entry === undefined) throw new Error('late or duplicate reply')`.

Observed, verbatim:

```
FAIL |node| …/late-combine.node.test.ts > MR-04 — a paused process answers after the request
     that asked for it gave up > delivers a reply the requestor had already timed out…
AssertionError: expected [ 'Error: late or duplicate reply' ] to deeply equal []

FAIL |node| …/late-combine.node.test.ts > MR-07 — the late duplicate is unsolicited, and it
     costs nothing > leaves the root CID, the executor record and the process error state
     identical to an unpaused run
AssertionError: expected [ …(3) ] to deeply equal []

Test Files  1 failed (1)      Tests  2 failed (2)
```

Exit **1**. This reproduces P5 independently, down to the failure text. It proves the *harmlessly*
half is load-bearing: `#receive` is invoked as `void this.#receive(...)`, so a throw at that line
has no caller left and becomes an unhandled rejection — and it reddens **only if the frame actually
arrived**, which makes one plant prove the channel and the disposition together.

#### M2 — the recovered node never recovers (novel; the instrument that carries the carried clause)

The spec's own header makes two claims about `expect(arrived)` that **cannot both be true**: at
`:70-73` it says the SIGCONT-withheld plant *"was watched"* going red at `expected false to be
true`, and at `:111-115` it says a later `RPC_TIMEOUT_MS = 12 000` experiment was *"the first time
in this file's history that `expect(arrived)` had ever actually failed."* Rather than pick one, the
plant was re-run.

`packages/node/src/late-combine.node.test.ts:1132`, MR-04: `await resumeAgent(victim)` removed, so
the paused agent is never SIGCONTed. Observed, verbatim:

```
[criterion 6 / arrival] standUp 1168ms, map 399ms, cold combines [24,25,25,25,28,42]ms floor 24ms,
paused dispatch 1501ms against rpcTimeoutMs 1500, pause 1671ms, late replies 0 at +ms,
send window NaNms of 20000, frames from the paused peer []

FAIL |node| …/late-combine.node.test.ts > MR-04 … > delivers a reply the requestor had already
     timed out, and the pause is what caused it
AssertionError: no late reply; frames from the paused peer [] — empty means the send was aborted,
non-empty means it ran and did not finish: expected false to be true // Object.is equality
 ❯ packages/node/src/late-combine.node.test.ts:1178:100

Test Files  1 failed (1)      Tests  1 failed | 1 skipped (2)
```

Exit **1**. **The reading that carries the carried clause is not vacuous.** Withhold the recovery
and the arrival count reads zero, the frame list from the paused peer is empty, and the case goes
red at the named assertion. `20-03-SUMMARY.md`'s plant table row **A** records the same result, so
the `:70-73` sentence is the correct one and the `:111-115` *"first time"* claim is inaccurate —
raising `RPC_TIMEOUT_MS` to 12 000 is itself a plant. Documentary only; recorded below.

#### Restoration proof

```
$ md5 packages/net/src/rpc.ts packages/node/src/late-combine.node.test.ts
41c1e75e4cdc7244fb620ecf81d58ef4  packages/net/src/rpc.ts
abd5a3a820651893cd4e4c32f940fd0d  packages/node/src/late-combine.node.test.ts
   (identical to /tmp/o2-verify16-baseline/*; cmp exit 0 on both)
$ git status --short
 M .planning/STATE.md          ← a concurrent agent's edit, present before this pass and untouched by it
$ git rev-parse --short HEAD
8d6ae20                        ← unchanged from entry
```

### Regression check on the three criteria that were already MET

`tree-reduce-agents.node.test.ts` — the file every one of Phase 16's four criteria rests on —
was re-run this pass and is **4 passed, exit 0** (run 4 above), including its own
*"MR-07 — two replicas dedupe, and a duplicate from a fresh process costs nothing"* case, which is
where clause (d) lives. No regression. The 2026-08-01 pass's ⚠️ WARNING about that file's **stale
header** is additionally **CLOSED**: the header now opens *"HISTORY. Nothing below is skipped and
all three criteria pass — this section records why they did not"*, which is the correction that
pass asked for.

### What this amendment does NOT close

**Two of the three `gaps:` entries in the frontmatter above are unchanged, and both were
re-measured today rather than assumed.** Neither is a criterion, so neither affects the 4/4 count —
*"the count is over criteria, never over requirements"*, and Phase 15 is counted at 3/3 despite a
Partial requirement — but `status:` stays `gaps_found` because they are still `failed`.

| Gap | Re-measured 2026-08-06 | Verdict |
|---|---|---|
| *"A test fails the day `CombineWork` gains a field that could carry sovereignty"* | `capability-authorizer.test.ts:198-199` still reads `const combineKeys: (keyof AuthorizedWorkCombine['combine'])[] = ['combineId','inputCids','level']` compared to the identical literal. The tautology M2 of the 2026-08-01 pass falsified is byte-for-byte intact. | **STILL OPEN** |
| *"A deployment can refuse combines by supplying an authorizer that does"* | `FabricNodeOptions` was enumerated field by field: **25 fields, no `authorize` among them**. `fabric-node.ts` still hardcodes `authorize: authorizeCapability({…})` at its `serveAgent` call, as does `browser-node.ts`. No node startable from `bin/agent.ts` can refuse a combine. | **STILL OPEN** |

Both remain owner decisions, exactly as the 2026-08-01 pass framed them.

**Also unchanged and not this amendment's:** MR-04 and MR-07 stay `[ ]` / **Partial** in
`.planning/REQUIREMENTS.md`, and correctly so — their rows already record *"The arriving late
clause is closed as of 2026-08-05 (Plan 20-03), and it was the clause Phase 16 kept this row open
for"*, and what keeps them open now is the **demo half** (`answerOf` in `packages/demo/src/job.ts`
still merges by linear scan), which is WIRE-02, Phase 22. **No `REQUIREMENTS.md` edit is
recommended by this amendment.**

### Findings that contradict claims already recorded in the tree

1. **`late-combine.node.test.ts:111-115` — *"the first time in this file's history that
   `expect(arrived)` had ever actually failed"* is false.** `20-03-SUMMARY.md`'s plant table row A
   records the SIGCONT-withheld plant failing at that exact assertion, and M2 above reproduced it
   today. The file's own `:70-73` says so too, so the header contradicts itself. ℹ️ INFO —
   documentary; the substance is settled by measurement either way.
2. **Owner ruling `a3fc168` says *"Phase 16 keeps MR-04 open on this account"*, and
   `ROADMAP.md:985` repeats it; `16-VERIFICATION.md` attributes criterion 3 to **MR-07**
   (*"Dedupe measured; 'arriving late' not expressible"*), listing MR-04 as established for the
   aggregation path.** Both are defensible — `REQUIREMENTS.md` extended **both** rows with the
   identical closure paragraph, and the destination spec names its two cases `MR-04` and `MR-07` —
   but the ruling's singular attribution is narrower than what the ledger actually did. ℹ️ INFO.
3. **The instruction that prompted this amendment stated `16-VERIFICATION.md` contains zero
   occurrences of *"amend"*. It contains one**, at frontmatter line 45: *"or a ROADMAP amendment
   narrowing criterion 3 to the dedupe property that is measurable"* — i.e. the route this
   amendment did **not** take. ℹ️ INFO, and worth noting precisely because that line is the
   rewrite RULING A forbids: the criterion was scheduled instead, and it closes here on its
   original wording.

### Verdict

**Criterion 3 — MET.** The clause the owner carried is the clause the destination measured; the
destination's verdict was re-executed rather than read; the reading that carries it goes red when
the recovery is withheld; and the disposition it depends on goes red when the silent drop is made
loud. Criteria 1, 2 and 4 were MET on 2026-08-01 and their file was re-run green this pass.

**Score: 4/4 criteria.**

`status:` in the frontmatter above is **left at `gaps_found`**, and deliberately: the two
non-criterion gaps are still failed and still need an owner. The count this project keeps is over
criteria, and on criteria Phase 16 is complete.

---

## LEDGER EDITS RECOMMENDED (not applied)

A verifier does not apply the ledger edits it recommends. **Nothing below was edited by this pass**
— `.planning/STATE.md`, `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` were read only.
Note that `.planning/STATE.md` currently carries a **concurrent agent's uncommitted edit**; whoever
applies these should re-read it first rather than patching against what is quoted here.

**1. `.planning/ROADMAP.md` — progress table, the Phase 16 row (currently line 1139).**
Third column, from:

> 3 of 4 criteria — criterion 3's "arriving late" clause was not expressible on the build it was
> written against and was carried to Phase 20 criterion 6, **which is now MET**. No amendment has
> been written to `16-VERIFICATION.md`, and until one is this row does not move: a phase closes
> when a verifier says so

to:

> Complete — 4 of 4 criteria. Criterion 3 closed 2026-08-06 by a dated amendment to
> `16-VERIFICATION.md` after Phase 20 criterion 6 landed MET; the amendment re-executed the
> destination's evidence and planted two mutations, one of them novel. Two **non-criterion** gaps
> stay open and tracked, not scored: the tautological `CombineWork` key-set guard, and the absent
> `authorize` injection point on `FabricNodeOptions`

Second column stays `4/4` (it counts plans). Date column, from `2026-08-01` to `2026-08-06`.

**2. `.planning/STATE.md` — frontmatter `stopped_at` (line 6).** Two edits inside that one string:

- `THE COUNT STAYS 8 OF 15` → `THE COUNT IS 9 OF 15` (and the later
  `THE COUNT IS 8 OF 15 - 11, 12, 13, 13.1, 14, 15, 18 and 23 are closed` →
  `… 11, 12, 13, 13.1, 14, 15, 16, 18 and 23 are closed`).
- `16 (3/4), 17 (2/3), 19 (4/5), 20 (6/7) and 21 (2/3) are each verified and each UNCOUNTED on one
  criterion` → drop `16 (3/4), ` and read `17 (2/3), 19 (4/5), 20 (6/7) and 21 (2/3) …`.

**3. `.planning/STATE.md` — the uncounted-phases paragraph (around line 172).** From:

> **Six phases are verified and stay uncounted…**: 16 at 3/4, 17 at 2/3, 19 at 4/5, 20 at 6/7,
> 21 at 2/3 and **24 at 0/1**. Each has exactly one PARTIAL criterion, and each of those was
> **carried to a named destination rather than rewritten** — 16's to Phase 20 criterion 6, 17's
> and 19's to Phase 24 criterion 8, …

to **five** phases — 17, 19, 20, 21, 24 — removing `16 at 3/4` from the list and `16's to Phase 20
criterion 6` from the destinations clause, and adding, in the project's own voice, that **Phase 16
is the second proof that RULING A costs nothing in the end**: it sat at 3/4 for five days and
closed at 4/4 on the amendment that followed its destination criterion landing, exactly as Phase 18
did on 2026-08-04.

**4. `.planning/STATE.md` — line 31,** `now **six**: 16 (3/4), 17 (2/3), 19 (4/5), 20 (6/7), 21
(2/3) and **24 (0/1)**` → `now **five**: 17 (2/3), 19 (4/5), 20 (6/7), 21 (2/3) and **24 (0/1)**`.

**5. `.planning/REQUIREMENTS.md` — no edit.** MR-04 and MR-07 already record the arriving-late
closure and stay Partial on the demo half (WIRE-02, Phase 22). Ticking either would contradict its
own row text and would turn `acceptance-traceability.node.test.ts` red.

---
*Amended: 2026-08-07T01:22:14Z (2026-08-06 18:22 local)*
*Verifier: Claude (gsd-verifier), independent goal-backward re-verification after Phase 20 criterion 6*
*Working tree: `HEAD` `8d6ae20` at entry and exit; `rpc.ts` and `late-combine.node.test.ts` restored and `cmp`-verified; nothing staged, committed, stashed, reverted or branch-switched; the one entry in `git status --short` is a concurrent agent's `.planning/STATE.md` edit, untouched here*

---

## Amendment — 2026-08-19: both remaining `gaps:` entries close, and the score does not move

**Score: 4/4 criteria, unchanged.** Nothing above is retracted and no criterion verdict is
re-decided. What closes here is the two `gaps:` entries the 2026-08-06 amendment left open under
*"What this amendment does NOT close"* — the entries that are **not criteria** and that kept
`status:` at `gaps_found` while the criteria count stood at 4/4. One closes by **building** the
guard that was missing. The other closes by **withdrawing** a claim, because the repair its own
`missing:` line named first had already been rejected by an owner ruling that this pass found in
the tree and did not overrule.

The frontmatter's `score` is also corrected from `3/4 criteria met (1 partial)` to 4/4. That is
bookkeeping and not a movement: the 2026-08-06 amendment declared 4/4 in its body and left the
frontmatter unedited, saying so in its own words — *"The frontmatter above still reads `score: 3/4
criteria met (1 partial)`… and **only the first of those changes here**"*. It never did change.
`original_score` preserves the 2026-08-01 reading.

---

### GAP 1 — CLOSED by building the guard. Route 1 of its own `missing:`

**The superseded entry, quoted verbatim from the frontmatter above:**

> - truth: "A test fails the day `CombineWork` gains a field that could carry sovereignty"
>   status: failed
>   reason: >-
>     16-05-SUMMARY.md and `capability-authorizer.test.ts:194-197` both claim the
>     combine key-set case "stops compiling" if `CombineWork` grows a sovereignty
>     field, and that claim is the stated mitigation for the ruling clause 16-05
>     reported unmeetable. Mutation M2 falsifies it: adding `readonly ownerId?: string`
>     to `CombineWork` leaves `npx tsc --noEmit` at exit 0 and all 11 tests in that
>     file green. The assertion is a tautology — a three-element array literal
>     compared to itself — and `(keyof X)[]` stays satisfied when `X` gains a key.
>     Optional is the form this repository actually uses for sovereignty on a work
>     shape (`ports.ts:50-51`, `Task.label`/`Task.ownerId`, optional by a stated
>     decision), so the mutation is the realistic one, not a contrived one.
>   missing:
>     - "A guard that actually fails on an added optional field — e.g. an exhaustive mapped-type
>       check, or a runtime `Object.keys` assertion over a constructed `CombineWork` literal, in
>       the shape `combine-wire.test.ts` already uses for the frame"
>     - "Or: withdraw the claim from both the test comment and the summary, leaving the
>       unmeetable clause standing on its own without a mitigation it does not have"

#### What replaced it

`packages/net/src/capability-authorizer.test.ts`, inside *"has no reachable sovereign-combine
refusal on this build, and the wire is why"*. The two lines that were the tautology are gone. In
their place, both halves the `missing:` line offers, because neither is sufficient alone:

```ts
type EveryCombineKey = { readonly [K in keyof AuthorizedWorkCombine['combine']]-?: true }
const combineKeys: EveryCombineKey = { combineId: true, inputCids: true, level: true }
expect(Object.keys(combineKeys).sort()).toEqual(['combineId', 'inputCids', 'level'])
```

`-?` is written out rather than left to `Record<keyof X, true>` so the property does not depend on
a mapped type's homomorphism rule staying where it is. **Both forms were measured** in an isolated
file before either was written into the tree, under the repository's own flags (`--strict
--exactOptionalPropertyTypes --target es2023 --module esnext --moduleResolution bundler`): with
`readonly ownerId?: string` present, `{ [K in keyof T]-?: true }` and `Record<keyof T, true>` both
produce `TS2741`, and **the old `(keyof T)[]` form produces nothing at all**. With the field absent,
all three compile at exit 0. That last pair is the control that says the reddening below is the
field and not the rewrite.

#### PLANT A — the exact mutation that falsified the old claim, re-planted and watched go red

`packages/net/src/agent.ts`, `CombineWork` (`:94-98`) gains `readonly ownerId?: string`. Snapshot
taken **immediately before** the plant; `md5` `c3a131bda4243b52eefce2f91100bcfe`; `git diff -U0`
one hunk, one insertion.

```
$ npx tsc --noEmit
packages/net/src/capability-authorizer.test.ts(227,11): error TS2741: Property 'ownerId' is missing in type '{ combineId: true; inputCids: true; level: true; }' but required in type 'EveryCombineKey'.
EXIT=1
```

Verbatim, and it is the **only** error in the whole tree — which is itself the reading that says
the guard fired rather than the plant breaking something incidental. `EXIT=$?` was on the line
immediately after the command.

**The disclosure that comes with it, stated rather than left to be discovered.** With the same
plant still in place:

```
$ npx vitest run --project node packages/net/src/capability-authorizer.test.ts
Test Files  1 passed (1)      Tests  11 passed (11)
EXIT=0
```

**So this is a typecheck guard, not a vitest guard, and the gap's `truth:` wording — "A test
fails" — cannot be satisfied literally by anything.** `CombineWork` is a type; types are erased
before a runtime exists; no `expect` in any spec in this repository can observe a field being added
to one. The `missing:` line is the operative specification here and it names *"an exhaustive
mapped-type check"* first, which is what was built. The claim the tree now carries — in the test's
own comment and, corrected, in `16-05-SUMMARY.md` — is *"this stops compiling"*, and that claim is
now true and was watched being true. The old comment said the same words while the code under it
said nothing; that is the mismatch this closes.

The runtime `Object.keys` half is kept and its scope is written down beside it: it cannot see
`CombineWork` at all, only the witness, so what it holds is that nobody widens the witness to
satisfy `tsc` without moving the expected list with it. `tsc` guards the witness against
`CombineWork`; the assertion guards the list against the witness.

#### Restoration

Restored by the **surgical inverse** of the plant — the one added line deleted, not a `cp` of the
file — then:

```
$ cmp packages/net/src/agent.ts /tmp/o2-gap-plant/agent.ts.pre
EXIT=0
$ npx tsc --noEmit
EXIT=0
```

---

### GAP 2 — CLOSED by withdrawing the claim. Route 2 of its own `missing:`, and the verdict is that it is **not** a build

**The superseded entry, quoted verbatim from the frontmatter above:**

> - truth: "A deployment can refuse combines by supplying an authorizer that does"
>   status: failed
>   reason: >-
>     16-05's threat-flag states this as the mitigation that makes unconditional
>     admission acceptable. There is no injection point. `FabricNodeOptions` has no
>     `authorize` field and neither does the browser equivalent; `fabric-node.ts:764`
>     and `browser-node.ts:616` both hardcode `authorizeCapability(...)`, which
>     returns `null` for every combine at `capability-authorizer.ts:100`. No node this
>     repository can start — via `bin/agent.ts`, `FabricNode.start` or `BrowserNode` —
>     can refuse a combine. Only a direct `serveAgent` caller could, and no production
>     path is one. OWNER DECISION REQUESTED, see "Judgement on the two deviations".
>   missing:
>     - "Either an `authorize` option on `FabricNodeOptions`/`BrowserNodeOptions` so the claim
>       becomes true, or a correction to the threat-flag text so it stops claiming a control this
>       build does not offer"

#### The finding that decides it: the owner has already ruled, and ruled against the build

This pass was directed to treat GAP 2 as a build — an optional `authorize` on `FabricNodeOptions`
defaulting to today's `authorizeCapability({…})` expression — and to disagree if the reasoning was
wrong. **It is wrong, and the thing that makes it wrong is in the tree with a commit behind it.**

`packages/net/src/agent.ts`, inside `runCombine`, under the heading *"Why this hook and not a
second authorizer rule. Owner ruling 2026-07-31"*:

> The answer is not a sovereignty label on the wire that nothing would set, and **not an
> `authorize` override on the node factories that would reopen the door Phase 15 closed by
> hardcoding `authorizeCapability`**. A combine's inputs are the outputs of **public** map tasks —
> content-addressed, already public by construction — so there is nothing on this frame to
> authorize. What a peer can provoke is CPU and transfer, which is a **capacity** question…

`git log -L` puts that text in `3b54897`, 2026-07-31, *"feat(16-06): a combine takes a slot before
it fetches, and gives it back"*, whose message opens `Owner ruling 2026-07-31` and states the same
diagnosis this gap states — *"neither node factory exposes an `authorize` field. Nothing this
repository can start could refuse a combine, so the residue widened from unauthenticated nodes to
every node"* — and then names the answer it chose. **The gap and the ruling are about the same
sentence.** The ruling is one day older than the 2026-08-01 verification that wrote the gap, which
is why the gap could honestly say "OWNER DECISION REQUESTED": the decision existed and was not
found. It has been found now.

Three reasons it is a ruling about the *shape* of the option and not only about 16-06's problem, so
that it cannot be read narrowly and built around:

1. Its stated ground is general — a combine frame carries addresses and a tree position, so *there
   is nothing on it to authorize*. That is a statement about combines, not about amplification.
2. Its stated objection is to the option itself — *"would reopen the door Phase 15 closed"*. Any
   `authorize` override on a node factory reopens exactly that door, whatever it was added for.
3. The "nothing moves, it defaults to today's expression" argument is true of the **default** and
   false of the **option**. An `authorize` field typed as `Authorizer` admits `() => null`, which
   is strictly weaker than `authorizeCapability` on the *sovereign-exec* path — that authorizer's
   whole job is to refuse a sovereign exec with no chain. The option's reachable range is what a
   security control is judged on, not its default, and the range is the door.

**Verdict: GAP 2 is not a build.** Building it would have delivered a verifier's preference over a
recorded owner ruling. Route 2 of the gap's own `missing:` — *"a correction to the threat-flag text
so it stops claiming a control this build does not offer"* — is the honest close, and it is the
route the gap itself sanctions.

#### And the world moved after both readings were taken, which is why the *substance* also closes

The gap's own sentence — *"No node this repository can start … can refuse a combine"* — was true
on 2026-08-01 and true on 2026-08-06. **It stopped being true on 2026-08-11.** `1043772`
(*"feat(net): a node can say PAUSED — declining all work, not full and not gone"*) added SCHED-03
and put `combine` in `DeclinedWhilePaused` (`packages/net/src/agent.ts:194`), and
`FabricNodeOptions.paused` / `BrowserNodeOptions.paused` is a per-request thunk both factories pass
through at their `serveAgent` call. So a deployment **can** refuse a combine today. It simply does
not do it with an authorizer, which is precisely the clause being withdrawn.

That was not accepted from the source. It was measured, on a real node, and then planted against.

#### What was built: one case, in an existing file

`packages/node/src/admission.node.test.ts` gains
*"SCHED-03 — a deployment can refuse a combine, on the production factory"*. It sits directly
beneath that file's existing SCHED-06 combine case and borrows its rig deliberately, so the two
refusals are read by one instrument: `startNode` is the same `FabricNode.start` call `bin/agent.ts`
makes, the inputs are held by the client alone so `server.blockstore.fetched` reads what the frame
cost, and the reference root is computed in-process from the production `fabricCombiner`.

**No new `.node.test.ts` file, deliberately** — `slow-specs` does not drift and
`NODE_MEASUREMENT.files` needs no re-measurement.

One node gives both answers to one identical frame inside one run, through a thunk the test flips —
a second, un-paused node would have differed in peer id, store and port, any of which could have
been the thing that moved. Green reading:

```
✓ |node| packages/node/src/admission.node.test.ts > SCHED-03 — a deployment can refuse a combine,
  on the production factory > refuses a combine on a node its deployment paused, fetching nothing,
  and combines the identical frame once it un-pauses  533ms

Test Files  1 passed (1)      Tests  8 passed (8)
EXIT=0        real 9.96  user 3.61  sys 0.66   → (user+sys)/real 0.43
```

`0.43` is the spawn-and-socket profile this file legitimately has — it starts real `FabricNode`s
over tcp + noise + yamux and spends most of `real` waiting — and no verdict here rests on a
duration.

What the case reads, in order: the refusal arrives in the **combine reply shape** and not an
`error` frame; `resultCid` is null; the reason is `pausedRefusal(server.peerId)` **by text**,
against the one place that string is composed; it is *not* the at-capacity string, which is the
discrimination the state exists for; `server.blockstore.fetched` is **0**, so the refusal cost the
node nothing it was declining to spend; `server.admission.peakInFlight` is **0**, so it took no
slot on the way to refusing. Then the paired positive control in the same run: un-paused, the same
frame returns a CID that matches `canonicalCid(fabricCombiner([a, b]))` **bit-for-bit**, with
`fetched` at **2** — so the zero above is a reading of a refusal and not of a node that cannot
combine at all, which is the pre-16-05 defect this repository shipped for two milestones and did
not notice.

#### PLANT B — the injection point removed, and the gap's original state reproduced as a red test

The gap is about whether a **deployment** can reach the control, so the plant is on the factory and
not on the mechanism. `packages/node/src/fabric-node.ts:2715`:

```
      paused: options.paused ?? 'never-pauses',      →      paused: 'never-pauses',
```

i.e. the factory keeps the hook and stops honouring what its caller asked for — the precise shape
of *"there is no injection point"*. Snapshot taken immediately before the plant; `md5`
`3c5ca6c09d24eae2f6ffbc3911d720fb`; `git diff -U0` one hunk. Observed, verbatim:

```
× |node| packages/node/src/admission.node.test.ts > SCHED-03 — a deployment can refuse a combine,
  on the production factory > refuses a combine on a node its deployment paused, fetching nothing,
  and combines the identical frame once it un-pauses  637ms
  → expected CID(bafyreiavz2vd27fwoehe5ho2bvd7tmoar4iuni2bt5yimeozajvamunqia) to be null

AssertionError: expected CID(bafyreiavz2vd27fwoehe5ho2bvd7tmoar4iuni2bt5yimeozajvamunqia) to be null

Test Files  1 failed (1)      Tests  1 failed | 7 skipped (8)
EXIT=1
```

**That failure text *is* the gap.** With the deployment's control dropped, the node it asked to
stop combined anyway and answered with a real root CID — which is exactly what
*"no node this repository can start can refuse a combine"* looks like when it is written as an
assertion instead of as a sentence.

Restored by the **surgical inverse** of the plant, then:

```
$ cmp packages/node/src/fabric-node.ts /tmp/o2-gap-plant/fabric-node.ts.pre
EXIT=0
$ npx vitest run --project node .../admission.node.test.ts -t 'refuses a combine on a node its deployment paused'
Test Files  1 passed (1)      Tests  1 passed | 7 skipped (8)
EXIT=0
```

#### The text corrections, applied to `16-05-SUMMARY.md`

Both original sentences are **left verbatim** and marked with a dated correction beneath them,
rather than reworded — a summary edited until it agrees with the tree is not a record.

1. The threat-flag row's clause *"so a deployment can refuse combines by supplying an authorizer
   that does"* is withdrawn, with the owner ruling quoted, and replaced by what the build actually
   offers: capacity (`maxConcurrentTasks`, SCHED-06) and pause (`paused`, SCHED-03), both named with
   the case that measures them.
2. The Task-1 bullet *"a test asserts the combine arm's key set, so **it fails the day `CombineWork`
   gains a field that could carry sovereignty** — a failing test rather than a sentence in a summary
   nobody re-reads"* is corrected with M2's falsification, the replacement guard, and the verbatim
   `TS2741`, including the fact that it fires at `tsc` and not in vitest.

#### What this does **not** close, stated plainly

- **The literal clause is withdrawn, not made true.** No `authorize` option exists on either node
  factory and, by owner ruling `3b54897`, none is meant to.
- **There is no per-kind combine refusal on this build.** A paused node declines `exec`, `commit`,
  `combine` and `offer` together, and one `LocalCapacity` slot pool bounds combines and execs
  alike. A deployment cannot refuse combines while serving execs. The ruling's position is that
  this is correct — a combine's inputs are public by construction, so the question is capacity and
  not authorisation — but it is a narrowing of the original sentence and is recorded as one.
- **The fetch-amplification residue is unchanged.** `runCombine`'s own header still states that
  admission bounds *concurrency* and never *arrival rate*, and that an admitted combine still
  transfers. Nothing here widens or narrows that, and the 2026-08-01 pass's reading of it stands.
- **The one precise checkable thing, for an owner who disagrees with this verdict:** whether
  `3b54897`'s *"not an `authorize` override on the node factories"* was meant as a ruling on the
  option's shape or only as 16-06's choice of mechanism for fetch-amplification. This pass reads it
  as the former, for the three reasons listed above, and an owner who reads it as the latter should
  say so — GAP 2 would then reopen as a build, and the build is a one-line default plus the
  question of whether `Authorizer | 'serves-unauthenticated'` or bare `Authorizer` is the type.

---

### Regression check, and the runs that back it

Everything below was run on this branch, `feature/phase-20-checkpoint-agent`, with both plants
already restored and `cmp`-verified. **`EXIT=$?` on the line immediately after each command; no
pipes, no trailing `tail`, no `echo` on the same line.** `git add` was used between runs and never
during one, so `discover-arm.node.test.ts` and `bench-attestation.node.test.ts` saw a still index.

| # | Command | Result | `real`/`user`/`sys` → ratio | Exit |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | no output | — | **0** |
| 2 | eight-gate guard set — `requirements-ledger`, `acceptance-traceability`, `reachability-guard`, `vocabulary`, `mutation-guard`, `slow-specs`, `purity`, `disclosure-gate` | 8 files, 364 passed (364) | 6.40 / 7.01 / 1.57 → **1.34** | **0** |
| 3 | `/usr/bin/time -p npx vitest run --project node` — **first attempt** | 1 failed \| 196 passed (197); 1 failed \| 2961 passed \| 1 skipped (2963) | 639.50 / 721.24 / 115.36 → **1.31** | **1** |
| 4 | `/usr/bin/time -p npx vitest run --project node packages/node/src/admission-agents.node.test.ts` | 1 file, 6 passed (6) | 57.22 / 49.92 / 8.76 → **1.02** | **0** |
| 5 | `/usr/bin/time -p npx vitest run --project node` — **repeat, nothing changed between 3 and 5** | **197 files, 197 passed; 2962 passed \| 1 skipped (2963)** | 545.04 / 687.43 / 109.85 → **1.46** | **0** |
| 6 | `/usr/bin/time -p npx vitest run --project e2e` | **36 files, 232 passed (232)** | 854.59 / 446.46 / 85.58 → **0.62** | **0** |

**Against the baselines this pass was given** (all taken within the hour before it started):
`--project node` **197 files, 2961 passed, 1 skipped**; `--project e2e` **36 files, 232 passed**.
Run 5 reads **197 files, 2962 passed, 1 skipped** — file count identical, tests **+1**, which is the
one case added to the existing `admission.node.test.ts`. No new `.node.test.ts` file, so
`NODE_MEASUREMENT.files` in `vitest.config.ts` is untouched and `slow-specs` does not drift; the
guard's own reading of the file population is in run 2 and is green. Run 6 matches its baseline
exactly.

#### Run 3's single failure, attributed by measurement rather than by plausibility

```
FAIL |node| packages/node/src/admission-agents.node.test.ts > criterion 8 … >
     clause 1 — a spawned agent with no certificate holds no circuit through a gated relay,
     while an enrolled one does                                                     15588ms
AssertionError: member: … expected [] to have a length of 1 but got +0
 ❯ packages/node/src/admission-agents.node.test.ts:534:93
```

Four readings, and the diagnosis rests on the third and fourth rather than on the first two:

1. **No overlap.** This pass changed `packages/net/src/capability-authorizer.test.ts` and
   `packages/node/src/admission.node.test.ts`. The failing file is neither, imports neither, and
   the failing assertion is about a relay circuit arriving — nothing on the combine or authorizer
   path at all.
2. **It is the arrival half of a spawn-heavy case**, five child processes and a gated relay, and it
   was **slower** in the failing run than when it passed: 15 588 ms against 12 336 ms.
3. **"Passes in isolation" was run rather than asserted** (run 4) — and this repository's own rule
   is that this is a claim to check and not a diagnosis, so it is listed as corroboration only.
4. **The decisive one: the identical tree failed and then passed.** Runs 3 and 5 are the same
   commit, the same working tree and the same command, with nothing edited between them — run 5 is
   green at 197/197. A deterministic change present in both runs cannot be what distinguishes them.

**Host conditions, recorded because they are the alternative hypothesis and they check out.**
`uptime` on 8 cores: 16.14 entering run 3, 34.86 leaving it; 17.81 entering run 5, 59.68 leaving
it. `ps -Ao pcpu,comm -r` taken between the runs showed three
`transpilers/cpp-to-rust/…/test_c_corpus_parity` processes at **86.8 %, 84.4 % and 45.3 %** of a
core, plus `syspolicyd` 45.5 %, OneDrive 32.8 % and `XprotectService` 31.6 % — none of them this
repository's, and the same foreign process family the 2026-08-06 amendment above recorded as
ambient load on this host. **Nothing was signalled or killed.** `(user+sys)/real` was 1.31 on the
failing run and 1.46 on the green one, both inside this host's healthy band and neither near the
~0.9 starvation reading, which is why the *machine* load is offered as context and the *pair of
runs* is offered as the evidence.

**Recorded, not swept:** the case is timing-sensitive under contention. That is a pre-existing
property of `admission-agents.node.test.ts` and this amendment neither introduced it nor fixed it,
and it is written here so the next person who meets it has run 3 to compare against.

_Amended: 2026-08-19_
_Verifier: Claude, gap-closing pass on `feature/phase-20-checkpoint-agent`_
_Working tree: `HEAD` `e141620` at entry, clean. The guard and the case are `3f11901`, committed with
explicit paths and `git show --stat` read afterwards to confirm only those two files are in it. Both
plants were restored by the surgical inverse of the edit and `cmp`-verified at exit 0 before anything
was staged; `git add` was used between test runs and never during one. No `git stash`, `git checkout --`,
`git restore`, `git reset`, `git clean` or branch switch was run at any point._
