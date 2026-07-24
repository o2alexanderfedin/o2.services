# Phase 1: Determinism Gate & Trust-Model Verdict - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 16 decisions across 4 areas, all accepted as proposed

<domain>
## Phase Boundary

This phase decides, from measurement rather than assumption, whether N-version
comparison can carry the project's integrity claim — and commits that decision in
writing before any kernel code is designed around it.

It delivers three things and nothing else:

1. A cross-architecture divergence harness (DET-04) and its raw measured data
2. A canonical-form output comparison function (DET-05) and a module admission
   gate (DET-01), both pure and platform-free
3. A committed written verdict (VER-07) naming the v1 integrity mechanism, plus
   pre-registered benchmark methodology (BENCH-02)

**Explicitly not in this phase:** the node kernel, task dispatch, any transport,
any storage, any scheduler. No product capability ships here. The phase exists to
retire the roadmap's single largest unknown before it can contaminate seven
downstream phases.

**Why it is first:** V8 exposes no NaN-canonicalization and no relaxed-SIMD
control. Per WebAssembly/design#477, x86 sets a freshly-generated NaN's sign bit
to 1 and ARM sets it to 0, so two *honest* nodes can produce different output
hashes and split a verification quorum. If that divergence survives
canonicalization, N-version comparison is not a viable v1 integrity mechanism and
the trust model becomes backbone-anchored audit sampling instead.

</domain>

<decisions>
## Implementation Decisions

### Divergence Harness — Scope & Platform Matrix

- **Platform matrix:** GitHub Actions `ubuntu-latest` (x86-64) and `macos-14`
  (arm64), running Node on both plus Playwright chromium/firefox/webkit on both.
  This is the cheapest route to genuine cross-architecture coverage; local
  two-machine testing and Android/BrowserStack are rejected for v1 as slower to
  reproduce and harder to attach to a commit.
- **Test modules:** hand-written WAT probes *and* one realistic source-compiled
  float kernel. WAT gives exact control over which opcodes execute (NaN
  generation via `sqrt(-1)`, `0.0/0.0`, `inf-inf`; f32/f64 arithmetic); the
  compiled kernel supplies realism. Neither alone is sufficient.
- **NaN-bit-leak probe is required, not deferred:** a module that reinterprets
  NaN bits as `i32` and branches on them, returning an integer. This is the case
  output canonicalization *cannot* repair, and it is what decides whether
  canonicalization is a sufficient fix or merely a partial one.
- **Cadence:** every push plus nightly. `Math.pow`/`exp`/`sin` are
  implementation-defined across engines *and across V8 versions*, so a one-shot
  measurement decays.

### Output Canonicalization & Comparison

- **Output is declared, not inferred:** the task manifest carries an explicit
  output schema (field list + types) and the comparison hashes field-by-field. A
  raw linear-memory hash would report allocator residue and struct padding as
  divergence — false positives that would be misdiagnosed as NaN drift.
- **NaN normalization:** every NaN normalizes to a single canonical quiet-NaN
  pattern at the ABI boundary before hashing. Rejecting NaN-bearing output
  outright was considered and rejected as too restrictive for real float work.
- **Float encoding:** fixed-width IEEE-754 big-endian bytes after normalization.
  Decimal string formatting is rejected — locale and precision behaviour are
  additional divergence vectors.
- **Signed zero:** normalize `-0.0` to `+0.0`. They are numerically equal but
  differ in bits, making signed zero a genuine divergence source.

### Admission Gate

- **Location and timing:** a pure function in `@o2/core` with zero platform
  imports, executed at publish time *and* re-executed by the executor before
  instantiation. DET-02 requires a node never to run a module it did not itself
  validate, so publish-time-only validation is insufficient.
- **Parsing strategy:** a minimal pure-TypeScript section/opcode scanner on the
  runtime path; `binaryen`/`wabt` at publish time only. Binaryen is far too heavy
  to ship into a browser bundle, so "binaryen everywhere" is rejected.
- **Rejection reporting:** a structured `Result<Ok, Rejection[]>` naming the
  offending construct and its byte offset. No exceptions — rejection is an
  expected outcome, not an error condition.
- **Frozen import allow-list:** exactly the four-function host ABI. No WASI —
  WASI supplies the guest a clock, randomness, environment, and filesystem, which
  are four additional nondeterminism vectors precisely where determinism is the
  requirement.

### Verdict & Benchmark Pre-registration

