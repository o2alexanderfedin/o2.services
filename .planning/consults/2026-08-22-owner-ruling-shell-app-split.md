# Owner ruling 2026-08-22 — the shell/app split, and what it does to the certificate question

**Ruled by the owner.** A web application here is two parts:

- a **shell** (container), hosted on a *trusted* host — Cloudflare, a company's own site, and so
  on, with an ordinary CA-issued certificate; and
- the **app**, which arrives into that shell **over P2P**.

So the browser only ever validates a normal commercial certificate. The fabric's own
decentralised certificates live *inside* the application, below the browser's TLS check.

**Consequence: the interstitial is not a cost this project pays.** Task #24's whole
self-signed-versus-AutoTLS trade was framed around "every visitor sees a scary warning once."
Under this architecture no visitor sees one, because no visitor is ever pointed at a
self-signed origin. **That half of #24 is closed by ruling, not by measurement.**

## What the four-browser measurement is still worth

The reading itself (`2026-08-22-cert-exceptions-are-keyed-per-port.md`) stands and keeps two uses:

1. **It scopes correctly now.** A certificate exception being keyed to host *and port* in Firefox
   and Safari only ever bit the **LAN seed-server** path — a laptop serving a phone on the same
   network, which is a development and demo convenience, not the production shape. The finding is
   still true; it simply is not on the product's critical path.
2. **The hazard note in `seed-server.ts` is still worth keeping**, because that file is exactly the
   development path the ruling does *not* cover.

## The successor question this ruling creates, and it is a real one

**A shell on `https://` cannot dial `ws://`.** Mixed-content rules block it, which
`seed-server.ts` already states in its own words: *"WebSockets over `ws://` are likewise fine from
an `http://` page; it is only an `https://` page that would refuse them as mixed content."*

Today's browser node dials the relay over plain WebSockets — `browser-node.ts:1400` lists
`transports: [webSockets(), webRTC(), circuitRelayTransport()]`, and `webSockets()` there exists
*only* to dial the relay. The seed listens on `/ip4/0.0.0.0/tcp/${wsPort}/ws` — **insecure `ws`**.

So the ruling moves the certificate requirement rather than deleting it. It moves it off the
visitor and onto the **relay**, which is infrastructure this project controls:

| link | needs a CA certificate? |
|---|---|
| browser → **shell** | yes — and it has one, from the trusted host. Solved by the ruling. |
| browser ↔ browser | **no.** WebRTC uses DTLS with self-signed certificates by design; no CA is involved at any point. Unaffected. |
| browser → **relay** | **yes, today** — an `https://` shell can only dial `wss://`, and the relay currently listens on plain `ws`. |

**Two ways to satisfy the third row, neither of which asks anything of a visitor:**

- **AutoTLS on the relay** (`@ipshipyard/libp2p-auto-tls`) — a real Let's Encrypt certificate at
  `<peerId>.libp2p.direct`, giving a browser-dialable `wss://`. Needs the relay publicly
  reachable on its port.
- **`webRTCDirect()`** — browser-dialable with **no CA certificate, no DNS name and no relay**,
  because the certificate hash travels in the multiaddr. It is **not currently among the browser
  transports** (`browser-node.ts:1400`), so adding it is real work — but it is the only option
  that needs no certificate authority anywhere on the path, and pairing it with `@libp2p/keychain`
  keeps the hash stable across restarts.

This is not a decision to take here. It is the question that replaces the one the ruling closed,
and it is a better question: it is about infrastructure the project runs, not about what a
stranger's browser shows them.
