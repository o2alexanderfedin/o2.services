import { Key } from 'interface-datastore'
import { beforeEach, describe, expect, it } from 'vitest'
import { DoDatastore, RecordShapedKeyRefusedError, StoredValueNotBytesError } from './do-datastore.ts'
import { FakeDurableObjectStorage } from './do-storage.fixture.ts'

/**
 * Phase 29 criterion 3 — Durable Object storage reached through `interface-datastore`.
 *
 * **Plain `.test.ts`, not `.node.test.ts`, and that is a claim rather than a default.** The
 * suffix in this repository means *needs Node APIs* — `packages/node/src/datastore-persistence.node.test.ts`
 * warrants it by spawning real libp2p nodes on loopback TCP and writing a real directory.
 * Nothing here touches `node:`, `Buffer` or `process`, so the file also runs in the
 * `browser` project across Chromium, Firefox and WebKit. That is deliberate: the class
 * under test is destined for `workerd`, which is neither Node nor a browser, and a spec
 * that only ever ran in one of them would be the weaker instrument.
 *
 * ## Every refused and admitted key here is written as a literal
 *
 * Not one assertion reads `DoDatastore.refusedKeyPrefixes` **to build its inputs**. A spec
 * that derived its inputs from the array it is testing moves with it, and would stay green
 * if the array were emptied. One case reads that array and compares it to a literal — that
 * is the completeness check, and it is the opposite direction.
 *
 * **Every list of literals below carries an explicit length assertion**, because a
 * consolidated constant introduces a vacuity of its own: a `for` loop over a truncated list
 * silently runs fewer cases and stays green. The same trap was proven by plant in commit
 * `6178155`, where dropping a key left the case green until a length assertion was added.
 *
 * The literals are transcribed from where the prefixes were derived:
 *
 * - `/dht/record/<base32>` — `@libp2p/kad-dht/dist/src/content-fetching/index.js:27,46`
 *   composing `utils.js:57`'s `` `${prefix}/${base32}` ``, with `/dht` from
 *   `kad-dht.js:124` (`init.datastorePrefix ?? '/dht'`, and nothing in `packages/*​/src`
 *   passes `datastorePrefix`)
 * - `/dht/provider/<cid>/<peerId>` — `providers.js:13,27` composing `utils.js:117`
 * - `/o2/<nodeKey>` — `dhtKeyForNodeKey` over `O2_KEY_PREFIX`,
 *   `packages/libp2p/src/dht-record-index.ts:65`
 * - `/pkcs8/<name>`, `/info/<name>` — `@libp2p/keychain/dist/src/keychain.js:14-15`
 * - `/peers/<cid>` — `@libp2p/peer-store/dist/src/utils/peer-id-to-datastore-key.js`
 * - `/libp2p/auto-tls/certificate` — `@ipshipyard/libp2p-auto-tls/dist/src/constants.js:12`
 * - `/libp2p/webrtc-direct/certificate` — `@libp2p/webrtc/dist/src/constants.js:80`
 */

/**
 * The key strings this file uses more than once, named once.
 *
 * Deliberately **literals declared here**, not values imported from the class under test.
 * The owner's rule against magic strings per site is satisfied by naming them once in the
 * spec; importing them would satisfy the rule and destroy the assertions.
 */
const KEY = {
  identityPrivate: '/pkcs8/self',
  identityInfo: '/info/self',
  aRecord: '/dht/record/ciqbed3k6ydc2b3',
  aForeignValue: '/peers/foreign',
  aStalePeer: '/peers/stale',
} as const

let storage: FakeDurableObjectStorage
let store: DoDatastore

beforeEach(() => {
  storage = new FakeDurableObjectStorage()
  store = new DoDatastore(storage)
})

/** `expect(x).toBeInstanceOf` narrows nothing, and this repository forbids assertions. */
function asBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`expected Uint8Array, got ${Object.prototype.toString.call(value)}`)
  }
  return value
}

async function keysOf(prefix?: string): Promise<string[]> {
  const seen: string[] = []
  for await (const key of store.queryKeys(prefix === undefined ? {} : { prefix })) {
    seen.push(key.toString())
  }
  return seen.sort()
}

