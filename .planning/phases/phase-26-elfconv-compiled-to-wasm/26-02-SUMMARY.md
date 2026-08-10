---
phase: 26-elfconv-compiled-to-wasm
plan: 2
subsystem: aot
tags: [wasi, wasm32-wasi, elflift, remill, glog, llvm, symbol-residue, container-harness, digest-pin, gate]
dependency-graph:
  requires:
    - 26-01 (the pinned image digest, the wasi-sdk it ships, and the 3963-symbol
      preview1 provided set this plan subtracts from and regenerates in-run)
  provides:
    - tools/aot/elflift-wasi-gate.sh (digest-pinned harness; emits gate.json, provided.txt,
      per-TU logs and objects for two target arms, four undefined/defined nm readings;
      exit codes 0/40/41/42/43/44)
    - tools/aot/elflift-wasi-gate.node.test.ts (8 cases; liveness-before-absence,
      per-TU recorded tables in both directions, reading-C disjunction, residue
      classification and named-symbol tables, member attribution)
    - "the measured answer to roadmap item 7: elflift's own sources do NOT compile for
      wasm32-wasi as they stand -- 6 of 27 TUs produce an object, 21 stop at glog"
    - "the named residue: fork, execv, execve, posix_spawn(+4), wait, __syscall_wait4,
      kill, sigaction, sigprocmask, __cxa_allocate_exception, __cxa_throw -- present in
      BOTH alive readings, and attributed to Program.cpp.o / Signals.cpp.o /
      CrashRecoveryContext.cpp.o"
  affects:
    - Plan 26-03 (writes the GO/NO-GO verdict from gate.json alone; AOTW-04 and AOTW-05
      are each named in a running test title here, which acceptance-traceability
      requires before an [x] can land)
tech-stack:
  added: []
  patterns:
    - two-arm comparative compile in one container run (wasm32-wasi against
      wasm32-wasi-threads), so a failure's CAUSE is measured rather than inferred from
      one arm's error text
    - per-reading liveness disposition as DATA (`alive` + `insufficientReason`), asserted
      against a recorded list, so a reading that becomes alive forces a re-take instead
      of inheriting a disposition taken while the instrument was blind
    - include-chain attribution (`includedFrom`) so an error reported inside the
      toolchain is traced to the dependency header that asked for it
    - archive-member attribution (`memberOf`) so an archive-wide undefined set is not
      read as a link's demand
key-files:
  created:
    - tools/aot/elflift-wasi-gate.sh
    - tools/aot/elflift-wasi-gate.node.test.ts
  modified:
    - vitest.config.ts
decisions:
  - "`compile_commands.json` as cmake writes it by default covers ONLY the remill
    subtree, because backend/remill/cmake/settings.cmake:25 sets
    CMAKE_EXPORT_COMPILE_COMMANDS as a directory-scoped normal variable inside remill's
    own project(). 27 entries without the flag, 38 with it. The eleven that appear
    include elflift's own five sources. Roadmap item 11(ii)'s `22 of 22 non-test TUs`
    therefore never compiled Loader.cpp, MainLifter.cpp, TraceManager.cpp, Lift.cpp or
    utils/Util.cpp. Fixed by passing -DCMAKE_EXPORT_COMPILE_COMMANDS=ON on the command
    line, which writes the cache variable at top-level scope."
  - "The plan states that REMILL_ARCH / REMILL_OS / REMILL_ON_* `arrive as -D flags from
    compile_commands.json`. They do not -- measured. remill/Arch/Name.h keys off
    __aarch64__ and remill/OS/OS.h off __linux__, neither defined under
    --target=wasm32-wasi, so both #ifndef blocks fall to their #error. Thirteen defines
    are ADDED and reported as `addedFlags` separately from the carried set, with a
    control recompile that withholds them and is asserted to fail at `Cannot infer
    current architecture`."
  - "A SECOND ARM against wasm32-wasi-threads was added beyond the plan's letter. Without
    it the preview1 arm's error text (`<thread> is not supported`) would have been read
    as `elfconv needs threads`, and 26-01 explicitly left the threads sysroot unmeasured.
    The arm shows threads do NOT unblock the build: the same 21 TUs fail, one line
    deeper, on glog's own platform refusal."
  - "Reading A is reported and REFUSED AS EVIDENCE. 21 of 27 TUs produced no object, so
    it covers six small objects and five undefined symbols. Its residue of one is not
    `elfconv demands nothing preview1 lacks` -- it is an instrument that barely read.
    Same for the threads arm's reading AT. Both carry `alive: false` plus a reason and
    are asserted against a recorded EXPECTED_INSUFFICIENT_READINGS list."
  - "Reading B's archive list uses `llvm-config-16 --link-static --libnames`, not the
    plan's literal `--libnames`. This image builds LLVM with LLVM_LINK_LLVM_DYLIB, so the
    literal form answers `libLLVM-16.so` -- one shared object whose undefined set is its
    dynamic imports, which is a reading of the wrong thing. `--link-static` resolves the
    six named components to their 37-archive transitive closure."
  - "Two families were added beyond the plan's nine: `linker-provided` (wasm globals
    wasm-ld synthesises) and `compiler-rt` (builtins). Both are corrections -- leaving
    __stack_pointer and __multi3 in `other` would have counted linker-supplied symbols as
    unresolvable gaps."
  - "The harness's shell-split variable was renamed to `words` after
    packages/node/src/vocabulary.node.test.ts blocked its original name repository-wide as
    cryptojacking vocabulary. Caught by the guard, not by review — and the guard blocks
    the term in prose too, so this summary describes it rather than quoting it."
metrics:
  duration: "~1h05m wall time (2026-08-10T03:33 to 04:38 -07:00), single code commit 33f32b5"
  completed: 2026-08-10
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 26 Plan 2: The gate, measured — and it is a negative with a named cause Summary

Twenty-seven of elfconv's non-test translation units compiled for `wasm32-wasi` by the
pinned wasi-sdk, each recorded with its own exit code, first error line and produced-object
size; the undefined-symbol residue of the elflift link read four ways and subtracted from a
preview1 provided set regenerated in the same container run. **Six TUs produce an object.
The other twenty-one stop at glog, and the threads sysroot does not save them.**

## The answer, stated before the evidence

**NO-GO for `elflift` on `wasm32-wasi` as the tree stands** — and the blocking cause is not
the one roadmap item 7 predicted.

| Question | Measured answer |
|---|---|
| Does elflift's own source compile for `wasm32-wasi`? | **No. 6 of 27 TUs produce an object; 21 fail.** |
| What blocks the 21? | **glog.** `glog/logging.h:51` is `#include <thread>`, which wasi-sdk-24's threadless `wasm32-wasi` libc++ refuses outright. |
| Do threads fix it? | **No.** Under `wasm32-wasi-threads` the same 21 fail one line deeper, at `glog/platform.h:58` — *"Platform not supported by glog"*. glog branches on Windows, Cygwin, Linux, Android, macOS, the BSDs and **Emscripten**, and has no `__wasi__` branch at all. |
| Does elflift need fork/exec? | **elflift's own code — unmeasured, because the compile stops at glog before any of it is type-checked.** But LLVM does: `fork`, `execv`, `execve`, `posix_spawn`, `wait` are unresolvable in **both** alive readings, and all five come from **one member**, `Program.cpp.o` of LLVMSupport. |

