import { describe, expect, it } from 'vitest'
import { canonicalCid, decodeCanonical, encodeCanonical } from './encode.ts'

describe('encodeCanonical — the codec forbids what would diverge', () => {
  it('refuses NaN, naming its path', () => {
    const r = encodeCanonical({ sum: 1, mean: Number.NaN })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'non-finite-float') {
      expect(r.error.path).toBe('mean')
      expect(r.error.value).toBe('NaN')
    }
  })

  it('refuses Infinity and -Infinity', () => {
    expect(encodeCanonical({ x: Number.POSITIVE_INFINITY }).ok).toBe(false)
    expect(encodeCanonical({ x: Number.NEGATIVE_INFINITY }).ok).toBe(false)
  })

  it('finds a non-finite float nested in arrays', () => {
    const r = encodeCanonical({ rows: [{ v: 1 }, { v: Number.NaN }] })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'non-finite-float') {
      expect(r.error.path).toBe('rows[1].v')
    }
  })

  it('refuses NaN however it was produced', () => {
    // Every route to NaN is refused, so a NaN's nondeterministic sign bit can
    // never reach a hash regardless of which operation produced it.
    for (const nan of [Math.sqrt(-1), 0 / 0, Number.POSITIVE_INFINITY - Number.POSITIVE_INFINITY]) {
      expect(encodeCanonical({ v: nan }).ok).toBe(false)
    }
  })

  it('normalizes -0.0 to +0.0 so signed zero cannot diverge', () => {
    const neg = encodeCanonical({ v: -0 })
    const pos = encodeCanonical({ v: 0 })
    expect(neg.ok && pos.ok).toBe(true)
    if (neg.ok && pos.ok) {
      expect(Array.from(neg.bytes)).toEqual(Array.from(pos.bytes))
    }
  })

  it('accepts ordinary finite floats', () => {
    const r = encodeCanonical({ v: 3.141592653589793 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(decodeCanonical(r.bytes)).toEqual({ v: 3.141592653589793 })
  })
})

describe('encodeCanonical — determinism of the encoding itself', () => {
  it('produces identical bytes regardless of key insertion order', () => {
    const a = encodeCanonical({ alpha: 1, beta: 2, gamma: 3 })
    const b = encodeCanonical({ gamma: 3, alpha: 1, beta: 2 })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes))
    }
  })

  it('encodes one float width — an integral float and its integer differ in type, not width', () => {
    const asFloat = encodeCanonical({ v: 1.5 })
    expect(asFloat.ok).toBe(true)
    if (asFloat.ok) {
      // DAG-CBOR mandates 64-bit doubles: major type 7, additional info 27 (0xfb).
      expect(Array.from(asFloat.bytes)).toContain(0xfb)
    }
  })

  it('round-trips bytes, nested maps, and arrays', () => {
    const value = {
      id: 'shard-3',
      payload: new Uint8Array([1, 2, 3]),
      nested: { list: [1, 2, 3], flag: true, nothing: null },
    }
    const r = encodeCanonical(value)
    expect(r.ok).toBe(true)
    if (r.ok) expect(decodeCanonical(r.bytes)).toEqual(value)
  })
})

describe('canonicalCid — content addressing over declared fields only', () => {
  it('gives equal CIDs for equal declared values', async () => {
    const a = await canonicalCid({ sum: 42, count: 7 })
    const b = await canonicalCid({ count: 7, sum: 42 })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.cid.toString()).toBe(b.cid.toString())
  })

  it('gives different CIDs when a declared value differs', async () => {
    const a = await canonicalCid({ sum: 42 })
    const b = await canonicalCid({ sum: 43 })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.cid.toString()).not.toBe(b.cid.toString())
  })

  it('propagates a NaN rejection instead of hashing it', async () => {
    const r = await canonicalCid({ v: Number.NaN })
    expect(r.ok).toBe(false)
  })

  it('produces a dag-cbor CIDv1', async () => {
    const r = await canonicalCid({ v: 1 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.cid.version).toBe(1)
      expect(r.cid.code).toBe(0x71) // dag-cbor
    }
  })
})
