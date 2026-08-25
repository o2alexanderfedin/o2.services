---
phase: 18-discovery-capacity-placement
verified: 2026-08-02T23:54:55Z
status: passed
score: >-
  9/9 criteria verified (7/9 on the 2026-08-02 initial pass; 8/9 on 2026-08-03 after plans
  18-12/18-13; criterion 2b MET on 2026-08-04 once WIRE-04 landed and plan 20-04 rewrote the
  absence-instrument into a behaviour — see the second amendment)
verifier: independent pass, goal-backward
re_verification:
  verified: 2026-08-03T02:06:28Z
  previous_status: gaps_found
  previous_score: 7/9
  gaps_closed:
    - "G-1 — criterion 2b's absence-instrument cannot fail (closed: the replacement inverts, proved by planting ledger entry M36)"
    - "G-2 — criterion 3's browser half has no peer-side reading (closed: a Node peer reads the tab's slots 8 → 2 off the wire; divergence proved by M37)"
  gaps_remaining: []
  regressions: []
  new_findings:
    - "F-1 — `admit: rpcAdmission(...)` at `bin/bench.ts:723` is guarded by nothing; deleting it leaves the whole suite green"
    - "F-2 — the four corrected ledger rows cite `fabric-node.ts`/`browser-node.ts` line numbers that 18-13's own later commit shifted by +15/+16"
    - "F-3 — `tools/aot/lift.node.test.ts` re-measured contradicts `deferred-items.md` item 2; out of this phase's scope"

re_verification_2:
  verified: 2026-08-04T19:20:00Z
  previous_status: human_needed
  previous_score: 8/9
  trigger: "WIRE-04 landed in plan 20-01; the armed tripwire fired; plan 20-04 rewrote the case"
  criteria_moved:
    - "2b — PARTIAL → MET. The re-pick exists in `submitJob`s generation loop and is measured
       across real `bin/agent.ts` processes on a shard whose SELECTED executor refused at exec:
       `attempted === [victim, answering]`, `generations === 2`, `redispatches === 1`, and a lease
       trail of granted/surrendered/granted/completed. Falsifiability proved by planting a `break`
       before the re-placement in `job/submit.ts` and watching the file go red with
       `expected 'insufficient' to be 'agreed'` — the exact inverse of the tripwire."
  gaps_remaining: []
  regressions: []
  findings_closed:
    - "F-1 — closed by Phase 19 plan 19-17 (defect #31). The expression is now
       `...(DISCOVER ? { admit: rpcAdmission(requestor.rpc) } : {})` and its guard is
       `bench-reduce.node.test.ts`s call-site requirement, which carries its own planted-absence case."
    - "F-3 — closed by commit 3d6806b. The recorded 60000 ms diagnosis was that file's own
       testTimeout; the real cause was a retry bounded in count and unbounded in time. Bound is now comparative."
    - "F-2 — closed 2026-08-25 by commit 1e7248d, dispositioned here on 2026-08-25 by a second
       /gsd-audit-fix pass. The blocker this entry named — the file is shared and three verifiers
       are active — had lifted. 139 unique `path:line` citations in REQUIREMENTS.md were resolved
       against the tree: 60 repaired, 75 still landing on their subject, 4 deliberately-preserved
       wrong readings given a dated note. The repair is the one ROADMAP.md had already adopted —
       cited by symbol, not by line — so the numbers below were not re-pointed, they were retired
       as a class. Seven rows were reported and NOT edited because repairing the citation would
       have moved a measured claim; those are carried as their own finding, not as this one."
    # F-2's `findings_open` entry, retained verbatim as the record of what was open and why —
    # the closure above is what supersedes it, not a rewrite of it:
    #   - "F-2 — WORSE, not closed. 46 resolvable `file:line` citations in REQUIREMENTS.md; 28 land on a
    #      blank line, a bare delimiter or a comment body, and 5 more on code that is not the construction
    #      the row names (offsets 51/138/226, so no blanket fix). Every underlying claim re-derived TRUE by
    #      symbol. Documentary only. Not edited — the file is shared and three verifiers are active."
  findings_open:
    - "20-04 must-have 2 — `the re-pick does not erase the first executor's named refusal` is
       unreachable while `VerificationResult`s `agreed` arm declares no `failures` field. Phase 20's to settle;
       it does not reduce criterion 2b, which asks for the refusal and the re-pick, not for both in one ShardResult."
# CLOSED 2026-08-03 by plans 18-12/18-13. Retained verbatim as the first pass's record —
# see `re_verification.gaps_closed` and the Amendment for current state.
gaps:
  - criterion: "2b — a node at its execution slot limit refuses an `exec` request with a stated reason naming the limit, and the requestor re-picks"
    status: failed
    reason: >-
      The refusal half is closed and measured. The re-pick half is absent, as the owner
      ruling anticipated — but the instrument that was supposed to hold the absence
      cannot fail. RULING A states the clause "turns red the day WIRE-04 lands"; it
      would not.
    artifacts:
      - path: "packages/node/src/discovery-agents.node.test.ts:554-558"
        issue: >-
          The declared absence-assertion is `expect(shard.verification.agreeing)
          .toHaveLength(1)`. `agreeing` is a subset of the executors handed to
          `executeVerified`, and that list is `placement.nodeIds`, whose length is
          `redundancy` — 1 in this fixture. The value is therefore structurally
          confined to {0,1} and cannot record a second attempt no matter what
          WIRE-04 adds.
      - path: "packages/node/src/discovery-agents.node.test.ts:542-555"
        issue: >-
          The companion assertion `expect(direct.ok).toBe(false)` is taken on a bare
          `new RemoteExecutor(...).execute(...)` call made outside `submitJob`. A retry
          added inside `submitJob`/`runResilient` cannot affect it, so it too stays
          green after WIRE-04.
      - path: "packages/core/src/job/submit.ts:390"
        issue: >-
          `executeVerified(task, selectedExecutors)` is called once per shard with no
          retry and no resample; exec-stage refusals are never surfaced —
          `shardRejections` is populated from the placement stage only (line 339).
    missing:
      - >-
        An instrument that can distinguish "the requestor did not re-pick after an exec
        refusal" from "there was nothing to re-pick". The reading has to be taken on a
        shard whose *selected* node refuses at exec — e.g. place a shard on a node that
        saturates between the offer answer and the dispatch — and assert the shard ends
        `insufficient` with the refusal in `failures`, so the assertion inverts when a
        retry lands.
  - criterion: "3 — a user-set CPU duty-cycle cap set at runtime, Node tier and browser tier alike, drops the node's advertised capacity, observable in what the requestor is offered next"
    status: partial
    reason: >-
      The Node tier closes both halves. The browser tier closes "set at runtime" and
      "honoured by the executor" but not "observable in what the requestor is offered
      next" — no peer ever reads the tab's slot count off the wire. Plan 18-09's own
      title asks for exactly that reading, and ROADMAP RULING B made it the condition on
      which the two tiers are equal: "18-09 is required to prove the browser tier's cap
      is read by a *peer*, off a live tab, so the equality is measured rather than
      asserted."
    artifacts:
      - path: "packages/node/src/duty-cycle-tab.e2e.test.ts:22-36"
        issue: >-
          The file states the gap itself — "A peer reading the tab's slot count off the
          wire. Plan 18-09 asks for that, and it is not here."
      - path: ".planning/phases/phase-18-discovery-capacity-placement/18-09-SUMMARY.md:137-146"
        issue: >-
          Records the same absence and argues the mechanism is the identical class on
          both tiers. That is an argument from construction, which is what RULING B
          declined to accept.
    missing:
      - >-
        A Node-tier `FabricNode` dialling a live tab and reading `{kind:'offer'}`
        capacity before and after `window.o2.setDutyCycle(...)`, mirroring
        `duty-cycle.node.test.ts:87-104`. Blocked on browser-to-Node-peer transport in
        the `e2e` project, which today is tab-to-tab only.
# RESOLVED 2026-08-04: criterion 2b is MET, so the escalation below dissolved rather than
# being decided. Retained verbatim as the 2026-08-03 record — see the second Amendment.
human_verification:
  - test: >-
      Owner decision, not a test: Phase 18 has no remaining actionable work, and criterion
      2b stands at PARTIAL by design. ROADMAP RULING A accepts that PARTIAL in advance and
      in the same breath forbids the phase closing on it — "the phase is NOT allowed to
      close on it", citing the Phase 17 precedent where the phase "stayed uncounted at
      1/3". A verifier cannot resolve that on its own authority.
    expected: >-
      Either the phase is marked complete at 8/9 with criterion 2b carried to Phase 20
      criterion 1 (WIRE-04), or it stays open until WIRE-04 lands. Both are consistent
      with the evidence; only the owner can choose.
    why_human: >-
      RULING A is an owner ruling. Every automated reading this phase admits of has been
      taken and passes; what is left is a scheduling judgement about phase closure.
# ARRIVED 2026-08-04: WIRE-04 landed in plan 20-01 and the clause below is now measured in
# this phase too. Retained verbatim as the record of what was deferred and why.
deferred:
  - item: "The exec-stage re-pick itself (criterion 2b clause 2)"
    addressed_in: "Phase 20 criterion 1 (WIRE-04)"
    evidence: >-
      ROADMAP RULING A: "The re-pick half needs WIRE-04 ... WIRE-04 is Phase 20
      criterion 1, so the work is already scheduled." Only the *instrument* is a
      Phase 18 gap; the behaviour is correctly scheduled.
---

# Phase 18: Discovery, Capacity & Placement — Verification Report

**Phase Goal:** A requestor with no static peer list finds candidates by querying real content-CID providers, samples and selects by load, and an over-committed node refuses work with a stated reason — on a real job, not a hand-built fabric

