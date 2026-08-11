import { ed25519 } from '@noble/curves/ed25519.js'
import * as dagCbor from '@ipld/dag-cbor'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TAGS,
  EXT_DISCOVERABILITY,
  EXT_OPERATOR_ID,
  EXT_RELAY_IDS,
  EXT_USER_KEY,
  ID_AT_COMMON_NAME,
  ID_ED25519,
  MAX_CERTIFICATE_BYTES,
  MAX_EXTENSION_BYTES,
  MAX_EXTENSION_COUNT,
  X509_EXTENSION_ARC,
  checkDerCanonical,
  decodeDer,
  decodeX509Certificate,
  describeX509Failure,
  encodeDer,
  preParseCheck,
} from './x509.ts'
import type { DerNode, X509Failure } from './x509.ts'
import { encodeX509Certificate, encodeX509Tbs } from './x509-encode.ts'
import { certificatePayload, verifyCertificate } from './enrollment.ts'
import type { NodeCertificate } from './enrollment.ts'

/**
 * X509-04 — the DER decoder's foundation: a certificate-size gate checked before any
 * parsing, and a bounded TLV engine that refuses indefinite length, out-of-profile
 * tags, and truncated input by name rather than reading out of bounds.
 *
 * Fixture builder, hand-assembled independently of `encodeDer` (which is Task 3's
 * subject) so these fixtures do not depend on the code under test in Task 3.
 */
