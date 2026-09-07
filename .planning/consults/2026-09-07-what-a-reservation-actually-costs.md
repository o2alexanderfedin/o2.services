# What a relay reservation actually costs the Durable Object

**Date:** 2026-09-07
**Branch:** `feature/phase-39-waves-2-3`
**Method:** source reading only. Nothing was run, no relay was stood up, no request was sent to
`o2-bootstrap.af-4a0.workers.dev`, and no source file was changed. Every number below carries a
`file:line`. Where a component could not be pinned from source it is listed in §8 as unresolved and is
**not** folded into any total.

---

## 0. The question, and the short answer

`REQUESTS_PER_RESERVATION = 165` in `.planning/phases/phase-39-the-public-run/39-05-PLAN.md:102` is a
quotient: 1 100 232 Durable Object requests read off the account on 2026-09-03, divided by 6 615 relay
reservations. The owner asked why it is that large.

**It is not large. The source says it is roughly one minute of one connected peer, and it is therefore
an under-estimate for any peer that stayed longer than that.**

Read out of the source, one peer holding one reservation costs:

```
setup:  51 Durable Object requests, once
hold:  164 Durable Object requests per minute, for as long as the socket is open
total = 51 + 164 × T   (T = minutes the connection is held)
```

165 lands at **T ≈ 42 seconds**. The handshake — HTTP upgrade, multistream-select, Noise, identify both
ways, and the `RESERVE` exchange — is 51 of those 165, i.e. **31 %**. The other 69 % is one peer sitting
still for forty seconds.

Two mechanisms produce the 164/min, and neither is the relay protocol:

1. **libp2p's `ConnectionMonitor` opens a brand-new `/ipfs/ping/1.0.0` stream on every connection every
   10 seconds — in both directions** (`node_modules/libp2p/src/connection-monitor.ts:8`, `:94-124`). It is
   on by default and **this repository overrides it nowhere.** 13 yamux frames per 10 s.
2. **The js-libp2p WebSocket transport puts every length-prefixed libp2p write on the wire as *two*
   WebSocket frames** (`node_modules/@libp2p/websockets/src/websocket-to-conn.ts:61-64`). Everything above
   is billed twice.

13 yamux frames per 10 s × 2 WebSocket frames each = 156/min, plus 8/min of yamux keepalive = 164/min.

---

## 1. Why "count client `send()` calls in source" is the right unit

The billing premise this repository already records is that a Durable Object holding a WebSocket is
invoked once per inbound WebSocket **message**
(`.planning/debug/2026-09-03-the-free-tier-request-cap-took-the-hosted-tier-down.md`, and the Phase 39
cost paragraph). Three readings make that premise line up exactly with counting `send()` calls on the
client:

- **The object's entry point is per-message, and nothing coalesces.**
  `packages/cloudflare/src/worker.ts:649` `webSocketMessage(socket, message)` hands one message to
  `packages/cloudflare/src/hibernatable-socket.ts:134-143` `HibernatableSockets.message`, which does
  exactly one `connection.onData(new Uint8Array(data))` per call. There is no batching, no queue and no
  debounce anywhere on that path.
- **`webSocketMessage` receives reassembled messages**, so WebSocket-level fragmentation is irrelevant;
  one `send()` on the client is one message at the object.
- **One client `send()` is one frame.** `websocket-to-conn.ts:62` calls `this.websocket.send(...)` once
  per buffer, and the WebSocket API emits one message per `send()`.

So: **one `websocket.send()` on the peer = one `webSocketMessage` = one Durable Object request.**

### 1.1 The 2× multiplier, which is the single most consequential reading in this document

`websocket-to-conn.ts:61-64`:

```ts
sendData (data: Uint8ArrayList): SendResult {
  for (const buf of data) {
    this.websocket.send(withArrayBuffer(buf))
  }
```

It iterates the `Uint8ArrayList` and sends **one WebSocket frame per constituent buffer**.
`Uint8ArrayList[Symbol.iterator]` yields `this.bufs` verbatim
(`node_modules/uint8arraylist/src/index.ts:145-147`), `appendAll` flattens a nested list into its member
buffers rather than concatenating (`:172-175`), and `sublist(0, length)` returns `[...this.bufs]`
unchanged (`:342-344`). Nothing along the path ever concatenates.

