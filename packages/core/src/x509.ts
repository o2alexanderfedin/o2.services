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
 * Every refusal this module can return, across all seven obligations. Plan 25-01
 * defined and returned only the first two kinds. Plan 25-02 adds the other ten,
 * wiring the algorithm allow-list (X509-01/02), the extension rules (X509-06/07),
 * the RFC 5280 structural refusals (unique identifiers, GeneralizedTime,
 * multi-valued RDNs), and the certificate-level canonicalisation gate (X509-03).
 */
export type X509Failure =
  | { readonly kind: 'certificate-too-large'; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'malformed-der'; readonly detail: string; readonly offset: number }
  | { readonly kind: 'unrecognised-algorithm'; readonly oid: string }
  | { readonly kind: 'algorithm-parameters-present'; readonly oid: string }
  | { readonly kind: 'non-canonical-encoding'; readonly reason: string }
  | { readonly kind: 'extension-too-large'; readonly oid: string; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'too-many-extensions'; readonly count: number; readonly limit: number }
  | { readonly kind: 'duplicate-extension'; readonly oid: string }
  | { readonly kind: 'unrecognised-extension'; readonly oid: string }
  | { readonly kind: 'unique-identifier-present' }
  | { readonly kind: 'multi-valued-rdn' }
  | { readonly kind: 'generalized-time-present' }

/**
 * The ASN.1 tag bytes this profile's DER decoder recognises — RESEARCH.md §1's
 * "12 tags, one fixed grammar, no recursive schema" table, **plus three more added by
 * Plan 25-02, 2026-08-09**, for a specific and stated reason: a tag decodeDer refuses
 * outright can never reach a semantic, named X509Failure kind — decodeX509Certificate
 * calls decodeDer first and returns whatever generic `malformed-der` it produces. Three
 * of this profile's obligations need a *specific* refusal kind instead of that generic
 * one, so the tag that triggers them must be tolerated by the low-level decoder and
 * refused by name one layer up, in assembly:
 *
 *   - `0x81`/`0x82` (context `[1]`/`[2]` IMPLICIT, primitive) — `issuerUniqueID`/
 *     `subjectUniqueID`. RFC 5280 §4.1.2.8 forbids them outright; assembly refuses
 *     `unique-identifier-present` by name rather than a bare "unknown tag".
 *   - `0x05` (NULL) — RFC 8410 §10's specific legacy-tolerant trap is a *present*
 *     `parameters` field on the Ed25519 `AlgorithmIdentifier`, even a `NULL` one.
 *     Refusing `0x05` at the TLV layer would collapse that into generic
 *     `malformed-der`; tolerating it lets `checkAlgorithm` refuse
 *     `algorithm-parameters-present` by name, which is Obligation 2's own named case.
 *
 * Any tag byte still outside this now-15-member set, or matching the high-tag-number
 * form (tag byte's low 5 bits all `1`), is refused by name rather than silently
 * skipped or generically parsed — unchanged from Plan 25-01.
 */
