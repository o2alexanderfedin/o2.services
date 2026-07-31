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

  it('refuses to call an owner covered when only some of their shards landed', async () => {
    // The granularity bug: counting an owner the moment *any* one of their shards
    // succeeds reports `complete` over a quarter of their data. Both earlier CHURN-05
    // tests used exactly one shard per owner, so neither could see it.
    const time = fakeTime()
    const nodes = [node('alice-1'), node('alice-2'), node('bob-1', 'bob')]
    const work: ShardWork[] = [
      { shardId: 'a0', label: 'sovereign', ownerId: 'alice' },
      { shardId: 'a1', label: 'sovereign', ownerId: 'alice' },
      { shardId: 'a2', label: 'sovereign', ownerId: 'alice' },
      { shardId: 'a3', label: 'sovereign', ownerId: 'alice' },
      { shardId: 'b0', label: 'sovereign', ownerId: 'bob' },
    ]

    const outcome = await runResilient({
      work,
      nodes,
      now: time.now,
      // Only alice's first shard succeeds; the other three cannot be computed.
      dispatch: async (shard) =>
        shard.shardId === 'a0' || shard.shardId === 'b0'
          ? answered(shard.shardId)
          : taskBroke('partition unreadable'),
      expectedOwners: ['alice', 'bob'],
      speculation: { sleep: time.sleep },
    })

    expect(outcome.failed).toEqual(['a1', 'a2', 'a3'])
    expect(outcome.coverage.covered).toBe(1)
    expect(outcome.coverage.missing).toEqual(['alice'])
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
  /**
   * A gate the primary awaits and the speculative copy opens.
   *
   * Deliberately explicit rather than `setTimeout(0)`. The earlier version of this
   * test raced a microtask-resolving fake `sleep` against a macrotask, so the second
   * answer provably could not arrive before the shard returned — and every assertion
   * sat inside `if (outcome.disagreements.length > 0)`, a condition that was then
   * never true. The test passed while asserting nothing, and deleting disagreement
   * reporting outright left the whole suite green. Both arrivals are now guaranteed,
   * and both assertions are unconditional.
   */
  function gate() {
    let open = (): void => {}
    const opened = new Promise<void>((resolve) => {
      open = resolve
    })
    return { opened, open: () => open() }
  }

  it('surfaces a speculative copy that produced a different answer', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))
    const primary = gate()

    let first = true
    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard) => {
        if (shard.shardId !== 's0') return answered(shard.shardId)
        if (first) {
          // The primary: blocked until the duplicate has answered.
          first = false
          await primary.opened
          return answered('s0')
        }
        // The duplicate: answers differently, then releases the primary.
        primary.open()
        return { ok: true, resultCid: 'bafy-DIFFERENT' }
      },
      speculation: { fraction: 1, watchdogMs: 5, compareGraceMs: 50, sleep: time.sleep },
    })

    // Both copies provably ran and returned different CIDs. Timing picked a winner;
    // it must not have picked a *truth*.
    expect(outcome.shards.find((s) => s.shardId === 's0')?.speculated).toBe(true)
    expect(outcome.disagreements).toContain('s0')
    expect(outcome.ok).toBe(false)
  })

  it('reports agreement between copies as agreement, not as a disagreement', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))
    const primary = gate()

    let first = true
    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard) => {
        if (shard.shardId !== 's0') return answered(shard.shardId)
        if (first) {
          first = false
          await primary.opened
          return answered('s0')
        }
        primary.open()
        return answered('s0')
      },
      speculation: { fraction: 1, watchdogMs: 5, compareGraceMs: 50, sleep: time.sleep },
    })

    expect(outcome.shards.find((s) => s.shardId === 's0')?.speculated).toBe(true)
    expect(outcome.disagreements).toEqual([])
    expect(outcome.ok).toBe(true)
  })

  it('reports a copy that never answered as uncompared, never as agreeing', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))

    let first = true
    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard) => {
        if (shard.shardId !== 's0') return answered(shard.shardId)
        if (first) {
          first = false
          return stall() // the straggler that provoked the duplicate, never answers
        }
        return answered('s0')
      },
      speculation: { fraction: 1, watchdogMs: 5, compareGraceMs: 20, sleep: time.sleep },
    })

    const s0 = outcome.shards.find((s) => s.shardId === 's0')
    expect(s0?.speculated).toBe(true)
    expect(s0?.resultCid).toBe(resultOf('s0'))
    // Silence is not evidence of agreement. It is recorded as what it is.
    expect(s0?.uncompared).toHaveLength(1)
    expect(outcome.disagreements).toEqual([])
  })

  /**
   * A late copy that *answered with a failure* fell between every bucket: not
   * `uncompared`, because it did answer; not in `failures`, because the shard's
   * failures were sealed when the winner returned. It still appeared in `attempted`,
   * so the shard's history said a node was asked and never said what came of it —
   * against `failures`' own contract that a shard's history explains itself.
   *
   * Why a low-severity attribution bug is worth a case: `attempted` and `failures`
   * are the raw material any later exclusion or scoring mechanism reads. A peer that
   * reliably fails just after losing a race accrued no recorded failure at all.
   *
   * The gate is what makes the ordering exact rather than likely — same reason the
   * two cases above use one, and the same trap: an earlier version of this block
   * raced a microtask-resolving `sleep` against a macrotask and asserted nothing.
   */
  it('records a copy that fails after the winner is picked as a failure of that shard', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))
    const primary = gate()

    let first = true
    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard) => {
        if (shard.shardId !== 's0') return answered(shard.shardId)
        if (first) {
          // The straggler that provoked the duplicate. It answers — with a
          // failure — only once the duplicate has won.
          first = false
          await primary.opened
          // Deliberate, counted hops rather than a timer: enough for the race loop
          // to take the winner and register this copy as outstanding, and still
          // inside the compare grace.
          //
          // Swept 2026-07-30 over 1, 2, 3, 4, 5, 6 and 8 hops. Before the fix the
          // defect reproduced at every one of them. After it, 1–5 record the failure
          // and 6+ record `uncompared` instead — because by then the copy has missed
          // the grace altogether, which is what `uncompared` means and is the gap
          // this fix deliberately leaves open. 3 sits in the middle of that window,
          // not on either edge.
          for (let hop = 0; hop < 3; hop++) await Promise.resolve()
          return nodeGone('ECONNRESET')
        }
        primary.open()
        return answered('s0')
      },
      speculation: { fraction: 1, watchdogMs: 5, compareGraceMs: 50, sleep: time.sleep },
    })

    const s0 = outcome.shards.find((s) => s.shardId === 's0')
    expect(s0?.speculated).toBe(true)
    expect(s0?.resultCid).toBe(resultOf('s0'))
    expect(s0?.attempted).toHaveLength(2)
    // It answered, so it is not silence.
    expect(s0?.uncompared).toEqual([])
    expect(s0?.failures.map((f) => f.reason)).toEqual([expect.stringContaining('ECONNRESET')])
    expect(s0?.failures[0]?.kind).toBe('node')
  })
})