After the Noise handshake, **every** libp2p write is normalised to exactly two buffers before it reaches
that loop. `EncryptedMessageStream.sendData` is
`this.stream.send(this.encrypt(data))`
(`node_modules/@chainsafe/libp2p-noise/src/utils.ts:210-215`), and `encrypt` builds its output as

```ts
output.append(uint16BEEncode(data.byteLength))   // utils.ts:148
output.append(data)                              // utils.ts:149
```

— a 2-byte length prefix and the ciphertext, as two separate buffers, for any payload up to
`NOISE_MSG_MAX_LENGTH_BYTES_WITHOUT_TAG` (`utils.ts:132`).

**Therefore, on an established connection: 1 yamux frame ⇒ 2 WebSocket frames ⇒ 2 Durable Object
requests.** This holds for data frames, window updates, pings, SYNs and FINs alike, because Noise
re-frames all of them identically.

**The asymmetry is worth stating, because it means the object is billed on the peer's convention and not
its own.** The Durable Object's own send path copies the whole list into a single buffer and issues one
`send` — `packages/cloudflare/src/websocket-connection.ts:157-165`:

```ts
const out = new Uint8Array(bytes.byteLength)
out.set(bytes)
this.#socket.send(out.buffer)
```

So relay→peer is 1 frame per libp2p write and peer→relay is 2. Only the inbound half is billed, and the
inbound half is the doubled one. This is not a defect in `websocket-connection.ts`; it is a fact about
what the object receives.

---

## 2. Setup, phase by phase

Every count is **client → relay**, i.e. Durable Object requests. "yamux frames" are given first because
that is the unit the protocol code is written in; the billed figure is the doubled one.

| # | Phase | yamux frames | **DO requests** | Provenance |
|---|-------|:---:|:---:|---|
| P0 | HTTP upgrade | — | **1** | `packages/cloudflare/src/worker.ts:869` — `fetch()` routes `Upgrade: websocket` to `#upgrade`. One `fetch` invocation. |
| P1 | multistream-select for `/noise` | — | **4** | `node_modules/libp2p/src/upgrader.ts:428` `mss.select` → `multistream-select/src/select.ts:75` `lp.writeV([p1,p2])` → `@libp2p/utils/src/stream-utils.ts:362-368` builds `[varint, "/multistream/1.0.0\n", varint, "/noise\n"]` = **4 buffers**, written pre-Noise straight onto the raw socket. |
| P2 | Noise XX handshake | — | **6** | Initiator writes twice: `noise/src/performHandshake.ts:27` and `:42`. `writeMessageA` = `new Uint8ArrayList(writeE(), encryptAndHash(ZEROLEN))` (`protocol.ts:246`) = 2 buffers, `writeMessageC` = `new Uint8ArrayList(encS, …)` (`protocol.ts:264`) = 2 buffers; each gets a uint16 length prefix (`noise.ts:85-89`, `stream-utils.ts:358-360`) ⇒ 3 buffers each. |
| P3 | multistream-select for the muxer | 0 | **0** | **Zero, and it is a result.** Noise carries the muxer list in its handshake extensions (`noise.ts:187`, `:224`) and returns a `streamMuxer` factory (`noise.ts:104`); `upgrader.ts:326-334` only calls `_multiplexOutbound` when `muxerFactory == null`. The yamux negotiation never reaches the wire. |
| P4 | identify, client-initiated | 6 | **12** | Fired on `connection:open` — `identify/src/identify.ts:26-31`, default `runOnConnectionOpen: true` at `identify/src/utils.ts:22`. Breakdown in §2.1. |
| P5 | identify, relay-initiated | 5 | **10** | Same service on the object (`packages/cloudflare/src/hosted-libp2p.ts:337`); the client's answers are inbound. Breakdown in §2.1. |
| P6 | circuit-relay `RESERVE` | 7 | **14** | `@libp2p/circuit-relay-v2/src/transport/reservation-store.ts:397` `newStream`, `:398` `pbStream`, `:402` `write({type: RESERVE})`, `:408` `read`, `:414` `close`. |
| P7 | yamux keepalive, initial | 2 | **4** | `yamux/src/muxer.ts:133-136` starts the keepalive with `runImmediately: true`, so one ping leaves at muxer creation; the relay's own initial ping draws one ACK back (`muxer.ts:359-361`). |
|  | **Setup total** | | **51** | |

### 2.1 The per-stream arithmetic, which is where the frames actually come from

