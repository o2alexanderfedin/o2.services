---
phase: phase-24-certificate-gated-admission
verified: 2026-08-06T21:55:21Z
status: human_needed
score: >-
  1/1 criteria MET — criterion 8 verified PARTIAL on 2026-08-06 (0/1) and was re-scored
  MET by the dated amendment of the same day. THE VERDICT CARRIES A STATED BOUND and the
  bound is part of it, not a footnote: the default posture of `bin/agent.ts`,
  `bin/seed.ts` and `bin/bench.ts` is OPEN and must be — 19 + 3 argv sites, with
  `reservation-exhaustion.node.test.ts` arm A a live behavioural guard on it. "The
  fabric" is read as a fabric this repository can be DEPLOYED AND OPERATED as, with an
  admission posture stated on every relay-capable door — NOT the default argv of its
  binaries. THIS FRONTMATTER READ `gaps_found` / `0/1 … PARTIAL` UNTIL 2026-08-06 and
  was contradicted by its own body from `580e461` onward; corrected here rather than in
  the amendment, because a verifier appends and does not rewrite. The original verdict
  and every word of its reasoning remain in the body, unedited.
superseded_score: 0/1 criteria MET — criterion 8 verifies PARTIAL (2026-08-06, pre-amendment)
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

---

## Amendment — 2026-08-06 (second pass): criterion 8 is MET, and the score is 1/1

**Score: 0/1 → 1/1 criteria.** Everything above is the first pass of 2026-08-06 at `753d298` and
is left standing; **nothing in it is retracted, and the frontmatter above is untouched** — it
still reads `status: gaps_found` and `score: 0/1 criteria MET — criterion 8 verifies PARTIAL`,
and both are superseded by this amendment rather than edited by it, on the form
`16-VERIFICATION.md` set on 2026-08-06.

This is a re-verification triggered by four gap-closure plans landing (`68be6a9`, `afe8b0b`,
`241a9cc`, `1b7f99d`). It is an independent pass: **every reading below was executed in this
verifier's own process**, and none of it is transcribed from `24-05`/`24-06`/`24-07`/`24-08`
`-SUMMARY.md`. Two mutations below are this verifier's own, unledgered, and neither is `M66`.

**Re-verified:** 2026-08-06, at `1b7f99d`, working tree clean before and after
**Status:** `human_needed` — not `passed`, and only because the ledger edits below are ones a
verifier may not apply. Phase 23's precedent exactly.

---

### The reading of *"the fabric"* this amendment adopts, stated before the evidence

> **"The fabric" means a fabric this repository can be deployed and operated as, with an
> admission posture stated on every relay-capable door — not the default argv of its binaries.**

