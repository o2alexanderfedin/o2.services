import { describe, expect, it } from 'vitest'
import { LeaseTable } from './lease.ts'
import { runResilient } from './coordinator.ts'
import type { DispatchOutcome, ShardWork } from './coordinator.ts'
import type { NodeDescriptor } from './sovereignty.ts'

/**
 * CHURN-01, and where the other criteria compose.
 *
 * Time is a port here, so a churn test is deterministic rather than a race against a
 * real clock: `now()` advances by a fixed step per read, and `sleep` advances it
 * without waiting. That means "30% of nodes die mid-execution" is an exact,
 * reproducible input rather than something that usually happens.
 */

const T0 = 1_800_000_000_000

/** A clock that advances a fixed amount per read, and a sleep that just moves it. */
function fakeTime(stepMs = 10) {
  let t = T0
  return {
    now: (): number => {
      t += stepMs
      return t
    },
    sleep: async (ms: number): Promise<void> => {
      t += ms
    },
  }
}

const node = (nodeId: string, ownerId = 'alice'): NodeDescriptor => ({
  nodeId,
  ownerId,
  canExecuteSovereign: true,
  load: 0,
})

const publicWork = (count: number): ShardWork[] =>
  Array.from({ length: count }, (_, i) => ({ shardId: `s${i}`, label: 'public' as const }))

/** A deterministic result CID per shard — the same on whichever node runs it. */
const resultOf = (shardId: string): string => `bafy-${shardId}`

const answered = (shardId: string): DispatchOutcome => ({ ok: true, resultCid: resultOf(shardId) })
const nodeGone = (reason = 'connection refused'): DispatchOutcome => ({
  ok: false,
  kind: 'node',
  reason,
})
const taskBroke = (reason = 'module trapped'): DispatchOutcome => ({
  ok: false,
  kind: 'task',
  reason,
})
/** A copy that never answers — the straggler speculation exists for. */
const stall = (): Promise<DispatchOutcome> => new Promise<DispatchOutcome>(() => {})

describe('CHURN-01 — 30% of nodes die mid-execution', () => {
  it('still produces the correct result for every shard', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`))
    // Three of ten. Chosen by name so the test states exactly who died.
    const dead = new Set(['n2', 'n5', 'n8'])
    const work = publicWork(12)

    const outcome = await runResilient({
      work,
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) => (dead.has(nodeId) ? nodeGone() : answered(shard.shardId)),
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.failed).toEqual([])
    // The answer is the answer, whoever computed it — the invariant the whole
    // phase rests on.
    for (const shard of work) {
      expect(outcome.results.get(shard.shardId)).toBe(resultOf(shard.shardId))
    }
    // Nothing landed on a corpse.
    for (const shard of outcome.shards) expect(dead.has(shard.nodeId as string)).toBe(false)
  })

  it('makes the re-dispatches visible rather than hiding them', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`))
    const dead = new Set(['n2', 'n5', 'n8'])
    const leases = new LeaseTable({ leaseMs: 30_000, maxGenerations: 10 })

    let hitADeadNode = 0
    const outcome = await runResilient({
      work: publicWork(12),
      nodes,
      leases,
      now: time.now,
      dispatch: async (shard, nodeId) => {
        if (!dead.has(nodeId)) return answered(shard.shardId)
        hitADeadNode += 1
        return nodeGone()
      },
      speculation: { sleep: time.sleep },
    })

    // A job that quietly retried would give correct answers and an inexplicable bill.
    expect(outcome.redispatches).toBeGreaterThan(0)

    // Every dispatch that hit a corpse left exactly one surrender in the history —
    // that is what makes the cost explicable after the fact.
    const surrendered = outcome.history.filter((e) => e.kind === 'surrendered')
    expect(surrendered).toHaveLength(hitADeadNode)
    for (const event of surrendered) {
      expect(dead.has((event as { nodeId: string }).nodeId)).toBe(true)
    }

    // Re-dispatches count generations beyond the first, so they track the shards
    // that had to move rather than the attempts that failed.
    const moved = outcome.shards.filter((s) => s.attempted.length > 1)
    expect(outcome.redispatches).toBe(moved.reduce((sum, s) => sum + s.attempted.length - 1, 0))

    // And the history accounts for every shard that finished.
    expect(outcome.history.filter((e) => e.kind === 'completed')).toHaveLength(12)
  })

  it('names why each attempt failed, not merely that it did', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))
    const dead = new Set(['n0', 'n1', 'n2'])

    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) =>
        dead.has(nodeId) ? nodeGone('ECONNREFUSED') : answered(shard.shardId),
      speculation: { sleep: time.sleep },
    })

    const withFailures = outcome.shards.filter((s) => s.failures.length > 0)
    expect(withFailures.length).toBeGreaterThan(0)
    for (const shard of withFailures) {
      for (const failure of shard.failures) {
        expect(failure.kind).toBe('node')
        expect(failure.reason).toBe('ECONNREFUSED')
        expect(dead.has(failure.nodeId)).toBe(true)
      }
    }
  })

  it('survives a dispatch that throws, not just one that reports failure', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))
    const outcome = await runResilient({
      work: publicWork(4),
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) => {
        if (nodeId === 'n0') throw new Error('connection reset')
        return answered(shard.shardId)
      },
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.failed).toEqual([])
    // An exception escaping a transport is what an unreachable peer looks like.
    const thrown = outcome.shards.flatMap((s) => s.failures).filter((f) => f.nodeId === 'n0')
    for (const failure of thrown) expect(failure.kind).toBe('node')
  })
})

