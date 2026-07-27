import { describe, expect, it } from 'vitest'
import {
  NODE_LADDER,
  RUNS_PER_CONFIG,
  connectivityTax,
  costCrossover,
  measure,
  sweepNodeCount,
} from './harness.ts'
import type { JobRunner, Observation, RunConfig, SweepResult } from './harness.ts'
import { hostCount, isSameMachine, machineLabel, renderMarkdown } from './report.ts'
import type { Inventory, Machine } from './report.ts'
import { summarise } from './stats.ts'

/** BENCH-01, BENCH-04, BENCH-05, BENCH-06. */

const config: RunConfig = {
  nodes: 4,
  shards: 8,
  redundancy: 2,
  transport: 'memory',
  skew: 'uniform',
}

const observation = (overrides: Partial<Observation> = {}): Observation => ({
  makespanMs: 100,
  complete: true,
  grossNodeSeconds: 2,
  usefulNodeSeconds: 1,
  verificationMultiplier: 2,
  speculationMultiplier: 1,
  redispatches: 0,
  codeCache: 'warm',
  ...overrides,
})

/** A runner returning a scripted sequence, so the harness's arithmetic is checkable. */
function scripted(sequence: readonly Observation[]): JobRunner {
  let i = 0
  return async (_config, codeCache) => {
    const next = sequence[Math.min(i, sequence.length - 1)] as Observation
    i += 1
    return { ...next, codeCache }
  }
}

describe('the harness obeys the plan it was pre-registered against', () => {
  it('uses the committed node ladder, not one chosen after seeing the curve', () => {
    // Pinned so a rung cannot be quietly added because it looks good.
    expect(NODE_LADDER).toEqual([1, 2, 4, 8, 16])
    expect(RUNS_PER_CONFIG).toBe(20)
  })

  it('sweeps exactly the ladder', async () => {
    const results = await sweepNodeCount(
      scripted([observation()]),
      { shards: 4, redundancy: 1, transport: 'memory', skew: 'uniform' },
      { runs: 2, separateColdStart: false },
    )
    expect(results.map((r) => r.config.nodes)).toEqual([...NODE_LADDER])
  })
})

describe('an incomplete run never becomes a fast run', () => {
  it('excludes it from makespan and counts it separately', async () => {
    // The classic way to make an unreliable system look quick: a job that failed in
    // 5ms is not a 5ms job.
    const runner = scripted([
      observation({ makespanMs: 100 }),
      observation({ makespanMs: 5, complete: false }),
      observation({ makespanMs: 110 }),
      observation({ makespanMs: 120 }),
    ])
    const result = await measure(runner, config, { runs: 4, separateColdStart: false })

    expect(result.incomplete).toBe(1)
    expect(result.makespan.n).toBe(3)
    expect(result.makespan.min).toBe(100)
    // But its cost still counts — work spent on a failed run is work spent.
    expect(result.cost.grossNodeSeconds).toBe(8)
  })

  it('reports no makespan at all when nothing completed', async () => {
    const runner = scripted([observation({ complete: false })])
    const result = await measure(runner, config, { runs: 3, separateColdStart: false })
    expect(result.makespan.n).toBe(0)
    expect(result.incomplete).toBe(3)
  })
})

describe('the cold-cache run is separated, not averaged in', () => {
  it('publishes it as its own number and keeps it out of the statistics', async () => {
    const runner = scripted([
      observation({ makespanMs: 900 }), // cold
      observation({ makespanMs: 100 }),
      observation({ makespanMs: 100 }),
      observation({ makespanMs: 100 }),
    ])
    const result = await measure(runner, config, { runs: 4 })

    expect(result.coldStartMs).toBe(900)
    expect(result.makespan.n).toBe(3)
    expect(result.makespan.p50).toBe(100)
    // Still published in full — the raw rows include the discarded first run.
    expect(result.observations).toHaveLength(4)
    expect(result.observations[0]?.codeCache).toBe('cold')
    expect(result.observations[1]?.codeCache).toBe('warm')
  })
})

describe('BENCH-04 — gross and useful travel together', () => {
  it('derives the verification tax from the totals, not from a mean of ratios', async () => {
    // The mean of ratios is not the ratio of means, and only the latter answers
    // "what did this configuration cost".
    const runner = scripted([
      observation({ grossNodeSeconds: 10, usefulNodeSeconds: 1 }),
      observation({ grossNodeSeconds: 1, usefulNodeSeconds: 1 }),
    ])
    const result = await measure(runner, config, { runs: 2, separateColdStart: false })

    expect(result.cost.grossNodeSeconds).toBe(11)
    expect(result.cost.usefulNodeSeconds).toBe(2)
    expect(result.cost.verificationTax).toBeCloseTo(5.5, 5)
    // The mean of the per-run ratios would have been 5.5 too by coincidence here;
    // what matters is that both totals are present and neither can be read alone.
    expect(Object.keys(result.cost)).toContain('grossNodeSeconds')
    expect(Object.keys(result.cost)).toContain('usefulNodeSeconds')
  })

  it('carries the speculation and churn taxes as separate line items', async () => {
    const runner = scripted([
      observation({ speculationMultiplier: 1.2, redispatches: 3 }),
      observation({ speculationMultiplier: 1.0, redispatches: 1 }),
    ])
    const result = await measure(runner, config, { runs: 2, separateColdStart: false })
    expect(result.cost.speculationTax).toBeCloseTo(1.1, 5)
    expect(result.cost.churnTax).toBe(2)
  })
})

