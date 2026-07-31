---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Wire What Was Built
status: verifying
stopped_at: Phase 13.1 executed 5/5 plans with 5/5 summaries and has no VERIFICATION.md; independent verification is the next unit
last_updated: "2026-07-31T19:42:00.000Z"
last_activity: 2026-07-31
progress:
  total_phases: 14
  completed_phases: 3
  total_plans: 45
  completed_plans: 17
  percent: 21
---

<!--
progress counts the v1.1 milestone only: phases 11, 12, 13, 13.1, 14-23. Fourteen of
them; 11, 12 and 13 are verified done. Phase 13 was counted incomplete for most of
2026-07-28 — its first independent pass scored the original criteria 0/3, the criteria
were amended on three owner rulings, four more plans closed the gaps, and a second
independent pass then scored 3/3 against the amended text. It counts now because a
verifier said so, which is the rule: a phase is done when a verifier says so, not when
its plans are.

**That rule is why `completed_phases` is 3 and not 4.** Phase 13.1's five plans all
executed and all five summaries are filed, so `completed_plans` counts them — but the
phase directory holds no VERIFICATION.md and its five requirements are all still `[ ]`
in REQUIREMENTS.md. Executed is not verified. Do not tick 13.1 from its summaries.

`total_plans` counts plans that exist, and it is not a milestone denominator — phases
18, 19, 20 and 22 have no directory yet, so it will grow. Counted on disk 2026-07-31:
11:1, 12:4, 13:7, 13.1:5, 14:5, 15:4, 16:4, 17:5, 21:5, 23:5 = 45, of which 17 have a
summary. A `find` across `.planning/phases/` returns 46 — the extra is phase-9's plan,
which is v1.0 and outside this count.

Do not take these from `gsd-sdk query progress.bar` — it counts plan files across the
nine unarchived v1.0 phase directories and reports "17/9 plans (100%)". Also do not run
`gsd-sdk query state.begin-phase` here: it overwrites this block from that same bad
count (observed 2026-07-28, it rewrote 25% to 62%) and mangles the Current focus
paragraph. Maintain this frontmatter by hand.
-->


# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-27)

**Core value:** Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.
**Current focus:** Phase 13.1's code is in and nobody has checked it. All five plans executed
on 2026-07-29 and all five summaries are filed, but no independent pass has scored it against
its seven success criteria and no VERIFICATION.md exists. Its five requirements — SCHED-06,
NET-08, NET-09, NET-10, DATA-10 — are all still `[ ]`. This is the milestone's only
ambiguous phase, and Phase 18's criteria 2b and 2c were written *specifically* so that 18
cannot silently pass around whatever 13.1 left open. Verify it before starting anything else.

## Current Position

Phase: 13.1 (Node-Side Admission & Transport Bounds) — **executed, unverified**
Status: 5/5 plans, 5/5 summaries, 0 verification passes. A partial pass scored 4 of 7
criteria; that reading is not a verdict and no VERIFICATION.md was written from it.
The five requirements are all measured defects, not inferred ones: SCHED-06, NET-08,
NET-09, NET-10, DATA-10. **Not NET-07** — that ID was already taken by a done Phase 2
requirement (REQUIREMENTS.md:212, the constants-regression test); an earlier version of
this line carried the pre-renumbering list until 2026-07-29. ROADMAP.md's Phase 13.1
entry is the authoritative list.
Next: `/gsd-verify-work` on Phase 13.1. Then Phase 14, 15, 16, 17, 21 and 23 — all six
are fully planned and every one of their blockers is a phase already closed, so they are
unblocked today and can run concurrently.
Last activity: 2026-07-31

```
Test Files  262 · Tests 4008 · exit 0 · tsc --noEmit clean   (2026-07-30, load 89-160)
```

The 262 counts vitest *file-runs*, not files: 108 `*.test.ts` files on disk, with the
browser project running its share three times over chromium/firefox/webkit. That reading
was taken deliberately under contention — a green suite at load 160 is stronger evidence
than a green suite on a quiet host, and every full-suite failure in the preceding two days
traced to load rather than to logic. **Do not take a fresh reading without checking
`uptime` first.** At 12:42 on 2026-07-31 the host was at load 213 and no timing-sensitive
result taken then would mean anything.

### v1.0 carried forward, unarchived

```
Ledger      33 / 72 wired · 30 built-not-wired · 5 partial · 4 open: hosting, a
            measured negative, and two whose cross-machine halves are descoped to
            one host (2026-07-28) and recorded as unmeasured, not met
v1.1        7 of 50 requirements closed
Historical  v1.0 closed at 112 test files / 1673 tests; 122 / 1775 on 2026-07-28
```