**The scope of that NO-GO, stated precisely.** The compile half is conclusive and it is a
negative: 21 TUs do not compile, the cause is a named third-party header with no wasm
support, and no amount of additional build time changes that. The symbol half is **an upper
bound and is not conclusive in either direction** — `llvm-nm --undefined-only` over an
*archive* reads every member, while a link pulls in only the members it needs. "LLVM's
archives mention `fork`" is not "elflift calls `fork`", and this report does not say it is.
That is why every named-family symbol carries member attribution.

**There is no linked `elflift.wasm`, and nothing here may be written up as if there were.**

## What Was Built

### `tools/aot/elflift-wasi-gate.sh` (691 lines, mode 100755)

Runs inside `ghcr.io/yomaytk/elfconv@sha256:22a404f3…f19c05` with `/repo` mounted **`:ro`**,
`/out` writable, and — when the host has it — the neighbouring wasm LLVM archive directory at
`/wasmllvm:ro`. Piped on stdin, so nothing in `/repo` needs to be executable from the
container's point of view and a harness bug cannot dirty the tree that
`discover-arm.node.test.ts` and `bench-attestation.node.test.ts` snapshot
`git status --porcelain` around.

It carries `elfconv-differential.sh`'s four paid-for rules and 26-01's fifth, and adds a sixth
of its own: **the object is the evidence, not the exit code** — `objectBytes` is stat'd per
translation unit. That is this project's standing rule about elfconv exiting `0` on binaries
it could not translate, turned around and pointed at the compiler doing the porting.

| Exit | Meaning |
|---|---|
| 0 | report written |
| 40 | cmake failed |
| 41 | no `compile_commands.json` after cmake |
| 42 | provided-set read failed |
| 43 | no wasi-sdk |
| 44 | no TU was attempted at all |

Every shell exit code is captured on the line immediately after its command with no pipe:
`CLANG_VERSION_EXIT`, `CMAKE_EXIT`, `REPLAY_EXIT`, `NM_PROVIDED_EXIT`, the two per-reading
`nm` codes inside `read_one`, `REPORT_EXIT`. The `awk` filters are separate steps *after* the
code is captured, which is the whole point of the rule.

### `tools/aot/elflift-wasi-gate.node.test.ts` (698 lines, 8 cases)

Eight cases in an order that matters — **the harness is shown to have done the work before
anything it reports is read**, the same ordering `elfconv-differential.node.test.ts:114-122`
uses and for the same reason.

1. **AOTW-04** — configured the *fork*, replayed real TUs, and the added-flag control fired.
2. **AOTW-04** — every `wasm32-wasi` TU result equals the recorded table, in both directions.
3. **AOTW-04** — the threads arm fails on the *same* units, one error deeper.
4. **AOTW-05** — the provided set was read, and both sides of the subtraction are one run.
5. **AOTW-05** — every reading alive, or explicitly dispositioned as not to be believed.
6. **AOTW-05** — reading C fully populated or `null` with a reason, never absent.
7. **AOTW-05** — the recorded classification equals the live reading, row for row.
8. **AOTW-05** — every unresolvable symbol in a named family is named and attributed.

Case 5 runs before cases 7 and 8, and that ordering is what makes their absences believable.

## What Was Measured

### The configure (AOTW-04)

| Field | Reading |
|---|---|
| `cmakeExit` | 0 |
| `foundLlvmLine` | `-- Found LLVM 16.0.6` |
| `llvmLibrariesLine` | `-- LLVM Libraries: LLVM` |
| `clangVersion` | `clang version 18.1.2-wasi-sdk (…26a1d6601d…)` |
| `entriesTotal` | **38** |
| `entriesSkipped` | **11** |
| `tus` | **27** (38 − 11, asserted) |

