import { describe, expect, it } from 'vitest'
import {
  DEFAULT_D,
  LocalCapacity,
  placeWithOffers,
  planWithOffers,
  sampleCandidates,
} from './placement.ts'
import type { Admission, Offer } from './placement.ts'
import type { NodeDescriptor, PlacementRequest } from './sovereignty.ts'

/**
 * SCHED-02, SCHED-03, SCHED-05.
 *
 * The distinguishing property of power-of-d is *what it does not look at*. A test
 * that only checks "the least-loaded node won" cannot tell d-choices apart from a
 * global sort, so the tests below deliberately arrange for the globally least-loaded
 * node to sit **outside** the sample and require that it is not chosen.
 */

const node = (nodeId: string, load: number, ownerId = 'alice'): NodeDescriptor => ({
  nodeId,
  ownerId,
  canExecuteSovereign: true,
  load,
})

const publicShard = (shardId: string, redundancy = 1): PlacementRequest => ({
  shardId,
  label: 'public',
  redundancy,
})

const sovereignShard = (shardId: string, redundancy = 1): PlacementRequest => ({
  shardId,
  label: 'sovereign',
  ownerId: 'alice',
  redundancy,
})

const refuse = (reason: string) => (): Admission => ({ accepted: false, reason })

describe('SCHED-02 — placement samples d and looks no further', () => {
  it('chooses the least-loaded of the sample, not the least-loaded overall', async () => {
    const ids = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']
    const flat = ids.map((id) => node(id, 0.5))

    // Ask the sampler which two it picks, then engineer the loads around the answer:
    // an outsider at zero load, a sample member slightly better than its peer.
    const sample = sampleCandidates('s0', flat, DEFAULT_D).map((n) => n.nodeId)
    expect(sample).toHaveLength(2)
    const outsider = ids.find((id) => !sample.includes(id)) as string

    const nodes = flat.map((n) => {
      if (n.nodeId === outsider) return node(n.nodeId, 0) // globally least loaded
      if (n.nodeId === sample[0]) return node(n.nodeId, 0.1)
      if (n.nodeId === sample[1]) return node(n.nodeId, 0.9)
      return n
    })

    const placement = await placeWithOffers(publicShard('s0'), nodes)

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds).toEqual([sample[0]])
    expect(placement.nodeIds).not.toContain(outsider)
    // One node asked. That is the cost of the decision.
    expect(placement.probed).toBe(1)
  })

  it('derives the sample from the shard id and node set alone', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, Math.random()))
    const once = sampleCandidates('shard-7', nodes, 3).map((n) => n.nodeId)
    // Same inputs in a different order, and with different load figures.
    const shuffled = [...nodes].reverse().map((n) => node(n.nodeId, 0))
    const twice = sampleCandidates('shard-7', shuffled, 3).map((n) => n.nodeId)
    expect(twice).toEqual(once)
  })

  it('spreads work: different shards draw different samples', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`, 0))
    const winners = new Set(
      Array.from({ length: 24 }, (_, i) => sampleCandidates(`s${i}`, nodes, 2)[0]?.nodeId),
    )
    // A fixed ranking would put every shard on one node. The whole point is that the
    // permutation changes per key.
    expect(winners.size).toBeGreaterThan(4)
  })

  it('samples no more than the pool holds', () => {
    const nodes = [node('a', 0), node('b', 0)]
    expect(sampleCandidates('s0', nodes, 4)).toHaveLength(2)
  })

  it('refuses a d outside 2..4 rather than clamping it', async () => {
    for (const d of [0, 1, 5, 2.5]) {
      const placement = await placeWithOffers(publicShard('s0'), [node('a', 0)], { d })
      expect(placement.status).toBe('unplaceable')
      if (placement.status !== 'unplaceable') return
      expect(placement.reason).toContain('d must be an integer')
    }
  })

  it('places each replica on a distinct node', async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`, i / 10))
    const placement = await placeWithOffers(publicShard('s0', 3), nodes)
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(new Set(placement.nodeIds).size).toBe(3)
  })
})