**Verified:** 2026-08-02T23:54:55Z
**Status:** gaps_found
**Score:** 7/9 criteria
**Re-verification:** No — initial verification (this phase had no VERIFICATION.md; it was the only executed phase in the repository missing one)

Score is over **criteria**, not requirements, per `.planning/STATE.md`: a requirement may outlive the phase that opened it; a criterion may not.

## Goal Achievement

### Observable Truths

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Job finds candidates from real content-CID providers ∩ capability records, not a hardcoded list, and dispatches | VERIFIED | `discovery-agents.node.test.ts` — 5 dialled, 3 qualified, 1 excluded by name, 1 never seen; job completes on the discovered set only. Entry point executed by this verifier. |
| 2 | Placement samples multiple candidates, selects least-loaded; over-capacity node refuses with a stated reason visible in the re-pick; job completes | VERIFIED | Genuinely saturated node, refusal in the node's own words over a real wire, saturation re-read *after* placement. |
| 2b | Node at its execution slot limit refuses an `exec` request naming the limit, **and the requestor re-picks** | FAILED | Refusal half closed. Re-pick half absent (expected), but the declared absence-instrument is vacuous — see Gap G-1. |
| 2c | N shards through `planWithOffers` + `rpcAdmission` do not over-commit a node past its declared limit | VERIFIED | The previously-pinned over-commit case was inverted to assert the bound, with a negative control. |
| 2d | `bin/agent.ts` gains a flag making a spawned agent dial a named peer; the spawned node verifies that peer's certificate and **accepts** it | VERIFIED | Acceptance measured behaviourally across processes with the provider stopped, plus two controls. |
| 3 | Runtime duty-cycle cap — Node **and browser** tier — honoured immediately, advertised capacity drops, observable in what the requestor is offered next | PARTIAL | Node tier: both halves. Browser tier: cap settable and honoured, but no peer reads the tab's slot count off the wire — see Gap G-2. |
| 4 | Relay via `bin/seed.ts` at reservation capacity reports exhaustion **by name** to a joining node, not indistinguishably from an outage | VERIFIED | Three readings across one real seed and three real agents; refusal separated from outage within one run. |
| 5 | Under load pressure, a sovereignty-pinned task lands on its owner though a lower-cost non-owner is available — cost filtered *after* the sovereignty constraint | VERIFIED | Cross-process plus kernel, with a "can never widen" property and a stalling negative control. |
| 6 | A node that enrols *after* a peer connected is taken by that peer **without either side reconnecting** | VERIFIED | Same peer, same connection, same verifier; retryable/final split with bounded re-ask. |

**Score: 7/9 criteria verified.**

### Criterion-by-criterion findings

#### Criterion 1 — VERIFIED (with a recorded entry-point substitution)

`packages/net/src/discover-candidates.ts:147-189` turns a data CID plus a peer thunk into `RemoteExecutor`s and `NodeDescriptor`s, correlated by the id the transport knows. No address list is supplied to it beyond the peers already connected.

`packages/node/src/discovery-agents.node.test.ts` proves the behaviour across **seven spawned processes**. The fixture is separable rather than convenient: A/B/C hold the block and are enrolled under the pinned provider; D is enrolled and holds nothing; E holds the block but is enrolled under a provider the requestor did **not** pin.

- Two readings are taken, over the connected set and over the verified set (lines 346-382). The first yields `providers: 4`, three executors, and exactly one exclusion — `invalid-certificate`, naming E's node key. The second yields `providers: 3` and an empty exclusion list. The file states why both are needed: a file using only the verified thunk would leave `invalid-certificate` unreachable and would report an intersection it never exercised.
- D appears in **neither** list, and both halves are asserted (lines 361-362) — "not in executors" alone would also be true of E.
- The job then completes, and every agreeing node is checked for membership in the discovered set (lines 404-411), with `discovered` derived from the result rather than restated.

