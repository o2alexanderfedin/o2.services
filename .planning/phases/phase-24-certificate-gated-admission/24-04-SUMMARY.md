---
phase: phase-24-certificate-gated-admission
plan: 04
subsystem: admission
tags: [AUTH-02, AUTH-04, BENCH-03, relay, criterion, browser-tier]
requires:
  - RelayAdmission as a required named union on FabricNodeOptions (24-01)
  - the pre-gate baseline of three host-independent counts (24-02)
  - a connectionGater consulting RelayAdmission at the reservation and nowhere else (24-03)
  - bin/agent.ts --admit-issuer, with the posture published on the handshake line (24-03)
provides:
  - criterion 8's three clauses read across six real bin/agent.ts processes, each with a plant that reddens it alone
  - the browser tier's refuse-enrol-admit transition in chromium, firefox and webkit, on the co-located topology no fixture stood up before
  - the measured fact that admission is PER-RELAY — a peer the gate refuses reserves on the open provider it dialled to enrol
  - the measured fact that a node with no relayAddrs of its own cannot dial a relayed peer at all
  - the enrolment residual re-read on an armed tree and recorded as unchanged, with both directions planted
  - the relay-side refusal reasons, read where they exist, and the finding that they have no wire surface
  - mutation-ledger M66 — the gate's own verdict, planted and watched
affects:
  - packages/node/src/admission-agents.node.test.ts
  - packages/node/src/gated-admission.e2e.test.ts
  - packages/node/src/enrolment-residual.node.test.ts
  - packages/node/src/mutation-ledger.ts
  - vitest.config.ts
tech-stack:
  added: []
  patterns: [paired-arm-in-one-run, assembled-matcher, absence-with-a-presence, instrument-on-the-other-side, observed-value-thunk]
key-files:
  created:
    - packages/node/src/admission-agents.node.test.ts
    - packages/node/src/gated-admission.e2e.test.ts
    - packages/node/src/enrolment-residual.node.test.ts
  modified:
    - packages/node/src/mutation-ledger.ts
    - vitest.config.ts
decisions:
  - Clause 1 is read from the joiners' side, because the relay's store is the same list clause 2 reads and two clauses on one instrument cannot fail alone
  - The gated relay is a bin/agent.ts process, never a seed — a seed's posture is hardcoded open and cannot be gated
  - The browser topology built is the CO-LOCATED one, named in the file alongside the three-node one that was not built
  - A tab's admission is read from the relay's store, and the tab's own constant answer is asserted in both arms so the tautology is demonstrated rather than warned about
  - REQUIREMENTS.md was written, measured green, and then NOT committed — the wave instruction overrides the plan's files_modified
metrics:
  duration: ~1h
  completed: 2026-08-06
---

# Phase 24 Plan 04: Read the criterion, and measure what it does not fix — Summary

Criterion 8's three clauses are read across six real `bin/agent.ts` processes and in three
browser engines, each clause with a plant that reddens it alone; the residual this phase does
not fix is a measured ratio recorded as unchanged; and the phase's own claim is bounded by a
finding that was not planned — **admission is per-relay, and the fabric is only as closed as
its most open relay-capable peer.**

**The criterion is numbered 8**, inherited from Phase 19. **Phase 24 has exactly one
criterion, so a verification scores it out of 1, not out of 8.** A `24-VERIFICATION.md`
reporting "1 of 8" would be describing a phase that does not exist.

## THE FINDING THAT BOUNDS THE PHASE, and it was found rather than planned

The wrong-issuer arm of task 1 failed an assertion that its `relays` list would be empty. It
was not empty. Measured, one run, printed by the case that now owns it:

| arm | relay-capable peers it dialled | circuit through |
|---|---|---|
| `stranger` — no certificate | the gated relay only | **nothing** |
| `member` — pinned issuer's certificate | gated relay + provider | the **gated relay** |
| `outsider` — another issuer's certificate | gated relay + other provider | the **other provider** |

