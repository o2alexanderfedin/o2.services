# o2.services — P2P Native Cloud

## What This Is

A peer-to-peer compute fabric that runs untrusted code safely on volunteer and
enterprise nodes, moves code to data instead of data to code, and keeps each
owner's data pinned to their own device for sovereignty. The node agent is
TypeScript + WASM so it runs unmodified in a browser tab, in Node.js, or
embedded in a host application — which makes every visitor to a web page a
potential compute node.

## Core Value

**Usable capacity grows super-linearly with the user base, without any raw data
leaving its owner's device.** If everything else fails, a map/reduce job must
distribute across N independently-owned nodes, return a result whose integrity is
demonstrable, and demonstrably never move the underlying data off the owner's node.

**What "demonstrable integrity" means precisely** — sovereignty constrains *who*
may execute, so integrity is layered by threat rather than claimed uniformly.
Sovereignty is a boundary around the **owner**, not around one device: an owner's
node set (their own devices) can hold the same data and execute redundantly
without any data leaving the owner's trust domain (§3.5 already scopes
speculation to "the owner's node set, never across owners").

| Data | Integrity mechanism |
|------|--------------------|
| Public / shared | Redundant execution of the identical module on independent nodes, with commit-reveal, ≥1 replica backbone-anchored |
| Sovereign, owner has ≥2 live nodes | Redundant execution **within the owner's node set** — catches faults and environmental divergence without data leaving the trust domain |
| Sovereign, owner has 1 live node | Map is **owner-attested**; recorded as such in the receipt |
| Any cross-owner aggregate | The aggregation *over* contributions is verified, independent of how each partial was produced |

**What owner-domain replication does not do.** Redundant execution derives its
power from executor *independence*. Two devices under one owner are correlated —
same operator, same intent, likely the same build — so an owner-domain quorum
catches accidental corruption but **not** a malicious owner biasing their own
contribution. All replicas under one adversary make a quorum unanimous on a
forgery rather than degrading, the same structure as an eclipsed DHT lookup.
Defence against a biased owner is therefore the **verified reduce** plus backbone
anchoring, not the owner's own quorum. Owner-domain agreement must be reported
distinctly from independent-operator agreement so the stronger claim is never
implied by the weaker one.

**Backbone encrypted replicas are availability-only.** Executing a map requires
decryption, so a backbone node running a sovereign task would see plaintext —
reintroducing exactly the exposure sovereignty prevents. Without a TEE (v2),
execution-eligible replicas are the owner's own devices only.

## Current Milestone: v2.0 Open the Doors

**Goal:** The fabric becomes reachable by real people on the real internet, and the first
genuine scaling curve is taken on hundreds of independently-owned devices across several
continents.

**Why this milestone exists.** Everything so far was measured on one machine — loopback, the
memory transport, Playwright contexts. Those establish shape and they cannot establish the
project's headline claim, which is about *independently-owned* nodes. Two things changed on
2026-08-24 and between them they remove the reason that claim stayed unmeasured. First, a
**Cloudflare Durable Object was measured doing three jobs at once**: a dialable libp2p peer
over WSS with a persisted identity, a working Circuit Relay v2 server, and a record store
with exact expiry — the roles a browser mesh structurally cannot supply itself. Second, the
owner has **a few hundred willing testers across countries and continents**, so the missing
ingredient was never hardware; it was something to give them access to.

**Target features:**
- **A multi-region always-on tier — three regions, named by the owner 2026-08-25:
  `bootstrap-us`, `bootstrap-eu`, `bootstrap-sam`** (United States, Europe, South America;
  *temporarily* three, so the set is expected to grow). One identity per object — sharding is
  addressing, not provisioning. Multi-region from the start so the WebRTC failure rate is not
  smeared by everyone signalling through one city.
  **Three facts from Cloudflare's data-location documentation shape this and were read rather
  than assumed.** `locationHint` is **not a guarantee** — the object is placed in a datacenter
  chosen to minimise latency *from* the hint, so no claim may be made about where it actually
  runs. `jurisdiction` **is** binding, and takes `eu`, `us`, `fedramp` — so the EU object
  should be created in the `eu` jurisdiction rather than merely hinted at it, which matters
  for a project whose pitch is data sovereignty; **South America has no jurisdiction and can
  only ever be a hint** (`sam`). And **location is fixed at creation**: only the first `get()`
  for an object respects the hint and objects never move afterwards, so the creating call site
  must be the only one that can create them — a stray `get()` from anywhere else permanently
  sites the object wherever that call came from