export const ALLOWED_TAGS: ReadonlySet<number> = new Set([
  0x30, // SEQUENCE (constructed) — Certificate, TBSCertificate, AlgorithmIdentifier (x2), Validity, Name (x2), SubjectPublicKeyInfo, Extensions, Extension (xN), each RDN's AttributeTypeAndValue
  0x31, // SET (constructed) — RelativeDistinguishedName (refused if multi-valued, per RESEARCH.md §1/§2 row 5)
  0x02, // INTEGER — version (inner, wrapped by [0]), serialNumber
  0x03, // BIT STRING — subjectPublicKey, signatureValue
  0x04, // OCTET STRING — Extension.extnValue
  0x05, // NULL — tolerated only so a present Ed25519 `parameters` field can be refused by name (see docblock above); this profile never accepts one
  0x06, // OBJECT IDENTIFIER — signature/SPKI algorithm OIDs, extnID values, id-at-commonName
  0x17, // UTCTime — notBefore/notAfter (RFC 5280 §4.1.2.5 mandates it through 2049)
  0x18, // GeneralizedTime — decode-and-refuse only (RESEARCH.md §1 row 8; never legitimate in this profile's short-lived certificates)
  0x01, // BOOLEAN — Extension.critical
  0x0c, // UTF8String — AttributeTypeAndValue.value (every other string type is out of profile)
  0x81, // context [1] IMPLICIT (primitive) — issuerUniqueID, tolerated only so assembly can refuse it by name (see docblock above)
  0x82, // context [2] IMPLICIT (primitive) — subjectUniqueID, same reason
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
  if (bytes.length > MAX_CERTIFICATE_BYTES) {
    return { kind: 'certificate-too-large', bytes: bytes.length, limit: MAX_CERTIFICATE_BYTES }
  }
  return null
}

/** A tag byte's low 5 bits all `1` — ASN.1's high-tag-number form. None of this profile's 12 tags need it. */
function isHighTagNumberForm(tagByte: number): boolean {
  return (tagByte & 0x1f) === 0x1f
}

/** Bit 0x20 of the tag byte — set for constructed encodings (SEQUENCE, SET, [0]/[3] EXPLICIT). */
function isConstructed(tagByte: number): boolean {
  return (tagByte & 0x20) !== 0
}

type ReadTlvResult = { readonly ok: true; readonly node: DerNode; readonly next: number } | { readonly ok: false; readonly failure: X509Failure }

/**
 * Read one TLV from `bytes`, starting at `offset` and never reading at or past
 * `limit`. `limit` bounds recursion into a constructed node's own content region, so
 * every `offset` reported in a refusal stays absolute against the original buffer
 * rather than relative to whatever nesting level produced it.
 *
 * Bounds are explicit at every step — this function's whole job is to be safe against
 * an attacker-supplied length, never trusting a declared length until it has been
 * checked against what is actually present.
 */
function readTlv(bytes: Uint8Array, offset: number, limit: number): ReadTlvResult {
  if (offset >= limit) {
    return { ok: false, failure: { kind: 'malformed-der', detail: 'truncated input: expected a tag byte', offset } }
  }

  const tagByte = bytes[offset] as number

  if (isHighTagNumberForm(tagByte)) {
    return {
      ok: false,
      failure: {
        kind: 'malformed-der',
        detail: `high-tag-number form is out of profile (tag byte 0x${tagByte.toString(16)})`,
        offset,
      },
    }
  }

  if (!ALLOWED_TAGS.has(tagByte)) {
    return {
      ok: false,
      failure: {
        kind: 'malformed-der',
        detail: `tag byte 0x${tagByte.toString(16)} is not in this profile's 12 allowed tags`,
        offset,
      },
    }
  }

  const lengthOffset = offset + 1
  if (lengthOffset >= limit) {
    return { ok: false, failure: { kind: 'malformed-der', detail: 'truncated input: expected a length octet', offset: lengthOffset } }
  }

  const firstLengthByte = bytes[lengthOffset] as number

  // BER's indefinite-length marker. DER forbids it outright (X.690 §10.1) — refuse on
  // sight of the byte, before attempting to scan for a terminating 00 00.
  if (firstLengthByte === 0x80) {
    return {
      ok: false,
      failure: {
        kind: 'malformed-der',
        detail: 'indefinite-length form (0x80) is BER-only; DER forbids it',
        offset: lengthOffset,
      },
    }
  }

  let contentLength: number
  let contentOffset: number

  if (firstLengthByte <= 0x7f) {
    // Short form: the byte itself is the length. Decoded leniently here (long-form
    // non-minimal lengths are accepted too, below) — RESEARCH.md §2's strategy is
    // "decode faithfully, then re-serialize canonically, then compare bytes", and
    // refusing non-minimal length at decode time would short-circuit that mechanism
    // before Task 3 can prove it.
    contentLength = firstLengthByte
    contentOffset = lengthOffset + 1
  } else {
    // Long form: the low 7 bits of the first length byte count how many further
    // length bytes follow, big-endian.
    const byteCount = firstLengthByte & 0x7f
    const lengthBytesStart = lengthOffset + 1
    const lengthBytesEnd = lengthBytesStart + byteCount
    if (lengthBytesEnd > limit) {
      return {
        ok: false,
        failure: {
          kind: 'malformed-der',
          detail: 'truncated input: declared long-form length runs past the buffer',
          offset: lengthBytesStart,
        },
      }
    }
    contentLength = 0
    for (let i = lengthBytesStart; i < lengthBytesEnd; i++) {
      contentLength = contentLength * 256 + (bytes[i] as number)
    }
    contentOffset = lengthBytesEnd
  }

  const contentEnd = contentOffset + contentLength
  if (contentEnd > limit) {
    return {
      ok: false,
      failure: {
        kind: 'malformed-der',
        detail: `declared length ${contentLength} runs past the end of the buffer`,
        offset: contentOffset,
      },
    }
  }

  if (isConstructed(tagByte)) {
    const children: DerNode[] = []
    let childOffset = contentOffset
    while (childOffset < contentEnd) {
      const child = readTlv(bytes, childOffset, contentEnd)
      if (!child.ok) return child
      children.push(child.node)
      childOffset = child.next
    }
    return {
      ok: true,
      node: { tag: tagByte, constructed: true, content: new Uint8Array(0), children },
      next: contentEnd,
    }
  }

  return {
    ok: true,
    node: { tag: tagByte, constructed: false, content: bytes.subarray(contentOffset, contentEnd), children: [] },
    next: contentEnd,
  }
}

/** Decode one TLV tree from `bytes`, refusing anything outside the 12-tag profile. */
export function decodeDer(bytes: Uint8Array): { ok: true; node: DerNode } | { ok: false; failure: X509Failure } {
  const result = readTlv(bytes, 0, bytes.length)
  if (!result.ok) return result
  return { ok: true, node: result.node }
}

/** The fewest bytes that represent `contentLength`: short form for <=127, minimal long form otherwise. */
function minimalLength(contentLength: number): Uint8Array {
  if (contentLength <= 0x7f) return new Uint8Array([contentLength])
  const lengthBytes: number[] = []
  let n = contentLength
  while (n > 0) {
    lengthBytes.unshift(n & 0xff)
    n = Math.floor(n / 256)
  }
  return new Uint8Array([0x80 | lengthBytes.length, ...lengthBytes])
}

/**
 * DER's minimal two's-complement `INTEGER` form (RESEARCH.md §2 row 3): strip a
 * leading `0x00` when the following byte's high bit is already `0` (redundant — the
 * value is unambiguously non-negative without it), or a leading `0xFF` when the
 * following byte's high bit is `1` (redundant for the equivalent negative case).
 * `serialNumber` is this profile's only standalone `INTEGER` field that can carry
 * either form; `version`'s `INTEGER` is always a small non-negative literal. Both
 * directions are implemented since this byte-level rule does not know which field it
 * is canonicalising.
 */
function canonicalizeInteger(content: Uint8Array): Uint8Array {
  let start = 0
  while (start < content.length - 1) {
    const leading = content[start] as number
    const next = content[start + 1] as number
    const redundantZero = leading === 0x00 && (next & 0x80) === 0
    const redundantFF = leading === 0xff && (next & 0x80) !== 0
    if (!redundantZero && !redundantFF) break
    start++
  }
  return content.subarray(start)
}

/**
 * DER requires a byte-aligned `BIT STRING`'s trailing padding bits to read as `0`
 * (RESEARCH.md §2 row 4). The first content byte is the unused-bits count; this
 * masks that many low bits of the last content byte to zero and leaves everything
 * else — including the unused-bits count itself — untouched.
 */
function canonicalizeBitString(content: Uint8Array): Uint8Array {
  const unusedBits = content[0]
  if (content.length <= 1 || !unusedBits) return content
  const out = new Uint8Array(content)
  const lastIndex = out.length - 1
  const mask = (0xff << unusedBits) & 0xff
  out[lastIndex] = (out[lastIndex] as number) & mask
  return out
}

/** DER requires `BOOLEAN` TRUE to be exactly `0xFF` (BER permits any nonzero byte). */
function canonicalizeBoolean(content: Uint8Array): Uint8Array {
  return new Uint8Array([content[0] ? 0xff : 0x00])
}

/** Re-serialize a DerNode tree in this profile's one canonical form (X.690 DER). */
export function encodeDer(node: DerNode): Uint8Array {
  let content: Uint8Array

  if (node.constructed) {
    const parts = node.children.map((child) => encodeDer(child))
    let total = 0
    for (const part of parts) total += part.length
    content = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      content.set(part, offset)
      offset += part.length
    }
  } else if (node.tag === 0x02) {
    content = canonicalizeInteger(node.content)
  } else if (node.tag === 0x03) {
    content = canonicalizeBitString(node.content)
  } else if (node.tag === 0x01) {
    content = canonicalizeBoolean(node.content)
  } else {
    // Every other tag's canonicalisation is structural, not per-byte — e.g. this
    // profile refuses multi-valued SETs outright (RESEARCH.md §2 row 5) rather than
    // sorting them, so encodeDer never needs SET OF ordering logic.
    content = node.content
  }

  const lengthBytes = minimalLength(content.length)
  const out = new Uint8Array(1 + lengthBytes.length + content.length)
  out[0] = node.tag
  out.set(lengthBytes, 1)
  out.set(content, 1 + lengthBytes.length)
  return out
}

