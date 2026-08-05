import { describe, expect, it } from 'vitest'
import {
  NODE_LADDER,
  RUNS_PER_CONFIG,
  connectivityTax,
  costCrossover,
  measure,
  sweepNodeCount,
} from './harness.ts'
import type {
  JobRunner,
  Observation,
  ReduceObservation,
  RunConfig,
  SweepResult,
} from './harness.ts'
import { hostCount, isSameMachine, machineLabel, renderMarkdown } from './report.ts'
import type { Inventory, Machine, Report } from './report.ts'
import { summarise } from './stats.ts'

/** BENCH-01, BENCH-04, BENCH-05, BENCH-06, BENCH-07. */

const config: RunConfig = {
  nodes: 4,
  shards: 8,
  redundancy: 2,
  transport: 'memory',
  skew: 'uniform',
  driver: 'in-process',
  fixture: 'trivial',
  leg: 'public',
}

/** Plausible non-zero defaults, so a test that cares about a reduce figure sets it. */
const reduce = (overrides: Partial<ReduceObservation> = {}): ReduceObservation => ({
  ok: true,
  reduceMs: 10,
  treeDepth: 2,
  combines: 5,
  recomputes: 0,
  combineExecutors: 2,
  ...overrides,
})

const observation = (overrides: Partial<Observation> = {}): Observation => ({
  makespanMs: 100,
  complete: true,
  grossNodeSeconds: 2,
  usefulNodeSeconds: 1,
  verificationMultiplier: 2,
  speculationMultiplier: 1,
  redispatches: 0,
  codeCache: 'warm',
  reduce: reduce(),
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
      {
        shards: 4,
        redundancy: 1,
        transport: 'memory',
        skew: 'uniform',
        driver: 'in-process',
        fixture: 'trivial',
        leg: 'public',
      },
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

/** A measured reduce leg. `reduceReport(null)` is the *not measured* case. */
const reduceReport = (p50: number | null): SweepResult['reduce'] =>
  p50 === null
    ? { ms: summarise([]), treeDepth: 0, combines: 0, recomputes: 0, combineExecutors: 0 }
    : { ms: summarise([p50]), treeDepth: 2, combines: 5, recomputes: 1, combineExecutors: 3 }

const point = (nodes: number, p50: number, reduceP50: number | null = 10): SweepResult => ({
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
  reduce: reduceReport(reduceP50),
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

  it('refuses two results at one node count rather than keeping the last appended', () => {
    // The silent failure this replaces: `new Map(real.map(…))` keeps whichever entry
    // was appended last, so appending a second driver's curve loses a rung and
    // computes a tax against the survivor with no error anywhere. The two colliding
    // points carry different p50s deliberately — under the old shape the call would
    // have returned a tax, and a tax computed from one of two curves nobody chose
    // between is worse than an exception.
    expect(() => connectivityTax([point(1, 10)], [point(4, 100), point(4, 900)])).toThrow(
      /real curve .* 4/,
    )
    expect(() => connectivityTax([point(4, 10), point(4, 20)], [point(4, 100)])).toThrow(
      /memory curve .* 4/,
    )
  })
})

/** A curve point with its provenance overridden, so a heading's derivation is readable. */
const configured = (base: SweepResult, overrides: Partial<RunConfig>): SweepResult => ({
  ...base,
  config: { ...base.config, ...overrides },
})

/** The single heading line starting with `prefix`, or `undefined` if there is none. */
const headingLine = (markdown: string, prefix: string): string | undefined =>
  markdown.split('\n').find((line) => line.startsWith(prefix))

/**
 * BENCH-07 — provenance is a property of the layout, not of the author remembering.
 *
 * Every assertion here reads the **rendered string**. A column present in the header
 * and absent from the rows, or a heading naming a driver the numbers did not come
 * from, are both invisible to a test that reads the model.
 */
describe('BENCH-07 — every published figure names the driver and fixture it came from', () => {
  // Built inside a function rather than at describe scope: `machine` is declared
  // further down this file, so reading it during registration hits its dead zone.
  const fullReport = (overrides: Partial<Report> = {}): Report => ({
    title: 'Test run',
    at: '2026-08-05T12:00:00.000Z',
    inventory: { machines: [machine('laptop')], nodeCount: 8 } satisfies Inventory,
    baseline: summarise([10]),
    memoryTransport: [point(1, 100), point(2, 90)],
    realTransport: [point(1, 300), point(2, 280)],
    connectivity: connectivityTax([point(1, 100)], [point(1, 300)]),
    crossover: costCrossover(summarise([10]), [point(1, 100)]),
    unmet: [],
    ...overrides,
  })

  const multiProcess = [
    configured(point(1, 40), { driver: 'process-per-node', fixture: 'saturating' }),
  ]

  it('renders no third section at all for a report from before that driver existed', () => {
    const markdown = renderMarkdown(fullReport())
    expect(markdown).not.toContain('process-per-node')
    // Two makespan sections, not three, and no empty table standing in for one.
    expect(markdown.split('## Makespan').length - 1).toBe(2)
  })

  it('names the process-per-node driver in its own makespan heading and on every row', () => {
    const markdown = renderMarkdown(fullReport({ multiProcess }))
    expect(markdown).toContain('## Makespan — real transport, process-per-node driver')
    // The heading and the row are asserted separately on purpose: a driver cell
    // deleted from the row template leaves the heading assertion passing.
    expect(markdown).toContain('| 1 | process-per-node | saturating |')
  })

  it('carries a driver cell and a fixture cell on every makespan row of every curve', () => {
    const markdown = renderMarkdown(fullReport({ multiProcess }))
    const rows = markdown
      .split('\n')
      .filter((line) => /^\| \d+ \| (in-process|process-per-node) \|/.test(line))
    // Two memory rungs, two real rungs, one multi-process rung.
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row).toMatch(/^\| \d+ \| (in-process|process-per-node) \| (trivial|saturating) \|/)
    }
  })

  it('keeps the header, the alignment row and every body row on one column count', () => {
    // A table whose header and body disagree on column count renders as garbage in
    // every Markdown viewer, and no assertion on the model would see it.
    const markdown = renderMarkdown(fullReport({ multiProcess }))
    const start = markdown.indexOf('| nodes | driver | fixture |')
    expect(start).toBeGreaterThanOrEqual(0)
    const table = markdown
      .slice(start)
      .split('\n')
      .filter((line) => line.startsWith('|'))
    const widths = new Set(table.slice(0, 4).map((line) => line.split('|').length))
    expect([...widths]).toHaveLength(1)
  })

  it('derives the tax, crossover and memory-reduce headings from the memory curve', () => {
    const saturating: readonly SweepResult[] = [
      configured(point(1, 100), { fixture: 'saturating' }),
      configured(point(2, 90), { fixture: 'saturating' }),
    ]
    const a = renderMarkdown(fullReport())
    const b = renderMarkdown(fullReport({ memoryTransport: saturating }))
    for (const prefix of [
      '## Connectivity tax',
      '## COST crossover',
      '## Reduce tree — memory transport',
    ]) {
      expect(headingLine(a, prefix)).toBeDefined()
      // A literal in place of the derivation makes these two equal.
      expect(headingLine(a, prefix)).not.toEqual(headingLine(b, prefix))
    }
  })

  it('derives the exclusion and real-reduce headings from the real curve', () => {
    // A report with no exclusions emits no such section at all, so this one needs one.
    const excluded = [{ config: 'real transport, 16 nodes', reason: 'a stated reason' }]
    const spawned: readonly SweepResult[] = [
      configured(point(1, 300), { driver: 'process-per-node' }),
      configured(point(2, 280), { driver: 'process-per-node' }),
    ]
    const a = renderMarkdown(fullReport({ excluded }))
    const b = renderMarkdown(fullReport({ excluded, realTransport: spawned }))
    for (const prefix of ['## Configurations excluded, and why', '## Reduce tree — real transport']) {
      expect(headingLine(a, prefix)).toBeDefined()
      expect(headingLine(a, prefix)).not.toEqual(headingLine(b, prefix))
    }
  })

  it('falls back to the memory curve for the exclusion heading when every real rung failed', () => {
    // A rung reaches `excluded` precisely by failing, so the run this heading most
    // matters in is the one whose `realTransport` is empty.
    const markdown = renderMarkdown(
      fullReport({
        realTransport: [],
        excluded: [{ config: 'real transport, 16 nodes', reason: 'a stated reason' }],
      }),
    )
    expect(headingLine(markdown, '## Configurations excluded, and why')).toBe(
      '## Configurations excluded, and why — in-process driver, trivial fixture',
    )
  })

  it('says `no runs` rather than interpolating undefined when the curve is empty', () => {
    const markdown = renderMarkdown(
      fullReport({
        memoryTransport: [],
        realTransport: [],
        connectivity: [],
        crossover: costCrossover(summarise([10]), []),
        excluded: [{ config: 'real transport, 16 nodes', reason: 'a stated reason' }],
      }),
    )
    expect(headingLine(markdown, '## Connectivity tax')).toBe('## Connectivity tax — no runs')
    expect(headingLine(markdown, '## COST crossover')).toBe('## COST crossover — no runs')
    expect(headingLine(markdown, '## Configurations excluded, and why')).toBe(
      '## Configurations excluded, and why — no runs',
    )
    expect(markdown).not.toContain('undefined')
  })
})

