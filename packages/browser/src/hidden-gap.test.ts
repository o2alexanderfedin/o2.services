import { describe, expect, it } from 'vitest'
import { DIGIT } from './demo-regions.ts'
import { HIDDEN_GAP_SENTENCES, HiddenGapWatcher, classifyHiddenGap } from './hidden-gap.ts'
import type { HiddenGapVerdict, IntervalTimers } from './hidden-gap.ts'
import type { VisibilitySource } from './visibility-governor.ts'

/**
 * The hidden-gap instrument, driven from an injected clock and an injected visibility source.
 *
 * ## Why every reading here is a ratio and never a millisecond count
 *
 * `CLAUDE.md` § Measurement: *"prefer a comparative reading to an absolute one"*. An absolute
 * threshold — *fewer than so many milliseconds between ticks means throttled* — encodes the
 * machine it was written on and then fails somewhere else. The classification compares the
 * ticks that arrived against the ticks the wall clock says were **due inside the same hidden
 * span**, which cancels the machine, the load and the length of the span together.
 *
 * ## Why the clock, the timer and the visibility source are all injected
 *
 * The four verdicts include one that only a suspended engine produces. A spec that waited for
 * a real browser to suspend a real tab could not produce it at all — headless Chromium does
 * not even flip `document.visibilityState` when another page is brought to the front, measured
 * in `packages/node/src/embedded-webview.e2e.test.ts`. So the arithmetic is exercised here,
 * from literals, and the page wiring is exercised there.
 */