**`LLVM Libraries: LLVM` is a finding, not boilerplate.** This image builds LLVM with
`LLVM_LINK_LLVM_DYLIB`, so the fork's WASM-EXPERIMENT six-component list at
`backend/remill/CMakeLists.txt:53-57` is short-circuited by the `if(LLVM_LINK_LLVM_DYLIB)`
branch above it and never evaluated. A reader assuming that list held would be wrong about
what this image links.

**The eleven skips, each with its reason:**

| Count | Reason |
|---|---|
| 5 | remill's own AArch64 test target (`/backend/remill/tests/`) |
| 4 | vendored googletest under `/_deps/` |
| 1 | the elfconv integration-test target (`/tests/elfconv/`) |
| 1 | duplicate source path — `utils/Util.cpp` appears twice, under `elflift` and under the test target |

### The wasm32-wasi replay — 6 pass, 21 fail (AOTW-04)

**The six that produced an object**, named rather than left as `27 − 21`:

| TU | bytes |
|---|---|
| `backend/remill/lib/Arch/Name.cpp` | 7 584 |
| `backend/remill/lib/Arch/AArch64/Extract.cpp` | 1 189 222 |
| `backend/remill/lib/BC/ABI.cpp` | 2 467 |
| `backend/remill/lib/OS/Compat.cpp` | 301 |
| `build/backend/remill/lib/Version/Version.cpp` | 3 110 |
| `utils/Util.cpp` | 802 |

They are exactly the six that never reach `glog/logging.h`. **That is the honest scope of
what the compile arm proved: elfconv source compiles for `wasm32-wasi` where it does not
include glog, and the measurement cannot see past glog anywhere else.**

**The twenty-one that failed**, every one of them with the *same* first error and the *same*
include-chain root:

```
backend/remill/lib/Arch/Arch.cpp            backend/remill/lib/BC/TraceLifter.cpp
backend/remill/lib/Arch/Instruction.cpp     backend/remill/lib/BC/Util.cpp
backend/remill/lib/Arch/Context.cpp         backend/remill/lib/BC/VroTraceLifter.cpp
backend/remill/lib/Arch/AArch64/Arch.cpp    backend/remill/lib/BC/VroInstructionLifter.cpp
backend/remill/lib/Arch/AArch64/Decode.cpp  backend/remill/lib/OS/FileSystem.cpp
backend/remill/lib/Arch/Sleigh/AArch64Base.cpp   backend/remill/lib/OS/OS.cpp
backend/remill/lib/BC/Annotate.cpp          lifter/Binary/Loader.cpp
backend/remill/lib/BC/ForkEmulation.cpp     lifter/MainLifter.cpp
backend/remill/lib/BC/InstructionLifter.cpp lifter/TraceManager.cpp
backend/remill/lib/BC/IntrinsicTable.cpp    lifter/Lift.cpp
backend/remill/lib/BC/Optimizer.cpp
```

`firstError`, all twenty-one identical:

```
…/share/wasi-sysroot/include/wasm32-wasi/c++/v1/thread:92:4: error:
  "<thread> is not supported since libc++ has been configured without support for threads."
```

`includedFrom`, all twenty-one identical — and **this field is why the report names the right
subject**:

```
/root/elfconv/dependencies/install/include/glog/logging.h:51:
```

clang reports the error where it occurs, inside wasi-sdk's own libc++, so the error text alone
reads as *"the toolchain refused"*. The include chain says otherwise: `glog/logging.h:51` is
`#include <thread>`, and glog is what asked.

### The wasm32-wasi-threads arm — 26-01's third qualification, closed

| Arm | pass | fail | first error | include-chain root |
|---|---|---|---|---|
| `wasm32-wasi` | 6 | 21 | `"<thread> is not supported…"` | `glog/logging.h:51:` |
| `wasm32-wasi-threads -pthread` | 6 | 21 | `Platform not supported by glog…` | `glog/flags.h:48:` |

**Identical file sets in both arms**, asserted. Threads do not unblock this build; they move
the refusal from libc++ to glog's own `platform.h:58`, which `#error`s in its `#else` because
its detection chain covers Windows, Cygwin, Linux, Android, macOS, FreeBSD, NetBSD, OpenBSD
and **Emscripten** — and has no `__wasi__` branch.

**So there are two glog walls, one behind the other**, and the second is the harder one: the
first is a libc++ configuration, the second is glog declaring the platform unsupported.

### The added-flag control

`REMILL_ARCH` / `REMILL_OS` / the `REMILL_ON_*` set **do not arrive from
`compile_commands.json`** — the plan says they do and they do not. The database's defines are
`ELFCONV_AARCH64_BUILD`, `GFLAGS_IS_A_DLL`, `GLOG_USE_GFLAGS`, `GLOG_USE_GLOG_EXPORT`,
`NDEBUG`, `REMILL_BUILD_SEMANTICS_DIR_AARCH64`, `REMILL_INSTALL_SEMANTICS_DIR`. Thirteen
defines are therefore **added**, reported separately as `addedFlags`, and one TU is
recompiled with them withheld as a control:

| Field | Reading |
|---|---|
| `addedFlagsControl.file` | `backend/remill/lib/Arch/Arch.cpp` |
| `addedFlagsControl.exit` | 1 |
| `addedFlagsControl.firstError` | `remill/Arch/Name.h:82:6: error: "Cannot infer current architecture."` |

