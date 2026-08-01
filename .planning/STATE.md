---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Wire What Was Built
status: executing
stopped_at: Phase 16 verified 3/4 and is NOT closed — criterion 3's late-arrival clause is scheduled to Phase 20 criterion 6. Its admission finding was closed afterwards by 16-06. Phase 17 is the next unit
last_updated: "2026-08-01T07:15:00.000Z"
last_activity: 2026-08-01
progress:
  total_phases: 14
  completed_phases: 5
  total_plans: 48
  completed_plans: 33
  percent: 36
---

<!--
progress counts the v1.1 milestone only: phases 11, 12, 13, 13.1, 14-23. Fourteen of
them; 11, 12 and 13 are verified done. Phase 13 was counted incomplete for most of
2026-07-28 — its first independent pass scored the original criteria 0/3, the criteria
were amended on three owner rulings, four more plans closed the gaps, and a second
independent pass then scored 3/3 against the amended text. It counts now because a
verifier said so, which is the rule: a phase is done when a verifier says so, not when
its plans are.

**That rule is why `completed_phases` is 5 and not 6.** The five are 11, 12, 13, 14 and 15.
**Phase 13.1 is not among them**: verified 2026-07-31, `gaps_found` at 6/7 — SCHED-06,
NET-08, NET-09 and NET-10 closed, DATA-10 open. It stays uncounted until criterion 7's
at-rest half lands.

**The count is over criteria, never over requirements, and Phases 13.1 and 15 are the
pair that shows why.** 13.1 is uncounted because one of its own **criteria** is PARTIAL.
Phase 15 is counted because all three of its criteria are MET — even though its
requirement, AUTH-03, is *also* Partial. A requirement can outlive the phase that opened
it; a criterion cannot. AUTH-03's requestor half is scheduled, by owner ruling, to Phase
23 criterion 5, and REQUIREMENTS.md's row says so. **`completed_phases` is not a count of
closed requirements and must never be reconciled against one.**

- **Phase 14** — `passed`, 3/3, both mutation probes re-run independently and both red;
  DET-03 and DATA-08 ticked and moved off *Built, not wired*.
- **Phase 15** — 3/3 on criteria. The verifier returned `human_needed` on three
  escalations, **all three since closed**: a production comment naming a function this
  repository does not have, a SUMMARY frontmatter claiming AUTH-03 complete, and an
  unproven browser-tier authorizer. The last was closed behaviourally in 15-05 and is
  pinned by mutation-ledger entry **M30**.

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
**Current focus:** Phase 15 (Capability-Chained Dispatch). Phases 13.1 and 14 were both
verified on 2026-07-31 and their verdicts differ: **14 passed 3/3 and is closed**; **13.1
scored 6/7 and is not.** 13.1's open item is DATA-10 — a node still serves a raw sovereign
block once the job that registered it has ended, because `submitJobWithEgress` releases the
registration in a `finally`, and bare `submitJob` never registers at all. Owner ruling
2026-07-31: close the at-rest half at a boundary the node owns, and fold the bare-`submitJob`
half into Phase 20, where `submitJob` becomes the single job path and the fix lands at one
boundary rather than two. Phase 18's criteria 2b and 2c still exist so 18 cannot pass around
what 13.1 left open, and criterion 2c is expected to turn `packages/net/src/discovery.test.ts`
red when it lands.

## Current Position

Phase: 16 (Decomposable Tree-Reduce Wiring) — **3/4 on criteria, NOT closed**
Status: 4 planned plans + 2 gap-closure plans (16-05, 16-06), 6 summaries, 1 verification
pass. Criteria 1, 2 and 4 MET; **criterion 3 PARTIAL** — its dedupe half is proven across
nine real `bin/agent.ts` processes, its *"arriving late"* half is not, because
`executeReduce` stops at `wanted` replicas and has no channel on which a late result could
arrive at all. Scheduled to **Phase 20 criterion 6** by owner ruling rather than rewritten.
**MR-04 stays open**; nothing was ticked.

**Uncounted for the same reason Phase 13.1 is, and it is worth seeing the pair together.**
Phase 15 was counted with a Partial *requirement* because all its *criteria* were MET.
Phases 13.1 and 16 are uncounted because one of their own *criteria* is PARTIAL. The rule
does not bend for how nearly done a phase looks.

