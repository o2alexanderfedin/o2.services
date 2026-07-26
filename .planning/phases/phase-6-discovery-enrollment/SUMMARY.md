# Phase 6 — Discovery, Placement & Enrollment

**Status:** COMPLETE — 7 of 7 criteria met
**Requirements:** SCHED-01/02/03/05, NET-06, AUTH-01/02/04/05, VER-03/04/08/09/10
**Branches:** `feature/phase-6-enrollment-quorum`, `feature/phase-6-discovery-placement`

```
tsc --noEmit  clean
571 tests     all green (was 407 at phase start)
```

| # | Criterion | Status |
|---|---|---|
| 1 | Discovery by intersecting CID providers with capability records | **met** |
| 2 | Power-of-d placement, rejection and re-pick | **met** |
| 3 | Sovereignty outranks cost heuristics under load | **met** — falsified twice |
| 4 | On-device key, provider-signed cert, offline verify, rate-limited enrollment | **met** — with a stated gap on "costly" |
| 5 | Quorum diversity, path independence, threat model with `k` stated | **met** — `.planning/THREAT-MODEL.md` |
| 6 | Owner replica set resolves; 2-of-owner execution with a stream tap | **met** |
| 7 | Owner-domain agreement labelled distinctly from independent | **met** |

The static peer list every earlier phase leaned on is gone. A requestor that knows one
bootstrap peer and a data CID now finds executors, places work, and dispatches it.

## Architecture correction from the owner, applied (twice)

> *"browser peers are not client-mode only, they must be no different from backbone,
> except that they cannot listen to websockets"*
>
> *"all nodes are of equal functionality. The only difference is in the connectivity
> capabilities"*
>
> *"it is not 'reachable with relay', it is 'cannot be discovered as seed node
> directly, only via relay'"*

The first pass was applied too weakly: `backbone`/`edge` survived as node *classes* and
the quorum rule discriminated on them, which still encodes a tier. The model is now:

- **`NodeRole` is gone.** A certificate carries `discoverability: 'seed' | 'via-relay'`
  plus the `relayIds` a node is found through. It says how a node is *discovered* and
  nothing about what it may do.
- **"Reachability" was also wrong**, and the third correction sharpened it: once two
  peers are connected they are indistinguishable. What a browser cannot do is act as a
  **seed a newcomer dials cold**, because it has no stable address to publish.
- **The quorum rule no longer mentions node kinds at all.** It refuses a quorum whose
  members are *all discoverable only through one relay* — a statement about the
  discovery graph. Three browser peers on three relays pass; three servers published
  behind one do not. Symmetry is asserted by test: servers get no exemption.
- `relayIds` is inside the signed certificate, so a node cannot understate its
  discovery dependencies to slip into a quorum it should not share. Tested.

### A false positive the correction exposed

Restating the rule as a table (*"3 servers behind one relay → refused"*) prompted the
right question — *is that a bug?* — and probing it found one.

`sharedRelay` read `relayIds` and never consulted `discoverability`. So three
**seeds** that merely *advertised* through one relay were refused, as though they would
vanish together. They would not: a seed stays directly dialable, so losing an
advertisement channel costs it nothing.

Fixed: a seed contributes no discovery dependency whatever relays it lists. Only a node
whose *sole* discovery path is a relay actually depends on it. Three certificates with
identical `relayIds` now get opposite verdicts depending on whether they can be reached
without them — which is the distinction that makes the rule mean anything.

Confirmed by falsification: reverting to the `relayIds`-only reading fails both
regression tests.

This reverses two inherited assumptions and they were **assumptions, not measurements**.
The research phase recorded "a browser node cannot serve DHT records" and Phase 5 noted
"browsers are leaves in v1". Both were carried forward unexamined.

The counter-evidence was already in this repo: in Phase 3 an **iPhone was dialled at its
`/p2p-circuit/webrtc` address from another machine** and ran half of a 2×-redundant job.
A browser holding a relay reservation *is* dialable, so "cannot serve" was never right —
what is true is narrower, that it cannot bind a listening socket.

Applied:

- `NodeRole` now documents **reachability, not privilege**. `backbone` binds a socket;
  `edge` is reached via relay-signalled WebRTC. Same capabilities, different path in.
