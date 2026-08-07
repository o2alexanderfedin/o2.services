# RFC-0003 Response 01 — Trust anchoring, and revocation freshness

**Responds to:** `RFC-0003-REVIEW-praxis-2026-08-06.md`, points **1** and **2**.
**Target:** `RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md`, §2, §3.1, §7, §8, §9, §15, §17.
**Status:** proposal. Nothing here is implemented; nothing in the RFC is edited by this document.
Points 3 (AuthorityRule algebra) and 4 (execution envelope) are answered elsewhere.

---

## How to read this

Every claim about *this system* is either a quotation from a file in this repository, a
constant named by symbol, or a recorded measurement. Where a claim is a proposal it is
labelled **PROPOSED**. Where a question cannot be settled without a measurement that has
not been taken, the measurement is named in **§Unresolved** rather than argued around.

Two conventions from `CLAUDE.md` govern the recommendations:

- **"Descoped is not satisfied; unmeasured is not met."**
- **Cardinal rule: all nodes have equal functionality; only discovery differs.** Any policy
  keyed on what kind of node a peer is, is wrong by construction. This turns out to be the
  decisive argument in §2, not a side constraint.

---

## §0. What this repository already has

The RFC is written as though the system were greenfield. It is not. The relevant surfaces
exist and have been measured, and several of the review's questions already have a *de
facto* answer in code that the RFC does not record.

**First, a distinction the RFC does not draw and the code already does.** There are **two
independent pinning mechanisms**, pinning different sets for different decisions, and
conflating them is the easiest mistake to make when reading either:

| | `trustAnchors` | `trustedIssuers` |
|---|---|---|
| Pins | publishers of **signed name records** — artifact provenance | issuers of **node certificates** — admission and peer selection |
| Type | `readonly PublicKeyHex[] \| 'runs-unsigned-artifacts'` — **required, no default** | `readonly PublicKeyHex[]` — optional |
| Enforced by | `SignedNameResolver` + `guardModuleProvenance` | `verifyCertificate` + `PeerVerifier` + `relayAdmissionGate` |
| Empty | Not expressible. The opt-out is a **named literal**, never emptiness | Empty ⇒ the verifier does nothing. **Fail-open.** |

`fabric-node.ts` states it: *"**They pin different sets.**"* In RFC terms these are the
descendants of two different management certificates — `CM-Code` and `CM-Node` — under one
CR. **The codebase has already implemented §3.2's separation of management roles**, before
the RFC described it. Everything below applies to both unless it says otherwise.

| Surface | Symbol / file | Value or behaviour today |
|---|---|---|
| Build-authority anchor | `KERNEL_TRUST_ANCHOR`, `packages/demo/src/kernel-record.ts` | A compiled-in ed25519 public key, `'769c7b0d…'`. Shipped in the bundle beside the artifact it vouches for. |
| Anchors are immutable | `SignedNameResolver`, `packages/core/src/naming.ts` | *"The trust anchors are supplied at construction and cannot be added to afterwards."* **No rotation, no re-pin, no revocation at runtime.** |
| The opt-out is named, not empty | `FabricNodeOptions.trustAnchors` | `'runs-unsigned-artifacts'`. *"There is no exempt case […] a module is vouched for or it does not run."* (`module-provenance.ts`) |
| Revocation, as already decided | `packages/core/src/enrollment.ts` | *"Revocation is **non-renewal on the certificate's own clock**, not a list"* — and `packages/core/src/result-attestation.ts`: *"There is no revocation list here and there must not be one."* |
| Anchor override | `bin/agent.ts`, `bin/seed.ts` | `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]` — a supplied list **replaces** the default; it does not join it. |
| Browser anchor | `packages/browser/demo/main.ts` | `trustAnchors: options.trustAnchors ?? [KERNEL_TRUST_ANCHOR]` — same rule, same default. |
| Signed name record | `NameRecord`, `packages/core/src/naming.ts` | `{ name, cid, version, expiresAt, signer, signature }`. |
| Rollback refusal | `NameResolver.accept`, `packages/core/src/naming.ts` | Refuses `{ kind: 'rollback', name, have, offered }` when `record.version < existing.version`; refuses `{ kind: 'expired' }` when `record.expiresAt <= now`. |
| Node certificate | `NodeCertificate`, `packages/core/src/enrollment.ts` | `{ nodeKey, userKey, operatorId, discoverability, relayIds, issuedAt, expiresAt, issuer, signature }`. **No serial, no epoch, no revocation reference.** |
| Certificate failures | `CertificateFailure`, `packages/core/src/enrollment.ts` | `untrusted-issuer` \| `bad-signature` \| `expired` \| `not-yet-valid`. **There is no `revoked`.** |
| Certificate lifetime | `packages/core/src/enrollment.ts` | `this.#lifetimeMs = options.certificateLifetimeMs ?? 30 * 24 * 3_600_000` — **30 days**. |
| Issuance window | `DEFAULT_ISSUANCE_WINDOW_MS`, same file | `3_600_000` — 1 hour. |
| Admission gate | `denyInboundRelayReservation`, `packages/node/src/fabric-node.ts` | Consulted at every reservation **grant**, renewals included. |
| Reservation TTL | `RELAY_MAX_RESERVATION_TTL_MS`, `packages/libp2p/src/constants.ts` | `7_200_000` — **2 hours**. |
| Renewal floor | `packages/libp2p/src/relay-admission.ts` | `min(max(expiry - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)`, `REFRESH_TIMEOUT` **5 min**, `REFRESH_TIMEOUT_MIN` **30 s** — read off the installed package. |
| Re-ask floor | `DEFAULT_VERDICT_RETRY_FLOOR_MS`, `packages/node/src/peer-verifier.ts` | `5_000`. |
| RPC timeout | `DEFAULT_RPC_TIMEOUT_MS`, `packages/net/src/rpc.ts` | `30_000`. |
| Consent gaps | `ConsentGap`, `packages/browser/src/consent.ts` | `never-asked` \| `unreadable` \| `terms-changed`. |
| Disclosure version | `DISCLOSURE_VERSION`, `CONSENT_VERSION_NOTE`, `packages/browser/src/disclosure.ts` | `'1'`, `'first published disclosure'`. |

**What does not exist:** no CRL, no OCSP, no epoch object, no status object, no revocation
list, no `revoked` failure kind, and no `@libp2p/kad-dht`. Every mechanism §8 of the RFC
lists is prospective. The one that exists is **expiry**, and the one rollback defence that
exists is `NameResolver`'s monotonic `version`.

---

# Point 1 — CR is the anchor of a specific policy, not a trust anchor in general

## 1.1 The problem, restated precisely

RFC §2 says *"The CR is the application trust anchor."* RFC §1.7 says *"Verification is
local-first."* Together, and with no third statement, these license the following reasoning
in an implementer:

> The chain verifies against the CR ⇒ the CR is the trust anchor ⇒ therefore I may act.

The missing premise is *why this device holds this CR*. A self-signed CR is a
self-referential object: it proves that whoever holds its private key also signed the
chain. It proves nothing about whether *this* device should be running *this* application.
That premise is supplied by the channel through which the pin arrived, and by nothing else.

The precise defect in the RFC is therefore not that it is wrong, but that it **omits the
channel**, and the omission is invisible: a validator written strictly to §10's flowchart
is complete, correct, and still unsound, because step `F["Verify root trust binding"]` has
no defined input.

**Restated as a requirement:** the RFC must say that the anchor is never obtained through
the fabric, must enumerate the channels that can deliver it, must state what each channel's
guarantee actually is, and must bound the authority an anchor can carry by the guarantee of
the channel that delivered it.

## 1.2 The fact the RFC has not absorbed: the pin already ships inside the artifact

`packages/demo/src/kernel-record.ts` states the guarantee and — unusually — states its
limit in the same paragraph:

> "The anchor and the artifact it vouches for ship in the same bundle. That is what the
> guarantee rests on and also its exact limit: a peer cannot make this tab run a module the
> repository did not ship, and equally, none of this proves anything to somebody who does
> not already trust the repository."

That sentence is the honest form of "CR is the trust anchor", and it should be promoted
into the RFC almost verbatim. It says three things the RFC does not:

1. The anchor's strength equals the delivery channel's strength, not the key's strength.
2. The anchor defends against **peers**, which is a real and useful property.
3. It defends against **the publisher** not at all.

## 1.3 Where a client first obtains the CR pin

Enumerated for the three deployments this system actually has, plus two channels that will
be reached for and must be refused.

| # | Channel | What physically delivers the pin | What it genuinely guarantees | What it does not |
|---|---|---|---|---|
| C1 | **Browser tab, HTTPS page load** | A constant compiled into the bundle (`KERNEL_TRUST_ANCHOR` today) | Exactly what the Web Origin plus Web PKI guarantee for *this* fetch: the bytes came from a party holding a CA-issued certificate for that DNS name; with HSTS, that no downgrade occurred | Anything across loads. A later load from the same origin may carry a different pin, **and the code that would notice arrived from the same place.** |
| C2 | **Node agent, compiled-in default** | The installed package | Whatever the install path guaranteed — an `npm ci` against a committed lockfile binds the tarball by integrity hash; a git checkout binds by commit | Anything about the publisher's intent at any *later* version. The pin is as fresh as the last install. |
| C3 | **Node agent, `--trust-anchor <hex>`** | A human, out of band | **Independence from the software distribution path.** This is the only channel with that property, and it is the only one whose compromise is not implied by compromise of the delivery of the code | Nothing automatically. It is exactly as good as how the operator obtained the hex, which the system cannot see. |
| C4 | **Embedded host application** | The host's own signed distribution (app store signature, MDM profile, enterprise packaging) | The host platform's code-signing guarantee, which is typically the strongest available on that device | Nothing if the host itself is compromised — the embedded agent is inside the host's trust boundary, not beside it. |
| C5 | **Enrolment provider** | — | **Nothing.** Enrolment distributes *leaves*. `verifyCertificate` requires `trustedIssuers` to be known already, and refuses `{ kind: 'untrusted-issuer' }` otherwise. An enrolment response can never teach a node a new anchor. | — |
| C6 | **A peer over the fabric** | — | **Nothing, and this MUST be refused.** A peer may present a certificate; it may never present an anchor. | — |