Two mechanics generate almost everything, and both are cited rather than assumed.

**(a) Opening a stream costs a frame before any protocol byte moves.**
`yamux/src/muxer.ts:166-175` — `newStream` calls `stream.sendWindowUpdate()`, which emits a
`WindowUpdate` frame carrying the `SYN` flag (`stream.ts:252-257`, `:269-306`). An *inbound* stream costs
the receiver nothing at open: `muxer.ts:457` allocates it in `StreamState.SYNReceived` and sends no ACK
frame — the ACK rides the first outgoing frame instead (`stream.ts:257-259`).

**(b) Every inbound data frame draws an outbound window update. This is a strict 1:1 doubling.**
`yamux/src/stream.ts:207-224` — `handleData` decrements `recvWindowCapacity` by the frame length and then
unconditionally calls `sendWindowUpdate()`. The early return in `sendWindowUpdate` is
`if (this.recvWindowCapacity >= this.recvWindow && flags === 0) return` (`stream.ts:291-294`) — and after
any non-empty data frame `recvWindowCapacity` is strictly below `recvWindow` (262 144,
`yamux/src/constants.ts:20`), so it never fires. **Every data frame the relay sends the peer is answered
by a frame the object pays for.** Window-update frames themselves do not draw a reply
(`stream.ts:180-203` never calls `sendWindowUpdate`).

**(c) multistream-select costs 1 frame out and draws 2 back.**
The dialer writes header and protocol in one `writeV` (`select.ts:75`); the responder answers with **two
separate** `lp.write` calls (`handle.ts:74` and `:81`), in two loop iterations. By (b) the dialer therefore
emits two window updates.

Putting (a)–(c) together, the two recurring shapes are:

| Client-initiated request/response stream | yamux frames |
|---|:---:|
| `WindowUpdate(SYN)` from `newStream` | 1 |
| mss-select write | 1 |
| window updates for the responder's 2 mss frames | 2 |
| the request body | 1 |
| window update for the response body | 1 |
| `FIN` on close | 1 |
| **total** | **7** |

