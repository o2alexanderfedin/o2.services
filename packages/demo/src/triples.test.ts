import { describe, expect, it } from 'vitest'
import { assignmentOrder, enumerateTriples, valueDegrees } from './triples.ts'

/**
 * Every expectation below is a literal.
 *
 * Recomputing the expected triples with the same technique the implementation uses
 * would only prove the implementation agrees with itself — the one thing that is
 * true of a wrong implementation too. The lists here were written out from the
 * definition (3² + 4² = 5², 6² + 8² = 10², …) and can be checked by hand in the time
 * it takes to read them, which is exactly the property the verifier depends on.
 */

describe('enumerateTriples reproduces the triples of small ranges exactly', () => {
  it('finds nothing below the smallest triple', () => {
    // 3² + 4² = 25, so no hypotenuse fits under 5.
    expect(enumerateTriples(4)).toEqual([])
  })

  it('finds (3, 4, 5) and only that at n = 5', () => {
    expect(enumerateTriples(5)).toEqual([{ a: 3, b: 4, c: 5 }])
  })

  it('finds the three triples with hypotenuse at most 13', () => {
    expect(enumerateTriples(13)).toEqual([
      { a: 3, b: 4, c: 5 }, //  9 +  16 =  25
      { a: 6, b: 8, c: 10 }, // 36 +  64 = 100
      { a: 5, b: 12, c: 13 }, // 25 + 144 = 169
    ])
  })

  it('finds all eleven triples with hypotenuse at most 30', () => {
    expect(enumerateTriples(30)).toEqual([
      { a: 3, b: 4, c: 5 },
      { a: 6, b: 8, c: 10 },
      { a: 5, b: 12, c: 13 },
      { a: 9, b: 12, c: 15 },
      { a: 8, b: 15, c: 17 },
      { a: 12, b: 16, c: 20 },
      { a: 7, b: 24, c: 25 },
      { a: 15, b: 20, c: 25 },
      { a: 10, b: 24, c: 26 },
      { a: 20, b: 21, c: 29 },
      { a: 18, b: 24, c: 30 },
    ])
  })
})

describe('the ordering the guest kernel relies on', () => {
  /**
   * The kernel turns "the triples completed by assigning value v" into a contiguous
   * index range, which only works because equal hypotenuses are adjacent. If this
   * ordering ever changed, the guest would silently check the wrong triples.
   */
  it('groups equal hypotenuses together, ascending by c then a', () => {
    const triples = enumerateTriples(30)
    for (let i = 1; i < triples.length; i++) {
      const previous = triples[i - 1] as { a: number; c: number }
      const current = triples[i] as { a: number; c: number }
      expect(current.c > previous.c || (current.c === previous.c && current.a > previous.a)).toBe(
        true,
      )
    }
  })

  it('puts (7, 24, 25) before (15, 20, 25), the only tie under 30', () => {
    const twentyFives = enumerateTriples(30).filter((t) => t.c === 25)
    expect(twentyFives).toEqual([
      { a: 7, b: 24, c: 25 },
      { a: 15, b: 20, c: 25 },
    ])
  })
})

describe('the hypotenuse bound is inclusive and hard', () => {
  it('includes both triples whose hypotenuse is exactly 100', () => {
    // 60² + 80² = 3600 + 6400 = 10000 = 100²
    // 28² + 96² =  784 + 9216 = 10000 = 100²
    const hundreds = enumerateTriples(100).filter((t) => t.c === 100)
    expect(hundreds).toEqual([
      { a: 28, b: 96, c: 100 },
      { a: 60, b: 80, c: 100 },
    ])
  })

  it('excludes (20, 99, 101), whose hypotenuse is one past the bound', () => {
    // 20² + 99² = 400 + 9801 = 10201 = 101² — a genuine triple, just out of range.
    expect(enumerateTriples(100).some((t) => t.a === 20 && t.b === 99)).toBe(false)
    expect(enumerateTriples(101)).toContainEqual({ a: 20, b: 99, c: 101 })
  })

  it('includes the primitive (65, 72, 97)', () => {
    // 65² + 72² = 4225 + 5184 = 9409 = 97²
    expect(enumerateTriples(97)).toContainEqual({ a: 65, b: 72, c: 97 })
  })
})

describe('every emitted triple satisfies the definition', () => {
  /**
   * A property check rather than a fixture: it cannot prove completeness — the
   * literals above do that — but it does prove that nothing spurious slips in, which
   * is the failure a float comparison in the acceptance path would produce.
   */
  it('holds a < b < c ≤ n and a² + b² = c² for n = 500', () => {
    for (const { a, b, c } of enumerateTriples(500)) {
      expect(a).toBeLessThan(b)
      expect(b).toBeLessThan(c)
      expect(c).toBeLessThanOrEqual(500)
      expect(a * a + b * b).toBe(c * c)
    }
  })

  it('emits no duplicates', () => {
    const triples = enumerateTriples(500)
    const keys = new Set(triples.map((t) => `${t.a},${t.b},${t.c}`))
    expect(keys.size).toBe(triples.length)
  })
})

