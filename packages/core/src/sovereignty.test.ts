import { describe, expect, it } from 'vitest'
import { planPlacement } from './sovereignty.ts'
import type { NodeDescriptor, PlacementRequest } from './sovereignty.ts'

/**
 * DATA-03 / DATA-06 / DATA-09 — sovereignty as a property of the code.
 *
 * Criterion 1 asks for a test that "applies artificial load pressure specifically to
 * force relocation" and fails to move the task. That is the shape below: the owner's
 * nodes are pinned at maximum load while idle foreign nodes sit next to them, which
 * is the exact input a load-balancing scheduler is designed to react to.
 */

const owner = (nodeId: string, load: number): NodeDescriptor => ({
  nodeId,
  ownerId: 'alice',
  canExecuteSovereign: true,
  load,
})

const foreign = (nodeId: string, load: number): NodeDescriptor => ({
  nodeId,
  ownerId: 'bob',
  canExecuteSovereign: true,
  load,
})

const sovereignShard: PlacementRequest = {
  shardId: 's0',
  label: 'sovereign',
  ownerId: 'alice',
  redundancy: 1,
}

describe('DATA-03 — sovereign work stays on its owner’s nodes', () => {
  it('refuses to relocate under load pressure engineered to force it', () => {
    // Alice's only node is saturated; four foreign nodes are completely idle. Any
    // scheduler that treats sovereignty as a preference moves the task here.
    const nodes = [
      owner('alice-1', 1),
      foreign('bob-1', 0),
      foreign('bob-2', 0),
      foreign('bob-3', 0),
      foreign('bob-4', 0),
    ]

    const plan = planPlacement([sovereignShard], nodes)
    const placement = plan.placements[0]!

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds).toEqual(['alice-1'])
  })

  it('stalls rather than leaks when the owner has no node available', () => {
    // The important half. Faced with "nowhere to run it", the only acceptable
    // answers are to wait or to fail — never to run it somewhere else.
    const plan = planPlacement([sovereignShard], [foreign('bob-1', 0), foreign('bob-2', 0)])
    const placement = plan.placements[0]!

    expect(placement.status).toBe('unplaceable')
    if (placement.status !== 'unplaceable') return
    expect(placement.reason).toContain('alice')
    expect(plan.complete).toBe(false)
  })

  it('never returns a foreign node for a sovereign shard, over many shapes', () => {
    // A property check rather than one arrangement: whatever the mix of loads and
    // owners, no sovereign placement may name a node belonging to someone else.
    for (let ownerCount = 0; ownerCount <= 3; ownerCount++) {
      for (let foreignCount = 0; foreignCount <= 4; foreignCount++) {
        const nodes = [
          ...Array.from({ length: ownerCount }, (_u, i) => owner(`alice-${i}`, 0.9 + i * 0.01)),
          ...Array.from({ length: foreignCount }, (_u, i) => foreign(`bob-${i}`, 0)),
        ]
        const placement = planPlacement([{ ...sovereignShard, redundancy: 2 }], nodes).placements[0]!
        if (placement.status !== 'placed') continue
        for (const nodeId of placement.nodeIds) expect(nodeId.startsWith('alice-')).toBe(true)
      }
    }
  })

  it('treats a sovereign shard with no owner as broken, not as unrestricted', () => {
    // A missing label must fail closed. Read as "no restriction", it would be the
    // most dangerous default in the system.
    const plan = planPlacement(
      [{ shardId: 's0', label: 'sovereign', redundancy: 1 }],
      [foreign('bob-1', 0)],
    )
    expect(plan.placements[0]!.status).toBe('unplaceable')
  })

  it('caps sovereign redundancy at the owner’s own node count, and says so', () => {
    // Two of Alice's nodes cannot provide R=3. Reporting `degraded` matters: at
    // R=1 the result is owner-attested rather than verified, and a caller that
    // cannot tell the difference will over-claim.
    const plan = planPlacement(
      [{ ...sovereignShard, redundancy: 3 }],
      [owner('alice-1', 0.2), owner('alice-2', 0.1), foreign('bob-1', 0)],
    )
    const placement = plan.placements[0]!
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect([...placement.nodeIds].sort()).toEqual(['alice-1', 'alice-2'])
    expect(placement.replicas).toBe(2)
    expect(placement.degraded).toBe(true)
    expect(plan.complete).toBe(false)
  })
})

describe('DATA-09 — an encrypted replica serves availability, not execution', () => {
  it('will not dispatch sovereign work to a node that cannot decrypt', () => {
    // A backbone node holding an encrypted replica. Useful as a block source;
    // running the task there would mean handing it the key.
    const replica: NodeDescriptor = {
      nodeId: 'backbone-1',
      ownerId: 'alice',
      canExecuteSovereign: false,
      load: 0,
    }

    const idle = planPlacement([sovereignShard], [replica, owner('alice-1', 0.99)])
    const placement = idle.placements[0]!
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    // Chosen despite being far more loaded, because the replica is not eligible.
    expect(placement.nodeIds).toEqual(['alice-1'])

    // And with only the replica present, the shard stalls.
    expect(planPlacement([sovereignShard], [replica]).placements[0]!.status).toBe('unplaceable')
  })
})

describe('public data still schedules normally', () => {
  it('uses the least-loaded node regardless of owner', () => {
    const plan = planPlacement(
      [{ shardId: 'p0', label: 'public', redundancy: 2 }],
      [owner('alice-1', 0.8), foreign('bob-1', 0.1), foreign('bob-2', 0.4)],
    )
    const placement = plan.placements[0]!
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds).toEqual(['bob-1', 'bob-2'])
    expect(plan.complete).toBe(true)
  })

  it('is deterministic when loads tie', () => {
    // Two planners given the same input must agree, or a placement cannot be
    // reproduced when diagnosing a job.
    const nodes = [foreign('b', 0.5), foreign('a', 0.5), foreign('c', 0.5)]
    const once = planPlacement([{ shardId: 'p0', label: 'public', redundancy: 2 }], nodes)
    const twice = planPlacement([{ shardId: 'p0', label: 'public', redundancy: 2 }], [...nodes].reverse())
    expect(once).toEqual(twice)
  })

  it('rejects an incoherent redundancy instead of guessing', () => {
    const plan = planPlacement(
      [{ shardId: 'p0', label: 'public', redundancy: 0 }],
      [foreign('bob-1', 0)],
    )
    expect(plan.placements[0]!.status).toBe('unplaceable')
  })
})