describe('the lease is the coordinator’s own deadline, and it is enforced', () => {
  it('does not hang on a peer that never answers when speculation cannot help', async () => {
    // The default configuration reaches this: floor(tasks * 0.1) is 0 for any job
    // under ten shards, so the budget is empty and no duplicate can ever start.
    // Before the deadline was enforced, this awaited a promise that never settles.
    const time = fakeTime()
    const leases = new LeaseTable({ leaseMs: 200, maxGenerations: 4 })
    const nodes = Array.from({ length: 4 }, (_, i) => node(`n${i}`))

    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      leases,
      now: time.now,
      dispatch: async (_shard, nodeId) => (nodeId === 'n0' ? answered('s0') : stall()),
      speculation: { watchdogMs: 20, sleep: time.sleep },
    })

    // It finished — that is the whole assertion. Somebody answered eventually.
    expect(outcome.results.get('s0')).toBe(resultOf('s0'))
    const lapses = outcome.shards[0]?.failures.filter((f) => f.reason.includes('lease expired'))
    expect((lapses ?? []).length).toBeGreaterThan(0)
  })

  it('gives up when every node stays silent, rather than waiting forever', async () => {
    const time = fakeTime()
    const leases = new LeaseTable({ leaseMs: 100, maxGenerations: 5 })
    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes: [node('n0'), node('n1'), node('n2')],
      leases,
      now: time.now,
      dispatch: async () => stall(),
      speculation: { watchdogMs: 10, sleep: time.sleep },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.failed).toEqual(['s0'])
    expect(outcome.shards[0]?.attempted).toHaveLength(3)
    // Each silent node cost exactly one lease, and the history says so.
    expect(leases.history.filter((e) => e.kind === 'expired')).toHaveLength(3)
  })

  it('records a completion as completed, not as stale, for a slow-but-live shard', async () => {
    // A dispatch outliving the lease used to be accepted *and* recorded as a refused
    // stale completion, leaving the task permanently in `outstanding`.
    const time = fakeTime()
    const leases = new LeaseTable({ leaseMs: 30_000, maxGenerations: 3 })
    const outcome = await runResilient({
      work: publicWork(3),
      nodes: Array.from({ length: 4 }, (_, i) => node(`n${i}`)),
      leases,
      now: time.now,
      dispatch: async (shard) => answered(shard.shardId),
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(leases.history.filter((e) => e.kind === 'completed')).toHaveLength(3)
    expect(leases.history.filter((e) => e.kind === 'stale-completion')).toHaveLength(0)
    // No phantom holders left behind for tasks that finished.
    expect(leases.outstanding).toEqual([])
  })
})

