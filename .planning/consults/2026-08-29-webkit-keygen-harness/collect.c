/*
 * Collect Ed25519 draws from libgcrypt through the PATCHED extraction
 * (mpiZeroPrefixedData, 32) and print them for an independent implementation to check.
 *
 * Two populations are printed, and the second is the control: `short` are the draws the
 * shipping code DISCARDS (a component whose minimal encoding is under 32 bytes), `full`
 * are the ones it keeps. If an independent Ed25519 implementation derives the same public
 * key from the private half in BOTH populations, the recovered bytes are the real key and
 * not merely the right length. If it agrees only on `full`, the patch is wrong.
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

static int mpi_zero_prefixed(gcry_mpi_t m, size_t target, unsigned char *buf, size_t *natural)
{
    size_t len;
    if (!mpi_length(m, &len) || len > target) return 0;
    memset(buf, 0, target);
    if (gcry_mpi_print(GCRYMPI_FMT_USG, buf + (target - len), len, NULL, m) != GPG_ERR_NO_ERROR) return 0;
    *natural = len; return 1;
}

static void puthex(const unsigned char *b, size_t n)
{
    for (size_t i = 0; i < n; i++) printf("%02x", b[i]);
}

int main(int argc, char **argv)
{
    long want_short = (argc > 1) ? atol(argv[1]) : 100;
    long want_full  = (argc > 2) ? atol(argv[2]) : 100;

    if (!gcry_check_version(GCRYPT_VERSION)) return 2;
    gcry_control(GCRYCTL_INITIALIZATION_FINISHED, 0);

    gcry_sexp_t genkey = NULL;
    if (gcry_sexp_build(&genkey, NULL, "(genkey (ecdsa (curve Ed25519) (flags eddsa)))")) return 2;

    long got_short = 0, got_full = 0, draws = 0;
    while ((got_short < want_short || got_full < want_full) && draws < 200000) {
        draws++;
        gcry_sexp_t pair = NULL;
        if (gcry_pk_genkey(&pair, genkey)) continue;
        gcry_mpi_t q = NULL, d = NULL;
        if (gcry_sexp_extract_param(pair, "private-key", "qd", &q, &d, NULL)) { gcry_sexp_release(pair); continue; }

        unsigned char qb[32], db[32];
        size_t qn = 0, dn = 0;
        if (mpi_zero_prefixed(q, 32, qb, &qn) && mpi_zero_prefixed(d, 32, db, &dn)) {
            int is_short = (qn != 32 || dn != 32);
            if (is_short ? (got_short < want_short) : (got_full < want_full)) {
                if (is_short) got_short++; else got_full++;
                printf("%s ", is_short ? "short" : "full");
                puthex(db, 32); printf(" ");
                puthex(qb, 32); printf(" %zu %zu\n", dn, qn);
            }
        }
        gcry_mpi_release(q); gcry_mpi_release(d); gcry_sexp_release(pair);
    }
    fprintf(stderr, "draws=%ld short=%ld full=%ld\n", draws, got_short, got_full);
    gcry_sexp_release(genkey);
    return (got_short == want_short && got_full == want_full) ? 0 : 1;
}
