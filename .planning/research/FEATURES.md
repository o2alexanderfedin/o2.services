# Feature Research

**Domain:** P2P distributed compute fabric / decentralized compute marketplace (compute-to-data, volunteer edge)
**Researched:** 2026-07-24
**Confidence:** MEDIUM-HIGH — product surfaces verified against live docs and repo state for Bacalhau, iExec, Ocean, Akash, Golem, wasmCloud, BOINC; browser platform constraints verified against Chromium/MDN/web.dev. Browser-volunteer-node UX expectations are the weakest area (LOW-MEDIUM) because no product currently ships one.

---

## 0. Ecosystem Reality Check (read before the tables)

Five findings reshape what "table stakes" means here. All are verified against current repo/doc state, not training data.

| Finding | Evidence | Implication for this project |
|---|---|---|
| **The coordinator-free WASM-peer model was abandoned by its own inventor.** Fluence archived `nox` (the peer), `aqua`, `aqua-lib`, `registry`, `trust-graph`, `spell`, `examples`, and `cli` during 2025 and now ships a **Terraform provider for renting VMs**. `aqua` archived 2024-09-18. | GitHub org listing, `archived: true` on all of the above; `terraform-provider-cloudless` is the freshest non-infra repo | Fluence is prior art for *choreography*, not a live competitor. Do **not** build an Aqua-class DSL. The market rewarded "rent me a VM," not "compose a task graph across peers." Our answer must be a narrow map/reduce API, not a general language. |
| **The browser-capable compute-over-IPFS product died of business model, not technology.** Fission wound down operations by end of May 2024; `ipvm-wg/homestar` last pushed 2024-09-26. Everywhere Computer is dead. IPVM survives only as a spec. | Fission "Farewell" post; GitHub `pushed_at` | The browser-node niche is *vacant, not disproven*. But the failure mode to avoid is "protocol research with no user." The demo must show a job a person cares about, not a protocol. |
| **Bacalhau — the flagship compute-over-data project — deprecated libp2p and the embedded IPFS node in v1.4 and moved to NATS**, where only orchestrators need public reachability and compute nodes dial one known orchestrator. wasmCloud's lattice is also NATS. | Bacalhau "Transition Alert: libp2p Deprecation Notice"; v1.3/v1.4 release posts; wasmCloud lattice docs | The two most successful WASM-mesh products both concluded a hub tier is unavoidable. This validates the project's existing "relay on the backbone" decision — but it also means **libp2p-purity is not a feature users value**. Budget for the relay/bootstrap tier as a first-class component, not an embarrassment. |
| **Bacalhau shipped deterministic-WASM result verification in Beta v1 and then removed it.** `pkg/` today contains `bidstrategy`, `compute`, `orchestrator`, `publisher`, `nats` — no `verifier`. All 14 verifier issues are closed, including "Enable deterministic verifier by default for WASM jobs." | GitHub contents API on `pkg/`; issue search | Verification is *not* table stakes for a compute-over-data product generally — Bacalhau succeeded without it. But it **is** table stakes for *this* project, because "returns a verified-correct result" is written into the Core Value. Treat this as a deliberate differentiation, and note the warning: the one team that tried it in this exact shape deleted it. Keep the verification tax visible and configurable or it will be deleted here too. |
| **Nobody exposes a reduce.** Bacalhau supports exactly **one task per job** and delegates DAGs to Apache Airflow via `bacalhau-airflow`. Its whole parallelism surface is `--count N` plus `BACALHAU_PARTITION_INDEX` / `BACALHAU_PARTITION_COUNT` env vars. | Bacalhau job spec docs; v1.7 "Partitioned Jobs" post | A working **tree-reduce is a genuine differentiator**, not a checkbox. It is also the smallest API that beats the incumbent. Our map API should be *exactly as simple as Bacalhau's* (count + index) and the reduce is the delta. |

**Economic reality for the browser tier:** one of the largest Coinhive users earned **$7.69 in three months**; coinhive.com became the second-most-blocked domain among 130M Malwarebytes users; the explicitly opt-in variant (AuthedMine) saw minimal adoption and Coinhive shut down in 2019. **A browser tab is not economically motivatable.** The only two motivations with evidence behind them are (a) BOINC-style solidarity — 82.9% of MalariaControl.net volunteers cited personal satisfaction versus 13.7% credit — and (b) *the user is processing their own data*, which is this project's sovereignty story. Design the browser node around (b), garnish with (a), never with money.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these and the demo is not credible.

#### A. Job submission & task graph

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Partitioned map: `count` + partition index injected into the task** | This is literally the entire industry-standard surface. Bacalhau: `--count 3` creates partitions 0..N-1, each gets `BACALHAU_PARTITION_INDEX`/`BACALHAU_PARTITION_COUNT` and decides what data it needs. Golem's `golem-sdk-task-executor` is the same shape. Users pattern-match to this instantly. | LOW | Do not invent. Copy the env-var contract verbatim so the mental model transfers. For sovereignty jobs the partition count is *derived* from owner count, not chosen — surface both modes. |
| **Declarative job spec (YAML/JSON) + imperative CLI, same schema** | Bacalhau, Akash (SDL), wasmCloud (wadm OAM manifests), Ocean (DDO) all do both. Anything less feels like a toy. | LOW-MEDIUM | One canonical TS type → YAML schema → CLI flags. Akash's SDL is deliberately docker-compose-shaped; familiarity beats elegance. |
| **Typed SDK in the host language (TS), not just CLI** | Golem ships `golem-js`; iExec ships `iexec` npm CLI+lib; Ocean ships `ocean.py`. A P2P system whose node agent is TypeScript with no TS SDK would be conspicuous. | LOW | Falls out of the node agent for free; the requestor is a node. |
| **Job identity + deterministic re-submission (same inputs → same job CID)** | Content addressing is the domain's core idiom; users expect resubmitting identical work to dedup/resume. | LOW | Already implied by content-addressed intermediates (§3.3 sol. 3). |
| **Explicit per-job resource + time limits** | Ocean's compute environments each carry a max job duration and the operator engine *stops* the algorithm pod when it's exceeded. Akash SDL declares CPU/mem/storage/GPU. Nobody accepts unbounded jobs on someone else's hardware. | LOW-MEDIUM | Doubles as the node-side safety control. Must be enforced in the WASM sandbox (fuel/epoch interruption), not by policy. |

