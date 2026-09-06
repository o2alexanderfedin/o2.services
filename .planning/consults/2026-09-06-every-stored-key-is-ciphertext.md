# Every stored key is ciphertext — a proposal

**Owner's rule, 2026-09-06:** *"Ключ в открытом виде не должен быть записан нигде. Или иначе:
сохраненный где бы то ни было ключ должен быть зашифрован всегда."*

Stated as this repository would check it: **every private key this system writes to any store,
on any tier, is written only as ciphertext. No artefact, no tier, and no API promise is an
exception.**

The last clause is the one this milestone paid for. `AUTH-06` excluded the visitor's owner key
because `exportKey` refuses it — an API promise read as an at-rest property — and the
measurement showed the whole PKCS#8 sitting on disk. A rule that admits "the platform says it
is safe" as an exception is the rule that already failed once here.

---

## 1. What the rule catches, measured today

| # | artefact | tier | today | under the rule |
|---|---|---|---|---|
| 1 | node identity seed | node | **sealed** (`42-02`) | — |
| 2 | node provider signing key | node | **sealed** (`42-02`) | — |
| 3 | browser node seed | browser | **sealed** (`42-03`) | — |
| 4 | browser provider seed | browser | **sealed** (`42-03`) | — |
| 5 | **visitor owner key** | browser | **in the clear — measured** | work item **A** |
| 6 | **hosted identity seed** | Durable Object | **in the clear** | work item **C** |
| 7 | **libp2p keychain contents** | node (AutoTLS) + hosted | **empty-password "encryption" — measured** | work item **B** |
| 8 | node certificate | all | in the clear, deliberately | **stays** — see §5 |

Items 5, 6 and 7 are the whole of the work. Nothing else in the tree writes key material: the
`writeFile` calls under `packages/node/src/` are `fs-issuance` (timestamps), `fs-blockstore`
(content-addressed blocks), `identity-store` (the sealed envelope and the certificate) and
`local-acme` (a CA *certificate*, public).

### 1.1 The new finding — the keychain's encryption is nominal

`@libp2p/keychain`'s own docs say a private key is *"stored as an encrypted PKCS 8 structure
… protected by a key generated from the key chain's pass phrase using PBKDF2."* The
implementation qualifies that (`node_modules/@libp2p/keychain/dist/src/keychain.js:101-103`):

```js
const dek = this.init.pass != null && this.init.dek?.salt != null
    ? pbkdf2(this.init.pass, this.init.dek?.salt, …)
    : '';
```

**With no `pass`, the derived encryption key is the empty string.** This repository constructs
`keychain()` with **no arguments** in both places it uses it — `packages/node/src/fabric-node.ts:2225`
and `packages/cloudflare/src/hosted-libp2p.ts:343` — so every key the keychain holds is
encrypted under a password everybody knows.

**CORRECTED 2026-09-06 — the trap as first written was false, and the correction is kept beside it because how it was got wrong is the useful part.** It read: ~~supplying a passphrase *alone* leaves the DEK empty and throws nothing~~. **It does not.** Sixteen lines above the ternary the constructor spreads `dek: { ...DEK_INIT, ...init.dek }`, and `DEK_INIT.salt` is a hardcoded non-null string — *"you should override this value with a crypto secure random number"* (`node_modules/@libp2p/keychain/dist/src/constants.js`). So `dek?.salt != null` is **always** true and the guard reduces to `pass != null`. Measured three ways against a reader that tries the empty DEK: no arguments **opens** the stored key, `pass` alone **refuses**, `pass` + salt **refuses**. **The error was reading one expression without reading the sixteen lines above it that fill in the value it tests** — the same shape as trusting a type instead of running it. **What survives unchanged is the defect**: with no `pass` the DEK is `''`, and this repository supplied none on either tier. **And the salt is still mandatory, for a different defect**: every deployment that leaves that default shares one PBKDF2 salt with every other. The two are pinned separately in the spec for exactly that reason — a case asserting only `DEK !== ''` cannot see the salt half at all.

What is actually in there: on the node tier the keychain exists **only under AutoTLS**
(`fabric-node.ts:2222` spreads it conditionally), and AutoTLS writes the Let's Encrypt account
and certificate keys into it. On the hosted tier it is unconditional, and that file's own
comment says it is *"required by anything that persists a key … the keychain reads and writes
`components.datastore`, which is this object's storage."*

---

## 2. One envelope, three key-sources — the mechanism follows the operator, not the artefact

The envelope is built, shipped and measured: `packages/core/src/sealed-secret.ts`, Argon2id +
XChaCha20-Poly1305, KDF parameters recorded beside the ciphertext so an identity stored today
still opens after the defaults are raised.

Nothing about it needs to change. What differs per tier is **where the sealing key comes
from**, and there are exactly three answers because there are exactly three kinds of operator:

| tier | who is present when the key is sealed | source |
|---|---|---|
| browser | a person at a keyboard | their passphrase — **shipped** (`42-04`) |
| node | an operator at a shell | `--identity-passphrase-file` — **shipped** (`42-02`) |
| hosted | **nobody, ever** | a platform secret the account holder sets — **new** |

