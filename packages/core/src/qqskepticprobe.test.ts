import { describe, expect, it } from 'vitest'
import { LeaseTable } from './lease.ts'
import { runResilient } from './coordinator.ts'
import type { CoordinatorOutcome, DispatchOutcome, ShardWork } from './coordinator.ts'
import type { NodeDescriptor } from './sovereignty.ts'

const T0 = 1_800_000_000_000

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

const resultOf = (shardId: string): string => `bafy-${shardId}`
const answered = (shardId: string): DispatchOutcome => ({ ok: true, resultCid: resultOf(shardId) })
const stall = (): Promise<DispatchOutcome> => new Promise<DispatchOutcome>(() => {})

/** Race the run against a real timer so a hang is observable rather than fatal. */
async function guard(
  run: Promise<CoordinatorOutcome>,
  ms: number,
): Promise<CoordinatorOutcome | 'HUNG'> {
  return await Promise.race([
    run,
    new Promise<'HUNG'>((resolve) => setTimeout(() => resolve('HUNG'), ms)),
  ])
}

describe('P1 — termination', () => {
  it('(a) single-shard job, dispatch never settles, budget available', async () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`n${i}`))
    let ticks = 0
    const run = runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      now: () => Date.now(),
      dispatch: async () => await stall(),
      speculation: {
        fraction: 1,
        watchdogMs: 20,
        sleep: async (ms) => {
          ticks += 1
          await new Promise((r) => setTimeout(r, ms))
        },
      },
    })
    const outcome = await guard(run, 1500)
    console.log('P1a outcome:', outcome === 'HUNG' ? 'HUNG' : 'settled', 'watchdog ticks:', ticks)
    expect(outcome).toBe('HUNG')
  })

  it('(b) default budget: two stragglers, one duplicate available', async () => {
    // allowance = floor(12 * 0.1) = 1. s0 spends it; s1 has nowhere to go.
    const nodes = Array.from({ length: 20 }, (_, i) => node(`n${i}`))
    const stalledOnce = new Set<string>()
    const run = runResilient({
      work: publicWork(12),
      nodes,
      now: () => Date.now(),
      dispatch: async (shard) => {
        if ((shard.shardId === 's0' || shard.shardId === 's1') && !stalledOnce.has(shard.shardId)) {
          stalledOnce.add(shard.shardId)
          return await stall()
        }
        return answered(shard.shardId)
      },
      speculation: { watchdogMs: 20 },
    })
    const outcome = await guard(run, 2000)
    console.log('P1b:', outcome === 'HUNG' ? 'HUNG' : JSON.stringify(outcome.failed))
    expect(outcome).toBe('HUNG')
  })

  it('(c) sovereign owner with one node, that node goes silent', async () => {
    const nodes = [node('alice-1'), ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 'bob'))]
    const asked: string[] = []
    const run = runResilient({
      work: [{ shardId: 's0', label: 'sovereign', ownerId: 'alice' }],
      nodes,
      now: () => Date.now(),
      dispatch: async (_shard, nodeId) => {
        asked.push(nodeId)
        return await stall()
      },
      speculation: { fraction: 1, watchdogMs: 20 },
    })
    const outcome = await guard(run, 1200)
    console.log('P1c:', outcome === 'HUNG' ? 'HUNG' : 'settled', 'asked:', asked)
    expect(outcome).toBe('HUNG')
  })

  it('(d) control — the same shape with a settling dispatch terminates', async () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`n${i}`))
    const run = runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes,
      now: () => Date.now(),
      dispatch: async (shard) => answered(shard.shardId),
      speculation: { fraction: 1, watchdogMs: 20 },
    })
    const outcome = await guard(run, 1500)
    expect(outcome).not.toBe('HUNG')
  })
})

