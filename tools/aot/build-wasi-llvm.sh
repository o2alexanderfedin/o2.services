#!/bin/bash
# Cross-build the LLVM archives `elflift` links, for wasm32-wasi. Runs on the HOST.
#
# This is the one unpaid cost left in AOTW-06. Every one of elfconv's 27 translation units
# already compiles for wasm32-wasi (`elflift-wasi-port.sh`); the only thing missing is
# something to link them against.
#
# ## Why the host and not the elfconv container
#
# The container buys nothing. Its wasi-sdk is 24.0 with `clang 18.1.2-wasi-sdk`, and the copy
# at `Projects/hapyy/wasi-sdk-24.0-arm64-macos` reports the identical version string and the
# identical upstream commit. wasm objects do not carry the identity of the machine that
# emitted them. The host has the same 8 cores, a native filesystem instead of a virtiofs bind
# mount, and a clone that survives a failed run.
#
# ## Why LLVM 16.0.6 and not the 17 already on disk
#
# `Projects/hapyy/llvm-wasm` is release/17.x, and elfconv's fork does know about 17 —
# `backend/remill/lib/Arch/Arch.cpp:37` has an `#if LLVM_VERSION_MAJOR >= 17` branch. But the
# 27 objects that already exist were compiled against **16**'s headers, so 16 links them as
# they are and 17 means recompiling everything first. A shallow clone costs three minutes.
#
# ## Why the SDK is copied
#
# LLVM's Support library uses `std::mutex` and `std::thread::id`, and libc++ configured
# without threads refuses both — the wall `elflift-wasi-port.sh` documents and removes. The
# same patches are needed here, and applying them to a shared SDK would edit a tree other
# projects use. `wasi-sdk.cmake` derives `WASI_SDK_PREFIX` from its own location, so a copy
# is self-consistent with no flags. 349 MB.
#
# ## Cost
#
# 8 cores. Expect 60-120 minutes and roughly 8 GB. Resumable: re-running skips the copy, the
# clone, and stage 1 if they are already there.
#
# ## Usage
#
#   bash tools/aot/build-wasi-llvm.sh 2>&1 | tee /tmp/wasi-llvm-build.log
#
# On success `$ROOT/lib` holds the archives and `$ROOT/DONE` lists them.
#
# **`set -e` is deliberately NOT used.** The first version of this script had it, and it made
# the shell exit on the failing `cmake` line *before* the `EXIT=$?` that reads its status —
# so a real failure printed nothing at all and looked like a clean finish. Every command
# below reads its own exit code on the very next line, with no pipe, which is this
# repository's standing rule about exit codes.

set -u

ROOT=${ROOT:-/Volumes/ProjectsSSD/o2-wasi-llvm}
SDK_SRC=${SDK_SRC:-/Users/alexanderfedin/Projects/hapyy/wasi-sdk-24.0-arm64-macos}
WASI_SDK="$ROOT/wasi-sdk"
SRC="$ROOT/llvm-16"
JOBS=${JOBS:-$(sysctl -n hw.ncpu)}
LLVM_TAG=${LLVM_TAG:-llvmorg-16.0.6}

# The six remill names in `backend/remill/CMakeLists.txt:53-57`. That comment records why the
# list is this short: the lifter never asks LLVM to emit code for the source ISA, so no
# codegen, target, asmparser or asmprinter library is needed. Note that ninja expands these
# transitively — `llvm-config --link-static --libs` for the same six resolves to about 35
# archives, because `passes` pulls the optimizer in.
COMPONENTS="LLVMSupport LLVMCore LLVMIRReader LLVMBitReader LLVMBitWriter LLVMPasses"

mkdir -p "$ROOT/lib"

echo "=== 0/4  private copy of the wasi-sdk ====================================="
if [ ! -x "$WASI_SDK/bin/clang" ]; then
  cp -a "$SDK_SRC" "$WASI_SDK"
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "sdk copy failed ($EXIT)" >&2; exit 29; }
  echo "OK    copied to $WASI_SDK"
else
  echo "SKIP  $WASI_SDK already present"
fi
"$WASI_SDK/bin/clang" --version | head -1

echo "=== 0b/4 patch the threadless libc++ in that copy =========================="
SYSROOT="$WASI_SDK/share/wasi-sysroot/include/wasm32-wasi/c++/v1"
python3 - "$SYSROOT" <<'PY'
import sys
S = sys.argv[1]

