---
phase: 25-x509-certificate-profile
verified: 2026-08-10T01:31:09Z
status: passed
score: 7/7 criteria verified
overrides_applied: 0
---

# Phase 25: X.509 Certificate Profile Verification Report

**Phase Goal:** The certificate envelope becomes X.509 v3 with a cryptographic profile
that is load-bearing rather than advisory — a set of precise refusals, each guarded,
such that an ASN.1 parser in the browser trust path is not the weakest thing in the
design.

**Verified:** 2026-08-10T01:31:09Z
**Status:** passed
**Re-verification:** No — initial verification

## Method

Per the orchestrator's instruction, the seven success criteria were **not** scored off
a reading of `x509.test.ts`. Each of the seven obligations' refusal branches in
`packages/core/src/x509.ts` was neutralised in place with a `false &&` guard, the real
test file (`npx vitest run --project node packages/core/src/x509.test.ts`) was run
against the mutated source and the exit code read directly (`EXIT=$?` on the line
immediately following, no pipe to `tail`), the failure text was recorded, the file was
restored by the surgical inverse of the one-line edit, and the restoration was verified
byte-identical to a pre-plant snapshot via `cmp`. `git status --porcelain` and
`git diff --stat` are clean at the end of this report — no plant survived.

## Goal Achievement — Seven Obligations

| # | Obligation | Req ID | Plant | Observed RED (verbatim) | Restore `cmp` | Verdict |
|---|---|---|---|---|---|---|
| 1 | Permitted algorithms — Ed25519 only | X509-01 | `checkAlgorithm`'s `oid !== ID_ED25519` branch neutralised | `expected true to be false` (RSA acceptance test); 4 tests failed total (shared plant with obl. 2) | clean | ✓ VERIFIED |
| 2 | Named bans — SHA-1, P-192, P-224, RSA<2048 | X509-02 | Same plant as #1 (bans reach `unrecognised-algorithm` through the same allow-list mechanism, as designed) | P-192/P-224 tests: `expected 'algorithm-parameters-present' to be 'unrecognised-algorithm'`; RSA test: `expected true to be false`. `Tests 4 failed / 34 passed (38)`, EXIT=1 | clean | ✓ VERIFIED |
| 3 | DER canonicalisation, proved by re-encode+compare | X509-03 | Final `checkDerCanonical` gate in `decodeX509Certificate` neutralised | 3 tests failed: non-minimal `signatureValue` length, redundant `serialNumber` leading `0x00`, unzeroed `subjectPublicKey` BIT STRING padding — each `expected true to be false`, EXIT=1 | clean | ✓ VERIFIED |
| 4 | Certificate parsing byte ceiling, checked before parse | X509-04 | `preParseCheck`'s `bytes.length > MAX_CERTIFICATE_BYTES` branch neutralised | `expected null not to be null` (bound test) and `expected 'malformed-der' to be 'certificate-too-large'` (ordering-proof test, proving the gate really runs before `decodeDer`), EXIT=1 | clean | ✓ VERIFIED |
| 5 | Maximum chain depth | X509-05 | **Not planted — already delivered, evidence cited per orchestrator instruction, not re-implemented.** | — | — | ✓ VERIFIED (delivered-with-evidence) |
| 6 | Extension size / count limits, pre-parse | X509-06 | Two separate plants: (a) `list.length > MAX_EXTENSION_COUNT` neutralised, (b) `ext.extnValue.length > MAX_EXTENSION_BYTES` neutralised | (a) `expected 'unrecognised-extension' to be 'too-many-extensions'`, EXIT=1. (b) `expected 'unrecognised-extension' to be 'extension-too-large'`, EXIT=1 | clean (each restored before the next plant) | ✓ VERIFIED |
| 7 | Duplicate extensions refused outright | X509-07 | `seen.has(ext.extnId)` duplicate check neutralised | `expected true to be false` (duplicate-`extnID` test), EXIT=1 | clean | ✓ VERIFIED |

