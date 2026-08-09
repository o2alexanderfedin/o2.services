---
phase: 25
slug: x509-certificate-profile
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Derived from `25-RESEARCH.md` § Validation Architecture (line 660). The per-task map
> below is **empty until the planner mints tasks** — it is filled at plan time, one row
> per task, and is the artifact `/gsd-verify-work` reads.

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
| *(filled at plan time — one row per task)* | | | | | | | | | |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Obligation → behavior map (from RESEARCH.md, pre-task)

The seven obligations are the phase's real denominator; the planner mints `X509-01…07`
against them, and each row below must end up covered by at least one task row above.

| Obligation | Req ID (planner mints) | Behavior under test | Test type | File exists? |
|---|---|---|---|---|
| 1 — Ed25519 only | X509-01 | a non-`id-Ed25519` `AlgorithmIdentifier` OID is refused, by name | unit | ❌ Wave 0 |
| 2 — named bans | X509-02 | SHA-1, P-192, P-224 and RSA<2048 each refused, **individually** guarded | unit | ❌ Wave 0 |
| 3 — DER canonicalisation | X509-03 | re-encode and compare bytes; byte-identical or refused | unit | ❌ Wave 0 |
| 4 — parsing limits | X509-04 | oversized certificate refused **before** any parse | unit | ❌ Wave 0 |
| 5 — max chain depth | X509-05 | **already delivered** — `capability.ts:127` / `:190`, guarded by `capability.test.ts` | — | ✅ existing |
| 6 — extension size limits | X509-06 | oversized single extension, and too many extensions, both refused pre-parse | unit | ❌ Wave 0 |
| 7 — duplicate extensions | X509-07 | a repeated `extnID` is refused outright — not last-wins, not a warning | unit | ❌ Wave 0 |

**Obligation 5 is delivered-with-evidence, not work.** It is listed so the map is
complete over the ruling's seven items. Re-implementing it would be the phase inventing
work it does not have; omitting it would make the map look 6-of-7 when it is 7-of-7.

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
  as a caveat.

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify command or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all ❌ references above
- [ ] No watch-mode flags in any command
- [ ] Feedback latency < 5 s per task
- [ ] Every one of obligations 1–7 maps to at least one task row
- [ ] Each refusal test was planted, watched red, and restored with `cmp` verification
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
