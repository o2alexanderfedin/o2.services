---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 08
subsystem: quorum-composition, cross-process-measurement
tags: [VER-03, VER-04, criterion-1, anti-affinity, shared-relay, degrade-or-refuse]
requires:
  - "packages/core/src/quorum.ts — composeQuorum, rules 1 and 2 (19-02, retraction 0314208)"
  - "packages/core/src/job/submit.ts — the quorum gate and onQuorumShortfall (19-06, 19-18)"
  - "packages/net/src/discover-candidates.ts — the certificate on NodeDescriptor (19-01)"
  - "packages/node/src/fabric-node.ts — attestResults composed at the factory (19-15)"
provides:
  - "criterion 1's positive half across three real bin/agent.ts processes"
  - "the degrade/refuse pair over ONE live fixture, differing in one field"
  - "the redundancy-1 control that shows the dial is read only where a shortfall happened"
  - "rule 2 fired, named by its relay, over provider-signed via-relay certificates"
  - "a re-measured MEASURED_NODE_SPANS whose load peak was actually sampled"
affects:
  - "19-12 (mutation ledger) — ten find/replace pairs recorded below"
  - "19-10 / 19-11 — the receipt strengths they display are now reachable and asserted here"
tech-stack:
  added: []
  patterns:
    - "membership, never a count, when waiting on a peer set that has a relay in it"
    - "ask each peer on its own before a union that swallows transport errors"
    - "one submit closure, one varying field, so two arms cannot drift"
key-files:
  created:
    - packages/node/src/quorum-agents.node.test.ts
  modified:
    - packages/node/src/discovery-agents.node.test.ts
    - vitest.config.ts
    - .planning/phases/phase-19-quorum-composition-owner-domain-attestation/deferred-items.md
decisions:
  - "fabric B's executors are in-process because bin/agent.ts CANNOT produce a via-relay node — measured, and the binary says so about itself"
  - "the job travels a direct connection; the relay is a signalling channel, and rule 2 reads the discovery graph rather than the socket"
  - "VER-03 and VER-04 deliberately NOT ticked — VER-03 is unimplemented by ruling, VER-04's display half is 19-10/19-11"
  - "no flag added to bin/agent.ts; the gap is filed in deferred-items.md against the fold that binary already asks for"
metrics:
  duration: ~1h20m
  completed: 2026-08-03
---

# Phase 19 Plan 08: One operator cannot fill a quorum, measured across processes Summary

Criterion 1 is read across real `bin/agent.ts` processes: three operators compose a quorum
whose independence is taken off certificates a provider process signed; one operator
**degrades** by default — completing, marked degraded, labelled `owner-domain` — and is
**refused in the composer's own words** on the strict dial, over the *same* live agents; and
a one-relay fabric is caught by rule 2 and named by its relay. Every one of those runs
contains a requestor that demonstrably reached and qualified every candidate it could not
compose a quorum from.

## Two things the plan asserted that are false, both measured

### 1. `bin/agent.ts` cannot produce a `via-relay` node

The plan's `<interfaces>` said fabric B would be *"agents spawned with `--relay-addr`
pointing at one relay and no `--port`, so each is `via-relay`"*, and recorded **"No new
flag"** as a decision on that basis. There is no such argv:

- `bin/agent.ts` declares `port: { type: 'string', default: '0' }` and passes
  `listen: ['/ip4/127.0.0.1/tcp/${port}']` to `FabricNode.start` **unconditionally**.
- `fabric-node.ts:1067` derives `canRelay` from that list; `:611-612` derives the
  certificate's `discoverability`/`relayIds` from `canRelay`. Every spawned agent enrols
  `seed` with `relayIds: []`, whatever `--relay-addr` it was given.
- The binary already states the consequence, in `--relay-addr`'s own docblock: *"A node that
  bound nothing would be the browser case, and **this binary has no way to produce one**."*

**So fabric B's three executors are in-process `FabricNode`s.** Their provider is a real
spawned process and their certificates are provider-signed, so `operatorId`,
`discoverability` and `relayIds` are still statements a provider signed about a node rather
than fixture fields. What is lost is that they are not separate operating-system processes —
**criterion 1's second half is one tier weaker than its first**, and that is stated in the
test file's header rather than left to be inferred. Filed as deferred item 2, against the
flag-fold that `bin/agent.ts`'s own comment already asks the next unencumbered phase to do.

