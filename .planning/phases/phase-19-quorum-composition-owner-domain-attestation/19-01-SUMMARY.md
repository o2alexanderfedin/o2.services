---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 01
subsystem: discovery
tags: [discovery, enrollment, sovereignty, placement, certificates, replica-sets]

requires:
  - phase: phase-18-discovery-capacity-placement/18-05
    provides: "`discoverCandidates`, holding a `DiscoveredExecutor` per qualified node and discarding everything on its certificate but `userKey`"
  - phase: phase-17-node-identity-enrollment/17-01
    provides: "`NodeCertificate`, `verifyCertificate`, `resolveReplicaSets`"
provides:
  - "`NodeDescriptor.certificate` — a required union of `NodeCertificate | 'carries-no-certificate'`, so the three quorum symbols can be called on the path `submitJob` runs"
  - "`CandidateSet.replicaSets` — `resolveReplicaSets`'s first production caller since Phase 6"
  - "The measured fact that a rogue certificate is refused TWICE at this seam, so the plan's third proof observes `discoverExecutors` rather than `resolveReplicaSets`"
affects:
  - phase-19-quorum-composition-owner-domain-attestation/19-02
  - phase-19-quorum-composition-owner-domain-attestation/19-06
  - phase-19-quorum-composition-owner-domain-attestation/19-09
  - phase-19-quorum-composition-owner-domain-attestation/19-12

tech-stack:
  added: []
  patterns:
    - "A widened field is a required union with a named sentinel, never an optional — proved here by a mutation that leaves `tsc` at exit 0 while the reading goes red"
    - "The compiler is the worklist: a required field cannot compile without being written, so `tsc` enumerates every construction site and a reference search has to guess"
    - "A fact is grouped where it was verified, against the clock that verified it, rather than regrouped at a call site whose clock has moved"

key-files:
  created: []
  modified:
    - packages/core/src/sovereignty.ts
    - packages/net/src/discover-candidates.ts
    - packages/net/src/discover-candidates.test.ts
    - .planning/REQUIREMENTS.md
    - packages/core/src/coordinator.test.ts
    - packages/core/src/job/submit.test.ts
    - packages/core/src/placement.test.ts
    - packages/core/src/sovereign-offers.test.ts
    - packages/core/src/sovereignty.test.ts
    - packages/core/src/speculation.test.ts
    - packages/net/src/churn.test.ts
    - packages/net/src/discovery.test.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/net/src/submit-with-egress.test.ts
    - packages/node/src/egress-manifest.node.test.ts
    - packages/node/src/egress-refusal.node.test.ts
    - packages/node/src/named-refusal.node.test.ts
    - packages/node/src/sovereign-block-refusal.node.test.ts
    - packages/node/src/sovereignty-placement.node.test.ts

key-decisions:
  - "The absence literal is `'carries-no-certificate'` — a statement about what the descriptor holds, in the repository's existing sentinel voice, never about what the node is."
  - "`replicaSets` is computed over `found.executors`, the qualified set, using the `now()` the lookup already read — hoisted into a local so the two consultations cannot drift."
  - "AUTH-05's ledger row was corrected in the same commit that falsified it. The verdict is unchanged at `Built, not wired`; the reason now names the consuming half. 19-12 owns closing it."
  - "The two test helpers that stand in for `discoverCandidates` state the absence rather than being widened to carry a real certificate — widening them changes what those fixtures model, which is not this plan's."

patterns-established:
  - "When a plan's stated reddening does not redden, plant it anyway, record that it did not, and find the mutation that does — an assertion protected by an upstream refusal is not a proof of the downstream one"

requirements-completed: []

duration: not recorded — see Host conditions
completed: 2026-08-02
---

# Phase 19 Plan 01: The certificate discovery already held — Summary

**`NodeDescriptor` now carries the provider-signed certificate that qualified the node, as a
required union with a named absence, so `composeQuorum`, `attestationReceipt` and
`resolveReplicaSets` can for the first time be called on the path `submitJob` actually runs —
and `resolveReplicaSets` has a production caller for the first time since Phase 6.**

