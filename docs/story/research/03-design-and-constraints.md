# o2.services — Design & Constraint Survey

Read-only extraction from `/Volumes/ProjectsSSD/Projects/o2.services`, 2026-08-01.
All quotes are verbatim; every block carries its source path and line range.

Primary sources:

| Path | Lines | What it is |
|---|---|---|
| `/Volumes/ProjectsSSD/Projects/o2.services/docs/p2p-native-cloud-design.md` | 359 | Master architecture design (Part I substrate, Part II fabric) |
| `/Volumes/ProjectsSSD/Projects/o2.services/CLAUDE.md` | 378 | Project statement + constraints + full technology-stack analysis |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/PROJECT.md` | 256 | Milestone-level project statement (diverges from CLAUDE.md — see §2) |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/THREAT-MODEL.md` | 167 | 22 attackers, k-of-n bound, gaps stated plainly |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/research/STACK.md` | 509 | Version/topology research, verified against npm + `main` |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/research/SUMMARY.md` | 402 | Cross-track synthesis; corrections C1–C5 |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/research/PITFALLS.md` | 674 | 10+ named pitfalls with primary-source citations |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/research/ARCHITECTURE.md` | 829 | Hexagonal kernel, phase ordering |
| `/Volumes/ProjectsSSD/Projects/o2.services/README.md` | — | Public-facing constraint list, disclosure section |
| `/Volumes/ProjectsSSD/Projects/o2.services/.planning/phases/phase-10-elfconv-aot/` | — | elfconv verification, `10-CONTEXT.md`, `10-VERIFICATION.md`, `SUMMARY.md` |

---

## 1. The core bet

### 1.1 The one-sentence claim, and the fallback definition of success

> **Core Value:** **Usable capacity grows super-linearly with the user base, without any raw data
> leaving its owner's device.** If everything else fails, a map/reduce job must
> distribute across N independently-owned nodes, return a result whose integrity is
> demonstrable, and demonstrably never move the underlying data off the owner's node.

— `CLAUDE.md:13-17` (identical text at `.planning/PROJECT.md:14-17` and `README.md:27`)

That second sentence *is* the fallback definition of success. Three conjuncts, all
required: distribute across N **independently-owned** nodes; return a result whose
integrity is **demonstrable**; and **demonstrably** never move the data.

### 1.2 What the design doc says the target actually is

The design doc reaches the same claim by subtraction, from a section titled
*"Never experience limits on capacity" — the honest ceiling*:

