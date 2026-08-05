---
phase: phase-16-decomposable-tree-reduce-wiring
plan: 05
subsystem: auth
tags: [combine, AUTH-03, MR-03, MR-04, MR-05, MR-06, MR-07, gap-closure]
status: COMPLETE — the defect is removed, all three criteria measured, one criterion clause reported unmeetable
requires:
  - "16-01: fabricCombiner, the combine frames"
  - "16-02: runCombine, remoteCombineDispatch, reduceJob"
  - "16-03: the eight-process harness and its three skipped criteria"
  - "16-04: the benchmark reduce leg and its em-dashed real-transport table"
provides:
  - "packages/net: `AuthorizedWork`, a union over the work an `Authorizer` judges"
  - "a combine routed through `options.authorize` like every other request"
  - "MEASURED: Phase 16 criteria 1, 2 and 3 pass over eight/nine bin/agent.ts processes"
  - "MEASURED: the real-transport reduce table, populated for the first time"
  - "REPORTED: a sovereign combine is not expressible on this build, so one clause of the owner ruling is unmeetable without a wire change"
affects:
  - packages/net/src/agent.ts
  - packages/net/src/capability-authorizer.ts
  - packages/net/src/index.ts
  - packages/node/src/tree-reduce-agents.node.test.ts
  - packages/node/src/bin/bench.ts
  - .planning/BENCHMARK-RESULTS.md
tech-stack:
  added: []
  patterns:
    - "a hook widened to describe its work, rather than a value fabricated to fit the hook"
    - "the blocker test committed passing, so it goes red on the fix and is rewritten rather than deleted"
    - "a retired artifact note keeps what it used to say, so a changed figure is distinguishable from a replaced one"
key-files:
  created:
    - .planning/phases/phase-16-decomposable-tree-reduce-wiring/16-05-SUMMARY.md
  modified:
    - packages/net/src/agent.ts
    - packages/net/src/capability-authorizer.ts
    - packages/net/src/index.ts
    - packages/net/src/combine.test.ts
    - packages/net/src/capability-authorizer.test.ts
    - packages/net/src/capability-dispatch.test.ts
    - packages/net/src/admission.test.ts
    - packages/node/src/tree-reduce-agents.node.test.ts
    - packages/node/src/bin/bench.ts
    - .planning/BENCHMARK-RESULTS.md
    - .planning/bench/raw.json
    - .planning/phases/phase-16-decomposable-tree-reduce-wiring/deferred-items.md
decisions:
  - "`Authorizer` takes a union describing the work, not a fabricated `Task`. A combine has none of `Task`'s four required fields, so the alternative was inventing all four."
  - "The combine wire frame was NOT widened. Adding a label nothing sends would be a second dead surface beside AUTH-03's existing one."
  - "The three criteria were re-enabled, not rewritten. The blocker test was rewritten, because it asserted the defect."
metrics:
  duration: ~80 min
  completed: 2026-08-01
  tasks: 4
  commits: 4
---

# Phase 16 Plan 05: Route the Combine Through the Authorizer — Summary

**Every combine on every real node was refused. It is not any more, and Phase 16's three
criteria now run against eight real OS processes rather than sitting skipped.**

The gate is gone, the criteria are measured, and the benchmark's real-transport reduce
table is populated for the first time. One clause of the owner ruling turned out not to be
expressible on this build; it is reported rather than faked, and made into a test that
fails the day it becomes expressible.

## Task 1 — the gate is gone

`packages/net/src/agent.ts` used to answer any combine with
`'combine requires a capability chain this build cannot verify'` whenever `authorize` was
anything but the sentinel. It now calls the same hook the `exec` branch calls, before any
block is read, and turns a refusal into `unauthorized: <text>` in the combine reply shape.

### The one decision worth arguing about: what a combine presents to the hook

The ruling says to pass a *"`Task`-shaped value"*. **A combine has none of `Task`'s four
required fields.** It runs the fabric's fixed `fabricCombiner` rather than a module, reads
*many* inputs rather than one, and sits at a tree `level` rather than a `partitionIndex`
out of a `partitionCount`. Building a `Task` literal would have meant fabricating
`moduleCid`, `inputCid`, `partitionIndex` and `partitionCount` — and an authorizer that
later read `moduleCid` would be admitting or refusing on the strength of a CID naming
nothing. That is the defect class this repository hunts hardest, so the type widened
instead:

