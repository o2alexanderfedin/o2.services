# Upstream report — WebKit (GTK/libgcrypt)

**Status, 2026-08-29: A FIX IS FILED UPSTREAM; THE BUGZILLA COMMENT IS NOT.**

- **[WebKit PR 72772](https://github.com/WebKit/WebKit/pull/72772)** — open, from
  `o2alexanderfedin/WebKit`, branch `eng/OKP-zero-extend-generated-key-components`, one commit,
  one file, `+7 −3`. It references bug 307095 in the WebKit commit-message form, so the bug and
  the change are linked from the WebKit side. WebKit's EWS builds the GTK port and runs the web
  platform tests on it; that is the end-to-end reading this project could not take locally.
- **Still owed: a comment on [307095](https://bugs.webkit.org/show_bug.cgi?id=307095) itself**,
  which needs a bugs.webkit.org account — the owner's to use. The body below is what to post.

The fix is three lines: `gcryptGenerateEd25519Keys` and `gcryptGenerateX25519Keys` extract the
drawn components with `mpiZeroPrefixedData(…, 32)` instead of `mpiData(…)`. The helper already
existed in `GCryptUtilities` and is what the import paths use; it was simply never called on
the generation path.

**The discarded keys are valid keys, and that is measured rather than argued.** 100 draws the
shipping code rejects were extracted with the patched call and handed to `@noble/curves`, an
unrelated RFC 8032 implementation: it derived the same public half from the private half in
100 of 100. 100 accepted draws were run through the same check as a control, also 100 of 100.
Harnesses and readings: `2026-08-29-webkit-keygen-harness/`.

**CORRECTED 2026-08-29 — this must NOT be filed as a new bug.** The draft was written as one,
and a duplicate search afterwards found the symptom already reported twice, six months ago,
both still `NEW`, both unassigned, neither carrying a cause:

| Bug | Filed | Reporter | Title | State |
|-----|-------|----------|-------|-------|
| [307095](https://bugs.webkit.org/show_bug.cgi?id=307095) | 2026-02-05 | Alicia Boya García | `[glib] X25519 and Ed25519 generateKey tests are flaky: Empty usages causes OperationError sometimes` | NEW, unassigned, no patch, no diagnosis |
| [307140](https://bugs.webkit.org/show_bug.cgi?id=307140) | 2026-02-05 | Fujii Hironori | `[GTK][WPE] …/WebCryptoAPI/sign_verify/eddsa_curve25519.https.any.worker.html is flaky` | NEW, unassigned, no patch, no diagnosis |

So the body below is an **analysis comment for 307095**, cross-referencing 307140 — not a new
report. What it adds is the part neither bug has: which values are refused, why, and the
one-line fix. See §"Why this is the same defect" for the measurement that ties them together.

**307095's title states a cause that is not the cause**, and anyone acting on it would look in
the wrong place. Empty usages do not *cause* anything: `generateKey({name:'Ed25519'}, true, [])`
must raise `SyntaxError`, and that check runs *after* the draw, so a refused draw surfaces as
`OperationError` in place of the expected `SyntaxError`. The same refusal happens with normal
usages — this project's own failures are all `['sign','verify']`.

**Nothing has been fixed in the file since.** `Source/WebCore/crypto/gcrypt/CryptoKeyOKPGCrypt.cpp`
has had no functional commit since 2023-09-05 *"Specific methods for the GCrypt based OKP key
generation"* — the commit that introduces this code. Everything after it is refactoring
(`WTFMove` → `WTF::move`, licence headers, `Vector::data()`, an X25519 parameter rename).

---

**Component:** *WebCore Misc.* or *Web Crypto*; platform *GTK*, OS *Linux*.

**Summary line, if a title is ever needed:** `crypto.subtle.generateKey({name:'Ed25519'})`
intermittently throws `OperationError` (~0.8%) — zero-leading key material discarded instead of
zero-extended

**Summary**

On the GTK port, Ed25519 (and X25519) key generation fails roughly 1 attempt in 125 with
`OperationError: The operation failed for an operation-specific reason`. The failure is not
random noise: it happens exactly when a freshly generated key component's most significant
byte is `0x00`. Such keys are discarded and the caller is told the operation failed, rather
than the value being zero-extended to its fixed width.

**Steps to reproduce**

Any secure context on the GTK port. With `mcr.microsoft.com/playwright:v1.62.0-noble`
(WebKit 26.5, playwright build `webkit-2336`), serving a page over `http://127.0.0.1`:

```js
let ok = 0
const errs = {}
for (let i = 0; i < 20000; i++) {
  try { await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); ok++ }
  catch (e) { errs[e.name] = (errs[e.name] ?? 0) + 1 }
}
console.log(ok, errs)
```

**Actual:** `19836 {OperationError: 164}` — 0.82%. Reproduced independently four times by three
people, on both `linux/amd64` and `linux/arm64`, pooled 0.72–0.88%.

**Expected:** 20000 with no errors, which is what Chromium and Firefox give in the same
container (`20000, {}` each), and what the same WebKit 26.5 build gives on macOS
(`5000, {}` — the Cocoa port does not use libgcrypt).

**Evidence that it is the zero-leading byte, not a random fault**

Export the keys that *survive* and count their first bytes. Over 19 855 successful Ed25519
keypairs on the GTK port:

```
"tally": { "d0": 0, "d31": 69, "x0": 0, "x31": 84 }     expected per byte position: 77.6
distinct first-byte values seen: 255 of 256 — only 0x00 is missing
```

Not one survivor begins `0x00` on either component, where ~78 of each are expected; byte 31 is
at expectation, so the distribution is otherwise uniform. Two 32-byte components each lost at
1/256 predicts `1 − (255/256)² = 0.781%`, against 0.72–0.88% measured.

Chromium and Firefox in the same container keep those keys: `"pub0_zero": 78, "d0_zero": 90`
and `"pub0_zero": 78, "d0_zero": 77`, 256 distinct first-byte values.

**X25519 shows the asymmetry the source predicts**

`gcryptGenerateX25519Keys` passes only `d` through the same conversion; `q` comes from a
fixed-width scalar multiplication. So X25519 should fail at *half* the rate, with only the
private half filtered. Measured, four independent runs: 0.30–0.45%, with `d0_zero: 0` and
`pub0_zero` present at expectation. That is a different number rather than a restatement of
the same one, which is why it is offered as corroboration.

**Not affected, also measured:** signing (20 000 signatures, 0 errors, zero-leading `r` and `s`
present at expectation — `extractEDDSASignatureInteger` zero-prefixes explicitly), raw and JWK
import of keys whose `d` or `x` begins `0x00`, `exportKey`, and X25519 `deriveBits`. The defect
is confined to key-generation output extraction.

**Suspected cause**

`Source/WebCore/crypto/gcrypt/CryptoKeyOKPGCrypt.cpp`:

```
 :83   error = gcry_sexp_extract_param(keyPairSexp, "private-key", "qd", &qMpi, &dMpi, nullptr);
 :90       auto q = mpiData(qMpi);
 :91       auto d = mpiData(dMpi);
 :123      keyPair = gcryptGenerateEd25519Keys();
 :138      if (!(publicKeyData.size() == 32 && privateKeyData.size() == 32))
 :139          return std::nullopt;              // -> OperationError
```

`mpiData` is `gcry_mpi_print(GCRYMPI_FMT_USG, …)` (`GCryptUtilities.cpp:133-149`), the minimal
unsigned form: an integer whose top byte is zero prints as 31 bytes. `:138` then rejects it.

Confirmed against libgcrypt directly, with no WebKit involved — a small C program calling
`gcry_pk_genkey` and printing component lengths, libgcrypt 1.10.3:

```
q length 31 bytes: 71    q length 32 bytes: 19928
d length 31 bytes: 79    d length 32 bytes: 19921
q shorter than 32: 0.0036   d shorter than 32: 0.0040   1/256 = 0.00391
```

libgcrypt is behaving correctly — minimal big-endian encoding is what an arbitrary-precision
integer type is specified to produce, and padding to a wire width is the caller's job.

**Suggested fix**

`CryptoKeyOKPGCrypt.cpp` already declares the helper this path needs, and never calls it:

```
GCryptUtilities.h:85  std::optional<Vector<uint8_t>> mpiZeroPrefixedData(gcry_mpi_t, size_t targetLength);
grep -n "mpiZeroPrefixedData" CryptoKeyOKPGCrypt.cpp   -> no hits
```

Using `mpiZeroPrefixedData(mpi, 32)` at `:90-91` — and at `:103` for the X25519 private
scalar — would make the length check at `:138` unreachable for a well-formed key.

**Impact**

Any page that generates Ed25519 keys sees a ~0.8% failure rate with an error that names no
cause, and a page that generates several per session sees it often. In our case a CI suite
making 53 draws per run went red about a quarter of the time.

**Caveat on the source reading:** the lines above are from WebKit `main`, not from the exact
revision behind playwright's `webkit-2336`. The shipped binary's behaviour matches that code on
three independent predictions — which components are filtered for Ed25519, the X25519 half-rate
asymmetry, and the signature path being unaffected — so the mapping is corroborated rather than
proven.

---

**Our workaround, for anyone who finds this before it is fixed:** retry the draw. Each attempt
is fresh randomness, so the value that was refused is re-drawn rather than re-asked — measured
here as 45 refusals in 6000 at one attempt and 0 in 6000 at three, with exactly 45 second
attempts, i.e. every refusal cleared on its redraw. Three attempts take 0.78% to ~5×10⁻⁷. Keep
the retry bounded and rethrow the last refusal, or an engine that genuinely lacks the algorithm
stops failing by name.

---

## Why this is the same defect, and not merely a similar one

Reproduced 307095's own case verbatim — empty usages, which the spec requires to be
`SyntaxError` every time — on `mcr.microsoft.com/playwright:v1.62.0-noble`, 20 000 draws each,
on a bare page over `http://127.0.0.1` with no framework and no page scripts:

```
generateKey({name}, true, [])         Ed25519  SyntaxError 19844   OperationError 156  -> 0.78%
                                      X25519   SyntaxError 19930   OperationError  70  -> 0.35%
```

Three things follow.

1. **The rate is theirs.** 0.78% against the `0.8%` quoted in 307095 over 1055 runs, and against
   `1 − (255/256)² = 0.781%` predicted from the source reading. Independent reporter, different
   harness (WPT, not this project's specs), same number.
2. **X25519 is half, and that asymmetry is the signature of this cause specifically.**
   `gcryptGenerateX25519Keys` passes only `d` through the minimal-length conversion, so one
   component is filtered instead of two: `1 − 255/256 = 0.39%` predicted, 0.35% measured. A
   generic race, an initialisation fault, or entropy starvation predicts no such ratio. 307095
   reports both algorithms as flaky and does not note that one is half the other.
3. **It is not about usages.** The refusal happens on the draw, before the usages check; the same
   0.78% appears with `['sign','verify']` on the same build:

```
generateKey({name:'Ed25519'}, false, ['sign','verify'])   ok 19864   OperationError 136  -> 0.68%
```

Both probes are in this session's scratchpad; either is ~25 lines and needs only `playwright`
and the image.