describe('the datastore contract', () => {
  it('reads back what it wrote', async () => {
    await store.put(new Key('/peers/bafzaaeyabc'), new Uint8Array([1, 2, 3]))

    expect([...(await store.get(new Key('/peers/bafzaaeyabc')))]).toEqual([1, 2, 3])
  })

  it('reports a miss as the interface’s NotFound, and as a rejection', async () => {
    // libp2p branches on the name. Written as `rejects` rather than `try`/`catch` for
    // `FsDatastore.get`'s recorded reason: a `catch` passes whether the throw was
    // synchronous or not, and a synchronous throw escapes a caller written as `.catch(…)`.
    await expect(store.get(new Key('/peers/absent'))).rejects.toMatchObject({
      name: 'NotFoundError',
      code: 'ERR_NOT_FOUND',
    })
  })

  it('answers has for a present and an absent key', async () => {
    await store.put(new Key('/peers/present'), new Uint8Array([9]))

    expect(await store.has(new Key('/peers/present'))).toBe(true)
    expect(await store.has(new Key('/peers/absent'))).toBe(false)
  })

  it('does not report a longer key as present under a shorter one', async () => {
    // The reason `has` reads the value instead of listing by prefix. A prefix probe would
    // answer `true` here, and the store would claim to hold a key it does not.
    await store.put(new Key('/peers/abc'), new Uint8Array([1]))

    expect(await store.has(new Key('/peers/ab'))).toBe(false)
  })

  it('deletes, and deleting an absent key is not an error', async () => {
    await store.put(new Key('/peers/doomed'), new Uint8Array([1]))
    await store.delete(new Key('/peers/doomed'))

    expect(await store.has(new Key('/peers/doomed'))).toBe(false)
    await expect(store.delete(new Key('/peers/never-existed'))).resolves.toBeUndefined()
  })

  it('overwrites rather than appending on a second put of one key', async () => {
    await store.put(new Key('/peers/x'), new Uint8Array([1, 1, 1, 1]))
    await store.put(new Key('/peers/x'), new Uint8Array([2]))

    expect([...(await store.get(new Key('/peers/x')))]).toEqual([2])
  })
})

describe('query', () => {
  beforeEach(async () => {
    await store.put(new Key('/peers/aaa'), new Uint8Array([1]))
    await store.put(new Key('/peers/bbb'), new Uint8Array([2]))
    await store.put(new Key(KEY.identityPrivate), new Uint8Array([3]))
  })

  it('returns only the pairs under the prefix', async () => {
    const seen: [string, number[]][] = []
    for await (const pair of store.query({ prefix: '/peers/' })) {
      seen.push([pair.key.toString(), [...pair.value]])
    }

    expect(seen.sort()).toEqual([
      ['/peers/aaa', [1]],
      ['/peers/bbb', [2]],
    ])
  })

  it('returns only the keys under the prefix', async () => {
    expect(await keysOf('/pkcs8/')).toEqual([KEY.identityPrivate])
  })

  it('returns everything when no prefix is given', async () => {
    expect(await keysOf()).toEqual(['/peers/aaa', '/peers/bbb', KEY.identityPrivate])
  })

  it('pushes the prefix down to the storage layer instead of listing everything', async () => {
    // Untestable through the results alone: `BaseDatastore.query` re-filters by the same
    // prefix, so a store that listed the whole namespace would return the same three pairs.
    // The claim is about the call, so the call is what is asserted.
    for await (const _ of store.query({ prefix: '/peers/' })) {
      // drain
    }

    expect(storage.listCalls).toEqual([{ prefix: '/peers/' }])
  })

  it('lists without a prefix when the query has none', async () => {
    await keysOf()

    expect(storage.listCalls).toEqual([undefined])
  })
})

