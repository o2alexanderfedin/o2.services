# Consultation — reduce-tree topology agreement (Google AI Mode, 2026-08-14)

Asked as an open question with an explicit invitation to refute the premise.

## The reframing, which is the valuable part

**Topology agreement is not needed for semantic correctness.** If the combine is genuinely
associative and commutative, any valid topology — flat list, balanced binary tree, deep linear
spine — yields the same root value. Agreement is needed for exactly two operational things:

1. **Deterministic work routing.** Rendezvous hashing needs a stable key. If topology moves, the
   keys move, the executors move, and load distribution and cache locality go with them.
2. **Dedup / memoisation.** Two requestors running the same job should produce identical internal
   node CIDs so an executor can serve a cached result.

So MR-04's sentence — *"every participant computes an identical tree with no consensus"* — is
about routing and verifiability, not about the answer being right. That is worth putting to the
owner before any frame is designed.

## On our two measured problems

- **Hidden projection.** If no third party can compute the leaf CIDs, the tree is unverifiable by
  the network and the system reverts to a trusted-requestor model: a requestor that lies about a
  leaf CID misroutes the rendezvous and nobody can prove it cheated.
- **Blind execution.** An executor that cannot validate the rendezvous assignment means a requestor can
  concentrate every combine on one node, or bypass the schedule to collude with a lazy executor.

## The three options, scored

| Option | Verdict |
|---|---|
| Publish the contribution set on a frame | **Weak.** O(N) metadata bottleneck before processing starts, and it does not fix the hidden projection — the partial CIDs do not exist until the leaves finish |
| Derive the tree only from values already on the wire | **Highly viable.** Any participant reconstructs the same tree from the set of available inputs |
| Abandon topology, verify root + per-combine signatures | Good for a trustless proof-of-computation market; **breaks rendezvous and load balancing entirely** |

## The recommended fix for the blind executor, and it needs NOTHING new on the wire

> The requestor sends the child CIDs. The executor independently computes
> `internalNodeId = Hash(Min(c1,c2) ++ Max(c1,c2))`, runs the rendezvous function against the
> known node registry, and **accepts only if the answer is its own identity** — otherwise it
> rejects as a routing error or a malicious request.

`packages/net/src/combine.ts` already sends `{kind:'combine', combineId, inputCids, level}`, so the
executor already holds `inputCids`. This is a pure receiving-side check, and it simultaneously gives
`combineId` its first reader: today it is encoded, parsed, handed to the authorizer, and
`capability-authorizer.ts:100` returns before touching it.

## What this does NOT settle

Whether the contribution set should be published at all. In this fabric the exec replies are
unicast to the requestor, so "values already on the wire" are on a wire only the requestor reads.
Making the tree independently derivable therefore still needs a publication decision — which is the
owner call MR-04 turns on, now with its cost and its alternatives measured rather than assumed.
