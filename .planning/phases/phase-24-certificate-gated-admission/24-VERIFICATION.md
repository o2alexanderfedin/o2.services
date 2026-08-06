---
phase: phase-24-certificate-gated-admission
verified: 2026-08-06T21:55:21Z
status: gaps_found
score: 0/1 criteria MET — criterion 8 verifies PARTIAL
criteria_count: 1
criterion_label: 8
overrides_applied: 0
verifier_reruns:
  - command: "npx vitest run --project node admission-agents.node.test.ts"
    exit: 0
    result: "6 tests, real 36.52, ratio 0.98"
  - command: "npm run test:mutations -- --only=M66"
    exit: 0
    result: "M66 PASS caught, 8.4s, exit 1 with the recorded signature; git status --porcelain empty after"
  - command: "npx vitest run --project node enrolment-residual.node.test.ts --reporter=verbose"
    exit: 0
    result: "perFreshIdentity 3.089518678852023, perReplay 9576.831998048683"
  - command: "npx vitest run --project node enrol-through-a-closed-door.node.test.ts --reporter=verbose"
    exit: 0
    result: "[revocation] ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049"
  - command: "npx vitest run --project node relay-admission.node.test.ts"
    exit: 0
    result: "33 tests"
  - command: "npx vitest run --project e2e gated-admission.e2e.test.ts"
    exit: 0
    result: "4 tests, chromium + firefox + webkit, real 24.96"
  - command: "npx vitest run --project node"
    exit: 0
    result: "164 files, 2305 passed, 2 skipped, real 237.06, ratio 1.85"
  - command: "npx tsc --noEmit"
    exit: 0
    result: "zero output"
gaps:
  - truth: "A node that cannot present a provider-issued certificate cannot join the fabric"
    status: partial
    reason: >-
      Measured true of a relay that pins issuers; measured FALSE of the fabric, by the
      phase's own instrument, twice in one run. In the verifier's own re-run the
      in-process reader — which is handed no `enrollment` option and therefore holds no
      certificate at all — appears in the open provider's reservation store
      (`openProviderHolds` contains `12D3KooWA5ixizRx…`, which is `reader`). The
      difference between `stranger` (out) and `reader` (in) is not the certificate; it
      is which peers each happened to dial. A property that holds for one uncertificated
      node and fails for another on a difference that is not the certificate is not a
      property of the certificate.
    artifacts:
      - path: "packages/node/src/seed-server.ts"
        issue: >-
          `relayAdmission: 'admits-any-peer'` is hardcoded at the `FabricNode.start` call
          and `SeedServerOptions` carries no field that can change it. The seed — the
          relay every browser tab reserves on — is structurally un-closable, not merely
          left open by deployment choice.
      - path: "packages/node/src/bin/seed.ts"
        issue: "No `--admit-issuer`. `--trusted-issuer` threads to `trustedIssuers` (selection), never to `relayAdmission`."
    missing:
      - "A way to tell a seed which issuers it admits (`SeedServerOptions.relayAdmission` + `bin/seed.ts --admit-issuer`), or an owner ruling that the seed stays open and the criterion is re-scoped to a relay."
      - "A reading of the criterion over a fabric in which every relay-capable peer an unadmitted node can reach has been told to close."
  - truth: "A node that cannot present a provider-issued certificate cannot advertise itself"
    status: partial
    reason: >-
      Read on one of the two advertisement surfaces the phase's own context named as
      load-bearing. `fabric-node.ts`'s `reservations` thunk is read over the wire with a
      paired presence, and it is genuinely read. `BootstrapInfo.peerAddrs` is not read by
      any test in the repository as a gated surface (`grep peerAddrs packages/node/src/*.test.ts`
      returns only `seed-discovery.e2e.test.ts`, which asserts address shape), and it
      cannot be one today. The unread surface is the one the browser tier actually
      consumes: `packages/browser/demo/main.ts` reads `info.peerAddrs` and pushes every
      entry as a dial candidate. Unmeasured is not met.
    artifacts:
      - path: "packages/node/src/seed-server.ts"
        issue: "`BootstrapInfo.peerAddrs` is `[seedAddr, ...node.reservedPeerIds.map(...)]` on a node whose posture is hardcoded open, so an uncertificated reserver is advertised there by construction."
    missing:
      - "A gateable seed, then a reading of `BootstrapInfo.peerAddrs` with a paired presence and absence."
  - truth: "The N-th identity costs an attacker a provider's willingness to sign it"
    status: partial
    reason: >-
      The counted half is delivered and reproduced: three full issuances for three askers
      against zero reservations, and the ratio arm confirms the provider's refusal
      economics are where Phase 19 left them (verifier's own reading 3.0895, inside the
      2.96–3.16 band). But the clause is a claim about what the attacker must OBTAIN, and
      on the measured tree the attacker does not need a provider's willingness to sign:
      the reader obtained a reservation holding no signature at all. The clause is MET at
      a gated relay and PARTIAL over the fabric, on exactly the bound above.
    artifacts:
      - path: "packages/node/src/enrolment-residual.node.test.ts"
        issue: "Correct and load-bearing; the limit is scope, not the instrument."
    missing:
      - "The same reading taken over a fabric with no open relay-capable peer reachable by the unadmitted node."