The plan's "no new flag" decision was kept, but its stated reason ("every knob this needs
already exists on the binary") is the thing that turned out to be untrue. The reason it is
kept anyway: a measurement plan whose declared files are two test files should not widen a
production binary's argv surface on its way past.

### 2. A job does not run over `/p2p-circuit`

The first arrangement of fabric B routed the job over the circuit — requestor holding its own
reservation, dialling three `/p2p-circuit` addresses. Instrumented on one run:

| step | measured |
|---|---|
| stand-up | 793 ms |
| third peer's verified verdict | **32.8 s** |
| that peer's first `providers` answer | **30.2 s** |
| `discoverCandidates` | **30.5 s** |
| the degrade submit | **30.0 s** |
| the shard | `agreed` with **1 replica of the 2 placed** |

Every stall is exactly `rpcTimeoutMs`, always on one peer, which answers normally on retry.
Raising the relay's `maxReservations` 8 → 32 (which raises `inboundConnectionThreshold`
through `max(...)`) changed nothing.

**This was not chased**, because the repository already records it twice:
`relayed-job.node.test.ts`'s header — *"a full redundant job over relayed connections is NOT
verified here. Attempting it surfaced a design problem that needs a fix rather than a test"* —
and `CLAUDE.md`'s constraint that **the relay is a signalling channel, not a data path**, at
2 minutes and 128 KiB per connection.

**What was done instead:** the executors dial the requestor. The job travels a direct
connection while the certificates still name the shared relay — which is what rule 2 reads,
because rule 2 is an analysis of the **discovery graph**, not of the socket the bytes took.
That is the recorded Phase 3 shape: *once connected, the peers are indistinguishable*, and
the relay drops out. The three fabrics then run in 8–11 s in isolation. Filed as deferred
item 3.

## What was built

### Task 1 — three operators, one quorum, read off what a provider signed

**Commit:** `972ff28`

Three spawned agents with `x-ops`/`y-ops`/`z-ops`, one spawned provider, an in-process
requestor, a public redundancy-2 shard on the production `submitJob` path.

- `shard.quorum.kind === 'composed'` with two distinct operators
- the receipt's `operators` are compared against the `--operator-id` strings **the two
  winning processes were spawned with** — a fixture field could not fail that comparison, a
  signed statement can
- `relayIds` intersected over the agreeing set is empty, and `attestation.sharedRelay` is null
- `strength === 'independent'`, `description === describeAttestation('independent')`,
  `degraded === false`, `job.complete === true`

`discovery-agents.node.test.ts`'s *"Quorum membership and relay use remain unmeasured"*
sentence is repointed here, with the relay half's limitation named. Nothing else in that
file moved — it carries Phase 18's criterion-2b tripwire.

### Task 2 — the engineered fabrics

**Commit:** `4cc4d0a`

**Fabric A — three real processes, one `--operator-id`, submitted three times.** A
`submitOver(redundancy, onQuorumShortfall)` closure means the arms cannot drift: every other
argument comes from the same variables, so there is no second place for a difference to hide.

- **A-degrade** (`'runs-at-available-redundancy'`): completes at **full** redundancy, is
  `degraded === true` anyway, carries `insufficient-operators` with `wanted: 2` /
  `distinctOperators: 1` and the exact string `quorum of 2 needs 2 distinct operators, found
  1`, and its receipt reads **`owner-domain`** with `replicas: 2`, `operators: ['one-ops']`.
  `job.complete === false`.
- **A-refuse** (`'refuses-the-shard'`): the identical shard over the identical live agents is
  `insufficient`, and `refused.verification.reason` is asserted **equal to the degrade arm's
  `quorum.reason`** — so the two arms are demonstrably reading one refusal rather than
  composing two. `refused.quorum` is `toStrictEqual` the degrade arm's. The receipt is the
  named absence.
- **The control**: a redundancy-1 job over the same three agents, on **both** arms, is
  `not-attempted` / undegraded / `owner-attested` / complete. That is the assertion that the
  dial is read where a shortfall happened and nowhere else.

