/**
 * Sovereignty survives the offer loop — SCHED-05, criterion 5's kernel half.
 *
 * ## Why this file exists rather than four more cases in `placement.test.ts`
 *
 * That file has four sovereign cases (`:213`, `:239`, `:249`, `:261`) and **none of them
 * makes an eligible node refuse.** They place successfully or find nobody eligible. So the
 * one thing `placeWithOffers` newly makes breakable is the one thing they do not cover.
 *
 * `planPlacement` has no branch that can widen under load: it orders an already-narrowed
 * set and there is nowhere for a cheaper node to come from. `placeWithOffers` adds a
 * **loop** — a candidate refuses, it is dropped, and the next `d` are sampled from what
 * remains. A loop that re-derived its pool from the full node list on each iteration would
 * leak a sovereign shard onto a foreign node on the second pass, **and every existing
 * assertion would still pass**, because nothing else makes an owner's node refuse.
 *
 * The loop's own comment states the claim this file turns into a measurement:
 *
 *   > `pool` … is only ever shrunk — there is no branch that puts a node back.
 *
 * ## Every case counts offers, not only outcomes
 *
 * An outcome-only assertion passes for a placer that offered work to bob and then
 * discarded the answer. **That is a sovereignty leak on the wire even when the placement
 * is correct** — the offer itself tells bob's node that alice has a shard, and which shard.
 * So `admit` here is a counting stub and the call list is asserted by node id.
 *
 * This is the strong reading. `packages/node/src/sovereignty-placement.node.test.ts`
 * carries the same criterion across real processes and can only assert the *outcome*,
 * because the offer branch reserves nothing and a spawned node that was asked and refused
 * is indistinguishable from one that was never asked. Neither file should be read as
 * carrying the other's half.
 *
 * Pure by intent: hand-built descriptors, no transport, no node. The property under test
 * is a property of the loop, and a network would only add ways to be flaky about something
 * else.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_D, placeWithOffers } from './placement.ts'
import type { Admission, Offer } from './placement.ts'
import type { NodeDescriptor, PlacementRequest } from './sovereignty.ts'

const ALICE_1: NodeDescriptor = {
  nodeId: 'alice-1',
  ownerId: 'alice',
  canExecuteSovereign: true,
  // Described as saturated while every foreign node is idle. Load is the cost heuristic
  // criterion 5 requires be filtered AFTER the sovereignty constraint rather than scored
  // against it, so the fixture makes the owner the expensive choice on purpose.
  load: 1,
  // No node here carries one. `placeWithOffers` reads owner, clearance and load, and
  // this file is about which of those three decides — so the certificate is stated as
  // absent rather than left off, which is the distinction the field exists to make.
  certificate: 'carries-no-certificate',
}
const ALICE_2: NodeDescriptor = {
  nodeId: 'alice-2',
  ownerId: 'alice',
  canExecuteSovereign: true,
  load: 1,
  certificate: 'carries-no-certificate',
}
const BOB: readonly NodeDescriptor[] = [
  { nodeId: 'bob-1', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
  { nodeId: 'bob-2', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
  { nodeId: 'bob-3', ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
]

function sovereignFor(ownerId: string | undefined, redundancy = 1): PlacementRequest {
  return {
    shardId: 's0',
    label: 'sovereign',
    ...(ownerId === undefined ? {} : { ownerId }),
    redundancy,
  }
}

/**
 * An `admit` that records every node it is asked about.
 *
 * `refuse` names the nodes that say no; everything else accepts. The recorded list is the
 * measurement — the outcome alone cannot distinguish "never asked" from "asked and
 * ignored".
 */
function countingAdmit(refuse: readonly string[] = []): {
  admit: (offer: Offer) => Admission
  calls: Offer[]
} {
  const calls: Offer[] = []
  return {
    calls,
    admit: (offer: Offer): Admission => {
      calls.push(offer)
      return refuse.includes(offer.nodeId)
        ? {
            accepted: false,
            reason: `over-committed: 1 of 1 slots in use`,
            capacity: { slots: 1, inFlight: 1 },
          }
        : { accepted: true, capacity: { slots: 4, inFlight: 0 } }
    },
  }
}

