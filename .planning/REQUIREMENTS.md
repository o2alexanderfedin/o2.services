# Requirements — o2.services P2P Native Cloud (v1)

**Derived from:** `docs/p2p-native-cloud-design.md`, `.planning/PROJECT.md`,
`.planning/research/SUMMARY.md`
**Scope decision:** full design in v1, with Part I (elfconv AOT) sequenced last
**Defined:** 2026-07-24

---

## v1 Requirements

### Determinism & Execution Substrate

> **Determinism is detected, not predicted.** There is deliberately no static
> analysis of task modules. Two nodes execute, their outputs are serialized and
> compared, and a mismatch is reported with the dissenting node named. Proving
> ahead of time that a module *cannot* diverge is a far harder problem than
> comparing two byte strings, and the comparison is the mechanism regardless —
> the cost of a nondeterministic module is one wasted redundant execution and a
> reported disagreement, which is what redundancy exists to surface.
>
> The sandbox needs no allow-list either: the host supplies four functions, and a
> module importing anything else fails at `WebAssembly.instantiate` with the
> offending import named. The runtime enforces it.

- [x] **DET-03**: Artifacts resolve only through a `key → CID` mapping signed by a
      trusted build authority, never by a bare CID — content addressing proves
      integrity, not provenance
- [x] **DET-05**: Anything hashed or content-addressed is encoded with strict
      DAG-CBOR — which rejects `NaN`/`Infinity`/`-Infinity`, forces `-0.0` to `+0.0`,
      and mandates one float width — and protobuf bytes are never hashed. Comparison is
      over the declared schema's encoded bytes, never a raw linear-memory slice
- [x] **DET-06**: A WASM task executes in a Web Worker with a narrow host ABI
      (no WASI clock, randomness, environment, or filesystem)
- [x] **DET-07**: The identical task-execution test suite passes under `node`,
      `browser`, and `webworker` targets

### Integrity & Verification

- [x] **VER-01**: A task can be dispatched to N independent executors and their
      outputs compared, with disagreement surfaced rather than silently resolved
- [x] **VER-02**: Executors commit to a result hash before revealing the result,
      so a replica cannot plagiarize a peer's answer
- [x] **VER-03**: At least one replica of every verification quorum is anchored on
      a backbone node, so eclipsing a quorum requires a backbone compromise
- [x] **VER-04**: Quorum members are selected with anti-affinity, so one operator
      cannot supply a whole quorum
- [x] **VER-05**: The verifier compares `(task, outputs)` only — timing, fuel, and
      node metadata sit outside the signed digest
- [x] **VER-06**: Redundancy factor is a per-job dial reaching 1 (off), and the
      verification tax is reported as a measured cost on every job
- [x] **VER-08**: When an owner has two or more live nodes, a sovereignty-pinned
      task executes redundantly across the owner's own node set and the outputs
      are compared — no data leaves the owner's trust domain
- [x] **VER-09**: When an owner has fewer than two live nodes, the task executes
      once and the receipt records it as owner-attested rather than verified
- [x] **VER-10**: Owner-domain quorum agreement is reported as a distinct,
      weaker claim than independent-operator agreement, so the stronger guarantee
      is never implied by the weaker one

### Data, Content Addressing & Sovereignty

- [x] **DATA-01**: Task inputs, outputs, and intermediates are content-addressed
      and retrievable by CID
- [x] **DATA-02**: A blockstore adapter works against IndexedDB in the browser and
      the filesystem in Node behind one interface
- [x] **DATA-03**: Data carries a sovereignty label that travels with it and acts
      as a hard scheduling constraint
- [x] **DATA-04**: A sovereignty-pinned task executes only within the owner's own
      node set — the scheduler cannot relocate it outside that set to balance load
- [x] **DATA-05**: A stream-tap test fails if raw sovereign bytes cross the network
      boundary
- [x] **DATA-06**: Every job emits an egress manifest recording exactly what left
      each owner's node
- [x] **DATA-07**: Filters, projections, and partial aggregation push down to the
      owner's node so the least data leaves