**Fabric B — one relay, three distinct operators**, so rule 1 is satisfied and only rule 2
can fire. Both arms:

- `shared-relay-dependency` **by kind**, with `refusal.relayId === relay.peerId` and the
  composer's full sentence naming the relay
- `degraded === true` while the receipt honestly reads **`independent`** with two operators —
  the two are different tests, and `attestation.sharedRelay` names the dependency for a reader
  holding only the receipt
- the strict arm is `insufficient` with the same reason, `toStrictEqual` on `quorum`

**Distinguishability**, before any outcome in all three cases: the verified-peer wait, a
per-peer `providers` probe, then `providers === 3`, `excluded === []`, and the node ids equal
to the three the fixture stood up.

### Task 2 (cont.) — the span table

**Commit:** `203c897`

`quorum-agents.node.test.ts` measures **24.1 s** under full-suite contention, so it must be
excluded from `test:unit`. `MEASURED_NODE_SPANS`'s docblock forbids pasting one entry from
another run, so the whole table was re-measured, as 19-15 did for the same reason: 134 files
/ 1886 tests, green, sum-of-spans 565.3 s against 263.0 s wall clock, 40 files at or above
the cut; `test:unit` observed directly at 94 files / 1445 tests / 7.49 s on a green run.

**The load was polled every 40 s rather than read at the endpoints**, and that is the point of
this reading. The run began at **7.41** and ended at **5.75** — endpoints a reader would
record as a quiet host — while its real 1-minute peak was **30.71** ninety seconds in. The
reading it replaces stated in this very field that its own peak was higher than either
endpoint and was **unmeasured**; this is the follow-through. Recorded because it is the
opposite of what a reader would predict: the higher-peak run produced the **shorter** spans
(565.3 s against 689.4 s) across a tree that grew by one file.

## The plants, with find/replace pairs for Plan 19-12

Every plant was restored by `cp` + `cmp` (exit 0 each time) and never by `git checkout --`.
`git status --short` was empty after the restore pass.

| # | file | find | replace | observed |
|---|---|---|---|---|
| P1 | `core/src/job/submit.ts` | `degraded: spec.onQuorumShortfall === 'runs-at-available-redundancy',` + `refusal: spec.onQuorumShortfall === 'refuses-the-shard' ? composition.reason : null,` | `degraded: true,` + `refusal: null,` | **RED** — A-refuse completes: `expected 'agreed' to be 'insufficient'`. A caller who said a weaker answer was useless to it silently got one |
| P2 | same | same | `degraded: false,` + `refusal: composition.reason,` | **RED** — A-degrade fails: `expected 'insufficient' to be 'agreed'`. This is the pre-ruling behaviour, and the thing the owner ruled against |
| P3 | same | `degraded: placement.degraded \|\| gate.degraded,` | `degraded: placement.degraded,` | **RED** — `expected false to be true`. 19-06's widening reverted; a shard that failed to get the independence it asked for reports undegraded at full redundancy |
| P4 | `core/src/quorum.ts` | `if (operators.size >= 2) return 'independent'` | `if (operators.size >= 1) return 'independent'` | **RED** — `expected 'independent' to be 'owner-domain'`. Precisely the conflation criterion 1 forbids |
| P5 | `core/src/quorum.ts` | `if (requireIndependentPaths) {` | `if (false as boolean) {` | **RED on fabric B only — 1 failed, 2 passed.** `expected 'composed' to be 'not-composed'`. **This is the measurement that says which case carries which claim** |
| P6 | `core/src/quorum.ts` | `strength: classifyAttestation(members),` | `strength: 'independent',` | **GREEN — 3 passed.** The whole file is insensitive to this; 19-02's size-1 case and 19-10's CLI reading carry it |
| P7 | `core/src/job/submit.ts` | ` && spec.redundancy >= 2` (deleted) + `if (spec.redundancy < 2) {` → `if ((false as boolean) && spec.redundancy < 2) {` | — | **RED on the control** — `runs-at-available-redundancy: expected 'composed' to be 'not-attempted'`. The gate fires where no quorum was ever attempted |
| P8 | `core/src/job/submit.ts` | the whole `const composition = … ? composeQuorum(…) : null` expression | `const composition = null as ReturnType<typeof composeQuorum> \| null` | **RED on all three — 3 failed.** The state of the world before this phase wired `composeQuorum`, reproduced deliberately |
| P9 | `node/src/quorum-agents.node.test.ts` | fabric B's `'ra-ops'`/`'rb-ops'`/`'rc-ops'` | `'one-ops'` ×3 | **RED at the fixture guard** — `expected 1 to be 3` on the distinct-operator count, which names the substitution *before* the refusal kind is read |
| P10 | same | `requestor.dial(agent.multiaddrs[0])` | `requestor.dial('/ip4/127.0.0.1/tcp/1')` | **RED first, naming the cause** — `timed out waiting for all three agents verified; the verified set was []` |