describe('the reduce is measured beside makespan, never inside it', () => {
  it('counts only completed runs in the reduce timing, the same rule makespan follows', async () => {
    const runner = scripted([
      observation({ reduce: reduce({ reduceMs: 10 }) }),
      observation({ complete: false, reduce: reduce({ reduceMs: 11 }) }),
      observation({ reduce: reduce({ reduceMs: 12 }) }),
    ])
    const result = await measure(runner, config, { runs: 3, separateColdStart: false })

    // Hand-computed: three runs, one incomplete, so two enter the reduce timing.
    expect(result.reduce.ms.n).toBe(2)
    expect(result.incomplete).toBe(1)
  })

  it('keeps the makespan sample when a reduce failed on an otherwise complete run', async () => {
    // The assertion that keeps the two populations apart. An implementation that
    // coupled `complete` to the reduce fails this — and it fails on the FIRST number,
    // which is why both are asserted in one `it`: asserting only `reduce.ms.n` would
    // pass under the coupling too.
    const runner = scripted([
      observation({ reduce: reduce({ ok: true, reduceMs: 10 }) }),
      observation({ reduce: reduce({ ok: false, reduceMs: 0 }) }),
      observation({ reduce: reduce({ ok: true, reduceMs: 12 }) }),
    ])
    const result = await measure(runner, config, { runs: 3, separateColdStart: false })

    expect(result.makespan.n).toBe(3)
    expect(result.incomplete).toBe(0)
    expect(result.reduce.ms.n).toBe(2)
  })

  it('excludes the cold-cache iteration from the reduce exactly as from makespan', async () => {
    const runner = scripted([
      observation({ reduce: reduce({ reduceMs: 900 }) }), // cold
      observation({ reduce: reduce({ reduceMs: 10 }) }),
      observation({ reduce: reduce({ reduceMs: 10 }) }),
      observation({ reduce: reduce({ reduceMs: 10 }) }),
    ])
    const result = await measure(runner, config, { runs: 4 })

    expect(result.makespan.n).toBe(3)
    expect(result.reduce.ms.n).toBe(3)
    expect(result.reduce.ms.max).toBe(10)
  })

  it('takes the max of the derived counts and the sum of the recomputes, never a mean', async () => {
    // Values chosen so a mean gives a different answer for both: combines mean is
    // (3+5+4)/3 = 4, max is 5; recomputes mean is (2+3+4)/3 = 3, sum is 9.
    const runner = scripted([
      observation({ reduce: reduce({ treeDepth: 1, combines: 3, recomputes: 2, combineExecutors: 1 }) }),
      observation({ reduce: reduce({ treeDepth: 2, combines: 5, recomputes: 3, combineExecutors: 4 }) }),
      observation({ reduce: reduce({ treeDepth: 2, combines: 4, recomputes: 4, combineExecutors: 2 }) }),
    ])
    const result = await measure(runner, config, { runs: 3, separateColdStart: false })

    expect(result.reduce.combines).toBe(5)
    expect(result.reduce.recomputes).toBe(9)
    expect(result.reduce.treeDepth).toBe(2)
    expect(result.reduce.combineExecutors).toBe(4)
  })

  it('reports no reduce measurement at all when every reduce failed', async () => {
    const runner = scripted([observation({ reduce: reduce({ ok: false }) })])
    const result = await measure(runner, config, { runs: 3, separateColdStart: false })
    expect(result.reduce.ms.n).toBe(0)
    // …and the map is untouched: three complete runs, none of them incomplete.
    expect(result.makespan.n).toBe(3)
    expect(result.incomplete).toBe(0)
  })
})

