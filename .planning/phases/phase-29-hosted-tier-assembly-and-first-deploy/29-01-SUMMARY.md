---
phase: 29-hosted-tier-assembly-and-first-deploy
plan: 1
subsystem: hosted-tier
tags: [cloudflare, durable-objects, owner-evidence, requirements-ledger, reachability, deploy]
requires:
  - .planning/phases/phase-29-hosted-tier-assembly-and-first-deploy/29-EVIDENCE.md
  - .planning/phases/phase-29-hosted-tier-assembly-and-first-deploy/29-REPORT.md
provides:
  - "criterion 1 recorded REFUTED and permanently unsatisfiable, by owner decision rather than by accident"
  - "criterion 2 MET IN FULL — evidence row 2 obtained by waiting, and the owner's answer discharging its one assumption"
  - "HOST-10 as the ledger's first Refuted row, and the seventh status word declared after the guard was watched refusing it"
  - "HOST-01 Not started -> Partial -> Done inside one day, entering and leaving the re-read register with both moves recorded"
  - "a title witness for HOST-01 in hosted-identity.test.ts, scoped in its own docblock to the mechanism and not the deployed half"
  - "Q6's prediction refuted a second time: the deploy happened and the unreachable count did not move"
affects:
  - .planning/REQUIREMENTS.md
  - .planning/STATE.md
  - .planning/HANDOFF.json
  - packages/node/src/acceptance-traceability.node.test.ts
  - packages/node/src/requirements-ledger.node.test.ts
tech-stack:
  added: []
  patterns:
    - "a vocabulary a ledger cannot express is widened by writing the word first and watching the guard refuse it"
    - "a status set is widened without widening what counts as delivered, because `delivered()` reads `startsWith('Done')` and nothing else"
    - "a requirement can get closer to true while becoming less machine-checkable, and that direction is recorded rather than scored as progress"
key-files:
  created:
    - .planning/phases/phase-29-hosted-tier-assembly-and-first-deploy/29-01-SUMMARY.md
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
    - .planning/HANDOFF.json
    - packages/node/src/acceptance-traceability.node.test.ts
    - packages/node/src/requirements-ledger.node.test.ts
decisions:
  - "HOST-10 is `Refuted`, not `Not started` and not `Partial` — the claim is an ordering that is now permanently false, not a claim behind schedule"
  - "HOST-01's box came on only after the OWNER answered; the reading alone was held as Partial for as long as its one assumption was open"
  - "The eviction reading was written into 29-EVIDENCE.md only once the owner had read it and discharged its assumption — never straight from an agent's measurement"
  - "The HOST-01 title witness is scoped in a docblock to the mechanism, so a reader cannot take it as covering the deployed or dialable halves"
  - "Phase 29's ROADMAP checkbox stays unticked even with criterion 2 fully met — criterion 1 is unrepairable, and the phases 20/21/22 precedent is verified-but-uncounted"
metrics:
  duration: ~70 min writing, plus a ~9 h idle interval the eviction reading needed
  completed: 2026-08-28
---

> ## Read this first — the file changed twice on the day it was written
>
> It was written while criterion 2 stood at **three legs of four**, and the missing leg — the
> identity surviving an eviction — was carried only by an agent-taken reading whose one
> assumption the owner had not yet discharged. `HOST-01` was `Partial` with its box off, and the
> reading was deliberately kept out of `29-EVIDENCE.md`.
>
> **The owner answered the same day: no manual deploy ran in that window.** So evidence row 2 is
> now filled, **criterion 2 is MET IN FULL**, and `HOST-01` is `Done` with a title witness.
>
> The body below is kept as written rather than rewritten, because the reasoning that held the
> box off is the record of how it came on. Where it says `Partial`, read it as the state that
> held for part of 2026-08-28. **Two things it says are still true and are the point**: the
> eviction was *observed, not forced*, and criterion 1 is still refuted, so **the phase still
> does not get its checkbox.**

# Phase 29 Plan 01: The Two Owner Acts, Closed From What They Actually Produced — Summary

