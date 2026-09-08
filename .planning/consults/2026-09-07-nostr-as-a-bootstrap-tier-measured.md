# Nostr as a bootstrap tier — measured, 2026-09-07

**Question asked:** can Nostr do for bootstrapping what the Cloudflare tier does?

**Answer in one line:** it can carry the *documents* — the bootstrap seed, the status reading and
the kill switch — and it **cannot** replace the relay, because js-libp2p's browser-to-browser
WebRTC needs a live libp2p **stream** and Nostr is a mailbox.

**And read §6 item 1's correction before quoting the buys.** The first draft of this document said
carrying the seed on Nostr *"stops the bootstrap depending on GitHub Pages"*. It does not, and it
does not remove Cloudflare either — the page is served by the first and the document names the
second. What it removes is the **origin** as the only place an address may come from, which is a
portability argument for embedded hosts and for a relay that moves. The two things that genuinely
leave the billed object are the **kill switch** and the **`/self` poll**, items 2 and 3.

Everything below was measured against real public relays from this machine on 2026-09-07, with a
throwaway key and a minimal NIP-01 client written on `@noble/curves` and `@noble/hashes`, both
already in this tree. No dependency was added. The probes are in the session scratchpad; the
numbers are here.

---

## §1 What the Cloudflare tier actually does, separated

Lumping these together is what makes the question look harder than it is. The hosted object has
**five** roles and they have nothing in common but their host:

| # | Role | Where |
|---|---|---|
| 1 | **Circuit Relay v2 server** — carries the `/webrtc-signaling/0.0.1` stream between two browsers | `circuitRelayServer()` in `packages/cloudflare/src/hosted-libp2p.ts` |
| 2 | **Inbound WebSocket listener** — a dialable libp2p endpoint, `/dns4/…/tcp/443/tls/ws` | `worker.ts` `#upgrade` |
| 3 | **The bootstrap seed** — relay address + PeerId, fetched by every visitor at load | `packages/browser/demo/public/bootstrap.json`, written by `scripts/deploy-pages.sh` |
| 4 | **The status reading** — `GET /self`: PeerId, version, traffic, admission, killSwitch | `worker.ts` |
| 5 | **The kill switch** — `POST /admission` behind an operator key | `admission-flag.ts` |

Roles 3, 4 and 5 are **signed documents that change rarely and are read by everyone**. Roles 1
and 2 are **live bidirectional byte transport**. Nostr is very good at the first kind and
structurally unable to do the second.

---

## §2 The measurement that decides it — signalling needs a stream, not a mailbox

Read out of the installed `@libp2p/webrtc@6.0.27` rather than from documentation:

- `src/private-to-private/transport.ts:160` — `dial()`'s own comment: *"dial connects to a remote
  via the circuit relay **or any other protocol** and proceeds to upgrade to a webrtc
  connection."*
- `src/private-to-private/initiate-connection.ts:63` — what it then does:
  `connection.newStream(SIGNALING_PROTOCOL, …)`, where `SIGNALING_PROTOCOL` is
  `/webrtc-signaling/0.0.1` (`src/constants.ts:89`).

So the requirement is **a libp2p connection to the other peer**, over which a stream is opened.
Circuit Relay v2 is merely the usual way to obtain one; the transport does not care which. But a
libp2p connection is a duplex byte stream carrying multistream-select, a Noise XX handshake and a
muxer — and Nostr offers publish/subscribe of signed events, not a byte stream.

Tunnelling one through the other is possible and is a bad trade. Noise XX alone is three
messages, multistream-select adds more, and **each hop through a relay measured 161–351 ms**
(§3). A handshake before SDP is even exchanged would cost seconds, on top of a per-event rate
limit. `_onProtocol` (`transport.ts:198`) also constructs its own `RTCPeerConnection`, so there
is no injection point for one established elsewhere: doing WebRTC signalling over Nostr means
**writing a libp2p transport**, not configuring one.

**Therefore roles 1 and 2 stay where they are.** Nostr is not a relay replacement and this
document does not propose it as one.

---

## §3 Ephemeral events carry SDP-sized payloads, and fan out to other connections

The first thing a web search says about this is *"ephemeral events would likely be rate limited
and blocked on most public relays."* Measured, that is **wrong for a single event and right for a
burst** — and the difference is the whole engineering answer.

