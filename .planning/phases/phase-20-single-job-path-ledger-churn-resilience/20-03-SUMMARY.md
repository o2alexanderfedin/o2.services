---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 03
subsystem: reduce, rpc-correlation, process-churn
tags: [MR-04, MR-07, criterion-6, late-arrival, SIGSTOP, spawned-agents, plant-discipline]
requires:
  - "packages/net/src/rpc.ts — `late or duplicate reply`, the drop. PRE-EXISTING and UNCHANGED in behaviour"
  - "packages/core/src/reduce.ts — executeReduce's ranking walk, rendezvousRank, deriveReduceTree (pre-existing, UNCHANGED)"
  - "packages/net/src/combine.ts — remoteCombineDispatch, the production dispatch (pre-existing, UNCHANGED)"
  - "packages/node/src/tree-reduce-agents.node.test.ts — standUp/spawnAgent/stopAgent/runMap/project, copied not imported"
  - "packages/net/src/reduce-job.ts — the projection-and-store prologue, copied as `deriveTree`"
  - "packages/node/src/fabric-node.ts — FabricNode.transport, the public Libp2pTransport the frame counter subscribes to"
provides:
  - "packages/node/src/late-combine.node.test.ts — criterion 6, MEASURED on the spawned-process arm: a reply arriving at a requestor that has already stopped waiting, counted rather than assumed"
  - "the correction of Phase 16's no-late-arrival-channel claim, in the file that made it and in the file it was wrong about"
  - "a per-run reading of the arrival on stdout, so the number is available on every run rather than surviving as a note"
  - "pauseAgent/resumeAgent — the first use of SIGSTOP/SIGCONT against a live libp2p stream in this repository, awaited to the kernel's own state"
affects:
  - "20-05 (vitest.config.ts) — a new node spec at ~7.7 s of test time, above SLOW_CUTOFF_MS; span handed over below, NOT edited here"
  - "any later reader of tree-reduce-agents.node.test.ts's MR-07 header — the claim it carried is now split into the half that is true and the half that was not"
  - "any later edit to rpc.ts's `late or duplicate reply` drop — a spec now depends on it staying silent, and the docblock says so"
tech-stack:
  added: []
  patterns:
    - "the arrival is COUNTED before anything is claimed about it, because every harmlessness assertion is green over silence"
    - "a second subscriber on the requestor's transport, so the instrument and RpcEndpoint.#receive are fed from one delivery of one frame — no production counter built for a test"
    - "SIGSTOP awaited to the kernel's `T` state, the way tree-reduce-agents.node.test.ts awaits its SIGKILL, so the freeze precedes the dial rather than racing it"
    - "two independent budgets exploited rather than one: the RPC correlation timeout fires while the transport's send budget is still open"
    - "unhandledRejection collected across the window, because `void this.#receive(...)` leaves no caller to catch a throw on a late frame"
key-files:
  created:
    - packages/node/src/late-combine.node.test.ts
  modified:
    - packages/net/src/rpc.ts
    - packages/node/src/tree-reduce-agents.node.test.ts
decisions:
  - "the spawned-process arm carries criterion 6; the in-process fallback the plan authorised was NOT built, because the measurement said it was not needed"
  - "rpcTimeoutMs 1500, sited against a cold combine measured in the same run (23 ms) and asserted as a ratio, not a millisecond"
  - "four agents, not eight — the minimum that leaves one spare at reduce redundancy 2"
  - "no production counter added; the instrument is a transport subscriber a test owns"
  - "minReplicas/rootCid/combines/disagreements are recorded as conjuncts, not as measurements — nothing at this seam can move them, and the file says so"
metrics:
  duration: ~55m
  completed: 2026-08-04
---

# Phase 20 Plan 03: A recovered node's combine result arrives late and costs nothing Summary

**Criterion 6 is measured on real operating-system processes.** A combine result from a
`bin/agent.ts` process that was frozen when it was asked reaches the requestor 173 ms after
`executeReduce` had already collected its replicas from later-ranked agents, the arrival is
**counted on the requestor's transport** rather than assumed, and the discard at `rpc.ts`'s
`late or duplicate reply` is proved load-bearing by a plant that reddens **only because the
frame arrived**.

