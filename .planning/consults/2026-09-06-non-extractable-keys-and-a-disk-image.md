# A non-extractable WebCrypto key, and an image of the profile directory

**Measured 2026-09-06.** Phase 42-05 Task 2. **This changes no code.** Shape (a) — a random
seed sealed under an Argon2id-derived key — is already shipped on both tiers either way. What
this settles is whether this project can ever honestly describe a *device factor* / *second
factor* on the browser tier.

> **Two deviations from `42-05-PLAN.md`, both deliberate, both stated here rather than left to
> be discovered.**
>
> 1. **The filename.** The plan names this file with a `2026-09-04` prefix, which was the
>    plan's *writing* date. The measurement was taken on 2026-09-06 and this repository dates a
>    reading by when it was taken, so the file carries `2026-09-06`. The plan's automated
>    verify line still tests for the `09-04` name and will not find this file.
> 2. **Two constants, not one.** The plan says to store the plain positive-control record
>    holding `KNOWN_BYTES` — the same constant as the key's material. That makes any hit on
>    disk **unattributable**: one occurrence of one constant cannot be assigned to the plain
>    record or the key record. So the control uses its own distinct constant. The control's
>    purpose is unchanged — it proves this scan can find bytes written through this exact
>    storage path — and it transfers, because the scan is a generic byte-subsequence search to
>    which one 32-byte pattern is the same as another.

## The question, stated so it can fail

> Does a WebCrypto key created with `extractable: false` and stored in IndexedDB leave its raw
> key material recoverable in a browser profile directory on disk?

It fails if the bytes are there. Two things were **already certain and were not re-measured**:
`exportKey` throws on such a key, and another origin cannot open the database. Those defeat
script-level extraction and cross-origin copying, and neither is the question. The question is
whether a **full image of the profile directory** yields the bytes.

## The three constants

Written out so anyone can repeat the search. None is all-zeros, all-`0xff`, or an ASCII-looking
run; each is 32 bytes, so an accidental occurrence is not a live concern.

| name | bytes (hex) | role |
|---|---|---|
| `KNOWN` | `5c913ea70db64f28e17ac59036df821b6e4af3079d52c8b42f61ae08d73c95e2` | imported as HMAC-SHA-256 key material with `extractable: false`. **This is what the search hunts for.** |
| `CONTROL` | `a3075ec1489b2df6703ae51c84bd29f05b9641d80e73ac6f32b7e815ca9d6047` | put into the **same IndexedDB transaction** as a plain `Uint8Array`. **Positive control.** |
| `ABSENT` | `d46b1f8a25c9037eb05d96e47138afc20b846df159a73e20cb9742e61d8f35b8` | never written anywhere. **Negative control** — must yield zero hits, or the instrument invents matches. |

## The method

The key is **imported, not generated**, and that is the only reason the search is possible at
all: a generated key's material is unknown, so there would be nothing to look for.

1. A tiny Node http server serves one page on `http://127.0.0.1:<ephemeral>`. A `file://`
   origin was not used — IndexedDB is restricted there in some engines, and an absence in a
   restricted store would be the harness's absence, not the engine's. All three engines
   reported `isSecureContext: true` on the loopback origin.
2. In the page: `crypto.subtle.importKey('raw', KNOWN, { name: 'HMAC', hash: 'SHA-256' },
   false, ['sign'])`, then `exportKey('raw', key)` inside a `try`, and its refusal recorded
   verbatim.
3. One `readwrite` transaction puts **both** records — the `CryptoKey` handle under
   `nonextractable-hmac-key`, and `CONTROL` as a plain `Uint8Array` under
   `control-plain-bytes` — and the page awaits `tx.oncomplete` before returning, so an
   absence can never be an unflushed write. A second read-only transaction reads both back.
4. Driven with **`launchPersistentContext`**, so there is a real profile directory on disk to
   search. A default `browser.newContext()` is ephemeral and has no profile; using it would
   make every absence an absence in a directory nothing was written to. `context.close()` is
   awaited — a clean close, so buffered writes flush.
5. **A second visit in a fresh browser process on the same profile** reads the key back and
   signs with it. This is not decoration: if the signature matches, the key material
   demonstrably persisted *to that directory*, which turns any later absence in the byte scan
   into "stored in a form this scan cannot see" rather than "never stored at all".
