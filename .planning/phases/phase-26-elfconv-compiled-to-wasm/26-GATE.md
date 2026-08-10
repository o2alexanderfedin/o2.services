# Phase 26 Gate — `elflift` on `wasm32-wasi`

**Written:** 2026-08-10 (Plan 26-03)
**Source of every figure:** `gate.json`, emitted by `tools/aot/elflift-wasi-gate.sh` inside
`ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05`.
The report is written to a temp directory and is not committed (T-26-09), so it was
**regenerated in this plan's own container run** and every number below read out of that
file directly rather than copied from `26-02-SUMMARY.md`. Harness exit **0**;
`replay: 38 entries, 11 skipped, 27 attempted per arm`; `6/27 TUs produced an object for
wasm32-wasi, provided=3963` — the same readings 26-02 recorded, from an independent run.

---

## 1. The verdict

NO-GO for `elflift` on `wasm32-wasi` as the tree stands.

The blocking wall is **glog**, and it is a compile wall rather than a symbol wall. Twenty-one
of twenty-seven non-test translation units produce no object; all twenty-one stop at the same
first error, and all twenty-one name the same include-chain root —
`/root/elfconv/dependencies/install/include/glog/logging.h:51:`, which is `#include <thread>`.
The second arm settles what that error means: under `wasm32-wasi-threads -pthread` the same
twenty-one units fail one line deeper, at `glog/platform.h:58` — *"Platform not supported by
glog."* glog's platform-detection chain covers Windows, Cygwin, Linux, Android, macOS, the BSDs
and Emscripten, and carries **no `__wasi__` branch at all**. Separately, and in the symbol half,
the process and signal residue that survives the preview1 subtraction is named below and is
real in both alive readings: `fork`, `execv`, `execve`, `posix_spawn` (with its four
`file_actions` entry points), `wait`, `__syscall_wait4`, `kill`, `sigaction`, `sigprocmask`,
`__cxa_allocate_exception`, `__cxa_throw`.

---

## 2. Scope of the verdict

**The two halves of this gate are not equally strong, and the difference is the most important
sentence in this document.**

**The compile half is conclusive and it is a negative.** Twenty-one translation units do not
compile; the cause is a named third-party header with no wasm platform branch; the threads
sysroot moves the error and does not remove it. No amount of additional build time changes
that. A symbol preview1 does not have will not appear because the build ran longer, and a
header that refuses the platform will not stop refusing it.

**The symbol half is an upper bound and is conclusive in NEITHER direction.**
`llvm-nm --undefined-only` over an *archive* reads every member; a link pulls in only the
members it needs. The entire process/signal/non-local-jump residue lives in a handful of
LLVMSupport members — `Program.cpp.o`, `Signals.cpp.o`, `CrashRecoveryContext.cpp.o`,
`Process.cpp.o`, `LockFileManager.cpp.o`, `Watchdog.cpp.o` — so a non-empty residue does **not**
prove the link fails, and an empty residue would **not** prove it succeeds. Plan 26-02's own
plan asserted that "a NO-GO is conclusive"; its executor claimed less, on measurement, and that
correction is carried here deliberately rather than being smoothed back out.

**A GO, had this been one, would have been necessary and not sufficient.** It would say nothing
about whether LLVM, gflags, glog and XED cross-compile to `wasm32-wasi`. Precondition 3 of
`26-CONTEXT.md` establishes that **no `wasm32-wasi` LLVM exists on this host** — the only
cross-compiled LLVM here is Emscripten-targeted, whose output needs JS glue and cannot be guest
code under this project's preview1 sandbox.

**The measurement cannot see past glog.** Twenty-one units abort at the first glog include, so
nothing downstream of it in those units was type-checked — not remill's code, not the lifter's,
not LLVM's headers. **Whether glog is the only wall or the first of several is UNMEASURED**, and
this document does not say "only glog blocks it", because the instrument could not see that.