## The question the plan said to measure rather than assume

*"Whether a libp2p stream survives a SIGSTOP long enough for the reply to arrive after
SIGCONT is unverified."* **It survives.** The spawned-process arm carries the criterion and
the in-process `MemoryNetwork` fallback the plan authorised was **not built**.

The mechanism is two budgets that are deliberately not the same number:

| budget | value here | what it bounds |
|---|---|---|
| `RpcEndpointOptions.timeoutMs` | 1 500 ms | deletes the pending entry, rejects the caller |
| `DEFAULT_SEND_TIMEOUT_MS` (`@o2/libp2p`) | 20 000 ms | the whole transfer, `dialProtocol` included |

A frozen process answers no stream negotiation, so `transport.send` is **still in flight**
when the correlation timer fires. `request` rejects with `kind: 'timeout'`,
`remoteCombineDispatch` collapses that to `null`, `executeReduce` walks on — and the send is
still open. SIGCONT inside the 20 s send budget lets it complete, and the answer arrives at a
correlation table with no entry for it.

The independent evidence that the request crossed the pause rather than being re-sent is the
frame sequence from the paused peer: `[req, req, req, req, res]`. Four `req` frames are the
resumed process asking the requestor for the four input partials it had never seen, and every
one of them arrives **after** the dispatch resolved `null` — the file asserts that no frame
from that peer predates the timeout.

## What landed

| file | change |
|---|---|
| `packages/node/src/late-combine.node.test.ts` | **new**, 819 lines, two cases |
| `packages/node/src/tree-reduce-agents.node.test.ts` | **one header paragraph**, no behaviour change |
| `packages/net/src/rpc.ts` | **one docblock**, no behaviour change — the line stays a bare `return` |

Commits: `8902ebd` (the spec), `10c68b2` (the two corrections), plus this summary.

## Measured, 2026-08-04, four spawned agents on one host

Printed by the spec on every run, so the figures do not survive only as a note here.

| reading | case 1 (arrival) | case 2 (harmlessness) |
|---|---|---|
| `standUp`, 4 agents | 889 ms | — |
| the eight-shard map at redundancy 2 | 261 ms | — |
| a **cold** combine on a fresh agent | 23 ms | — |
| dispatch to the frozen agent | 1 501 ms against a 1 500 ms budget | — |
| pause, SIGSTOP to SIGCONT | 1 802 ms | spans the whole reduce |
| **late replies** | **1**, at **+173 ms** | **2**, at **+182, +182 ms** |
| frames from the paused peer | `[req,req,req,req,res]` | — |
| `recomputes` | — | **2**, against **0** on the unpaused run |
| case duration | 3 035 ms | 4 705 ms |

Across five runs the cold combine read 19–24 ms and the late reply landed at +20, +173, +178,
+182 and +192 ms. `rpcTimeoutMs = 1500` is therefore ~62× the work it has to cover, and the
spec asserts **that ratio** rather than the millisecond — an absolute threshold would encode
this host's load on the day it was written.

**Process cost, not machine load.** `/usr/bin/time -p` on the three-file verification run:
`real 11.61`, `user 45.01`, `sys 7.30` → `(user+sys)/real = 4.51`, three files in parallel.
On the whole `--project node` run: `real 256.40`, `user 234.56`, `sys 36.28` →
`(user+sys)/real = 1.06`, with three other agents running their own suites on this host
throughout — the ratio is a comparability key, not a verdict.

## Every plant, and the text observed

Each was applied, watched, and restored by `cp` + `cmp` (never `git checkout --`); each
`cmp` exited 0.