Instrument-alive, applied to a flag list: if the control did not fail there, `addedFlags` was
doing nothing and every reading in the arm was taken with an unexamined flag set.

### The provided set (regenerated in-run)

| Reading | Value |
|---|---|
| `nmExits.provided` | 0 |
| `providedCount` | **3963** — exactly Plan 26-01's figure, compared in a comment rather than asserted equal |

### The four readings (AOTW-05)

| Reading | Archives/objects | undefined | defined | **residue** | alive |
|---|---|---|---|---|---|
| **A** — objects this run emitted, `wasm32-wasi` | 6 | **5** | 46 | 1 | **false** |
| **AT** — objects this run emitted, `wasm32-wasi-threads` | 6 | **5** | 46 | 1 | **false** |
| **B** — host LLVM 16 static archives + gflags/glog/XED | 40 | 10 844 | 53 047 | **262** | true |
| **C** — wasm-compiled LLVM 17 archives | 5 | 2 116 | 13 434 | **85** | true |

**A and AT are not alive and this report refuses to conclude anything from them.** Their five
undefined symbols are `__stack_pointer`, `abort`, `memcmp`, `strlen`, `vprintf`; four are in
`provided.txt` and the fifth is linker-supplied. A residue of one over five symbols is not
*"elfconv demands nothing preview1 lacks"* — it is an instrument that read six small objects
because twenty-one TUs produced none. Both carry `insufficientReason` and are asserted against
a recorded `EXPECTED_INSUFFICIENT_READINGS = ['A', 'AT']`, so the day the compile arm starts
producing objects the disposition goes red and must be re-taken.

**Reading C's disposition:** present. Five named archives — `libLLVMSupport.a`,
`libLLVMCore.a`, `libLLVMIRReader.a`, `libLLVMBitReader.a`, `libLLVMBitWriter.a` —
`readingCNull: null`, `readingCMissingArchives: []`, and **`readingCPassesPresent: false`**:
`libLLVMPasses.a` is one of the six the fork's CMakeLists names and it is absent, exactly as
that file's own comment at line 56 records. The null path was exercised separately (run with
`WASMLLVM=/definitely-not-mounted`): `readingCNull` = `"wasm LLVM archive directory not
mounted"`, `readings.C` = `null`, harness exit **0** — it degrades, it does not break.

### Per-family residue counts, quoted from `gate.json`

| family | A | AT | **B** | **C** |
|---|---|---|---|---|
| process | — | — | **13** | **11** |
| signals | — | — | **8** | **8** |
| unwinding | — | — | **10** | **2** |
| threads | — | — | 30 | 9 |
| non-local-jumps | — | — | 2 | 7 |
| dynamic-loading | — | — | 2 | — |
| sockets | — | — | 1 | 1 |
| filesystem | — | — | 6 | 4 |
| compiler-rt | — | — | 9 | 1 |
| linker-provided | 1 | 1 | 1 | 5 |
| other | — | — | 180 | 37 |
| **total residue** | **1** | **1** | **262** | **85** |

### Every unresolvable symbol in a named family, named

**Reading C** — the closest reading, real wasm objects:

| family | members |
|---|---|
| process (11) | `__syscall_wait4`, `execv`, `execve`, `fork`, `getsid`, `posix_spawn`, `posix_spawn_file_actions_adddup2`, `posix_spawn_file_actions_addopen`, `posix_spawn_file_actions_destroy`, `posix_spawn_file_actions_init`, `wait` |
| signals (8) | `alarm`, `kill`, `sigaction`, `sigaddset`, `sigaltstack`, `sigemptyset`, `sigfillset`, `sigprocmask` |
| unwinding (2) | `__cxa_allocate_exception`, `__cxa_throw` |
| non-local-jumps (7) | `__THREW__`, `__threwValue`, `emscripten_longjmp`, `getTempRet0`, `invoke_ii`, `invoke_vi`, `setTempRet0` |
| threads (9) | `std::__2::this_thread::sleep_for`, `recursive_mutex` ctor/dtor, `condition_variable::wait`/dtor, `__shared_mutex_base` ctor, `mutex::lock`/`unlock`/dtor (mangled in the report) |
| sockets (1) | `gethostname` |
| filesystem (4) | `dup2`, `fchown`, `posix_madvise`, `umask` |
| compiler-rt (1) | `__multi3` |
| linker-provided (5) | `__dso_handle`, `__indirect_function_table`, `__memory_base`, `__stack_pointer`, `__table_base` |
| other (37) | 31 mangled `llvm::`/`std::` symbols + 6 plain: `getpwnam_r`, `getpwuid_r`, `getrlimit`, `getuid`, `mallinfo`, `setrlimit` |

**Reading B** — the upper bound. Same process family plus `pclose`, `popen`, `wait4`; same
signals; unwinding widens to `_Unwind_Backtrace`, `_Unwind_GetIP`, `_Unwind_Resume`,
`__cxa_begin_catch`, `__cxa_end_catch`, `__cxa_free_exception`, `__cxa_rethrow`,
`__gxx_personality_v0`; `non-local-jumps` is `_setjmp` and `__longjmp_chk`;
`dynamic-loading` is `dl_iterate_phdr` and `dladdr`; threads is 30 `pthread_*`/`sched_*`
symbols. Its `other` (180 = 152 mangled + 28 plain) carries `ZSTD_*`, zlib, ncurses
(`setupterm`, `tigetnum`, `del_curterm`), `syslog`/`openlog`/`closelog`, `backtrace` and
`syscall` — host-library references a wasm build would not make. **`otherFamilyCut` is 200
and neither reading reached it, so nothing was truncated in this run.**

