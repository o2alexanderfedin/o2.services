# MR-04: publish the contribution set, or let both sides derive it?

**Consulted 2026-08-16** (Google AI Mode, browser automation), asked as an open question with an
explicit instruction to argue both sides rather than recommend one. This file records the argument,
not a decision — MR-04 is the owner's call.

## The question, stated so it can be answered

MR-04 wants *a second participant to derive an identical reduce tree*. Two ways to get there:

- **Publish** the contribution set (which node contributed which shard) on a frame, or
- **Derive** it, if both sides already hold enough to compute it.

This fabric assigns shards by **rendezvous hashing** over a node set, from a job spec both sides
hold. So derivation is at least *plausible* here, which is why the question is live rather than
rhetorical.

## The first answer assumed the problem away, and that is the finding

The opening reply gave standard Merkle-tree construction and rested it on:

> *"Ensure both participants have the identical input data set. Consistent inputs yield identical
> hash IDs across both independent nodes."*

That is the premise under dispute, not a route to it. Worth recording because it is the shape of
answer this question attracts: deterministic tree-building is the easy half, and everyone answers
the easy half.

## Derivation is sufficient in a static system — and four things break it

Pressed on the real question, the argument for derivability is that rendezvous hashing over
`(shard, node)` is deterministic, so both sides map the same keyspace to the same targets with zero
communication. **The contribution set is implicit in system state.**

The four stated failure modes, all of which are about *state drift* rather than about the hash:

1. **Churn.** A marks a peer dead on a missed heartbeat; B has not yet. The two now hash against
   different node lists and assign differently.
2. **Shard refusal.** A live node refuses on local exhaustion, forcing fallback to the next-highest
   weight. Unless that refusal is globally synchronised, the two disagree on who contributed.
3. **Partial failure.** A shard's output reaches A but not B. A includes it; B times it out. The tree
   inputs diverge and the roots differ.
4. **Non-deterministic inputs.** Even with agreement on *who* ran a shard, unstable source data makes
   the bytes differ.

Note that 1–3 are exactly the conditions this fabric is built for — volunteer nodes, tab churn, a
relay-mediated mesh. They are not edge cases here.

## For publishing

- **Auditability.** A signed receipt: *this is exactly what I ran.* An auditor pinpoints which node
  submitted which bytes instead of reconstructing what the topology looked like at that instant.
- **Stateless observers.** A third party verifies the tree without maintaining historical membership.
- **Immunity to race conditions.** Freezing the set converts a time-sensitive tracking problem into
  an immutable block.
- **Dispute resolution.** In an adversarial setting a node could lie about having seen a dropout in
  order to justify a different tree. A manifest forces one version of reality.

## Against publishing

- **Metadata bloat** at large shard counts.
- **No coordinator bottleneck** — local derivation removes a compile-and-broadcast step.
- **Zero-knowledge integrity** — *"withholding the contribution set ensures that observers cannot map
  data access patterns or deduce which specific nodes are handling sensitive data segments."*
- **Clean failure** — if membership shifted, the tree simply fails to match.

## What this project's own rulings do to that balance

Two of the four "for" arguments weaken here, and one "against" argument strengthens sharply.

**Dispute resolution is largely moot on the sovereign path.** The owner ruled on 2026-08-14 that the
requestor **is** the data owner, so there is no interest in faking a result about one's own data, and
a bad storage node's blast radius is one owner's own data. The equivocating-node scenario is a
requestor attacking their own job. (It is **not** moot on the *public* path, which keeps N-version
redundancy and commit-reveal — see `PROJECT.md`. Any decision here should say which path it binds.)

**Zero-knowledge integrity is unusually load-bearing.** A published shard→node manifest is precisely
a map of which node holds which owner's data. In a fabric whose stated core value is that raw data
never leaves its owner's device, publishing that map hands an observer the access-pattern graph the
architecture exists to avoid. This is the strongest argument in the whole exchange *for this project*,
and it is one a generic answer would not weight.

**Churn is the strongest argument for publishing, and it is not hypothetical here.** Failure modes
1–3 describe a browser mesh accurately. Derivation is only sound if both sides agree on the node set
at the instant of assignment, and nothing in this repository currently guarantees that.

## The shape of a third option, not recommended, only named

Publish a **commitment** to the contribution set rather than the set: a single hash over the sorted
assignment, carried on a frame and signed. It settles disputes and pins one version of reality
without handing an observer the map — a second participant that derived the same set can check its
own derivation against the commitment, and a mismatch is detected without the set being disclosed.
Whether that is worth building depends on whether MR-04's *"identical tree"* has to be verifiable by
a third party or only by the two participants; the requirement's text does not say.

## Correction owed regardless of the ruling

MR-04's own requirement text is false twice, independently of this decision: the sort is by
**contributor string** (the CID only breaks ties), not by "sorted partial CIDs"; and the projection
closure never crosses a wire, so no second participant can compute even one leaf CID today. Those
are errors in the row, and fixing them is not the same as deciding this question.