**The load-bearing conclusion:** *every* channel that can deliver a CR pin is outside the
fabric. That is the sentence the RFC is missing, and it is stronger than the reviewer's
framing — it is not merely that "an explicit local policy is needed", it is that **the
anchor is definitionally exogenous**, and any design that lets the fabric supply it has
made the anchor circular.

### 1.3.1 The corollary for the browser tier, which is uncomfortable and true

For C1, the pin, the verifier, and the code that would display a warning all arrive in the
same response. An origin that turns hostile replaces all three atomically. Therefore:

> **For a browser tab, anchor pinning is a tripwire against an origin that changed its
> publisher. It is not a defence against an origin that turned hostile.**

This is the Certificate Transparency insight applied honestly: the achievable property is
*detection*, not *prevention*, and detection only works if the record of what was accepted
survives outside the thing being checked. It is why §1.5 below recommends an append-only
local anchor journal rather than a stronger prompt, and why "certificate transparency"
should move out of RFC §18 *Future Extensions* and into §17 *Open Design Questions* — it is
not an enhancement, it is the only mechanism that closes C1.

## 1.4 Is TOFU permitted, and under what bound?

**Recommendation: no, and the reason is not caution — it is that TOFU is strictly worse than
every channel it would replace.**

TOFU is the correct answer when there is no prior anchor at all. In this system there is
always one:

- C1 has the Web PKI, already consulted, already enforced by the browser before a single
  byte of application code ran;
- C2 has the registry/lockfile integrity chain;
- C4 has platform code-signing.

Adopting TOFU in any of those three would mean *discarding* an anchor that the platform
already established for free, and replacing it with a weaker one. There is no deployment in
this system where TOFU is an improvement.

**C3 is not TOFU and should not be described as such.** An operator typing
`--trust-anchor 769c7b…` is making a first-use trust decision, but the decision is made by
a party holding out-of-band knowledge the software does not have. Call this
**operator-asserted anchoring**. The distinction matters because SSH's known-hosts failure
mode is precisely that the *software* asks a user to ratify a key the user cannot evaluate;
C3 inverts that — the operator supplies the key, and the software never asks.

### The bound, for a deployment that insists on TOFU anyway

If a future deployment has genuinely no channel (an air-gapped LAN bootstrap, say), TOFU is
admissible under three conjoined bounds. **The third is the one that matters and is novel to
this RFC:**

1. **Recorded, not remembered.** The anchor is written to an append-only journal on first
   use, with `issuedAt` and the channel it came from. A journal, not a variable, because
   the value of the record is that a *later* substitution is detectable.
2. **Change is a stop, not a prompt.** Any subsequent differing anchor halts the node. See
   §1.5 for the one recoverable override.
3. **The bootstrap attenuates.** *An anchor obtained through channel C may authorize at
   most what C itself could authorize.* This is RFC §5's delegation rule
   (`effective authority = intersection(authority of every certificate in the chain)`)
   applied to the bootstrap edge, where the RFC currently stops applying it. Concretely: a
   pin delivered by an HTTPS page load may authorize workloads for that origin and nothing
   else; it may not authorize relay registration on a relay the operator configured, and it
   may not authorize a `CM-Recovery` operation. A TOFU'd anchor, whose channel guarantees
   nothing, therefore authorizes nothing that a fresh, unauthenticated peer could not
   already do.

Bound 3 converts "may we TOFU?" from a yes/no into a capacity question, which is the same
shape as the rest of the RFC and does not need a new mechanism.

## 1.5 What the UI says when the CR changes

The demo already has a consent surface with a specific and deliberate idiom, and the anchor
change should be built inside it rather than beside it.

**The idiom, from `packages/browser/src/consent.ts`:** gaps are *named* rather than
collapsed to a boolean, and the rationale is given —

> "'you never asked me' and 'the terms changed since you asked me' are different things to
> tell a visitor, and only the second deserves an explanation of what changed."

**From `packages/browser/src/disclosure.ts`:** the terms are data, not markup, so that
three things cannot drift; the version *is* the mechanism (`DISCLOSURE_VERSION`,
`CONSENT_VERSION_NOTE = 'first published disclosure'`); the copy is "written to be read by
someone deciding, not by someone already convinced"; and the affirmative control is
`'Allow this page to use my processor'`, never `"OK"`, never `"Got it"`.

**PROPOSED — a fourth `ConsentGap` member, same shape as `terms-changed`:**

```ts
| {
    readonly kind: 'anchor-changed'
    readonly answered: PublicKeyHex   // the anchor the stored consent was given against
    readonly current: PublicKeyHex    // the anchor this load presents
  }
```

It invalidates a stored consent for exactly the reason `terms-changed` does: the visitor
agreed to run code vouched for by *that* key, and a different key is a different program.
The stored `ConsentRecord` gains one field, `anchoredTo: PublicKeyHex`, and the existing
`parse()` rule applies unchanged — a record missing it collapses to `null`, which shows the
gate, which is the safe direction the file already argues for.

**PROPOSED copy**, in the `DisclosureLine` question/answer form:

> **This page is now signed by a different key. It has not run anything.**
>
> **What changed?** — The code this page runs is vouched for by a signing key. The key it
> presents today is not the one you agreed to. That can be a routine key change by the same
> publisher, or it can be somebody else serving this page.
>
> **Can this page tell which?** — No. The key and the check that compares it arrived in the
> same download, so anyone who could change one could change the other. This notice is
> evidence that something changed; it is not evidence about who changed it.
>
> **What should I do?** — Compare the two keys below against the key published at
> `<out-of-band location>`. If the new one matches what is published there, this is a
> routine change. If it does not, close this tab.
>
> *Key you agreed to* — `769c 7b0d 9c10 ceaf …`
> *Key presented now* — `…`
>
> affirm: **"I have compared the keys and the new one is correct"**
> decline: **"No"**

Four properties of that copy, each with a reason:

- **The default is refusal and nothing starts.** The node is not built; no relay is dialled.
  This is the existing gate's posture, not a new one.
- **The affirmative label states the act performed**, not assent. `"I have compared the keys"`
  is falsifiable by the person clicking it; `"Continue"` is not. The published research on
  key-change warnings is consistently that users click through them; the design response is
  not a scarier prompt, it is to make the *default* safe and the override *specific*.
- **The second line admits the limit.** A UI that implies the application can adjudicate its
  own key change is lying, and the codebase's existing copy does not lie anywhere else.
- **No auto-dismiss, no timeout, no pre-tick.** `DISCLOSURE.reporting` is already "Off unless
  you turn it on"; same rule.

**And the override must exist.** HPKP was removed from browsers because a pin that cannot be
recovered from is an outage that publishers cannot fix and attackers can inflict. A pin with
no recovery path is a denial-of-service primitive. Accepting the new anchor writes a new
consent record and a new journal entry; it does not silently forget the old one.

### For the Node and embedded tiers

No prompt is possible and none should be invented. **PROPOSED:** a differing anchor is a
startup failure with a named exit reason, printing both keys and the channel each came from.
An operator running `--trust-anchor` explicitly is not a change — the flag *is* the decision.
What must fail is a *default* anchor that differs from the journal, because that means the
installed package changed underneath a node that did not ask for it.

## 1.6 How multiple roots conflict

The codebase has already ruled on this, for build authorities, and the ruling is *replace*:

> "A supplied list **replaces** this rather than joining it, and the replacement is
> deliberate: a harness pinning its own key is running its own build, and silently leaving
> the demo key pinned would make its test prove less than it appears to."
> — `packages/browser/demo/main.ts`

**PROPOSED — generalise it into two rules that answer two different questions.**

**Rule A — across channels: precedence, and the winner replaces.** The anchor set is supplied
by exactly one channel: the most specific one present.

| Precedence | Channel | Replaces everything below |
|---|---|---|
| 1 (highest) | Explicit runtime parameter — `--trust-anchor`, `trustAnchors:` | yes |
| 2 | Host application supplied | yes |
| 3 (lowest) | Compiled-in default | — |

Never a union across levels. A union would mean an operator who pins their own key still
trusts the shipped one, which is the failure the quoted comment names.

**Rule B — within the accepted set: refusal, not precedence.** If two anchors in the accepted
set give contradictory answers to the same question — two `NameRecord`s for one `name` at
different CIDs, two certificates for one `nodeKey` with different authority — the verifier
**refuses**. It does not pick.

Three reasons, and the first is the strongest:

1. **Precedence makes the effective policy an attacker's choice.** With precedence, an
   attacker needs to compromise the *weakest* anchor in the set and win an ordering race.
   With refusal, they must compromise *all* of them, and compromising one buys only denial.
2. It is what RFC §10 already demands: *"The validator must reject on ambiguity."*
3. Evaluation order stops being load-bearing, so two nodes given the same set cannot disagree.
   (This requires the set be canonicalised — sorted hex, deduplicated. `payloadOf` in
   `enrollment.ts` already sorts `relayIds` for the same reason.)

**Rule C — rotation is not a conflict.** RFC §7's transition period, in which "the old CR
cross-signs or otherwise authenticates the new CR", produces *one* root with two keys, not
two roots. Distinguish structurally: if anchor *A* carries a signature over anchor *B*, then
*B* is reachable *through* A and is a chain, not a peer. Only anchors with no such link
between them are subject to Rule B.

## 1.7 Prior art — what transfers

The organising observation, which is worth stating before the table because it decides which
items survive:

> **Every mechanism that survives the loss of an always-online authority does so by replacing
> *"ask someone whether this is current"* with *"check that this extends what I already
> held."*** Pre-rotation, TUF's version monotonicity, Merkle consistency proofs and SSH
> continuity are all the same move. Every mechanism that does not survive — CT's SCT, OCSP,
> CRLite's certificate universe, Rekor's integrated time — requires a party who is
> authoritative *right now*.