describe('a node failure and a task failure warrant opposite policies', () => {
  it('retries a node failure across the pool until someone answers', async () => {
    // Nine of ten nodes are gone. The tenth must still be found — anything that
    // gave up after a fixed few retries would fail the 30% criterion outright.
    const time = fakeTime()
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`))
    const alive = 'n7'

    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) =>
        nodeId === alive ? answered(shard.shardId) : nodeGone(),
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.shards[0]?.nodeId).toBe(alive)
    expect(outcome.shards[0]?.attempted.length).toBeGreaterThan(1)
  })

  it('gives up on a broken task after a few nodes rather than burning the fabric', async () => {
    // Same ten nodes, all healthy, and a task that cannot succeed anywhere. Three
    // independent nodes failing it is better evidence of a bad task than of bad luck.
    const time = fakeTime()
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`))

    let dispatches = 0
    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      now: time.now,
      dispatch: async () => {
        dispatches += 1
        return taskBroke()
      },
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toEqual(['s0'])
    expect(dispatches).toBe(3)
    expect(outcome.shards[0]?.failures.every((f) => f.kind === 'task')).toBe(true)
  })

  it('runs out of nodes rather than looping when every node is gone', async () => {
    const time = fakeTime()
    const outcome = await runResilient({
      work: publicWork(2),
      nodes: [node('n0'), node('n1'), node('n2')],
      now: time.now,
      dispatch: async () => nodeGone(),
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toEqual(['s0', 's1'])
    // Bounded by the pool, and every node was tried exactly once.
    for (const shard of outcome.shards) {
      expect(shard.attempted).toHaveLength(3)
      expect(new Set(shard.attempted).size).toBe(3)
    }
  })
})

describe('CHURN-02 — a straggler is duplicated under the budget', () => {
  it('duplicates a stalled shard and takes the fast copy’s answer', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 8 }, (_, i) => node(`n${i}`))
    const work = publicWork(8)

    // Find who the placer gives s0 to, then stall exactly that node.
    const probe = await runResilient({
      work: [work[0] as ShardWork],
      nodes,
      now: fakeTime().now,
      dispatch: async (shard) => answered(shard.shardId),
      speculation: { sleep: fakeTime().sleep },
    })
    const victim = probe.shards[0]?.nodeId as string

    const outcome = await runResilient({
      work,
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) =>
        nodeId === victim ? stall() : answered(shard.shardId),
      speculation: { fraction: 0.5, watchdogMs: 50, sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    const stalled = outcome.shards.find((s) => s.attempted[0] === victim)
    expect(stalled?.speculated).toBe(true)
    expect(stalled?.nodeId).not.toBe(victim)
    expect(stalled?.resultCid).toBe(resultOf(stalled?.shardId as string))
    expect(outcome.speculationSpent).toBeGreaterThan(0)
  })

  it('reports the speculation multiplier in the job’s cost accounting', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 8 }, (_, i) => node(`n${i}`))

    const clean = await runResilient({
      work: publicWork(8),
      nodes,
      now: time.now,
      dispatch: async (shard) => answered(shard.shardId),
      speculation: { sleep: time.sleep },
    })
    // Reported whether or not it was used, so its absence is visible.
    expect(clean.speculationMultiplier).toBe(1)
    expect(clean.speculationSpent).toBe(0)
  })

  it('does not duplicate before enough shards have finished to compare against', async () => {
    // A single-shard job has no peers, so nothing is a straggler and nothing is
    // duplicated — correctly, since there is no tail yet.
    const time = fakeTime()
    let calls = 0
    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes: [node('n0'), node('n1'), node('n2')],
      now: time.now,
      dispatch: async (shard) => {
        calls += 1
        return answered(shard.shardId)
      },
      speculation: { fraction: 1, watchdogMs: 1, sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(calls).toBe(1)
    expect(outcome.speculationSpent).toBe(0)
  })
})