**The mechanism.** `--provider-addr` makes a joining node dial its enrolment provider
directly — deliberately, because sub-decision 1 depends on enrolment riding a plain
connection no reservation gates. But libp2p's `RelayDiscovery` fires off **identify** for any
peer that speaks the relay HOP protocol, and a `bin/agent.ts` provider started with `--port`
is relay-capable and, absent `--admit-issuer`, admits everybody. **So the peer a joiner must
dial in order to be certified is itself an open door, and the joiner walks through it.**

The instrument proved it a second time by accident: the in-process reader holds no
certificate, the gate refused it, and dialling the open provider to read its advertisement
was enough to get it a reservation there. Its id is named in the published reading so the
extra entry is attributable rather than mysterious.

**What this does and does not qualify.** Criterion 8's subject is *"a node that cannot present
a provider-issued certificate"*, and `stranger` is that node: refused, advertised nowhere,
reachable through no route the fabric offers, in the fabric nowhere. **The clause holds.**
What it does **not** license is reading *"cannot join the fabric"* as a property of the
fabric rather than of a relay. In this repository the open set includes every
`bin/agent.ts --port` without `--admit-issuer` and **every `bin/seed.ts`**, whose posture
24-01 hardcoded open deliberately.

This is not a defect of the gate. `denyInboundRelayReservation` is per-relay by construction
and 24-CONTEXT chose it for that property. It is a statement about deployment, and a summary
that omitted it would read wider than the evidence.

## The three clauses — which was read, how, and on what instrument

**Every clause is a separately-named case, and the instruments are deliberately different.**

| clause | instrument | paired against |
|---|---|---|
| **1 — cannot join** | the **joiner's own** handshake `relays` (no circuit through the gated relay, and none at all) plus `agent.ts: relay reservation refused: PERMISSION_DENIED` on its stderr | the enrolled arm holding exactly one circuit through the same relay |
| **2 — cannot advertise** | the gated relay's `reservations` answer **taken over the wire** — the surface `findReservedPeers` reads, answered from `fabric-node.ts`'s `() => node.reservedPeerIds` **thunk** | the enrolled arm's id present in the same list, in the same run |
| **3 — cannot be dialled** | what the reader **derived** from that answer: zero addresses for the unadmitted arm, one for the enrolled arm — then the dial | the enrolled arm reached over the derived circuit address |

**Clause 1 being read from the joiner's side was a repair, and it is the most important
design decision in the file.** It was first written against the relay's reservation store —
which is *the same list clause 2 reads*. Two clauses on one instrument cannot be shown to
fail alone; that is one reading asserted three times. 24-CONTEXT says why they are one list:
*"both advertisement surfaces are derived from `reservedPeerIds`… no filter to add, no `if`
to forget."* Clause 3 rides on the same list, by the same construction, and the file says so
rather than inventing a third instrument that would have been the same list under a new name.

**Clause 3 measures a process, not a timeout.** For the unadmitted arm there is *nothing to
attempt* — the derived route list is empty and no dial is ever made. And the limit of the
clause is asserted in the same run rather than asserted around: **handed the unadmitted
peer's direct address, the reader reaches it immediately.** The refused node is not broken
and is not unreachable. It is **unfindable**, and those are different claims.

**`BootstrapInfo.peerAddrs` was NOT read, and that is a finding rather than an omission.**
The plan's `key_links` names it and its plant (b) targets it. A seed cannot be gated —
24-01 hardcoded `relayAdmission: 'admits-any-peer'` at `seed-server.ts`'s `FabricNode.start`,
*"not derived from `trustedIssuers` … because the two are different questions"* — so a seed
advertises an uncertificated peer that reserved on it, and pointing joiners at a seed they
never reserved on would produce an absence for want of asking. **That surface is UNMEASURED
as a gated one**, and it is unmeasurable until a seed can be told to close.

## The browser tier — three engines, and the topology named in the file

