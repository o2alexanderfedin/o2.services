import { BaseDatastore } from 'datastore-core'
import { Key } from 'interface-datastore'
import type { KeyQuery, Pair, Query } from 'interface-datastore'
import type { DurableObjectStorage } from './durable-object-storage.d.ts'

/**
 * The key namespaces {@link DoDatastore.put} refuses, as one named source.
 *
 * A `const` object with a derived union rather than a TypeScript `enum`, by owner ruling on
 * 2026-08-25 and following the shape `packages/node/src/state-frontmatter.node.test.ts`
 * adopted in commit `6178155`: this tree holds 108 string-literal union types and zero
 * enums, and an enum would fuse our identifier with the wire string.
 *
 * `Object.values` is why this is an object and not two loose constants — the completeness
 * case in the spec asserts the whole set, and a set written out twice is a set that drifts.
 */
export const REFUSED_NAMESPACE = {
  /** Where `@libp2p/kad-dht` keeps both records and provider entries. */
  dhtDatastore: '/dht/',
  /** This fabric's own DHT keyspace prefix. */
  fabricKeyspace: '/o2/',
} as const

/** One of {@link REFUSED_NAMESPACE}'s values. */
export type RefusedNamespace = (typeof REFUSED_NAMESPACE)[keyof typeof REFUSED_NAMESPACE]

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
 * ### The classifier normalises, because a prefix test on the raw name did not hold
 *
 * This class shipped on 2026-08-25 testing `key.toString().startsWith('/dht/')`, and that
 * **let a doubled slash through its own front door**. `Key.clean()` prepends a leading
 * slash and strips trailing ones; it does *not* collapse runs. Measured:
 * `new Key('//dht/record/x').toString()` is `'//dht/record/x'` unchanged, so
 * `store.put(new Key('//dht/record/x'), …)` resolved and wrote. The gap was not "a writer
 * with direct storage access" — it was `DoDatastore.put` itself, reached by the very
 * careless-or-hostile caller the `/o2/` refusal exists for.
 *
 * So {@link refusedPrefixFor} classifies a **normalised** name: slash runs collapsed,
 * trailing slashes stripped, lower-cased. Three separate spelling classes, each closed for
 * its own reason and each with a spec case:
 *
 * - **collapse** — a run of slashes denotes the same namespace to a human and a different
 *   string to the store. Note which half was the escape, measured by plant on 2026-08-25:
 *   with the normalisation removed, `//dht/record/x` was **admitted** and
 *   `/dht//record/x` was still refused, because a raw `startsWith('/dht/')` matches an
 *   interior run and not a leading one. The collapse is written for both anyway — the
 *   asymmetry is an accident of the prefix's shape, not a property worth relying on
 * - **lower-case** — `/DHT/record/x` likewise. `toLowerCase()` is locale-independent in JS,
 *   and nothing legitimate begins with any case variant of these two namespaces
 * - **segment boundary** — the test is `` `${normalised}/`.startsWith(prefix) ``, so bare
 *   `/dht` and `/o2` are refused while `/dht2/x` and `/dhtx` are admitted. A plain
 *   `startsWith` on the un-suffixed name admitted the bare forms
 *
 * The normalisation is **classification-only**: the stored name is always `key.toString()`,
 * untouched. And the residual is stated rather than implied — this closes the spelling
 * variants a caller produces by carelessness. It is not a security boundary. A writer who
 * reaches Durable Object storage directly bypasses this class entirely, and no
 * normalisation here changes that.
 *
 * ### What is admitted
 *
 * Everything else, and specifically the five prefixes libp2p's own identity machinery
 * writes. Each is cited where it was read, because this enumeration was **wrong** until
 * 2026-08-25 — it listed three and a sweep of every `datastore.put` call site in the
 * installed packages found five. Like `/dht` above, each is checked to be the default *this
 * assembly actually runs on*: `certificateDatastoreKey` is an `init` override in both
 * certificate packages (`auto-tls.js:55`, `transport.js:114`) and appears nowhere in
 * `packages/*​/src` (grepped 2026-08-25).
 *
 * - `/pkcs8/<name>` and `/info/<name>` — `@libp2p/keychain/dist/src/keychain.js:14-15`
 * - `/peers/<cid-base32>` — `@libp2p/peer-store/dist/src/utils/peer-id-to-datastore-key.js`
 * - `/libp2p/auto-tls/certificate` —
 *   `@ipshipyard/libp2p-auto-tls/dist/src/constants.js:12`, written at `auto-tls.js:189`
 * - `/libp2p/webrtc-direct/certificate` — `@libp2p/webrtc/dist/src/constants.js:80`,
 *   written at `private-to-public/transport.js:195`
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
 * `async`, so both the refusal and the success are promises and the two cannot differ.
 *
 * ### The batch path reaches the guard, and is NOT atomic — a recorded gap, not a fix
 *
 * `BaseDatastore.batch()` is inherited unchanged. Every `batch.put` funnels through
 * `putMany` to {@link put} (`datastore-core/dist/src/base.js:48-53`), so the refusal does
 * cover it — which matters, because the keychain writes this way
 * (`@libp2p/keychain/dist/src/keychain.js:204-207,238-241`).
 *
 * **What it does not give is all-or-nothing.** `commit()` awaits `putMany` sequentially and
 * then `deleteMany`, so a refusal part-way through leaves the earlier operations applied.
 * Measured 2026-08-25:
 *
 * ```
 * batch: put /pkcs8/self, put /info/self, put /dht/record/…
 *   commit() rejects — storage.size === 2, both identity keys written
 * batch: put /dht/record/x, delete /peers/stale
 *   commit() rejects — /peers/stale still present
 * ```
 *
 * This is **latent today**, not a live tear: the only batching caller is the keychain, and
 * it batches `/pkcs8/` plus `/info/`, both admitted, so no mixed batch is ever built. It is
 * recorded here and pinned by two characterisation cases in the spec rather than repaired,
 * because the repair belongs one layer up. Real Durable Object storage offers
 * `storage.transaction()`, whose callback rolls back wholesale on a throw; wiring it means
 * overriding `batch()` against a `DurableObjectTransaction`, which arrives with the Durable
 * Object class in Phase 29 criteria 2 and 7. **The rejected alternative** was a
 * validate-every-key-then-write pass inside this class: it would close the refusal-shaped
 * tear and leave the general one (a storage error mid-batch) open, while presenting to a
 * reader as atomicity. A gap that looks closed is worse than one that is written down.
 *
 * ## One key, one answer — the invariant `has`, `get` and `query` all satisfy
 *
 * **`has(k)` is `true` ⟺ `get(k)` resolves ⟺ `k` appears in `queryKeys({})`.**
 *
 * Stated because it did not hold. Until 2026-08-25 `has` was the one path that did not
 * check the value's type, so a foreign value under `/peers/foreign` produced `has → true`,
 * `get → StoredValueNotBytesError`, `queryKeys → []`: three different answers about one
 * key, and a caller doing `has`-then-`get` — peer-store exposes both — crashed on a key
 * `has` had promised was there.
 *
 * A foreign value now gives `false` / a named throw / omitted, and the biconditional holds,
 * because `get` *not resolving* is what it requires. `get` keeps the diagnostic throw rather
 * than faking a miss: an operator reading a crash log wants to know the key was occupied by
 * something else.
 *
 * The second half of the invariant is {@link _all}'s round-trip skip. `Key`'s constructor
 * normalises, so a stored name of `/peers/trailing/` would come back from `list` as
 * `Key('/peers/trailing')` — a key `get` misses, because the stored name still carries the
 * slash. Such names are skipped. **`has` and `get` need no round-trip check of their own**
 * and must not grow one for symmetry: a caller cannot *name* a non-round-tripping key
 * through this API, because `Key` normalised it before this class ever saw it.
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
 * is a copy into a buffer of `val.length`. Note what this copy does *not* buy: isolation
 * from a caller that mutates its array afterwards is supplied by the platform's
 * serialise-on-write and holds with or without it. The size is the only falsifiable
 * consequence, and the spec says so where it asserts it.
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
 * ## Listing is unbounded, and what actually bounds the population
 *
 * {@link _all} lists without a `limit`. This paragraph claimed until 2026-08-25 that the
 * admitted set is *"dozens of small values"*, and the consult it cites four paragraphs
 * above contradicts that by an order of magnitude: §18 measured **599 peers dialling one
 * Durable Object at once**, all landing on one instance, with the ceiling found being the
 * test rig rather than Cloudflare. The peer store is the growing component and it grows
 * with fan-in.
 *
 * What bounds it is churn, not size. `@libp2p/peer-store` expires **lazily**: a peer older
 * than `MAX_PEER_AGE` (`21_600_000` ms = 6 h) or an address older than `MAX_ADDRESS_AGE`
 * (`3_600_000` ms = 1 h) is deleted at the moment it is read
 * (`@libp2p/peer-store/dist/src/constants.js:1-2`, `store.js:166,179`). So the population is
 * six hours of peer churn in small values — hundreds to low thousands, not dozens, and not
 * unbounded.
 *
 * That is a magnitude to size a listing against; it is not what the refusal is for. The
 * class the refusal keeps out is the one with **no expiry at all** on this tier until Phase
 * 31's sweep lands. Should the guard ever be relaxed without a bound arriving beside it,
 * this method becomes the second defect rather than the first.
 */
