import { describe as suite, expect, it } from 'vitest'
import { MIN_RELIABLE_SAMPLES, describe, percentile, summarise } from './stats.ts'

/** BENCH-03 — percentiles, never a bare mean. */

suite('percentiles are values that were actually observed', () => {
  it('takes the nearest rank rather than interpolating', () => {
    // An interpolated p99 is a number no run produced, which is a strange thing to
    // publish as the tail of a real system.
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 0.5)).toBe(5)
    expect(percentile(sorted, 0.95)).toBe(10)
    expect(percentile(sorted, 1)).toBe(10)
    expect(sorted).toContain(percentile(sorted, 0.9))
  })

  it('handles a single observation and an empty sample', () => {
    expect(percentile([42], 0.99)).toBe(42)
    expect(Number.isNaN(percentile([], 0.5))).toBe(true)
  })

  it('refuses a q outside (0, 1]', () => {
    expect(() => percentile([1], 0)).toThrow(RangeError)
    expect(() => percentile([1], 1.5)).toThrow(RangeError)
  })

  it('does not care what order the observations arrived in', () => {
    const shuffled = [9, 1, 7, 3, 5]
    expect(summarise(shuffled).p50).toBe(summarise([1, 3, 5, 7, 9]).p50)
  })
})

suite('a straggler tail is why the mean is not the headline', () => {
  it('separates the typical run from the unlucky one', () => {
    // Nineteen fast runs and one very slow one — the shape a makespan distribution
    // has by construction, since makespan is a maximum over shards.
    const observations = [...Array.from({ length: 19 }, () => 100), 5_000]
    const summary = summarise(observations)

    expect(summary.p50).toBe(100)
    expect(summary.p99).toBe(5_000)
    // The mean describes neither: 345ms is a run that never happened.
    expect(summary.meanForCostArithmeticOnly).toBeCloseTo(345, 0)
    expect(observations).not.toContain(Math.round(summary.meanForCostArithmeticOnly))
  })

  it('exposes the mean only under a name nobody puts in a headline', () => {
    const summary = summarise([1, 2, 3])
    // The guard is the name. A field called `mean` would end up in a chart title.
    expect(Object.keys(summary)).toContain('meanForCostArithmeticOnly')
    expect(Object.keys(summary)).not.toContain('mean')
    expect(Object.keys(summary)).not.toContain('average')
  })
})

suite('a small sample is labelled, not laundered', () => {
  it('marks tail percentiles unreliable below the threshold', () => {
    const few = summarise(Array.from({ length: MIN_RELIABLE_SAMPLES - 1 }, (_, i) => i + 1))
    expect(few.reliable).toBe(false)
    expect(describe(few)).toContain('unreliable')

    const enough = summarise(Array.from({ length: MIN_RELIABLE_SAMPLES }, (_, i) => i + 1))
    expect(enough.reliable).toBe(true)
    expect(describe(enough)).not.toContain('unreliable')
  })

  it('carries the caveat inside the string, so copy-paste cannot strip it', () => {
    // A caveat that lives only in surrounding prose gets separated from its number
    // the first time somebody quotes the number.
    const line = describe(summarise([10, 20, 30]))
    expect(line).toContain('n=3')
    expect(line).toContain('unreliable')
  })

  it('always states n, even when the sample is large', () => {
    expect(describe(summarise(Array.from({ length: 50 }, () => 5)))).toContain('n=50')
  })

  it('says so plainly when there is nothing to describe', () => {
    const empty = summarise([])
    expect(empty.n).toBe(0)
    expect(empty.reliable).toBe(false)
    expect(describe(empty)).toBe('no observations')
  })
})
