# Owner ruling: prefer LOCAL execution; remote is what you fall back to

**Ruled 2026-08-18 by the owner**, unprompted, while the local-combine fallback was being built.
Recorded here because it is a **placement policy for the whole fabric**, not a note about one
function, and because it *reverses* a constraint that had already been written into a brief.

## The ruling, verbatim

> **"Always prefer local execution, unless it must be executed remotely (requested to do so, or
> needs certain permissions that cannot be satisfied or data ownership requires, etc.) or the
> current node is fully loaded."**

## What it reverses

Hours earlier the owner had chosen to add a local combine arm to `reduce-job` as a **last-resort
fallback** — engaged only after every remote executor in the ranking returned `null`. The brief
written from that decision said, in as many words, *"The fallback is last, not first… It must never
pre-empt a reachable peer."*

This ruling inverts that. Local is the **default** path; remote is the exception, and each exception
must be a named, checkable condition rather than an implicit fallthrough:

| escape | what it means here | where the vocabulary already exists |
|---|---|---|
| **data ownership requires it** | a sovereign partial must not leave its owner's node, so the requestor cannot combine it | `packages/net/src/reduce-sovereign.ts`, the egress manifest |
| **permissions cannot be satisfied** | no capability chain admits this node to this work, or it lacks a needed key | `authorizeCapability`, the SPKI/UCAN chain |
| **the local node is fully loaded** | no headroom | `LocalCapacity.would(offer)`, `headroom`, `states-no-capacity`, and `discovery.ts`'s `LocalAdmission` port |
| **remote was requested** | a caller asked for remote and gets it | caller-supplied option |

**Use `LocalAdmission` for the capacity leg rather than inventing a second notion of "busy".** That
port exists precisely so a node answers an offer addressed to itself by the same rule as everybody
else, and its docblock records what happened when self-dispatch was got wrong: asking over the wire
produced `Can not dial self`, and at `redundancy: 2` a two-tab demo reached one replica with
`job.complete` false.

## The tension this creates, stated rather than resolved

PROJECT.md's core claim splits integrity two ways: *"the owner's contribution is trusted; the
aggregation **over** contributions is verified."* The verification in that second clause comes from
the aggregation being performed by parties other than the one who wants the answer.

Preferring local execution means that, by default, **the requestor aggregates its own job**. And
`localDispatch` signs nothing — deliberately, by its own docblock, because *"a signature it made
would be the requestor attesting to itself, which proves nothing to the only party reading it."*

So a locally-combined aggregate is **self-attested**, and under this policy that is the common case
rather than a rare one. Two consequences follow and neither is optional:

1. **The outcome must carry a marker saying the aggregate was combined locally**, prominent enough
   that no caller can mistake it for a verified one. Under the last-resort design this was a
   footnote; under this one it is the main thing standing between the outcome and a silently
   weakened integrity claim.
2. **This policy is about placement, not about the sovereignty guarantee.** Preferring local
   *execution* must never become moving someone else's data to the local node in order to run it
   there — that inverts the project's whole premise. The sovereignty escape above is what keeps the
   two apart, and it is the escape most likely to make a naive "prefer local" wrong.

Whether the verification claim survives this policy in the public/shared-data tier is **an open
question for the owner**, flagged rather than answered. It is not this ruling's job to settle it,
and it must not be settled by quietly keeping the old ordering.

## Scope beyond the combine path

The ruling is written generally and should be read generally. It bears on `packages/core/src/placement.ts`'s
power-of-d-choices selection, which today ranks *peers* and reaches the local node only through
`rpcAdmission`'s self-offer arm. Applying the policy there is **not** done and is not implied to be
done by this file — it is named so the next reader knows the policy is broader than the one function
that occasioned it.