warnings:
  - id: W1
    file: "packages/node/src/fabric-node.ts"
    symbol: "FabricNodeOptions.relayAdmission docblock"
    issue: >-
      States "Nothing reads this yet… No `connectionGater` is constructed below…
      every construction site in this repository writes `'admits-any-peer'`". All three
      clauses are false in this same file: `relayAdmissionGate({ admission: options.relayAdmission … })`
      reads it, `connectionGater: { denyInboundRelayReservation: gate }` is spread into
      `createLibp2p` ~1200 lines below, and `bin/agent.ts` writes `new Set(values['admit-issuer'])`.
  - id: W2
    file: "packages/libp2p/src/relay-admission.ts"
    symbol: "module docblock; admitsAnyPeer docblock"
    issue: >-
      Section headed "Consulted by nothing"; "No `ConnectionGater` is constructed anywhere
      in this repository except `browser-node.ts`'s"; "**Nothing calls this yet**";
      "Two things that rests on are MEASUREMENTS not yet taken". All four are now false —
      24-03 armed the gate and took both measurements.
  - id: W3
    file: "packages/node/src/admission-agents.node.test.ts; 24-04-SUMMARY.md; proposed AUTH-02 row"
    symbol: "Budget section — 'Five child processes plus one in-process reader'"
    issue: >-
      Measured SIX. `spawnAgent` is called for `provider`, `other-provider`, `relay`, and
      three times through `joinFabric` (`member`, `stranger`, `outsider`). The same file
      calls the reader "a seventh child" it did not spawn, which is consistent with six.
      The wrong count propagates into the ledger row text as "Measured across five real
      `bin/agent.ts` processes" and must be corrected before that row lands.
  - id: W4
    file: ".planning/ROADMAP.md"
    symbol: "progress table row 24"
    issue: "Reads `1/4 | In Progress — 24-01 landed, 24-02/03/04 amended and ready`. All four plans landed (753d298)."
  - id: W5
    file: ".planning/ROADMAP.md"
    symbol: "Phase 24 `**Mode:** mvp`"
    issue: >-
      The phase goal is not a User Story and cannot be verified under MVP-mode's User Flow
      Coverage contract. Verified under the standard goal-backward methodology instead, on
      the parent instruction's explicit direction. The label should be removed or the goal
      restated; it is a metadata mismatch, not a defect in the work.
human_verification:
  - test: "Rule on whether the seed may be told which issuers it admits."
    expected: >-
      Either `SeedServerOptions.relayAdmission` + `bin/seed.ts --admit-issuer` are added
      and criterion 8 is re-read over a fully-gated fabric, or the owner rules that the
      seed stays open and criterion 8 is restated as a property of a relay. RULING A
      forbids the verifier taking the second route on its own.
    why_human: "It is an owner ruling — 24-CONTEXT's open ruling 1 and 24-01's deliberate deferral both route it here."
  - test: "Land the two requirement-row texts 24-04 wrote, reverted, and carried verbatim."
    expected: "AUTH-02 and AUTH-04 rows appended as recommended below, with the corrections named. Neither checkbox moves."
    why_human: "A verifier may not apply the ledger edits it recommends."
  - test: "Decide whether Phase 22 still runs after Phase 24 given criterion 8 verified PARTIAL."
    expected: >-
      Owner ruling 2026-08-05 set the order 23 → 24 → 22 so that the reachability guard
      would certify a gated fabric. It will now certify a fabric gated at agent relays and
      open at every seed. The escape hatch in that ruling — 22-VERIFICATION.md states
      plainly what it covered — applies in a form the ruling did not anticipate.
    why_human: "Scheduling ruling, and the premise it rested on moved."
deferred:
  - truth: "The browser tier pins nobody and reaches no verdict about a peer"
    addressed_in: "Phase 22"
    evidence: "DEFICIENCIES.md D09; 24-03 and 24-04 both name Phase 22 as the owner of the `PeerVerifier` move."
  - truth: "`records` / `providers` answers are gated on the certificate"
    addressed_in: "Not scheduled — filed as a deferred idea"
    evidence: "24-CONTEXT.md `<deferred>`: 'Gating `records` / `providers` answers on the certificate… closing it is a new decision.' Recorded here so it is not read as covered."
---

# Phase 24: Certificate-Gated Admission — Verification Report

**Phase Goal:** The network's front door is locked — a node that cannot present a
provider-issued certificate cannot reserve a circuit, be advertised, or be dialled, so an
identity that was never issued buys nothing

**Criterion:** exactly one, numbered **8**, carried from Phase 19 by owner ruling
2026-08-04. **This report scores out of 1, not out of 8.**

**Verified:** 2026-08-06T21:55:21Z, at `753d298`, working tree clean
**Status:** gaps_found — criterion 8 verifies **PARTIAL**
**Re-verification:** No — initial verification

---

## Criterion 8, quoted

> *"Enrolment's cost is bounded by admission, not by a counter: a node that cannot present
> a provider-issued certificate cannot join the fabric, advertise itself, or be dialled by
> another node — so an identity that was never issued buys nothing, and the N-th identity
> costs an attacker a provider's willingness to sign it"*

## Verdict

| | |
|---|---|
| **Criterion 8** | **PARTIAL** |
| Score | **0 / 1 MET** |
| Phase | **gaps_found** — the mechanism is real and measured; the criterion's own words are wider than the evidence |

Not NOT MET. The gate exists, is wired into the production path, refuses and admits by
certificate across six real operating-system processes and three browser engines, is caught
by a mutation the verifier ran itself, and the residual it does not remove is measured and
published as unchanged. Nothing here is decoration.

Not MET. The criterion says *"cannot join the fabric"*. The evidence says *"cannot join a
relay that has been told to close"*. That gap is not hypothetical — it was demonstrated
twice in a single run, once by accident, by the phase's own instrument, and one of the two
open surfaces is **structurally un-closable** and is the one the browser tier uses.

**RULING A applies to this phase as it applied to the two that fed it.** Criterion 8 is
itself the destination of Phase 17's criterion 3 and Phase 19's criterion 5. Its own
destination — admission as a property of the fabric rather than of a relay — has not
landed. A criterion is not rewritten to let a phase close.

---

## What the verifier ran, and read directly

Every exit code below was captured with `EXIT=$?` on the line immediately following the
command, no pipes and no trailing filter.

