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

## Phase Details

### Phase 1: Portable Kernel & Loopback Map Slice
**Goal**: As a job requestor, I want a complete job — shard, execute redundantly, verify, return a result CID — to run end to end inside one process on all three targets, so that I get a verified result CID back with no networking whatsoever.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A complete job — shard, execute redundantly, verify, return a result CID — runs end to end inside one process on all three targets, with no networking whatsoever
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
**Goal**: As a node operator, I want the same job to run across two real operating-system processes over a real network transport, so that the job I ran on one machine still completes when it is split across two.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The same job runs across two real operating-system processes over a real network transport, proving the port boundary was drawn in the right place
**What the user-story form did not carry:** The original's closing clause — *proving the port boundary was drawn in the right place* — is an architectural proof about the codebase, not an outcome any actor experiences, so it survives only in the original wording above.
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
**Goal**: As a browser visitor, I want two browsers — or two isolated browser contexts — on one machine to run a distributed, redundant job against a self-hosted backbone that requires no manual certificate operations, so that the project's core bet is demonstrated on the machine in front of me.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Two browsers — or two isolated browser contexts — on one machine run a distributed, redundant job against a self-hosted backbone that requires no manual certificate operations — the project's core bet, demonstrated
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
**Goal**: As a data owner, I want owner-pinned data to be a hard scheduling constraint the placer has no code path to relax, and every artifact the fabric executes to be resolved through a signed name rather than a bare CID, so that my data cannot be scheduled off my node and the code that touches it has provenance and not merely integrity.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Owner-pinned data becomes a hard scheduling constraint the placer has no code path to relax, and every artifact the fabric executes is resolved through a signed name rather than a bare CID
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
**Goal**: As a job requestor, I want cross-owner aggregation to happen up a hierarchical tree that every participant derives identically, so that my job aggregates with no all-to-all shuffle, no consensus, no leader election, and no state to migrate when an aggregator disappears.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Cross-owner aggregation happens up a hierarchical tree that every participant derives identically — no all-to-all shuffle, no consensus, no leader election, and no state to migrate when an aggregator disappears
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
**Goal**: As a node operator, I want the static peer list the previous phases leaned on to disappear, so that nodes find each other and decide where work runs from local information, under identity and diversity constraints that make a forged quorum expensive.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The static peer list the previous phases leaned on disappears — nodes find each other and decide where work runs from local information, under identity and diversity constraints that make a forged quorum expensive
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
**Goal**: As a job requestor, I want my job to finish correctly when the machines running it — including the machine that submitted it — go away mid-flight, so that churn costs me a wait rather than a result.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A job finishes correctly when the machines running it — including the machine that submitted it — go away mid-flight
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
**Goal**: As the project owner, I want the scaling claim to become a reproducible published number with its costs included rather than excluded, so that I can publish a claim that is separate from and harder than "it works".
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The scaling claim becomes a reproducible published number with its costs included rather than excluded — a separate and harder claim than "it works"
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
**Goal**: As a browser visitor, I want to open a page, understand exactly what will run, choose to allow it, and contribute to a job someone actually cares about, so that nothing runs on my machine that I did not knowingly allow.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A visitor opens a page, understands exactly what will run, chooses to allow it, and contributes to a job someone actually cares about — while publication remains a deliberate human action rather than a consequence of a phase completing
**What the user-story form did not carry:** The original's closing clause — *publication remains a deliberate human action rather than a consequence of a phase completing* — is the project owner's disclosure gate and belongs to a different actor than the visitor this story names; it survives only in the original wording above and in success criteria.
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
**Goal**: As a publisher of signed artifacts, I want a statically-linked native binary to become a fabric-executable artifact, so that it is admitted, signed, and verified by exactly the same checks as a source-compiled module.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A statically-linked native binary becomes a fabric-executable artifact under the same admission checks, signing, and verification as a source-compiled module
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

## Milestone v1.1 — Wire What Was Built (Phases 11-22)

> **MOVED HERE 2026-08-18 — this heading used to sit at the END of the file, and its position
> was a defect rather than a style choice.** `gsd-sdk`'s roadmap parser scopes a milestone to the
> slice running from its `##` heading to the next milestone heading, and it deliberately excludes
> everything before — *"never include the preamble, which may contain ## Backlog and other
> non-current-milestone phases."* With this heading below all 28 phase sections, that slice was
> prose, and `gsd-sdk query roadmap.analyze` reported **`phase_count: 1`**. `/gsd-autonomous`
> discovers work from exactly that call, and its filter keeps a phase when `disk_status !==
> "complete"` **OR** `roadmap_complete === false`, so it would have re-planned and re-executed
> Phase 28 — complete, 4 plans and 4 summaries — and then run audit → complete-milestone →
> cleanup off a phase count of one.
>
> **Nothing was reworded and no phase moved.** The heading and its prose were relocated whole,
> above the phases they scope, and the file verified as a permutation of itself. Phases 1–10 now
> fall in the preamble, which is correct: they are v1.0. Measured after: **19 phases (11–28),
> 124 plans, 132 summaries** — matching an independent count of the phase directories.
>
> **The `(Phases 11-22)` in this heading is stale and is left alone deliberately.** 23 and 24
> were inserted by owner ruling 2026-08-05, and 25–28 were added later. Editing it would restate
> what the milestone contains, which changes the denominator `STATE.md` counts criteria against —
> an owner edit, not a formatting one. `STATE.md` scopes v1.1 as phases 11–24 and counts
> **12 of 15 on criteria**, with 20 (6/7), 21 (2/3) and 22 (2/3) verified-but-uncounted.

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

### Phase Checklist

**Moved here 2026-08-18 from `## Phases`, and NO TICK STATE WAS CHANGED.** The list lived in
the document preamble, which `gsd-sdk`'s roadmap parser excludes from the current milestone by
design — so every checkbox lookup missed and every phase read `roadmap_complete: false`,
whatever the box said. Phases 1–10 stay in `## Phases` above: they are v1.0 and belong to the
preamble.

**Entries for 25–28 are new and deliberately UNTICKED** — they had no checklist row at all, so
their absence was being read as "not complete" already. Adding them changes no verdict.

**Ticking any box here records a VERIFIER'S VERDICT and is an owner edit.** Eleven of these are
unticked while `STATE.md` counts them closed — see the note under the heading above. Do not tick
them to make a tool report progress; that is the move RULING A exists to prevent.

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
- [ ] **Phase 25: X.509 Certificate Profile** - A bounded, hand-written DER decoder for exactly this profile, with all seven obligations as refusals
- [ ] **Phase 26: elfconv Compiled to Wasm — Translation as a Fabric Workload** - The translator itself becomes a fabric-executable artifact
- [ ] **Phase 27: The Demo UI, Driven by the Real Fabric** - Every surface a visitor reads is derived from the fabric rather than from a fixture
- [ ] **Phase 28: One Cryptographic Implementation, and the Facades Ledgered** - `packages/core` holds exactly one Ed25519 implementation rather than two