`gated-admission.e2e.test.ts` builds the **co-located** topology: one `FabricNode` is the
tab's relay, its enrolment provider, **and** the pinner of `relayAdmission`. That is what
sub-decision 1 is actually about and **no fixture in the tree stood it up at this tier**.
The three-node arrangement `browser-enrollment.e2e.test.ts` has is named in the header
alongside it, with what it would have shown instead: there, refusal and issuance happen at
different processes, and *"refused then enrolled through the same address"* would mean the
same address as the *relay*, not as the *gate*.

Built on the **production option** — a two-step start that mints and persists the issuer key,
stops, and restarts on the same `blockstoreDir` with that key pinned — rather than by
assigning onto libp2p's live gater object as `enrol-through-a-closed-door.node.test.ts`
legitimately does. That file had to; the option did not exist when it was written. A reading
that installed its own gate would be grading a hook instead of the path a deployment takes.

**chromium, firefox and webkit all green.** No engine was excluded. The transition is
asserted on **the same peer id in both arms**, from the same origin's persisted seed.

**Its shape is named rather than implied.** 24-03 measured that a refused peer never retries
on its own and that a *reconnection* is what gets it in. The tab API exposes no `hangUp`, and
`dial` on an already-connected peer is a no-op — so what is available inside one page load is
`stop()` then `start()`, a node restart in the same tab. **A live browser-tier re-reservation
is UNMEASURED**, and inventing a `hangUp` for it would be this plan editing the mechanism it
grades.

**The tautology is demonstrated, not warned about.** `browser-node.ts` passes
`reservations: 'relays-for-nobody'`, so a tab answers `[]` about itself whatever its
admission state. The file **asks the tab in both arms and asserts the same constant**, in the
same run as the real reading — permanently, rather than once by a mutation and then forgotten.

## The residual, measured and unchanged

**This phase does not shrink the enrolment DoS surface. It cannot, and it must not.** A
summary that reads otherwise is the defect `enrolment-residual.node.test.ts` was written to
prevent.

| reading | observed 2026-08-06, load 3.44, 8 cores | Phase 19's band |
|---|---|---|
| refuse-over-mint | **3.070** | 2.96–3.16, nine readings |
| refuse-over-replay | **9 351** | 3 758–7 501 |

The first is **inside** Phase 19's band, on a tree where the gate exists and is armed — so
"unchanged" is a reading rather than an assertion. The second is **above** it, and that is a
statement about the instrument: `enrollment-dos.node.test.ts` records its replay denominator
sitting at 0.5–0.75 µs, a couple of `performance.now()` ticks, so every reading of that
quotient is floored by the clock and *understates*. A larger number on a quieter host is the
same fact measured against a finer floor. **Reading it as increased exposure would be reading
the clock.**

**What did change, as a count — counts need no calibration.** A relay that issues
certificates of its own while pinning a different provider performs **three full issuances
for three askers and grants zero reservations**. Every millisecond the provider spent produced
an identity worth nothing. And the paired arm carries it: the same door, a peer holding the
*pinned* issuer's certificate, admitted in the same run.

## The relay's own words, and the fact that nobody hears them

`FabricNode.admissionDecisions` is an in-process getter with **no wire surface**, so this is
the only place the door's reasons can be read:

| case | reason |
|---|---|
| no certificate | `… holds no provider-issued certificate, so it is not admitted to this relay` (attempt **1**, **5 ms**) |
| wrong issuer | `… refused: certificate issued by ca031a7a…, which is not a pinned provider` (attempt **2**, **816 ms**) |
| admitted | `… holds a certificate from a pinned issuer` (attempt **2**, **817 ms**) |

The attempt counts are 24-03's retry-not-wait design working: the no-certificate verdict is
definitive on the first ask because the peer *answered*; the other two need the second ask.