describe('degenerate bounds are answered, not thrown', () => {
  it.each([0, 1, 4, -7, 2.5, Number.NaN])('returns an empty list for n = %p', (n) => {
    expect(enumerateTriples(n)).toEqual([])
  })
})

describe('valueDegrees counts how constrained each value is', () => {
  /**
   * Counted by hand from the eleven triples of n = 30 listed above. 12 appears in
   * (5,12,13), (9,12,15) and (12,16,20); 5 appears in (3,4,5) and (5,12,13); 11
   * appears in none, because no Pythagorean triple contains it.
   */
  it('reproduces every nonzero degree at n = 30', () => {
    const degrees = valueDegrees(30)
    const nonzero = degrees
      .map((count, value) => (count === 0 ? null : `${value}:${count}`))
      .filter((entry) => entry !== null)
    expect(nonzero).toEqual([
      '3:1', '4:1', '5:2', '6:1', '7:1', '8:2', '9:1', '10:2',
      '12:3', '13:1', '15:3', '16:1', '17:1', '18:1',
      '20:3', '21:1', '24:3', '25:2', '26:1', '29:1', '30:1',
    ])
  })

  it('gives 1 and 2 degree zero — no triple can contain them', () => {
    // The smallest leg of any triple is 3, so 1 and 2 are unconstrained at every n.
    const degrees = valueDegrees(1000)
    expect(degrees[1]).toBe(0)
    expect(degrees[2]).toBe(0)
  })

  it('accounts for exactly three slots per triple', () => {
    const total = valueDegrees(500).reduce((sum, count) => sum + count, 0)
    expect(total).toBe(enumerateTriples(500).length * 3)
  })
})

describe('assignmentOrder puts the most constrained values first', () => {
  /**
   * Written out from the degrees above, most-constrained first with ties by value
   * ascending:
   *
   *   degree 3   12, 15, 20, 24
   *   degree 2   5, 8, 10, 25
   *   degree 1   3, 4, 6, 7, 9, 13, 16, 17, 18, 21, 26, 29, 30
   *   degree 0   1, 2, 11, 14, 19, 22, 23, 27, 28
   *
   * This is the order the guest searches in and the order the cube decomposition
   * slices, so it is worth being able to check it by eye.
   */
  /**
   * Shards that disagreed about the order would not be solving the same problem, and
   * their outputs would be reported as node disagreement rather than as the input bug
   * it would be. This literal is what carries that claim across runtimes: the file has
   * a bare `.test.ts` suffix, so `vitest.config.ts` runs it in the `node` project and
   * in Chromium, Firefox and WebKit, and these numbers are asserted in all four.
   *
   * Three engines on one host are three independent implementations, not three
   * machines — the config's own comment forbids the stronger reading and so does this
   * one.
   */
  it('reproduces the whole order at n = 30', () => {
    expect(assignmentOrder(30)).toEqual([
      12, 15, 20, 24,
      5, 8, 10, 25,
      3, 4, 6, 7, 9, 13, 16, 17, 18, 21, 26, 29, 30,
      1, 2, 11, 14, 19, 22, 23, 27, 28,
    ])
  })

  it('leads with 60 and 120 at n = 300, the two busiest values there', () => {
    // 120 sits in thirteen triples and 60 in eleven — by a wide margin the two values
    // whose colour most constrains everything else, so they are decided first.
    const order = assignmentOrder(300)
    expect(order.slice(0, 3)).toEqual([120, 60, 48])
    const degrees = valueDegrees(300)
    expect([degrees[120], degrees[60], degrees[48]]).toEqual([13, 11, 9])
  })

  it('is a permutation of 1..n, so every value is assigned exactly once', () => {
    // A search that skipped a value would report a colouring with a hole in it, and
    // the verifier would read that hole as colour 0 and reject — noisily, but only
    // after the fabric had spent the work.
    for (const n of [1, 5, 30, 204, 300]) {
      const order = assignmentOrder(n)
      expect(order.length).toBe(n)
      expect([...order].sort((x, y) => x - y)).toEqual(
        Array.from({ length: n }, (_, i) => i + 1),
      )
    }
  })

  it('never puts a less constrained value ahead of a more constrained one', () => {
    const degrees = valueDegrees(300)
    const order = assignmentOrder(300)
    for (let i = 1; i < order.length; i++) {
      const previous = order[i - 1] as number
      const current = order[i] as number
      const dropped = (degrees[previous] as number) - (degrees[current] as number)
      // Either strictly more constrained, or equally constrained and lower-valued.
      expect(dropped > 0 || (dropped === 0 && previous < current)).toBe(true)
    }
  })

  it('answers an n that is not a positive integer with an empty order', () => {
    expect(assignmentOrder(0)).toEqual([])
    expect(assignmentOrder(2.5)).toEqual([])
  })
})