#### B. Result verification

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Redundant execution with result comparison (N-version quorum)** | The Core Value says "verified-correct result." iExec's PoCo makes replication the entire product story. Bacalhau's original design used deterministic WASM specifically to unlock this. | MEDIUM | The genuine engineering is *determinism*, not comparison: seed the RNG, forbid wall-clock and nondeterministic float/host imports, canonicalize output bytes before hashing. Compare CIDs, never bytes over the wire. |
| **Commit-reveal so replicas can't copy each other** | iExec's PoCo runs contribute-then-reveal precisely because a lazy worker otherwise plagiarizes its neighbor's answer and collects. Redundant execution *without* commit-reveal is security theater and a reviewer will say so. | MEDIUM | Worker publishes `hash(result ‖ nonce)` first; reveals after the quorum window closes. Cheap to add, expensive to retrofit. Make this a v1 decision. |
| **Disagreement is surfaced, not silently majority-voted away** | Users need to know a node lied. Every replicated system that hides this loses trust. | LOW | Job result carries `agreement: 3/3` and the dissenting node IDs. |
| **A "no verification" setting that is one flag away** | Bacalhau deleted its verifier because the tax wasn't worth it for most jobs. iExec makes it explicit: `trust: 0` means no replication. If the tax is unavoidable, the feature gets removed. | LOW | Depends on the trust dial (see Differentiators). |

#### C. Data sovereignty / compute-to-data

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Code goes to data — placement follows the data's location, automatically** | Bacalhau's entire positioning; Ocean C2D's entire positioning ("sends the algorithm to the data"). Users expect to *not* specify a node. | MEDIUM | For sovereignty-pinned data, `GET_PROVIDERS(CID)` returns the owner's node and placement is degenerate — this is the easy half. |
| **Data owner approves specific code, by content hash, before it runs** | Ocean's `publisherTrustedAlgorithms` pins each allowed algorithm by `did` + `filesChecksum` + `containerSectionChecksum`; `publisherTrustedAlgorithmPublishers` allows by publisher. An empty array denies everything by default. This is the consent primitive of the whole category. | MEDIUM | Our version: a UCAN/SPKI capability signed by the owner's key, scoped to a code CID with an expiry. Strictly better than Ocean's on-chain list — delegatable and revocable-by-expiry. |
| **Deny-by-default posture, with the risky knobs labeled as risky** | Ocean's own docs say `allowRawAlgorithm: true` "increases risk of data escape," and `allowNetworkAccess` is a separate explicit toggle. Users expect the dangerous option to be labelled. | LOW | Default: no network from inside the sandbox, no arbitrary source, only signed code CIDs. |
| **Results leave; raw data provably doesn't** | The one claim the product is making. If a user can't check it, the claim is marketing. | MEDIUM-HIGH | Minimum credible artifact: a per-execution, owner-node-signed egress manifest listing every byte that left (output CID, size, destination peer). See Differentiators for the stronger version. |

#### D. Node operator experience

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **One-command join / one-URL join** | Golem: install the provider agent, then `golemsp settings set --cores/--memory/--disk`. Bacalhau: a compute node needs only one orchestrator address. Akash requires a k8s cluster and is widely considered the painful outlier. | LOW (browser) / MEDIUM (Node.js) | Browser tier's advantage is that this is *zero* commands. Do not squander it with a wallet, a signup, or a download. |
| **Hard resource caps: cores, memory, disk** | Universal. `golemsp settings set --cores <n> --memory <bytes> --disk <bytes>`; BOINC caps disk % and separate memory % for in-use vs idle. | MEDIUM | Browser: cap concurrent Workers (default ≤ `hardwareConcurrency − 1`), cap WASM memory pages, cap OPFS/IndexedDB bytes. Must be *enforced*, not advisory. |
| **Duty-cycle throttle, not just on/off** | BOINC's "use at most N% of CPU time" is implemented as a duty cycle — at 75% it computes 3s then waits 1s — explicitly to control temperature and energy. This is the single most-copied knob in volunteer computing and it exists because thermal/fan noise is what users actually feel. | LOW | Trivially implementable in a Worker loop: run a slice, `await` a gap. Do this from day one; it is the cheapest way to stop being a "heavy tab." |
| **Suspend-when-in-use / suspend-when-on-battery** | BOINC ships both: "suspend when computer is in use" gated on mouse/keyboard within N minutes, and "suspend when computer is on battery." | LOW-MEDIUM | **Constraint:** the Battery Status API is Chromium-only — Firefox removed it in 52 over fingerprinting, Safari never shipped it. Feature-detect; where absent, fall back to a user toggle plus `visibilityState` + a coarse throughput heuristic. Never advertise it as a guarantee (see Anti-Features). |
| **Instant, obvious opt-out that actually stops work** | The Coinhive lesson. Any perceived stickiness gets the origin blocklisted. | LOW | Kill switch must terminate Workers, not just stop scheduling. Verify by watching CPU drop to zero. |
| **Local visibility: what am I running right now, for whom** | BOINC Manager's task list is the model. Golem publishes network-wide stats at `stats.golem.network`. | LOW-MEDIUM | Per-task row: job label, requestor peer ID, elapsed, CPU share. This is also the consent artifact. |

#### E. Observability

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **`job describe` — which node ran which execution, and its state** | Bacalhau's `job describe <jobID>` returns per-execution detail in YAML and is how you even *find* execution IDs. This is the first thing anyone runs. | LOW-MEDIUM | Requires per-execution records with node ID, start/end, and outcome. |
| **`job history` — an ordered event log for the job** | Bacalhau ships `job history` as a distinct command. Distributed systems without an event log are undebuggable. | LOW | Append-only, content-addressed, replayable. Cheap now, impossible later. |
| **`job logs --follow` — stdout/stderr from a remote execution** | Bacalhau streams with `--follow`; Akash Console offers logs plus a container shell. Non-negotiable for developer adoption. | MEDIUM | **Scoping call:** stream from backbone/Node.js executions only in v1. Streaming from N browser tabs over relay is a bandwidth trap — see Anti-Features. |
| **Timing + placement breakdown per job** | "How long, where, why there" is the question every user asks about a system that chose the machine for them. | MEDIUM | Show: candidates sampled (power-of-d), chosen node, queue vs execute vs transfer time, verification overhead as a separate line. |
| **Coverage report for cross-owner jobs** | Directly required by the design doc §3.5: an offline owner is a contribution that *cannot* be recomputed elsewhere, so cross-owner queries are best-effort over live owners "with a coverage report." Without it, an aggregate is silently wrong. | MEDIUM | `covered: 87/92 owners, 94.6% by record count`. This is a correctness feature disguised as observability. |
| **Cost/effort accounting per job** | Every marketplace surfaces it (Akash bids, Golem GLM, iExec RLC). With payments out of scope, users still need node-seconds, bytes moved, verification multiplier. | LOW | Reuse as the benchmark harness's data source — one mechanism, two deliverables. |