| Command | Exit | Result | Process reading |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | zero output | — |
| `npx vitest run --project node` | **0** | **164 files, 2305 passed, 2 skipped** | `real 237.06 user 384.34 sys 54.01`, ratio **1.85** |
| `npx vitest run --project node admission-agents.node.test.ts` | **0** | 6 tests | `real 36.52 user 30.59 sys 4.99`, ratio **0.98** |
| `npx vitest run --project node enrol-through-a-closed-door.node.test.ts` | **0** | 5 tests | — |
| `npx vitest run --project node enrolment-residual.node.test.ts` | **0** | 4 tests | `real 8.34` |
| `npx vitest run --project node relay-admission.node.test.ts` | **0** | 33 tests | `real 12.84` |
| `npx vitest run --project node acceptance-traceability requirements-ledger` | **0** | 61 tests | `real 1.32` |
| `npx vitest run --project e2e gated-admission.e2e.test.ts` | **0** | 4 tests, three engines | `real 24.96` |
| `npm run test:mutations -- --only=M66` | **0** | **M66 caught**, 8.4 s | tree restored, `git status --porcelain` empty |

24-04 recorded the full node project at ratio **1.79**; this run reads **1.85** on a host at
1-minute load 5.92. The two readings are comparable rather than merely both green.

**24-02's pre-gate baseline re-read byte-identical for the fourth time**, inside the full
run: `room-for-everyone {connected 4, granted 3, advertised 3}` and
`room-for-all-but-one {connected 4, granted 2, advertised 2}`.

---

## Goal Achievement — clause by clause

| # | Clause | Status | Evidence the verifier took itself |
|---|---|---|---|
| 1 | cannot **join** the fabric | **PARTIAL** | True of a gated relay; false of the fabric — see §1 |
| 2 | cannot **advertise** itself | **PARTIAL** | One of two surfaces read; the other is un-gateable — see §2 |
| 3 | cannot **be dialled** by another node | **VERIFIED, bounded** | Method sound; inherits clause 2's surface bound — see §3 |
| 4 | an identity never issued **buys nothing** | **PARTIAL** | 3 issuances / 0 reservations at the gate; the reader bought a reservation with no identity at all — §1, §4 |
| 5 | the N-th identity costs a provider's **willingness to sign** | **PARTIAL** | Residual unchanged and correctly read; the attacker does not need the signature — §4 |

**Score: 0/1 criteria MET.** The count is over criteria, never over clauses; the clause
table above is the reasoning, not the score.

---

## §1 — The scoping finding. Adjudicated: it is a real bound, and it is wider than 24-04 states

**24-04's claim, verified TRUE and reproduced by the verifier.** From my own run of
`admission-agents.node.test.ts`:

```
gatedRelayPosture : ["9fa7dafb1c2d8cb2…"]                       (closed)
provider.posture  : "admits-any-peer"    otherProvider.posture : "admits-any-peer"
gatedRelayHolds   : [ member ]
openProviderHolds : [ outsider , reader ]
stranger.relays   : []
```

`--provider-addr` forces a direct dial; libp2p's `RelayDiscovery` fires identify at any peer
speaking HOP; a `bin/agent.ts --port` without `--admit-issuer` is relay-capable and admits
everybody. The joiner the gate refused reserves **there**. Confirmed at the source:
`node_modules/@libp2p/circuit-relay-v2/dist/src/server/index.js` calls
`connectionGater.denyInboundRelayReservation?.(connection.remotePeer)` and writes
`PERMISSION_DENIED` on `=== true` — per-relay by construction, exactly as 24-CONTEXT chose.

**Where the verifier parts company with 24-04.** 24-04 argues that criterion 8's subject is
*"a node that cannot present a provider-issued certificate"*, that `stranger` is that node,
that `stranger` is nowhere, and therefore *"the clause holds"* — only *"cannot join the
fabric"* may not be read as a property of the fabric.

That defence does not survive its own instrument. **`reader` is also that node.** It is
constructed with no `enrollment` option, holds no certificate, was refused by the gated
relay — and its peer id is the second entry in `openProviderHolds`. The file says so itself
and names it so the entry is attributable. So in one run, two nodes that cannot present a
provider-issued certificate were both subjects of the clause, and they got opposite answers.
The difference between them is **not the certificate**; it is which peers each happened to
dial. A property that holds for one uncertificated node and fails for another on a
difference that is not the certificate is not a property of the certificate — it is a
property of the topology the node walked into.

**And the bound is structural, not a deployment choice.** 24-04 states the open set as
*"every `bin/agent.ts --port` without `--admit-issuer` and every `bin/seed.ts`"*, which is
correct, but the two are not the same kind of fact:

| Surface | Can be closed? | Checked |
|---|---|---|
| `bin/agent.ts --port` | **Yes** — `--admit-issuer`, hex-validated, `relayAdmission: … new Set(values['admit-issuer'])` | `bin/agent.ts`, verified by grep and by `relay-admission.node.test.ts` |
| `bin/seed.ts` | **No.** No flag exists. `SeedServerOptions` has no field. `seed-server.ts` writes `relayAdmission: 'admits-any-peer'` at the `FabricNode.start` call | verified by grep at both files |

The seed is the relay **every browser tab in this fabric reserves on** — `demo/main.ts`
discovers relays from `/o2-info` and peers from the seed's `/bootstrap.json`. So the one
relay the browser tier actually joins through cannot be told to close, and 24-01 recorded
that as deliberate: *"Pinning it is a later decision and is deliberately not taken here."*

**Ruling.** Clause 1 **passes with a stated bound at the relay, and is PARTIAL at the
criterion's own wording.** "Pass-with-a-stated-bound" would be the right disposition if the
bound were a deployment posture an operator can remove. It is not: for the seed there is no
knob, and under RULING A the criterion is not narrowed to fit. The honest report is PARTIAL,
with the mechanism recorded as delivered.

This is not a defect of the gate and not a failure of 24-04, which **found** the bound its
own plan did not anticipate, published it in the summary, in the test file's header before
the readings rather than after, and in the requirement-row text it drafted. That is the
behaviour this project asks for. The disagreement is only about what the criterion may then
be scored as.

