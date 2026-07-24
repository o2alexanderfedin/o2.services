import { describe, expect, it } from 'vitest'
import { DutyCycleGovernor } from './governor.ts'

/** Records requested sleeps instead of performing them — no real waiting in tests. */
function fakeSleep() {
  const calls: number[] = []
  return {
    calls,
    sleep: async (ms: number): Promise<void> => {
      calls.push(ms)
    },
  }
}

describe('DutyCycleGovernor — SCHED-04', () => {
  it('does not sleep at all at 100% duty cycle', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({ dutyCycle: 1, sleep })
    await g.yieldSlice()
    expect(calls).toEqual([])
  })

  it('idles for an equal period at 50% — compute 50ms, idle 50ms', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({ dutyCycle: 0.5, sliceMs: 50, sleep })
    await g.yieldSlice()
    expect(calls).toEqual([50])
  })

  it('idles for a third of a slice at 75% — BOINC’s compute-3-wait-1', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({ dutyCycle: 0.75, sliceMs: 30, sleep })
    await g.yieldSlice()
    // 30ms of compute per 40ms of wall time => 10ms idle.
    // Asserted with a tolerance: 30 * (1/0.75 - 1) is 9.999999999999998 in binary
    // floating point, and the governor has no business rounding a duration.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBeCloseTo(10, 6)
  })

  it('idles nine slices at 10%', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({ dutyCycle: 0.1, sliceMs: 10, sleep })
    await g.yieldSlice()
    expect(calls).toEqual([90])
  })

  it('advertises capacity equal to its duty cycle, so placement sees the truth', () => {
    const { sleep } = fakeSleep()
    expect(new DutyCycleGovernor({ dutyCycle: 0.25, sleep }).advertisedCapacity).toBe(0.25)
  })

  it('refuses a duty cycle outside (0, 1]', () => {
    const { sleep } = fakeSleep()
    for (const bad of [0, -0.5, 1.5, Number.NaN]) {
      expect(() => new DutyCycleGovernor({ dutyCycle: bad, sleep })).toThrow(RangeError)
    }
  })
})
