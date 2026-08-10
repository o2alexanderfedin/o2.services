---
phase: 26-elfconv-compiled-to-wasm
plan: 1
subsystem: aot
tags: [wasi, preview1, wasi-sdk, wasm32-wasi, container-harness, digest-pin, measurement]
dependency-graph:
  requires: []
  provides:
    - tools/aot/wasi-preview1-surface.sh (digest-pinned container harness; emits
      surface.json, provided.txt, smoke.wasm, nm-raw.txt, nm-err.txt, smoke.cc,
      smoke.log, clang-version.txt, target-triple.txt into /out; exit codes 0/30/31/32)
    - tools/aot/wasi-preview1-surface.node.test.ts (instrument-alive gate, the
      39-row recorded-vs-live probe table, and the shim execution of smoke.wasm)
    - "the measured `provided` set Plan 26-02's gate subtracts from: 3963 unique
      global symbols over 19 archives of the wasm32-wasi sysroot"
  affects:
    - Plan 26-02 (runs the elflift gate against this pinned toolchain and this
      provided set, without re-deriving either)
    - Plan 26-03 (marks AOTW-01/02/03; each is named in a running test title here,
      which acceptance-traceability.node.test.ts requires before an [x] can land)
tech-stack:
  added: []
  patterns:
    - container harness piped on stdin with no /repo mount, so it cannot dirty the
      tree that discover-arm/bench-attestation snapshot around themselves
    - instrument-alive-before-absence — a control group asserted present, in source
      order, before any case reads a symbol as absent
    - recorded table checked element-wise against the live reading, so a doc that
      drifts goes red rather than rots (the shape elfconv-differential.node.test.ts
      uses for its build-actually-happened first case)
key-files:
  created:
    - tools/aot/wasi-preview1-surface.sh
    - tools/aot/wasi-preview1-surface.node.test.ts
  modified:
    - vitest.config.ts
decisions:
  - "`docker run` needs `-i` and the plan's verify command omitted it. Without `-i`
    the container's stdin is /dev/null, `bash /dev/stdin` reads an empty script, and
    docker exits 0 having done nothing — observed on the first run. Fixed as a Rule 3
    blocking issue and recorded in the spec's beforeAll comment, because it is the
    exact failure mode the rest of the file exists to refuse."
  - "`present` in provided.txt means LINKABLE against the preview1 sysroot, not
    linked by default and not working. The scan reads all 19 archives including the
    opt-in libdl.a / libsetjmp.a / libwasi-emulated-signal.a, several of which are
    stubs. Stated in three places (harness docblock, spec docblock, this summary)
    because a gate reading it as 'works' would draw the wrong conclusion."
  - "setjmp/longjmp read absent as symbols and are NOT absent as a feature —
    wasi-sdk-24 lowers them through the compiler's SjLj path and the archives define
    __wasm_setjmp / __wasm_setjmp_test / __wasm_longjmp / __c_longjmp instead, all
    four measured present. Recorded as a qualification on the row rather than left as
    a bare false, which would have misinformed Plan 26-02."
  - "The spec's providedCount floor is 3000, sited against per-archive readings taken
    in the same image: libc.a alone is 1196, so the harness's own 1000 floor would
    pass a scan that reached only libc. 3000 distinguishes 'scanned the sysroot' from
    'scanned part of it', which is the drift the harness floor structurally cannot see."
  - "NODE_MEASUREMENT.unitTests / unitWallClockMs were also updated (1697 -> 1812,
    23 340 -> 22 520). Not required by the plan's six re-site steps, but the
    unitFiles docblock this plan wrote claims a direct cross-check was taken, and a
    green `npm run test:unit` was taken — leaving the neighbouring fields at another
    run's reading would have made that claim false."
metrics:
  duration: "~13 minutes wall time (single commit b72559f, 2026-08-10T03:15 to 03:27 -07:00)"
  completed: 2026-08-10
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 26 Plan 1: The preview1 surface, measured — and the module actually run Summary

A digest-pinned container harness that reads what WASI preview1 supplies out of the
sysroot's own archives (3963 symbols over 19 archives), and a Node spec that checks its
instrument is alive before believing any absence and then **executes** the wasm32-wasi
module the container produced under `@bjorn3/browser_wasi_shim`, asserting the bytes it
wrote rather than the compiler's exit code.

## What Was Built

### `tools/aot/wasi-preview1-surface.sh` (211 lines, mode 100755)