**No `elflift.wasm` was produced by this phase and none is claimed.** Nothing was linked.

---

## 3. What was measured

### The configure

| Field | Reading |
|---|---|
| `cmakeExit` | 0 |
| `foundLlvmLine` | `-- Found LLVM 16.0.6` |
| `llvmLibrariesLine` | `-- LLVM Libraries: LLVM` |
| `clangVersion` | `clang version 18.1.2-wasi-sdk (https://github.com/llvm/llvm-project 26a1d6601d727a96f4301d0d8647b5a42760ae0c)` |
| `wasiSdkPath` | `/root/wasi-sdk-24.0-arm64-linux` |
| `entriesTotal` | 38 |
| `entriesSkipped` | 11 |
| `tus` (per arm) | 27 |

`LLVM Libraries: LLVM` is a finding rather than boilerplate: this image builds LLVM with
`LLVM_LINK_LLVM_DYLIB`, so the fork's six-component list at
`backend/remill/CMakeLists.txt:53-57` is short-circuited and never evaluated.

**The eleven skips, by the reason string each carries:** 5 for remill's own AArch64 test target,
4 for vendored googletest under `_deps/`, 1 for the elfconv integration-test target, and 1 for a
duplicate source path (`utils/Util.cpp`, which appears under two targets).

**The added-flag control.** `REMILL_ARCH` / `REMILL_OS` / the `REMILL_ON_*` set do **not** arrive
from `compile_commands.json`; thirteen defines are added by the harness and reported separately
as `addedFlags`. The control recompile that withholds them reads
`addedFlagsControl.exit` **1**, `firstError`
`remill/Arch/Name.h:82:6: error: "Cannot infer current architecture."` — so the flag list is
doing work rather than sitting inert.

### The TU replay

