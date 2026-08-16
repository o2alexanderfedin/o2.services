# The visitor device key is cryptographically available — measured, in three engines

**Measured 2026-08-16.** Task #21 (*let a visitor's tab hold an identity*) has had three
design rounds returned FIX-FIRST, and each argued about cryptography it had not run. This
file runs it. Nothing here is a design; it is a record of what the platform does, so the
fourth round argues about the part that is actually open.

## What was run

Two Playwright probes against a plain `http://127.0.0.1:<port>` origin — **no HTTPS, no
certificate** — driving chromium, firefox and webkit.

## Reading 1 — the key, and the property that matters

```
                isSecureContext  hasSubtle  generated  privateExtractable  exportRefused  sigBytes  verified  publicRawBytes
chromium             true          true       true          false             true          64       true         32
firefox              true          true       true          false             true          64       true         32
webkit               true          true       true          false             true          64       true         32
```

`crypto.subtle.generateKey({ name: 'Ed25519' }, /* extractable */ false, ['sign','verify'])`
succeeds in all three, and **`exportKey('pkcs8', privateKey)` is refused in all three**.
That refusal *is* the property: the private material is held by the browser outside
JavaScript's reach, so **the origin serving the page cannot read it** — which is the direct
answer to why round 1 (a passphrase in a box the origin renders) was rejected, and it is
measured here rather than assumed.

## Reading 2 — interop with the provider, which is the real risk

The enrolment provider verifies with `@noble/curves`. A signature produced by a key the
origin cannot read is worth nothing if the provider cannot check it. Signed in the browser,
verified in Node:

```
chromium  extractable=false  nobleVerifiesWebCryptoSignature=true
firefox   extractable=false  nobleVerifiesWebCryptoSignature=true
webkit    extractable=false  nobleVerifiesWebCryptoSignature=true
```

Both sides are RFC 8032, so this is unsurprising — and it is the kind of unsurprising thing
that is worth ten minutes to measure rather than assert, because the whole piece rests on it.

## Two corrections this forces, both against earlier statements in this repository

**1. `http://127.0.0.1` and `http://localhost` ARE secure contexts.** A device key therefore
needs no HTTPS to be *built or proved* — and the e2e harness already serves the demo from
exactly such an origin. The task-#24 HTTPS work is required for **a phone on the LAN**, and
for nothing else. Any statement that visitor identity is blocked on HTTPS is too broad.

**2. `seed-server.ts`'s section "Why this can be plain HTTP" is now incomplete twice over.**
It argues only that the kernel hashes in pure JS. That is true and insufficient: `kad-dht`
reached `crypto.subtle.digest` through `multiformats` and broke every LAN tab until
`589cf97`, and a non-extractable key cannot exist on a non-secure origin at all. The
distinction the file needs is between *what can be polyfilled* and *what cannot*.

## What cannot be polyfilled, stated so nobody tries

A non-extractable key **cannot** be shimmed on a non-secure origin. Any JavaScript
implementation holds the material in JavaScript memory, where the origin's own script can
read it — so a polyfill would supply the API shape without the property, which is strictly
worse than absence because it looks safe. `subtle-digest-fallback.ts` installs `digest` and
deliberately nothing else for the same family of reason.

## What was blocking — and what it cost to remove, **BUILT 2026-08-16**

`requestEnrollment` took `userPrivateKey: Uint8Array` and used it for exactly two things:
`ed25519.getPublicKey` and `ed25519.sign(challenge, …)`. A non-extractable `CryptoKey`
performs both happily and **can never produce those bytes**, so the enrolment API
structurally excluded the one key shape the owner's ruling permits.

That is now removed. `requestEnrollment(nodePrivateKey, user: UserSigner | Uint8Array,
fields)` is async; `subtleUserSigner` adapts a `CryptoKeyPair`, `seedUserSigner` is the
backbone's arm, and `BrowserNodeOptions`/`FabricNodeOptions` `enrollment.userPrivateKey`
takes `Uint8Array | CryptoKeyPair`. Landed as `61368d4` + `a37d647` on
`feature/enrolment-signer-port`.

```ts
interface UserSigner { readonly userKey: PublicKeyHex; sign(message: Uint8Array): Promise<Uint8Array> }
```

**The estimate above was right about the shape and wrong about nothing except the count** —
41 files, not 15, because helper fixtures cascade. Recorded because an estimate nobody
re-checks is a number that ages into folklore.

### Four things the tree said that the plan did not

Each was a guard reporting a real consequence, and each was fixed at its cause. They are
listed because they are the reusable part: *this* is what a change to a signing API costs
in *this* repository.

1. **CRYPTO-01.** `one-crypto-implementation.node.test.ts` reported `enrollment.ts` **by
   path** as a second file performing WebCrypto Ed25519 operations; exactly one is
   permitted. The `subtle.exportKey`/`subtle.sign` pair moved to `ed25519-backend.ts` as
   `subtleKeyPairSigner`. `enrollment.ts` keeps its "pure module, one stated exception"
   header — by re-measurement rather than by assertion.
2. **The reachability collision bound** read 17 against 16: two object-literal `sign`
   methods in one file. Not raised. Once the WebCrypto call moved out, that arm has nothing
   left to implement and delegates as a property, so the bound reads 16 with nothing
   renamed to please it.
3. **The enrolment-cost ratio, and this is the substantive one.** Verifying the `ownerProof`
   locally on **both** arms put one `ed25519.verify` into the attacker's mint, and
   `enrollment-dos.node.test.ts` priced it at once: *"expected 1.2203070223189196 to be
   greater than 1.5"*, down from a recorded 2.96–3.16. Those floors are lower bounds on an
   exposure this repository has **not** removed, so halving one by accident and restating it
   would have been moving a cost model sideways. The check now runs only where a *caller*
   supplied the pairing; on the seed arm the module derives the key itself, so the check
   could only fail if noble disagreed with noble. **Derivation and verification are
   alternatives, not a stack.**
4. **AUTH-04's caller-side guard changed shape and catches strictly more.** `userKey` used
   to be *derived*, making a stranger's key unspellable. A signer supplies its own public
   half, so the guarantee is a check — `UserKeyMismatchError` — which also catches a
   `CryptoKeyPair` whose halves came from two generations. Derivation never could.

### What is measured, and in which engines

`webcrypto-ed25519.browser.test.ts` gained a second block that runs the **production**
path: a non-extractable pair whose `exportKey('pkcs8', …)` is refused, through
`subtleUserSigner` → `requestEnrollment` → `EnrollmentAuthority.enrol` → `verifyCertificate`.
Green in chromium, firefox and webkit; `--project browser` reads **294/294 files, 5076/5076
tests**. The provider verifies with `@noble/curves` and has no idea WebCrypto exists, which
is the cross-implementation agreement the whole piece rested on.

## What this file does NOT establish

It says nothing about **where the key lives across sessions** (IndexedDB stores `CryptoKey`
handles structurally, unmeasured here), nothing about **whether accepting a certificate should
pin its issuer** — the objection that killed round 2, and the one genuinely open policy
question — and nothing about a UI. It established that the cryptography is available and that
the API, not the platform, was what stood in the way; the API has since been changed, and
those three remain exactly as open as they were.

**So task #21's remaining work is not cryptographic and never was after this file.** A tab can
hold a key it cannot read and get a certificate for it today. What is undecided is policy
(issuer pinning), persistence (does an IndexedDB-stored `CryptoKey` handle survive a session
— **unmeasured**), and presentation.
