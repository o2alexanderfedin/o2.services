/*
 * The export/import asymmetry, at the library boundary, with no browser.
 *
 * CryptoKeyOKP holds the key as raw bytes; exportKey('pkcs8') writes m_data straight out,
 * so a 32-byte seed leaves intact. importPkcs8 checks the DER field is 32 bytes, then runs
 * it through gcry_sexp_build + gcry_sexp_extract_param + mpiData, which drops a leading
 * zero, and hands 31 bytes to create(), which requires 32.
 *
 * Drives seeds whose first byte is 0x00 through exactly that round trip and counts.
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
static int mpi_data(gcry_mpi_t m, unsigned char *buf, size_t cap, size_t *outlen)
{
    size_t len;
    if (!mpi_length(m, &len) || len > cap) return 0;
    if (gcry_mpi_print(GCRYMPI_FMT_USG, buf, len, NULL, m) != GPG_ERR_NO_ERROR) return 0;
    *outlen = len; return 1;
}
static int mpi_zero_prefixed(gcry_mpi_t m, size_t target, unsigned char *buf)
{
    size_t len;
    if (!mpi_length(m, &len) || len > target) return 0;
    memset(buf, 0, target);
    if (gcry_mpi_print(GCRYMPI_FMT_USG, buf + (target - len), len, NULL, m) != GPG_ERR_NO_ERROR) return 0;
    return 1;
}

/* CryptoKeyOKPGCrypt.cpp:348-407, the import as it ships and as patched. */
static int import_seed(const unsigned char seed[32], int patched, unsigned char out[32])
{
    gcry_sexp_t key = NULL;
    if (gcry_sexp_build(&key, NULL, "(private-key(ecc(curve Ed25519)(flags eddsa)(d %b)))", 32, seed))
        return 0;
    gcry_mpi_t d = NULL;
    if (gcry_sexp_extract_param(key, "private-key", "d", &d, NULL)) { gcry_sexp_release(key); return 0; }

    int ok;
    if (patched)
        ok = mpi_zero_prefixed(d, 32, out);                        /* create() sees 32 */
    else {
        size_t len = 0;
        unsigned char tmp[64];
        ok = mpi_data(d, tmp, sizeof tmp, &len) && len == 32;      /* create() requires 32 */
        if (ok) memcpy(out, tmp, 32);
    }
    gcry_mpi_release(d); gcry_sexp_release(key);
    return ok;
}

int main(void)
{
    if (!gcry_check_version(GCRYPT_VERSION)) return 2;
    gcry_control(GCRYCTL_INITIALIZATION_FINISHED, 0);
    printf("libgcrypt %s\n", gcry_check_version(NULL));

    long n = 2000;
    long ship_zero = 0, patch_zero = 0, patch_wrong = 0;
    long ship_ctrl = 0, patch_ctrl = 0;

    for (long i = 0; i < n; i++) {
        unsigned char seed[32], out[32];
        gcry_randomize(seed, 32, GCRY_STRONG_RANDOM);

        seed[0] = 0x00;                                  /* the population under test */
        if (import_seed(seed, 0, out)) ship_zero++;
        if (import_seed(seed, 1, out)) {
            patch_zero++;
            if (memcmp(out, seed, 32) != 0) patch_wrong++;
        }

        seed[0] = 0x01 + (unsigned char)(i & 0x7e);      /* control */
        if (import_seed(seed, 0, out)) ship_ctrl++;
        if (import_seed(seed, 1, out)) patch_ctrl++;
    }

    printf("seed first byte 0x00, n=%ld:  SHIPPING accepts %ld  PATCHED accepts %ld  (patched bytes wrong: %ld)\n",
           n, ship_zero, patch_zero, patch_wrong);
    printf("control seeds,      n=%ld:  SHIPPING accepts %ld  PATCHED accepts %ld\n",
           n, ship_ctrl, patch_ctrl);
    return 0;
}
