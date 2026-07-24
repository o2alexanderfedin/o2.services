# Phase 1: Determinism Gate & Trust-Model Verdict - Research

**Researched:** 2026-07-24
**Domain:** WebAssembly binary format / cross-architecture determinism measurement / CI benchmark methodology
**Confidence:** MEDIUM-HIGH — WAT/opcode/spec claims are HIGH (primary spec sources, direct citation); GitHub Actions labels are HIGH (verified live via `gh api` against `actions/runner-images` today); the central empirical question (does the divergence actually reproduce in V8 today) is or, by design, UNKNOWN until the harness runs — that is the entire point of the phase.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Divergence Harness — Scope & Platform Matrix**
- Platform matrix: GitHub Actions `ubuntu-latest` (x86-64) and `macos-14` (arm64), running Node on both plus Playwright chromium/firefox/webkit on both. This is the cheapest route to genuine cross-architecture coverage; local two-machine testing and Android/BrowserStack are rejected for v1 as slower to reproduce and harder to attach to a commit.
- Test modules: hand-written WAT probes *and* one realistic source-compiled float kernel. WAT gives exact control over which opcodes execute (NaN generation via `sqrt(-1)`, `0.0/0.0`, `inf-inf`; f32/f64 arithmetic); the compiled kernel supplies realism. Neither alone is sufficient.
- NaN-bit-leak probe is required, not deferred: a module that reinterprets NaN bits as `i32` and branches on them, returning an integer. This is the case output canonicalization *cannot* repair, and it is what decides whether canonicalization is a sufficient fix or merely a partial one.
- Cadence: every push plus nightly. `Math.pow`/`exp`/`sin` are implementation-defined across engines *and across V8 versions*, so a one-shot measurement decays.

**Output Canonicalization & Comparison**
- Output is declared, not inferred: the task manifest carries an explicit output schema (field list + types) and the comparison hashes field-by-field. A raw linear-memory hash would report allocator residue and struct padding as divergence — false positives that would be misdiagnosed as NaN drift.
- NaN normalization: every NaN normalizes to a single canonical quiet-NaN pattern at the ABI boundary before hashing. Rejecting NaN-bearing output outright was considered and rejected as too restrictive for real float work.
- Float encoding: fixed-width IEEE-754 big-endian bytes after normalization. Decimal string formatting is rejected — locale and precision behaviour are additional divergence vectors.
- Signed zero: normalize `-0.0` to `+0.0`. They are numerically equal but differ in bits, making signed zero a genuine divergence source.

**Admission Gate**
- Location and timing: a pure function in `@o2/core` with zero platform imports, executed at publish time *and* re-executed by the executor before instantiation. DET-02 requires a node never to run a module it did not itself validate, so publish-time-only validation is insufficient.
- Parsing strategy: a minimal pure-TypeScript section/opcode scanner on the runtime path; `binaryen`/`wabt` at publish time only. Binaryen is far too heavy to ship into a browser bundle, so "binaryen everywhere" is rejected.
- Rejection reporting: a structured `Result<Ok, Rejection[]>` naming the offending construct and its byte offset. No exceptions — rejection is an expected outcome, not an error condition.
- Frozen import allow-list: exactly the four-function host ABI. No WASI — WASI supplies the guest a clock, randomness, environment, and filesystem, which are four additional nondeterminism vectors precisely where determinism is the requirement.

**Verdict & Benchmark Pre-registration**
- Branch criterion (strict): N-version comparison is viable **if and only if** canonical-form hashes are identical across the entire platform matrix for every probe module, *including* the NaN-bit-leak case. Any divergence selects backbone-anchored audit sampling. The softer alternative — permitting N-version scoped to modules that pass admission even when the bit-leak probe diverges — was rejected: it would make the integrity guarantee conditional on a property the admission gate cannot actually verify.
- Verdict location: `01-VERDICT.md` in this phase directory, committed, with the raw measurement data attached rather than summarised.
- Benchmark methodology (BENCH-02) is registered in full before any number exists: metrics, machine inventory, run counts, cold/warm code-cache policy, redundancy factor, skew profile, and the single-threaded baseline definition. A minimal registration was rejected — the project's external credibility rests on these numbers, and post-hoc methodology is how benchmarks inflate.
- The verdict must name affected phases and REQ-IDs explicitly under the negative branch, so the fallback is actionable rather than a note of concern.

### Claude's Discretion

No areas were delegated — all sixteen questions were answered as proposed. Implementation detail below the level of these decisions (file layout, test naming, internal function signatures) remains at implementation discretion, guided by the repository conventions in `CLAUDE.md`.

### Deferred Ideas (OUT OF SCOPE)

- Android and mobile-browser coverage via BrowserStack — mobile arm64 is a real target but adds a paid dependency; the macOS arm64 runner already supplies cross-architecture signal.
- WASM fuel/gas metering — no maintained JS-side instrumentation tool exists (`wasm-metering` died in 2022). Phase 1 does not need it; the build-vs-accept-Worker-timeout decision belongs to the kernel phase.
- The negative-branch design itself — if the verdict selects audit sampling, designing that mechanism is downstream work, not this phase. Phase 1 names the affected phases; it does not redesign them.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DET-01 | A published WASM artifact is rejected at publish time if it uses relaxed-SIMD opcodes, `atomic.*`/shared memory, imports outside a frozen allow-list, or declares `memory.initial !== memory.maximum` | §Architecture Patterns → Admission Gate Scanner; §Code Examples give exact opcode-prefix ranges (0xFD ≥0x100, 0xFE always) and section byte offsets from the spec, plus the memory-limits flag encoding (0x00/0x01/0x02/0x03) needed to detect shared memory |
| DET-04 | A cross-architecture divergence harness executes an identical float-heavy module on x86-64 and arm64 across Chrome, Firefox, Safari, and Node, and reports byte-level output differences | §Architecture Patterns → GitHub Actions matrix + artifact-diff job; §Code Examples give the exact WAT probes (incl. the NaN-bit-leak probe) and the vitest 4.x multi-browser project config |
| DET-05 | Task output is compared by canonical-form hash, never by raw linear-memory bytes | §Code Examples → canonical-form hashing via `crypto.subtle` (identical code path in Node 24 and every target browser); §Common Pitfalls covers the false-positive traps of naive raw-buffer hashing |
| VER-07 | If DET-04 shows divergence, integrity falls back to backbone-anchored audit sampling instead of N-version comparison | §Standard Stack / §Summary frame the strict branch criterion mechanically: the verdict is a pure function of the harness's own output, not a judgment call, once the harness runs |
| BENCH-02 | Benchmark methodology is pre-registered and committed before the first published number | §State of the Art → COST paper methodology as template; §Architecture Patterns → benchmark methodology document structure |
</phase_requirements>

## Summary

This phase has no product code to research — it has three artifacts to build correctly: a byte-exact WAT/compiled-kernel divergence harness that runs across a 2-OS × (Node + 3 browsers) matrix in CI, a pure-TypeScript admission-gate scanner that walks WASM binary sections without executing them, and a canonical-form output hasher that works identically in Node and every target browser. All three share one constraint: **zero platform imports, so the same code that runs in the CI harness today is the exact code that ships into `@o2/core` and gates every future kernel execution.**

The empirical question — does x86 vs. arm64 V8 actually diverge on fresh-NaN sign bits for the probes this project cares about — could not be answered by any published measurement found in this research (see §6 below, and the "Open Questions / Gaps" section already logged in `.planning/research/STACK.md`, item 3). What **is** independently verifiable, and was verified against both the WASM spec's own design-issue tracker and the underlying CPU architecture references (Intel/ARM), is the *mechanism*: x86 SSE2's "invalid operation" QNaN result has historically carried sign=1 (`0xFFC00000`) while ARM's IEEE-754 "Default NaN" mode forces sign=0 (`0x7FC00000`) — a hardware-level fact that predates and is orthogonal to WebAssembly. V8 does not override this (verified: `node --v8-options` exposes no NaN-canonicalization flag on either architecture). This gives strong theoretical grounds to expect the divergence will reproduce, without constituting a measurement. That gap is precisely why this phase exists — it is the honest justification for spending a phase on it rather than assuming either outcome.