- [x] **DATA-08**: Artifact `key → CID` mappings are signed by a trusted build
      authority and never resolved by CID alone
- [x] **DATA-09**: Backbone encrypted replicas serve availability only and are
      never execution-eligible for sovereign tasks — executing requires
      decryption, which would expose plaintext to a non-owner node

### Authorization & Node Identity

- [x] **AUTH-01**: A node's identity key is generated on-device and its public half
      is signed into a provider-issued certificate
- [x] **AUTH-02**: A node verifies a peer's provider-signed certificate offline,
      with no live certificate authority
- [x] **AUTH-03**: A task carries a delegatable, expiry-scoped capability chain
      rooted at the data owner's key, verified before execution
- [x] **AUTH-04**: Enrollment is provider-gated and rate-limited, so mass fake-node
      creation is costly
- [x] **AUTH-05**: Multiple node identity certificates chain to a single owner's
      user key, forming a discoverable replica set that the scheduler can target

### Transport, Discovery & Connectivity

- [x] **NET-01**: Two Node.js processes discover each other and exchange tasks over
      a real network transport
- [x] **NET-02**: Two browser tabs connect to each other via WebRTC using a
      Circuit Relay v2 peer for SDP signaling
- [ ] **NET-03**: A backbone relay node auto-acquires a TLS certificate and accepts
      browser reservations without manual certificate management
- [x] **NET-04**: Relayed protocol handlers register with `runOnLimitedConnection`,
      and no hardcoded certhash multiaddr is required to join
- [x] **NET-05**: Relay reservation exhaustion is detected and reported rather than
      failing silently
- [x] **NET-06**: Browser peers participate in routing as full peers. Backbone nodes
      may serve records on their behalf as an optimisation and as a fallback when a
      browser holds no relay reservation — not because a browser is incapable.
      **Revised 2026-07-26** (owner decision): a browser peer differs from a backbone
      peer only in that it cannot bind a listening socket. Holding a relay
      reservation makes it dialable, which was demonstrated in Phase 3 when an iPhone
      was dialled at its `/p2p-circuit/webrtc` address and ran half of a 2×-redundant
      job. Client-mode-only was an assumption inherited from research, not a measured
      limit
- [x] **NET-07**: A constants-regression test asserts the relay and transport
      limits the system depends on, failing CI when an upgrade changes them

### Scheduling & Placement

- [x] **SCHED-01**: A requestor discovers candidate nodes by querying providers of
      a data CID intersected with required capability records
- [x] **SCHED-02**: Placement samples d candidate nodes and selects the
      least-loaded, using local information only
- [x] **SCHED-03**: An over-committed node rejects work and the requestor re-picks
- [x] **SCHED-04**: A resource governor caps node CPU by duty cycle, is
      user-adjustable, and is honoured by the executor
- [x] **SCHED-05**: Sovereignty constraints override placement cost heuristics

### Map / Reduce

- [x] **MR-01**: A job partitions into N shards, each executing independently, with
      a partition index and count available to the task
- [x] **MR-02**: Each owner computes a local partial over its own data with no
      map-side data movement
- [x] **MR-03**: Partials merge up a hierarchical tree via an associative,
      commutative combine
- [x] **MR-04**: The reduce tree is derived deterministically from sorted partial
      CIDs, so every participant computes an identical tree with no consensus
- [x] **MR-05**: Combine executors are assigned by rendezvous hashing, yielding a
      ranked fallback list
- [x] **MR-06**: A combine lost to churn is recomputed elsewhere from its
      content-addressed inputs, with no state migration
- [x] **MR-07**: A duplicate combine result is discarded harmlessly because it
      carries the same CID

### Resilience

- [ ] **CHURN-01**: A job completes correctly when 30% of participating nodes are
      killed mid-execution
- [ ] **CHURN-02**: Slow tasks are duplicated speculatively and the first result
      wins
- [ ] **CHURN-03**: Coordinator state is checkpointed to content-addressed storage
      so a departed requestor does not lose the job
