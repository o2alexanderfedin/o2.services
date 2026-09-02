# The TURN provider, settled by a probe rather than by documentation

**2026-09-02. Owner ruling: Cloudflare TURN.** The ruling was made after a measurement
corrected the first instruction, and the correction is the point of this note.

## What was asked, and why it could not stand

The owner's instruction was *"use Google"*. Google runs public **STUN** servers and has never
run a public **TURN** service — the two are routinely conflated, and credentials for
"Google TURN servers" circulate widely as dead scraped entries. This project does not settle
such questions by citation (`PROJECT.md`: *we should not rely on the documentation found;
instead, we should experiment to get empirical proofs*), so it was probed.

## The probe

`tools/turn-provider-probe.mjs` — raw UDP, no library. It sends each host two RFC 5389/5766
messages and reads what comes back:

1. a **STUN Binding** request (method `0x0001`) — the **positive control**. An answer proves
   the packet arrived, UDP is not blocked, and the server is alive.
2. a **TURN Allocate** request (method `0x0003`) carrying `REQUESTED-TRANSPORT` = UDP, with no
   credentials. **A TURN server must answer `401 Unauthorized`** (RFC 5766 §6.2 — the
   unauthenticated Allocate is the first leg of the long-term credential handshake). A server
   that does not implement the method answers nothing.

Both readings are taken in the same run against the same host under the same 2-second budget,
so the comparison cancels the network conditions of the moment rather than assuming them.

## What came back

| host:port | STUN Binding | TURN Allocate |
|---|---|---|
| `turn.cloudflare.com:3478` | `0x0101` success | **`0x0113` error 401** |
| `turn.cloudflare.com:53` | `0x0101` success | **`0x0113` error 401** |
| `stun.l.google.com:19302` | `0x0101` success | **no reply, 2 s** |
| `stun1.l.google.com:19302` | `0x0101` success | **no reply, 2 s** |
| `stun.l.google.com:3478` | `0x0101` success | **no reply, 2 s** |

`turn.cloudflare.com` resolves to `141.101.90.1`.

**Google's servers answer STUN and do not implement TURN.** The silence is not a network
failure: the same socket, the same host and the same run got a Binding success response
immediately before. **Cloudflare's endpoint demands credentials**, which is a TURN server
behaving exactly as specified.

## The finding that outlives the choice

**Cloudflare answers TURN on port 53 as well as 3478.** Port 53 is the DNS port, and it
survives the restrictive corporate and mobile-carrier firewalls that drop 3478 — which is
precisely the population TURN exists to serve, and precisely the population `BENCH-08` is
supposed to count. A rung offered only on 3478 is absent for the visitors most likely to need
it. Both ports belong in the `iceServers` list, and the reason belongs beside them.

**Not measured here, and not to be assumed:** whether both ports are equally reachable from
the networks of the actual cohort. That is a question the public run answers, not this probe.

## What this decides and what it does not

**Decided:** the provider is Cloudflare — one vendor, one account, one spending alert, which
is what `STACK.md` argued for and what the owner ruled. STUN stays with Google, which is free
and is all STUN needs to be.

**Not decided, and each is an owner act:** creating the TURN key on the owner's Cloudflare
account, and the sharding to three regions, which waits on Phase 33. TURN is billed on
relayed traffic, so it belongs under the same alert as the Durable Objects and must not be
switched on before that alert exists — the `HOST-10` ordering, which this milestone has
already lost once.

---

## What the deployed client actually uses today — and one of the four is dead

The probe was pointed at the STUN list the browser tier is running on **right now**, which is
not a list this repository wrote. `packages/browser/src/browser-node.ts:1474` constructs
`webRTC()` with **no options**, so the four defaults in
`node_modules/@libp2p/webrtc/dist/src/constants.js:11-16` are the live configuration. Nothing
in `packages/*/src/` sets `iceServers` or `rtcConfiguration` at all — grepped, zero hits.

| default STUN server | probed 2026-09-02 |
|---|---|
| `stun.l.google.com:19302` | Binding success |
| `global.stun.twilio.com:3478` | Binding success |
| `stun.cloudflare.com:3478` | Binding success |
| `stun.services.mozilla.com:3478` | **`ENOTFOUND` — the name does not resolve** |

**Confirmed against three independent public resolvers**, so it is not this host's DNS:
`8.8.8.8`, `1.1.1.1` and `9.9.9.9` all answer **`NXDOMAIN`**, while the same resolvers return
`162.159.207.0` for `stun.cloudflare.com` in the same breath — the positive control that
separates *this name is gone* from *DNS is not working here*.

**So every tab in this fabric performs a failing DNS lookup on every ICE gathering.** Three
servers answer, so nothing is broken; what is spent is latency on the exact path — candidate
gathering — where `RUN-04`'s fourth funnel stage is measured. A stage-four number taken while
a quarter of the configured servers cannot be resolved is measuring the library's stale list
as much as the visitor's network.

**This is an argument for making the ICE configuration explicit, and it is a stronger one than
adding TURN.** A default list is a dependency on four third parties this project never chose,
never measured, and cannot notice rotting — it rotted, and nothing here would have said so.
Phase 34's first task should state `iceServers` in this repository, drop the dead entry, and
carry the reason beside each survivor. The Cloudflare TURN rung then goes into the same
structure through `rtcConfiguration`'s function form rather than beside it.

Reproduce with `node tools/turn-provider-probe.mjs` after editing its `HOSTS` list; the
`ENOTFOUND` arrives as a socket error rather than a timeout, which is itself the distinction
between *no such name* and *no answer*.