---

## §2 — `BootstrapInfo.peerAddrs`: the "advertise itself" clause is read on one surface of two

**24-04 reports this as UNMEASURED. Verified, and it is stronger than unmeasured — it is
un-measurable today.**

24-CONTEXT's argument for putting the gate at the reservation was that *"both advertisement
surfaces are derived from `reservedPeerIds`… no filter to add, no `if` to forget."* That is
structurally true **per relay**. It stops being an argument about the fabric the moment one
of the two relays cannot be closed.

| Surface | Derived from | Read as a gated surface? |
|---|---|---|
| `fabric-node.ts` `reservations: () => node.reservedPeerIds` | the gated relay's store | **Yes** — over the wire, via the production `findReservedPeers` request shape, paired presence and absence in one run, plant-separated from clause 1 |
| `seed-server.ts` `BootstrapInfo.peerAddrs` | the **seed's** store, posture hardcoded open | **No** |

Checked: `grep -rln peerAddrs packages/node/src/*.test.ts` returns exactly one file,
`seed-discovery.e2e.test.ts`, whose only assertion on it is
`expect(info.peerAddrs[0]).toBe(info.relayAddrs[0])` — address shape, not admission. No test
anywhere reads that surface as a gated one.

And it is the surface that matters at the tier the phase claims: `packages/browser/demo/main.ts`
reads `info.peerAddrs` and pushes every string it finds into its dial candidates. A browser
tab's peer discovery today runs through the one advertisement surface the clause was not
read on, on a relay that cannot refuse anybody.

**Ruling.** The clause is **genuinely read on one surface** — the reading is real, is over
the wire, is paired, and 24-04's plant 2 separates it from clause 1. It is **not read on the
other**, and the phase's own justification for gating at the reservation depended on both.
*Unmeasured is not met.* Clause 2 is PARTIAL.

**24-04's re-targeting of plant (b) was correct.** The plan's plant named `seed-server.ts`;
the adapted plant widens `fabric-node.ts`'s `reservations` thunk to
`[...reservedPeerIds, ...transport.peers]` and delivers exactly the demonstration the plan
asked for. The re-target is a repair, not an evasion. What it cannot do is convert one
surface into two.

---

## §3 — The three clauses and their instruments. The repair is real; clause 3's method is sound

### The repair — clause 1 and clause 2 can now fail alone

24-04 reports that clause 1 was first written against the relay's reservation store, which
**is the same list clause 2 reads**, and that it repaired this after a plant reddened both.
Verified at the source rather than taken from the summary:

| clause | instrument, by symbol | where the value comes from |
|---|---|---|
| 1 | `circuitsThrough(stranger, relay.peerId)`, `stranger.relays`, `stranger.stderr()` | the **refused process's own** JSON handshake line on its stdout, plus its stderr |
| 2 | `advertisedBy(reader, relay.peerId)` | an over-the-wire `reservations` request answered by the relay from `() => node.reservedPeerIds` |
| 3 | routes derived from clause 2's answer, then a real `reader.dial(...)` | clause 2's list + the transport |

`Handshake.relays` is parsed out of the child's own first stdout line in `spawnAgent`. **No
mutation of the relay's `reservations` thunk can touch it.** So clause 1 can stay green while
clause 2 reddens — which is what 24-04's plant 2 observed, and which the code structure now
makes necessary rather than lucky. The repair is genuine.

Clause 3 does ride on clause 2's list, and the file says so in its own header rather than
inventing a third instrument that would have been the same list under a new name. That
grouping is disclosed, correct, and the honest shape of the mechanism.

### Clause 3's method — is reading derived routes rather than dialling sound?

**Yes, and it is the stronger reading.** The argument turns on the project's own standing
rule that *a duration equal to a timeout is evidence of the timeout*. Had clause 3 attempted
a dial to the unadmitted arm and asserted on its failure, the assertion would have been a
timeout, and a timeout is compatible with "the peer is momentarily busy", "the route is slow"
and "the instrument's budget was too short" as readily as with "there is no route".

The phase has a live instance of exactly that failure inside itself: 24-04's finding 4
records plant 1 producing `timed out waiting for the refused agent to name its refusal on
stderr` at **62 499 ms against a 60 000 ms budget** — a reading of the clock, not of the
fabric — until the case was reordered, after which the same plant reddened in **2 424 ms**
naming the fact.

What clause 3 asserts instead is a **process**: the reader's only address source is the
relay's answer; `routesTo(stranger.peerId)` is `[]` so nothing is attempted; `routesTo(member.peerId)`
has one entry and the reader dials it and reaches the member. Then the limit is asserted in
the same run rather than around it — handed the refused node's **direct** address, the reader
reaches it immediately. That last line is a standing assertion on every green, which is
strictly stronger than 24-04's plan's proposal to demonstrate it once as a plant.

The claim clause 3 therefore carries is *the refused node is **unfindable**, not
unreachable* — and the file says so before the readings rather than after. That is the
correct and the honest claim. **The method is sound.** Its bound is clause 2's: it is
unfindable through the gated relay's advertisement, and the second advertisement surface was
not read.

---

## §4 — The residual, re-read by the verifier

| reading | 24-04 (2026-08-06, load 3.44) | **verifier's own re-run** (load 5.92) | Phase 19's band |
|---|---|---|---|
| refuse-over-mint | 3.070 | **3.0895** | 2.96–3.16, nine readings — **INSIDE** |
| refuse-over-replay | 9 351 | **9 576.8** | 3 758–7 501 — **ABOVE** |

**refuse-over-mint is UNCHANGED, and now on two independent readings taken at different host
loads.** Phase 19's economics survive on a tree where the gate exists and is armed, which is
the whole point of taking the reading and is correctly reported.

