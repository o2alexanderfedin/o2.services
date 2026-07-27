# Requirements — o2.services P2P Native Cloud (v1)

**Derived from:** `docs/p2p-native-cloud-design.md`, `.planning/PROJECT.md`,
`.planning/research/SUMMARY.md`
**Scope decision:** full design in v1, with Part I (elfconv AOT) sequenced last
**Defined:** 2026-07-24
**Ledger corrected:** 2026-07-27 — see below
**Milestone v1.1 scoped:** 2026-07-27 — see [v1.1 Requirements](#v11-requirements--wire-what-was-built)

---

## How to read the checkboxes

**32 of 72 are `[x]`.** That is down from 68, and the 36 that moved did **not** move
because the work was undone. Read this before drawing a conclusion from the count.

The v1.0 milestone audit (`v1.0-MILESTONE-AUDIT.md`) traced every requirement from the
five runnable entry points — `bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`,
`tools/aot/cli.ts`, and the demo page — to the mechanism meant to satisfy it. For 36
requirements the trace does not arrive. Sovereignty labelling, tree-reduce, discovery,
enrollment, quorum composition, capability chains and the entire churn coordinator are
**implemented, exported, and covered by their own specs** — and no path a person can
run reaches any of them.

So the ledger now distinguishes three states:

| Marker | Means |
|---|---|
| `[x]` | Delivered on a path reachable from a runnable entry point |
| `[ ]` + **Built, not wired** | Mechanism exists and is unit-verified; nothing calls it |
| `[ ]` + **Partial** | One leg reaches production, another does not |

The traceability table at the bottom carries the specific reason for each, naming the
symbol that proves it — `runResilient` has no caller, `EgressGuard` decorates no
production transport, `RemoteExecutor` sends no capability field, and so on.

**Why the checkbox rather than only the table.** A requirement is a claim about what
the system does. "The placer cannot relocate a sovereign task" is true of a placer no
job runs through, and a `[x]` next to it would be the project's own recorded
anti-pattern — *a documented bound that is not enforced* — written into the ledger
itself. The work is real and the table says so; the box tracks delivery.

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
- [ ] **VER-03**: At least one replica of every verification quorum is anchored on
      a backbone node, so eclipsing a quorum requires a backbone compromise
- [ ] **VER-04**: Quorum members are selected with anti-affinity, so one operator
      cannot supply a whole quorum
- [x] **VER-05**: The verifier compares `(task, outputs)` only — timing, fuel, and
      node metadata sit outside the signed digest
- [x] **VER-06**: Redundancy factor is a per-job dial reaching 1 (off), and the
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

- [x] **DATA-01**: Task inputs, outputs, and intermediates are content-addressed
      and retrievable by CID
- [x] **DATA-02**: A blockstore adapter works against IndexedDB in the browser and
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
- [ ] **NET-06**: Browser peers participate in routing as full peers. Backbone nodes
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

- [ ] **SCHED-01**: A requestor discovers candidate nodes by querying providers of
      a data CID intersected with required capability records
- [ ] **SCHED-02**: Placement samples d candidate nodes and selects the
      least-loaded, using local information only
- [ ] **SCHED-03**: An over-committed node rejects work and the requestor re-picks
- [x] **SCHED-04**: A resource governor caps node CPU by duty cycle, is
      user-adjustable, and is honoured by the executor
- [ ] **SCHED-05**: Sovereignty constraints override placement cost heuristics

### Map / Reduce

- [x] **MR-01**: A job partitions into N shards, each executing independently, with
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

- [x] **BROW-01**: A visitor gives explicit informed consent before any compute
      begins
- [x] **BROW-02**: The node reports the percentage of visitors where it failed to
      start, segmented by browser, so blocking is visible rather than silent
- [x] **BROW-03**: Compute pauses or throttles when the tab is backgrounded, and
      resumes on return
- [x] **BROW-04**: A visitor can see what the node is doing and stop it at any time
- [x] **BROW-05**: The node runs embedded in a third-party page without requiring
      COOP/COEP headers

### Benchmark & Proof

- [x] **BENCH-01**: A benchmark harness measures job makespan against participating
      node count, reproducibly
- [x] **BENCH-02**: Benchmark methodology is pre-registered and committed before
      the first published number
- [x] **BENCH-03**: Published results report p99 makespan, not mean
- [x] **BENCH-04**: The verification tax is included in reported cost, never
      excluded
- [x] **BENCH-05**: A COST crossover is published — the node count at which the
      system beats a competent single-threaded implementation
- [ ] **BENCH-06**: Benchmarks run across distinct machines, and any same-machine
      measurement is labelled as such

### Demo & Disclosure

- [x] **DEMO-01**: A static client distributes a real job across browser tabs and
      machines, showing live placement and results
      *(tabs: e2e. Machines: run by the owner on 2026-07-26 — an iPhone and a laptop
      on one LAN seed, one peer connected, the search distributed, and the answer
      verified in the page. Owner-observed, not captured by a test; two defects it
      exposed are fixed and now are.)*
- [x] **DEMO-02**: The demo runs a task a person cares about, not a synthetic
      protocol exercise
- [x] **DEMO-03**: The demo is deployable to static hosting with no server-side
      process beyond the backbone relay
- [x] **DEMO-04**: Public deployment is an explicitly triggered action, never an
      automatic consequence of a phase completing

### Native → WASM AOT (Part I)

- [x] **AOT-01**: A statically-linked AArch64 binary translates to a `.wasm`
      artifact via the elfconv pipeline — and the driver refuses to trust the
      toolchain's exit code, which is `0` on a binary leaving 174 addresses
      untranslated. Verdict `reservations`, exit 2
- [ ] **AOT-02**: Translated artifacts are content-addressed with a cache key
      covering input digest, toolchain versions, target, and WASM feature set;
      pinned to a hardcoded conformance CID, and the image is keyed by digest so a
      re-tagged local image is refused rather than hashed under a borrowed name
- [ ] **AOT-03**: Translation is reproducible — identical inputs yield an identical
      CID. **Same-host only.** Two lifts here are byte-identical; cross-machine is
      unmeasured and carried as a structural blind spot, because elfconv's
      register promotion iterates pointer-keyed containers. Needs a second machine
- [x] **AOT-04**: A translated artifact executes on the fabric under the same
      admission checks and verification as a source-compiled one — proved through
      the `@o2/aot` barrel, and the ABI verified against a real elfconv artifact
      rather than against fixtures written to match the assumption
- [ ] **AOT-05**: Browser artifact loading uses `compileStreaming` against a stable
      gateway URL so V8 code caching applies. **Loading done; caching does not
      happen.** No WASM code-cache entry at 4.8 MB over three visits, while the
      same profile caches 2 MB of JavaScript. Published as a measured negative
      with two controls, not deferred

---

## v1.1 Requirements — Wire What Was Built

**Defined:** 2026-07-27, directly from `v1.0-MILESTONE-AUDIT.md`.

**v1.1 mints almost no new requirement IDs, and that is deliberate.** The 36 entries
marked *Built, not wired* above are not missing requirements — they are the same
requirements, unsatisfied. "The placer cannot relocate a sovereign task" is DATA-03
whether or not a job runs through that placer; wiring it is what makes DATA-03 true.
Minting `WIRE-05: wire the sovereignty gate` alongside it would count one obligation
twice and let the ledger reach 100% while saying less than it does now.

So the milestone's scope is **the existing IDs**, and the four new ones below cover only
what has no v1 equivalent: the structural cause, the guard that would have caught it,
and the two end-to-end paths nothing exercises.

### In scope — existing IDs to be wired (40)

| Origin phase | Requirements | The wire that connects them |
|---|---|---|
| 4 — Sovereignty | DET-03, DATA-03…DATA-09, AUTH-03 | an owner label in `JobSpec`/`Task`; the real job path through the sovereignty gate; `EgressGuard` on both transports; `signName` resolution; a capability chain on both ends of dispatch |
| 5 — Tree-reduce | MR-02 … MR-07 | `executeReduce` on the aggregation path, replacing the demo's linear scan |
| 6 — Discovery & enrollment | AUTH-01, AUTH-02, AUTH-04, AUTH-05, SCHED-01, SCHED-02, SCHED-03, SCHED-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10 | `serveAgent`'s `index` and `capacity` hooks supplied; `discoverExecutors` replacing the static list; `requestEnrollment` issuing a real node identity; `composeQuorum` and `attestationReceipt` on the verification path |
| 7 — Churn | CHURN-01 … CHURN-06 | one job entry point that leases, speculates and accounts for coverage |
| 10 — AOT | AOT-02 | `translationCid` called by the lift pipeline; the CLI emitting the CID |
| Partials | NET-05, SCHED-04, BROW-02, AOT-04 | `ReservationWatcher` installed; the governor on both tiers and runtime-adjustable; a ledger that is actually supplied; a production node able to construct a `WasiExecutor` |

Each row's evidence — the symbol with no caller, at `file:line` — is in the traceability
table below and in the audit.

### Wiring Integrity (new IDs)

- [x] **WIRE-01**: Every `serveAgent` call site states a value for all six hooks. A node
      that serves without an authorizer, an index, a capacity source, a ledger, a
      reservation thunk or a dispatch callback does so because someone recorded that
      decision — not because an argument was left off. **Omitting one is a compile
      error, not a default.** This is the structural cause of the other 35 and is
      sequenced first, so the rest surface as build failures rather than as an audit
      finding a year later
- [ ] **WIRE-02**: A guard test fails when a capability exported from a package barrel
      has no call path from any runnable entry point, so v1.0's finding cannot recur
      silently. Same role `purity.node.test.ts` plays for layering: the audit found this
      class of defect and **no test could have**
- [ ] **WIRE-03**: Two browser tabs served a static bundle — no seed process, no
      `/bootstrap.json`, nothing dialled by the harness — discover each other and
      complete a job. The browser-tier equivalent of the rendezvous defect already fixed
      one tier down, and the one route with no end-to-end coverage
- [ ] **WIRE-04**: The fabric has exactly one job entry point. Submitting a job gets
      lease renewal, speculation and coverage accounting without the caller choosing
      between two functions — today `runResilient` is a second job implementation that
      nothing calls

### Explicitly not in v1.1

| Requirement | Why it stays open |
|---|---|
| **NET-03** — real AutoTLS | Needs a publicly reachable host. Outward-facing and a hosting decision, not a code one |
| **BENCH-06** — distinct-machine benchmarks | Needs a second machine |
| **AOT-03** — cross-machine reproducible CID | **The same** second machine. BENCH-06 and AOT-03 are one blocker wearing two numbers |
| **AOT-05** — V8 code-cache hit | Not blocked on anything. It was measured with two controls and the answer is no. Re-running it against an `https` origin and a non-automated Chromium is worth doing, but it stays a negative until that says otherwise |

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

All 72 v1 requirements are mapped, each to exactly one phase, plus the 4 v1.1-only
WIRE requirements below. See `.planning/ROADMAP.md` for phase goals and success
criteria.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DET-03 | Phase 14 — Signed Artifact Resolution | **Built, not wired** — signName / SignedNameResolver have no caller; every module resolves by bare CID |
| DET-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DET-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DET-07 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-02 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-03 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — composeQuorum has no caller outside its own spec |
| VER-04 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — composeQuorum has no caller outside its own spec |
| VER-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-08 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — attestationReceipt is called only by itself and its spec; no node emits a receipt |
| VER-09 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — attestationReceipt is called only by itself and its spec; no node emits a receipt |
| VER-10 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — attestationReceipt is called only by itself and its spec; no node emits a receipt |
| DATA-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DATA-02 | Phase 3 — Browser Tier & Backbone Relay | Done |
| DATA-03 | Phase 12 — Sovereignty-Pinned Placement | **Built, not wired** — no owner label exists in JobSpec or Task; eligibleNodes is reachable only through runResilient, which has no caller |
| DATA-04 | Phase 12 — Sovereignty-Pinned Placement | **Built, not wired** — no owner label exists in JobSpec or Task; eligibleNodes is reachable only through runResilient, which has no caller |
| DATA-05 | Phase 13 — Egress Manifest Completeness | **Built, not wired** — EgressGuard decorates no production transport — both nodes pass the raw Libp2pTransport |
| DATA-06 | Phase 13 — Egress Manifest Completeness | **Built, not wired** — EgressGuard decorates no production transport — both nodes pass the raw Libp2pTransport |
| DATA-07 | Phase 12 — Sovereignty-Pinned Placement | **Built, not wired** — pushdown lives in the reduce tree; executeReduce has no caller |
| DATA-08 | Phase 14 — Signed Artifact Resolution | **Built, not wired** — signName / SignedNameResolver have no caller; every module resolves by bare CID |
| DATA-09 | Phase 12 — Sovereignty-Pinned Placement | **Built, not wired** — no owner label exists in JobSpec or Task; eligibleNodes is reachable only through runResilient, which has no caller |
| AUTH-01 | Phase 17 — Node Identity & Enrollment | **Built, not wired** — requestEnrollment / EnrollmentAuthority have no production caller; a node identity is the raw libp2p peerId |
| AUTH-02 | Phase 17 — Node Identity & Enrollment | **Built, not wired** — verifyCertificate is reachable only through discoverExecutors, which has no caller |
| AUTH-03 | Phase 15 — Capability-Chained Dispatch | **Built, not wired** — RemoteExecutor sends no capability field and no node installs an authorizer — both ends missing |
| AUTH-04 | Phase 17 — Node Identity & Enrollment | **Built, not wired** — requestEnrollment / EnrollmentAuthority have no production caller |
| AUTH-05 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — resolveReplicaSets has no production caller |
| NET-01 | Phase 2 — Real Network, Node ↔ Node | Done |
| NET-02 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-03 | Phase 3 — Browser Tier & Backbone Relay | Partial — relay is browser-dialable; AutoTLS needs a public host |
| NET-04 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-05 | Phase 18 — Discovery, Capacity & Placement | **Partial** — the reading half is wired (capacity is derived from the live store and printed by the seed); ReservationWatcher is installed by no process, so a refused joiner gets no named error |
| NET-06 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — no node supplies serveAgent’s `index` hook, so none serves a record |
| NET-07 | Phase 2 — Real Network, Node ↔ Node | Done |
| SCHED-01 | Phase 18 — Discovery, Capacity & Placement | **Built, not wired** — discoverExecutors has no caller outside tests |
| SCHED-02 | Phase 18 — Discovery, Capacity & Placement | **Built, not wired** — placeWithOffers is reachable only through runResilient, which has no caller |
| SCHED-03 | Phase 18 — Discovery, Capacity & Placement | **Built, not wired** — no node supplies serveAgent’s `capacity` hook, so every offer is accepted |
| SCHED-04 | Phase 18 — Discovery, Capacity & Placement | **Partial** — GovernedExecutor is wired on the browser tier only — FabricNode builds a bare WasmExecutor — and the duty cycle is readonly on both, so "user-adjustable" is unmet |
| SCHED-05 | Phase 18 — Discovery, Capacity & Placement | **Built, not wired** — the sovereignty gate runs inside placeWithOffers, reachable only through runResilient |
| MR-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| MR-02 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — executeReduce / deriveReduceTree have no caller; the demo merges with a linear scan |
| MR-03 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — executeReduce / deriveReduceTree have no caller; the demo merges with a linear scan |
| MR-04 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — executeReduce / deriveReduceTree have no caller; the demo merges with a linear scan |
| MR-05 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — executeReduce / deriveReduceTree have no caller; the demo merges with a linear scan |
| MR-06 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — executeReduce / deriveReduceTree have no caller; the demo merges with a linear scan |
| MR-07 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — executeReduce / deriveReduceTree have no caller; the demo merges with a linear scan |
| CHURN-01 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Built, not wired** — runResilient has no caller; submitJob is the only job path and does not speculate or re-dispatch |
| CHURN-02 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Built, not wired** — runResilient has no caller; submitJob is the only job path and does not speculate or re-dispatch |
| CHURN-03 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Built, not wired** — checkpoint.ts is not even imported by coordinator.ts, and runResilient itself has no caller |
| CHURN-04 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Built, not wired** — runResilient has no caller; submitJob is the only job path and does not speculate or re-dispatch |
| CHURN-05 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Built, not wired** — runResilient has no caller; submitJob is the only job path and does not speculate or re-dispatch |
| CHURN-06 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Built, not wired** — runResilient has no caller; submitJob is the only job path and does not speculate or re-dispatch |
| BROW-01 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| BROW-02 | Phase 20 — Single Job Path, Ledger & Churn Resilience | **Partial** — the local ledger renders; the cross-node merge is a no-op because no node supplies serveAgent’s `ledger` hook, so every peer answers with empty counts |
| BROW-03 | Phase 3 — Browser Tier & Backbone Relay | Done |
| BROW-04 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| BROW-05 | Phase 3 — Browser Tier & Backbone Relay | Done |
| BENCH-01 | Phase 8 — Benchmark Harness | Done |
| BENCH-02 | Phase 8 — Benchmark Harness | Done |
| BENCH-03 | Phase 8 — Benchmark Harness | Done |
| BENCH-04 | Phase 8 — Benchmark Harness | Done |
| BENCH-05 | Phase 8 — Benchmark Harness | Done |
| BENCH-06 | Phase 8 — Benchmark Harness | Partial — same-machine labelling enforced and derived; distinct-machine runs need a second machine |
| DEMO-01 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| DEMO-02 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| DEMO-03 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| DEMO-04 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| AOT-01 | Phase 10 — elfconv AOT Native→WASM Pipeline | Done |
| AOT-02 | Phase 21 — AOT Translation Signing & Runtime | **Built, not wired** — translationCid is never called by the lift pipeline; the CLI emits no CID and builds no TranslationRecord |
| AOT-03 | Phase 10 — elfconv AOT Native→WASM Pipeline | Partial — same-host only; cross-machine needs a second machine |
| AOT-04 | Phase 21 — AOT Translation Signing & Runtime | **Partial** — port conformance is proved through the @o2/aot barrel; no production node constructs a WasiExecutor, so a translated artifact dispatched to a running node fails at instantiate |
| AOT-05 | Phase 10 — elfconv AOT Native→WASM Pipeline | **Partial** — loadArtifact is exported and e2e-measured, but the demo loads its kernel from bundled base64 — the loader is not on the page’s own module path |
| WIRE-01 | Phase 11 — Explicit serveAgent Hook Contract | Not started — new requirement, minted 2026-07-27 from the v1.0 audit's structural-cause finding |
| WIRE-02 | Phase 22 — Reachability Guard | Not started — new requirement, minted 2026-07-27 |
| WIRE-03 | Phase 19 — Quorum Composition & Owner-Domain Attestation | Not started — new requirement, minted 2026-07-27 |
| WIRE-04 | Phase 20 — Single Job Path, Ledger & Churn Resilience | Not started — new requirement, minted 2026-07-27 |

**Coverage: 76/76 mapped. No orphans, no duplicates.** (72 v1 + 4 v1.1-only WIRE
requirements. Of the 72, 40 are in v1.1 scope for wiring — see
`.planning/ROADMAP.md`'s "v1.1 — Wire What Was Built" coverage table; the remaining 32
are `Done`, and NET-03/BENCH-06/AOT-03/AOT-05 stay open, blocked on hardware/hosting or
a measured negative, explicitly excluded from v1.1.)