**Across a process boundary all of this collapses to one string.** `admission-agents` asserts
that the refusal lines on the two refused agents' stderr are **identical** — both
`PERMISSION_DENIED`, neither carrying a reason. An operator debugging a refused agent from
that agent's own output cannot tell "no certificate" from "wrong issuer". That is a finding,
not an omission, and it is filed rather than fixed: fixing it is a mechanism change and this
plan grades the mechanism.

## Premises found FALSE, and my own errors caught

### 1. The plan's plant (b) names a surface this reading cannot use

*"Make `BootstrapInfo.peerAddrs` include a peer with no reservation — clause 2 reddens while
clause 1 stays green."* That is the seed's surface, and a seed cannot be gated (above), so
clause 2 is not read there. Adapted to the surface clause 2 *does* read —
`fabric-node.ts`'s `reservations` thunk — and it delivers exactly the demonstration the plan
asked for.

### 2. A node with no `relayAddrs` of its own cannot dial a relayed peer at all

`fabric-node.ts`: `transports: viaRelay ? [tcp(), webSockets(), circuitRelayTransport()] :
[tcp(), webSockets()]`. The reader's first dial of the enrolled arm's circuit address failed
`NoValidAddressesError: The dial request has no valid addresses for peer: …`, which would
have read as *"the enrolled arm is unreachable too"* and been an artifact of the instrument.
Repaired by giving the reader `relayAddrs`, which costs nothing and buys something: **the
instrument is now itself a peer the door refused**, which is the sharpest available statement
that a refused node still works.

### 3. Clause 1 and clause 2 shared an instrument (mine, caught by a plant)

Recorded above. Caught by plant 2 reddening both.

### 4. My clause-1 failure was a duration equal to a timeout

With the stderr wait ahead of the circuit-address assertion, plant 1 produced
`timed out waiting for the refused agent to name its refusal on stderr` at **62 499 ms
against a 60 000 ms budget**. 24-02 records the rule: *a duration equal to a timeout is
evidence of the timeout and of nothing else.* Reordered so the load-bearing reading runs
first; the same plant now reddens it in **2 424 ms** naming the fact.

### 5. My per-relay case was racy, and read a state that was still moving

It asserted on the joiner's one-shot handshake line. `bin/agent.ts` writes that line as soon
as it sees *either* a circuit address *or* a reservation failure, so for a refused peer the
failure can arrive first and the fall-through has not completed. **It failed once in four
runs.** Replaced with a live reading over the open provider's own advertisement, with a
budget and an observed-value thunk.

### 6. My first plant on the refusal path was too weak to be evidence

Six extra `possessionChallenge` calls moved refuse-over-mint 3.070 → **3.051** — a canonical
encode is nothing beside two curve operations. **A plant that does not move the instrument is
not evidence the instrument is stuck.** Replaced with six extra `ed25519.verify` calls:
3.070 → **11.946**, a factor of 3.9 against an arithmetic expectation of 4.

### 7. `FabricNode` publishes no `relayAdmission` getter

The browser file's posture assertion was written against one. Adding a getter would be
editing the mechanism, so the posture is read off the file's own source with **assembled**
needles, on `static-rendezvous.e2e.test.ts`'s rule.

### 8. The wrong-issuer refusal text is not `untrusted-issuer`

That is `verifyCertificate`'s failure *kind*; the gate renders its own sentence. My first
assertion was the guess rather than the tree, and it went red. The observed text is now
asserted, along with the fact that it **names the offending issuer**.

### 9. My handshake interface made the repository declare the field twice

`relay-admission.node.test.ts`: *"declares the field in exactly one type, so two factories
cannot drift"* — `expected 2 to be 1`. A reader's view of a JSON line is not a second
factory, but the census reads text and cannot tell them apart. **The repair is on my side, not
in the guard** — *never close a gap by widening what counts as passing.* The posture is lifted
out by a key constant that carries no colon and so matches neither needle.

## Plants — every one counted before it was applied, watched, and restored by `cp` + `cmp`

