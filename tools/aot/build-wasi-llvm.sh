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
#include <chrono>
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
namespace this_thread {
inline thread::id get_id() noexcept { return thread::id(1); }
// Sleeping is how one thread yields progress to another. With no second thread there is
// nobody to yield to, so returning at once is not a shortcut -- it is the whole of what
// sleeping could accomplish here. LockFileManager polls this way for the process that holds
// a lock file; on this target no such process can exist, and the loop's other exit is taken.
inline void yield() noexcept {}
template <class _Rep, class _Period>
inline void sleep_for(const chrono::duration<_Rep, _Period>&) {}
template <class _Clock, class _Duration>
inline void sleep_until(const chrono::time_point<_Clock, _Duration>&) {}
}  // namespace this_thread
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

cat > "$SYSROOT/condition_variable" <<'HDR'
// <condition_variable> for a libc++ configured without threads.
//
// LLVM does not include this header conditionally. `Support/Parallel.h` and
// `Support/ThreadPool.h` both include it unguarded and declare condition_variable DATA
// MEMBERS outside their `#if LLVM_ENABLE_THREADS` blocks, so the type has to exist and be
// default-constructible even in a build where nothing can ever wait on it.
//
// Every operation here is a no-op, and that is not a weakening. A condition variable
// transfers control between threads: notify says "I changed the thing you are waiting for",
// wait says "hold until someone does". With exactly one thread, notify has nobody to wake --
// a no-op is exact -- and a wait whose predicate is false is a deadlock by construction, so
// no implementation could do better than return. The predicate forms therefore evaluate the
// predicate and return its answer, which is the truthful report of whether the condition
// holds; the plain wait() returns immediately.
#ifndef _LIBCPP_CONDITION_VARIABLE
#define _LIBCPP_CONDITION_VARIABLE
#include <__config>
#include <chrono>
#include <mutex>
#ifndef _LIBCPP_HAS_NO_THREADS
#  error "this <condition_variable> shim belongs only to the threadless wasm32-wasi sysroot"
#endif
_LIBCPP_BEGIN_NAMESPACE_STD

enum class cv_status { no_timeout, timeout };

class condition_variable {
public:
  _LIBCPP_HIDE_FROM_ABI condition_variable() noexcept = default;
  condition_variable(const condition_variable&) = delete;
  condition_variable& operator=(const condition_variable&) = delete;

  _LIBCPP_HIDE_FROM_ABI void notify_one() noexcept {}
  _LIBCPP_HIDE_FROM_ABI void notify_all() noexcept {}

  _LIBCPP_HIDE_FROM_ABI void wait(unique_lock<mutex>&) {}
  template <class _Predicate>
  _LIBCPP_HIDE_FROM_ABI void wait(unique_lock<mutex>&, _Predicate __pred) {
    (void)__pred();
  }
  template <class _Rep, class _Period>
  _LIBCPP_HIDE_FROM_ABI cv_status wait_for(unique_lock<mutex>&,
                                           const chrono::duration<_Rep, _Period>&) {
    return cv_status::timeout;
  }
  template <class _Rep, class _Period, class _Predicate>
  _LIBCPP_HIDE_FROM_ABI bool wait_for(unique_lock<mutex>&,
                                      const chrono::duration<_Rep, _Period>&,
                                      _Predicate __pred) {
    return __pred();
  }
  template <class _Clock, class _Duration>
  _LIBCPP_HIDE_FROM_ABI cv_status wait_until(unique_lock<mutex>&,
                                             const chrono::time_point<_Clock, _Duration>&) {
    return cv_status::timeout;
  }
  template <class _Clock, class _Duration, class _Predicate>
  _LIBCPP_HIDE_FROM_ABI bool wait_until(unique_lock<mutex>&,
                                        const chrono::time_point<_Clock, _Duration>&,
                                        _Predicate __pred) {
    return __pred();
  }
};

class condition_variable_any {
public:
  _LIBCPP_HIDE_FROM_ABI condition_variable_any() noexcept = default;
  condition_variable_any(const condition_variable_any&) = delete;
  condition_variable_any& operator=(const condition_variable_any&) = delete;