- The quorum backbone-anchor rule survives, but its justification is rewritten. It is
  **not** "edge nodes are cheap to manufacture" (the framing the correction rejects);
  it is that every edge node depends on a relay, so an all-edge quorum shares one
  failure and a relay outage takes it whole. A durability rule, not a caste rule. Edge
  nodes fill every remaining slot on equal terms, and a test asserts it.
- `NET-06` and Phase 6 criterion 1 rewritten: backbone nodes may serve records for
  browsers as an *optimisation and fallback*, not because a browser is incapable.
- Phase 5's "browsers are leaves" note rewritten. Background-tab throttling (~1/min) is
  real, but it is a **lease-duration** problem, addressed by lease length and the
  visibility governor already built — not by demoting a tier.

## Criterion 4 — and what "costly" honestly means

Enrollment takes a public key plus a proof of possession. **No code path accepts,
transports, or stores a private key**; a test asserts the request carries no secret,
and a forged request claiming someone else's public key is refused.

Verification is offline by construction — the trust anchors are an argument and the
function has nothing to reach out to. That matters for a browser joining from a coffee
shop, and because an online authority would be a target worth attacking.

The gap is stated rather than glossed: rate-limiting makes fake nodes **rate-limited,
not expensive**. An attacker with many user identities is not slowed, and the ceiling
is a policy number, not a physical one. Genuine cost needs proof-of-work, payment, or
an out-of-band check. The limiter is where those plug in. The threat model names this
as the weakest link, because quorum diversity assumes operator identities are scarce.

## Criterion 5 — the threat model states k = 0

`.planning/THREAT-MODEL.md` covers 16 attackers with per-item status. The headline:

> An attacker may control up to `k` of `n` quorum members, where **`k = 0`**.

Not a typo. The rules aim to keep an attacker out rather than tolerate one and detect
it later, and disagreement is reported rather than voted on — at `n = 2` there is no
majority anyway, and majority voting silently converts "something is wrong" into "the
majority was right". Raising `k` above 0 would require adopting voting, which this
project has explicitly rejected. The bound that actually constrains security is how
many operator identities an attacker can obtain, which is the sybil gap above.

## Criterion 7 — the label travels with the result

Three strengths as one discriminated union, so every reporting site must name which it
has: `owner-attested` (one node), `owner-domain` (≥2 nodes, one operator),
`independent` (≥2 operators).

Derived from certificates, **never declared by the caller** — a caller that could assert
"independently verified" would eventually assert one that was not. A test pins the
point that matters: owner-domain and independent both show `replicas: 2`, so the count
alone cannot distinguish them, which is exactly why the label must travel.

## Criteria 1 and 2 — what discovery actually is

Discovery is an **intersection of three independently-sourced facts**, and the
intersection is the whole design, because no one of them is worth anything alone:

| Fact | Source | Alone it proves |
|---|---|---|
| holds the input block | content routing (`providers`) | nothing about identity |
| is an enrolled node of user U, operator O | provider-signed `NodeCertificate` | nothing about capability |
| supports these engine features | node-signed `CapabilityRecord` | nothing — anyone can mint a key |

A capability record being self-signed looks like security theatre until you see what it
is bolted to. It is worthless in isolation, and that is stated as a **passing test**: an
attacker mints a perfectly valid record claiming everything and gains nothing, because
the same node key must also carry a certificate a *pinned provider* signed. Splitting
the two lets a node re-sign locally when its engine changes rather than returning to the
provider for a fresh certificate.

**Every exclusion is named and returned.** Silent filtering is how a requestor ends up
staring at an empty candidate list unable to distinguish a dead network from a wrong
clock from a module nobody can run. Six exclusion kinds, each with a line fit to show a
human.

### The sample is derived, not drawn

Classic power-of-d draws its `d` candidates at random. Here they come from rendezvous
(HRW) ranking on the shard id — the same mechanism the reduce tree already uses. Per
shard the ranking is an arbitrary permutation, which is what the load-balancing result
needs; across shards it differs, so work still spreads. What it buys over `random()`:

