---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Wire What Was Built
status: verifying
stopped_at: Phase 12 Plan 02 complete — guardSovereignty (DATA-09 serving-side gate) built and mutation-tested; submitJob load-pressure discrimination, DATA-09 replica-holder, degraded, and rejection semantics proven at the submitJob level. 116 files / 1749 tests passing, tsc clean. Wave 2 remainder (12-03/12-04) not yet executed.
last_updated: "2026-07-27T19:19:24.195Z"
last_activity: 2026-07-27
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 6
  completed_plans: 3
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-27)

**Core value:** Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.
**Current focus:** Phase 11 — Explicit serveAgent Hook Contract

## Current Position

Phase: 11 (Explicit serveAgent Hook Contract) — COMPLETE
Plan: 1 of 1
Status: Phase complete — ready for verification
Last activity: 2026-07-27

### v1.0 carried forward, unarchived

```
Test Files  112 · Tests 1673 · tsc --noEmit clean
Ledger      32 / 72 wired · 36 built-not-wired · 4 blocked on hardware or measured
```

**Read `.planning/v1.0-MILESTONE-AUDIT.md` before planning.** It carries `file:line` for
every claim. v1.0 was deliberately **not archived** — its audit returned `gaps_found`,
and filing 36 unwired requirements under a completed milestone would have made the
ledger say something untrue. The phase directories for 2–10 are intact for the same
reason.

The 36 are not undone work. Sovereignty labelling, tree-reduce, discovery, enrollment,
quorum composition, capability chains and the whole churn coordinator are implemented,
exported and covered by their own specs — and nothing a person can run calls any of
them. Verified symbol by symbol: `runResilient`, `EgressGuard`, `translationCid`,
`composeQuorum`, `discoverExecutors`, `executeReduce`, `requestEnrollment`, `signName`
and `verifyChain` each appear only as their own definition, a barrel re-export, or a
prose comment.

**The structural cause is one shape, and it is v1.1's first target.** `serveAgent`
declares six optional hooks with silent defaults — `authorize`→allow, `index` and
`reservations`→empty, `capacity`→accept. `ledger` is supplied nowhere at all, in
production or in one test. A hook whose default is indistinguishable from the feature
working is why no test failed.

**One of the 36 was a live bug and is already fixed.** Static-host rendezvous answered
`[]` forever — `FabricNode.reservedPeerIds` held the right data and `serveAgent` was
never given it — with the signature `{asked: true, dialed: [], failed: []}`: nothing
attempted, nothing failed, no error. `rendezvous-wire.node.test.ts` starts three real
nodes and requires two to find each other with nothing supplied by the harness.

### Where Phase 10 landed

**The finding is the exit code.** A pipeline trusting elfconv's `0` would cache an
artifact that aborts at runtime under a name asserting it is clean. Two greps —
abort call sites and recovered addresses — must agree before the count is called
evidence, because a single grep that stopped matching would report zero and look
like good news.

**A real artifact was pointed at the executor for the first time**, and every
execution-side test before it used hand-written fixtures written from the same
understanding as the executor. The ABI held exactly: 23 WASI imports, `_start` and
`memory`, every import answered. And it turned up something fixtures could not — a
`printf("hello\n")` imports **`clock_time_get` and `poll_oneoff`**, because glibc's
stdio pulls them in whether the program asks or not. Pinning the clock is
load-bearing on the very first task anyone runs.

**The V8 code cache does not happen.** At 4.8 MB, `application/wasm`, query-free CID
URL, `compileStreaming`, hot enough to tier up: no WASM code-cache entry across three
visits, while the same profile grows a 2 MB *JavaScript* cache and a
`--v8-cache-options=none` calibration reads the identical 72B. Reported unmet rather
than reworded — a criterion that can only be reported as met is not a measurement.

**A recorded project assumption was wrong.** `CLAUDE.md` said elfconv needs
unstripped binaries. It does not: `.eh_frame` is enough, via libdwarf. Corrected in
`CLAUDE.md` and the roadmap.

