# Pitfalls Research

**Domain:** Browser-based P2P distributed compute fabric (TypeScript + WASM, js-libp2p, IPFS, redundant-execution verification)
**Researched:** 2026-07-24
**Confidence:** HIGH for libp2p defaults and WASM determinism (read from source / spec); HIGH for the cryptojacking-perception evidence (vendor blogs, browser policy docs); MEDIUM for benchmark and distributed-systems traps (peer-reviewed but not project-specific); MEDIUM-LOW for browser lifecycle numbers (vendor behaviour changes and is under-documented for Workers specifically)

> **Phase names used below are suggestions to the roadmap author**, since no roadmap exists yet. They follow the doc's §6 MVP sequence:
> **P0** Determinism & verification spike · **P1** Node agent + WASM execution · **P2** Transport & connectivity · **P3** Content-addressed data + sovereignty pinning · **P4** Placement & scheduling · **P5** Map/reduce + tree-reduce · **P6** Benchmark harness · **P7** Public demo, consent UX & hosting · **P8** elfconv AOT pipeline

---

## Critical Pitfalls

These are ordered by **how badly they invalidate the core thesis or the published numbers**, not by likelihood.

---

### Pitfall 1: Redundant-execution verification is unsound in the browser — honest nodes on x86 and ARM disagree bitwise

**What goes wrong:**
`PROJECT.md` requires "Result integrity via redundant execution and result comparison." That mechanism assumes two honest nodes running the same WASM on the same input produce byte-identical output. In the browser they do not, because **WebAssembly deliberately leaves NaN bit patterns nondeterministic**, and V8 exposes no knob to fix it.