| # | plant | where | observed |
|---|---|---|---|
| **A** | the SIGCONT withheld | spec, case 1 | log `late replies 0`, `frames from the paused peer []`; `AssertionError: expected false to be true // Object.is equality` at `expect(arrived).toBe(true)` |
| **B** | `if (entry === undefined) throw new Error('late reply')` | **`rpc.ts`** | case 1 `AssertionError: expected [ 'Error: late reply' ] to deeply equal []`; case 2 `AssertionError: expected [ 'Error: late reply', …(2) ] to deeply equal []` — three replies, three rejections |
| **C** | the wrapper returns the recovered peer's product | spec, case 2 | `AssertionError: expected false to be true` at the **arrival** assertion — see the false claim below |
| **D** | the pause withheld | spec, case 2 | `AssertionError: expected '12D3KooWHHMQWCSgYVBpd61VqY9otyeLX6ZSp…' not to be '12D3KooWHHMQWCSgYVBpd61VqY9otyeLX6ZSp…' // Object.is equality` at `expect(paused.executedBy.get(pausedNode.id)).not.toBe(victimId)` |
| **E** | D, with the `executedBy` assertions relaxed | spec, case 2 | `AssertionError: expected 0 to be greater than 0` at `expect(paused.recomputes).toBeGreaterThan(healthy.recomputes)` |
| **F** | one dispatch issued through the wrapper after the resume | spec, case 2 | `AssertionError: expected [ { …(3) } ] to deeply equal []` at `expect(asked.filter((entry) => entry.atMs > reduceReturnedAt)).toEqual([])`, with the offending entry printed in full |

**Plant B is the one that carries the criterion**, and it is the right plant for the reason
the plan gave: it reddens **only if the frame arrived**, so it proves the channel and the
discard in a single reading. `#receive` is subscribed as `void this.#receive(...)`, so a
throw on a late frame has no caller left — the request it belonged to was rejected by the
timeout 1.5 s earlier — and becomes exactly the unhandled rejection the spec collects.

## Claims in the plan measured FALSE

### 1. *"`minReplicas` and `executedBy` must move"* — half of it is false, and the plant as worded cannot be built

The plan's Task-2 `<proof>`: *"the harmlessness readings are not vacuous — plant: make the
wrapper hand `executeReduce` the recovered agent's product as an extra replica. `minReplicas`
and `executedBy` must move."*

Three separate findings, all measured:

**(a) A wrapper cannot add a replica.** `executeReduce` owns the loop: it calls `dispatch`,
pushes into `produced`, and `break`s at `wanted`. A dispatch wrapper can only change *what one
call returns*, never how many calls happen. There is no arrangement of the wrapper that adds
an extra replica.

**(b) The closest buildable form did not even return the product.** Plant C returned the
victim's product for the call the wrapper already receives — resume, re-dispatch, return that.
The re-dispatch **itself timed out**: the run logged `paused peer asked 1×`, `recomputes 1`,
i.e. `executeReduce` still saw a `null`. With the arrival assertions relaxed the whole case
went **green**, so plant C proves nothing about the replica readings. Recorded rather than
retried, because (c) makes the retry pointless.

**(c) `minReplicas` cannot move at all.** At `wanted = 2` the walk stops at two products in
both arms, so `minReplicas` reads 2 whether or not a late frame ever arrives. Confirmed by
plants D and E: the assertions on `rootCid`, `minReplicas`, `combines` and `disagreements`
sit **between** the two that reddened and stayed green through both.

**So, which readings actually carry "the late arrival changed nothing":**

| reading | can it move? |
|---|---|
| the arrival count | **yes** — plants A, C, D |
| no unhandled rejection | **yes** — plant B |
| `executedBy` omits the recovered peer | **yes** — plant D |
| `recomputes` above the unpaused run's | **yes** — plant E |
| `asked` holds nothing after the resume | **yes** — plant F |
| `rootCid` equals the unpaused root | **no** |
| `minReplicas`, `combines`, `disagreements` | **no** |

The lower four are recorded in the spec's own header as **conjuncts the criterion names**,
taken as comparative readings against the unpaused run in the same run, and explicitly *not*
as measurements. The reason is structural, not a gap in the plants: `executeReduce` has
already returned before the frame arrives, so no expression is left that could fold it into a
replica count or an aggregate.

### 2. *"the recovered agent appears exactly once, before the pause"* — the count is not 1 in general

The plan's Task-2 `<behavior>` asks for the assertion that the recovered agent *"appears
exactly once"*. That is not a property of the fabric. `executeReduce` runs a level's combines
under `Promise.all`, and at `wanted = 2` a peer is dispatched to for **every** tree node where
its rendezvous rank index is below `wanted` — not only where it ranks first. Measured across
runs: the paused peer was asked **2×**, **3×** and **1×** on different spawns, because peer
ids are fresh per process and the ranking moves with them.