  _LIBCPP_HIDE_FROM_ABI void notify_one() noexcept {}
  _LIBCPP_HIDE_FROM_ABI void notify_all() noexcept {}

  template <class _Lock>
  _LIBCPP_HIDE_FROM_ABI void wait(_Lock&) {}
  template <class _Lock, class _Predicate>
  _LIBCPP_HIDE_FROM_ABI void wait(_Lock&, _Predicate __pred) { (void)__pred(); }
  template <class _Lock, class _Rep, class _Period>
  _LIBCPP_HIDE_FROM_ABI cv_status wait_for(_Lock&, const chrono::duration<_Rep, _Period>&) {
    return cv_status::timeout;
  }
  template <class _Lock, class _Rep, class _Period, class _Predicate>
  _LIBCPP_HIDE_FROM_ABI bool wait_for(_Lock&, const chrono::duration<_Rep, _Period>&,
                                      _Predicate __pred) {
    return __pred();
  }
};

_LIBCPP_END_NAMESPACE_STD
#endif  // _LIBCPP_CONDITION_VARIABLE
HDR
echo "OK    <condition_variable> shim installed"

cat > "$SYSROOT/future" <<'HDR'
// <future> for a libc++ configured without threads -- DEFERRED execution only.
//
// libc++ refuses this header outright with `#error "<future> is not supported since libc++
// has been configured without support for threads."`, and clang keeps parsing past an
// `#error`, so the real header then produces a second wave of failures deeper in
// (`__thread_local_data`, `std::thread::detach`) that look like separate problems and are
// not. Measured in round two of the cross-build: six files, three distinct error texts, one
// cause.
//
// **Deferred futures need no threads at all.** `std::async(std::launch::deferred, f)` is
// DEFINED by the standard to run `f` on the thread that calls `get()` or `wait()`, so what
// is implemented here is the standard's own semantics rather than a reduced stand-in --
// which matters, because `ThreadPool::asyncImpl` takes exactly that path when
// LLVM_ENABLE_THREADS is off:
//
//     auto Future = std::async(std::launch::deferred, std::move(Task)).share();
//
// `std::launch::async` is the one thing that cannot be honoured. Asking for it returns a
// future that still runs deferred, which is the behaviour the standard already permits when
// a system cannot start a thread.
//
// The value is held through shared_ptr rather than stored by value so that a result type
// with no default constructor still works.
#ifndef _LIBCPP_FUTURE
#define _LIBCPP_FUTURE
#include <__config>
#include <chrono>
#include <exception>
#include <functional>
#include <memory>
#include <type_traits>
#include <utility>
#ifndef _LIBCPP_HAS_NO_THREADS
#  error "this <future> shim belongs only to the threadless wasm32-wasi sysroot"
#endif
_LIBCPP_BEGIN_NAMESPACE_STD

enum class future_status { ready, timeout, deferred };

enum class launch { async = 1, deferred = 2, any = 3 };

_LIBCPP_HIDE_FROM_ABI inline constexpr launch operator|(launch __x, launch __y) {
  return static_cast<launch>(static_cast<int>(__x) | static_cast<int>(__y));
}
_LIBCPP_HIDE_FROM_ABI inline constexpr launch operator&(launch __x, launch __y) {
  return static_cast<launch>(static_cast<int>(__x) & static_cast<int>(__y));
}

// ---- shared state ------------------------------------------------------------------

template <class _Rp>
struct __o2_state {
  shared_ptr<_Rp> __value_;
  function<_Rp()> __fn_;

  _LIBCPP_HIDE_FROM_ABI void __force() {
    if (!__value_ && __fn_) {
      __value_ = make_shared<_Rp>(__fn_());
      __fn_ = nullptr;
    }
  }
  _LIBCPP_HIDE_FROM_ABI bool __ready() const { return static_cast<bool>(__value_); }
  _LIBCPP_HIDE_FROM_ABI _Rp& __get() {
    __force();
    // Reaching this with no value means get() on a state nobody set -- a programming error
    // the standard reports by throwing, which this build cannot do (-fno-exceptions).
    if (!__value_) __builtin_trap();
    return *__value_;
  }
};

