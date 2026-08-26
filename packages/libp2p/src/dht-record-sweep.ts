/**
 * Bounding what the DHT's datastore holds — the storage half of the expiry ruling.
 *
 * ## Why this exists when the library already has a sweep
 *
 * `@libp2p/kad-dht@16.4.0` expires both record families, and neither mechanism runs where
 * this fabric is about to put its records.
 *
 * - **Provider records** are swept by `src/reprovider.ts`, whose driver is
 *   `setTimeout(..., this.interval)` re-armed inside `processRecords`' own `finally`
 *   (`reprovider.ts:97,168-177`).
 * - **Value records** — the `/o2/<nodeKey>` `NodeRecords` this fabric actually publishes —
 *   have **no sweep at all**. `rpc/handlers/get-value.ts:129-135` deletes a record older
 *   than `PROVIDERS_VALIDITY` *on the way out of a read*, and only when a `GET_VALUE` names
 *   that exact key. A record nobody queries is never examined.
 *
 * On a Node process both are tolerable: the timer runs, and the datastore is discarded on
 * restart. On a Durable Object neither holds. A workerd isolate's timers are not guaranteed
 * to survive between requests, so the reprovider's `setTimeout` never fires; and DO storage
 * persists by definition, so nothing is discarded. **Persistence is what turns "expires
 * lazily" into "accumulates".** That is why `.planning/research/v2.0/ARCHITECTURE.md:444`
 * orders this module *before or with* persistence rather than after it.
 *
 * ## What is deliberately NOT here
 *
 * The **correctness** half needs no new code and must not be re-built here.
 * `verifyCapabilityRecord` (`packages/core/src/discovery.ts:334`) already refuses an expired
 * record on every read, on every tier, because it lives in the consumer — `DhtRecordIndex`
 * routes every DHT-sourced record through it. A record this sweep has not yet reached is
 * already unusable; what it cannot be is *unstored*. So this module bounds bytes, not truth.
 *
 * Nothing here is Cloudflare-specific and nothing here schedules itself. It is a pure walk
 * over an `interface-datastore` with an injected clock, which is what makes it provable in
 * `--project node` against a real store with no deployment in existence — the split
 * `ARCHITECTURE.md:263` asks for, leaving only "call it from `alarm()`" on the far side of a
 * deploy.
 */

import { Libp2pRecord } from '@libp2p/record'
import { decodeNodeRecords } from '@o2/net'
import type { Datastore, Pair } from 'interface-datastore'
import * as varint from 'uint8-varint'

/**
 * The datastore prefix `kadDHT()` uses when none is given — `kad-dht.ts:159`.
 *
 * Both families hang off it: `content-fetching/index.ts:52`, `rpc/handlers/get-value.ts:36`
 * and `rpc/handlers/put-value.ts:33` each append `/record`; `providers.ts:33` and
 * `reprovider.ts:80` each append `/provider`. Stated here as one constant because a sweep
 * pointed at the wrong prefix finds nothing and reports a clean `{swept: 0}` — a silent
 * pass, which is the failure mode this whole module exists to prevent elsewhere.
 */
export const DEFAULT_DHT_DATASTORE_PREFIX = '/dht'

/** What one pass over one prefix did. */
export interface SweepCounts {
  /** Entries deleted because they had expired. */
  readonly swept: number
  /** Entries left in place — unexpired, or this node's own provide intent. */
  readonly kept: number
  /**
   * Entries this sweep could not read, and therefore did **not** delete.
   *
   * Kept rather than removed on purpose. The private keyspace registers validators
   * (`dht-record-index.ts`), so a value that does not decode did not arrive through the
   * ordinary write path — it is corruption or a shape change, and deleting what you cannot
   * read turns a decoding bug into data loss. The count is the alarm instead: a number that
   * is not zero is a reading to explain, not a quantity to sweep.
   */
  readonly undecodable: number
}

/** A per-entry verdict. The two families differ only in this function. */
type Verdict = 'delete' | 'keep' | 'undecodable'

/**
 * The one walk both families share.
 *
 * `ARCHITECTURE.md:266` asks for exactly this: *"One alarm, two prefixes, one shared 'walk +
 * decide + delete' shape — not two unrelated mechanisms that happen to share a file."*
 */
async function walk(
  datastore: Datastore,
  prefix: string,
  decide: (entry: Pair) => Verdict,
): Promise<SweepCounts> {
  let swept = 0
  let kept = 0
  let undecodable = 0
  for await (const entry of datastore.query({ prefix })) {
    const verdict = decide(entry)
    if (verdict === 'undecodable') {
      undecodable += 1
      continue
    }
    if (verdict === 'keep') {
      kept += 1
      continue
    }
    await datastore.delete(entry.key)
    swept += 1
  }
  return { swept, kept, undecodable }
}

/** What both sweeps need. */
export interface SweepOptions {
  /** The store backing `kadDHT()`'s own records. */
  readonly datastore: Datastore
  /**
   * The clock, injected.
   *
   * **Read once per pass, never per entry.** A sweep that re-read the clock inside its loop
   * would apply two different `now`s to two records in one walk, so whether a record on the
   * boundary survives would depend on where in the directory listing it happened to sit.
   */
  readonly now: () => number
  /** Defaults to {@link DEFAULT_DHT_DATASTORE_PREFIX}; pass what `kadDHT()` was given. */
  readonly datastorePrefix?: string
}