**refuse-over-replay: the "clock resolution, not the code" explanation is accepted.**
`enrollment-dos.node.test.ts` records its replay denominator sitting at 0.5–0.75 µs — a
couple of `performance.now()` ticks — so the quotient is floored by the clock and every
reading of it *understates*. My reading moved the same direction on a *busier* host, which
is consistent with a denominator pinned at the tick and a numerator that is real work.
Reading either number as increased exposure would be reading the clock. **Neither reading is
evidence of a regression, and neither is evidence of an improvement.**

**The counted half is the load-bearing one, and it holds.** Verified by running the file:
`issues one certificate per asker even while refusing every one of them a reservation` —
three askers, `issued.length === 3` against `door.issuerKey`, and none of the three in
`door.reservedPeerIds`. Three full issuances, zero reservations. Counts need no calibration
and this one is right.

**Does clause 5 pass on this?** *"The N-th identity costs an attacker a provider's willingness
to sign it"* is a claim about **what the attacker must obtain**. At the gated relay it is
true: a signature from the wrong provider bought nothing and a missing one bought nothing.
Across the fabric it is false in the same run: `reader` obtained a reservation, an
advertisement and a dialable route holding **no signature of any kind**. So clause 5 is
**PARTIAL on precisely the bound in §1** — it would be MET on a fully-gated deployment, and
this repository is not one and cannot be made one for the seed.

The phase is right that it *devalued* the identity rather than pricing it, and right that the
DoS surface is untouched and must not be read as shrunk. Both are correctly stated in the
drafted AUTH-04 row.

---

## §5 — The two load-bearing measurements 24-03 took. Both CONFIRMED

Run by the verifier, `--reporter=verbose`, exit 0:

**(i) Renewal DOES re-consult the gater.**

```
[revocation] ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049
```

24-03 reported 30 027 ms / 40 028 ms against a 40 000 ms TTL. Mine: **30 031 / 40 049**.
Confirmed. The refused renewal never resets the server's timer, so the entry runs out on its
original clock. **The revocation window is the reservation TTL, as a number.**

The 30 s floor is confirmed **at the installed package**, not by inspection of a comment:
`node_modules/@libp2p/circuit-relay-v2/dist/src/transport/reservation-store.js` holds
`const REFRESH_TIMEOUT_MIN = 30 * 1000` and
`Math.min(Math.max(expiration - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)`. So for
any TTL under five minutes the clamp wins, and below ~30 s a reservation expires before its
holder ever tries to renew — that is churn, not revocation. Also confirmed:
`DEFAULT_RESERVATION_COMPLETION_TIMEOUT = 5_000`, which is what the gate's 3 500 ms budget is
sited against. Sited, not chosen — correctly.

**(ii) A refused peer never retries by itself.** The case `does not retry a refused
reservation on its own, and reconnecting is what gets the peer in` ran green in 15 113 ms.
Confirmed. libp2p arms its refresh timer only inside the success path, so a failed
reservation leaves no timer.

**Is the revocation window acceptable, or a recorded residual?** It is a **recorded residual,
and it is correctly recorded.** The number is written at `FabricNodeOptions.reservationTtlMs`'s
docblock — a field that had none — subject first, then the window, which is where a
deployment reads it. The bound is real and stated: an operator who wants a shorter revocation
window can shorten the TTL down to about 30 s and no further, and below that they get churn
rather than revocation. That is a genuine limit of the mechanism, it is not this phase's to
remove (a connection-level re-check is the fabric-wide behaviour change sub-decision 3 rules
out), and 24-CONTEXT's open ruling 3 — which asked what to do *if renewals did not re-consult* —
is answered and closed by the measurement: they do.

The residual worth naming beside it, and it is named in the source: the gate's own
`admissionDecisions` reasons **have no wire surface**. Verified in my own run — the two
distinct sentences exist in-process, and 24-04's `admission-agents` case asserts that both
refused agents' stderr lines are the identical undifferentiated `PERMISSION_DENIED`. Filed,
not fixed, correctly: fixing it is a mechanism change and 24-04 grades the mechanism.

---

## §6 — Defect #55. CLOSED, and the resolution is TRUE

`BrowserNodeOptions.startReporting`'s docblock argued its shape *"on the same ground as …
`FabricNodeOptions.relayAdmission`"* while `BrowserNodeOptions` has no such field.

**Resolved**, and the resolution is verified rather than accepted:

- `grep -rn circuitRelayServer packages/browser/src/` returns **two hits, both inside
  comments** — the `browser-node.ts` paragraph that states the fact, and an unrelated mention
  in `tab-api.ts`. **No import.** The single import at `browser-node.ts` is
  `import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'`.
- So a `BrowserNode` runs no relay server, grants no reservation, and **has no reservation to
  gate**. The absence is topology, not tier. **The resolution is TRUE.**
- The docblock says plainly that *it is not what carries the claim* — "a sentence is not
  executable and no mutation of it can redden anything" — and names what does: the gater
  census in `relay-admission.node.test.ts`, which requires this file to contain
  `denyDialMultiaddr` and must **not** contain the reservation-deny method. That census ran
  green here (33 cases), and 24-03's plant 5 was watched **red with the door open**
  (`expected [ Array(1) ] to include 'packages/node/src/fabric-node.ts'`), which is the
  inverted-tripwire property defect #51 was about.

Correctly closed, correctly argued, and the machine-checked half is where it is claimed to be.

---

## Required Artifacts