function tlv(tag: number, content: Uint8Array | readonly number[]): Uint8Array {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
  const length =
    bytes.length <= 0x7f
      ? new Uint8Array([bytes.length])
      : (() => {
          const lenBytes: number[] = []
          let n = bytes.length
          while (n > 0) {
            lenBytes.unshift(n & 0xff)
            n = Math.floor(n / 256)
          }
          return new Uint8Array([0x80 | lenBytes.length, ...lenBytes])
        })()
  return new Uint8Array([tag, ...length, ...bytes])
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('MAX_CERTIFICATE_BYTES is a bound, not a ban (X509-04)', () => {
  it('accepts a byte length exactly at the bound', () => {
    // The other half of the bound, and the half that makes it a bound rather than a
    // ban. Without this, narrowing MAX_CERTIFICATE_BYTES to 1 would leave this file green.
    const bytes = new Uint8Array(MAX_CERTIFICATE_BYTES)
    expect(preParseCheck(bytes)).toBeNull()
  })

  it('refuses a byte length one past the bound, naming the actual size and the limit', () => {
    const bytes = new Uint8Array(MAX_CERTIFICATE_BYTES + 1)
    const failure = preParseCheck(bytes)
    expect(failure).not.toBeNull()
    if (!failure) return
    expect(failure.kind).toBe('certificate-too-large')
    if (failure.kind !== 'certificate-too-large') return
    expect(failure.bytes).toBe(MAX_CERTIFICATE_BYTES + 1)
    expect(failure.limit).toBe(MAX_CERTIFICATE_BYTES)
  })
})

describe('certificate-size gate runs before any TLV parsing (X509-04)', () => {
  it('refuses certificate-too-large before decodeDer parses even one tag byte', () => {
    // Oversized AND its first byte (0xff) is neither an allowed tag nor a legal
    // non-high-tag-number byte -- if the size gate ran after even one byte of
    // parsing, this input would refuse 'malformed-der' first. It must not: the
    // composition below (mirroring what Plan 25-02's decodeX509Certificate does)
    // must never reach decodeDer at all.
    const oversized = new Uint8Array(MAX_CERTIFICATE_BYTES + 1).fill(0xff)

    let decodeDerCalls = 0
    const countingDecodeDer = (bytes: Uint8Array) => {
      decodeDerCalls++
      return decodeDer(bytes)
    }

    const sizeFailure = preParseCheck(oversized)
    const composed = sizeFailure ? ({ ok: false, failure: sizeFailure } as const) : countingDecodeDer(oversized)

    expect(composed.ok).toBe(false)
    if (composed.ok) return
    expect(composed.failure.kind).toBe('certificate-too-large')
    expect(decodeDerCalls).toBe(0)

    // What a wrong-order implementation would produce: calling decodeDer directly,
    // bypassing the gate, on the very same bytes.
    const direct = decodeDer(oversized)
    expect(direct.ok).toBe(false)
    if (direct.ok) return
    expect(direct.failure.kind).toBe('malformed-der')
  })
})

describe('decodeDer refuses BER indefinite length (X509-04 / T-25-01)', () => {
  it('refuses the 0x80 indefinite-length marker at the length octet', () => {
    // A lenient BER-tolerant decoder would instead scan forward looking for the
    // terminating 00 00 octet pair before giving up. This decoder must refuse at the
    // length octet itself, without attempting that scan.
    const bytes = new Uint8Array([0x30, 0x80, 0x02, 0x01, 0x01, 0x00, 0x00])
    const result = decodeDer(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-der')
  })
})

describe('decodeDer refuses out-of-profile tags by name', () => {
  it('refuses a tag byte outside this profile\'s allowed tags', () => {
    // 0x0a is ASN.1 ENUMERATED -- not in ALLOWED_TAGS. A generic parser would decode it
    // as a plain value; this decoder must refuse it by name instead.
    //
    // This case used to plant 0x05 (NULL), which was itself out of profile in Plan
    // 25-01. Plan 25-02 moved 0x05 INTO ALLOWED_TAGS (see that constant's own
    // docblock) so a present-but-NULL Ed25519 `parameters` field can be refused by the
    // specific `algorithm-parameters-present` kind instead of a generic tag refusal --
    // so 0x05 is no longer a valid example of "outside the profile" and this case was
    // re-aimed at a tag that still is.
    expect(ALLOWED_TAGS.has(0x0a)).toBe(false)
    const bytes = tlv(0x0a, [])
    const result = decodeDer(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-der')
  })

  it('refuses the high-tag-number form regardless of ALLOWED_TAGS membership', () => {
    // Tag byte 0x1f has its low 5 bits all set -- the high-tag-number form. A lenient
    // parser would read one or more following bytes as the extended tag number; this
    // decoder refuses on sight of the pattern.
    const bytes = tlv(0x1f, [0x00])
    const result = decodeDer(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-der')
  })
})

describe('decodeDer refuses truncated input instead of reading out of bounds', () => {
  it('refuses a TLV whose declared length runs past the end of the buffer', () => {
    // OCTET STRING claims 5 content bytes; only 2 are present. A naive decoder
    // (`bytes.subarray(offset, offset + 5)`) would silently return a short slice
    // instead of refusing -- or, in a hand-rolled indexed loop, throw an uncaught
    // RangeError. This decoder must do neither.
    const bytes = new Uint8Array([0x04, 0x05, 0x01, 0x02])
    const result = decodeDer(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-der')
  })

  it('refuses a long-form length declaration that itself runs past the buffer', () => {
    // 0x81 says "one more length byte follows" but the buffer ends right there.
    const bytes = new Uint8Array([0x04, 0x81])
    const result = decodeDer(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-der')
  })
})

describe('decodeDer decodes well-formed nested structures faithfully', () => {
  it('decodes a nested SEQUENCE built only from the 12 allowed tags, preserving content and shape', () => {
    const integer = tlv(0x02, [0x2a])
    const octetString = tlv(0x04, [0xde, 0xad, 0xbe, 0xef])
    const nestedInteger = tlv(0x02, [0x07])
    const inner = tlv(0x30, nestedInteger)
    const bytes = tlv(0x30, concatBytes(integer, octetString, inner))

    const result = decodeDer(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.node.tag).toBe(0x30)
    expect(result.node.constructed).toBe(true)
    expect(result.node.children).toHaveLength(3)

    const [first, second, third] = result.node.children
    expect(first).toMatchObject({ tag: 0x02, constructed: false })
    expect(Array.from(first!.content)).toEqual([0x2a])

    expect(second).toMatchObject({ tag: 0x04, constructed: false })
    expect(Array.from(second!.content)).toEqual([0xde, 0xad, 0xbe, 0xef])

    expect(third).toMatchObject({ tag: 0x30, constructed: true })
    expect(third!.children).toHaveLength(1)
    expect(Array.from(third!.children[0]!.content)).toEqual([0x07])
  })
})

/**
 * X509-03 mechanism — DER canonicalisation proved by re-encode/byte-compare, one
 * planted byte-level mutation per RESEARCH.md §2 divergence row. `checkDerCanonical`
 * is standalone and unit-tested here; Plan 25-02 wires it as a certificate-level gate.
 */
describe('canonical DER re-encoding round trip (X509-03 mechanism)', () => {
  it('is not canonical when a length uses long form where short form would fit', () => {
    // 127 content bytes encoded with an explicit long-form length (0x81 0x7f) instead
    // of the minimal short form (0x7f). A lenient BER-tolerant comparator would treat
    // these as equal since they decode to the same value; this round trip must not.
    const content = new Uint8Array(127).fill(0x41)
    const nonMinimalLength = new Uint8Array([0x04, 0x81, 0x7f, ...content])
    expect(checkDerCanonical(nonMinimalLength)).toBe(false)
  })

  it('is not canonical when an INTEGER carries a redundant leading 0x00', () => {
    // 0x00 0x7f: the leading zero is redundant since the next byte's high bit is
    // already 0. A lenient parser accepts it as the value 0x7f; DER requires the
    // shorter minimal form.
    const bytes = tlv(0x02, [0x00, 0x7f])
    expect(checkDerCanonical(bytes)).toBe(false)
  })

  it('is canonical when an INTEGER\'s leading 0x00 disambiguates a positive value', () => {
    // 0x00 0x80: here the leading zero is NOT redundant -- without it, 0x80 alone
    // would read as a negative two's-complement value. DER requires keeping it, so
    // this input is already canonical and must round-trip byte-identical.
    const bytes = tlv(0x02, [0x00, 0x80])
    expect(checkDerCanonical(bytes)).toBe(true)
  })

  it('is not canonical when a BIT STRING\'s padding bits are not zeroed', () => {
    // unused-bits count 0x03 (the last 3 bits of the final content byte are padding),
    // and that final byte is 0xff -- so 3 padding bits carry garbage instead of zero.
    // A lenient parser ignores padding-bit content entirely, since it plays no part
    // in the represented value; DER's canonical encoding zeroes it.
    const bytes = tlv(0x03, [0x03, 0xff])
    expect(checkDerCanonical(bytes)).toBe(false)
  })

  it('is not canonical when a BOOLEAN TRUE is not exactly 0xff', () => {
    // 0x01 is BER-legal for TRUE (any nonzero byte is); DER requires exactly 0xff.
    const bytes = tlv(0x01, [0x01])
    expect(checkDerCanonical(bytes)).toBe(false)
  })

  it('is canonical for a fully DER-canonical input: minimal lengths, no INTEGER padding, zeroed BIT STRING padding, 0xff BOOLEAN', () => {
    // The "other half" of the round-trip check -- without this case, an encodeDer
    // that always returned an empty Uint8Array would make every refusal test above
    // pass for the wrong reason (everything would mismatch, including canonical input).
    const canonicalInteger = tlv(0x02, [0x01])
    const canonicalBoolean = tlv(0x01, [0xff])
    const canonicalBitString = tlv(0x03, [0x00, 0xab, 0xcd]) // unused=0, byte-aligned
    const bytes = tlv(0x30, concatBytes(canonicalInteger, canonicalBoolean, canonicalBitString))
    expect(checkDerCanonical(bytes)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Certificate fixture builder (Plan 25-02) — shared across Tasks 1-3.
//
// Built through DerNode + encodeDer (Plan 25-01's own encoder), field by field per
// RESEARCH.md §1's grammar, rather than hand-written hex, so every mutation test plants
// exactly one field and leaves the rest of a genuinely valid certificate untouched.
// ---------------------------------------------------------------------------

/** Deterministic keys: seeded rather than random, matching capability.test.ts's `keypair`. */
function keypair(seed: number): { priv: Uint8Array; pub: Uint8Array } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: ed25519.getPublicKey(priv) }
}

const ISSUER = keypair(1) // the provider that signs the certificate
const NODE = keypair(2) // the node the certificate is issued to

const FIXTURE_NOW = 1_800_000_000_000
const FIXTURE_LATER = FIXTURE_NOW + 30 * 24 * 60 * 60 * 1000 // 30-day lifetime, matching enrollment.ts's default

function testHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function prim(tag: number, content: Uint8Array | readonly number[]): DerNode {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
  return { tag, constructed: false, content: bytes, children: [] }
}

function cons(tag: number, children: readonly DerNode[]): DerNode {
  return { tag, constructed: true, content: new Uint8Array(0), children }
}

/** Dotted-decimal OID -> DER content bytes. Independent of x509.ts's internal `decodeOid`, so a fixture never depends on the code under test to build itself. */
function oidBytes(dotted: string): Uint8Array {
  const parts = dotted.split('.').map((p) => BigInt(p))
  const first = (parts[0] as bigint) * 40n + (parts[1] as bigint)
  const out: number[] = [Number(first)]
  for (let idx = 2; idx < parts.length; idx++) {
    let n = parts[idx] as bigint
    const chunk: number[] = [Number(n & 0x7fn)]
    n >>= 7n
    while (n > 0n) {
      chunk.unshift(Number(n & 0x7fn) | 0x80)
      n >>= 7n
    }
    out.push(...chunk)
  }
  return new Uint8Array(out)
}

function algId(oid: string, params?: DerNode): DerNode {
  const children = params ? [prim(0x06, oidBytes(oid)), params] : [prim(0x06, oidBytes(oid))]
  return cons(0x30, children)
}

function utcTimeBytes(ms: number): Uint8Array {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  const text = `${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`
  return new TextEncoder().encode(text)
}

function rdnName(commonName: string, opts?: { multiValued?: boolean; valueTag?: number }): DerNode {
  const value = prim(opts?.valueTag ?? 0x0c, new TextEncoder().encode(commonName))
  const atv = cons(0x30, [prim(0x06, oidBytes(ID_AT_COMMON_NAME)), value])
  const rdnChildren = opts?.multiValued ? [atv, atv] : [atv]
  return cons(0x30, [cons(0x31, rdnChildren)])
}

function bitString(raw: Uint8Array, unusedBits = 0): DerNode {
  return prim(0x03, new Uint8Array([unusedBits, ...raw]))
}

function extensionNode(oid: string, payload: Uint8Array): DerNode {
  return cons(0x30, [prim(0x06, oidBytes(oid)), prim(0x04, payload)])
}

function defaultExtensions(): DerNode[] {
  return [
    extensionNode(EXT_USER_KEY, NODE.pub),
    extensionNode(EXT_OPERATOR_ID, dagCbor.encode('test-operator')),
    extensionNode(EXT_DISCOVERABILITY, new Uint8Array([0x00])),
    extensionNode(EXT_RELAY_IDS, dagCbor.encode(['relay-a', 'relay-b'])),
  ]
}

interface FixtureOverrides {
  readonly version?: DerNode | 'omit'
  readonly serialNumber?: Uint8Array
  readonly tbsAlgorithm?: DerNode
  readonly issuerName?: DerNode
  readonly notBefore?: DerNode
  readonly notAfter?: DerNode
  readonly subjectName?: DerNode
  readonly spkiAlgorithm?: DerNode
  readonly subjectPublicKey?: DerNode
  readonly issuerUniqueId?: DerNode
  readonly subjectUniqueId?: DerNode
  readonly extensions?: readonly DerNode[] | 'omit'
  readonly outerAlgorithm?: DerNode
  readonly signature?: DerNode
}

/**
 * Assemble a full DER-encoded certificate matching this profile's grammar, with any
 * field replaceable so a test can plant exactly one mutation and leave a genuinely
 * valid certificate around it — the "restore by the surgical inverse" discipline
 * applied to fixture construction rather than to a live edit.
 */
function buildCertificateFixture(
  overrides: FixtureOverrides = {},
  serialize: (node: DerNode) => Uint8Array = encodeDer,
): Uint8Array {
  const tbsChildren: DerNode[] = []

  if (overrides.version !== 'omit') {
    tbsChildren.push(overrides.version ?? cons(0xa0, [prim(0x02, [0x02])]))
  }
  tbsChildren.push(prim(0x02, overrides.serialNumber ?? new Uint8Array([0x01, 0x02, 0x03, 0x04])))
  tbsChildren.push(overrides.tbsAlgorithm ?? algId(ID_ED25519))
  tbsChildren.push(overrides.issuerName ?? rdnName(testHex(ISSUER.pub)))
  tbsChildren.push(
    cons(0x30, [
      overrides.notBefore ?? prim(0x17, utcTimeBytes(FIXTURE_NOW)),
      overrides.notAfter ?? prim(0x17, utcTimeBytes(FIXTURE_LATER)),
    ]),
  )
  tbsChildren.push(overrides.subjectName ?? rdnName(testHex(NODE.pub)))
  tbsChildren.push(
    cons(0x30, [overrides.spkiAlgorithm ?? algId(ID_ED25519), overrides.subjectPublicKey ?? bitString(NODE.pub)]),
  )
  if (overrides.issuerUniqueId) tbsChildren.push(overrides.issuerUniqueId)
  if (overrides.subjectUniqueId) tbsChildren.push(overrides.subjectUniqueId)
  if (overrides.extensions !== 'omit') {
    tbsChildren.push(cons(0xa3, [cons(0x30, overrides.extensions ?? defaultExtensions())]))
  }

  const tbs = cons(0x30, tbsChildren)
  // Always signed over the canonical TBS encoding, regardless of `serialize` --
  // decodeX509Certificate never cryptographically verifies this signature (that is a
  // separate concern from this module's encoding-level profile), so a mutation
  // targeting the final serialization step does not need a matching mutated signature.
  const tbsBytes = encodeDer(tbs)
  const signatureRaw = ed25519.sign(tbsBytes, ISSUER.priv)

  const certificate = cons(0x30, [
    tbs,
    overrides.outerAlgorithm ?? algId(ID_ED25519),
    overrides.signature ?? bitString(signatureRaw),
  ])

  return serialize(certificate)
}

/**
 * Task 1 — TBSCertificate assembly and RFC 5280 structural refusals. Algorithm
 * validation and extension processing are Task 2's wiring, and the canonicalisation
 * gate is Task 3's; fixtures below use `extensions: 'omit'` since Task 1's assembly
 * does not yet read them.
 */
describe('TBSCertificate assembly (X509-04 grammar, RFC 5280 structural refusals)', () => {
  it('refuses a certificate carrying an issuerUniqueID [1]', () => {
    // RFC 5280 §4.1.2.8: "CAs conforming to this profile MUST NOT generate
    // certificates with unique identifiers." A lenient decoder would silently skip an
    // unrecognised optional field; this one refuses it by name.
    const bytes = buildCertificateFixture({ issuerUniqueId: prim(0x81, [0x00, 0x01, 0x02, 0x03]), extensions: 'omit' })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unique-identifier-present')
  })

  it('refuses a certificate carrying a subjectUniqueID [2]', () => {
    // Distinct planted fixture from the issuerUniqueID case above — same refusal kind,
    // different tag, so both halves of RFC 5280 §4.1.2.8's ban are proved separately.
    const bytes = buildCertificateFixture({ subjectUniqueId: prim(0x82, [0x00, 0x04, 0x05]), extensions: 'omit' })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unique-identifier-present')
  })

  it('refuses GeneralizedTime in notBefore', () => {
    // RFC 5280 mandates GeneralizedTime only for dates >=2050; this profile's
    // certificates never approach it, so a lenient parser accepting it as an alternate
    // UTCTime encoding is exactly the gap this refusal closes.
    const bytes = buildCertificateFixture({ notBefore: prim(0x18, utcTimeBytes(FIXTURE_NOW)), extensions: 'omit' })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('generalized-time-present')
  })

  it('refuses a multi-valued issuer RDN', () => {
    // Sidesteps DER's SET OF canonical-ordering rule entirely (RESEARCH.md §1/§2 row
    // 5) — a lenient parser would accept the second AttributeTypeAndValue and either
    // use the first or the last; this profile refuses the ambiguity outright.
    const bytes = buildCertificateFixture({ issuerName: rdnName(testHex(ISSUER.pub), { multiValued: true }), extensions: 'omit' })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('multi-valued-rdn')
  })

  it('refuses an AttributeTypeAndValue.value encoded as PrintableString instead of UTF8String', () => {
    // Tag 0x13 (PrintableString) is outside ALLOWED_TAGS entirely, so decodeDer itself
    // refuses it generically before assembly ever runs — folded into malformed-der
    // rather than a dedicated kind, since this is a tag-shape violation at a fixed
    // grammar position, not a semantic decision (per this task's own <action> text).
    const bytes = buildCertificateFixture({ subjectName: rdnName(testHex(NODE.pub), { valueTag: 0x13 }), extensions: 'omit' })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-der')
  })

  it('decodes subjectPublicKey to exactly 64 hex characters (32 raw bytes), no OCTET STRING wrapper', () => {
    // The concrete regression RESEARCH.md Pitfall 2 names: copying the private-key
    // OCTET STRING wrapping habit into the public SPKI BIT STRING would leave a `04 20`
    // prefix inside the decoded bytes and a content length of 34+ instead of 33.
    const bytes = buildCertificateFixture({ extensions: 'omit' })
    const result = decodeX509Certificate(bytes)
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    if (!result.ok) return
    expect(result.certificate.subjectPublicKey).toHaveLength(64)
    expect(result.certificate.subjectPublicKey.startsWith('0420')).toBe(false)
    expect(result.certificate.subjectPublicKey).toBe(testHex(NODE.pub))
  })
})

// ---------------------------------------------------------------------------
// Task 2 — algorithm allow-list, extension rules, custom extension mapping.
// ---------------------------------------------------------------------------

/** SHA-1-with-RSA, this profile's SHA-1 test vector (RESEARCH.md §1). */
const SHA1_WITH_RSA_OID = '1.2.840.113549.1.1.5'
/** id-ecPublicKey — the outer OID this profile refuses regardless of the curve named in `parameters`. */
const EC_PUBLIC_KEY_OID = '1.2.840.10045.2.1'
/** secp192r1 / P-192, carried as `parameters` under id-ecPublicKey. */
const P192_OID = '1.2.840.10045.3.1.1'
/** secp224r1 / P-224, carried as `parameters` under id-ecPublicKey. */
const P224_OID = '1.3.132.0.33'
/** rsaEncryption, this profile's RSA<2048 test vector — the OID alone refuses; modulus size is never inspected. */
const RSA_ENCRYPTION_OID = '1.2.840.113549.1.1.1'

/** `count` distinct Extension nodes under dummy OIDs outside this profile's 4-member registry, each a 1-byte payload. */
function fillerExtensions(count: number): DerNode[] {
  return Array.from({ length: count }, (_, i) => extensionNode(`${X509_EXTENSION_ARC}.${100 + i}`, new Uint8Array([0x00])))
}

describe('algorithm allow-list (X509-01/02)', () => {
  it('refuses a present (even NULL) parameters field on the Ed25519 AlgorithmIdentifier', () => {
    // RFC 8410 §10's named legacy-tolerant trap: "It is possible to find systems that
    // require the parameters to be present... due to either a defect in the original
    // 1997 syntax or a programming error." This profile refuses even the NULL case.
    const bytes = buildCertificateFixture({ spkiAlgorithm: algId(ID_ED25519, prim(0x05, [])) })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('algorithm-parameters-present')
    if (result.failure.kind !== 'algorithm-parameters-present') return
    expect(result.failure.oid).toBe(ID_ED25519)
  })

  it('refuses SHA-1 (sha1WithRSAEncryption) by name', () => {
    const bytes = buildCertificateFixture({ spkiAlgorithm: algId(SHA1_WITH_RSA_OID) })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-algorithm')
    if (result.failure.kind !== 'unrecognised-algorithm') return
    expect(result.failure.oid).toBe(SHA1_WITH_RSA_OID)
  })

  it('refuses P-192 (id-ecPublicKey with secp192r1 parameters) by the outer OID', () => {
    // The outer id-ecPublicKey OID mismatch already refuses before `parameters` (the
    // curve) would ever matter — deliberate minimalism per RESEARCH.md §1: "the
    // decoder never needs SHA-1, P-192, P-224, or any RSA OID branch implemented at
    // all." The curve is planted anyway so this is a genuinely distinct fixture from
    // the P-224 case below, not the same bytes read twice.
    const bytes = buildCertificateFixture({
      spkiAlgorithm: algId(EC_PUBLIC_KEY_OID, prim(0x06, oidBytes(P192_OID))),
    })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-algorithm')
    if (result.failure.kind !== 'unrecognised-algorithm') return
    expect(result.failure.oid).toBe(EC_PUBLIC_KEY_OID)
  })

  it('refuses P-224 (id-ecPublicKey with secp224r1 parameters) by the outer OID', () => {
    // Distinct planted fixture (different parameter bytes) from P-192, even though both
    // reach the identical refusal path -- satisfying 25-CONTEXT.md's "each with its own test".
    const bytes = buildCertificateFixture({
      spkiAlgorithm: algId(EC_PUBLIC_KEY_OID, prim(0x06, oidBytes(P224_OID))),
    })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-algorithm')
    if (result.failure.kind !== 'unrecognised-algorithm') return
    expect(result.failure.oid).toBe(EC_PUBLIC_KEY_OID)
  })

  it('refuses RSA (rsaEncryption) by name, without ever inspecting modulus size', () => {
    const bytes = buildCertificateFixture({ spkiAlgorithm: algId(RSA_ENCRYPTION_OID) })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-algorithm')
    if (result.failure.kind !== 'unrecognised-algorithm') return
    expect(result.failure.oid).toBe(RSA_ENCRYPTION_OID)
  })
})

describe('extension rules (X509-06/07) and custom extension mapping', () => {
  it('refuses a duplicate extnID outright, never last-wins', () => {
    const bytes = buildCertificateFixture({
      extensions: [extensionNode(EXT_USER_KEY, NODE.pub), extensionNode(EXT_USER_KEY, NODE.pub)],
    })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('duplicate-extension')
    if (result.failure.kind !== 'duplicate-extension') return
    expect(result.failure.oid).toBe(EXT_USER_KEY)
  })

  it('accepts exactly MAX_EXTENSION_COUNT extensions at the count gate (proved by the next refusal being unrecognised-extension, not too-many-extensions)', () => {
    // This profile's closed registry has only 4 legal extensions, so a certificate
    // carrying MAX_EXTENSION_COUNT (8) genuinely-accepted extensions cannot be built —
    // the two-sided bound is proved at the mechanism level instead: the count gate runs
    // BEFORE the per-extension membership loop (Task 2's own <action> text), so 8
    // distinct-OID filler extensions must clear the count gate and fail one entry later,
    // on the first one's unrecognised OID, not on the count.
    const bytes = buildCertificateFixture({ extensions: fillerExtensions(MAX_EXTENSION_COUNT) })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-extension')
  })

  it('refuses MAX_EXTENSION_COUNT + 1 extensions by name, naming the count and the limit', () => {
    const bytes = buildCertificateFixture({ extensions: fillerExtensions(MAX_EXTENSION_COUNT + 1) })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('too-many-extensions')
    if (result.failure.kind !== 'too-many-extensions') return
    expect(result.failure.count).toBe(MAX_EXTENSION_COUNT + 1)
    expect(result.failure.limit).toBe(MAX_EXTENSION_COUNT)
  })

  it('accepts an extension of exactly MAX_EXTENSION_BYTES at the size gate (proved the same way: the next refusal is unrecognised-extension, not extension-too-large)', () => {
    const oid = `${X509_EXTENSION_ARC}.200`
    const bytes = buildCertificateFixture({ extensions: [extensionNode(oid, new Uint8Array(MAX_EXTENSION_BYTES))] })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-extension')
  })

  it('refuses an extension one byte past MAX_EXTENSION_BYTES, naming the OID, the size, and the limit', () => {
    const oid = `${X509_EXTENSION_ARC}.201`
    const bytes = buildCertificateFixture({ extensions: [extensionNode(oid, new Uint8Array(MAX_EXTENSION_BYTES + 1))] })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('extension-too-large')
    if (result.failure.kind !== 'extension-too-large') return
    expect(result.failure.oid).toBe(oid)
    expect(result.failure.bytes).toBe(MAX_EXTENSION_BYTES + 1)
    expect(result.failure.limit).toBe(MAX_EXTENSION_BYTES)
  })

  it('refuses an extnID outside this profile\'s four recognised extensions, by name', () => {
    const oid = `${X509_EXTENSION_ARC}.202`
    const bytes = buildCertificateFixture({ extensions: [extensionNode(oid, new Uint8Array([0x01]))] })
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unrecognised-extension')
    if (result.failure.kind !== 'unrecognised-extension') return
    expect(result.failure.oid).toBe(oid)
  })

  it('decodes all four conformant custom extensions into their matching X509Certificate fields', () => {
    const bytes = buildCertificateFixture() // defaultExtensions(): userKey, operatorId, discoverability, relayIds
    const result = decodeX509Certificate(bytes)
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    if (!result.ok) return
    expect(result.certificate.userKey).toBe(testHex(NODE.pub))
    expect(result.certificate.operatorId).toBe('test-operator')
    expect(result.certificate.discoverability).toBe('seed')
    expect(result.certificate.relayIds).toEqual(['relay-a', 'relay-b'])
  })

  it('gives a distinct reason for every failure kind (mirrors capability.test.ts:187-199)', () => {
    const cases: X509Failure[] = [
      { kind: 'algorithm-parameters-present', oid: ID_ED25519 },
      { kind: 'unrecognised-algorithm', oid: SHA1_WITH_RSA_OID },
      { kind: 'too-many-extensions', count: MAX_EXTENSION_COUNT + 1, limit: MAX_EXTENSION_COUNT },
      { kind: 'duplicate-extension', oid: EXT_USER_KEY },
      { kind: 'extension-too-large', oid: EXT_USER_KEY, bytes: MAX_EXTENSION_BYTES + 1, limit: MAX_EXTENSION_BYTES },
      { kind: 'unrecognised-extension', oid: `${X509_EXTENSION_ARC}.203` },
    ]
    const reasons = cases.map((failure) => describeX509Failure(failure))
    expect(new Set(reasons).size).toBe(reasons.length)
  })
})

// ---------------------------------------------------------------------------
// Task 3 — canonicalisation gate, wired as decodeX509Certificate's final check.
// ---------------------------------------------------------------------------

function minimalLengthBytesTest(len: number): number[] {
  if (len <= 0x7f) return [len]
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n = Math.floor(n / 256)
  }
  return [0x80 | bytes.length, ...bytes]
}

/**
 * Like `encodeDer`, but never canonicalises a leaf's content (no INTEGER/BIT
 * STRING/BOOLEAN normalisation) and, when `nonMinimalLengthAt` names a specific node
 * instance, widens that one node's length octets by one extra byte beyond what its
 * content strictly needs. Lets a test plant exactly one genuinely non-canonical field
 * inside an otherwise well-formed certificate, with every ancestor SEQUENCE's length
 * correctly re-derived from the actual (poisoned) content size -- no manual byte
 * splicing, and no risk of the mutation being silently re-canonicalised away by the
 * encoder under test.
 */
function encodeDerRaw(node: DerNode, nonMinimalLengthAt?: DerNode): Uint8Array {
  let content: Uint8Array
  if (node.constructed) {
    const parts = node.children.map((child) => encodeDerRaw(child, nonMinimalLengthAt))
    const total = parts.reduce((n, p) => n + p.length, 0)
    content = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      content.set(part, offset)
      offset += part.length
    }
  } else {
    content = node.content
  }

  let lengthBytes: number[]
  if (node === nonMinimalLengthAt) {
    // Force long form with one more byte than the value strictly needs -- legal BER,
    // illegal DER (RESEARCH.md §2 row 2).
    const minimal = minimalLengthBytesTest(content.length)
    lengthBytes = (minimal[0] as number) <= 0x7f ? [0x81, minimal[0] as number] : [0x80 | (minimal.length - 1 + 1), 0x00, ...minimal.slice(1)]
  } else {
    lengthBytes = minimalLengthBytesTest(content.length)
  }

  const out = new Uint8Array(1 + lengthBytes.length + content.length)
  out[0] = node.tag
  out.set(lengthBytes, 1)
  out.set(content, 1 + lengthBytes.length)
  return out
}

describe('golden minimal-valid-certificate fixture', () => {
  it('decodes a fully conformant certificate, every field populated correctly', () => {
    const bytes = buildCertificateFixture()
    const result = decodeX509Certificate(bytes)
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    if (!result.ok) return
    expect(result.certificate.version).toBe(2)
    expect(result.certificate.serialNumber).toBe('01020304')
    expect(result.certificate.issuerCommonName).toBe(testHex(ISSUER.pub))
    expect(result.certificate.subjectCommonName).toBe(testHex(NODE.pub))
    // FIXTURE_NOW/FIXTURE_LATER are already whole-second unix-ms values, so the
    // UTCTime round trip (YYMMDDHHMMSSZ, second precision) reconstructs them exactly.
    expect(result.certificate.notBefore).toBe(FIXTURE_NOW)
    expect(result.certificate.notAfter).toBe(FIXTURE_LATER)
    expect(result.certificate.subjectPublicKey).toBe(testHex(NODE.pub))
    expect(result.certificate.userKey).toBe(testHex(NODE.pub))
    expect(result.certificate.operatorId).toBe('test-operator')
    expect(result.certificate.discoverability).toBe('seed')
    expect(result.certificate.relayIds).toEqual(['relay-a', 'relay-b'])
    expect(result.certificate.signature).toHaveLength(128)
  })
})

describe('certificate-level DER canonicalisation gate (X509-03)', () => {
  it('refuses a certificate whose signatureValue length uses long form where short form would fit', () => {
    // RESEARCH.md §2 row 2, applied at whole-certificate scope rather than a
    // standalone TLV (Plan 25-01's own canonicalisation tests proved the mechanism in
    // isolation; this proves it is actually wired into decodeX509Certificate).
    const dummySignature = bitString(new Uint8Array(64).fill(0x11))
    const bytes = buildCertificateFixture({ signature: dummySignature }, (node) => encodeDerRaw(node, dummySignature))
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('non-canonical-encoding')
  })

  it('refuses a certificate whose serialNumber carries a redundant leading 0x00', () => {
    const bytes = buildCertificateFixture({ serialNumber: new Uint8Array([0x00, 0x7f]) }, (node) => encodeDerRaw(node))
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('non-canonical-encoding')
  })

  it('refuses a certificate whose subjectPublicKey BIT STRING padding bits are not zeroed', () => {
    const poisoned = new Uint8Array(NODE.pub)
    poisoned[31] = (poisoned[31] as number) | 0x07 // garbage in what should be zeroed padding
    const bytes = buildCertificateFixture({ subjectPublicKey: bitString(poisoned, 3) }, (node) => encodeDerRaw(node))
    const result = decodeX509Certificate(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('non-canonical-encoding')
  })
})

// ---------------------------------------------------------------------------
// The profile on the trust path — X509-01…07 wired, fail-closed (2026-08-11)
// ---------------------------------------------------------------------------

/**
 * Everything above this line proves `decodeX509Certificate` refuses. That is a statement
 * about a function. These cases ask the question the ledger's six *Built, not wired* rows
 * were actually open on: **does a refusal deny anything?**
 *
 * The wiring is `verifyCertificate` (`enrollment.ts`), which every trust decision in this
 * repository about a peer's identity already goes through — `PeerVerifier` at admission,
 * `FabricNode`'s enrolment path, `discovery.ts`'s `resolveReplicaSets`,
 * `result-attestation.ts`'s third-party check, `identity-store.ts`'s reload from disk,
 * and the demo. A certificate carrying an X.509 form that this profile refuses is refused
 * **as a certificate**, at all six of those points at once.
 *
 * ## Every fixture here is signed by a *pinned* provider, and that is the whole design
 *
 * `payloadOf` puts the X.509 form inside the issuer's own signature, so a stranger who
 * edits the form breaks the envelope signature and would be refused a step later anyway.
 * Building these fixtures that way would prove nothing: the gate would be shadowed by a
 * check that already existed. So `certificateCarrying` **re-signs the envelope with the
 * pinned provider's own key** after planting the mutation. Every certificate below is one
 * a trusted provider genuinely issued, whose envelope signature verifies perfectly, and
 * which is refused *only* because its two halves disagree. That is the case the gate is
 * for — a provider is pinned to be believed about who a node is, not to be well-formed.
 */
const ENVELOPE_FIELDS = {
  nodeKey: testHex(NODE.pub),
  userKey: testHex(NODE.pub),
  operatorId: 'test-operator',
  discoverability: 'seed' as const,
  relayIds: ['relay-a', 'relay-b'],
  issuedAt: FIXTURE_NOW,
  expiresAt: FIXTURE_LATER,
  issuer: testHex(ISSUER.pub),
}

const PINNED = new Set([testHex(ISSUER.pub)])

/** The X.509 form a conformant issuance of `ENVELOPE_FIELDS` produces, straight from the production encoder. */
function conformantDer(): Uint8Array {
  return encodeX509Certificate(ENVELOPE_FIELDS, ed25519.sign(encodeX509Tbs(ENVELOPE_FIELDS), ISSUER.priv))
}

/** A certificate the pinned provider genuinely signed, carrying whatever X.509 bytes the caller hands it. */
function certificateCarrying(x509: string): NodeCertificate {
  const unsigned = { ...ENVELOPE_FIELDS, x509 }
  return { ...unsigned, signature: testHex(ed25519.sign(certificatePayload(unsigned), ISSUER.priv)) }
}

/**
 * Plant one mutation into the conformant certificate's DER tree and re-serialize.
 *
 * Tree surgery rather than byte splicing: `decodeDer` and `encodeDer` are the profile's
 * own engine, so every ancestor SEQUENCE's length is re-derived from the mutated content
 * and the fixture stays a genuinely well-formed certificate that differs in exactly one
 * place. `serialize` is a parameter for the one obligation that needs a *non*-canonical
 * result, which `encodeDer` would otherwise silently repair.
 */
function derWith(
  mutate: (tbs: DerNode, certificate: DerNode) => DerNode,
  serialize: (node: DerNode) => Uint8Array = encodeDer,
): string {
  const decoded = decodeDer(conformantDer())
  if (!decoded.ok) throw new Error('the conformant fixture did not decode')
  const certificate = decoded.node
  return testHex(serialize(mutate(certificate.children[0] as DerNode, certificate)))
}

/** Replace child `index` of `parent` with `replacement`, returning a new node. */
function replacingChild(parent: DerNode, index: number, replacement: DerNode): DerNode {
  const children = [...parent.children]
  children[index] = replacement
  return { ...parent, children }
}

/** Rebuild the whole certificate around a replaced TBSCertificate child. */
function certificateWithTbsChild(certificate: DerNode, index: number, replacement: DerNode): DerNode {
  const tbs = replacingChild(certificate.children[0] as DerNode, index, replacement)
  return replacingChild(certificate, 0, tbs)
}

/** TBSCertificate child positions, by name, for this profile's fixed-position grammar. */
const TBS_SERIAL = 1
const TBS_SIGNATURE_ALGORITHM = 2
const TBS_SUBJECT = 5
const TBS_SPKI = 6
const TBS_EXTENSIONS = 7

describe('the X.509 form is on the trust path, and a conformant one is accepted', () => {
  it('accepts a certificate whose X.509 form the production encoder minted', () => {
    // The non-vacuity case. Without it every refusal below would be satisfied by a gate
    // that refuses everything, which is not a profile.
    const verdict = verifyCertificate(certificateCarrying(testHex(conformantDer())), PINNED, FIXTURE_NOW + 1000)
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
  })

  it('still accepts a certificate that carries no X.509 form at all', () => {
    // Additive, not a replacement: absence is not a refusal, and `payloadOf` omits the
    // key rather than encoding a null, so a certificate issued before this field existed
    // signs and verifies byte-identically.
    const unsigned = ENVELOPE_FIELDS
    const certificate: NodeCertificate = {
      ...unsigned,
      signature: testHex(ed25519.sign(certificatePayload(unsigned), ISSUER.priv)),
    }
    expect(verifyCertificate(certificate, PINNED, FIXTURE_NOW + 1000).ok).toBe(true)
  })

  it('refuses an x509 field that is not hex before decoding anything', () => {
    const verdict = verifyCertificate(certificateCarrying('nothex'), PINNED, FIXTURE_NOW + 1000)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-not-hex')
  })
})

/** Assert that `verifyCertificate` refused for a profile reason, and hand back the profile's own failure. */
function profileRefusalOf(x509: string): X509Failure {
  const verdict = verifyCertificate(certificateCarrying(x509), PINNED, FIXTURE_NOW + 1000)
  expect(verdict.ok).toBe(false)
  if (verdict.ok) throw new Error('expected a refusal')
  expect(verdict.failure.kind).toBe('x509-profile-refused')
  if (verdict.failure.kind !== 'x509-profile-refused') throw new Error('expected an x509-profile-refused')
  // The forwarded refusal is the profile's own, not a re-description of it, so the
  // operator-facing reason names the offending value.
  expect(verdict.reason).toContain(describeX509Failure(verdict.failure.profile))
  return verdict.failure.profile
}

describe('X509-01 — a non-Ed25519 algorithm is refused on the trust path', () => {
  it('refuses a certificate whose SubjectPublicKeyInfo algorithm is rsaEncryption', () => {
    const failure = profileRefusalOf(
      derWith((tbs, certificate) => {
        const spki = tbs.children[TBS_SPKI] as DerNode
        return certificateWithTbsChild(certificate, TBS_SPKI, replacingChild(spki, 0, algId(RSA_ENCRYPTION_OID)))
      }),
    )
    expect(failure.kind).toBe('unrecognised-algorithm')
    if (failure.kind !== 'unrecognised-algorithm') return
    expect(failure.oid).toBe(RSA_ENCRYPTION_OID)
  })

  it('refuses a present parameters field on the Ed25519 algorithm, at TBSCertificate.signature', () => {
    // RFC 8410 §10's legacy-tolerant trap, reached through `verifyCertificate` rather
    // than through the decoder directly: even a NULL parameters field is a refusal.
    const failure = profileRefusalOf(
      derWith((_tbs, certificate) =>
        certificateWithTbsChild(certificate, TBS_SIGNATURE_ALGORITHM, algId(ID_ED25519, prim(0x05, []))),
      ),
    )
    expect(failure.kind).toBe('algorithm-parameters-present')
  })
})

describe('X509-02 — SHA-1, P-192, P-224 and RSA are each refused by name on the trust path', () => {
  it('refuses SHA-1 (sha1WithRSAEncryption) at TBSCertificate.signature', () => {
    const failure = profileRefusalOf(
      derWith((_tbs, certificate) =>
        certificateWithTbsChild(certificate, TBS_SIGNATURE_ALGORITHM, algId(SHA1_WITH_RSA_OID)),
      ),
    )
    expect(failure.kind).toBe('unrecognised-algorithm')
    if (failure.kind !== 'unrecognised-algorithm') return
    expect(failure.oid).toBe(SHA1_WITH_RSA_OID)
  })

  it('refuses P-192 (id-ecPublicKey carrying secp192r1) by the outer OID', () => {
    const failure = profileRefusalOf(
      derWith((tbs, certificate) => {
        const spki = tbs.children[TBS_SPKI] as DerNode
        const alg = algId(EC_PUBLIC_KEY_OID, prim(0x06, oidBytes(P192_OID)))
        return certificateWithTbsChild(certificate, TBS_SPKI, replacingChild(spki, 0, alg))
      }),
    )
    expect(failure.kind).toBe('unrecognised-algorithm')
    if (failure.kind !== 'unrecognised-algorithm') return
    expect(failure.oid).toBe(EC_PUBLIC_KEY_OID)
  })

  it('refuses P-224 (id-ecPublicKey carrying secp224r1) by the outer OID', () => {
    const failure = profileRefusalOf(
      derWith((tbs, certificate) => {
        const spki = tbs.children[TBS_SPKI] as DerNode
        const alg = algId(EC_PUBLIC_KEY_OID, prim(0x06, oidBytes(P224_OID)))
        return certificateWithTbsChild(certificate, TBS_SPKI, replacingChild(spki, 0, alg))
      }),
    )
    expect(failure.kind).toBe('unrecognised-algorithm')
    if (failure.kind !== 'unrecognised-algorithm') return
    expect(failure.oid).toBe(EC_PUBLIC_KEY_OID)
  })

  it('refuses RSA (rsaEncryption) at TBSCertificate.signature, without inspecting modulus size', () => {
    const failure = profileRefusalOf(
      derWith((_tbs, certificate) =>
        certificateWithTbsChild(certificate, TBS_SIGNATURE_ALGORITHM, algId(RSA_ENCRYPTION_OID)),
      ),
    )
    expect(failure.kind).toBe('unrecognised-algorithm')
    if (failure.kind !== 'unrecognised-algorithm') return
    expect(failure.oid).toBe(RSA_ENCRYPTION_OID)
  })
})

describe('X509-03 — a non-canonical certificate is refused on the trust path', () => {
  it('refuses a certificate whose signatureValue length uses long form where short form would fit', () => {
    // Serialized through `encodeDerRaw`, because `encodeDer` would repair the mutation
    // on the way out — the gate has to be shown refusing a certificate that really is
    // non-canonical on the wire, not one this test only intended to be.
    const verdict = verifyCertificate(
      certificateCarrying(
        derWith(
          (_tbs, certificate) => certificate,
          (node) => encodeDerRaw(node, node.children[2] as DerNode),
        ),
      ),
      PINNED,
      FIXTURE_NOW + 1000,
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-profile-refused')
    if (verdict.failure.kind !== 'x509-profile-refused') return
    expect(verdict.failure.profile.kind).toBe('non-canonical-encoding')
  })
})

describe('X509-04 — a certificate past the byte ceiling is refused on the trust path, before any parsing', () => {
  it('refuses a certificate longer than MAX_CERTIFICATE_BYTES', () => {
    const padded = testHex(conformantDer()) + 'ff'.repeat(MAX_CERTIFICATE_BYTES)
    const failure = profileRefusalOf(padded)
    expect(failure.kind).toBe('certificate-too-large')
    if (failure.kind !== 'certificate-too-large') return
    expect(failure.limit).toBe(MAX_CERTIFICATE_BYTES)
    expect(failure.bytes).toBeGreaterThan(MAX_CERTIFICATE_BYTES)
  })
})

describe('X509-06 — extension count and size ceilings are refused on the trust path', () => {
  it('refuses more than MAX_EXTENSION_COUNT extensions, naming the count and the limit', () => {
    const failure = profileRefusalOf(
      derWith((tbs, certificate) => {
        const wrapper = tbs.children[TBS_EXTENSIONS] as DerNode
        const list = wrapper.children[0] as DerNode
        const grown = { ...list, children: [...list.children, ...fillerExtensions(MAX_EXTENSION_COUNT + 1 - list.children.length)] }
        return certificateWithTbsChild(certificate, TBS_EXTENSIONS, replacingChild(wrapper, 0, grown))
      }),
    )
    expect(failure.kind).toBe('too-many-extensions')
    if (failure.kind !== 'too-many-extensions') return
    expect(failure.count).toBe(MAX_EXTENSION_COUNT + 1)
    expect(failure.limit).toBe(MAX_EXTENSION_COUNT)
  })

  it('refuses an extension one byte past MAX_EXTENSION_BYTES, naming the OID and the limit', () => {
    const oversized = `${X509_EXTENSION_ARC}.99`
    const failure = profileRefusalOf(
      derWith((tbs, certificate) => {
        const wrapper = tbs.children[TBS_EXTENSIONS] as DerNode
        const list = wrapper.children[0] as DerNode
        const fat = extensionNode(oversized, new Uint8Array(MAX_EXTENSION_BYTES + 1).fill(0x2a))
        return certificateWithTbsChild(certificate, TBS_EXTENSIONS, replacingChild(wrapper, 0, { ...list, children: [...list.children, fat] }))
      }),
    )
    // The size gate, not the registry: an unrecognised OID would also refuse, and the
    // point of this case is that the size is checked *before* the payload is looked at.
    expect(failure.kind).toBe('extension-too-large')
    if (failure.kind !== 'extension-too-large') return
    expect(failure.oid).toBe(oversized)
    expect(failure.limit).toBe(MAX_EXTENSION_BYTES)
  })
})

describe('X509-07 — a duplicate extension is refused outright on the trust path', () => {
  it('refuses a second userKey extension rather than letting the last one win', () => {
    const failure = profileRefusalOf(
      derWith((tbs, certificate) => {
        const wrapper = tbs.children[TBS_EXTENSIONS] as DerNode
        const list = wrapper.children[0] as DerNode
        const duplicated = { ...list, children: [...list.children, list.children[0] as DerNode] }
        return certificateWithTbsChild(certificate, TBS_EXTENSIONS, replacingChild(wrapper, 0, duplicated))
      }),
    )
    expect(failure.kind).toBe('duplicate-extension')
    if (failure.kind !== 'duplicate-extension') return
    expect(failure.oid).toBe(EXT_USER_KEY)
  })
})

describe('a conformant X.509 form that describes a different node is refused', () => {
  it('refuses a subject commonName that is not the envelope\'s nodeKey', () => {
    const verdict = verifyCertificate(
      certificateCarrying(
        derWith((_tbs, certificate) => certificateWithTbsChild(certificate, TBS_SUBJECT, rdnName(testHex(ISSUER.pub)))),
      ),
      PINNED,
      FIXTURE_NOW + 1000,
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-mismatch')
    if (verdict.failure.kind !== 'x509-mismatch') return
    expect(verdict.failure.field).toBe('subject commonName')
  })

  it('refuses a serialNumber the envelope would not have produced, which no named field covers', () => {
    // The whole-TBSCertificate byte comparison, reached: every named field still agrees
    // and only the re-encoding disagrees. Without that catch-all this certificate would
    // pass, because `serialNumber` is not one of the fields compared by name.
    const verdict = verifyCertificate(
      certificateCarrying(derWith((_tbs, certificate) => certificateWithTbsChild(certificate, TBS_SERIAL, prim(0x02, [0x05])))),
      PINNED,
      FIXTURE_NOW + 1000,
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-mismatch')
    if (verdict.failure.kind !== 'x509-mismatch') return
    expect(verdict.failure.field).toBe('tbsCertificate bytes')
  })

  it('refuses an X.509 form the issuer did not sign, even when every field agrees', () => {
    const decoded = decodeDer(conformantDer())
    if (!decoded.ok) throw new Error('the conformant fixture did not decode')
    const signature = decoded.node.children[2] as DerNode
    const flipped = new Uint8Array(signature.content)
    flipped[10] = (flipped[10] as number) ^ 0xff
    const bytes = encodeDer(replacingChild(decoded.node, 2, { ...signature, content: flipped }))
    const verdict = verifyCertificate(certificateCarrying(testHex(bytes)), PINNED, FIXTURE_NOW + 1000)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-bad-signature')
  })
})
