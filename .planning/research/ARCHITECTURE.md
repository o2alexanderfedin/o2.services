# Architecture Research

**Domain:** P2P distributed compute fabric (TypeScript + WASM node agent, browser + Node.js + embedded)
**Researched:** 2026-07-24
**Confidence:** MEDIUM-HIGH — platform mechanics (libp2p, Helia, browser APIs, WASM determinism) verified against Context7 / official docs / live npm registry; the composition (tree-reduce under churn, sovereignty-constrained placement) is synthesized from prior art and carries genuine design risk, as `PROJECT.md` §5 already states.

---

## 0. The One Constraint That Shapes Everything Else

> "Node agent runs identically in browser, Node.js, and embedded contexts" — and *embedded* means **inside somebody else's web page**.

Three architectural consequences fall out of that single line, and they cascade into every other decision:

1. **No cross-origin isolation.** Embedding into a third-party host page means you cannot demand `COOP: same-origin` + `COEP: require-corp` — those headers break the host's own cross-origin resources. **Therefore: no `SharedArrayBuffer`, therefore no WASM `threads`.** (Which is fine — see §4, WASM threads are a determinism hazard anyway.)
2. **No control of the document.** The agent cannot assume it may register a service worker, set headers, or own the page lifecycle. Everything platform-shaped arrives by injection.
3. **No main-thread work.** A library that janks the host page gets removed. Task execution lives in Web Workers, unconditionally.

Everything below is downstream of this. Take it as the load-bearing premise.

---

## 1. Standard Architecture

### 1.1 System Overview — the hexagon

```
┌────────────────────────────────────────────────────────────────────────────┐
│  DRIVING ADAPTERS (inbound)                                                │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ ┌────────────────────────┐  │
│  │  CLI       │ │  Demo web  │ │  Host-app   │ │  Inbound wire handler  │  │
│  │  (Node)    │ │  app       │ │  embed API  │ │  /o2/*  protocols      │  │
│  └─────┬──────┘ └─────┬──────┘ └──────┬──────┘ └───────────┬────────────┘  │
└────────┼──────────────┼───────────────┼───────────────────┼───────────────┘
         │              │               │                   │
         ▼              ▼               ▼                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  KERNEL  @o2/core   —  pure TypeScript. Zero platform imports.             │
│                        Zero libp2p imports. Zero I/O.                      │
│                                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ JobCoordinator│ │  Placer      │  │  ReduceTree  │  │  Verifier     │   │
│  │ (requestor)  │  │ (power-of-d) │  │ (HRW + lease)│  │ (R-of-Q agree)│   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘   │
│         │                 │                 │                  │           │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐  ┌───────┴───────┐   │
│  │  Executor    │  │  Governor    │  │ Sovereignty  │  │  CapAuthz     │   │
│  │ (task→receipt)│ │ (admission/  │  │  Policy      │  │  (UCAN chain) │   │
│  │              │  │  backpressure)│ │  (hard cons.)│  │               │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘   │
│         │                 │                 │                  │           │
│  ─ ─ ─ ─┴─ ─ ─ ─ ─ ─ ─ ─ ─┴─ ─ ─ ─ PORTS ─ ─┴─ ─ ─ ─ ─ ─ ─ ─ ─ ┴─ ─ ─ ─ ─  │
│   Wasm   Blockstore  Datastore  Network  Discovery  Keystore  Clock  Rand  │
└────────────────────────────────────────────────────────────────────────────┘
         │              │               │                   │
         ▼              ▼               ▼                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  DRIVEN ADAPTERS (outbound) — the ONLY platform-aware code in the system   │
│                                                                            │
│   browser                    node                     shared/either        │
│  ┌──────────────────┐      ┌──────────────────┐     ┌───────────────────┐  │
│  │ WorkerPoolRuntime│      │ WorkerThreads    │     │ Libp2pNetwork     │  │
│  │ blockstore-idb   │      │   Runtime        │     │ Libp2pDiscovery   │  │
│  │ datastore-idb    │      │ blockstore-fs    │     │ MemoryBlockstore  │  │
│  │ WebCryptoKeystore│      │ datastore-level  │     │ LoopbackNetwork   │  │
│  │ PageLifecycle    │      │ NodeKeystore     │     │ (tests)           │  │
│  └──────────────────┘      └──────────────────┘     └───────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

**The dependency rule, stated once:** arrows point inward. `@o2/core` imports only its own domain types. Adapters import `@o2/core`; `@o2/core` never imports an adapter. Composition happens in exactly two files (`default.browser.ts`, `default.node.ts`) plus test harnesses.

### 1.2 Component Responsibilities

| Component | Owns | Does NOT own | Prior art |
|---|---|---|---|
| **Executor** | Turn one `TaskSpec` into one signed `Receipt`. Resolve inputs by CID, run the module under fuel/memory/wallclock limits, content-address outputs. | Placement, verification, networking. | Bacalhau *Executor*; Homestar `homestar-wasm` |
| **Governor** | This node's admission control. Answers `canAccept(task) → accept | reject(reason)`. Tracks live leases, CPU/mem budget, and the **advertised capacity** number. Drops advertised capacity to 0 on tab freeze. | What to run. | Bacalhau *BiddingStrategy* |
| **Placer** | Given constraints + candidate set, choose R distinct executors. Power-of-d sampling, anti-affinity, retry on reject. | Discovery (asks `DiscoveryPort`), execution. | §3.4 of design doc; Mitzenmacher power-of-d |
| **JobCoordinator** | Requestor role. Shard → place → dispatch → collect → verify → reduce → publish. Owns leases, capability minting, and the final verdict. | Doing any combine itself (delegates). | Bacalhau *Orchestrator/Requester* |
| **ReduceTree** | Derive the combine tree from the sorted partial-CID list; assign internal nodes by rendezvous hashing; hold child leases; re-dispatch a combine when a lease expires. | Merge semantics (that's the task's `combine` module). | §3.5; convergecast repair literature |
| **Verifier** | Compare R receipts for the same `taskCid` over `(task, outputs)` only. Emit `Agreed(cid)` / `Disputed`. | Re-execution policy (asks Coordinator). | Bacalhau deterministic-WASM verification |
| **SovereigntyPolicy** | Evaluate the hard constraint. `mayMove(blockCid) → bool`; `mustRunAt(blockCid) → PeerId[]`. Vetoes any placement that would relocate unmovable data. | Soft cost heuristics. | §4 of design doc (the novel delta) |
| **CapAuthz** | Verify a UCAN/SPKI chain back to the data owner's key before the Executor is allowed to touch a sovereign input. | Identity (asks `KeystorePort`). | IPVM/UCAN Invocation |
| **Wire codecs** (`@o2/wire`) | Protocol IDs, dag-cbor schemas, length-prefixed framing. Pure, no I/O. | Transport. | — |

**Confidence: HIGH** on the Bacalhau/Homestar mapping (verified against official docs). **MEDIUM** on the exact `ReduceTree` design — it is a synthesis, not a copy of a shipped system.

---

## 2. Platform Boundary Strategy (browser vs Node) — concrete

This is the requirement most likely to be quietly violated in month 3, so the mechanism must be *enforced by tooling*, not by discipline.

### 2.1 Three mechanisms, ranked

**1. Constructor injection — the default, covers ~95% of cases.**

```typescript
// @o2/core/src/ports/index.ts  — interfaces only, no implementations
export interface BlockstorePort {
  get(cid: CID, opts?: AbortOptions): Promise<Uint8Array>
  put(cid: CID, block: Uint8Array, opts?: AbortOptions): Promise<void>
  has(cid: CID): Promise<boolean>
}

export interface WasmRuntimePort {
  compile(bytes: Uint8Array, profile: WasmProfile): Promise<CompiledModule>
  run(mod: CompiledModule, io: TaskIo, limits: Limits, signal: AbortSignal): Promise<RunOutcome>
  readonly concurrency: number      // pool size — browser: hardwareConcurrency-1, node: cpus().length
}