```ts
export type AuthorizedWork =
  | { kind: 'exec';    task: Task;           capability: readonly Delegation[] }
  | { kind: 'combine'; combine: CombineWork; capability: readonly Delegation[] }
```

`CombineWork` is the frame's own three keys and nothing else. `capability` is `[]` on the
combine arm **because the frame carries none**, which the type says in those words so it
cannot be read as "a chain was checked and found empty".

Cost, stated: this changes an exported interface. Blast radius was four files, all
mechanical — `authorizeCapability` narrows on `kind`, and three test files that either
built a request literal or captured one. **No assertion in any of them was weakened**;
`capability-authorizer.test.ts` gained an `execWork(task, chain)` helper so its five cases
read exactly as before.

### What was rejected, and why — including one option nobody proposed

| Option | Verdict |
|---|---|
| Open the gate unconditionally | Ruled out by the owner. Adds an unauthenticated surface with no chain check ever. |
| Move it to the `admission` hook | Ruled out by the owner. Admission answers capacity, not who may ask. |
| Fabricate a `Task` for the combine | **Rejected here.** Four invented fields, one of which names a module that does not exist. |
| **Widen the combine wire frame to carry `label`/`ownerId`/`capability`** | **Rejected here, and this is the one that would have satisfied the ruling literally.** See below. |

The wire option deserves its own line because it is the only thing that would make a
*sovereign* combine expressible. It was rejected on two grounds, either sufficient:
`protocol.ts` states that the combine frame is *"four keys, all of them addresses… a fifth
key is how a payload would arrive, so there is deliberately nowhere to put one"*, held by
an `Object.keys` guard; and **nothing in this repository would ever set the new fields**,
because no reduce path carries an owner (`reduce-job.ts`'s `contributorFor` explicitly is
*"not an owner id, and must not be read as one"*). It would have been a second surface
with zero production callers beside the one AUTH-03 already has — the exact shape the
owner called *"naming that is not fixing it"*.

## Task 2 — the three criteria, measured

`.skip` removed from all three. **Not one assertion was adjusted to make them pass.**

| Criterion | Result | This run | 16-03, gate opened locally |
|---|---|---|---|
| 1 — eight processes, one tree, bit-identical aggregate, one holder | **PASS** | 1495 ms | 1491 ms |
| 2 — SIGKILL mid-reduce, repaired elsewhere, reduce completes | **PASS** | 1518 ms | 1606 ms |
| 3 — two replicas dedupe, ninth process re-answer costs nothing | **PASS** | 2004 ms (9 agents) | 1867 ms |

Host load 4.10 on 8 cores, read before the run. 16-03's figures were taken against a
locally-opened gate that was never committed; these are against the committed fix, so the
agreement is independent rather than a re-read.

**The fourth test in that file was 16-03's blocker measurement, deliberately committed
*passing* so it would go red the moment the defect was fixed.** It did. It is rewritten to
assert what is now true, taking the same reading in the same place — a raw `combine` frame
against a spawned `FabricNode` — with only the expectation moved. It gained one assertion
16-03 could not make: the remote process's result is compared **bit for bit** against a
`fabricCombiner` reference computed locally, so *"stopped refusing"* cannot pass for
*"computed the right aggregate"*.

## Task 3 — the assertions that replaced the gate's

`combine.test.ts`'s single gate case became three, and the pair is the point: **the hook is
consulted** (a refusing authorizer refuses the combine, in its own words, with zero block
reads) and **the hook is obeyed** (an admitting authorizer gets a real combine, matching a
local `fabricCombiner` reference). Either alone is passed by a build that ignores
`authorize` on this branch. A third pins what the hook is *told*: the discriminated
`combine` arm carrying the frame's own three keys and no fabricated task.

`capability-authorizer.test.ts` gained the pairing the ruling asks for: **one**
`authorizeCapability` instance refuses a sovereign exec with
`'no pinned owner key for alice on this node'` — asserted by `toBe`, never by kind — and
admits a combine.

