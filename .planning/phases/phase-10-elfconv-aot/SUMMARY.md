---
phase: 10
name: elfconv AOT Native→WASM Pipeline
status: partial
criteria_met: 3
criteria_total: 4
completed: 2026-07-27
---

# Phase 10 — elfconv AOT Native→WASM Pipeline

**A statically-linked AArch64 binary is now a fabric artifact.** It is lifted by a
driver that refuses to believe its toolchain, named by a key that covers everything
capable of changing it, and executed by the same `submitJob` that runs a
source-compiled module — which cannot tell the two apart, and is not told.

3 of 4 criteria. The fourth is a measured negative about V8, not unfinished work.

## The finding this phase exists for

**elfconv exits 0 on a binary it could not translate.**

On the smallest input available — `printf("hello\n")`, statically linked — it prints
six INFO lines, exits successfully, and leaves **174 addresses over 259 call sites**
untranslated inside glibc's SVE `__memcpy_a64fx`. Nothing on stdout or stderr says so.

A pipeline that trusted that exit code would cache an artifact which aborts at runtime,
under a name asserting it is fine, and the failure would surface as a fabric bug in
somebody else's job weeks later.

So the driver measures the produced module rather than asking the toolchain how it
went. It greps for the abort call sites, recovers the addresses, and requires the two
counts to agree before calling the measurement evidence — a single grep that stopped
matching would otherwise report zero and look like good news. The verdict is a third
value between clean and failed:

```
aarch64-wasi32 · 5654531 bytes · 93.6s · RESERVATIONS      exit 2
```

**Exit 2, not 0**, because a build script checking only for zero would otherwise read
"translated, but 174 addresses abort if reached" as success — the exact mistake this
driver exists to stop elfconv making.

And the driver does not decide whether that matters. Much of what goes untranslated in
a static glibc binary is an ifunc variant for a CPU this deployment may never present.
It says so, in the artifact and on the terminal, because *neither* reading nor ignoring
those findings is safe by default.

## What was built

| Piece | What it does |
|---|---|
| `packages/aot/src/elf.ts` | The pre-screen. Named refusals carrying their evidence; 45 tests, **25/26 mutations caught** |
| `packages/aot/src/cache-key.ts` | A translation named by input, target, toolchain and features; an empty toolchain refused rather than hashed |
| `packages/aot/src/wasi-executor.ts` | The bridge: `_start` + 23 WASI imports on one side, the fabric's `Executor` on the other, with ten platform-reaching functions replaced |
| `packages/aot/src/wasi-real.node.test.ts` | The same bridge against an artifact elfconv actually produced |
| `tools/aot/` | The lift driver, the toolchain-output scanner, the feature reader, and the CLI |
| `packages/browser/src/streaming-load.ts` | `compileStreaming` against a stable CID URL, verified against the CID before compiling |

## Decisions

**Never trust the exit code.** Above. It is the phase.

**The pre-screen predicts a toolchain, not an answer.** This project deleted 1,214
lines of static determinism analysis on the principle that divergence is *detected*,
never predicted. The ELF screen looks like a relapse and is not: it predicts whether
elfconv can consume an input, so being wrong costs a failed build rather than a wrong
result. If it ever starts predicting anything about *results*, it has drifted.

**A recorded assumption was wrong.** `CLAUDE.md` said elfconv needs unstripped
binaries. It does not — a binary with no `.symtab` lifts fine, because the loader
recovers function entries from `.eh_frame` through libdwarf. The refusal is the
*conjunction* of stripped **and** no unwind tables, and `stripped` is reported on
accepted inputs too, because "lifted from a stripped binary" is worth knowing later
when an artifact behaves oddly.

**Same-host reproducibility is not reproducibility.** Two lifts here are byte-identical.
That is the floor — a toolchain that cannot agree with itself cannot be reproducible at
all — and it is not evidence about a second machine. elfconv promotes virtual registers
by iterating a pointer-keyed `std::unordered_map` and a `std::set<BBBag*>`, whose order
is an address-space property. The blind spot is structural: no configuration removes it,
and the CLI prints it next to the success.

**The image is pinned by digest, never by tag** — and a locally re-tagged image is
refused rather than hashed under a name that is not its own. Lifting with a foreign
digest would run an unknown toolchain under a trusted name *and record it in the cache
key as the trusted one*.

**No allow-list for host imports.** `WebAssembly.instantiate` already refuses any
import the host does not supply, and names it. The pinned WASI surface is a
*replacement*, not a filter.

**AOT-05's answer was allowed to be "no".** See below.

## What the real artifact taught us