describe('SCHED-03 — a refusal re-picks; it does not fail the job', () => {
  it('re-picks after an over-committed node refuses, and records why', async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`, 0))

    // Refuse whoever is asked first, rather than naming a node up front — the
    // property under test is "a refusal is followed by another offer", and asserting
    // it against a re-derived choice would just restate the implementation.
    const offered: string[] = []
    const admit = (offer: Offer): Admission => {
      offered.push(offer.nodeId)
      return offered.length === 1
        ? { accepted: false, reason: 'over-committed: 4 of 4 slots in use' }
        : { accepted: true }
    }

    const placement = await placeWithOffers(publicShard('s0'), nodes, { admit })

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(offered).toHaveLength(2)
    expect(placement.nodeIds).toEqual([offered[1]])
    expect(placement.rejections).toEqual([
      { nodeId: offered[0], reason: 'over-committed: 4 of 4 slots in use' },
    ])
    expect(placement.probed).toBe(2)
  })

  it('keeps re-picking through a run of refusals', async () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`n${i}`, 0))
    let refusals = 0
    const admit = (): Admission =>
      refusals++ < 5 ? { accepted: false, reason: `busy #${refusals}` } : { accepted: true }

    const placement = await placeWithOffers(publicShard('s0'), nodes, { admit })
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.rejections).toHaveLength(5)
    expect(placement.probed).toBe(6)
  })

  it('never offers the same node twice', async () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node(`n${i}`, 0))
    const asked: string[] = []
    const admit = (offer: Offer): Admission => {
      asked.push(offer.nodeId)
      return { accepted: false, reason: 'no' }
    }

    await placeWithOffers(publicShard('s0'), nodes, { admit })
    expect(asked).toHaveLength(5)
    expect(new Set(asked).size).toBe(5)
  })

  it('reports "everyone refused" distinctly from "there was nobody"', async () => {
    const nodes = [node('a', 0), node('b', 0)]

    const allRefused = await placeWithOffers(publicShard('s0'), nodes, { admit: refuse('full') })
    expect(allRefused.status).toBe('unplaceable')
    if (allRefused.status !== 'unplaceable') return
    expect(allRefused.reason).toContain('refused')
    expect(allRefused.rejections).toHaveLength(2)

    const nobody = await placeWithOffers(publicShard('s0'), [])
    expect(nobody.status).toBe('unplaceable')
    if (nobody.status !== 'unplaceable') return
    expect(nobody.reason).toBe('no nodes available')
    expect(nobody.rejections).toEqual([])
  })

  it('degrades to fewer replicas rather than failing, and says so', async () => {
    const nodes = Array.from({ length: 4 }, (_, i) => node(`n${i}`, 0))
    let accepted = 0
    const admit = (): Admission =>
      accepted++ < 1 ? { accepted: true } : { accepted: false, reason: 'over-committed' }

    const placement = await placeWithOffers(publicShard('s0', 3), nodes, { admit })
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.replicas).toBe(1)
    expect(placement.degraded).toBe(true)
  })
})

describe('SCHED-05 — sampling happens behind the sovereignty filter', () => {
  it('never samples a foreign node, however loaded the owner’s are', async () => {
    // Alice's two nodes are saturated; eight foreign nodes are idle. This is the exact
    // input a load-aware sampler is built to react to.
    const nodes = [
      node('alice-1', 1),
      node('alice-2', 1),
      ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 0, 'bob')),
    ]

    const offered: string[] = []
    const admit = (offer: Offer): Admission => {
      offered.push(offer.nodeId)
      return { accepted: true }
    }

    const placement = await placeWithOffers(sovereignShard('s0'), nodes, { admit })

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds[0]).toMatch(/^alice-/)
    // The stronger assertion: a foreign node was never even asked. If sampling ran
    // before the filter, a probe would have leaked the shard id to bob's fabric.
    expect(offered.every((id) => id.startsWith('alice-'))).toBe(true)
  })

  it('stalls when every one of the owner’s nodes refuses', async () => {
    // The falsification that matters. Refusal is exactly the pressure that would
    // tempt a scheduler to widen the pool — "nobody who is allowed will take it, so
    // let me ask someone else". There must be no such branch.
    const nodes = [
      node('alice-1', 1),
      node('alice-2', 1),
      ...Array.from({ length: 8 }, (_, i) => node(`bob-${i}`, 0, 'bob')),
    ]

    const offered: string[] = []
    const admit = (offer: Offer): Admission => {
      offered.push(offer.nodeId)
      return { accepted: false, reason: 'over-committed: 2 of 2 slots in use' }
    }

    const placement = await placeWithOffers(sovereignShard('s0'), nodes, { admit })

    expect(placement.status).toBe('unplaceable')
    if (placement.status !== 'unplaceable') return
    expect(placement.rejections).toHaveLength(2)
    expect(offered).toEqual(expect.arrayContaining(['alice-1', 'alice-2']))
    expect(offered).toHaveLength(2)
  })

  it('treats a sovereign request with no owner as broken, not as unrestricted', async () => {
    const placement = await placeWithOffers(
      { shardId: 's0', label: 'sovereign', redundancy: 1 },
      [node('bob-1', 0, 'bob')],
    )
    expect(placement.status).toBe('unplaceable')
  })

  it('excludes an owner node that holds only an encrypted replica', async () => {
    const nodes: NodeDescriptor[] = [
      { nodeId: 'alice-cold', ownerId: 'alice', canExecuteSovereign: false, load: 0 },
      { nodeId: 'alice-warm', ownerId: 'alice', canExecuteSovereign: true, load: 0.9 },
    ]
    const placement = await placeWithOffers(sovereignShard('s0'), nodes)
    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds).toEqual(['alice-warm'])
  })
})

