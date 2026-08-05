---
phase: phase-18-discovery-capacity-placement
plan: 10
subsystem: scheduling
tags: [sovereignty, placement, offers, criterion-5, no-production-change]

requires:
  - phase: phase-18-discovery-capacity-placement/18-05
    provides: "`placeWithOffers` and `submitJob`'s offer arm — the loop this plan measures"
  - phase: phase-18-discovery-capacity-placement/18-06
    provides: "the offer arm's production caller, without which criterion 5 on this arm would be a property of an uncalled function"
provides:
  - "`packages/core/src/sovereign-offers.test.ts` — the offer COUNT, which is the only place a sovereignty leak on the wire is detectable"
  - "Criterion 5 measured on the `planWithOffers` arm across real processes, beside the existing `planPlacement` proof"
  - "A stalled sovereign shard asserted as the CORRECT outcome under refusal, rather than described as one"
affects: []

tech-stack:
  added: []
  patterns:
    - "Count the offers, not only the outcome: a placer that asks bob and discards the answer has already leaked, and an outcome-only assertion passes it"
    - "When two files carry two halves of one claim, each says which half it holds — neither should be read as carrying the other"
    - "Read the far side's own store rather than the requestor's account of itself"

key-files:
  created:
    - packages/core/src/sovereign-offers.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/18-10-SUMMARY.md
  modified:
    - packages/node/src/sovereignty-placement.node.test.ts

key-decisions:
  - "NO PRODUCTION FILE CHANGED. The loop was already correct; the property was already unmeasured. A plan that edited source to make a test pass would have been fixing a defect that was not there."
  - "The pre-existing process case is left BYTE-IDENTICAL rather than refactored to share the new helper. It is what says the planPlacement arm did not move, and some duplication is the right price for that."
  - "The strong reading of 'a foreign node was never asked' lives in the kernel test. The offer branch reserves nothing, so across a process boundary a node that was asked and refused is indistinguishable from one never asked."
  - "The held saturating task carries a DIFFERENT input CID from the sovereign shard. Slot keys are `inputCid:partitionIndex` and exclude the module, so a shared input would make the shard meet the dedupe branch and the refusal read would be the wrong refusal."

requirements-completed: [SCHED-05]
duration: one session
completed: 2026-08-02
---

# Phase 18 · Plan 10 — Sovereignty survives the offer loop

**Closes criterion 5** on the placement arrangement a real job now takes. **No production
source changed, and that is the finding this plan reports.**

## What was actually at risk

Criterion 5 was already met on the `planPlacement` arm. `planPlacement` has no branch that
can widen under load — it orders an already-narrowed set, and there is nowhere for a
cheaper node to come from.

`placeWithOffers` adds a **loop**. A candidate refuses, it is dropped, the next `d` are
sampled from what remains. A loop that re-derived its pool from the full node list would
leak a sovereign shard onto a foreign node on the second pass — **and every pre-existing
assertion in this repository would still have passed**, because nothing else makes an
owner's node refuse.

The code was already right: `pool` is built once from `eligibleNodes` and only ever
shrunk, and the comment beside it says so. What was missing was any measurement of it.
`placement.test.ts` has four sovereign cases and none of them has an *eligible* node refuse.

## The two halves, and which file holds which

| | `sovereign-offers.test.ts` (kernel) | `sovereignty-placement.node.test.ts` (processes) |
|---|---|---|
| Reads | **the offer call list** | where the work ran, and did not |
| Can detect | a leak *on the wire* — bob asked and the answer discarded | only the outcome |

That distinction is the plan's sharpest point and is written into both files. **The offer
itself is the leak**: asking bob's node tells it that alice has a shard, and which shard,
even when the placement that follows is correct. Only a counted call list sees that, and
across a process boundary the offer branch reserves nothing — so a spawned node that was
asked and refused leaves exactly the trace of one that was never asked.

The process file's far-side reading is bob's own blockstore. Every agent starts with an
empty `--dir` and only the submitter holds the module, so a bob that executed anything must
have pulled the module over the wire to do it. `has(moduleCid)` on his own store, read
after his process is stopped, is a genuine reading from the far side.

## Proof that it measures

| Mutation | Result |
|---|---|
| `pool = [...nodes]` instead of `eligibleNodes(request, nodes)` | ❌ kernel: 4 of 5 fail, and the sovereign shard is visibly placed on `bob-1` / `bob-2`. ❌ processes: both new cases fail, `insufficient` becomes `agreed` |
| `eligibleNodes` returns `nodes` for an owner-less sovereign shard | ❌ `expected 'placed' to be 'unplaceable'` |
| the refuser is never dropped from the pool | ❌ the loop never terminates — no pass/fail line is printed at all |

Every mutated file restored and `cmp`-verified byte-identical. The pre-existing process
case stayed green under the first mutation, which is correct: it runs on the arm the
mutation does not reach.

## What this does not close

- **A sovereign job placed from `discoverCandidates`' own descriptors.** That path needs
  the shard's `ownerId` to be the owner's **user key**, because a discovery-derived
  descriptor carries `certificate.userKey` while this fixture uses the operator label
  `'alice'`. **Unmeasured, not descoped** — unifying the two is AUTH-05 / Phase 19's, and
  changing this fixture to a hex key would hide the seam rather than close it.
- Owner-domain attestation and replica sets — AUTH-05, VER-09, Phase 19.
