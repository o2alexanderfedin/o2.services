#!/bin/bash
# THE GATE. Can `elflift` be built for `wasm32-wasi`, and if not, which symbol blocks it.
#
# Runs INSIDE the digest-pinned elfconv image with this repository mounted READ-ONLY at /repo,
# a writable /out, and -- when the host has it -- the neighbouring wasm-compiled LLVM archive
# directory mounted read-only at /wasmllvm. Because the harness is not in the image and /repo
# is `:ro`, it arrives on the container's stdin:
#
#   docker run --rm -i -v "$REPO":/repo:ro -v "$OUTDIR":/out \
#     -v "$WASMLLVM":/wasmllvm:ro --entrypoint /bin/bash "$IMAGE" -c 'bash /dev/stdin' \
#     < tools/aot/elflift-wasi-gate.sh
#
# `-i` IS LOAD-BEARING AND ITS ABSENCE IS SILENT. Without it the container's stdin is
# /dev/null, `bash /dev/stdin` reads an empty script, and `docker run` exits **0** having done
# nothing. Plan 26-01 hit exactly that and saw a green over an empty output directory.
# The caller must verify /out/gate.json EXISTS rather than trust the exit code.
#
# `:ro` on /repo is not decoration -- `elfconv-differential.sh:91-93` records the reason, and
# two specs in this repository snapshot `git status --porcelain` around themselves
# (`packages/node/src/discover-arm.node.test.ts`, `packages/node/src/bench-attestation.node.test.ts`).
# Everything this harness writes goes to /out or to the container's own /root/elfconv.
#
# WHY THIS SHAPE. `elfconv-differential.sh`'s docblock states four rules paid for by a harness
# that reported a green over a build which had FAILED, and all four apply:
#   1. delete before building, so a stale artifact cannot be read as a fresh success
#   2. read the exit code with NO pipe on the same line as the command
#   3. abort outright on failure rather than reporting anything
#   4. publish a digest of what actually ran
# Plan 26-01 added a fifth, which this harness inherits and needs even more badly:
#   5. an ABSENCE and a BROKEN INSTRUMENT must not produce the same output
# and this plan adds a sixth, because it measures a compiler rather than a library:
#   6. THE OBJECT IS THE EVIDENCE, NOT THE EXIT CODE. `objectBytes` is stat'd per translation
#      unit. This is the project's standing rule about elfconv exiting 0 on binaries it could
#      not translate, turned around and applied to the compiler doing the porting.
#
# WHAT THIS HARNESS DOES NOT DO. It does not link. There is no `elflift.wasm` at the end of it
# and nothing downstream may be written up as if there were. Producing one needs LLVM, gflags,
# glog and XED cross-compiled to wasm32-wasi, and 26-CONTEXT.md precondition 3 establishes that
# no wasm32-wasi LLVM exists on this host. Measuring the symbol surface first is how the
# decision to spend those hours gets made against a measurement instead of an inference.
#
# Exit codes: 0 report written; 40 cmake failed; 41 no compile_commands.json;
#             42 provided-set read failed; 43 no wasi-sdk; 44 no TU was attempted at all.

set -u

REPO=${REPO:-/repo}
OUT=${OUT:-/out}
SRC="$REPO/third_party/elfconv"
LIFTER=/root/elfconv
WASMLLVM=${WASMLLVM:-/wasmllvm}
MIN_PROVIDED=${MIN_PROVIDED:-1000}
IMAGE_DIGEST=${IMAGE_DIGEST:-unrecorded}

# Same resolution as `elfconv-differential.sh:34` and `wasi-preview1-surface.sh:50`, so the
# three harnesses cannot disagree about which toolchain the image supplies.
WASI_SDK_PATH="${WASI_SDK_PATH:-$(ls -d /root/wasi-sdk* 2>/dev/null | head -1)}"

mkdir -p "$OUT" "$OUT/obj" "$OUT/objt" "$OUT/tu" "$OUT/tut"

# (43) An absent toolchain is a NAMED failure, never an empty report.
if [ -z "$WASI_SDK_PATH" ] || [ ! -d "$WASI_SDK_PATH" ] || [ ! -x "$WASI_SDK_PATH/bin/clang++" ]; then
  echo "no wasi-sdk under /root (resolved to '${WASI_SDK_PATH}')" >&2
  exit 43
fi

NM="$WASI_SDK_PATH/bin/llvm-nm"
LIBDIR="$WASI_SDK_PATH/share/wasi-sysroot/lib/wasm32-wasi"

"$WASI_SDK_PATH/bin/clang++" --version > "$OUT/clang-version.txt" 2>&1
CLANG_VERSION_EXIT=$?
[ "$CLANG_VERSION_EXIT" -eq 0 ] || { echo "clang++ --version failed ($CLANG_VERSION_EXIT)" >&2; exit 43; }
CLANG_VERSION=$(head -1 "$OUT/clang-version.txt")