/** decode(bytes) -> encode(that tree) -> byte-compare against `bytes`. True iff identical. */
export function checkDerCanonical(bytes: Uint8Array): boolean {
  const decoded = decodeDer(bytes)
  if (!decoded.ok) return false
  // Built above any comparison, matching capability.ts's payload-built-above-the-try
  // pattern: a codec defect in the re-encoder must never be misreported as "the input
  // was non-canonical".
  const reencoded = encodeDer(decoded.node)
  if (reencoded.length !== bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (reencoded[i] !== bytes[i]) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Certificate assembly — X509-01…07 profile semantics (Plan 25-02)
// ---------------------------------------------------------------------------

const HEX_DIGITS = '0123456789abcdef'

/** Local hex encoder. The exported X.509 surface never needs a matching `fromHex`. */
function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX_DIGITS[byte >> 4]! + HEX_DIGITS[byte & 0x0f]!
  return out
}

/**
 * Decode an OBJECT IDENTIFIER's DER content bytes to dotted-decimal string form. The
 * first byte encodes the first two arcs as `40*X+Y` (X in {0,1,2}, so it never needs a
 * continuation byte); every following byte is a base-128 VLQ continuation, high bit set
 * meaning "more bytes follow". Accumulated with `BigInt` because this profile's own
 * extension arc (`X509_EXTENSION_ARC`, a 128-bit UUID) does not fit a JS `number`
 * without precision loss.
 */
function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const first = bytes[0] as number
  const arcs: string[] = [String(Math.floor(first / 40)), String(first % 40)]
  let value = 0n
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i] as number
    value = value * 128n + BigInt(byte & 0x7f)
    if ((byte & 0x80) === 0) {
      arcs.push(value.toString())
      value = 0n
    }
  }
  return arcs.join('.')
}

