# Phase 24: Certificate-Gated Admission — Context

**Gathered:** 2026-08-04
**Status:** Ready for planning
**Origin:** Owner ruling 2026-08-04. Written as Phase 20 criterion 8, relocated the same day by a
second owner ruling — *"yes, I know. Plan it for later."* — into its own phase so it blocks
nothing.

<domain>
## Phase Boundary

A node's lifecycle in the fabric begins at the relay reservation. A node that cannot present a
provider-issued certificate does not get one — so it cannot join, cannot appear in any
advertisement, and cannot be dialled. Enrolment itself stays open, because it is how a node gets
its first certificate.

**The owner's ruling, verbatim (2026-08-04):**

> *"The lifecycle of the node in the network starts from connecting to the relay. If the node that
> connects in can authenticate itself with certificate issued by provider, then it gets in to
> advertise itself in the network and connect to nodes. If it cannot authenticate — it cannot join
> the network and connect to other nodes."*

**Why that answers a cost clause rather than ducking it.** A price only deters when the thing
bought is worth something. Under gated admission an unissued identity is worth **nothing** — it
cannot join, advertise or be reached — so the cost of the N-th identity is not CPU, it is a
provider's signature, which is the unmintable thing Phase 19 already secured. The counter stops
being the defence and becomes an accounting detail.

**This phase carries Phase 19's criterion 5 forward**, on the established pattern of this project
(Phase 18's criterion 2b → Phase 20's criterion 1; Phase 16's criterion 3 → Phase 20's criterion 6;
Phase 17's criterion 2 → Phase 18's criterion 2d). Phase 19's criterion 5 read *"enrolment costs
something unmintable, and the N-th identity costs more than the first"* and verified PARTIAL twice:
the unmintable half is delivered and measured across real processes including restart and
two-provider recovery; the N-th identity is **refused inside the issuance window rather than
priced**. Measured comparatively, a provider's cost to refuse over an attacker's cost to mint is
~3.0, and over a replay ~1397 — the attacker burns the window at roughly a third of what refusing
costs, and the denial then applies to every honest node for the rest of the window at no further
cost. **Relocating the guard is not lowering the bar**; RULING A still applies.

**The measured mitigation that does NOT work, recorded so it is not re-tried:** a capacity slot on
the `enrol` branch served 8 of 8 concurrent enrolments, because `enrol` is synchronous so the bound
never binds; in a rig where an `exec` held the shared table it served 0 of 8. It bounds the wrong
verb.
</domain>

<known_and_accepted>
## The front door is unlocked, and that is a SCHEDULED state, not an oversight

**Read this before filing anything.** Everything in the next section was found by an independent
read-only pass, reported to the owner, and **the owner already knew**. The ruling that followed was
*"plan it for later"*. So between now and this phase executing:

- `circuitRelayServer` accepts a reservation from any peer that completes a Noise handshake.
- A node with no certificate can join, be advertised, and be dialled.
- Every certificate check in the tree is **selection**, not **admission**.

**That is the accepted posture of the system until Phase 24 runs.** A reader who discovers it
independently should reference this file rather than re-opening the investigation or filing an
emergency. It is scheduled work with a criterion attached, which is the strongest form of "known"
this project has.
</known_and_accepted>

<findings>
## Measured findings — build on these, do not re-derive them

Established by an independent read-only pass, 2026-08-04, re-checked by symbol while planning.
**Every citation below names a grep-able symbol. Line citations in this repository drifted three
times in one day** (`19-VERIFICATION.md` W7–W9), twice inside the very commits written to correct
drift.

### The relay authenticates nothing

`fabric-node.ts` constructs `circuitRelayServer({ reservations: { maxReservations,
reservationTtl, defaultDurationLimit, defaultDataLimit } })` — **capacity limits only**. No ACL, no
gater, no certificate hook. A joining peer presents a Noise handshake and nothing else.

The **only** `connectionGater` in the repository is in `browser-node.ts`:
`{ connectionGater: { denyDialMultiaddr: async () => false } }` — which *opens* dialling.

### The seed cannot even be configured to check — this is the actual blocker

