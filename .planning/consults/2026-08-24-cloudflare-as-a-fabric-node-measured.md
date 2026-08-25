# Cloudflare as a fabric node — measured 2026-08-24, not read

**Every number here was taken against a *deployed* Worker**, never `wrangler dev`. That
distinction is load-bearing rather than fastidious: the local runtime diverges from
production on exactly the two questions this investigation turned on — runtime WASM
compilation and whether the clock advances. A prototype run locally would have said yes
to both and been wrong twice.

Two throwaway workers were deployed to the owner's account under `o2probe-*` names, measured,
and deleted by exact name (`HTTP 200` each). The account's three production scripts —
`ocr-checks-worker`, `-dev`, `-staging` — were listed before and after and are untouched.
No probe contained a line of this project's source, so nothing was disclosed; see
**Disclosure** at the end.

---

## 1. Runtime WASM compilation is refused, and it is not a setting

Deployed Worker *and* Durable Object, identical result on all four entry points:

| call | result |
|---|---|
| `new WebAssembly.Module(bytes)` | `CompileError: Wasm code generation disallowed by embedder` |
| `WebAssembly.compile(bytes)` | same |
| `WebAssembly.instantiate(bytes)` | same |
| `WebAssembly.instantiateStreaming(response)` | `TypeError: not a function` — **the API is absent** |

This is a V8 embedder flag, the same one that disables `eval`. There is no plan, quota or
paid tier that turns it on.

**RULED BY THE OWNER, 2026-08-24 — and the ruling costs nothing.** A Cloudflare-hosted node
simply does not advertise execution. The fabric already carries capability advertisement in
the published record (`NodeRecords = { certificate, capabilities }`,
`packages/core/src/discovery.ts:414`), so a node that omits the execution capability is an
ordinary, well-formed participant rather than a special case. Nothing in the scheduler needs
to learn about Cloudflare; it needs to keep honouring what a node says it can do.

