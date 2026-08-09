/**
 * X.509 certificate profile — DER decoder foundation. X509-04.
 *
 * A certificate presented by a peer is attacker-supplied bytes until proven otherwise.
 * This module refuses it fast and by name: a byte blob longer than
 * `MAX_CERTIFICATE_BYTES` is refused before a single TLV (tag-length-value) is parsed,
 * a byte blob using BER's indefinite-length form is refused at the length octet before
 * any recursive descent, and a byte blob using a tag outside this profile's fixed 12
 * is refused by name rather than silently skipped or generically interpreted.
 *
 * Seven obligations were named by the owner ruling of 2026-08-06 (25-CONTEXT.md):
 *
 *   X509-01  permitted algorithms — Ed25519 only
 *   X509-02  named bans — SHA-1, P-192, P-224, RSA < 2048, each refused by name
 *   X509-03  DER canonicalisation — proved by re-encode/byte-compare, not a checklist
 *   X509-04  certificate/extension byte ceilings, checked before any parse
 *   X509-05  max chain depth — ALREADY DELIVERED at `capability.ts:127`/`:190`,
 *            guarded by `capability.test.ts`. Not re-implemented here; this module
 *            does not touch `capability.ts`.
 *   X509-06  extension size/count limits
 *   X509-07  duplicate extensions refused outright
 *
 * This plan (25-01) lays the foundation only: the type contracts (`DerNode`,
 * `X509Failure`), a generic bounded TLV decode/encode engine covering exactly the 12
 * ASN.1 constructs this profile needs (RESEARCH.md §1 — "12 tags, one fixed grammar,
 * no recursive schema"), and the certificate-level byte ceiling (X509-04) checked
 * before any parsing begins — the same "bound before expensive work" ordering
 * `MAX_CHAIN_DEPTH` already established at `capability.ts:186-192`. Plan 25-02 builds
 * the profile's semantic refusals (X509-01, 02, 06, 07, and X509-03 wired as a
 * certificate-level gate) as pure composition over the engine this file proves correct.
 *
 * Pure module: no platform imports. (The one platform-adjacent thing this project
 * tolerates inside a "pure" module — a lazy `import()` behind a runtime capability
 * check, as Plan 25-04 adds elsewhere — has no occasion here: this file never needs to
 * reach outside itself.)
 */

/** One decoded TLV node, faithful to what was read — no canonicalisation applied yet. */
export interface DerNode {
  readonly tag: number
  readonly constructed: boolean
  /** Primitive nodes only; empty for constructed nodes. */
  readonly content: Uint8Array
  /** Constructed nodes only; empty for primitive nodes. */
  readonly children: readonly DerNode[]
}

/**
 * Every refusal this module can return, across all seven obligations. This plan
 * defines and returns only the two kinds its own tasks produce. Plan 25-02 extends the
 * union with the eight semantic kinds it needs so a reader of this file already sees
 * the union's eventual shape without renegotiating it:
 *
 *   'unrecognised-algorithm' | 'algorithm-parameters-present' | 'non-canonical-encoding'
 *   | 'extension-too-large' | 'too-many-extensions' | 'duplicate-extension'
 *   | 'unrecognised-extension' | 'unique-identifier-present' | 'multi-valued-rdn'
 *   | 'generalized-time-present'
 */
export type X509Failure =
  | { readonly kind: 'certificate-too-large'; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'malformed-der'; readonly detail: string; readonly offset: number }

/**
 * The 12 ASN.1 tag bytes this profile's DER decoder recognises — RESEARCH.md §1's
 * "12 tags, one fixed grammar, no recursive schema" table. Any tag byte not in this
 * set, or matching the high-tag-number form (tag byte's low 5 bits all `1`), is
 * refused by name rather than silently skipped or generically parsed.
 */
export const ALLOWED_TAGS: ReadonlySet<number> = new Set([
  0x30, // SEQUENCE (constructed) — Certificate, TBSCertificate, AlgorithmIdentifier (x2), Validity, Name (x2), SubjectPublicKeyInfo, Extensions, Extension (xN), each RDN's AttributeTypeAndValue
  0x31, // SET (constructed) — RelativeDistinguishedName (refused if multi-valued, per RESEARCH.md §1/§2 row 5)
  0x02, // INTEGER — version (inner, wrapped by [0]), serialNumber
  0x03, // BIT STRING — subjectPublicKey, signatureValue
  0x04, // OCTET STRING — Extension.extnValue
  0x06, // OBJECT IDENTIFIER — signature/SPKI algorithm OIDs, extnID values, id-at-commonName
  0x17, // UTCTime — notBefore/notAfter (RFC 5280 §4.1.2.5 mandates it through 2049)
  0x18, // GeneralizedTime — decode-and-refuse only (RESEARCH.md §1 row 8; never legitimate in this profile's short-lived certificates)
  0x01, // BOOLEAN — Extension.critical
  0x0c, // UTF8String — AttributeTypeAndValue.value (every other string type is out of profile)
  0xa0, // context [0] EXPLICIT (constructed) — wraps version
  0xa3, // context [3] EXPLICIT (constructed) — wraps extensions
])

