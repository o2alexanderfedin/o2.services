import { generateKeyPairFromSeed } from '@libp2p/crypto/keys'
import type { PeerInfo } from '@libp2p/interface'
import type { KadDHT, QueryEvent } from '@libp2p/kad-dht'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  publishCapabilities,
  requestEnrollment,
  toHex,
  verifyCapabilityRecord,
  verifyCertificate,
} from '@o2/core'
import type { NodeRecords, PublicKeyHex, RecordIndex } from '@o2/core'
import { encodeNodeRecords } from '@o2/net'
import { multiaddr } from '@multiformats/multiaddr'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { DhtRecordIndex, O2_KEY_PREFIX, dhtKeyForNodeKey } from './dht-record-index.ts'
import { nodeKeyForPeerId } from './identity.ts'

/**
 * `RecordIndex` answered by a Kademlia DHT — SCHED-01, NET-06.
 *
 * Plain `.test.ts`, so it runs in the node project **and** in all three browser engines.
 * That is deliberate rather than incidental: this class is the browser tier's index too,
 * and a pure module exercised only under Node would be proving half of what it claims.
 *
 * **Records here are really signed**, by the same `EnrollmentAuthority` /
 * `publishCapabilities` pair the fabric uses, and the verification arm runs the real
 * `verifyCertificate` / `verifyCapabilityRecord`. A fixture built from hand-written
 * objects would let this file pass while the encoding it round-trips through drifted away
 * from the one the fabric signs.
 *
 * Every case names the mutation that reddens it. A test whose plant leaves it green is not
 * evidence, and this file's entire job is to be evidence about a component whose network
 * nothing here provides.
 */

const NOW = 1_700_000_000_000
const YEAR = 365 * 24 * 60 * 60 * 1000
const FEATURES = ['bulk-memory'] as const

const CID_UNDER_TEST = CID.parse('bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy')

interface Subject {
  readonly nodeKey: PublicKeyHex
  readonly peerId: string
  readonly records: NodeRecords
}

/**
 * One enrolled node, whose peer id and node key are two spellings of the SAME key.
 *
 * Deriving both from one private key is what lets the provider case assert that the
 * conversion landed on the right node rather than merely on some node.
 */
async function subject(seedByte: number): Promise<Subject> {
  const priv = new Uint8Array(32).fill(seedByte)
  const nodeKey = toHex(ed25519.getPublicKey(priv))
  const key = await generateKeyPairFromSeed('Ed25519', priv)
  const peerId = peerIdFromPrivateKey(key).toString()

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
    nodeKey,
    peerId,
    records: {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: [...FEATURES],
        sovereignFor: [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
        extensions: [],
      }),
    },
  }
}

/** The provider every fixture enrols with, so its key is the one issuer to trust. */
const ISSUER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(60)))
const TRUSTED: ReadonlySet<PublicKeyHex> = new Set([ISSUER_KEY])

/**
 * The real check, and it is the one the fabric runs.
 *
 * The `nodeKey` clause is the load-bearing one for this file: both signatures can be
 * perfectly valid on a record that is simply *about somebody else*, and a DHT read is
 * exactly where that arrives — the key is chosen by whoever wrote the value.
 */
function reallyVerify(nodeKey: PublicKeyHex, records: NodeRecords): boolean {
  return (
    records.certificate.nodeKey === nodeKey &&
    verifyCertificate(records.certificate, TRUSTED, NOW).ok &&
    verifyCapabilityRecord(records.capabilities, NOW)
  )
}

async function infoFor(seedByte: number, addr: string): Promise<PeerInfo> {
  const key = await generateKeyPairFromSeed('Ed25519', new Uint8Array(32).fill(seedByte))
  return { id: peerIdFromPrivateKey(key), multiaddrs: [multiaddr(addr)] }
}

/** An index that answers exactly what it was given, and counts how often it was asked. */
class StubIndex implements RecordIndex {
  providerCalls = 0
  recordCalls = 0
  readonly #keys: readonly PublicKeyHex[]
  readonly #records: NodeRecords | undefined

  constructor(keys: readonly PublicKeyHex[], records?: NodeRecords) {
    this.#keys = keys
    this.#records = records
  }

  async providers(): Promise<readonly PublicKeyHex[]> {
    this.providerCalls += 1
    return this.#keys
  }

