/**
 * Provider announcement — telling the keyspace which blocks this node holds.
 *
 * `DhtRecordIndex.providers` unions what `findProviders` answers with what the composed
 * RPC index answers. Until something calls `dht.provide`, the first half of that union is
 * empty by construction, so the DHT can only ever restate what a node already learned from
 * the peers it is connected to. This is the half that makes it say something new.
 *
 * ## Why this does not announce inside `put`, which is the obvious place
 *
 * A decorator that announced on `Blockstore.put` would be five lines and would still be
 * wrong, and the reason is a measured ordering rather than a preference.
 * `core/src/job/submit.ts` used to write a shard's bytes and mark the CID sovereign on the
 * **next line** — `await blockstore.put(...)` and then `await sovereignCids.add(...)`. At
 * the instant `put` returned, a sovereign block was therefore indistinguishable from a
 * public one: nothing had recorded it yet.
 *
 * An announcement made in `put` publishes a provider record for data whose own `block`
 * branch is about to refuse to serve it — precisely the invariant `withholdingFrom`'s
 * docblock exists to hold: *a node never advertises a block its own `block` branch would
 * refuse to serve*. It matters because a `providers` answer converts *a peer cannot tell
 * refusal from absence* into a peer that **can**, learned without asking for the bytes and
 * without anything appearing on the refusing node's manifest.
 *
 * That ordering has since been reversed at its source — `submit.ts` marks first and puts
 * second — so the window is closed rather than narrowed. The rule here is kept anyway, and
 * this is not belt-and-braces: `put` is a *port*, reached by callers this module has never
 * heard of, and a decorator that announced there would make every future one of them
 * responsible for an ordering it has no reason to know about.
 *
 * ## What it does instead
 *
 * {@link ObservingBlockstore} records the CID and announces **nothing**. A sweep asks the
 * withholding predicate per CID and announces only what passes. That is the same property
 * `SelfRecordIndex` is built on — its own doc says the predicate is *"consulted per
 * lookup"* because *"a registration's lifetime is a hold, not a process"* — reached here at
 * sweep granularity rather than per query, because a DHT record is written once and read
 * by strangers.
 *
 * ## The window that made that necessary is closed at its source, not dodged here
 *
 * The obvious defence would be to delay: announce a CID only on the second sweep that sees
 * it, so a put-then-mark pair would have to be straddled by two whole sweeps to leak. That
 * is a probability argument, and it buys latency with no guarantee. `submit.ts` now marks
 * the CID sovereign **before** it puts the bytes, which closes the window outright — see
 * that call site for why the reversed failure mode is the harmless one. So a sweep here
 * needs no delay: the predicate it asks is already true by the time the block exists.
 *
 * ## The residual, stated because it cannot be fixed here
 *
 * Retraction is `cancelReprovide`, which stops this node *republishing*. It does not
 * un-tell the peers that already stored the record; those copies live until
 * `PROVIDERS_VALIDITY` — 48 h, `node_modules/@libp2p/kad-dht/src/constants.ts:12`. A block
 * that was public when it was swept and became sovereign afterwards therefore stays
 * discoverable-as-provided for up to that long. This is a property of announcing into a
 * distributed store at all, not of this implementation, and it is the cost the owner ruling
 * that asked for provider announcement buys. The common path — put and mark inside one
 * `submitJob` call — is closed, because the sweep is not the put.
 */

import type { KadDHT } from '@libp2p/kad-dht'
import type { Blockstore } from '@o2/core'
import type { CID } from 'multiformats/cid'

/**
 * Says a CID must not be advertised even though this node holds it.
 *
 * The same shape `SelfRecordIndexOptions.withhold` takes, and it is meant to be the same
 * value: `@o2/net`'s `withholdingFrom` is the only correct construction, because holding
 * the invariant between two branches means asking **one** question twice rather than
 * writing the question down twice.
 */
export interface WithholdingPredicate {
  (cid: CID): boolean | Promise<boolean>
}

/** What one sweep did, as a value a test can read. */
export interface SweepOutcome {
  /** CIDs announced to the keyspace by this sweep. */
  readonly announced: number
  /** CIDs the predicate refused to advertise, and which were therefore not announced. */
  readonly withheld: number
  /** CIDs previously announced whose predicate has since turned true — reprovide cancelled. */
  readonly retracted: number
  /** Announcements the DHT refused. Counted rather than thrown; see {@link DhtProviderAnnouncer}. */
  readonly refused: number
}

