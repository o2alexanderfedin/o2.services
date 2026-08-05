import { describe, expect, it } from 'vitest'
import {
  HarnessIntegrityError,
  MAX_DRIVER_CPU_SHARE,
  assertIntegrity,
  cpuAttributionViolations,
  fixtureProvenanceViolations,
  fixtureUniformityViolations,
  processIdentityViolations,
} from './integrity.ts'
import type {
  AgentIdentity,
  CpuAttribution,
  FixtureProvenance,
  FixtureUniformity,
  ProcessIdentity,
} from './integrity.ts'

/**
 * BENCH-07 — the harness integrity gate, proved by planting.
 *
 * Every case here derives from a clean fixture by changing **one** thing, and asserts
 * the resulting list with `toEqual` rather than `toContain`. That is what makes each
 * planted case the control for the others: a check that fired on somebody else's plant
 * would show up as an extra entry in a list nobody expected it in.
 *
 * The idiom is `vocabulary.node.test.ts`'s — synthetic inputs, one defect at a time,
 * equality over the finding list — and it is used here for the same reason. Nothing in
 * CI runs `bin/bench.ts`, so these functions have no execution anywhere that would show
 * them working; a planted input is the only proof available that they can report at all.
 *
 * **Where a single-field change trips two readings, both are asserted and the reason is
 * written beside the case.** Contorting the fixture until every plant produced exactly
 * one entry would have hidden a real interaction between the cardinality checks, which
 * is the opposite of what an equality assertion is for.
 */

/** Four agents, four executors, one submitter, nothing wrong. */
const AGENTS: readonly AgentIdentity[] = [
  { childPid: 101, announcedPid: 101, peerId: '12D3KooWaaa' },
  { childPid: 102, announcedPid: 102, peerId: '12D3KooWbbb' },
  { childPid: 103, announcedPid: 103, peerId: '12D3KooWccc' },
  { childPid: 104, announcedPid: 104, peerId: '12D3KooWddd' },
]

const cleanIdentity = (): ProcessIdentity => ({
  expected: 4,
  driverPid: 999,
  agents: AGENTS,
  executorNodeIds: AGENTS.map((agent) => agent.peerId),
  submitterPeerId: '12D3KooWsubmitter',
})

/** The clean fixture with one field replaced — the only way a plant is built here. */
const planted = (overrides: Partial<ProcessIdentity>): ProcessIdentity => ({
  ...cleanIdentity(),
  ...overrides,
})

