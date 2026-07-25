# Roadmap: o2.services — P2P Native Cloud

## Overview

The journey runs from a working job to a published number. It opens with a complete
job — shard, execute redundantly, verify, return a result CID — running inside a single
process on all three targets, then the same job across two OS processes, then the same
job across two browser tabs on different machines. Only once that chain is proven does
the project add its differentiators, in the order that keeps each one honest: sovereignty
as a hard constraint *before* the scheduler learns to optimise, tree-reduce *before*
placement so a placement decision has something real to decide about, decentralized
discovery and enrollment *after* both, then churn survival, then benchmarks, then a demo
that is built but deliberately not deployed. The native→WASM AOT pipeline runs on a
separate track throughout and lands last, because it is a C++/LLVM build toolchain with
zero TypeScript coupling and it must not block the capacity-scaling thesis.

**Determinism is enforced at the serialization boundary, and detected — never
predicted.** Anything hashed or content-addressed is encoded with strict DAG-CBOR,
which forbids `NaN`, `Infinity`, and `-Infinity` outright and mandates a single
canonical form for `-0.0` and one float width. Protobuf bytes are never hashed.
Beyond that there is no static analysis of task modules: two nodes run the same
module, their outputs are compared byte for byte, and a mismatch is reported with
the dissenting node named. The sandbox needs no allow-list — a module importing
anything the host does not supply fails at `WebAssembly.instantiate`.

**Verification compares the same module run twice, not two implementations.**
Cross-implementation verification is out of scope. The claim is split by owner:
cross-operator redundancy applies to public/shared data and to the aggregation tree; sovereign maps run redundantly within the owner's own
node set when two or more of their nodes are live, and are owner-attested otherwise.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Portable Kernel & Loopback Map Slice** - A complete redundant, verified job runs end to end in one process, on node/browser/webworker, with no network involved
- [x] **Phase 2: Real Network, Node ↔ Node** - The same job runs across two OS processes over a real transport, proving the port boundary held
- [ ] **Phase 3: Browser Tier & Backbone Relay** - Two browser tabs on different machines run a distributed redundant job against a self-hosted backbone needing no certificate operations
- [ ] **Phase 4: Sovereignty, Authorization & Artifact Signing** - Owner-pinned data becomes a constraint the placer cannot relax, and every artifact resolves through a signed name
- [ ] **Phase 5: Decomposable Tree-Reduce** - Cross-owner aggregation merges up a derived tree with no shuffle, no consensus, and no state to migrate
- [ ] **Phase 6: Discovery, Placement & Enrollment** - The static peer list disappears; nodes find each other and choose placement under identity and diversity constraints
- [ ] **Phase 7: Churn, Stragglers & Coordinator Survival** - A job finishes correctly when the machines running it — including the submitter — vanish mid-flight
- [ ] **Phase 8: Benchmark Harness** - The scaling claim becomes a reproducible published number with its costs included rather than excluded
- [ ] **Phase 9: Public Demo, Consent UX & Disclosure Gate** - A visitor consents, contributes to a job someone cares about, and nothing publishes without a deliberate human action
- [ ] **Phase 10: elfconv AOT Native→WASM Pipeline** - A statically-linked native binary becomes a fabric-executable artifact under the same admission checks and verification

## Phase Details

### Phase 1: Portable Kernel & Loopback Map Slice
**Goal**: A complete job — shard, execute redundantly, verify, return a result CID — runs end to end inside one process on all three targets, with no networking whatsoever
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: DET-05, DET-06, DET-07, VER-01, VER-02, VER-05, VER-06, DATA-01, MR-01, SCHED-04
**Research**: Standard patterns — hexagonal architecture, dag-cbor schemas, Worker pools, and the compile-once/share-`Module` pattern are all documented and verified. Two decisions to settle in planning: aegir vs. vitest for the three-target discipline (the `webworker` target is non-negotiable either way), and the fuel-bounding decision (no maintained JS-side WASM metering tool exists — build vs. accept a Worker timeout)
**Success Criteria** (what must be TRUE):
  1. `submitJob` with 4 shards executed at R=2 over an in-memory transport returns a result CID; the verifier reports agreement with the contributing node IDs, and injecting one divergent executor surfaces the disagreement with its dissenting node ID rather than majority-voting it away
  2. Task inputs, outputs, and intermediates are content-addressed and retrievable by CID; the task reads its partition index and count from the narrow host ABI, and each shard executes independently
  3. Every task runs inside a Worker against exactly four host functions, and a module importing anything else — a clock, an RNG, a WASI function — fails at instantiation with the offending import named by the runtime; nothing ever executes on the main thread
  4. The identical task-execution test suite passes under `node`, `browser`, and `webworker` targets with no target-specific branches in the kernel source
  5. Redundancy is a per-job dial that reaches 1 (off); receipts are commit-then-reveal so a replica cannot plagiarize a peer's answer; the compared digest covers `(task, outputs)` only — a receipt whose timing or fuel differs still verifies — and every completed job reports gross vs. useful node-seconds with the verification multiplier as a measured cost
  6. A user-set CPU duty-cycle cap is honoured by the executor with measured CPU staying under it, and the node's advertised capacity drops accordingly