### Where the residue lives — the attribution that keeps this honest

`memberOf` names the archive member that references each symbol. The process/signal residue
**concentrates in five members of LLVMSupport**:

| member | symbols it brings |
|---|---|
| `Program.cpp.o` | `fork`, `execv`, `execve`, `posix_spawn` (+4 `file_actions`), `wait`, `__syscall_wait4`/`wait4`, `alarm`, `kill`, `sigaction`, `sigemptyset` |
| `Signals.cpp.o` | `sigaltstack`, `sigfillset`, `sigprocmask`, `sigaction`, `_Unwind_Backtrace`, `dl_iterate_phdr`, `dladdr` (B) |
| `CrashRecoveryContext.cpp.o` | the entire `non-local-jumps` family — `_setjmp`/`__longjmp_chk` (B), all seven Emscripten SjLj symbols (C) |
| `Process.cpp.o` | `sigfillset`, `sigprocmask` |
| `LockFileManager.cpp.o` | `getsid`, `gethostname` |

`fork`, `execve`, `posix_spawn` each have `count: 1` in **both** alive readings — one member
apiece. By contrast `__cxa_throw` has `count: 102` in reading C, which is a statement about
that build having exceptions enabled rather than about LLVM needing them; `26-CONTEXT.md`
records `LLVM_ENABLE_EH=OFF` as LLVM's own default. Attribution lists are capped at 12 members
with the true count kept beside them (`memberAttributionCut: 12`).

### The three qualified readings from 26-01, carried and answered

| 26-01's qualification | What this plan did with it |
|---|---|
| **`setjmp`/`longjmp` absent as symbols, present as a feature (SjLj lowering; all four `__wasm_*` symbols in `provided.txt`)** | Honoured. Reading C's entire `non-local-jumps` family — `__THREW__`, `__threwValue`, `emscripten_longjmp`, `getTempRet0`, `setTempRet0`, `invoke_ii`, `invoke_vi` — is **Emscripten ABI from one member** and **is not reported as a preview1 blocker**. Under wasi-sdk the equivalents are `__wasm_setjmp` / `__wasm_setjmp_test` / `__wasm_longjmp` / `__c_longjmp`, all four measured present by 26-01. Reading B's `_setjmp`/`__longjmp_chk` are glibc names from the same member, and the same caveat applies. |
| **"Present" means linkable, not working, and not linked by default** | Honoured. `provided.txt` is the generous bound being subtracted *from*, which is the safe direction: an undefined symbol it does not predict would be a false negative and this set cannot produce one. Nothing here claims a subtracted symbol *works*. |
| **Every thread-family absence is scoped to `wasm32-wasi` without threads; the threads sysroot was unmeasured** | **Measured, and it changes nothing.** Second arm added. Same 21 failures, one error deeper. Recorded as `EXPECTED_THREADS_ARM_ERROR`. |

## Planted-Mutation Proof

Planted on the **subtraction**, because the subtraction is the leg AOTW-05 rests on.

**Snapshot taken immediately before planting:** `tools/aot/elflift-wasi-gate.sh` → SHA-256
`707164bab58a89de999bd5272ec8d95632b0ba53d32f2c6c1b3a497b6e426a84`.

**The edit** — one line inserted after `provided = set(lines(f'{OUT}/provided.txt'))`:

```python
provided.discard('printf')   # PLANT: drop one control symbol before the subtraction
```

`printf` was chosen **by measurement**, not by the plan's word alone: it is undefined in
reading B only (A: 0, AT: 0, B: 1, C: 0, and present in `provided` for all four), so the plant
moves exactly one row of the recorded classification.

**Observed red.** `npx vitest run --project node tools/aot/elflift-wasi-gate.node.test.ts`,
exit code read on the immediately following line: **1**.

