---
phase: 29-hosted-tier-assembly-and-first-deploy
captured_by: owner
status: filled 2026-08-27 from a real deploy; completed 2026-08-28 when the eviction row was observed and the owner confirmed no manual deploy in the interval
criterion_1: REFUTED — no alert existed when the first object was created; the owner ruled the ordering aside knowingly, and no later alert repairs an ordering
criterion_2: MET IN FULL — dialled from outside, identify completed, and one PeerId across BOTH construction boundaries: a redeploy (row 3) and an eviction (row 2, ≈8 h 50 m idle, no deploy in the interval)
---

# Phase 29 — the owner's captured evidence

**FILLED 2026-08-27 from a real deploy. Every value below was read off the live account or the
live node; nothing here is inferred.**

> ## Criterion 1 is REFUTED, and by a decision rather than by an accident
>
> The owner was shown the ordering, shown that criterion 1 asserts the alert preceded the first
> object, and chose *"деплой прямо сейчас"* without the alert. That is his call and it was made
> with the consequence stated in front of him. It is recorded as a refutation rather than as a
> technicality: **no wording repairs it and no later alert makes it true**, because the first
> object now exists and its creation time is fixed.
>
> What survives is the substance the criterion protected — the account is not exposed. The cost
> is ≈$5/month against a $15 budget, and an alert can still be configured; it simply cannot be
> configured *before* an object that already exists.

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
what was inspected:      wrangler deployments list --name o2-bootstrap
instances found:         ZERO — "This Worker does not exist on your account. [code: 10007]",
                         exit 1 read on the line immediately after the command
checked on:              2026-08-27T16:00:02Z, BEFORE the deploy
```

**This is the one precondition that held**, and it is what makes the object below genuinely the
first. The owner's three production `ocr-checks-worker*` scripts were never in scope — a
different name, confirmed absent rather than assumed absent.

**If it is not zero, stop.** The honest outcomes are to report criterion 1 unsatisfiable with
the reason, or to site the first object under a fresh name from the closed enumeration. Neither
is decided by filling this file in.

---

## Criterion 1 — the billing alert precedes the first object

### Timestamp A — the alert's configuration

```
threshold configured:    NONE
timestamp A:             DOES NOT EXIST
captured how:            n/a — the owner chose to deploy without it, knowingly
```

### Timestamp B — the deploy that created the first object

```
version ID:              20ff8f82-affe-42a9-9471-d842dda76c21
timestamp B:             2026-08-27T16:00:21Z — wall clock read immediately after DEPLOY_EXIT=0
captured how:            wrangler deploy console output, exit 0
resulting host:          https://o2-bootstrap.af-4a0.workers.dev
upload:                  1870.20 KiB / gzip 406.62 KiB; worker startup 34 ms
```

**One deploy created the object and the host name needed no second one** — the workers.dev
subdomain resolved as an account property, exactly as the dated correction in `wrangler.jsonc`
said it would.

### The check, performed once

```
A < B ?                  NO — A does not exist. Criterion 1 is REFUTED.
checked on:              2026-08-27
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
| 1 | fresh, right after deploy | `12D3KooWKm587f…rb7rsz` | `c89125c7…` | **NOT TAKEN** | 16:00:29Z |
| 1b | warm re-read | `12D3KooWKm587f…rb7rsz` | `c89125c7…` | — | immediate |
| 1c | warm re-read | `12D3KooWKm587f…rb7rsz` | `c89125c7…` | — | immediate |
| 2 | **after an eviction** | `12D3KooWKm587f…rb7rsz` | **`8ac6c674…`** | **`12D3KooWKm587f…rb7rsz` — IDENTIFY COMPLETED** | ≈8 h 50 m idle, no deploy in the interval — see below |
| 3 | **after a redeploy** | `12D3KooWKm587f…rb7rsz` | **`83ebb81c…`** | — | version `8024e518-f76d-4bab-9ff8-2c77a5debee7`, 16:01:07Z |
| 4 | **outside dial, after two more deploys** | — | — | **`12D3KooWKm587f…rb7rsz` — IDENTIFY COMPLETED** | version `0149cbc4-1574-4954-add5-61e37b982d90` |

Full PeerId, identical in every row above:
`12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz`
nodeKey `93bcda8778fcdecc815a2569d16707f7c5bc8874c5a222c5385ba06031ea8be1`

