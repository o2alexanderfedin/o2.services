# RFC-0003 Response 05 — Operator identity, and what quorum diversity actually rests on

**Responds to:** the branch security review of 2026-09-15 (identification pass, then an
adversarial filter that reduced it to a pre-existing finding and dropped it from the
branch-scoped report as out of scope).
**Target:** `RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md` §14 (Threat Model)
and §15 (Security Invariants); in code, `packages/core/src/enrollment.ts` and
`packages/core/src/quorum.ts`.
**Status:** proposal. Nothing here is implemented. No file is edited by this document.

---

## How to read this

Every claim about *this system* is a quotation from a file in this repository, a constant
named by symbol, or a recorded measurement. Where a claim is a proposal it is labelled
**PROPOSED**. Where a question cannot be settled without a measurement that has not been
taken, the measurement is named in §10 rather than argued around.

Two conventions from `CLAUDE.md` govern the recommendations:

- **"Descoped is not satisfied; unmeasured is not met."**
- **A comment is not a specification.** Where a docblock and the code disagree, the code
  wins and the docblock gets fixed. §2 is exactly that case, and it is the load-bearing
  part of this document.

---

## §0. The defect, in one paragraph

The fabric's strongest integrity claim is `'independent'`: the same shard was computed by
two or more nodes run by **different operators**, and they agreed. The unit of that claim is
`NodeCertificate.operatorId` — `enrollment.ts:216` calls it *"Who runs the hardware. The unit
of quorum diversity."* That field is signed by the issuing provider, and its **value is
copied verbatim out of the applicant's own request** (`enrollment.ts:1356`,
`operatorId: request.operatorId`). The provider never derives it, never checks it, and has
nothing to check it against. So anyone who can reach any live provider can enrol N nodes
naming N different operators, fill a quorum with all of them, have them agree on a falsified
result, and receive a receipt that says independent operators concurred.

This is **not** introduced by the current branch — both `enrollment.ts` and `quorum.ts` are
byte-identical to `main` — which is why it was dropped from the branch review and is written
up here instead.

---

## §1. What the repository has today, measured

### 1.1 The certificate, and who signs it

`EnrollmentAuthority` is a third party, not the node. It holds `providerPrivateKey`
(`enrollment.ts:1013`, `:1114`), publishes the matching public key as the certificate's
`issuer` (`:1115`), and signs the payload with it. A node cannot sign its own certificate:
verification is against the provider's key, pinned in advance.

`NodeCertificate` (`enrollment.ts:211`) carries `nodeKey`, `userKey`, `operatorId`,
`discoverability`, `relayIds`, `issuedAt`, `expiresAt`, `issuer`, `signature`, and optionally
an X.509 form. All of it is under the provider's signature.

**Two distinct notions of "whose node it is" already exist, and the distinction is
deliberate.** `enrollment.ts:203-208`:

> `operatorId` is deliberately distinct from `ownerId`. An *owner* is whose data it is; an
> *operator* is who runs the machine. Quorum diversity is about operators — three nodes run
> by one operator are one failure domain and one attacker, however many owners' data they
> hold.

So the answer to "is the owner in the certificate?" is **yes, twice over**: `userKey` is the
account the node belongs to, and `operatorId` is who runs the hardware. Nothing needs adding
to the certificate's *shape*. What is missing is that one of those two fields is dictated by
the applicant instead of determined by the provider.

### 1.2 What the provider actually knows about an applicant

`EnrollmentRequest` (`enrollment.ts:492-516`) carries, among others:

| field | what backs it |
|---|---|
| `nodeKey` | `proofOfPossession` — applicant proved it holds the node key |
| `userKey` | `ownerProof` — applicant proved it holds the user key |
| `operatorId` | **nothing** |
| `relayIds` | nothing |

`enrollment.ts:71` states this outright: *"`operatorId` and `relayIds` are all
requester-chosen, and a fresh user key is one [keygen]"*.

