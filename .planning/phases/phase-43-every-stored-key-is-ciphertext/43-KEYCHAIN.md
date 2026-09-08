# Phase 43, criterion 3 — the libp2p keychain derives a real DEK

**Date:** 2026-09-06 · **Requirement:** AUTH-07 · **Branch:** `feature/43-every-stored-key-is-ciphertext`

The criterion, verbatim: *"The libp2p keychain on both tiers that use it derives a real DEK —
`pass` AND `dek.salt`, both, since either alone leaves the empty string — and a test asserts
the derived DEK is not `''` rather than asserting the options object was passed, because the
options object was always passable and the defect is that it did nothing."*

---

## 1. The premise I was handed is HALF WRONG, and the half that is wrong is the parenthesis

I was told to verify rather than assume. I did, and one clause does not survive.

**What is true.** `keychain()` constructed with no arguments derives the empty string as its
encryption key, and this repository did exactly that in both places it uses one. Confirmed at
`node_modules/@libp2p/keychain/dist/src/keychain.js:101-103`.

**What is false.** *"since either alone leaves the empty string"* — supplying `pass` alone
does **not** leave the DEK empty. Two lines above the quoted ternary the constructor does:

```js
this.init = { ...init, dek: { ...DEK_INIT, ...init.dek } }
```

and `DEK_INIT.salt` (`dist/src/constants.js`) is a **non-null hardcoded default**: the literal
string `'you should override this value with a crypto secure random number'`. So
`this.init.dek?.salt != null` is **always true** and the guard reduces to `pass != null`.

**Measured, not read.** A key was written through a keychain built three ways, and each
artefact was then offered to a no-argument (empty-DEK) reader:

| keychain the artefact was written by | empty-DEK reader |
|---|---|
| no args — what this repo shipped | **OPENS** |
| `pass` only — "leaves the DEK empty" | **REFUSES** (`Encrypted key was not a libp2p-key or a PEM file`) |
| `pass` + explicit `dek.salt` | **REFUSES** |

The same refutation is reproduced *inside the suite*: under the salt-only plant (§5, plant 2)
arm A stays **green** while arm B goes red — i.e. the shipped code had a non-empty DEK and was
still wrong.

**The conclusion survives; the mechanism does not.** `dek.salt` is still mandatory, for a
different defect: left unset, every libp2p deployment on earth shares one PBKDF2 salt, so work
spent attacking one keychain is reusable against all of them. A salt exists to defeat exactly
that precomputation.

**This matters for the instrument, which is why it is written down rather than noted.** A test
that only asserts `DEK !== ''` — the criterion's literal wording — **cannot see the salt half
at all**. It would have passed on `keychain({ pass })`, which is a real defect. The spec
therefore pins the two properties separately, and it is the salt arm that the salt-only plant
reddens.

*Not propagated into `.planning/ROADMAP.md` or the proposal — those are the orchestrator's
documents and it is working the same phase block. Flagged here and in the report.*

---

## 2. What is actually in these keychains — measured, and it narrowed the work

Only **two** packages in the whole dependency tree write to a libp2p keychain:
`@ipshipyard/libp2p-auto-tls` and `@libp2p/webrtc`'s webRTC-Direct.

- **Node tier** — the keychain is spread only under `options.autoTls`, and this tier's
  transports are `tcp(), webSockets(), circuitRelayTransport()` (no webRTC at all). So the
  only writer is AutoTLS, and the only contents are its ACME account key and its certificate
  key — both of which `loadOrCreateKey` **recreates by design** when absent.
- **Hosted tier** — the keychain is unconditional but **nothing writes to it**: no AutoTLS, no
  webRTC. Pinned as a case rather than left as an argument (`hosted-keychain-dek.node.test.ts`
  asserts the store holds no `/pkcs8/` or `/info/` key after a boot), so that if a future
  writer appears the claim goes red instead of quietly becoming false.

---

## 3. What was built, and why — the seed, not the operator's passphrase

