#!/bin/bash
# Build gflags and glog for wasm32-wasi — the last two libraries `elflift` needs.
#
# ## Why only these two, and how that is known rather than assumed
#
# `llvm-nm` over the 27 wasm objects, undefined minus defined, leaves **467 external
# symbols**. They resolve to exactly four places:
#
#   279  llvm::            -> build-wasi-llvm.sh
#    99  std:: / libc++    -> already in the sysroot
#   ~70  libc              -> already in the sysroot (wasi-libc)
#     4  __cxa / _Unwind   -> already in the sysroot (libc++abi)
#    16  google::          -> THIS SCRIPT
#
# Sixteen symbols: `LogMessage`, `LogMessageFatal`, `InitGoogleLogging`,
# `CheckOpMessageBuilder`, `MakeCheckOpValueString`, plus three from gflags —
# `FlagRegisterer` twice and `ParseCommandLineFlags`. Nothing else is missing, and in
# particular `MainLifter`, `BinaryLoader` and `AArch64TraceManager` are NOT in the list: the
# 27 objects are self-contained on elfconv's own code.
#
# Writing sixteen stubs by hand was the alternative and is worse: the mangled names encode
# glog's class layout, so a stub has to reproduce the headers exactly to link, at which point
# it is glog with the behaviour removed. These are the real libraries at the versions
# `dependencies/CMakeLists.txt` pins.
#
# ## Versions
#
# Read from the image, not chosen: `dependencies/CMakeLists.txt:41,43` pins
# gflags at 52e94563eba1968783864942fedf6e87e3c611f4 and glog at v0.7.1.
#
# ## Prerequisite
#
# `build-wasi-llvm.sh` must have run at least as far as making `$ROOT/wasi-sdk` — this uses
# the same patched threadless sysroot, so glog and LLVM are built against one libc++.
#
# Usage:
#
#   bash tools/aot/build-wasi-deps.sh 2>&1 | tee /tmp/wasi-deps.log
#
# `set -e` is deliberately absent — see build-wasi-llvm.sh's header for what it cost.

set -u

ROOT=${ROOT:-/Volumes/ProjectsSSD/o2-wasi-llvm}
WASI_SDK="$ROOT/wasi-sdk"
JOBS=${JOBS:-$(sysctl -n hw.ncpu)}

GFLAGS_COMMIT=52e94563eba1968783864942fedf6e87e3c611f4
GLOG_TAG=v0.7.1

TOOLCHAIN="$WASI_SDK/share/cmake/wasi-sdk.cmake"
if [ ! -f "$TOOLCHAIN" ]; then
  echo "no patched sdk at $WASI_SDK — run build-wasi-llvm.sh first" >&2
  exit 28
fi

mkdir -p "$ROOT/lib" "$ROOT/deps"

# The same WASI emulation and POSIX compat layer the LLVM cross-build uses. glog reaches for
# signals, `getpwuid` and `<sys/wait.h>` exactly as LLVM's Support library does, so it hits the
# same absent surface for the same reason -- wasi-libc removes it behind
# `#ifdef __wasilibc_unmodified_upstream`. Passing this here rather than discovering it one
# build round at a time; see tools/aot/wasi-compat/wasi-posix-compat.h for what it supplies
# and what it deliberately withholds.
COMPAT=${COMPAT:-$(cd "$(dirname "$0")" && pwd)/wasi-compat}
[ -f "$COMPAT/wasi-posix-compat.h" ] || {
  echo "no compat header at $COMPAT/wasi-posix-compat.h" >&2; exit 39; }

WASI_EMULATION="-D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_PROCESS_CLOCKS -mllvm -wasm-enable-sjlj -I$COMPAT -include $COMPAT/wasi-posix-compat.h"

# `-fno-exceptions` is NOT passed: elfconv's own objects were compiled with exceptions on and
# reference __cxa_*, so the libraries must agree.
COMMON=(
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN"
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5
  -DCMAKE_C_FLAGS="$WASI_EMULATION"
  -DCMAKE_CXX_FLAGS="$WASI_EMULATION"
  -DBUILD_SHARED_LIBS=OFF
  -DBUILD_TESTING=OFF
)