template <>
struct __o2_state<void> {
  bool __done_ = false;
  function<void()> __fn_;

  _LIBCPP_HIDE_FROM_ABI void __force() {
    if (!__done_) {
      if (__fn_) { __fn_(); __fn_ = nullptr; }
      __done_ = true;
    }
  }
  _LIBCPP_HIDE_FROM_ABI bool __ready() const { return __done_; }
  _LIBCPP_HIDE_FROM_ABI void __get() { __force(); }
};

template <class _Rp> class shared_future;

// ---- future ------------------------------------------------------------------------

template <class _Rp>
class future {
public:
  _LIBCPP_HIDE_FROM_ABI future() noexcept = default;
  _LIBCPP_HIDE_FROM_ABI explicit future(shared_ptr<__o2_state<_Rp> > __s) noexcept
      : __state_(_VSTD::move(__s)) {}
  future(const future&) = delete;
  future& operator=(const future&) = delete;
  _LIBCPP_HIDE_FROM_ABI future(future&&) noexcept = default;
  _LIBCPP_HIDE_FROM_ABI future& operator=(future&&) noexcept = default;

  _LIBCPP_HIDE_FROM_ABI _Rp get() {
    shared_ptr<__o2_state<_Rp> > __s = _VSTD::move(__state_);
    __state_.reset();
    return _VSTD::move(__s->__get());
  }
  _LIBCPP_HIDE_FROM_ABI shared_future<_Rp> share() noexcept;
  _LIBCPP_HIDE_FROM_ABI bool valid() const noexcept { return static_cast<bool>(__state_); }
  _LIBCPP_HIDE_FROM_ABI void wait() const {
    if (__state_) __state_->__force();
  }
  template <class _Rep, class _Period>
  _LIBCPP_HIDE_FROM_ABI future_status wait_for(const chrono::duration<_Rep, _Period>&) const {
    return future_status::deferred;
  }
  template <class _Clock, class _Duration>
  _LIBCPP_HIDE_FROM_ABI future_status
  wait_until(const chrono::time_point<_Clock, _Duration>&) const {
    return future_status::deferred;
  }

private:
  shared_ptr<__o2_state<_Rp> > __state_;
};

template <>
class future<void> {
public:
  _LIBCPP_HIDE_FROM_ABI future() noexcept = default;
  _LIBCPP_HIDE_FROM_ABI explicit future(shared_ptr<__o2_state<void> > __s) noexcept
      : __state_(_VSTD::move(__s)) {}
  future(const future&) = delete;
  future& operator=(const future&) = delete;
  _LIBCPP_HIDE_FROM_ABI future(future&&) noexcept = default;
  _LIBCPP_HIDE_FROM_ABI future& operator=(future&&) noexcept = default;

  _LIBCPP_HIDE_FROM_ABI void get() {
    shared_ptr<__o2_state<void> > __s = _VSTD::move(__state_);
    __state_.reset();
    if (__s) __s->__get();
  }
  _LIBCPP_HIDE_FROM_ABI shared_future<void> share() noexcept;
  _LIBCPP_HIDE_FROM_ABI bool valid() const noexcept { return static_cast<bool>(__state_); }
  _LIBCPP_HIDE_FROM_ABI void wait() const {
    if (__state_) __state_->__force();
  }
  template <class _Rep, class _Period>
  _LIBCPP_HIDE_FROM_ABI future_status wait_for(const chrono::duration<_Rep, _Period>&) const {
    return future_status::deferred;
  }
  template <class _Clock, class _Duration>
  _LIBCPP_HIDE_FROM_ABI future_status
  wait_until(const chrono::time_point<_Clock, _Duration>&) const {
    return future_status::deferred;
  }

private:
  shared_ptr<__o2_state<void> > __state_;
};

// ---- shared_future -----------------------------------------------------------------

