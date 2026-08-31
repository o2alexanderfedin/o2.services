---
phase: 32-the-relay-role-and-the-two-counters
plan: 1
subsystem: hosted-tier
tags: [net-14, counters, circuit-relay, metrics, cloudflare, libp2p]
requires:
  - .planning/phases/phase-31-hosted-record-store-expiry-and-the-capability-it-never-advertises/31-01-SUMMARY.md
provides:
  - "NET-14 Done — connection-seconds and bytes, peer-to-peer against relayed, reporting before the relay carries anything"
  - "a classification rule with its trap measured rather than assumed"
  - "criterion 4's non-vacuity: two arrangements against a real circuit relay"
affects:
  - packages/libp2p/src/traffic-split.ts
  - packages/libp2p/src/traffic-split.test.ts
  - packages/libp2p/src/traffic-split.e2e.test.ts
  - packages/libp2p/src/index.ts
  - packages/cloudflare/src/hosted-libp2p.ts
  - packages/cloudflare/src/worker.ts
  - packages/cloudflare/src/inbound-listener.e2e.test.ts
  - packages/node/src/reachability-guard.node.test.ts
  - vitest.config.ts
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
tech-stack:
  added: []
  patterns:
    - "a counter is held by the object, not by the lazily-built stack, so it can report before there is anything to report"
    - "a plant that stays green is recorded, and the property is re-pinned on the dependency instead"
decisions:
  - "Criteria 1 and 2 are NOT attempted — they need two browsers, WebRTC and the deployed relay"
  - "The split is reported as a FIELD on /self, never a second route"
  - "`traffic` is required with no default on HostedLibp2pInit, because the requirement is an ordering"
metrics:
  duration: ~1 h
  completed: 2026-08-30
---

# Phase 32 — the two counters, and what was deliberately left alone

## What this phase is and is not

Phase 32 has four criteria. **Two were built and two were not, on purpose.**

- **Criteria 3 and 4 — the counters** — are self-contained, and criterion 3 is an *ordering*:
  the split must be reporting **before** the relay accepts its first browser reservation. An
  ordering requirement missed is not recoverable later, which is why it goes first.
- **Criteria 1 and 2 — the relay carrying two browsers, and the `addresses.announce` plant** —
  need two browsers, a WebRTC handshake and the **deployed** relay. `HOST-02` stays
  `Not started`. Folding a partial version in would widen what counts as passing, which this
  milestone has refused three times in one day.

## Why the counters are structural

A hosted-relay fabric becoming hosted-in-practice while every document still calls it
peer-to-peer is the **median** outcome, not a tail case — IPFS's measured cloud reliance
(arXiv:2309.16203) and Matrix's homeserver dominance are the precedents. Nothing about that
drift is visible from inside: every individual connection works. What makes it visible is a
number that separates the two.

## Where the bytes are counted, and why there

`trackMultiaddrConnection` — `libp2p/dist/src/upgrader.js:140` calls it on **every** upgrade,
inbound and outbound, before encryption and muxing. It is the one seam every transport passes
through. Counting inside a transport would count one transport; counting per protocol stream
would miss the handshake bytes a relayed connection also pays for.

The wrap replaces `send` and `onData` **on the instance** rather than adding a `'message'`
listener, and that is not a style choice: `AbstractMessageStream` branches on
`listenerCount('message')` when it dispatches (`abstract-message-stream.js:187,205`), so
observing bytes by listening would change how the stream delivers them.

A connection still open is measured at read time (`now - openedAt`) rather than banked only at
close. A counter that learned of connections only when they ended would report zero for a
fabric whose connections are all up — which is every fabric that is working — and would depend
on observing a close that a killed tab never sends.

## The plant that stayed green, and what replaced it

The classifier tests WebRTC before circuit, because a **direct** browser-to-browser WebRTC
address keeps the signalling relay in its string long after the relay has left the data path:
`<relay>/p2p-circuit/webrtc/p2p/<self>`. A circuit-first classifier would report every direct
browser pair as relayed — the fabric declaring itself hosted-in-practice on the strength of
its own counter.

**Swapping the two branches left the tests green.** Measured against this repository's
`@multiformats/multiaddr-matcher@3.0.2`:

```
/ip4/…/tls/ws/p2p/<relay>/p2p-circuit/p2p/<self>          Circuit.matches true   WebRTC false
/ip4/…/tls/ws/p2p/<relay>/p2p-circuit/webrtc/p2p/<self>   Circuit.matches false  WebRTC true
```

The library already disambiguates. So the ordering is **not load-bearing today**, and a plant
that cannot fail is worse than no plant if it is left unrecorded. The order is kept for the
intent that survives a library change — what decides the column is where the *bytes* go — and
the property is now held by a case that pins the **library's** answer. A future matcher version
that starts reading that form as a circuit reddens there, and the ordering becomes the thing
standing between the fabric and a false reading.

## The plant that did redden it

`trackMultiaddrConnection` made a no-op: both arrangements failed at *no bytes reached the
direct column within 20 s*. Restored `cmp`-clean. That is the reading that says libp2p really
calls the seam, that the wrap really sees bytes, and that the assertions are not passing on
something else.

## Criterion 3, as a reading and as a stated basis

On a real workerd, `GET /self` answers **two zeroed columns** before any peer has dialled —
`/self` is HTTP and opens no libp2p connection — and after eight peers dial, `direct` has moved
while `relayed` is still **exactly** zero. Two zeroed columns is what a counter that exists and
has seen nothing looks like; a missing field is what a counter added later looks like, and
those must not be confusable.