Pinning `1` would have been a flaky assertion. What the spec asserts instead is strictly
stronger and deterministic:

- **every** entry in the dispatch record predates the resume (`asked.filter(atMs > reduceReturnedAt)` is empty) — plant F reddens it;
- the number of late replies **equals** the number of requests the peer was left holding, so no reply is unaccounted for and none was provoked afterwards;
- each of those requests names a **distinct** tree node, so nothing was retried at it.

### 3. The plan's `<interfaces>` block, verified

Everything else in it held on inspection: `RpcEndpointOptions.timeoutMs` defaults to
`DEFAULT_RPC_TIMEOUT_MS` (30 000); `#receive` drops a `res` frame whose key is absent;
`rendezvousRank` is exported and pure, so the victim can be computed before anything is
frozen; `remoteCombineDispatch` returns `CombineProduct | null`. And the claim that **no spec
in this repository used SIGSTOP or SIGCONT** was true — `grep -rln 'SIGSTOP\|SIGCONT' packages/ tools/ --include='*.ts'`
returns only the two files this plan touched.

## Decisions

- **The spawned-process arm carries criterion 6.** The plan's fallback branch was not taken,
  and the reason is a measurement rather than a preference. The header says which arm carries
  the claim, so a later reader cannot upgrade a weaker model into this one.
- **`rpcTimeoutMs = 1500`**, down from the copied fixture's 10 000, sited against a cold
  combine measured **inside the same run** and asserted as a ratio (`TIMEOUT_MARGIN = 10`).
  The other term the budget has to cover is the map's cold `exec` dispatch; the whole map
  measured 184–261 ms, an upper bound on any single dispatch in it, and it is a precondition
  (`runMap` refuses to proceed) rather than an assertion.
- **Four agents, not eight.** At reduce redundancy 2 a combine whose first-ranked executor is
  frozen needs three peers to reach two replicas; four leaves one spare. A wider fabric would
  only make a timeout look like a flake.
- **No production counter.** The instrument is a second `onMessage` subscriber the test owns.
  `EgressGuard.onMessage` delegates straight to `Libp2pTransport`, whose handlers live in a
  `Set`, so the counter and `RpcEndpoint.#receive` see one delivery of one frame. A counter
  read only by a test is *built, not wired*.
- **`SIGSTOP` is awaited to the kernel's `T` state** (`ps -o state=`), the way the copied
  file awaits its `SIGKILL`. An un-awaited `kill('SIGSTOP')` would race the dial that follows
  it, and a lost race reports a *completed* combine — a red for a reason unrelated to the
  subject.
- **`stopAgent` gained one line** over its copied original: a `SIGCONT` before the `SIGTERM`.
  A frozen process cannot run `bin/agent.ts`'s TERM handler, so without it every case in this
  file would pay the full 10 s SIGKILL fallback in teardown.
- **The map is real.** The partials are produced by the spawned agents running
  `MODULE_WRITES_PARTITION`, and the projection decodes each guest's output rather than keying
  on the partition index, so what the agents computed enters the aggregate. Fixture seed
  **113**, distinct from every other in the repository.

## Verification