| Relay-initiated request/response stream (client's share) | yamux frames |
|---|:---:|
| window update (carrying `ACK`) for the relay's mss-select frame | 1 |
| the client's 2 mss-handle replies | 2 |
| window update for the relay's request body | 1 |
| the client's response body | 1 |
| `FIN` on close | 1 |
| **total** | **6** |

identify is these shapes minus one body write in each direction — the identify dialer never writes after
mss-select (`identify/src/utils.ts:232-262` only reads, then closes), giving 6 and 5.

---

## 3. Hold — what keeps arriving once the reservation exists

All rates are **per connected peer, per minute**, client → relay.

| Source | Interval | yamux frames / event | **DO requests / min** | Where the interval is set |
|---|---|:---:|:---:|---|
| **libp2p `ConnectionMonitor`, client → relay** | **10 s** | 7 | **84** | `node_modules/libp2p/src/connection-monitor.ts:8` `DEFAULT_PING_INTERVAL_MS = 10000`; loop at `:94-124` |
| **libp2p `ConnectionMonitor`, relay → client** | **10 s** | 6 | **72** | same file, running on the object |
| yamux keepalive, client's own ping | 30 s | 1 | 4 | `@chainsafe/libp2p-yamux/dist/src/config.js:5` `keepAliveInterval: 30_000`; started at `muxer.ts:123-137` |
| yamux keepalive, client's ACK to the relay's ping | 30 s | 1 | 4 | `muxer.ts:359-361` `handlePing` → `sendPing(id, Flag.ACK)` |
| circuit-relay reservation refresh | **115 min** | 7 | 0.12 | see §3.3 |
| **Pinned hold total** | | | **164 / min** | |

### 3.1 The connection monitor is the answer, and this repository does not touch it

`node_modules/libp2p/src/libp2p.ts:133-135`:

```ts
if (init.connectionMonitor?.enabled !== false) {
  this.configureComponent('connectionMonitor', new ConnectionMonitor(this.components, init.connectionMonitor))
}
```

`undefined !== false` is true, so it is constructed unless explicitly disabled.
**`grep -rn --include='*.ts' --exclude-dir=dist "connectionMonitor" packages/` returns nothing** — no
override exists anywhere in this repository, so it is running on all three tiers: the hosted object
(`packages/cloudflare/src/hosted-libp2p.ts:318`), the browser tab
(`packages/browser/src/browser-node.ts`) and the Node backbone (`packages/node/src/fabric-node.ts`).

What it does every 10 seconds, per connection (`connection-monitor.ts:94-124`) is **not** a cheap probe.
It opens a whole new libp2p stream:

```ts
stream = await conn.newStream(this.protocol, { signal, runOnLimitedConnection: true })
const bs = byteStream(stream)
await Promise.all([ bs.write(crypto.getRandomValues(new Uint8Array(PING_LENGTH))), bs.read({ bytes: PING_LENGTH }) ])
await stream.close({ signal })
```

That is the 7-frame shape from §2.1 in full: stream open, multistream-select for
`/ipfs/ping/1.0.0`, two window updates for the negotiation, 32 bytes out, one window update for the
32-byte echo (`@libp2p/ping/src/ping.ts:74` `stream.send(buf)`), and a FIN. **Every ten seconds. Forever.**

And it runs symmetrically. The object registers `ping: ping()`
(`packages/cloudflare/src/hosted-libp2p.ts:339`) and the tab registers it too
(`packages/browser/src/browser-node.ts:2033`), so the protocol is supported in both directions and the
monitor takes the success path rather than the `UnsupportedProtocolError` path at
`connection-monitor.ts:129`. The peer's share of answering the relay's ping is the 6-frame shape:
2 mss replies, its 32-byte echo, two window updates and a FIN.

`runOnLimitedConnection: true` is passed by the monitor, but it is not load-bearing here — the tab's
connection to the hosted relay is a direct WebSocket, not a relayed circuit, so no limits apply.

### 3.2 The keepalive question, answered plainly

The brief asked whether the yamux keepalive lands on the object as an inbound frame or leaves it as an
outbound one, and whether that kills the keepalive theory.

**It does not kill it, but it demotes it to a rounding error — 8 of 164 frames per minute, 5 %.**
Both halves of the bidirectional keepalive produce inbound frames, and that is the part worth being
explicit about:

- The peer's own ping is a client-initiated frame (`muxer.ts:126-137`, `enableKeepAlive: true` at
  `config.js:4`, not overridden — all three `yamux()` call sites are bare: `hosted-libp2p.ts:335`,
  `browser-node.ts:2026`, `fabric-node.ts:2233`). **Inbound. Billed.**
- The relay's ping is outbound and free — but the peer's `Flag.ACK` reply to it
  (`muxer.ts:358-361`) is **inbound. Also billed.**

So "the relay pings, therefore it is outbound, therefore free" is wrong: the relay's keepalive costs the
object one inbound pong per interval. What is true is that at 30 s it is 25× cheaper than the connection
monitor at 10 s, and turning it off would recover 5 % of the bill.

### 3.3 Reservation refresh is not a factor

`@libp2p/circuit-relay-v2/src/transport/reservation-store.ts:272`:

```ts
const timeoutDuration = Math.min(Math.max(expiration - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), Math.pow(2, 31) - 1)
```

with `REFRESH_TIMEOUT = 5 min` (`:23`). The client's cadence derives from the **granted** expiry, not from
a constant in the client: this tier grants `reservationTtl: RELAY_MAX_RESERVATION_TTL_MS`
(`packages/cloudflare/src/hosted-libp2p.ts:238`) = `7_200_000` ms
(`packages/libp2p/src/constants.ts:198`), so the refresh timer is 6 900 000 ms — **115 minutes**, 7 yamux
frames a time. 0.12 DO requests per minute.

*(Flagged in passing: `@libp2p/circuit-relay-v2/src/constants.ts:12-15` documents
`DEFAULT_MAX_RESERVATION_TTL` as "How often to check for reservation expiry". That docstring is wrong —
the value is a TTL, not a check interval. It does not affect anything above, because this tier passes its
own `reservationTtl`.)*

---

## 4. Does 165 fit, and at what hold time

```
165 = 51 + 164 × T   ⇒   T = 0.70 min = 42 seconds
```

**Yes, it fits — and the fit is the finding.** A tab that loads the page, dials the hosted relay,
completes identify in both directions, takes a reservation, and then closes about forty seconds later
costs 165 Durable Object requests. That is an entirely ordinary visit.

The more useful way to read the same arithmetic is that the **hold rate alone is 164 per minute**, which
to the precision of a quotient *is* 165. So:

