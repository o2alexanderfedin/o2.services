---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 06
subsystem: verification
tags: [ver-03, ver-04, ver-08, ver-09, ver-10, quorum, attestation, receipt, submit]

requires:
  - phase: phase-19
    provides: "19-01's certificate on `NodeDescriptor`, without which none of the three kernel symbols could be called anywhere on the dispatch path"
  - phase: phase-19
    provides: "19-02's shared-dependency rule on the chosen member set, and the strength `composeQuorum` derives rather than declares"
  - phase: phase-19
    provides: "19-13's `result-attestation.ts` and 19-14's `AgreeingReplica`, which is what makes a receipt evidence rather than a lookup"
  - phase: phase-19
    provides: "19-18's `JobSpec.onQuorumShortfall`, a required union that nothing read until this plan"
provides:
  - "`ShardResult.attestation` and `JobResult.attestation` — an `AttestationReceipt` or the named absence, required on both"
  - "`ShardResult.quorum` — composed, not-composed with the composer's own refusal and reason, or not-attempted with the condition that did not hold"
  - "`composeQuorum`'s first production caller: a public shard at redundancy >= 2 is placed on the member set it returns"
  - "`attestationReceipt`'s first production caller since Phase 6, handed only certificates whose holders signed this result"
  - "the strictness dial read at the one point a shortfall exists, and nowhere else"
  - "`degraded` widened to cover a verification shortfall, with its doc corrected rather than stretched"
affects:
  - "19-08 — the across-process readings of the gate and the dial"
  - "19-09 — the sovereign replica-set path, which this plan deliberately leaves to it"
  - "19-10 / 19-11 — the CLI and demo displays; both need the new types re-exported from `@o2/core`'s barrel, which this plan did not touch"
  - "19-12 — the verdicts on VER-03, VER-04, VER-08, VER-09, VER-10 and AUTH-05; this plan moved their REASONS only"

tech-stack:
  added: []
  patterns:
    - "A named absence carrying its counts, not a bare literal: `0 of 2` and `1 of 2` are different situations and a literal would make them the same word"
    - "A hard constraint applied before the load preference, never checked after it — the shape NET-08 and 16-06 were each corrected for"
    - "The gate above the arm selection, so both placers receive one pool and neither can drift"
    - "An issuer set pinned to the descriptor's own issuer instead of a second issuer comparison, because the comparison beside it could not fire"

key-files:
  created: []
  modified:
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/net/src/reduce-job.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The plan's `nodeKey` + `issuer` check is implemented as `nodeKey` equality plus an issuer set pinned to the descriptor's own issuer. An `issuer !== issuer` comparison beside that set is UNREACHABLE — `verifyResultAttestation` is handed `{descriptor's issuer}` and refuses anything else by name as `untrusted-issuer`. Measured, not reasoned: the deviation is recorded rather than the dead branch written."
  - "The named absence is a record with a `kind` literal, not the bare string literal the plan's behaviour clause asked for. A bare literal cannot carry the reason and counts the same clause requires two paragraphs later, and a sibling reason field would be the second source of truth this phase keeps rejecting."
  - "The offer arm groups requests by pool. `planWithOffers` takes ONE pool for a whole job and keeps its cross-shard headroom tally inside a single call, so a per-shard pool cannot be expressed by narrowing its argument. With one pool — every job that composes nothing, and every all-public job that does — this is the single call it replaces, in shard order. The plan does not mention this tension."
  - "`submitJob` now reads the wall clock once per job. It is the FIRST `Date.now()` in `packages/core/src`. Both injected-clock alternatives are worse: `SubmitOptions` is optional as a whole, and a `JobSpec` field would be a ninety-four-site fan-out for one expression."
  - "The plan predicted existing `degraded` assertions would move and asked for each to be named. NONE moved. Every pre-existing fixture in the tree builds descriptors through `publicNodes`, which states `carries-no-certificate`, so the gate is never attempted on any of them."
  - "`sovereignty.test.ts` and `placement.test.ts` needed no edit, which the plan named as the good outcome."
  - "The barrel `packages/core/src/index.ts` does NOT re-export `ShardAttestation`, `ShardQuorum` or `NoVerifiedAttestation`. It was being edited by the concurrent 19-16 executor throughout this session and is out of this plan's `files_modified`. 19-10 and 19-11 will need them."

requirements-completed: []
duration: one session
completed: 2026-08-03
---

# Phase 19 Plan 06: The quorum on the path, and the receipt on the result Summary

`composeQuorum` and `attestationReceipt` have production callers for the first time. Every shard
a job returns now says how strongly its result is attested — derived from certificates whose
signatures over *that* shard's task and result were checked — or says that this requestor holds
no signed statement about it at all.

