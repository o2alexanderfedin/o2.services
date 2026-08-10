---
phase: 25-x509-certificate-profile
plan: 2
subsystem: core
tags: [x509, der, asn1, decoder, certificate-profile, requirements-ledger]

requires:
  - phase: 25-x509-certificate-profile (25-01)
    provides: DerNode/X509Failure type contracts, the 12(->15)-tag bounded DER decode/encode
      engine, preParseCheck (X509-04), checkDerCanonical (X509-03 mechanism)
provides:
  - decodeX509Certificate — the full profile: TBSCertificate assembly, RFC 5280
    structural refusals, algorithm allow-list, extension rules, canonicalisation gate
  - describeX509Failure — exhaustive human-readable mapper over all 12 X509Failure kinds
  - X509-01..07 requirement family minted in .planning/REQUIREMENTS.md, traced honestly
    (six "Built, not wired", one "Done" citing pre-existing evidence)
  - acceptance-traceability.node.test.ts's ledger-row parsers widened so ids with a
    digit in the prefix (X509-0N) are structurally visible to the checker
affects: [Phase 25 Plan 3 (bundle-cost measurement), any future plan wiring the decoder
  into enrollment/issuance/discovery]

tech-stack:
  added: []
  patterns:
    - "algorithm allow-list of one, checked at all three AlgorithmIdentifier positions
      (TBS-inner, SPKI, outer signatureAlgorithm) via one shared checkAlgorithm helper
      — every banned algorithm refuses by the same mechanism, no per-OID branch"
    - "extension rules ordered count -> duplicate -> size -> membership -> payload,
      each check cheaper than the one after it"
    - "canonicalisation as the LAST gate, after every semantic check, so a malformed
      input still gets its specific refusal rather than collapsing into
      non-canonical-encoding"
    - "two-sided numeric bounds proved at the mechanism level when the domain's own
      closed registry cannot construct a fully-valid boundary case (MAX_EXTENSION_COUNT/
      MAX_EXTENSION_BYTES against a 4-member extension registry)"
    - "ALLOWED_TAGS deliberately over-admits two tag classes (context [1]/[2], NULL) so
      a low-level decoder failure can be promoted to a specific, named X509Failure kind
      one layer up in semantic assembly, instead of a generic malformed-der"

