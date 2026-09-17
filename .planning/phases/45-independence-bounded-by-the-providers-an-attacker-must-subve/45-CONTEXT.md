# Phase 45 — Independence Bounded by the Providers an Attacker Must Subvert — CONTEXT

**The design is `docs/architecture/RFC-0003-RESPONSE-05-operator-identity-and-quorum-diversity.md`
§6 (B.1–B.5)**, which is already written as proposed code, plus the five success criteria in
`.planning/ROADMAP.md` Phase 45. Both are committed and approved. This file records only what
was measured on **2026-09-16** while scoping, and the decisions that measurement forced.
Nothing here re-derives the design.

## 0. The gate is settled, and that is the new fact

The owner ruled on 2026-09-16: **one certificate provider**, and the lower ceiling accepted
with it. Recorded at `.planning/OWNER-ACTIONS.md` §3c (row Done, no longer gates 3b) and in the
ROADMAP's own gate paragraph, both at `4ff8a36`.

**Consequence this phase must carry rather than rediscover: after it lands, no result this
fabric produces is labelled `independent`**, because every member's certificate is signed by
the same party. The strongest label becomes `single-issuer`.

**The rule ships at full strength.** `requireDistinctIssuers` defaults **true** and is not
softened while one provider runs. A default relaxed until a second provider exists reports
exactly the independence this phase exists to stop claiming.

## 1. The one decision §6 does not make, and its answer

§6 B.5 says the option taken is to "accept `'single-issuer'` as the ceiling until [a second
provider] exists". **A ceiling is a label, and a label only exists if composition succeeds.**

Measured: `packages/core/src/job/submit.ts:2853-2857` calls `composeQuorum(certificated, {
size, peerIdOf })` — every other rule at its default. On a refusal the shard falls to
`spec.onQuorumShortfall` (`:2925-2932`), which either degrades to available redundancy or
refuses the shard. So with one provider and the rule at its default on the live path, **every
public shard with `redundancy >= 2` stops composing** — redundant verification dies. That is a
functional regression the owner's ruling did not buy.

**Decision: the live call site waives the refusal explicitly**, passing
`requireDistinctIssuers: false` with a comment citing §3c and the ruling.

**Why that is not a softening, which is the part worth writing down: the waiver turns off the
REFUSAL, not the PREFERENCE.** The round-robin construction still spreads members across
issuers whenever more than one is available, so a two-provider fabric composes a two-issuer
member set and `classifyAttestation` returns `independent` **with no code change** — the
sentence already committed to the ROADMAP, which this phase must not falsify. This is exactly
the shape `requireIndependentPaths` already has in this file: default true, waived where the
shared dependency is acceptable and the receipt still reports it.

## 2. Criterion 3 is a guard that KEEPS a property, not a sweep that establishes one

Measured over non-test source for all three strength literals:

- `packages/core/src/quorum.ts` — `:124` the union, `:129/131/133` and `:141/143/145` two
  exhaustive switches, `:376/378/381` the classify returns, `:292/402` comments.
- `packages/core/src/enrollment.ts:146` — a comment.
- `packages/node/src/mutation-ledger.ts:1018/1121/1122/1124` — planted-mutation **records**
  (find / replace / signature strings). Data about mutations, not comparisons. `:1121-1124`
  plants `if (operators.size >= 2) return 'independent'` → `>= 1` with signature
  `expected 'independent' to be 'owner-domain'`, and **that line changes in this phase**, so
  the ledger entry goes stale and updating it is a task, not a follow-up.

`grep -rnE "strength\s*(===|!==|==)"` over non-test source returns **nothing**. Every
comparison already routes through `attestationRank` — `packages/net/src/reduce-job.ts:530`,
`packages/core/src/job/submit.ts:2321`. Test files hold 34 / 26 / 31 occurrences of the three
literals and those are **assertions, which are legitimate**; the guard must not forbid them.

`tsc` is the first instrument of the insertion sweep: both switches are exhaustive, so a new
union member makes the compiler name every site that must move.

**The guard's own prose must not trip the guard.** `vocabulary.node.test.ts` reddened twice on
comments written during Phase 44, and `packages/cloudflare/wrangler.jsonc`'s header records the
same collision twice more. Carve out by name with a stated reason, or write the comments so
they survive their own rule.

## 3. An edge ruled here rather than discovered during execution

**Does the issuer rule fire at `size: 1`?** No. A one-member set claims no independence —
`classifyAttestation` returns `owner-attested` for `agreeing.length <= 1` — so refusing it on
an issuer ground would refuse a composition that never made the claim. The check fires only
when the member set holds **two or more** members, and a case names the decision so a later
reader does not read the absence as an oversight.

## 4. The census will happen again — this is planned for, not a surprise

Phase 44 closed an unchecked field and reddened five fixtures, every one of which was relying
on the hole. This phase closes a second one, and every fixture composing a quorum under default
rules from certificates of **one** test authority now meets `single-issuer-quorum`.

The dividing line is this repository's own:

- **A test fixture may be given a second issuer.** The number of parties is the thing the rule
  checks, so supplying two authorities restores the fixture's intent unchanged.
- **A driver that publishes a reading of a real rig may not.** Its labels must describe the
  rig. `packages/node/src/bin/bench.ts`'s real rungs were re-labelled `owner-domain` in Phase
  44 and are therefore below the reach of this rule — **verify that, do not assume it.**

Every assertion that moves from `'independent'` to `'single-issuer'` is a census entry: *what
was this relying on, and was it true?* Reported, not silently repaired.

## 5. An obligation already committed to the ROADMAP, so it is scope

The gate paragraph at `4ff8a36` says: *"the public copy for the release must not promise an
independence the fabric will not report — that copy is Phase 39's, and this phase must check it
rather than assume it."* That is a task with a verification, not a note. If the published copy
promises independent verification, either the copy moves or the finding is reported; it is not
closed by reading the copy and deciding it is fine.

## 6. Where criterion 5 is actually read by a human

`describeAttestation` (`quorum.ts:139-148`) is the single source of the sentence, and every
surface copies it rather than composing its own — several say so in their own comments. The
new arm must name **which** dimension fell short (the operators are distinct, the provider is
one), or a reader who sees `single-issuer` cannot tell which of the two dimensions failed.

Surfaces that print `strength (replicas N, operators M)` and must also show the issuer count:
`packages/node/src/bin/agent.ts:2443`, `packages/node/src/bin/bench.ts:2135` and `:2181`,
`packages/browser/demo/surfaces/fabric.ts:353` (rendered at `:473`),
`packages/browser/demo/render.ts:246`.

## 7. Stale text this phase must rewrite rather than leave

`AttestationReceipt.issuers`' docblock (`quorum.ts:~395-410`) says *"nothing refuses on it yet,
which is the whole of what this field is"* and *"Phase 45 imposes the rule once that is
settled"*. Both sentences stop being true in this phase. The same applies to
`packages/core/src/enrollment.ts:146`, which describes the decision as open.
