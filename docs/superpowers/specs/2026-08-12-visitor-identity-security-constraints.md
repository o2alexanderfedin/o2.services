# Visitor-pressed identity — security constraints the design must obey

Written 2026-08-12 from a read-only review of the certificate and capability-chain
flows. Every constraint here was verified by reading the cited lines. This is a
record of what IS, and what it forces — not a design.

## 1. Derive the USER key from the passphrase. Never the node seed.

`identityFromSeed` (`packages/libp2p/src/identity.ts:107-115`) derives `nodeKey`,
`peerId` and the libp2p private key **from the seed alone**. So a passphrase-derived
node seed makes two tabs sharing a passphrase derive the **same `peerId`**.

That is not a nuisance, it is the removal of the property that contains everything
else. The `nodeKey ↔ peerId` binding is recomputed from the Noise-proven peer id at
**both** admission seams — `fabric-node.ts:965-974` (relay gate) and `peer-verifier.ts`
(~`:704`) — and it is the single strongest property in this trust model.

The model already supports one owner across many nodes: `NodeCertificate.userKey` is
documented *"Several nodes may share one"* (`packages/core/src/enrollment.ts:163-164`),
and AUTH-05 is that requirement, already met.

**Rule: `userPrivateKey` from the passphrase; node seed random per tab.**

## 2. The enrolment response is not ratified — and the persisted path already does it

`packages/net/src/enrol-client.ts:132` returns `result.certificate` verbatim.
`packages/browser/src/browser-node.ts:594-604` throws only on `!outcome.ok`, then
persists whatever came back. Nothing compares `certificate.userKey`/`nodeKey`/
`operatorId` against the request built at `:584-588`.

The asymmetry is the evidence: on **reload**, `browser-node.ts:553-560` checks
`peerIdForNodeKey(loaded.nodeKey) === identity.peerId`. On **issue**, it does not. A
mismatched certificate is therefore used for a whole session and rejected at the next
start.

The provider address arrives from the origin (`demo/main.ts:607-633`).

**What a hostile origin can do**: be the provider; return a certificate naming a
different `userKey` or `operatorId`, which is persisted and then published via
`ownRecords`' `sovereignFor: [certificate.userKey]` (`browser-node.ts:635`); deny
enrolment; learn that a visitor enrolled.

**What it cannot do**: make the tab present a certificate for a `nodeKey` it does not
hold (both admission seams recompute it); get that certificate accepted by any peer
pinning a real issuer (`enrollment.ts:1085`); obtain `userPrivateKey`, which never
comes from the origin.

**Severity: self-inflicted identity confusion, not impersonation.** Ratification is
part of this change.

## 3. `operatorId` carries sybil resistance and is guarded by nothing

Quorum anti-affinity rests entirely on `operatorId` (`enrollment.ts:102`,
`packages/core/src/quorum.ts:178`), and `THREAT-MODEL.md:53` lists that as the built
defence against an attacker filling a quorum from machines they alone run.

It is a free requester-chosen string — never validated, never bounded, bound to
nothing scarce. Only the provider's aggregate issuance budget
(`enrollment.ts:869-884`) limits it at all.

**Rule: the page must never choose `operatorId`.** Letting it do so hands the
quorum-diversity lever to whatever served the page — the same class as §2, on the
field that matters most. It deserves the care `userPrivateKey` already gets: *an
address, and never an identity* (`tab-api.ts:580-582`).

Note the intended good case: two tabs, one passphrase, **same** `operatorId` collapse
into one quorum slot, which is correct. **Different** `operatorId`s count as two
independent failure domains — for free, which is the abuse.

## 4. A stable `userKey` makes a dormant limiter live

The per-user limiter keys on `request.userKey` (`enrollment.ts:844-857`). Today it is
never approached because per-tab user keys are random — `enrollment.ts:65-66` records
twenty requests under twenty distinct keys all succeeding and deleting the guard
changing nothing.

Make `userKey` stable per passphrase and it becomes live **for the first time**,
shared across every tab, device and browser profile of one owner. One human opening
`maxPerWindow + 1` tabs in a window gets `rate-limited`.

**Size this before shipping.** It is a functional regression, not a security one.

## 5. Do not design against `cert-lifecycle.ts`

`packages/core/src/index.ts:446` records it: *"`cert-lifecycle.ts` is imported by
nothing in the production corpus — measured, and it is one of 27 such modules."* Its
`Csr`, `Chain`, `Certificate`, `Revocation`, `RevocationStatus` types are a design
probe.

In particular **revocation exists as a type there and nowhere in production**. The
only withdrawal mechanism is expiry; on a relay the window is the reservation TTL,
floored at ~30 s (`relay-admission.ts:117-145`).

Also: a guard forbids barrel exports declared in that file
(`reachability-guard.node.test.ts:699-705` asserts `.toEqual([])`), because doing so
would take an owner non-decision by side effect. A derivation helper must live in a
new module.

## 6. Claims that are conventions, not properties — do not lean on them

- **`userKey` means a user consented.** `ownerProof` is checked once by the issuer
  (`enrollment.ts:832`) and is **not a field of `NodeCertificate`** (`:161-205`). No
  relying party can re-derive it. Downstream this is issuer trust wearing the clothes
  of a proof.
- **`issuerKey !== nodeKey`.** Held by file layout (`.provider.key` vs
  `.identity.key`, `fabric-node.ts:253`) and by no check in `enrollment.ts`. Pinning
  issuer X silently admits X's own node.
- **Sovereign placement is a security boundary.** `eligibleNodes`
  (`packages/core/src/sovereignty.ts:191`) compares `ownerId` and
  `canExecuteSovereign` — two plain values — and never reads the `certificate` it
  carries. The cryptography is upstream at discovery.
- **Peers are verified.** `PeerVerifier` returns every connected peer when no issuer is
  pinned — `peer-verifier.ts:415` returns the verifier early on an empty anchor set — and
  nothing is pinned by default. **The last clause of this bullet read *"`BrowserNodeOptions`
  has no `trustedIssuers` field at all"* and is FALSE as of 2026-08-14** (corrected
  2026-08-16): the field exists at `browser-node.ts:242`, `PeerVerifier` reads it
  (`peer-verifier.ts:299`), and `demo/main.ts:550` passes it — but only once the tab has
  enrolled, so on the visitor path the pinned set is still empty and the fail-open above is
  what a visitor gets. The capability is built; the visitor wiring is what is missing.
- **Results are attributable.** `attestResults` returns `inner` unchanged for
  `'signs-nothing'` (`attesting-executor.ts:85-86`), and an unverifiable receipt does
  not fail a shard (`submit.ts:1132-1145`). Attestation is a report, not a gate.

## 7. Document/code divergence found

`.planning/THREAT-MODEL.md:59` lists forged-node-certificate as **built** —
*"Offline verification against pinned provider keys"*. True where anchors are pinned.
**The default node pins nothing and `PeerVerifier` fails open.** The row states a
mechanism; the deployed posture is the opposite. Not corrected here — recorded.

**Amended 2026-08-16.** This sentence also read *"and the browser tier has no
`trustedIssuers` field"*, which was true when written and became false on 2026-08-14 —
see §6. The divergence it reports is unchanged and is not narrowed by that: a field that
exists and is passed only by an already-enrolled tab still leaves every visitor
fail-open, which is exactly the posture this section says the threat-model row
contradicts. `demo/main.ts:302` already carries the same correction against the same
quoted sentence, so the code knew and this document did not — which is the failure mode
this file exists to prevent in the next design round.
