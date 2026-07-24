# P2P Native Cloud — Master Architecture Design

*A peer-to-peer compute fabric that runs both managed (WASM) and native code, moves code to data (or data to code), keeps data on the owner's node for sovereignty, and scales processing with the user base via massive task graphs.*

*This is the consolidated master. **Part I** is the execution substrate (running native code in WASM, and how it's built/cached/distributed); **Part II** is the P2P fabric that orchestrates it. It folds in and supersedes the separate "AOT Execution Strategies" and "P2P Cloud" documents.*

**Proven vs. novel (the risk surface).** Compute-to-data over content-addressed storage is proven (Bacalhau / IPVM / Homestar, Ocean Protocol C2D). Decentralized task-graph choreography with no central coordinator is proven (Fluence Aqua → AIR → AquaVM). Sandboxed WASM, content addressing, confidential computing (SEV-SNP / TDX / Nitro / Arm CCA), and binary→WASM AOT (elfconv) are all off-the-shelf. **The novel composition** is (a) unifying managed + *safely-sandboxed native* via AOT-to-WASM, (b) sovereignty-by-placement (data pinned to the owner's node), and (c) a hybrid trust model that dials guarantees per job. Nobody has shipped that exact combination as a product.

---
---

# PART I — The compute substrate: running managed and native code

*How a single node executes any code — managed or native — safely and fast. Part II orchestrates this across the mesh.*

## I.0 The core problem

Managed code (WASM) is portable and sandboxable — ideal for untrusted peers. Native code is the opposite: **architecture-specific** (ARM phone vs. x86 server vs. RISC-V) and **unsandboxed**, so running arbitrary native on a random peer is remote code execution. The substrate's job is to make native behave like managed — portable and sandboxed. The primary tool is **ahead-of-time (AOT) translation of native → WASM**; emulation is the fallback only when a full kernel is required.

## I.1 Two meanings of "AOT" (don't conflate them)

"AOT" means two unrelated things depending on **which layer of the stack** you compile ahead of time. Conflating them produces most of the confusion and most of the inflated performance numbers.

| | **Method 1 — Host-level AOT** | **Method 2 — Binary AOT translation** |
|---|---|---|
| What gets compiled | The *emulator* (`.wasm` → native host code) | *Your app* (native binary → `.wasm`) |
| Tool | WasmEdge / Wasmtime AOT compiler | elfconv |
| Guest still emulated at runtime? | **Yes** — QEMU/TCG runs inside | **No** — no guest, no kernel |
| Runs on V8 / in browser? | **No** — server-side WASI runtimes only | **Yes** |
| Removes | wasm-interpretation tax on the server | the emulation tax entirely |
| Needs container2wasm? | Yes | No — bypasses it |

They are not competing options; they optimize different bottlenecks. Method 1 makes the emulator cheaper to *run*; Method 2 removes the emulator.

## I.2 Decision tree (read first)

```
Do you have the application SOURCE?
├── YES → compile source → wasm32-wasi (clang/wasi-sdk) or Emscripten.  [I.3]
│          Fastest (~1.2–2x native), most reliable, no lifting fragility.
│          Neither method below applies. Stop here.
│
└── NO (binary only) →
        Do you need a full Linux KERNEL / unmodified multi-process container?
        ├── NO (just the app's userspace) → elfconv binary AOT.          [I.4]
        │
        └── YES → emulation (container2wasm). Accept ~10x+ slowdown.      [I.5]
                   If server-side, AOT the emulator (Method 1) to cut the host tax.
```

**Key fact that governs the whole tree:** source-compiled WASM is *faster* than anything you can lift from a binary — elfconv's own benchmarks use source-compiled WASM as the baseline it loses to. So the binary-translation and emulation paths only earn their place when source is genuinely unavailable.

## I.3 Have source → compile directly to WASM (the best path)

Compile the source to `wasm32-wasi` (clang / wasi-sdk) or via Emscripten for the browser. ~1.2–2x native, no lifting fragility, portable, sandboxed. This is the target everything else is measured against; if you have source, the rest of Part I doesn't apply.

## I.4 Binary-only, no kernel → elfconv AOT (native → `.wasm`)

The real "pre-translate native code to WASM" path. Runs on V8/in-browser and on WASI runtimes.

**Pipeline:**
```
[Unstripped native Linux binary (AArch64)]
        │  Remill — lifts each machine instruction to LLVM IR
        ▼
   [LLVM bitcode]  +  elfconv runtime (Linux syscall emulation)
        │  Emscripten / wasi-sdk
        ▼
   [WebAssembly .wasm]  → runs on V8/browser or a WASI runtime
```

**Build & run** (documented flow — build the toolchain, then translate):
```bash
git clone https://github.com/yomaytk/elfconv && cd elfconv
docker build . --build-arg ECV_AARCH64=1

# inside the built container (elfconv/bin):
TARGET=aarch64-wasi32 ./exe.sh /path/to/aarch64_binary            # WASI target
TARGET=aarch64-wasm INITWASM=1 ./exe.sh /path/to/aarch64_binary   # browser/V8 bundle (.wasm+.js+.html)
```
*(A prebuilt image may be published under `ghcr.io/yomaytk/elfconv` — confirm the current tag against the repo.)*

**Honest performance** — do not claim "near-native":
- elfconv's published benchmarks (Eratosthenes sieve, LINPACK) measure against the **same program compiled from source directly to WASM**, not native hardware.
- Against that WASM baseline it reaches **~56–82%** depending on runtime (LINPACK 1256 vs 1617 MFLOPS ≈ 78%; 2720 vs 4821 MFLOPS ≈ 56% in a second runtime).
- Because WASM itself runs below native, the **native-relative** slowdown is larger — low-single-digit multiples on compute-bound code, worse on branch/syscall-heavy code.
- Those are the *friendly* cases (tight arithmetic loops). Real workloads with indirect control flow do worse or fail to lift.

**Constraints (all real):**
- **No stripped binaries.** elfconv uses the symbol table to identify functions.
- **Statically-linked only.** No dynamic linking / shared libs.
- **AArch64 only today.** x86-64 under development.
- **Static translation is incomplete.** WASM can only branch to compile-time-determinable targets, so indirect/computed jumps and self-modifying code are the hard ceiling — a given binary may fail to compile or run (work-in-progress).
- **Syscalls are emulated, not real.** The elfconv runtime supports `fork()`/`execve()` (enough for shells / build systems like Bash+BusyBox), but obscure kernel interfaces and full `/proc` fidelity aren't there.

## I.5 Need a kernel → emulation fallback (+ host-level AOT)

When you need a full Linux kernel or an unmodified multi-process container, emulate. **container2wasm** wraps the container with a CPU emulator compiled to WASM: TinyEMU (riscv64) / Bochs (x86_64) by default (interpreter), or **QEMU-Wasm with TCG JIT** via `--to-js` (a hybrid — a TCI interpreter for cold code plus selective compilation of hot blocks to wasm modules, because the browser can't create thousands of modules). Expect **~10x+** off native — this is the tax for kernel fidelity.

Server-side, cut the *host layer's* share with **host-level AOT (Method 1)**:
```bash
c2w --target-arch riscv64 your-container:latest output.wasm   # emulator-in-wasm
wasmedge compile output.wasm output_aot.wasm                  # AOT the emulator → native
wasmedge output_aot.wasm
```
This strips the WASI runtime's own interpret/JIT warm-up of the emulator — but the **guest is still emulated inside**, so you remain ~10x+ off native, just cheaper on the host. It is **not** a browser/V8 technique: V8 compiles wasm internally and won't accept native code (see I.6 for the browser-side equivalent).

## I.6 Artifact distribution & caching over IPFS

**What's cacheable** (content-addressing needs a *deterministic, offline-produced* artifact — which rules out the runtime-JIT per-block modules QEMU-Wasm generates):
1. **elfconv output (`.wasm`)** — deterministic function of (input binary + toolchain); the strong case.
2. **container2wasm static bundle** (emulator core + kernel + rootfs) — cacheable, but it's the *emulator*, not a translation of your app.

**Cache key / value:**
```
key   = hash(input_binary_digest
             ‖ elfconv_version ‖ remill_version
             ‖ target ('aarch64-wasm' | 'aarch64-wasi32')
             ‖ wasm_feature_set (simd, threads, bigint, ...)
             ‖ opt_flags)
value = CID(output.wasm)
```
- Enforce **reproducible builds**, or identical inputs won't dedup to identical CIDs.
- **Content-addressing gives integrity, not provenance.** A CID proves "these bytes match this hash," *not* "this is a faithful translation of my binary." Anyone can publish bytes under a CID, so the `key → CID` mapping must be **signed by a trusted build authority**. For **wasm** artifacts the sandbox caps blast radius — a bad artifact returns wrong results but can't escape.
- **Escalation for distributed *native* (AOT) artifacts — the sharp edge.** Distributing native artifacts (universal-wasm's native section, `.so`, `.cwasm`) moves native code across a trust boundary; when a WasmEdge node extracts and runs that native section it runs **outside the wasm sandbox**, so a poisoned CID is **arbitrary native code execution**. Signing the `key → CID` mapping is **non-negotiable** for the native tier. Pin trust anchors; never resolve native artifacts by CID alone.
- Cache the **`.wasm`**, not any engine's compiled-module bytes (those aren't portable across engine/runtime versions).

**Deployment-time artifact tiering (one build → tier-specific artifacts).** The AOT compile belongs in CI/deploy, not at runtime:
- **Server/edge (non-V8):** `wasmedge compile` / `wasmtime compile` (→ `.cwasm`) → native, no JIT warm-up.
- **One unifying artifact — WasmEdge universal-wasm:** native code embedded in a **custom section** of the `.wasm`; WasmEdge extracts and runs it, V8 and others ignore the section and compile the plain wasm. Single content-addressed file, graceful degradation. *Caveat:* the native section is target-specific (arch/OS); non-matching consumers fall back to the wasm (and use the shared-library output on MacOS to avoid the universal-format bus error).
- **Browser/V8 — deploy-time cache priming (not native injection):** V8 caches its TurboFan output and, on repeat load, *deserializes* it — skipping Liftoff and TurboFan. But caching fires **only** for `compileStreaming` / `instantiateStreaming`, **keys on the resource URL**, requires `Content-Type: application/wasm`, and only for modules **≳128 kB**. **IPFS CIDs are immutable content-addressed URLs — exactly the stable key V8 wants**, so repeat browser loads skip compilation — *provided* the browser fetches through an IPFS **HTTP gateway URL via `compileStreaming`**. Pulling bytes through in-page Helia (`fs.cat`) and calling non-streaming `WebAssembly.compile` **forfeits code caching**. Within a session, compile the `Module` once and share it across Workers.

**Delivery mechanics.** IPFS block chunking (256 kB) is transport-level and orthogonal to WASM: reassemble blocks into one `ReadableStream`, wrap in a `Response` with `application/wasm`, pass to `instantiateStreaming` (compiles one module while downloading). It does **not** consume a directory of chunks as separate compile units (that's module splitting + explicit linking). Helia's `fs.cat()` yields an async iterable, not a `BodyInit` — wrap it in a `ReadableStream` first.

## I.7 Execution-options summary matrix

| Approach | Mechanism | Speed vs native | Kernel? | V8/browser | Cacheable in IPFS |
|---|---|---|---|---|---|
| **Source → wasm32-wasi** | direct compile | ~1.2–2x | no | yes | yes (best) |
| **elfconv** | static binary lift (AOT) | low-single-digit x, workload-dependent | no | yes | yes |
| **container2wasm + WasmEdge AOT** | emulate; AOT the emulator | ~10x+ | yes | **no** (server WASI only) | bundle only |
| **container2wasm `--to-js` (QEMU-Wasm)** | runtime JIT (TCI + selective TCG) | ~10x+ | yes | yes | bundle only |
| **container2wasm default (TinyEMU/Bochs)** | interpreter | worst | yes | yes | bundle only |

**One-line guidance:** have source → compile it; binary-only and no kernel → elfconv; must have a kernel → emulate and accept the tax (AOT the emulator if you're server-side).

---
---

# PART II — The P2P fabric: orchestrating the substrate

## 1. The decision that shapes everything: trust topology

**Problem.** An open, permissionless mesh of consumer devices maximizes free capacity but is adversarial: sybil attacks, nodes that lie about results, and node owners with *physical* access to their hardware (which defeats even TEE attestation). A permissioned/federated mesh gives strong guarantees but caps the "unlimited scale" dream.

**Solutions (ordered):**
1. **Hybrid (recommended).** A *permissioned backbone* of reliable, attestable nodes (enterprise servers, staked operators) handles coordination, sensitive data, native execution, and reduce/aggregation; a *permissionless edge* of volunteer devices handles embarrassingly-parallel, sandboxed, locality-friendly map work. Trust becomes a per-job dial, not a network-wide constant. This is the build.
2. **Permissioned-first.** If enterprise is the first customer, ship federated-only, add the open edge later. Lower risk, slower to the "infinite capacity" story.
3. **Fully open.** Only viable if the workload is inherently verifiable and non-sensitive (deterministic batch compute with redundant validation).

Everything below assumes the hybrid model.

## 2. Architecture — 7 layers

| Layer | Responsibility | Off-the-shelf building block | To build |
|---|---|---|---|
| 7. **Programming model** | Map/reduce + DAG API; compiles to a distributed workflow | Ray-like API; Aqua/AIR choreography as prior art | Graph compiler → placement plan |
| 6. **Scheduling & placement** | Locality-, capability-, trust-aware task placement; no central conductor | — | Decentralized scheduler (§3.4) |
| 5. **Trust & attestation** | Node identity, reputation, TEE attestation, artifact signing, capability tokens | SEV-SNP/TDX/Nitro/CCA + remote attestation; SPKI/object-capabilities (IPVM) | Reputation + verification policy |
| 4. **Data** | Content-addressed storage; locality/pinning policy; mutable-metadata consensus | IPFS/IPLD; IPFS-Cluster + CRDT | Sovereignty pinning policy (§4) |
| 3. **Identity, transport, discovery** | Peer identity, DHT discovery, NAT traversal, secure transport | **libp2p** (Kademlia DHT, DCUtR hole-punch, circuit-relay v2, QUIC, Noise) | Minimal — configure libp2p |
| 2. **Node runtime** | Execute managed (WASM) + native (microVM/TEE) code; resource metering | Wasmtime/WasmEdge/Marine; Firecracker/Kata; wasm code-cache | Node agent, resource governor |
| 1. **Substrate** | Sandboxing, AOT native→WASM, signing, IPFS-cached artifacts | elfconv, container2wasm, WasmEdge AOT | Build pipeline (**Part I**) |

The **substrate layer is Part I** — this fabric is the orchestration, trust, and data layers stacked on top of it.

## 3. Core problems → solutions

### 3.1 Trust: computing on hardware you don't own

**Problem.** Three distinct sub-problems, often conflated:
- *Data confidentiality* — will the node owner see the data?
- *Code IP* — will the node owner reverse-engineer the processing code?
- *Result integrity* — can the requester trust a result computed elsewhere?

Data-locality **eliminates data confidentiality for the data owner** (user data never leaves the user's node; enterprise data never leaves the premises). What remains is code IP and result integrity.

**Solutions (ordered by strength / cost):**
1. **Deterministic WASM + redundant execution + result comparison (N-version / quorum).** Cheap, no special hardware; the standard integrity mechanism for decentralized compute (Bacalhau uses deterministic WASM precisely to unlock this). Default for integrity. Cost: 2–3× redundant compute. Does *not* protect confidentiality.
2. **TEEs / confidential VMs with remote attestation (SEV-SNP, TDX, AWS Nitro, Arm CCA).** Protect code + data from the host; the requester attests a node *before* dispatching sensitive work. Strong on datacenter/enterprise nodes → put sensitive + native jobs here. Cost: hardware dependency, ~single-digit % overhead, trust the silicon vendor.
3. **Cryptographic proofs of computation (zk / proof-carrying / on-chain proofs).** Strongest integrity without redundancy (Fluence posts provider proofs on-chain). Cost: high, limited to provable computations today.

**Honest limit to design around:** TEE threat models assume the attacker can't *physically* touch the server. A consumer-device owner with physical custody can mount side-channel/physical attacks and defeat attestation. → Sensitive and native work runs on the permissioned backbone; the volunteer edge only gets sandboxed, redundantly-verified, non-sensitive work.

**Emergent defense-in-depth — and its honest scope.** The system's natural dynamism (placement shifting with load, network, and DHT cache eviction) plus layered crypto (stable identity keys, rotating session keys, signatures, capability chains) forms a **Moving Target Defense** over cryptographic access control: reconnaissance goes stale, no single broken component grants access, and — with sovereignty, encryption, and secure aggregation — intercepting any one flow reveals little. Blast radius per compromised node is small. **But this raises attacker cost; it is not an impossibility proof.** Concretely: (1) long-term identity keys are a *static* target — exfiltration defeats that factor independently of placement/timing; (2) sovereign data-at-rest sits at a *known, fixed* location (the owner's device) — its defense is encryption-at-rest + endpoint security, not uncertainty; (3) in an open pool an attacker need not *predict* placement — it can *be* a candidate node and let work come to it; (4) the factors fall independently and sequentially via different vectors, not by simultaneous guess, so "multiply three small probabilities" does not bind a real adversary. Load-bearing guarantees therefore remain redundant-execution verification, TEE attestation, trust-tiering, secure aggregation, and short-lived credentials — stated against an explicit threat model (attacker controls up to k of n nodes, ± TEE break, ± global passive network view). Treat moving-target uncertainty as valuable depth, not the foundation.

### 3.2 Native code on untrusted, heterogeneous peers

**Problem.** Native code is (a) architecture-specific (ARM phone vs. x86 server vs. RISC-V) and (b) unsandboxed → arbitrary native on a random peer is remote code execution.

**Solutions (ordered):**
1. **AOT-translate native → WASM at publish time (elfconv path, Part I.4).** Turns native into portable, sandboxed managed code that runs anywhere in the mesh; solves arch-portability and isolation at once. Default. Ceiling: lifting fragility, low-single-digit-x overhead (Part I.4 for honest numbers).
2. **Native inside a Firecracker/Kata microVM or a TEE, backbone nodes only.** When true native performance/semantics are required. Strong isolation, but arch-specific builds and heavier footprint.
3. **Native only on permissioned enterprise nodes** you control end-to-end.
4. **seccomp/namespace sandbox** as a weaker fallback for semi-trusted nodes.

**Mandatory:** sign the code → CID mapping with a trusted build authority (Part I.6). Distributing native artifacts via content addressing moves native code across a trust boundary; a CID proves integrity, not provenance. Unsigned native-by-CID = an RCE distribution channel.

### 3.3 "Never experience limits on capacity" — the honest ceiling

**Problem.** Usable capacity ≠ raw aggregate capacity, for concrete reasons:
- **Locality pinning** — a task bound to user A's data can only run where that data is (A's node, or its replicas). Most of the fleet is ineligible for any given task.
- **Coordination overhead — scoped, not global.** In a P2P/Kademlia design each requestor coordinates its *own* jobs, so there is no shared coordinator whose coherence cost (the USL β term) grows with the whole fleet. Aggregate throughput scales *with* the number of independent requestors — the correct scaling axis. Per-requestor coordination converts a potential coherence-driven **collapse** into, at worst, a contention-driven **plateau** on shared nodes/network (α, which flattens but doesn't retrograde). Residual limits are *intra-job* (a single massive graph still concentrates coordination on its requestor) and node/network contention — see solutions 7–8.
- **Churn** — consumer nodes leave mid-task; in-flight work is lost and redone.
- **Stragglers** — total latency is set by the slowest participating node.
- **Bottleneck migration** — past a scale, the limit is network/shuffle bandwidth, not FLOPs.
- **Heterogeneity** — a phone is not a server; naive fan-out wastes the fast nodes waiting on the slow ones.
- **Verification tax** — redundant execution multiplies the real work by 2–3×.

**Reframe (the achievable target):** not *unlimited*, but **capacity that grows super-linearly with the user base for workload classes that fit** — data-parallel, locality-friendly, verifiable.

**Solutions that push the ceiling:**
1. **Speculative / backup execution** for stragglers — launch duplicates of slow tasks, take the first to finish.
2. **Work-stealing + capability-aware placement** — fast/idle nodes pull work; match task weight to node class.
3. **Checkpointing + content-addressed intermediates** — churn-resilience; a departed node's partial output is re-fetchable/re-computable, and identical intermediates dedup.
4. **Hierarchical tree-reduce + combiners** — the fix for the all-to-all shuffle that otherwise kills P2P map/reduce (§3.5).
5. **Admission control / backpressure** — protect the network from committing to graphs it can't drain.
6. **Honest capacity accounting** — schedule against *usable* capacity (eligible, live, trusted nodes), not raw totals.
7. **Power-of-d-choices placement** — each requestor samples d random candidate nodes (via the DHT) and places on the least-loaded, with node-side backpressure. Provably good load distribution using only local info — no global coordinator — and avoids the herd effect of many requestors independently picking the same "best" nodes. (The DHT gives *discovery*, not live load; layer a liveness signal by probing the d candidates or via gossip.)
8. **Delegated tree-coordination for single large jobs** — the requestor spawns a control-plane tree of sub-coordinators on backbone nodes (mirroring the tree-reduce data plane) and checkpoints coordinator state, so one giant graph doesn't make a single (possibly consumer-device) requestor its bottleneck or SPOF. Requestor-as-coordinator for small/interactive jobs; delegated tree for massive ones.

### 3.4 Decentralized scheduling & placement

**Problem.** Place tasks across the mesh respecting data locality, node capability, trust level, and load — *without* a central scheduler (which would recreate the cloud bottleneck).

**Substrate — one Kademlia keyspace, typed keys for everything.** Data, services, nodes, and groups all get keys in a single DHT keyspace, namespaced by type (multicodec-style prefix): `hash(data)` = CID, `hash(service)`, node ID = `hash(pubkey)`, `hash(group/job)`. The DHT is universal rendezvous + resolution (`FIND_NODE`, `GET_PROVIDERS`). Node IDs are **self-certifying** (derived from public keys), so identity = address = key, and any node can be authenticated by challenge-response against its ID — no CA for identity.

**The DHT stores arbitrary key/value, so it resolves most schedulable state directly.** IPFS provider records and BitTorrent's DHT (BEP-44) let a node register/query any hash, so capability, architecture, TEE-presence, and trust-tier are discoverable in one query — e.g. `GET_PROVIDERS(data CID)` ∩ `GET_PROVIDERS(hash("gpu"))` ∩ `GET_PROVIDERS(hash("arch:wasm"))`. Make trust-relevant records **self-verifying**: store a *signed* credential as the value (an SEV-SNP quote signed by an attestation authority; a tier-2 grant signed by the backbone), so a claim is trusted from the record itself — a bare DHT claim can be lied about, a signed one cannot.

Only two facts aren't settled by a DHT read, and neither forces a separate discovery round-trip:
- **Live load** (volatile) — publish coarse load as a short-TTL DHT value, *or* omit it and let **power-of-d + node-side backpressure** absorb staleness (randomized selection breaks the herd; an over-committed node rejects and the requestor re-picks). Tradeoff: DHT write-amplification vs. coarser placement. Both one-phase-friendly.
- **Attestation freshness** (time-bound) — for highest-assurance jobs, refresh the quote inside the authorization/attestation handshake already run to dispatch (steps 3–4), not as an extra scheduling step.

So discovery is effectively **one-phase**; a lightweight probe remains an optional knob for tight bin-packing, not a requirement.

**Placement flow (coordinator-free):**
1. **Discover (single DHT query).** `GET_PROVIDERS(data CID)` ∩ providers of the required capability/trust keys — capability records and *signed* trust records both live in the DHT. For sovereignty-pinned data the providers *are* the owner's node(s) → discovery is direct.
2. **Select (power-of-d).** Choose among candidates by least coarse-load (DHT value or light probe); backpressure absorbs staleness. No mandatory round-trip.
3. **Authorize (capability chain).** Present a token signed by the data owner — SPKI/UCAN object-capability, delegatable, expiry-scoped; the node verifies the chain back to the owner's key before running. Highest-assurance jobs refresh the TEE attestation quote here. IPVM uses exactly SPKI + object-capabilities.
4. **Execute** → content-addressed result → verify (redundancy / proof).
5. **Coordinate** multi-task graphs by rendezvous at the job's group key; the sub-coordinator tree registers there, so participants find each other with no central registry.

**Selection strategies (the "how to choose" in step 2), ordered:** power-of-d probe (default, coordinator-free); market/auction (incentive alignment, more latency); locality-first greedy (send code to the data, nearest replica fallback).

**Security foundation (asymmetric crypto, no CA):**
- **Identity** — node ID = `hash(pubkey)`, self-certifying, challenge-response verifiable.
- **Integrity** — CIDs for code/data/intermediates; trust the hash, not the source.
- **Authorization** — SPKI/UCAN capability chains rooted at each owner's key: decentralized, delegatable, expiry-scoped.
- **Confidentiality** — libp2p Noise/TLS channels (node keys do double duty); owner-key encryption for at-rest replicas so they stay ciphertext to non-grantees (pairs with §3.5 secure-aggregation).

**Residual limits (with fixes):**
- **The DHT is attackable.** Eclipse/sybil can poison a lookup and misroute a job to attacker nodes — worse when the DHT drives scheduling than when it only serves content. Fix: **S/Kademlia** (pubkey-derived IDs + PoW/stake for sybil cost, disjoint-path lookups to cross-check); certificate-bound node IDs on the permissioned backbone largely close it.
- **Stale records under churn.** A departed node still shows as provider until TTL. Fix: short TTL for volatile facts (load), long TTL for durable ones (CIDs, node keys); records are hints, confirm liveness on connect.
- **Key management / revocation** — the classic decentralized weak point (no central CRL). Fix: prefer short-lived capabilities so expiry replaces revocation (UCAN model); gossip/DHT-publish revocation lists for the rest; bind identity to a stable DID pointing at the current rotating key so rotation doesn't break the ID-from-key link.

**Placement cost model:** move whichever is smaller — code or data — subject to locality/trust constraints. Sovereignty constraints (unmovable data) override the size heuristic and make placement degenerate-but-trivial (the task goes to the owner).

### 3.5 Map is free; the real question is whether the reduce decomposes

**Framing.** Data is already partitioned across owner nodes (user data per device, enterprise data on-prem), so **map placement = data placement**: each owner runs the map over its own local data with zero map-side movement and zero map scheduling. Only *partial outputs* cross the network — raw data never leaves the owner (sovereignty baked into execution). The classic all-to-all shuffle therefore does **not** appear by default; it appears only when the reduction can't be decomposed. What crosses the wire — a tree of partials or an all-to-all — is decided entirely by whether the reduce combines.

**Solutions (ordered by workload coverage):**
1. **Decomposable reduce (associative + commutative + combiner) — the default.** Each owner computes a local partial aggregate (map + local combine); partials merge up a **hierarchical tree** of backbone nodes. No shuffle; O(N log N) links; combiners shrink partials before they move. Covers most real work — counts, sums, averages, GROUP BY aggregates, top-K, gradient aggregation for ML.
2. **Mergeable sketches for holistic-but-approximate ops.** Distinct-count → HyperLogLog; quantiles/median → t-digest/KLL; heavy-hitters → Count-Min. Makes "needs all values" queries tree-reducible on tiny partials, trading exactness for a collapsed shuffle.
3. **Key-partitioned shuffle — holistic *exact* ops only** (exact sort, exact cross-keyspace join, exact median). Co-locate by key, but minimize it: locality-aware key-range assignment to well-connected backbone nodes, combiner pre-aggregation, content-addressed intermediates for dedup/resume. The expensive escape hatch; steer workloads to (1)/(2) when possible.
4. **Predicate/aggregation pushdown to the owner node.** Since map is local, push filters, projections, and partial aggregation as deep as possible so the least data leaves the owner — compute-to-data taken to its logical end, and another sovereignty win.

**Unlock — privacy-preserving cross-owner analytics.** Because only aggregated partials leave the owner, layer **secure aggregation** (the federated-learning technique: the tree learns only the combined result, never any single owner's partial) and/or **differential privacy** (release aggregates only over enough owners, with noise). Turns "run massive map/reduce over everyone's data" into "…without any raw data *or* per-owner partial leaking in the clear" — a differentiated capability that falls out of the data-locality assumption for free.

**Residual limits (with fixes):**
- **Skew.** Owner data volumes vary enormously (enterprise TBs vs. user KBs), and sovereignty forbids rebalancing one owner's data onto other owners' nodes — so the largest owner's local map bounds the phase. Fix: parallelize *within* that owner's own node(s)/replicas; run big-data owners on their own backbone-class hardware; speculation scoped to the owner's node set, never across owners.
- **Availability.** An offline owner is a missing contribution that can't be recomputed elsewhere without a replica. Fix: define cross-owner queries as best-effort over *live* owners with a coverage report, or keep owner-authorized encrypted replicas where availability matters.

### 3.6 Churn & reliability

**Problem.** Nodes are transient; the fleet's composition changes continuously.

**Solutions:** speculative execution (§3.3); checkpoint partial state to content-addressed storage; replicate critical data (sovereignty-permitting) for availability; lease-based task ownership with re-dispatch on lease expiry; keep the *durable* coordination state on the backbone, not the edge.

### 3.7 Connectivity (NAT/firewalls)

**Problem.** Most consumer nodes are behind NAT; naive P2P can't dial them.

**Solution:** libp2p's stack — AutoNAT for reachability detection, **DCUtR** hole-punching, **circuit-relay v2** for un-punchable peers, QUIC for connection migration, Noise for transport security. Accept that relay nodes reintroduce mild centralization; run them on the backbone.

### 3.8 Incentives & sybil resistance

**Problem.** Why contribute compute, and how to stop one entity spinning up many fake nodes to dominate scheduling/voting?

**Solutions (ordered):**
1. **Permissioning + staking for the backbone** — sybil resistance where it matters (coordination, verification quorums). Recommended baseline.
2. **Credit/metering + payments for the edge** — meter contributed compute, settle in credits/tokens (Golem/Filecoin pattern); enterprises pay for guaranteed backbone capacity.
3. **Reputation** — weight scheduling and verification votes by a node's verified track record; slashes sybil influence on the open edge.

### 3.9 Node identity & enrollment — the provider-signed client

The node runs inside a provider-distributed app. Signing + provisioning at distribution time gives the design a concrete trust root and hardens membership — within the limits of running on hardware the user controls.

**What it cleanly provides:**
- **Software integrity at install.** Code signing proves the node binary is authentic and unmodified on disk — peers and provider know it's the real client, absent active tampering.
- **A PKI / enrollment root.** The app ships with the provider's trust anchors (public keys) and enrolls for a provider-signed identity certificate. This is the concrete root for the self-verifying DHT records and capability chains in §3.4 — nodes verify each other's provider-signed certs offline, no live CA.
- **Sybil resistance (strengthens §3.8).** Provider-gated enrollment — rate-limited, per-install, optionally tied to identity/payment — makes mass fake-node creation costly, hardening DHT eclipse/sybil resistance and the placement pool. Membership becomes *permissioned-at-install* even for edge nodes, so candidates aren't anonymous.

**Honest limit (same root cause as the TEE limit).** Code signing proves *origin and on-disk integrity*, not *runtime integrity on hardware the owner controls*. A determined node-owner can debug, patch in memory, MITM their own traffic, or extract anything embedded in the binary. So durable embedded secrets are extractable, and a tampered build can still present valid credentials. This raises the bar and supplies identity; it does **not** make a client node trustworthy for confidential third-party work — that still needs TEE/backbone + result verification (§3.1). Consistent with sovereignty: client nodes are trusted for *their own* data and for sandboxed/verified public work.

**Refinement — don't ship durable secrets; provision per-install, hardware-backed:**
1. Generate the node keypair **on-device at first run** in the OS secure keystore / TEE / TPM (Apple Secure Enclave, Android Keystore/StrongBox, desktop TPM) so the private key is non-extractable even by the owner where the platform supports it. The provider signs the *public* key into the certificate.
2. Ship only **trust anchors + a short-lived, single-use enrollment token** in the binary — no durable credential. The lasting identity is minted during enrollment against the on-device key; one compromised install leaks no network-wide secret.
3. For higher assurance, add **runtime platform attestation** (Play Integrity / Apple App Attest / TPM quotes) so the node periodically proves it's the genuine unmodified app on genuine hardware — upgrading "signed at install" to "verified at runtime" for the jobs that need it.

**Two keys, two jobs.** Separate the *node identity* key from the *user* key:
- **Node identity** (above) — hardware-backed, provider-signed, usable *autonomously* so the node keeps answering DHT lookups and running verified public work while the user is away. Gated by hardware, not live passphrase entry.
- **User authentication / data-encryption key** — a keypair derived on-device from *user secret (passphrase) + a non-extractable hardware key*, whose private half **never crosses the app boundary**: it signs challenges and decrypts the user's own data in place; only signatures cross the wire, never the key. Removes the at-rest stored-key target, resists network/server breach (zero-knowledge), and is two-factor (know + have). The right guard for the user's own data and high-value actions.

Refinements so the user key is robust, not just obscured:
- **Non-extractable hardware key as the device factor**, not a readable "hardware fingerprint." A fingerprint is device-*binding* but not *secret* (local malware reads it too) and *unstable* (hardware/OS change locks the user out). Add a recovery path (recovery code / social recovery) for device loss.
- **Derive into and operate inside the enclave** where available, so the private key never enters app-readable memory; otherwise use locked, zeroized, non-swappable memory and suppress crash dumps. Derivation moves the risk from at-rest to at-use — the enclave closes that gap.
- **Combine factors** so neither alone suffices: the correct passphrase without the device's hardware key can't reconstruct the key (defeats offline brute-force), nor the device without the passphrase. Use a memory-hard KDF (Argon2id).

## 4. Data sovereignty & placement model

- **User data** → pinned to the user's own node (the node running on their device). Processing code is delivered to it; results leave, raw data does not. Optional encrypted replicas on the backbone for availability, under the user's key.
- **Enterprise data** → pinned on-premises; third-party processing code runs there in a TEE/microVM with attestation, so the enterprise runs untrusted code without exposing data and the code owner gets integrity guarantees.
- **Shared/public data** → content-addressed, replicated freely across the mesh; the ideal fuel for the permissionless edge.
- **Intermediate results** → content-addressed; cache, dedup, and resume for free.

Sovereignty label travels with the data and is a hard scheduling constraint: *unmovable* data forces code-to-data; it can never be silently relocated to "balance load."

## 5. Proven vs. novel — risk map

| Capability | Prior art (proven) | Novel delta |
|---|---|---|
| Compute-to-data over content addressing | Bacalhau, IPVM/Homestar, Ocean C2D | Sovereignty-by-placement as a first-class constraint |
| Decentralized task-graph choreography | Fluence Aqua/AIR/AquaVM | Map/reduce API on top; backbone-anchored reduce |
| Sandboxed WASM on peers | Bacalhau, Fluence Marine, wasmCloud | Unified with *safely-sandboxed native* |
| Native → portable safe code | elfconv, container2wasm | Making it the default native path in a mesh |
| Trust on untrusted hosts | SEV-SNP/TDX/Nitro/CCA + attestation | Per-job trust dial across hybrid topology |
| Incentives / marketplace | Golem, iExec, Akash | Hybrid staked-backbone + metered-edge |

**Where the genuine research risk lives:** (1) decentralized scheduling that stays efficient under churn + locality + trust constraints simultaneously; (2) making tree-reduce robust when the aggregation backbone itself churns; (3) keeping the verification tax affordable at scale. Everything else is integration of proven parts.

## 6. Recommended first build (MVP slice)

1. **Node agent** = WASM runtime (Wasmtime/WasmEdge) + libp2p + IPFS store. Managed code only, sandboxed.
2. **One workload class**: embarrassingly-parallel map over content-addressed data, deterministic WASM, redundant-execution verification. Proves capacity-scales-with-nodes without needing shuffle or TEEs.
3. **Sovereignty pinning**: data stays on its owner node; code ships to it.
4. **Then** add: tree-reduce (real map/reduce) → TEE backbone (sensitive + native) → AOT native→WASM, Part I (the native story) → incentives/market (the open edge).

Sequence deliberately front-loads the parts that de-risk the core thesis (capacity scaling, sovereignty) before the parts that add reach (native, open edge, shuffle-heavy graphs).