`AuthorityOptions` (`enrollment.ts:1013-1053`) is `providerPrivateKey`, issuance budgets,
window and lifetime, issuance history, and a challenge TTL. **The provider has no notion of
an operator at all** — there is nothing in its configuration it could assign from.

### 1.3 How the quorum uses the field

`composeQuorum` (`quorum.ts:214`) keeps **one certificate per distinct `operatorId`**,
choosing deterministically (`:226-227`), and refuses with `insufficient-operators` (`:191`, raised at `:235`) if fewer
distinct operators than `size` remain. `classifyAttestation` (`quorum.ts:373-382`) is the
whole rule in six lines:

```
if (agreeing.length <= 1) return 'owner-attested'
const operators = new Set(agreeing.map((certificate) => certificate.operatorId))
if (operators.size >= 2) return 'independent'
return 'owner-domain'
```

`AttestationStrength` ranks `owner-attested` 0, `owner-domain` 1, `independent` 2
(`quorum.ts:124-135`). This is reached on the live job path:
`packages/core/src/job/submit.ts:2853-2859` calls `composeQuorum` whenever every candidate
carries a certificate and `spec.redundancy >= 2`.

**`issuer` appears zero times in `quorum.ts`.** Measured: `grep -c issuer` returns `0`. The
quorum does not know, and cannot currently express, which provider vouched for a member.

### 1.4 The honest client already derives its operator identity

`packages/browser/src/visitor-key.ts:298`:

```
export async function visitorOperatorId(keyPair: CryptoKeyPair): Promise<string> {
  const signer = await subtleUserSigner(keyPair)
  return `visitor:${signer.userKey.slice(0, 16)}`
}
```

and its docblock gives the reason, which is the same reason this document exists:

> `/bootstrap.json` would let whatever served the page decide how a visitor's node counts
> toward diversity — a page that was found rather than configured, configuring the fabric's
> view of whoever found it. **Derivation makes that unrepresentable: there is no parameter.**

The browser tier already refuses to let anyone *else* choose its operator identity. Nothing
stops a client that is not this one from choosing whatever it likes, because the check lives
on the wrong side of the wire.

---

## §2. Why the recorded mitigation does not cover this

`enrollment.ts:122` names a mitigation:

> …`composeQuorum` enforces anti-affinity by `operatorId` so N sybils under one operator take
> exactly one quorum slot.

That sentence is true and it answers a different attack. It covers an attacker who enrols N
nodes **under one operator name** — those collapse to one slot, exactly as claimed. It does
not cover an attacker who enrols N nodes under **N different operator names**, which costs
one extra string per request and is not checked anywhere.

The same header already concedes the premise fifty-one lines earlier (`:71`, quoted in §1.2).
So the two statements are not in contradiction; the mitigation is simply narrower than it
reads, and a reader who stops at `:122` will conclude the fabric is protected. **Fixing that
sentence is part of this proposal and is not optional** — a mitigation claim that overstates
its scope is worse than none, because it ends the search.

---

## §3. What the RFC itself is missing

RFC-0003 §14 lists twelve threats — stolen management keys, stolen device keys, malicious or
compromised relays, replay, man-in-the-middle, code substitution, malformed delegation,
policy downgrade, stale revocation, denial of service, valid-but-malicious signed code.
**Bulk identity minting by a single party does not appear.** `grep -niE "sybil|operator"`
over the whole RFC returns nothing.

§15's invariants are all about authority not increasing, chains not outliving their issuer,
and keys not moving between principals. **None of them says that two certificates naming
different operators were issued to different parties.**

This is the root gap. The code inherited a diversity rule the RFC never stated a threat for,
so nobody wrote down what the rule was supposed to resist.

---

## §4. The options, and what each does and does not fix