### The two that could not fail, named rather than claimed

- **Task 1's relay assertion cannot redden on rule 2.** Three spawned agents are seeds,
  `sharedRelay` answers `null` on sight of one, and the intersection is empty whatever
  `composeQuorum` does. **P5 measured this**: with rule 2 deleted, only fabric B went red and
  the other two stayed green. The file's header carries the table.
- **Nothing here reddens on `composeQuorum`'s derived strength.** P6 left the whole file
  green. The receipt comes from `attestationReceipt(verified)` in `receiptFor`, not from
  `QuorumResult.strength`, which is the correct separation and is why this file cannot guard
  it. Recorded as a dependency rather than claimed as a proof.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — bug] The verified-peer waits were counts, and a count guarded nothing**

- **Found during:** Task 2, fabric B
- **Issue:** `until(() => requestor.verifiedPeers.length === 3, …)`. In fabric B the
  requestor is connected to the relay as well as to the executors, so a count of three was
  reached with only **two** executors in the list. Discovery then asked two nodes and reported
  `providers: 2` with nothing naming why. The count read as a precondition and was satisfiable
  by the wrong three peers.
- **Fix:** membership — `executors.every((n) => requestor.verifiedPeers.includes(n.peerId))` —
  in all three cases, not only the one that failed.
- **Files:** `packages/node/src/quorum-agents.node.test.ts`
- **Commit:** `4cc4d0a`

**2. [Rule 2 — missing correctness] `RpcRecordIndex.providers` swallows a transport error**

- **Found during:** Task 2, fabric B
- **Issue:** that union asks every peer concurrently and *"a peer that could not be reached
  contributes nothing"* — deliberately. So one silent peer lands as a provider count one short
  and the failure is unreadable.
- **Fix:** `untilAdvertises` polls each peer's own `providers` answer for its own node key,
  before the union, and its failure names the node and carries its last answer. It is also a
  genuine precondition: a relayed peer is reachable only once its reservation is granted.
- **Files:** same
- **Commit:** `4cc4d0a`

**3. [Rule 2 — missing correctness] `until`'s detail was evaluated at the call site**

- **Issue:** the copied helper took `what: string`, so every caller that interpolated state
  reported the state *before* the wait — which is empty, every time. This is the exact defect
  `reservation-exhaustion.node.test.ts` records about itself.
- **Fix:** `what: string | (() => string)`, evaluated at the throw. P10's observed failure
  text is the proof it works.
- **Files:** same
- **Commit:** `4cc4d0a`

**4. [Rule 3 — blocking] The span table had to be re-measured in full**

- **Issue:** the new file lands at 24.1 s under contention. Adding one entry to a table from
  another run is the blend `MEASURED_NODE_SPANS` explicitly forbids.
- **Fix:** full re-measurement plus a polled load. See above.
- **Files:** `vitest.config.ts`
- **Commit:** `203c897`

### Deliberate departures from the plan's letter

- **Fabric B's executors are in-process**, and the job travels a direct connection. Both are
  measured findings, both are in the test file's header and in `deferred-items.md`, and
  neither is a choice this plan preferred to make.