| Artifact | Expected | Status | Detail |
|---|---|---|---|
| `packages/libp2p/src/relay-admission.ts` | the named union, one place that decides its meaning | ✓ VERIFIED, **docblock stale (W2)** | `RelayAdmission`, `ADMITS_ANY_PEER`, `admitsAnyPeer` all exported and consumed |
| `packages/node/src/fabric-node.ts` — `relayAdmissionGate` | module-level factory, constructible with no relay | ✓ VERIFIED | returns `undefined` for the open posture; every path out is a decision; out-of-budget refuses; unknown posture refuses |
| `packages/node/src/fabric-node.ts` — gater wiring | `connectionGater` on `createLibp2p`, not in `circuitRelayServer` | ✓ VERIFIED | `...(gate === undefined ? {} : { connectionGater: { denyInboundRelayReservation: gate } })`; `circuitRelayServer` still capacity-only, and that is now a pinned protected property |
| `FabricNode.admissionDecisions` | bounded record of every verdict | ✓ VERIFIED | read by three cases and two fixtures; verifier read all three reasons live |
| `bin/agent.ts --admit-issuer` | hex-validated, repeatable, posture on the handshake line | ✓ VERIFIED | `relayAdmission: values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(...)`; posture published as a sorted array |
| `SeedServerOptions.trustedIssuers` / `bin/seed.ts --trusted-issuer` | selection, distinct from `--trust-anchor` | ✓ VERIFIED | threaded to `trustedIssuers`, never to `relayAdmission` — the conflation the field exists to prevent |
| **seed-side admission** | — | ✗ **ABSENT** | no `SeedServerOptions.relayAdmission`, no `bin/seed.ts --admit-issuer`; posture hardcoded open. This is gap G1's mechanism |
| `packages/node/src/admission-agents.node.test.ts` | the three clauses across real processes | ✓ VERIFIED | 6 cases green; **six** child processes, not five (W3) |
| `packages/node/src/gated-admission.e2e.test.ts` | browser tier, co-located topology | ✓ VERIFIED | 4 cases, chromium + firefox + webkit, real `FabricNode` door pinning its own issuer, same tab id absent-then-present |
| `packages/node/src/enrolment-residual.node.test.ts` | the residual, both directions planted | ✓ VERIFIED | 4 cases; ratios reproduced; M66 registered and caught |
| `packages/node/src/enrol-through-a-closed-door.node.test.ts` | the hinge and the two revocation questions | ✓ VERIFIED | 5 cases; both measurements reproduced |
| `packages/node/src/relay-admission.node.test.ts` | census + inverted tripwire | ✓ VERIFIED | 33 cases; `shuts the door at at least one production site, and names which` |
| `packages/node/src/bench-admission.node.test.ts` | pre-gate baseline | ✓ VERIFIED | byte-identical for the fourth time inside the verifier's own full run |
| `mutation-ledger.ts` M66 | the gate's own verdict | ✓ VERIFIED | ran it: **caught**, exit 1 with the recorded signature, tree restored |

## Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `FabricNodeOptions.relayAdmission` | `relayAdmissionGate` | `admission: options.relayAdmission` | ✓ WIRED |
| `relayAdmissionGate` | `createLibp2p` | conditional spread of `connectionGater.denyInboundRelayReservation` | ✓ WIRED |
| gate | `@libp2p/circuit-relay-v2` server | `denyInboundRelayReservation?.(remotePeer) === true` → `PERMISSION_DENIED` | ✓ WIRED — read off the installed artifact |
| gate | joining peer | `rpc.request(peerId, { kind: 'records' })` with 700 ms budget, retried | ✓ WIRED |
| gate | `verifyCertificate` | `verifyCertificate(certificate, issuers, Date.now())` | ✓ WIRED |
| gate | `FabricNode.admissionDecisions` | `onDecision` → bounded `admissionLog` | ✓ WIRED |
| `bin/agent.ts --admit-issuer` | `relayAdmission` | ternary at the construction site | ✓ WIRED |
| `SeedServerOptions` | `relayAdmission` | — | ✗ **NOT WIRED, by decision** — gap G1 |
| gated relay's store | `BootstrapInfo.peerAddrs` | — | ✗ **NOT GATEABLE** — gap G2 |
| relay-side refusal reason | the wire | — | ✗ **NO SURFACE** — disclosed, filed not fixed |

## Data-Flow Trace

| Artifact | Value | Source | Real data? | Status |
|---|---|---|---|---|
| `admissionDecisions` | live verdicts | the gate's `onDecision` | **yes** — verifier read all three reasons with real peer ids, attempts 1/2/2, ms 3/806/813 | ✓ FLOWING |
| `reservations` answer | `node.reservedPeerIds` | the relay's live store, over the wire | **yes** — `[member]` only, with reader/stranger/outsider/relay all absent | ✓ FLOWING |
| `stranger.relays` | `[]` | the child process's own stdout | **yes** — parsed from a real handshake line | ✓ FLOWING |
| tab reservation state | `door.reservedPeerIds` | live `FabricNode` beside three real browsers | **yes** | ✓ FLOWING |
| `BootstrapInfo.peerAddrs` | seed's reservation store | un-gated seed | flows, but **carries uncertificated peers by construction** | ⚠️ see G2 |

## Anti-Patterns

| Scan | Result |
|---|---|
| `TBD` / `FIXME` / `XXX` across all 17 files this phase touched | **none** — no debt-marker gate fires |
| `TODO` / `HACK` / `PLACEHOLDER` / "not yet implemented" | **none** |
| Stub returns, hardcoded empties on a render path | **none** — every asserted value is read from a live node, a real process's stdout, a live tab, or a file's own source |
| **Stale comment contradicting the code in the same file** | **two, W1 and W2** — see below |

### W1 — `fabric-node.ts`, `FabricNodeOptions.relayAdmission` docblock

> *"**Nothing reads this yet, and that is a property of this wave rather than an oversight.**
> No `connectionGater` is constructed below, `circuitRelayServer`'s arguments are unchanged,
> and every construction site in this repository writes `'admits-any-peer'`"*

Three of those four clauses are false **in this same file**: the option is read by
`relayAdmissionGate`, a `connectionGater` *is* constructed below, and `bin/agent.ts` writes a
pinned `Set`. Only the `circuitRelayServer` clause survives. A reader of `FabricNodeOptions` —
which is the interface every one of the 70 construction sites reads — is told the mechanism
this phase exists to build is inert.

