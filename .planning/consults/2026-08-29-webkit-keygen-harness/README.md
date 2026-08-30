# Harnesses for the WebKit Ed25519 key-generation defect

Every number in `../2026-08-29-webkit-linux-ed25519-keygen-rca.md` and in
[WebKit PR 72772](https://github.com/WebKit/WebKit/pull/72772) comes from one of these five
files. They are here so a reading can be re-taken rather than re-quoted.

## Browser level — is it the engine, and is it our code?

| File | What it settles |
|------|-----------------|
| `browser-probe.mjs` | The refusal happens with **zero** page scripts. Also prints what `generateKey` hands back on success: `typeof` `object`, constructor `CryptoKey`, not a byte array — so no key bytes cross into caller code at the moment of failure. |
| `browser-probe-empty-usages.mjs` | Reproduces [bug 307095](https://bugs.webkit.org/show_bug.cgi?id=307095)'s own case — `generateKey({name}, true, [])`, which the spec requires to be `SyntaxError` every time — and shows X25519 refusing at half the Ed25519 rate. |

```
cd <this directory>
ln -sfn <repo>/node_modules node_modules      # playwright, matching the image tag
docker run --rm -v "$PWD/browser-probe.mjs:/work/probe.mjs:ro" \
  -v "<repo>/node_modules:/work/node_modules:ro" -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  mcr.microsoft.com/playwright:v1.62.0-noble node /work/probe.mjs
```

Readings taken 2026-08-29 on `webkit-2336`:

```
browser-probe.mjs               scriptsOnPage 0   ok 19864   OperationError 136   -> 0.68%
browser-probe-empty-usages.mjs  Ed25519  SyntaxError 19844  OperationError 156    -> 0.78%
                                X25519   SyntaxError 19930  OperationError  70    -> 0.35%
```

## Library level — where exactly, and does the fix hold?

`bench.c` transliterates the two WebKit functions under investigation into C against real
libgcrypt: `GCryptUtilities.cpp`'s `mpiLength` / `mpiData` / `mpiZeroPrefixedData` and
`CryptoKeyOKPGCrypt.cpp`'s two generators plus its 32+32 length gate. Same calls, same
S-expression, same order, no WebKit.

```
docker run --rm -v "$PWD:/w" -w /w debian:bookworm sh -lc '
  apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    gcc libc6-dev libgcrypt20-dev libgpg-error-dev
  gcc -O2 -o bench bench.c $(libgcrypt-config --cflags --libs) && ./bench 20000'
```

```
libgcrypt 1.10.1
Ed25519  draws=20000  SHIPPING refused=160 (0.800%)  [q<32:76 d<32:84]
         survivors with first byte 0x00: q=0 d=0  ||  PATCHED refused=0 disagreements=0
X25519   draws=20000  SHIPPING refused=73  (0.365%)  [q<32:0  d<32:73]
         survivors with first byte 0x00: q=0 d=0  ||  PATCHED refused=0 disagreements=0
```

## Are the discarded keys actually valid?

`bench.c` alone would only show that the patched extraction agrees with itself. `collect.c`
prints 100 draws the shipping code **discards** and 100 it **keeps**, zero-prefixed to 32
bytes; `verify.mjs` hands them to `@noble/curves`, which implements RFC 8032 and has never
heard of libgcrypt, and asks it to derive the public half from the private one.

```
docker run --rm -v "$PWD:/w" -w /w debian:bookworm sh -lc '<same build> ; ./collect 100 100' > draws.txt
node verify.mjs
```

```
{ "tally": { "short": { "n": 100, "ok": 100 },
             "full":  { "n": 100, "ok": 100 } },
  "failureCount": 0 }
```

`full` is the control: had it disagreed, the comparison itself would have been wrong rather
than the patch. Both agree, so the bytes WebKit throws away are a correct key pair and
left-padding recovers it exactly.

## The import/export half — found on 2026-08-30, and worse than the generation half

Generation only ever *refuses*, and a refusal can be answered by drawing again. These two
probes cover the paths where nothing is drawn, so nothing can be redrawn.

| File | What it settles |
|------|-----------------|
| `browser-probe-import-export.mjs` | `importSpki` refuses a valid public key from another implementation, and `generateJwkX` loses the `x` field — both at 1 in 256, both WebKit-only. Runs all three engines side by side, with keys whose first byte is not `0x00` as the control. |
| `browser-probe-pkcs8-roundtrip.mjs` | The full persistence round trip: import a key, `exportKey('pkcs8')`, then read it back. **WebKit exports 20/20 and re-imports 0/20.** |

Both need Ed25519 keys whose leading byte is `0x00`, which this engine cannot generate — so
they are drawn with `@noble/curves` and brought in from outside.

```
browser-probe-import-export.mjs      webkit   spki import: DataError 20/20   (chromium/firefox: 20/20 ok)
browser-probe-pkcs8-roundtrip.mjs    webkit   export 20/20 ok, re-import DataError 20/20
                                     chromium 20/20 round-tripped   firefox 20/20 round-tripped
                                     controls pass on every engine
```

`roundtrip.c` replays that same asymmetry at the library boundary, so the reading does not
depend on a browser at all — seeds beginning `0x00`, n=2000:

```
libgcrypt 1.10.1
seed first byte 0x00, n=2000:  SHIPPING accepts 0     PATCHED accepts 2000  (bytes wrong: 0)
control seeds,      n=2000:  SHIPPING accepts 2000  PATCHED accepts 2000
```

## A check that came back negative, kept because negative is the answer

`asan.c` tests something that is *not* a defect, and is here so nobody has to re-derive that.
`mpiZeroPrefixedData` hands `gcry_mpi_print` a buffer bound of `targetLength` while the space
after the zero prefix is only `targetLength - prefixLength` — an overstated bound, in a helper
this fix makes three more call sites use. Driven under AddressSanitizer over every value length
0..32 including the all-zero MPI, with a heap buffer of exactly the target size:

```
libgcrypt 1.10.1
all-zero MPI: r=0 (length 0, pointer one past the end, nothing written)
cases=2112 refused=0 mismatch=0
no ASAN report — no byte was written outside the exact-size buffer
```

**Inert, and the reason it is inert is that `gcry_mpi_print` writes exactly `*length` bytes,
which is exactly the space that remains.** The bound is still wrong as written, and it is the
only thing between a future change in libgcrypt's behaviour and a heap overflow, which is why
it was raised with the reviewers rather than silently fixed inside an unrelated change.

## What none of these does

No WebKitGTK build was made, so the fix has not been observed end to end in a browser — only
at the library boundary where the defect lives, and semantically against an independent
implementation. WebKit's own EWS builds the GTK port and runs the web platform tests on the
pull request; that is where the end-to-end reading comes from.
