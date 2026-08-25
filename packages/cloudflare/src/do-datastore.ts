import { BaseDatastore } from 'datastore-core'
import { Key } from 'interface-datastore'
import type { KeyQuery, Pair, Query } from 'interface-datastore'
import type { DurableObjectStorage } from './durable-object-storage.d.ts'

/**
 * A libp2p datastore backed by Durable Object storage — Phase 29 criterion 3.
 *
 * ## Why this is hand-written, and why it is not `datastore-level`
 *
 * **No published package binds `interface-datastore` to Durable Object storage.** That
 * settles the "build or install" question on its own, but the shape of what is built here
 * is settled by a second thing: the last generic async datastore this project reached for
 * (`datastore-level@13`) hung the enrolment RPC for a week. The recorded diagnosis —
 * *"any datastore whose operations are asynchronous hangs enrolment"* — was measured false
 * on 2026-08-23 (`packages/node/src/fs-datastore.ts:11-24`), so asynchrony is **not** the
 * hazard and this class is freely `async` throughout. What survives from that week is the
 * cheaper conclusion: a store whose whole surface fits on one screen is the one you can
 * rule out by reading. That is `FsDatastore`'s stated design rule and it is this file's
 * too.
 *
 * ## What it is allowed to hold, and what it refuses — the load-bearing half
 *
 * This store carries **the node's identity** and nothing record-shaped. Phase 31 lands the
 * expiry sweep that sits beside a DHT record store; until it does, a hosted object that
 * accepted DHT records would accumulate them with nothing ever deleting one, and the
 * accumulation would be unbounded in a place nobody is watching. So {@link put} refuses a
 * record-shaped key **now**, which is what keeps the window from opening at all rather than
 * closing it later.
 *
 * "Record-shaped" is defined by where `@libp2p/kad-dht@16.4.0` actually writes, read out of
 * the installed package rather than assumed:
 *
 * | datastore key | written by |
 * |---|---|
 * | `/dht/record/<base32>` | `content-fetching/index.js:27,46` and `rpc/handlers/put-value.js:14,28`, through `utils.js:57` |
 * | `/dht/provider/<cid-base32>/<peerId>` | `providers.js:13,27` through `utils.js:117` |
 *
 * `/dht` is not a guess: `kad-dht.js:124` reads `init.datastorePrefix ?? '/dht'`, and
 * **nothing in `packages/*​/src` passes `datastorePrefix`** (grepped 2026-08-25 — the only
 * occurrence in the tree is prose in `packages/libp2p/src/constants.ts:259`). So `/dht/` is
 * this assembly's real record prefix, and both record and provider entries fall under it.
 *
 * `/o2/` is refused as well. That is this fabric's own *keyspace* prefix —
 * `O2_KEY_PREFIX` at `packages/libp2p/src/dht-record-index.ts:65`, from which
 * `dhtKeyForNodeKey` builds `/o2/<nodeKey>`. Those are keys handed **to** the DHT, which
 * hashes them into the `/dht/record/…` names above, so a correctly-wired kad-dht never
 * presents one here. It is refused anyway because the one thing that would defeat the guard
 * is a caller that decides to write fabric records into the store directly, and that caller
 * would spell them exactly this way. Refusing a prefix nothing legitimate uses costs
 * nothing.
 *
 * What is admitted is everything else, and specifically the three prefixes libp2p's own
 * identity machinery writes, likewise read out of the installed packages:
 *
 * - `/pkcs8/<name>` and `/info/<name>` — `@libp2p/keychain/dist/src/keychain.js:14-15`
 * - `/peers/<cid-base32>` — `@libp2p/peer-store/dist/src/utils/peer-id-to-datastore-key.js`
 *
 * The consult that measured a deployed object holding a persisted identity is the reason
 * this matters at all: three consecutive calls to a plain Worker returned **three different
 * PeerIds**, and moving the node into a Durable Object with the key in DO storage is what
 * fixed it (`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7).
 * The identity is the whole reason this store exists.
 *
 * **The refusal is a rejected promise, not a synchronous throw**, and that is not a style
 * choice. `FsDatastore.get`'s docblock records the same finding from the other side
 * (`packages/node/src/fs-datastore.ts:71-84`): a caller written as `store.put(k, v).catch(…)`
 * never enters its handler when the call throws before returning. `put` is therefore
 * `async`, so both the refusal and the success are promises and the two cannot differ. The
 * batch path inherits this for free — `BaseDatastore.batch()` funnels through `putMany` to
 * `put` (`datastore-core/dist/src/base.js`), which is how the keychain writes
 * (`keychain.js:206`), and the spec asserts it rather than assuming it.
 *
 * ## The divergences from `FsDatastore`, each because the reason for the original is absent
 *
 * **Keys are stored verbatim, not base32-encoded.** `FsDatastore` encodes because APFS is
 * case-insensitive and two libp2p keys differing only in base58 case would become one file.
 * Durable Object storage is SQLite behind a string-keyed KV API — there is no filesystem
 * and no case folding — so the reason is simply not present here. Encoding would also
 * destroy the one thing that makes {@link _all} affordable: `list({ prefix })` filters
 * server-side on the stored name, measured in the consult's §4 as
 * `prefix list '/o2/kad/' → ['/o2/kad/a', '/o2/kad/b', '/o2/kad/bin']`. Base32 names would
 * force every query to list the entire store and filter in the isolate.
 *
 * **No write-then-rename.** `FsDatastore` stages and renames because a POSIX write is not
 * atomic and a reader can see half a value. A single `storage.put()` is one transaction, so
 * there is no torn state to hide from and no staging name for a query to skip.
 *
 * **`put` copies into a tight `Uint8Array`.** DO storage serialises by structured clone, and
 * structured-cloning a typed array serialises the *whole* underlying `ArrayBuffer`, not the
 * view. A caller handing in a 3-byte `subarray` of a 1 MiB buffer — which is exactly what
 * length-prefixed libp2p decoding produces — would otherwise store 1 MiB. `new Uint8Array(val)`
 * is a copy into a buffer of `val.length`.
 *
 * **`get` copies on the way out.** DO storage keeps a read/write cache in the isolate, so
 * two `get`s of one key can hand back the same object; a caller that mutated it would be
 * editing the store through a value it believes is its own. The copy costs a memcpy on a
 * value that is a few hundred bytes.
 *
 * **`has` reads the value.** The API has no existence probe. The alternative,
 * `list({ prefix: name })`, is wrong rather than merely slower: it would report `true` for
 * `/peers/ab` whenever `/peers/abc` exists.
 *
 * ## The value ceiling, and why it is documented and not enforced
 *
 * The consult bisected it against real `put` calls on a deployed object
 * (`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §4):
 *
 * > **The value ceiling refutes the documentation.** The docs state 2 MB. Bisected against
 * > real `put` calls:
 * > ```
 * > largest accepted   4_193_280 B   (3.999 MiB)
 * > smallest refused   4_194_304 B   → "string or blob too big: SQLITE_TOOBIG"
 * > ```
 * > So the real ceiling is 4 MiB less a small header — twice what is published.
 *
 * No size guard is implemented. The true boundary is somewhere in the 1 024 B nobody
 * bisected between those two figures, so any threshold written here would be a number this
 * project did not measure — and this file has no business inventing one when the storage
 * layer refuses with a legible error of its own. The figure is recorded because a limit
 * read from a documentation page is a class of claim this project has been wrong about
 * before, and because the values this store actually holds — a PKCS#8 key, a peer record —
 * are three orders of magnitude below it.
 *
 * ## Listing is unbounded, and the guard is what makes that safe
 *
 * {@link _all} lists without a `limit`. That is only defensible because of the refusal
 * above: the admitted key set is the identity plus a peer store, which is dozens of small
 * values. Should the guard ever be relaxed without a bound landing beside it, this method
 * becomes the second defect rather than the first.
 */
