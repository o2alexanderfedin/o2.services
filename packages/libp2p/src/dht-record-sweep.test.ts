import { ed25519 } from '@noble/curves/ed25519.js'
import { Libp2pRecord } from '@libp2p/record'
import { EnrollmentAuthority, publishCapabilities, requestEnrollment, toHex } from '@o2/core'
import type { CapabilityRecord, NodeRecords, PublicKeyHex } from '@o2/core'
import { encodeNodeRecords } from '@o2/net'
import { MemoryDatastore } from 'datastore-core'
import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import * as varint from 'uint8-varint'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DHT_DATASTORE_PREFIX,
  sweepDhtRecords,
  sweepProviderRecords,
  sweepValueRecords,
} from './dht-record-sweep.ts'

/**
 * The storage half of the expiry ruling, read against a real `interface-datastore`.
 *
 * Plain `.test.ts`, so it runs under Node and in all three browser engines — the module is a
 * pure walk with an injected clock and has no platform in it, which is the property that lets
 * the Cloudflare tier reuse it without a second implementation.
 *
 * ## What each half of this file is actually claiming
 *
 * Two record families, two different criteria, and the interesting cases are the ones where
 * the sweep must **not** delete. A sweep that deletes too little is a storage bug you can
 * measure; a sweep that deletes too much is data loss with no undo, and it presents as a
 * fabric that quietly forgets nodes. So most cases below plant a record that looks expired
 * from one angle and assert it survives.
 *
 * Every count is asserted as a **literal**, never derived from the fixture's own length —
 * an assertion that recomputes the thing it tests moves with the defect.
 */

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const YEAR = 365 * 24 * HOUR
const at = (): number => NOW

/** The prefix `kadDHT()` builds when it is given no `datastorePrefix`. */
const RECORD_PREFIX = `${DEFAULT_DHT_DATASTORE_PREFIX}/record`
const PROVIDER_PREFIX = `${DEFAULT_DHT_DATASTORE_PREFIX}/provider`

/** A peer id string of the shape `toProviderKey` writes — the value is opaque to the sweep. */
const SELF_PEER = '12D3KooWSelfSelfSelfSelfSelfSelfSelfSelfSelfSelfSelf'
const OTHER_PEER = '12D3KooWOtherOtherOtherOtherOtherOtherOtherOtherOthr'
/** Base32 of a multihash, as `toProviderKey` writes the CID segment. */
const CID_SEGMENT = 'bafkreiabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnop'

let store: Datastore

beforeEach(() => {
  store = new MemoryDatastore()
})

/**
 * A signed `NodeRecords` for a fresh identity, with the capability window the case needs.
 *
 * Real signatures rather than hand-built objects, because two of the cases below turn on the
 * sweep declining to read the signature at all — and a fixture that never had one could not
 * tell the difference between "did not check" and "had nothing to check".
 */
async function records(
  seedByte: number,
  window: { readonly issuedAt: number; readonly expiresAt: number },
): Promise<{ readonly nodeKey: PublicKeyHex; readonly records: NodeRecords }> {
  const priv = new Uint8Array(32).fill(seedByte)
  const authority = new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(32).fill(60),
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const enrolled = authority.enrol(
    await requestEnrollment(priv, new Uint8Array(32).fill(61), {
      operatorId: `op-${seedByte}`,
      discoverability: 'seed',
      relayIds: [],
    }),
    NOW,
  )
  if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
  return {
    nodeKey: toHex(ed25519.getPublicKey(priv)),
    records: {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: ['bulk-memory'],
        sovereignFor: [],
        issuedAt: window.issuedAt,
        expiresAt: window.expiresAt,
        extensions: [],
      }),
    },
  }
}

/**
 * Put a value record under the record prefix.
 *
 * The datastore key is not parsed by {@link sweepValueRecords} — the criterion lives entirely
 * in the stored bytes — so the suffix here is a plausible name and nothing more. What IS load
 * bearing is the envelope: a `Libp2pRecord` whose `value` is the encoded `NodeRecords`, which
 * is exactly what `put-value.ts:52` writes.
 */
async function putValue(name: string, held: NodeRecords): Promise<Key> {
  const key = new Key(`${RECORD_PREFIX}/${name}`)
  const envelope = new Libp2pRecord(
    new TextEncoder().encode(name),
    encodeNodeRecords(held),
    new Date(NOW),
  )
  await store.put(key, envelope.serialize())
  return key
}

/** Put a provider entry exactly as `providers.ts:68-70` writes one. */
async function putProvider(peer: string, createdAt: number): Promise<Key> {
  const key = new Key(`${PROVIDER_PREFIX}/${CID_SEGMENT}/${peer}`)
  await store.put(key, varint.encode(createdAt))
  return key
}

const has = async (key: Key): Promise<boolean> => store.has(key)

