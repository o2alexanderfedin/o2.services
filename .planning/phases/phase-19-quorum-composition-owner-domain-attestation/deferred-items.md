# Phase 19 — deferred items

Things found while executing this phase's plans that were **not** fixed, each with what was
measured and why it was left. Out-of-scope discoveries go here rather than into a diff that
was meant to be readable.

---

## 1. Two tabs that dial each other at the same moment can end up connected but unusable

**Found during:** 19-03, while deciding whether the discovery rounds in
`static-rendezvous.e2e.test.ts` should run concurrently or in sequence.

**What was measured, on three runs of the same code on one host (load ~5–15 of 8 cores):**

| run | firefox ↔ webkit after a simultaneous mutual dial |
|---|---|
| 1 | **failed** — firefox logged *"WebRTC: ICE failed, add a TURN server and see about:webrtc for more details"*; the pair held a `limited` `/p2p-circuit` connection and **no** `/webrtc` connection, and `computePeers()` did not list the peer from either side |
| 2 | succeeded, with **duplicate** connections — 4 per direction (2 limited circuits, 2 `/webrtc`) |
| 3 | succeeded, with duplicate connections again |

Dialled **in sequence**, the same pair connects every time, in four consecutive runs, with
exactly one limited circuit and one unlimited `/webrtc` connection per direction. Chromium
tolerated the simultaneous mutual dial with both of the other engines on all three runs; only
the firefox ↔ webkit pair was observed losing ICE.

**Why it matters beyond the test.** The demo page polls `connectDiscoveredPeers()` on a 4 s
timer, so two tabs that join within one tick of each other *will* dial each other
simultaneously. That is the production shape, not a harness artefact.

**Why a later round cannot repair it.** `runDiscoveryRound` (`demo/main.ts:179-183`) passes
`connected: n.transport.peers` to `planDials`, and `planDials` skips any candidate already in
that set (`dial-plan.ts:66`). A limited circuit puts the peer in `n.transport.peers`. So once
the pair is in the degraded state, every subsequent round filters it out as already connected
and the `/webrtc` upgrade is never retried. This half is read off the source rather than
measured — the one failing run was not driven through a further round before it was diagnosed.

**Two separate things are wrong, and only the second is arguably a defect here.** The ICE loss
under simultaneous negotiation is a browser/`@libp2p/webrtc` behaviour this repository does not
control. What this repository *does* control is that a peer reachable only over a limited
circuit counts as `connected` for the purpose of never dialling it again — so a recoverable
state is latched permanently.

**Why it was left.** Out of scope for 19-03, which is criterion 4 and touches no browser-tier
source. A fix belongs in `planDials`/`runDiscoveryRound` — most likely by treating a peer whose
only connection is `limited` as not-yet-discovered — and it needs its own measured task,
because the obvious version re-dials on every 4 s tick for any peer that is legitimately
relay-only. Not filed against a phase; whoever picks up the browser tier next should read this
first.

**What 19-03 did instead.** Ran its rounds in sequence, which is deterministic, and replaced
the borrowed *"something was attempted"* anti-vacuity reading with an exact one — each round's
attempt count must equal the number of peers that page had not yet discovered when the round
began. That is strictly stronger and does not depend on the racing behaviour above.

---

## 2. `bin/agent.ts` cannot produce a `via-relay` node, so rule 2 has no cross-process reading

**Found during:** 19-08, building the shared-relay fabric its plan specified.

**What was measured.** `bin/agent.ts` declares `port: { type: 'string', default: '0' }` and
passes `listen: ['/ip4/127.0.0.1/tcp/${port}']` to `FabricNode.start` **unconditionally**.
There is no argv that makes that array empty. `fabric-node.ts:1067` derives `canRelay` from
the listen list and `:611-612` derives the certificate's `discoverability`/`relayIds` from
`canRelay`, so **every spawned agent enrols as `discoverability: 'seed'` with `relayIds: []`,
whatever `--relay-addr` it was given**. The binary already says this about itself, in
`--relay-addr`'s own docblock: *"A node that bound nothing would be the browser case, and
this binary has no way to produce one."*

**What it costs.** 19-08's plan said fabric B would be *"agents spawned … with `--relay-addr`
pointing at one relay and no `--port`, so each is `via-relay`"*. That fabric does not exist.
`composeQuorum`'s rule 2 — the shared-relay refusal, and the whole of what survived the anchor
rule's retraction — is therefore measured over **in-process** `FabricNode`s (against a real
spawned provider, so the certificates are still provider-signed) and **not** across real
`bin/agent.ts` processes. Criterion 1's second half is one tier weaker than its first.

**Why it was left.** 19-08's declared files are two test files. Adding a flag to a production
binary's argv surface on the way past a measurement plan is the wrong shape of change, and the
binary's own comment already records that the next phase to touch that `parseArgs` block **with
no other plan behind it** should fold `--owner-id`/`--trust-anchor`/`--owner-key` and the rest
into one flags object rather than accreting a fifth. The via-relay knob belongs in that fold.