`SeedServerOptions` (`packages/node/src/seed-server.ts`) has six fields and **no `trustedIssuers`
and no `enrollment`**. `bin/seed.ts` offers `--trust-anchor`, which is *module provenance* (DET-03,
threaded to `FabricNodeOptions.trustAnchors`), **not certificate issuers** (AUTH-02). The gap is
expressibility, not the check.

`FabricNodeOptions.trustedIssuers` **does** exist (optional, `readonly trustedIssuers?: readonly
PublicKeyHex[]`) and feeds `PeerVerifier.start`. Nothing above it can reach it on a seed.

### Advertisement is unauthenticated too — and that is why the seam is the reservation

- `seed-server.ts` maps `node.reservedPeerIds` straight into `BootstrapInfo.peerAddrs` with no
  filter.
- `agent.ts`'s `reservations` branch answers `options.reservations()` verbatim; `fabric-node.ts`
  passes `reservations: () => node.reservedPeerIds`.
- `agent.ts` answers `records` / `providers` to anyone.

**Both advertisement surfaces are derived from `reservedPeerIds`.** So a peer that never obtains a
reservation never appears in either, *structurally* — no filter to add, no `if` to forget. This is
the same property `peer-gate.node.test.ts`'s header protects for the block-source thunk, and it is
the single strongest argument for putting the gate at the reservation rather than anywhere else.
**It is a claim, and 24-04 measures it rather than asserting it.**

### Every existing certificate check is SELECTION, not ADMISSION