The plan's five tasks were all owner acts. Tasks 1–4 were performed on 2026-08-27 and their
readings are in `29-EVIDENCE.md`. **Task 5 is what this file is**, and it does not say what the
plan's `must_haves` predicted it would say. The predicted sentence was *"HOST-01 and HOST-10 are
flipped."* Neither flipped, and both reasons are the plan's own Task 5 action — *"or report what
stayed open"* — doing its job.

## What the deploy settled

| Criterion | Verdict | What carries it |
|---|---|---|
| 1 — the alert precedes the first object | **REFUTED, permanently** | `29-EVIDENCE.md`: zero-object precondition confirmed at 2026-08-27T16:00:02Z, the object created at 16:00:29Z, no alert configured. Owner decision, taken with the consequence in front of him |
| 2 — dials, completes identify, same PeerId across eviction **and** redeploy | **three legs of four** | rows 1/1b/1c (control), row 3 (redeploy, marker moved `c89125c7…` → `83ebb81c…`, PeerId identical), row 4 (outside dial, identify completed). Row 2 — eviction — not obtained by the owner |
| 3 — DO storage through `interface-datastore` | MET | `cc7b728`, `12dacee` |
| 4 — exactly one call site may obtain a stub | MET, plant watched red | `hosted-tier-deploy.node.test.ts:190-240` |
| 5 — a preview-creating configuration fails a guard | MET, plant watched red | `:67-97` |
| 6 — closed `idFromName()` name set | MET, plant watched red | `:206-240` |
| 7 — NET-03 as a second route, not a closure | MET as a report | `REQUIREMENTS.md`, row unticked and worded that way |

## Criterion 1 — why the verdict is `Refuted` and not a softer word

The row asserts an **ordering**. The first Durable Object exists and its creation time is fixed,
so no alert configured afterwards makes the assertion true. *Not started* would be false — the
deploy happened. *Partial* means one leg reaches production while another does not, which is a
statement about progress and this is not behind schedule; it is false.

What the criterion was protecting is intact by other means, and that is worth separating from
the verdict rather than folding into it: measured cost ≈$5/month against a $15 budget (331,776
GB-s against 400,000 included), an alert can still be configured for its own sake, and the
structural half of the runaway-cost self-report — the preview multiplier — is closed
independently by `HOST-11`'s guard.

## Criterion 2 — the eviction leg, and the one reading this session took

The owner's four rows carry **dials**, **completes identify** and **same PeerId across a
redeploy**. Row 2 — the same identity across an *eviction* — was reported open, and the only
candidate lever was refuted (`wrangler`'s `evictDurableObject` is Miniflare's local-dev
simulator, not a lever over a deployed edge object).

**A reading taken on 2026-08-28 carries that leg's substance.** It is recorded here and
deliberately **not** written into `29-EVIDENCE.md`, whose rule is that every slot is a thing the
owner saw:

| | when (UTC) | `instance` | `peerId` | `version` |
|---|---|---|---|---|
| A | ≈09:30Z, this session's first live read | `f57ced1f-75fc-49d2-a2f9-8106b350c858` | `12D3KooWKm587f…rb7rsz` | `2.0.0-rc.4` |
| B | 18:21:13Z | **`8ac6c674-05ac-461b-ab3b-2c27f1bb0c4a`** | `12D3KooWKm587f…rb7rsz` | `2.0.0-rc.4` |
| control | 18:21:32Z, 18:21:33Z, 18:21:33Z | `8ac6c674…` ×3 | identical | identical |
| dial | 18:22:10Z | — | **`12D3KooWKm587f…rb7rsz`, IDENTIFY COMPLETED** | — |

**No deploy occurred between A and B.** The last `Deploy hosted node` run is `33157043966`,
2026-08-28T08:52:11Z, for `v2.0.0-rc.4` — read from `gh run list --workflow="Deploy hosted node"`,
and the workflow's only trigger is `release: published`. So the marker changed across an interval
containing **no redeploy**, which leaves eviction as the construction boundary, and the identity
crossed it unchanged. The three-read control is what makes the changed marker a construction
rather than read-to-read noise, and the dial is what carries the criterion's middle term on the
post-boundary instance rather than on a `/self` answer.

