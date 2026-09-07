/**
 * What the embedding application did to a running node while the page was hidden.
 *
 * ## The question this exists to answer, in the words that named it
 *
 * Phase 38's criterion 2 asks what an embedded browser *does to a running node* — *"whether JS
 * is suspended on backgrounding"*. `38-DEVICE-OBSERVATIONS.md` records, from a real device,
 * why the screen as it stood could not answer that: *"the observable is identical either way —
 * the indicator says disconnected because the connection is gone, and nothing on the page
 * distinguishes the engine stopped from the network went away."*
 *
 * So this module measures the one thing that does distinguish them. It runs an interval and
 * it reads a wall clock, and across a hidden span it compares the ticks that **arrived**
 * against the ticks the wall clock says were **due**. A suspended engine delivers none; a
 * throttled one delivers some; a page that kept running delivers nearly all of them. The wall
 * clock keeps advancing in every one of those cases, which is what makes it the reference.
 *
 * ## A ratio, never a millisecond count
 *
 * `CLAUDE.md` § Measurement: *"prefer a comparative reading to an absolute one. An absolute
 * threshold silently encodes the machine, the load and the I/O weather of the day it was
 * written… A ratio taken within one run cancels all three."* Every boundary below is a
 * dimensionless ratio of ticks to `due`, taken **inside one hidden span**. The same reading is
 * produced by a phone that hid for four seconds and by one that hid for four minutes, and
 * changing {@link DEFAULT_INTERVAL_MS} does not move any verdict.
 *
 * ## It reports and it never repairs
 *
 * If the verdict is that the script was stopped, nothing here changes what the node does.
 * Reconnect-on-wake already works and is recorded working. This module exists so that the
 * owner can say *why* a node went quiet, not so that it goes quiet less often.
 *
 * ## Words only — T-38-06
 *
 * {@link HIDDEN_GAP_SENTENCES} is the whole of what reaches the screen, and not one of the
 * four sentences carries a digit. A millisecond figure on a photographed screen is a
 * fingerprint of the device it was photographed on, and it would also put a digit inside
 * `#entry-notice`, which stays digit-free so that it stays outside the region catalogue's
 * jurisdiction (`38-01-PLAN.md`'s `<catalogue_decision>`, checked in
 * `packages/node/src/embedded-webview.e2e.test.ts`).
 *
 * ## Not in the barrel
 *
 * `packages/browser/src/index.ts` does not export this, on `computing-indicator.ts`'s and
 * `embedded-webview.ts`'s stated rule: `demo/main.ts` imports it by relative path, and a
 * barrel entry would put an exported-but-statically-unreachable symbol in front of
 * `reachability-guard.node.test.ts` for the benefit of no consumer.
 */

import type { VisibilitySource } from './visibility-governor.ts'

/**
 * What one hidden span turned out to be.
 *
 * `not-yet` is a reading in its own right and not an absence: *before any hide has happened
 * the screen says so rather than guessing*, which is the difference between an instrument
 * that has not spoken and one that has nothing to say.
 */
export type HiddenGapVerdict = 'not-yet' | 'kept-running' | 'throttled' | 'stopped'

/**
 * One sentence per verdict, written to be read aloud down a phone line.
 *
 * Words only. No digit in any of the four — see the module docblock, and see
 * `hidden-gap.test.ts`, which checks it against `DIGIT` from `demo-regions.ts` so that
 * *digit on screen* has exactly one definition in this repository.
 *
 * The `not-yet` sentence says *long enough* rather than *at all*, and that is deliberate
 * rather than hedging: {@link classifyHiddenGap} returns it both when nothing has been hidden
 * and when a span was too short to carry a reading, and a sentence that claimed the page had
 * never been hidden would be false in the second case.
 */
export const HIDDEN_GAP_SENTENCES: Readonly<Record<HiddenGapVerdict, string>> = {
  'not-yet': 'this page has not yet been hidden for long enough to tell',
  'kept-running': 'the script kept running while this page was hidden',
  throttled: 'the script was slowed down while this page was hidden',
  stopped: 'the script was stopped while this page was hidden',
}

