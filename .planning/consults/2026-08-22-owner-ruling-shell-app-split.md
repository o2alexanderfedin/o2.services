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
*only* to dial the relay. The seed listens on `/ip4/0.0.0.0/tcp/${wsPort}/ws` (`seed-server.ts:463`)
— **insecure `ws`**.

So the ruling moves the certificate requirement rather than deleting it. It moves it off the
visitor and onto the **relay**, which is infrastructure this project controls:

| link | needs a CA certificate? |
|---|---|
| browser → **shell** | yes — and it has one, from the trusted host. Solved by the ruling. |
| browser ↔ browser | **no.** WebRTC uses DTLS with self-signed certificates by design; no CA is involved at any point. Unaffected. |
| browser → **relay** | **yes, today** — an `https://` shell can only dial `wss://`, and the relay currently listens on plain `ws`. |

### RULED 2026-08-22 (second ruling, same day) — the relay is hosted too

**Both the shell and the relay are hosted by Cloudflare and/or the company website, with regular
commercial certificates. Those certificates are what sign the fabric's decentralised root
certs.** So the third row is answered the same way as the first: the relay carries an ordinary CA
certificate because it lives on hosted infrastructure, and a browser dials it as `wss://` with
nothing to negotiate.

**Neither option below is needed.** `AutoTLS` solves "this node is on someone's home connection
and needs a certificate" — not a problem a Cloudflare-hosted relay has. `webRTCDirect` solves
"there is no certificate authority available at all" — also not the case. Both are recorded here
as the alternatives that were considered and ruled out, not as pending work.

The one implementation consequence: the relay's listen address becomes `/tls/ws` rather than
today's plain `/ws` (`seed-server.ts:427`), and the browser dials `wss://`. That is a
configuration of hosted infrastructure, not a design question.

*(CORRECTED 2026-08-22 — the consequence stands; only the anchor was wrong. The listen line is
`seed-server.ts:463` — ``listen: [`/ip4/0.0.0.0/tcp/${wsPort}/ws`, '/ip4/0.0.0.0/tcp/0']``. `:427`
is not code at all: it lands on comment prose in the :420–:428 block that explains the listen list
ahead of `FabricNode.start({` at :429 — "listen list rather than from an option, so there is
nothing further to switch". That is how the drift happened: the anchor pointed at a sentence
**about** the listen list instead of the list itself, and it has been wrong since 00faea7, the
commit that wrote it. Re-run: `grep -n 'ip4/0.0.0.0/tcp' packages/node/src/seed-server.ts` → 463.)*

*(Below: the two options as they stood before this ruling, kept for the record.)*

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