**Entry-point substitution, recorded not waived.** The criterion says "submitted through `bin/agent.ts`". That binary is a server: I read all 688 lines and it has no job-submission path. The submitter here is an in-process `FabricNode`; the *executors* are real `bin/agent.ts` processes. The runnable entry point that calls `discoverCandidates` is `bin/bench.ts --discover` (`packages/node/src/bin/bench.ts:680`). This substitution was made **at planning time and written into the ROADMAP** (`.planning/ROADMAP.md:592`, plan 18-06's own line), not invented during execution, which is why it is recorded as Info rather than scored against the phase.

**Independently executed.** `serve-agent-hooks.node.test.ts:325-350` is candid that no automated test runs the `--discover` arm — it asserts source text only (`occurrences(BENCH, 'await discoverCandidates(') === 1`) because invoking the driver would overwrite `.planning/BENCHMARK-RESULTS.md`, and it records a hand-run in a summary instead. Per the instruction not to trust summaries, I ran it myself with `cwd` set to a temporary directory:

```
env -C "$TD" node --experimental-strip-types .../bin/bench.ts --quick --discover
```
```
--discover: 1 of 1 workers qualified from 1 providers
--discover: 2 of 2 workers qualified from 2 providers
```

The branch really executes and really reaches `discoverCandidates`. Note this remains **unmeasured by any automated test** — see Anti-Patterns W-1.

#### Criterion 2 — VERIFIED

`packages/node/src/discovery-agents.node.test.ts:417-561`. Three properties make this a reading rather than a hope:

1. **The probed node is derived, not guessed.** `sampleCandidates('0', found.nodes, DEFAULT_D)` is called from the library and the least-loaded tie-break re-applied (lines 441-443), so the fixture cannot silently diverge from the rule it is testing.
2. **Saturation is real and declared.** The slot is occupied by a genuine long-running `exec` (`MODULE_NEVER_RETURNS`) dispatched over the wire, not by reaching into an in-process object. The precondition is polled until the node reports itself full — `{slots: 1, inFlight: 1}` (line 477).
3. **The precondition is re-read *after* placement** (lines 515-517). Without this the whole block could pass while measuring nothing, if the held task's deadline expired mid-placement. This is the single strongest anti-vacuity guard I found in the phase.

The refusal arrives as the node's own words — `over-committed: 1 of 1 slots in use` — and the job completes on a node that did not refuse.

#### Criterion 2b — FAILED (refusal closed; absence-instrument vacuous)

**The refusal half is genuinely closed.** `packages/net/src/agent.ts` admits on the `exec` branch, and the spawned-agent reading is in `peer-dial.node.test.ts:515` ("refuses a concurrent dispatch with its own words when spawned with `--max-concurrent-tasks 1`, while an agent without the flag answers both") — which carries its own negative control.

**The re-pick half is absent, as ruled.** `packages/core/src/job/submit.ts:390` calls `executeVerified(task, selectedExecutors)` once per shard. No retry, no resample.

**The instrument that was supposed to hold that absence cannot fail.** RULING A commits the phase to a measurement: "a direct dispatch refused, and no shard recording a second attempt — so the clause turns red the day WIRE-04 lands instead of surviving as a sentence in a summary." Examined:

- `expect(shard.verification.agreeing).toHaveLength(1)` (line 558). `agreeing` is `answered.map(r => r.nodeId)` over the receipts of `selectedExecutors` (`packages/core/src/job/verify.ts:123,158`), and `selectedExecutors` is `placement.nodeIds`, whose length is `redundancy` — **1** in this fixture. So the value can only ever be 0 or 1. It cannot record a second attempt under any implementation of WIRE-04.
- Compounding it, the shard in question **succeeded on its first executor** (the offer arm had already re-picked past the busy node), so no retry path would engage even if the counter could move.
- `expect(direct.ok).toBe(false)` (line 554) is taken on a bare `new RemoteExecutor(...).execute(...)` made *outside* `submitJob`. A retry added inside `submitJob` or `runResilient` cannot reach it, so it stays green after WIRE-04 too.
- Exec-stage refusals are additionally invisible in the result: `shardRejections` is populated from the placement stage alone (`submit.ts:339`).

So the assertion measures the refusal — which is clause 1, already closed elsewhere — and nothing about clause 2. Per the verification instruction, an absence-assertion that would pass vacuously is worth nothing: **FAILED**, not PARTIAL. The phase was already barred from closing on this criterion; what changes is that the tripwire scheduled to fire in Phase 20 will not fire.

#### Criterion 2c — VERIFIED

`packages/core/src/placement.ts:322-390` — `planWithOffers` keeps a `headroom` map across shards, seeded from each node's published `{slots, inFlight}` and decremented on acceptance. Absent from the map means unbounded rather than zero, which is the honest default (a requestor must not bound a node on a figure it invented).

`packages/net/src/discovery.test.ts:366-429` is the case the ROADMAP said would turn red, and it did: it now asserts one shard placed and three held back, each held shard carrying `probed: 0` and `rejections: []` — the read count, not the reason string, is what distinguishes a requestor that held back from one that asked and was refused. `worker.capacity.peakInFlight` is asserted `0`. The negative control at line 433 ("places four shards across four 1-slot workers, one each") prevents the bound from being indistinguishable from a placer that stopped working.

The bound is documented as **advisory** in both the source and the test — nothing is reserved by answering, and the authoritative bound remains the `exec` branch's SCHED-06 admission. The criterion asks that placement not over-commit, which is what is delivered; the documentation does not overclaim.

#### Criterion 2d — VERIFIED

`bin/agent.ts:216` adds `--peer-addr` (repeatable); lines 511-529 dial after `start` resolves and before the handshake line, so a parent reading the line is reading a completed peering. Peer ids are read off the `Connection` rather than parsed from the configured string.

`peer-dial.node.test.ts:338` measures acceptance **behaviourally** rather than by reading a verdict, and the file argues why (lines 44-52): a verdict does not cross a process boundary, so acceptance is read through its one production consumer — a block fetch that only a verified peer can serve. The provider is stopped and asserted dead first, so "the authority was still answering" is unavailable as an explanation. Two controls accompany it in the same test: the identical dispatch is refused when another issuer is pinned, and succeeds when nobody is pinned.

#### Criterion 3 — PARTIAL

**Node tier: closed, both halves.** `fabric-node.ts:1153` constructs the `DutyCycleGovernor`, `:1460` composes `new GovernedExecutor(counter, governor)`, `:1181` passes `dutyCycle: governor` into `LocalCapacity` so the slot count derives live, and `:985` exposes `setDutyCycle`. `bin/agent.ts:263` adds `--duty-cycle` and `:665-688` re-reads `<dir>/.duty-cycle` on `SIGHUP`, with every failure named and none fatal. `duty-cycle.node.test.ts:78` takes the criterion's own observable: a peer probes `{kind:'offer'}` over tcp + noise + yamux and reads `{slots: 8, inFlight: 0}` before and `{slots: 2, inFlight: 0}` after `setDutyCycle(0.25)`.

**Browser tier: the wire reading is missing.** `duty-cycle-tab.e2e.test.ts` is a real test — Chromium via Playwright, a vite dev server, a real relay `FabricNode` — and 5 tests pass. It proves the cap is settable on a live tab, that a preset cap reaches the governor, that a cap outside `(0, 1]` is refused without partial effect, and that the user cap and the visibility governor compose taking the lower from **both** sides. It even guards the one composition error that would leave every other assertion green (`activity().dutyCycle`, lines 124-138).

What it does not do is have a **peer** read the tab's advertised slot count. The file says so (lines 22-36) and so does `18-09-SUMMARY.md:137-146`; both argue the mechanism is the identical class on both tiers. That argument is precisely what RULING B declined to accept in advance: *"18-09 is required to prove the browser tier's cap is read by a peer, off a live tab, so the equality is measured rather than asserted."* Plan 18-09's own ROADMAP line names the deliverable as "the same cap governor over `VisibilityGovernor`, **read by a peer off a live tab**".

Criterion 3's second clause — "the node's advertised capacity to `discoverExecutors` drops accordingly, observable in what the requestor is offered next" — is therefore unmeasured on one of the two tiers the criterion names. *Unmeasured is not met.* PARTIAL.

The honesty here is worth recording: this gap was declared in the test header and the summary rather than discovered by this pass. The scoring rule is what differs, not the facts.

#### Criterion 4 — VERIFIED

`reservation-exhaustion.node.test.ts:173` takes three readings across one real `bin/seed.ts` and three real `bin/agent.ts` processes:

| joiner | relay state | reading |
|---|---|---|
| A | one slot free | a granted circuit (`/p2p-circuit` in `relays`) |
| B | full | `relay reservation at-capacity: RESERVATION_REFUSED`, and **not** `unreachable` |
| C | address not listening | `relay ... unreachable:`, and **not** `at-capacity` |

B is the deliverable and the separation is measured rather than argued: B's dial to the seed succeeds in the same run in which its reservation is refused, through the very address that granted A moments earlier. So "named refusal" and "network outage" are shown to be two readings, not two names for silence. B and C both start anyway (`exitCode` null), which is NET-05's stated position.

The relay multiaddr is read off the seed's own banner rather than rebuilt by the test, and `capacity   1 reservations` is asserted in the banner — so the criterion's configuration is reachable without reading source.

#### Criterion 5 — VERIFIED

`sovereignty-placement.node.test.ts:367` — "SCHED-05 — sovereignty survives the offer loop, across real processes" — places a sovereign shard on its owner *when placement asks every candidate first*, which is the ordering the criterion is about: cost is filtered after the sovereignty constraint, not scored against it. Its companion at :398 ("stalls rather than relocating when the owner's only node refuses") is the control that makes the first reading mean something — a placer that ignored sovereignty would relocate rather than stall.

`packages/core/src/sovereign-offers.test.ts` holds the kernel property in five cases, including "a refusal shrinks the sovereign pool and can never widen it", a positive control proving the unplaceable case is a refusal rather than a broken fixture, a degraded-rather-than-widened case, and a shard with no owner. `placement.ts:387-389` states the structural reason: narrowing happens before the sovereignty gate inside `placeWithOffers`, so no amount of headroom accounting can widen a sovereign shard's candidates.

#### Criterion 6 — VERIFIED

`packages/node/src/peer-verifier.ts` — a verdict is no longer permanent for the life of a connection. `FINAL` (:157-162) holds the four refusals that cannot change; `expired` and `not-yet-valid` are deliberately excluded because both are statements about a clock. `#refresh` (:352-368) re-asks on a read of `verifiedPeers`, under three guards: a settled acceptance is never re-asked, a `FINAL` refusal is never re-asked, and nothing is re-asked inside the retry floor.

`peer-verifier.node.test.ts:662` is the criterion: the same peer answers differently over time, and the assertion is explicitly "same peer, same connection, same verifier" — which is the "without either side reconnecting" clause. Two bound tests accompany it (:703 `FINAL` never re-asked over 20 reads; :734 the floor holds a retryable refusal), so the fix does not trade a permanent exclusion for an unbounded request rate. Each carries a stated reddening procedure.

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|----|----|--------|----------|
| `bin/bench.ts --discover` | `discoverCandidates` | `await discoverCandidates(` | WIRED | `bin/bench.ts:680`; executed by this verifier, printed real qualification counts |
| `bin/bench.ts --discover` | `planWithOffers` | `admit: rpcAdmission(requestor.rpc)` → `spec.admit` | WIRED | `bin/bench.ts:723` → `submit.ts:340` |
| `submitJob` | `planWithOffers` | `spec.admit !== undefined` branch | WIRED | `submit.ts:340` |
| `planWithOffers` | cross-shard bound | `headroom` map | WIRED | `placement.ts:333-390` |
| `bin/agent.ts` | `ReservationWatcher` | `new ReservationWatcher()` | WIRED | `agent.ts:454`, first production construction |
| `bin/agent.ts` | `FabricNode.setDutyCycle` | `SIGHUP` → control file | WIRED | `agent.ts:665-688` |
| `FabricNode` | `GovernedExecutor` | `new GovernedExecutor(counter, governor)` | WIRED | `fabric-node.ts:1460` |
| `LocalCapacity` | live governor | `dutyCycle: governor` | WIRED | `fabric-node.ts:1181`, `browser-node.ts:991` |
| `BrowserNode` | peer-read slot count | offer frame from a Node peer | **NOT WIRED** | No such path exists in `e2e`; Gap G-2 |
| `submitJob` | exec-stage re-pick | retry after refusal | **NOT WIRED** | `submit.ts:390`; scheduled as WIRE-04 |

### Data-Flow Trace

| Artifact | Data | Source | Real data flows | Status |
|---|---|---|---|---|
| `discoverCandidates` | executors, descriptors | `discoverExecutors` over `RpcRecordIndex` | Yes — `providers: 4 → 3` differs by thunk; counts observed in a live run | FLOWING |
| `planWithOffers` | headroom | node-published `{slots, inFlight}` | Yes — `peakInFlight: 0` on the bounded worker | FLOWING |
| `FabricNode.dutyCycle` | cap | `#governor.dutyCycle`, read through | Yes — `slots 8 → 2` read by a peer over the wire | FLOWING |
| `BrowserNode` capacity | cap | cap governor over `VisibilityGovernor` | In-page only; never read by a peer | **PARTIAL** |
| `FabricNode.relayFailures` | dial failures | `catch` in the relay dial loop | Yes — surfaced on agent stderr and asserted cross-process | FLOWING |

### Commands Run (real output)

Load was checked before each timing-sensitive run. Ambient load was from OneDrive (63.7% CPU), not a competing suite. `EXIT` captured on the line immediately following each command, never after a pipe or `echo`.

| Command | Result | Exit |
|---|---|---|
| `npx vitest run --project node .../discovery-agents.node.test.ts` | `Test Files 1 passed (1)` / `Tests 2 passed (2)`, 16.75 s, load 9.27 | 0 |
| `npx vitest run --project node reservation-exhaustion + peer-dial + duty-cycle + sovereignty-placement` | `Test Files 4 passed (4)` / `Tests 16 passed (16)`, 13.53 s, load 5.07 | 0 |
| `npx vitest run --project node peer-verifier + net/discovery + placement + sovereign-offers + discover-candidates + admission + governor + core/discovery` | `Test Files 8 passed (8)` / `Tests 139 passed (139)`, 8.18 s | 0 |
| `npx vitest run --project e2e .../duty-cycle-tab.e2e.test.ts` | `Test Files 1 passed (1)` / `Tests 5 passed (5)`, 3.52 s | 0 |
| `npx vitest run --project node requirements-ledger + acceptance-traceability + vocabulary + slow-specs + mutation-guard` | `Test Files 5 passed (5)` / `Tests 159 passed (159)` | 0 |
| `bench.ts --quick --discover` in a temp `cwd` | `--discover: 1 of 1 workers qualified from 1 providers`; `2 of 2 ... from 2 providers` | (long-running; discover arm confirmed executing) |

All runs used `--project`; no bare-path invocation was made.

## Requirements Coverage

Verified against a **production call path**, not against a test.

| Requirement | Ledger says | Verified | Production path |
|---|---|---|---|
| SCHED-01 | `[x]` Done | SATISFIED | `discoverCandidates` ← `bin/bench.ts:680`. Entry point executed by this verifier. |
| SCHED-02 | `[x]` Done | SATISFIED | `planWithOffers` ← `submit.ts:340` ← `spec.admit` ← `bin/bench.ts:723`. Not test-only. |
| SCHED-03 | `[ ]` / row 616 "Partial" | PARTIAL — **row stale** | Refusal wired (`capacity: admission`, both factories). Re-pick: offer-stage yes, exec-stage no. Row's claim that `planWithOffers` has no production caller is now false. |
| SCHED-04 | `[ ]` / row 617 "Partial" | SATISFIED on Node, PARTIAL on browser — **row stale** | Row says "FabricNode composes a WorkerExecutor and no governor, and the duty cycle is readonly on both tiers". Contradicted by `fabric-node.ts:1460`, `:985`, `:1181`. |
| SCHED-05 | `[ ]` / row 618 "Built, not wired" | SATISFIED — **row stale** | Row says the gate is "reachable only through `runResilient`". It is now reachable via `submitJob` → `planWithOffers` → `placeWithOffers`. |
| NET-05 | `[x]` Done | SATISFIED | `ReservationWatcher` ← `bin/agent.ts:454`; seed prints a dialable relay address. |

**No orphaned requirements** — every ID mapped to Phase 18 in REQUIREMENTS.md is claimed by a plan.

**Three ledger rows are stale** (SCHED-03, SCHED-04, SCHED-05). All three describe the pre-18-06/07/08/09/10 tree and were not revisited when those plans landed, although 18-06 and 18-11 did edit REQUIREMENTS.md. This is the same "moving frontier" failure the repository already recognises.

`requirements-ledger.node.test.ts` exists precisely to catch this and does not, for a documented reason: its claim-extraction binds only to **exported symbols**, and these rows phrase their claims around concepts ("the sovereignty gate") or pronouns ("neither has a production caller"). `SCHED-05` is already a pinned member of `WITHOUT_A_CHECKABLE_CLAIM` (line 279). SCHED-03's "neither" and SCHED-04's prose are outside the guard's reach and are **not** pinned, so the blind spot is silent rather than declared for those two.

## Anti-Patterns Found

| ID | File | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | 16 production files touched by this phase | `TBD` / `FIXME` / `XXX` | — | **None found.** Zero debt markers. |
| — | same | `TODO` / `HACK` / `PLACEHOLDER` / "not yet implemented" | — | **None found.** |
| W-1 | `packages/node/src/bin/bench.ts` `--discover` arm | Branch reachable from a runnable entry point but executed by no automated test; held by a source-text count only | Warning | A regression in the arm would be caught by nothing in CI. The file's own comment states the cause (writing `.planning/BENCHMARK-RESULTS.md` at `cwd`) and the fix (run with `cwd` in a temp directory) — which I confirmed works. |
| W-2 | `packages/browser/src/browser-node.ts:794-796` | Relay dial is a bare `await libp2p.dial(...)` with no `catch`, diverging from `fabric-node.ts:1209-1216` | Warning (accepted) | `FabricNode.start`'s contract changed to non-fatal; `BrowserNode.start` did not inherit it. **This is deliberate and defensible** — a tab cannot bind a listening socket, so a tab with no reservation is unreachable, whereas an agent binds a real port and stays useful. It **is** measured, and measured as the opposite disposition (`start-unwind.browser.test.ts:209-225`, all three engines). The gap is documentary: `fabric-node.ts:1195-1206` says "the disposition now matches the one the flag doc states" without recording that the two tiers now differ. |
| I-1 | `.planning/ROADMAP.md:584` | "**Plans:** 3/11 plans executed"; 18-04…18-11 unchecked | Info | Stale — all eleven have summaries. Reported, not edited. |
| I-2 | `.planning/STATE.md:113-125` (`## Current Position`) | Prose says "Phase: 17"; frontmatter is correct | Info | Stale prose. **Not edited** — this file is hand-maintained and three tools have corrupted it. |
| I-3 | `deferred-items.md` items 1 and 2 | `SLOW_NODE_SPECS` stale; `lift.node.test.ts` fails under full-suite load | Info | Pre-existing, out of scope, reasoning still holds — see below. |

**Anti-patterns: 2 warnings, 3 info, 0 blockers.**

### Contested item review

The three items flagged for scrutiny, examined rather than rubber-stamped:

1. **Criterion 2b's absence-assertion** — examined and found **vacuous**. `agreeing` cannot exceed `redundancy` (1), and the `direct` probe sits outside `submitJob`. Scored FAILED per instruction. This is the most consequential finding in the pass: RULING A's tripwire will not fire.
2. **The non-fatal relay dial taken outside 18-11's declared `files_modified`** — (a) it **is** tested, and better than by a unit test: `reservation-exhaustion.node.test.ts` case C drives it cross-process through `bin/agent.ts` and reads `relay ... unreachable:` off stderr with `exitCode` null. My first pass wrongly concluded it was untested because `relayFailures` has no direct test reference; the behaviour is measured through the binary's output instead. (b) The browser tier does **not** inherit it, and that **is** measured as the opposite disposition. Recorded as W-2, a documentation gap rather than a behavioural one.
3. **SCHED-01…05 / NET-05 against production call paths** — SCHED-01, SCHED-02 and NET-05 each have a real production caller, and I executed the SCHED-01/02 entry point rather than trusting the recorded hand-run. SCHED-03, SCHED-04 and SCHED-05 rows are stale in the direction of **under-reporting** shipped work. No requirement claimed by this phase is reachable only from a `.test.ts`.

### Deferred items — reasoning confirmed, not re-litigated

Both entries in `deferred-items.md` still hold:

1. **`SLOW_NODE_SPECS` stale.** The list's own criterion is a 1 s per-file span; the config's `MEASURED_NODE_SPANS` was re-derived on a quiet host this session (127 files, 210.5 s wall clock, load peak 14.1) and `slow-specs.node.test.ts` derives the exclusion list from that table rather than beside it — I ran it and it passes. Adding one file by hand would make the list look freshly maintained without making it more honest. Out of scope; Info.
2. **`tools/aot/lift.node.test.ts` under full-suite load.** Nothing in this phase is reachable from `tools/aot`. The recorded diagnosis — a contended docker and an absent docker read identically — is a `tools/aot` probe change no Phase 18 plan owns. Out of scope; Info.

## Human Verification Required

None. Every criterion was checkable programmatically, and the browser tier was exercised in a real Chromium rather than deferred to a human.

## Gaps Summary

### Critical Gaps (block phase closure)

**G-1 — Criterion 2b's absence-instrument cannot fail.**
- Missing: an assertion that inverts when an exec-stage re-pick is added.
- Impact: RULING A accepted PARTIAL *on the condition* that the absence was held as a measurement so the clause "turns red the day WIRE-04 lands". It would not. The phase would hand Phase 20 a tripwire that has already been disarmed, and the gap would revert to being a sentence in a summary — the exact outcome the ruling was written to prevent.
- Fix: take the reading on a shard whose *selected* node refuses at exec — saturate the node between the offer answer and the dispatch — and assert the shard ends `insufficient` with the refusal in `verification.failures`. That assertion inverts the moment a retry is introduced. A shard whose first executor succeeds can never carry this reading.
- Note: the *behaviour* stays correctly scheduled as WIRE-04 / Phase 20 criterion 1. Only the instrument is a Phase 18 gap.

**G-2 — Criterion 3's browser half has no peer-side reading.**
- Missing: a Node-tier `FabricNode` dialling a live tab and reading `{kind:'offer'}` capacity across a `setDutyCycle` call.
- Impact: criterion 3 names both tiers and asks for an effect "observable in what the requestor is offered next". On the browser tier that observable is argued from shared construction, not measured — which RULING B explicitly declined in advance, and which plan 18-09's own title asked for.
- Fix: extend `duty-cycle-tab.e2e.test.ts` with a Node peer that dials the tab and probes `offer` before and after the cap change, mirroring `duty-cycle.node.test.ts:87-104`. The blocker is transport: every browser-peer path in `e2e` today is tab-to-tab. `browser-capability.e2e.test.ts` already starts a Node factory against a live tab and is the closest existing shape.

### Non-Critical Gaps

**W-1 — the `--discover` arm is uncovered by CI.** Recommend a test that runs the driver with `cwd` set to a temporary directory; I confirmed this works and produces real qualification counts without touching the committed measurements.

**W-2 — the two tiers' `start` contracts now differ on relay-dial failure, and only one side says so.** Recommend one sentence in `fabric-node.ts`'s relay-dial comment and one in `browser-node.ts`'s, each naming the other tier and the platform reason. No behaviour change — the browser disposition is correct.

**Stale documents (I-1, I-2, and three ledger rows).** Recommend: correct `ROADMAP.md:584` to 11/11 and tick 18-04…18-11; refresh the SCHED-03/04/05 rows against the tree; consider pinning SCHED-03 and SCHED-04 into `WITHOUT_A_CHECKABLE_CLAIM` (or rephrasing them around exported symbols) so the ledger guard's blind spot is declared rather than silent. `STATE.md` prose is left to its hand-maintainer.

## Recommended Fix Plans

### 18-12-PLAN.md: The two instruments this phase is missing

**Objective:** Make criterion 2b's absence falsifiable and give criterion 3's browser half its peer-side reading.

**Tasks:**
1. Rework the criterion-2b absence-assertion in `discovery-agents.node.test.ts` so it is taken on a shard whose selected executor refuses at exec, asserting `insufficient` plus the refusal in `verification.failures`. Verify it inverts by planting a retry locally.
2. Add a Node-tier peer to `duty-cycle-tab.e2e.test.ts` that dials the live tab and reads `{kind:'offer'}` capacity before and after `setDutyCycle(0.25)`.
3. Re-verify criteria 2b and 3.

**Estimated scope:** Medium — task 2 breaks browser-to-Node-peer transport ground in `e2e`.

---

### 18-13-PLAN.md: The documents that no longer match the tree

**Objective:** Close the stale-artifact findings without touching behaviour.

**Tasks:**
1. Refresh SCHED-03, SCHED-04 and SCHED-05 in `REQUIREMENTS.md` against the shipped tree; pin or rephrase the two whose claims the ledger guard cannot bind.
2. Correct `ROADMAP.md:584` to 11/11 and tick 18-04…18-11; add the tier-divergence sentence to both relay-dial comments.
3. Add a `--discover` arm test running the driver with `cwd` in a temporary directory.

**Estimated scope:** Small.

---

## Verification Metadata

**Approach:** Goal-backward from the nine ROADMAP success criteria, adversarial stance
**Must-haves source:** `.planning/ROADMAP.md:493-637` (criteria are the contract; PLAN frontmatter may add, never subtract)
**Test files executed:** 19 across `node` and `e2e` projects — 321 tests, all passing
**Entry points executed:** `bin/bench.ts --quick --discover` (temp `cwd`), plus `bin/agent.ts` and `bin/seed.ts` indirectly through spawned-process tests
**Automated checks:** 7 criteria verified, 1 failed, 1 partial
**Human checks required:** 0
**Working tree:** left clean; nothing committed, nothing reverted, no branch switched

---
*Verified: 2026-08-02T23:54:55Z*
*Verifier: Claude (gsd-verifier), independent pass*

---

## Amendment — 2026-08-03: both gaps closed, and this verification's verdict changes

**Status: `gaps_found` → `human_needed`. Score: 7/9 → 8/9.** Everything above is the record
of the 2026-08-02 initial pass and is left standing. Nothing in it is retracted: G-1 and G-2
were real when they were written, and the two gap-closure plans closed them. What changes is
criterion 3 (PARTIAL → **MET**), criterion 2b (FAILED → **PARTIAL**), and W-1 (closed).

Criterion text in `.planning/ROADMAP.md` was **not** amended — re-read at `:493-637` and
compared against what the first pass verified against. Both criteria are word-for-word the
same. This amendment scores against the same contract.

### Re-verified criteria

| # | 2026-08-02 | 2026-08-03 | Why it moved |
|---|---|---|---|
| 2b | FAILED | **PARTIAL** | The instrument gap is closed. Clause 2 is still absent, correctly — it is WIRE-04 / Phase 20 criterion 1's. |
| 3 | PARTIAL | **MET** | A Node peer now reads a live tab's advertised slot count off the wire, before and after one `setDutyCycle` call. |
| 1, 2, 2c, 2d, 4, 5, 6 | VERIFIED | **VERIFIED** | Re-run, no regression. Detail below. |

**Score: 8/9 criteria.** Criterion 2b is the one that is not met, and by RULING A it may not
be closed here.

### Verified myself, not taken from the summaries

Four claims were checked against the tree and the running suite rather than read.

#### 1. The old criterion-2b assertion was a tautology, not merely weak — CONFIRMED

`executeVerified` (`packages/core/src/job/verify.ts:115-161`) returns `status: 'agreed'`
only after `answered.length === 0` has already returned `insufficient`, and it sets
`agreeing: answered.map(...)` where `answered ⊆ receipts` and `receipts.length ===
executors.length`. In that fixture `executors` is `placement.nodeIds`, whose length is
`redundancy` — 1. So on the `'agreed'` branch `agreeing.length` is **exactly 1**, and the
`if (shard.verification.status !== 'agreed') return` three lines above
(`88ab88f:discovery-agents.node.test.ts:507`) had already excluded the only other value the
type admits. `expect(shard.verification.agreeing).toHaveLength(1)` could not be false.
18-12's sharper reading is right: not "weak", **vacuous by construction**.

#### 2. The replacement genuinely inverts — CONFIRMED BY PLANTING, not by reading

Ran the ledger arm myself:

```
npm run test:mutations -- --only=M36,M37
```
```
  M36  packages/core/src/job/submit.ts … caught (8.0s)
  M37  packages/browser/src/browser-node.ts … caught (3.4s)

id   mark  status  seconds  detail
M36  PASS  caught     8.0s  exit 1 with the recorded signature
M37  PASS  caught     3.4s  exit 1 with the recorded signature

git status --porcelain is empty — the tree is as it was found.
```
`MUTATION_ARM_EXIT=0`, captured on the line immediately after the command.

The planted-run logs, read directly rather than inferred from the verdict:

| | M36 | M37 |
|---|---|---|
| mutation | a re-pick loop added to `submitJob` after `executeVerified` | `capacity:` handed a second `LocalCapacity` built without the governor |
| run | `Test Files 1 failed (1)` / `Tests 1 failed \| 1 passed (2)` | `Test Files 1 failed (1)` / `Tests 1 failed \| 5 passed (6)` |
| the failing case | `re-picks past a node genuinely at its slot limit, on the production submit path` | `sees the slot count fall from 8 to 2, off the wire` |
| the assertion | `AssertionError: expected 'agreed' to be 'insufficient'` | `AssertionError: expected { slots: 8, inFlight: +0 } to deeply equal { slots: 2, inFlight: +0 }` |

M36 is the answer to G-1: **the tripwire RULING A asked for now fires.** The new reading is
taken on a shard whose *selected* executor refuses at exec — the node accepts the offer, is
saturated inside the `admit` callback (which awaits `untilFull` so the node says so itself
before the callback returns), and then refuses the dispatch. The shard ends `insufficient`
with the victim named in `verification.failures` and a reason containing `over-committed`,
and the victim is asserted **absent** from `rejections`, because `submit.ts:341` fills that
from the placement stage only. Given a re-pick the shard would reach a free second executor
and stop being `insufficient` — which is precisely what M36 demonstrates.

Two non-vacuity guards I checked rather than assumed: the failure names the victim (a shard
never placed on the saturated node would also be `insufficient`, for an unrelated reason),
and the shard uses a **separate** `EXEC_STAGE_VALUE`, because the slot key is
`inputCid:partitionIndex` and reusing `SHARD_VALUE` would meet the DUPLICATE branch, which
is a different claim. The old tautological line was **deleted**, not left beside the new one.

#### 3. G-2's reading is off the wire, not out of the page — CONFIRMED

This was the claim most worth falsifying, because a `page.evaluate` reading would only prove
the setter ran, which 18-09 had already proved. Read `duty-cycle-tab.e2e.test.ts:246-308`:

```ts
async function offerToTab(tabPeerId, shardId) {
  const reply = parseResponse(await peer.rpc.request(tabPeerId, encodeRequest({ kind: 'offer', shardId })))
  ...
  return reply.capacity
}
```

The reading is taken on the **`offer` response the Node peer received**. `peer` is a second
`FabricNode` started in `beforeAll` with **no** `maxReservations`, so it is not a relay and
holds no reservation for the tab; the tab dials its `/ws` listener itself. The case asserts
the path before it asserts the capacity: connections to the peer are non-`limited`, carry no
`p2p-circuit` hop, and include a `/ws` address — the transport's own answer, which matters
because `.planning/PROJECT.md` fixes a relayed circuit as a signalling channel that may not
carry work. Both values are read, not only the capped one, so a tab capped since startup
would fail.

M37 settles it independently of my reading of the source: the mutation changes only
`packages/browser/src/browser-node.ts`, code that runs **in the browser process**, and it
turns exactly one case red — the peer's. All five in-page cases stay green, and the in-page
`window.o2.capacity()` corroboration inside the same case is stated last, deliberately. That
divergence is the whole content of the gap, and it is now measured. **G-2 closed;
criterion 3 MET.**

#### 4. The ledger blind spot was structural — CONFIRMED, and the widening does not weaken

`requirements-ledger.node.test.ts`'s two claim-checking cases iterated `BUILT_NOT_WIRED`, so
correcting a row to *Partial* removed it from the guard's population — **the act of fixing a
row was the act of exempting it.** Both cases now iterate `ROWS`, which is strictly wider;
nothing that was checked before is unchecked now.

`WITHOUT_A_CHECKABLE_CLAIM` went 2 → 17, and it is **not** a way to make a red guard green.
The case that consumes it asserts **exact set equality**:

```ts
expect(unchecked.toSorted()).toEqual([...WITHOUT_A_CHECKABLE_CLAIM].toSorted())
```

so padding the list with a row that *does* carry a bindable claim turns that case red, and
being in the list exempts a row from nothing — the two claim cases read every row regardless.
The one narrowing (`row.unsuppliedHooks.length === 0` added to the `unchecked` filter) is
legitimate: the hook case at `:596-605` iterates `ROWS` and reads exactly those rows.

That the widening is functional rather than decorative I checked directly. **SCHED-03 is a
*Partial* row carrying a live, bindable claim** — *"`runResilient` has no production
caller"*. `runResilient` is declared at `coordinator.ts:304`, re-exported at
`core/src/index.ts:192`, and every other occurrence in production
(`churn.ts:4,74`, `combine.ts:32`, `worker-executor.ts:39`, `bench.ts:867`,
`mutation-ledger.ts:307`) is prose in a comment with no call parenthesis. The claim is true
today and reddens the day it stops being. Under the old scope that row was not read at all.

The fourth stale row, **NET-06**, is real and nobody had reported it: at `a06720e` it said
`discoverCandidates` had no production caller while `bin/bench.ts:680` calls it. Verified.

The four corrected rows were checked against the tree, not against each other:

| Row | Claim | Verified |
|---|---|---|
| SCHED-03 | `runResilient` has no production caller; offer-stage re-pick is wired via `submit.ts:340` ← `bench.ts:723` | Holds — both confirmed |
| SCHED-04 | all three legs have a production path; marker held low deliberately | Holds — `fabric-node.ts:985/1153/1181/1475`, `browser-node.ts:677/1007/1012/1063`, `agent.ts:682`, `demo/main.ts:596` |
| SCHED-05 | `eligibleNodes` called by **both** placers; open leg is that no entry point labels a shard `sovereign` | Holds — `sovereignty.ts:130,169`, `placement.ts:231`, `bench.ts:455` |
| NET-06 | serving half wired both tiers; reading half reaches production behind a flag | Holds — `fabric-node.ts:1566`, `browser-node.ts:1164` |

#### 5. Nothing was ticked — CONFIRMED

The `.planning/REQUIREMENTS.md` diff over `a06720e..29bbfe4` is 12 content lines: the header
paragraph (2) and four traceability rows (10). **No checkbox line is among them.** SCHED-03,
SCHED-04 and SCHED-05 remain `[ ]` at `:247`, `:248`, `:250`. The single `[ ]` occurring in
the diff is prose inside SCHED-04's cell — *"the box is left `[ ]` only because no
re-verification has run"* — not a checkbox.

The three-edits rule (`STATE.md:208`) held. Counted independently against the table:
*Built, not wired* = **14**, *Partial* = **18**, matching the header's new `14 + 18 + 1` and
the `UNREACHED.length` of 32 the guard's own floor records. SCHED-05 moved category
(*Built, not wired* → *Partial*), which is what moved both figures; no box moved, because
nothing was ticked. `acceptance-traceability.node.test.ts` was run and passes.

### Commands run (real output, exit captured on the following line)

The tree was clean before and after every one of these; nothing was committed, reverted, or
`git add`ed, and no branch was switched. `git status --porcelain` was empty at start, after
the mutation run (the runner's own check and mine), and at finish.

| Command | Result | Exit | Load at start |
|---|---|---|---|
| `npm run test:mutations -- --only=M36,M37` | both `caught` with recorded signature; tree restored | 0 | 4.09 |
| `npx vitest run --project node` × 5 guard files | `Test Files 5 passed (5)` / `Tests 161 passed (161)` | 0 | 4.98 |
| `npx vitest run --project node` × 8 phase files | `Test Files 8 passed (8)` / `Tests 48 passed (48)`, 20.22 s | 0 | 4.51 |
| `npx vitest run --project e2e duty-cycle-tab.e2e.test.ts` | `Test Files 1 passed (1)` / `Tests 6 passed (6)` | 0 | 9.30 |
| `npx vitest run --project node` × 6 kernel files | `Test Files 6 passed (6)` / `Tests 112 passed (112)` | 0 | 5.53 |
| `npx vitest run --project node` × 2 admission files | `Test Files 2 passed (2)` / `Tests 13 passed (13)` | 0 | — |

**22 files, 340 tests, all passing, plus 2 mutation arms caught.** Every invocation used
`--project`; no bare-path run was made. The guard count rose 159 → 161, which is the widened
ledger's two extra cases.

The e2e file went 5 → 6 tests and the five pre-existing in-page cases still pass, so adding
a second Node-tier `FabricNode` to that fixture regressed nothing.

### W-1 closed

`discover-arm.node.test.ts` spawns `bin/bench.ts --quick --discover` with `cwd` in a
temporary directory, reads `--discover: 1 of 1 workers qualified from 1 providers` off its
stdout, and kills the driver once the arm has spoken — it reads a **count**, never a
duration, so it is contention-independent. `serve-agent-hooks.node.test.ts:347`'s
source-text count is kept as the cheap half of a pair rather than as the only holder. The
arm the first pass had to run by hand is now in CI.

### W-2 closed

`fabric-node.ts:1207-1221` and `browser-node.ts:793-808` each now name the other tier, the
platform reason, and the test that measures its disposition, and each says **do not make
them agree**. Comment-only on both sides — verified against `git show 548e119`: no
executable line changed.

### New findings this pass

**F-1 — `admit: rpcAdmission(requestor.rpc)` at `bin/bench.ts:723` is guarded by nothing.**
Recorded, not fixed; tracked for a later phase. 18-13 planted its deletion and the run stayed
green, and I confirmed the structural reason independently rather than taking the report's
word: `serve-agent-hooks.node.test.ts` pins eleven separate strings in that file with
`occurrences(BENCH, …)` — `'serves-unauthenticated'`, `new LocalCapacity(`,
`await discoverCandidates(` and eight more — and **`admit` is not among them**. Every other
`rpcAdmission` reference in the suite constructs its own. Deleting the line moves `submitJob`
from `planWithOffers` to `planPlacement`, and on a rig where nothing refuses the two place
identically and print identically. This matters more than it looks: `Fabric.admit` is the
wiring that let **SCHED-02 stop being *Built, not wired***, and it is the sole production
caller behind that row's "runnable entry point" claim. The file states the finding in its own
docblock (`discover-arm.node.test.ts:54-63`), which is the right place for it.

**F-2 — three of the four corrected ledger rows now cite line numbers that 18-13's own
later commit shifted.** `a5a70c7` wrote the rows; `548e119`, three commits later in the same
plan, inserted 15 comment lines at `fabric-node.ts:1207` and 16 at `browser-node.ts:793`.
Every citation *below* those points is off by exactly that much — SCHED-03's
`fabric-node.ts:1573` is now `:1588`, SCHED-04's `:1460` is now `:1475` and
`browser-node.ts:996` is now `:1012`, NET-06's `fabric-node.ts:1551` is now `:1566`.
Citations *above* the insertion points (`:985`, `:1153`, `:1178`, `:1181`, `browser-node.ts:677`,
`sovereignty.ts:130/169`, `placement.ts:231`, `submit.ts:340/341/389`, `bench.ts:455/680/723`)
were all checked and are **exact**. The claims are true; only the coordinates drifted, inside
the very plan that was correcting stale coordinates. Documentary, not behavioural.

**F-3 — `tools/aot/lift.node.test.ts` contradicts `deferred-items.md` item 2, and the
contradiction is recorded rather than chased.** 18-12 re-measured it alone on a quiet host
and it failed **worse** than in the suite: 12 failures against 7, ten of them
`Test timed out in 60000ms` rather than the recorded assertion failure, and 850 s against the
config table's 217.1 s. That falsifies item 2's "passes in isolation". 18-13's later full run
had it pass. Intermittent, and `tools/aot` is Phase 21's — out of this phase's scope. Worth
recording that 18-12's own full node-project run was therefore **not green** (7 failed / 1778
passed), all failures in that one file, none of them reachable from anything this phase
touched.

**F-4 (Info) — Phase 18 is `Mode: mvp` in `.planning/ROADMAP.md:495`, but its goal is not a
User Story.** MVP-mode verification expects `As a …, I want to …, so that …`; this goal is a
capability statement. Both passes scored against the nine Success Criteria instead, which is
the roadmap contract and is what the score is over. Flagged so it is not mistaken for an
oversight; no action taken here.

### Anti-patterns

Nine files were touched across 18-12 and 18-13
(`discovery-agents.node.test.ts`, `duty-cycle-tab.e2e.test.ts`, `mutation-guard.node.test.ts`,
`mutation-ledger.ts`, `browser-node.ts`, `discover-arm.node.test.ts`, `fabric-node.ts`,
`requirements-ledger.node.test.ts`, `serve-agent-hooks.node.test.ts`). Scanned each:
**zero `TBD` / `FIXME` / `XXX`, zero `TODO` / `HACK` / `PLACEHOLDER`, zero
"not yet implemented".** No debt-marker gate finding.

18-12's claim that it changed **no production file** holds: `git diff 88ab88f a06720e --
packages/core packages/browser packages/net packages/libp2p` is empty, and its four files are
two tests, one test-of-tests and the ledger data. 18-13's two production-file edits are
comment-only.

### Why this is `human_needed` and not `passed`

No automated gap remains. Both G-1 and G-2 are closed, W-1 and W-2 are closed, every
criterion this phase can prove is proved, and 340 tests plus two planted mutations back it.

What stops a `passed` verdict is criterion 2b, and the reason is a ruling rather than a
finding. RULING A (`.planning/ROADMAP.md:607-621`) accepts 2b at PARTIAL in advance **and**
states: *"The criterion text is NOT amended, and the phase is NOT allowed to close on it …
A criterion is not rewritten to let a phase close."* It cites Phase 17, which "stayed
uncounted at 1/3" on exactly this shape. The behaviour — an exec-stage re-pick — is Phase 20
criterion 1's (WIRE-04) and remains correctly `deferred`, not a gap. Only the *instrument*
was ever Phase 18's, and it is now armed and demonstrated to fire.

So the remaining question is not "is anything missing" but "may Phase 18 be marked complete
at 8/9 with 2b carried" — a scheduling judgement under an owner ruling, which a verifier may
not make for itself. That is the single escalation item in the frontmatter.

### Unchanged by this amendment

- **The exec-stage re-pick** — WIRE-04, Phase 20 criterion 1. Deferred, as before, not
  counted as a gap.
- **The entry-point substitution on criterion 1** — `bin/bench.ts --discover` rather than
  `bin/agent.ts`, made at planning time and written into the ROADMAP. Recorded as Info, as
  before; W-1's closure means it is now executed by CI as well as by hand.
- **`STATE.md`'s stale `## Current Position` prose (I-2)** — hand-maintained, not edited.
- **`deferred-items.md` item 1 (`SLOW_NODE_SPECS`)** — `slow-specs.node.test.ts` re-run and
  passes. Out of scope, as before.

---
*Amended: 2026-08-03T02:06:28Z*
*Verifier: Claude (gsd-verifier), independent re-verification after gap closure*
*Working tree: left clean; nothing committed, nothing reverted, no branch switched*

---

## Amendment — 2026-08-04: criterion 2b is MET, and the score is 9/9

**Status: `human_needed` → `passed`. Score: 8/9 → 9/9.** Everything above is the record of the
2026-08-02 initial pass and the 2026-08-03 re-verification, and both are left standing. Nothing
in either is retracted. What changes is criterion 2b (PARTIAL → **MET**), and with it the single
escalation item, which dissolves rather than being decided.

Criterion text in `.planning/ROADMAP.md` was **not** amended. Re-read against the Phase 18
Success Criteria block and compared word-for-word with what both earlier passes scored against:
2b still reads *"A node **at its execution slot limit refuses an `exec` request** with a stated
reason naming the limit, and the requestor re-picks."* This amendment scores against the same
contract. Citations below are by **grep-able symbol**, not by line, for the reason recorded in
finding F-2 of this same amendment.

### Why the bar lifted

RULING A barred the phase from closing on a PARTIAL 2b and named the condition under which the
clause would arrive: *"the clause turns red the day WIRE-04 lands"*. Phase 20's criterion-1 note
states the follow-through in the owner's own words — *"Update the assertion to require the
re-pick rather than its absence, and Phase 18 criterion 2b becomes MET."*

Both halves of that happened. WIRE-04 landed in plan 20-01. The armed tripwire fired
(`expected 'agreed' to be 'insufficient'`). Plan 20-04 rewrote the case to require the re-pick.
**20-04 was killed mid-flight by a usage limit and wrote no summary** — its work landed in the
salvage commit `9acd85f` unreviewed — so this pass is that work's first reader and treats it as
unreviewed code rather than as a reported result.

### Criterion 2b — MET, both clauses, re-derived from source

| # | 2026-08-02 | 2026-08-03 | 2026-08-04 | Why it moved |
|---|---|---|---|---|
| 2b | FAILED | PARTIAL | **MET** | The re-pick exists in `submitJob` and is measured across real processes on a shard whose selected executor refused at exec. |
| 1, 2, 2c, 2d, 3, 4, 5, 6 | — | VERIFIED | **VERIFIED** | Re-run this pass, no regression. |

**Score: 9/9 criteria.**

#### Clause 1 — the named refusal, on the production submit path

The mechanism, read in production source rather than in a summary. `serveAgent`'s `exec` branch
(`packages/net/src/agent.ts`, search `const admission = capacity.offer({ shardId: slotKey`)
calls `capacity.offer(...)` and, when refused, returns `encodeResponse({ kind: 'error', reason:
admission.reason })` **before** the `try` that reaches the executor — its own comment states
that ordering as the requirement. The refusal text is composed in exactly one place,
`LocalCapacity.#decide` (`packages/core/src/placement.ts`, search
`` `over-committed: ${this.#inFlight.size} of ${slots} slots in use` ``), so the string a
requestor reads is the node's own words off the wire and it names the limit.

The reading is `discovery-agents.node.test.ts` › *"stops at the generation cap naming every
refusal, beside a control with one node free"*, taken across real spawned `bin/agent.ts`
processes (`spawnAgent` → `spawn(process.execPath, [AGENT, …])`) through `submitJob` imported
from `@o2/core`:

- `expect(fullShard.verification.failures.map((f) => f.nodeId)).toStrictEqual(fullShard.attempted)`
  — per node, in the order tried, not a count.
- every `failure.reason` contains `over-committed: 1 of 1 slots in use`.
- `expect(fullShard.rejections).toStrictEqual([])` — **this is what makes it an exec-stage
  reading**: the case supplies no `JobSpec.admit`, so no offer was ever made and every refusal it
  read came from `exec`.

Non-vacuity checked rather than assumed: `failures` cannot be empty, because its node list is
asserted equal to `attempted`, whose length is separately asserted to be `DEFAULT_MAX_GENERATIONS`
against the exported constant. The mechanism additionally carries two pre-existing planted
guards, `M1` (swap `offer()` for `would()` — *"no requestor is ever told `over-committed:`"*) and
`M2a` (the `'accepts-every-offer'` sentinel).

#### Clause 2 — the re-pick, in production and measured

`packages/core/src/job/submit.ts` now runs a per-shard generation loop (search
`// ── The generation loop — WIRE-04, CHURN-01, CHURN-04`): grant a lease, dispatch under it,
and on an observed failure `leases.surrender(...)` then
`placeAgain(requestFor(shard, shardId, wanted), gate.pool, new Set(attempted), spec.admit)` —
the same eligibility gate, minus every node already attempted. The loop keeps no counter of its
own; it stops when `leases.grant` returns null. `executeVerified` is no longer called once per
shard.

The reading is `discovery-agents.node.test.ts` › *"re-picks past a node genuinely at its slot
limit, on the production submit path"*. The node accepts the offer while free, is saturated
inside the `admit` callback — which `await`s `untilFull(...)` so **the node itself says it is
full** before the callback returns — and then refuses the dispatch. Asserted:

- `expect(repickedShard.attempted[0]).toBe(victim)` — placement chose the node that would refuse,
  and the dispatch reached it. Without this the reading is satisfiable by a shard that never met
  the saturated node.
- `expect(repickedShard.attempted).toStrictEqual([victim, answering])` — exactly two nodes asked,
  the second is the one whose answer the result carries.
- `expect(repickedShard.generations).toBe(2)`, `expect(repicked.job.redispatches).toBe(1)`,
  `expect(repickedShard.ending).toBe('agreed')`, `expect(repickedShard.degraded).toBe(false)`.
  An exact count, not `toBeGreaterThan(0)` — which a loop that re-dispatched unconditionally
  would also satisfy.
- the lease trail `toStrictEqual(['granted:victim', 'surrendered:victim', 'granted:answering',
  'completed:answering'])`.

**The lease trail is the discriminator I checked rather than took on trust.** A re-pick provoked
by *silence* would prove nothing about a refusal. In `submit.ts`, `leases.surrender(...)` is
reachable only on the `dispatched.kind === 'answered'` arm; the lapse arm calls `leases.reap(...)`
and produces a different event. `surrendered:${victim}` therefore says the victim **answered with
a failure** — it refused — rather than went quiet. Combined with `untilFull` and with the shard
carrying `EXEC_STAGE_VALUE`, a slot key distinct from the occupying task's (the node's key is
`inputCid:partitionIndex`, so a shared key would meet the DUPLICATE branch and be a different
claim), the refusal being re-picked past is the over-committed one.

