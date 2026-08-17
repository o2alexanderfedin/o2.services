#!/bin/bash
# THE PORT. Apply the smallest set of source changes that lets `elflift`'s translation units
# compile for wasm32-wasi, then run the unmodified gate over the result.
#
# ## Why this file exists at all
#
# On 2026-08-14 a session recorded that glog was not the wall — that a two-line `__wasi__`
# branch plus a handful of lines fixing elfconv's own bugs got **27/27 translation units
# compiling at 14.3 MB of objects**. That result was checked before being written into
# `REQUIREMENTS.md` and it did not survive the check: a repo-wide search found the figure in
# exactly two prose sentences, both landed by one `chore: pause handoff` commit. No patch, no
# build log, no fixture, and `git -C third_party/elfconv status` reported the submodule
# pristine. The measurement had been taken in a working tree nobody kept.
#
# **This file is that measurement, in a form that can be re-run.** It is the difference
# between a session observation and evidence, and that difference is the whole reason the
# requirements ledger exists.
#
# ## What it changes, and why each one is a defect rather than a workaround
#
#   A. `glog/platform.h` — glog branches on Windows, Cygwin, Linux, Android, macOS, three
#      BSDs and Emscripten, and `#error`s on anything else. WASI is simply absent. Two lines.
#   B. libc++'s `<thread>`, `<mutex>` and `<shared_mutex>` — the real wall, and it is libc++
#      rather than glog. Configured without threads, libc++ refuses whole headers well past
#      what actually needs threading. Measured: `lock_guard`, `unique_lock` and the lock tag
#      types name no `__libcpp_*` symbol at all and are gated anyway; `std::thread::id` is an
#      opaque handle; a reader/writer lock with no second thread is a no-op. `std::mutex` is
#      the one that genuinely wraps `__libcpp_mutex_t`, and there a no-op is not a stub but
#      the correct implementation — there is no second thread to exclude.
#      **`std::thread` itself is declared with no constructors**, so anything that tries to
#      start a thread stays a hard compile error rather than silently linking.
#      Guarding glog's own `#include <thread>` was tried FIRST and is wrong: it moves the
#      failure from `logging.h:51` to `logging.h:123`, where glog's interface names the type
#      three times. 6/27 became 13/27 and stopped there.
#   C. `lifter/Lift.cpp` — `debug_stream_out_sigaction(int, siginfo_t *, void *)` is declared
#      OUTSIDE the `#if defined(__linux__)` block that is its only user, so a platform with
#      no `siginfo_t` fails on a function it would never call.
#   D. `lifter/Binary/Loader.h` — guest addresses are typed `uintptr_t`, i.e. as **host**
#      pointers. That is correct on every 64-bit host and wrong the moment the host is
#      wasm32, where `uintptr_t` is 32 bits and a 64-bit AArch64 guest address narrows.
#      Five fields, widened to `uint64_t`. This is the one that is a real portability bug in
#      elfconv rather than a missing platform branch.
#
# A is applied to the image's installed glog headers and B to the wasi-sdk sysroot — the
# THREADLESS one only (`wasm32-wasi/c++/v1`), a separate directory from
# `wasm32-wasi-threads/c++/v1`, so the threaded arm still exercises the real libc++. C and D are applied to a
# writable copy of this repository's fork, because `elflift-wasi-gate.sh:79-82` copies
# `$REPO/third_party/elfconv` over `/root/elfconv` before configuring — patching the
# container's copy in place is silently undone by that, which cost one full run to find.
#
# ## What it deliberately does not do
#
# It does not link, and there is no `elflift.wasm` at the end of it. Linking needs LLVM,
# gflags, glog and XED cross-compiled to wasm32-wasi, and `26-CONTEXT.md` precondition 3
# still stands: the only cross-compiled LLVM on this host is Emscripten-targeted. Compiling
# every translation unit is a necessary condition for the port and is not the port.
#
# It also does not touch this repository's working tree. Everything is staged under /tmp
# inside a `--rm` container, which is what lets the caller mount /repo read-only.
#
# Usage — identical in shape to the gate it wraps, and it writes the same `/out/gate.json`:
#
#   docker run --rm -i -v "$REPO":/repo:ro -v "$OUTDIR":/out \
#     --entrypoint /bin/bash "$IMAGE" -c 'bash /dev/stdin' \
#     < tools/aot/elflift-wasi-port.sh
#
# `-i` is load-bearing and its absence is silent — see the gate's own docblock.
#
# Exit codes: whatever the gate exits with, plus 9 when an anchor this patch depends on is
# no longer in the source. **9 is a real finding, not a harness fault**: it means elfconv or
# glog moved under a change that was written against a specific shape, and the numbers below
# cannot be reproduced until somebody looks.

set -eu

STAGE=${STAGE:-/tmp/o2-wasi-port}
REPO_IN=${REPO_IN:-/repo}
GLOG=${GLOG:-/root/elfconv/dependencies/install/include/glog}

rm -rf "$STAGE"
mkdir -p "$STAGE/third_party"
cp -a "$REPO_IN/third_party/elfconv" "$STAGE/third_party/"

SYSROOT=${SYSROOT:-/root/wasi-sdk-24.0-arm64-linux/share/wasi-sysroot/include/wasm32-wasi/c++/v1}

cat > "$SYSROOT/thread" <<'HDR'
// <thread>, for a libc++ configured without threads — the subset that needs no threading.
//
// libc++ refuses this header outright when _LIBCPP_HAS_NO_THREADS is set, and that refusal is
// wider than it needs to be: `std::thread::id` is an opaque handle type with no threading
// support behind it. glog's public interface names it three times (logging.h:121, :132, :1371)
// and never constructs a thread, so the refusal blocks 21 of 27 translation units over a type.
//
// `std::thread` itself is declared with NO constructors, so any attempt to actually start a
// thread on this target stays a hard compile error rather than silently linking.
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

  // No constructors, deliberately: starting a thread must stay a hard error here.
};