Kind `20001` (in NIP-01's ephemeral 20000–29999 band), 3 009 bytes of SDP-shaped content,
published on one socket and read on a **second, separate connection** to the same relay:

| relay | reached a second connection | content intact | latency |
|---|---|---|---|
| `relay.damus.io` | yes | yes | 251 ms |
| `nos.lol` | yes | yes | 351 ms |
| `relay.primal.net` | yes | yes | 202 ms |
| `nostr.mom` | yes | yes | 268 ms |
| `relay.snort.social` | yes | yes | 161 ms |
| `relay.nostr.band` | — | — | connect timed out at 10 s |

The two-socket shape matters. A first probe published and subscribed on **one** socket, which a
relay can satisfy by echoing to the sender — that measures nothing about fan-out, which is the
only property signalling would need. The table above is the corrected reading.

---

## §4 Rate limiting is real, per-relay, and the reason it is not fatal

Thirty ephemeral events sent as fast as the socket took them — the shape of a few simultaneous
handshakes, not a stress test:

| relay | accepted | refused | reason | elapsed |
|---|--:|--:|---|--:|
| `relay.damus.io` | **4** | **26** | `rate-limited: you are noting too much` | 1 232 ms |
| `nos.lol` | 30 | 0 | — | 765 ms |
| `relay.primal.net` | 30 | 0 | — | 427 ms |
| `nostr.mom` | 30 | 0 | — | 369 ms |
| `relay.snort.social` | 30 | 0 | — | 337 ms |

**And it escalates.** After that burst, `relay.damus.io` stopped accepting the WebSocket
handshake at all — later connections failed with `Received network error or non-101 status code`.
A public relay will ban a client that behaves like this, at the socket, without warning.

The reading is not "Nostr is rate limited". It is **"each relay has its own policy and they are
not correlated"** — which is the same shape as this project's existing relay story, and is
answered the same way: write to several, read from several, treat any one as expendable. The
operational rule that follows is a hard one, though: **a bootstrap client must never burst.** One
read at page load is what this design is for; a signalling channel is what it is not.

---

## §5 The bootstrap document, measured end to end

NIP-78 application data, kind `30078` — a *parameterized replaceable* event: the relay keeps only
the newest per `(pubkey, kind, d-tag)`, which is exactly a mutable document under a stable name.
`d` tag `o2.services/bootstrap`, content the same 322-byte shape `bootstrap.json` already has.

**Write fan-out:** accepted by all five relays written to.

**Cold read — a fresh socket, which is what a visitor's first page load pays:**

| relay | connect | connect + read | found | bytes match |
|---|--:|--:|---|---|
| `nos.lol` | 501 ms | **667 ms** | yes | yes |
| `nostr.mom` | 509 ms | **677 ms** | yes | yes |
| `relay.snort.social` | 495 ms | **692 ms** | yes | yes |
| `relay.primal.net` | 710 ms | **894 ms** | yes | yes |
| `relay.damus.io` | 872 ms | 1 131 ms | yes | yes |
| `relay.nostr.band` | — | — | connect timed out at 8 s | — |

**Replacement works**: a second document under the same `d` tag superseded the first on every
reachable relay, one event returned, new content, old content gone.

**And rollback is refused by the relays themselves.** Republishing the *older* document with an
older `created_at`:

| relay | write | what it serves afterwards |
|---|---|---|
| `nos.lol` | refused — `replaced: have newer event` | the new one |
| `relay.primal.net` | refused — `replaced: have newer event` | the new one |
| `nostr.mom` | refused — `replaced: have newer event` | the new one |
| `relay.snort.social` | accepted as `duplicate: already have this event` | the new one |

That is a **monotonic-version rollback refusal for free** — the same property
`packages/core/src/naming.ts` builds by hand for `NameRecord`, enforced here by infrastructure
this project does not run.

> **One correction recorded rather than smoothed over.** The first replace arm compared
> `DOC.replace('rc.12','rc.13')` against `DOC` — and the version string lived in the event's
> *tags*, not its content, so the "second" document was byte-identical to the first. Both
> `isNewVersion` and `stillOld` came back `true`, which is impossible, and that is the only
> reason the bug was visible. The table above is the re-measurement with two genuinely different
> documents and an assertion at the top of the probe that they differ.

---

## §6 What this would actually buy, and what it costs

### Buys

1. ~~**The bootstrap seed stops depending on GitHub Pages.** Today `bootstrap.json` is a file on a
   static host, written by `deploy-pages.sh` from the live node. A page that cannot reach that
   host has no way to knock. A Nostr document is readable from any of several unrelated relays.~~

   **CORRECTED THE SAME DAY, and it was wrong in both directions at once.** The owner asked which
   dependency this actually removes — GitHub Pages or Cloudflare — and the answer measured out of
   `packages/browser/src/tab-api.ts:1029` is **neither**:

   - `discoverRelays()` declares `source: 'query' | 'origin' | 'none'`. The `origin` source is
     `/bootstrap.json` on **the page's own origin**. The page is served by GitHub Pages, so a
     visitor who cannot reach GitHub Pages has no page at all — moving the document off it buys
     nothing in the one failure mode the sentence named.
   - And the document's *content* is the Cloudflare relay's multiaddr and PeerId. Fetching that
     name from a Nostr relay instead of from a file does not change which peer is then dialled.
     §2 already says the relay stays; this bullet forgot its own §2.

   **What the Nostr copy actually removes is narrower and real: the ORIGIN as the only place an
   address can come from.** That matters in exactly the cases where the client is not served by
   the host that knows the address:

   - **embedded in a host application** — this project's own stated target, where there is no
     `/bootstrap.json` origin to ask and the address would otherwise be baked into a build.
     `tab-api.ts` warns in as many words against *"an address that can go stale in a build"*, and
     today the only alternative it offers is a `?relay=` query parameter, i.e. whatever found the
     page choosing where it knocks;
   - **a relay that moves.** `wrangler.jsonc` records the open choice that a domain the owner
     controls is a better long-term address than any `workers.dev` name, *"because this value
     reaches other peers' routing tables and a published address is painful to move."* A mutable
     document under a stable name, signed, rollback-refused by §5, is the thing that makes it
     less painful.

   So this is a **portability** argument, not an availability one, and it was filed under the
   wrong heading.
2. **The kill switch becomes a signed statement instead of a service.** Today a halt is a
   `POST /admission` to one Durable Object behind an operator key — measured on 2026-09-07 to
   have been inoperative since the first deploy and invisible while it was. A halt published as a
   replaceable event signed by the operator key is **verifiable by every client** against a
   pinned pubkey, needs no server this project runs, survives that server being down, and cannot
   be rolled back (§5). It is strictly a better shape for the same control.
3. **It removes Durable Object requests from the read path.** Every tab polls `/self` every
   30 000 ms, and *every WebSocket message is a billed request* — the measured driver of the
   1 100 232 requests that took the free tier down on 2026-09-03. Moving the poll to a Nostr
   relay moves that load to infrastructure nobody bills us for.
4. **It is a second, unrelated failure domain — for the DIRECTIVE, and not for the address.**
   The 2026-09-03 outage was Cloudflare error 1027 at the edge: the Worker never ran, so nothing
   this project could have written would have answered. A halt published to Nostr is still
   readable in that state, and a status reading still answers. **The address is not**, and saying
   otherwise would repeat item 1's mistake in a different bullet: an address whose relay is down
   is an address to a node nobody can dial, however many relays served the document. What
   survives an outage is the *ability to be told to stop*, which is worth having and is not the
   same as the fabric working.

### Costs, stated at full size

1. **The relay stays.** §2. This is an addition, not a replacement, and the object still has to
   exist for roles 1 and 2.
2. **A pinned pubkey is a new trust anchor**, and this project already has two sets that
   *"pin different sets"* (`trustAnchors`, `trustedIssuers`). A third would need saying which it
   is under, in the vocabulary `identity-protection.ts` already establishes rather than a fourth.
3. **Relay liveness is not ours.** `relay.nostr.band` failed to connect in every run;
   `relay.damus.io` banned this machine after one burst. A client must read from several and
   accept the first that answers, and must treat a relay's silence as *no reading* rather than as
   *no halt* — the rule `kill-switch.ts` already states for its own poll: **an operator's silence
   is not a stop order.**
4. **Everything published is public and permanent-ish.** That is already true of the bootstrap
   document and of `/self`. It must never become true of the funnel: `POST /funnel` carries
   visitor-derived counts and its population is `opted-in-only`. **Telemetry does not move to
   Nostr.**
5. **`secp256k1` schnorr is a new curve on the browser path.** It is already in the tree via
   `@noble/curves@2.2.0` — a transitive dependency of `@chainsafe/libp2p-noise` — so it costs no
   new dependency, but it is a second signature scheme beside Ed25519 and the guards that count
   crypto surface should be told which.

---

## §7 What was published to public infrastructure while measuring this

Stated plainly because it is an outward-facing act taken without asking. Under a **throwaway
key generated for the probe and discarded**, to five public relays:

- ephemeral events (not stored) with placeholder content;
- two replaceable `30078` documents whose only real string is
  `/dns4/o2-bootstrap.af-4a0.workers.dev/tcp/443/tls/ws/p2p/12D3KooW…rb7rsz` — the relay's
  address and PeerId, which are **already published** in `bootstrap.json` on a public website
  and answered by `GET /self` to anybody who asks.

No key, no visitor data, no unpublished figure. Nothing was disclosed that was not already
public, and the probe key is not this project's.

---

## §8 The smallest useful next step, if this is taken up

Not a phase, and deliberately not the kill switch first:

1. **Publish the bootstrap document alongside `bootstrap.json`, and read it as a fallback.**
   `deploy-pages.sh` already assembles that document from the live node — one more publish, to
   several relays, under a project key. The browser reads its own origin first, exactly as today,
   and falls back to Nostr only when that read fails. Nothing changes for a visitor whose page
   loads normally, and a visitor whose static host is unreachable gains a path that did not
   exist.
2. Only once that has been read live by a real visitor does the kill switch become worth moving,
   because a control nobody has yet read is a control nobody can yet trust — which is the lesson
   of 2026-09-07 stated in the other direction.

**Sources.** Everything numeric above is a measurement from this machine. The prior art that
prompted the search, none of which is load-bearing here:
[nostr-protocol/nips#771](https://github.com/nostr-protocol/nips/issues/771) (WebRTC signalling,
open),
[cipres/nostr_webrtc](https://codeberg.org/cipres/nostr_webrtc),
[ikarius6/entropy](https://github.com/ikarius6/entropy),
[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) for the ephemeral and
replaceable kind ranges.
