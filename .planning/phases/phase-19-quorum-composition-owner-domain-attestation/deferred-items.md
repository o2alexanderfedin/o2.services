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
