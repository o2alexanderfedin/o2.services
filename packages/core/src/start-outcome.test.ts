import { describe, expect, it } from 'vitest'
import {
  BROWSER_FAMILIES,
  MIN_REPORTS_FOR_RATE,
  START_FAILURES,
  STRUCTURAL_BLIND_SPOT,
  StartOutcomeLedger,
  describeStartReport,
  isStartBrowserLabel,
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

  it('round-trips counts through a merge without loss', () => {
    const ledger = new StartOutcomeLedger()
    ledger.record({ browser: 'safari 18', result: { kind: 'failed', cause: 'storage-denied' } })
    ledger.record({ browser: 'chromium 141', result: { kind: 'started' } })
    const rebuilt = new StartOutcomeLedger()
    rebuilt.mergeDisjoint(ledger.counts())
    expect(rebuilt.counts()).toEqual(ledger.counts())
  })
})

/**
 * A count is believed. It is not *materialised*.
 *
 * `count` arrives over the wire and nothing bounds its magnitude — `mergeOverlapping`
 * checks only that it is a positive integer, and takes the largest. Reporting used to
 * expand each unit into its own object, so a 79-byte reply carrying `count: 1e9`
 * became an allocation the reading tab could not survive. `MAX_INBOUND_MESSAGE_BYTES`
 * cannot help: the amplification is entirely post-decode.
 *
 * ## Why these are not budgets
 *
 * They used to be: `elapsed < 50ms`, twice, with neither population written down.
 * The measurement that retired them, taken 2026-08-01 — 24 samples per case across
 * chromium, firefox and webkit (1-min load 39.2→31.1 on 8 cores) and 12 more per
 * case in Node (load 24.2→21.2):
 *
 *   browser   every one of the 48 readings was **0** — `performance.now()` is
 *             coarsened to ~1 ms in firefox and webkit, and this is two additions
 *   node      0.006–0.032 ms
 *
 * So in two of the three engines the fast path sits *below the resolution of the
 * clock the assertion used*. There was never a second population to site 50 against:
 * one end is indistinguishable from zero, and the other end — a `report()` that
 * expands a count into that many objects — does not produce a slow reading, it
 * produces a process that never comes back. Nothing can be sited between "0" and
 * "never", so 50 was separating noise from noise.
 *
 * What replaces it is the arithmetic itself. Every magnitude below is chosen so that
 * *enumerating* it is impossible rather than merely slow — at a billion steps a
 * second, one row of `1e15` is eleven days — while *adding* it is one instruction and
 * exact, because the totals stay under `Number.MAX_SAFE_INTEGER`. An implementation
 * that materialises cannot reach these assertions at all; one that adds reaches them
 * immediately, on any engine at any load. That is a claim about which operation ran,
 * and it has no clock in it.
 */
describe('a reported count costs what it says, not what it claims', () => {
  it('sums counts no host could enumerate, because it adds them instead', () => {
    const ledger = new StartOutcomeLedger()
    ledger.mergeDisjoint([
      { browser: 'chromium 141', result: 'started', count: 1e15 },
      { browser: 'safari 18', result: 'wasm-unavailable', count: 1e15 },
    ])

    const report = ledger.report()

    // Exact, and the exactness is the evidence: 2e15 is under `MAX_SAFE_INTEGER`, so
    // a sum is precise — while no loop over 2e15 units returns inside this suite, or
    // inside this week.
    expect(report.reported).toBe(2e15)
    expect(report.failed).toBe(1e15)
    // And it reached those totals from two rows. One entry per (browser, result) is
    // what makes the magnitude free.
    expect(ledger.counts()).toHaveLength(2)
  })

  it('costs nothing to be told the largest magnitude the wire can carry', () => {
    const ledger = new StartOutcomeLedger()
    // The biggest integer a JSON number survives as itself. A peer cannot claim more
    // without the claim decoding to something else, so this is the top of the hostile
    // range rather than a sample from the middle of it.
    ledger.mergeOverlapping([
      { browser: 'chromium 141', result: 'started', count: Number.MAX_SAFE_INTEGER },
    ])

    const report = ledger.report()

    // The count is BELIEVED. Inflation is this module's stated, accepted property —
    // a peer can lie about its own numbers and that is what the docstring says. What
    // is fixed here is only that the lie is free to hold, not free to make.
    expect(report.reported).toBe(Number.MAX_SAFE_INTEGER)
    expect(ledger.counts()).toHaveLength(1)
  })

  it('agrees with the outcome-by-outcome path, orderings and reliability included', () => {
    const population: StartOutcome[] = [
      ...started('chromium 141', 12),
      ...failed('chromium 141', 'other', 3),
      ...failed('chromium 141', 'storage-denied', 3),
      ...failed('chromium 141', 'wasm-unavailable', 7),
      ...started('safari 18', 4),
      ...failed('safari 18', 'wasm-unavailable', 5),
      ...started('firefox 145', 9),
    ]
    const ledger = new StartOutcomeLedger()
    for (const outcome of population) ledger.record(outcome)

    // Pins the fold whole — the browser and cause orderings, the MIN_REPORTS_FOR_RATE
    // flags and the rate arithmetic — rather than re-asserting each of them and
    // missing the one that drifted.
    expect(ledger.report()).toEqual(startReport(population))
  })
})

describe('the coarseness the disclosure promise rests on is a check, not a convention', () => {
  it('accepts a family, with or without a major version', () => {
    for (const family of BROWSER_FAMILIES) {
      expect(isStartBrowserLabel(family)).toBe(true)
      expect(isStartBrowserLabel(`${family} 141`)).toBe(true)
    }
  })

  it('refuses anything finer than a family and a major', () => {
    // Each of these is a label a peer could send. The first is the whole reason
    // this predicate exists; the rest are the near misses that would slip past a
    // check written as "starts with a known family".
    expect(isStartBrowserLabel('Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0')).toBe(false)
    expect(isStartBrowserLabel('chromium 141 (X11; Linux x86_64)')).toBe(false)
    expect(isStartBrowserLabel('chromium 141.0.7390.65')).toBe(false)
    expect(isStartBrowserLabel('chromium 12345')).toBe(false)
    expect(isStartBrowserLabel('Chromium 141')).toBe(false)
    expect(isStartBrowserLabel('')).toBe(false)
    expect(isStartBrowserLabel('x'.repeat(200))).toBe(false)
    expect(isStartBrowserLabel(141)).toBe(false)
  })
})