**What it would take.** One flag — a `--port none`, a `--no-listen`, or a `listen` list built
conditionally when `--relay-addr` is present and `--port` was not passed (which needs `--port`'s
default removed so "not passed" is distinguishable from `0`). Then fabric B's three executors
become spawned processes and nothing else in `quorum-agents.node.test.ts` changes.

---

## 3. A job does not run over `/p2p-circuit`, and this repository already knew

**Found during:** 19-08, on the first arrangement of the shared-relay fabric — requestor
holding its own reservation and dialling three `/p2p-circuit` addresses.

**What was measured**, instrumented with timestamps on one run: stand-up 793 ms; the peer
gate's third verdict **32.8 s**; that same third peer's first `providers` answer **30.2 s**;
`discoverCandidates` **30.5 s**; the degrade submit **30.0 s**; and the shard came back
`agreed` with **one** replica of the two it placed. Every stall is exactly `rpcTimeoutMs`, and
always on one peer, which then answers normally on the retry. Raising the relay's
`maxReservations` from 8 to 32 — which raises `inboundConnectionThreshold` through
`max(...)` — changed nothing.

**Why it was not chased.** `relayed-job.node.test.ts` records the same wall in its own header:
*"a full redundant job over relayed connections is NOT verified here. Attempting it surfaced a
design problem that needs a fix rather than a test."* And `CLAUDE.md` states the constraint
directly — the relay is a **signalling channel, not a data path**, at 2 minutes and 128 KiB per
connection. Making a redundant job travel it is a design question, not a test fixture.

**What 19-08 did instead.** The executors dial the requestor, so the job travels a direct
connection while the certificates still name the shared relay — which is what rule 2 reads. It
is the recorded Phase 3 shape: *once connected, the peers are indistinguishable*, and the relay
drops out. The three fabrics then run in 8-11 s in isolation.

---

## 4. Every `--discover` run of `bin/bench.ts` loses its first iteration to a 30 s stall

**Found during:** 19-10, while measuring what the driver's new attestation line would read.

**What was measured**, twice, on `node bin/bench.ts --quick --discover` in a temporary `cwd`
on a quiet host (1-minute load ≈ 5–9 of 8 cores), read out of `.planning/bench/raw.json`:

| rung | per-iteration makespan, in order (ms) | `complete` | `incomplete` |
|---|---|---|---|
| real transport, 1 node | **30 044**, 106, 71, 55, 144, 134 | f, f, f, f, t, t | 3 of 5 |
| real transport, 2 nodes | **30 048**, 109, 258, 285, 263, 223 | f, f, f, t, t, t | 2 of 5 |

The first iteration of each real rung takes **exactly `rpcTimeoutMs` (30 000 ms)** and comes
back with a shard that never agreed; iterations 2-3 complete the work in ~100-300 ms but are
still marked incomplete; the rest complete. So a `--discover` run publishes `incomplete: 3`
and `incomplete: 2` where a default run publishes `0` — the figure the driver's own docblock
recorded on 2026-07-31 from a default `--quick` run.

**Same signature as deferred item 3, on a rig with no relay in it.** Exactly `rpcTimeoutMs`,
once, on the first request after a rig is built, then normal service. Item 3 saw it over
`/p2p-circuit`; this is loopback TCP with `admit: rpcAdmission(requestor.rpc)` supplied — the
offer probe is the first RPC the requestor makes to a worker it has just dialled, and it is
the obvious suspect, unverified.

**A second, separate stall in the same runs, and it is larger.** Every real-transport
iteration reports `reduce.ok === false` with `reduceMs: 0`, and each rung spends far longer
than its makespans account for: the 2-node rung took 151 s of wall clock for 31.2 s of
measured jobs on one run and 91 s on another. That gap is the failing reduce leg being
retried, and it is what makes `bench-attestation.node.test.ts` a ~163 s spec rather than a
~15 s one. `.planning/BENCHMARK-RESULTS.md`'s `unmet` list already records that an em dash in
the reduce table means *"that rung produced no reduce at all"*; nobody has measured why on the
`--discover` arm.

**Why it was left.** 19-10's declared files are the driver's printing and a spec that reads
it. Both stalls are **pre-existing** — nothing in this plan touches execution, placement,
dialling or the reduce leg, and the first was reproduced before the attestation line existed.
Chasing either is a design question about the discover arm, not a printing task, and fixing it
inside this plan would have meant changing what the benchmark measures on the way past.

**What 19-10 did instead.** Took the receipt off each rung's **first completed run** — the
same population `@o2/bench`'s `measure` computes `makespan` over — and made the printed line
say which population it came from, so a reading taken off a stalled iteration is
distinguishable from a fabric whose nodes genuinely sign nothing. Without that, both real
rungs read the named absence and criterion 3's CLI half would have scored PARTIAL for a reason
that has nothing to do with attestation.