Every execution-side test used hand-written WASI fixtures — written from the same
understanding as the executor, which is the shape of nearly every defect this project
has recorded. The premise about translated output was an assumption stated in three
comments. The only use of a real artifact anywhere in the tree was a *negative*, proving
`screenElf` refuses a `.wasm`.

Pointing the executor at `/tmp/ecvout/r1/hello.wasm` confirmed the ABI exactly — 23
WASI imports, `_start` and `memory`, every import answered by the pinned surface — and
turned up something the fixtures could not have:

**A `printf("hello\n")` imports `clock_time_get` and `poll_oneoff`.** glibc's stdio
pulls them in whether the program asks or not. Pinning the clock is load-bearing on the
very first task anyone runs — two nodes on the unpinned shim would read two different
wall clocks immediately.

The run ends in `not-dag-cbor`: the module instantiated, `_start` ran to completion,
and it wrote ASCII where the fabric's codec wants DAG-CBOR. That is the codec working.
The test discriminates rather than merely accepting a failure — refusing `fd_write`
moves the outcome off `not-dag-cbor` and fails it.

## The code cache does not happen

```
| visit | Code Cache/wasm | Code Cache/js |
| 1     | 72B             | 8545B         |
| 2     | 72B             | 2078297B      |
| 3     | 72B             | 2078297B      |
```

At ~4.8 MB, `application/wasm`, cacheable, query-free CID URL, `compileStreaming`, hot
enough to tier up: **no WASM code-cache entry on any visit.**

Two controls make that a reading rather than a broken instrument. The same profile
grows 2 MB of *JavaScript* code cache over the same visits. And relaunching with
`--v8-cache-options=none` makes `Code Cache/js` read 72B — the same number
`Code Cache/wasm` reads always. 72B is what a disabled cache looks like here.

Five limitations are published beside it, including the two that would be most
convenient to omit: the compile timings *do* fall across visits, because of the HTTP
cache and a warm JIT rather than the code cache; and a synthetic module stands in for a
translated artifact.

This is reported unmet rather than reworded. The one deployment property the browser
tier was counting on does not currently hold for WebAssembly at this size on this
platform, and that is worth more written down than quietly satisfied.

## Reviewers, and the two findings that were real

Three adversarial lenses over the phase produced 27 findings, ~46 mutations. Most were
fixed during the phase. Of the five that outlived it, three turned out already fixed on
re-check — verified against the tree rather than trusted, because a handoff written
mid-flight is a claim like any other. Two were real:

**A NUL byte was an exemption nobody registered.** `wasi-executor.test.ts` carried six
raw NUL bytes — argv terminators typed literally — and the repository-wide vocabulary
guard skips any file containing a NUL, because that is the cheap test for "this is a
binary". The whole file had silently left the guard's jurisdiction, with no entry in
`EXEMPT_PATHS` and nothing for a reviewer to audit. The guard's own planted violations
kept passing, because they scan synthetic content rather than the tree — so it reported
itself healthy throughout.

The skip is now a **declaration** rather than an inference. A NUL inside a declared
binary extension is a binary; a NUL anywhere else fails by name.

**Identity is not behaviour.** `PINNED_WASI_FUNCTIONS` was checked only for
`pinned[name] !== shim[name]`, which is satisfied exactly by a replacement returning the
*wrong value* — `undefined` from a socket call coerces to `0` at the ABI, which is
ERRNO_SUCCESS, "your socket is connected". And `WASI_ENV` was asserted only as a
constant, which proves the constant says what it says. `wasi-env.wasm` had been written
for precisely that gap and no test used it: an agent built the fixture and stopped.

Both now check behaviour through the guest's own `environ_get`. Six mutations, six
caught — including handing the guest no environment at all, which nothing in the
repository could previously see.

## Numbers

```
tests         1669 across 111 files
tsc --noEmit  clean
mutations     25/26 (elf) · 6/6 (pinned surface) · 2/2 (real artifact) · 2/2 (NUL guard)
real lifts    2 containers, 93.6s each, byte-identical output
artifact      5,654,531 bytes · aarch64-wasi32 · bulk-memory, mutable-globals, sign-ext
```

## Open

- **Cross-machine reproducibility** — needs a second machine. Same dependency as
  BENCH-06. Until then the blind spot travels with every artifact.
- **A guest that speaks the output codec.** A hello-world cannot produce a fabric
  result. Establishing that a *translated* artifact yields a verified result end to end
  needs a binary compiled against the fabric's output convention.
- **The code-cache negative** should be re-run against an `https` origin and a
  non-automated Chromium before it is treated as settled about V8 rather than about
  this harness.
