import { describe, expect, it } from 'vitest'
import { UNKNOWN_CORE_COUNT_FALLBACK, hostCoreCount } from './core-count.ts'

/**
 * The reader is driven over **injected scopes** rather than over the real global, for
 * the reason `workerd-shims.test.ts` gives for the same shape: the cases that matter are
 * the ones this machine cannot produce. A spec that only read `globalThis` would assert
 * "8 is 8" and go green on every branch it never took.
 *
 * One case does read the real global, and it is the one that has to: a claim about what
 * the runtime actually exposes is not provable against a fake.
 */
describe('the pool asks the host how many cores it has', () => {
  it('takes a positive integer reading at face value', () => {
    expect(hostCoreCount({ navigator: { hardwareConcurrency: 8 } })).toBe(8)
    // 1 is a real answer and not a fallback in disguise. Written as its own assertion
    // because the two are the same number and a reader must be able to tell that the
    // first case is a reading and the second is a refusal.
    expect(hostCoreCount({ navigator: { hardwareConcurrency: 1 } })).toBe(1)
  })

  it('falls back when the host has no navigator at all', () => {
    expect(hostCoreCount({})).toBe(UNKNOWN_CORE_COUNT_FALLBACK)
  })

  it('falls back when navigator exists without the field', () => {
    expect(hostCoreCount({ navigator: {} })).toBe(UNKNOWN_CORE_COUNT_FALLBACK)
  })

  it('refuses a reading that is not a usable count, rather than passing it through', () => {
    // Each of these would size a pool wrongly in a different way if taken at face
    // value: zero accepts no work, a fraction is not a number of threads, a negative
    // is nonsense, and the string is what a shimmed global could plausibly carry.
    for (const reported of [0, -4, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '8', null]) {
      expect(hostCoreCount({ navigator: { hardwareConcurrency: reported } })).toBe(
        UNKNOWN_CORE_COUNT_FALLBACK,
      )
    }
  })

  it('reads the real runtime, because a claim about the platform cannot be faked', () => {
    // This is the measurement the module's docblock records. If a future runtime stops
    // exposing the field, this case goes red and the fallback path becomes the live one
    // — which is a thing to find out here rather than from a node running one thread.
    expect(hostCoreCount()).toBeGreaterThanOrEqual(1)
    expect(Number.isInteger(hostCoreCount())).toBe(true)
    expect(globalThis.navigator?.hardwareConcurrency).toBe(hostCoreCount())
  })

  it('never returns a value a pool cannot be built from', () => {
    // Anti-vacuity over the whole surface: whatever comes back, it is a size.
    for (const scope of [{}, { navigator: {} }, { navigator: { hardwareConcurrency: 0 } }]) {
      const count = hostCoreCount(scope)
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })
})