**The mutation ledger needed no change.** No entry's `find` text was invalidated;
`mutation-guard.node.test.ts` is green at 54, and it carries its own drift controls
(*"rejects an entry whose find text has disappeared"*), so green means every `find` still
matches exactly once rather than meaning the guard did nothing. 16-02's mutation test of
the deleted refusal lived in `combine.test.ts` itself, not in the ledger.

## Task 4 — the benchmark, with the run in the right order

**Pre-registration was honoured as an ordering**: `772a060` retires the note naming the
removed cause and asserts nothing about what the next run would show; `725410d` carries the
numbers. Two commits, in that order.

Full run 2026-08-01T06:09:01Z, **single-process driver** — every node in both curves lives
in one OS process on one event loop. The artifact says so in its own words and points a
reader at `tree-reduce-agents.node.test.ts` for the eight-process evidence.

Reduce tree — real transport, previously four em dashes:

| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |
|---|---|---|---|---|---|---|
| 1 | 13.5ms | 24.8ms | 2 | 5 | 0 | 1 |
| 2 | 23.3ms | 40.4ms | 2 | 5 | 0 | 2 |
| 4 | 23.7ms | 34.6ms | 2 | 5 | 0 | 3 |
| 8 | 24.1ms | 27.5ms | 2 | 5 | 0 | 4 |

`combine executors` rising 1→4 with the node count carries MR-05 on the real transport, not
only in memory. `tree depth` and `combines` stay constant across the ladder and the
artifact keeps warning, in three places, that a constant column is not a result.

The 16-node real rung stays excluded for its pre-existing ECONNRESET reason, published and
unchanged by this phase. **A rung that vanished would be indistinguishable from one removed
because its number was inconvenient**, so nothing was dropped.

### Why timings from a contended host are publishable here

Load was 6.77 on 8 cores when the run started — read, not assumed. That is not by itself an
argument, so it was **controlled for** rather than waved at: the memory makespan reproduces
16-04's published run within ~4% (22.4/44.6/44.5/45.8/44.9 ms against
23.4/45.2/45.3/45.6/44.9 ms) and the real makespan within ~8%, several rungs *faster*. Every
rung reads `n: 19, incomplete: 0`, so the incomplete-run exclusion is still working and no
run was dropped — a fast failure has not been recorded as a fast run.

**A derived figure that was NOT published:** the memory-to-real reduce ratio (roughly 10-20×)
is visible in the tables and is deliberately not computed into the artifact. It is a new
comparison, and pre-registering it belongs to a run that declares it in advance.

## The one thing the owner asked for that this build cannot do

> *"a sovereign one without a chain is refused by the same code that refuses a sovereign
> `exec`"*

**Not expressible, and therefore not asserted.** `authorizeCapability` reaches its refusal
rules through `task.label === 'sovereign'`. A combine cannot present that label, because
the combine frame carries no sovereignty field and — per Task 1 — adding one was rejected.
So the sovereign arm is **unreachable for a combine on this build, not permissive**.

Faking it would have meant either a custom Authorizer refusing for an invented reason and
calling it *"the same code"*, or a wire field nothing sets. Instead:

- `capability-authorizer.ts` carries the fact at the line that would change, in the form
  *"when the frame grows an owner, this is the line that changes"*;
- a test asserts the combine arm's key set, so **it fails the day `CombineWork` gains a
  field that could carry sovereignty** — a failing test rather than a sentence in a summary
  nobody re-reads;
- what *is* measured in its place: one authorizer instance refusing a sovereign exec by
  name and admitting a combine.

This is the honest half of the ruling. The other half — *"a public combine is admitted by
the existing path"* — is fully met, and is what unblocked everything else.

## Corrections to what I was handed

