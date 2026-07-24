# Project Research Summary

**Project:** o2.services — P2P Native Cloud
**Domain:** P2P distributed compute fabric (TypeScript + WASM node agent; browser + Node.js + embedded), compute-to-data, redundant-execution verification
**Researched:** 2026-07-24
**Confidence:** MEDIUM-HIGH overall — HIGH on platform mechanics and version facts (read from source), MEDIUM on the novel composition (sovereignty-constrained placement, tree-reduce under churn), MEDIUM-LOW on whether the verification thesis has market demand.

---

## Executive Summary

This is a **compute-to-data fabric with a browser-tier edge**, and the research converges on one shape: a pure TypeScript kernel (hexagonal, zero platform imports) driven by swappable adapters, executing content-addressed WASM tasks in Web Workers, connected by js-libp2p 3.x over a **backbone-anchored** relay tier. Every mature comparator that survived — Bacalhau, wasmCloud — independently concluded a hub tier is unavoidable, so the relay/backbone is a first-class component, not an embarrassment. The two prior projects that tried the pure-P2P-WASM-peer model are gone: **Fluence archived `nox`, `aqua`, `registry` and now sells VMs via Terraform; Fission wound down and `homestar` last shipped 2024-09**. The niche is vacant, not disproven — but the failure mode to avoid is protocol research with no user.