describe('the record-shaped-key refusal — Phase 29 criterion 3', () => {
  // Literal keys, transcribed from the derivations in this file's header. `<base32>` bodies
  // are plausible rather than real: the guard reads the namespace and nothing else, and a
  // real multihash here would only make the spec look like it verified something it did not.
  const RECORD_SHAPED: readonly string[] = [
    '/dht/record/ciqbed3k6ydc2b3nrqhdf4kvvrxvcgk3rlnhgcpzeqqbwqjbrqbwqbw',
    '/dht/provider/ciqbed3k6ydc2b3nrqhdf4kvvrxvcgk3rlnhgcpzeqq/12D3KooWGUfBFMn6L4mYf8SBrW7gMyc4e93xUJjsaGSRjqFe5scm',
    '/o2/8a9f0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e',
  ]

  const IDENTITY_SHAPED: readonly string[] = [
    KEY.identityPrivate,
    KEY.identityInfo,
    '/peers/bafzaajaiaejcbw6svgm2y4nxrqwqkfsqm4pv3vnhnvnyanhkzdmwyfsw3zvpn5ja',
    '/libp2p/auto-tls/certificate',
    '/libp2p/webrtc-direct/certificate',
  ]

  it('refuses exactly the two namespaces it says it does', async () => {
    // Reads the class's array and compares it against a literal — the one place that runs
    // in this direction. It is simultaneously the completeness check and the truncation
    // guard: emptying or shortening the constant reddens here.
    expect(DoDatastore.refusedKeyPrefixes).toEqual(['/dht/', '/o2/'])
  })

  it('has a list of record-shaped keys that has not been truncated', async () => {
    // Anti-vacuity for the two `for` loops below. Without this, deleting entries from either
    // list runs fewer cases and every remaining case still passes.
    expect(RECORD_SHAPED.length).toBe(3)
    expect(IDENTITY_SHAPED.length).toBe(5)
  })

  for (const name of RECORD_SHAPED) {
    it(`refuses a put of ${name.slice(0, 24)}…`, async () => {
      await expect(store.put(new Key(name), new Uint8Array([1]))).rejects.toBeInstanceOf(
        RecordShapedKeyRefusedError,
      )
    })

    it(`writes nothing when it refuses ${name.slice(0, 24)}…`, async () => {
      // A refusal that still wrote would open exactly the accumulation window the criterion
      // exists to keep shut, and every other assertion here would stay green.
      await expect(store.put(new Key(name), new Uint8Array([1]))).rejects.toThrow()

      expect(storage.size).toBe(0)
      expect(storage.inspect(name)).toBeUndefined()
    })
  }

  for (const name of IDENTITY_SHAPED) {
    it(`admits a put of ${name}`, async () => {
      // The other half of the criterion. A guard that refused everything would pass every
      // refusal assertion above and make the store useless for the one thing it is for.
      await store.put(new Key(name), new Uint8Array([7]))

      expect([...(await store.get(new Key(name)))]).toEqual([7])
    })
  }

  it('carries the key and the matched namespace on the error, not only a message', async () => {
    const failure = await store.put(new Key(KEY.aRecord), new Uint8Array([1])).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(RecordShapedKeyRefusedError)
    expect(failure).toMatchObject({
      name: 'RecordShapedKeyRefusedError',
      code: 'ERR_O2_RECORD_SHAPED_KEY_REFUSED',
      key: KEY.aRecord,
      matchedPrefix: '/dht/',
    })
  })

  it('reports the key as the caller spelled it, not as the classifier normalised it', async () => {
    // The normalisation is classification-only. An error naming `/dht/record/x` for a key
    // the caller wrote as `//dht/record/x` would send whoever reads the log looking for a
    // call that does not exist.
    const failure = await store.put(new Key('//dht/record/x'), new Uint8Array([1])).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ key: '//dht/record/x', matchedPrefix: '/dht/' })
  })

  it('refuses as a rejection and not as a synchronous throw', async () => {
    // `put(…).catch(…)` never enters its handler if the call throws before returning — the
    // finding `FsDatastore.get`'s docblock records from the other side. Calling it outside
    // a `try` is what proves nothing was thrown synchronously.
    const pending = store.put(new Key('/o2/deadbeef'), new Uint8Array([1]))

    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toBeInstanceOf(RecordShapedKeyRefusedError)
  })

  it('classifies without writing', async () => {
    expect(DoDatastore.refusedPrefixFor(new Key(KEY.aRecord))).toBe('/dht/')
    expect(DoDatastore.refusedPrefixFor(new Key('/o2/abc'))).toBe('/o2/')
    expect(DoDatastore.refusedPrefixFor(new Key('/peers/abc'))).toBeUndefined()
    expect(storage.size).toBe(0)
  })
})