function malformed(detail: string, offset: number): X509Failure {
  return { kind: 'malformed-der', detail, offset }
}

function isX509Failure(value: unknown): value is X509Failure {
  return typeof value === 'object' && value !== null && 'kind' in value
}

/**
 * RFC 5280 §4.1.2.5.1: `UTCTime`'s two-digit year maps `YY >= 50` to 1950-1999 and
 * `YY < 50` to 2000-2049. Returns `null` on any shape other than the mandatory
 * `YYMMDDHHMMSSZ` (RFC 5280 requires seconds and the `Z` suffix; this profile does not
 * tolerate the seconds-omitted BER-legal shorthand).
 */
function parseUtcTime(content: Uint8Array): number | null {
  const text = new TextDecoder().decode(content)
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  if (!match) return null
  const [, yyStr, mmStr, ddStr, hhStr, miStr, ssStr] = match
  const yy = Number(yyStr)
  const year = yy >= 50 ? 1900 + yy : 2000 + yy
  return Date.UTC(year, Number(mmStr) - 1, Number(ddStr), Number(hhStr), Number(miStr), Number(ssStr))
}

/** `TBSCertificate.version`'s content — always a small non-negative literal (0, 1, or 2) in this profile. */
function readSmallInteger(content: Uint8Array): number {
  let value = 0
  for (const byte of content) value = value * 256 + byte
  return value
}