- **Branch criterion (strict):** N-version comparison is viable **if and only if**
  canonical-form hashes are identical across the entire platform matrix for every
  probe module, *including* the NaN-bit-leak case. Any divergence selects
  backbone-anchored audit sampling. The softer alternative — permitting N-version
  scoped to modules that pass admission even when the bit-leak probe diverges —
  was rejected: it would make the integrity guarantee conditional on a property
  the admission gate cannot actually verify.
- **Verdict location:** `01-VERDICT.md` in this phase directory, committed, with
  the raw measurement data attached rather than summarised.
- **Benchmark methodology (BENCH-02) is registered in full** before any number
  exists: metrics, machine inventory, run counts, cold/warm code-cache policy,
  redundancy factor, skew profile, and the single-threaded baseline definition.
  A minimal registration was rejected — the project's external credibility rests
  on these numbers, and post-hoc methodology is how benchmarks inflate.
- **The verdict must name affected phases and REQ-IDs explicitly** under the
  negative branch, so the fallback is actionable rather than a note of concern.

### Claude's Discretion

No areas were delegated — all sixteen questions were answered as proposed.
Implementation detail below the level of these decisions (file layout, test
naming, internal function signatures) remains at implementation discretion,
guided by the repository conventions in `CLAUDE.md`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

None — this is the first code in the repository. Current tracked files are
documentation (`README.md`, `LICENSE`, `LICENSE-COMMERCIAL.md`,
`CONTRIBUTING.md`, `docs/p2p-native-cloud-design.md`), the git hook
(`.githooks/pre-commit`), and `scripts/install-hooks.sh`.

### Established Patterns

- **Git flow with protected branches** — `main` and `develop` reject direct
  commits via `.githooks/pre-commit`; all work happens on `feature/*` branches.
  Hooks are tracked in `.githooks/` and wired via `core.hooksPath` so they
  survive cloning.
- **No outside contributions** — sole authorship is a licensing constraint
  (`CONTRIBUTING.md`), so no CLA or contributor tooling is needed.
- **Stack decisions are already made** in `.planning/research/STACK.md` and are
  binding: TypeScript 7.0.2 with `isolatedDeclarations: true`, `tsdown` (not
  `tsup`, which is unmaintained), `vitest` + `@vitest/browser`, `playwright`.
  ESM only. Exact version pins with no `^` on anything libp2p-adjacent.

### Integration Points

- `@o2/core` does not exist yet; this phase creates it and establishes the
  package boundary. The admission gate and canonical comparison are its first
  exports, and both must remain free of platform imports — that constraint is
  what later lets the same kernel run in Node, browser, and a worker.
- A CI workflow under `.github/workflows/` is created here for the divergence
  matrix. **It is a test workflow only.** Repository disclosure hygiene is an
  invariant from this phase onward: no deploy workflow file exists at all — not
  disabled, absent — and every `package.json` carries `"private": true`.

</code_context>

<specifics>
## Specific Ideas

- The NaN-bit-leak probe is the load-bearing test. Canonicalization at the ABI
  boundary repairs NaN divergence in *declared float fields*; it cannot repair a
  module whose control flow depends on NaN bit patterns, because divergence has
  already propagated into non-float output by the time the boundary is reached.
  The verdict hinges on this case more than on the straightforward float probes.
- Evidence anchors for the phase: WebAssembly/design#477 (x86 sign bit 1, ARM 0),
  `WebAssembly/design/Nondeterminism.md` (relaxed-SIMD and threads as documented
  nondeterminism sources), and the Wasmtime deterministic-execution guide, whose
  `cranelift_nan_canonicalization` and `wasm_relaxed_simd(false)` knobs have no
  V8 counterpart. That absence is why determinism must become a property of the
  published artifact rather than a runtime configuration.
- Bacalhau built exactly this mechanism and then deleted it — no `verifier` in
  `pkg/` today, all 14 verifier issues closed. Reading the removal commit before
  locking the design is worthwhile; the tax is the likely reason, and this
  project keeps verification only because its Core Value asserts it.

</specifics>

<deferred>
## Deferred Ideas

- **Android and mobile-browser coverage** via BrowserStack — mobile arm64 is a
  real target but adds a paid dependency; the macOS arm64 runner already supplies
  cross-architecture signal.
- **WASM fuel/gas metering** — no maintained JS-side instrumentation tool exists
  (`wasm-metering` died in 2022). Phase 1 does not need it; the build-vs-accept-
  Worker-timeout decision belongs to the kernel phase.
- **The negative-branch design itself** — if the verdict selects audit sampling,
  designing that mechanism is downstream work, not this phase. Phase 1 names the
  affected phases; it does not redesign them.

</deferred>