export class DoDatastore extends BaseDatastore {
  readonly #storage: DurableObjectStorage

  constructor(storage: DurableObjectStorage) {
    super()
    this.#storage = storage
  }

  /**
   * The key namespaces {@link put} refuses, in declaration order.
   *
   * Derived from {@link REFUSED_NAMESPACE} rather than written out a second time. The spec
   * deliberately does **not** build its inputs from this array — it writes the prefixes out
   * as literals and asserts this array equals a literal — so that emptying or truncating it
   * reddens the spec instead of moving it.
   */
  static readonly refusedKeyPrefixes: readonly RefusedNamespace[] = Object.values(REFUSED_NAMESPACE)

  /**
   * The name a key is **classified** under. Never the name it is stored under.
   *
   * See the class doc for what each of the three normalisations closes and what the
   * measurement was that made them necessary.
   */
  static #classificationNameFor(key: Key): string {
    return key
      .toString()
      .replace(/\/+/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase()
  }

  /**
   * The namespace of `key`, if it is one this store refuses. `undefined` means admitted.
   *
   * A separate method rather than an inline test so the spec can ask the question without
   * performing a write, and so the refusal and the classification cannot drift apart.
   */
  static refusedPrefixFor(key: Key): RefusedNamespace | undefined {
    // The trailing `/` is what makes this a segment test rather than a character test: bare
    // `/dht` becomes `/dht/` and is refused, while `/dht2/x` and `/dhtx` stay admitted.
    const name = `${DoDatastore.#classificationNameFor(key)}/`
    return DoDatastore.refusedKeyPrefixes.find((prefix) => name.startsWith(prefix))
  }