def edit(path, old, new, why):
    s = open(path).read()
    if new in s:
        print(f'SKIP  {why}'); return
    if old not in s:
        print(f'MISS  {why} in {path}'); sys.exit(9)
    open(path, 'w').write(s.replace(old, new, 1)); print(f'OK    {why}')

# lock_guard / unique_lock / the lock tag types reference no __libcpp_* symbol at all.
# Measured, not assumed. libc++ gates them anyway.
for name in ('tag_types', 'lock_guard', 'unique_lock'):
    edit(f'{S}/__mutex/{name}.h',
         '#ifndef _LIBCPP_HAS_NO_THREADS',
         '#if 1  // o2: nothing below this line needs threading support',
         f'__mutex/{name}.h: un-gated')

# std::mutex does wrap __libcpp_mutex_t. With no second thread to exclude, a no-op is the
# correct implementation rather than a stub. The guard here sits OUTSIDE the namespace.
edit(f'{S}/__mutex/mutex.h',
     '#ifndef _LIBCPP_HAS_NO_THREADS',
     '''#ifdef _LIBCPP_HAS_NO_THREADS
_LIBCPP_BEGIN_NAMESPACE_STD
class mutex {
public:
  _LIBCPP_HIDE_FROM_ABI constexpr mutex() = default;
  mutex(const mutex&) = delete;
  mutex& operator=(const mutex&) = delete;
  _LIBCPP_HIDE_FROM_ABI void lock() {}
  _LIBCPP_HIDE_FROM_ABI bool try_lock() { return true; }
  _LIBCPP_HIDE_FROM_ABI void unlock() {}
  typedef void* native_handle_type;
  _LIBCPP_HIDE_FROM_ABI native_handle_type native_handle() { return nullptr; }
};
_LIBCPP_END_NAMESPACE_STD
#endif // _LIBCPP_HAS_NO_THREADS

#ifndef _LIBCPP_HAS_NO_THREADS''',
     '__mutex/mutex.h: a no-op std::mutex')

# recursive_mutex goes into <mutex> itself, which opens the namespace at :217 and closes it
# at :512 — so NO _LIBCPP_BEGIN_NAMESPACE_STD here. Opening it twice declares `std::std`, and
# every later header then fails on names it cannot find. Measured, from getting it wrong:
# 13/27 became 4/27 with "no member named 'swap' in namespace 'std::std'".
edit(f'{S}/mutex',
     '#endif   // !_LIBCPP_HAS_NO_THREADS',
     '''#endif   // !_LIBCPP_HAS_NO_THREADS

#ifdef _LIBCPP_HAS_NO_THREADS
class recursive_mutex {
public:
  _LIBCPP_HIDE_FROM_ABI recursive_mutex() = default;
  recursive_mutex(const recursive_mutex&) = delete;
  recursive_mutex& operator=(const recursive_mutex&) = delete;
  _LIBCPP_HIDE_FROM_ABI void lock() {}
  _LIBCPP_HIDE_FROM_ABI bool try_lock() noexcept { return true; }
  _LIBCPP_HIDE_FROM_ABI void unlock() noexcept {}
  typedef void* native_handle_type;
  _LIBCPP_HIDE_FROM_ABI native_handle_type native_handle() { return nullptr; }
};
template <class _L0>
_LIBCPP_HIDE_FROM_ABI void lock(_L0& __l0) { __l0.lock(); }
template <class _L0, class _L1, class... _L2>
_LIBCPP_HIDE_FROM_ABI void lock(_L0& __l0, _L1& __l1, _L2&... __l2) {
  __l0.lock(); __l1.lock(); (__l2.lock(), ...);
}
template <class _L0>
_LIBCPP_HIDE_FROM_ABI int try_lock(_L0& __l0) { return __l0.try_lock() ? -1 : 0; }
#endif // _LIBCPP_HAS_NO_THREADS''',
     'mutex: recursive_mutex and the variadic lock helpers')
PY
PATCH_EXIT=$?
[ "$PATCH_EXIT" -eq 0 ] || { echo "sysroot patch failed ($PATCH_EXIT)" >&2; exit 9; }