The dial was an ordinary `libp2p@3.3.6` Node peer — `webSockets` + `noise` + `yamux` + `identify`,
nothing Cloudflare-shaped — dialling
`/dns4/o2-bootstrap.af-4a0.workers.dev/tcp/443/tls/ws/p2p/12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz`,
with the remote peer read off the `peer:identify` event and never off the peer store — the peer
store is populated asynchronously and an empty read there is not evidence of anything. Agent
version `js-libp2p/3.3.6 browser/Cloudflare-Workers`, six protocols including
`/libp2p/circuit/relay/0.2.0/hop` and `/o2/kad/1.0.0`.

**The one assumption, stated rather than buried: no manual `scripts/deploy-hosted.sh --live` ran
in that window.** Only the owner can discharge it. `wrangler deployments list` would settle it
and needs account credentials this session does not have. Until he does, HOST-01 is `Partial`
and its box stays off.

**Two defects in this session's own procedure, recorded because they cost the reading precision.**
Reading A was not timestamped when it was taken, so its minute is reconstructed rather than read
— the interval is ≈8 h 50 m with only its lower end exact. And the reading was taken at all only
because the interval happened to exist; nothing scheduled it. A second observation of this leg
needs both fixed, or it will be the same reading with the same soft edge.

## The ledger, and the guard that had to be widened to say something true

`HOST-10` could not be expressed. `RECOGNISED_STATUSES` held six words and a status outside the
set fails by design — *"a status this set does not know is an unreviewed vocabulary change"*.

**The word was written into the ledger first and the guard watched refusing it**, which is the
plant this change is entitled to claim:

```
FAIL packages/node/src/acceptance-traceability.node.test.ts
     > uses only status words this join recognises
  + "HOST-10 at .planning/REQUIREMENTS.md:1877 reads \"Refuted\""
     1 failed | 46 passed (47)      EXIT=1
```

`Refuted` was then added with the reason. **It widens the vocabulary and not what counts as
delivered**: `delivered()` is `startsWith('Done')`, so a `Refuted` row's checkbox must stay off
exactly as a *Not started* row's does, and the `[x]`-iff-`Done` join scores the two identically.

`HOST-01` going *Not started* → **Partial** tripped a second guard — a `Partial` row must carry a
claim `requirements-ledger.node.test.ts` can read, or be recorded in the re-read register:

```
+ "HOST-01 is Partial and carries no claim this file can read, and is not recorded as such"
```

It went into the register at `because: 'experiment-not-run'`, `witnesses: []` — an empty set
**measured** on the day, no spec in `packages/**` or `tools/**` naming `HOST-01` in a title or
anywhere else — and `REREAD_REGISTER_CEILING` rose 3 → 4, the first raise after three consecutive
lowerings, by exactly the one entry that arrived.

That raise is the finding worth keeping: **`HOST-01` got closer to true while becoming less
machine-checkable.** Its open leg is not a symbol with no caller; it is an observation of a
deployed edge object that no in-process spec can force.

## Q6's prediction, refuted a second time

Task 5 requires the reachability register read back **against `29-RESEARCH.md` §Q6's stated
prediction**. §Q6 predicted: *"none of these 103 rows will close from any amount of further local
wiring. They close only when a real deploy makes the platform actually call these entry points."*

The deploy happened. The node is dialled from outside and answers on six protocols. **The count
did not move.**

```
unreachable exports: 103        (ceiling 103, guard EXIT=0, 35 passed)
of which packages/cloudflare/:   29
```

Measured directly with `unreachableExports(barrelExports(), buildCallGraph(), ROOT)`, not inferred
from the guard's `toBeLessThanOrEqual`. So §Q6's second half is wrong for the same reason its
first half was right, and `reachability-guard.node.test.ts`'s own closing sentence already said so
before the deploy: *"the tracer has no entry point for a platform."* A deploy makes the platform
call `fetch`/`alarm`/`webSocketMessage` at runtime and adds **no in-repo caller**, which is the
only thing a static walk can count. This is the third time a stated closing condition for these
rows has been satisfied exactly and left them where they were.