#### F. Reliability

| Feature | Why Expected | Complexity | Notes |
|---|---|---|---|
| **Automatic reschedule on node departure** | Churn is the defining property of the domain. Browser research is blunt: visitors spend short periods on sites, navigate away, "task context is lost, resulting in high likelihood of incomplete tasks requiring rescheduling." | MEDIUM | Lease-based task ownership + re-dispatch on lease expiry (doc §3.6). Non-optional for the browser tier. |
| **Straggler mitigation (speculative/backup execution)** | Total latency = slowest node. With phones and laptops in the pool this dominates. | MEDIUM | Free-riding on the redundant-execution machinery: the 2nd replica *is* the backup copy. Design them as one feature. |
| **Partial-failure semantics that are explicit** | Users must know whether they got an exact answer, a best-effort answer, or an error. | LOW | Three terminal states, never two. |

---

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Sovereignty label as a hard, non-overridable scheduling constraint** | Bacalhau does compute-to-data as a *convention* (run where the data happens to be); Ocean does it via k8s pod isolation inside one operator's cluster. Nobody makes "unmovable" a first-class data attribute that the scheduler cannot relax to balance load. This is the project's stated novel delta and it is real. | MEDIUM-HIGH | Enforcement must be structural: the placement planner has no code path that relocates `unmovable` data. Add a test that asserts a sovereignty-pinned task cannot be scheduled off-owner even under artificial load pressure. That test *is* the differentiator. |
| **A verifiable "your data never left" artifact** | Turns the central claim from a promise into evidence. No competitor offers this — Ocean's assurance is "trust the operator's k8s"; Bacalhau's is "trust that we ran it there." | HIGH | Owner-node-signed egress manifest per execution + a sandbox with no ambient network capability, so the manifest is *complete* by construction rather than by audit. Depends on: deny-by-default sandbox, owner key, per-execution records. |
| **Per-job trust dial with a legible UX** | iExec proves demand for the concept — `trust` is a field in the request order, `trust: 10000` means 99.99% confidence, `trust: 0` means no replication. But that UX is atrocious. A dial reading `none / 2-of-2 / 2-of-3 / backbone-only` with a live "this will cost ~2.1× node-seconds and ~+40% latency" preview is a strictly better product. | MEDIUM | Depends on: redundant execution, cost accounting. Low code, high perceived value — good early-phase candidate. |
| **Decomposable tree-reduce with combiners (a real reduce)** | Bacalhau has no reduce; DAGs are outsourced to Airflow. Fluence built the general version (Aqua) and archived it. A *narrow* map/reduce with associative+commutative merge, no all-to-all shuffle, O(N log N) links, is the sweet spot everyone skipped over. | HIGH | Depends on: content-addressed intermediates, backbone aggregation tier, churn-resilient re-parenting when a tree node departs. Design doc flags tree-reduce-under-churn as one of three real research risks — plan for the aggregator to fail mid-reduce and be re-parented from checkpointed partials. |
| **Zero-install browser compute node** | Golem needs an installer, Akash needs Kubernetes, Bacalhau needs Docker, BOINC needs an app. "Open a tab" is a categorically different funnel. Homestar/Everywhere Computer aimed here and died before shipping it — the niche is vacant. | HIGH | Depends on: relay/bootstrap tier (browsers can only dial DNS+WSS), cross-origin isolation for threads, consent surface. This is the demo's entire wow factor; budget accordingly. |
| **AOT native→WASM: bring an existing binary, get a sandboxed job** | Golem runs VMs (heavy, arch-specific), Bacalhau runs Docker (arch-specific, no browser), iExec runs SGX enclaves (hardware-bound). "Hand me an AArch64 static binary, get something that runs in a phone's browser tab" is unique. | HIGH | Build-time pipeline, not a runtime component. Honest framing required: elfconv hits ~56–82% of source-compiled WASM, needs unstripped static AArch64, and can fail to lift indirect jumps. Ship it as "supported binaries" with a compatibility checker, not as a universal claim. |
| **Owner-side code approval via capability chain (not an on-chain allow-list)** | Ocean's `publisherTrustedAlgorithms` is a static array requiring a transaction to change. A UCAN/SPKI chain rooted at the owner's key is delegatable, expiry-scoped, and free to issue. | MEDIUM | Depends on: identity keys, code CID signing. Expiry replaces revocation — the design doc already picked this. |
| **Secure aggregation / DP over partials** | Falls out of the tree-reduce for near-free, and upgrades the pitch from "your raw data stays home" to "not even your per-owner partial is visible." No decentralized compute product ships this. | MEDIUM-HIGH | Defer past v1, but *do not design the reduce in a way that precludes it* — the aggregator must never need to inspect a partial's contents to merge it. |
| **Node contribution panel: what ran, for whom, veto by category** | Nothing in this space shows the operator what code actually executed. BOINC shows tasks-by-project; that's the ceiling today. Given the Coinhive history, radical transparency is the trust unlock. | MEDIUM | Depends on: per-execution records, code CID labels. Also the single best defense against being blocklisted. |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Payments / token / staking / marketplace** | Every comparator has one (GLM, RLC, AKT, OCEAN); it looks like the obvious monetization. | Already Out of Scope in PROJECT.md, and the numbers justify it: a top Coinhive user made **$7.69 in three months**. A market layer prices capacity that hasn't been proven to exist, and it drags in KYC, wallets, and tax questions that murder the zero-install funnel. | Meter everything (node-seconds, bytes, verification multiplier) and settle nothing. Metering is the benchmark harness anyway. |
| **Silent or implied-consent browser compute** | "Users won't opt in; just run it and disclose in the ToS." | Coinhive became the 2nd-most-blocked domain across 130M Malwarebytes users; Salon's opt-in-but-mines-while-you-read-the-explainer flow was pilloried; Coinhive folded in 2019. The blocklist entry is permanent and origin-level — it would kill the demo domain forever. | Explicit pre-execution consent, visible always-on indicator, one-click stop that provably halts CPU, and a default of zero work until clicked. |
| **A general DAG / workflow language** | "Map/reduce is limiting; let users express any graph." | Fluence built exactly this (Aqua → AIR → AquaVM), then archived `aqua`, `aqua-lib`, `registry`, and `nox` and pivoted to selling VMs. Bacalhau declined to build it and points at Airflow. Two independent teams concluded the DSL isn't where the value is. | Map + decomposable reduce only. If someone needs a DAG, they chain jobs by CID from the outside — the same escape hatch `bacalhau-airflow` provides. |
| **Kernel-fidelity emulation (container2wasm / QEMU-Wasm)** | "Just run any container in the browser." | ~10x+ off native, and per the design doc's own caching analysis the runtime-JIT modules aren't content-addressable, so the artifact cache doesn't help. Already Out of Scope. | AOT-to-WASM for binaries; source→wasm32-wasi when source exists. |
| **Key-partitioned all-to-all shuffle** | Exact sort / exact join / exact median. | It is the thing that kills P2P map/reduce, and it violates sovereignty by construction — key-partitioning moves one owner's rows onto another owner's node. Already Out of Scope. | Mergeable sketches: HyperLogLog for distinct-count, t-digest/KLL for quantiles, Count-Min for heavy hitters. Tree-reducible on tiny partials. |
| **Leaderboards / points / gamification as the primary motivator** | BOINC's leaderboards demonstrably drove some volunteers to buy multi-GPU machines. | The same research puts solidarity at 82.9% and credit at 13.7%, and BOINC's credit system has a long history of cheating and cross-project normalization fights. Points invite result-forging, which directly attacks the verification layer. Also: BOINC's volunteer population has been flat near 500k for years and SETI@home decayed from its ~1M peak — gamification did not save it. | Motivate with *purpose* and *self-interest*: "this is your own data being processed" plus a plain contribution counter. No competitive ranking in v1. |
| **Reputation scoring before verification works** | Feels cheap and reduces the redundancy tax. | Reputation is derived from verified outcomes. Built first, it is a self-referential score that a sybil farm can inflate. Already Out of Scope. | Ship verification; reputation becomes a trivial aggregation over its output later. |
| **Pure-libp2p, no hub tier** | Ideological purity; "no central component." | Bacalhau deprecated libp2p *and* the embedded IPFS node in v1.4 for NATS, so only orchestrators need public reachability; wasmCloud's lattice is NATS too. Meanwhile js-libp2p browser-to-browser WebRTC *requires* a Circuit Relay v2 for SDP signaling, browsers can only dial DNS+WSS, `webrtc-direct` isn't in js-libp2p, and WebTransport is absent in Safari. A hub-free browser mesh is not currently buildable. | Own the compromise: a small, replaceable, publicly-reachable relay/bootstrap tier, with DHT-discovered public IPFS relays as the primary path. Document it as architecture, not as a bug. |
| **Arbitrary user-supplied source code against sovereign data** | "Let people paste a script — great for demos." | Ocean's own docs flag `allowRawAlgorithm: true` as increasing "risk of data escape." Against sovereignty-pinned data it is the whole threat model in one checkbox. | Signed code CIDs only, approved by the owner's capability. Provide a curated algorithm gallery for the demo instead of a paste box. |
| **"Battery-aware auto-throttling" as a headline guarantee** | It's the obvious courteous behavior and BOINC has it. | The Battery Status API is Chromium-only — Firefox removed it in 52 as a fingerprinting vector, Safari never implemented it and WebKit has moved to delete the code. Promising it means silently failing on Safari and Firefox. | Ship the duty-cycle throttle (universal), a manual "pause on battery" toggle, and battery *detection* only where `navigator.getBattery` exists, labelled best-effort. |
| **Live log streaming from browser edge nodes** | Bacalhau has `job logs --follow`, so parity is expected. | Streaming stdout from N tabs through a bandwidth-limited Circuit Relay v2 (reservations capped near an hour by design) inverts the data-flow ratio the whole architecture depends on: partials are supposed to be small. | Logs stream from backbone/Node.js executions. Browser executions return a bounded, truncated log blob with the result CID. |
| **Multiple tasks per job in v1** | It looks like a small generalization of the job spec. | Bacalhau still supports only one task per job after years, and their spec says so explicitly. It's a schema-versioning trap: adding it later is easy, removing it is not. | One task per job. Reduce is a distinct job stage the runtime owns, not a user-authored second task. |
| **TEE / confidential-computing tier** | It is the strong answer to "the node owner can see the data." | Out of Scope, and correctly: it needs datacenter hardware and is unreachable from the browser tier. Note that iExec's current PoCo docs have gone all-in on TEE — "No replication is needed, trust comes from hardware attestation" — which is a *different product* aimed at a different customer. | Sovereignty-by-placement removes data confidentiality as a problem *for the data owner*, which is the case this project actually serves. Redundant execution covers integrity. |

