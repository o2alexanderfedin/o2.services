import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE GATE, judged as a measurement rather than as a verdict.
 *
 * Phase 26 turns on one question, and its roadmap entry says of it: *"a negative here changes
 * the whole shape of the work."* Can `elflift` be built for `wasm32-wasi`, and if not, which
 * symbol blocks it. **This file does not answer that question — Plan 26-03 does, out of
 * `gate.json`. What this file establishes is that `gate.json` is worth answering it from.**
 *
 * That distinction is the whole design. Every case below asks "did the instrument read
 * something", never "is the answer the one we wanted". The recorded tables are checked against
 * the live report element for element, so a sysroot change, an LLVM change or a hand-edit goes
 * red and names what moved — but none of them encodes a preferred outcome. `EXPECTED_TU_FAILURES`
 * currently holds **twenty-one entries**, and it holds them because that is what the replay
 * measured, not because a clean replay was hoped for and missed.
 *
 * ## AOTW-04 — elflift's own translation units, compiled for wasm32-wasi
 *
 * Twenty-seven non-test translation units, each with its own exit code, its own first error
 * line and its own produced-object size. **`objectBytes` is the evidence, not the exit code** —
 * this project's standing rule about elfconv exiting `0` on binaries it could not translate,
 * turned around and pointed at the compiler doing the porting.
 *
 * **Twenty-seven, not twenty-two, and the difference is a finding rather than a rounding.**
 * Roadmap item 11(ii)'s "22 of 22 non-test TUs" was taken from `compile_commands.json` as cmake
 * writes it by default — and that database covers **only the remill subtree**, because
 * `backend/remill/cmake/settings.cmake:25` sets `CMAKE_EXPORT_COMPILE_COMMANDS` as a
 * directory-scoped normal variable inside remill's own `project()`. So the twenty-two never
 * included `lifter/Binary/Loader.cpp`, `lifter/MainLifter.cpp`, `lifter/TraceManager.cpp`,
 * `lifter/Lift.cpp` or `utils/Util.cpp` — **elflift's own sources, every one of them**. The
 * harness passes `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` on the command line, which writes the
 * cache variable at top-level scope; the database grows 27 entries → 38 and the five appear.
 *
 * ## AOTW-05 — the residue, read four ways, with each reading's bias stated
 *
 * A single reading would encode one toolchain's `#ifdef`s and pass as the answer.
 *
 * - **A** — the objects this run emitted for `wasm32-wasi`. Authoritative for elfconv's and
 *   remill's own code and for nothing else, and **only as wide as the arm managed to compile**.
 * - **AT** — the same for `wasm32-wasi-threads`. Present because Plan 26-01 scoped every
 *   thread-family absence it reported to the non-threads sysroot and never read this one, so
 *   without it a failure whose text names `<thread>` could be misread as "elfconv needs
 *   threads" when the question is whether the threads sysroot unblocks the build at all.
 * - **B** — host LLVM 16.0.6 static archives in the image, plus gflags, glog and XED. Host ELF
 *   objects built with `LLVM_ON_UNIX`, so this **OVERSTATES** what a wasm build would demand:
 *   an upper bound, biased in the safe direction.
 * - **C** — the wasm-compiled LLVM 17.0.6 archives in the neighbouring checkout. Real wasm
 *   objects, so much closer to a wasi build than B — but **Emscripten, not WASI** (so
 *   `__EMSCRIPTEN__` branches were taken and `__wasi__` ones were not) and **17.0.6 against the
 *   image's 16.0.6**. Both caveats are in the report and both belong in the verdict.
 *
 * **A and AT are NOT ALIVE and this file says so rather than letting their empty residues
 * read as good news.** Twenty-one of twenty-seven TUs produced no object, so those readings
 * cover six small objects and five undefined symbols between them. A residue of one over five
 * symbols is not "elfconv demands nothing preview1 lacks" — it is an instrument that barely
 * read. {@link EXPECTED_INSUFFICIENT_READINGS} records that disposition explicitly and
 * {@link it} asserts it, so the day the compile arm starts producing objects the disposition
 * goes red and has to be re-taken rather than silently inherited.
 *
 * ## The one guard the whole gate turns on
 *
 * A GO produced by an `nm` that read nothing is the worst possible outcome of this plan.
 * Per reading, `undefinedCount > livenessFloor` is asserted **before** that reading's residue
 * is examined, and a reading that fails it is reported as that reading's instrument failure
 * rather than as an empty residue. `elfconv-differential.node.test.ts:124-131` records the same
 * distinction on the `ldd` side, where this repository has already been bitten by a guard that
 * could not tell "zero matches" from "the tool did not run".
 *
 * ## What this file does NOT establish
 *
 * **There is no linked `elflift.wasm` and nothing here may be read as if there were.** The
 * harness compiles and reads symbols; it does not link. A residue read out of an ARCHIVE is
 * also an **upper bound on what a link would demand**, because a link pulls in only the members
 * it needs — which is why every named-family symbol carries `memberOf` attribution, so
 * "LLVM's archives mention `fork`" cannot be read as "elflift calls `fork`".
 *
 * Budget: see {@link HARNESS_BUDGET_MS}. Skipped entirely without Docker, and gated to arm64
 * because the image is arm64 and an emulated run would measure qemu.
 */