interface NameFields {
  readonly commonName: string
}

/**
 * `Name ::= SEQUENCE OF RelativeDistinguishedName`. This profile allows exactly one RDN
 * carrying exactly one `AttributeTypeAndValue` (RESEARCH.md §1/§2 row 5 — refusing a
 * multi-valued RDN sidesteps DER's `SET OF` canonical-ordering rule entirely, since a
 * single-element set has no ordering question).
 */
function readName(node: DerNode | undefined): NameFields | X509Failure {
  if (!node || node.tag !== 0x30 || node.children.length !== 1) {
    return malformed('expected a Name SEQUENCE containing exactly one RelativeDistinguishedName', 0)
  }
  const rdn = node.children[0] as DerNode
  if (rdn.tag !== 0x31 || rdn.children.length === 0) {
    return malformed('expected a RelativeDistinguishedName SET', 0)
  }
  if (rdn.children.length > 1) {
    return { kind: 'multi-valued-rdn' }
  }
  const atv = rdn.children[0] as DerNode
  if (atv.tag !== 0x30 || atv.children.length !== 2) {
    return malformed('expected an AttributeTypeAndValue SEQUENCE with exactly two children', 0)
  }
  const typeNode = atv.children[0] as DerNode
  const valueNode = atv.children[1] as DerNode
  if (typeNode.tag !== 0x06 || decodeOid(typeNode.content) !== ID_AT_COMMON_NAME) {
    return malformed('expected id-at-commonName as the AttributeTypeAndValue.type', 0)
  }
  if (valueNode.tag !== 0x0c) {
    // Every non-UTF8String tag this profile might see here (PrintableString 0x13,
    // IA5String 0x16, etc.) is already outside ALLOWED_TAGS and refused generically by
    // decodeDer before this function ever runs — this branch only guards the case
    // where a future ALLOWED_TAGS addition reopens that gap.
    return malformed('AttributeTypeAndValue.value must be UTF8String', 0)
  }
  return { commonName: new TextDecoder().decode(valueNode.content) }
}

/**
 * `AlgorithmIdentifier` check (X509-01/02): Ed25519 (`1.3.101.112`) is the only OID this
 * profile accepts, and its `parameters` field must be absent — RFC 8410 §10's named
 * legacy-tolerant trap. Checking the OID first, before `parameters`, means every banned
 * algorithm (SHA-1, P-192, P-224, RSA — RESEARCH.md §1) refuses `unrecognised-algorithm`
 * by the *same* mechanism without this module ever needing to implement one of those
 * OID branches: "the decoder never needs SHA-1, P-192, P-224, or any RSA OID branch
 * implemented at all" (RESEARCH.md §1).
 */
function checkAlgorithm(node: DerNode): X509Failure | null {
  const oidNode = node.children[0]
  if (!oidNode || oidNode.tag !== 0x06) {
    return malformed('expected an OBJECT IDENTIFIER as AlgorithmIdentifier.algorithm', 0)
  }
  const oid = decodeOid(oidNode.content)
  if (oid !== ID_ED25519) return { kind: 'unrecognised-algorithm', oid }
  if (node.children.length > 1) return { kind: 'algorithm-parameters-present', oid }
  return null
}