describe('a rung that did not spawn what it says it spawned is not a rung', () => {
  it('says nothing about a fabric whose processes, pids and executors all agree', () => {
    // The control. If this is ever non-empty, every plant below is meaningless.
    expect(processIdentityViolations(cleanIdentity())).toEqual([])
  })

  it('reports an agent list that does not match the rung', () => {
    const violations = processIdentityViolations(
      planted({
        agents: [...AGENTS, { childPid: 105, announcedPid: 105, peerId: '12D3KooWeee' }],
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('5')
    expect(violations[0]).toContain('4')
  })

  it('reports a short agent list on both cardinality readings, which is correct', () => {
    // A fabric that spawned one process too few also built one executor too few, so
    // both counts are wrong and both say so. This is the realistic shape of a partial
    // stand-up, and reporting it twice is more use than reporting it once.
    const short = AGENTS.slice(0, 3)
    const violations = processIdentityViolations(
      planted({ agents: short, executorNodeIds: short.map((agent) => agent.peerId) }),
    )
    expect(violations).toHaveLength(2)
    for (const violation of violations) expect(violation).toContain('3')
  })

  it('reports a repeated process id', () => {
    // Both halves of the duplicated agent read the same pid: a process observed twice
    // announces itself consistently, which is exactly why distinctness is a separate
    // reading from the announcement check below.
    const violations = processIdentityViolations(
      planted({
        agents: [
          ...AGENTS.slice(0, 3),
          { childPid: 101, announcedPid: 101, peerId: '12D3KooWddd' },
        ],
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('101')
  })

  it("reports the driver's own process id among the children it spawned", () => {
    const violations = processIdentityViolations(
      planted({
        agents: [
          ...AGENTS.slice(0, 3),
          { childPid: 999, announcedPid: 999, peerId: '12D3KooWddd' },
        ],
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('999')
  })

  it('reports an announced pid that is not the pid of the process that was spawned', () => {
    // `child.pid` proves a process was spawned. It does not prove the process that
    // announced the address is that process, and this is the only reading that does.
    const violations = processIdentityViolations(
      planted({
        agents: [
          ...AGENTS.slice(0, 3),
          { childPid: 104, announcedPid: 4242, peerId: '12D3KooWddd' },
        ],
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('4242')
    expect(violations[0]).toContain('104')
  })

  it('reports an executor addressing a node no observed agent announced', () => {
    const violations = processIdentityViolations(
      planted({
        executorNodeIds: ['12D3KooWaaa', '12D3KooWbbb', '12D3KooWccc', '12D3KooWghost'],
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('12D3KooWghost')
  })

  it('reports the submitting node among its own executors', () => {
    const violations = processIdentityViolations(
      planted({
        executorNodeIds: ['12D3KooWaaa', '12D3KooWbbb', '12D3KooWccc', '12D3KooWsubmitter'],
      }),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('12D3KooWsubmitter')
  })

  /**
   * The two cardinality readings, and the reason they are not decoration.
   *
   * `executorNodeIds: []` satisfies "no executor addresses an unannounced node" and
   * "the submitter is not among the executors" **vacuously**. Without a count, an
   * instrument that read nothing is indistinguishable from a clean rung — and an
   * absent instrument is the more likely of the two, because that is what a wiring
   * slip looks like.
   */
  it('reports a fabric that built no executors, which every membership check passes', () => {
    const violations = processIdentityViolations(planted({ executorNodeIds: [] }))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('0')
    expect(violations[0]).toContain('4')
  })

  it('reports a fabric that observed no agents at all', () => {
    // One change in substance — the fabric saw nothing — and both cardinality
    // readings say so. Neither is redundant: the agent reading names an absent
    // instrument, the executor reading names an empty fabric.
    const violations = processIdentityViolations(planted({ agents: [], executorNodeIds: [] }))
    expect(violations).toHaveLength(2)
    expect(violations.join(' ')).toContain('no agent')
  })
})

const cleanCpu = (): CpuAttribution => ({ driverCpuMs: 40, shardComputeMs: 4000 })

describe('a driver that did the work itself did not measure a fabric', () => {
  it('says nothing when the driver is a small fraction of what it dispatched', () => {
    expect(cpuAttributionViolations(cleanCpu())).toEqual([])
  })

  it('reports a driver whose own CPU time reaches the declared ceiling', () => {
    // The falsifier that does not depend on the harness telling the truth about its
    // own process table: a silent in-process fallback keeps the work in this process.
    const violations = cpuAttributionViolations({ driverCpuMs: 2000, shardComputeMs: 4000 })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('0.5')
  })

  it('honours a supplied ceiling in place of the declared one', () => {
    expect(cpuAttributionViolations({ ...cleanCpu(), maxShare: 0.001 })).toHaveLength(1)
    expect(MAX_DRIVER_CPU_SHARE).toBe(0.5)
  })

  it('reports a shard compute total that read nothing, separately from the ratio', () => {
    const violations = cpuAttributionViolations({ driverCpuMs: 40, shardComputeMs: 0 })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('shard compute')
  })

  it("reports a driver CPU delta that read nothing, separately again", () => {
    // Two readings rather than one, because a zero numerator and a zero denominator
    // are different failures — and with neither, a run in which both are zero divides
    // nothing by nothing and passes the ceiling check.
    const violations = cpuAttributionViolations({ driverCpuMs: 0, shardComputeMs: 4000 })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('driver')
  })
})

/** Sixteen entries, because `SHARDS` is 16. A vector of eight tests nothing this phase runs. */
const cleanUniformity = (): FixtureUniformity => ({
  statuses: Array.from({ length: 16 }, () => 'budget'),
  expected: 'budget',
  shards: 16,
})

describe('a fixture whose shards did not all spend their budget is not a parallelism measurement', () => {
  it('says nothing about sixteen shards that all spent it', () => {
    expect(fixtureUniformityViolations(cleanUniformity())).toEqual([])
  })

  it('reports a single shard that ended some other way, naming the vector', () => {
    const statuses = [...cleanUniformity().statuses]
    statuses[7] = 'found'
    const violations = fixtureUniformityViolations({ ...cleanUniformity(), statuses })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('found')
  })

  it('reports a vector shorter than the shard count', () => {
    const violations = fixtureUniformityViolations({
      ...cleanUniformity(),
      statuses: cleanUniformity().statuses.slice(0, 15),
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('15')
    expect(violations[0]).toContain('16')
  })

  it('reports an empty vector as an unread instrument rather than as uniformity', () => {
    // Every status in an empty vector equals the expected one. That is the vacuous
    // pass this reading exists to refuse.
    const violations = fixtureUniformityViolations({ ...cleanUniformity(), statuses: [] })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('empty')
  })
})

const TRIVIAL_CID = 'bafyreitrivial'
const SATURATING_CID = 'bafyreisaturating'

const cleanProvenance = (): FixtureProvenance => ({
  declared: 'saturating',
  moduleCid: SATURATING_CID,
  expected: { trivial: TRIVIAL_CID, saturating: SATURATING_CID },
})

describe('a rung cannot declare a fixture it did not dispatch', () => {
  it('says nothing when the bytes dispatched are the bytes the declaration names', () => {
    expect(fixtureProvenanceViolations(cleanProvenance())).toEqual([])
  })

  it('reports a declaration that does not match the module the rung dispatched', () => {
    // The wiring slip this closes produces a fast, flat curve with the word
    // `saturating` printed beside it. `RunConfig.fixture` is filled in by the call
    // site, so every heading, column and ratio downstream inherits whatever the
    // caller typed; comparing CIDs is the only reading that is a fact about bytes.
    const violations = fixtureProvenanceViolations({
      ...cleanProvenance(),
      moduleCid: TRIVIAL_CID,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(TRIVIAL_CID)
    expect(violations[0]).toContain(SATURATING_CID)
    expect(violations[0]).toContain('saturating')
  })

  it('reports a declared fixture that has no registered module CID at all', () => {
    const violations = fixtureProvenanceViolations({
      ...cleanProvenance(),
      declared: 'colouring',
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('colouring')
  })
})

describe('the gate is one function, so turning it off is one deletion', () => {
  it('throws on a non-empty list', () => {
    expect(() => assertIntegrity('process-per-node, 8 nodes', ['a violation'])).toThrow(
      HarnessIntegrityError,
    )
  })

  it('returns silently on an empty one', () => {
    expect(() => assertIntegrity('process-per-node, 8 nodes', [])).not.toThrow()
  })

  it('names the rung and the violations in the message, and carries both as fields', () => {
    // Callers branch on `instanceof` and on the fields; the message is for the human
    // reading a failed run, which is the only place this ever fires.
    const error = new HarnessIntegrityError({
      at: 'process-per-node, 8 nodes',
      violations: ['3 agent processes were observed where the rung declares 8'],
    })
    expect(error.name).toBe('HarnessIntegrityError')
    expect(error.at).toBe('process-per-node, 8 nodes')
    expect(error.violations).toHaveLength(1)
    expect(error.message).toContain('process-per-node, 8 nodes')
    expect(error.message).toContain('3 agent processes were observed')
  })
})