const SCRIPT = fileURLToPath(new URL('./elflift-wasi-gate.sh', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * The toolchain, pinned by digest rather than by tag. Same constant and same override as
 * `wasi-preview1-surface.node.test.ts:110`, so Plan 26-01's provided set and this plan's
 * subtraction cannot be taken against two different images.
 */
const IMAGE =
  process.env['ELFCONV_IMAGE_DIGEST'] ??
  'ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05'

/**
 * A MEASURING INSTRUMENT, NOT A BUILD DEPENDENCY, and the difference is load-bearing.
 *
 * `26-CONTEXT.md` forbids depending on `Projects/hupyy/...` as a build system — *"a green build
 * that only works on one laptop is the thing this project's conventions exist to refuse."*
 * Reading C does not build anything; it reads symbols out of archives that happen to be a real
 * wasm compilation of LLVM, which is a thing this host has and the image does not. **Its
 * absence must narrow the verdict, not break the run**: when the directory is missing the
 * harness records `readingCNull` with a reason and emits `readings.C === null`, and
 * {@link it} asserts exactly that disjunction. What it must never do is skip silently.
 *
 * Verified present on this host 2026-08-10: 66 archives; five of the six the fork's
 * `backend/remill/CMakeLists.txt:53-57` names are there; **`libLLVMPasses.a` is absent**,
 * exactly as that CMakeLists's own comment records.
 */
const WASM_LLVM_DIR =
  process.env['O2_WASM_LLVM_LIB'] ?? '/Volumes/ProjectsSSD/Projects/hupyy/libclang-wasm/out/build/lib'

/**
 * Sited by comparison rather than by guess.
 *
 * `wasi-preview1-surface.node.test.ts:120` allows 300 000 ms for one `llvm-nm` sweep and a
 * six-line compile. `elfconv-differential.node.test.ts:39` allows 900 000 ms for a run that
 * includes a full cold `ninja elflift` plus eight lifts. This harness sits between them: a
 * cmake reconfigure, **fifty-four** single-TU compiles across two arms, and four `llvm-nm`
 * sweeps — but **no link and no ninja**. Measured on this host, three consecutive runs:
 * `real 139.64`, `135.57`, `135.67`. 600 000 ms is therefore a ceiling on a hung container by
 * a factor of four, not an expectation.
 */
const HARNESS_BUDGET_MS = 600_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

/**
 * Plan 26-01 measured **3963** unique global symbols over the 19 preview1 archives and sited a
 * spec floor of 3000 against per-archive readings taken in the same image (`libc.a` alone is
 * 1196, so the harness's own 1000 floor would pass a scan that reached only libc).
 *
 * The same floor is used here and **the two plans' figures are compared in this comment rather
 * than asserted equal**: they are separate runs of the same extraction against the same image
 * digest, so equality is expected — and an inequality would be information about the image or
 * the extraction, not necessarily a defect. This run reads 3963, agreeing exactly.
 */
const PROVIDED_FLOOR = 3000

interface TuResult {
  readonly index: number
  readonly file: string
  readonly arm: string
  readonly exit: number
  readonly objectBytes: number | null
  readonly seconds: number
  readonly firstError: string | null
  readonly errorFile: string | null
  readonly includedFrom: string | null
  readonly droppedFlags: readonly string[]
}

interface Reading {
  readonly label: string
  readonly note: string
  readonly archives: readonly string[]
  readonly archiveCount: number
  readonly nmUndefinedExit: number
  readonly nmDefinedExit: number
  readonly undefinedCount: number
  readonly definedCount: number
  readonly residueCount: number
  readonly families: Readonly<Record<string, number>>
  readonly members: Readonly<Record<string, readonly string[]>>
  readonly memberOf: Readonly<Record<string, { readonly count: number; readonly members: readonly string[] }>>
  readonly truncated: Readonly<Record<string, { readonly total: number; readonly shown: number }>>
  readonly alive: boolean
  readonly insufficientReason: string | null
}

interface Gate {
  readonly image: string
  readonly clangVersion: string
  readonly wasiSdkPath: string
  readonly cmakeExit: number
  readonly llvmLibrariesLine: string
  readonly foundLlvmLine: string
  readonly entriesTotal: number
  readonly entriesSkipped: readonly { readonly index: number; readonly file: string; readonly reason: string }[]
  readonly addedFlags: readonly string[]
  readonly keepPrefixes: readonly string[]
  readonly addedFlagsControl: { readonly file: string; readonly exit: number; readonly firstError: string | null } | null
  readonly tus: readonly TuResult[]
  readonly threadsArm: readonly TuResult[]
  readonly providedCount: number
  readonly nmExits: { readonly provided: number }
  readonly readings: Readonly<Record<string, Reading | null>>
  readonly readingCNull: string | null
  readonly readingCPassesPresent: boolean
  readonly readingCMissingArchives: readonly string[]
  readonly livenessFloor: number
  readonly otherFamilyCut: number
  readonly memberAttributionCut: number
}

/** Paths in the report are absolute inside the container; the tables below are relative. */
const REL = (file: string): string => file.replace('/root/elfconv/', '')

/**
 * What the `wasm32-wasi` replay measured. **A RECORDED EXPECTATION, NOT A HARDCODED ZERO.**
 *
 * Roadmap item 11(ii) records "22 of 22 non-test TUs pass, 0 fail" under `em++ -fsyntax-only`.
 * That has never been measured under `wasm32-wasi`, and under `wasm32-wasi` it is **false**:
 * twenty-one of twenty-seven fail, and every one of them fails in the same place.
 *
 * **The cause is glog, and it is not the toolchain.** The error text names wasi-sdk's own
 * libc++, which is why the harness also records `includedFrom` — the last
 * `In file included from` line before the error. It reads
 * `dependencies/install/include/glog/logging.h:51:` for all twenty-one, which is
 * `#include <thread>`. wasi-sdk-24's `wasm32-wasi` libc++ is configured without threads and
 * refuses that header outright.
 *
 * Asserted by **exact equality in both directions**, so a newly-failing TU and a newly-fixed
 * one both go red.
 */
const EXPECTED_TU_FAILURES: readonly { readonly file: string; readonly errorContains: string }[] = [
  { file: 'backend/remill/lib/Arch/Arch.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/Arch/Instruction.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/Arch/Context.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/Arch/AArch64/Arch.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/Arch/AArch64/Decode.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/Arch/Sleigh/AArch64Base.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/Annotate.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/ForkEmulation.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/InstructionLifter.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/IntrinsicTable.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/Optimizer.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/TraceLifter.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/Util.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/VroTraceLifter.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/BC/VroInstructionLifter.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/OS/FileSystem.cpp', errorContains: '<thread> is not supported' },
  { file: 'backend/remill/lib/OS/OS.cpp', errorContains: '<thread> is not supported' },
  { file: 'lifter/Binary/Loader.cpp', errorContains: '<thread> is not supported' },
  { file: 'lifter/MainLifter.cpp', errorContains: '<thread> is not supported' },
  { file: 'lifter/TraceManager.cpp', errorContains: '<thread> is not supported' },
  { file: 'lifter/Lift.cpp', errorContains: '<thread> is not supported' },
]

/**
 * The six that DID produce an object, named rather than left as `27 - 21`.
 *
 * They are exactly the six that do not reach `glog/logging.h`. That is the honest scope of what
 * the compile arm proved: elfconv source compiles for `wasm32-wasi` **where it does not include
 * glog**, and the measurement cannot see past glog anywhere else.
 */
const EXPECTED_TU_PASSES: readonly string[] = [
  'backend/remill/lib/Arch/Name.cpp',
  'backend/remill/lib/Arch/AArch64/Extract.cpp',
  'backend/remill/lib/BC/ABI.cpp',
  'backend/remill/lib/OS/Compat.cpp',
  'build/backend/remill/lib/Version/Version.cpp',
  'utils/Util.cpp',
]

/**
 * The threads arm, which closes Plan 26-01's third qualification.
 *
 * Wave 1 scoped every thread-family absence to `wasm32-wasi` without threads and said the
 * threads sysroot was unmeasured. It is measured now, and the answer is **no**: the SAME
 * twenty-one translation units fail, one error deeper. `<thread>` compiles, and then
 * `glog/platform.h:58` refuses on its own account —
 * *"Platform not supported by glog"* — because glog's platform detection has branches for
 * Windows, Cygwin, Linux, Android, macOS, the BSDs and **Emscripten**, and none for `__wasi__`.
 *
 * So the blocker is not the absence of threads. It is that **glog does not support this
 * platform at all**, and the threads sysroot merely moves the error from libc++ to glog.
 */
const EXPECTED_THREADS_ARM_ERROR = 'Platform not supported by glog'

/**
 * Which readings are reported but must not be believed, and why.
 *
 * Recorded as data rather than as a comment so that a reading becoming alive — which is what
 * would happen the day the compile arm starts producing objects — goes RED and forces a
 * re-take, instead of quietly inheriting a disposition taken when the instrument was blind.
 */
const EXPECTED_INSUFFICIENT_READINGS: readonly string[] = ['A', 'AT']

/**
 * The residue classification, recorded, and checked against the live report element for
 * element. A sysroot change, an LLVM change, or a hand-edit here goes red and names the row.
 *
 * Read the shape before the numbers. **`process` and `signals` are non-empty in BOTH alive
 * readings and they agree**: reading B (host ELF, upper bound) and reading C (real wasm
 * objects) both come back with `fork`, `execv`, `execve`, `posix_spawn`, `wait`, `kill`,
 * `sigaction` and `sigprocmask`. That is the roadmap's item-7 inference meeting a measurement,
 * and it does not land where the inference expected: the fork/exec is in **LLVMSupport's
 * `Program.cpp` and `Signals.cpp`**, not in a driver's spawn logic.
 *
 * Two families must be read with their qualification or they will mislead:
 *
 * - **`non-local-jumps` in reading C is entirely Emscripten ABI** — `__THREW__`,
 *   `__threwValue`, `emscripten_longjmp`, `getTempRet0`, `setTempRet0`, `invoke_ii`,
 *   `invoke_vi`, all seven from `CrashRecoveryContext.cpp.o`. Under wasi-sdk-24 the equivalents
 *   are `__wasm_setjmp` / `__wasm_setjmp_test` / `__wasm_longjmp` / `__c_longjmp`, and Plan
 *   26-01 measured **all four present** in `provided.txt`. This family is reading C's
 *   Emscripten bias showing, not a preview1 gap — exactly the qualification 26-01 asked its
 *   reader to carry forward.
 * - **`linker-provided` is not a gap in any reading.** `__stack_pointer`, `__memory_base`,
 *   `__table_base`, `__indirect_function_table` and `__dso_handle` are synthesised by
 *   `wasm-ld`. They are classified into their own family precisely so they cannot be counted
 *   as unresolvable, which is what leaving them in `other` would have done.
 */
const RECORDED_CLASSIFICATION: readonly { readonly reading: string; readonly family: string; readonly count: number }[] = [
  { reading: 'A', family: 'linker-provided', count: 1 },
  { reading: 'AT', family: 'linker-provided', count: 1 },
  { reading: 'B', family: 'compiler-rt', count: 9 },
  { reading: 'B', family: 'dynamic-loading', count: 2 },
  { reading: 'B', family: 'filesystem', count: 6 },
  { reading: 'B', family: 'linker-provided', count: 1 },
  { reading: 'B', family: 'non-local-jumps', count: 2 },
  { reading: 'B', family: 'other', count: 180 },
  { reading: 'B', family: 'process', count: 13 },
  { reading: 'B', family: 'signals', count: 8 },
  { reading: 'B', family: 'sockets', count: 1 },
  { reading: 'B', family: 'threads', count: 30 },
  { reading: 'B', family: 'unwinding', count: 10 },
  { reading: 'C', family: 'compiler-rt', count: 1 },
  { reading: 'C', family: 'filesystem', count: 4 },
  { reading: 'C', family: 'linker-provided', count: 5 },
  { reading: 'C', family: 'non-local-jumps', count: 7 },
  { reading: 'C', family: 'other', count: 37 },
  { reading: 'C', family: 'process', count: 11 },
  { reading: 'C', family: 'signals', count: 8 },
  { reading: 'C', family: 'sockets', count: 1 },
  { reading: 'C', family: 'threads', count: 9 },
  { reading: 'C', family: 'unwinding', count: 2 },
]

/**
 * **Every unresolvable symbol in a named family, named.** This is AOTW-05's obligation written
 * out rather than summarised: a count tells Plan 26-03 how big the problem is, and only the
 * names tell it what the problem is.
 *
 * `other` is excluded here and only counted above — it is 180 symbols of LLVM internals in
 * reading B and 37 in reading C, none of them a syscall family, and the harness records its
 * own truncation cut (`otherFamilyCut`) so a silent trim is impossible.
 */
const RECORDED_NAMED_RESIDUE: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  B: {
    'compiler-rt': ['__aarch64_cas4_acq_rel', '__aarch64_cas8_acq_rel', '__aarch64_ldadd4_acq_rel', '__aarch64_ldadd4_relax', '__aarch64_ldset4_relax', '__aarch64_swp1_acq_rel', '__aarch64_swp4_rel', '__aarch64_swp8_acq_rel', '__clear_cache'],
    'dynamic-loading': ['dl_iterate_phdr', 'dladdr'],
    filesystem: ['dup2', 'fchown', 'fstatfs', 'posix_madvise', 'statfs', 'umask'],
    'linker-provided': ['__dso_handle'],
    'non-local-jumps': ['__longjmp_chk', '_setjmp'],
    process: ['execv', 'execve', 'fork', 'getsid', 'pclose', 'popen', 'posix_spawn', 'posix_spawn_file_actions_adddup2', 'posix_spawn_file_actions_addopen', 'posix_spawn_file_actions_destroy', 'posix_spawn_file_actions_init', 'wait', 'wait4'],
    signals: ['alarm', 'kill', 'sigaction', 'sigaddset', 'sigaltstack', 'sigemptyset', 'sigfillset', 'sigprocmask'],
    sockets: ['gethostname'],
    threads: ['_ZNSt18condition_variable10notify_allEv', '_ZNSt18condition_variable10notify_oneEv', '_ZNSt18condition_variable4waitERSt11unique_lockISt5mutexE', '_ZNSt18condition_variableC1Ev', '_ZNSt18condition_variableD1Ev', '__libc_single_threaded', '__once_proxy', '__sched_cpualloc', '__sched_cpucount', '__sched_cpufree', 'pthread_attr_destroy', 'pthread_attr_init', 'pthread_attr_setstacksize', 'pthread_create', 'pthread_detach', 'pthread_getname_np', 'pthread_join', 'pthread_mutex_lock', 'pthread_mutex_unlock', 'pthread_once', 'pthread_rwlock_destroy', 'pthread_rwlock_init', 'pthread_rwlock_rdlock', 'pthread_rwlock_unlock', 'pthread_rwlock_wrlock', 'pthread_self', 'pthread_setname_np', 'pthread_setschedparam', 'pthread_sigmask', 'sched_getaffinity'],
    unwinding: ['_Unwind_Backtrace', '_Unwind_GetIP', '_Unwind_Resume', '__cxa_allocate_exception', '__cxa_begin_catch', '__cxa_end_catch', '__cxa_free_exception', '__cxa_rethrow', '__cxa_throw', '__gxx_personality_v0'],
  },
  C: {
    'compiler-rt': ['__multi3'],
    filesystem: ['dup2', 'fchown', 'posix_madvise', 'umask'],
    'linker-provided': ['__dso_handle', '__indirect_function_table', '__memory_base', '__stack_pointer', '__table_base'],
    'non-local-jumps': ['__THREW__', '__threwValue', 'emscripten_longjmp', 'getTempRet0', 'invoke_ii', 'invoke_vi', 'setTempRet0'],
    process: ['__syscall_wait4', 'execv', 'execve', 'fork', 'getsid', 'posix_spawn', 'posix_spawn_file_actions_adddup2', 'posix_spawn_file_actions_addopen', 'posix_spawn_file_actions_destroy', 'posix_spawn_file_actions_init', 'wait'],
    signals: ['alarm', 'kill', 'sigaction', 'sigaddset', 'sigaltstack', 'sigemptyset', 'sigfillset', 'sigprocmask'],
    sockets: ['gethostname'],
    threads: ['_ZNSt3__211this_thread9sleep_forERKNS_6chrono8durationIxNS_5ratioILx1ELx1000000000EEEEE', '_ZNSt3__215recursive_mutexC1Ev', '_ZNSt3__215recursive_mutexD1Ev', '_ZNSt3__218condition_variable4waitERNS_11unique_lockINS_5mutexEEE', '_ZNSt3__218condition_variableD1Ev', '_ZNSt3__219__shared_mutex_baseC1Ev', '_ZNSt3__25mutex4lockEv', '_ZNSt3__25mutex6unlockEv', '_ZNSt3__25mutexD1Ev'],
    unwinding: ['__cxa_allocate_exception', '__cxa_throw'],
  },
}

/**
 * The five archive members the whole process/signal residue concentrates in, measured through
 * `memberOf` and recorded because the concentration is the actionable part of the finding.
 *
 * A symbol referenced by ONE member is a candidate for dead-stripping or for a small port; a
 * symbol referenced by a hundred is not. `fork` comes from `Program.cpp.o` alone in both alive
 * readings. `__cxa_throw` comes from **102** members of the LLVM 17 build, which is a statement
 * about that build having exceptions on rather than about LLVM needing them —
 * `26-CONTEXT.md` records `LLVM_ENABLE_EH=OFF` as LLVM's own default.
 */
const RECORDED_ATTRIBUTION: readonly { readonly reading: string; readonly symbol: string; readonly count: number; readonly member: string }[] = [
  { reading: 'B', symbol: 'fork', count: 1, member: 'Program.cpp.o' },
  { reading: 'B', symbol: 'execve', count: 1, member: 'Program.cpp.o' },
  { reading: 'B', symbol: 'posix_spawn', count: 1, member: 'Program.cpp.o' },
  { reading: 'B', symbol: 'sigaltstack', count: 1, member: 'Signals.cpp.o' },
  { reading: 'C', symbol: 'fork', count: 1, member: 'Program.cpp.o' },
  { reading: 'C', symbol: 'execve', count: 1, member: 'Program.cpp.o' },
  { reading: 'C', symbol: 'posix_spawn', count: 1, member: 'Program.cpp.o' },
  { reading: 'C', symbol: 'sigaltstack', count: 1, member: 'Signals.cpp.o' },
  { reading: 'C', symbol: 'emscripten_longjmp', count: 1, member: 'CrashRecoveryContext.cpp.o' },
]

/**
 * The planted mutation, and its observed failure text.
 *
 * **The edit.** One line inserted into `tools/aot/elflift-wasi-gate.sh`, immediately after
 * `provided = set(lines(f'{OUT}/provided.txt'))` in the report-assembly step — that is, into
 * the in-memory copy of the provided set, before the subtraction and after the file it came
 * from was written:
 *
 * ```python
 * provided.discard('printf')   # PLANT: drop one control symbol before the subtraction
 * ```
 *
 * `printf` was chosen by measurement rather than by the plan's word alone: it is undefined in
 * reading **B only** (0 in A, 0 in AT, 1 in B, 0 in C, against `provided` in all four), so the
 * plant moves exactly one row of {@link RECORDED_CLASSIFICATION} and leaves the other twenty-one
 * standing. A plant that reddened every row would have proved the file runs, not that the
 * classification check tests what it claims to.
 *
 * **Observed red** — pasted from the terminal, not written from prediction. The command was
 * `npx vitest run --project node tools/aot/elflift-wasi-gate.node.test.ts` and its exit code,
 * read on the immediately following line with no pipe, was **1**:
 *
 * ```
 *  ❯ |node| tools/aot/elflift-wasi-gate.node.test.ts (8 tests | 1 failed) 137930ms
 *      × AOTW-05 — the recorded residue classification equals the live reading, row for row 19ms
 *
 * ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 *
 *  FAIL  |node| tools/aot/elflift-wasi-gate.node.test.ts > the elflift wasm32-wasi gate, measured in the digest-pinned image (runnable) > AOTW-05 — the recorded residue classification equals the live reading, row for row
 * AssertionError: B/other: expected 181 to be 180 // Object.is equality
 *
 * - Expected
 * + Received
 *
 * - 180
 * + 181
 *
 *  Test Files  1 failed (1)
 *       Tests  1 failed | 7 passed (8)
 * ```
 *
 * **A first draft of this block was written from prediction before the plant was run, and that
 * is recorded rather than quietly fixed** — Plan 26-01 made the same mistake and named it a
 * fabrication. The prediction happened to match, and it was replaced by the terminal's real
 * output anyway, because "it turned out to be right" is not the standard.
 *
 * **`1 failed | 7 passed` is the part that matters.** The liveness cases, the TU tables and the
 * reading-C disjunction all stayed green; only the row the plant moved went red. A plant that
 * reddened the whole file would have proved the file runs, not that this case tests what it
 * claims to.
 *
 * **Restored by the surgical inverse of that exact edit** — the inserted line deleted, nothing
 * else touched — and verified with `cmp` against a snapshot of the harness taken IMMEDIATELY
 * BEFORE planting: byte-identical, `cmp` silent, exit 0. No `cp`, no `git stash`, no
 * `git checkout --`. Per CLAUDE.md the hunk count is a one-way alarm and proves nothing when
 * equal; `cmp` is what actually held.
 */
const PLANT = 'see docblock — restored and cmp-verified 2026-08-10'
void PLANT

function dockerAvailable(): boolean {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Os}}'], {
    timeout: 20_000,
    encoding: 'utf8',
  })
  return probe.status === 0
}

