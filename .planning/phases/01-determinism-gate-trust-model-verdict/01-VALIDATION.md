---
phase: 1
slug: determinism-gate-trust-model-verdict
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@4.1.10` + `@vitest/browser@4.1.10` + `@vitest/browser-playwright@4.1.10` — none installed yet; this phase creates the project skeleton |
| **Config file** | none yet — Wave 0 creates `vitest.config.ts` with a `projects` array (one `environment: 'node'`, one `browser.instances: [chromium, firefox, webkit]`) |
| **Quick run command** | `npx vitest run --project node` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5s quick (pure functions, no browser) · ~60-90s full (three browsers cold-start) |

**Why the quick command is node-only:** the admission-gate scanner and the canonical
hasher are pure functions with zero platform dependency. They carry most of this
phase's logic and all of its unit-testable surface, so the fast loop needs no browser.

---

## Sampling Rate

- **After every task commit:** `npx vitest run --project node`
- **After every plan wave:** `npx vitest run` (all projects, local browsers via Playwright),
  **plus** a push to trigger the real CI divergence matrix — the cross-architecture
  signal does not exist on one developer machine and cannot be faked locally
- **Before `/gsd-verify-work`:** the CI `divergence.yml` workflow must be green, **or**
  showing a documented, expected divergence that `01-VERDICT.md` explicitly accounts for
- **Max feedback latency:** ~5s local, ~8min CI matrix

---

## Per-Task Verification Map

Task IDs are assigned during planning; this table binds requirements to their
verification method and is filled in with task IDs by the planner.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | DET-01 | T-1-01, T-1-03 | Malformed binary is rejected, never crashes the executor; forbidden opcodes found regardless of LEB128 encoding length | unit | `npx vitest run --project node packages/core/src/admission/scan.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DET-04 | — | N/A | integration (CI-only) | `.github/workflows/divergence.yml` → `diff` job | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DET-05 | — | N/A | unit | `npx vitest run --project node packages/core/src/canonical/hash.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DET-01/DET-02 parity | T-1-02 | Publish-time and runtime scanners reject the identical rule set — any divergence between them is a bug | unit | `npx vitest run --project node packages/core/src/admission/parity.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | VER-07 | — | N/A | manual (document review) | — phase gate | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BENCH-02 | — | N/A | manual (checklist review) | — phase gate | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/package.json` + root `tsconfig.json` — project skeleton with
      `isolatedDeclarations: true`, `moduleResolution: bundler`, `"private": true`
- [ ] `vitest.config.ts` — multi-project config (node + chromium/firefox/webkit)
- [ ] `packages/core/src/admission/scan.test.ts` — stubs for DET-01
- [ ] `packages/core/src/canonical/hash.test.ts` — stubs for DET-05
- [ ] `packages/core/src/admission/parity.test.ts` — stubs for publish/runtime scanner parity
- [ ] `tools/divergence-harness/probes/*.wat` + `build.ts` — probe generation for DET-04
- [ ] `.github/workflows/divergence.yml` — CI execution for DET-04
- [ ] Spike: confirm `wabt` ESM import ergonomics under `moduleResolution: bundler`
      (research Assumption A1 — five minutes, blocks probe compilation if wrong)
- [ ] Spike: re-verify `playwright` ↔ `@vitest/browser-playwright` peer compatibility
      via `npm view` before locking `package.json`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The verdict's branch selection is a mechanical consequence of the harness diff-job output, not an asserted claim | VER-07 | The *harness* is automated (DET-04); "the verdict faithfully reflects what the harness measured" is an authorship check no test can make | Open `01-VERDICT.md` next to the CI diff artifact. Confirm the named branch follows from the data, that raw data is attached rather than summarised, and that affected downstream phases and REQ-IDs are listed by name |
| Benchmark methodology is complete and pre-registered | BENCH-02 | Completeness against a required-fields list is a review, not an assertion | Confirm `01-BENCHMARK-METHODOLOGY.md` is committed **before any benchmark number exists anywhere in the repo**, and contains: metrics, machine inventory, run counts, cold/warm code-cache policy, redundancy factor, skew profile, single-threaded baseline definition |
| No deploy workflow exists anywhere in the repository | disclosure invariant | Proving absence is a repo-wide check, not a unit test | `ls .github/workflows/` shows only test/CI workflows. `grep -rl "actions/deploy-pages\|peaceiris/actions-gh-pages\|vercel\|netlify" .github/` returns nothing. Every `package.json` contains `"private": true` |

---

## Security Domain

> `security_enforcement` absent from `.planning/config.json` → enabled per framework default.
> ASVS L1.

### Applicable ASVS Categories

| Category | Applies | Control |
|----------|---------|---------|
| V5 Input Validation | **yes** | The admission-gate scanner is an input-validation component for untrusted binary input. A WASM module is attacker-controllable in the fabric's threat model even though this phase only feeds it self-authored probes. Parse defensively: treat every length/offset read as untrusted, bounds-check before every access, fail closed on malformed sections |
| V6 Cryptography | **yes, narrowly** | SHA-256 via `crypto.subtle` — never hand-rolled. Used for content-integrity comparison, not as a security boundary. No signatures or key material in this phase |
| V10/V12 Malicious Code & Resources | **yes, narrowly** | Rejecting nondeterministic constructs before execution *is* this phase's core security function — already covered by DET-01, not a separate control |
| V2/V3/V4 AuthN, Session, Access Control | no | No identity or auth surface — pure functions plus a CI harness |

### Threat Model

| ID | Threat | STRIDE | Mitigation |
|----|--------|--------|------------|
| T-1-01 | Malformed/truncated WASM causes the pure-TS scanner to read past buffer bounds — e.g. a section-size LEB128 claiming more bytes than remain | Denial of Service | Bounds-check every offset against `bytes.length` before dereferencing. An out-of-range read is an immediate `Result.ok = false`, never a thrown exception that could crash an executor |
| T-1-02 | A module admissible to the fast runtime scanner but rejected by the publish-time `binaryen`/`wabt` pass, or the reverse | Tampering / Elevation of Privilege | Both passes enforce the identical rule set and are tested against each other. DET-02 exists precisely because a node must not trust that publish-time validation was performed honestly by someone else |
| T-1-03 | A relaxed-SIMD or atomic opcode encoded in a valid-but-non-minimal LEB128 form evades a scanner that only recognises canonical encodings | Tampering | The scanner's LEB128 reader decodes permissively for the purpose of *finding forbidden opcodes*. It does not rely on the engine to reject non-minimal encodings first |

---

## Nyquist Compliance

Feedback is sampled faster than the rate at which this phase's state changes:

- Pure-function logic (scanner, hasher) — every commit, ~5s
- Cross-platform behaviour — every push, ~8min CI
- Verdict correctness — once, at the phase gate, by review

The one irreducible gap: **the cross-architecture divergence signal cannot be
sampled locally.** A single developer machine has one architecture. That is why
DET-04's verification is CI-only and why the phase gate depends on a CI artifact
rather than a local run.
