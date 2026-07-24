import { describe, expect, it } from 'vitest'
import { Reader } from './reader.ts'

describe('Reader — bounds safety (threat T-1-01)', () => {
  it('returns out-of-bounds rather than throwing when reading past the end', () => {
    const r = new Reader(new Uint8Array([1]))
    expect(r.u8()).toEqual({ ok: true, value: 1 })
    const past = r.u8()
    expect(past.ok).toBe(false)
    if (!past.ok) {
      expect(past.error.kind).toBe('out-of-bounds')
    }
  })

  it('refuses a take() longer than the remaining buffer', () => {
    const r = new Reader(new Uint8Array([1, 2, 3]))
    const t = r.take(9)
    expect(t.ok).toBe(false)
    // The cursor must not advance on a failed read.
    expect(r.offset).toBe(0)
  })

  it('refuses a negative take()', () => {
    const r = new Reader(new Uint8Array([1, 2, 3]))
    expect(r.take(-1).ok).toBe(false)
  })

  it('reports the section length a malformed module claims, without reading it', () => {
    // A section header claiming 0xFFFFFFF bytes of payload in a 4-byte buffer.
    const r = new Reader(new Uint8Array([0xff, 0xff, 0xff, 0x7f]))
    const claimed = r.u32()
    expect(claimed.ok).toBe(true)
    if (claimed.ok) {
      const body = r.take(claimed.value)
      expect(body.ok).toBe(false)
      if (!body.ok && body.error.kind === 'out-of-bounds') {
        expect(body.error.needed).toBe(claimed.value)
        expect(body.error.length).toBe(4)
      }
    }
  })
})

describe('Reader — LEB128', () => {
  it('decodes single-byte values', () => {
    expect(new Reader(new Uint8Array([0x00])).u32()).toEqual({ ok: true, value: 0 })
    expect(new Reader(new Uint8Array([0x7f])).u32()).toEqual({ ok: true, value: 127 })
  })

  it('decodes multi-byte values', () => {
    // 624485 = 0xE5 0x8E 0x26
    expect(new Reader(new Uint8Array([0xe5, 0x8e, 0x26])).u32()).toEqual({
      ok: true,
      value: 624485,
    })
  })

  it('accepts non-minimal encodings (threat T-1-03)', () => {
    // 1 encoded in five bytes rather than one. The spec calls this invalid, but the
    // gate must decode it anyway — otherwise a forbidden opcode index hidden behind
    // an overlong encoding would be misread and slip past.
    const overlong = new Uint8Array([0x81, 0x80, 0x80, 0x80, 0x00])
    expect(new Reader(overlong).u32()).toEqual({ ok: true, value: 1 })
  })

  it('rejects an unterminated LEB128 run', () => {
    const unterminated = new Uint8Array(Array(16).fill(0x80))
    const got = new Reader(unterminated).u32()
    expect(got.ok).toBe(false)
  })

  it('decodes negative signed values', () => {
    // -1 is 0x7F in signed LEB128.
    expect(new Reader(new Uint8Array([0x7f])).i33()).toEqual({ ok: true, value: -1 })
    // -123456 = 0xC0 0xBB 0x78
    expect(new Reader(new Uint8Array([0xc0, 0xbb, 0x78])).i33()).toEqual({
      ok: true,
      value: -123456,
    })
  })

  it('decodes a length-prefixed name', () => {
    const bytes = new Uint8Array([3, 0x65, 0x6e, 0x76]) // "env"
    expect(new Reader(bytes).name()).toEqual({ ok: true, value: 'env' })
  })

  it('refuses a name whose declared length exceeds the buffer', () => {
    const bytes = new Uint8Array([200, 0x65])
    expect(new Reader(bytes).name().ok).toBe(false)
  })
})