**One finding was closed after the verifier wrote its report:** 16-06 bounded the combine
branch at the `capacity` hook, closing the widened fetch surface that routing combine
through the `Authorizer` had opened. The report predates it and still records it as open.

Previous phase: 15 (Capability-Chained Dispatch) — **3/3 on criteria, closed; AUTH-03 open**
Status: 4 planned plans + 1 gap-closure plan (15-05), 5 summaries, 1 verification pass.
The serving half of AUTH-03 is wired and verified between two spawned `bin/agent.ts`
processes; the requestor half — `delegate`, `CapabilitySupplier`, `RemoteExecutor`'s
supplier branch — has a production adapter and **zero production callers**, and is Phase
23 criterion 5 by owner ruling. Mutation-ledger entry **M30** now pins the browser tier's
authorizer behaviourally.
Next: Phase 16, then 17, 18, 19, 20, 21, 23, 22. **These run strictly sequentially, not
concurrently** — measured 2026-07-31 from their own `files_modified`: `fabric-node.ts` is
touched by 14/15/17/21, `bin/bench.ts` by 14/15/16/17/23, `browser-node.ts` by 14/15/17/21.
"Wire What Was Built" means every phase converges on the same construction sites, so the
earlier note that six phases "can run concurrently" was wrong.
Last activity: 2026-07-31

```
Test Files  ~300 · Tests 4479 · exit 0 · tsc --noEmit clean   (2026-08-01, load 12)
node 95 files/1399 · browser 3063 (chromium+firefox+webkit) · e2e 8/40 · 36 of 37 mutations caught
```

The 272 counts vitest *file-runs*, not files, because the browser project runs its share
three times over. **Run vitest by project, never by bare path** — `npx vitest run <path>`
fans out across all four projects (`node`, `browser`, `e2e`, `perf`) and exceeded ten
minutes twice on 2026-07-31 before this was understood. **Do not take a fresh reading
without checking `uptime` first**: at 12:42 that day the host was at load 213 and no
timing-sensitive result taken then would have meant anything; the reading above was taken
at load 6.6-10.5 once the competing build finished.

### v1.0 carried forward, unarchived

```
Ledger      35 / 72 wired · 27 built-not-wired · 6 partial · 4 open: hosting, a
            measured negative, and two whose cross-machine halves are descoped to
            one host (2026-07-28) and recorded as unmeasured, not met
v1.1        9 of 50 requirements closed
Whole file  40 of 82 ticked (35 in the v1 section + 5 in v1.1's)
Historical  v1.0 closed at 112 test files / 1673 tests; 122 / 1775 on 2026-07-28
```

**The 27 and the 6 moved together and the ticked counts did not.** Phase 15 took AUTH-03
off *Built, not wired* and onto **Partial** without closing it: its serving half is wired
and verified, its requestor half has zero production callers. A requirement can leave
"built, not wired" without arriving at "done", and the ledger has to be able to say so —
otherwise the only way to record progress is to overstate it.

The 27 reconciles with the audit's 36: eight have been wired since — DATA-03, DATA-04,
DATA-05, DATA-06, DATA-07 and DATA-09 in Phase 12, then DET-03 and DATA-08 in Phase 14 —
and one, AUTH-03, moved to Partial in Phase 15.
Count them from the **traceability table** rows (`^| ID |` … `**Built, not wired**`),
which is the only place that marker lives; a whole-file grep also catches the legend and
one line of prose and overcounts by two.

**Ticking a requirement is three edits, not one.** Phase 14's verification found this:
the checkbox, the traceability row's *Built, not wired* marker, and the section header's
own count all have to move together, and ticking alone leaves the ledger disagreeing with
itself. There is a fourth: `packages/node/src/acceptance-traceability.node.test.ts` pins
specific ids in specific states, and 13.1's verification broke it by closing SCHED-06
while that spot-check still asserted it open — **`develop` was red from that commit until
it was caught by an unrelated executor.** Run that file after any ledger edit.

