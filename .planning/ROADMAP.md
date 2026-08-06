# Roadmap: o2.services — P2P Native Cloud

## Overview

The journey runs from a working job to a published number. It opens with a complete
job — shard, execute redundantly, verify, return a result CID — running inside a single
process on all three targets, then the same job across two OS processes, then the same
job across two browsers on one machine. Only once that chain is proven does
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
- [ ] **Phase 3: Browser Tier & Backbone Relay** - Two browsers, or two isolated browser contexts, on one machine run a distributed redundant job against a self-hosted backbone needing no certificate operations
- [x] **Phase 4: Sovereignty, Authorization & Artifact Signing** - Owner-pinned data becomes a constraint the placer cannot relax, and every artifact resolves through a signed name — **built and unit-verified, not wired**: the placer it constrains is one no job runs through (v1.0 audit)
- [x] **Phase 5: Decomposable Tree-Reduce** - Cross-owner aggregation merges up a derived tree with no shuffle, no consensus, and no state to migrate — **built and unit-verified, not wired**: `executeReduce` has no caller; the demo merges with a linear scan
- [x] **Phase 6: Discovery, Placement & Enrollment** - The static peer list disappears; nodes find each other and choose placement under identity and diversity constraints — **built and unit-verified, not wired**: `discoverExecutors` and `requestEnrollment` have no callers
- [x] **Phase 7: Churn, Stragglers & Coordinator Survival** - A job finishes correctly when the machines running it — including the submitter — vanish mid-flight — **built and unit-verified, not wired**: `runResilient` has no caller, and `submitJob` neither speculates nor re-dispatches
- [x] **Phase 8: Benchmark Harness** - The scaling claim becomes a reproducible published number with its costs included rather than excluded
- [x] **Phase 9: Public Demo, Consent UX & Disclosure Gate** - A visitor consents, contributes to a job someone cares about, and nothing publishes without a deliberate human action
- [x] **Phase 10: elfconv AOT Native→WASM Pipeline** - A statically-linked native binary becomes a fabric-executable artifact under the same admission checks and verification — **3 of 4 criteria**; cross-machine reproducibility is descoped to one host (2026-07-28) and stays unmeasured, not met, and the V8 code-cache hit was measured and does not happen
- [x] **Phase 11: Explicit serveAgent Hook Contract** - `serveAgent`'s six hooks stop defaulting silently — an omission becomes a compile error, not a decision nobody made (completed 2026-07-27)
- [x] **Phase 12: Sovereignty-Pinned Placement** - A sovereignty label becomes a constraint the live `submitJob` path cannot relax, with pushdown and backbone execution-ineligibility enforced on a real job (completed 2026-07-27)
- [x] **Phase 13: Egress Manifest Completeness** - `EgressGuard` **refuses** a frame carrying a registered sovereign block rather than recording it afterwards, and a leaking cross-owner job fails from the submitter across two spawned `bin/agent.ts` processes — **3/3 on the amended criteria (`13-VERIFICATION-2.md`, 8 mutations planted by the verifier). Scored 0/3 on the original wording first (`13-VERIFICATION.md`); the criteria were then amended on three owner rulings and the gaps closed. Two follow-ons scheduled to Phase 13.1, not left implicit: NET-10 (the refusal arrives as a timeout, not a named outcome) and DATA-10 (only the executing node registers, so a submitter still serves raw sovereign bytes).**
- [ ] **Phase 13.1: Node-Side Admission & Transport Bounds** (INSERTED) - A node refuses work it cannot run with a stated reason, and neither side of the wire can be driven past a bound by a peer — three defects measured against the real stack
- [ ] **Phase 14: Signed Artifact Resolution** - Artifacts resolve only through a signed `key → CID` mapping on the live dispatch path, never a bare CID
- [ ] **Phase 15: Capability-Chained Dispatch** - A dispatched task carries a capability chain the serving node verifies before `WebAssembly.instantiate` — the serving end wired and verified end to end, the requestor end wired to a required argument every production call site declines (see the amendment note under Phase 15)
- [ ] **Phase 16: Decomposable Tree-Reduce Wiring** - A live multi-node job merges partials up `executeReduce`'s derived tree, replacing the demo's linear scan
- [ ] **Phase 17: Node Identity & Enrollment** - A node generates its identity on-device and enrolls through a rate-limited, provider-signed flow that a peer verifies offline
- [ ] **Phase 18: Discovery, Capacity & Placement** - Nodes discover candidates, sample and select by load, and refuse over-committed work — no static peer list, on a real job
- [ ] **Phase 19: Quorum Composition & Owner-Domain Attestation** - Verification quorums compose under anti-affinity and backbone anchoring, and owner-domain agreement is labelled distinctly from independent-operator agreement, on a real job
- [ ] **Phase 20: Single Job Path, Ledger & Churn Resilience** - `submitJob` becomes the one job path — lease, speculate, account for coverage — and the peer ledger records real outcomes instead of discarding them
- [ ] **Phase 21: AOT Translation Signing & Runtime** - `translationCid` is called by the lift pipeline and a production node constructs a real `WasiExecutor`
- [ ] **Phase 22: Reachability Guard** - A guard test fails when an exported capability has no path from a runnable entry point — the class of defect this milestone exists to fix
- [x] **Phase 23: Multi-Process Benchmark Driver** - The harness spawns N real operating-system processes instead of N nodes on one event loop, so a parallel speedup is measurable at all — **5 of 5 criteria** (`23-VERIFICATION.md`, 2026-08-06). Criterion 3 passes on its *first* disjunct; the second's premise was refuted by the phase's own factorial. **BENCH-07 closed; AUTH-03 stays `Partial` pending Phase 22.** What the phase deliberately did *not* establish: that the two drivers differ at all — three runs, the curves crossed twice, and the spread between runs exceeds the difference between them
- [ ] **Phase 24: Certificate-Gated Admission** - The front door is locked: a node that cannot present a provider-issued certificate cannot reserve a circuit, be advertised, or be dialled. Scheduled later by owner ruling 2026-08-04; the open door is a KNOWN and accepted state until this phase runs

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
**Goal**: Two browsers — or two isolated browser contexts — on one machine run a distributed, redundant job against a self-hosted backbone that requires no manual certificate operations — the project's core bet, demonstrated
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: NET-02, NET-03, NET-04, NET-05, DATA-02, BROW-03, BROW-05
**Research**: Needed — Safari + WebRTC-Direct support is unverified from any authoritative source (fallback branch: Safari = WSS-only); no credible published throughput figures exist for js-libp2p WebRTC at N>50 browser peers; real relay capacity under partial-result traffic is unmeasured. Playwright `webkit` in CI from day one is the mitigation
**Success Criteria** (what must be TRUE):
  1. Two browsers — or two isolated browser contexts — on one machine connect to each other over WebRTC, using the self-hosted Circuit Relay v2 peer for SDP signaling only, complete a 2×-redundant map job, and agree on the result
  2. The backbone relay auto-acquires its TLS certificate and presents a browser-dialable address with zero certificate operations; no `/certhash/` literal appears anywhere in source and bootstrap addresses resolve at runtime, so a demo recorded today still joins fourteen days later
  3. Sixteen or more browser peers reserve simultaneously against the tuned relay and hold for over an hour under churn; every registered protocol negotiates over `p2p-circuit` because it is registered with `runOnLimitedConnection` on both handle and dial; and relayed byte counters stay in single-digit KiB per peer, proving the relay carries signaling only
  4. A relay at reservation capacity reports exhaustion by name to the joining node and to its own metrics, instead of failing in a way indistinguishable from a network outage
  5. Blocks written from a browser persist to IndexedDB and from Node to the filesystem behind one unchanged blockstore interface, with the same CIDs on both sides
  6. The node runs embedded in a third-party page served without COOP/COEP headers, throttles within a second of the tab being backgrounded, and resumes on return without losing its job
**Plans**: **5 of 6 criteria met**, see `phases/phase-3-browser-tier/SUMMARY.md`. Only
criterion 2's *real* AutoTLS remains, and it needs a publicly reachable host; the
source/runtime half (no `/certhash/` literal, addresses resolved at runtime) is verified.

**Criterion 1 was restated on 2026-07-28, and it was already closed in a stronger form
than the restatement asks for.** The owner ruled that same machine — different browsers
and/or different browser contexts, and different OS processes — is the project's testing
standard everywhere, so the goal and criterion 1 above now name one host. What was
actually done on 2026-07-26 was more than that: an **iPhone running Safari and a laptop
running Chromium, on genuinely different machines**, completed a 4-shard 2×-redundant job
over a **direct** WebRTC connection with the relay carrying SDP only. **That stronger
result stands in the record and is not withdrawn.** The restatement lowers what future
work has to re-demonstrate; it does not lower what was demonstrated. The two-device run
also found two defects the whole e2e suite had passed over, which is the argument for
keeping it on the record rather than replacing it.

**The checkbox stays unchecked, and criterion 1 is not why.** Criterion 2's *real*
AutoTLS needs a publicly reachable host — a hosting decision this ruling does not touch.

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
**Plans**: complete — see `phases/phase-4-sovereignty/SUMMARY.md`

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
**Plans**: complete — see `phases/phase-5-tree-reduce/SUMMARY.md`

Notes (revised 2026-07-26): Browsers are **not** leaves. A browser peer is a full peer
and may host internal combines. The real constraint is narrower and is about *leases*,
not capability: a backgrounded tab has its timers throttled to roughly once a minute,
so any lease shorter than that would be falsely declared dead. The fix belongs in the
lease duration and in the visibility governor already built in Phase 3 — not in a rule
that demotes an entire tier.

### Phase 6: Discovery, Placement & Enrollment
**Goal**: The static peer list the previous phases leaned on disappears — nodes find each other and decide where work runs from local information, under identity and diversity constraints that make a forged quorum expensive
**Mode:** mvp
**Depends on**: Phase 5
**Status**: COMPLETE — 7 of 7 criteria. See `phases/phase-6-discovery-enrollment/SUMMARY.md`
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-05, NET-06, AUTH-01, AUTH-02, AUTH-04, AUTH-05, VER-03, VER-04, VER-08, VER-09, VER-10
**Research**: Needed — S/Kademlia disjoint-path lookups are not implemented in js-libp2p, so sybil/eclipse resistance is build-not-configure; `@libp2p/pubsub-peer-discovery` is unverified against `@libp2p/interface@^3` and libp2p's own docs call pubsub discovery not production-fit (hardening path: a custom `/o2/rendezvous/1.0.0` on the backbone); enrollment design touches the PROJECT.md scope boundary and needs its own sizing
**Success Criteria** (what must be TRUE):
  1. A requestor with no static peer list finds candidate executors by intersecting the providers of a data CID with signed capability records, and dispatches successfully — and a browser peer resolves and serves the same records as a full participant, falling back to backbone-served delegated routing only when it holds no relay reservation (revised 2026-07-26: browser peers are not client-mode-only; see NET-06)
  2. Placement samples d candidates (d=2..4) and selects the least-loaded using local information only; an over-committed node rejects the offer with a stated reason and the requestor re-picks without the job failing
  3. Under artificial load pressure that would otherwise relocate it, a sovereignty-pinned task still lands on its owner — placement cost heuristics are evaluated as a filter after the constraint, never as a score that can outweigh it
  4. A node generates its identity key on-device and receives a provider-signed certificate through a rate-limited enrollment flow; a peer verifies that certificate offline with no call to any live certificate authority, and mass fake-node creation is measurably costly
  5. Every verification quorum contains at least one backbone-anchored replica and no two replicas supplied by the same operator; a test that attempts to fill a whole quorum from one operator's nodes is refused, and a threat model naming "attacker controls up to k of n" is committed with k stated
  6. Several node certificates chaining to one owner's user key resolve as a single discoverable replica set; a sovereignty-pinned task with two or more of that owner's nodes live executes on two of them and the outputs are compared, with a stream tap confirming no data left the owner's trust domain
  7. The same task with only one of the owner's nodes live executes once and its receipt reads owner-attested, not verified — and an owner-domain agreement is labelled distinctly from an independent-operator agreement everywhere it surfaces, so a reader cannot mistake the weaker claim for the stronger one
**Plans**: executed directly; artifacts in `phases/phase-6-discovery-enrollment/`

### Phase 7: Churn, Stragglers & Coordinator Survival
**Goal**: A job finishes correctly when the machines running it — including the machine that submitted it — go away mid-flight
**Mode:** mvp
**Depends on**: Phase 6
**Status**: COMPLETE — 6 of 6 criteria. See `phases/phase-7-churn/SUMMARY.md`
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
**Status**: COMPLETE — 4 of 5 criteria; BENCH-06's distinct-machine half was descoped to one host on 2026-07-28 and stays **unmeasured, not met**. See `phases/phase-8-benchmark/SUMMARY.md`
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
**Plans**: complete — see `phases/phase-10-elfconv-aot/SUMMARY.md` and `10-VERIFICATION.md`
**Outcome**: 3 of 4. Criterion 1 MET against a real 93.6s lift — and the driver refuses
elfconv's exit code, which is `0` on a binary leaving 174 addresses untranslated.
Criterion 2's cache key MET with a pinned conformance CID; its cross-machine half is
**unmeasured**, carried as a structural blind spot. Criterion 3 MET through the
`@o2/aot` barrel and verified against a real artifact rather than fixtures. Criterion 4
**NOT MET**: no WASM code-cache entry at 4.8 MB over three visits, while the same
profile caches 2 MB of JavaScript — a measured negative with two controls.

**Criterion 2 above is left at its original wording deliberately, and the score is
unchanged at 3 of 4** (2026-07-28). The *requirement* AOT-03 was rewritten to what one
host establishes under the same-machine testing-standard ruling, but rewording a completed
phase's criterion to match would convert an unmet half into a met one by editing rather
than by measuring. The criterion stands as it was scored; the cross-machine half is
**descoped and still unmeasured, not met**; and `CROSS_MACHINE_BLIND_SPOT` remains attached
to every artifact because Phase 10 established it is structural rather than configurational.

Notes: Constraints recorded before any artifact is compiled, because retrofitting them
is a recompile of everything — `TARGET=aarch64-wasi32` (not the Emscripten bundle,
which emits JS glue and splits the ABI); no `-pthread` in any edge artifact; AArch64
static input. **Correction: "unstripped" was wrong.** A stripped binary lifts fine if
`.eh_frame` survives, because the loader recovers function entries through libdwarf.

