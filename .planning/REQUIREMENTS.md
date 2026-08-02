# Requirements — o2.services P2P Native Cloud (v1)

**Derived from:** `docs/p2p-native-cloud-design.md`, `.planning/PROJECT.md`,
`.planning/research/SUMMARY.md`
**Scope decision:** full design in v1, with Part I (elfconv AOT) sequenced last
**Defined:** 2026-07-24
**Ledger corrected:** 2026-07-27 — see below
**Milestone v1.1 scoped:** 2026-07-27 — see [v1.1 Requirements](#v11-requirements--wire-what-was-built)

---

## How to read the checkboxes

**36 of 72 are `[x]`.** That is down from the 68 that were checked before the v1.0
milestone audit. Of the 36 now unchecked, **32 moved** and **4 were never checked**;
none of the 32 moved because the work was undone — with one exception, VER-02, whose
box was cleared on 2026-07-30 because the mechanism behind it was found to check
nothing and was deleted. Read this before drawing a conclusion from the count.

The v1.0 milestone audit (`v1.0-MILESTONE-AUDIT.md`) traced every requirement from the
five runnable entry points — `bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`,
`tools/aot/cli.ts`, and the demo page — to the mechanism meant to satisfy it. Sovereignty
labelling, tree-reduce, discovery, quorum composition, capability chains and the entire
churn coordinator are **implemented, exported, and covered by their own specs** — and no
path a person can run reaches any of them.

So the ledger now distinguishes three states:

| Marker | Means |
|---|---|
| `[x]` | Delivered on a path reachable from a runnable entry point |
| `[ ]` + **Built, not wired** | Mechanism exists and is unit-verified; nothing calls it |
| `[ ]` + **Partial** | One leg reaches production, another does not |

**The 36 unchecked boxes are 16 + 19 + 1**, and the three markers are not one label:
16 are *Built, not wired*, 19 are *Partial*, and VER-02 alone is *Not started*.
Quoting a single figure for "unreached" merges two states that mean different things —
a mechanism nothing calls, and a mechanism half of which ships — and the merge is what
let the count drift. `requirements-ledger.node.test.ts` now asserts every number in this
paragraph against the boxes and the table, so a row that changes marker without the
prose changing with it fails rather than rots.

The traceability table at the bottom carries the specific reason for each, naming the
symbol that proves it — `runResilient` has no caller, `composeQuorum` has none, no
production site calls `discoverExecutors`, and so on. **That naming is now checked, not
just written**: the same guard reads each *Built, not wired* row's own "X has no caller"
sentence and fails if X has acquired a production call site. Five rows — AUTH-01,
AUTH-02, AUTH-04, SCHED-03, NET-06 — were corrected on 2026-08-01 after exactly that
drift went unnoticed for a day, every one of them understating what had shipped.

**Two examples that used to stand in this paragraph were themselves expired, which is
the point.** It read *"`EgressGuard` decorates no production transport, `RemoteExecutor`
sends no capability field"*. Measured 2026-08-01: `new EgressGuard(transport, …)` is in
both node constructors (`fabric-node.ts:1058`, `browser-node.ts:751`) and in both
benchmark drivers, so the first was flatly false. The second was true only by accident of
its call sites — `RemoteExecutor` *does* put `capability: chain` on the wire
(`remote-executor.ts:115`); what is true is that all six production construction sites
pass the `'dispatches-unauthenticated'` sentinel, so no chain leaves a production
dispatch today. A sentence about a mechanism and a sentence about its callers are
different sentences, and only the second one was checkable. The examples above were
replaced with ones the guard actually holds.

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
- [ ] **VER-02**: Executors commit to a result hash before revealing the result,
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
- [x] **DATA-03**: Data carries a sovereignty label that travels with it and acts
      as a hard scheduling constraint
- [x] **DATA-04**: A sovereignty-pinned task executes only within the owner's own
      node set — the scheduler cannot relocate it outside that set to balance load
- [x] **DATA-05**: The stream tap refuses to send a frame carrying registered
      sovereign data, so the bytes never leave the node, and the running job fails
      as a consequence
      <!-- Restated 2026-07-28 against the amended ROADMAP criterion 1, and true of
      the code as of Plans 13-04, 13-05 and 13-07.

      The refusal. `EgressGuard.send` computes the match, pushes the entry carrying
      its violation label, and then rejects with `EgressRefusal` instead of calling
      the inner transport — the frame is never handed to the wire. Push-before-throw
      means stopping a leak never costs the record that it was stopped, and
      `manifest.totalBytes` sums only entries with no violation, so a manifest
      holding one refused frame reads `entries.length === 1` with `totalBytes === 0`.
      A node that refused and a node that sent nothing are not confusable (13-04).

      The granularity, in the form it was measured rather than the form it was
      wished for. A match is the *whole registered payload, contiguous and
      byte-identical*. A re-encoded, compressed or partial copy is not matched, and a
      probe sending the raw field characters alone — eleven bytes — crossed with no
      violation. Phase 4 drew the same line: a detector, not a prover.

      What the caller observes, and the asymmetry, which is an accepted cost rather
      than an open defect. On a node's own outbound request the refusal arrives
      immediately as a named send failure carrying the violated label. On a reply the
      failure is swallowed by `rpc.ts`'s documented response-leg behavior, so the
      dispatcher waits out its own timeout and learns that the dispatch failed but
      not why. Closing that would change every peer's response-leg failure semantics
      to fix legibility rather than correctness, and the evidence for the cause lives
      in the owner's own manifest — where sovereignty says it belongs.

      A registration lives only until its reply frame has settled (13-07), so the
      scan the refusal depends on is bounded by a node's in-flight sovereign tasks
      rather than by its uptime.

      Proven in-process against real `FabricNode`s and across two spawned
      `bin/agent.ts` processes (13-05). -->
- [x] **DATA-06**: Every job emits an egress manifest recording exactly what left
      the submitting node, with byte counts, retrievable from the job's own result
      <!-- Re-checked 2026-07-28 against the amended ROADMAP criterion 2, which
      narrowed the promise from "each owner's node" to the *submitting* node's own
      tap. That is what `submitJobWithEgress` delivers: the manifest comes back on
      the job's own result value, sliced per job so two jobs against one guard do not
      double-count (13-01). The browser demo's two real Chromium e2e tests read it
      back from the `window.o2` API's own return value rather than from a guard a
      harness built, and 13-VERIFICATION.md mutation-verified that leg
      independently. `bin/bench.ts`'s two fabrics do the same from a runnable entry
      point, and 13-06 puts a test behind those call sites rather than leaving the
      type-checker as their only guard.

      What the amendment gave up, stated so nobody re-derives it. Reading a *remote*
      node's manifest needs a wire message kind that does not exist — `protocol.ts`
      carries exec, block, providers, records, offer, reservations, report and error
      and nothing else — `13-CONTEXT.md` deferred building one, and the criterion
      went on promising it anyway. Cross-process retrieval is now a named future item
      rather than an implied promise, and the "each owner's node" clause is gone
      rather than quietly reinterpreted.

      `bin/agent.ts` is outside this requirement's scope: it is serving-only, 71
      lines, and never calls `submitJob`, so it has no job of its own to emit a
      manifest against. -->

<!-- Both rows above were marked done on their executors' reports. The first
independent pass scored the phase 0/3 fully verified. Re-check the ledger against the
code, not the reports. -->

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
- [ ] **NET-05**: Relay reservation exhaustion is detected and reported rather than
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
- [ ] **SCHED-04**: A resource governor caps node CPU by duty cycle, is
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
- [ ] **BROW-02**: The node reports the percentage of visitors where it failed to
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
- [ ] **BENCH-06**: Benchmarks run across N independent operating-system processes on one
      host; every published run records its machine inventory; and the same-machine label
      stays **required and derived from that inventory**, never declared — sixteen nodes on
      one laptop are reported as sixteen processes on one machine, not as sixteen nodes.
      **The distinct-machine claim is descoped, not satisfied.** It is unmeasured, and
      unmeasured is not met. A same-host run **cannot** detect divergence between machines,
      because it has one CPU, one V8 and one libc: every process shares an instruction set,
      an engine build and a system library, so the very variables a cross-machine benchmark
      exists to expose are held constant by construction. The original cross-machine risk
      stands exactly where Phase 8 left it, unmeasured and now unscheduled. What this
      rewrite *does* buy is real and is tracked separately as **BENCH-07** (Phase 23, the
      multi-process benchmark driver): moving off one event loop makes a parallel speedup
      measurable at all, which the single-process harness could not do at any N. That is the
      honest one-machine win. It is not a distributed measurement and must never be
      published as one

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
- [ ] **AOT-03**: Translation is reproducible on one host — repeated lifts of identical
      input bytes, each running the toolchain in its own freshly spawned container process
      on this machine, produce byte-identical artifacts and therefore an identical CID.
      Measured: two lifts minutes apart, `sha256 490eeed5…`, same `inputDigest`, same
      toolchain versions, same feature set.
      **The cross-machine claim is descoped, not satisfied.** It is unmeasured, and
      unmeasured is not met — two lifts on two hosts have still never been compared.
      **`CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact and stays printed by
      the CLI.** Phase 10 established that the blind spot is **structural, not
      configurational**: elfconv's virtual-register promotion iterates a pointer-keyed
      `std::unordered_map` and a `std::set<BBBag*>`, whose iteration order is an
      address-space property, so no flag, no version pin and no image digest removes it.
      Descoping this requirement removes neither the marker nor the risk it names, and the
      `never claims cross-machine reproducibility` guard in `tools/aot/lift.node.test.ts`
      stays in force.
      *(Status: the one-host half is established. The box stays unchecked because the
      descoped cross-machine half is carried as unmeasured rather than as met — an
      unchecked box here understates on purpose, which is the safe direction.)*
- [ ] **AOT-04**: A translated artifact executes on the fabric under the same
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

**v1.1 mints almost no new requirement IDs, and that is deliberate.** The entries marked
*Built, not wired* and *Partial* above — 16 and 19 as of 2026-08-02, not one merged
figure — are not missing requirements; they are the same requirements, unsatisfied. "The placer cannot relocate a sovereign task" is DATA-03
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
| 5 — Tree-reduce | MR-02 … MR-07 | `executeReduce` on the aggregation path, replacing the demo's linear scan — the aggregation path is wired (Phase 16); the demo replacement is WIRE-02, Phase 22 |
| 6 — Discovery & enrollment | AUTH-01, AUTH-02, AUTH-04, AUTH-05, SCHED-01, SCHED-02, SCHED-03, SCHED-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10 | **Partly landed 2026-08-01, and the row above it said otherwise for a day.** Done: `serveAgent`'s `index` and `capacity` hooks are supplied by both factories, and `requestEnrollment` issues a real node identity before `start()` returns (AUTH-01 `[x]`; AUTH-02, AUTH-04, SCHED-03, NET-06 now *Partial*). Outstanding: `discoverExecutors` replacing the static list — which is also the *reading* half of NET-06 and the re-pick half of SCHED-03 — a `PeerVerifier` on the browser tier, and `composeQuorum` / `attestationReceipt` on the verification path |
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
- [ ] **WIRE-03**: Two browser peers served a static bundle — no seed process, no
      `/bootstrap.json`, nothing dialled by the harness — discover each other and
      complete a job. The browser-tier equivalent of the rendezvous defect already fixed
      one tier down, and the one route with no end-to-end coverage.

      **The standard for browser-tier coverage is one host, several browsers** (owner
      ruling, 2026-07-28). Playwright multi-browser on this machine —
      `instances: [{browser:'chromium'},{browser:'firefox'},{browser:'webkit'}]` — with
      each peer in its own **isolated browser context**, so each gets its own origin
      storage and its own IndexedDB, plus a **locally-started Circuit Relay v2 peer for
      them to dial**. Three engines on one host are three independent JavaScript/WASM
      implementations and three independent storage backends. They are **not** three
      machines: one CPU, one OS, one loopback. Nothing measured this way may be labelled a
      cross-machine or distributed-hardware result.

      **This unblocks four items that were each deferred for want of a multi-browser
      environment.** They are named here so they stop being invisible:
      1. **`BrowserNode.start()` has no dedicated runtime test anywhere in the repository**
         — found in Phase 11 (`11-VERIFICATION.md`, "An honest limit"). Its only caller in
         the whole tree besides its own file is the demo entry point; the call site's
         correctness rests on `tsc` and a source-text guard, not on a dispatch through a
         running node
      2. **`BrowserNode`'s `guardSovereignty` wiring has zero runtime proof** — Phase 12
         (`12-VERIFICATION.md`, `12-04-SUMMARY.md`). Call-site *existence* was verified by
         grep; composition-correctness was not, and was reported as such rather than
         declared proven
      3. **`BrowserNode.egress` is unproven at runtime** — Phase 13, threat T-13-08 in
         `13-03-PLAN.md`, accepted and routed here rather than silently absorbed
      4. **The `EgressGuard` refusal added in Phase 13 inherits into the browser tier
         untested** — `13-VERIFICATION-2.md` deferred item: `BrowserNode` composes the
         identical guard wiring `FabricNode` does, but no sovereign job has ever run in a
         browser, so the refusal branch is compiled and has never executed in a real tab.
         There is now a *behaviour* to exercise, not only a composition to inspect

      **The recorded root cause of all four was one sentence, and that sentence was
      false.** It read: `BrowserNode.start()` needs a real `indexedDB` and a relay to
      dial, so it runs in **neither** vitest project. Retired in the source by Plan 15-05
      and corrected here on 2026-08-01, four months of inheritance later — the correction
      had stopped at the package boundary while these planning documents, which is where
      a planner looks first, still cited the retired claim as authoritative.

      **The corrected statement**, which is the one every source site now carries
      (`browser-node.ts:964`, `:999-1000`, `mutation-ledger.ts:140-151`,
      `serve-agent-hooks.node.test.ts`, `sovereign-block-refusal.node.test.ts`): the
      **`browser`** project genuinely cannot host such a test, because a Circuit Relay v2
      server *"will not work in browsers"* in `@libp2p/circuit-relay-v2`'s own words. The
      **`e2e`** project has no such limit **and needs no relay at all** — the tab dials a
      Node submitter's WebSocket listener directly, and the dispatch returns along the
      connection the tab itself opened. `packages/node/src/browser-capability.e2e.test.ts`
      starts that factory against a live tab today, and
      `packages/browser/src/start-unwind.browser.test.ts` starts it to success in three
      engines. So these four are listed against this requirement because the `e2e` project
      is where they belong, not because nothing can host them
- [ ] **WIRE-04**: The fabric has exactly one job entry point. Submitting a job gets
      lease renewal, speculation and coverage accounting without the caller choosing
      between two functions — today `runResilient` is a second job implementation that
      nothing calls

### Node-side admission & transport bounds (new IDs, minted 2026-07-28)

Added mid-milestone after a subagent tasked with refuting the claim "the fabric has no
backpressure gap" refuted it, at named sites, with reproductions against the real stack
(tcp + noise + yamux, real `FabricNode`s). Each of the three is a measurement, not an
inference.

- [x] **SCHED-06**: A node at its execution slot limit refuses an `exec` request with a
      stated reason naming the limit, and the requestor re-picks. Today `serveAgent`
      consults `capacity` only in the `offer` branch — measured, 4 peers × 200 concurrent
      `exec` requests produced 800 simultaneous `execute()` calls and **zero** refusals.
      `LocalCapacity`, the only thing that can emit the refusal, is constructed nowhere
      outside two test files while both production factories pass the opt-out sentinel.
      It gets wired or deleted; it does not stay built-and-unreachable
- [x] **NET-08**: A peer cannot make a node allocate an unbounded buffer. `readMessage`
      enforces a declared maximum message size and aborts the stream past it — today a
      single **64 MiB** frame was sent over the real transport and accepted, because
      `WIRE_CHUNK_BYTES` is send-side framing only and yamux's window paces delivery
      without capping the total
- [x] **NET-09**: Dispatching N shards immediately after dial either succeeds well above
      12 or fails with a stated, **sender-attributed** reason. Today N=8 completes and
      N=12 fails entirely on `MaxEarlyStreamsError: Too many early streams - 11/10`, a
      hardcoded libp2p default that aborts the whole connection — so in-limit requests die
      too, and the requestor blames the *receiving* node for a limit the sender blew
      through. `bin/bench.ts` ships `SHARDS = 8`, one below the cliff
- [x] **NET-10**: A refusal reaches the requestor as a **named outcome**, not as a
      timeout. Today `rpc.ts`'s responding leg swallows the error — its comment says "The
      requester will time out" — so a sovereignty refusal is measured arriving as
      `rpc … timed out after 4000ms` with no label and no attribution. A requestor cannot
      distinguish "your data may not leave that node" from "that node is gone", in the one
      place the fabric's central promise is enforced. `DEFAULT_RPC_TIMEOUT_MS` is 30,000 ms
      and every test touching this path shortens its budget because the wait dominates,
      which is the cost showing up as wall-clock. Closes the standing principle *every
      exclusion is named* against the refusal path
- [ ] **DATA-10**: A node does not serve a raw sovereign block to a peer, whether or not
      it has executed a task over that block. Today only the **executing** node registers
      its input with the guard (`registerSovereignInputs`), so a submitting node that never
      ran the task holds no registration and will serve the raw bytes on request —
      measured at 95 raw bytes inside a 138-byte block-response frame. Sovereignty is a
      property of the data, not of whether this particular node happened to compute over it

### Benchmark parallelism (new ID, minted 2026-07-28)

- [ ] **BENCH-07**: The benchmark harness spawns N operating-system processes rather than
      N nodes on one event loop, and a makespan difference between N=1 and N=8 is
      measurable on a fixture that saturates a core. Needs only separate processes on one
      host, which Phase 8's own summary named as the cheaper remedy and Phase 12 has since
      built the spawn pattern for. **This is the driver work; BENCH-06 is the reporting
      discipline it runs under** — machine inventory recorded, same-machine label derived
      and retained — **and BENCH-06's distinct-machine half is descoped and unmeasured, not
      met.** Spawning N processes on one host does not close it and must not be published
      as though it had: one host has one CPU, one V8 and one libc

### Explicitly not in v1.1

| Requirement | Why it stays open |
|---|---|
| **NET-03** — real AutoTLS | Needs a publicly reachable host. Outward-facing and a hosting decision, not a code one |
| **BENCH-06** — one-host multi-process benchmarks | Rewritten 2026-07-28 to what one host establishes: N independent OS processes, machine inventory recorded, same-machine label retained and derived. The distinct-machine half is **descoped and unmeasured — not met**. The process work itself is not in this milestone either; it lands in Phase 23 as **BENCH-07** |
| **AOT-03** — one-host reproducible CID | Rewritten 2026-07-28 the same way: byte-identical artifacts across repeated lifts in separate spawned toolchain processes on this machine. The cross-machine half is **descoped and unmeasured — not met**, and `CROSS_MACHINE_BLIND_SPOT` stays on every artifact because Phase 10 showed it is structural rather than configurational |
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
| DET-03 | Phase 14 — Signed Artifact Resolution | Done — `guardModuleProvenance` (`core/src/executor/module-provenance.ts`) is composed innermost in both production node factories (`fabric-node.ts:670`, `browser-node.ts:513`), and `trustAnchors` is a **required** option on both, so no node can be built without stating whose modules it will run. A task with no `NameRecord`, one signed by an unpinned key, or one vouching for a different CID is refused before `inner.execute`; the refusal names the missing record or the offending key. Verified across a real spawned `bin/agent.ts` process (`signed-artifact.node.test.ts`, 5/5) and two real browser contexts (`two-tabs.e2e.test.ts`, 6/6) by 14-VERIFICATION.md |
| DET-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DET-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DET-07 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-02 | Phase 1 — Portable Kernel & Loopback Map Slice | **Not started** — the ceremony that shipped under this id was minted and compared by the requestor itself, so its check was unconditionally true and both failure branches unreachable; measured 2026-07-30 by making the mismatch branch throw and running the whole node project, 1171 tests, no reach. Removed rather than relabelled: its nonce derived from three public values, so it was not hiding and could not have become the two-round ceremony. That ceremony needs a wire and a cross-node barrier and belongs to the phase that ships them |
| VER-03 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — composeQuorum has no caller outside its own spec |
| VER-04 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — composeQuorum has no caller outside its own spec |
| VER-05 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-06 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| VER-08 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — attestationReceipt is called only by itself and its spec; no node emits a receipt |
| VER-09 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — attestationReceipt is called only by itself and its spec; no node emits a receipt |
| VER-10 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — attestationReceipt is called only by itself and its spec; no node emits a receipt |
| DATA-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| DATA-02 | Phase 3 — Browser Tier & Backbone Relay | Done |
| DATA-03 | Phase 12 — Sovereignty-Pinned Placement | Done — `ShardSpec`/`Task.label`/`ownerId` carry the label through `submitJob`'s one placement path (`planPlacement`/`eligibleNodes`); proven under load pressure both in-process (12-02) and across three real `bin/agent.ts` operating-system processes (12-03) |
| DATA-04 | Phase 12 — Sovereignty-Pinned Placement | Done — a sovereign shard's map task never leaves the owner's node set even when the owner's node is saturated and foreign nodes are idle; proven under load pressure both in-process (12-02) and across three real `bin/agent.ts` operating-system processes (12-03) |
| DATA-05 | Phase 13 — Egress Manifest Completeness | Done against the amended criterion, with its granularity stated — both node constructors wrap the transport in an `EgressGuard` before building the `RpcEndpoint` (`fabric-node.ts`, `browser-node.ts`), so the tap sits on the sole code path out rather than on remembered call sites, and `registerSovereignInputs` gives `EgressGuard.guard()` its first production caller. `EgressGuard.send` **refuses**: it records the entry with its violation label and rejects rather than forwarding, so the frame never reaches the wire and the cross-owner job fails as a consequence — `insufficient`, never `agreed` (13-04). Proven in-process against real `FabricNode`s and across two spawned `bin/agent.ts` processes, each paired with a control job on the same live nodes so a refusal cannot be confused with an unreachable or dead peer (13-05). Detection matches the **whole registered payload, contiguous and byte-identical**; a re-encoded or partial copy is not matched, and a probe sending the raw field characters alone crossed unremarked — a detector, not a prover, the same line Phase 4 drew. On a reply leg the requestor observes a timeout rather than the reason, an accepted cost recorded in `egress.ts`. A registration is released once its reply frame has settled, bounding scan cost by in-flight sovereign tasks rather than by uptime (13-07). See `13-VERIFICATION.md` for the pass that found the earlier wording overstated |
| DATA-06 | Phase 13 — Egress Manifest Completeness | Done against the amended criterion — the manifest records what left the **submitting** node and is retrievable from the job's own result, because all three job-submitting entry points call `submitJobWithEgress` rather than bare `submitJob`, sliced per job so sequential jobs on one guard do not double-count (13-01, 13-02, 13-03). The browser-demo leg is independently mutation-verified by `13-VERIFICATION.md` against two real Chromium e2e tests reading the `window.o2` API's own return value; `bin/bench.ts`'s two fabrics are held by a call-site test rather than by the type-checker alone (13-06). The original "each owner's node" clause was **removed, not met** — reading a remote node's manifest needs a wire message kind `protocol.ts` does not define, `13-CONTEXT.md` deferred building one, and cross-process retrieval is now a named future item. `bin/agent.ts` is out of scope here: serving-only, it never submits a job |
| DATA-07 | Phase 12 — Sovereignty-Pinned Placement | Done — a sovereign shard submitted through `submitJob` emits a partial smaller than its raw input; `EgressGuard` (reused as a test instrument) shows zero violations for the run (12-04, criterion 3) |
| DATA-08 | Phase 14 — Signed Artifact Resolution | Done — the `key → CID` mapping travels the wire as `Task.moduleRecord` (`net/src/protocol.ts`), is threaded by `submit.ts` into both task branches, and is checked against `task.moduleCid` at the executor boundary so a genuine record for another artifact cannot rubber-stamp a substituted CID. The demo ships a committed `KERNEL_RECORD` whose signing key's private half was discarded at generation (`demo/scripts/sign-kernel.ts`), and both binaries default to that anchor. Mutation-probed by 14-VERIFICATION.md: emptying the demo anchors turns `colouring-demo.e2e.test.ts` red |
| DATA-09 | Phase 12 — Sovereignty-Pinned Placement | Done — `guardSovereignty` wired into both production node constructors (`fabric-node.ts`, `browser-node.ts`), safe default; a genuine replica holder refuses a direct sovereign dispatch over real RPC while still answering block requests (12-02, 12-04 criterion 4) |
| AUTH-01 | Phase 17 — Node Identity & Enrollment | Done — corrected 2026-08-01; this row claimed no production caller and both factories had one. `requestEnrollment` is called at `fabric-node.ts:555` and `browser-node.ts:413`, `new EnrollmentAuthority` at `fabric-node.ts:1077` and `browser-node.ts:797`, reachable from `bin/agent.ts` via `--provider-addr --user-key --operator-id` and `--issues-certificates`. The round trip completes **before `start()` returns** — a node told to enrol that cannot enrol does not start, and leaves no socket bound. The certificate is persisted dot-prefixed, reused on restart with the provider switched off, replaced when expired, and another node's certificate is not presented as its own. Measured across real operating-system processes (`node-enrollment.node.test.ts`, `enrollment.node.test.ts`). A node not told to enrol still starts with `certificate: null`, so the identity is the raw libp2p peerId only when nobody asked for more |
| AUTH-02 | Phase 17 — Node Identity & Enrollment | **Partial** — corrected 2026-08-01; this row claimed `verifyCertificate` was reachable only through `discoverExecutors`, and it is reachable another way. **The Node tier is wired and verified offline**: `PeerVerifier.start` (`fabric-node.ts:1118`) reaches `verifyCertificate` (`peer-verifier.ts:477`), which takes its anchors as an argument and dials no authority; `certificate-verification.node.test.ts` takes a verdict **with both provider processes dead**, and again through two spawned agents differing only in `--trusted-issuer`. **The browser tier verifies nobody** — `browser-node.ts` constructs no `PeerVerifier`, so a tab takes blocks from any peer. A tab can now *hold* a certificate (the `enrollment` option) and so be verified *by* a Node peer; it does not verify in return, and that asymmetry is the remaining leg. `discoverExecutors` does still have no production caller — it is simply no longer the only path to `verifyCertificate` |
| AUTH-03 | Phase 15 — Capability-Chained Dispatch (serving half) → Phase 23 criterion 5 (requestor half) | **Partial** — the serving half is wired and verified end to end: both node factories install `authorizeCapability`, neither says `'serves-unauthenticated'`, `bin/agent.ts` takes `--owner-key`, and all three of Phase 15's criteria are demonstrated between two spawned `bin/agent.ts` processes (`15-VERIFICATION.md`, 3/3, with an ordering-inversion mutation turning all three red on a blockstore-directory instrument while `tsc` stayed at exit 0). **The requestor half is not wired.** `RemoteExecutor` takes a *required* chain argument — omitting it is a `tsc` error — but all five production dispatch sites name the sentinel, because every one labels its shards `'public'` and a public shard has no owner key to root a chain at. So `delegate`, `CapabilitySupplier` and `RemoteExecutor.execute`'s supplier branch have a production adapter and zero production callers. Owner ruling 2026-07-31: **naming that is not fixing it** — routed to Phase 23 criterion 5 (an opt-in sovereign leg on `bin/bench.ts`, off by default), which is where `bin/bench.ts` is already being rewritten. Also unproven: the **browser** factory's authorizer, which survives a scrambling mutation with 345 browser tests green and is guarded today only by a source-text argument-equality check |
| AUTH-04 | Phase 17 — Node Identity & Enrollment | **Partial** — corrected 2026-08-01; this row claimed no production caller and both factories had one. **Provider-gating and rate-limiting are wired and measured**: `new EnrollmentAuthority` at `fabric-node.ts:1077` / `browser-node.ts:797`, reachable from `bin/agent.ts --issues-certificates`, with the provider signing key generated on-device into a file separate from `.identity.key` so `issuerKey !== nodeKey` always holds; a burst through the production `enrol` request path is refused past the stated threshold (`enrollment.node.test.ts`, criterion 3). **"Costly" is measured *false*, not unmeasured** — the limiter keys on `userKey` and a fresh user key is one `ed25519.keygen()` call, so twenty requests under twenty distinct keys all succeed, and no deletion turns that assertion red. The threshold is also per provider *uptime*, not per wall-clock window, because the issuance history is a `Map` held in the authority object and a restart forgets it. Proof-of-work, payment or an out-of-band identity check is what would close the cost half; the limiter is where it plugs in, and it is out of scope for v1.1 |
| AUTH-05 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Built, not wired** — resolveReplicaSets has no production caller |
| NET-01 | Phase 2 — Real Network, Node ↔ Node | Done |
| NET-02 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-03 | Phase 3 — Browser Tier & Backbone Relay | Partial — relay is browser-dialable; AutoTLS needs a public host |
| NET-04 | Phase 3 — Browser Tier & Backbone Relay | Done |
| NET-05 | Phase 18 — Discovery, Capacity & Placement | **Partial** — the reading half is wired (capacity is derived from the live store and printed by the seed); ReservationWatcher is installed by no process, so a refused joiner gets no named error |
| NET-06 | Phase 19 — Quorum Composition & Owner-Domain Attestation | **Partial** — corrected 2026-08-01; this row claimed no node supplies the `index` hook and both factories do. **The serving half is wired on both tiers**: `index: records ?? 'serves-no-records'` (`fabric-node.ts:1278`, `browser-node.ts:988`), non-null exactly when the node holds a certificate, so a browser peer answers a `records` request on the same terms as a backbone peer — which is the requirement's own point, that a browser differs only in that it cannot bind a listening socket. **The reading half is not**: `discoverCandidates` has no production caller, so nothing queries what is served — corrected 2026-08-02 from a sentence naming `discoverExecutors`, which plan 18-05 wired one level below this one. The index also holds this node's own records and nothing else — `provide()` is never called, so a `providers` request still answers `[]` from every node, and `features: []` is honest rather than a stub because no feature-detection dependency is installed |
| NET-07 | Phase 2 — Real Network, Node ↔ Node | Done |
| SCHED-01 | Phase 18 — Discovery, Capacity & Placement | **Partial** — 2026-08-02. The *not wired* half closed on the day this row predicted it would; It has now been rewritten twice at a moving frontier: it first claimed `discoverExecutors` was uncalled, plan 18-05 gave that its first production caller, and the claim moved up to `discoverCandidates`, which was then itself uncalled. Plan 18-06 closes it — `bin/bench.ts --discover` (`packages/node/src/bin/bench.ts`) derives the real rig's executors by intersecting real provider answers with signed capability records, so the bridge exists **and something crosses it** from a runnable entry point. Off by default, because a published scaling curve must not be reshaped by an undeclared change (15-CONTEXT.md decision 2). **What the flag needed that nobody had written down**: discovery answers with signed records, and `resolveCertificate` returns `null` whenever `enrollment` is absent — which was every node the driver had ever built — so the discover arm stands up a provider and enrols each worker under it. Measured with `cwd` in a temporary directory so the committed results could not be overwritten: `1 of 1` and `2 of 2` workers qualified across the real-transport ladder, both rungs completing their egress manifest. **Criteria 1 and 2 remain open** — placement across real `bin/agent.ts` processes is 18-06 tasks 1 and 2, not yet written |
| SCHED-02 | Phase 18 — Discovery, Capacity & Placement | **Built, not wired** — placeWithOffers is reachable only through runResilient, which has no caller |
| SCHED-03 | Phase 18 — Discovery, Capacity & Placement | **Partial** — corrected 2026-08-01; this row claimed every offer is accepted while `serve-agent-hooks.node.test.ts` and four mutation-ledger entries (`M2a`, `M2b`, `B1`, `B2`) existed to prove the opposite. **The refusal half is wired and measured**: `capacity: admission` (`fabric-node.ts:1300`, `browser-node.ts:1009`) backed by `new LocalCapacity` (`fabric-node.ts:986`, `browser-node.ts:899`, both `bin/bench.ts` sites and both `perf-workload.ts` sites). An over-committed node refuses by name — `over-committed: N of M slots in use` — where the same factory measured before the line changed ran 64 simultaneous `executor.execute()` calls with zero refusals and 32 requestors timing out (`admission.node.test.ts`, 2026-07-29). **The requestor does not re-pick**: `placeWithOffers`, which resamples, is reachable only through `runResilient` and `planWithOffers`, and neither has a production caller. The browser factory's refusal is also unmeasured — nothing drives an over-committed refusal through a tab, so the number it would answer with has never been read; the `e2e` project could host that case |
| SCHED-04 | Phase 18 — Discovery, Capacity & Placement | **Partial** — GovernedExecutor is wired on the browser tier only; FabricNode composes a WorkerExecutor and no governor, and the duty cycle is readonly on both tiers, so "user-adjustable" is unmet |
| SCHED-05 | Phase 18 — Discovery, Capacity & Placement | **Built, not wired** — the sovereignty gate runs inside placeWithOffers, reachable only through runResilient |
| MR-01 | Phase 1 — Portable Kernel & Loopback Map Slice | Done |
| MR-02 | Phase 16 — Decomposable Tree-Reduce Wiring | **Built, not wired** — and unmeasured for a second reason. Phase 16 ran the aggregation over public shards whose inputs travel to the executors by CID, so no partial was computed over an owner's own data and nothing distinguished a map that moved data from one that did not. Needs a sovereign map with an egress manifest, not a wiring step |
| MR-03 | Phase 16 — Decomposable Tree-Reduce Wiring | **Partial** — wired at `bin/agent.ts` and `bin/bench.ts` via `reduceJob` (Phase 16). The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from `packages/browser/demo/main.ts`. That half is WIRE-02, Phase 22 |
| MR-04 | Phase 16 — Decomposable Tree-Reduce Wiring | **Partial** — wired at `bin/agent.ts` and `bin/bench.ts` via `reduceJob` (Phase 16). The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from `packages/browser/demo/main.ts`. That half is WIRE-02, Phase 22 |
| MR-05 | Phase 16 — Decomposable Tree-Reduce Wiring | **Partial** — wired at `bin/agent.ts` and `bin/bench.ts` via `reduceJob` (Phase 16). The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from `packages/browser/demo/main.ts`. That half is WIRE-02, Phase 22 |
| MR-06 | Phase 16 — Decomposable Tree-Reduce Wiring | **Partial** — wired at `bin/agent.ts` and `bin/bench.ts` via `reduceJob` (Phase 16). The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from `packages/browser/demo/main.ts`. That half is WIRE-02, Phase 22 |
| MR-07 | Phase 16 — Decomposable Tree-Reduce Wiring | **Partial** — wired at `bin/agent.ts` and `bin/bench.ts` via `reduceJob` (Phase 16). The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from `packages/browser/demo/main.ts`. That half is WIRE-02, Phase 22 |
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
| BENCH-06 | Phase 8 — Benchmark Harness | Partial — machine inventory is a required field and the same-machine label is derived from it, not declared; the N-independent-processes half lands in Phase 23 via BENCH-07. Distinct-machine benchmarking **descoped 2026-07-28 and unmeasured — not met** |
| DEMO-01 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| DEMO-02 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| DEMO-03 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| DEMO-04 | Phase 9 — Public Demo, Consent UX & Disclosure Gate | Done |
| AOT-01 | Phase 10 — elfconv AOT Native→WASM Pipeline | Done |
| AOT-02 | Phase 21 — AOT Translation Signing & Runtime | **Built, not wired** — translationCid is never called by the lift pipeline; the CLI emits no CID and builds no TranslationRecord |
| AOT-03 | Phase 10 — elfconv AOT Native→WASM Pipeline | Partial — the one-host half is established: repeated lifts in separate spawned toolchain processes are byte-identical. Cross-machine **descoped 2026-07-28 and unmeasured — not met**; `CROSS_MACHINE_BLIND_SPOT` stays on every artifact |
| AOT-04 | Phase 21 — AOT Translation Signing & Runtime | **Partial** — port conformance is proved through the @o2/aot barrel; no production node constructs a WasiExecutor, so a translated artifact dispatched to a running node fails at instantiate |
| AOT-05 | Phase 10 — elfconv AOT Native→WASM Pipeline | **Partial** — loadArtifact is exported and e2e-measured, but the demo loads its kernel from bundled base64 — the loader is not on the page’s own module path |
| WIRE-01 | Phase 11 — Explicit serveAgent Hook Contract | **Done** — all six hooks required as `T \| '<named-absence>'`; omitting one is a compile error naming the property. Verified 3/3 independently: the mutation produced `Unused '@ts-expect-error' directive`, and swapping `fabric-node`'s real `reservations` thunk for the sentinel broke both the count guard and `rendezvous-wire.node.test.ts` |
| WIRE-02 | Phase 22 — Reachability Guard | Not started — new requirement, minted 2026-07-27 |
| WIRE-03 | Phase 19 — Quorum Composition & Owner-Domain Attestation | Not started — new requirement, minted 2026-07-27 |
| WIRE-04 | Phase 20 — Single Job Path, Ledger & Churn Resilience | Not started — new requirement, minted 2026-07-27 |

**Coverage: 76/76 mapped. No orphans, no duplicates.** (72 v1 + 4 v1.1-only WIRE
requirements. Of the 72, 40 are in v1.1 scope for wiring — see
`.planning/ROADMAP.md`'s "v1.1 — Wire What Was Built" coverage table; the remaining 32
are `Done`, and NET-03/BENCH-06/AOT-03/AOT-05 stay open and are explicitly excluded from
v1.1 — NET-03 on a hosting decision, AOT-05 as a measured negative, and BENCH-06/AOT-03
with their cross-machine halves descoped to one host on 2026-07-28 and recorded as
unmeasured rather than as met.)