### Phase 11: Explicit serveAgent Hook Contract
**Goal**: As a developer, I want every `serveAgent` call site to state an explicit value for all six hooks — `authorize`, `index`, `capacity`, `ledger`, `reservations`, `onDispatch` — so that an omission is a compile error I see at the call site, not a default nobody noticed.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Every `serveAgent` call site states an explicit value for all six hooks — `authorize`, `index`, `capacity`, `ledger`, `reservations`, `onDispatch` — so an omission is a compile error a developer sees at the call site, not a default nobody noticed
**Mode:** mvp
**Depends on**: Nothing new — builds directly on the v1.0 codebase. Sequenced first within v1.1, ahead of every other phase in this milestone, because it is the structural cause the other 35 unwired requirements share: making the hooks non-optional turns each remaining capability into a build failure at its call site rather than a fact someone has to go looking for
**Requirements**: WIRE-01
**Research**: None — this is a signature change to an existing, fully-understood function (`packages/net/src/agent.ts:65-120`) plus updating its five known call sites; no new algorithm or library
**Success Criteria** (what must be TRUE):
  1. Removing any single hook argument from a `serveAgent(...)` call in `packages/node/src/bin/agent.ts`, `bin/seed.ts`, or the browser node bootstrap fails `tsc --noEmit`, naming the missing hook — omission is a compile error, not a silent default

     **CORRECTED 2026-08-22 — the file list names two files that hold no `serveAgent(` call, and held none at this phase's completion commit either.** `grep -rn "serveAgent" packages/node/src/bin/agent.ts packages/node/src/bin/seed.ts packages/node/src/seed-server.ts` returns two comment mentions in `agent.ts` (`:488`, `:547`) and nothing at all in the other two; `git show 7680fd5:packages/node/src/bin/agent.ts | grep -c serveAgent` returns `0`, so this was never a description of the tree it was written against. The literal call sites are `packages/net/src/agent.ts` (the definition), `fabric-node.ts`, `browser-node.ts`, `bin/bench.ts` (×2) and `packages/bench/src/perf-workload.ts` (×2). Of the three locations this criterion names, only the browser node bootstrap holds one. `bin/agent.ts` reaches `serveAgent` transitively through `FabricNode.start`; `bin/seed.ts` through `SeedServer.start`, which constructs a `FabricNode`. **The property is unchanged and was watched failing** — `11-VERIFICATION.md:76-88` records the planted mutation breaking `browser-node.ts(213,7)` and `fabric-node.ts(358,7)` and states plainly that "neither file calls `serveAgent` directly — both reach it transitively". That reconciliation was made at verification time and never carried back into this line, so the criterion has since been telling a reader to perform an edit in two files where the named call does not exist. The guard that actually carries the criterion is `packages/node/src/serve-agent-hooks.node.test.ts`, which reads the four files that do hold the call. Only the enumeration was wrong.
  2. Every production call site that starts a node — `bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, and the browser demo — passes all six hooks explicitly; grepping production source for `serveAgent(` shows no call with fewer than six named hook arguments
  3. Starting two nodes via `bin/agent.ts` and dispatching a job between them still completes successfully after the refactor, and the already-fixed `reservations` hook continues to answer real peer IDs rather than regressing to `[]`
**Plans**: 1 plan

Plans:
- [x] 11-01-PLAN.md — Define the required six-hook AgentOptions contract, sweep all 4 production and 6 test call sites, and build the compile-failure + sentinel-count guards proving criteria 1 and 2

### Phase 12: Sovereignty-Pinned Placement
**Goal**: As a data owner, I want a sovereignty label to travel with my data and pin its map task to my node on the one live job path, so that pushdown and backbone execution-ineligibility are enforced where real jobs run — not only in a test that builds its own fabric by hand.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A sovereignty label travels with its data and pins its map task to the owner's node on the one live job path, with pushdown and backbone execution-ineligibility enforced — not only in a test that builds its own fabric by hand
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
**Goal**: As a data owner, I want both `FabricNode` and the browser node to construct their `RpcEndpoint` over an `EgressGuard`-wrapped transport instead of the raw `Libp2pTransport`, so that the egress manifest recording what left my node is complete by construction on a real job.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Both `FabricNode` and the browser node construct their `RpcEndpoint` over an `EgressGuard`-wrapped transport instead of the raw `Libp2pTransport`, so the egress manifest is complete by construction on a real job
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
- [x] 13-04-PLAN.md — Make EgressGuard.send refuse a frame carrying a registered sovereign payload instead of forwarding it, and invert every @o2/net assertion that encoded the forward-anyway behavior
- [x] 13-05-PLAN.md — Prove the refused job fails and its shard stalls rather than relocating, in process against real FabricNodes and across two spawned bin/agent.ts processes
- [x] 13-06-PLAN.md — Restate the DATA-05/DATA-06 ledger rows against the amended criteria, and guard bin/bench.ts's egress leg with a test rather than the type-checker alone
- [x] 13-07-PLAN.md — Release a sovereign registration from the serve path once its reply frame has settled, so scan cost is bounded by in-flight tasks rather than node uptime

### Phase 13.1: Node-Side Admission & Transport Bounds (INSERTED)
**Goal**: As a node operator, I want my node to refuse work it cannot run with a stated reason, and neither side of the wire to be drivable past a bound by a peer, so that three defects measured against the real stack rather than inferred are closed.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A node refuses work it cannot run, with a stated reason, and neither side of the wire can be driven past a bound by a peer — closing three defects measured against the real stack rather than inferred
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
**Goal**: As a node operator, I want my production node to resolve a task's module through a `key → CID` mapping signed by a trusted build authority — never a bare CID — on the live dispatch path, so that I only execute code a trust anchor I pinned has vouched for.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A production node resolves a task's module through a `key → CID` mapping signed by a trusted build authority — never a bare CID — on the live dispatch path
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
**Goal**: As a data owner, I want a task dispatched between two live nodes to carry a capability chain rooted at my key, verified by the receiving node's `authorize` hook before `WebAssembly.instantiate`, so that nothing reaches my data without authorization I granted — the serving end wired and verified end to end.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A task dispatched between two live nodes carries a capability chain rooted at the data owner's key, and the receiving node's `authorize` hook verifies it before `WebAssembly.instantiate` — the serving end wired and verified end to end; the requestor end wired to a required constructor argument that every production call site declines, so its supplier branch has no entry-point caller
**What the user-story form did not carry:** The original's closing clause — *the requestor end wired to a required constructor argument that every production call site declines, so its supplier branch has no entry-point caller* — records the phase's wiring state rather than any actor's capability, so it does not translate into the story and survives only in the original wording above (and in the dated AMENDED note further down this entry, which supersedes it).
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

**AMENDED 2026-08-22 — the Goal's closing clause is now the phase's entry premise, not the tree's state.** That clause reads *"the requestor end wired to a required constructor argument that every production call site declines, so its supplier branch has no entry-point caller."* It was true at this phase's close on 2026-07-31, and the note above is the record of why. It is false today, and the correction is recorded here rather than only in a later phase's summary because this is the entry an auditor greps. `bin/agent.ts` builds `sovereignSupplierFor` (`:2222`), which mints a chain with `delegate(seed, {…})` (`:2236`) rooted at the task's own owner and audienced to `audienceKeyOf(nodeId)`, and passes it as `dispatch:` to `discoverCandidates` (`:2310`); `discoverCandidates` hands it to every `RemoteExecutor` it constructs (`packages/net/src/discover-candidates.ts:218-223`), so the supplier branch of `RemoteExecutor.execute` is reached from an entry point. `bin/bench.ts` does the same on its `--sovereign` arm — `dispatch:` at `:1575`, `delegate` at `:1031`, `:1081` and `:1166` — which is Phase 23 criterion 5, delivered 2026-08-06, exactly the destination the owner ruling above sent it to. Both legs sit behind flags and both rulings on those flags are on record: `bench.ts`'s needs `--discover --sovereign`, and `agent.ts`'s `--sovereign-owner` was ruled a role selector rather than a feature gate on 2026-08-18 (`.planning/consults/2026-08-18-owner-ruling-role-selector-vs-feature-gate.md`), which is what let `REQUIREMENTS.md` move AUTH-03 from *Partial* to **Done — CLOSED 2026-08-19**. `packages/net/src/remote-executor.ts:35` already records the substance — *"AUTH-03: the minting side **is reached from production**, as of Phase 23"* — while its `:61` trailing "AUTH-03 stays `Partial` until that guard runs" is the 2026-08-06 state; by this repository's own rule the requirement row wins and the comment gets fixed. **Phase 15 still closes its serving half only.** What changed is that the requestor half acquired entry-point callers in Phases 18 and 23, not that this phase supplied them, and the "may not tick it" ruling above stands as written.

### Phase 16: Decomposable Tree-Reduce Wiring
**Goal**: As a job requestor, I want a live multi-node job to merge its shard partials by walking `executeReduce`'s derived tree, so that my job's real reduce runs instead of the demo's linear scan.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A live multi-node job merges its shard partials by walking `executeReduce`'s derived tree, replacing the demo's linear scan
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
**Goal**: As a node operator, I want my node to generate its identity key on-device and complete a rate-limited, provider-signed enrollment before it is treated as a peer, so that any peer can verify my certificate offline and my private key never leaves the machine.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A node generates its identity key on-device and completes a rate-limited, provider-signed enrollment before it is treated as a peer, and a peer verifies that certificate offline
**Mode:** mvp
**Depends on**: Phase 11
**Requirements**: AUTH-01, AUTH-02, AUTH-04
**Research**: None — `requestEnrollment`, `EnrollmentAuthority`, and `verifyCertificate` exist and are unit-verified in Phase 6; the gap is that nothing on the production startup path calls them, so a running node's identity is still the raw libp2p peer ID. **CORRECTED 2026-08-22 — that clause was true when written on 2026-07-27 and became false when this phase executed (closed 3/3, 2026-08-07); it is preserved above as the phase's entry premise, and this is what the tree does now.** Both tiers enrol on the startup path: `fabric-node.ts:1220` calls `requestEnrollment` inside `resolveCertificate` (declared `:1134`), which `FabricNode.start` (`:1814`) reaches through `#compose` (`:1827`) at `:2286`; the browser tier does the same at `browser-node.ts:666`. `bin/agent.ts` builds the `enrollment` options from `--provider-addr`/`--user-key`/`--operator-id` (`:1039-1046`) and passes them at `:1355`. `EnrollmentAuthority` is constructed at `fabric-node.ts:2260` / `browser-node.ts:1653`, and `verifyCertificate` is called at `fabric-node.ts:1089`, `:2392` and `browser-node.ts:1605`. An enrolled node advertises the provider-signed certificate rather than a bare peer ID — `ownRecords` (`fabric-node.ts:1306`) publishes `{ certificate, capabilities }` — which is criterion 1, verified **MET** in `17-VERIFICATION.md:102-109`. **One bound the correction keeps, so it does not overclaim: enrollment is opt-in.** `resolveCertificate` returns `null` when `FabricNodeOptions.enrollment` is `undefined` (`fabric-node.ts:1155`), so an agent started with no `--provider-addr` still runs on a bare libp2p peer ID and publishes `'holds-no-records'`. What is false in the original is the caller-existence clause and the unconditional *"still the raw libp2p peer ID"* — not the observation that an unconfigured node has no certificate, which remains the stated contract
**Success Criteria** (what must be TRUE):
  1. Starting a node via `bin/agent.ts` for the first time generates an identity key on-device and completes a rate-limited enrollment flow against a provider, receiving a provider-signed certificate — observable as the node's advertised identity being a certificate rather than a bare libp2p peer ID
  2. A second node started via `bin/agent.ts` verifies the first node's certificate offline, with no live call to any certificate authority, before treating it as a legitimate peer, and rejects a self-signed or forged certificate with a named reason
  3. Attempting to enroll many node identities in a burst through the same entry point is rate-limited — refused beyond a stated threshold rather than accepted unbounded — making mass fake-node creation measurably costly
**Plans**: TBD

### Phase 18: Discovery, Capacity & Placement
**Goal**: As a job requestor with no static peer list, I want to find candidates by querying real content-CID providers and to sample and select by load, so that my work lands on a node that can take it while an over-committed node refuses with a stated reason — on a real job, not a hand-built fabric.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A requestor with no static peer list finds candidates by querying real content-CID providers, samples and selects by load, and an over-committed node refuses work with a stated reason — on a real job, not a hand-built fabric
**Mode:** mvp
**Depends on**: Phase 17 (node identity feeds capability records), Phase 12 (owner label needed for the sovereignty-vs-cost ordering)
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04, SCHED-05, NET-05
**Research**: None — `discoverExecutors`, `placeWithOffers`, and `DutyCycleGovernor` exist and are unit-verified in Phases 1 and 6; the gap is that `discoverExecutors` and the `capacity` hook (made explicit in Phase 11) have no production caller, and the governor is wired on the browser tier only. **CORRECTED 2026-08-22 — all three of those clauses are now false, and this phase's own thirteen plans are what made them so. Recorded here, not only in a summary, because a correction that lives in a summary reaches nobody.** (1) **`discoverExecutors` has a production caller.** `discoverCandidates` (`packages/net/src/discover-candidates.ts:190`, calling `discoverExecutors` at `:198`) is the bridge plan 18-05 built to turn a discovery answer's node keys into dispatchable `RemoteExecutor`s, and it is reached from three production entry points — `packages/node/src/bin/agent.ts:2295`, `packages/node/src/bin/bench.ts:1551`, and `packages/browser/demo/main.ts:730`. (2) **The `capacity` hook takes a real supplier on both tiers.** Both node factories pass `capacity: admission` into `serveAgent` — `packages/node/src/fabric-node.ts:2725` and `packages/browser/src/browser-node.ts:2106` — over a `LocalCapacity` constructed just above each (commit `0624ebb`). (3) **The governor is wired on both tiers, not the browser tier alone.** This was true when written, when the browser tier held only a `VisibilityGovernor`, and it stopped being true during this phase: a `DutyCycleGovernor` is constructed on the Node tier at `packages/node/src/fabric-node.ts:2080` (plan 18-08, commit `5202c3b`) and on the browser tier at `packages/browser/src/browser-node.ts:1793`, composed over the visibility governor (plan 18-09, commit `a6f2761`). The first half of the line — the three symbols exist and are unit-verified in Phases 1 and 6 — is untouched and still true. **Phase 18 stays UNCOUNTED for criterion 2b's re-pick clause alone**, carried to Phase 20 under RULING A, and not for any gap this Research line names
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
**Goal**: As a job requestor, I want verification quorums to compose under anti-affinity with a backbone-anchored replica and owner-domain agreement to be labelled distinctly from independent-operator agreement, so that I can tell how strong my result's agreement actually is rather than reading one number for two different things.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Verification quorums compose under anti-affinity with a backbone-anchored replica, owner-domain agreement is labelled distinctly from independent-operator agreement, and two browser tabs on a static bundle find each other with nothing dialed by a harness
**What the user-story form did not carry:** The original's third clause — *two browser tabs on a static bundle find each other with nothing dialed by a harness* — is a browser visitor's capability, not the job requestor's, and a single story cannot honestly carry both actors; it survives only in the original wording above and in this phase's success criteria.
**Mode:** mvp
**Depends on**: Phase 18, Phase 17
**Requirements**: AUTH-04, AUTH-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10, WIRE-03
**Research**: None — but *"the gap"* is three different gaps, and calling them one is what this line got wrong. **Corrected in place 2026-08-03 by plan 19-03**; the superseded sentence and the measurements that refute it are in the dated note below the criteria. `attestationReceipt` and `resolveReplicaSets` exist, are unit-verified in Phase 6, and are indeed only *uncalled* on the production dispatch path. `composeQuorum` is not in that state: VER-03's anchored replica is **unimplemented rather than unwired**, and its ok arm returns `strength: 'independent'` unconditionally while never calling `classifyAttestation`, so wiring it as it stood would have reported every quorum `independent`. And no test had ever put two tabs on a static bundle without a harness dialing for them — that one is closed by 19-03
**Constraints** (recorded 2026-07-28 by Phase 13, before criterion 2's plan is written):
  - Raw sovereign data does not move between nodes, including two nodes the same owner controls — `EgressGuard.send` refuses any frame carrying a registered sovereign payload rather than forwarding it (Plan 13-04). Criterion 2 below is therefore reachable only if the owner has already placed the input on both of their live nodes; the fabric will not fetch it onto the second one. See the **Raw sovereign data does not move between nodes** row in `.planning/PROJECT.md`'s Key Decisions
  - **CORRECTED 2026-08-02 — this bullet previously said two things that are false, and both would have misdirected the WIRE-03 planner.** It read: *"`BrowserNode` composes the identical `EgressGuard` and `registerSovereignInputs` wiring `FabricNode` does, but no sovereign job has ever run in a browser, so the refusal branch is compiled and never executed."* (1) **`registerSovereignInputs` does not exist in this repository** — zero definitions, zero calls. The name was retired; the real symbols are `takeSovereignHold` and `withholdingFrom`, both exported at `packages/net/src/index.ts:77`, and `packages/net/src/capability-authorizer.ts:20-25` already records this verbatim. The planning documents inherited a name the source had dropped — the same failure this bullet's neighbour below documents for a different sentence. (2) **"No sovereign job has ever run in a browser" is refuted**: `packages/node/src/browser-capability.e2e.test.ts` dispatches three `label:'sovereign'` tasks (`:280-281`) to a live tab started with `canExecuteSovereign: true` (`:213`) and asserts the third is *accepted and executed* (`:349-353`)
  - **What the composition claim gets right, and what actually remains unexecuted in a tab.** The composition holds line for line: guard construction (`fabric-node.ts:1284` / `browser-node.ts:851`), disposition object (`:1345` / `:885`), `withholdingFrom` (`:1366` / `:897`), `egress:` hook (`:1525` / `:1094`). What is *not* executed in a tab is narrower than "the refusal branch", and the source is more precise than this roadmap was: the **`authorize`/AUTH-03 refusal is executed** in a real tab; the **`EgressGuard`/`withholdingFrom` refusal is unconfirmed** — no e2e spec drives a sovereign payload out of a tab and reads the guard's refusal, and `two-tabs.e2e.test.ts:275-277` reads the *clean* manifest on a *public* job, the positive arm only; and the **`capacity`/SCHED-06 refusal is explicitly unexecuted, with the source naming this phase** — `packages/browser/src/browser-node.ts:1176-1184` says *"nothing drives a refusal through this hook … WIRE-03, Phase 19 builds the harness that would measure it."* Those two are WIRE-03's real content. This is the same structural gap `12-VERIFICATION.md` recorded and `13-03-PLAN.md` routed to WIRE-03. **CORRECTED 2026-08-22 — both of those refusals are now executed and read off the wire, and the source citation in the second had already rotted. The bullet above is kept as the constraint WIRE-03's planner was handed; this is what closed it.** (1) *The egress half.* `packages/node/src/tab-refusals.e2e.test.ts` (plan 19-04, commits `335ad9e`, `eaba07f`; in the `e2e` project per `vitest.config.ts:799-801`) has a live tab submit a sovereign shard through its own `window.o2.runJob`, establishes a positive control by serving a public row off the same tab, peer and connection (`:348-350`), then reads the refusal by text — `expect(refused.reason).toContain('egress refused')` (`:361`) plus the CID (`:362`) and the refusing peer id (`:363`) — and asserts the tab withholds that same CID from its `providers` answer (`:375`) against a positive twin (`:381-383`). That withholding is `withholdingFrom` itself (`packages/net/src/sovereign-egress.ts:191-217`, whose `:205` consults the same `sovereignCids` set the block branch's refusal does), wired into the tab at `packages/browser/src/browser-node.ts:1577,1589`. `packages/node/src/sovereign-block-refusal.node.test.ts:54-58` records the same closure in the source. So the `EgressGuard`/`withholdingFrom` refusal is confirmed on the browser tier. (2) *The capacity half.* The quoted sentence is no longer at `browser-node.ts:1176-1184` — that range is the `verifiedPeers` getter, the `capacity:` hook is at `:2106`, and the sentence survives only at `:2088-2095` as a deliberately retained retired claim, followed immediately by **"It is false now."** The refusal is executed: `tab-refusals.e2e.test.ts:438` ('SCHED-06 — a tab at its slot limit refuses, and says which limit') asserts `over-committed: 1 of 1 slots in use` (`:489`) and `over-committed: 2 of 2 slots in use` (`:564`) from dispatch reply frames on live tabs. **Cited by symbol from here on**, per the ruling already recorded at this entry's criterion-4 note: a line number is an absolute reference into a file that keeps changing, and it rots silently while still reading like evidence — which is exactly what the `:1176-1184` citation did. Plan 19-04's title in the plans list below still describes both refusals as never executed; read that as the plan's authoring-time framing
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
**Goal**: As a job requestor, I want `submitJob` to be the one job path, with lease renewal, speculation, and coverage accounting living inside it rather than in a second uncalled implementation, so that the resilience I was promised actually runs on my job and the peer ledger records real cross-node outcomes instead of discarding them.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): `submitJob` becomes the one job path — lease renewal, speculation, and coverage accounting live inside it, not in a second uncalled implementation — and the peer ledger records real cross-node outcomes instead of discarding them
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
**Goal**: As a publisher of signed artifacts, I want `translationCid` to be called by the lift pipeline itself with the CLI emitting the CID it produces, and a production node to construct a real `WasiExecutor`, so that an artifact I lift executes when it is dispatched to a running node instead of failing at instantiate.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): `translationCid` is called by the lift pipeline itself and the CLI emits the CID it produces; a production node constructs a real `WasiExecutor` so a translated artifact dispatched to a running node executes instead of failing at instantiate
**Mode:** mvp
**Depends on**: Phase 11. Otherwise independent of Phases 12-20 and runs in parallel with them, mirroring how Phase 10 ran parallel to Phases 4-9 in v1.0
**Requirements**: AOT-02, AOT-04
**Research**: None — `translationCid`, the `TranslationRecord` cache-key shape, and port conformance against a real elfconv artifact all exist and are verified in Phase 10; the gap is that the lift pipeline never calls `translationCid` and no production node builds a `WasiExecutor`. **CORRECTED 2026-08-22 — both halves of that gap are closed and this phase's own work is why; the sentence stays above as the phase's entry premise.** `liftElf` now names its own output — `tools/aot/lift.ts:1375`, `const named = await translationCid(translationKeyOf(lifted))`, reached from `tools/aot/cli.ts:370` — and both production factories construct a real `WasiExecutor` for the `wasi:` ABI slot: `packages/node/src/fabric-node.ts:2515` and `packages/browser/src/browser-node.ts:1784`. `21-VERIFICATION.md` scores criteria 1 and 3 MET, which are the two this line calls "the gap". **The "2 of 3 criteria" note below is superseded too:** that file was amended 2026-08-18 to `status: passed`, `score: 3/3 criteria MET (0 PARTIAL, 0 FAILED)` once criterion 2's re-tag refusal was measured, so the roadmap's own PARTIAL note is the stale half of the pair. Cited by symbol, not by line — the mutation-ledger entry for `translationCid` already pins the call site
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
**Goal**: As a developer, I want a guard test to fail when a capability exported from a package barrel has no traced call path from any of the five runnable entry points, so that the class of defect this milestone exists to fix cannot silently return.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A guard test fails when a capability exported from a package barrel has no traced call path from any of the five runnable entry points — the class of defect this milestone exists to fix, made permanent
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

<!-- "Plans Complete" is a dash for phases 1-10 ONLY, and that sentence used to claim
     "throughout", which stopped being true at Phase 11 and stayed on the page until
     2026-08-06. Phases 1-10 were executed directly and recorded in a single
     `phases/<name>/SUMMARY.md`. From Phase 11 on there are numbered plans, and the
     column counts plan FILES.

     CORRECTED 2026-08-22 — numbered plans begin at Phase 9, not Phase 11, and one of the
     ten phases named above has no directory at all. `ls .planning/phases/` shows no
     `phase-1-*` entry; the bare-`SUMMARY.md` set is **phases 2-8 and 10** (10 also carries
     `10-CONTEXT.md` and `10-VERIFICATION.md`). **Phase 9 is the exception**: it was executed
     from `09-01-PLAN.md`, headed "Phase 9 — Plan 1 of 1" and committed in `449b767` beside
     the phase's own implementation, together with `09-CONTEXT.md`, `09-VERIFICATION.md`,
     and a summary named `SUMMARY.md` rather than `09-01-SUMMARY.md`. Its column still reads
     `—` because the count is scoped to post-v1.0 phases, which is a choice and not an
     accident, but the sentence above stated it as a fact about how phases 1-10 were run and
     that part was wrong.

     This matters beyond bookkeeping: phase 9's plan is the only PLAN file in the repository
     with no same-stem SUMMARY, so it is the one-file difference between the 125 plan files a
     `find .planning/phases -name "*PLAN.md"` returns across all 28 phase directories and the
     124 in the post-v1.0 ones. That is why the raw excess of unpaired summaries described
     below nets out by exactly one. `.planning/.continue-here.md:153` and `:177-179` already
     record this, naming the bare-SUMMARY set as "Phases 2–8 and 10" and calling out "phase
     9's lone plan"; the reconciliation was simply never carried back here.

     The denominator is deliberate: four phases carry MORE summaries than plans, because
     gap-closure and defect summaries are written without a plan of their own (15 has 5
     summaries to 4 plans, 16 has 6 to 4, 17 has 6 to 5, 19 has 23 to 19). Counting
     summaries would make the column exceed its own denominator and read as over 100%,
     which is the trap STATE.md already warns about. Plan files it is.

     Status text states the shortfall when there is one. A phase with a PARTIAL criterion
     is not "Complete" here however nearly done it looks -- 16, 17, 19, 20 and 21 all sit
     short on one criterion apiece, several of them carried to a later phase by owner
     ruling. RULING A governs: a criterion is not rewritten to let a phase close, and a
     carried criterion stays PARTIAL until its destination phase lands. -->

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
| 13.1. Node-Side Admission & Transport Bounds | 5/5 | Complete   | 2026-08-04 |
| 14. Signed Artifact Resolution | 5/5 | Complete   | 2026-07-31 |
| 15. Capability-Chained Dispatch | 4/4 | Complete   | 2026-07-31 |
| 16. Decomposable Tree-Reduce Wiring | 4/4 | **Complete — 4 of 4 criteria.** Criterion 3's "arriving late" clause was not expressible on the build it was written against and was carried to Phase 20 criterion 6, which scored MET; the amendment of 2026-08-06 **re-measured** it rather than transcribing that verdict — `criterion_text_unchanged: true`, both texts `cmp`'d at exit 0, two plants watched red and restored by `cp` + `cmp`. One clause does not match literally and the amendment says so: *"because it carries the same CID"* is causally inert on the late path, since `rpc.ts` drops the frame on a missing correlation entry before the payload matters. **The verdict turns on that reading and an owner may overturn it**, returning the row to 3 of 4. Two non-criterion gaps stay open and tracked, not scored; MR-04 and MR-07 stay `Partial` on their **demo** half, which is WIRE-02 and Phase 22's | 2026-08-06 |
| 17. Node Identity & Enrollment | 5/5 | **Complete — 3 of 3 criteria.** Criterion 3's COST clause was not met for six days; measured to be an admission property rather than a selection one, and carried to Phase 24 criterion 8. **This row asserted "Phase 24 landed 2026-08-06 and criterion 8 verified PARTIAL, so criterion 3 does NOT close" — the verdict is right and the REASON is false from `580e461`, while row 24 four lines below said the opposite.** Criterion 8 landed **MET**, so RULING A's precondition IS satisfied — and criterion 3 was re-verified on 2026-08-06 (`a3d2215`) and **declined anyway**, the first time RULING A has held against a destination that landed MET. The clauses match; what is missing is a third link neither sentence names — criterion 3 is about **mass** creation, and that needs **one certificate to admit exactly one identity**. The binding exists in `fabric-node.ts`; **no test observes it** (neutralising it is green across 8 files and 5 runs, while the control plant reddens). One test at the door closes this. **CLOSED 2026-08-07 at 3/3 — the test landed within the hour (`8719029`, ledgered M68) and the fourth amendment re-ran the decline rather than transcribing it.** The same plant on the same file — `fabric-node.ts` sha256 `d6688f73…`, byte-identical to the digest the declining pass recorded, so the different result cannot be a different file — now **reddens**: `PLANTED_P1_EXIT=1`, the door returning `false` where `true` denies, i.e. admitting a peer holding somebody else's certificate. **The both-ways proof held**, which is what stops the green being vacuous: planting `peer-verifier.ts` instead leaves relay-admission green in full while reddening peer-verifier's own borrowed-certificate row, so the new case observes the **door** and not the **selector** — the distinction the decline turned on. Two limits are at the verdict, not in a footnote: the borrowed case is measured at the **predicate** over `MemoryNetwork` rather than at a live reservation, so the close rests on a conjunction with the file's live-relay arms; and this is a **bound plus devaluation, not a graduated price** — a reader taking *costly* to require a rising per-identity price gets the 2026-08-01 answer, and that reading is escalated rather than settled | 2026-08-07 |
| 18. Discovery, Capacity & Placement | 13/13 | Complete   | 2026-08-04 |
| 19. Quorum Composition & Owner-Domain Attestation | 19/19 | **Complete — 5 of 5 criteria.** Criterion 5 priced nothing: the N-th identity was refused inside the window rather than priced. Carried to Phase 24 criterion 8 by owner ruling 2026-08-04, and **closed there** by the third amendment of 2026-08-06 (`ac7b214`) once criterion 8 was re-scored MET. **This row asserted in the present tense that "criterion 8 verified PARTIAL, so criterion 5 does NOT close" — false from `580e461`, while row 24 three lines below said the opposite.** `criterion_text_unchanged: true` for both criteria, `cmp`'d and `git log -L`-checked. **MET within criterion 8's stated bound, carried verbatim**: the default posture of the binaries stays open and must. Two of the gap's three parts were never Phase 24's — the `userKey` part was answered by 19-05's aggregate budget and the per-process part by 19-07's durable ledger, so criterion 8 is not credited with work this phase did itself | 2026-08-06 |
| 20. Single Job Path, Ledger & Churn Resilience | 13/13 | 6 of 7 criteria — criterion 7's checkpoint-**write** half runs on a sink no production submitter supplies; the recovery half is measured | 2026-08-05 |
| 21. AOT Translation Signing & Runtime | 5/5 | 2 of 3 criteria — criterion 2's re-tag refusal recorded as a measured negative by owner ruling 2026-08-05; carried, not cleared | 2026-08-05 |
| 22. Reachability Guard | 4/4 | **Executed and verified 2026-08-08 at `fee26c2` — 2/3 criteria, criterion 1 DECLINED.** This cell read *"0/4 · Planned, not executed — 4 plans, no summaries, no verification"* until 2026-08-18, and all three clauses were false: four summaries and `22-VERIFICATION.md` are on disk. Ran **last** (23 → 24 → 22) as scheduled. Criterion 1 asks the reachability guard to *pass clean*; it reports 68 unreachable callable barrel exports against a bound of 68, so the phase does not close. Corrected by the 2026-08-18 milestone audit. | 2026-08-08 |
| 23. Multi-Process Benchmark Driver | 6/6 | Complete — 5 of 5 criteria | 2026-08-06 |
| 24. Certificate-Gated Admission | 8/8 | **Complete — 1 of 1.** Criterion 8 verified **PARTIAL** on 2026-08-06 (0 of 1) because the criterion says *"the fabric"* while the evidence read *"a relay that has been told to close"*, and `bin/seed.ts` could not be told to close at all — so the bound was **structural**, not a posture an operator could remove. Four gap-closure plans and a dated amendment (`580e461`) changed that: 24-05 measured the bootstrap paradox **false** (enrolment runs over a plain dial, no reservation in its path), 24-06 built the knob, 24-07 read the absence over **every** door with a control that can fail, 24-08 read the browser tier in three engines. **MET with a stated bound**: the default posture of the binaries stays open and must — 19 + 3 argv sites, with `reservation-exhaustion` arm A a live guard on it. Criterion 8's wording is unedited. **Phase 17 criterion 3 and Phase 19 criterion 5 were both carried into criterion 8. 19 CLOSED at 5/5 (`ac7b214`) carrying the bound verbatim; 17 DECLINED and stays 2/3 (`a3d2215`).** This row said both "can now close" — an actual attempt falsified that for 17 within the hour. Criterion 3 needs a third link neither criterion names, one certificate admitting exactly one identity, and no test observes it. This row's closing clause read **"the two verdicts arguably rest on the same unguarded binding and disagree — an owner adjudication"**. **That adjudication was answered by code rather than by a ruling, 2026-08-07**: the binding is now guarded at the door (`8719029`, M68), 17 re-verified and **closed at 3/3**, and the two verdicts agree. The disagreement was never about the criteria — it was about whether the shared premise was observed by anything, and it was not | 2026-08-07 |

