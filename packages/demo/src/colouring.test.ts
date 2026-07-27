import { describe, expect, it } from 'vitest'
import { colourOf, verifyColouring } from './colouring.ts'
import { COLOURING_BYTES } from './job.ts'

/**
 * Pack a colouring given as "these values are colour 1, everything else is 0".
 *
 * The fixtures below are written as value lists rather than as byte literals because
 * a reader has to be able to check them against the triples by hand. That is the
 * whole premise of the verifier, and it applies to its tests too.
 */
function pack(ones: readonly number[], byteLength: number = COLOURING_BYTES): Uint8Array {
  const bits = new Uint8Array(byteLength)
  for (const value of ones) {
    const index = value - 1
    bits[index >> 3] = (bits[index >> 3] as number) | (1 << (index & 7))
  }
  return bits
}

/**
 * A valid 2-colouring of {1..30}: exactly these values take colour 1.
 *
 * Checked against all eleven triples with c ≤ 30:
 *   (3,4,5)→001  (6,8,10)→001  (5,12,13)→100  (9,12,15)→001  (8,15,17)→010
 *   (12,16,20)→001  (7,24,25)→010  (15,20,25)→110  (10,24,26)→110
 *   (20,21,29)→100  (18,24,30)→010
 * None is monochromatic.
 */
const GOOD_30: readonly number[] = [5, 10, 15, 20, 24]

describe('colourOf reads the 1-based, little-endian-within-a-byte packing', () => {
  it('decodes a hand-written byte one value at a time', () => {
    // 0b1011_0101 — bit 0 is value 1, bit 7 is value 8.
    const bits = new Uint8Array([0b1011_0101])
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((v) => colourOf(bits, v))).toEqual([1, 0, 1, 0, 1, 1, 0, 1])
  })

  it('crosses a byte boundary at value 9', () => {
    // Value 8 is the top bit of byte 0; value 9 is the bottom bit of byte 1.
    const bits = new Uint8Array([0b1000_0000, 0b0000_0001])
    expect(colourOf(bits, 8)).toBe(1)
    expect(colourOf(bits, 9)).toBe(1)
    expect(colourOf(bits, 10)).toBe(0)
  })

  it('reads colour 0 past the end of the array rather than throwing', () => {
    // A short array must not be able to crash the verifier — it should simply fail
    // to satisfy the triples, which is what an all-zero colouring does.
    expect(colourOf(new Uint8Array([0xff]), 900)).toBe(0)
    expect(colourOf(new Uint8Array([0xff]), 0)).toBe(0)
  })
})

describe('verifyColouring accepts a colouring that satisfies the definition', () => {
  it('accepts the one-triple case, n = 5', () => {
    // Only (3, 4, 5) exists here; colouring 5 differently from 3 and 4 settles it.
    const verdict = verifyColouring(5, pack([5]))
    expect(verdict).toEqual({ ok: true, n: 5, triplesChecked: 1 })
  })

  it('accepts a hand-checked colouring of {1..30} and reports the work done', () => {
    const verdict = verifyColouring(30, pack(GOOD_30))
    expect(verdict.ok).toBe(true)
    // The count is the eleven triples enumerated in triples.test.ts — the verifier
    // reporting how much it actually checked is what makes "ok" mean something.
    if (verdict.ok) expect(verdict.triplesChecked).toBe(11)
  })

  it('accepts trivially when the range holds no triple at all', () => {
    expect(verifyColouring(4, pack([]))).toEqual({ ok: true, n: 4, triplesChecked: 0 })
  })
})

describe('verifyColouring rejects a planted violation and names it', () => {
  /**
   * A checker nobody has watched fail is not known to check anything. So: take the
   * colouring the previous block accepts, flip exactly one bit, and require both a
   * rejection and the right witness.
   *
   * Value 5 is chosen because 3 and 4 are already colour 0 in `GOOD_30`, so clearing
   * bit 5 turns (3, 4, 5) monochromatic — and (3, 4, 5) has the smallest hypotenuse
   * of any triple, so it is the one the verifier must report first.
   */
  it('rejects the good colouring of {1..30} with value 5 flipped', () => {
    const planted = pack(GOOD_30.filter((v) => v !== 5))
    const verdict = verifyColouring(30, planted)
    expect(verdict).toEqual({ ok: false, n: 30, violation: { a: 3, b: 4, c: 5 } })
  })

  it('rejects the same colouring with value 24 flipped, naming (7, 24, 25)', () => {
    // 7 and 25 are colour 0 in `GOOD_30`, so clearing 24 makes (7, 24, 25) all zero.
    // It is the first triple containing 24 in hypotenuse order — ahead of (10,24,26)
    // and (18,24,30), which the same flip also breaks — so it is the one reported.
    const planted = pack(GOOD_30.filter((v) => v !== 24))
    const verdict = verifyColouring(30, planted)
    expect(verdict).toEqual({ ok: false, n: 30, violation: { a: 7, b: 24, c: 25 } })
  })

  it('rejects the all-one-colour colouring at the very first triple', () => {
    expect(verifyColouring(30, pack([]))).toEqual({
      ok: false,
      n: 30,
      violation: { a: 3, b: 4, c: 5 },
    })
  })

  it('rejects a colouring that is valid up to 30 but not up to 100', () => {
    // The point of re-deriving the triples from `n`: the same bits are a correct
    // answer to one question and a wrong answer to a larger one. A verifier handed a
    // triple list could be told the smaller question and would never notice.
    expect(verifyColouring(30, pack(GOOD_30)).ok).toBe(true)
    expect(verifyColouring(100, pack(GOOD_30)).ok).toBe(false)
  })
})

describe('the verifier depends on nothing but n and the bits', () => {
  it('takes no triple list, so a claimed answer cannot also supply the question', () => {
    // Expressed as an arity check because it is a design property, not an
    // implementation detail: the moment a third parameter appears, a node could hand
    // back an answer together with the subset of the definition it happens to
    // satisfy, and the check would pass while meaning nothing.
    expect(verifyColouring.length).toBe(2)
  })
})