**The load-bearing risk is determinism, and it is worse than PROJECT.md assumed.** Three of the four research tracks independently landed on the same wall: V8 exposes **no NaN-canonicalization and no relaxed-SIMD control** (verified by enumerating `node --v8-options`; Wasmtime has both). The concrete divergence is architectural — per [WebAssembly/design#477](https://github.com/WebAssembly/design/issues/477), **x86 sets a freshly-generated NaN's sign bit to 1 and ARM sets it to 0**, so `0.0/0.0` yields `0xFFC00000` on an Intel laptop and `0x7FC00000` on an M-series Mac. Two *honest* nodes produce different output hashes, the quorum splits 50/50, and the verification layer cannot tell which side lied. This directly threatens the Core Value's "returns a verified-correct result." It is also compounded by a second finding: an eclipsed DHT lookup can place **all N replicas on attacker-controlled nodes**, at which point the quorum returns unanimous agreement on a forged result — the integrity mechanism doesn't degrade, it *inverts*. Determinism must therefore move from the engine to the **artifact** (publish-time validation + signed determinism certificate) and to the **comparison function** (canonical-form hashing, never raw linear memory), and quorum membership must be independently sourced with at least one backbone-anchored replica.

**The recommended approach:** build vertically, smallest working system first, and **gate the whole roadmap on an empirical cross-architecture determinism experiment before the kernel is designed around N-version verification**. ARCHITECTURE's 11-phase build order survives review and should be adopted with five amendments (see Build Order below): prepend the determinism slice, pull artifact-signing forward from the elfconv phase to the content-addressing phase, pull coordinator checkpointing forward from "scale optimization" to "browser correctness requirement", build the resource governor and benchmark instrumentation into the kernel phase where they are free, and attach hard exit criteria to the browser/relay phase. Two of the project's logged assumptions were disproved by evidence and one design tension was surfaced that the design doc never addressed — those three corrections are the highest-value output of this research and are stated first below.

---

## Corrections to Stated Assumptions — read before planning

These override prior beliefs. Do not plan around the superseded versions.

### C1. Determinism is not a runtime configuration — and it may not be achievable at all for float workloads

**Independent agreement: STACK (HIGH, direct measurement) + ARCHITECTURE (HIGH, spec) + PITFALLS (HIGH, spec + issue tracker).** This is the highest-confidence finding in the research, and the most disruptive.

| Fact | Evidence |
|---|---|
| V8 has no NaN-canonicalization flag, no relaxed-SIMD off-switch, no fuel metering | `node --v8-options` enumerated; nothing matches |
| Wasmtime has *all three* (`cranelift_nan_canonicalization`, `wasm_relaxed_simd(false)`, fuel) | [Wasmtime determinism guide](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html) |
| x86 sets new-NaN sign bit to 1; ARM sets it to 0 | [WebAssembly/design#477](https://github.com/WebAssembly/design/issues/477) |
| Relaxed-SIMD results *intentionally* vary with hardware; shared-memory ops nondeterministic | [`design/Nondeterminism.md`](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md) |
| `Math.pow/exp/sin` are implementation-defined across engines **and across V8 versions** | PITFALLS §1 |

**The consolidated recommendation** — STACK's "determinism certificate at publish time", ARCHITECTURE's "module validation as a pure function in `@o2/core`", and PITFALLS' "P0 cross-architecture divergence harness" are three parts of one mechanism. Build them as one:

1. **Empirical gate first.** Run the same float-heavy module on x86-64 Chrome/Firefox, arm64 Safari/Chrome, Android Chrome, and Node on both arches. Diff raw bytes. This is cheap, high-information, and **its outcome decides whether N-version comparison is a viable v1 integrity mechanism at all.** If it fails, the trust story becomes backbone-anchored audit sampling and the roadmap changes shape.
2. **Module admission gate** (pure function in `core`, run at publish time *and* re-run by the executor before instantiation): reject relaxed-SIMD opcodes, `atomic.*`/shared memory, imports outside a frozen allow-list, and any module whose `memory` does not declare `initial === maximum`.
3. **Determinism certificate**: a signed attestation published alongside the artifact CID asserting the above, plus NaN-normalization. This is the same signed `key → CID` mapping design §I.6 already requires — one mechanism, two jobs.
4. **Hash canonical form, never a raw memory slice.** Padding bytes, allocator residue, and NaN payloads all leak into `sha256(memory[ptr..ptr+len])`. Require modules to declare an output schema so the verifier canonicalizes typed float fields before hashing.
5. **Narrow the verification-eligible workload class in v1 to integer / bit-exact-float outputs, and say so in the docs.** Binaryen's `denan` pass (NaN→0) is available but is determinism-by-mutilation — it changes program semantics and is unverified against real elfconv output.

**Do not use WASI for the verified tier.** WASI hands the guest a clock, randomness, env vars, and a filesystem — four independent nondeterminism vectors. Ship four host functions (`o2_input_len`, `o2_input_read`, `o2_output_write`, `o2_log`) instead; that is a day's work versus a phase of trustworthy WASI stubbing. A deterministic WASI *subset* comes later, behind the same port, for elfconv-lifted binaries.

> **Superseded:** ARCHITECTURE §4.3 suggests `node:wasi` for the Node side of the WASI profile. STACK's reasoning wins — use `@bjorn3/browser_wasi_shim@0.4.2` on **both** platforms, because identical host semantics on every node is itself a determinism requirement and `node:wasi` is experimental with different behaviour from a JS shim.

### C2. The relay decision was inverted by evidence — and PROJECT.md is already updated

**Independent agreement: STACK + PITFALLS reached this separately from different sources.** The original decision ("DHT-discovered public IPFS infra primary, own backbone relay as fallback") is disproved. PROJECT.md Key Decisions already carries the revision (Revised 2026-07-24); this section records the supporting constants so the roadmap can set exit criteria against them.

Verified from `libp2p/js-libp2p@main`, [`transport-circuit-relay-v2/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/constants.ts):

```ts
DEFAULT_MAX_RESERVATION_STORE_SIZE = 15        // the 16th browser peer gets RESERVATION_REFUSED
DEFAULT_MAX_RESERVATION_TTL        = 2 hours
DEFAULT_DURATION_LIMIT             = 2 * minute   // per relayed connection
DEFAULT_DATA_LIMIT                 = 1 << 17      // 128 KiB per relayed connection
MAX_CONNECTIONS                    = 300          // separate ceiling
```

And from `server/reservation-store.ts`: `applyDefaultLimit = init.applyDefaultLimit !== false` — **the limits are on unless you explicitly turn them off.**

Three consequences: (1) a public relay serves **15 browser peers**, so a demo with 16 tabs hits a wall that looks like a network bug; (2) any actual data path through a relay truncates silently at 128 KiB or 120 seconds; (3) **your protocols will not negotiate over a relayed connection at all** unless registered with `runOnLimitedConnection: true` on *both* `handle()` and `dialProtocol()`. There is also an open, unresolved reliability report ([js-libp2p#2833](https://github.com/libp2p/js-libp2p/issues/2833)) — relays stop accepting requests after 5–10 peers; workaround is a reboot.

Separately, browsers structurally cannot use public infra: the overwhelming majority of public libp2p nodes listen on raw TCP/4001 and QUIC only, which a browser cannot dial ([discuss.libp2p.io #1990](https://discuss.libp2p.io/t/browser-nodes-cannot-use-the-majority-of-public-nodes-as-relay/1990) — `there are no valid addresses available to dial`). And browsers cannot bootstrap themselves out of it: browser kad-dht is **client-mode only** (registers no stream handler, stores no records, never appears in others' routing tables), and the documented alternative, pubsub peer discovery, is officially *"not battle-tested for production."*

**The resolution — two browser entry points, both self-hosted, neither requiring cert ops:**

| Path | Mechanism | Why |
|---|---|---|
| **Primary** | `@ipshipyard/libp2p-auto-tls@2.0.2` on a Node backbone node | Automatically acquires a Let's Encrypt cert for `<peerId>.libp2p.direct` → a browser-dialable `/dns4/.../tls/ws` multiaddr with **zero certificate operations**. STACK calls this the single highest-leverage package in the stack. Requires `identify` + `keychain` + a public address. |
| **Redundant** | `webRTCDirect()` listener on the same backbone node | Browser-dialable with **no cert, no DNS, no relay**. Cheapest possible browser→backbone path. |

Two traps on that second path: **`webRTCDirect()` *does* exist in js-libp2p** (`@libp2p/webrtc@6.0.27` exports it) — FEATURES' browser-constraints section states it does not, and ARCHITECTURE §12 says browsers can only dial DNS+WSS; **both are stale and superseded by STACK's verified transport matrix.** And `DEFAULT_CERTIFICATE_LIFESPAN = 1_209_600_000` (14 days) means a hardcoded certhash multiaddr **dies two weeks after the demo is recorded**, with a failure indistinguishable from an outage. Resolve bootstrap addresses at runtime from `dnsaddr` TXT records or a static JSON manifest served from the same origin (GitHub Pages can serve that).

Configure your own `circuitRelayServer()` with raised `maxReservations`, `applyDefaultLimit: false` or explicit generous limits, and tuned `reservationTtl`. Keep public relays configured as opportunistic redundancy so the "works without our infra" claim stays technically true. **Architect so the relay carries SDP only** — make it an invariant with a test asserting relayed byte counters stay under a few KiB per peer.

### C3. Sovereignty and redundant execution are structurally at odds — and the eclipse mitigation makes it worse

**FEATURES gap #1, and it is not addressed anywhere in the design doc.** If user A's data lives only on A's node, the only place a map over it can run is A's node. **There is no second independent node to replicate against.** N-version verification and sovereignty-by-placement cannot both apply to the same task.

PITFALLS sharpens this into something worse. The recommended defence against DHT-eclipse-inverting-the-quorum is *"at least one replica of every verification quorum anchored on the permissioned backbone"* — which converts eclipsing a quorum from cheap to requiring a backbone compromise. **That mitigation is structurally unavailable for a sovereignty-pinned task**, because a backbone replica would require moving the data. Sovereign maps are therefore unverifiable by *both* mechanisms simultaneously.

ARCHITECTURE's phase ordering already anticipates the tension without naming it: sovereignty (its P4) lands **before** decentralized placement (its P6), specifically so the hard constraint is designed in rather than retrofitted around a cost model. That ordering is correct and should be preserved. But ordering does not resolve the conflict — a decision does.

**Three resolutions, with their architectural consequences:**

| Option | Mechanism | Consequence |
|---|---|---|
| **(a) Replicate within the owner's trust domain** | Run the second execution on the owner's *other* devices or authorized encrypted replicas | Cleanest, and it reuses the design doc's own skew fix. But it requires multi-device identity and per-owner replica sets in the MVP — a real scope addition — and it proves nothing against a malicious owner. |
| **(b) Verify the reduce, not the map** — **recommended for v1** | Partials *do* move, and the aggregation tree *is* replicable and backbone-anchorable. Verify combines with full N-version + backbone anchoring; treat the sovereign map as owner-attested. | Requires the tree-reduce phase to exist before the verification claim is complete — acceptable, since ARCHITECTURE already sequences reduce (P5) before placement (P6). Honest framing: "the owner's contribution is trusted; the aggregation over contributions is verified." |
| **(c) Accept owner-trusted sovereign maps** | The owner has no incentive to corrupt their own contribution | True in isolation, **false for cross-owner aggregates** — an owner *does* have an incentive to bias a total. Only defensible when paired with (b). |

**Recommendation: demonstrate N-version verification on public/shared data (where there is no conflict), adopt (b)+(c) for sovereign data, and carry the sovereignty claim with the egress manifest and coverage report rather than with a quorum.** FEATURES' MVP list already sequences it this way ("redundant execution + commit-reveal, on public/shared data — sidesteps the sovereignty/replication conflict for v1"). Make the split explicit in the roadmap so it is a stated design position rather than a gap discovered during the demo.

### C4. Prior art moved — plainly

| What changed | Evidence | What it means for the plan |
|---|---|---|
| **Fluence archived its entire P2P WASM stack** — `nox`, `aqua` (2024-09-18), `aqua-lib`, `registry`, `trust-graph`, `spell`, `cli` — and now ships a Terraform provider for renting VMs | GitHub org listing, `archived: true` | Fluence is prior art for *choreography*, not a live competitor. **Do not build an Aqua-class DSL.** The market rewarded "rent me a VM," not "compose a task graph across peers." Ship a narrow map + decomposable reduce; if someone needs a DAG they chain jobs by CID from outside. |
| **Bacalhau deleted its deterministic-WASM verifier.** `pkg/` today has `bidstrategy`, `compute`, `orchestrator`, `publisher`, `nats` — no `verifier`. All 14 verifier issues closed, including "Enable deterministic verifier by default for WASM jobs" | GitHub contents API; issue search | The one team that built this exact mechanism removed it. Verification is **not** table stakes for the category — it is *this* project's deliberate differentiator because the Core Value asserts it. **Keep the verification tax visible, metered, and one flag away from off**, or it gets deleted here for the same reason. Read the removal commit before locking the design. |
| **Bacalhau dropped libp2p and the embedded IPFS node in v1.4 for NATS**; wasmCloud's lattice is also NATS | Bacalhau "libp2p Deprecation Notice", v1.3/v1.4 posts | The two most successful WASM-mesh products both concluded a hub tier is unavoidable. This **validates** the backbone-relay decision (C2) and says plainly: **libp2p purity is not a feature users value.** Budget the relay/bootstrap tier as a first-class component. |
| **Fission wound down (May 2024); `ipvm-wg/homestar` last pushed 2024-09-26.** Everywhere Computer is dead; IPVM survives as a spec | Fission "Farewell" post; GitHub `pushed_at` | The browser-compute niche is **vacant, not disproven** — it died of business model, not technology. But the failure mode to avoid is protocol research with no user. The demo must show a job a person cares about, not a protocol. |
| **Nobody exposes a reduce.** Bacalhau supports exactly one task per job and delegates DAGs to Airflow | Bacalhau job spec; v1.7 partitioned-jobs post | A working **tree-reduce is a genuine differentiator**, not a checkbox — and the smallest API that beats the incumbent. Copy Bacalhau's map surface verbatim (`count` + `BACALHAU_PARTITION_INDEX`/`_COUNT`) so the mental model transfers; the reduce is the delta. |

### C5. Version and ecosystem traps that cause immediate build failure

**js-libp2p is at `3.3.6`, not 2.x, and v3 is a hard API break.** Streams are now `EventTarget`s (`.send()` / `message` event), not streaming-iterables (`.source` / `.sink`); protocol handler signatures changed. **Any code, tutorial, or LLM output written for libp2p 1.x/2.x will not compile.** See the [v2→v3 migration guide](https://github.com/libp2p/js-libp2p/blob/main/doc/migrations/v2.0.0-v3.0.0.md). Assemble the module set from [`packages/integration-tests/package.json`](https://github.com/libp2p/js-libp2p/blob/main/packages/integration-tests/package.json) — that is the set libp2p itself CI-tests together — not from tutorials.

**The four trap packages.** Each exists, installs cleanly, and looks current:

| Trap | Why it's wrong | Use instead |
|---|---|---|
| `@chainsafe/libp2p-gossipsub@14.1.2` | Published 2026-04-21 but depends on `@libp2p/interface ^2.0.0` — a libp2p **v2** package. Gossipsub moved *into* the js-libp2p monorepo | `@libp2p/gossipsub@16.0.5` |
| `@libp2p/noise@1.0.1` | Homepage points at a directory that no longer exists on `main` — an abandoned monorepo-absorption attempt | `@chainsafe/libp2p-noise@17.0.0` |
| `@libp2p/yamux@8.0.1` | Same abandoned fork | `@chainsafe/libp2p-yamux@8.0.1` |
| `@libp2p/mplex@12.0.27` | **Self-deprecated in its own source.** No backpressure — will deadlock under a compute fabric's load | `@chainsafe/libp2p-yamux@8.0.1` |

> **Superseded:** ARCHITECTURE §7.3 and §12 both recommend `@chainsafe/libp2p-gossipsub@14.1.2`. That is trap #1. Use `@libp2p/gossipsub@16.0.5`. Verify `@libp2p/pubsub-peer-discovery@12.0.0` resolves against `@libp2p/interface@^3` before adopting it — unverified.

**Also fatal on contact:** `tsup` is explicitly unmaintained (its own README says so) → `tsdown@0.22.14`. `multiformats` must be `14.x` with an npm `overrides` pin, or `CID instanceof` checks fail silently across a v13/v14 boundary. `@multiformats/multiaddr` must be `13.x`. `uint8arrays` must be `6.x`.

**TypeScript 7.0.2** (Go-native compiler, shipped 2026-07-08): `strict` on by default, `module: esnext` default, **`node10`/`classic` moduleResolution and `baseUrl` are removed — hard errors, not warnings**. There is **no stable programmatic API until 7.1**, so nothing in the build may depend on it. The escape: `isolatedDeclarations: true` in tsconfig, which lets `rolldown-plugin-dts` use the **Oxc** generator and never touch the TS API. Have `oxlint@1.75.0` ready as a fallback if `typescript-eslint@8.65.0` does not hold against TS 7.

**Pin exact versions — no `^` — on the entire libp2p stack.** The constants this research depends on live in *internal* files that change without a semver signal. Add a **constants-regression test** asserting the relay/transport limits you depend on, so an upgrade fails loudly in CI instead of silently at scale.

---

## Key Findings

### Recommended Stack

One codebase, three targets, resolved by **package.json `exports` conditions** — not a bundler flag. This is how libp2p and Helia themselves ship. ESM only: libp2p 3.x and Helia 7.x are ESM-only and shipping CJS is not possible without forking the dependency tree. All environment detection happens **lazily inside `createNode()`**, never at module scope, or the `default` condition crashes on import in the embedded case.

**Core technologies:**

- **`libp2p@3.3.6`** — peer identity, transports, muxing, dialing. The only mature JS P2P stack that runs unmodified in browser + Node. v3's `EventTarget` streams removed the async-iterator latency tax that dominates small-message workloads — directly relevant to a scheduler exchanging many small control messages.
- **`helia@7.1.1` + `@helia/*`** — content-addressed block storage. js-IPFS is dead (deprecated 2023); Helia is the successor and is already on `@libp2p/interface ^3.2.4`. v7 is compositional, so the browser build drops what it does not need. Read [`libp2p-defaults.browser.ts`](https://github.com/ipfs/helia/blob/main/packages/libp2p/src/utils/libp2p-defaults.browser.ts) — it is the best single reference for a working browser config.
- **V8's built-in `WebAssembly`** — the execution sandbox. In the browser the runtime *is* V8, and Node exposes the same API, so **one code path covers both**. No Wasmtime/WasmEdge/Marine in the portable agent — that would fork the agent and destroy the project's core bet. Server-side runtimes belong only in the Part I build pipeline.
- **`@ipshipyard/libp2p-auto-tls@2.0.2` + `@libp2p/keychain@6.1.4`** — dissolves the WSS-certificate constraint (C2). Keychain is also what makes `webRTCDirect` certhashes stable across restarts.
- **`@bjorn3/browser_wasi_shim@0.4.2`** — pure-JS, zero-dependency WASI preview1 shim. Use it in **Node too**, not `node:wasi` — identical host semantics everywhere is a determinism requirement.
- **`binaryen@131.0.0` + `wabt@1.0.39`** — build-time only. Publish-time determinism normalization and opcode inspection before signing a CID. Never ship to the browser.
- **`typescript@7.0.2` + `tsdown@0.22.14` + `vitest@4.1.10`/`@vitest/browser` + `playwright@1.61.1`** — Playwright doubles as the benchmark driver: `browser.newContext()` × N gives N isolated nodes in one process.
- **`@libp2p/memory@2.0.24`** — in-process transport for deterministic multi-node tests. 100+ nodes in one process, no sockets, no ports, no flake. This is what makes the P1 loopback slice cheap.

**Transport reality (verified):** browser↔browser is **WebRTC and only WebRTC**, requiring a Circuit Relay v2 peer for SDP and a STUN server. `webRTCDirect()` is browser→server dial-only but needs no cert, DNS, or relay. WebTransport is dial-only in js-libp2p (**cannot listen** — needs QUIC in Node first) and absent from Safari; skip it.

**Unresolved toolchain decision:** ARCHITECTURE recommends `aegir@48.1.2` (the IPFS/libp2p ecosystem toolchain; ships the three-target `node`/`browser`/`webworker` test discipline out of the box, and its browser-field/ESM resolution already matches these dependencies). STACK recommends `vitest` for a sole-author repo with a custom license. **Both are defensible; the non-negotiable is the `webworker` test target**, because that is the target that catches `typeof window` sniffing. If you choose vitest, you own building that target yourself. Decide in the kernel phase.

### Expected Features

**Must have (table stakes — missing any and the demo is not credible):**

- **Partitioned map: `count` + partition index**, copying Bacalhau's `BACALHAU_PARTITION_INDEX`/`_COUNT` env-var contract *verbatim* so the mental model transfers. LOW cost, and it is literally the entire industry-standard surface.
- **Declarative job spec (YAML/JSON) + CLI + typed TS SDK, one schema.** One task per job — Bacalhau still supports only one after years, and adding more later is easy while removing is not.
- **Explicit per-job resource and time limits**, enforced in the sandbox, not by policy.
- **Redundant execution + result comparison**, with **commit-reveal**. iExec's PoCo has commit-reveal because a lazy worker otherwise plagiarizes its neighbour and collects. Redundancy without it is security theatre. **Cheap to add now, expensive to retrofit — it changes the wire protocol and the execution-record schema.**
- **Disagreement surfaced, not silently majority-voted away** (`agreement: 3/3` + dissenting node IDs), and a **"no verification" flag one keystroke away**.
- **Code goes to data automatically**; **owner approves code by content hash before it runs** (a UCAN/SPKI capability scoped to a code CID with an expiry — strictly better than Ocean's on-chain `publisherTrustedAlgorithms` array); **deny-by-default sandbox** with dangerous knobs labelled dangerous.
- **Lease-based dispatch with automatic reschedule on departure.** Churn is the domain, not an edge case.
- **`job describe` / `job history` / per-execution records.** Without these the system is undebuggable and the demo is unexplainable.
- **Browser consent surface + duty-cycle throttle + instant kill switch + contribution panel.** BOINC's "% of CPU" is implemented as a duty cycle (75% = compute 3s, wait 1s) specifically to control heat and fan noise — the single most-copied knob in volunteer computing, trivially implementable, and the cheapest way to stop being a "heavy tab."
- **Node-seconds / bytes / verification-multiplier accounting** — one mechanism serving both observability and the benchmark harness.

**Should have (differentiators):**

- **Sovereignty label as a hard, non-overridable scheduling constraint.** Nobody makes "unmovable" a first-class data attribute the scheduler *cannot* relax. Enforcement must be structural — the placement planner has no code path that relocates it. **The test that asserts a sovereignty-pinned task cannot be scheduled off-owner even under artificial load pressure *is* the differentiator.**
- **Decomposable tree-reduce with combiners.** Bacalhau has none; Fluence built the general version and archived it. A *narrow* associative+commutative merge with no all-to-all shuffle and O(N log N) links is the sweet spot everyone skipped.
- **Zero-install browser compute node.** Golem needs an installer, Akash needs Kubernetes, Bacalhau needs Docker, BOINC needs an app. "Open a tab" is a categorically different funnel.
- **A verifiable "your data never left" artifact** — owner-node-signed egress manifest per execution, complete *by construction* (no ambient network capability) rather than by audit.
- **Per-job trust dial with a live cost preview** (`none / 2-of-2 / 2-of-3 / backbone-only`, "≈2.1× node-seconds, ≈+40% latency"). Low code, high perceived value. **Bacalhau's verifier died because the tax was invisible and unbounded** — this is the fix.
- **Coverage report for cross-owner jobs** (`covered: 87/92 owners`). A correctness feature disguised as observability: an aggregate over an unknown subset of live owners is a wrong number presented as a right one.
- **AOT native→WASM via elfconv.** Honest framing required: ~56–82% of source-compiled WASM speed, needs unstripped static AArch64, can fail on indirect jumps. Ship as "supported binaries" with a compatibility checker, never as a universal claim.

**Defer (v1.x / v2+):** secure aggregation and DP over partials (but keep the reduce content-opaque so it stays possible — the aggregator must never need to inspect a partial to merge it); reputation weighting (an aggregation over verification outcomes, meaningless before those exist); delegated coordination for single huge jobs; WASM threads; TEE tier; any incentives/settlement layer.

**Explicit anti-features — do not build:** payments/tokens/staking (one of the largest Coinhive users earned **$7.69 in three months**); silent or implied-consent compute; a general DAG/workflow language; kernel-fidelity emulation; key-partitioned all-to-all shuffle; **leaderboards and points** (BOINC research puts solidarity at 82.9% vs credit at 13.7%, and points invite result-forging, which directly attacks the verification layer); reputation before verification works; live log streaming from browser edge nodes; arbitrary user-supplied source against sovereign data.

> **Scope conflict to resolve:** PITFALLS insists **provider-gated enrollment must be in the MVP** — *"enrollment is a security primitive, not a market feature"* — because sybil defence, quorum anti-affinity, and audit-sampling economics all depend on stable identity. PROJECT.md's Out of Scope list bundles "reputation" with "incentives, payments, staking." These are different things. **Enrollment ≠ incentives.** Flag for the roadmapper: a rate-limited, provider-signed enrollment token issuing a device-generated key is a security primitive belonging in the placement phase; reputation *scoring* stays out of scope.

### Architecture Approach

A **hexagon**: `@o2/core` is pure TypeScript with zero platform imports, zero libp2p imports, zero I/O. Adapters import core; core never imports an adapter; composition happens in exactly two files (`index.browser.ts`, `index.node.ts`) plus test harnesses. The dependency rule is enforced **by tooling, not discipline** — physical package boundaries mean `@o2/core`'s package.json simply does not list the adapters, and `dep-check` fails the build on an undeclared import, plus an ESLint `no-restricted-globals` rule banning `window`/`document`/`process`/`navigator`/`Buffer` inside `packages/core/**`.

The load-bearing premise: **"embedded" means inside somebody else's web page.** Therefore no `COOP`/`COEP` (those headers break the host's own cross-origin resources), therefore no `SharedArrayBuffer`, therefore **no WASM threads** — which is fine, because shared memory is a nondeterminism source anyway. Parallelism is N independent single-threaded Workers running N independent shards. The parallelism unit is the shard, not the loop iteration. And **no main-thread work, ever** — a library that janks the host page gets removed.

**Major components:**

1. **Executor** — turns one `TaskSpec` into one signed `Receipt`. Resolves inputs by CID, runs under fuel/memory/wallclock limits, content-addresses outputs. (Prior art: Bacalhau `Executor`, Homestar `homestar-wasm`.)
2. **Governor** — this node's admission control: `canAccept(task) → accept | reject(reason)`. Tracks leases, CPU/memory budget, and advertised capacity. **Drops advertised capacity to 0 on tab freeze.** This is also where the duty-cycle throttle and consent kill-switch live. (Bacalhau `BiddingStrategy`.)
3. **Placer** — power-of-d sampling (d=2..4; d>2 buys only a constant factor), anti-affinity across distinct operators, retry on reject. Stale load data is survivable *because* random sampling breaks the correlation that makes pick-the-best herd — and *because* the Governor says no. **Build Placer and Governor in the same phase or power-of-d degrades under load spikes.**
4. **JobCoordinator** — requestor role: shard → place → dispatch → collect → verify → reduce → publish. Owns leases, capability minting, final verdict.
5. **ReduceTree** — the highest-leverage design decision in the reduce layer: **derive the tree, never negotiate it.** Each internal node's id is `CID(dagCbor({op, orderedChildIds}))`, so every participant independently computes the identical tree from the identical sorted partial list — no consensus, no leader election, no topology agreement. Executors assigned by **rendezvous hashing (HRW)**, which gives the ranked fallback list for free. Because every combine is a pure function of already-durable content-addressed inputs, a failed aggregator has **no state to migrate** — repair is "call the function again somewhere else," and a late duplicate produces the same CID and is discarded harmlessly.
6. **Verifier** — compares **`(task, outputs)` and nothing else.** ARCHITECTURE flags this as the single most important line in its document: put `fuelUsed` or `wallclockMs` inside the signed/compared digest and every redundant execution disagrees, and you will spend a week debugging a "nondeterministic WASM" problem that is actually a schema problem.
7. **SovereigntyPolicy** — `mayMove(cid)` / `mustRunAt(cid)`. A hard pre-placement veto, evaluated as a filter, never as a score.
8. **CapAuthz** — verifies the UCAN/SPKI chain back to the owner's key before the Executor may touch a sovereign input.

**Two structural constraints worth surfacing to the roadmapper.** First, **the DHT/gossip plane split is a physical constraint, not a choice**: backbone nodes run kad-dht in server mode on a private protocol (`/o2/kad/1.0.0`) holding provider/capability/trust records; browsers run client mode and use gossipsub topics plus delegated HTTP routing; backbone nodes bridge the two. Second, **leases must be sized against background-tab timer throttling** (≥1 min): a 30-second lease falsely kills every backgrounded browser aggregator. The cleaner answer, which ARCHITECTURE recommends and this synthesis endorses: **do not place internal combine nodes on browser peers in v1 — browsers are leaves.**

### Critical Pitfalls

1. **Cross-architecture WASM divergence breaks verification** (C1). *Avoid:* P0 divergence harness in CI forever; module admission gate; canonical-form comparison; integer-only verified tier in v1. **Warning signs:** all test peers on one CPU architecture; the verifier hashes a raw linear-memory slice; any quorum disagreement triaged as "a bad node" without first checking architecture.
2. **DHT eclipse *inverts* quorum verification.** An attacker who eclipses a job's group key can land all N replicas on nodes they control; N-version comparison then returns unanimous agreement on a forged result and reports success. Record signing does not help — an eclipse *suppresses* records rather than forging them. Demonstrated cheaply in the literature ([Sybil Attack Strikes Again](https://dl.acm.org/doi/pdf/10.1145/3664476.3664482)). *Avoid:* never sample a quorum from one lookup; diversity constraints (distinct prefixes, distinct enrollment batches); **≥1 backbone-anchored replica per quorum** — the cheapest strong measure; provider-gated enrollment in the MVP; write the threat model as "attacker controls up to k of n" and put k in the verification phase's acceptance criteria.
3. **Relay defaults cap the demo at 15 peers / 128 KiB / 2 minutes** (C2). *Avoid:* own tuned relay; relay carries SDP only, asserted by a byte-counter test; `runOnLimitedConnection: true` everywhere; relay load-test as an explicit phase exit criterion (N+1 peers reserving simultaneously, held >1h, with churn).
4. **The cryptojacking-perception problem — security tooling blocks opt-in compute too.** **Firefox blocks known cryptominers by default** for all users via the Disconnect list; Edge ships PUA blocking; Brave blocks by default; Google banned all mining extensions from the Chrome Web Store in 2018. **Consent did not save Coinhive** — Malwarebytes blocked the explicitly opt-in AuthedMine too. The failure mode is *invisible*: visitors do not report "your miner was blocked," the page just contributes nothing and your node-count graph quietly under-reports. *Avoid:* never auto-start; persistent visible control surface; conservative hard cap (`max(1, cores/4)`, **not** `hardwareConcurrency`); never in a hidden iframe/SW/after-navigation; **vocabulary discipline** — no "mining," "hashrate," "earn," "credits," "tokens" anywhere in the UI or the repo; a plain-language policy page written for the human reviewer at Disconnect; a first-class **"% of visitors where the node failed to start" metric segmented by browser** (a Firefox-specific cliff is your blocklist alarm); pre-registered appeal paths. Fold this into PROJECT.md's existing disclosure gate.
5. **Benchmark numbers that are technically true and materially false.** [COST](https://www.usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf) found published systems with COST in the hundreds of cores or unbounded — **a system can scale beautifully purely because it has enormous parallelizable overhead**, and this one has content addressing, capability verification, DHT lookups, 16 KiB WebRTC framing, and 2–3× redundancy. The specific traps: N tabs on one machine counted as N nodes; "super-linear" stated without its mechanism; verification tax excluded; relay/aggregator hardware excluded from the inventory; warm V8 code cache undisclosed; uniform synthetic data (sovereignty makes skew *structural*, and skew is what flattens the real curve); mean instead of p99. *Avoid:* **pre-register the methodology before the first number exists**, publish a COST number even if it is embarrassing, publish raw data and the harness, and state the negative result. The design doc's "honest ceiling" is already the project's best credibility asset.
6. **Browser tab lifecycle silently destroys long-running tasks.** Chrome intensive throttling (1/min after 5 min hidden); **iOS Safari suspends JavaScript outright when backgrounded** — Apple calls it *"very intentional"*; freeze/bfcache/discard; memory ceilings far below the wasm32 2 GiB default (Godot dropped `WASM_MEM_MAX` to 256 MB for iOS Safari). Workers dodge *timer* throttling, not *page* lifecycle. *Avoid:* **task granularity in seconds, not minutes** — "assume the node vanishes in 10 seconds" is the edge-tier sizing default; content-addressed checkpoint at every boundary; wire `visibilitychange`/`freeze`/`resume`/`pagehide`; **advertise a capability class** (`foreground-desktop`/`background-desktop`/`mobile`) as a hard scheduling constraint, the same mechanism as the sovereignty label; declare and enforce a 256 MB per-task memory budget.
7. **WebRTC data channels cap at 16 KiB per message and Chromium closes the channel above 256 KiB.** Firefox fragments at 16 KiB with partial PPIDs that **Chromium does not reassemble**; the SCTP `ndata` fix is unimplemented everywhere. **The browser-to-browser mesh is not a bulk data path.** *Avoid:* chunk ≤16 KiB with `bufferedAmount` backpressure against 2 MiB; fetch WASM artifacts over an HTTPS/IPFS gateway (required anyway for V8 code caching); make reduce-partial size a tested design budget in the single-digit KiB — a concrete second reason to prefer mergeable sketches.
8. **The requestor-as-coordinator is a browser tab, and browser tabs close.** ARCHITECTURE frames delegated coordination as a scale optimization (its P8); PITFALLS argues that on the browser edge it is a **correctness requirement for any job longer than a few seconds**, because the coordinator is exactly as fragile as the workers. **Reconciled in the build order below (amendment A3).**
9. **Content addressing gives integrity, not provenance — and the native tier is an RCE channel.** A CID proves bytes match a hash; anyone can publish bytes under any CID. For `.wasm` the sandbox caps the blast radius to a wrong answer. For any native artifact it is **arbitrary native code execution on every consuming node.** This lands in a *late* phase when schedule pressure is highest — **so build the signed `key → CID` infrastructure when content addressing lands, not when native lands**, so the native path physically cannot ship unsigned.
10. **The verification tax compounds.** 2–3× redundancy × 1.1–2× speculation × re-execution after churn × quorum retries from honest disagreement = a nominal 3× becomes a real 5–6×. Useful throughput is gross ÷ multiplier, so this is a **direct divisor on the headline scaling number**. *Avoid:* instrument gross-vs-useful as a live metric from the first working job; make redundancy a per-job dial defaulted low; prefer audit sampling (`1 + p`) over blanket N-version for low-value work; cap speculation with a global budget.
11. **Accidental public disclosure forfeits EPO/China patent rights permanently.** Leak vectors are mundane and automated. *Avoid:* **no deploy workflow file present in the repository at all** — not disabled, not commented out, *absent*; `"private": true` in every package.json; a pre-flight checklist as a required gate; scheduled greps of public indexes.

---

## Implications for Roadmap

### Build Order — verdict on ARCHITECTURE's 11-phase plan

**It survives.** The vertical-slice discipline is right, the `P1 → P2 → P3` chain (each swapping exactly one adapter class) is genuinely load-bearing, and the deliberate deferral of decentralized placement behind sovereignty and reduce is well-argued. **Adopt it with five amendments**, producing **11 phases (P0–P10)** at fine granularity, every one delivering an end-to-end capability:

| # | Amendment | Why |
|---|---|---|
| **A1** | **Prepend a determinism slice (new P0) before the kernel.** | ARCHITECTURE's P1 designs the receipt schema and verifier around N-version comparison. If C1's empirical result is negative, that design is wrong and the trust model changes. **This must not be discovered in P1.** PITFALLS is unambiguous: this is the single highest-value experiment in the project and it gates the roadmap. |
| **A2** | **Move signed `key → CID` infrastructure forward, into the sovereignty/content-addressing phase.** | ARCHITECTURE implicitly leaves signing to the elfconv phase (its P11). PITFALLS #13: build it when content addressing lands so the native path *physically cannot* ship unsigned. It is also the same mechanism as the determinism certificate — one build, two uses. |
| **A3** | **Move coordinator checkpointing forward into the churn phase; keep *delegated sub-coordination* late.** | Reconciles the ARCHITECTURE-vs-PITFALLS disagreement on Pitfall #8. `JobState` as a content-addressed block published at the group key is cheap and makes any job survivable; full HRW coordinator handoff for massive graphs stays a late, scale-driven phase. |
| **A4** | **Build the resource governor, lifecycle handling, and benchmark instrumentation into P1, not into the demo/bench phases.** | Both PITFALLS #4 and #6 say retrofitting a governor into a scheduler that assumes full CPU is a rewrite, and PITFALLS #5 says the metrics you need determine the instrumentation you must build from day one. These are *free* in P1 and expensive later. Benchmark **methodology** is a P0/P1 written deliverable even though the harness is late. |
| **A5** | **Add explicit exit criteria to the browser phase: tuned-relay load test, constants-regression test, `runOnLimitedConnection` coverage, and no hardcoded certhash.** | C2's four failure modes are all silent and all surface only at scale or at 14 days. |

**Also adopt as stated:** elfconv runs **parallel** to everything from P3 onward (C++/LLVM in `tools/aot/`, zero TypeScript coupling), the bench harness runs **parallel** to the reduce phase (its target API is frozen by then, and having numbers *while* building the tree is more useful than after), and the "no `-pthread` in edge artifacts" constraint must be **recorded before** any elfconv artifact is compiled — retrofitting is a recompile of everything.

---

### Phase 0: Determinism & verification viability
**Rationale:** C1. The result decides whether "redundant execution + comparison" is a viable v1 integrity mechanism. Everything downstream is designed around the answer. Smallest possible vertical slice of the real pipeline: compile a module → run it → canonicalize the output → hash → compare.
**Delivers:** A CI harness running the same module + input across x86-64 Chrome/Firefox, arm64 Safari/Chrome, Android Chrome, and Node on both arches, asserting byte-identical canonical output. The module-bytes admission gate (opcode + import allow-list, `initial === maximum` memory) as a pure function. Written benchmark methodology (metrics, node inventory, run counts, cold/warm policy, redundancy factor, skew profile, **and the single-threaded baseline**). Repo hygiene: no deploy workflow file, all packages `"private": true`.
**Addresses:** the Core Value's "verified-correct result" precondition.
**Avoids:** Pitfalls 1, 5, 14 (disclosure).
**Exit criterion:** divergence harness green in CI, **or** a written decision to replace N-version with backbone-anchored audit sampling (which cascades into the roadmap and must be made here, not later).

### Phase 1: Kernel + loopback slice
**Rationale:** ARCHITECTURE's minimum spanning set. If the task ABI or receipt schema is wrong, find out in week one with a 200 ms test, not in week twelve behind a WebRTC connection you cannot debug.
**Delivers:** `submitJob` with 4 shards, each mapped twice (R=2) over `LoopbackNetwork`, Verifier agrees, result CID returned. The hexagon and its ports. `TaskSpec`/`Receipt` dag-cbor schemas **including the commit-reveal fields**. Four-function narrow host ABI. Worker-pool runtime (browser) and `worker_threads` runtime (Node) — the same shape, so P3 swaps an adapter rather than rewriting the executor. Governor with duty-cycle throttle, capacity advertisement, and kill switch. `LifecyclePort`. Gross-vs-useful accounting instrumentation. Same suite green under `node` / `browser` / `webworker` targets.
**Uses:** V8 `WebAssembly`, `@libp2p/memory`, `multiformats@14`, `@ipld/dag-cbor`, the three-target test discipline.
**Implements:** Executor, Governor, Verifier, module validation.
**Avoids:** Pitfalls 1 (enforcement), 4 (governor hooks), 6 (Worker architecture), 7 (no-SAB architecture), 9 (instrumentation), and ARCHITECTURE's anti-patterns A2 (never hash timing into the receipt) and A9 (never run tasks on the main thread "just for now").

### Phase 2: Real network, Node ↔ Node
**Rationale:** First real payoff of the port boundary. If the kernel gets touched here, the boundary was wrong — and you learn it cheaply.
**Delivers:** Two Node processes on localhost: TCP + noise + yamux, `/o2/dispatch/1.0.0`, block exchange, fs blockstore, a distributed 2×-redundant map job.
**Uses:** `libp2p@3.3.6` with the CI-tested module set, `@chainsafe/libp2p-noise@17`, `@chainsafe/libp2p-yamux@8`, `blockstore-fs`, `datastore-level`, `protons`.
**Avoids:** C5 (exact pins + constants-regression test land here), Pitfall 12 (ecosystem churn).

### Phase 3: Browser tier + backbone relay — **headline**
**Rationale:** Everything except transport and storage is already proven, so WebRTC/relay debugging happens against a known-good protocol. This is the demo's wow factor and the project's core bet.
**Delivers:** `@o2/relay` (Node: tuned `circuitRelayServer` + AutoTLS WSS + `webRTCDirect` listener + bootstrap); WebRTC/websockets/circuit-relay adapters; `blockstore-idb`; freeze/resume lease surrender. **Two browser tabs run a distributed job and agree on the result.**
**Uses:** `@libp2p/webrtc@6.0.27`, `@libp2p/circuit-relay-v2@4.2.9`, `@ipshipyard/libp2p-auto-tls@2.0.2`, `@libp2p/keychain`, `blockstore-idb`, `datastore-idb`.
**Avoids:** Pitfalls 2, 3, 6, 10.
**Exit criteria (A5):** N+1 browser peers reserve simultaneously against the tuned relay and hold >1 hour with churn; every registered protocol negotiates over `p2p-circuit`; relayed byte counters stay under a few KiB/peer; no `/certhash/` literal in source; a Firefox↔Chrome >256 KiB transfer succeeds.

### Phase 4: Sovereignty, authorization & artifact signing
**Rationale:** This is the Core Value. Do it **before the scheduler gets clever**, so the hard constraint is designed in rather than retrofitted around a cost model. Amendment A2 folds signing in here.
**Delivers:** Sovereignty labels on blocks; UCAN/SPKI chain verified before execute; `mustRunAt` placement; signed `key → CID` mappings with pinned trust anchors; the P0 determinism certificate becomes a published, verified artifact. Tab A holds private data, tab B submits, code ships to A, **only the aggregate leaves — with a stream-tap test that fails if raw bytes move.**
**Addresses:** sovereignty-as-hard-constraint, owner capability chain, egress-manifest foundation.
**Avoids:** Pitfalls 13, 15 (skew design), and C3's structural conflict — **this phase must carry the written decision on which resolution (a/b/c) applies.**

### Phase 5: Decomposable tree-reduce
**Rationale:** The first genuinely novel piece, and it needs P4's constraints to exist so combines do not get placed illegally. Also where C3's recommended resolution (verify the reduce, not the sovereign map) becomes real.
**Delivers:** `deriveTree` (pure, CID-derived) + HRW assignment + k-ary fan-in (k=8–16) + leases + re-dispatch on expiry. 8+ nodes, real map/reduce, correct aggregate. Combiner pushdown at the owner. Partial-size budget enforced by test.
**Avoids:** Pitfall 10 (partial sizing), ARCHITECTURE anti-patterns A6 (never negotiate the topology) and A10 (never default to all-to-all shuffle).
**Constraint:** browsers are leaves; internal combine nodes go on the backbone in v1 (lease sizing vs. background-tab throttling).

### Phase 6: Discovery, placement & enrollment
**Rationale:** Deferred deliberately — a static peer list is a perfectly good crutch for five phases, and doing placement before the reduce exists means guessing at what a placement decision needs.
**Delivers:** kad-dht server mode on a **private protocol** (`/o2/kad/1.0.0`) on the backbone; gossipsub group keys for the edge; delegated HTTP routing for browsers; signed capability/trust records; power-of-d (d=2..4) + anti-affinity; Governor admission control and backpressure; **provider-gated enrollment**; quorum diversity constraints with ≥1 backbone-anchored replica. Removes the static peer list P1–P5 leaned on.
**Uses:** `@libp2p/kad-dht@16.4.0`, `@libp2p/gossipsub@16.0.5` (**not** the ChainSafe v2 package), `@helia/delegated-routing-client`.
**Avoids:** Pitfall 8 (the big one), ARCHITECTURE anti-patterns A7 (records are hints, confirm liveness) and A8 (never place R replicas on one operator).

### Phase 7: Churn, stragglers & coordinator survival
**Rationale:** The acceptance test *is* the phase. This is design-doc research risk #2. Amendment A3 pulls coordinator checkpointing in here.
**Delivers:** Speculative/backup execution with a global budget; `JobState` checkpointed as a content-addressed block at the group key; late-duplicate dedup by CID; workers self-terminate on lease expiry and release results to content-addressed storage. **Kill 30% of nodes mid-job → job still completes correctly. Kill the requestor tab mid-job → job completes via a resuming coordinator or fails cleanly with recoverable partials, never orphaned leases.**
**Avoids:** Pitfalls 6, 9, 11.

### Phase 8: Benchmark harness
**Rationale:** Proves the *scaling thesis*, which is a separate claim from "it works." Runs **parallel to P5** against the frozen dispatch API. Executes the methodology pre-registered in P0.
**Delivers:** Throughput vs node count (both the memory-transport curve *and* the real-transport curve — the gap between them is the connectivity tax and is itself a publishable number); straggler and verification-tax breakdown; **the COST crossover number**; a skewed-data configuration; p50/p95/p99 makespan; cold-vs-warm code cache disclosed; raw data and harness published.
**Uses:** `@libp2p/perf@5.1.9` (official cross-implementation protocol, so numbers are comparable to published go/rust-libp2p figures), `tinybench`, Playwright contexts, `@helia/car` fixtures, `performance.mark`/`measure`.
**Avoids:** Pitfall 5 in every particular.

### Phase 9: Public demo, consent UX & disclosure gate
**Rationale:** Depends on everything. Deployment is a **separate explicit gate**, not a consequence of the phase completing.
**Delivers:** Multi-machine + multi-tab demo, **built but not deployed**. Consent-before-any-CPU flow, always-on indicator, one-click stop that provably drops CPU to zero, contribution panel showing what ran and for whom. Plain-language policy page. "% of visitors where the node failed to start" metric segmented by browser. Blocklist scan and pre-registered appeal paths. If cross-origin isolation ever becomes load-bearing, this is where hosting moves off GitHub Pages (Cloudflare Pages/Netlify set real headers for free).
**Avoids:** Pitfalls 4, 7, 14.

### Phase 10: elfconv AOT pipeline
**Rationale:** PROJECT.md's explicit decision — Part I sequenced last so it does not block the capacity/sovereignty thesis. **Parallelizable from P3 onward** (C++/LLVM, `tools/aot/`, zero TypeScript coupling, different skill surface).
**Delivers:** Docker toolchain → determinism-validated + signed `key → CID` mapping (infrastructure already built in P4) → artifact registry → V8 code-cache priming via gateway URLs + `compileStreaming`. Compatibility checker. Deterministic WASI subset as a second `WasmRuntimePort` profile.
**Constraints recorded earlier:** `TARGET=aarch64-wasi32` (not the Emscripten `aarch64-wasm INITWASM=1` bundle, which emits JS glue and splits the ABI); **no `-pthread` in any edge artifact**; AArch64 static unstripped input only; indirect/computed jumps are a hard ceiling.

### Phase Ordering Rationale

- **`P0 → P1 → P2 → P3` is a hard chain.** P0 decides the trust model; then each of P1→P2→P3 swaps exactly one adapter class and validates the port boundary by doing so. Starting with WebRTC means debugging three unproven things at once.
- **Sovereignty (P4) precedes placement (P6)** so the hard constraint is designed in, not retrofitted around a cost model. The scheduler must never have had a code path that relocates unmovable data.
- **Reduce (P5) precedes placement (P6)** because doing placement before the reduce exists means guessing at what a placement decision needs — and because C3's recommended resolution makes the reduce the thing that carries the verification claim.
- **Placer and Governor ship together (P6)** — power-of-d degrades under load spikes without node-side backpressure; they are one mechanism.
- **Every phase is a working system with fewer capabilities, never a layer with no system.** ARCHITECTURE's anti-pattern A5 is the explicit warning: the design doc's layer diagram looks like a build plan and is not. Four months of beautiful transport, beautiful blockstore, and nothing that computes.
- **Governor, lifecycle, signing, and instrumentation are all pulled *earlier* than their "natural" phase** because each is free where it belongs and a rewrite where it does not.

### Research Flags

**Phases likely needing `/gsd-research-phase` during planning:**

- **P0** — the divergence result is unknown and unmeasured; the fallback design (backbone-anchored audit sampling) needs its own design work if the answer is negative. Also: no maintained JS-side WASM gas-metering tool was found, so fuel bounding is an open build-vs-accept-Worker-timeout decision.
- **P3** — Safari + WebRTC-Direct support is **unverified** (WebRTC-Direct relies on SDP munging, historically fragile in WebKit); no credible published throughput numbers exist for js-libp2p WebRTC at N>50 browser peers; real relay capacity under partial-result traffic is unmeasured. Playwright `webkit` in CI from day one is the mitigation, but the phase plan needs a fallback branch (Safari = WSS-only).
- **P5** — the HRW-assigned, CID-derived reduce tree with pure-recompute repair is a **synthesis, not a copy of a shipped system** (ARCHITECTURE's own confidence: MEDIUM). Each ingredient is standard; this combination is not.
- **P6** — **S/Kademlia disjoint-path lookups are not implemented in js-libp2p** (the docs' "augmented with notions from S/Kademlia" is not the same thing). Sybil/eclipse resistance is **build, not configure**. Enrollment design also needs research since it touches the PROJECT.md scope boundary.
- **P7** — tree-reduce robustness under aggregation-backbone churn is one of the design doc's three named research risks and has no shipped prior art to copy.
- **P10** — elfconv's real-world lift success rate, `denan` behaviour on actual elfconv output, and the WASI-subset determinism surface are all unverified against real artifacts.

**Phases with standard patterns (skip research):**

- **P1** — hexagonal architecture, dag-cbor schemas, Worker pools, and the compile-once/share-`Module` pattern are all well-documented and verified (MDN, libp2p/Helia source).
- **P2** — the exact compatible libp2p module set is published in libp2p's own integration tests; the TCP/noise/yamux path is the most-trodden in the ecosystem.
- **P8** — `@libp2p/perf` is a specified cross-implementation protocol; the benchmark *methodology* is the hard part and it is written in P0, not researched in P8.
- **P9** — the consent-UX pattern set is fully documented by BOINC's shipped controls and the Coinhive post-mortems. It needs care, not research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Every version read from the live npm registry *and* cross-checked against `main`-branch source on 2026-07-24. Several strong training-data beliefs were disproved in the process (gossipsub, tsup, noise) — the verification method demonstrably worked. MEDIUM only for Safari-specific WebRTC behaviour. |
| Features | **MEDIUM-HIGH** | Product surfaces verified against live docs and repo state for Bacalhau, iExec, Ocean, Akash, Golem, wasmCloud, BOINC. Browser platform constraints verified against Chromium/MDN/web.dev. **LOW-MEDIUM for browser-volunteer-node UX expectations, because no product currently ships one** — those figures are inferred from BOINC's controls and the Coinhive backlash. |
| Architecture | **MEDIUM-HIGH** | Platform mechanics (libp2p services DI, `exports` conditions, three-target testing, kad-dht client mode, Page Lifecycle, power-of-d) verified against Context7 and live package.json. **MEDIUM for the composition** — the reduce tree and sovereignty-as-veto are synthesis, and the design doc itself says so. |
| Pitfalls | **HIGH / MEDIUM** | HIGH for libp2p constants and WASM determinism (read directly from source and spec) and for the cryptojacking-perception evidence (vendor blogs, browser policy docs). MEDIUM for benchmark and distributed-systems traps (peer-reviewed but not measured on this system). MEDIUM-LOW for browser lifecycle numbers (vendor behaviour changes and is under-documented for Workers specifically). |

**Overall confidence:** **MEDIUM-HIGH.** The facts that constrain the design are HIGH-confidence and mostly came from reading source rather than docs. The uncertainty is concentrated exactly where the project's novelty is — which is the correct place for it, and is what P0, P5, P6, and P7 exist to resolve.

**Highest-confidence items (two or more agents reached these independently):**

- V8 offers no determinism controls; determinism must be an artifact property → **STACK (direct measurement) + ARCHITECTURE (spec) + PITFALLS (spec + issue tracker)**
- The relay decision must be inverted; own backbone relay primary → **STACK + PITFALLS**, from different evidence (constants file vs. forum reports + certhash lifespan)
- Relay is signaling-only: 15 reservations / 128 KiB / 2 min → **STACK + PITFALLS**, both reading the same source file independently
- No `SharedArrayBuffer`, no COOP/COEP, no WASM threads — and this is *good* because threads are a nondeterminism source → **ARCHITECTURE + PITFALLS + FEATURES**
- Browser kad-dht is client-mode only; discovery must be backbone-anchored → **STACK + ARCHITECTURE + PITFALLS**
- All compute in Workers, never the main thread → **ARCHITECTURE + PITFALLS + FEATURES**
- WASM artifacts fetch over a gateway URL with `compileStreaming`, never through the mesh → **all four**

### Gaps to Address

1. **Does NaN divergence actually bite for the target workloads?** The spec permits it; whether x86 vs arm64 V8 diverge on the specific float ops elfconv-lifted code emits is **unmeasured**. → **P0, blocking.** Cheap experiment, highest information value in the project.
2. **Sovereignty vs. redundant execution (C3).** Three resolutions, none free, and the eclipse mitigation is structurally unavailable for sovereign data. → **Decide in P4 planning, before either feature is built.** It changes the shape of both.
3. **Why Bacalhau deleted its verifier.** The rationale is not recoverable from public docs — issues closed without a stated verdict. → **Read the removal commit before locking the verification design.** They hit something.
4. **Whether verification has any user demand at all.** iExec moved its messaging to TEE-only ("no replication needed"); Bacalhau removed replication verification. Both signals point the same way. The Core Value asserts verification matters — **treat that as a hypothesis the demo tests, not a settled requirement.**
5. **Safari + WebRTC-Direct.** Unverified from any authoritative source. → Playwright `webkit` in CI from day one; fallback is Safari = WSS-only.
6. **Sustained WebRTC throughput at N>50 browser peers.** No credible published numbers exist for js-libp2p. → **P3 measurement task, not an assumption.**
7. **Relay capacity under real partial-result traffic.** The constants are verified; how many concurrent browser nodes one tuned relay sustains is not. → **P3 load test as an exit criterion.**
8. **Gas metering.** No maintained JS-side WASM instrumentation tool exists (`wasm-metering` is from 2022 and predates SIMD/bulk-memory/GC). Options: build on `binaryen@131`, adopt Rust-side `wasm-instrument` in the publish pipeline, or accept Worker-`terminate()` timeout as the only bound (nondeterministic, but it affects only *liveness*, not results — and redundant execution already covers a timed-out node). → **P0/P1 decision.**
9. **Real browser dwell time for an opted-in compute session.** All available figures are general web-analytics research, not from a context where a user explicitly opted in — which plausibly produces much longer sessions. → **Instrument in P9; it determines optimal partition size.**
10. **`@libp2p/pubsub-peer-discovery@12.0.0` against `@libp2p/interface@^3`.** Unverified. And libp2p's own docs call pubsub discovery "not battle-tested for production." → Plan a custom `/o2/rendezvous/1.0.0` on the backbone as the hardening path in P6.
11. **`typescript-eslint@8.65.0` against TypeScript 7.0.** Unverified — typescript-eslint uses the TS API heavily and TS 7's API is unstable until 7.1. → `oxlint@1.75.0` is the escape hatch.
12. **aegir vs. vitest for the three-target test discipline.** Both defensible; the `webworker` target is non-negotiable either way. → Decide in P1.
13. **`SharedWorker` as one-node-per-origin.** Attractive (one relay reservation, one blockstore, one identity for N tabs) but **no first-class Helia/libp2p support exists.** → Spike with an unknown answer, not a phase deliverable.

---

## Sources

Full source lists with per-claim confidence live in the four research files. Aggregated by tier:

### Primary (HIGH confidence)
- **`libp2p/js-libp2p@main`, read 2026-07-24** — `transport-circuit-relay-v2/src/constants.ts` (15 reservations / 2 h TTL / 2 min / 128 KiB / MAX_CONNECTIONS 300); `server/reservation-store.ts` (`applyDefaultLimit !== false`, `RESERVATION_REFUSED`); `transport-webrtc/src/constants.ts` (16 KiB message, 2 MiB buffer, 14-day certificate); `interface/src/index.ts` (`runOnLimitedConnection`); `connection-manager/constants.browser.ts` (browser MAX_CONNECTIONS 100); `packages/integration-tests/package.json` (the canonical compatible module set); `doc/migrations/v2.0.0-v3.0.0.md`; `doc/SERVICES.md`; `packages/kad-dht/src/index.ts`
- **`ipfs/helia@main`** — `libp2p-defaults.browser.ts` (best working browser config reference), `delegated-http-routing-defaults.ts`
- **npm registry, queried 2026-07-24** — every version cited; deprecation and `time.modified` checks that exposed the four trap packages
- **Direct measurement** — `node --v8-options` (no relaxed-SIMD flag, no NaN canonicalization, no fuel); `nodejs.org/dist/index.json` (Node 24 LTS)
- **WebAssembly specs** — [`design/Nondeterminism.md`](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md) (normative), [design#477](https://github.com/WebAssembly/design/issues/477) (x86/ARM NaN sign bit), [design#619](https://github.com/WebAssembly/design/issues/619), relaxed-simd Overview, [Wasmtime determinism guide](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html) (the contrast case)
- **Vendor platform docs** — MDN (`SharedArrayBuffer`, `COEP`, `WebAssembly.Module` structured cloning, Battery Status API); [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) + Intent to Ship; Chrome Page Lifecycle API; [web.dev cross-origin isolation](https://web.dev/articles/cross-origin-isolation-guide); [Apple Developer Forums thread 777860](https://developer.apple.com/forums/thread/777860) (iOS Safari background JS suspension)
- **Competitor repo/doc state** — Bacalhau (`pkg/` has no `verifier`; libp2p deprecation notice; v1.4 NATS migration; partitioned jobs); Fluence GitHub org (`archived: true` across the stack); Ocean C2D compute-options; iExec PoCo; BOINC preferences wiki; wasmCloud lattice docs
- **Cryptojacking precedent** — [Mozilla: Firefox blocks cryptomining by default](https://blog.mozilla.org/en/firefox/todays-firefox-blocks-third-party-tracking-cookies-and-cryptomining-by-default/); Malwarebytes Labs (AuthedMine blocking, Salon.com); [TechCrunch: Chrome Web Store mining ban](https://techcrunch.com/2018/04/02/google-is-banning-all-cryptomining-extensions-from-its-chrome-web-store/)

### Secondary (MEDIUM confidence)
- [libp2p.io/docs/webrtc-browser-connectivity](https://libp2p.io/docs/webrtc-browser-connectivity/) — transport matrix, ~80% hole-punch success, pubsub discovery "not battle-tested"
- [discuss.libp2p.io #1990](https://discuss.libp2p.io/t/browser-nodes-cannot-use-the-majority-of-public-nodes-as-relay/1990); [js-libp2p#2833](https://github.com/libp2p/js-libp2p/issues/2833) (open relay reliability bug); [#1621](https://github.com/libp2p/js-libp2p/issues/1621)
- Distributed-systems literature — [COST (HotOS '15)](https://www.usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf); [Twelve Ways to Fool the Masses (Bailey 1991)](https://www.davidhbailey.com//dhbpapers/twelve-ways.pdf); [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf); Mitzenmacher power-of-d (TPDS 2001)
- IPFS sybil/eclipse research — [Sybil Attack Strikes Again (ACM)](https://dl.acm.org/doi/pdf/10.1145/3664476.3664482); [arXiv 2505.01139](https://arxiv.org/abs/2505.01139)
- Volunteer-computing motivation — MalariaControl.net study (82.9% satisfaction vs 13.7% credit); BOINC platform papers
- [Lennart Grahl: WebRTC data channel size limits](https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html); [Mozilla WebRTC: Large Data Channel Messages](https://blog.mozilla.org/webrtc/large-data-channel-messages/)
- TypeScript 7.0 RC announcement (breaking changes, no stable API until 7.1); Vitest browser-mode docs

### Tertiary (LOW confidence — needs validation)
- Safari WebRTC-Direct support status — could not confirm from any authoritative source
- Practical magnitude of cross-architecture NaN divergence in V8 — **no measurement found anywhere; this is what P0 exists to produce**
- `WebAssembly.Memory({shared:true})` availability without cross-origin isolation — MDN wording is ambiguous and behaviour has changed
- RTCPeerConnection practical peer ceiling — sources are dated and browser-version dependent
- Browser dwell-time distributions applied to an opted-in compute context
- Paywalled self-healing-aggregation-tree literature (abstract-level only; treated as directional)

---
*Research completed: 2026-07-24*
*Ready for roadmap: yes*