---

## Feature Dependencies

```
[Node agent: browser + Node.js + embedded]
    └──requires──> [Relay / bootstrap tier (DNS+WSS reachable)]
                        └──enables──> [libp2p peer discovery + NAT traversal]

[Deterministic WASM sandbox]
    ├──requires──> [Resource + time limits (fuel/epoch interruption)]
    ├──requires──> [Deny-by-default capabilities: no net, no clock, seeded RNG]
    └──enables──> [Redundant execution + result comparison]
                        ├──requires──> [Commit-reveal]
                        ├──enables──> [Per-job trust dial]
                        ├──enables──> [Straggler / speculative execution]
                        └──enables──> [Reputation (deferred)]

[Content-addressed data + pinning]
    ├──enables──> [Sovereignty label as hard constraint]
    │                   ├──requires──> [Owner capability chain (UCAN/SPKI)]
    │                   └──enables──> ["data never left" egress manifest]
    └──enables──> [Content-addressed intermediates]
                        ├──enables──> [Churn resume / reschedule]
                        └──enables──> [Tree-reduce checkpointing]

[Partitioned map (count + partition index)]
    └──enables──> [Decomposable tree-reduce with combiners]
                        ├──requires──> [Backbone aggregation tier]
                        ├──requires──> [Aggregator re-parenting under churn]
                        ├──enables──> [Secure aggregation / DP  (deferred)]
                        └──enables──> [Coverage report]

[Per-execution records (node, timing, outcome)]
    ├──enables──> [job describe / job history]
    ├──enables──> [Cost & effort accounting] ──feeds──> [Benchmark harness]
    ├──enables──> [Trust-dial cost preview]
    └──enables──> [Node contribution panel]

[Browser consent surface]
    ├──requires──> [Duty-cycle throttle]
    ├──requires──> [Instant kill switch]
    └──enables──> [Node contribution panel]

[WASM threads / SharedArrayBuffer]
    └──requires──> [Cross-origin isolation: COOP same-origin + COEP require-corp]
                        └──on GitHub Pages requires──> [coi-serviceworker]

[Redundant execution] ──conflicts──> [Sovereignty-pinned single-owner data]
[Leaderboards / points] ──conflicts──> [Result verification]
[Live browser log streaming] ──conflicts──> [Relay bandwidth budget]
```