## Host conditions — read before believing any number here

**Load average was 220.41 / 178.53 / 117.39 on 8 cores** at the start of this plan (`uptime`,
23:16), against a foreign C++/LLVM build. Per the execution instruction:

- **No duration is recorded and no timeout was added or tuned.** The plan's frontmatter and
  every summary convention that asks for one is answered with this paragraph instead. Wall
  clocks observed here (6.6 s, 21.8 s, 48.9 s for the same three groups) are readings of the
  contention, not of the tree, and belong in no table.
- Only the specific files named below were run, always with `--project node`. The full suite
  was never run. `npm run test:node` was never run.
- **No test failed in a way that looked like a timeout or a flake**, so nothing here is
  reported as unresolved under load. Every failure recorded below is one this plan planted
  on purpose and then removed.
- `tsc --noEmit` is deterministic and is the load-bearing green reading of this plan.

## Commits

| Commit | Task | What |
|---|---|---|
| `0d37395` | 1 (RED) | the certificate discovery holds, asked for at the seam |
| `76ef3ba` | 1 (GREEN) | a descriptor carries its certificate, or names the absence |
| `21d496f` | 2 | every hand-built descriptor states its absence |

## Verification — every command, and the exit code read directly

Each exit code below was taken with `EXIT=$?` on the line immediately after the command, with
no pipe between them. The one RED reading marked *(no code read)* was taken through a pipe
before the discipline was applied and is reported as the runner's own summary line instead.

| Command | Exit | Reading |
|---|---|---|
| `npx vitest run --project node packages/net/src/discover-candidates.test.ts` (RED, pre-implementation) | *(no code read)* | **4 failed \| 5 passed (9)** — the 5 are the pre-existing cases, untouched |
| `npx vitest run --project node packages/net/src/discover-candidates.test.ts` (GREEN) | **0** | 1 file, **9 passed** |
| `npx tsc --noEmit` after Task 1 | **1** | **55 errors across 15 files** — Task 2's worklist |
| `npx tsc --noEmit` after Task 2 | **0** | no output |
| `npx vitest run --project node` × 12 in-process specs Task 2 touched | **0** | **12 files, 214 passed** |
| `npx vitest run --project node` × 4 node specs Task 2 touched | **0** | **4 files, 11 passed** |
| `npx vitest run --project node packages/node/src/sovereignty-placement.node.test.ts` | **0** | 1 file, **3 passed** |
| `npx tsc --noEmit` final, after every mutation was restored | **0** | no output |
| `npx vitest run --project node` × the plan's four load-bearing specs | **0** | **4 files, 74 passed** |

The last row is `discover-candidates.test.ts` (the seam), `enrollment.test.ts`,
`sovereign-execution.test.ts` and `submit.test.ts`, which is the plan's own
`<verification>` list.

The twelve in-process specs were `coordinator`, `job/submit`, `placement`, `sovereign-offers`,
`sovereignty`, `speculation`, `enrollment` (core), and `churn`, `discovery`,
`sovereign-execution`, `submit-with-egress`, `discover-candidates` (net). The four node specs
were `egress-manifest`, `egress-refusal`, `named-refusal`, `sovereign-block-refusal`;
`sovereignty-placement` was run alone because it is the single heaviest file in the set
(18.2 s on a quiet host per `vitest.config.ts`).

**The pre-commit hook ran the cheap guards on all three commits** — vocabulary, purity,
mutation-ledger, disclosure, ledgers — and reported **6 files, 156 passed** each time it
passed. It also refused one commit, which is the next section.

## The guard that refused a commit, and what it caught

The first attempt at `76ef3ba` was **refused**, and the refusal is a real reading rather than
a nuisance:

```
FAIL  packages/node/src/requirements-ledger.node.test.ts
      > has no row naming a symbol that has since acquired a production caller
AssertionError: expected [ Array(1) ] to deeply equal []
+   "AUTH-05: resolveReplicaSets is called by packages/net/src/discover-candidates.ts"
```