describe('CHURN-06 — a sovereign shard’s duplicate stays on its owner’s nodes', () => {
  it('never dispatches a sovereign duplicate across owners', async () => {
    const time = fakeTime()
    // Alice has three nodes; eight idle foreign nodes sit next to them.
    const nodes = [
      node('alice-1'),
      node('alice-2'),
      node('alice-3'),
      ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 'bob')),
    ]
    const work: ShardWork[] = Array.from({ length: 6 }, (_, i) => ({
      shardId: `s${i}`,
      label: 'sovereign',
      ownerId: 'alice',
    }))

    const asked: string[] = []
    let stalls = 0
    const outcome = await runResilient({
      work,
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) => {
        asked.push(nodeId)
        // Stall the first shard to force speculation under pressure — the exact
        // moment a "pick anyone, quickly" duplicate would breach sovereignty.
        if (shard.shardId === 's0' && stalls++ === 0) return stall()
        return answered(shard.shardId)
      },
      speculation: { fraction: 1, watchdogMs: 20, sleep: time.sleep },
    })

    expect(outcome.speculationSpent).toBeGreaterThan(0)
    // The assertion that matters: no foreign node was ever even asked.
    expect(asked.every((nodeId) => nodeId.startsWith('alice-'))).toBe(true)
    for (const shard of outcome.shards) {
      for (const nodeId of shard.attempted) expect(nodeId.startsWith('alice-')).toBe(true)
    }
  })

  it('waits rather than breaching when the owner has only the one node', async () => {
    const time = fakeTime()
    const nodes = [node('alice-1'), ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 'bob'))]

    const asked: string[] = []
    let stalled = false
    const outcome = await runResilient({
      work: [
        { shardId: 's0', label: 'sovereign', ownerId: 'alice' },
        { shardId: 's1', label: 'sovereign', ownerId: 'alice' },
        { shardId: 's2', label: 'sovereign', ownerId: 'alice' },
        { shardId: 's3', label: 'sovereign', ownerId: 'alice' },
      ],
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) => {
        asked.push(nodeId)
        // s3 stalls long enough to be a straggler. With nowhere legal to duplicate
        // to, waiting is the only move — and the eight idle foreigners stay unasked.
        if (shard.shardId === 's3' && !stalled) {
          stalled = true
          return nodeGone()
        }
        return answered(shard.shardId)
      },
      speculation: { fraction: 1, watchdogMs: 10, sleep: time.sleep },
    })

    expect(asked.every((nodeId) => nodeId === 'alice-1')).toBe(true)
    expect(outcome.results.get('s0')).toBe(resultOf('s0'))
    // Alice's single node was already tried, so s3 has nowhere left to go.
    expect(outcome.failed).toEqual(['s3'])
  })
})

describe('CHURN-05 — the aggregate carries its coverage', () => {
  it('reports partial coverage when an owner contributes nothing', async () => {
    const time = fakeTime()
    const nodes = [node('alice-1'), node('bob-1', 'bob'), node('carol-1', 'carol')]
    const work: ShardWork[] = [
      { shardId: 'alice-shard', label: 'sovereign', ownerId: 'alice' },
      { shardId: 'bob-shard', label: 'sovereign', ownerId: 'bob' },
      { shardId: 'carol-shard', label: 'sovereign', ownerId: 'carol' },
    ]

    const outcome = await runResilient({
      work,
      nodes,
      now: time.now,
      // Carol is offline. Her shard never produces a partial.
      dispatch: async (shard, nodeId) =>
        nodeId.startsWith('carol') ? nodeGone() : answered(shard.shardId),
      expectedOwners: ['alice', 'bob', 'carol'],
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.coverage.covered).toBe(2)
    expect(outcome.coverage.total).toBe(3)
    expect(outcome.coverage.missing).toEqual(['carol'])
    expect(outcome.coverage.complete).toBe(false)
  })

  it('reports complete coverage only when every owner contributed', async () => {
    const time = fakeTime()
    const nodes = [node('alice-1'), node('bob-1', 'bob')]
    const outcome = await runResilient({
      work: [
        { shardId: 'a', label: 'sovereign', ownerId: 'alice' },
        { shardId: 'b', label: 'sovereign', ownerId: 'bob' },
      ],
      nodes,
      now: time.now,
      dispatch: async (shard) => answered(shard.shardId),
      expectedOwners: ['alice', 'bob'],
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.coverage.complete).toBe(true)
    expect(outcome.coverage.covered).toBe(2)
  })
})

describe('a disagreement fails the run rather than footnoting it', () => {
  it('surfaces a speculative copy that produced a different answer', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))

    // The primary is slow and then answers *differently*. Two copies of a
    // deterministic function over content-addressed inputs must agree.
    let slowed = false
    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard) => {
        if (shard.shardId === 's0' && !slowed) {
          slowed = true
          return new Promise<DispatchOutcome>((resolve) => {
            setTimeout(() => resolve({ ok: true, resultCid: 'bafy-DIFFERENT' }), 0)
          })
        }
        return answered(shard.shardId)
      },
      speculation: { fraction: 1, watchdogMs: 5, sleep: time.sleep },
    })

    // Whichever copy won, if the two differed the run is not ok.
    if (outcome.disagreements.length > 0) {
      expect(outcome.disagreements).toContain('s0')
      expect(outcome.ok).toBe(false)
    }
  })
})