# ---- Step 1: place THIS REPOSITORY'S fork over the image tree ---------------------------
# Verbatim from `elfconv-differential.sh:109-112`. A harness that measured the STOCK tree
# would be measuring a lifter that still links bfd/libdwarf/libelf, i.e. answering a different
# question from the one the phase is gated on.
cp -a "$SRC/lifter/." "$LIFTER/lifter/"
cp -a "$SRC/backend/remill/lib/." "$LIFTER/backend/remill/lib/"
cp -a "$SRC/backend/remill/include/." "$LIFTER/backend/remill/include/"
cp -f "$SRC/backend/remill/CMakeLists.txt" "$LIFTER/backend/remill/CMakeLists.txt"

# (1) delete BEFORE reconfiguring, so a stale stock-tree database cannot be read as the fork's.
rm -f "$LIFTER/build/compile_commands.json"

# ---- Step 2: reconfigure -----------------------------------------------------------------
# `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` IS NOT OPTIONAL AND IT IS NOT COSMETIC. Without it the
# database this harness replays covers only the REMILL SUBTREE, because
# `backend/remill/cmake/settings.cmake:25` sets the variable as a DIRECTORY-SCOPED normal
# variable inside remill's own `project()`. Measured in this image: 27 entries without the
# flag, 38 with it, and the eleven that appear are `lifter/Binary/Loader.cpp`,
# `lifter/MainLifter.cpp`, `lifter/TraceManager.cpp`, `lifter/Lift.cpp` and `utils/Util.cpp` --
# which is to say ELFLIFT'S OWN SOURCES, every one of them, plus the test targets.
# Passing it on the command line writes the CACHE variable at top-level scope, which the
# `lifter/` and `tests/` directories then inherit.
cmake -S "$LIFTER" -B "$LIFTER/build" -DCMAKE_EXPORT_COMPILE_COMMANDS=ON > "$OUT/cmake.log" 2>&1
CMAKE_EXIT=$?
[ "$CMAKE_EXIT" -eq 0 ] || { echo "cmake failed ($CMAKE_EXIT)" >&2; tail -20 "$OUT/cmake.log" >&2; exit 40; }

# (41) A configure that exits 0 and produces no database is the shape of failure rule 6 exists
# to catch, so the artifact is checked rather than the exit code trusted.
[ -f "$LIFTER/build/compile_commands.json" ] || { echo "no compile_commands.json after cmake" >&2; exit 41; }

# The fork's own statement of what it links, quoted out of the configure it just ran rather
# than out of its CMakeLists. These two lines belong in the report: `LLVM Libraries:` is how
# the reader learns whether the WASM-EXPERIMENT six-library list was taken or whether
# `LLVM_LINK_LLVM_DYLIB` short-circuited it to the monolithic `LLVM`.
LLVM_LIBRARIES_LINE=$(grep -m1 'LLVM Libraries:' "$OUT/cmake.log")
FOUND_LLVM_LINE=$(grep -m1 'Found LLVM' "$OUT/cmake.log")

# ---- Step 3: the wasm32-wasi compile replay (AOTW-04) ------------------------------------
# python3 is in the image (3.10.12, verified 2026-08-10). Each `clang++` return code is read
# straight off the completed process object with nothing between -- the python analogue of
# rule 2, and the reason the replay is not a shell loop piping through grep.
export OUT WASI_SDK_PATH
python3 - <<'REPLAY'
import json, os, shlex, subprocess, time

OUT = os.environ['OUT']
WASI = os.environ['WASI_SDK_PATH']
CLANG = f'{WASI}/bin/clang++'
DB = '/root/elfconv/build/compile_commands.json'

# The flag allowlist, by explicit prefix. Deliberately not clever: everything not on this list
# is DROPPED and recorded per TU, so a reader can see the whole delta rather than trust a
# regex. `-isystem` takes a separate argument and is handled as a pair.
KEEP_PREFIXES = ('-D', '-I', '-std')

# ADDED, not carried. These are the defines a native build gets FOR FREE from the host
# compiler's predefined macros and a wasm32-wasi build cannot: `remill/Arch/Name.h` keys off
# `__aarch64__` and `remill/OS/OS.h` off `__linux__`, and under `--target=wasm32-wasi` neither
# is defined, so both `#ifndef` blocks fall through to their `#error`.
#
# **The plan predicted these would arrive as `-D` flags out of compile_commands.json. They do
# not** -- measured: the database's defines are ELFCONV_AARCH64_BUILD, GFLAGS_IS_A_DLL,
# GLOG_USE_GFLAGS, GLOG_USE_GLOG_EXPORT, NDEBUG, REMILL_BUILD_SEMANTICS_DIR_AARCH64 and
# REMILL_INSTALL_SEMANTICS_DIR, and not one REMILL_ARCH / REMILL_OS / REMILL_ON_*. Supplying
# them is what a real cross-build would have to do, and they are reported as `addedFlags`
# separately from the carried set so nobody has to reverse-engineer which is which.
#
# The values mirror what the native aarch64 Linux build of this fork resolves to, because the
# lift target is aarch64 Linux ELF regardless of what the lifter itself runs on.
ADDED = [
    '-DREMILL_ARCH="aarch64"', '-DREMILL_ON_AMD64=0', '-DREMILL_ON_X86=0',
    '-DREMILL_ON_AARCH64=1', '-DREMILL_ON_AARCH32=0', '-DREMILL_ON_SPARC64=0',
    '-DREMILL_ON_SPARC32=0', '-DREMILL_ON_PPC=0',
    '-DREMILL_OS="linux"', '-DREMILL_ON_MACOS=0', '-DREMILL_ON_LINUX=1',
    '-DREMILL_ON_WINDOWS=0', '-DREMILL_ON_SOLARIS=0',
]