- **Record expiry ported to an alarm, not built from scratch. CORRECTED 2026-08-25, and the
  correction is a repeat.** This bullet first read *"`@libp2p/kad-dht@16.4.0` never expires
  provider records"* — which is **the fourth wrong answer in a row about the same number**,
  after 48 hours, 24 hours, and never. `RFC-0003-RESPONSE-04` §8 had already recorded the
  first three and corrected them; this milestone reproduced the third without reading it.
  What is true: the *store* ignores `providers.provideValidity` and `cleanupInterval`, which
  are declared and unread — but `reprovide.validity` is honoured, and **this project already
  sets it**. `providerRecordPolicy` (`packages/libp2p/src/constants.ts:316`) derives sweep
  interval and republish threshold from one validity of **one hour**, and both tiers pass it
  (`fabric-node.ts:2154`, `browser-node.ts:1539`), proven across two processes by
  `packages/node/src/provider-expiry.node.test.ts` (NET-06). **So the requirement is
  smaller and sharper than it looked**: the existing policy is driven by a `setInterval`,
  which will not fire on workerd because `Date.now()` does not advance without I/O, so the
  work is to drive the same policy from a Durable Object alarm — and to add the sweep the
  `/o2/<nodeKey>` value records still lack. The read-time half is already satisfied by
  `verifyCapabilityRecord`'s `expiresAt` check through `DhtRecordIndex`
- **Persistence as a datastore.** Durable Object storage behind `interface-datastore`, after
  which certificate and verdict caching is worth having
- **A correct inbound listener.** `direction: 'inbound'`, a remote address derived from
  `CF-Connecting-IP`, an answer for the absent `bufferedAmount`, and a socket written against
  the hibernation API. Each of the first two was measured producing a node that looks healthy
  and silently refuses to work or to scale
- **Two fallback rungs below WebRTC** — TURN, then a relayed connection, with the relay's
  measured 64 KiB-each-way ceiling stated where a design would otherwise assume 128
- **Entry conditions for a public cohort** — consent before a single CPU cycle, an always-on
  indicator, a stop control that provably drops CPU to zero, a kill switch that needs no
  redeploy, and telemetry that turns volunteers into measurements rather than anecdotes
- **The public run itself**, and the numbers only it can produce: the real scaling curve, the
  WebRTC failure rate by country and network class, and the diurnal churn curve