The 30 reconciles with the audit's 36: six have been wired since — DATA-03, DATA-04,
DATA-05, DATA-06, DATA-07 and DATA-09, all in Phase 12. Count them from the **traceability
table** rows (`^| ID |` … `**Built, not wired**`), which is the only place that marker
lives; a whole-file grep also catches the legend and one line of prose and returns 32.

**Two denominators, and confusing them is the trap.** REQUIREMENTS.md's own header reads
*"33 of 72 are `[x]`"* — that is the **v1 section alone** (33 ticked + 39 not = 72) and it
is correct as written, not stale. v1.1 then minted 10 further IDs in its own sections
(WIRE-01…04, SCHED-06, NET-08, NET-09, NET-10, DATA-10, BENCH-07), of which only WIRE-01
is ticked. So the whole-file count is **34 of 82** and neither number contradicts the
other. Recount with the section ranges, never with a whole-file grep.

**v1.1's scope is 50, not 44.** Forty existing IDs to be wired, plus those 10 new ones.
The line said 44 because it was written when only WIRE-01…04 existed; SCHED-06, NET-08,
NET-09, NET-10 and DATA-10 were minted on 2026-07-28 with Phase 13.1 and BENCH-07 with
Phase 23. The numerator is unchanged at 7 — DATA-03, DATA-04, DATA-05, DATA-06, DATA-07
and DATA-09 from the existing forty, plus WIRE-01.

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

**This section is a partial record and must not be read as a velocity figure.** The
per-plan rows below are appended by the executor, and only 8 of the 17 executed plans
ever got one: Phase 13's plans 04-07 and all five of Phase 13.1's are missing. The
template header that used to sit here read *"Total plans completed: 0"* directly above
eight rows of real data, with the By-Phase table left as placeholder dashes — replaced
2026-07-31 with what the rows actually say.

**Logged: 8 plans, 247 min, 4.1 hours, mean 31 min/plan.** The mean is not meaningful —
the spread is 7 min to 100 min, and this project's own benchmark methodology records
that straggler-dominated distributions have meaningless means.

| Phase | Plans logged | Total | Median | Range |
|-------|--------------|-------|--------|-------|
| 11 | 1 of 1 | 13min | 13min | — |
| 12 | 4 of 4 | 190min | 35min | 20-100min |
| 13 | 3 of 7 | 44min | 12min | 7-25min |
| 13.1 | 0 of 5 | — | — | — |

*Rows appended after each plan completion:*

| Phase 11 P01 | 13min | 3 tasks | 13 files |
| Phase 12 P01 | 25min | 2 tasks | 17 files |
| Phase 12 P02 | 20min | 2 tasks | 4 files |
| Phase 12 P04 | 100min | 2 tasks | 8 files |
| Phase 12 P03 | 45min | 1 tasks | 2 files |
| Phase 13 P01 | 12min | 2 tasks | 5 files |
| Phase 13 P02 | 7min | 2 tasks | 2 files |
| Phase 13 P03 | 25min | 2 tasks | 1 files |

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
- [Phase 12]: parseRequest refuses an exec request with no label; Task.label stays optional in-process, only the wire boundary enforces it — Correction 2: an absent label reaching guardSovereignty is a no-op, trusting whoever dispatched the task not to omit the field the refusal depends on
- [Phase 12]: guardSovereignty wired into both fabric-node.ts and browser-node.ts production constructors, defaulting to cleared-for-nobody — Correction 1: guardSovereignty had zero production callers before this plan, the exact built-not-wired shape the v1.0 audit exists to catch
- [Phase 12]: Plan 12-03 (skipped by the orchestrator in Wave 2/3) closes the exact gap the Phase 12 verification pass found: submitJob's sovereignty-pinned placement is now proven across three real bin/agent.ts operating-system processes, not only in-process. bin/agent.ts gained --owner-id/--can-execute-sovereign CLI flags (a pass-through of the existing FabricNodeOptions.sovereignty option) so a spawned process can be cleared for its own owner; the required widen-under-pressure mutation failed as expected (insufficient, not agreed) and revealed a second, independent defense already holding: the mutated process's own guardSovereignty wrap refused the wrongly-widened dispatch.
- [Phase 13]: registerSovereignInputs composed outside guardSovereignty, not inside — registering a task guardSovereignty is about to refuse is harmless, keeps composition order identical at both Plan 13-02 call sites
- [Phase 13]: submitJobWithEgress delta-slices EgressGuard.manifest.entries before/after submitJob rather than calling reset(), so job-scoped manifests compose with concurrent reads instead of discarding shared history
- [Phase 13]: egress is a new field on FabricNode/BrowserNode, not a type change to transport — EgressGuard lacks .stop()/.peers that existing callers (including packages/browser/demo/main.ts) depend on
- [Phase 13]: Both node factories now compose registerSovereignInputs(guardSovereignty(inner, sovereignty), {blockstore: store, guard: egress}) identically — the sovereignty default is resolved exactly once per start() call, feeding both the guard's ownerId and the clearance check
- [Phase 13]: Sovereign test fixtures must be pre-seeded onto the executing node's local-only store before dispatch, not just onto the requestor's store -- registerSovereignInputs reads only the local tier and silently skips registration otherwise, which would make a falsification test pass vacuously
- [Phase 13]: Mutation 2 (removing the EgressGuard transport wrap) breaks all four production-wiring tests, not only the one the plan named -- reported as observed rather than narrowed to fit the plan's prediction