6. The profile directory is then walked recursively — **every file, no extension filter**:
   LevelDB `.log`/`.ldb`/`MANIFEST`, SQLite `.sqlite`/`.sqlite3` and their `-wal`/`-shm`
   siblings, salts, caches, everything. Files are read as raw `Buffer`s in 8 MiB chunks with a
   31-byte overlap, and matched with `Buffer.indexOf` on a `Buffer` needle.
   **Nothing in the search path renders a byte through `String`** — this repository has a
   recorded instrument that was blinded exactly that way, rendering a `Uint8Array` as
   `255,15,66,…` and watching a plant stay green.

Driver, page and scanner live in the session scratchpad, not in the repository. `git status
--porcelain` is empty; nothing under `packages/` was touched.

### Platform and versions

| | |
|---|---|
| Platform | macOS 26.5.2 (build 25F84), Darwin 25.5.0, **arm64** |
| Driver | `playwright@1.62.0`, declared `^1.62.0` at the root `package.json`, driven **bare** |
| `@playwright/test` | **not installed** — `ls node_modules/@playwright` reports no such directory. Verified, not assumed. |
| Mode | `headless: true`, all three engines |

## The readings

### The positive control first — because if it is blind, nothing below it means anything

**`CONTROL` was found on all three engines**, each exactly once, in the engine's own IndexedDB
store. The instrument can see a plain byte array written through this storage path, in this
file format, by this scan code.

| engine | `CONTROL` | file, offset |
|---|---|---|
| Chromium | **FOUND ×1** | `Default/IndexedDB/http_127.0.0.1_<port>.indexeddb.leveldb/000003.log` @ 1091 |
| Firefox | **FOUND ×1** | `storage/default/http+++127.0.0.1+<port>/idb/…-ke-giam.sqlite` @ 24536 |
| WebKit | **FOUND ×1** | `IndexedDB/v1/http_127.0.0.1_<port>/<hash>/IndexedDB.sqlite3` @ 8160 |

**`ABSENT` was found on none of the three.** The scan does not invent matches.

**The search is not blind. Its verdicts below stand.**

### Then the key

| engine | version | UA | `KNOWN` on disk |
|---|---|---|---|
| **Chromium** | 151.0.7922.34 (Google Chrome for Testing, `channel: 'chromium'`) | `HeadlessChrome/151.0.0.0` | **FOUND ×1** — `Default/IndexedDB/http_127.0.0.1_<port>.indexeddb.leveldb/000003.log` @ offset **1531** |
| **Firefox** | 153.0 | `Gecko/20100101 Firefox/153.0` | **FOUND ×1** — `storage/default/http+++127.0.0.1+<port>/idb/…-ke-giam.sqlite` @ offset **24404** |
| **WebKit** | 26.5 (`AppleWebKit/605.1.15`) | `Version/26.5 Safari/605.1.15` | **NOT FOUND** by this search |

Chromium's hit is not ambiguous about what it is. The 32 bytes sit immediately after the
record's own name and a short structured-clone header:

```
000005be: 7400 7200 6100 6300 7400 6100 6200 6c00  t.r.a.c.t.a.b.l.
000005ce: 6500 2d00 6800 6d00 6100 6300 2d00 6b00  e.-.h.m.a.c.-.k.
000005de: 6500 793f 03ff 15fe 0000 0000 0000 0038  e.y?...........8
000005ee: 0000 0006 ff10 5c4b 0220 0608 205c 913e  ......\K. .. \.>
000005fe: a70d b64f 28e1 7ac5 9036 df82 1b6e 4af3  ...O(.z..6...nJ.
0000060e: 079d 52c8 b42f 61ae 08d7 3c95 e2a0 0000  ..R../a...<.....
```

`…-h-m-a-c--k-e-y` is the UTF-16 record name; `5c 91 3e a7 …` at `0x5fb` is `KNOWN`, entire and
in the clear.

### The key material persisted, on all three — including WebKit

Every engine was reopened in a **fresh browser process** on the same profile. On all three the
`CryptoKey` came back, was still `extractable === false`, still refused `exportKey`, and signed
the 8-byte sample `01 02 03 04 05 06 07 08` to the **identical**
`fdfedf2baf94ef0fcffaeece41dbf24ad5ed0a645c09f1cc554382a5fe4257ee`.