  /**
   * The `Key` a stored name denotes, or `undefined` if it is not a name this store wrote.
   *
   * `Key`'s constructor normalises, so a stored `/peers/trailing/` would come back as
   * `Key('/peers/trailing')` — a key `get` misses, because the stored name still carries the
   * slash. Yielding it would hand a caller a key this store cannot resolve, which is the
   * half of the one-key-one-answer invariant `_all` owns. Skipped rather than thrown on, for
   * `FsDatastore._all`'s reason: a name this store did not write must not make the whole
   * store unreadable.
   */
  static #keyForStoredName(name: string): Key | undefined {
    try {
      const key = new Key(name)
      return key.toString() === name ? key : undefined
    } catch {
      return undefined
    }
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
    // The `instanceof` test is not defensive duplication of `get`. Without it this method is
    // the one path that answers differently from the other two — see the invariant in the
    // class doc, and the `has`-then-`get` crash that made it necessary.
    return (await this.#storage.get(key.toString())) instanceof Uint8Array
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

  /**
   * The one place that decides what this store contains.
   *
   * `_all` and `_allKeys` both read it, so their agreement is structural rather than a
   * property two separate loops have to keep. `_allKeys` pays for a value copy it discards;
   * that is the price of the two never disagreeing, and it is a memcpy on values this store
   * holds a few hundred bytes of. The shape is `FsDatastore.#pairs`'s, for the same reason.
   */
  async *#pairs(prefix: string | undefined): AsyncGenerator<Pair> {
    for (const [name, value] of await this.#list(prefix)) {
      const key = DoDatastore.#keyForStoredName(name)
      if (key === undefined) continue
      // Skipped rather than thrown on, for `FsDatastore._all`'s reason: a query is a read of
      // what is here, and one foreign value must not make the whole store unreadable. `get`
      // throws on the same value because there the caller named that key.
      if (!(value instanceof Uint8Array)) continue
      yield { key, value: new Uint8Array(value) }
    }
  }

  override async *_all(q: Query): AsyncGenerator<Pair> {
    yield* this.#pairs(q.prefix)
  }

  override async *_allKeys(q: KeyQuery): AsyncGenerator<Key> {
    for await (const pair of this.#pairs(q.prefix)) yield pair.key
  }
}

/**
 * A `put` refused because its key is record-shaped — Phase 29 criterion 3.
 *
 * A class rather than `FsDatastore`'s `Object.assign(new Error(…), …)` shape because the
 * two errors answer to different authorities. `NotFoundError` has to match what libp2p
 * branches on, so it copies the library's convention exactly. This refusal is **this
 * repository's own outcome**, nothing outside recognises it, and a caller that wants to
 * distinguish it should be able to do so with `instanceof` and to read *which* namespace
 * matched without parsing a message.
 */
export class RecordShapedKeyRefusedError extends Error {
  override readonly name: string = 'RecordShapedKeyRefusedError'
  readonly code: string = 'ERR_O2_RECORD_SHAPED_KEY_REFUSED'
  /** The rejected key, as `Key.toString()` spells it — not the normalised classification name. */
  readonly key: string
  /** Which entry of {@link REFUSED_NAMESPACE} matched. */
  readonly matchedPrefix: RefusedNamespace

  constructor(key: string, matchedPrefix: RefusedNamespace) {
    super(
      `refusing to store a record-shaped key until the Phase 31 expiry sweep lands beside ` +
        `it: ${key} normalises into ${matchedPrefix}`,
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
 * key exists, and what it holds is not this store's. `has` answers `false` for the same key
 * — see the one-key-one-answer invariant in {@link DoDatastore}'s docblock for why those
 * two are consistent rather than contradictory.
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
