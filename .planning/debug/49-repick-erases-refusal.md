---
status: investigating
trigger: "DEFECT #49 — a re-picked shard's ShardResult erases the first executor's named refusal"
created: 2026-08-05
updated: 2026-08-05
---

## Current Focus

hypothesis: `mergeVerifications` collects `failures` from both generations into a local
  `failures` array, but the `agreed` return arm of `VerificationResult` declares no
  `failures` field — so on a re-pick that succeeds, the local array is discarded and the
  first executor's named refusal is unrecoverable from `ShardResult`.
test: build a two-generation fixture (gen 1 node fails with a distinctive reason, gen 2
  node succeeds) and assert the reason string appears nowhere in the returned ShardResult.
expecting: reason string absent => defect real. Present anywhere => defect refuted.
next_action: locate the existing submit test harness and write the measuring test.

## Symptoms

expected: a re-picked shard's result names why the first executor refused
actual: (to measure) the `agreed` arm carries no failures
errors: none — silent loss, no throw
reproduction: (to establish)
started: unknown

## Eliminated

## Evidence

- checked: `packages/core/src/job/verify.ts` `VerificationResult`
  found: three arms. `disagreed` and `insufficient` both declare
    `failures: readonly { nodeId: string; reason: string }[]`. The `agreed` arm declares
    `resultCid/output/agreeing/replicas/grossFuel/usefulFuel` and NO `failures`.
  implication: an agreed result is structurally incapable of carrying a refusal.

- checked: `mergeVerifications` in `packages/core/src/job/submit.ts`
  found: builds `const failures: { nodeId: string; reason: string }[] = []`, pushes
    `generation.failures` for every non-agreed generation, then uses `failures` in the
    `disagreed` and `insufficient` returns only. The `agreed` return omits it.
  implication: the array is populated and then dropped on exactly the arm the defect names.

- checked: the generation loop in `submitJob`
  found: `verification = verification === null ? dispatched.verification :
    mergeVerifications(verification, dispatched.verification)`. So gen1-insufficient
    merged with gen2-agreed goes through the dropping arm.
  implication: mechanism confirmed by reading; needs measurement.

- checked: `ShardResult` fields for an alternative carrier
  found: `attempted` is documented "The set ASKED, never the set that answered" — node ids
    only, no reasons. `rejections: readonly Rejection[]` is placement-time refusals from
    `JobSpec.admit`, documented `[]` "for a caller that supplied no JobSpec.admit".
    Execution failure is a different event from placement refusal.
  implication: no other field can carry an executor's refusal reason.

- checked: measured `submitJob` with `[failing('n1', REASON), honest('n2'), honest('n3')]`
    at redundancy 1, then deep-walked every string reachable from the JobResult
  found: `ending=agreed generations=2 attempted=["n1","n2"] rejections=[]`,
    `control — 'n1' found = true`, `strings reachable from ShardResult = 32`,
    `reason present in whole ShardResult = false`,
    `reason present in whole JobResult = false`
  implication: DEFECT REAL. The first instrument was faulty — a `JSON.stringify` replacer
    testing `'toString' in v`, which is true for every object through the prototype chain,
    collapsed the result to "[object Object]" and would have reported absence whatever the
    truth was. Reading discarded and re-measured with a deep walk that proves itself in the
    same run by finding a string that IS present.

- checked: the same loss one layer down, in `executeVerified` itself
  found: it computes `const failures = receipts.filter(...)` and uses it in the
    `insufficient` and `disagreed` returns only. Its `agreed` return omits it. So a SINGLE
    dispatch at redundancy 2 where one replica fails and one succeeds also drops the
    failed replica's reason — this is not only a cross-generation loss.
  implication: the fix belongs on the type, not in the generation loop. Adding a field to
    `ShardResult` alone would leave the within-dispatch half of the loss open.

## Resolution

reasoning_checkpoint:
  hypothesis: "the `agreed` arm of `VerificationResult` declares no `failures` field, so
    every named executor refusal that preceded an eventual agreement is discarded — in
    `executeVerified` within one dispatch, and again in `mergeVerifications` across
    generations."
  confirming_evidence:
    - "measured: reason string absent from all 32 strings reachable from the ShardResult,
       with a same-run control proving the walk finds strings that are present"
    - "read: `mergeVerifications` builds and populates a local `failures` array, then uses
       it in the `disagreed` and `insufficient` returns and not in the `agreed` one"
    - "read: `executeVerified` does the identical thing at the layer below"
  falsification_test: "the reason string appearing anywhere in the JobResult would refute it"
  fix_rationale: "add `failures` to the `agreed` arm and populate it at all three
    producers. This addresses the cause — a type that cannot express the fact — rather
    than the symptom, and closes the within-dispatch half that a ShardResult-only field
    would have missed. Required rather than optional, by the repo's own standard on
    `ShardResult.attestation`: an omitted array read as `[]` makes 'nobody refused'
    indistinguishable from 'nobody recorded it'."
  blind_spots: "only 4 non-test construction sites of an `agreed` result exist, so the
    compiler enumerates the change; but a consumer that spreads a VerificationResult into
    a narrower literal would not be caught by grep. `tsc --noEmit` covers that."

root_cause: the `agreed` arm of `VerificationResult` in `packages/core/src/job/verify.ts`
  declares no `failures` field. Both producers of an agreed result compute the failures and
  then drop them: `executeVerified` (within one dispatch) and `mergeVerifications` (across
  generations). `ShardResult.attempted` records that a node was asked and `generations`
  records that a retry happened, but nothing records WHY.
fix: added a required `failures` field to the `agreed` arm of `VerificationResult` and
  populated it at all three producers — `executeVerified` (the within-dispatch half, from
  the array it already computed), `mergeVerifications` (the cross-generation half, unioned
  in generation order), and `carriedResult` (`[]`, because this requestor asked nobody).

verification: 123/123 green across `submit.test.ts` + `verify.test.ts`. Two independent
  plants, each applied-run-restored in one invocation with cmp confirming both ends:
  - removing `failures` from `mergeVerifications` reds 2 of 3 new cases —
    "expected undefined to strictly equal [ { nodeId: 'n1', …(1) } ]"
  - removing it from `executeVerified` reds a different pairing —
    "expected undefined to strictly equal [ { nodeId: 'b', …(1) } ]"
  Neither plant reds all three, which is the two halves of the loss reading separately.

files_changed:
  - packages/core/src/job/verify.ts
  - packages/core/src/job/submit.ts
  - packages/core/src/job/submit.test.ts
  - packages/core/src/job/verify.test.ts
  - packages/net/src/reduce-job.test.ts