describe('value records — the family with no sweep in the library at all', () => {
  it('deletes an expired record and leaves a live one', async () => {
    const dead = await records(0x11, { issuedAt: NOW - YEAR, expiresAt: NOW - HOUR })
    const live = await records(0x12, { issuedAt: NOW - HOUR, expiresAt: NOW + YEAR })
    const deadKey = await putValue('dead', dead.records)
    const liveKey = await putValue('live', live.records)

    const counts = await sweepValueRecords({ datastore: store, now: at })

    expect(counts).toEqual({ swept: 1, kept: 1, undecodable: 0 })
    expect(await has(deadKey)).toBe(false)
    expect(await has(liveKey)).toBe(true)
  })

  it('sweeps a record whose expiry is exactly now, because the read path already refuses it', async () => {
    // `verifyCapabilityRecord` refuses at `expiresAt <= now` (`discovery.ts:335`). A record on
    // the boundary is therefore already unusable, and keeping it would store bytes no reader
    // will ever accept. Plant that reddens this: change the sweep's `<=` to `<`.
    const edge = await records(0x13, { issuedAt: NOW - YEAR, expiresAt: NOW })
    const key = await putValue('edge', edge.records)

    const counts = await sweepValueRecords({ datastore: store, now: at })

    expect(counts.swept).toBe(1)
    expect(await has(key)).toBe(false)
  })

  it('KEEPS a not-yet-valid record, rather than deleting it for being early', async () => {
    // `issuedAt > now` is the other clause `verifyCapabilityRecord` refuses on, and it is a
    // clock-skew reading: the record becomes valid by waiting. A sweep that reused the whole
    // verdict would delete it, and the node would have to re-enrol to say something it had
    // already said. Plant that reddens this: sweep on `!verifyCapabilityRecord(...)`.
    const early = await records(0x14, { issuedAt: NOW + HOUR, expiresAt: NOW + YEAR })
    const key = await putValue('early', early.records)

    const counts = await sweepValueRecords({ datastore: store, now: at })

    expect(counts).toEqual({ swept: 0, kept: 1, undecodable: 0 })
    expect(await has(key)).toBe(true)
  })

  it('KEEPS a record whose signature does not verify — expiry is the storage question', async () => {
    // Deleting on a correctness verdict would turn any bug in verification, or one wrong
    // trust anchor, into silent unrecoverable data loss. The read path already refuses this
    // record; the sweep declines to have an opinion. Plant that reddens this: same as above.
    const held = await records(0x15, { issuedAt: NOW - HOUR, expiresAt: NOW + YEAR })
    const forged: CapabilityRecord = { ...held.records.capabilities, signature: 'ab'.repeat(64) }
    const key = await putValue('forged', { ...held.records, capabilities: forged })

    const counts = await sweepValueRecords({ datastore: store, now: at })

    expect(counts).toEqual({ swept: 0, kept: 1, undecodable: 0 })
    expect(await has(key)).toBe(true)
  })

  it('counts bytes it cannot read and does NOT delete them', async () => {
    // A value that does not decode did not arrive through the ordinary write path — the
    // keyspace's validator refuses one — so it is corruption or a shape change. The count is
    // the alarm; deleting would make a decoding bug indistinguishable from an expiry.
    const key = new Key(`${RECORD_PREFIX}/garbage`)
    await store.put(key, new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]))

    const counts = await sweepValueRecords({ datastore: store, now: at })

    expect(counts).toEqual({ swept: 0, kept: 0, undecodable: 1 })
    expect(await has(key)).toBe(true)
  })

  it('does not touch the provider prefix', async () => {
    // The two families share a datastore and differ by one path segment. A sweep that walked
    // the parent prefix would decode provider varints as `Libp2pRecord`s, call them
    // undecodable, and report a number nobody could explain. Plant that reddens this: drop
    // the `/record` suffix from the prefix.
    const ancient = await putProvider(OTHER_PEER, NOW - YEAR)
    const dead = await records(0x16, { issuedAt: NOW - YEAR, expiresAt: NOW - HOUR })
    await putValue('dead', dead.records)

    const counts = await sweepValueRecords({ datastore: store, now: at })

    expect(counts).toEqual({ swept: 1, kept: 0, undecodable: 0 })
    expect(await has(ancient)).toBe(true)
  })
})