```
 ❯ |node| tools/aot/elflift-wasi-gate.node.test.ts (8 tests | 1 failed) 137930ms
     × AOTW-05 — the recorded residue classification equals the live reading, row for row 19ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |node| tools/aot/elflift-wasi-gate.node.test.ts > the elflift wasm32-wasi gate, measured in the digest-pinned image (runnable) > AOTW-05 — the recorded residue classification equals the live reading, row for row
AssertionError: B/other: expected 181 to be 180 // Object.is equality

- Expected
+ Received

- 180
+ 181

 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

**`1 failed | 7 passed` is the part that matters.** The liveness case, both TU tables, the
threads arm and the reading-C disjunction all stayed green; only the row the plant moved went
red. A plant that reddened the whole file would have proved the file runs, not that this case
tests what it claims to.

**Restored by the surgical inverse of that exact edit** — the inserted line deleted, nothing
else touched — then **`cmp` against the pre-plant snapshot: silent, exit 0, byte-identical**,
and the SHA-256 re-read as `707164ba…6a84`. No `cp`, no `git stash`, no `git checkout --`.
Per CLAUDE.md the hunk count is a one-way alarm and proves nothing when equal; `cmp` is what
held.

**Two disclosures about this proof, both recorded rather than smoothed over.**

1. **The docblock's failure text was first drafted from prediction, before the plant ran.**
   That is the fabrication 26-01 named and it was the wrong way to start. The prediction
   happened to match, and it was **replaced with the terminal's real output anyway**, because
   "it turned out to be right" is not the standard.
2. **The harness changed after the `cmp`.** The vocabulary rename (see Deviations) landed
   afterwards, so the file at HEAD is not byte-identical to the pre-plant snapshot. The `cmp`
   verified what it was taken to verify — that the *plant* left no residue — and the later
   rename is a separate, deliberate, committed edit. The spec was re-run green against the
   renamed harness.

## Verification

Every exit code read with `EXIT=$?` on the line immediately after the command — no pipe, no
trailing `tail`. Run by project throughout.

| Command | Exit | Result |
|---|---|---|
| `bash -n tools/aot/elflift-wasi-gate.sh` | 0 | clean |
| `docker run --rm -i … < tools/aot/elflift-wasi-gate.sh` | 0 | `6/27 TUs produced an object for wasm32-wasi, provided=3963` |
| the same with `WASMLLVM=/definitely-not-mounted` | 0 | `readings.C === null`, reason recorded — degrades, does not break |
| `npx vitest run --project node tools/aot/elflift-wasi-gate.node.test.ts` | 0 | 1 file, **8 tests passed**, 134.99 s |
| `npx vitest run --project node packages/node/src/slow-specs.node.test.ts` | 0 | 1 file, 9 tests passed |
| `npx tsc --noEmit` | 0 | clean |
| the 7 pre-commit guards | 0 | 7 files, 267 tests passed |
| acceptance-traceability + commit-scope + strip-comments + opt-in-only-sources + job-entry-points | 0 | 5 files, 94 tests passed |

**Reproducibility, checked rather than assumed.** Two independent container runs of the final
harness produce `gate.json` files that are **identical after dropping the per-TU `seconds`
field** — asserted by a JSON comparison, not eyeballed.

**Running titles contain `AOTW-04`** (3 cases) **and `AOTW-05`** (5 cases), which
`acceptance-traceability.node.test.ts` requires before Plan 26-03 can land an `[x]`.

### The `vitest.config.ts` re-site

**(i) The span, measured as a process rather than as a machine.**

| Instrument | Reading |
|---|---|
| `--reporter=json` file span | **16.7 ms** (sum of eight case durations 16.1 ms — internally consistent and completely blind) |
| `/usr/bin/time -p` solo, run 1 | `real 138.15  user 0.87  sys 0.29` |
| `/usr/bin/time -p` solo, run 2 | `real 136.77  user 0.87  sys 0.27` |
| boot floor (2 solo runs of `packages/core/src/blockstore/memory.test.ts`) | `real 1.00` and `1.03` → **1.02 s** |
| derived span | **137 130 ms** and 135 750 ms |
| `(user+sys)/real` | **0.008** — the container does the work, this process waits |
| load | 7.70 → 5.61, 1-minute average, 8-core host |

**The reporter is short by a factor of 8 200** — the largest hook shadow this table records,
against the 195× of 26-01's row directly below it, and for the same structural reason: the
entire cost is one `docker run` inside a top-level `beforeAll`. 137 130 is recorded, per the
table's convention of the span a reader would observe rather than the kinder of two.

**(ii)–(vi):**

| Field | Before | After |
|---|---|---|
| `MEASURED_NODE_SPANS` | — | `['tools/aot/elflift-wasi-gate.node.test.ts', 137_130]` inserted between 255 540 and 86 064 (descending order holds) |
| `files` | 176 | **177** |
| `sumOfFileSpansMs` | 1 825 356 | **1 962 486** (+137 130, nothing else) |
| `unitFiles` | 116 | **116 — unchanged** |
| `unitTests` / `unitWallClockMs` | — | **not retaken**, and said so in the docblock |

**`unitFiles` did not move, and that is arithmetic.** 137 130 is 137× above `SLOW_CUTOFF_MS`,
so the row adds an exclusion along with itself and `files - EXCLUDED.length` cancels. This is
the first re-site in that field's history where the two move together.

**The file count, two routes that share no code — and taken twice, because staging moved one
of them:**

| Route | before `git add` | after `git add` |
|---|---|---|
| filesystem walk (`NODE_PROJECT_FILES`'s own derivation) | **177** | **177** |
| `git ls-files packages tools` under the same globs | 176 tracked | **177 tracked** |
| `git status --porcelain` untracked, same globs | 1 — this plan's spec | **0** |

Both resolve to 177 and the walk never moved. **The staging was not optional**:
`slow-specs.node.test.ts:316` asserts every path in `MEASURED_NODE_SPANS` is a file git knows
about, and the first run after the re-site went red with exactly that finding
(`expected [ "tools/aot/elflift-wasi-gate.node.test.ts" ] to deeply equal []`). Recorded
because it is the same live rule that keeps `closed-fabric-agents.node.test.ts` counted but
unlisted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] `compile_commands.json` does not contain
elflift's own sources**

- **Found during:** Task 1, first exploratory configure.
- **Issue:** The plan directs the harness to replay `compile_commands.json` and describes it as
  covering elflift's translation units, citing its 27 entries. It does not.
  `backend/remill/cmake/settings.cmake:25` sets `CMAKE_EXPORT_COMPILE_COMMANDS` as a
  **directory-scoped normal variable** inside remill's own `project()`, so the database covers
  the remill subtree only. `lifter/Binary/Loader.cpp`, `lifter/MainLifter.cpp`,
  `lifter/TraceManager.cpp`, `lifter/Lift.cpp` and `utils/Util.cpp` — **elflift's own five
  sources** — are absent. Roadmap item 11(ii)'s *"22 of 22 non-test TUs"* was taken the same
  way and therefore never compiled any of them either. A harness faithful to the plan's letter
  would have reported on remill and been read as reporting on elflift.
- **Fix:** `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` passed on the cmake command line, which writes
  the **cache** variable at top-level scope and is inherited by `lifter/` and `tests/`.
  Database grows 27 → 38; the five appear; skip rules absorb the six new test/`_deps` entries
  and one duplicate with reasons recorded.
- **Files modified:** `tools/aot/elflift-wasi-gate.sh`
- **Commit:** `33f32b5`

**2. [Rule 3 — Blocking] `REMILL_ARCH` / `REMILL_OS` do not arrive as `-D` flags**

- **Found during:** Task 1, first compile attempt.
- **Issue:** The plan states these *"arrive as `-D` flags from `compile_commands.json`, so the
  allowlist must keep every `-D` unconditionally."* Keeping every `-D` is right and was done;
  the premise is wrong. `remill/Arch/Name.h` keys off `__aarch64__` and `remill/OS/OS.h` off
  `__linux__`, neither defined under `--target=wasm32-wasi`, so all 27 TUs died at
  `Name.h:82: "Cannot infer current architecture."` before anything interesting.
- **Fix:** Thirteen defines **added** (not carried), mirroring what the native aarch64 Linux
  build resolves to, reported as `addedFlags` distinct from the carried set, and guarded by a
  control recompile that withholds them and is asserted to fail at that exact `#error`.
