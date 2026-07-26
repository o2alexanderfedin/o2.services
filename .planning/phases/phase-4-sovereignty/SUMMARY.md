# Phase 4 — Sovereignty, Authorization & Artifact Signing

**Status:** 5 of 6 criteria met; criterion 2 met in the form that is testable today
**Requirements:** DATA-03…DATA-09, DET-03, AUTH-03
**Branch:** `feature/phase-4-sovereignty`

```
tsc --noEmit  clean
365 tests     all green (was 277)
```

| # | Criterion | Status |
|---|---|---|
| 1 | Sovereignty pins a map task to the owner; load pressure cannot move it | **met** |
| 3 | Owner-signed egress manifest, complete by construction | **met** |
| 4 | Task without a valid chain refused *before* instantiation, naming the missing link | **met** |
| 5 | Artifacts resolve only through signed `key → CID` against pinned anchors | **met** |
| 6 | Encrypted backbone replica serves availability, refused as an execution target | **met** |
| 2 | A stream tap fails if a raw sovereign byte crosses the wire | **met as a detector** — see the caveat |

## Criterion 1 — a property of the code, not of the scheduler's judgement

The promise is that raw data never leaves the owner's device. That cannot rest on a
scheduler *choosing* not to move a task, because a scheduler under load pressure is
exactly the thing that eventually chooses otherwise.

So `planPlacement` narrows candidates to the owner's own nodes **before load is
consulted at all**, and the load-balancing step then operates on the already-narrowed
set. There is no fallback branch, no "if nothing suitable is available" clause, and no
threshold at which the rule relaxes. A sovereign shard with no eligible owner node
comes back `unplaceable` — a stalled job, which is the right answer and a far better
one than a quiet leak.

The criterion asked for a test that "applies artificial load pressure specifically to
force relocation". That test pins Alice's only node at load 1.0 beside four idle
foreign nodes — the precise input a load-balancer is built to react to.

**Falsified before being believed.** Adding the forbidden branch —

```ts
if (own.every((n) => n.load > 0.9)) return nodes   // relax under pressure
```

— fails four tests, including `expected [ 'bob-1' ] to deeply equal [ 'alice-1' ]`.
The guarantee is genuinely tested rather than merely asserted.

Two related decisions fall out of the same design:

- **A sovereign shard with no `ownerId` is broken, not unrestricted.** Read the other
  way, a missing label would be the most dangerous default in the system.
- **Degraded redundancy is reported, never silently tolerated.** A sovereign shard
  with one live owner node is owner-attested rather than verified, and a caller that
  cannot tell the difference will over-claim.

## Criterion 4 — the ordering *is* the requirement

`verifyChain` walks a chain of signed delegations rooted at the owner's key, checking
linkage, signatures, expiry, owner scope, ability, audience, and — easy to miss — that
any re-delegation was performed by a holder who was actually granted `delegate`.
Without that last check, any recipient could widen a capability to anyone.

Every refusal names the link: *"link 1 is issued by X, but link 0 delegated to Y"*.
A test asserts all five failure kinds produce **distinct** messages, because a refusal
that reads the same for every cause is no better than "denied".

Crucially the check is wired into `serveAgent` **before** `executor.execute`, and the
test watches for execution rather than only for the refusal — a node that runs the
module and *then* returns "unauthorized" has already read the owner's data. The
assertion is `expect(executed).toBe(0)`.

A malformed chain is refused outright rather than truncated to the links that happened
to parse, since pruning to a verifying prefix is an attack, not a recovery.

**Rolled by hand rather than adopting UCAN**, after weighing it: the entire surface
needed is *sign a small canonical record, verify a linked sequence*. `@noble/curves`
provides the hard part and the canonical encoder already guarantees stable bytes to
sign over — the one thing a home-grown scheme usually gets wrong. UCAN would bring DID
resolution, a JWT envelope, and a spec still in flux, for semantics not yet used.
Worth revisiting if interop with other UCAN systems is ever wanted.

## Criterion 5 — integrity is not provenance

A CID proves the bytes you fetched are the bytes that were hashed. It cannot tell you
they are the module you meant to run, because anyone can publish a CID. So nothing
executes a bare CID: names resolve through signed `key → CID` records, accepted only
from keys pinned at construction.

`SignedNameResolver` has **no method to learn a new anchor**, and a test asserts that.
A resolver that could be taught one would only be as trustworthy as whatever taught it.

Version numbers are monotonic per name, so a signer cannot replay a genuinely-signed
older record to roll a name back to a previous, possibly vulnerable, artifact.

## Criterion 3 — "complete by construction" taken literally

`EgressGuard` is a `Transport` decorator, so recording is not something the sender does
*in addition to* sending — it is part of sending. A manifest assembled by instrumenting
call sites is complete only for the call sites someone remembered; this one is complete
because there is nowhere else to go. A test drives RPC traffic through it and confirms
the layer above never touched the inner transport.

A frame is recorded **before** the send is attempted, so a frame that left and then
failed still appears. Recording on success would understate egress precisely when
something went wrong.

## Criterion 2 — met as a detector, and the distinction matters

The tap catches a frame carrying registered sovereign bytes, including embedded in a
larger frame, and stays quiet for an aggregate derived from the same data or for a
near-miss differing by one byte.

**It is a detector, not a prover.** It cannot show that *no* encoding of a sovereign
value could ever slip past — a compressed, encrypted, or re-encoded copy would not
match. It does catch the failure that actually happens: a map step that forgot to
aggregate and shipped its input. That is the same prediction-versus-detection line the
project settled on in Phase 1, and it is drawn here deliberately rather than by
omission. A stronger claim would need taint tracking through the guest, which is a
research project, not a phase.

## Carried forward

- **Push-down of filters and projections is not yet automatic.** The tap proves an
  aggregate-only frame passes and a raw-row frame fails; it does not yet *cause*
  aggregation to happen. Tree-reduce in Phase 5 is where that becomes structural.
- **`EgressGuard` records but does not sign.** The manifest carries `ownerId` and is
  attributable, but owner signing should reuse the `capability.ts` primitives once the
  node has a stable key — that arrives with enrollment in Phase 6.
