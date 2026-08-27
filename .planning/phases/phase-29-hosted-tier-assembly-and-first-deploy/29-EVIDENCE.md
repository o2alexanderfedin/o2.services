---
phase: 29-hosted-tier-assembly-and-first-deploy
captured_by: owner
status: empty
criterion_1: OPEN
criterion_2: OPEN
---

# Phase 29 — the owner's captured evidence

**This file is a skeleton with empty slots. It is the artifact `29-01-PLAN.md` names, and
Phase 29 stays `partial` with criteria 1 and 2 reported OPEN until the slots hold readings.**

Nothing in this file may be filled in from a locally-done run, an inference, or a plausible
value. Every slot is a thing the owner saw. An empty slot is a better result than a guessed one
— it is the difference between a criterion that is open and a criterion that has been widened.

---

## Criterion 1 — the billing alert precedes the first object

### Timestamp A — the alert's configuration

```
threshold configured:
timestamp A:
captured how:            (screenshot / API response / dashboard log — say which)
```

### Timestamp B — the deploy that created the first object

```
version ID:
timestamp B:
captured how:
resulting host:          <name>.<subdomain>.workers.dev
```

### The check, performed once

```
A < B ?
checked on:
```

**If B precedes A, criterion 1 is refuted and no wording repairs it.** That is the refutation
the criterion names, and it is why the alert comes first.

---

## Criterion 2 — four readings, one PeerId

The cheap reading is `GET /self` (`worker.ts:232-247`), which answers from the seed in the
object's storage rather than from the isolate. **It alone does not satisfy the criterion** — the
criterion says *dials, completes identify, and gets the same PeerId*, and only the outside dial
carries that. Both columns are filled for each row.

| # | When | `curl /self` → peerId | outside dial → resolved remote peer | interval / event |
|---|---|---|---|---|
| 1 | fresh, right after deploy | | | — |
| 2 | after an eviction | | | interval: |
| 3 | after a redeploy | | | version ID: |
| 4 | confirming re-read | | | interval: |

```
all four identical?
dialled from:            (machine / network — the outside peer is the point, so name it)
multiaddr dialled:       /dns4/<host>/tcp/443/tls/ws/p2p/<peerId>
```

**How an eviction is forced is UNVERIFIED.** If the answer was waiting rather than a lever,
write the wall-clock interval in the row and say it was a wait. A reading after an unmeasured
interval is not a reading.

---

## The prediction, checked after the deploy

`29-RESEARCH.md` §Q6 names which reachability rows this deploy should move. Read the register
afterwards and record the outcome here **against that list**, not as a fresh explanation.

```
rows predicted to move:
rows that moved:
rows that moved unpredicted:     (a finding, if any)
```

Two further things only this deploy can settle, both reported rather than simulated:

```
an alarm survives an eviction and fires on a fresh instance?
this configuration dials and is dialled?
```

---

## What happens when this file is filled

The evidence closes the loop: criteria 1 and 2 tick, `29-01-SUMMARY.md` is written from these
readings, and Phase 29 leaves `partial`. Nothing else in the phase is waiting on anything.