| # | Plant | Instrument | Observed |
|---|---|---|---|
| 1 | `--admit-issuer` dropped from the gated relay's argv | `admission-agents` | **all six cases red.** Fixture: `expected 'admits-any-peer' to strictly equal [ Array(1) ]`. Clause 1: `expected [ Array(1) ] to strictly equal []`, 2 424 ms |
| 1′ | the same plant **before** clause 1 was reordered | `admission-agents` | `timed out waiting for the refused agent to name its refusal on stderr` at **62 499 ms / 60 000 ms budget** — see finding 4 |
| 2 | `reservations` thunk widened to `[...reservedPeerIds, ...transport.peers]` | `admission-agents` | clause 2 `expected [ …(5) ] to not include '12D3KooWQPkP…'`; clause 3 `expected [ Array(1) ] to strictly equal []`; wrong-issuer `stopped holding after 4ms`. **Clause 1, the fixture case and the per-relay case all GREEN** — the demonstration the plan asked for |
| 3 | `reservations: 'relays-for-nobody'` (M60's own mutation) | `admission-agents` | clause 2's **presence** half: `timed out waiting for the enrolled arm to appear in the relay’s advertisement; observed {"memberRelays":["…/p2p-circuit/p2p/…"]}` — the thunk names the circuit the member really holds, so the failure is attributable. Clause 1 green |
| 4 | the door opened in `gated-admission.e2e.test.ts` | `gated-admission` | posture case red in **5 ms, before a browser launches**: `expected '/**\n * Criterion 8 at the browser ti…' to contain 'relayAdmission: new Set<PublicKeyHex>…'`. All three engines: `<engine>'s unenrolled tab staying out of the door's reservation store stopped holding after 0ms; observed {"reserved":[…],"decisions":[]}` — **`decisions: []`** is the sharpest half: the open posture supplies no gater method at all, so nobody was asked |
| 5 | **M66** — the gate's no-certificate verdict flipped to admit | `enrolment-residual` | `expected true to be false // Object.is equality`, on the named case **alone**, with the wrong-issuer arm beside it still refusing |
| 6 | six extra `possessionChallenge` calls on the refusal path | `enrolment-residual` | **GREEN**, 3.070 → 3.051 — recorded because a plant that cannot move the instrument is not evidence |
| 7 | six extra `ed25519.verify` on the refusal path | `enrolment-residual` | 3.070 → **11.946**, factor 3.9 against an expected 4 |
| 8 | eight extra signatures charged to the mint arm | `enrolment-residual` | `expected 0.8775283789015611 to be greater than 1.5`, beside `enrollment-dos`'s own 0.8938 at the same stake |
| 9 | AUTH-02 checkbox `[ ]` → `[x]` | `acceptance-traceability` | `AUTH-02 — [x] at .planning/REQUIREMENTS.md:270 against **Partial** at .planning/REQUIREMENTS.md:692` — five cases red |
| 10 | *(found, not planted)* `readonly relayAdmission:` on the handshake interface | `relay-admission` | `expected 2 to be 1` — see finding 9 |

The plan's plant (c) — *"hand the third agent the unadmitted peer's address directly; clause 3
must then succeed"* — is **a standing assertion rather than a plant**. It is the last line of
clause 3 and runs on every green, which is strictly stronger than demonstrating it once.

## `slow-specs.node.test.ts` — re-sited, not widened, and drift is 0

`NODE_MEASUREMENT.files` **162 → 164** for exactly the two node-project files this plan adds;
the third is `*.e2e.test.ts`, which that project excludes and which moves nothing. Verified
by two routes sharing no code: the guard's own filesystem walk, and a regex over
`git ls-files` — **both 164, drift 0** against a tolerance of 5. The tolerance was not touched.

Both spans are **measured**, not estimated, and are above `SLOW_CUTOFF_MS`:

| file | reporter span | solo `real` | boot floor, same session | agreement |
|---|---|---|---|---|
| `admission-agents.node.test.ts` | 34 973 ms | 36.30 s | 1.49 s | 34.81 vs 34.97, within 0.5 % |
| `enrolment-residual.node.test.ts` | 7 022 ms | 8.57 s | 1.49 s | 7.08 vs 7.02, within 1 % |

Neither is hook-shadowed — the heavy work is inside each `it`. `sumOfFileSpansMs` moves by
exactly 34 973 + 7 022 and by nothing else; the pre-existing 7 943 ms discrepancy the table
already carries is left carried rather than silently absorbed. `unitFiles` does **not** move,
and that is arithmetic: both new spans are above the cutoff, so the derived exclusion list
grows by the same two.

## Measurements, exit codes read directly

| Command | Exit | Result | Process reading |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | zero bytes of output, four times | — |
| `--project node` | **0** | **164 files, 2305 passed, 2 skipped** | `real 241.17 user 377.99 sys 54.80`, ratio **1.79** |
| `--project browser` | **0** | 249 files, 4092 tests — identical to 24-02 and 24-03 | `real 36.97 user 90.09 sys 20.00`, ratio **2.98** |
| `--project e2e` | **0** | 16 files, 76 tests (was 15 / 72) | `real 205.08 user 100.37 sys 23.01`, ratio **0.60** |
| `admission-agents` solo | **0** | 6 tests | `real 36.30 user 30.39 sys 5.02`, ratio **0.98** |
| `gated-admission` solo ×2 | **0** | 4 tests, all three engines both times | `real 28.08 / 24.30`, ratios **0.32 / 0.32** |
| `enrolment-residual` solo | **0** | 4 tests | `real 8.57 user 2.15 sys 0.43`, ratio **0.30** |

**Load at both ends, because this host has swung 5 → 64 today:** the session opened at
1-minute load **7.11** (5/15-minute 24.03 / 33.51) and closed at **6.53**; the node run
started at 7.91 and ended at 9.89; the browser run ended at 17.12. A foreign
`transpilers/cpp-to-rust` build and OrbStack were running throughout.

**`--project node` is green — the first fully green node project in this phase.** 24-01
carried a `slow-specs` drift failure and 24-03 carried a `late-combine` timing failure.
`vitest.config.ts`'s own docblock says a full `NODE_MEASUREMENT` retake *"is still blocked on
the same thing it was blocked on in August: a green `--project node` from which a `test:unit`
reading can be taken."* **That block is now clear.** The retake was not taken here — it would
commit this session's load into a shared table, and this plan measured two spans, not forty.

**24-02's pre-gate baseline re-run and byte-identical for the third time:**
`room-for-everyone {connected 4, granted 3, advertised 3}` and
`room-for-all-but-one {connected 4, granted 2, advertised 2}`.

## Deviations from plan

**1. [Rule 3 — blocking] `vitest.config.ts` was edited and is not in `files_modified`.** Two
new node-project specs at 35 s and 7 s would otherwise have stayed inside `test:unit` for
ever. 24-03 made the same edit for the same reason. Both spans measured and cross-checked; the
tolerance was not widened.

**2. [Rule 4 → the instruction wins] `.planning/REQUIREMENTS.md` was written, measured, and
then reverted.** The plan's `files_modified` lists it and task 3 requires the rows to move.
The executing instruction for this wave says not to touch it — *"today's ledger close was by
hand"* — and the later, more specific direction governs. **Nothing here is descoped:** the
edit was written, both ledger guards ran green over it, and the overstatement plant (9 above)
was watched failing by name. The intended text is carried verbatim below. Committed as
`7fb76fc` so the audit trail shows the work rather than its absence.

**3. Clause 1's instrument moved from the relay to the joiners.** Reasoned above. It is a
change to what the plan's `behavior` block prescribed — *"Read it from the seed's own
`reservedPeerIds`, and from the agent's stderr"* — and the reason is that following it would
have made clause 1 and clause 2 the same reading.

**4. Plant (b) was re-targeted from `seed-server.ts` to `fabric-node.ts`.** The plan's target
is not a surface this reading can use. Reasoned above.

## Correction applied 2026-08-06, after verification — the process count was FIVE and is SIX

`24-VERIFICATION.md` warning **W3** measured it: `spawnAgent` runs for `provider`,
`other-provider`, `relay`, and three more times inside `joinFabric` (`member`, `stranger`,
`outsider`) — **six** `bin/agent.ts` children, plus one in-process `FabricNode` reader. The
wrong figure stood in three places, all corrected in this pass: twice in this file (the
frontmatter `provides` line and the opening paragraph), once in
`admission-agents.node.test.ts`'s own Budget section — and it had propagated into the
**AUTH-02 requirement row drafted below**, which is why it had to be corrected before that
row landed in a permanent ledger. The test file's own reader paragraph calling the reader
*"a seventh child"* it declined to spawn was consistent with six all along, and is the
sentence that made the contradiction findable.

**The ledger rows below HAVE now landed**, on 2026-08-06, with W3's correction applied and
with the bound `24-VERIFICATION.md` added: `bin/seed.ts` is not merely still open, it
**cannot be told to close** — no flag, no `SeedServerOptions` field — which is why criterion
8 verifies **PARTIAL** (0 of 1) rather than passing with a stated bound. Neither checkbox
moved; both verdict cells stay `Partial`.

## Notes for the verifier — ledger changes this plan did not land

`STATE.md` and `ROADMAP.md` were **not** edited, on instruction. `REQUIREMENTS.md` was edited,
verified, and reverted, also on instruction. What this plan would otherwise have recorded:

- **Phase 24 progress: plans 1–4 of 4 complete. The phase is closed.**
- **A verification of this phase scores criterion 8 out of 1, not out of 8.**
- **Neither AUTH-02's nor AUTH-04's checkbox moves.** Both stay `[ ]` / **Partial**, and
  `acceptance-traceability.node.test.ts` enforces the pairing — planting AUTH-02 to `[x]`
  reddens five cases by name.

**The exact text to append to AUTH-02's traceability row** (immediately after
*"…it is simply no longer the only path to `verifyCertificate`"*):