- [ ] **CHURN-04**: Task ownership is leased and re-dispatched on lease expiry
- [ ] **CHURN-05**: A cross-owner job over unavailable owners returns a coverage
      report rather than a silently partial result
- [ ] **CHURN-06**: Speculative duplicates of a sovereign task are scoped to the
      owner's own node set and never dispatched across owners

### Browser Node Experience

- [ ] **BROW-01**: A visitor gives explicit informed consent before any compute
      begins
- [ ] **BROW-02**: The node reports the percentage of visitors where it failed to
      start, segmented by browser, so blocking is visible rather than silent
- [x] **BROW-03**: Compute pauses or throttles when the tab is backgrounded, and
      resumes on return
- [ ] **BROW-04**: A visitor can see what the node is doing and stop it at any time
- [x] **BROW-05**: The node runs embedded in a third-party page without requiring
      COOP/COEP headers

### Benchmark & Proof

- [ ] **BENCH-01**: A benchmark harness measures job makespan against participating
      node count, reproducibly
- [ ] **BENCH-02**: Benchmark methodology is pre-registered and committed before
      the first published number
- [ ] **BENCH-03**: Published results report p99 makespan, not mean
- [ ] **BENCH-04**: The verification tax is included in reported cost, never
      excluded
- [ ] **BENCH-05**: A COST crossover is published — the node count at which the
      system beats a competent single-threaded implementation
- [ ] **BENCH-06**: Benchmarks run across distinct machines, and any same-machine
      measurement is labelled as such

### Demo & Disclosure

- [ ] **DEMO-01**: A static client distributes a real job across browser tabs and
      machines, showing live placement and results
- [ ] **DEMO-02**: The demo runs a task a person cares about, not a synthetic
      protocol exercise
- [ ] **DEMO-03**: The demo is deployable to static hosting with no server-side
      process beyond the backbone relay
- [ ] **DEMO-04**: Public deployment is an explicitly triggered action, never an
      automatic consequence of a phase completing

### Native → WASM AOT (Part I)

- [ ] **AOT-01**: A statically-linked AArch64 binary translates to a `.wasm`
      artifact via the elfconv pipeline
- [ ] **AOT-02**: Translated artifacts are content-addressed with a cache key
      covering input digest, toolchain versions, target, and WASM feature set
- [ ] **AOT-03**: Translation is reproducible — identical inputs yield an identical
      CID
- [ ] **AOT-04**: A translated artifact executes on the fabric under the same
      admission checks and verification as a source-compiled one
- [ ] **AOT-05**: Browser artifact loading uses `compileStreaming` against a stable
      gateway URL so V8 code caching applies

---

## v2 Requirements (deferred)

- Mergeable sketches (HyperLogLog, t-digest, Count-Min) for approximate holistic ops
- Secure aggregation and differential privacy over cross-owner partials
- TEE / confidential-computing backbone tier with remote attestation
- Native execution in Firecracker / Kata microVMs
- Delegated tree-coordination for single very large jobs
- S/Kademlia hardening (not implemented in js-libp2p — build, not configure)
- Cryptographic proofs of computation

---

## Out of Scope

- **Outside contributions** — sole authorship preserves the commercial license track
- **Incentives, payments, staking, reputation markets** — meaningless before
  capacity scaling is proven; browser compute demonstrably cannot be paid
- **Aqua-class choreography DSL** — Fluence archived exactly this; chain jobs by
  CID from outside instead
- **Key-partitioned all-to-all shuffle** — the expensive escape hatch; decomposable
  reduce covers the target workloads
- **Emulation fallback / container2wasm** — ~10x+ slowdown for kernel fidelity
  nobody has requested
- **Server-side WASM runtimes in the portable agent** (Wasmtime / WasmEdge / Marine)
  — would fork the agent and destroy the portability bet; build-pipeline only
- **WebTransport** — dial-only in js-libp2p, cannot listen, absent from Safari
- **Bulk data over the browser mesh** — WebRTC caps messages at 16 KiB and
  Chromium closes channels above 256 KiB; artifacts fetch over a gateway

