/* wasi-posix-compat.h — the POSIX process and signal surface wasi-libc removes.
 *
 * Force-included (`-include`) into every translation unit of the wasm32-wasi LLVM
 * cross-build by tools/aot/build-wasi-llvm.sh. It exists so that **no LLVM source file
 * has to be edited**: the only change to the LLVM tree is one line in
 * HandleLLVMOptions.cmake, and that one is about cmake, not about C.
 *
 * ## Why this is needed at all, measured rather than assumed
 *
 * `-D_WASI_EMULATED_SIGNAL` gets past the `#error` at the top of wasi-libc's `<signal.h>`
 * and yields `raise` and `signal`. It does NOT yield the handler API: `struct sigaction`,
 * `siginfo_t`, `sigprocmask`, `SIG_UNBLOCK` and friends are present in the header but
 * fenced behind `#ifdef __wasilibc_unmodified_upstream`, a macro wasi-libc never defines.
 * The same fence removes `fork`, `execve`, `dup2` and `pipe` from `<unistd.h>`, each with
 * a comment naming the reason — "WASI has no dup", "WASI has no fork/exec".
 *
 * Verified against this sysroot by compiling one probe per identifier — the sanity arms
 * (`raise`, `signal`, `getpid`, `_exit`, `struct rusage`) come back present, so a
 * "missing" reading is a fact about the header and not about the probe.
 *
 * `sigset_t` is a third case, and it caught a wrong reading. A probe that also included
 * `<sys/resource.h>` found it, so it was recorded as present; compiled the way LLVM
 * actually compiles — `-std=c++17`, no `_GNU_SOURCE` — it is NOT. Its `__NEED_sigset_t`
 * sits inside the same WASI fence, and `-D_GNU_SOURCE` does not reach it (measured: that
 * flag reveals `pid_t` and `ssize_t` and leaves `sigset_t` missing). So this file requests
 * it from `<bits/alltypes.h>` the way musl's own headers do, which sets
 * `__DEFINED_sigset_t` and therefore cannot collide with a later definition.
 *
 * ## These are not stubs standing in for something better
 *
 * A wasm module has no processes and no asynchronous signals. `fork` returning -1/ENOSYS
 * is the *correct* implementation on this target, not a placeholder — the same reasoning
 * that made a no-op `std::mutex` correct for a single-threaded libc++ build. LLVM's
 * callers already handle these failing: `CrashRecoveryContext::RunSafely` still works
 * through `setjmp`, and `sys::ExecuteAndWait` reports an error the way it would for any
 * host that refused the spawn.
 *
 * ## What is deliberately NOT provided, and why
 *
 * `sigaltstack`, `getrlimit`, `setrlimit` and the `posix_spawn` family are left missing on
 * purpose. cmake probes for them with `check_symbol_exists`, which compiles AND links — a
 * `static inline` here would satisfy both and flip `HAVE_SIGALTSTACK`, `HAVE_SETRLIMIT`,
 * `HAVE_GETRLIMIT` and `HAVE_POSIX_SPAWN` on. They are currently off in
 * `build-wasi/include/llvm/Config/config.h`, which is what compiles those code paths out
 * of `Unix/Signals.inc` and `Unix/Program.inc` entirely. Providing them would *add* work.
 *
 * If a future round needs one of them, add it here AND check what it did to config.h.
 */

#ifndef O2_WASI_POSIX_COMPAT_H
#define O2_WASI_POSIX_COMPAT_H

#if defined(__wasi__)

/* Ask musl's type header for sigset_t before anything else can. This is the mechanism
 * wasi-libc's own headers use, and it sets __DEFINED_sigset_t, so a later include that
 * asks for the same type gets a no-op rather than a redefinition. */
#define __NEED_sigset_t
#define __NEED_pid_t
#define __NEED_uid_t
#define __NEED_gid_t
#define __NEED_mode_t
#define __NEED_size_t
#include <bits/alltypes.h>

#include <errno.h>
#include <signal.h>  /* SIG* numbers, raise, signal — all genuinely present */
#include <stddef.h>
#include <stdio.h>   /* FILE, for the popen pair below */
#include <unistd.h>  /* _exit, getpid */