# Why each entry is not replayed, named rather than dropped. `entriesTotal` minus the number of
# skips must equal len(tus), and the spec asserts exactly that -- so the difference between the
# database's size and the set actually attempted is visible arithmetic and not a shrug.
SKIP_RULES = [
    ('/backend/remill/tests/', "remill's own AArch64 test target -- roadmap item 11(ii) records "
                               "that the only em++ failures were here and that this phase does "
                               "not need them"),
    ('/tests/elfconv/', 'the elfconv integration-test target, not part of the elflift link'),
    ('/_deps/', 'vendored googletest, pulled in by the test targets and not elfconv source'),
]


def convert(command):
    """Split a compile_commands entry into (kept, dropped). No `-o`, no `-c`, no source.

    `words` rather than the obvious name for a shell-split element: `packages/node/src/
    vocabulary.node.test.ts` blocks that term repository-wide, because it reads as
    cryptocurrency to a reviewer who greps and does not stop to check the sense.
    """
    words = shlex.split(command)
    kept, dropped, i = [], [], 1  # element 0 is the compiler
    while i < len(words):
        word = words[i]
        if word == '-isystem':
            kept += [word, words[i + 1]]
            i += 2
            continue
        if word == '-o':
            i += 2
            continue
        if word == '-c':
            i += 1
            continue
        if word.startswith(KEEP_PREFIXES):
            kept.append(word)
            i += 1
            continue
        dropped.append(word)
        i += 1
    return kept, dropped


def first_error(path):
    try:
        with open(path, encoding='utf8', errors='replace') as handle:
            for line in handle:
                if 'error:' in line:
                    return line.rstrip()[:400]
    except OSError:
        return None
    return None


def included_from(path):
    """The last `In file included from` line before the first error.

    WITHOUT THIS THE REPORT NAMES THE WRONG SUBJECT. clang reports the error at the line that
    contains it, which for this replay is inside wasi-sdk's own libc++ -- so `errorFile` alone
    reads as "the toolchain refused", when the measured cause is a HEADER ONE LEVEL UP that
    elfconv chose to include. This field is what turns "libc++ has no <thread>" into "glog's
    logging.h asked for <thread>", which is a different finding and the one the gate needs.
    """
    last = None
    try:
        with open(path, encoding='utf8', errors='replace') as handle:
            for line in handle:
                if 'error:' in line:
                    return last
                if line.startswith('In file included from'):
                    last = line.rstrip().replace('In file included from ', '')[:300]
    except OSError:
        return None
    return None


def error_file(line):
    """The file the first error is IN -- which dependency a failure roots in, measured."""
    if not line:
        return None
    return line.split(':', 1)[0]


with open(DB, encoding='utf8') as handle:
    db = json.load(handle)

skipped, plan, seen = [], [], set()
for index, entry in enumerate(db):
    path = entry['file']
    reason = next((why for needle, why in SKIP_RULES if needle in path), None)
    if reason is None and path in seen:
        reason = 'duplicate source path, already attempted under another target'
    if reason is not None:
        skipped.append({'index': index, 'file': path, 'reason': reason})
        continue
    seen.add(path)
    plan.append((index, entry))


def compile_arm(label, target, extra, objdir, logdir):
    results = []
    for index, entry in plan:
        kept, dropped = convert(entry['command'])
        obj = f'{objdir}/{index}.o'
        log = f'{logdir}/{index}.log'
        argv = [CLANG, f'--target={target}'] + extra + ['-c', '-o', obj] + ADDED + kept + [entry['file']]
        started = time.time()
        with open(log, 'w', encoding='utf8') as sink:
            done = subprocess.run(argv, stdout=sink, stderr=subprocess.STDOUT,
                                  cwd=entry['directory'], check=False)
        exit_code = done.returncode  # read straight off, nothing in between
        # THE OBJECT IS THE EVIDENCE. A compiler that exits 0 and writes nothing fails here.
        size = os.path.getsize(obj) if os.path.exists(obj) else None
        err = first_error(log)
        results.append({
            'index': index,
            'file': entry['file'],
            'arm': label,
            'exit': exit_code,
            'objectBytes': size,
            'seconds': round(time.time() - started, 2),
            'firstError': err,
            'errorFile': error_file(err),
            'includedFrom': included_from(log),
            'droppedFlags': dropped,
        })
    return results


tus = compile_arm('wasm32-wasi', 'wasm32-wasi', [], f'{OUT}/obj', f'{OUT}/tu')