> **`REQUESTS_PER_RESERVATION = 165` is, near enough, the cost of one peer-minute.**

That reframes the constant. It is not a per-reservation constant at all — it is a per-connection-minute
rate that happened to be divided by a reservation count. Two consequences:

- **It is an under-estimate for any run where tabs stayed open longer than a minute.** A tab held for the
  five minutes a demo takes costs 51 + 820 = **871**, not 165. Ten minutes is **1 691**.
- **It over-attributes to reservations, but not in the direction previously assumed.** The cost is driven
  by *connections held*, not by *reservations granted*. A peer that connects and never reserves — a failed
  handshake that leaves the socket open, a peer refused a slot, a probe — costs the same 164/min.

### 4.1 Is the numerator polluted by something other than reservations?

Only marginally, and this can be bounded from figures the plan already states rather than invented here.
Using 39-05-PLAN.md's own inputs — `PROBE_REQUESTS_PER_VISIT = 1` and `FUNNEL_POSTS_PER_VISIT ≤ 7` — the
HTTP surfaces account for at most 8 requests per visit; at 6 615 visits that is **≤ 52 920, i.e. ≤ 4.8 %**
of 1 100 232.

The standing alarm cost is smaller still. `packages/cloudflare/src/worker.ts:693` `alarm()` is itself an
invocation, and it re-arms unconditionally at `packages/cloudflare/src/expiry-alarm.ts:207`. The period is
`EXPIRY_SWEEP_INTERVAL_MS = providerRecordPolicy().interval` (`expiry-alarm.ts:64`) = `validity / 4`
(`packages/libp2p/src/constants.ts:415`) with `PROVIDER_RECORD_VALIDITY_MS = 3_600_000`
(`constants.ts:386`) — **15 minutes, 4 an hour, 96 a day**, floored at 60 s by
`MIN_RESCHEDULE_INTERVAL_MS` (`expiry-alarm.ts:88`). Against 1 100 232 that is **0.009 %**.

**So ~95 % of the numerator is inbound WebSocket frames, and the model above accounts for them.** The
answer to "what dominates the quotient" is not background traffic. It is the connection monitor.

---

## 5. The owner's levers, with the `file:line` where each interval is set

Ordered by how much they recover.

| Lever | Current value | Where it is set | Recovers |
|---|---|---|---|
| **`connectionMonitor.pingInterval`, or `connectionMonitor.enabled: false`** | 10 000 ms, enabled | `node_modules/libp2p/src/connection-monitor.ts:8`; gate at `node_modules/libp2p/src/libp2p.ts:133`. **Set nowhere in this repository** — it is a bare default on all three tiers. | **95 % of the hold cost.** At 60 s it drops from 156/min to 26/min. Disabled entirely: to 8/min, a **20× cut**. |
| `yamux({ keepAliveInterval })`, or `enableKeepAlive: false` | 30 000 ms, enabled | `node_modules/@chainsafe/libp2p-yamux/dist/src/config.js:4-5`. Call sites are bare: `packages/cloudflare/src/hosted-libp2p.ts:335`, `packages/browser/src/browser-node.ts:2026`, `packages/node/src/fabric-node.ts:2233` | 5 % of the hold cost |
| Reservation TTL | 7 200 000 ms | `packages/libp2p/src/constants.ts:198`, wired at `packages/cloudflare/src/hosted-libp2p.ts:238` | **~nothing — 0.07 %.** Worth recording, because TTL looks like the obvious lever and is not one. |
| Alarm period | 900 000 ms | `packages/cloudflare/src/expiry-alarm.ts:64`, floor at `:88` | 0.009 %. Not a lever. |

Two things follow that are worth stating as decisions rather than numbers:

- **The dominant lever is a config key that nobody chose.** 95 % of the recurring bill comes from a
  library default that no line in this repository sets, on either end of the connection. Setting
  `connectionMonitor` on the hosted object alone recovers 72 of 164 frames/min (44 %) without touching a
  single peer; setting it on both ends recovers 156 of 164 (95 %).
- **The trade is liveness detection, and it is real.** `abortConnectionOnPingFailure` defaults to `true`
  (`connection-monitor.ts:13`) — the monitor is what tears down dead connections. Lengthening the interval
  lengthens the window in which the object holds a socket to a peer that is gone. That is the owner's
  trade, and it is not made here.

---