### What these rows do and do not establish

**Row 3 is the reading the phase was built for.** The PeerId is byte-identical to row 1's while
the `instance` marker is different — so the identity crossed a real construction boundary rather
than being answered twice by one live object. That is the mechanism criterion 2 rests on, taken
on the deployed edge and not in a fixture.

**Rows 1b and 1c are the control that makes row 3 mean something.** Three consecutive reads held
one marker, so a changed marker in row 3 is a construction and not read-to-read noise. Without
this control, row 3 alone would be a number with no baseline.

**Row 4 closes criterion 2, and it took two more deploys to get there.** An ordinary Node peer
outside Cloudflare dialled
`/dns4/o2-bootstrap.af-4a0.workers.dev/tcp/443/tls/ws/p2p/12D3KooWKm587f…rb7rsz`, the connection
came up, **identify completed**, and the resolved remote peer is byte-identical to the PeerId
rows 1 and 3 carry. Read off the `peer:identify` event rather than off the peer store, because
the peer store is populated asynchronously and an empty read there is not evidence of anything —
the first probe returned `PROTOCOLS=` with zero entries and would have been mistaken for a
failure.

```
agent:      js-libp2p/3.3.6 browser/Cloudflare-Workers
protocols:  /ipfs/id/1.0.0, /ipfs/id/push/1.0.0, /ipfs/ping/1.0.0,
            /libp2p/circuit/relay/0.2.0/hop, /libp2p/circuit/relay/0.2.0/stop,
            /o2/kad/1.0.0
```

All three of the criterion's terms are now carried: **dials** (row 4), **completes identify**
(row 4), **same PeerId** (rows 1, 3 and 4 agree). The relay `hop` and the private keyspace
`/o2/kad/1.0.0` are advertised by the deployed node — not asserted here as working, only as
announced.

### Row 2 — obtained 2026-08-28, by waiting rather than by forcing

**This row read NOT OBTAINED until 2026-08-28**, and the forcing lever is still UNVERIFIED with
its one candidate refuted (wrangler's `evictDurableObject` is Miniflare's local-dev simulator,
not a lever over a deployed edge object). What produced the row is the procedure the runbook
named as the fallback: **let the object go quiet with no connection held, wait, and read again,
recording the wall-clock interval.**

| | UTC | `instance` | `peerId` | `version` |
|---|---|---|---|---|
| A | ≈09:30Z | `f57ced1f-75fc-49d2-a2f9-8106b350c858` | `12D3KooWKm587f…rb7rsz` | `2.0.0-rc.4` |
| B | 18:21:13Z | **`8ac6c674-05ac-461b-ab3b-2c27f1bb0c4a`** | `12D3KooWKm587f…rb7rsz` | `2.0.0-rc.4` |
| control | 18:21:32Z, 18:21:33Z, 18:21:33Z | `8ac6c674…` ×3 | identical | identical |
| dial | 18:22:10Z | — | **`12D3KooWKm587f…rb7rsz` — IDENTIFY COMPLETED** | — |

**No deploy occurred between A and B**, which is what makes this row an eviction rather than a
second copy of row 3. The last `Deploy hosted node` run is `33157043966`, 2026-08-28T08:52:11Z,
for `v2.0.0-rc.4`; the workflow's only trigger is `release: published` and no release followed.

**The owner discharged the one assumption this rests on.** Automatic deploys are readable from
the run list; a manual `scripts/deploy-hosted.sh --live` is not. Asked directly whether he had
deployed by hand in that window, he answered **no** on 2026-08-28. Without that answer the row
stays open, because a hand deploy would make B a redeploy and this table would then hold row 3
twice while appearing to hold two different events.

**The control is what makes B a construction and not noise**, and the dial is what carries the
criterion's middle term — *completes identify* — on the post-boundary instance rather than on a
`/self` answer. The dial was an ordinary `libp2p@3.3.6` Node peer (`webSockets` + `noise` +
`yamux` + `identify`), with the remote peer read off the `peer:identify` event and never off the
peer store, for the reason row 4 already records.

**Two defects in how this reading was taken, recorded because they cost it precision.** Reading A
was not timestamped when taken, so its minute is reconstructed and only the interval's lower end
is exact. And nothing scheduled the observation — it exists because the interval happened. A
second reading of this leg should fix both.

### The `instance` column is the one a plan check added, and why