## What changed

**`packages/core/src/job/submit.ts`** — one lookup, one signature check per agreeing replica, one
receipt on each of two result types, and one gate in the placement pass.

| addition | what it is |
|---|---|
| `NoVerifiedAttestation` | the named absence, carrying its reason and the `agreeing` / `verified` counts |
| `ShardAttestation` | `AttestationReceipt \| NoVerifiedAttestation` |
| `ShardQuorum` | `composed` / `not-composed` (the composer's own `QuorumRefusal` and reason) / `not-attempted` (which condition did not hold) |
| `receiptFor` | four named questions per agreeing replica |
| `jobAttestationOf` | the weakest shard by `attestationRank`, or the absence if any shard carries one |
| the gate | job-level composition, applied per shard by label, above the arm selection |

`ShardResult` gained `attestation` and `quorum`; `JobResult` gained `attestation`. `degraded`
widened to cover a verification shortfall and its doc was corrected rather than stretched.

**`packages/core/src/job/submit.test.ts`** — 43 cases became 61. Ten for the receipt, eight for
the gate. Every one signs its fixtures directly through `result-attestation.ts` against a real
`EnrollmentAuthority`, because nothing in production signs at this wave.

**`packages/net/src/reduce-job.test.ts`** — five literals, the whole of the type fan-out.

**`.planning/REQUIREMENTS.md`** — six rows rewrote their **reason** and not one moved its
**verdict**. See *The ledger* below.

## The four questions a certificate has to answer

Stated because three of them look redundant and none is:

1. **Does this requestor hold a certificate for that node?** The anchor is the descriptor's own
   `certificate`, not a `trustedIssuers` argument on `submitJob` — that decision was already made
   and already applied at `discoverCandidates`, and a second copy of it could disagree with the
   first with nothing able to catch the disagreement.
2. **Did the executor sign anything?** `'signed-by-nobody'` is a truthful statement, not a
   signature that failed.
3. **Is the certificate presented the one the node was discovered under?** Compared on `nodeKey`,
   so a node that re-enrolled between discovery and execution is accepted rather than refused for
   having renewed. A case asserts exactly that.
4. **Does the signature check out over this task and this `resultCid`?**

Anything else is the named absence, with the reason and the counts.

## Deviations from the plan — three, each measured

### 1. The issuer half of check 3 could not fire, so it is not written

The plan asks for the attestation's certificate to name *"the same `nodeKey` and the same
`issuer`"* as the descriptor's. The `nodeKey` half is implemented as written. The `issuer` half is
**carried by the pinned set** handed to `verifyResultAttestation` — `new Set([descriptor.certificate.issuer])`
— which refuses a certificate from any other provider by name as `untrusted-issuer`.

An `issuer !== issuer` comparison beside that set is a branch nothing can reach. This repository
has twice recorded what such a check costs: it reads as a guarantee while guarding nothing, and
`quorum.ts`'s own header retracts a rule-ordering for exactly that reason. The argument is written
at the site, including the change that would make a comparison live again — widening the set.

### 2. The named absence is a record, not a bare literal

The plan's behaviour clause says *"a named absence literal"* and then, two paragraphs later, that
a partial verification carries *"the named absence as well, with the reason and the counts"*. A
literal cannot carry either. The absence is therefore an interface whose discriminant is the
literal `'holds-no-verified-attestation'`; a sibling `reason` field on `ShardResult` was rejected
as the second-source-of-truth shape this phase keeps refusing.

### 3. The offer arm groups by pool — a tension the plan does not name

*"Add the gate in the placement pass, per shard, before the arm is selected, so both arms receive
the same narrowed pool."* The no-offer arm takes a per-shard pool trivially. The offer arm cannot:
`planWithOffers` takes **one** pool for a whole job, and its cross-shard headroom tally — the
bound `18-04` measured and `submit.test.ts` pins with *"a 1-slot node takes one shard, not four"* —
lives inside a single call. One call per shard would lose that bound entirely.

There are at most **two** distinct pools in any job, because composition is decided on the
job-level candidate set and so gives the same answer for every public shard: the quorum's members,
and the full candidate set every sovereign or degraded shard keeps. So requests are grouped by the
array they were handed and each group makes one call. **With one pool this is the single call it
replaces, in shard order.** With two, headroom is tallied within each group and not across them —
recorded at the branch rather than found later.

## Mutation readings — twelve planted, twelve observed

Every one restored by `cp` + `cmp` (all `cmp` exits 0); `submit.ts` is byte-identical to its
committed state and `git status --porcelain` on it is empty.

| # | mutation | predicted | **observed** |
|---|---|---|---|
| 1 | `attestationReceipt(verified)` → spread with `strength: 'owner-attested'` | the other two strengths redden | **8 failed / 53 passed.** `owner-domain`, `independent`, the agreeing-set case, the weakest-shard case and four gate cases go red; the `owner-attested` case stays green |
| 2 | drop the `verifyResultAttestation` call, push `replica.attestation.certificate` | the shard reads `independent` | **2 failed / 59 passed.** `expected { strength: 'independent', …(5) } to match object { …(3) }` — the receipt is once again the submitter's word about itself |
| 3 | delete the `nodeKey` comparison | counts an operator nobody placed with | **1 failed / 60 passed.** `operators: ['op-a', 'op-elsewhere']` — `op-elsewhere` is a certificate this requestor never placed anything with |
| 4 | build from `placement.nodeIds` via a descriptor lookup | `replicas` reads 3 | **6 failed / 55 passed.** `- "replicas": 2` / `+ "replicas": 3`, exactly as predicted |
| 5 | let the absence fall through to `attestationReceipt(verified)` | an unsigned job reads `owner-attested` | **5 failed / 56 passed.** `"description": "owner-attested — computed once by the data owner and not independently verified"`, `"replicas": 0` |
| 6 | `<` → `>` in `jobAttestationOf` | the job reads its strongest | **1 failed / 60 passed.** `- owner-attested` / `+ independent`. This also covers *"or the first"*: the fixture's shard 0 is the `independent` one, so both wrong rules produce this same reading |
| 7 | `refusal:` always `null` — the dial ignored, always degrade | case 3 completes | **1 failed / 60 passed.** `expected "insufficient"`, `received "agreed"` — a caller that said a weaker answer is useless to it gets one anyway |
| 8 | `degraded: true`, `refusal: composition.reason` — always refuse | case 2 fails | **2 failed / 59 passed.** `expected "agreed"`, `received "insufficient"` — both degrade cases die, which is the pre-ruling behaviour the owner ruled against |
| 9 | `composition` forced to `null` — the gate deleted | the shared-relay members place and report `independent` | **5 failed / 56 passed.** The shared-relay shard places, `degraded` reads `false` instead of `true`, and `quorum` reads `not-attempted` instead of `not-composed`. See the note below |
| 10 | `label !== 'public'` made unsatisfiable — a sovereign shard reaches the composer | refused with `insufficient-operators` | **2 failed / 59 passed.** `expected "agreed"`, `received "insufficient"` — criterion 2 becomes unreachable, which is the single most likely way to get this plan wrong |
| 11 | take the strength from `QuorumResult.strength` | reports `independent` on the strength of who was asked | **4 failed / 57 passed.** `+ "description": "from the quorum"`, `+ operators: ['op-b','op-a']` against an expected named absence |
| 12 | blank the composer's `reason` on a degraded shard | the caller cannot tell an over-concentrated fabric from any other degradation | **2 failed / 59 passed.** Both degrade cases go red on the reason string alone; the `owner-domain` label is still correct in both |

### Where a prediction and a reading differ, stated rather than smoothed

**Mutation 9.** The plan says deleting the gate makes case 4 *"place and report `independent`,
which is VER-03 unmet and reading green"*. The first half held exactly — the shared-relay members
place and the receipt reads `independent`. The second half did not: the case does **not** read
green, because it asserts `degraded` and `quorum` beside the receipt. The plan's sentence describes
a case that asserted only the strength; this one asserts three things and catches the deletion on
two of them.

**Mutation 4.** The plan's prediction — *"`replicas` reads 3 and the assertion names the node that
attested nothing"* — is only reachable with the *lookup* form of the defect, which is what was
planted: `attestationReceipt` over the certificates of `placement.nodeIds`. The weaker form
(passing the placed ids through `receiptFor`) reddens too, but for a different reason: an
unaccounted replica produces the named absence, so no `replicas` figure is reported at all. The
stronger plant is the one recorded, because it is the artifact this phase exists to replace.

## The fan-out, built twice and reconciled

19-CONTEXT's standing correction — *`tsc` finds construction sites, not reader sites* — was applied,
and so was 19-18's opposite finding, that grep over-reaches.

| instrument | result |
|---|---|
| `tsc --noEmit` | **5 sites in 1 file** — `packages/net/src/reduce-job.test.ts`, three for `attestation` and two for `quorum` |
| grep `ShardResult\|JobResult` | 20 lines across 15 files |

The 15 grep files minus the 1 constructor file are all safe, and each was read rather than assumed:

- **`packages/aot/src/admission.test.ts`** — the one genuine reader hazard, and it is safe.
  `observe(job)` is a **hand-written projection** into an `Observed` type, so
  `expect(observe(a)).toEqual(observe(b))` at `:257` does not see the new fields. Had `observe`
  spread `...job`, this file would have gone red at runtime with `tsc` at exit 0 — the 19-13 shape
  exactly.
- **`packages/demo/src/job.ts`** — `answerOf(results: readonly ShardResult[])` takes the array and
  reads `verification`.
- **`pi-reduce`, `primes-reduce`, `tree-reduce-agents`, `submit-with-egress.ts`, `bin/bench.ts`,
  `tab-api.ts`, the two barrels** — return types, forwarded types, and prose.

A separate grep for whole-object comparisons — `toEqual(job`, `toStrictEqual(job`,
`Object.keys(`, `JSON.stringify(job`, `toMatchSnapshot` — returns the `observe` line above and
nothing else. `toEqual(shards)` at `admission.test.ts:253` compares guest **outputs**, not shard
results. The guard was run and found one thing worth reading; that is different from not running it.

## The ledger — six reasons rewritten, no verdict moved

`requirements-ledger.node.test.ts` fired twice during this plan, exactly as the brief predicted,
and both times on the commit rather than after it:

- after Task 1: `VER-08`, `VER-09`, `VER-10` and **`AUTH-05`** — all four claimed
  `attestationReceipt` had no production caller. `AUTH-05` was not in the brief's list and was
  found by the guard.
- after Task 2: `VER-03` and `VER-04`, which claimed the same of `composeQuorum`.

**Every one keeps a checkable claim, so `WITHOUT_A_CHECKABLE_CLAIM` was not touched and no guard
was widened.** Two shapes carry them:

- **VER-08 / VER-09 / VER-10 / AUTH-05** now name **`attestResults`**, which genuinely has no
  production caller — measured, not assumed: its only appearances outside its own module are two
  specs, one barrel and three comments, and the guard strips comments and excludes barrels. That
  is also the honest open half: no node in this repository signs a result yet, so every receipt a
  real node produces today reads the named absence. Plan 19-15 closes it.
- **VER-03 / VER-04** now use the *reachable only through* shape: **`composeQuorum` is reachable
  only through `submitJob`**, which is true, meaningful, and breaks the day a second entry point
  composes a quorum.

VER-03 also records the half that is **deliberately unimplemented** — the durability anchor the
2026-08-03 ruling named — and both rows record the condition that keeps the gate off every default
path: no production submitter but `bin/bench.ts --discover` (off by default) supplies certificated
descriptors. Verified at `bin/bench.ts:674` and `:727`, `perf-workload.ts:359`, and
`demo/main.ts:459` and `:707`.

## What the plan got wrong, or left out

1. **The `issuer` comparison it asks for cannot fire.** Deviation 1 above.
2. **A "named absence literal" cannot carry a reason and counts.** Deviation 2 above.
3. **The offer arm's single-pool constraint is not mentioned.** Deviation 3 above.
4. **It predicted `degraded` assertions would move and asked for each to be named. None moved.**
   Every pre-existing fixture in the tree builds descriptors through `publicNodes`, which states
   `carries-no-certificate`, so the gate's third condition fails and no quorum is ever attempted on
   any of them. All 43 pre-existing `submit.test.ts` cases pass unedited, and so do the four other
   suites that assert on `degraded` or build certificated descriptors (`sovereignty.test.ts`,
   `placement.test.ts`, `sovereign-offers.test.ts`, `net/src/discovery.test.ts`,
   `net/src/sovereign-execution.test.ts`).
5. **`AUTH-05` is missing from its ledger list.** The plan names VER-03/04/08/09/10; `AUTH-05` also
   claimed `attestationReceipt` had no caller and was found by the guard, not by the plan.
6. **It points at `reduce.ts:280-287` for the split between the map receipt and the aggregate's.**
   19-16 rewrote that file by 104 lines in the same session, so the doc points at the module's
   header rather than at a line number.
7. **`bin/bench.ts` runs `redundancy: 2` on its `--discover` rig** (`:1042`), so the gate is
   reachable there today, on the degrade arm 19-18 chose. The plan does not say so and 19-10 will
   meet it.

## Verification — commands and real exit codes

Every exit code below was read with `EXIT=$?` on the line immediately after the command, never
through a pipe.

| command | exit |
|---|---|
| `npx vitest run --project node packages/core/src/job/submit.test.ts` (Task 1 RED gate) | **1** — 10 failed / 43 passed |
| `npx vitest run --project node packages/core/src/job/submit.test.ts` (Task 2 RED gate) | **1** — 8 failed / 53 passed |
| `npx tsc --noEmit` | **0** |
| `npx vitest run --project node` over `submit.test.ts quorum.test.ts result-attestation.test.ts sovereignty.test.ts placement.test.ts net/src/distributed.test.ts` | **0** — 6 files, 179 tests |
| `npx vitest run --project node` over `mutation-guard requirements-ledger vocabulary acceptance-traceability` | **0** — 4 files, 153 tests |
| `npx vitest run --project node` over `submit-with-egress.test.ts demo/src/kernel.test.ts job/verify.test.ts` | **0** — 50 tests |
| `npx vitest run --project node` over `net/src/discovery.test.ts sovereign-execution.test.ts core/src/sovereign-offers.test.ts discover-candidates.test.ts` | **0** — 34 tests |
| `npx vitest run --project node packages/net/src/reduce-job.test.ts` | **0** — 9 tests |

**`tsc` was red for most of this session for a reason that was not mine, and the attribution was
measured rather than assumed.** The concurrent 19-16 executor added a required `attest` hook to
`AgentOptions` and was mid-fan-out; its errors were counted separately at every step
(`grep -c "Property 'attest' is missing"` — 48, then 2, then 0) and my own worklist read by
excluding them. The final `tsc --noEmit` is exit 0 with both plans landed.

**One failure was inherited and is now gone.** `reduce-job.test.ts`'s *"produces a root CID
bit-identical to a single-process reference"* failed after 19-16's first commit. Attributed rather
than argued: `git show HEAD:packages/net/src/reduce-job.test.ts` was written over my edited copy,
run (**exit 1, same case**), and restored by `cp` + `cmp` (exit 0) — so the failure predated my
edit. 19-16's next commit fixed it and the file is now 9/9.

## Unverifiable under load, or not attempted

- **`distributed.test.ts`'s shards reading the named absence** is reasoned, not asserted there.
  The plan says they *"should read the named absence"*; that file carries no assertion on the new
  field and this plan does not own it. The two paths that produce the absence — in-process
  executors reporting `'signed-by-nobody'`, and `publicNodes` descriptors carrying no certificate —
  are each pinned by a unit case in `submit.test.ts`. The file passes 25/25 either way.
- **No full `npx vitest run --project node` was taken.** The brief scopes runs to the files the
  plan names, on a host at ~7.5 load with a second executor running. Everything above is a
  project-scoped run of a named file. No timing was measured and no timeout was tuned.
- **Nothing was unresolved under load.** No run in this session timed out or needed a re-run.

## A hazard worth recording for the next executor on a shared tree

Mid-session, `packages/core/src/job/submit.ts` was **reverted to `HEAD` underneath an in-progress
edit** — six applied edits vanished and only the seventh survived, detected because `git diff HEAD
--stat` read *19 insertions* where it should have read ~290. The Edit tool's *"the file had been
modified on disk since you last read it"* notice was the only warning. Nothing in this plan caused
it; the concurrent executor was committing at that moment.

The recovery that worked, and the habit that makes it cheap: after every group of edits, run
`git diff HEAD --stat` and check the shape of the number, then `git add` the file immediately —
staging puts the content in the object store, where a working-tree revert cannot reach it. A
`cp` to `/tmp` beside it costs nothing and is what turned a re-do into a re-apply.

## Self-Check: PASSED

- `packages/core/src/job/submit.ts` — FOUND, byte-identical to its committed state after twelve
  mutations (`git status --porcelain` empty for that path)
- `packages/core/src/job/submit.test.ts` — FOUND, 61 cases
- `packages/net/src/reduce-job.test.ts` — FOUND, 5 literals updated
- `.planning/REQUIREMENTS.md` — FOUND, 6 rows rewritten, 0 verdicts moved
- commit `4174e30` — FOUND (`test(19-06)`, Task 1 RED)
- commit `c8a132d` — FOUND (`feat(19-06)`, Task 1)
- commit `818989e` — FOUND (`test(19-06)`, Task 2 RED)
- commit `b80d2ab` — FOUND (`feat(19-06)`, Task 2)

## TDD Gate Compliance

Both tasks ran RED → GREEN with the gates in the git log: `test(19-06)` at `4174e30` (10 failing
cases observed, exit 1) before `feat(19-06)` at `c8a132d`, and `test(19-06)` at `818989e` (8
failing cases observed, exit 1) before `feat(19-06)` at `b80d2ab`. No REFACTOR commit was needed
for either.