### Phase 23: Multi-Process Benchmark Driver
**Goal**: As the project owner, I want the benchmark harness to spawn N real operating-system processes instead of N `FabricNode`s on one event loop, so that a parallel speedup is measurable at all and the project's central scaling claim stops being unmeasured.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The benchmark harness spawns N real operating-system processes instead of N `FabricNode`s on one event loop, so a parallel speedup is measurable at all — and the project's central scaling claim stops being unmeasured
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
**Goal**: As a relay operator, I want the network's front door locked so a node that cannot present a provider-issued certificate cannot reserve a circuit, be advertised, or be dialled, so that an identity that was never issued buys nothing on my infrastructure.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The network's front door is locked — a node that cannot present a provider-issued certificate cannot reserve a circuit, be advertised, or be dialled, so an identity that was never issued buys nothing
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

### Phase 25: X.509 Certificate Profile
**Goal**: The certificate envelope becomes X.509 v3 with a cryptographic profile that is load-bearing rather than advisory — a set of precise refusals, each guarded, such that an ASN.1 parser in the browser trust path is not the weakest thing in the design
**Depends on**: Phase 24 (which armed the gate the profile governs); no phase depends on this
**Requirements**: X509-01, X509-02, X509-03, X509-04, X509-05, X509-06, X509-07 (minted at plan time 2026-08-09 — X509-05 recorded delivered-with-evidence, not built)
**Research**: `docs/architecture/RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md` §4, the three RFC-0003 reviews of 2026-08-06, the 2026-08-07 correction appended to the praxis review, and `25-RESEARCH.md` (2026-08-09)
**Success Criteria** (what must be TRUE), one per obligation:
1. A certificate whose signature/SPKI `AlgorithmIdentifier` OID is anything other than `1.3.101.112` (id-Ed25519) is refused, named `unrecognised-algorithm` (X509-01)
2. SHA-1 (`1.2.840.113549.1.1.5`), P-192 and P-224 (both via `1.2.840.10045.2.1` with the respective curve OID in `parameters`), and RSA (`1.2.840.113549.1.1.1`) are each refused by name, each with its own planted-and-watched-red test (X509-02)
3. A certificate is refused unless it is byte-identical to its own canonical DER re-encoding, proved by re-encode-and-compare rather than a prose checklist (X509-03)
4. A certificate longer than a fixed, sited byte ceiling is refused before any parsing begins (X509-04)
5. A capability chain deeper than a fixed bound is refused before any signature work — already delivered at `capability.ts:127/190`, recorded rather than re-implemented (X509-05)
6. An oversized single extension, or more than a fixed count of extensions, is refused before extension contents are interpreted (X509-06)
7. A certificate carrying two extensions with the same `extnID` is refused outright — never last-wins, never a warning (X509-07)

Two further numbers this phase owes, per the owner ruling's own words (not separate
requirement IDs — folded into the plan set that delivers them): the decoder's real,
measured, guarded contribution to the browser bundle weight; and the async-migration
cost of the 2026-08-09 Ed25519 backend ruling (`crypto.subtle` first, libsodium
fallback), priced by call-site count rather than wired into `verifyChain`/
`verifyCertificate` in this phase.

**Plans:** 4/4 plans executed

Plans:
**Wave 1**
- [x] 25-01-PLAN.md — X.509 DER engine: type contracts, bounded TLV decode/encode, certificate-size gate (X509-04)
- [x] 25-04-PLAN.md — Ed25519 dual-backend verifier: lazy WebCrypto/libsodium selection, differential-conformance guard, async-migration pricing (not wired into verifyChain/verifyCertificate this phase)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 25-02-PLAN.md — profile semantics: algorithm allow-list and named bans, extension rules, duplicate detection, canonicalisation wired as a certificate gate, requirement family minted (X509-01, X509-02, X509-03, X509-05, X509-06, X509-07)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 25-03-PLAN.md — bundle-cost guard: the decoder's real, measured, guarded contribution to the browser tier

<!-- FILED 2026-08-07 BY OWNER RULING. Not scheduled into v1.1 — v1.1 is "Wire What Was Built"
     and this builds something new. It is filed rather than left in a review document because a
     ruling that lives only in a doc is a ruling nobody executes.

     THE RULING, AND IT WAS TAKEN AGAINST THE STANDING RECOMMENDATION. The recommendation was to
     keep `@noble/curves` + `@ipld/dag-cbor` — both already present — and document the divergence
     from X.509, on the ground that adopting it ships `pkijs` + `asn1js` into the BROWSER trust
     path: a few hundred KB of exactly the code that generates CVE classes, at the one boundary
     that must fail closed. The supporting argument was that `critical` extensions buy little
     here because there is no generic validator anywhere in this system, while the one place a
     standard validator would sit — §2's optional external CA — is guaranteed to reject a chain
     carrying critical unknown extensions, so §2 and §4 pull against each other.

     THE OWNER RULED ADOPT ANYWAY, 2026-08-06, and re-confirmed the filing 2026-08-07. The
     decision stands and the work proceeds under it. What it OBLIGES is that the cryptographic
     profile stops being advisory. Seven items were named:

       1. permitted algorithms
       2. bans on SHA-1 and weak curves
       3. DER canonicalisation rules
       4. certificate parsing limits
       5. maximum chain depth
       6. extension size limits
       7. strict handling of duplicate extensions

     ITEM 5 IS ALREADY DELIVERED AND GUARDED, measured 2026-08-07 against the tree rather than
     taken from the review. `packages/core/src/capability.ts:127` defines `MAX_CHAIN_DEPTH = 8`
     and `:190` enforces it BEFORE any signature work, for the reason the review itself gives:
     the length is attacker-supplied and this is the cheapest possible refusal. Its companion
     hazard is closed too — `:255` folds `expiresAt` with `reduce` rather than
     `Math.min(...chain.map(...))`, because the spread raised RangeError past ~200 000 elements
     on the SUCCESS path. The two controls are deliberately independent. The review's claim that
     *"verifyChain currently has no depth bound at all"* is FALSE and was false when written; a
     dated correction is appended to the praxis review rather than edited into it.

     THE OTHER SIX ATTACH TO A PARSER THAT DOES NOT EXIST, and that is the phase's real shape.
     No `pkijs`, `asn1js`, `node-forge` or `@peculiar/*` is installed in the root manifest or any
     workspace package; certificates today are Ed25519 over `@noble/curves`
     (`packages/core/src/enrollment.ts:113`), not DER. So items 3, 4, 6 and 7 are rules for
     something not yet built — which argues for specifying them BEFORE it arrives, and is why
     this is a phase rather than a patch.

     WHAT THE PLANNER MUST NOT DO. "Reject on ambiguity" is not a principle to state; under this
     ruling it is the set of precise refusals, each with a test that has been watched red. A
     profile document with no guard is the advisory thing the ruling exists to replace.

     THE COST IS PART OF THE RULING AND MUST BE MEASURED, NOT ASSUMED: bundle weight added to the
     browser tier, and whether the parser can be kept off the path a tab executes. Both are
     numbers this phase owes, not caveats it may inherit. -->