| Claim | Actual | Verdict |
|---|---|---|
| *"with whatever `Task`-shaped value a combine legitimately presents"* | A combine legitimately presents **no** `Task`-shaped value: it has none of the four required fields | **structurally wrong** — the hook widened instead |
| *"a sovereign combine with no chain refused by the shared path"* | Not expressible; the combine frame carries no sovereignty label and widening it was rejected | **unmeetable on this build** — reported, with a test that fails when it becomes meetable |
| *"`combine.test.ts` (around `:328`)"* | `:328` exactly | **correct** |
| *"16-02 mutation-tested it… check `mutation-ledger.ts` for any entry whose `find` text you invalidate"* | No ledger entry ever referenced the combine gate; 16-02's mutation lived in `combine.test.ts` | no ledger change needed |
| `agent.ts:293` for the gate | `:293` exactly | **correct** |
| `fabric-node.ts:764` / `browser-node.ts:616` install a real authorizer | both confirmed | **correct** |
| `capability-authorizer.ts:85` admits public work with no chain | `:85` exactly | **correct** |
| Phase 16 criteria timings 1491 / 1606 / 1867 ms | reproduced at 1495 / 1518 / 2004 ms | **confirmed independently** |
| `SHARDS = 16`, tree `nodes: 5, depth: 2` at 16 leaves | confirmed by this run's artifact | **correct** (16-04's correction holds) |
| *"`recomputes` reads 0 in the total-failure case"* | confirmed under the reverted-gate mutation | **correct** |
| *"seven sentinels"* | seven, in `combine.test.ts`'s `SENTINELS` | **correct** |
| The worktree has no `node_modules` and `@o2/*` are relative symlinks | both confirmed; farm built and proven | **correct** |
| *"plan `<verify>` blocks `cd` to the MAIN checkout"* | no PLAN.md exists for 16-05, so nothing to mis-`cd`; every gate run from the worktree root anyway | n/a |

## Deviations

### [Rule 4-adjacent] The `Authorizer` interface widened

Called out rather than buried. The owner ruled *what* to do (route the combine through
`options.authorize`); *how* was under-determined, and the only two options were widening an
exported interface or fabricating a `Task`. I took the widening because this repository
treats a value that names the wrong thing as a defect, and recorded the trade in
`AuthorizedWork`'s own docstring so the next reader does not have to reconstruct it. It is
a pre-1.0 sole-authorship repository with no external implementers of `Authorizer`.

### [Rule 1 — Bug] A stale comment in `runCombine`'s header

It read *"a node with a real `Authorizer` pays **zero** reads"* — true only while every
such node refused every combine. Corrected to name the refusing case, since an admitting
authorizer now pays the reads that bounds 1 and 2 of that header exist to cap.

### [Rule 3 — Blocking] No `node_modules`

Farm built: third-party absolute-linked into the main install, every `@o2/*` repointed
here, proven with `createRequire(...).resolve` + `realpathSync`. All seven `@o2` packages
resolve under this worktree; `vitest`/`typescript` come from the main install.

### Not a deviation, but worth stating

- **`REQUIREMENTS.md` was not edited.** The MR-03…MR-07 rows say *"wired at `bin/agent.ts`
  and `bin/bench.ts` via `reduceJob`"*, with the remaining gap named as WIRE-02/Phase 22.
  Those rows were arguably **false when written** — every combine on `bin/agent.ts` was
  refused — and this change makes them true. Nothing needed correcting; editing them would
  have risked the traceability guard for no gain.
- `STATE.md` and `ROADMAP.md` were not modified, as instructed.

## Deferred, not fixed

**16-04's liveness defect reproduced.** The full run wrote its artifact, completed every
leg, and the process was still alive afterwards with all its work done; it had to be
SIGTERMed. Recorded in `deferred-items.md` with two additions: symptom 1 survives this fix,
so the refused real-transport reduce was **not** what kept the loop referenced — a live
possibility while every combine on that ladder was failing, now ruled out; and symptom 2
(the multi-minute stall) did not appear at load 6.77, consistent with the contention
explanation already there. Still Phase 23's.

## Verification

Run against a resolver **proven** to read this worktree, never the main checkout:

```
OK   @o2/core   -> …/agent-a8fc0433c73cac2dd/packages/core/src/index.ts
OK   @o2/net    -> …/agent-a8fc0433c73cac2dd/packages/net/src/index.ts
OK   @o2/node   -> …/agent-a8fc0433c73cac2dd/packages/node/src/index.ts
     (7/7 @o2 inside the worktree; vitest + typescript from the main install)
```

| Gate | Result |
|---|---|
| `npx tsc --noEmit`, repository root | **exit 0** |
| `O2_UNIT_ONLY=1 vitest run --project node` | **1245 passed, 18 skipped, 0 failed** (88 files) |
| `vitest run --project browser` | **3051 passed, 0 failed** (204 files) |
| `vitest run --project node packages/net/src` | 220 passed |
| `mutation-guard.node.test.ts` | 54 passed |
| `vocabulary` + `purity` + `serve-agent-hooks`, run **after** committing | 45 passed |
| `tree-reduce-agents.node.test.ts` (8/9 real processes) | 4 passed |