**Plans**: TBD

### Phase 2: Real Network, Node ↔ Node
**Goal**: The same job runs across two real operating-system processes over a real network transport, proving the port boundary was drawn in the right place
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: NET-01, NET-07
**Research**: Standard patterns — the exact compatible libp2p module set is published in libp2p's own integration tests, and the TCP/noise/yamux path is the most-trodden in the ecosystem
**Success Criteria** (what must be TRUE):
  1. Two Node.js processes discover each other and complete a 2×-redundant map job over a real transport, with blocks exchanged on the wire — and the kernel package is byte-for-byte unchanged from Phase 1, because only an adapter was swapped
  2. Results written by one process persist to a filesystem blockstore and are retrievable by CID from the other process, and survive a restart
  3. A constants-regression test asserts every relay and transport limit the system depends on — 15 concurrent reservations, 2-minute duration, 128 KiB data, 16 KiB WebRTC message — and fails CI when a dependency upgrade changes any of them; every libp2p dependency is pinned to an exact version with no range specifier
**Plans**: complete — see `phases/phase-2-real-network/SUMMARY.md`

### Phase 3: Browser Tier & Backbone Relay
**Goal**: Two browser tabs on different machines run a distributed, redundant job against a self-hosted backbone that requires no manual certificate operations — the project's core bet, demonstrated
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: NET-02, NET-03, NET-04, NET-05, DATA-02, BROW-03, BROW-05
**Research**: Needed — Safari + WebRTC-Direct support is unverified from any authoritative source (fallback branch: Safari = WSS-only); no credible published throughput figures exist for js-libp2p WebRTC at N>50 browser peers; real relay capacity under partial-result traffic is unmeasured. Playwright `webkit` in CI from day one is the mitigation
**Success Criteria** (what must be TRUE):
  1. Two browser tabs on different machines connect over WebRTC using a self-hosted Circuit Relay v2 peer for SDP signaling, complete a 2×-redundant map job, and agree on the result
  2. The backbone relay auto-acquires its TLS certificate and presents a browser-dialable address with zero certificate operations; no `/certhash/` literal appears anywhere in source and bootstrap addresses resolve at runtime, so a demo recorded today still joins fourteen days later
  3. Sixteen or more browser peers reserve simultaneously against the tuned relay and hold for over an hour under churn; every registered protocol negotiates over `p2p-circuit` because it is registered with `runOnLimitedConnection` on both handle and dial; and relayed byte counters stay in single-digit KiB per peer, proving the relay carries signaling only
  4. A relay at reservation capacity reports exhaustion by name to the joining node and to its own metrics, instead of failing in a way indistinguishable from a network outage
  5. Blocks written from a browser persist to IndexedDB and from Node to the filesystem behind one unchanged blockstore interface, with the same CIDs on both sides
  6. The node runs embedded in a third-party page served without COOP/COEP headers, throttles within a second of the tab being backgrounded, and resumes on return without losing its job
**Plans**: TBD

### Phase 4: Sovereignty, Authorization & Artifact Signing
**Goal**: Owner-pinned data becomes a hard scheduling constraint the placer has no code path to relax, and every artifact the fabric executes is resolved through a signed name rather than a bare CID
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DET-03, AUTH-03
**Research**: Standard patterns, with one bounded investigation — UCAN vs. SPKI capability-chain library selection and its expiry/delegation semantics. The C3 structural conflict (sovereignty vs. redundant execution) is already resolved by a logged decision: verify the reduce, not the sovereign map. Do not re-open it
**Success Criteria** (what must be TRUE):
  1. A sovereignty label travels with its data and pins its map task to the owner's node; a test that applies artificial load pressure specifically to force relocation fails to move it, because the placement planner has no branch that can
  2. A stream tap on the owner node's network interface fails the test if a single raw sovereign byte crosses it during a cross-owner job — filters, projections, and partial aggregation have pushed down to the owner, so only the aggregate leaves
  3. Every job emits an owner-signed egress manifest recording exactly what left each owner's node, with byte counts, and the manifest is complete by construction rather than by audit
  4. A task arriving without a valid, unexpired capability chain rooted at the data owner's key is refused before the module is instantiated, and the refusal names the missing link
  5. Artifacts resolve only through signed `key → CID` mappings validated against pinned trust anchors — an unsigned mapping, or one signed by an untrusted key, is refused — because content addressing proves integrity, not provenance
  6. A backbone-held encrypted replica of sovereign data satisfies availability queries but is refused as an execution target — the placer will not dispatch a sovereign task to it, because executing would require handing a non-owner node the decryption key