`packages/libp2p/src/keychain-protection.ts` derives **both** fields from the node's identity
seed by domain-separated HKDF-SHA256 (`crypto.subtle`, so it runs on Node and on workerd):

```
pass = hex(HKDF(seed, info = "o2/keychain/pass/v1"))   →  64 chars
salt = hex(HKDF(seed, info = "o2/keychain/salt/v1"))   →  64 chars
```

Three sources were available. **The seed is the only one with no hole in it.**

1. **The operator passphrase directly** would make the keychain a *downgrade* of the thing
   beside it. `sealed-secret.ts` seals the identity under Argon2id, deliberately memory-hard;
   the keychain's KDF is PBKDF2 at 10 000 iterations, nearly free to parallelise on a GPU.
   Handing the same string to both makes the cheap target an **oracle** for the expensive one:
   crack the keychain, open the identity envelope. The strong mechanism would protect nothing.
2. **A KDF over the operator passphrase** fixes that and not the hole beneath it.
   `IdentityProtection` has a second arm, `writes-no-new-secret`, which carries no passphrase
   at all — so that route rebuilds the empty DEK, silently, on exactly the deployment least
   likely to be watching.
3. **The seed** covers every path with no branch: unsealed from an envelope, adopted from a
   pre-existing plaintext file, or generated for one process.

**The property, stated as an inheritance rather than as a strength:** *the keychain is exactly
as protected as the identity seed it hangs off, on every path.* Under a passphrase it is
Argon2id-protected because reaching the seed is. Under `writes-no-new-secret` over an adopted
plaintext seed it is not protected against someone holding that directory — and neither is the
identity, which `#compose` already says out loud on stderr. **What is closed everywhere is the
empty string.**

**Floors hold by construction, not by hoping.** `@libp2p/keychain` throws below 20 characters
of `pass` and 16 of salt (NIST SP 800-132 — the same floor `identity-protection.ts` borrows,
so the two now agree by construction rather than by coincidence). Hex of 32 bytes is 64.

**`iterationCount` is deliberately left at the library's 10 000** and restated at the call site
rather than inherited. Iteration count prices a *guess*, and there is nothing to guess: the
PBKDF2 input is 256 bits of uniform randomness, not a password. Raising it to the OWASP figure
would cost start-up time and imply something false about the input.

---

## 4. The stale-entry regression — found by measurement, and it would not have been found by a fresh-directory test

Once the DEK is real, entries written under the empty one are undecryptable.
`@ipshipyard/libp2p-auto-tls`'s `loadOrCreateKey` (`dist/src/utils.js:13-26`) catches
`exportKey` and **rethrows anything whose `name` is not `NotFoundError`**. Measured by seeding
a store with an empty-DEK entry and calling the library's own function against a real-DEK
keychain:

```
RESULT: AutoTLS THREW  name=OperationError  message=The operation failed for an operation-specific reason
```

**A node with a pre-existing AutoTLS datastore would have failed to start.** No test over a
fresh directory could ever have seen it.

**Fixed by a sweep, and the entries are destroyed rather than migrated.** Re-encrypting them
under the new DEK was considered and rejected: an entry written under the empty DEK has sat on
disk as plaintext-equivalent key material, and under the owner's rule that key is burned. The
two things in there are recreatable by AutoTLS's own `NotFoundError` path, so removal hands the
library its designed behaviour rather than a workaround; and a migration would keep an
empty-DEK keychain constructor in production source forever, which is the exact artefact this
criterion exists to delete. **The one-time cost, stated rather than left to be discovered: one
new ACME account and one certificate reissue, on upgrade.**

Mechanically clean, measured: `listKeys()` reads the plaintext `/info/<name>` records and needs
no DEK, and `removeKey()` clears both `/info/` and `/pkcs8/` without one.

**Matched on the error `name`, never the message.** Two different texts were observed for the
same defect, keyed to the stored key type:

| stored key type | format written | observed failure text |
|---|---|---|
| RSA 2048 (AutoTLS's own) | `pkcs-8` | `OperationError: The operation failed for an operation-specific reason` |
| Ed25519 | `libp2p-key` | `InvalidParametersError: Encrypted key was not a libp2p-key or a PEM file` |

A message match would have caught one of the two.

### 4.1 A behaviour change this ships, named rather than discovered later

The DEK follows the seed, so **a node with a durable `datastore` but no durable identity now
destroys the previous start's AutoTLS keys and re-orders a certificate on every start** —
against a real CA that is rate-limit territory.

This is correct rather than regrettable: those entries belong to a *different identity* that
happened to share a store, and the alternative reintroduces the empty DEK. A node with a
`blockstoreDir` and a passphrase — the production shape — has a stable seed, a stable DEK, and
reuses its certificate exactly as before.

**The sweep's stderr line was corrected for this.** It first said the entries "were written
under the empty-password DEK", which the sweep cannot know: it only knows *unreadable under the
DEK derived from this node's seed*, and the `auto-tls` run proved the second cause is real. It
now names both causes.

---

## 5. The plants — four, all watched red, all restored `cmp`-clean

Every plant was inside my own files. A snapshot was taken immediately before each plant and
`cmp` verified byte-identity after the surgical inverse; all four returned `0`.

| # | file | plant | observed failure |
|---|---|---|---|
| 1 | `fabric-node.ts` | `keychain(keychainProtection)` → `keychain()` | arm A, line 213: `AssertionError: expected true not to be true` — the empty-DEK reader **opened** the artefact. Also reddened the sweep case. |
| 2 | `fabric-node.ts` | → `keychain({ pass: keychainProtection.pass })` | arm B, line 219: `AssertionError: expected true not to be true` — the **library-default-salt** reader opened it. Arm A stayed **green**, which is §1's refutation reproduced in the suite. |
| 3 | `fabric-node.ts` | sweep call replaced with `const swept: readonly string[] = []` | sweep case, line 282: `AssertionError: expected 'InvalidParametersError: Encrypted key…' to contain 'NotFoundError'` — the stale entry survives and produces the error class AutoTLS rethrows on. Reddened **alone**. |
| 4 | `hosted-libp2p.ts` | `keychain(await keychainProtectionFor(...))` → `keychain()` | line 105: `AssertionError: expected true not to be true` — the empty-DEK reader opened the hosted artefact. Reddened **alone**. |

### 5.1 The first pass of plants 1 and 4 exposed a blind instrument, and the spec was changed

Written with the positive control **first**, plants 1 and 4 both reddened *on the control* and
short-circuited — so arms A and B never evaluated and there was **no evidence they could fail
at all**. That is this repository's "a green plant means a blind instrument" in its subtler
form: the file went red, so nothing looked wrong, while two of the four arms were decorative.

The refusing arms were reordered **before** the control and both plants re-run. Only then did
arm A (plant 1) and arm B (plant 2) fire on the defect each names. The control stays, last,
because three refusals prove nothing on their own — an unwritten store refuses every reader.

---

## 6. The hosted tier — what is closed, and what is NOT, on criterion 4

The hosted keychain now derives its DEK from `init.identity.seed`. **A compiled-in constant was
rejected: that is the empty DEK with extra steps.**

**Closed:** a keychain entry that leaves the object — a mis-scoped query, a partial dump — is no
longer readable by anyone merely holding a copy of libp2p.

**NOT closed, and not claimed anywhere:** secrecy from someone who can read the object's
storage. `hosted-identity.ts` still writes the seed to `/identity/seed` **in the clear, in the
same storage as the ciphertext**, so against that adversary the gain is **nil**. Making the DEK
independent of stored material is **criterion 4** (sealing the seed under a platform secret) and
it is **not done here**.

The limit is asserted rather than commented: `hosted-keychain-dek.node.test.ts` carries a case
that deliberately proves the *weakness* — the stored `/identity/seed` still equals the live
seed — so it goes red when criterion 4 lands rather than rotting into a false comment.

**When criterion 4 lands, this line inherits it with no further change**, because the seed it
derives from will itself be ciphertext.

**§3.B of the proposal is superseded by measurement.** It says the hosted keychain *"waits on C,
because there is nothing to derive from until C exists."* There **is** something to derive from
— the seed exists today. What waits on C is the seed's *protection*, not its existence.

---

## 7. Verification

- `packages/node/src/keychain-dek.node.test.ts` — 3 cases. Quiet host.
- `packages/cloudflare/src/hosted-keychain-dek.node.test.ts` — 3 cases. Quiet host.
- `npx vitest run --project node` — **246 files, 3505 passed, 2 skipped, 0 failed**, exit `0`.
  (The banner reports the host oversubscribed by the run itself; nothing failed, so pass/fail
  stands and no duration from it is quoted.)
- `npx vitest run --project node packages/node/src/auto-tls.node.test.ts` — **7/7**, exit `0`,
  host quiet (load/core 0.53 → 0.56).
- **workerd HKDF discharged by running it.** `crypto.subtle.deriveBits({name:'HKDF'})` is not
  assumed to exist on workerd: `npx vitest run --project e2e
  packages/cloudflare/src/inbound-listener.e2e.test.ts` spawns real `wrangler dev`, and
  `worker.ts:427` → `createHostedFabric` → `createHostedLibp2p` now awaits that derivation
  before `createLibp2p` returns. **8/8 passed** with real libp2p peers connecting; had
  `deriveBits` been unsupported the promise would reject and no peer could have connected.

### Two specs outside the brief's file list reddened because of this change, and both were fixed at the cause

Named as scope extensions rather than left for discovery. Neither belongs to the orchestrator.

1. **`packages/node/src/auto-tls.node.test.ts`** — *"a restart reuses the stored certificate"*.
   Its `startRig` passes a `datastore` but no `blockstoreDir`, so each start minted a **fresh
   seed**: two different nodes sharing one store, not one node restarting. My sweep therefore
   destroyed the first identity's certificate key and a second certificate was ordered.
   Diagnosed by measurement, not plausibility — my own stderr line appears in the run:
   `removed 2 libp2p keychain entries (auto-tls-certificate-private-key,
   auto-tls-acme-account-private-key)`.
   **Fixed in the rig, not in the sweep**: the restart case now shares one identity directory
   across both starts. `blockstoreDir` **alone is not sufficient** — under the default
   `writes-no-new-secret` a node given a directory still mints a per-process identity that never
   touches disk, so it is paired with `identityProtection: { kind: 'passphrase', … }`.
   The case now asserts the **stronger** claim: the same node, with the same peer id, reuses its
   own certificate. Before this change the reuse held only because the DEK was the empty string
   on both starts — true for a reason nobody intended.
2. **`packages/node/src/trust-anchors.node.test.ts`** — the opt-out census, `expected 48 to be
   less than 48`. `keychain-dek.node.test.ts` names `runs-unsigned-artifacts` once, taking the
   population from 47 to 48. The file's own comment states the figure is *"a configuration
   choice, not a measurement"* and models the last raise (40 → 48); raised **48 → 56** with a
   dated note appended. The comment's claim of *"headroom of eight"* was describing 40, not 48 —
   there was one slot left, not eight; that is corrected in place.

## 8. Files

| file | change |
|---|---|
| `packages/libp2p/src/keychain-protection.ts` | **new** — the derivation, and the reasoning |
| `packages/libp2p/src/index.ts` | exports |
| `packages/node/src/fabric-node.ts` | derived DEK + `sweepUnreadableKeychain` |
| `packages/cloudflare/src/hosted-libp2p.ts` | derived DEK, with the criterion-4 limit stated |
| `packages/node/src/keychain-dek.node.test.ts` | **new** — the four-arm matrix and the sweep |
| `packages/cloudflare/src/hosted-keychain-dek.node.test.ts` | **new** — hosted arm, no-writers, the stated limit |
| `packages/node/src/auto-tls.node.test.ts` | rig: a restart shares an identity (§7) |
| `packages/node/src/trust-anchors.node.test.ts` | census bound 48 → 56 (§7) |