export class DoDatastore extends BaseDatastore {
  readonly #storage: DurableObjectStorage

  constructor(storage: DurableObjectStorage) {
    super()
    this.#storage = storage
  }

  /**
   * The key prefixes {@link put} refuses.
   *
   * Derived in this class's docblock from the installed `@libp2p/kad-dht@16.4.0` and from
   * `packages/libp2p/src/dht-record-index.ts:65`. Exported so a caller can report *why* a
   * write was refused; the spec deliberately does **not** read it, and writes the literal
   * prefixes out instead, so that changing this array cannot move the assertions with it.
   */
  static readonly refusedKeyPrefixes: readonly string[] = ['/dht/', '/o2/']

  /**
   * The prefix of `key`, if it is one this store refuses. `undefined` means admitted.
   *
   * A separate method rather than an inline test so the spec can ask the question without
   * performing a write, and so the refusal and the classification cannot drift apart.
   */
  static refusedPrefixFor(key: Key): string | undefined {
    const name = key.toString()
    return DoDatastore.refusedKeyPrefixes.find((prefix) => name.startsWith(prefix))
  }

  /**
   * `async` for the reason in the class doc: a refusal must reach a caller as a **rejection**
   * so that `put(…).catch(…)` and `await put(…)` behave the same way.
   */
  override async put(key: Key, val: Uint8Array): Promise<Key> {
    const refused = DoDatastore.refusedPrefixFor(key)
    if (refused !== undefined) {
      throw new RecordShapedKeyRefusedError(key.toString(), refused)
    }
    // A copy, not the caller's view — see the class doc on structured clone and subarrays.
    await this.#storage.put(key.toString(), new Uint8Array(val))
    return key
  }