AUTH-05's traceability row read *"**Built, not wired** — resolveReplicaSets has no production
caller"*. That sentence became false at the exact commit that gave the symbol its first
production caller, and the guard widened on 2026-08-02 to read every row caught it on the same
run that introduced it — which is precisely the failure mode that file's own header says it
exists to prevent, working.

**Fix (Rule 3 — blocking).** The row's **verdict is unchanged** at `Built, not wired`, so no
header arithmetic moves (`UNCHECKED_SPLIT` and `MARKER_SPLIT` both still close). The reason
sentence now records what 19-01 landed and names the consuming half that is still open, with
`attestationReceipt has no production caller` as the checkable claim in its place — measured
true, and re-measured by the guard on the successful commit. The old sentence was
**paraphrased away rather than quoted and refuted**, because that file cannot tell an asserted
claim from a disowned one and says so in its own docblock.

**19-12 owns closing this row** (`19-12-PLAN.md:229` — *"AUTH-05 — closed if 19-01 and 19-09
landed"*). This edit is the minimum that keeps the tree honest between now and then, not a
pre-emption of it.

## Every mutation, planted and watched

Nothing below is restated from the plan. Each row was written into the source, run, and
restored by `cp` from a copy taken before any mutation, verified by `cmp` returning exit 0 and
`git status --porcelain` returning empty. **`git checkout --` was never used, `git add -A` was
never used, and no branch was switched.**

| # | Mutation | Where | Reading observed | Held |
|---|---|---|---|---|
| 1 | `certificate: executor.certificate` → an object rebuilt from the seven fields a reader could reconstruct | `net/discover-candidates.ts` | exit **1**, **1 failed \| 8 passed**; the diff names `- issuer` and `- signature` by value | ✅ |
| 2 | field made optional **and** omitted from `publicNodes` (two hunks, one file) | `core/sovereignty.ts` | `tsc` exit **0** · vitest exit **1**, **1 failed \| 8 passed**: `expected [ undefined, undefined ] to strictly equal [ 'carries-no-certificate', …(1) ]` | ✅ |
| 3a | `options.trustedIssuers` → `new Set()` at the `resolveReplicaSets` call | `net/discover-candidates.ts` | exit **1**, **2 failed \| 7 passed**, both replica-set cases: `expected [] to have a length of 1` | ✅ |
| 3b | the `verifyCertificate` guard **deleted from `resolveReplicaSets` itself** | `core/enrollment.ts` | exit **1**, **1 failed \| 26 passed** — the failure is `enrollment.test.ts:322`, and `discover-candidates.test.ts` stayed **green** | ❌ **see below** |

### Mutation 1, in full — the reading the plan predicted, confirmed

```
AssertionError: expected { …(7) } to strictly equal { …(9) }
  {
    "discoverability": "seed",
    "expiresAt": 1802592000000,
    "issuedAt": 1800000000000,
-   "issuer": "5526f742941711b3bc530ba44ff6f6dab0f0ab71af832f41a7fe3b9fdaed9c60",
    "nodeKey": "ee93a4f66f8d16b819bb9beb9ffccdfcdc1412e87fee6a324c2a99a1e0e67148",
    "operatorId": "op-0",
    "relayIds": [],
-   "signature": "35477f6bf5b4483234e232b0d3474068add9c5d10739cb431785c0e0e02a4f9c0908f0331b843543843bdc3e83f6770235ee28b1afd71f73c30d3eee64925906",
    "userKey": "70df9e2279adbec6d12bf2921184c9222eb24ed852005bf640139f52e59cd9ae",
  }
```

Seven fields against nine. The two missing ones are `issuer` and `signature` — the whole of
what makes a certificate checkable by somebody who was not present — and the assertion names
them without being told to.

### Mutation 2, verbatim, for Plan 19-12's ledger

The plan asks for the `find`/`replace` pair to be recorded verbatim. **It is two hunks, not
one**, because `tsc` staying at exit 0 requires both: making the field optional alone leaves
`publicNodes` writing it and the assertion green, and omitting the write alone is a compile
error. Both hunks are in **one file**, `packages/core/src/sovereignty.ts`, and each was
verified to occur exactly once before being planted.

Hunk A:
```
find:    "  readonly certificate: NodeCertificate | 'carries-no-certificate'"
replace: "  readonly certificate?: NodeCertificate | 'carries-no-certificate'"
```

Hunk B:
```
find:    "    load: 0,\n    certificate: 'carries-no-certificate',\n  }))"
replace: "    load: 0,\n  }))"
```

- `caughtBy`: `packages/net/src/discover-candidates.test.ts`
- `signature`: `states the absence where there is no certificate to carry, rather than omitting it`
- `signatureSource`: `test-title`
- `project`: `node`

**A `Mutation` entry holds one `find`/`replace` pair**, so encoding this needs either two
entries applied together or one entry whose find text spans both hunks — and the two hunks are
not contiguous. That is 19-12's call, and it is flagged here rather than left to be discovered
at encoding time.

### Mutation 3b — the plan's third proof does not redden, and this is the finding

**The plan says the "cannot be inflated" assertion is *"reddened by grouping before verifying,
which is the tempting simplification"*. It is not.** Planted — the `verifyCertificate` guard
deleted from `resolveReplicaSets` itself, which is that simplification in its strongest form —
`discover-candidates.test.ts` stayed **green** and the only file that moved was
`enrollment.test.ts`.

The reason is structural and was measured rather than argued. `discoverCandidates` passes
`resolveReplicaSets` the certificates of `found.executors`, and `discoverExecutors` has
**already** run `verifyCertificate` over every one of them against the *same* `trustedIssuers`
and the *same* `now` (`core/discovery.ts:264-268`). A rogue certificate is therefore refused
**twice** at this seam, and the second refusal is unobservable from outside because the first
one already removed its subject. `Exclusion` carries no certificate
(`core/discovery.ts:189-193`), so a widening mutation cannot reach the excluded one either —
after `discoverExecutors` returns, that certificate is not in scope anywhere in the file.

**This is exactly the class of defect the execution instruction named** — Phase 18's finding
was an assertion that could not fail — so it is reported rather than papered over:

- The assertion *"the untrusted issuer's node is absent from that user's `certificates`"* is
  kept, is true, and is worth having. But what it observes is **`discoverExecutors`'s**
  refusal, not `resolveReplicaSets`'s.
- `resolveReplicaSets`'s own guarantee is observed one layer down, at
  `packages/core/src/enrollment.test.ts:322` — *"will not let an unverifiable certificate
  inflate a replica count"* — which mutation 3b turns red: `expected [ { …(9) }, { …(9) } ] to
  have a length of 1 but got 2`.
- **Mutation 3a is the reading that genuinely fails at the seam.** Replacing
  `options.trustedIssuers` with `new Set()` at the `resolveReplicaSets` call takes both
  replica-set cases down. That is the load-bearing property `discoverCandidates` itself owns:
  the pinned issuers, and the clock, reach the grouping. It is not in the plan's proof list
  and was added because the plan's third entry could not carry the weight alone.

## What changed

### `packages/core/src/sovereignty.ts`

One `import type { NodeCertificate } from './enrollment.ts'`, one required field, and a
corrected module-comment claim.

The header used to call this a zero-import pure module. The import is type-only and erases at
build time, so the **purity** claim survives and the **zero-import** phrasing does not — the
comment now says which of the two it meant, and records why the certificate belongs on the
descriptor rather than in a parallel map keyed on `nodeId`: a second source of truth about the
same node that nothing in this repository could catch disagreeing, with one of them consulted
for placement and the other for verification.

`enrollment.ts` does not import `sovereignty.ts`, so the direction is one-way and adds no
cycle. Verified by `tsc` exit 0.

The field:

```ts
readonly certificate: NodeCertificate | 'carries-no-certificate'
```

Its doc states the three things the plan asks for: that `operatorId` is the unit of quorum
diversity and `discoverability` is what makes a member backbone-anchored, so this one field is
what carries VER-03, VER-04 and VER-08…VER-10 onto the dispatch path; that the literal is a
statement rather than a default; and that a descriptor carrying it names **a perfectly
ordinary node** — every node in this fabric has equal functionality, and what the literal
reports is that *this requestor* holds no signed statement about it, which is a fact about the
requestor's knowledge and changes the moment it learns one.

`publicNodes` writes the literal, and its doc distinguishes that field from the two beside it:
`ownerId` and `canExecuteSovereign` are placeholders there, and `certificate` is not — it is
the honest answer, because that function builds descriptors from anything carrying a `nodeId`.

**On the name.** `certificate` is the field; `'carries-no-certificate'` names what the
descriptor lacks. It is in the voice of the sentinels already in the tree
(`'holds-no-records'`, `'keeps-no-ledger'`, `'issues-no-certificates'`), and its subject is the
**descriptor**, not the node — which is the whole of what keeps it from reading as a node tier.

### `packages/net/src/discover-candidates.ts`

The discard is gone. The loop already held the whole `DiscoveredExecutor`; it now passes
`executor.certificate` through **unaltered** rather than reading one field off it. The comment
that used to explain why `ownerId` is `certificate.userKey` is kept and extended: the fields it
had to summarise are now readable directly, and rebuilding the object here would drop `issuer`
and `signature`.

`CandidateSet.replicaSets` is new, filled from `resolveReplicaSets` over
`found.executors.map((e) => e.certificate)`. `options.now()` is now read **once** into a local
and passed to both `discoverExecutors` and `resolveReplicaSets`, so the two consultations
cannot drift apart — previously it was called inline at the single call site, and adding a
second inline call would have introduced exactly the clock skew the field's doc warns about.

The sovereign-seam paragraph now points at **Plan 19-09** rather than at "AUTH-05 / Phase 19"
in general, and records that the naming half is discharged: a reader can now see both
spellings of the same node — the opaque `ownerId` and the certificate's `userKey` — side by
side on one object, instead of inferring one from the other.

### The fan-out, and the count the next planner needs

**15 files, 55 literals.** The plan predicted 13 files and said plainly that the list was a
prediction rather than a specification.

- **All 13 predicted files were named by `tsc` and were edited.**
- **Two were not predicted**: `packages/node/src/egress-refusal.node.test.ts` (2 literals) and
  `packages/node/src/sovereign-block-refusal.node.test.ts` (1 literal).
- Distribution: `job/submit.test.ts` 23 · `sovereignty-placement.node.test.ts` 6 ·
  `sovereign-offers.test.ts` 5 · `egress-manifest.node.test.ts` 4 · `speculation.test.ts` 3 ·
  `sovereignty.test.ts` 3 · `placement.test.ts` 3 · `egress-refusal.node.test.ts` 2 ·
  `submit-with-egress.test.ts` 2 · `sovereign-execution.test.ts` 2 · `churn.test.ts` 2 ·
  `discovery.test.ts` 1 · `coordinator.test.ts` 1 · `named-refusal.node.test.ts` 1 ·
  `sovereign-block-refusal.node.test.ts` 1.

**15 vs 13 is not a material overrun** — the estimate holds. The worklist came from `tsc`
alone; no grep was used to find a site, for the reason the plan gives, and the two unpredicted
files are the evidence that it mattered.

No repository-wide `sed` was run. Where a file held several literals of one shape, the
substitution was scripted **per file**, anchored on `canExecuteSovereign: … , load: …` (a
pattern no other literal in this repository has), with the match count printed and checked
before writing. The `submit.test.ts` diff was then audited line by line: **23 insertions, 22
deletions, and zero added lines that are not the new field.**

No test changed meaning. Several one-line literals were expanded across lines where the
addition made them long; the field values either side are identical.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — blocking] AUTH-05's traceability row went false at the commit that landed the
feature, and the pre-commit guard refused the commit**

- **Found during:** Task 1, at commit time.
- **Issue:** the row claimed `resolveReplicaSets` has no production caller; this plan gave it
  one. Measured, not predicted — the refusal output is quoted above.
- **Fix:** the reason sentence rewritten; the verdict deliberately unchanged so no header
  arithmetic moves; the replacement claim (`attestationReceipt has no production caller`)
  re-measured by the same guard on the passing run.
- **Files:** `.planning/REQUIREMENTS.md`
- **Commit:** `76ef3ba`

### Departures from the plan's letter, each with its reason

**2. The plan's third proof was planted and did not redden.** Full analysis above. The
assertion is kept because it is true and cheap; the reading that can fail was added
(mutation 3a); and the layer where `resolveReplicaSets`'s own guarantee *is* observable was
identified and measured (`enrollment.test.ts:322`). Recording an assertion as proved by a
mutation that leaves it green would have been Phase 18's defect repeated.

**3. One extra case beyond the plan's proof list.** *"does not call one node under an owner
owner-domain redundancy"* — a one-node fabric, so `canVerifyWithinOwnerDomain` comes back
`false`. Without it, the `true` in the replica-set case is satisfiable by a hardcoded constant,
which is the shape this repository's own fixtures reject elsewhere (`reads the sovereign pair
off the record rather than assuming either constant`, same file). It is also what mutation 3a
takes down alongside the positive case, so it is not decoration.

**4. `publicNodes`'s absence assertion lives in `packages/net/src/discover-candidates.test.ts`,
not in `sovereignty.test.ts`.** The plan's Task 1 `<files>` names only three files and this is
one of them. It is also the better home: the two producers of a `NodeDescriptor` in this
repository are `discoverCandidates` and `publicNodes`, and this is the one file where both
halves of the new field — the certificate carried and the absence written — can be read next
to each other.

**5. `options.now()` hoisted into a local.** Not asked for. Required by *"using the same
`trustedIssuers` and `now()` the lookup used"*: the value was previously read inline at the
only call site, and a second inline read is a second clock.

## Findings the next plans need

**1. Two test helpers stand in for `discoverCandidates` and now state an absence they could
close.** `packages/net/src/discovery.test.ts:179` and
`packages/net/src/sovereign-execution.test.ts:261` build descriptors from discovery answers,
and `sovereign-execution.test.ts` in particular already has real certificates in reach —
`fabric.certificates` is passed to `resolveReplicaSets` at its line 279. Both write
`'carries-no-certificate'`, because their **own parameter types** carry a node key and a user
key rather than a certificate, and widening them changes what those fixtures model. 19-CONTEXT
calls `sovereign-execution.test.ts` *"the closest existing prototype of criteria 2 and 3"*, so
**the plan that gives the field a reader (19-06, and 19-09 for the owner-id unification) should
expect to widen that helper**, and should treat this as the reason rather than rediscovering it.

**2. `discoverCandidates` is still behind a flag.** `bin/bench.ts:680`, inside `if (DISCOVER)`,
off by default, is its only production caller — unchanged by this plan and already recorded
against NET-06. So `replicaSets` is *produced in production code* and *not produced on any
default run*. The distinction matters for 19-12's ledger wording.

**3. Nothing reads `NodeDescriptor.certificate` yet.** Deliberate, and the plan's own
`Out of scope`. `composeQuorum`'s anchor rule is 19-02's and `submitJob`'s use of the
certificate is 19-06's. Stated here so a verifier does not read the field's existence as its
wiring.

## Anything the plan got wrong

Three items, and one of them is substantive.

| Plan says | Measured | Weight |
|---|---|---|
| The inflation proof is *"reddened by grouping before verifying"* | It is not — `discover-candidates.test.ts` stays green under that exact mutation, because `discoverExecutors` refused the certificate first | **Substantive.** Analysed in full above |
| *"Reddened by building a fresh object from **the four fields the old code kept**"* | The old code kept **one** field, `certificate.userKey` (`discover-candidates.ts:177`, pre-edit). The four are `NodeDescriptor`'s own. The mutation was planted in the spirit of the sentence — a rebuild from everything a reader could reconstruct — and the predicted reading (`signature` and `issuer` absent, named by the assertion) is exactly what came back | Wording only |
| Thirteen files predicted for Task 2 | Fifteen | Immaterial; the plan said it was a prediction |

Every other `file:line` citation in the plan was re-read against source before being relied on
and was correct: `sovereignty.ts:38-55` (`NodeDescriptor`, verbatim), `:23` (the pure-module
claim), `enrollment.ts:104-123` (`NodeCertificate`, verbatim), `:390-425` (`ReplicaSet` and
`resolveReplicaSets`, including that it re-verifies internally), `discovery.ts:195-199`
(`DiscoveredExecutor`), `discover-candidates.ts:140-189` (`discoverCandidates`), `:161-186`
(the discard), `:168-185` (the descriptor literal), `:174-180` (the `ownerId` comment),
`:46-58` (the sovereign-seam paragraph), `:1-67` (the module doc). The claim that
`enrollment.ts` does not import `sovereignty.ts` is correct, and `tsc` exit 0 confirms no cycle.

## Known stubs

None. `certificate` holds the object the provider actually signed, passed through a real
`EnrollmentAuthority` and a real `verifyCertificate`; `replicaSets` is the output of the
production `resolveReplicaSets` over those same certificates. There is no placeholder value,
no hardcoded empty collection reaching a UI, and no component wired to mock data.

The one deliberate absence — **nothing reads the new field yet** — is the plan's own boundary
and is recorded under *Findings* rather than here, because the plan states which later plans
close it.

## Threat flags

None. No new wire frame, no new request kind, no new network endpoint, no new auth path, no
file access pattern and no schema at a trust boundary. Nothing about eligibility, sovereignty
or placement changed: `eligibleNodes` was not touched, and no branch anywhere reads the new
field.

The one security-relevant change is in the **restricting** direction and is a second refusal
rather than a first: `replicaSets` re-verifies certificates that `discoverExecutors` had
already verified. That redundancy is measured, is the subject of mutation 3b above, and is
kept rather than optimised away because `resolveReplicaSets`'s guarantee is its own to make.

## Self-Check: PASSED

Files claimed modified, listed off disk:

```
FOUND  packages/core/src/sovereignty.ts               242 lines
FOUND  packages/net/src/discover-candidates.ts        232 lines
FOUND  packages/net/src/discover-candidates.test.ts   433 lines
FOUND  .planning/REQUIREMENTS.md                      679 lines
```

The plan's `must_haves.artifacts` requires `packages/core/src/sovereignty.ts` to contain
`NodeCertificate` — present, in the type-only import and in the field's union — and
`packages/net/src/discover-candidates.ts` to provide the certificate carried through plus
`CandidateSet.replicaSets` — both present. `must_haves.key_links` requires
`discover-candidates.ts` to reach `enrollment.ts` via the pattern `resolveReplicaSets` —
present, imported from `@o2/core` and called over the qualified certificates.

Commits claimed, found in `git log --oneline`:

```
FOUND  21d496f  test(19-01): every hand-built descriptor states its absence
FOUND  76ef3ba  feat(19-01): a descriptor carries its certificate, or names the absence
FOUND  0d37395  test(19-01): the certificate discovery holds, asked for at the seam
```

No commit in this plan deleted a tracked file. Nothing was staged with `git add -A`; every path
was staged explicitly, and `git status --porcelain` was read before each commit. All three
mutated files were restored by `cp` and verified by `cmp` exit 0, with `git status --porcelain`
empty after each restore. `.planning/STATE.md` was not touched and no criterion text in
`.planning/ROADMAP.md` was amended.