**Two denominators, and confusing them is the trap.** REQUIREMENTS.md's own header reads
*"35 of 72 are `[x]`"* — that is the **v1 section alone** (35 ticked + 37 not = 72) and it
is correct as written, not stale. v1.1 then minted 10 further IDs in its own sections
(WIRE-01…04, SCHED-06, NET-08, NET-09, NET-10, DATA-10, BENCH-07), of which five are now
ticked: WIRE-01, plus SCHED-06, NET-08, NET-09 and NET-10 from 13.1's verification.
DATA-10 is the one 13.1 left open. So the whole-file count is **40 of 82** and neither
number contradicts the other. Recount with the section ranges, never with a whole-file grep.

**v1.1's scope is 50, not 44.** Forty existing IDs to be wired, plus those 10 new ones.
The line said 44 because it was written when only WIRE-01…04 existed; SCHED-06, NET-08,
NET-09, NET-10 and DATA-10 were minted on 2026-07-28 with Phase 13.1 and BENCH-07 with
Phase 23. **The numerator is 9:** DATA-03, DATA-04, DATA-05, DATA-06, DATA-07 and DATA-09
from the existing forty (Phase 12), DET-03 and DATA-08 (Phase 14), plus WIRE-01. The four
that 13.1's verification closed are among the 10 new IDs, not the forty, so they raise the
whole-file count without moving this numerator.

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
- **[Phase 13.1 — CORRECTED 2026-08-01] The hook is `AgentOptions.capacity`; `admission`
  is the instrument.** This line used to read *"the hook is named `admission`, not
  `capacity`"* and that is wrong — `agent.ts:171` declares
  `readonly capacity: LocalCapacity | 'accepts-every-offer'`, and `admission` is the
  local holding what `capacity.offer()` returns, plus `FabricNode.admission` as the
  high-water instrument. `fabric-node.ts:365` explains why the two names differ.
  **A second error rode along with it:** `LocalCapacity.offer` *does* reserve
  (`placement.ts:372-378`). What reserves nothing is `serveAgent`'s **`offer` request
  branch**, via `would`. Both errors were propagated into a Phase 16 executor's brief
  verbatim; following them literally would have renamed the wrong symbol. A note that
  compresses two names into one sentence is how that happens.

- **[Phase 14] A guard wrapped at every construction site, not at one resolution point.**
  The plan opened by correcting its own earlier draft: **three** `Executor` implementations
  independently turn `task.moduleCid` into bytes — `core/src/executor/wasm.ts`,
  `browser/src/worker-executor.ts` and `aot/src/wasi-executor.ts` — so "one resolution
  point" was false and the guarantee `guardModuleProvenance` carries is composition at
  every site instead.
- **[Phase 14] A census that counts call sites cannot tell a composed guard from a
  decorative one.** Deleting `provenance(...)` from `browser-node.ts` turns two tab
  refusals red while `trust-anchors.node.test.ts` stays **20/20**, because
  `guardModuleProvenance(` is still textually present, just applied to nothing. Recorded
  as M28. This is the same shape as the disclosure gate's pattern that matched nothing and
  read green — a text census answers "is it mentioned", never "is it wired".
- **[Phase 14] `trustAnchors` is required and typed `readonly PublicKeyHex[] |
  'runs-unsigned-artifacts'`**, on both `FabricNodeOptions` and `BrowserNodeOptions` —
  Phase 11's sentinel convention. `TabApi` deliberately exposes **no opt-out at all**:
  there is no value a page or a Playwright harness can pass through `window.o2` that
  yields a tab resolving bare CIDs. All 22 uses of the opt-out are inside `*.test.ts`;
  `bin/agent.ts` has no off-switch.
- **[Phase 14] "Built, not wired" has a measurable signature, and it was measured in both
  directions.** Before the phase, emptying both demo trust-anchor sets changed nothing
  across fifteen e2e tests. After it, the same plant takes the colouring job down.
  Recorded as M29 — the one ledger entry that pins a *change* rather than a guard.
- **[Phase 14] A `not.toContain` never observed as a `toContain` is a silence, not a
  reading.** Criterion 2's "before `WebAssembly.instantiate`" rests on two instruments —
  an in-process call counter and a cross-process blockstore-directory census — and the
  verification required each to have been seen taking **both** values. The cross-process
  one is upstream of instantiation: the block never reached the agent's disk.