Runs inside `ghcr.io/yomaytk/elfconv@sha256:22a404f3…f19c05` with `/out` bind-mounted and
**nothing else** — no `/repo`, deliberately, so a harness bug cannot dirty the working tree
that `discover-arm.node.test.ts` and `bench-attestation.node.test.ts` snapshot
`git status --porcelain` around. Since it is not in the image and there is no repo mount,
it arrives on the container's stdin.

It follows all four of `elfconv-differential.sh`'s paid-for rules — delete before building,
read the exit code with no pipe on the same line, abort rather than report, publish a
digest — and adds a fifth that this harness specifically needs: **an absence and a broken
instrument must not produce the same output.**

| Exit | Meaning |
|---|---|
| 0 | report written |
| 30 | no wasi-sdk under `/root`, or `clang++` not executable |
| 31 | `llvm-nm` non-zero, or fewer than 1000 symbols read |
| 32 | smoke compile non-zero, or produced no artifact |

Every exit code in the file is captured on the line immediately following its command with
no pipe on that line: `CLANG_VERSION_EXIT`, `TRIPLE_EXIT`, `NM_EXIT`, `FOUND`, `SMOKE_EXIT`.
The `awk` filter that turns nm output into `provided.txt` is a **separate step after**
`NM_EXIT` is captured, which is the whole point of the rule.

### `tools/aot/wasi-preview1-surface.node.test.ts` (454 lines, 6 cases)

Six cases, in an order that matters:

1. **AOTW-01** — the report names the pinned image's own wasi-sdk, not a host toolchain.
2. **AOTW-03** — the instrument is alive: `nmExit === 0`, `providedCount > 3000`,
   `providedCount === wc -l provided.txt`, and all five control symbols present.
3. **AOTW-03** — the recorded 39-row probe table equals the live reading, element-wise.
4. **AOTW-03** — no process, socket, thread or unwinding symbol is present.
5. **AOTW-02** — the produced module declares exactly `_start` and `memory`, and imports
   only from `wasi_snapshot_preview1`.
6. **AOTW-02** — the module **runs** under the shim and writes `O2 preview1 smoke ok\n`.

Case 4 reads absences and it is deliberately after case 2, which is what makes those
absences believable.

### `vitest.config.ts` — the `NODE_MEASUREMENT` re-site

## What Was Measured

### The toolchain (AOTW-01)

| Field | Reading |
|---|---|
| image | `ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05` |
| `wasiSdkPath` | `/root/wasi-sdk-24.0-arm64-linux` |
| `clangVersion` | `clang version 18.1.2-wasi-sdk (https://github.com/llvm/llvm-project 26a1d6601d727a96f4301d0d8647b5a42760ae0c)` |
| `targetTriple` | `wasm32-unknown-wasi` |
| `sysroots` | `wasm32-wasi`, `wasm32-wasi-threads`, `wasm32-wasip1`, `wasm32-wasip1-threads`, `wasm32-wasip2` |
| `libDir` | `…/share/wasi-sysroot/lib/wasm32-wasi` |
| `archiveCount` | 19 |

Zero bytes downloaded. The 108 MB host-side `wasi-sdk-24.0-arm64-macos.tar.gz` was
deliberately not fetched, as the plan directs.

### The provided set (AOTW-03)

`llvm-nm --defined-only --no-sort` over all 19 `*.a`, keeping uppercase type letters
(`T W D B R V`), `sort -u`:

| Reading | Value |
|---|---|
| `nmExit` | 0 |
| unique global symbols | **3963** |
| `wc -l < provided.txt` | **3963** (asserted equal to `providedCount`) |
| `libc.a` alone | 1196 |
| `libc++.a` alone | 2319 |
| `libc++abi.a` alone | 424 |
| nm stderr | one line: `libc++experimental.a:keep.cpp.o: no symbols` — a note, not a failure |

The per-archive readings are what the spec's floor of 3000 is sited against.

### The probe — all 39 rows, measured

**Control group (asserted present before any absence is believed):** `printf` ✅,
`malloc` ✅, `memcpy` ✅, `write` ✅, `exit` ✅ — all five present. The instrument read.

| Family | Present | Absent |
|---|---|---|
| process | — (none) | `fork`, `vfork`, `execv`, `execve`, `execvp`, `posix_spawn`, `wait`, `waitpid`, `wait4`, `system`, `popen`, `pipe` |
| signals | `signal`, `raise` | `sigaction`, `kill`, `sigprocmask` |
| jumps | — (none) | `setjmp`, `_setjmp`, `sigsetjmp`, `longjmp`, `siglongjmp` |
| unwinding | — (none) | `_Unwind_RaiseException`, `__cxa_allocate_exception`, `__cxa_throw` |
| dynamic | `dlopen`, `dlsym`, `dlclose` | — |
| sockets | — (none) | `socket`, `connect`, `bind`, `listen` |
| threads | — (none) | `pthread_create`, `pthread_mutex_lock` |
| control | all five | — |

