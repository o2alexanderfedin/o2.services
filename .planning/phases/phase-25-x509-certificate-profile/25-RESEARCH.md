---
phase: 25
researched: 2026-08-09
---

# Phase 25: X.509 Certificate Profile — Research

**Domain:** Hand-written DER/ASN.1 decoding for a fixed X.509 v3 + Ed25519 (RFC 8410)
certificate profile, in a browser-and-Node TypeScript codebase.
**Confidence:** MEDIUM-HIGH — the ASN.1/DER rules are HIGH confidence (primary specs,
cross-checked); the numeric byte ceilings are MEDIUM (computed from a real measured
skeleton plus a proposed field design that is this project's to accept or adjust); the
bundle-cost guard design is MEDIUM (no existing precedent in this repo to copy, built
by analogy to `MAX_PARTIAL_BYTES`/`MAX_CHAIN_DEPTH`).

## Summary

The owner ruling (`ROADMAP.md` Phase 25, `docs/architecture/RFC-0003-REVIEW-praxis-2026-08-06.md`
"Owner ruling of 2026-08-06") is not open for re-argument: X.509 v3 is adopted as the
certificate envelope, `NodeCertificate` (`packages/core/src/enrollment.ts:158`) stays
as the working format behind a version tag, and a bounded hand-written DER decoder is
built for exactly this profile — not `pkijs`, not `asn1js`, not `@peculiar/x509`, not
`node-forge`. All four are confirmed absent from every `package.json` in the tree
(`[VERIFIED: package.json audit]`, this session).

The research below answers what "exactly this profile" requires, sited against RFC
5280 (the X.509 v3 certificate structure), RFC 8410 (Ed25519 in X.509), and ITU-T
X.690 (BER/CER/DER encoding rules) — plus a real Ed25519 certificate generated locally
with OpenSSL 3.6.2 to ground the byte arithmetic in a measured skeleton rather than an
estimate.

**Primary recommendation:** the decoder needs to understand exactly 12 ASN.1
tags/constructs (§1), never a general `SEQUENCE OF`/`CHOICE` grammar for the custom
extension payloads — those should carry **canonical dag-cbor** (`@ipld/dag-cbor`,
already a dependency, already this project's determinism boundary) inside an opaque
`OCTET STRING`, so the hand-written parser's real surface is the fixed ~140-byte RFC
5280 skeleton, not an open-ended schema (§3). DER canonicalisation is proved the way
the ruling already specifies — decode, then re-encode in the one canonical form, then
`Buffer.compare`/byte-equality against the input — and every one of the five classic
DER-vs-BER divergences is caught by that single check with no per-rule special case
needed (§2). A concrete worked certificate, built from a real measured 301-byte OpenSSL
skeleton plus this profile's four required custom extensions at generous field caps,
totals **≈1.6 KB**; a `MAX_CERTIFICATE_BYTES = 4096` ceiling leaves ~2.5× headroom on
that number (§4). Certificate verification today has exactly five production call
sites, and every one of them sits at relay admission, discovery/selection, or
post-execution attestation comparison — **never between a task's arrival and
`WebAssembly.instantiate`** — so "off the execution path" is a claim this phase can
prove against the current tree, not merely assert (§6).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DER decode / X.509 parse | Browser + Node (shared, `@o2/core`) | — | `verifyCertificate` today lives in `@o2/core`, a pure module with no platform imports; the decoder must stay there so both tiers share one code path, per this repo's "one codebase, three targets" rule |
| Certificate issuance (signing) | Node (`EnrollmentAuthority`, provider role) | Browser (a browser tab can also run a provider — nothing in `enrollment.ts` is Node-only) | Issuance is CPU-light (one Ed25519 sign); no tier restriction exists today and the profile must not introduce one |
| Certificate verification (admission/selection) | Node + Browser (`@o2/core`, called from `@o2/net`, `@o2/libp2p`, `@o2/node`) | — | Five real call sites (§6), all outside the per-task execution path; the decoder runs wherever `verifyCertificate` already runs today |
| Bundle-size guard | Browser build tooling (`vite`, `packages/browser/vite.config.ts`) | Node (CI script reading `dist/` output) | The cost the ruling names is specifically "bundle weight added to the **browser tier**"; the guard must run against the actual Vite output, not against source size |
| Byte-ceiling pre-parse checks | `@o2/core` (same module as the decoder) | — | Follows `MAX_CHAIN_DEPTH`'s established pattern: checked before any parse/signature work, because the length is attacker-supplied |

## Project Constraints (from CLAUDE.md)

- **ESM only, strict TypeScript, Node 24-target, one codebase for browser + Node +
  embedded.** The decoder must be a pure module with no platform imports (matches
  `capability.ts`'s and `enrollment.ts`'s existing "Pure module" docblock convention)
  so it needs no `browser`/Node build-condition split.
- **Concurrent-agent git discipline** (explicit-path commits, stage-between-runs-not-
  during, surgical-inverse mutation restores, no parallel planting on shared files) —
  binding on execution, not on this research artifact, but the plan this research
  feeds must sequence any planted-mutation proofs so no two run concurrently on the
  same file, per the existing rule that bit Phase 13.1/24 twice.
- **Proofs convention**: "a proof that cannot fail is not a proof" — every one of the
  seven obligations (six new + the one already delivered) needs a planted mutation
  watched red, then restored and `cmp`-verified, not a checklist satisfied in prose.
  This governs how Obligation 3 (DER canonicalisation) must be proved: a re-encode
  round-trip test, not a rule-by-rule assertion list.
- **Measurement convention**: never trust an unread exit code; prefer comparative
  readings; measure the process, not the machine. Applies directly to the bundle-size
  guard (§5) — it must compare a captured before/after delta within one build run,
  not an absolute number sited against nothing.

## User Constraints (from 25-CONTEXT.md)

### Locked Decisions

- A bounded, hand-written DER decoder covering exactly this profile. Not `pkijs`, not
  `asn1js`, not `@peculiar/x509`.
- The decoder runs in the browser tab, but off the execution path — certificate
  verification happens at admission and discovery, never per dispatched task.
- Bundle cost is guarded, not merely reported — a measured ceiling with a test that
  fails when exceeded.
- Coexists with the current envelope behind a version tag; X.509 is additive, not a
  replacement. `NodeCertificate` (`enrollment.ts:158`) keeps working.
- Obligation 1 (permitted algorithms): Ed25519 only, an allow-list of one.
- Obligation 2 (bans): SHA-1, P-192, P-224, RSA < 2048 refused *by name*, each with its
  own test.
- Obligations 4 and 6 (parsing and extension limits): fixed byte ceilings on whole
  certificate, each extension, and extension count — checked before any parse.
- Obligation 7 (duplicate extensions): refused outright, no last-wins, no warning.
- Obligation 3 (DER canonicalisation): proved by re-encoding and comparing bytes.
- Refusals surface as a typed discriminated union, matching `verifyChain`'s
  `{kind: 'too-deep', depth, limit}` shape. Not thrown errors, not reason strings.
- A new `X509-01…07` requirement family, one per obligation, traced in
  `REQUIREMENTS.md`.
- Obligation 5 (max chain depth) is already delivered — `capability.ts:127/190` — and
  is recorded, not re-implemented.

### Claude's Discretion

- Module placement, decoder internals, the exact numeric ceilings (to be sited against
  real certificate sizes rather than guessed), and the test file layout.

### Deferred Ideas (OUT OF SCOPE)

- RFC-0003 §2's optional external CA, and the §2/§4 tension over critical unknown
  extensions. Not reconciled in this phase.

<phase_requirements>
## Phase Requirements

No requirement IDs were supplied to this research pass — `ROADMAP.md`'s own Phase 25
entry states `**Requirements**: none yet — this phase opens them`, and
`25-CONTEXT.md` confirms a new `X509-01…07` family is minted during planning, one per
obligation. The mapping below is a proposed correspondence between the seven named
obligations and this research's findings, for the planner to mint IDs against.

| Obligation | Proposed ID | Research Support |
|---|---|---|
| 1 — permitted algorithms: Ed25519 only | X509-01 | §1 (OID allow-list of exactly `1.3.101.112`) |
| 2 — bans: SHA-1, P-192, P-224, RSA<2048 named | X509-02 | §1 (the decoder never implements SHA-1/EC/RSA OID branches at all — refusal is "unrecognised algorithm", and each ban gets its own planted-OID test per the Conventions proof rule) |
| 3 — DER canonicalisation | X509-03 | §2 (re-encode/compare strategy, five concrete divergence classes) |
| 4 — certificate parsing limits | X509-04 | §4 (`MAX_CERTIFICATE_BYTES`, checked pre-parse) |
| 5 — max chain depth | X509-05 | already delivered, `capability.ts:127/190` — recorded, not researched here |
| 6 — extension size limits | X509-06 | §4 (`MAX_EXTENSION_BYTES`, `MAX_EXTENSION_COUNT`) |
| 7 — duplicate extensions refused | X509-07 | §1/§3 (decoder tracks seen `extnID`s during the single parse pass; a repeat is a refusal, not a last-wins overwrite) |
</phase_requirements>

---

## 1. The minimum DER/ASN.1 subset

**RFC 5280 §4.1** gives the `Certificate`/`TBSCertificate` ASN.1 module
`[CITED: rfc-editor.org/rfc/rfc5280]`:

```asn1
Certificate  ::=  SEQUENCE  {
     tbsCertificate       TBSCertificate,
     signatureAlgorithm   AlgorithmIdentifier,
     signatureValue       BIT STRING  }

TBSCertificate  ::=  SEQUENCE  {
     version         [0]  EXPLICIT Version DEFAULT v1,
     serialNumber         CertificateSerialNumber,
     signature            AlgorithmIdentifier,
     issuer               Name,
     validity             Validity,
     subject              Name,
     subjectPublicKeyInfo SubjectPublicKeyInfo,
     issuerUniqueID  [1]  IMPLICIT UniqueIdentifier OPTIONAL,
     subjectUniqueID [2]  IMPLICIT UniqueIdentifier OPTIONAL,
     extensions      [3]  EXPLICIT Extensions OPTIONAL }

Validity ::= SEQUENCE { notBefore Time, notAfter Time }
Time ::= CHOICE { utcTime UTCTime, generalTime GeneralizedTime }
AlgorithmIdentifier ::= SEQUENCE { algorithm OBJECT IDENTIFIER, parameters ANY DEFINED BY algorithm OPTIONAL }
SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
Extensions ::= SEQUENCE SIZE (1..MAX) OF Extension
Extension ::= SEQUENCE { extnID OBJECT IDENTIFIER, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }
```

**RFC 8410 §3–4** gives the Ed25519 algorithm identifier
`[CITED: rfc-editor.org/rfc/rfc8410]`:

- `id-Ed25519 OBJECT IDENTIFIER ::= { 1 3 101 112 }` — DER content bytes `2B 65 70`
  (already independently confirmed against a real OpenSSL-generated certificate,
  `[VERIFIED: local OpenSSL 3.6.2 build]`, below).
- **"For all of the OIDs, the parameters MUST be absent"** — both in the SPKI's
  `AlgorithmIdentifier` and the signature's `AlgorithmIdentifier`. A parser that
  tolerates a present (even `NULL`) `parameters` field for `id-Ed25519` is accepting a
  non-conformant encoding by RFC 8410's own text, and is itself a named pitfall (RFC
  8410 §10: *"It is possible to find systems that require the parameters to be
  present... due to either a defect in the original 1997 syntax or a programming
  error"*).
- The public key is the **raw 32-byte value placed directly in the `BIT STRING`**, with
  no `OCTET STRING` wrapper around it (the private-key encoding in RFC 8410 §7 does use
  an `OCTET STRING`; the public key in `SubjectPublicKeyInfo` does not — do not conflate
  the two).
- The signature is likewise the raw 64-byte Ed25519 signature placed directly in the
  outer `BIT STRING`, unwrapped.

### Tags/constructs the decoder MUST handle

| # | ASN.1 construct | DER tag byte | Where it appears in this profile |
|---|---|---|---|
| 1 | `SEQUENCE` (constructed) | `0x30` | `Certificate`, `TBSCertificate`, `AlgorithmIdentifier` (×2), `Validity`, `Name` (×2), `SubjectPublicKeyInfo`, `Extensions`, `Extension` (×N), each RDN's `AttributeTypeAndValue` |
| 2 | `SET` (constructed) | `0x31` | `RelativeDistinguishedName` — decode the tag, but **refuse any RDN with more than one `AttributeTypeAndValue`** (see below — this sidesteps DER's `SET OF` sort-order rule entirely) |
| 3 | `INTEGER` | `0x02` | `version` (inner value, wrapped by `[0]`), `serialNumber` |
| 4 | `BIT STRING` | `0x03` | `subjectPublicKey`, `signatureValue` |
| 5 | `OCTET STRING` | `0x04` | `Extension.extnValue` |
| 6 | `OBJECT IDENTIFIER` | `0x06` | signature/SPKI algorithm OIDs, `extnID` values, the one `id-at-commonName` (`2.5.4.3`) AttributeType this profile needs |
| 7 | `UTCTime` | `0x17` | `notBefore`/`notAfter` (RFC 5280 §4.1.2.5 mandates UTCTime for all dates through 2049) |
| 8 | `GeneralizedTime` | `0x18` | **decode-and-refuse only** — RFC 5280 mandates GeneralizedTime for dates ≥2050; since this profile's certificate lifetimes are short (30-day default per `enrollment.ts`'s `certificateLifetimeMs`), a `GeneralizedTime` field is never legitimate here and its presence is itself a refusal, not a silently-accepted alternate encoding |
| 9 | `BOOLEAN` | `0x01` | `Extension.critical` |
| 10 | `UTF8String` | `0x0C` | `AttributeTypeAndValue.value` — **refuse every other string type** (`PrintableString` 0x13, `IA5String` 0x16, `T61String`, `BMPString`, `UniversalString`, etc.); since this profile controls both issuance and verification, mandating exactly one string type removes an entire class of "which string type did the CA use" ambiguity that public-CA-facing parsers must tolerate and this one does not have to |
| 11 | context `[0]` EXPLICIT (constructed) | `0xA0` | wraps `version` |
| 12 | context `[3]` EXPLICIT (constructed) | `0xA3` | wraps `extensions` |

### Tags/constructs the decoder MUST refuse outright (never attempt to interpret contents)

- **Indefinite length** (length octet `0x80`) — BER-only; DER forbids it (X.690 §10.1,
  cross-verified below). Refuse on sight of the length-octet pattern, before touching
  content.
- **`[1]`/`[2]` context tags** (`issuerUniqueID`/`subjectUniqueID`) — RFC 5280 §4.1.2.8:
  *"CAs conforming to this profile **MUST NOT** generate certificates with unique
  identifiers"* `[CITED: rfc5280 §4.1.2.8]`. A certificate carrying either is
  non-conformant by the spec this profile is built against; refuse rather than skip.
- **Any `AlgorithmIdentifier` OID other than `1.3.101.112`** — this is Obligation 1/2's
  enforcement point. The decoder does not need SHA-1, P-192, P-224, or any RSA OID
  branch implemented at all; "unrecognised algorithm OID" is the one refusal path that
  covers every banned algorithm by construction. Each ban still gets its own named
  test (per `25-CONTEXT.md`) by planting the specific OID bytes and asserting the same
  named refusal kind fires.
- **Any `extnID` not in this profile's own fixed registry** (default-deny, matching
  the project's established pattern for closed sets — e.g. `RelayAdmission`'s "no
  empty-means-everyone" design).
- **A present `parameters` field on the Ed25519 `AlgorithmIdentifier`** (RFC 8410 §10,
  above) — refuse even a `NULL` parameters value, which is the specific legacy-tolerant
  behaviour RFC 8410 warns some systems wrongly require.
- **Multi-valued RDNs** (an RDN `SET` containing more than one `AttributeTypeAndValue`)
  — legal in X.509 generally, unneeded by this profile, and refusing it removes the
  need to implement DER's `SET OF` canonical-sort rule (X.690 §11.6) at all, since a
  single-element set has no ordering question.
- **High-tag-number form** (tag byte's low 5 bits all `1`) — none of the 12 tags above
  need it; refuse any tag byte matching that pattern as out-of-profile.

**Why this is smaller than it looks:** every custom extension payload (`userKey`,
`operatorId`, `discoverability`, `relayIds` — see §3) is recommended to be an opaque
`OCTET STRING` whose *contents* are canonical dag-cbor, not nested ASN.1. That means
the decoder never needs a general `SEQUENCE OF` grammar for anything except the one
fixed `Extensions` list RFC 5280 already defines, and never needs `CHOICE`,
`ENUMERATED`, or any string type beyond `UTF8String`. The "minimum subset" is
genuinely minimal: 12 tag types, all fixed-position within one fixed grammar, no
recursive schema.

## 2. DER canonicalisation rules that actually bite

DER (ITU-T X.690, the same standard covering BER/CER) adds five canonicalisation
constraints on top of BER that a lenient (BER-tolerant) parser will accept and a
DER-strict one must not `[CITED: itu.int X.690; cross-checked against multiple
technical summaries — the RFC text itself was not fetched directly this session, so
exact clause wording is MEDIUM confidence, the *existence and substance* of each rule
is HIGH confidence from convergent independent sources]`:

| # | Rule | What a lenient parser accepts that DER forbids | How the re-encode/compare round-trip catches it |
|---|---|---|---|
| 1 | **Definite length only** | Indefinite-length encoding (length octet `0x80`, content terminated by two zero octets) — legal BER, illegal DER | The decoder's own re-encoder only ever emits definite-length TLVs. Any indefinite-length input either fails to decode structurally (it's a different byte pattern from what the decoder expects) or, if tolerated, re-encoding it canonically produces different bytes than the indefinite-length input — mismatch, refused. **Simplest to refuse at the length-octet check itself**, before re-encoding is even attempted, since `0x80` as a length byte is unambiguous. |
| 2 | **Minimal-length encoding** | A length like `127` encoded in long form (`0x81 0x7F`) instead of short form (`0x7F`) — both decode to the same value under BER, only the short form is DER-canonical | Re-encoder always chooses the minimal form for the given length. Input using the non-minimal form decodes to the same *value* but re-encodes to fewer bytes — byte mismatch, refused. |
| 3 | **Minimal-length INTEGER (no unnecessary leading `0x00`/`0xFF`)** | An `INTEGER` value padded with a redundant leading `0x00` (when the high bit of the first content byte is already `0`) or redundant `0xFF` (for negatives) | Re-encoder always emits the minimal two's-complement form. A padded input decodes to the same numeric value but re-encodes shorter — byte mismatch, refused. This is the classic "signature malleability" class of bug in ECDSA DER parsers (Bitcoin's BIP66 strict-DER rule exists for exactly this reason, `[CITED: known prior art, not fetched this session]`) — not directly this profile's concern since Ed25519 signatures are raw fixed-length `BIT STRING`s with no `INTEGER` components, but `serialNumber` **is** a DER `INTEGER` and is exactly this exposure. |
| 4 | **`BIT STRING` unused-bits octet must be `0` whenever the content is a whole number of bytes** | A `BIT STRING` whose content is byte-aligned (both `subjectPublicKey` and `signatureValue` here always are — 32 and 64 raw bytes respectively) but whose unused-bits count byte is a nonzero value with the "unused" trailing bits set to non-zero garbage instead of `0` | Re-encoder always emits `0x00` as the unused-bits byte for a byte-aligned `BIT STRING` and zeroes any padding bits. Garbage padding bits re-encode to zero — byte mismatch, refused. This is a real-world attack surface: garbage in unused bits is invisible to the *value* the BIT STRING represents but changes the DER byte stream, which matters if this profile ever hashes or CID-addresses the raw certificate bytes. |
| 5 | **`SET OF` canonical ordering** | Elements of a `SET OF`/`SET` listed in an order other than ascending-by-DER-encoding | Sidestepped entirely for this profile by refusing multi-valued RDNs outright (§1) — there is never more than one element in the one `SET` this profile uses, so there is no ordering question to get wrong in either direction. If a future revision needs multi-valued RDNs, the re-encode/compare check still catches it: the re-encoder sorts, a non-canonically-ordered input re-encodes to different bytes, refused. |

**The general strategy, stated once:** decode faithfully (preserve every semantic
value exactly as given), then re-serialize using *only* the canonical form for every
rule above, then compare the re-serialized bytes to the original input bytes
byte-for-byte. Any of the five divergences — and any other DER-vs-BER divergence not
enumerated above, since the list is not claimed exhaustive — produces a byte mismatch
and is refused by the *same* single check, with no per-rule special-cased assertion
needed in the decoder itself. This is exactly what `25-CONTEXT.md`'s Obligation 3
specifies: *"A round-trip that must be byte-identical, rather than a checklist of
encoding rules that can be satisfied in prose."* The checklist above exists so the
planner can write one planted-mutation test per row (per the Conventions "a proof that
cannot fail is not a proof" rule) — each row is a distinct byte-level mutation to
plant into an otherwise-valid certificate, watched red against the round-trip check,
then restored.

**Boolean canonicalisation**, not in the ruling's explicit list but adjacent and cheap
to fold into the same check: DER requires `BOOLEAN` `TRUE` to be encoded as exactly
`0xFF` (BER permits any nonzero byte). `Extension.critical` is this profile's one
`BOOLEAN` field; the same re-encode/compare check catches a non-`0xFF` "true" value for
free.

## 3. Mapping `NodeCertificate` fields into X.509

`NodeCertificate` (`packages/core/src/enrollment.ts:158-177`) has eight fields.
`payloadOf` (`:179-193`) shows exactly what is currently signed.

| `NodeCertificate` field | X.509 mapping | Notes |
|---|---|---|
| `nodeKey: PublicKeyHex` | **Standard**: `subjectPublicKeyInfo.subjectPublicKey` (raw 32 bytes, RFC 8410-shaped SPKI) | This is the one field X.509 already has a first-class slot for. No custom extension needed. |
| `issuedAt: number` / `expiresAt: number` | **Standard**: `validity.notBefore` / `validity.notAfter` (`UTCTime`) | Certificate lifetimes are short (30-day default) so dates never approach 2050; `UTCTime` suffices and `GeneralizedTime` can be refused outright (§1). Unix-millisecond `number` → `UTCTime`'s `YYMMDDHHMMSSZ` is a lossy-to-seconds conversion the encoder/decoder must round appropriately and consistently in both directions (round down on encode, so a re-encoded decoded value never claims validity *earlier* than intended). |
| `issuer: PublicKeyHex` | **Standard**: `issuer` `Name` (single-RDN, `commonName` = the 64-hex-char provider key) | X.509's `issuer` field is a `Name`/DN, not a raw key — reusing the existing hex string as the sole `commonName` value keeps the certificate's `issuer` field byte-comparable to today's `PublicKeyHex` string with a trivial hex-string equality check, rather than inventing a DN scheme. `subject` gets the identical treatment using `nodeKey`. |
| `userKey: PublicKeyHex` | **Custom extension** (private OID arc, non-critical unless the profile decides otherwise) | X.509 has no second-public-key slot. Extension payload: raw 32 bytes, or canonical-dag-cbor-wrapped hex string — recommend raw 32 bytes directly in the `OCTET STRING` (smallest, no dag-cbor overhead needed for a single fixed-length value). |
| `operatorId: string` | **Custom extension** | Free-text identifier; needs its own byte cap (§4) since it is otherwise unbounded (`AuthorityOptions`/`EnrollmentRequest` place no length limit on it today — `[VERIFIED: enrollment.ts, grep for operatorId]` shows no existing length validation, which is itself worth flagging to the planner as a pre-existing gap this phase's byte ceiling would newly close). |
| `discoverability: Discoverability` | **Custom extension** | Two-value enum (`'seed' \| 'via-relay'`); encode as one payload byte (`0x00`/`0x01`) rather than a string, smallest possible encoding. |
| `relayIds: readonly string[]` | **Custom extension** | Variable-length array, currently *fully* unbounded in `enrollment.ts` (no cap on count or per-ID length anywhere in the current code — `[VERIFIED: grep]`). This is the one field that most needs both a per-item and a count cap (§4), and is the strongest candidate for canonical-dag-cbor-in-`OCTET STRING` encoding, since it is the one field genuinely variable-shaped. |
| `signature: string` | **Standard**: `Certificate.signatureValue` (`BIT STRING`, raw 64 bytes) + `Certificate.signatureAlgorithm` (`id-Ed25519`) | Direct. |

### OID arc recommendation

RFC-0003 §12 (`docs/architecture/RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md:301-317`)
already names this open item: *"A private enterprise OID arc should be allocated for
the project."* An IANA Private Enterprise Number (PEN) requires registration and a
wait. **A registration-free alternative exists and is standards-track**: ITU-T X.667 /
ISO/IEC 9834-8's `{joint-iso-itu-t uuid(25)}` arc (OID prefix `2.25`) lets any
generated UUID become a valid, globally-unique OID arc component with **zero central
registration** — *"the 16 octets of a UUID can be interpreted as an unsigned integer...
without formal registration"* `[CITED: itu.int X.667; oid-info.com/get/2.25;
alvestrand.no/objectid/2.25.html — three independent sources converge]`. Recommended:
generate one UUID for this project (`crypto.randomUUID()`), publish it once (e.g. in
this profile's own module docblock, the way `MAX_CHAIN_DEPTH`'s siting is documented
inline), and use `2.25.<uuid-as-decimal>.<n>` for the four extension OIDs (`.1` =
userKey, `.2` = operatorId, `.3` = discoverability, `.4` = relayIds). DER encoding
cost: the UUID arc component needs ~19 bytes in base-128 VLQ form (128 bits ÷ 7
bits/byte, rounded up) — larger than a typical short enterprise-arc OID, but the
absolute byte cost (~23 bytes per `extnID` including tag/length) is immaterial against
the byte ceilings in §4. **This is a design recommendation for the planner's
discretion, not a locked decision** — `25-CONTEXT.md` leaves "module placement,
decoder internals" to Claude's discretion and does not mention OID allocation
specifically, so flag it as open for the planner to confirm rather than treat as
settled.

## 4. Byte ceilings

### Measured baseline

A real Ed25519 self-signed certificate was generated locally to ground the arithmetic
in a measured skeleton rather than an estimate:

```
$ openssl genpkey -algorithm ed25519 -out ed25519.key
$ openssl req -x509 -key ed25519.key -days 30 -subj "/CN=n" -noenc \
    -addext "basicConstraints=critical,CA:FALSE" -out cert_min.pem
$ openssl x509 -in cert_min.pem -outform DER -out cert_min.der
$ wc -c cert_min.der
     301 cert_min.der
```

`[VERIFIED: OpenSSL 3.6.2, this session]`. `openssl asn1parse` on the DER output
confirms the exact byte layout: `TBSCertificate` content (including three default
extensions — Subject Key Identifier, Authority Key Identifier, Basic Constraints —
that this profile does not need) is 220 bytes; without those three default
extensions, the arithmetic below shows the TBS skeleton (version + serialNumber +
signature-AlgorithmIdentifier + issuer + validity + subject + SPKI, **no
extensions**) is **140 bytes**, and the full `Certificate` wrapper (TBS + outer
`AlgorithmIdentifier` + `signatureValue`) with zero extensions is **216 bytes**.

### Worked total for this profile's actual field set

Standard-field skeleton (measured/derived from the OpenSSL output above, single-RDN
`commonName` using the 64-hex-char key strings per §3's mapping):

| Field | Bytes | Basis |
|---|---|---|
| `version` (`[0]` wraps `INTEGER 2`) | 5 | measured |
| `serialNumber` (assume 8-byte value, within the 20-octet RFC 5280 ceiling) | 10 | measured pattern, recomputed for 8 bytes |
| `signature` `AlgorithmIdentifier` (inner, Ed25519, no params) | 7 | measured |
| `issuer` `Name` (single RDN, `commonName` = 64-hex-char string) | 77 | computed: `AttributeTypeAndValue` = OID(5) + UTF8String(66) = 71 + hdr(2) = 73; RDN `SET` = 73 + hdr(2) = 75; `Name` `SEQUENCE` = 75 + hdr(2) = 77 |
| `validity` (two `UTCTime`) | 32 | measured |
| `subject` `Name` (identical shape, `nodeKey`) | 77 | as above |
| `subjectPublicKeyInfo` | 44 | measured |
| **TBS core subtotal** | **252** | sum of the above |
| `signatureAlgorithm` (outer) | 7 | measured |
| `signatureValue` `BIT STRING` (64-byte raw Ed25519 sig) | 67 | measured |

Custom extensions (per §3's mapping, `2.25.<uuid>.<n>` OIDs at ~23 bytes each, each
`Extension` `SEQUENCE` = `extnID`(23) + `critical` `BOOLEAN`(3, explicit) +
`extnValue` `OCTET STRING`):

| Extension | Payload | `extnValue` TLV | `Extension` total |
|---|---|---|---|
| `userKey` (raw 32 bytes) | 32 | 34 | 62 |
| `operatorId` (capped at 64 bytes, UTF8 string in `OCTET STRING`) | 64 | 66 | 94 |
| `discoverability` (1 byte) | 1 | 3 | 31 |
| `relayIds` (capped: 8 items × 128 bytes each, canonical dag-cbor array) | ~1042 (8×130 + array overhead) | ~1046 | ~1075 |
| **Extensions subtotal** | | | **≈1262** |

Total certificate: TBS core (252) + extensions wrapper overhead (`[3]` context tag +
inner `SEQUENCE` header, ~7 bytes at this content size) + extensions (1262) + outer
`signatureAlgorithm` (7) + `signatureValue` (67) + outer `SEQUENCE`/length-form
overhead (~6 bytes across the nested headers that cross the 127-byte long-form
threshold) ≈ **1612 bytes**.

**This arithmetic is a worked example against a proposed field design (§3), not a
measurement of code that exists yet** — the exact numbers move if `operatorId`'s cap,
`relayIds`' count/per-item cap, or the OID arc choice change. It is cited here as the
"sited, not guessed" basis `25-CONTEXT.md` asks for, and the planner should treat the
individual caps (64 bytes/operatorId, 8×128 bytes/relayIds) as proposals to confirm,
not settled values.

### Recommended ceilings

| Ceiling | Recommended value | Headroom over worked total | Basis |
|---|---|---|---|
| `MAX_CERTIFICATE_BYTES` | **4096** | ≈2.5× over the ≈1612-byte worked total | Matches the sizing philosophy `MAX_CHAIN_DEPTH`'s docblock establishes ("sited, not picked" — a stated multiple of the deepest/largest real case, not a round number pulled from nowhere) |
| `MAX_EXTENSION_BYTES` | **2048** | ≈1.9× over the worst single extension (`relayIds` at ≈1075 bytes) | Covers the worked `relayIds` extension with margin for a slightly larger `relayIds` cap without needing to move this constant |
| `MAX_EXTENSION_COUNT` | **8** | 2× over the 4 custom extensions this profile actually issues | This profile needs exactly 4 (`userKey`, `operatorId`, `discoverability`, `relayIds`); 8 leaves room for one profile-version bump without immediately requiring the constant to move, while still bounding a padding attack tightly — an attacker cannot pad a certificate past ~8 duplicate-`extnID`-shaped entries before Obligation 4's whole-certificate byte ceiling fires first anyway |

All three checked **before any parse**, per `25-CONTEXT.md`'s Obligation 4/6 wording
and the `MAX_CHAIN_DEPTH` precedent it explicitly points to (`capability.ts:188-191`'s
comment: *"Before any signature work: the length is attacker-supplied, and this is the
cheapest possible refusal"*).

**UNVERIFIED / open for planner decision:** the `operatorId` cap (64 bytes) and the
`relayIds` cap (8 items × 128 bytes) are this research's proposal, sited against the
existing `MAX_CHAIN_DEPTH`/`MAX_PARTIAL_BYTES` sizing philosophy in this codebase, but
`enrollment.ts` places no length limit on either field today — so these two caps are
themselves a **new constraint being introduced**, not a pre-existing one being encoded.
The planner should confirm these numbers do not break any existing fixture (e.g.
`bin/agent.ts`'s `--owner-key` flow, any test `operatorId` string, any test relay list)
before adopting them.

## 5. Bundle-cost measurement

`packages/browser/vite.config.ts` builds via `npm run build:demo` →
`vite build --config packages/browser/vite.config.ts`, output to
`packages/browser/dist/`. Running it against the current tree
(`[VERIFIED: this session, `npm run build:demo`]`) produced:

```
packages/browser/dist/index.html                                 8.48 kB │ gzip:   3.33 kB
packages/browser/dist/assets/task-executor.worker-4_otNw9c.js   46.39 kB
packages/browser/dist/assets/cid-BcLH9ugF.js                     0.05 kB │ gzip:   0.07 kB
packages/browser/dist/assets/src-Ch4gz3fX.js                     0.13 kB │ gzip:   0.12 kB
packages/browser/dist/assets/cid-BXpsijIc.js                    12.84 kB │ gzip:   4.69 kB
packages/browser/dist/assets/src-k9ARJXDJ.js                   112.54 kB │ gzip:  39.42 kB
packages/browser/dist/assets/index-BZONV41Y.js                 601.22 kB │ gzip: 168.93 kB
```

The main chunk (`index-*.js`) is **601.22 kB raw / 168.93 kB gzip** — this already
includes today's `verifyCertificate`/`@noble/curves` Ed25519 code, since
`packages/browser/demo/main.ts` already imports and calls `verifyCertificate`
(`main.ts:44,350`). So this baseline is the correct "before" figure for measuring
what a DER decoder specifically *adds*, not a figure that needs Ed25519-cost
subtracted out separately.

**Caveat on this baseline's cleanliness:** it was captured against the current working
tree, which per `git status` has uncommitted changes to
`packages/browser/demo/main.ts` and `packages/browser/src/tab-api.ts` unrelated to
this phase. The planner/executor should re-capture this baseline from a clean checkout
of Phase 25's actual base commit before treating it as the frozen "before" number a
guard test compares against — the exact number will shift slightly, the methodology
below does not.

**No existing test in this repository measures bundle size.** Confirmed by grepping
every `*.test.ts` file for `bundle`/`size`/`byte`/`statSync` patterns
(`[VERIFIED: this session]`) — the closest existing artifact,
`packages/node/src/built-bundle.e2e.test.ts`, serves the built `dist/` over a real
static HTTP server and exercises *behaviour* (does the page load, does discovery from
a `?relay=` query param work), never *size*. This phase introduces the first bundle-
size guard in the repository; there is no existing pattern to extend, only the general
`MAX_PARTIAL_BYTES`/`MAX_CHAIN_DEPTH` "measured ceiling, checked, tested" convention to
follow.

### Proposed guard design

1. **Capture a frozen "before" baseline** — the raw and gzip byte size of
   `dist/assets/index-*.js` (the main chunk; Vite's content hash changes the filename
   per build, so the guard must glob `dist/assets/index-*.js` rather than hardcode the
   hash) from a build *before* this phase's decoder code is merged. Store the number
   in source (a constant, the way `MEASUREMENT` data is recorded in
   `vitest.config.ts`), not derived at test time from git history — matching the
   Conventions rule "never write a measured span you did not measure."
2. **Build fixture**: a Node `e2e`-tier test (matching `built-bundle.e2e.test.ts`'s
   tier) runs `vite build` (or asserts a fresh `npm run build:demo` has already run —
   TBD by the planner, since a live build inside a test is slow and CI-order-
   sensitive) and reads the resulting `dist/assets/index-*.js` size with
   `node:fs.statSync`.
3. **Assert a ceiling on the delta**, not on the absolute number, per the Measurement
   convention's "prefer a comparative reading to an absolute one" — e.g. `after -
   before <= DECODER_BUDGET_BYTES`. This is the "guarded, not merely reported" shape
   `25-CONTEXT.md` demands, and it survives Vite/dependency version bumps that would
   otherwise require re-baselining an absolute ceiling constantly.
4. **`DECODER_BUDGET_BYTES` sizing**: **UNVERIFIED** — no comparable hand-written DER
   decoder's minified size was measured this session to ground this number. A
   defensible starting point: the decoder's own source is bounded by design (§1's 12
   tags, one fixed grammar, no general schema engine) and should minify to low
   single-digit KB before gzip — as a point of reference, `asn1js` alone (a *general*
   BER/DER/CER library, much larger surface than this profile needs) has an
   **unpacked** size of 288,975 bytes per the npm registry
   (`[VERIFIED: npm view asn1js dist.unpackedSize]`, distinct from and always larger
   than its minified+gzip browser contribution). The planner should measure the
   decoder's actual contribution once written and set `DECODER_BUDGET_BYTES` from
   that measurement, per the same "never write a measured span you did not measure"
   rule — this research cannot pre-supply a number for code that does not exist yet,
   only the measurement methodology.

## 6. Where certificate verification happens today

Five production (non-test) call sites of `verifyCertificate`, found via
`grep -rn "verifyCertificate" packages --include="*.ts"` and manually inspected
`[VERIFIED: this session]`:

| Call site | What triggers it | Frequency relative to task execution |
|---|---|---|
| `packages/node/src/fabric-node.ts:960` (inside `relayAdmissionGate`) | A peer requesting a **circuit relay reservation** | Once per reservation grant/renewal — `relay-admission.ts`'s own docblock: *"Admission is checked at every reservation **grant**, renewals included; nothing re-checks a peer mid-reservation"*. This is connection-lifecycle-scoped, not task-scoped, and explicitly named in that file as **ADMISSION**, distinct from the four SELECTION sites below. |
| `packages/node/src/peer-verifier.ts:557,688` (`PeerVerifier`) | Peer selection for block-fetch / dial decisions | Per connection-selection event, cached ("a settled acceptance is never re-asked" per `relay-admission.ts`'s citation of this file) — explicitly named **SELECTION**, not admission, in `relay-admission.ts`'s own docblock |
| `packages/core/src/discovery.ts:264` (`discoverExecutors`) | Building the candidate list for a placement decision | Once per discovery/placement round, over the set of *candidate* executors — before any task is assigned to a specific one |
| `packages/core/src/result-attestation.ts:483` (`verifyResultAttestation`) | Comparing a completed task's signed attestation during N-version verification | **After** the executor already ran the task — this is post-hoc receipt verification for the aggregator/verifier's comparison step, not a gate the executing node consults before `WebAssembly.instantiate` |
| `packages/browser/demo/main.ts:350` | Demo UI, checking a freshly-enrolled node's own certificate against its own issuer | One-shot, at enrollment completion, UI-only |

**None of the five sit between a task's arrival at a node and that node's own call to
`WebAssembly.instantiate`.** The capability-chain check that *does* gate
`WebAssembly.instantiate` on the receiving side (`serveAgent`'s `authorize` hook,
per Phase 15) calls `verifyChain` (`capability.ts`) — a different function, over a
different signed structure (`Delegation`, still `@noble/curves`-over-dag-cbor, not
X.509) — confirmed by `grep -n "verifyChain\|verifyCertificate\|authorize"
packages/net/src/agent.ts`: the `exec` branch calls `options.authorize`
(→ `authorizeCapability` → `verifyChain`), never `verifyCertificate`
`[VERIFIED: this session]`.

**This means the "off the execution path" claim in `25-CONTEXT.md` is provable
against the current tree as it stands, not merely a design intention**: the X.509
decoder this phase adds only needs to run wherever `verifyCertificate` already runs
today — relay admission (rare, connection-scoped), discovery (once per placement
round), and post-execution attestation comparison (on the verifying/aggregating node,
never the executing tab, in this project's N-version comparison model). A browser tab
that only ever executes tasks and never relays, discovers on others' behalf, or
verifies attestations would never invoke the new decoder at all — though today's
codebase gives every node "equal functionality" (`enrollment.ts`'s own docblock:
*"All nodes have equal functionality"*), so in practice most nodes will exercise at
least the discovery path.

## 7. Named prior art to avoid

Confirmed absent from every `package.json` in the repository
(`[VERIFIED: this session]`, root manifest + all 8 workspace packages —
`core`, `net`, `libp2p`, `node`, `browser`, `bench`, `demo`, `aot`):

| Package | Present? | npm registry `dist.unpackedSize` | Notes |
|---|---|---|---|
| `pkijs` | **Absent** | 1,940,504 bytes (v3.4.0) | `[VERIFIED: npm view pkijs dist.unpackedSize]`. The ruling's own "a few hundred KB" characterization is for the browser-bundled, minified+gzipped contribution, not this unpacked figure — `bundlephobia.com/package/pkijs` was checked this session but returned HTTP 429 (rate-limited) before a min+gzip figure could be retrieved; **UNVERIFIED** exact min+gzip number, the unpacked size stands as the only independently confirmed figure. |
| `asn1js` | **Absent** | 288,975 bytes (v3.0.10) | `[VERIFIED: npm view]`. `pkijs`'s direct dependency; same min+gzip caveat as above. |
| `node-forge` | **Absent** | 1,647,637 bytes (v1.4.0) | `[VERIFIED: npm view]`. Not named in the ruling's own text but checked as an obvious alternative; also carries RSA/legacy-cipher code this profile has no use for. |
| `@peculiar/x509` | **Absent** | 539,791 bytes (v2.0.0) | `[VERIFIED: npm view]`. Depends on `@peculiar/asn1-schema` (110,257 bytes unpacked, also absent, `[VERIFIED: npm view]`) plus WebCrypto glue. |

**The counterfactual the ruling rejected, stated in the ruling's own words**
(`RFC-0003-REVIEW-praxis-2026-08-06.md`): *"adopting X.509 ships `pkijs` + `asn1js`
into the **browser** trust path: a few hundred KB of exactly the code that generates
CVE classes, at the one boundary that must fail closed."* The unpacked-size figures
above (1.94 MB / 289 KB respectively) are consistent with that characterization as an
order of magnitude, even though the ruling's specific "few hundred KB" wording refers
to the browser-bundled (minified+gzip) contribution rather than the unpacked npm
package size — the two numbers are not the same measurement and this research could
not independently confirm the smaller figure this session due to rate-limiting.

## Common Pitfalls

### Pitfall 1: Treating "reject on ambiguity" as a principle instead of a mechanism

**What goes wrong:** a profile document that states "unrecognised fields are
refused" in prose, with no corresponding test that plants an unrecognised field and
watches the refusal fire.
**Why it happens:** it is easy to write the sentence and much more work to plant a
byte-level mutation, run the decoder against it, and watch it fail before writing the
fix.
**How to avoid:** exactly what `25-CONTEXT.md` and the Conventions section already
mandate — one test per refusal, each planted and watched red, each ledgered. This
research's job was to name the specific mutations (§1's refusal list, §2's five
canonicalisation rows) precisely enough that each becomes one concrete plantable test
rather than a vague "malformed input" fuzz case.
**Warning signs:** a test named `rejects malformed certificates` (singular, generic)
instead of one test per named refusal kind.

### Pitfall 2: Confusing RFC 8410's private-key OCTET STRING wrapping with the public-key BIT STRING encoding

**What goes wrong:** copying the private-key `CurvePrivateKey ::= OCTET STRING`
wrapping pattern (RFC 8410 §7) into the `SubjectPublicKeyInfo`'s `subjectPublicKey`
field, producing a `BIT STRING` whose content is itself a nested `OCTET STRING` TLV
instead of the raw 32 bytes.
**Why it happens:** RFC 8410 covers both private and public key encodings in adjacent
sections with superficially similar-looking ASN.1, and the private-key wrapping habit
is more familiar from PKCS#8.
**How to avoid:** the public key inside `SubjectPublicKeyInfo.subjectPublicKey` is the
**raw** 32-byte value with **no** `OCTET STRING` wrapper, confirmed against RFC 8410's
own text (§2). Verify against a real OpenSSL-generated Ed25519 certificate's SPKI
bytes (measured this session: `BIT STRING` content = `00` + 32 raw bytes, total 33
bytes content, no nested TLV).
**Warning signs:** an SPKI `BIT STRING` whose content length is 34+ bytes instead of
33 (32 key bytes + 1 unused-bits byte), or that itself begins with `04 20` (an
`OCTET STRING` tag+length for 32 bytes) when decoded.

### Pitfall 3: Sizing byte ceilings against today's unbounded fields instead of against a deliberately chosen cap

**What goes wrong:** setting `MAX_EXTENSION_BYTES`/field caps by measuring whatever
`operatorId`/`relayIds` values happen to exist in today's test fixtures, rather than
deciding what values *should* be legal and sizing against that.
**Why it happens:** `enrollment.ts` places no length limit on `operatorId` or
`relayIds` today (§3, §4 — verified this session), so there is no existing "real"
maximum to measure against, only test-fixture convenience values that were never
chosen as a bound.
**How to avoid:** treat the §4 caps as a new constraint being introduced, decide them
on their own merits (what is a reasonable operator-name length; how many relays does
one node realistically depend on), and check every existing fixture against the
chosen caps before locking them in — rather than reverse-engineering the caps from
whatever fixture strings happen to already exist.
**Warning signs:** a byte ceiling that exactly matches the length of one specific test
string, suggesting it was derived from that string rather than from a stated
rationale.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `operatorId` cap of 64 bytes and `relayIds` cap of 8×128 bytes are reasonable field sizes | §3, §4 | If real operator IDs or relay lists need to be longer, the worked total in §4 and the resulting `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES` recommendations would need to be recomputed; the methodology (measure the skeleton, add the actual field design, size ceilings with stated headroom) stays valid regardless |
| A2 | `2.25.<uuid>` OID arc is an acceptable choice for this project's private extension OIDs, vs. pursuing an IANA PEN | §3 | If the project later wants IANA PEN-registered OIDs for external interop, every issued certificate's extension OIDs would need to change — low risk since `25-CONTEXT.md` already notes X.509 adoption here has no generic external validator consuming these OIDs today |
| A3 | `DECODER_BUDGET_BYTES` guard threshold is unset — no comparable measurement exists to ground it | §5 | The bundle-cost guard cannot be written with a real threshold until the decoder itself exists and is measured; treating this as settled before then would be exactly the "reported, not guarded" failure mode the ruling names |
| A4 | The "few hundred KB" figure in the ruling refers to browser-bundled min+gzip size, and the npm unpacked-size figures in §7 are directionally consistent but not the same measurement | §7 | If a reader treats the unpacked-size figures as the bundle-cost counterfactual directly, they would overstate the rejected alternative's actual browser cost; the gzip/minified figures should be re-fetched from bundlephobia (or measured directly by building a throwaway Vite bundle importing `pkijs`) once rate-limiting clears, to firm up the exact counterfactual number |

## Open Questions (RESOLVED)

1. **What is the exact `DECODER_BUDGET_BYTES` bundle-cost ceiling?**
   - What we know: the methodology (before/after delta against `dist/assets/index-*.js`,
     comparative not absolute) and today's baseline (601.22 kB raw / 168.93 kB gzip
     for the main chunk).
   - What's unclear: the decoder's own minified+gzipped contribution, since it does
     not exist yet.
   - Recommendation: the planner should implement the decoder first (or in the same
     wave), measure the real delta, and set the ceiling from that measurement with
     stated headroom — not attempt to pre-guess a number now.
   - **Resolved:** `DECODER_BUDGET_BYTES` is deliberately left unset by this
     research and is not pre-guessed in any plan. Plan 25-03 Task 1 implements
     exactly the recommended sequence — build the decoder (25-01/25-02), then
     measure the real gzip delta of a synthetic dual Vite build in the same test
     run, and site the constant against that measured number with a stated
     headroom multiple (`packages/node/src/x509-bundle.e2e.test.ts`). See
     `25-03-PLAN.md`'s objective and Task 1's `<action>`.

2. **Should `MAX_EXTENSION_COUNT = 8` allow room for extensions this profile does not
   yet define** (e.g. a future `rotationEpoch`/`policyVersion` field, which RFC-0003
   §4's own conceptual extension payload includes but `NodeCertificate` does not
   currently carry)?
   - What we know: this profile's `NodeCertificate` needs exactly 4 custom extensions
     today (§3).
   - What's unclear: whether a near-term follow-on phase will add more fields to
     `NodeCertificate` before this profile's ceilings would next be revisited.
   - Recommendation: 8 (2× today's 4) is proposed as reasonable headroom without being
     so generous it weakens the padding-attack bound; the planner should confirm this
     against any known near-term field additions.
   - **Resolved:** the planner adopted the recommended value. `MAX_EXTENSION_COUNT
     = 8` is defined in Plan 25-01 Task 1 (`packages/core/src/x509.ts`), sited
     against today's 4 custom extensions with the stated 2× headroom multiple, and
     enforced by Plan 25-02 Task 2's extension-count refusal. No near-term field
     addition to `NodeCertificate` is known as of this phase; the choice stands
     without a confirmed conflict.

3. **Does the round-trip re-encode/compare check need to run on every `verifyCertificate`
   call, or only at issuance/first-sight** (matching `PeerVerifier`'s "a settled
   acceptance is never re-asked" pattern for other checks)?
   - What we know: the ruling requires DER canonicalisation to be *proved* (Obligation
     3) but does not specify call frequency.
   - What's unclear: whether re-parsing and re-encoding a certificate on every
     verification call (vs. caching the canonical-form verdict alongside the parsed
     result, the way `PeerVerifier` caches acceptance) matters for the "off the
     execution path" cost claim in §6, given none of the five call sites are
     per-task-execution-frequency anyway.
   - Recommendation: low urgency given §6's finding that no call site is
     execution-path-frequency; the planner can choose either without materially
     affecting the phase's cost claims, but should state the choice explicitly per
     this repository's "a comment asserting a mechanism is inert... a reader who
     believes it stops looking" discipline.
   - **Resolved:** moot this phase, stated explicitly rather than left implicit.
     Plan 25-02 wires `checkDerCanonical` into `decodeX509Certificate` as a
     per-decode gate (Task 3), but nothing in this phase calls
     `decodeX509Certificate` from a production path yet — every X509-0N obligation
     except X509-05 is minted `Built, not wired` in `REQUIREMENTS.md`. Call
     frequency (every `verifyCertificate` vs. cached at issuance/first-sight) is
     therefore a question for whichever future phase wires the decoder in, not for
     this one — there is no call site yet whose frequency could be decided either
     way.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| OpenSSL (for research-time cert generation, not shipped) | This research's §4 measurement only | ✓ | 3.6.2 | — |
| `@noble/curves` | Ed25519 sign/verify (already used by `enrollment.ts`/`capability.ts`) | ✓ | 2.2.0 | — |
| `@ipld/dag-cbor` | Recommended encoding for custom extension payloads (§3) | ✓ | 10.0.1 | — |
| Vite | Bundle-cost guard build step (§5) | ✓ | 8.1.5 | — |
| `pkijs`/`asn1js`/`node-forge`/`@peculiar/*` | Explicitly NOT to be added — listed for completeness of the "absent" audit (§7) | ✗ (by design) | — | N/A — the decoder is hand-written per the locked decision |

No missing dependency blocks this phase; nothing above needs a fallback.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.10, `projects` config (`node`/`browser`/`e2e`/`perf`) |
| Config file | `/Volumes/ProjectsSSD/Projects/o2.services/vitest.config.ts` |
| Quick run command | `npx vitest run --project node <new-file>.test.ts` |
| Full suite command | `npm run test:node` (or `test:unit` for the sub-1000ms-cut set) |

### Phase Requirements → Test Map

No requirement IDs exist yet (§ Phase Requirements, above) — this table names the
obligation directly, since the planner mints the `X509-0N` IDs.

| Obligation | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| 1 — Ed25519-only | non-`id-Ed25519` `AlgorithmIdentifier` OID refused, named | unit | `pytest`-equivalent: `npx vitest run --project node packages/core/src/x509.test.ts -t "algorithm"` | ❌ Wave 0 |
| 2 — named bans | SHA-1/P-192/P-224/RSA<2048 OIDs each individually refused | unit | same file, `-t "bans"` | ❌ Wave 0 |
| 3 — DER canonicalisation | re-encode/compare round trip; one planted mutation per §2 row | unit | same file, `-t "canonical"` | ❌ Wave 0 |
| 4 — certificate parsing limits | oversized certificate refused before parse | unit | same file, `-t "MAX_CERTIFICATE_BYTES"` | ❌ Wave 0 |
| 5 — max chain depth | already delivered (`capability.ts`) — no new test | — | — | ✅ existing (`capability.test.ts`) |
| 6 — extension size limits | oversized single extension / too many extensions refused | unit | same file, `-t "extension"` | ❌ Wave 0 |
| 7 — duplicate extensions | repeated `extnID` refused, not last-wins | unit | same file, `-t "duplicate"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --project node packages/core/src/x509.test.ts`
- **Per wave merge:** `npm run test:node`
- **Phase gate:** `npm run test` full suite green before `/gsd-verify-work`, plus the
  bundle-cost guard (§5) run against a real `npm run build:demo` output.

### Wave 0 Gaps
- [ ] A new decoder module and its test file (path TBD, Claude's discretion per
      `25-CONTEXT.md` — natural candidate `packages/core/src/x509.ts` /
      `x509.test.ts`, adjacent to `enrollment.ts`/`capability.ts`) — covers
      obligations 1, 2, 3, 4, 6, 7
- [ ] A bundle-cost guard test (tier TBD — likely `e2e`, alongside
      `built-bundle.e2e.test.ts`, since it needs the real Vite output)
- [ ] A `X509-01…07` requirement block in `.planning/REQUIREMENTS.md`, plus the
      existing AUTH-01/AUTH-05 entries cross-referenced if this phase changes what
      `NodeCertificate` issuance/verification actually produces

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | Not applicable — this profile is node/peer certificate verification, not user authentication |
| V3 Session Management | no | — |
| V4 Access Control | yes | The capability-chain (`verifyChain`) system, unaffected by this phase — noted for completeness, not in scope here |
| V5 Input Validation | yes | The entire decoder is an input-validation boundary over attacker-supplied bytes; every refusal in §1/§2/§4 is a V5 control |
| V6 Cryptography | yes | Ed25519 via `@noble/curves` (already audited, zero-dep, in use) — never hand-rolled; the decoder itself performs no cryptographic operations, only structural parsing, keeping the "generates CVE classes" surface the ruling worried about limited to parsing logic rather than crypto primitives |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| BER/DER confusion (accepting non-canonical encodings as if canonical) | Tampering | §2's re-encode/compare round trip |
| Certificate/extension bomb (oversized or duplicated fields exhausting parser CPU/memory) | Denial of Service | §4's pre-parse byte ceilings, §1's duplicate-`extnID` refusal |
| Algorithm confusion (accepting a weak/wrong signature algorithm OID) | Spoofing / Tampering | §1's allow-list-of-one (`id-Ed25519` only), every other OID refused by construction rather than by a deny-list |
| BIT STRING padding-bit smuggling (garbage in unused bits, invisible to the semantic value) | Tampering | §2 row 4 — the re-encode/compare check zeroes padding and catches divergence |
| Indefinite-length / recursive-length parsing (BER's indefinite-length + nested-EOC pattern, a classic recursive-descent DoS vector in general ASN.1 parsers) | Denial of Service | §1's outright refusal of indefinite length, checked at the length-octet level before any recursive descent begins — this profile's decoder never needs to be recursion-safe against indefinite nesting because it refuses the construct before recursing |

## Sources

### Primary (HIGH confidence)
- RFC 5280 (`https://www.rfc-editor.org/rfc/rfc5280`) — `Certificate`/`TBSCertificate`
  ASN.1 module, §4.1.2.5 (UTCTime/GeneralizedTime rule), §4.1.2.2 (serialNumber ≤20
  octets), §4.1.2.8 (unique identifiers MUST NOT be generated) — fetched and quoted
  directly this session
- RFC 8410 (`https://www.rfc-editor.org/rfc/rfc8410`) — `id-Ed25519` OID, parameters-
  MUST-be-absent rule, raw (unwrapped) public-key/signature `BIT STRING` encoding —
  fetched and quoted directly this session
- OpenSSL 3.6.2, local execution — real Ed25519 X.509v3 certificate generated and
  `asn1parse`d to ground every byte-arithmetic figure in §4 in a measured skeleton
- `packages/core/src/enrollment.ts`, `packages/core/src/capability.ts` — read in full
  this session, `NodeCertificate`, `payloadOf`, `MAX_CHAIN_DEPTH`, `verifyChain`
- `packages/libp2p/src/relay-admission.ts` — read in full, establishes the
  ADMISSION-vs-SELECTION distinction §6 relies on
- `.planning/phases/phase-25-x509-certificate-profile/25-CONTEXT.md`,
  `.planning/ROADMAP.md` (Phase 25 entry + owner-ruling HTML comment),
  `docs/architecture/RFC-0003-Decentralized-Cloud-Security-Architecture-v0.2.md` §4/§12,
  `docs/architecture/RFC-0003-REVIEW-praxis-2026-08-06.md` (owner ruling + 2026-08-07
  correction) — all read in full this session
- `npm view pkijs|asn1js|node-forge|@peculiar/x509|@peculiar/asn1-schema
  dist.unpackedSize` — executed this session, live npm registry
- Every `package.json` in the repository (root + 8 workspaces) — read in full this
  session, confirms absence of all named prior-art libraries

### Secondary (MEDIUM confidence)
- ITU-T X.690 canonicalisation rules (definite-length-only, minimal-length encoding,
  minimal INTEGER encoding, BIT STRING unused-bits-zero, SET OF ordering) — confirmed
  via WebSearch cross-referencing itu.int's own publication page and multiple
  independent technical summaries (liquisearch.com, grokipedia.com); the *substance*
  of each rule is corroborated by 3+ independent sources, but the RFC/spec text itself
  was not fetched verbatim this session, so exact clause numbering is MEDIUM rather
  than HIGH
- ITU-T X.667 / ISO 9834-8 `2.25` UUID-as-OID-arc mechanism — confirmed via three
  independent sources (itu.int, oid-info.com, alvestrand.no) converging on the same
  claim (no registration required)

### Tertiary (LOW confidence)
- `pkijs`/`asn1js` minified+gzip bundle contribution (the number the ruling's "a few
  hundred KB" most directly refers to) — WebSearch attempted, bundlephobia.com API
  returned HTTP 429 (rate-limited) before a figure could be retrieved this session.
  Only the npm-registry unpacked-size figures in §7 are independently confirmed; flag
  this gap explicitly (Assumption A4) rather than presenting the unpacked size as the
  same measurement the ruling cites

## Metadata

**Confidence breakdown:**
- Standard stack / decoder scope (§1, §3): HIGH — grounded in RFC 5280/8410 primary
  text, fetched directly, plus a real measured OpenSSL certificate
- DER canonicalisation rules (§2): MEDIUM-HIGH — substance HIGH (convergent
  independent sources), exact clause citations MEDIUM (not fetched verbatim from the
  X.690 PDF itself)
- Byte ceilings (§4): MEDIUM — arithmetic is HIGH confidence (built from a measured
  skeleton with shown working), but the underlying field-size caps (`operatorId`,
  `relayIds`) are this research's proposal against a currently-unbounded field, not a
  pre-existing constraint being measured
- Bundle-cost guard design (§5): MEDIUM — methodology is sound and grounded in a real
  measured baseline, but the actual ceiling constant is explicitly left unset pending
  the decoder's own existence
- Call-site audit (§6): HIGH — exhaustive grep across the whole `packages/` tree,
  every result manually inspected and traced to its production caller
- Prior-art absence audit (§7): HIGH for absence-confirmation and unpacked sizes
  (live npm registry queries); LOW for the specific min+gzip counterfactual number
  (rate-limited, unconfirmed)

**Research date:** 2026-08-09
**Valid until:** RFC 5280/8410/X.690 are stable, decades-old specs — that portion is
effectively valid indefinitely. The byte-ceiling arithmetic (§4) and bundle-cost
baseline (§5) are tied to this repository's current state and should be treated as
valid for ~14 days or until the decoder/bundle actually change, whichever comes
first — consistent with this repository's general practice of dating measurements
rather than treating them as permanent.
