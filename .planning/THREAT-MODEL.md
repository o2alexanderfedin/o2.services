# Threat model

Required by Phase 6 criterion 5: *"a threat model naming 'attacker controls up to k of
n' is committed with k stated."*

Extended 2026-07-26 with attackers 17–19 (the surface discovery introduces) and 20–22
(the surface churn recovery introduces). The requirement asks only for the quorum bound,
but a model that stopped where the requirement did would omit the newest attack surface
in the system — and attacker 21 exists *because* of a Phase 7 design decision, which is
exactly the kind of thing a threat model is for.

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
| 17 | Injects fake providers into a lookup answer | A provider with no verifiable certificate is excluded by name at the requestor | **built** — `discoverExecutors` |
| 18 | Advertises engine features it does not have | Claim is signed by a node key a pinned provider certified, so it is attributable | **partial** — see below |
| 19 | Understates its load to attract work | Load is a hint; the node's own offer is the only authority, and it must still answer | **bounded** — see below |
| 20 | Accepts work in order to stall it | Lease expiry re-dispatches; a straggler is duplicated under budget | **bounded, not closed** — see below |
| 21 | Falsely reports a *task* failure to kill a shard | none — a reported task failure is taken at its word | **gap, introduced by Phase 7** — see below |
| 22 | Hands back a stale checkpoint to roll a job back | Checkpoint handles are held by the coordinator that wrote them | **out of scope today** — see below |

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

**A false capability claim is attributable, not prevented (attacker 18).** A capability
record is self-signed and therefore worthless alone — an attacker can mint one claiming
anything. It gains nothing because discovery also requires a certificate from a pinned
provider for that same node key, so a false claim is bound to a certified identity. What
that buys is attribution after the fact, not prevention: a node claiming `simd128` it
cannot run will be dispatched to and will fail, and the requestor re-picks. The cost is
one wasted dispatch, and the operator is named. Making the claim self-verifying would
mean challenging the node to execute a probe module, which is not built.

**Load is a hint by design, and lying about it is bounded (attacker 19).** Power-of-d
deliberately treats the requestor's load figure as possibly stale; the authority is the
node's own answer to an offer. A node understating its load attracts more offers, and
must then either refuse them — costing the requestor one probe and a re-pick, both
recorded — or accept work it cannot finish, which makes it a straggler rather than a
liar with an advantage. Straggler handling is Phase 7. What this does **not** cover is a
node that accepts everything in order to deny service by stalling; that needs a
completion-time reputation, which is not built.

**Stalling is now bounded but still free (attacker 20).** Phase 7 changed this from
unbounded to bounded: a node that accepts a task and never finishes has its lease
expire, the task is re-dispatched, and if enough peers have finished for a median to
exist the straggler is duplicated under the speculation budget. The cost of one stall is
therefore one lease duration plus one duplicate, not the job. What is *not* built is any
lasting consequence — the same node can accept and stall the next task, and the next.
Closing it needs completion-time reputation, which would be the natural output of the
straggler data the coordinator already collects but is not implemented.

**A false task-failure report is taken at its word (attacker 21). This is new surface
that Phase 7 introduced and it should not be glossed.** The coordinator distinguishes a
*node* failure (retry until the pool is exhausted) from a *task* failure (give up after
three), because collapsing them makes 30% node loss unsurvivable. But the distinction
comes from the dispatch response, which the executing node controls: a node that claims
"the module trapped" is believed. Three nodes making that claim for the same shard cause
it to be declared failed.

The bound on the damage matters and is worth being precise about. This is a **denial of
service on a specific shard, never a wrong answer** — a fabricated failure removes work,
it cannot substitute a result, because a result still has to be a CID that agrees with
the redundant copy. And an attacker cannot choose which shards they are asked about:
placement is rendezvous ranking on the shard id, so being picked three times for one
shard means being highly ranked for it, which costs sybil identities. That makes this
downstream of attacker 15, like most of this model.

Two things would help and neither is built: counting a task failure only when it is
corroborated by a node from a *different operator* (the quorum-diversity rule applied to
failure rather than to success), and treating a node whose task-failure rate is far above
the fabric's as a suspect rather than a witness.

**Checkpoints are unsigned (attacker 22).** A `JobCheckpoint` is a content-addressed
block with no signature, so its *contents* cannot be tampered with — a modified block has
a different CID — but nothing binds a handle to the coordinator that wrote it. Today the
handles never leave the coordinator that produced them, so there is no one to be deceived
by an older one; the recovery path deliberately takes a caller-supplied list newest-first
rather than discovering handles from anywhere. If checkpoint handles are ever published
so that a *different* party can resume a job, this becomes a real rollback attack and the
checkpoint needs a signature and a monotonic counter, exactly as artifact names did in
attacker 5. Recording it now so the requirement is not rediscovered later.

**Eclipse resistance is absent (attacker 16).** js-libp2p implements Kademlia
"augmented with notions from S/Kademlia", which is not the same as disjoint-path
lookups. Treat this as build-not-configure work, currently unbuilt.

**A malicious provider is out of scope.** Certificates chain to provider keys pinned by
each node. A provider that issues freely to an attacker defeats attacker 3 and 15
entirely. Multi-provider quorums would bound this and are not built.

**Timing and traffic analysis are out of scope.** The egress manifest records byte
counts and destinations, which is itself metadata an observer could use.

## Revision

Written 2026-07-26 against Phase 6, extended the same day with the discovery surface and
then with Phase 7's churn surface. Revisit when: enrollment gains a real cost function;
multiple providers are supported; disjoint-path lookups are implemented; completion time
gains a consequence (which is what would close attackers 19 and 20); task-failure reports
gain cross-operator corroboration (attacker 21); or checkpoint handles are ever shared
between parties, at which point attacker 22 stops being hypothetical.