**Two reviewer findings outlived the phase and were real.** A file carrying raw NUL
bytes had silently left the vocabulary guard's jurisdiction — an exemption with no
entry, which the guard's own planted violations could not detect because they scan
synthetic content rather than the tree. And `PINNED_WASI_FUNCTIONS` was checked only
for *identity*, which a replacement returning the wrong value satisfies exactly.
Both fixed; 8 mutations planted, 8 caught.

### Where Phase 9 landed

**Consent is a value, not a check.** `GrantedConsent` is minted only by
`grantConsent`, and `start` takes one as a parameter — a caller without one does not
fail a check, it fails to compile. No test-only bypass: the e2e harnesses consent
for the same reason a visitor clicks the button.

**Nothing touches the network before consent either.** Criterion 3 names CPU; the
owner's decision went further, because "we spent no cycles" is not an answer to "you
told a third party I was here". Proved by watching every request the tab makes.

**Stopping had to become real before it could be claimed.** `WasmExecutor` ran on
the main thread, where a synchronous `run()` cannot be interrupted — so "one click
drops CPU to zero" meant "zero once the current task finishes". Tasks now run in a
Worker; Stop calls `terminate()`. The probe that proves it is a bare `loop br 0`.

**A guard caught the exact trap it was written for.** Replacing `terminate()` with
a cooperative flag left every test green *except one* — the one that messages the
thread directly, past the executor, and requires silence. Rejecting the pending
promises makes a stop look instant while the thread keeps burning; resolving the
caller and killing the worker are two different acts.

**Ordering is what makes cubes worth having.** The colouring search first walled at
n = 205 and no parallelism moved it: assigning values in increasing order means a
cube fixes the *least* constrained numbers — 1 and 2 appear in no triple at all — so
cubing split the work without splitting the difficulty. Ordering by constraint
degree moves the wall with cube count: 1 cube → 300, 8 → 500, 256 → 600.

**Chromium throttles timers hard in a tab that is not in front** — measured, a
400 ms poll produced one tick per second. Anything the always-visible surface
depends on is pushed, never polled. This bit twice in one phase.

Numbers: 6 mutations planted, 6 caught. `verifyColouring` re-derives 484 triples at
n = 600 and accepts in under a millisecond, trusting no node.

### Where Phase 8 landed

**The ordering was the requirement.** `BENCHMARK-METHODOLOGY.md` went in before any
harness existed — checkable in `git log`. Three pre-registered predictions all held: the
node axis would be sub-linear (it was flat), the COST crossover would be embarrassing
(none, ~570×), and the fixture bias would dominate (it did).

**The headline caveat is what the numbers cannot show.** Every node in both curves runs
in one OS process on one event loop, so no parallel speedup is measurable at all. The
flat makespan is the consequence of that, not a finding about scaling. The scaling claim
is therefore **unmeasured** — which is neither disproved nor supported.

**The incomplete-run rule paid for itself immediately.** The first full run reported
19/19 incomplete at every memory rung rather than a suspiciously fast success: the memory
workers could not fetch shard inputs. A harness that averaged failures in would have
published a beautiful fictional curve.

**A misnamed field, caught before publication.** `JobResult.grossNodeSeconds` named a
quantity that was *bytes across the guest ABI*, not seconds — deterministic, which is
right for a cost metric, and off by a factor nobody could guess if published as time.
Renamed to `grossFuel`/`usefulFuel`; the driver measures real node-seconds itself.

**Two ladder rungs published as excluded, not dropped.** Real transport at 8 and 16 nodes
dies on `INBOUND_CONNECTION_THRESHOLD = 5` per host — the limit Phase 3 already found.
A rung that vanishes between plan and results is indistinguishable from one removed for
being inconvenient.

Numbers: connectivity tax **8–10×**; no COST crossover; decomposition native 0.002ms →
WASM in-process 0.61ms → distributed 1.3ms, so most of the gap is the ABI on a trivial
fixture rather than the fabric.

### Where Phase 7 landed

A job survives its machines — and its submitter — vanishing mid-flight. A lease is a
deadline, not a lock, so "never orphaned leases" needs no cleanup code and resume is the
same path as start. Then an adversarial review found five defects and refuted none, the
worst being that speculation could change the answer: breaking on the first arrival meant
a losing copy was never compared, so timing alone could pick between two different CIDs.
The test guarding it was vacuous. All fixed and mutation-tested.