The counter is held by the **Durable Object**, not by the fabric, because the fabric is built
lazily on the first inbound upgrade and `/self` deliberately does not build one.

**The basis I first recorded for criterion 3 was false, and it survived less than a day.**

It read: *nothing publishes the relay's address to any browser — the browser client's
`bootstrap.json` hands out the hosted node's PeerId for dialling, and no code path asks a
browser to reserve on it.* Both halves are wrong, and the deploy that shipped these counters is
what showed it:

```
$ curl https://o2alexanderfedin.github.io/o2.services/bootstrap.json
{"relayAddrs":["/dns4/o2-bootstrap.af-4a0.workers.dev/tcp/443/tls/ws/p2p/12D3KooW…"], …}
```

`relayAddrs` names this node, and `browser-node.ts:597` listens on
`['/p2p-circuit', '/webrtc']` — which *is* asking for a reservation. The published client has
been able to join since `v2.0.0-rc.4` on 2026-08-28, **three days before these counters
existed.**

Whether any browser actually reserved in that window cannot be read from here: the counters are
per-instance and hold no history, and the reservation record is the operator's. So criterion
3's ordering is **unverified and may already be permanently false** — the same shape as
`HOST-10`, whose criterion is an ordering that no later action can satisfy. Recorded as that
rather than left resting on a basis that does not hold.

What the deploy DID establish, and it is worth separating from what it refuted: the counters
report on the deployed object. `https://o2-bootstrap.af-4a0.workers.dev/self` answers
`version: 2.0.0-rc.5` with two zeroed columns, on the PeerId it has carried since 2026-08-27.

## The granularity, stated because the number reads wider than it is

Three limits, and none of them is a hedge.

**1. `/self` answers about this node's own connections, not about what it relays.** The hosted
node dials through no relay, so its `relayed` column is structurally zero — the e2e pins it at
zero after eight dials, which is correct and also the shape of the limit. Relayed payload
transits this node as circuit **hop/stop protocol streams riding direct WebSocket legs**, and
`trackProtocolStream` is deliberately inert. So when Phase 32 criteria 1–2 land and two
browsers meet through the deployed relay, **every byte it carries is counted `direct` by this
surface.** Read the hosted node's split as *how much of my traffic is relayed*, never as *how
much do I relay*.

**2. The other half is hop-stream counting, and it lands with criteria 1 and 2.** That is the
first arrangement in which relay-carried bytes are observable at all; building the counter
before the arrangement would be building against no reading.

**3. The counters are per-instance and reset on eviction.** A Durable Object is reconstructed
constantly, and a hibernation-woken socket is closed with `CLOSED_AFTER_HIBERNATION` (1012)
and must be redialled — a redial re-enters the upgrader and starts a fresh count, while the
pre-eviction connection's seconds and bytes go with the instance. So this is a **live**
reading, not a lifetime total, and specifically **not** a billing total: Phase 30's cost
argument is about the duration of held sockets across the object's whole life, which no
per-instance counter sums.

`NET-14`'s ledger row carries all three, and its verdict is *Done against the amended
criterion, with its granularity stated* rather than a bare `Done`.

### Two of the three were retired the same day — 2026-08-30

The limits above were written in the morning and two of them did not survive the afternoon.
What retired them was a question the owner could not get an answer to: *did a browser reserve
on this relay before the counters existed?* The node could not say, and the reason was limit 3.

**Limit 2 was wrong about the arrangement, not about the counting.** It said hop-stream
counting *"lands with criteria 1 and 2 … the first arrangement in which relay-carried bytes are
observable at all"*. A real `circuitRelayServer` in an e2e observes hop and stop streams in both
directions with no deployed relay and no browsers, which
`packages/libp2p/src/relay-service-log.e2e.test.ts` now does. `trackProtocolStream` is no longer
inert: it feeds `RelayServiceLog`, which keeps four **direction-separated** counters, because a
relay someone used and a relay this node used are the same protocol string and the direction is
the whole meaning. Planted by inverting `stream.direction` — both e2e cases red — and restored
`cmp`-clean.

**Limit 3 is now true of `traffic` and false of the tier.**
`packages/cloudflare/src/relay-service-journal.ts` banks the relay record into Durable Object
storage and refuses any write that would shorten it. `/self` carries it as `relayService`, and
`relay-service-journal.e2e.test.ts` reserves against a real workerd, **kills and restarts
wrangler**, and reads the record back from a different process while `traffic` reads zero in the
same answer. Measured there and worth keeping: `BootstrapObject` banks on a socket close AND on
a frame while the marker is not yet durable; each path alone is sufficient in that arrangement,
and only removing both turns the case red. The frame path exists for the case the arrangement
cannot produce — an instance evicted while its socket stays open, which never reaches a close
handler.

**Limit 1 is untouched** and is still how the split must be read. `relayService.bytes`
deliberately OVERLAPS `traffic.direct.bytes` — the same forwarded payload counted at a different
question — and the two must never be reconciled by subtraction.

**Criterion 3's verdict does not move.** Nothing here reconstructs history it did not observe,
so the `rc.4`→`rc.5` window stays dark and the ordering remains unverified and possibly
permanently false. What changed is that the next such question has an answer.

## Verification

```
npx vitest run --project node packages/libp2p/src/traffic-split.test.ts   → 10/10
npx vitest run --project e2e  packages/libp2p/src/traffic-split.e2e.test.ts → 2/2
npx vitest run --project e2e  packages/cloudflare/src/inbound-listener.e2e.test.ts → 6/6
npx tsc --noEmit → exit 0
```