interface TbsFields {
  readonly version: number
  readonly serialNumber: string
  readonly issuerCommonName: string
  readonly notBefore: number
  readonly notAfter: number
  readonly subjectCommonName: string
  readonly subjectPublicKey: string
  readonly extensionsNode: DerNode | null
}

/**
 * Walk `TBSCertificate`'s fixed-position grammar (RESEARCH.md §1's table), extracting
 * every field by position — this profile has no `CHOICE` ambiguity to resolve except
 * `version`'s DEFAULT and `extensions`' OPTIONAL, both handled by peeking the next
 * child's tag before consuming it.
 */
function assembleTbs(tbs: DerNode): TbsFields | X509Failure {
  const children = tbs.children
  let i = 0
  let version = 0

  if (children[i]?.tag === 0xa0) {
    const inner = children[i]?.children[0]
    if (!inner || inner.tag !== 0x02) return malformed('expected version INTEGER wrapped by [0] EXPLICIT', 0)
    version = readSmallInteger(inner.content)
    i++
  }

  const serialNode = children[i]
  i++
  if (!serialNode || serialNode.tag !== 0x02) return malformed('expected serialNumber INTEGER', 0)
  const serialNumber = toHex(serialNode.content)

  const tbsAlgNode = children[i]
  i++
  if (!tbsAlgNode || tbsAlgNode.tag !== 0x30) {
    return malformed('expected TBSCertificate.signature AlgorithmIdentifier SEQUENCE', 0)
  }
  // Algorithm OID validated by Plan 25-02 Task 2's `checkAlgorithm` (X509-01/02), wired
  // in below `assembleTbs` once the allow-list lands — this commit is structural only.

  const issuerResult = readName(children[i])
  i++
  if (isX509Failure(issuerResult)) return issuerResult

  const validityNode = children[i]
  i++
  if (!validityNode || validityNode.tag !== 0x30 || validityNode.children.length !== 2) {
    return malformed('expected Validity SEQUENCE with notBefore and notAfter', 0)
  }
  const notBeforeNode = validityNode.children[0] as DerNode
  const notAfterNode = validityNode.children[1] as DerNode
  if (notBeforeNode.tag === 0x18 || notAfterNode.tag === 0x18) {
    // RFC 5280 mandates GeneralizedTime only for dates >=2050; this profile's short
    // certificate lifetimes (30-day default, enrollment.ts) never approach it, so its
    // presence here is never a legitimate alternate encoding — refuse by name.
    return { kind: 'generalized-time-present' }
  }
  if (notBeforeNode.tag !== 0x17 || notAfterNode.tag !== 0x17) {
    return malformed('expected UTCTime for notBefore/notAfter', 0)
  }
  const notBefore = parseUtcTime(notBeforeNode.content)
  const notAfter = parseUtcTime(notAfterNode.content)
  if (notBefore === null || notAfter === null) return malformed('malformed UTCTime content', 0)

  const subjectResult = readName(children[i])
  i++
  if (isX509Failure(subjectResult)) return subjectResult

  const spkiNode = children[i]
  i++
  if (!spkiNode || spkiNode.tag !== 0x30 || spkiNode.children.length !== 2) {
    return malformed('expected SubjectPublicKeyInfo SEQUENCE with algorithm and subjectPublicKey', 0)
  }
  const spkiAlgNode = spkiNode.children[0] as DerNode
  if (spkiAlgNode.tag !== 0x30) {
    return malformed('expected SubjectPublicKeyInfo.algorithm AlgorithmIdentifier SEQUENCE', 0)
  }
  // Algorithm OID validated by Task 2's `checkAlgorithm`, same as the TBS-inner field above.
  const spkiKeyNode = spkiNode.children[1] as DerNode
  // BIT STRING content = 1 unused-bits byte + the raw 32-byte Ed25519 key, no OCTET
  // STRING wrapper (RESEARCH.md Pitfall 2 — the private-key wrapping habit does not
  // apply here). 33 bytes total is therefore exact, not a minimum.
  if (spkiKeyNode.tag !== 0x03 || spkiKeyNode.content.length !== 33) {
    return malformed('expected a 32-byte Ed25519 key in subjectPublicKey BIT STRING (33 bytes with the unused-bits octet)', 0)
  }
  const subjectPublicKey = toHex(spkiKeyNode.content.subarray(1))

  // issuerUniqueID [1] / subjectUniqueID [2] — RFC 5280 §4.1.2.8: "CAs conforming to
  // this profile MUST NOT generate certificates with unique identifiers." Either tag
  // present at this position refuses the same named way; there is no need to look past
  // the first one found.
  if (children[i]?.tag === 0x81 || children[i]?.tag === 0x82) {
    return { kind: 'unique-identifier-present' }
  }

  let extensionsNode: DerNode | null = null
  if (children[i]?.tag === 0xa3) {
    extensionsNode = children[i] as DerNode
    i++
  }

  return {
    version,
    serialNumber,
    issuerCommonName: issuerResult.commonName,
    notBefore,
    notAfter,
    subjectCommonName: subjectResult.commonName,
    subjectPublicKey,
    extensionsNode,
  }
}