describe('a refusal shrinks the sovereign pool and can never widen it', () => {
  it('comes back unplaceable when the owner’s only node refuses, with three idle foreign nodes available', async () => {
    const { admit, calls } = countingAdmit(['alice-1'])
    const placement = await placeWithOffers(sovereignFor('alice'), [ALICE_1, ...BOB], {
      d: DEFAULT_D,
      admit,
    })

    expect(placement.status).toBe('unplaceable')
    if (placement.status !== 'unplaceable') return
    expect(placement.reason).toContain('refused')

    // The load-bearing assertion. Bob's three were never offered anything — so the gate
    // ran BEFORE the loop rather than the loop happening to stop in the right place.
    expect(calls.map((o) => o.nodeId)).toStrictEqual(['alice-1'])
    expect(placement.rejections.map((r) => r.nodeId)).toStrictEqual(['alice-1'])
    // A pool re-derived from the full node list on each pass would read 4.
    expect(placement.probed).toBe(1)
  })

  it('places on the owner’s node when it accepts, so the case above is a refusal and not an unplaceable fixture', async () => {
    const { admit, calls } = countingAdmit()
    const placement = await placeWithOffers(sovereignFor('alice'), [ALICE_1, ...BOB], {
      d: DEFAULT_D,
      admit,
    })

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds).toStrictEqual(['alice-1'])
    expect(calls.map((o) => o.nodeId)).toStrictEqual(['alice-1'])
  })

  it('re-picks within the owner’s own node set — the gate costs nothing the loop was for', async () => {
    const { admit, calls } = countingAdmit(['alice-1'])
    const placement = await placeWithOffers(sovereignFor('alice'), [ALICE_1, ALICE_2, ...BOB], {
      d: DEFAULT_D,
      admit,
    })

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    expect(placement.nodeIds).toStrictEqual(['alice-2'])
    expect(placement.rejections.map((r) => r.nodeId)).toStrictEqual(['alice-1'])
    expect(placement.probed).toBe(2)
    // Both of the owner's, neither of bob's — order is by rendezvous rank, so the set is
    // what is asserted rather than the sequence.
    expect([...calls.map((o) => o.nodeId)].sort()).toStrictEqual(['alice-1', 'alice-2'])
  })

  it('reports a degraded sovereign placement rather than repairing it by widening', async () => {
    const { admit, calls } = countingAdmit(['alice-1'])
    const placement = await placeWithOffers(sovereignFor('alice', 2), [ALICE_1, ALICE_2, ...BOB], {
      d: DEFAULT_D,
      admit,
    })

    expect(placement.status).toBe('placed')
    if (placement.status !== 'placed') return
    // One replica where two were asked for. A degraded sovereign placement is
    // owner-attested rather than verified and is reported as such; the one thing it must
    // never be is repaired by reaching outside the owner's node set.
    expect(placement.replicas).toBe(1)
    expect(placement.degraded).toBe(true)
    expect(placement.nodeIds).toStrictEqual(['alice-2'])
    expect(calls.every((o) => o.nodeId.startsWith('alice-'))).toBe(true)
  })

  it('offers nothing at all for a sovereign shard with no owner', async () => {
    const { admit, calls } = countingAdmit()
    const placement = await placeWithOffers(sovereignFor(undefined), [ALICE_1, ...BOB], {
      d: DEFAULT_D,
      admit,
    })

    expect(placement.status).toBe('unplaceable')
    // A sovereign shard with no owner is not a wide-open shard; it is a broken one, and
    // the offer loop must not be the thing that discovers that. Zero offers, not four.
    expect(calls).toHaveLength(0)
  })
})