**Score:** 7/7 obligations verified — all six built refusals plant-and-watched red
independently by this verifier (not by trusting the SUMMARY narration of the executor's
own earlier plant-and-restore cycles), plus obligation 5 confirmed as delivered evidence
against the live tree, not re-implemented.

### Obligation 5 — evidence re-verified against HEAD

Cited line numbers checked directly against `packages/core/src/capability.ts` at HEAD:

- `capability.ts:127` — `export const MAX_CHAIN_DEPTH = 8` — confirmed exact.
- `capability.ts:190` — `if (chain.length > MAX_CHAIN_DEPTH) {` inside `verifyChain`,
  positioned before any signature work in the function body — confirmed exact.
- `capability.ts:255` — `const expiresAt = chain.reduce((earliest, link) => Math.min(earliest, link.expiresAt), Infinity)`
  — the `reduce`-not-spread hazard closure — confirmed exact.
- `capability.test.ts:238` — `describe('chain depth is bounded (X509-05 — max chain
  depth, delivered here, not re-implemented)', ...)` — confirmed exact.

Per the orchestrator's instruction, this obligation was **not** re-planted: rebuilding
it would be inventing work a prior phase already delivered and guarded. MET-as-delivered
is the correct verdict, and the correct verdict was returned.

## The Two Owed Numbers

### Bundle weight

`packages/node/src/x509-bundle.e2e.test.ts` was re-run by this verifier
(`npx vitest run --project e2e packages/node/src/x509-bundle.e2e.test.ts`), exit code
read directly: **EXIT=0**, 1/1 test passed. This re-confirms — rather than merely
trusts — the SUMMARY's claimed ~19064-byte gzip delta guarded at
`DECODER_BUDGET_BYTES = 25600` (~1.34x headroom).

- **Comparative, not absolute.** The measurement is a within-one-process, within-one-run
  delta between two synthetic Vite library-mode builds (a no-`@o2/core` baseline and a
  real-import-and-call decoder entry), matching `CLAUDE.md`'s Measurement convention. It
  is not an absolute number carried from a different host or day.
- **The overstatement caveat is honest, not a dodge.** The docblock at
  `x509-bundle.e2e.test.ts:120-139` states explicitly that the measured 19064 bytes is
  the decoder's *whole* transitive graph (`@ipld/dag-cbor` + `multiformats`, pulled in
  by the two dag-cbor-backed extension decoders), not `x509.ts`'s own lines alone, and
  that a page already loading `dag-cbor` for another reason (canonical encoding is
  already an `@o2/core` `submitJob` dependency) would see a smaller marginal cost. This
  is a documented, cited, worst-case-first framing — the more conservative of the two
  honest numbers, named as such — not a number quietly picked to look better than it is.

### Off the execution path

Re-verified independently at HEAD, not inherited from RESEARCH.md §6's earlier claim:

- `grep -rn "decodeX509Certificate"` across `packages`/`tools` (excluding test files)
  matches only `x509.ts` itself and `index.ts`'s barrel export line — **zero production
  callers**, confirming the decoder itself sits nowhere near any execution path.
- `verifyCertificate`'s production call sites, enumerated directly against HEAD:
  `enrollment.ts:926` (`resolveReplicaSets`), `result-attestation.ts:483`,
  `discovery.ts:264` (`discoverExecutors`), `browser/demo/main.ts:350`
  (`peerCertificate`), `packages/node/src/peer-verifier.ts:557,688`, and
  `packages/node/src/fabric-node.ts:960` — six call sites (the CONTEXT/RESEARCH
  documents describe five for `verifyCertificate`'s *own* module plus a sixth inside
  `peer-verifier.ts`'s two internal call points; both are admission/discovery/attestation
  logic, not execution).
