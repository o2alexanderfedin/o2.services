/**
 * The rule that a loaded host invalidates a timing reading, executed rather than written down.
 *
 * ## What this replaces, and why prose was not enough
 *
 * `CLAUDE.md` § Measurement already says *"measure the process, not the machine"* and *"never
 * write a measured span you did not measure, and record the conditions beside it."* Both were
 * true and neither fired. On 2026-08-27 a full browser-lane run took 498 s and failed one
 * chromium spec on a 65-second timeout; the conclusion *"the CI failure reproduces locally"*
 * was reported to the owner, and a remedy was proposed on the strength of it. The host had
 * been at a one-minute load average of about 400 for the whole run — an unrelated project's
 * `ctest -j 4` had been spawning test binaries for over seven hours — so what was measured was
 * contention with that workload and nothing about this repository at all.
 *
 * Nothing in the run said so, because nothing in the run read the load. The owner's answer was
 * that a rule of this kind belongs in the tests rather than in a document, and this file plus
 * {@link hostConditionsVerdict} is that.
 *
 * ## Why a verdict function rather than a gate in each spec
 *
 * `transport-bounds.node.test.ts` already carries a per-spec load gate, sited on its own
 * observed readings, and it is not generalised here — its ceiling belongs to its own
 * measurement and a shared constant would be a different claim wearing its number. What is
 * missing is not another per-spec gate but a reading of the RUN, and the run is the only level
 * the browser lane can be reached at: a browser spec cannot call `loadavg()` because there is
 * no `node:os` in a browser, while a reporter is Node either way.
 *
 * ## What the verdict is about
 *
 * Not correctness. A run on a loaded host that goes green is green — contention does not make
 * a passing assertion false. What it destroys is every claim about *duration*, and every
 * failure whose shape is a timeout. So the three verdicts separate exactly that.
 */

import { describe, expect, it } from 'vitest'
import {
  LOAD_PER_CORE_CEILING,
  hostConditionsVerdict,
} from '../../../tools/measure/host-conditions-reporter.ts'

describe('a run carries the conditions it was taken under', () => {
  it('calls a quiet run sound, so the ordinary case adds no noise', () => {
    const verdict = hostConditionsVerdict({
      loadBefore: 3.47,
      loadAfter: 3.6,
      cpus: 8,
      failures: 0,
    })

    expect(verdict.kind).toBe('sound')
    expect(verdict.saturated).toBe(false)
  })

  /**
   * The reading that produced this file. Load ~400 on 8 cores is 50 per core; the failure was
   * a spec timing out at 65 s.
   */
  it('refuses to let a failure on a saturated host stand as evidence about the code', () => {
    const verdict = hostConditionsVerdict({
      loadBefore: 396,
      loadAfter: 412,
      cpus: 8,
      failures: 1,
    })

    expect(verdict.kind).toBe('failures-not-evidence')
    expect(verdict.saturated).toBe(true)
    // The numbers, not just the word — a banner a reader cannot check is prose again.
    expect(verdict.message).toContain('49.50')
    expect(verdict.message).toContain('51.50')
  })

  it('still lets a GREEN saturated run stand on pass/fail, and voids only its timings', () => {
    // Contention does not make a passing assertion false. Saying otherwise would make the
    // instrument refuse the runs it is cheapest to take.
    const verdict = hostConditionsVerdict({
      loadBefore: 396,
      loadAfter: 412,
      cpus: 8,
      failures: 0,
    })

    expect(verdict.kind).toBe('timings-unsound')
    expect(verdict.saturated).toBe(true)
  })

  /**
   * `loadavg()[0]` is a one-minute average, so it LAGS the contention it stands for —
   * `transport-bounds.node.test.ts` measured that directly: its suite began at load 5.20 and
   * the case read 51 MB against a 40 MB threshold as the other files spun up. A gate that only
   * samples before the work cannot see that, which is why both samples are given and either
   * one is enough.
   */
  it('catches load that arrived DURING the run, which a before-only sample cannot', () => {
    const verdict = hostConditionsVerdict({
      loadBefore: 1.2,
      loadAfter: 120,
      cpus: 8,
      failures: 1,
    })

    expect(verdict.kind).toBe('failures-not-evidence')
  })

  it('reads load PER CORE, so the same raw number means different things on two machines', () => {
    const onEight = hostConditionsVerdict({ loadBefore: 40, loadAfter: 40, cpus: 8, failures: 0 })
    const onNinetySix = hostConditionsVerdict({
      loadBefore: 40,
      loadAfter: 40,
      cpus: 96,
      failures: 0,
    })

    expect(onEight.saturated).toBe(true)
    expect(onNinetySix.saturated, '40 across 96 cores is a quiet machine').toBe(false)
  })

  /**
   * Sited the way `transport-bounds.node.test.ts` sites its own: above every recorded pass,
   * below every observed failure, and widened only by adding readings.
   *
   * Recorded passes, from `vitest.config.ts`'s own measurement table on this 8-core host —
   * `node` at 6.68 and 5.20 (0.84 and 0.65 per core) and `aot` at 18.95 (2.37 per core).
   * Observed failure: ~396-489 (49.5-61.1 per core).
   */
  it('sits above every recorded pass and far below the observed failure', () => {
    expect(LOAD_PER_CORE_CEILING).toBeGreaterThan(18.95 / 8)
    expect(LOAD_PER_CORE_CEILING).toBeLessThan(396 / 8)
    // A literal, so moving the constant cannot move the assertion with it.
    expect(LOAD_PER_CORE_CEILING).toBe(4)
  })
})