/**
 * How many ticks must have been due before a span carries any reading at all.
 *
 * **Sited against two things, neither of them this machine.** First, phase: a span of one or
 * two intervals delivers nought, one or two ticks depending only on where the interval's phase
 * happened to fall, so a ratio taken over it is noise and reporting it would let a stray flick
 * of the app switcher overwrite a real reading. Second, the clamp: browsers throttle timers in
 * a hidden page to roughly once a second — the fact `visibility-governor.ts`'s docblock already
 * states — so a span of a dozen quarter-second intervals is about three seconds, across which
 * a merely-clamped page still delivers two or three ticks. Zero across such a span is therefore
 * a stronger statement than clamping, which is what lets `stopped` mean what it says.
 *
 * It is a count of *due intervals* and not a duration, so it moves with the period rather than
 * encoding one.
 */
const MIN_DUE_FOR_READING = 12

/**
 * The share of the due ticks a page must deliver to count as having kept running.
 *
 * **Sited against the two populations it has to separate, and it sits between them rather than
 * beside either.** A page that really kept running delivers a ratio near one, pulled down only
 * by jitter, a busy main thread and the partial interval at each end of the span. A page
 * clamped to roughly one tick a second at the default quarter-second period delivers about a
 * quarter. The boundary is nearer the clamped end than the midpoint on purpose: mistaking a
 * running page for a slowed one is a wrong reading, and so is the reverse, but the second is
 * the one that would have to be argued with a phone in hand.
 */
const KEPT_RUNNING_MIN_RATIO = 0.6

/**
 * The watcher's period when a caller states none.
 *
 * It must be **meaningfully shorter than the roughly one-second clamp** browsers apply to a
 * hidden page, or a clamped page and a running one deliver the same count and `throttled`
 * stops being distinguishable from `kept-running` at all. A quarter second gives a clamped
 * page about a quarter of its due ticks, which is well clear of
 * {@link KEPT_RUNNING_MIN_RATIO}. The work per tick is one increment of a counter.
 */
const DEFAULT_INTERVAL_MS = 250

/** What {@link classifyHiddenGap} is given about one hidden span, and nothing else. */
export interface HiddenGapSpan {
  /** Wall-clock milliseconds across the hidden span — the reference that keeps advancing. */
  readonly wallMs: number
  /** Interval callbacks that actually fired while hidden. */
  readonly ticks: number
  /** The period the watcher asked for. */
  readonly intervalMs: number
}

/**
 * The verdict for one hidden span, from the ratio of ticks delivered to ticks due.
 *
 * The order of the tests is the argument. The floor comes **first**, because a span too short
 * to carry a reading must not be classified at all — running `ticks === 0` before it would
 * report the strongest verdict this instrument has on the weakest evidence it can be given.
 */
export function classifyHiddenGap(span: HiddenGapSpan): HiddenGapVerdict {
  const { wallMs, ticks, intervalMs } = span
  if (!(intervalMs > 0)) return 'not-yet'

  const due = wallMs / intervalMs
  if (!(due >= MIN_DUE_FOR_READING)) return 'not-yet'
  if (ticks <= 0) return 'stopped'
  return ticks / due >= KEPT_RUNNING_MIN_RATIO ? 'kept-running' : 'throttled'
}

/**
 * The part of `setInterval`/`clearInterval` this needs, so it can be driven with no real clock.
 *
 * The handle is `unknown` on purpose. A browser's `setInterval` answers a number and Node's
 * answers a `Timeout`, this file is type-checked with both `lib: dom` and `types: node`, and an
 * opaque handle is the one shape that needs neither to win.
 */
export interface IntervalTimers {
  readonly setInterval: (callback: () => void, ms: number) => unknown
  readonly clearInterval: (handle: unknown) => void
}