- **Files modified:** `tools/aot/elflift-wasi-gate.sh`, `tools/aot/elflift-wasi-gate.node.test.ts`
- **Commit:** `33f32b5`

**3. [Rule 3 — Blocking] `llvm-config-16 --libnames` answers a shared object here**

- **Found during:** Task 1, reading B.
- **Issue:** The plan says to resolve reading B's archives via
  `llvm-config-16 --libnames support core irreader bitreader bitwriter passes`. This image
  builds LLVM with `LLVM_LINK_LLVM_DYLIB`, so that command answers `libLLVM-16.so` — one
  shared object, whose `nm --undefined-only` set is its *dynamic imports*, a reading of a
  different thing.
- **Fix:** `--link-static` added; resolves to the 37-archive transitive closure, recorded in
  `archives-B.txt` and in the report.
- **Files modified:** `tools/aot/elflift-wasi-gate.sh`
- **Commit:** `33f32b5`

**4. [Rule 3 — Blocking] The obvious name for a shell-split element is blocked repository-wide**

- **Found during:** Task 2 verification, the pre-commit guard batch.
- **Issue:** `packages/node/src/vocabulary.node.test.ts` blocks the singular and plural of a
  term that also names a unit of cryptocurrency, as cryptojacking vocabulary — *"reads as
  cryptocurrency to a reviewer who does not stop to check the sense."* The python helper that
  splits a compile command used it five times. Guard exit **1**, five findings named with file
  and line.
- **Fix:** renamed to `words` / `word`, and the comment `element 0 is the compiler`, with the
  reason recorded in the function's docstring so it is not renamed back. Guards re-run: exit 0,
  267 passed. Gate spec re-run: exit 0, 8 passed.
- **Second finding, from the same guard, on this summary.** A first draft of this section
  quoted the blocked term while explaining it, and the guard refused the docs commit for
  exactly that — **7 findings, this file, by line**. Reworded to describe rather than quote.
  The guard is right and the inconvenience is the point: a reviewer greps, and a grep does not
  read the surrounding sentence.
- **Files modified:** `tools/aot/elflift-wasi-gate.sh`, this summary
- **Commit:** `33f32b5` (harness), the docs commit carrying this summary (prose)

### Deliberate departures from the plan's letter, with reasons

**5. A second compile arm was added: `wasm32-wasi-threads`.** Not in the plan. Added because
the preview1 arm's twenty-one failures all read `"<thread> is not supported"`, and a report
carrying only that text would have been read as *"elfconv needs threads"* — while Plan 26-01
explicitly recorded that the threads sysroot was **not measured** and scoped all its
thread-family absences accordingly. The arm costs ~60 s and settles it: threads do not unblock
the build. Without it, Plan 26-03's verdict would have had to guess at the cause of its own
central finding.

**6. Two families were added to the plan's nine: `linker-provided` and `compiler-rt`.**
Corrections, not decoration. `__stack_pointer`, `__memory_base`, `__table_base`,
`__indirect_function_table` and `__dso_handle` are synthesised by `wasm-ld`; `__multi3`,
`__clear_cache` and the `__aarch64_*` atomics come from the compiler runtime. Leaving them in
`other` would have counted eight linker- and compiler-supplied symbols as unresolvable gaps in
a report whose whole job is to say what is unresolvable. The join with 26-01's family names is
stated in the harness: its `jumps` is this plan's `non-local-jumps`, its `dynamic` is
`dynamic-loading`.

**7. Per-symbol archive-member attribution (`memberOf`) was added.** Not in the plan. Added
because an archive-wide undefined set is an **upper bound on what a link demands** — a link
pulls in only the members it needs — and a report naming `fork` without naming `Program.cpp.o`
invites exactly the overstatement this plan's honesty requirement forbids. It also turns out
to be the most actionable number in the report: `fork` has `count: 1` and `__cxa_throw` has
`count: 102`.