**Count reconciliation**, so 1245 is a reading rather than a number: 16-04's baseline was
1237 passed / 18 skipped on a tree without 16-03's file. Add 16-03's four tests (1 blocker
+ 3 criteria, all now passing rather than 3 skipped) → 1241; add this plan's net +2 in
`combine.test.ts` and +2 in `capability-authorizer.test.ts` → **1245**. The 18 skipped is
the pre-existing baseline, unchanged: **no test was skipped to make this pass.**

### Watched failing first — every new assertion

Planted one at a time, restored with `cp` from a scratch baseline, each confirmed byte-exact
with `cmp` (exit 0). No `git checkout`, `restore`, `stash`, `reset` or `clean` was run.

| # | Mutation | File | Assertion turned red | Reading |
|---|---|---|---|---|
| A | the authorizer is consulted, its refusal ignored | `agent.ts` | combine refusal text | `resultCid` a CID, expected null |
| B | `unauthorized: ` reworded to `combine refused: ` | `agent.ts` | combine refusal text | `toBe` mismatch |
| C | the check moved **below** the read loop | `agent.ts` | zero-reads ordering | `gets` **0 → 2**, *text still green* |
| D | `authorizeCapability`'s combine arm refuses | `capability-authorizer.ts` | both new authorizer cases | `'combines are not admitted'` vs null |
| E | the old gate restored verbatim | `agent.ts` | **all four process tests** | criterion 1 at `expected +0 to be 3` |

Two of these are worth more than their row:

- **Under C the refusal-text assertion stayed green** while only the read count moved. That
  is the measured form of the claim the deleted gate's own comment made and never proved —
  *"moving the check below the loop passes the reason assertion above while failing this"*.
- **Under E criterion 1 failed at `expected +0 to be 3` on `outcome.combines`** — the
  identical failure 16-03 recorded against the unfixed tree, from a different agent on a
  different day. The criteria are gated on this fix and on nothing else.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| threat_flag: combine-admitted-unauthenticated-in-practice | `packages/net/src/agent.ts` | 16-03 raised the availability side of this and it is now closed. The confidentiality side it flagged is **not** closed and should not be read as such: because no combine can present as sovereign, `authorizeCapability` admits every combine, so a combine remains CPU spend a peer can provoke — beside the unauthenticated `exec` and `block` surfaces 16-02 already recorded. What changed is that it is now a **decision the authorizer makes** rather than a branch keyed on whether the node had one, so a deployment can refuse combines by supplying an authorizer that does. The general answer stays per-request admission (SCHED-06), not a bound invented for this branch. |

## Self-Check: PASSED

- `packages/net/src/agent.ts` — FOUND, gate absent **as code**. The first form of this
  check was written as *"no match for `capability chain this build` anywhere in
  `packages/`"* and **it failed**: three matches remain, all of them prose recording what
  was removed (`agent.ts:338`, `combine.test.ts:339`, `bin/bench.ts:884`), which is
  deliberate and is the opposite of a leftover. The claim is corrected to the one that was
  actually measured: `grep "reason: 'combine requires"` → **no match** (exit 1), and
  `options.authorize !== 'serves-unauthenticated'` appears **0 times outside comments** in
  `agent.ts`. Recorded rather than quietly reworded, because a self-check that is edited
  until it passes is not a check.
- `packages/node/src/tree-reduce-agents.node.test.ts` — FOUND, `grep 'describe.skip'` → no match
- `.planning/BENCHMARK-RESULTS.md` — FOUND, real-transport reduce rows populated
- `.planning/phases/phase-16-decomposable-tree-reduce-wiring/16-05-SUMMARY.md` — FOUND
- Commits `8558b59`, `ca07f88`, `772a060`, `725410d` — all FOUND in `git log 7a986e4..HEAD`
- `cmp` exit 0 for `agent.ts` and `capability-authorizer.ts` against scratch baselines
- `STATE.md` and `ROADMAP.md` — untouched (`git status` clean of both throughout)