| Arm | attempted | produced an object | failed | first error | include-chain root |
|---|---|---|---|---|---|
| `wasm32-wasi` | 27 | **6** | **21** | `"<thread> is not supported since libc++ has been configured without support for threads."` (wasi-sysroot's own `c++/v1/thread:92:4`) | `glog/logging.h:51:` |
| `wasm32-wasi-threads -pthread` | 27 | **6** | **21** | `glog/platform.h:58:2: error: Platform not supported by glog.` | `glog/flags.h:48:` |

One distinct first error and one distinct include-chain root per arm — all twenty-one identical
within their arm — and the **failing file sets of the two arms are equal**, asserted rather than
eyeballed.

**The six that produced an object**, named rather than left as `27 − 21`:

| TU | bytes |
|---|---|
| `backend/remill/lib/Arch/Name.cpp` | 7 584 |
| `backend/remill/lib/Arch/AArch64/Extract.cpp` | 1 189 222 |
| `backend/remill/lib/BC/ABI.cpp` | 2 467 |
| `backend/remill/lib/OS/Compat.cpp` | 301 |
| `build/backend/remill/lib/Version/Version.cpp` | 3 110 |
| `utils/Util.cpp` | 802 |

They are exactly the six that never reach `glog/logging.h`.

**The twenty-one that failed:** `backend/remill/lib/Arch/Arch.cpp`,
`Arch/Instruction.cpp`, `Arch/Context.cpp`, `Arch/AArch64/Arch.cpp`, `Arch/AArch64/Decode.cpp`,
`Arch/Sleigh/AArch64Base.cpp`, `BC/Annotate.cpp`, `BC/ForkEmulation.cpp`,
`BC/InstructionLifter.cpp`, `BC/IntrinsicTable.cpp`, `BC/Optimizer.cpp`, `BC/TraceLifter.cpp`,
`BC/Util.cpp`, `BC/VroTraceLifter.cpp`, `BC/VroInstructionLifter.cpp`, `OS/FileSystem.cpp`,
`OS/OS.cpp`, and elfconv's own `lifter/Binary/Loader.cpp`, `lifter/MainLifter.cpp`,
`lifter/TraceManager.cpp`, `lifter/Lift.cpp`.

### The provided set

`nmExits.provided` **0**; `providedCount` **3963** — Plan 26-01's figure exactly, regenerated in
the same container run as the subtraction rather than carried across runs.

### The four readings

`livenessFloor` **100**; `otherFamilyCut` **200**; `memberAttributionCut` **12**. Nothing was
truncated in this run — every reading's `truncated` map is empty.

| Reading | archives / objects | undefined | defined | residue | alive |
|---|---|---|---|---|---|
| **A** — objects this run emitted, `wasm32-wasi` | 6 | 5 | 46 | 1 | **false** |
| **AT** — objects this run emitted, `wasm32-wasi-threads` | 6 | 5 | 46 | 1 | **false** |
| **B** — host LLVM 16 static closure + gflags/glog/XED | 40 | 10 844 | 53 047 | **262** | true |
| **C** — wasm-compiled LLVM 17 archives | 5 | 2 116 | 13 434 | **85** | true |

A and AT carry `insufficientReason`: *"undefinedCount 5 is at or below the liveness floor of
100; this reading is reported but no absence may be concluded from it."* **Their residues are
not read in this verdict.** Their five undefined symbols are `__stack_pointer`, `abort`,
`memcmp`, `strlen`, `vprintf`; four are in the provided set and the fifth is linker-supplied.

Reading C's archive list: `libLLVMSupport.a`, `libLLVMCore.a`, `libLLVMIRReader.a`,
`libLLVMBitReader.a`, `libLLVMBitWriter.a`. `readingCNull` is `null`,
`readingCMissingArchives` is `[]`, and `readingCPassesPresent` is **false** — `libLLVMPasses.a`
is one of the six the fork's CMakeLists names and the wasm build does not have it. Reading B's
host closure **does** carry `libLLVMPasses.a`, which is part of why B is wider.

### Per-family residue

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

`other` is 180 in B (152 mangled + 28 plain) and 37 in C (31 mangled + 6 plain). Neither reached
`otherFamilyCut` of 200, so **nothing was truncated**.

### Every residue member in the seven named families, named in full

**Reading C** — real wasm objects, the closest reading:

| family | members |
|---|---|
| process (11) | `__syscall_wait4`, `execv`, `execve`, `fork`, `getsid`, `posix_spawn`, `posix_spawn_file_actions_adddup2`, `posix_spawn_file_actions_addopen`, `posix_spawn_file_actions_destroy`, `posix_spawn_file_actions_init`, `wait` |
| signals (8) | `alarm`, `kill`, `sigaction`, `sigaddset`, `sigaltstack`, `sigemptyset`, `sigfillset`, `sigprocmask` |
| non-local-jumps (7) | `__THREW__`, `__threwValue`, `emscripten_longjmp`, `getTempRet0`, `invoke_ii`, `invoke_vi`, `setTempRet0` |
| unwinding (2) | `__cxa_allocate_exception`, `__cxa_throw` |
| dynamic-loading (0) | — none |
| sockets (1) | `gethostname` |
| threads (9) | `std::__2::this_thread::sleep_for`, `std::__2::recursive_mutex` ctor and dtor, `std::__2::condition_variable::wait` and dtor, `std::__2::__shared_mutex_base` ctor, `std::__2::mutex::lock`, `std::__2::mutex::unlock`, `std::__2::mutex` dtor (all nine appear mangled in `gate.json`) |

**Reading B** — the upper bound:

| family | members |
|---|---|
| process (13) | `execv`, `execve`, `fork`, `getsid`, `pclose`, `popen`, `posix_spawn`, `posix_spawn_file_actions_adddup2`, `posix_spawn_file_actions_addopen`, `posix_spawn_file_actions_destroy`, `posix_spawn_file_actions_init`, `wait`, `wait4` |
| signals (8) | `alarm`, `kill`, `sigaction`, `sigaddset`, `sigaltstack`, `sigemptyset`, `sigfillset`, `sigprocmask` |
| non-local-jumps (2) | `__longjmp_chk`, `_setjmp` |
| unwinding (10) | `_Unwind_Backtrace`, `_Unwind_GetIP`, `_Unwind_Resume`, `__cxa_allocate_exception`, `__cxa_begin_catch`, `__cxa_end_catch`, `__cxa_free_exception`, `__cxa_rethrow`, `__cxa_throw`, `__gxx_personality_v0` |
| dynamic-loading (2) | `dl_iterate_phdr`, `dladdr` |
| sockets (1) | `gethostname` |
| threads (30) | `pthread_attr_destroy`, `pthread_attr_init`, `pthread_attr_setstacksize`, `pthread_create`, `pthread_detach`, `pthread_getname_np`, `pthread_join`, `pthread_mutex_lock`, `pthread_mutex_unlock`, `pthread_once`, `pthread_rwlock_destroy`, `pthread_rwlock_init`, `pthread_rwlock_rdlock`, `pthread_rwlock_unlock`, `pthread_rwlock_wrlock`, `pthread_self`, `pthread_setname_np`, `pthread_setschedparam`, `pthread_sigmask`, `sched_getaffinity`, `__sched_cpualloc`, `__sched_cpucount`, `__sched_cpufree`, `__libc_single_threaded`, `__once_proxy`, and five `std::condition_variable` members (`notify_all`, `notify_one`, `wait`, ctor, dtor) |

### Where the residue lives — the attribution that keeps this honest

`memberOf` names the archive member that references each symbol, with its true count beside it.

| member | what it brings (reading C unless noted) |
|---|---|
| `Program.cpp.o` | `fork`, `execv`, `execve`, `posix_spawn` + all four `file_actions`, `wait`, `__syscall_wait4` (`wait4` in B), `alarm`, `kill`, `sigaction`, `sigemptyset` |
| `Signals.cpp.o` | `sigaltstack`, `sigfillset`, `sigprocmask`, `sigaction`, `sigemptyset`; in B also `_Unwind_Backtrace`, `_Unwind_GetIP`, `dl_iterate_phdr`, `dladdr` |
| `CrashRecoveryContext.cpp.o` | the whole `non-local-jumps` family — all seven Emscripten SjLj symbols in C, `_setjmp` / `__longjmp_chk` in B — plus `sigaction`, `sigaddset`, `sigemptyset`, `sigprocmask` |
| `Process.cpp.o` | `sigfillset`, `sigprocmask` |
| `LockFileManager.cpp.o` | `getsid`, `gethostname` |
| `Watchdog.cpp.o` | `alarm` |

`fork`, `execve` and `posix_spawn` each read `count: 1` in **both** alive readings — one member
apiece. By contrast `__cxa_throw` reads `count: 102` in reading C, which is a statement about
that build having exceptions enabled rather than about LLVM needing them; LLVM's own default is
`LLVM_ENABLE_EH=OFF`.

**One attribution belongs to glog rather than to LLVM, and it is new here.** In reading B,
`popen` and `pclose` are referenced by `logging.cc.o`, and `kill`, `sigaction` and `sigemptyset`
are referenced by `signalhandler.cc.o` and `utilities.cc.o` — all three are **glog's own
members**. glog is therefore both the compile wall and a process/signal consumer in the upper
bound. Reading C, which has no glog in it, shows none of those attributions.

---

## 4. The readings and their biases

**Reading A / AT — refused as evidence, by the instrument's own disposition.** Twenty-one of
twenty-seven units produced no object, so these readings cover six small objects and five
undefined symbols. A residue of one over five symbols is not "elfconv demands nothing preview1
lacks" — it is an instrument that barely read. The harness records `alive: false` with a reason,
and the spec asserts that disposition against a recorded list, so the day the compile arm starts
producing objects the disposition goes red and must be re-taken.

**Reading B — overstates.** Host ELF objects built with `LLVM_ON_UNIX`, so its `#ifdef` branches
are the Unix ones. Its `other` family carries `ZSTD_*`, zlib, ncurses (`setupterm`, `tigetnum`,
`del_curterm`), `syslog`/`openlog`/`closelog`, `backtrace` and `syscall` — host-library
references a wasm build would not make. An upper bound, biased in the safe direction.

**Reading C — closer, and still not the target.** Real wasm objects, but:

- **Emscripten, not WASI.** `__EMSCRIPTEN__` branches were taken and `__wasi__` ones were not.
  Its entire `non-local-jumps` family is Emscripten SjLj ABI (`__THREW__`, `emscripten_longjmp`,
  `invoke_ii`, …) which does not carry to a WASI build; under wasi-sdk the equivalents are
  `__wasm_setjmp`, `__wasm_setjmp_test`, `__wasm_longjmp` and `__c_longjmp`, all four measured
  **present** by Plan 26-01. Those seven symbols are therefore **not reported here as preview1
  blockers**.
- **LLVM 17.0.6 against the image's 16.0.6.**
- **Missing `libLLVMPasses.a`** — one of the six libraries `backend/remill/CMakeLists.txt:53-57`
  names, whose absence that file's own comment already records. `Optimizer.cpp`'s use of the new
  PassManager may sit behind it.

Reading C was **not** null in this run (`readingCNull: null`), so the verdict does not have to
rest on B alone. The null path exists and was exercised separately by Plan 26-02: with the
archive directory unmounted the harness records the reason, emits `readings.C === null`, and
exits 0 — it degrades, it does not break.

---

## 5. What roadmap items 7 and 8 now say

**Item 7 — MEASURED, and it did not hold.** The item read: the clang *driver* needed WASIX
because a driver spawns `cc1` and a linker, while `elflift` links LLVM as a *library* and so may
need no fork/exec. It was marked *INFERRED, NOT YET MEASURED*. It is now measured and **false as
stated**: the fork/exec is not a property of being a driver, it is **inside LLVMSupport's
`Program.cpp`**, which `elflift` links as a library. `fork`, `execve` and `posix_spawn` each read
`count: 1` in both alive readings, attributed to `Program.cpp.o`.

Two qualifications on that, both of which matter:

1. **This does not establish that `elflift` calls them.** A link pulls in only the members it
   needs, and `Program.cpp.o` is one member of one archive. Whether the elflift link drags it in
   is unmeasured — nothing was linked.
2. **elflift's own demand for fork/exec is unmeasured entirely**, because the compile stops at
   glog before any of the lifter's code is type-checked.

**Item 8 — NOT TESTED BY THIS PHASE.** Item 8 is the inference that stage 2 also avoids the
driver, because `llc` and `wasm-ld` are single-process library-shaped tools. This phase measured
nothing about stage 2. Item 8 remains *INFERRED, NOT YET MEASURED* and item 7's answer does not
carry over to it — the two inferences share a shape and not an outcome.

**Item 11(ii) is also falsified, and item 11(i) is weakened.** Both corrections are made in place
in `ROADMAP.md`, dated, with the original text preserved. 11(ii)'s *"22 of 22 non-test TUs pass,
0 fail"* measured the wrong population: `backend/remill/cmake/settings.cmake:25` sets
`CMAKE_EXPORT_COMPILE_COMMANDS` as a directory-scoped normal variable inside remill's own
`project()`, so the default database covers the remill subtree only and never contained elflift's
own five sources. The real figure is **6 pass / 21 fail of 27**. 11(i)'s "the cost collapsed"
framing is weakened because the neighbouring wasm LLVM is Emscripten-targeted, is a measuring
instrument rather than a dependency, and supplies none of the missing pieces.

---

## 6. Stage 2, priced and not built

The roadmap entry requires the two stages be stated up front and priced separately. Stage 2 is
bitcode → object → wasm: `llc` and `wasm-ld`. It is **not built by this phase and nothing here
was measured about it.**

**What is in hand that lowers its price.** elfconv's C++ runtime sources — `Entry.cpp`,
`Memory.cpp`, `Runtime.cpp`, `VmIntrinsics.cpp`, `Util.cpp`, `elfconv.cpp`, `SyscallWasi.cpp` —
**do not change per job**. They can be compiled to bitcode once, natively, and shipped as a fixed
input, which removes the C++ frontend from the fabric path entirely and leaves a backend and a
linker. Roadmap item 8 already records this and marks it inferred.

**The price, in this project's own currency.**

| Cost | Estimate, and where it comes from |
|---|---|
| LLVM cross-build | **A wasm32-wasi LLVM does not exist on this host and must be built from source** (precondition 3). This is the dominant cost and it is shared with stage 1 — paying it once serves both. Hours of compute, not minutes; the neighbouring Emscripten build of LLVM 17 is the only local evidence of the shape of that job and it targets the wrong ABI. |
| Additional dependency ports | Stage 2 needs **fewer** than stage 1: `llc` and `wasm-ld` want LLVM and LLD, and neither wants gflags, glog or XED. Stage 1's blocking dependency — glog — **is not on stage 2's path at all.** That is the single most useful thing this gate says about stage 2, and it is an inference from the dependency list rather than a measurement. |
| `LLVM_ENABLE_PROJECTS` | `lld` must be added; `clang` and `clang-tools-extra` are not needed. Smaller than the clangd recipe roadmap item 10 cites. |
| Target data | `wasm-ld` needs the WebAssembly backend, which is exactly what the local Emscripten build already enables (`LLVM_TARGETS_TO_BUILD=WebAssembly`). Stage 2 does **not** need AArch64 or X86 target data; stage 1 may. |
| The 4 GB ceiling | Unexercised. `llc` on a 4.4 MB bitcode input is the workload to size it against, and that measurement has not been taken. |
| Plan and context cost | A gate of its own, on the shape of 26-01 plus 26-02: one plan to pin and read the toolchain surface, one to run the experiment, one to write the verdict. Three plans, three waves, each with its own container harness and its own recorded tables. |

**Stage 2 is therefore cheaper than stage 1 on dependencies and identical to it on the LLVM
cross-build**, and the LLVM cross-build is the part nobody has paid.

---

## 7. What was not measured

Stated because a reader will otherwise infer it from section 3.

- **No linked `elflift.wasm` exists.** Nothing was linked. The harness compiles translation units
  and reads symbols out of archives; it never invokes `wasm-ld`.
- **No LLVM, gflags, glog or XED cross-build was attempted.** Precondition 3 establishes that no
  `wasm32-wasi` LLVM exists on this host.
- **Whether glog is the only wall or the first of several.** Twenty-one units abort at the first
  glog include, so remill's code, the lifter's code and LLVM's headers were never type-checked
  under `--target=wasm32-wasi`.
- **Whether the elflift link would actually pull in `Program.cpp.o`.** The residue is an
  archive-wide reading and therefore an upper bound on a link's demands.
- **elflift's own demand for fork, exec, signals or longjmp.** Unmeasured, for the reason above.
- **Reading C's Emscripten-versus-WASI delta is unquantified.** It is stated as a bias and not
  measured as a number.
- **Stage 2 is untested** — no `llc`, no `wasm-ld`, no bitcode-to-wasm run of any kind.
- **The 4 GB wasm32 ceiling is not exercised.** Roadmap item 5 leaves it open and this phase does
  not close it. No LLVM workload was run under wasm32 at all.
- **The `sha256`-identical bitcode comparison against native elfconv** — the phase's actual
  deliverable, AOTW-06 — was never attempted, because there is no wasm `elflift` to run.
- **What fraction of a complete elflift the six passing objects represent.** They total
  1 203 486 bytes, of which `Extract.cpp` alone is 98.8 %, and no complete elflift object set for
  this target exists to compare against.