### Dependency Notes

- **Redundant execution conflicts with sovereignty-pinned data.** This is the sharpest unresolved design tension in the project and it is not in the design doc. If user A's data lives only on A's node, the *only* place a map over it can run is A's node — so there is no second, independent node to replicate against. N-version verification and sovereignty-by-placement are structurally at odds for single-replica data. Three resolutions, none free: (a) run the replica on the same owner's *other* devices/authorized encrypted replicas — the doc's own skew fix, and the cleanest; (b) verify the *reduce*, not the map, since partials do move and the aggregation tree is replicable; (c) accept that sovereign maps are trusted-by-the-owner (the owner has no incentive to corrupt their own contribution — but they do have an incentive to bias a cross-owner aggregate). **Decide this before building either feature**; it changes the shape of both. Public/shared data has no such conflict and is where redundant execution should be demonstrated.
- **Commit-reveal must land with redundant execution, not after.** Adding it later changes the wire protocol and the execution record schema. iExec's PoCo has it for a reason: without it, replica #2 copies replica #1 and quorum means nothing.
- **Tree-reduce requires content-addressed intermediates.** Aggregator churn is one of the three named research risks; recovery is only possible if a departed aggregator's partials are re-fetchable by CID from its children.
- **The trust dial requires cost accounting to be useful.** A dial with no visible price is a dial nobody turns. This is why Bacalhau's verifier died — the tax was invisible and unbounded.
- **Cross-origin isolation gates WASM threads on the demo host.** GitHub Pages cannot set COOP/COEP response headers. `coi-serviceworker` emulates them via a service worker, but it *reloads the page on first visit* — which lands directly on the consent flow. Sequence: consent → SW registration → reload → node start, or the user sees an unexplained reload before they've agreed to anything.
- **Duty-cycle throttle gates everything else in the browser.** Users detect fan noise and heat long before they read a dashboard; macOS surfaces energy-hog apps in the battery menu. A tab that spins fans gets closed regardless of how good the consent copy is.
- **Coverage report is a dependency of correctness, not of UX.** A cross-owner aggregate computed over an unknown subset of live owners is a wrong number presented as a right one.

---

## Browser Volunteer Node: Constraints & UX Expectations

Consolidated because it is the riskiest surface and no competitor has shipped one.

### Platform constraints (HIGH confidence — verified against Chromium/MDN/web.dev)