- **[Phase 13.1] A reservation with no release is a leak, so the reservation moved to the
  branch that has one.** `LocalCapacity.offer` reserved a slot that nothing on the wire ever
  redeemed — a liveness probe would have leaked one slot per peer per call — so the `offer`
  branch became `LocalCapacity.would`, which reserves nothing, and the slot is now taken in
  the `exec` branch before the `try` and released in a `finally` that covers success, a
  failed outcome, a throw, and the `authorize` refusal that never calls the executor at all.
- **[Phase 13.1] That deliberately removed cross-shard over-commit protection, and it is
  Phase 18's to rebuild.** `placeWithOffers` rebuilds `pool` per request, so the reserving
  offer branch was the only thing bounding placement *across* shards. `planWithOffers` +
  `rpcAdmission` will now put all N shards of a job on one node with `maxConcurrent: 1`.
  `packages/net/src/discovery.test.ts` pins this as a recorded consequence — four shards on
  one 1-slot node, zero refusals — and **that test is expected to turn red when Phase 18
  closes criterion 2c.** Do not "fix" it before then. The two candidate mechanisms, both
  protocol changes, are in `agent.ts`'s own comment.
- **[Phase 13.1] A cap applied after the loop has already paid for the allocation it
  exists to prevent.** `readMessage` accumulated every peer-sent chunk and then allocated
  their sum, both peer-driven and neither bounded; the check now sits *inside* the
  `for await`, immediately after the byte count grows, and calls `stream.abort()`. That
  placement is the whole content of NET-08 — a 64 MiB frame was accepted over the real
  transport before it.
- **[Phase 13.1] `'sender'` is a third `DispatchOutcome.kind`, because a connection the
  sender tore down is not a failure of the receiver.** Produced only from a
  `SendRefused`; `coordinator.ts`'s single policy read is unchanged and its fall-through
  carries a comment saying it is a decision rather than an omission.
- **[Phase 13.1] A pre-scan is the same check, earlier — not a weaker one.** `EgressGuard`
  gained `violationIn(frame)` (pure query, records nothing) and `refuse(to, frame)`
  (records on a hit only). Scanning a reply *body* suffices because `contains` is a
  contiguous-run search and dag-cbor encodes a byte string as a header plus raw bytes, so
  the payload is the same contiguous run once nested. `refuse` records only on a hit
  because it may be asked about a frame never offered to the exit; recording clean answers
  would count every reply twice.
- **[Phase 13.1] The pre-change capture was planted, watched, and restored by `cp` with
  `cmp` exit 0 — no `git` write command.** The proof the restore was byte-exact is that
  `git status --porcelain` afterwards listed only the new untracked test file. Worth
  copying: on a shared working tree a `git checkout --` to "restore" is how another
  session's work gets destroyed.
- **[Phase 13.1] The hook is named `admission`, not `capacity`.** Recorded in 13.1-05.

### Pending Todos

Two open owner decisions, both deferred with the measurement they were waiting for now in
hand. Neither blocks Phase 13.1's verification.

1. **The `lift.node.test.ts` integration timeout.** `INTEGRATION_TIMEOUT_MS` is 15 min and
   wraps 45 min of internal budget (a 5 min compile plus 2 × 20 min `DEFAULT_TIMEOUT_MS`) —
   the outer clock is the smaller one, so the inner budgets can never fire. A real lift is
   now measured at **152.7-304.3 s**, a 2× swing with load, so any fixed budget must be
   sized against the top of that range and not the middle. An earlier attempt to set it to
   300 s turned six tests red and was reverted.
2. **The benchmark's row-order confound.** Load drifted 29→49 during a run, so no
   inter-row difference under ~20% is claimed. Fixing it needs interleaved rows rather
   than blocks, or a quiet host.