# The SECOND ARM, and it is here because wave 1 left a qualification that only a measurement
# can close: every thread-family absence it reported is scoped to `wasm32-wasi` WITHOUT
# threads, and `wasm32-wasi-threads` was never read. Without this arm a failure whose text
# names `<thread>` could be misread as "elfconv needs threads", when the question is whether
# the threads sysroot unblocks the build at all. Same 27 TUs, same flags, one target apart.
threads_arm = compile_arm('wasm32-wasi-threads', 'wasm32-wasi-threads', ['-pthread'],
                          f'{OUT}/objt', f'{OUT}/tut')

# A control on the harness's own flag construction. Recompile ONE translation unit with the
# ADDED defines withheld: if it does not fail at `Arch/Name.h`'s "Cannot infer current
# architecture", then ADDED is not doing what the comment above claims and every other reading
# in this arm was taken with an unexamined flag set. Instrument-alive, applied to a flag list.
control = None
if plan:
    index, entry = plan[0]
    kept, _ = convert(entry['command'])
    log = f'{OUT}/tu/control-no-added.log'
    with open(log, 'w', encoding='utf8') as sink:
        done = subprocess.run([CLANG, '--target=wasm32-wasi', '-c', '-o', f'{OUT}/control.o']
                              + kept + [entry['file']],
                              stdout=sink, stderr=subprocess.STDOUT, cwd=entry['directory'],
                              check=False)
    control = {'file': entry['file'], 'exit': done.returncode, 'firstError': first_error(log)}

with open(f'{OUT}/tus.json', 'w', encoding='utf8') as handle:
    json.dump({
        'entriesTotal': len(db),
        'entriesSkipped': skipped,
        'addedFlags': ADDED,
        'keepPrefixes': list(KEEP_PREFIXES),
        'tus': tus,
        'threadsArm': threads_arm,
        'addedFlagsControl': control,
    }, handle)
print(f'replay: {len(db)} entries, {len(skipped)} skipped, {len(tus)} attempted per arm')
REPLAY
REPLAY_EXIT=$?
[ "$REPLAY_EXIT" -eq 0 ] || { echo "compile replay failed ($REPLAY_EXIT)" >&2; exit 44; }
[ -f "$OUT/tus.json" ] || { echo "compile replay wrote no tus.json" >&2; exit 44; }