| | what it does | what it does NOT do | cost |
|---|---|---|---|
| **A. Provider derives `operatorId`** | Removes the free, silent rename: identical keys can no longer present as a different operator | Does not stop a new keypair. `enrollment.ts:71` — a fresh user key is one keygen | Small: one function, one call site, one refusal |
| **B. Quorum requires issuer diversity** | An attacker at one provider cannot fill a quorum however many identities they mint | Does not help if the attacker reaches several providers | Medium: new rule, new refusal kind, receipt field, call-site wiring |
| **C. Cost at the door** (proof-of-work, or invitation) | Makes identity genuinely expensive — the only option that attacks the root | Raises the barrier for honest visitors, which is the thing the current milestone is trying to lower | Large, and it is a product decision as much as a security one |

**Recommendation: A and B, shipped together. C deferred and recorded, not discarded.**

**AMENDED 2026-09-15 together with §5.4.** The table's row for A overstates it. Rotating user
keys is free and Phase 17 measured it (`enrollment.ts:71`), so A removes no attack an attacker
was paying for — it removes a *free rename* and replaces it with a *free re-keying*. Read the
row as "removes the field's ability to lie", not as a narrowing of the attack.

A alone is the dangerous outcome, and for a sharper reason than first written: it changes
nothing an attacker does, while leaving a mitigation claim that now *looks* better founded.
B alone leaves a field nobody validates carrying the weight of the strongest claim the system
makes. Together they say something defensible: *the fabric will call a result independent
only when separate providers vouched for the members, and no provider will let one applicant
wear two operator identities for free.*

---

## §5. PROPOSED — Design A: the provider determines the operator identity

### A.1 Rule

`EnrollmentAuthority` stops copying `request.operatorId` and computes the field from material
it has cryptographically verified. The only such material is `userKey`, which is covered by
`ownerProof`.

```
// PROPOSED — packages/core/src/enrollment.ts
function derivedOperatorId(userKey: PublicKeyHex): string {
  return `op:${userKey.slice(0, 16)}`
}
```

The certificate is then built with `operatorId: derivedOperatorId(request.userKey)` at
`enrollment.ts:1356`.

### A.2 What happens to the request field

`EnrollmentRequest.operatorId` becomes **an assertion the provider checks, not an input it
trusts**. Two candidate behaviours, and the choice matters:

- **A.2.i — refuse on mismatch.** If `request.operatorId` is present and differs from the
  derived value, refuse with a new `CertificateRefusal` arm, e.g.
  `{ kind: 'operator-id-not-derivable', supplied, derived }`. A client that thinks it is
  something the provider will not certify finds out at enrolment rather than discovering
  later that its identity was silently rewritten.
- **A.2.ii — ignore and overwrite.** Simpler, and wrong for this repository's stated
  conventions: it makes the certificate disagree with the request that produced it, silently.

**Take A.2.i.** It costs one refusal kind and keeps the invariant readable: *the certificate
says what the applicant asked for, or the applicant was told no.*

### A.3 Field-level consequences already visible in the code

- The X.509 cross-check at `enrollment.ts:1501` compares `operatorId` between the native
  envelope and the DER form. Both are built from `fields` in the same construction
  (`:1353-1372`), so a derived value flows into both and this check is unaffected.
- `packages/browser/src/visitor-key.ts:298` already derives `visitor:<userKey[0:16]>`. Either
  the provider's prefix matches the browser's, or the browser's clients begin failing A.2.i
  on their first enrolment. **The prefixes must be reconciled in the same change**, and the
  browser's existing spelling is the one to keep, because its docblock already records why
  derivation is correct and it is deployed.

### A.4 What A is worth on its own

**CORRECTED 2026-09-15, before this document was planned against, and the correction is
material.** This section read:

> Precisely this: the attack goes from *"send the same keys again with a different string"* to
> *"generate a new keypair per identity"*. That is a real narrowing and it is cheap.

The second sentence is **false against an attacker**, and this repository had already measured
why. `enrollment.ts:71`:

> …nothing in an enrolment request is scarce: `userKey`, `operatorId` and `relayIds` are all
> requester-chosen, and a fresh user key is one `ed25519.keygen()`. **Phase 17 measured that —
> twenty requests under twenty distinct user keys all succeeded, and deleting the per-user
> guard left the reading unchanged.**

So the "narrowing" A buys is from *free* to *free*: an attacker who must mint a keypair per
identity mints a keypair per identity, which Phase 17 clocked as costing nothing. **A is not a
security measure and must not be counted as one.**

What A is actually worth, stated without the inflation:

1. **The field stops lying about what it is.** `enrollment.ts:216` calls `operatorId` "the unit
   of quorum diversity". A field carrying that description while being dictated by the party it
   is supposed to characterise is a defect in the vocabulary whatever its exploit value.
2. **A serving origin cannot dictate it.** This is the browser tier's own stated concern
   (`visitor-key.ts:298`) and A is what makes that property hold for clients that are not the
   browser tier.

Both are worth having. Neither is a reason to relax anything, and the security weight of this
whole document rests on B.

---

## §6. PROPOSED — Design B: the quorum requires more than one issuer

### B.1 Rule

A quorum whose members were all vouched for by one provider does not carry `'independent'`.

```
// PROPOSED — packages/core/src/quorum.ts
export interface QuorumRules {
  // …existing: size, requireIndependentPaths, peerIdOf
  /**
   * Refuse a quorum whose members all carry certificates from one issuer. Defaults to true.
   *
   * A provider that mints identities on request is a single point of trust however many
   * operators its certificates name, so members drawn from one issuer are one attacker's
   * reach, not N independent ones.
   */
  readonly requireDistinctIssuers?: boolean
}

export type QuorumRefusal =
  // …existing
  | { readonly kind: 'single-issuer-quorum'; readonly issuer: PublicKeyHex }
```

Composition changes shape: today it takes one member per operator and then checks path
diversity. It must additionally spread across issuers. The construction that matches the
existing style — *"a property of the construction rather than a check bolted on after"*,
`quorum.ts:226` — is to group candidates by issuer and take round-robin across the
groups, so a member set drawn from two issuers is produced rather than merely accepted.

### B.2 `classifyAttestation` must move with it

`classifyAttestation` (`quorum.ts:373-382`) is reached from `attestationReceipt`
(`:396`) and takes only `agreeing: readonly NodeCertificate[]`, so it has the issuer
available and simply does not look at it. **PROPOSED:**

```
if (agreeing.length <= 1) return 'owner-attested'
const operators = new Set(agreeing.map((c) => c.operatorId))
const issuers = new Set(agreeing.map((c) => c.issuer))
if (operators.size >= 2 && issuers.size >= 2) return 'independent'
if (operators.size >= 2) return 'single-issuer'   // ← new rank, see B.3
return 'owner-domain'
```

### B.3 A new strength, rather than a demotion to `owner-domain`

`AttestationStrength` is `'owner-attested' | 'owner-domain' | 'independent'`
(`quorum.ts:124`) with ranks 0/1/2 (`:127-135`). Collapsing a many-operator single-issuer
quorum into `owner-domain` would be a lie in the other direction — those nodes are *not* one
owner's machines. **PROPOSED:** insert `'single-issuer'` between `owner-domain` and
`independent`, rank 2, and move `independent` to 3.

Every caller comparing by rank keeps working; `attestationRank`'s docblock already says
*"Exposed so callers compare by rank, not by string"* (`:126`), which is what makes this
insertion safe. Every caller comparing by **string literal** must be found and updated — that
sweep is part of the work, not a follow-up.

### B.4 The receipt must carry it

`AttestationReceipt` (`quorum.ts:385-393`) reports `operators`, `userKeys` and `sharedRelay`
but not issuers. **PROPOSED:** add `readonly issuers: readonly PublicKeyHex[]`, built the
same way `operators` is at `:402`. A receipt that a reader can act on must show the dimension
the strength now turns on, or the strength is unexplainable at the point it is read.

### B.5 The deployment consequence, stated plainly