describe('the refusal survives every spelling of the same namespace', () => {
  /**
   * Each of these reached `DoDatastore.put` and **wrote** before 2026-08-25.
   *
   * `Key.clean()` prepends a leading slash and strips trailing ones and does not collapse
   * runs — measured, `new Key('//dht/record/x').toString()` is `'//dht/record/x'` unchanged
   * — so a plain `startsWith('/dht/')` admitted every one of them.
   */
  const SPELLINGS: readonly string[] = [
    '//dht/record/x',
    '/dht//record/x',
    '///dht///record///x',
    '/dht',
    '/DHT/record/x',
    '/Dht//Record/X',
    '//o2/deadbeef',
    '/o2',
    '/O2/deadbeef',
  ]

  /** Near-misses. A guard that refused these would be broken in the other direction. */
  const ADMITTED_NEAR_MISSES: readonly string[] = [
    '/dht2/x',
    '/dhtx',
    '/o2x/y',
    '/peers/dht/record/x',
    '/peers/o2/x',
  ]

  it('has neither list truncated', async () => {
    expect(SPELLINGS.length).toBe(9)
    expect(ADMITTED_NEAR_MISSES.length).toBe(5)
  })

  for (const name of SPELLINGS) {
    it(`refuses ${name}`, async () => {
      await expect(store.put(new Key(name), new Uint8Array([1]))).rejects.toBeInstanceOf(
        RecordShapedKeyRefusedError,
      )
      expect(storage.size).toBe(0)
    })
  }

  for (const name of ADMITTED_NEAR_MISSES) {
    it(`admits ${name}, which only looks like the namespace`, async () => {
      await store.put(new Key(name), new Uint8Array([5]))

      expect([...(await store.get(new Key(name)))]).toEqual([5])
    })
  }

  it('is a spelling problem the Key class does not solve, which is why this exists', async () => {
    // Anti-vacuity for the whole block above. If `Key` ever started collapsing runs, these
    // cases would pass through the ordinary `/dht/` path and stop testing the classifier —
    // green, and measuring nothing. This case fails the moment that becomes true.
    expect(new Key('//dht/record/x').toString()).toBe('//dht/record/x')
    expect(new Key('/dht//record/x').toString()).toBe('/dht//record/x')
  })
})

describe('one key, one answer — has, get and query agree', () => {
  it('gives one answer about a foreign value', async () => {
    // Before 2026-08-25 `has` was the only path that did not check the value's type:
    // has → true, get → StoredValueNotBytesError, queryKeys → []. A caller doing
    // `has`-then-`get` — peer-store exposes both — crashed on a key `has` promised was there.
    storage.putRaw(KEY.aForeignValue, { notBytes: true })
    // Anti-vacuity: the seed must actually be in the store, or all three answers below are
    // "absent" for the boring reason.
    expect(storage.inspect(KEY.aForeignValue)).toBeDefined()

    expect(await store.has(new Key(KEY.aForeignValue))).toBe(false)
    await expect(store.get(new Key(KEY.aForeignValue))).rejects.toBeInstanceOf(
      StoredValueNotBytesError,
    )
    expect(await keysOf('/peers/')).toEqual([])
  })

  it('gives one answer about a stored name that no Key can denote', async () => {
    // `Key`'s constructor normalises, so a stored `/peers/trailing/` would come back from
    // `list` as `Key('/peers/trailing')` — a key `get` misses, because the stored name still
    // carries the slash. Yielding it would hand a caller a key this store cannot resolve.
    storage.putRaw('/peers/trailing/', new Uint8Array([1]))
    expect(storage.inspect('/peers/trailing/')).toBeDefined()
    // And the key it would have been normalised into is not reachable either way.
    expect(new Key('/peers/trailing/').toString()).toBe('/peers/trailing')

    expect(await keysOf('/peers/')).toEqual([])
    expect(await store.has(new Key('/peers/trailing'))).toBe(false)
    await expect(store.get(new Key('/peers/trailing'))).rejects.toMatchObject({
      name: 'NotFoundError',
    })
  })

  it('gives one answer about an ordinary key, so the skips are not blanket', async () => {
    // The other direction. A `_all` that skipped everything would satisfy both cases above.
    await store.put(new Key('/peers/ordinary'), new Uint8Array([1]))

    expect(await store.has(new Key('/peers/ordinary'))).toBe(true)
    expect([...(await store.get(new Key('/peers/ordinary')))]).toEqual([1])
    expect(await keysOf('/peers/')).toEqual(['/peers/ordinary'])
  })

  it('keeps _all and _allKeys agreeing key for key', async () => {
    await store.put(new Key('/peers/a'), new Uint8Array([1]))
    storage.putRaw('/peers/foreign', 'a string')
    storage.putRaw('/peers/trailing/', new Uint8Array([2]))

    const pairs: string[] = []
    for await (const pair of store.query({ prefix: '/peers/' })) pairs.push(pair.key.toString())

    expect(pairs.sort()).toEqual(await keysOf('/peers/'))
    expect(pairs).toEqual(['/peers/a'])
  })
})

