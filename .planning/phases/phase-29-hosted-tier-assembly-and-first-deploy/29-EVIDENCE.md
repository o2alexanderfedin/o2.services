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

## Precondition — the namespace holds zero objects

**Checked immediately before the alert, and criterion 1 is meaningless without it.** The
criterion is about the alert preceding **the first** object. An object created by any earlier
act makes it permanently unsatisfiable, and nothing done later repairs that: an object's
location is fixed by its very first `get()` and the only repair is a new name.

`29-REPORT.md`'s Envelope recorded zero namespaces days ago. That is a fact to re-confirm, not
one to inherit.

```
what was inspected:      (name the BOOTSTRAP namespace specifically — the three
                          ocr-checks-worker* production scripts are not the subject)
instances found:
checked on:
```

**If it is not zero, stop.** The honest outcomes are to report criterion 1 unsatisfiable with
the reason, or to site the first object under a fresh name from the closed enumeration. Neither
is decided by filling this file in.

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

| # | When | `curl /self` → `peerId` | → `instance` | outside dial → resolved remote peer | interval / event |
|---|---|---|---|---|---|
| 1 | fresh, right after deploy | | | | — |
| 2 | after an eviction | | | | interval: |
| 3 | after a redeploy | | | | version ID: |
| 4 | confirming re-read | | | | interval: |

### The `instance` column is the one a plan check added, and why

**Without it these four rows cannot tell "survived an eviction" from "was never evicted."** Two
readings of a live object give the same PeerId trivially, and the table would fill in completely
having exercised nothing. `instance` is fixed at construction (`worker.ts`, `#instance`), so a
changed marker is a construction boundary the reading itself demonstrates.

**Criterion 2 holds only if every `peerId` matches AND rows 2 and 3 each carry an `instance`
different from row 1's.** An unchanged marker is a *not yet*, never a pass.

```
all four peerIds identical?
row 2 instance differs from row 1?
row 3 instance differs from row 1?
dialled from:            (machine / network — the outside peer is the point, so name it)
multiaddr dialled:       /dns4/<host>/tcp/443/tls/ws/p2p/<peerId>
```

**How an eviction is FORCED is UNVERIFIED, and one candidate is refuted.** Wrangler's
`evictDurableObject` is Miniflare's local-dev simulator API behind `getRuntimeMiniflare` — not a
lever over a deployed edge object. And **holding a connection open and waiting is the procedure
guaranteed not to work**: `@chainsafe/libp2p-yamux@8.0.1` defaults `keepAliveInterval: 30_000`
(`hibernatable-socket.ts:17-22`), so a held connection wakes the object every thirty seconds and
an object under one does not hibernate at all.

So: let it go quiet with **no** connection held, wait, and read again — recording the wall-clock
interval. A reading after an unmeasured interval is not a reading.

Row 3's redeploy is the certain lever, since a redeploy constructs a fresh instance by
definition. **If row 2 cannot be obtained, row 3 still carries the criterion's substance and row
2 is reported open** — say which, rather than letting row 3 stand in for both.

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

The evidence closes the loop: `29-01-SUMMARY.md` is written from these readings, **HOST-01 and
HOST-10 are flipped in BOTH places `REQUIREMENTS.md` records them** — the checklist row and the
ledger row — and Phase 29 leaves `partial`. No other requirement row is flipped by this.

Nothing else in the phase is waiting on anything.
