<!-- GSD:project-start source:PROJECT.md -->
## Project

**o2.services — P2P Native Cloud**

A peer-to-peer compute fabric that runs untrusted code safely on volunteer and
enterprise nodes, moves code to data instead of data to code, and keeps each
owner's data pinned to their own device for sovereignty. The node agent is
TypeScript + WASM so it runs unmodified in a browser tab, in Node.js, or
embedded in a host application — which makes every visitor to a web page a
potential compute node.

**Core Value:** **Usable capacity grows super-linearly with the user base, without any raw data
leaving its owner's device.** If everything else fails, a map/reduce job must
distribute across N independently-owned nodes, return a result whose integrity is
demonstrable, and demonstrably never move the underlying data off the owner's node.

**What "demonstrable integrity" means precisely** — sovereignty and N-version
verification cannot both apply to the same task, because pinning data to one node
removes the second independent executor. The system therefore splits the claim:

| Data | Integrity mechanism |
|------|--------------------|
| Public / shared | Full N-version redundant execution with commit-reveal, ≥1 replica backbone-anchored |
| Sovereign (owner-pinned) | Map is **owner-attested**; the aggregation *over* contributions is verified |

Stated plainly: *the owner's contribution is trusted; the aggregation over
contributions is verified.* The sovereignty claim itself is carried by an egress
manifest and coverage report, not by a quorum.

### Constraints

- **Tech stack**: TypeScript + WASM — must run in browser, Node.js, and embedded
  in host apps without a separate build per target
- **Connectivity**: Browser-to-browser libp2p requires a publicly reachable
  Circuit Relay v2 node for the WebRTC SDP handshake, and browsers can only dial
  `DNS + WSS`, WebTransport, or WebRTC-Direct. The relay is a **signaling channel,
  not a data path** — verified defaults in
  `transport-circuit-relay-v2/src/constants.ts`: `DURATION_LIMIT` 2 minutes,
  `DATA_LIMIT` 128 KiB, `MAX_RESERVATION_STORE_SIZE` 15 concurrent reservations.
  Protocols will not negotiate over a relayed connection unless registered with
  `runOnLimitedConnection: true`
- **WebRTC data path**: 16 KiB max message (hardcoded in js-libp2p); Chromium
  closes the channel above 256 KiB and does not reassemble Firefox's fragments.
  The browser mesh cannot carry bulk data — partials must stay small (§3.5) and
  artifacts fetch over an IPFS gateway (§I.6)
- **Determinism**: V8 exposes no NaN-canonicalization or relaxed-SIMD control
  (measured against `node --v8-options`; Wasmtime has both). Determinism must
  therefore be enforced as a property of the **published artifact at publish
  time**, not as runtime configuration
- **Hosting**: GitHub Pages serves static files only and runs no server-side
  process — it can host the client but not a relay or bootstrap node
- **Disclosure**: Public hosting is public disclosure. EPO and China have no
  patent grace period, so publishing forfeits those rights permanently. Deployment
  must be a separately-triggered gate, not an automatic consequence of a phase
  completing