### Where Phase 3 stands

Two browser tabs, and separately an iPhone running Safari and a laptop running Chromium,
complete a 4-shard 2×-redundant job over a **direct WebRTC** connection with the relay
carrying only SDP. Remaining: real AutoTLS, which needs a publicly reachable host.

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 11 P01 | 13min | 3 tasks | 13 files |
| Phase 12 P01 | 25min | 2 tasks | 17 files |
| Phase 12 P02 | 20min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Verification compares the SAME module run on two nodes, byte for byte. Not multiple implementations of the same computation — cross-implementation verification is explicitly out of scope.
- There is no static determinism analysis. Divergence is detected by the comparison, not predicted ahead of it. The admission gate was built and then deleted; do not reintroduce it. The import object is the sandbox — WebAssembly.instantiate refuses any import the host does not supply.
- The verification claim is split (C3, decided): redundant execution on public/shared data and on the aggregation tree; sovereign maps run redundantly within the owner's own node set when two or more are live, and are owner-attested otherwise.
- Relay decision inverted by evidence: own backbone relay primary (AutoTLS + webRTCDirect), public infra opportunistic only. Browsers structurally cannot dial the majority of public libp2p nodes.
- Ordering is load-bearing: sovereignty before placement, tree-reduce before placement, artifact signing at content-addressing time (not at elfconv time), coordinator checkpointing in the churn phase, governor + benchmark instrumentation in the kernel phase.
- **A remote executor is just an `Executor` (Phase 2).** `submitJob` takes `Executor[]` and cannot tell where one runs, so the network arrived without a kernel change. Any future "distributed" feature should first be checked against this: if it can be an adapter behind an existing port, it must be.
- **Packages split on the portability line, not the feature line (Phase 2).** `@o2/net` is portable and its tests run in Node *and* Chromium; `@o2/node` holds everything a browser cannot do. `purity.node.test.ts` enforces it — no `node:`/`libp2p`/`@chainsafe` import may appear in a portable package.
- **`Transport` stays a one-way datagram port (Phase 2).** Request/response correlation lives in `@o2/net` instead, because a datagram shape is the smallest thing an in-process table, a libp2p stream, and a relayed WebRTC channel can all implement.
- **All nodes have equal functionality (owner decision, 2026-07-26, restated twice).**
  There is no tier, no class, no lesser node. Every node executes tasks, holds blocks,
  serves records, hosts reduce combines, and takes quorum slots on identical terms.
  **The only difference is discovery**: a browser cannot bind a listening socket, so it
  cannot act as a seed a newcomer dials cold — it must be found through a relay that
  can. That is narrower than "reachability", which was the previous wording and was
  still wrong: once connected, the peers are indistinguishable. Proven in Phase 3, where
  an iPhone was dialled at its `/p2p-circuit/webrtc` address and ran half of a
  2×-redundant job. "Client-mode-only DHT" and "browsers are leaves" were inherited
  assumptions, both reversed. Background-tab throttling is a lease-duration problem, not
  a capability one. **If a decision keys on node kind, it is wrong** — the only
  legitimate use is shared-dependency analysis over the discovery graph.

- **Liveness changes who computes and when, never what the answer is (Phase 7).** The
  invariant every churn mechanism rests on. True because a result is a pure function of
  (module, input, partition) and content-addressed, so a re-dispatch recomputes
  byte-identical output and every recovery action is at worst wasted work. Re-check this
  first if any of the churn code changes.

- **A lease is a deadline, not a lock (Phase 7).** Nobody releases it and no keeper
  notices the coordinator left, so "never orphaned leases" needs no cleanup code. A lock
  would have required the holder-liveness protocol the deadline replaces.

- **A node failure and a task failure warrant opposite policies (Phase 7).** Collapsing
  both into `null` makes the 30%-node-loss criterion unachievable — three unlucky dead
  picks retire a good shard. Node failures retry until the pool is exhausted; task
  failures stop after three independent nodes fail the same work.