#### The new assertion CAN fail — proved by planting, not by reading

The 2026-08-02 pass's finding was that the old instrument was confined at the type level. That
question is asked again of the replacement, and answered by measurement.

**Structurally:** `attempted` (`attempted.push(...nodeIds)` once per generation), `generations`
(`generations += 1`), `redispatches` and `leaseHistory` are unbounded accumulators. None is
confined by `redundancy`. The tautology's shape is gone, not renamed.

**By planting:** `W1`'s mutation was applied by hand to `packages/core/src/job/submit.ts` — a
`break` inserted immediately before the *"How much is still missing"* comment, which runs the
first generation and returns it unchanged — and the file was run:

```
FAIL |node| packages/node/src/discovery-agents.node.test.ts > criterion 2 — sample, refuse,
     re-pick, complete > re-picks past a node genuinely at its slot limit, on the production
     submit path
AssertionError: expected 'insufficient' to be 'agreed'
FAIL |node| … > criterion 2, bounded … > stops at the generation cap naming every refusal,
     beside a control with one node free
AssertionError: expected [ Array(1) ] to have a length of 3 but got 1
Test Files  1 failed (1)   Tests  2 failed | 1 passed (3)
```

`PLANTED_EXIT=1`, captured on the line immediately after the command. That failure is the exact
inverse of the tripwire the phase armed and Phase 20 fired — `expected 'insufficient' to be
'agreed'` where the tripwire read `expected 'agreed' to be 'insufficient'`. The clause is now
held by a reading that goes red when the behaviour is removed, which is the property RULING A
demanded and the 2026-08-02 pass found missing.

