/**
 * Registration — putting this node's own signed records into the fabric's keyspace.
 *
 * The write half of SCHED-01 / NET-06. `DhtRecordIndex` reads; this publishes, and the
 * validator here is what decides whose record may occupy which key.
 *
 * ## The validator is a storage gate, not a trust decision
 *
 * Kademlia peers store records for keys they did not choose, written by peers they have no
 * opinion about. A validator runs on **every** peer on the path — the writer, each storer,
 * and the reader — so it is the only check in the system that is enforced by parties with
 * no stake in the answer.
 *
 * What it can therefore check is *self-consistency*, and that turns out to be exactly the
 * property worth having: **only the holder of the private key for `<nodeKey>` can write to
 * `/o2/<nodeKey>`.** The capability record is signed by the node's own key, so any peer can
 * check that signature; and the key's own tail must equal the `nodeKey` inside the record.
 * A peer that tries to park somebody else's record — or its own record under somebody
 * else's key — is refused by every honest storer without any of them knowing who is
 * trusted.
 *
 * What it explicitly does **not** check is the certificate's issuer signature. A disinterested
 * storer does not know the reader's `trustedIssuers` and cannot: the same certificate is
 * valid for one requestor and worthless to another. That check belongs to the reader and
 * `DhtRecordIndex` performs it there. Splitting it this way is deliberate — a validator
 * that tried to make a trust decision would either refuse records that are fine for
 * somebody else, or accept records by consulting a trust set it has no business holding.
 *
 * ## Refusals throw, because that is the interface
 *
 * `ValidateFn` signals rejection by rejecting. Returning normally is acceptance, so every
 * path that has not proved the record good must throw before it falls out of the bottom.
 */

import type { ValidateFn } from '@libp2p/kad-dht'
import type { KadDHT } from '@libp2p/kad-dht'
import type { NodeRecords } from '@o2/core'
import { verifyCapabilityRecord } from '@o2/core'
import { decodeNodeRecords, encodeNodeRecords } from '@o2/net'
import { O2_KEY_PREFIX, dhtKeyForNodeKey } from './dht-record-index.ts'

/**
 * The namespace `@libp2p/kad-dht` dispatches a validator on.
 *
 * It splits a key on `/` and looks up `parts[1]`, so `/o2/<nodeKey>` dispatches on `o2`.
 * Derived from {@link O2_KEY_PREFIX} rather than written twice: if the prefix ever moves,
 * a validator registered under a stale name would not be *wrong*, it would simply never be
 * consulted — and `put` would start failing with "no validator available" at runtime
 * instead of at build time.
 */
export const O2_RECORD_NAMESPACE: string = O2_KEY_PREFIX.replaceAll('/', '')

/** Why a record was refused a place in the keyspace. Each is a thrown message. */
export type RecordRefusal =
  | 'not-a-record'
  | 'key-has-no-namespace'
  | 'key-names-another-node'
  | 'capabilities-do-not-verify'

export class RecordRefused extends Error {
  readonly refusal: RecordRefusal

  constructor(refusal: RecordRefusal, detail: string) {
    super(`${refusal}: ${detail}`)
    this.name = 'RecordRefused'
    this.refusal = refusal
  }
}

/**
 * Reject anything that is not this node's-own-record-under-its-own-key.
 *
 * Registered as `validators: { [O2_RECORD_NAMESPACE]: o2RecordValidator(now) }`. The clock
 * is a parameter because a capability record carries `issuedAt`/`expiresAt` and a validator
 * that read the wall clock directly could not be tested against a fixed one.
 */
export function o2RecordValidator(now: () => number): ValidateFn {
  return (key: Uint8Array, value: Uint8Array): void => {
    const keyString = new TextDecoder().decode(key)
    const parts = keyString.split('/')
    // `['', 'o2', '<nodeKey>']` — anything shorter cannot name a subject at all.
    if (parts.length < 3) {
      throw new RecordRefused('key-has-no-namespace', keyString)
    }
    const subject = parts[2]

    const records = decodeNodeRecords(value as Uint8Array<ArrayBuffer>)
    if (records === null) {
      throw new RecordRefused('not-a-record', `${value.byteLength} bytes under ${keyString}`)
    }

    // BOTH halves, not one. A record whose certificate names the subject while its
    // capabilities name somebody else would otherwise pass here and then be read as the
    // subject's claims — which is the same two-spellings confusion this keyspace is shaped
    // to make impossible, arriving through the back door.
    if (records.certificate.nodeKey !== subject || records.capabilities.nodeKey !== subject) {
      throw new RecordRefused(
        'key-names-another-node',
        `key names ${subject}, record names ${records.certificate.nodeKey}/${records.capabilities.nodeKey}`,
      )
    }

    // The one signature a disinterested storer can check: the node signed its own claims.
    // This is what makes the key ownable — without it, anyone could write any well-formed
    // record under any key whose tail they copied.
    if (!verifyCapabilityRecord(records.capabilities, now())) {
      throw new RecordRefused('capabilities-do-not-verify', subject)
    }
  }
}

/** What {@link publishRecords} did, as a value rather than a thrown outcome. */
export type PublishOutcome =
  | { readonly kind: 'published'; readonly key: string }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * Put this node's own records into the keyspace under its own key.
 *
 * **Failure is returned, never thrown.** Publishing is something a node does *on the way
 * up*; a node that cannot reach the DHT yet is still a working node that serves records
 * over RPC, and a start path that aborted here would make the DHT a hard dependency of
 * booting. The caller decides what a refusal means.
 *
 * `put` walks the network, so it is bounded by the caller's signal like every other query.
 */
export async function publishRecords(
  dht: KadDHT,
  records: NodeRecords,
  options: { readonly signal?: AbortSignal } = {},
): Promise<PublishOutcome> {
  const key = dhtKeyForNodeKey(records.certificate.nodeKey)
  try {
    const value = encodeNodeRecords(records)
    // Draining the query is what performs it — the async iterable is lazy, and a `put`
    // whose events are never read is a `put` that never happened.
    for await (const _event of dht.put(key, value, options)) {
      // Events are progress, not outcome. A `put` reports success by not throwing.
    }
    return { kind: 'published', key: new TextDecoder().decode(key) }
  } catch (cause) {
    return { kind: 'refused', reason: cause instanceof Error ? cause.message : String(cause) }
  }
}