/**
 * NET-09 criterion 5 — the third failure kind, argued in the same terms as the
 * other two.
 *
 * `sender` means *this node did not send*. Not the receiver's fault, so blaming it
 * would route a healthy peer out of the pool; not the task's fault, so counting it
 * against `DEFAULT_MAX_TASK_FAILURES` would condemn a good shard. It is retried
 * like `node` and *named* differently — which is the whole point, because `:450`
 * attaches the attempted `nodeId` to every failure, so with only two kinds the
 * record says the receiver failed no matter what the string says.
 */
describe('NET-09 — a sender-side refusal retries like a node failure, not like a task failure', () => {
  const senderRefused = (nodeId: string): DispatchOutcome => ({
    ok: false,
    kind: 'sender',
    reason: `dispatch to ${nodeId} refused by this node's own send bound`,
  })

  it('does not give up at the task-failure budget', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 10 }, (_, i) => node(`n${i}`))

    let dispatches = 0
    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      now: time.now,
      dispatch: async (_shard, nodeId) => {
        dispatches += 1
        // Four refusals is already past DEFAULT_MAX_TASK_FAILURES (3). A `'task'`
        // kind would have given up before this ever answered.
        return dispatches <= 4 ? senderRefused(nodeId) : answered('s0')
      },
      speculation: { sleep: time.sleep },
    })

    expect(outcome.ok).toBe(true)
    expect(dispatches).toBe(5)
    expect(outcome.results.get('s0')).toBe(resultOf('s0'))
  })

  it('records the kind in the shard’s history, so a run says whose bound it was', async () => {
    const time = fakeTime()
    const nodes = [node('n0'), node('n1'), node('n2')]

    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      now: time.now,
      dispatch: async (_shard, nodeId) => senderRefused(nodeId),
      speculation: { sleep: time.sleep },
    })

    // Bounded by the pool rather than by the task budget — the `'node'` policy.
    expect(outcome.ok).toBe(false)
    expect(outcome.shards[0]?.attempted).toHaveLength(3)
    const failures = outcome.shards[0]?.failures ?? []
    expect(failures).toHaveLength(3)
    expect(failures.every((f) => f.kind === 'sender')).toBe(true)
    // `nodeId` still names the peer that was attempted; the *kind* is what carries
    // the attribution, which is precisely why a third kind was needed rather than
    // a better string.
    expect(failures.map((f) => f.nodeId).sort()).toEqual(['n0', 'n1', 'n2'])
  })

  it('still gives up at the budget for a task failure, so the third kind changed nothing else', async () => {
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
    expect(dispatches).toBe(3)
  })
})