The second half of this finding is worth keeping separately, because it will otherwise be
rediscovered: **the absent `instantiateStreaming` also removes the V8 code-cache path**
(Part I §6, and AOT-05's whole mechanism) from anything hosted in a Worker. Artifact caching
on this tier is not slower — it has no entry point at all.

---

## 2. The clock does not advance without I/O

Six readings taken across 30 million arithmetic iterations, with the accumulator returned so
the loop is provably not elided:

```
Date.now()         6 readings → 1 distinct value, span 0 ms
performance.now()  6 readings → 1 distinct value
performance.now() === Date.now()    the same integer, not merely correlated
```

Independently re-proved by an unrelated probe: 200 million iterations reported
`wallDeltaMs: 0`.

This is a Spectre mitigation and it applies to production only. **Consequence for this
codebase:** `setTimeout`-driven loops do not work here. That is not hypothetical — it is
precisely the shape of `startCertificateRenewal` (`packages/libp2p/src/certificate-renewal.ts`)
and of the provider-record expiry the owner has already ruled must exist.

The substitute is measured and works — see §5.

**The clock is fresh exactly where it matters.** `Date.now()` returns the time of the last
I/O, and an inbound message *is* I/O, so a certificate is verified against a current clock at
the moment `verifyCertificate` runs. It is the *waiting* that has no mechanism, not the
*checking*.

---

## 3. The plan tier, measured rather than asked

The account's `subscriptions` endpoint returns `403` to the API credential in use, so the tier was derived
from behaviour. The same loop, run in both places, produced **byte-identical accumulators**,
which is what makes the comparison a comparison:

| where | 40M iterations | 200M iterations | accumulator |
|---|---|---|---|
| this Mac | 244.8 ms | 1222.6 ms | `2850874128` / `1300786944` |
| deployed Worker | survived | survived | identical |

The free tier caps CPU at 10 ms per request. The worker absorbed something upwards of a
second of the same work, so the account is on Workers Paid.

---

## 4. Durable Object storage is an opaque-bytes datastore, and the documented size limit is wrong

The shape the project needs is `interface-datastore` — the same interface
`packages/node/src/fs-datastore.ts` already implements. Measured against the KV API only;
the SQL surface exists and was not needed for any of it:

```
Uint8Array round-trip     exact, returns Uint8Array
prefix list '/o2/kad/'    ['/o2/kad/a', '/o2/kad/b', '/o2/kad/bin']
```

**The value ceiling refutes the documentation.** The docs state 2 MB. Bisected against real
`put` calls:

```
largest accepted   4_193_280 B   (3.999 MiB)
smallest refused   4_194_304 B   → "string or blob too big: SQLITE_TOOBIG"
```

So the real ceiling is 4 MiB less a small header — twice what is published. Recorded because
a limit read from a page is the class of claim this project has been wrong about before.

---

## 5. Durable Object alarms fire on time and survive eviction

```
requested  1787632951621
fired      1787632951622        → 1 ms late
alarm ran in the instance constructed at 1787632934750
the following read was served by a NEW instance, constructed at 1787632976085
```

The object was evicted between the alarm firing and the result being read, and the written
result survived. This is the replacement §2 requires: **record expiry and certificate renewal
on this tier are alarms, not timers.**

---

## 6. Outbound TCP works on arbitrary ports. The documentation is inverted.

The Containers egress documentation states that ports other than 80 and 443 are never routed.
Measured for Workers, the opposite holds — **443 is the blocked one**:

| target | result |
|---|---|
| `example.org:443` | **threw** — "cannot connect… consider using fetch instead" |
| `one.one.one.one:443` | **threw** — same |
| `tcpbin.com:4242` | opened, echoed 8 bytes |
| `104.131.131.82:4001` (public IPFS bootstrap) | opened, **20 bytes returned** |
| `github.com:22` | opened, then EOF |

### The 20 bytes are a libp2p handshake

The worker wrote a length-prefixed `/multistream/1.0.0\n` and the IPFS node answered with its
own:

```
hex    132f6d756c746973747265616d2f312e302e300a
ascii  ·/multistream/1.0.0\n            0x13 = 19 = the length prefix
```

A deployed Cloudflare Worker completed multistream-select with a real libp2p peer over raw
TCP. Outbound libp2p is not blocked; only HTTP ports are, and only because the platform wants
`fetch` used for those.

---

## 7. A Worker isolate has no stable identity. A Durable Object does.

Three consecutive `GET /self` calls against a plain Worker returned **three different
PeerIds** — each request landed in a fresh isolate. A Worker can hold neither a stable
identity nor a live node, and is therefore not a candidate for a bootstrap node at all.

Moving the node into a Durable Object with the Ed25519 key persisted in DO storage fixed it:
repeated calls return one PeerId, and it survives eviction. This is the same rule the project
already applies to WebRTC-Direct certhashes — an address derived from a key that changes per
restart is an address nobody can publish.

---

## 8. js-libp2p runs in a deployed Worker and dials real peers

The repository's own pinned versions: `libp2p@3.3.6`, `@chainsafe/libp2p-noise@17.0.0`,
`@chainsafe/libp2p-yamux@8.0.1`, `@libp2p/tcp@11.0.24`, `@libp2p/kad-dht@16.4.0`. Bundle
1.9 MB, gzip ≈500 KB, startup 54 ms — inside the 10 MB paid ceiling with room to spare.

```json
{ "ok": true,
  "target":     "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
  "remotePeer": "QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
  "encryption": "/noise",
  "muxer":      "/yamux/1.0.0",
  "ms":         26 }
```

TCP → multistream-select → **Noise** → **yamux**, remote PeerId verified, in 26 ms.
`kadDHT({ protocol: '/o2/kad/1.0.0', clientMode: true })` constructs and starts. Ed25519
keygen, sign and verify all work through `@libp2p/crypto`.

### Three shims were needed, and each is a workerd gap rather than a prohibition

Found by running, in this order:

1. **`process.versions` is `{}`** — returned by the probe itself, not inferred. js-libp2p's
   `userAgent()` calls `process.versions.node.replaceAll('v','')` unconditionally
   (`libp2p/dist/src/user-agent.js:5`), so one absent field stops the entire stack from
   constructing. Passing a `userAgent` option does **not** help: the platform version is read
   regardless of it.
2. **No `BroadcastChannel`** — `mortice@3.3.1`, libp2p's mutex, constructs one on its primary
   path (`dist/src/node.js:22`). A Worker isolate is one process and one thread, so
   same-isolate delivery is the entire semantics required. About twenty lines.
3. **`node:crypto` has no `diffieHellman`** — `@chainsafe/libp2p-noise`'s node build calls it
   (`dist/src/crypto/index.js:170`). The package's own `browser` field already maps that one
   file to a pure-JS X25519 implementation, and `defaultCrypto` is its only importer
   (`dist/src/noise.js:7`).

**Shim 3 was the last failure before the dial succeeded, and that ordering is the finding.**
The connection had already reached the Noise handshake, so the transport was never in
question — only which crypto backend the bundler had selected.

### One bundling trap, recorded because it fails loudly and misleadingly

`--conditions=node` applied globally is wrong. It pulls `ws` in through
`@libp2p/websockets`; `ws` is CJS with a dynamic `require('events')`, and Cloudflare rejects
the *upload* with `Uncaught Error: Dynamic require of "events" is not supported` — an error
about the bundle, arriving at deploy time, that says nothing about the cause. The working
configuration is node conditions with per-package browser overrides.

---

## 9. A Durable Object is a dialable libp2p peer over WSS

The decisive measurement. An ordinary Node process dialed the Durable Object as a peer:

```json
{ "ok": true,
  "dialMs":     129.5,
  "remoteAddr": "/dns4/<name>.workers.dev/tcp/443/tls/ws/p2p/12D3KooWGUfBFMn6L4mYf8SBrW7gMyc4e93xUJjsaGSRjqFe5scm",
  "remotePeer": "12D3KooWGUfBFMn6L4mYf8SBrW7gMyc4e93xUJjsaGSRjqFe5scm",
  "encryption": "/noise",
  "muxer":      "/yamux/1.0.0" }
```

and the object logged the other half from inside Cloudflare:

```json
{ "at": 1787633999501, "ok": true, "peers": 1 }
```

The remote PeerId matched the key in the object's own storage, so **Noise authenticated the
object against its persisted identity** rather than merely opening a pipe.

**TLS was terminated by Cloudflare's ordinary commercial certificate.** The browser-facing
half of the certificate problem does not arise on this path — see the NET-03 note below.

### The listener is about forty lines and needs no new transport

`@libp2p/websockets`' own `webSocketToMaConn()` consumes a plain WebSocket-shaped object,
which is exactly what `WebSocketPair` returns. The path is
`server.accept()` → `webSocketToMaConn()` → `upgrader.upgradeInbound()`.

Two details each cost a failed run:

- **`upgradeInbound` must not be awaited before the 101 is returned.** No byte moves until
  the response is sent, so awaiting deadlocks by construction. `@libp2p/websockets`' own
  listener does not await it either (`dist/src/listener.js:162`).
- **`binaryType` must be set on the real socket, not faked.** An adapter that lied about it
  through a Proxy `set` trap made libp2p refuse every frame with `Incorrect binary type`.
  Measured directly afterwards: Cloudflare accepts `server.binaryType = 'arraybuffer'` and
  then delivers genuine `ArrayBuffer` frames (`ctor: "ArrayBuffer"`, `isArrayBuffer: true`).
  **The lie was mine, not the platform's** — recorded that way because the first reading
  blamed Cloudflare.

---

## What this does to NET-03

`.planning/REQUIREMENTS.md` records NET-03 as blocked on a hosting decision: AutoTLS needs a
publicly reachable host and a public certificate authority. On the Cloudflare path **that
requirement does not arise rather than being satisfied** — Cloudflare terminates TLS with its
own commercial certificate at the edge, and the libp2p node behind it never sees a
certificate problem at all. This is the same shape as the owner's 2026-08-22 shell/app
ruling: the browser validates an ordinary certificate, and the fabric's own certificates live
underneath it.

This does not close NET-03. It adds a second way to satisfy it that needs no ACME at all, and
it remains gated on the disclosure decision below.

---

## The IPFS gateway question

**Asked by the owner, 2026-08-24, off the back of §6:** does the raw-TCP result mean a
Cloudflare node should be a gateway onto public IPFS?

**The bridging asymmetry is real and it is the whole argument.** A browser cannot dial the
Amino DHT — its peers advertise TCP and QUIC, and a browser can dial neither. A Worker
*can*, and §6 proves it end to end. So a Durable Object sits on both sides of a gap nothing
else in this project crosses: WSS towards the browser, raw TCP towards Amino.

**What that is worth, concretely.** `CLAUDE.md` already routes browser content lookups
through delegated routing at `https://delegated-ipfs.dev` — a third party, on the critical
path, chosen because there was no alternative. A Durable Object serving the same
[Delegated Routing V1 HTTP](https://specs.ipfs.tech/routing/http-routing-v1/) spec replaces
that dependency with one this project runs, using the client (`@helia/delegated-routing-v1-http-api-client`)
that is already in the stack. That is the strongest form of the idea.

**And a gateway here needs no new trust.** Content is content-addressed, so the client
verifies the hash itself; a lying gateway is detected by construction. No new root, no new
anchor, nothing added to the seven artefact types in RESPONSE-04.

**Two of the three unknowns are now measured. The answer is: possible, with a pool.**

1. **The outbound ceiling — measured, §11.** It is not "six simultaneous"; forty sockets were
   held open at once. It is **50 subrequests per invocation, cumulative**, and closing a
   socket does not give the budget back. Crucially, **traffic on an already-open socket is
   free** — 200 round-trips on one connection cost nothing. So a cold fan-out wider than 50
   dials does not fit in one invocation, and a warm object with a connection pool is not
   bound at all. The routing half is possible; it just may not be stateless.
2. **Connection survival — measured, §13 and §18, and the answer is conditional.** An idle
   libp2p connection was gone after six minutes while the object itself was untouched. A
   hibernatable socket carrying no libp2p survived fifteen. A gateway therefore either pays
   keep-alive or is written against the hibernation API.
3. **Block storage — still unmeasured.** DO values top out at 4 MiB (§4), which fits IPFS
   blocks comfortably, but a block *store* wants R2, and the API credential returns `403`.

**What to resist.** "Gateway" invites scope: a full public-IPFS bridge with bitswap, pinning
and a trustless gateway endpoint is a product, not a component. The part that pays for itself
immediately is **routing for the fabric's own keyspace plus artifact fetch over an immutable
URL** — and note that the artifact half loses its main prize on this tier, because §1 removed
`instantiateStreaming` and with it the V8 code cache. Scope it to routing first.

---

## Disclosure

Public hosting is public disclosure; the EPO and China have no grace period, and
`packages/node/src/disclosure-gate.node.test.ts` enforces the *absence* of any deploy
workflow or `deploy` script precisely so that publishing cannot become a consequence of a
push. Nothing in this investigation touched that: the probes lived outside the repository,
carried no project source, and were deployed by hand and deleted.

**Any real Cloudflare deployment stays a separately-triggered human act.** No `wrangler.toml`,
no `deploy` script and no workflow may enter this repository as a convenience — that is the
one guard whose consequence is legal and permanent rather than technical.

---

## 11. The outbound ceiling is 50 per invocation, cumulative — not "six simultaneous"

| requested simultaneously | opened at the same instant |
|---|---|
| 6 / 10 / 20 / 40 | 6 / 10 / 20 / **40** |
| 80 | 50, then refused |

Ten sockets per round, opened *and closed*, twelve rounds: `totalOpened: 50`, then
`Too many subrequests by single Worker invocation`. **Closing does not return budget**, and
`fetch` draws on the same pool — 50 succeeded, 60 gave 50 and the same refusal. A Durable
Object gets the identical 50, and a second call to the same object gets a **fresh** 50, so
the budget is per invocation rather than per object lifetime.

**Reuse is free**: 200 round-trips on one open socket, 360 ms, no refusal. The cap counts
*new connections only*.

## 12. Inbound TCP is unavailable here, twice over

Cloudflare has published a `connect(socket)` handler for raw inbound TCP. A deploy accepted
such a handler without complaint, which proves nothing — unknown exports are ignored. The
ingress side is blocked twice: the feature is **private beta** entered by application form,
and it routes through **Spectrum**, which needs a zone. `GET /zones` returns `success: true`
with an empty list: this account has no domain at all.

So §9's WSS listener is not a workaround for a missing feature. It is the only inbound path
available, and it works.

## 13. An idle libp2p connection does not survive six minutes. The object does.

```json
{"step":"dialed",      "status":"open"}
{"step":"after-quiet", "quietMs":360000, "connStatus":"aborted", "connections":0}
{"step":"object-after","samePeerId":true, "sameCtor":true}
```

`sameCtor: true` is the important half — the constructor timestamp did not move, so the
object was never restarted and its identity never went anywhere. What died was the idle
socket. Compare §18.

## 14. A Durable Object works as a Circuit Relay v2 server

`@libp2p/circuit-relay-v2`'s README says a relay server "will not work in browsers"
(`README.md:46`). A Worker is not a browser, and `dist/src/server/index.js` imports nothing
node-specific — all twelve imports are pure libp2p packages.

```json
{"relay-protocols-advertised":["/ipfs/id/1.0.0","/ipfs/ping/1.0.0","/libp2p/circuit/relay/0.2.0/hop"]}
{"A-reservation":["/dns4/<host>/tcp/443/tls/ws/p2p/<relay>/p2p-circuit/p2p/<A>"]}
{"B-dialed-A-through-cloudflare-relay":{"ok":true,"ms":1285.3,"isA":true,"pingMs":54}}
```

Peer **A** reserved a slot on the object; peer **B** reached A **only through it**, verified
A's PeerId, and pinged in 54 ms. **This is the role the browser tier cannot do without** — a
publicly reachable Circuit Relay v2 for the WebRTC SDP handshake — on a host that needs no
certificate of its own.

**The relay must declare an address.** With `addresses: { listen: [] }` every reservation
came back empty: the server had no address to hand a client. Adding
`announce: ['/dns4/<host>/tcp/443/tls/ws']` fixed it — the same declare-don't-bind shape
already used where a host has no non-RFC1918 interface.

## 15. One missing field made a connection that upgraded and then carried nothing

`webSocketToMaConn()` takes a `direction`, and `@libp2p/websockets`' listener passes
`direction: 'inbound'` (`dist/src/listener.js:147`). Omitting it defaults to outbound, both
ends negotiate yamux as clients, and every stream is refused with
`InvalidParametersError: Both endpoints are clients`
(`@chainsafe/libp2p-yamux/dist/src/muxer.js:356`).

**The failure presents nowhere near its cause.** The dial succeeds, Noise completes, yamux
negotiates — then identify silently returns nothing, the peer store stays empty, relay
discovery finds no relays, and the reservation comes back empty. Two readings were
misattributed to the platform before the message was traced: a `ping-failed` in the
hibernation run, and "the relay does not advertise hop" — which it had been advertising all
along.

## 16. The relay's limits: data enforced at 128 KiB **bidirectional**, duration not observed

`CLAUDE.md` states `DURATION_LIMIT` 2 minutes and `DATA_LIMIT` 128 KiB as constraints on the
fabric. Measured against the Durable Object relay, configured with a `reservations` object
carrying no explicit limits:

**Duration — not observed.** The relayed connection held **206 s** through ten pings with no
cut, against a 120 s default. Reproduced on a second independent run (204 s).
`conn.limits` came back `{}`.

**Data — enforced, and it counts both ways.** Sweeping the chunk size separates a byte limit
from a framing artifact, and the cut lands on the same byte every time:

| chunk | writes | sent | echoed back | cut at |
|---|---|---|---|---|
| 4 KiB | 16 | 65536 | 61440 | **65536** |
| 16 KiB | 4 | 65536 | 49152 | **65536** |
| 64 KiB | 1 | 65536 | 0 | **65536** |

65536 is not the default. **The sum of both directions is**: bytes out, plus bytes back, plus
the reply in flight when the stream died, gives `65536 + 65536 = 131072` in every row —
`DATA_LIMIT` exactly. The relay enforced it while advertising no limits at all.

**Consequence, and it is the kind of number a design gets wrong once:** a symmetric
request/response protocol over a relayed connection gets **64 KiB each way, not 128**.

The asymmetry — data enforced, duration not observed at 1.7× its default — is recorded as
measured and **not explained**. Both halves reproduced.

**An earlier data reading was withdrawn.** A first attempt reported a cut at 16 KiB. A local
control over the memory transport then *hung*, and hardening it produced the cause: the
handler had been written `({ stream }) => …`, the v2 shape, while v3 passes
`(stream, connection)` (`@libp2p/interface/dist/src/stream-handler.d.ts:5`). With that fixed
the control echoes 131072 bytes clean. The 16 KiB figure meant nothing and would have read as
a platform limit stricter than documented.

## 17. A Cloudflare WebSocket has no `bufferedAmount`, so backpressure is silently off

`webSocketToMaConn` reads `websocket.bufferedAmount` to decide whether it may send more.
Measured on the real object, the property is not merely unset — it is **absent from the
prototype**, which carries only
`accept, send, close, serializeAttachment, deserializeAttachment, readyState, url, protocol,
extensions, binaryType`.

An adapter must supply something, and supplying `0` reports "always room to send", disabling
libp2p's backpressure entirely. Acceptable for a signaling path; **a production listener
needs a real answer, and Cloudflare does not provide one.**

## 18. Hibernatable and non-hibernatable idle sockets behave differently

| acceptance | idle | outcome |
|---|---|---|
| `state.acceptWebSocket(server)` (hibernatable) | **15 min** | never closed |
| `server.accept()`, carrying libp2p | 6 min | connection `aborted` |

`webSocketToMaConn` needs a live in-memory object and event handlers, so it cannot use the
hibernation API as written — and that is precisely the socket that died. The object survived
both.

**This is the open design question for the bootstrap role, and it now has a shape rather than
a shrug**: either keep-alive traffic holds a non-hibernatable socket open indefinitely
(unmeasured), or an adapter is written against the hibernation API so an idle peer costs
nothing. The 15-minute reading says the second path exists.

---

## Disclosure

Public hosting is public disclosure; the EPO and China have no grace period, and
`packages/node/src/disclosure-gate.node.test.ts` enforces the *absence* of any deploy
workflow or `deploy` script precisely so that publishing cannot become a consequence of a
push. Nothing here touched that: the probes lived outside the repository, carried no project
source, and were deployed by hand and deleted by exact name.

**Any real Cloudflare deployment stays a separately-triggered human act.** No
`wrangler.toml`, no `deploy` script and no workflow may enter this repository as a
convenience — this is the one guard whose consequence is legal and permanent rather than
technical.

---

## Still unmeasured

- **Whether keep-alive holds a non-hibernatable socket open indefinitely** — the remaining
  half of §18, and the one that decides whether the bootstrap role is free or expensive.
- **A hibernation-aware listener.** §18 says the path exists; nothing has been written
  against it.
- **Why the duration limit did not apply while the data limit did** (§16). Both readings
  reproduced; neither is explained.
- **Containers and R2** — the API credential returns `403` on both. Per §1's ruling the
  execution tier may not be wanted at all, but R2 is wanted for blocks regardless.
