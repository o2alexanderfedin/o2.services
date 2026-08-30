/*
 * Is the overstated buffer bound in mpiZeroPrefixedData reachable?
 *
 * GCryptUtilities.cpp:151-165 hands gcry_mpi_print a buffer bound of `targetLength` while
 * the space after the zero prefix is only `targetLength - prefixLength`. This drives every
 * value length from 0 to targetLength, with a heap buffer of EXACTLY targetLength bytes and
 * AddressSanitizer watching, so an overflow of even one byte is a crash rather than an
 * argument. Adversarial shapes included: the all-zero MPI (prefixLength == targetLength, so
 * the write pointer is one past the end), and values with 1..8 leading zero bytes.
 *
 * Also asserts the recovered bytes: prefix zeroed, value right-aligned, nothing else touched.
 */
#include <gcrypt.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static int mpi_length(gcry_mpi_t m, size_t *out)
{
    size_t len = 0;
    if (gcry_mpi_print(GCRYMPI_FMT_USG, NULL, 0, &len, m) != GPG_ERR_NO_ERROR) return 0;
    *out = len; return 1;
}

/* WebKit's function, transliterated, INCLUDING the overstated bound. */
static int webkit_mpi_zero_prefixed(gcry_mpi_t m, size_t target, unsigned char *heap_exact)
{
    size_t len;
    if (!mpi_length(m, &len) || len > target) return -1;
    memset(heap_exact, 0, target);
    size_t prefixLength = target - len;
    /* <-- the bound under test: `target`, not `target - prefixLength` */
    if (gcry_mpi_print(GCRYMPI_FMT_USG, heap_exact + prefixLength, target, NULL, m) != GPG_ERR_NO_ERROR)
        return -2;
    return (int)len;
}

int main(void)
{
    if (!gcry_check_version(GCRYPT_VERSION)) return 2;
    gcry_control(GCRYCTL_INITIALIZATION_FINISHED, 0);
    printf("libgcrypt %s\n", gcry_check_version(NULL));

    const size_t target = 32;
    long cases = 0, refused = 0, mismatch = 0;

    /* Every value length 0..32, several values at each, plus deliberate leading-zero shapes. */
    for (size_t valbytes = 0; valbytes <= target; valbytes++) {
        for (int rep = 0; rep < 64; rep++) {
            unsigned char raw[32];
            memset(raw, 0, sizeof raw);
            for (size_t i = 0; i < valbytes; i++) raw[32 - valbytes + i] = (unsigned char)(rand() & 0xff);
            if (valbytes > 0) raw[32 - valbytes] |= 0x80;   /* force this to be the true length */

            gcry_mpi_t m = NULL;
            if (gcry_mpi_scan(&m, GCRYMPI_FMT_USG, raw, 32, NULL)) continue;

            /* heap buffer of EXACTLY target bytes: ASAN redzones sit immediately after it */
            unsigned char *buf = malloc(target);
            int r = webkit_mpi_zero_prefixed(m, target, buf);
            cases++;
            if (r < 0) refused++;
            else {
                size_t prefix = target - (size_t)r;
                for (size_t i = 0; i < prefix; i++) if (buf[i] != 0) { mismatch++; break; }
                if (memcmp(buf, raw, 32) != 0) mismatch++;
            }
            free(buf);
            gcry_mpi_release(m);
        }
    }

    /* The all-zero MPI on its own: prefixLength == target, write pointer one past the end. */
    {
        gcry_mpi_t z = gcry_mpi_new(0);
        gcry_mpi_set_ui(z, 0);
        unsigned char *buf = malloc(target);
        int r = webkit_mpi_zero_prefixed(z, target, buf);
        printf("all-zero MPI: r=%d (0 means length 0, pointer one past the end, nothing written)\n", r);
        free(buf);
        gcry_mpi_release(z);
    }

    printf("cases=%ld refused=%ld mismatch=%ld\n", cases, refused, mismatch);
    printf("no ASAN report above means no byte was written outside the exact-size buffer\n");
    return mismatch == 0 ? 0 : 1;
}
