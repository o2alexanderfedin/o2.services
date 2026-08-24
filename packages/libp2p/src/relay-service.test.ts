import { ed25519 } from '@noble/curves/ed25519.js'
import { EnrollmentAuthority, publishCapabilities, requestEnrollment, toHex } from '@o2/core'
import type { Discoverability, NodeRecords, PublicKeyHex, RecordIndex } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import {
  MAX_RELAY_CANDIDATES,
  RELAY_SERVICE_KEY,
  discoverRelays,
  relayServiceCid,
  topUpRelays,
} from './relay-service.ts'

/**
 * NET-05 — **finding a relay by asking, and refusing to take the answer on trust.**
 *
 * Plain `.test.ts`, so it runs in the node project and in all three browser engines: a tab
 * is the node that most needs to find a relay, and none of what is checked here touches a
 * socket.
 *
 * ## What the two halves are
 *
 * A DHT cannot be asked *"who is a seed"* — Kademlia looks up a key and does not scan
 * values. So a relay announces itself as a **provider of a well-known key**, which is an
 * unauthenticated claim anybody reachable can make. What settles it is the certificate the
 * fabric already publishes beside every node: the issuer signed `discoverability`, and
 * `'seed'` is what makes the claim true.
 *
 * These cases are about the second half. The announcement narrows the field; the
 * certificate is what decides, and a candidate that announced without one is discarded.
 */

const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000
const PROVIDER_KEY = new Uint8Array(32).fill(60)

async function records(seedByte: number, discoverability: Discoverability): Promise<NodeRecords> {
  const priv = new Uint8Array(32).fill(seedByte)
  const authority = new EnrollmentAuthority({
    providerPrivateKey: PROVIDER_KEY,
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const enrolled = authority.enrol(
    await requestEnrollment(priv, new Uint8Array(32).fill(61), {
      operatorId: `op-${seedByte}`,
      discoverability,
      relayIds: [],
    }),
    NOW,
  )
  if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)

  return {
    certificate: enrolled.certificate,
    capabilities: publishCapabilities(priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
      extensions: [],
    }),
  }
}

function keyFor(seedByte: number): PublicKeyHex {
  return toHex(ed25519.getPublicKey(new Uint8Array(32).fill(seedByte)))
}

/**
 * An index that answers exactly what it is given.
 *
 * A fixture rather than `MemoryRecordIndex` because the point of several cases below is a
 * node that **announced and has no record** — a state a well-formed index does not
 * naturally hold, and the one an attacker produces for free.
 */
function fixtureIndex(
  announced: readonly PublicKeyHex[],
  held: ReadonlyMap<PublicKeyHex, NodeRecords>,
): RecordIndex {
  return {
    providers: async (_cid: CID) => announced,
    recordsFor: async (nodeKey: PublicKeyHex) => held.get(nodeKey),
  }
}

describe('NET-05 — the well-known key a relay announces itself under', () => {
  it('is derived from the constant, so every node computes the same one', async () => {
    const first = await relayServiceCid()
    const second = await relayServiceCid()

    expect(first.toString()).toBe(second.toString())
    // Named rather than opaque: a later change of meaning has to be a different key, and a
    // reader has to be able to see which one this is.
    expect(RELAY_SERVICE_KEY).toBe('/o2/relay/1.0.0')
  })
})