- **Re-dispatch must exclude tried nodes before placement (Phase 7).** Placement is
  deterministic by design, so a retry otherwise re-derives the identical dead choice.
  Narrowing the input is safe — the sovereignty gate still runs inside `placeWithOffers`.

- **Pre-registration is an ordering, not a document (Phase 8).** The methodology commit
  contains no harness and no number, so `git log` proves the analysis was not chosen
  after seeing the data. Predicting the disappointing results in advance is what stops
  a flat curve being spun as a surprise.

- **A fast failure is not a fast run (Phase 8).** Excluding incomplete runs from
  makespan statistics is what turned a silent 19/19 failure into a visible bug instead
  of a beautiful fictional curve.

- **A unit in a field name is a claim (Phase 8).** `grossNodeSeconds` held bytes. The
  ratio was fine, the absolute number would have been published wrong by a factor
  nobody could guess. Rename rather than document — a comment does not travel with the
  number into a report.

- **Publish excluded configurations with the reason (Phase 8).** A rung that vanishes
  between the plan and the results is indistinguishable, to a reader, from one removed
  because its number was inconvenient.

- **A fake that is faster than the real thing cannot see a timing bug (Phase 7).** The
  worst two churn defects — a hang, and a losing copy never compared — were both
  invisible to a suite whose dispatch resolved on a microtask. The integration test with
  real RPC found the OOM spin; the rest needed code read specifically for what the tests
  could not reach.

- **Speculation must not become a vote (Phase 7).** Returning the first arrival and
  discarding the other copy unexamined lets timing choose between two different answers.
  The winner may return immediately, but the loser has to be *compared* — after every
  shard settles, which costs nothing — and a copy that never answers is `uncompared`,
  never "agreed".

- **A documented bound is not an enforced one (Phase 7).** The coordinator's header
  promised silence gets a bounded wait while the code never read `expiresAt`. Grep for
  the mechanism whenever a comment states a guarantee.

- **Never race a timer that provably cannot act (Phase 7).** The straggler watchdog
  re-wrapped every pending promise per iteration and kept polling after speculation
  became impossible; against real I/O that is unbounded allocation, not a slow loop.
  Fake-dispatch tests cannot show this class of bug.

- **Discovery is an intersection, and each part is worthless alone (Phase 6).** Who
  holds the block, who the node is, and what it can run come from three independent
  sources — content routing, a provider-signed certificate, a node-signed capability
  record. The self-signed record looks like theatre until you see what it is bolted to;
  a test mints a valid one for an uncertified key and shows it buys nothing. Splitting
  it lets a node re-sign locally when its engine changes.

- **Every exclusion is named (Phase 6).** Silent filtering leaves a requestor unable to
  tell a dead network from a wrong clock from a module nobody can run.

- **The power-of-d sample is derived, not drawn (Phase 6).** Rendezvous ranking on the
  shard id instead of `random()`: same load result, but two requestors racing on one
  shard converge, re-placement re-derives the same candidates, the tail is already the
  re-pick list, and a decision can be replayed from its inputs.

- **Load is a hint; the offer is the authority (Phase 6).** `LocalCapacity` takes no
  ports and makes no calls, so "local information only" is a property of the type. A
  refusal is not an error path — it is how a stale guess becomes a correct decision.

- **A probe needs its own deadline (Phase 6).** An unreachable node cost a full RPC
  timeout before the re-pick, destroying the saving power-of-d exists to buy. Offers
  carry a 2s deadline and silence is a *stated* refusal. Only the wired-up test could
  find this — a unit test's admission callback returns immediately.

- **Attestation strength is derived, never declared (Phase 6).** owner-attested /
  owner-domain / independent, computed from certificates. Owner-domain and independent
  both show two replicas, so the count cannot distinguish them and the label must travel
  with the result.

- **Derive topology, never agree on it (Phase 5).** The reduce tree is a pure function
  of sorted partial CIDs, so every participant computes the same one with zero
  messages — no leader election, no consensus, nothing to lose. Assignment is HRW, and
  the ranking *is* the fallback list. Repair is recompute from CIDs, not state
  transfer; a late duplicate dedupes into nothing.