`PeerVerifier` (consumed at `fabric-node.ts`'s `PeerVerifier.start` call), `discoverExecutors`
(`discovery.ts`), `discoverCandidates` / `resolveReplicaSets` (`discover-candidates.ts`),
`verifyResultAttestation` (`result-attestation.ts`). All of them decide who to *use*. None decides
who gets *in*.

Two facts weaken them further:

- **`PeerVerifier.verifiedPeers` is FAIL-OPEN**: `if (this.#trustedIssuers.size === 0) return
  this.#peers()`. Pinned nobody ⇒ trust everybody.
- **Nothing configures an anchor.** `peer-verifier.ts`'s own header: *"Not one `FabricNode` in this
  repository configures an anchor."*

And the gate is a peer **thunk**, not an `if`, *deliberately* — so it can only ever gate selection.

### `peer-gate.node.test.ts` already says the quiet part

Its header: gating dispatch candidate selection, quorum membership and **relay use** is
*"**UNMEASURED**, not descoped"*. This phase is that measurement arriving.

### Bootstrap: enrolment is a DIRECT dial on both tiers, so there is no chicken-and-egg today

Both `fabric-node.ts` and `browser-node.ts` enrol via `await libp2p.dial(multiaddr(
enrollment.providerAddr))` inside their `Dialed` block, **before** and independently of any
`relayAddrs` loop. Enrolment does **not** route through a relay reservation.

**But the ruling creates one conditionally.** For a browser tab the provider and the relay are the
**same node at the same address** — `browser-enrollment.e2e.test.ts` says so about itself: *"The
provider, not the gate… `relayAddrs: [provider]`"*. Gating the reservation still leaves the tab able
to open a plain connection and enrol, because the reservation is a **later, separate protocol
exchange** on that connection. **That resolution is available today. It fails only if a deployment
separates provider from relay.** See sub-decision 1.
</findings>

<decisions>
## Implementation Decisions

### The seam, and why it is four plans

- **A — make the check expressible (24-01).** The `RelayAdmission` named union threaded to every
  relay-capable construction site *and consulted by nothing*; `SeedServerOptions.trustedIssuers`;
  `bin/seed.ts --trusted-issuer`; and moving `PeerVerifier` from `@o2/node` to `@o2/net`.
  `peer-verifier.ts`'s own header says that move is *"a barrel change with no code change"* and
  that browser-tier verification is UNMEASURED today **purely because of packaging**. **Zero
  behaviour change; nothing breaks. Lands alone.**
- **C — the rig and demo posture (24-02).** Both bench rigs deliberately hold no certificate, and
  one publishes a curve. **Folding this into B would silently reshape a published measurement.**
  C decides each rig's posture *and captures the baseline* before anything is armed.
- **B — arm the gate, and ONLY the reservation (24-03).** The refusal, and the blocking
  measurement that must precede it.
- **The reading (24-04).** The criterion's three clauses across real processes and real tabs, plus
  the residual enrolment cost that this phase does **not** remove.

**DO NOT gate at the `Transport` layer.** `peer-gate.node.test.ts`'s header records keeping
`Transport` a certificate-ignorant three-member datagram port as a **protected property**, and
`libp2p-transport.ts`'s module comment exists to protect it.

### The mechanism: `denyInboundRelayReservation`

`@libp2p/interface`'s `ConnectionGater` carries an optional `denyInboundRelayReservation(source:
PeerId)`. **Measured in the installed tree, 2026-08-04:** `@libp2p/circuit-relay-v2`'s server calls
`await this.components.connectionGater.denyInboundRelayReservation?.(connection.remotePeer)` and
refuses the reservation when it `=== true`.

Three properties make this the right hook and each is load-bearing:

1. **It fires on the reservation and on nothing else.** A plain connection — the one enrolment uses
   — never reaches it. The `enrol` exemption is therefore **by construction**, not by an `if`.
2. **It is optional-called (`?.`).** A node that supplies no gater behaves exactly as today.
3. **It is per-peer**, so certificate-holding stays a **fact about a node**, never a node kind.

**The executor MEASURES all three before building on them.** The `?.` and the `=== true` are read
off a compiled artifact in `node_modules`; a version bump could change either.

### `RelayAdmission` is a required named union — and this is how sub-decision 2 gets settled

```
RelayAdmission = ReadonlySet<PublicKeyHex> | 'admits-any-peer'
```

- **Non-empty set** ⇒ only a peer whose certificate chains to a pinned issuer gets a reservation.
- **Empty set** ⇒ admits nobody. Genuinely fail-closed.
- **`'admits-any-peer'`** ⇒ today's behaviour, **stated by name**.

There is no "empty means everyone" reading, because the everyone case **has a name**. This is the
repository's own established answer to exactly this class — `'keeps-no-ledger'`,
`'serves-no-records'`, `'signs-nothing'`, `'relays-for-nobody'`, `'checks-no-combine-signatures'`,
`'carries-no-certificate'` — and it is what makes the asymmetry with `PeerVerifier`'s fail-open
early return a **typed** difference rather than a subtle one somebody will "fix" back.

### Sub-decision 1 — Relay/provider co-location is a REQUIREMENT, written where a deployment reads it

**The ruling is implementable only if the front door can also hand out first certificates**, or a
pre-certificate connection may carry `enrol` and nothing else.

**Decision.** Both, and in that order:

- The **enforced** mechanism is the second: `denyInboundRelayReservation` gates the reservation, so
  a pre-certificate connection can still carry `enrol`. Nothing else needs a carve-out because
  nothing else is reachable without a reservation for a browser peer.
- The **stated requirement** is the first: **a relay that pins issuers must either serve enrolment
  itself or name a provider a joining peer can reach without a reservation.** Today they are
  co-located and it works. Write that requirement at `RelayAdmission`'s docblock and in
  `bin/seed.ts`'s operator output — **not only here** — so a future deployment cannot separate them
  by accident. Phase 19 learned that a constraint living in a planning document reaches nobody
  reading the code.

**What would falsify the enforced half:** a browser tab failing to complete enrolment against a
relay that refuses its reservation. That is the blocking measurement, and it is 24-03 task 1.

### Sub-decision 2 — Fail-open vs fail-closed, and the asymmetry that must be written at the line

`PeerVerifier.verifiedPeers`'s `if (this.#trustedIssuers.size === 0) return this.#peers()` means
*pinned nobody ⇒ trust everybody*. The ruling requires the relay to fail **closed**.

**Decision: the asymmetry is deliberate, is confined to the reservation path, and is recorded at
both lines.**

- **Do not flip `PeerVerifier`'s early return.** Its header argues that return is what makes *"a
  node with no trust anchors has no verdicts"* true by construction, and that the empty-anchor case
  *"then costs exactly nothing, which is the reason this is safe to land."* Flipping it globally
  breaks every unpinned node and re-opens a fabric-wide behaviour the owner already ruled on.
- **The reservation path never reads an empty set as permission**, because `'admits-any-peer'`
  carries that meaning instead. So the two mechanisms **do not read the same value differently** —
  they read *different types*. That is the whole reason for the union.
- **Write the asymmetry at both lines**: a sentence at `PeerVerifier`'s early return saying the
  relay does not share it and why, and a sentence at `RelayAdmission` saying the selection gate
  does not share *this* and why. **An asymmetry recorded in only one place gets "fixed" back from
  the other.**

**One consequence needs an owner ruling and 24-01 surfaces it rather than deciding it:** whether
`bin/agent.ts` and `bin/seed.ts` should **refuse to start** when the operator states neither
`--trusted-issuer` nor `--admit-any-peer`. Fail-closed at the operator boundary is the honest
reading of the ruling, and it changes CLI compatibility for every spawn fixture in the tree. See
`<open_rulings>`.

### Sub-decision 3 — Revocation at the door

`PeerVerifier`'s `FINAL` set is `{unidentifiable-peer, nodeKey-mismatch, bad-signature,
untrusted-issuer}` — **`expired` is deliberately absent**, so an expired verdict is re-askable
because *"an expired one is replaced by a renewal the peer can obtain without reconnecting."*
Nothing re-checks a peer already admitted, and a held reservation outliving its certificate has no
defined behaviour.

**Decision: admission is checked at every reservation grant, including renewals. The revocation
window is therefore the reservation TTL, and that number is stated at the option rather than
implied.** Nothing re-checks mid-reservation — deliberately, because a connection-level re-check is
exactly the fabric-wide behaviour change `peer-verifier.ts`'s header says was **held for an owner
ruling rather than patched** when the same class of problem was found on 2026-08-01.

**Two things this rests on, and both are MEASUREMENTS, not assumptions:**

1. That `@libp2p/circuit-relay-v2` re-consults the gater on a **renewal** and not only on a first
   grant. If it does not, the revocation window is unbounded and **that is a finding to report**,
   not a case to fake — record it, and pin `reservationTtl`'s meaning honestly in the docblock.
2. That `expired` staying out of `FINAL` composes with this: a peer whose certificate lapsed fails
   the gate at its next renewal rather than being cached as permanently refused.

`reservationTtl` already exists on `FabricNodeOptions` (defaulting to
`RELAY_MAX_RESERVATION_TTL_MS`), so the knob is present and only its *meaning* changes.

### Certificate-holding is a per-node FACT, never a node kind

`peer-verifier.ts`'s header, about itself: *"Nothing here reads what kind of node a peer is; there
is no field to branch on."* `seed-server.ts`'s: *"A seed executes tasks like any other node — the
only difference between nodes is discovery."*

**A plan or an executor that introduces a "gated node" / "open node" distinction, a boolean on a
node type, or a branch on which factory built a peer, is wrong.** `RelayAdmission` is a value on
the *relay's* options describing who *it* admits. It says nothing about what kind of thing the
peer is.

### Comparative readings, and citation by symbol

Standing rules (`CLAUDE.md` § Measurement), both biting here.

- An admission reading is timing- and topology-shaped. Prefer **a ratio or a paired arm inside one
  run**: the same fabric with the same peer, certificate present and absent; the same rig with
  `'admits-any-peer'` and with a pinned set. Where an absolute is unavoidable, **say what it was
  sited against**.
- **Cite by grep-able symbol, never by line number.**
</decisions>

<blast_radius>
## Blast radius — who joins with no certificate today

**Regenerate this list yourself rather than trusting the paraphrase.** It was assembled by an
investigation pass and is offered as a starting shape, not as an inventory.

- `bin/seed.ts` and `seed-server.ts` themselves.
- `bin/agent.ts` — `--provider-addr` is **optional**.
- `demo/main.ts` — tabs are unenrolled unless a user key is supplied, and the demo **already
  renders `'carries-no-certificate'` as a first-class state**. That is an asset, not a problem.
- `tab-api.ts`.
- **Both bench rigs, deliberately**: `bin/bench.ts` (*"every node this driver has ever built"*) and
  `perf-workload.ts`.
- **Roughly twenty test files join over `relayAddrs` with no enrolment.** `grep -rln "relayAddrs"
  packages tools demo --include='*.ts'` returns 29 files; the subset that *joins without enrolling*
  is smaller and is what matters. Derive it.

**The named union converts most of this from breakage into statement.** A site that writes
`'admits-any-peer'` in 24-01 does not break when 24-03 arms the gate — it has already said what it
means. What 24-03 must then supply is cases where a relay **does** pin, because a gate no test
exercises is decoration.
</blast_radius>

<blocking_measurement>
## The one measurement that could block 24-03

**Unverified:** whether a browser tab completes enrolment against a relay that refuses its
reservation.

The reading of `browser-enrollment.e2e.test.ts` (*"The provider, not the gate… `relayAddrs:
[provider]`"*) and of `browser-node.ts`'s enrolment `libp2p.dial` says **yes** — the direct dial
precedes the `relayAddrs` loop and is independent of it. **But it has not been run.**

**24-03's first task takes that measurement before anything depends on it.** If it fails, 24-03 is
blocked on sub-decision 1 — the relay must serve enrolment on the pre-reservation connection as a
stated capability rather than an incidental one — and the ordering inside `FabricNode.#compose`
must change too, because the relay dial loop currently runs after `createLibp2p` and before
`Libp2pTransport.start`.
</blocking_measurement>