template <class _Rp>
class shared_future {
public:
  _LIBCPP_HIDE_FROM_ABI shared_future() noexcept = default;
  _LIBCPP_HIDE_FROM_ABI explicit shared_future(shared_ptr<__o2_state<_Rp> > __s) noexcept
      : __state_(_VSTD::move(__s)) {}
  _LIBCPP_HIDE_FROM_ABI shared_future(const shared_future&) = default;
  _LIBCPP_HIDE_FROM_ABI shared_future& operator=(const shared_future&) = default;
  _LIBCPP_HIDE_FROM_ABI shared_future(shared_future&&) noexcept = default;
  _LIBCPP_HIDE_FROM_ABI shared_future& operator=(shared_future&&) noexcept = default;

  _LIBCPP_HIDE_FROM_ABI const _Rp& get() const { return __state_->__get(); }
  _LIBCPP_HIDE_FROM_ABI bool valid() const noexcept { return static_cast<bool>(__state_); }
  _LIBCPP_HIDE_FROM_ABI void wait() const {
    if (__state_) __state_->__force();
  }
  template <class _Rep, class _Period>
  _LIBCPP_HIDE_FROM_ABI future_status wait_for(const chrono::duration<_Rep, _Period>&) const {
    return future_status::deferred;
  }
  template <class _Clock, class _Duration>
  _LIBCPP_HIDE_FROM_ABI future_status
  wait_until(const chrono::time_point<_Clock, _Duration>&) const {
    return future_status::deferred;
  }

private:
  mutable shared_ptr<__o2_state<_Rp> > __state_;
};

template <>
class shared_future<void> {
public:
  _LIBCPP_HIDE_FROM_ABI shared_future() noexcept = default;
  _LIBCPP_HIDE_FROM_ABI explicit shared_future(shared_ptr<__o2_state<void> > __s) noexcept
      : __state_(_VSTD::move(__s)) {}
  _LIBCPP_HIDE_FROM_ABI shared_future(const shared_future&) = default;
  _LIBCPP_HIDE_FROM_ABI shared_future& operator=(const shared_future&) = default;
  _LIBCPP_HIDE_FROM_ABI shared_future(shared_future&&) noexcept = default;
  _LIBCPP_HIDE_FROM_ABI shared_future& operator=(shared_future&&) noexcept = default;

  _LIBCPP_HIDE_FROM_ABI void get() const {
    if (__state_) __state_->__get();
  }
  _LIBCPP_HIDE_FROM_ABI bool valid() const noexcept { return static_cast<bool>(__state_); }
  _LIBCPP_HIDE_FROM_ABI void wait() const {
    if (__state_) __state_->__force();
  }
  template <class _Rep, class _Period>
  _LIBCPP_HIDE_FROM_ABI future_status wait_for(const chrono::duration<_Rep, _Period>&) const {
    return future_status::deferred;
  }
  template <class _Clock, class _Duration>
  _LIBCPP_HIDE_FROM_ABI future_status
  wait_until(const chrono::time_point<_Clock, _Duration>&) const {
    return future_status::deferred;
  }

private:
  mutable shared_ptr<__o2_state<void> > __state_;
};

template <class _Rp>
inline shared_future<_Rp> future<_Rp>::share() noexcept {
  return shared_future<_Rp>(_VSTD::move(__state_));
}
inline shared_future<void> future<void>::share() noexcept {
  return shared_future<void>(_VSTD::move(__state_));
}

// ---- promise -----------------------------------------------------------------------

template <class _Rp>
class promise {
public:
  _LIBCPP_HIDE_FROM_ABI promise() : __state_(make_shared<__o2_state<_Rp> >()) {}
  promise(const promise&) = delete;
  promise& operator=(const promise&) = delete;
  _LIBCPP_HIDE_FROM_ABI promise(promise&&) noexcept = default;
  _LIBCPP_HIDE_FROM_ABI promise& operator=(promise&&) noexcept = default;