#ifdef __cplusplus
extern "C" {
#endif

/* ---- signal masks ------------------------------------------------------------------ */

#ifndef SIG_BLOCK
#define SIG_BLOCK 0
#define SIG_UNBLOCK 1
#define SIG_SETMASK 2
#endif

/* ---- sigaction flags --------------------------------------------------------------- */

#ifndef SA_NOCLDSTOP
#define SA_NOCLDSTOP 1
#define SA_NOCLDWAIT 2
#define SA_SIGINFO 4
#define SA_ONSTACK 0x08000000
#define SA_RESTART 0x10000000
#define SA_NODEFER 0x40000000
#define SA_RESETHAND 0x80000000
#endif

/* ---- siginfo_t --------------------------------------------------------------------- */

/* Only the members LLVM reads. The layout is ours because nothing on this target
 * produces one of these — no signal is ever delivered, so no ABI is being matched. */
typedef struct __o2_siginfo {
  int si_signo;
  int si_errno;
  int si_code;
  int si_status;
  pid_t si_pid;
  void *si_addr;
} siginfo_t;

/* ---- struct sigaction -------------------------------------------------------------- */

/* musl overlaps sa_handler and sa_sigaction in a union and reaches them through macros.
 * Two plain members are used here instead: assigning either compiles, and a macro named
 * `sa_handler` would be visible in every translation unit of the build. */
struct sigaction {
  void (*sa_handler)(int);
  void (*sa_sigaction)(int, siginfo_t *, void *);
  sigset_t sa_mask;
  int sa_flags;
  void (*sa_restorer)(void);
};

/* ---- signal-set operations --------------------------------------------------------- */

/* A sigset_t is a bit array that nothing ever consults on this target, so these maintain
 * it honestly and cheaply rather than pretending to fail. */

static inline int sigemptyset(sigset_t *__s) {
  unsigned __i;
  unsigned char *__p = (unsigned char *)__s;
  for (__i = 0; __i < sizeof(sigset_t); __i++) __p[__i] = 0;
  return 0;
}

static inline int sigfillset(sigset_t *__s) {
  unsigned __i;
  unsigned char *__p = (unsigned char *)__s;
  for (__i = 0; __i < sizeof(sigset_t); __i++) __p[__i] = 0xff;
  return 0;
}

static inline int sigaddset(sigset_t *__s, int __signo) {
  unsigned __bit = (unsigned)(__signo - 1);
  if (__bit >= sizeof(sigset_t) * 8) {
    errno = EINVAL;
    return -1;
  }
  ((unsigned char *)__s)[__bit / 8] |= (unsigned char)(1u << (__bit % 8));
  return 0;
}

static inline int sigdelset(sigset_t *__s, int __signo) {
  unsigned __bit = (unsigned)(__signo - 1);
  if (__bit >= sizeof(sigset_t) * 8) {
    errno = EINVAL;
    return -1;
  }
  ((unsigned char *)__s)[__bit / 8] &= (unsigned char)~(1u << (__bit % 8));
  return 0;
}

static inline int sigismember(const sigset_t *__s, int __signo) {
  unsigned __bit = (unsigned)(__signo - 1);
  if (__bit >= sizeof(sigset_t) * 8) return 0;
  return (((const unsigned char *)__s)[__bit / 8] >> (__bit % 8)) & 1;
}

/* ---- handler installation and masking ---------------------------------------------- */

/* No signal is ever delivered to a wasm instance, so there is nothing to install and
 * nothing to block. Reporting success is the truthful answer to "is the mask now what I
 * asked for" — it is, vacuously — and it keeps LLVM off its error paths. */

static inline int sigprocmask(int __how, const sigset_t *__set, sigset_t *__old) {
  (void)__how;
  (void)__set;
  if (__old != (sigset_t *)0) sigemptyset(__old);
  return 0;
}

static inline int pthread_sigmask(int __how, const sigset_t *__set, sigset_t *__old) {
  return sigprocmask(__how, __set, __old);
}

static inline int sigaction(int __signo, const struct sigaction *__act,
                            struct sigaction *__old) {
  (void)__signo;
  (void)__act;
  if (__old != (struct sigaction *)0) {
    __old->sa_handler = (void (*)(int))0;
    __old->sa_sigaction = (void (*)(int, siginfo_t *, void *))0;
    __old->sa_flags = 0;
    __old->sa_restorer = (void (*)(void))0;
    sigemptyset(&__old->sa_mask);
  }
  return 0;
}

static inline int sigsuspend(const sigset_t *__set) {
  (void)__set;
  errno = ENOSYS;
  return -1;
}

static inline int sigpending(sigset_t *__set) {
  sigemptyset(__set);
  return 0;
}

/* ---- process control --------------------------------------------------------------- */

/* Here the honest answer IS failure: there is no second process to create, and a caller
 * that treats -1 as success would be wrong on this target. */

static inline int kill(pid_t __pid, int __signo) {
  (void)__pid;
  (void)__signo;
  errno = ENOSYS;
  return -1;
}

static inline pid_t fork(void) {
  errno = ENOSYS;
  return (pid_t)-1;
}

static inline int execve(const char *__path, char *const __argv[],
                         char *const __envp[]) {
  (void)__path;
  (void)__argv;
  (void)__envp;
  errno = ENOSYS;
  return -1;
}

static inline int execv(const char *__path, char *const __argv[]) {
  (void)__path;
  (void)__argv;
  errno = ENOSYS;
  return -1;
}

static inline int execvp(const char *__file, char *const __argv[]) {
  (void)__file;
  (void)__argv;
  errno = ENOSYS;
  return -1;
}

static inline int dup2(int __from, int __to) {
  (void)__from;
  (void)__to;
  errno = ENOSYS;
  return -1;
}

static inline int pipe(int __fds[2]) {
  (void)__fds;
  errno = ENOSYS;
  return -1;
}

static inline int nice(int __inc) {
  (void)__inc;
  errno = ENOSYS;
  return -1;
}

/* `alarm` schedules SIGALRM, and no signal is ever delivered here. LLVM uses it in
 * `Watchdog` and to bound `sys::ExecuteAndWait` — both of which are already inert on this
 * target, the second because `fork` cannot succeed. Returning 0 says "no alarm was
 * previously pending", which is true. */
static inline unsigned alarm(unsigned __seconds) {
  (void)__seconds;
  return 0;
}

/* `getsid` is a liveness probe in LockFileManager: `getsid(PID) == -1 && errno == ESRCH`
 * means "the process that held this lock is gone". With no processes, gone is the correct
 * answer, and ESRCH is the way to say it — this returns exactly what makes that check
 * conclude the lock is stale. */
static inline pid_t getsid(pid_t __pid) {
  (void)__pid;
  errno = ESRCH;
  return (pid_t)-1;
}

/* No user database. See tools/aot/wasi-compat/pwd.h for what consumes these. */

static inline uid_t getuid(void) { return (uid_t)0; }
static inline uid_t geteuid(void) { return (uid_t)0; }
static inline gid_t getgid(void) { return (gid_t)0; }
static inline gid_t getegid(void) { return (gid_t)0; }

/* ---- file ownership and permission mask -------------------------------------------- */

/* WASI has no uid/gid and no process-wide permission mask. `Unix/Path.inc` reads the umask
 * the portable way -- `mode_t m = ::umask(0); ::umask(m);` -- so returning 0 reports that no
 * permission bits are being masked off, which is exactly true here. Ownership changes have
 * no subject to change ownership TO, so they refuse. */

static inline mode_t umask(mode_t __mask) {
  (void)__mask;
  return (mode_t)0;
}

static inline int fchown(int __fd, uid_t __owner, gid_t __group) {
  (void)__fd;
  (void)__owner;
  (void)__group;
  errno = ENOSYS;
  return -1;
}

static inline int chown(const char *__path, uid_t __owner, gid_t __group) {
  (void)__path;
  (void)__owner;
  (void)__group;
  errno = ENOSYS;
  return -1;
}

static inline int lchown(const char *__path, uid_t __owner, gid_t __group) {
  return chown(__path, __owner, __group);
}

/* ---- fcntl record locking ---------------------------------------------------------- */

/* `struct flock` and `fcntl` are both present in this sysroot; only the lock commands and
 * lock types are missing, because wasi-libc's fcntl implements a smaller command set. The
 * values below are musl's, which is where the `struct flock` beside them comes from.
 *
 * A call made with these will fail at runtime rather than lock anything -- and that is the
 * accurate outcome, since a single wasm instance has no second holder to exclude. LLVM's
 * `lockFile`/`tryLockFile` already return an error when fcntl fails. */

#ifndef F_GETLK
#define F_GETLK 5
#define F_SETLK 6
#define F_SETLKW 7
#endif

#ifndef F_RDLCK
#define F_RDLCK 0
#define F_WRLCK 1
#define F_UNLCK 2
#endif

/* ---- memory advice ----------------------------------------------------------------- */

/* `posix_madvise` tells the kernel how a mapping will be used. A wasm linear memory has no
 * kernel behind it and no pages to advise about, so there is nothing to convey and nothing
 * lost by not conveying it -- the call is a hint even on systems that have it, and POSIX
 * allows it to do nothing. Reporting success is therefore accurate.
 *
 * LLVM calls this from `Unix/Path.inc` after mapping a file. It ignores the return value. */

#ifndef POSIX_MADV_NORMAL
#define POSIX_MADV_NORMAL 0
#define POSIX_MADV_RANDOM 1
#define POSIX_MADV_SEQUENTIAL 2
#define POSIX_MADV_WILLNEED 3
#define POSIX_MADV_DONTNEED 4
#endif

static inline int posix_madvise(void *__addr, size_t __len, int __advice) {
  (void)__addr;
  (void)__len;
  (void)__advice;
  return 0;
}

/* ---- pipes to a shell -------------------------------------------------------------- */

/* `popen` runs a command through /bin/sh. There is no shell, no fork and no second process
 * here, so it reports failure -- and glog, the only caller in this build, already writes the
 * failure path: `FILE* pipe = popen(cmd.c_str(), "w"); if (pipe != nullptr) { ... }`. That is
 * glog's log-by-email feature declining to send, which is the correct outcome on a target
 * with no mailer to invoke. */

static inline FILE *popen(const char *__command, const char *__mode) {
  (void)__command;
  (void)__mode;
  errno = ENOSYS;
  return (FILE *)0;
}

static inline int pclose(FILE *__stream) {
  (void)__stream;
  errno = ECHILD;
  return -1;
}

/* ---- wait ------------------------------------------------------------------------- */

/* `<sys/wait.h>` does not exist in this sysroot; tools/aot/wasi-compat/sys/wait.h is a
 * shim that includes this file, so an `#include <sys/wait.h>` still resolves. */

#ifndef WNOHANG
#define WNOHANG 1
#define WUNTRACED 2
#define WCONTINUED 8
#endif

#ifndef WIFEXITED
#define WEXITSTATUS(__s) (((__s) & 0xff00) >> 8)
#define WTERMSIG(__s) ((__s) & 0x7f)
#define WSTOPSIG(__s) WEXITSTATUS(__s)
#define WIFEXITED(__s) (WTERMSIG(__s) == 0)
#define WIFSIGNALED(__s) (((signed char)(((__s) & 0x7f) + 1) >> 1) > 0)
#define WIFSTOPPED(__s) ((short)((((__s) & 0xffff) * 0x10001) >> 8) > 0x7f00)
#define WIFCONTINUED(__s) ((__s) == 0xffff)
#define WCOREDUMP(__s) ((__s) & 0x80)
#endif

struct rusage; /* the sysroot defines this one — <sys/resource.h> carries it */

static inline pid_t wait4(pid_t __pid, int *__status, int __options,
                          struct rusage *__usage) {
  (void)__pid;
  (void)__options;
  (void)__usage;
  if (__status != (int *)0) *__status = 0;
  errno = ECHILD;
  return (pid_t)-1;
}

static inline pid_t waitpid(pid_t __pid, int *__status, int __options) {
  return wait4(__pid, __status, __options, (struct rusage *)0);
}

static inline pid_t wait(int *__status) {
  return waitpid((pid_t)-1, __status, 0);
}

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* __wasi__ */

#endif /* O2_WASI_POSIX_COMPAT_H */
