---
phase: 25-x509-certificate-profile
plan: 1
subsystem: core
tags: [x509, der, asn1, decoder, canonicalisation]
dependency-graph:
  requires: []
  provides:
    - packages/core/src/x509.ts (DerNode, X509Failure, ALLOWED_TAGS, MAX_CERTIFICATE_BYTES,
      MAX_EXTENSION_BYTES, MAX_EXTENSION_COUNT, X509_EXTENSION_ARC + 4 extension OIDs,
      ID_ED25519, ID_AT_COMMON_NAME, preParseCheck, decodeDer, encodeDer, checkDerCanonical)
  affects:
    - Plan 25-02 (algorithm allow-list, extension rules, duplicate detection — pure
      composition over this plan's engine)
tech-stack:
  added: []
  patterns:
    - typed discriminated-union refusal, never thrown (copied from capability.ts's
      ChainFailure / enrollment.ts's CertificateFailure)
    - bound-checked-before-expensive-work, ordering stated in a comment
      (capability.ts:186-192's pattern, applied as preParseCheck before decodeDer)
    - decode faithfully, canonicalise only at re-encode, compare bytes (RESEARCH.md §2's
      single mechanism covering all five BER/DER divergence classes)
key-files:
  created:
    - packages/core/src/x509.ts
    - packages/core/src/x509.test.ts
  modified: []
decisions:
  - "ALLOWED_TAGS is one Set<number> of all 12 profile tags (not three separate
    constants) — the plan's own <interfaces> block and Task 2's action text both
    reference a single grep-able ALLOWED_TAGS, so that shape was followed over an
    ambiguous 'three tag-set constants' phrase in Task 1's action text."
  - "decodeDer's own TLV offsets are absolute against the original buffer, not
    relative to each recursion level's content slice — readTlv threads an explicit
    limit parameter rather than re-slicing into a fresh Uint8Array per nesting level,
    so a refusal's offset always points at the real byte position."
  - "The size-gate-before-parse ordering is proved in x509.test.ts by composing
    preParseCheck + decodeDer locally (mirroring what Plan 25-02's
    decodeX509Certificate will do) with a call-count check on decodeDer, plus a
    second direct decodeDer(oversized) call proving what the wrong order would have
    produced (malformed-der) — since decodeX509Certificate itself is Plan 25-02's
    file, not this plan's."
metrics:
  duration: "~7 minutes wall time (3 task commits, 2 TDD RED commits, 2 TDD GREEN
    commits, plus 1 non-TDD Task-1 commit — 6 commits total spanning
    2026-08-09T15:29:30-07:00 to 2026-08-09T15:32:15-07:00)"
  completed: 2026-08-09
  tasks_completed: 3
  files_created: 2
---

# Phase 25 Plan 1: X.509 DER Decoder Foundation Summary

Bounded, hand-written DER decoder engine (12 fixed ASN.1 tags, no general parser) with
a certificate-size gate checked before any parse and a canonical re-encoder proving
BER/DER divergence by byte-for-byte round trip — the type contracts and mechanism
Plan 25-02's semantic profile refusals build on.

## What Was Built

`packages/core/src/x509.ts` (410 lines) and `packages/core/src/x509.test.ts` (239
lines), following `capability.ts`/`capability.test.ts`'s established shape exactly:

- **`DerNode`** and **`X509Failure`** — the type contracts from the plan's
  `<interfaces>` block, verbatim. `X509Failure` currently carries only
  `certificate-too-large` and `malformed-der`; a docblock comment lists the eight
  kinds Plan 25-02 adds so a reader sees the union's eventual shape.
- **`ALLOWED_TAGS`** — a `Set<number>` of the 12 tag bytes this profile's grammar
  needs (RESEARCH.md §1), one comment per tag naming where it appears in the
  certificate.
- **`MAX_CERTIFICATE_BYTES` (4096), `MAX_EXTENSION_BYTES` (2048),
  `MAX_EXTENSION_COUNT` (8)** — each docblock cites RESEARCH.md §4's worked
  ≈1612-byte OpenSSL-grounded total and states its headroom multiple (2.5×/1.9×/2×)
  by name, and each states explicitly that `operatorId`'s and `relayIds`' byte caps
  are this phase's own new constraint, not an existing bound being encoded
  (RESEARCH.md Pitfall 3).
- **`X509_EXTENSION_ARC`** and its four extension OIDs (`EXT_USER_KEY`,
  `EXT_OPERATOR_ID`, `EXT_DISCOVERABILITY`, `EXT_RELAY_IDS`), plus **`ID_ED25519`**
  and **`ID_AT_COMMON_NAME`** — the algorithm/attribute OIDs Plan 25-02 consumes.
- **`preParseCheck(bytes)`** — the certificate-size gate (X509-04), a standalone
  function (not folded into `decodeDer`) so Plan 25-02's `decodeX509Certificate` can
  call it as the documented first line.
- **`decodeDer(bytes)`** — a recursive-descent TLV reader. Refuses the high-tag-number
  form and any tag outside `ALLOWED_TAGS` by name; refuses BER's `0x80`
  indefinite-length marker at the length octet, before attempting any content scan;
  refuses any declared length (short-form or long-form) that runs past the buffer,
  without reading out of bounds. Accepts both short-form and long-form definite
  lengths at decode time (including non-minimal long-form) — RESEARCH.md §2's
  strategy is decode-then-compare, and refusing non-minimal length here would
  short-circuit that mechanism before `checkDerCanonical` can prove it.
- **`encodeDer(node)`** — re-serializes a `DerNode` tree in DER's one canonical form:
  minimal-length encoding always; `INTEGER`'s redundant leading `0x00`/`0xFF`
  stripped (kept when disambiguating sign); `BIT STRING`'s unused padding bits
  zeroed; `BOOLEAN` TRUE forced to exactly `0xFF`. Every other tag's content passes
  through verbatim — multi-valued `SET`s are Plan 25-02's outright refusal, so
  `encodeDer` never implements `SET OF` ordering.
- **`checkDerCanonical(bytes)`** — decode, re-encode, byte-compare. Built above any
  comparison (the re-encoded bytes exist in full before the compare loop runs),
  matching `capability.ts`'s payload-built-above-the-`try` pattern so a codec defect
  is never misreported as "the input was non-canonical."

## Test Coverage (15 tests, all green)

- **Size bound as a bound, not a ban**: accepted exactly at `MAX_CERTIFICATE_BYTES`,
  refused one byte past it, naming the actual size and the limit.
- **Ordering proof**: an oversized input whose first byte is also an invalid tag
  refuses `certificate-too-large` when composed through `preParseCheck` first
  (`decodeDer` call count asserted `0`), and separately, calling `decodeDer` directly
  on the same bytes (bypassing the gate) is shown to refuse `malformed-der` instead —
  the concrete "wrong order" outcome the gate exists to prevent.
- **Indefinite length**, **out-of-profile tag**, **high-tag-number form**, **truncated
  short-form length**, **truncated long-form length declaration** — five refusal
  tests, each with a comment recording what a lenient/naive implementation would have
  done instead.
- **Well-formed nested structure** decodes faithfully (content bytes and tree shape
  preserved).
- **Six canonicalisation tests**, one per RESEARCH.md §2 divergence row plus the
  boolean addendum: non-minimal length, redundant-vs-disambiguating leading
  `INTEGER` `0x00` (two separate assertions, not merged — a merged test could pass by
  checking only one direction), non-zeroed `BIT STRING` padding, non-`0xFF`
  `BOOLEAN`, and the accept case for an already-canonical input (the "other half" that
  keeps an always-empty `encodeDer` from passing every refusal test for the wrong
  reason).

## TDD Gate Compliance

Tasks 2 and 3 both carried `tdd="true"`. Both followed RED → GREEN:

- Task 2: `test(25-01)` commit `3871aa3` (9 tests, all failing against Task 1's
  throwing stubs — observed failure text `Error: not implemented — Task 2/3 of
  25-01`), then `feat(25-01)` commit `83c3dea` (all 9 passing).
- Task 3: `test(25-01)` commit `34e05e5` (6 more tests, same observed failure text),
  then `feat(25-01)` commit `0e6792e` (all 15 passing).

No test passed unexpectedly during either RED phase — both RED commits showed the
full expected failure count.

## Verification

- `npx tsc --noEmit` — exits 0 (whole-repo check, run after every task).
- `npx vitest run --project node packages/core/src/x509.test.ts` — 15/15 passed,
  `EXIT=$?` read directly, no pipe.
- `npx vitest run --project node packages/core/src/x509.test.ts -t "canonical"` —
  6/15 matched and passed (9 skipped), confirming the plan's own filtered verify
  command for Task 3 works as specified.
- `grep -c "it("` on the test file: 15 (9 after Task 2, 6 more from Task 3 — meets
  the "at least 5 more" acceptance criterion).
- `grep -c "^import"` on `x509.ts`: 0 — no platform import anywhere in the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] `isolatedDeclarations` required explicit type annotations on
the four extension-OID template-literal constants**
- **Found during:** Task 1, first `tsc --noEmit` run.
- **Issue:** `EXT_USER_KEY = \`${X509_EXTENSION_ARC}.1\`` (and its three siblings)
  failed with `TS9010: Variable must have an explicit type annotation with
  --isolatedDeclarations` — the repo's tsconfig requires this (per CLAUDE.md's
  Technology Stack table: `isolatedDeclarations: true` is how the project avoids
  depending on the unstable TS 7.0 API).
