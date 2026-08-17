#!/bin/bash
# Cross-build the six LLVM components `elflift` links, for wasm32-wasi.
#
# This is the unpaid cost AOTW-06 has been blocked on. Everything else is done: all 27 of
# elfconv's translation units compile for wasm32-wasi (see `elflift-wasi-port.sh`), and the
# only thing missing is something to link them against.
#
# ## Why 16.0.6 and not the newer sources already on this host
#
# `/Users/alexanderfedin/Projects/hapyy/llvm-wasm` is release/17.x and `libclang-wasm/
# llvm-project` is main. The elfconv image builds against **LLVM 16.0.6** (`cmake.log`:
# `-- Found LLVM 16.0.6`), and the objects `elflift-wasi-port.sh` produces were compiled
# against 16's headers. Linking those against 17 archives is an ODR violation that either
# fails at link time or, worse, does not. So this fetches 16.0.6.
#
# ## Why two stages
#
# LLVM's build runs `llvm-tblgen` to generate sources. A cross-build cannot run a wasm
# tblgen, so stage 1 builds tblgen for the HOST and stage 2 points at it. Getting this wrong
# is the classic LLVM cross-compile failure: cmake configures, then dies partway through
# saying it cannot execute a binary.
#
# ## Why the sysroot is patched first
#
# LLVM's Support library uses `std::mutex` and `std::thread::id`, and libc++ configured
# without threads refuses to provide either — the same wall `elflift-wasi-port.sh` documents
# and removes. The same patches are applied here, to the same threadless sysroot, so LLVM
# and elfconv are built against one consistent libc++.
#
# ## Cost
#
# Measured on this host: 8 cores in the container. Expect 60-120 minutes wall clock and a few
# GB of Docker disk. Resumable — re-running skips the clone and skips stage 1 if they exist.
#
# Usage, from the repository root:
#
#   mkdir -p /tmp/wasi-llvm && docker run --rm -i \
#     -v /tmp/wasi-llvm:/out \
#     --entrypoint /bin/bash \
#     ghcr.io/yomaytk/elfconv:arm64 -c 'bash /dev/stdin' \
#     < tools/aot/build-wasi-llvm.sh 2>&1 | tee /tmp/wasi-llvm/build.log
#
# `-i` is load-bearing: without it the container's stdin is /dev/null, bash reads an empty
# script and exits 0 having done nothing.
#
# On success `/tmp/wasi-llvm/lib/` holds the archives and `/tmp/wasi-llvm/DONE` names them.

set -eu

OUT=${OUT:-/out}
SRC=${SRC:-/root/llvm-16}
WASI_SDK=${WASI_SDK:-/root/wasi-sdk-24.0-arm64-linux}
JOBS=${JOBS:-$(nproc)}
LLVM_TAG=${LLVM_TAG:-llvmorg-16.0.6}

# The six remill names in `backend/remill/CMakeLists.txt:53-57`. Its comment records why the
# list is this short: the lifter never asks LLVM to emit code for the source ISA, so no
# codegen, target, asmparser or asmprinter library is needed.
COMPONENTS="LLVMSupport LLVMCore LLVMIRReader LLVMBitReader LLVMBitWriter LLVMPasses"

mkdir -p "$OUT" "$OUT/lib"

echo "=== 0/4  patch the threadless libc++ sysroot ==============================="
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

# lock_guard / unique_lock / the tag types reference no __libcpp_* symbol at all. Gated anyway.
for name in ('tag_types', 'lock_guard', 'unique_lock'):
    edit(f'{S}/__mutex/{name}.h',
         '#ifndef _LIBCPP_HAS_NO_THREADS',
         '#if 1  // o2: nothing below this line needs threading support',
         f'__mutex/{name}.h: un-gated')

# std::mutex does wrap __libcpp_mutex_t. With no second thread to exclude, a no-op is the
# correct implementation rather than a stub.
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

# recursive_mutex lives in <mutex> itself, INSIDE the namespace -- no _LIBCPP_BEGIN_NAMESPACE_STD
# here. Opening it twice declares std::std and every later header fails on names it cannot find.
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
// thread to arbitrate is a no-op. libc++ refuses the header outright instead.
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
  CLONE_EXIT=$?
  [ "$CLONE_EXIT" -eq 0 ] || { echo "clone failed ($CLONE_EXIT)" >&2; exit 30; }
else
  echo "SKIP  $SRC already present"
fi

echo "=== 2/4  stage 1: tblgen for the HOST ====================================="
if [ ! -x "$SRC/build-native/bin/llvm-tblgen" ]; then
  cmake -S "$SRC/llvm" -B "$SRC/build-native" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLVM_INCLUDE_TESTS=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_EXAMPLES=OFF > "$OUT/cmake-native.log" 2>&1
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "native configure failed ($EXIT)" >&2; tail -30 "$OUT/cmake-native.log" >&2; exit 31; }
  ninja -C "$SRC/build-native" -j "$JOBS" llvm-tblgen llvm-min-tblgen > "$OUT/ninja-native.log" 2>&1
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "tblgen build failed ($EXIT)" >&2; tail -30 "$OUT/ninja-native.log" >&2; exit 32; }
else
  echo "SKIP  tblgen already built"
fi
"$SRC/build-native/bin/llvm-tblgen" --version | head -2

echo "=== 3/4  stage 2: cross-configure for wasm32-wasi ========================="
cmake -S "$SRC/llvm" -B "$SRC/build-wasi" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$WASI_SDK/share/cmake/wasi-sdk.cmake" \
  -DCMAKE_BUILD_TYPE=Release \
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
  -DLLVM_INCLUDE_UTILS=OFF > "$OUT/cmake-wasi.log" 2>&1
EXIT=$?
[ "$EXIT" -eq 0 ] || { echo "cross configure failed ($EXIT)" >&2; tail -40 "$OUT/cmake-wasi.log" >&2; exit 33; }
echo "OK    configured"

echo "=== 4/4  build the six components ========================================="
# shellcheck disable=SC2086
ninja -C "$SRC/build-wasi" -j "$JOBS" $COMPONENTS > "$OUT/ninja-wasi.log" 2>&1
EXIT=$?
if [ "$EXIT" -ne 0 ]; then
  echo "cross build failed ($EXIT) -- last 40 lines:" >&2
  tail -40 "$OUT/ninja-wasi.log" >&2
  exit 34
fi

cp "$SRC"/build-wasi/lib/*.a "$OUT/lib/" 2>/dev/null || true
{
  echo "llvm: $LLVM_TAG"
  echo "sysroot: $WASI_SDK"
  echo "archives:"
  ls -la "$OUT/lib"/*.a 2>/dev/null
} > "$OUT/DONE"
cat "$OUT/DONE"
echo "=== the archives are in $OUT/lib ==="