Restored from a `cp` backup, `cmp` exit 0, `git status --porcelain` empty. Nothing was staged,
committed, reverted, stashed or branch-switched.

#### What is NOT claimed, and where 20-04 fell short of its own plan

20-04's plan carries the must-have *"the re-pick does not erase the first executor's named
refusal from the shard's failures."* **That truth was not met, and the landed test says so in its
own words** — *"It erases half of it, and the half it erases is the over-committed text."*
Verified at the type level rather than accepted: `VerificationResult`'s `agreed` arm
(`packages/core/src/job/verify.ts`, search `export type VerificationResult`) declares
`resultCid`, `output`, `agreeing`, `replicas`, `grossFuel`, `usefulFuel` — and **no `failures`
field at all**, while `disagreed` and `insufficient` both have one. So a shard that ends agreed
has nowhere to carry a previous generation's refusal text. The test substitutes the lease history
and names the substitution. That is an honest deviation, recorded as a deferral by 20-01, and it
is **Phase 20's** to settle.

It does not reduce criterion 2b, which asks that the node refuse with a stated reason and that
the requestor re-pick — not that both appear in one `ShardResult`. Both clauses are measured on
the production `submitJob` path across real processes, in two sibling cases on one fixture shape,
because the union type cannot express them in one. Stated plainly rather than papered over.