cat > "$SYSROOT/thread" <<'HDR'
// <thread> for a libc++ configured without threads -- the subset that needs no threading.
// std::thread itself has NO constructors: starting a thread stays a hard compile error.
#ifndef _LIBCPP_THREAD
#define _LIBCPP_THREAD
#include <__config>
#include <__fwd/hash.h>
#include <cstddef>
#include <iosfwd>
#ifndef _LIBCPP_HAS_NO_THREADS
#  error "this <thread> shim belongs only to the threadless wasm32-wasi sysroot"
#endif
_LIBCPP_BEGIN_NAMESPACE_STD
class thread {
public:
  class id {
  public:
    id() noexcept : __id_(0) {}
    explicit id(unsigned long long __v) noexcept : __id_(__v) {}
    friend bool operator==(id __x, id __y) noexcept { return __x.__id_ == __y.__id_; }
    friend bool operator!=(id __x, id __y) noexcept { return !(__x == __y); }
    friend bool operator<(id __x, id __y) noexcept { return __x.__id_ < __y.__id_; }
    friend bool operator<=(id __x, id __y) noexcept { return !(__y < __x); }
    friend bool operator>(id __x, id __y) noexcept { return __y < __x; }
    friend bool operator>=(id __x, id __y) noexcept { return !(__x < __y); }
    template <class _CharT, class _Traits>
    friend basic_ostream<_CharT, _Traits>& operator<<(basic_ostream<_CharT, _Traits>& __os, id __x) {
      return __os << __x.__id_;
    }
    unsigned long long __value() const noexcept { return __id_; }
  private:
    unsigned long long __id_;
  };
};
template <> struct hash<thread::id> {
  size_t operator()(thread::id __x) const noexcept { return static_cast<size_t>(__x.__value()); }
};
namespace this_thread { inline thread::id get_id() noexcept { return thread::id(1); } }
_LIBCPP_END_NAMESPACE_STD
#endif  // _LIBCPP_THREAD
HDR
echo "OK    <thread> shim installed"

cat > "$SYSROOT/shared_mutex" <<'HDR'
// <shared_mutex> for a libc++ configured without threads. A reader/writer lock with no second
// thread to arbitrate is a no-op; libc++ refuses the header outright instead.
#ifndef _LIBCPP_SHARED_MUTEX
#define _LIBCPP_SHARED_MUTEX
#include <__config>
#include <__mutex/tag_types.h>
#include <__mutex/unique_lock.h>
#include <cstddef>
#ifndef _LIBCPP_HAS_NO_THREADS
#  error "this <shared_mutex> shim belongs only to the threadless wasm32-wasi sysroot"
#endif
_LIBCPP_BEGIN_NAMESPACE_STD
class shared_mutex {
public:
  _LIBCPP_HIDE_FROM_ABI shared_mutex() = default;
  shared_mutex(const shared_mutex&) = delete;
  shared_mutex& operator=(const shared_mutex&) = delete;
  _LIBCPP_HIDE_FROM_ABI void lock() {}
  _LIBCPP_HIDE_FROM_ABI bool try_lock() { return true; }
  _LIBCPP_HIDE_FROM_ABI void unlock() {}
  _LIBCPP_HIDE_FROM_ABI void lock_shared() {}
  _LIBCPP_HIDE_FROM_ABI bool try_lock_shared() { return true; }
  _LIBCPP_HIDE_FROM_ABI void unlock_shared() {}
};
using shared_timed_mutex = shared_mutex;
template <class _Mutex>
class shared_lock {
public:
  typedef _Mutex mutex_type;
  _LIBCPP_HIDE_FROM_ABI shared_lock() noexcept : __m_(nullptr), __owns_(false) {}
  _LIBCPP_HIDE_FROM_ABI explicit shared_lock(mutex_type& __m) : __m_(&__m), __owns_(true) { __m.lock_shared(); }
  _LIBCPP_HIDE_FROM_ABI shared_lock(mutex_type& __m, defer_lock_t) noexcept : __m_(&__m), __owns_(false) {}
  _LIBCPP_HIDE_FROM_ABI shared_lock(mutex_type& __m, adopt_lock_t) : __m_(&__m), __owns_(true) {}
  _LIBCPP_HIDE_FROM_ABI ~shared_lock() { if (__owns_ && __m_) __m_->unlock_shared(); }
  shared_lock(const shared_lock&) = delete;
  shared_lock& operator=(const shared_lock&) = delete;
  _LIBCPP_HIDE_FROM_ABI void lock() { if (__m_) { __m_->lock_shared(); __owns_ = true; } }
  _LIBCPP_HIDE_FROM_ABI bool try_lock() { __owns_ = __m_ && __m_->try_lock_shared(); return __owns_; }
  _LIBCPP_HIDE_FROM_ABI void unlock() { if (__m_) __m_->unlock_shared(); __owns_ = false; }
  _LIBCPP_HIDE_FROM_ABI bool owns_lock() const noexcept { return __owns_; }
  _LIBCPP_HIDE_FROM_ABI explicit operator bool() const noexcept { return __owns_; }
  _LIBCPP_HIDE_FROM_ABI mutex_type* mutex() const noexcept { return __m_; }
private:
  mutex_type* __m_;
  bool __owns_;
};
_LIBCPP_END_NAMESPACE_STD
#endif  // _LIBCPP_SHARED_MUTEX
HDR
echo "OK    <shared_mutex> shim installed"

