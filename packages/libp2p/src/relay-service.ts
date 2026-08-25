import { sha256 } from 'multiformats/hashes/sha2'
import { CID } from 'multiformats/cid'
import type { PublicKeyHex, RecordIndex } from '@o2/core'

/**
 * Finding a relay by asking the keyspace, rather than by being told at startup.
 *
 * ## Why an announcement under a well-known key, and not a query
 *
 * The obvious shape — *"ask the DHT for every node whose `discoverability` is `seed`"* — is
 * not a thing a DHT can do. Kademlia looks up a **key**; it does not scan values, and no
 * amount of wiring makes it. The mechanism that fits is the one this fabric already has for
 * blocks: a node **announces itself as a provider** of a well-known key, and a requestor
 * asks who provides that key.
 *
 * ## What makes the answer trustworthy, and it was already signed
 *
 * A provider record is an unauthenticated claim — anyone reachable can announce anything.
 * What settles it is that this fabric's certificates **already carry the answer**:
 * `NodeCertificate.discoverability` is `'seed' | 'via-relay'` and `relayIds` names the
 * relays a `via-relay` node sits behind, both signed by the issuer and verifiable offline.
 * And the published record is `{ certificate, capabilities }` — the whole certificate — so
 * the keyspace has been carrying this all along with nothing reading it.
 *
 * So {@link discoverRelays} does not trust the announcement. It uses it to *narrow* the
 * search, then reads each candidate's certificate and keeps only those whose issuer said
 * `'seed'`. An attacker who announces under the well-known key without a matching
 * certificate is found and discarded, at the cost of one record lookup.
 *
 * ## The one thing this cannot do
 *
 * It cannot tell a requestor whether a relay has room. `O2_MAX_RESERVATIONS` is 64 per
 * relay and nothing in a certificate says how many are taken, because that number ages
 * faster than a record propagates. Discovery narrows the field; the dial finds out.
 */

/**
 * The key a relay announces itself under. Versioned like the protocols it sits beside, so
 * a later change of meaning is a different key rather than a silent change of answer.
 */
export const RELAY_SERVICE_KEY = '/o2/relay/1.0.0'

/**
 * The CID every relay in this fabric announces itself as a provider of.
 *
 * Derived from {@link RELAY_SERVICE_KEY} by the same hash the blockstore uses, so every
 * node computes the identical CID from the identical constant and no coordination is
 * needed. It addresses **no block** — nothing will ever fetch these bytes — and that is
 * the point: a provider record is a statement of the form *"reach me for this"*, and what
 * "this" names does not have to be data.
 */
export async function relayServiceCid(): Promise<CID> {
  return CID.createV1(0x55, await sha256.digest(new TextEncoder().encode(RELAY_SERVICE_KEY)))
}

/** How many candidates a lookup will read records for before giving up. */
export const MAX_RELAY_CANDIDATES = 16

export interface RelayDiscoveryOptions {
  /** The index to ask — the composed one in production, a fixture in a test. */
  readonly index: RecordIndex
  /** The reader's own key, so a node never offers itself a relay. */
  readonly self: PublicKeyHex
}

/**
 * Relays this node could reserve on, in the order the keyspace offered them.
 *
 * **Announcement narrows; the certificate decides.** A candidate is kept only when the
 * index holds a record for it and that record's certificate says `'seed'`. Everything else
 * is discarded silently — a failed candidate is ordinary, not exceptional, because anyone
 * reachable can write a provider record.
 *
 * There is no trust callback here on purpose. Verifying a record is the **index's** job and
 * it already does it: the composed `DhtRecordIndex` runs its `verify` before returning
 * anything, so a second policy at this layer would either duplicate that one or quietly
 * disagree with it. What this function adds is the one check the index cannot make for it,
 * because it is about what the caller wants rather than about whether the record is
 * genuine: that the issuer called this node a `seed`.
 *
 * Records are read concurrently. Sequential reads here would be the defect
 * `discoverExecutors` had until 2026-08-23: `DHT_QUERY_TIMEOUT_MS` is 5 000, so two
 * candidates whose records the keyspace does not hold would spend ten seconds between them.
 */
export async function discoverRelays(
  options: RelayDiscoveryOptions,
): Promise<readonly PublicKeyHex[]> {
  const cid = await relayServiceCid()
  const announced = await options.index.providers(cid)
  const candidates = announced
    .filter((nodeKey) => nodeKey !== options.self)
    .slice(0, MAX_RELAY_CANDIDATES)

  const settled = await Promise.allSettled(
    candidates.map(async (nodeKey) => {
      const records = await options.index.recordsFor(nodeKey)
      if (records === undefined) return null
      if (records.certificate.discoverability !== 'seed') return null
      return nodeKey
    }),
  )

  const kept: PublicKeyHex[] = []
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue
    if (outcome.value === null) continue
    kept.push(outcome.value)
  }
  return kept
}

export interface RelayTopUpOptions {
  /** Candidates, in preference order. */
  readonly discover: () => Promise<readonly PublicKeyHex[]>
  /** How many relays this node is reachable through right now. */
  readonly reserved: () => number
  /** Connect to one, which is what makes the reservation — see the note below. */
  readonly connect: (nodeKey: PublicKeyHex) => Promise<void>
  /** The ceiling. See `RELAY_RESERVATION_TARGET` for why it is small. */
  readonly target: number
}

/**
 * Reserve on discovered relays until this node holds `target` of them.
 *
 * **Connecting is what reserves.** There is no separate call: libp2p makes the reservation
 * when a node listening on `/p2p-circuit` connects to a relay. So `connect` is the whole
 * mechanism, and this function's job is only to decide *whether* and *how many times*.
 *
 * **Bounded, and the bound is arithmetic rather than taste.** A relay grants
 * `O2_MAX_RESERVATIONS` — 64 — and the library's own default is 15. If every node took a
 * slot on every relay it could find, a fabric of M relays would cap at 64 participants no
 * matter how many relays were added; at `k` slots each it caps at `64 x M / k`. Two is the
 * smallest number that survives one relay going away, which is the whole reason to hold
 * more than one.
 *
 * Re-checks `reserved()` before every connect rather than computing a count once: a
 * reservation made by a concurrent caller, or by the node's configured relays arriving
 * late, must stop this from taking another slot it does not need.
 *
 * Returns how many connections it made. A `connect` that rejects is counted as a candidate
 * used up and nothing else — an unreachable relay is the ordinary case, and throwing here
 * would turn a routine miss into a start-path failure.
 */
export async function topUpRelays(options: RelayTopUpOptions): Promise<number> {
  if (options.reserved() >= options.target) return 0

  let made = 0
  for (const nodeKey of await options.discover()) {
    if (options.reserved() >= options.target) break
    try {
      await options.connect(nodeKey)
      made += 1
    } catch {
      // An unreachable or full relay is ordinary. The next candidate gets its turn.
    }
  }
  return made
}
