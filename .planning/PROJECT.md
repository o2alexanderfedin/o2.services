# o2.services — P2P Native Cloud

## What This Is

A peer-to-peer compute fabric that runs untrusted code safely on volunteer and
enterprise nodes, moves code to data instead of data to code, and keeps each
owner's data pinned to their own device for sovereignty. The node agent is
TypeScript + WASM so it runs unmodified in a browser tab, in Node.js, or
embedded in a host application — which makes every visitor to a web page a
potential compute node.

## Core Value

**Usable capacity grows super-linearly with the user base, without any raw data
leaving its owner's device.** If everything else fails, a map/reduce job must
distribute across N independently-owned nodes, return a verified-correct result,
and demonstrably never move the underlying data off the owner's node.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. Hypotheses until shipped. -->

- [ ] Node agent runs identically in browser, Node.js, and embedded contexts
- [ ] Nodes discover each other and connect through NAT via libp2p
- [ ] Deterministic WASM tasks execute in a sandbox on any node
- [ ] Data is content-addressed and pinned to its owner's node
- [ ] Map placement follows data placement — code ships to the owner, raw data never leaves
- [ ] Result integrity via redundant execution and result comparison
- [ ] Decomposable reduce merges partials up a hierarchical tree (no all-to-all shuffle)
- [ ] Decentralized placement via DHT discovery and power-of-d-choices selection
- [ ] Native binaries translate to portable sandboxed WASM (elfconv AOT pipeline)
- [ ] Translated artifacts are content-addressed, signed, and cached over IPFS
- [ ] Benchmark harness measures throughput against node count and publishes numbers
- [ ] Public demo distributes real work across browser tabs and machines

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Accepting outside contributions** — sole authorship is what keeps the
  commercial license track available for the entire codebase; see CONTRIBUTING.md
- **TEE / confidential-computing backbone (SEV-SNP, TDX, Nitro, CCA)** — the doc's
  §3.1 tier-2 trust story; requires datacenter hardware and is not reachable from
  the browser tier this milestone targets
- **Native execution in microVM / Firecracker / Kata** — same reason; the AOT-to-WASM
  path is this milestone's answer to native code
- **Key-partitioned all-to-all shuffle** (§3.5 solution 3) — the expensive escape
  hatch for exact holistic ops; decomposable reduce and mergeable sketches cover
  the target workloads
- **Incentives, payments, staking, reputation** (§3.8) — a market layer is
  meaningless before capacity scaling is proven
- **Emulation fallback / container2wasm** (Part I.5) — ~10x+ slowdown for kernel
  fidelity nobody has asked for yet
- **Making the repository or demo public** — gated on a separate explicit decision
  pending the provisional-patent question; building is not disclosing

## Context

**Origin.** The full architecture is specified in
`docs/p2p-native-cloud-design.md` — Part I is the execution substrate
(native→WASM AOT, artifact caching), Part II is the P2P fabric (trust topology,
scheduling, map/reduce, sovereignty). This project implements it.

**The novel composition** (per the doc's own risk framing): unifying managed and
safely-sandboxed native execution via AOT-to-WASM, sovereignty-by-placement as a
first-class scheduling constraint, and a per-job trust dial. The individual
pieces are proven — Bacalhau and IPVM for compute-to-data, Fluence for
coordinator-free task graphs, libp2p for transport, elfconv for binary lifting.
The combination has not shipped as a product.

**Why TypeScript + WASM.** Portability is the product. A node that runs in a
browser tab makes every page visitor a potential participant, which is the only
way "capacity scales with the user base" becomes literal rather than aspirational.
It also collapses a layer: in the browser the WASM runtime *is* V8, so Wasmtime
and WasmEdge disappear from the edge tier entirely, and the doc's §I.6 V8
code-caching path becomes first-class rather than an afterthought.

**Where the real research risk lives** (doc §5): decentralized scheduling that
stays efficient under churn, locality, and trust constraints simultaneously;
tree-reduce robustness when the aggregation backbone itself churns; keeping the
verification tax affordable at scale.

**Legal posture.** Dual-licensed and source-available, not open source. The
default track permits viewing and a 32-day commercial trial; anything more needs
a signed commercial agreement. Both licenses are unreviewed drafts.

## Constraints

- **Tech stack**: TypeScript + WASM — must run in browser, Node.js, and embedded
  in host apps without a separate build per target
- **Connectivity**: Browser-to-browser libp2p requires a publicly reachable
  Circuit Relay v2 node for the WebRTC SDP handshake, and browsers can only dial
  `DNS + WSS` multiaddrs. Circuit Relay v2 reservations are capped at ~1 hour with
  bandwidth limits by design
- **Hosting**: GitHub Pages serves static files only and runs no server-side
  process — it can host the client but not a relay or bootstrap node
- **Disclosure**: Public hosting is public disclosure. EPO and China have no
  patent grace period, so publishing forfeits those rights permanently. Deployment
  must be a separately-triggered gate, not an automatic consequence of a phase
  completing
- **Platform**: `elfconv` requires AArch64, statically-linked, unstripped binaries
  and is a C++/LLVM/Remill toolchain — a build-time dependency producing `.wasm`,
  not a TypeScript component
- **Contributions**: None accepted; sole authorship preserves the commercial
  license track

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + WASM for the node agent | Portability is the product; browser execution makes "capacity scales with users" literal. Collapses the WASM-runtime layer to V8 in the browser | — Pending |
| Relay: DHT-discovered public IPFS infra primary, own backbone relay as fallback | Public infra is on-message and is functionality §3.4 needs anyway; Relay v2's 1-hour capped reservations make it too flaky to be the demo's only path. Doc §3.7 already prescribes running relays on the backbone | — Pending |
| Build the public demo, gate publishing separately | Building discloses nothing; deploying does. Keeps the provisional-patent option alive until explicitly surrendered | — Pending |
| Full scope in v1, Part I sequenced last | Fine granularity allows elfconv AOT as late phases, so it doesn't block the capacity-scaling and sovereignty thesis the doc's §6 front-loads deliberately | — Pending |
| Demo target: multi-machine + multi-tab, plus benchmark harness | A live demo proves it *works*; published benchmark numbers prove the *scaling thesis*. Source proves authorship. All three are needed | — Pending |
| No outside contributions | Sole authorship keeps the commercial license track available for every line, with no CLA machinery | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-24 after initialization*
