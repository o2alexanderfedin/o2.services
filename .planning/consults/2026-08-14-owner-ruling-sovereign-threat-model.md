# Owner ruling, 2026-08-14 — the sovereign threat model, and what it removes

> *"We process sovereign data at rest, so there is no interest in faking the results. Even if the
> cloud node (that stores the data to be processed) is a bad player, the radius is very low."*

Recorded because it **removes** work rather than adding it, and because two designs drafted the
same day were built on a threat model this ruling says does not apply.

## What it establishes

1. **The requestor of a sovereign job is the data owner.** The answer is for themselves. There is
   no incentive to fake a result about one's own data, so "malicious requestor" is not a threat to
   design against on this path.
2. **A bad storage node has a blast radius of one owner's own data.** It cannot reach the fabric,
   other owners, or the public path. Low radius is the security property, and it is structural —
   sovereignty pins the data to the owner's device in the first place.

## What it does NOT license, stated so the boundary is not lost

- `PROJECT.md:31` — ***any cross-owner aggregate*** has its aggregation verified, independent of
  how each partial was produced. Where contributions from *different* owners are combined there IS
  a verification interest, and it already has a mechanism (combine signatures,
  `MIN_SOVEREIGN_COMBINE_REPLICAS`). This ruling does not touch it.
- The **public** path keeps full N-version redundancy and commit-reveal. Untouched.
- `PROJECT.md:30` already said the sovereign map is **owner-attested**. This ruling is consistent
  with the published split rather than a relaxation of it: *the owner's contribution is trusted;
  the aggregation over contributions is verified.*

## What it changes, concretely, today

**MR-05 — drop the executor-side rendezvous check as a security measure.** A same-day consultation
recommended that an executor recompute the combine id and refuse work it was not the rendezvous
choice for, on the grounds that *"a malicious requestor can concentrate every combine on one node,
or bypass the schedule to collude with a lazy executor."* Both are attacks by the data owner
against their own job. Under this ruling the check is not security; it survives only as a
routing-correctness guard, which is a **YAGNI** call and not a requirement.
**And the row's own text — *"combine executors are assigned by rendezvous hashing, yielding a
ranked fallback list"* — is already built, wired, and read across eight real `bin/agent.ts`
processes.** The verifiability concern was an addition to the row, not the row.

**MR-04 — the heavy option is off the table.** Publishing the contribution set on a frame was
scored *weak* on cost even under an adversarial model (O(N) metadata before processing starts, and
it does not make leaf CIDs derivable anyway). With no faking interest, what remains of *"every
participant computes an identical tree"* is **routing stability and dedup**, not fraud prevention.
The candidate resolution is therefore a **reword to the property**, on VER-03's own precedent —
*"reworded by owner ruling; the property is unchanged and the bar is not lowered"* — together with
correcting the two things the current text says that are false of the code: the sort is by
contributor string and never by CID, and the projection closure never crosses a wire.

## The rule this is an instance of

Design against the threat model you have, not the one the literature assumes. Both drafts above
came from a source reasoning about open adversarial marketplaces; this fabric pins sovereign data
to its owner's device, which is a different problem with a smaller enemy.