  _LIBCPP_HIDE_FROM_ABI future<_Rp> get_future() { return future<_Rp>(__state_); }
  _LIBCPP_HIDE_FROM_ABI void set_value(const _Rp& __v) {
    __state_->__value_ = make_shared<_Rp>(__v);
  }
  _LIBCPP_HIDE_FROM_ABI void set_value(_Rp&& __v) {
    __state_->__value_ = make_shared<_Rp>(_VSTD::move(__v));
  }

private:
  shared_ptr<__o2_state<_Rp> > __state_;
};

template <>
class promise<void> {
public:
  _LIBCPP_HIDE_FROM_ABI promise() : __state_(make_shared<__o2_state<void> >()) {}
  promise(const promise&) = delete;
  promise& operator=(const promise&) = delete;
  _LIBCPP_HIDE_FROM_ABI promise(promise&&) noexcept = default;
  _LIBCPP_HIDE_FROM_ABI promise& operator=(promise&&) noexcept = default;

  _LIBCPP_HIDE_FROM_ABI future<void> get_future() { return future<void>(__state_); }
  _LIBCPP_HIDE_FROM_ABI void set_value() { __state_->__done_ = true; }

private:
  shared_ptr<__o2_state<void> > __state_;
};

// ---- async -------------------------------------------------------------------------

template <class _Fp, class... _Args>
_LIBCPP_HIDE_FROM_ABI future<typename __invoke_of<typename decay<_Fp>::type,
                                                  typename decay<_Args>::type...>::type>
async(launch, _Fp&& __f, _Args&&... __args) {
  using _Rp = typename __invoke_of<typename decay<_Fp>::type,
                                   typename decay<_Args>::type...>::type;
  shared_ptr<__o2_state<_Rp> > __s = make_shared<__o2_state<_Rp> >();
  __s->__fn_ = function<_Rp()>(
      _VSTD::bind(_VSTD::forward<_Fp>(__f), _VSTD::forward<_Args>(__args)...));
  return future<_Rp>(__s);
}

template <class _Fp, class... _Args>
_LIBCPP_HIDE_FROM_ABI future<typename __invoke_of<typename decay<_Fp>::type,
                                                  typename decay<_Args>::type...>::type>
async(_Fp&& __f, _Args&&... __args) {
  return _VSTD::async(launch::any, _VSTD::forward<_Fp>(__f),
                      _VSTD::forward<_Args>(__args)...);
}

_LIBCPP_END_NAMESPACE_STD
#endif  // _LIBCPP_FUTURE
HDR
echo "OK    <future> shim installed"

echo "=== 1/4  fetch llvm-project $LLVM_TAG ====================================="
if [ ! -d "$SRC/llvm" ]; then
  git clone --depth 1 --branch "$LLVM_TAG" https://github.com/llvm/llvm-project.git "$SRC"
  EXIT=$?
  [ "$EXIT" -eq 0 ] || { echo "clone failed ($EXIT)" >&2; exit 30; }
else
  echo "SKIP  $SRC already present"
fi

echo "=== 1b/4 teach LLVM 16 that WASI is a unix ================================"
# LLVM 16 predates WASI. cmake does not set UNIX for CMAKE_SYSTEM_NAME=WASI, so
# HandleLLVMOptions.cmake:150 reaches `MESSAGE(SEND_ERROR "Unable to determine platform")`
# and the cross-configure dies there — measured, on the first host run. LLVM 17 added the
# branch upstream; 16 needs it added here. This is the only LLVM source change.
python3 - "$SRC/llvm/cmake/modules/HandleLLVMOptions.cmake" > "$ROOT/wasi-patch.out" 2>&1 <<'WASIPATCH'
import sys
p = sys.argv[1]
s = open(p).read()
if 'MATCHES "WASI"' in s:
    print('SKIP  HandleLLVMOptions.cmake already knows WASI'); raise SystemExit
old = '  if(FUCHSIA OR UNIX)\n    set(LLVM_ON_WIN32 0)\n    set(LLVM_ON_UNIX 1)'
new = '  if(FUCHSIA OR UNIX OR CMAKE_SYSTEM_NAME MATCHES "WASI")\n    set(LLVM_ON_WIN32 0)\n    set(LLVM_ON_UNIX 1)'
if old not in s:
    print('MISS  the platform block is not the shape this patch expects, in ' + p)
    raise SystemExit(9)
