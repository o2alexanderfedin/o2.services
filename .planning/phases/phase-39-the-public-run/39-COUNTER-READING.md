# 39-COUNTER-READING — what `traffic.relayed` and `relayService` count, read off a running workerd

**Dated:** 2026-09-07
**Requirement:** BENCH-06 · **Phase 39 criterion 4** · **Plan:** 39-03
**Evidence:** `packages/cloudflare/src/relay-counters.e2e.test.ts`, `npx vitest run --project e2e relay-counters`, exit `0`

---

## 1. What was read

One local `wrangler dev` on port 8824 with its own `mkdtempSync` persist directory, one reserving
peer carrying `circuitRelayTransport` and listening on `/p2p-circuit`, one seeking peer that dialled
the reserver **through the circuit** — `/ip4/127.0.0.1/tcp/8824/ws/p2p/<relay>/p2p-circuit/p2p/<reserver>`,
no `/webrtc` component, so the data path stayed on the relay rather than upgrading off it — and one
4 096-byte payload exchanged in each direction over a protocol registered
`runOnLimitedConnection: true`. `GET /self` was read at four moments. **No deployed object was
touched**: `CLOUDFLARE_API_TOKEN` was blanked for the spawned process and `ANNOUNCE_MULTIADDRS` was
overridden to this run's own loopback address, because the tracked value announces the deployed
host and a relay left at it hands its client a circuit address pointing there.

The four readings, transcribed from the run output rather than re-derived:

```
[BENCH-06 counters] R0 cold direct.connectionSeconds=0 direct.bytes=0 relayed.connectionSeconds=0 relayed.bytes=0 inboundHopStreams=0 outboundHopStreams=0 outboundStopStreams=0 inboundStopStreams=0 relayService.bytes=0
[BENCH-06 counters] R1 reserved direct.connectionSeconds=0.279 direct.bytes=2893 relayed.connectionSeconds=0 relayed.bytes=0 inboundHopStreams=1 outboundHopStreams=0 outboundStopStreams=0 inboundStopStreams=0 relayService.bytes=280
[BENCH-06 counters] R2 relayed direct.connectionSeconds=0.557 direct.bytes=33080 relayed.connectionSeconds=0 relayed.bytes=0 inboundHopStreams=2 outboundHopStreams=0 outboundStopStreams=1 inboundStopStreams=0 relayService.bytes=22129
[BENCH-06 counters] R3 stopped direct.connectionSeconds=4.577 direct.bytes=33348 relayed.connectionSeconds=0 relayed.bytes=0 inboundHopStreams=2 outboundHopStreams=0 outboundStopStreams=1 inboundStopStreams=0 relayService.bytes=22129
[BENCH-06 arrangement] seeker->reserver relayed connection present=true limits={}
```

Host conditions and cost, from the same run:

```
[host conditions] host was quiet — load/core 0.55 before, 0.51 after (8 cores, ceiling 4.00)
[host conditions] wall clock 5.89 s
real 6.64
user 1.07
sys 0.33
```

`(user+sys)/real` is **0.21**. That is the expected shape for this spec and not a starved process:
it spawns `wrangler dev`, waits for a reservation and sleeps two seconds for the close to bank, so
`real` legitimately exceeds CPU time. The banner reports the host quiet, so the durations above are
quotable.

**The reading reproduced.** The spec was run twice against the same source — once before the plant
and once after the restore. Every byte and stream count above is identical across both runs. The two
figures that moved are the two live clock readings, `direct.connectionSeconds` at R2 (`0.549` then
`0.557`) and at R3 (`4.569` then `4.577`), which is what a counter that accrues `now - openedAt`
should do.

**What the deltas say, pair by pair.**

