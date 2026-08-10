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
function buildCertificateFixture(overrides: FixtureOverrides = {}): Uint8Array {
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
  const tbsBytes = encodeDer(tbs)
  const signatureRaw = ed25519.sign(tbsBytes, ISSUER.priv)

  const certificate = cons(0x30, [
    tbs,
    overrides.outerAlgorithm ?? algId(ID_ED25519),
    overrides.signature ?? bitString(signatureRaw),
  ])

  return encodeDer(certificate)
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
