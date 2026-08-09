import { describe, expect, it } from 'vitest'
import { ALLOWED_TAGS, MAX_CERTIFICATE_BYTES, checkDerCanonical, decodeDer, preParseCheck } from './x509.ts'

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
  it('refuses a tag byte outside this profile\'s 12 allowed tags', () => {
    // 0x05 is ASN.1 NULL -- not in ALLOWED_TAGS. A generic parser would decode it as
    // a zero-length value; this decoder must refuse it by name instead.
    expect(ALLOWED_TAGS.has(0x05)).toBe(false)
    const bytes = tlv(0x05, [])
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
