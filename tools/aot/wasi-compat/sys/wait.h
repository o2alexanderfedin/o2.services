/* sys/wait.h — this sysroot has no such header, and LLVM's Unix/Program.inc includes it.
 *
 * Reached through the `-I tools/aot/wasi-compat` the cross-build adds. That directory
 * contains ONLY the headers wasi-libc genuinely lacks, so prepending it shadows nothing:
 * every other header under sys/ still resolves to the sysroot's own.
 *
 * The declarations live in wasi-posix-compat.h, which is force-included anyway; this file
 * exists so that the `#include` resolves rather than to carry content of its own.
 */

#ifndef O2_WASI_COMPAT_SYS_WAIT_H
#define O2_WASI_COMPAT_SYS_WAIT_H

#include <sys/resource.h> /* struct rusage — present in the sysroot */

/* Angle brackets, not quotes: a quoted include would look next to THIS file, i.e. in
 * wasi-compat/sys/, and the header sits one level up. `-I tools/aot/wasi-compat` finds it. */
#include <wasi-posix-compat.h>

#endif /* O2_WASI_COMPAT_SYS_WAIT_H */
