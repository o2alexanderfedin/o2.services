/*
 * A transliteration into C of the exact WebKit code path under investigation:
 *   Source/WebCore/crypto/gcrypt/GCryptUtilities.cpp:110-168  (mpiLength / mpiData /
 *                                                              mpiZeroPrefixedData)
 *   Source/WebCore/crypto/gcrypt/CryptoKeyOKPGCrypt.cpp:68-140 (the two generators and
 *                                                              the 32+32 length gate)
 * Same libgcrypt calls, same S-expression, same order. No WebKit, no browser.
 *
 * Prints, per algorithm: how often the SHIPPING extraction produces a component that is not
 * 32 bytes (which platformGeneratePair turns into std::nullopt -> OperationError), and
 * whether the PATCHED extraction ever fails or ever disagrees on the significant bytes.
 */
#include <gcrypt.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static int mpi_length(gcry_mpi_t m, size_t *out)
{
    size_t len = 0;
    if (gcry_mpi_print(GCRYMPI_FMT_USG, NULL, 0, &len, m) != GPG_ERR_NO_ERROR) return 0;
    *out = len;
    return 1;
}

/* mpiData: buffer sized to the VALUE's length. */
static int mpi_data(gcry_mpi_t m, unsigned char *buf, size_t cap, size_t *outlen)
{
    size_t len;
    if (!mpi_length(m, &len) || len > cap) return 0;
    if (gcry_mpi_print(GCRYMPI_FMT_USG, buf, len, NULL, m) != GPG_ERR_NO_ERROR) return 0;
    *outlen = len;
    return 1;
}

/* mpiZeroPrefixedData: buffer sized to the FORMAT's width, value right-aligned. */
static int mpi_zero_prefixed(gcry_mpi_t m, size_t target, unsigned char *buf)
{
    size_t len;
    if (!mpi_length(m, &len) || len > target) return 0;
    memset(buf, 0, target);
    if (gcry_mpi_print(GCRYMPI_FMT_USG, buf + (target - len), len, NULL, m) != GPG_ERR_NO_ERROR) return 0;
    return 1;
}

struct tally {
    long draws, shipping_refused, patched_refused, disagreements;
    long q_short, d_short, q_first_zero_survivors, d_first_zero_survivors;
};

static void account(struct tally *t, gcry_mpi_t q, gcry_mpi_t d)
{
    unsigned char qb[64], db[64], qp[32], dp[32];
    size_t ql = 0, dl = 0;
    t->draws++;

    if (!mpi_data(q, qb, sizeof qb, &ql) || !mpi_data(d, db, sizeof db, &dl)) {
        t->shipping_refused++;
        return;
    }
    if (ql != 32) t->q_short++;
    if (dl != 32) t->d_short++;
    if (ql != 32 || dl != 32) t->shipping_refused++;          /* CryptoKeyOKPGCrypt.cpp:138 */
    else {
        if (qb[0] == 0) t->q_first_zero_survivors++;
        if (db[0] == 0) t->d_first_zero_survivors++;
    }

    if (!mpi_zero_prefixed(q, 32, qp) || !mpi_zero_prefixed(d, 32, dp)) {
        t->patched_refused++;
        return;
    }
    /* The patched buffer must carry the same significant bytes, right-aligned. */
    if (memcmp(qp + (32 - ql), qb, ql) != 0 || memcmp(dp + (32 - dl), db, dl) != 0)
        t->disagreements++;
}

static void report(const char *name, const struct tally *t)
{
    printf("%-8s draws=%ld  SHIPPING refused=%ld (%.3f%%)  [q<32:%ld d<32:%ld]  "
           "survivors with first byte 0x00: q=%ld d=%ld  ||  PATCHED refused=%ld "
           "disagreements=%ld\n",
           name, t->draws, t->shipping_refused,
           100.0 * (double)t->shipping_refused / (double)t->draws,
           t->q_short, t->d_short, t->q_first_zero_survivors, t->d_first_zero_survivors,
           t->patched_refused, t->disagreements);
}

int main(int argc, char **argv)
{
    long n = (argc > 1) ? atol(argv[1]) : 20000;

    if (!gcry_check_version(GCRYPT_VERSION)) { fprintf(stderr, "libgcrypt version\n"); return 2; }
    gcry_control(GCRYCTL_INITIALIZATION_FINISHED, 0);
    printf("libgcrypt %s\n", gcry_check_version(NULL));

    /* ---- Ed25519: gcryptGenerateEd25519Keys, CryptoKeyOKPGCrypt.cpp:68 ---- */
    struct tally ed = {0};
    gcry_sexp_t genkey = NULL;
    if (gcry_sexp_build(&genkey, NULL, "(genkey (ecdsa (curve Ed25519) (flags eddsa)))")) return 2;
    for (long i = 0; i < n; i++) {
        gcry_sexp_t pair = NULL;
        if (gcry_pk_genkey(&pair, genkey)) { ed.shipping_refused++; ed.draws++; continue; }
        gcry_mpi_t q = NULL, d = NULL;
        if (gcry_sexp_extract_param(pair, "private-key", "qd", &q, &d, NULL)) {
            ed.shipping_refused++; ed.draws++; gcry_sexp_release(pair); continue;
        }
        account(&ed, q, d);
        gcry_mpi_release(q); gcry_mpi_release(d); gcry_sexp_release(pair);
    }
    gcry_sexp_release(genkey);
    report("Ed25519", &ed);

    /* ---- X25519: gcryptGenerateX25519Keys, CryptoKeyOKPGCrypt.cpp:98.
       Only `d` goes through mpiData there; `q` comes back fixed-width from RFC7748::X25519,
       so only the private half can be short. Counted that way. ---- */
    struct tally x = {0};
    for (long i = 0; i < n; i++) {
        gcry_mpi_t d = gcry_mpi_new(256);
        gcry_mpi_randomize(d, 256, GCRY_STRONG_RANDOM);
        unsigned char db[64], dp[32];
        size_t dl = 0;
        x.draws++;
        if (!mpi_data(d, db, sizeof db, &dl)) { x.shipping_refused++; gcry_mpi_release(d); continue; }
        if (dl != 32) { x.d_short++; x.shipping_refused++; }
        else if (db[0] == 0) x.d_first_zero_survivors++;
        if (!mpi_zero_prefixed(d, 32, dp)) x.patched_refused++;
        else if (memcmp(dp + (32 - dl), db, dl) != 0) x.disagreements++;
        gcry_mpi_release(d);
    }
    report("X25519", &x);

    return 0;
}