The NaN-bit-leak probe is the harness's load-bearing test, and it must be built exactly as CONTEXT.md specifies: a module that computes a fresh NaN, reinterprets its bits as `i32` (via `i32.reinterpret_f32` — a real, exact, non-approximating spec instruction, opcode `0xBC`), and **branches** on the sign bit before returning a plain integer. Canonical-form hashing operates on the module's *declared output schema* — it normalizes typed float fields before hashing. A leaked NaN bit that has already been consumed by an `if`/`else` and turned into an ordinary `i32` result is indistinguishable, to the comparator, from any other legitimate integer output. No canonicalization scheme can repair it after the fact, because the divergence has already left the float domain.

**Primary recommendation:** Build the harness as three independent, composable pieces that later become `@o2/core`'s first real exports — (1) `probes/*.wat` compiled at build time via `wabt@1.0.39`, (2) a hand-written pure-TS section/opcode scanner (do not depend on `@webassemblyjs/wasm-parser`; it is stale — last published Nov 2024 — and its SIMD/threads opcode coverage against the current spec is unverified), and (3) a canonical-hash function built on `crypto.subtle` alone, which is the *same object* in Node 24 (`globalThis.crypto`, stable since Node 19) and every evergreen browser, requiring no reconciliation shim at all.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WAT probe authoring & compilation to `.wasm` | Build/publish pipeline (Node, CI) | — | `wabt` is a heavy WASM-of-a-C++-toolchain; it must never enter a browser bundle. Runs once at build time, artifacts are checked in or built as a CI step. |
| Admission-gate opcode/section scanner | `@o2/core` (platform-free) | Executed identically in Browser, Node, Worker | This is the one piece of Phase 1 that *is* product code — DET-01/DET-02 require it to run both at publish time and, unmodified, on every executor before instantiation. Zero platform imports is the hard constraint that makes this possible. |
| Canonical-form output hashing | `@o2/core` (platform-free) | Browser / Node / Worker (identical) | `crypto.subtle` is a Web-standard API present verbatim in Node 24 and all three target browsers — no tier-specific branch needed. |
| Cross-architecture divergence harness orchestration | CI / Backbone (GitHub Actions) | — | Not part of the shipped product; a measurement rig. Runs Node directly on each OS/arch runner and drives Playwright for the browser legs. |
| Verdict document & benchmark methodology registration | Human-authored artifact (repo) | — | `01-VERDICT.md` and the benchmark methodology doc are written outputs, not executable components — but they are gated *by* the harness's output, not by opinion. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `wabt` | `1.0.39` (published 2025-12-03) [VERIFIED: npm registry] | Compile hand-written `.wat` probes to `.wasm` at build/publish time; also usable to validate a module's declared feature set before signing | Already the project's binding pick in `.planning/research/STACK.md`; the actively maintained WABT-to-JS port with a promise-init API (`require('wabt')()` / `import wabtInit from 'wabt'`). `wat2wasm` (the standalone npm package) is stale — last published 2022-05-24 [VERIFIED: npm registry] — do not use it. |
| `binaryen` | `131.0.0` [VERIFIED: npm registry, published 2026-07-24] | Publish-time feature-set inspection and (optionally) NaN-mutilating `denan` pass for non-verification-eligible workloads | Already binding per STACK.md. Not needed for Phase 1's harness itself (WAT probes are hand-authored, not binaryen-transformed) but is the publish-time counterpart to the runtime scanner this phase must also build — the same admission-gate contract runs through both. |
| `@vitest/browser-playwright` | `4.1.10` [VERIFIED: npm registry] | The vitest 4.x provider package for running browser-mode tests under Playwright | **This is a naming change from the STACK.md-era assumption of a `provider: 'playwright'` string.** As of vitest 4.1.10, the provider is imported as a function: `import { playwright } from '@vitest/browser-playwright'`, then `browser: { provider: playwright(), instances: [...] }`. Confirmed against the live `vitest.dev/guide/browser/` docs on 2026-07-24. Flag this correction back into STACK.md when this phase executes. |
| `playwright` / `@playwright/test` | `1.62.0` [VERIFIED: npm registry — note: STACK.md pinned `1.61.1`; `1.62.0` is newer as of this research date] | Multi-browser driver for `@vitest/browser`, and the CI installer for chromium/firefox/webkit | Confirm exact pin at plan time — `@vitest/browser-playwright` and `playwright` versions must be compatible; re-verify via `npm view` immediately before locking `package.json`. |
| `typescript` `7.0.2`, `tsdown` `0.22.14`, `vitest` `4.1.10` | per STACK.md | Project skeleton — this phase's side effect of being "the first code in the repository" | Binding per STACK.md; not re-litigated here. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `assemblyscript` | `0.28.20` [VERIFIED: npm registry, published 2026-07-22] | Compile the one *realistic source-compiled* float kernel CONTEXT.md requires alongside the hand-written WAT probes | Recommended over reaching for a Rust/C toolchain: it is an `npm install -D` away, needs no per-runner system toolchain install in CI (both `ubuntu-latest` and `macos-14` just need Node, already required), and its `asc` compiler emits ordinary float arithmetic (`Math.sqrt`, division, etc.) through the same V8 WASM path the probes exercise — so it supplies compiler-realism (register allocation, non-hand-tuned instruction selection) without adding a second CI toolchain. This is Claude's-discretion-level tooling, not a locked decision — flag as a recommendation, not a mandate. |
| `@webassemblyjs/wasm-parser` / `@webassemblyjs/ast` | `1.14.1` (last published 2024-11-06) [VERIFIED: npm registry] | **Considered and NOT recommended** as the runtime admission-gate scanner | Pure JS, used by webpack, but two years stale relative to this research date and its coverage of relaxed-SIMD (finalized opcode range ≥`0x100` under the `0xFD` prefix) and the threads/atomics `0xFE` prefix is unverified against the current spec. Depending on it risks either false negatives (a relaxed-SIMD op it doesn't recognize gets silently skipped) or a crash-as-rejection heuristic that is accidentally correct for the wrong reason. Build the minimal scanner by hand instead (see Code Examples) — the opcode surface that must be walked correctly is bounded and spec-cited below. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written pure-TS section/opcode scanner | `@webassemblyjs/wasm-parser` | Faster to ship, but stale (2024) and unverified against relaxed-SIMD/threads opcode ranges finalized after its last release — see above. Reject for the runtime path; reconsider only after independently confirming its SIMD/atomics opcode tables against the current binary-format spec. |
| `assemblyscript` for the realistic compiled kernel | Rust (`wasm32-unknown-unknown`) or C (`emcc`) | Rust/C would be more representative of what `elfconv` (Phase 11) eventually AOT-translates, but adds a second toolchain (rustc or emscripten) to install on both CI runners — pure overhead for what this phase needs, which is *a* realistic compiled float kernel, not *the* eventual production one. Revisit in Phase 11. |
| `crypto.subtle` (Web Crypto) for canonical hashing | `node:crypto` (`createHash`) + a browser shim | Rejected — `node:crypto`'s `createHash` is Node-only and synchronous; reconciling it with the browser's async `crypto.subtle` would require exactly the kind of dual-code-path the "zero platform imports" constraint forbids. `crypto.subtle` needs no shim: Node has exposed the identical Web Crypto object as `globalThis.crypto` since Node 19 [CITED: nodejs.org/en/blog/announcements/v19-release-announce], and Node 24 (the project's pinned LTS) carries it forward with no flag. |

**Installation:**
```bash
npm install -D wabt@1.0.39 assemblyscript@0.28.20
npm install -D typescript@7.0.2 tsdown@0.22.14 vitest@4.1.10 \
  @vitest/browser@4.1.10 @vitest/browser-playwright@4.1.10 \
  playwright@1.62.0 @playwright/test@1.62.0
```

**Version verification note:** `wabt`, `binaryen`, `assemblyscript`, and `@vitest/browser-playwright` were all confirmed live against the npm registry on 2026-07-24 (this research date). `playwright` has moved past the `1.61.1` pin recorded in `.planning/research/STACK.md` (now `1.62.0`) — re-run `npm view playwright version` and `npm view @vitest/browser version` immediately before writing `package.json` in case they have moved again; do not trust either this document's or STACK.md's pin blindly at execution time.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │              BUILD / PUBLISH TIME             │
                     │                                               │
  probes/*.wat  ───▶ │  wabt.parseWat()  ──▶  .validate()  ──▶  │
  (hand-written)      │  .toBinary()  ──▶  probe-N.wasm             │
                     │                                               │
  assembly/*.ts  ───▶ │  asc (AssemblyScript compiler)  ──▶         │
  (realistic kernel)  │  kernel.wasm                                 │
                     └───────────────────┬───────────────────────────┘
                                         │  (checked-in .wasm artifacts,
                                         │   or built as a CI step)
                                         ▼
        ┌────────────────────────────────────────────────────────────────┐
        │                    GITHUB ACTIONS MATRIX                        │
        │                                                                  │
        │   ubuntu-latest (x86-64)        macos-14 (arm64)                │
        │   ┌──────────────────┐          ┌──────────────────┐            │
        │   │ Node 24 harness  │          │ Node 24 harness  │            │
        │   │ Playwright:      │          │ Playwright:      │            │
        │   │  chromium        │          │  chromium        │            │
        │   │  firefox         │          │  firefox         │            │
        │   │  webkit          │          │  webkit           │           │
        │   └────────┬─────────┘          └────────┬─────────┘            │
        │            │  each leg: instantiate every  │                    │
        │            │  probe .wasm, run it, canon-  │                    │
        │            │  hash the declared output,    │                    │
        │            │  upload as a JSON artifact     │                   │
        │            ▼                                ▼                   │
        │     8 artifacts total (2 OS × 4 runtimes)                       │
        └───────────────────────────┬──────────────────────────────────────┘
                                    │
                                    ▼
                      ┌───────────────────────────┐
                      │   diff job (needs: matrix) │
                      │   download all artifacts   │
                      │   compare canonical hashes  │
                      │   pairwise across the set   │
                      │   PASS iff all 8 agree, for │
                      │   every probe incl. the     │
                      │   NaN-bit-leak probe        │
                      └──────────────┬────────────┘
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                 all agree (strict)   any disagree
                          │                   │
                          ▼                   ▼
              N-version comparison    backbone-anchored
              viable (VER-07 no-op)   audit sampling
              → 01-VERDICT.md         (VER-07 triggers)
                                      → 01-VERDICT.md names
                                        affected phases/REQ-IDs
```

### Recommended Project Structure

```
packages/
└── core/                          # @o2/core — zero platform imports
    ├── src/
    │   ├── admission/
    │   │   ├── scan.ts            # DET-01/DET-02: pure-TS section/opcode scanner
    │   │   ├── sections.ts        # section-ID table, LEB128 reader
    │   │   ├── opcodes.ts         # instruction skip-table (length-only, not full decode)
    │   │   └── result.ts          # Result<Ok, Rejection[]> type
    │   ├── canonical/
    │   │   ├── hash.ts            # DET-05: crypto.subtle-based canonical hasher
    │   │   └── normalize.ts       # NaN, -0.0, big-endian IEEE-754 normalization
    │   └── index.ts
    └── package.json                # "private": true
tools/
└── divergence-harness/             # NOT shipped — CI/build-time only
    ├── probes/
    │   ├── nan-sqrt-f32.wat
    │   ├── nan-div-f32.wat
    │   ├── nan-sub-f32.wat
    │   ├── nan-sqrt-f64.wat
    │   ├── nan-bit-leak.wat        # the load-bearing probe
    │   └── build.ts                 # wabt: .wat → .wasm at build time
    ├── kernel/
    │   ├── float-kernel.ts          # AssemblyScript source
    │   └── build.ts                 # asc: .ts → .wasm
    ├── run-probe.ts                 # instantiate + execute + canon-hash one probe
    └── collect.ts                   # writes one JSON artifact per OS/runtime leg
.github/
└── workflows/
    └── divergence.yml               # matrix + diff job — TEST workflow only, no deploy step
01-VERDICT.md                        # committed verdict, raw data attached
01-BENCHMARK-METHODOLOGY.md          # BENCH-02 pre-registration (see State of the Art)
```

### Pattern 1: WAT probes that force a genuinely fresh NaN

**What:** Every probe must generate a NaN with **no NaN in its inputs** — this is the case where the WASM spec explicitly permits the *sign bit* of the result to be implementation-defined [CITED: github.com/WebAssembly/design/blob/main/Nondeterminism.md]. `sqrt` of a negative number, `0/0`, and `inf - inf` are the three canonical "invalid operation" cases that manufacture a fresh NaN rather than propagate one.

**When to use:** As the harness's core probe set (DET-04), one probe per operation × per width (f32/f64).

**Example — three independent fresh-NaN generators, each exporting the raw bit pattern as an integer so the harness reads exact bytes with no JS `Number` formatting ambiguity:**
```wat
;; Source: WebAssembly Core Spec — Binary Instructions
;; https://webassembly.github.io/spec/core/binary/instructions.html
;; i32.reinterpret_f32 = opcode 0xBC (verified against spec + MDN)

(module
  (func (export "nan_sqrt_f32") (result i32)
    f32.const -1
    f32.sqrt              ;; sqrt of a negative number: "invalid operation", fresh NaN
    i32.reinterpret_f32)  ;; export the raw IEEE-754 bits, not the float

  (func (export "nan_div_f32") (result i32)
    f32.const 0
    f32.const 0
    f32.div                ;; 0.0 / 0.0: fresh NaN
    i32.reinterpret_f32)

  (func (export "nan_sub_f32") (result i32)
    f32.const inf
    f32.const inf
    f32.sub                ;; inf - inf: fresh NaN
    i32.reinterpret_f32)

  (func (export "nan_sqrt_f64") (result i64)
    f64.const -1
    f64.sqrt
    i64.reinterpret_f64))  ;; f64 sibling — opcode 0xBD
```

### Pattern 2: The NaN-bit-leak probe (load-bearing)

**What:** A module that computes a fresh NaN, reads its raw bits, **branches on the sign bit**, and returns a plain integer whose *value* — not bit pattern of a float — depends on the platform's NaN sign convention. Canonical-form hashing normalizes *declared float fields*; this probe's output is already an ordinary `i32` by the time it reaches the ABI boundary, so no float-normalization step can repair it.

**When to use:** Exactly once, as the harness's strict pass/fail case per CONTEXT.md's branch criterion.

```wat
(module
  (func (export "nan_bit_leak") (result i32)
    (local $bits i32)
    f32.const -1
    f32.sqrt
    i32.reinterpret_f32
    local.set $bits
    local.get $bits
    i32.const 0
    i32.lt_s                 ;; true iff bit 31 (the sign bit) is set
    (if (result i32)
      (then (i32.const 1))   ;; sign bit set   (historically the x86 "indefinite" QNaN convention)
      (else (i32.const 2))))) ;; sign bit clear (ARM Default-NaN convention)
```

If the harness observes `1` on one architecture and `2` on the other, N-version comparison is not viable for any module whose control flow can be influenced by NaN bit patterns — and per the strict branch criterion, that alone selects the audit-sampling trust model for the whole v1, since the admission gate (DET-01) has no way to prove a module's control flow is NaN-bit-independent.

### Pattern 3: Compiling WAT to `.wasm` with `wabt` at build time

**What:** `wabt`'s JS port exposes a promise-init factory. It is a large WASM-compiled C++ toolchain — **build-time / CI-time only**, never bundled into `@o2/core`.

```typescript
// tools/divergence-harness/probes/build.ts
// Source: AssemblyScript/wabt.js README (github.com/AssemblyScript/wabt.js)
// Confidence: MEDIUM — CJS default-export interop under Node ESM is the
// commonly-used pattern for this package but was not independently
// re-verified against a live `import` in this research session; treat
// the exact import line as a Wave-0 spike item, not a locked fact.
import wabtInit from 'wabt'
import { readFileSync, writeFileSync } from 'node:fs'

const wabt = await wabtInit()

function compileWat(watPath: string, outPath: string): void {
  const source = readFileSync(watPath, 'utf8')
  const mod = wabt.parseWat(watPath, source)
  mod.validate()                       // throws on invalid WAT
  const { buffer } = mod.toBinary({})  // Uint8Array of the .wasm bytes
  writeFileSync(outPath, buffer)
}
```

### Pattern 4: Minimal viable pure-TS admission-gate scanner (DET-01/DET-02)

**What:** A section/opcode walker that must distinguish two very different kinds of WASM sections:

1. **Structured record sections** (Import §2, Memory §5, and the rest) — these are simple length-prefixed records with no free-form instruction stream inside them. Parsing them unambiguously with pure TS is straightforward: read the section ID byte, read the LEB128 section size, walk fixed-shape entries.
2. **The Code section (§10)** — a genuine instruction stream. **This is the one place a naive implementation goes wrong.** You cannot `grep` a code section's raw bytes for `0xFD` or `0xFE` and call it a scanner: a byte value `0xFD` can appear as a continuation byte inside an unrelated LEB128-encoded immediate (e.g., part of an `i64.const` argument) with zero relationship to the SIMD prefix. **The scanner must walk instructions with an opcode-length table, consuming each instruction's known-length immediates, or it will produce both false positives (grep sees a stray `0xFD` byte and rejects a clean module) and false negatives (a real relaxed-SIMD instruction is skipped mid-immediate and the walker resyncs past it).** This length-table walk is the one genuinely nontrivial piece of engineering in this phase — budget real implementation and test time for it, not a quick pass.

**Section IDs** [CITED: webassembly.github.io/spec/core/binary/modules.html — WebAssembly 3.0, 2026 edition]:

| ID | Section | Relevant to admission gate? |
|----|---------|------------------------------|
| 0 | custom | no |
| 1 | type | no |
| 2 | **import** | **yes — allow-list check** |
| 3 | function | no |
| 4 | table | no |
| 5 | **memory** | **yes — `initial === maximum`, and shared-memory flag** |
| 6 | global | instruction-stream inside init exprs — same walker needed as §10 |
| 7 | export | no |
| 8 | start | no |
| 9 | element | instruction-stream inside offset exprs |
| 10 | **code** | **yes — the opcode walk (SIMD/atomics)** |
| 11 | data | instruction-stream inside offset exprs |
| 12 | datacount | no |
| 13 | tag | no |

**Import descriptor kind byte** (first byte after module name + field name) [CITED: same spec page]: `0x00` func, `0x01` table, `0x02` memory, `0x03` global, `0x04` tag. The frozen 4-function host ABI allow-list check is: kind `0x00`, and `(module, field)` pair in the allow-list. Anything else — including any `0x02` (imported memory) or `0x03` (imported global), since the frozen ABI is exactly four functions and nothing else — is rejected.

**Memory `limits` encoding** [CITED: webassembly.github.io/spec/core/binary/types.html, cross-checked against the Threads proposal]:

| Flag byte | Meaning |
|-----------|---------|
| `0x00` | `min` only, **not shared** |
| `0x01` | `min` and `max`, **not shared** |
| `0x02` | `min` only, **shared** (threads proposal) |
| `0x03` | `min` and `max`, **shared** (threads proposal) |

DET-01's two memory checks map directly: reject `0x02`/`0x03` outright (shared memory is forbidden regardless of limits), and for `0x00`/`0x01` reject unless the flag is `0x01` **and** `min === max` (this also implicitly rejects `0x00`, which by definition has no declared maximum — i.e. `memory.initial !== memory.maximum` is trivially true whenever no maximum is declared at all).

**Opcode prefixes for the two forbidden instruction families:**

- **Relaxed-SIMD** — prefix byte `0xFD`, followed by a **LEB128-encoded subopcode**. Non-relaxed (deterministic) SIMD instructions occupy the numeric range up to `0xFD` (253 decimal) in the sub-opcode space [CITED: WebAssembly/simd `NewOpcodes.md`]; the relaxed-SIMD proposal's instructions all have sub-opcode values `≥ 0x100` (256 decimal), e.g. `i8x16.relaxed_swizzle = 0x100`, `f32x4.relaxed_madd = 0x105` [CITED: WebAssembly/relaxed-simd `proposals/simd/BinarySIMD.md`]. **Rule: after a `0xFD` prefix, decode the LEB128 subopcode; reject if `subopcode >= 0x100`.**
- **Threads/atomics** — prefix byte `0xFE`, always. Every instruction under this prefix (`memory.atomic.notify`, `atomic.fence`, `i32.atomic.load`, `i32.rmw.cmpxchg`, etc.) is an atomics/threads instruction with no non-atomic sibling [CITED: search of LLVM `BinaryFormat/Wasm.h` and V8 `wasm-opcodes.h` opcode tables]. **Rule: any `0xFE` byte encountered at an instruction boundary is an unconditional rejection** — there is no sub-range to allow.

**Skeleton (illustrative, not complete — the length table for every non-forbidden opcode must still be filled in to walk past them correctly):**
```typescript
// packages/core/src/admission/scan.ts
// Zero platform imports. Runs identically at publish time and pre-instantiation.

type Rejection = { reason: string; byteOffset: number }
type Result<T> = { ok: true; value: T } | { ok: false; rejections: Rejection[] }

const ALLOWED_IMPORTS = new Set([
  'env.log', 'env.abort', 'env.memcpy_bound_check', 'env.trap',
  // exactly the frozen 4-function host ABI — no WASI
])

function scanModule(bytes: Uint8Array): Result<{ features: string[] }> {
  const rejections: Rejection[] = []
  let offset = 8 // past \0asm + version u32
  while (offset < bytes.length) {
    const sectionId = bytes[offset]
    const { value: sectionSize, next } = readLEB128U32(bytes, offset + 1)
    const bodyStart = next
    const bodyEnd = bodyStart + sectionSize

    if (sectionId === 2) scanImportSection(bytes, bodyStart, bodyEnd, rejections)
    if (sectionId === 5) scanMemorySection(bytes, bodyStart, bodyEnd, rejections)
    if (sectionId === 10) scanCodeSection(bytes, bodyStart, bodyEnd, rejections) // the hard part

    offset = bodyEnd
  }
  return rejections.length === 0
    ? { ok: true, value: { features: [] } }
    : { ok: false, rejections }
}
```

### Pattern 5: Canonical-form output hashing (DET-05) — one code path, no reconciliation

**What:** `crypto.subtle` is present, under the identical global name, in every V8-and-non-V8 target this project cares about. Node has exposed the WebCrypto object as `globalThis.crypto` since **Node 19** (stable, no flag) [CITED: nodejs.org/en/blog/announcements/v19-release-announce], and the project's pinned Node 24 LTS carries it forward unchanged. `crypto.subtle.digest` is async in both environments — there is no sync/async reconciliation problem to solve, because both sides of the "isomorphic hashing" question STACK.md's research questions raised are, in fact, already the same object.

```typescript
// packages/core/src/canonical/hash.ts
// Works unmodified in Node 24, Chromium, Firefox, and WebKit — same API object.

async function canonicalHash(fields: CanonicalField[]): Promise<Uint8Array> {
  const bytes = encodeCanonicalForm(fields) // normalize NaN/-0.0/big-endian per-field
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest)
}

function normalizeF32(bits: number): number {
  const isNaN = (bits & 0x7f800000) === 0x7f800000 && (bits & 0x007fffff) !== 0
  if (isNaN) return 0x7fc00000        // single canonical quiet-NaN pattern
  if (bits === 0x80000000) return 0x00000000 // -0.0 -> +0.0
  return bits
}
```

### Pattern 6: GitHub Actions matrix + artifact-diff

```yaml
# .github/workflows/divergence.yml
# TEST workflow only. No deploy step exists in this file or anywhere in the repo.
name: divergence-harness
on:
  push:
  schedule:
    - cron: '0 3 * * *'   # nightly, per locked cadence decision

jobs:
  measure:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-14]   # x86-64, arm64 — verified live labels, 2026-07-24
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7        # verified current tag via GitHub API, 2026-07-24
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
      - run: npm ci
      - run: npx playwright install --with-deps chromium firefox webkit
        # --with-deps installs apt system libs on ubuntu-latest; on macos-14
        # it is effectively a no-op for system deps (Playwright docs: primarily
        # a Linux/Ubuntu concern) but the flag is harmless to pass on both.
      - run: npm run divergence:measure -- --out results-${{ matrix.os }}.json
      - uses: actions/upload-artifact@v7  # verified current tag, 2026-07-24
        with:
          name: divergence-${{ matrix.os }}
          path: results-${{ matrix.os }}.json

  diff:
    needs: measure
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v8  # verified current tag, 2026-07-24
        with:
          path: all-results
      - run: node tools/divergence-harness/diff.js all-results
        # exits non-zero if any probe's canonical hash disagrees across
        # any pair of (os, runtime) legs — including the bit-leak probe
```

The Node-vs-browser split within each OS leg is handled by `npm run divergence:measure`, which is a vitest invocation using the multi-`projects` config (one `environment: 'node'` project, one browser project with `instances: [{browser:'chromium'},{browser:'firefox'},{browser:'webkit'}]` via the `playwright()` provider from `@vitest/browser-playwright`) — so a single CI step per OS produces all four runtime legs' results for that architecture.

### Anti-Patterns to Avoid

- **Grepping the code section for `0xFD`/`0xFE` bytes without an instruction-length walker:** produces both false positives (a LEB128 continuation byte coincidentally matching) and false negatives (resync past a real forbidden opcode after miscounting an immediate's length). See Pattern 4.
- **Hashing raw linear memory:** allocator residue, struct padding, and any NaN payload bits not covered by the declared schema all leak into the hash and get misdiagnosed as platform divergence. DET-05 exists specifically to forbid this — see Pitfall 1 in `.planning/research/PITFALLS.md`.
- **Treating `@webassemblyjs/wasm-parser`'s silence on an opcode as "not present":** a stale parser that doesn't recognize an opcode may skip it rather than flag it, which is the opposite of admission-gate-safe behavior (fail open instead of fail closed).
- **Building the Node-vs-browser split as two separate CI jobs instead of one vitest `projects` config:** doubles the artifact/diff bookkeeping for no benefit — vitest 4.x's `projects` array is designed for exactly this "one test suite, multiple environments" case.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| WAT → wasm compilation | A hand-rolled WAT parser/assembler | `wabt@1.0.39` | WAT's text grammar (S-expressions, folded/unfolded instruction forms, block-type shorthand) is a real parser problem with edge cases; `wabt` is the reference implementation's own toolkit compiled to JS/WASM. |
| SHA-256 digest | A hand-rolled hash function | `crypto.subtle.digest('SHA-256', ...)` | Never hand-roll cryptographic primitives — and there is no need to: the Web Crypto API is already the identical object in Node 24 and every target browser. |
| Full WASM binary decode of the Code section | A complete instruction *decoder* (semantic understanding of every opcode) | A minimal *skip-table* walker that only needs to (a) know each instruction's immediate-length shape well enough to advance past it correctly, and (b) specifically recognize the `0xFD`/`0xFE` prefix bytes and their sub-ranges | A full decoder (types, validation, control-flow graph) is what `binaryen`/`wabt` already do at publish time — DET-01/DET-02's runtime scanner needs far less: enough to walk safely and flag two specific opcode families, not to understand program semantics. Building a full decoder here would re-derive `binaryen` in TypeScript, which the "binaryen everywhere" alternative was explicitly rejected in CONTEXT.md. |
| Benchmark methodology structure | An ad-hoc "here are some numbers" document | The COST-paper-derived structure in §State of the Art | BENCH-02 requires pre-registration precisely because ad-hoc benchmark writeups are how projects retroactively justify whatever number they got. |

**Key insight:** every "don't hand-roll" item above has a *narrower* correct scope than the naive read of the locked decision suggests — the runtime scanner doesn't need a full WASM decoder, and the hashing story doesn't need a Node/browser reconciliation shim at all, because the underlying platforms already agree on the primitive (Web Crypto). The one piece of unavoidable, must-be-hand-built engineering is the instruction-length skip-table for the Code section walk — budget for it accordingly.

## Common Pitfalls

### Pitfall 1: Naive byte-grep of the Code section for `0xFD`/`0xFE`

**What goes wrong:** A byte value `0xFD` or `0xFE` appears inside a multi-byte LEB128 immediate (e.g. a large `i64.const` argument) with no relation to an opcode prefix. A scanner that doesn't track instruction boundaries will both false-positive (reject clean modules) and false-negative (miscount past a real forbidden instruction and resync incorrectly, silently admitting a relaxed-SIMD or atomics op).
**Why it happens:** The temptation to treat "detect forbidden opcodes" as a string-search problem, because it looks like one at a glance.
**How to avoid:** Implement the instruction-length skip-table (Pattern 4) — walk the Code section as an actual instruction stream, consuming each instruction's known immediate shape, and only interpret `0xFD`/`0xFE` as opcodes when they occur at a position the walker has determined is an instruction boundary.
**Warning signs:** The scanner's test suite passes on synthetic single-instruction modules but produces different results on a realistic compiled kernel (AssemblyScript output) with large constants.

### Pitfall 2: Assuming `@webassemblyjs/wasm-parser`'s opcode coverage is current

**What goes wrong:** The package is pure JS and widely used (via webpack), which reads as "battle-tested" — but its last publish predates this research date by roughly two years, and its coverage of the relaxed-SIMD and threads proposals (both of which continued evolving after 2024) was not independently confirmed in this research session.
**Why it happens:** "Used by webpack" is a strong maintenance signal for *webpack's* use case (bundling ordinary compiled modules), which does not require complete or current SIMD/atomics opcode tables — webpack mostly needs imports/exports, not a security-relevant admission gate.
**How to avoid:** If considering this library for the admission gate, first write a test module using confirmed-current relaxed-SIMD and atomics opcodes and confirm the library's AST correctly identifies them, before trusting it for a security-relevant reject decision. Given the schedule risk of that verification work, this research recommends the hand-built minimal scanner instead.
**Warning signs:** Silent success on a test module the scanner *should* reject.

### Pitfall 3: Treating `macos-14` as a permanently stable label

**What goes wrong:** `actions/runner-images` currently lists `macos-14` (arm64) as **deprecated** [VERIFIED: live fetch of `actions/runner-images` README, 2026-07-24] — still available, still functioning, but on a path toward eventual brownout/retirement, following the same pattern already completed for `macos-latest` (which moved to `macos-26` starting mid-2026) [CITED: github.blog changelog, 2026-05-14 and 2026-02-26 posts]. No explicit removal date was found for `macos-14` specifically.
**Why it happens:** GitHub rotates hosted runner images on a roughly annual cadence; a label pinned today for reproducibility can silently stop being offered months later.
**How to avoid:** This does not override the locked platform-matrix decision — `macos-14` remains the correct pin for this phase, since arm64 coverage (not a specific macOS version) is the actual requirement. But the CI workflow should fail loudly (not silently fall back to a different runner) if the label is ever withdrawn, and whoever revisits this phase's CI config later should re-verify the label is still live. Consider a comment in `divergence.yml` linking to the runner-images deprecation table.
**Warning signs:** A GitHub Actions run failing at the "prepare workflow" step with an unrecognized runner label, well after this phase's completion.

### Pitfall 4: Assuming the NaN-bit-leak divergence, if it exists, is fixable by "just canonicalizing harder"

**What goes wrong:** After seeing the bit-leak probe diverge, a natural next instinct is to look for a cleverer canonicalization rule that also covers integers derived from NaN bits. There is no such rule in general — canonicalization operates on the ABI boundary's *declared schema*, and a plain `i32` output field is, by construction, indistinguishable at that boundary from any other legitimately-computed integer.
**Why it happens:** Canonicalization successfully repairs the straightforward float-output probes, which creates false confidence that "more canonicalization" is a general fix.
**How to avoid:** Treat the strict branch criterion exactly as CONTEXT.md specifies: the bit-leak probe's result is binary (matches across the whole matrix, or it doesn't) and is not subject to negotiation or partial credit. This is precisely why the softer "N-version scoped to modules that pass admission" alternative was rejected — the admission gate cannot statically prove a module's control flow is NaN-bit-independent.
**Warning signs:** A design discussion proposing "detect and reject modules that branch on reinterpreted float bits" as a Phase 1 deliverable — that is a static-analysis problem (control-flow taint tracking through `reinterpret` instructions) far outside this phase's scope and likely intractable to do soundly in general.

## Code Examples

Covered inline in §Architecture Patterns above (WAT probes, scanner skeleton, hashing, CI workflow) — all patterns are annotated with their spec/registry source and confidence level at point of use, per this document's citation discipline.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `wat2wasm` npm package for WAT compilation | `wabt` npm package | `wat2wasm` last published 2022-05-24; effectively abandoned | Confirmed via `npm view` — do not use `wat2wasm`. |
| `vitest`/`@vitest/browser` string-based `provider: 'playwright'` config | `@vitest/browser-playwright` package exporting a `playwright()` function | vitest 4.x (confirmed current as of 2026-07-24 docs fetch) | STACK.md's phrasing ("Provider `playwright`") needs correction to the function-import form when this phase's `vitest.config.ts` is written. |
| `macos-latest` implying a fixed macOS version | `macos-latest` now floats to `macos-26`; explicit `macos-14`/`macos-15` labels needed for a stable pin, and `macos-14` itself is now deprecated | Migration announced/rolled out 2026-02 through 2026-06 | Confirms the locked decision to pin `macos-14` explicitly (rather than `macos-latest`) was correct — but see Pitfall 3. |

**Benchmark methodology template (BENCH-02) — from McSherry, Isard & Murray, "Scalability! But at what COST?" (USENIX HotOS 2015)** [CITED: usenix.org/system/files/conference/hotos15/hotos15-paper-mcsherry.pdf — fetch blocked by a 403 in this research session; content below is drawn from the widely-cited summary sources (blog.acolyer.org "the morning paper" summary, and the paper's own well-known abstract/framing) rather than a direct read of the PDF. **Flag as MEDIUM confidence — re-fetch the primary PDF at plan time if the exact wording matters.**]

A pre-registered benchmark methodology document defensible in the same spirit as COST should commit, in writing, before any number exists:
- **The metric itself**, defined precisely enough that it cannot be gamed after the fact (COST's contribution was inventing "Configuration that Outperforms a Single Thread" specifically because raw "speedup vs. N nodes" curves reward systems with high fixed overhead — a system that is 100x slower per-node than optimal can still show a beautiful scaling *curve*. This phase's BENCH-02 doc must pick metrics with the same discipline: e.g., p99 makespan (already locked in REQUIREMENTS.md BENCH-03) rather than mean, and the verification tax included rather than excluded (BENCH-04)).
- **The single-threaded baseline definition** — COST's method was comparing against "a competent single-threaded implementation" on the *same hardware*, not a strawman. For this project, REQUIREMENTS.md's BENCH-05 (COST crossover) inherits this directly: the baseline must be named and justified as competent, not merely present.
- **Machine inventory** — exact hardware/runner specs disclosed, not just "we ran it on a cloud VM."
- **Run counts and statistical treatment** — how many runs, how outliers/warmup are handled, cold vs. warm code-cache policy (directly relevant here since `WebAssembly.compileStreaming`'s code-cache behavior materially affects wall-clock numbers).
- **Redundancy factor and skew profile** — locked per CONTEXT.md as required fields in the pre-registration.

This is a **structure to imitate**, not a document to fetch verbatim — the COST paper's own numbers are about graph-processing systems, wholly unrelated to this project's domain. What transfers is the discipline: name every methodological choice that could bias the eventual headline number, before that number exists.

**Deprecated/outdated:**
- `wasm-metering` (2022) — dead, does not understand SIMD/bulk-memory/reference-types/GC. Already flagged in STACK.md; not relevant to Phase 1 directly (fuel metering is explicitly deferred) but the same staleness pattern applies to any similarly-old WASM tooling package considered for this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `import wabtInit from 'wabt'` works cleanly under Node ESM/TypeScript with `moduleResolution: 'bundler'` (the project's locked tsconfig setting) | Pattern 3 | Low-medium — if the CJS/ESM interop is awkward, the fallback is `createRequire` or a small wrapper; does not change the overall approach, only the exact import line. Verify in Wave 0. |
| A2 | AssemblyScript (`asc`) is an appropriate, sufficiently "realistic" source-compiled kernel for CONTEXT.md's "one realistic source-compiled float kernel" requirement | Standard Stack → Supporting | Medium — this is a Claude's-discretion-level tool choice, not a locked decision; if the eventual plan-checker or user disagrees that AssemblyScript output is "realistic" enough (vs. Rust/C), swapping toolchains is a contained change but adds a CI toolchain install step. |
| A3 | `npx playwright install --with-deps` behaves as a harmless no-op-for-system-deps on `macos-14`, rather than erroring | Pattern 6 / Code Examples | Low — well-established Playwright CI pattern across many public examples, but not independently executed against `macos-14` specifically in this research session. |
| A4 | The COST paper's methodology structure, as summarized via secondary sources (the primary PDF returned HTTP 403 in this session), accurately represents the paper's actual content | State of the Art | Low-medium — the summary is corroborated by multiple independent secondary sources (blog.acolyer.org, MIT course slides which also 403'd, several other summaries), and the paper's core framing ("COST" metric, single-thread baseline) is extremely widely and consistently cited, but no direct primary-source read occurred this session. |

## Open Questions

1. **Does the x86-64 vs. arm64 V8 NaN-sign divergence actually reproduce for these specific probes, in current V8, across Chrome/Firefox/Safari/Node?**
   - What we know: the underlying hardware mechanism (x86 "indefinite" QNaN historically sign=1, ARM Default-NaN mode sign=0) is real and independently documented at the CPU architecture level, and V8 exposes no override flag on either platform (verified via `node --v8-options`, already recorded in STACK.md).
   - What's unclear: whether V8's WASM-to-native codegen path actually surfaces this hardware-level difference unmodified for `f32.sqrt`/`f32.div`/`f32.sub` specifically, on both this project's exact target OSes, and identically across Chrome/Firefox/Safari (three distinct engines for the browser legs — Firefox is SpiderMonkey, Safari is JavaScriptCore, only Chrome is V8; the "V8 has no override flag" finding does not by itself say anything about the other two engines' NaN behavior).
   - Recommendation: this is exactly what the harness measures — do not attempt to answer it via further research. If Firefox/Safari's NaN behavior differs from Chrome's *even on the same architecture*, that is itself an additional, currently unmeasured finding the harness will surface for free, and the verdict document should report it explicitly even though CONTEXT.md's branch criterion is framed around cross-architecture (not cross-engine) divergence.

2. **Exact `wabt` ESM import ergonomics under this project's locked `moduleResolution: 'bundler'` TypeScript config.**
   - What we know: the package's own documentation shows only the CJS `require('wabt')()` form.
   - What's unclear: whether `import wabtInit from 'wabt'` interop works cleanly, or whether a `createRequire`/dynamic-`import()` wrapper is needed.
   - Recommendation: five-minute Wave-0 spike before committing to the build script's shape in the plan.

3. **Whether `playwright@1.62.0` and `@vitest/browser-playwright@4.1.10` are mutually compatible as pinned.**
   - What we know: both versions were independently confirmed live on npm as of this research date.
   - What's unclear: vitest's own compatibility matrix between the browser package and the exact playwright minor version was not cross-checked.
   - Recommendation: re-run `npm view` for both packages and check `@vitest/browser-playwright`'s `peerDependencies` field immediately before locking `package.json`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Entire harness, `@o2/core` build | ✓ (local dev machine) | v23.11.0 (local; CI pins `24`) [VERIFIED: `node --version` in this session] | — |
| `gh` CLI | Verifying GitHub Actions runner labels / action tag versions during research | ✓ | — | — |
| GitHub Actions `ubuntu-latest` runner | DET-04 x86-64 leg | ✓ (hosted, no local dependency) | Ubuntu 24.04 x64 per `actions/runner-images` current labels [VERIFIED: live fetch, 2026-07-24] | — |
| GitHub Actions `macos-14` runner | DET-04 arm64 leg | ✓ but **deprecated label** (see Pitfall 3) | arm64 (Apple Silicon) [VERIFIED: live fetch, 2026-07-24] | If withdrawn before this phase executes: `macos-15` (also arm64, not yet deprecated as of this research date) preserves the architecture requirement — but this would deviate from the locked decision's literal label and should go back through CONTEXT.md, not be silently substituted. |
| `wabt` (npm) | Build-time WAT→wasm compilation | ✓ (installable, pure npm) | `1.0.39` [VERIFIED: npm registry] | — |
| `assemblyscript` (npm) | Realistic compiled kernel | ✓ (installable, pure npm) | `0.28.20` [VERIFIED: npm registry] | Rust/C toolchain if AssemblyScript is rejected as insufficiently "realistic" (see A2) |

**Missing dependencies with no fallback:** None identified — every dependency this phase needs is either already installed locally, hosted by GitHub Actions, or a plain `npm install` away.

**Missing dependencies with fallback:** `macos-14` runner label (see above) — fallback exists but changes a locked decision's literal value and should not be applied without going back through the discuss-phase process if it becomes necessary.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@4.1.10` + `@vitest/browser@4.1.10` + `@vitest/browser-playwright@4.1.10` (none installed yet — this phase creates the project skeleton) |
| Config file | none yet — created in Wave 0 as `vitest.config.ts` with a `projects` array (one `environment: 'node'`, one `browser.instances: [chromium, firefox, webkit]`) |
| Quick run command | `npx vitest run --project node` (fast local iteration on the admission-gate scanner and canonical hasher, which are pure functions with no browser dependency) |
| Full suite command | `npx vitest run` (all projects — node + all three browsers) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| DET-01 | Admission gate rejects relaxed-SIMD, atomics/shared-memory, non-allow-listed imports, and `initial !== maximum` memory, each with correct byte offset | unit | `npx vitest run --project node packages/core/src/admission/scan.test.ts` | ❌ Wave 0 |
| DET-04 | Divergence harness produces byte-identical canonical hashes (or documents where it does not) for every probe across the full OS×runtime matrix | integration (CI-only, not locally reproducible in full) | `.github/workflows/divergence.yml` → `diff` job | ❌ Wave 0 |
| DET-05 | Canonical hash of a declared-schema output is stable regardless of raw memory layout/padding, and NaN/`-0.0` normalize before hashing | unit | `npx vitest run --project node packages/core/src/canonical/hash.test.ts` | ❌ Wave 0 |
| VER-07 | The verdict document's branch selection is a mechanical function of the harness's own diff-job output, not a manually-asserted claim | manual-only (document review) — the *harness* is automated (covered by DET-04's test), but "the verdict correctly reflects the harness output" is a human authorship check on `01-VERDICT.md` | — (manual review at phase gate) | n/a |
| BENCH-02 | The benchmark methodology document exists, is committed, and names every field CONTEXT.md requires (metrics, machine inventory, run counts, cold/warm policy, redundancy factor, skew profile, single-threaded baseline definition) before any benchmark number is published | manual-only (document review / checklist) | — (manual review at phase gate; could be automated as a "does `01-BENCHMARK-METHODOLOGY.md` contain these N required headings" lint if desired, but not required) | n/a |

### Sampling Rate

- **Per task commit:** `npx vitest run --project node` (fast — pure-function unit tests for the scanner and hasher, no browser/CI dependency)
- **Per wave merge:** `npx vitest run` (all projects, local browsers via Playwright) plus a manual push to trigger the actual CI divergence matrix, since the cross-architecture signal is only real on GitHub's hosted runners, not a single developer machine
- **Phase gate:** the CI `divergence.yml` workflow green (or, on the negative branch, a documented, expected failure that the verdict explicitly accounts for) before `01-VERDICT.md` is finalized and `/gsd-verify-work` runs

### Wave 0 Gaps

- [ ] `vitest.config.ts` — multi-project (node + 3 browsers) config, framework install
- [ ] `packages/core/package.json`, `tsconfig.json` (isolatedDeclarations, moduleResolution: bundler, per STACK.md) — the project skeleton itself
- [ ] `packages/core/src/admission/scan.test.ts` — covers DET-01
- [ ] `packages/core/src/canonical/hash.test.ts` — covers DET-05
- [ ] `tools/divergence-harness/probes/*.wat` and `build.ts` — covers DET-04's probe generation
- [ ] `.github/workflows/divergence.yml` — covers DET-04's CI execution (test workflow only, verified no deploy workflow exists anywhere in the repo per the disclosure-hygiene constraint)
- [ ] Wave-0 spike: confirm `wabt` ESM import ergonomics (Assumption A1)

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` → treated as enabled per the framework default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | no | This phase has no identity/auth surface — no product code beyond pure functions and a CI harness. |
| V3 Session Management | no | Same as above. |
| V4 Access Control | no | Same as above. |
| V5 Input Validation | **yes** | The admission-gate scanner is, functionally, an input-validation component for untrusted binary input (a WASM module is attacker-controllable content in the fabric's threat model, even though this phase only feeds it hand-authored/self-compiled probes). Standard control: parse defensively — treat every length/offset read from the binary as untrusted, bounds-check before every array access, and fail closed (reject) on any malformed section rather than throwing an unhandled exception or, worse, reading out of bounds. |
| V6 Cryptography | **yes, narrowly** | SHA-256 via `crypto.subtle` — never hand-roll (see Don't Hand-Roll). SHA-256 is appropriate for a *content-integrity* hash (detecting divergence/tampering in comparison), not for a security boundary requiring collision-resistance guarantees beyond that; no additional cryptographic requirement exists in this phase's scope (no signatures, no key material). |
| V10 Malicious Code / V12 File & Resources | **yes, narrowly** | The admission-gate scanner's job *is* rejecting malicious/nondeterministic constructs before execution — this is this phase's core security function, already covered under DET-01 in the requirements table above, not a separate add-on control. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Malformed/truncated WASM binary causes the pure-TS scanner to read past buffer bounds (e.g., a section size LEB128 claiming a length longer than the remaining buffer) | Denial of Service | Bounds-check every offset read against `bytes.length` before dereferencing; treat any out-of-range read as an immediate rejection (`Result.ok = false`), never a thrown exception that could crash the executor process. |
| A module engineered to look admissible to the fast pure-TS runtime scanner but rejected by the more thorough publish-time `binaryen`/`wabt` pass (or vice versa) | Tampering / Elevation of Privilege | The two scanners (publish-time and runtime) must agree on what they reject — DET-02 exists precisely because a node must not trust that publish-time validation was honestly performed by someone else; both passes need to independently enforce the *same* rule set, and any divergence between them is itself a bug to catch in this phase's own test suite. |
| A relaxed-SIMD or atomics instruction encoded via an unusual-but-valid LEB128 form (e.g. an overlong encoding) evades a scanner that only checks the "canonical" minimal-byte-length encoding | Tampering | The LEB128 reader used by the scanner should decode value correctly regardless of encoding length (the WASM spec technically requires canonical/minimal LEB128 encoding and engines are expected to reject non-minimal forms — but the *admission gate* should not rely on the engine to catch this; decode LEB128 permissively for the purpose of finding forbidden opcodes, even if a non-minimal encoding would separately be invalid per spec). |

## Sources

### Primary (HIGH confidence)
- [WebAssembly Core Spec — Binary Instructions](https://webassembly.github.io/spec/core/binary/instructions.html) — SIMD `0xFD` prefix + LEB128 subopcode encoding, live-fetched 2026-07-24 (WebAssembly 3.0, dated 2026-07-10 edition)
- [WebAssembly Core Spec — Binary Modules](https://webassembly.github.io/spec/core/binary/modules.html) — section ID table, import descriptor kind bytes, live-fetched 2026-07-24
- [WebAssembly Core Spec — Binary Types](https://webassembly.github.io/spec/core/binary/types.html) — `limits`/memtype flag-byte encoding (`0x00`/`0x01`), live-fetched 2026-07-24
- [WebAssembly/relaxed-simd — BinarySIMD.md](https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/simd/BinarySIMD.md) — relaxed-SIMD sub-opcode values (`0x100`, `0x105`, etc.)
- [MDN — reinterpret: Wasm text instruction](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Numeric/reinterpret) — `i32.reinterpret_f32` = opcode `0xBC`, `i64.reinterpret_f64` = `0xBD`
- [WebAssembly/design#477](https://github.com/WebAssembly/design/issues/477) — x86 sign=1 / ARM sign=0 fresh-NaN convention (already cited in `.planning/research/PITFALLS.md`)
- [WebAssembly/design — Nondeterminism.md](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md) — normative nondeterminism source list (already cited in PITFALLS.md/STACK.md)
- npm registry, queried live 2026-07-24: `wabt@1.0.39`, `binaryen@131.0.0`, `assemblyscript@0.28.20`, `wat2wasm@3.0.0` (stale, 2022), `@webassemblyjs/wasm-parser@1.14.1` (stale, 2024), `@vitest/browser-playwright@4.1.10`, `playwright@1.62.0`, `typescript@7.0.2`, `tsdown@0.22.14`, `vitest@4.1.10`
- `gh api` against `actions/runner-images`, `actions/upload-artifact`, `actions/download-artifact`, `actions/setup-node`, `actions/checkout` — live-queried 2026-07-24 for current runner labels and Action tag versions
- [Node.js 19 release announcement](https://nodejs.org/en/blog/announcements/v19-release-announce) — `globalThis.crypto` stable since Node 19

### Secondary (MEDIUM confidence)
- [vitest.dev/guide/browser](https://vitest.dev/guide/browser/) — current `projects`/`browser.instances`/`@vitest/browser-playwright` config shape, fetched 2026-07-24 (page dated dynamically; treated as current documentation, not archival)
- [AssemblyScript/wabt.js README](https://github.com/AssemblyScript/wabt.js/blob/main/README.md) — `parseWat`/`toBinary` API shape (CJS form confirmed; ESM interop unverified — see Assumption A1)
- [actions/runner-images README](https://raw.githubusercontent.com/actions/runner-images/main/README.md) — live-fetched 2026-07-24; `macos-14` listed deprecated
- ARM Architecture Reference Manual (Default NaN handling) and general IEEE-754 QNaN sign-bit documentation — corroborates the x86/ARM fresh-NaN sign convention at the hardware level, independent of the WASM design-issue source
- GitHub issue search (`gh api search/issues`) against `bacalhau-project/bacalhau` — corroborates CONTEXT.md's claim that Bacalhau built and later removed a deterministic-verifier mechanism (issues #958 "Enable deterministic verifier by default", #2672 "Verifier is still alive in python client" suggesting removal from the primary implementation while lingering elsewhere); the specific removal commit itself was not located in this session

### Tertiary (LOW confidence, flagged inline)
- COST paper (McSherry, Isard, Murray, USENIX HotOS 2015) methodology structure — both direct PDF sources attempted in this session returned HTTP 403; content in §State of the Art is drawn from well-established secondary summaries of a widely-cited paper, not a direct primary read this session. Re-fetch at plan time if exact language matters.
- "A Cross-Architecture Evaluation of WebAssembly in the Cloud-Edge Continuum" (search result) — measures WASM performance overhead across x86/ARM/RISC-V, not NaN-divergence correctness; cited only to confirm no published NaN-divergence measurement was found, not as a source of any claim used elsewhere in this document.
- No published measurement of WASM-specific cross-architecture NaN-bit divergence (for any probe resembling this project's) was found anywhere in this research session, despite specific search effort — see §Summary and Open Question 1. This absence is treated as a finding, not a gap in search effort.

## Metadata

**Confidence breakdown:**
- WASM binary format / opcode facts (Standard Stack, Architecture Patterns 1-4): HIGH — primary spec pages fetched live this session, cross-checked against a second independent source class (MDN, LLVM/V8 opcode tables) for the reinterpret and atomics opcodes specifically.
- GitHub Actions runner labels / Action versions: HIGH — verified live via `gh api`, not recalled from training data.
- Tooling version pins (wabt, assemblyscript, playwright, vitest packages): HIGH for the version numbers themselves (live npm registry queries); MEDIUM for exact API ergonomics not independently executed (wabt ESM import — Assumption A1).
- The empirical NaN-divergence question itself: intentionally UNMEASURED — this is Phase 1's own deliverable, not something research could or should pre-answer. What is HIGH confidence is the theoretical mechanism (x86/ARM default-NaN hardware behavior) and the absence of any prior published measurement.
- Benchmark methodology template (BENCH-02): MEDIUM — structure is well-corroborated by secondary sources but the primary COST paper PDF could not be fetched directly this session (two attempts, both 403).

**Research date:** 2026-07-24
**Valid until:** ~14 days for the GitHub Actions runner-label and npm-version findings (fast-moving — GitHub's macOS image migration is actively in progress this quarter); ~90 days for the WASM binary-format/opcode findings (spec-stable, changes only with new W3C proposals reaching Phase 4+).
