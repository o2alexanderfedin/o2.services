---
phase: phase-18-discovery-capacity-placement
plan: 06
subsystem: scheduling
tags: [discovery, placement, admission, capacity, multi-process, criterion-1, criterion-2]

requires:
  - phase: phase-18-discovery-capacity-placement/18-01
    provides: "`--peer-addr` and `--max-concurrent-tasks` on `bin/agent.ts` — the two flags this fixture drives"
  - phase: phase-18-discovery-capacity-placement/18-03
    provides: "`SelfRecordIndex` — every node answers `providers` from its own store, which is what makes D's silence meaningful"
  - phase: phase-18-discovery-capacity-placement/18-05
    provides: "`discoverCandidates` and `submitJob`'s offer arm — the two things under test"
provides:
  - "`packages/node/src/discovery-agents.node.test.ts` — criteria 1 and 2 across seven real `bin/agent.ts` processes"
  - "The first measurement that the peer gate and the certificate gate are INDEPENDENT: one fixture, two peer thunks, two different readings"
  - "Criterion 2b's exec-refusal re-pick asserted as an ABSENCE, so its unclosed half is a test rather than a sentence"
  - "A re-measured `MEASURED_NODE_SPANS` / `NODE_MEASUREMENT` — the recorded inventory had drifted to the edge of its own tolerance"
affects: [phase-18-discovery-capacity-placement/18-10, phase-18-discovery-capacity-placement/18-11]

tech-stack:
  added: []
  patterns:
    - "Two readings over ONE fixture to separate two gates: a file that used only the verified thunk would find `invalid-certificate` unreachable and report an intersection it never exercised"
    - "Read a precondition twice — before the placement and again after — when the thing holding it can lapse on a timer"
    - "Derive a deterministic probe order by CALLING the library's ordering functions, not by re-implementing the rule in the test"
    - "Assert an absence with its owner named, so an unclosed clause goes red the day somebody closes it"

key-files:
  created:
    - packages/node/src/discovery-agents.node.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/18-06-SUMMARY.md
  modified:
    - packages/node/src/bin/bench.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - vitest.config.ts

key-decisions:
  - "Saturation across a process boundary is a real held slot. `admission.node.test.ts` reaches into `busy.admission.offer(...)` on an in-process node; no test can do that to a spawned one, so the slot is occupied by a real `MODULE_NEVER_RETURNS` dispatch."
  - "The saturation precondition is read AFTER the placement as well as before, because the held task is ended by the node's own 10 s task deadline and a slower placement would have measured nothing while passing."
  - "The exec probe carries its OWN input block. A node's slot key is `inputCid:partitionIndex` and excludes the module, so a probe reusing the fixture's input meets the dedupe branch instead of the over-committed one."
  - "`MEASURED_NODE_SPANS` was re-measured rather than allowed to absorb one more file. The recorded inventory covered 120 files against a tree of 124; adding this one reached the stated tolerance of 5 exactly."

requirements-completed: [SCHED-01, SCHED-02]
duration: one session
completed: 2026-08-02
---

# Phase 18 · Plan 06 — A job placed from a CID, across real processes

**Closes criterion 1 and criterion 2.** Criterion 2b's second clause remains open and is
now asserted as an absence rather than described in prose.

## What was built

`packages/node/src/discovery-agents.node.test.ts` — seven spawned `bin/agent.ts`
processes and one in-process requestor:

| Node | Enrolled under | Holds the block |
|---|---|---|
| **P**, **P2** | — (`--issues-certificates`) | — |
| **A**, **B**, **C** | P | yes |
| **D** | P | **no** |
| **E** | **P2** | yes |

The requestor pins **P only**, holds no certificate of its own, dials all five
non-provider agents, and is handed **no executor list** — only one input CID.

Task 3 (`bin/bench.ts --discover`) landed earlier in commit `63f04b2`.

## The reading that would otherwise have been got wrong

The same fixture is queried twice, with two different peer thunks, and the two answers
differ:

| Thunk | `providers` | `executors` | `excluded` |
|---|---|---|---|
| `() => requestor.transport.peers` | **4** (A, B, C, E) | 3 | `['invalid-certificate']` naming E |
| `() => requestor.verifiedPeers` | **3** (A, B, C) | 3 | `[]` |