/**
 * Delete `/o2/<nodeKey>` records whose capabilities have expired.
 *
 * The stored bytes are a `Libp2pRecord` (`@libp2p/record`) whose `value` is the encoded
 * `NodeRecords`, so the shape is read back through **`decodeNodeRecords`, the same function
 * `DhtRecordIndex` reads the wire with** (`dht-record-index.ts:278`). One definition of the
 * shape rather than two that could drift — the hazard `dht-record-index.ts`'s own header
 * names.
 *
 * **The criterion is time and nothing else: `capabilities.expiresAt <= now`.** That is one
 * clause of `verifyCapabilityRecord` and deliberately not all of it. The other two clauses
 * must not delete:
 *
 * - A **bad signature** is a correctness verdict, and the read path already refuses it. If
 *   the sweep deleted on it, any bug in verification — or one wrong trust anchor — would
 *   turn silently into data loss, and there is no undo for a delete.
 * - **`issuedAt > now`** (not yet valid) is a clock-skew reading, and such a record becomes
 *   valid by waiting. Sweeping it would delete a record for being early.
 *
 * Note the comparison is `<=`, while {@link sweepProviderRecords} uses a strict `>`. That is
 * not an oversight and must not be harmonised: each matches the code that decides the same
 * question elsewhere — `discovery.ts:335` refuses at `expiresAt <= now`, while
 * `reprovider.ts:133` expires at `now > created + validity`. A record this sweep keeps is
 * one the read path would still serve, in both families, by construction.
 */
export async function sweepValueRecords(options: SweepOptions): Promise<SweepCounts> {
  const prefix = `${options.datastorePrefix ?? DEFAULT_DHT_DATASTORE_PREFIX}/record`
  const at = options.now()
  return walk(options.datastore, prefix, (entry) => {
    let expiresAt: number
    try {
      const stored = Libp2pRecord.deserialize(entry.value)
      // A copy rather than a cast: `decodeNodeRecords` wants `Uint8Array<ArrayBuffer>` and
      // `Libp2pRecord.value` is declared plainly. Copying makes the type true instead of
      // asserted, and a DHT record is small.
      const records = decodeNodeRecords(new Uint8Array(stored.value))
      if (records === null) return 'undecodable'
      expiresAt = records.capabilities.expiresAt
    } catch {
      return 'undecodable'
    }
    return expiresAt <= at ? 'delete' : 'keep'
  })
}

/** What the provider sweep needs beyond {@link SweepOptions}. */
export interface ProviderSweepOptions extends SweepOptions {
  /**
   * How long an entry about another node is kept — `providerRecordPolicy().validity`.
   *
   * Required, with no default, because the library's own 48 h is sited against a
   * long-running IPFS daemon and this fabric sets its own (`constants.ts`'s
   * `PROVIDER_RECORD_VALIDITY_MS`). A sweep silently defaulting to the library's number
   * would keep records four dozen hours past what the node advertising them believes.
   */
  readonly validityMs: number
  /**
   * This node's own peer id, as `peerId.toString()` writes it into the key.
   *
   * **Required, and it is not ceremony.** `reprovider.ts:139-142` exempts `isSelf` in so
   * many words — *"so that if user node is down for a while, we still persist provide
   * intent"* — and a sweep that forgot it would delete this node's own advertisements every
   * pass, silently, leaving a node that provides blocks nobody can find. Making it a
   * required argument is what stops it being forgotten, the same reason
   * `CloudflareWebSocketConnection` fixes `direction` by construction rather than defaulting
   * it.
   */
  readonly selfPeerId: string
}

/**
 * Delete provider entries about **other** nodes that have outlived `validityMs`.
 *
 * The criterion is `reprovider.ts:130-134`'s, term for term: the value is a varint-encoded
 * millisecond timestamp (`providers.ts:69`, `utils.ts:150`), the key's last segment is the
 * providing peer (`utils.ts:135-148`), and an entry expires at `now > created + validity`.
 *
 * The peer is compared **as the string the key already holds**, not by parsing it back into
 * a `PeerId`. `toProviderKey` writes `peerId.toString()` and nothing else, so the comparison
 * is exact; parsing would add a decode that can throw on the one path whose whole job is to
 * be safe to run unattended.
 */
export async function sweepProviderRecords(options: ProviderSweepOptions): Promise<SweepCounts> {
  const prefix = `${options.datastorePrefix ?? DEFAULT_DHT_DATASTORE_PREFIX}/provider`
  const at = options.now()
  return walk(options.datastore, prefix, (entry) => {
    const peerId = entry.key.toString().split('/').pop()
    if (peerId === undefined || peerId === '') return 'undecodable'
    if (peerId === options.selfPeerId) return 'keep'
    let created: number
    try {
      created = varint.decode(entry.value)
    } catch {
      return 'undecodable'
    }
    return at > created + options.validityMs ? 'delete' : 'keep'
  })
}

/** Both families, one pass each — what an alarm calls. */
export interface DhtSweepCounts {
  readonly values: SweepCounts
  readonly providers: SweepCounts
}

/**
 * Sweep both prefixes.
 *
 * This is the surface the Cloudflare-tier alarm is written against, so that "one alarm, two
 * prefixes" stays true at the call site rather than being an arrangement the caller has to
 * remember. Sequential rather than concurrent: the two walks share one datastore, and a
 * store whose deletes are serialised behind a queue — which `FsDatastore` says of itself in
 * its own header — gains nothing from interleaving them.
 */
export async function sweepDhtRecords(options: ProviderSweepOptions): Promise<DhtSweepCounts> {
  const values = await sweepValueRecords(options)
  const providers = await sweepProviderRecords(options)
  return { values, providers }
}
