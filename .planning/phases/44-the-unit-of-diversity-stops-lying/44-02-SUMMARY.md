---
phase: 44
plan: 2
title: The sentence that ends a reader's search stops overstating
requirements: [VER-11]
criteria: [5, 6]
status: done
completed: 2026-09-16
---

# 44-02 — SUMMARY

## Criterion 5 — `enrollment.ts:122`

It listed, among the reasons the attack radius is tolerable:

> `composeQuorum` enforces anti-affinity by `operatorId` so N sybils under one operator take
> exactly one quorum slot.

True, and about a **narrower** attack than it reads: N identities under **one** name, not N
under N, which cost one extra string and were checked nowhere. A reader who reached that line
and stopped concluded the fabric was protected against bulk identity minting.

**Kept and qualified rather than deleted**, because it was never false about the thing it was
about. The qualification says what changed (the extra string is gone), what did not (an
attacker pays nothing — `enrollment.ts:71` already measures that), and where the bound actually
lives: the number of providers an attacker must reach, which the receipt now reports and which
Phase 45 acts on.

## Criterion 6 — RFC-0003

Measured before and after: `grep -niEc "sybil|operator"` over
`RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md` returned **0**. §14 listed twelve
threats; §15 listed eight invariants. So the code had inherited a diversity rule the
architecture document never stated a threat for.

§14 gains bulk identity creation — one party obtaining many certificates and presenting them as
many independent parties, so that a quorum drawn from them agrees with itself.

§15 gains two, and the second is the one that constrains future work:

- an attribute treated as a diversity dimension is determined by the issuer from material it
  verified, never asserted by the applicant it describes;
- independence claimed for a set of results is bounded by the number of **issuers** behind it,
  not by the number of distinct attribute values those results carry.

Written in the RFC's own voice — short declarative bullets, no file:line, no implementation
vocabulary. It is an architecture document.

## Criterion 5's second half, which the plan did not anticipate

**The same false sentence existed in a second file**, and it was found by the lane rather than
by reading. `bench-attestation.node.test.ts`'s header table said the two-node rung reads
`independent` because *"two workers enrol under `operatorId: bench-worker-${i}`, so two separate
operators agreed"*. The first clause was true and the inference was not: `ownerOfWorker` returns
one `BENCH_USER_SEED` for every worker unless `--sovereign` is passed, and that rung is
`--discover`. The row is dated and qualified on the same rule.

`VER-04`'s traceability row quotes that rung's output — `composed over 2 operator(s):
bench-worker-0, bench-worker-1` — as a live reading. It is no longer reproducible and the
citation is retired with its reason. The archived `v1.1-REQUIREMENTS.md` carries the same
sentence and is deliberately left alone: dating a claim inside a milestone snapshot would make
the snapshot untrue about the day it describes.

## The ledger

`VER-11` ticks, taking v1 from 69 to 70 of 74 and the unchecked from 5 to 4. `VER-12` is the one
post-audit row still open, deliberately: it is gated on an owner decision about how many
certificate providers this fabric will have.

`VER-04` keeps its tick — its literal text is satisfied — and its dated note pointing at VER-11
had already landed when the phases were planned.

`requirements-ledger.node.test.ts` reddened on the tick in three places, correctly: the header's
`[x]` count, the moved / never-checked / opened-after-audit identity, and the Built-not-wired /
Partial / Not-started split. Each is a statement the header makes about itself and that the
guard parses back out of it, so each was re-derived rather than adjusted to fit.
