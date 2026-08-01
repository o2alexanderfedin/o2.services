import { describe, expect, it } from 'vitest'
import { DutyCycleGovernor } from './governor.ts'
import type { Governor } from './ports.ts'

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

/**
 * A `Governor` whose reading the test moves, standing in for an environment source.
 *
 * `VisibilityGovernor` is the real one and lives in `@o2/browser`, which the kernel
 * must not import. What matters to `DutyCycleGovernor` is only that the reading can
 * change under it, which this reproduces without a tab.
 */
class StubEnvironment implements Governor {
  dutyCycle = 1
  async yieldSlice(): Promise<void> {}
}

describe('DutyCycleGovernor — SCHED-04', () => {
  it('does not sleep at all at 100% duty cycle', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({ dutyCycle: 1, sleep, environment: 'no-environment-governor' })
    await g.yieldSlice()
    expect(calls).toEqual([])
  })

  it('idles for an equal period at 50% — compute 50ms, idle 50ms', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({
      dutyCycle: 0.5,
      sliceMs: 50,
      sleep,
      environment: 'no-environment-governor',
    })
    await g.yieldSlice()
    expect(calls).toEqual([50])
  })

  it('idles for a third of a slice at 75% — BOINC’s compute-3-wait-1', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({
      dutyCycle: 0.75,
      sliceMs: 30,
      sleep,
      environment: 'no-environment-governor',
    })
    await g.yieldSlice()
    // 30ms of compute per 40ms of wall time => 10ms idle.
    // Asserted with a tolerance: 30 * (1/0.75 - 1) is 9.999999999999998 in binary
    // floating point, and the governor has no business rounding a duration.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBeCloseTo(10, 6)
  })

  it('idles nine slices at 10%', async () => {
    const { calls, sleep } = fakeSleep()
    const g = new DutyCycleGovernor({
      dutyCycle: 0.1,
      sliceMs: 10,
      sleep,
      environment: 'no-environment-governor',
    })
    await g.yieldSlice()
    expect(calls).toEqual([90])
  })

  it('advertises capacity equal to its duty cycle, so placement sees the truth', () => {
    const { sleep } = fakeSleep()
    expect(
      new DutyCycleGovernor({ dutyCycle: 0.25, sleep, environment: 'no-environment-governor' })
        .advertisedCapacity,
    ).toBe(0.25)
  })

  it('refuses a duty cycle outside (0, 1]', () => {
    const { sleep } = fakeSleep()
    for (const bad of [0, -0.5, 1.5, Number.NaN]) {
      expect(
        () =>
          new DutyCycleGovernor({ dutyCycle: bad, sleep, environment: 'no-environment-governor' }),
      ).toThrow(RangeError)
    }
  })

  describe('a cap that can be set on a running governor', () => {
    it('moves both the reading and the pacing, with no reconstruction', async () => {
      // Two assertions, deliberately. A `setDutyCycle` that assigned a field
      // `yieldSlice` did not read would satisfy the reading and leave the node
      // running at the old rate — a control that reports success and changes
      // nothing, which is the failure this case exists to catch.
      const { calls, sleep } = fakeSleep()
      const g = new DutyCycleGovernor({
        dutyCycle: 1,
        sliceMs: 50,
        sleep,
        environment: 'no-environment-governor',
      })
      await g.yieldSlice()
      expect(calls).toEqual([])

      g.setDutyCycle(0.25)
      expect(g.dutyCycle).toBe(0.25)
      await g.yieldSlice()
      // 50ms of compute per 200ms of wall time => 150ms idle.
      expect(calls).toEqual([150])
    })

    it('refuses a cap outside (0, 1] rather than clamping it', () => {
      // 0 is a stop, not a throttle: it would mean an in-flight task never gets
      // another slice. Above 1 is not a cap at all. A non-finite value names no
      // rate. All four are the operator's mistake, and a clamp would turn the
      // mistake into a differently-configured node that nobody chose.
      const { sleep } = fakeSleep()
      const g = new DutyCycleGovernor({
        dutyCycle: 0.5,
        sleep,
        environment: 'no-environment-governor',
      })
      for (const bad of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(() => g.setDutyCycle(bad)).toThrow(RangeError)
      }
    })

    it('names the offending value in the refusal', () => {
      const { sleep } = fakeSleep()
      const g = new DutyCycleGovernor({
        dutyCycle: 0.5,
        sleep,
        environment: 'no-environment-governor',
      })
      expect(() => g.setDutyCycle(1.5)).toThrow(/1\.5/)
    })

    it('leaves the cap it had when it refuses one, so a refusal is not a change', () => {
      const { sleep } = fakeSleep()
      const g = new DutyCycleGovernor({
        dutyCycle: 0.5,
        sleep,
        environment: 'no-environment-governor',
      })
      expect(() => g.setDutyCycle(0)).toThrow(RangeError)
      expect(g.dutyCycle).toBe(0.5)
    })

    it('keeps `advertisedCapacity` equal to the reading after a set', () => {
      const { sleep } = fakeSleep()
      const g = new DutyCycleGovernor({
        dutyCycle: 1,
        sleep,
        environment: 'no-environment-governor',
      })
      g.setDutyCycle(0.3)
      expect(g.advertisedCapacity).toBe(0.3)
      expect(g.advertisedCapacity).toBe(g.dutyCycle)
    })
  })

  describe('composing with an environment governor', () => {
    it('binds from whichever side is lower, in both directions', () => {
      // One test, not two. An implementation that always returned the cap passes
      // the second assertion and fails the first; one that always returned the
      // environment does the reverse. Neither can pass this case.
      const { sleep } = fakeSleep()
      const environment = new StubEnvironment()
      environment.dutyCycle = 0.1
      const g = new DutyCycleGovernor({ dutyCycle: 0.5, sleep, environment })

      expect(g.dutyCycle).toBe(0.1)
      environment.dutyCycle = 1
      expect(g.dutyCycle).toBe(0.5)
    })

    it('follows a change on either side without reconstruction', () => {
      const { sleep } = fakeSleep()
      const environment = new StubEnvironment()
      const g = new DutyCycleGovernor({ dutyCycle: 0.5, sleep, environment })

      expect(g.dutyCycle).toBe(0.5)
      environment.dutyCycle = 0.2
      expect(g.dutyCycle).toBe(0.2)
      g.setDutyCycle(0.05)
      expect(g.dutyCycle).toBe(0.05)
      environment.dutyCycle = 1
      expect(g.dutyCycle).toBe(0.05)
    })

    it('paces at the composed reading, not at the cap', async () => {
      // The cap is 0.5 and the environment is 0.1, so a governor that paced from
      // its own field would idle 50ms and a governor that paced from the binding
      // reading idles 450ms. The difference is the whole point of composing.
      const { calls, sleep } = fakeSleep()
      const environment = new StubEnvironment()
      environment.dutyCycle = 0.1
      const g = new DutyCycleGovernor({ dutyCycle: 0.5, sliceMs: 50, sleep, environment })

      await g.yieldSlice()
      expect(calls).toEqual([450])
    })

    it('does not sleep when both sides are at full rate', async () => {
      const { calls, sleep } = fakeSleep()
      const g = new DutyCycleGovernor({ dutyCycle: 1, sleep, environment: new StubEnvironment() })
      await g.yieldSlice()
      expect(calls).toEqual([])
    })

    it('lets the cap alone bind when the absence of an environment is stated', () => {
      // The sentinel is exercised rather than merely spelled: a reading of the cap
      // is what "nothing else binds this node" means, and an implementation that
      // treated the absence as an environment reading of 0 would report 0 here.
      const { sleep } = fakeSleep()
      const g = new DutyCycleGovernor({
        dutyCycle: 0.4,
        sleep,
        environment: 'no-environment-governor',
      })
      expect(g.dutyCycle).toBe(0.4)
      expect(g.advertisedCapacity).toBe(0.4)
    })
  })
})