### The three findings that outlived the phase — current status, measured

**F-1 — `admit:` at `bin/bench.ts` guarded by nothing: CLOSED**, by Phase 19 plan 19-17
(defect #31), not by anything in Phase 18.

The expression is now conditional and has moved — `...(DISCOVER ? { admit: rpcAdmission(requestor.rpc) } : {})`
(grep `DISCOVER ? { admit:` in `packages/node/src/bin/bench.ts`; the old coordinate `:723` now
lands on an unrelated comment). Its guard is `bench-reduce.node.test.ts`'s call-site requirement
*"the discover rig supplies admit, and the job spec passes it on"*, whose two patterns match the
**whole spread** rather than a bare `admit:`, so the *absent-not-`undefined`* half is held too.
Run this pass: 19 passed — and the guard carries its own reddening proof as a first-class case,
*"reports exactly 'the discover rig supplies admit, and the job spec passes it on' when only that
call site is gone"*.

One correction to this report's own 2026-08-03 F-1 text, which claimed
`serve-agent-hooks.node.test.ts` pins eleven strings in `bench.ts` *"and `admit` is not among
them"*. The first half is true — I re-counted 16 `occurrences(BENCH, …)` pins there. The second
half understates it: that file names **neither `rpcAdmission` nor `admit:` anywhere**, so
SCHED-02's runnable-entry-point leg rested on nothing at all rather than on a weak pin.
`discover-arm.node.test.ts`'s docblock records the same measurement.

**F-2 — ledger citations that outran the tree: CLOSED 2026-08-25** by commit `1e7248d`, not by
anything in Phase 18. **The paragraphs below are retained exactly as written on 2026-08-04** —
they are the reading that motivated the repair, and the closure is recorded after them rather
than by rewriting them. Read the note under this section's end before quoting any coordinate
below as current.

**F-2 — ledger citations that outran the tree: STILL OPEN, and worse.** At phase close STATE.md
recorded *23 of ~45*. Re-measured today against `.planning/REQUIREMENTS.md`: **46 resolvable
`file:line` citations, of which 28 land on a blank line, a bare delimiter, or a comment body**,
and at least five more land on code that is demonstrably not the construction the row names:

| Row | Citation | What is there now | Where the named construction actually is |
|---|---|---|---|
| SCHED-04 | `fabric-node.ts:985` for `setDutyCycle` | `this.#identity = parts.identity` | `:1123` |
| SCHED-04 | `fabric-node.ts:1153` for `new DutyCycleGovernor(` | `try {` | `:1291` |
| SCHED-04 | `fabric-node.ts:1181` for `dutyCycle: governor` | a comment about identity persistence | `:1319` |
| SCHED-04 | `fabric-node.ts:1475` for `new GovernedExecutor(` | `await FsIssuance.open(` | `:1701` |
| SCHED-05 | `sovereignty.ts:130` for `eligibleNodes` | `load: 0,` | `:181` |

So **at least 33 of 46 are wrong**, against 23 of ~45 at phase close. The offsets are 51, 138,
138, 138 and 226 — a blanket correction is still wrong, which is what STATE.md already measured
when it declined a cheap guard.

**Every underlying claim was re-derived by symbol and every one still holds.** SCHED-04's four
constructions all exist. SCHED-05's *"both placers call `eligibleNodes` as their first act"* is
true: `placement.ts` search `let pool = [...eligibleNodes(request, nodes)]` inside
`placeWithOffers`, and `sovereignty.ts` search `const eligible = eligibleNodes(request, nodes)`
inside `planPlacement`. This is documentary rot, not a behavioural defect, and it scores against
nothing here — this pass cited by symbol throughout for exactly this reason. The project's own
recorded response (ROADMAP: *"CITED BY SYMBOL, NOT BY LINE … a line number is an ABSOLUTE
reference into a file that keeps changing, and it rots silently while reading like evidence"*)
is the right one and has not yet been applied to `REQUIREMENTS.md`. Reported, not edited — that
file is shared and three other verifiers are active.

**CLOSURE — 2026-08-25, commit `1e7248d`.** The last sentence above is what changed: the file was
no longer shared, so the response this report called *"the right one"* was applied. 139 unique
`path:line` citations were resolved against the tree — 60 repaired by anchoring on a declaration,
a call site or a quoted sentence; 75 still landed on their subject and were left alone; 4 name a
subject that has left the tree and carry a dated note instead of a new coordinate. **The counts
above are not the counts of the repair, and neither supersedes the other**: this report measured
46 *resolvable* citations on 2026-08-04 within its own scope, the repair examined 139 unique ones
across the whole file three weeks later. Nothing here was re-derived from the other.

**What the closure did NOT do.** No checkbox, requirement id or verdict line moved — verified on
the staged diff, not asserted. And **seven rows were reported and deliberately left unedited**,
because repairing their citation would have moved a *measured claim* rather than a coordinate:
`AUTH-04`, `CHURN-03`, `CHURN-04`, `MR-02`, `MR-06`, `NET-06` and the passage arguing for symbols,
which had drifted itself. Those are stale **claims**, a different and larger repair than this one,
and they are carried as their own finding rather than folded into this closure.

**The disposition itself was the finding.** This entry read `STILL OPEN` for a day after the work
that closed it, because the closing commit wrote into the *destination* (`REQUIREMENTS.md`) and
not into the file that raised the finding. A re-parse of the audit sources would therefore have
re-derived F-2 as open indefinitely. Recorded because the loop, not the citation, is the defect.

**F-3 — `tools/aot/lift.node.test.ts` contradicting `deferred-items.md` item 2: CLOSED**, by
`3d6806b` *("a retry bounded by a count is not bounded, when an attempt costs a budget")*. The
recorded diagnosis was wrong in the way this report predicted it might be: the 60 000 ms reading
was that file's own `vi.setConfig({ testTimeout })`, not evidence about docker, and the real
cause was `despiteAFullProcessTable` spending 4 × 20 000 ms of driver budget inside a 60 000 ms
case. The bound is now comparative (two arms of one case). Out of Phase 18's scope throughout;
recorded here only because this report opened the question.

### Commands run (real output, `EXIT` captured on the line immediately after each command)

No pipes and no trailing `tail` on any exit capture. Every invocation used `--project`; no
bare-path run was made.

| Command | Result | Exit |
|---|---|---|
| `npx vitest run --project node …/discovery-agents.node.test.ts` (baseline) | `Test Files 1 passed (1)` / `Tests 3 passed (3)`; `real 32.57 user 75.76 sys 4.17` | 0 |
| the same, with the re-pick deleted from `submit.ts` (`W1` planted by hand) | `Test Files 1 failed (1)` / `Tests 2 failed \| 1 passed (3)`, `expected 'insufficient' to be 'agreed'` | 1 |
| `cp` restore, then `cmp` backup against `submit.ts`, then `git status --porcelain` | identical; empty | 0 |
| `npx vitest run --project node` × 5 — `net/discovery`, `placement`, `sovereign-offers`, `bench-reduce`, `peer-verifier` | `Test Files 5 passed (5)` / `Tests 103 passed (103)` | 0 |
| `npx vitest run --project node` × 5 — `duty-cycle`, `peer-dial`, `sovereignty-placement`, `reservation-exhaustion`, `discover-arm` | `Test Files 1 failed \| 4 passed (5)` / `Tests 1 failed \| 16 passed (17)` — see the note below | 1 |
| `npx vitest run --project node …/discover-arm.node.test.ts` alone | `Test Files 1 passed (1)` / `Tests 1 passed (1)` | 0 |
| `npx vitest run --project e2e …/duty-cycle-tab.e2e.test.ts` | `Test Files 1 passed (1)` / `Tests 6 passed (6)` | 0 |
| `npx vitest run --project node` × 4 guards — `requirements-ledger`, `acceptance-traceability`, `mutation-guard`, `serve-agent-hooks` | `Test Files 4 passed (4)` / `Tests 180 passed (180)` | 0 |
| `npx vitest run --project node …/bench-reduce.node.test.ts --reporter=verbose` | 19 passed, including the planted-absence case for `admit` | 0 |

**16 files, 309 tests, plus one defect planted by hand and watched go red.** Load was 3.65 at the
baseline run and 6.66 at the cross-process batch; ambient CPU was a `cpp2rust` build at 93.8% and
OneDrive at 66.8%, not a competing suite.

**The one red, attributed by measurement rather than by plausibility.**
`discover-arm.node.test.ts` failed on `expect(repoStatus()).toBe(before)` with
`+ M packages/node/src/sovereign-at-rest.node.test.ts`. That file is not Phase 18's, was not
touched by this pass, and `git status --porcelain` confirmed a concurrent agent modified it
**during** the batch — `before` was empty and `after` was not. Re-run alone against the now-stable
tree: green. This is the shared-index hazard the conventions name, not a Phase 18 regression, and
it is recorded rather than retried into silence.

### Why this is `passed`

Every criterion is met and every one was re-measured this pass. The 2026-08-03 escalation existed
only because RULING A forbade closing on a PARTIAL 2b; 2b is no longer partial, so the item
dissolves rather than needing an owner decision. The condition under which it becomes MET was
written by the owner into Phase 20's criterion-1 note before the work was done, and it has been
satisfied and independently verified here.

`deferred` in the frontmatter above is now empty in substance: the exec-stage re-pick it carried
to Phase 20 has arrived, and Phase 20 criterion 1 keeps it for its own scoring.

### Open, and not Phase 18's to close

- **F-2's citation rot** in `.planning/REQUIREMENTS.md` — 33+ of 46 wrong, documentary only,
  every underlying claim re-derived true by symbol. Recommend converting the rows to symbol
  citations as the ROADMAP already ruled; not edited here because the file is shared.
- **20-04's second must-have** — *"the re-pick does not erase the first executor's named
  refusal"* — is unreachable while `VerificationResult`'s `agreed` arm has no `failures` field.
  Phase 20's, and its plan should either widen the type or restate the truth.
- **`STATE.md`'s hand-maintained prose**, unchanged and untouched, as in both earlier passes.

---
*Amended: 2026-08-04T19:20:00Z*
*Verifier: Claude (gsd-verifier), independent re-verification after WIRE-04*
*Working tree: left clean of this pass's own changes; `submit.ts` restored and `cmp`-verified; nothing committed, staged, reverted or branch-switched*