/**
 * The most bytes a whole certificate may occupy on the wire. Its length comes off the
 * wire, so it is an input — checked before `decodeDer` runs at all, the same "before
 * any expensive work" ordering `MAX_CHAIN_DEPTH` established at `capability.ts:186-192`.
 *
 * **Sited, not picked.** RESEARCH.md §4 built a worked total from a real
 * OpenSSL-generated Ed25519 X.509v3 skeleton (301 bytes, `openssl x509 ... -outform
 * DER`, `[VERIFIED: OpenSSL 3.6.2, this session]`) plus this profile's four custom
 * extensions at their proposed caps (`userKey` 62B, `operatorId` 94B,
 * `discoverability` 31B, `relayIds` ≈1075B) ≈ **1612 bytes** total. `operatorId`'s
 * 64-byte cap and `relayIds`' 8×128-byte cap are THIS PHASE'S OWN NEW CONSTRAINT —
 * `enrollment.ts` places no length limit on either field today (RESEARCH.md Pitfall
 * 3) — not an existing bound being encoded. `MAX_CERTIFICATE_BYTES` is 4096, **2.5×**
 * the worked 1612-byte total.
 */
export const MAX_CERTIFICATE_BYTES = 4096

/**
 * The most bytes a single extension's `extnValue` payload may occupy. Sited against
 * RESEARCH.md §4's worst single extension, `relayIds`, at ≈1075 bytes for the whole
 * `Extension` SEQUENCE (`extnID` + `critical` + `extnValue` OCTET STRING) — a cap that
 * is `relayIds`' own new constraint (`enrollment.ts` places no limit on it today), not
 * an existing bound being encoded. `MAX_EXTENSION_BYTES` is 2048, **1.9×** over that
 * worst extension.
 */
export const MAX_EXTENSION_BYTES = 2048

/**
 * The most extensions a certificate's `Extensions` SEQUENCE may carry. This profile
 * issues exactly 4 (`userKey`, `operatorId`, `discoverability`, `relayIds` —
 * RESEARCH.md §3). `MAX_EXTENSION_COUNT` is 8, **2×** that count — headroom for one
 * later extension without immediately re-siting the constant, not license for
 * unbounded growth.
 */
export const MAX_EXTENSION_COUNT = 8

/**
 * This project's private OID arc, minted without IANA registration via ITU-T X.667 /
 * ISO 9834-8 §2.25 (`{joint-iso-itu-t uuid(25)}`) — a generated UUID interpreted as an
 * unsigned integer is a valid, globally-unique OID arc component with zero central
 * registration (RESEARCH.md §3). Derived from UUID
 * `4431df1c-55da-4643-bd57-9410d0242c1c`, generated once for this project.
 */
export const X509_EXTENSION_ARC = '2.25.90646451481742754111882377486934486044'

/** Custom extension OIDs, all under `X509_EXTENSION_ARC` (RESEARCH.md §3's field mapping). */
export const EXT_USER_KEY: string = `${X509_EXTENSION_ARC}.1`
export const EXT_OPERATOR_ID: string = `${X509_EXTENSION_ARC}.2`
export const EXT_DISCOVERABILITY: string = `${X509_EXTENSION_ARC}.3`
export const EXT_RELAY_IDS: string = `${X509_EXTENSION_ARC}.4`

/**
 * RFC 8410 `id-Ed25519` — the one algorithm this profile permits (X509-01). DER
 * content bytes `2B 65 70`, `[VERIFIED: local OpenSSL 3.6.2 build, RESEARCH.md §1]`.
 */
export const ID_ED25519 = '1.3.101.112'

/** `id-at-commonName` — the one AttributeType this profile's `Name`/RDN needs. */
export const ID_AT_COMMON_NAME = '2.5.4.3'

/**
 * The certificate-level size gate (X509-04). Checked before `decodeDer` runs at all —
 * a small standalone function rather than folded into `decodeDer` itself, so Plan
 * 25-02's `decodeX509Certificate` can call it as the documented first line, matching
 * `capability.ts:186-192`'s "before any signature work" ordering made visible in the
 * caller rather than hidden inside a callee.
 */
export function preParseCheck(bytes: Uint8Array): X509Failure | null {
  throw new Error('not implemented — Task 2/3 of 25-01')
}

/** Decode one TLV tree from `bytes`, refusing anything outside the 12-tag profile. */
export function decodeDer(bytes: Uint8Array): { ok: true; node: DerNode } | { ok: false; failure: X509Failure } {
  throw new Error('not implemented — Task 2/3 of 25-01')
}

/** Re-serialize a DerNode tree in this profile's one canonical form (X.690 DER). */
export function encodeDer(node: DerNode): Uint8Array {
  throw new Error('not implemented — Task 2/3 of 25-01')
}

/** decode(bytes) -> encode(that tree) -> byte-compare against `bytes`. True iff identical. */
export function checkDerCanonical(bytes: Uint8Array): boolean {
  throw new Error('not implemented — Task 2/3 of 25-01')
}
