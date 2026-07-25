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

- [ ] **DET-03**: Artifacts resolve only through a `key → CID` mapping signed by a
      trusted build authority, never by a bare CID — content addressing proves
      integrity, not provenance
- [ ] **DET-05**: Anything hashed or content-addressed is encoded with strict
      DAG-CBOR — which rejects `NaN`/`Infinity`/`-Infinity`, forces `-0.0` to `+0.0`,
      and mandates one float width — and protobuf bytes are never hashed. Comparison is
      over the declared schema's encoded bytes, never a raw linear-memory slice
- [ ] **DET-06**: A WASM task executes in a Web Worker with a narrow host ABI
      (no WASI clock, randomness, environment, or filesystem)
- [ ] **DET-07**: The identical task-execution test suite passes under `node`,
      `browser`, and `webworker` targets

### Integrity & Verification

- [ ] **VER-01**: A task can be dispatched to N independent executors and their
      outputs compared, with disagreement surfaced rather than silently resolved
- [ ] **VER-02**: Executors commit to a result hash before revealing the result,
      so a replica cannot plagiarize a peer's answer
- [ ] **VER-03**: At least one replica of every verification quorum is anchored on
      a backbone node, so eclipsing a quorum requires a backbone compromise
- [ ] **VER-04**: Quorum members are selected with anti-affinity, so one operator
      cannot supply a whole quorum
- [ ] **VER-05**: The verifier compares `(task, outputs)` only — timing, fuel, and
      node metadata sit outside the signed digest
- [ ] **VER-06**: Redundancy factor is a per-job dial reaching 1 (off), and the
      verification tax is reported as a measured cost on every job
- [ ] **VER-08**: When an owner has two or more live nodes, a sovereignty-pinned
      task executes redundantly across the owner's own node set and the outputs
      are compared — no data leaves the owner's trust domain
- [ ] **VER-09**: When an owner has fewer than two live nodes, the task executes
      once and the receipt records it as owner-attested rather than verified
- [ ] **VER-10**: Owner-domain quorum agreement is reported as a distinct,
      weaker claim than independent-operator agreement, so the stronger guarantee
      is never implied by the weaker one

### Data, Content Addressing & Sovereignty

- [ ] **DATA-01**: Task inputs, outputs, and intermediates are content-addressed
      and retrievable by CID
- [ ] **DATA-02**: A blockstore adapter works against IndexedDB in the browser and
      the filesystem in Node behind one interface
- [ ] **DATA-03**: Data carries a sovereignty label that travels with it and acts
      as a hard scheduling constraint
- [ ] **DATA-04**: A sovereignty-pinned task executes only within the owner's own
      node set — the scheduler cannot relocate it outside that set to balance load
- [ ] **DATA-05**: A stream-tap test fails if raw sovereign bytes cross the network
      boundary
- [ ] **DATA-06**: Every job emits an egress manifest recording exactly what left
      each owner's node
- [ ] **DATA-07**: Filters, projections, and partial aggregation push down to the
      owner's node so the least data leaves
- [ ] **DATA-08**: Artifact `key → CID` mappings are signed by a trusted build
      authority and never resolved by CID alone
- [ ] **DATA-09**: Backbone encrypted replicas serve availability only and are
      never execution-eligible for sovereign tasks — executing requires
      decryption, which would expose plaintext to a non-owner node

### Authorization & Node Identity

- [ ] **AUTH-01**: A node's identity key is generated on-device and its public half
      is signed into a provider-issued certificate
- [ ] **AUTH-02**: A node verifies a peer's provider-signed certificate offline,
      with no live certificate authority
- [ ] **AUTH-03**: A task carries a delegatable, expiry-scoped capability chain
      rooted at the data owner's key, verified before execution
- [ ] **AUTH-04**: Enrollment is provider-gated and rate-limited, so mass fake-node
      creation is costly
- [ ] **AUTH-05**: Multiple node identity certificates chain to a single owner's
      user key, forming a discoverable replica set that the scheduler can target

### Transport, Discovery & Connectivity

- [ ] **NET-01**: Two Node.js processes discover each other and exchange tasks over
      a real network transport
- [ ] **NET-02**: Two browser tabs connect to each other via WebRTC using a
      Circuit Relay v2 peer for SDP signaling
- [ ] **NET-03**: A backbone relay node auto-acquires a TLS certificate and accepts
      browser reservations without manual certificate management