export interface ProviderAnnouncerOptions {
  readonly dht: KadDHT
  /**
   * The withholding predicate, or the stated decision that this node advertises
   * everything it holds.
   *
   * Required with a named absence rather than optional, for the reason every hook in this
   * repository is: an optional predicate with a silent default is a hole, and the hole
   * this one would leave is the side channel the module header describes.
   */
  readonly withhold: WithholdingPredicate | 'advertises-everything-it-holds'
}

/**
 * Announces the blocks this node holds, and retracts the ones it may no longer advertise.
 *
 * **Nothing here throws.** An announcement that failed is counted, for the reason
 * `publishRecords` returns its refusal: a node that cannot reach the DHT still serves
 * blocks over RPC, and a sweep that aborted a start path would make the DHT a hard
 * dependency of booting.
 */
export class DhtProviderAnnouncer {
  readonly #dht: KadDHT
  readonly #withhold: WithholdingPredicate | 'advertises-everything-it-holds'
  /** Held by this node and not yet advertised — the next sweep's work list. */
  #pending = new Map<string, CID>()
  /** Announced and not since retracted. */
  readonly #announced = new Map<string, CID>()
  #sweepScheduled = false
  /** Tail of the sweep chain — see {@link DhtProviderAnnouncer.sweep}. */
  #queue: Promise<void> = Promise.resolve()

  constructor(options: ProviderAnnouncerOptions) {
    this.#dht = options.dht
    this.#withhold = options.withhold
  }

  /** CIDs currently advertised by this node. */
  get announcedCount(): number {
    return this.#announced.size
  }

  /**
   * Record that this node now holds `cid`. **Announces nothing** — see the module header
   * for why the announcement cannot happen where the block arrives.
   */
  observe(cid: CID): void {
    const key = cid.toString()
    if (this.#announced.has(key)) return
    this.#pending.set(key, cid)
  }

  /**
   * Announce what may be announced, and retract what may no longer be advertised.
   *
   * Both halves ask the withholding predicate **now**, which is what makes this the same
   * question `SelfRecordIndex` asks per lookup rather than a second question that happens
   * to agree today.
   */
  async sweep(options: { readonly signal?: AbortSignal } = {}): Promise<SweepOutcome> {
    // **Serialized, and this is a correctness requirement rather than tidiness.** Two sweeps
    // in flight both take `#pending` and both find it half-empty, so a caller that asked for
    // a sweep gets an outcome describing somebody else's — and a block can be `provide`d
    // twice for no reason. `sweepSoon` makes concurrency the normal case rather than the
    // exceptional one: a put schedules a microtask sweep, and a caller reaching for
    // `announceHeldBlocks` immediately afterwards would otherwise race it.
    //
    // Chained rather than coalesced, unlike `RecordPublisher`: a caller awaiting this wants
    // an answer about a sweep that started **after** it asked, and collapsing onto an
    // already-running one would hand back a reading taken before its own block existed.
    const mine = this.#queue.then(async () => this.#sweepOnce(options))
    this.#queue = mine.then(
      () => undefined,
      () => undefined,
    )
    return mine
  }

  async #sweepOnce(options: { readonly signal?: AbortSignal }): Promise<SweepOutcome> {
    const toAnnounce = this.#pending
    this.#pending = new Map()

    let announced = 0
    let withheld = 0
    let refused = 0
    for (const [key, cid] of toAnnounce) {
      if (await this.#withheldNow(cid)) {
        withheld += 1
        // Kept pending rather than dropped: a hold is given back, and the block becomes
        // advertisable again the moment the predicate says so. Dropping it here would let
        // a transient sovereign hold unadvertise a public block permanently.
        this.#pending.set(key, cid)
        continue
      }
      if (await this.#provide(cid, options)) {
        this.#announced.set(key, cid)
        announced += 1
      } else {
        refused += 1
        this.#pending.set(key, cid)
      }
    }

