# Architecture Research — v2.0 "Open the Doors": the hosted tier

**Domain:** P2P compute fabric — adding an always-on Cloudflare Durable Object tier to an
existing two-tier (browser + Node backbone) libp2p fabric.
**Researched:** 2026-08-25
**Confidence:** HIGH on everything traceable to a real file or a measured consult finding;
MEDIUM/LOW flagged explicitly where a design is proposed rather than observed.

This document answers the seven build questions against this repository's actual code, not
against the general Cloudflare/libp2p ecosystem. Every claim below is either a file:line in
this repo, a reading in `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md`
(cited as **[MEASURED §n]**), or a decision in
`.planning/consults/2026-08-24-owner-ruling-cloudflare-node-shape.md` (cited as **[RULED §n]**).
Where I propose new structure rather than report existing structure, it is marked **PROPOSED**.

---

## 0. System overview — where the third tier sits

```
┌──────────────────────────────────────────────────────────────────────────┐
│  packages/browser  (browser-node.ts)        packages/node (fabric-node.ts)│
│  listen: ['/p2p-circuit','/webrtc']         listen: tcp/ws/webrtc-direct  │
│  kadDHT({ clientMode: true })               kadDHT({ clientMode: !canRelay})│
│  webSockets(), webRTC(), circuitRelayTransport()   + circuitRelayServer() │
└───────────────┬────────────────────────────────────────┬─────────────────┘
                │  both assemble createLibp2p() themselves │
                │  from the SAME shared packages ↓          │
┌───────────────┴────────────────────────────────────────┴─────────────────┐
│   packages/libp2p   dht-record-index.ts, dht-registration.ts,            │
│                     certificate-renewal.ts, peer-verifier.ts,            │
│                     relay-admission.ts, relay-service.ts, identity.ts    │
│   packages/core     discovery.ts (NodeRecords/CapabilityRecord),         │
│                     enrollment.ts (NodeCertificate, renewal math)        │
│   packages/net      protocol.ts, rpc.ts, rendezvous.ts (pure, portable)  │
└────────────────────────────────────────────────────────────────────────┬─┘
                                                                          │
                              NEW, v2.0 ───────────────────────────────► │
┌─────────────────────────────────────────────────────────────────────────┐
│  packages/cloudflare  (PROPOSED — see §1)                                │
│  Durable Object per region: bootstrap-eu / bootstrap-us / bootstrap-apac │
│  roles at once: Circuit Relay v2 server + seed/bootstrap peer + DHT      │
│  value-record store with expiry. Does NOT advertise execution [RULED §1]│
└─────────────────────────────────────────────────────────────────────────┘
```

**The load-bearing precedent this whole answer rests on:** `packages/browser` and
`packages/node` are **not** one `FabricNode` class parameterised by environment. Each is its
own top-level assembly file (`packages/browser/src/browser-node.ts`,
`packages/node/src/fabric-node.ts`) that calls `createLibp2p()` with its **own** transport
list, its **own** `clientMode` value, and its **own** storage backends — both built from the
same `packages/libp2p` / `packages/core` / `packages/net` primitives. `fabric-node.ts` is
~3,400 lines of Node-only glue (`node:path`, `node:fs`-backed `FsDatastore`/`FsBlockstore`,
`@ipshipyard/libp2p-auto-tls`, `@libp2p/tcp`, worker-thread WASM execution via `@o2/aot`) that
a Worker cannot run and does not want. There is no thin "environment adapter" seam to plug
into inside it — the seam this repository actually uses is **a third assembly file in a third
package**, which is exactly what a Durable Object needs.

---

## 1. Where the third tier lives

**New workspace package — `packages/cloudflare/`.** Not an addition to `packages/node`.

Reasons, each checkable:

- `packages/node/package.json` depends on `@libp2p/tcp`, `@ipshipyard/libp2p-auto-tls`,
  `@libp2p/http`, `@libp2p/webrtc`, `@peculiar/x509`, `qrcode-terminal`, `reflect-metadata` —
  none of which apply to or run in workerd, and `@o2/aot`/`@o2/bench` bring in WASM-execution
  machinery that **[RULED §1]** says this tier must not advertise at all. Folding the DO into
  `packages/node` would either drag all of that into a workerd bundle (the bundling trap
  **[MEASURED §8]** shows how easily that produces a silent-at-runtime, loud-at-deploy
  failure) or require `packages/node` to grow its own internal environment branching — which
  is precisely the shape `fabric-node.ts` and `browser-node.ts` already avoided by being
  separate files.
- The workspace is `"workspaces": ["packages/*"]` (root `package.json:6`), so a new package
  needs only a `package.json` with `"name": "@o2/cloudflare"` and an `exports` map identical
  in shape to the other three (`{"." : "./src/index.ts"}`, per `packages/libp2p/package.json`,
  `packages/browser/package.json`, `packages/node/package.json`).
- **Dependencies for the new package**, taken from what **[MEASURED §8]** proved actually
  works deployed (not from `wrangler dev`): `libp2p@3.3.6`, `@chainsafe/libp2p-noise@17.0.0`,
  `@chainsafe/libp2p-yamux@8.0.1`, `@libp2p/websockets@10.1.17` (for the inbound WSS
  listener — **[MEASURED §9]**), `@libp2p/circuit-relay-v2@4.2.9` (`circuitRelayServer` —
  **[MEASURED §13]**, and its README's "will not work in browsers" is about browsers, not
  Workers), `@libp2p/kad-dht@16.4.0`, `@libp2p/identify@4.1.10`, `@libp2p/ping@3.1.9`,
  `@libp2p/keychain@6.1.6` (persisted Ed25519 identity — **[MEASURED §7]**), `@libp2p/tcp`
  only if the Amino-gateway idea in the consult's "IPFS gateway question" is ever picked up
  (raw outbound TCP works — **[MEASURED §6]**). **Do not add `@libp2p/webrtc`** — this tier
  never negotiates WebRTC itself; it only relays the SDP handshake between two browsers, and
  that is `circuitRelayServer`'s HOP/STOP protocol over the WSS connection it already has with
  each side, not a WebRTC transport of its own. Depends on `@o2/core`, `@o2/net`, `@o2/libp2p`
  exactly as the other two tiers do.