s = s.replace(old, new, 1)
# The closing arguments must stop naming the old condition, or cmake compares them.
s = s.replace(
    '  else(FUCHSIA OR UNIX)\n    MESSAGE(SEND_ERROR "Unable to determine platform")\n  endif(FUCHSIA OR UNIX)',
    '  else()\n    MESSAGE(SEND_ERROR "Unable to determine platform")\n  endif()', 1)
open(p, 'w').write(s)
print('OK    HandleLLVMOptions.cmake: WASI counts as a unix')
WASIPATCH
EXIT=$?
cat "$ROOT/wasi-patch.out"
[ "$EXIT" -eq 0 ] || { echo "llvm wasi patch failed ($EXIT)" >&2; exit 35; }

# The second -- and, so far, last -- LLVM source change. `Unix/Program.inc` reads
# `Info.ru_maxrss` to report a child's peak memory. wasi-libc's `struct rusage` carries only
# `ru_utime` and `ru_stime` (see `__struct_rusage.h`; the full Linux-shaped one in
# `sys/resource.h` sits behind the __wasilibc_unmodified_upstream fence), so the member does
# not exist.
#
# LLVM already guards that exact line with `#ifndef __HAIKU__`, for a platform with the same
# gap. This adds wasm32-wasi to the same guard rather than inventing a new mechanism -- and a
# `#define ru_maxrss ...` in the compat header was rejected precisely because it would rewrite
# that identifier in every translation unit to fix one line in one file.
#
# The read is unreachable here in any case: it runs only after `wait4` returns a child that
# `fork` could never have produced.
python3 - "$SRC/llvm/lib/Support/Unix/Program.inc" > "$ROOT/rusage-patch.out" 2>&1 <<'RUSAGEPATCH'
import sys
p = sys.argv[1]
s = open(p).read()
if '__wasi__' in s:
    print('SKIP  Program.inc already excludes wasi from ru_maxrss'); raise SystemExit
old = '#ifndef __HAIKU__\n    PeakMemory = static_cast<uint64_t>(Info.ru_maxrss);\n#endif'
new = '#if !defined(__HAIKU__) && !defined(__wasi__)\n    PeakMemory = static_cast<uint64_t>(Info.ru_maxrss);\n#endif'
if old not in s:
    print('MISS  the ru_maxrss block is not the shape this patch expects, in ' + p)
    raise SystemExit(9)
open(p, 'w').write(s.replace(old, new, 1))
print('OK    Program.inc: ru_maxrss excluded on wasm32-wasi')
RUSAGEPATCH
EXIT=$?
cat "$ROOT/rusage-patch.out"
[ "$EXIT" -eq 0 ] || { echo "ru_maxrss patch failed ($EXIT)" >&2; exit 37; }

# The third LLVM source change, and the last file standing after round three: `Unix/Path.inc`
# has two `#elif` chains that enumerate platforms and end in a hard stop. Both get a wasi arm
# in the same shape as the arms already there -- this adds no new mechanism, it extends an
# existing list, which is why it is preferred over a compat-header trick. `f_flags` is a
# struct member and no header of ours could supply it into someone else's struct anyway.
python3 - "$SRC/llvm/lib/Support/Unix/Path.inc" > "$ROOT/path-patch.out" 2>&1 <<'PATHPATCH'
import sys
p = sys.argv[1]
s = open(p).read()
if '__wasi__' in s:
    print('SKIP  Path.inc already has its wasi arms'); raise SystemExit