> **Phase 24 closed the ADMISSION half, which is a different half from everything above and
> was previously unrepresentable.** Every certificate check named above decides who a node
> will *use*; `relayAdmission` decides who gets *in*. `FabricNode` now supplies
> `connectionGater.denyInboundRelayReservation`, which asks a joining peer for its records
> over the fabric's own RPC, verifies the certificate offline against a pinned issuer set, and
> refuses the circuit reservation when it does not chain. **Measured across six real
> `bin/agent.ts` processes** in `packages/node/src/admission-agents.node.test.ts`: an agent
> with no certificate holds no circuit through a gated relay and is told `PERMISSION_DENIED`
> by name, is absent from the relay's `reservations` answer in the same list an enrolled agent
> is present in, and a third node given only what the relay advertises derives **no address at
> all** for it — while that same node, handed the refused agent's direct address, reaches it
> immediately, so the clause is about discovery and not about reachability. **And in three
> browser engines** — chromium, firefox and webkit — in
> `packages/node/src/gated-admission.e2e.test.ts`, on the co-located topology
> `24-CONTEXT.md` sub-decision 1 requires and which no fixture stood up before: one node is
> the tab's relay, its enrolment provider and the pinner, and the same tab id is absent from
> that node's reservation store unenrolled and present in it enrolled. **Three things this
> does NOT close, each measured rather than assumed.** (1) The browser tier still pins nobody
> and reaches no verdict about a peer — Phase 22 owns the move, per `DEFICIENCIES.md` D09 — so
> the asymmetry named above is untouched. (2) The `records` and `providers` answers are not
> gated; `24-CONTEXT.md` files that as a deferred idea and a directly-dialable peer still
> reaches both. (3) **The clause holds of a relay, not of the fabric**: the last case in
> `admission-agents.node.test.ts` measures a peer the gate refused obtaining a reservation on
> the open provider it had to dial in order to enrol, because libp2p relay discovery fires for
> any peer speaking HOP. Admission is per-relay by construction, and every `bin/seed.ts` is
> still open — 24-01 hardcoded that posture deliberately

