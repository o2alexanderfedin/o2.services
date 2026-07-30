import { describe as suite, expect, it } from 'vitest'
import { PERF_BASELINE } from './perf-baseline.ts'
import type { BaselineRung } from './perf-baseline.ts'
import { explain, judge, verdict } from './perf-gate.ts'
import type { Finding, GateInput, Statistic } from './perf-gate.ts'
import { MIN_RELIABLE_SAMPLES, summarise } from './stats.ts'
import type { Summary } from './stats.ts'

/**
 * The perf gate's comparison, tested without measuring anything.
 *
 * The measurement is slow and lives in `perf-gate.perf.test.ts`, which runs only under
 * the `perf` project. What is here is the decision: given a baseline and a measured
 * ladder, does the gate go red for the right reasons and — the part that matters most —
 * does it *refuse* rather than pass when there is nothing meaningful to compare?
 *
 * That last question is not hypothetical for this repo. Its disclosure gate once read
 * green because a publish-command pattern matched no lines, and the empty result was
 * reported as an absence of publish commands rather than as an absent instrument. Every
 * refusal case below is that bug, in this gate's shape.
 */

/**
 * An `n`-sample series whose nearest-rank p50 and p95 are exactly the two values given.
 *
 * Built through `summarise` rather than by hand-writing a `Summary` literal, so the
 * `reliable` flag under test is `stats.ts`'s own rule and not a copy of it that could
 * drift. The percentile arithmetic is asserted below before anything relies on it.
 */
function series(n: number, p50: number, p95: number): readonly number[] {
  const firstTailIndex = Math.ceil(0.95 * n) - 1
  return Array.from({ length: n }, (_, i) => (i < firstTailIndex ? p50 : p95))
}

const sample = (n: number, p50: number, p95: number): Summary => summarise(series(n, p50, p95))

/** The baseline's own rung at `index`, read rather than indexed blindly. */
function rungAt(index: number): BaselineRung {
  const rung = PERF_BASELINE.rungs[index]
  if (rung === undefined) throw new Error(`the committed baseline has no rung at index ${index}`)
  return rung
}

/** A rung measured exactly at the committed baseline. */
function atBaseline(nodes: number, n = 100): GateInput {
  const rung = PERF_BASELINE.rungs.find((candidate) => candidate.nodes === nodes)
  if (rung === undefined) throw new Error(`no baseline rung for ${nodes} nodes`)
  return {
    nodes,
    incomplete: 0,
    makespan: sample(n, rung.makespanP50Ms, rung.makespanP95Ms),
    coordinationRatio: sample(n, rung.coordinationRatioP50, rung.coordinationRatioP95),
  }
}

/** Every rung the baseline names, measured exactly at it. */
const wholeLadderAtBaseline = (n = 100): readonly GateInput[] =>
  PERF_BASELINE.rungs.map((rung) => atBaseline(rung.nodes, n))

const kinds = (findings: readonly Finding[]): string[] => findings.map((finding) => finding.kind)

const CHECKS_PER_RUNG = 3

suite('the fixtures mean what the tests below assume', () => {
  it('produces series whose nearest-rank percentiles are the requested values', () => {
    // Without this the rest of the file could be asserting on percentiles that are not
    // the ones it names, and every result would still look plausible.
    const summary = sample(100, 4, 9)
    expect(summary.n).toBe(100)
    expect(summary.p50).toBe(4)
    expect(summary.p95).toBe(9)

    const small = sample(MIN_RELIABLE_SAMPLES - 1, 4, 9)
    expect(small.p50).toBe(4)
    expect(small.p95).toBe(9)
    expect(small.reliable).toBe(false)
  })
})

suite('a run at the baseline passes, and the pass is not vacuous', () => {
  it('reports no findings and says so through verdict()', () => {
    const result = judge(PERF_BASELINE, wholeLadderAtBaseline())
    expect(kinds(result.findings)).toEqual([])
    expect(verdict(result)).toBeNull()
  })

  it('made a comparison for every rung and statistic', () => {
    // The instrument was live: this is the assertion that separates "nothing was wrong"
    // from "nothing was looked at".
    const result = judge(PERF_BASELINE, wholeLadderAtBaseline())
    expect(result.checks).toHaveLength(PERF_BASELINE.rungs.length * CHECKS_PER_RUNG)
    expect(new Set(result.checks.map((check) => check.statistic))).toEqual(
      new Set<Statistic>(['coordination-ratio-p50', 'coordination-ratio-p95', 'makespan-p50-ms']),
    )
    expect(result.checks.every((check) => check.outcome === 'within-budget')).toBe(true)
  })

  it('refuses to call an empty comparison a pass', () => {
    // The exact failure this repo already shipped once: an empty result read as a clean
    // one. `judge` cannot produce this from a non-empty baseline, so it is constructed
    // directly — the point is that `verdict` does not treat it as green.
    const message = verdict({ findings: [], checks: [] })
    expect(message).not.toBeNull()
    expect(message).toContain('compared nothing')
  })
})