- **Associativity is the reduce contract; commutativity is not (Phase 5).** An earlier
  comment claimed both were required and justified it wrongly — a probe showed an
  order-dependent reducer breaks nothing, because grouping is canonical. The
  bit-identical single-node reference test is what enforces associativity.

- **Sovereignty is structural, never a preference (Phase 4).** `planPlacement` narrows
  to the owner's nodes *before* load is consulted; there is no branch that widens it.
  A sovereign shard with nowhere to run stalls. Verified by adding the forbidden
  relax-under-pressure branch and watching four tests fail.

- **Authorisation runs before execution, and the test proves the ordering (Phase 4).**
  A node that executes and *then* refuses has already read the data, so the test
  asserts the executor was never called, not merely that the reply said "unauthorized".

- **Integrity is not provenance (Phase 4).** A CID proves bytes match a hash; it says
  nothing about who published them. Nothing executes a bare CID — names resolve through
  signed records from anchors pinned at construction, and the resolver has no method to
  learn a new one.

- **A blockstore adapter must not alias its input or its storage (Phase 3).** Found
  by the conformance suite in `MemoryBlockstore`; the persistent adapters copy, so an
  aliasing in-memory adapter made kernel tests pass on semantics no real backend has.

- **Conformance vectors are hardcoded literals, never computed (Phase 3).** A
  computed expectation only proves an implementation agrees with itself.

- **The kernel must never need `crypto.subtle` (Phase 3).** A LAN origin
  (`http://10.144.82.249:5173`, `http://laptop.local:5173`) is *not* a secure context,
  so WebCrypto is absent. `multiformats/hashes/sha2` uses it, which silently broke every
  CID on any non-localhost page — while the node still *started*, so it failed at the
  first block rather than at join. Hashing is now `@noble/hashes`, pure JS. The
  import-scanning purity tests cannot catch this class of bug; a dedicated browser test
  removes `crypto.subtle` and requires the hashing path to survive.

- **A browser cannot do mDNS (Phase 3).** No API, any browser. LAN discovery is
  therefore: one URL (preferably the machine's existing `.local` Bonjour name, which
  iOS resolves natively and which survives DHCP churn), after which the page fetches
  `/bootstrap.json` from *its own origin* and is told to dial the same host it already
  reached. Nothing hardcoded, nothing guessed from network interfaces.

- **A relay's browser capacity is capped by inbound limits, not reservations (Phase 3).**
  `INBOUND_CONNECTION_THRESHOLD` is 5 **per host** and
  `MAX_INCOMING_PENDING_CONNECTIONS` is 10 — both below the 15 reservation default.
  Per-host matters in production too: every volunteer behind one NAT shares the budget.
  Exceeding either kills the noise handshake and looks like a network fault.

- **A duty cycle must serialize to mean anything (Phase 3).** Shards dispatch
  concurrently, so per-task yielding lets every yield resolve at once and the cap is
  bypassed. `GovernedExecutor` serializes while throttled, and only while throttled.

- **A relayed circuit cannot carry a job (Phase 3).** The relay is a signalling
  channel; the data path is WebRTC. A test that runs a job over `/p2p-circuit` is
  testing an unsupported configuration.

- **Packages form three tiers (Phase 3).** `core`/`net` portable — no platform *and no
  libp2p*; `libp2p`/`browser` dual-target — libp2p but no `node:`; `node` anything.
  Enforced by `purity.node.test.ts`.

- **Wire framing is uniform across transports (Phase 2).** One stream per message, completion signalled by the sender closing its write end — so no length prefix and no framing state machine. Chunked at 16 KiB with `runOnLimitedConnection: true` even on TCP, so the same path survives relaying in Phase 3.
- Part I (elfconv AOT) sequenced last and run as a parallel track; it must not block the capacity-scaling thesis.

- **Consent is a value, not a check (Phase 9).** `GrantedConsent` is minted only by
  `grantConsent` and `start` takes one, so "check consent before starting" is not a
  rule anyone has to remember. The obvious `if (hasConsent())` is exactly the shape
  that has failed twice here — a documented bound nothing enforced.