So on WebKit something sufficient to reconstruct a working key persisted under that directory.
**That is the measured claim, and it is deliberately weaker than "the material is in that
directory."** These instruments cannot separate *ciphertext of the material sitting in the
directory* from *an opaque handle in the directory whose counterpart sits in a machine-scoped
store* — an origin-keyed machine entry would survive a same-machine copy just as well. What is
settled is that "not found" is a statement about the scan, not a statement that nothing was
stored.

### Chromium: encryption at rest was switched on, and it does not cover this

The one live alternative explanation for finding key material in the clear on macOS is that
Playwright disabled encryption at rest: it injects **`--use-mock-keychain`** by default
(verified in `playwright-core`'s bundled argument list). That must be ruled out by measurement
rather than by argument.

The arm with the flag removed **could not be driven and is recorded as unmeasured**:
navigation timed out at 30 s in both headless and headed modes, and a direct spawn of the same
Chromium binary with no Playwright arguments at all never had its page report inside 60 s.
Three attempts, no reading.

So the question was settled a different way, **inside the same run**. The page also sets a
persistent cookie whose value is a distinctive ASCII marker. In the very profile where `KNOWN`
sits in the clear:

- the cookie marker is **not findable anywhere** in the profile, and
- `Default/Cookies` holds the row `127.0.0.1 | o2probe | value length 0 | encrypted_value 83
  bytes beginning X'763130'` — `76 31 30` is ASCII **`v10`**, Chromium's OSCrypt ciphertext
  prefix.

The cookie is in the profile and it is ciphertext. **Encryption at rest was active in that
profile, and IndexedDB is not inside it.** The plaintext key material is not an artefact of a
mocked keychain. Note this is a *different* control from the one that could not be driven, and
it is offered as that rather than as a substitute of equal strength.

### WebKit: not found in ten forms, and what is there instead

`KNOWN` was searched for in ten encodings, all **NOT FOUND**: raw, byte-reversed, base64,
base64url unpadded, hex lower, hex upper, UTF-16LE-expanded, first 16 bytes alone, last 16
bytes alone, first 8 bytes alone. In the same pass and the same file, `CONTROL` raw **and**
`CONTROL`'s first 16 bytes were both found — so the ten misses are misses, not a broken pass.

What occupies the record instead is a binary plist:

```
00001eb8: 6b00 6500 7900 0f00 0000 21c5 0000 0062  k.e.y.....!....b
00001ec8: 706c 6973 7430 30d4 0102 0304 0506 0708  plist00.........
00001ed8: 5c65 6e63 7279 7074 6564 4b65 795a 7772  \encryptedKeyZwr
00001ee8: 6170 7065 644b 454b 5374 6167 5776 6572  appedKEKStagWver
00001ef8: 7369 6f6e 4f10 348b feaf 824b 0f22 8856  sion O.4...
```

Four keys — `encryptedKey` (52 bytes), `wrappedKEK` (24 bytes), `tag` (16 bytes), `version`.
The serialized `CryptoKey` is stored wrapped, and the wrapped key-encryption key is stored
beside it. **Where the key that unwraps that KEK lives was not determined by this
measurement.** It is not `KNOWN`, so this scan would not have found it in any case.

### WebKit: a copy of the profile directory yielded a working key

A byte scan is one instrument for "does a profile image yield the key". A **replay of a copy of
the profile** is a second and stronger one, and it is closer to the threat as stated.

The WebKit profile was copied wholesale (`cp -R`) to a **different path**, and a fresh WebKit
process was pointed at the copy, serving the page on the same port so the origin matched. It
read the record back and signed the sample to
`fdfedf2baf94ef0fcffaeece41dbf24ad5ed0a645c09f1cc554382a5fe4257ee` — **identical**.

So on this engine, on this machine: the raw bytes were not recoverable by a byte search, and a
copy of the profile directory was nonetheless enough to *use* the key. The wrapping is not
bound to the profile's filesystem path. Whether the same copy would unwrap on a **different
machine** was not measured, and that is the difference between "the profile image is enough"
and "the profile image plus this machine is enough". This measurement does not distinguish
them.

### The exact text of the `exportKey` refusal

All three threw a `DOMException` named `InvalidAccessError`, at both write time and after the
process restart. The messages differ per engine:

| engine | `String(error)` |
|---|---|
| Chromium | `InvalidAccessError: Failed to execute 'exportKey' on 'SubtleCrypto': key is not extractable` |
| Firefox | `InvalidAccessError: A parameter or an operation is not supported by the underlying object` |
| WebKit | `InvalidAccessError: The CryptoKey is nonextractable` |

Firefox's message names neither `exportKey` nor extractability. Anything that matches on
message text rather than on `err.name` will misread it.

## What follows, and what does not

### What follows

- **On Chromium 151 and Firefox 153, on macOS 26.5.2 arm64, a key created with
  `extractable: false` does not survive a disk image.** Its raw material is in the profile
  directory, in the clear, in the engine's ordinary IndexedDB store, one byte search away — in
  Chromium's case adjacent to the record's own name.
- **Shape (b) — a non-extractable wrapping key with no passphrase — is disqualified for this
  threat by measurement rather than by argument.** It does not need to be argued down; it was
  run and the bytes were on disk.
- **Any future "two-factor" claim over a device factor of that kind would be the stronger
  mechanism's language applied to a weaker mechanism.** `extractable: false` is a guarantee
  about *script*, and it is a real one — `exportKey` threw on every engine, twice each. It is
  not a guarantee about *storage*, and describing it as a second factor would borrow the
  first's credibility for something that does not have it.
- **The claim `extractable: false` genuinely carries is narrower and worth keeping.** It
  defeats script-level extraction from within the origin and copying to another origin. Those
  were certain before this measurement and remain true. Nothing here argues for removing it
  from `visitor-key.ts`.

### What does not follow

- **The WebKit reading is "not found by this search, on this engine, on this platform."** It is
  three misses of one search, not a property of WebKit. It is not proof that the material is
  absent from the machine — the same profile, reopened, produced a working key twice.
- **No hardware backing is claimed here, on any engine, and none was measured.** No part of
  this measurement looked at, tested for, or could distinguish a hardware-held key from a
  software-held one. The WebKit record's `encryptedKey`/`wrappedKEK`/`tag` shows *that* the
  value is wrapped; it says nothing about where or how the unwrapping key is held, and this
  document draws no conclusion about that.
- **The search does not decrypt an OS-keychain-wrapped profile.** It reads bytes. A value
  encrypted with a key held anywhere outside the scanned directory is invisible to it by
  construction — which is exactly what the Chromium cookie row demonstrates in miniature.
- **This says nothing about iOS or Android.** Neither was run. A hardware keystore plausibly
  changes the answer on both, and those remain open questions rather than questions this
  answers.
- **These are Playwright's browser builds, not the shipping consumer browsers.** Chrome, Edge,
  release Firefox and Safari were not measured. This matters most for WebKit: the wrapping
  above is supplied by the *embedder*, and Safari is a different embedder from Playwright's
  WebKit. A Safari reading is not implied by the WebKit reading.
- **The Chromium arm without `--use-mock-keychain` is unmeasured**, named above with its
  blocker. The cookie control stands beside it, not in place of it.
- **`headless: true` throughout, and a plain-http loopback origin.** All three reported
  `isSecureContext: true`, but neither headed mode nor an https origin was measured.

## Still open

- Whether a WebKit profile copy unwraps on a **different machine**. That is the reading that
  would separate "the profile image is enough" from "the profile image plus this machine is
  enough", and it needs a second machine.
- iOS and Android, on any engine.
- Safari proper, as distinct from Playwright's WebKit build.

---

# The Ed25519 arm — added the same day, because the first arm measured the wrong algorithm

## Why this arm exists

Everything above used an **HMAC** key: raw symmetric material, imported with
`extractable: false`. That answers the question for that shape.

`packages/browser/src/visitor-key.ts` does not hold an HMAC key. It holds an **Ed25519
`CryptoKeyPair`**, generated by `@o2/core`'s `generateSubtleKeyPair`, stored as a handle in
IndexedDB. Reading the HMAC result onto it would be widening a measurement onto a case it did
not cover — a different algorithm, a different key type, a different serialisation path — and
this repository does not do that. So the actual algorithm was measured.

## Method — the same trick, and it is the same trick for the same reason

A **generated** key's bytes are unknown, so nothing could be searched for. A chosen 32-byte
`SEED` is wrapped in the fixed 16-byte PKCS#8 prefix for Ed25519 and imported with
`extractable: false`:

```
SEED   17c48b2e60d935fa410ea673bc289f54e37d10cb863fd26905b14e97a822fd3b
PKCS8  302e020100300506032b657004220420 || SEED   (48 bytes)
```

Stored **inside an object** — `{ privateKey: key }` — because that is the shape
`visitor-key.ts` stores, a pair rather than a bare handle. The public half is omitted: it
carries no secret and its presence cannot change whether the private half is serialised.

Two new controls, distinct from the HMAC arm's so a hit is attributable: `CONTROL` written as
a plain `Uint8Array` in the same transaction, and `ABSENT` never written at all. **Two
needles** are hunted rather than one — the bare `SEED` and the whole 48-byte `PKCS8` — because
finding the wrapper says something the bare scalar does not.

**The key is proved live before anything is concluded from it.** In every engine it imported
as `algorithm: 'Ed25519'` with `extractable === false`, refused `exportKey`, and **produced a
64-byte signature**. After the browser process was closed and relaunched on the same profile
it re-read as a `CryptoKey`, was still non-extractable, still refused `exportKey`, and **still
signed**. So this is a working non-extractable signing key, not a rejected import quietly
sitting in a store.

## The readings

Positive and negative controls first, as above.

| engine | `CONTROL` | `ABSENT` |
|---|---|---|
| Chromium 151.0.7922.34 | **FOUND ×1** @ 1557 | not found |
| Firefox 153.0 | **FOUND ×1** @ 24351 | not found |
| WebKit 26.5 | **FOUND ×1** @ 7863 | not found |

**The scan is sighted on all three and invents on none.** Then the key:

| engine | `exportKey` refusal | `SEED` on disk | `PKCS8` on disk |
|---|---|---|---|
| **Chromium 151.0.7922.34** | `InvalidAccessError: … key is not extractable` | **FOUND ×1** @ 1090 | **FOUND ×1** @ 1074 |
| **Firefox 153.0** | `InvalidAccessError: A parameter or an operation is not supported by the underlying object` | **FOUND ×1** @ 24502 | **FOUND ×1** @ 24486 |
| **WebKit 26.5** | `InvalidAccessError: The CryptoKey is nonextractable` | not found | not found |

Files walked: 172 / 8.5 MB (Chromium), 76 / 44.9 MB (Firefox), 9 / 266 KB (WebKit).

**Chromium and Firefox store the whole PKCS#8 wrapper**, not merely the scalar — the `PKCS8`
hit sits 16 bytes before the `SEED` hit in both, which is exactly the prefix length. The
private key is on disk in its standard interchange encoding, ready to import anywhere.

## What follows

**The Ed25519 answer is the HMAC answer.** A non-extractable key's private material is in the
clear in a Chromium or Firefox profile, for the algorithm this repository actually uses, in
the storage path it actually uses, in the object shape it actually uses.

**And this falsifies a premise `AUTH-06` rests on.** That row says the visitor's owner key is
out of scope because *"`visitor-key.ts` generates it non-extractable, `exportKey` fails on it,
and it is out of scope for that reason rather than by omission."* The first two clauses are
true and were re-confirmed here. **The inference from them is false**: `exportKey` failing does
not mean there is nothing at rest to encrypt. There is, and it is the whole private key.

## What does NOT follow

WebKit remains **not found by this search, on this engine, on this platform** — for the second
algorithm now, with a sighted instrument in the same run. That is not proof of hardware
backing and nothing here claims it.

This says nothing about a key generated *without* an import step. The method requires known
bytes and a generated key has none; whether `generateKey` takes a different storage path than
`importKey` is **unmeasured**, and a reader who assumes it does not has assumed rather than
measured. What can be said is that the import path is the one `visitor-key.ts`'s own restore
leg exercises on every visit after the first — a stored handle is re-read, not regenerated.
