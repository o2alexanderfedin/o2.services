/**
 * Duty-cycle CPU governor — SCHED-04.
 *
 * A duty cycle, not a scheduler priority. BOINC's `% CPU` works this way — 75%
 * means compute 3 units then idle 1 — because it is the only form of throttling
 * that is portable and that actually reduces heat and battery draw. Neither a
 * browser tab nor a Node process can change its own scheduler priority, so this
 * is the control that exists everywhere.
 *
 * Building it into the kernel now is deliberate: retrofitting a CPU cap into a
 * scheduler that assumes it may use a whole core is a rewrite, not a patch.
 *
 * The port takes a `sleep` function rather than calling `setTimeout` directly,
 * so the kernel stays free of platform globals and tests need no real waiting.
 */

import type { Governor } from './ports.ts'

export type Sleep = (ms: number) => Promise<void>

export interface DutyCycleOptions {
  /** Fraction of wall time permitted for compute, in (0, 1]. */
  readonly dutyCycle: number
  /** Length of one compute slice in ms. */
  readonly sliceMs?: number
  readonly sleep: Sleep
}

export class DutyCycleGovernor implements Governor {
  readonly dutyCycle: number
  readonly #sliceMs: number
  readonly #sleep: Sleep

  constructor(options: DutyCycleOptions) {
    const { dutyCycle, sliceMs = 50, sleep } = options
    if (!(dutyCycle > 0 && dutyCycle <= 1)) {
      throw new RangeError(`dutyCycle must be in (0, 1], got ${dutyCycle}`)
    }
    this.dutyCycle = dutyCycle
    this.#sliceMs = sliceMs
    this.#sleep = sleep
  }

  /**
   * Idle for the off-portion of one duty cycle.
   *
   * At d = 1 this resolves without sleeping at all, so an unthrottled node pays
   * nothing for the governor's existence.
   */
  async yieldSlice(): Promise<void> {
    if (this.dutyCycle >= 1) return
    const offMs = this.#sliceMs * (1 / this.dutyCycle - 1)
    await this.#sleep(offMs)
  }

  /** Advertised capacity scales with the duty cycle, so placement sees the truth. */
  get advertisedCapacity(): number {
    return this.dutyCycle
  }
}