- **Platform**: `elfconv` requires AArch64, statically-linked binaries and is a
  C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`, not a
  TypeScript component. **"Unstripped" was wrong** — corrected in Phase 10 against a
  real binary: one with no `.symtab` at all lifts fine, because the loader recovers
  function entries from `.eh_frame` through libdwarf. The refusal is the *conjunction*
  of stripped **and** no unwind tables. **And it exits `0` on binaries it could not
  fully translate** — 174 addresses on a hello-world — so the exit code is never
  trusted; the driver measures the produced module
- **Contributions**: None accepted; sole authorship preserves the commercial
  license track
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Headline findings (read first)
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `libp2p` | `3.3.6` | Peer identity, transports, muxing, dialing, connection management | The only mature JS P2P stack that runs unmodified in browser + Node. v3's `EventTarget` streams removed the async-iterator latency tax that dominated small-message workloads — directly relevant to a scheduler that exchanges many small control messages. **Browser: YES. Node: YES.** |
| `helia` | `7.1.1` | Content-addressed block storage, provide/retrieve, UnixFS entry point | js-IPFS is dead (deprecated 2023); Helia is its successor and is on `@libp2p/interface ^3.2.4`, i.e. already aligned with libp2p v3. v7 is compositional (`withBitswap(withLibp2p(withHTTP(createHeliaLight())))`), so the browser build can drop what it doesn't need. **Browser: YES. Node: YES.** |
| `multiformats` | `14.0.5` | CID construction/parsing, multihash, codecs | The canonical implementation. libp2p 3.x and Helia 7.x both require `^14`. Pin this — a `13.x` transitive dep produces `CID` instances that fail `instanceof` checks across package boundaries. **Browser: YES. Node: YES.** |
| WebAssembly (V8 built-in) | — | Task execution sandbox | In the browser the runtime *is* V8. Using `WebAssembly.compileStreaming` / `instantiateStreaming` unlocks V8's code cache (see [WASM Execution](#wasm-execution-detail)). In Node the same API is present, so **one code path covers both** — no Wasmtime/WasmEdge in the portable agent. |
| `typescript` | `7.0.2` | Type checking, `.d.ts` emit | Go-native compiler, ~10x faster type-checks. `strict` is now the default, which matches the project's needs. **Caveat: no stable programmatic API until 7.1.** Mitigate by using `isolatedDeclarations` (below) so nothing in the build depends on the TS API. |
| Node.js | `24.x` LTS ("Krypton", currently `24.18.0`) | Server/backbone runtime | Active LTS. Node 26.5.0 is Current but not yet LTS (promotes Oct 2026). Node 24 has stable `WebAssembly`, `node:test`, and full Web Crypto — enough that no polyfills are needed for parity with the browser. |
### libp2p modules — the exact browser + Node set
| Package | Version | Browser | Node | Purpose / Notes |
|---------|---------|:-------:|:----:|-----------------|
| `@libp2p/websockets` | `10.1.17` | **dial only** | **dial + listen** | Browser→server only. Browsers cannot open listening sockets. Multiaddr form is now `/dns4/host/tcp/443/tls/ws` (the old `/wss` shorthand still parses). Browser can only dial **secure** WS from an HTTPS page. |
| `@libp2p/webrtc` → `webRTC()` | `6.0.27` | **YES (both directions)** | YES | The **only** browser↔browser transport. Requires a Circuit Relay v2 peer for SDP exchange + a STUN server for reflexive address discovery. Once connected, the relay drops out. |
| `@libp2p/webrtc` → `webRTCDirect()` | `6.0.27` | **dial only** | **dial + listen** | Browser→server with no relay and no CA cert (certhash in the multiaddr). **This is the cheapest way to get browsers onto your backbone** — no TLS certificate, no DNS. Browsers cannot listen (no UDP port binding). |
| `@libp2p/circuit-relay-v2` → `circuitRelayTransport()` | `4.2.9` | YES | YES | Required in the browser to dial `/p2p-circuit` addrs and to make reservations. |
| `@libp2p/circuit-relay-v2` → `circuitRelayServer()` | `4.2.9` | **NO** | YES | Source comment: *"This will not work in browsers."* Backbone nodes only. |
| `@chainsafe/libp2p-noise` | `17.0.0` | YES | YES | **Required.** Confirmed libp2p-v3-compatible (`@libp2p/interface: ^3.0.0`). This is the canonical noise package — see the deprecation table for the trap. |
| `@chainsafe/libp2p-yamux` | `8.0.1` | YES | YES | **Required** for TCP/WS connections. WebRTC and WebTransport bring their own muxing. Confirmed `@libp2p/interface: ^3.0.0`. |
| `@libp2p/tls` | `3.1.6` | **NO** | YES | Optional second connection encrypter on the backbone (cheaper handshake than Noise on TCP). Node only. |
| `@libp2p/identify` | `4.1.10` | YES | YES | **Required in practice.** AutoNAT, DCUtR, AutoTLS, and relay discovery all depend on it. Export both `identify()` and `identifyPush()`. |
| `@libp2p/ping` | `3.1.9` | YES | YES | Liveness probing — the "confirm liveness on connect" step in design §3.4, and the load-probe leg of power-of-d-choices. |
| `@libp2p/kad-dht` | `16.4.0` | **see below** | server mode | **INSTALLED AND WIRED — CORRECTED 2026-08-22.** This cell read *"NOT INSTALLED — no DHT exists in this repository today"* until then. It was true when written and stopped being true 69 seconds later: `16.4.0` landed at `eb42af7` and is now pinned exactly in three workspace manifests (`packages/libp2p/package.json:12`, `packages/browser/package.json:14`, `packages/node/package.json:16`), and `kadDHT()` is constructed at `packages/browser/src/browser-node.ts:1430` (`clientMode: true`, `:1432`) and `packages/node/src/fabric-node.ts:1979` (`clientMode: !canRelay`, `:1981`), both on the private keyspace `/o2/kad/1.0.0` (`packages/libp2p/src/dht-record-index.ts:78`). See [DHT reality check](#dht-reality-check). The claim that a browser "never gets a dialable address, so it stays a client" is **false**: `browser-node.ts:197` listens on `['/p2p-circuit', '/webrtc']`. Whether kad-dht's server-mode promotion accepts a relayed address is unverified. *(SUPERSEDED 2026-08-22 — it was measured on 2026-08-14 and promotion **does** accept a relayed address. A tab's `/webrtc` listen addr resolves to `<relay>/p2p-circuit/webrtc/p2p/<self>`, which passes `!isPrivate(ma) && !Circuit.exactMatch(ma)` — `node_modules/@libp2p/kad-dht/src/kad-dht.ts:347`, a predicate installed only when `clientMode` is left unset at `:340`. So leaving it unset makes a node's DHT role follow the relay's network position.)* Set `clientMode` explicitly rather than relying on promotion — both tiers now do. **WIRED IS NOT USED — CORRECTED 2026-08-23, and this is the third correction on this one cell.** Everything above stayed true and the keyspace still carried nothing, because two settings neither `protocol` nor `clientMode` covers were left at their Amino defaults. (1) `peerInfoMapper` defaults to `removePrivateAddressesMapper` (`src/kad-dht.ts:179`) and `onPeerConnect` drops a peer with no addresses left after mapping (`:403-406`) — so on loopback, on a LAN, and behind a relay **no peer was ever added to a routing table**: measured on two `server`-mode nodes that had completed identify and held each other as peers, where a `put` yielded no events at all and `getClosestPeers` never returned. Both tiers now pass `passthroughMapper`, because membership of `/o2/kad/1.0.0` is decided by a certificate and not by address class. (2) `validators` was registered and `selectors` was not, and `bestRecord` throws `MissingSelectorError` for an unknown namespace (`record/selectors.ts:23-25`) — so the keyspace accepted every write and errored on every read, swallowed by `DhtRecordIndex`'s catch and presenting as *"the DHT holds nothing"*. Both tiers now register `o2RecordSelector`. **A private DHT needs four settings, not two**: `protocol`, `clientMode`, `peerInfoMapper`, `selectors`. Read across two processes by `packages/node/src/dht-registration.node.test.ts`. |
| `@libp2p/dcutr` | `3.0.24` | **effectively no** | YES | DCUtR is implemented in JS and works. But hole-punching needs a transport that can *listen* on a punched port — browsers can't. **Browser NAT traversal is WebRTC's own ICE, not DCUtR.** DCUtR is for Node↔Node behind NAT. |
| `@libp2p/autonat` / `@libp2p/autonat-v2` | `3.0.24` / `2.1.0` | pointless | YES | Reachability detection. Meaningless in a browser (never reachable). Use v2 on new backbone nodes; keep v1 for interop with older go-libp2p. |
| `@libp2p/tcp` | `11.0.24` | **NO** | YES | Backbone only. |
| `@libp2p/bootstrap` | `12.0.27` | YES | YES | Seed peers. In the browser, seed with **your own** relays' `/dns4/.../tls/ws` addrs — public IPFS bootstrappers advertise mostly TCP/QUIC, which a browser cannot dial. |
| `@libp2p/mdns` | `12.0.27` | **NO** | YES | LAN discovery, Node only (raw UDP). Very useful for the multi-machine demo on one LAN. |
| `@libp2p/upnp-nat` | `4.0.24` | **NO** | YES | Opens a port on the home router so a self-hosted backbone node becomes publicly dialable — the precondition for AutoTLS. |
| `@ipshipyard/libp2p-auto-tls` | `2.0.2` | **NO** | YES | **Highest-leverage package in this list.** Acquires a Let's Encrypt cert for `<peerId>.libp2p.direct` via `registration.libp2p.direct`, producing a browser-dialable WSS multiaddr automatically. Requires `identify` + `keychain` + a public address. |
| `@libp2p/keychain` | `6.1.4` | YES | YES | Persistent key storage. **Required by AutoTLS**, and required to make `webRTCDirect` certhashes stable across restarts (otherwise every restart invalidates published multiaddrs — fatal for a bootstrap node). |
| `@libp2p/gossipsub` | `16.0.5` | YES | YES | Pubsub. **Moved into the libp2p monorepo** — the ChainSafe package is now stale. Use for job-group rendezvous and coarse load gossip (design §3.4). |
| `@libp2p/perf` | `5.1.9` | YES | YES | Official cross-implementation throughput benchmark protocol. See [Benchmarking](#benchmarking-detail). |
| `@libp2p/memory` | `2.0.24` | YES | YES | In-process transport. **Use this for deterministic multi-node unit tests** — spin 50 nodes in one process with no sockets, no ports, no flake. |
| `@libp2p/echo` | `3.1.9` | YES | YES | Trivial protocol for connectivity smoke tests. |
| `@multiformats/multiaddr` | `13.0.3` | YES | YES | **Must be `13.x`** for libp2p v3 — v13 stripped DNS resolution and restructured tuple access. `12.x` will silently misbehave. |
| `@multiformats/multiaddr-matcher` | `3.0.2` | YES | YES | Classify multiaddrs (`WebRTC.matches(ma)`) — needed to pick the right addr to hand a browser. |
### Helia / content-addressing modules
| Package | Version | Browser | Node | Purpose / Notes |
|---------|---------|:-------:|:----:|-----------------|
| `helia` | `7.1.1` | YES | YES | Full node: `createHelia()` = `withBitswap(withLibp2p(withHTTP(createHeliaLight())))`. Use `createHeliaLight()` in the browser for the smallest bundle, then compose only what you need. |
| `@helia/unixfs` | `8.0.4` | YES | YES | File/dir chunking + `cat`/`addBytes`. `fs.cat()` returns an **async iterable, not a `BodyInit`** — wrap in a `ReadableStream` before `instantiateStreaming` (design §I.6 already flags this). |
| `@helia/bitswap` | `4.0.6` | YES | YES | Block exchange over libp2p. This is how a node *provides* blocks to peers. |
| `@helia/libp2p` | `1.0.6` | YES | YES | Wires libp2p into Helia and exports `libp2pDefaults()` — **read this file, it is the best single reference for a working browser libp2p config**. |
| `@helia/http` | `4.0.5` | YES | YES | Trustless-gateway block fetching over plain HTTP. The fallback when P2P connectivity fails; also the path that gives you a plain URL for V8 code caching. |
| `@helia/delegated-routing-v1-http-api-client` | `9.0.0` | YES | YES | HTTP client for the [Delegated Routing V1 spec](https://specs.ipfs.tech/routing/http-routing-v1/). **This is how a browser does content routing.** |
| `@helia/delegated-routing-client` | `1.0.5` | YES | YES | Helia `Router` wrapper + `delegatedHTTPRoutingDefaults()`. Default endpoint `https://delegated-ipfs.dev`, with `filterAddrs: ['https','tcp','webrtc','webrtc-direct','wss','tls']` — server-side filtering (IPIP-484) so a browser only gets back providers it can actually dial. |
| `@helia/fallback-router` | `1.1.0` | YES | YES | Chain routers (libp2p DHT → delegated HTTP → gateway) with fallback. Matches the hybrid topology. |
| `@helia/car` | `6.0.4` | YES | YES | CAR import/export. Use for shipping a job's input set as one blob, and for reproducible benchmark fixtures. |
| `@helia/dag-cbor` | `6.0.4` | YES | YES | Structured content-addressed records — the right encoding for job manifests, capability tokens, and result attestations. Deterministic encoding is a hard requirement for CID stability; dag-cbor gives it. |
| `blockstore-idb` | `4.0.1` | **YES (browser only)** | NO | IndexedDB blockstore. Official `ipfs/js-stores`. Correct default for the browser. |
| `blockstore-fs` | `4.0.1` | NO | **YES** | Filesystem blockstore for Node. |
| `blockstore-core` | `7.0.1` | YES | YES | `MemoryBlockstore`, `TieredBlockstore`, `IdentityBlockstore`. Use `MemoryBlockstore` in tests and as an L1 in front of IndexedDB. |
| `datastore-idb` | `5.0.1` | **YES (browser only)** | NO | Peer store / keychain / DHT persistence in the browser. |
| `datastore-level` | `13.0.1` | NO | **YES** | Same for Node. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@noble/hashes` | `2.2.0` | SHA-2/3, BLAKE3, HKDF, **Argon2id** | Content hashing outside the multiformats path, and the memory-hard KDF design §3.9 requires for the user key. Audited, zero-dep, browser+Node. |
| `@noble/curves` | `2.2.0` | Ed25519, secp256k1, X25519 | Capability-chain (SPKI/UCAN) signing and verification. Already a transitive dep of `@chainsafe/libp2p-noise`, so it costs no extra bundle weight. |
| `@libp2p/crypto` | `5.1.21` | libp2p key types, PeerId ↔ key conversion | Node identity. Use this rather than raw noble for anything that must interop with a PeerId. |
| `protons` / `protons-runtime` | `9.0.2` / `7.0.0` | Protobuf codegen for custom wire protocols | Your scheduler/job protocols. This is what every libp2p protocol package uses; the generated code is dependency-light and browser-safe. Note libp2p internally pins `protons-runtime ^5.6.0` — that's fine, they coexist. |
| `@libp2p/utils` | `7.3.0` | `byteStream()`, `lpStream()`, `pbStream()` | **In v3 these moved into `@libp2p/utils`** from the standalone `it-*-stream` packages. Use these for request/response protocols instead of hand-rolling framing. |
| `uint8arrays` | `6.1.1` | Concat/compare/encode byte arrays | Ubiquitous in this ecosystem; must be `6.x` to match libp2p v3. |
| `binaryen` | `131.0.0` | WASM transform toolchain (JS build of Binaryen) | **Publish-time determinism normalization.** Has a `denan` pass ("instrument the wasm to convert NaNs into 0 at runtime") plus feature enable/disable flags. Build-time only — do not ship to the browser. |
| `wabt` | `1.0.39` | WASM binary ↔ text, validation | Publish-time artifact inspection: verify the feature set actually used by a `.wasm` before signing its CID. Build-time only. |
| `wasm-feature-detect` | `1.8.0` | Runtime probe of engine WASM features | Runtime gate: a node advertises its supported feature set into the DHT, and refuses artifacts whose required feature set it cannot run. ~1 KB, browser+Node. |
| `@bjorn3/browser_wasi_shim` | `0.4.2` | Pure-JS WASI preview1 shim, **zero dependencies** | If guest code needs WASI (elfconv's `aarch64-wasi32` target does). Pure JS ⇒ runs identically in browser *and* Node. **Use it in Node too, not `node:wasi`** — identical host semantics on every node is a determinism requirement. |
| `comlink` | `4.4.2` | Ergonomic Worker RPC | Wraps `postMessage` between the agent and its execution Workers. Stable (last publish 2024) but essentially feature-complete; low risk. Optional — a hand-rolled 100-line RPC avoids the dep. |
### Development Tools
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `tsdown` | `0.22.14` | Library bundler (Rolldown/Oxc) | **The successor to `tsup`, which is unmaintained.** Emits one ESM artifact with per-condition builds. Still `0.x` — pin exactly. |
| `rolldown-plugin-dts` | `0.27.14` | `.d.ts` generation | Bundled into tsdown. Set `isolatedDeclarations: true` in tsconfig ⇒ it uses the **Oxc** generator and needs no TypeScript API at all, side-stepping the TS 7.0 "no stable API until 7.1" problem entirely. |
| `vite` | `8.1.5` | Dev server + demo app bundle | For the browser demo/benchmark harness (not the library). Node 20.19+/22.12+ required. |
| `vitest` | `4.1.10` | Test runner — **Node and browser from one config** | Use the `projects` feature: one project `environment: 'node'`, another with `browser.enabled`. Same test files, two runtimes. This is the single most important tool choice for "runs identically in browser and Node". |
| `@vitest/browser` | `4.1.10` | Browser-mode runner | Provider `playwright`, `instances: [{browser:'chromium'},{browser:'firefox'},{browser:'webkit'}]`. Requires Chrome ≥87 / Firefox ≥78 / Safari ≥15.4. |
| `playwright` / `@playwright/test` | `1.61.1` | Multi-browser E2E + multi-tab orchestration | Doubles as the **benchmark driver**: `browser.newContext()` × N gives N isolated "nodes" in one process for the tabs-scaling curve. *(SUPERSEDED 2026-08-22 — the installed driver is `playwright@1.62.0`, declared `^1.62.0` at the root `package.json:30`, so `1.61.1` does not even satisfy this repo's own floor. `@playwright/test` is installed nowhere — `ls node_modules/@playwright` reports no such directory — and nothing imports it: the e2e specs drive bare `playwright`, and browser-mode tests run through the provider package `@vitest/browser-playwright@4.1.10` (`package.json:28`), which this table never mentions. `.planning/research/STACK.md:113` already carries the pin retired — `~~1.61.1~~ → re-verify at install time`, noting `1.62.0` was current on 2026-07-24 — and the correction was never propagated here.)* |
| `tinybench` | `6.1.2` | Micro-benchmarks, browser + Node | What `vitest bench` uses under the hood. Correct for per-op measurement (CID hashing, WASM instantiate, Noise handshake). |
| `eslint` + `typescript-eslint` | `10.7.0` / `8.65.0` | Lint | Or `oxlint@1.75.0` for speed. Not load-bearing. |
## Installation
# ---- Core: shared (browser + Node) ----
# ---- Content addressing ----
# ---- Browser-only storage ----
# ---- Node-only (backbone / relay) ----
# ---- Crypto / protocol ----
# ---- WASM guest support ----
# ---- Dev ----
## Transport reality matrix (the browser question, answered)
| Transport | Browser → Browser | Browser → Node/Go server | Node listen | Requires |
|-----------|:-----------------:|:------------------------:|:-----------:|----------|
| **WebRTC** (`webRTC()`) | ✅ **the only option** | ✅ | ✅ | Circuit Relay v2 peer for SDP signaling + STUN |
| **WebRTC Direct** (`webRTCDirect()`) | ❌ (browser cannot listen — no UDP bind) | ✅ | ✅ | Nothing. No cert, no DNS, no relay. **Cheapest browser→backbone path.** |
| **WebSockets (secure)** | ❌ (browser cannot listen) | ✅ | ✅ | CA-signed TLS cert + DNS name. **Solved by AutoTLS.** |
| **WebSockets (insecure `/ws`)** | ❌ | ❌ from an HTTPS page (mixed content) | ✅ | Only usable for `localhost` dev |
| **WebTransport** | ❌ | ✅ dial only | ❌ **js-libp2p cannot listen** | Server must be go-/rust-libp2p. Not in Safari. Source: *"only allows dialing… requires QUIC support to land in Node JS first."* |
| **TCP / QUIC** | ❌ | ❌ | ✅ | Backbone↔backbone only |
| **Circuit Relay v2** | ✅ (relayed) | ✅ | ✅ (Node only as server) | **2 min / 128 KiB per connection by default** |
- Browser→browser is **WebRTC, and only WebRTC.** There is no alternative and no fallback.
- Every browser peer needs at least one reachable Circuit Relay v2 server to be *dialable at all*. That server must be dialable *by the browser*, i.e. WSS or WebRTC-Direct.
- **WebRTC-Direct is underrated here.** A backbone node listening on `/ip4/0.0.0.0/udp/PORT/webrtc-direct` is browser-dialable with no certificate, no DNS record, and no Let's Encrypt rate limits. Run it *alongside* AutoTLS WSS as a redundant entry point. Pair it with `@libp2p/keychain` so the certhash survives restarts.
### Relay strategy — evidence contradicts PROJECT.md
## DHT reality check

> **Corrected 2026-07-28.** This section previously opened with *"a browser node cannot serve
> DHT records… permissioned by physics, not by policy."* **That was wrong**, and it was wrong in
> the way this project most often gets things wrong: a constraint that is real about the *public
> Amino* DHT was restated as a constraint about *capability*, and then quoted as if it settled
> the fabric's own design. Two facts falsify it.
>
> 1. **There is no DHT in this repository.** `@libp2p/kad-dht` is not installed — the whole
>    `@libp2p/*` set is circuit-relay-v2, crypto, identify, interface, interface-internal,
>    keychain, logger, multistream-select, peer-collections, peer-id, peer-record, peer-store,
>    ping, tcp, utils, webrtc, websockets — and `kadDHT` appears nowhere in `packages/`.
>    Discovery today runs over the relay's reservation store (`net/src/rendezvous.ts`), not a
>    DHT. So this section describes a component that was never built.
>
>    **SUPERSEDED 2026-08-22.** Item 1 was true when it was written and false 69 seconds
>    later. The docs commit that wrote it is `49eebe5` (2026-08-14 22:43:22); `eb42af7`
>    (22:44:31) added `@libp2p/kad-dht@16.4.0` pinned exactly, `4ae8575` (2026-08-15) built
>    the record layer and discovery, and `8998915` joined the browser tier to the same
>    keyspace. The package is now a direct dependency of three workspace manifests
>    (`packages/libp2p/package.json:12`, `packages/browser/package.json:14`,
>    `packages/node/package.json:16`), `kadDHT()` is constructed at `browser-node.ts:1430`
>    and `fabric-node.ts:1979` on the private protocol `/o2/kad/1.0.0`
>    (`packages/libp2p/src/dht-record-index.ts:78`), and `packages/libp2p/src/` carries
>    `dht-record-index.ts` and `dht-registration.ts` with a spec each. The hand-written
>    `@libp2p/*` enumeration above is stale for the same reason and should be re-derived
>    rather than trusted — `ls node_modules/@libp2p/` additionally lists `kad-dht`,
>    `record`, `http`, `http-fetch`, `http-peer-id-auth`, `http-utils` and `http-websocket`.
>    What survives from item 1 is the rendezvous half: `packages/net/src/rendezvous.ts`
>    still exists and is still exported (`packages/net/src/index.ts:137-138`), so the DHT
>    runs *alongside* relay-reservation discovery rather than instead of it — which of the
>    two a requestor actually takes was not re-measured here. The section no longer
>    describes a component that was never built, and what settles the fabric's design is
>    item 2, browser dialability, not DHT absence.
> 2. **A browser node is dialable.** `browser-node.ts:197` listens on
>    `['/p2p-circuit', '/webrtc']`. A browser holding a relay reservation *can be dialed by
>    other peers*, which is the entire prerequisite for serving records.

- **Within the fabric's own keyspace, a browser node can serve records.** Every fabric peer is
  reachable over relay + WebRTC, so browsers can answer each other's queries. The cost is per-hop,
  not categorical: each hop to a *new* browser peer needs a WebRTC handshake (~1.04 s measured as
  a loopback floor with no STUN), so an O(log N) lookup is seconds when cold. Connection reuse is
  what makes this viable, and it is a design constraint, not a prohibition.
- **What is genuinely constrained is interop with the public Amino DHT.** Amino peers advertise
  TCP/QUIC, which a browser cannot dial, and they cannot reach a browser because they do not know
  its relay. That is a statement about Amino, not about browsers.
- **Two real weaknesses of browser-held records, neither of which is "cannot".** IndexedDB is
  evicted silently under storage pressure, so durability is soft; and tab churn is high, while
  Kademlia routing tables assume moderate stability. A hosted, always-reachable slice of the
  keyspace complements browser-held records rather than replacing them.
- **MEASURED 2026-08-14, and the answer is not the obvious one.** This bullet read *"whether a
  relayed `/p2p-circuit` address satisfies that check is **unmeasured** — the package is not
  installed, so it could not be read"* until then. `@libp2p/kad-dht@16.4.0`'s predicate is
  `!isPrivate(ma) && !Circuit.exactMatch(ma)` (`src/kad-dht.ts:347`), installed **only when
  `clientMode` is left unset** (`:340`), and it was run against this repository's own
  `@multiformats/multiaddr-matcher` and `@libp2p/utils`. A `/p2p-circuit` address is excluded
  by name — but a browser also listens on `/webrtc`, whose real form is
  `<relay>/p2p-circuit/webrtc/p2p/<self>`, and that **is** a WebRTC multiaddr rather than an
  exact Circuit match. **So a tab behind a public relay DOES auto-promote to server mode.**
  Worse, promotion is a property of the *relay's* address: the same tab promotes on a public
  relay and stays a client on a LAN one, because `isPrivate` reads the relay portion. **Set
  `clientMode` explicitly** — not as a style rule but because leaving it unset makes a node's
  DHT role follow network topology with nothing in the code saying so. `canRelay` is **not**
  this predicate and is not a proxy for it: the default `/ip4/127.0.0.1/tcp/0` listen
  satisfies `canRelay` and does not promote. Full working:
  `.planning/consults/2026-08-14-kad-dht-server-mode-promotion.md`
- **Querying the Amino DHT from a browser is impractical.** Amino peers advertise TCP/QUIC. Use **delegated routing over HTTP** (`https://delegated-ipfs.dev`, or self-hosted [someguy](https://github.com/ipfs/someguy)) with `filterAddrs` restricted to browser-dialable protocols. Helia's browser defaults do exactly this and additionally keep `kadDHT({clientMode:true})` as a secondary router.
- **Run a private DHT for the fabric's own keyspace — and a distinct `protocol` is one of four settings, not the whole job.** Set `protocol` (e.g. `/o2/kad/1.0.0`) so your scheduling records don't pollute — and aren't polluted by — Amino. `@libp2p/kad-dht` supports multiple named DHT instances side by side, as its own docs demonstrate for LAN + Amino. **Measured 2026-08-23: `protocol` + `clientMode` alone produce a keyspace that is inert in both directions.** Also set `peerInfoMapper: passthroughMapper` — the default strips private addresses, and a peer left with none is silently never added to the routing table, which on loopback and LAN is every peer — and register a `selectors` entry beside every `validators` entry, or every read throws `MissingSelectorError` and a caller that catches query failures reads it as an empty keyspace. See the `@libp2p/kad-dht` row above for the readings.
- **S/Kademlia (design §3.4's fix for eclipse attacks) is not implemented in js-libp2p.** The docs say the implementation is "largely based on the Kademlia white paper, augmented with notions from S/Kademlia, Coral and mainlineDHT" — that is not the same as disjoint-path lookups. Treat sybil/eclipse resistance as **build**, not **configure**, and lean on `@libp2p/keychain` + provider-signed enrollment (§3.9) instead.
## WASM execution detail
### The engine
- streaming API only,
- `Content-Type: application/wasm`,
- keyed on the **resource URL** (an IPFS gateway URL over a CID is a perfect immutable key),
- module ≳128 KB.
### Determinism — verified constraints
| Source | Deterministic? | How to constrain in V8 |
|--------|:--------------:|------------------------|
| **NaN bit patterns** from float arithmetic | ❌ | **Cannot be fixed at runtime in V8.** Verified: `node --v8-options` has no canonicalization flag. Fix at publish time via Binaryen's `denan` pass (converts NaN→0), **or** forbid floats in the guest ABI and use fixed-point integers, **or** accept the risk for workloads whose outputs never carry NaN. |
| **NaN sign bit** when no NaN input | ❌ | Same treatment. |
| **Relaxed SIMD** (`f32x4.relaxed_madd` etc.) | ❌ | **Cannot be disabled in V8.** Verified: `node --v8-options \| grep -i relaxed` returns nothing — the proposal shipped and there is no off switch. Must be **rejected at publish time** by scanning opcodes with `wabt`/`binaryen`. Non-relaxed SIMD (`simd128`) *is* deterministic and is fine. |
| **Threads / shared memory** | ❌ | Reject `shared` memory in the module's memory section at publish time. Bonus: in the browser, `SharedArrayBuffer` requires COOP/COEP cross-origin isolation anyway — **which GitHub Pages cannot set**, so threads are already off the table for the demo tier. |
| **Host imports** (clock, random, I/O) | ❌ by construction | You control this. Whitelist imports via `WebAssembly.Module.imports(module)` before instantiation. Supply a **virtualized deterministic WASI**: fixed epoch clock, seeded PRNG derived from the job ID, no filesystem, no sockets. |
| **Resource exhaustion** (OOM, stack, `memory.grow` failure) | ❌ | Pin `memory` `initial === maximum` at publish time so `memory.grow` cannot fail differently per host. Bound stack depth at compile time. |
| **Engine feature-set drift** | ❌ | Put the required feature set in the artifact's cache key (design §I.6 already does) and gate execution on `wasm-feature-detect`. |
| **Execution time / fuel** | n/a | V8 has **no fuel metering**. Options: (a) build-time gas instrumentation, (b) run in a dedicated Worker and `terminate()` on wall-clock timeout. (b) is nondeterministic but only affects *liveness*, not *results* — and redundant execution (§3.1) already covers a node that times out. **Recommend (b); it costs nothing.** |
### WASI
## Build / packaging: one codebase, three targets
- **ESM only.** libp2p 3.x and Helia 7.x are ESM-only. Shipping CJS is not possible without forking the dependency tree. Accept it.
- **`browser` condition** swaps `blockstore-idb`/`datastore-idb` for `blockstore-fs`/`datastore-level` and drops `@libp2p/tcp`, `@libp2p/mdns`, `@ipshipyard/libp2p-auto-tls`, `circuitRelayServer`. Get this wrong and Vite will try to bundle `node:net` into the browser build.
- **"Embedded in host app"** means: ESM import with a `default` condition that assumes neither Node builtins nor DOM globals at *module evaluation* time. Do all environment detection lazily inside `createNode()`.
## Benchmarking detail
- **N in one process (Node):** `@libp2p/memory@2.0.24` transport. No sockets, no ports, no OS limits, deterministic. This is where the *scaling curve shape* gets measured up to hundreds of nodes.
- **N as browser tabs:** Playwright `browser.newContext()` × N. Each context is an isolated origin with its own IndexedDB — a genuine independent node. This is where the *real WebRTC/relay* costs show up, and it will diverge from the memory-transport curve. **Both curves are needed**; the gap between them is the connectivity tax and is itself a publishable number.
- **N as machines:** the multi-machine demo. Small N, high fidelity, validates the other two.
- Same clock everywhere: `performance.now()` and the User Timing API (`performance.mark`/`measure`) exist in browser *and* Node — use them, not `Date.now()` and not `process.hrtime`.
- Fixed input via CAR files (`@helia/car`) so every run has byte-identical input addressed by the same root CID.
- Report **percentiles, not means** — straggler-dominated distributions (design §3.3) have meaningless means.
- Pin the independent variable properly. Design §3.3 argues throughput scales with the *number of independent requestors*, not raw node count. **Sweep both axes separately** or the headline chart will be measuring the wrong thing.
- `tinybench@6.1.2` (via `vitest bench`) for the per-op costs that feed the model: CID hashing throughput, WASM instantiate latency (cold vs code-cached), Noise handshake, dag-cbor encode.
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `libp2p@3.3.6` | Pin to `libp2p@2.x` | Only if a required third-party module hasn't migrated to the `EventTarget` stream API. Check before committing — as of 2026-07-24 the whole first-party ecosystem is on v3. |
| WebRTC for browser↔browser | Raw WebRTC + custom signaling | If you want to skip Circuit Relay entirely and run your own signaling server. Cheaper to operate, but you lose PeerId-authenticated signaling, the libp2p muxer/protocol stack, and interop. Not worth it. |
| AutoTLS WSS relay | Manual Let's Encrypt + nginx WSS proxy | If your relay is behind infrastructure you already TLS-terminate. AutoTLS needs the node itself publicly reachable on the port. |
| `webRTCDirect()` browser entry | WebTransport | If you only need Chromium/Firefox and are willing to run go-libp2p for the server side. js-libp2p **cannot listen** on WebTransport, and Safari has no support. Skip. |
| Delegated routing HTTP | Browser kad-dht only | Never in the browser. Use both, delegated first. |
| `@bjorn3/browser_wasi_shim` | `@wasmer/sdk@0.10.0` | If you need a full POSIX-ish environment (real filesystem, package registry integration) rather than a minimal deterministic ABI. Much heavier and it fights determinism. |
| `@bjorn3/browser_wasi_shim` | `@bytecodealliance/jco@1.25.2` | If you move to the **Component Model / WASI Preview 2**. jco transpiles components to JS+core-wasm that runs in browsers. Watch this — it is where the ecosystem is heading — but preview1 is what elfconv emits today. |
| `tsdown` | `vite` library mode | If the package is browser-only. For a browser+Node dual-condition library, tsdown's multi-entry/multi-condition story is cleaner. |
| `vitest` | `aegir@48.1.2` | `aegir` is what libp2p/Helia use and it handles browser testing + release automation out of the box. It is also extremely opinionated and assumes you follow the IPFS repo conventions. For a sole-author repo with a custom license, vitest gives more control. |
| `blockstore-idb` | `blockstore-opfs@1.0.1` | OPFS is faster than IndexedDB for large blocks. **But this package is third-party (`dozyio`), not official `ipfs/js-stores`.** Consider once the blockstore interface is stable in your code; not for the first milestone. |
| Redundant execution for integrity | zk proofs | Out of scope per design §3.1 — no JS-side tooling makes this tractable at this stage. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@chainsafe/libp2p-gossipsub@14.1.2` | **Looks current (published 2026-04-21) but depends on `@libp2p/interface ^2.0.0`** — it is a libp2p **v2** package. Gossipsub moved *into* the js-libp2p monorepo. | `@libp2p/gossipsub@16.0.5` |
| `@libp2p/noise@1.0.1` | Published 2025-09, homepage points at `packages/connection-encrypter-noise` — **a directory that no longer exists on `main`.** An abandoned monorepo-absorption attempt. Never updated since. | `@chainsafe/libp2p-noise@17.0.0` (confirmed in libp2p's own integration tests) |
| `@libp2p/yamux@8.0.1` | Same story — abandoned monorepo fork, no `stream-multiplexer-yamux` directory on `main`. | `@chainsafe/libp2p-yamux@8.0.1` |
| `@libp2p/mplex@12.0.27` | **Self-deprecated in its own source:** *"a simple stream multiplexer that has been deprecated. Please use `@chainsafe/libp2p-yamux` instead."* No backpressure — will deadlock under the load a compute fabric generates. (Helia still lists it in defaults for legacy interop; you do not need that.) | `@chainsafe/libp2p-yamux@8.0.1` |
| `tsup@8.5.1` | **README opens with:** *"This project is not actively maintained anymore. Please consider using tsdown instead."* | `tsdown@0.22.14` |
| `ipfs`, `ipfs-core`, `ipfs-http-client`, `js-ipfs` | All npm-deprecated: *"js-IPFS has been deprecated in favour of Helia."* Last touched 2023. | `helia@7.1.1` + `@helia/*` |
| `@libp2p/webrtc-star@7.0.0`, `libp2p-webrtc-star@0.25.0` | Dead since 2022–2023. The old centralized-signaling-server browser transport. Every browser-libp2p tutorial older than ~2023 uses these. | `@libp2p/webrtc` + `@libp2p/circuit-relay-v2` |
| `@libp2p/floodsub@11.0.26` | Maintained but flood-routing: O(N²) message amplification. Source says "not for production use". | `@libp2p/gossipsub@16.0.5` |
| `@libp2p/plaintext@3.0.24` in production | No encryption. Fine as a benchmark baseline (isolates crypto cost) — **never** on a real path. | `@chainsafe/libp2p-noise` |
| `@multiformats/multiaddr@12.x` | libp2p v3 requires `13.x`; v13 removed DNS resolution and restructured tuples. Mixing versions produces confusing dial failures. | `@multiformats/multiaddr@13.0.3` |
| `multiformats@13.x` transitively | `CID` identity checks fail across a v13/v14 boundary. Add an npm `overrides` entry pinning `multiformats@14`. | `multiformats@14.0.5` |
| `wasm-metering@0.2.1` | Last published 2022. Predates SIMD, bulk-memory, reference types, GC. Will mis-instrument or crash on modern modules. | Build-time instrumentation, or Worker + `terminate()` timeout |
| `wasi-js@1.7.3` | Last published 2023-02. Abandoned. | `@bjorn3/browser_wasi_shim@0.4.2` |
| `benchmark@2.1.4` | Last published 2023, Node-oriented, poor ESM story. | `tinybench@6.1.2` |
| `node:wasi` for guest execution | Experimental, Node-only, and gives you *different host semantics from the browser* — which is a determinism bug by construction. | `@bjorn3/browser_wasi_shim` on both platforms |
| Wasmtime / WasmEdge / Marine **in the node agent** | Would fork the agent into browser and non-browser builds, destroying the "one codebase" property that is the project's core bet. | V8's built-in `WebAssembly`. Server-side runtimes belong in the Part I *build* pipeline only. |
| `SharedArrayBuffer` / WASM threads in the browser tier | Requires COOP/COEP cross-origin isolation headers. **GitHub Pages serves no custom headers**, so this is unavailable on the declared hosting target — and threads are a nondeterminism source anyway. | Multiple dedicated Workers with `postMessage`, one WASM instance each |
| TS `moduleResolution: "node"` / `"node10"` / `"classic"`, `baseUrl` | **Removed in TypeScript 7.0 — hard errors, not warnings.** | `moduleResolution: "bundler"`, path mapping via `paths` without `baseUrl` |
## Stack Patterns by Variant
- Transports: `webRTC()`, `webRTCDirect()`, `webSockets()`, `circuitRelayTransport()`
- Listen on `['/p2p-circuit', '/webrtc']` — nothing else is possible
- `kadDHT({ clientMode: true })` + delegated routing HTTP as primary content routing
- `blockstore-idb` + `datastore-idb`
- Storage quota is a real limit: budget the blockstore and evict; browsers evict IndexedDB silently under pressure
- One WASM `Module` compiled per session, shared across dedicated Workers
- Add `tcp()`, `tls()`, `mdns()`, `uPnPNAT()`, `autoNATv2()`, `dcutr()`
- `circuitRelayServer()` with **raised** `reservations.maxReservations`, `defaultDurationLimit`, `defaultDataLimit`
- `autoTLS()` + `keychain()` + a persistent `datastore-level` ⇒ stable `<peerId>.libp2p.direct` WSS address across restarts
- Also listen `/ip4/0.0.0.0/udp/PORT/webrtc-direct` with a keychain-persisted cert ⇒ second browser entry point with no cert dependency
- `kadDHT()` in server mode on a **private protocol string** (`/o2/kad/1.0.0`) for the fabric keyspace
- `blockstore-fs` + `datastore-level`
- Node profile minus `uPnPNAT`/`autoTLS` unless the host is publicly reachable
- Do **all** environment detection lazily inside the factory, never at module scope, or the `default` export condition will crash on import
- `@libp2p/memory` transport + `plaintext()` + `MemoryBlockstore`
- No timers, no real network, no ports — 100+ nodes in one Vitest process
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `libp2p@3.3.6` | `@libp2p/interface@^3.2.5` | Every `@libp2p/*` module must resolve to interface v3. A v2 module (e.g. `@chainsafe/libp2p-gossipsub@14`) will type-check-fail or fail at runtime with confusing symbol errors. |
| `libp2p@3.x` | `@multiformats/multiaddr@13.x` | Stated explicitly in the migration guide. Not optional. |
| `libp2p@3.x` | `multiformats@^14.0.0` | Add an npm `overrides` pin to prevent a v13 from sneaking in transitively. |
| `libp2p@3.x` | `uint8arrays@^6.1.1`, `uint8arraylist@^3.0.2` | v5/v2 respectively will produce type mismatches at stream boundaries. |
| `helia@7.1.1` | `libp2p@3.x` | Depends on `@libp2p/interface ^3.2.4`. Aligned. |
| `@helia/block-brokers@5.2.4` | ⚠️ **lags** | Still on `@helia/interface ^6.2.1` / `@helia/utils ^2.5.2` while `helia@7` uses `@helia/interface ^7.1.0`. **Do not add it directly** — use `helia@7`'s built-in composition (`withBitswap`, `withHTTP`) instead. Same caution for `@helia/routers@5.1.1` (last touched 2026-05-29) vs the newer split packages `@helia/delegated-routing-client` / `@helia/trustless-gateway-client` / `@helia/fallback-router` (all 2026-07-24). |
| `typescript@7.0.2` | `rolldown-plugin-dts@0.27.14` | The plugin auto-selects the `tsgo` generator when TS 7 is present. Prefer `isolatedDeclarations: true` ⇒ `oxc` generator ⇒ no TS API dependency at all. |
| `typescript@7.0.2` | `typescript-eslint@8.65.0` | Verify before adopting — typescript-eslint uses the TS API heavily, and TS 7's API is unstable until 7.1. **Fallback: `oxlint@1.75.0`, which has no TS-API dependency.** |
| `vitest@4.1.10` | `@vitest/browser@4.1.10` + `playwright@1.61.1` | Versions must match exactly between `vitest` and `@vitest/browser`. *(SUPERSEDED 2026-08-22 — the pin is `playwright@^1.62.0` (root `package.json:30`, installed `1.62.0`), and browser mode needs a **third** vitest package, `@vitest/browser-playwright@4.1.10` (`package.json:28`), which must match the other two exactly. The `playwright` version is not pinned against `vitest` at all; it resolves against that provider's `peerDependencies` at install time.)* |
| `vite@8.1.5` | Node ≥20.19 / ≥22.12 | Node 24 LTS satisfies this. |
| `@bjorn3/browser_wasi_shim@0.4.2` | any | Zero dependencies, pure JS. No compatibility surface. |
## Open Questions / Gaps
## Sources
- `npm view <pkg> version | time.modified | deprecated | dependencies`
- `libp2p/js-libp2p` — [`doc/migrations/v2.0.0-v3.0.0.md`](https://github.com/libp2p/js-libp2p/blob/main/doc/migrations/v2.0.0-v3.0.0.md) — v3 breaking changes
- `libp2p/js-libp2p` — [`doc/CONFIGURATION.md`](https://github.com/libp2p/js-libp2p/blob/main/doc/CONFIGURATION.md) — module inventory
- `libp2p/js-libp2p` — [`packages/integration-tests/package.json`](https://github.com/libp2p/js-libp2p/blob/main/packages/integration-tests/package.json) — **the canonical compatible package set**
- `libp2p/js-libp2p` — [`packages/transport-circuit-relay-v2/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/constants.ts) — 2 min / 128 KiB / 15 reservations / 2 h TTL
- `libp2p/js-libp2p` — `packages/transport-webrtc/README.md` — WebRTC vs WebRTC-Direct, browser listen limits
- `libp2p/js-libp2p` — `packages/transport-webtransport/src/index.ts` — "only allows dialing… requires QUIC support to land in Node JS"
- `libp2p/js-libp2p` — `packages/stream-multiplexer-mplex/src/index.ts` — self-deprecation
- `libp2p/js-libp2p` — `packages/kad-dht/src/index.ts` — `clientMode` default, multi-DHT pattern
- `libp2p/js-libp2p` — `packages/protocol-perf/src/index.ts` — perf protocol API
- `ipfs/helia` — [`packages/libp2p/src/utils/libp2p-defaults.browser.ts`](https://github.com/ipfs/helia/blob/main/packages/libp2p/src/utils/libp2p-defaults.browser.ts) — **best working browser config reference**
- `ipfs/helia` — `packages/libp2p/src/utils/libp2p-defaults.ts` — Node config incl. AutoTLS
- `ipfs/helia` — `packages/delegated-routing-client/src/utils/delegated-http-routing-defaults.ts` — `delegated-ipfs.dev`, `filterAddrs`
- `ipshipyard/js-libp2p-auto-tls` — `README.md` — `<peerId>.libp2p.direct` mechanism
- `WebAssembly/design` — [`Nondeterminism.md`](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md) — **normative** list of nondeterminism sources
- `WebAssembly/binaryen` — `src/passes/pass.cpp` — `denan` pass exists and converts NaN→0
- `egoist/tsup` — `README.md` — "not actively maintained anymore"
- `node --v8-options` on V8/Node — **no** relaxed-SIMD flag, **no** NaN-canonicalization flag, no fuel metering
- `nodejs.org/dist/index.json` — Node 24 "Krypton" is active LTS (24.18.0); Node 26.5.0 is Current
- [libp2p.io/docs/webrtc-browser-connectivity](https://libp2p.io/docs/webrtc-browser-connectivity/) — browser transport matrix, STUN/signaling requirements
- [docs.wasmtime.dev — Deterministic Execution](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html) — determinism knobs (contrast case for what V8 lacks)
- [devblogs.microsoft.com — Announcing TypeScript 7.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/) — breaking changes, no stable API until 7.1
- [vitest.dev — Browser Mode](https://vitest.dev/guide/browser/) — providers, `instances`, dual-project config
- [specs.ipfs.tech — Delegated Routing V1 HTTP API](https://specs.ipfs.tech/routing/http-routing-v1/)
- Safari WebRTC-Direct support status — could not confirm from any authoritative source
- Practical magnitude of cross-architecture NaN divergence in V8 — no measurement found
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Each rule below was paid for. The cost is stated so nobody relaxes one on the grounds that
it looks like ceremony.

### Concurrent agents share ONE working tree and ONE git index

- **Commit with explicit paths — `git commit -- <path> <path>` — never a bare `git commit`.**
  A bare commit sweeps whatever another agent has *already staged* into your commit. The tree
  stays green and the history is silently wrong. "Never `git add -A`" is necessary but **not**
  sufficient: it constrains what you stage and says nothing about what is already staged.
  After committing, read `git show --stat` and confirm only your own files are in it.
- **`git add` immediately after each edit group** — staged content lives where another agent's
  working-tree revert cannot reach it.
- **But `git add` only *between* test runs, never *during* one.** At least two specs snapshot
  `git status --porcelain` around themselves and assert it is unchanged —
  `packages/node/src/discover-arm.node.test.ts` and
  `packages/node/src/bench-attestation.node.test.ts` — so moving the index mid-run turns them
  red for reasons unrelated to any code. **With concurrent agents this is not self-discipline
  but a shared hazard**: one agent staging a file has reddened another agent's sweep. If either
  spec fails, check what the index was doing before you look at the code.
- **Never `git stash` a path you do not own.** It is a write despite the word — it reverted
  ~250 lines of a concurrent agent's in-progress work. Likewise never `git checkout --` a file
  you did not write.
- **Restore a planted mutation by the surgical inverse of your own edit — not by `cp`.**
  This line read *"restore with `cp` + `cmp`"* until 2026-08-06, and that rule is **correct
  against `git stash` and insufficient against concurrency**. `cp` restores the *whole file*
  to a snapshot, which is only safe if you were the sole writer for the entire
  plant-to-restore window. **Twice in one session you were not**: a concurrent agent planted
  into `fabric-node.ts` between another agent's clean `git status --porcelain` and its own
  edit, producing a two-hunk diff on a one-line plant. A `cp` there would have silently
  reverted live work — the exact failure `cp` was adopted to prevent.
  **So: reverse exactly the line(s) you changed, then verify with `cmp` against a snapshot
  you took *immediately before planting* — that is the check, and nothing else is.**
- **The hunk count is a one-way test, and reading it as the check is how this rule failed
  within a day of being written.** *More* hunks than your plant proves another writer is in
  the file. **Equal hunks proves nothing** — a plant dropped inside a hunk you already had
  open leaves the count exactly where it was, which is what happened on 2026-08-06 to an
  agent editing a file it had already modified. The count is a cheap alarm, not a
  verification: it can only ever tell you to stop, never that it is safe to proceed. `cmp`
  is what actually held.
- **Agents that plant must not run in parallel on shared source.** Checking that two plans'
  `files_modified` are disjoint is **not sufficient**, because a plant can touch any file —
  and on 2026-08-06 two verifiers launched together both planted `fabric-node.ts`. The cost
  was not a lost edit but a **false finding**: one agent read the other's live plant as an
  intermittent fail-open in the admission gate, it was escalated as a possible security
  defect, and refuting it took 111 executions, a patch to `node_modules`, and a reading of
  the library's call ordering. **Give parallel agents disjoint plant targets, or run them
  sequentially.** An observation taken while another agent holds a plant is not a measurement
  of the tree.
- Never switch branches without a clean `git status`.
- A whole-tree `tsc --noEmit` reports another agent's mid-edit files. **Re-run before
  diagnosing, and never "fix" a file outside your own list.**

### Measurement

- **Never trust an exit code you did not read directly.** `EXIT=$?` on the line *immediately*
  after the command — no pipes, no trailing `echo`/`tail`. A trailing `tail` has made a
  *failing* vitest run report success more than once.
- **Run vitest by project** — `npx vitest run --project node|browser|e2e|perf`. A bare path
  fans out across all four.
- **Prefer a comparative reading to an absolute one.** An absolute threshold silently encodes
  the machine, the load and the I/O weather of the day it was written, and then fails
  somewhere else for reasons that have nothing to do with the code. A ratio taken *within one
  run* cancels all three. So: measure the thing against a calibration workload in the same
  run and assert on the ratio; compare a file against its own earlier reading; compare arm A
  against arm B of the same fixture. Reserve absolutes for the cases where nothing else is
  available, and say what they were sited against.
- **Measure the process, not the machine.** System load average counts machine-wide runnable
  *and* I/O-blocked threads and says nothing about whether *your* process got CPU — this host
  has shown load 33 while a CPU-bound process still held 95% of a core. Use
  `/usr/bin/time -p <cmd>` and record `real`/`user`/`sys` plus the derived `(user+sys)/real`.
  That ratio is a *comparability key*, not a verdict: for a spawn- or network-heavy spec
  `real` legitimately exceeds CPU time because the process is waiting, not starving.
- **Never write a measured span you did not measure**, and record the conditions beside it.
  Note `--reporter=json` attributes **no hook time**, so a spawn in `beforeAll` makes a slow
  file look instant — a 154 s file once reported 235 ms.
- **Attribute a failure by measurement, not by plausibility.** "Passes in isolation" is a
  claim to verify, not a diagnosis; one recorded instance of it was simply false. Two
  hypotheses about a single defect have died here despite each having arithmetic that fit —
  a number that agrees with a theory is not the theory's proof.

### Proofs

- **A proof that cannot fail is not a proof.** Plant the mutation, *watch* it go red, restore,
  and record the observed text. If a plant leaves the file green, say so and name which case
  actually carries the claim — a green you did not watch fail is worse than a gap you reported.
- **A comment is not a specification.** Rules here have entered the tree as
  proposal → docblock → implementation, and been retracted. When a comment and a requirement
  disagree, the requirement wins and the comment gets fixed.
- **Descoped is not satisfied; unmeasured is not met.** Never close a gap by widening what
  counts as passing.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
