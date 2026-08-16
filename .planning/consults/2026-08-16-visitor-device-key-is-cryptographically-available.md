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

## What is actually blocking, now that cryptography is not

`requestEnrollment` (`packages/core/src/enrollment.ts:398`) takes `userPrivateKey: Uint8Array`
and uses it for exactly two things — `ed25519.getPublicKey` at `:407` and
`ed25519.sign(challenge, …)` at `:417`. A non-extractable `CryptoKey` performs both happily
and **can never produce those bytes**. So the enrolment API structurally excludes the one key
shape the owner's ruling permits. Same at `BrowserNodeOptions.enrollment.userPrivateKey`.

**The next decomposed piece is therefore a signer port**, not a design:

```ts
interface UserSigner { readonly userKey: PublicKeyHex; sign(message: Uint8Array): Promise<Uint8Array> }
```

Its cost, measured so the next round budgets it rather than discovers it: **2 production call
sites** (`browser-node.ts:640`, `fabric-node.ts:1111`) but roughly **15 test files** call
`requestEnrollment(`, and WebCrypto signing is async, so the function must become async and
every caller must `await`. The additive alternative — a second exported function — is worse
here, because an export with no production caller is what `reachability-guard.node.test.ts`
reddens on, which is the same trap that has caught this work before.

## What this file does NOT establish

It says nothing about **where the key lives across sessions** (IndexedDB stores `CryptoKey`
handles structurally, unmeasured here), nothing about **whether accepting a certificate should
pin its issuer** — the objection that killed round 2, and the one genuinely open policy
question — and nothing about a UI. It establishes that the cryptography is available and that
the API, not the platform, is what stands in the way.