Four smaller follow-ups recorded during the 22-bug round, none load-bearing:
`SpeculationLedger.discarded` has zero readers; `submit.test.ts:79-206` duplicates
`verify.test.ts`; the `agreed` outcome carries no `failures` field; and
`classifyStartFailure` can only ever return `other` for an unreachable relay.

### Blockers/Concerns

**Three items are owner-blocked and unaffected by the 2026-07-28 testing-standard ruling:**
the US provisional patent deadline (below), a hosted relay with real AutoTLS (NET-03,
Phase 3 criterion 2), and GitHub Pages serving the pre-Phase-9 bundle (below). *"A second
machine"* used to be a fourth. It is not a blocker any more — it has been struck, and its
residual is recorded immediately below rather than dropped.

- **What the lifted-vs-native benchmark costs Phase 21 (measured 2026-07-31).** Timing
  `wasi.start()` alone, on a 32 MiB memory-and-ALU workload that all three routes agree on
  (checksum `9584708361817009923`): native 58.78 ms, direct-compiled WASM 65.19 ms (1.11×),
  elfconv-lifted WASM 122.81 ms (**2.09×** native, 1.88× direct). That is the emulation
  tax, and it is the honest number to plan AOT-04 against.
- **The ~43 ms startup floor cannot be cached away, and this was tested rather than
  assumed.** On a trivial subject the lifted `_start` alone is 42.83 ms and
  instantiate+start is 42.65 ms — indistinguishable, so the entire floor executes *inside*
  the guest, in elfconv's emulated machine-state init, and is re-paid per task. Compile
  (~4 ms, and V8 compiles lazily) and instantiate (~1.8 ms) are not where it lives. Direct
  WASM's `_start` for the same program is 0.03 ms, ~1400× less. Content addressing fully
  solves distributing the 5.40 MiB artifact — which is 5.40 MiB whether the program does
  nothing or 128 MiB of traffic — but the floor stays, and under N-version execution it is
  paid per replica, which puts a floor on useful shard size. AOT-05 independently recorded
  V8's WASM code cache as NOT OBSERVED, so that route is closed twice over.

- **Residual of the same-machine testing standard (owner ruling, 2026-07-28) — recorded,
  not blocking.** Same machine, different browsers and/or different browser contexts and
  different OS processes, is the project's testing standard everywhere. So no criterion of
  this project's own is waiting on a second machine. The residual is that
  **cross-machine reproducibility (AOT-03) and distinct-machine benchmarking (BENCH-06)
  are unverified by choice**, and closing either would need hardware the project does not
  have. Both requirements were rewritten to what one host genuinely establishes; **neither
  descoped half may be reported as demonstrated.** `CROSS_MACHINE_BLIND_SPOT` stays on
  every lifted artifact — Phase 10 showed it is structural, not configurational — and the
  same-machine benchmark label stays required and derived from the recorded inventory.

- **Relay hosting investigated 2026-07-28 — Cloudflare cannot carry the relay, and the reason
  is structural.** Confirmed verbatim from Cloudflare's docs: *"it is not possible to make an
  inbound TCP connection to your Worker"*, and no Cloudflare compute product exposes UDP (which
  independently rules out WebRTC-Direct). The codebase already refuses the deployment on its own
  terms — `canRelay` (`fabric-node.ts:289`) is false without a non-circuit listen address, so
  `circuitRelayServer()` is never added and the reservation limit is 0.
  - **Correction to the first pass, which was wrong:** Cloudflare **Containers** are *not* ruled
    out by transport. A container is a real Linux process on a real port and
    `@libp2p/websockets`' Node listener runs unmodified; the `browser`-condition stub that kills
    workerd does not apply. Containers fail on **lifecycle** instead — no minimum uptime
    guarantee and irregular restarts against a 2-hour reservation TTL (`constants.ts:68`), and a
    relay can never re-dial a browser to recover. Cost was also wrong in both directions: wall-
    minutes are not vCPU-minutes (a `lite` instance is 1/16 vCPU), and the Durable Object figure
    double-counted — 331,776 GB-s is *inside* the 400,000 included, so ~$0 marginal duration.
  - **Recommendation:** a small always-on host with a public IP and arbitrary port binding.
    **But the sizing must carry a full node, not a relay daemon** — `fabric-node.ts:394-396`
    records that no construction path yields a node which will not compute, and `bin/seed.ts:45`
    says the seed executes tasks, serves blocks *and* relays. A relay-only budget reintroduces
    the class that was deleted, which the module comment notes already *"survived three rounds
    of renaming."*
  - **Two defects found incidentally, both fixed 2026-07-28.** The disclosure gate's wrangler
    pattern missed `wrangler pages deploy` — the command someone would actually type — and
    nothing noticed because every test asserted *absence*, so a pattern matching nothing read
    green. Each pattern now carries the commands it must catch and must ignore, asserted
    directly. Separately: `stun:stun.cloudflare.com:3478` is **already** in `@libp2p/webrtc`'s
    `DEFAULT_ICE_SERVERS` and in use, so "add Cloudflare STUN" is a no-op — and pinning to it
    alone would cut four independent STUN operators to one.
  - **Unverified, worth chasing upstream:** `@libp2p/circuit-relay-v2` appears to write
    `defaultDurationLimit` in milliseconds into a protobuf field the spec defines in seconds, so
    a dialer computes 33.3 hours where the server enforces 120 s.

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