/** A `VisibilitySource` a spec can flip, standing in for `document`. */
class FakeVisibility implements VisibilitySource {
  hidden = false
  readonly #listeners = new Set<() => void>()

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.#listeners.add(listener)
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.#listeners.delete(listener)
  }

  /** How many listeners are attached — the reading `stop()` is checked against. */
  get attached(): number {
    return this.#listeners.size
  }

  /** Flip the state and fire the event, exactly as a browser does in that order. */
  set(hidden: boolean): void {
    this.hidden = hidden
    for (const listener of [...this.#listeners]) listener()
  }
}

/** An `IntervalTimers` that fires on demand, so no test waits for a real clock. */
class FakeTimers implements IntervalTimers {
  readonly created: { readonly ms: number; readonly callback: () => void }[] = []
  cleared = 0

  setInterval(callback: () => void, ms: number): unknown {
    this.created.push({ ms, callback })
    return this.created.length
  }

  clearInterval(_handle: unknown): void {
    this.cleared += 1
  }

  /** Fire the single registered interval `times` times. */
  fire(times: number): void {
    const only = this.created[0]
    if (only === undefined) throw new Error('nothing registered an interval')
    for (let i = 0; i < times; i += 1) only.callback()
  }
}

/** The period every case here drives, stated once so no case can drift from another. */
const INTERVAL_MS = 250

describe('the sentences a volunteer reads back over a phone call', () => {
  it('carries exactly one sentence for each of the four verdicts', () => {
    expect(Object.keys(HIDDEN_GAP_SENTENCES).sort()).toEqual(
      ['kept-running', 'not-yet', 'stopped', 'throttled'].sort(),
    )
    expect(Object.keys(HIDDEN_GAP_SENTENCES).length).toBe(4)
  })

  it('puts no digit on screen, which is what keeps the notice outside the region catalogue', () => {
    for (const [verdict, sentence] of Object.entries(HIDDEN_GAP_SENTENCES)) {
      expect(
        DIGIT.test(sentence),
        `the sentence for "${verdict}" reads "${sentence}" and carries a digit. ` +
          '#entry-notice is digit-free so that it carries no figure, which is what keeps it ' +
          'outside the region catalogue; a digit here means REGIONS, UI_SPEC_TALLY and ' +
          'UI-SPEC sections 4 and 12 must move in the same commit as the markup',
      ).toBe(false)
    }
  })

  it('says something different for each verdict, so a read-back can tell them apart', () => {
    const sentences = Object.values(HIDDEN_GAP_SENTENCES)
    expect(
      new Set(sentences).size,
      `two verdicts share a sentence — ${JSON.stringify(sentences)} — so the screen cannot ` +
        'distinguish the states the whole instrument exists to distinguish',
    ).toBe(sentences.length)
    // The distinction 38-DEVICE-OBSERVATIONS.md names as missing, asserted as words rather
    // than assumed from the verdict names.
    expect(HIDDEN_GAP_SENTENCES['stopped']).toMatch(/stopped/)
    expect(HIDDEN_GAP_SENTENCES['throttled']).toMatch(/slowed/)
    expect(HIDDEN_GAP_SENTENCES['kept-running']).toMatch(/kept running/)
  })
})

describe('classifying one hidden span, as a ratio inside that span', () => {
  it('reports nothing before any hide has happened', () => {
    expect(classifyHiddenGap({ wallMs: 0, ticks: 0, intervalMs: INTERVAL_MS })).toBe('not-yet')
  })

  it('reports the script kept running when the ticks are close to what was due', () => {
    // Ten seconds at a quarter-second period is forty due; thirty-eight arrived.
    expect(classifyHiddenGap({ wallMs: 10_000, ticks: 38, intervalMs: INTERVAL_MS })).toBe(
      'kept-running',
    )
  })

  it('reports the script was slowed down when ticks arrived but far below what was due', () => {
    // The shape a once-a-second background clamp produces at a quarter-second period: ten
    // seconds hidden, forty due, about ten delivered.
    expect(classifyHiddenGap({ wallMs: 10_000, ticks: 10, intervalMs: INTERVAL_MS })).toBe(
      'throttled',
    )
  })

  it('reports the script was stopped when a long enough span delivered nothing at all', () => {
    expect(classifyHiddenGap({ wallMs: 10_000, ticks: 0, intervalMs: INTERVAL_MS })).toBe('stopped')
  })

  /**
   * The floor, from both sides.
   *
   * A hidden span of a few hundred milliseconds legitimately delivers nothing — the interval's
   * own phase decides it — and calling that *stopped* would be a false reading of the strongest
   * verdict this instrument has. The floor is stated in the module as a named constant; these
   * two cases are what stop it being tuned away.
   */
  it('refuses to call a span shorter than the floor stopped, and does call one at the floor stopped', () => {
    expect(
      classifyHiddenGap({ wallMs: 500, ticks: 0, intervalMs: INTERVAL_MS }),
      'a half-second hide with no tick was read as the engine being stopped, which is phase ' +
        'rounding reported as a suspension',
    ).toBe('not-yet')
    expect(classifyHiddenGap({ wallMs: 3_000, ticks: 0, intervalMs: INTERVAL_MS })).toBe('stopped')
  })

  it('reads a span shorter than the floor as nothing to report, however many ticks arrived', () => {
    expect(classifyHiddenGap({ wallMs: 500, ticks: 2, intervalMs: INTERVAL_MS })).toBe('not-yet')
  })

  it('scales with the period rather than with a millisecond count', () => {
    // The same ratio at a period four times longer must read the same. If a boundary were an
    // absolute duration, one of these two would fall on the other side of it.
    expect(classifyHiddenGap({ wallMs: 10_000, ticks: 10, intervalMs: 250 })).toBe('throttled')
    expect(classifyHiddenGap({ wallMs: 40_000, ticks: 10, intervalMs: 1_000 })).toBe('throttled')
  })
})

describe('the watcher, over an injected clock and an injected visibility source', () => {
  it('says there is nothing to report before anything has been hidden', () => {
    const visibility = new FakeVisibility()
    const watcher = new HiddenGapWatcher({
      visibility,
      timers: new FakeTimers(),
      intervalMs: INTERVAL_MS,
      now: () => 0,
    })
    watcher.start()
    expect(watcher.verdict()).toBe('not-yet')
  })

  it('drives all four verdicts through one watcher, with no tab and no real clock', () => {
    const visibility = new FakeVisibility()
    const timers = new FakeTimers()
    let clock = 0
    const seen: HiddenGapVerdict[] = []
    const watcher = new HiddenGapWatcher({
      visibility,
      timers,
      intervalMs: INTERVAL_MS,
      now: () => clock,
      onVerdict: (verdict) => seen.push(verdict),
    })
    watcher.start()
    expect(watcher.verdict()).toBe('not-yet')

    // Ticks that arrive while the page is VISIBLE must not count towards a hidden span.
    timers.fire(100)
    expect(watcher.verdict()).toBe('not-yet')

    // ── hidden for ten seconds, nothing delivered
    visibility.set(true)
    clock = 10_000
    visibility.set(false)
    expect(watcher.verdict()).toBe('stopped')

    // ── hidden for ten more, about one a second delivered
    visibility.set(true)
    timers.fire(10)
    clock = 20_000
    visibility.set(false)
    expect(watcher.verdict()).toBe('throttled')

    // ── hidden for ten more, nearly everything delivered
    visibility.set(true)
    timers.fire(39)
    clock = 30_000
    visibility.set(false)
    expect(watcher.verdict()).toBe('kept-running')

    // The most recent span is what `verdict()` answers with, and every transition — into
    // hidden as well as out of it — told the page something, which is what lets the demo
    // write the sentence on each visibility change rather than polling for it.
    expect(seen.length).toBe(6)
    expect(seen[seen.length - 1]).toBe('kept-running')
  })

  /**
   * T-38-08 — one interval, whatever happens.
   *
   * *"It must not be per-notice or per-visibility-change, or a page cycled between foreground
   * and background accumulates timers."* A page a visitor flicks in and out of all afternoon
   * is exactly the page this instrument is deployed on.
   */
  it('registers one interval across two starts and many visibility changes', () => {
    const visibility = new FakeVisibility()
    const timers = new FakeTimers()
    const watcher = new HiddenGapWatcher({
      visibility,
      timers,
      intervalMs: INTERVAL_MS,
      now: () => 0,
    })
    watcher.start()
    watcher.start()
    for (let i = 0; i < 20; i += 1) visibility.set(i % 2 === 0)

    expect(
      timers.created.length,
      `the watcher registered ${String(timers.created.length)} intervals — a page cycled ` +
        'between foreground and background accumulates timers, which is T-38-08',
    ).toBe(1)
    expect(timers.created[0]?.ms).toBe(INTERVAL_MS)
    expect(visibility.attached).toBe(1)

    watcher.stop()
    expect(timers.cleared).toBe(1)
    expect(visibility.attached).toBe(0)
  })
})