- `WebAssembly.instantiate`/`WebAssembly.compile` call sites at HEAD, enumerated
  directly: `packages/core/src/executor/wasm.ts:160-161`,
  `packages/aot/src/abi-router.ts:147`, `packages/aot/src/wasi-executor.ts:830-831`.
  `grep -n "verifyCertificate\|decodeX509Certificate"` against all three files and
  `packages/net/src/agent.ts` returns **no matches** — no certificate-verification call
  of any kind sits inside the module(s) that reach `WebAssembly.instantiate`.
- **Verdict: still true at HEAD, and this phase added nothing onto that path.** No new
  caller of either `verifyCertificate` or `decodeX509Certificate` was introduced by
  Phase 25 — the decoder's own six ledger rows say "no production caller" and that was
  independently confirmed, not merely read.

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ------------ | ------ | ------- |
| `packages/core/src/x509.ts` | DER decoder + seven-obligation profile | ✓ VERIFIED | 965 lines; `preParseCheck`, `decodeDer`, `encodeDer`, `checkDerCanonical`, `decodeX509Certificate`, `describeX509Failure` all implemented, no stub bodies |
| `packages/core/src/x509.test.ts` | Tests for all seven obligations | ✓ VERIFIED | 792 lines, 38 tests, all green at rest; each of six built obligations independently plant-verified red by this verifier |
| `packages/core/src/ed25519-backend.ts` | Sync/async Ed25519 dual-port adapter | ✓ VERIFIED (unwired by design) | 228 lines, no stubs; 27/27 node tests green, re-run by this verifier |
| `packages/node/src/x509-bundle.e2e.test.ts` | Bundle-weight guard | ✓ VERIFIED | Re-run by this verifier, EXIT=0, 1/1 passed |
| `.planning/REQUIREMENTS.md` X509-01..07 block | Requirement family, honest ledger status | ✓ VERIFIED | X509-05 `[x]`, the other six `[ ]` "Built, not wired" — confirmed against the live file |
| `packages/core/src/capability.ts` (obligation 5) | `MAX_CHAIN_DEPTH`, pre-signature enforcement | ✓ VERIFIED | Lines 127/190/255 confirmed exact at HEAD, pre-existing (Phase <25), correctly recorded not re-implemented |

## Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `x509.test.ts` | `x509.ts`'s seven refusal branches | direct function calls, each independently plant-verified | ✓ WIRED | Every plant reddened a specific, correctly-attributed test, not a generic failure |
| `x509-bundle.e2e.test.ts` | `@o2/core`'s `decodeX509Certificate` | real `import` + real call inside a Vite library build | ✓ WIRED | Sanity check `decoderGzipBytes > baselineGzipBytes` asserted separately from the ceiling check, proving the import is not tree-shaken away |
| `decodeX509Certificate` | any production caller | — | correctly NOT WIRED | Zero matches outside `x509.ts`/`index.ts`/tests — matches the ledger's honest "Built, not wired" status for six of seven rows, which is the phase's own stated scope boundary, not a gap |
| `ed25519-backend.ts` | `verifyChain`/`verifyCertificate` | — | correctly NOT WIRED | Explicitly out of scope per 25-CONTEXT.md ("not scoped to this plan"); bootstrap-ordering decision named as the blocker, not silently dropped |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| X509-01 | 25-02 | Ed25519-only allow-list | ✓ SATISFIED (built, not wired — as ledgered) | Plant-verified red by this verifier |
| X509-02 | 25-02 | SHA-1/P-192/P-224/RSA named bans | ✓ SATISFIED (built, not wired) | Plant-verified red by this verifier |
| X509-03 | 25-01/25-02 | DER canonicalisation gate | ✓ SATISFIED (built, not wired) | Plant-verified red by this verifier |
| X509-04 | 25-01/25-03 | Certificate byte ceiling + bundle-weight guard | ✓ SATISFIED (built, not wired; bundle guard is wired and green) | Plant-verified red; bundle e2e test re-run green |
| X509-05 | pre-existing | Max chain depth | ✓ SATISFIED (Done — real production path) | Line citations re-confirmed at HEAD |
| X509-06 | 25-02 | Extension size/count limits | ✓ SATISFIED (built, not wired) | Two independent plants, both red |
| X509-07 | 25-02 | Duplicate extension refusal | ✓ SATISFIED (built, not wired) | Plant-verified red by this verifier |