suite('it refuses to pass when the sample cannot carry the percentile', () => {
  it('reports sample-too-small even when every number is comfortably inside budget', () => {
    // Fast *and* unmeasurable. A gate that green-lights this is worse than no gate,
    // because it certifies a run nobody measured.
    const tiny = PERF_BASELINE.rungs.map((rung) => ({
      ...atBaseline(rung.nodes, MIN_RELIABLE_SAMPLES - 1),
      makespan: sample(MIN_RELIABLE_SAMPLES - 1, rung.makespanP50Ms / 10, rung.makespanP95Ms / 10),
      coordinationRatio: sample(
        MIN_RELIABLE_SAMPLES - 1,
        rung.coordinationRatioP50 / 10,
        rung.coordinationRatioP95 / 10,
      ),
    }))

    const result = judge(PERF_BASELINE, tiny)
    expect(kinds(result.findings)).toEqual(
      Array.from({ length: PERF_BASELINE.rungs.length * CHECKS_PER_RUNG }, () => 'sample-too-small'),
    )
    // Every comparison is recorded as refused rather than omitted, so the count of
    // checks stays the count of things the gate is supposed to look at.
    expect(result.checks).toHaveLength(PERF_BASELINE.rungs.length * CHECKS_PER_RUNG)
    expect(result.checks.every((check) => check.outcome === 'refused-unreliable-sample')).toBe(true)
    expect(verdict(result)).toContain(`below MIN_RELIABLE_SAMPLES=${MIN_RELIABLE_SAMPLES}`)
  })

  it('accepts exactly MIN_RELIABLE_SAMPLES and refuses one below it', () => {
    // The boundary is `stats.ts`'s, deferred to rather than restated: this asserts the
    // gate moved when `Summary.reliable` moved, at the value stats.ts publishes.
    const enough = judge(
      PERF_BASELINE,
      PERF_BASELINE.rungs.map((rung) => atBaseline(rung.nodes, MIN_RELIABLE_SAMPLES)),
    )
    expect(kinds(enough.findings)).toEqual([])

    const notEnough = judge(
      PERF_BASELINE,
      PERF_BASELINE.rungs.map((rung) => atBaseline(rung.nodes, MIN_RELIABLE_SAMPLES - 1)),
    )
    expect(new Set(kinds(notEnough.findings))).toEqual(new Set(['sample-too-small']))
  })

  it('refuses an empty sample rather than comparing NaN', () => {
    const empty: GateInput = {
      nodes: 1,
      incomplete: 0,
      makespan: summarise([]),
      coordinationRatio: summarise([]),
    }
    const result = judge({ ...PERF_BASELINE, rungs: [rungAt(0)] }, [empty])
    expect(new Set(kinds(result.findings))).toEqual(new Set(['sample-too-small']))
    expect(result.checks.every((check) => check.outcome === 'refused-unreliable-sample')).toBe(true)
  })
})

suite('it goes red when a statistic passes its budget', () => {
  it('fails on the coordination-ratio p95, at the statistic the budget names', () => {
    const rung = rungAt(0)
    const overBy = 1 + PERF_BASELINE.headroom.coordinationRatioP95 + 0.01
    const measured: GateInput = {
      ...atBaseline(rung.nodes),
      coordinationRatio: sample(100, rung.coordinationRatioP50, rung.coordinationRatioP95 * overBy),
    }
    const result = judge({ ...PERF_BASELINE, rungs: [rung] }, [measured])

    expect(kinds(result.findings)).toEqual(['regressed'])
    const finding = result.findings[0]
    expect(finding?.kind === 'regressed' && finding.statistic).toBe('coordination-ratio-p95')
    expect(verdict(result)).toContain('coordination-ratio-p95')
  })

  it('passes at exactly the budget and fails just above it', () => {
    // The boundary is where a threshold spec is worth testing: an off-by-one in the
    // comparison direction is invisible everywhere else.
    const rung = rungAt(0)
    const budget = rung.coordinationRatioP50 * (1 + PERF_BASELINE.headroom.coordinationRatioP50)
    const one = { ...PERF_BASELINE, rungs: [rung] }

    const at = judge(one, [
      { ...atBaseline(rung.nodes), coordinationRatio: sample(100, budget, rung.coordinationRatioP95) },
    ])
    expect(kinds(at.findings)).toEqual([])

    const over = judge(one, [
      {
        ...atBaseline(rung.nodes),
        coordinationRatio: sample(100, budget * 1.000_001, rung.coordinationRatioP95),
      },
    ])
    expect(kinds(over.findings)).toEqual(['regressed'])
  })

  it('fails on the absolute backstop even when both ratios are perfect', () => {
    // The blind spot this check exists for: a regression in code the fabric and the
    // reference share cancels out of every ratio, so only an absolute number sees it.
    const rung = rungAt(0)
    const measured: GateInput = {
      ...atBaseline(rung.nodes),
      makespan: sample(
        100,
        rung.makespanP50Ms * (2 + PERF_BASELINE.headroom.makespanP50Ms),
        rung.makespanP95Ms,
      ),
    }
    const result = judge({ ...PERF_BASELINE, rungs: [rung] }, [measured])
    expect(kinds(result.findings)).toEqual(['regressed'])
    const finding = result.findings[0]
    expect(finding?.kind === 'regressed' && finding.statistic).toBe('makespan-p50-ms')
  })

  it('reports how far over the baseline the number landed, not merely that it did', () => {
    const line = explain({
      kind: 'regressed',
      nodes: 4,
      statistic: 'coordination-ratio-p95',
      measured: 10,
      baseline: 2.5,
      budget: 6.25,
    })
    expect(line).toContain('4.000×')
    expect(line).toContain('6.250')
  })
})