Last session: 2026-07-31T19:42:00.000Z
Stopped at: Phase 13.1 executed (5/5 plans, 5/5 summaries, `13.1-CONTEXT.md` written) and
never verified. Two days of off-roadmap hardening then ran on top of it, all merged.
Next unit: **`/gsd-verify-work` on Phase 13.1**, against the seven success criteria in
ROADMAP.md:353. Phase 14 is not next, and its `14-CONTEXT.md` dated 2026-07-27 is fine and
should be left alone — 13.1 was inserted ahead of it after the backpressure gap was measured.

### Off-roadmap work, 2026-07-29 → 2026-07-31

Not attributable to any phase, and recorded here so it is not mistaken for phase progress.
65 commits, all merged to `develop` and pushed; `develop` and `main` both match origin and
the tree is clean.

- **A 22-bug round.** Seven verification gaps and four timing defects closed. The timing
  class is the one worth remembering: **a test arms two clocks — its own internal budget
  and the framework's `testTimeout` — and the framework's must be the larger.** Inverted,
  the internal timer can never fire and the test cannot express the thing it was written
  to express. Related, and learned the hard way three times in a row: **size a bound
  against the worst case the file can construct, not the typical one**, and **never set a
  timing bound from a number you did not measure yourself.** One such guess set
  `timeoutMs` to 300 s against a lift that really takes 304.3 s and turned six tests red;
  it was reverted.
- **A security residual closed in `browser-node.ts`.** `createWorker` became required and
  the `worker ?? new WasmExecutor(...)` fallback was deleted, so a browser node can no
  longer silently execute on the main thread. The `offMainThread` getter went with it —
  once it could only return one value, the four e2e assertions reading it were tautologies.
- **31/31 mutations caught**, and the full suite passed at load 89-160.
- **The elfconv lifted-vs-native benchmark** (`tools/aot/bench-lifted.ts`, `fixtures/workload.c`).
  Findings in `.planning/BENCHMARK-RESULTS.md` and in commit `ce05cf2`; the two that bear
  on Phase 21 are below under Blockers/Concerns.

Two items were deferred to the owner and are still open: the benchmark's row-order confound
(load drifted 29→49 mid-run, so no inter-row difference under ~20% is claimed — fixing it
needs interleaved rows or a quiet host), and the `lift.node.test.ts` integration timeout,
where `INTEGRATION_TIMEOUT_MS` of 15 min wraps 45 min of internal budget. The measurement
that decision was waiting on now exists: a real lift takes **152.7-304.3 s** depending on
load, a 2× swing, so any fixed budget has to be sized against that whole range.

The three paragraphs below this line are older sessions' notes that were appended here
rather than replaced; they describe Phases 9 and 3 and are kept because they are still
accurate about those phases. They are not a description of the current position.
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
Resume file: `.planning/.continue-here.md` (rewritten 2026-07-31, `status: merged_clean` —
nothing in flight, and it leads with the two open owner decisions listed under Pending
Todos above)
(no static determinism analysis, no cross-implementation verification, no host-import
allow-list). Still current; they apply to every later phase.

**Phase 3 still needs a human decision for the "public host" half.** Real AutoTLS
(criterion 2) requires publicly reachable infrastructure — outward-facing and hard to
reverse, and it collides with the disclosure gate above (now crossed — but a public relay
is still a hosting decision, not a disclosure one). Deliberately not done autonomously.
**Criterion 1 is no longer part of this.** It was restated on 2026-07-28 to two browsers
or two isolated browser contexts on one machine, per the testing-standard ruling, and it
had already been closed in a stronger form than the restatement asks — an iPhone running
Safari and a laptop running Chromium, on genuinely different machines, over direct WebRTC
with the relay carrying SDP only. That stronger result stands in the record.