| pair | reading | what it means |
|---|---|---|
| R0→R1, `inboundHopStreams` 0→1 | the reserver's RESERVE | a peer used this node as its relay |
| R1→R2, `inboundHopStreams` 1→2, `outboundStopStreams` 0→1 | the seeker's CONNECT, and the relay's delivery to the reserver | a relayed connection was actually carried, not merely reserved |
| R1→R2, `relayService.bytes` 280→22 129 | +21 849 against 8 192 bytes of payload | the **spliced traffic itself** is counted, not only the control exchange that set it up — the remainder is the Noise handshake, the muxer framing and the negotiation that also ride the circuit |
| R1→R2, `direct.bytes` 2 893→33 080 | +30 187 | the same forwarded traffic counted **again** at the connection layer, plus WebSocket and Noise framing on the two direct legs |
| R0..R3, `traffic.relayed` | `0` / `0` at every point | this node reported **no relayed traffic at all** while carrying a relayed connection |
| R2→R3, `direct.connectionSeconds` 0.557→4.577 | grew across the close | the split accrues live **and** banks at close; it did not reset, so no instance eviction happened between R2 and R3 |

**The positive control is the second row of `traffic`, in the same run, from the same instrument.**
`direct.connectionSeconds` went from `0` at R0 to `0.557` at R2 and `direct.bytes` from `0` to
`33 080`. Without that, a run in which nothing ever connected would have produced the identical
`relayed` zeros. The zero below is a measurement because a non-zero was observed beside it.

**The plant.** `runOnLimitedConnection: true` was removed from the reserver's `handle()`
registration — one line, restored by the inverse of that edit, `cmp` silent against a snapshot taken
immediately before. The run went `1 passed` → `1 failed`, verbatim:

```
StreamResetError: The stream has been reset
 ❯ YamuxStream.onRemoteReset node_modules/@libp2p/utils/src/abstract-message-stream.ts:358:16
```

Only `R0` and `R1` printed; the red arrives before any assertion. That red is what proves the
arrangement is exercising the relayed path: the flag is only consulted on a connection libp2p
considers limited, so a plant that reddens means the connection was limited, which means it was
relayed. The `[BENCH-06 arrangement]` line records the same fact from the dialling side —
`limits={}`, an empty object, which is not `null`, which is exactly what `connection.js:180` tests.

---

## 2. The deployed reading beside it

`GET /self` on the deployed node, read live **2026-09-04** and quoted from 39-03's objective:

```
"traffic":{"direct":{"connectionSeconds":39178.906,"bytes":15958472},
           "relayed":{"connectionSeconds":0,"bytes":0}},
"relayService":{"inboundHopStreams":6715,"outboundHopStreams":0,"outboundStopStreams":53,
                "inboundStopStreams":0,"bytes":1793363,"firstInboundHopStreamAt":1788191433180}
```

No second deployed read was taken for this document, and none is needed: the anomaly is the *shape*
of that pair, and the shape is what the local run reproduces. The two sit at very different scales —
6 715 hop streams and 53 deliveries against 2 and 1 — and the columns line up field for field:
`direct` large, `relayed` exactly `0`/`0`, `relayService` carrying real traffic, `outboundHopStreams`
and `inboundStopStreams` both `0` because neither node has ever used somebody else as *its* relay.

---

## 3. The verdict

**The local run reproduced the deployed shape, so the anomaly is explained and it is not a defect.**
This is a reading, not an inference from source: a node that demonstrably carried a relayed
connection between two peers — one CONNECT, one delivery, 21 849 bytes on the relay counter — reported
`traffic.relayed.connectionSeconds = 0` and `traffic.relayed.bytes = 0` at all four moments.

The mechanism the measurement showed is the one 39-03's `<interfaces>` proposed as a hypothesis, and
the hypothesis is **confirmed by the reading**: `traffic` is about the connections a node *holds*,
classified by each connection's own address. Every connection this relay held was an inbound
WebSocket, which `classifyConnection` answers `direct` for. The traffic it carried *for others* rode
inside those same direct connections as hop and stop streams, which `relayService` counts separately.
So `traffic.relayed` on a node in the relay role is zero **by construction** — it is the node's own
relayed traffic, and a relay has none. `traffic.relayed` would move only if this node dialled out
*through somebody else's* relay, which it never has: `outboundHopStreams` is `0` locally and `0` on
the deployed node.