suite('a rung that quietly disappears is a finding, not a smaller gate', () => {
  it('fails when the baseline names a rung the run did not measure', () => {
    const short = wholeLadderAtBaseline().slice(0, -1)
    const result = judge(PERF_BASELINE, short)
    expect(kinds(result.findings)).toEqual(['unmeasured-rung'])
    // And the gate says so with the rung's identity, since the point is to find it.
    const last = rungAt(PERF_BASELINE.rungs.length - 1)
    expect(verdict(result)).toContain(`${last.nodes} node(s)`)
  })

  it('fails when the run measures a rung the baseline does not name', () => {
    const extra = [...wholeLadderAtBaseline(), { ...atBaseline(1), nodes: 99 }]
    const result = judge(PERF_BASELINE, extra)
    expect(kinds(result.findings)).toEqual(['unbaselined-rung'])
    expect(verdict(result)).toContain('absent from the baseline')
  })
})

suite('an incomplete run is a failure, not a fast one', () => {
  it('fails on incomplete runs even when every timing is at the baseline', () => {
    // `harness.ts` keeps failed runs out of the makespan statistics on purpose, which
    // means a build where shards fail measures *faster*. Without this the gate would
    // reward it.
    const rung = rungAt(0)
    const result = judge({ ...PERF_BASELINE, rungs: [rung] }, [
      { ...atBaseline(rung.nodes), incomplete: 3 },
    ])
    expect(kinds(result.findings)).toEqual(['incomplete-runs'])
    expect(verdict(result)).toContain('did not complete every shard')
  })
})

suite('the committed baseline is internally consistent', () => {
  it('names each rung once and carries both percentiles for it', () => {
    const nodes = PERF_BASELINE.rungs.map((rung) => rung.nodes)
    expect(new Set(nodes).size).toBe(nodes.length)
    for (const rung of PERF_BASELINE.rungs) {
      expect(rung.makespanP95Ms).toBeGreaterThanOrEqual(rung.makespanP50Ms)
      expect(rung.coordinationRatioP95).toBeGreaterThanOrEqual(rung.coordinationRatioP50)
      expect(rung.makespanP50Ms).toBeGreaterThan(0)
      expect(rung.coordinationRatioP50).toBeGreaterThan(0)
    }
  })

  it('carries the provenance a number needs to be re-checkable', () => {
    expect(PERF_BASELINE.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(PERF_BASELINE.machine).toContain('node ')
    expect(PERF_BASELINE.samplesPerRung).toBe(PERF_BASELINE.runsPerRung - 1)
    expect(PERF_BASELINE.samplesPerRung).toBeGreaterThanOrEqual(MIN_RELIABLE_SAMPLES)
  })

  it('keeps every budget above the spread that was actually measured', () => {
    // The structural half of "a threshold tighter than the noise becomes flaky and gets
    // deleted". Tightening a headroom below the observed run-to-run spread now fails
    // here rather than in someone's next unrelated pull request.
    const spread = PERF_BASELINE.observedSpread
    expect(1 + PERF_BASELINE.headroom.coordinationRatioP50).toBeGreaterThan(spread.coordinationRatioP50)
    expect(1 + PERF_BASELINE.headroom.coordinationRatioP95).toBeGreaterThan(spread.coordinationRatioP95)
    expect(1 + PERF_BASELINE.headroom.makespanP50Ms).toBeGreaterThan(spread.makespanP50Ms)
    // The absolute backstop is the one that also has to clear a saturated machine,
    // because that is the condition under which it would otherwise be the first to fire.
    expect(1 + PERF_BASELINE.headroom.makespanP50Ms).toBeGreaterThan(
      spread.underCpuSaturation.makespanP50Ms,
    )
    expect(spread.passes).toBeGreaterThanOrEqual(3)
  })
})