**The exact text to append to AUTH-04's traceability row** (immediately after *"…and the
surface it opened is pinned by nothing"*):

> **Phase 24 devalued the identity instead of pricing it, and the residual is now measured
> rather than argued.** The owner's ruling of 2026-08-04 replaces the pricing approach: under
> gated admission an identity the relay will not admit buys nothing, so the cost of the N-th
> identity is a provider's signature — the unmintable thing this requirement already secured —
> rather than CPU. What that does **not** do is shrink the enrolment DoS surface, and this row
> must not be read as saying it did. `packages/node/src/enrolment-residual.node.test.ts`
> re-reads Phase 19's method on a tree where the gate exists and is armed: refuse-over-mint
> **3.070**, inside the 2.96–3.16 band nine prior readings spanned, and refuse-over-replay
> **9351**, above the recorded 3758–7501 band for a reason that is about the instrument rather
> than the code (the replay denominator sits at the clock's own resolution, so every reading of
> it understates). The same file measures what the phase *did* change, as a count, which needs
> no calibration: a relay that issues certificates of its own while pinning a different
> provider performs **three full issuances for three askers and grants zero reservations** —
> every millisecond the provider spent produced an identity worth nothing. It also reads the
> relay-side refusal reasons, which have no wire surface at all: *"holds no provider-issued
> certificate, so it is not admitted to this relay"* against *"certificate issued by …, which
> is not a pinned provider"*, two different sentences that reach a joiner in another process as
> one undifferentiated `PERMISSION_DENIED`. The `serveAgent` `enrol` branch is unchanged and
> still takes no authorization step; `M66` pins the gate's own no-certificate verdict

