# Phase 5 — Decomposable Tree-Reduce

**Status:** complete — all 5 criteria met
**Requirements:** MR-02, MR-03, MR-04, MR-05, MR-06, MR-07
**Branch:** `feature/phase-5-tree-reduce`

```
tsc --noEmit  clean
407 tests     all green (was 365)
```

| # | Criterion | Where |
|---|---|---|
| 1 | 8+ nodes compute local partials, aggregate bit-identical to a single-node reference | `reduce.test.ts` — MR-02/03 group |
| 2 | Every participant derives the same tree from sorted partial CIDs, zero messages | MR-04 group |
| 3 | Rendezvous-hashed assignment yielding a ranked fallback known locally | MR-05 group |
| 4 | Aggregator killed mid-combine → recomputed elsewhere from CIDs, late duplicate discarded | MR-06/07 group |
| 5 | Partials inside a single-digit-KiB budget; combines execute redundantly | budget + criterion-5 groups |

## Three ideas, each deleting a category of machinery

**Topology is derived, not agreed.** The tree is a pure function of the sorted partial
CIDs, so every participant computes an identical tree alone and *zero* messages are
spent on agreement. No leader election, no consensus round, no coordinator to lose.
Change one partial and the tree changes the same way for everyone at once, because the
function's input changed.

**Assignment is derived too.** Rendezvous (HRW) hashing ranks every candidate for every
combine. The winner executes; the rest of the ranking *is* the fallback list, already
known locally. Nothing to look up when a node dies. A test confirms the HRW property
that matters — removing a node reassigns only the keys that node had won.

**A combine is a pure function of content-addressed inputs.** Repair is therefore not
recovery: no state to transfer, no checkpoint, no partial progress to reconcile.
Losing an aggregator means calling the same function elsewhere with the same CIDs. A
late result from the presumed-dead node dedupes into nothing — same inputs, same
bytes, same CID — verified by asserting the blockstore does not grow.

## Criterion 5 is where the C3 split becomes real

A sovereign map cannot be run twice: pinning data to one owner removes the second
independent executor by construction, so those partials are **owner-attested**. A
combine reads only content-addressed partials, so it *can* run anywhere — and
therefore redundantly. Stated plainly: the owner's contribution is trusted; the
aggregation over contributions is verified.

Disagreement between replicas is **reported, never voted on**, matching
`executeVerified`. At R=2 there is no majority to be had, and a silent vote would hide
precisely the event redundancy exists to detect. A divergent combine makes the whole
reduce `ok: false` rather than succeeding with a footnote.

## A claim of mine that was wrong

The module originally documented the combiner as needing to be *associative and
commutative*, justified by "a reducer that depends on order would make
recompute-elsewhere unsafe the moment anything is retried".

**That reasoning is wrong**, and a falsification probe proved it: making the test
reducer order-dependent broke nothing. Sorted CIDs and deterministic grouping mean
every executor — original or recomputing replacement — receives a combine's inputs in
the same order, so order-dependence never surfaces.

Corrected. **Associativity** is the load-bearing property, and the bit-identical
reference test is what enforces it: merging up a tree must equal merging everything at
once, or the aggregate depends on a topology that was only ever an implementation
detail. Two tests now pin that — one showing a genuinely non-associative reducer
(subtracting row counts) *diverges* from the reference, so the contract is enforced
rather than merely commented. Commutativity is documented as recommended, not
required.

## Verified by falsification

- Removing the sort from tree derivation fails the two determinism tests — the "every
  participant derives the same tree" claim is genuinely tested.
- A non-associative reducer diverges from the single-node reference, so the
  associativity contract is enforced.

## Decisions

- **A lone child is promoted, not wrapped in a combine.** Merging one value with
  nothing produces the same bytes and costs a dispatch.
- **Partials are deduped before sorting**, so the same partial offered twice cannot
  perturb anyone's tree shape.
- **`MAX_PARTIAL_BYTES = 9216`** — single-digit KiB, chosen against the 16 KiB WebRTC
  message ceiling. A partial that outgrows it has stopped being a summary and started
  being data, which is a sovereignty problem as much as a transport one.
- **Fanout 4 by default**, keeping a combine's whole input set inside one WebRTC
  message while keeping the tree shallow.
- **Hashing is synchronous** (`@noble/hashes`), so deriving topology needs no `await`.
  A participant working out where it fits should not have to be async to do it.

## Carried forward

- **Combines are placed on any listed executor.** The roadmap notes browsers must be
  leaves in v1, because background-tab timer throttling (≥1 minute) would falsely kill
  short leases. Enforcing that needs the node-role information that arrives with
  enrollment in Phase 6; today the caller chooses the executor list.
- **`localDispatch` is in-process.** Wiring combines over `RemoteExecutor` is
  mechanical — a combine is just a task — and belongs with Phase 6's placement.