**Without it these four rows cannot tell "survived an eviction" from "was never evicted."** Two
readings of a live object give the same PeerId trivially, and the table would fill in completely
having exercised nothing. `instance` is fixed at construction (`worker.ts`, `#instance`), so a
changed marker is a construction boundary the reading itself demonstrates.

**Criterion 2 holds only if every `peerId` matches AND rows 2 and 3 each carry an `instance`
different from row 1's.** An unchanged marker is a *not yet*, never a pass.

```
all peerIds identical?           YES — rows 1, 1b, 1c, 2, 3, 4, byte-identical
row 2 instance differs?          YES — c89125c7… -> 8ac6c674…, and NO DEPLOY in the interval
row 3 instance differs from 1?   YES — c89125c7… -> 83ebb81c…
CRITERION 2:                     MET — every term carried, both boundary rows filled
dialled from:            a plain Node peer on the developer machine — libp2p 3.3.6,
                         webSockets + noise + yamux + identify, nothing Cloudflare-shaped
multiaddr dialled:       /dns4/o2-bootstrap.af-4a0.workers.dev/tcp/443/tls/ws/p2p/12D3KooWKm587fnGat5xncq9kaWUk4bN5gUJQiF4q8EwJnrb7rsz
identify:                COMPLETED — 6 protocols, agent js-libp2p/3.3.6 browser/Cloudflare-Workers
```

**How an eviction is FORCED is UNVERIFIED, and one candidate is refuted.** Wrangler's
`evictDurableObject` is Miniflare's local-dev simulator API behind `getRuntimeMiniflare` — not a
lever over a deployed edge object. And **holding a connection open and waiting is the procedure
guaranteed not to work**: `@chainsafe/libp2p-yamux@8.0.1` defaults `keepAliveInterval: 30_000`
(`hibernatable-socket.ts:17-22`), so a held connection wakes the object every thirty seconds and
an object under one does not hibernate at all.

So: let it go quiet with **no** connection held, wait, and read again — recording the wall-clock
interval. A reading after an unmeasured interval is not a reading.

**That fallback is what produced row 2 on 2026-08-28**, at an ≈8 h 50 m idle interval. So the
paragraph above stands as written — forcing an eviction is still unverified and the refuted
candidate is still refuted — and what changed is only that waiting turned out to be enough. The
distinction matters for the next reading: this row was **observed**, not **caused**, so nothing
here makes it repeatable on demand.

Row 3's redeploy is the certain lever, since a redeploy constructs a fresh instance by
definition. **If row 2 cannot be obtained, row 3 still carries the criterion's substance and row
2 is reported open** — say which, rather than letting row 3 stand in for both. That contingency
was exercised for a day and is kept rather than deleted: it is the rule that stopped row 3 being
written into row 2's slot while the wait was still running.

---

## The two defects the first real dial found, and why no local run could have

Both were read out of `wrangler tail`, not guessed, and each cost one deploy to fix.

**Defect 1 — `NoAnnouncedAddressError`.** `wrangler.jsonc`'s `ANNOUNCE_MULTIADDRS` was still the
empty placeholder, because the host name is not knowable until a deploy exists. **This one is
the design working**: a relay with nothing announced hands every client an empty reservation
*silently* (consult §13), so the assembly refuses instead and fails loudly on the first dial.
Fixed by filling in the value the deploy produced.

**Defect 2 — `ReferenceError: BroadcastChannel is not defined`.** `workerd-shims.ts` is a
complete, tested module that installs the globals js-libp2p cannot construct without, and
**nothing imported it.** Measured on the emitted bundle before the fix: `MinimalBroadcastChannel`
appeared **zero** times. Its own specs passed throughout, because they call
`installWorkerdShims` directly.

> **A module that is correct and unreached is indistinguishable from one that is absent.** From
> the platform's side the two are identical, and every local signal this repository has —
> specs, types, the dry-run build — was green while the deployed node threw on its first dial.

Fixed with a side-effect import placed first in `worker.ts`, and guarded by three cases in
`hosted-tier-deploy.node.test.ts` that read the **bundle** rather than the import line: a named
import would tree-shake away and reopen the gap with the source looking unchanged. All three
were watched red before the fix.

**Four deploys, not one.** The plan budgeted one for criterion 1's ordering and named the
redeploy as a second act; the third and fourth are these two defects. Recorded as four rather
than described as one.

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