**Plans**: TBD

### Phase 5: Decomposable Tree-Reduce
**Goal**: Cross-owner aggregation happens up a hierarchical tree that every participant derives identically — no all-to-all shuffle, no consensus, no leader election, and no state to migrate when an aggregator disappears
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: MR-02, MR-03, MR-04, MR-05, MR-06, MR-07
**Research**: Needed — the HRW-assigned, CID-derived reduce tree with pure-recompute repair is a synthesis, not a copy of any shipped system. Every ingredient is standard; the combination is not, and nobody in the category exposes a reduce at all
**Success Criteria** (what must be TRUE):
  1. Eight or more nodes each compute a local partial over their own data with no map-side data movement, and the aggregate merged up the tree is bit-identical to a single-node reference computation of the same job
  2. Every participant independently derives the same reduce tree from the sorted partial CIDs with no message exchanged to agree on topology; changing one partial changes the derived tree deterministically for everyone at once
  3. Combine executors are assigned by rendezvous hashing, and each assignment yields a ranked fallback list, so the next executor is known locally without a lookup
  4. Killing an aggregator mid-combine causes its combine to be recomputed elsewhere purely from its content-addressed inputs with no state transferred, and a late duplicate result arriving afterwards is discarded harmlessly because it carries the same CID
  5. Reduce partials stay inside a tested single-digit-KiB size budget so the browser mesh can carry them, and combines execute redundantly — so the aggregation over owner-attested sovereign partials is verified even though the sovereign maps themselves are not
**Plans**: TBD

Notes: Browsers are leaves in v1. Internal combine nodes are placed on backbone peers
only, because background-tab timer throttling (≥1 minute) would falsely kill any lease
short enough to be useful.

### Phase 6: Discovery, Placement & Enrollment
**Goal**: The static peer list the previous phases leaned on disappears — nodes find each other and decide where work runs from local information, under identity and diversity constraints that make a forged quorum expensive
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-05, NET-06, AUTH-01, AUTH-02, AUTH-04, AUTH-05, VER-03, VER-04, VER-08, VER-09, VER-10
**Research**: Needed — S/Kademlia disjoint-path lookups are not implemented in js-libp2p, so sybil/eclipse resistance is build-not-configure; `@libp2p/pubsub-peer-discovery` is unverified against `@libp2p/interface@^3` and libp2p's own docs call pubsub discovery not production-fit (hardening path: a custom `/o2/rendezvous/1.0.0` on the backbone); enrollment design touches the PROJECT.md scope boundary and needs its own sizing
**Success Criteria** (what must be TRUE):
  1. A requestor with no static peer list finds candidate executors by intersecting the providers of a data CID with signed capability records, and dispatches successfully — while browser peers, running kad-dht in client mode only, resolve the same records through backbone-served delegated routing
  2. Placement samples d candidates (d=2..4) and selects the least-loaded using local information only; an over-committed node rejects the offer with a stated reason and the requestor re-picks without the job failing
  3. Under artificial load pressure that would otherwise relocate it, a sovereignty-pinned task still lands on its owner — placement cost heuristics are evaluated as a filter after the constraint, never as a score that can outweigh it
  4. A node generates its identity key on-device and receives a provider-signed certificate through a rate-limited enrollment flow; a peer verifies that certificate offline with no call to any live certificate authority, and mass fake-node creation is measurably costly
  5. Every verification quorum contains at least one backbone-anchored replica and no two replicas supplied by the same operator; a test that attempts to fill a whole quorum from one operator's nodes is refused, and a threat model naming "attacker controls up to k of n" is committed with k stated
  6. Several node certificates chaining to one owner's user key resolve as a single discoverable replica set; a sovereignty-pinned task with two or more of that owner's nodes live executes on two of them and the outputs are compared, with a stream tap confirming no data left the owner's trust domain
  7. The same task with only one of the owner's nodes live executes once and its receipt reads owner-attested, not verified — and an owner-domain agreement is labelled distinctly from an independent-operator agreement everywhere it surfaces, so a reader cannot mistake the weaker claim for the stronger one