export interface NetworkPort {
  readonly self: PeerId
  handle(protocol: string, h: StreamHandler): Promise<void>
  dial(peer: PeerId, protocol: string, signal: AbortSignal): Promise<DuplexStream>
  connectedPeers(): PeerId[]
}

export interface LifecyclePort {                  // browser reality leaking in, deliberately
  onSuspend(cb: () => void): void                 // freeze / pagehide / SIGTERM
  onResume(cb: () => void): void
  readonly throttled: boolean                     // background tab → timers ≥1min
}
```

```typescript
// @o2/core/src/node.ts — the kernel factory. No environment sniffing anywhere.
export function createNode(ports: Ports, config: NodeConfig): O2Node { /* ... */ }
```

**2. `exports` conditional map + `.browser.ts` siblings — for composition roots ONLY.**

This is exactly what js-libp2p does. Verified from the live `libp2p@3.3.6` package.json:

```jsonc
"exports": {
  "./user-agent": {
    "types":   "./dist/src/user-agent.d.ts",
    "browser": "./dist/src/user-agent.browser.js",
    "import":  "./dist/src/user-agent.js",
    "module-sync": "./dist/src/user-agent.js"
  }
}
```

Note how *few* such entries js-libp2p has — one, for a trivial string. Adopt the same discipline: your `.browser.ts` files should be countable on one hand and contain **wiring only**.

```jsonc
// @o2/node-agent/package.json
"exports": {
  ".": {
    "types":   "./dist/src/index.d.ts",
    "browser": "./dist/src/index.browser.js",   // wires idb + worker-pool + webrtc
    "import":  "./dist/src/index.js",           // wires fs + worker_threads + tcp
    "module-sync": "./dist/src/index.js"
  },
  "./worker": {                                  // the executor worker entry, see §6.1
    "types": "./dist/src/worker.d.ts",
    "import": "./dist/src/worker.js"
  }
}
```

**3. `typeof window !== 'undefined'` inside the kernel — banned.** It defeats tree-shaking (both branches ship), it is wrong in a Web Worker (`window` undefined, but you *are* in a browser), wrong under SSR, and it makes tests lie about which path ran. Add an ESLint `no-restricted-globals` rule for `window`, `document`, `process`, `navigator`, `Buffer`, `__dirname` scoped to `packages/core/**` and `packages/wire/**`.

### 2.2 The enforcement mechanism: one test suite, three targets

js-libp2p and Helia both run the *identical* suite across environments. Verified from their live package.json scripts:

```jsonc
"test:node":             "aegir test -t node --cov",
"test:chrome":           "aegir test -t browser --cov",
"test:chrome-webworker": "aegir test -t webworker",
"test:firefox":          "aegir test -t browser -- --browser firefox",
"test:electron-main":    "aegir test -t electron-main"
```

**Adopt this verbatim.** It is the only thing that makes "one codebase, three targets" a fact rather than an aspiration — and the `webworker` target is the one that catches `window`-sniffing. `aegir@48.1.2` is current and is the toolchain the whole IPFS/libp2p ecosystem uses, so its browser-bundling behaviour matches your dependencies' expectations. (If you prefer `vitest@4.1.10` + `@vitest/browser`, that also works — but you inherit the job of matching aegir's ESM/browser-field resolution yourself.)

### 2.3 Package boundaries beat folder boundaries

Physical packages make the dependency rule mechanically checkable — `@o2/core`'s package.json simply does not list `@o2/adapter-blockstore-idb`, and `aegir dep-check` fails the build on an undeclared import. Folder conventions inside one package rely on review; package boundaries rely on the resolver.

---

## 3. Recommended Project Structure

```
packages/
├── core/                          # THE HEXAGON. Pure. No I/O, no libp2p, no platform.
│   ├── src/domain/                #   TaskSpec, Receipt, JobSpec, JobState, Verdict, Lease
│   ├── src/ports/                 #   interfaces ONLY — Blockstore, Wasm, Network, Discovery,
│   │                              #   Datastore, Keystore, Clock, Random, Lifecycle, Telemetry
│   ├── src/executor/              #   TaskSpec -> Receipt
│   ├── src/governor/              #   admission control, capacity advertisement, leases
│   ├── src/placer/                #   power-of-d, anti-affinity, constraint filtering
│   ├── src/coordinator/           #   job lifecycle state machine
│   ├── src/reduce/                #   tree derivation (HRW), combine dispatch, repair
│   ├── src/verify/                #   receipt comparison, quorum, dispute
│   └── src/sovereignty/           #   labels, mayMove(), mustRunAt()
├── wire/                          # Protocol IDs + dag-cbor schemas + framing. Pure.
├── adapter-libp2p/                # NetworkPort + DiscoveryPort over js-libp2p.
│   └── src/service.ts             #   also exposes the kernel AS a libp2p service (see §3.1)
├── adapter-blockstore-memory/     # tests + ephemeral
├── adapter-blockstore-idb/        # browser        (blockstore-idb@4.0.1, datastore-idb@5.0.1)
├── adapter-blockstore-fs/         # node           (blockstore-fs@4.0.1, datastore-level@13.0.1)
├── adapter-runtime-browser/       # Worker pool + V8 WebAssembly + narrow host ABI
│   ├── src/pool.ts
│   └── src/worker.ts              #   separate entry point — see §6.1
├── adapter-runtime-node/          # worker_threads + V8 WebAssembly + same host ABI
├── adapter-keystore-browser/      # non-extractable CryptoKey in IndexedDB
├── adapter-keystore-node/         # file / OS keychain / TPM later
├── node-agent/                    # COMPOSITION ROOTS. index.ts + index.browser.ts. Nothing else.
├── relay/                         # NODE ONLY. circuit-relay-v2 server + kad-dht server +
│                                  # rendezvous. Must never be reachable from browser bundles.
├── cli/                           # NODE ONLY
├── demo-web/                      # the public demo app (built always, deployed on a separate gate)
└── bench/                         # throughput-vs-node-count harness
tools/
└── aot/                           # elfconv Docker pipeline. C++/LLVM, not TypeScript. Build-time.
```

### 3.1 Reuse js-libp2p's DI container — do not build your own

**Verified (Context7, `js-libp2p/doc/SERVICES.md`):** js-libp2p already ships a composition-root with lifecycle hooks, declared capabilities, and declared dependencies:

```typescript
import { serviceCapabilities, serviceDependencies } from '@libp2p/interface'
import type { Startable } from '@libp2p/interface'

class O2Service implements Startable {
  readonly [Symbol.toStringTag] = '@o2/compute'
  readonly [serviceCapabilities]: string[] = ['@o2/compute']
  readonly [serviceDependencies]: string[] = ['@libp2p/identify']

  constructor (private components: { registrar: Registrar, /* ... */ }) {}

  async start (): Promise<void> { /* register /o2/* handlers, start Governor */ }
  async stop  (): Promise<void> { /* surrender leases, unregister */ }
  // also: beforeStart / afterStart / beforeStop / afterStop
}
```

`createLibp2p({ services: { o2: o2Service() } })` throws at construction time if `identify` is missing. That is real, free, typed dependency checking.

**The opinionated call:** put the kernel in `@o2/core` (libp2p-free), and let `@o2/adapter-libp2p` expose a thin `o2Service()` that *adapts* the kernel into a libp2p service. You get idiomatic libp2p integration AND a kernel that a `LoopbackNetwork` can drive in a unit test with no sockets. Building the kernel *as* a libp2p service directly would be faster on day 1 and would cost you the entire test story and the embedded story.

---

## 4. Task Execution Model

### 4.1 What the prior art actually does

| System | Task unit | Input binding | Output binding | Verification hook |
|---|---|---|---|---|
| **Bacalhau** | `SpecConfig{Type, Params}`; WASM engine takes `EntryModule: InputSource`, `ImportModules: InputSource[]`, `Entrypoint`, `Parameters`, `EnvironmentVariables` | *Storage providers* mount an `InputSource` (S3/IPFS/local) into the executor's view — POSIX FS or library call | *Publisher* uploads final results to IPFS/S3 | "deterministic WASM" is the stated reason for choosing WASM; redundant execution + comparison |
| **IPVM / Homestar** | UCAN **Invocation**; a **Task** is *"the subset of Invocation fields that uniquely determine the work to be performed"* | IPLD ↔ WIT translation layer; `Ipld::Link` (a CID) maps to/from a WIT `string` | Result is a **Receipt**, itself content-addressed by CID | Receipts cached; re-posting a workflow *replays receipts without redoing work* |
| **Fluence** | A **particle** = data + AIR script + metadata; AquaVM is *"a pure state transition function"* | Data travels *with* the particle | New particle state | Purity of the transition function |

**The synthesis, and why:** Homestar's "Task = the fields that uniquely determine the work" is exactly the right primitive for redundant-execution verification, because it makes the task's identity a hash. Bacalhau's pluggable `Executor`/`StorageProvider`/`Publisher` split is exactly the right component decomposition. Take both.

### 4.2 The o2 task contract

```typescript
// dag-cbor encoded → CID(TaskSpec) === taskCid.  Deterministic encoding is mandatory.
interface TaskSpec {
  op:      '/o2/wasm/run/1'
  module:  CID                       // the .wasm artifact
  entry:   string                    // exported function name, e.g. 'o2_map'
  inputs:  Record<string, CID>       // named, content-addressed
  args:    IpldValue                 // small scalars, inline (kept OUT of `inputs` so tiny
                                     // params don't each cost a block fetch)
  limits:  { fuelMax: number, memPagesMax: number, wallclockMs: number }
  profile: WasmProfile               // see 4.4 — pinned feature set, part of the hash
}

