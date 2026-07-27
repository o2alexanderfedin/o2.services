---
phase: 10
name: elfconv AOT Native→WASM Pipeline
written: 2026-07-27
reconstructed: true
---

# Phase 10 — Context

**This document was written after the phase, not before it.** Phase 10 ran as a
parallel track alongside Phase 9 and its decisions were made against real artifacts
rather than in a planning conversation. Recording them as a reconstruction is honest;
presenting them as foresight would not be, and the roadmap's own note already says the
research questions were "unverified against real artifacts" — which is exactly why the
answers had to come from running the toolchain.

## What this phase is for

The fabric executes WASM. Almost all existing compute is not WASM. Phase 10 asks
whether a statically-linked AArch64 native binary can become a first-class fabric
artifact — sharded, replicated, compared and costed by the same machinery as a
source-compiled module — without the native path acquiring any privilege the source
path lacks.

## Decisions, and what forced each one

### Never trust elfconv's exit code

The single most consequential finding. elfconv exits `0` on a hello-world it could not
fully translate, prints six INFO lines, and leaves real SVE instructions inside glibc's
`__memcpy_a64fx` untranslated — 174 addresses on the smallest input available. A driver
that believed the exit code would cache an artifact that aborts at runtime under a name
asserting it is fine.

So the driver measures rather than asks: it greps the produced module for the abort
call sites *and* recovers the addresses, and requires the two counts to agree before
calling the measurement evidence. The verdict is a third value — `reservations` —
between clean and failed, and it maps to exit code `2` so a build script checking only
for zero cannot read "translated, but 174 addresses will abort" as success.

### The pre-screen predicts a toolchain, not an answer

The project deleted 1,214 lines of static determinism analysis on the principle that
divergence is *detected* by byte comparison, never predicted. The ELF pre-screen looks
like a relapse and is not: being wrong costs a failed build, not a wrong answer. It
refuses inputs elfconv cannot consume — wrong architecture, dynamically linked,
stripped of both symbols and unwind tables — with a named reason carrying the evidence.

That distinction is a standing constraint, not a one-time argument. If the screen ever
starts predicting anything about *results*, it has drifted.

### A recorded project assumption was wrong

`CLAUDE.md` recorded that elfconv requires unstripped binaries. It does not. A binary
with no `.symtab` at all lifts fine, because the loader recovers function entries from
`.eh_frame` through libdwarf. The refusal is the *conjunction* — stripped **and** no
unwind tables — and `ElfFacts` reports `stripped` on accepted inputs too, because
"lifted from a stripped binary" is worth knowing later when an artifact behaves oddly.

### Same-host reproducibility is not reproducibility

Two lifts of the same bytes, minutes apart, on this machine, are byte-identical. That
is the floor: a toolchain that cannot agree with itself cannot be reproducible at all.
It is not evidence about a second machine, and elfconv's virtual-register promotion
iterates a pointer-keyed `std::unordered_map` and a `std::set<BBBag*>`, whose order is
an address-space property. The artifact therefore carries a structural blind spot that
no configuration removes, rather than leaving a reader to infer more than was measured.

### The WASI bridge is a pinning problem, not a compatibility problem

A translated artifact exports `_start` and imports 23 WASI functions; the fabric's ABI
is four `o2.*` imports and `run`. Bridging them is mechanical. What is not mechanical is
that ten of those 23 reach the platform — wall clock, entropy, a busy-wait on the wall
clock, a yield, a raised signal, four socket calls — and every one is a divergence
source. They are replaced wholesale with a pinned surface: a fixed epoch, a monotonic
clock that does not advance, entropy seeded from the task, and named refusals.

**No allow-list.** `WebAssembly.instantiate` already refuses any import the host does
not supply, and names it. The pinned surface is a *replacement*, not a filter.

### AOT-05's answer was allowed to be "no"

Criterion 4 asks that a second visit "measurably hits the V8 code cache". It does not.
The measurement is instrumented, controlled and published as a negative rather than
deferred as a pending checkbox — see the verification document. A criterion that can
only be reported as met is not a measurement.

## Constraints carried in

- `TARGET=aarch64-wasi32`, never the Emscripten bundle, which emits JS glue and splits
  the ABI
- No `-pthread` in any edge artifact
- The container image is pinned by digest, never by tag, and a locally re-tagged image
  is refused rather than hashed into a cache key under a name that is not its own
- The driver does not pull 6 GB unasked; a missing image is a named failure
