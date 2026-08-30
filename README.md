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

**Milestone v1.1 ("Wire What Was Built") is in progress at 5 of 14 phases verified.**

v1.0 left 36 capabilities **built but unreachable** — real code, with its own tests,
that no runnable program ever called. That count is now **22**, with 11 more partly
wired. Reducing it is what this milestone measures.

Requirements ledger: **40 closed, 42 open.**

A phase closes when an independent pass says so, scored against its own success
criteria — not when its plans finish. Two phases sit at "nearly done" and are
deliberately **not** counted, because one criterion each is only half-proven.

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
- **Code that runs only if a trusted key vouched for it.** Modules resolve through
  a signed name→CID mapping; an unsigned or wrongly-signed one is refused *before
  the bytes are fetched*, shown by finding the node's block directory empty after a
  refusal — read from a separate process, not inferred.
- **Tasks that carry their own permission.** A dispatched task presents a chain of
  delegation rooted in the data owner's key, and the receiving node verifies it
  before instantiating anything.
- **Results merged up a derived tree** across eight and nine spawned processes,
  matching a single-machine reference byte-for-byte.
- **Nodes with cryptographic identities of their own**, enrolled with a provider
  and verifiable by other nodes **offline** — proven with the authority process shut
  down and asserted dead, so nobody could have been consulted.
- **Browser tabs enrolled on identical terms**, including on a plain-HTTP LAN
  origin where WebCrypto is unavailable.

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
- **A cost on creating fake identities.** Enrollment is rate-limited and the
  threshold is stated in the refusal — but the limit is keyed on a user key, which
  costs one key generation, and the budget is per provider *process*. So the
  hundredth fake identity costs what the first did. Rate-limiting is measured; cost
  is not, and the difference is recorded rather than blurred.
- **Peer-to-peer acceptance across separate processes.** A node rejecting a forged
  certificate is proven across processes; a node *accepting* a valid one is not,
  because no command-line flag yet makes one spawned agent dial another. Scheduled,
  not assumed.
- **Distribution of large artifacts.** A lifted native program is 5.40 MiB and
  nothing has yet moved one between machines that did not already have it — the demo
  embeds its module in the bundle. Content addressing says whether the bytes are
  right, never whether anyone still holds them.

---

## Testing

```bash
npm test              # everything
npm run typecheck     # tsc --noEmit
```

Vitest runs **four** projects from one config — `node`, `browser` (Playwright:
Chromium, Firefox, WebKit), `e2e`, and `perf` (gated behind `O2_PERF=1`) — over the
same test files where applicable. Test suffixes are load-bearing:
`*.node.test.ts`, `*.browser.test.ts`, `*.e2e.test.ts`, `*.perf.test.ts`.

Select a project explicitly (`vitest run --project node`). A bare path filter fans
out across all four and is far slower than it looks.

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

**[AGPL-3.0-or-later](LICENSE)** by default — free to use, modify and
redistribute — **or a [commercial licence](LICENSE-COMMERCIAL.md)** for anyone
who cannot accept AGPL §13. The AGPL applies automatically; you sign nothing and
ask no one. Full explanation: **[LICENSING.md](LICENSING.md)**.

| | [AGPL-3.0-or-later](LICENSE) | [Commercial](LICENSE-COMMERCIAL.md) |
| --- | --- | --- |
| Applies to | everyone, automatically | signed parties only |
| Cost | free | negotiated |
| Use, including in production | ✅ | ✅ |
| Modification, derivative works | ✅ | ✅ |
| Redistribution, embedding | ✅ | ✅ |
| Patent licence | ✅ granted (§11) | ✅ negotiated |
| **Publish your source changes** | ✅ **required** | ❌ not required |
| **Publish source to network users** | ✅ **required** (§13) | ❌ not required |
| Warranty, SLA, indemnity | ❌ none | ✅ negotiated |

**If you are a volunteer running a node, you owe nothing.** §13 asks the source
of a *modified* version from whoever *offers it as a service*. Joining the fabric
is using it, not offering it.

Commercial licensing: **af@O2.services**

**Changed 2026-08-30.** The previous default was the source-available
*O2.services Trial License 1.0* — view only, 32-day evaluation, no modification.
It contradicted this project's own recorded decision to be open source, and is
preserved at [LICENSE-TRIAL-1.0.md](LICENSE-TRIAL-1.0.md) so that anyone who
accepted it keeps that grant. The change only loosens: everyone else now has
strictly more than those terms allowed.

> **Draft — not reviewed by counsel.** The AGPL text is the Free Software
> Foundation's, unmodified. `LICENSE-COMMERCIAL.md` and `LICENSING.md` are this
> project's own and have not been reviewed by an attorney.

## Contributions

**Not accepted.** Pull requests will be closed without review — see
[CONTRIBUTING.md](CONTRIBUTING.md). This keeps the dual-license model intact by
construction: the licensor owns every right in the software, so the commercial
track stays available for all of it.

Bug reports are welcome as issues. Security reports go to **af@O2.services**.