No orphaned requirements found: `.planning/REQUIREMENTS.md`'s X509-01..07 block matches
exactly what the four plans (25-01..04) declared, and the traceability rows exist for
all seven (`acceptance-traceability.node.test.ts` / `requirements-ledger.node.test.ts`
re-run by this verifier: 61/61 passed, EXIT=0).

## Anti-Patterns Found

None. `grep`-scanned `x509.ts`, `x509.test.ts`, `ed25519-backend.ts`,
`ed25519-backend.test.ts`, `x509-bundle.e2e.test.ts` for `TBD`/`FIXME`/`XXX`/`TODO`/
`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches. No stub bodies,
no hardcoded empty returns on a live path.

## Behavioral Spot-Checks / Probe Execution

Not applicable in the probe-script sense (no `scripts/*/tests/probe-*.sh` referenced by
this phase's PLAN/SUMMARY/VALIDATION files). The plant-and-restore cycles above serve
the equivalent function for this phase's refusal-based obligations and were performed
directly by this verifier rather than accepted from the SUMMARY narration.

## Regression Checks

- `npx tsc --noEmit` (whole repo): EXIT=0.
- `npx vitest run --project node packages/core/src/x509.test.ts`: 38/38 passed at rest, EXIT=0.
- `npx vitest run --project node packages/core/src/ed25519-backend.test.ts`: 27/27 passed, EXIT=0.
- `npx vitest run --project e2e packages/node/src/x509-bundle.e2e.test.ts`: 1/1 passed, EXIT=0.
- `npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts packages/node/src/requirements-ledger.node.test.ts`: 61/61 passed, EXIT=0.
- `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts`: 20/20 passed, EXIT=0 (ceilings 73/75, 47/49, both cited by the phase's deferred-items.md, hold).
- `git status --porcelain` after every plant/restore cycle and at the end of this report: clean except the two pre-existing untracked RFC files noted in the verification brief as already committed elsewhere — not this phase's concern.
- Full `--project node` (174 files / 2502 passed / 1 skipped) and full `--project e2e`
  (19 files / 85 passed) figures cited in the verification brief were not re-run in
  full by this verifier (already measured by the orchestrator per the brief's
  "things already established" list); the individual files this phase touches were
  re-run directly above instead, and all are green.

## Human Verification Required

None. All seven obligations are byte-level refusals over attacker-supplied input,
fully automatable, and were verified by direct plant-and-restore execution rather than
left for manual confirmation.

## Gaps Summary

None found. All seven success criteria named in ROADMAP.md's Phase 25 entry are met:
six by an independently-executed plant-and-watch-red cycle against the real test suite
(not a reading of the test file), and the seventh (max chain depth) by re-confirming
the cited evidence lines exist unchanged at HEAD, per the orchestrator's explicit
instruction not to re-implement already-delivered work. The two numbers the owner
ruling additionally obliges (bundle weight, off-the-execution-path) were both
independently re-measured/re-checked rather than trusted from the SUMMARY, and both
hold. The tree is clean of any TBD/FIXME/XXX debt markers in this phase's files. No
regressions were found in this phase's own tests, the requirement ledger, or the
anti-vacuity reachability guard.

The phase goal — "load-bearing rather than advisory... a set of precise refusals, each
guarded" — is achieved: every named refusal in `x509.ts` demonstrably fails the test
suite when neutralised, which is the ruling's own definition of "load-bearing."

---

_Verified: 2026-08-10T01:31:09Z_
_Verifier: Claude (gsd-verifier)_
