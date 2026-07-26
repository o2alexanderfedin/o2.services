import { describe, expect, it } from 'vitest'
import { coverageOf, describeCoverage, withCoverage } from './coverage.ts'

/** CHURN-05 — a partial number must never read as a complete one. */

describe('CHURN-05 — coverage is derived and travels with the value', () => {
  it('reports every expected owner as covered when all contribute', () => {
    const report = coverageOf(['alice', 'bob', 'carol'], ['bob', 'alice', 'carol'])
    expect(report).toEqual({
      covered: 3,
      total: 3,
      missing: [],
      unexpected: [],
      complete: true,
    })
    expect(describeCoverage(report)).toBe('covered: 3/3 owners — complete')
  })

  it('names the owners that are missing, in the form the criterion asks for', () => {
    const report = coverageOf(['alice', 'bob', 'carol'], ['alice'])
    expect(report.covered).toBe(1)
    expect(report.total).toBe(3)
    expect(report.missing).toEqual(['bob', 'carol'])
    expect(report.complete).toBe(false)
    expect(describeCoverage(report)).toContain('covered: 1/3 owners')
    expect(describeCoverage(report)).toContain('PARTIAL')
    expect(describeCoverage(report)).toContain('missing bob, carol')
  })

  it('reports a contributor nobody expected instead of quietly absorbing it', () => {
    // An unexpected contribution changes the aggregate without changing the count of
    // expected owners — an invisible difference, which is what this module is for.
    const report = coverageOf(['alice', 'bob'], ['alice', 'bob', 'mallory'])
    expect(report.covered).toBe(2)
    expect(report.total).toBe(2)
    expect(report.unexpected).toEqual(['mallory'])
    expect(report.complete).toBe(false)
    expect(describeCoverage(report)).toContain('unexpected mallory')
  })

  it('refuses to call an empty job complete', () => {
    // "0 of 0 owners" answers nothing. Reporting it complete would let an empty
    // owner set — a mis-scoped job — pass as a finished one.
    const report = coverageOf([], [])
    expect(report.complete).toBe(false)
    expect(describeCoverage(report)).toContain('no owners were expected')
  })

  it('counts owners once however many times they appear', () => {
    const report = coverageOf(['alice', 'alice', 'bob'], ['alice', 'alice'])
    expect(report.total).toBe(2)
    expect(report.covered).toBe(1)
    expect(report.missing).toEqual(['bob'])
  })

  it('pairs an aggregate with its coverage so neither can be read alone', () => {
    const aggregate = withCoverage({ sum: 42 }, ['alice', 'bob'], ['alice'])
    expect(aggregate.value).toEqual({ sum: 42 })
    expect(aggregate.coverage.complete).toBe(false)
    expect(aggregate.coverage.missing).toEqual(['bob'])
  })

  it('gives the same number two different coverages, which is the whole point', () => {
    // The failure this prevents needs no bug — only a missing sentence. Both of
    // these are correct answers to different questions.
    const whole = withCoverage({ sum: 100 }, ['alice', 'bob'], ['alice', 'bob'])
    const partial = withCoverage({ sum: 100 }, ['alice', 'bob'], ['alice'])

    expect(whole.value).toEqual(partial.value)
    expect(whole.coverage.complete).not.toBe(partial.coverage.complete)
    expect(describeCoverage(whole.coverage)).not.toBe(describeCoverage(partial.coverage))
  })
})