edits = [
    # GetMainExecutable: the chain ends in `#error ... not implemented on this host yet`.
    ('#else\n#error GetMainExecutable is not implemented on this host yet.\n#endif',
     '#elif defined(__wasi__)\n'
     '  // A wasm instance has no path to itself. WASI exposes no executable path, there is no\n'
     '  // /proc, dladdr does not exist, and argv[0] resolves to nothing on the preopened tree.\n'
     '  // Returning "" is already this function\'s documented "cannot determine" answer -- the\n'
     '  // same value every arm below falls through to.\n'
     '#else\n#error GetMainExecutable is not implemented on this host yet.\n#endif'),

    # is_local_impl: reads statvfs f_flags & MNT_LOCAL, neither of which wasi-libc has.
    ('#else\n  return !!(STATVFS_F_FLAG(Vfs) & MNT_LOCAL);\n#endif',
     '#elif defined(__wasi__)\n'
     '  // wasi-libc\'s statvfs carries no f_flags and defines no MNT_LOCAL: an instance sees\n'
     '  // only the directories its host preopened and cannot tell where they actually live.\n'
     '  // "Remote" is the conservative answer -- the same one the z/OS arm above gives, for\n'
     '  // the same reason.\n'
     '  (void)Vfs;\n'
     '  return false;\n'
     '#else\n  return !!(STATVFS_F_FLAG(Vfs) & MNT_LOCAL);\n#endif'),
]

for old, new in edits:
    if old not in s:
        print('MISS  a Path.inc block is not the shape this patch expects:\n' + old)
        raise SystemExit(9)
    s = s.replace(old, new, 1)

open(p, 'w').write(s)
print('OK    Path.inc: wasi arms added to GetMainExecutable and is_local_impl')
PATHPATCH
EXIT=$?
cat "$ROOT/path-patch.out"
[ "$EXIT" -eq 0 ] || { echo "Path.inc patch failed ($EXIT)" >&2; exit 38; }

# Drop the cross tree ONLY when the patch actually changed something. It used to be
# unconditional, which meant every re-run threw away every object already compiled — on a
# tree this size that is the whole cost of the build, paid again to fix one file. cmake
# re-runs its own configure when the flags change, so nothing here needs a clean slate.
if ! grep -q "^SKIP" "$ROOT/wasi-patch.out"; then
  echo "      patch applied — dropping the cross tree that cached the failed configure"
  rm -rf "$SRC/build-wasi"
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

# WASI has no signals and no setjmp, and wasi-libc turns both into a hard `#error` rather
# than a missing symbol. Files in LLVMSupport hit it: CrashRecoveryContext.cpp,
# Signals.cpp, Debug.cpp, InitLLVM.cpp and LockFileManager.cpp — the same "process and signal
# residue" the phase-26 gate named.
#
# `elflift` needs none of them: nothing in its 467 external symbols mentions CrashRecovery,
# RunSafely or a signal handler. But they are compiled as part of the library whether or not
# anything calls them, so the build has to get past them.
#
# wasi-libc ships emulation for four of the problems — signal, mman, getpid and process
# clocks are all in `lib/wasm32-wasi/libwasi-emulated-*.a`, verified present. setjmp has no
# emulation library; `-wasm-enable-sjlj` lowers it onto the WebAssembly exception handling
# proposal instead, which V8 implements. Verified accepted by this clang before being used
# here.
#
# **The emulation is not enough, and finding out cost a build round.** `_WASI_EMULATED_SIGNAL`
# gets past the `#error` and yields `raise` and `signal` — it does NOT yield the handler API.
# `struct sigaction`, `siginfo_t`, `sigprocmask`, `SIG_UNBLOCK`, and likewise `fork`, `execve`,
# `dup2`, `pipe` and `<sys/wait.h>`, are all removed from the sysroot behind
# `#ifdef __wasilibc_unmodified_upstream`, a macro wasi-libc never defines. That is supplied
# instead by tools/aot/wasi-compat, force-included below, so that no LLVM source file has to
# be edited — read its header comment for what it deliberately does NOT declare and why.
#
# Whatever links against these archives must also link `-lwasi-emulated-signal` and friends —
# link-elflift-wasm.sh does.
COMPAT=${COMPAT:-$(cd "$(dirname "$0")" && pwd)/wasi-compat}
[ -f "$COMPAT/wasi-posix-compat.h" ] || {
  echo "no compat header at $COMPAT/wasi-posix-compat.h" >&2; exit 36; }

WASI_EMULATION="-D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_PROCESS_CLOCKS -mllvm -wasm-enable-sjlj -I$COMPAT -include $COMPAT/wasi-posix-compat.h"