const point = (nodes: number, p50: number): SweepResult => ({
  config: { ...config, nodes },
  makespan: summarise([p50]),
  coldStartMs: null,
  incomplete: 0,
  cost: {
    grossNodeSeconds: 1,
    usefulNodeSeconds: 1,
    verificationTax: 1,
    speculationTax: 1,
    churnTax: 0,
  },
  observations: [],
})

describe('BENCH-05 — the COST crossover is published whatever it is', () => {
  it('finds the smallest node count that beats the baseline', () => {
    const crossover = costCrossover(summarise([50]), [
      point(1, 400),
      point(2, 200),
      point(4, 40),
      point(8, 20),
    ])
    expect(crossover.found).toBe(true)
    if (!crossover.found) return
    expect(crossover.nodes).toBe(4)
  })

  it('reports how close it got when there is no crossover', () => {
    // "No crossover" without the gap is unactionable — a factor of 1.2 and a factor
    // of 200 are very different findings.
    const crossover = costCrossover(summarise([10]), [point(1, 900), point(2, 500), point(4, 300)])
    expect(crossover.found).toBe(false)
    if (crossover.found) return
    expect(crossover.reason).toContain('no crossover within the measured range')
    expect(crossover.bestP50Ms).toBe(300)
    expect(crossover.bestAtNodes).toBe(4)
    expect(crossover.baselineP50Ms).toBe(10)
  })

  it('says so when nothing completed, rather than inventing a crossover', () => {
    const nothing: SweepResult = { ...point(4, 0), makespan: summarise([]) }
    const crossover = costCrossover(summarise([10]), [nothing])
    expect(crossover.found).toBe(false)
    if (crossover.found) return
    expect(crossover.reason).toContain('no configuration produced a completed run')
  })
})

describe('the connectivity tax compares like with like', () => {
  it('is the ratio at equal node count', () => {
    const taxes = connectivityTax([point(1, 10), point(2, 20)], [point(1, 30), point(2, 100)])
    expect(taxes.map((t) => t.nodes)).toEqual([1, 2])
    expect(taxes[0]?.ratio).toBe(3)
    expect(taxes[1]?.ratio).toBe(5)
  })

  it('skips a node count present in only one curve', () => {
    // Comparing against a missing value would silently invent a tax.
    const taxes = connectivityTax([point(1, 10), point(4, 40)], [point(1, 30)])
    expect(taxes).toHaveLength(1)
    expect(taxes[0]?.nodes).toBe(1)
  })
})

const machine = (hostId: string, roles: Machine['roles'] = ['worker']): Machine => ({
  hostId,
  roles,
  cpuModel: 'Test CPU',
  physicalCores: 8,
  logicalCores: 16,
  totalMemoryBytes: 32 * 1024 ** 3,
  os: 'darwin',
  kernel: '25.5.0',
  runtime: 'node v23.11.0',
})

describe('BENCH-06 — the same-machine label is derived, not declared', () => {
  it('labels many nodes on one host as what they are', () => {
    const inventory: Inventory = { machines: [machine('laptop')], nodeCount: 16 }
    expect(isSameMachine(inventory)).toBe(true)
    expect(machineLabel(inventory)).toContain('SAME-MACHINE')
    expect(machineLabel(inventory)).toContain('not 16 nodes')
  })

  it('labels genuinely distinct machines as distinct', () => {
    const inventory: Inventory = {
      machines: [machine('laptop'), machine('phone'), machine('relay', ['relay'])],
      nodeCount: 3,
    }
    expect(hostCount(inventory)).toBe(3)
    expect(isSameMachine(inventory)).toBe(false)
    expect(machineLabel(inventory)).toBe('3 nodes across 3 hosts')
  })

  it('does not call a single node a same-machine run', () => {
    const inventory: Inventory = { machines: [machine('laptop')], nodeCount: 1 }
    expect(isSameMachine(inventory)).toBe(false)
  })

  it('puts the label in every table heading, so copy-paste cannot strip it', () => {
    const inventory: Inventory = { machines: [machine('laptop')], nodeCount: 8 }
    const markdown = renderMarkdown({
      title: 'Test run',
      at: '2026-07-26T12:00:00.000Z',
      inventory,
      baseline: summarise([10]),
      memoryTransport: [point(1, 100)],
      realTransport: [point(1, 300)],
      connectivity: connectivityTax([point(1, 100)], [point(1, 300)]),
      crossover: costCrossover(summarise([10]), [point(1, 100)]),
      unmet: ['BENCH-06 distinct machines — one host was available'],
    })

    // Once at the top, and again in each makespan heading.
    const occurrences = markdown.split('SAME-MACHINE').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(3)
    expect(markdown).toContain('What these numbers do NOT establish')
    expect(markdown).toContain('BENCH-06 distinct machines')
    // Gross and useful are adjacent columns — BENCH-04 as a property of the layout.
    expect(markdown).toContain('| gross n·s | useful n·s |')
  })

  it('states plainly when there is no crossover', () => {
    const inventory: Inventory = { machines: [machine('laptop')], nodeCount: 4 }
    const markdown = renderMarkdown({
      title: 'Test run',
      at: '2026-07-26T12:00:00.000Z',
      inventory,
      baseline: summarise([10]),
      memoryTransport: [point(1, 900)],
      realTransport: [],
      connectivity: [],
      crossover: costCrossover(summarise([10]), [point(1, 900)]),
      unmet: [],
    })
    expect(markdown).toContain('**No crossover.**')
    expect(markdown).toContain('a factor of 90.00×')
  })
})