- **`ShardResult.degraded` is asserted on fabric B, but its receipt reads `independent`**, not
  `owner-domain`. The plan expected only *"the composer's `shared-relay-dependency` wording"*
  there and did not say which strength; the honest answer is `independent`, because two
  separate operators did agree. What that fabric lacks is *path* independence, which
  `degraded` and the composer's reason carry. Asserted explicitly, because the pairing looks
  like a contradiction until it is read.
- **`JobSpec.admit` is not supplied** by any submission here. The plan does not require it,
  and the offer arm adds a failure mode without adding a reading this criterion needs.

## Requirements deliberately NOT ticked

**VER-03 and VER-04 keep their current ledger state.** VER-03 is **unimplemented by ruling** —
`quorum.ts`'s own header says so at length: `backbone-anchored` describes the *replica*, is a
storage property, and *"belongs where a result is pinned rather than where a quorum is
chosen"*. VER-04's display half is 19-10 (CLI) and 19-11 (demo UI). Ticking either would put a
false checkbox in a ledger this repository guards, and *unmeasured is not met* applies to a
checkbox as much as to a mechanism — 19-15's precedent, followed here.

`.planning/STATE.md` and `.planning/ROADMAP.md` were **not** touched, per the executor brief.

## The known flake, observed and not chased

`packages/node/src/reservation-exhaustion.node.test.ts` (defect #33, ~20 % on a
byte-identical tree) **did not fire** in either full node run taken for this plan. It passed
in the `--reporter=json` measurement run at 4256 ms and again in the final verification run.
Nothing was adjusted, no timeout raised, no load gate added. **There is no stderr text for
agent `b` to report, because the armed instrument never printed.**

## Verification

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node packages/node/src/quorum-agents.node.test.ts` | **exit 0** — 3 tests, 8.18 s |
| `npx vitest run --project node --reporter=json` (the measurement run) | **exit 0** — 134 files, 1884 passed, 2 skipped, 263 s wall |
| `npm run test:unit` | **exit 0** — 94 files, 1444 passed, 1 skipped, 7.49 s |
| `npx vitest run --project node packages/node/src/slow-specs.node.test.ts` | **exit 0** — 8 tests |
| `npx vitest run --project node` (final) | **exit 0** — 134 files, 1884 passed, 2 skipped |

Every exit code was read with `EXIT=$?` on the line immediately after the command, never
through a pipe, and appended into the log.

## What this does not establish

- **Rule 2 across real `bin/agent.ts` processes.** Deferred item 2. The certificates fabric B
  reads are provider-signed and the relay is real; the executors are not separate processes.
- **A redundant job over a relayed data path.** Deferred item 3, and a design question this
  repository had already opened.
- **That the receipt is displayed anywhere.** 19-10 and 19-11 own that; this file reads
  `ShardResult.attestation` directly.
- **The re-pick after a quorum refusal.** WIRE-04 / Phase 20 criterion 1.
- **`composeQuorum`'s derived strength.** P6 left this file green; the guard is elsewhere.

## One red run, and it was the measurement disturbing the measured

Worth recording because the failure text names a real property of this suite rather than a
defect. A full node run taken **while `git add` was executed in another shell** came back
`1 failed | 133 passed`:

```
FAIL packages/node/src/discover-arm.node.test.ts
AssertionError: expected 'M  .planning/…/deferred-items.md' to be ' M .planning/…/deferred-items.md'
 ❯ packages/node/src/discover-arm.node.test.ts:210  expect(repoStatus()).toBe(before)
```

That spec snapshots `git status --porcelain` around itself to prove the `--discover` arm
writes nothing into the repository. Staging a file mid-run moves a path's porcelain code from
` M ` to `M  `, and the before/after comparison — correctly — reported that the working tree
had changed under it. **Nothing in the tree was wrong; the observer was.** The suite was
re-run with a stable index and passed.

The practical rule, since two plans in this phase have now been executed alongside other
activity on one checkout: **do not touch the index while `--project node` is running.**

## Self-Check: PASSED

- `packages/node/src/quorum-agents.node.test.ts` — FOUND
- `.planning/phases/…/19-08-SUMMARY.md` — FOUND
- `972ff28`, `4cc4d0a`, `203c897` — FOUND in `git log`
- working tree clean after every plant restore (`cp` + `cmp` exit 0, `git status --short` empty)
