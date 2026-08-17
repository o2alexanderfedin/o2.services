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

# `-fno-exceptions` is NOT passed: elfconv's own objects were compiled with exceptions on and
# reference __cxa_*, so the libraries must agree.
COMMON=(
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN"
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5
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

cmake -S "$ROOT/deps/gflags" -B "$ROOT/deps/gflags-build" -G Ninja "${COMMON[@]}" \
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