describe('the batch path — the guard reaches it, atomicity does not', () => {
  it('refuses a record-shaped key written through batch()', async () => {
    // `BaseDatastore.batch()` funnels through `putMany` to `put`. The keychain writes this
    // way (`@libp2p/keychain/dist/src/keychain.js:204-207`), so a guard that only covered
    // the direct call would be bypassed by the very component whose keys this store holds.
    const batch = store.batch()
    batch.put(new Key(KEY.identityPrivate), new Uint8Array([1]))
    batch.put(new Key(KEY.aRecord), new Uint8Array([2]))

    await expect(batch.commit()).rejects.toBeInstanceOf(RecordShapedKeyRefusedError)
    expect(storage.inspect(KEY.aRecord)).toBeUndefined()
  })

  it('CHARACTERISATION — a rejected commit still applies the puts that preceded it', async () => {
    // Not the behaviour anyone wants; the behaviour that is there. `commit()` awaits
    // `putMany` sequentially (`datastore-core/dist/src/base.js:48-53`), so a refusal
    // part-way through leaves the earlier writes applied.
    //
    // Latent rather than live: the only batching caller is the keychain, and it batches
    // `/pkcs8/` plus `/info/`, both admitted, so no mixed batch is ever built today. The fix
    // is `storage.transaction()` and it lands with the Durable Object class in Phase 29
    // criteria 2 and 7 — see `DoDatastore`'s docblock for why it is not done in this class.
    //
    // This case is falsifiable, and it was watched: emptying `DoDatastore.refusedKeyPrefixes`
    // makes `commit()` resolve, and this case fails at the line below with
    // `promise resolved "undefined" instead of rejecting` (2026-08-25). The size assertion
    // never runs on that path — the rejection assertion is what catches it.
    const batch = store.batch()
    batch.put(new Key(KEY.identityPrivate), new Uint8Array([1]))
    batch.put(new Key(KEY.identityInfo), new Uint8Array([2]))
    batch.put(new Key(KEY.aRecord), new Uint8Array([3]))

    await expect(batch.commit()).rejects.toBeInstanceOf(RecordShapedKeyRefusedError)
    expect(storage.size).toBe(2)
    expect(storage.inspect(KEY.identityPrivate)).toBeDefined()
    expect(storage.inspect(KEY.identityInfo)).toBeDefined()
  })

  it('CHARACTERISATION — a rejected commit never reaches its deletes', async () => {
    // The mirror of the case above and the sharper half: `deleteMany` runs *after* every
    // put, so a refusal in the put phase leaves a key the caller asked to remove in place.
    // A caller that read the rejection as "nothing happened" would be right about the
    // deletes and wrong about the puts.
    await store.put(new Key(KEY.aStalePeer), new Uint8Array([1]))
    const batch = store.batch()
    batch.put(new Key(KEY.aRecord), new Uint8Array([2]))
    batch.delete(new Key(KEY.aStalePeer))

    await expect(batch.commit()).rejects.toBeInstanceOf(RecordShapedKeyRefusedError)
    expect(storage.inspect(KEY.aStalePeer)).toBeDefined()
  })

  it('commits a batch of admitted keys whole, which is what the keychain actually builds', async () => {
    const batch = store.batch()
    batch.put(new Key(KEY.identityPrivate), new Uint8Array([1]))
    batch.put(new Key(KEY.identityInfo), new Uint8Array([2]))

    await expect(batch.commit()).resolves.toBeUndefined()
    expect(await keysOf()).toEqual([KEY.identityInfo, KEY.identityPrivate])
  })
})

