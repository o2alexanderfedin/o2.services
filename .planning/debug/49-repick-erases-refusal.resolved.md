---
status: resolved
trigger: "DEFECT #49 — a re-picked shard's ShardResult erases the first executor's named refusal"
created: 2026-08-05
updated: 2026-08-17
resolved_by: 0e045f5
---

## Current Focus

CLOSED. The hypothesis was TRUE of the tree on 2026-08-05 and is FALSE of the tree today:
the defect was real and was fixed the same day by `0e045f5` — *"fix(core): a shard that
gave up on a node still says what that node said"* (2026-08-05 13:46:28 -0700), an
ancestor of both `develop` (f805c17) and `main` (4147266).

**This file's `status:` said `investigating` for twelve days while its own `Resolution`
section carried a completed fix and verification.** Nothing was wrong with the code; the
bookkeeping was wrong, and a filename-filtering progress counter therefore kept counting a
closed defect as open. That is the same miscount that left two other sessions unrenamed
for nine days. Re-verified and renamed on 2026-08-17 — see the re-verification below.

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

- checked: RE-VERIFICATION 2026-08-17, in an isolated worktree off `main` (4147266), which
    strictly contains `develop` (f805c17) — `git merge-base --is-ancestor f805c17 HEAD`
    exit 0, and `HEAD..develop` empty. Own `node_modules` installed in the worktree
    (`npm install` exit 0, 342 packages); nothing symlinked from the main checkout, so
    what ran is this tree and not another.
  found: the fix is present at all three producers named below —
    `verify.ts:187` declares `failures` **required** on the `agreed` arm;
    `verify.ts:269` populates it in `executeVerified`;
    `submit.ts:1655` populates it in `mergeVerifications`.
    All three test cases added by `0e045f5` survive in the tree
    (`submit.test.ts:1669`, `submit.test.ts:1710`, `verify.test.ts:390`).
  implication: already-fixed-at-0e045f5. The hypothesis is refuted **as a statement about
    the tree today**, and confirmed as a statement about the tree on 2026-08-05.

- checked: whether today's green is load-bearing or vacuous — two plants, each restored by
    the surgical inverse of the edit (never `cp`, never `git checkout --`), each restore
    confirmed `cmp` exit 0 against a snapshot taken immediately before planting, with
    `git status --porcelain` empty before and after. No concurrency hazard: this worktree
    is a separate directory from the main checkout, so no sibling agent can write here.
  found: BOTH plants go red, and — as recorded on 2026-08-05 — **neither reds all three**,
    which is the two halves of the loss reading separately.
    - plant A, `failures` removed from `mergeVerifications`'s agreed return: vitest exit 1,
      2 failed / 122 passed of 124. Reds the two `submit.test.ts` cases only.
      "AssertionError: expected undefined to strictly equal [ { nodeId: 'n1', …(1) } ]" and
      "expected undefined to strictly equal [ { nodeId: 'n1', …(1) }, …(1) ]".
    - plant B, `failures` removed from `executeVerified`'s agreed return: vitest exit 1,
      2 failed / 122 passed of 124, a **different pairing** — the `verify.test.ts` case plus
      `submit.test.ts`'s re-pick case.
      "AssertionError: expected undefined to deeply equal [ { nodeId: 'b', …(1) } ]" and
      "expected undefined to strictly equal []" (the latter is that case's *control* leg —
      the shard that lost nobody — which is what makes the control worth having).
  implication: the cases carry the claim rather than passing vacuously, and they carry the
    two halves independently. One correction to the 2026-08-05 record: it quotes plant B as
    "strictly equal [ { nodeId: 'b', …(1) } ]"; the matcher actually reports **deeply**
    equal. The reading stands, the quoted word did not.

- checked: the blind spot the reasoning_checkpoint left open — "a consumer that spreads a
    VerificationResult into a narrower literal would not be caught by grep."
  found: `npx tsc --noEmit` whole-tree, **exit 0, zero lines of output**. Trustworthy here
    despite this repo's standing caveat that a whole-tree `tsc` reports another agent's
    mid-edit files, because the worktree is isolated and `git status --porcelain` was empty.
  implication: blind spot closed by measurement rather than by argument. A required field
    on the `agreed` arm means the compiler enumerates every construction site, and it found
    none unsatisfied.

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

verification_2026_08_17: re-measured in an isolated worktree with its own `node_modules`.
  Counts have moved because the specs have grown since 2026-08-05 — 123 then, 124 now on
  the same two files:
  - baseline, `submit.test.ts` + `verify.test.ts`: vitest exit 0, **124/124**.
  - both plants red, both restores `cmp` exit 0 (detail in Evidence above).
  - final, adding `packages/net/src/reduce-job.test.ts` — the third file `0e045f5`
    touched: vitest exit 0, **139/139 across 3 files**.
  - `npx tsc --noEmit` whole-tree: exit 0, no output.
  Every exit code above was read as `EXIT=$?` on the line immediately after the command,
  with no pipe and no trailing `tail`.

  **One timing figure here must not be re-quoted as a cost.** `/usr/bin/time -p` on the
  baseline read `real 41.42 / user 2.20 / sys 0.46`, ratio 0.06 — and that is a *cold*
  reading taken as the first vitest invocation after `npm install`, dominated by Vite
  dependency optimisation, not by the tests. The final 3-file run read
  `real 1.84 / user 2.42 / sys 0.47`, where user+sys **exceeds** real because workers run
  in parallel. So 41.42 s is a cache-warming artifact and 1.84 s is the warm figure;
  quoting the former as "how long these specs take" would be false. Host was carrying two
  sibling agents at the time (load ~10), which is why the process-level reading is
  recorded rather than a machine-level one. Node was v23.11.0 — `npm install` emitted
  EBADENGINE warnings against the project's declared Node 24; it did not affect these
  results but it is the condition the numbers were taken under.

files_changed:
  - packages/core/src/job/verify.ts
  - packages/core/src/job/submit.ts
  - packages/core/src/job/submit.test.ts
  - packages/core/src/job/verify.test.ts
  - packages/net/src/reduce-job.test.ts

residual_noted_not_a_defect: `carriedResult` (`submit.ts:1511`) returns `failures: []` on an
  `agreed` arm whose own doc calls that field "a measurement rather than a default". Read in
  isolation those two look in tension, and a reader could take the `[]` for a claim that the
  predecessor's run met no refusals. It is not one: the `[]` is scoped to *this* requestor,
  which asked nobody, and the site is discriminable by `replicas: 0` / `attempted: []`, which
  the adjacent comment says explicitly. Recorded because the tension is real on a fast read,
  not because anything needs changing — no test or type is wrong here. Anyone who later wants
  "predecessor's history unknown" to be *structurally* distinct from "nobody refused" is
  proposing a new arm on the type, which is a design decision for the owner and out of
  DEFECT #49's scope.