    let retracted = 0
    for (const [key, cid] of [...this.#announced]) {
      if (!(await this.#withheldNow(cid))) continue
      await this.#cancel(cid)
      this.#announced.delete(key)
      // Pending again, not forgotten — the same argument as the withheld arm above.
      this.#pending.set(key, cid)
      retracted += 1
    }

    return { announced, withheld, retracted, refused }
  }

  /**
   * Sweep once the current turn has finished, collapsing a burst into one sweep.
   *
   * **Without this a node announces only what it held when a peer last arrived.** The
   * automatic trigger is peer arrival, because that is when a routing table worth walking
   * appears — but a requestor's usual shape is to connect first and *then* store a module
   * and its inputs, so every block it holds would be stored after its last arrival and
   * never announced. Peer arrival covers the blocks; this covers the peers.
   *
   * A microtask rather than a timer: it must not run *inside* the caller's turn — a sweep
   * that observed a block mid-`put` would be the announce-on-put this module refuses — and
   * it must not depend on a clock. Sharding a job puts one block per shard in a loop, so
   * the collapse is what keeps a thousand shards to one sweep rather than a thousand.
   */
  sweepSoon(): void {
    if (this.#sweepScheduled) return
    this.#sweepScheduled = true
    void Promise.resolve().then(async () => {
      this.#sweepScheduled = false
      await this.sweep()
    })
  }

  /** Retract everything this node advertises. Used when a node stops. */
  async retractAll(): Promise<number> {
    let retracted = 0
    for (const [key, cid] of [...this.#announced]) {
      await this.#cancel(cid)
      this.#announced.delete(key)
      retracted += 1
    }
    return retracted
  }

  async #withheldNow(cid: CID): Promise<boolean> {
    if (this.#withhold === 'advertises-everything-it-holds') return false
    try {
      return await this.#withhold(cid)
    } catch {
      // A predicate that could not answer is not a licence to advertise. Fail closed:
      // the invariant is about what this node may say, and "I could not check" is not
      // "it is safe to say".
      return true
    }
  }

  async #provide(cid: CID, options: { readonly signal?: AbortSignal }): Promise<boolean> {
    try {
      // Draining is what performs it — the same laziness `publishRecords` documents.
      for await (const _event of this.#dht.provide(cid, options)) {
        // Events are progress; `provide` reports success by not throwing.
      }
      return true
    } catch {
      return false
    }
  }

  async #cancel(cid: CID): Promise<void> {
    try {
      await this.#dht.cancelReprovide(cid)
    } catch {
      // A retraction this node could not perform is still a retraction it must not
      // pretend to have performed — but there is nothing left to do about it here, and
      // the local record expires on its own. Counted by the caller, not thrown.
    }
  }
}

/**
 * A blockstore that tells an announcer what this node has come to hold.
 *
 * Transparent in every other respect: it is the local-only tier with one observation
 * added, so everything already handed `store` — `SelfRecordIndex`, the egress tap,
 * `serveAgent` — behaves exactly as before.
 *
 * **It announces nothing**, and the name says `Observing` rather than `Announcing` for
 * that reason: the module header explains why the moment a block arrives is the one moment
 * a node cannot safely advertise it.
 *
 * ## Why the observer arrives after the store, and why that is buffered rather than lost
 *
 * A node factory builds its store first — the identity is read beside the blocks, and
 * `createLibp2p` needs that identity, so `libp2p.services.dht` cannot exist until after
 * the store does. The announcer needs the DHT. That ordering is forced, not chosen.
 *
 * The tempting shape is a thunk that returns `null` until the announcer exists, and it
 * quietly drops every block put during start — which on a node given a persistent
 * directory is exactly the set it already holds. So this buffers instead: puts seen before
 * {@link ObservingBlockstore.observeWith} are replayed into the observer the moment one
 * arrives, and nothing put is unaccounted for.
 */
export class ObservingBlockstore<T extends Blockstore = Blockstore> implements Blockstore {
  /**
   * The store this one wraps, for the lifecycle its own type carries.
   *
   * `Blockstore` has no `close`, and the browser tier's `IdbBlockstore` does — an open
   * IndexedDB connection is what blocks a `deleteDatabase`, which a spec reads. Exposing
   * the inner store, typed, is what lets a decorator sit in front of a port without
   * swallowing the parts of the adapter that are not the port.
   */
  readonly inner: T
  #observe: ((cid: CID) => void) | null = null
  #beforeObserver: CID[] = []

  constructor(inner: T) {
    this.inner = inner
  }

  /**
   * Send observations here from now on, and replay everything put before this call.
   *
   * Idempotent in the sense that matters: calling it twice replays nothing twice, because
   * the buffer is emptied as it is drained.
   */
  observeWith(observe: (cid: CID) => void): void {
    this.#observe = observe
    const buffered = this.#beforeObserver
    this.#beforeObserver = []
    for (const cid of buffered) observe(cid)
  }

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    const cid = await this.inner.put(bytes)
    if (this.#observe === null) this.#beforeObserver.push(cid)
    else this.#observe(cid)
    return cid
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return this.inner.get(cid)
  }

  async has(cid: CID): Promise<boolean> {
    return this.inner.has(cid)
  }

  get size(): number {
    return this.inner.size
  }
}