- **A stop that resolves the caller is not a stop (Phase 9).** Rejecting pending
  promises makes termination look instant while the thread keeps burning. Only a
  test that messages the thread directly, past the executor, can tell them apart.

- **Cooperative stopping cannot exist for WASM (Phase 9).** A synchronous `run()`
  admits no flag, no duty cycle and no governor. Off-main-thread execution is not an
  optimisation here, it is the requirement.

- **A metric must publish its own blind spot (Phase 9).** A node that cannot reach a
  peer cannot report that it cannot reach a peer, so the reported population is never
  the visited one — and that gap *is* the cliff being measured.

- **Overlapping views are merged by maximum, never by sum (Phase 9).** Asking eight
  peers for the same population and adding would multiply every sample size by eight
  while leaving the percentages unchanged: a correct-looking rate over a fictional n.

- **Chromium throttles timers in a background tab (Phase 9).** Measured: 400 ms poll,
  one tick per second. Anything a visible surface depends on must be pushed.

- **A cube must fix the *constrained* variables (Phase 9).** Splitting on the first k
  values split the work without splitting the difficulty, because the lowest values
  are the least constrained. Ordering by constraint degree is what makes more nodes
  reach further rather than merely reach faster.

- **`exhausted` and `budget` must stay different answers (Phase 9).** One is a proof,
  the other is a shortage of compute. Conflating them turns a limit into a false
  mathematical claim.

- **"Was not run" is not "works" (Phase 9).** DEMO-01's multi-machine half was about
  to be closed by reasoning from Phase 3's transport proof. Running it found two
  real defects instead — one of which every multi-tab test had structurally been
  unable to catch, because they all dial from the harness.

- **Assert what is on screen, not what the attribute says (Phase 9).** An id rule
  setting `display` outranks the browser's own `[hidden]`, so `getAttribute` was
  right while the element was visible. `isVisible`, always.

- [Phase 11]: A hook's absence is a value the call site writes (named sentinel literal), never an omission the type system tolerates — same shape as Phase 9's GrantedConsent. — AgentOptions's six hooks moved from optional to required unions with sentinel literals, closing the hole where an omitted hook silently defaulted to allow/empty/accept and made no fact recordable.
- [Phase 12]: not-enough-executors retired; a shard below requested redundancy is placed at what is available and marked degraded on ShardResult/JobResult instead of failing the whole job
- [Phase 12]: submitJob's placement now runs entirely through sovereignty.ts's planPlacement/eligibleNodes, correlating Executor to NodeDescriptor by nodeId; no other code path in submit.ts selects a node
- [Phase 12]: guardSovereignty is a pure Executor adapter (no Executor/AgentOptions port change), mirroring GovernedExecutor's shape
- [Phase 12]: Added a DATA-09 replica-holder test beyond the plan's four (Rule 2): a canExecuteSovereign:false node whose data genuinely exists in the shared blockstore is still excluded from execution, proving the refusal is about clearance, not missing data

### Pending Todos

None yet.

### Blockers/Concerns

- **Disclosure gate: CROSSED on 2026-07-26.** The repository was made public by explicit
  owner decision, after being told that EPO and China have no patent grace period and
  that the loss is permanent. **EPO and China patent rights for everything disclosed as
  of that date are forfeit.** Do not plan around recovering them. A US provisional
  remains possible for 12 months from first disclosure under §102(b)(1), and that
  window is now running — it is the only patent option left, and it is time-limited.

- **GitHub Pages is serving the pre-Phase-9 bundle.** It was deployed by hand on
  2026-07-26 and has *not* been redeployed since; the consent gate, the running bar,
  the colouring job and the policy page are in the repository but not on that URL.
  Redeploying is a human action by design (DEMO-04) — run `npm run build:demo` and
  publish `packages/browser/dist/` deliberately.

- **GitHub Pages is live** at <https://o2alexanderfedin.github.io/o2.services/>, served
  from the `gh-pages` branch, deployed **by hand** on 2026-07-26. Verified against the
  real URL: loads with zero page errors, correctly reports that no relay is reachable
  with Start disabled, `crossOriginIsolated` false (BROW-05 holding in production), and
  the kernel computes a CID byte-identical to local. It cannot join a peer until a
  public `wss://` relay exists — an HTTPS page cannot dial `ws://`, and Pages runs no
  server process.

