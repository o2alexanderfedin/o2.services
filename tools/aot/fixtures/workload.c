/*
 * A subject with real memory traffic and real work, for comparing native, direct
 * WASM and elfconv-lifted WASM on something other than process startup.
 *
 * `int main(void){ return 42; }` measured only the fixed cost of starting a program.
 * It could not say whether lifted code *computes* slowly, because it never computed.
 * This does, and it is built to make the comparison honest rather than flattering:
 *
 *   - **Deterministic.** No clock, no randomness, no input. Every route must print the
 *     same checksum, which turns the benchmark into a correctness check as well: a lift
 *     that is fast because it got the arithmetic wrong fails visibly instead of winning.
 *   - **Memory-bound and ALU-bound together.** MIB megabytes are allocated, filled, then
 *     re-walked PASSES times with a multiply-xor-shift mix. The array is far larger than
 *     any cache, so the loops pay real memory traffic; the mix keeps the ALU busy so the
 *     result is not purely a bandwidth test.
 *   - **Serially dependent.** Each element folds into `acc` and is written back, so the
 *     compiler cannot vectorise the passes away or drop them as dead. A workload that
 *     optimises to nothing measures the optimiser, not the runtime.
 *   - **Sized at compile time**, not from argv or the environment, because argument and
 *     environment handling differ across these three routes and a difference in the
 *     harness would be read as a difference in the runtime.
 *
 * Written with fixed-width types and no libc beyond malloc/printf, so the same source
 * compiles unchanged for macOS/arm64, wasm32-wasi via emcc, and static AArch64 Linux.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#ifndef MIB
#define MIB 32
#endif
#ifndef PASSES
#define PASSES 4
#endif

int main(void) {
  const size_t n = ((size_t)MIB * 1024u * 1024u) / sizeof(uint64_t);
  uint64_t *a = (uint64_t *)malloc(n * sizeof(uint64_t));
  if (a == NULL) {
    printf("alloc-failed\n");
    return 1;
  }

  /* xorshift64* fill — cheap, deterministic, and touches every page once. */
  uint64_t x = 0x0123456789abcdefULL;
  for (size_t i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    a[i] = x;
  }

  /* The work. Serially dependent on purpose: see the header. */
  uint64_t acc = 0x9E3779B97F4A7C15ULL;
  for (int pass = 0; pass < PASSES; pass++) {
    for (size_t i = 0; i < n; i++) {
      acc += a[i];
      acc *= 0x9E3779B97F4A7C15ULL;
      acc ^= acc >> 29;
      a[i] = acc;
    }
  }

  free(a);
  /* The whole answer, so any divergence between routes is visible rather than latent. */
  printf("%llu\n", (unsigned long long)acc);
  return 0;
}