describe('an unmeasured reduce renders as unmeasured, not as a zero', () => {
  // Built inside the helper, not at describe scope: `machine` is declared further
  // down this file, so reading it during registration would hit its temporal dead zone.
  const reportWith = (memory: readonly SweepResult[]): string =>
    renderMarkdown({
      title: 'Test run',
      at: '2026-07-31T12:00:00.000Z',
      inventory: { machines: [machine('laptop')], nodeCount: 8 } satisfies Inventory,
      baseline: summarise([10]),
      memoryTransport: memory,
      realTransport: [],
      connectivity: [],
      crossover: costCrossover(summarise([10]), [...memory]),
      unmet: [],
    })

  it('em-dashes every reduce cell of a rung whose reduce was never measured', () => {
    const markdown = reportWith([point(4, 100, null)])
    // A zero here would read as "the reduce ran and did nothing" — a different claim.
    expect(markdown).toContain('| 4 | — | — | — | — | — | — |')
  })

  it('leaves the makespan row of that same rung populated', () => {
    // The third and worst claim would be an evacuated makespan row: a failed
    // aggregation is not a failed map.
    const markdown = reportWith([point(4, 100, null)])
    const makespanRow = markdown
      .split('\n')
      .find((line) => line.startsWith('| 4 |') && line.includes('ms'))
    expect(makespanRow).toBeDefined()
    expect(makespanRow).toContain('100.0ms')
  })

  it('emits a reduce table per transport, each carrying the machine label', () => {
    const markdown = reportWith([point(1, 100)])
    expect(markdown).toContain('## Reduce tree — memory transport (SAME-MACHINE')
    expect(markdown).toContain('## Reduce tree — real transport (SAME-MACHINE')
    expect(markdown).toContain(
      '| nodes | reduce p50 | reduce p95 | tree depth | combines | recomputes | combine executors |',
    )
  })

  it('says `_no runs_` for a transport with no rungs, matching the makespan table', () => {
    const markdown = reportWith([point(1, 100)])
    // `realTransport` is empty above, so both its tables must say so rather than
    // rendering an empty table a reader would take for a measured absence.
    const afterRealReduce = markdown.slice(markdown.indexOf('## Reduce tree — real transport'))
    expect(afterRealReduce).toContain('_no runs_')
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

/**
 * The units a label is allowed to name, each mapped to the value it must carry.
 *
 * `Inventory` counts two things, so a label may name two things. Singular and plural are
 * both listed because the label pluralises and a reading that missed `1 host` would let
 * half the label through unchecked.
 */
function countedUnits(inventory: Inventory): ReadonlyMap<string, number> {
  return new Map([
    ['node', inventory.nodeCount],
    ['nodes', inventory.nodeCount],
    ['host', hostCount(inventory)],
    ['hosts', hostCount(inventory)],
  ])
}

/** Every `<number> <word>` pair a label states, in order. */
function quantities(label: string): readonly (readonly [number, string])[] {
  return [...label.matchAll(/(\d+)\s+([A-Za-z]+)/g)].map(
    (match) => [Number(match[1]), (match[2] as string).toLowerCase()] as const,
  )
}

describe('BENCH-06 — the same-machine label is derived, not declared', () => {
  it('labels many nodes on one host as what they are', () => {
    const inventory: Inventory = { machines: [machine('laptop')], nodeCount: 16 }
    expect(isSameMachine(inventory)).toBe(true)
    expect(machineLabel(inventory)).toBe(
      'SAME-MACHINE: 16 nodes on 1 host — a node count, not a machine count',
    )
  })

  /**
   * **The reading that would have caught the 2026-08-04 noun swap.**
   *
   * The label read `16 processes on 1 host — not 16 nodes` from `677a6d2` (2026-07-26,
   * the commit that introduced it) until 2026-08-04, while the only quantity anyone had
   * counted was `nodeCount` — and it went into the published run of 2026-08-01 in five
   * places. The two assertions that stood here could not catch it: one asked for the
   * substring `SAME-MACHINE` and the other for `not 16 nodes`, so both were satisfied *by
   * the falsehood itself* — the second was pinning it.
   *
   * So this reads structurally rather than by substring: pull every `<number> <unit>` pair
   * out of the label and require each unit to be one the inventory actually carries, with
   * the number it actually holds. A unit nothing counts fails whatever value follows it,
   * which is the general form of the defect and not a ban on one word; a counted unit
   * carrying the wrong number fails too. The `— a node count, not a machine count` clause
   * is deliberately numeral-free: a denial is not a count, and giving it a numeral would
   * make it indistinguishable here from a claim.
   */
  it('names no unit the inventory never counted', () => {
    const inventories: readonly Inventory[] = [
      { machines: [machine('laptop')], nodeCount: 16 },
      { machines: [machine('laptop')], nodeCount: 1 },
      { machines: [machine('laptop'), machine('phone'), machine('relay', ['relay'])], nodeCount: 3 },
    ]

    for (const inventory of inventories) {
      const label = machineLabel(inventory)
      const counted = countedUnits(inventory)
      const stated = quantities(label)
      // Anti-vacuity: a label with no numerals in it would pass the loop below without
      // ever reading `counted`, so the loop's silence has to mean something first.
      expect(stated.length).toBeGreaterThan(0)

      const asStated = stated.map(([value, unit]) => `${value} ${unit}`)
      const asCounted = stated.map(([value, unit]) => {
        const actual = counted.get(unit)
        if (actual === undefined) return `${value} ${unit} ← nothing in this run counted ${unit}`
        return `${actual} ${unit}`
      })
      expect(asCounted).toEqual(asStated)
    }
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