Criterion 8's words are **unedited**, and that was checked rather than assumed.
`.planning/ROADMAP.md:1189` was extracted and normalised against the quotation carried at
`24-VERIFICATION.md:173` and against the quotation in the header of
`packages/node/src/closed-fabric-agents.node.test.ts`: **identical**. `git log -L1189,1189`
returns exactly one commit — `3cc5a83` *("docs: Phase 24 — Certificate-Gated Admission,
scheduled later by owner ruling")* — so the line has never been edited since it was written.
`criterion_text_unchanged: true`. **RULING A is honoured: this amendment reads the criterion, it
does not rewrite it.**

**Why this reading and not the wider one, in four steps.**

1. **The first pass named the exact condition under which its own disposition changes**, and did
   so in its own words: *"'Pass-with-a-stated-bound' would be the right disposition if the bound
   were a deployment posture an operator can remove. It is not: for the seed there is no knob."*
   It then wrote the consequence out under Human Verification 1: *"Under (a) criterion 8 can
   reach MET"*, where (a) is *"adding `SeedServerOptions.relayAdmission` and `bin/seed.ts
   --admit-issuer`, then re-reading criterion 8 over a fully-gated fabric"*.
2. **The owner ruled (a).** `0e8e7cd`: *"Owner ruling 2026-08-06: a seed MAY be told which
   issuers it admits. Mirror `bin/agent.ts --admit-issuer` onto `bin/seed.ts` and give
   `SeedServerOptions` the field that holds it."* Route (b) — restating the criterion as a
   property of a relay — was **not** taken, and this amendment does not take it either.
3. **The criterion's own parent is a mechanism claim.** The owner ruling of 2026-08-04 quoted in
   `ROADMAP.md:1203` reads *"If it cannot authenticate — it cannot join the network."* That is a
   statement about what the door does to a peer that cannot authenticate. Every access-control
   property in this repository is conditional on being configured; `FabricNodeOptions.relayAdmission`
   and `SeedServerOptions.relayAdmission` are **required with no default**, so the API cannot even
   express silence. What has a default is argv, on two binaries, deliberately.
4. **What the wider reading would cost.** Under *"any fabric this repository can be deployed as,
   including a default-argv one"*, no per-relay mechanism can ever satisfy criterion 8, and the
   only route left is `24-CONTEXT.md` open ruling 1 — make both binaries refuse to start absent a
   stated posture. That is an owner ruling, it is **deliberately unplanned**, and a verifier
   adopting the reading that forces it would be selecting a route the owner declined. The first
   pass put route (b) beyond a verifier's reach; the same principle puts this beyond it too.

**The bound this MET carries, stated at the verdict rather than in a footnote.** The default
posture of `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is **open**, and must be: nineteen
`bin/agent.ts` and three `bin/seed.ts` argv sites depend on it, and
`reservation-exhaustion.node.test.ts` arm A is a **live behavioural guard** on it — read at the
source, lines 285-317: *"a seed whose no-flag posture had become anything but
`'admits-any-peer'` reddens here, by name, before B is ever read"*, backed by
`expect(a.stderr()).not.toContain('PERMISSION_DENIED')`. Criterion 8 is MET **of a fabric an
operator has closed**, and this repository ships open by default on purpose.

---

### Verdict

| | |
|---|---|
| **Criterion 8** | **MET**, with the bound above stated |
| Score | **1 / 1** |
| Phase | **human_needed** — every criterion satisfied; the open items are ledger edits and two scheduling/metadata rulings |

---

### What this verifier ran, and read directly

Every exit code was captured with `EXIT=$?` on the line **immediately** following the command —
no pipes, no trailing filter. Host: 8 cores, `uptime` 1-minute load recorded per row.

| # | Command | Exit | Result | `/usr/bin/time -p` | load |
|---|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | **0** | zero output | `real 1.60 user 2.18 sys 0.52` | 4.88 |
| 2 | `npx vitest run --project node closed-fabric-agents.node.test.ts --reporter=verbose` | **0** | 2 tests | `real 18.26 user 9.50 sys 1.77` | 3.52 |
| 3 | `npx vitest run --project node relay-admission + enrolment-needs-no-reservation + reservation-exhaustion` | **0** | 3 files, **40 tests** | `real 24.02 user 18.36 sys 3.53` | 6.19 |
| 4 | `npx vitest run --project e2e gated-seed.e2e.test.ts --reporter=verbose` | **0** | 4 tests, chromium + firefox + webkit | `real 71.75 user 9.80 sys 2.90` | 6.13 |
| 5 | `npx vitest run --project node` (full) | **0** | **167 files, 2323 passed, 2 skipped** | `real 288.50 user 422.53 sys 65.17`, ratio **1.69** | 7.45 → 9.68 |
| 6 | **plant V1** — `closed-fabric-agents.node.test.ts` | **1** | **2 failed** | `real 72.32` | 4.88 |
| 7 | **plant V2** — `closed-fabric-agents.node.test.ts` | **1** | **1 failed, 1 passed** | `real 74.27` | 5.97 |
| 8 | `npx vitest run --project node closed-fabric-agents.node.test.ts` (after restore) | **0** | 2 passed | `real 18.24` | 9.23 |

Row 5 against the baseline handed to this verifier — 167 files, 2323 passed, 2 skipped,
`real 304.17`, ratio 1.63 — is **the same file and test counts** at `real 288.50` and ratio
**1.69**. Comparable rather than merely both green. `git status --porcelain` was empty before
row 5, before row 8, and at the end of the session; both plants were restored with `cp` and
confirmed with `cmp` **exit 0** and `git diff --quiet` **exit 0** over the whole tree.

---

### Plant V1 — this verifier's own, unledgered: *the label says shut and the door is open*

**Not `M66`, and not `M67`.** `M67` puts `relayAdmission: 'admits-any-peer'` back as a literal in
`seed-server.ts`, where a **source census** in `relay-admission.node.test.ts` counts it. V1
leaves `seed-server.ts`, `SeedServerOptions`, the hex validator and the entire banner **byte-for-byte
intact** and changes exactly which argv key `bin/seed.ts` reads:

```diff
   relayAdmission:
-    values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(values['admit-issuer']),
+    values['trusted-issuer'] === undefined ? 'admits-any-peer' : new Set(values['trusted-issuer']),
```

The fixture passes only `--admit-issuer`, so under V1 the seed is **open while its banner still
prints `admits only peers certified by 1 pinned admission issuer …`** — the fixture's own posture
assertion (`expect(admitsLine(seed.banner)).toContain('only peers certified by')`) stays green.
This is the sharpest available test of whether the whole-set reading reads the **door** or the
**label**.

**It reads the door. Exit 1, both cases red.** The `/bootstrap.json` case named the surface
exactly:

```
AssertionError: the uncertificated stranger is advertised to every arriving browser:
expected [ Array(1) ] to strictly equal []
```

Restored: `cmp` exit 0, `git diff --quiet` exit 0.

**And V1 recorded something the summaries do not.** `24-07-SUMMARY.md` states that its equivalent
plant reddens *"with exactly `{door: 'seed', admitted: 'stranger'}` and `{door: 'seed', admitted:
'reader'}` and no other door"*. Under V1 the **first** case did not reach that assertion at all:
it died earlier, at R3, the control —

```
timed out waiting for the uncertificated stranger to hold a reservation on the one peer
nobody closed; observed {"openControlHolds":[], …}
```

— because the silently-opened seed took the stranger's reservation and the control never got one.
Both outcomes are red and both are attributable (`strangerRelays` in the diagnostic names the
seed's own address), but **the `intruders` machinery that exists to name which door let whom in is
bypassed in what is arguably the likeliest failure mode.** That is a finding about the
instrument's failure ordering, not about its correctness, and it qualifies the summary's claim of
determinism.

---

### Plant V2 — this verifier's own, unledgered: *is the "whole set" the fabric's population?*

The first pass's central complaint was that 24-04 *"reasoned about one named peer"*. 24-07's
answer is a set. V2 asks the next question: **is the set the population that pays?**

Added to `standUp`: a **seventh** relay-capable `bin/agent.ts`, spawned `--port 0` with **no**
`--admit-issuer` — i.e. open — placed inside the fabric, reachable by the stranger, and **never
added to `closedSet`**.

**Exit 1 — but the population assertions stayed green.** `expect(closedSet).toHaveLength(CLOSED_RELAY_CAPABLE - 1)`
and `expect(Object.keys(answers)).toHaveLength(CLOSED_RELAY_CAPABLE)` both passed with an open
relay-capable peer sitting inside the fabric. What reddened was R3 again, and only incidentally —
the planted door took the stranger's reservation, so the control starved:

```
timed out waiting for the uncertificated stranger to hold a reservation on the one peer
nobody closed; observed {"openControlHolds":["…reader…"], "strangerRelays":[ … /tcp/52940/… ]}
```

**So the finding stands, and the file's own docblock states its guard backwards.**
`CLOSED_RELAY_CAPABLE`'s docblock claims it is *"asserted rather than assumed, so that a
participant added to `standUp` without being added to the set reddens instead of silently
narrowing the claim."* Read at the source and confirmed by V2, the constant catches the
**opposite** case: adding a participant to `closedSet` without bumping the constant reddens;
adding one to `standUp` alone does not. The population of *"every relay-capable peer"* is a
hand-maintained literal, and nothing derives it from the spawn sites. **Severity: WARNING.** The
six doors that *were* asked are real, both uncertificated subjects are absent from all six, and
the reading taken is sound. What is not machine-held is its completeness.

**V2 also surfaced the one thing the green path never asserts, and it is favourable.** The
stranger's stderr under V2 carried **seven** `agent.ts: relay reservation refused:
PERMISSION_DENIED` lines. The stranger genuinely asks and is genuinely refused, repeatedly — a
fact visible only inside a failure diagnostic. See W8 below.

**Both plants restored with `cp` + `cmp` exit 0.** Neither was committed, staged or stashed.

---

### The two findings the first pass scored PARTIAL on — both closed, re-measured here

#### G1 — *"the criterion says the fabric; the evidence says a relay"*: **CLOSED**

**The knob exists and is behaviourally wired, verified at the source and then by V1.**

| Was, 2026-08-06 first pass | Is, verified now |
|---|---|
| `SeedServerOptions` has no field | `readonly relayAdmission: FabricNodeOptions['relayAdmission']` at `seed-server.ts:179` — **required, no `?`**, and typed by **indexed access** so the two option types cannot drift |
| `seed-server.ts` writes the literal | `relayAdmission: options.relayAdmission` at `seed-server.ts:329`; `grep OPEN_POSTURE` over that file reads **0** |
| `bin/seed.ts` has no `--admit-issuer` | `'admit-issuer': { type: 'string', multiple: true }` at `bin/seed.ts:105`, its own hex validator with a separate refusal message at 138-142, the ternary at 197-198, and the posture printed in the banner at 291-296 |

**The whole-set reading, taken in this verifier's own run** (`[closed-fabric]`, row 2):

```
postures  provider [71ed1c…]  seed "admits only peers certified by 1 pinned admission issuer…"
          relay [71ed1c…]  memberAtSeed [71ed1c…]  memberAtRelay [71ed1c…]
          stranger [71ed1c…]  reader [71ed1c…]  openControl "admits-any-peer"
closedSetHolds  provider []   seed [memberAtSeed]   relay [memberAtRelay]
                memberAtSeed []   memberAtRelay []   reader []
openControlHolds  [ stranger , reader ]
strangerRelays    [ one circuit, through openControl and nothing else ]
```

Six closed doors. **Two** uncertificated subjects — `stranger` **and** `reader`, the very node
whose admission falsified 24-04 — absent from all six, over two scans bracketing a 5 s window,
with `unanswered` asserted empty so a door that cannot answer fails the reading. Both subjects
present at the one peer nobody closed, so the absence is a **refusal** and not inaction. And the
reader is itself closed and itself uncertificated, so **every reading in the file is taken by a
node the fabric turned away** — the sharpest form of the claim available.

**The bootstrap paradox, which is what could have made a fully-closed fabric unbuildable, is false
and is falsified inside this same fixture.** Both enrolled arms hold `certificate.issuer ===
issuer` signed by a provider that pins that issuer and therefore refuses them a reservation, and
then hold circuits at closed doors. Independently reproduced in row 3:
`enrolment-needs-no-reservation.node.test.ts` green, whose arm A is a joiner whose provider pins
`eeee…ee` — a well-formed key nobody holds — and which still ends holding a valid certificate from
that provider with `relays === []` and `PERMISSION_DENIED` on stderr. `resolveCertificate` enrols
over a plain dial; there is no reservation anywhere in that path.

**Clause-by-clause, on the reading adopted above:**

| # | Clause | Was | Now | Evidence this verifier took |
|---|---|---|---|---|
| 1 | cannot **join** the fabric | PARTIAL | **MET** | 6 closed doors × 2 uncertificated subjects, absent from all, two scans, live control |
| 2 | cannot **advertise** itself | PARTIAL | **MET** | both surfaces: the relay's `reservations` thunk over the wire, **and** `/bootstrap.json` over real HTTP from a real `bin/seed.ts`, presence-then-absence — the gap §2 named |
| 3 | cannot **be dialled** | VERIFIED, bounded | **MET** | method unchanged and sound; clause 2's surface bound is gone; browser round attempts the member, never attempts the stranger, reaches it on a direct address |
| 4 | an identity never issued **buys nothing** | PARTIAL | **MET** | the stranger holds nothing at any of six doors and appears on neither advertisement surface |
| 5 | the N-th identity costs a **provider's willingness to sign** | PARTIAL | **MET** | the only two nodes in are the two holding a certificate from the pinned issuer; enrolment is the only route in and it spends the provider's aggregate window |

#### G2 — *`BootstrapInfo.peerAddrs` is read by nothing as a gated surface*: **CLOSED, twice**

The first pass: `grep -rln peerAddrs packages/node/src/*.test.ts` returned one file asserting
address **shape**, while `packages/browser/demo/main.ts` consumes it as its dial-candidate source.

**Now read at both tiers, and this verifier ran both.**

- **Node tier** (row 2, case 2): `fetch('http://127.0.0.1:<port>/bootstrap.json')` against a real
  spawned `bin/seed.ts`. Presence of the enrolled arm established **first**, absence of both
  uncertificated subjects held over the same window, `status 200`, `cache-control: no-store`, and
  the `peerAddrs[0] === relayAddrs[0]` shape invariant asserted so a change of shape is a finding
  rather than a silent pass. Observed:
  `peerAddrs = [ seedAddr , seedAddr/p2p-circuit/webrtc/p2p/<memberAtSeed> ]` — the enrolled arm
  and nothing else.
- **Browser tier** (row 4): `gated-seed.e2e.test.ts`, **chromium, firefox and webkit, none
  excluded**, against a real `SeedServer` pinning a **separated** provider's issuer and serving
  both the demo page and `/bootstrap.json` from its own origin. The tab learns its relay from
  `discoverRelays()` answering `'origin'`, never from the harness. `peerAddrs` is read as
  content **and** as behaviour: `connectDiscoveredPeers()` with `round.asked` asserted true so an
  empty round cannot read as a pass, the member in `attempted`, the stranger in neither `dialed`
  nor `failed`, and the stranger reached immediately on a direct dial — so the claim is about
  **discovery**, not reachability.

That reading is what makes the seed's closure a browser-tier fact and not a Node-tier one, which
matters because the seed is the only door a tab has.

---

### Regression checks on what the first pass had already verified

| Item | Status | Evidence |
|---|---|---|
| Full `--project node` | ✓ | row 5: 167 files, **2323 passed**, 2 skipped, exit 0 |
| `tsc --noEmit` | ✓ | row 1, exit 0, zero output |
| Declaration census not widened to let 24-06 pass | ✓ | `relay-admission.node.test.ts` splits by **shape** — one *defining* declaration naming the union in `fabric-node.ts`, plus *forwarding* declarations using indexed access, defining + forwarding = total, so a third shape fails by name. This is the opposite of `toBe(1) → toBe(2)`; it is strictly stronger in both directions and does **not** close a gap by widening what passes |
| Default posture unmoved | ✓ | `reservation-exhaustion.node.test.ts` arm A green (row 3), and it is a live behavioural guard — a seed whose no-flag posture changed reddens there by name |
| W1 `fabric-node.ts` *"Nothing reads this yet"* | ✓ **repaired** | line 496 now quotes what it replaced |
| W2 `relay-admission.ts` *"Consulted by nothing"* / *"Nothing calls this yet"* / *"MEASUREMENTS not yet taken"* | ✓ **repaired** | lines 58, 126, 200 each quote what they replaced and name the measurement taken |
| W3 process count *"Five"* → six | ✓ **repaired** | `admission-agents.node.test.ts:79` reads **Six** |
| Budget arithmetic not repeating W3's error | ✓ | 24-07 claims eight children / seven concurrent; counted against the spawn sites: 7 `spawnAgent` calls (provider ×2, relay, openControl, memberAtSeed, memberAtRelay, stranger) + 1 `bin/seed.ts` = **8**, minus the stopped minting provider = **7 concurrent**. Correct |
| Browser tier runs no relay server | ✓ | `grep -rn circuitRelayServer packages/browser/src/` returns two hits, **both inside comments**; no import |
| Debt markers in the phase's files | ✓ **none** | `TBD` / `FIXME` / `XXX` across all thirteen files the four plans touched: zero. No debt-marker gate fires |
| Working tree | ✓ | `git status --porcelain` empty before row 5, before row 8, and at session end |

---

### New warnings raised by this pass

| id | file | issue | severity |
|---|---|---|---|
| **W6** | `packages/node/src/closed-fabric-agents.node.test.ts` | `CLOSED_RELAY_CAPABLE`'s docblock claims a participant added to `standUp` but not to `closedSet` reddens. **It does not** — proved by plant V2, where both population assertions stayed green with an open seventh relay-capable peer inside the fabric. The guard catches the opposite case. The comment should be corrected to say what it actually holds, or the set derived from the spawn sites | WARNING |
| **W7** | `packages/node/src/closed-fabric-agents.node.test.ts:866-871` | `circuitsThrough(stranger, …)` is an **assertion** over `stranger.relays`, a **handshake-time snapshot**. An absence at announce time is not an absence now. It is sound only because `bin/agent.ts:1089-1096` records, measured, that libp2p makes exactly one reservation attempt ever on this configuration — *"a single lost attempt is permanent"*. The load-bearing reading (R2, two live scans) is not a snapshot, so this is a bound on a secondary instrument. The dependency should be named at the assertion | WARNING |
| **W8** | same file, R2/R3 | The green path asserts the stranger's **absence** but never asserts a **named refusal**. Plant V2 showed its stderr carrying seven `relay reservation refused: PERMISSION_DENIED` lines — visible only in a failure diagnostic. `enrolment-needs-no-reservation.node.test.ts` asserts that string on its own arm A, so the fact is measured in the phase; it is simply not measured in the fixture that carries the criterion | INFO |
| **W9** | `packages/node/src/bin/bench.ts` (3 sites), `packages/node/src/bench-fabric.ts` (1 site) | A **third binary** hardcodes `relayAdmission: 'admits-any-peer'` and has no flag. Each site carries a written decision and the honest disclosure that *"this driver passes `relayAddrs` to nobody, so the relay service each of these workers runs is never asked for a reservation and its store stays empty for the whole run"*, and no published curve therefore says anything about admission. It is a measurement rig, not a deployment path — but it is the last residue of the structural shape the first pass named, and it should be recorded rather than discovered later | INFO |
| **W10** | `24-07-SUMMARY.md` | States its seed plant reddens *"with exactly `{door: 'seed', admitted: …}` and no other door"*. Under this verifier's equivalent plant V1 the first case reddened earlier, at R3, and never reached the `intruders` assertion. Both reds are true and attributable; the summary overstates determinism | INFO |
| **W11** | `packages/node/src/mutation-ledger.ts`, `M67` | `caughtBy` names only `relay-admission.node.test.ts`, with the note *"that file is untracked at the time this entry was written… Whoever commits it should add it to `caughtBy`."* `closed-fabric-agents.node.test.ts` is now **git-tracked** (`git ls-files --error-unmatch` exit 0, committed at `241a9cc`). The entry's own instruction is due | WARNING |
| **W4′** | `.planning/ROADMAP.md` progress row 24 | Unchanged from the first pass's W4 and now materially **false**: it asserts *"`bin/seed.ts` cannot be told to close — no flag, no `SeedServerOptions` field"*. Both halves were repaired by `afe8b0b`. See L1 | BLOCKER for the ledger, not for the phase |
| **W5′** | `.planning/ROADMAP.md`, Phase 24 `**Mode:** mvp` | Unchanged. The goal is a security property, not a User Story, so MVP-mode's User Flow Coverage contract cannot be applied; this pass used standard goal-backward verification, as the first pass did | WARNING |

---

### Requirements coverage

| Requirement | Honest state after the four gap-closure plans | Checkbox |
|---|---|---|
| **AUTH-02** | **Partial → Partial.** The admission half is now measured over a **fabric** rather than a relay, on **both** advertisement surfaces, at **both** tiers. Still open and unchanged: the browser tier pins nobody and verifies nobody (Phase 22, `DEFICIENCIES.md` D09), and `records`/`providers` answers are ungated (`24-CONTEXT.md` deferred idea). **The row's own text is now stale — see L2** | **stays `[ ]`** |
| **AUTH-04** | **Partial → Partial.** The devaluation approach is now demonstrated end-to-end on a closed fabric: an unissued identity buys nothing at any of six doors. The `serveAgent` `enrol` branch still takes **no authorization step** and the enrolment DoS surface is untouched — 24-05 in fact *depends* on that being true, since enrolment over a plain dial is what makes a fully-closed fabric joinable at all. **The row's own text is now stale — see L3** | **stays `[ ]`** |
| — orphan check — | ROADMAP `Requirements: AUTH-02, AUTH-04`; both claimed by plans. **No orphaned requirement** | — |

`acceptance-traceability.node.test.ts` and `requirements-ledger.node.test.ts` are green inside
row 5. **Neither checkbox may move**: both requirements have live clauses this phase did not
close, and the pairing guard reddens by name on an overstatement.

---

### Deferred — unchanged, restated so neither is read as covered

| Item | Addressed in | Evidence |
|---|---|---|
| The browser tier pins nobody and reaches no verdict about a peer | **Phase 22** | `DEFICIENCIES.md` D09; 24-03 and 24-04 both name Phase 22 as the owner of the `PeerVerifier` move. 24-08 read the tab as a **subject** of admission, never as a verifier, and says so |
| `records` / `providers` answers gated on the certificate | **Not scheduled** | `24-CONTEXT.md` `<deferred>`. `closed-fabric-agents.node.test.ts` restates in its header that it does not re-take clause 3's *unfindable, not unreachable* result and does not weaken it |
| Whether the binaries should refuse to start absent a stated posture | **Owner ruling, unplanned** | `24-CONTEXT.md` open ruling 1. Deliberately no plan; `0e8e7cd` records why |

---

## LEDGER EDITS RECOMMENDED (not applied)

**This verifier modified no source, ledger, roadmap or state file.** `.planning/STATE.md`,
`.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` are untouched.

### MUST change

**L1 — `.planning/ROADMAP.md`, progress table row 24 (line 1147).** The current cell asserts a
fact that is now false. Replace with, dated 2026-08-06:

> `4/4 | **1 of 1 — criterion 8 MET**, by dated amendment to `24-VERIFICATION.md` after four
> gap-closure plans (`68be6a9`, `afe8b0b`, `241a9cc`, `1b7f99d`). **One** criterion, numbered 8,
> carried from Phase 19, so the score reads out of 1 and not out of 8. Read over a fabric whose
> **every** relay-capable peer was told to close — eight OS processes, six closed doors, **two**
> uncertificated subjects, absence asserted over the set with each door named, and a live control
> the verifier watched fail twice. Both advertisement surfaces read, including
> `BootstrapInfo.peerAddrs` over real HTTP and in three browser engines. **The bound, stated:**
> the default posture of `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is open and must be —
> 19 + 3 argv sites and a live behavioural guard depend on it — so criterion 8 is MET of a fabric
> an operator has closed. Whether the binaries should refuse to start absent a stated posture is
> `24-CONTEXT.md` open ruling 1 and remains the owner's | 2026-08-06`

**L2 — `.planning/REQUIREMENTS.md`, AUTH-02 traceability row (line ~692).** Its closing sentences
are now false and must be corrected rather than left to age:

- *"And a seed cannot be told to close, which is why criterion 8 verifies PARTIAL rather than
  passing with a stated bound … there is no `--admit-issuer` flag on `bin/seed.ts`,
  `SeedServerOptions` carries no field that could hold one, and `seed-server.ts` writes
  `relayAdmission: 'admits-any-peer'` at its `FabricNode.start` call. The bound is structural,
  not a deployment posture an operator can remove"* — **all four clauses repaired by `afe8b0b`.**
- *"every `bin/seed.ts` is still open — 24-01 hardcoded that posture deliberately"* — false.
- The 24-04 falsification recorded at the end (*"the in-process `reader` is also a node handed no
  `enrollment` option…"*) should be **kept**, and followed by the repair: in 24-07's fixture the
  reader is itself closed and itself uncertificated, is a **subject** of the reading rather than a
  hole in it, and is absent from all six doors.
- Append: the whole-set reading, both advertisement surfaces, the three-engine seed reading, and
  the stated default-open bound. **Add the two new instruments by path**:
  `packages/node/src/closed-fabric-agents.node.test.ts` and
  `packages/node/src/gated-seed.e2e.test.ts`.

**L3 — `.planning/REQUIREMENTS.md`, AUTH-04 traceability row (line ~694).** Its closing sentence
— *"**The N-th-identity clause therefore verifies PARTIAL, not MET** … because admission is
per-relay and every seed is structurally un-closable"* — is false in its stated cause. Replace
with the MET verdict **and its bound**, and keep every clause about the untouched enrolment DoS
surface: nothing here shrank it, and 24-05's result depends on it not having been shrunk.

**L4 — `.planning/ROADMAP.md`, Phase 19 and Phase 17 progress rows.** Both currently record their
carried criteria as staying PARTIAL until Phase 24 lands. **Phase 24's criterion 8 has now landed
MET, so RULING A's precondition is satisfied for both.** See the section below; the rows must be
told, and the closures themselves belong in dated amendments to `19-VERIFICATION.md` and
`17-VERIFICATION.md`, not here.

**L5 — `.planning/STATE.md`.** Phase 24 is 4 of 4 plans, verified **1 of 1 with criterion 8 MET**,
and is therefore **COUNTED**. The frontmatter note beginning *"Phase 24 joined that list on
2026-08-06 and it did NOT join the count"* is superseded. The count moves **9 → 10 of 15** on
Phase 24 alone; if L4's two amendments are written and score as recommended it moves to **12 of
15**, leaving 20 (6/7), 21 (2/3) and 22 (not executed). The three pending owner rulings listed in
STATE.md's frontmatter reduce to two: *"whether a seed may be told which issuers it admits"* was
**ruled on 2026-08-06** (`0e8e7cd`) and delivered.

**L6 — `packages/node/src/mutation-ledger.ts`, `M67`.** Add
`packages/node/src/closed-fabric-agents.node.test.ts` to `caughtBy`. The entry's own text
instructs this, conditional on the file becoming git-tracked; it is tracked as of `241a9cc`. (Not
a planning-ledger edit, but it is a ledger and it is due in the same pass.)

### MUST NOT change

- **Criterion 8's wording.** Verified unedited, one commit ever. This amendment reads it and
  states the reading; it does not narrow it. If the owner disagrees with the reading, the correct
  instrument is an `overrides:` entry or a dated owner note beside the criterion — **not** a
  change to its words, and **not** a verifier silently adopting the other reading either.
- **AUTH-02's and AUTH-04's checkboxes stay `[ ]`; both `Partial` cells stay `Partial`.** Each has
  live clauses Phase 24 did not close, and `acceptance-traceability.node.test.ts` reddens by name
  on an overstatement.
- **The default posture must not be closed to make the criterion read better.** Nineteen
  `bin/agent.ts` and three `bin/seed.ts` argv sites depend on it and
  `reservation-exhaustion.node.test.ts` arm A is a live guard on it. Changing it is open ruling 1,
  and it is the owner's.
- **`CLOSED_RELAY_CAPABLE` must not be bumped to paper over W6.** The repair is either a corrected
  comment or a set derived from the spawn sites — never a larger constant.
- **`BENCH-03` does not move**, and `bin/bench.ts`'s three open literals (W9) must not be "fixed"
  by pinning: pinning would move every published rung.

---

### Do Phase 17 criterion 3 and Phase 19 criterion 5 close?

**Yes — the RULING A precondition is now satisfied for both, and both should close by dated
amendments to their own verification files.** This verifier does not close them here: it was not
asked to verify those phases, and their scores live in files this pass does not write.

RULING A as `.planning/STATE.md` states it: *"a carried criterion stays PARTIAL until its
destination lands"*, applied **per criterion** — the reading `16-VERIFICATION.md`'s 2026-08-06
amendment took, and before it `18-VERIFICATION.md`'s of 2026-08-04. Criterion 8 **is** the
destination of both, by owner ruling: Phase 19's criterion 5 (`ROADMAP.md:1191-1222`) and Phase
17's criterion 3, whose **cost** clause STATE.md records as *"carried to Phase 24 criterion 8"*.
Criterion 8 has landed **MET**. The condition is met.

What each then needs, and it is a re-read rather than a rubber stamp:

- **Phase 19 criterion 5** — *"enrolment costs something unmintable, and the N-th identity costs
  more than the first."* The unmintable half was already delivered and measured across real
  processes including a provider restart. The N-th-identity half was relocated, not lowered: under
  a closed fabric an unissued identity buys nothing, so the price of the N-th identity is the
  provider's signature. **This verifier re-read the economics on the current tree** and they are
  where Phase 19 left them; the counted half — three full issuances for three askers against zero
  reservations — is a **count**, needs no calibration, and reproduces. Expected: **PARTIAL →
  MET**, Phase 19 **4/5 → 5/5**.
- **Phase 17 criterion 3** — *"…refused beyond a stated threshold rather than accepted unbounded —
  making mass fake-node creation measurably costly."* The rate-limiting half is delivered
  (`maxIssuedPerWindow`, a durable host-owned ledger, survives a provider restart). The cost half
  is criterion 8's, and it now reads MET on a closed fabric. Expected: **PARTIAL → MET**, Phase 17
  **2/3 → 3/3**.

**One caveat the amending verifier must not skip.** Criterion 8 is MET **with a bound** — of a
fabric an operator has closed. A carried criterion cannot inherit more than its destination
delivered, so both amendments must carry the same bound in the same words. A closure that drops
it would be exactly the softening RULING A exists to prevent.

---

### Human verification required

1. **Ratify the reading of *"the fabric"*, or reject it.** This amendment adopts *"a fabric this
   repository can be deployed and operated as, with a posture stated on every door"*, on the
   ground that the first pass named MET as route (a)'s destination and the owner ruled route (a)
   on 2026-08-06. **If the owner intends the wider reading**, criterion 8 returns to PARTIAL and
   the only route is open ruling 1 — and the instrument is an `overrides:` entry or a dated owner
   note beside the criterion, never an edit to its words.
2. **Rule on `24-CONTEXT.md` open ruling 1** — should `bin/agent.ts` and `bin/seed.ts` refuse to
   start when the operator states neither a pinned issuer nor an explicit open posture? Its cost
   is already measured: 19 + 3 argv sites and one live behavioural guard. Deliberately unplanned.
3. **Apply L1-L6.** A verifier may not apply the ledger edits it recommends. L1, L2 and L3 are the
   urgent ones: three permanent records currently assert *"a seed cannot be told to close"*, which
   is false, and that is the precise shape this repository has been bitten by — a reader who
   believes it stops looking.
4. **Write the two carried-criterion amendments (L4).** With the bound carried verbatim.
5. **Re-confirm the 23 → 24 → 22 ordering.** The 2026-08-05 ruling put 22 after 24 so the
   reachability guard would certify a **gated** fabric. Its premise has moved again and this time
   favourably: a fabric can now be closed at every door, so Phase 22 can be run against one and
   `22-VERIFICATION.md` should be told which posture it certified.
6. **Remove `**Mode:** mvp` from Phase 24's ROADMAP block, or restate the goal as a User Story**
   (W5′). Unchanged from the first pass.

---

### Gaps summary

There are no gaps in the phase's own criterion.

The first pass found the mechanism real and the criterion's words wider than the evidence, and it
named precisely what would change that: a knob on the seed, and a reading over a fabric rather
than a relay. Both landed. The knob is required rather than optional, typed by indexed access so
it cannot drift, validated with its own message, printed in the seed's banner — and, which is the
part that matters and the part this verifier measured rather than read, **wired to the door and
not to the label**: a plant that left `seed-server.ts`, the option type, the validator and the
entire banner intact and changed only which argv key `bin/seed.ts` reads put an uncertificated
peer into `/bootstrap.json` and turned the file red.

The reading is now over a set of six closed doors with two uncertificated subjects, one of them
the very node whose admission falsified the previous defence, both of them absent everywhere and
both present at the one door nobody closed. The surface no test read as a gated one is read
twice, once over HTTP at the Node tier and once through the browser's own discovery round in
three engines. And the thing that could have made a fully-closed fabric unbuildable — that
nobody could ever enrol — is measured false inside the same fixture that needs it to be false.

**What is not delivered is the default, and it is not delivered on purpose.** This repository
ships open, held there by nineteen plus three argv sites and one live behavioural guard, and
whether it should is an owner ruling that was deliberately left unplanned. That is the bound this
MET carries, and it travels with every closure that inherits from it.

Three smaller things are true and should be recorded rather than found later. The "whole set" is
a hand-maintained literal whose docblock describes a protection it does not have — proved, not
argued (W6). One secondary assertion reads a handshake-time snapshot and is sound only because of
a measured property of libp2p that is not named at the assertion (W7). And a third binary still
cannot be told to close, disclosed at each of its sites, which is a measurement rig rather than a
deployment path (W9). None changes the verdict; all three are cheaper to fix now than to
rediscover.

---

_Re-verified: 2026-08-06 at `1b7f99d`, working tree clean before and after; both plants restored
with `cp` and confirmed with `cmp` exit 0 and `git diff --quiet` exit 0 over the whole tree._
_Verifier: Claude (gsd-verifier), second independent pass._
_No source, ledger, roadmap or state file was modified. Nothing was staged, committed or stashed._
_Every exit code above was read with `EXIT=$?` on the immediately following line, no pipes._
