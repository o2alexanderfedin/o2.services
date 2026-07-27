---
status: partial
phase: 10
verified: 2026-07-27
criteria_met: 3
criteria_total: 4
---

# Phase 10 — Verification

Goal-backward: does the codebase deliver what the phase promised, criterion by
criterion, checked against something that was run rather than against an intention.

Everything below marked MET was executed on this host on 2026-07-27 against
`ghcr.io/yomaytk/elfconv@sha256:22a404f3…`, a real 6.08 GB image, producing real
5.6 MB artifacts. The one criterion marked NOT MET was measured and the measurement
says no.

## 1. A statically-linked, unstripped AArch64 binary translates to a `.wasm` artifact through the containerized elfconv toolchain, and an unsupported binary is refused by a compatibility checker with a named reason rather than producing a silently wrong artifact

**MET**, both halves, and the second half found the more interesting result.

**The translation.** `npm run aot:lift -- /tmp/ecvout/elf/hello_static` — the command a
person types, run to completion for the first time:

```
input accepted by the pre-screen
image ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f…
lifting — expect a minute or two
aarch64-wasi32 · 5654531 bytes · 93.6s · RESERVATIONS
needs bulk-memory mutable-globals sign-ext
not translated, silently: 174 addresses over 259 call sites — 0x417ad4 0x417ad8 …
written to /tmp/ecvout/cli-hello.wasm
exit 2
```

`tools/aot/lift.node.test.ts` runs the same path twice under Docker; all 7 gated tests
executed (86 tests, 192s, no skips).

**"Rather than producing a silently wrong artifact" is where the work is.** elfconv
**exits 0** on that input. It prints six INFO lines and says nothing about the 174
addresses of glibc SVE it could not translate. A driver that trusted the exit code
would have cached an artifact that aborts at runtime under a name asserting it is
clean. So the driver measures the produced module directly — call sites *and* recovered
addresses, the two greps required to agree before the count is called evidence — and
reports a third verdict, `reservations`, mapped to **exit code 2** so a build script
checking only for zero cannot read this as success.

**The refusals.** `screenElf` refuses by name with the evidence attached:
`not-an-elf`, `not-64-bit`, `not-little-endian`, `not-aarch64`, `dynamically-linked`,
`stripped-without-unwind-tables`, `truncated`. 45 synthetic tests plus
`elf.real.node.test.ts` against binaries GNU ld actually produced. **25 of 26 mutations
caught.** Exhaustiveness is a mapped type over `ElfRefusal['kind']`, so adding a variant
and forgetting the test is a compile error rather than a silent gap.

**A recorded project assumption was wrong and is now corrected.** `CLAUDE.md` said
elfconv needs unstripped input. It does not — a binary with no `.symtab` lifts fine,
because the loader recovers function entries from `.eh_frame` via libdwarf. The refusal
is the *conjunction*, and `hello_static_stripped` is accepted.

## 2. Translating the same input twice on different machines yields an identical CID, and the cache key demonstrably covers input digest, toolchain versions, target, and WASM feature set — changing any one of them changes the CID

**PARTIALLY MET — and the unmet half is stated as unmeasured, never as passing.**

**The cache key: MET.** `cache-key.ts` names a translation by input digest, target,
toolchain versions and required features. `cache-key.test.ts` pins a hardcoded
conformance vector —
`bafyreianou4wfzeubaqi7inz6fwuhxfrp7x3qhefrjznzasqiqs6nm34pe` — so the whole hashed
record cannot drift while every relative assertion stays green. That literal exists
because a reviewer caught the file having only relative assertions, which is the
project's own recorded anti-pattern. Feature order and duplicates normalise; an empty
toolchain is refused rather than hashed.

The real lift confirms the key is built from things that actually vary: `clang 16.0.6`,
`elfconv-commit 5319dd8f`, `wasi-sdk 24.0`, `wasmedge 0.17.0`, and the image **by
digest** — `resolveImage` refuses a locally re-tagged image rather than hashing a
foreign digest under a trusted name.

**"On different machines": NOT MEASURED.** Two lifts on *this* host, minutes apart, are
byte-identical — `two.bytes` equals `one.bytes`, same `inputDigest`, same toolchain,
same features. That is the floor, not the claim. elfconv's virtual-register promotion
iterates a pointer-keyed `std::unordered_map` and a `std::set<BBBag*>`, whose order is
an address-space property. Every artifact therefore carries `CROSS_MACHINE_BLIND_SPOT`
structurally — no configuration removes it — and the CLI prints it:

> *two lifts on one host produced byte-identical artifacts; two lifts on two hosts have
> never been compared*

Closing this needs a second machine. It is the same hardware dependency as BENCH-06.

## 3. A translated artifact carries the same signed `key → CID` mapping and is verified by the same redundant-execution path as a source-compiled module