echo "=== 1/3  gflags @ ${GFLAGS_COMMIT:0:12} ==================================="
if [ ! -d "$ROOT/deps/gflags/.git" ]; then
  git clone https://github.com/gflags/gflags.git "$ROOT/deps/gflags"
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "gflags clone failed ($EXIT)" >&2; exit 40; }
  git -C "$ROOT/deps/gflags" checkout --quiet "$GFLAGS_COMMIT"
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "gflags checkout failed ($EXIT)" >&2; exit 41; }
else
  echo "SKIP  already cloned"
fi

# `NO_THREADS` is gflags' own name for this, offered by the very error it raises otherwise:
# `src/mutex.h:147` reads `# error Need to implement mutex.h for your architecture, or
# #define NO_THREADS`. Under it, `src/mutex.h:111` supplies a Mutex whose Lock/Unlock do
# nothing -- which is the same conclusion reached for libc++'s std::mutex on this target, and
# correct for the same reason: there is no second thread to exclude.
#
# It is set HERE and not in COMMON deliberately. glog is a different codebase with its own
# threading configuration, and had not even been cloned when this failure appeared, so
# applying gflags' macro to it would be a guess rather than a measurement.
#
# Note the flags string repeats WASI_EMULATION: a second -DCMAKE_CXX_FLAGS overrides the one
# in COMMON rather than adding to it.
cmake -S "$ROOT/deps/gflags" -B "$ROOT/deps/gflags-build" -G Ninja "${COMMON[@]}" \
  -DCMAKE_CXX_FLAGS="$WASI_EMULATION -DNO_THREADS" \
  -DGFLAGS_BUILD_STATIC_LIBS=ON \
  -DGFLAGS_BUILD_SHARED_LIBS=OFF \
  -DGFLAGS_BUILD_gflags_LIB=ON \
  -DGFLAGS_BUILD_gflags_nothreads_LIB=ON \
  -DGFLAGS_BUILD_TESTING=OFF \
  -DCMAKE_INSTALL_PREFIX="$ROOT/deps/prefix" > "$ROOT/cmake-gflags.log" 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "gflags configure failed ($EXIT)" >&2; tail -30 "$ROOT/cmake-gflags.log" >&2; exit 42; }

ninja -C "$ROOT/deps/gflags-build" -j "$JOBS" > "$ROOT/ninja-gflags.log" 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "gflags build failed ($EXIT)" >&2; tail -40 "$ROOT/ninja-gflags.log" >&2; exit 43; }
cmake --install "$ROOT/deps/gflags-build" > /dev/null 2>&1
echo "OK    gflags built"

echo "=== 2/3  glog $GLOG_TAG ==================================================="
if [ ! -d "$ROOT/deps/glog/.git" ]; then
  git clone --depth 1 --branch "$GLOG_TAG" https://github.com/google/glog.git "$ROOT/deps/glog"
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "glog clone failed ($EXIT)" >&2; exit 44; }
else
  echo "SKIP  already cloned"
fi

# glog has branches for Windows, Cygwin, Linux, Android, macOS, three BSDs and Emscripten,
# and `#error`s on anything else. WASI is simply absent — two lines.
python3 - "$ROOT/deps/glog/src/glog/platform.h" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
if '__wasi__' in s:
    print('SKIP  glog platform.h already has a __wasi__ branch'); raise SystemExit
anchor = '#elif defined(__EMSCRIPTEN__)\n#  define GLOG_OS_EMSCRIPTEN\n'
if anchor not in s:
    print(f'MISS  no Emscripten branch to sit beside in {p}'); raise SystemExit(9)
open(p, 'w').write(s.replace(anchor, anchor + '#elif defined(__wasi__)\n#  define GLOG_OS_WASI\n', 1))
print('OK    glog platform.h: __wasi__ branch')
PY
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "glog patch failed ($EXIT)" >&2; exit 45; }

# glog's CMakeLists.txt calls `find_package (Threads REQUIRED)` unconditionally -- it does
# not consult its own WITH_THREADS option, which this script already sets to OFF. On
# wasm32-wasi there is no pthread library to find, so configure stops with "Could NOT find
# Threads" before a single source file is looked at.
#
# The patch makes the lookup obey WITH_THREADS. That is glog's own switch for exactly this,
# so nothing new is being invented -- and it is preferable to the usual cross-compile dodge
# of stuffing CMAKE_USE_PTHREADS_INIT and friends into the cache, which would leave glog
# believing pthreads exist and emitting calls that only fail later, at link.
# There are TWO sites, and gating only the first cost a round: configure then failed one step
# later with `Target "glog" links to: Threads::Threads but the target was not found`. Each
# edit therefore carries its own applied/not-applied test, so a partially-patched checkout --
# which is exactly what that round left behind -- gets finished rather than skipped.
python3 - "$ROOT/deps/glog/CMakeLists.txt" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()