### Phase 11: Explicit serveAgent Hook Contract
**Goal**: Every `serveAgent` call site states an explicit value for all six hooks — `authorize`, `index`, `capacity`, `ledger`, `reservations`, `onDispatch` — so an omission is a compile error a developer sees at the call site, not a default nobody noticed
**Mode:** mvp
**Depends on**: Nothing new — builds directly on the v1.0 codebase. Sequenced first within v1.1, ahead of every other phase in this milestone, because it is the structural cause the other 35 unwired requirements share: making the hooks non-optional turns each remaining capability into a build failure at its call site rather than a fact someone has to go looking for
**Requirements**: WIRE-01
**Research**: None — this is a signature change to an existing, fully-understood function (`packages/net/src/agent.ts:65-120`) plus updating its five known call sites; no new algorithm or library
**Success Criteria** (what must be TRUE):
  1. Removing any single hook argument from a `serveAgent(...)` call in `packages/node/src/bin/agent.ts`, `bin/seed.ts`, or the browser node bootstrap fails `tsc --noEmit`, naming the missing hook — omission is a compile error, not a silent default
  2. Every production call site that starts a node — `bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, and the browser demo — passes all six hooks explicitly; grepping production source for `serveAgent(` shows no call with fewer than six named hook arguments
  3. Starting two nodes via `bin/agent.ts` and dispatching a job between them still completes successfully after the refactor, and the already-fixed `reservations` hook continues to answer real peer IDs rather than regressing to `[]`
**Plans**: 1 plan

Plans:
- [x] 11-01-PLAN.md — Define the required six-hook AgentOptions contract, sweep all 4 production and 6 test call sites, and build the compile-failure + sentinel-count guards proving criteria 1 and 2

### Phase 12: Sovereignty-Pinned Placement
**Goal**: A sovereignty label travels with its data and pins its map task to the owner's node on the one live job path, with pushdown and backbone execution-ineligibility enforced — not only in a test that builds its own fabric by hand
**Mode:** mvp
**Depends on**: Phase 11
**Requirements**: DATA-03, DATA-04, DATA-07, DATA-09
**Research**: None — `submitJob` gains an owner label field and a placement filter; the sovereignty-gate logic (`planPlacement`'s owner-narrowing) already exists and is unit-verified in Phase 4. The work is wiring it onto the path a job actually runs through
**Success Criteria** (what must be TRUE):
  1. A job submitted through `bin/agent.ts` whose input carries an owner's sovereignty label places its map task only on nodes in that owner's node set; a test that applies artificial load pressure specifically to force relocation onto a non-owner node fails to move it, because the live placement path has no branch that can
  2. `JobSpec` and `Task` objects constructed by `submitJob` — the one production job path, not `runResilient` — carry a non-optional owner label; submitting a job without one is rejected rather than silently treated as unowned
  3. Running that job with a filter/projection/partial-aggregation step shows the owner's node performing the reduction locally — the bytes crossing the network are the reduced output, observable by comparing egress size to the raw input size, not the raw input itself
  4. Dispatching a sovereign task at a backbone node holding only an encrypted replica of the data is refused before instantiation and names the sovereignty violation, even though that same node answers availability queries for the data
**Plans**: 4 plans

Plans:
- [x] 12-01-PLAN.md — Redesign sovereignty-aware job contracts (ShardSpec, JobSpec.nodes, Task.label/ownerId) and rewrite submitJob's placement engine; sweep all thirteen existing call sites
- [x] 12-02-PLAN.md — Build the DATA-09 sovereignty guard (Executor adapter) and prove submitJob's placement discrimination, degradation, and rejection semantics
- [x] 12-03-PLAN.md — Prove sovereignty-pinned placement across real bin/agent.ts operating-system processes (criterion 1, literally)
- [x] 12-04-PLAN.md — Carry the sovereignty label over the wire (protocol.ts) and prove pushdown (criterion 3) and backbone execution-ineligibility (criterion 4) over real RPC


### Phase 13: Egress Manifest Completeness
**Goal**: Both `FabricNode` and the browser node construct their `RpcEndpoint` over an `EgressGuard`-wrapped transport instead of the raw `Libp2pTransport`, so the egress manifest is complete by construction on a real job
**Mode:** mvp
**Depends on**: Phase 11
**Requirements**: DATA-05, DATA-06
**Research**: None — `EgressGuard` exists and is unit-verified in Phase 4; the change is two call sites (`fabric-node.ts:311`, `browser-node.ts:181`) that currently pass the unwrapped transport
**Success Criteria** (what must be TRUE):
  1. A stream tap installed on the wire between two nodes started via `bin/agent.ts` **refuses the send** when a registered sovereign block would cross it, so the bytes never leave the node, and the running cross-owner job fails rather than completing as `agreed`
  2. Every job run through the browser demo emits an egress manifest recording exactly what left the **submitting** node, with byte counts, retrievable from the job's own result metadata after completion — not only inside a test harness
  3. A job with zero sovereign data crossing the network records no violation over a non-empty manifest, and a job that legitimately moves an aggregate carries its raw input nowhere on the wire — with the pushdown size claim evidenced by `encodeCanonical(output)` against `encodeCanonical(rawInput)`, not by `manifest.totalBytes`
**Plans**: 7 plans (3 original + 4 gap closure)

<!--
Criteria amended 2026-07-28, after 13-VERIFICATION.md scored the originals 0/3 and the
owner ruled on the three questions it raised. What changed and why:

1. "fails a running job if a single raw sovereign byte crosses" -> "refuses the send ...
   so the bytes never leave". Owner's call. `EgressGuard.send()` already computes the
   violation before calling `#inner.send()`, so refusing costs one branch. Failing a job
   after the bytes crossed cannot un-send them, and an observer that reports after the
   fact is not what "data stays on the owner's device" promises. The job-fails clause is
   KEPT, and becomes true as a consequence of the refusal rather than needing a reader
   for `manifest.violations`.
   "a single raw sovereign byte" -> "a registered sovereign block": detection matches the
   whole registered payload, contiguous and byte-identical. Measured, not assumed — a
   probe sending the raw characters alone crossed with no violation. Phase 4 drew the
   same line: a detector, not a prover.

2. "each owner's node" -> "the submitting node". Owner's call. Retrieving a remote
   node's manifest needs a wire message kind that does not exist; 13-CONTEXT.md deferred
   it as "not needed" and the criterion kept promising it anyway. Cross-process
   retrieval is now a named future item, not an implied promise. `bin/agent.ts` drops
   out of this criterion because it is serving-only and never submits a job.

3. "reports only the aggregate's size" removed as a manifest claim. Measured false:
   `manifest.totalBytes` read 130 where the raw input was 95 canonical bytes and the
   aggregate 8, because totalBytes sums every frame including unrelated block fetches.
   Under criterion 1's refusal the stronger property holds instead — the raw input
   cannot cross at all — and the size comparison stays where Phase 12 already proved it.

A criterion that can only be reported as met is not a measurement. These were amended
down to what is true and up where the refusal makes a stronger claim available; none was
weakened merely so it could be ticked.
-->


Plans:
- [x] 13-01-PLAN.md — Build registerSovereignInputs (a production caller for EgressGuard.guard()) and submitJobWithEgress (per-job manifest attachment), both in @o2/net, proven against a real RpcEndpoint/serveAgent fabric
- [x] 13-02-PLAN.md — Wire both FabricNode and BrowserNode to construct RpcEndpoint over a new EgressGuard field and auto-register every sovereign task's input before executing it
- [x] 13-03-PLAN.md — Prove all three criteria against real FabricNode instances over real RPC, and plant/watch-fail/revert both required mutations (registration removed, transport wrap removed)
- [ ] 13-04-PLAN.md — Make EgressGuard.send refuse a frame carrying a registered sovereign payload instead of forwarding it, and invert every @o2/net assertion that encoded the forward-anyway behavior
- [ ] 13-05-PLAN.md — Prove the refused job fails and its shard stalls rather than relocating, in process against real FabricNodes and across two spawned bin/agent.ts processes
- [ ] 13-06-PLAN.md — Restate the DATA-05/DATA-06 ledger rows against the amended criteria, and guard bin/bench.ts's egress leg with a test rather than the type-checker alone
- [ ] 13-07-PLAN.md — Release a sovereign registration from the serve path once its reply frame has settled, so scan cost is bounded by in-flight tasks rather than node uptime

### Phase 13.1: Node-Side Admission & Transport Bounds (INSERTED)
**Goal**: A node refuses work it cannot run, with a stated reason, and neither side of the wire can be driven past a bound by a peer — closing three defects measured against the real stack rather than inferred
**Mode:** mvp
**Depends on**: Phase 13
**Requirements**: SCHED-06 (new), NET-08 (new), NET-09 (new), NET-10 (new), DATA-10 (new)
**Research**: None — all three are measured, with reproductions recorded below

**Success Criteria** (what must be TRUE):
  1. A node at its execution slot limit refuses an `exec` request with a **stated reason** naming the limit, and the requestor re-picks — verified by concurrency against the real stack, not by a single-request unit test. Today: 4 peers × 200 concurrent `exec` requests produced 800 simultaneous `executor.execute()` calls and **0 refusals**
  2. `LocalCapacity` is either constructed by both production node factories, or deleted. It may not remain built-and-unwired: today it appears only in two test files while `fabric-node.ts` and `browser-node.ts` both pass the opt-out sentinel
  3. A peer cannot make a node allocate an unbounded buffer: `readMessage` enforces a declared maximum message size and calls `stream.abort()` past it. Today a single **64 MiB** frame was sent over the real transport and accepted
  4. Dispatching N shards immediately after dial succeeds for N well above 12, or fails with a **stated, sender-attributed** reason. Today N=8 completes and N=12 fails entirely with `MaxEarlyStreamsError: Too many early streams were opened - 11/10` (quote corrected 2026-07-29 — the original was a paraphrase), which calls `muxer.abort()` and tears down the whole connection — including in-limit requests and identify's stream
  5. A connection torn down by the **sender** exceeding a stream limit is not classified by the coordinator as a **node** failure of the receiver
  6. A sovereignty refusal reaches the requestor as a **named outcome** carrying its reason, not as an RPC timeout. Measured today: `rpc … timed out after 4000ms`, no label, no attribution, against a 30,000 ms default
  7. A node asked for a raw sovereign block refuses, **whether or not it executed a task over that block**. Measured today: a submitting node that never ran the task holds no registration and serves the raw 95 bytes inside a 138-byte frame

**Plans**: 5 plans, one per wave — three of them plant mutations into production source and verify while the mutation is live, so no two may run concurrently. Order 01 → 02 → 03 → 05 → 04.
  - **01** — Admission on `serveAgent`'s `exec` branch (SCHED-06, criteria 1–2). `LocalCapacity` gains a non-reserving `would` twin and a high-water instrument; the `exec` branch takes a slot keyed on the task's own identity and releases it in a `finally` on every exit; the `offer` branch answers from the same counters and reserves nothing
  - **02** — Transport bounds (NET-08, NET-09, criteria 3–5). `readMessage` is bounded *during* accumulation against a declared cap and the refusal is counted; a per-peer FIFO send gate with a bounded queue refuses past its depth with a named marker; a third failure kind names a sender's own refusal without misreading a dead receiver as one
  - **03** — A sovereignty refusal arrives as a named outcome, not as a timeout (NET-10, criterion 6). A pre-send scan on the `exec` and `block` branches, measured against the production 30 s RPC budget left unshortened
  - **05** — The two production node factories construct their own admission control and thread their transport options; criterion 1 measured against real nodes over TCP at the executor layer, and the benchmark declares the limit and shard count it was run under
  - **04** — A submitter does not serve the row it submitted (DATA-10, criterion 7): sovereign shard inputs registered on the submitting node's own guard for the job's duration

**Why this phase exists, and why it is inserted rather than appended.**

Three defects, each measured against tcp + noise + yamux with real `FabricNode`s, not reasoned about:

| Defect | Measurement |
|---|---|
| `serveAgent`'s `exec` branch has no admission control of any kind | 800 concurrent `execute()` calls, 0 refused |
| `readMessage` accumulates peer-controlled chunks with no cap | one 64 MiB frame accepted |
| Per-peer send opens one stream per message with no bound | cliff between 8 and 12 shards, whole connection torn down |

`agent.ts` consults `options.capacity` **only** in the `offer` branch. The `exec` branch authorizes and then calls `await executor.execute(task)` with nothing counting what is in flight, and `rpc.ts` subscribes with a discarded promise per inbound frame, so there is no upstream throttle either. In production each of those slots is a `WebAssembly.compile` plus `instantiate` plus a linear memory.

The apparent ceiling of 256 with one peer is the **sender's** `maxOutboundStreams`, not a receiver decision — which is why adding peers multiplies it linearly. The receiver makes no decision at all.

**The urgency is `bin/bench.ts`.** It ships `const SHARDS = 8`, one below a measured cliff at 12. The approved multi-process benchmark phase would otherwise publish a scaling curve measured against an unfixed connection-killing limit, and the failure it produces blames the wrong node — so a straggler analysis would be reading sender overrun as receiver death.

**This is not a queueing phase.** Criterion 1 wants a semaphore and a refusal, not a buffer: silently queueing an `exec` converts a refusal into unbounded latency and hides the load signal the placer needs. `ARCHITECTURE.md` §7.2 says the same thing — *"an over-committed node just says no, and the requestor resamples"* — and records that only half of it shipped. Criterion 3 wants a declared limit and an abort; a queue cannot bound a single frame. Only the per-peer send path in criterion 4 is a genuine bounded-queue site.

**Amendment required to Phase 18.** Its Success Criterion 2 reads *"a node made to report itself over capacity refuses the **offer** with a stated reason."* That exercises the `offer` branch, so Phase 18 can pass in full while criterion 1 above stays open. Phase 18 gains: *a node at its execution slot limit refuses an `exec` request with a stated reason, and the requestor re-picks.*

**Recorded, not fixed here:** `EgressGuard.#entries` grows one object per outbound frame for the node's lifetime and is peer-driven — the 800-request probe added 800 entries. Bounding it was considered during Phase 13 and deliberately not done: `submit-with-egress.ts` delta-slices `entries` so job-scoped manifests compose with concurrent readers, and a ring buffer would silently drop history a reader may be mid-slice on. It is a resource bound, not a correctness bug. If it is fixed later, follow `wasi-executor.ts`'s house style and **count what was dropped**, surfacing it in the manifest — a guard that silently stops guarding is the shape this project keeps removing.

**How these were found.** A subagent was told to refute the claim that the fabric had no backpressure gap, and did, at a named site with a reproduction. Two of the claim's three legs broke. The leg that broke worst was the assertion that `over-committed: N of M slots in use` proved the project had chosen refusal deliberately — that string cannot be produced by any running node, because the only thing that emits it is constructed nowhere outside tests. A well-built mechanism was read and its wiring assumed. That is the defect this milestone exists to remove, reproduced in the course of arguing about it.

### Phase 14: Signed Artifact Resolution
**Goal**: A production node resolves a task's module through a `key → CID` mapping signed by a trusted build authority — never a bare CID — on the live dispatch path
**Mode:** mvp
**Depends on**: Phase 11
**Requirements**: DET-03, DATA-08
**Research**: None — `signName`/`SignedNameResolver` exist and are unit-verified in Phase 4; the work is routing production module resolution through them instead of resolving bare CIDs directly
**Success Criteria** (what must be TRUE):
  1. A production node resolving a task's module CID does so through a signed `key → CID` mapping; resolving a bare, unsigned CID directly is refused, with the refusal naming the missing signature
  2. A mapping signed by a key outside the node's pinned trust anchors is refused at resolution time, before `WebAssembly.instantiate` runs, rather than being accepted because the CID itself is well-formed
  3. Running `bin/agent.ts` against a real signed artifact resolves and executes it end to end, proving `signName`/`SignedNameResolver` sit on the production dispatch path rather than only in their own spec
**Plans**: TBD

### Phase 15: Capability-Chained Dispatch
**Goal**: A task dispatched between two live nodes carries a capability chain rooted at the data owner's key, and the receiving node's `authorize` hook verifies it before `WebAssembly.instantiate` — the serving end wired and verified end to end; the requestor end wired to a required constructor argument that every production call site declines, so its supplier branch has no entry-point caller
**Mode:** mvp
**Depends on**: Phase 11
**Requirements**: AUTH-03
**Research**: None — `verifyChain` and the capability-chain format already exist and are unit-verified in Phase 4; the gap is `RemoteExecutor` never attaching a chain and no node ever supplying a real `authorize` hook (Phase 11 makes the hook explicit; this phase makes it real)
**Success Criteria** (what must be TRUE):
  1. A task dispatched through `bin/agent.ts` between two live nodes carries a capability chain attached by `RemoteExecutor`, and the receiving node's `authorize` hook verifies it before calling `WebAssembly.instantiate`
  2. A task arriving with no capability chain, or one that has expired, is refused before instantiation, and the refusal names the missing or expired link, observable in the node's response
  3. A validly delegated sub-chain (owner → intermediate → executor) is accepted, and a chain with a broken delegation link is refused, proving delegation depth is checked and not merely the chain's presence
**Plans**: 4 plans (01 audience key + authorizer, 02 the dispatching half, 03 both factories wired, 04 the three criteria across two processes)

<!--
Goal amended 2026-07-31 by Plan 15-04, while the phase was closing rather than after.
The clause that read "both ends wired for the first time" is false, and shipping a goal
line the phase's own summary contradicts is the same defect one level up.

What is true. The serving end is wired and verified end to end: `bin/agent.ts` takes
`--owner-key`, both node factories install `authorizeCapability`, neither says
`'serves-unauthenticated'` any more, and all three criteria above are demonstrated
between two real operating-system processes. The requestor end is wired to a **required**
third constructor argument on `RemoteExecutor` — omitting it is a `tsc --noEmit` error —
but every one of the five non-test call sites names the sentinel rather than a chain,
because all five dispatch `label: 'public'` shards, which have no owner and therefore no
root key. So `delegate`, `CapabilitySupplier` and the supplier branch of
`RemoteExecutor.execute` end this phase with a production adapter and zero production
callers. That is the exact shape `.planning/REQUIREMENTS.md` already records AUTH-03 as
suffering from — "built, not wired" — and it is now named here rather than left for Phase
22 to discover.

**Owner ruling, 2026-07-31: named is not fixed.** This plan proposed accepting the
requestor half as entry-point-unreachable. Declined. **The opt-in sovereign leg is Phase 23
criterion 5**, landing where `bin/bench.ts` is already being rewritten so the most
contended file in the repository is fought once rather than twice. **AUTH-03 stays open
until then** — Phase 15 closes its serving half only, and this phase may not tick it.

The option declined, and its real cost, so a later reader does not re-derive it. An opt-in
sovereign leg on `bin/bench.ts`, off by default, would give `delegate` a traced call path
without moving the default scaling curve, which stays `label: 'public'`. It was declined
**in this phase** rather than rejected outright, and the cost is larger than one flag:
`realFabric`'s worker nodes start with no `sovereignty` configuration at all, so each
would need an owner id, an owner key and clearance; the requestor would need a per-node
chain minted against each worker's peer id; and `memoryFabric`'s nodes are raw
`serveAgent` calls on `authorize: 'serves-unauthenticated'`, so the same leg would prove
nothing on the memory fabric and the two published curves would stop measuring the same
thing. `bin/bench.ts` is also the most contended file in the repository — six phases
modify it. That is a design change needing its own context gathering, not a line in a
proof plan.

The goal was amended **down to what is true**, rather than the evidence being stretched up
to the goal. The same standard the Phase 13 entry's amendment note closes on. The
identical finding is recorded in `packages/net/src/remote-executor.ts`'s class comment and
under Phase 22 below; if the three ever disagree, the class comment is the one a reader
hits first and this file is the one an auditor greps.
-->

### Phase 16: Decomposable Tree-Reduce Wiring
**Goal**: A live multi-node job merges its shard partials by walking `executeReduce`'s derived tree, replacing the demo's linear scan
**Mode:** mvp
**Depends on**: Phase 12
**Requirements**: MR-02, MR-03, MR-04, MR-05, MR-06, MR-07
**Research**: None — `executeReduce`/`deriveReduceTree` exist and are unit-verified in Phase 5; the gap is that nothing calls them on a real job
**Success Criteria** (what must be TRUE):
  1. A job run through `bin/agent.ts` across 8 or more live nodes merges its shard partials by walking the derived reduce tree — not a linear scan — and the aggregate matches a single-node reference computation bit-for-bit
  2. Killing a combine node mid-job during a run through `bin/agent.ts` causes its combine to be recomputed elsewhere from content-addressed inputs with no state transfer, and the job still completes with the correct aggregate
  3. A duplicate combine result arriving late from a recovered node is discarded harmlessly because it carries the same CID — observable as the job completing without double-counting or erroring
  4. `bin/bench.ts` reports the reduce-tree combine step (rendezvous-assigned executors, tree depth) as part of its measured job path, rather than bypassing `executeReduce` the way the demo currently does
**Plans**: TBD

### Phase 17: Node Identity & Enrollment
**Goal**: A node generates its identity key on-device and completes a rate-limited, provider-signed enrollment before it is treated as a peer, and a peer verifies that certificate offline
**Mode:** mvp
**Depends on**: Phase 11
**Requirements**: AUTH-01, AUTH-02, AUTH-04
**Research**: None — `requestEnrollment`, `EnrollmentAuthority`, and `verifyCertificate` exist and are unit-verified in Phase 6; the gap is that nothing on the production startup path calls them, so a running node's identity is still the raw libp2p peer ID
**Success Criteria** (what must be TRUE):
  1. Starting a node via `bin/agent.ts` for the first time generates an identity key on-device and completes a rate-limited enrollment flow against a provider, receiving a provider-signed certificate — observable as the node's advertised identity being a certificate rather than a bare libp2p peer ID
  2. A second node started via `bin/agent.ts` verifies the first node's certificate offline, with no live call to any certificate authority, before treating it as a legitimate peer, and rejects a self-signed or forged certificate with a named reason
  3. Attempting to enroll many node identities in a burst through the same entry point is rate-limited — refused beyond a stated threshold rather than accepted unbounded — making mass fake-node creation measurably costly
**Plans**: TBD

### Phase 18: Discovery, Capacity & Placement
**Goal**: A requestor with no static peer list finds candidates by querying real content-CID providers, samples and selects by load, and an over-committed node refuses work with a stated reason — on a real job, not a hand-built fabric
**Mode:** mvp
**Depends on**: Phase 17 (node identity feeds capability records), Phase 12 (owner label needed for the sovereignty-vs-cost ordering)
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05, NET-05
**Research**: None — `discoverExecutors`, `placeWithOffers`, and `DutyCycleGovernor` exist and are unit-verified in Phases 1 and 6; the gap is that `discoverExecutors` and the `capacity` hook (made explicit in Phase 11) have no production caller, and the governor is wired on the browser tier only
**Success Criteria** (what must be TRUE):
  1. A job submitted through `bin/agent.ts` with no static peer list configured finds candidate executors by querying real content-CID providers intersected with capability records — not a hardcoded list — and dispatches successfully
  2. Placement observed during that run samples multiple candidates and selects the least-loaded; a node made to report itself over capacity refuses the offer with a stated reason, visible in the requestor's re-pick, and the job still completes. **The offer refusal is advisory**: the node reports its load and reserves nothing, so this clause is met by an honest answer and does not by itself bound anything
  2b. A node **at its execution slot limit refuses an `exec` request** with a stated reason naming the limit, and the requestor re-picks
  2c. Placing N shards through `planWithOffers` + `rpcAdmission` **does not over-commit a node past its declared limit**
  2d. **`bin/agent.ts` gains a flag that makes a spawned agent dial a named peer**, and a spawned node started with it verifies that peer's certificate and *accepts* it — the accepting half of AUTH-02, cross-process. Routed here by owner ruling 2026-08-01 from Phase 17's criterion 2, which scored PARTIAL for this clause alone

<!-- Criterion 2d added 2026-08-01. Phase 17 proved certificate verification is offline the
     strong way — both provider processes stopped and asserted dead before the verifier exists —
     and proved the *rejecting* half cross-process with a named `{kind:'untrusted-issuer'}`. It
     could not prove the *accepting* half through `bin/agent.ts`, and the reason is structural
     rather than a missing test: that binary parses eleven flags and **none of them dials a
     peer**. `--provider-addr` dials only a provider, whose handshake carries
     `certificate: null`, so a spawned verifier can reach nothing but `no-records`.

     It lands here because a dial flag is discovery-shaped and this phase owns discovery — and
     because until one exists, **no phase can prove any peer-to-peer acceptance cross-process**,
     not just this one. Phase 17's verifier explicitly declined to defer it to this phase on its
     own authority, since neither AUTH-02 nor certificate acceptance appeared in these criteria;
     it is written in now rather than assumed. -->

<!-- Criterion 2b added 2026-07-28. Criterion 2 exercises only the `offer` branch, and
     `serveAgent` consults `capacity` *only* there — the `exec` branch authorizes and then calls
     `await executor.execute(task)` with nothing counting what is in flight. Measured: 4 peers ×
     200 concurrent `exec` requests produced 800 simultaneous `execute()` calls and zero
     refusals. So Phase 18 could pass in full while that defect stayed wide open. Phase 13.1
     closes it (SCHED-06); this criterion exists so Phase 18 cannot silently pass around it.

     Criterion 2 restated and criterion 2c added 2026-07-29 by Phase 13.1, plan 05. Phase 13.1
     moved the offer branch from `LocalCapacity.offer` to `LocalCapacity.would`, which reserves
     nothing — the reservation moved to the `exec` branch, where the slot is released after
     execution, because an `offer` reservation had no release anywhere on the wire and a demo
     liveness probe would have leaked one slot per peer per call. So the cross-shard bound the
     old reserving offer branch incidentally provided is gone, and criterion 2 as originally
     written could be met in full while a node was handed four shards against one slot. The two
     candidate replacements, both protocol changes and therefore Phase 18's to choose between:
     carry a shard id on the `exec` request so an offer reservation can be redeemed, or publish
     the node's slot count in the `offer` response so a requestor can bound its own placement.
     `packages/net/src/discovery.test.ts` pins the resulting over-commit as a recorded
     consequence — four shards landing on one 1-slot node, zero refusals, zero slots taken — and
     that case is expected to turn red when Phase 18 closes 2c. -->

  3. A user-set CPU duty-cycle cap set at runtime on a running node — Node tier and browser tier alike — is honoured immediately, and the node's advertised capacity to `discoverExecutors` drops accordingly, observable in what the requestor is offered next
  4. A relay run via `bin/seed.ts` at reservation capacity reports the exhaustion by name to a joining node attempting to reserve, rather than the joiner failing indistinguishably from a network outage
  5. Under artificial load pressure applied during a live run, a sovereignty-pinned task still lands on its owner even though a lower-cost non-owner node is available, proving the cost heuristic is filtered after the sovereignty constraint rather than scored against it
  6. **A node that enrols *after* a peer has already connected to it is taken by that peer without either side reconnecting** — the re-ask policy, closed ahead of planning on 2026-08-01 by owner ruling

<!-- Criterion 6 added and CLOSED 2026-08-01, before this phase was planned. It is written
     here rather than left in a summary because the defect lived on the dial path this phase
     owns, and because the ruling it settles is fabric-wide.

     THE DEFECT. `PeerVerifier` settled a peer's verdict once, on `peer:connect`, and cached
     it for the life of the connection. A node that enrolled afterwards was excluded by that
     peer permanently — with a correctly-named refusal the whole time, which is why nothing
     reported it. Found by 17-06 on its first test failure and deliberately left unfixed
     under Rule 4: every candidate changed how often nodes re-ask each other across the whole
     fabric, and that is a protocol decision rather than a bug fix.

     THE RULING — retryable/final split, refreshed lazily on read. Chosen over a timer, a
     `records-changed` push, and a dial-ordering fix. The split falls out of `PeerFailure`'s
     own structure, which already separates a fact about a **signed document** from a fact
     about a **conversation**: `untrusted-issuer`, `bad-signature`, `nodeKey-mismatch` and
     `unidentifiable-peer` are final for the connection; `no-records`, `unreachable`,
     `unanswerable-peer`, `expired` and `not-yet-valid` are re-asked. The trigger is
     `verifiedPeers`, which `RpcBlockSource` already reads per fetch, so no timer and no new
     wire frame were added — the ceiling is one request per connected peer per retry floor,
     paid only while something is actually fetching. `expired` and `not-yet-valid` are
     deliberately retryable despite being `CertificateFailure`s: both are statements about a
     clock rather than about the document.

     WHY NOT THE OTHERS. A timer costs every node the sweep forever whether or not anything
     needs a block, and puts a wall-clock bound inside a class that had none — the repo
     already carries two open flakes of exactly that shape. A `records-changed` push has the
     best latency but adds a wire frame and lets an *unverified* peer command work on demand,
     which needs its own bound. Fixing the dial ordering alone closes only the startup race;
     a node enrolling an hour later stays invisible, and Phases 19 and 20 both reopen the
     window.

     WHAT IT COST TO GET RIGHT. The first implementation of the anti-race guard was
     unmeasured, and probing it found a second real defect: the generation counter was
     per-peer, and `#onDisconnect` deletes the peer's entry — so the ask issued after a
     reconnect was handed the same number as the one still in flight from before the
     disconnect, and a stale refusal could overwrite a fresh acceptance. The counter is now
     monotone across the verifier. Ledger entries M33/M34/M35 pin the three guards, all
     three planted and caught with their recorded signature. -->
**Plans:** 13/13 plans executed

Plans:
- [x] 18-01-PLAN.md — criterion 2d: `--peer-addr` and `--max-concurrent-tasks` on `bin/agent.ts`; AUTH-02's accepting half, cross-process
- [x] 18-02-PLAN.md — D1 kernel: `SelfRecordIndex` answers `providers` from a node's own store; `RpcRecordIndex.providers` unions across peers
- [x] 18-03-PLAN.md — D1 wiring: both tiers serve a `SelfRecordIndex`, and never advertise a block their `block` branch would refuse
- [x] 18-04-PLAN.md — criterion 2c (D2): the offer answer publishes slots and in-flight; `planWithOffers` bounds placement across shards
- [x] 18-05-PLAN.md — `submitJob` gains an offer arm; `discoverCandidates` turns a data CID into dispatchable candidates
- [x] 18-06-PLAN.md — criteria 1 and 2 across real `bin/agent.ts` processes, and `bin/bench.ts --discover` as the entry-point call path
- [x] 18-07-PLAN.md — criterion 3 kernel: a settable duty cycle composed with an environment governor; `LocalCapacity.slots` derived live
- [x] 18-08-PLAN.md — criterion 3 Node tier: the governor composed, `--duty-cycle`, and a `SIGHUP` re-read of a control file under `--dir`
- [x] 18-09-PLAN.md — criterion 3 browser tier: the same cap governor over `VisibilityGovernor`, read by a peer off a live tab
- [x] 18-10-PLAN.md — criterion 5: sovereignty survives the offer loop's re-pick, in the kernel and across real processes
- [x] 18-11-PLAN.md — criterion 4 / NET-05: `--relay-addr` installs a `ReservationWatcher`; a full `bin/seed.ts` relay refuses a joiner by name
- [x] 18-12-PLAN.md — gap closure: criterion 2b's absence-instrument re-armed, and criterion 3's browser half read by a peer off the wire
- [x] 18-13-PLAN.md — gap closure: the stale ledger rows and the guard that could not read them; `--discover` executed; the relay-dial divergence documented on both tiers

Criterion 6 needs no plan — it landed on `develop` as `351bde1` before this phase was planned and needs verification only.

<!-- TWO RULINGS TAKEN AT PLANNING TIME, 2026-08-01. Both are recorded here rather than in a
     summary because both decide how this phase is *scored*, and a scoring rule that lives
     only in a summary is one nobody reads at verification time.

     RULING A — criterion 2b is expected to score PARTIAL, and that is accepted in advance.
     Its second clause, "and the requestor re-picks", is not reachable in this phase. The
     refusal half is closed (SCHED-06, `agent.ts:729-751`). The re-pick half needs WIRE-04:
     `submitJob` calls `executeVerified` once per shard with no retry
     (`core/src/job/submit.ts:267`), and `admission.node.test.ts:273-279` already records
     that the re-pick belongs to `runResilient` and is "unmeasured on every path that runs in
     production". WIRE-04 is **Phase 20 criterion 1**, so the work is already scheduled.

     The criterion text is NOT amended, and the phase is NOT allowed to close on it. This
     follows the ruling made for Phase 17's criterion 2 on 2026-08-01, where the unprovable
     clause was rescheduled to Phase 18 criterion 2d *and* criterion 2 still scored PARTIAL
     *and* Phase 17 stayed uncounted at 1/3. A criterion is not rewritten to let a phase
     close. Plan 18-06 Task 2 therefore asserts the **absence** as a measurement — a direct
     dispatch refused, and no shard recording a second attempt — so the clause turns red the
     day WIRE-04 lands instead of surviving as a sentence in a summary.

     RULING B — criterion 3's "user-set at runtime" is satisfied by a control file plus
     `SIGHUP` on the Node tier, and an in-page setter on the browser tier. No wire frame is
     added, and the reason is a security one rather than a convenience one: `serveAgent`
     serves unauthenticated, so a request kind that set a CPU cap would let any peer able to
     dial this node throttle a machine it does not own. The Node tier re-reads a control file
     under `--dir`, carrying exactly the authority of the filesystem permissions that already
     protect `.identity.key` in that same directory.

     This does NOT create a node class. The governor, its coupling to the advertised slot
     count, and the criterion it satisfies are identical on both tiers; only the control
     surface differs, because a browser tab has no signals. That is a platform fact of the
     same kind as "a browser cannot bind a listening socket", not a capability difference —
     and 18-09 is required to prove the browser tier's cap is read by a *peer*, off a live
     tab, so the equality is measured rather than asserted. -->


### Phase 19: Quorum Composition & Owner-Domain Attestation
**Goal**: Verification quorums compose under anti-affinity with a backbone-anchored replica, owner-domain agreement is labelled distinctly from independent-operator agreement, and two browser tabs on a static bundle find each other with nothing dialed by a harness
**Mode:** mvp
**Depends on**: Phase 18, Phase 17
**Requirements**: AUTH-04, AUTH-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10, WIRE-03
**Research**: None — but *"the gap"* is three different gaps, and calling them one is what this line got wrong. **Corrected in place 2026-08-03 by plan 19-03**; the superseded sentence and the measurements that refute it are in the dated note below the criteria. `attestationReceipt` and `resolveReplicaSets` exist, are unit-verified in Phase 6, and are indeed only *uncalled* on the production dispatch path. `composeQuorum` is not in that state: VER-03's anchored replica is **unimplemented rather than unwired**, and its ok arm returns `strength: 'independent'` unconditionally while never calling `classifyAttestation`, so wiring it as it stood would have reported every quorum `independent`. And no test had ever put two tabs on a static bundle without a harness dialing for them — that one is closed by 19-03
**Constraints** (recorded 2026-07-28 by Phase 13, before criterion 2's plan is written):
  - Raw sovereign data does not move between nodes, including two nodes the same owner controls — `EgressGuard.send` refuses any frame carrying a registered sovereign payload rather than forwarding it (Plan 13-04). Criterion 2 below is therefore reachable only if the owner has already placed the input on both of their live nodes; the fabric will not fetch it onto the second one. See the **Raw sovereign data does not move between nodes** row in `.planning/PROJECT.md`'s Key Decisions
  - **CORRECTED 2026-08-02 — this bullet previously said two things that are false, and both would have misdirected the WIRE-03 planner.** It read: *"`BrowserNode` composes the identical `EgressGuard` and `registerSovereignInputs` wiring `FabricNode` does, but no sovereign job has ever run in a browser, so the refusal branch is compiled and never executed."* (1) **`registerSovereignInputs` does not exist in this repository** — zero definitions, zero calls. The name was retired; the real symbols are `takeSovereignHold` and `withholdingFrom`, both exported at `packages/net/src/index.ts:77`, and `packages/net/src/capability-authorizer.ts:20-25` already records this verbatim. The planning documents inherited a name the source had dropped — the same failure this bullet's neighbour below documents for a different sentence. (2) **"No sovereign job has ever run in a browser" is refuted**: `packages/node/src/browser-capability.e2e.test.ts` dispatches three `label:'sovereign'` tasks (`:280-281`) to a live tab started with `canExecuteSovereign: true` (`:213`) and asserts the third is *accepted and executed* (`:349-353`)
  - **What the composition claim gets right, and what actually remains unexecuted in a tab.** The composition holds line for line: guard construction (`fabric-node.ts:1284` / `browser-node.ts:851`), disposition object (`:1345` / `:885`), `withholdingFrom` (`:1366` / `:897`), `egress:` hook (`:1525` / `:1094`). What is *not* executed in a tab is narrower than "the refusal branch", and the source is more precise than this roadmap was: the **`authorize`/AUTH-03 refusal is executed** in a real tab; the **`EgressGuard`/`withholdingFrom` refusal is unconfirmed** — no e2e spec drives a sovereign payload out of a tab and reads the guard's refusal, and `two-tabs.e2e.test.ts:275-277` reads the *clean* manifest on a *public* job, the positive arm only; and the **`capacity`/SCHED-06 refusal is explicitly unexecuted, with the source naming this phase** — `packages/browser/src/browser-node.ts:1176-1184` says *"nothing drives a refusal through this hook … WIRE-03, Phase 19 builds the harness that would measure it."* Those two are WIRE-03's real content. This is the same structural gap `12-VERIFICATION.md` recorded and `13-03-PLAN.md` routed to WIRE-03
  - **Browser-tier testing standard, one host and several browsers** (owner ruling, 2026-07-28): Playwright multi-browser on this machine — `instances: [{browser:'chromium'},{browser:'firefox'},{browser:'webkit'}]` — each peer in its own **isolated browser context** so it gets its own origin storage and IndexedDB, plus a **locally-started Circuit Relay v2 peer to dial**. Three engines on one host are three independent implementations and three independent storage backends; they are **not** three machines, and no result obtained this way may be labelled cross-machine or distributed-hardware. This standard is what makes criterion 4 runnable at all, and it **unblocks four items deferred for want of a multi-browser environment**: `BrowserNode.start()` has no dedicated runtime test anywhere in the repository (Phase 11, `11-VERIFICATION.md`); `BrowserNode`'s `guardSovereignty` wiring has zero runtime proof (Phase 12, `12-VERIFICATION.md`); `BrowserNode.egress` is unproven at runtime (Phase 13, threat T-13-08 in `13-03-PLAN.md`); and the Phase 13 `EgressGuard` refusal inherits into the browser tier untested (`13-VERIFICATION-2.md`). The recorded root cause was one sentence shared by all four — `BrowserNode.start()` needs a real `indexedDB` and a relay to dial, so it runs in **neither** vitest project — and **that sentence was false**. Retired in the source by Plan 15-05 and corrected here on 2026-08-01; it had survived at the package boundary, in the two documents a planner reads first. Corrected: the **`browser`** project cannot host such a test, because a Circuit Relay v2 server *"will not work in browsers"* in `@libp2p/circuit-relay-v2`'s own words; the **`e2e`** project can and **needs no relay at all**, because the tab dials a Node submitter's WebSocket listener directly. `packages/node/src/browser-capability.e2e.test.ts` starts that factory against a live tab today. The multi-browser standard above is still what criterion 4 needs — two tabs finding *each other* do need a relay — but it is not what unblocks the four deferred items, and treating it as such is what let them stay deferred. Full statement in REQUIREMENTS.md under WIRE-03
**Success Criteria** (what must be TRUE):
  1. A verification quorum assembled during a job run through `bin/agent.ts` rests on no single shared reachability dependency and contains no two replicas from the same operator — a run engineered to try to fill a quorum from one operator's nodes is refused rather than silently accepted, and so is one whose members all hang off the same relay

<!-- CRITERION 1's FIRST CLAUSE REWORDED 2026-08-03 BY OWNER RULING. It read "contains at least
     one backbone-anchored replica". The property is unchanged and the bar is NOT lowered — this
     is a correction of wording that encoded a forbidden mechanism, not a criterion rewritten to
     let a phase close.

     WHAT WENT WRONG. "Backbone-anchored" was implemented in plan 19-02 as
     `discoverability === 'seed'`, which collides head-on with `STATE.md:479-480`: *if a decision
     keys on node kind, it is wrong — the only legitimate use is shared-dependency analysis over
     the discovery graph.* It also contradicted a measured result: Phase 3 dialled an iPhone at
     its `/p2p-circuit/webrtc` address and it ran half of a 2×-redundant job, so a
     relay-discovered peer had already held a verification slot. The relay is a signalling
     channel for registration and discovery, not a data path, and it drops out once peers
     connect. Retracted in `0314208`.

     WHY THE REWORDING IS FAITHFUL. VER-03's own rationale clause has always been *"so eclipsing
     a quorum requires a backbone compromise"* — the requirement is **eclipse resistance**, and
     shared-dependency analysis is the cardinal rule's named-legitimate way to express it.
     `composeQuorum`'s rule 2 (`sharedRelay` over the chosen member set) delivers exactly that
     property, and 19-02's own retraction measured why it must sit on the MEMBER set rather than
     the candidate pool: a pool of relay-1/relay-1/relay-2 passes a pool-level check and then
     draws two members both on relay-1 — a redundancy of two against a single point of failure.

     THE DEFECT'S SHAPE, WORTH KEEPING. The old rule turned a repair into a refusal and put the
     refusal before the thing it was about. If a quorum's dependencies are too concentrated the
     answer is to draw a different member, not to refuse composition on what kind of node
     somebody is. -->

  2. Several node certificates chaining to one owner's user key resolve, through `bin/agent.ts`, as a single discoverable replica set; a sovereignty-pinned task with two or more of that owner's nodes live executes on two of them, the outputs are compared, and the receipt reports the agreement as owner-domain, not independent-operator
  3. The same task with only one of that owner's nodes live executes once, and the resulting receipt reads owner-attested rather than verified, wherever it is displayed — CLI output, demo UI, or job result
  4. Two browser peers opened against the static demo bundle — no seed process running, no `/bootstrap.json`, nothing dialed by a test harness — discover each other via the `index` hook each of them serves and the `reservations` answer the relay gives, and complete a job together, proving browser peers participate in routing as full peers rather than only through backbone-served fallback. Run on **one host** under Playwright multi-browser (`chromium`, `firefox`, `webkit`), each peer in its own isolated context, against a locally-started relay — see the browser-tier testing standard in Constraints above; the result is a one-host result and is labelled as one

<!-- CRITERION 4's HOOK PHRASING CORRECTED 2026-08-03 BY PLAN 19-03, AND THE CORRECTION WAS
     ITSELF CORRECTED BY OWNER RULING THE SAME DAY. The property is unchanged and the bar is
     not lowered. This is a factual correction to a statement about the source, not a criterion
     adjusted so a phase can close — RULING A above is explicit that a criterion is not
     rewritten to let a phase close, and no other criterion text in this entry is touched.

     WHAT IT USED TO SAY. *"discover each other via the wired `index`/`reservations` hooks"*.
     That reads as though both hooks were wired on both tiers, and one of them is not.

     WHAT WAS MEASURED. `index` is wired on both tiers and identically: each tier's
     `serveAgent` call passes `index: records`, built by the same `ownRecords(certificate,
     identity, sovereignty.canExecuteSovereign, store, withholdingFrom(egressDisposition))`
     call over its own tier's store. `reservations` is wired on the Node tier only — a real
     thunk over the reservation store, `reservations: () => node.reservedPeerIds` — while the
     browser tier supplies the **named absence** `reservations: 'relays-for-nobody'`.

     CITED BY SYMBOL, NOT BY LINE, and that is the correction rather than the numbers.
     Warning W2 flagged four drifted line citations on 2026-08-04; they were corrected, and a
     commit later the same day moved every one of them again by one line (W9). Three rounds of
     chasing the same four numbers is enough evidence: a line number is an ABSOLUTE reference
     into a file that keeps changing, and it rots silently while reading like evidence. A
     grep-able symbol survives every edit that does not change the thing being cited.

     WHY NOT SIMPLY NAME `index` ALONE. `19-CONTEXT.md` proposed exactly that, and the owner
     ruled on 2026-08-03 that it **understates** the criterion. Both hooks are load-bearing;
     they are just load-bearing on different nodes. The rendezvous answer that introduces two
     tabs comes from the relay's `reservations` thunk, and each tab's own `index` hook is what
     makes it a full routing peer rather than a client of one — which is precisely the clause
     *"as full peers rather than only through backbone-served fallback"*. Dropping the second
     name would have left that clause resting on nothing.

     WHAT THE ASYMMETRY IS AND IS NOT. It is a statement about what each node *knows*, not
     about what either is permitted to do. A tab holds no reservations of its own, so a tab
     answering `reservations` would be reporting on peers it learned from a relay — a different
     claim than the hook makes. **This is not a node-class decision** and must not be read as
     one; giving the browser tier a real `reservations` thunk is deferred by decision, and if a
     later phase wants it, it is a protocol question about what the hook asserts.

     MEASURED, not argued from construction: `packages/node/src/static-rendezvous.e2e.test.ts`
     takes the `reservations` reading on the built bundle with no origin to ask and no harness
     dial, and `tab-refusals.e2e.test.ts:371,377` takes the `index` reading off a live tab over
     the wire.

     CORRECTED 2026-08-04 (verification warning W3). This read "takes both readings", which was
     false: that file issues no `records` or `providers` request anywhere — discovery is
     `findReservedPeers` alone, `computePeers` sends an `offer`, and its tabs are unenrolled so
     `peerCertificate` returns before asking. The CLAUSE STILL HOLDS and criterion 4 remains
     MET; only the sentence naming which file takes which reading was wrong. -->

  5. **Enrolling a node costs an attacker something they cannot mint for free**, and the cost is measured: creating the N-th fake identity is demonstrably more expensive than creating the first. Routed here by owner ruling 2026-08-01 from Phase 17's AUTH-04, whose rate-limiting half is proven and whose cost half is not

**Criterion 5 exists because Phase 17 measured its own rate limit and found what it does not buy.** The burst limit is real and fully proven — a stated threshold read out of the refusal the peer received, `limit: 5 / windowMs: 3_600_000` on the wire. But AUTH-04's text asks that mass fake-node creation be *"measurably costly"*, and Phase 17's verification established two things that defeat it. The limit is keyed on `userKey`, which is **one `ed25519.keygen()`** — so twenty distinct user keys all enrol unslowed, and removing the rate guard entirely leaves that test green. And the budget is per provider **process**: a second provider defeats it without needing a second user key at all, asserted across two spawned providers.

It lands here rather than in Phase 17 because the remedy is a design decision this phase is already making — what scarce thing an identity must present. This phase owns AUTH-05 and the attestation-strength machinery, so the natural candidates (a provider-issued invitation chained to an owner key, a persistent cross-process budget, or proof-of-work) all sit beside work already scheduled here. **AUTH-04 stays open until then**; Phase 17 records the rate-limiting half as measured and the cost half as not, in those words.

**CRITERION 5's SECOND CLAUSE IS CARRIED TO PHASE 24 CRITERION 8, recorded here on
2026-08-05 because this entry did not say so and the destination did.** Phase 24's own entry
carries the full ruling, the arithmetic and the mitigation that was measured not to work —
and until now `Phase 24` appeared nowhere in this section, so a reader scoring Phase 19 from
this entry alone would have found an open criterion with no home. Phase 18's entry names
Phase 20 criterion 1 in place for exactly this reason; this is the same act, one phase over.

**The state being carried, in one paragraph.** Criterion 5 verified PARTIAL twice. The
unmintable half is delivered and measured across real processes, including a provider
restart and two-provider recovery. The N-th identity is **refused inside an issuance window
rather than priced**: measured comparatively, a provider's cost to refuse over an attacker's
cost to mint a fresh identity is ~3.0, and over a replay ~1397 — so an attacker burns the
window at roughly a third of what refusing costs, and the denial then applies to every honest
node for the rest of the window at no further cost. The owner's ruling of 2026-08-04
relocates the guard rather than lowering the bar: under gated admission an unissued identity
is worth **nothing**, so the price of the N-th identity is a provider's signature, which is
the unmintable thing the first half already secured. **This is a carry-forward, not a
closure** — Phase 19 does not become 6/6 by it, on the same principle that kept Phase 16's
MR-04 open when its criterion 3 went to Phase 20.
**Plans:** 18 plans, 8 waves

Plans:
- [ ] 19-01-PLAN.md — the certificate seam: `NodeDescriptor` carries the certificate discovery already held, or names its absence; `discoverCandidates` reports replica sets
- [ ] 19-02-PLAN.md — `composeQuorum` gains the backbone anchor VER-03 never had, and reports the strength its members support instead of the constant it always declared
- [ ] 19-03-PLAN.md — criterion 4: three browser peers on the static bundle, three engines, one relay, nothing dialled by the harness; plus this entry's three recorded corrections
- [ ] 19-04-PLAN.md — WIRE-03: the two refusals a tab has never executed — the egress refusal on the browser submitter path, and the `exec` refusal at the slot limit
- [ ] 19-05-PLAN.md — criterion 5, mechanism half: a second budget on the one quantity an attacker cannot rotate — the provider's own aggregate issuance — and an issuance ledger the host owns rather than the authority's heap
- [ ] 19-06-PLAN.md — `submitJob` composes the quorum for public shards at redundancy ≥ 2 and emits the attestation receipt on every shard and every job
- [ ] 19-07-PLAN.md — criterion 5, cost half: the durable issuance record on both tiers, the flag, and the budget that a provider restart does not hand back, measured across real processes
- [ ] 19-08-PLAN.md — criterion 1 across real `bin/agent.ts` processes, with two engineered fabrics — one operator, and no anchor — each refused in the composer's own words
- [ ] 19-09-PLAN.md — criterion 2 and AUTH-05: a node's owner id becomes its enrolled user key, and two of one owner's nodes agree as `owner-domain`
- [ ] 19-10-PLAN.md — criterion 3 on the CLI: `bin/bench.ts` prints the receipt, and three readings are taken off the spawned driver's own stdout
- [ ] 19-11-PLAN.md — criterion 3 in the demo UI, and the page's unconditional claim that every cube ran twice on different nodes is corrected
- [ ] 19-12-PLAN.md — the ledger: one mutation entry per instrument, and requirement rows moved only as far as what landed supports
- [ ] 19-13-PLAN.md — the third signing leg: a result a node signs with its certified key, the wrapper that produces it, and the wire that carries it
- [ ] 19-14-PLAN.md — the agreeing set carries what each replica signed rather than a list of node ids the requestor chose
- [ ] 19-15-PLAN.md — wired: both factories sign both verbs from one identity, and a signature verifies across a real process boundary
- [ ] 19-16-PLAN.md — the aggregation is signed too: the combining node signs what it merged and what it produced, and `serveAgent` grows the one hook both verbs reach their key through
- [ ] 19-17-PLAN.md — two receipts, because there are two claims: the aggregation's own strength, verified from combine signatures and printed beside the map job's
- [ ] 19-18-PLAN.md — the strictness dial: every submitter states what it wants when verification cannot be composed, and not choosing stops being expressible

<!-- Plan number is NOT wave order in this phase, and has not been since 19-04 was scheduled
     after 19-05. Waves are: 1 = 01, 02, 03, 13; 2 = 05, 14; 3 = 18; 4 = 06, 16;
     5 = 08, 10, 15; 6 = 04, 09; 7 = 07, 11, 17; 8 = 12. Every plan's frontmatter carries its
     own `wave`, and
     that is the authority — this list is ordered by number so a reader can find a plan, not by
     when it runs. Machine-checked at planning time: every `depends_on` resolves to a strictly
     earlier wave, and no two plans in one wave share a `files_modified` entry. -->

<!-- PLANNED 2026-08-02. Three things a verifier should know before scoring this phase, all
     of them decided at planning time rather than left to be discovered.

     ENTRY-POINT SUBSTITUTION FOR CRITERIA 1 AND 2. `bin/agent.ts` never submits a job —
     zero hits for `submitJob`, `JobSpec` or `executeVerified`; it is a serving node whose
     only stdout is a handshake JSON at `:601`. *"A job run through `bin/agent.ts`"* is
     satisfiable only as *"a job run **across** `bin/agent.ts` processes"*, which is the
     shape `discovery-agents.node.test.ts` already uses for Phase 18's criteria 1 and 2.
     Plans 19-08 and 19-09 take that shape and say so in their own headers. Recorded here
     the way Phase 18 recorded its own at line 592, rather than left for verification.
     Re-measured 2026-08-03 by plan 19-03, whose own task list carried this substitution as a
     third correction to make: still zero hits for all three symbols, and `process.stdout.write`
     still occurs exactly once in the file, at `:601`. Nothing was added — the record was
     already correct, and duplicating it would have made one measurement look like two.

     THE `Research: None` LINE ABOVE IS WRONG ON TWO COUNTS, both measured 2026-08-02.
     VER-03's backbone-anchored replica is **unimplemented**, not unwired — `composeQuorum`
     sorts by `relayIds.length` and refuses on a *shared* relay, and nothing anywhere
     requires an anchored member; there is no `backbone` symbol in `packages/*/src` at all.
     And `composeQuorum` returns `strength: 'independent'` **unconditionally** on its ok arm
     while never calling `classifyAttestation`, so wiring it as it stood would have made
     every quorum report `independent` including a size-1 one. Plan 19-02 fixes both; plan
     19-03 corrects this line in place.

     CRITERION 5's MECHANISM WAS DECIDED BY THE OWNER ON 2026-08-02, AND IT IS NONE OF THE
     THREE CANDIDATES NAMED ABOVE AS THEY WERE FRAMED. Plan 19-05 originally opened with a
     blocking decision between an invitation chain, a persistent budget and proof-of-work. The
     ruling: the scarce thing an identity must present *already exists* — a provider-issued
     certificate an attacker cannot mint, because `verifyCertificate` refuses an untrusted
     issuer. What is not scarce is **issuance**. So the mechanism is a persistent, cross-process
     **aggregate** issuance budget — how many certificates one provider will sign per window,
     held where a restart cannot clear it — and nothing else. A budget keyed on any request
     field is one the attacker rotates around, which is Phase 17's finding restated rather than
     fixed. Plans 19-05 and 19-07 were replanned against it; the invitation, proof-of-work and a
     larger rate limit are all off the table. The full ruling is in `19-CONTEXT.md` under
     *"The signing triangle"*.

     WHAT THAT MECHANISM IS, SO A VERIFIER SCORES THE EVIDENCE RATHER THAN THE WORDING. It is a
     **bound made durable, not a per-identity price**: the N-th identity is *refused* inside the
     window, and the refusal survives a provider restart. Criterion 5's phrase *"demonstrably
     more expensive than the first"* can be read as requiring a rising price, and nothing in this
     phase delivers one — no such price exists in this design and none was built. If a verifier
     takes that reading, PARTIAL is the honest score and RULING A applies unchanged: a criterion
     is not rewritten to let a phase close. Plan 19-07's own test file states the reading in its
     header so the dispute surfaces at planning time rather than at verification.

     THE PHASE ALSO ADDS THE THIRD SIGNING LEG, AND CRITERIA 2 AND 3 NOW DEPEND ON IT. Two legs
     existed: the code a node runs is signed by its publisher (Phase 14, `guardModuleProvenance`
     against pinned `trustAnchors`), and the node's certificate is signed by its provider
     (Phase 17, `verifyCertificate` against `trustedIssuers`). The result a node returns was
     signed by nobody — agreement was attested by transport authentication only, which is not
     transferable, and `VerificationResult.agreeing` carried plain node-id strings. Plans 19-13,
     19-14 and 19-15 add the leg for `exec`, and Plan 19-06 makes a certificate count toward a
     receipt only when that node's signature over *this* result verifies. A receipt built
     without it is the submitter's word about itself, so VER-08/09/10 may not be ticked on one —
     recorded in Plan 19-12's disposition. Certificate lifetimes are explicitly **not** part of
     any of this: the owner corrected an earlier draft that called for short ones, because the
     attack radius does not justify them. No renewal machinery is planned and none may be added.

     AND THE LEG COVERS THE COMBINE VERB TOO — owner decision 2026-08-02, taken after the first
     three plans were written. Signing `exec` alone would have left a map/reduce job ending with
     signed map results feeding an **unsigned aggregation**, which is precisely the half
     `PROJECT.md` calls the verified one: *the owner's contribution is trusted; the aggregation
     over contributions is verified*. `ReduceOutcome.executedBy` is a map of peer-id strings —
     the combine verb's exact analogue of the defect being fixed for `exec`. Plan 19-16 has the
     combining node sign the input set it merged, in merge order, and the result it produced;
     Plan 19-17 verifies those signatures inside `reduceJob` and reports the aggregation's own
     strength beside the map job's. **Two receipts, never one restated**: a sovereign map is
     owner-attested by construction while the aggregation over it can be redundant, so they
     routinely differ, and VER-08/09/10 may not be ticked on half the claim.

     THE ISSUANCE BUDGET OPENS A DENIAL OF SERVICE, AND THE OWNER ACCEPTED IT AS A TRADE.
     `serveAgent` serves enrolment unauthenticated, so anyone able to dial a provider can burn
     its whole window at one `ed25519.keygen()` per attempt — where before the aggregate budget
     they could burn only their own user key's window. No mitigation machinery is built: the
     answer is that trust is per-verifier and pinned, so a burned provider is routed around by
     trusting or running another. **But every fixture in this repository and the demo are
     single-provider, so that recovery is an argument and not a reading.** Both sentences belong
     in AUTH-04's row. *Unmeasured is not met* applies to a mitigation exactly as it applies to
     a mechanism, and "mitigated by design" is not a phrase this row may use.

     THE QUORUM IS THE DEFAULT AND IT IS OPTIONAL — owner ruling 2026-08-03, taken after 19-06
     and 19-08 were written and requiring both to be replanned. A public shard at redundancy >= 2
     whose candidate set cannot compose a valid quorum **degrades**: it runs at whatever
     redundancy is available, is marked degraded, and its receipt reports the weaker strength.
     **It does not fail the job.** Phase 12 already retired `not-enough-executors` for the same
     reason, and criterion 1's load-bearing word is *silently* — `classifyAttestation` labels a
     one-operator agreement `owner-attested` or `owner-domain` and never `independent`, so the
     weaker outcome is named by construction. The exception is caller-set: Plan 19-18 puts a
     **required two-armed dial** on `JobSpec`, and a caller that would rather have nothing than a
     weaker answer takes the strict arm. Required rather than optional because this phase has
     twice measured the alternative — Plans 19-01 and 19-13 each planted "make it optional and
     omit it" and each saw `tsc --noEmit` exit 0 while the behavioural assertion failed. The
     fan-out across every submitter is the point, not the cost.

     THIS IS THE RETRACTED ANCHOR RULE'S SHAPE, AND IT IS WHY BOTH WERE CAUGHT THE SAME WEEK.
     That defect turned a repair into a refusal and put the refusal before the thing it was
     about. A candidate set too concentrated to verify is a condition the caller does not
     control; the answer is to report what was achieved, not to kill the job — unless the caller
     said in advance that a weaker answer is useless to them. Plan 19-08 now measures the same
     over-concentrated fabric on **both** arms of the dial over one live fixture, because two
     fabrics behaving differently proves nothing about a dial and one fabric submitted twice
     does. -->

### Phase 20: Single Job Path, Ledger & Churn Resilience
**Goal**: `submitJob` becomes the one job path — lease renewal, speculation, and coverage accounting live inside it, not in a second uncalled implementation — and the peer ledger records real cross-node outcomes instead of discarding them
**Mode:** mvp
**Depends on**: Phase 18, Phase 19
**Requirements**: WIRE-04, CHURN-01, CHURN-02, CHURN-03, CHURN-04, CHURN-05, CHURN-06, BROW-02, AUTH-04
**Research**: **Corrected in place twice — read the dated correction, not the original.** The line as planned read *“Mostly none — `runResilient`'s speculation and coverage machinery exists and is unit-verified in Phase 7; the gap is that nothing calls it”*, and it was true of speculation and of coverage and **false of lease renewal, which criterion 1 names first**: `LeaseTable.renew`, `shouldRenew` and `RENEW_AT` had no caller anywhere outside `lease.test.ts`, and `runResilient` never renewed — it granted, completed, surrendered and reaped, and nothing else. So renewal had to be BUILT and not wired, and was prioritised accordingly by owner ruling on 2026-08-04, with one hard constraint recorded at the same time: an unconditional renew is a longer timeout wearing a lease's clothes, so a renewal may be granted only on evidence that the holder is still working. **What the phase then measured, recorded here on 2026-08-05 by plan 20-13 because a correction that lives in a summary reaches nobody.** (1) Renewal was built, in plan 20-01, conditional on the holder refusing a duplicate claim on this task's own capacity slot key — an existing wire answer rather than a new hook — and `submit.ts` is now the first and only production caller of all three symbols. (2) The clause after that constraint had been left ungrammatical by the 2026-08-04 edit (*“… still working, so `submitJob` is the only reachable job path and it does neither”*), and it is retired here rather than repaired: `submitJob` now does all three. (3) *“`ledger` (made explicit in Phase 11) is supplied by no node in production”* was true when written and became false in plan 20-02 — both node factories build a real `StartOutcomeLedger` and record their own start row into it, and mutation-ledger `L1`/`L2` are what keep that so. (4) `runResilient` itself no longer exists (plan 20-12), so every sentence above that names it is a statement about the tree's history rather than about the tree
**Success Criteria** (what must be TRUE):
  1. `submitJob` is the only function a caller uses to run a job through `bin/agent.ts` — it performs lease renewal, speculation, and coverage accounting internally; `runResilient` no longer exists as a separate, uncalled entry point, either merged in or removed

<!-- CRITERION 1 CARRIES PHASE 18's CRITERION 2b, AND A TRIPWIRE IS ALREADY ARMED FOR IT.
     Recorded 2026-08-02 by owner ruling applying RULING A: Phase 18 verified 8/9 and stays
     UNCOUNTED, with 2b's second clause — *"and the requestor re-picks"* — carried here rather
     than lowered. Same treatment as Phase 16 criterion 3 → criterion 6 below, and Phase 17
     criterion 2 → Phase 18 criterion 2d.

     WHAT IS ALREADY TRUE. The refusal half is closed and measured (SCHED-06): a node at its
     execution slot limit refuses an `exec` request naming the limit. What is absent is the
     re-pick, because `submitJob` calls `executeVerified` exactly once per shard.

     WHAT WILL FIRE WHEN YOU ADD THE RETRY. `packages/node/src/discovery-agents.node.test.ts`
     asserts the shard ends `insufficient` with the refusal in `verification.failures`, taken
     on a shard whose SELECTED executor refuses at exec. Adding a re-pick makes that shard
     reach a second executor and stop being `insufficient`, so **the test goes red and that is
     correct** — it is the scheduled clause arriving, not a regression. Update the assertion
     to require the re-pick rather than its absence, and Phase 18 criterion 2b becomes MET.
     Mutation-ledger entry M36 is exactly this defect planted deliberately; read it first, it
     shows you the shape.

     WHY THIS NOTE EXISTS AT ALL. The instrument that was supposed to hold this clause for
     Phase 18 was a TAUTOLOGY — `expect(shard.verification.agreeing).toHaveLength(1)`, where
     `agreeing ⊆ placement.nodeIds` whose length is `redundancy` = 1, under a
     `status === 'agreed'` narrowing that excludes 0. It could not fail, so the clause would
     have survived as a sentence in a summary, which is precisely what RULING A was written to
     prevent. It was caught by an independent verification pass and re-armed in plan 18-12.
     A scheduled clause is only scheduled if something red arrives to collect it. -->

<!-- ALSO INHERITED HERE, AND NOT YET SCHEDULED TO A CRITERION: `admit:` at
     `packages/node/src/bin/bench.ts:723` can be deleted with the entire suite staying green.
     Deleting it moves `submitJob` from `planWithOffers` to `planPlacement`, and on a rig where
     nothing refuses the two place identically. That line is the SOLE production caller behind
     SCHED-02's "reachable from a runnable entry point" claim, so the requirement rests on a
     wire nothing is watching. Confirmed structurally in Phase 18's re-verification:
     `serve-agent-hooks.node.test.ts` pins eleven strings in that file and `admit` is not among
     them. Closing it needs a rig where a node actually refuses — 18-12's re-armed criterion-2b
     instrument, which saturates a node between the offer answer and the dispatch, is the
     nearest existing shape. This phase merges the job paths and is therefore the phase most
     likely to move that line; whoever does, give it a guard first. -->

  2. Killing 30% of participating node processes mid-job, run through `bin/agent.ts`, still produces the correct final result, with re-dispatches visible in the job's history output
  3. A straggler task is duplicated speculatively during a live run, the first correct result wins, and the job's reported cost accounting includes the speculation multiplier
  4. A cross-owner job run with some owners' nodes offline returns a coverage report (`covered: X/Y`) alongside its result, rather than presenting a silently partial aggregate as complete
  5. The browser demo's peer activity ledger, viewed across two or more connected tabs, shows merged counts contributed by every connected peer — not zero — because every node now supplies `serveAgent`'s `ledger` hook and reported outcomes are recorded rather than discarded
  6. **A combine result arriving from a recovered node *after* `executeReduce` has already collected its `wanted` replicas is received and discarded harmlessly** — an unsolicited late duplicate, not one the test asked for. Routed here by owner ruling 2026-07-31 from Phase 16's criterion 3, which scored PARTIAL for this clause alone
  7. A coordinator writes a checkpoint during a live job run through `bin/agent.ts`, and a SECOND requestor — given nothing but that checkpoint's CID — finishes only the outstanding shards and returns the same answer the first would have

<!-- CRITERION 7 ADDED 2026-08-04 BY OWNER RULING, and the reason is a scoring gap rather than
     a scope increase.

     CHURN-03 was on this phase's `Requirements:` line and on NONE of its criteria. This project
     counts over criteria and never over requirements — "a requirement can outlive the phase that
     opened it; a criterion cannot" — so the work planned for CHURN-03 in plan 20-11 would have
     been built and then never scored by any verifier. That is the exact "built, not wired"
     condition this milestone exists to eliminate, reappearing in the ledger instead of the code.

     WHAT IS ALREADY TRUE: `checkpoint.ts` is complete and imported by nothing — `coordinator.ts`
     does not even import it. So this is a wiring criterion, not a build one.

     WHY "A SECOND REQUESTOR" AND NOT "RESUMES": a resume by the same process proves only that a
     value survived in memory. Handing a different requestor nothing but a CID is what makes the
     checkpoint a durable artifact rather than a variable, and it is the only reading that cannot
     be satisfied by the original job's state. -->


**Plans:** 13 plans, 7 waves

Plans:
- [x] 20-01-PLAN.md — a shard that lost its executor is placed again, under a lease: the generation loop, the two re-dispatch triggers, and renewal on evidence rather than on a timer
- [x] 20-02-PLAN.md — every node keeps a real ledger and puts its own row in it, so a peer's answer carries something the asking node could not have produced
- [x] 20-03-PLAN.md — criterion 6: a recovered node's combine result arrives late at a requestor that stopped waiting, and is received and discarded
- [x] 20-04-PLAN.md — the armed tripwire inverts: the assertion that a refused shard ends `insufficient` becomes the assertion that it reaches a second executor
- [x] 20-05-PLAN.md — criterion 2: thirty per cent of the fabric dies mid-job and the per-shard answers are byte-identical to a control on the same fabric
- [x] 20-06-PLAN.md — criterion 5: a tab shows counts it could not have produced — **delivered no plant record, no span and no exit code; see the phase's verification**
- [x] 20-07-PLAN.md — criterion 3, mechanism: a straggler is duplicated and the loser is still read, so a copy that disagrees cannot vanish into the winner
- [x] 20-08-PLAN.md — criterion 4, mechanism: the aggregate carries its denominator, as a named union so a public job says what it is instead of printing PARTIAL
- [x] 20-09-PLAN.md — criterion 3, reading: the speculation tax stops being a constant on the published surface, measured across real processes
- [x] 20-10-PLAN.md — criterion 4, reading: the partial aggregate says it is partial, with an owner's process stopped against a control on the same fabric
- [x] 20-11-PLAN.md — criterion 7: the job survives its requestor — a second requestor given nothing but a CID finishes the outstanding shards
- [x] 20-12-PLAN.md — WIRE-04: the second job path stops existing, its 32 kernel cases re-targeted or their loss recorded case by case
- [x] 20-13-PLAN.md — the ledger, the rows, and the roadmap line that was wrong

**Criterion 6 exists because Phase 16 could measure half of its own criterion 3 and said so.** The dedupe property is fully established there across nine real `bin/agent.ts` processes — probe-store deltas `+1/+0/+1`, a ninth fresh process returning the identical CID, two holders at redundancy 2 — but *"arriving late"* is not, because `executeReduce` stops at `wanted` replicas and **has no channel on which a late result could be received at all**. The duplicate in Phase 16's test is therefore solicited by the test, and `tree-reduce-agents.node.test.ts` says so about itself rather than letting the reading pass for more than it is.

This phase is where the clause becomes measurable: it owns the recovery path, so a recovered node's late result finally has somewhere to arrive. **Phase 16 keeps MR-04 open on this account** — the criterion was scheduled rather than rewritten, on the same principle that sent AUTH-03's requestor half to Phase 23: lowering a bar is not clearing it.

### Phase 21: AOT Translation Signing & Runtime
**Goal**: `translationCid` is called by the lift pipeline itself and the CLI emits the CID it produces; a production node constructs a real `WasiExecutor` so a translated artifact dispatched to a running node executes instead of failing at instantiate
**Mode:** mvp
**Depends on**: Phase 11. Otherwise independent of Phases 12-20 and runs in parallel with them, mirroring how Phase 10 ran parallel to Phases 4-9 in v1.0
**Requirements**: AOT-02, AOT-04
**Research**: None — `translationCid`, the `TranslationRecord` cache-key shape, and port conformance against a real elfconv artifact all exist and are verified in Phase 10; the gap is that the lift pipeline never calls `translationCid` and no production node builds a `WasiExecutor`
**Success Criteria** (what must be TRUE):
  1. Running `tools/aot/cli.ts` against a real AArch64 binary produces a `TranslationRecord` whose CID covers input digest, toolchain versions, target, and WASM feature set, and the CLI prints that CID to the operator
  2. Re-tagging a local translated image under a different name and pointing the CLI at it is refused rather than hashed under the borrowed name, and changing any one covered input changes the emitted CID
  3. A translated artifact produced by `tools/aot/cli.ts`, dispatched to a live node started via `bin/agent.ts`, executes successfully — the node constructs a real `WasiExecutor` in production, completing the same admission and verification path as a source-compiled module

<!-- CRITERION 2 IS PARTIAL AND HAS NO HOME. Recorded 2026-08-05 by plan 20-13 as an open
     item needing an owner ruling. **No destination is invented here** — Phases 22, 23 and 24
     were read and none of them contains a goal, a criterion or a requirement touching image
     resolution, `RepoDigests` or AOT-02, so writing one in would be inventing a schedule
     rather than recording one.

     WHAT WAS SCORED. `21-VERIFICATION.md`: 2/3 MET, 1 PARTIAL, 0 FAILED. Criterion 2's second
     clause — *changing any one covered input changes the emitted CID* — is MET, on a sweep
     plus two real lifts with two different printed key CIDs. Its first clause — *a re-tagged
     local image is refused rather than hashed under the borrowed name* — is **measured and
     NOT met**, which is a different state from unmeasured and a different state from failed.

     WHY NO PREDICATE CAN DECIDE IT, which is why this is a ruling and not a bug. `docker tag`
     gives the borrowed repository its own `RepoDigests` entry carrying the origin's manifest
     digest, so the repository match succeeds and the borrowed name is adopted. `RepoDigests`
     is a property of the image **ID**, not of the reference inspected, so once a borrowed tag
     exists the canonical name returns a **byte-identical list** — re-measured by hand on
     Docker Server 29.4.0 with the containerd image store. Requiring every entry to agree was
     measured to refuse the *canonical* image, trading an unportable name for a false refusal.
     The refusal is unchanged and still enforced where the data supports it, against a digest
     list naming only other repositories. The classic dockerd image store is unmeasured, and
     unmeasured is not met.

     THE TWO ROUTES, so the ruling has something to choose between. EITHER a mechanism that
     does not rest on `RepoDigests` — the only candidate anyone has named — OR an amendment to
     criterion 2's first clause stating the measured reading. Descoping it is not a third
     route: *descoped is not satisfied*. -->

**Plans**: TBD

**OPEN QUESTION FOR THE PLANNER — how does a 5.40 MiB artifact reach a node that does not have it? Answer this in the discuss step; do not let a plan assume it.** (Raised by the owner 2026-08-01. It is not rhetorical: criterion 3 cannot be met without an answer, because a node that cannot obtain the artifact fails at instantiate.)

**The problem is not content addressing — we have that. It is durability and fan-out.** A CID tells you whether you got the right bytes; it says nothing about whether anyone still holds them. Today the only artifact path in production is `FetchingBlockstore` over the `block` RPC branch, which asks *a* peer. That has never been exercised as real distribution, because both existing paths dodge it: `packages/demo/src/kernel.ts` **embeds** the kernel in the JS bundle (`kernel-build.node.test.ts` asserts the bytes equal the committed `kernel.wasm`), and AOT artifacts have no production caller at all. In every case so far the holder and the requestor were the same process.

Three consequences the planner must price:
- **A resolvable name for unfetchable content is worse than no name.** Phase 14 made module resolution go through a signed `key → CID` mapping. If the one node holding those bytes leaves, the record still resolves and the job fails at `WebAssembly.instantiate` instead of at resolution.
- **The browser tier loses copies silently.** IndexedDB evicts under storage pressure, and `idb-blockstore.ts` correctly treats a miss as "ask a peer" — which is only an answer while some peer has it.
- **No fan-out.** N nodes needing one module each fetch it one-peer-at-a-time. Bitswap's want-lists and sessions exist for exactly this shape; our `block` branch does not have them.

**The asymmetry that makes this tractable: an executable is public by construction, and sovereign data is not.** The two have *opposite* requirements — a module should be as widely available as possible; owner data must not move at all. They are currently served by one mechanism. The sovereignty argument that rules out third-party infrastructure for data therefore **does not apply to artifacts**, and `EgressGuard` already refuses any frame carrying a registered sovereign payload, so the separation is enforceable rather than aspirational.

**The candidate to evaluate first is `@helia/http` alone** — trustless gateway block fetching over plain HTTP as a *second, public* retrieval path for artifacts only. Note this repository **does not depend on Helia at all today** (verified 2026-08-01: no `helia`, no `@helia/*`, no `unixfs`, no `bitswap` in any manifest), despite `STACK.md` recommending it at length — so this is a dependency decision, not a configuration one.

**Explicitly do NOT adopt Helia wholesale.** Bitswap would put sovereign blocks on a general-purpose exchange protocol, and delegated routing (`delegated-ipfs.dev`) leaks query patterns to a third party. The gateway path is separable from both, and separability is the whole reason it is the candidate.

**Two traps, both already measured — do not re-derive either:**
- **Do not justify a gateway with V8 code caching.** Phase 10 tested exactly that configuration — 4.8 MB, `application/wasm`, query-free CID URL, `compileStreaming`, hot across three visits — and recorded the WASM code cache as **NOT OBSERVED**, while the same profile grew a 2 MB *JavaScript* cache and a `--v8-cache-options=none` calibration read the identical 72 B. AOT-05 records it independently. The argument for a gateway is **availability**, not warm compiles.
- **The ~43 ms lifted-startup floor is not a distribution problem and a gateway will not touch it.** Measured 2026-07-31: the lifted `_start` alone is 42.83 ms against 42.65 ms for instantiate+start — indistinguishable, so the whole floor executes *inside* the guest in elfconv's emulated machine-state init, and is re-paid per task. Content addressing fully solves distributing the 5.40 MiB; the floor stays.

### Phase 22: Reachability Guard
**Goal**: A guard test fails when a capability exported from a package barrel has no traced call path from any of the five runnable entry points — the class of defect this milestone exists to fix, made permanent
**Mode:** mvp
**Depends on**: Phases 11-21, **and Phase 24** — runs last because it verifies what every other phase claims to have wired. **Owner ruling 2026-08-05 put Phase 24 ahead of it too** (see the scheduling note in the Phase 24 block): a reachability guard that runs before admission is gated certifies a fabric with an open door. Order is **23 → 24 → 22**. If Phase 24 does not land inside the milestone, Phase 22 runs anyway and its verification says what it could not cover — ordering must not be the mechanism that hides a known gap
**Requirements**: WIRE-02
**Research**: None — the pattern to follow is `purity.node.test.ts`, which already enforces a structural property (no forbidden imports in a portable package) against real files rather than a mock. This guard does the same for call-graph reachability instead of import origin
**Success Criteria** (what must be TRUE):
  1. Running the reachability guard after Phases 11-21 land passes clean — every capability exported from a package barrel has a traced call path from one of the five runnable entry points (`bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, `tools/aot/cli.ts`, the browser demo)
  2. Reintroducing the original defect — commenting out a wired call site, or adding a new exported-but-uncalled function — fails the guard, naming the unreachable symbol and the barrel it came from, the same way `purity.node.test.ts` names a layering violation
  3. The guard runs as part of the same CI gate as the rest of the suite, so a future change that builds a mechanism without wiring it to an entry point fails CI rather than merging silently, the way the original 36 did

**Known finding, recorded in advance by Phase 15 rather than left to be discovered here.**
Phase 15 made `verifyChain` and `describeFailure` reachable from `bin/agent.ts` — AUTH-03's
serving side — but did **not** make `delegate` reachable from any of the five entry points,
so criterion 1 above will find it. Both submitting entry points dispatch public work:
`bin/bench.ts` and `packages/bench/src/perf-workload.ts` label every shard `'public'`, and
the browser demo's colouring job has no owner and no key. The minting side of a capability
chain therefore lives entirely in tests. Three options were considered and the third taken **by the plan**; the
owner then overruled it on 2026-07-31 and took the first.

**Superseded — do not read the paragraph below as the standing decision.** Plan 15-04
proposed accepting the requestor half as entry-point-unreachable. That was declined:
shipping an adapter with no callers is the defect this milestone exists to remove, and
naming it is not the same as fixing it. **The opt-in sovereign leg is now Phase 23
criterion 5**, where `bin/bench.ts` is already being rewritten and the file need only be
fought once. So criterion 1 above should find `delegate` reachable by the time this phase
runs; if it does not, Phase 23 did not finish its job and that is the finding.

*(Retained for the reasoning, not the verdict.)* Giving `bin/bench.ts` a sovereign leg
would change what the benchmark measures, which 15-CONTEXT.md decision 2 exists to
protect — hence "opt-in, off by default, default curve unmoved". Giving the browser demo
one is impossible without an owner and a private key to root a chain at, so the demo is
not the route. The identical finding is in `packages/net/src/remote-executor.ts`'s class
comment and in the Phase 15 amendment note above; both say *named here*, and both now mean
*scheduled to Phase 23*.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order **up to 21, and then deliberately not**: 1 → … → 20 → 21 → **23 → 24 → 22**.

**Phase 22 is last by construction, and this line used to say otherwise.** It ended at "→ 22" and
omitted 23 and 24 entirely, which read as though 22 came before them. Three other places in this
file and `STATE.md:227` have always said 22 runs last; this line was the odd one out and was
corrected 2026-08-05 after it misrouted a session. **23 before 22** because Phase 23 criterion 5
is what gives `delegate` and `CapabilitySupplier` a traced call path — without it Phase 22's
criterion 1 fails by construction, measured 2026-08-05. **24 before 22** by owner ruling of the
same date.

Parallel tracks (config `parallelization: true`):
- Phase 9 (benchmark) runs alongside Phases 7-8 against the dispatch API frozen in Phase 6
- Phase 10 (elfconv AOT) runs alongside everything from Phase 4 onward; it only needs Phase 5's signing infrastructure to land before its own exit
- Phase 21 (AOT translation signing & runtime) needs only Phase 11's hook contract and can run parallel to Phases 12-20, mirroring how Phase 10 ran parallel to Phases 4-9 in v1.0

<!-- "Plans Complete" is a dash throughout: this project executes phases directly
     and records each in `phases/<name>/SUMMARY.md` rather than as numbered plans. -->

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Portable Kernel & Loopback Map Slice | — | Complete | 2026-07-24 |
| 2. Real Network, Node ↔ Node | — | Complete | 2026-07-24 |
| 3. Browser Tier & Backbone Relay | — | 5 of 6 criteria — real AutoTLS needs a publicly reachable host | 2026-07-26 |
| 4. Sovereignty, Authorization & Artifact Signing | — | Built and unit-verified; **not wired** — no production path reaches it (v1.0 audit) | 2026-07-25 |
| 5. Decomposable Tree-Reduce | — | Built and unit-verified; **not wired** — `executeReduce` has no caller; the demo merges with a linear scan | 2026-07-25 |
| 6. Discovery, Placement & Enrollment | — | Built and unit-verified; **not wired** — `discoverExecutors` and `requestEnrollment` have no callers | 2026-07-26 |
| 7. Churn, Stragglers & Coordinator Survival | — | Built and unit-verified; **not wired** — `runResilient` has no caller, and `submitJob` is the only job path | 2026-07-26 |
| 8. Benchmark Harness | — | 4 of 5 criteria — BENCH-06's distinct-machine half descoped to one host 2026-07-28; unmeasured, not met | 2026-07-26 |
| 9. Public Demo, Consent UX & Disclosure Gate | — | Complete — the two-device run was done by the owner and found two defects | 2026-07-26 |
| 10. elfconv AOT Native→WASM Pipeline | — | 3 of 4 criteria — code cache measured and does not happen; cross-machine CID descoped to one host 2026-07-28, unmeasured, not met | 2026-07-27 |
| 11. Explicit serveAgent Hook Contract | 1/1 | Complete   | 2026-07-27 |
| 12. Sovereignty-Pinned Placement | 4/4 | Complete   | 2026-07-27 |
| 13. Egress Manifest Completeness | 3/3 | Complete   | 2026-07-27 |
| 14. Signed Artifact Resolution | 0/TBD | Not started | - |
| 15. Capability-Chained Dispatch | 0/TBD | Not started | - |
| 16. Decomposable Tree-Reduce Wiring | 0/TBD | Not started | - |
| 17. Node Identity & Enrollment | 0/TBD | Not started | - |
| 18. Discovery, Capacity & Placement | 3/11 | In Progress|  |
| 19. Quorum Composition & Owner-Domain Attestation | 0/TBD | Not started | - |
| 20. Single Job Path, Ledger & Churn Resilience | 0/TBD | Not started | - |
| 21. AOT Translation Signing & Runtime | 0/TBD | Not started | - |
| 22. Reachability Guard | 0/TBD | Not started | - |

### Phase 23: Multi-Process Benchmark Driver
**Goal**: The benchmark harness spawns N real operating-system processes instead of N `FabricNode`s on one event loop, so a parallel speedup is measurable at all — and the project's central scaling claim stops being unmeasured
**Mode:** mvp
**Depends on**: Phase 8 (the existing harness), Phase 12 (the spawn pattern), Phase 15 (AUTH-03's requestor half — see criterion 5)
**Requirements**: BENCH-07 (new), AUTH-03 (requestor half, routed here by owner ruling 2026-07-31)
**Research**: None — `sovereignty-placement.node.test.ts` and `two-process.node.test.ts` already spawn real `bin/agent.ts` processes via `spawn(process.execPath, [AGENT, '--dir', dir, ...])`. The work is moving `bin/bench.ts`'s node construction onto that pattern
**Success Criteria** (what must be TRUE):
  1. A benchmark run at N nodes spawns N operating-system processes, verified by reading the child PIDs, and the published run records them — a run that silently falls back to in-process nodes fails the harness rather than reporting a curve
  2. Makespan at N=1 and N=8 differ on a fixture with enough work to saturate a core, and the ratio is published; a flat curve is a finding, but it must be a finding about the fabric rather than about the harness
  3. The real-transport rungs Phase 8 published as excluded either run, or are re-excluded with a measurement showing the per-host inbound cap is still the cause under separate processes. **Corrected 2026-08-05: this is ONE rung, not the two the criterion was written against.** The clause said *"8 and 16 nodes, dying on `INBOUND_CONNECTION_THRESHOLD = 5` per host"*; the committed run (stamped `2026-08-01T06:09:01.272Z`) excludes exactly one row — `real transport, 16 nodes` — and the **8-node rung already runs**, at `n = 19` with `incomplete = 0`. The scope change must be **stated in the published section, not absorbed**: this project's own rule is that a rung which vanishes between plan and results is indistinguishable, to a reader, from one removed because its number was inconvenient. The same rule applies to one that quietly appears. **Corrected again 2026-08-06, and this time the criterion's own premise is what changed.** The second disjunct asks for a measurement showing *"the per-host inbound cap is still the cause"*. 23-04's eight-cell factorial, reproduced identically three times, **refuted that cause rather than confirming it**: the outcomes partition cleanly on **dial direction**, and driver and cap placement each appear on *both* sides — A fails at the derived cap, B fails pinned back to 5, and E completes with the agents at 5. The blamed constant was never in force: a live node announces `inboundConnectionThreshold=15 maxIncomingPendingConnections=15`, not the 5 the exclusion named. So the criterion **passes on its FIRST disjunct** — the rung runs, at attempts C, D and E, D being the process driver at this phase's headline configuration. A reader checking the second disjunct literally will find a contradiction, and this note is why: the disjunct is retained for the reasoning, not for the verdict. The published ladder was **not** re-taken, so its excluded row stands as a true report of what that arrangement produced
  4. `BENCHMARK-RESULTS.md` states, for every published figure, whether it came from the single-process or the multi-process driver — no figure is silently replaced
  5. **`bin/bench.ts` gains an opt-in sovereign leg, off by default, that mints a real capability chain and dispatches an owner-labelled shard through it** — giving `delegate` and `CapabilitySupplier` a traced call path from a runnable entry point, so Phase 22's guard finds them reachable. The default public curve must be **byte-identical in shape** to a run with the flag absent; if the leg moves the default measurement, it has been built wrong

**Criterion 5 exists because of an owner ruling, and the alternative was cheaper to write down than to take.** Phase 15 wired AUTH-03's *serving* end and verified it end to end, but left `delegate`, `CapabilitySupplier` and `RemoteExecutor.execute`'s supplier branch as a production adapter nothing in production reached — every one of the five production dispatch sites labelled its shards `'public'`, which have no owner and therefore no root key to mint a chain at. That is the exact "built, not wired" shape this milestone exists to remove, so shipping it as *accepted unreachable* was declined on 2026-07-31. **That state of affairs ended on 2026-08-06 and the past tense above is deliberate**: 23-06 delivered the leg, `bin/bench.ts` now calls `delegate` at two production sites and ships a `'sovereign'`-labelled shard, and a spawned run printed an agreed sovereign shard rooted at the enrolled owner key. **AUTH-03's checkbox still does not move** — the leg sits behind `--discover --sovereign`, both off by default, and whether that is *entry-point reachable* is Phase 22's guard's ruling, which is why Phase 22 runs last.

It lands **here** rather than in Phase 15 for one reason: this phase already rewrites `bin/bench.ts`'s node construction, and `bin/bench.ts` is the most contended file in the repository — six phases modify it. Doing the sovereign leg in Phase 15 would have meant fighting that file twice. The costs Phase 15 measured still apply and are the work of criterion 5: `realFabric`'s worker nodes start with no `sovereignty` configuration at all, so each needs an owner id, an owner key and clearance; the requestor needs a per-node chain minted against each worker's peer id; and `memoryFabric`'s nodes are raw `serveAgent` calls on `authorize: 'serves-unauthenticated'`, so the leg proves nothing there — which is precisely why it must stay opt-in and why the two published curves must keep measuring the same thing.

**Why this phase exists.** Phase 8's own SUMMARY says it plainly: *"Every node in both curves runs inside one OS process on one JavaScript event loop ... no parallel speedup is measurable here at all ... the scaling claim remains unmeasured."* That has been read ever since as part of the BENCH-06 "needs a second machine" blocker. It is not. Phase 8 named the cheaper remedy itself — separate OS processes on one host — and Phase 12 has since built exactly that spawn harness for an unrelated reason. The blocker moved and nobody noticed.

**What this phase is not.** It does not make a one-host curve a distributed one. BENCH-06 was rewritten on 2026-07-28 to what one host establishes; the distinct-machine claim it used to carry is **descoped and unmeasured — not met, and not transferred to this phase**. A same-host run has one CPU, one V8 and one libc, so it cannot detect divergence between machines whatever the process count. Phase 8's rule that a same-machine run is labelled as such carries forward unchanged, and AOT-03's `CROSS_MACHINE_BLIND_SPOT` is untouched by any of this.

**Trap to avoid.** The COST crossover measures the guest ABI on a trivial fixture, not the fabric. Criterion 2 requires a fixture that does non-trivial work, or the new curve reproduces the old one's real problem with more processes.

**The figure this paragraph used to quote was stale, and by more than an order of magnitude.** It read *"published at ~570×"*. The committed `BENCHMARK-RESULTS.md` publishes **7086.14×**. The old Plan 23-05 asserted `573.16×` — against `BENCHMARK-RESULTS-2026-07-27.md`, **a file that does not exist**. Corrected 2026-08-05. The trap is unchanged and if anything sharper at the real number; only the citation was wrong.

**Plans**: **6 plans, 5 waves** — replanned in full on 2026-08-05 (commit `3dca149`) after the original five were measured against the tree they would actually run on and 21 premises came back false. `23-01` and `23-02` in wave 1 (disjoint files), `23-03` wave 2, `23-04` wave 3, `23-06` wave 4, `23-05` wave 5 with `autonomous: false`.

`23-06` is new and carries criterion 5 — `[BENCH-07, AUTH-03]`. **None of the original five mentioned `AUTH-03`, `delegate` or `CapabilitySupplier` even once**: they were committed 2026-07-29 and criterion 5 was minted by owner ruling on 2026-07-31, so the plan set was never written against this phase's actual scope. That is chronological rather than an oversight in review, and it is why this was a replan and not an amendment.

**`23-05` sits behind `23-06`, not beside it.** A leg that breaks the default run has to be caught before the numbers are taken, not after.

## Requirement Coverage

### Phase 24: Certificate-Gated Admission
**Goal**: The network's front door is locked — a node that cannot present a provider-issued certificate cannot reserve a circuit, be advertised, or be dialled, so an identity that was never issued buys nothing
**Mode:** mvp
**Depends on**: Phase 19 (which opened the clause), and see the scheduling note below on Phase 22
**Requirements**: AUTH-02, AUTH-04
**Research**: Done 2026-08-04, read-only pass, recorded in `phase-24-certificate-gated-admission/24-CONTEXT.md`
**Success Criteria** (what must be TRUE):
  8. Enrolment's cost is bounded by admission, not by a counter: a node that cannot present a provider-issued certificate cannot join the fabric, advertise itself, or be dialled by another node — so an identity that was never issued buys nothing, and the N-th identity costs an attacker a provider's willingness to sign it

<!-- CRITERION 8 ADDED 2026-08-04 BY OWNER RULING, replacing a stalled criterion in Phase 19.

     PHASE 19's CRITERION 5 read "enrolment costs something unmintable, and the N-th identity
     costs more than the first". It verified PARTIAL twice: the unmintable half is delivered and
     measured across real processes including restart and two-provider recovery, but the N-th
     identity is REFUSED inside the issuance window rather than PRICED. Measured comparatively:
     a provider's cost to refuse over an attacker's cost to mint a fresh identity is ~3.0, and
     over a replay ~1397 — so an attacker burns the window at roughly a third of what refusing
     costs, and the denial then applies to every honest node for the rest of the window at no
     further cost.

     THE OWNER'S RULING, 2026-08-04, and it relocates the guard rather than lowering the bar:
     *"The lifecycle of the node in the network starts from connecting to the relay. If the node
     that connects in can authenticate itself with certificate issued by provider, then it gets
     in to advertise itself in the network and connect to nodes. If it cannot authenticate — it
     cannot join the network and connect to other nodes."*

     WHY THAT ANSWERS THE COST CLAUSE RATHER THAN DUCKING IT. A price only deters when the thing
     bought is worth something. Under this ruling an unissued identity is worth NOTHING — it
     cannot join, advertise or be reached — so the cost of the N-th identity is not CPU, it is a
     provider's signature, which is exactly the unmintable thing the first half of the criterion
     already secured. The counter stops being the defence and becomes an accounting detail.

     WHAT THIS DOES NOT EXCUSE. Enrolment itself is still served unauthenticated — it must be,
     since it is how a node gets its first certificate — so a provider can still be made to spend
     CPU refusing. What changes is that the attacker gains no foothold for it. That residual is
     to be measured and pinned, not argued away.

     THE MEASURED MITIGATION THAT DOES NOT WORK, recorded so it is not re-tried: a capacity slot
     on the `enrol` branch served 8 of 8 concurrent enrolments, because `enrol` is synchronous so
     the bound never binds; in a rig where an `exec` held the shared table it served 0 of 8. It
     bounds the wrong verb. -->

<!-- SCHEDULED LATER BY OWNER RULING 2026-08-04, and the state it leaves in place is KNOWN AND
     ACCEPTED rather than undiscovered. Owner: *"yes, I know. Plan it for later."*

     THE STATE, so the next reader does not file it as a fresh emergency and repeat the
     investigation. The relay authenticates NOTHING: `circuitRelayServer` is constructed with
     capacity limits only, no ACL and no gater, so a joining peer presents a Noise handshake and
     nothing else. `SeedServer` publishes every reservation holder to every arriving browser
     without a filter, and the `reservations`, `records` and `providers` answers are served to
     anyone. **Every certificate check in the repository gates SELECTION — which peer I choose to
     fetch from or dispatch to — and none gates ADMISSION.** The fabric admits everyone and
     filters late. `peer-gate.node.test.ts` already recorded gating relay use as "UNMEASURED, not
     descoped"; this phase is what measures it.

     TWO FACTS THAT MAKE THE SELECTION GATES WEAKER THAN THEY LOOK. `PeerVerifier` FAILS OPEN —
     pinned nobody means trust everybody — and its own header records that not one `FabricNode`
     in this repository configures an anchor. And `SeedServerOptions` has no `trustedIssuers`
     field at all, so the front door cannot be asked to check even if somebody wanted it to;
     `--trust-anchor` on `bin/seed.ts` is module provenance (DET-03), a different thing wearing a
     similar name.

     WHY THIS CRITERION IS THE ANSWER TO PHASE 19's CRITERION 5 rather than a replacement for it.
     19's criterion 5 verified PARTIAL twice: the unmintable half is delivered, but the N-th
     identity is REFUSED inside an issuance window rather than PRICED, and an attacker burns that
     window at roughly a third of what refusing costs. A price only deters when the thing bought
     is worth something — and under gated admission an unissued identity is worth NOTHING, so the
     cost of the N-th identity is a provider's signature, which is the unmintable thing the first
     half already secured. Same carry-forward pattern as 18's 2b -> 20's criterion 1, 16's
     criterion 3 -> 20's criterion 6, and 17's criterion 2 -> 18's 2d.

     WHAT IS NOT EXCUSED BY IT. Enrolment stays unauthenticated because it must be — it is how a
     node gets its first certificate — so a provider can still be made to spend CPU refusing. That
     residual is to be measured and pinned, not argued away. And the mitigation everyone reaches
     for does NOT work, measured: a capacity slot on the `enrol` branch served 8 of 8 concurrent
     enrolments because `enrol` is synchronous so the bound never binds; in a rig where an `exec`
     held the shared table it served 0 of 8. It bounds the wrong verb.

     A TOPOLOGY REQUIREMENT THIS PHASE CREATES. Enrolment is a DIRECT dial on both tiers and does
     not route through a reservation, so gating the reservation still leaves a tab able to enrol —
     because for a browser tab the provider and the relay are the SAME node at the SAME address.
     That resolution is available today and fails the moment a deployment separates them. The
     requirement must be stated, not assumed.

     CORRECTED 2026-08-05 — the first two clauses hold, the causal one does not, and it is wrong
     in BOTH directions. Measured against `BrowserNode.#compose`:

       - SEPARATION DOES NOT BREAK ENROLMENT. A denied reservation does not fail the relay-dial
         loop: the loop asserts only that the DIAL resolved, and nothing in `#compose` reads
         whether a reservation was granted. The tab proceeds to `resolveCertificate` and enrols
         over its own plain connection. So the door stays open for enrolment in the SEPARATED
         topology too — the co-location premise is not load-bearing for this half.
       - CO-LOCATION IS NOT WHAT MAKES IT WORK, and it is not even guaranteed. `relayAddrs` and
         `enrollment.providerAddr` are two independent parameters and NOTHING checks they agree.
         In `demo/main.ts` they come from entirely separate sources — `relayAddrs` from
         `discoverRelays()` (a `?relay=` query param or the origin's `/o2-info` JSON),
         `providerAddr` from whatever the host page passes.

     THE ACCURATE FORM IS ALREADY AT THE LINE, in `packages/libp2p/src/relay-admission.ts`:
     *"A relay that pins issuers must either serve enrolment itself, or name a provider a joining
     peer can reach without a reservation."* This roadmap is corrected to match the source; the
     source was right first.

     AND ARMING STILL CLOSES THE DOOR IT AIMS AT, which is the part worth keeping.
     `BootstrapInfo.peerAddrs` is `[seedAddr, ...node.reservedPeerIds.map(...)]` and `agent.ts`'s
     `reservations` branch answers from the same thunk, so an unreserved peer is structurally
     absent from both advertisement surfaces — no filter to add and no `if` to forget.

     UNNAMED BY ANY PLAN, and it belongs in one: in the separated topology a tab whose reservation
     is refused still completes its relay dial, does not fail `#compose`, enrols against a provider
     at a different address, then holds a certificate and re-reserves.

     SCHEDULING NOTE FOR THE OWNER. Phase 22 currently "runs last because it verifies what all
     eleven other phases claim to have wired". A reachability guard that runs BEFORE admission is
     gated passes over a fabric with an open door. Whether that matters depends on what WIRE-02
     actually claims, and it is an owner decision rather than a planner's.

     RULED 2026-08-05: Phase 22 runs AFTER Phase 24. The order is 23 -> 24 -> 22, and Phase 24's
     waves 2-4 are un-deferred to make that possible. The reasoning the owner took: a guard is
     worth what it covers, and certifying reachability over a fabric whose admission gate is
     deliberately unarmed certifies the wrong fabric. Task #51 already records that the deferral
     has no armed tripwire, so the alternative was to ship two known-open things at once.

     THE ESCAPE HATCH IS PART OF THE RULING, NOT A CAVEAT. If Phase 24 does not land inside this
     milestone, Phase 22 runs anyway and 22-VERIFICATION.md states plainly that it certified
     reachability over an ungated fabric. Ordering must never become the mechanism by which a
     known gap stops being visible. -->


### v1.0 (Phases 1-10)

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

Note: the "Phase" column above records where each requirement's *mechanism* was built.
36 of these 72 were reclassified `[ ]` **Built, not wired** by the v1.0 audit — the
mechanism exists at the phase listed, but no runnable entry point reaches it. See the
v1.1 table below for where each is being wired.

### v1.1 — Wire What Was Built (Phases 11-22)

44 of 44 v1.1-scoped requirements mapped, each to exactly one phase — 40 existing IDs
reclassified *Built, not wired* by the v1.0 audit, plus 4 new IDs (WIRE-01…04) that have
no v1 equivalent.

| Phase | Requirements | Count |
|-------|--------------|-------|
| 11 | WIRE-01 | 1 |
| 12 | DATA-03, DATA-04, DATA-07, DATA-09 | 4 |
| 13 | DATA-05, DATA-06 | 2 |
| 14 | DET-03, DATA-08 | 2 |
| 15 | AUTH-03 | 1 |
| 16 | MR-02, MR-03, MR-04, MR-05, MR-06, MR-07 | 6 |
| 17 | AUTH-01, AUTH-02, AUTH-04 | 3 |
| 18 | SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05, NET-05 | 6 |
| 19 | AUTH-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10, WIRE-03 | 8 |
| 20 | WIRE-04, CHURN-01, CHURN-02, CHURN-03, CHURN-04, CHURN-05, CHURN-06, BROW-02 | 8 |
| 21 | AOT-02, AOT-04 | 2 |
| 22 | WIRE-02 | 1 |
| **Total** | | **44** |

Explicitly out of scope for v1.1 — not mapped to any v1.1 phase, stay open against their
v1.0 phase: **NET-03** (Phase 3 — needs a publicly reachable host), **BENCH-06** (Phase 8)
and **AOT-03** (Phase 10) — both rewritten 2026-07-28 to what one host establishes, with
their cross-machine halves **descoped and unmeasured, not met** — and **AOT-05** (Phase 10
— a measured negative, reported unmet rather than reworded).

---

## Milestone v1.1 — Wire What Was Built (Phases 11-22)

**Added 2026-07-27, as the direct output of the v1.0 milestone audit.** Phases 11-22
above are the real phase breakdown; this section replaces the earlier scoping
placeholder.

v1.0 built four phases' worth of mechanism that no runnable entry point reaches:
sovereignty labelling, tree-reduce, discovery, enrollment, quorum composition,
capability chains, and the entire churn coordinator. 36 requirements were *Built, not
wired*. The code is real and tested; the wire was missing.

**The sequencing is deliberate, not alphabetical.** Phase 11 fixes the structural
cause — `serveAgent`'s six silently-defaulting hooks become an explicit, compile-checked
contract — before anything else, because that is what turns the remaining 35
requirements into build failures at their call sites rather than something a person has
to go looking for a year later. Phases 12-15 wire sovereignty, egress, signing, and
capability dispatch (the mechanism built in v1.0 Phase 4); Phase 16 wires tree-reduce
(v1.0 Phase 5); Phases 17-19 wire identity, discovery, placement, and quorum composition
(v1.0 Phase 6, split three ways at fine granularity — enrollment and certificates first,
since discovery and quorum composition consume them); Phase 20 collapses `runResilient`
and `submitJob` into the one job path and wires churn resilience plus the peer ledger
(v1.0 Phase 7, plus two partials); Phase 21 finishes the AOT pipeline's two open wiring
gaps (v1.0 Phase 10); Phase 22 is the reachability guard that would have caught this
milestone happening in the first place — it runs last because it verifies the other
phases actually did what they claim. **Last means after 23 and 24, not after 21** — the
execution order is 23 → 24 → 22, and both of those dependencies are load-bearing rather
than tidy: Phase 23 criterion 5 is what makes Phase 22 criterion 1 passable at all, and
Phase 24 is what makes the fabric it certifies a gated one (owner ruling 2026-08-05).

Almost no code here is algorithmically novel — the mechanisms already exist, unit-tested,
in the v1.0 phase directories. Each v1.1 phase's job is to make a runnable entry point
(`bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, `tools/aot/cli.ts`, or the browser demo)
actually call it.

**Not in v1.1** (per PROJECT.md): NET-03 (needs a publicly reachable host), BENCH-06 and
AOT-03 (rewritten 2026-07-28 to what one host establishes; their cross-machine halves are
descoped and unmeasured, not met — see PROJECT.md's residual entry), AOT-05 (a measured
negative — reported unmet rather than reworded until re-run against an `https` origin says
otherwise).
