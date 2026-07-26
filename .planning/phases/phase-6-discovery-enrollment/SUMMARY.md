# Phase 6 — Discovery, Placement & Enrollment

**Status:** IN PROGRESS — 3 of 7 criteria met, 1 partial, 3 not started
**Requirements:** SCHED-01/02/03/05, NET-06, AUTH-01/02/04/05, VER-03/04/08/09/10
**Branch:** `feature/phase-6-enrollment-quorum`

```
tsc --noEmit  clean
455 tests     all green (was 407)
```

| # | Criterion | Status |
|---|---|---|
| 4 | On-device key, provider-signed cert, offline verify, rate-limited enrollment | **met** — with a stated gap on "costly" |
| 5 | Quorum diversity, backbone anchor, threat model with `k` stated | **met** — `.planning/THREAT-MODEL.md` |
| 7 | Owner-domain agreement labelled distinctly from independent | **met** |
| 6 | Owner replica set resolves; 2-of-owner execution with a stream tap | **partial** — replica sets built; end-to-end execution not wired |
| 1 | Discovery by intersecting CID providers with capability records | **not started** |
| 2 | Power-of-d placement, rejection and re-pick | **not started** |
| 3 | Sovereignty outranks cost heuristics under load | **substantially covered by Phase 4** — `planPlacement` already filters before scoring, falsified there; needs the d-choices integration |

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

## Not started, and why the ordering was chosen

Discovery (criterion 1) and power-of-d placement (criterion 2) are untouched. They are
the natural next unit and depend on enrollment, which is why enrollment went first:
discovery intersects providers with **signed capability records**, and there were no
node certificates to intersect against until now.

Criterion 3 is largely already satisfied by Phase 4's `planPlacement`, which filters on
sovereignty *before* consulting load and was falsified by adding the forbidden
relax-under-pressure branch. What remains is integrating d-candidate sampling behind
that same filter — the constraint-first ordering must survive it.