- **What it does not depend on:** `@o2/aot` (WASM execution — refused by the embedder anyway,
  **[MEASURED §1]**), `packages/node`'s `FsDatastore`/`FsBlockstore`/`FsIssuance` (all
  `node:fs`-backed — the DO needs a Durable-Object-storage-backed datastore instead, see §2/§3).

---

## 2. What is shared, what is separate, and how the workerd gaps get patched

**Shared unmodified** (all three gaps in the question were found *underneath* these, not
inside them, per **[MEASURED §8]**'s own ordering — the transport reached the Noise handshake
before any of the three shims was needed):

| Package | What's reused | Why it's already portable |
|---|---|---|
| `packages/core` | `NodeRecords`, `CapabilityRecord`, `NodeCertificate`, `verifyCapabilityRecord`, `verifyCertificate`, `shouldRenewCertificate`/`msUntilRenewalDue` (`packages/core/src/enrollment.ts:1656,1669`) | Pure functions over plain data — no platform import at all. |
| `packages/net` | `rpc.ts`, `protocol.ts`, `rendezvous.ts` | `rpc.ts`'s own docblock: *"Pure module — no platform imports beyond timers, which exist identically in Node, a browser, and a Worker."* `rendezvous.ts`'s docblock: *"Pure module — the endpoint and the peer list arrive as parameters."* |
| `packages/libp2p` | `dht-record-index.ts` (`DhtRecordIndex`), `dht-registration.ts` (`o2RecordValidator`), `identity.ts` (`nodeKeyForPeerId`), `constants.ts` (`providerRecordPolicy`), `relay-admission.ts`, `relay-service.ts` | These construct/consume `KadDHT`/`NodeRecords` objects and do not touch `process`, `BroadcastChannel`, DOM, or `node:*` directly. |
| `packages/browser/src/dial-plan.ts` | Not reused by the DO itself, but the **pattern** (pure decision function over a snapshot, no I/O) is the template for the DO's own sweep logic in §3. | Its own docblock: *"No DOM, no libp2p, no fetch: this file loads in the node project unchanged."* |

**What breaks, and the fix for each — three measured gaps, three different remedies, on
purpose:**

1. **`process.versions` is `{}`.** `libp2p`'s own `userAgent()` does
   `process.versions.node.replaceAll('v','')` unconditionally
   (`node_modules/libp2p/dist/src/user-agent.js:5`) — **[MEASURED §8.1]**. This is inside a
   third-party package, not inside `@o2/libp2p`, so it cannot be fixed by editing this
   repo's source. **Fix: a tiny environment shim, new file
   `packages/cloudflare/src/workerd-shims.ts`**, imported for its side effect before
   `libp2p` is ever imported, setting `globalThis.process ??= { versions: { node: '0.0.0' } }`
   (or the minimal shape `userAgent()` reads). This is the "something else" option in the
   question — neither an adapter nor an export condition, because the break is a global the
   *platform* lacks, not a module the *bundler* resolves differently.