**Plans**: TBD

### Phase 7: Churn, Stragglers & Coordinator Survival
**Goal**: A job finishes correctly when the machines running it — including the machine that submitted it — go away mid-flight
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: CHURN-01, CHURN-02, CHURN-03, CHURN-04, CHURN-05, CHURN-06
**Research**: Needed — tree-reduce robustness under aggregation-backbone churn is one of the design doc's three named research risks and has no shipped prior art to copy
**Success Criteria** (what must be TRUE):
  1. Killing 30% of participating nodes mid-execution still produces the correct final aggregate, with the re-dispatches visible in the job history rather than hidden
  2. A task whose lease expires is re-dispatched automatically, and the original worker self-terminates on expiry and releases whatever it has to content-addressed storage rather than writing a stale result
  3. A straggler is duplicated speculatively under a global speculation budget and the first result wins; the loser is discarded harmlessly, and the speculation multiplier appears in the job's cost accounting
  4. Closing the requestor's browser tab mid-job either resumes the job from coordinator state checkpointed as a content-addressed block, or fails cleanly with recoverable partials — never orphaned leases and never a silently abandoned job
  5. A cross-owner job over owners that are partly offline returns a coverage report (`covered: X/Y owners`) alongside the aggregate, so a partial number is never presented as a complete one
  6. Speculative duplication of a sovereign task selects only from that owner's own node set; a test asserting a sovereign speculative duplicate never reaches another owner's node passes, so the straggler fix cannot quietly breach the sovereignty constraint
**Plans**: TBD

### Phase 8: Benchmark Harness
**Goal**: The scaling claim becomes a reproducible published number with its costs included rather than excluded — a separate and harder claim than "it works"
**Mode:** mvp
**Depends on**: Phase 5 (dispatch API frozen). Runs in parallel with Phases 6-7
**Requirements**: BENCH-01, BENCH-02, BENCH-03, BENCH-04, BENCH-05, BENCH-06
**Research**: Standard patterns — `@libp2p/perf` is a specified cross-implementation protocol so numbers compare to published go/rust-libp2p figures, and the methodology is pre-registered here, before any number exists
**Success Criteria** (what must be TRUE):
  1. The harness measures job makespan against participating node count reproducibly, over both the in-memory transport and the real transport — and the gap between the two curves is reported as the connectivity tax
  2. Published results report p50/p95/p99 makespan and never a bare mean, with the raw data and the harness itself published alongside so a third party can re-run them
  3. Reported cost includes the verification tax as an explicit line item, with gross node-seconds and useful node-seconds both shown, never one without the other
  4. A COST crossover number is published — the node count at which the system beats a competent single-threaded implementation of the same job — even if that number is embarrassing, together with a skewed-data configuration and cold-vs-warm code-cache disclosure
  5. Every published run carries its machine inventory including relay and aggregator hardware, and any same-machine multi-tab measurement is labelled as such rather than counted as N nodes
**Plans**: TBD

### Phase 9: Public Demo, Consent UX & Disclosure Gate
**Goal**: A visitor opens a page, understands exactly what will run, chooses to allow it, and contributes to a job someone actually cares about — while publication remains a deliberate human action rather than a consequence of a phase completing
**Mode:** mvp
**Depends on**: Phase 7 and Phase 8
**Research**: Standard patterns — the consent-UX pattern set is fully documented by BOINC's shipped controls and the Coinhive post-mortems. It needs care and vocabulary discipline, not research
**Requirements**: DEMO-01, DEMO-02, DEMO-03, BROW-01, BROW-02, BROW-04, DEMO-04
**Success Criteria** (what must be TRUE):
  1. A static client distributes a real job across multiple browser tabs on multiple machines, showing live placement and results arriving
  2. The demo runs a task a person cares about the answer to, not a synthetic protocol exercise, and a visitor can check that the answer is right
  3. No CPU is consumed before the visitor gives explicit informed consent; a persistent, always-visible surface shows what is running and for whom, and one click provably drops CPU to zero
  4. The client reports the percentage of visitors where the node failed to start, segmented by browser, so a blocklist cliff shows up as a metric instead of as quietly missing capacity
  5. The demo builds and runs against static hosting with no server-side process beyond the backbone relay, and the repository contains no deploy workflow file at all — publishing requires a separately-triggered human action, because publishing forfeits EPO and China patent rights permanently
**Plans**: TBD
**UI hint**: yes