### W2 — `packages/libp2p/src/relay-admission.ts` module docblock

Section headed **"Consulted by nothing"**; *"No `ConnectionGater` is constructed anywhere in
this repository except `browser-node.ts`'s"*; on `admitsAnyPeer`, *"**Nothing calls this
yet**, which is this plan's defining property"*; and *"Two things that rests on are
MEASUREMENTS not yet taken"* — both of which 24-03 took and answered.

**Neither is a behavioural defect and neither changes the verdict.** Both are the class
`CLAUDE.md` names explicitly — *"a comment is not a specification… when a comment and a
requirement disagree, the requirement wins and the comment gets fixed"* — and both sit on the
exact field the criterion turns on. 24-03 armed the gate and updated `reservationTtlMs`'s
docblock; it did not move these two. Recommended for repair, not blocking.

### W3 — the process count is six, not five

Measured: `spawnAgent` runs for `provider`, `other-provider`, `relay`, and three times inside
`joinFabric` (`member`, `stranger`, `outsider`) = **six** `bin/agent.ts` children, plus one
in-process `FabricNode` reader. The file's own reader paragraph calls it *"a **seventh**
child"* it declined to spawn, which is consistent with six; its Budget section says *"Five
child processes"*, which is not. The wrong number propagates into `24-04-SUMMARY.md` twice
and into the **drafted AUTH-02 requirement row**. It must be corrected before that row lands
in a permanent ledger.

## Requirements Coverage