- **DEMO-04 still holds, and is now enforced.** No deploy workflow file may exist in
  the repository at all — absent, not disabled — and no `package.json` script may
  publish. `disclosure-gate.node.test.ts` asserts both, checks for workflow files by
  *content* so relocation does not evade it, and is mutation-proved by planting one
  in two places. `build:demo` builds and publishes nothing.

- **Version traps (C5): resolved in Phase 2.** js-libp2p 3.x installed with exact pins; none of the four trap packages are present. Two duplicate resolutions were found and fixed with npm `overrides` — `multiformats` had both 14.0.5 and 13.4.2 (a v13/v14 `CID instanceof` boundary), and an invalid `uint8arrays@5.1.1` was hoisted above the 6.1.1 libp2p v3 needs. **`npm install` alone kept the stale tree; a clean re-resolution was required.** `constants.node.test.ts` now asserts one copy of each plus every relay/transport limit.
- **Doc correction:** the relay constants are named `DEFAULT_DURATION_LIMIT`, `DEFAULT_DATA_LIMIT`, `DEFAULT_MAX_RESERVATION_STORE_SIZE` — `DEFAULT_`-prefixed, unlike what PROJECT.md and STACK.md record. Values are as documented (2 min / 128 KiB / 15 / 2 h).
- **Node 23.11.0 is the host runtime and is not LTS.** Outside vitest's declared range (`^20 || ^22 || >=24`), so every install prints `EBADENGINE`, and `packages/node/src/bin/agent.ts` depends on Node's experimental native type stripping. Everything passes today. `STACK.md` specifies Node 24 LTS — switching the toolchain is a human action, deliberately not taken autonomously.
- **Open decisions carried into planning:** aegir vs. vitest for the three-target test discipline (Phase 2); WASM fuel metering has no maintained JS-side tool (Phase 1/2); Safari + WebRTC-Direct is unverified with a WSS-only fallback branch (Phase 4).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-27T19:19:24.189Z
Stopped at: Phase 12 Plan 02 complete — guardSovereignty (DATA-09 serving-side gate) built and mutation-tested; submitJob load-pressure discrimination, DATA-09 replica-holder, degraded, and rejection semantics proven at the submitJob level. 116 files / 1749 tests passing, tsc clean. Wave 2 remainder (12-03/12-04) not yet executed.
browser and e2e; `tsc --noEmit` clean; 64/72 requirements. See
`phases/phase-9-public-demo/SUMMARY.md` and `09-VERIFICATION.md`.
Next unit: **Phase 10 — elfconv AOT native→WASM pipeline**, the parallel track.
DEMO-04 still holds and is now enforced by `disclosure-gate.node.test.ts`: no deploy
workflow file may exist in the repository at all, absent rather than disabled, and no
`package.json` script may publish. `build:demo` builds; nothing deploys.

**The two-device run happened, and was worth it.** The owner ran the demo on an
iPhone and a laptop against one LAN seed on 2026-07-26: both joined, one peer
connected, the search distributed, the answer verified in the page. It found two
defects the whole e2e suite had passed over — an always-visible bar that was
literally always visible (an id `display` rule outranks `[hidden]`, and the tests
asserted the attribute rather than the screen), and a peer filter that matched the
relay's own id inside every circuit address, so two devices on one relay skipped
every candidate and never heard of each other. Both fixed and now tested.
Resume file: None
(no static determinism analysis, no cross-implementation verification, no host-import
allow-list). Still current; they apply to every later phase.

**Phase 3 still needs a human decision for the "public host" halves.** Real AutoTLS
(criterion 2) and "two tabs on *different machines*" (criterion 1) both require
publicly reachable infrastructure — outward-facing and hard to reverse, and it
collides with the disclosure gate below (now crossed — but a public relay is still a
hosting decision, not a disclosure one). Deliberately not done autonomously. The
WebRTC path itself is proven locally, so crossing machines should need no code change,
only a different relay address.