describe('NET-05 — the announcement narrows, the certificate decides', () => {
  it('keeps a candidate whose issuer called it a seed', async () => {
    const relay = keyFor(10)
    const found = await discoverRelays({
      index: fixtureIndex([relay], new Map([[relay, await records(10, 'seed')]])),
      self: keyFor(99),
    })

    expect(found).toEqual([relay])
  })

  it('discards a candidate whose certificate says it is reachable only through a relay', async () => {
    // The exact attack the certificate check exists for, and it costs an attacker nothing:
    // a provider record is unauthenticated, so announcing under the well-known key is free.
    // What is not free is a certificate saying `'seed'`, which only an issuer can mint.
    const liar = keyFor(11)
    const found = await discoverRelays({
      index: fixtureIndex([liar], new Map([[liar, await records(11, 'via-relay')]])),
      self: keyFor(99),
    })

    expect(found, 'a node that announced without the certificate to back it was accepted').toEqual([])
  })

  it('discards a candidate the index holds no record for at all', async () => {
    const ghost = keyFor(12)
    const found = await discoverRelays({
      index: fixtureIndex([ghost], new Map()),
      self: keyFor(99),
    })

    expect(found).toEqual([])
  })

  it('never offers a node itself', async () => {
    // A relay announces under the same key it would look under, so without this a node
    // that is both would find itself and spend a slot connecting to its own address. The
    // same argument `DhtRecordIndexOptions.self` carries: a node in its own candidate list
    // is a redundancy that is not one.
    const self = keyFor(13)
    const found = await discoverRelays({
      index: fixtureIndex([self], new Map([[self, await records(13, 'seed')]])),
      self,
    })

    expect(found).toEqual([])
  })

  it('reads at most MAX_RELAY_CANDIDATES records however many announced', async () => {
    const many = Array.from({ length: MAX_RELAY_CANDIDATES + 5 }, (_unused, i) => keyFor(20 + i))
    const held = new Map<PublicKeyHex, NodeRecords>()
    for (const [i, key] of many.entries()) held.set(key, await records(20 + i, 'seed'))

    let reads = 0
    const counting: RecordIndex = {
      providers: async () => many,
      recordsFor: async (nodeKey) => {
        reads += 1
        return held.get(nodeKey)
      },
    }

    const found = await discoverRelays({ index: counting, self: keyFor(99) })

    // A record lookup is a DHT walk with a five-second ceiling. Unbounded, one node
    // announcing a thousand keys would cost every reader the whole budget.
    expect(reads).toBe(MAX_RELAY_CANDIDATES)
    expect(found).toHaveLength(MAX_RELAY_CANDIDATES)
  })
})

describe('NET-05 — topping up reservations stops at the ceiling', () => {
  it('connects until the target is reached and no further', async () => {
    let reserved = 0
    const connected: PublicKeyHex[] = []

    const made = await topUpRelays({
      target: 2,
      reserved: () => reserved,
      discover: async () => [keyFor(30), keyFor(31), keyFor(32), keyFor(33)],
      connect: async (nodeKey) => {
        connected.push(nodeKey)
        reserved += 1
      },
    })

    // Four were offered; two is the ceiling. The ceiling is a divisor on the fabric's own
    // capacity — 64 slots per relay — so overshooting costs every other node.
    expect(made).toBe(2)
    expect(connected).toEqual([keyFor(30), keyFor(31)])
  })

  it('does nothing when the node is already reachable enough', async () => {
    let asked = false
    const made = await topUpRelays({
      target: 2,
      reserved: () => 2,
      discover: async () => {
        asked = true
        return [keyFor(40)]
      },
      connect: async () => {
        throw new Error('connected while already at the target')
      },
    })

    expect(made).toBe(0)
    // Not merely "made no connection": a lookup is a DHT walk, and running one to discard
    // its answer is the cost this early return exists to avoid.
    expect(asked, 'a lookup ran for a node that needed no relay').toBe(false)
  })

  it('moves on when a relay refuses, rather than failing the caller', async () => {
    let reserved = 0
    const tried: PublicKeyHex[] = []

    const made = await topUpRelays({
      target: 1,
      reserved: () => reserved,
      discover: async () => [keyFor(50), keyFor(51)],
      connect: async (nodeKey) => {
        tried.push(nodeKey)
        // A relay at capacity refuses; an unreachable one rejects. Both are ordinary, and
        // this runs on the start path where throwing would take the node down.
        if (nodeKey === keyFor(50)) throw new Error('at-capacity')
        reserved += 1
      },
    })

    expect(tried).toEqual([keyFor(50), keyFor(51)])
    expect(made).toBe(1)
  })

  it('re-reads the count between connects, so a concurrent reservation is not doubled', async () => {
    // The count can move without this function moving it: the node's configured relays
    // arrive on their own schedule. Computing it once and counting down would spend a slot
    // this node no longer needs.
    let reserved = 0
    const connected: PublicKeyHex[] = []

    const made = await topUpRelays({
      target: 2,
      reserved: () => reserved,
      discover: async () => [keyFor(60), keyFor(61), keyFor(62)],
      connect: async (nodeKey) => {
        connected.push(nodeKey)
        // One connect, two reservations: this one plus a configured relay landing.
        reserved += 2
      },
    })

    expect(made).toBe(1)
    expect(connected).toEqual([keyFor(60)])
  })
})