### Phase 26: elfconv Compiled to Wasm — Translation as a Fabric Workload
**Goal**: The AOT translator runs as a wasm module on any node, so producing a lifted artifact stops being a Docker-host privilege and becomes a job the fabric can schedule — closing the asymmetry where the fabric can RUN lifted artifacts anywhere but only PRODUCE them on one machine
**Depends on**: the `third_party/elfconv` submodule (added 2026-08-07); no phase depends on this
**Requirements**: AOTW-01, AOTW-02, AOTW-03, AOTW-04, AOTW-05, AOTW-06 (minted at plan time 2026-08-10; AOTW-06 is the phase deliverable and opens unmet by design — everything before it exists to decide whether it is reachable)
**Research**: measured 2026-08-07 against `ghcr.io/yomaytk/elfconv:amd64`, recorded below; toolchain preconditions re-measured on this host 2026-08-10 and recorded in `26-CONTEXT.md`
**Plans**: 3 plans, 3 waves, strictly sequential — 26-01 pins the toolchain by image digest and measures what preview1 provides; 26-02 is the gate (elflift's own TUs compiled for `wasm32-wasi`, and the unresolvable symbol residue named); 26-03 writes the verdict, mints the ids, and hands the decision back. Nothing past the gate is planned, deliberately

<!-- FILED 2026-08-07 BY OWNER INSTRUCTION ("compile to Wasm"). NOT scheduled into v1.1.

     THE POINT, so nobody re-derives it: a node can already execute a lifted `.wasm`. It cannot
     PRODUCE one without Docker, a native LLVM and an x86-64-or-arm64 host. That asymmetry is
     what makes AOT a build-machine privilege. It also means a RISC-V host can run fabric work
     but can never contribute translation — which is where this started.

     WHAT WAS MEASURED, not assumed. Every line below is a reading, not a plan.

     1. THE LLVM ARCHIVES CANNOT BE REUSED. `/usr/lib/llvm-16/lib/*.a` are host objects —
        `readelf -h` on a member reports `Machine: Advanced Micro Devices X86-64`. LLVM must be
        CROSS-COMPILED to wasm32-wasi from source. This is the dominant cost of the phase and
        it is not avoidable by linking what the image already ships.

     2. THE FULL DEPENDENCY SET, read off the real link line in `build.ninja` rather than
        guessed: `libLLVM-16.so.1`, `-lbfd`, `-ldwarf`, `-lelf`, and the vendored
        `libgflags.a`, `libglog.a`, `libxed.a`. Seven ports, of which LLVM is the large one and
        binutils BFD is the least obviously portable.

     3. THREADS WORK. `wasm32-wasi-threads` + `-pthread` built a `std::thread`/`std::mutex`
        program at 1 175 165 bytes. wasi-sdk-24.0 ships `wasm32-wasi`, `wasm32-wasi-threads`,
        `wasm32-wasip1`, `wasm32-wasip1-threads` and `wasm32-wasip2` sysroots.

     4. C++ EXCEPTIONS DO NOT. `wasm-ld: undefined symbol: __cxa_allocate_exception` — wasi-sdk
        24's libc++ is built without EH. **This is survivable and the codebase already knows
        it**: `utils/Util.cpp:11`'s `elfconv_runtime_error` carries a
        `#if defined(__wasm__)` branch that `vprintf`s and `abort()`s instead of throwing, so
        all 17 throw/error sites funnel through a helper that is already wasm-aware. LLVM's own
        defaults are `LLVM_ENABLE_EH=OFF` / `LLVM_ENABLE_RTTI=OFF`, so LLVM does not need them
        either.

     5. MEMORY64 IS NOT AVAILABLE, AND THIS CLOSES AN OPEN QUESTION. The handoff carried
        *"wasm32's 4 GB ceiling for LLVM passes — Memory64 is reportedly stable in browsers,
        verify against wasi-sdk, not a blog."* Verified: wasi-sdk-24.0 has **no `wasm64-wasi`
        sysroot at all** — a `--target=wasm64-wasi` build fails at `'memory' file not found`.
        So the 4 GB address space is a HARD BOUND for this toolchain no matter what browsers
        support. Whether it binds in practice is a separate measurement this phase owes: the
        900-function static-glibc lift produces 4.4 MB of bitcode, so peak LLVM residency may
        sit well under the ceiling for modest inputs. Size the claim to what is measured.

     WHAT THIS PHASE MUST NOT DO. It must not report success on a module that was never run.
     The deliverable is a wasm module that lifts a real ELF and produces bitcode a native
     elfconv would also produce — compared byte-for-byte where possible, exactly as the AArch64
     non-regression check for the amd64 front-end work was done (`sha256` on the `.bc`).

     A NOTE ON THE SECOND STAGE, because "elfconv to wasm" understates the target. The pipeline
     is ELF -> bitcode (`elflift`) and then bitcode -> wasm (`wasi-sdk clang++` + `lld`). BOTH
     halves are LLVM. A node that can only run the first half still needs a toolchain host for
     the second, so the phase should state up front whether it is shipping the lifter alone or
     the whole toolchain, and price them separately.

     6. PRIOR ART EXISTS AND IT SETTLES FEASIBILITY, but not on an ABI this project can use.
        Wasmer ships the FULL clang compiled to WebAssembly and runs it in Chrome, Safari and
        Firefox (https://wasmer.io/posts/clang-in-browser). So "LLVM cannot be compiled to
        wasm" is FALSE and must not be written down as a blocker. Two details bound what can be
        borrowed:
          - It targets **WASIX**, not plain WASI, and it is **~100 MB uncompressed**.
          - WASIX is a SUPERSET of WASI preview1 adding fork/exec, signals, sockets and
            setjmp/longjmp-via-asyncify (https://wasmer.io/posts/announcing-wasix). Preview1
            has none of those.
        **This matters because o2's execution tier is preview1**: V8's built-in `WebAssembly`
        plus `@bjorn3/browser_wasi_shim`, per the stack decision in CLAUDE.md. A WASIX module
        does not run there — it needs a WASIX runtime. So Wasmer's artifact proves the concept
        and is NOT a drop-in for the fabric.

     7. ~~THE LIKELY REASON CLANG NEEDED WASIX DOES NOT APPLY TO elflift~~ — **MEASURED
        2026-08-10 (Plan 26-02) AND IT DID NOT HOLD.** The item is kept verbatim below rather
        than deleted, because it was the phase's central hypothesis and a reader tracing the
        argument needs to see what was tested.

        **The original item, unedited:**

        > THE LIKELY REASON CLANG NEEDED WASIX DOES NOT APPLY TO elflift, and this is the single
        > most useful thing to test first. **INFERRED, NOT YET MEASURED** — say so until it is.
        > The clang DRIVER spawns subprocesses (`cc1`, then the linker), which is fork/exec and is
        > exactly what preview1 lacks. `elflift` is not a driver: it links LLVM as a LIBRARY,
        > reads one ELF and writes one `.bc`, in a single process. If it needs no fork/exec, no
        > signals and no longjmp, it may fit plain wasm32-wasi where the clang driver cannot.
        > **First experiment of this phase: build elflift for wasm32-wasi and find out**, because
        > a negative here changes the whole shape of the work.

        WHY IT IS FALSE. The inference turns on "driver spawns, library does not". The fork/exec
        is not a property of being a driver — **it is inside LLVMSupport's `Program.cpp`, which
        `elflift` links as a LIBRARY.** `fork`, `execve` and `posix_spawn` each read `count: 1`
        in both alive readings of `gate.json`, every one attributed to `Program.cpp.o`. Linking
        LLVM as a library therefore does not avoid the process family; it imports it.

        WHAT THAT DOES NOT SAY, because the measurement is an upper bound in one direction only.
        A residue read out of an ARCHIVE is what the archive references, and `wasm-ld` pulls in
        only the members it needs — so this does not establish that the elflift link drags
        `Program.cpp.o` in. Nothing was linked. And elflift's OWN demand for fork/exec is
        unmeasured entirely, because the compile stops at glog before any of the lifter's code is
        type-checked.

        THE EXPERIMENT RAN AND ITS ANSWER IS A NO-GO, for a cause this item did not predict:
        **glog**, which has no `__wasi__` platform branch at all. 21 of 27 non-test TUs do not
        compile; the `wasm32-wasi-threads` arm moves the error from `glog/logging.h:51` to
        `glog/platform.h:58` ("Platform not supported by glog") and fixes nothing. See
        `.planning/phases/phase-26-elfconv-compiled-to-wasm/26-GATE.md`.

     8. THE SECOND STAGE MAY AVOID THE DRIVER TOO — also inferred, also to be measured. Stage 2
        needs bitcode -> object -> wasm, which is `llc` and `wasm-ld`; both are single-process
        library-shaped tools, unlike the driver. And elfconv's stage 2 additionally compiles its
        C++ RUNTIME sources (`Entry.cpp`, `Memory.cpp`, `Runtime.cpp`, `VmIntrinsics.cpp`,
        `Util.cpp`, `elfconv.cpp`, `SyscallWasi.cpp`) — but those DO NOT CHANGE PER JOB, so they
        can be compiled to bitcode ONCE, natively, and shipped as a fixed input. That removes
        the C++ frontend from the fabric path entirely and leaves only `llc` + `wasm-ld`.
        If it holds, the fabric never needs a compiler frontend, only a backend and a linker.

     9. OWNER IDEA 2026-08-07: "clang in wasm" AS A DEMO SERVICE. Recorded here rather than in a
        notes file because it shares this phase's dependency and inherits its bounds.

        WHY IT FITS, and it fits better than most demo candidates. Compilation is embarrassingly
        parallel across translation units, which is the shape this project's core value claim
        needs. And it lands the SOVEREIGNTY story cleanly rather than by analogy: the source IS
        the owner's data, so it compiles on the owner's node under `owner-attested` and only the
        artifact crosses the egress boundary — the exact split PROJECT.md describes, on a
        workload people already care about.

        WHAT BLOCKS IT TODAY, measured above and not negotiable by wanting it: Wasmer's clang is
        **WASIX**, and this fabric executes **preview1** (V8 + `@bjorn3/browser_wasi_shim`). So
        the artifact that exists cannot run on the tier that exists. Three routes, and they are
        not equal:
          a. Build clang for plain wasm32-wasi — blocked on the DRIVER's fork/exec (item 7).
          b. Ship `llc` + `wasm-ld` only, with the C++ frontend left off the fabric (item 8).
             This is the cheapest route and it is ALSO the honest one for a demo: it compiles
             BITCODE, not C++, and the demo must say so rather than imply a full compiler.
          c. Teach the executor a WASIX shim — **rejected unless argued explicitly**, because
             WASIX adds fork/exec and sockets to guest code, which is a sandbox surface this
             project spent Phase 13.1 and Phase 24 narrowing. Do not widen it for a demo.

        TWO SIZING FACTS ALREADY IN HAND. The artifact is ~100 MB uncompressed, against a
        browser mesh whose data path cannot carry bulk (16 KiB WebRTC messages, 128 KiB relay
        limit) — so it must come over the CID-keyed CDN path the peer study identified, not over
        the mesh. And wasm32's 4 GB ceiling (item 5) is a real bound for a compiler, which is
        one of the few workloads that can genuinely reach it.

     10. A PROVEN RECIPE EXISTS AND THIS PHASE SHOULD START FROM IT, NOT FROM SCRATCH.
        `guyutongxue/clangd-in-browser` builds **clangd** — a large clang/LLVM binary — to wasm
        and runs it in a browser. Its `build.sh` is the template:

          LLVM 21.1.0, built with **emcmake (Emscripten)** — NOT wasi-sdk
          cmake --build build-native --target llvm-tblgen clang-tblgen   # HOST tablegen first
          -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra"
          -DLLVM_TARGETS_TO_BUILD=WebAssembly
          -DLLVM_BUILD_STATIC=ON
          disabled: backtraces, unwind tables, crash overrides, analyzer, terminfo, PIC, zlib
          -s INITIAL_MEMORY=2GB -s MAXIMUM_MEMORY=4GB -s ASYNCIFY -s WASM_BIGINT
          -s ENVIRONMENT=worker -s MODULARIZE -s EXPORT_ES6 -pthread
          -s PTHREAD_POOL_SIZE='Math.max(navigator.hardwareConcurrency, 8)'

        It also carries a `wait_stdin.patch`, so **at least one LLVM patch is required** — expect
        patches rather than treating the first one as a surprise. It points at `soedirgo/llvm-wasm`
        as the detailed guide.

        **INDEPENDENT CORROBORATION OF ITEM 5**: `MAXIMUM_MEMORY=4GB` is the whole wasm32
        address space, and `INITIAL_MEMORY` is already 2 GB. A real LLVM workload runs up against
        the ceiling this project measured wasi-sdk cannot lift. Two measurements, one conclusion.

        FOUR DELTAS BETWEEN THAT RECIPE AND WHAT o2 NEEDS. These are the phase's actual design
        decisions and none is a detail:

          a. **Emscripten vs WASI is a decision about WHERE THE TRANSLATOR RUNS, not a detail.**
             Emscripten output needs its JS glue, so it cannot be guest code under this project's
             preview1 sandbox. But a translator does not have to be guest code: run it
             **host-side in the agent** (the same place `WasmExecutor` lives) and the glue is
             fine. Running it as a sandboxed guest job forces plain WASI and item 7's question.
             **Decide this first — it determines the toolchain, not the other way round.**
          b. **Threads may be droppable, and dropping them removes SharedArrayBuffer.** clangd is
             multi-threaded so that build needs SAB and `crossOriginIsolated`. `elflift` reads one
             ELF and writes one `.bc`; `LLVM_ENABLE_THREADS=OFF` is likely viable and would remove
             the COOP/COEP requirement entirely — which matters because CLAUDE.md records that
             GitHub Pages sets no headers. Note the escape hatch both projects already use, and
             it is verified in this tree rather than assumed: **elfconv vendors
             `browser/coi-serviceworker.js` (5 221 bytes)** and copies it in `prepare_js`. Sharper
             still — elfconv's OWN browser target already links `-pthread`
             (`EMCC_OPTION` carries `-pthread -sPTHREAD_POOL_SIZE=0`), so it already produces
             shared-memory modules and already needs cross-origin isolation. That constraint is
             not new work this phase introduces; it is work elfconv's browser path already carries
             and which o2 sidesteps today only because its AOT artifacts use the `wasi32` target
             rather than the emscripten one.
          c. **`LLVM_TARGETS_TO_BUILD` is not the same list.** clangd needs only `WebAssembly`.
             elflift emits bitcode and may need no backend at all, while Remill's `Arch::Build`
             may want `X86` and/or `AArch64` target data for the SOURCE architecture. Measure
             which are actually referenced before enabling three targets' worth of size.
          d. **Stage 2 wants `llc` + `wasm-ld`, not `clang-tools-extra`.** The recipe builds a
             language server; this phase needs a backend and a linker (item 8). Different
             `LLVM_ENABLE_PROJECTS`, and probably much smaller.

        NOT MEASURED YET, and it is the number the demo-service idea turns on: the module size
        of that clangd build. Wasmer's clang is ~100 MB uncompressed; assume the same order until
        this repository's artifact is actually weighed.
     11. ~~THE COST ESTIMATE COLLAPSED ON 2026-08-07~~ — **BOTH SUB-ITEMS WERE OVERTAKEN BY
        MEASUREMENT ON 2026-08-10.** The heading is struck and the two sub-items are corrected
        in place below, each keeping its original text. (ii) is FALSIFIED; (i) is WEAKENED
        rather than falsified, and the difference is stated in its own paragraph. The original
        heading, unedited: *"THE COST ESTIMATE COLLAPSED ON 2026-08-07, and the two hardest
        unknowns are now resolved — both MEASURED, neither assumed."*

        **WEAKENED 2026-08-10, on (i).** The neighbouring wasm LLVM is **Emscripten-targeted**
        (`26-CONTEXT.md` precondition 3: `CMAKE_TOOLCHAIN_FILE=.../Platform/Emscripten.cmake`),
        so its output needs JS glue and cannot be guest code under this project's preview1
        sandbox. It served Phase 26 as a **measuring instrument** — reading C of the symbol
        residue — and as nothing else. It supplies **none** of the pieces stage 1 is missing:
        it is LLVM 17.0.6 against the image's 16.0.6, it has zero AArch64 and zero X86 archives
        (precondition 4), it is missing `libLLVMPasses.a`, and it lives in a neighbouring
        checkout this repository may not depend on. **A wasm32-wasi LLVM still does not exist
        and still has to be built from source**, which is the cost this item said had collapsed.

        (i) LLVM IS ALREADY CROSS-COMPILED TO WASM ON THIS MACHINE. The owner pointed at
        `/Volumes/ProjectsSSD/Projects/hupyy/libclang-wasm`, whose `build-llvm.sh` (adapted from
        `jprendes/emception`) has already produced **66 static archives, 71 MB of `libLLVM*.a`**,
        and a working **`libclang.wasm` of 34 075 902 bytes** carrying real wasm magic
        (`00 61 73 6d 01 00 00 00`). `CMakeCache.txt` confirms the Emscripten toolchain file,
        `LLVM_TARGETS_TO_BUILD=WebAssembly`, and — the delta this phase predicted —
        **`LLVM_ENABLE_THREADS:BOOL=OFF`**, which is what removes SharedArrayBuffer and the
        COOP/COEP requirement entirely. It needs ONE small patch (`getMainExecutable` returning a
        fixed path under `__EMSCRIPTEN__`) plus `CXXFLAGS=-Dwait4=__syscall_wait4`.
        **34 MB, not the ~100 MB assumed from Wasmer** — so the demo-service size question has a
        real answer and it is three times better than the placeholder.

        (ii) ~~elfconv AND remill ARE ALREADY PORTABLE~~ — **THE POPULATION WAS WRONG.
        CORRECTED 2026-08-10 (Plan 26-02).** Kept verbatim below, because a wrong finding is
        worth more visible than deleted, and because the mechanism that made it wrong is
        reusable.

        **The original item, unedited:**

        > (ii) elfconv AND remill ARE ALREADY PORTABLE. Measured by replaying every entry of
        > `build/compile_commands.json` through `em++ -fsyntax-only`: **22 of 22 non-test TUs pass,
        > 0 fail**, with NO source patch — only `-DREMILL_ARCH`, `-DREMILL_OS` and the
        > `REMILL_ON_*` set supplied on the command line. Without them, 17 of 27 fail on exactly
        > two `#error` lines (`Arch/Name.h:82` "Cannot infer current architecture",
        > `OS/OS.h:51` "Cannot infer current OS"), and BOTH sit inside `#ifndef REMILL_ARCH` /
        > `#ifndef REMILL_OS` guards — so this is a FLAGS problem, not a portability problem. The
        > remaining failures were all in `backend/remill/tests/AArch64/`, which this phase does not
        > need.

        WHY IT IS WRONG, and it is the population rather than the arithmetic.
        `backend/remill/cmake/settings.cmake:25` sets `CMAKE_EXPORT_COMPILE_COMMANDS` as a
        **directory-scoped normal variable inside remill's own `project()`**, so the
        `compile_commands.json` cmake writes by default covers **only the remill subtree**. The
        twenty-two therefore **never included elflift's own five sources** —
        `lifter/Binary/Loader.cpp`, `lifter/MainLifter.cpp`, `lifter/TraceManager.cpp`,
        `lifter/Lift.cpp` and `utils/Util.cpp`. Passing `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` on
        the cmake command line writes the **cache** variable at top-level scope, which `lifter/`
        and `tests/` inherit: the database grows **27 entries → 38** and the five appear.

        THE REAL FIGURE, for `wasm32-wasi` with the pinned wasi-sdk: **6 pass / 21 fail of 27
        non-test TUs.** The 21 all stop at the same first error with the same include-chain root,
        `glog/logging.h:51`, and four of elflift's own five sources are among them. The six that
        produce an object are exactly the six that never reach glog.

        NOTE WHAT SURVIVES AND WHAT DOES NOT. The flags finding survives and was independently
        re-measured: `REMILL_ARCH` / `REMILL_OS` / the `REMILL_ON_*` set are still needed, and a
        control recompile that withholds them still dies at `Arch/Name.h:82` "Cannot infer
        current architecture". What does not survive is "already portable" — that was a reading
        of remill under Emscripten, not of elfconv under WASI, and the two differ on the wall
        that matters.

        WHAT IS ACTUALLY LEFT, now that LLVM is not the problem:
          - **LLVM 16 -> 17 API skew.** The prebuilt wasm LLVM is **17.0.6**; elfconv's scripts
            say `LLVM_VERSION=16`. But `backend/remill/CMakeLists.txt` uses
            `find_package(LLVM CONFIG REQUIRED)` and DERIVES `REMILL_LLVM_VERSION`, so the
            version is not pinned in the build. One major step; testable, not a wall.
          - **Six non-LLVM dependencies still need wasm builds**: `-lbfd`, `-ldwarf`, `-lelf`,
            gflags, glog, XED. **This is now the main remaining work.**
          - **HIGHEST-LEVERAGE IDEA, and it deletes three of those six.** BFD, libdwarf and libelf
            exist only to parse the ELF and recover functions. LLVM already ships
            `llvm::object::ELFObjectFile` and `DWARFContext`, and they are IN the wasm build
            already sitting on disk. Porting elfconv's loader onto LLVM's own object/DWARF
            readers removes three ports rather than performing them. Measure before committing,
            but this is the first thing to try.

        A CAVEAT THAT MUST NOT BE LOST: those artifacts live in a NEIGHBOURING working tree
        (`Projects/hupyy/...`), outside this repository and not committed here. Depending on
        another checkout is a spike, not a build system. This phase must either vendor the build
        recipe and reproduce it, or pin and publish the archives — a green build that only works
        on one laptop is the thing this project's conventions exist to refuse. -->

### Phase 27: The Demo UI, Driven by the Real Fabric
**Goal**: The demo page shows every workload the fabric can already run, in the imported mockup's design, with every figure on screen produced by a live `TabApi` reading — so the gap closes between what this project can do and what a visitor can see it do
**Depends on**: nothing scheduled. Every API it consumes exists — `runColouring`, `runPi`, `runJob`, `activity`, `heldPeers`, `capacity`, `governor`, `startReport`, `verifyAnswer`. This phase writes no fabric code; it is a wiring and rendering phase
**Requirements**: no new IDs — **amended 2026-08-10 by Plan 27-10, and one id was minted after all.** The original line read: *"It closes the demo half of MR-03…MR-07, whose ledger rows already name this exact gap — 'The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from `packages/browser/demo/main.ts`' — and widens DEMO-01/DEMO-02 past the one workload they were written against. Audit finding G4 (`runJob` has no caller in the page) closes here or is restated with a reason."* What actually happened, row by row:
- **MR-03…MR-07** — the demo clause is amended rather than closed. The demo's *aggregation* workload is π: it merges through `reduceJob`, Plan 27-05 gave it a run control, and `packages/node/src/demo-pi.e2e.test.ts` presses that control on a real two-tab page and reads the tree off the screen. The demo's *colouring* merge is still `answerOf` and **stays that way on purpose** — a colouring is first-found-wins, so there is nothing to aggregate; it is a scan by shape rather than unwired residue, and calling it residue was half of what these rows had wrong. **All five stay `[ ]` Partial**, each now stating per row what no surface exercises. `MR-03` is the only one of the five whose criterion a page button reaches; whether that is enough to tick it is an owner decision, recorded in `27-OPEN-ITEMS.md` rather than taken by the reconciliation wave.
- **DEMO-01 / DEMO-02** — widened, and both stay `[x]` **Done**. **This line is corrected 2026-08-10 and the original is kept:** it read *"Five surfaces now carry live readings driven through the page's own controls"*, and **three** do. Recounted from `REGIONS` and from `index.html` rather than from the surface list — colouring **16** reading regions behind `#run`, π **12** behind `#run-pi`, bring-your-own **11** behind `#run-byo`; **fabric** carries **21** live readings and **no run control at all** (a 1 s reconciler and the secondary `#refresh-report`, no `.btn-primary` by UI-SPEC section 11, and `demo-liveness.e2e.test.ts`'s P5 skips it **by name**); **bench** carries **no live reading of any kind** — its three regions are two `cited` and one `prose`. So the true statement is: three surfaces driven through a control, a fourth live without one, a fifth not live at all — and the fifth is a citation surface by design, not an unwired one. Held by two guards that fail on an absent region after a run and on an undeclared number anywhere inside `#main`.
- **G4** — *"closes here or is restated with a reason"* and it did **both**, which is why it is now split in the audit. The **`runJob` half is closed**: `#byo-form`'s submit handler calls `window.o2.runJob`, driven on four arms by `packages/node/src/demo-byo.e2e.test.ts`, including a module signed by a key this tab does not pin, refused in the fabric's own words in 142 ms against an accepted dispatch's 271 ms in the same run. The **primes half was restated with a reason and left open** — see the disposition below — and was **closed on 2026-08-17** when the owner took Option A. Both halves are now shut.
- **EGR-01, minted** — the egress reading cannot tell *the run registered no sovereign data* from *the guard saw none leave*, and one sentence covers both on five surfaces. Measured three times by three plans and correctly deferred all three; minted as an id so the fourth time is a decision. `[ ]` **Not started**, decider owner. **Amended 2026-08-11: `[x]` Done.** `EgressManifest.registeredSovereign` is counted in `submitJobWithEgress` and carried through `sliceManifest` as a required argument; `egressLines` has a third arm; the sovereign bring-your-own arm reads *"registered 6 sovereign shards … saw none of them leave"* beside a sovereign-label region saying every shard was submitted owner-pinned. The spec that **required** the false words is replaced by one that forbids them and was watched red under a planted two-arm branch. Audit finding `G13`, reopened in part on 2026-08-10 pending exactly this, is re-closed. Full reading in `REQUIREMENTS.md`'s traceability row.
**Research**: measured 2026-08-08 against both artifacts, recorded below

> **SUPERSEDED 2026-08-17 — Option A was taken and the primes workload runs.** The disposition
> below is the record of Phase 27's decision and is left standing unedited; what follows it is no
> longer the state of the tree. `PRIMES_RECORD` is signed, all three demo records were re-signed
> under a new anchor — **the trust-root change the paragraph below names as the blocker, paid
> knowingly** — `TabApi.runPrimes` exists and `demo/main.ts` calls it, and `#s-primes` carries
> the one control UI-SPEC §11 specified and had never rendered. `demo-primes.e2e.test.ts` drives
> Chromium and reads `N = 100000, shards = 8, fabric counted 9592, published value 9592`: an
> equality against a value tabulated in the mathematical literature. The mechanism the final
> paragraph below describes — *"expected to FAIL the day somebody wires the workload"* — fired
> exactly as designed and forced the surface's replan rather than letting it stay quietly absent.
> **`G4` is closed.** N9, per-shard counts, became a reading the same day — `TabPrimesRun` gained
> `perShard`, derived from the tab's own shard results, so its sum against the combine nodes'
> aggregate is a check on the reduce. No region in the catalogue claims a permanent absence now.

**THE PRIMES DISPOSITION — written here so a reader who opens no plan file still gets the true version.** This phase shipped a Primes **surface** and did **not** ship a Primes **workload**. Twelve regions render, eight of them are permanent named absences, the published π(x) oracle is shown as a citation with its provenance in the same region, and `#s-primes` carries **zero buttons of any class**. Nothing on it runs. The roadmap calls Primes one of two load-bearing surfaces and this phase did not make it run anything, so *descoped is not satisfied* applies to it in full.

The reason is measured rather than asserted: there is no signed record for the prime-counting module (`kernel-record.ts` exports two and no third, and a tab pins one anchor, so every executor refuses a prime-counting dispatch for a provenance failure); `runJob` cannot carry the input (its shards are `{ value: { a: i } }` and the kernel reads an eight-byte block from `buildPrimesInput`); and re-signing is not free, because `scripts/sign-kernel.ts` discards its private half on every run, so a third record means a **new trust anchor** and a change to what a stock `o2 agent` and a stock `o2 seed` will run. That last clause is why **Option A is an owner decision and was not begun** — it touches the trust root. Option B, shipping the absence honestly, is what landed.

The absence is held mechanically rather than by this paragraph. `packages/node/src/demo-primes.e2e.test.ts` re-runs the caller measurement on every run — **17 matches of five symbols across 5 files, 11 on a code line in 2 files, production callers 0**, read 2026-08-10 — and its header states that it is **expected to FAIL** the day somebody wires the workload, at which point the surface stops being honest and must be replanned. A planted `runPrimes` on `window.o2` turns sixteen assertions red across two files. Full cost, blocker and decider: `27-OPEN-ITEMS.md`, item 1.

**Plans:** 10/10 plans executed

Plans:
**Wave 1**
- [x] 27-01-PLAN.md — the activity bar fits and Stop is a 44×44 target: UI-SPEC §6.2's grid contract, and B1–B7 plus B2b/B2c at five widths in two bar states

**Wave 2** *(blocked on Wave 1)*
- [x] 27-02-PLAN.md — the mockup's design as plain CSS with no framework, no CDN and no remote font; six surfaces behind a hash-driven tab strip; P10 over the whole pre-consent request set

**Wave 3** *(blocked on Wave 2)*
- [x] 27-03-PLAN.md — the 91-region catalogue, the region writer, and the anti-placeholder guard landed **before** the screens it holds; the session header wired through it

**Wave 4** *(blocked on Wave 3)*
- [x] 27-04-PLAN.md — the Colouring surface's 21 regions from one pure formatter, and P5, the liveness property that stops P2/P3/P4 being satisfiable by a page rendering nothing

**Wave 5** *(blocked on Wave 4)*
- [x] 27-05-PLAN.md — the π and reduce surface: 14 regions, a run control, and a lone tab that reads the reduce it cannot run as a condition of the topology rather than as a failure

**Wave 6** *(blocked on Wave 5)*
- [x] 27-06-PLAN.md — the Primes surface as a named absence: twelve regions, no run control, and four mechanisms that keep G4's primes half visible **(the workload itself was OPEN and was closed 2026-08-17 — one of those four mechanisms is what forced the replan; see the disposition above)**

**Wave 7** *(blocked on Wave 6)*
- [x] 27-07-PLAN.md — bring-your-own: a caller for `runJob` in the page, a form that requires a complete signed record, and three sentinel zeros caught by reading the screen

**Wave 8** *(blocked on Wave 7)*
- [x] 27-08-PLAN.md — fabric state: twenty-one readings, a duty-cycle slider, per-reading `try`/`catch` proved by a plant that froze the surface, and the per-surface attestation hook

**Wave 9** *(blocked on Wave 8)*
- [x] 27-09-PLAN.md — Benchmarks: 181 figures transcribed and every one checked against the committed document read off disk; `./perf/` packaged from one committed source; B5 un-vacuumed

**Wave 10** *(blocked on Wave 9)*
- [x] 27-10-PLAN.md — the ledger reconciliation: G4 split, the MR and DEMO rows amended, `EGR-01` minted, and `27-OPEN-ITEMS.md`

<!-- FILED 2026-08-08 BY OWNER INSTRUCTION ("integrate our actual p2p cloud into this"), after
     importing the mockup. NOT scheduled into v1.1 — v1.1's span is phases 11-22 and this sits
     outside it, exactly as 23-26 do. It is the most natural v1.1-completing candidate on the
     board, because it closes ledger rows v1.1 opened; scheduling it is the owner's call.

     THE ASYMMETRY, stated once so nobody re-derives it. The fabric runs three kernels and a
     bring-your-own path. The page runs ONE of them and prints the result into a `<pre>`. So
     the project's own demo understates the project, and the understatement is invisible from
     inside the page — nothing is broken, there is simply no surface.

     WHAT WAS MEASURED 2026-08-08, not assumed. Both artifacts were driven under Playwright.

     1. THE MOCKUP CONTAINS NO FABRIC AND MUST NOT BE MISTAKEN FOR ONE.
        `docs/design/mockups/o2-fabric-demo/`, instrumented before page load and clicked through
        its gate: hosts contacted are itself, `fonts.googleapis.com`, `fonts.gstatic.com`,
        `unpkg.com` — no relay, no seed, no peer. `WebSocket` constructions: 0.
        `RTCPeerConnection` constructions: 0. `WebAssembly.instantiate` calls: 0. `window.o2`:
        `undefined`. Its peers are eight literals (`peer-4a91`, `peer-c07e`, …) and its figures
        are `data-props` defaults. It is a drawing. Its VALUE is that it is a drawing of the
        right thing — six surfaces, four of which have no implementation anywhere.

     2. THE SHIPPED PAGE GENUINELY WORKS, so this phase is not a rescue. Driven against a real
        `bin/seed.ts` relay: consented, joined, `2 node(s) computing`, ladder FOUND at n=300,
        400 and 500, `no answer` at 600, verification cost 2.00x, and the local verifier
        re-derived 386 triples and accepted. Zero console errors. The mechanism is sound; only
        the surface is thin.

     3. WHAT THE PAGE ALREADY HAS AND DOES NOT SHOW. `runPi` landed 2026-08-08 (f42e985) with a
        verified tree-reduce behind it and has NO BUTTON. `runJob` — the bring-your-own path,
        signed record required, `sovereign` label available — has no caller in the page at all;
        that is audit finding G4, and the mockup draws a screen for it. The primes workload has
        no page-side entry point of any kind. Three of the mockup's six surfaces are therefore
        WIRING; one (`Benchmarks`) is rendering a document that already exists at
        `docs/perf/prime-and-pi-benchmarks.md`; one (`Fabric state`) is rendering readings
        `TabApi` already returns.

     4. A MOBILE DEFECT WAS FOUND WHILE MEASURING, and it belongs to this phase because this
        phase rewrites the element. At a 393px iPhone viewport the always-visible bar is 500px
        wide: `#bar-what` and `#bar-stats` are flex children that do not wrap, so the page
        scrolls sideways and `#stop` sits past x=482 — OFF SCREEN. Stop is the control the
        consent gate promises in writing ("The Stop control in the bar. It ends the thread and
        closes the connections immediately"). `index.html` already carries a comment about a
        previous `#bar` defect *"Reported from an iPhone; not caught here, because the tests
        asserted the `hidden` attribute rather than whether anything was on screen."* This is
        the same blind spot one property over: nothing asserts the bar FITS. The fix is small;
        the spec that stops it recurring is the deliverable.

     THE ONE RULE THIS PHASE MUST NOT BREAK, and it is the whole risk of the work. A mockup is
     full of plausible numbers, and the way this phase fails is by shipping any of them. Every
     figure rendered must come from a `TabApi` reading or be a NAMED ABSENCE — never a default,
     never a placeholder that survived, never a value the page computed a second opinion about.
     The repository already states this rule at the two places it matters and both must hold:
     `TabColouringRun.attestation` says the page renders the kernel's own `description` and
     "composes none of its own, which is the only arrangement in which the CLI and this page
     cannot come to describe one result differently"; and the egress panel says "0 withheld"
     ONLY together with the sentence explaining it registered no sovereign data, because the
     bare figure "would read as a sovereignty proof and would be a lie by omission".

     So the guard this phase owes is a spec that FAILS when a placeholder reaches the screen —
     drive the page with the fabric stopped and assert every figure region reads as an absence
     rather than a number. Without it, "the mockup is now wired" is satisfiable by CSS.

     A NOTE ON WHERE THE DESIGN LIVES. The mockup is a `<x-dc>` template rendered by a vendored
     `dc-runtime` that fetches React and Babel from unpkg at runtime. THAT IS NOT SHIPPABLE as
     the demo — the demo is a static-host page with no build-time CDN dependency and no React.
     This phase takes the mockup's LAYOUT AND WORDING, not its runtime. Two guards already name
     paths inside the mockup directory (`vocabulary`, `strip-comments`); porting the design out
     of it must not disturb them, and if the mockup directory is later deleted both guards say
     so through their dead-entry checks rather than going quietly green.

     SEQUENCING, suggested rather than fixed: the bar fix and its fits-the-viewport spec first
     (smallest, and it is a live defect on a promised control); then the placeholder guard,
     because it must exist BEFORE the screens land or it will be written to fit them; then pi
     and primes, which are buttons over APIs that already return the right shapes; then
     bring-your-own, which is the only one with a real design question in it — a page that
     accepts a module CID must also accept a signed record, and `runJob` requires one by
     construction. Benchmarks last: it renders a committed document and blocks nothing. -->

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


### Phase 28: One Cryptographic Implementation, and the Facades Ledgered

**Goal**: `packages/core` holds exactly one Ed25519 implementation rather than two, libsodium
leaves the dependency tree, and the certificate-lifecycle facades stop being
real-but-unledgered code

*(Goal amended 2026-08-10: it read "one Ed25519 implementation **in the trust path**", which
inherited the same error the entry's finding ONE carried — neither implementation is in the
trust path. See the correction below. The duplication is real; its location was not what was
written.)*

**Depends on**: Phase 25 (which shipped both of the implementations this phase reconciles)
**Requirements**: `CRYPTO-01`…`CRYPTO-06`
**Success Criteria** (what must be TRUE):
  1. `packages/core` holds exactly one Ed25519 selection path, and the surviving gate is the
     **round-trip probe** (`subtle.generateKey({name:'Ed25519'})`) rather than the presence-only
     check — a presence check passes on engines that expose `subtle.sign` without Ed25519
  2. `libsodium-wrappers` appears in no manifest, no lockfile and no built bundle, and a bare
     specifier resolution for it **throws**
  3. `CRYPTO-01…06` exist in the ledger with honest `[ ]`/`[x]` status, and both ledger parsers
     read them
  4. The differential-conformance guard survives, still weighted toward REJECTION vectors —
     asserted rather than incidental — and still covers the sync/async port boundary
  5. The bundle delta is measured and guarded in the **removal** form: absence asserted
     directly, size asserted to have moved DOWN. A ceiling alone is satisfiable by doing nothing
  6. The WebKit signature-nondeterminism finding is a guard, not a docblock: signature bytes are
     **not a stable identifier in this fabric**, and the one legitimate comparison
     (`tools/aot/cli.ts:314`, a single-process round-trip fidelity check) sits in a bounded
     register rather than being exempted by silence

**Plans**: `28-01` (one module, one selection, one gate) → `28-02` (libsodium leaves, measured
and guarded; **alone in its wave** because it runs `npm install`) → `28-03` (the two guards) →
`28-04` (the `CRYPTO` mint). Strictly sequential — four tasks touch `ed25519-backend.ts`.

<!-- FILED 2026-08-10, as the direct consequence of the night Phase 25 landed. Two things came
     out of that session that belong to no phase, and both get worse the longer they sit.

     ONE. TWO OVERLAPPING Ed25519 IMPLEMENTATIONS NOW LIVE IN `packages/core`.
     `ed25519-backend.ts` (Phase 25, verified 7/7, subtle -> libsodium) and `cert-lifecycle.ts`
     (subtle -> noble). Both are correct and separately tested.

     >>> CORRECTED 2026-08-10, THE SAME DAY IT WAS WRITTEN, BY READING THE TREE. The sentence
     >>> that stood here was:
     >>>
     >>>   "Having both is the defect: two implementations in one trust path is exactly the
     >>>    hazard the differential-conformance guard was written to police, and it now has to
     >>>    police a seam nobody chose."
     >>>
     >>> IT IS WRONG, and it is wrong in the direction that overstates the danger. NEITHER
     >>> implementation is in the trust path. Production verification calls `@noble/curves`
     >>> DIRECTLY at six sites, NAMED BY SYMBOL RATHER THAN BY LINE (re-cited 2026-08-10; this
     >>> correction originally read `capability.ts:219`, and the call is at `:249` — it was
     >>> moved by `31b64a6`, THE SAME COMMIT THAT WROTE THE CITATION) — `verifyChain` in
     >>> `capability.ts`; `redeemChallenge`, `enrol` (twice) and `verifyCertificate` in
     >>> `enrollment.ts`; `verifyCapabilityRecord` in `discovery.ts`. The six-site count is
     >>> unchanged and was re-measured. So the arrangement is THREE, not two: a direct noble
     >>> path that production actually uses, plus two selection layers that nothing in
     >>> production calls.
     >>>
     >>> WHAT THIS CHANGES, both ways. It makes the merge SAFER than filed — behaviour-neutral
     >>> in production, because no production caller routes through either layer. It also CAPS
     >>> WHAT THE PHASE MAY CLAIM: this is a duplication-and-ledger cleanup, NOT the removal of
     >>> a live hazard in the trust path, and it must not be written up as the latter.
     >>>
     >>> Kept rather than deleted, per the house pattern: a claim that moved is exactly what a
     >>> later reader benefits from finding explained rather than silently absent.

     TWO. THE FACADES ARE BUILT, TESTED, MERGED — AND UNLEDGERED. 28 node tests, 114 browser
     tests across chromium/firefox/webkit, `tsc` clean, merged at `db89ad2`. No requirement id,
     no verification, no roadmap entry. Under this repository's own conventions that is the
     *built, not wired, and not counted* shape this milestone exists to eliminate, and it was
     produced by the milestone's own work. They are deliberately NOT exported from
     `packages/core/src/index.ts`, which keeps the honest status honest but also keeps them
     invisible to every guard that reads the barrel.

     WHAT DROPPING libsodium IS WORTH, MEASURED RATHER THAN ASSUMED:
       - 314.9 KB gzip against a whole-demo bundle of 168.93 KB — 1.9x the application
       - its ONLY consumer is `ed25519-backend.ts`; nothing else in `packages/*/src` imports it
       - the replacement costs ~nothing: `@chainsafe/libp2p-noise` already imports
         `@noble/curves/ed25519.js`, the exact module, so noble is in the browser bundle graph
         before this project writes a line
       - and it deletes the lazy-`import()` obligation entirely, which was the single most
         fragile requirement in the Phase 25 design, along with the import-counter test guarding it

     PER-VERIFY COST, measured in real Playwright-driven engines 2026-08-10:
       chromium 0.048 ms subtle / 0.494 ms noble · webkit 0.140 / 0.845 · firefox 0.125 / 1.520.
     The deepest capability chain anywhere in this repository is TWO and production builds ONE
     (`capability.ts:101-127`), so a real chain on the fallback arm is ~1-3 ms, not the 10.78 ms
     that `MAX_CHAIN_DEPTH x 1.348` implies. That figure is a bound and has never been observed.

     A FINDING THIS PHASE MUST NOT LOSE: **Ed25519 signatures are not byte-identical across
     engines.** WebKit hardens against fault attacks with a synthetic/hedged nonce rather than
     RFC 8032's deterministic one, so a subtle-signed and a noble-signed signature over the same
     message differ — both valid. Caught by watching a browser run go red, not by reasoning.
     Consequence beyond this phase: **signature bytes are not a stable identifier in this
     fabric**, so anything that dedupes, caches or compares attestations by signature bytes works
     in Node and CI and breaks in Safari. X25519 agreement IS byte-identical everywhere.

     THE OBLIGATIONS:
       1. one Ed25519 implementation in `packages/core`, not two
       2. `libsodium-wrappers` removed from `@o2/core`'s manifest and from the lockfile
       3. `CRYPTO-01…NN` minted for the facades, with honest `[ ]`/`[x]` status under the
          entry-point-reachability convention
       4. the differential-conformance guard survives the merge, still weighted toward REJECTION
          vectors, and still covers the sync/async port boundary
       5. the measured bundle delta of the removal, guarded the way 25-03 guards the decoder's
       6. the WebKit signature-nondeterminism finding carried into a guard, not just a docblock

     TWO GUARD DEFECTS THE PLANNER MUST CLOSE, found 2026-08-10 while gathering context. Both
     are consequences of the removal rather than pre-existing faults, so neither is visible in
     the tree today:
       - OBLIGATION 4 GAINS A VACUITY HOLE. With libsodium gone, a host where `crypto.subtle`
         is absent is left with exactly ONE backend, and every "the backends disagreed" loop
         then passes by comparing a backend with itself. Nothing currently asserts a minimum
         count. Latent rather than live — every host measured so far is Ed25519-capable, so
         this is marked INFERRED — but obligation 4 must add a `backends.length >= 2` floor or
         the guard it promises to preserve becomes unfalsifiable on exactly the tier libsodium
         was bought for.
       - OBLIGATION 5's GUARD SHAPE DOES NOT TRANSFER. 25-03 guards an ADDITION with
         `toBeLessThanOrEqual`, which is sound for a ceiling. A ceiling on a REMOVAL is
         satisfiable by doing nothing at all. The bundle-delta guard needs a different form —
         assert the absence directly, and assert the size moved DOWN by a floor, not up by a
         cap.

     WHAT THIS PHASE DOES NOT DECIDE, and must not quietly decide by implementing:
       - whether the Ed25519 PORT gets wired to the trust path at all.
         >>> CORRECTED 2026-08-10, same day, by grep. This read "whether `verifyChain`/
         >>> `verifyCertificate` get wired to a port at all. Phase 25 left them unwired" — and
         >>> `verifyChain` IS WIRED. It has a production caller at
         >>> `packages/net/src/capability-authorizer.ts:132`, `verifyCertificate` has six, and
         >>> `REQUIREMENTS.md:803` already recorded this. What is unwired is the PORT: nothing
         >>> anywhere calls `initEd25519` or `getSyncVerifier`.
         The open question survives the correction intact, because it was never about those two
         functions having callers — it is where each of three runtime entry points calls `init`
         before first use, and what a verification arriving before it resolves should do. Block,
         fail closed, or fail open is an OWNER ruling, not an implementation detail. If wiring
         proceeds, the staleness window it introduces (moving `#refresh` off the `verifiedPeers`
         read) is a security parameter and needs a sited constant.
       - whether THE FACADES are exported from the barrel.
         >>> CORRECTED 2026-08-10, same day. This said "the facades should be exported from the
         >>> barrel. Exporting moves the `reachability-guard` ceiling, currently 75 and verified
         >>> tight" — which silently lumped two files together. `ed25519-backend.ts` is ALREADY
         >>> barrel-exported (`index.ts:386-397`, seven symbols, already counted inside the
         >>> ceilings). Only `cert-lifecycle.ts` is absent from the barrel, so the ruling applies
         >>> to the facades ALONE.
         The cost of exporting them is 12 callable exports: 75 -> 87 and `OPEN_FINDING_CEILING`
         49 -> 61. INFERRED — counted from declarations, not obtained by running the guard.

     ONE NON-BLOCKING DRIFT, recorded so it is not rediscovered as a defect:
     `reachability-guard.node.test.ts:350` and `REQUIREMENTS.md:790` both still say "47" against
     an `OPEN_FINDING_CEILING` that is now 49. Comment drift only — nothing reddens. -->

## Milestone v2.0 — Open the Doors (Phases 29-41)

**Added 2026-08-25**, from the v2.0 requirements section of `.planning/REQUIREMENTS.md`
(`:1267-1623`) and `.planning/research/v2.0/SUMMARY.md`. Thirteen phases, **40 requirement
ids** — 36 newly minted, 4 carried in from v1.1 by their existing ids.

**Phases are numbered from 29, and nothing below 29 is touched by this milestone.** The 28 phase
directories under `.planning/phases/` belong to v1.0 and v1.1; there is no archive and
`latest_completed_milestone` is `null`, so the numbering continues rather than restarting. No
checkbox, goal, criterion or progress row above this heading is edited by this section.

v1.1's subject was mechanism that already existed and that no runnable entry point reached, so it
minted almost no ids. **v2.0's subject is a tier that does not exist, a cohort that has not been
invited, and numbers nobody has taken** — every one of the 36 new ids is `[ ]` and not one of them
is *Built, not wired*.

**What changed on 2026-08-24, and why it opens this milestone.** A Cloudflare Durable Object was
measured doing three jobs a browser mesh structurally cannot do for itself: a dialable libp2p peer
over WSS with a persisted identity, a working Circuit Relay v2 server, and a record store
(`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7, §9, §13). And the
owner has a few hundred willing testers across countries and continents. The missing ingredient
was never hardware — it was somewhere to send them and a way to be reachable once they arrived.

**Not gated on disclosure.** The repository has been public since 2026-07-26, and the owner ruled
on 2026-08-24 that the project is open source with monetization for commercial use added later.
That closes the question twice over rather than trading it away. **The public run is an ordinary
phase inside this milestone and carries no disclosure gate.**

### Settled — stated as settled, and not re-opened by a plan that reaches one of these phases

- Open source, with monetization for commercial use added later, and **no CLA** (owner rulings
  2026-08-24; `PROJECT.md` Key Decisions).
- **Three regions, named by the owner 2026-08-25 and explicitly temporary:** `bootstrap-us`,
  `bootstrap-eu` (created in the binding `eu` jurisdiction), `bootstrap-sam` (a `locationHint`
  only — South America has no jurisdiction value). The set is expected to grow.
- **TURN and a relayed connection are the two fallback rungs** below direct WebRTC. Both are
  wanted; which vendor supplies TURN is open question 4 and is named nowhere in this section.
- **One identity per Durable Object.** `idFromName()` resolves to a single global instance, so
  sharding is addressing, not provisioning.
- **A Cloudflare-hosted node never advertises execution.** Runtime WASM compilation is refused
  there by a V8 embedder flag — the same one that disables `eval` — and
  `WebAssembly.instantiateStreaming` does not exist at all. The requirement is the omission, not
  a workaround for the refusal.

### The sequencing is not taste

Eight orderings below are load-bearing, and each has a stated cost if inverted.

1. **The billing alert is configured before the first Durable Object is deployed** (Phase 29).
   Cloudflare has no hard spending ceiling; its own wording for its budget alerts is
   *"informational only. It does not cap your usage."* The ordering is the whole control.
2. **Exactly one call site may create the three objects** (Phase 29). An object's location is
   fixed by its very first `get()` and never changes afterwards, so a stray `get()` sites it
   permanently and the only repair is a new name.
3. **The inbound listener is made correct before anything carries load** (Phase 30, ahead of the
   relay in 32). Both required fields fail *silently* when omitted, and without a remote address
   derived from `CF-Connecting-IP` libp2p treats the whole internet as one host and caps
   admission at five connections per second — which one or two peers cannot surface by
   construction.
4. **Record expiry lands in the same phase as the record store** (Phase 31), never after. Durable
   Object storage is durable by construction, unlike the browser's evictable IndexedDB, so this
   is the first tier where records that never expire simply accumulate. Phase 29's datastore
   carries the node's identity key and no DHT record for exactly this reason.
5. **The two counters report before the relay accepts its first browser reservation** (Phase 32),
   and **the relay-kill drill is scheduled and repeated** (Phase 33). The hosted tier quietly
   becoming load-bearing while every document still says peer-to-peer is the **median** outcome
   for hosted-relay systems — IPFS's measured cloud reliance (arXiv:2309.16203) and Matrix's
   homeserver dominance are the two precedents. These are structural, not instrumentation polish
   scheduled at the end.
6. **The six-stage connectivity funnel is instrumented and reporting live before recruitment**
   (Phase 37, ahead of Phase 39), because it is how this milestone's headline number gets taken
   at all. No published figure exists for what fraction of a general audience cannot participate.
7. **Telegram's in-app WebView is verified on real iOS and Android links before recruiting**
   (Phase 38), because recruitment happens *from Telegram*. This is a precondition of the run,
   not a detail of it.
8. **The seven conditions of entry gate the first invite** (Phase 39 over Phases 35-38). A
   Telegram-recruited cohort of a few hundred is spendable exactly once: SETI@home's move to
   BOINC lost roughly half of its ~600,000 volunteers to added platform complexity alone, with no
   bug and no bad actor.

**Parallel track (config `parallelization: true`):** Phase 41 depends on nothing else in this
milestone and can run alongside all of it. The new tier does not help it — it needs execution
across two hosts, and execution is exactly what a Worker refuses by ruling.

### Open questions that reach a phase

Six live in `REQUIREMENTS.md` `### Open questions` (`:1561-1606`). They are recorded, not
answered, and each phase that depends on one says so in its own block: 1 → Phase 29,
2 → Phases 35 and 36, 3 → Phases 35 and 37, 4 → Phase 34, 5 → Phases 38 and 39, 6 → Phase 29.

### Out of scope for this milestone

Cold fan-out through a Cloudflare gateway path (the 50-subrequests-per-invocation cap is
cumulative and non-refundable on close — scoped out unless a warm connection-pool design is
budgeted, in which case it must be load-tested against the cap); leaderboards, team rankings and
contribution ranking; any payment or cryptocurrency framing; attentiveness-adaptive intensity
ramping; a single global on/off switch with no regional or cohort slice; a native app, browser
extension or elevated-permission install; silent Battery Status API detection for a low-power
pause; TEE tiers, zk proofs, S/Kademlia and secure aggregation. Reasons for each are in
`REQUIREMENTS.md:1610-1621`.

### Phase Checklist

- [ ] **Phase 29: Hosted Tier Assembly & First Deploy** - A third workspace package deploys a libp2p node to a Durable Object that a peer can dial twice, days apart, and get the same PeerId — with the billing alert configured before the first object exists
- [ ] **Phase 30: Inbound Listener Correctness & Hibernation** - More than five distinct clients a second are admitted, each with its own remote address, and backpressure has a defined answer instead of `undefined`
- [ ] **Phase 31: Hosted Record Store, Its Expiry, and the Capability It Never Advertises** - The hosted node answers on `/o2/kad/1.0.0`, its records expire by an alarm-driven sweep landing in the same phase, and no record it publishes ever claims execution
- [ ] **Phase 32: The Relay Role and the Two Counters** - Two browsers meet through the hosted relay and then leave it, and the peer-to-peer/relayed split is counted before the first reservation is accepted
- [ ] **Phase 33: Three Regions, and a Relay Killed on Purpose** - `bootstrap-us`/`-eu`/`-sam` exist under a closed name set, no document claims where any of them runs, and a scheduled drill measures what a region's loss costs
- [ ] **Phase 34: Two Fallback Rungs Below Direct WebRTC** - A pair that cannot connect directly falls to TURN, then to a relayed connection whose budget is stated at 64 KiB each way and tested on the relayed path
- [ ] **Phase 35: Conditions of Entry in the Browser** - Consent blocks the artifact fetch, an indicator survives an unfocused tab, and the stop control drops CPU to zero and closes the socket the operator pays for
- [ ] **Phase 36: The Kill Switch and a Status Page** - The cohort stops admitting work with no redeploy, sliceable by region and client version, verifiable by a volunteer rather than by internal telemetry
- [ ] **Phase 37: The Six-Stage Funnel and a Frozen Telemetry Schema** - Page load through first task executed is instrumented and reporting live, on a schema designed backward from three questions and frozen before recruitment
- [ ] **Phase 38: Reaching the Cohort — Telegram's WebView and What the Copy Promises** - The in-app WebView is detected and verified on real iOS and Android links, and the public copy promises what the licensing ruling will still support later
- [ ] **Phase 39: The Public Run** - Seven conditions hold on a dated go/no-go checklist, invites go out in stages by region and slice, and BENCH-06's distinct-machine half is finally measured
- [ ] **Phase 40: The Numbers Only the Run Can Produce** - The WebRTC failure rate segmented by country and network class, and a diurnal churn curve, published as measured and never beside a proxy that could be read as one
- [ ] **Phase 41: Cross-Host Determinism for the AOT Track** - The same lift on two distinct hosts is byte-identical, or the divergence is reported — and `AOTW-06` stays gated on a compiler nobody has built

### Phase 29: Hosted Tier Assembly & First Deploy
**Goal**: As a fabric operator, I want a third workspace package — `packages/cloudflare/`, beside `packages/browser` and `packages/node` and not a branch inside `fabric-node.ts` — that assembles a libp2p node deployable to a Durable Object and dialable by an ordinary peer over WSS at an identity that survives eviction and redeploy, so that I can stand up a hosted node with the money and the siting made irreversible-safe before the first object exists.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A third workspace package — `packages/cloudflare/`, beside `packages/browser` and `packages/node` and not a branch inside `fabric-node.ts` — assembles a libp2p node that deploys to a Durable Object and is dialable by an ordinary peer over WSS at an identity that survives eviction and redeploy, with the money and the siting made irreversible-safe before the first object exists
**Mode:** mvp
**Depends on**: Nothing new — builds on the v1.1 tree. First in this milestone because every other hosted-tier phase needs an object that deploys, and because two of its criteria are irreversible once wrong: an object's location is fixed by its very first `get()`, and Cloudflare has no hard spending ceiling
**Requirements**: HOST-01, HOST-05, HOST-08, HOST-10, HOST-11, HOST-12, NET-03 (carried from Phase 3)
**Research**: Partly done — `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7, §8, §9 measured a deployed object holding a persisted identity, and `.planning/research/v2.0/{STACK,ARCHITECTURE}.md` pin `wrangler@4.125.0` and the three workerd gaps (`process.versions`, `BroadcastChannel`, `node:crypto.diffieHellman`). **Open question 1 SETTLED 2026-08-25 — no alias line is needed and the question was the wrong one; wrangler's default resolution already picks the package's own pure-JS path, deep aliasing works only by the raw relative specifier, and every package-qualified form is a silent no-op. This phase ships a guard asserting `diffieHellman` is absent from the emitted bundle, and pins wrangler in a manifest since it is currently declared nowhere. See `.planning/consults/2026-08-25-noise-diffiehellman-on-workerd-measured.md`. The superseded reading follows:** ~~open question 1 reaches this phase and is not answered here~~: whether wrangler's `alias` can redirect one deep file inside `@chainsafe/libp2p-noise@17.0.0` — the package already ships a `browser` field mapping that call to pure-JS X25519 — or whole packages only, is unverified, and it decides whether the hosted tier builds at all. Settled by a real build test, before any plan writes "just add an alias line". **Open question 6 also reaches this phase**: `DEMO-04`'s guard still passes but its stated rationale is spent, and whether it is retired, repurposed as a no-accidental-deploys rule, or kept as written is an owner ruling, not an implementation detail
**Owner rulings 2026-08-25, before any of this was written:** open question 6 is settled — `DEMO-04` is **repurposed, not retired**: the guard stands and its rationale is rewritten from *disclosure is irreversible* to *deploying a paid tier does not happen by itself*. And autonomous execution stops at the Cloudflare boundary: the package, the datastore, the four guards and the open-question-1 build test proceed unattended, while **criteria 1 and 2 are owner acts and stay open until the owner performs them**. A phase report that ticks either on locally-done work has widened what counts as passing.
**Success Criteria** (what must be TRUE):
  1. A billing alert exists and its configuration timestamp **precedes** the deploy that created the first Durable Object — refutable by a deploy log that predates the alert. There is no hard ceiling behind it: Cloudflare's own wording is that its budget alerts are *"informational only. It does not cap your usage."* The runaway-cost figure usually quoted here is one Hacker News self-report (`thewillmoss`, 2026-04-16, 31 points, 4 comments, no billing response), was for ~930 billion row reads per day rather than for alarm invocations, and was multiplied by 60+ preview deployments; it is cited with those qualifiers or not at all
  2. A peer outside Cloudflare dials `/dns4/<name>/tcp/443/tls/ws/p2p/<peerId>`, completes identify, and gets the **same** PeerId when it dials again after the object has been evicted and after a redeploy. A run that mints a new identity on the second dial fails this criterion — a plain Worker does exactly that, three consecutive requests returning three different PeerIds (`...measured.md` §7), which is why the node is a Durable Object and not a Worker
  3. Durable Object storage is reached through `interface-datastore` by a hand-written class in this repository following `packages/node/src/fs-datastore.ts`. **It carries the node's identity key and holds no DHT record until Phase 31 lands the sweep beside the record store** — a `put` of a record-shaped key from this assembly fails a guard, so the unbounded-accumulation window never opens. No published package binds `interface-datastore` to Durable Object storage, and the last generic async datastore this project reached for (`datastore-level`) hung the enrollment RPC for a week
  4. Exactly one call site in the repository can obtain a stub for these objects, and a guard fails when a second appears — planting a second `get()` in an unrelated file is watched turning the guard red. The cost of getting this wrong is not a test failure: the object is sited permanently wherever that call came from and the only repair is a new name
  5. A deploy configuration or CI path that would create a preview deployment fails a guard. The preview multiplier is the structural part of the self-report in criterion 1 — the per-deployment cost was ordinary and the count was not
  6. The `idFromName()` name set is a closed, short enumeration in source, and no name is derived from visitor-controlled input — a planted call passing a request-derived string fails the guard, so no visitor can cause an object to be created
  7. **NET-03 is reported as a second route, not as a closure.** On the Cloudflare path TLS is terminated at the edge by a commercial certificate the host already holds, so the certificate requirement **does not arise rather than being satisfied**. The AutoTLS route is untouched and still wants a public authority and a publicly reachable interface, and NET-03's row keeps that half open. A milestone report that ticks NET-03 on this deploy alone has widened what counts as passing
**Plans**: TBD

### Phase 30: Inbound Listener Correctness & Hibernation
**Goal**: As a fabric operator, I want the hosted node's inbound listener to declare the two fields libp2p needs in order to admit more than five connections a second, and to hold its socket against the hibernation API with a defined answer for the absent `bufferedAmount`, so that I am not running a node which looks healthy while it silently refuses to work or to scale — the two defects that each produce exactly that.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The hosted node's inbound listener declares the two fields libp2p needs in order to admit more than five connections a second, and holds its socket against the hibernation API with a defined answer for the absent `bufferedAmount` — the two defects that each produce a node which looks healthy and silently refuses to work or to scale
**Mode:** mvp
**Depends on**: Phase 29. Sequenced **before** the relay in Phase 32 and before anything that carries cohort load, because both defects fail silently and neither can be surfaced by one or two peers
**Requirements**: NET-11, HOST-15
**Research**: None new — both defects were measured on the deployed object (`2026-08-24-cloudflare-as-a-fabric-node-measured.md`; `PROJECT.md`'s "A correct inbound listener" bullet). The work is shipping the fields and a test that can go red
**Success Criteria** (what must be TRUE):
  1. **More than five** concurrent, distinct client addresses connect to the deployed node inside one second and all are admitted. The count is above five by construction: with one or two peers the defect cannot appear at all, so a green from a two-peer test is a green that could not have gone red
  2. Removing `direction: 'inbound'` from the listener, and separately removing the `CF-Connecting-IP`-derived remote address, each turns criterion 1 red — both plants watched failing and restored. Without the second, libp2p sees the whole internet as one host and the per-host inbound cap becomes a five-connections-per-second ceiling on the entire fabric
  3. Each accepted connection's remote address, read back from the node's own connection list, is the client's address and not the address of the Cloudflare edge — the same value for every peer is the failure this criterion exists to catch
  4. The socket is written against the hibernation API and backpressure has a **stated** answer where `bufferedAmount` is absent: a caller reading it gets the defined value, and a test asserting that value fails when the field is passed through raw as `undefined`. Billing on this platform is duration of held sockets rather than messages carried, so a non-hibernating socket is the cost and a silently-`undefined` backpressure signal is a correctness defect that looks like a healthy node
**Plans**: `.planning/phases/phase-30-inbound-listener-correctness-and-hibernation/30-01-SUMMARY.md` — executed 2026-08-30 without a written PLAN, because the phase turned out to be a proof over an assembly that already existed plus one real defect found by the proof
**Status 2026-08-30 — the work is done, the box stays off, and the reason is one word in criterion 1.** Both requirements are `Done` and ticked: `NET-11` (eight real libp2p peers admitted where the unconfigured default admitted four, the other four refused as `EncryptionFailedError` — libp2p's `inboundConnectionThreshold` defaults to 5/second/host and none was set) and `HOST-15` (a stated `canSendMore` with an anti-vacuity case beside it). Four plants were watched red and restored `cmp`-clean, and plant C reproduces the original defect on demand by naming peers 4–7. **Criterion 1 says the *deployed* node and every reading here was taken on a locally-run `workerd`.** That is a real target — `wrangler dev` runs it with no account and no deploy, which is what reclassified this phase from an owner act to executable work, and it retired two docblocks claiming the platform half was untestable — but it is not the deployed object, and ticking the box on it would widen what counts as passing. The same precedent as Phases 20/21/22 and 29: verified, uncounted, and the missing reading named rather than descoped

### Phase 31: Hosted Record Store, Its Expiry, and the Capability It Never Advertises
**Goal**: As a fabric operator, I want the hosted node to hold and answer records on the fabric's private keyspace `/o2/kad/1.0.0`, with the sweep that bounds them landing in the **same** phase and driven by a Durable Object alarm rather than a `setInterval` that cannot fire there, so that the records I serve actually expire and execution is omitted from every record the hosted node publishes.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The hosted node holds and answers records on the fabric's private keyspace `/o2/kad/1.0.0` — with the sweep that bounds them landing in the **same** phase, driven by a Durable Object alarm rather than a `setInterval` that cannot fire there, and with execution omitted from every record it publishes
**Mode:** mvp
**Depends on**: Phase 29 (an object that deploys and a datastore), Phase 30 (a listener that admits more than five peers a second)
**Requirements**: HOST-03, HOST-04, HOST-09, HOST-13, HOST-14
**Research**: **HOST-13 is a port, not a build, and a plan that rebuilds the policy has done the wrong job.** `providerRecordPolicy` (`packages/libp2p/src/constants.ts:316`) already derives sweep interval and republish threshold from a single validity of one hour; both tiers pass it (`packages/node/src/fabric-node.ts:2154`, `packages/browser/src/browser-node.ts:1539`); and it is read across two processes by `packages/node/src/provider-expiry.node.test.ts` under NET-06. What does not work on workerd is the `setInterval` driving it, because `Date.now()` does not advance without I/O. The read-time half is already satisfied by `verifyCapabilityRecord`'s `expiresAt` check through `DhtRecordIndex`. **HOST-14 is the genuinely missing sweep** — `/o2/<nodeKey>` value records have none
**Success Criteria** (what must be TRUE):
  1. A browser peer writes a record to `/o2/kad/1.0.0` and a second peer reads it back **through the hosted node**, which is configured with the four settings a private DHT needs rather than two — `protocol`, `clientMode`, `peerInfoMapper` and `selectors`. Dropping `peerInfoMapper` is watched emptying the routing table silently (the default strips private addresses and a peer left with none is never added), and dropping `selectors` is watched throwing `MissingSelectorError` on every read, which a caller that catches query failures reads as an empty keyspace
  2. The one-hour provider-record validity policy runs on the hosted tier driven by a **Durable Object alarm**: a provider record published at T is gone at T + validity, observed on the deployed object, with both numbers sourced from the same `providerRecordPolicy` constant rather than restated. Replacing the alarm with the existing `setInterval` leaves the record present past its validity — that is the plant that proves the driver is what changed
  3. `/o2/<nodeKey>` value records expire by a sweep, and the sweep is observed running against records **the fabric actually wrote**, not synthetic fixtures, **before** Phase 39 invites anyone. A sweep that ships after persistence has already lost the property this criterion is about
  4. `getAlarm()` is checked before every `setAlarm()`, and a minimum reschedule interval is enforced: an alarm handler planted to reschedule itself at zero delay is refused at the floor rather than running hot. There is no hard spending ceiling behind this — see Phase 29 criterion 1
  5. The hosted node's published `NodeRecords.capabilities` (`packages/core/src/discovery.ts:414`) contains **no** execution capability, and a guard fails if one ever appears in one — so the scheduler never learns the hosted tier exists as anything but a capability-limited participant. The requirement is the omission: runtime WASM compilation is refused there on every entry point by a V8 embedder flag and `WebAssembly.instantiateStreaming` does not exist at all, so a workaround is not what is being asked for
**Plans**: `.planning/phases/phase-31-hosted-record-store-expiry-and-the-capability-it-never-advertises/31-01-SUMMARY.md`
**Status 2026-08-30 — four of five criteria met, criterion 2 open, and criterion 1 amended by two measurements.** Met: criterion 1's substance (a record written by one peer and read back by a second **after the writer was stopped**, byte-exact, on a locally-run workerd), criterion 3 (`HOST-14`, the sweep run against a record `kadDHT()`'s own `put` wrote, with an anti-vacuity case and a watched plant), criterion 4 (`HOST-09`, `getAlarm()` before `setAlarm()` plus a 60 s reschedule floor on the one reading both scheduling paths take), and criterion 5 (`HOST-04`, `hostedCapabilities()` signing `features: []` and `sovereignFor: []`, with both plants watched red). **Criterion 2 is OPEN**: it asks for a provider record published at T and gone at T + validity **observed on the deployed object**, and nothing here was taken on a deployed object. `HOST-13` is `Partial` for the same missing reading and is in the re-read register as `entry-point-not-driven`.
**Criterion 1 AMENDED 2026-08-30, twice, and both amendments came from plants that stayed GREEN.** The criterion said dropping `peerInfoMapper` is watched emptying the routing table and dropping `selectors` is watched throwing `MissingSelectorError` *on the hosted node*. Measured: (1) a write-then-read **through** the object exercises neither, because both peers are directly connected and the object answers from its own store — the arrangement that sees the mapper is one where the object must answer *about a third peer*, and `findPeer` over a holder announcing only `127.0.0.1` goes red with `NotFoundError` under the library default; (2) `selectors` is a **reader-side** setting — `bestRecord` is called from exactly one place, `@libp2p/kad-dht/dist/src/content-fetching/index.js:170`, the querying node's own `getValue`, and no RPC handler calls it, so the hosted node's selectors govern reads it *performs* and never reads performed through it. Both mechanisms are watched, at the node they actually belong to. The criterion's word *browser* is also not met: the peers are Node peers over WebSockets, recorded as open rather than folded into a green.

### Phase 32: The Relay Role and the Two Counters
**Goal**: As a relay operator, I want the hosted node to run a Circuit Relay v2 server that two browsers use to find each other and then drop out of, with the peer-to-peer/relayed split counted from before the first browser reservation is accepted, so that the fabric cannot become hosted-in-practice while every document still calls it peer-to-peer.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The hosted node runs a Circuit Relay v2 server that two browsers use to find each other and then drop out of, and the peer-to-peer/relayed split is counted from before the first browser reservation is accepted — so the fabric cannot become hosted-in-practice while every document still calls it peer-to-peer
**Mode:** mvp
**Depends on**: Phase 30 (a listener that does not cap at five a second), Phase 31 (records, so a browser can find the relay through the keyspace rather than a hardcoded address)
**Requirements**: HOST-02, NET-14
**Research**: Done — the relay role was measured on a deployed Durable Object (`2026-08-24-...-measured.md` §13): peer A reserved a slot, peer B reached A only through it, verified A's PeerId and pinged in 54 ms. `circuitRelayServer()`'s own "will not work in browsers" comment is about browsers, and a Durable Object is not a browser
**Success Criteria** (what must be TRUE):
  1. Browser A reserves a slot on the deployed relay, browser B reaches A **only** through it and verifies A's PeerId, and the pair then completes a WebRTC handshake after which traffic flows with the relay out of the data path — observable as the relay's byte counter flat while the pair's own counter moves
  2. Removing `addresses.announce` is watched turning criterion 1 red with **empty reservations**: with nothing declared the server has no address to hand a client, and every reservation comes back empty rather than erroring
  3. Two counters — connection-seconds and bytes carried **peer-to-peer**, against connection-seconds and bytes carried **through the relay** — are reporting **before the relay accepts its first browser reservation**. This is ordering inside the phase, not a dashboard added later: the hosted tier becoming load-bearing while the documents still say peer-to-peer is the **median** outcome for hosted-relay systems, with IPFS's measured cloud reliance (arXiv:2309.16203) and Matrix's homeserver dominance as the two precedents
  4. The counters are not vacuous: a run in which every pair falls back to a relayed connection and a run in which every pair connects directly produce visibly different values on both counters, and a counter that reports the same split for both arrangements fails
**Plans**: `.planning/phases/phase-32-the-relay-role-and-the-two-counters/32-01-SUMMARY.md`
**Status 2026-08-30 — criteria 3 and 4 met, criteria 1 and 2 open, and the split is deliberate.** Met: **NET-14**, the two counters. `TrafficSplitCounter` keeps connection-seconds and bytes in two columns fed from `trackMultiaddrConnection` — the one seam every transport passes through (`libp2p/dist/src/upgrader.js:140`) — wired into the hosted assembly and reported as a **field on `/self`**, held by the Durable Object rather than by the lazily-built fabric so the split reads before the relay carries anything. Measured on a real workerd: two zeroed columns before any peer dialled, a moved `direct` column with `relayed` still exactly zero after eight did. Criterion 4's non-vacuity is two arrangements against a real circuit relay. **The granularity is stated in NET-14's row and in the phase summary, and it matters for criteria 1 and 2**: `/self`'s split is about the connections this node HOLDS, not about traffic it RELAYS — relayed payload transits as hop/stop protocol streams on direct WebSocket legs, so when two browsers meet through the deployed relay every byte it carries is counted `direct` by this surface. Hop-stream counting lands with criteria 1 and 2, which is the first arrangement in which it is observable. The counters are also per-instance and reset on eviction, so the split is a live reading and not a billing total. **AMENDED 2026-08-31 — the two sentences immediately above are retired, and the one before them is not.** Hop-stream counting did NOT need criteria 1 and 2: a real `circuitRelayServer` in an e2e puts hop and stop streams through `trackProtocolStream` in both directions with no deployed relay and no browsers. `trackProtocolStream` is no longer inert — `packages/libp2p/src/relay-service-log.ts` keeps four counters separated by `stream.direction`, since a relay someone used and a relay this node used are the same protocol string. And the counters are no longer the tier's only reading: `packages/cloudflare/src/relay-service-journal.ts` banks the relay record into Durable Object storage and refuses any write that would shorten it, so `/self`'s `relayService` field IS a lifetime total while `traffic` is not. Read the split exactly as the sentence before still says — `relayService.bytes` deliberately overlaps `traffic.direct.bytes` and the two must not be reconciled by subtraction. Verified by `relay-service-journal.e2e.test.ts`, which reserves against a real workerd, kills and restarts wrangler, and reads the record back from a different process. **Criterion 3's ordering verdict does not move**: nothing reconstructs history it did not observe, so the `rc.4`→`rc.5` window stays dark. **Criteria 1 and 2 are OPEN and were not attempted**: they need two browsers, a WebRTC handshake and the **deployed** relay, plus the `addresses.announce` plant — and `HOST-02` stays `Not started`. Folding a partial version of them in would widen what counts as passing, which is the thing this milestone has refused three times in one day.
**Criterion 3's ordering claim is NOT established, and the basis I recorded for it was false — corrected 2026-08-31, within the hour, by the deploy that shipped the counters.** The retired basis read: ~~*nothing publishes the relay's address to any browser*: the browser client's `bootstrap.json` hands out the hosted node's PeerId for dialling, and no code path asks a browser to reserve on it~~. **Both halves are wrong.** `bootstrap.json` publishes `relayAddrs` naming the hosted node — read live at `https://o2alexanderfedin.github.io/o2.services/bootstrap.json` — and `browser-node.ts:597` listens on `['/p2p-circuit', '/webrtc']`, which *is* asking for a reservation. So a browser that loaded the published client and started a node reserved a slot on this relay, and the client has been able to join since `v2.0.0-rc.4` on 2026-08-28 — **three days before the counters shipped in `v2.0.0-rc.5`.** Whether any browser actually did so cannot be read from here: the counters are per-instance and reset on eviction, so they carry no history, and the reservation record lives in the operator's own view. **The honest verdict is therefore that criterion 3's ordering is unverified and may already be permanently false** — the same shape as `HOST-10`, and it is recorded as such rather than left resting on a basis that does not hold. What IS established is the reporting itself: the deployed object answers `/self` at version `2.0.0-rc.5` with two zeroed columns, on the same PeerId it has carried since 2026-08-27.

### Phase 33: Three Regions, and a Relay Killed on Purpose
**Goal**: As a fabric operator, I want `bootstrap-us`, `bootstrap-eu` and `bootstrap-sam` to exist as three identities in three objects under the closed name set, with nothing anywhere claiming where any of them actually runs, so that a scheduled, repeated drill measures what a region's loss costs instead of my discovering it during the run.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): `bootstrap-us`, `bootstrap-eu` and `bootstrap-sam` exist as three identities in three objects under the closed name set, nothing anywhere claims where any of them actually runs, and a scheduled, repeated drill measures what a region's loss costs instead of discovering it during the run
**Mode:** mvp
**Depends on**: Phase 32 (one relay working before three)
**Requirements**: HOST-06, HOST-07, NET-15
**Research**: None new — Cloudflare's data-location documentation was read rather than assumed (`PROJECT.md`'s multi-region bullet): `locationHint` is best-effort and not binding, `jurisdiction` is binding and takes `eu`, `us` and `fedramp` and nothing else, and an object's location is fixed at first `get()`
**Success Criteria** (what must be TRUE):
  1. Three objects exist, one identity each, under Phase 29's closed name set. `bootstrap-eu` is created in the **`eu` jurisdiction**, which is binding; `bootstrap-sam` carries a **`locationHint` only**, because no South-American jurisdiction value exists — a plan that passes `sam` as a jurisdiction is watched failing at creation
  2. **No surface, document, published record or benchmark line claims where a hosted object runs.** A grep over this milestone's published copy and results finds no location claim, and a review rejects any figure captioned with a city or a country attributed to a hint. The object is placed in a datacenter chosen to minimise latency *from* the hint, so the region name is an address and never a location claim — a report saying "measured in São Paulo" on the strength of a hint has written a measured fact it did not measure
  3. A **scheduled, repeated** drill takes one region's relay out and reports bounded, measured degradation: which stage of Phase 37's funnel moves, and by how much, against the same arrangement with the relay up. A drill run once is a design review; the schedule is the requirement, and its absence from the schedule is the failure
  4. Each region's object is dialable from the other two, so losing one region is a measured degradation and not a partition — observed during the drill rather than asserted from the topology
**Plans**: TBD

### Phase 34: Two Fallback Rungs Below Direct WebRTC
**Goal**: As a browser visitor, I want a pair that cannot connect directly to fall to TURN, and a pair that cannot use TURN to fall to a relayed connection whose budget is written down at 64 KiB **each way** and tested on the relayed path, so that my tab still joins and no design assumes twice the room it has.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A pair that cannot connect directly falls to TURN, and a pair that cannot use TURN falls to a relayed connection whose budget is written down at 64 KiB **each way** and tested on the relayed path — so no design assumes twice the room it has
**Mode:** mvp
**Depends on**: Phase 32 (the relay), Phase 33 (three regions to shard against)
**Requirements**: NET-12, NET-13
**Research**: **Required, and open question 4 reaches this phase.** Where TURN runs is unmeasured in both 2026-08-24 consults and is the one point where the four v2.0 research files disagree with each other — `STACK.md` recommends one vendor to avoid a second vendor relationship and a second always-up server, `ARCHITECTURE.md` calls for a dedicated spike instead. **This phase names no provider**; the spike settles it. The mechanism is not in doubt: `WebRTCTransportInit.rtcConfiguration` accepts a plain `RTCConfiguration` **or a function returning one**, read from the package's own `.d.ts`, which is how short-lived credentials are supplied
**Success Criteria** (what must be TRUE):
  1. A pair that fails to connect directly connects over TURN, with credentials supplied through `rtcConfiguration`'s function form and short-lived: a credential captured from one session is refused after its stated lifetime, and a request from outside the fabric is refused. Both are verified **before** Phase 39 invites anyone, not after
  2. TURN is sharded to match the three bootstrap regions, and a cross-continent pair is observed using its own region's rung rather than one city's. Cross-continent pairs concentrate exactly where TURN is absent, which is why the sharding is part of the requirement and not an optimisation
  3. The protocol specification states the relayed budget **per direction** — 64 KiB each way, not 128 — and a boundary test drives the **relayed** path to the cut and observes it. A test that exercises only direct WebRTC cannot fail this way and does not count. The Circuit Relay v2 data limit is enforced bidirectionally: out plus back plus the reply in flight is `131072` in every framing measured, so a symmetric request/response protocol gets half of what the figure reads as
  4. A pair that falls all the way through is reported as **control-only**, not as a working data path, and a job that would need bulk data over that pair is refused with a named reason rather than stalling
**Plans**: TBD

### Phase 35: Conditions of Entry in the Browser
**Goal**: As a browser visitor, I want to see what will run, what leaves my device and what it costs before anything is fetched, to know the tab is computing even when it is not the tab I am looking at, and to stop it in a way that drops CPU to zero and closes the socket the operator is billed for, so that my machine is never working for someone else without my informed and revocable consent.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A visitor sees what will run, what leaves their device and what it costs before anything is fetched; knows the tab is computing even when it is not the tab they are looking at; and can stop it in a way that drops CPU to zero and closes the socket the operator is billed for
**Mode:** mvp
**Depends on**: Phase 29 (a hosted tier for a tab to hold a socket to). Ahead of Phase 39, which gates on this phase's five requirements
**Requirements**: BROW-06, BROW-07, BROW-08, BROW-09, BROW-10
**Research**: None new for the mechanism — the browser tier, its Workers and the Playwright multi-engine harness all exist. **Two of these are not re-mints of closed v1 rows**: `BROW-01` (consent before compute) and `BROW-04` (a stop control) stay closed, and `BROW-06`/`BROW-08` state the materially stricter obligation beside each. **Open question 2 changes how `BROW-08` is read** — node-local versus a global propagation bound — and **open question 3 reaches `BROW-09`**, whose telemetry sentence depends on a legal basis that is contested across sources and settled by legal review, not by engineering judgement
**Success Criteria** (what must be TRUE):
  1. Opt-in blocks the artifact **fetch**: with consent not yet recorded, a network log of the page shows zero task-artifact requests — not a request that is fetched and then not executed. A reviewer watching network traffic reads a fetch on its own as preparation-to-run, and that reviewer is the audience this gate exists for
  2. A persistent indicator says the tab is computing and is visible while the tab is **unfocused** — a tab-title glyph or equivalent, verified with the tab backgrounded in the three engines this project's Playwright harness already drives. Page-body content alone is watched failing the criterion, because a backgrounded tab shows none of it
  3. The stop control is a hard interrupt of the `Worker.terminate()` class: CPU is measured falling to zero and no in-flight task is allowed to run to completion. A cooperative "stop accepting new tasks" implementation is watched failing this criterion. **The connection the tab held to the hosted tier closes with it**, measured as the duration billing that connection was accruing stopping — on this platform cost is held sockets, not messages, so a stop that leaves the socket open has not stopped anything the operator pays for
  4. Plain-language disclosure is shown **before** opt-in and states four things: what code runs, whose task it is, what leaves the device — with the sovereignty guarantee stated as a selling point rather than a caveat — and what telemetry is sent. A disclosure missing any one of the four fails; a disclosure shown after the opt-in click fails whatever it says
  5. A rough data cost sits beside the CPU disclosure and before opt-in, stated **in bytes for a representative task** and taken from a real run of that task rather than estimated. An international cohort has a mobile-data subset, and a figure nobody measured is the one that gets quoted back
**Plans**: TBD

### Phase 36: The Kill Switch and a Status Page
**Goal**: As a fabric operator, I want to tell the cohort to stop admitting new tasks with no redeploy, sliced by region and by client version rather than all at once, so that I can halt exactly the slice that is misbehaving instead of the whole fabric.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The cohort can be told to stop admitting new tasks with no redeploy, sliced by region and by client version rather than all at once, and a volunteer can see both that control and the fabric's state without being given operator access
**What the user-story form did not carry:** The original's closing clause — *a volunteer can see both that control and the fabric's state without being given operator access* — is a volunteer's capability, a second actor the operator's story cannot speak for; it survives only in the original wording above and in this phase's success criteria.
**Mode:** mvp
**Depends on**: Phase 35 (a node in a tab that can be stopped), Phase 31 (records the status page reads)
**Requirements**: RUN-02, RUN-03
**Research**: **Open question 2 reaches this phase and is not answered here** — whether Workers KV's ~60 s global propagation is acceptable, or whether the push-over-an-open-socket path must ship in this same phase, is unsettled. What settles it is whether "a stop control that provably drops CPU to zero" is read as node-local (the client reads its own flag) or as a global propagation-latency bound. No feature-flag SaaS or self-hosted flag server is used: it is one boolean, read rarely
**Success Criteria** (what must be TRUE):
  1. The cohort stops admitting new tasks with **no redeploy**, and the stop is sliceable **by region and by client version** — flipping one region's slice is observed leaving the other two admitting work. A global-only switch fails this criterion by construction: one bad region would take offline volunteers whose region was never affected
  2. A volunteer verifies the stop **from their own tab** — the indicator and the status page both change — rather than the operator reading internal telemetry. A green taken only from operator-side telemetry does not satisfy this criterion
  3. The propagation window is **measured and published, not assumed**: elapsed time from flipping the switch to the last observed tab stopping, recorded with the population it was taken over. Open question 2 governs what is done about that number; this criterion only requires that it exists
  4. A minimal status page is reachable by a volunteer before Phase 39 sends anything — a read-only view over data the fabric already publishes (DHT records, benchmark output) is enough. What is not enough is nothing
**Plans**: TBD

### Phase 37: The Six-Stage Funnel and a Frozen Telemetry Schema
**Goal**: As the project owner, I want every visitor's progress from page load to first task executed counted at six named stages and reporting live before anyone is recruited, on a schema designed backward from exactly three questions, frozen before recruitment, aggregate-only, and discarding raw IP at collection, so that I can see where the funnel leaks without holding data about who leaked out of it.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Every visitor's progress from page load to first task executed is counted at six named stages and reporting live before anyone is recruited, on a schema designed backward from exactly three questions, frozen before recruitment, aggregate-only, and discarding raw IP at collection
**Mode:** mvp
**Depends on**: Phase 35 (consent, which is where stage two is), Phase 32 (a relay, which is where stage four's classification comes from)
**Requirements**: RUN-04, RUN-05
**Research**: **Open question 3 reaches this phase and is settled by legal review, not by engineering judgement** — consent versus legitimate interest under GDPR is contested *across sources*, not merely unresolved. The engineering recommendation to carry telemetry consent on the same gate as `BROW-06` rather than showing a second banner is a **design recommendation, not a compliance ruling**, and is flagged for legal review before shipping. No third-party analytics SaaS is used: the five surveyed all set persistent cross-session identifiers, retain raw IP by default, or both
**Success Criteria** (what must be TRUE):
  1. Six stages are instrumented and reporting live — page load → consent → WSS to bootstrap → ICE gathering → connection classified → first task executed — with each stage's count readable while the fabric is running, **before recruitment begins in Phase 39**. Standing the funnel up after the first invite means the milestone's headline number was never taken
  2. Each stage's drop-off is attributable: a synthetic client made to fail at exactly one stage moves exactly that stage's count and no other. A funnel where one failure moves two counters cannot tell anyone where a cohort was lost
  3. The schema answers exactly three questions and is frozen before the first invite — the scaling curve, the WebRTC failure rate by country and network class, and diurnal churn. A field that answers none of the three is not collected, and adding a field after recruitment begins breaks the freeze rather than improving the dataset
  4. Telemetry is aggregate-only and raw IP is discarded at collection: a dump of everything stored contains no IP address and no cross-session identifier, checked against the store rather than against the collector's intent
  5. **No published figure derived from this instrumentation is merged with or backfilled from a proxy.** The bounds available today are proxies and are labelled as proxies wherever quoted — 10–20% relay-required industry guidance, and 70%±7.1% DCUtR hole-punch success with ~30% relay fallback and 11% symmetric NAT from a *different* protocol (arXiv:2510.27500). No published figure exists for what fraction of a general audience cannot participate; this milestone is how the real number gets taken
**Plans**: TBD

### Phase 38: Reaching the Cohort — Telegram's WebView and What the Copy Promises
**Goal**: As a browser visitor arriving from a Telegram message, I want to land somewhere that works, with the copy that brought me there promising exactly what the licensing ruling will still support a year later, so that what I was promised is what I actually get — with the contribution posture written down before the first outside pull request arrives.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): A visitor arriving from a Telegram message lands somewhere that works, and the copy that brought them there promises exactly what the licensing ruling will still support a year later — with the contribution posture written down before the first outside pull request arrives
**Mode:** mvp
**Depends on**: Phase 35 (the page the link opens)
**Requirements**: RUN-06, DEMO-05, DEMO-06
**Research**: **Open question 5 reaches this phase.** Whether Telegram's in-app WebView suspends JS on backgrounding, and whether it diverges on IndexedDB or WebRTC, is a MEDIUM-confidence general WebView pattern; Telegram's own current behaviour was not found in any authoritative current source, so it is measured on the devices rather than looked up
**Success Criteria** (what must be TRUE):
  1. The in-app WebView is detected and the visitor is offered an "open in your own browser" interstitial, verified by opening the **real** recruitment link from a **real** Telegram message on **both iOS and Android**. A green obtained from a spoofed user-agent string does not satisfy this: the point of the check is the engine, not the string
  2. What that WebView does to a running node is **recorded from those two devices** — whether JS is suspended on backgrounding, and whether IndexedDB or WebRTC diverge. The answer is recorded rather than predicted; a phase that reports the general pattern without opening the link has reported the thing that was already known
  3. `CONTRIBUTING.md` states explicitly that pull requests are **triaged, never merged**, and that any fix is implemented **independently of the reported diff**. No CLA is planned — the owner ruled to rely on the civilized world rather than build CLA machinery — so provenance for the later relicensing track is preserved by not merging rather than by paperwork
  4. Public recruitment copy and project copy do **not** promise permanent open licensing. The settled position is open source with monetization for commercial use added later, and three dated precedents — Terraform→OpenTofu, Redis→Valkey, Elastic→OpenSearch — show the shape of the backlash when the copy and the later licensing disagree
  5. The copy carries no payment framing and no cryptocurrency framing, and is read against the five patterns `packages/node/src/vocabulary.node.test.ts` enforces. That guard scans tracked files, so recruitment copy that lives outside the tree is checked by hand against the same five patterns before it is sent — an unchecked message is the one a reviewer greps
**Plans**: TBD

### Phase 39: The Public Run
**Goal**: As the project owner, I want the first invite to go out only after seven conditions hold on a dated checklist with named evidence for each, and invites to go out in stages by region and by cohort slice with the funnel read between them, so that the fabric's headline claim is finally measured on hundreds of independently-owned devices rather than asserted.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The first invite goes out only after seven conditions hold on a dated checklist with named evidence for each; invites go out in stages by region and by cohort slice with the funnel read between them; and the fabric's headline claim is finally measured on hundreds of independently-owned devices
**Mode:** mvp
**Depends on**: **Phases 35, 36, 37 and 38 — all four**, because criterion 1 is a gate over their outputs and not a summary of them. Also Phase 33 (three regions) and Phase 34 (both fallback rungs verified before the cohort arrives)
**Requirements**: RUN-01, RUN-07, BENCH-06 (carried from Phase 8)
**Research**: None — this phase runs an event rather than building a mechanism. **Open question 5's answer is a precondition of criterion 1**, since `RUN-06` sits in the gate through `RUN-01`
**Success Criteria** (what must be TRUE):
  1. A **dated go/no-go checklist** records, for each of the seven conditions — `BROW-06`, `BROW-07`, `BROW-08`, `BROW-09`, `BROW-10`, `RUN-02`, `RUN-03` — the named evidence that it holds, and **no invite is sent until every one does**. A row with no named evidence is a no-go, not a judgement call. A Telegram-recruited cohort of a few hundred is spendable exactly once: SETI@home's move to BOINC lost roughly half of its ~600,000 volunteers to added platform complexity alone, with no bug and no bad actor
  2. Phase 37's funnel is **reporting live at the moment the first invite is sent**, observable in its own record with a timestamp preceding the invite — not stood up afterwards from stored events
  3. Invites go out in stages, by region and by cohort slice, and each stage's go/no-go **reads the funnel** before the next invite is sent. Staged rollout is **inferred from general release practice and recorded as inferred**: no named volunteer-computing precedent for staged rollout of a compute cohort was found, and this criterion does not pretend otherwise
  4. **`BENCH-06`'s distinct-machine half is measured from the run**: a map/reduce job distributes across nodes on independently-owned devices across several continents, each machine read off its own announced handshake line rather than off the driver, and the distinct-machine count is published beside the curve. **Until the run reports, the half stays descoped and unmeasured — not met — and a same-host figure may not be published in its place**
  5. The kill switch and the stop control are exercised **during** the run and not only before it, and the observed behaviour matches what Phase 36 measured on a quiet fabric — a control that works at three tabs and not at three hundred is a control nobody has
**Plans**: TBD

### Phase 40: The Numbers Only the Run Can Produce
**Goal**: As the project owner, I want two figures that did not exist before this milestone published under the discipline the `BENCH-` family already carries — the WebRTC connection-failure rate segmented by country and by network class, and a diurnal churn curve per region — so that the two measurements only a real public run can produce are on the record.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): Two figures that did not exist before this milestone are published under the discipline the `BENCH-` family already carries — the WebRTC connection-failure rate segmented by country and by network class, and a diurnal churn curve per region
**Mode:** mvp
**Depends on**: Phase 39 (the run), Phase 37 (the funnel that supplies the denominator)
**Requirements**: BENCH-08, BENCH-09
**Research**: None — the methodology discipline is inherited: pre-registered methodology before the first published number (`BENCH-02`) and percentiles rather than means (`BENCH-03`)
**Success Criteria** (what must be TRUE):
  1. The WebRTC connection-failure rate is published **segmented by country and by network class**, with Phase 37's page-load stage as the denominator, and stated as measured. It is **never** merged with, backfilled from, or presented beside the proxy figures in a way that lets a reader take a proxy for a measurement — a chart placing the measured rate on the same axis as the 10–20% guidance fails this criterion however the caption reads
  2. A diurnal churn curve — node arrivals and departures against time of day, **per region** — is published with the **observation window and the population size stated beside it**. A curve with no stated window is not publishable, because a reader cannot tell a weekend from a fortnight
  3. Both figures carry a pre-registered methodology dated before the first published number, and are reported as percentiles rather than means. A figure published without its pre-registration fails review whatever the number says
  4. Every published figure states which driver and which tier produced it, so no figure is silently replaced — the rule Phase 23 criterion 4 already applies to `BENCHMARK-RESULTS.md`, extended to the run's output
**Plans**: TBD

### Phase 41: Cross-Host Determinism for the AOT Track
**Goal**: As a publisher of signed artifacts, I want the elfconv track's two open cross-host questions answered by running them on two distinct machines — or reported unanswered with the blocker named — so that I know whether a lifted artifact reproduces across hosts, rather than carrying the question for another milestone as a word that reads like a hardware wall and is not one.
**The same goal as originally stated** (restated above as a user story 2026-08-25 by owner ruling — the same claim, in its older form): The elfconv track's two open cross-host questions are answered by running them on two distinct machines — or reported unanswered with the blocker named — rather than carried for another milestone as a word that reads like a hardware wall and is not one
**Mode:** mvp
**Depends on**: **Nothing in this milestone.** A parallel track with a different skill surface, runnable alongside Phases 29-40. The hosted tier does not help it: both ids need execution across two hosts, and execution is exactly what a Worker refuses by ruling
**Requirements**: AOT-03 (carried from Phase 10), AOTW-06 (carried from Phase 26)
**Research**: None for `AOT-03` — repeated lifts in separate spawned toolchain processes are already byte-identical on one host. **`AOTW-06` is gated on a build nobody has paid**: `26-GATE.md` returned **NO-GO**, with 21 of 27 non-test translation units failing to compile for `wasm32-wasi`, and glog has no `__wasi__` branch at all (the `wasm32-wasi-threads` arm only moves the refusal from `glog/logging.h:51` to `glog/platform.h:58`). The only cross-compiled LLVM on this host targets Emscripten and cannot be guest code under this project's preview1 sandbox
**Success Criteria** (what must be TRUE):
  1. The same AArch64 static binary lifted by `elfconv` in separate spawned toolchain processes on **two distinct hosts** produces byte-identical `.wasm` and an identical CID — or a divergence is reported **as a divergence** and not normalised away. `CROSS_MACHINE_BLIND_SPOT` is removed from artifacts by that measurement and by nothing else; a phase that closes without it leaves the flag attached
  2. The two hosts are recorded by name and by each host's **own** reported platform, read off that host rather than off the driver — a same-host run relabelled as two is the failure this criterion exists to catch, and it is the same discipline `announcedMachine` already applies to spawned agents
  3. `AOTW-06` stays gated until a `wasm32-wasi` LLVM is built from source and glog carries a `__wasi__` branch. The first deliverable is therefore a compiler, not a feature, and a plan reporting progress without the toolchain has reported nothing. **The symbol half of `26-GATE.md` is an upper bound, conclusive in neither direction** — `wasm-ld` pulls only the members it needs, and the process and signal residue lives in six LLVMSupport objects — so a future pass must not read it as a verdict
  4. Whatever the outcome, neither id is closed by widening what counts as passing: a one-host result is reported as a one-host result, and `26-GATE.md`'s NO-GO stands until the toolchain exists
**Plans**: `.planning/phases/phase-41-cross-host-determinism-for-the-aot-track/41-01-SUMMARY.md`
**Status 2026-08-30 — no criterion is met, and the phase's actual result is that its blocker was false.** `tools/aot/cross-machine.node.test.ts` had recorded that AOT-03 needs a second `aarch64` Linux machine and that this is *"a thing this repository does not have and cannot synthesise"*. Measured: `gh repo view --json visibility` answers `PUBLIC`, and GitHub offers hosted Linux arm64 runners — so the second host is **obtainable**, and the sentence described effort rather than a physical wall. The arrangement is built and guarded (`.github/workflows/aot-cross-host.yml`, dispatch-only, every job on an `-arm` runner, a refusal to lift where `uname -m` is not `aarch64`; `tools/aot/cross-host-lift.mjs` produces one host's reading with that host's own platform, never the driver's). **Criterion 1 is untouched**: no second reading exists, nothing has been compared, and `CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact. Whether `ubuntu-24.04-arm` is schedulable for this repository is read off documentation and NOT run — the workflow's cheap `report-host` job is that experiment. The dispatch is an **owner act**, because it is a push to a public repository and this project treats publication as a separately-triggered gate. **Criterion 3 is untouched and stands**: `26-GATE.md`'s NO-GO holds, `AOTW-06` stays gated on a `wasm32-wasi` LLVM nobody has built, and nothing here reports progress on it.
