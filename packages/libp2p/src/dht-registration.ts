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

/**
 * Which of several records for one key is the one to believe — and **the keyspace could not
 * be read without it.**
 *
 * `kad-dht` resolves a `get` through `bestRecord`, which looks the namespace up in
 * `selectors` and throws `MissingSelectorError` when there is none
 * (`record/selectors.ts:23-25`). Registering `validators` and not `selectors` therefore
 * produces a keyspace that accepts writes and answers **every** read with an error — which
 * is what this repository had, measured 2026-08-23: a record put by one node and held by
 * another came back `undefined` at the reader, and the error was swallowed by
 * `DhtRecordIndex`'s own timeout catch, so it presented as *"the DHT holds nothing"*.
 *
 * ## The rule, and why it is not "trust the first answer"
 *
 * A node re-publishes as its certificate is renewed, so two honest records for one key
 * differ in age and the fresher one is the one a requestor wants — an expired certificate
 * would otherwise be preferred purely because a peer answered sooner. Every candidate here
 * has already passed {@link o2RecordValidator} on this node, so each is *some* valid record
 * for *this* key; the only remaining question is which is newest.
 *
 * `issuedAt` on the capability record, not on the certificate: one certificate covers many
 * capability records, so the certificate's own timestamp cannot separate two publications
 * under it.
 *
 * Ties and undecodables resolve to the earliest index, which keeps the answer a function of
 * the values rather than of arrival order — two nodes handed the same set choose the same
 * record.
 *
 * Declared as a `function` rather than as `const o2RecordSelector: SelectFn = …` on purpose:
 * `reachability.node.test.ts` measures how many callable exports the graph understates because
 * a callable const classifies as `other-value`, and pins that understatement at one named
 * symbol. A second one would not be wrong, it would be unmeasured — and the register exists so
 * that number cannot grow silently.
 */
export function o2RecordSelector(_key: Uint8Array, records: Uint8Array[]): number {
  let best = 0
  let bestIssuedAt = Number.NEGATIVE_INFINITY
  for (let i = 0; i < records.length; i++) {
    const raw = records[i]
    if (raw === undefined) continue
    const decoded = decodeNodeRecords(raw as Uint8Array<ArrayBuffer>)
    // Not a record at all. It cannot be *the* answer, and it must not throw — a selector
    // that threw would put the whole keyspace back where the missing one left it.
    if (decoded === null) continue
    if (decoded.capabilities.issuedAt > bestIssuedAt) {
      bestIssuedAt = decoded.capabilities.issuedAt
      best = i
    }
  }
  return best
}