export interface X509Certificate {
  readonly version: number
  readonly serialNumber: string
  readonly issuerCommonName: string
  readonly notBefore: number
  readonly notAfter: number
  readonly subjectCommonName: string
  readonly subjectPublicKey: string
  readonly userKey: string
  readonly operatorId: string
  readonly discoverability: 'seed' | 'via-relay'
  readonly relayIds: readonly string[]
  readonly signature: string
}

export type X509Result =
  | { readonly ok: true; readonly certificate: X509Certificate }
  | { readonly ok: false; readonly failure: X509Failure; readonly reason: string }

/** A human-readable account of a refusal, naming the offending value. Copies capability.ts's `describeFailure` shape. */
export function describeX509Failure(failure: X509Failure): string {
  switch (failure.kind) {
    case 'certificate-too-large':
      return `certificate is ${failure.bytes} bytes, more than the ${failure.limit} allowed`
    case 'malformed-der':
      return `malformed DER at offset ${failure.offset}: ${failure.detail}`
    case 'unrecognised-algorithm':
      return `algorithm OID ${failure.oid} is not id-Ed25519 (${ID_ED25519}), the only algorithm this profile accepts`
    case 'algorithm-parameters-present':
      return `algorithm OID ${failure.oid} carries a parameters field, which RFC 8410 §10 requires be absent`
    case 'non-canonical-encoding':
      return `certificate is not canonical DER: ${failure.reason}`
    case 'extension-too-large':
      return `extension ${failure.oid} is ${failure.bytes}, more than the ${failure.limit} allowed`
    case 'too-many-extensions':
      return `certificate carries ${failure.count} extensions, more than the ${failure.limit} allowed`
    case 'duplicate-extension':
      return `extension ${failure.oid} appears more than once`
    case 'unrecognised-extension':
      return `extension ${failure.oid} is not one of this profile's four recognised extensions`
    case 'unique-identifier-present':
      return 'certificate carries an issuerUniqueID or subjectUniqueID, which RFC 5280 §4.1.2.8 forbids'
    case 'multi-valued-rdn':
      return "issuer or subject Name's RelativeDistinguishedName carries more than one AttributeTypeAndValue"
    case 'generalized-time-present':
      return 'notBefore or notAfter uses GeneralizedTime instead of the UTCTime this profile requires'
  }
}

/**
 * Decode and validate a full X.509 v3 certificate against this profile's seven
 * obligations (X509-01…07). Structural assembly only in this commit — Plan 25-02's
 * Task 2 wires the algorithm allow-list into effect and the extension rules; Task 3
 * wires the canonicalisation gate.
 */
export function decodeX509Certificate(_bytes: Uint8Array): X509Result {
  throw new Error('not implemented — Task 1 of 25-02')
}