| Prior art | Transfers? | What exactly |
|---|---|---|
| **Web Origin + Web PKI** ([RFC 6454](https://datatracker.ietf.org/doc/html/rfc6454); the same binding WebAuthn uses for RP ID) | **Fully, browser tier only — and it is the strongest single argument here** | A browser peer has no bootstrap problem in the sense the rest of this table assumes: it *already performed a CA-anchored authentication before one line of fabric code ran*. RFC 6454 is explicit that the scheme is what carries this — *"Including the scheme in the origin tuple is essential for security […] without this isolation, an active network attacker could corrupt content retrieved from `http://example.com` and have that content instruct the user agent to compromise […] `https://example.com`."* Three limits to state and not overstate: it anchors **the first fetch, not the relationship** (a long-lived tab or cached PWA runs on a pin as stale as its bundle); it does **not** cover the Node tier; and it makes the origin a single point of compromise for new joiners — which argues for pinning the *root* in the bundle and doing everything downstream by pre-rotation, not for re-fetching trust continuously. |
| **SSH `StrictHostKeyChecking=accept-new` + `UpdateHostKeys`** | **Fully — and this is the pattern to name** | Not "TOFU" generically. `accept-new` is documented as *"will automatically add new host keys […] but will not permit connections to hosts with changed host keys"* — pin on first sight, **hard-fail on change**. `UpdateHostKeys` (on by default) then lets an *already-authenticated* server publish successor keys in band. That is TOFU-native rollover, and it is what makes the change warning mean something. SSHFP ([RFC 4255](https://datatracker.ietf.org/doc/html/rfc4255)) is the honest counterpoint: an out-of-band anchor only *relocates* the trust problem — *"A public key verified using this method MUST NOT be trusted if the SSHFP RR used for verification was not authenticated by a trusted SIG RR."* For this system the out-of-band channel is the origin and the package registry, not DNSSEC. |
| **Signal safety numbers, and the key-change-warning literature** | **Mechanism yes; reliance on the human, no — the numbers forbid it** | Signal's own split is the right template: *"If a verified safety number changes, sending a new message to that contact always requires manual approval"*, while an unverified contact gets a non-blocking notice. But the evidence on whether users act is decisive against depending on it. Vaziripour et al. (SOUPS 2017, 36 pairs) measured unprompted ceremony completion at **14%**, rising to 79% only after participants were told to look, and reported that *"our data is inconclusive on whether users make the connection between this ceremony and the security guarantees it brings."* Schröder et al. studied Signal with **28 computer scientists**: four clicked through the warning, eight could not find the ceremony, **7 of 28 succeeded**. Tan et al. (CHI 2017, 661 participants) found the best fingerprint rendering still admitted attacks **6%** of the time and the worst **72%**. **Design consequence:** refusal must be the default and comparison the exception (§1.5) — and because most pairings here are software-to-software, this system can make the strong behaviour the default, which is an advantage over Signal's position rather than a limitation. |
| **HPKP ([RFC 7469](https://datatracker.ietf.org/doc/rfc7469/))** | As the **primary design risk**, not a footnote | Chrome's deprecation rationale names all three failures this proposal must avoid: *"site operators face difficulties selecting a reliable set of keys to pin to"*; *"There is a risk of hostile pinning, should an attacker obtain a misissued certificate"*; *"Unexpected or spurious pinning errors can result in error fatigue rather than user safety."* Adoption at deprecation was **375 of the top million sites** (plus 76 report-only). RFC 7469 *already mandated* backup pins — *"UAs MUST require that hosts set a Backup Pin"* — and it was still not enough, because operators lost them. **Therefore succession must be mandatory and automatic, not operator discipline.** Its successor Expect-CT was itself removed in Chrome 107. The only pinning that survived is **static pinning compiled into the browser binary** — i.e. distributed out of band by a trusted publisher on a slow channel. That is exactly C1/C2 here, and it means **the release cadence is the rollover floor**. |
| **KERI pre-rotation** ([spec](https://trustoverip.github.io/kswg-keri-specification/); [did:webvh](https://didwebvh.info/latest/implementers-guide/prerotation-keys/)) | **Fully, and it is the specific mechanism for §7** | Each key event commits to the *digests* of the next key set; a rotation must reveal keys matching that prior commitment and be signed by the currently-valid keys. So *"control over an identifier can be re-established by rotating to a one-time use set of unexposed but pre-committed rotation keypairs"*, and because they stay unexposed *"their attack surface could be optimally minimized."* It needs **no CA, no log, no quorum and no clock** — a peer offline for a month can still verify the chain from the anchor it holds. It simultaneously fixes HPKP's bricking and the Signal fatigue problem, because planned rotation becomes pre-authorised and silent while unplanned change stays loud. **Two caveats to record:** it gives *authorized succession*, not *recency* — a peer shown a valid but truncated chain cannot tell it is behind, which is TUF's freeze attack; and a *forked* chain (two valid rotations from one point) is answered in KERI by witnesses on a first-seen rule, so duplicity is **detectable when peers gossip, not prevented**. |
| **Certificate Transparency** | **Consistency proofs yes; the log, no** | CT needs highly available logs (Apple's program caps MMD at 24 h; Chrome requires ≥99% availability on a 90-day rolling average), monitors reading the whole log, and a gossip layer that *was never deployed* — which is why RFC 9162 concedes *"it is necessary to treat each log as a trusted third party."* Note the RFCs specify **no MMD value at all**: RFC 9162 says it *"deliberately does not specify any limits on the value to allow for experimentation."* What genuinely transfers is the **Merkle consistency proof** — the one primitive here that lets an offline-capable peer verify *"the view you show me is an append-only extension of the view I held last time"* with no third party. That composes with a version high-water mark, works pairwise, and is the right shape for the §1.5 anchor journal. **Do not call the journal "certificate transparency."** |
| **TUF root role / threshold-signed root** | Partially | The threshold idea is already RFC §18. What transfers now is the rotation discipline: a new root is authenticated by the old and clients walk the chain rather than jumping. |
| **DID methods** | Weakly, except `did:webvh` | DID Core defines vocabulary and explicitly no rotation mechanism. `did:key` **cannot rotate at all** — the identifier is derived from the key. `did:web` reduces to the HTTPS origin, i.e. to C1, with no rollback protection. `did:ion` anchors to Bitcoin, out of scope. Only `did:webvh` — `did:web` plus a hash-chained log plus pre-rotation — is a useful analogue, and its contribution is the pre-rotation row above. |

## 1.8 RECOMMENDATION (Point 1)

1. **Rename the concept in the RFC.** "Trust anchor" becomes **"policy anchor"** wherever it
   refers to the CR, and §2 gains the exogeneity statement.
2. **Add an anchor-provenance table** (§1.3) as normative RFC text, with the per-channel
   guarantee and its limit.
3. **Forbid TOFU for the CR**, on the ground that no deployment lacks a stronger channel;
   admit it only under the three bounds of §1.4, of which bound 3 (**the bootstrap
   attenuates**) is the operative one.
4. **Anchor changes are a consent event**, expressed as a fourth `ConsentGap` kind in the
   existing surface, with the copy in §1.5, defaulting to refusal, with a recoverable
   one-shot override.
5. **Precedence across channels (replace); refusal within the set (never pick).**
6. **Add pre-rotation to §7** — a `nextKeyCommitment` field.
7. **Move "certificate transparency" from §18 Future Extensions to §17 Open Questions**, and
   record that for the browser tier it is not an enhancement but the only mechanism that
   closes C1.

### What this costs

- **One field in the stored consent record** (`anchoredTo`) and one gap kind. The existing
  `parse()` semantics mean an old record without the field shows the gate — a one-time
  re-consent for every existing visitor, which is exactly what a `DISCLOSURE_VERSION` bump
  already does and is therefore not a new class of cost.
- **A journal.** In the browser it lives in IndexedDB, which `CLAUDE.md` records as "evicted
  silently under pressure", so its durability is soft. A wiped journal reads as
  `never-asked`, which shows the gate — the failure direction is safe, but the *detection*
  property is lost, silently. This is a real cost, not a rounding error.
- **A support burden on rotation.** Every legitimate publisher key change now shows every
  visitor a dialog. Rotation stops being invisible. That is the point, and it is also the
  reason HPKP died; the mitigation is that the override is recoverable and one-shot.
- **`--trust-anchor` semantics do not change.** Rule A codifies what `bin/agent.ts` and
  `bin/seed.ts` already do, so the Node tier costs nothing.
- **Rule B costs availability.** Two anchors that disagree now produce a refusal where a
  precedence rule would have produced an answer. This is deliberate and is priced as a
  denial-of-service surface: an attacker who can inject one contradictory record into an
  accepted anchor's namespace can stop that name resolving. Mitigated only by the fact that
  getting a record into the accepted set already requires a trusted signer.

## 1.9 RFC text to paste (Point 1)

> ### 2.1 The CR is a policy anchor, and the policy is exogenous
>
> The CR is the anchor of a **specific local policy**: *this device runs code and honours
> authority vouched for by this key.* It is not a general statement of trustworthiness, and
> a valid chain is never on its own a reason to act.
>
> **The anchor is never obtained through the fabric.** A peer may present a certificate; a
> peer may never present an anchor. An enrolment provider distributes leaves, not anchors —
> a verifier that does not already hold the issuer's key MUST refuse the certificate as
> `untrusted-issuer` rather than learn the issuer from it. Every channel capable of
> delivering an anchor is outside the fabric, and the anchor's strength is the channel's
> strength, not the key's.
>
> #### 2.1.1 Anchor provenance
>
> | Channel | Delivered by | Guarantee | Limit |
> |---|---|---|---|
> | Browser page load | A constant in the served bundle | The Web Origin and Web PKI guarantees for that fetch; with HSTS, no downgrade | None across loads. The pin, the verifier and the warning arrive together, so a hostile origin replaces all three atomically. |
> | Installed package, default anchor | The install path | Package integrity: lockfile digest, registry transport, or a signed commit | Says nothing about any later published version. |
> | Operator-supplied anchor | A human, out of band | **Independence from the code distribution path.** The only channel with this property. | Exactly as good as how the operator obtained it. The system cannot see that. |
> | Host application | The host's signed distribution | The host platform's code-signing guarantee | Nothing if the host is compromised; the agent is inside the host's boundary. |
> | Enrolment provider | — | **None.** Distributes leaves only. | — |
> | A peer | — | **None. MUST be refused.** | — |
>
> #### 2.1.2 First use
>
> Trust-on-first-use is **NOT permitted** for a CR in any deployment where the delivering
> channel carries an anchor of its own — which is every deployment defined by this
> specification. An operator supplying an anchor out of band is not TOFU; the trust decision
> is made by a party with knowledge the software does not have.
>
> Where a future deployment genuinely has no channel, TOFU is admissible only if all three
> hold:
>
> 1. the anchor is written to an **append-only journal** on first use, recording the anchor,
>    the time, and the channel;
> 2. any later differing anchor **halts** the operation — a stop, not a prompt, save for the
>    single recoverable override of §2.1.3;
> 3. **the bootstrap attenuates.** An anchor obtained through channel *C* may authorize at
>    most what *C* could itself authorize. A TOFU'd anchor, whose channel guarantees nothing,
>    therefore authorizes nothing beyond what an unauthenticated peer already may do. This is
>    §5's attenuation rule applied to the bootstrap edge.
>
> #### 2.1.3 Anchor change
>
> An anchor change is a **consent event**, not a warning. Default is refusal; nothing starts.
>
> A conforming interactive client MUST: name the change as a change and not as an error;
> display the previously accepted anchor and the presented anchor in a comparable rendering;
> **state that the client cannot itself determine which is legitimate**, because the anchor
> and the code that compares it arrived through the same channel; label the affirmative
> control with the act performed (*"I have compared the keys and the new one is correct"*)
> and never with assent (*"OK"*, *"Continue"*); and offer refusal as an equally prominent,
> always-present control.
>
> The override MUST be recoverable and one-shot: accepting records the new anchor and appends
> to the journal; it does not erase the previous entry. A pin with no recovery path is a
> denial-of-service primitive against the publisher, not a security control.
>
> A non-interactive client (agent, embedded host) MUST fail to start, naming both anchors and
> the channel each arrived through. An explicitly supplied anchor is not a change; the supply
> is the decision.
>
> #### 2.1.4 Multiple anchors
>
> **Across channels — precedence, and the winner replaces.** The anchor set is supplied by
> the most specific channel present: explicit runtime parameter, then host application, then
> compiled-in default. A supplied set **replaces** every lower level; it never joins it.
> Joining would mean an operator who pinned their own key still trusts the shipped one.
>
> **Within the accepted set — refusal, not precedence.** If two anchors that are not linked
> by a rotation signature give contradictory answers to the same question, the verifier MUST
> refuse rather than select. Precedence would let an attacker compromise the weakest anchor
> and win an ordering race; refusal makes single-anchor compromise a denial rather than an
> escalation, and it is what §10's "reject on ambiguity" already requires. The accepted set
> MUST be canonicalised — sorted, deduplicated — so that two verifiers given the same set
> cannot disagree by evaluation order.
>
> **Rotation is not a conflict.** Where anchor *A* carries a signature over anchor *B*, *B*
> is reachable through *A* and forms a chain, not a competing root. Only mutually unlinked
> anchors are subject to the refusal rule.
>
> #### 7.1 Pre-rotation
>
> A CR SHOULD carry `nextKeyCommitment = SHA-256(next public key)`. A rotation is accepted
> only if the new key hashes to the commitment already published in the certificate being
> replaced. An attacker holding a stolen CR private key can then rotate only to the key
> already committed — which they do not hold — so theft of the current root key does not
> confer the ability to install a root of the attacker's choosing.

## 1.10 UNRESOLVED (Point 1)

- **The browser tier's C1 hole is not closed by anything proposed here.** An origin that
  turns hostile serves a new anchor, a new verifier and a new journal reader in one
  response. The journal detects a change only for a client that kept it; a hostile origin
  can serve code that does not look. **Only an external observer closes this**, and this
  system has none. Recording it as an Open Question is the honest move; claiming the journal
  fixes it is not.
- **Journal durability in the browser is unmeasured.** `CLAUDE.md` records that IndexedDB is
  "evicted silently under storage pressure". **Measurement needed:** the eviction rate of a
  small IndexedDB record under this workload, across the browsers in the `@vitest/browser`
  matrix, over a session length representative of a volunteer tab. Until that exists, no
  claim about detection coverage may be made.
- **The out-of-band publication location for key comparison does not exist.** §1.5's copy
  says "published at `<out-of-band location>`". Choosing it is a deployment decision with a
  security consequence (if it is the same origin, the comparison is worthless), and it is
  unmade.
- **Whether `KERNEL_TRUST_ANCHOR`'s "private half discarded on every run" discipline can
  survive pre-rotation is unexamined.** `sign-kernel.ts` "generates a new ed25519 key on
  every run and discards the private half immediately". Pre-rotation requires holding a
  *next* key across a rotation, which is a different key-handling regime. Not resolved here.
- **There is no rotation surface at all today, and §1.9's §7.1 text presumes one.**
  `SignedNameResolver` states: *"The trust anchors are supplied at construction and cannot be
  added to afterwards."* Immutable after construction means **no rotation, no re-pin, and no
  anchor revocation at runtime** — a process must be restarted to change what it trusts. Every
  proposal in §1.5 and §1.6 about *change* is therefore proposed against a surface that does
  not exist; only the *initial supply* path exists. Naming this is the difference between a
  gap and a claim, and it is a gap.
- **Whether an anchor journal belongs in `@o2/core` or per-tier is undecided**, and it is not
  a cosmetic question: `peer-verifier.ts` records that a comparable move was found impossible
  after being called "a barrel change with no code change", and that "browser-tier
  verification is still UNMEASURED" for exactly this packaging reason.

---

# Point 2 — Revocation and freshness

## 2.1 The problem, restated precisely

RFC §8 lists seven mechanisms and closes with *"A verifier MUST define a freshness policy
for revocation data"* — without defining one, or saying who may. RFC §15 asserts
*"Revoked or stale authority cannot be revived by replaying an older valid chain."* RFC §1.7
asserts local-first verification.

These three are not jointly satisfiable as written. §1.7 permits a verifier to decide
locally; §15 forbids a stale decision; §8 declines to say which wins when fresh status is
unobtainable — which, in a fabric where a large fraction of peers are browser tabs that come
and go, is not an edge case but a normal operating condition.

**The specific gap** is not "which mechanism" — it is that the RFC never states the
**enforcement grain**: how long an authority that has been withdrawn continues to work. Every
mechanism in §8's list is a different way to shorten that number, and the number is currently
undefined, which means it is currently *infinite* for anything the certificate's own
`expiresAt` does not catch.

## 2.2 The measured enforcement grain, and the fact that reframes the whole question

`packages/libp2p/src/relay-admission.ts` records the mechanism and its measurement:

> "Admission is checked at every reservation **grant**, renewals included; nothing re-checks
> a peer mid-reservation, deliberately […] So the window in which a peer whose certificate
> has lapsed still holds a reservation is bounded by `RELAY_MAX_RESERVATION_TTL_MS`"

and the measurement that made it a number rather than a construction — **two independent
readings against the same 40 000 ms TTL**, the logged line being
`[revocation] ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049` (24-VERIFICATION)
and the first reading recorded as prose in 24-03:

> "Withdrawing admission from a peer already holding a reservation, changing nothing else,
> was observed re-consulting the gate and then dropping the peer:
> `ttlMs 40000 renewalAskedAfterMs 30027 droppedAfterMs 40028` (24-03), re-read independently
> by the verifier as `30031 / 40049` against the same 40 000 ms TTL. **The revocation window
> is the reservation TTL, as a number and not by construction alone.**"

and the floor:

> "`min(max(expiry - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)` with `REFRESH_TIMEOUT`
> 5 min and `REFRESH_TIMEOUT_MIN` **30 s** — read off the installed package, not off a
> comment — so for any TTL under five minutes the clamp wins, and below about 30 s a
> reservation expires before its holder ever tries to renew. That is churn, not revocation."

and the operational consequence:

> "**a refused peer never retries by itself.** libp2p arms its refresh timer only inside the
> success path, so a failed reservation leaves no timer at all, and a *reconnection* — not
> the passage of time — is what gets a newly-admitted peer in."

**Now the fact that reframes the question.** The task framing offered the reservation TTL as
"a natural expiry surface". It is — but it is not a *sufficient* one, and the reason is the
cardinal rule.

`NodeCertificate` carries `discoverability`, and `relayIds` is documented "Empty when
`direct`". A node reachable at a direct address **holds no reservation**, so
`denyInboundRelayReservation` is never consulted for it, and its revocation window is not
2 hours — it is the certificate lifetime, which is `30 * 24 * 3_600_000` = **30 days**.

Stated as the principle:

> **A revocation mechanism that runs at the relay is a mechanism keyed on how a peer is
> discovered. The cardinal rule forbids that. Only a mechanism every verifier applies to
> every peer regardless of reachability can be the system's revocation story — and the only
> such mechanism the codebase has is certificate expiry.**

This is why short-lived certificates are not merely "the strongest lever available"; they
are the only lever whose reach is not a function of topology. And the arithmetic today is
stark:

| Layer | Grain | Ratio to the next |
|---|---|---|
| Certificate lifetime (`certificateLifetimeMs` default) | **30 days** | — |
| Reservation TTL (`RELAY_MAX_RESERVATION_TTL_MS`) | **2 hours** | 360× finer |
| Renewal floor (`REFRESH_TIMEOUT_MIN`) | **30 seconds** | 240× finer |

The certificate lifetime is **three orders of magnitude coarser** than the mechanism that
enforces it, and it is the only one that reaches every peer.

### 2.2.1 A second, larger hole on the selection path — and it is documented as intended

Relay admission is not the only place a certificate is checked. `PeerVerifier` decides which
peers this node will fetch blocks from, and it records:

> "**A settled acceptance is never re-asked.** Verification is monotone here — nothing below
> revokes — so a peer that verified stays verified until it disconnects."

**So on the selection path the revocation window is the connection lifetime, not the
certificate lifetime and not the reservation TTL.** A direct WebRTC connection has no
duration limit; only a *relayed* one is bounded, and `CLAUDE.md` records that bound as
2 minutes / 128 KiB. A peer that verified once and holds a direct connection is trusted for
as long as the connection lives, whatever its certificate says.

This composes badly with the fact beside it. `PeerVerifier`'s `FINAL` set deliberately
excludes `expired`, with a reason that is correct for the refusal direction:

> "**`expired` and `not-yet-valid` are deliberately absent** […] Both are statements about a
> clock rather than about the document's validity: a not-yet-valid certificate becomes valid
> by waiting, and an expired one is replaced by a renewal the peer can obtain without
> reconnecting."

That correctly re-admits a peer whose certificate lapsed and was renewed. It does nothing in
the other direction, because an *acceptance* is never revisited at all. **The asymmetry is
the gap:** expiry can promote a refusal to an acceptance, and nothing can demote an
acceptance to a refusal.

**PROPOSED:** a settled acceptance is re-asked once its certificate's `expiresAt` has passed
— not on a timer, and not for any other reason. That is the minimum change that makes
certificate expiry actually reach the selection path, it costs at most one RPC per peer per
certificate lifetime, and it leaves the existing `DEFAULT_VERDICT_RETRY_FLOOR_MS` rate bound
untouched. **This is a fabric-wide behaviour change of the class `peer-verifier.ts` says was
"held for an owner ruling rather than patched when it was found", so it is proposed here and
not assumed.**

### 2.2.2 The codebase has already made the decision this section recommends

Three source files state it, and the RFC does not record it:

- `packages/core/src/enrollment.ts`: *"Revocation is **non-renewal on the certificate's own
  clock**, not a list"*
- `packages/node/src/bin/agent.ts`: *"its default and revocation stays non-renewal on the
  certificate's own clock."*
- `packages/core/src/result-attestation.ts`: *"There is no revocation list here and there must
  not be one."*

So the recommendation below is not a new architecture. It is: **record the decision the code
already made, and then set the one number that decision depends on** — which is currently
30 days and was never chosen against the mechanism that enforces it.

### Checking short-lived certificates against the measured 30 s floor, as instructed

The floor bounds the useful range from below, but it does **not** bind the recommendation,
because the floor governs the *relay-admission* mechanism and the recommendation governs the
*certificate*. Specifically:

- A certificate lifetime **below ~30 s** would be useless *at the relay*: the reservation
  would lapse before its holder attempted renewal, which the source calls "churn, not
  revocation". So 30 s is a hard floor on anything the relay is expected to enforce.
- A certificate lifetime **above the reservation TTL** makes the certificate the coarse edge
  again for relayed peers, discarding the one measured guarantee the system has.
- Therefore the useful band for relayed peers is **[30 s, 7 200 s]**.
- Within that band, **1 hour** is the recommended point, and it is sited rather than
  preferred: `DEFAULT_ISSUANCE_WINDOW_MS = 3_600_000` already establishes an hour as the
  scale `enrollment.ts` reasons in, and 1 h ≪ 2 h keeps the reservation TTL as the *binding*
  constraint for relayed peers, which preserves the 24-03 measurement's meaning.

For a **direct** peer, which no reservation gates, 1 h *is* the whole revocation window — a
720× improvement over today with no new mechanism, no new protocol, and no new online party
beyond the enrolment provider that the codebase already records as "necessarily an open
door".

## 2.3 Options, and their costs

| Option | Mechanism | Cost | Verdict |
|---|---|---|---|
| **A. Status quo** — long certs, relay admission only | 30-day certs; `denyInboundRelayReservation` | Revocation reaches only relayed peers; direct peers have a 30-day window. Violates the cardinal rule by being topology-keyed. | **Reject** |
| **B. Signed revocation list, pulled** | Verifier fetches a CRL-shaped object | Needs a reachable source at verification time. Browsers frequently have none. Whole-list distribution over a 128 KiB relayed connection is not viable. Soft-fails in practice, i.e. provides nothing against an attacker who can also block the fetch. | **Reject as primary** |
| **C. OCSP-shaped, per-certificate query** | Verifier asks a responder about one certificate | Same reachability problem, plus a per-verification round trip on a path where `DEFAULT_RPC_TIMEOUT_MS` is 30 s and an unanswered request already costs the full budget. Adds a privacy leak (the responder learns who checks whom). | **Reject** |
| **D. Stapling** — the checked party carries its own freshness | Joining node includes a signed status object in the registration payload | Removes the verifier's need to reach anything. RFC §9's signed payload already enumerates fields and can take one more. Requires the *checked* party to be able to refresh, which it can, because it must reach the enrolment provider anyway. | **Adopt as the freshness carrier** |
| **E. Short-lived certificates** | Shorten `certificateLifetimeMs` | Renewal traffic; a hard dependency on the issuer being reachable to stay alive; clock sensitivity rises as lifetimes shrink. | **Adopt as the primary mechanism** |
| **F. Epoch/status object with version + expiry** | A `NameRecord`-shaped signed object | The rollback and freeze defence. Already implemented in `NameResolver.accept`. | **Adopt for early revocation** |
| **G. Gossip / DHT distribution** | Push status through the fabric | No DHT exists in this repository. Gossip gives no bound — a verifier cannot tell "no revocation exists" from "the revocation did not reach me". | **Reject as a source of truth; permit as an accelerator** |

The recommendation composes **E + D + F**: expiry is the guarantee, stapling is the
transport, version+expiry is the rollback defence. B, C and G are not needed and each brings
a reachability assumption this system cannot meet.

## 2.4 Hard-fail, bounded soft-fail — keyed on the operation, never on the node

The reviewer asks for hard-fail on "relay registration and dangerous capabilities" and
bounded soft-fail on "low-risk/offline". The cardinal rule forbids reading that as a
statement about node kinds; the correct axis is **the operation**, which is topology-blind.

Three postures, named as values in the style the codebase already uses for
`'admits-any-peer'` and `'dispatches-unauthenticated'`:

- `refuses-without-fresh-status` — hard-fail. Refused unless a status object within
  `MAX_STATUS_AGE` is available.
- `proceeds-on-unexpired-credential` — bounded soft-fail. Proceeds on a signed, unexpired
  credential with no status consulted. Bounded from above by the credential's own expiry.
- `refuses-always` — no soft path exists.

| Operation | Posture | Why |
|---|---|---|
| Relay reservation grant, including renewal | `refuses-without-fresh-status` | This is the one point where the window is measured (`30027 / 40028`) and the gate already re-decides at every grant, so the check is already paid for. **The relay is the party that must hold fresh status, not the joining node** — which is what breaks the circularity of "you need a relay to get status and status to get a relay". |
| Enrolment (issuing a certificate) | **open by construction** | Recorded in this repository: the enrolment provider is necessarily an open door. A peer arriving with nothing cannot be required to present something. This is a permanent asymmetry, not a gap to close. |
| Issuing or accepting a delegation link | `refuses-without-fresh-status` | §5 attenuation is meaningful only if the parent is live. A delegation minted from a revoked parent is exactly the "stale authority revived" §15 forbids. |
| Trust-anchor change | `refuses-without-fresh-status` **and** human confirmation | Point 1. |
| Any egress, or any write to owner-pinned data | `refuses-without-fresh-status` | The sovereignty claim rests on the egress manifest. A stale credential here produces an unrecoverable disclosure, not a recoverable outage. |
| Accepting and executing a workload | `proceeds-on-unexpired-credential` | Defence in depth already applies independently: `guardModuleProvenance` requires a pinned anchor's record, and the runtime sandbox limits the workload regardless of who authorized it. A stale admission does not escalate. |
| Serving a block; answering a `records` request | `proceeds-on-unexpired-credential` | Read-only, and hard-failing it is a measured deadlock: without seeding, a node "could never fetch a block from the one peer it is reachable through, permanently, with nothing reporting it" (`peer-verifier.ts`). |

Note what is *absent* from that table: any row that reads "browser nodes" or "backbone
nodes". Every row names an operation. That is the test the cardinal rule imposes, and it
passes.

## 2.5 Maximum age, and how the two numbers are derived rather than chosen

Two distinct bounds, and conflating them is the error the RFC's §8 currently invites.

**`MAX_STATUS_AGE` = 5 minutes — the soft-fail budget.** Sited, not preferred: the installed
relay transport's `REFRESH_TIMEOUT` is **5 min**, so a peer holding a reservation with any
TTL ≥ 10 min already contacts its relay at least that often. A status object refreshed on
that schedule therefore costs **no additional connection** — it rides an exchange the
transport already performs. Any shorter value buys nothing, because below ~30 s the source
records that a reservation "expires before its holder ever tries to renew".

**Certificate lifetime = 1 hour — the hard ceiling on total offline exposure.** Derived in
§2.2 from the band `[REFRESH_TIMEOUT_MIN, RELAY_MAX_RESERVATION_TTL_MS]` = `[30 s, 2 h]` and
sited against `DEFAULT_ISSUANCE_WINDOW_MS = 3_600_000`.

The two compose into a policy with no undefined region:

| Status age | Hard-fail operations | Soft-fail operations |
|---|---|---|
| ≤ 5 min | proceed | proceed |
| > 5 min, certificate unexpired | **refuse** | proceed |
| certificate expired (> 1 h since issue) | refuse | **refuse** — no policy needed; `verifyCertificate` already returns `{ kind: 'expired' }` |
| no status ever held | treated as **infinite age** ⇒ refuse | proceed while unexpired |

**The property worth stating in the RFC:** with a 1-hour certificate, *complete* status
unavailability is bounded at one hour **by construction, without any status object at all.**
That is the argument for short-lived certificates being the primary mechanism rather than an
optimisation — they make the offline case bounded by arithmetic instead of by policy, and
arithmetic is the only thing that holds when the policy's inputs are unreachable.

**And the honest consequence:** a fully partitioned fabric — a LAN with no route to an issuer
— can execute workloads and serve blocks for as long as its certificates last, and can admit
no new reservations after 5 minutes. That is correct and it is harsh. An operator may raise
`MAX_STATUS_AGE`, and the cost is written down rather than hidden: **the revocation window
becomes that number.**

## 2.6 Who signs the status object

| Option | Cost | Verdict |
|---|---|---|
| The issuing `CM-Node` | Requires the issuing key online to produce fresh status. Compromise then yields *both* issuance and status — the §3.2 separation collapses. | Reject |
| **A distinct `CM-Status` role under CR, holding the only online key** | One more management role and one more key to manage. | **Adopt** |
| A quorum or threshold | Requires an assembled committee the fabric does not have; inventing one is a larger unclosed node than the one it closes. | Defer to §18 |

**PROPOSED: `CM-Status` is the only online key in the hierarchy, and this is the property that
makes an online key acceptable.**

- It preserves §3.1: "The CR private key should be used rarely and stored with the strongest
  available protection."
- It preserves §3.2: "Compromise of one management certificate must not implicitly grant the
  rights of another management role."
- **Compromise of `CM-Status` is a liveness attack, never an authority attack.** An attacker
  holding it can withhold status, or replay the last good status — they cannot issue
  authority, cannot enrol a node, and cannot sign code. That asymmetry is the entire
  justification, and it should be stated in the RFC in those words, because "there is one
  online key" reads as a weakening unless the blast radius is stated beside it.

This is the direct transfer from TUF's **timestamp role**, which exists for exactly this
reason: to give the system a frequently-refreshed object without putting the root or the
targets keys online.

**The named residual attack is freeze.** A compromised or merely unreachable `CM-Status` lets
the last good status be replayed indefinitely, so a revocation never propagates. The defence
is that **a status object carries its own `expiresAt`, and a status past its expiry is not a
status.** That converts a freeze into an outage, and §2.5's soft-fail table then handles the
outage with a bounded window. Freeze is not eliminated; it is converted into a failure mode
the policy already covers, which is the most that can be claimed.

## 2.7 Preventing rollback of the status object itself

This is the part where the repository is ahead of the RFC. `packages/core/src/naming.ts`
already implements exactly the required rule, for a different object:

- `NameRecord.version` — the field comment reads "Monotonic per name. A resolver keeps the
  highest it has seen".
- `NameResolver.accept` refuses `{ kind: 'rollback', name, have, offered }` when
  `record.version < existing.version`.
- The same method refuses `{ kind: 'expired' }` when `record.expiresAt <= now`.
- And `{ kind: 'untrusted-signer' }` when the signer is not pinned.

**PROPOSED: the status object is `NameRecord`-shaped and reuses this rule unchanged.**
Version defeats rollback; expiry defeats freeze; the pinned signer defeats forgery. That is
TUF's combination, and it is already written and already tested in this codebase — which is
a far better argument for adopting it than the prior art is.

### The limit, which must be named and not glossed

`NameResolver`'s `#records` is an in-memory `Map` held by the instance. Therefore:

- **the monotonic floor does not survive a process restart**, and a restarted node will
  accept a status object at any version;
- **in a browser the floor's backing store is IndexedDB**, which `CLAUDE.md` records as
  "evicted silently under storage pressure". A rollback defence with soft durability is a
  rollback defence with soft coverage.

**PROPOSED — a second floor that needs no storage at all**, to cover the restart and eviction
cases partially:

> A status object MUST be refused if its `issuedAt` precedes the `issuedAt` of the
> certificate it is being used to evaluate.

The certificate is in hand at evaluation time and carries `issuedAt` already
(`NodeCertificate.issuedAt`), so this floor is available to a node with no memory of anything.
It does not catch a rollback *within* a certificate's life — for that the stored floor is
required — but it makes an unbounded rollback impossible for a freshly started node, which
is the worst case the stored floor leaves open.

## 2.8 The clock, which the RFC does not mention and which everything above rests on

Every rule in §2.5 and §2.7 is an inequality against `now`. A verifier whose clock is set
back accepts expired certificates and stale status. In a browser the wall clock is
user-settable; on a headless node it is whatever NTP last said.

- `verifyCertificate` already refuses `{ kind: 'not-yet-valid' }` for `issuedAt > now`, which
  catches a clock set *forward* — the direction that does not matter.
- Nothing catches a clock set *backward*, which is the direction that does.

**PROPOSED, cheap and partial:** RFC §9's relay challenge already binds authentication to a
fresh request. Extend the challenge to carry the relay's own `now`. A joining node observing
a large divergence between the relay's time and its own can refuse rather than proceed on a
clock it has reason to distrust. This does not defend against a lying relay — it turns a
silent clock fault into a visible disagreement, which is all a two-party exchange can do.

Roughtime exists for exactly this problem and would give a cryptographically attributable
time. It is a new external dependency and a new always-reachable party, so it is recorded as
an option, not a recommendation.

## 2.9 Prior art — what transfers, and what emphatically does not

| Prior art | Transfers? | What exactly |
|---|---|---|
| **[TUF](https://theupdateframework.github.io/specification/latest/) — timestamp role, version + expiry** | **Almost entirely. It is the backbone of this recommendation** | TUF names both attacks precisely: rollback — *"An attacker cannot trick clients into installing software that is older than that which the client previously knew to be available"* — and freeze — *"An attacker cannot respond to client requests with the same, outdated metadata without the client being aware of the problem."* Two independent rules do the work, and **neither alone suffices**: *"Clients MUST NOT replace a metadata file with a version number less than the one currently trusted"* (client-held state, no clock) and *"Clients MUST NOT trust an expired file"* (a clock, no state). Version-monotonicity alone lets an attacker pin you at the current version forever; expiry alone lets an attacker replay an older-but-unexpired file. TUF also validates §2.6's structure explicitly: *"All keys, except those for the timestamp and mirrors roles, should be stored securely offline"*, and *"Even though this timestamp key must be kept online, the risk posed to clients by the compromise of this key is minimal."* Concrete numbers are policy not spec — PEP 458 sets timestamp/snapshot expiry at **one day** and root/targets at **one year**, on the rule that the more often metadata changes the sooner it should expire. **What does not transfer:** TUF assumes a *repository* — one place clients fetch from. This fabric has none, so TUF is silent on how a peer-only client obtains the timestamp. That gap is what stapling fills, and stapling is not a TUF idea. |
| **[OCSP stapling](https://datatracker.ietf.org/doc/html/rfc6960)** (the stapling half, and the `nextUpdate` object shape) | **Yes — the single most useful import from Web PKI** | Two things transfer. **The direction:** the party being checked carries the evidence, so the verifier reaches nothing. **The object:** `thisUpdate` is *"The most recent time at which the status being indicated is known by the responder to have been correct"* and `nextUpdate` *"The time at or before which newer information will be available."* That is a signed, self-describing, **staleness-bounded** assertion which can be cached, forwarded by an untrusted third party, and evaluated offline — precisely the right shape for a P2P fabric, and it maps onto RFC §9's already-extensible signed payload. Note what `nextUpdate` does *not* claim: it bounds staleness, it does not attest liveness. |
| **OCSP** (the query half), **must-staple ([RFC 7633](https://datatracker.ietf.org/doc/html/rfc7633))** | **No — and it is the canonical worked example of this exact failure** | The rigorous statement is in the CRLite paper, not an RFC: *"the fail-open model provides little additional security, as an attacker who can filter the client's traffic can block the revocation status request and cause a revoked certificate to be accepted"*, and browsers fail open *"to avoid having to refuse a connection (and cause perceived unreliability) when the CRL or OCSP server cannot be contacted."* RFC 6960 mandates nothing for an unreachable responder. Must-staple took the opposite posture and converted a CA outage into a site outage — the same bricking hazard that killed HPKP — and never deployed: only **3–5%** of certificates were served by stapling-capable hosts. **Let's Encrypt has now switched OCSP off entirely** (announced 2024-07-23, timeline 2024-12-05, URLs removed 2025-05-07, responders off **2025-08-06**), at a peak load of *"approximately 340 billion OCSP requests per month."* **The transferable lesson is the reason §2.4 splits posture per operation rather than globally:** in a fabric where half the peers are offline by design, a blanket hard-fail freshness requirement is a self-inflicted denial of service, and a blanket soft-fail is theatre. |
| **[Short-lived certificates](https://letsencrypt.org/2025/01/16/6-day-and-ip-certs)** | **Yes — this is the recommendation, and it inverts one thing** | Let's Encrypt's `shortlived` profile is *"valid for 160 hours, just over six days"*, and — decisively — *"Our six-day certificates will not include OCSP or CRL URLs."* The stated reasoning is the one this document adopts: *"When the private key associated with a certificate is compromised, the recommendation has always been to have the certificate revoked […] Unfortunately, certificate revocation doesn't work very well"*, and *"The primary advantage of short-lived certificates is that they greatly reduce the potential compromise window."* GA **2026-01-15**. The whole Web PKI is moving the same way: **CA/Browser Forum ballot SC-081v3 passed 2025-04-11** with the schedule 398 → **200 days (2026-03-15)** → **100 days (2027-03-15)** → **47 days (2029-03-15)**. **The inversion to state honestly:** this trade deletes a status service and buys a *renewal* service, which must be up **more** often, not less. The transferable form for a fabric with no always-online CA is therefore **medium-lived peer certificates from the issuer, with very short-lived delegated credentials produced by the peer itself** — which is exactly what RFC §3.5's session certificate already is, and is the strongest argument for actually building CS. |
| **[Sigstore / Fulcio](https://docs.sigstore.dev/certificate_authority/overview/)** | **Architecture no; one idea yes** | *"Fulcio signs X.509 certificates valid for 10 minutes"* and *"By using ephemeral keys and short-lived certificates, Fulcio avoids the need for revocation lists."* **Fulcio is an online CA and Rekor is an online append-only log** — state this plainly, because Sigstore is routinely mis-cited as "keyless, no PKI" when it is the most infrastructure-dependent system in this survey (online CA + online log + online OIDC provider + CT log + TUF for root distribution). What transfers is the **decoupling of signing time from verification time**: *"To verify a short-lived certificate, a timestamping service is needed to verify that the issued certificate was valid during artifact signing."* And the failure mode transfers too, as a warning — Rekor's `integratedTime` is not covered by the Merkle structure, so **a clock that is not itself in the tree is not protected by the tree** (CVE-2024-55655 was a client that stopped checking it at all). |
| **[CRLite](https://cbw.sh/static/pdf/larisch-oakland17.pdf)** | **No, and the reason is definitional, not a scaling limit** | The filter cascade is *constructed against a known finite universe* `U`. From §III.A: *"because we can now know the set of virtually all certificates at any time, and because CAs are increasingly adopting CT, we believe we can at last safely make this assumption"*, and *"it must only be the case that whoever constructed the filter cascade was aware of all possible values u ∈ U for which it would subsequently be queried."* If a certificate exists the constructor never saw, the cascade returns an arbitrary answer for it. In a fabric where any enrolment provider can mint a certificate and half the peers are offline, **`U` cannot be enumerated**. This should be said in the RFC rather than left on §8's list as an aspiration. **One narrower fragment does transfer:** a cascade works over a *bounded, locally-known* universe. If a single root's enrolment set is itself enumerable, a per-root cascade is a legitimate few-kilobyte, fail-closed way to ship "which of my enrolled peers are revoked". The claim that cannot be made is a global one. |
| **Certificate Transparency** | **Not as a revocation mechanism** | CT detects mis-issuance after the fact; it does not revoke. Its relevance here is Point 1, not Point 2. |
| **Gossip / DHT distribution of revocations** | **Accelerator only** | Neither can give a verifier a *bound*: absence of a revocation is indistinguishable from a revocation that has not arrived. A mechanism that cannot distinguish those two cannot be what an inequality is evaluated against. It shortens the mean, never the worst case. |
| **[Roughtime](https://datatracker.ietf.org/doc/html/draft-ietf-ntp-roughtime-19)** | **No as specified; the nonce-chaining idea yes** | It does not solve "a browser tab has no trusted clock": it is `draft-ietf-ntp-roughtime-19`, intended status **Experimental**, it needs *"a minimum of three [servers] which are operational and not run by the same parties"*, and its UDP transport is unreachable from a page's sandbox. It also does not remove a trust anchor — it removes the requirement that the anchor be *trustworthy*, by making misbehaviour provable. **That** is the transferable idea: the second query signs over *"H(resp ‖ rand)"* where `resp` is the first server's whole response, so inconsistency becomes provable **to a third party** rather than merely suspected. Implementable directly between peers, and it is the same job KERI's witnesses do and CT's gossip was supposed to do. Note also the free coarse clock a browser already has: the HTTPS `Date` header and the TLS handshake against the origin. |

## 2.10 RECOMMENDATION (Point 2)

1. **Make certificate expiry the primary revocation mechanism**, on the ground that it is the
   only one whose reach is not a function of how a peer is discovered. Reduce
   `certificateLifetimeMs` from `30 * 24 * 3_600_000` to **`3_600_000`** (1 h), sited against
   `[REFRESH_TIMEOUT_MIN, RELAY_MAX_RESERVATION_TTL_MS]` = `[30 s, 2 h]` and against
   `DEFAULT_ISSUANCE_WINDOW_MS`.
2. **State the enforcement-grain rule in the RFC:** a credential's lifetime SHOULD NOT exceed
   the enforcement grain of the mechanism that checks it, and SHOULD NOT fall below that
   mechanism's renewal floor.
3. **Adopt stapling, not querying.** The checked party carries its status object; §9's signed
   payload gains one field.
4. **Split fail-posture by operation, never by node kind** — the table in §2.4.
5. **`MAX_STATUS_AGE` = 5 min**, sited against the installed `REFRESH_TIMEOUT`.
6. **`CM-Status` is a distinct role and the only online key**, with the blast-radius statement
   beside it.
7. **The status object is `NameRecord`-shaped**: monotonic `version`, own `expiresAt`, pinned
   signer — reusing `NameResolver.accept`'s existing rules.
8. **Add the storage-free rollback floor:** a status older than the certificate it evaluates
   is refused.
9. **Add a `revoked` member to `CertificateFailure`**, so that "revoked" and "expired" are
   distinguishable in a refusal. Today they are not, because `revoked` does not exist.
10. **Record the clock assumption explicitly**, and carry the relay's time in §9's challenge.
11. **Re-ask a settled acceptance once its certificate has expired** (§2.2.1). Without this,
    every other recommendation here reaches the admission path and not the selection path,
    and the headline number is the connection lifetime rather than the certificate lifetime.
12. **Record in the RFC that revocation is non-renewal**, which the code already decided
    (§2.2.2), so that §8's list of seven mechanisms stops reading as seven live options.

### What this costs

- **Renewal traffic.** A 1-hour certificate means every node contacts an issuer roughly
  hourly instead of monthly — a ~720× increase in enrolment RPCs. **Unmeasured, and it must
  be measured before adoption:** `enrollment-cost.node.test.ts` and
  `enrollment-dos.node.test.ts` exist and are the right place. The relevant question is not
  the mean but whether the issuer's admission path stays inside its bounds at the resulting
  arrival rate.
- **A hard availability dependency on the issuer.** Today a node with a valid certificate
  survives an issuer outage for a month. At 1 hour it survives for an hour. This is a real
  regression in partition tolerance and it is the price of the revocation guarantee; it must
  be stated as a trade, not presented as free. An operator with a genuinely offline
  deployment needs a longer lifetime and gets a proportionally longer revocation window,
  which is the correct shape.
- **Clock sensitivity rises as lifetimes shrink.** At 30 days a few minutes of skew is noise.
  At 1 hour it is 1.7 % of the credential's life. §2.8's mitigation is partial.
- **One more key to operate** (`CM-Status`), and it is online, which is the key most likely
  to be compromised. Priced by the blast-radius argument, not by hoping.
- **One new field in the registration payload**, which §9 already describes as an extensible
  list — the cheapest item here.
- **The rollback floor's stored half costs durable storage**, which the browser does not
  reliably have. Partially covered by the storage-free floor; not fully.

## 2.11 RFC text to paste (Point 2)

> ### 8.1 The enforcement grain
>
> Revocation is not a lookup; it is a **bound on how long a withdrawn authority continues to
> work**. Every mechanism in §8 is a way of shortening that bound, and a specification that
> does not state the bound has not specified revocation.
>
> **A credential's lifetime SHOULD NOT exceed the enforcement grain of the mechanism that
> checks it, and SHOULD NOT fall below that mechanism's renewal floor.** Where several
> mechanisms check a credential, the grain is that of the *coarsest* mechanism that reaches
> every verifier.
>
> **A mechanism enforced only at a subset of a peer's possible network paths is not a
> revocation mechanism for this architecture**, because it revokes only for peers reached
> that way. Where nodes differ solely in how they are discovered, a discovery-dependent
> mechanism is a discovery-dependent policy. **Credential expiry is the only mechanism every
> verifier applies to every peer**, and it is therefore the primary mechanism; all others are
> accelerators that may shorten the expected window and never the worst case.
>
> ### 8.2 Freshness postures, by operation
>
> A verifier assigns each operation one of three postures. **The posture is a property of the
> operation, never of the peer** — nothing may branch on what kind of node a peer is.
>
> | Posture | Meaning |
> |---|---|
> | `refuses-without-fresh-status` | Refused unless a status object no older than `MAX_STATUS_AGE` is available. |
> | `proceeds-on-unexpired-credential` | Proceeds on a signed, unexpired credential with no status consulted; bounded above by the credential's own expiry. |
> | `refuses-always` | No permissive path exists. |
>
> Operations that MUST take `refuses-without-fresh-status`: relay reservation grant, including
> renewal; issuing or accepting a delegation link; changing a trust anchor; any egress or any
> write to owner-pinned data.
>
> Operations that MAY take `proceeds-on-unexpired-credential`: accepting and executing a
> workload; serving content; answering a records query. Each is separately constrained —
> workload execution by provenance checking and runtime isolation (§11), content serving by
> being read-only — so a stale admission does not escalate authority.
>
> **Enrolment is open by construction** and takes no freshness posture. A peer arriving with
> no credential cannot be asked to present one. This is a permanent property of any system
> that lets new participants join, not a gap.
>
> ### 8.3 Freshness bounds
>
> Two bounds, and they are not interchangeable.
>
> - **`MAX_STATUS_AGE`** — the age past which a cached status object no longer permits a
>   `refuses-without-fresh-status` operation. It SHOULD be set to a period at which the
>   verifier already communicates for other reasons, so that freshness costs no additional
>   connection.
> - **Credential lifetime** — the ceiling on total exposure when *no* status is obtainable at
>   all.
>
> | Status age | `refuses-without-fresh-status` | `proceeds-on-unexpired-credential` |
> |---|---|---|
> | ≤ `MAX_STATUS_AGE` | proceed | proceed |
> | > `MAX_STATUS_AGE`, credential unexpired | **refuse** | proceed |
> | credential expired | refuse | **refuse** |
> | no status ever held | treated as infinite age ⇒ refuse | proceed while unexpired |
>
> With a short credential lifetime, **complete unavailability of status is bounded by the
> lifetime itself, with no status object involved.** This is the property that makes short
> credentials the primary mechanism rather than an optimisation: the offline bound is
> arithmetic, and arithmetic is what remains when the policy's inputs are unreachable.
>
> A fully partitioned deployment can therefore execute workloads and serve content for as long
> as its credentials last, and can admit no new registrations once `MAX_STATUS_AGE` elapses.
> An operator may raise `MAX_STATUS_AGE`; the revocation window becomes that number, and the
> deployment MUST record it as such.
>
> ### 8.4 The status object, and who signs it
>
> A status object is a signed record carrying at minimum:
>
> ```
> StatusObject ::= SEQUENCE {
>     scope           OCTET STRING,   -- the authority branch this speaks for
>     version         INTEGER,        -- monotonic within scope
>     issuedAt        GeneralizedTime,
>     expiresAt       GeneralizedTime,
>     revoked         SEQUENCE OF CertificateReference,
>     rotationEpoch   INTEGER,
>     signer          OCTET STRING,
>     signature       OCTET STRING
> }
> ```
>
> It is signed by a dedicated **`CM-Status`** management role issued by the CR.
>
> **`CM-Status` holds the only online key in the hierarchy, and that is the property which
> makes an online key acceptable.** An attacker holding `CM-Status` can withhold status or
> replay the last valid status. They cannot issue authority, enrol a node, sign code, or
> perform recovery. **Compromise of `CM-Status` is a liveness attack, never an authority
> attack** — and a specification that puts a key online without stating that bound has not
> justified the key.
>
> ### 8.5 Rollback and freeze of the status object
>
> Three rules, jointly, and each defeats a different attack:
>
> 1. **Version defeats rollback.** `version` is monotonic within `scope`. A verifier retains
>    the highest version it has accepted and MUST refuse any object offering a lower one.
> 2. **Expiry defeats freeze.** A status object past its own `expiresAt` **is not a status
>    object**. Replaying the last valid status therefore produces an outage, which §8.3's
>    bounds already cover, rather than an indefinite suppression of revocation.
> 3. **A pinned signer defeats forgery.** An object signed by a key the verifier has not
>    pinned MUST be refused without further evaluation.
>
> **A verifier with no retained state MUST still apply a floor.** A status object whose
> `issuedAt` precedes the `issuedAt` of the certificate it is being used to evaluate MUST be
> refused. The certificate is in hand at evaluation time, so this floor requires no storage
> and bounds rollback for a verifier that has just started or whose retained state was
> evicted. It does not bound rollback *within* a certificate's lifetime; only retained state
> does that, and a deployment whose storage is evictable MUST NOT claim the stronger property.
>
> ### 8.6 Freshness is carried by the checked party, not fetched by the verifier
>
> A verifier MUST NOT be required to reach a status source in order to complete a validation.
> The party being checked **staples** its current status object into the request it is already
> making; §9's signed registration payload carries it as an additional field, covered by the
> same signature.
>
> This inverts the reachability requirement onto the party that must be reachable anyway — a
> node that is joining can reach the fabric by definition — and it removes the failure mode in
> which a verifier's inability to reach a third party is indistinguishable from the checked
> party being in good standing.
>
> ### 8.7 Time
>
> Every rule in §8 is an inequality against the verifier's clock. A verifier whose clock is
> set backward accepts expired credentials and stale status, and no signature check detects it.
>
> Implementations MUST record clock integrity as an explicit assumption. The relay challenge of
> §9 SHOULD carry the challenger's own time, so that a large divergence becomes a visible
> disagreement rather than a silent acceptance. This does not defend against a dishonest
> counterparty; it is the most a two-party exchange can provide.

## 2.12 UNRESOLVED (Point 2)

- **The renewal cost of a 1-hour certificate is unmeasured and it gates the recommendation.**
  **Measurement needed:** the enrolment provider's admission latency and refusal rate at the
  arrival rate implied by an N-node fabric with a 1-hour lifetime, taken comparatively within
  one run against the current rate — `enrollment-cost.node.test.ts` and
  `enrollment-dos.node.test.ts` are the sites. Until taken, "1 hour" is a derivation, not a
  settled value. *Unmeasured is not met.*
- **The `MAX_STATUS_AGE` = 5 min siting assumes `REFRESH_TIMEOUT` fires as a reliable
  heartbeat.** That was measured for the *renewal* path (`30027 / 40028`) but not as a
  general-purpose 5-minute clock for peers whose TTL is at the 2-hour default.
  **Measurement needed:** observed interval between a reservation holder's successive relay
  contacts at `RELAY_MAX_RESERVATION_TTL_MS`. If it is not ~5 min, the "costs no additional
  connection" claim is false and the number must be re-sited.
- **Browser-tier verification remains unmeasured.** `peer-verifier.ts` records that "`@o2/browser`
  does not depend on `@o2/node` — so **the browser tier still cannot construct one, and
  browser-tier verification is still UNMEASURED.**" Everything in §2.4 that a browser peer
  would enforce is therefore proposed against a surface that does not yet exist there. This is
  a packaging fact, not a capability one, but it is not resolved by this document.
- **The retained rollback floor has no durable home in the browser.** IndexedDB is evicted
  silently. The storage-free floor of §2.7 covers the restart case and not the mid-lifetime
  case. **Measurement needed:** eviction rate of a small IndexedDB record under this workload,
  per browser, over a representative session.
- **Clock skew across the fabric is unmeasured and cannot be measured with the tooling
  `CLAUDE.md` prescribes.** `performance.now()` is the mandated clock and it is monotonic, not
  wall — it cannot observe the fault §2.8 describes. A separate wall-clock instrument is
  needed and does not exist.
- **`revoked` does not exist as a `CertificateFailure` member, so no refusal in this codebase
  can currently say "revoked".** Adding it is trivial; deciding what a verifier does with a
  revocation whose *scope* it does not recognise is not, and is unaddressed here.
- **Per-relay admission means per-relay revocation, and this document does not close that.**
  Admission is a value on each relay's own options. Withdrawing a peer from one relay's
  `RelayAdmission` says nothing about any other relay. Short-lived certificates make this not
  matter for *expiry*-driven revocation — which is the point of §2.2 — but an *explicit*
  revocation still propagates only as far as the status object reaches, and how a
  `StatusObject` is distributed at all is not specified here.
- **Whether a `refuses-without-fresh-status` posture at the relay creates a new
  denial-of-service surface is unexamined.** A relay that cannot refresh its own status stops
  admitting anyone. `enrollment-dos.node.test.ts` is the existing site for that class of
  question; it has not been asked there.
- **`PeerVerifier` fails *open* on an empty issuer set, and that is a ruled-on decision this
  document does not reopen.** `verifiedPeers` begins *"The first line below is **fail-open**:
  pinned nobody ⇒ trust everybody"*, guarded by *"**Do not 'fix' this early return to match
  it.** Flipping it globally breaks every unpinned node in this repository and re-opens a
  fabric-wide behaviour that was already ruled on."* Every posture in §2.4 therefore applies
  only to a node that pinned somebody. **A fabric of unpinned nodes has no revocation at all,
  and no number in this document applies to it.**
- **The browser tier's relay cannot pin issuers at all.** 24-VERIFICATION records that
  "`bin/seed.ts` has no flag, `SeedServerOptions` has no field, and the seed is the relay
  every browser tab in this fabric reserves on". So §2.4's hard-fail row for reservation
  grants is, for the browser tier today, a proposal about a surface that does not exist.
- **The gate's own budget is smaller than `PeerVerifier`'s retry floor.** The admission gate
  runs `GATER_PROBE_BUDGET_MS = 700` per ask, 100 ms apart, 3 500 ms overall, sited against
  libp2p's `DEFAULT_RESERVATION_COMPLETION_TIMEOUT` of 5 000 ms — while `PeerVerifier`'s
  `DEFAULT_VERDICT_RETRY_FLOOR_MS` is 5 000 ms, i.e. *"longer than this gate's entire
  budget"*. Any status object stapled into a registration must therefore be verifiable inside
  700 ms without a network round trip. **Unmeasured:** whether signature verification plus
  version/expiry checks fit that budget on the slowest device in the fabric.

---

## Appendix — measurements this document depends on, and where they came from

| Claim | Source |
|---|---|
| The revocation window is the reservation TTL, as a number | Logged line `[revocation] ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049` (24-VERIFICATION); the first reading `30027 / 40028` is recorded as prose in 24-03-SUMMARY and re-quoted in `packages/libp2p/src/relay-admission.ts`. Two independent readings, same 40 000 ms TTL. Measured in `packages/node/src/enrol-through-a-closed-door.node.test.ts`, spec `re-consults the gate on renewal, so the revocation window is the reservation TTL` |
| An acceptance is never revisited | `packages/node/src/peer-verifier.ts`: "**A settled acceptance is never re-asked.** Verification is monotone here — nothing below revokes" |
| Revocation is already defined as non-renewal | `packages/core/src/enrollment.ts`; `packages/node/src/bin/agent.ts`; `packages/core/src/result-attestation.ts`: "There is no revocation list here and there must not be one." |
| Anchors cannot change at runtime | `SignedNameResolver`, `packages/core/src/naming.ts`: "supplied at construction and cannot be added to afterwards" |
| The gate fails closed; the verifier fails open when nobody is pinned | 24-03-SUMMARY: "Every path out is a decision […] There is no fall-through to 'allow'". `peer-verifier.ts`: "The first line below is **fail-open**: pinned nobody ⇒ trust everybody." |
| The relay gate's budget | `GATER_PROBE_BUDGET_MS = 700`, 100 ms apart, 3 500 ms overall, sited against `DEFAULT_RESERVATION_COMPLETION_TIMEOUT` 5 000 ms; `ask 1` 701 ms timeout, `ask 2` answered in 4 ms; a request arriving before `serveAgent` is "accepted at the protocol level and dropped" — "destroyed, not delayed" |
| The seed relay cannot pin issuers | 24-VERIFICATION: "`bin/seed.ts` has no flag, `SeedServerOptions` has no field, and the seed is the relay every browser tab in this fabric reserves on" |
| The enrolment door is open by construction | 24-04-SUMMARY: "the peer a joiner must dial in order to be certified is itself an open door, and the joiner walks through it"; `relay-admission.ts`: "The enrolment exemption is by construction rather than by an `if`." |
| Admission is per-relay | `relay-admission.ts`: "per-relay by construction"; 24-VERIFICATION: "**The criterion says 'the fabric'. The evidence says 'a relay'.**" |
| Renewal re-consults the gate | Same; "A renewal IS a grant, so the window is bounded" |
| The 30 s floor | `min(max(expiry - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)`, `REFRESH_TIMEOUT` 5 min, `REFRESH_TIMEOUT_MIN` 30 s — "read off the installed package, not off a comment" |
| A refused peer never retries by itself | `packages/libp2p/src/relay-admission.ts`: "libp2p arms its refresh timer only inside the success path" |
| A settled verdict was never revisited | `packages/node/src/peer-verifier.ts`: "a gate dialled a browser tab before the tab's `serveAgent` was up, and the refusal that settled would have stood for ever even though the tab held a valid certificate from the pinned issuer throughout" |
| Which verdicts are final | `FINAL` in `peer-verifier.ts` = `unidentifiable-peer`, `nodeKey-mismatch`, `bad-signature`, `untrusted-issuer` — a fact about a *signed document*. `expired` is deliberately outside it, so a lapsed peer is re-asked rather than cached as refused. |
| Re-ask floor and RPC budget | `DEFAULT_VERDICT_RETRY_FLOOR_MS = 5_000`; `DEFAULT_RPC_TIMEOUT_MS = 30_000` |
| The anchor ships with the artifact, and its limit | `packages/demo/src/kernel-record.ts` |
| A supplied anchor list replaces rather than joins | `packages/browser/demo/main.ts`; `bin/agent.ts`, `bin/seed.ts`: `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]` |
| Rollback and expiry are already implemented for signed records | `NameResolver.accept`, `packages/core/src/naming.ts` |
| Certificate lifetime is 30 days | `packages/core/src/enrollment.ts`: `options.certificateLifetimeMs ?? 30 * 24 * 3_600_000` |
| Certificates have no `revoked` failure kind | `CertificateFailure`, same file |
| Consent gaps are named, and why | `ConsentGap`, `packages/browser/src/consent.ts` |
| IndexedDB is evicted silently; relayed connections are 2 min / 128 KiB | `CLAUDE.md` |