describe('provider records — the family whose library sweep rides a timer workerd does not run', () => {
  const sweep = async (): ReturnType<typeof sweepProviderRecords> =>
    sweepProviderRecords({
      datastore: store,
      now: at,
      validityMs: HOUR,
      selfPeerId: SELF_PEER,
    })

  it('deletes a foreign entry older than validity and keeps a fresh one', async () => {
    const stale = await putProvider(OTHER_PEER, NOW - 2 * HOUR)
    const fresh = await putProvider(`${OTHER_PEER}2`, NOW - 60_000)

    const counts = await sweep()

    expect(counts).toEqual({ swept: 1, kept: 1, undecodable: 0 })
    expect(await has(stale)).toBe(false)
    expect(await has(fresh)).toBe(true)
  })

  it('KEEPS this node’s own entry at an age that deletes a foreign one', async () => {
    // `reprovider.ts:139-142` exempts `isSelf` in so many words — "so that if user node is
    // down for a while, we still persist provide intent". The two entries below differ ONLY
    // in the peer segment, so nothing but the exemption can explain the split verdict.
    // Plant that reddens this: drop the `selfPeerId` comparison.
    const mine = await putProvider(SELF_PEER, NOW - 2 * HOUR)
    const theirs = await putProvider(OTHER_PEER, NOW - 2 * HOUR)

    const counts = await sweep()

    expect(counts).toEqual({ swept: 1, kept: 1, undecodable: 0 })
    expect(await has(mine)).toBe(true)
    expect(await has(theirs)).toBe(false)
  })

  it('KEEPS an entry exactly at created + validity, because the library expires strictly after', async () => {
    // `reprovider.ts:133` computes `expired = now > expires`. An entry on the boundary is not
    // expired there, and this sweep is not allowed to be stricter than the mechanism it
    // stands in for. Plant that reddens this: change the sweep's `>` to `>=`.
    const edge = await putProvider(OTHER_PEER, NOW - HOUR)

    const counts = await sweep()

    expect(counts).toEqual({ swept: 0, kept: 1, undecodable: 0 })
    expect(await has(edge)).toBe(true)
  })

  it('counts an unreadable timestamp and does NOT delete it', async () => {
    // `varint.decode` throws a RangeError on an empty or truncated buffer — measured, not
    // assumed. The entry stays, and the count is what says so.
    const key = new Key(`${PROVIDER_PREFIX}/${CID_SEGMENT}/${OTHER_PEER}`)
    await store.put(key, new Uint8Array(0))

    const counts = await sweep()

    expect(counts).toEqual({ swept: 0, kept: 0, undecodable: 1 })
    expect(await has(key)).toBe(true)
  })

  it('does not touch the record prefix', async () => {
    const dead = await records(0x17, { issuedAt: NOW - YEAR, expiresAt: NOW - HOUR })
    const valueKey = await putValue('dead', dead.records)
    await putProvider(OTHER_PEER, NOW - 2 * HOUR)

    const counts = await sweep()

    expect(counts).toEqual({ swept: 1, kept: 0, undecodable: 0 })
    expect(await has(valueKey)).toBe(true)
  })
})

describe('one alarm, two prefixes', () => {
  it('reports both families separately from a single call', async () => {
    // The combined entry point exists so that "one alarm, two prefixes" is true at the call
    // site rather than being an arrangement the Cloudflare-tier glue has to remember. The
    // counts stay separate because the two numbers answer different questions.
    const dead = await records(0x18, { issuedAt: NOW - YEAR, expiresAt: NOW - HOUR })
    const live = await records(0x19, { issuedAt: NOW - HOUR, expiresAt: NOW + YEAR })
    await putValue('dead', dead.records)
    await putValue('live', live.records)
    await putProvider(OTHER_PEER, NOW - 2 * HOUR)
    await putProvider(SELF_PEER, NOW - 2 * HOUR)

    const counts = await sweepDhtRecords({
      datastore: store,
      now: at,
      validityMs: HOUR,
      selfPeerId: SELF_PEER,
    })

    expect(counts.values).toEqual({ swept: 1, kept: 1, undecodable: 0 })
    expect(counts.providers).toEqual({ swept: 1, kept: 1, undecodable: 0 })
  })

  it('honours a non-default datastorePrefix on both families', async () => {
    // `kadDHT({datastorePrefix})` is how a node runs two DHTs side by side, which this
    // project's own docs show for LAN + Amino. A sweep that ignored the option would find
    // nothing and report a clean zero — a silent pass, which is worse than a failure.
    const dead = await records(0x1a, { issuedAt: NOW - YEAR, expiresAt: NOW - HOUR })
    await store.put(
      new Key('/o2-dht/record/dead'),
      new Libp2pRecord(
        new TextEncoder().encode('dead'),
        encodeNodeRecords(dead.records),
        new Date(NOW),
      ).serialize(),
    )
    await store.put(
      new Key(`/o2-dht/provider/${CID_SEGMENT}/${OTHER_PEER}`),
      varint.encode(NOW - 2 * HOUR),
    )

    const counts = await sweepDhtRecords({
      datastore: store,
      now: at,
      validityMs: HOUR,
      selfPeerId: SELF_PEER,
      datastorePrefix: '/o2-dht',
    })

    expect(counts.values.swept).toBe(1)
    expect(counts.providers.swept).toBe(1)
  })
})
