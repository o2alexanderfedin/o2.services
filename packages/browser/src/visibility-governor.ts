/**
 * BROW-03 — a governor driven by whether the tab is visible.
 *
 * A visitor's page must stay responsive, and a background tab that keeps a core busy
 * is the fastest way to lose consent. So the duty cycle follows visibility: full rate
 * in the foreground, a small fraction when hidden.
 *
 * ## Event-driven, not polled
 *
 * The criterion is "throttles within a second of the tab being backgrounded".
 * `visibilitychange` fires immediately, so the duty cycle changes in the same turn as
 * the event. A polled implementation could satisfy a one-second bar while still being
 * the wrong design — browsers throttle timers in background tabs, which is exactly
 * when a poll would be least reliable. The one-second bar itself is measured by the
 * harness end to end, not self-reported here.
 *
 * ## Why the duty cycle never reaches zero
 *
 * A hidden tab throttles rather than stops. Zero would mean a task in flight never
 * gets a chance to finish, turning a background transition into abandoned work and a
 * failed replica — the opposite of "resumes on return without losing its job". The
 * floor is small but positive, and `GovernedExecutor` only ever yields *between*
 * tasks, so work already started always completes.
 *
 * Browsers also throttle `setTimeout` in background tabs to roughly once a second,
 * which means real idle periods are longer than requested. That is a bonus, not
 * something to compensate for.
 */

import type { Governor } from '@o2/core'

export type Sleep = (ms: number) => Promise<void>

/** The part of `document` this needs, so it can be driven directly in a test. */
export interface VisibilitySource {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface VisibilityGovernorOptions {
  /** Duty cycle while the tab is visible. Defaults to 1 — no throttling at all. */
  readonly foregroundDutyCycle?: number
  /** Duty cycle while the tab is hidden. Must stay above 0; defaults to 0.1. */
  readonly backgroundDutyCycle?: number
  readonly sliceMs?: number
  readonly sleep?: Sleep
  /** Defaults to `document`. Injectable so the behaviour is testable without a tab. */
  readonly visibility?: VisibilitySource
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class VisibilityGovernor implements Governor {
  readonly #foreground: number
  readonly #background: number
  readonly #sliceMs: number
  readonly #sleep: Sleep
  readonly #source: VisibilitySource
  readonly #listener: () => void
  readonly #changeListeners = new Set<(hidden: boolean) => void>()

  #hidden: boolean
  #transitions = 0
  #sleptMs = 0
  #lastChangeAt: number | null = null
  #stopped = false

  constructor(options: VisibilityGovernorOptions = {}) {
    const {
      foregroundDutyCycle = 1,
      backgroundDutyCycle = 0.1,
      sliceMs = 50,
      sleep = defaultSleep,
      visibility,
    } = options

    if (!(foregroundDutyCycle > 0 && foregroundDutyCycle <= 1)) {
      throw new RangeError(`foregroundDutyCycle must be in (0, 1], got ${foregroundDutyCycle}`)
    }
    // Zero would abandon in-flight work rather than throttle it — see the note above.
    if (!(backgroundDutyCycle > 0 && backgroundDutyCycle <= 1)) {
      throw new RangeError(`backgroundDutyCycle must be in (0, 1], got ${backgroundDutyCycle}`)
    }

    const source = visibility ?? (globalThis.document as unknown as VisibilitySource | undefined)
    if (source === undefined) {
      throw new Error('no visibility source: pass `visibility` when there is no document')
    }

    this.#foreground = foregroundDutyCycle
    this.#background = backgroundDutyCycle
    this.#sliceMs = sliceMs
    this.#sleep = sleep
    this.#source = source
    this.#hidden = source.hidden

    this.#listener = (): void => {
      const hidden = this.#source.hidden
      if (hidden === this.#hidden) return
      this.#hidden = hidden
      this.#transitions += 1
      this.#lastChangeAt = performance.now()
      for (const listener of [...this.#changeListeners]) listener(hidden)
    }
    source.addEventListener('visibilitychange', this.#listener)
  }

  /** The duty cycle in force right now. Changes with visibility. */
  get dutyCycle(): number {
    return this.#hidden ? this.#background : this.#foreground
  }

  get hidden(): boolean {
    return this.#hidden
  }

  /** Visibility changes observed. */
  get transitions(): number {
    return this.#transitions
  }

  /** Cumulative time spent idling for the governor. Zero at a duty cycle of 1. */
  get sleptMs(): number {
    return this.#sleptMs
  }

  /**
   * `performance.now()` at the last visibility change, or `null` if none yet.
   *
   * Deliberately *not* a self-measured "throttle latency". The duty cycle changes in
   * the same turn as the event, so any latency this class computed about itself would
   * be zero by construction and would prove nothing. The one-second bar in the
   * criterion is measured end to end by the harness, from the moment it backgrounds
   * the tab to the moment the tab reports itself throttled.
   */
  get lastChangeAt(): number | null {
    return this.#lastChangeAt
  }

  onVisibilityChange(listener: (hidden: boolean) => void): () => void {
    this.#changeListeners.add(listener)
    return () => {
      this.#changeListeners.delete(listener)
    }
  }

  async yieldSlice(): Promise<void> {
    const duty = this.dutyCycle
    if (duty >= 1) return
    const offMs = this.#sliceMs * (1 / duty - 1)
    this.#sleptMs += offMs
    await this.#sleep(offMs)
  }

  /** Advertised capacity follows the duty cycle, so placement sees the truth. */
  get advertisedCapacity(): number {
    return this.dutyCycle
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    this.#source.removeEventListener('visibilitychange', this.#listener)
    this.#changeListeners.clear()
  }
}