  async recordsFor(): Promise<NodeRecords | undefined> {
    this.recordCalls += 1
    return this.#records
  }
}

async function* nothing(): AsyncIterable<QueryEvent> {}

async function* emitting(events: readonly QueryEvent[]): AsyncIterable<QueryEvent> {
  for (const event of events) yield event
}

/**
 * A complete `KadDHT`, not a partial mock.
 *
 * The methods under test are overridden per case; every other member is present and inert.
 * A partial mock cast into place would compile today and silently stop matching the
 * interface the day the library grows a member this class starts using.
 */
function fakeDht(over: Partial<KadDHT>): KadDHT {
  const base: KadDHT = {
    k: 20,
    a: 3,
    d: 3,
    validators: {},
    selectors: {},
    get: () => nothing(),
    findProviders: () => nothing(),
    findPeer: () => nothing(),
    getClosestPeers: () => nothing(),
    provide: () => nothing(),
    cancelReprovide: async () => {},
    put: () => nothing(),
    getMode: () => 'client',
    setMode: async () => {},
    refreshRoutingTable: async () => {},
  }
  return { ...base, ...over }
}

function valueEvent(value: Uint8Array<ArrayBuffer>): QueryEvent {
  return { name: 'VALUE', value } as Extract<QueryEvent, { name: 'VALUE' }>
}

function providerEvent(providers: readonly PeerInfo[]): QueryEvent {
  return { name: 'PROVIDER', providers: [...providers] } as Extract<QueryEvent, { name: 'PROVIDER' }>
}

interface Overrides {
  readonly providersFrom?: RecordIndex
  readonly recordsFallback?: RecordIndex | 'answers-from-the-dht-alone'
  readonly verify?: (nodeKey: PublicKeyHex, records: NodeRecords) => boolean | Promise<boolean>
  readonly addresses?: ((info: PeerInfo) => void) | 'discards-provider-addresses'
}

function makeIndex(dht: KadDHT, over: Overrides = {}): DhtRecordIndex {
  return new DhtRecordIndex({
    dht,
    providersFrom: over.providersFrom ?? new StubIndex([]),
    recordsFallback: over.recordsFallback ?? 'answers-from-the-dht-alone',
    verify: over.verify ?? reallyVerify,
    timeoutMs: 50,
    addresses: over.addresses ?? 'discards-provider-addresses',
  })
}

// ---------------------------------------------------------------------------

describe('the keyspace is the fabric’s own, and it is keyed by node key', () => {
  it('namespaces the key and carries the node key in it verbatim', async () => {
    const one = await subject(11)

    // Plant that reddens this: change `O2_KEY_PREFIX`, or build the key from a peer id.
    expect(new TextDecoder().decode(dhtKeyForNodeKey(one.nodeKey))).toBe(
      `${O2_KEY_PREFIX}${one.nodeKey}`,
    )
    // The hazard the whole design avoids: no peer id spelling appears in the key, so
    // there is no cross-namespace comparison available to get wrong.
    expect(new TextDecoder().decode(dhtKeyForNodeKey(one.nodeKey))).not.toContain(one.peerId)
  })
})

describe('providers is a union, so the DHT can only add', () => {
  it('returns what the DHT found AND what the composed index found', async () => {
    const one = await subject(12)
    const rpcOnly = 'a'.repeat(64)
    const composed = new StubIndex([rpcOnly])
    const info = await infoFor(12, '/ip4/1.2.3.4/tcp/1')
    const index = makeIndex(
      fakeDht({ findProviders: () => emitting([providerEvent([info])]) }),
      { providersFrom: composed },
    )

    const answer = await index.providers(CID_UNDER_TEST)

    // Plant that reddens this: return only `fromDht`, or only `fromPeers`.
    expect(answer).toStrictEqual([one.nodeKey, rpcOnly].sort())
    expect(composed.providerCalls).toBe(1)
  })

  it('still answers the composed index’s providers when the DHT throws', async () => {
    const rpcOnly = 'b'.repeat(64)
    const composed = new StubIndex([rpcOnly])
    const index = makeIndex(
      fakeDht({
        findProviders: () => {
          throw new Error('no routing table')
        },
      }),
      { providersFrom: composed },
    )

    // Plant that reddens this: let the DHT error propagate instead of degrading.
    expect(await index.providers(CID_UNDER_TEST)).toStrictEqual([rpcOnly])
  })

  it('hands a discovered provider’s addresses to the sink, and returns its key', async () => {
    const one = await subject(13)
    const seen: PeerInfo[] = []
    const info = await infoFor(13, '/ip4/9.9.9.9/tcp/1')
    const index = makeIndex(
      fakeDht({ findProviders: () => emitting([providerEvent([info])]) }),
      { addresses: (each) => seen.push(each) },
    )

    const answer = await index.providers(CID_UNDER_TEST)

    // Plant that reddens this: drop the sink call. Without it a caller holds a node key
    // libp2p has no address for, so a successful lookup yields an undialable candidate.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.multiaddrs).toHaveLength(1)
    expect(answer).toStrictEqual([one.nodeKey])
  })
})