**Two rows are qualified rather than reported bare, and Plan 26-02 must read them as
qualified:**

- **`setjmp` / `longjmp` are absent as symbols and available as a feature.** wasi-sdk-24
  lowers them through the compiler's own SjLj path, so what the archives define is
  `__wasm_setjmp`, `__wasm_setjmp_test`, `__wasm_longjmp` and `__c_longjmp` — **all four
  measured present in `provided.txt`**. The C names never appear as archive symbols at
  all. This row means "not a libc symbol", never "no non-local jump".
- **`__cxa_allocate_exception` / `__cxa_throw` are absent, and that absence is real.**
  Corroborated rather than assumed: **32** sibling `__cxa_*` symbols (`__cxa_atexit`,
  `__cxa_guard_acquire`, `__cxa_rethrow_primary_exception`, `__cxa_demangle`, …) **are**
  present in the same scan — `grep -c '^__cxa' provided.txt` reads 32, and neither probed
  symbol is among them — so libc++abi was demonstrably read. This is the measurement
  behind 26-CONTEXT.md's "C++ exceptions stay off".
- **`pthread_*` is a flat zero** in the preview1 sysroot: `grep -c '^pthread' provided.txt`
  returns 0. The threads variant is a different sysroot this scan deliberately does not read.

### The module, run (AOTW-02)

| Reading | Value |
|---|---|
| `smoke.exit` | 0 — **recorded and deliberately not what any case passes on** |
| `smoke.bytes` | 49 986 (asserted equal to the bytes read off disk) |
| `smoke.sha256` | `2f6e9c2b1b2bc331dbbc7507db2b917496eff4404de3c849826d69e653e0b158` |
| exports | exactly `_start`, `memory` |
| import namespaces | exactly `wasi_snapshot_preview1` |
| `wasi.start(...)` return | 0 |
| **stdout, decoded** | **`"O2 preview1 smoke ok\n"`** |

The module was compiled in the container and **not run there**; it was executed on the
host under `@bjorn3/browser_wasi_shim`, the preview1 host this project ships on both
platforms, with three collecting `Fd`s and `{ debug: false }`.

### The re-site (`vitest.config.ts`)

**(i) The span, measured as a process rather than as a machine.** The whole cost is one
`docker run` inside a top-level `beforeAll`, so `--reporter=json` attributes it to nothing:

| Instrument | Reading |
|---|---|
| `--reporter=json` file span | **4.98 ms** (sum of six case durations 4.47 ms — internally consistent and completely blind) |
| `/usr/bin/time -p` solo, run 1 | `real 1.75  user 0.78  sys 0.22` |
| `/usr/bin/time -p` solo, run 2 | `real 1.59  user 0.78  sys 0.19` |
| boot floor (2 solo runs of `packages/core/src/blockstore/memory.test.ts`) | `real 0.79` and `0.77` → **0.78 s** |
| derived span | **970 ms** and 810 ms |
| `(user+sys)/real` | **0.57** — the container does the work, this process waits |
| load | 4.09 → 10.33, 1-min average, 8-core host |

The reporter is short by a factor of **195**. 970 is recorded, per the table's convention
of the span a reader would observe rather than the kinder of two. Bare `docker run` of the
harness alone: `real 0.67 user 0.02 sys 0.01`.

**(ii)–(vi):**

| Field | Before | After |
|---|---|---|
| `MEASURED_NODE_SPANS` | — | `['tools/aot/wasi-preview1-surface.node.test.ts', 970]` inserted between 997 and 940 (descending order holds) |
| `files` | 171 | **176** |
| `sumOfFileSpansMs` | 1 824 386 | **1 825 356** (+970, nothing else) |
| `unitFiles` | 111 | **116** |
| `unitTests` | 1697 | **1812** |
| `unitWallClockMs` | 23 340 | **22 520** |

**The file count, two routes that share no code:**