# The flags just changed, so cmake re-runs its feature detection. That matters more than it
# looks: `check_symbol_exists` compiles AND links, so anything the compat header declares
# could flip a HAVE_* on and pull in code that is currently compiled out. Snapshot config.h
# now and diff it after configuring — a silent flip is exactly the kind of thing that turns
# into a puzzling error three files later.
CONFIG_H="$SRC/build-wasi/include/llvm/Config/config.h"
CONFIG_BEFORE="$ROOT/config.h.before"
[ -f "$CONFIG_H" ] && cp "$CONFIG_H" "$CONFIG_BEFORE"

# LLVM_ENABLE_RTTI=ON below is not a preference. LLVM defaults to `-fno-rtti`, which emits no
# typeinfo, and elfconv's own objects are compiled WITH rtti and reference the typeinfo of
# LLVM classes they derive from. Measured at the link: `typeinfo for llvm::ErrorInfoBase` and
# `typeinfo for llvm::format_object_base` were 2 of exactly 5 unresolved symbols. remill
# subclasses LLVM types, so this is structural, not incidental.
#
# LLVM_ENABLE_EH stays OFF, and that is also measured rather than assumed: nothing in the
# linked program catches. See tools/aot/wasi-compat/wasi-eh-abort.c for the evidence and for
# what supplies the two throw-side symbols.
echo "=== 3/4  stage 2: cross-configure for wasm32-wasi ========================="
cmake -S "$SRC/llvm" -B "$SRC/build-wasi" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$WASI_SDK/share/cmake/wasi-sdk.cmake" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_CROSSCOMPILING=ON \
  -DCMAKE_C_FLAGS="$WASI_EMULATION" \
  -DCMAKE_CXX_FLAGS="$WASI_EMULATION" \
  -DLLVM_HOST_TRIPLE=wasm32-wasi \
  -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-wasi \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_TABLEGEN="$SRC/build-native/bin/llvm-tblgen" \
  -DLLVM_NATIVE_TOOL_DIR="$SRC/build-native/bin" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_RTTI=ON \
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

if [ -f "$CONFIG_BEFORE" ]; then
  if diff -q "$CONFIG_BEFORE" "$CONFIG_H" > /dev/null 2>&1; then
    echo "OK    config.h unchanged — the compat header flipped no HAVE_* on"
  else
    echo "NOTE  config.h CHANGED. Feature detection saw the compat header:"
    diff "$CONFIG_BEFORE" "$CONFIG_H" | grep -E "^[<>].*(HAVE_|define)" | head -20
    echo "      A HAVE_* that flipped ON compiles code back IN. Read before continuing."
  fi
fi

echo "=== 4/4  build the components ============================================="
# `-k 0` = keep going after a failure. A cross-build against a libc this different fails in
# CLASSES, not one file at a time, and stopping at the first one turns a single class into
# one build round per file. Reading every failure from one run is the difference between an
# afternoon and a week. The exit code still reports failure, and the summary below groups by
# error text so the class is visible rather than the instance.
# shellcheck disable=SC2086
ninja -C "$SRC/build-wasi" -k 0 -j "$JOBS" $COMPONENTS > "$ROOT/ninja-wasi.log" 2>&1
EXIT=$?
if [ "$EXIT" -ne 0 ]; then
  FAILED=$(grep -c "^FAILED:" "$ROOT/ninja-wasi.log")
  echo "cross build failed ($EXIT) -- $FAILED object(s) failed" >&2
  echo "--- distinct errors, most frequent first ---" >&2
  grep -hoE "error: .*" "$ROOT/ninja-wasi.log" \
    | sed -E "s/'[^']*'/'X'/g" \
    | sort | uniq -c | sort -rn | head -25 >&2
  echo "--- the files that failed ---" >&2
  grep "^FAILED:" "$ROOT/ninja-wasi.log" | sed -E 's#.*/([^/]+)\.obj.*#\1#' | sort -u | head -30 >&2
  echo "--- full log: $ROOT/ninja-wasi.log ---" >&2
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
