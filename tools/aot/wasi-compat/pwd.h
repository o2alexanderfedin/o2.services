/* pwd.h — the user database, which WASI has no notion of.
 *
 * `Unix/Path.inc` includes this to answer `sys::path::home_directory()`: it calls
 * `getpwuid_r(getuid(), ...)` and reads `pw_dir` when the `$HOME` environment variable is
 * unset. On a wasm instance there is no user database to consult, so the lookup failing is
 * the true answer rather than a placeholder — and LLVM already handles it, because the
 * caller's next line is `if (!Entry || !Entry->pw_dir)`, which falls back to `$HOME` and
 * then gives up. Nothing downstream is surprised.
 */

#ifndef O2_WASI_COMPAT_PWD_H
#define O2_WASI_COMPAT_PWD_H

#include <errno.h>
#include <stddef.h>
#include <unistd.h> /* uid_t, gid_t */

#ifdef __cplusplus
extern "C" {
#endif

struct passwd {
  char *pw_name;
  char *pw_passwd;
  uid_t pw_uid;
  gid_t pw_gid;
  char *pw_gecos;
  char *pw_dir;
  char *pw_shell;
};

static inline struct passwd *getpwuid(uid_t __uid) {
  (void)__uid;
  errno = ENOENT;
  return (struct passwd *)0;
}

static inline struct passwd *getpwnam(const char *__name) {
  (void)__name;
  errno = ENOENT;
  return (struct passwd *)0;
}

/* The _r forms report "no such entry" the POSIX way: return 0, and leave *result null. */

static inline int getpwuid_r(uid_t __uid, struct passwd *__pwd, char *__buf,
                             size_t __buflen, struct passwd **__result) {
  (void)__uid;
  (void)__pwd;
  (void)__buf;
  (void)__buflen;
  if (__result != (struct passwd **)0) *__result = (struct passwd *)0;
  return 0;
}

static inline int getpwnam_r(const char *__name, struct passwd *__pwd, char *__buf,
                             size_t __buflen, struct passwd **__result) {
  (void)__name;
  (void)__pwd;
  (void)__buf;
  (void)__buflen;
  if (__result != (struct passwd **)0) *__result = (struct passwd *)0;
  return 0;
}

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* O2_WASI_COMPAT_PWD_H */