echo "=== 1/4  fetch llvm-project $LLVM_TAG ====================================="
if [ ! -d "$SRC/llvm" ]; then
  git clone --depth 1 --branch "$LLVM_TAG" https://github.com/llvm/llvm-project.git "$SRC"
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "clone failed ($EXIT)" >&2; exit 30; }
else
  echo "SKIP  $SRC already present"
fi

echo "=== 2/4  stage 1: tblgen for the HOST ====================================="
# A cross-build cannot run a wasm tblgen, so this one is built for the host and stage 2 is
# pointed at it. `llvm-min-tblgen` is NOT a target in 16 — it arrives in 17 — and naming it
# here is what killed the first run: `ninja: error: unknown target 'llvm-min-tblgen'`.
if [ ! -x "$SRC/build-native/bin/llvm-tblgen" ]; then
  cmake -S "$SRC/llvm" -B "$SRC/build-native" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLVM_INCLUDE_TESTS=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_EXAMPLES=OFF > "$ROOT/cmake-native.log" 2>&1
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "native configure failed ($EXIT)" >&2; tail -30 "$ROOT/cmake-native.log" >&2; exit 31; }
  ninja -C "$SRC/build-native" -j "$JOBS" llvm-tblgen > "$ROOT/ninja-native.log" 2>&1
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "tblgen build failed ($EXIT)" >&2; tail -30 "$ROOT/ninja-native.log" >&2; exit 32; }
else
  echo "SKIP  tblgen already built"
fi
"$SRC/build-native/bin/llvm-tblgen" --version | head -2

echo "=== 3/4  stage 2: cross-configure for wasm32-wasi ========================="
cmake -S "$SRC/llvm" -B "$SRC/build-wasi" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$WASI_SDK/share/cmake/wasi-sdk.cmake" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_CROSSCOMPILING=ON \
  -DLLVM_HOST_TRIPLE=wasm32-wasi \
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_TABLEGEN="$SRC/build-native/bin/llvm-tblgen" \
  -DLLVM_NATIVE_TOOL_DIR="$SRC/build-native/bin" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
  -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_INCLUDE_TOOLS=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_UTILS=OFF > "$ROOT/cmake-wasi.log" 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "cross configure failed ($EXIT)" >&2; tail -40 "$ROOT/cmake-wasi.log" >&2; exit 33; }
echo "OK    configured"

echo "=== 4/4  build the components ============================================="
# shellcheck disable=SC2086
ninja -C "$SRC/build-wasi" -j "$JOBS" $COMPONENTS > "$ROOT/ninja-wasi.log" 2>&1
EXIT=$?
if [ "$EXIT" -ne 0 ]; then
  echo "cross build failed ($EXIT) -- last 40 lines of $ROOT/ninja-wasi.log:" >&2
  tail -40 "$ROOT/ninja-wasi.log" >&2
  exit 34
fi

cp "$SRC"/build-wasi/lib/*.a "$ROOT/lib/" 2>/dev/null
{
  echo "llvm:    $LLVM_TAG"
  echo "sysroot: $WASI_SDK"
  echo "clang:   $("$WASI_SDK/bin/clang" --version | head -1)"
  echo "archives:"
  ls -la "$ROOT/lib"/*.a 2>/dev/null
} > "$ROOT/DONE"
cat "$ROOT/DONE"
echo "=== archives are in $ROOT/lib ==="