That pair is the whole point. The peer gate decides **who to ask**; `discoverExecutors`
decides **who qualified**. E fails the second even where it survives being named by the
first — and over the verified thunk it never reaches the second at all. **A file that
used only the verified thunk would find `invalid-certificate` unreachable in this
fixture and would report an intersection it never exercised.**

D is absent from *both* lists, and both halves are asserted, because "not in executors"
is also true of E.

## Proof that it measures

Three mutations, each planted, run, and reverted with `cmp` confirming the source
restored byte-identical:

| Mutation | Result |
|---|---|
| `submitJob` ignores `spec.admit` (no offer arm) | ❌ `expected [] to strictly equal [Array(1)]` — `rejections` empties |
| `discoverExecutors` stops calling `verifyCertificate` | ❌ `expected 4 to strictly equal 3` — E joins the executors |
| `verifiedPeers` returns the connected set | ❌ both tests — `four verified peers, saw 5` |

## Five defects in this plan, found while executing it

The three recorded before this session:

1. **`bin/bench.ts` has no `parseArgs`.** The plan said to add `discover: { type:
   'boolean', default: false }` to it. That file reads `process.argv.includes('--quick')`.
2. **The plan never mentions certificates.** `resolveCertificate` returns `null` when
   `enrollment` is undefined, which was every node the bench driver built — so
   `--discover` would have found **zero** candidates.
3. **The `'dispatches-unauthenticated'` count could not stay at 2.** `CandidateOptions.dispatch`
   is required, so 3 is unavoidable; holding it at 2 would have meant hoisting the
   literal and taking the count to 1, making the floor unreadable.

Two more found today:

4. **`ShardResult` has no `probed` field.** Task 2's proof says to assert
   `expect(placementProbed).toBeGreaterThan(1)` *"read from the shard's own record"*.
   `placeWithOffers` computes `probed`; `submitJob` drops it at the boundary and only
   `rejections` crosses. The assertion as written cannot compile. What replaces it
   carries the same claim through evidence that does survive: `rejections` names the
   busy node and `verification.agreeing` names a different one, so two nodes appear in
   one shard's record — which says more than a count would, because it says *which*.
5. **The plan's saturation technique can silently stop measuring.** `MODULE_NEVER_RETURNS`
   is ended by the node's own `DEFAULT_TASK_DEADLINE_MS` (10 s) and `bin/agent.ts`
   exposes no flag to move it. A placement slower than that deadline would find the busy
   node free, every later assertion would pass, and the block would measure nothing —
   the failure the seed's orphan-leash test shipped with for a day. The precondition is
   therefore read **twice**, and the post-check turns a silent pass into a loud failure.

## The first run failed, and the failure was worth having

The direct exec probe reused the fixture's input CID. A node's slot key is derived from
`inputCid:partitionIndex` and **does not include the module**, so the probe collided with
the held task's key and met the **dedupe** branch —
`…:0 is already in flight here` — instead of the over-committed one. Two different
refusals; only the second is what criterion 2b is about. The probe now carries its own
input block, and the comment records this as measured rather than as a precaution.

`admission.node.test.ts:296-303` chooses its own key to avoid the same collision from the
opposite direction. That note is what made the failure legible in one reading.

## What this does not close

- **Criterion 2b's second clause** — *a node at its execution slot limit refuses an
  `exec` request and the requestor re-picks*. `job/submit.ts` calls `executeVerified`
  exactly once per shard: no retry, no resample. Asserted as an absence.
  **WIRE-04 / Phase 20 criterion 1 owns the merge that would add a retry**, and the
  assertion goes red the day it lands.
- **The reach is directly-connected peers only.** `RpcRecordIndex` asks the peers it is
  handed and nothing further. No transitive routing, no DHT. A node this requestor never
  dialled is invisible to it however many blocks it holds.
- **Quorum membership and relay use remain unmeasured.** Dispatch candidate selection is
  gated on `verifiedPeers` here for the first time; the other two are not.

## A stale inventory closed on the way past

`NODE_MEASUREMENT` recorded 120 files against a tree holding 124 — four test files had
landed since it was taken without it being redone. `slow-specs.node.test.ts` tolerates a
drift of 5, so adding this file reached the limit exactly and the next file added to the
repository would have broken it. Re-measured rather than spent, which is what that
config's own comment asks for: *"a stale inventory is a worse failure than a noisy
span, since the inventory is what decides whether a file is excluded at all."*