key-files:
  created: []
  modified:
    - packages/core/src/x509.ts (410 -> 965 lines: TBSCertificate assembly, algorithm
      allow-list, extension rules, canonicalisation wiring)
    - packages/core/src/x509.test.ts (239 -> 792 lines: 23 new tests across all three
      tasks, plus a DerNode-based certificate fixture builder and a
      non-canonicalising encodeDerRaw sibling of x509.ts's own encodeDer)
    - packages/core/src/index.ts (barrel export for the X.509 surface)
    - packages/core/src/capability.test.ts (one describe-block retitle, X509-05 evidence)
    - .planning/REQUIREMENTS.md (X509-01..07 section + 7 traceability rows)
    - packages/node/src/acceptance-traceability.node.test.ts (REQUIREMENT_ROW/
      TRACEABILITY_ROW widened)
    - packages/node/src/reachability-guard.node.test.ts (anti-vacuity ceiling 73->75)
    - packages/node/src/reachability-dispositions.ts (OPEN_FINDING_CEILING 47->49)

key-decisions:
  - "ALLOWED_TAGS grew from 12 to 15 (added 0x81/0x82 context [1]/[2] IMPLICIT, and
    0x05 NULL) so unique-identifier-present and algorithm-parameters-present can be
    refused by their specific named kind rather than collapsing into a generic
    malformed-der at the low-level decoder — a deliberate, documented extension of
    Plan 25-01's tag set, not a rewrite of it."
  - "Algorithm OID validated at all three AlgorithmIdentifier positions (TBS-inner
    signature, SPKI, outer signatureAlgorithm), not only the two the plan's <action>
    text named — RFC 5280 requires all three consistent, and the extra check is three
    lines colocated with the position it belongs to."
  - "Two-sided extension bounds (MAX_EXTENSION_COUNT, MAX_EXTENSION_BYTES) proved at
    the mechanism level rather than via a fully-valid 8-extension certificate: this
    profile's closed 4-member extension registry cannot construct 8 genuinely legal
    extensions, so 'accepted at the bound' is proved by the count/size gate passing
    (evidenced by the next refusal being unrecognised-extension, not the bound's own
    kind) rather than by a green whole-certificate decode."
  - "Three whole-certificate canonicalisation mutations built via a test-local
    encodeDerRaw (a non-canonicalising sibling of x509.ts's encodeDer) rather than
    manual byte-splicing — every ancestor SEQUENCE length is correctly re-derived from
    the actual poisoned content size, and the mutation cannot be silently
    re-canonicalised away by the encoder under test."
  - "REQUIREMENTS.md's X509-01..07 section placed between v1.1 and v2 (neither), per
    25-CONTEXT.md's own framing that this work is owner-ruled now rather than
    milestone-scheduled."
  - "Skipped the generic 'requirements mark-complete' state-update step. Five of this
    plan's six frontmatter requirement ids (X509-01/02/03/06/07) must stay [ ] Built,
    not wired per this phase's explicit ledger-honesty mandate; only X509-05 is [x].
    REQUIREMENTS.md was hand-edited with the correct checkbox states directly, and
    running a generic mark-complete over all six ids risked flipping the five that
    must stay unchecked."

requirements-completed: [X509-05]

duration: 19min
completed: 2026-08-09
---

# Phase 25 Plan 2: X.509 Profile Semantics and the X509-01…07 Requirement Mint Summary

Completed `decodeX509Certificate` over Plan 25-01's DER engine — algorithm allow-list
(Ed25519-only, four named bans reaching it by one mechanism), extension rules (count,
size, duplicate, closed-registry membership), and DER canonicalisation as the final
gate — then minted the X509-01…07 requirement family into `REQUIREMENTS.md` and widened
`acceptance-traceability.node.test.ts`'s row parsers in the same commit as the mint,
proved by an observed 82→89 matched-row count rather than a green suite alone.

## Performance

- **Duration:** 19 min (17:37:46 → 17:56:58, 2026-08-09)
- **Tasks:** 3 completed, each RED then GREEN
- **Files modified:** 7

## Accomplishments

- `decodeX509Certificate` is a complete, tested implementation of all seven X509
  obligations named in `25-CONTEXT.md`, six built this plan and the seventh
  (`X509-05`) recorded as delivered-with-evidence rather than re-implemented.
- 23 new tests (38 total in `x509.test.ts`), each a planted mutation over a shared
  DerNode-based certificate fixture builder, none hand-written hex.
- The ledger-mint blocker this plan's history is built around — minting `X509-0N` ids
  invisibly to a checker anchored `[A-Z]+-\d+` — is closed and proved by a direct
  before/after count (82 → 89), not by trusting a green suite.
- Two reachability-guard ceilings reddened exactly as the orchestrator predicted
  (barrel-exporting `x509.ts` for the first time) and were raised with dated,
  measured docblocks rather than silently.

## Task Commits

Each task ran RED (failing tests) then GREEN (implementation), six commits total:

1. **Task 1: TBSCertificate assembly** — `4708d61` (test, RED) → `2a4bf62` (feat, GREEN)
2. **Task 2: Algorithm allow-list, extension rules** — `17773d1` (test, RED) → `ec09495` (feat, GREEN)
3. **Task 3: Canonicalisation gate, barrel export, ledger mint, regex widening** — `3a07f2d` (test, RED) → `f66c04b` (feat, GREEN)

_All three tasks carried `tdd="true"`; every RED commit was verified failing before its GREEN commit landed._

## Files Created/Modified

- `packages/core/src/x509.ts` — `decodeX509Certificate`, `describeX509Failure`,
  `checkAlgorithm`, `assembleTbs`, `readExtensions`/`parseExtensionList`, `decodeOid`,
  and the profile's grammar-walking helpers; `ALLOWED_TAGS` extended 12→15;
  `X509Failure` extended to its full 12-kind union
- `packages/core/src/x509.test.ts` — `buildCertificateFixture` (DerNode + `encodeDer`),
  `encodeDerRaw` (non-canonicalising sibling for whole-certificate mutation tests), 23
  new tests across structural/algorithm/extension/canonicalisation obligations
- `packages/core/src/index.ts` — barrel export block for the X.509 surface
- `packages/core/src/capability.test.ts` — `describe` block retitled to carry X509-05's
  evidence
- `.planning/REQUIREMENTS.md` — new `## Phase 25 Requirements — X.509 Certificate
  Profile` section (7 checkboxes) and 7 traceability rows
- `packages/node/src/acceptance-traceability.node.test.ts` — `REQUIREMENT_ROW`/
  `TRACEABILITY_ROW` widened from `[A-Z]+-\d+` to `[A-Z][A-Z0-9-]*-\d+`
- `packages/node/src/reachability-guard.node.test.ts` — anti-vacuity ceiling 73→75
- `packages/node/src/reachability-dispositions.ts` — `OPEN_FINDING_CEILING` 47→49

## Decisions Made

See `key-decisions` in frontmatter. The two most load-bearing:

1. **ALLOWED_TAGS grew from 12 to 15**, not because the grammar needs three more
   constructs, but because a tag `decodeDer` refuses outright can never reach a
   specific, named `X509Failure` kind one layer up — `0x81`/`0x82` let
   `unique-identifier-present` fire by name instead of a generic tag refusal, and
   `0x05` (NULL) lets `algorithm-parameters-present` fire by name instead of the same
   generic collapse. This required re-aiming one pre-existing Plan 25-01 test (see
   Deviations).
2. **The ledger-widening blocker was treated as load-bearing, not incidental**, per the
   orchestrator's own framing. The regex widening landed in the *same commit* as the
   requirement mint (Task 3's GREEN), and the before/after count (82 → 89) was
   measured directly with a standalone script against the real file, both before and
   after, rather than inferred from the suite going green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan 25-01's "out-of-profile tag" test used 0x05 as its example, which stopped being true**
- **Found during:** Task 1, first RED test run.
- **Issue:** Extending `ALLOWED_TAGS` to include `0x05` (NULL) — necessary so
  `algorithm-parameters-present` can fire by name — broke the pre-existing test
  `'refuses a tag byte outside this profile's 12 allowed tags'`, whose premise was
  `expect(ALLOWED_TAGS.has(0x05)).toBe(false)`.
- **Fix:** Re-aimed the test at `0x0a` (ENUMERATED), which remains out of profile, with
  a comment explaining the re-aim and citing where `0x05`'s new role is documented.
- **Files modified:** `packages/core/src/x509.test.ts`.
- **Commit:** `4708d61` (Task 1 RED — caught before that commit was made).

**2. [Rule 2 - missing correctness check] Algorithm OID validated at all three `AlgorithmIdentifier` positions, not two**
- **Found during:** Task 1, while walking `TBSCertificate`'s grammar.
- **Issue:** The plan's `<action>` text for Task 2 names checking "both the SPKI's and
  the signature's `AlgorithmIdentifier`", but RFC 5280 §4.1.1.2 requires
  `Certificate.signatureAlgorithm` to match `TBSCertificate.signature` — a third,
  structurally-required field this profile's grammar already walks.
- **Fix:** `checkAlgorithm` is called at all three positions (TBS-inner `signature`,
  `SubjectPublicKeyInfo.algorithm`, outer `Certificate.signatureAlgorithm`), closing a
  gap that would otherwise leave the TBS-inner field's OID entirely unvalidated.
- **Files modified:** `packages/core/src/x509.ts`.
- **Commit:** `ec09495` (Task 2 GREEN).

Both are narrow, in-scope corrections discovered while implementing the plan's own
named tasks — no obligation, interface, or scope boundary was altered.

## TDD Gate Compliance

All three tasks show a `test(...)` commit (RED, verified failing) immediately followed
by a `feat(...)` commit (GREEN, verified passing) in git log:

- Task 1: `4708d61` (RED, 6/6 new tests failing via the stub's thrown error, 15
  pre-existing tests green after one was re-aimed) → `2a4bf62` (GREEN, 21/21).
- Task 2: `17773d1` (RED, 12/13 new tests failing for the expected reason; the 13th —
  a direct unit test of `describeX509Failure`, already complete since Task 1 — passed
  immediately and is not a gate violation, since it does not exercise
  `decodeX509Certificate`'s algorithm/extension wiring at all) → `ec09495` (GREEN,
  34/34).
- Task 3: `3a07f2d` (RED, 3/4 new tests failing — the golden-fixture acceptance test
  passed immediately because it does not depend on the canonicalisation gate
  specifically, per the same reasoning as Task 2's 13th test) → `f66c04b` (GREEN,
  38/38).

No test passed unexpectedly during a RED phase for a reason that mattered — the two
early passes above are both direct unit tests of already-complete Task 1 machinery
(`describeX509Failure`, and a fixture whose default output is already canonical DER by
construction), not premature satisfaction of the behavior each task's RED phase was
meant to prove.

## Known Stubs

None. `decodeX509Certificate` is a complete implementation of all seven X509
obligations; no stub bodies remain.

## Threat Flags

None beyond what `25-02-PLAN.md`'s own `<threat_model>` already names (T-25-05 through
T-25-09, T-25-15) — every new surface this plan introduces (the algorithm allow-list,
the extension rules, the canonicalisation gate, the ledger-parser widening) sits inside
a trust boundary the plan's own threat register already dispositions `mitigate`. No new
network endpoint, auth path, file access pattern, or schema change at a trust boundary
was introduced.

## Ledger Honesty

Six of seven `X509-0N` rows are `[ ] Built, not wired`, each evidence sentence
containing the verbatim phrase `` `decodeX509Certificate` has no production caller ``
— confirmed true against the real tree: `grep -rn "decodeX509Certificate" packages
tools --include="*.ts"` matches only `x509.ts` itself, `x509.test.ts`, `index.ts`'s
export line, and this plan's own reachability-guard/dispositions documentation
comments. Only `X509-05` is `[x]` Done, citing `capability.ts:127`/`:190`/`:255` and
`capability.test.ts`'s relabelled describe block — a real production call path via
`authorizeCapability`, unlike the other six.

## Self-Check: PASSED

- FOUND: `packages/core/src/x509.ts`
- FOUND: `packages/core/src/x509.test.ts`
- FOUND: `.planning/REQUIREMENTS.md` contains `X509-05`
- FOUND: `packages/node/src/acceptance-traceability.node.test.ts` contains `[A-Z][A-Z0-9-]*-\d+`
- FOUND commit: `4708d61` (Task 1 RED)
- FOUND commit: `2a4bf62` (Task 1 GREEN)
- FOUND commit: `17773d1` (Task 2 RED)
- FOUND commit: `ec09495` (Task 2 GREEN)
- FOUND commit: `3a07f2d` (Task 3 RED)
- FOUND commit: `f66c04b` (Task 3 GREEN)
- CONFIRMED: `npx tsc --noEmit` exits 0 for the whole repository
- CONFIRMED: full `node` vitest project (174 files, 2502 tests, 1 pre-existing skip) passes
- CONFIRMED: 82 → 89 matched-row count on both `REQUIREMENT_ROW` and `TRACEABILITY_ROW`,
  measured directly against `.planning/REQUIREMENTS.md` before and after this plan's edits