| Constraint | Detail | Design response |
|---|---|---|
| **Background-tab timer throttling** | Chrome's intensive wake-up throttling limits DOM timers to once per minute once a page has been hidden ~5 minutes (chain count ≥5, silent ≥30s, WebRTC not in use). A "quick intensive throttling" variant cuts the grace period to ~10 seconds. | Never drive the work loop from `setTimeout` on the main thread. Compute in Workers; use the main thread only for UI. |
| **Page Lifecycle: frozen / discarded** | Pages move through active → passive → hidden → frozen → discarded. Laptops on battery are throttled and discarded more aggressively than plugged-in desktops. Discard destroys the tab's state entirely. | Lease-based task ownership with short leases; checkpoint partials to OPFS/IndexedDB by CID; assume any tab can vanish between two ticks. Handle `freeze`/`resume` events explicitly. |
| **Short dwell time** | Browser-volunteer research states plainly that visitors spend short periods on sites and when they navigate away, task context is lost, producing a high rate of incomplete tasks needing rescheduling. | Task granularity must be **seconds, not minutes**. Size partitions so a median dwell completes several. Re-dispatch must be automatic and invisible. |
| **Threads need cross-origin isolation** | `SharedArrayBuffer` and WASM threads require `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages sets no headers; `coi-serviceworker` emulates them but forces a first-visit reload. | Design for the single-threaded path to work, with threads as an upgrade. Sequence consent before the SW reload. |
| **Battery detection is not portable** | `navigator.getBattery()` is Chromium-only; Firefox removed it in 52 over fingerprinting; Safari never shipped it and WebKit is removing the code. | Manual toggle is the contract; API detection is a bonus. Do not put "pauses on battery" in the headline. |
| **Connectivity is relay-gated** | Browser-to-browser WebRTC in js-libp2p needs a Circuit Relay v2 for the SDP handshake; browsers dial only DNS+WSS multiaddrs; `webrtc-direct` is not available in js-libp2p; WebTransport is unsupported in Safari. Relay v2 reservations are time- and bandwidth-capped by design. | Treat the relay as infrastructure. Budget reconnection. Keep per-tab bandwidth tiny — which the tree-reduce already implies. |
| **V8 code caching has strict preconditions** | Caching fires only for `compileStreaming`/`instantiateStreaming`, keys on the resource URL, requires `Content-Type: application/wasm`, and only for modules ≳128 kB. Pulling bytes via Helia `fs.cat` + non-streaming `WebAssembly.compile` forfeits it. | Fetch WASM through an IPFS **HTTP gateway URL** with `instantiateStreaming`. Compile the `Module` once per session and share it across Workers. |

### User-facing expectations (MEDIUM confidence — inferred from BOINC's shipped controls and the Coinhive backlash)

**What makes users accept it:**
- Consent *before* any CPU is consumed, in plain language, stating what runs and why. Salon's flow — which began mining when you clicked "learn more" — is the negative example.
- A persistent, visible indicator that work is happening, with live CPU share.
- A one-click stop that demonstrably drops CPU to zero.
- A reason that isn't money. Either "this is processing *your* data on *your* device" (the sovereignty case, unique to this project) or a named cause (the BOINC case: 82.9% cited personal satisfaction).
- Resource controls that mirror BOINC's vocabulary because it's the vocabulary volunteers already know: % of CPU, pause when I'm using the machine, pause on battery, disk cap.

**What makes users close the tab (in order of likelihood):**
1. **Fan noise and heat.** Felt within ~30 seconds; no UI compensates. Duty-cycle throttling is the only real fix, and the default should be conservative (≤50% of one core below `hardwareConcurrency`).
2. **UI jank.** Any main-thread work at all. All compute in Workers, always.
3. **Battery drain on a laptop.** Compounded by Chrome throttling/discarding battery-powered tabs more aggressively, which will *also* silently degrade contribution.
4. **Surprise.** Discovering it after the fact converts a user into an adversary and an origin into a blocklist entry.
5. **Perceived pointlessness.** No visible output, no counter, no story.

**Default posture:** off until clicked; one Worker; conservative duty cycle; hard memory cap; no network egress from the sandbox; stop on tab hide (opt-in to continue in background, which is the honest framing given throttling would degrade it anyway).

---

## MVP Definition

### Launch With (v1)

Tracks the design doc's §6 sequencing, which deliberately front-loads the capacity-scaling and sovereignty thesis.

- [ ] **Node agent, one build, three hosts (browser / Node.js / embedded)** — portability *is* the product; nothing else is testable without it.
- [ ] **Relay + bootstrap tier** — hard prerequisite for any browser participation; Bacalhau and wasmCloud both concluded a hub tier is unavoidable.
- [ ] **Deterministic WASM sandbox with fuel/time/memory limits and no ambient network** — prerequisite for both verification and the sovereignty claim.
- [ ] **Content-addressed data with owner pinning** — the substrate for sovereignty, dedup, and resume.
- [ ] **Partitioned map: `count` + partition index, Bacalhau-compatible env-var contract** — the entire competitive API surface, at LOW cost.
- [ ] **Sovereignty-by-placement: `unmovable` label the scheduler structurally cannot relax** — the differentiator; assert it with a test that tries to break it.
- [ ] **Owner capability chain (UCAN/SPKI) gating code CIDs** — Ocean's `publisherTrustedAlgorithms`, done better.
- [ ] **Redundant execution + commit-reveal + CID comparison, on public/shared data** — the Core Value's "verified-correct." Sidesteps the sovereignty/replication conflict for v1.
- [ ] **Lease-based dispatch with automatic reschedule on departure** — churn is the domain, not an edge case.
- [ ] **`job describe` / `job history` / per-execution records** — otherwise the system is undebuggable and the demo is unexplainable.
- [ ] **Browser consent surface + duty-cycle throttle + kill switch + contribution panel** — the Coinhive lesson is non-negotiable and cheap to honor.
- [ ] **Node-seconds / bytes / verification-multiplier accounting** — one mechanism serving observability *and* the benchmark harness.

### Add After Validation (v1.x)

- [ ] **Decomposable tree-reduce with combiners** — trigger: map fan-out demonstrably scales, and a workload exists whose partials are worth merging. This is the biggest differentiator and also the highest-risk item; it deserves its own phase after map is proven.
- [ ] **Coverage report for cross-owner jobs** — trigger: the first genuinely cross-owner aggregate.
- [ ] **Per-job trust dial with cost preview** — trigger: verification is working and someone asks what it costs.
- [ ] **"Data never left" egress manifest, owner-signed** — trigger: the first external skeptic. Do it before any public claim.
- [ ] **Speculative / backup execution for stragglers** — trigger: p99 latency is set by one slow node; reuses the redundancy machinery.
- [ ] **Mergeable sketches (HLL / t-digest / Count-Min)** — trigger: someone asks for distinct-count or median. Cheap once the reduce exists, and it's the designated alternative to the banned shuffle.
- [ ] **AOT native→WASM (elfconv) with a compatibility checker** — trigger: a real binary someone wants to run. Deliberately sequenced last per PROJECT.md; it is a build-time pipeline, not a runtime component.
- [ ] **WASM threads via cross-origin isolation** — trigger: single-threaded throughput becomes the bottleneck rather than churn.

### Future Consideration (v2+)

- [ ] **Secure aggregation / differential privacy over partials** — defer, but keep the reduce content-opaque so it stays possible.
- [ ] **Reputation weighting** — defer; it is an aggregation over verification outcomes and is meaningless before those exist.
- [ ] **Delegated tree-coordination for single huge jobs** — defer until one job's coordination load actually bottlenecks its requestor.
- [ ] **TEE backbone tier** — Out of Scope this milestone; the entry point for enterprise later.
- [ ] **Incentives / metering settlement** — Out of Scope; capacity must be proven first, and browser-tab economics ($7.69 / 3 months) say the edge will never pay for itself.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Node agent across browser/Node/embedded | HIGH | HIGH | P1 |
| Relay + bootstrap tier | MEDIUM (invisible, enabling) | MEDIUM | P1 |
| Deterministic WASM sandbox + limits | HIGH | MEDIUM | P1 |
| Content-addressed data + owner pinning | HIGH | MEDIUM | P1 |
| Partitioned map (count + index) | HIGH | LOW | P1 |
| Sovereignty label as hard constraint | HIGH | MEDIUM | P1 |
| Owner capability chain over code CIDs | HIGH | MEDIUM | P1 |
| Redundant execution + commit-reveal | HIGH | MEDIUM | P1 |
| Lease-based reschedule on churn | HIGH | MEDIUM | P1 |
| `job describe` / `history` / execution records | HIGH | LOW-MEDIUM | P1 |
| Browser consent + duty cycle + kill switch | HIGH | LOW-MEDIUM | P1 |
| Node-seconds / bytes accounting | MEDIUM | LOW | P1 |
| Decomposable tree-reduce | HIGH | HIGH | P2 |
| Coverage report | HIGH | MEDIUM | P2 |
| Trust dial + cost preview | MEDIUM | LOW-MEDIUM | P2 |
| Egress manifest ("data never left") | HIGH | HIGH | P2 |
| Speculative execution | MEDIUM | MEDIUM | P2 |
| `job logs --follow` (backbone only) | MEDIUM | MEDIUM | P2 |
| Mergeable sketches | MEDIUM | MEDIUM | P2 |
| AOT native→WASM (elfconv) | HIGH (story) / LOW (v1 usage) | HIGH | P2 |
| WASM threads + cross-origin isolation | MEDIUM | MEDIUM | P3 |
| Secure aggregation / DP | HIGH (later) | HIGH | P3 |
| Reputation weighting | LOW | MEDIUM | P3 |
| Payments / market | LOW (this milestone) | HIGH | Anti |
| General DAG language | LOW | HIGH | Anti |
| Leaderboards / points | LOW | LOW | Anti |

---

## Competitor Feature Analysis

| Feature | Bacalhau | iExec | Ocean C2D | Golem | Akash | BOINC | Fluence (archived) | **Our Approach** |
|---|---|---|---|---|---|---|---|---|
| **Job API shape** | YAML + CLI; **1 task/job**; `--count N` partitions | On-chain order matching (app/dataset/workerpool/request orders) | Pick dataset + algorithm pair in a dApp | `golem-js` / task-executor SDK | SDL (docker-compose-like) | Project-defined work units | Aqua DSL → AIR → AquaVM | Bacalhau-shaped map (`count` + index) **plus a real reduce** |
| **Task graph / DAG** | None; delegated to Airflow (`bacalhau-airflow`) | None | None | None | N/A (services) | None | Full choreography — **archived 2024** | Map + decomposable tree-reduce only; no DSL |
| **Result verification** | Built deterministic-WASM verifier, then **removed it** (no `verifier` pkg today) | PoCo: replication + commit-reveal + stake; `trust` int in the order (`10000` = 99.99%); TEE mode needs **no replication** | Operator-run k8s; trust the operator | None | None (SLA/audited providers) | Redundant execution + validators | N/A | Redundant execution + commit-reveal, with a legible dial and a visible cost |
| **Trust dial** | No | Yes — but `trust: 10000` is an opaque integer | No | No | `signedBy` restricts to audited providers | No | No | Named tiers + live cost/latency preview |
| **Compute-to-data** | Convention: run where data is | Via DataProtector / TEE | First-class: `publisherTrustedAlgorithms` pinned by `filesChecksum` + `containerSectionChecksum`; `allowRawAlgorithm` flagged as data-escape risk; `allowNetworkAccess` toggle | No | No | No | No | Sovereignty as a **hard scheduling constraint** + owner-signed egress manifest |
| **Transport** | **NATS** (dropped libp2p + embedded IPFS in v1.4) | Ethereum + off-chain workers | Centralized provider + k8s | `ya-relay` + own protocol | Cosmos chain + k8s providers | HTTP polling to project servers | libp2p (**archived**) | libp2p + DHT-discovered public relays, backbone relay fallback |
| **Node onboarding** | Point compute node at one orchestrator | Join a worker pool | N/A (operator-run) | Install agent; `golemsp settings set --cores/--memory/--disk` | Run a Kubernetes cluster | Install BOINC Manager, attach project | Run `nox` | **Open a tab** (browser) / one command (Node.js) |
| **Operator resource controls** | Node config | Pool-managed | N/A | cores / memory / disk | k8s quotas | % CPU as a duty cycle, suspend-on-battery, suspend-when-in-use, disk %, separate in-use/idle memory caps | Config | BOINC's vocabulary, browser-native, with duty cycle as the default knob |
| **Observability** | `job describe` / `job history` / `job logs --follow`; OpenTelemetry traces+metrics | On-chain task state; debug docs | Job results + logs + admin logs to an output volume | `stats.golem.network` | Console: logs, shell, resource usage | BOINC Manager task list; project stats | — | describe/history/execution records + **placement rationale, verification cost, coverage report** |
| **Browser node** | No | No | No | No | No | No | No (browser *client* only) | **Yes — the differentiator** |
| **Payments** | No | RLC + staking | OCEAN datatokens | GLM on Polygon | AKT bids/leases | Credits + leaderboards | FLT | **None** (metering only) |

---

## Sources

**Bacalhau** (HIGH — current docs + live repo state)
- https://github.com/bacalhau-project/bacalhau — `pkg/` listing shows no `verifier` package; issue search returns 14 closed verifier issues
- https://bacalhau.org/docs/overview/key-concepts — orchestrator/compute split, NATS backbone
- https://bacalhau.org/docs/specifications/job — job types, `Count` = replicas, one task per job
- https://blog.bacalhau.org/p/transition-alert-libp2p-deprecation — libp2p deprecation
- https://blog.bacalhau.org/p/introducing-bacalhau-13 and /p/announcing-bacalhau-140-enhanced — NATS migration, embedded IPFS node removed in 1.4
- https://blog.bacalhau.org/p/bacalhau-v170-day-2-scaling-your — partitioned jobs, `BACALHAU_PARTITION_INDEX`/`_COUNT`
- https://blog.ipfs.tech/2022-12-13-bacalhau-beta-v1/ — the original deterministic-WASM verification design
- https://blog.bacalhau.org/p/bacalhau-pipelines-with-apache-airflow and https://pypi.org/project/bacalhau-airflow — DAGs outsourced

**iExec** (MEDIUM-HIGH — protocol docs are mid-migration; the `trust` semantics were corroborated across two sources)
- https://docs.iex.ec/protocol/proof-of-contribution — current TEE-first framing, "no replication needed"
- https://docs.iex.ec/key-concepts/proof-of-contribution — replication for result consolidation, requester-set confidence level
- https://www.iex.ec/academy/poco-documentation — PoCo background
- `trust` as a Uint256 in the requestorder, `10000` → 99.99%, `0` → no replication — corroborated via SDK docs and PoCo docs

**Ocean Protocol C2D** (HIGH — official docs)
- https://docs.oceanprotocol.com/developers/compute-to-data/compute-options — `allowRawAlgorithm` ("increases risk of data escape"), `allowNetworkAccess`, `publisherTrustedAlgorithms` with `did`/`filesChecksum`/`containerSectionChecksum`, `publisherTrustedAlgorithmPublishers`, `consumerParameters`
- https://docs.oceanprotocol.com/developers/compute-to-data/compute-workflow — operator engine, pod lifecycle, time limits, results/logs to output volume

**Fluence** (HIGH — repo archive state is unambiguous)
- https://github.com/fluencelabs — `aqua` archived 2024-09-18; `nox`, `aqua-lib`, `registry`, `trust-graph`, `spell`, `examples`, `cli` archived through 2025; `terraform-provider-cloudless` is the current direction
- https://www.fluence.network/ — current VM-marketplace positioning

**IPVM / Homestar / Fission** (HIGH)
- https://fission.codes/blog/farewell-from-fission/ — wind-down by end of May 2024, Everywhere Computer unable to raise
- https://github.com/ipvm-wg/homestar — last push 2024-09-26

**Golem** (MEDIUM-HIGH)
- https://docs.golem.network/docs/providers/provider-installation — provider agent install
- https://docs.golem.network/docs/providers/provider-faq — `golemsp settings set --cores/--memory/--disk`
- https://docs.golem.network/docs/golem/payments — GLM on Polygon
- https://github.com/golemfactory — `golem-js`, `golem-sdk-task-executor`, `task-api` all active

**Akash** (MEDIUM-HIGH)
- https://akash.network/docs/learn/core-concepts/providers-leases/ — SDL, bid/lease, `signedBy` audited providers, console logs/shell

**wasmCloud** (MEDIUM-HIGH)
- https://wasmcloud.com/docs/v1/concepts/ and /reference/glossary/ — NATS lattice, components, runtime links, wadm OAM manifests

**BOINC & volunteer-computing motivation** (HIGH for preferences, MEDIUM for motivation research)
- https://boinc.berkeley.edu/wiki/Preferences and https://github.com/BOINC/boinc/wiki/Preferences — % CPU as duty cycle (75% = 3s on / 1s off), suspend on battery, suspend when in use, disk %, in-use vs idle memory caps
- https://boinc.berkeley.edu/boinc_a_platform_for_volunteer_computing.pdf and https://arxiv.org/pdf/1903.01699 — leaderboards, teams, population plateau near 500k, SETI@home peak ~1M then decline
- https://firstmonday.org/ojs/index.php/fm/article/download/2783/2452 — MalariaControl.net: 82.9% personal satisfaction, 13.7% credit, 6.7% learning
- https://cacm.acm.org/news/92931-what-motivates-volunteer-computing-contributors-it-depends/fulltext

**Browser cryptomining backlash** (HIGH)
- https://www.malwarebytes.com/blog/news/2017/11/persistent-drive-by-cryptomining-coming-to-a-browser-near-you — coinhive.com as 2nd-most-blocked domain, 130M users
- https://www.vice.com/en/article/coinhive-monero-mining-cryptojacking-research/ — "one of the biggest" users earned $7.69 in 3 months
- https://cyberscoop.com/salon-monero-coinhive-ad-blocker/ and https://techcrunch.com/2018/02/13/salon-coinhive-cryptocurrency-mining/ — Salon's opt-in flow and its criticism
- https://www.theregister.com/2017/10/19/malwarebytes_blocking_coin_hive_browser_cryptocurrency_miner_after_user_revolt/ — AuthedMine opt-in variant

**Browser platform constraints** (HIGH — vendor sources)
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88 — intensive wake-up throttling: 1/min after 5 min hidden, chain ≥5, silent ≥30s, no WebRTC
- https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE — quick intensive throttling, 10s grace
- Page Lifecycle states (active/passive/hidden/frozen/discarded); battery-powered devices throttled and discarded more aggressively
- https://developer.mozilla.org/en-US/docs/Web/API/Battery_Status_API and https://caniuse.com/battery-status — Chromium-only; Firefox removed in 52; Safari never shipped, WebKit removing
- https://web.dev/articles/coop-coep and https://web.dev/articles/cross-origin-isolation-guide — COOP/COEP required for SharedArrayBuffer
- https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers/ and https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/ — coi-serviceworker on GitHub Pages, first-visit reload
- https://libp2p.io/docs/webrtc-browser-connectivity/ and https://docs.libp2p.io/concepts/transports/webrtc/ — Circuit Relay v2 for SDP, no `webrtc-direct` in js-libp2p, WebTransport unsupported in Safari

**Browser volunteer computing research** (MEDIUM)
- https://www.sciencedirect.com/science/article/pii/S1877050917306348 — Web Workers volunteer platform
- https://arxiv.org/pdf/2212.13981 — short dwell times, lost task context, high reschedule rate
- https://arxiv.org/pdf/1804.01482 — personal volunteer computing

---

## Gaps & Open Questions

1. **Sovereignty vs. redundant execution (highest priority).** Single-replica sovereign data has no second independent node to verify against. Not addressed in the design doc. Must be decided before either feature is built — see Dependency Notes.
2. **Why Bacalhau deleted its verifier.** The commit/PR rationale wasn't recoverable from public docs (issues are closed without a stated verdict). Worth a direct look at the removal commit before committing to the same design; they hit something.
3. **Real browser dwell-time distribution for a compute demo.** All figures here are from general web analytics research, not from a compute-node context where a user has explicitly opted in — which plausibly produces much longer sessions. Instrument this in the demo; it determines optimal partition size.
4. **Relay bandwidth economics at demo scale.** Circuit Relay v2 reservations are time- and bandwidth-capped by design. Unknown how many concurrent browser nodes one relay sustains under real partial-result traffic. Needs measurement, not research.
5. **Whether `trust`-style verification has any user demand at all.** iExec has moved its messaging to TEE-only ("no replication needed"), and Bacalhau removed replication verification entirely. Both signals point the same way. The project's Core Value asserts verification matters — that assertion is currently unvalidated by market behavior and should be treated as a hypothesis to test with the demo, not a settled requirement.

---
*Feature research for: P2P distributed compute fabric with browser-tier volunteer nodes*
*Researched: 2026-07-24*