- **[Phase 14] Corrections do not propagate between sibling plans.** 14-03 corrected six
  wrong `file:line` facts in its own plan; 14-05's plan, written earlier, then restated
  one of those same corrections verbatim. A correction living in a SUMMARY reaches nobody.
  Feed each wave the prior wave's corrections explicitly, and verify every citation before
  relying on it.

- **[Phase 15] Plan citations drift far worse than anyone assumed: 41 wrong `file:line`
  references across four plans** (6, 9, 14, 12). These plans were written weeks before
  they ran. Two were wrong rather than merely stale, and both would have shipped a false
  statement into source: `purity.node.test.ts:167-174` does **not** keep the `Executor`
  port narrow (it is the "no dependency edge from `@o2/core` to any adapter" test, and the
  string `Executor` appears nowhere in it), and **no test in this repository asserts the
  `Executor` port carries no chain**. Assume every citation in an unexecuted plan is stale.
- **[Phase 15] A wave field can lie where `depends_on` cannot.** Phase 15's four plans all
  declared `wave: 1`, which would have launched four agents into a chain where 15-03 needs
  01 and 02 and 15-04 needs all three. Derive waves from `depends_on` and from
  `files_modified` overlap, never from the `wave` field alone — 15-01 and 15-02 also both
  write `packages/net/src/index.ts`.
- **[Phase 15] "It cannot be tested" survived four plans and was false.** Every plan
  repeated that `BrowserNode.start` "needs a real `indexedDB` and a relay to dial, so it
  runs in neither vitest project", and the browser tier's authorizer went unproven because
  of it — a scrambling mutation left 345 browser tests green. The true statement is
  narrower: the **`browser`** project cannot host it, because a Circuit Relay v2 server
  cannot run inside a browser; the **`e2e`** project can, and `two-tabs.e2e.test.ts`
  already did. 15-05 closed it there, and needed no relay at all — a relay exists to let
  two browsers exchange SDP, and there is one browser in that test. **Six shipped comments
  carried the false claim, one of them sitting directly on the authorize hook.**
- **[Phase 15] A refusal that names the wrong thing is a defect even when the job
  correctly fails.** M30's mutated tab still refuses — at a different precedence step,
  naming the owner *key* where the owner *id* belongs. Any assertion of the form "the job
  failed" passes against it. Assert the refusal **text**. The same trap caught 15-03: a
  node with no `sovereignty` option resolves to `ownerId: ''` and falls through to a
  different `unauthorized` refusal naming the same peer.
- **[Phase 16] A fabric cheaper than the real thing cannot observe a gate keyed on the
  real thing's configuration.** `agent.ts` refused every combine on any node holding a
  real `Authorizer`, and both node classes install one — so combine never worked in
  production, from the moment the branch was written. Plan 16-02 could not see it because
  every in-process fabric it tested builds `serveAgent({...SENTINELS})`, and the sentinel
  is exactly what the branch keyed on. **Two plans hit it independently** (16-03 from
  spawned processes, 16-04 from the benchmark) and **neither took the cheap way through**:
  16-03 refused to change an auth path outside its scope, 16-04 refused to pass the
  sentinel to `FabricNode` to make a benchmark row appear. Sibling of the Phase 15 lesson
  and a stronger form of it.
- **[Phase 16] The gate's premise was true when written and one phase later was not.**
  Its comment read *"Every production call site passes the sentinel today, so this is a
  no-op now."* Phase 15 installed real authorizers and falsified it silently. **A comment
  asserting a fact about every call site is a claim with an expiry date**; if it matters,
  a test must hold it, because nothing else will notice when it stops being true.
- **[Phase 16] Routing combine through the `Authorizer` made a security property worse,
  and that was measured rather than argued.** The old refusal had incidentally bounded
  combine fetches to zero on any real node. Removing it widened the residue to every
  node — and `authorizeCapability` admits every combine, because the frame carries no
  sovereignty label and no node exposes an `authorize` option. Owner ruling: bound it at
  the `capacity` hook, because combine partials are outputs of public map tasks and
  therefore public by construction — **there is nothing to authorize; the exposure is CPU
  and transfer, which is a capacity question.** Closed in 16-06.
