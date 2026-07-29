# o2.services — P2P Native Cloud

A peer-to-peer compute fabric that runs untrusted code safely on volunteer and
enterprise nodes, moves code to data instead of data to code, and keeps each
owner's data pinned to their own device.

The node agent is TypeScript + WASM, so the same build runs unmodified in a
browser tab, in Node.js, or embedded in a host application — which makes every
visitor to a web page a potential compute node.

**Live:** <https://o2alexanderfedin.github.io/o2.services/>

> That page is a real node, but it cannot join anything on its own and it says so.
> A browser cannot accept incoming connections, so two tabs need a publicly
> reachable [Circuit Relay v2](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
> peer to exchange WebRTC signalling, and GitHub Pages runs no server process.
> Supply one with `?relay=<multiaddr>`.
>
> The deployed bundle predates Phase 9 — the consent gate, the running bar and the
> colouring job are in this repository but not on that URL. Republishing is a
> deliberate human act (see [Disclosure](#disclosure)).

---

## Core value

**Usable capacity grows super-linearly with the user base, without any raw data
leaving its owner's device.**

Stated as a falsifiable claim: a map/reduce job must distribute across N
independently-owned nodes, return a result whose integrity is demonstrable, and
demonstrably never move the underlying data off the owner's node.

### What "demonstrable integrity" means precisely

Sovereignty and N-version verification **cannot both apply to the same task** —
pinning data to one node removes the second independent executor. The system
therefore splits the claim rather than blurring it:

| Data | Integrity mechanism |
| --- | --- |
| Public / shared | Full N-version redundant execution with commit–reveal, ≥1 replica backbone-anchored |
| Sovereign (owner-pinned) | Map is **owner-attested**; the aggregation *over* contributions is verified |

Plainly: *the owner's contribution is trusted; the aggregation over contributions
is verified.* The sovereignty claim itself is carried by an egress manifest and a
coverage report, not by a quorum.

---

## Quick start

```bash
git clone https://github.com/o2alexanderfedin/o2.services.git
cd o2.services
npm install          # Node 24 LTS is specified; 23.x works but prints EBADENGINE
```

Run a seed on your own machine and open the URL it prints — including from a
phone on the same network:

```bash
node packages/node/src/bin/seed.ts
```

It prints a `.local` URL and a QR code. The page asks its own origin which relay
to dial, so nothing needs configuring.

### Other entry points

| Command | What it does |
| --- | --- |
| `node packages/node/src/bin/seed.ts` | Seed node: relay, rendezvous, and serves the demo page |
| `node packages/node/src/bin/agent.ts` | Headless node agent. Takes `--owner-id`, `--can-execute-sovereign` |
| `node packages/node/src/bin/bench.ts` | Benchmark harness |
| `npm run build:demo` | Builds the static browser bundle. Builds only — it publishes nothing |
| `npm test` | Full suite (~5 min; the AOT tests really do drive Docker) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run aot:lift` | native → WASM ahead-of-time translation CLI |

---

## Architecture

Eight workspace packages. The split exists so the kernel stays portable and every
environment-specific concern lives at an edge.

| Package | Role |
| --- | --- |
| `@o2/core` | The portable kernel — executor, determinism gate, verifier, job submission, placement, sovereignty guard. No network, no filesystem, no DOM |
| `@o2/net` | Wire protocol, RPC, the `serveAgent` hook contract, egress guard |
| `@o2/libp2p` | libp2p transport adapter |
| `@o2/node` | `FabricNode`, the three `bin/` entry points, filesystem blockstore |
| `@o2/browser` | `BrowserNode`, consent gate, IndexedDB blockstore, the demo page |
| `@o2/aot` | native → WASM translation pipeline (elfconv), ABI router |
| `@o2/bench` | Benchmark harness, statistics, reporting |
| `@o2/demo` | Demo workloads |

**The kernel is byte-identical across environments.** The same job runs in one
Node process, across two OS processes over TCP, and between two browser tabs over
WebRTC, with only adapters swapped.

### Constraints that shaped the design

These are measured or documented facts, not preferences. Several were discovered
the expensive way.

- **Browser→browser is WebRTC, and only WebRTC.** There is no alternative and no
  fallback. Every browser peer needs a reachable Circuit Relay v2 server to be
  dialable at all.
- **The relay is a signalling channel, not a data path.** Verified js-libp2p
  defaults: 2-minute duration limit, 128 KiB data limit, 15 concurrent
  reservations. Once two browsers complete their handshake, the relay drops out.
- **The browser mesh cannot carry bulk data.** WebRTC caps messages at 16 KiB in
  js-libp2p; Chromium closes the channel above 256 KiB and will not reassemble
  Firefox's fragments. Partials stay small; artifacts fetch over an IPFS gateway.
- **Determinism is a property of the published artifact, not a runtime setting.**
  V8 exposes no NaN-canonicalization and no relaxed-SIMD control — verified
  against `node --v8-options`. Both must therefore be settled at publish time.
- **`WebAssembly.instantiate` is the sandbox.** There is no host-import allow-list,
  by decision — the engine already refuses and names the offending import.
- **The kernel never requires `crypto.subtle`.** A LAN origin is not a secure
  context, and the demo has to work on a phone on your own network.
- **elfconv's exit code is never trusted.** It exits `0` on binaries it could not
  fully translate — 174 unrecovered addresses on a hello-world. The driver measures
  the produced module instead.

---

## Status

**Phases 1–13 complete.** Milestone v1.1 ("Wire What Was Built") is in progress at
3 of 14 phases.

Requirements ledger: **39 closed, 43 open.**

### What is demonstrated

- A redundant, verified map job running in one Node process, in a browser, and in
  a Worker.
- The same job across two OS processes over real TCP + Noise + yamux, with the
  kernel unchanged.
- Two browser tabs completing a 2×-redundant job over a **direct** WebRTC
  connection, with the relay proven out of the data path.
- An iPhone running Safari and a laptop running Chromium completing the same job
  over direct WebRTC.
- IndexedDB and filesystem blockstores producing identical CIDs.
- 16 browser peers holding relay reservations simultaneously.
- A real elfconv-translated artifact executing against the WASI executor, ABI
  verified: 23 WASI imports, `_start` and `memory`, every import answered.
- Sovereign data pinned to its owner: a job whose input never leaves the owning
  node, with an egress manifest recording what crossed the wire.

### What is explicitly *not* demonstrated

The project distinguishes **descoped** from **satisfied**, and **unmeasured** from
**met**. These are recorded as unmet:

- **Peers on genuinely different machines over the public internet.** Needs a
  hosted relay with automatic TLS.
- **Cross-machine reproducibility (AOT-03) and distinct-machine benchmarking
  (BENCH-06).** Descoped to same-machine testing by owner decision; closing either
  would need hardware the project does not have. A `CROSS_MACHINE_BLIND_SPOT`
  marker stays attached to every lifted artifact.
- **V8 WASM code caching.** Measured and *not* observed: at 4.8 MB,
  `application/wasm`, query-free CID URL, `compileStreaming`, across three visits —
  no code-cache entry, while the same profile grew a 2 MB JavaScript cache.
  Reported unmet rather than reworded.
- **Parallel speedup at scale.** Every published benchmark curve currently runs N
  nodes on one event loop, so no parallel speedup is measurable at any N. A
  multi-process driver is planned.

---

## Testing

```bash
npm test              # everything
npm run typecheck     # tsc --noEmit
```

Vitest runs two projects from one config — `node` and `browser` (Playwright:
Chromium, Firefox, WebKit) — over the same test files where applicable. Test
suffixes are load-bearing: `*.node.test.ts`, `*.browser.test.ts`, `*.e2e.test.ts`.

Multi-node tests come in three shapes: in-process over a memory transport for
determinism, real OS processes spawned via `spawn(process.execPath, …)` for
genuine cross-process behaviour, and Playwright browser contexts for real WebRTC.

**Testing standard:** same machine, different browsers, browser contexts, or OS
processes. "A second machine" is not a blocker on any criterion in this project.

Two guard suites protect constraints that are easy to erode silently:
`vocabulary.node.test.ts` and `disclosure-gate.node.test.ts`.

---

## Disclosure

**The repository is public by explicit decision.** EPO and China have no patent
grace period, so those rights are permanently forfeit for everything disclosed. A
US provisional remains possible for 12 months from first disclosure, and that
window is running.

Consequently: **no deploy workflow file may exist in this repository at all** —
absent, not disabled — and no `package.json` script may publish.
`disclosure-gate.node.test.ts` enforces both, checks for workflow files by
*content* so relocation does not evade it, and verifies its own publish-command
patterns actually match the commands they claim to catch. `build:demo` builds and
publishes nothing. Deployment is a separately-triggered human act.

---

## Documentation

| Document | Contents |
| -------- | -------- |
| [P2P Native Cloud — Master Architecture Design](docs/p2p-native-cloud-design.md) | Part I: the execution substrate (native→WASM AOT, artifact caching). Part II: the P2P fabric (trust topology, scheduling, map/reduce, sovereignty). |
| [CLAUDE.md](CLAUDE.md) | Verified technology stack, version compatibility matrix, and the constraints above with their evidence. |

---

## Development

This project uses [git-flow](https://github.com/nvie/gitflow) (v0.4.1).

| Branch      | Purpose                 | `git flow` subcommand |
| ----------- | ----------------------- | --------------------- |
| `main`      | Production releases     | —                     |
| `develop`   | Development integration | —                     |
| `feature/*` | New features            | `feature`             |
| `release/*` | Release preparation     | `release`             |
| `hotfix/*`  | Production fixes        | `hotfix`              |
| `support/*` | Long-lived support      | `support`             |

`bugfix/*` is also accepted by the hook, but has no `git flow` subcommand in
v0.4.1 — create it manually, or upgrade to
[gitflow-avh](https://github.com/petervanderdoes/gitflow-avh)
(`brew install git-flow-avh`) which adds `git flow bugfix`.

`main` and `develop` are protected by a `pre-commit` hook — direct commits are
rejected. All work goes through a branch:

```bash
git flow feature start <feature-name>
# make changes, commit
git flow feature finish <feature-name>
```

### Hook installation

Git hooks live in `.git/hooks/` and are **not** cloned. After cloning, install the
branch-protection hook:

```bash
./scripts/install-hooks.sh
```

---

## License

**Dual-licensed**, source-available, **not** open source. The default track
applies automatically; the commercial track requires a signed agreement. You
cannot elect between them.

| | [Default](LICENSE) | [Commercial](LICENSE-COMMERCIAL.md) |
| --- | --- | --- |
| Applies to | everyone, automatically | signed parties only |
| View source | ✅ | ✅ |
| Commercial trial evaluation | ✅ up to 32 days | ✅ |
| Use beyond trial / production | ❌ | ✅ negotiated |
| Modification | ❌ | ✅ negotiated |
| Derivative works | ❌ | ✅ negotiated |
| Redistribution / embedding | ❌ | ✅ negotiated |
| Patent rights | ❌ reserved | ✅ negotiated |
| Support, SLA, indemnity | ❌ | ✅ negotiated |

Commercial licensing: **af@O2.services**

> **Draft — not reviewed by counsel.** Do not rely on either license or execute a
> commercial agreement before an attorney reviews them.

## Contributions

**Not accepted.** Pull requests will be closed without review — see
[CONTRIBUTING.md](CONTRIBUTING.md). This keeps the dual-license model intact by
construction: the licensor owns every right in the software, so the commercial
track stays available for all of it.

Bug reports are welcome as issues. Security reports go to **af@O2.services**.