describe('the storage layer’s own semantics, which the datastore has to absorb', () => {
  it('stores only the bytes of a view, not its whole backing buffer', async () => {
    // Structured-cloning a typed array serialises the entire underlying `ArrayBuffer`, and
    // length-prefixed libp2p decoding hands out `subarray` views of large buffers. Without
    // the copy in `put`, three bytes would cost 4 096.
    //
    // **This is the only falsifiable consequence of that copy**, proven by plant on
    // 2026-08-25: removing `new Uint8Array(val)` reddened this case alone, `expected 4096 to
    // be 3`. A sibling case asserting that a caller may mutate its array after `put` was
    // removed the same day — it stayed green under that plant, because the platform's
    // serialise-on-write supplies that isolation whether this class copies or not, so the
    // assertion was testing the fake and not the class.
    const backing = new Uint8Array(4096).fill(0xff)
    const view = backing.subarray(10, 13)

    await store.put(new Key('/peers/view'), view)

    expect(asBytes(storage.inspect('/peers/view')).byteLength).toBe(3)
    expect(asBytes(storage.inspect('/peers/view')).buffer.byteLength).toBe(3)
  })

  it('is unaffected by a caller mutating the array get returned', async () => {
    // The fake returns the stored object by reference, which is what the isolate's read
    // cache does. Without the copy in `get`, this write reaches the store.
    await store.put(new Key('/peers/out'), new Uint8Array([1, 2, 3]))
    const first = await store.get(new Key('/peers/out'))
    first[0] = 99

    expect([...(await store.get(new Key('/peers/out')))]).toEqual([1, 2, 3])
  })

  it('is unaffected by a caller mutating a value a query yielded', async () => {
    await store.put(new Key('/peers/q'), new Uint8Array([1, 2, 3]))
    for await (const pair of store.query({ prefix: '/peers/' })) pair.value[0] = 99

    expect([...(await store.get(new Key('/peers/q')))]).toEqual([1, 2, 3])
  })

  it('skips a non-bytes value in a query instead of failing the whole query', async () => {
    // `FsDatastore._all`'s rule: a query is a read of what is here, and one foreign value
    // must not make the store unreadable.
    await store.put(new Key('/peers/real'), new Uint8Array([1]))
    storage.putRaw(KEY.aForeignValue, 'a string')

    expect(await keysOf('/peers/')).toEqual(['/peers/real'])
  })

  it('round-trips a key through the storage layer’s string names unchanged', async () => {
    // Keys are stored verbatim rather than base32-encoded — the divergence from
    // `FsDatastore` that makes `list({ prefix })` possible. If the name written and the
    // name read back ever disagreed, a query would yield keys no `get` could resolve.
    const name = '/peers/bafzaajaiaejcMiXeDcAsE'
    await store.put(new Key(name), new Uint8Array([1]))

    expect(storage.inspect(name)).toBeDefined()
    expect(await keysOf('/peers/')).toEqual([name])
  })

  it('keeps two keys apart that differ only in case', async () => {
    // `FsDatastore` base32-encodes because APFS folds case. SQLite does not, so the keys
    // stay distinct here for a different reason — asserted so that anyone who later adds
    // encoding "for parity" has to face this case. Note the classifier lower-cases and the
    // *store* does not: normalisation is classification-only, and this is what proves it.
    await store.put(new Key('/peers/QmAbC'), new Uint8Array([1]))
    await store.put(new Key('/peers/QmaBc'), new Uint8Array([2]))

    expect([...(await store.get(new Key('/peers/QmAbC')))]).toEqual([1])
    expect([...(await store.get(new Key('/peers/QmaBc')))]).toEqual([2])
  })
})