  override async get(key: Key): Promise<Uint8Array> {
    const stored = await this.#storage.get(key.toString())
    if (stored === undefined) {
      // The interface's own miss, not the storage layer's. libp2p branches on this name;
      // the shape is `FsDatastore.get`'s, so both of this project's stores miss identically
      // (`packages/node/src/fs-datastore.ts:92-96`).
      throw Object.assign(new Error(`Not Found: ${key.toString()}`), {
        name: 'NotFoundError',
        code: 'ERR_NOT_FOUND',
      })
    }
    if (!(stored instanceof Uint8Array)) {
      // A value this store did not write. A Durable Object's storage is one namespace and
      // the object may keep its own JSON there, so this is a reachable state rather than a
      // defensive flourish — and returning it as bytes would be the corruption.
      throw new StoredValueNotBytesError(key.toString())
    }
    // A copy on the way out — see the class doc on the isolate's read cache.
    return new Uint8Array(stored)
  }

  override async has(key: Key): Promise<boolean> {
    return (await this.#storage.get(key.toString())) !== undefined
  }

  override async delete(key: Key): Promise<void> {
    // The boolean says whether anything was there. `Datastore.delete` is idempotent and
    // returns nothing, so it is discarded — the same statement `rmSync(…, { force: true })`
    // makes in `FsDatastore`.
    await this.#storage.delete(key.toString())
  }

  /**
   * `list`, with the query's prefix pushed down to the storage layer.
   *
   * `BaseDatastore.query` re-applies the same `startsWith` filter afterwards, so pushing it
   * down is an optimisation and not a correctness claim — but it is the difference between
   * scanning the store and scanning one namespace, and it is only available because keys
   * are stored verbatim.
   *
   * The branch on `undefined` is required by `exactOptionalPropertyTypes`: `{ prefix }`
   * where `prefix` is `string | undefined` is not assignable to `{ prefix?: string }`.
   */
  async #list(prefix: string | undefined): Promise<Map<string, unknown>> {
    return prefix === undefined ? this.#storage.list() : this.#storage.list({ prefix })
  }

  override async *_all(q: Query): AsyncGenerator<Pair> {
    for (const [name, value] of await this.#list(q.prefix)) {
      // Skipped rather than thrown on, for `FsDatastore._all`'s reason: a query is a read of
      // what is here, and one foreign value must not make the whole store unreadable. `get`
      // throws on the same value because there the caller named that key.
      if (!(value instanceof Uint8Array)) continue
      yield { key: new Key(name), value: new Uint8Array(value) }
    }
  }

  override async *_allKeys(q: KeyQuery): AsyncGenerator<Key> {
    for (const [name, value] of await this.#list(q.prefix)) {
      // The same skip as `_all`, so the two agree on what the store contains. A key whose
      // value `_all` will not yield is not a key this store holds.
      if (!(value instanceof Uint8Array)) continue
      yield new Key(name)
    }
  }
}

/**
 * A `put` refused because its key is record-shaped — Phase 29 criterion 3.
 *
 * A class rather than `FsDatastore`'s `Object.assign(new Error(…), …)` shape because the
 * two errors answer to different authorities. `NotFoundError` has to match what libp2p
 * branches on, so it copies the library's convention exactly. This refusal is **this
 * repository's own outcome**, nothing outside recognises it, and a caller that wants to
 * distinguish it should be able to do so with `instanceof` and to read *which* prefix
 * matched without parsing a message.
 */
export class RecordShapedKeyRefusedError extends Error {
  override readonly name: string = 'RecordShapedKeyRefusedError'
  readonly code: string = 'ERR_O2_RECORD_SHAPED_KEY_REFUSED'
  /** The rejected key, as `Key.toString()` spells it. */
  readonly key: string
  /** Which entry of {@link DoDatastore.refusedKeyPrefixes} matched. */
  readonly matchedPrefix: string

  constructor(key: string, matchedPrefix: string) {
    super(
      `refusing to store a record-shaped key until the Phase 31 expiry sweep lands beside ` +
        `it: ${key} begins with ${matchedPrefix}`,
    )
    this.key = key
    this.matchedPrefix = matchedPrefix
  }
}

/**
 * A key held a value that is not bytes.
 *
 * Reachable because a Durable Object's storage is a single namespace shared with whatever
 * else the object keeps there. Named so that a caller can tell it apart from a miss: the
 * key exists, and what it holds is not this store's.
 */
export class StoredValueNotBytesError extends Error {
  override readonly name: string = 'StoredValueNotBytesError'
  readonly code: string = 'ERR_O2_STORED_VALUE_NOT_BYTES'
  readonly key: string

  constructor(key: string) {
    super(`durable object storage holds a non-Uint8Array value at ${key}`)
    this.key = key
  }
}
