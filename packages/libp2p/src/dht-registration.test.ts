import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  publishCapabilities,
  requestEnrollment,
  toHex,
} from '@o2/core'
import type { NodeRecords, PublicKeyHex } from '@o2/core'
import { encodeNodeRecords } from '@o2/net'
import { describe, expect, it } from 'vitest'
import { dhtKeyForNodeKey } from './dht-record-index.ts'
import { O2_RECORD_NAMESPACE, o2RecordValidator, publishRecords } from './dht-registration.ts'
import type { KadDHT, QueryEvent } from '@libp2p/kad-dht'

/**
 * Registration — who may write to `/o2/<nodeKey>`.
 *
 * Plain `.test.ts`, so it runs under Node and in all three browser engines.
 *
 * The property under test is the one that makes the keyspace safe to read: **only the
 * holder of the secret for `<nodeKey>` can put a record at `/o2/<nodeKey>`**, and every
 * storer enforces it without knowing whom the reader trusts. Each case names the mutation
 * that reddens it.
 */

const NOW = 1_700_000_000_000
const YEAR = 365 * 24 * 60 * 60 * 1000
const clock = (): number => NOW

interface Subject {
  readonly nodeKey: PublicKeyHex
  readonly records: NodeRecords
}

async function subject(seedByte: number): Promise<Subject> {
  const priv = new Uint8Array(32).fill(seedByte)
  const nodeKey = toHex(ed25519.getPublicKey(priv))
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
    records: {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: ['bulk-memory'],
        sovereignFor: [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
        extensions: [],
      }),
    },
  }
}

describe('the namespace is derived, not written twice', () => {
  it('is the segment kad-dht dispatches a validator on', () => {
    // kad-dht splits the key on '/' and looks up parts[1]. For `/o2/<nodeKey>` that is
    // `o2`. Plant that reddens this: hardcode a different namespace string.
    const key = new TextDecoder().decode(dhtKeyForNodeKey('a'.repeat(64)))
    expect(key.split('/')[1]).toBe(O2_RECORD_NAMESPACE)
  })
})

describe('the validator makes a key ownable', () => {
  const validate = o2RecordValidator(clock)

  it('accepts a node’s own record under its own key', async () => {
    const one = await subject(31)
    expect(() => validate(dhtKeyForNodeKey(one.nodeKey), encodeNodeRecords(one.records))).not.toThrow()
  })

  it('REFUSES a genuinely signed record parked under somebody else’s key', async () => {
    const mine = await subject(32)
    const theirs = await subject(33)
    // `theirs.records` is real and its signatures are valid. The only thing wrong is the
    // key. Plant that reddens this: drop the `certificate.nodeKey !== subject` clause.
    expect(() => validate(dhtKeyForNodeKey(mine.nodeKey), encodeNodeRecords(theirs.records))).toThrow(
      /key-names-another-node/,
    )
  })

  it('refuses a record whose two halves name different nodes', async () => {
    const mine = await subject(34)
    const theirs = await subject(35)
    // Certificate says `mine`, capabilities say `theirs`. Plant that reddens this: check
    // only the certificate. That plant is the two-spellings confusion arriving by the
    // back door — the reader would take `theirs`' claims as `mine`'s.
    const spliced: NodeRecords = {
      certificate: mine.records.certificate,
      capabilities: theirs.records.capabilities,
    }
    expect(() => validate(dhtKeyForNodeKey(mine.nodeKey), encodeNodeRecords(spliced))).toThrow(
      /key-names-another-node/,
    )
  })

  it('refuses bytes that are not a record at all', async () => {
    const one = await subject(36)
    expect(() => validate(dhtKeyForNodeKey(one.nodeKey), Uint8Array.from([1, 2, 3]))).toThrow(
      /not-a-record/,
    )
  })

  it('refuses a key with no namespace', async () => {
    const one = await subject(37)
    expect(() => validate(new TextEncoder().encode('no-slashes'), encodeNodeRecords(one.records))).toThrow(
      /key-has-no-namespace/,
    )
  })

  it('refuses a record whose capability signature does not check', async () => {
    const one = await subject(38)
    const tampered: NodeRecords = {
      certificate: one.records.certificate,
      capabilities: { ...one.records.capabilities, features: ['forged-feature'] },
    }
    // The features were changed after signing, so the signature no longer covers them.
    // Plant that reddens this: skip `verifyCapabilityRecord`. Without it anyone could
    // write any well-formed record under any key whose tail they copied.
    expect(() => validate(dhtKeyForNodeKey(one.nodeKey), encodeNodeRecords(tampered))).toThrow(
      /capabilities-do-not-verify/,
    )
  })

  it('refuses a record that has expired by its own dates', async () => {
    const one = await subject(39)
    const late = o2RecordValidator(() => NOW + 2 * YEAR)
    // Plant that reddens this: pass a fixed `Date.now()` instead of the injected clock —
    // the case would then depend on the wall clock and never fail.
    expect(() => late(dhtKeyForNodeKey(one.nodeKey), encodeNodeRecords(one.records))).toThrow(
      /capabilities-do-not-verify/,
    )
  })
})

describe('publishing reports its outcome rather than throwing it', () => {
  async function* nothing(): AsyncIterable<QueryEvent> {}

  function dhtWith(put: KadDHT['put']): KadDHT {
    return {
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
      put,
      getMode: () => 'server',
      setMode: async () => {},
      refreshRoutingTable: async () => {},
    }
  }

  it('puts under the subject’s own key', async () => {
    const one = await subject(40)
    const keys: string[] = []
    const outcome = await publishRecords(
      dhtWith((key) => {
        keys.push(new TextDecoder().decode(key))
        return nothing()
      }),
      one.records,
    )

    // Plant that reddens this: key the put on anything but `certificate.nodeKey`.
    expect(outcome.kind).toBe('published')
    expect(keys).toStrictEqual([new TextDecoder().decode(dhtKeyForNodeKey(one.nodeKey))])
  })

  it('returns a refusal instead of throwing when the DHT rejects', async () => {
    const one = await subject(41)
    const outcome = await publishRecords(
      dhtWith(() => {
        throw new Error('no peers in routing table')
      }),
      one.records,
    )

    // Plant that reddens this: let the error propagate. A start path that aborted here
    // would make the DHT a hard dependency of booting a node that serves fine over RPC.
    expect(outcome).toStrictEqual({ kind: 'refused', reason: 'no peers in routing table' })
  })

  it('drains the query, because an unread put never happened', async () => {
    const one = await subject(42)
    let drained = false
    const outcome = await publishRecords(
      dhtWith(() => {
        // `async function*` with no reachable `yield` still types as an async generator, so
        // the `if (false) yield` that stood here bought nothing and `allowUnreachableCode:
        // false` correctly refuses it. The empty body is the same generator: it sets the flag
        // and produces nothing, which is what this fixture is for.
        async function* events(): AsyncIterable<QueryEvent> {
          drained = true
        }
        return events()
      }),
      one.records,
    )

    // Plant that reddens this: call `dht.put(...)` without iterating it. The async
    // iterable is lazy, so the body would never run and the record would never be sent.
    expect(drained).toBe(true)
    expect(outcome.kind).toBe('published')
  })
})
