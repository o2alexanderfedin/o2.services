import { describe, expect, it } from 'vitest'
import {
  MIN_REPORTS_FOR_RATE,
  START_FAILURES,
  STRUCTURAL_BLIND_SPOT,
  StartOutcomeLedger,
  describeStartReport,
  expandCounts,
  startReport,
} from './start-outcome.ts'
import type { StartFailure, StartOutcome } from './start-outcome.ts'

/** BROW-02 — blocking is visible as a metric rather than as absent capacity. */

const started = (browser: string, n: number): StartOutcome[] =>
  Array.from({ length: n }, () => ({ browser, result: { kind: 'started' as const } }))

const failed = (browser: string, cause: StartFailure, n: number): StartOutcome[] =>
  Array.from({ length: n }, () => ({ browser, result: { kind: 'failed' as const, cause } }))

describe('the report is segmented, so a cliff has somewhere to appear', () => {
  it('computes a failure rate per browser rather than one overall number', () => {
    // The whole point of the requirement: one aggregate rate would average a
    // browser that blocks everything into three that block nothing.
    const report = startReport([
      ...started('chromium 141', 90),
      ...failed('chromium 141', 'other', 10),
      ...failed('safari 18', 'wasm-unavailable', 20),
    ])

    const chromium = report.byBrowser.find((b) => b.browser === 'chromium 141')
    const safari = report.byBrowser.find((b) => b.browser === 'safari 18')
    expect(chromium?.failureRate).toBeCloseTo(0.1, 5)
    expect(safari?.failureRate).toBe(1)
    expect(safari?.causes).toEqual([{ cause: 'wasm-unavailable', count: 20 }])
  })

  it('orders browsers deterministically, not by arrival', () => {
    const forwards = startReport([...started('a', 3), ...started('b', 3), ...started('c', 9)])
    const backwards = startReport([...started('c', 9), ...started('b', 3), ...started('a', 3)])
    expect(forwards.byBrowser.map((b) => b.browser)).toEqual(['c', 'a', 'b'])
    expect(backwards.byBrowser.map((b) => b.browser)).toEqual(forwards.byBrowser.map((b) => b.browser))
  })

  it('names a cause rather than counting a boolean', () => {
    // A blocklist and a broken relay want opposite responses, and a bare failure
    // count cannot tell them apart.
    const report = startReport([
      ...failed('firefox 134', 'no-relay-reachable', 5),
      ...failed('firefox 134', 'storage-denied', 2),
    ])
    expect(report.byBrowser[0]?.causes).toEqual([
      { cause: 'no-relay-reachable', count: 5 },
      { cause: 'storage-denied', count: 2 },
    ])
  })

  it('has a cause for every failure the enumeration allows', () => {
    // Guards against a cause being added to the type and never counted.
    const outcomes = START_FAILURES.flatMap((cause) => failed('chromium 141', cause, 1))
    const report = startReport(outcomes)
    expect(report.byBrowser[0]?.causes.map((c) => c.cause).sort()).toEqual([...START_FAILURES].sort())
  })
})

describe('a small sample is labelled, never suppressed', () => {
  it('marks a rate unreliable below the threshold but still publishes it', () => {
    // Hiding it would lose the early signal a cliff arrives as.
    const few = startReport(failed('safari 18', 'wasm-unavailable', MIN_REPORTS_FOR_RATE - 1))
    expect(few.byBrowser[0]?.reliable).toBe(false)
    expect(few.byBrowser[0]?.failureRate).toBe(1)
    expect(describeStartReport(few)).toContain('unreliable')

    const enough = startReport(failed('safari 18', 'wasm-unavailable', MIN_REPORTS_FOR_RATE))
    expect(enough.byBrowser[0]?.reliable).toBe(true)
    expect(describeStartReport(enough)).not.toContain('unreliable')
  })
})