Adding a fourth mechanism per artefact would be four things that can disagree about what
protects the same class of secret. `packages/libp2p/src/identity-protection.ts` exists to stop
exactly that, and it is the file any new artefact joins rather than routes around.

---

## 3. The work, in dependency order

### A. The visitor's owner key — and it needs nothing re-ordered

**This was the part I expected to be expensive and it is not.** Yesterday's note said sealing
this key might force the entry surface to move, because the key is minted before a visitor
registers. Measured, every call site is already behind enrolment:

- `demo/main.ts:724` — building the enrolment credential;
- `demo/main.ts:770` — building the capability signer, and it returns early unless
  `n.certificate !== null`, i.e. already enrolled;
- `demo/main.ts:1975` — inside `acceptEnrolment()`, i.e. the visitor pressed the control.

Enrolment lives inside `#main`. `#main` is revealed by unlock. So the passphrase already
exists everywhere this key is minted, and sealing it under the same envelope is a change to
`visitor-key.ts` and nothing else.

**Two shapes, and they differ less than they appear.** `wrapKey` refuses a key that is not
extractable, so **both** must generate the pair `extractable: true`, and both end with a
non-extractable handle after unlock. The only difference is one call: sealing raw bytes
materialises them as a JS value for the length of an `importKey`; `wrapKey`/`unwrapKey` does
not. And `crypto.subtle` has **no Argon2id** — measured in this milestone, only PBKDF2 and
HKDF — so the wrap route is Argon2id in JS anyway and only the AEAD moves.

**Recommended: seal the raw bytes with the shipped envelope.** One at-rest format across the
fabric instead of two, the same memory-hard KDF either way, and what the alternative buys is
the lifetime of one call against an attacker who by assumption holds a disk rather than runs
in the page.

#### A.1 One hole must close in the same change, and it was opened by `42-07`

`#enrol`'s visibility is `enrolEl.hidden = offer.accepted` (`demo/index.html:3020`). **Nothing
gates it on being signed in**, and `42-07` made `#main` reachable while looking around. On an
origin that offers enrolment, a visitor who is only looking around can therefore reach the
control whose handler mints this key — with no passphrase in existence to seal it under.

**Read from the source, not yet run.** It must be reproduced before it is trusted and before
it is fixed; the fixture in `signin-journey.e2e.test.ts` serves an origin that offers no
provider, which is why nothing caught it.

### B. The keychain

Supply `pass` **and** `dek.salt` — both, per §1.1 — derived from the sealed material the tier
already holds. On the node tier the passphrase is in hand at start. On the hosted tier this
waits on C, because there is nothing to derive from until C exists.

Note the floor: `@libp2p/keychain` throws on a `pass` shorter than 20 characters, the same
NIST SP 800-132 floor `identity-protection.ts` already quotes. The two agree by construction
rather than by coincidence, which is worth stating in the code that joins them.

### C. The hosted tier — and this is the one place the rule changes the threat model

Seal the Durable Object's seed under a Worker secret held in the platform's secret store.

**Said plainly, because it is the honest limit of the rule:** a Durable Object cannot keep a
secret from its own operator. What this buys is not secrecy from the account holder — it is
that the secret no longer sits *in the object's storage*, where a storage-level compromise, a
mis-scoped binding or a stray dump would expose it. The adversary moves from "whoever can read
this object's storage" to "whoever holds the Cloudflare account". Those are different
compromise domains and moving between them is the whole gain. Claiming more than that would be
the stronger mechanism's language over a weaker one — the failure this milestone's record
exists to prevent.

---

## 4. The instrument, without which this is a wish

A rule that lives only in prose decays the first time somebody adds a store.

Phase 42's criterion 1 already dumps the identity store and asserts specific bytes are absent.
**Generalise it into an allow-list**: one guard that walks every persistent store on every tier
and refuses any value that is not on a declared list of what that store may hold. A new store,
or a new value in an old one, is then a finding by default rather than a silence.

This is the shape `demo-regions.e2e.test.ts` already uses for figures on screen — declare it
or be flagged — and it works there for the same reason: the default answer to something nobody
declared is *no*, not *probably fine*.

**Two things the guard must have**, both learned expensively in this milestone. A **positive
control** in the same run — a value it is shown finding, or its absences prove nothing. And it
must never render bytes through `String`, which blinded an instrument here once already.

---

## 5. What the rule does not cover, stated so nobody widens it

- **The certificate.** It is public material — transmitted on the wire, published into DHT
  records — and encrypting the local copy would break the offline verification
  `verifyCertificate` performs while protecting nothing. The owner's rule says *ключ*; a
  certificate is not one. What a stored certificate leaks is the *fact of membership*, which
  is a real and different problem.
- **At-use.** Design §3.9's own limit, verbatim: *"Derivation moves the risk from at-rest to
  at-use — the enclave closes that gap."* Every item here closes at-rest. A key in use is in
  memory, and nothing proposed changes that.
- **The passphrase file on the node tier.** `--identity-passphrase-file` is a credential the
  operator places, not a key this system writes. It is out of the rule's wording, and saying
  so is not the same as saying it does not matter.
- **WebKit.** The measurement found no key material in a WebKit profile, for either algorithm.
  That is *not found by that search on that engine on that platform*, and it is not a reason
  to exempt WebKit from anything.
