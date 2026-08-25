import type { KadDHT, QueryEvent } from '@libp2p/kad-dht'
import type { Blockstore } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { DhtProviderAnnouncer, ObservingBlockstore } from './dht-provider-announcer.ts'

/**
 * Provider announcement — what a node may tell the keyspace it holds.
 *
 * Plain `.test.ts`, so it runs under Node **and** in all three browser engines. That is not
 * incidental: a tab announces on exactly the same terms a backbone node does, and a module
 * exercised only under Node would be proving half of what it claims.
 *
 * The property that matters is not *"blocks get announced"* — it is the invariant
 * `withholdingFrom` exists to hold: **a node never advertises a block its own `block`
 * branch would refuse to serve.** A `providers` answer converts *a peer cannot tell refusal
 * from absence* into a peer that can, learned without asking for the bytes and without
 * anything appearing on the refusing node's manifest. Every case below names the mutation
 * that reddens it.
 */

const PUBLIC_CID = CID.parse('bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy')
const SOVEREIGN_CID = CID.parse('bafkreidwbsnhoxvzcgrbpsvhxcarqx5nlmwoerzkfyqfyoy5rrvpqkjxam')

async function* nothing(): AsyncIterable<QueryEvent> {}

interface Spy {
  readonly dht: KadDHT
  readonly provided: string[]
  readonly cancelled: string[]
}

function dhtSpy(options: { readonly provideThrows?: boolean } = {}): Spy {
  const provided: string[] = []
  const cancelled: string[] = []
  const dht: KadDHT = {
    k: 20,
    a: 3,
    d: 3,
    validators: {},
    selectors: {},
    get: () => nothing(),
    findProviders: () => nothing(),
    findPeer: () => nothing(),
    getClosestPeers: () => nothing(),
    provide: (cid) => {
      if (options.provideThrows === true) throw new Error('no peers in routing table')
      provided.push(cid.toString())
      return nothing()
    },
    cancelReprovide: async (cid) => {
      cancelled.push(cid.toString())
    },
    put: () => nothing(),
    getMode: () => 'server',
    setMode: async () => {},
    refreshRoutingTable: async () => {},
  }
  return { dht, provided, cancelled }
}

describe('a sweep announces what the node may advertise', () => {
  it('announces an observed block', async () => {
    const spy = dhtSpy()
    const announcer = new DhtProviderAnnouncer({
      dht: spy.dht,
      withhold: 'advertises-everything-it-holds',
    })
    announcer.observe(PUBLIC_CID)

    const outcome = await announcer.sweep()

    // Plant that reddens this: have `observe` drop the CID instead of holding it, or have
    // `sweep` call `provide` without draining — the iterable is lazy, so an undrained
    // `provide` is a `provide` that never happened.
    expect(outcome.announced).toBe(1)
    expect(spy.provided).toStrictEqual([PUBLIC_CID.toString()])
    expect(announcer.announcedCount).toBe(1)
  })

  it('does not announce the same block twice', async () => {
    const spy = dhtSpy()
    const announcer = new DhtProviderAnnouncer({
      dht: spy.dht,
      withhold: 'advertises-everything-it-holds',
    })
    announcer.observe(PUBLIC_CID)
    await announcer.sweep()
    announcer.observe(PUBLIC_CID)

    const second = await announcer.sweep()

    // Plant that reddens this: drop the `#announced.has(key)` guard in `observe`. kad-dht
    // reprovides on its own schedule; re-walking the routing table per sweep per block is
    // work nobody asked for.
    expect(second.announced).toBe(0)
    expect(spy.provided).toStrictEqual([PUBLIC_CID.toString()])
  })

  it('keeps a refused announcement pending rather than losing it', async () => {
    const failing = dhtSpy({ provideThrows: true })
    const announcer = new DhtProviderAnnouncer({
      dht: failing.dht,
      withhold: 'advertises-everything-it-holds',
    })
    announcer.observe(PUBLIC_CID)

    const first = await announcer.sweep()

    // Plant that reddens this: let `#provide`'s failure fall through without putting the
    // CID back. A node whose first sweep ran before it had peers would then never
    // advertise that block again, and nothing would say so.
    expect(first).toStrictEqual({ announced: 0, withheld: 0, retracted: 0, refused: 1 })
    expect(announcer.announcedCount).toBe(0)
  })
})