/** Which precondition is missing, named rather than left as a bare skip. */
function missingPrecondition(): string | null {
  if (arch() !== 'arm64') return `host arch is ${arch()}, the pinned image is arm64`
  if (!dockerAvailable()) return 'docker is not answering `docker version`'
  return null
}

const MISSING = missingPrecondition()
const SKIP_NOTE = MISSING === null ? 'runnable' : `SKIPPED: ${MISSING}`

describe.skipIf(MISSING !== null)(
  `the elflift wasm32-wasi gate, measured in the digest-pinned image (${SKIP_NOTE})`,
  () => {
    let gate: Gate

    beforeAll(() => {
      const out = mkdtempSync(join(tmpdir(), 'o2-elflift-gate-'))
      const argv = [
        'run',
        '--rm',
        // `-i` IS LOAD-BEARING AND ITS ABSENCE IS SILENT. Without it the container's stdin is
        // /dev/null, `bash /dev/stdin` reads an empty script, and `docker run` exits **0**
        // having done nothing. Plan 26-01 observed exactly that on its first run — an
        // instrument that read nothing reporting success. The `existsSync` check below is what
        // catches it, and the exit code alone would not.
        '-i',
        '-e',
        `IMAGE_DIGEST=${IMAGE}`,
        // read-only, so a harness bug cannot dirty the working tree mid-run — two specs in this
        // repo snapshot `git status --porcelain` around themselves.
        '-v',
        `${REPO_ROOT}:/repo:ro`,
        '-v',
        `${out}:/out`,
      ]
      // Reading C's mount is CONDITIONAL, and its absence degrades the report rather than
      // breaking the run. See {@link WASM_LLVM_DIR}.
      if (existsSync(WASM_LLVM_DIR)) argv.push('-v', `${WASM_LLVM_DIR}:/wasmllvm:ro`)
      argv.push('--entrypoint', '/bin/bash', IMAGE, '-c', 'bash /dev/stdin')

      const run = spawnSync('docker', argv, {
        input: readFileSync(SCRIPT, 'utf8'),
        timeout: HARNESS_BUDGET_MS,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      const reportPath = join(out, 'gate.json')
      if (run.status !== 0 || !existsSync(reportPath)) {
        throw new Error(
          `harness exited ${String(run.status)} and wrote no report.\n${run.stderr ?? ''}`,
        )
      }
      gate = JSON.parse(readFileSync(reportPath, 'utf8')) as Gate
    })

    it('AOTW-04 — the harness configured the FORK and replayed real translation units', () => {
      // NOTHING BELOW MEANS ANYTHING WITHOUT THIS, and the ordering is the same one
      // `elfconv-differential.node.test.ts:114-122` uses for the same reason: a report over
      // zero attempted TUs, or over a cmake that failed, would make every reading beneath it
      // an artefact of an instrument that did not run.
      // EQUALITY, not shape. `toMatch(/@sha256:…/)` alone would pass against any digest at
      // all, which makes it a check that the caller passed *a* digest rather than a check
      // that this report came out of THE pinned one — and `.planning/REQUIREMENTS.md`'s
      // AOTW-01 row says "asserted equal to it at run time". The shape assertion is kept
      // beneath it because it is the one that names the failure when `IMAGE` itself is
      // repointed at a mutable tag through `ELFCONV_IMAGE_DIGEST`.
      expect(gate.image).toBe(IMAGE)
      expect(gate.image).toMatch(/@sha256:[0-9a-f]{64}$/)
      expect(gate.clangVersion).toContain('wasi-sdk')
      expect(gate.cmakeExit).toBe(0)
      // The fork's own statement of what it links, quoted out of the configure that ran. This
      // image builds LLVM with `LLVM_LINK_LLVM_DYLIB`, so the WASM-EXPERIMENT six-component
      // list at `backend/remill/CMakeLists.txt:53-57` is short-circuited to the monolithic
      // `LLVM` — recorded because a reader would otherwise assume the six-library list held.
      expect(gate.foundLlvmLine).toContain('Found LLVM 16')
      expect(gate.llvmLibrariesLine).toContain('LLVM Libraries:')

      expect(gate.entriesTotal).toBeGreaterThanOrEqual(22)
      expect(gate.tus.length).toBeGreaterThanOrEqual(22)
      // Visible arithmetic: the database's size, minus the skips, IS the set attempted. A skip
      // that lost an entry silently would break this.
      expect(gate.entriesTotal - gate.entriesSkipped.length).toBe(gate.tus.length)
      expect(gate.entriesSkipped.filter((s) => s.reason.length === 0)).toEqual([])

      // The object is the evidence. At least one real one, or the replay compiled nothing.
      const produced = gate.tus.filter((t) => (t.objectBytes ?? 0) > 0)
      expect(produced.length).toBeGreaterThan(0)

      // The harness's own flag construction, checked. The REMILL_ARCH / REMILL_OS defines it
      // ADDS are what let any TU past `Arch/Name.h:82`; withhold them and one TU is recompiled
      // as a control. If that control does not fail with the `#error` those defines suppress,
      // the added-flag list is not doing what its comment claims and every reading in this arm
      // was taken with an unexamined flag set.
      expect(gate.addedFlags.some((f) => f.startsWith('-DREMILL_ARCH='))).toBe(true)
      expect(gate.addedFlags.some((f) => f.startsWith('-DREMILL_OS='))).toBe(true)
      expect(gate.addedFlagsControl).not.toBeNull()
      expect(gate.addedFlagsControl?.exit).not.toBe(0)
      expect(gate.addedFlagsControl?.firstError).toContain('Cannot infer current architecture')
    })

    it('AOTW-04 — every wasm32-wasi TU result equals what was recorded, in both directions', () => {
      const failures = gate.tus
        .filter((t) => !(t.exit === 0 && (t.objectBytes ?? 0) > 0))
        .map((t) => ({ file: REL(t.file), exit: t.exit, error: t.firstError ?? '(no error line)' }))
      // Useful on red: name the translation unit and why, never a count.
      const rendered = failures.map((f) => `${f.file} — exit ${String(f.exit)} — ${f.error}`).join('\n')

      expect(failures.map((f) => f.file), rendered).toEqual(EXPECTED_TU_FAILURES.map((e) => e.file))
      for (const [index, expected] of EXPECTED_TU_FAILURES.entries()) {
        expect(failures[index]?.error, `failure[${index}] (${expected.file})`).toContain(
          expected.errorContains,
        )
      }
      // And the other direction: a TU that starts passing is as much a change as one that
      // starts failing, and both must force a re-read of this table.
      const passes = gate.tus
        .filter((t) => t.exit === 0 && (t.objectBytes ?? 0) > 0)
        .map((t) => REL(t.file))
      expect(passes).toEqual(EXPECTED_TU_PASSES)

      // The cause, attributed. clang reports the error inside wasi-sdk's own libc++, so the
      // error text alone reads as "the toolchain refused". `includedFrom` is what turns that
      // into "glog's logging.h asked for <thread>" — a different finding, and the right one.
      const causes = [...new Set(gate.tus.filter((t) => t.exit !== 0).map((t) => t.includedFrom))]
      expect(causes).toEqual(['/root/elfconv/dependencies/install/include/glog/logging.h:51:'])
    })

    it('AOTW-04 — the wasm32-wasi-threads arm fails on the SAME units, one error deeper', () => {
      // Plan 26-01's third qualification, closed. Threads do not unblock this build: the same
      // twenty-one units fail, and the refusal moves from libc++ to glog's own platform check.
      const threadFailures = gate.threadsArm
        .filter((t) => !(t.exit === 0 && (t.objectBytes ?? 0) > 0))
        .map((t) => REL(t.file))
      expect(threadFailures).toEqual(EXPECTED_TU_FAILURES.map((e) => e.file))
      for (const tu of gate.threadsArm.filter((t) => t.exit !== 0)) {
        expect(tu.firstError, REL(tu.file)).toContain(EXPECTED_THREADS_ARM_ERROR)
      }
      const threadPasses = gate.threadsArm
        .filter((t) => t.exit === 0 && (t.objectBytes ?? 0) > 0)
        .map((t) => REL(t.file))
      expect(threadPasses).toEqual(EXPECTED_TU_PASSES)
    })

    it('AOTW-05 — the provided set was read, and both sides of the subtraction come from one run', () => {
      // Regenerated in this container rather than carried across from Plan 26-01 on purpose:
      // CLAUDE.md prefers a comparative reading taken within one run, and a difference between
      // two runs of the same extraction would otherwise be indistinguishable from a real move.
      expect(gate.nmExits.provided).toBe(0)
      expect(gate.providedCount).toBeGreaterThan(PROVIDED_FLOOR)
    })

    it('AOTW-05 — every reading is alive, or is explicitly dispositioned as not to be believed', () => {
      // THE SINGLE MOST IMPORTANT CASE IN THIS FILE, and it runs before any residue is read.
      // A GO produced by an nm that read nothing is the worst outcome this plan can have.
      const insufficient: string[] = []
      for (const [label, reading] of Object.entries(gate.readings)) {
        if (reading === null) continue
        expect(reading.nmUndefinedExit, `${label}: nm --undefined-only`).toBe(0)
        expect(reading.nmDefinedExit, `${label}: nm --defined-only`).toBe(0)
        if (reading.alive) {
          expect(reading.undefinedCount, `${label} liveness`).toBeGreaterThan(gate.livenessFloor)
          expect(reading.insufficientReason, `${label}`).toBeNull()
          expect(reading.archiveCount, `${label} archive list`).toBeGreaterThan(0)
        } else {
          // Reported, with a reason, and refused as evidence. Never silently an empty residue.
          expect(reading.insufficientReason ?? '', `${label} reason`).not.toBe('')
          insufficient.push(label)
        }
      }
      expect(insufficient).toEqual(EXPECTED_INSUFFICIENT_READINGS)
      // ...and at least one reading must have read something, or the gate read nothing at all.
      expect(Object.values(gate.readings).filter((r) => r?.alive).length).toBeGreaterThan(0)
    })

    it('AOTW-05 — reading C is either fully populated or null with a stated reason, never absent', () => {
      expect('C' in gate.readings).toBe(true)
      if (gate.readingCNull === null) {
        const c = gate.readings['C']
        expect(c).not.toBeNull()
        expect(c?.archives.map((a) => a.split('/').pop())).toEqual([
          'libLLVMSupport.a',
          'libLLVMCore.a',
          'libLLVMIRReader.a',
          'libLLVMBitReader.a',
          'libLLVMBitWriter.a',
        ])
        expect(gate.readingCMissingArchives).toEqual([])
      } else {
        expect(gate.readingCNull).not.toBe('')
        expect(gate.readings['C']).toBeNull()
      }
      // Recorded ALWAYS, present or not: `libLLVMPasses.a` is one of the six libraries the
      // fork's CMakeLists names and it is NOT in that archive set, exactly as that file's own
      // comment at line 56 says. It narrows what reading C can speak for and the verdict must
      // restate it.
      expect(gate.readingCPassesPresent).toBe(false)
    })

    it('AOTW-05 — the recorded residue classification equals the live reading, row for row', () => {
      // The doc-rot guard. Row-by-row rather than one `toEqual` on the whole structure, so the
      // failure names the reading and the family that moved.
      const live = Object.entries(gate.readings)
        .filter(([, r]) => r !== null)
        .flatMap(([label, r]) =>
          Object.entries(r!.families).map(([family, count]) => ({ reading: label, family, count })),
        )
        .sort((a, b) => a.reading.localeCompare(b.reading) || a.family.localeCompare(b.family))

      expect(live.map((r) => `${r.reading}/${r.family}`)).toEqual(
        RECORDED_CLASSIFICATION.map((r) => `${r.reading}/${r.family}`),
      )
      for (const [index, recorded] of RECORDED_CLASSIFICATION.entries()) {
        expect(live[index]?.count, `${recorded.reading}/${recorded.family}`).toBe(recorded.count)
      }
      // Truncation, if any, is stated with its cut rather than performed silently.
      for (const [label, reading] of Object.entries(gate.readings)) {
        if (reading === null) continue
        for (const [family, cut] of Object.entries(reading.truncated)) {
          expect(family, `${label} truncation`).toBe('other')
          expect(cut.shown).toBe(gate.otherFamilyCut)
          expect(cut.total).toBeGreaterThan(cut.shown)
        }
      }
    })

    it('AOTW-05 — every unresolvable symbol in a named family is named, and attributed to a member', () => {
      // Only the alive readings are examined, which is what the liveness case above bought.
      for (const [label, expectedFamilies] of Object.entries(RECORDED_NAMED_RESIDUE)) {
        const reading = gate.readings[label]
        expect(reading, `reading ${label}`).not.toBeNull()
        expect(reading?.alive, `reading ${label} alive`).toBe(true)
        for (const [family, members] of Object.entries(expectedFamilies)) {
          expect(reading?.members[family], `${label}/${family}`).toEqual(members)
        }
      }
      // A residue read out of an ARCHIVE is an upper bound on what a LINK would demand, because
      // a link pulls in only the members it needs. The attribution is what keeps "LLVM's
      // archives mention fork" from being read as "elflift calls fork".
      for (const row of RECORDED_ATTRIBUTION) {
        const attribution = gate.readings[row.reading]?.memberOf[row.symbol]
        expect(attribution?.count, `${row.reading}/${row.symbol} member count`).toBe(row.count)
        expect(attribution?.members, `${row.reading}/${row.symbol}`).toContain(row.member)
      }
    })
  },
)
