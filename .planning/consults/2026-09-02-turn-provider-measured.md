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

Reproduce with `node tools/turn-provider-probe.mjs`; the `ENOTFOUND` arrives as a socket error
rather than a timeout, which is itself the distinction between *no such name* and *no answer*.

**AMENDED 2026-09-02 (Phase 34, Task 1) — the editing step is gone.** This line read *"after
editing its `HOSTS` list"*. The tool now reads `STUN_SERVERS` from
`packages/browser/src/ice-configuration.ts`, so its STUN legs ARE the fabric's stated list and a
name dropped there stops being probed here in the same change. A hand-edited `HOSTS` was a second
list, and a second list can disagree with the first — the exact defect this consult argued the
ICE configuration should stop having. The TURN legs stay written out in the tool, because they
are the provider question rather than the fabric's STUN list. Re-run 2026-09-02 after the change
reproduced every reading in the table above unchanged.

---

## The free tier is real and does not reach this topology — and the exposure is small anyway

**Raised by the owner 2026-09-02:** Cloudflare's TURN service is free of charge when used
natively alongside their Realtime **SFU**. That is accurate and it is worth stating why it
does not apply here, rather than quietly not using it.

An SFU forwards **media tracks** — audio and video — between participants. This fabric's
peer-to-peer path is a WebRTC **data channel** carrying control messages and partial results;
there is no media, and therefore no SFU for the traffic to be native to. Our TURN use is the
standalone kind, which is billed on relayed traffic.

**This is a billing fact, not a protocol fact, and it was not measured.** The probe above can
tell you a server implements TURN; nothing this repository can run tells you what it costs.
The honest check is the project's own discipline pointed at money: configure the spending
alert **first**, switch TURN on, drive a known volume, and **read the bill**. Not a document.

### What can be measured is the volume, and it was — today

`packages/browser/src/data-cost.ts` holds `DISCLOSED_DATA_COST_BYTES`, standing on three runs
of the representative task on 2026-09-02 reporting `run.egress.totalBytes`: **11 387**,
**10 971**, **11 387** bytes. That figure is **egress only** — the inbound leg is unmeasured
and is named as excluded in that file rather than guessed at.

Doubling it to bound the unmeasured inbound leg, one task run relayed through TURN costs
about **22.2 KiB in total**, which gives:

| | |
|---|---|
| task runs per GB of TURN traffic | ≈ **47 000** |
| total task runs before 1 GB, at a **15 %** relay rate | ≈ **310 000** |

**The 10–20 % relay-required figure is a proxy and must be labelled as one wherever it is
quoted** — it comes from a different protocol, and `RUN-05` criterion 5 forbids presenting it
as a measurement. The real rate is one of the numbers the public run exists to take.

### The design already caps what TURN can carry

This is structural rather than hopeful. `PROJECT.md`'s WebRTC constraint states that the
browser mesh **cannot carry bulk data**: partials stay small and artifacts are fetched over an
IPFS gateway. So an artifact's weight never crosses a TURN relay — only control traffic and
small partials can, and those are bounded by a design rule that predates this decision.

A heavier task than the colouring demo would move more, and that is the figure to re-take
before the cohort arrives rather than to extrapolate from here.
