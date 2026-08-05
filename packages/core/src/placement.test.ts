import { describe, expect, it } from 'vitest'
import { DutyCycleGovernor } from './governor.ts'
import {
  DEFAULT_D,
  DEFAULT_MAX_CONCURRENT_TASKS,
  LocalCapacity,
  placeWithOffers,
  planWithOffers,
  sampleCandidates,
} from './placement.ts'
import type { Admission, Offer } from './placement.ts'
import type { Governor } from './ports.ts'
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
  // Placement reads load and ownership and nothing else. Stated rather than omitted,
  // which is the whole reason the field is required.
  certificate: 'carries-no-certificate',
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

/**
 * Stub answers state **no** capacity, deliberately.
 *
 * These cases are about sampling, re-pick and the sovereignty gate, none of which
 * reads a capacity figure. A stub that invented one would bound `planWithOffers`'
 * headroom tally on a number no node ever published, and the cases below would then
 * be measuring the fixture. The cases that *are* about the figure build a real
 * `LocalCapacity` and read what it says.
 */
const refuse = (reason: string) => (): Admission => ({
  accepted: false,
  reason,
  capacity: 'states-no-capacity',
})
const STATES_NOTHING = { capacity: 'states-no-capacity' } as const

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
        ? { accepted: false, reason: 'over-committed: 4 of 4 slots in use', ...STATES_NOTHING }
        : { accepted: true, ...STATES_NOTHING }
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
      refusals++ < 5
        ? { accepted: false, reason: `busy #${refusals}`, ...STATES_NOTHING }
        : { accepted: true, ...STATES_NOTHING }

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
      return { accepted: false, reason: 'no', ...STATES_NOTHING }
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
      accepted++ < 1
        ? { accepted: true, ...STATES_NOTHING }
        : { accepted: false, reason: 'over-committed', ...STATES_NOTHING }

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
      return { accepted: true, ...STATES_NOTHING }
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
      return { accepted: false, reason: 'over-committed: 2 of 2 slots in use', ...STATES_NOTHING }
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
      {
        nodeId: 'alice-cold',
        ownerId: 'alice',
        canExecuteSovereign: false,
        load: 0,
        certificate: 'carries-no-certificate',
      },
      {
        nodeId: 'alice-warm',
        ownerId: 'alice',
        canExecuteSovereign: true,
        load: 0.9,
        certificate: 'carries-no-certificate',
      },
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
    // Widened by owner ruling D2, not weakened: every answer now states the node's
    // room as well as its verdict, so these two assert the whole answer rather than
    // just the verdict they used to carry.
    expect(capacity.offer({ shardId: 's0', nodeId: 'n0' })).toStrictEqual({
      accepted: true,
      capacity: { slots: 2, inFlight: 0 },
    })
    expect(capacity.offer({ shardId: 's1', nodeId: 'n0' })).toStrictEqual({
      accepted: true,
      capacity: { slots: 2, inFlight: 1 },
    })

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

  it('answers `would` without consuming the thing being asked about', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 1 })
    for (let i = 0; i < 10; i++) {
      // Widened by D2, and the widening strengthens this case rather than
      // diluting it: the *published* in-flight count stays 0 across all ten
      // probes, so a reader of the answer sees the node as free too.
      expect(capacity.would({ shardId: 'probe', nodeId: 'n0' })).toStrictEqual({
        accepted: true,
        capacity: { slots: 1, inFlight: 0 },
      })
    }
    expect(capacity.inFlight).toBe(0)
    // An offer is a question; asking it ten times must leave the node as free as it
    // was. This is the demo's liveness prober (`browser/demo/main.ts`), which sends
    // `{kind:'offer', shardId:'probe'}` to every connected peer.
    expect(capacity.peakInFlight).toBe(0)
  })

  it('refuses through `would` with the identical string `offer` produces', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: 0.25 })
    expect(capacity.slots).toBe(2)
    expect(capacity.offer({ shardId: 's0', nodeId: 'n0' }).accepted).toBe(true)
    expect(capacity.offer({ shardId: 's1', nodeId: 'n0' }).accepted).toBe(true)

    const asked = capacity.would({ shardId: 's2', nodeId: 'n0' })
    const taken = capacity.offer({ shardId: 's2', nodeId: 'n0' })
    expect(asked.accepted).toBe(false)
    expect(taken.accepted).toBe(false)
    if (asked.accepted || taken.accepted) return
    // Equality between the two, not two literals: a literal repeated here would
    // drift with the code it exists to pin. The literal is asserted once, above,
    // by 'accepts up to its slot count and then refuses with the numbers'.
    expect(asked.reason).toBe(taken.reason)
    expect(asked.reason).toBe('over-committed: 2 of 2 slots in use at duty cycle 0.25')
  })

  it('reports an in-flight shard through `would` without taking a second slot', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4 })
    capacity.offer({ shardId: 's0', nodeId: 'n0' })
    const again = capacity.would({ shardId: 's0', nodeId: 'n0' })
    expect(again.accepted).toBe(false)
    if (again.accepted) return
    expect(again.reason).toContain('already in flight')
    expect(capacity.inFlight).toBe(1)
  })

  it('remembers the high-water mark of reservations after every one is released', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4 })
    for (const shardId of ['s0', 's1', 's2']) capacity.offer({ shardId, nodeId: 'n0' })
    expect(capacity.peakInFlight).toBe(3)
    for (const shardId of ['s0', 's1', 's2']) capacity.release(shardId)
    expect(capacity.inFlight).toBe(0)
    // A high-water mark that could fall would answer "was this node ever
    // saturated?" with whatever happened to be true when somebody read it.
    expect(capacity.peakInFlight).toBe(3)
  })

  it('counts only accepted reservations in the high-water mark', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 1 })
    expect(capacity.offer({ shardId: 's0', nodeId: 'n0' }).accepted).toBe(true)
    for (let i = 1; i <= 5; i++) {
      expect(capacity.offer({ shardId: `s${i}`, nodeId: 'n0' }).accepted).toBe(false)
    }
    expect(capacity.peakInFlight).toBe(1)
  })

  it('says how full it is when it refuses, not only that it refused', () => {
    // SCHED-02 / owner ruling D2. A refusal that did not say how full is a refusal
    // a requestor cannot plan around: it learns that this shard did not fit and
    // nothing about whether the next one would.
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 1 })
    expect(capacity.offer({ shardId: 's0', nodeId: 'n0' }).accepted).toBe(true)

    const refusal = capacity.would({ shardId: 's1', nodeId: 'n0' })
    expect(refusal.accepted).toBe(false)
    expect(refusal.capacity).toStrictEqual({ slots: 1, inFlight: 1 })
  })

  it('states its capacity on the accepting arm too, not only when refusing', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4 })
    expect(capacity.would({ shardId: 's0', nodeId: 'n0' })).toStrictEqual({
      accepted: true,
      capacity: { slots: 4, inFlight: 0 },
    })
  })

  it('reports the in-flight count from before its own reservation, so two answers compose', () => {
    // The figure is taken at decision time. If it were read after the reservation,
    // a caller subtracting one per shard it placed would double-count its own
    // effect and stop offering a node that still had room.
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 2 })
    const first = capacity.offer({ shardId: 's0', nodeId: 'n0' })
    const second = capacity.offer({ shardId: 's1', nodeId: 'n0' })

    expect(first.capacity).toStrictEqual({ slots: 2, inFlight: 0 })
    expect(second.capacity).toStrictEqual({ slots: 2, inFlight: 1 })
  })

  it('publishes a duty-cycled slot count, not the unthrottled one', () => {
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: 0.25 })
    expect(capacity.would({ shardId: 's0', nodeId: 'n0' }).capacity).toStrictEqual({
      slots: 2,
      inFlight: 0,
    })
  })

  describe('a slot count that is a reading, not a memory', () => {
    /** A cap that can move, with no real waiting — the pacing is not what is under test. */
    const governed = (dutyCycle: number): DutyCycleGovernor =>
      new DutyCycleGovernor({
        dutyCycle,
        sleep: async () => {},
        environment: 'no-environment-governor',
      })

    it('follows the duty cycle down on the same object, with no reconstruction', () => {
      const governor = governed(1)
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: governor })
      expect(capacity.slots).toBe(8)
      governor.setDutyCycle(0.25)
      expect(capacity.slots).toBe(2)
    })

    it('drops the figure a requestor is offered next — criterion 3’s observable', () => {
      // The criterion asks that a node's advertised capacity drop when its cap
      // does, "observable in what the requestor is offered next". This is that
      // observable, asserted in the kernel so the tier plans wire a measured path
      // rather than a mechanism.
      const governor = governed(1)
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: governor })
      expect(capacity.would({ shardId: 's0', nodeId: 'n0' }).capacity).toStrictEqual({
        slots: 8,
        inFlight: 0,
      })
      governor.setDutyCycle(0.25)
      expect(capacity.would({ shardId: 's0', nodeId: 'n0' }).capacity).toStrictEqual({
        slots: 2,
        inFlight: 0,
      })
    })

    it('keeps a heavily throttled node a participant, at one slot and never zero', () => {
      const capacity = new LocalCapacity({
        nodeId: 'n0',
        maxConcurrent: 8,
        dutyCycle: governed(0.01),
      })
      expect(capacity.slots).toBe(1)
      expect(capacity.would({ shardId: 's0', nodeId: 'n0' }).accepted).toBe(true)
    })

    it('reads any Governor, not only the kernel’s own implementation', () => {
      // The browser tier's source is `VisibilityGovernor`, a different class the
      // kernel must not import. What `LocalCapacity` depends on is the port.
      class StubGovernor implements Governor {
        dutyCycle = 1
        async yieldSlice(): Promise<void> {}
      }
      const governor = new StubGovernor()
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: governor })
      expect(capacity.slots).toBe(8)
      governor.dutyCycle = 0.5
      expect(capacity.slots).toBe(4)
    })

    it('bounds starting without retracting a grant when the cap drops below what is in flight', () => {
      // Three readings in one case, deliberately. A bound that refused but leaked
      // a slot would satisfy the refusal alone, and a "fix" that floored `slots` at
      // the in-flight count would satisfy the releases alone.
      const governor = governed(0.5)
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: governor })
      expect(capacity.slots).toBe(4)
      for (const shardId of ['s0', 's1', 's2', 's3']) {
        expect(capacity.offer({ shardId, nodeId: 'n0' }).accepted).toBe(true)
      }

      governor.setDutyCycle(0.25)
      expect(capacity.slots).toBe(2)

      const refused = capacity.would({ shardId: 's4', nodeId: 'n0' })
      expect(refused.accepted).toBe(false)
      if (refused.accepted) return
      expect(refused.reason).toBe('over-committed: 4 of 2 slots in use at duty cycle 0.25')
      // The refusal string and the published figure are one reading, not two: a
      // node that said `4 of 2` while publishing some other slot count would be
      // giving two answers to one question.
      expect(refused.capacity).toStrictEqual({ slots: 2, inFlight: 4 })

      for (const shardId of ['s0', 's1', 's2', 's3']) capacity.release(shardId)
      expect(capacity.inFlight).toBe(0)
      expect(capacity.would({ shardId: 's4', nodeId: 'n0' }).accepted).toBe(true)
    })

    it('reports load honestly above 1 while a lowered cap drains', () => {
      const governor = governed(0.5)
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 8, dutyCycle: governor })
      for (const shardId of ['s0', 's1', 's2', 's3']) capacity.offer({ shardId, nodeId: 'n0' })
      expect(capacity.load).toBe(1)

      governor.setDutyCycle(0.25)
      // Clamping this to 1 would hide exactly the state a requestor most needs to
      // see. `load` orders already-eligible nodes, so an honest 2 orders this node
      // last, which is correct; a clamped 1 would order it level with a node that
      // is merely full.
      expect(capacity.load).toBeGreaterThan(1)
      expect(capacity.load).toBe(2)
    })

    it('names the live duty cycle in the refusal, not the one it was built with', () => {
      const governor = governed(0.5)
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4, dutyCycle: governor })
      expect(capacity.slots).toBe(2)
      capacity.offer({ shardId: 's0', nodeId: 'n0' })
      capacity.offer({ shardId: 's1', nodeId: 'n0' })

      governor.setDutyCycle(0.25)
      const refused = capacity.would({ shardId: 's2', nodeId: 'n0' })
      expect(refused.accepted).toBe(false)
      if (refused.accepted) return
      expect(refused.reason).toContain('duty cycle 0.25')
      expect(refused.reason).not.toContain('duty cycle 0.5')
    })

    it('drops the suffix when a live cap returns to full rate', () => {
      const governor = governed(0.25)
      const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 4, dutyCycle: governor })
      expect(capacity.slots).toBe(1)
      capacity.offer({ shardId: 's0', nodeId: 'n0' })
      governor.setDutyCycle(1)
      expect(capacity.slots).toBe(4)

      // Filling the restored slots and then refusing proves the suffix is absent
      // because the node is unthrottled now, not because it was never throttled.
      for (const shardId of ['s1', 's2', 's3']) capacity.offer({ shardId, nodeId: 'n0' })
      const refused = capacity.would({ shardId: 's4', nodeId: 'n0' })
      expect(refused.accepted).toBe(false)
      if (refused.accepted) return
      expect(refused.reason).toBe('over-committed: 4 of 4 slots in use')
    })

    it('refuses a nonsense numeric duty cycle exactly as before, and leaves a Governor to check its own', () => {
      // The numeric arm's guard is unchanged. A `Governor` validated its cap when
      // it was constructed and again on every `setDutyCycle`, so a second check
      // here would be a second place for one rule to live.
      expect(
        () => new LocalCapacity({ nodeId: 'n', maxConcurrent: 1, dutyCycle: Number.NaN }),
      ).toThrow(RangeError)
      expect(() => governed(0)).toThrow(RangeError)
      expect(() => governed(1.5)).toThrow(RangeError)
    })
  })

  it('ships an admission default between a usable floor and the measured defect', () => {
    expect(Number.isInteger(DEFAULT_MAX_CONCURRENT_TASKS)).toBe(true)
    // The floor is the shipped configuration choice; the ceiling is the roadmap
    // probe's measured reading of 800 simultaneous `execute()` calls with zero
    // refusals. Neither endpoint is derived from a model of any workload.
    expect(DEFAULT_MAX_CONCURRENT_TASKS).toBeGreaterThanOrEqual(64)
    expect(DEFAULT_MAX_CONCURRENT_TASKS).toBeLessThan(800)
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
      capacities.get(offer.nodeId)?.offer(offer) ?? {
        accepted: false,
        reason: 'unknown node',
        ...STATES_NOTHING,
      }

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

  it('never hands a node more shards than the headroom it published', async () => {
    // Criterion 2c. Before D2, `placeWithOffers` shrank its pool within one shard
    // only and `pool` was rebuilt per request, so all four landed here.
    const capacity = new LocalCapacity({ nodeId: 'n0', maxConcurrent: 1 })
    const nodes = [node('n0', 0)]
    const shards = Array.from({ length: 4 }, (_, i) => publicShard(`s${i}`))

    const placements = await planWithOffers(shards, nodes, {
      admit: (offer) => capacity.offer(offer),
    })

    expect(placements.filter((p) => p.status === 'placed')).toHaveLength(1)
    const held = placements.filter((p) => p.status === 'unplaceable')
    expect(held).toHaveLength(3)
    for (const placement of held) {
      if (placement.status !== 'unplaceable') continue
      // Names the bound, rather than claiming there was nobody.
      expect(placement.reason).toContain('headroom')
      // `Rejection.reason` is fixed as the node's own words. A node the requestor
      // held back was never asked, so it never refused — and the read count says
      // so more precisely than the reason string does.
      expect(placement.rejections).toStrictEqual([])
      expect(placement.probed).toBe(0)
    }
  })

  it('places every shard that fits — the bound is not a refusal machine', async () => {
    const capacities = new Map(
      ['n0', 'n1'].map((id) => [id, new LocalCapacity({ nodeId: id, maxConcurrent: 2 })]),
    )
    const nodes = [...capacities.keys()].map((id) => node(id, 0))
    const shards = Array.from({ length: 4 }, (_, i) => publicShard(`s${i}`))

    const placements = await planWithOffers(shards, nodes, {
      admit: (offer) =>
        capacities.get(offer.nodeId)?.offer(offer) ?? {
          accepted: false,
          reason: 'unknown node',
          capacity: 'states-no-capacity',
        },
    })

    expect(placements.every((p) => p.status === 'placed')).toBe(true)
    const chosen = placements.flatMap((p) => (p.status === 'placed' ? p.nodeIds : []))
    expect(chosen).toHaveLength(4)
    // At most two per two-slot node. A bound that only ever refuses is
    // indistinguishable from a broken placer.
    for (const id of ['n0', 'n1']) expect(chosen.filter((c) => c === id)).toHaveLength(2)
  })

  it('does not bound a node that states no capacity', async () => {
    // The named absence, asserted rather than reached by omission. Assuming a
    // silent node full would make every node running an older build invisible to
    // one running this build.
    const nodes = [node('n0', 0)]
    const shards = Array.from({ length: 4 }, (_, i) => publicShard(`s${i}`))
    const asked: string[] = []

    const placements = await planWithOffers(shards, nodes, {
      admit: (offer) => {
        asked.push(offer.shardId)
        return { accepted: true, capacity: 'states-no-capacity' }
      },
    })

    expect(placements.every((p) => p.status === 'placed')).toBe(true)
    expect(placements.flatMap((p) => (p.status === 'placed' ? p.nodeIds : []))).toEqual([
      'n0',
      'n0',
      'n0',
      'n0',
    ])
    expect(asked).toEqual(['s0', 's1', 's2', 's3'])
  })

  it('is unchanged for a caller that makes no offers', async () => {
    // The regression bar. No offers are made, so no capacity is ever learned and
    // no bound can apply — an unlearned node is unbounded, not bounded at zero.
    const nodes = [node('n0', 0)]
    const shards = Array.from({ length: 4 }, (_, i) => publicShard(`s${i}`))

    const placements = await planWithOffers(shards, nodes)

    expect(placements.every((p) => p.status === 'placed')).toBe(true)
    expect(placements.flatMap((p) => (p.status === 'placed' ? p.nodeIds : []))).toEqual([
      'n0',
      'n0',
      'n0',
      'n0',
    ])
  })
})