describe('LocalCapacity — a node decides from its own counters', () => {
  it('accepts up to its slot count and then refuses with the numbers', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 2 })
    expect(capacity.offer({ shardId: 's0', nodeId: 'n0' })).toEqual({ accepted: true })
    expect(capacity.offer({ shardId: 's1', nodeId: 'n0' })).toEqual({ accepted: true })

    const refused = capacity.offer({ shardId: 's2', nodeId: 'n0' })
    expect(refused.accepted).toBe(false)
    if (refused.accepted) return
    expect(refused.reason).toBe('over-committed: 2 of 2 slots in use')
  })

  it('frees a slot on release', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 1 })
    capacity.offer({ shardId: 's0', nodeId: 'n0' })
    expect(capacity.offer({ shardId: 's1', nodeId: 'n0' }).accepted).toBe(false)
    capacity.release('s0')
    expect(capacity.offer({ shardId: 's1', nodeId: 'n0' }).accepted).toBe(true)
    capacity.release('s1')
    capacity.release('s1') // releasing twice is harmless
    expect(capacity.inFlight).toBe(0)
  })

  it('scales slots by duty cycle and names it in the refusal', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: 0.25 })
    expect(capacity.slots).toBe(2)
    capacity.offer({ shardId: 's0', nodeId: 'n0' })
    capacity.offer({ shardId: 's1', nodeId: 'n0' })
    const refused = capacity.offer({ shardId: 's2', nodeId: 'n0' })
    expect(refused.accepted).toBe(false)
    if (refused.accepted) return
    expect(refused.reason).toContain('duty cycle 0.25')
  })

  it('keeps a heavily throttled node in the fabric with one slot', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 2, dutyCycle: 0.01 })
    expect(capacity.slots).toBe(1)
    expect(capacity.offer({ shardId: 's0', nodeId: 'n0' }).accepted).toBe(true)
  })

  it('refuses a shard it is already running', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4 })
    capacity.offer({ shardId: 's0', nodeId: 'n0' })
    const again = capacity.offer({ shardId: 's0', nodeId: 'n0' })
    expect(again.accepted).toBe(false)
    if (again.accepted) return
    expect(again.reason).toContain('already in flight')
  })

  it('reports load as occupied fraction of usable slots', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4 })
    expect(capacity.load).toBe(0)
    capacity.offer({ shardId: 's0', nodeId: 'n0' })
    expect(capacity.load).toBe(0.25)
  })

  it('rejects nonsense construction rather than guessing', () => {
    expect(() => new LocalCapacity({ nodeId: 'n', maxConcurrent: 0 })).toThrow(RangeError)
    expect(() => new LocalCapacity({ nodeId: 'n', maxConcurrent: 1, dutyCycle: 0 })).toThrow(RangeError)
    expect(() => new LocalCapacity({ nodeId: 'n', maxConcurrent: 1, dutyCycle: 1.5 })).toThrow(RangeError)
  })
})

describe('planWithOffers — a whole job against real capacity', () => {
  it('spills across nodes as capacity fills, without losing a shard', async () => {
    const capacities = new Map(
      Array.from({ length: 4 }, (_, i) => [`n${i}`, new LocalCapacity({ nodeId: `n${i}`, maxConcurrent: 2 })]),
    )
    const nodes = [...capacities.keys()].map((id) => node(id, 0))
    const shards = Array.from({ length: 8 }, (_, i) => publicShard(`s${i}`))

    const admit = (offer: Offer): Admission =>
      capacities.get(offer.nodeId)?.offer(offer) ?? { accepted: false, reason: 'unknown node' }

    const placements = await planWithOffers(shards, nodes, { admit, d: 2 })

    expect(placements.every((p) => p.status === 'placed')).toBe(true)
    // Eight shards into eight slots: capacity is exactly consumed.
    expect([...capacities.values()].reduce((sum, c) => sum + c.inFlight, 0)).toBe(8)
    for (const capacity of capacities.values()) expect(capacity.inFlight).toBe(2)
  })

  it('stalls only the shards that could not be placed', async () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 1 })
    const nodes = [node('n0', 0)]
    const shards = [publicShard('s0'), publicShard('s1')]

    const placements = await planWithOffers(shards, nodes, {
      admit: (offer) => capacity.offer(offer),
    })

    expect(placements[0]?.status).toBe('placed')
    expect(placements[1]?.status).toBe('unplaceable')
  })
})