| Requirement | Declared by | Honest state after Phase 24 | Checkbox |
|---|---|---|---|
| **AUTH-02** | 24-01/02/03/04 | **Partial → Partial.** The admission half is now built, wired and measured, which was previously unrepresentable. Still open: the browser tier verifies nobody (Phase 22, D09); `records`/`providers` ungated; **and the clause holds of a relay, not of the fabric** | **stays `[ ]`** |
| **AUTH-04** | 24-01/03/04 | **Partial → Partial.** The approach changed from pricing to devaluing, per the owner's ruling. The enrolment DoS surface is untouched and measured unchanged. The `serveAgent` `enrol` branch still takes no authorization step | **stays `[ ]`** |
| **BENCH-03** | 24-02 (not in the phase's `Requirements:` line) | **Done → Done.** The pre-gate baseline is dated, carries its conditions, has a demonstrated ability to move, and re-read byte-identical four times. **No published curve moved** — verified: no bench rig passes `relayAddrs` to any node, so the reservation path is never exercised | unchanged |
| — orphan check — | ROADMAP `Requirements: AUTH-02, AUTH-04` | Both claimed by plans. **No orphaned requirement.** | — |

`acceptance-traceability.node.test.ts` and `requirements-ledger.node.test.ts` both green on
the current tree (61 cases). The pairing they enforce is real: 24-04 watched plant 9 —
AUTH-02's checkbox `[ ]` → `[x]` — redden five cases by name
(`AUTH-02 — [x] at .planning/REQUIREMENTS.md:270 against **Partial** at .planning/REQUIREMENTS.md:692`).
**Neither checkbox may move.**

---

## RECOMMENDED LEDGER EDIT LIST

The verifier may not apply these. Recommend only.

### MUST change

**L1 — `.planning/REQUIREMENTS.md`, AUTH-02 traceability row (line ~692).** Append 24-04's
drafted text verbatim, **with one correction**: *"Measured across five real `bin/agent.ts`
processes"* → *"Measured across **six** real `bin/agent.ts` processes"* (W3). The rest of
that text is verified correct clause by clause, including its three self-limiting
disclosures — the browser tier pins nobody, `records`/`providers` are ungated, and *"the
clause holds of a relay, not of the fabric"*. **Recommend one addition** to that third
disclosure: `bin/seed.ts` is not merely *"still open"* but **cannot be told to close** — no
flag, no `SeedServerOptions` field — which is why criterion 8 verifies PARTIAL rather than
passing with a stated bound.

**L2 — `.planning/REQUIREMENTS.md`, AUTH-04 traceability row (line ~694).** Append 24-04's
drafted text verbatim. Verified correct: the refuse-over-mint figure sits inside Phase 19's
band on two independent readings; the refuse-over-replay explanation is about the instrument
and is accepted; the 3-issuances/0-reservations count reproduces; `M66` exists and is caught.
**Optional strengthening:** the row states `3.070` / `9351` as *the* readings; recommend
adding the verifier's second pair (`3.0895` / `9576.8`, 2026-08-06, load 5.92) so the row
records a range rather than one host's afternoon.

**L3 — `.planning/ROADMAP.md`, progress table row 24.** `1/4 | In Progress — 24-01 landed,
24-02/03/04 amended and ready` → **`4/4 | 0 of 1 criteria — criterion 8 PARTIAL: admission is
per-relay and the seed cannot be told to close, so "cannot join the fabric" is measured of a
relay. Mechanism delivered and measured; the criterion does not close`**, dated 2026-08-06.

**L4 — `.planning/ROADMAP.md`, Phase 19 progress row.** It currently reads that criterion 5
*"stays PARTIAL until 24 lands"*. **24 has landed and criterion 5 does not close.** The row
must say so rather than being left to imply closure by the phase's completion. Same for the
Phase 17 row's carried criterion 3.

**L5 — `.planning/STATE.md`.** Phase 24 is 4 of 4 plans and verified at 0/1 with criterion 8
PARTIAL; it is **UNCOUNTED**, on the same rule that leaves 16, 17, 19, 20 and 21 uncounted.
The count stays **8 of 15**.

### MUST NOT change

- **AUTH-02's checkbox stays `[ ]`.** **AUTH-04's checkbox stays `[ ]`.** Both `Partial`
  verdict cells stay `Partial`. `acceptance-traceability.node.test.ts` enforces the pairing
  and 24-04 watched the overstatement plant redden five cases by name.
- **Phase 19's criterion 5 and Phase 17's criterion 3 do not close**, and neither phase's
  score moves. RULING A: a carried criterion stays PARTIAL until its destination lands, and
  its destination has landed PARTIAL.
- **`BENCH-03` does not move.** Already Done; nothing here touched a published curve.
- **Criterion 8's wording must not be edited** to read "a relay" in place of "the fabric".
  That is the exact rewrite RULING A forbids. If the owner rules that per-relay admission is
  the intended scope, the correct instrument is an `overrides:` entry on this verification or
  a dated owner note beside the criterion — not a change to the criterion's words.
- **`slow-specs.node.test.ts`'s tolerance must not be widened.** 24-03 and 24-04 both re-sited
  the count instead; drift is 0 against a tolerance of 5 and the full node project is green.

### RECOMMENDED source repairs (not ledger, but they belong in the same pass)

- **W1** — rewrite `FabricNodeOptions.relayAdmission`'s "Nothing reads this yet" paragraph to
  describe the armed mechanism and point at `relayAdmissionGate`.
- **W2** — rewrite `relay-admission.ts`'s "Consulted by nothing" section and `admitsAnyPeer`'s
  "Nothing calls this yet", and replace "MEASUREMENTS not yet taken" with the two numbers
  24-03 took (renewal re-consults: yes, 30 031 ms; window = TTL, 40 049 ms against 40 000 ms;
  floor `REFRESH_TIMEOUT_MIN` 30 s).
- **W3** — `Five child processes` → `Six child processes` in `admission-agents.node.test.ts`'s
  Budget section.
- **W5** — remove `**Mode:** mvp` from Phase 24's ROADMAP block, or restate the goal as a User
  Story. The goal is a security property and cannot be verified under MVP mode's User Flow
  Coverage contract; this verification used the standard goal-backward methodology on the
  parent instruction's explicit direction.

---

## Human Verification Required

### 1. Rule on whether a seed may be told which issuers it admits

**Test:** Decide between (a) adding `SeedServerOptions.relayAdmission` and
`bin/seed.ts --admit-issuer`, then re-reading criterion 8 over a fully-gated fabric; or
(b) ruling that the seed stays open and criterion 8 is restated as a property of a relay.
**Expected:** Under (a) criterion 8 can reach MET. Under (b) the criterion's words must be
changed by the owner, not by a verifier, and Phase 19's and Phase 17's carried clauses inherit
the same reading.
**Why human:** 24-CONTEXT's open ruling 1 and 24-01's explicit deferral both route this to the
owner, and RULING A forbids the verifier taking route (b) on its own.

### 2. Land the two requirement rows, with the corrections in L1

**Test:** Apply L1 and L2 above.
**Expected:** Both guards stay green; neither checkbox moves; the overstatement plant still
reddens by name.
**Why human:** A verifier may not apply the ledger edits it recommends.

### 3. Re-confirm the 23 → 24 → 22 ordering ruling

**Test:** Decide whether Phase 22 should still run next.
**Expected:** The 2026-08-05 ruling put 22 after 24 so the reachability guard would certify a
*gated* fabric. It will now certify a fabric gated at agent relays and open at every seed.
The ruling's own escape hatch — *"22-VERIFICATION.md states plainly that it certified
reachability over an ungated fabric"* — applies in a partial form the ruling did not
anticipate, and 22-VERIFICATION.md should be told what to say.
**Why human:** Scheduling ruling, and the premise it rested on moved.

---

## Gaps Summary

Phase 24 built the thing it set out to build. `RelayAdmission` is a required named union at
70 construction sites; `relayAdmissionGate` reads it and returns *no method at all* for the
open posture so an unarmed node is byte-identical to before; the gate asks a joining peer for
its records over the fabric's own RPC, retries because the first request is *destroyed* rather
than delayed, verifies offline against a pinned issuer set, and refuses inside libp2p's own
5 000 ms ceiling. Every path out of it is a decision and none falls through to allow. It is
caught by a mutation I ran myself. The revocation window is a measured number with a measured
floor. Three plans reported their own plan's premises false and one reported its own guard
vacuous. The residual the phase does not fix is read twice and published as unchanged.

The gap is not in the work. It is in the distance between what the work measures and what the
criterion says.

**The criterion says "the fabric". The evidence says "a relay".** The phase's own final plan
found that, published it before its readings rather than after, and bounded its own claim —
which is the right behaviour and is why this verifies PARTIAL rather than FAILED. But the
bound is wider than 24-04 states it: the argument that *"criterion 8's subject is a node that
cannot present a certificate, and `stranger` is that node, so the clause holds"* is falsified
by the same run, because **`reader` is also that node and `reader` got in**. And the open door
`reader` walked through has a sibling that cannot be closed at all: `bin/seed.ts` has no flag,
`SeedServerOptions` has no field, and the seed is the relay every browser tab in this fabric
reserves on and the source of the one advertisement surface — `BootstrapInfo.peerAddrs` —
that no test reads as a gated one and that `demo/main.ts` consumes for peer discovery.

So: **an identity that was never issued does not buy nothing.** It buys a reservation, an
advertisement and a dialable route on any open relay-capable peer — including, structurally
and today, every seed. What Phase 24 delivered is the *mechanism* by which that stops being
true, correctly placed at the one seam where both advertisement surfaces are derived, plus a
measured demonstration that it works wherever it is armed. What it has not delivered is a
fabric in which it is armed everywhere it needs to be.

Two documentation defects sit on the phase's own central field and say the opposite of the
code beside them (W1, W2), and one factual count is wrong in three places including the
requirement row drafted for the permanent ledger (W3). None changes the verdict; all three
should be repaired in the same pass that lands the rows.

---

_Verified: 2026-08-06T21:55:21Z at `753d298`, working tree clean before and after._
_Verifier: Claude (gsd-verifier). No source, ledger, roadmap or state file was modified._
_Every exit code above was read with `EXIT=$?` on the immediately following line._