The measurement also confirms, against a running object, the overlap `relay-service-log.ts` declares
and the ROADMAP's Phase 32 block records: `relayService.bytes` and `traffic.direct.bytes` count the
same forwarded payload at two different questions. R1→R2 moved them by 21 849 and 30 187
respectively, over one 8 192-byte exchange. Neither number is the other minus anything, and the
difference — 8 338 — is framing, not relayed traffic. **They must be reported side by side and never
reconciled by subtraction.** This reading confirms that sentence rather than contradicting it.

**What was not measured.** Whether the deployed object's zero has the *same* cause as this one's. The
local run is two clients on one host with a relay whose announced address was overridden to loopback;
the deployed object has held 6 715 hop streams from peers this run cannot characterise. Nothing
observable from here rules out that it once held a connection the classifier would have called
relayed and that the instance holding it was evicted before anyone read it — the split is
per-instance, which `relay-service-journal.e2e.test.ts` already proves. What this reading establishes
is that the pair needs **no** such explanation: the shape arises with no eviction, no defect and no
lost connection.

---

## 4. What this forecloses for criterion 4

Criterion 4 requires *"the distinct-machine count is published beside the curve"* and states that
*"until the run reports, the half stays descoped and unmeasured — not met — and a same-host figure may
not be published in its place."* This reading closes off one route to that number, and the closure is
the reason this document exists.

**Neither counter counts machines, and neither is close to it.**

- `relayService.inboundHopStreams` counts **hop streams**. One device opening several is one device:
  the local run shows two hop streams from **two** peers, and nothing in the counter distinguishes
  that from two hop streams from one peer opening a second circuit. Worse, the counter cannot even
  tell a RESERVE from a CONNECT — `relay-service-log.ts` says so by name, which is why the marker is
  called `firstInboundHopStreamAt` and not `firstReservationAt`. The deployed `6 715` is 6 715
  streams, not 6 715 of anything with a body.
- `traffic.direct` and `traffic.relayed` count **this node's own connections**, in seconds and bytes.
  They carry no peer identity at all, so no count of anything can be derived from them.

**So the distinct-machine half of `BENCH-06` cannot be read off `/self`.** A figure derived from
either counter and captioned as a machine count would be a same-host figure published in a machine
count's place, which criterion 4 forbids by name. It would also break `BENCH-06`'s own standing rule
that the same-machine label stays *"required and derived from that inventory, never declared"* — there
is no inventory behind a hop-stream total to derive anything from.

**The funnel cannot supply it either.** Its store is aggregate by construction, it cannot be joined to
a job, and its schema is frozen at digest `3911527f1a04abee`, recomputed from the field set on every
run in both lanes — so adding a machine field to carry the number reddens
`packages/net/src/funnel-schema.test.ts` in both lanes, which is the freeze working rather than a bug
to route around.

**Where the participant count is built: plan `39-04`.** It builds the half that needs no ruling — a
distinct **peer** count derived from `ReduceOutcome.executedBy`, labelled as peers — plus a
publication guard that reddens on a machine-count claim with no announced-machine source behind it.
The machine half of `39-04` waits on **the owner's ruling on what a peer may announce about its own
machine** (plan `39-08` Task 2: `announce-coarse`, `peers-only`, or `defer`). It is an owner decision
and not an engineering one because `packages/browser/src/disclosure.ts` promises *"no identifiers
beyond a peer key generated in this tab"*, so announcing a machine datum exceeds the disclosure and
costs a version bump — which re-asks a cohort that is spendable exactly once.

Until that ruling and the run that follows it, criterion 4's distinct-machine half stays **descoped
and unmeasured, which is not met**, and this document is the record of one specific way it must not
be closed.