| Route | Reading |
|---|---|
| filesystem walk (`NODE_PROJECT_FILES`'s own derivation) | **176** |
| `git ls-files packages tools` under the same globs | **175 tracked** |
| `git status --porcelain` untracked, same globs | **1** — this plan's spec |

They agree and disagree by exactly the untracked file, which is the shape they should have.

**Four of the five are not this plan's.** The tree had drifted 171 → 175 before this plan
opened. They are counted in `files` and are **absent from the table**, because transcribing
a span nobody measured is the failure that table exists to prevent. Named as 1 + 4 rather
than absorbed into a 5.

**`unitFiles` moved by the full five because the new row is BELOW the cut.** 970 < 1000,
so `EXCLUDED.length` did not move and `files - EXCLUDED.length` grows by five. **The
classification is marginal and is recorded as marginal**: the 30 ms margin is smaller than
the 810–970 run-to-run spread, and the reading holds only for a warm image — a first pull
of the 6.08 GB image would put the file minutes above the cut.

**The `unitFiles` cross-check was taken, not just derived.** `npm run test:unit` exit **0**,
`Test Files 116 passed (116)`, `Tests 1812 passed (1812)`, `real 22.52 user 55.49 sys 8.82`,
`(user+sys)/real` **2.85**, load 6.84 → 10.54. The derivation says 116 and the runner says
116, independently.

## Planted-Mutation Proof

Per CLAUDE.md's Proofs convention, planted on the **execution** leg rather than on a
threshold, because execution is the leg AOTW-02 rests on.

**Snapshot taken immediately before planting:** `tools/aot/wasi-preview1-surface.node.test.ts`
→ SHA-256 `ed976c54acf97c7550d56fdd63c02847bfaade769ee592cee1bba76ca2e72dc7`.

**The edit** — one line inserted before `WebAssembly.instantiate`:

```ts
bytes[0] = bytes[0]! ^ 0x01 // PLANT: corrupt the wasm magic
```

**Observed red.** `npx vitest run --project node tools/aot/wasi-preview1-surface.node.test.ts`,
exit code read directly on the following line: **1**.

```
 FAIL  |node| tools/aot/wasi-preview1-surface.node.test.ts > WASI preview1 surface, measured in the digest-pinned image (runnable) > AOTW-02 — the container-produced module RUNS under the shim and says what it was told to say
CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 01 61 73 6d @+0

 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

**`1 failed | 5 passed` is the part that matters.** Only the execution case moved. A plant
that reddened the whole file would have proved the file runs, not that this case tests what
it claims to.

**Restored by the surgical inverse of that exact edit** — the inserted line deleted, nothing
else touched — then **`cmp` against the pre-plant snapshot: silent, exit 0, byte-identical**.
No `cp`, no `git stash`, no `git checkout --`. Per CLAUDE.md the hunk count is a one-way
alarm and proves nothing when equal; `cmp` is what held.

The docblock's failure text was afterwards corrected to the **verbatim observed output**. A
first draft of it had been written from prediction before the plant was run; that was a
fabrication and it was replaced by the real text. The only diff from the snapshot after
restore is that docblock correction, confirmed by `diff`.

## Verification

Every exit code below read with `EXIT=$?` on the line immediately after the command — no
pipe, no trailing `tail`.

| Command | Exit | Result |
|---|---|---|
| `docker run --rm -i -v $OUT:/out … < tools/aot/wasi-preview1-surface.sh` | 0 | `surface written to /out/surface.json (3963 symbols over 19 archives)` |
| `npx vitest run --project node tools/aot/wasi-preview1-surface.node.test.ts` | 0 | 1 file, 6 tests passed |
| `npx vitest run --project node packages/node/src/slow-specs.node.test.ts` | 0 | 1 file, 9 tests passed |
| `npx tsc --noEmit` | 0 | clean |
| the 7 pre-commit guards (vocabulary, purity, mutation-guard, disclosure-gate, requirements-ledger, slow-specs, reachability-guard) | 0 | 7 files, 267 tests passed |
| acceptance-traceability + requirements-ledger + purity + mutation-guard + commit-scope + strip-comments + opt-in-only-sources + job-entry-points | 0 | 8 files, 290 tests passed |
| `npm run test:unit` | 0 | 116 files, 1812 tests passed |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The plan's Task-1 verify command omitted `docker run -i`**

- **Found during:** Task 1 verification, on the first run.
- **Issue:** Without `-i` the container's stdin is `/dev/null`. `bash /dev/stdin` read an
  empty script, wrote nothing, and `docker run` **exited 0**. The output directory was
  empty and the exit code said success — an instrument that read nothing reporting a green,
  which is precisely the failure this whole plan is built to refuse.
- **Fix:** `-i` added to the argv in the spec's `beforeAll`, and the failure recorded in a
  comment there so the next reader does not remove it. The plan's literal verify command
  was run with `-i` added.
- **Files modified:** `tools/aot/wasi-preview1-surface.node.test.ts`
- **Commit:** `b72559f`

**2. [Rule 2 — Missing critical accuracy] `unitTests` / `unitWallClockMs` also updated**

- **Found during:** Task 2, step (v).
- **Issue:** The plan's six re-site steps do not mention these two fields, but the
  `unitFiles` docblock this plan writes claims a direct `npm run test:unit` cross-check was
  taken. It was taken, and it was green. Leaving the neighbouring fields at the 2026-08-07
  run's readings would have made the new docblock's own claim false.
- **Fix:** 1697 → 1812 and 23 340 → 22 520, both from the single green run, with the +115
  decomposed as far as it was measured and the remainder carried as a stated residual.
- **Files modified:** `vitest.config.ts`
- **Commit:** `b72559f`

### Deliberate departures from the plan's letter, with reasons

**3. The plan says "keep only global defined symbols (nm type letters `T W D B R V`)".**
Implemented exactly. Worth recording that the live scan contains only `D`, `T`, `W` among
uppercase types (561 / 1924 / 1571 lines before `sort -u`); `B`, `R`, `V` are in the class
for generality and matched nothing here.

**4. The plan's spec-side instruction is "at least one running title containing AOTW-01,
one AOTW-02, one AOTW-03".** There are one, two and three respectively. No departure —
recorded because Plan 26-03 will grep for them.

**5. A wrong number was committed and then corrected, and it is recorded rather than
quietly fixed.** `b72559f`'s commit message and the spec's docblock both said "twenty
sibling `__cxa_*` symbols". That came from reading a `head -20`-truncated list, not from a
count. `grep -c '^__cxa' provided.txt` reads **32**. Corrected in the docblock by the
follow-up commit that carries this summary; the commit message of `b72559f` still says
twenty and cannot be corrected without rewriting the hash this summary cites. This is the
exact shape of failure CLAUDE.md's Measurement section warns about — a number that agreed
with a plausible reading was written down as if it had been measured.

## Known Stubs

None. Every value the spec asserts is read from a file the container wrote in the run being
asserted about; nothing is hardcoded to a placeholder and no component is wired to empty data.

## Threat Flags

None. The three trust boundaries the plan's threat model names are the ones this plan
builds against, and the five registered threats are dispositioned exactly as the register
says: T-26-01 by the digest constant, T-26-02 by `nmExit` + the 1000/3000 floors + the
control group, T-26-03 by the absent `/repo` mount, T-26-04 accepted, T-26-05 by the
recorded and asserted toolchain identity. No new endpoint, auth path, file access pattern or
schema at a trust boundary was introduced.

## What This Does NOT Establish

Stated because the next plan will be tempted to read more into it.

- **Nothing about `elflift`.** A six-line `main` that calls `std::puts` proves the toolchain
  in the pinned image emits a preview1 command module that instantiates against this
  project's import surface, exports `_start` and `memory` and nothing else, runs to
  completion and writes what it was told to write. Whether LLVM, Remill and the elfconv
  lifter build for `wasm32-wasi` is Plan 26-02's question and this plan answers none of it.
  `packages/aot/src/wasi-real.node.test.ts` is careful about the same distinction.
- **`present` is not `works`.** `dlopen` is present and is a stub. `signal` is present and
  can only refuse. The set is the generous bound a gate should subtract from, not a
  capability list.
- **`absent` is not always "unavailable".** See the `setjmp` qualification above. A gate
  that reads the probe table without reading its qualifications will conclude that preview1
  has no non-local jump, and that conclusion is wrong.
- **The scan covers `wasm32-wasi` only.** `wasm32-wasi-threads` was not read, so every
  thread-family absence is scoped to preview1-without-threads. 26-CONTEXT.md already records
  that a `std::thread` program builds at 1 175 165 bytes against the threads sysroot.

## Self-Check: PASSED

- `tools/aot/wasi-preview1-surface.sh` — FOUND (211 lines, mode 100755, ≥ 90 required)
- `tools/aot/wasi-preview1-surface.node.test.ts` — FOUND (454 lines, ≥ 130 required)
- `vitest.config.ts` — FOUND, modified
- commit `b72559f` — FOUND in `git log`, `git show --stat` lists exactly the three files in
  `files_modified` and nothing else
- `key_links` pattern `new WASI\(` — present in the spec
- `key_links` pattern `llvm-nm` — present in the harness
- working tree clean after commit
