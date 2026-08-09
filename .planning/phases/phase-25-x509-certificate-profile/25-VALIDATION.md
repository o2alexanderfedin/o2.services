---
phase: 25
slug: x509-certificate-profile
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-09
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Derived from `25-RESEARCH.md` § Validation Architecture (line 660). The per-task map
> below was filled at plan time from the four plans' `<verify>` blocks, one row per
> task, and is the artifact `/gsd-verify-work` reads.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10, `projects` config (`node` / `browser` / `e2e` / `perf`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --project node packages/core/src/x509.test.ts` |
| **Full suite command** | `npm run test:node` |
| **Estimated runtime** | quick ~2 s (new unit file); `test:node` ~395 s on a quiet host |

**Run by project, never by bare path.** A bare path fans out across all four projects
(`CLAUDE.md` § Measurement). And read the exit code directly — `EXIT=$?` on the line
immediately after the command, no pipes, no trailing `tail`: a trailing `tail` has made a
failing vitest run report success in this repository more than once.

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project node packages/core/src/x509.test.ts`
- **After every plan wave:** `npm run test:node`
- **Before `/gsd-verify-work`:** full suite green, **plus** the bundle-cost guard run
  against a real `npm run build:demo` output — the ruling makes bundle weight a number
  this phase owes, so a green suite without it is an incomplete gate.
- **Max feedback latency:** ~2 s per task, ~395 s per wave.

**Comparative over absolute.** The bundle guard asserts a *delta* against the measured
168.93 KB gzip baseline taken in the same run, not a hardcoded ceiling. An absolute
threshold silently encodes the machine and the day it was written.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-T1 | 25-01 | 1 | X509-04 (prep) | T-25-02 (constant) | Type contracts + sited `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES`/`MAX_EXTENSION_COUNT`; stubs only, no logic yet | type-check | `npx tsc --noEmit` | `packages/core/src/x509.ts` | ⬜ pending |
| 25-01-T2 | 25-01 | 1 | X509-04 | T-25-01, T-25-02 | Certificate-size gate before parse; bounded TLV decode refusing indefinite-length, disallowed tags, truncated input | unit | `npx vitest run --project node packages/core/src/x509.test.ts` | `packages/core/src/x509.ts`, `x509.test.ts` | ⬜ pending |
| 25-01-T3 | 25-01 | 1 | X509-03 (mechanism; gated as a refusal in 25-02) | T-25-03 | Canonical DER re-encoder + round-trip byte compare (non-minimal length, INTEGER padding, BIT STRING padding, BOOLEAN) | unit | `npx vitest run --project node packages/core/src/x509.test.ts -t "canonical"` | `packages/core/src/x509.ts`, `x509.test.ts` | ⬜ pending |
| 25-02-T1 | 25-02 | 2 | X509-01..07 (assembly prerequisite) | — (RFC 5280 §4.1.2.8 hardening, no dedicated threat row) | TBSCertificate assembly; refuses unique-identifier, GeneralizedTime, multi-valued RDN, non-UTF8String | unit | `npx vitest run --project node packages/core/src/x509.test.ts -t "assembly"` | `packages/core/src/x509.ts`, `x509.test.ts` | ⬜ pending |
| 25-02-T2 | 25-02 | 2 | X509-01, X509-02, X509-06, X509-07 | T-25-05, T-25-06, T-25-07, T-25-08 | Ed25519-only allow-list; SHA-1/P-192/P-224/RSA named bans; extension size/count ceilings; duplicate-`extnID` refusal; custom extension decode | unit | `npx vitest run --project node packages/core/src/x509.test.ts -t "algorithm\|extension\|duplicate"` | `packages/core/src/x509.ts`, `x509.test.ts` | ⬜ pending |
| 25-02-T3 | 25-02 | 2 | X509-03, X509-05 (ledger record only) | T-25-09, T-25-15 | Canonicalisation as final gate; golden-fixture acceptance; `X509-01..07` ledger mint with honest Built-not-wired status; `acceptance-traceability.node.test.ts`'s `REQUIREMENT_ROW`/`TRACEABILITY_ROW` widened to `[A-Z][A-Z0-9-]*-\d+` so the minted rows are actually checked (82→89 matched rows, not merely a green suite) | unit + ledger-guard | `npx vitest run --project node packages/core/src/x509.test.ts packages/core/src/capability.test.ts`; `npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts packages/node/src/requirements-ledger.node.test.ts` | `packages/core/src/x509.ts`, `x509.test.ts`, `index.ts`, `capability.test.ts`, `.planning/REQUIREMENTS.md`, `packages/node/src/acceptance-traceability.node.test.ts` | ⬜ pending |
| 25-03-T1 | 25-03 | 3 | X509-04 (bundle-weight half) | T-25-10 | Dual synthetic Vite library-mode build; gzip delta of a real decoder import guarded against a sited `DECODER_BUDGET_BYTES` | e2e build-measurement | `npx vitest run --project e2e packages/node/src/x509-bundle.e2e.test.ts` | `packages/node/src/x509-bundle.e2e.test.ts` | ⬜ pending |
| 25-04-T1 | 25-04 | 1 | — (infra, no X509-0N id) | T-25-13, T-25-14 | **Revised 2026-08-09 (adapter ruling).** A synchronous Ed25519 port (`initEd25519()` once, then plain `boolean` `.verify()`) with noble and libsodium adapters, plus a separate async port for already-async call sites; one shared capability check decides both, libsodium lazily imported only when `crypto.subtle` is absent — absence simulated via `Object.defineProperty` shadowing, not the no-op `delete` | unit | `npx vitest run --project node packages/core/src/ed25519-backend.test.ts` | `packages/core/src/ed25519-backend.ts`, `.test.ts` | ⬜ pending |
| 25-04-T2 | 25-04 | 1 | — | T-25-11, T-25-12, T-25-16 | **Revised 2026-08-09 (adapter ruling).** Differential-conformance guard across every backend/engine available, reject-weighted, including the non-canonical-`S` malleability vector, AND a new sync-port/async-port agreement case (T-25-16) — the seam the adapter itself introduces by allowing two live backends in one process | unit (node + browser × 3 engines) | `npx vitest run --project node packages/core/src/ed25519-backend.test.ts`; `npx vitest run --project browser packages/core/src/ed25519-backend.test.ts` | `packages/core/src/ed25519-backend.test.ts` | ⬜ pending |
| 25-04-T3 | 25-04 | 1 | — | — (pricing/measurement finding, not a threat mitigation) | **Revised 2026-08-09 (adapter ruling).** Cited 9-call-site async-migration pricing + named structural obstacle (`PeerVerifier.verifiedPeers`) kept as the *record* of why the adapter was selected (not live scope — the second ruling dissolves the obstacle rather than paying for it); a re-measured `performance.now()` timing distinct from `25-CONTEXT.md`'s table; PLUS a new, explicit wiring decision: `verifyChain`/`verifyCertificate` are **not** wired to the port this phase (bootstrap-ordering across three runtime entry points is undecided and out of this revision's remit) — stated by name, not left implicit | docs/measurement, guarded by grep | `grep -c "not planned as execution work in Phase 25\|out of scope" packages/core/src/ed25519-backend.test.ts` | `packages/core/src/ed25519-backend.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Obligation → behavior map (from RESEARCH.md, pre-task)

The seven obligations are the phase's real denominator; the planner minted `X509-01…07`
against them in Plan 25-02, and each row below is covered by at least one task row above.

| Obligation | Req ID | Behavior under test | Test type | Task row(s) | File exists? |
|---|---|---|---|---|---|
| 1 — Ed25519 only | X509-01 | a non-`id-Ed25519` `AlgorithmIdentifier` OID is refused, by name | unit | 25-02-T2 | ❌ Wave 0 |
| 2 — named bans | X509-02 | SHA-1, P-192, P-224 and RSA<2048 each refused, **individually** guarded | unit | 25-02-T2 | ❌ Wave 0 |
| 3 — DER canonicalisation | X509-03 | re-encode and compare bytes; byte-identical or refused | unit | 25-01-T3, 25-02-T3 | ❌ Wave 0 |
| 4 — parsing limits | X509-04 | oversized certificate refused **before** any parse, plus its browser bundle-weight cost measured and guarded | unit + e2e | 25-01-T1, 25-01-T2, 25-03-T1 | ❌ Wave 0 |
| 5 — max chain depth | X509-05 | **already delivered** — `capability.ts:127` / `:190`, guarded by `capability.test.ts`, retitled in 25-02-T3 to carry the `X509-05` id | — | 25-02-T3 (record only) | ✅ existing |
| 6 — extension size limits | X509-06 | oversized single extension, and too many extensions, both refused pre-parse | unit | 25-02-T2 | ❌ Wave 0 |
| 7 — duplicate extensions | X509-07 | a repeated `extnID` is refused outright — not last-wins, not a warning | unit | 25-02-T2 | ❌ Wave 0 |

**Obligation 5 is delivered-with-evidence, not work.** It is listed so the map is
complete over the ruling's seven items. Re-implementing it would be the phase inventing
work it does not have; omitting it would make the map look 6-of-7 when it is 7-of-7.

**The ledger-parser widening (blocker fix, 25-02-T3) is not an eighth obligation** — it
is the precondition for obligations 1, 2, 3, 4, 6 and 7's `Built, not wired` rows to be
checked at all by `acceptance-traceability.node.test.ts`. It is folded into 25-02-T3's
row above rather than given its own row, because it lands in the same commit as the
mint it protects.

---

## Wave 0 Requirements

- [ ] A decoder module and its test file — path is Claude's discretion per `25-CONTEXT.md`;
      the natural candidate is `packages/core/src/x509.ts` / `x509.test.ts`, adjacent to
      `enrollment.ts` and `capability.ts`. Covers obligations 1, 2, 3, 4, 6, 7.
- [ ] A bundle-cost guard — likely the `e2e` tier alongside `built-bundle.e2e.test.ts`,
      since it needs the real Vite output rather than a source-size estimate.
- [ ] An `X509-01…07` requirement block in `.planning/REQUIREMENTS.md`, with the existing
      AUTH-01 / AUTH-05 rows cross-referenced if this phase changes what `NodeCertificate`
      issuance or verification actually produces.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *(none identified)* | — | — | — |

All seven obligations are byte-level refusals over attacker-supplied input, which is the
most automatable class of behavior in this repository. If a manual row appears during
planning, that is a signal the obligation was mis-specified, not that it is untestable.

---

## Proof Discipline (project rule, not boilerplate)

`CLAUDE.md` § Proofs governs every row above:

- **A proof that cannot fail is not a proof.** Each refusal test is planted against,
  **watched red**, restored by the surgical inverse of the edit, and verified with `cmp`
  against a snapshot taken immediately before planting. The observed failure text is
  recorded.
- **Restore by surgical inverse, never by `cp`.** `cp` restores a whole file to a snapshot
  and is only safe if you were the sole writer for the entire plant-to-restore window.
- **The hunk count is a one-way alarm.** More hunks than your plant proves another writer;
  equal hunks proves nothing. `cmp` is the check.
- **Descoped is not satisfied; unmeasured is not met.** The bundle number and the
  off-the-execution-path claim are both numbers this phase owes — neither may be inherited
  as a caveat. The same discipline governs the ledger-parser widening in 25-02-T3: a
  green `acceptance-traceability.node.test.ts` run is not proof the new rows are checked
  unless the matched-row count is observed to rise (82 → 89).

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify command or a Wave 0 dependency — confirmed
      against all ten task rows above, including 25-04-T3 (a `grep` verify, added during
      this revision so the docblock's scope statement is machine-checked rather than
      merely reviewed)
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify — every
      task row has one
- [x] Wave 0 covers all ❌ references above — 25-01 (wave 1) and 25-02 (wave 2) together
      create and populate `x509.ts`/`x509.test.ts`; 25-03 (wave 3) creates the bundle
      guard; 25-02-T3 mints the `REQUIREMENTS.md` block. All three Wave 0 Requirements
      above are covered by a task.
- [x] No watch-mode flags in any command — every Automated Command column above is a
      single `vitest run` / `tsc --noEmit` / `grep` invocation, none pass `--watch`
- [x] Feedback latency < 5 s per task — the quick command (`x509.test.ts` alone) runs in
      ~2 s per the Test Infrastructure table above; no task's own verify command exceeds
      that
- [x] Every one of obligations 1–7 maps to at least one task row — see the obligation
      map above; each of X509-01 through X509-07 cites at least one Task ID
- [ ] Each refusal test was planted, watched red, and restored with `cmp` verification —
      **not yet checkable.** This is an execution-time attestation (a claim about a run
      that happened), and no plan in this phase has executed: there are no
      `*-SUMMARY.md` files in this phase directory yet. Leaving unchecked per this
      repository's own rule — "descoped is not satisfied; unmeasured is not met" — this
      box is for `/gsd-verify-work` to tick once Wave 0 actually runs, not for the
      planner to tick on the plan's behalf.
- [x] `nyquist_compliant: true` set in frontmatter — set above, now that the per-task map
      is real and every task carries an automated command

**Approval:** pending — `wave_0_complete: false` remains accurate; no task in this phase
has executed.