> **Problem.** Usable capacity ≠ raw aggregate capacity, for concrete reasons:
> - **Locality pinning** — a task bound to user A's data can only run where that data is (A's node, or its replicas). Most of the fleet is ineligible for any given task.
> - **Coordination overhead — scoped, not global.** In a P2P/Kademlia design each requestor coordinates its *own* jobs, so there is no shared coordinator whose coherence cost (the USL β term) grows with the whole fleet. Aggregate throughput scales *with* the number of independent requestors — the correct scaling axis. Per-requestor coordination converts a potential coherence-driven **collapse** into, at worst, a contention-driven **plateau** on shared nodes/network (α, which flattens but doesn't retrograde). […]
> - **Churn** — consumer nodes leave mid-task; in-flight work is lost and redone.
> - **Stragglers** — total latency is set by the slowest participating node.
> - **Bottleneck migration** — past a scale, the limit is network/shuffle bandwidth, not FLOPs.
> - **Heterogeneity** — a phone is not a server; naive fan-out wastes the fast nodes waiting on the slow ones.
> - **Verification tax** — redundant execution multiplies the real work by 2–3×.
>
> **Reframe (the achievable target):** not *unlimited*, but **capacity that grows super-linearly with the user base for workload classes that fit** — data-parallel, locality-friendly, verifiable.

— `docs/p2p-native-cloud-design.md:211-220`

### 1.3 Why "super-linear" is defensible — the mechanism, stated

The research explicitly flags the phrase as a red flag unless the mechanism is named:

> | **"Super-linear" stated without its mechanism** | The single loudest red flag in performance claims. | `PROJECT.md`'s claim is defensible only in a precise form: each new user contributes *both* capacity and data *and* is an independent requestor, so **aggregate system throughput** grows faster than **per-job speedup**. State both curves. Never plot a super-linear *speedup on fixed work*. |

— `.planning/research/PITFALLS.md:193`

And the COST framing that motivates the caution:

> **[Scalability! But at what COST?](https://www.usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf)** (McSherry, Isard, Murray, HotOS '15) defines **COST** — *Configuration that Outperforms a Single Thread* — and surveys SOSP/OSDI data-parallel systems, finding *"many systems have either a surprisingly large COST, often hundreds of cores, or simply underperform one thread for all of their reported configurations."* GraphLab's COST was 512 cores; GraphX's was unbounded. **A system can scale beautifully purely because it has enormous parallelizable overhead.** A P2P fabric with content addressing, capability verification, DHT lookups, WebRTC framing at 16 KiB, and 2–3× redundant execution has *a lot* of parallelizable overhead. Perfect scaling curves are the expected artifact, not evidence of value.

— `.planning/research/PITFALLS.md:184`

### 1.4 Why the browser is the product, not a demo

> **Why TypeScript + WASM.** Portability is the product. A node that runs in a
> browser tab makes every page visitor a potential participant, which is the only
> way "capacity scales with the user base" becomes literal rather than aspirational.
> It also collapses a layer: in the browser the WASM runtime *is* V8, so Wasmtime
> and WasmEdge disappear from the edge tier entirely, and the doc's §I.6 V8
> code-caching path becomes first-class rather than an afterthought.

— `.planning/PROJECT.md:166-171`

---

## 2. The claim-splitting insight

This is the sharpest idea in the corpus. It exists in **two versions** — the compact
one in `CLAUDE.md` and a later, refined four-row version in `PROJECT.md`. Both are
reproduced because the difference is itself the story.

### 2.1 The version in `CLAUDE.md` — the one asked for, verbatim

> **What "demonstrable integrity" means precisely** — sovereignty and N-version
> verification cannot both apply to the same task, because pinning data to one node
> removes the second independent executor. The system therefore splits the claim:
>
> | Data | Integrity mechanism |
> |------|--------------------|
> | Public / shared | Full N-version redundant execution with commit-reveal, ≥1 replica backbone-anchored |
> | Sovereign (owner-pinned) | Map is **owner-attested**; the aggregation *over* contributions is verified |
>
> Stated plainly: *the owner's contribution is trusted; the aggregation over
> contributions is verified.* The sovereignty claim itself is carried by an egress
> manifest and coverage report, not by a quorum.

— `CLAUDE.md:18-29`

### 2.2 Where the insight came from — research correction C3, verbatim

> ### C3. Sovereignty and redundant execution are structurally at odds — and the eclipse mitigation makes it worse
>
> **FEATURES gap #1, and it is not addressed anywhere in the design doc.** If user A's data lives only on A's node, the only place a map over it can run is A's node. **There is no second independent node to replicate against.** N-version verification and sovereignty-by-placement cannot both apply to the same task.
>
> PITFALLS sharpens this into something worse. The recommended defence against DHT-eclipse-inverting-the-quorum is *"at least one replica of every verification quorum anchored on the permissioned backbone"* — which converts eclipsing a quorum from cheap to requiring a backbone compromise. **That mitigation is structurally unavailable for a sovereignty-pinned task**, because a backbone replica would require moving the data. Sovereign maps are therefore unverifiable by *both* mechanisms simultaneously.

— `.planning/research/SUMMARY.md:79-83`

The three candidate resolutions, verbatim from the same section:

> | Option | Mechanism | Consequence |
> |---|---|---|
> | **(a) Replicate within the owner's trust domain** | Run the second execution on the owner's *other* devices or authorized encrypted replicas | Cleanest, and it reuses the design doc's own skew fix. But it requires multi-device identity and per-owner replica sets in the MVP — a real scope addition — and it proves nothing against a malicious owner. |
> | **(b) Verify the reduce, not the map** — **recommended for v1** | Partials *do* move, and the aggregation tree *is* replicable and backbone-anchorable. Verify combines with full N-version + backbone anchoring; treat the sovereign map as owner-attested. | Requires the tree-reduce phase to exist before the verification claim is complete — acceptable, since ARCHITECTURE already sequences reduce (P5) before placement (P6). Honest framing: "the owner's contribution is trusted; the aggregation over contributions is verified." |
> | **(c) Accept owner-trusted sovereign maps** | The owner has no incentive to corrupt their own contribution | True in isolation, **false for cross-owner aggregates** — an owner *does* have an incentive to bias a total. Only defensible when paired with (b). |
>
> **Recommendation: demonstrate N-version verification on public/shared data (where there is no conflict), adopt (b)+(c) for sovereign data, and carry the sovereignty claim with the egress manifest and coverage report rather than with a quorum.** […] Make the split explicit in the roadmap so it is a stated design position rather than a gap discovered during the demo.

— `.planning/research/SUMMARY.md:89-95`

Note the phrase *"the owner's contribution is trusted; the aggregation over
contributions is verified"* originates here, inside option (b), as *"Honest framing"*.
It was later promoted to the project statement.

### 2.3 The refined four-row version — sovereignty bounds the *owner*, not the *device*

> **What "demonstrable integrity" means precisely** — sovereignty constrains *who*
> may execute, so integrity is layered by threat rather than claimed uniformly.
> Sovereignty is a boundary around the **owner**, not around one device: an owner's
> node set (their own devices) can hold the same data and execute redundantly
> without any data leaving the owner's trust domain (§3.5 already scopes
> speculation to "the owner's node set, never across owners").
>
> | Data | Integrity mechanism |
> |------|--------------------|
> | Public / shared | Redundant execution of the identical module on independent nodes, with commit-reveal, ≥1 replica backbone-anchored |
> | Sovereign, owner has ≥2 live nodes | Redundant execution **within the owner's node set** — catches faults and environmental divergence without data leaving the trust domain |
> | Sovereign, owner has 1 live node | Map is **owner-attested**; recorded as such in the receipt |
> | Any cross-owner aggregate | The aggregation *over* contributions is verified, independent of how each partial was produced |

— `.planning/PROJECT.md:19-31`

And immediately, the self-limiting caveat that keeps the refinement honest:

> **What owner-domain replication does not do.** Redundant execution derives its
> power from executor *independence*. Two devices under one owner are correlated —
> same operator, same intent, likely the same build — so an owner-domain quorum
> catches accidental corruption but **not** a malicious owner biasing their own
> contribution. All replicas under one adversary make a quorum unanimous on a
> forgery rather than degrading, the same structure as an eclipsed DHT lookup.
> Defence against a biased owner is therefore the **verified reduce** plus backbone
> anchoring, not the owner's own quorum. Owner-domain agreement must be reported
> distinctly from independent-operator agreement so the stronger claim is never
> implied by the weaker one.
>
> **Backbone encrypted replicas are availability-only.** Executing a map requires
> decryption, so a backbone node running a sovereign task would see plaintext —
> reintroducing exactly the exposure sovereignty prevents. Without a TEE (v2),
> execution-eligible replicas are the owner's own devices only.

— `.planning/PROJECT.md:33-47`

### 2.4 The decision-log entries that record the split

> | **Verify the reduce, not the map** (resolves C3) | Sovereignty removes the second *independently-operated* node, so cross-operator redundancy cannot apply to a sovereign map. Partials *do* move, so the aggregation tree is replicable and backbone-anchorable. Full cross-operator redundancy is demonstrated on public/shared data where no conflict exists | — Pending |

> | **Owner-domain replication promoted to v1** (amends C3) | Sovereignty bounds the *owner*, not one device — an owner's own devices share data without leaving the trust domain, so redundant execution applies within the owner's node set. Catches faults and environmental divergence; does **not** defend against a biased owner, so it supplements rather than replaces the verified reduce. […] |

> | **Raw sovereign data does not move between nodes** (owner decision 2026-07-28; narrows the row above) | […] The fabric will not move raw sovereign data, even between nodes the same owner controls. […] The mechanism is `EgressGuard.send`, which refuses any frame containing a registered sovereign payload instead of forwarding it (Plan 13-04) — so the rule is checkable against the code rather than a policy someone has to remember. […] **Narrowed 2026-07-28 by `13-VERIFICATION-2.md`, which measured the difference:** what the code delivers is *raw sovereign data does not leave a node **holding a registration for it***, and only the **executing** node registers. A submitting node that never ran the task holds no registration, and was measured shipping the raw 95-byte input inside a 138-byte block-response frame. The sentence above is the intent; DATA-10 (Phase 13.1) is what closes the distance | — Partial |

— `.planning/PROJECT.md:228-230`

### 2.5 The design-doc source of "map placement = data placement"

> **Framing.** Data is already partitioned across owner nodes (user data per device, enterprise data on-prem), so **map placement = data placement**: each owner runs the map over its own local data with zero map-side movement and zero map scheduling. Only *partial outputs* cross the network — raw data never leaves the owner (sovereignty baked into execution). The classic all-to-all shuffle therefore does **not** appear by default; it appears only when the reduction can't be decomposed. What crosses the wire — a tree of partials or an all-to-all — is decided entirely by whether the reduce combines.

— `docs/p2p-native-cloud-design.md:270`

> **Unlock — privacy-preserving cross-owner analytics.** Because only aggregated partials leave the owner, layer **secure aggregation** (the federated-learning technique: the tree learns only the combined result, never any single owner's partial) and/or **differential privacy** (release aggregates only over enough owners, with noise). Turns "run massive map/reduce over everyone's data" into "…without any raw data *or* per-owner partial leaking in the clear" — a differentiated capability that falls out of the data-locality assumption for free.

— `docs/p2p-native-cloud-design.md:278`

> - **Skew.** Owner data volumes vary enormously (enterprise TBs vs. user KBs), and sovereignty forbids rebalancing one owner's data onto other owners' nodes — so the largest owner's local map bounds the phase. Fix: parallelize *within* that owner's own node(s)/replicas; run big-data owners on their own backbone-class hardware; speculation scoped to the owner's node set, never across owners.
> - **Availability.** An offline owner is a missing contribution that can't be recomputed elsewhere without a replica. Fix: define cross-owner queries as best-effort over *live* owners with a coverage report, or keep owner-authorized encrypted replicas where availability matters.

— `docs/p2p-native-cloud-design.md:281-282`

### 2.6 The threat model's bound — `k = 0`, and why that is a strength

> > **An attacker may control up to `k` nodes in a quorum of `n`, where `k = 0`.**
>
> That is not a typo, and it is stronger than it sounds. The quorum rules do not tolerate
> a compromised member and detect it afterwards; they aim to keep one out:
>
> - **No two replicas from the same operator** (`composeQuorum`). An attacker with a
>   hundred machines under one operator identity occupies exactly one quorum slot.
> - **At least one directly-dialable member**, so no quorum depends solely on a relay.
> - **Disagreement is reported, never voted on.** With `n = 2` there is no majority to
>   compute, so a single dissenting replica fails the result rather than losing a vote.
>   This is deliberate: majority voting silently converts "something is wrong" into "the
>   majority was right", which is the event verification exists to surface.
>
> So the honest statement is: **the design detects any disagreement at `n ≥ 2` across
> distinct operators, and tolerates none.** Raising `k` above 0 would mean adopting
> majority voting, which this project has explicitly decided against.
>
> The bound that actually constrains security is therefore not `k` but **how many
> distinct operator identities an attacker can obtain** — see the gap below.

— `.planning/THREAT-MODEL.md:17-35`

And the self-nominated weakest link:

> **Sybil resistance is rate-limiting, not cost (attacker 15).** `EnrollmentAuthority`
> caps certificates per user key per window. An attacker with many *user* identities is
> not slowed at all, and the cap is a policy number rather than a physical one. Making
> fake nodes genuinely expensive needs something the attacker must spend — proof-of-work,
> payment, or an out-of-band identity check. The rate limiter is the enforcement point
> those would plug into. **This is the weakest link in the model**, because attacker 3's
> defence assumes operator identities are scarce.

— `.planning/THREAT-MODEL.md:76-82`

> **Egress control is a detector, not a prover (attacker 12).** The tap catches raw
> sovereign bytes crossing the wire, including embedded in a larger frame. It cannot
> prove that no *encoding* of a sovereign value could slip past — compressed, encrypted,
> or re-encoded copies would not match. It catches the failure that actually happens: a
> map step that forgot to aggregate. A stronger claim needs taint tracking through the
> guest.

— `.planning/THREAT-MODEL.md:84-89`

---

## 3. Physical constraints that dictated the architecture

The README frames the whole list in one line:

> ### Constraints that shaped the design
>
> These are measured or documented facts, not preferences. Several were discovered
> the expensive way.

— `README.md:104-107`

### 3.1 Browsers cannot bind a listening socket

Stated three separate ways in three documents.

> | `@libp2p/websockets` | `10.1.17` | **dial only** | **dial + listen** | Browser→server only. Browsers cannot open listening sockets. […] |

> | `@libp2p/webrtc` → `webRTCDirect()` | `6.0.27` | **dial only** | **dial + listen** | Browser→server with no relay and no CA cert (certhash in the multiaddr). **This is the cheapest way to get browsers onto your backbone** — no TLS certificate, no DNS. Browsers cannot listen (no UDP port binding). |

— `CLAUDE.md:86, 88`

And in the decision log, as the *only* legitimate difference between node classes:

> | All nodes have equal functionality; only discovery differs | Owner decision 2026-07-26. No tier, no class. A browser cannot bind a listening socket, so it cannot be a seed a newcomer dials cold and must be found via a relay — but once connected it is indistinguishable, and it executes, stores, serves and takes quorum slots identically. Proven cross-device in Phase 3. Client-mode-only DHT and leaves-only reduce were inherited assumptions, both reversed. Background-tab throttling is a lease-duration problem. Any decision keying on node kind is wrong; the only legitimate use is shared-dependency analysis over the discovery graph | — Done |

— `.planning/PROJECT.md:222`

### 3.2 Browser-to-browser is WebRTC, and only WebRTC

The transport reality matrix, verbatim:

> ## Transport reality matrix (the browser question, answered)
>
> | Transport | Browser → Browser | Browser → Node/Go server | Node listen | Requires |
> |-----------|:-----------------:|:------------------------:|:-----------:|----------|
> | **WebRTC** (`webRTC()`) | ✅ **the only option** | ✅ | ✅ | Circuit Relay v2 peer for SDP signaling + STUN |
> | **WebRTC Direct** (`webRTCDirect()`) | ❌ (browser cannot listen — no UDP bind) | ✅ | ✅ | Nothing. No cert, no DNS, no relay. **Cheapest browser→backbone path.** |
> | **WebSockets (secure)** | ❌ (browser cannot listen) | ✅ | ✅ | CA-signed TLS cert + DNS name. **Solved by AutoTLS.** |
> | **WebSockets (insecure `/ws`)** | ❌ | ❌ from an HTTPS page (mixed content) | ✅ | Only usable for `localhost` dev |
> | **WebTransport** | ❌ | ✅ dial only | ❌ **js-libp2p cannot listen** | Server must be go-/rust-libp2p. Not in Safari. Source: *"only allows dialing… requires QUIC support to land in Node JS first."* |
> | **TCP / QUIC** | ❌ | ❌ | ✅ | Backbone↔backbone only |
> | **Circuit Relay v2** | ✅ (relayed) | ✅ | ✅ (Node only as server) | **2 min / 128 KiB per connection by default** |
>
> - Browser→browser is **WebRTC, and only WebRTC.** There is no alternative and no fallback.
> - Every browser peer needs at least one reachable Circuit Relay v2 server to be *dialable at all*. That server must be dialable *by the browser*, i.e. WSS or WebRTC-Direct.
> - **WebRTC-Direct is underrated here.** A backbone node listening on `/ip4/0.0.0.0/udp/PORT/webrtc-direct` is browser-dialable with no certificate, no DNS record, and no Let's Encrypt rate limits. Run it *alongside* AutoTLS WSS as a redundant entry point. Pair it with `@libp2p/keychain` so the certhash survives restarts.

— `CLAUDE.md:162-174` (identical at `.planning/research/STACK.md:198-216`, which adds the provenance line: *"Verified against `@libp2p/webrtc@6.0.27` and `@libp2p/webtransport@6.0.32` source on `main`, plus libp2p.io/docs/webrtc-browser-connectivity"* — `STACK.md:200`)

### 3.3 Circuit Relay v2 — the relay is a signalling channel, not a data path

The constraint as stated in the project statement:

> - **Connectivity**: Browser-to-browser libp2p requires a publicly reachable
>   Circuit Relay v2 node for the WebRTC SDP handshake, and browsers can only dial
>   `DNS + WSS`, WebTransport, or WebRTC-Direct. The relay is a **signaling channel,
>   not a data path** — verified defaults in
>   `transport-circuit-relay-v2/src/constants.ts`: `DURATION_LIMIT` 2 minutes,
>   `DATA_LIMIT` 128 KiB, `MAX_RESERVATION_STORE_SIZE` 15 concurrent reservations.
>   Protocols will not negotiate over a relayed connection unless registered with
>   `runOnLimitedConnection: true`

— `CLAUDE.md:35-42` (identical `.planning/PROJECT.md:187-193`)

The research headline that established it:

> 2. **The relay is a signaling channel, not a data path.** js-libp2p Circuit Relay v2 defaults: **2-minute** duration limit and **128 KiB** data limit *per relayed connection*, 2-hour reservation TTL, 15 reservations per relay server. Verified in [`constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/constants.ts). This is enough for a WebRTC SDP handshake and nothing else. PROJECT.md's "~1 hour cap with bandwidth limits" understates how tight this is.

— `.planning/research/STACK.md:14`

The exact constants, as read from source:

```ts
DEFAULT_MAX_RESERVATION_STORE_SIZE = 15        // the 16th browser peer gets RESERVATION_REFUSED
DEFAULT_MAX_RESERVATION_TTL        = 2 hours
DEFAULT_DURATION_LIMIT             = 2 * minute   // per relayed connection
DEFAULT_DATA_LIMIT                 = 1 << 17      // 128 KiB per relayed connection
MAX_CONNECTIONS                    = 300          // separate ceiling
```

— `.planning/research/SUMMARY.md` (correction C2 code block, ~line 70), sourced from
`libp2p/js-libp2p@main`, `transport-circuit-relay-v2/src/constants.ts`, read 2026-07-24

And the architectural consequence — the relay decision was **inverted** by these numbers:

> ### Relay strategy — evidence contradicts PROJECT.md
>
> PROJECT.md Key Decisions says *"DHT-discovered public IPFS infra primary, own backbone relay as fallback."* Three verified facts argue for **inverting** this:
>
> 1. **The default limits make public relays signaling-only.** `DEFAULT_DURATION_LIMIT = 2 * minute`, `DEFAULT_DATA_LIMIT = BigInt(1 << 17)` (131,072 bytes). A public relay operator has no reason to raise them. That's fine for SDP exchange, useless for anything else — and it means a browser peer whose WebRTC upgrade fails is *dead*, not "degraded to relayed".
> 2. **`DEFAULT_MAX_RESERVATION_STORE_SIZE = 15`.** A public relay accepts 15 concurrent reservations. A demo with more than 15 simultaneous browser tabs will exhaust a single public relay.
> 3. **Browser relay auto-discovery depends on DHT random-walk.** `CircuitRelayTransport` takes a `randomWalk` component sourced from kad-dht. A browser DHT client cannot random-walk the Amino DHT effectively, because Amino peers advertise TCP/QUIC addrs a browser cannot dial. Relay discovery in the browser therefore has to be **explicit configuration or delegated routing**, not organic discovery.
>
> **Recommendation:** own AutoTLS-backed backbone relays are **primary**; public infra is opportunistic redundancy. […] Keep public relays configured so the "works without our infra" claim stays technically true.

— `.planning/research/STACK.md:218-226`

The design doc's own (pre-measurement) statement of the same problem, notably vaguer:

> **Solution:** libp2p's stack — AutoNAT for reachability detection, **DCUtR** hole-punching, **circuit-relay v2** for un-punchable peers, QUIC for connection migration, Noise for transport security. Accept that relay nodes reintroduce mild centralization; run them on the backbone.

— `docs/p2p-native-cloud-design.md:294`

### 3.4 The WebRTC 16 KiB ceiling and Chromium above 256 KiB

Project statement:

> - **WebRTC data path**: 16 KiB max message (hardcoded in js-libp2p); Chromium
>   closes the channel above 256 KiB and does not reassemble Firefox's fragments.
>   The browser mesh cannot carry bulk data — partials must stay small (§3.5) and
>   artifacts fetch over an IPFS gateway (§I.6)

— `CLAUDE.md:43-46` (identical `.planning/PROJECT.md:194-197`)

The pitfall in full, with the source constants:

> ### Pitfall 10: WebRTC data channels cap at 16 KiB per message, and Chromium closes the channel above 256 KiB
>
> **What goes wrong:**
> js-libp2p's own WebRTC transport hardcodes this ([`transport-webrtc/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-webrtc/src/constants.ts)):
>
> ```ts
> export const MAX_BUFFERED_AMOUNT = 2 * 1024 * 1024
> // "Max message size that can be sent to the DataChannel. In browsers this is
> //  256KiB but go-libp2p and rust-libp2p only support 16KiB"
> export const MAX_MESSAGE_SIZE = 16 * 1024
> ```
>
> Beneath that, SCTP interop is worse than the numbers suggest. Firefox fragments at 16 KiB using partial PPIDs; **Chromium does not reassemble them**, so the receiving app sees a stream of 16 KiB fragments. Above ~256 KiB, usrsctp returns `EMSGSIZE` and **Chromium simply closes the data channel** ([Lennart Grahl](https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html), [Mozilla WebRTC blog](https://blog.mozilla.org/webrtc/large-data-channel-messages/)). The SCTP `ndata` fix is unimplemented in every major browser.
>
> The consequence for the architecture: **the browser-to-browser mesh is not a bulk data path.** Multi-MB WASM artifacts, large reduce partials, and content-addressed intermediates cannot move peer-to-peer efficiently. This reinforces the doc's own §3.5 conclusion (partials must be small, combiners must shrink before moving) and Part I.6's conclusion (artifacts should come over an HTTP gateway with `compileStreaming`, not through the mesh).
>
> **How to avoid:**
> - Chunk at ≤16 KiB and honour `bufferedAmount` backpressure against the 2 MiB threshold. Never write a large buffer in one call.
> - **Fetch WASM artifacts over HTTPS/IPFS gateway, not over the mesh** — required anyway for V8 code caching (Part I.6).
> - **Make reduce-partial size a design constraint** with a budget (single-digit KiB) checked in tests. Mergeable sketches (HLL, t-digest, Count-Min) are small by construction; this is a concrete second reason to prefer them.
> - Measure achieved browser↔browser throughput early, on real networks, and put the number in the design doc so nobody plans around a wrong assumption.
>
> **Warning signs:**
> - Any `send()` of a buffer larger than 16 KiB.
> - Data channel closes with no application-level error.
> - Firefox↔Chrome transfers corrupt while Chrome↔Chrome works.
> - Partial sizes unbounded by design.

— `.planning/research/PITFALLS.md:349-375`

This is the constraint that makes **mergeable sketches** an architectural requirement
rather than an optimization — the design doc had already recommended them for a
different reason:

> 2. **Mergeable sketches for holistic-but-approximate ops.** Distinct-count → HyperLogLog; quantiles/median → t-digest/KLL; heavy-hitters → Count-Min. Makes "needs all values" queries tree-reducible on tiny partials, trading exactness for a collapsed shuffle.

— `docs/p2p-native-cloud-design.md:274`

Exit criterion derived from the pitfall:

> **Exit criteria (A5):** N+1 browser peers reserve simultaneously against the tuned relay and hold >1 hour with churn; every registered protocol negotiates over `p2p-circuit`; relayed byte counters stay under a few KiB/peer; no `/certhash/` literal in source; a Firefox↔Chrome >256 KiB transfer succeeds.

— `.planning/research/SUMMARY.md:260`

### 3.5 GitHub Pages serves no custom headers → no SharedArrayBuffer → no threads

> - **Hosting**: GitHub Pages serves static files only and runs no server-side
>   process — it can host the client but not a relay or bootstrap node

— `CLAUDE.md:51-52`

The mechanism, from the determinism table:

> | **Threads / shared memory** | ❌ | Reject `shared` memory in the module's memory section at publish time. Bonus: in the browser, `SharedArrayBuffer` requires COOP/COEP cross-origin isolation anyway — **which GitHub Pages cannot set**, so threads are already off the table for the demo tier. |

— `CLAUDE.md:225` / `.planning/research/STACK.md:282`

And in the rejection table:

> | `SharedArrayBuffer` / WASM threads in the browser tier | Requires COOP/COEP cross-origin isolation headers. **GitHub Pages serves no custom headers**, so this is unavailable on the declared hosting target — and threads are a nondeterminism source anyway. | Multiple dedicated Workers with `postMessage`, one WASM instance each |

— `CLAUDE.md:277`

Note the shape of the argument: a *hosting* constraint and a *determinism* constraint
independently forbid the same feature. The doc keeps both reasons rather than collapsing
to one.

### 3.6 Two more measured constraints, from the README's list

> - **`WebAssembly.instantiate` is the sandbox.** There is no host-import allow-list,
>   by decision — the engine already refuses and names the offending import.
> - **The kernel never requires `crypto.subtle`.** A LAN origin is not a secure
>   context, and the demo has to work on a phone on your own network.

— `README.md:118-121`

### 3.7 The WebRTC handshake cost, measured

> each hop to a *new* browser peer needs a WebRTC handshake (~1.04 s measured as
> a loopback floor with no STUN), so an O(log N) lookup is seconds when cold. Connection reuse is
> what makes this viable, and it is a design constraint, not a prohibition.

— `CLAUDE.md:196-198`

---

## 4. Determinism as a publish-time property

### 4.1 The constraint, stated

> - **Determinism**: V8 exposes no NaN-canonicalization or relaxed-SIMD control
>   (measured against `node --v8-options`; Wasmtime has both). Determinism must
>   therefore be enforced as a property of the **published artifact at publish
>   time**, not as runtime configuration

— `CLAUDE.md:47-50`

> 4. **V8 offers zero determinism knobs.** Verified by enumerating `node --v8-options`: no `--*relaxed-simd*` flag, no NaN-canonicalization flag. Wasmtime has both; V8 has neither. **Determinism must be enforced at artifact-publish time, not at execution time.** This is a structural constraint on the whole verification story.

— `.planning/research/STACK.md:16`

### 4.2 The full nondeterminism table, verbatim

Sourced, per `STACK.md:275`, from *"the [normative spec doc](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md)"*.

> ### Determinism — verified constraints
>
> | Source | Deterministic? | How to constrain in V8 |
> |--------|:--------------:|------------------------|
> | **NaN bit patterns** from float arithmetic | ❌ | **Cannot be fixed at runtime in V8.** Verified: `node --v8-options` has no canonicalization flag. Fix at publish time via Binaryen's `denan` pass (converts NaN→0), **or** forbid floats in the guest ABI and use fixed-point integers, **or** accept the risk for workloads whose outputs never carry NaN. |
> | **NaN sign bit** when no NaN input | ❌ | Same treatment. |
> | **Relaxed SIMD** (`f32x4.relaxed_madd` etc.) | ❌ | **Cannot be disabled in V8.** Verified: `node --v8-options \| grep -i relaxed` returns nothing — the proposal shipped and there is no off switch. Must be **rejected at publish time** by scanning opcodes with `wabt`/`binaryen`. Non-relaxed SIMD (`simd128`) *is* deterministic and is fine. |
> | **Threads / shared memory** | ❌ | Reject `shared` memory in the module's memory section at publish time. Bonus: in the browser, `SharedArrayBuffer` requires COOP/COEP cross-origin isolation anyway — **which GitHub Pages cannot set**, so threads are already off the table for the demo tier. |
> | **Host imports** (clock, random, I/O) | ❌ by construction | You control this. Whitelist imports via `WebAssembly.Module.imports(module)` before instantiation. Supply a **virtualized deterministic WASI**: fixed epoch clock, seeded PRNG derived from the job ID, no filesystem, no sockets. |
> | **Resource exhaustion** (OOM, stack, `memory.grow` failure) | ❌ | Pin `memory` `initial === maximum` at publish time so `memory.grow` cannot fail differently per host. Bound stack depth at compile time. |
> | **Engine feature-set drift** | ❌ | Put the required feature set in the artifact's cache key (design §I.6 already does) and gate execution on `wasm-feature-detect`. |
> | **Execution time / fuel** | n/a | V8 has **no fuel metering**. Options: (a) build-time gas instrumentation, (b) run in a dedicated Worker and `terminate()` on wall-clock timeout. (b) is nondeterministic but only affects *liveness*, not *results* — and redundant execution (§3.1) already covers a node that times out. **Recommend (b); it costs nothing.** |

— `CLAUDE.md:219-229`, identical `.planning/research/STACK.md:273-286`

### 4.3 The architectural conclusion (present in STACK.md, trimmed out of CLAUDE.md)

> **Architectural conclusion:** determinism is a **property of the published artifact, verified and enforced at publish time**, not a runtime configuration. The publish pipeline must emit a *determinism certificate* alongside the CID — a signed attestation that the module: uses no relaxed-SIMD opcodes, declares no shared memory, has `initial === maximum` memory, imports only the whitelisted deterministic ABI, and has been NaN-normalized. That attestation is exactly the "signed key→CID mapping" design §I.6 already requires. **This should be an explicit roadmap phase, not an implementation detail.**

— `.planning/research/STACK.md:288`

### 4.4 The concrete divergence — x86 vs ARM NaN sign bit

This is the sharpest single fact in the corpus:

> **The load-bearing risk is determinism, and it is worse than PROJECT.md assumed.** Three of the four research tracks independently landed on the same wall: V8 exposes **no NaN-canonicalization and no relaxed-SIMD control** (verified by enumerating `node --v8-options`; Wasmtime has both). The concrete divergence is architectural — per [WebAssembly/design#477](https://github.com/WebAssembly/design/issues/477), **x86 sets a freshly-generated NaN's sign bit to 1 and ARM sets it to 0**, so `0.0/0.0` yields `0xFFC00000` on an Intel laptop and `0x7FC00000` on an M-series Mac. Two *honest* nodes produce different output hashes, the quorum splits 50/50, and the verification layer cannot tell which side lied. This directly threatens the Core Value's "returns a verified-correct result." It is also compounded by a second finding: an eclipsed DHT lookup can place **all N replicas on attacker-controlled nodes**, at which point the quorum returns unanimous agreement on a forged result — the integrity mechanism doesn't degrade, it *inverts*.

— `.planning/research/SUMMARY.md` (Executive Summary, ~line 14)

The evidence table backing correction C1:

> | Fact | Evidence |
> |---|---|
> | V8 has no NaN-canonicalization flag, no relaxed-SIMD off-switch, no fuel metering | `node --v8-options` enumerated; nothing matches |
> | Wasmtime has *all three* (`cranelift_nan_canonicalization`, `wasm_relaxed_simd(false)`, fuel) | [Wasmtime determinism guide](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html) |
> | x86 sets new-NaN sign bit to 1; ARM sets it to 0 | [WebAssembly/design#477](https://github.com/WebAssembly/design/issues/477) |
> | Relaxed-SIMD results *intentionally* vary with hardware; shared-memory ops nondeterministic | [`design/Nondeterminism.md`](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md) |
> | `Math.pow/exp/sin` are implementation-defined across engines **and across V8 versions** | PITFALLS §1 |

— `.planning/research/SUMMARY.md` (C1 table, ~lines 40-47)

The five-part consolidated recommendation, verbatim:

> 1. **Empirical gate first.** Run the same float-heavy module on x86-64 Chrome/Firefox, arm64 Safari/Chrome, Android Chrome, and Node on both arches. Diff raw bytes. This is cheap, high-information, and **its outcome decides whether N-version comparison is a viable v1 integrity mechanism at all.** If it fails, the trust story becomes backbone-anchored audit sampling and the roadmap changes shape.
> 2. **Module admission gate** (pure function in `core`, run at publish time *and* re-run by the executor before instantiation): reject relaxed-SIMD opcodes, `atomic.*`/shared memory, imports outside a frozen allow-list, and any module whose `memory` does not declare `initial === maximum`.
> 3. **Determinism certificate**: a signed attestation published alongside the artifact CID asserting the above, plus NaN-normalization. This is the same signed `key → CID` mapping design §I.6 already requires — one mechanism, two jobs.
> 4. **Hash canonical form, never a raw memory slice.** Padding bytes, allocator residue, and NaN payloads all leak into `sha256(memory[ptr..ptr+len])`. Require modules to declare an output schema so the verifier canonicalizes typed float fields before hashing.
> 5. **Narrow the verification-eligible workload class in v1 to integer / bit-exact-float outputs, and say so in the docs.** Binaryen's `denan` pass (NaN→0) is available but is determinism-by-mutilation — it changes program semantics and is unverified against real elfconv output.
>
> **Do not use WASI for the verified tier.** WASI hands the guest a clock, randomness, env vars, and a filesystem — four independent nondeterminism vectors. Ship four host functions (`o2_input_len`, `o2_input_read`, `o2_output_write`, `o2_log`) instead; that is a day's work versus a phase of trustworthy WASI stubbing. A deterministic WASI *subset* comes later, behind the same port, for elfconv-lifted binaries.

— `.planning/research/SUMMARY.md` (C1, ~lines 50-58)

### 4.5 What was actually built — a third self-correction

The plan above was executed and then *partly reversed by measurement*. Two decision-log
entries record it:

> | **Determinism is detected, not predicted** (supersedes the deleted P0 spike) | Verification is a byte comparison of two runs of the same module. Predicting statically that a module cannot diverge is a far harder problem and the comparison is the mechanism regardless. An admission gate was built and deleted: every check was either enforced by the runtime already (imports), impossible in one thread (atomics), or self-reporting as a disagreement. Cost of a nondeterministic module is one wasted redundant execution | ✓ Good |

> | **Cross-implementation verification is out of scope** | Verification compares the same module on two nodes, never two independent implementations of the same computation. Nothing in the system dispatches differing code for comparison | ✓ Good |

— `.planning/PROJECT.md:231-232`

And the constraint text in `PROJECT.md` was rewritten accordingly — note it now says
something *different* from the `CLAUDE.md` version quoted in §4.1:

> - **Determinism**: enforced at the serialization boundary, not by analysis. Anything
>   hashed or content-addressed is encoded with strict DAG-CBOR, which rejects
>   `NaN`/`Infinity`/`-Infinity`, normalizes `-0.0`, and mandates one float width.
>   Protobuf bytes are never hashed

— `.planning/PROJECT.md:198-201`

**The two documents disagree, and the disagreement is informative**: `CLAUDE.md` states
the *publish-time artifact* doctrine (what research concluded), `PROJECT.md` states the
*serialization-boundary* doctrine (what shipped after the admission gate was built,
measured, and deleted — 1,214 lines, per `phase-10-elfconv-aot/10-CONTEXT.md:43`).

> The project deleted 1,214 lines of static determinism analysis on the principle that
> divergence is *detected* by byte comparison, never predicted. The ELF pre-screen looks
> like a relapse and is not: being wrong costs a failed build, not a wrong answer.

— `.planning/phases/phase-10-elfconv-aot/10-CONTEXT.md:43-47`

### 4.6 V8 code caching — the reason CIDs are the right cache key

> - **Browser/V8 — deploy-time cache priming (not native injection):** V8 caches its TurboFan output and, on repeat load, *deserializes* it — skipping Liftoff and TurboFan. But caching fires **only** for `compileStreaming` / `instantiateStreaming`, **keys on the resource URL**, requires `Content-Type: application/wasm`, and only for modules **≳128 kB**. **IPFS CIDs are immutable content-addressed URLs — exactly the stable key V8 wants**, so repeat browser loads skip compilation — *provided* the browser fetches through an IPFS **HTTP gateway URL via `compileStreaming`**. Pulling bytes through in-page Helia (`fs.cat`) and calling non-streaming `WebAssembly.compile` **forfeits code caching**. Within a session, compile the `Module` once and share it across Workers.

— `docs/p2p-native-cloud-design.md:131`

Measured outcome: **it did not work.**

> Criterion 4 **NOT MET**: no WASM code-cache entry at 4.8 MB over three visits, while the same
> profile caches 2 MB of JavaScript — a measured negative with two controls.

— `.planning/ROADMAP.md:~245`

---

## 5. The disclosure gate

### 5.1 The constraint as originally written

> - **Disclosure**: Public hosting is public disclosure. EPO and China have no
>   patent grace period, so publishing forfeits those rights permanently. Deployment
>   must be a separately-triggered gate, not an automatic consequence of a phase
>   completing

— `CLAUDE.md:53-56`

### 5.2 The updated version, after the decision was taken

> - **Disclosure**: Public hosting is public disclosure. EPO and China have no
>   patent grace period. **The repository was made public on 2026-07-26, so those rights
>   are already forfeit for what was disclosed then; the US provisional window is
>   running.** Deployment
>   must be a separately-triggered gate, not an automatic consequence of a phase
>   completing

— `.planning/PROJECT.md:204-209`

### 5.3 The two decision-log rows — one superseding the other

> | Build the public demo, gate publishing separately | Building discloses nothing; deploying does. Kept the provisional-patent option alive until explicitly surrendered | — **Superseded 2026-07-26** |
>
> | Make the repository public | Owner decision, taken with the consequence stated: EPO/China rights permanently forfeited, US provisional window (12 months from first disclosure) now running. DEMO-04 unaffected — no deploy workflow was added | — Done |

— `.planning/PROJECT.md:223-224`

### 5.4 The gate is enforced by a test, not by a policy

> ## Disclosure
>
> **The repository is public by explicit decision.** EPO and China have no patent
> grace period, so those rights are permanently forfeit for everything disclosed. A
> US provisional remains possible for 12 months from first disclosure, and that
> window is running.
>
> Consequently: **no deploy workflow file may exist in this repository at all** —
> absent, not disabled — and no `package.json` script may publish.
> `disclosure-gate.node.test.ts` enforces both, checks for workflow files by
> *content* so relocation does not evade it, and verifies its own publish-command
> patterns actually match the commands they claim to catch. `build:demo` builds and
> publishes nothing. Deployment is a separately-triggered human act.

— `README.md:236-249`

The roadmap criterion that produced that test:

> 5. The demo builds and runs against static hosting with no server-side process beyond the backbone relay, and the repository contains no deploy workflow file at all — publishing requires a separately-triggered human action, because publishing forfeits EPO and China patent rights permanently

— `.planning/ROADMAP.md:220`

**Dates:** constraint written pre-2026-07-24; repository made public **2026-07-26**;
US provisional window runs 12 months from that date (to ~2026-07-26 + 12mo).

---

## 6. Corrections the docs make to themselves

Both are unusual: the documents do not quietly edit, they leave the wrong claim
visible, quote it, and say why it was wrong.

### 6.1 The DHT correction — "Corrected 2026-07-28"

The corrected section in `CLAUDE.md`, verbatim:

> ## DHT reality check
>
> > **Corrected 2026-07-28.** This section previously opened with *"a browser node cannot serve
> > DHT records… permissioned by physics, not by policy."* **That was wrong**, and it was wrong in
> > the way this project most often gets things wrong: a constraint that is real about the *public
> > Amino* DHT was restated as a constraint about *capability*, and then quoted as if it settled
> > the fabric's own design. Two facts falsify it.
> >
> > 1. **There is no DHT in this repository.** `@libp2p/kad-dht` is not installed — the whole
> >    `@libp2p/*` set is circuit-relay-v2, crypto, identify, interface, interface-internal,
> >    keychain, logger, multistream-select, peer-collections, peer-id, peer-record, peer-store,
> >    ping, tcp, utils, webrtc, websockets — and `kadDHT` appears nowhere in `packages/`.
> >    Discovery today runs over the relay's reservation store (`net/src/rendezvous.ts`), not a
> >    DHT. So this section describes a component that was never built.
> > 2. **A browser node is dialable.** `browser-node.ts:197` listens on
> >    `['/p2p-circuit', '/webrtc']`. A browser holding a relay reservation *can be dialed by
> >    other peers*, which is the entire prerequisite for serving records.
>
> - **Within the fabric's own keyspace, a browser node can serve records.** Every fabric peer is
>   reachable over relay + WebRTC, so browsers can answer each other's queries. The cost is per-hop,
>   not categorical: each hop to a *new* browser peer needs a WebRTC handshake (~1.04 s measured as
>   a loopback floor with no STUN), so an O(log N) lookup is seconds when cold. Connection reuse is
>   what makes this viable, and it is a design constraint, not a prohibition.
> - **What is genuinely constrained is interop with the public Amino DHT.** Amino peers advertise
>   TCP/QUIC, which a browser cannot dial, and they cannot reach a browser because they do not know
>   its relay. That is a statement about Amino, not about browsers.
> - **Two real weaknesses of browser-held records, neither of which is "cannot".** IndexedDB is
>   evicted silently under storage pressure, so durability is soft; and tab churn is high, while
>   Kademlia routing tables assume moderate stability. A hosted, always-reachable slice of the
>   keyspace complements browser-held records rather than replacing them.
> - **Unverified, and it matters:** js-libp2p promotes kad-dht to server mode when it detects a
>   public dialable address. Whether a relayed `/p2p-circuit` address satisfies that check is
>   **unmeasured** — the package is not installed, so it could not be read. Set `clientMode`
>   explicitly rather than relying on promotion either way.

— `CLAUDE.md:176-209`

**The original wrong text is still on disk**, in `STACK.md`, with a correction banner
above it — this is the part worth quoting side by side:

> ## DHT reality check
>
> **HIGH confidence, this is the single most likely source of an architecture-invalidating surprise.**
>
> > **CORRECTED 2026-07-28 — the paragraph below and the first bullet after it are wrong.**
> > `@libp2p/kad-dht` is **not installed in this repository** and `kadDHT` appears nowhere in
> > `packages/`; discovery runs over the relay's reservation store (`net/src/rendezvous.ts`).
> > And a browser is **not** structurally undialable: `browser-node.ts:197` listens on
> > `['/p2p-circuit', '/webrtc']`, so a browser holding a relay reservation can be dialed, which
> > is the whole prerequisite for serving records. The real constraint is about **interop with
> > the public Amino DHT** — Amino peers advertise TCP/QUIC a browser cannot dial, and cannot
> > reach a browser because they do not know its relay. Within the fabric's own keyspace,
> > browsers can serve each other; the cost is a WebRTC handshake per new hop (~1.04 s loopback
> > floor), which makes connection reuse a design requirement rather than making the thing
> > impossible. Whether kad-dht's server-mode promotion accepts a relayed address is
> > **unverified** — the package is absent, so it could not be read. See `CLAUDE.md` §DHT
> > reality check for the corrected version.
>
> `@libp2p/kad-dht@16.4.0` runs in the browser (Helia ships it in its browser defaults), but only as `clientMode: true` — it issues queries and stores nothing, routes nothing, and answers nothing. Server mode requires a publicly dialable address, which a browser structurally cannot have.
>
> Consequences for design §3.4 ("one Kademlia keyspace, typed keys for everything"):
>
> - **A browser node cannot serve DHT records.** Every provider record, capability record, and load record a browser publishes must be accepted and stored by *server-mode* nodes — i.e. your backbone. The DHT's storage tier is permissioned by physics, not by policy.

— `.planning/research/STACK.md:230-252`

Note what the correction is *about*: not a wrong number, but a wrong **category** —
"a constraint that is real about the *public Amino* DHT was restated as a constraint
about *capability*, and then quoted as if it settled the fabric's own design."
And it names the failure mode as recurrent: *"it was wrong in the way this project
most often gets things wrong."*

The surviving (still-correct) bullets from the original section:

> - **S/Kademlia (design §3.4's fix for eclipse attacks) is not implemented in js-libp2p.** The docs say the implementation is "largely based on the Kademlia white paper, augmented with notions from S/Kademlia, Coral and mainlineDHT" — that is not the same as disjoint-path lookups. Treat sybil/eclipse resistance as **build**, not **configure**, and lean on `@libp2p/keychain` + provider-signed enrollment (§3.9) instead.

— `CLAUDE.md:212` (the threat model records the same at `THREAT-MODEL.md:149-151`)

### 6.2 The elfconv correction — "'Unstripped' was wrong"

The constraint as it now reads in `CLAUDE.md`:

> - **Platform**: `elfconv` requires AArch64, statically-linked binaries and is a
>   C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`, not a
>   TypeScript component. **"Unstripped" was wrong** — corrected in Phase 10 against a
>   real binary: one with no `.symtab` at all lifts fine, because the loader recovers
>   function entries from `.eh_frame` through libdwarf. The refusal is the *conjunction*
>   of stripped **and** no unwind tables. **And it exits `0` on binaries it could not
>   fully translate** — 174 addresses on a hello-world — so the exit code is never
>   trusted; the driver measures the produced module

— `CLAUDE.md:57-64`

The superseded version, still on disk in `PROJECT.md`:

> - **Platform**: `elfconv` requires AArch64, statically-linked, unstripped binaries
>   and is a C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`,
>   not a TypeScript component

— `.planning/PROJECT.md:210-212`

And the original claim in the design doc, under **Constraints (all real)**:

> - **No stripped binaries.** elfconv uses the symbol table to identify functions.

— `docs/p2p-native-cloud-design.md:90`

The phase-10 verification, verbatim:

> **A recorded project assumption was wrong and is now corrected.** `CLAUDE.md` said
> elfconv needs unstripped input. It does not — a binary with no `.symtab` lifts fine,
> because the loader recovers function entries from `.eh_frame` via libdwarf. The refusal
> is the *conjunction*, and `hello_static_stripped` is accepted.

— `.planning/phases/phase-10-elfconv-aot/10-VERIFICATION.md:56-59`

The same correction in the phase context, with the extra detail about *reporting*:

> ### A recorded project assumption was wrong
>
> `CLAUDE.md` recorded that elfconv requires unstripped binaries. It does not. A binary
> with no `.symtab` at all lifts fine, because the loader recovers function entries from
> `.eh_frame` through libdwarf. The refusal is the *conjunction* — stripped **and** no
> unwind tables — and `ElfFacts` reports `stripped` on accepted inputs too, because
> "lifted from a stripped binary" is worth knowing later when an artifact behaves oddly.

— `.planning/phases/phase-10-elfconv-aot/10-CONTEXT.md:52-58`

### 6.3 The companion finding — never trust elfconv's exit code

This is arguably the better story of the two:

> ### Never trust elfconv's exit code
>
> The single most consequential finding. elfconv exits `0` on a hello-world it could not
> fully translate, prints six INFO lines, and leaves real SVE instructions inside glibc's
> `__memcpy_a64fx` untranslated — 174 addresses on the smallest input available. A driver
> that believed the exit code would cache an artifact that aborts at runtime under a name
> asserting it is fine.
>
> So the driver measures rather than asks: it greps the produced module for the abort
> call sites *and* recovers the addresses, and requires the two counts to agree before
> calling the measurement evidence. The verdict is a third value — `reservations` —
> between clean and failed, and it maps to exit code `2` so a build script checking only
> for zero cannot read "translated, but 174 addresses will abort" as success.

— `.planning/phases/phase-10-elfconv-aot/10-CONTEXT.md:27-39`

The actual measured run:

```
input accepted by the pre-screen
image ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f…
lifting — expect a minute or two
aarch64-wasi32 · 5654531 bytes · 93.6s · RESERVATIONS
needs bulk-memory mutable-globals sign-ext
not translated, silently: 174 addresses over 259 call sites — 0x417ad4 0x417ad8 …
written to /tmp/ecvout/cli-hello.wasm
exit 2
```

— `.planning/phases/phase-10-elfconv-aot/10-VERIFICATION.md:26-35`

The named refusals:

> **The refusals.** `screenElf` refuses by name with the evidence attached:
> `not-an-elf`, `not-64-bit`, `not-little-endian`, `not-aarch64`, `dynamically-linked`,
> `stripped-without-unwind-tables`, `truncated`. 45 synthetic tests plus
> `elf.real.node.test.ts` against binaries GNU ld actually produced. **25 of 26 mutations
> caught.** Exhaustiveness is a mapped type over `ElfRefusal['kind']`, so adding a variant
> and forgetting the test is a compile error rather than a silent gap.

— `.planning/phases/phase-10-elfconv-aot/10-VERIFICATION.md:49-54`

### 6.4 Third correction — "same-host reproducibility is not reproducibility"

> ### Same-host reproducibility is not reproducibility
>
> Two lifts of the same bytes, minutes apart, on this machine, are byte-identical. That
> is the floor: a toolchain that cannot agree with itself cannot be reproducible at all.
> It is not evidence about a second machine, and elfconv's virtual-register promotion
> iterates a pointer-keyed `std::unordered_map` and a `std::set<BBBag*>`, whose order is
> an address-space property. The artifact therefore carries a structural blind spot that
> no configuration removes, rather than leaving a reader to infer more than was measured.

— `.planning/phases/phase-10-elfconv-aot/10-CONTEXT.md:60-67`

The CLI prints the blind spot on every artifact:

> > *two lifts on one host produced byte-identical artifacts; two lifts on two hosts have
> > never been compared*

— `.planning/phases/phase-10-elfconv-aot/10-VERIFICATION.md:86-87`

And the refusal to reword a criterion into a pass:

> **Criterion 2 above is left at its original wording deliberately, and the score is
> unchanged at 3 of 4** (2026-07-28). The *requirement* AOT-03 was rewritten to what one
> host establishes under the same-machine testing-standard ruling, but rewording a completed
> phase's criterion to match would convert an unmet half into a met one by editing rather
> than by measuring. The criterion stands as it was scored; the cross-machine half is
> **descoped and still unmeasured, not met**; and `CROSS_MACHINE_BLIND_SPOT` remains attached
> to every artifact because Phase 10 established it is structural rather than configurational.

— `.planning/ROADMAP.md:~250`

### 6.5 Fourth correction — "a capability with no consumer is not delivered"

> | **A capability with no consumer is not delivered** (v1.0 audit, 2026-07-27) | 36 requirements were marked Done on the strength of a unit-tested mechanism that no runnable entry point reaches. The ledger was corrected rather than the work undone: `[ ]` + *Built, not wired*. Tracing must start **at the entry point**, not at the module — a barrel export is not a wire, and a passing spec proves only that the pieces compose when someone composes them | ✓ Good |
>
> | **An optional hook with a silent default is a hole** (v1.0 audit) | `serveAgent`'s six hooks default to allow/empty/accept, so four phases of unwired mechanism produced a *working system that quietly did nothing*. One of them was a live bug — static-host rendezvous answered `[]` forever with the signature `{asked: true, dialed: [], failed: []}`. Make the omission a decision someone records | ✓ Good |

— `.planning/PROJECT.md:234-235`

The milestone framing of the same finding:

> **Why this milestone exists.** v1.0 executed all ten phases and the audit found that
> **36 of 68 requirements marked Done have no production call path.** […]
>
> **The structural cause is one shape.** `serveAgent` declares six optional hooks with
> silent defaults — `authorize`→allow, `index`/`reservations`→empty, `capacity`→accept.
> A default indistinguishable from the feature working is not a default, it is a hole,
> and it is why no test failed. `ledger` is supplied nowhere at all, in production or in
> a single test.

— `.planning/PROJECT.md:55-66`

### 6.6 Fifth correction — prior art moved (C4)

> | **Bacalhau deleted its deterministic-WASM verifier.** `pkg/` today has `bidstrategy`, `compute`, `orchestrator`, `publisher`, `nats` — no `verifier`. All 14 verifier issues closed, including "Enable deterministic verifier by default for WASM jobs" | GitHub contents API; issue search | The one team that built this exact mechanism removed it. Verification is **not** table stakes for the category — it is *this* project's deliberate differentiator because the Core Value asserts it. **Keep the verification tax visible, metered, and one flag away from off**, or it gets deleted here for the same reason. Read the removal commit before locking the design. |
>
> | **Bacalhau dropped libp2p and the embedded IPFS node in v1.4 for NATS**; wasmCloud's lattice is also NATS | Bacalhau "libp2p Deprecation Notice", v1.3/v1.4 posts | The two most successful WASM-mesh products both concluded a hub tier is unavoidable. This **validates** the backbone-relay decision (C2) and says plainly: **libp2p purity is not a feature users value.** Budget the relay/bootstrap tier as a first-class component. |
>
> | **Fission wound down (May 2024); `ipvm-wg/homestar` last pushed 2024-09-26.** Everywhere Computer is dead; IPVM survives as a spec | Fission "Farewell" post; GitHub `pushed_at` | The browser-compute niche is **vacant, not disproven** — it died of business model, not technology. But the failure mode to avoid is protocol research with no user. The demo must show a job a person cares about, not a protocol. |
>
> | **Nobody exposes a reduce.** Bacalhau supports exactly one task per job and delegates DAGs to Airflow | Bacalhau job spec; v1.7 partitioned-jobs post | A working **tree-reduce is a genuine differentiator**, not a checkbox — and the smallest API that beats the incumbent. Copy Bacalhau's map surface verbatim (`count` + `BACALHAU_PARTITION_INDEX`/`_COUNT`) so the mental model transfers; the reduce is the delta. |
>
> | **Fluence archived its entire P2P WASM stack** — `nox`, `aqua` (2024-09-18), `aqua-lib`, `registry`, `trust-graph`, `spell`, `cli` — and now ships a Terraform provider for renting VMs | GitHub org listing, `archived: true` | Fluence is prior art for *choreography*, not a live competitor. **Do not build an Aqua-class DSL.** The market rewarded "rent me a VM," not "compose a task graph across peers." Ship a narrow map + decomposable reduce; if someone needs a DAG they chain jobs by CID from outside. |

— `.planning/research/SUMMARY.md:101-105`

---

## 7. What the stack analysis rejects, and why

### 7.1 The verification method that makes the rejections credible

> > **Verification method.** Every version below was read from the live npm registry (`npm view <pkg> version`) and cross-checked against the package's source on `main` on 2026-07-24. Where a claim comes only from a doc page or a search result, it is marked. Training data was treated as a hypothesis only — several strong training-data beliefs turned out to be **wrong** (see [What NOT to Use](#what-not-to-use): `@chainsafe/libp2p-gossipsub`, `tsup`, `@libp2p/noise`).

— `.planning/research/STACK.md:7`

### 7.2 The full "What NOT to Use" table, verbatim

> ## What NOT to Use
> | Avoid | Why | Use Instead |
> |-------|-----|-------------|
> | `@chainsafe/libp2p-gossipsub@14.1.2` | **Looks current (published 2026-04-21) but depends on `@libp2p/interface ^2.0.0`** — it is a libp2p **v2** package. Gossipsub moved *into* the js-libp2p monorepo. | `@libp2p/gossipsub@16.0.5` |
> | `@libp2p/noise@1.0.1` | Published 2025-09, homepage points at `packages/connection-encrypter-noise` — **a directory that no longer exists on `main`.** An abandoned monorepo-absorption attempt. Never updated since. | `@chainsafe/libp2p-noise@17.0.0` (confirmed in libp2p's own integration tests) |
> | `@libp2p/yamux@8.0.1` | Same story — abandoned monorepo fork, no `stream-multiplexer-yamux` directory on `main`. | `@chainsafe/libp2p-yamux@8.0.1` |
> | `@libp2p/mplex@12.0.27` | **Self-deprecated in its own source:** *"a simple stream multiplexer that has been deprecated. Please use `@chainsafe/libp2p-yamux` instead."* No backpressure — will deadlock under the load a compute fabric generates. (Helia still lists it in defaults for legacy interop; you do not need that.) | `@chainsafe/libp2p-yamux@8.0.1` |
> | `tsup@8.5.1` | **README opens with:** *"This project is not actively maintained anymore. Please consider using tsdown instead."* | `tsdown@0.22.14` |
> | `ipfs`, `ipfs-core`, `ipfs-http-client`, `js-ipfs` | All npm-deprecated: *"js-IPFS has been deprecated in favour of Helia."* Last touched 2023. | `helia@7.1.1` + `@helia/*` |
> | `@libp2p/webrtc-star@7.0.0`, `libp2p-webrtc-star@0.25.0` | Dead since 2022–2023. The old centralized-signaling-server browser transport. Every browser-libp2p tutorial older than ~2023 uses these. | `@libp2p/webrtc` + `@libp2p/circuit-relay-v2` |
> | `@libp2p/floodsub@11.0.26` | Maintained but flood-routing: O(N²) message amplification. Source says "not for production use". | `@libp2p/gossipsub@16.0.5` |
> | `@libp2p/plaintext@3.0.24` in production | No encryption. Fine as a benchmark baseline (isolates crypto cost) — **never** on a real path. | `@chainsafe/libp2p-noise` |
> | `@multiformats/multiaddr@12.x` | libp2p v3 requires `13.x`; v13 removed DNS resolution and restructured tuples. Mixing versions produces confusing dial failures. | `@multiformats/multiaddr@13.0.3` |
> | `multiformats@13.x` transitively | `CID` identity checks fail across a v13/v14 boundary. Add an npm `overrides` entry pinning `multiformats@14`. | `multiformats@14.0.5` |
> | `wasm-metering@0.2.1` | Last published 2022. Predates SIMD, bulk-memory, reference types, GC. Will mis-instrument or crash on modern modules. | Build-time instrumentation, or Worker + `terminate()` timeout |
> | `wasi-js@1.7.3` | Last published 2023-02. Abandoned. | `@bjorn3/browser_wasi_shim@0.4.2` |
> | `benchmark@2.1.4` | Last published 2023, Node-oriented, poor ESM story. | `tinybench@6.1.2` |
> | `node:wasi` for guest execution | Experimental, Node-only, and gives you *different host semantics from the browser* — which is a determinism bug by construction. | `@bjorn3/browser_wasi_shim` on both platforms |
> | Wasmtime / WasmEdge / Marine **in the node agent** | Would fork the agent into browser and non-browser builds, destroying the "one codebase" property that is the project's core bet. | V8's built-in `WebAssembly`. Server-side runtimes belong in the Part I *build* pipeline only. |
> | `SharedArrayBuffer` / WASM threads in the browser tier | Requires COOP/COEP cross-origin isolation headers. **GitHub Pages serves no custom headers**, so this is unavailable on the declared hosting target — and threads are a nondeterminism source anyway. | Multiple dedicated Workers with `postMessage`, one WASM instance each |
> | TS `moduleResolution: "node"` / `"node10"` / `"classic"`, `baseUrl` | **Removed in TypeScript 7.0 — hard errors, not warnings.** | `moduleResolution: "bundler"`, path mapping via `paths` without `baseUrl` |

— `CLAUDE.md:258-278`

### 7.3 Why this table is unusually good — the taxonomy of rejection reasons

Six distinct failure modes, each with its own evidential standard:

| Reason class | Example | Evidence type |
|---|---|---|
| **Looks current, is a major version behind** | `@chainsafe/libp2p-gossipsub@14.1.2` — published 2026-04-21, depends on `@libp2p/interface ^2.0.0` | Dependency range read from the package |
| **Abandoned monorepo-absorption attempt** | `@libp2p/noise@1.0.1` — "homepage points at `packages/connection-encrypter-noise` — a directory that no longer exists on `main`" | Broken link to a source tree |
| **Self-deprecated in its own source** | `@libp2p/mplex` — quotes the package's own words back at it | The package's own README/source |
| **Algorithmically wrong for this load** | `@libp2p/floodsub` — "flood-routing: O(N²) message amplification. Source says 'not for production use'" | Complexity + author's own caveat |
| **Silent cross-boundary breakage** | `multiformats@13.x` transitively — "`CID` identity checks fail across a v13/v14 boundary" | `instanceof` failure mode named |
| **Violates the project's core bet** | Wasmtime/WasmEdge in the agent — "destroying the 'one codebase' property that is the project's core bet" | Argument from stated project value |

The last row is the one that matters most rhetorically: the rejection is not technical
at all. `node:wasi` gets the same treatment — *"gives you different host semantics from
the browser — which is a determinism bug by construction"* — a package rejected not for
being bad but for being **asymmetric across the two targets**, which the project's
one-codebase bet forbids.

### 7.4 The "four trap packages" framing

> **The four trap packages.** Each exists, installs cleanly, and looks current:
>
> | Trap | Why it's wrong | Use instead |
> |---|---|---|
> | `@chainsafe/libp2p-gossipsub@14.1.2` | Published 2026-04-21 but depends on `@libp2p/interface ^2.0.0` — a libp2p **v2** package. Gossipsub moved *into* the js-libp2p monorepo | `@libp2p/gossipsub@16.0.5` |
> | `@libp2p/noise@1.0.1` | Homepage points at a directory that no longer exists on `main` — an abandoned monorepo-absorption attempt | `@chainsafe/libp2p-noise@17.0.0` |
> | `@libp2p/yamux@8.0.1` | Same abandoned fork | `@chainsafe/libp2p-yamux@8.0.1` |
> | `@libp2p/mplex@12.0.27` | **Self-deprecated in its own source.** No backpressure — will deadlock under a compute fabric's load | `@chainsafe/libp2p-yamux@8.0.1` |
>
> > **Superseded:** ARCHITECTURE §7.3 and §12 both recommend `@chainsafe/libp2p-gossipsub@14.1.2`. That is trap #1. Use `@libp2p/gossipsub@16.0.5`. […]

— `.planning/research/SUMMARY.md:111-120`

Note the last line: the research **corrects its own sibling document by name**.

### 7.5 The pinning discipline that follows from all of it

> **Pin exact versions — no `^` — on the entire libp2p stack.** The constants this research depends on live in *internal* files that change without a semver signal. Add a **constants-regression test** asserting the relay/transport limits you depend on, so an upgrade fails loudly in CI instead of silently at scale.

— `.planning/research/SUMMARY.md:126`

### 7.6 "Alternatives Considered" — rejection with a re-entry condition

Unlike "What NOT to Use", every row here names the circumstance that would flip the decision:

> | Recommended | Alternative | When to Use Alternative |
> |-------------|-------------|-------------------------|
> | `libp2p@3.3.6` | Pin to `libp2p@2.x` | Only if a required third-party module hasn't migrated to the `EventTarget` stream API. Check before committing — as of 2026-07-24 the whole first-party ecosystem is on v3. |
> | WebRTC for browser↔browser | Raw WebRTC + custom signaling | If you want to skip Circuit Relay entirely and run your own signaling server. Cheaper to operate, but you lose PeerId-authenticated signaling, the libp2p muxer/protocol stack, and interop. Not worth it. |
> | `webRTCDirect()` browser entry | WebTransport | If you only need Chromium/Firefox and are willing to run go-libp2p for the server side. js-libp2p **cannot listen** on WebTransport, and Safari has no support. Skip. |
> | `@bjorn3/browser_wasi_shim` | `@bytecodealliance/jco@1.25.2` | If you move to the **Component Model / WASI Preview 2**. jco transpiles components to JS+core-wasm that runs in browsers. Watch this — it is where the ecosystem is heading — but preview1 is what elfconv emits today. |
> | `blockstore-idb` | `blockstore-opfs@1.0.1` | OPFS is faster than IndexedDB for large blocks. **But this package is third-party (`dozyio`), not official `ipfs/js-stores`.** Consider once the blockstore interface is stable in your code; not for the first milestone. |
> | Redundant execution for integrity | zk proofs | Out of scope per design §3.1 — no JS-side tooling makes this tractable at this stage. |

— `CLAUDE.md:245-257` (selected rows; full table at that range)

---

## 8. Supporting material worth having

### 8.1 Honest performance numbers for elfconv — the doc refuses "near-native"

> **Honest performance** — do not claim "near-native":
> - elfconv's published benchmarks (Eratosthenes sieve, LINPACK) measure against the **same program compiled from source directly to WASM**, not native hardware.
> - Against that WASM baseline it reaches **~56–82%** depending on runtime (LINPACK 1256 vs 1617 MFLOPS ≈ 78%; 2720 vs 4821 MFLOPS ≈ 56% in a second runtime).
> - Because WASM itself runs below native, the **native-relative** slowdown is larger — low-single-digit multiples on compute-bound code, worse on branch/syscall-heavy code.
> - Those are the *friendly* cases (tight arithmetic loops). Real workloads with indirect control flow do worse or fail to lift.

— `docs/p2p-native-cloud-design.md:83-87`

### 8.2 Content addressing gives integrity, not provenance

> - **Content-addressing gives integrity, not provenance.** A CID proves "these bytes match this hash," *not* "this is a faithful translation of my binary." Anyone can publish bytes under a CID, so the `key → CID` mapping must be **signed by a trusted build authority**. For **wasm** artifacts the sandbox caps blast radius — a bad artifact returns wrong results but can't escape.
> - **Escalation for distributed *native* (AOT) artifacts — the sharp edge.** Distributing native artifacts (universal-wasm's native section, `.so`, `.cwasm`) moves native code across a trust boundary; when a WasmEdge node extracts and runs that native section it runs **outside the wasm sandbox**, so a poisoned CID is **arbitrary native code execution**. Signing the `key → CID` mapping is **non-negotiable** for the native tier. Pin trust anchors; never resolve native artifacts by CID alone.

— `docs/p2p-native-cloud-design.md:124-125`

### 8.3 Moving Target Defense — and its explicitly stated limits

> **Emergent defense-in-depth — and its honest scope.** The system's natural dynamism […] forms a **Moving Target Defense** over cryptographic access control […]. **But this raises attacker cost; it is not an impossibility proof.** Concretely: (1) long-term identity keys are a *static* target — exfiltration defeats that factor independently of placement/timing; (2) sovereign data-at-rest sits at a *known, fixed* location (the owner's device) — its defense is encryption-at-rest + endpoint security, not uncertainty; (3) in an open pool an attacker need not *predict* placement — it can *be* a candidate node and let work come to it; (4) the factors fall independently and sequentially via different vectors, not by simultaneous guess, so "multiply three small probabilities" does not bind a real adversary. Load-bearing guarantees therefore remain redundant-execution verification, TEE attestation, trust-tiering, secure aggregation, and short-lived credentials — stated against an explicit threat model […]. Treat moving-target uncertainty as valuable depth, not the foundation.

— `docs/p2p-native-cloud-design.md:195`

### 8.4 The honest limit on provider-signed clients

> **Honest limit (same root cause as the TEE limit).** Code signing proves *origin and on-disk integrity*, not *runtime integrity on hardware the owner controls*. A determined node-owner can debug, patch in memory, MITM their own traffic, or extract anything embedded in the binary. So durable embedded secrets are extractable, and a tampered build can still present valid credentials. This raises the bar and supplies identity; it does **not** make a client node trustworthy for confidential third-party work — that still needs TEE/backbone + result verification (§3.1). Consistent with sovereignty: client nodes are trusted for *their own* data and for sandboxed/verified public work.

— `docs/p2p-native-cloud-design.md:314`

### 8.5 The benchmark-honesty checklist

> 5. **Benchmark numbers that are technically true and materially false.** […] The specific traps: N tabs on one machine counted as N nodes; "super-linear" stated without its mechanism; verification tax excluded; relay/aggregator hardware excluded from the inventory; warm V8 code cache undisclosed; uniform synthetic data (sovereignty makes skew *structural*, and skew is what flattens the real curve); mean instead of p99. *Avoid:* **pre-register the methodology before the first number exists**, publish a COST number even if it is embarrassing, publish raw data and the harness, and state the negative result. The design doc's "honest ceiling" is already the project's best credibility asset.

— `.planning/research/SUMMARY.md:207`

> - Report **percentiles, not means** — straggler-dominated distributions (design §3.3) have meaningless means.
> - Pin the independent variable properly. Design §3.3 argues throughput scales with the *number of independent requestors*, not raw node count. **Sweep both axes separately** or the headline chart will be measuring the wrong thing.

— `CLAUDE.md:241-242`

### 8.6 The three benchmark axes

> - **N in one process (Node):** `@libp2p/memory@2.0.24` transport. No sockets, no ports, no OS limits, deterministic. This is where the *scaling curve shape* gets measured up to hundreds of nodes.
> - **N as browser tabs:** Playwright `browser.newContext()` × N. Each context is an isolated origin with its own IndexedDB — a genuine independent node. This is where the *real WebRTC/relay* costs show up, and it will diverge from the memory-transport curve. **Both curves are needed**; the gap between them is the connectivity tax and is itself a publishable number.
> - **N as machines:** the multi-machine demo. Small N, high fidelity, validates the other two.

— `CLAUDE.md:236-238`

### 8.7 Where the genuine research risk lives

> **Where the genuine research risk lives:** (1) decentralized scheduling that stays efficient under churn + locality + trust constraints simultaneously; (2) making tree-reduce robust when the aggregation backbone itself churns; (3) keeping the verification tax affordable at scale. Everything else is integration of proven parts.

— `docs/p2p-native-cloud-design.md:350`

### 8.8 Proven vs novel — the risk surface, stated up front

> **Proven vs. novel (the risk surface).** Compute-to-data over content-addressed storage is proven (Bacalhau / IPVM / Homestar, Ocean Protocol C2D). Decentralized task-graph choreography with no central coordinator is proven (Fluence Aqua → AIR → AquaVM). Sandboxed WASM, content addressing, confidential computing (SEV-SNP / TDX / Nitro / Arm CCA), and binary→WASM AOT (elfconv) are all off-the-shelf. **The novel composition** is (a) unifying managed + *safely-sandboxed native* via AOT-to-WASM, (b) sovereignty-by-placement (data pinned to the owner's node), and (c) a hybrid trust model that dials guarantees per job. Nobody has shipped that exact combination as a product.

— `docs/p2p-native-cloud-design.md:7`

---

## 9. Notable discrepancies between documents (use with care)

1. **Determinism doctrine.** `CLAUDE.md:47-50` says publish-time artifact property;
   `.planning/PROJECT.md:198-201` says serialization boundary with strict DAG-CBOR.
   The second supersedes the first in practice (the admission gate was built, measured
   and deleted — 1,214 lines) but `CLAUDE.md` was never updated. Both are quoted in §4.
2. **Integrity table.** `CLAUDE.md:22-29` has two rows; `.planning/PROJECT.md:26-31`
   has four. The four-row version is later and adds owner-domain replication.
3. **elfconv "unstripped".** Corrected in `CLAUDE.md:57-64`; the stale claim survives
   verbatim in `.planning/PROJECT.md:210-212` and `docs/p2p-native-cloud-design.md:90`.
4. **DHT.** Corrected in `CLAUDE.md:176-209`; the original wrong text is preserved
   under a correction banner in `.planning/research/STACK.md:230-252`.
5. **Disclosure.** `CLAUDE.md:53-56` reads as prospective ("publishing forfeits");
   `.planning/PROJECT.md:204-209` and `README.md:236-249` record that it already happened
   on 2026-07-26.

When quoting for publication, prefer `CLAUDE.md` for constraints 3 and 4, and
`PROJECT.md`/`README.md` for 1, 2 and 5.
