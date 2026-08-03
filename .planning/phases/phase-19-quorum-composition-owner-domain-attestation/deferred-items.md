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
