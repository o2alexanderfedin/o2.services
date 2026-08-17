/* machine/endian.h — the BSD spelling, which this sysroot does not carry.
 *
 * 27 of the 37 failures in the second cross-build round were this one header, which makes
 * it the cheapest fix in the set by a wide margin.
 *
 * `llvm/Support/SwapByteOrder.h` picks its endian header by platform: `<endian.h>` for
 * Linux, GNU, Android, Fuchsia and Emscripten, something else for AIX and z/OS, and
 * `<machine/endian.h>` for everything left over. wasm32-wasi is left over, and lands on the
 * BSD spelling. wasi-libc ships `<endian.h>` with `BYTE_ORDER`, `LITTLE_ENDIAN` and
 * `BIG_ENDIAN` all defined — verified — so the two headers differ in name only here.
 */

#ifndef O2_WASI_COMPAT_MACHINE_ENDIAN_H
#define O2_WASI_COMPAT_MACHINE_ENDIAN_H

#include <endian.h>

#endif /* O2_WASI_COMPAT_MACHINE_ENDIAN_H */