**8. `includedFrom` was added per TU.** Not in the plan. Without it the report's `errorFile`
names wasi-sdk's libc++ and the finding reads as *"the toolchain refused"*; with it the finding
is *"glog's logging.h asked for `<thread>`"*, which is a different claim and the correct one.

**9. Reading A's liveness floor could not be met, and the plan's acceptance criterion was
honoured in spirit rather than in letter.** The plan requires *"for every reading present,
`undefinedCount > 100` is asserted before that reading's residue is examined."* Readings A and
AT come in at **5**. Asserting `> 100` for them would fail the suite; dropping the assertion
would let a blind reading pass as evidence. The spec therefore asserts the **disjunction**:
each reading is either alive with `undefinedCount > livenessFloor`, or `alive: false` with a
non-empty `insufficientReason` **and** its label in a recorded `EXPECTED_INSUFFICIENT_READINGS`
list checked by exact equality — plus a floor that at least one reading must be alive. A
reading that becomes alive goes red and forces a re-take. Their residues are never examined.

**10. `unitTests` and `unitWallClockMs` were NOT retaken**, unlike in 26-01 where a direct
`npm run test:unit` cross-check was owed by a claim that plan's own docblock made. This plan
makes no such claim: `unitFiles` did not move, its derivation produces the same 116 the
observation was taken against, and inventing a reason to spend a green run would not have made
the field stronger. Recorded as an inherited observation rather than a fresh one.

## Known Stubs

None. Every value the spec asserts is read from a file the container wrote in the run being
asserted about. No component is wired to empty or placeholder data.

## Threat Flags

None. The three trust boundaries the plan's threat model names are the ones this plan builds
against, and the five registered threats are dispositioned as the register says:

- **T-26-06** (tampering with the working tree) — `/repo` mounted `:ro`, harness piped on
  stdin, all writes to `/out` or the container's own `/root/elfconv`.
- **T-26-07** (a GO from an instrument that read nothing) — per-reading `nm` exit codes,
  per-reading liveness floor asserted before any residue is read, and **the one reading that
  failed the floor is reported as an instrument failure rather than as an empty residue**. This
  threat was not hypothetical: readings A and AT actually tripped it.
- **T-26-08** (reading C's provenance) — archive list, Emscripten-not-WASI nature, 17-vs-16
  skew and `libLLVMPasses.a`'s absence all recorded; the null path exercised and verified.
- **T-26-09** (symbol lists in a committed report) — accepted; `gate.json` lives in a temp
  directory and is not committed, and the names quoted here are public LLVM and libc symbols.
- **T-26-10** (container run cost) — accepted; 137 s measured against the differential's
  331 010 ms.

No new endpoint, auth path, file access pattern or schema at a trust boundary was introduced.

## What This Does NOT Establish

Stated because Plan 26-03 will be tempted to read more into it.

- **No `elflift.wasm` exists.** Nothing was linked. Producing one needs LLVM, gflags, glog and
  XED cross-compiled to `wasm32-wasi`, and `26-CONTEXT.md` precondition 3 establishes no
  `wasm32-wasi` LLVM exists on this host.
- **The compile measurement cannot see past glog.** Twenty-one TUs abort at the first glog
  include, so **nothing downstream of it in those TUs was type-checked** — not remill's code,
  not the lifter's, not LLVM's headers. Whether glog is the only wall or the first of several
  is unmeasured, and this plan cannot say. A report claiming "only glog blocks it" would be
  claiming something the instrument could not see.
- **A residue is an upper bound on a link's demands, in both readings.** A non-empty residue
  does **not** prove the link fails; `wasm-ld` pulls only the members it needs, and every
  process/signal symbol here lives in five members of LLVMSupport. Equally, an empty residue
  would not prove it succeeds. **The plan's framing that "a NO-GO is conclusive" holds for the
  compile half and does not hold for the symbol half** — that is the one place this summary
  disagrees with the plan it executed, and it disagrees on the side of claiming less.
- **Reading C is Emscripten and LLVM 17.** `__EMSCRIPTEN__` branches were taken and `__wasi__`
  ones were not; its whole `non-local-jumps` family is Emscripten SjLj ABI that does not carry
  to a WASI build; its 102-member `__cxa_throw` reflects that build having exceptions on,
  against LLVM's own `LLVM_ENABLE_EH=OFF` default.
- **The six passing TUs prove only what six objects can.** They compile for `wasm32-wasi` and
  demand nothing preview1 lacks. They total **1 203 486 bytes**, of which `Extract.cpp` alone is
  **98.8 %** — and `Extract.cpp` is generated decode tables, which is why its 1.19 MB
  contributes only three of reading A's five undefined symbols. What fraction of a *complete*
  elflift they represent is **not measured here**, because no complete elflift object set for
  this target exists to compare against.

## Self-Check: PASSED

- `tools/aot/elflift-wasi-gate.sh` — FOUND (691 lines, mode 100755, ≥ 160 required)
- `tools/aot/elflift-wasi-gate.node.test.ts` — FOUND (698 lines, ≥ 140 required)
- `vitest.config.ts` — FOUND, modified
- commit `33f32b5` — FOUND in `git log`; `git show --stat` lists exactly the three files in
  `files_modified` and nothing else
- `key_links` pattern `cp -a .*lifter` — present in the harness (`cp -a "$SRC/lifter/." …`)
- `key_links` pattern `provided` — present in the harness (`provided.txt`, `PROVIDED_COUNT`)
- `AOTW-04` and `AOTW-05` each present in ≥ 1 running test title
- working tree clean after commit
