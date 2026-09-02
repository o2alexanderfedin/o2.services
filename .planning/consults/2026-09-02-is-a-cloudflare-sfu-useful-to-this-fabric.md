# Could Cloudflare's Realtime SFU be useful to this fabric?

**Asked by the owner 2026-09-02**, after the free-tier question. The answer is **yes in three
places and no in one**, and the line between them is already measurable by machinery Phase 32
built for exactly this purpose.

## The property that matters is not media

A Selective Forwarding Unit is usually described as video-conferencing infrastructure. The
property that reaches this project is topological, not medial: **one publisher, many
subscribers, and each participant holds ONE connection instead of N.** A mesh collapses into a
star at the network edge.

## The three admissible uses

### 1. Signalling

The SDP handshake already goes through Circuit Relay v2, and this project's own documents call
that relay **"a signalling channel, not a data path"**. It is therefore already a hosted
dependency. Swapping the signalling substrate for a better one does not move the
peer-to-peer line at all — and the gains are this repository's own measured numbers:

- The relay's budget is **64 KiB each way** — measured twice on 2026-09-02, on two unrelated
  relays in different processes over different transports, both returning a 49 152-byte echo
  for a 64 KiB request. An SFU has no such limit.
- **Each new browser-to-browser connection costs ≈1.04 s of handshake** (`CLAUDE.md`, the DHT
  reality check). With one connection per node that price is paid **once**, not per pair.
- Reservations are finite: 15 by library default, raised to 64 here
  (`packages/libp2p/src/constants.ts`). A star at the edge does not run out that way.

### 2. Discovery and rendezvous

A DHT walk between browsers costs seconds precisely because of the per-hop handshake above.
*"I am here, these are my capabilities"* published on a channel others subscribe to is the same
rendezvous without the per-hop price. Discovery is already partly hosted — `rendezvous.ts`
reads the relay's reservation store — so this too changes the substrate rather than the line.

### 3. A fallback rung below TURN

Phase 34's structure is direct WebRTC → TURN → relayed circuit, the last **control-only**. An
SFU data channel is strictly better than that third rung — no 64 KiB budget — and it would be
counted honestly in the **`relayed`** column by the counters that already exist.

## The one inadmissible use, and the line is measurable

**Carrying task data or partial results between nodes.** That is the **median outcome** for
hosted-relay systems, named in Phase 32's own criterion 3 with IPFS's measured cloud reliance
(arXiv:2309.16203) and Matrix's homeserver dominance as the two precedents. `TrafficSplitCounter`
and the relay-service journal exist to catch exactly this.

**So the rule is not an intention, it is a reading:** an SFU is admissible exactly to the extent
that its traffic lands in the **`relayed`** column and that column keeps being looked at. A
design that routes SFU traffic where it is counted `direct`, or not counted at all, has removed
the project's ability to answer whether it is still peer-to-peer.

## A correction to what was said an hour earlier

`2026-09-02-turn-provider-measured.md` states that Cloudflare's free TURN tier *"does not reach
this topology"*. That is correct **about the current topology and only about it**. The question
here is whether to change the topology — and if signalling moves onto the SFU, TURN alongside it
falls under the same native-use tier. The dismissal was right about today and framed as though
today were fixed.

## The pivot claim, and it is NOT measured

**Whether Cloudflare's Realtime SFU forwards data channels rather than only media tracks.**
Everything above turns on it. This project does not settle such questions by citation, and no
account exists here to probe with, so it is recorded as **unverified** rather than assumed.

**The experiment that settles it, and it is free:** a Realtime App ID costs nothing to create.
Two headless Chromium contexts in the Playwright harness this repository already drives — one
publishes a data channel, the other subscribes. Three readings: does it carry bytes at all;
round-trip latency against the current relay path as a comparative reading inside one run; and
whether a size ceiling exists and where it lands. Until that runs, nothing here may be built on.

## The cost that is not money, and it is the larger one

**Circuit Relay v2 is a protocol. The SFU is a product.** Anyone can run a relay, the owner
included, on their own hardware. Replacing a protocol dependency with a product dependency means
the fabric can no longer be stood up independently — which reaches the name *P2P Native Cloud*,
and reaches the commercial-licence track the sole-authorship rule exists to preserve.

## The resolution

**Take the SFU as an accelerant, never as a foundation:** a default path that has a working
fallback to Circuit Relay v2, plus a test that proves the fallback still works. Then the speed
is the project's and the dependency is not.

Nothing here is a decision. It is the reasoning, so that whichever way the owner rules, it does
not have to be derived twice.