The specific divergence is architectural, not theoretical. From [WebAssembly/design#477](https://github.com/WebAssembly/design/issues/477): when a platform must produce a *new* NaN, **x86 sets the sign bit to 1 and ARM sets it to 0**. So `0.0/0.0` or `sqrt(-1.0)` in the same `.wasm` yields `0xFFC00000` on an Intel laptop and `0x7FC00000` on an M-series Mac or an Android phone. A SHA-256 over the output buffer differs. Your quorum sees a 50/50 split between two honest nodes and cannot tell which — or worse, it flags the ARM majority as malicious and slashes them.

[`design/Nondeterminism.md`](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md) enumerates the full set: NaN payload bits, NaN sign bit when no input was NaN, **relaxed-SIMD instructions** ("The relaxed SIMD instructions have nondeterministic results"), **shared memory** load/RMW/wait/wake with threads, host-call arguments and ordering, and **resource-exhaustion timing** (`memory.grow` / `table.grow` failing at environment-dependent points).

**Why it happens:**
Everyone reads "WASM is deterministic" as a marketing slogan and stops there. It is *nearly* deterministic — non-NaN float arithmetic really is bit-exact IEEE-754 with no FMA contraction and no x87 extended precision, which is far better than native — and that near-miss is exactly what makes it dangerous. Demos pass because the developer's laptop, CI runner, and test peers are all the same architecture. The divergence surfaces the day a phone joins the mesh.

The second-order cause: server-side runtimes *do* solve this and people assume the browser inherits the fix. [Wasmtime's determinism guide](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html) tells you to enable `cranelift_nan_canonicalization`, set `wasm_relaxed_simd(false)` or `relaxed_simd_deterministic`, virtualize WASI clocks/filesystem with `wasi-virt`, reject or pre-allocate memory/table growth via a `limiter`, and prefer **fuel-based** over epoch-based interruption. **None of those controls exist in V8.** Choosing the browser as the execution tier means giving up every engine-side determinism lever the prior art relies on.

**How to avoid:**
Determinism has to move from the *engine* to the *artifact* and the *comparison function*:

1. **Validate module bytes before accepting a task.** Parse the `.wasm` and reject any module that uses relaxed-SIMD opcodes, `atomic.*` / shared memory, or imports outside a fixed deterministic allow-list. This is a hard admission gate, not a lint.
2. **Canonicalize NaN in the producer, not the consumer.** Require verification-eligible modules to be built with a NaN-canonicalizing pass, or to canonicalize floats in the output buffer before returning. A cheap enforcement: require the module to declare its output schema so the verifier canonicalizes typed float fields before hashing, instead of hashing raw bytes.
3. **Hash canonical form, never the raw output buffer.** Padding bytes, allocator residue, and NaN payloads all leak into a naive `sha256(memory[ptr..ptr+len])`.
4. **Restrict the verification-eligible workload class in v1** to integer / bit-exact-float outputs. Say this out loud in the docs rather than discovering it during the demo.
5. **No host imports beyond a frozen deterministic shim.** No `Date.now`, `performance.now`, `crypto.getRandomValues`, no locale/`Intl`, no JS `Math` transcendentals (`Math.pow/exp/sin` are implementation-defined across engines *and across V8 versions* — keeping libm inside the `.wasm` is what makes it deterministic). Bacalhau's approach is the reference: it ticks a virtual clock one step per call and seeds a deterministic PRNG ([Bacalhau CoD deep dive](https://blog.bacalhau.org/p/compute-over-data-summit-technical)).
6. **Non-negotiable: a cross-architecture divergence harness as a P0 gate.** Same module, same input, run on x86-64 Chrome, x86-64 Firefox, arm64 Safari, arm64 Chrome, Android Chrome, and Node.js on both arches. Assert byte-identical output. Run it in CI forever. This is the single highest-value experiment in the project.

**Warning signs:**
- Test peers are all the same CPU architecture.
- The verifier compares `sha256` of a raw linear-memory slice.
- The word "deterministic" appears in the design with no accompanying opcode allow-list.
- Any quorum disagreement is triaged as "a bad node" without first checking architecture.
- Reduce partials contain floats and are compared for equality anywhere.

**Phase to address:** **P0** (spike, before anything else is built) and enforced in **P1**. The result gates whether "redundant execution + comparison" is even a viable v1 integrity mechanism — if it is not, the trust story changes and the roadmap changes with it.

---

### Pitfall 2: js-libp2p Circuit Relay v2 defaults silently cap the demo at ~15 browser peers, 128 KiB, and 2 minutes

**What goes wrong:**
The demo works with three tabs and dies at scale, for reasons that are *hardcoded defaults*, not tuning. Read from js-libp2p `main` today ([`transport-circuit-relay-v2/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/constants.ts)):

```ts
export const DEFAULT_MAX_RESERVATION_STORE_SIZE = 15    // 16th browser peer gets RESERVATION_REFUSED
export const DEFAULT_MAX_RESERVATION_TTL = 2 * 60 * minute   // 2 hours
export const DEFAULT_DURATION_LIMIT = 2 * minute        // per relayed connection
export const DEFAULT_DATA_LIMIT = BigInt(1 << 17)       // 128 KiB per relayed connection
export const MAX_CONNECTIONS = 300
```

And [`server/reservation-store.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/server/reservation-store.ts) shows `applyDefaultLimit` is **on unless explicitly set to `false`**, and reservation #16 is refused outright:

```ts
this.applyDefaultLimit = init.applyDefaultLimit !== false
if (this.reservations.size >= this.maxReservations && reservation == null) {
  return { status: Status.RESERVATION_REFUSED }
}
```

Three distinct failure modes fall out:
- **A default relay serves 15 browser peers.** Not 15 concurrent jobs — 15 *reservations*. "Distributes real work across browser tabs and machines" hits a wall at 16.
- **Any data path through the relay dies at 128 KiB or 120 seconds.** Silently, mid-stream. For browser↔browser WebRTC the relay only carries the SDP handshake so this is survivable, but the moment a peer falls back to `p2p-circuit` as an actual transport — which js-libp2p will do — transfers truncate.
- **Your protocols will not run over a relayed connection at all** unless you explicitly opt in. From [`@libp2p/interface`](https://github.com/libp2p/js-libp2p/blob/main/packages/interface/src/index.ts): *"is a circuit relay address, passing true here would cause the test to fail because that protocol would not be allowed to run over a data/time limited connection"* — you need `runOnLimitedConnection: true` on both `handle()` and `dialProtocol()`. Forget it and you get a protocol-negotiation failure that looks like a peer bug.

There is also an open reliability report: [js-libp2p#2833](https://github.com/libp2p/js-libp2p/issues/2833), "Circuit relay stops accepting relay requests" after 5–10 peer connections, unresolved, workaround = reboot the relay.

**Why it happens:**
The design doc treats relays as a connectivity detail ("run them on the backbone"). Circuit Relay v2 is [resource-constrained *by design*](https://libp2p.io/docs/webrtc-browser-connectivity/) — it is a rendezvous mechanism deliberately made unattractive as a data path so that random public peers can safely offer it. Building capacity plans on top of it inverts its intent.

**How to avoid:**
- **Run your own relay and configure it explicitly.** `maxReservations` sized to your target peer count with headroom (and remember `MAX_CONNECTIONS = 300` is a separate ceiling), `applyDefaultLimit: false` or generous explicit `defaultDataLimit`/`defaultDurationLimit`, `reservationTtl` tuned. Pin the js-libp2p version and re-read these constants on every upgrade — they are internal and can change.
- **Architect so the relay carries signalling only.** Relay bytes should be SDP, never task payloads and never reduce partials. Make that an invariant with a test: assert relayed-connection byte counters stay under a few KiB per peer.
- **Set `runOnLimitedConnection: true` on every protocol you register**, or consciously decide a protocol is post-upgrade-only and assert it.
- **Instrument reservation state as a first-class metric** — reservations held, refusals, renewals, time-to-refusal — and surface it in the demo. `libp2p_circuit_relay_server_reservations_total` already exists.
- **Load-test the relay before the demo**, not during. N headless browser peers reserving simultaneously, held for an hour, with churn.

**Warning signs:**
- Peer count in tests never exceeds ~10.
- Connections succeed but streams close after roughly two minutes or roughly 128 KiB.
- `RESERVATION_REFUSED` or `RESOURCE_LIMIT_EXCEEDED` in logs, treated as transient.
- The relay needs periodic restarts.

**Phase to address:** **P2**, with a relay load-test as an explicit exit criterion.

---

### Pitfall 3: The logged relay decision is backwards — browsers cannot dial most public IPFS infrastructure, and WebRTC-Direct certhashes expire in 14 days

**What goes wrong:**
`PROJECT.md` logs the decision *"Relay: DHT-discovered public IPFS infra primary, own backbone relay as fallback."* The evidence says this is inverted.

Browsers can only dial WSS (needs a **DNS name + CA-signed cert**), WebTransport, or WebRTC-Direct (needs a **certhash** in the multiaddr). The overwhelming majority of public IPFS/libp2p nodes listen on raw TCP/4001 and QUIC only. From the libp2p forum ([discuss.libp2p.io #1990](https://discuss.libp2p.io/t/browser-nodes-cannot-use-the-majority-of-public-nodes-as-relay/1990)): *"Browser nodes can only dial nodes that offer websocket transports. But the vast majority of public nodes do not have websocket transport"* — the reporter's attempt failed with `there are no valid addresses available to dial` and only worked against a self-hosted WSS relay.

Compounding it, the browser cannot help itself out via the DHT: browser peers run kad-dht in **client mode**, which per the [kad-dht spec](https://github.com/libp2p/specs/blob/master/kad-dht/README.md) means they do not advertise the protocol, are not added to anyone's routing table, and cannot serve records. And per libp2p's own docs, browser peers *"don't tend to be long-lived enough to appear in the results"* of `FIND_NODE` — so browser-to-browser DHT discovery is structurally weak, and the recommended demo alternative (pubsub peer discovery) is documented as *"not battle-tested for production"* and *"probably not fit for production use cases"* ([WebRTC with js-libp2p](https://libp2p.io/docs/webrtc-browser-connectivity/)).

Separately, if you try to sidestep WSS with a hardcoded WebRTC-Direct multiaddr, note from [`transport-webrtc/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-webrtc/src/constants.ts):

```ts
export const DEFAULT_CERTIFICATE_LIFESPAN = 1_209_600_000   // 14 days
export const DEFAULT_CERTIFICATE_RENEWAL_THRESHOLD = 86_400_000
```

The self-signed cert rotates every 14 days, so the certhash in your bootstrap multiaddr goes stale. A demo that worked at recording time is dead two weeks later, with a failure that looks like a network outage.

**Why it happens:**
"libp2p handles NAT traversal" is true for Go/Rust nodes and materially false for browsers. And "IPFS has a huge public network" is true for *content*, not for *browser-dialable relay capacity*.

**How to avoid:**
- **Invert the decision: your own WSS relay with a real domain and a CA-issued cert is the primary path.** Public infra is opportunistic bonus capacity. Revisit that row in `PROJECT.md` before the roadmap locks.
- **Never hardcode a certhash.** Resolve bootstrap addresses at runtime — `dnsaddr` TXT records or a tiny static JSON manifest fetched from the same origin. GitHub Pages *can* serve that manifest.
- **Explicitly design a discovery mechanism that isn't kad-dht-from-the-browser.** A signed peer-list endpoint, or backbone rendezvous, or gossipsub anchored on the backbone. Own the fact that the sovereignty/scheduling story leans on backbone nodes for discovery.
- **Budget for ~80% hole-punch success**, which is what libp2p's own docs state for public networks. 20% of peers will be relay-only forever.

**Warning signs:**
- Bootstrap multiaddrs with a literal `/certhash/` string checked into source.
- Any test that only passes on localhost or same-LAN.
- Discovery relies on `getProviders` executed *in the browser*.
- Demo works, then fails ~2 weeks later with no code change.

**Phase to address:** **P2**. Revise the `PROJECT.md` relay decision during roadmap creation.

---

### Pitfall 4: The cryptojacking-perception problem — security tooling blocks opt-in browser compute too

**What goes wrong:**
"Every page visitor is a compute node" is, at the network and behavioural level, **identical** to drive-by cryptomining: a page loads, spawns Workers, pegs CPU, runs WASM, and talks to peers. The precedent is unambiguous and it is not merely reputational — the blocking is *default-on* in shipping browsers:

- **Firefox blocks known cryptominers by default** for all users via the Disconnect list, as part of Enhanced Tracking Protection ([Mozilla, 2019](https://blog.mozilla.org/en/firefox/todays-firefox-blocks-third-party-tracking-cookies-and-cryptomining-by-default/)). No user action required. If the o2.services demo domain lands on that list, a large fraction of Firefox visitors get a broken page with no error you can see.
- **Consent did not save Coinhive.** Coinhive shipped AuthedMine, an explicitly opt-in API, and complained that anti-malware vendors *"identify our opt-in version as a threat and block it."* Malwarebytes' telemetry showed opt-in usage at ~40K/day against ~3M/day for the silent version — plausibly *because* blocking made the honest path pointless ([Malwarebytes Labs](https://www.malwarebytes.com/blog/news/2017/10/why-is-malwarebytes-blocking-coinhive/), [The Register](https://www.theregister.com/2017/10/19/malwarebytes_blocking_coin_hive_browser_cryptocurrency_miner_after_user_revolt/)).
- **Google banned all mining extensions from the Chrome Web Store and Play Store** in 2018 after ~90% of them violated the disclosure policy ([TechCrunch](https://techcrunch.com/2018/04/02/google-is-banning-all-cryptomining-extensions-from-its-chrome-web-store/)). The policy space moved from "allowed with consent" to "categorically banned" because of abuse by others.
- **Edge** ships PUA blocking that covers cryptominers; **Brave** blocks miners as part of default shield lists.
- **Salon.com is the cautionary tale for the honest actor**: an opt-in implementation that ran unthrottled and crippled machines, which is how a legitimate deployment earns a blocklist entry on the merits.

The consequence for this project: the demo's failure mode is *invisible*. Visitors don't report "your miner was blocked" — the page just contributes nothing, and your node-count graph quietly under-reports.

**Why it happens:**
The heuristics are behavioural (sustained CPU + WASM + WebSocket/WebRTC) and list-based (domain reputation). Neither can read your intent. And the reputational asymmetry is brutal: getting listed takes one automated classifier; getting delisted takes weeks of human appeals across several independent vendors.

**How to avoid:**
Treat this as a **product requirement with a measurable acceptance criterion**, not a comms afterthought:

1. **Never auto-start on page load.** Explicit, per-session, affirmative user action. No pre-checked boxes, no "by continuing you agree."
2. **Persistent, visible control surface** while running: what is being computed, for whom, current CPU share, cumulative CPU-seconds contributed, and a one-click stop that actually stops.
3. **Hard resource budget, default conservative.** Cap Workers well below `hardwareConcurrency` (e.g. `max(1, cores/4)`), yield between slices, auto-pause on `visibilitychange: hidden`, and refuse to run on mobile/battery by default. Salon's mistake was the unthrottled miner, not the consent dialog.
4. **Never run in a hidden iframe, after navigation away, in a service worker, or via `sendBeacon` persistence.** Every one of those is a documented cryptojacking persistence technique and will get you classified instantly.
5. **Vocabulary discipline.** No "mining", "hashrate", "earn", "credits", "tokens". `PROJECT.md` already puts incentives out of scope — keep the *language* out of scope too, on the page and in the repo.
6. **Publish a plain-language policy page** describing exactly what runs, what data is touched, and how to opt out — the thing a human reviewer at Disconnect/Malwarebytes will read during an appeal.
7. **Ship a first-class metric: "% of visitors where the node failed to start."** Segment by browser. A Firefox-specific cliff is your blocklist alarm.
8. **Pre-register the appeal path.** Know before launch how to contact Disconnect, Malwarebytes, uBlock Origin/EasyPrivacy, and Google Safe Browsing. Grep your own domain against public blocklists on a schedule.
9. **Fold this into the disclosure gate.** `PROJECT.md` already gates public hosting on the patent question — add "consent UX and blocklist-risk review complete" to that same gate.

**Warning signs:**
- Any code path that starts compute without a click.
- Worker count derived directly from `navigator.hardwareConcurrency`.
- Compute continues while the tab is hidden on a laptop or phone.
- Firefox-only support reports, or Firefox conversion materially below Chrome.
- Words like "mine"/"hashrate" anywhere in the UI.

**Phase to address:** **P7**, but the resource-governor hooks (throttle, pause, budget) must be designed into **P1**'s node runtime — retrofitting a governor into a scheduler that assumes full CPU is a rewrite.

---

### Pitfall 5: Benchmark numbers that are technically true and materially false

**What goes wrong:**
`PROJECT.md` stakes credibility on published scaling numbers. The literature on how these get inflated is old, specific, and directly applicable.

**[Scalability! But at what COST?](https://www.usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf)** (McSherry, Isard, Murray, HotOS '15) defines **COST** — *Configuration that Outperforms a Single Thread* — and surveys SOSP/OSDI data-parallel systems, finding *"many systems have either a surprisingly large COST, often hundreds of cores, or simply underperform one thread for all of their reported configurations."* GraphLab's COST was 512 cores; GraphX's was unbounded. **A system can scale beautifully purely because it has enormous parallelizable overhead.** A P2P fabric with content addressing, capability verification, DHT lookups, WebRTC framing at 16 KiB, and 2–3× redundant execution has *a lot* of parallelizable overhead. Perfect scaling curves are the expected artifact, not evidence of value.

**[Twelve Ways to Fool the Masses](https://www.davidhbailey.com//dhbpapers/twelve-ways.pdf)** (Bailey, 1991) catalogues the classic distortions — comparing tuned parallel code against untuned serial code, quoting scaled/weak speedup as if it were strong speedup, choosing the problem size that makes the curve work, quoting peak rather than sustained rates, and omitting the baseline entirely.

Project-specific traps that would produce dishonest numbers here, ranked by how easy they are to commit *by accident*:

| Trap | Why it inflates | Honest form |
|---|---|---|
| **N tabs on one machine counted as N nodes** | Tabs share the same cores. 10 tabs ≠ 10× anything; past `hardwareConcurrency` you measure the OS scheduler. | Report *physical machines* and *cores* separately from *tabs*. Multi-tab is a portability demo, never a scaling data point. |
| **"Super-linear" stated without its mechanism** | The single loudest red flag in performance claims. | `PROJECT.md`'s claim is defensible only in a precise form: each new user contributes *both* capacity and data *and* is an independent requestor, so **aggregate system throughput** grows faster than **per-job speedup**. State both curves. Never plot a super-linear *speedup on fixed work*. |
| **Verification tax excluded from throughput** | 3× redundancy means 1/3 of gross work is useful. | Report gross and **useful** throughput, with the redundancy factor stated on the chart. |
| **Backbone/relay hardware excluded from node count** | Relays, tree-reduce aggregators, and sub-coordinators are real machines doing real work. | Include them in the resource inventory even if they aren't "compute nodes." |
| **Warm V8 code cache** | Part I.6 makes repeat loads skip TurboFan entirely. Run 2 is dramatically faster than run 1. | Report cold and warm separately; disclose which. |
| **Setup/data-distribution time excluded** | Time-to-first-result vs. steady-state throughput are different claims. | Report end-to-end makespan including placement and fetch. |
| **Uniform synthetic data** | Sovereignty forbids rebalancing, so real skew makes the largest owner bound the phase (doc §3.5). Uniform data erases the dominant real-world cost. | Report the data-size distribution (Gini or p99/p50) and run at least one realistically skewed configuration. |
| **Mean instead of tail** | With fan-out, the mean is meaningless — see [The Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) (Dean & Barroso): a 10 ms p99 per request becomes ~140 ms p99 for the whole fan-out. | Report p50/p95/p99 **makespan**, plus straggler counts and speculative re-execution counts. |
| **Best-of-N runs** | Churn makes variance huge; cherry-picking the good run is nearly irresistible. | Fixed run count decided in advance, all runs published, distribution shown. |
| **Eligible-node fraction hidden** | For locality-pinned tasks most of the fleet is ineligible (doc §3.3). "1000 nodes" may mean 3 eligible ones. | Report eligible-node fraction per workload class alongside fleet size. |

**Why it happens:**
Nobody sets out to fake it. The failure is that a harness is written *after* the system, to demonstrate a thesis already believed, and every ambiguous methodological choice independently breaks toward the flattering answer.

**How to avoid:**
- **Design the harness in P6 against a pre-registered methodology**, written and committed *before* the first number is generated: metric definitions, node inventory, run counts, cold/warm policy, redundancy factor, skew profile, and — critically — **the baseline**.
- **Publish a COST number.** "Our fabric beats a competent single-threaded implementation of the same workload on one machine at N nodes." If N is embarrassing, that is precisely the information the project needs, and publishing it is what makes every other number believable.
- **Publish raw data and the harness**, not just a chart. (Subject to the disclosure gate — see Pitfall 14.)
- **State the negative result when there is one.** The doc's §3.3 "honest ceiling" is already the project's best credibility asset. Numbers that confirm the ceiling are worth more than numbers that pretend it isn't there.

**Warning signs:**
- The harness is being written after the system works.
- Any chart with more tabs than physical cores on the x-axis.
- A speedup curve above y=x with no mechanism in the caption.
- No single-machine baseline anywhere.
- Only mean latency reported.

**Phase to address:** **P6** — and the methodology document is a **P0/P1 deliverable**, because the metrics you need determine the instrumentation you must build into the node agent from day one.

---

### Pitfall 6: Browser tab lifecycle silently destroys long-running tasks

**What goes wrong:**
A browser tab is not a compute node; it is a compute node with an owner who can kill it, an OS that can suspend it, and a browser that will throttle it.

- **Chrome intensive timer throttling** (since Chrome 88): timers in a page hidden >5 minutes, with chain count ≥5, silent ≥30 s, **and WebRTC not in use** are checked *once per minute* ([Chrome blog](https://developer.chrome.com/blog/timer-throttling-in-chrome-88), [Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE)). The WebRTC exemption is a genuine and useful side effect of this architecture — but do not build on it, it is an implementation detail.
- **iOS Safari suspends JavaScript outright** when Safari backgrounds, and discards tabs under memory pressure. Apple's own forum guidance is that this is *"very intentional"* ([Apple Developer Forums](https://developer.apple.com/forums/thread/777860)). Mobile Safari is not a viable compute node for anything longer than a few seconds of foreground time.
- **Page Lifecycle freeze / bfcache / tab discard** can suspend or destroy the page with no chance to finish in-flight work.
- **Memory ceilings are far below the wasm32 4 GiB address space.** iOS Safari OOMs well under the 2 GiB WASM default; Godot's fix was dropping `WASM_MEM_MAX` to 256 MB ([godotengine/godot#70621](https://github.com/godotengine/godot/issues/70621)), and WebKit has an open bug about failing to bound WASM memory ([WebKit 221530](https://bugs.webkit.org/show_bug.cgi?id=221530)).
- **The user closes the tab.** Always. Without warning.

**Why it happens:**
Development happens in a foreground, focused, plugged-in tab on a desktop. Every throttling and suspension mechanism is specifically designed *not* to fire in that configuration.

**How to avoid:**
- **All compute in dedicated Workers**, never on the main thread and never driven by `setTimeout`/`setInterval` chains. Main-thread timer throttling is the documented behaviour; a Worker in a tight compute loop is a different case — but the *page* can still be frozen or discarded, which takes the Workers with it. Workers dodge throttling, not lifecycle.
- **Task granularity is a hard design constraint, not a tuning parameter.** Slice work so a unit completes in seconds, with a content-addressed checkpoint at each boundary (doc §3.3 solution 3). "Assume the node vanishes in 10 seconds" should be the default sizing assumption for the edge tier.
- **Lease-based ownership with short leases and automatic re-dispatch** (doc §3.6). Never assume an ack.
- **Wire the lifecycle events**: `visibilitychange`, `freeze`, `resume`, `pagehide`, and use `navigator.sendBeacon` **only** to relinquish a lease — never to keep computing.
- **Advertise a capability class in the node's DHT record** — `foreground-desktop` / `background-desktop` / `mobile` — and let placement route long tasks away from mobile and hidden tabs. This is the same mechanism as the sovereignty label: a hard scheduling constraint.
- **Declare and enforce a memory budget per task** (start at 256 MB), advertise it, and refuse tasks that exceed it.

**Warning signs:**
- Any task expected to take more than ~30 s on an edge node.
- No checkpoint between task start and result.
- Tests only run in a focused foreground tab.
- Mobile browsers untested, or tested only in the foreground.
- Completion rate on mobile materially below desktop, treated as network flakiness.

**Phase to address:** **P1** (Worker architecture + resource governor) and **P4/P5** (lease and re-dispatch semantics).

---

### Pitfall 7: COOP/COEP on GitHub Pages — real constraint, but it blocks WASM *threads*, not Web Workers

**What goes wrong:**
GitHub Pages serves static files and **cannot set response headers**, so it cannot set `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`, so the page is not cross-origin isolated, so `SharedArrayBuffer` is unavailable. This has been an open community request for years ([community/community#13309](https://github.com/orgs/community/discussions/13309)).

**The important nuance — and the direct answer to the question:** this does **not** block Web Workers. Per [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer), cross-origin isolation is required for the `SharedArrayBuffer` constructor and for `postMessage()`-ing one. Ordinary Workers, `postMessage` with structured clone, and **transferable `ArrayBuffer`s (zero-copy ownership transfer)** all work fine without it. What you lose is:
- `SharedArrayBuffer` and therefore **WASM threads / pthreads-compiled artifacts**,
- shared `WebAssembly.Memory`,
- `Atomics.wait` on shared memory (the `Atomics` object itself is always available),
- high-resolution `performance.now()` precision.

So the fabric is **not blocked**; the *shared-memory fast path* is. For an embarrassingly-parallel map with content-addressed inputs and outputs — exactly the §6 MVP workload — message-passing plus transferables is the right architecture anyway, and it composes with the "node may vanish" constraint far better than shared mutable memory does.

**The workaround and its real costs.** [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) synthesizes COOP/COEP from a service worker, which browsers honour ([Wasmer's guide](https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers/), [tomayac](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/)). Costs, all real:
- **Forced page reload on first visit** — the SW can't intercept the navigation that registered it. Bad first impression, and it interacts badly with a consent flow.
- **Requires service worker registration**, which fails in private browsing on some browsers, in some embedded webviews, and anywhere SWs are disabled — the *heterogeneous long tail* is exactly the population this project needs.
- **Turning on COEP breaks `no-cors` cross-origin subresources.** Per [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy), `require-corp` blocks any cross-origin resource that lacks `Cross-Origin-Resource-Policy`. **Fetching WASM artifacts from a public IPFS HTTP gateway is exactly this pattern** — and Part I.6's whole V8 code-caching story depends on `compileStreaming` against a gateway URL. Mitigations: request with `mode: 'cors'` (CORS-mode requests are *not* blocked by COEP), or use `COEP: credentialless`, which loads no-cors cross-origin resources without credentials ([Chrome](https://developer.chrome.com/blog/coep-credentialless-origin-trial)). Verify your chosen gateway actually sends usable CORS headers.
- **WebSocket and WebRTC are unaffected by COEP** (they aren't COEP-governed subresources), so libp2p connectivity survives cross-origin isolation. Good news, and worth an explicit test.

**How to avoid:**
- **Design the MVP to need only Workers + transferables.** Feature-detect `crossOriginIsolated` and treat SAB/WASM-threads as an optional fast path, never a requirement.
- **This decision propagates to the build.** Emscripten/wasi-sdk `-pthread` output *requires* shared memory and will hard-fail without COI. Decide "no pthreads in edge artifacts" early — it constrains **P8**'s elfconv output flags too. Retrofitting is a recompile of every artifact.
- If you later need COI, prefer **`credentialless`**, and audit every cross-origin fetch (IPFS gateways, STUN/TURN config, fonts, analytics) first.
- **If cross-origin isolation ever becomes load-bearing, move hosting.** Cloudflare Pages / Netlify set real headers for free. GitHub Pages is a convenience, not a requirement — and `PROJECT.md` already gates deployment separately, so switching costs nothing yet.

**Warning signs:**
- `SharedArrayBuffer` or `-pthread` anywhere in the build without a `crossOriginIsolated` feature check.
- Testing only on `localhost` (which is a secure context and can be COI'd trivially — it hides the problem).
- Artifact fetches from a gateway using default `no-cors` mode.

**Phase to address:** **P1** (Worker/memory architecture), **P7** (hosting), with a constraint recorded for **P8**.

---

### Pitfall 8: DHT-driven *scheduling* inherits eclipse/sybil attacks — and an eclipse silently defeats quorum verification

**What goes wrong:**
The doc (§3.4) puts a Kademlia DHT on the critical path for placement: discovery, capability records, trust records, and job-group rendezvous. It correctly flags that this is "worse when the DHT drives scheduling than when it only serves content" — but the severity is under-stated in one specific way.

If an attacker eclipses a job's group key or a data CID's provider record, they don't just deny service. **They can ensure that all N replicas of a redundantly-executed task land on nodes they control.** N-version comparison then returns unanimous agreement on a wrong answer, and the verification layer reports success. The integrity mechanism doesn't degrade — it *inverts*, actively certifying the forged result.

The attack is cheap and demonstrated. [*Sybil Attack Strikes Again: Denying Content Access in IPFS with a Single Computer*](https://dl.acm.org/doi/pdf/10.1145/3664476.3664482) is exactly what it sounds like. [Active Sybil attack and efficient defense strategy in IPFS DHT](https://arxiv.org/abs/2505.01139) shows malicious nodes returning *semantically correct but intentionally false* data by placing sybils strategically under the XOR metric and exploiting early lookup termination. Note that record signing does not close it — an eclipse suppresses records rather than forging them, so signatures are irrelevant to the attack.

**Why it happens:**
Power-of-d-choices is analysed for *load balancing under honest randomness*. If all d candidates come from a single lookup path, an adversary controlling that path controls the entire sample, and the randomness that makes power-of-d work is gone.

**How to avoid:**
- **Verification-quorum members must be independently sourced.** Never sample the whole quorum from one lookup. Use S/Kademlia disjoint-path lookups so the d candidates come from provably disjoint routing paths.
- **Diversity constraints on the quorum**: distinct IP prefixes, distinct provider-signed enrollment batches (§3.9 gives you the enrollment root to do this), and — the cheapest strong measure — **at least one replica of every verification quorum anchored on the permissioned backbone**. That single constraint converts "eclipse the quorum" from cheap to requiring a backbone compromise.
- **Adopt S/Kademlia properly**: pubkey-derived IDs plus PoW/stake for ID-generation cost, and disjoint-path lookups. The doc names this; make it a build item with acceptance tests, not a mitigation note.
- **Provider-gated enrollment (§3.9) is the highest-leverage sybil defence available here** and should be in the MVP, not deferred with "incentives".
- **Statistical detection**: monitor lookup-result diversity and alert when candidate sets for different keys converge on overlapping node sets — the published defence couples statistical tests with wider republication.
- **Write down the threat model explicitly**: "attacker controls up to k of n nodes." The doc already insists on this; the roadmap should require the number k to appear in the verification phase's acceptance criteria.

**Warning signs:**
- Quorum members selected from a single `getProviders` result.
- No diversity constraint on replica placement.
- Unanimous quorum agreement treated as proof rather than as evidence.
- No metric for "distinct-ASN/prefix count within a quorum."

**Phase to address:** **P4** (placement) and **P0/P1** (the verification design must assume adversarial placement from the start).

---

### Pitfall 9: The verification tax compounds — 2–3× is the floor, not the number

**What goes wrong:**
The doc budgets 2–3× for redundant execution. In a browser fleet the multipliers stack:

- redundancy `r` (2–3×)
- × speculative/backup execution for stragglers (doc §3.3 solution 1; [Tail at Scale](https://www.barroso.org/publications/TheTailAtScale.pdf) hedged requests) — another 1.1–2× on the slow tail
- × re-execution after churn — proportional to (task duration ÷ mean node lifetime)
- × quorum retries when honest nodes disagree (see Pitfall 1)

A 3× nominal tax can be a 5–6× real one. Since useful throughput is gross ÷ multiplier, this is not a cost line — it is a **direct divisor on the headline scaling number**, and it is the third item in the doc's own "genuine research risk" list.

**How to avoid:**
- **Instrument the effective multiplier as a live metric** from the first working job: gross task-executions ÷ useful results. If this isn't on the dashboard, it isn't being managed.
- **Make redundancy a per-job dial**, defaulted low; reserve high `r` for jobs that actually need it (this is the doc's per-job trust dial applied to cost).
- **Prefer audit sampling over blanket N-version** for low-value work: execute once, re-verify a random p% on a trusted node, and penalise on mismatch. Expected cost `1 + p` instead of `r`. Requires stable identity (§3.9 enrollment) to make penalties meaningful — another reason enrollment belongs in the MVP.
- **Cap speculation**: a global budget on outstanding duplicates so straggler mitigation cannot spiral.
- **Report the multiplier in every published benchmark.**

**Warning signs:**
- Redundancy is a constant in the code.
- No metric distinguishing gross from useful throughput.
- Speculation launched per-task with no global budget.
- Benchmark throughput reported as raw task completions.

**Phase to address:** **P5/P6**, instrumented in **P1**.

---

### Pitfall 10: WebRTC data channels cap at 16 KiB per message, and Chromium closes the channel above 256 KiB

**What goes wrong:**
js-libp2p's own WebRTC transport hardcodes this ([`transport-webrtc/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-webrtc/src/constants.ts)):

```ts
export const MAX_BUFFERED_AMOUNT = 2 * 1024 * 1024
// "Max message size that can be sent to the DataChannel. In browsers this is
//  256KiB but go-libp2p and rust-libp2p only support 16KiB"
export const MAX_MESSAGE_SIZE = 16 * 1024
```

Beneath that, SCTP interop is worse than the numbers suggest. Firefox fragments at 16 KiB using partial PPIDs; **Chromium does not reassemble them**, so the receiving app sees a stream of 16 KiB fragments. Above ~256 KiB, usrsctp returns `EMSGSIZE` and **Chromium simply closes the data channel** ([Lennart Grahl](https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html), [Mozilla WebRTC blog](https://blog.mozilla.org/webrtc/large-data-channel-messages/)). The SCTP `ndata` fix is unimplemented in every major browser.

The consequence for the architecture: **the browser-to-browser mesh is not a bulk data path.** Multi-MB WASM artifacts, large reduce partials, and content-addressed intermediates cannot move peer-to-peer efficiently. This reinforces the doc's own §3.5 conclusion (partials must be small, combiners must shrink before moving) and Part I.6's conclusion (artifacts should come over an HTTP gateway with `compileStreaming`, not through the mesh).

**How to avoid:**
- Chunk at ≤16 KiB and honour `bufferedAmount` backpressure against the 2 MiB threshold. Never write a large buffer in one call.
- **Fetch WASM artifacts over HTTPS/IPFS gateway, not over the mesh** — required anyway for V8 code caching (Part I.6).
- **Make reduce-partial size a design constraint** with a budget (single-digit KiB) checked in tests. Mergeable sketches (HLL, t-digest, Count-Min) are small by construction; this is a concrete second reason to prefer them.
- Measure achieved browser↔browser throughput early, on real networks, and put the number in the design doc so nobody plans around a wrong assumption.

**Warning signs:**
- Any `send()` of a buffer larger than 16 KiB.
- Data channel closes with no application-level error.
- Firefox↔Chrome transfers corrupt while Chrome↔Chrome works.
- Partial sizes unbounded by design.

**Phase to address:** **P2** (transport), **P5** (partial sizing).

---

### Pitfall 11: The requestor-as-coordinator is a browser tab, and browser tabs close

**What goes wrong:**
§3.4's coordinator-free design makes the *requestor* coordinate its own job. When the requestor is a browser tab, the coordinator has the availability of a browser tab. Close it, background it on iOS, or hit an OOM discard, and the whole job's control-plane state evaporates — every worker holds a lease for a coordinator that will never return, and all in-flight compute is wasted.

The doc anticipates this (§3.3 solution 8, delegated tree-coordination) but frames it as an optimisation for *large* jobs. On the browser edge it is a **correctness requirement for any job longer than a few seconds**, because the coordinator is exactly as fragile as the workers.

**How to avoid:**
- **Checkpoint coordinator state to content-addressed storage** at every task-graph state transition, so any node can resume it.
- **Delegate to a backbone sub-coordinator above a low threshold** — measured in seconds of expected makespan, not in task count.
- **Workers must self-terminate on lease expiry** and release results to content-addressed storage, so a returning/replacement coordinator can collect completed work rather than re-running it.
- **Test the failure explicitly**: kill the requestor tab mid-job in CI and assert the job either completes via a delegated coordinator or fails cleanly with recoverable partial results. Never leave orphaned leases.

**Warning signs:**
- Job state held only in a tab's memory.
- No coordinator-failure test.
- Workers that keep computing after their coordinator is unreachable.

**Phase to address:** **P5**.

---

## Moderate Pitfalls

### Pitfall 12: js-libp2p / IPFS-JS ecosystem churn

**What goes wrong:** The stack has a documented history of hard breaks — `js-ipfs` deprecated in favour of **Helia**; libp2p 0.37 was a *"large scale re-evaluation of the exposed interfaces"*; `webrtc-star`/`websocket-star` deprecated; the module count exploded from one package into dozens. The constants this document quotes live in **internal** files that can change without a semver signal you'd notice.

**How to avoid:** Pin exact versions (no `^`). Put every libp2p touchpoint behind a narrow internal interface (`Transport`, `Discovery`, `Relay`) so an upgrade is one adapter, not a diffuse refactor. Add a scheduled dependency-review task per milestone. Never make anything documented as experimental load-bearing. **Add a regression test that asserts the relay/transport constants you depend on** — it will fail loudly on upgrade instead of silently at scale.

**Phase to address:** **P2**, revisited each milestone.

---

### Pitfall 13: Content addressing gives integrity, not provenance — and the native tier is an RCE channel

**What goes wrong:** The doc states this clearly (Part I.6, §3.2) and it belongs in the pitfalls list because it is the highest-consequence item in the whole design and it lands in a *late* phase (**P8**), when schedule pressure is highest. A CID proves bytes match a hash; anyone can publish bytes under any CID. For `.wasm` the sandbox caps the blast radius to a wrong answer. For any distributed native artifact (WasmEdge universal-wasm native section, `.so`, `.cwasm`) it is **arbitrary native code execution on every consuming node**.

**How to avoid:** Signed `key → CID` mappings from a trusted build authority, pinned trust anchors, never resolve native artifacts by CID alone. Build the signing infrastructure in **P3** when content addressing lands, not in **P8** when native lands — so the native path physically cannot ship unsigned. Reproducible builds are a prerequisite for cache dedup to work at all.

**Phase to address:** Signing infra in **P3**; enforcement in **P8**.

---

### Pitfall 14: Accidental public disclosure forfeits EPO/China patent rights permanently

**What goes wrong:** `PROJECT.md` treats publishing as an irreversible surrender of patent rights in jurisdictions with no grace period. The realistic leak vectors are mundane and mostly automated: a `gh-pages` deploy workflow that fires on merge, public GitHub Actions logs, an `npm publish` on a prepublish hook, a public issue or discussion, a demo URL shared "just with a friend," a public package registry cache, or a repo visibility toggle.

**How to avoid:** Repo private. **No deploy workflow present in the repository at all** — not disabled, not commented out, absent; a disabled workflow is one settings change away from firing. `"private": true` in every `package.json`. A pre-flight checklist as a required gate on the deploy decision. Grep for the project name across public indexes periodically.

**Phase to address:** Repo hygiene from **P0**; enforced at the **P7** gate.

---

### Pitfall 15: Sovereignty makes skew structural, and skew flattens the scaling curve

**What goes wrong:** With map placement = data placement, phase completion is bounded by the largest data owner, and sovereignty **forbids** rebalancing that owner's data. Simultaneously, a locality-pinned task is eligible on ~1/N of the fleet. Both effects are invisible on uniformly-distributed synthetic data — which is what every benchmark harness generates by default.

**How to avoid:** Report eligible-node fraction and data-size distribution alongside every scaling number. Include at least one realistically skewed configuration. Parallelise *within* the large owner's node set (never across owners). Scope speculation to the owner's own nodes.

**Phase to address:** **P3/P4** (design), **P6** (measurement).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Use a public IPFS relay for the demo | No infra to run | Breaks at 15 peers, 128 KiB, 2 min; unpredictable third-party availability | Never as the primary path; fine as opportunistic fallback |
| Hardcode a WebRTC-Direct certhash multiaddr | Bootstrap works today with no DNS | Dead in 14 days (`DEFAULT_CERTIFICATE_LIFESPAN`) with a failure that mimics an outage | Local dev only, never committed |
| Compare `sha256` of raw output memory | Trivial verifier | Silently unsound across architectures (Pitfall 1) | Never — replace with canonical-form comparison in P0 |
| Skip the module-bytes admission gate | Faster to accept tasks | Relaxed-SIMD or threaded modules poison the verification pool | Never on the verification path |
| Compute on the main thread | No Worker plumbing | Timer throttling, frozen UI, instant cryptojacking heuristics hit | Prototype only |
| Derive Worker count from `hardwareConcurrency` | Max throughput per node | Pegs the user's machine → blocklists (Pitfall 4) | Never in a public demo |
| Requestor-only coordination | Matches §3.4 elegantly | Job dies with the tab (Pitfall 11) | Jobs under ~10 s only |
| Defer provider-gated enrollment as "incentives" | Smaller MVP | Sybil/eclipse defence and audit-sampling economics both depend on it | Never — enrollment is a security primitive, not a market feature |
| Benchmark on N tabs of one machine | Impressive early numbers | The one methodological error that destroys credibility if noticed after publication | Only labelled as a portability demo |
| `^` version ranges on libp2p packages | Free bug fixes | Silent behavioural drift in undocumented internal constants | Never on this stack |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| **Circuit Relay v2 (server)** | Accept defaults | Set `maxReservations`, `applyDefaultLimit: false` or explicit generous limits, `reservationTtl`; watch `MAX_CONNECTIONS = 300` |
| **Circuit Relay v2 (client)** | Register protocols normally | `runOnLimitedConnection: true` on `handle()` **and** `dialProtocol()`, or the protocol won't negotiate over `p2p-circuit` |
| **WebRTC transport** | Send buffers >16 KiB | Chunk ≤16 KiB, honour `bufferedAmount` vs 2 MiB; >256 KiB closes the channel in Chromium |
| **WebRTC-Direct** | Hardcode certhash | Resolve at runtime; certs rotate every 14 days |
| **kad-dht in browser** | Expect server-mode behaviour | Client mode only: cannot serve records, not in others' routing tables, browser peers rarely appear in `FIND_NODE` results |
| **Pubsub peer discovery** | Ship it to production | libp2p's docs say it is not battle-tested and not scalable — use it for demos, back it with backbone rendezvous |
| **IPFS HTTP gateway + `compileStreaming`** | Fetch via in-page Helia `fs.cat` then `WebAssembly.compile` | Forfeits V8 code caching (Part I.6). Use a gateway URL with `compileStreaming`, `Content-Type: application/wasm`, module ≳128 kB |
| **IPFS gateway under COEP** | Default `no-cors` fetch | Blocked by `require-corp`. Use `mode: 'cors'` or `COEP: credentialless` |
| **GitHub Pages** | Assume headers are configurable | They are not. Design for no cross-origin isolation, or move to a host that sets headers |
| **STUN servers** | Add five or more | js-libp2p warns above four; defaults are Google/Twilio/Cloudflare/Mozilla — also a third-party dependency and a privacy disclosure |
| **elfconv (P8)** | Assume any binary lifts | AArch64 only, static, unstripped; indirect/computed jumps are a hard ceiling; syscalls are emulated |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Relay as data path | Streams truncate at 128 KiB / 120 s | Relay carries SDP only; assert relayed byte counters | Immediately on any non-trivial payload |
| Relay reservation ceiling | 16th peer refused | Own relay, tuned `maxReservations`, monitor refusals | 16 browser peers on defaults |
| WebRTC 16 KiB messages | Poor browser↔browser throughput | Fetch artifacts over HTTP; keep partials small | Any multi-MB peer-to-peer transfer |
| Straggler tail | p99 makespan ≫ mean | Speculative execution with a global budget; capability-aware placement | Any fan-out; worsens with fleet size |
| Verification tax compounding | Useful ÷ gross ratio falls | Track the multiplier; audit-sampling for low-value work | As churn rate and fan-out rise |
| Skew from sovereignty | Largest owner bounds every phase | Parallelise within owner; report the distribution | On realistic (non-uniform) data |
| Cold V8 compile | First run far slower than later runs | `compileStreaming` on stable CID URLs; share one `Module` across Workers in-session | Every first visit |
| Tab-shared cores | N tabs ≠ N× throughput | Count physical machines and cores separately | Beyond `hardwareConcurrency` per machine |
| Browser connection ceiling | Dials fail past ~100 peers | Browser default `MAX_CONNECTIONS = 100`; RTCPeerConnection practical ceiling is well below the theoretical one and each costs real CPU/memory | Full-mesh topologies at any meaningful N — use tree topologies |
| Memory OOM on mobile | Tab crash / reload | Declare and enforce a per-task memory budget (~256 MB); advertise it as a capability | Well under the wasm32 2 GiB default on iOS |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Quorum sampled from one DHT lookup | Eclipse → unanimous agreement on a forged result; verification actively certifies the lie | Disjoint-path lookups; diversity constraints; ≥1 backbone replica per quorum |
| Unsigned `key → CID` for native artifacts | **Arbitrary native code execution** on every consumer | Signed mappings, pinned anchors, never CID-alone for native |
| Treating a bare DHT claim as trust | Any node can claim TEE/capability/tier | Store *signed* credentials as the DHT value; verify the signature, not the record |
| Durable secrets shipped in the client | Owner has physical access and can extract them | On-device keygen in secure keystore; ship only trust anchors + a single-use enrollment token (§3.9) |
| No revocation story | Compromised node keeps participating | Short-lived UCAN-style capabilities so expiry replaces revocation |
| Accepting arbitrary WASM without byte validation | Relaxed-SIMD/threads poison verification; unbounded `memory.grow` OOMs the host | Opcode allow-list + import allow-list + declared memory ceiling as an admission gate |
| Anonymous edge membership | Sybil floods placement and verification quorums cheaply | Provider-gated, rate-limited enrollment in the MVP |
| Trusting `hardwareConcurrency`-reported capability | Node lies to attract work | Treat self-reported capability as a hint; confirm with measured completion history |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Auto-starting compute on page load | Indistinguishable from cryptojacking; blocklisting | Explicit per-session opt-in, no pre-checked boxes |
| No visible resource indicator | Users feel the fan, distrust the site, report it | Persistent panel: what's running, CPU share, contribution total, one-click stop |
| Unthrottled CPU use | Laptop fans, dead batteries — Salon.com's exact mistake | Conservative default cap; auto-pause when hidden; off by default on mobile/battery |
| `coi-serviceworker` forced reload | Page flashes and reloads on first visit, colliding with the consent flow | Avoid needing COI at all; if unavoidable, reload *before* the consent step |
| Crypto vocabulary | Triggers user and vendor pattern-matching instantly | Plain language: "contribute spare compute" |
| Silent failure when blocked | Node never starts, user thinks the site is broken | Detect start failure and show an honest explanation |
| No indication work was lost on tab close | Users close tabs believing nothing happened | Show in-flight work and let the lease release cleanly |

---

## "Looks Done But Isn't" Checklist

- [ ] **Redundant-execution verification:** often missing cross-architecture validation — verify byte-identical results across x86-64 **and** arm64, in Chrome, Firefox, Safari, and Node
- [ ] **WASM sandbox:** often missing a module admission gate — verify relaxed-SIMD, atomics/shared memory, and non-allow-listed imports are *rejected*, not merely unused
- [ ] **Relay connectivity:** often missing scale — verify N+1 browser peers reserve simultaneously against your tuned relay for >1 hour with churn
- [ ] **Relayed protocols:** often missing `runOnLimitedConnection` — verify every registered protocol negotiates over a `p2p-circuit` address
- [ ] **Bootstrap:** often missing time — verify bootstrap still works 15+ days after deploy (certhash rotation), or that no certhash is hardcoded
- [ ] **Browser node:** often missing lifecycle handling — verify behaviour when hidden >5 min, on `freeze`/`resume`, on tab discard, and on mobile background
- [ ] **Churn handling:** often missing the coordinator case — verify a job survives (or fails cleanly with recoverable partials) when the *requestor* tab is killed mid-job
- [ ] **Data transfer:** often missing chunking — verify Firefox↔Chrome transfers of >256 KiB across the mesh
- [ ] **Sovereignty claim:** often missing proof — verify with a network capture that raw data bytes never appear on any non-owner node; make it an automated test, not an assertion in a doc
- [ ] **Consent UX:** often missing the negative path — verify the "% of visitors where the node failed to start" metric exists and is segmented by browser
- [ ] **Benchmark:** often missing the baseline — verify a competent single-threaded single-machine implementation exists and its COST crossover is published
- [ ] **Benchmark:** often missing the tax — verify gross vs. useful throughput are reported separately with the redundancy factor on the chart
- [ ] **Disclosure gate:** often missing the automated vector — verify no deploy workflow file exists in the repo and every `package.json` is `"private": true`
- [ ] **Artifact distribution:** often missing signing — verify no code path resolves an executable artifact by CID without a signature check

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| NaN/nondeterminism breaks verification | **HIGH** if found late, LOW in P0 | Add module admission gate; switch to canonical-form comparison; narrow verification-eligible workload class; if intractable, replace N-version with backbone-anchored audit sampling — a trust-model change that cascades into the roadmap |
| Relay limits hit at demo time | LOW | Reconfigure and redeploy your own relay; hours, not days — but only if you *have* your own relay |
| Domain hits a cryptomining blocklist | **HIGH** | Fix the behaviour first (throttle, consent, visibility), then appeal to each vendor independently; weeks of latency, and reputation damage persists. Prevention is the only real strategy |
| Published benchmark shown to be inflated | **HIGH — potentially fatal** | Retract, republish with full methodology and raw data, publish the COST number. Credibility does not fully recover. Pre-registration is the only defence |
| Accidental public disclosure | **IRREVERSIBLE** | No recovery for EPO/China patent rights. Only prevention exists |
| DHT eclipse defeats a quorum | MEDIUM | Add backbone anchoring to every quorum (small change, large effect); add disjoint-path lookups; re-verify affected results |
| Job lost when requestor tab closed | LOW–MEDIUM | Coordinator checkpointing + delegated tree; recompute from last checkpoint |
| libp2p upgrade breaks the stack | MEDIUM | Pinned versions mean you choose when; the adapter layer bounds the blast radius. Without it, a diffuse refactor |
| Cross-origin isolation turns out to be needed | MEDIUM | Move hosting to Cloudflare Pages/Netlify (real headers) — cheap. Recompiling every artifact with `-pthread` — not cheap |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 1. WASM nondeterminism breaks verification | **P0** spike → enforced P1 | Cross-arch/cross-browser divergence harness green in CI |
| 2. Relay defaults cap the demo | P2 | N+1 browser peers reserved simultaneously >1 h against tuned relay |
| 3. Browser dialability + certhash expiry | P2 (revise the `PROJECT.md` decision) | Bootstrap works from a cold browser 15+ days post-deploy |
| 4. Cryptojacking perception | P7 (governor hooks in P1) | Consent flow reviewed; blocklist scan clean; start-failure metric live and segmented |
| 5. Benchmark credibility | P6 (methodology in P0/P1) | Pre-registered methodology committed before first number; COST published |
| 6. Tab lifecycle / throttling | P1 + P4/P5 | Task completes or checkpoints cleanly when tab hidden, frozen, discarded, mobile-backgrounded |
| 7. COOP/COEP / SharedArrayBuffer | P1 (architecture), P7 (hosting), P8 (build flags) | App runs fully without `crossOriginIsolated`; no `-pthread` in edge artifacts |
| 8. DHT eclipse defeats quorum | P4 + P0/P1 | Quorum diversity constraint enforced; disjoint-path lookups; ≥1 backbone replica per quorum |
| 9. Verification tax compounding | P5/P6 (instrumented P1) | Gross-vs-useful multiplier on the dashboard and in every published number |
| 10. WebRTC 16 KiB / 256 KiB | P2 + P5 | Firefox↔Chrome >256 KiB transfer succeeds; partial-size budget test |
| 11. Requestor-as-SPOF | P5 | Kill-the-requestor CI test |
| 12. Ecosystem churn | P2, each milestone | Constants-regression test; pinned versions; adapter layer |
| 13. CID provenance / native RCE | P3 (signing infra) → P8 (enforcement) | No executable artifact resolvable by CID alone |
| 14. Accidental disclosure | P0 hygiene → P7 gate | No deploy workflow file in repo; all packages private |
| 15. Skew flattens the curve | P3/P4 → P6 | Eligible-node fraction and data-size distribution published with every number |

---

## Confidence Notes

| Claim | Confidence | Basis |
|---|---|---|
| js-libp2p relay defaults (15 reservations, 128 KiB, 120 s, 2 h TTL, `applyDefaultLimit` on) | **HIGH** | Read directly from `main` source |
| WebRTC-Direct certificate lifespan = 14 days | **HIGH** | Read directly from `main` source |
| `MAX_MESSAGE_SIZE = 16 KiB`, `MAX_BUFFERED_AMOUNT = 2 MiB` | **HIGH** | Read directly from `main` source |
| WASM nondeterminism sources; x86 sets NaN sign bit, ARM does not | **HIGH** | WebAssembly spec + `design/Nondeterminism.md` + design#477 |
| V8 offers no NaN-canonicalization / relaxed-SIMD-determinism knob | **MEDIUM** | Absence of evidence; Wasmtime has these controls and no V8 equivalent was found. **Empirically verify in the P0 spike** |
| `WebAssembly.Memory({shared:true})` availability without cross-origin isolation | **LOW** | MDN's wording is ambiguous and browser behaviour has changed over time. Verify empirically before relying on it either way |
| Firefox blocks cryptominers by default via Disconnect | **HIGH** | Mozilla blog + Firefox support docs |
| Malwarebytes blocked Coinhive's opt-in AuthedMine | **HIGH** | Malwarebytes Labs + The Register |
| Chrome intensive throttling thresholds (5 min / chain 5 / 30 s silent / no WebRTC) | **MEDIUM-HIGH** | Chrome blog + Intent to Ship; thresholds can change |
| Dedicated Workers escape *timer* throttling but not page freeze/discard | **MEDIUM** | Consistent across sources; under-documented officially. Verify empirically |
| GitHub Pages cannot set COOP/COEP; `coi-serviceworker` is the workaround | **HIGH** | GitHub community discussion + multiple independent implementation guides |
| RTCPeerConnection practical ceiling | **LOW** | Sources are dated (~256, crashes under tight loops) and browser-version dependent. Measure, don't assume |
| Distributed-systems traps (COST, tail latency, stragglers) | **HIGH** as literature, **MEDIUM** as applied here | Peer-reviewed, but not measured on this system |

---

## Sources

**libp2p — read from source (`libp2p/js-libp2p@main`, 2026-07-24)**
- [`transport-circuit-relay-v2/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/constants.ts) — reservation store size 15, TTL 2 h, duration 2 min, data 128 KiB, `MAX_CONNECTIONS` 300
- [`transport-circuit-relay-v2/src/server/reservation-store.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/server/reservation-store.ts) — `applyDefaultLimit !== false`, `RESERVATION_REFUSED`
- [`transport-webrtc/src/constants.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-webrtc/src/constants.ts) — 16 KiB messages, 2 MiB buffer, 14-day certificate lifespan
- [`interface/src/index.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/interface/src/index.ts) — `runOnLimitedConnection` semantics
- [`connection-manager/constants.browser.ts`](https://github.com/libp2p/js-libp2p/blob/main/packages/libp2p/src/connection-manager/constants.browser.ts) — browser `MAX_CONNECTIONS = 100`
- [`doc/LIMITS.md`](https://github.com/libp2p/js-libp2p/blob/main/doc/LIMITS.md)

**libp2p — issues, specs, docs**
- [js-libp2p#2833 — Circuit relay stops accepting relay requests](https://github.com/libp2p/js-libp2p/issues/2833) (open)
- [discuss.libp2p.io — Browser nodes cannot use the majority of public nodes as relay](https://discuss.libp2p.io/t/browser-nodes-cannot-use-the-majority-of-public-nodes-as-relay/1990)
- [WebRTC with js-libp2p](https://libp2p.io/docs/webrtc-browser-connectivity/) — pubsub discovery not production-ready, ~80% hole-punch success, browser peers too short-lived for `FIND_NODE`
- [Circuit Relay v2 spec](https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md)
- [kad-dht spec](https://github.com/libp2p/specs/blob/master/kad-dht/README.md) — client-mode semantics
- [js-libp2p#1621 — In-browser peer routing with DHT client not working](https://github.com/libp2p/js-libp2p/issues/1621)

**WASM determinism**
- [WebAssembly/design — Nondeterminism.md](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md)
- [WebAssembly/design#477 — Default NaN bit pattern requirement not compatible with x86](https://github.com/WebAssembly/design/issues/477)
- [WebAssembly/design#619 — Document why NaN bits are not fully deterministic](https://github.com/WebAssembly/design/issues/619)
- [Wasmtime — Deterministic Wasm Execution](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html)
- [WebAssembly spec — Numerics](https://webassembly.github.io/spec/core/exec/numerics.html)
- [Bacalhau — Compute Over Data technical deep dive](https://blog.bacalhau.org/p/compute-over-data-summit-technical) (deterministic clock ticks, seeded PRNG)

**Browser as compute node**
- [Chrome 88 heavy throttling of chained JS timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [Intent to Ship: Quick intensive timer throttling of loaded background pages](https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE)
- [Apple Developer Forums — Preventing JavaScript from stopping in Safari in the background](https://developer.apple.com/forums/thread/777860)
- [godotengine/godot#70621 — WASM 2 GB max memory OOM on iOS Safari](https://github.com/godotengine/godot/issues/70621)
- [WebKit 221530 — Safari fails to set boundaries to Wasm application memory](https://bugs.webkit.org/show_bug.cgi?id=221530)
- [Pando: Personal Volunteer Computing in Browsers](https://arxiv.org/abs/1803.08426)
- [Web-based volunteer distributed computing for time-critical urgent workloads](https://arxiv.org/pdf/2212.13981)

**Cryptojacking perception**
- [Mozilla — Today's Firefox blocks third-party tracking cookies and cryptomining by default](https://blog.mozilla.org/en/firefox/todays-firefox-blocks-third-party-tracking-cookies-and-cryptomining-by-default/)
- [Malwarebytes Labs — Why is Malwarebytes blocking Coinhive?](https://blog.malwarebytes.com/security-world/2017/10/why-is-malwarebytes-blocking-coinhive/)
- [The Register — Malwarebytes blocks Coin Hive after user revolt](https://www.theregister.com/2017/10/19/malwarebytes_blocking_coin_hive_browser_cryptocurrency_miner_after_user_revolt/)
- [Malwarebytes Labs — The state of malicious cryptomining](https://www.malwarebytes.com/blog/news/2018/02/state-malicious-cryptomining) (Salon.com unthrottled opt-in miner)
- [TechCrunch — Google is banning all cryptomining extensions from the Chrome Web Store](https://techcrunch.com/2018/04/02/google-is-banning-all-cryptomining-extensions-from-its-chrome-web-store/)
- [Analyzing and Detecting In-browser Cryptojacking (IEEE TDSC)](https://davidmohaisen.github.io/files/tdsc-cj24.pdf)

**Distributed systems**
- [Scalability! But at what COST? — McSherry, Isard, Murray, HotOS '15](https://www.usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf)
- [Twelve Ways to Fool the Masses — Bailey, 1991](https://www.davidhbailey.com//dhbpapers/twelve-ways.pdf)
- [The Tail at Scale — Dean & Barroso, CACM 2013](https://www.barroso.org/publications/TheTailAtScale.pdf)
- [Sybil Attack Strikes Again: Denying Content Access in IPFS with a Single Computer (ACM)](https://dl.acm.org/doi/pdf/10.1145/3664476.3664482)
- [Active Sybil attack and efficient defense strategy in IPFS DHT (arXiv 2505.01139)](https://arxiv.org/abs/2505.01139)
- [Content Censorship in the InterPlanetary File System (NDSS)](https://ssg.lancs.ac.uk/wp-content/uploads/ndss_preprint.pdf)

**Hosting / COOP / COEP / WebRTC data channels**
- [community/community#13309 — Allow setting COOP and COEP headers in GitHub Pages](https://github.com/orgs/community/discussions/13309)
- [MDN — SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [MDN — Cross-Origin-Embedder-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)
- [Chrome — COEP: credentialless](https://developer.chrome.com/blog/coep-credentialless-origin-trial)
- [Wasmer — Patching COOP & COEP headers for GitHub Pages deployment](https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers/)
- [Setting COOP and COEP headers on static hosting like GitHub Pages — Thomas Steiner](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/)
- [Demystifying WebRTC's Data Channel Message Size Limitations — Lennart Grahl](https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html)
- [Mozilla WebRTC — Large Data Channel Messages](https://blog.mozilla.org/webrtc/large-data-channel-messages/)

**Ecosystem churn**
- [Migrating from js-IPFS to Helia](https://github.com/ipfs/helia/wiki/Migrating-from-js-IPFS)
- [js-IPFS 0.63.0 with ESM, libp2p@0.37.x](https://blog.ipfs.tech/2022-06-01-js-ipfs-0-63/) — "large scale re-evaluation of the exposed interfaces"

**Internal**
- `.planning/PROJECT.md`
- `docs/p2p-native-cloud-design.md` §3.3 (honest ceiling), §3.4 (residual limits), §3.5 (skew/availability), §5 (risk map)

---
*Pitfalls research for: browser-based P2P distributed compute fabric*
*Researched: 2026-07-24*
