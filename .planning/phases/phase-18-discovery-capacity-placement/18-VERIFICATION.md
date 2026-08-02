---
phase: 18-discovery-capacity-placement
verified: 2026-08-02T23:54:55Z
status: gaps_found
score: 7/9 criteria verified
verifier: independent pass, goal-backward
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