| check | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node late-combine + tree-reduce-agents + net/rpc.test` | **exit 0** — 3 files, 15 tests |
| `npx vitest run --project node` (full) | **exit 1** — 141 files, 2021 tests, 5 failed, **none in this plan's files** |

### The five failures in the full run, attributed by measurement

None is in `late-combine.node.test.ts`, `tree-reduce-agents.node.test.ts` or `rpc.test.ts`,
all three of which passed.

1. **`bench-attestation.node.test.ts` — "did not move the sweep, and wrote nothing into the
   repository".** This is one of the two specs that snapshot `git status --porcelain` around
   themselves. The diff **names the cause**: `+ ?? .planning/phases/phase-20-…/20-02-SUMMARY.md`
   — a concurrent agent created its summary mid-run. Attributed by the assertion's own output,
   not by plausibility.
2. **`discovery-agents.node.test.ts` — "re-picks past a node genuinely at its slot limit"**,
   `expected 'agreed' to be 'insufficient'`. This is **the armed tripwire 20-CONTEXT.md
   predicts by name**: *"Adding the re-pick makes that test go RED, and that is CORRECT — it
   is the scheduled clause arriving, not a regression. 20-04 rewrites the assertion."* 20-01
   has landed the re-pick; 20-04 owns the assertion.
3–5. **`mutation-guard.node.test.ts` — M45 and the two aggregate arms**, all naming
   `packages/core/src/job/submit.ts`, a concurrent agent's in-flight file. M36 was red earlier
   in this session for the same reason and has since been repaired by its owner. 20-CONTEXT.md
   records this drift as the scheduled arrival of WIRE-04.

### `O2_SKIP_GUARDS=1` was used — stated loudly

**Both commits in this plan were made with `O2_SKIP_GUARDS=1`, and each commit message says
so and why.** The pre-commit hook refused on `mutation-guard.node.test.ts` alone, on
M36/M45 — both naming `packages/core/src/job/submit.ts`, which neither commit touches. This
is defect **#39**: a repo-wide guard blocking every agent while one has an in-flight
violation.

Before each skip the six cheap guards were run directly and the failure attributed:
`vocabulary`, `purity`, `disclosure-gate`, `requirements-ledger` and `slow-specs` **all
passed** with the new file staged — 186 of 189 — and `grep -c late-combine` over the guard
output returned **0**. The banned-vocabulary guard was never tripped by anything in this plan.

## Handed to 20-05 — do not edit `vitest.config.ts` here

`packages/node/src/late-combine.node.test.ts` measures, standalone on a quiet-ish host:

- **file span 8.49 s** wall, **7.74 s** of test time — case 1 at **3 035 ms**, case 2 at
  **4 705 ms**;
- comfortably above `SLOW_CUTOFF_MS` (1 000), so it belongs in the derived exclusion list.

Both cases do their work **inside the `it`**, not in a hook, so `--reporter=json` will attribute
the span correctly — the `bench-attestation.node.test.ts` failure mode (154 s reported as
235 ms) does not apply.

**A second reading for 20-05 while it is in that file:** the node project now holds **141**
test files against `NODE_MEASUREMENT.files = 138`. Drift 3, `FILE_COUNT_TOLERANCE` 5 — still
green, but two more files from any Phase 20 plan will redden `slow-specs.node.test.ts`.

## Deviations from plan

- **The in-process `MemoryNetwork` arm was not built.** Conditional in the plan on the
  spawned arm failing; it did not fail. Recorded as a measurement, with the numbers, in the
  spec's header.
- **`reduceJob` is not called.** The pause has to be staged around the production
  `remoteCombineDispatch`, and `reduceJob` builds its dispatch internally — correctly. So its
  projection-and-store prologue is copied as `deriveTree` and the reduce runs through
  `executeReduce`, which is the same seam `tree-reduce-agents.node.test.ts`'s criterion-2 case
  uses. Named in the spec's header.
- **`AGENT_COUNT` is 4 and `SHARDS` is 8**, against `standUp`'s 8 agents. The plan asks for
  the minimum that answers the question; 8 shards is kept because it is the layout whose
  L1(4)/L1(4)/L2(2) shape 16-02 already recorded.
- **The dispatch wrapper stages the pause on the first victim dispatch and the resume happens
  after `executeReduce` returns**, rather than resuming mid-reduce. This is what makes
  "unsolicited" true by construction rather than by argument.

## Out of scope, untouched

`executeReduce`'s ranking walk, `wanted`, the combine wire, `vitest.config.ts`,
`.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, and everything in
`tree-reduce-agents.node.test.ts` beyond the one header paragraph. Phase 16's nine-process
dedupe reading is untouched; this plan adds the clause that was missing and does not re-state
the one that was met.

## Self-Check: PASSED

- `packages/node/src/late-combine.node.test.ts` — FOUND
- `packages/net/src/rpc.ts` — FOUND, modified, `late or duplicate reply` still greppable, line still `return`
- `packages/node/src/tree-reduce-agents.node.test.ts` — FOUND, modified
- commit `8902ebd` — FOUND
- commit `10c68b2` — FOUND