describe('P2 — disagreement', () => {
  it('a slow primary returning a different CID is never reported', async () => {
    const time = fakeTime()
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))

    const seen: { nodeId: string; cid: string }[] = []
    let slowed = false
    const outcome = await runResilient({
      work: publicWork(6),
      nodes,
      now: time.now,
      dispatch: async (shard, nodeId) => {
        if (shard.shardId === 's0' && !slowed) {
          slowed = true
          return await new Promise<DispatchOutcome>((resolve) => {
            setTimeout(() => {
              seen.push({ nodeId, cid: 'bafy-LIE' })
              resolve({ ok: true, resultCid: 'bafy-LIE' })
            }, 0)
          })
        }
        if (shard.shardId === 's0') seen.push({ nodeId, cid: resultOf(shard.shardId) })
        return answered(shard.shardId)
      },
      speculation: { fraction: 1, watchdogMs: 5, sleep: time.sleep },
    })

    const s0 = outcome.shards.find((s) => s.shardId === 's0')
    console.log(
      'P2:',
      JSON.stringify({
        attempted: s0?.attempted,
        speculated: s0?.speculated,
        disagreed: s0?.disagreed,
        resultCid: s0?.resultCid,
        disagreements: outcome.disagreements,
        ok: outcome.ok,
      }),
    )
    expect(s0?.speculated).toBe(true)
    // Two copies of a pure function produced different CIDs...
    expect(outcome.disagreements).toEqual([])
    expect(outcome.ok).toBe(true)
    expect(s0?.disagreed).toBe(false)
  })

  it('the guard test at coordinator.test.ts:459 never enters its assertion branch', async () => {
    let entered = 0
    for (let round = 0; round < 20; round += 1) {
      const time = fakeTime()
      const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`))
      let slowed = false
      const outcome = await runResilient({
        work: publicWork(6),
        nodes,
        now: time.now,
        dispatch: async (shard) => {
          if (shard.shardId === 's0' && !slowed) {
            slowed = true
            return await new Promise<DispatchOutcome>((resolve) => {
              setTimeout(() => resolve({ ok: true, resultCid: 'bafy-DIFFERENT' }), 0)
            })
          }
          return answered(shard.shardId)
        },
        speculation: { fraction: 1, watchdogMs: 5, sleep: time.sleep },
      })
      if (outcome.disagreements.length > 0) entered += 1
    }
    console.log('P2 guard-branch entries out of 20:', entered)
    expect(entered).toBe(0)
  })
})

describe('P3 — lease completion past the deadline', () => {
  it('records a successful shard as stale-completion and leaks the lease', async () => {
    const time = fakeTime(10_000)
    const leases = new LeaseTable()
    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes: [node('n0'), node('n1'), node('n2')],
      leases,
      now: time.now,
      dispatch: async (shard) => answered(shard.shardId),
      speculation: { sleep: time.sleep },
    })

    console.log('P3 history:', JSON.stringify(outcome.history))
    console.log('P3 outstanding:', JSON.stringify(leases.outstanding))
    expect(outcome.ok).toBe(true)
    expect(outcome.history.filter((e) => e.kind === 'completed')).toHaveLength(0)
    expect(outcome.history.filter((e) => e.kind === 'stale-completion')).toHaveLength(1)
    expect(leases.outstanding).toHaveLength(1)
  })

  it('control — the same run with a 10ms step records a completion', async () => {
    const time = fakeTime(10)
    const leases = new LeaseTable()
    const outcome = await runResilient({
      work: [{ shardId: 's0', label: 'public' }],
      nodes: [node('n0'), node('n1'), node('n2')],
      leases,
      now: time.now,
      dispatch: async (shard) => answered(shard.shardId),
      speculation: { sleep: time.sleep },
    })
    expect(outcome.history.filter((e) => e.kind === 'completed')).toHaveLength(1)
    expect(leases.outstanding).toHaveLength(0)
  })
})

describe('P4 — coverage granularity', () => {
  it('reports complete coverage while three of alice’s four shards failed', async () => {
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
      dispatch: async (shard) =>
        shard.shardId === 'a0' || shard.shardId === 'b0'
          ? answered(shard.shardId)
          : { ok: false, kind: 'task', reason: 'partition unreadable' },
      expectedOwners: ['alice', 'bob'],
      speculation: { sleep: time.sleep },
    })

    console.log(
      'P4:',
      JSON.stringify({ failed: outcome.failed, coverage: outcome.coverage, ok: outcome.ok }),
    )
    expect(outcome.failed.sort()).toEqual(['a1', 'a2', 'a3'])
    expect(outcome.coverage.complete).toBe(true)
    expect(outcome.coverage.covered).toBe(2)
    expect(outcome.coverage.missing).toEqual([])
    expect(outcome.ok).toBe(false)
  })
})