- **[Phase 16] The read count, not the reason string, is what proves a bound's placement.**
  16-06 planted its cap *below* the fetch loop: both refusal-text assertions stayed green
  while reads went 0 → 2. The reply is byte-identical in both placements. Same shape as
  NET-08 — *a cap applied after a loop has already paid for the allocation it prevents.*
- **[Phase 16] A mutation entry can be caught in substance and still be wrong.** The full
  run found `M2b` catching its defect while its recorded signature says *"four sentinels"*
  where the test says *"three"* — drifted in Phase 15 and unnoticed since. The cheap guard
  checks that `find` still matches; it does not check that `signature` still does.
- **[Phase 15] Naming a defect is not fixing it (owner ruling, 2026-07-31).** Plan 15-04
  amended Phase 15's goal down to the truth — correct — and then proposed accepting
  AUTH-03's requestor half as entry-point-unreachable. Declined. Recording a built-not-wired
  adapter in three places is not the same as wiring it; it went to Phase 23 criterion 5,
  where `bin/bench.ts` is already being rewritten and the most contended file in the
  repository is fought once rather than twice.

### Pending Todos

**Scheduled work carried out of 13.1's and 14's verifications (2026-07-31):**

- **DATA-10's at-rest half — owner-scheduled, not deferred.** A node still serves a raw
  sovereign block once the job that registered it has ended: `submit-with-egress.ts:155`
  takes the registration and a `finally` releases it. Close it at a boundary the node owns
  — a per-node set of sovereign CIDs that outlives the job — rather than at one entry
  point. The second half, that bare `submitJob` registers nothing at all, folds into
  **Phase 20**, where `submitJob` becomes the single job path and the fix lands at one
  boundary instead of two. `sovereignty-placement.node.test.ts` currently drives a real
  spawned-agent sovereign scenario through bare `submitJob` and **passes because the gap
  is real**.
- **Two load-sensitive bounds, same family.** `churn.test.ts`'s 30%-killed case failed once
  at load 17.5-59.4 and passed 3/3 in isolation; `transport-bounds.node.test.ts`'s
  retained-bytes bound failed twice at load ~12.4 and passed at 8.72 and 7.70. Both are
  wall-clock bounds inside otherwise deterministic tests — a bound that reads host
  contention as a defect. Recorded in `phase-14-.../deferred-items.md`.
- **Closed on 2026-07-31, listed so it is not re-found:** the `stopAgent` hookTimeout
  inversion in `two-process`, `sovereignty-placement` and `egress-refusal` — a 10 s
  SIGKILL fallback inside Vitest's 10 s default `hookTimeout`, so the fallback could never
  fire and a wedged agent reported an anonymous timeout naming no step.

**Two open owner decisions**, both deferred with the measurement they were waiting for now
in hand.

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

Last session: 2026-07-31T23:45:00.000Z
Stopped at: Phase 14 executed and verified `passed` 3/3 in one autonomous run; Phase 13.1
verified `gaps_found` 6/7 in the same run. Both verdicts and the ledger edits are on
`develop`. Next unit: **Phase 15 (Capability-Chained Dispatch)**, 4 plans, already planned,
depends only on Phase 11.

**Phases run sequentially from here, and that is a measured constraint rather than a
preference.** Their declared `files_modified` overlap heavily — `fabric-node.ts` in
14/15/17/21, `bin/bench.ts` in 14/15/16/17/23, `browser-node.ts` in 14/15/17/21 — because
"Wire What Was Built" means every phase converges on the same construction sites. Only
verification of one phase overlaps safely with execution of another, and only when their
planning directories differ.

**How Phase 14 was actually run, for whoever picks this up:** five plans, four waves, each
executor in its own `isolation="worktree"` agent, merged back one wave at a time with a
`tsc` + targeted-vitest gate between waves. Two things made it work that are not obvious.
First, **a worktree has no `node_modules`, and symlinking the main checkout's wholesale is
silently wrong** — `node_modules/@o2/*` are relative symlinks back to the *main* checkout,
so `tsc` and `vitest` verify the wrong tree and report clean without reading the agent's
changes. Every executor built a resolver farm and proved it with
`createRequire().resolve()` before editing. Second, **each wave's prompt carried the prior
wave's corrections**, because a correction recorded in a SUMMARY reaches no sibling plan.

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