**MET**, and this criterion got the evidence it was missing today.

`admission.test.ts` enters through `@o2/aot` — the barrel, the way any other package
would — and runs the same logical job twice, once in each ABI: `wasi-echo` (`_start`,
23 WASI imports) and `MODULE_ECHOES_INPUT` (`run`, four `o2.*` imports). Both are the
identity function, so input CIDs, result CIDs, fuel totals and the verification
multiplier are all forced to agree unless something on the path treats them
differently. And the converse: every executor records the `Task` it was handed, and the
two ledgers must match field for field, so a `submitJob` that fed the two kinds
different work and got lucky would still fail.

**What was missing until today.** Every execution-side test used *hand-written* WASI
fixtures, written from the same understanding as the executor — the shape of nearly
every defect this project has recorded. The design's central premise about translated
output was an assumption stated in three comments. `wasi-real.node.test.ts` now checks
it against a real artifact:

- the import surface is **exactly** `wasi_snapshot_preview1` × 23, listed by name
- exports are **exactly** `_start` and `memory`
- **every** declared import is answered by the pinned surface — none goes unanswered
- a `printf("hello\n")` reaches for **`clock_time_get` and `poll_oneoff`**: glibc's
  stdio pulls them in whether the program asks or not, so pinning is load-bearing on
  the very first task anyone runs, not theoretical
- the executor **instantiates it, runs `_start` to completion, and it writes bytes** —
  the run ends `not-dag-cbor`, because "Hello, World!" is ASCII and the fabric's codec
  is DAG-CBOR. That is the codec working, not the bridge failing, and the test
  discriminates: refusing `fd_write` moves the outcome off `not-dag-cbor` and fails it.

Two mutations planted here, two caught.

**Honest limit:** a hello-world cannot *produce* a fabric result, because it does not
speak the output codec. Doing that needs a guest compiled against the fabric's
convention, which is beyond what AOT-04 asks. What is established is that the ABI fits
real output and every import is satisfied.

## 4. A browser loads a translated artifact via `compileStreaming` against a stable gateway URL, and a second visit measurably hits the V8 code cache

**NOT MET.** Measured, controlled, and published as a negative.

The loading half is done: `streaming-load.ts` uses `compileStreaming` against a stable
CID URL, verifies the artifact against its CID before compiling, and refuses a URL
carrying a query string — the V8 code cache is keyed on the URL, so a query parameter
makes every visit a miss by construction.

The cache half does not happen:

```
| visit | raw compile | loader compile | Code Cache/wasm | Code Cache/js |
| 1     | 21.7ms      | 20.2ms         | 72B             | 8545B         |
| 2     | 10.4ms      | 11.7ms         | 72B             | 2078297B      |
| 3     | 10.3ms      | 10.1ms         | 72B             | 2078297B      |
```

At ~4.8 MB, `application/wasm`, cacheable response, query-free URL,
`compileStreaming`, module executed hot enough to tier up: **no WASM code-cache entry
on any visit.** No cache trace events either.

Two controls make that a reading rather than a broken instrument. The *same profile*
grows a 2 MB **JavaScript** code cache over the same visits — so the profile, the
origin and the harness all work. And a calibration run with `--v8-cache-options=none`
makes `Code Cache/js` read **72B** — the same number `Code Cache/wasm` reads on every
ordinary run. 72B is what a disabled code cache looks like on this platform.

Five limitations are published with it rather than dropped: automation-driven Chromium
with a fresh temporary profile (neither isolated as a cause); a loopback `http` origin
rather than the `https` gateway a deployment would use; the compile timings fall across
visits because of the HTTP cache and a warm JIT, *not* the code cache; whether
`Response.clone()` preserves a hit is unknown because no entry was ever produced to
consume; and a synthetic module stands in for a translated artifact.

`CODE_CACHE_ROWS` is a closed list, and each row must be accounted for **exactly once**
as either a reading or a blind spot — a row that quietly left both lists is the failure
that structure exists to prevent.

**This criterion is reported unmet rather than reworded.** A criterion that can only be
reported as met is not a measurement, and the negative is a real finding about V8: the
one deployment property the browser tier was counting on does not currently hold for
WebAssembly at this size on this platform.

## Summary

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Lift + named refusal | **MET** — real lift, exit 2, 174 addresses named |
| 2 | Cache key + cross-machine CID | **PARTIAL** — key MET with a pinned vector; cross-machine unmeasured, blind spot structural |
| 3 | Same admission and verification path | **MET** — through the barrel, and now against a real artifact |
| 4 | `compileStreaming` + code-cache hit | **NOT MET** — measured negative with two controls |

3 of 4. Criterion 2's remainder needs a second machine; criterion 4's answer is a
finding, not a gap in the work.