template <>
struct hash<thread::id> {
  size_t operator()(thread::id __x) const noexcept { return static_cast<size_t>(__x.__value()); }
};

namespace this_thread {
inline thread::id get_id() noexcept { return thread::id(1); }
}  // namespace this_thread

_LIBCPP_END_NAMESPACE_STD

#endif  // _LIBCPP_THREAD
HDR
echo "OK    <thread> shim installed into the threadless sysroot"

python3 - <<'THREADLESS'
import sys
S = '/root/wasi-sdk-24.0-arm64-linux/share/wasi-sysroot/include/wasm32-wasi/c++/v1'

def edit(path, old, new, why):
    s = open(path).read()
    if new in s: print(f'SKIP  {why}'); return
    if old not in s: print(f'MISS  {why} in {path}'); sys.exit(9)
    open(path, 'w').write(s.replace(old, new, 1)); print(f'OK    {why}')

# 1. lock_guard / unique_lock / the lock tag types hold NO threading state -- measured:
#    none of the three names a __libcpp_* symbol. libc++ gates them anyway. Un-gate.
for name in ('tag_types', 'lock_guard', 'unique_lock'):
    edit(f'{S}/__mutex/{name}.h',
         '#ifndef _LIBCPP_HAS_NO_THREADS',
         '#if 1  // o2: nothing below this line needs threading support',
         f'__mutex/{name}.h: un-gated')

# 2. std::mutex DOES need one -- it wraps __libcpp_mutex_t. On a single-threaded target a
#    no-op is not a stub, it is the correct implementation: there is no second thread to
#    exclude. Kept beside the real one rather than replacing it.
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
     '__mutex/mutex.h: a no-op std::mutex for the single-threaded target')

# 3. recursive_mutex lives in <mutex> itself, inside the same guard. LLVM's Mutex.h wants it.
edit(f'{S}/mutex',
     '#endif   // !_LIBCPP_HAS_NO_THREADS',
     '''#endif   // !_LIBCPP_HAS_NO_THREADS

// NO _LIBCPP_BEGIN_NAMESPACE_STD here: this point is line 510 of <mutex>, and the header
// opens the namespace at :217 and closes it at :512 -- so we are already inside `std`.
// Opening it again declares `std::std` and every later header fails on names it cannot
// find. Measured, from getting it wrong: 13/27 became 4/27 with
// "no member named 'swap' in namespace 'std::std'" out of <streambuf>.
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

# 4. <shared_mutex> hard-errors outright. LLVM's RWMutex reaches for it.
open(f'{S}/shared_mutex', 'w').write('''// <shared_mutex> for a libc++ configured without threads.
// A reader/writer lock with no second thread to arbitrate is a no-op, which is the correct
// implementation here rather than a stub. libc++ refuses the header outright instead.
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
''')
print('OK    <shared_mutex> shim installed')

THREADLESS

python3 - "$GLOG" "$STAGE/third_party/elfconv/lifter" <<'PY'
import sys

glog, lifter = sys.argv[1], sys.argv[2]

def patch(path, old, new, why):
    text = open(path).read()
    if new in text:
        print(f'SKIP  {why} — already present')
        return
    if old not in text:
        print(f'MISS  {why} — anchor not found in {path}')
        sys.exit(9)
    open(path, 'w').write(text.replace(old, new, 1))
    print(f'OK    {why}')

# A — the branch glog has for Emscripten and not for WASI.
patch(
    f'{glog}/platform.h',
    '#elif defined(__EMSCRIPTEN__)\n#  define GLOG_OS_EMSCRIPTEN\n',
    '#elif defined(__EMSCRIPTEN__)\n#  define GLOG_OS_EMSCRIPTEN\n'
    '#elif defined(__wasi__)\n#  define GLOG_OS_WASI\n',
    'glog/platform.h: a __wasi__ branch',
)

# C — a siginfo_t handler declared outside the guard that is its only user.
patch(
    f'{lifter}/Lift.cpp',
    'extern "C" void debug_stream_out_sigaction(int sig, siginfo_t *info, void *ctx) {',
    '#if defined(__linux__)\n'
    'extern "C" void debug_stream_out_sigaction(int sig, siginfo_t *info, void *ctx) {',
    'Lift.cpp: open a __linux__ guard around the siginfo_t handler',
)
patch(
    f'{lifter}/Lift.cpp',
    '  exit(EXIT_FAILURE);\n}\n\nvoid lift_set_sigaction() {',
    '  exit(EXIT_FAILURE);\n}\n#endif\n\nvoid lift_set_sigaction() {',
    'Lift.cpp: close it before the function that already has one',
)

# D — guest addresses typed as host pointers.
path = f'{lifter}/Binary/Loader.h'
text = open(path).read()
count = text.count('uintptr_t')
if count == 0:
    print('MISS  Loader.h: no uintptr_t guest-address fields to widen')
    sys.exit(9)
open(path, 'w').write(text.replace('uintptr_t', 'uint64_t'))
print(f'OK    Loader.h: {count} guest-address fields widened uintptr_t -> uint64_t')
PY

# The gate, unmodified, reading the staged source. `exec` so its exit code is this
# script's — no pipe, nothing after it, which is this repository's rule about exit codes
# applied to the one place it would be easiest to get wrong.
REPO="$STAGE" exec bash "$REPO_IN/tools/aot/elflift-wasi-gate.sh"