Notes: Vocabulary discipline is a hard constraint on this phase — no "mining",
"hashrate", "earn", "credits", or "tokens" anywhere in the UI or the repository. A
plain-language policy page written for a human blocklist reviewer, and pre-registered
appeal paths, ship with the demo.

### Phase 10: elfconv AOT Native→WASM Pipeline
**Goal**: A statically-linked native binary becomes a fabric-executable artifact under the same admission checks, signing, and verification as a source-compiled module
**Mode:** mvp
**Depends on**: Phase 4 (signed `key → CID` infrastructure). Fully parallelizable from Phase 3 onward — a C++/LLVM/Remill build-time toolchain in `tools/aot/` with zero TypeScript coupling
**Requirements**: AOT-01, AOT-02, AOT-03, AOT-04, AOT-05
**Research**: Needed — elfconv's real-world lift success rate, Binaryen `denan` behaviour on actual elfconv output, and the deterministic WASI-subset surface are all unverified against real artifacts
**Success Criteria** (what must be TRUE):
  1. A statically-linked, unstripped AArch64 binary translates to a `.wasm` artifact through the containerized elfconv toolchain, and an unsupported binary (indirect or computed jumps, dynamic linking, wrong architecture) is refused by a compatibility checker with a named reason rather than producing a silently wrong artifact
  2. Translating the same input twice on different machines yields an identical CID, and the cache key demonstrably covers input digest, toolchain versions, target, and WASM feature set — changing any one of them changes the CID
  3. A translated artifact carries the same signed `key → CID` mapping and is verified by the same redundant-execution path as a source-compiled module — the native path cannot ship unsigned because the infrastructure to ship it unsigned does not exist
  4. A browser loads a translated artifact via `compileStreaming` against a stable gateway URL, and a second visit measurably hits the V8 code cache
**Plans**: TBD

Notes: Constraints recorded before any artifact is compiled, because retrofitting them
is a recompile of everything — `TARGET=aarch64-wasi32` (not the Emscripten bundle,
which emits JS glue and splits the ABI); no `-pthread` in any edge artifact; AArch64
static unstripped input only.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

Parallel tracks (config `parallelization: true`):
- Phase 9 (benchmark) runs alongside Phases 7-8 against the dispatch API frozen in Phase 6
- Phase 11 (elfconv AOT) runs alongside everything from Phase 4 onward; it only needs Phase 5's signing infrastructure to land before its own exit

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Portable Kernel & Loopback Map Slice | 0/TBD | Not started | - |
| 2. Real Network, Node ↔ Node | 0/TBD | Not started | - |
| 3. Browser Tier & Backbone Relay | 0/TBD | Not started | - |
| 4. Sovereignty, Authorization & Artifact Signing | 0/TBD | Not started | - |
| 5. Decomposable Tree-Reduce | 0/TBD | Not started | - |
| 6. Discovery, Placement & Enrollment | 0/TBD | Not started | - |
| 7. Churn, Stragglers & Coordinator Survival | 0/TBD | Not started | - |
| 8. Benchmark Harness | 0/TBD | Not started | - |
| 9. Public Demo, Consent UX & Disclosure Gate | 0/TBD | Not started | - |
| 10. elfconv AOT Native→WASM Pipeline | 0/TBD | Not started | - |

## Requirement Coverage

72 of 72 v1 requirements mapped, each to exactly one phase.

| Phase | Requirements | Count |
|-------|--------------|-------|
| 1 | DET-05, DET-06, DET-07, VER-01, VER-02, VER-05, VER-06, DATA-01, MR-01, SCHED-04 | 10 |
| 2 | NET-01, NET-07 | 2 |
| 3 | NET-02, NET-03, NET-04, NET-05, DATA-02, BROW-03, BROW-05 | 7 |
| 4 | DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DET-03, AUTH-03 | 9 |
| 5 | MR-02, MR-03, MR-04, MR-05, MR-06, MR-07 | 6 |
| 6 | SCHED-01, SCHED-02, SCHED-03, SCHED-05, NET-06, AUTH-01, AUTH-02, AUTH-04, AUTH-05, VER-03, VER-04, VER-08, VER-09, VER-10 | 14 |
| 7 | CHURN-01, CHURN-02, CHURN-03, CHURN-04, CHURN-05, CHURN-06 | 6 |
| 8 | BENCH-01, BENCH-02, BENCH-03, BENCH-04, BENCH-05, BENCH-06 | 6 |
| 9 | DEMO-01, DEMO-02, DEMO-03, DEMO-04, BROW-01, BROW-02, BROW-04 | 7 |
| 10 | AOT-01, AOT-02, AOT-03, AOT-04, AOT-05 | 5 |
| **Total** | | **72** |
