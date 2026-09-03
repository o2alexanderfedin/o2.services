# Phase 32, criterion 3 — the ordering question, read off the deployed object

**Taken 2026-09-02 against `https://o2-bootstrap.af-4a0.workers.dev/self`, version `2.0.0-rc.10`.**

Criterion 3 asks that the two counters be *reporting before the relay accepts its first
browser reservation*. The 2026-08-31 verdict recorded that ordering as **unverified and
possibly permanently false**, on the grounds that the counters carry no history. This
reading tests that verdict against the one surface that *does* carry history, and the
verdict survives.

## What was read

```
"traffic":       {"direct":{"connectionSeconds":0,"bytes":0},
                  "relayed":{"connectionSeconds":0,"bytes":0}}
"relayService":  {"inboundHopStreams":96,"outboundHopStreams":0,
                  "outboundStopStreams":15,"inboundStopStreams":0,
                  "bytes":290485,"firstInboundHopStreamAt":1788191433180}
```

`traffic` is per-instance and resets on eviction, so its two zeroed columns say only that
this instance is young. `relayService` is the opposite: `relay-service-journal.ts` banks it
into Durable Object storage and refuses any write that would shorten it, so it is a lifetime
total. It has moved a long way since the 2026-08-31 probe recorded `inboundHopStreams` 2 and
`relayService.bytes` 5 007 — the deployed relay has carried 96 inbound hop streams and
290 485 bytes.

## Why that still does not settle criterion 3

`firstInboundHopStreamAt` is `1788191433180` — **2026-08-31 15:50:33 UTC** — and it has not
moved since it was first observed, which is the field working as specified.

| tag | committed | what it shipped |
|---|---|---|
| `v2.0.0-rc.4` | 2026-08-28T01:51:55-07:00 | the client could first join |
| `v2.0.0-rc.5` | 2026-08-30T22:14:09-07:00 | the two counters |
| `v2.0.0-rc.6` | 2026-08-31T00:21:12-07:00 | the relay-service log |
| `v2.0.0-rc.7` | 2026-08-31T02:34:36-07:00 | the journal, banked to storage |

The journal's first observation falls roughly six hours **after** `rc.7`, which is itself
three days after `rc.4`. So the field records the first hop stream *since the journal
existed*, never the first ever, and the `rc.4`→`rc.5` window — the only window the criterion
is actually about — is outside anything this surface can see.

**The verdict does not move: criterion 3's ordering is unverified and may already be
permanently false.** What changes is its basis. It rested on *the counters carry no history*;
it now rests on the stronger and narrower statement that the one surface which does carry
history began carrying it after the window closed. Nothing reconstructs history it did not
observe, and this reading is a positive control for that rather than an argument from
absence.

## What the 96 does establish

The deployed relay is being used. `outboundStopStreams` 15 against `inboundHopStreams` 96
says reservations and CONNECTs are both happening.

**Part of that total is this project's own traffic, and saying otherwise would be refutable
by the tree.** `firstInboundHopStreamAt` was set by the 2026-08-31 `rc.7` probe itself — the
phase 32 record has `inboundHopStreams` moving 0 → 1 on that probe's reservation and → 2 on
its dialler's CONNECT, at this very timestamp — and the two-tab criterion-1 run reserved on
the same object the same day. What is unattributed is not the 96 but the **growth**: 2 → 96
inbound hop streams and 5 007 → 290 485 bytes since those probes stopped. Who moved that
remainder is not readable from here. Recorded as a fact about the object, not as a claim
about a cohort.
