# 43 — criteria 1 and 2: the visitor's own key

The two items the orchestrator held. Criterion 3 is `43-KEYCHAIN.md`, criterion 4 is
`43-HOSTED.md`, criterion 5 is `43-ALLOWLIST.md`.

---

## Criterion 1 — a visitor who has not signed in cannot cause a key to be minted

### It was found by reading and then made to happen

The proposal recorded it as *"read from `demo/index.html:3020`, **not yet reproduced**"*, and
criterion 1 was written so it could not close until it had been. It was reproduced first:

```
× does not reach the control that mints a key while merely looking around   chromium
× does not reach the control that mints a key while merely looking around   firefox
× does not reach the control that mints a key while merely looking around   webkit
```

`42-07` let a visitor reveal `#main` without unlocking. `#enrol`'s visibility was
`enrolEl.hidden = offer.accepted` and consulted nothing about sign-in. So on an origin that
advertises an enrolment provider, the control whose handler calls `visitorKeyPair()` was
reachable **with no passphrase in existence to seal the result under** — the owner's rule
broken at its weakest point: not a key somebody forgot to encrypt, but a key created where
there is nothing to encrypt it with.

### Where the case is sited, and why that is the reason it stood

In `visitor-enrolment.e2e.test.ts`, not in `signin-journey.e2e.test.ts`. That file's fixture
serves an origin naming no provider, so `#enrol-offer` is hidden there for a reason unrelated
to sign-in, and a case sited there **would have passed throughout**. Recorded in the case's own
docblock so the next reader does not move it somewhere cheaper.

### Two claims, read separately

| claim | mechanism | plant | observed |
|---|---|---|---|
| the courtesy | the control follows sign-in | hiding removed | reachability arm reddens |
| the guarantee | `acceptEnrolment` itself refuses | `requireSignedIn()` removed | `expected 'DID NOT REFUSE' to be 'SignedOutError'` |

Both restored by the surgical inverse and verified `cmp`-identical. The case calls the API
directly for the second, and reads the **store** for the property both stand for — because a
surface that only hid a control is a protection one console call wide.

### A guard taught the shape of the fix, and it was right

`requireSignedIn()` was written as `requireSignIn()` first — the function that *returns the
passphrase* — and `T-42-27`'s assertion reddened:

> the held passphrase is obtained at more than one site in demo/main.ts, so this assertion can
> no longer say where it goes

That guard exists because this tab holds a passphrase it registered with **and** a certificate
a provider signed, and the threat is the first reaching the second. Putting the
passphrase-returning function into the enrolment path is precisely that threat. Enrolment does
not need the secret; it needs to know whether anybody is signed in. So the pair is now
`signedIn()` answering a boolean and `requireSignedIn()` handing back nothing.

`signedIn` rides on `TabEnrolmentOffer` rather than being threaded through four painter call
sites, because that object already carries what decides what the page renders about enrolment.

---

## Criterion 2 — the visitor's key is ciphertext at rest

### The irony that forced the shape

This key is the counter-example that produced the rule. `exportKey` refuses it — measured
again here — and its **whole PKCS#8** was found in a Chromium and a Firefox profile in the
clear.

Sealing it needs its bytes. A non-extractable key has none to give. **So the API meant to
protect this key is exactly what prevented us from protecting it, while not preventing anyone
holding the disk from reading it.**

The pair is therefore generated **extractable**, its private half sealed under the shipped
Argon2id + XChaCha20-Poly1305 envelope, and imported back **non-extractable**. The in-memory
property the old shape had is kept; the at-rest one is gained. `spki` is stored in the clear
on the certificate's own reasoning — a public key is published material.

### The migration that cannot happen, and why saying so matters

`42-02` and `42-03` migrated because their secret was bytes on a disk. This one has no bytes to
reach, so a pre-`AUTH-07` record is **deleted**. The cost is real: that browser becomes a
different operator, and any certificate naming the old key stops naming them.

Keeping it would be the rule broken on purpose. The two migrations look alike and are not, and
which is which is written at the code that does it.

### One source for the passphrase, and it is not a coincidence

A second persister would have been a second `requireSignIn()` call site, and `T-42-27` would
have been relaxed once per persister until it said nothing. The passphrase is obtained once
into `IdentityProtection` — the vocabulary both tiers already speak — and every persister takes
that object. The guard's property is **preserved rather than widened**.

### The plants

| plant | observed |
|---|---|
| the handle stored instead of the envelope | `user-key-sealed holds a key pair, which is the pre-AUTH-07 shape` |
| the legacy record left in place | `expected [ 'user-key-pair', 'user-key-sealed' ] to not include 'user-key-pair'` |

Both restored `cmp`-identical. The absence case **plants the pre-change shape and is shown
finding it first** — without that it would pass just as well on an empty store.

---

## Three consequences, none of them papered over

### 1. The disclosure guard went blind, and its plant then stayed green

`consent.test.ts` reads which sentence the disclosure owes a visitor off the arm this page
passes to `BrowserNode.start`. The indirection blinded it: it reported **neither** arm where
the page passes one, which reads as a finding about the page when it is a fact about the
reader. It now resolves one level of indirection.

**Then the plant through it stayed green**, and that is recorded rather than relied upon.
Switching the helper to return the other arm changed nothing: 72 of 72. Measured against
today's `DISCLOSURE`, the prose satisfies **both** arms' positive patterns —

```
keepsAKey/stored     true
keepsAKey/reused     true
keepsNoKey/fresh     true      ← on sentences about the PASSPHRASE, not the node key
keepsNoKey/forbidden false
```

So the **count** assertion carries that case and the branch does not. Not tightened here: what
each arm owes a visitor is a disclosure question (`BROW-09`'s family), the patterns would have
to be scoped to the line about the node key, and a wrong tightening is worse than a named gap.
Left with its measurement attached so whoever tightens it starts from a reading.

### 2. A public export lost its last caller — mine

`generateSubtleKeyPair` had one production caller and criterion 2 took it. The reachability
guard said so by name:

> these carry a global-object-hop disposition but do NOT become reachable when the hop is
> traced, so whatever keeps them unreachable is not that mechanism — the entry names the wrong
> cause

It was right. Moved to the register whose cause **is** true, and the deferral is now stated at
the function itself with the condition under which it should be deleted — two browser specs
need a non-extractable pair and cannot reach the module across a package boundary.

### 3. The cold-start race got dearer, and the budget moved rather than the KDF

Four racers each pay Argon2id; a loser pays twice — its own seal and the winner's envelope,
whose salt is its own, so no derived key is reusable across the two. Measured on a quiet host,
this file alone:

| engine | the race case |
|---|---|
| webkit | 1578 ms |
| chromium | 3227 ms |
| firefox | **5189 ms** |

Firefox exceeded the old 15 000 ms budget under a full three-engine lane — contention costs it
more than 3×. The budget is sited at roughly eleven times the quiet single-engine firefox
reading, with those numbers recorded beside it. **The cost is the point**: the memory-hard KDF
is what prices a guess against somebody holding the disk.

---

## What these two criteria do not cover

- **At-use.** Design §3.9's own limit, verbatim: *"Derivation moves the risk from at-rest to
  at-use — the enclave closes that gap."*
- **WebKit.** Neither algorithm's material was found in a WebKit profile. That is *not found
  by that search on that engine on that platform*, and it is not a reason to exempt anything.
- **The certificate.** Public material, and not a key.