- **Fix:** Added `: string` to each of the four constants.
- **Files modified:** `packages/core/src/x509.ts`.
- **Commit:** folded into `c4a1105` (Task 1's own commit; caught before that commit
  was made, not a later fix).

**2. [Rule 1 - bug] Test-side type narrowing needed for `X509Failure`'s discriminated
union**
- **Found during:** Task 2, first `tsc --noEmit` run after implementing
  `preParseCheck`.
- **Issue:** `failure.bytes` / `failure.limit` (only present on the
  `certificate-too-large` member) failed `TS2339` against the full `X509Failure`
  union in the bound-boundary test.
- **Fix:** Added `if (failure.kind !== 'certificate-too-large') return` before
  accessing `.bytes`/`.limit`, matching the narrowing style `capability.test.ts` uses
  throughout (`if (!result.ok) return` before touching `.failure`).
- **Files modified:** `packages/core/src/x509.test.ts`.
- **Commit:** folded into `83c3dea` (Task 2's GREEN commit).

Both deviations are type-level fixes required to reach a genuine `tsc --noEmit`
exit-0, not scope changes — no behavior, obligation, or interface from the plan was
altered.

## Known Stubs

None. All four exported functions (`preParseCheck`, `decodeDer`, `encodeDer`,
`checkDerCanonical`) are fully implemented; no stub bodies remain from Task 1.

## Threat Flags

None. All decoder/encoder logic implemented in this plan sits inside the two trust
boundaries the plan's own `<threat_model>` already names (`bytes → decodeDer` and
`DerNode tree → encodeDer`); no new network endpoint, auth path, file access pattern,
or schema change at a trust boundary was introduced.

## Self-Check: PASSED

- FOUND: `packages/core/src/x509.ts`
- FOUND: `packages/core/src/x509.test.ts`
- FOUND commit: `c4a1105` (Task 1 — type contracts and sited constants)
- FOUND commit: `3871aa3` (Task 2 RED)
- FOUND commit: `83c3dea` (Task 2 GREEN)
- FOUND commit: `34e05e5` (Task 3 RED)
- FOUND commit: `0e6792e` (Task 3 GREEN)
