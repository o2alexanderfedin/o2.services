# Threat model

Required by Phase 6 criterion 5: *"a threat model naming 'attacker controls up to k of
n' is committed with k stated."*

Scoped to what is built and tested today. Where a defence is partial, it says so — an
overstated threat model is worse than none, because it stops people looking.

## The bound

> **An attacker may control up to `k` nodes in a quorum of `n`, where `k = 0`.**

That is not a typo, and it is stronger than it sounds. The quorum rules do not tolerate
a compromised member and detect it afterwards; they aim to keep one out:

- **No two replicas from the same operator** (`composeQuorum`). An attacker with a
  hundred machines under one operator identity occupies exactly one quorum slot.
- **At least one directly-dialable member**, so no quorum depends solely on a relay.
- **Disagreement is reported, never voted on.** With `n = 2` there is no majority to
  compute, so a single dissenting replica fails the result rather than losing a vote.
  This is deliberate: majority voting silently converts "something is wrong" into "the
  majority was right", which is the event verification exists to surface.

So the honest statement is: **the design detects any disagreement at `n ≥ 2` across
distinct operators, and tolerates none.** Raising `k` above 0 would mean adopting
majority voting, which this project has explicitly decided against.

The bound that actually constrains security is therefore not `k` but **how many
distinct operator identities an attacker can obtain** — see the gap below.

## Assets

| Asset | Concern |
|---|---|
| An owner's raw data | must never leave their device |
| A job's result | must not be silently wrong |
| An artifact (WASM module) | must be the one the publisher signed, not a substitute |
| A node's identity key | must not be usable by anyone else |
| Relay capacity | must not be exhaustible by one party without being reported |

## Attackers considered, and what stops them

| # | Attacker | Defence | Status |
|---|---|---|---|
| 1 | Returns a wrong result for a task | Redundant execution; disagreement reported with the dissenting node named | **built** — `executeVerified`, `executeReduce` |
| 2 | Copies a peer's answer instead of computing | Commit-reveal: commit `H(nonce‖resultCid)` before any reveal | **built** — `job/verify.ts` |
| 3 | Fills a quorum from machines they alone run | One node per operator, enforced in construction | **built** — `composeQuorum` |
| 4 | Substitutes a different module for a name | Names resolve only via signed `key → CID` from pinned anchors | **built** — `SignedNameResolver` |
| 5 | Rolls a name back to an older, vulnerable artifact | Monotonic versions per name | **built** |
| 6 | Runs a task without permission | Capability chain rooted at the owner key, checked **before** instantiation | **built** — `verifyChain`, `serveAgent` |
| 7 | Re-delegates a capability they were not allowed to pass on | Re-delegation requires the previous link to grant `delegate` | **built** |
| 8 | Claims a node key they do not hold | Proof of possession required at enrollment | **built** — `EnrollmentAuthority` |
| 9 | Forges a node certificate | Offline verification against pinned provider keys | **built** — `verifyCertificate` |
| 10 | Inflates an owner's replica count so owner-attested reads as verified | Unverifiable certificates are excluded from replica sets | **built** — `resolveReplicaSets` |
| 11 | Presents a weak result as a strong one | Attestation strength derived from certificates, never declared by the caller | **built** — `classifyAttestation` |
| 12 | Exfiltrates raw sovereign bytes in a job's output | Egress tap on the owner's only exit; manifest complete by construction | **partial** — a detector, see below |
| 13 | Relocates a sovereign task to a machine they control | Placement narrows to the owner's nodes before load is consulted; no widening branch | **built** — `planPlacement` |
| 14 | Exhausts a relay's reservations | Capacity reported by name; refusal distinguishable from an outage | **built** — `RelayNode`, `ReservationWatcher` |
| 15 | Mass-creates node identities to win quorum slots | Rate-limited enrollment per user key | **gap** — see below |
| 16 | Eclipses a node's view of the DHT | S/Kademlia disjoint-path lookups | **not built** |

## Gaps, stated plainly

**Sybil resistance is rate-limiting, not cost (attacker 15).** `EnrollmentAuthority`
caps certificates per user key per window. An attacker with many *user* identities is
not slowed at all, and the cap is a policy number rather than a physical one. Making
fake nodes genuinely expensive needs something the attacker must spend — proof-of-work,
payment, or an out-of-band identity check. The rate limiter is the enforcement point
those would plug into. **This is the weakest link in the model**, because attacker 3's
defence assumes operator identities are scarce.

**Egress control is a detector, not a prover (attacker 12).** The tap catches raw
sovereign bytes crossing the wire, including embedded in a larger frame. It cannot
prove that no *encoding* of a sovereign value could slip past — compressed, encrypted,
or re-encoded copies would not match. It catches the failure that actually happens: a
map step that forgot to aggregate. A stronger claim needs taint tracking through the
guest.

**Eclipse resistance is absent (attacker 16).** js-libp2p implements Kademlia
"augmented with notions from S/Kademlia", which is not the same as disjoint-path
lookups. Treat this as build-not-configure work, currently unbuilt.

**A malicious provider is out of scope.** Certificates chain to provider keys pinned by
each node. A provider that issues freely to an attacker defeats attacker 3 and 15
entirely. Multi-provider quorums would bound this and are not built.

**Timing and traffic analysis are out of scope.** The egress manifest records byte
counts and destinations, which is itself metadata an observer could use.

## Revision

Written 2026-07-26 against Phase 6. Revisit when: enrollment gains a real cost
function; multiple providers are supported; or disjoint-path lookups are implemented.