**Carried in from v1.1, all four:** `BENCH-06` (becomes the run's headline experiment),
`NET-03` (closed by a route it was not designed for — TLS terminated at the edge, so the
certificate requirement does not arise), `AOT-03` and `AOTW-06` (a parallel track with a
different skill surface; neither is helped by the new tier, because both need execution and
execution is exactly what a Worker refuses).

**Not gated on disclosure.** The repository has been public since 2026-07-26 and the owner
ruled on 2026-08-24 that the project is **open source, with monetization for commercial use
added later**. The public run is therefore an ordinary phase.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. Hypotheses until shipped. -->

- [ ] Node agent runs identically in browser, Node.js, and embedded contexts
- [ ] Nodes discover each other and connect through NAT via libp2p
- [ ] Deterministic WASM tasks execute in a sandbox on any node
- [ ] Data is content-addressed and pinned to its owner's node
- [ ] Map placement follows data placement — code ships to the owner, raw data never leaves
- [ ] Result integrity via redundant execution and result comparison
- [ ] Decomposable reduce merges partials up a hierarchical tree (no all-to-all shuffle)
- [ ] Decentralized placement via DHT discovery and power-of-d-choices selection
- [ ] Native binaries translate to portable sandboxed WASM (elfconv AOT pipeline)
- [ ] Translated artifacts are content-addressed, signed, and cached over IPFS
- [ ] Benchmark harness measures throughput against node count and publishes numbers
- [ ] Public demo distributes real work across browser tabs and machines

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Accepting outside contributions** — sole authorship is what keeps the
  commercial license track available for the entire codebase; see CONTRIBUTING.md
- **TEE / confidential-computing backbone (SEV-SNP, TDX, Nitro, CCA)** — the doc's
  §3.1 tier-2 trust story; requires datacenter hardware and is not reachable from
  the browser tier this milestone targets
- **Native execution in microVM / Firecracker / Kata** — same reason; the AOT-to-WASM
  path is this milestone's answer to native code
- **Key-partitioned all-to-all shuffle** (§3.5 solution 3) — the expensive escape
  hatch for exact holistic ops; decomposable reduce and mergeable sketches cover
  the target workloads
- **Incentives, payments, staking, reputation** (§3.8) — a market layer is
  meaningless before capacity scaling is proven. **Note:** this excludes the
  *market*, not §3.9 provider-gated enrollment. Enrollment (node identity,
  hardware-backed keys, provider-signed certificates) is **in scope** — it is what
  makes quorum anti-affinity and backbone audit-sampling possible, and browser
  compute cannot be paid anyway (Coinhive's largest operators earned single-digit
  dollars over months before being blocked by default)
- **Emulation fallback / container2wasm** (Part I.5) — ~10x+ slowdown for kernel
  fidelity nobody has asked for yet
- **Making the repository or demo public** — gated on a separate explicit decision
  superseded 2026-07-26: the repository was made public by owner decision

## Context

**Origin.** The full architecture is specified in
`docs/p2p-native-cloud-design.md` — Part I is the execution substrate
(native→WASM AOT, artifact caching), Part II is the P2P fabric (trust topology,
scheduling, map/reduce, sovereignty). This project implements it.

**The novel composition** (per the doc's own risk framing): unifying managed and
safely-sandboxed native execution via AOT-to-WASM, sovereignty-by-placement as a
first-class scheduling constraint, and a per-job trust dial. The individual
pieces are proven — Bacalhau and IPVM for compute-to-data, Fluence for
coordinator-free task graphs, libp2p for transport, elfconv for binary lifting.
The combination has not shipped as a product.

**Why TypeScript + WASM.** Portability is the product. A node that runs in a
browser tab makes every page visitor a potential participant, which is the only
way "capacity scales with the user base" becomes literal rather than aspirational.
It also collapses a layer: in the browser the WASM runtime *is* V8, so Wasmtime
and WasmEdge disappear from the edge tier entirely, and the doc's §I.6 V8
code-caching path becomes first-class rather than an afterthought.

**Where the real research risk lives** (doc §5): decentralized scheduling that
stays efficient under churn, locality, and trust constraints simultaneously;
tree-reduce robustness when the aggregation backbone itself churns; keeping the
verification tax affordable at scale.

**Legal posture.** Dual-licensed and source-available, not open source. The
default track permits viewing and a 32-day commercial trial; anything more needs
a signed commercial agreement. Both licenses are unreviewed drafts.

## Constraints

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
- **Determinism**: enforced at the serialization boundary, not by analysis. Anything
  hashed or content-addressed is encoded with strict DAG-CBOR, which rejects
  `NaN`/`Infinity`/`-Infinity`, normalizes `-0.0`, and mandates one float width.
  Protobuf bytes are never hashed
- **Hosting**: GitHub Pages serves static files only and runs no server-side
  process — it can host the client but not a relay or bootstrap node
- **Disclosure**: ~~Public hosting is public disclosure, and deployment must be a
  separately-triggered gate.~~ **RETIRED as a constraint 2026-08-24 — the project is open
  source.** The reasoning is kept because it explains why the guard exists: public hosting
  is disclosure, EPO and China have no grace period, and the repository was made public on
  2026-07-26, so those rights were already forfeit for what was disclosed then. The owner
  has now ruled open source with monetization for commercial use added later, which settles
  it outright rather than trading it away. **`DEMO-04`'s guard
  (`packages/node/src/disclosure-gate.node.test.ts`) still passes and still forbids a deploy
  workflow — but its stated rationale is now spent, so whether it is retired, repurposed as
  an ordinary "no accidental deploys" rule, or kept as written is an open decision and not a
  constraint**
- **Platform**: `elfconv` requires AArch64, statically-linked, unstripped binaries
  and is a C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`,
  not a TypeScript component
- **Contributions**: None accepted; sole authorship preserves the commercial
  license track. **Revisited and settled 2026-08-24 under the open-source ruling.** The
  question raised was that monetising commercial use later means relicensing, relicensing
  requires owning every line, and open source without a CLA erodes that one merged pull
  request at a time. **The owner ruled to rely on the civilized world rather than build CLA
  machinery** — so no CLA is planned, and the row above stands as written. Recorded so the
  absence reads as a decision rather than an oversight, and so nobody re-opens it

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + WASM for the node agent | Portability is the product; browser execution makes "capacity scales with users" literal. Collapses the WASM-runtime layer to V8 in the browser | — Pending |
| ~~Relay: public IPFS infra primary, own relay fallback~~ **INVERTED** → own backbone relay primary, public infra opportunistic | Research disproved the original. Browsers can only dial DNS+WSS / WebTransport / WebRTC-Direct, and most public nodes offer none of those (`no valid addresses available to dial`). Browser kad-dht is client-mode only; pubsub discovery is documented as not production-fit. Doc §3.7 already prescribed backbone relays | ⚠️ Revised 2026-07-24 |
| All nodes have equal functionality; only discovery differs | Owner decision 2026-07-26. No tier, no class. A browser cannot bind a listening socket, so it cannot be a seed a newcomer dials cold and must be found via a relay — but once connected it is indistinguishable, and it executes, stores, serves and takes quorum slots identically. Proven cross-device in Phase 3. Client-mode-only DHT and leaves-only reduce were inherited assumptions, both reversed. Background-tab throttling is a lease-duration problem. Any decision keying on node kind is wrong; the only legitimate use is shared-dependency analysis over the discovery graph | — Done |
| Build the public demo, gate publishing separately | Building discloses nothing; deploying does. Kept the provisional-patent option alive until explicitly surrendered | — **Superseded 2026-07-26** |
| Make the repository public | Owner decision, taken with the consequence stated: EPO/China rights permanently forfeited, US provisional window (12 months from first disclosure) now running. DEMO-04 unaffected — no deploy workflow was added | — Done |
| **DEMO-04 repurposed, not retired** — the guard stands, its rationale is replaced | Owner ruling 2026-08-25, on open question 6. The guard forbids a deploy workflow to prevent an irreversible legal event; that reason is spent twice over (public since 2026-07-26, and the open-source ruling). The replacement is narrower and still live: **deploying a paid tier does not happen by itself.** In a milestone that adds a Cloudflare deploy to an account with no hard spending ceiling, an accidental deploy has no floor under it. `ARCHITECTURE.md` §7's split survives intact — *building* `packages/cloudflare/` stays distinct from *deploying* it | — Done |
| **Autonomous execution stops at the Cloudflare boundary** | Owner ruling 2026-08-25. Everything in Phase 29 that needs no account proceeds unattended: the package, the `interface-datastore` binding, the four guards, and the build test that settles open question 1. **The billing alert and the first deploy are owner acts.** Phase 29's criteria 1 and 2 therefore stay open and must be *reported* open — ticking either on locally-done work would widen what counts as passing | — Standing |
| Full scope in v1, Part I sequenced last | Fine granularity allows elfconv AOT as late phases, so it doesn't block the capacity-scaling and sovereignty thesis the doc's §6 front-loads deliberately | — Pending |
| Demo target: multi-machine + multi-tab, plus benchmark harness | A live demo proves it *works*; published benchmark numbers prove the *scaling thesis*. Source proves authorship. All three are needed | — Pending |
| No outside contributions | Sole authorship keeps the commercial license track available for every line, with no CLA machinery | — Pending |
| **Verify the reduce, not the map** (resolves C3) | Sovereignty removes the second *independently-operated* node, so cross-operator redundancy cannot apply to a sovereign map. Partials *do* move, so the aggregation tree is replicable and backbone-anchorable. Full cross-operator redundancy is demonstrated on public/shared data where no conflict exists | — Pending |
| **Owner-domain replication promoted to v1** (amends C3) | Sovereignty bounds the *owner*, not one device — an owner's own devices share data without leaving the trust domain, so redundant execution applies within the owner's node set. Catches faults and environmental divergence; does **not** defend against a biased owner, so it supplements rather than replaces the verified reduce. Doc §3.3/§3.5/§4 already assume owner node *sets*; §3.9's node-key/user-key split is the enabling primitive. Lands as increments to Phases 5 and 7, no new phase. **How those devices come to share the data is now stated in the row below**: the owner places it there, the fabric does not move it | — Pending |
| **Raw sovereign data does not move between nodes** (owner decision 2026-07-28; narrows the row above) | Redundant sovereign execution within an owner's node set requires the owner to have placed the data on each of their nodes already. The fabric will not move raw sovereign data, even between nodes the same owner controls. VER-08/09's "redundantly within the owner's own node set" therefore presumes prior out-of-band replication, not fabric-mediated fetch. The mechanism is `EgressGuard.send`, which refuses any frame containing a registered sovereign payload instead of forwarding it (Plan 13-04) — so the rule is checkable against the code rather than a policy someone has to remember. Recorded here, and against the Phase 19 roadmap entry, because a planner reaching VER-08/09 would otherwise assume the fabric can fetch the input onto the second node. **Narrowed 2026-07-28 by `13-VERIFICATION-2.md`, which measured the difference:** what the code delivers is *raw sovereign data does not leave a node **holding a registration for it***, and only the **executing** node registers. A submitting node that never ran the task holds no registration, and was measured shipping the raw 95-byte input inside a 138-byte block-response frame. The sentence above is the intent; DATA-10 (Phase 13.1) is what closes the distance | — Partial |
| **Determinism is detected, not predicted** (supersedes the deleted P0 spike) | Verification is a byte comparison of two runs of the same module. Predicting statically that a module cannot diverge is a far harder problem and the comparison is the mechanism regardless. An admission gate was built and deleted: every check was either enforced by the runtime already (imports), impossible in one thread (atomics), or self-reporting as a disagreement. Cost of a nondeterministic module is one wasted redundant execution | ✓ Good |
| **Cross-implementation verification is out of scope** | Verification compares the same module on two nodes, never two independent implementations of the same computation. Nothing in the system dispatches differing code for comparison | ✓ Good |
| Enrollment (§3.9) in scope; incentives (§3.8) out | Enrollment enables quorum anti-affinity and audit sampling — load-bearing for integrity. Incentives are a market layer, and browser compute demonstrably cannot be paid | — Pending |
| **A capability with no consumer is not delivered** (v1.0 audit, 2026-07-27) | 36 requirements were marked Done on the strength of a unit-tested mechanism that no runnable entry point reaches. The ledger was corrected rather than the work undone: `[ ]` + *Built, not wired*. Tracing must start **at the entry point**, not at the module — a barrel export is not a wire, and a passing spec proves only that the pieces compose when someone composes them | ✓ Good |
| **An optional hook with a silent default is a hole** (v1.0 audit) | `serveAgent`'s six hooks default to allow/empty/accept, so four phases of unwired mechanism produced a *working system that quietly did nothing*. One of them was a live bug — static-host rendezvous answered `[]` forever with the signature `{asked: true, dialed: [], failed: []}`. Make the omission a decision someone records | ✓ Good |
| **v1.0 not archived** (owner decision, 2026-07-27) | The audit returned `gaps_found`. Archiving would file 36 unwired requirements under a completed milestone. The live bug was fixed, the ledger corrected to an honest 32/72, and full integration scoped as v1.1 instead | — Done |
| **Ed25519 verification: `crypto.subtle` first, libsodium as the fallback** (owner ruling, 2026-08-09) | `@noble/curves` costs **1.348 ms** per verify — **99.23%** of a chain link, measured against the real `payloadOf` shape; everything else in `verifyChain` (dag-cbor encode, two `fromHex`, four compares) is **0.77% combined**. Native `crypto.subtle` Ed25519 is **0.0393 ms** in chromium, 0.08 firefox, 0.11 webkit — up to **37×**. But `crypto.subtle` is **entirely undefined outside a secure context**, measured `undefined` in all three engines at `http://10.144.82.249:8799`, which is exactly the LAN origin `bin/seed.ts` prints and QR-encodes for the multi-device demo. libsodium is WASM, needs no secure context, and runs **0.0887 ms** — 15.2× noble. **Taken against the standing recommendation**, which was `subtle → noble`: noble is already a transitive dependency of `@chainsafe/libp2p-noise` at **zero marginal bundle cost**, while libsodium is **314.9 KB gzip** against a whole-demo bundle of 168.93 KB — 1.9× the app — and buys ~10 ms per chain verification on the one tier that pays it, off the per-task path. The owner ruled libsodium anyway; the cost is mitigated by lazy `import()` behind the capability check, so no secure-context tier fetches it | Not started — Phase 25 |
| **The backend is reached through an adapter: a synchronous `verify` behind an asynchronous one-time `init`** (owner ruling, 2026-08-09 — second ruling, same day) | Asked whether Phase 25 should perform the async migration, ship the backend unwired, or convert only the mechanical call sites, the owner ruled *"ideally, we should use an adapter pattern."* The migration was **priced first**, as the earlier ruling required: **9 production call sites** (6 mechanical, 3 near-mechanical) plus one structural obstacle — `PeerVerifier.verifiedPeers` is a **synchronous getter** feeding the block-fetch path (`RpcBlockSource`/`FetchingBlockstore`) and cannot go async without an interface redesign. **The adapter dissolves that rather than deferring it.** Measured by execution, Node v25.9.0: `noble.verify` and libsodium's `crypto_sign_verify_detached` both return a **`boolean`**, not a Promise — libsodium's only asynchronous part is WASM instantiation, which happens **once** at `await sodium.ready`. So a port shaped `{ init(): Promise<void>; verify(...): boolean }` has **two** conforming implementations; `verifyChain` stays synchronous and no call site changes. **The consequence is stated, not buried: `crypto.subtle` cannot implement the sync port** — `subtle.verify` returns a Promise and JavaScript cannot await one synchronously (`Atomics.wait` needs cross-origin isolation, which GitHub Pages cannot supply). So the **sync** trust path runs on libsodium-or-noble, and subtle serves only the **already-async** call sites, through a separate port. This **scopes** the first ruling rather than reversing it: *"subtle first"* still holds wherever subtle can be called at all. Wanting subtle on the sync path too reopens the 9-site migration and the `PeerVerifier` redesign | Not started — Phase 25 |
| **Open source, with monetization for commercial use added later** (owner ruling, 2026-08-24) | Settles the disclosure question outright rather than trading it away — and it was already half-settled, since the repository has been public since 2026-07-26. Two consequences are recorded rather than assumed. **DEMO-04's guard keeps working but loses its stated reason**: it forbids a deploy workflow to prevent an irreversible legal event, and that event is now the plan, so the guard is either retired, repurposed as an ordinary no-accidental-deploys rule, or kept — an open decision. **And the "no outside contributions" row became load-bearing in a way it was not**: relicensing for commercial use requires owning every line, so it either stands or becomes a CLA. Raised, and **ruled the same day — rely on the civilized world, no CLA machinery**, so the no-contributions row stands as written | — Done |
| **A Cloudflare Durable Object is one node, and identity is one per object** (owner ruling, 2026-08-24) | `idFromName()` resolves to a single global instance, so a Durable Object *is* a peer rather than a fleet pretending to be one — proved twice, first accidentally (a relay reservation lives in memory and two independent connections saw it) and then directly (600 peers dialled at once, 599 landing on one instance with an unmoved constructor timestamp; the ceiling found was the test machine). The converse is ruled out on evidence: one identity across instances cannot work while the reservation store is per-instance. Sharding is therefore addressing — `bootstrap-0…N` — not provisioning. Full working: `.planning/consults/2026-08-24-owner-ruling-cloudflare-node-shape.md` | — Done |
| **A Cloudflare-hosted node does not advertise execution** (owner ruling, 2026-08-24) | Runtime WASM compilation is refused on every entry point in a deployed Worker and Durable Object — an embedder flag, the same one that disables `eval`, not a quota — and `WebAssembly.instantiateStreaming` does not exist there at all. Rather than treat that as a blocker, the node simply omits the capability: the published record is already `NodeRecords = { certificate, capabilities }`, so the scheduler never learns that Cloudflare exists. **This closes the compute leg by choice rather than deferring it**, and it takes Containers off the critical path. One consequence carries separately: the absent `instantiateStreaming` removes the V8 code-cache path from anything hosted in a Worker | — Done |
| **Multi-region relay from the start, and the three regions are US / EU / South America** (owner decisions, 2026-08-24 and 2026-08-25) | A Durable Object lives in one datacenter, so a single relay routes every tester's signalling through one city. The latency penalty is paid once per pair, because the relay drops out after the WebRTC handshake — but the **failure-rate data would be smeared**, and cross-continent NAT failure is precisely what the cohort exists to measure. Capacity is not the reason: one object held 599 connections. Sharding is free under the identity ruling above. **The three named 2026-08-25 are `bootstrap-us`, `bootstrap-eu`, `bootstrap-sam`, explicitly temporary** — South America rather than Asia-Pacific, which is where the cohort is. Read from Cloudflare's docs: `locationHint` is best-effort and not binding, `jurisdiction` (`eu`/`us`/`fedramp`) is binding and has no South-American value, and an object's location is fixed by its very first `get()` and never changes | — Pending |
| **TURN and a relayed connection, as two fallback rungs** (owner decision, 2026-08-24) | There is no TURN in the stack, and a pair behind symmetric NAT simply fails — which across continents is where failures concentrate. The relayed fallback below it is real but bounded: measured, the relay enforces its data limit **bidirectionally**, so a symmetric protocol gets **64 KiB each way, not 128**. A pair that falls all the way through can exchange control and not work. Both rungs are wanted, and the second one's ceiling is written down where a design would otherwise assume twice the room | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-27 — milestone v1.1 "Wire What Was Built" opened from the v1.0 audit*