/** What {@link publishRecords} did, as a value rather than a thrown outcome. */
export type PublishOutcome =
  | {
      readonly kind: 'published'
      readonly key: string
      /**
       * How many peers answered the put — **not** decoration, and the field this type
       * was missing.
       *
       * `kad-dht`'s `put` writes the record into the local datastore *first* and only
       * then walks to the closest peers (`content-fetching/index.ts:149-158`). So a put
       * against an empty routing table stores locally, yields no events, throws nothing,
       * and was reported here as `published` — a node that had reached nobody reading as
       * a node that had registered. Counting `PEER_RESPONSE` is what makes the difference
       * legible, and it is a number a test can assert rather than an absence of an
       * exception.
       *
       * Zero is therefore a real and expected value on the way up, not a failure: it is
       * what a node publishes to before it has met anybody, which is why
       * {@link RecordPublisher} publishes again when a peer arrives.
       */
      readonly peers: number
    }
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
    let peers = 0
    // Draining the query is what performs it — the async iterable is lazy, and a `put`
    // whose events are never read is a `put` that never happened.
    for await (const event of dht.put(key, value, options)) {
      // Events are progress, and one of them is the only evidence the record left this
      // process. See {@link PublishOutcome} for why "did not throw" is not that evidence.
      if (event.name === 'PEER_RESPONSE') peers += 1
    }
    return { kind: 'published', key: new TextDecoder().decode(key), peers }
  } catch (cause) {
    return { kind: 'refused', reason: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * How a publisher learns the routing table may have gained somebody.
 *
 * A **subscription**, not a peer list: this module has no business knowing what a peer is,
 * and the two tiers reach the same event through different objects. Returns the
 * unsubscribe so a stopped node leaves no listener behind.
 */
export interface PeerArrivals {
  (listener: () => void): () => void
}

/**
 * Keeps this node's records in the keyspace — the wiring half of SCHED-01 / NET-06.
 *
 * ## Why publishing once is not publishing
 *
 * `publishRecords` is a single `put`, and a `put` is bounded by the routing table that
 * exists at the instant it runs. A node publishes on the way up, when that table is
 * empty — `kad-dht` stores the record locally, reaches nobody, and reports success. The
 * record is then in exactly one place: the node that already knew it. Nothing about that
 * is an error, and nothing about it is registration either.
 *
 * So the trigger is not *start*, it is *start and every time a peer arrives*. The first
 * peer to arrive is the first one that could store the record, and by then the start-time
 * put has long returned.
 *
 * ## Why publishes do not queue
 *
 * A node meeting twenty peers in a burst would otherwise run twenty walks of the same key
 * with the same bytes. `#inFlight` collapses them: an arrival during a publish is answered
 * by one more publish *after* it, never by a second concurrent one, so the table gained
 * between the two is still covered and the work is bounded by rounds rather than by peers.
 *
 * ## Why nothing here throws
 *
 * Inherited from `publishRecords` and restated because it is the property that lets this
 * be constructed on a start path at all: a node that cannot reach the DHT is a working
 * node that answers over RPC. Outcomes accumulate on {@link RecordPublisher.outcomes} so a
 * caller — or a test — can read what actually happened instead of inferring it.
 */
export class RecordPublisher {
  readonly #dht: KadDHT
  readonly #records: NodeRecords | (() => NodeRecords | undefined)
  readonly #outcomes: PublishOutcome[] = []
  #unsubscribe: (() => void) | null = null
  #inFlight: Promise<PublishOutcome> | null = null
  #again = false
  #stopped = false

  /**
   * `records` may be a value or a thunk asked again on every publish.
   *
   * **The thunk arm is what makes renewal visible.** A registration record outlives the
   * certificate inside it — the keyspace holds a value record for far longer than a
   * certificate is valid — so a node that renewed and republished its *original* records
   * would go on advertising the expired certificate, and every reader running
   * `verifyCertificate` would discard it. Held as a value this class was that defect, in
   * the same shape `SelfRecordIndex` carried it.
   *
   * The thunk returning `undefined` means *"this node currently has nothing to register"*,
   * and the publish is refused rather than fabricated.
   */
  constructor(dht: KadDHT, records: NodeRecords | (() => NodeRecords | undefined)) {
    this.#dht = dht
    this.#records = records
  }

  /** Every publish this node has performed, in order. The last one is the current state. */
  get outcomes(): readonly PublishOutcome[] {
    return this.#outcomes
  }

  /** The peer count of the most recent successful publish, or 0 if none has succeeded. */
  get peers(): number {
    for (let i = this.#outcomes.length - 1; i >= 0; i--) {
      const outcome = this.#outcomes[i]
      if (outcome !== undefined && outcome.kind === 'published') return outcome.peers
    }
    return 0
  }

  /**
   * Publish now, and again whenever `arrivals` fires.
   *
   * The sentinel arm is for a caller that has no arrival signal to give — a fixture, or a
   * node whose transport cannot gain peers — and it is spelled out rather than defaulted
   * so publishing once is a decision somebody made.
   */
  async start(arrivals: PeerArrivals | 'publishes-once'): Promise<PublishOutcome> {
    if (arrivals !== 'publishes-once') {
      this.#unsubscribe = arrivals(() => {
        void this.publish()
      })
    }
    return this.publish()
  }

  /** Stop republishing. Idempotent; a publish already in flight is left to finish. */
  stop(): void {
    this.#stopped = true
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }

  /**
   * One publish, collapsing concurrent callers onto the in-flight one plus at most one
   * follow-up. See the class doc for why the follow-up is not simply dropped.
   */
  async publish(): Promise<PublishOutcome> {
    if (this.#stopped) {
      return { kind: 'refused', reason: 'publisher stopped' }
    }
    if (this.#inFlight !== null) {
      this.#again = true
      return this.#inFlight
    }
    const held = typeof this.#records === 'function' ? this.#records() : this.#records
    if (held === undefined) {
      return { kind: 'refused', reason: 'node holds no records to publish' }
    }
    const run = async (): Promise<PublishOutcome> => {
      const outcome = await publishRecords(this.#dht, held)
      this.#outcomes.push(outcome)
      return outcome
    }
    this.#inFlight = run()
    try {
      return await this.#inFlight
    } finally {
      this.#inFlight = null
      if (this.#again && !this.#stopped) {
        this.#again = false
        void this.publish()
      }
    }
  }
}
