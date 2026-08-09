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

## Current Milestone: v1.1 Wire What Was Built

**Goal:** Every requirement the v1.0 audit reclassified as *Built, not wired* becomes
reachable from a runnable entry point — or is descoped with the reason recorded.

**Why this milestone exists.** v1.0 executed all ten phases and the audit found that
**36 of 68 requirements marked Done have no production call path.** Phases 4, 5, 6 and
7 — sovereignty, tree-reduce, discovery/enrollment, churn — are genuinely implemented,
genuinely tested, and reached by nothing a person can run. `runResilient`,
`EgressGuard`, `composeQuorum`, `discoverExecutors`, `executeReduce`,
`requestEnrollment`, `signName`, `verifyChain` and `translationCid` each appear only as
their own definition, a barrel re-export, or a prose comment.

**The structural cause is one shape.** `serveAgent` declares six optional hooks with
silent defaults — `authorize`→allow, `index`/`reservations`→empty, `capacity`→accept.
A default indistinguishable from the feature working is not a default, it is a hole,
and it is why no test failed. `ledger` is supplied nowhere at all, in production or in
a single test.

**Target features:**
- `serveAgent`'s hooks stop defaulting silently — an omission becomes a recorded decision
- A dispatched task carries a capability chain, and the serving node verifies it before
  `WebAssembly.instantiate` — today neither end exists
- `JobSpec`/`Task` carry an owner label and the real job path consults the sovereignty
  gate, replacing unconditional round-robin
- Both nodes wrap their transport in `EgressGuard`, so the egress manifest is complete
  by construction rather than only in a test
- One job path, not two — `runResilient`'s lease/speculation/coverage machinery either
  becomes the entry point or merges into `submitJob`
- Discovery, enrollment and quorum composition run on the real dispatch path
- `translationCid` is called by the lift pipeline and the CLI emits the CID; a
  production node can construct a `WasiExecutor`
- **A reachability guard** — a test that fails when an exported capability has no path
  from an entry point. The audit found this class; no test could have

**Explicitly not in v1.1:** NET-03 (needs a publicly reachable host), BENCH-06 and
AOT-03 (both rewritten 2026-07-28 to what one host establishes — see the residual below),
AOT-05 (a measured negative with two controls — reported unmet rather than reworded).

**Residual, recorded rather than blocking (owner ruling, 2026-07-28).** Same machine —
different browsers and/or different browser contexts, and different OS processes — is now
the project's testing standard **everywhere**, so *"a second machine"* is no longer a
blocker on any of the project's own criteria and has been struck from the blocker lists.
What it was blocking does not disappear with it: **cross-machine reproducibility and
distinct-machine benchmarking are unverified by choice, and closing either would need
hardware this project does not have.** The ruling was made with the argument that one host
cannot establish those two already on the table. Descoped is not satisfied — neither
BENCH-06 nor AOT-03 may be reported as having demonstrated anything across machines, the
same-machine benchmark label stays required and derived from the recorded inventory, and
`CROSS_MACHINE_BLIND_SPOT` stays attached to every lifted artifact because Phase 10 showed
it is structural rather than configurational.

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
- **Disclosure**: Public hosting is public disclosure. EPO and China have no
  patent grace period. **The repository was made public on 2026-07-26, so those rights
  are already forfeit for what was disclosed then; the US provisional window is
  running.** Deployment
  must be a separately-triggered gate, not an automatic consequence of a phase
  completing
- **Platform**: `elfconv` requires AArch64, statically-linked, unstripped binaries
  and is a C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`,
  not a TypeScript component
- **Contributions**: None accepted; sole authorship preserves the commercial
  license track

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + WASM for the node agent | Portability is the product; browser execution makes "capacity scales with users" literal. Collapses the WASM-runtime layer to V8 in the browser | — Pending |
| ~~Relay: public IPFS infra primary, own relay fallback~~ **INVERTED** → own backbone relay primary, public infra opportunistic | Research disproved the original. Browsers can only dial DNS+WSS / WebTransport / WebRTC-Direct, and most public nodes offer none of those (`no valid addresses available to dial`). Browser kad-dht is client-mode only; pubsub discovery is documented as not production-fit. Doc §3.7 already prescribed backbone relays | ⚠️ Revised 2026-07-24 |
| All nodes have equal functionality; only discovery differs | Owner decision 2026-07-26. No tier, no class. A browser cannot bind a listening socket, so it cannot be a seed a newcomer dials cold and must be found via a relay — but once connected it is indistinguishable, and it executes, stores, serves and takes quorum slots identically. Proven cross-device in Phase 3. Client-mode-only DHT and leaves-only reduce were inherited assumptions, both reversed. Background-tab throttling is a lease-duration problem. Any decision keying on node kind is wrong; the only legitimate use is shared-dependency analysis over the discovery graph | — Done |
| Build the public demo, gate publishing separately | Building discloses nothing; deploying does. Kept the provisional-patent option alive until explicitly surrendered | — **Superseded 2026-07-26** |
| Make the repository public | Owner decision, taken with the consequence stated: EPO/China rights permanently forfeited, US provisional window (12 months from first disclosure) now running. DEMO-04 unaffected — no deploy workflow was added | — Done |
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