**BENCH-03** is already `Done` and nothing here moves it. 24-02's baseline was re-read
byte-identical, so no published curve moved.

## What this plan did NOT do

- **It changed no mechanism.** Not one production source file was modified. A plan that both
  builds and grades its own work has no reading.
- **It did not read `BootstrapInfo.peerAddrs` as a gated surface.** It cannot be one today.
- **It did not measure a live browser-tier re-reservation.** No `hangUp` exists on the tab API.
- **It did not build a wrong-issuer arm at the browser tier.** That arm exists across real
  processes only.
- **It did not close `records` / `providers` gating**, quorum membership or dispatch selection.
  All three remain UNMEASURED and not descoped.
- **It did not retake `NODE_MEASUREMENT`**, though the green node run has now cleared what that
  retake was blocked on.
- **It did not move `PeerVerifier` or give the browser tier an issuer to pin.** Phase 22, D09.
- **`STATE.md` and `ROADMAP.md` are untouched; `REQUIREMENTS.md` is back at `HEAD~`.**

## Known stubs

None. Every value asserted is read from a live node, a real process's stdout, a live tab, or
the source of the file that owns the construction. No placeholder, no hardcoded empty, no
`TODO`.

## Self-Check: PASSED

- `packages/node/src/admission-agents.node.test.ts` — FOUND
- `packages/node/src/gated-admission.e2e.test.ts` — FOUND
- `packages/node/src/enrolment-residual.node.test.ts` — FOUND
- `packages/node/src/mutation-ledger.ts` — FOUND
- `vitest.config.ts` — FOUND
- `1d81de1` — FOUND (1 file)
- `167c21a` — FOUND (1 file)
- `3f33e3e` — FOUND (1 file)
- `91ece11` — FOUND (1 file)
- `5562a45` — FOUND (3 files)
- `7fb76fc` — FOUND (1 file)
- `.planning/REQUIREMENTS.md` — byte-identical to `db14fbd`, confirmed by `git diff`