interface Receipt {
  task:    CID                       // === taskCid
  outputs: Record<string, CID>
  meta:    { exit: number, fuelUsed: number, wallclockMs: number }   // NOT verified
  by:      PeerId
  sig:     Uint8Array                // signature over dagCbor({ task, outputs }) ONLY
}
```

> **The single most important line in this document.** The Verifier compares **`(task, outputs)` and nothing else**. `fuelUsed`, `wallclockMs`, and any timestamp must sit outside the signed/compared digest. Include timing in the compared bytes and every redundant execution disagrees, and you will spend a week debugging a "nondeterministic WASM" problem that is actually a schema problem.

### 4.3 Where inputs/outputs bind: a narrow host ABI, not WASI

Ship this in v1:

```
// host imports, module "o2"
o2_input_len   (name_ptr: i32, name_len: i32) -> i64          // -1 if absent
o2_input_read  (name_ptr, name_len, offset: i64, dst: i32, len: i32) -> i32
o2_output_write(name_ptr, name_len, src: i32, len: i32) -> i32
o2_log         (ptr: i32, len: i32)                            // stderr-ish, NOT verified
```

**Why not WASI for the verified tier:** WASI's core surface hands the guest a clock, a randomness source, environment variables, and a filesystem — *four independent nondeterminism vectors*. Stubbing all four safely is strictly more work than four host functions, and every stub is a place where an engine difference leaks in. Four functions is a day; a trustworthy deterministic-WASI subset is a phase.

**When you do want WASI** (running third-party or elfconv-lifted binaries — the elfconv `aarch64-wasi32` target emits WASI imports), add it as a *second* `WasmRuntimePort` profile: a preopened read-only directory backed by the `BlockstorePort`, `clock_time_get` returning a fixed epoch, `random_get` returning a task-CID-derived stream, `environ` empty. `@bjorn3/browser_wasi_shim@0.4.2` is a reasonable browser base (it deliberately does not need `SharedArrayBuffer`); `node:wasi` covers Node. Note that `@wasmer/sdk` **requires sharing a `SharedArrayBuffer` across workers even for single-threaded WASIX programs** — which §0 rules out for the embedded tier.

**Flow, concretely:**

```
TaskSpec (CID) ──┬─> BlockstorePort.get(module)  ─> WasmRuntimePort.compile ─> Module
                 └─> for each name→CID: BlockstorePort.get(inputCid)
                              │
                              ▼
                    Worker: instantiate(Module, {o2: hostFns})  → call entry()
                              │  o2_output_write(name, bytes) appends to a buffer
                              ▼
              outputs: for each name → chunk → CID → BlockstorePort.put
                              │
                              ▼
                    Receipt { task, outputs, meta, by, sig }  ──> Verifier