edits = [
    ('the Threads lookup',
     'find_package (Threads REQUIRED)\n',
     'if (WITH_THREADS)\n  find_package (Threads REQUIRED)\nendif (WITH_THREADS)\n'),
    ('the Threads::Threads link',
     'target_link_libraries (glog PRIVATE Threads::Threads)\n',
     'if (WITH_THREADS)\n  target_link_libraries (glog PRIVATE Threads::Threads)\n'
     'endif (WITH_THREADS)\n'),
]

applied, skipped = [], []
for name, old, new in edits:
    if new in s:
        skipped.append(name); continue
    if old not in s:
        print(f'MISS  {name} is not the shape this patch expects, in {p}')
        raise SystemExit(9)
    s = s.replace(old, new, 1)
    applied.append(name)

if applied:
    open(p, 'w').write(s)
    print('OK    glog CMakeLists: ' + ' and '.join(applied) + ' now obey WITH_THREADS')
if skipped:
    print('SKIP  glog CMakeLists: ' + ' and '.join(skipped) + ' already gated')
PY
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "glog Threads patch failed ($EXIT)" >&2; exit 48; }

# `raw_logging.cc` writes through `syscall(SYS_write, ...)` to stay async-signal-safe, and
# selects that path on `HAVE_SYS_SYSCALL_H` while naming the platforms it must not use it on:
# macOS, OpenBSD and Emscripten. This sysroot HAS <sys/syscall.h>, so the test passes -- but
# it defines no SYS_write, because a wasm module makes no syscalls. WASI belongs in the
# exclusion list beside Emscripten, for the same reason Emscripten is there.
#
# The `#else` arm it falls to is plain `write(fd, s, len)`, which glog itself labels "Not so
# safe, but what can you do?" -- and here it is in fact exactly as safe, since no signal is
# ever delivered to interrupt it.
python3 - "$ROOT/deps/glog/src/raw_logging.cc" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
if 'GLOG_OS_WASI' in s:
    print('SKIP  raw_logging.cc already excludes wasi from the syscall path'); raise SystemExit
old = '    !defined(GLOG_OS_EMSCRIPTEN)\n'
if old not in s:
    print(f'MISS  no Emscripten exclusion to join in {p}'); raise SystemExit(9)
new = '    !defined(GLOG_OS_EMSCRIPTEN) && !defined(GLOG_OS_WASI)\n'
open(p, 'w').write(s.replace(old, new, 1))
print('OK    raw_logging.cc: wasi joins Emscripten in avoiding syscall(SYS_write)')
PY
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "glog raw_logging patch failed ($EXIT)" >&2; exit 49; }

# WITH_GFLAGS=ON so glog's flags register through the gflags just built — that is how the
# image's own build is configured, and mixing the two would leave duplicate FLAGS_ symbols.
cmake -S "$ROOT/deps/glog" -B "$ROOT/deps/glog-build" -G Ninja "${COMMON[@]}" \
  -DWITH_GFLAGS=ON \
  -DWITH_GTEST=OFF \
  -DWITH_UNWIND=OFF \
  -DWITH_SYMBOLIZE=OFF \
  -DWITH_THREADS=OFF \
  -DCMAKE_PREFIX_PATH="$ROOT/deps/prefix" \
  -DCMAKE_INSTALL_PREFIX="$ROOT/deps/prefix" > "$ROOT/cmake-glog.log" 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "glog configure failed ($EXIT)" >&2; tail -30 "$ROOT/cmake-glog.log" >&2; exit 46; }

ninja -C "$ROOT/deps/glog-build" -j "$JOBS" > "$ROOT/ninja-glog.log" 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "glog build failed ($EXIT)" >&2; tail -40 "$ROOT/ninja-glog.log" >&2; exit 47; }
cmake --install "$ROOT/deps/glog-build" > /dev/null 2>&1
echo "OK    glog built"

echo "=== 3/3  collect ==========================================================="
find "$ROOT/deps" -name 'libgflags*.a' -o -name 'libglog*.a' | while read -r a; do
  cp "$a" "$ROOT/lib/"
  echo "  $(basename "$a")  $(wc -c < "$a") bytes"
done
echo "=== archives are in $ROOT/lib ==="