---

## Traceability

All 72 v1 requirements are mapped, each to exactly one phase. See
`.planning/ROADMAP.md` for phase goals and success criteria.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DET-03 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DET-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DET-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DET-07 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-02 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-03 | Phase 6 — Discovery, Placement & Enrollment | Done |
| VER-04 | Phase 6 — Discovery, Placement & Enrollment | Done |
| VER-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-08 | Phase 6 — Discovery, Placement & Enrollment | Done |
| VER-09 | Phase 6 — Discovery, Placement & Enrollment | Done |
| VER-10 | Phase 6 — Discovery, Placement & Enrollment | Done |
| DATA-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DATA-02 | Phase 3 — Browser Tier & Backbone Relay | Done |
| DATA-03 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DATA-04 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DATA-05 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DATA-06 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DATA-07 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DATA-08 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| DATA-09 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| AUTH-01 | Phase 6 — Discovery, Placement & Enrollment | Done |
| AUTH-02 | Phase 6 — Discovery, Placement & Enrollment | Done |
| AUTH-03 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Done |
| AUTH-04 | Phase 6 — Discovery, Placement & Enrollment | Done |
| AUTH-05 | Phase 6 — Discovery, Placement & Enrollment | Done |
| NET-01 | Phase 2 — Real Network, Node ↔ Node | Done |
| NET-02 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-03 | Phase 3 — Browser Tier & Backbone Relay | Partial — relay is browser-dialable; AutoTLS needs a public host |
| NET-04 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-05 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-06 | Phase 6 — Discovery, Placement & Enrollment | Done |
| NET-07 | Phase 2 — Real Network, Node ↔ Node | Done |
| SCHED-01 | Phase 6 — Discovery, Placement & Enrollment | Done |
| SCHED-02 | Phase 6 — Discovery, Placement & Enrollment | Done |
| SCHED-03 | Phase 6 — Discovery, Placement & Enrollment | Done |
| SCHED-04 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| SCHED-05 | Phase 6 — Discovery, Placement & Enrollment | Done |
| MR-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| MR-02 | Phase 5 — Decomposable Tree-Reduce | Done |
| MR-03 | Phase 5 — Decomposable Tree-Reduce | Done |
| MR-04 | Phase 5 — Decomposable Tree-Reduce | Done |
| MR-05 | Phase 5 — Decomposable Tree-Reduce | Done |
| MR-06 | Phase 5 — Decomposable Tree-Reduce | Done |
| MR-07 | Phase 5 — Decomposable Tree-Reduce | Done |
| CHURN-01 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-02 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-03 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-04 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-05 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-06 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| BROW-01 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| BROW-02 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| BROW-03 | Phase 3 — Browser Tier & Backbone Relay | Done |
| BROW-04 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| BROW-05 | Phase 3 — Browser Tier & Backbone Relay | Done |
| BENCH-01 | Phase 8 — Benchmark Harness | Pending |
| BENCH-02 | Phase 8 — Benchmark Harness | Pending |
| BENCH-03 | Phase 8 — Benchmark Harness | Pending |
| BENCH-04 | Phase 8 — Benchmark Harness | Pending |
| BENCH-05 | Phase 8 — Benchmark Harness | Pending |
| BENCH-06 | Phase 8 — Benchmark Harness | Pending |
| DEMO-01 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| DEMO-02 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| DEMO-03 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| DEMO-04 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| AOT-01 | Phase 10 — elfconv AOT Native→WASM Pipeline | Pending |
| AOT-02 | Phase 10 — elfconv AOT Native→WASM Pipeline | Pending |
| AOT-03 | Phase 10 — elfconv AOT Native→WASM Pipeline | Pending |
| AOT-04 | Phase 10 — elfconv AOT Native→WASM Pipeline | Pending |
| AOT-05 | Phase 10 — elfconv AOT Native→WASM Pipeline | Pending |

**Coverage: 70/70 mapped. No orphans, no duplicates.**