describe('the invariant: never advertise what the block branch would refuse', () => {
  it('withholds a block the predicate refuses, and does not lose it', async () => {
    const spy = dhtSpy()
    let sovereign = true
    const announcer = new DhtProviderAnnouncer({
      dht: spy.dht,
      withhold: (cid) => sovereign && cid.toString() === SOVEREIGN_CID.toString(),
    })
    announcer.observe(SOVEREIGN_CID)

    const held = await announcer.sweep()
    // Plant that reddens this: announce first and ask the predicate afterwards, or drop
    // the withheld arm entirely. This is the side channel — a `providers` answer about a
    // block the `block` branch refuses tells a stranger the bytes exist here.
    expect(held.withheld).toBe(1)
    expect(spy.provided).toStrictEqual([])

    // A hold is given back. The block becomes advertisable again, which is why the
    // withheld arm keeps it pending instead of discarding it.
    sovereign = false
    const released = await announcer.sweep()
    expect(released.announced).toBe(1)
    expect(spy.provided).toStrictEqual([SOVEREIGN_CID.toString()])
  })

  it('retracts a block that becomes withheld after it was announced', async () => {
    const spy = dhtSpy()
    let sovereign = false
    const announcer = new DhtProviderAnnouncer({
      dht: spy.dht,
      withhold: () => sovereign,
    })
    announcer.observe(PUBLIC_CID)
    await announcer.sweep()
    expect(announcer.announcedCount).toBe(1)

    sovereign = true
    const outcome = await announcer.sweep()

    // Plant that reddens this: delete the retraction loop. Sovereignty arrives after a
    // block is stored — that is what `SelfRecordIndex`'s "consulted per lookup" is for —
    // and an announcement that is only ever made and never withdrawn cannot honour it.
    expect(outcome.retracted).toBe(1)
    expect(spy.cancelled).toStrictEqual([PUBLIC_CID.toString()])
    expect(announcer.announcedCount).toBe(0)
  })

  it('fails closed when the predicate cannot answer', async () => {
    const spy = dhtSpy()
    const announcer = new DhtProviderAnnouncer({
      dht: spy.dht,
      withhold: () => {
        throw new Error('blockstore unavailable')
      },
    })
    announcer.observe(PUBLIC_CID)

    const outcome = await announcer.sweep()

    // Plant that reddens this: catch and return `false`. "I could not check" is not "it is
    // safe to say" — and a predicate that reads bytes off a store can genuinely fail.
    expect(outcome.withheld).toBe(1)
    expect(spy.provided).toStrictEqual([])
  })
})

describe('the store observes and announces nothing', () => {
  function memory(): Blockstore {
    const blocks = new Map<string, Uint8Array<ArrayBuffer>>()
    return {
      put: async (bytes) => {
        // A fixed CID per call order is enough: this file is about what the decorator
        // reports, not about hashing, which `multiformats` owns.
        const cid = blocks.size === 0 ? PUBLIC_CID : SOVEREIGN_CID
        blocks.set(cid.toString(), bytes)
        return cid
      },
      get: async (cid) => blocks.get(cid.toString()),
      has: async (cid) => blocks.has(cid.toString()),
      get size() {
        return blocks.size
      },
    }
  }

  it('replays what was put before an observer existed', async () => {
    const store = new ObservingBlockstore(memory())
    await store.put(new Uint8Array([1]) as Uint8Array<ArrayBuffer>)

    const seen: string[] = []
    store.observeWith((cid) => {
      seen.push(cid.toString())
    })

    // Plant that reddens this: drop the buffer and observe only from `observeWith` onward.
    // A node factory builds its store before `createLibp2p` — the identity is read beside
    // the blocks — so everything a node holds at start is put before any announcer exists.
    expect(seen).toStrictEqual([PUBLIC_CID.toString()])
  })

  it('observes later puts and stays transparent', async () => {
    const store = new ObservingBlockstore(memory())
    const seen: string[] = []
    store.observeWith((cid) => {
      seen.push(cid.toString())
    })
    const cid = await store.put(new Uint8Array([2]) as Uint8Array<ArrayBuffer>)

    // Plant that reddens this: return before delegating, or observe without returning the
    // inner CID. The decorator sits on the local-only tier that `SelfRecordIndex`, the
    // egress tap and `serveAgent` are all handed — a difference here is a difference there.
    expect(seen).toStrictEqual([PUBLIC_CID.toString()])
    expect(await store.has(cid)).toBe(true)
    expect(await store.get(cid)).toStrictEqual(new Uint8Array([2]))
    expect(store.size).toBe(1)
  })
})
