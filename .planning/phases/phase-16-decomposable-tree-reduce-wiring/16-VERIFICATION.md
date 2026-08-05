---
phase: phase-16-decomposable-tree-reduce-wiring
verified: 2026-08-01T06:30:00Z
status: gaps_found
score: 3/4 criteria met (1 partial)
overrides_applied: 0
verifier_host_load: "3.84–10.16 on 8 cores across the session; every reading below is pass/fail, never a timing bound"
gaps:
  - truth: "A test fails the day `CombineWork` gains a field that could carry sovereignty"
    status: failed
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
    status: partial
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
    status: failed
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