## 6. Things that produce zero frames, reported because they were expected to produce some

- **Muxer negotiation: 0 frames.** §2, P3. Noise's early-muxer extension removes the round trip entirely.
- **Inbound stream open: 0 frames.** The `ACK` is not its own frame; it rides the first outgoing frame
  (`yamux/src/stream.ts:252-259`, `muxer.ts:455-462`).
- **Window updates draw no reply.** `handleWindowUpdate` (`stream.ts:180-203`) never calls
  `sendWindowUpdate`, so the doubling does not cascade.
- **`identifyPush`: 0 frames while idle.** It is registered (`hosted-libp2p.ts:338`,
  `browser-node.ts:2029`) but fires on address change, debounced 1 s
  (`@libp2p/identify/src/consts.ts:26`), not on a timer.

---

## 7. What the object pays that has nothing to do with any peer

For completeness, since the brief asked for the standing per-object floor:

- `alarm()` — **96 a day** (§4.1). Independent of peers, independent of connections.
- `webSocketClose` is itself an invocation (`packages/cloudflare/src/worker.ts:667`) — **+1 per
  connection at teardown**, not counted in the 51 above.

---

## 8. Unresolved — listed rather than filled in by arithmetic

1. **kad-dht periodic traffic.** `@libp2p/kad-dht/src/constants.ts:46` `QUERY_SELF_INTERVAL = 5 * minute`
   and `:55` `TABLE_REFRESH_INTERVAL = 5 * minute` are pinned, and the DHT is wired on all three tiers
   (`hosted-libp2p.ts:363`, `browser-node.ts:2054`, `fabric-node.ts:2262`). **The per-event frame cost was
   not pinned** — a query fans out over peers with a concurrency and a peer-selection policy this reading
   did not trace. It can only add to 164/min, never subtract, so the figures above are a **floor**.
2. **Whether a zero-length WebSocket frame is delivered as a `webSocketMessage`.** Noise message A is
   `[uint16 length, 32-byte ephemeral key, 0-byte ciphertext]` — the third buffer is empty because
   `CipherState.encryptWithAd` returns the plaintext unchanged when no key is established yet
   (`noise/src/protocol.ts:32-34`, `ZEROLEN` at `:11`). If workerd elides it, P2 is 5 rather than 6 and
   setup is 50 rather than 51. **±1 on a total of 165; it does not move the conclusion.**
3. **Whether every one of the 6 615 reservations corresponds to a distinct WebSocket connection.** The
   relay-service journal counts inbound hop streams, and
   `packages/cloudflare/src/relay-counters.e2e.test.ts`'s header records that *"the wire cannot tell
   RESERVE from CONNECT"*. A peer that refreshes, or reconnects, contributes more than one. The divisor is
   therefore soft in a direction that would make the true per-peer cost **higher**, not lower.
4. **The actual distribution of hold times in the 2026-09-03 run.** Nothing in the source predicts it. The
   42-second figure in §4 is what the observed quotient *implies* under this model — it is not an
   observation, and it is the one number here that is a consequence rather than a reading.

---

## 9. What this reading does and does not establish

**Establishes**, entirely from source: that the object is invoked once per inbound WebSocket message with
nothing coalescing; that a peer's every libp2p write becomes two of them; that setup is 51; that the
recurring floor is 164 per connected peer-minute; that 95 % of that floor is one library default nobody
set; and that reservation TTL — the lever that looks obvious — is worth 0.07 %.

**Does not establish**, and no source reading could:

- **That the deployed object's peers behave as this model says.** These are the code paths; whether the
  2026-09-03 population exercised them at these rates is an observation nobody has taken. In particular
  §8.4 is unmeasured.
- **That workerd's accounting matches its documented premise.** Whether Cloudflare bills one request per
  `webSocketMessage` invocation — including empty frames, including 2-byte length-prefix frames — is a
  property of the platform's meter, not of this code. The whole model rests on that premise, which this
  repository holds on the strength of the 2026-09-03 debug note and not on a source reading.
- **That no other periodic traffic exists.** §8.1 is open, and it can only push the number up.

**And nothing here was run.** No relay was stood up, no client dialled, no frame counted at runtime. Every
figure is a count of `send()` call sites and interval constants along a path traced by reading. A
measurement would differ from these numbers wherever a code path is reached that this reading did not
trace — and §8.1 names the most likely place for that to happen.