describe('recordsFor prefers a verified DHT record and never trusts one blindly', () => {
  it('returns the DHT’s record without asking the fallback at all', async () => {
    const one = await subject(14)
    const fallback = new StubIndex([], one.records)
    const index = makeIndex(fakeDht({ get: () => emitting([valueEvent(encodeNodeRecords(one.records))]) }), {
      recordsFallback: fallback,
    })

    // Plant that reddens this: always consult the fallback.
    expect(await index.recordsFor(one.nodeKey)).toStrictEqual(one.records)
    expect(fallback.recordCalls).toBe(0)
  })

  it('falls back when the DHT holds nothing', async () => {
    const one = await subject(15)
    const fallback = new StubIndex([], one.records)
    const index = makeIndex(fakeDht({}), { recordsFallback: fallback })

    // Plant that reddens this: return undefined instead of consulting the fallback.
    expect(await index.recordsFor(one.nodeKey)).toStrictEqual(one.records)
    expect(fallback.recordCalls).toBe(1)
  })

  it('refuses a real record filed under somebody else’s key', async () => {
    const mine = await subject(16)
    const theirs = await subject(17)
    // `theirs.records` is genuinely signed — it is simply not about `mine.nodeKey`. The
    // real verifier is what catches it, which is why this case does not stub `verify`.
    const index = makeIndex(
      fakeDht({ get: () => emitting([valueEvent(encodeNodeRecords(theirs.records))]) }),
    )

    // Plant that reddens this: drop the `certificate.nodeKey === nodeKey` clause from
    // the verifier, or skip verification entirely.
    expect(await index.recordsFor(mine.nodeKey)).toBeUndefined()
    expect(index.unverifiedRecords).toBe(1)
  })

  it('does NOT let an unverifiable value suppress a good one behind it', async () => {
    const mine = await subject(18)
    const theirs = await subject(19)
    const index = makeIndex(
      fakeDht({
        get: () =>
          emitting([
            valueEvent(encodeNodeRecords(theirs.records)), // somebody else's, parked here
            valueEvent(encodeNodeRecords(mine.records)),
          ]),
      }),
    )

    // Plant that reddens this: `return undefined` on the first verification failure.
    // That plant IS the suppression attack — anyone able to write to the keyspace could
    // hide a node by publishing a wrong record under its key.
    expect(await index.recordsFor(mine.nodeKey)).toStrictEqual(mine.records)
    expect(index.unverifiedRecords).toBe(1)
  })

  it('treats bytes that are not a record as “keep looking”, not as an answer', async () => {
    const one = await subject(20)
    const fallback = new StubIndex([], one.records)
    const index = makeIndex(
      fakeDht({ get: () => emitting([valueEvent(Uint8Array.from([0xff, 0xff, 0xff]))]) }),
      { recordsFallback: fallback },
    )

    // Plant that reddens this: return `undefined` on a decode failure without consulting
    // the fallback.
    expect(await index.recordsFor(one.nodeKey)).toStrictEqual(one.records)
    expect(fallback.recordCalls).toBe(1)
  })
})

describe('every query is bounded', () => {
  it('passes an AbortSignal on both halves', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const index = makeIndex(
      fakeDht({
        get: (_key, options) => {
          signals.push(options?.signal)
          return nothing()
        },
        findProviders: (_key, options) => {
          signals.push(options?.signal)
          return nothing()
        },
      }),
    )

    await index.providers(CID_UNDER_TEST)
    await index.recordsFor('c'.repeat(64))

    // Plant that reddens this: drop `#routing()` from either call. An unbounded query
    // against an empty routing table waits rather than answering.
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })
})