/** The real timers, read lazily so this module touches no global at import time. */
const REAL_TIMERS: IntervalTimers = {
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>)
  },
}

export interface HiddenGapWatcherOptions {
  /** Required. `document` in the page, a fake in a spec — there is no sane global default. */
  readonly visibility: VisibilitySource
  /**
   * Defaults to `performance.now()`, which exists in the browser and in Node alike — the
   * clock `CLAUDE.md` § Measurement names for exactly that reason.
   */
  readonly now?: () => number
  readonly timers?: IntervalTimers
  readonly intervalMs?: number
  /**
   * Called on **every** visibility transition, into hidden as well as out of it, with the
   * verdict as it stands.
   *
   * A callback rather than the caller adding a second `visibilitychange` listener of its own:
   * two listeners on one event would make the readout depend on registration order, which is
   * the kind of coupling nothing on the page says out loud.
   */
  readonly onVerdict?: (verdict: HiddenGapVerdict) => void
}

/**
 * One instrument per page — T-38-08.
 *
 * *"One interval at a coarse period, started once at page start and stopped on `pagehide`. It
 * must not be per-notice or per-visibility-change, or a page cycled between foreground and
 * background accumulates timers."* {@link start} is therefore idempotent, and
 * `hidden-gap.test.ts` asserts a single registered interval across two starts and twenty
 * visibility changes.
 */
export class HiddenGapWatcher {
  readonly #visibility: VisibilitySource
  readonly #now: () => number
  readonly #timers: IntervalTimers
  readonly #intervalMs: number
  readonly #onVerdict: (verdict: HiddenGapVerdict) => void
  readonly #listener: () => void

  #running = false
  #handle: unknown = null
  #ticks = 0
  #hiddenAt: number | null = null
  #ticksAtHide = 0
  #verdict: HiddenGapVerdict

  constructor(options: HiddenGapWatcherOptions) {
    this.#visibility = options.visibility
    this.#now = options.now ?? ((): number => performance.now())
    this.#timers = options.timers ?? REAL_TIMERS
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.#onVerdict = options.onVerdict ?? ((): void => {})
    // The opening reading comes from the classifier rather than from a literal, so that every
    // verdict this page can show — including the first one, before anything has happened — has
    // exactly one definition. A hard-coded `'not-yet'` here would be a second one.
    this.#verdict = classifyHiddenGap({ wallMs: 0, ticks: 0, intervalMs: this.#intervalMs })
    this.#listener = (): void => {
      this.#onVisibilityChange()
    }
  }

  /** Attach and start counting. Calling it twice registers nothing a second time. */
  start(): void {
    if (this.#running) return
    this.#running = true
    this.#handle = this.#timers.setInterval(() => {
      this.#ticks += 1
    }, this.#intervalMs)
    this.#visibility.addEventListener('visibilitychange', this.#listener)
  }

  /** Detach and release the interval. Calling it twice releases nothing a second time. */
  stop(): void {
    if (!this.#running) return
    this.#running = false
    this.#timers.clearInterval(this.#handle)
    this.#handle = null
    this.#visibility.removeEventListener('visibilitychange', this.#listener)
  }

  /** The most recent span's verdict — `not-yet` until one has been observed. */
  verdict(): HiddenGapVerdict {
    return this.#verdict
  }

  #onVisibilityChange(): void {
    if (this.#visibility.hidden) {
      // Stamp the clock and the counter together. Ticks that arrived while the page was
      // visible belong to no span and must not be credited to this one.
      this.#hiddenAt = this.#now()
      this.#ticksAtHide = this.#ticks
    } else if (this.#hiddenAt !== null) {
      const wallMs = this.#now() - this.#hiddenAt
      this.#hiddenAt = null
      this.#verdict = classifyHiddenGap({
        wallMs,
        ticks: this.#ticks - this.#ticksAtHide,
        intervalMs: this.#intervalMs,
      })
    }
    this.#onVerdict(this.#verdict)
  }
}
