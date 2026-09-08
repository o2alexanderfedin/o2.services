# 42-05 — SUMMARY: the record, and one measurement that disqualified a shape

The part of Phase 42 that is a record rather than a mechanism. Three tasks; **two of them
were already done when this plan came to be executed**, and saying so is part of the record.

## Task 3 — the owner's ordering ruling: ALREADY TAKEN, 2026-09-04

The plan holds this as a blocking checkpoint and it had been answered eleven days before it
ran. `.planning/ROADMAP.md`'s Phase 42 block carries it verbatim:

> **The ruling is: this phase runs BEFORE the public run.** Phase 39 does not begin until
> Phase 42 is done.

and the owner's own reason beside it — *"я предлагаю шифровать. тогда на презентации я смогу
показать еще и это"* — with the note that the engineering analysis recommended the opposite
and **was not refuted; it simply is not what decided.** A presentation is a use of this work
the ledger does not model.

The ROADMAP also records what the ruling does **not** do: it adds no eighth condition to
`RUN-01`'s seven. Phase 42 became a *dependency* of Phase 39, which is a different mechanism.

**This was reported to the owner as outstanding twice before it was checked.** The correction
is the point: a checkpoint is not open because a plan file says `gate="blocking"`; it is open
because the ruling is not written down. This one was.

## Task 1B — the ROADMAP's stale parenthetical: ALREADY CORRECTED by 42-02

Criterion 1 carries the amendment, dated, with the line that forced it
(`packages/node/src/fabric-node.ts:2438`) and the observation that the provider key is the
higher-value of the two secrets, being the trust root every certificate it ever issued
verifies against.

## Task 1A — the three shapes, weighed

On `AUTH-06`'s ledger row, with what each loser would have bought.

| shape | verdict | what it would have bought |
|---|---|---|
| **(a)** random seed sealed under an Argon2id key | **taken, both tiers** | — |
| **(b)** non-extractable wrapping key, no passphrase | rejected, and now **disqualified by measurement** | no prompt at all, so no conversion cost on the browser tier — against a cohort spendable once, not nothing |
| **(c)** derive the seed, store nothing | rejected on three properties | criterion 1 satisfied by *absence* rather than ciphertext — a strictly stronger reading than what shipped — and recovery after an eviction |

(c)'s three rejections are properties, not tastes: criterion 4 has nothing to fail against,
because a wrong passphrase derives a different **valid** identity; there is no rotation,
since a new passphrase is a new node and orphans its certificate; and the identity's entropy
becomes the passphrase's, reproducible from it on any machine.

**(c)'s two forgone benefits are recorded as a candidate, not discarded** — and the owner
raised the second on 2026-09-06, now § Open questions item 9. The trade is stated there: the
passphrase being worthless without the disk is **one** property read from two sides — it
defeats an imaged device and it forbids recovery — and no design gets both.

**And how design §3.9's "two keys, two jobs" split lands here**, because the design's answer
and this phase's are not the same. All three artefacts are on §3.9's **node-identity** side;
none is its user key, which is already correct at `visitor-key.ts:134` and excluded for that
reason. §3.9's node mechanism has no implementation on either tier — libp2p needs the raw
ed25519 bytes for Noise, and a tab has no OS keystore. So `AUTH-06` is **a substitute for
§3.9's hardware gate on tiers that have no hardware gate**: neither its user key, nor a
departure from its node key. §3.9's own limit is quoted rather than paraphrased —
*"Derivation moves the risk from at-rest to at-use — the enclave closes that gap."*

## Task 1C — the hosted tier, and a guard that taught the right shape

`packages/cloudflare/src/hosted-identity.ts` writes a raw 32-byte seed to `/identity/seed` in
a Durable Object's storage: the same exposure, a third tier.

Written first as an `AUTH-07` requirement row. **The pre-commit guard refused it:**

> `AUTH-07` is open in the ledger and no phase in the roadmap names it — it is not scheduled
> work, it is work nobody has anywhere to do

The guard is right, and it settles the form: an unscheduled concern is a **question**, not a
requirement. It is now § Open questions item 10, with `AUTH-07` named as the id it takes on
the day a phase exists to carry it. It is outside `AUTH-06` by that requirement's own wording
(*"on both the browser and the node tier"*), and the mechanism cannot be shared — there is no
operator at a keyboard inside a Durable Object, so the adversary is whoever holds an
**account**, not whoever holds a **disk**.

## Task 2 — measured, and it disqualifies shape (b)

`.planning/consults/2026-09-06-non-extractable-keys-and-a-disk-image.md`.

**The positive control first, because a blind instrument's absence is not a finding.** A
plain `Uint8Array` written in the same IndexedDB transaction was **found on all three
engines**; a fourth constant that was never written was **found on none**. The scan neither
misses nor invents.

| engine | `exportKey` | raw key bytes on disk |
|---|---|---|
| Chromium 151.0.7922.34 | refuses, `InvalidAccessError` | **FOUND in the clear**, offset 1531, immediately after the record's own UTF-16 name |
| Firefox 153.0 | refuses, `InvalidAccessError` | **FOUND in the clear**, offset 24404 |
| WebKit 26.5 | refuses, `InvalidAccessError` | **not found by this search** — the record holds a plist of `encryptedKey`/`wrappedKEK`/`tag` |

Refusal was confirmed at write **and again after a restart**, and Firefox's message names
neither `exportKey` nor extractability — so matching on message text misreads it.

**It is not a harness artefact.** A cookie set in the same Chromium profile is stored as
OSCrypt ciphertext beginning `v10` and its marker is unfindable — encryption at rest was
**active in the very profile where the key material was not**.

**The verdict.** On Chromium and Firefox a non-extractable key does not survive a disk image,
so shape (b) is disqualified for this threat **by measurement rather than by argument**, and
a *two-factor* claim over a device factor of that kind would be the stronger mechanism's
language over a weaker mechanism. WebKit is *not found by this search, on this engine, on
this platform* — **not** proof of hardware backing, and the consult contains no sentence
claiming it. A copied WebKit profile replayed at a different path produced an identical
signature, so the copied directory sufficed on this machine; whether it unwraps on a
different machine is named as open, as are iOS, Android and Safari proper.

## Two more stale present tenses, re-dated rather than rewritten

The ROADMAP's Phase 42 **Research** paragraph described a tree this phase has since changed —
`loadOrCreateSeed` and the four browser-store functions are **deleted**, Argon2id is
`packages/core/src/sealed-secret.ts` rather than a comment, and the open `@noble/hashes` vs
`@libp2p/keychain` question was settled for the former because `mint` must be **synchronous**
or the IndexedDB transaction commits under it. And `AUTH-06`'s ledger row still read *"nothing
encrypts anything at rest in this repository"* — corrected the previous day.

The plan checklist marks the six that shipped and adds `42-07`, which the owner added
mid-phase.

## One correction to this plan itself

`42-05-PLAN.md` named its consult `2026-09-04-…`, the plan's writing date. The measurement was
taken on 2026-09-06 and the file carries that date, because this repository dates a reading by
when it was taken. The plan's four references were updated to match rather than the file being
misdated.

## What `AUTH-06` still needs

Nothing from this plan. The box is the owner's to tick — every task here is done, and the
requirement's own words were measured in `42-01`…`42-04`.