```

Note the compile/instantiate split: **compile once per module per node, instantiate per task.** `WebAssembly.Module` is stateless and structured-cloneable — MDN: *"contains stateless WebAssembly code that has already been compiled by the browser — this can be efficiently shared with Workers, and instantiated multiple times."* So the pool compiles once on the main thread (or first worker) and `postMessage`s the `Module` to every worker. Getting this wrong costs an N×-compile tax per job.

### 4.4 Determinism is NOT free — design around it (HIGH confidence, real risk)

Verified against `WebAssembly/design/Nondeterminism.md` and the relaxed-simd proposal. WASM has these nondeterminism sources:

| Source | Status | Mitigation for o2 |
|---|---|---|
| **NaN bit patterns** | Spec-sanctioned. Sign bit of a NaN result from non-NaN inputs is explicitly nondeterministic. Wasmtime has a NaN-canonicalization flag; **V8 has no such knob** | Forbid NaN from reaching an output. The `o2_output_write` path can't police this, so: (a) validate at publish time, (b) prefer integer/fixed-point kernels for the verified tier, (c) treat a disputed float task as "not verifiable," not as "malicious node" |
| **Relaxed SIMD** | Results *intentionally* vary with hardware | **Reject modules importing/using relaxed-simd** in the accepted `WasmProfile`. Validate at publish time |
| **Threads / shared memory** | Load/RMW/wait/wake results nondeterministic | Already excluded by §0 (no SAB). Validate and reject `shared` memories |
| **Host facilities** (clock, random, env, FS) | Fully host-controlled | Excluded by the narrow ABI (§4.3) |
| **Resource exhaustion / OOM** | Engine-dependent | Fixed `memPagesMax` in the `TaskSpec`, part of the hash |

Wasm 3.0 defines a **deterministic profile** that pins NaN generation and relaxed vector ops. Track it — but **do not assume V8 exposes it**, and do not build the verification story on it landing.

**Architectural consequence:** there must be a **module validation step** (a pure function in `@o2/core`, run at publish time *and* re-run by the executor before instantiation) that walks the module's sections and rejects anything outside the declared `WasmProfile`. Put it in `core`, not in an adapter — it's the same logic in both environments and it's security-relevant.

---

## 5. Map/Reduce Over the Mesh

### 5.1 Map placement is degenerate for sovereign data

Per §3.5 of the design doc: data is already partitioned across owner nodes, so **map placement = data placement**. `DiscoveryPort.findProviders(shardCid)` returns the owner, and `SovereigntyPolicy.mustRunAt(shardCid)` returns the same set. There is *no map scheduling problem* for sovereign data — the scheduler is a lookup. The interesting placement problem exists only for **public/replicated** shards (§7).

Push filters, projections, and partial aggregation into the map task so the smallest possible partial leaves the owner. This is both a performance win and the sovereignty story.

### 5.2 Make the tree a pure function, not a consensus problem

**The design that avoids a whole class of bugs:** do not negotiate a tree topology. Derive it.

```typescript
// pure, in @o2/core/src/reduce
function deriveTree(partials: CID[], fanIn: number): CombineNode[] {
  const sorted = partials.slice().sort(compareCidBytes)   // canonical order
  // level 0 = leaves; each internal node is identified by its OWN content:
  //   combineNodeId = CID(dagCbor({ op: combineOp, children: [...childIds] }))
  // ...
}
```

Because the node id of every internal combine is a hash of `(combine op, ordered child ids)`, **every participant independently computes the identical tree** from the identical partial list. No agreement protocol, no leader election for topology. And the result of a combine is *itself* content-addressed, so two nodes that redundantly perform the same combine produce the same CID and dedup for free.

**Executor assignment (who runs which combine): rendezvous hashing (HRW).**

```typescript
// pick the aggregator for a combine node from the live aggregator set
function assign(combineNodeId: CID, aggregators: PeerId[], skip: Set<PeerId>): PeerId {
  return aggregators
    .filter(a => !skip.has(a))
    .map(a => ({ a, w: h(combineNodeId, a) }))
    .sort((x, y) => y.w - x.w)[0].a
}
```

HRW is chosen over consistent hashing because it needs no ring construction and gives you the **ranked fallback list for free** — repair is `assign(id, aggregators, skip ∪ {deadPeer})`, i.e. the next-best weight. Only ~1/k of assignments move when one aggregator leaves.

### 5.3 Tree formation and repair under churn

**Formation:**
```
1. Requestor publishes JobSpec → jobCid. Group key = hash(jobCid).
2. Aggregators register at the group key:
     backbone → DHT provider record on hash(jobCid)
     browsers → gossipsub topic  "/o2/job/" + jobCid   (see §7.3 — browsers can't serve DHT)
3. Requestor collects the live aggregator set, assigns level-1 combines by HRW,
   dispatches /o2/combine/1.0.0 with a LEASE.
4. Each aggregator recursively does the same for its subtree (it is a sub-coordinator).
```

**Repair — this is why the content-addressing matters:**

Every combine is a **pure function of already-durable content-addressed inputs**. Therefore a failed aggregator has *no state to migrate*. Repair is:

```
lease expires (no result, no heartbeat)
   → parent recomputes assign(combineNodeId, liveAggregators, skip ∪ {dead})
   → re-dispatch the identical combine to the next-best peer
   → if the dead node's result arrives late, it has the SAME CID → discard, no conflict
```

Contrast with a stateful aggregation tree (where an internal node accumulates), which requires either checkpoint-transfer or restarting the subtree. Purity + content addressing turns churn repair into "call the function again somewhere else." **This is the single highest-leverage design decision in the reduce layer.**

**Parameters:**
- **Fan-in k = 8–16.** Browsers hold limited simultaneous connections and relayed connections have bandwidth/duration caps; k in this range keeps depth at `ceil(log_k N)` (N=10 000, k=12 → depth 4) without demanding many concurrent streams per node.
- **Leases sized for background-tab throttling.** Hidden-tab timers are throttled to ≳1 min. A 30 s lease will falsely kill every backgrounded browser aggregator. Either set edge leases ≥ 2× the throttle interval, or — better — **do not place internal combine nodes on browser peers at all in v1**; put the aggregation backbone on backbone nodes as §3.5 of the design doc already prescribes. Browsers are leaves.

### 5.4 What the coordinator does vs delegates

| Coordinator (requestor) **owns** | **Delegates** |
|---|---|
| Job admission (fail fast if `|candidates| < R`) | Every actual `combine` |
| Sharding and the canonical partial ordering | Sub-coordination of each subtree (an aggregator holds its children's leases) |
| Minting capability tokens (UCAN chain from the data owner) | Nothing security-relevant — tokens are scoped and expiring |
| Redundancy R / quorum Q policy | — |
| The **final verdict** | — |
| The tree root | — |
| Checkpointing `JobState` | — |

**Coordinator failure:** `JobState { jobCid, shardPlacements, leases, receipts[] }` is itself a content-addressed block, published at the group key on each material transition. A crashed coordinator is recoverable by whoever holds the next HRW slot on `hash(jobCid)` among backbone peers. **Defer this to a later phase** (§9, P8) — for small/interactive jobs the requestor-as-sole-coordinator is correct and much simpler, and PROJECT.md's §3.3 solution 8 explicitly frames delegated coordination as the answer for *massive* graphs only.

---

## 6. Browser-Specific Structure

### 6.1 Worker pool for execution

```
Main thread (or host page's thread)
  ├─ libp2p node (WebRTC / WebSockets / circuit-relay-v2)
  ├─ blockstore-idb  ← also reachable from workers, but keep ONE writer
  ├─ @o2/core kernel (Coordinator, Placer, Verifier, Governor)
  └─ WorkerPool  ── postMessage(WebAssembly.Module) ──> Worker[0..n-1]
                    n = max(1, navigator.hardwareConcurrency - 1)
                    postMessage(inputs as transferable ArrayBuffers)
                    <── postMessage(outputs as transferable ArrayBuffers)
```

- **Never execute on the main thread.** *"The benefit of putting WASM logic in a worker is to improve user experience by keeping the main thread free, which allows the browser to keep rendering and handling user input."* For an embedded agent this is existential, not cosmetic.
- **Compile once, share the `Module`.** Verified against MDN (§4.3).
- **Transfer, don't copy.** Input and output block bytes cross as transferable `ArrayBuffer`s. This is the zero-copy path that does *not* require `SharedArrayBuffer`.
- **`workerFactory` is a port.** Bundlers disagree violently about `new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`, and an embedded agent cannot assume the host's bundler. Ship the worker as its own export (`@o2/node-agent/worker`) and let the composition root — or the embedding host — supply `() => new Worker(...)`. Provide a working default for Vite and a documented escape hatch.
- `comlink@4.4.2` is optional sugar over the message plumbing. Given that the worker protocol here is exactly two message types (`run`, `result`), a hand-written 60-line RPC is probably cheaper than the dependency. Opinion: skip it.

### 6.2 SharedArrayBuffer / COOP+COEP — deliberately avoided

Cross-origin isolation requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` on the **top-level document**. Consequences if you take that dependency:

- **The embedded use case dies.** You'd be dictating headers on a host page you don't control, and `require-corp` breaks the host's own cross-origin images/scripts/fonts unless every one of them opts in with CORP.
- **GitHub Pages can't set headers.** The known workaround is `coi-serviceworker`, which *"reloads the page on the first user visit, registering a service worker that emulates COOP and COEP headers."* A forced first-visit reload plus a service worker registration is not something you can do inside someone else's page.
- **It buys you WASM threads, which you don't want** — shared-memory load/RMW/wait/wake results are nondeterministic (§4.4), and determinism is the verification mechanism.

**Decision: single-threaded WASM tasks, no SAB, parallelism via N independent workers running N independent tasks.** This is strictly better for this workload anyway — the parallelism unit is *the shard*, not *the loop iteration*. Revisit only if a phase genuinely needs WASIX/`@wasmer/sdk`, and if so, confine it to the Node/backbone tier.

### 6.3 IndexedDB blockstore

`blockstore-idb@4.0.1` / `datastore-idb@5.0.1` implement `interface-blockstore@7.0.1`, which is the same interface Helia's `helia.blockstore.get/put` speaks — so `BlockstorePort` should be *structurally compatible* with `interface-blockstore` (`get`/`put`/`has`/`delete`/`getMany`/`putMany` with `AbortOptions`). Do not invent a different shape; you'd be writing an adapter against your own ecosystem for no benefit.

- One writer. Multiple tabs writing the same IDB store is a correctness and contention problem; use the Web Locks API to elect a writer, or accept duplicate blocks (they're content-addressed, so duplicates are harmless — just wasteful).
- **Close IDB connections on `freeze`.** Explicit guidance from the Page Lifecycle docs: on entering FROZEN, *"any timers and connections that could affect other tabs should be terminated, such as closing all open IndexedDB connections, any open Web Socket connections, and releasing any web locks being held."* A held IDB connection in a frozen tab blocks version upgrades in other tabs.
- Storage is evictable. `navigator.storage.persist()` for the owner's sovereign data; treat everything else as cache.

### 6.4 Tab lifecycle — the most under-appreciated constraint

| Event | State | What the node MUST do |
|---|---|---|
| `visibilitychange` → hidden | HIDDEN | Governor: reduce advertised capacity (background tabs get throttled). Persist `JobState`. |
| `freeze` | FROZEN | **Advertised capacity → 0. Surrender all leases. Close IDB. Release Web Locks.** Timers, callbacks, and DOM ops stop — a frozen tab is a straggler that will *never* finish. |
| `resume` | ACTIVE | Re-open IDB, re-dial relay (the reservation almost certainly expired), re-advertise capacity. **Assume all prior leases are void.** |
| `pagehide` (persisted=true) | → bfcache | Same as freeze. Pending timers and unresolved promises are paused. |
| `document.wasDiscarded` on load | post-DISCARD | Restore from persisted `JobState`; do not assume any in-flight work survived. |
| background timer throttling | HIDDEN | Timers throttled to ≥1 min. **Size every heartbeat/lease/TTL against this**, or backgrounded peers are continuously false-positive-dead. |

This is why `LifecyclePort` is a first-class port and not an afterthought. Model it in P3, not in a bugfix phase.

### 6.5 Later research spike (not a plan): SharedWorker

Running one libp2p node + blockstore in a `SharedWorker` so N tabs of an origin = 1 peer is attractive (one relay reservation, one blockstore, one identity). **No first-class Helia/libp2p support exists today** — searched; the Service Worker Gateway is the closest shipped thing and it does verified *retrieval*, not a full node. Treat as a spike with an unknown answer, not a phase deliverable.

---

## 7. Decentralized Placement — concretely

### 7.1 What a placement decision needs as input

```typescript
interface PlacementRequest {
  task: TaskSpec
  constraints: {                                  // HARD — filter, never score
    sovereignty: 'pinned' | 'movable'             // from SovereigntyPolicy(input CIDs)
    mustRunAt?:  PeerId[]                         // non-empty ⇒ placement is a lookup, done
    wasmProfile: WasmProfile                      // candidate must support the feature set
    trustTier:   'edge' | 'backbone'
    capability:  UcanChain                        // must be presentable to the candidate
  }
  redundancy: { R: number, quorum: number, antiAffinity: 'distinct-operator' }
  cost: { inputBytes: number, moduleBytes: number }  // move the smaller of the two
}
```

Per-candidate signal needed at selection time:
- **coarse load** — short-TTL DHT value, or gossiped, or omitted entirely (see 7.2)
- **liveness** — do we already have a live connection? (huge bonus: no dial, no relay handshake)
- **RTT** — free if connected
- **recent success rate** — local, per-peer, decayed

### 7.2 Power-of-d + backpressure: why staleness is survivable

```
candidates = discover(constraints)              # ONE DHT/gossip round
if |candidates| < R  → reject at admission control (fail fast, don't half-run)

for each of R replicas (disjoint sample sets, distinct operators):
    sample d = min(|remaining|, 4) uniformly at random
    score by (advertisedLoad, rtt, successRate, alreadyConnected)
    offer to argmin  →  candidate's Governor decides:
        accept  → lease granted, dispatch
        reject  → drop candidate, resample (bounded, ~3 retries, then widen d)
```

**The verified reason this works with stale data:** *"Unlike traditional pick-the-best-server approaches that suffer from herding behavior with stale data, the two-choice method maintains stable performance even as cache refresh intervals increase."* Pick-the-best with cached load causes every requestor to herd onto the same "quiet" node simultaneously; random sampling breaks the correlation. And the theoretical gain from d=2 is exponential over d=1, while **d > 2 buys only constant-factor improvement** — so d=2..4 is the whole design space. Don't over-engineer it.

**Node-side backpressure is the other half.** The Governor is what makes stale advertised load safe: an over-committed node just says no, and the requestor resamples. Without the Governor, power-of-d degrades under load spikes. Build them in the same phase.

**Anti-affinity is not optional.** R redundant executions on nodes controlled by one operator prove nothing. Sample the R replicas from disjoint candidate pools keyed on operator identity (from the provider-signed enrollment cert, §3.9 of the design doc).

### 7.3 The DHT/gossip split — a hard platform constraint

**Verified (js-libp2p docs + kad-dht):** *"A DHT that operates in client mode won't register a stream handler for incoming requests and therefore won't store, e.g., any provider or IPNS records."* Nodes default to client mode and switch to server mode only on detecting a publicly reachable address. **Browsers never have one.** And separately: *"browser peers don't tend to be long-lived enough to appear in the results of"* DHT FIND_NODE queries.

Therefore:

```
        BACKBONE PLANE                          EDGE PLANE
   kad-dht server mode                    gossipsub + rendezvous
   ├─ provider records for CIDs           ├─ topic "/o2/cap/<capability>"
   ├─ signed capability records           ├─ topic "/o2/job/<jobCid>"
   ├─ signed trust-tier records           └─ periodic multiaddr re-announce
   └─ node routing                            (relay reservations expire ~1h)
        ▲                                          ▲
        └────────── backbone nodes bridge ─────────┘
                    (subscribe both, publish digests)
```

- Browser nodes run `kad-dht` in **client mode** — they can *query* and can *issue* `provide()` (the record lands on server nodes), but their advertised multiaddrs are circuit-relay addresses whose reservations are capped at ~1 hour with bandwidth limits by design. So browser provider records go stale fast and must be re-announced.
- **There is no `@libp2p/rendezvous` package in JS** (verified: not on npm). Options: (a) `@libp2p/pubsub-peer-discovery@12.0.0` + `@chainsafe/libp2p-gossipsub@14.1.2` on a topic per capability — works today, and the docs are honest that pubsub discovery *"is not battle-tested for production use cases at scale"*; or (b) implement `/o2/rendezvous/1.0.0` as a custom protocol on your relay/backbone nodes. **Recommendation: (a) for P3–P6, (b) as a hardening item.** You control the backbone anyway.

---

## 8. Data Flow

### 8.1 Job submission → verified result (the happy path)

```
[submitJob(JobSpec)]
       │
       ▼
JobCoordinator ── shard ──> shardCids[]
       │
       ├─ for each shard: SovereigntyPolicy.mustRunAt(shard) ──┐
       │                     (empty ⇒ Placer.place(...))       │
       │                                                        ▼
       │                                            DiscoveryPort.findProviders
       │                                                        │
       ▼                                                        ▼
   dispatch /o2/dispatch/1.0.0  ────────────────────>  remote Governor.canAccept
       │                                                        │ accept + lease
       │                                                        ▼
       │                                              remote Executor
       │                                                 ├─ BlockstorePort.get(module)
       │                                                 ├─ BlockstorePort.get(inputs)
       │                                                 ├─ WasmRuntimePort.run  (Worker)
       │                                                 └─ BlockstorePort.put(outputs)
       │                                                        │
       │  <───────────── Receipt {task, outputs, sig} ──────────┘
       ▼
   Verifier.collect(taskCid)  →  R receipts
       │  compare dagCbor({task, outputs}) across all R
       ├─ Agreed(outputCid)  ──> partials[]
       └─ Disputed           ──> Coordinator: place R' more, or fail the shard
       │
       ▼
   ReduceTree.derive(sort(partials), k)   ← PURE, no coordination
       │
       ▼
   dispatch /o2/combine/1.0.0 with LEASE ──> aggregator ──> combine ──> partialCid
       │        (lease expiry ⇒ HRW next-best ⇒ re-dispatch identical combine)
       ▼
   rootCid  ──> [job result]
```

### 8.2 Sovereignty flow (the Core Value — what must be *provably* absent)

```
Owner node A                                      Requestor node B
├─ blockstore: private shard (CID_priv,           │
│              label = sovereignty:pinned)         │
│                                                  │
│  <──── /o2/dispatch { module: CID_wasm,  ────────┤   B ships CODE to A
│                        inputs: {d: CID_priv} }   │
│                                                  │
├─ CapAuthz.verify(ucanChain → A's owner key) ──┐  │
├─ SovereigntyPolicy.mustRunAt(CID_priv) == [A] ┤  │   ⇒ placement legal
├─ Executor runs LOCALLY, reads CID_priv locally│  │
├─ writes aggregate output → CID_agg            │  │
│                                                │  │
└──── Receipt { outputs: { r: CID_agg } } ───────┴─>│   ONLY the aggregate leaves
                                                    │
   ✗ CID_priv bytes are NEVER sent on any stream    │
   ✗ CID_priv is NEVER announced as movable         │
```

**Make this a test, not a doc claim.** The `LoopbackNetwork` adapter (P1) and a libp2p stream-tap (P2+) can assert that no byte of `CID_priv`'s block ever crossed a stream. This is the "if everything else fails" requirement from PROJECT.md — it deserves an executable proof, and the hexagon is what makes that proof cheap.

### 8.3 State ownership

| State | Lives in | Durability |
|---|---|---|
| Blocks (modules, inputs, partials, outputs) | `BlockstorePort` | idb (browser) / fs (node); content-addressed ⇒ refetchable |
| `JobState` (placements, leases, receipts) | `DatastorePort` + published as a block at the group key | Survives coordinator crash from P7 onward |
| Live leases (this node's commitments) | Governor, in-memory + `DatastorePort` | Surrendered on freeze/stop |
| Peer scores (RTT, success rate) | In-memory, per-node | Ephemeral by design |
| Node identity key | `KeystorePort` | Non-extractable `CryptoKey` (browser) / OS keychain-TPM (node) |

---

## 9. Build Order — vertical slices, not layers

Granularity: **fine (8–12 phases)**, mode: **vertical MVP**. Every phase below ends with something that *runs end to end*.

### The minimum end-to-end slice, explicitly

**P1 is the minimum spanning set.** It contains: identity-free execution, the task ABI, content-addressed I/O, the receipt, redundant execution, and the verifier — connected by an in-memory network adapter, running in one process. It has **no networking, no relay, no DHT, no browser transport.** That is deliberate: if the task ABI or the receipt schema is wrong, you find out in week one with a 200 ms test, not in week twelve behind a WebRTC connection you can't debug.

**P3 is the headline slice** ("two browser tabs run a distributed job and agree on the result"), and it is reachable only because P1 and P2 already proved everything except the transport and the storage adapters.

| # | Phase | End-to-end capability delivered | Why here |
|---|---|---|---|
| **P1** | **Kernel + loopback slice** | `submitJob` with 4 shards; each shard mapped **twice** (R=2) via `LoopbackNetwork`; Verifier agrees; result CID returned. Same suite green under `-t node`, `-t browser`, `-t webworker`. | Proves the hexagon, the task ABI, receipt schema, and determinism policy with **zero network risk**. Establishes the three-target test discipline on day one, when it's free. |
| **P2** | **Real network, Node↔Node** | Two Node processes on localhost: TCP + noise + yamux, `/o2/dispatch/1.0.0`, block exchange, fs blockstore. Distributed 2×-redundant map job. | First real payoff of the port boundary — the kernel is not touched. If it *is* touched, the boundary was wrong and you learn it cheaply. |
| **P3** | **Browser tier** ← *headline* | `@o2/relay` (Node: circuit-relay-v2 + WSS + bootstrap); WebRTC + websockets adapters; `blockstore-idb`; Worker-pool runtime; `LifecyclePort`. **Two browser tabs run a distributed job and agree on the result.** | Everything except transport+storage is already proven, so WebRTC/relay debugging happens against a known-good protocol. |
| **P4** | **Sovereignty & authorization** | Sovereignty labels on blocks; UCAN chain verified before execute; `mustRunAt` placement. Tab A holds private data, tab B submits, code ships to A, **only the aggregate leaves — with a stream-tap test that fails if raw bytes move.** | This is the Core Value. Do it before the scheduler gets clever, so the hard constraint is designed *in* rather than retrofitted around a cost model. |
| **P5** | **Decomposable reduce (tree)** | `deriveTree` + HRW assignment + k-ary fan-in + leases + re-dispatch on expiry. 8+ nodes, real map/reduce, correct aggregate. Combiner pushdown on the owner. | The first genuinely novel piece. Needs P4's constraints to exist so combines don't get placed illegally. |
| **P6** | **Discovery & decentralized placement** | kad-dht server on backbone, gossipsub group keys for edge, signed capability/trust records, power-of-d + anti-affinity, Governor with admission control + backpressure. Removes the static peer list P1–P5 leaned on. | Deferred deliberately: a static peer list is a perfectly good crutch for four phases, and doing placement before the reduce exists means guessing at what a placement decision needs. |
| **P7** | **Churn & straggler resilience** | Speculative/backup execution; `JobState` checkpoints; freeze/resume lease surrender; late-duplicate dedup by CID. **Kill 30% of nodes mid-job → job still completes correctly.** | The acceptance test is the phase. This is design-doc risk #2 ("tree-reduce robustness when the aggregation backbone churns"). |
| **P8** | **Delegated tree coordination** | Sub-coordinators on backbone for large graphs; coordinator handoff via HRW on `hash(jobCid)`. | Only matters at scale. Ship the flat coordinator for 7 phases first. |
| **P9** | **Benchmark harness** | Throughput vs node count, published numbers; straggler and verification-tax breakdown. | Proves the *scaling thesis*, which is a separate claim from "it works." |
| **P10** | **Public demo app** | Multi-machine + multi-tab demo, **built but not deployed** — deployment is a separate explicit gate per the disclosure constraint. | Depends on everything. |
| **P11** | **elfconv AOT pipeline** | Docker toolchain → signed `key→CID` mapping → artifact registry → V8 code-cache priming via gateway URLs + `compileStreaming`. | PROJECT.md's explicit decision: Part I sequenced last so it doesn't block the capacity/sovereignty thesis. |

### Parallelizable

| Can run concurrently | Because |
|---|---|
| **P11 (elfconv) with anything from P3 onward** | It's a C++/LLVM build-time toolchain in `tools/aot/` producing `.wasm` files. Zero TypeScript coupling. Different skill surface, different repo area. |
| **P9 (bench harness) alongside P5** | The harness targets the P2/P3 dispatch API, which is frozen by then. Having numbers *while* building the tree is more useful than after. |
| **`@o2/relay` (in P3) with the browser adapters (in P3)** | Once `@o2/wire` protocol IDs are fixed in P2, the relay is a standalone Node process. Two independent workstreams inside one phase. |
| **P4 (sovereignty) with P5 (reduce) — partially** | P5's *combine mechanics* don't need sovereignty; P5's *placement of combines* does. Split: build `deriveTree` + HRW in parallel with P4, integrate placement afterward. |

### Strictly sequential

`P1 → P2 → P3` is a hard chain — each one swaps exactly one adapter class and validates the port boundary by doing so. Breaking this order (e.g. starting with WebRTC) means debugging three unproven things at once.

---

## 10. Scaling Considerations

Scale here is **node count and job fan-out**, not "users."

| Scale | What the architecture must do |
|---|---|
| **2–10 nodes (P1–P4)** | Flat fan-out from the requestor. Static peer list. In-memory job state. No tree — a single reduce on the requestor is fine and faster. |
| **10–100 nodes (P5–P6)** | Tree-reduce with k=8–16 (depth 2). Real discovery. Power-of-d with d=2. Relay bandwidth becomes the first thing you notice. |
| **100–10 000 nodes (P7–P8)** | Depth 3–4. Delegated sub-coordinators. Checkpointed job state. Speculative execution mandatory (a 10 000-node job's p99 straggler dominates). Multiple relays; relay reservation churn is a continuous background load. |
| **10 000+ nodes** | The requestor's *own* coordination becomes the intra-job limit (§3.3 of design doc). Delegated tree coordination is no longer optional. DHT eclipse/sybil resistance (S/Kademlia, certificate-bound backbone IDs) moves from "residual limit" to "required." |

### Bottleneck order (what breaks first)

1. **Relay bandwidth and reservation churn.** Circuit-relay-v2 reservations are capped at ~1 hour with bandwidth limits *by design*. Every browser↔browser WebRTC handshake needs one, and every un-punchable pair *stays* on the relay. **Fix:** run relays on the backbone (design doc §3.7 already prescribes this); prefer direct WebRTC upgrade; treat the public IPFS relay pool as a fallback, not a foundation.
2. **Stragglers.** In a browser fleet, a backgrounded tab is a straggler that may never return. **Fix:** speculative execution (P7) + the Governor dropping capacity to 0 on `freeze` (P3, so the problem is largely prevented rather than mitigated).
3. **Verification tax.** R=2 or 3 multiplies real work 2–3×. **Fix:** reputation-weighted R (trusted backbone nodes get R=1), and spot-check sampling instead of full redundancy for large fan-outs. This is design-doc risk #3 and has no cheap answer — plan to measure it in P9.
4. **DHT staleness for browser peers.** Provider records outlive the peers. **Fix:** short TTLs for volatile facts, gossip plane for the edge (§7.3), and treat all records as *hints* — confirm liveness on connect.
5. **Skew.** Sovereignty forbids rebalancing one owner's data onto another owner's node, so the largest owner's local map bounds the whole phase. **Fix:** parallelize *within* that owner's node set; never speculate across owners.

---

## 11. Anti-Patterns

### A1. Environment sniffing inside the kernel
**What people do:** `if (typeof window !== 'undefined') { /* browser path */ }` in shared code.
**Why it's wrong:** ships both branches (no tree-shaking), is *wrong inside a Web Worker* (no `window`, but you are in a browser), breaks under SSR and Electron, and makes tests report the wrong path as covered.
**Instead:** inject through a port; conditionally resolve only the composition root via `exports` + `.browser.ts`. Enforce with `no-restricted-globals` scoped to `packages/core/**`.

### A2. Hashing timing or resource metadata into the verified receipt
**What people do:** sign/compare the whole `Receipt` including `wallclockMs` and `fuelUsed`.
**Why it's wrong:** every redundant execution disagrees. You will misdiagnose it as WASM nondeterminism and go looking for NaN bugs that aren't there.
**Instead:** the compared and signed digest is `dagCbor({ task, outputs })`. `meta` rides alongside, unverified.

### A3. Reaching for full WASI to get "a filesystem"
**What people do:** wire up a WASI shim so tasks feel like normal programs.
**Why it's wrong:** WASI hands the guest a clock, randomness, env vars, and a filesystem — four independent nondeterminism vectors, each of which silently breaks redundant-execution verification.
**Instead:** four host functions (§4.3) for the verified tier. Add a *deterministic WASI subset* later, behind the same port, for elfconv-lifted binaries.

### A4. Taking a `SharedArrayBuffer` dependency
**What people do:** reach for wasm threads / `@wasmer/sdk` for performance.
**Why it's wrong:** requires COOP+COEP on the top-level document ⇒ kills the embedded-in-a-host-page requirement, needs the `coi-serviceworker` reload hack on GitHub Pages, *and* introduces shared-memory nondeterminism that breaks verification.
**Instead:** N independent single-threaded workers running N independent shards. The parallelism unit is the shard.

### A5. Building horizontal layers ("transport phase", "storage phase", "executor phase")
**What people do:** the layer diagram in §2 of the design doc looks like a build plan. It isn't.
**Why it's wrong:** four months in you have a beautiful transport layer, a beautiful blockstore, and nothing that computes anything. Every integration bug arrives simultaneously at the end.
**Instead:** §9. Every phase is a working system with fewer capabilities, never a layer with no system.

### A6. Negotiating the reduce tree topology
**What people do:** elect a tree, gossip the topology, agree on parents.
**Why it's wrong:** you've built a consensus protocol inside a system whose whole premise is coordinator-freedom, and now churn requires topology *agreement* to converge before work can resume.
**Instead:** derive the tree as a pure function of the sorted partial-CID list; assign executors by HRW. Repair = re-run a pure function elsewhere. No agreement, no state migration.

### A7. Treating DHT provider records as live load or as reliable for browsers
**What people do:** `GET_PROVIDERS` → assume those peers are up and idle.
**Why it's wrong:** records are stale by construction (TTL), browsers are DHT *clients* that store nothing and whose relay addresses expire hourly, and "pick the least-loaded from a cached list" herds.
**Instead:** records are hints; confirm liveness on connect; power-of-d sampling + node-side backpressure absorbs the staleness (§7.2).

### A8. Redundant replicas on the same operator
**What people do:** place R=3 on the three least-loaded candidates.
**Why it's wrong:** if one operator owns all three, agreement proves nothing — it's the same liar three times.
**Instead:** disjoint sample pools keyed on operator identity from the provider-signed enrollment certificate.

### A9. Running tasks on the main thread "just for now"
**What people do:** ship the executor inline in P1 because there's no network yet.
**Why it's wrong:** the `WasmRuntimePort` boundary is where the worker lives; if P1 doesn't have it, P3 rewrites the executor rather than swapping an adapter — and you lose the proof that the port boundary was right.
**Instead:** P1's Node runtime adapter already uses `worker_threads`. Same shape, different platform.

### A10. Defaulting to all-to-all shuffle
**What people do:** implement generic map/reduce, i.e. key-partitioned shuffle.
**Why it's wrong:** it is the thing that kills P2P map/reduce, and PROJECT.md has already scoped it **out**.
**Instead:** decomposable reduce + combiners; mergeable sketches (HLL, t-digest, Count-Min) for holistic-but-approximate. Steer the workload.

---

## 12. Integration Points

### External / third-party

| Dependency | Integration pattern | Gotchas |
|---|---|---|
| `libp2p@3.3.6` | Behind `NetworkPort`; kernel exposed as a libp2p **service** via `serviceCapabilities`/`serviceDependencies` | `services` is a real DI container with lifecycle — use it, don't rebuild it. Missing `identify` throws at construction. |
| `@libp2p/webrtc@6.0.27` + `@libp2p/circuit-relay-v2@4.2.9` + `@libp2p/websockets@10.1.17` | Browser transport triad. Listener listens on `['/p2p-circuit', '/webrtc']`; dialer needs all three transports | Browsers can only dial `DNS + WSS`. Relay needs a CA-signed cert and a domain. Reservations ~1 h, bandwidth-limited. `connectionGater.denyDialMultiaddr` must be relaxed for local testing. |
| `@libp2p/kad-dht@16.4.0` | `DiscoveryPort` on the backbone | Client mode registers **no** stream handler and stores **no** records. `clientMode: false` requires public addrs. |
| `@chainsafe/libp2p-gossipsub@14.1.2` + `@libp2p/pubsub-peer-discovery@12.0.0` | Edge discovery + job group keys | Officially *"not battle-tested for production use cases at scale."* Fine for P3–P6; plan a custom `/o2/rendezvous/1.0.0` on the backbone as hardening. |
| `interface-blockstore@7.0.1` / `blockstore-idb@4.0.1` / `blockstore-fs@4.0.1` | `BlockstorePort` shaped compatibly with `interface-blockstore` | Same interface Helia speaks — free interop if you later want `@helia/unixfs` or bitswap. Close IDB on freeze. |
| `multiformats@14.0.5` + `@ipld/dag-cbor@10.0.1` | CIDs, deterministic encoding of `TaskSpec`/`Receipt` | dag-cbor's deterministic encoding is what makes `taskCid` a stable identity. Do not hand-roll. |
| `@ucanto/core@10.4.6` (or plain UCAN) | `CapAuthz` chain verification | Short-lived caps ⇒ expiry replaces revocation. Evaluate before committing — it's a substantial dependency. |
| `aegir@48.1.2` | Build + the three-target test runner | The IPFS/libp2p ecosystem's toolchain; its browser-field/ESM resolution already matches your deps. |
| `elfconv` (Docker, AArch64) | Build-time only, in `tools/aot/` | Not a TypeScript component. Produces `.wasm`. Needs unstripped, statically-linked AArch64 input. |

### Internal boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `core` ↔ adapters | Ports (interfaces), constructor injection | **One-way.** `core`'s package.json must not list any adapter. `dep-check` enforces. |
| `core` ↔ `wire` | `core` imports `wire` types; `wire` is pure and imports nothing platform-shaped | Wire schema changes are protocol-breaking — version the protocol ID (`/o2/dispatch/1.0.0`). |
| main thread ↔ Worker | `postMessage` with transferable `ArrayBuffer`s; `WebAssembly.Module` structured-cloned once per worker | Two message types. Roll it by hand; skip `comlink`. Worker construction is a `workerFactory` port because bundlers disagree. |
| node ↔ node (dispatch) | `/o2/dispatch/1.0.0`, length-prefixed dag-cbor over a libp2p stream | Request/response, one task per stream. |
| node ↔ node (combine) | `/o2/combine/1.0.0`, same framing + lease | Lease heartbeat interval must exceed background-tab timer throttling (≥1 min). |
| node ↔ node (blocks) | `/o2/blocks/1.0.0` (want/have/block) — or adopt bitswap via Helia | **Opinion:** hand-roll a minimal want/have protocol for P2. It's ~150 lines, and bitswap's session/ledger machinery is tuned for a different traffic shape (many peers, unknown providers) than "I know exactly who has my module." Revisit if block exchange becomes a bottleneck. |
| coordinator ↔ group | gossipsub topic `/o2/job/<jobCid>` (edge) + DHT provider record on `hash(jobCid)` (backbone) | Backbone nodes bridge the two planes. |

---

## 13. Confidence Assessment

| Claim | Confidence | Basis |
|---|---|---|
| js-libp2p `services` is a DI container with lifecycle/capabilities/dependencies | **HIGH** | Context7 → `js-libp2p/doc/SERVICES.md` |
| `browser` conditional export + `.browser.ts` sibling is the ecosystem pattern | **HIGH** | Live `libp2p@3.3.6` package.json `exports["./user-agent"].browser` |
| Three-target test discipline (`node` / `browser` / `webworker`) | **HIGH** | Live package.json scripts in both `libp2p` and `helia` |
| Browsers are kad-dht **clients** and store no records | **HIGH** | js-libp2p docs + kad-dht issue #1621 / discussion #2503 |
| WASM is not deterministic by default (NaN, relaxed-SIMD, threads) | **HIGH** | `WebAssembly/design/Nondeterminism.md`, relaxed-simd Overview |
| V8 has no NaN-canonicalization knob (Wasmtime does) | **MEDIUM-HIGH** | Wasmtime docs confirm the flag; absence in V8 inferred from no documented equivalent |
| `WebAssembly.Module` is structured-cloneable to Workers | **HIGH** | MDN, with code example |
| COOP/COEP blocks the embedded use case; `coi-serviceworker` forces a reload | **HIGH** | web.dev cross-origin-isolation guide; Wasmer + tomayac GitHub Pages write-ups |
| Page Lifecycle: close IDB / release locks on `freeze`; ≥1 min background throttle | **HIGH** | Chrome Page Lifecycle API docs, WICG/page-lifecycle |
| Power-of-d is robust to stale load where pick-the-best herds; d>2 is constant-factor | **HIGH** | Mitzenmacher TPDS 2001 + practitioner analyses |
| Bacalhau's Executor / StorageProvider / Publisher / BiddingStrategy split | **HIGH** | bacalhau.org architecture + SpecConfig docs |
| Homestar: Task = the invocation subset determining the work; receipts are CIDs and replay | **HIGH** | ipvm-wg/homestar README + homestar-wasm docs |
| No `@libp2p/rendezvous` package exists in JS | **HIGH** | npm registry query — not found |
| **HRW-assigned, CID-derived reduce tree with pure-recompute repair** | **MEDIUM** | Synthesis. Each ingredient is standard (rendezvous hashing, content-addressed intermediates, convergecast repair); *this* combination is not a copy of a shipped system. Validate in P5/P7. |
| **Sovereignty as a hard pre-placement veto** | **MEDIUM** | The design doc's own stated novel delta. No prior art to copy. |
| SharedWorker for one-node-per-origin | **LOW** | No first-class Helia/libp2p support found. Spike, not plan. |

---

## 14. Sources

**Context7 (HIGH)**
- `/libp2p/js-libp2p` — SERVICES.md (Startable, `serviceCapabilities`, `serviceDependencies`), CONFIGURATION.md (circuit-relay-v2 server/limits, kad-dht), transport-webrtc README (browser-to-browser via relay), protocol-dcutr README
- `/ipfs/helia` — blockstore API, `interface-blockstore` compatibility

**Live registry / repositories (HIGH)**
- `libp2p@3.3.6` package.json — `exports` conditions, test-target scripts — https://github.com/libp2p/js-libp2p/blob/main/packages/libp2p/package.json
- `helia@7.1.1` package.json — https://github.com/ipfs/helia/blob/main/packages/helia/package.json
- npm registry version checks (2026-07-24) for all packages named in §12

**Official documentation (HIGH)**
- https://libp2p.io/docs/browser-connectivity/ , https://libp2p.io/docs/webrtc-browser-connectivity/ , https://libp2p.io/docs/dht/ , https://libp2p.io/docs/rendezvous/
- https://github.com/WebAssembly/design/blob/main/Nondeterminism.md
- https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md
- https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html
- https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Module
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api , https://github.com/WICG/page-lifecycle , https://web.dev/articles/bfcache
- https://web.dev/articles/coop-coep , https://web.dev/articles/cross-origin-isolation-guide
- https://bacalhau.org/docs/overview/architecture , https://bacalhau.org/docs/engines/wasm/ , https://bacalhau.org/docs/specifications/other/specconfig
- https://github.com/ipvm-wg/homestar , https://github.com/ipvm-wg/homestar/tree/main/homestar-wasm , https://github.com/ucan-wg/invocation
- https://github.com/fluencelabs/aquavm

**Verified secondary (MEDIUM)**
- https://github.com/libp2p/js-libp2p/issues/1621 , https://github.com/libp2p/js-libp2p/discussions/2503 — DHT client-mode limits
- https://cs.colby.edu/courses/F09/cs231-labs/labs/lab07/Mitzenmacher-2Choices-TPDS2001.pdf , https://brooker.co.za/blog/2012/01/17/two-random.html — power-of-d under staleness
- https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers/ , https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/ — COOP/COEP on static hosting
- https://github.com/bjorn3/browser_wasi_shim , https://wasmer.io/posts/introducing-the-wasmer-js-sdk — browser WASI options and the SAB requirement
- https://www.sitepen.com/blog/using-webassembly-with-web-workers — WASM in Workers
- https://blog.ipfs.tech/state-of-ipfs-in-js/ , https://ipshipyard.com/blog/2024-shipyard-improving-ipfs-on-the-web/ — browser IPFS/libp2p state of the art
- ScienceDirect / ACM DL results on self-healing aggregation trees and P2P churn recovery (abstract-level only — full texts paywalled; treated as directional, not authoritative)

---
*Architecture research for: P2P distributed compute fabric (TypeScript + WASM, browser + Node.js + embedded)*
*Researched: 2026-07-24*