2. **No `BroadcastChannel`.** `mortice` (libp2p's mutex) constructs one on its primary path
   (`node_modules/mortice/dist/src/node.js:22`) — **[MEASURED §8.2]**, "about twenty lines."
   Same remedy, same file: `workerd-shims.ts` supplies a minimal same-isolate
   `BroadcastChannel` (a Worker isolate is one thread, so same-isolate delivery is the whole
   semantics needed).
3. **`node:crypto` has no `diffieHellman`.** `@chainsafe/libp2p-noise`'s **Node** build calls
   it (`dist/src/crypto/index.js:170`), but the package **already ships a `browser` field**
   mapping that exact file to a pure-JS X25519 implementation — **[MEASURED §8.3]**. This is
   the one gap that is a bundler-resolution problem, not a platform gap, and the fix is an
   **export/browser condition applied per-package**, not a hand-written shim: build the
   Cloudflare bundle with `node` conditions globally and an explicit **override forcing the
   `browser` condition for `@chainsafe/libp2p-noise` only**. Applying `browser` conditions
   globally is the wrong direction entirely — **[MEASURED §8, "one bundling trap"]** shows it
   pulls in `ws` (a CJS package with a dynamic `require('events')`) through
   `@libp2p/websockets`, which Cloudflare's uploader rejects at **deploy time** with an error
   that names neither the package nor the cause.

**What is deliberately NOT shimmed:** `Date.now()`/`setTimeout` not advancing without I/O
(**[MEASURED §2]**) is not a "gap to patch" — no shim makes a timer fire in workerd between
requests. It is a scheduling-model difference, and it is handled by *not reusing* the
`setTimeout`-based loop wrapper in `packages/libp2p/src/certificate-renewal.ts`
(`startCertificateRenewal`, `packages/libp2p/src/certificate-renewal.ts:124`) on this tier —
see §3, same shape of fix applies to record expiry and to certificate renewal alike. The
**pure** decision functions it wraps (`shouldRenewCertificate`, `msUntilRenewalDue`,
`renewalDelayMs`) are reused; the **loop** is replaced by a Durable Object alarm calling the
same pure functions. This is the adapter pattern the question asks about, but the seam is
"pure calculation vs. I/O-driven scheduling," not "sync vs. async" — the same shape the
project already used for the Ed25519 backend adapter (`Key Decisions` table,
`PROJECT.md`, 2026-08-09 ruling: *"a synchronous `verify` behind an asynchronous one-time
`init`"*), reapplied to a different axis.

---

## 3. Record expiry — both halves, and where each lives

**The two record types in this fabric are not the same mechanism, and the gap is only in
one of them.**

### 3a. Provider records (`dht.provide`/`findProviders` — "who holds this CID") — solved on Node, NOT solved on workerd

`packages/libp2p/src/constants.ts:316` exports `providerRecordPolicy(validityMs)`, which
derives `{ validity, interval, threshold }` and is passed into `kadDHT()`'s `providers`
option. `@libp2p/kad-dht@16.4.0`'s own `src/reprovider.ts` — started by `kad-dht.ts`'s
`start()` — walks the provider-record prefix on that `interval`, deletes anything older than
`validity` whose provider is not the local node, and republishes the local node's own
entries inside `threshold` of expiry. **This is proven end-to-end across two real processes**
by `packages/node/src/provider-expiry.node.test.ts`: a holder announces a CID, is stopped,
and the keeper stops answering for it once its record ages out.

**This mechanism is an `setInterval` loop, and it does not survive on the Cloudflare tier.**
`reprovider.ts`'s sweep is exactly the shape **[MEASURED §2]** names by example: *"That is
not hypothetical — it is precisely the shape of `startCertificateRenewal`… and of the
provider-record expiry the owner has already ruled must exist."* A workerd isolate's clock
does not advance without I/O and a `setInterval` registered during one request is not
guaranteed to fire, or to still be registered, once the isolate goes idle or is evicted — the
same reason `startCertificateRenewal`'s loop (§2) is not reused as-is. So on the Cloudflare
tier, **provider records accumulate in persistent DO storage exactly like value records do**,
for the identical reason: the timer that is supposed to expire them never runs between
requests. This half is *not* "already done" on this tier — it needs the same alarm-driven
sweep §3c describes, just against the provider-record prefix and `providerRecordPolicy`'s
`validity`/`timeReceived` criterion (the same test `reprovider.ts` itself applies) rather
than against an embedded `expiresAt`.

**This sharpens, rather than simply corrects, the sentence CLAUDE.md's stack doc is stale
on** — it still reads *"`@libp2p/kad-dht@16.4.0` never expires provider records."* That claim
is **stale for the Node tier** (`provider-expiry.node.test.ts` disproves it — the sweep exists
and is proven) and **operationally still true on workerd** (the sweep exists in source but its
driving timer does not run there). That is very likely why the owner's ruling, written the day
after that test landed, still asks for expiration on this tier without qualification — the
Node-tier fix does not travel to Cloudflare by itself. Flag the Node-tier half of this
correction to whoever owns `CLAUDE.md`; it is out of scope for this document to edit it, but a
roadmapper should not re-derive "provider records never expire" as a Node-tier requirement
(done), while still scoping the Cloudflare-tier sweep to cover **both** record types (§3c).

### 3b. Value records (`dht.put`/`dht.get` at `/o2/<nodeKey>` — the `NodeRecords` themselves) — this is the actual gap

This is what the owner's ruling and PROJECT.md are actually about, and it is a **different**
code path with **no comparable sweep**:

- `@libp2p/kad-dht@16.4.0`'s value-record read path
  (`node_modules/@libp2p/kad-dht/dist/src/rpc/handlers/get-value.js`, `_checkLocalDatastore`)
  does perform a check: it compares `record.timeReceived` against a hardcoded constant
  `PROVIDERS_VALIDITY = 48 * hour` (`node_modules/@libp2p/kad-dht/dist/src/constants.js:9` —
  note the confusing name reuse; this is **not** the same value as `providerRecordPolicy`'s
  argument and is **not exposed as a `KadDHTInit` option at all** — the only `validity` field
  in `KadDHTInit` (`node_modules/@libp2p/kad-dht/dist/src/index.d.ts:419`) is under
  `providers`, i.e. §3a's mechanism). If a value record is older than 48h **and gets read**,
  it is deleted on the way out and treated as a miss.
- **This bounds nothing proactively.** It only fires when a `GET_VALUE` RPC names that exact
  key. A `/o2/<nodeKey>` record nobody has queried in months sits in the datastore
  indefinitely. On today's ephemeral/on-disk Node tier that is harmless — restart the process
  and the datastore is whatever `FsDatastore` holds, and nobody has treated its growth as a
  cost. **On Durable Object storage it is a real cost**: `interface-datastore` values persist
  by definition, the per-value ceiling is 4 MiB (not 2 MiB as documented —
  **[MEASURED §4]**), and the object's total is capped at 10 GB. This is the owner's actual
  complaint (*"Надо только expiration"*, **[RULED §3]**) and it is about this path, not §3a's.
- **The read-time correctness check already exists, independent of this tier.**
  `packages/core/src/discovery.ts:335` — `verifyCapabilityRecord` — already refuses a record
  whose `issuedAt > now || expiresAt <= now`, and `DhtRecordIndex.recordsFor`
  (`packages/libp2p/src/dht-record-index.ts`) already routes every DHT-sourced record through
  a caller-supplied `verify` callback before accepting it (see `provider-expiry.node.test.ts`'s
  own `dhtOnly()` helper, which wires exactly this check). **This is the "read-time check
  bounds correctness" half the owner's ruling asks for, and it needs no new code** — it
  already runs on every read, on every tier, because it lives in the consumer
  (`DhtRecordIndex`), not in the DHT library. State this explicitly to the roadmapper so
  nobody re-builds it: **the correctness half of the ruling is done; only the storage-bounding
  sweep half is missing.**

### 3c. The sweep — new, and where it lives

**PROPOSED, new module `packages/libp2p/src/dht-record-sweep.ts`** — portable, testable in
Node with no deployment, same shape as `provider-expiry.node.test.ts`'s harness:

- Takes an `interface-datastore` (the one backing `kadDHT`'s own record store — the same
  shape `packages/node/src/fs-datastore.ts`'s `FsDatastore` already implements) and a
  `now: () => number`.
- Iterates the datastore's `record` prefix (the same `bufferToRecordKey`-shaped keys
  `get-value.js` reads), deserialises each `Libp2pRecord` (`@libp2p/record`), extracts the
  raw `value` bytes, and runs it through **the exact same `decodeNodeRecords` /
  `verifyCapabilityRecord` path `DhtRecordIndex` already uses** — so the sweep's notion of
  "expired" is identical to the read path's, by construction, rather than a second definition
  that could drift from the first (the same "two-spellings hazard" this codebase has been
  bitten by before, per `dht-record-index.ts`'s own header).
- Deletes anything whose `capabilities.expiresAt <= now()`.
- Returns a count (swept/kept/undecodable), so a test can assert on it the way
  `unnamedProviders`/`unverifiedRecords` are asserted on elsewhere in this file.
- **Covers the provider-record prefix too, per §3a's correction** — a second pass (or a
  second exported function sharing the same datastore-walking shape) applying
  `providerRecordPolicy().validity` against each provider entry's `timeReceived`, the same
  criterion `reprovider.ts` itself uses. One alarm, two prefixes, one shared "walk + decide +
  delete" shape — not two unrelated mechanisms that happen to share a file.

**PROPOSED, Cloudflare-tier-only glue, `packages/cloudflare/src/expiry-alarm.ts`** — thin,
workerd-specific, calls the shared sweep against the DO's own storage-backed datastore inside
`alarm()`, then reschedules itself. This split is what makes the sweep verifiable **before any
deployment exists** (§7): the shared half is a pure function over an `interface-datastore`,
testable against `FsDatastore` or an in-memory datastore in `vitest --project node`; only the
one-line "call it from `alarm()` and call `state.storage.setAlarm(...)` again" is
Cloudflare-specific and untestable without a deploy.

- **The mechanism the alarm rides on is measured and exact**: a Durable Object alarm fired
  **1 ms** after its requested time, ran in the instance that scheduled it, and its result
  was read back by a *different* instance after eviction — **[MEASURED §5]**. This is the
  reason an alarm and not `setTimeout` is the only viable driver here (§2's clock finding —
  **[MEASURED §2]**), and it is why `startCertificateRenewal`'s loop wrapper is not reused
  directly: it is a `setTimeout` re-armer, and this tier has no working `setTimeout` between
  requests.
- **The alarm is also where certificate renewal belongs on this tier**, for the identical
  reason, reusing `packages/core/src/enrollment.ts`'s pure `shouldRenewCertificate`/
  `msUntilRenewalDue` rather than `certificate-renewal.ts`'s loop. Both concerns — record
  sweep and certificate renewal — are "compute a due time from data, get woken by a platform
  timer, act, reschedule," and a single alarm handler that does both is cheaper to reason
  about than two competing alarms per object (Durable Objects have exactly one alarm slot per
  object).

---

## 4. Multi-region identity, and its interaction with `rendezvous.ts`

**No existing precedent in the code for "region" as a networking concept** — a repo-wide
search for `region`/`Region` outside test names and `demo-region-properties.ts` (which is
about DOM UI regions, an unrelated homonym) finds nothing. This is genuinely new design, not
an extension of something already there. Two things from the existing code make the shape of
the answer clear, though.

**Identity: one Durable Object name per region, per the owner's own ruling.**
`idFromName('bootstrap-eu')` etc. resolves to a single global instance —
**[RULED §2]**, proven both accidentally (the relay's in-memory reservation store was visible
to two independent connections, **[MEASURED §7]**/§18) and directly (fan-in to 599 of 600
simultaneous peers, same PeerId, unmoved constructor timestamp — **[MEASURED §18]**). So
**sharding is addressing, not provisioning**: `bootstrap-eu` / `bootstrap-us` / `bootstrap-apac`
are three distinct Ed25519 identities, each persisted in that object's own DO storage exactly
as `FabricNode`'s node key is persisted today (`loadOrCreateSeed`, `packages/node/src/fabric-node.ts:1947`)
— the DO-storage equivalent, not the `node:fs` one.

**How a browser learns which region to use — PROPOSED, following an existing pattern rather
than inventing one.** `packages/node/src/seed-server.ts`'s `/bootstrap.json` is built **per
request, from the request itself** (`bootstrapInfoFor`, derived from the `Host` header) —
explicitly not hardcoded, explicitly not guessed from network interfaces. The same shape
applies here: a Cloudflare **Worker** (not a Durable Object — Workers execute at the edge PoP
nearest the visitor; DOs are pinned to one datacenter) fronts all three regional DOs and
answers a bootstrap-info request using `request.cf.continent`/`request.cf.colo` to pick the
nearest region's name, then returns that region's WSS multiaddr (`/dns4/<region>.<host>/tcp/443/tls/ws/p2p/<peerId>`).
This requires **no change to the browser-side contract at all**: `TabApi.discoverRelays()`
(`packages/browser/src/tab-api.ts:906`) already returns `relayAddrs: string[]` — a list, not
a single address — so a bootstrap response naming one nearest region (or, degraded, all
three) fits the existing shape unchanged. `dial-plan.ts`'s `planDials` already treats
"candidates" as a flat list without caring how many distinct relay identities are in it.

**Interaction with `rendezvous.ts` — the part that needs new glue, and the part that stays
regionally siloed by design.** `findReservedPeers` (`packages/net/src/rendezvous.ts`) asks
every **already-connected** peer `{kind:'reservations'}` over `/o2/rpc/1.0.0` and merges the
answers (`packages/net/src/protocol.ts:142,266`). For a regional DO to answer this
truthfully, **it must register the same RPC protocol handler `FabricNode` registers**
(`packages/node/src/fabric-node.ts:3015`, `reservations: () => node.reservedPeerIds`, backed
by its own `circuitRelayServer()`'s reservation store) — this is new, Cloudflare-tier-specific
glue (a few lines wiring the DO's own relay-service reservation set into the same
`{kind:'reservations'}` response shape), not a change to `rendezvous.ts` itself, which is
already generic over "any peer that answers the protocol." **Skipping this would make the DO
a mute relay**: browsers could still be relayed *through* it and could still read the global
DHT keyspace, but `findReservedPeers` would never learn about siblings reserved on that same
object, silently narrowing discovery to whatever the DHT already covers.

**What stays siloed, and should be stated rather than discovered later:** rendezvous is
inherently per-relay (a browser only learns who else is reserved *on the peer it asks*), so a
browser bootstrapped into `bootstrap-eu` rendezvous-discovers only `bootstrap-eu`'s other
reservees — cross-region peer discovery has to go through the DHT's global keyspace
(`/o2/kad/1.0.0`, not region-scoped) rather than through rendezvous. This is a feature, not a
bug, for the stated goal (measuring WebRTC failure rate by region without smearing signalling
through one city, **[RULED — "Multi-region relay from the start", PROJECT.md]**) — but a
roadmapper should know that rendezvous alone does not give a browser a cross-region peer list;
only the DHT does, and only after `DhtRecordIndex` on some peer holds records from both
regions.

---

## 5. Two fallback rungs below WebRTC — where the decision lives today, and what changes

**Today there is no STUN/TURN configuration anywhere in this codebase.**
`packages/browser/src/browser-node.ts:1474` calls `webRTC()` with **no arguments at all** —
confirmed by grep; there is no `rtcConfiguration`, no `iceServers`, anywhere in `packages/`.
`@libp2p/webrtc`'s own type (`node_modules/@libp2p/webrtc/dist/src/private-to-private/transport.d.ts:8-19`)
already accepts exactly this:

```ts
export interface WebRTCTransportInit {
  rtcConfiguration?: RTCConfiguration | (() => RTCConfiguration | Promise<RTCConfiguration>)
  dataChannel?: DataChannelOptions
}
```

with its own doc comment: *"Add additional configuration to any RTCPeerConnections that are
created. This could be extra STUN/TURN servers, certificate, etc."* **This is rung 1's entire
integration point**: `webRTC({ rtcConfiguration: { iceServers: [...] } })` at
`browser-node.ts:1474` (browser tier) — Node-side peers dialling each other over WebRTC would
take the same option in `fabric-node.ts`'s own `webRTC()` call if one exists there, but per
the transport reality matrix in `CLAUDE.md`, Node↔Node WebRTC is not the path that needs
this; browser↔browser is. **MODIFIED file: `packages/browser/src/browser-node.ts`.** No new
package, no new abstraction — a config value threaded into an existing call. The one design
decision this creates: where the TURN server list/credentials come from (a `BrowserNodeOptions`
field, following the same "no hidden defaults" convention `browser-node.ts` already uses for
`whenSeedIsGone`/`enrollment`), and whether the hosted tier itself should run a TURN server —
**[RULED and MEASURED nothing here]**: the consult and rulings are explicit that *"there is no
TURN in the stack"* and the fallback is wanted, but building/hosting a TURN server was not
measured against Cloudflare in this consult at all. Treat "where does TURN run" as an open
question the roadmap should scope as its own research spike, not assume Durable Objects can
answer (a DO is not a TURN relay implementation; TURN is a distinct protocol on UDP/TCP that
would need its own hosting decision, likely Cloudflare Calls TURN or a third-party STUN/TURN
provider, not `circuitRelayServer`).

**Rung 2 (fall all the way through to a relayed connection) is already partially modelled,
and the change is about accounting, not about new dial logic.**
`packages/browser/src/dial-plan.ts` already distinguishes `carriesWork: true` (a real,
unlimited connection) from a peer held only over a relayed `/p2p-circuit` — see `HeldPeer`,
`MAX_UPGRADE_ATTEMPTS = 3`, and `DialPlanner.stalled()`, which names peers that have given up
upgrading and are "connected, counted, and unable to carry a job." **This is rung 2 already**:
when WebRTC (with or without TURN) fails, the pair simply keeps whatever relayed circuit they
already hold, and `dial-plan.ts` already reports that state distinctly rather than conflating
it with a real connection. What changes for v2.0 is the **capacity** that state can be relied
on for: the relay's data limit is **64 KiB each way, not 128** (it is enforced bidirectionally
— **[MEASURED §15]**, cross-referenced in `CLAUDE.md`'s amended Connectivity constraint), and
this number should be threaded into whatever code today assumes 128 KiB for anything that
might run over a stalled/relay-only pair (search for `RELAY_DATA_LIMIT_BYTES`,
`packages/libp2p/src/constants.ts:29`, already `131_072n` total — this constant is already
correct as "total both ways"; the risk is call sites that assumed it was 128 KiB *each way*
and budgeted double what is actually available for a request/response pair).

---

## 6. Telemetry and consent — where they attach without touching fabric code paths

**No telemetry code exists yet** — a repo-wide search for `telemetry`/`Telemetry` returns
nothing. This has to be designed net-new, and the existing consent pattern is the one to
copy, not invent something parallel to it.

**Follow `packages/browser/src/consent.ts`'s pattern exactly: consent is a value, not a
check.** Its own docblock states the reasoning this project has already paid for twice: *"a
rule somebody has to remember at every call site"* is how the two named regressions
happened (a churn loop that never read its own deadline; an assertion that sat inside a
condition that could never be true). `GrantedConsent` is mintable only by `grantConsent`/
`readConsent`, with a module-private constructor symbol so it cannot be fabricated even from
JavaScript. **PROPOSED**: a parallel `TelemetryConsent` value in a **new, separate file**
(e.g. `packages/browser/src/telemetry-consent.ts`), same shape, same versioning
(`DISCLOSURE_VERSION`-style), so that opting into telemetry is its own explicit, revocable,
persisted decision — never folded into the existing `GrantedConsent` (which gates CPU/network
use for compute, a different question from "may this run's numbers be reported").

**Where the actual reporting code lives, and why it must not live beside the fabric's own
protocol code:** the project's hard rule is that raw sovereign data does not move
(`EgressGuard.send`, per PROJECT.md's Key Decisions table) and that this is checkable because
every frame the fabric sends goes through one guarded path. Telemetry must be **outside**
that path entirely, not merely permitted to pass through it: a telemetry reporter that shares
any code with `packages/net/src/protocol.ts`'s wire types risks becoming a second channel the
egress guard was never written to inspect, which is exactly the shape of leak the guard
exists to prevent. **PROPOSED**: telemetry lives in its own module (e.g.
`packages/browser/src/telemetry.ts`), reports only **aggregate, pre-declared fields**
(connection outcome: success/TURN/relay-only/failed; region; coarse network class — never a
raw address, never a peer id beyond what discovery already makes public, never anything read
from a job's data path), and is sent over an ordinary `fetch()` to a Cloudflare Worker
endpoint that is **not** a libp2p peer and **not** part of the fabric's protocol surface at
all — a plain HTTP beacon, deliberately boring, so that "did this leak sovereign data" can be
answered by reading one small file rather than auditing the whole protocol stack. This is a
new, small, low-risk component; the design risk is entirely in scope creep (a telemetry
module that grows into a second discovery mechanism), and the mitigation is the same one
`packages/net/src/rendezvous.ts` uses for its own restraint: state plainly what it does not
do.

---

## 7. Build order, dependencies, and what needs no deployment at all

Ordered so nothing is built against an assumption the previous step hasn't verified.
**Everything in group A is fully verifiable with `vitest --project node`, no `wrangler`, no
account, no deploy** — the pattern already established by `provider-expiry.node.test.ts` and
`relay-discovery.node.test.ts`, which prove DHT behaviour across real (but local) libp2p
processes with no Cloudflare involved at all.

**Group A — no deployment required, build first, in this order:**

1. **`packages/libp2p/src/dht-record-sweep.ts`** (§3c). Depends on nothing new — reuses
   `decodeNodeRecords`, `verifyCapabilityRecord`, `@libp2p/record`. Testable today against
   `packages/node/src/fs-datastore.ts`'s `FsDatastore` or an in-memory `interface-datastore`,
   with a fixed `now()`, exactly like `provider-expiry.node.test.ts`'s harness. **This must
   land before or with persistence** (per PROJECT.md's own stated ordering) precisely because
   it has no dependency on persistence to be correct — proving it against a `MemoryDatastore`
   costs nothing and removes it from the list of things that can go wrong once real DO storage
   is involved.
2. **`packages/cloudflare/` package scaffold + `workerd-shims.ts`** (§1, §2). Depends on
   nothing but the pinned versions already proven in **[MEASURED §8]**. The three shims and
   the bundler-condition override can be built and their *symptoms* reproduced locally with
   any workerd-compatible bundler test harness that doesn't require a live account (or,
   failing that, written directly from the consult's exact error strings and verified once
   deployment is authorised — see Group B).
3. **Cloudflare-side RPC glue for `{kind:'reservations'}`** (§4) — a thin handler wiring a
   `circuitRelayServer()` reservation set into `packages/net/src/protocol.ts`'s existing
   response shape. Unit-testable against a fake relay-service object exposing the same
   `reservations` shape `FabricNode` exposes at `fabric-node.ts:3015`, with no real Durable
   Object needed.
4. **TURN configuration plumbing in `packages/browser/src/browser-node.ts`** (§5) — threading
   an `iceServers` option through to `webRTC({ rtcConfiguration })`. Testable as "the option
   is passed through" without a real TURN server; testing that TURN actually improves the
   connect rate needs Group B (real network conditions) or a later dedicated research spike,
   since no TURN hosting decision has been made at all.
5. **`TelemetryConsent` + the telemetry reporter module** (§6) — pure value type plus a
   `fetch()`-based reporter behind an injectable transport, exactly as `rpc.ts` and
   `rendezvous.ts` already take their I/O as parameters. Fully unit-testable with a fake
   transport; no Cloudflare Worker needs to exist yet to prove the module never touches
   fabric protocol types.

**Group B — needs a real (throwaway, disclosure-guarded) deployment to verify, per the
consult's own methodology of never trusting `wrangler dev`:**

6. **The Durable Object assembly itself** (`packages/cloudflare/src/cloudflare-node.ts` or
   similar) — `createLibp2p()` with `websockets()`, `circuitRelayTransport()`,
   `circuitRelayServer()`, `kadDHT()` on `/o2/kad/1.0.0`, `identify()`, `ping()`, `keychain()`
   backed by DO storage. Depends on 1–3 existing so the sweep and the rendezvous handler can
   be wired in rather than retrofitted. PROJECT.md's "correct inbound listener" feature names
   **four** requirements, not two, and all four belong to this step — dropping any of them
   reproduces one of the measured silent-failure modes:
   - `direction: 'inbound'` on the `webSocketToMaConn()` call (**[MEASURED §14]**) — omitted,
     both ends negotiate yamux as clients and every stream is refused, while the dial itself
     still looks like it succeeded.
   - `remoteAddr` derived from `CF-Connecting-IP`, not a hardcoded loopback address
     (**[MEASURED §19]**) — omitted, libp2p sees the entire internet as one host and
     rate-limits the node to five inbound connections per second, invisible at small scale.
   - An explicit answer for `bufferedAmount`, which is **absent from the WebSocket
     prototype** in workerd, not merely unset (**[MEASURED §16]**) — supplying `0`
     "always room to send" disables libp2p's backpressure entirely; acceptable for signalling
     traffic, but the choice must be made deliberately and recorded, not left to whatever an
     adapter happens to return.
   - **A socket written against the hibernation API**, not `server.accept()`
     (**[MEASURED §17]**) — this is the largest genuinely-new engineering item on this tier
     and the one most likely to be under-scoped if it is treated as a detail of the listener
     rather than its own piece of work. `webSocketToMaConn` needs a live in-memory object and
     event handlers, so it **cannot use the hibernation API as written today**; nothing has
     been written against it. The difference is not cosmetic: a plain `server.accept()`
     socket carrying libp2p died after 6 minutes idle while the object itself stayed up
     (**[MEASURED §12]**), whereas a hibernatable socket survived 15 minutes untouched
     (**[MEASURED §17]**). **[RULED §2]** names this directly as what decides whether the
     bootstrap/relay role is cheap or expensive at scale — a non-hibernatable socket keeps
     the object resident (and billed) for as long as it is open. Scope a hibernation-aware
     `webSocketToMaConn` adapter as its own task inside this step, not as a line item beside
     the other three, and expect it to be the one that does not fit in the same estimate as
     the rest of the listener.
7. **The expiry alarm glue** (`packages/cloudflare/src/expiry-alarm.ts`, covering both the
   value-record and provider-record prefixes per §3a/§3c) — depends on 1 and 6, and **must
   ship in the same phase as step 6, not after it**. The consumer's own framing is "expiry
   lands before or with persistence": step 6 is what makes the DO's datastore *persistent*
   (DO storage persists by definition, per **[RULED §3]**), so any deploy of step 6 without
   step 7 already wired in is a deploy that starts accumulating unswept records from its first
   request — there is no safe intermediate state where 6 exists alone. Treat 6 and 7 as one
   deliverable for planning purposes even though they are separate files. Verify the alarm
   itself against a real deployed alarm (**[MEASURED §5]**'s methodology: request, fire,
   evict, re-read from a new instance) since no local emulator reproduces eviction-and-alarm
   survival credibly.
8. **Multi-region bootstrap Worker** (§4) — depends on 6+7 existing at least once (a single
   region proves the shape) before multiplying identities to `bootstrap-eu`/`-us`/`-apac`.
   Verify region selection against `request.cf` fields, which only a real deployed Worker
   receives.
9. **The public cohort run itself** (PROJECT.md's "target features," last) — depends on
   everything above, plus the entry-condition gates (consent, stop control, kill switch) that
   are already partly built in `packages/browser/src/consent.ts`'s pattern and extended in
   step 5.

**Every step in Group B remains gated the same way the consult's own probes were**: deployed
by hand, under throwaway names, deleted by exact name, with no `wrangler.toml`/`deploy`
script entering the repository as a standing artifact — `packages/node/src/disclosure-gate.node.test.ts`
still enforces the *absence* of exactly that, and nothing in this design proposes adding one.
Building `packages/cloudflare/`'s source is not disclosure by that test's own logic (only a
deploy workflow/script is forbidden); actually deploying it, even to verify Group B, is the
one human act this repository's own guard exists to keep manual.

---

## New vs. Modified — summary for the roadmapper

| File / module | New or Modified | Depends on |
|---|---|---|
| `packages/cloudflare/package.json`, `src/index.ts` | **NEW** | workspace root only |
| `packages/cloudflare/src/workerd-shims.ts` | **NEW** | none |
| `packages/cloudflare/src/cloudflare-node.ts` (DO assembly) | **NEW** | `@o2/core`, `@o2/net`, `@o2/libp2p`, workerd-shims |
| `packages/cloudflare/src/expiry-alarm.ts` | **NEW** | `dht-record-sweep.ts` |
| `packages/cloudflare/src/reservations-rpc.ts` (or inline in the assembly) | **NEW** | `packages/net/src/protocol.ts` (unmodified — consumed, not changed) |
| `packages/libp2p/src/dht-record-sweep.ts` | **NEW** | `dht-record-index.ts`, `@libp2p/record` (both unmodified) |
| `packages/browser/src/browser-node.ts` | **MODIFIED** | add `rtcConfiguration`/`iceServers` option to the existing `webRTC()` call at :1474 |
| `packages/browser/src/telemetry-consent.ts` | **NEW** | pattern-copies `consent.ts` (unmodified) |
| `packages/browser/src/telemetry.ts` | **NEW** | `telemetry-consent.ts` |
| `packages/libp2p/src/dht-record-index.ts`, `dht-registration.ts`, `certificate-renewal.ts`, `constants.ts` | **UNMODIFIED** | reused as-is |
| `packages/core/src/discovery.ts`, `enrollment.ts` | **UNMODIFIED** | reused as-is |
| `packages/net/src/rendezvous.ts`, `protocol.ts`, `rpc.ts` | **UNMODIFIED** | reused as-is |
| `packages/node/src/fabric-node.ts`, `fs-datastore.ts`, `fs-blockstore.ts` | **UNMODIFIED, NOT REUSED** | Node-only; the DO gets its own DO-storage-backed datastore instead |
| `CLAUDE.md`'s "never expires provider records" claim | **STALE, needs correction** (out of scope here) | superseded by `provider-expiry.node.test.ts` |

---

## Open questions this document deliberately leaves open

- **Where TURN itself runs.** Not measured in either consult. A dedicated spike is needed
  before step 4/6 above can be more than plumbing — Cloudflare Calls TURN and third-party
  TURN providers are both plausible and neither has been evaluated against this fabric.
- **Whether a DO-storage-backed `interface-datastore` should be written as its own small
  class (mirroring `packages/node/src/fs-datastore.ts`'s shape) or adapted from an existing
  package.** `fs-datastore.ts`'s own docblock records that a generic async datastore
  (`datastore-level`) once hung this fabric's enrolment RPC for reasons that took a week to
  disprove as "asynchrony itself" — the same caution applies to any off-the-shelf DO datastore
  adapter, and a small hand-written one (as Node's own was) is the lower-risk default.
- **The R2/Containers block-storage question** — explicitly still unmeasured
  (**[MEASURED — "Still unmeasured"]**), out of scope for this milestone per **[RULED §1]**.

---

## Sources

- `.planning/PROJECT.md` — v2.0 milestone scope, Key Decisions table, Constraints (relay
  data-limit amendment, disclosure amendment)
- `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` — §1 (WASM refused),
  §2 (clock), §4 (DO storage ceiling), §5 (alarms), §6 (outbound TCP), §7 (DO identity
  stability), §8 (js-libp2p in a Worker, three shims, bundling trap), §9 (WSS listener), §10
  (outbound subrequest ceiling), §13 (Circuit Relay v2 server on a DO), §14 (`direction`
  field), §15 (relay data-limit, 64 KiB each way), §16 (`bufferedAmount` absent), §17
  (hibernation vs. plain socket idle survival), §18 (one identity, 599 peers), §19
  (`CF-Connecting-IP`/`inboundConnectionThreshold`), §20 (scale reasoning)
- `.planning/consults/2026-08-24-owner-ruling-cloudflare-node-shape.md` — ruling 1 (no
  execution advertised), ruling 2 (one identity per object, sharding is addressing), ruling 3
  (expiration: sweep + read-time check, not alternatives)
- `packages/browser/src/browser-node.ts` (transport list :1474, `clientMode: true` :1528,
  `features: []` :859)
- `packages/node/src/fabric-node.ts` (transport list :2073, `clientMode: !canRelay` :2143,
  `circuitRelayServer` :2222, `reservations: () => node.reservedPeerIds` :3015, `canRelay`
  derivation :1964/:616, imports :80-205)
- `packages/libp2p/src/dht-record-index.ts` (`DhtRecordIndex`, `O2_KEY_PREFIX`,
  `O2_KAD_PROTOCOL`, `dhtKeyForNodeKey`)
- `packages/libp2p/src/dht-registration.ts` (`o2RecordValidator`, `O2_RECORD_NAMESPACE`)
- `packages/libp2p/src/certificate-renewal.ts` (`startCertificateRenewal` :124,
  `renewalDelayMs` :82, `MAX_TIMER_MS` :73)
- `packages/libp2p/src/constants.ts` (`providerRecordPolicy` :316, `PROVIDER_RECORD_VALIDITY_MS`
  :292, `RELAY_DATA_LIMIT_BYTES` :29, `RELAY_RESERVATION_TARGET` :332)
- `packages/core/src/discovery.ts` (`CapabilityRecord`, `NodeRecords`, `verifyCapabilityRecord`
  :335, `features` filtering in `discoverExecutors` :673-676)
- `packages/core/src/enrollment.ts` (`shouldRenewCertificate` :1656, `msUntilRenewalDue` :1669)
- `packages/net/src/rendezvous.ts` (`findReservedPeers`, `MAX_RESERVED_PEERS_PER_ANSWER`)
- `packages/net/src/protocol.ts` (`{kind:'reservations'}` request :142, response :266)
- `packages/net/src/rpc.ts` (portability docblock)
- `packages/node/src/fs-datastore.ts` (`FsDatastore`, the `interface-datastore` shape a DO
  datastore should mirror)
- `packages/node/src/seed-server.ts` (`bootstrapInfoFor`, derive-from-request pattern)
- `packages/browser/src/tab-api.ts` (`discoverRelays()` :906, returns `relayAddrs: string[]`)
- `packages/browser/src/dial-plan.ts` (`DialPlanner`, `HeldPeer.carriesWork`,
  `MAX_UPGRADE_ATTEMPTS`, `stalled()`)
- `packages/browser/src/consent.ts` (consent-as-a-value pattern)
- `packages/node/src/disclosure-gate.node.test.ts` (DEMO-04 guard, what it does and does not
  forbid)
- `packages/node/src/provider-expiry.node.test.ts`, `packages/node/src/relay-discovery.node.test.ts`
  (proof that provider-record expiry and relay discovery over the DHT already work end-to-end)
- `node_modules/@libp2p/kad-dht/dist/src/rpc/handlers/get-value.js` (`_checkLocalDatastore`,
  the hardcoded, non-configurable 48h value-record staleness check)
- `node_modules/@libp2p/kad-dht/dist/src/constants.js` (`PROVIDERS_VALIDITY = 48h`)
- `node_modules/@libp2p/kad-dht/dist/src/index.d.ts` (`validity` option, scoped to `providers`
  only, :419)
- `node_modules/@libp2p/webrtc/dist/src/private-to-private/transport.d.ts` (`WebRTCTransportInit.rtcConfiguration`)
- Root `package.json` (`workspaces: ["packages/*"]`)