describe('the report states what it cannot see', () => {
  it('always carries the structural blind spot, even with no data at all', () => {
    // A node that could not reach a peer could not report that it could not reach
    // a peer. There is no deployment in which this stops being true, so there is
    // no report in which it may be absent.
    expect(startReport([]).blindSpots).toContainEqual(STRUCTURAL_BLIND_SPOT)
    expect(startReport(started('chromium 141', 50)).blindSpots).toContainEqual(STRUCTURAL_BLIND_SPOT)
  })

  it('counts visitors who declined to be counted', () => {
    const report = startReport(started('chromium 141', 10), { declined: 4 })
    const declined = report.blindSpots.find((spot) => spot.kind === 'declined')
    expect(declined).toBeDefined()
    if (declined === undefined || declined.kind !== 'declined') return
    expect(declined.count).toBe(4)
  })

  it('omits the declined line when nobody declined, rather than printing a zero', () => {
    expect(startReport(started('chromium 141', 10)).blindSpots).toHaveLength(1)
  })

  it('renders the blind spots inside the same string as the numbers', () => {
    // A caveat kept in surrounding prose gets separated from its number the first
    // time somebody quotes the number.
    const text = describeStartReport(
      startReport([...started('chromium 141', 90), ...failed('safari 18', 'wasm-unavailable', 10)], {
        declined: 3,
      }),
    )
    expect(text).toContain('not counted')
    expect(text).toContain('could not reach a peer')
    expect(text).toContain('not counted: 3')
    // And the numbers are there too — a report of only caveats is no use either.
    expect(text).toContain('safari 18')
    expect(text).toContain('100.0%')
  })

  it('says so plainly when nothing has been reported', () => {
    const text = describeStartReport(startReport([]))
    expect(text).toContain('no start outcomes reported')
    expect(text).toContain('could not reach a peer')
  })
})

describe('a ledger merges two different kinds of thing, and knows which', () => {
  it('sums reports that are genuinely distinct', () => {
    // A node ingesting one visitor's report at a time: two visitors are two
    // visitors.
    const ledger = new StartOutcomeLedger()
    ledger.record({ browser: 'chromium 141', result: { kind: 'started' } })
    ledger.record({ browser: 'chromium 141', result: { kind: 'started' } })
    ledger.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: 3 }])
    expect(ledger.report().reported).toBe(5)
  })

  it('takes the larger of two overlapping views instead of adding them', () => {
    // The trap this exists for: ask eight peers and every one answers about the
    // same population. Summing would multiply the sample size by eight while
    // leaving every percentage unchanged — a correct-looking rate over a
    // fictional n.
    const ledger = new StartOutcomeLedger()
    ledger.record({ browser: 'safari 18', result: { kind: 'failed', cause: 'wasm-unavailable' } })
    for (let peer = 0; peer < 8; peer++) {
      ledger.mergeOverlapping([{ browser: 'safari 18', result: 'wasm-unavailable', count: 40 }])
    }
    expect(ledger.report().reported).toBe(40)
  })

  it('never lets an overlapping view shrink what is already known', () => {
    const ledger = new StartOutcomeLedger()
    ledger.mergeDisjoint([{ browser: 'firefox 134', result: 'started', count: 50 }])
    ledger.mergeOverlapping([{ browser: 'firefox 134', result: 'started', count: 2 }])
    expect(ledger.report().reported).toBe(50)
  })

  it('refuses counts that would erase evidence', () => {
    // Wire input. A negative count would let one peer subtract another's reports.
    const ledger = new StartOutcomeLedger()
    ledger.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: 10 }])
    ledger.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: -8 }])
    ledger.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: 1.5 }])
    expect(ledger.report().reported).toBe(10)
  })

  it('keeps the browser and the result apart, whatever the label contains', () => {
    // The first version keyed on `${browser} ${result}` and split on the first
    // space, filing "chromium 141 started" as the browser "chromium" with the
    // result "141 started". A label with a space in it is the normal case.
    const ledger = new StartOutcomeLedger()
    ledger.record({ browser: 'chromium 141', result: { kind: 'started' } })
    expect(ledger.counts()).toEqual([{ browser: 'chromium 141', result: 'started', count: 1 }])
  })

  it('carries declines through to the blind spots', () => {
    const ledger = new StartOutcomeLedger()
    ledger.decline(3)
    ledger.record({ browser: 'chromium 141', result: { kind: 'started' } })
    const declined = ledger.report().blindSpots.find((spot) => spot.kind === 'declined')
    expect(declined?.kind === 'declined' && declined.count).toBe(3)
  })

  it('round-trips counts through expansion without loss', () => {
    const ledger = new StartOutcomeLedger()
    ledger.record({ browser: 'safari 18', result: { kind: 'failed', cause: 'storage-denied' } })
    ledger.record({ browser: 'chromium 141', result: { kind: 'started' } })
    const rebuilt = new StartOutcomeLedger()
    for (const outcome of expandCounts(ledger.counts())) rebuilt.record(outcome)
    expect(rebuilt.counts()).toEqual(ledger.counts())
  })
})