- **No shared state and no clock.** Two requestors racing on the same shard converge
  instead of doubling up, and re-placement after a crash re-derives the same candidates.
- **The tail is the re-pick list**, already ordered and already local.
- **Reproducible** — a placement can be replayed from the shard id and the node set.

### Load is a hint; the offer is the authority

The requestor's `load` figure may be seconds stale, and treating it as truth is what
makes several requestors stampede the same "least-loaded" node. So it only orders an
already-sampled pair, and the decision belongs to the node: `LocalCapacity` takes **no
ports and makes no calls**, so "local information only" is a property of the type rather
than a promise in a comment. A refusal is not an error path — it is the mechanism by
which a guess made from stale data becomes a correct decision.

## Criterion 3 — falsified again, and it held

Phase 4 established that `planPlacement` filters on sovereignty before consulting load.
The risk this phase introduced is that a *second* placer would re-derive eligibility and
drift. So `eligibleNodes` is now **exported so that there is exactly one of it**, and
power-of-d runs entirely behind it on a pool that is only ever shrunk.

Falsified by planting the branch the rule forbids — *"nobody who is allowed will take
it, so let me ask someone else"* — which is exactly the pressure a refusal creates. The
result: 10 nodes probed instead of 2, leaking a sovereign shard id into another owner's
fabric. One test caught it, and caught the leak itself rather than an incidental
assertion. Reverted.

## Criterion 6 — the assembly was the missing part

Every piece existed and was unit-tested alone. The claim lives in the assembly: a
sovereignty-pinned task discovered from a CID, placed on two of one owner's nodes,
executed redundantly, outputs compared, receipt labelled `owner-domain` **not**
`independent`, and an egress manifest showing what left was derived.

Bob's node makes DATA-09 concrete rather than hypothetical. It provides the same CID —
an encrypted replica is genuinely useful for availability — and is excluded from
execution *twice*: at discovery on its capability record, and at placement on the
sovereignty filter. Being a fine block source and an impossible executor is the point.

**The clean manifest is only worth reading if the tap can fail.** So the same wiring runs
again with a module that echoes its input — the map step that forgot to aggregate, which
is the failure this requirement exists to catch — and the tap flags it. Without that
test, `violations: []` is indistinguishable from a tap that is not plugged in.

## A real finding from wiring it up

An unreachable node cost a **full RPC timeout** before the re-pick. That destroys the
saving power-of-d exists to buy: the whole point is that a placement costs two questions
instead of a global view, and that evaporates if one dead peer stalls the decision for
thirty seconds. Offers now carry their own 2-second probe deadline, and silence is a
*stated* refusal — so a dead peer appears in the rejection list beside a busy one, and
"why did this land here" stays answerable after the fact.

Found only because the test suite ran it against a closed endpoint. No unit test would
have shown it, because in a unit test the admission callback returns immediately.

## NET-06 — availability, never node kind

The fallback chain is ordered by **availability at this moment**: "can peers reach me to
ask", which is true of a listening server and of a browser tab holding a relay
reservation, and false of either before it gets there. A server whose index is not yet
available falls back exactly as a browser without a reservation does, **and a test
asserts that symmetry** — a rule that exempted one of them would be a tier by another
name.

The strongest evidence is structural rather than argued: every new spec in this phase
runs unchanged in the `browser` project, in real Chromium. A browser peer resolves
records, serves them, places work and executes it with the identical code path.

## Where the honesty is

- **Sybil resistance is still rate-limiting, not cost.** Unchanged, and still the
  weakest link, because quorum diversity assumes operator identities are scarce.
- **A false capability claim is attributable, not prevented** (threat model 18). A node
  claiming a feature it lacks will be dispatched to and fail; the cost is one wasted
  dispatch and the operator is named. Preventing it needs a probe module.
- **Lying about load is bounded, not stopped** (threat model 19). A liar attracts offers
  it must then refuse — costing a probe — or accept and become a straggler, which is
  Phase 7's problem. A node that accepts everything to stall is not covered; that needs
  completion-time reputation.
- **`RpcRecordIndex` returns the first useful answer, not a merged view.** Waiting for
  every peer would be as slow as the slowest. A caller wanting a fuller picture asks
  again with a different peer order.