<specifics>
## Claude's Discretion

- Whether `RelayAdmission` lives in `@o2/core`, `@o2/net` or beside `FabricNodeOptions`, provided
  `bin/seed.ts` and `bin/agent.ts` can both name it and the browser tier is not forced to depend on
  `@o2/node`.
- Fixture sizes, spawn counts, and which existing `*-agents.node.test.ts` or `*.e2e.test.ts`
  fixture to copy.
- Whether the gater is constructed inline in `#compose` or by a named factory beside it —
  **not** discretionary: it must be reachable to a test without standing up a relay.
- Whether 24-02 keeps a rig open or pins it, provided the choice is stated at the call site and
  count-pinned.

## Not this phase's

- Phase 20 criteria 1–7. This phase blocks none of them.
- Flipping `PeerVerifier.verifiedPeers`'s fail-open early return — sub-decision 2 forbids it here.
- A per-identity price on enrolment. The ruling replaced that approach; the residual CPU cost of
  refusing is **measured and pinned** in 24-04, not removed.
- Gating quorum membership or dispatch candidate selection. Still UNMEASURED, still not descoped.
</specifics>

<open_rulings>
## Needs an owner ruling, not an implementation choice

1. **Should `bin/agent.ts` and `bin/seed.ts` refuse to start when the operator states neither
   `--trusted-issuer` nor `--admit-any-peer`?** Fail-closed at the operator boundary is the honest
   reading of the ruling and is the only thing that makes the *production* entry points gated
   rather than merely gate-*able*. It changes CLI compatibility for every spawn fixture in the
   tree. 24-01 surfaces the choice with both costs measured; it does not decide it.
2. **Should Phase 24 run before or after Phase 22 (Reachability Guard)?** See the scheduling note
   in the phase report. A reachability guard that runs before admission is gated passes over a
   fabric with an open door.
3. **What a relay does with a reservation held by a peer whose certificate lapses mid-TTL**, if the
   measurement in sub-decision 3 shows renewals do *not* re-consult the gater. The bounded answer
   is a shorter `reservationTtl`; the unbounded one is a connection-level re-check, which is a
   fabric-wide behaviour change of the class already held for a ruling once.
</open_rulings>

<deferred>
## Deferred Ideas

- **Gating `records` / `providers` answers on the certificate.** `agent.ts` answers both to anyone.
  Under this phase an ungated peer has no reservation and so cannot reach the endpoint over the
  fabric — but a direct-dialable Node peer still can. Measuring that residual belongs here; closing
  it is a new decision.
- **A connection-level certificate re-check.** Sub-decision 3 rules it out for this phase.
- **Giving the browser tier a real `reservations` thunk.** Phase 19's deferral stands unchanged.
- **Making `PeerVerifier` fail closed globally.** Explicitly not this phase's; see sub-decision 2.
</deferred>