**What it would take.** Instrument the first `rpcAdmission` offer of a freshly built rig with
timestamps and read where the 30 s goes; separately, run `reduceJob` against a `--discover`
rig and read `reduced.outcome`'s failure. Both are readings, not fixes, and either could be
taken in an afternoon by a plan that owns this driver.

---

## 5. Nothing an operator can run mints a capability chain, so the sovereign discovery path is spec-only

**Found during:** 19-09, closing AUTH-05's consuming half.

**What was measured.** `CandidateOptions.dispatch` was a bare `CapabilitySupplier` handed to
every `RemoteExecutor` `discoverCandidates` builds. A chain's audience is one node's key —
`verifyChain` refuses another's with `wrong-audience`, and `RemoteExecutor`'s own docblock says
so — therefore one supplier could authorise at most one candidate in a set. Since both node
factories install `authorizeCapability`, and it refuses every sovereign task without a valid
chain whether or not an owner key is pinned, **discovery could place no authenticated sovereign
shard at all**. `tsc` was clean and every test was green over that, because every caller in the
repository passes `'dispatches-unauthenticated'` and a public task returns `[]`.

19-09 fixed the seam — `dispatch` is now `(nodeId) => CapabilitySupplier` — and
`owner-domain-agents.node.test.ts` reddens to one agreeing replica when the per-node mint is
reverted to a shared one. So the *mechanism* is closed.

**What is still open, and it is the older finding underneath it.** `remote-executor.ts` already
records that *"every non-test `new RemoteExecutor(` site in the repository dispatches public
work"*, and that is still true of `discoverCandidates`' callers: `bin/bench.ts --discover`
passes the sentinel, and so does every other production site. So the requestor half of AUTH-03
remains **entry-point-unreachable** — `delegate` is called only from specs — and Phase 22's
reachability guard will find it. What changed is that a caller who wanted to mint one now can;
what did not change is that no runnable entry point does.

**Why it was left.** 19-09's declared files are a binary, a spec and two comments. The three
options `remote-executor.ts` already weighed are unchanged: giving `bin/bench.ts` a sovereign
leg alters what the benchmark measures, the demo has no owner private key to root a chain at,
and inventing a fourth entry point is a phase, not a plan.

**What it would take.** An entry point that holds an owner's private key and labels a shard
`sovereign` — which is the same missing piece `SCHED-05`'s ledger row names, from the placement
side rather than the dispatch side. The two are one gap seen from two ends and should close
together.

---

## 6. `owner-domain` is computed everywhere and displayed nowhere — filed by 19-11

**Measured 2026-08-03, on both display surfaces.** `classifyAttestation`'s middle label is the
one VER-10's first clause is *about* — *"owner-domain quorum agreement is reported as a
distinct, weaker claim than independent-operator agreement"* — and after this phase gave the
label two display sites, **neither of them can ever show it**:

- **The CLI.** 19-10 recorded it: no rung of `bin/bench.ts` produces two nodes under one
  operator, because every `--discover` worker enrols with a distinct `operatorId`.
- **The demo UI.** Same shape for a different reason: the page builds one descriptor per
  executor and every node it can reach is either this tab or a peer with its own identity, so a
  two-replica cube is either two operators or one unaccounted replica. There is no demo topology
  that puts two of *one owner's* nodes in a job.

The label is read today only off `ShardResult`, in `packages/node/src/quorum-agents.node.test.ts`.
So the distinction VER-10 requires is established in a spec and has never been put in front of a
reader — which is the *built, not wired* condition this milestone exists to remove, one level up
from the mechanism.

**Not closed here, and the reason is that closing it is a topology change rather than a display
change.** It needs an entry point that runs two nodes under one `operatorId` and displays the
result: a second `--discover` worker enrolled under the first's operator on the CLI, or a demo
peer that shares this tab's operator id. Both alter what an existing surface measures, which is
the thing a display plan must not do.

**Both VER-09 and VER-10 stay unticked**, and their rows now name this and the sovereign-path
gap by name rather than by plan number.

## 7. No visitor path enrols, so every real visitor's receipt is the named absence — filed by 19-11

**This is honest rather than broken, and it is filed because it is easy to misread as broken.**
`TabApi.start` now takes an `enrollment` option and the demo threads it through, but
`autoStart` — the only thing the page's own Start button calls — passes none, deliberately, for
the reason it passes no `trustAnchors`: *a page that was found rather than configured must not
be configurable by whatever found it.* And the demo has no provider to enrol with in any case.

So a visitor opening the published page holds no certificate, has no anchor to check a peer
against, and reads the named absence on every run — correctly. The label a real visitor sees is
*"nothing established"*, and `owner-attested` is reachable today only from a harness that supplies
a provider address.

**What it would take**, and it is a deployment question rather than a code one: a provider a
visitor could reach, and a decision about whether `/bootstrap.json` may carry its address — which
is the same *"who may configure a page that was found"* question `autoStart` answers no to today.
Worth deciding deliberately; not worth deciding inside a display plan.