# ---- Step 4: the provided set -------------------------------------------------------------
# Plan 26-01's extraction, repeated VERBATIM rather than carried across. Both sides of the
# subtraction below have to come from one container invocation or a difference between them
# could be an artefact of two runs -- CLAUDE.md's preference for a comparative reading taken
# within a single run, applied to the only subtraction this plan performs.
rm -f "$OUT/provided.txt" "$OUT/nm-provided-raw.txt" "$OUT/nm-provided-err.txt"
"$NM" --defined-only --no-sort "$LIBDIR"/*.a > "$OUT/nm-provided-raw.txt" 2>"$OUT/nm-provided-err.txt"
NM_PROVIDED_EXIT=$?

# Filtering is a SEPARATE step, after the exit code is captured -- the whole point of rule 2.
awk 'NF == 3 && $2 ~ /^[TWDBRV]$/ { print $3 }' "$OUT/nm-provided-raw.txt" | sort -u > "$OUT/provided.txt"
PROVIDED_COUNT=$(wc -l < "$OUT/provided.txt")
PROVIDED_COUNT=$((PROVIDED_COUNT + 0))

# (42) Zero symbols over the sysroot means nm failed, not that preview1 provides nothing.
if [ "$NM_PROVIDED_EXIT" -ne 0 ] || [ "$PROVIDED_COUNT" -lt "$MIN_PROVIDED" ]; then
  echo "provided-set read: nm exit $NM_PROVIDED_EXIT yielded $PROVIDED_COUNT (floor $MIN_PROVIDED)" >&2
  head -5 "$OUT/nm-provided-err.txt" >&2
  exit 42
fi

# ---- Step 5: the three undefined readings (AOTW-05) ---------------------------------------
# Three, because a single reading would encode one toolchain's #ifdefs and pass as the answer.
# Each gets its own archive list, its own two nm exit codes read with no pipe, and its own raw
# count. A reading whose count is zero is THAT READING'S INSTRUMENT FAILURE, never an empty
# residue -- and the host-side spec refuses to draw any absence conclusion from a reading whose
# undefined count sits under its liveness floor.
read_one () {  # $1 = label, $2.. = archive/object paths
  local label=$1; shift
  printf '%s\n' "$@" > "$OUT/archives-$label.txt"
  "$NM" --undefined-only "$@" > "$OUT/nm-$label-und.txt" 2>"$OUT/nm-$label-err.txt"
  local und_exit=$?
  "$NM" --defined-only "$@" > "$OUT/nm-$label-def.txt" 2>>"$OUT/nm-$label-err.txt"
  local def_exit=$?
  awk 'NF == 2 && $1 == "U" { print $2 }' "$OUT/nm-$label-und.txt" | sort -u > "$OUT/und-$label.txt"
  awk 'NF == 3 && $2 ~ /^[TWDBRV]$/ { print $3 }' "$OUT/nm-$label-def.txt" | sort -u > "$OUT/def-$label.txt"
  printf '%s %s\n' "$und_exit" "$def_exit" > "$OUT/nmexit-$label.txt"
}

# Reading A -- the objects Step 3 actually emitted. Authoritative for elfconv's and remill's
# own code and for nothing else, and only as wide as the arm managed to compile.
A_OBJS=$(ls "$OUT"/obj/*.o 2>/dev/null)
if [ -n "$A_OBJS" ]; then read_one A $A_OBJS; else printf '' > "$OUT/und-A.txt"; printf '' > "$OUT/def-A.txt"; printf '1 1\n' > "$OUT/nmexit-A.txt"; printf '' > "$OUT/archives-A.txt"; fi

# Reading A-threads -- the same, for the second arm, so the two arms' residues are comparable.
AT_OBJS=$(ls "$OUT"/objt/*.o 2>/dev/null)
if [ -n "$AT_OBJS" ]; then read_one AT $AT_OBJS; else printf '' > "$OUT/und-AT.txt"; printf '' > "$OUT/def-AT.txt"; printf '1 1\n' > "$OUT/nmexit-AT.txt"; printf '' > "$OUT/archives-AT.txt"; fi

# Reading B -- host LLVM 16 archives in the image, plus the three non-LLVM dependencies the
# fork still links. These are host ELF objects compiled with LLVM_ON_UNIX, so their undefined
# set OVERSTATES what a wasm build would demand: an upper bound, biased in the safe direction.
#
# `llvm-config-16 --libnames <components>` DOES NOT WORK HERE and the plan's literal form would
# have produced a reading of the wrong thing: this LLVM is built with LLVM_LINK_LLVM_DYLIB, so
# that command answers `libLLVM-16.so` -- one shared object, whose undefined set is its DYNAMIC
# imports rather than the static components' demands. `--link-static` is added, and it resolves
# the six named components to their full transitive closure of 37 archives, recorded in
# archives-B.txt.
LLVM_LIBDIR=$(llvm-config-16 --libdir 2>/dev/null)
B_PATHS=""
for name in $(llvm-config-16 --link-static --libnames support core irreader bitreader bitwriter passes 2>/dev/null); do
  [ -f "$LLVM_LIBDIR/$name" ] && B_PATHS="$B_PATHS $LLVM_LIBDIR/$name"
done
# Found rather than hardcoded, and the paths found are recorded in archives-B.txt.
for dep in $(find /root/elfconv/dependencies/install/lib -name 'libgflags.a' -o -name 'libglog.a' -o -name 'libxed.a' 2>/dev/null | sort); do
  B_PATHS="$B_PATHS $dep"
done
if [ -n "$B_PATHS" ]; then read_one B $B_PATHS; else printf '' > "$OUT/und-B.txt"; printf '' > "$OUT/def-B.txt"; printf '1 1\n' > "$OUT/nmexit-B.txt"; printf '' > "$OUT/archives-B.txt"; fi

# Reading C -- the wasm-compiled LLVM 17 archives from the neighbouring checkout. Real wasm
# objects, so far closer to a wasi build's demands than reading B. TWO CAVEATS THAT BELONG IN
# THE REPORT AND NOT IN A FOOTNOTE: they are EMSCRIPTEN, not WASI (so `__EMSCRIPTEN__` branches
# were taken and `__wasi__` ones were not), and they are LLVM 17.0.6 against the image's 16.0.6.
# `libLLVMPasses.a` is one of the six the fork names and is ABSENT from that set -- recorded
# ALWAYS, present or not, because it narrows what reading C can speak for.
C_WANT="libLLVMSupport.a libLLVMCore.a libLLVMIRReader.a libLLVMBitReader.a libLLVMBitWriter.a"
C_PATHS=""
C_MISSING=""
if [ -d "$WASMLLVM" ]; then
  for name in $C_WANT; do
    if [ -f "$WASMLLVM/$name" ]; then C_PATHS="$C_PATHS $WASMLLVM/$name"; else C_MISSING="$C_MISSING $name"; fi
  done
fi
C_PASSES_PRESENT=false
[ -f "$WASMLLVM/libLLVMPasses.a" ] && C_PASSES_PRESENT=true
READING_C_NULL=""
if [ ! -d "$WASMLLVM" ]; then
  READING_C_NULL="wasm LLVM archive directory not mounted"
elif [ -z "$C_PATHS" ]; then
  READING_C_NULL="wasm LLVM archive directory mounted but none of the five named archives are in it"
fi
if [ -n "$C_PATHS" ]; then read_one C $C_PATHS; else printf '' > "$OUT/und-C.txt"; printf '' > "$OUT/def-C.txt"; printf '1 1\n' > "$OUT/nmexit-C.txt"; printf '' > "$OUT/archives-C.txt"; fi

# ---- Steps 6 and 7: residue, classification, report ---------------------------------------
export OUT IMAGE_DIGEST CLANG_VERSION WASI_SDK_PATH CMAKE_EXIT LLVM_LIBRARIES_LINE
export FOUND_LLVM_LINE PROVIDED_COUNT NM_PROVIDED_EXIT READING_C_NULL C_PASSES_PRESENT C_MISSING
python3 - <<'REPORT'
import json, os

OUT = os.environ['OUT']

# The classification, as an ORDERED list written out in full rather than a clever regex. Order
# matters and is chosen: `threads` precedes `signals` so `pthread_sigmask` lands with threads,
# and `non-local-jumps` precedes `unwinding` so Emscripten's shared invoke ABI is not read as
# pure exception handling.
#
# Two families are ADDED beyond the plan's nine, and both are corrections rather than
# decoration. `linker-provided` holds the wasm globals `wasm-ld` synthesises -- `__stack_pointer`
# and friends are NOT libc gaps, and leaving them in `other` would make every reading look like
# it had an unresolvable symbol it does not have. `compiler-rt` holds builtins the compiler
# runtime supplies. Both are stated in the report so the join with Plan 26-01's family names
# (process, signals, jumps, unwinding, dynamic, sockets, threads, control) stays legible:
# `jumps` there is `non-local-jumps` here, and `dynamic` is `dynamic-loading`.
FAMILIES = [
    ('linker-provided', {
        'exact': ['__stack_pointer', '__dso_handle', '__memory_base', '__table_base',
                  '__indirect_function_table', '__heap_base', '__data_end', '__global_base',
                  '__wasm_call_ctors', '__tls_base', '__tls_size', '__tls_align'],
        'prefix': [], 'contains': []}),
    ('compiler-rt', {
        'exact': ['__multi3', '__clear_cache', '__divti3', '__udivti3', '__muloti4',
                  '__umodti3', '__modti3', '__ashlti3', '__lshrti3'],
        'prefix': ['__aarch64_'], 'contains': []}),
    ('threads', {
        'exact': ['__libc_single_threaded', '__once_proxy', 'sched_getaffinity', 'sched_yield',
                  'sched_setaffinity', '__sched_cpualloc', '__sched_cpucount', '__sched_cpufree'],
        'prefix': ['pthread_', '__libcpp_tls', 'thrd_', 'mtx_', 'cnd_', 'tss_'],
        # Mangled C++ names, matched by substring because that is the only way to see them.
        'contains': ['condition_variable', 'recursive_mutex', '__shared_mutex_base',
                     'this_thread', 'NSt3__25mutex', 'NSt3__26thread', '__thread_',
                     'call_once', 'shared_timed_mutex']}),
    ('non-local-jumps', {
        'exact': ['setjmp', '_setjmp', 'sigsetjmp', 'longjmp', '_longjmp', 'siglongjmp',
                  '__longjmp_chk', 'emscripten_longjmp', 'emscripten_longjmp_jmpbuf',
                  '__THREW__', '__threwValue', 'getTempRet0', 'setTempRet0',
                  'saveSetjmp', 'testSetjmp'],
        'prefix': ['invoke_'], 'contains': []}),
    ('unwinding', {
        'exact': ['__gxx_personality_v0', '__gxx_personality_wasm0'],
        'prefix': ['_Unwind_', '__cxa_'], 'contains': []}),
    ('process', {
        'exact': ['fork', 'vfork', 'execv', 'execve', 'execvp', 'execvpe', 'execl', 'execlp',
                  'execle', 'fexecve', 'posix_spawn', 'posix_spawnp',
                  'posix_spawn_file_actions_init', 'posix_spawn_file_actions_destroy',
                  'posix_spawn_file_actions_addopen', 'posix_spawn_file_actions_adddup2',
                  'posix_spawnattr_init', 'posix_spawnattr_destroy',
                  'wait', 'waitpid', 'wait3', 'wait4', '__syscall_wait4', 'waitid',
                  'system', 'popen', 'pclose', 'pipe', 'pipe2', 'getsid', 'setsid',
                  'setpgid', 'getpgid', 'daemon', '_exit'],
        'prefix': [], 'contains': []}),
    ('signals', {
        'exact': ['signal', 'sigaction', 'kill', 'killpg', 'raise', 'sigprocmask', 'sigaltstack',
                  'sigemptyset', 'sigfillset', 'sigaddset', 'sigdelset', 'sigismember',
                  'sigsuspend', 'sigwait', 'sigwaitinfo', 'sigtimedwait', 'sigpending',
                  'siginterrupt', 'psignal', 'strsignal', 'bsd_signal', 'alarm', 'setitimer',
                  'getitimer'],
        'prefix': [], 'contains': []}),
    ('dynamic-loading', {
        'exact': ['dlopen', 'dlsym', 'dlclose', 'dlerror', 'dladdr', 'dladdr1',
                  'dl_iterate_phdr', 'dlvsym'],
        'prefix': [], 'contains': []}),
    ('sockets', {
        'exact': ['socket', 'socketpair', 'connect', 'bind', 'listen', 'accept', 'accept4',
                  'send', 'sendto', 'sendmsg', 'recv', 'recvfrom', 'recvmsg', 'shutdown',
                  'getsockopt', 'setsockopt', 'getsockname', 'getpeername', 'getaddrinfo',
                  'freeaddrinfo', 'gai_strerror', 'gethostbyname', 'gethostname',
                  'sethostname', 'inet_ntop', 'inet_pton', 'select', 'pselect'],
        'prefix': [], 'contains': []}),
    ('filesystem', {
        'exact': ['statfs', 'fstatfs', 'statvfs', 'fstatvfs', 'chown', 'fchown', 'lchown',
                  'chmod', 'fchmod', 'fchmodat', 'dup', 'dup2', 'dup3', 'readlink', 'symlink',
                  'link', 'unlink', 'rename', 'mkdir', 'rmdir', 'opendir', 'readdir',
                  'closedir', 'realpath', 'getcwd', 'chdir', 'fchdir', 'truncate', 'ftruncate',
                  'fcntl', 'ioctl', 'lseek', 'mmap', 'munmap', 'mprotect', 'msync', 'madvise',
                  'posix_madvise', 'posix_fadvise', 'flock', 'lockf', 'mkstemp', 'mkdtemp',
                  'umask', 'access', 'faccessat', 'utimes', 'futimes'],
        'prefix': [], 'contains': []}),
]


def classify(symbol):
    for name, rules in FAMILIES:
        if symbol in rules['exact']:
            return name
        if any(symbol.startswith(p) for p in rules['prefix']):
            return name
        if any(c in symbol for c in rules['contains']):
            return name
    return 'other'


# `other` on an LLVM archive is long and the interesting families are the named ones. It is
# TRUNCATED rather than dropped, and the report says at what number, because a silent
# truncation is deficiency D21's exact shape.
OTHER_CUT = 200
# Attribution lists are capped at this many members per symbol, with the uncapped count kept
# beside them, for the reason given where the cap is applied.
MEMBER_CUT = 12
# Sited against the measured readings rather than picked: reading B reads 10 844 undefined
# symbols and reading C 2 116, so a reading returning under a hundred did not read an archive
# set -- it read nothing, or read one small object. This is the single most important number in
# the file: a GO produced by an nm that read nothing is the worst outcome this plan can have.
LIVENESS_FLOOR = 100


def lines(path):
    try:
        with open(path, encoding='utf8') as handle:
            return [line.rstrip('\n') for line in handle if line.strip()]
    except OSError:
        return []


provided = set(lines(f'{OUT}/provided.txt'))


def members_by_symbol(label):
    """Which archive MEMBER references each undefined symbol.

    WHY THIS IS NOT A NICETY. `llvm-nm --undefined-only` over an ARCHIVE reads every member,
    but a link pulls in only the members it needs. So an archive-wide residue is an UPPER
    BOUND on what a link would demand, and reporting `fork` without saying it comes from
    `Program.cpp.o` invites the reader to conclude that elflift calls fork -- which this
    measurement does not show and cannot. Attribution turns "LLVM's archives mention fork"
    into "one member of LLVMSupport mentions fork", which is a far narrower and far more
    useful claim, and it is the claim the evidence actually supports.

    llvm-nm prints bare `member.o:` headers with no archive prefix, so two same-named members
    in different archives would merge here. Recorded as a limitation rather than papered over.
    """
    result = {}
    current = None
    try:
        with open(f'{OUT}/nm-{label}-und.txt', encoding='utf8', errors='replace') as handle:
            for raw in handle:
                line = raw.rstrip('\n')
                if not line:
                    continue
                if not line.startswith(' ') and line.endswith(':'):
                    current = line[:-1]
                    continue
                parts = line.split()
                if len(parts) == 2 and parts[0] == 'U' and current is not None:
                    result.setdefault(parts[1], set()).add(current)
    except OSError:
        return {}
    return result


def reading(label, note):
    undefined = lines(f'{OUT}/und-{label}.txt')
    defined = set(lines(f'{OUT}/def-{label}.txt'))
    raw = lines(f'{OUT}/nmexit-{label}.txt')
    und_exit, def_exit = (int(x) for x in raw[0].split()) if raw else (1, 1)
    archives = lines(f'{OUT}/archives-{label}.txt')
    # residue = demanded, minus what preview1 supplies, minus what this reading defines itself.
    residue = sorted(s for s in undefined if s not in provided and s not in defined)
    families, members = {}, {}
    for symbol in residue:
        family = classify(symbol)
        families[family] = families.get(family, 0) + 1
        members.setdefault(family, []).append(symbol)
    truncated = {}
    for family, group in members.items():
        if family == 'other' and len(group) > OTHER_CUT:
            truncated[family] = {'total': len(group), 'shown': OTHER_CUT}
            members[family] = group[:OTHER_CUT]
    # Attribution for the NAMED families only -- `other` is where LLVM's own internals land and
    # attributing all of it would triple the report for no gain.
    owners = members_by_symbol(label)
    attribution = {}
    for family, group in members.items():
        if family == 'other':
            continue
        for symbol in group:
            names = sorted(owners.get(symbol, []))
            # Capped, with the true count kept beside it. `__cxa_throw` is referenced by ~100
            # members of the LLVM 17 build, and a hundred filenames per symbol would triple
            # the report to say one thing the count already says. The COUNT is the finding --
            # a symbol referenced by one member is a candidate for dead-stripping, and one
            # referenced by a hundred is not.
            attribution[symbol] = {'count': len(names), 'members': names[:MEMBER_CUT]}
    alive = len(undefined) > LIVENESS_FLOOR
    return {
        'label': label,
        'note': note,
        'archives': archives,
        'archiveCount': len(archives),
        'nmUndefinedExit': und_exit,
        'nmDefinedExit': def_exit,
        'undefinedCount': len(undefined),
        'definedCount': len(defined),
        'residueCount': len(residue),
        'families': dict(sorted(families.items())),
        'members': {k: members[k] for k in sorted(members)},
        'memberOf': attribution,
        'truncated': truncated,
        'alive': alive,
        'insufficientReason': None if alive else (
            f'undefinedCount {len(undefined)} is at or below the liveness floor of '
            f'{LIVENESS_FLOOR}; this reading is reported but no absence may be concluded '
            f'from it'),
    }


with open(f'{OUT}/tus.json', encoding='utf8') as handle:
    replay = json.load(handle)

c_null = os.environ.get('READING_C_NULL') or None
readings = {
    'A': reading('A', 'objects this run emitted for wasm32-wasi -- authoritative for elfconv '
                      'and remill source only, and only as wide as the arm compiled'),
    'AT': reading('AT', 'objects this run emitted for wasm32-wasi-threads -- the second arm, '
                        'present because Plan 26-01 scoped every thread absence to the '
                        'non-threads sysroot and never read this one'),
    'B': reading('B', 'host LLVM 16.0.6 static archives in the image plus gflags/glog/XED. '
                      'HOST ELF objects built with LLVM_ON_UNIX, so this OVERSTATES what a '
                      'wasm build demands -- an upper bound biased in the safe direction'),
}
if c_null is None:
    readings['C'] = reading('C', 'wasm-compiled LLVM 17.0.6 archives from the neighbouring '
                                 'checkout. REAL WASM OBJECTS, so much closer to a wasi build '
                                 'than reading B -- but EMSCRIPTEN, not WASI, and 17.0.6 '
                                 'against the image LLVM 16.0.6')
else:
    readings['C'] = None

report = {
    'image': os.environ.get('IMAGE_DIGEST', 'unrecorded'),
    'clangVersion': os.environ.get('CLANG_VERSION', ''),
    'wasiSdkPath': os.environ.get('WASI_SDK_PATH', ''),
    'cmakeExit': int(os.environ.get('CMAKE_EXIT', '1')),
    'llvmLibrariesLine': os.environ.get('LLVM_LIBRARIES_LINE', ''),
    'foundLlvmLine': os.environ.get('FOUND_LLVM_LINE', ''),
    'entriesTotal': replay['entriesTotal'],
    'entriesSkipped': replay['entriesSkipped'],
    'addedFlags': replay['addedFlags'],
    'keepPrefixes': replay['keepPrefixes'],
    'addedFlagsControl': replay['addedFlagsControl'],
    'tus': replay['tus'],
    'threadsArm': replay['threadsArm'],
    'providedCount': int(os.environ.get('PROVIDED_COUNT', '0')),
    'nmExits': {'provided': int(os.environ.get('NM_PROVIDED_EXIT', '1'))},
    'readings': readings,
    'readingCNull': c_null,
    # Recorded ALWAYS, present or absent, because it is one of the six libraries the fork's
    # CMakeLists names and its absence narrows what reading C can speak for. The fork's own
    # comment at backend/remill/CMakeLists.txt:56 already says so.
    'readingCPassesPresent': os.environ.get('C_PASSES_PRESENT') == 'true',
    'readingCMissingArchives': os.environ.get('C_MISSING', '').split(),
    'livenessFloor': 100,
    'otherFamilyCut': 200,
    'memberAttributionCut': 12,
}

with open(f'{OUT}/gate.json', 'w', encoding='utf8') as handle:
    json.dump(report, handle, indent=1)

passed = sum(1 for t in report['tus'] if t['exit'] == 0 and t['objectBytes'])
print(f"gate written to {OUT}/gate.json "
      f"({passed}/{len(report['tus'])} TUs produced an object for wasm32-wasi, "
      f"provided={report['providedCount']})")
REPORT
REPORT_EXIT=$?
[ "$REPORT_EXIT" -eq 0 ] || { echo "report assembly failed ($REPORT_EXIT)" >&2; exit 44; }
[ -f "$OUT/gate.json" ] || { echo "no gate.json produced" >&2; exit 44; }

# The container runs as root; without this the host-side spec cannot read what root wrote.
# Matches `elfconv-differential.sh:152` and `wasi-preview1-surface.sh:210`.
chmod -R a+rwX "$OUT" 2>/dev/null