**The register's condition for the 29 cloudflare rows should stop being written as a deploy.** No
deploy closes them. What would is an in-repo driver — a spec that constructs the object and calls
its platform entry points directly — and that is a different piece of work from anything Phase 29
or 30 scopes.

## What this plan deliberately did not touch

`REQUIREMENTS.md`'s diff is **two rows**, per Task 5's verify. Four further rows are known stale
in the same table and are named here rather than fixed, so the correction arrives as its own dated
amendment instead of riding in on this one:

- **`HOST-05`, `HOST-08`, `HOST-11`, `HOST-12`** all read *Not started*, and all four are criteria
  3–6 above — met, with three of the four carrying plants watched red.
- **`NET-03`**'s row carries two clauses that the deploy falsified: *"nothing is deployed"* and
  *"the INBOUND half is not built"*. Row 4's outside dial completed identify, which is an inbound
  connection admitted.

`HOST-15` and `NET-11` are Phase 30's and stay as they are, though the listener they describe is
written and wired.

## Verification

| What | Result |
|---|---|
| `acceptance-traceability` + `requirements-ledger` | **EXIT=0**, 71 passed (71) |
| `reachability-guard` | **EXIT=0**, 35 passed (35) |
| the `Refuted` plant | watched red, 1 failed / 46 passed, EXIT=1, before the word was declared |
| the `HOST-01` register plant | watched red, named the row verbatim, before the entry was added |
| host conditions | quiet throughout — load/core 0.49–0.55 before and after every run, 8 cores, ceiling 4.00 |

## Phase 29's disposition

**The phase closes without its checkbox.** Criterion 1 is refuted and cannot be repaired;
criterion 2 holds on three legs of four. That is the phases 20/21/22 precedent — verified but
uncounted, the open criterion carried to a named destination rather than rewritten — and the
destination here is one owner confirmation, not a phase.

A criterion is not rewritten to let a phase close.

---

## Addendum, 2026-08-28 — the destination was reached the same day

The owner was asked whether he had run `scripts/deploy-hosted.sh --live` by hand between ≈09:30Z
and 18:21:13Z. **He answered no.** That was the whole of what criterion 2 was waiting on, so:

| | before | after |
|---|---|---|
| evidence row 2 | NOT OBTAINED | filled — `f57ced1f…` → `8ac6c674…`, one PeerId, ≈8 h 50 m, no deploy |
| criterion 2 | three legs of four | **MET IN FULL** |
| `HOST-01` | `Partial`, box off | **`Done`**, box on |
| re-read register | `HOST-01` entered, ceiling 3 → 4 | `HOST-01` left, ceiling 4 → 3 |
| title witness | none — `witnesses: []` measured | `packages/cloudflare/src/hosted-identity.test.ts` |

**The `[x]` needed a test naming the id**, which is the audit half of the ledger's rule, and the
id went into an existing describe title rather than into an exemption list — the same move
`28-04` recorded for `CRYPTO-04`. Its docblock states what the witness does **not** carry: the
block proves the identity comes from storage and survives a fresh construction, and nothing in
this process deploys or dials. That half is owner evidence and no test can hold it.

**Two limits travel with the tick and are written into the row rather than absorbed:**

1. **The eviction was observed, not forced.** The object went quiet and came back a different
   construction; nothing here makes that repeatable on demand. The forcing lever is still
   unverified with its one candidate refuted.
2. **The reading's own precision is soft at one end.** Reading A was never timestamped when it
   was taken, so the interval's lower bound is exact and its upper is reconstructed.

**Nothing else moved, and the phase still does not count.** Criterion 1 is refuted permanently —
the first object exists and its creation time is fixed — so the ROADMAP checkbox stays off for
the reason it was already off. What changed is which criterion is holding it there, and that is
worth saying plainly: it is no longer *"one confirmation away"*, it is *"one criterion that
cannot be repaired."*