**With one provider running, `requireDistinctIssuers` makes `'independent'` unreachable.**
That is the correct reading of today's deployment and it is the uncomfortable half of this
proposal: the fabric would stop claiming independence it cannot currently support. The
options are to run a second provider, or to accept `'single-issuer'` as the ceiling until one
exists. **This is the owner's decision and it is the reason this document exists rather than
a patch.**

---

## §7. What must be true before this is called done

Each of these is a case that must be watched failing before it is trusted — `CLAUDE.md`:
*"A proof that cannot fail is not a proof."*

1. An enrolment request whose `operatorId` does not derive from its `userKey` is refused, and
   the refusal names both values. (A.2.i)
2. Two enrolment requests with the **same** `userKey` and different requested operator names
   yield certificates with the **same** `operatorId`. This is the case that would have caught
   the defect, and no case in the tree asserts it today.
3. A browser visitor enrolling through the real client path is **not** refused — the prefix
   reconciliation of A.3 holds end to end.
4. `composeQuorum` over N candidates from one issuer refuses with `single-issuer-quorum`
   under the default rule, and composes when the rule is waived.
5. `classifyAttestation` returns `'single-issuer'` for many operators / one issuer, and
   `'independent'` only when both dimensions exceed one.
6. A mutation that reverts `operatorId` to the request's value turns case 2 red. A mutation
   that drops the issuer check turns case 4 red.
7. `attestationRank` ordering holds across the insertion, and no caller compares the strength
   by string literal. A grep-based guard over `packages/*/src` is the cheap form of this.

---

## §8. What this does not fix, named rather than left to be discovered

- **An attacker who reaches two providers.** B raises the bar from one provider to as many as
  the rule requires; it does not eliminate the attack. The honest statement of the resulting
  guarantee is *"independence is bounded by the number of providers an attacker must
  subvert"*, and that number is currently one, and would become two.
- **Providers colluding, or one operator running several providers.** Nothing in the
  certificate chain distinguishes two providers under one hand. Issuer diversity is a proxy
  for party diversity and should be written down as a proxy.
- **The cost of an identity.** A remains one keypair. Only option C touches this.
- **Sovereign data.** Unaffected by all of it — `PROJECT.md` already splits the claim, and an
  owner-pinned shard is `owner-attested` by construction, with no quorum to subvert.

---

## §9. Proposed additions to the RFC itself

**§14 Threat Model** — add:

> - bulk minting of distinct identities by one party, to occupy multiple slots in a
>   verification quorum.

**§15 Security Invariants** — add:

> - Two certificates naming different operators were issued to parties the issuer could
>   distinguish.

The second is deliberately phrased as what the issuer **could distinguish** rather than "were
issued to different parties", because the stronger sentence is not achievable without option
C and this repository does not write invariants it cannot hold.

---

## §10. Unresolved — named, not argued around

1. **How many providers will actually exist.** B's value is a function of this and nothing
   else. If the answer is permanently one, B is a relabelling exercise and C is the only real
   answer. Not a measurement — an owner decision, and the first one.
2. **How many live callers compare `AttestationStrength` by string rather than rank.**
   Grep-able, not yet grepped. It decides whether B.3 is an afternoon or a day.
3. **What an `operatorId` should be for a Node-tier operator running several machines
   deliberately.** A derived-from-`userKey` identity merges them if they share a user key and
   splits them if they do not, and which of those the operator wants is not something this
   document can settle. The Node tier accepts `--operator-id` today; A removes that freedom,
   and whether that is a regression for a legitimate multi-machine operator is **unmeasured**.
4. **Whether `relayIds` deserves the same treatment.** It is requester-chosen by the same
   sentence at `enrollment.ts:71`, and `composeQuorum`'s path-diversity rule reads it
   (the member ordering at `quorum.ts:246`, and `sharedRelay` at `:268`). A node that under-reports its relays makes a quorum look more
   path-diverse than it is. Same shape of defect, not examined here.