- [ ] **NET-04**: Relayed protocol handlers register with `runOnLimitedConnection`,
      and no hardcoded certhash multiaddr is required to join
- [ ] **NET-05**: Relay reservation exhaustion is detected and reported rather than
      failing silently
- [ ] **NET-06**: Backbone nodes serve DHT records on behalf of browser peers,
      which run client-mode only
- [ ] **NET-07**: A constants-regression test asserts the relay and transport
      limits the system depends on, failing CI when an upgrade changes them

### Scheduling & Placement

- [ ] **SCHED-01**: A requestor discovers candidate nodes by querying providers of
      a data CID intersected with required capability records
- [ ] **SCHED-02**: Placement samples d candidate nodes and selects the
      least-loaded, using local information only
- [ ] **SCHED-03**: An over-committed node rejects work and the requestor re-picks
- [ ] **SCHED-04**: A resource governor caps node CPU by duty cycle, is
      user-adjustable, and is honoured by the executor
- [ ] **SCHED-05**: Sovereignty constraints override placement cost heuristics

### Map / Reduce

- [ ] **MR-01**: A job partitions into N shards, each executing independently, with
      a partition index and count available to the task
- [ ] **MR-02**: Each owner computes a local partial over its own data with no
      map-side data movement
- [ ] **MR-03**: Partials merge up a hierarchical tree via an associative,
      commutative combine
- [ ] **MR-04**: The reduce tree is derived deterministically from sorted partial
      CIDs, so every participant computes an identical tree with no consensus
- [ ] **MR-05**: Combine executors are assigned by rendezvous hashing, yielding a
      ranked fallback list
- [ ] **MR-06**: A combine lost to churn is recomputed elsewhere from its
      content-addressed inputs, with no state migration
- [ ] **MR-07**: A duplicate combine result is discarded harmlessly because it
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
- [ ] **BROW-03**: Compute pauses or throttles when the tab is backgrounded, and
      resumes on return
- [ ] **BROW-04**: A visitor can see what the node is doing and stop it at any time
- [ ] **BROW-05**: The node runs embedded in a third-party page without requiring
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
| DET-03 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DET-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| DET-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| DET-07 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| VER-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| VER-02 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| VER-03 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| VER-04 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| VER-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| VER-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| VER-08 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| VER-09 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| VER-10 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| DATA-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| DATA-02 | Phase 3 — Browser Tier & Backbone Relay | Pending |
| DATA-03 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DATA-04 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DATA-05 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DATA-06 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DATA-07 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DATA-08 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| DATA-09 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| AUTH-01 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| AUTH-02 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| AUTH-03 | Phase 4 — Sovereignty, Authorization & Artifact Signing | Pending |
| AUTH-04 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| AUTH-05 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| NET-01 | Phase 2 — Real Network, Node ↔ Node | Pending |
| NET-02 | Phase 3 — Browser Tier & Backbone Relay | Pending |
| NET-03 | Phase 3 — Browser Tier & Backbone Relay | Pending |
| NET-04 | Phase 3 — Browser Tier & Backbone Relay | Pending |
| NET-05 | Phase 3 — Browser Tier & Backbone Relay | Pending |
| NET-06 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| NET-07 | Phase 2 — Real Network, Node ↔ Node | Pending |
| SCHED-01 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| SCHED-02 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| SCHED-03 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| SCHED-04 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| SCHED-05 | Phase 6 — Discovery, Placement & Enrollment | Pending |
| MR-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Pending |
| MR-02 | Phase 5 — Decomposable Tree-Reduce | Pending |
| MR-03 | Phase 5 — Decomposable Tree-Reduce | Pending |
| MR-04 | Phase 5 — Decomposable Tree-Reduce | Pending |
| MR-05 | Phase 5 — Decomposable Tree-Reduce | Pending |
| MR-06 | Phase 5 — Decomposable Tree-Reduce | Pending |
| MR-07 | Phase 5 — Decomposable Tree-Reduce | Pending |
| CHURN-01 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-02 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-03 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-04 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-05 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| CHURN-06 | Phase 7 — Churn, Stragglers & Coordinator Survival | Pending |
| BROW-01 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| BROW-02 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| BROW-03 | Phase 3 — Browser Tier & Backbone Relay | Pending |
| BROW-04 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Pending |
| BROW-05 | Phase 3 — Browser Tier & Backbone Relay | Pending |
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
