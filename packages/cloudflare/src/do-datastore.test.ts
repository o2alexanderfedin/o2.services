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
 * Not one assertion reads `DoDatastore.refusedKeyPrefixes`. A spec that derived its inputs
 * from the array it is testing moves with it, and would stay green if the array were
 * emptied. The literals below are transcribed from where the prefixes were derived:
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
 */

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
    await store.put(new Key('/pkcs8/self'), new Uint8Array([3]))
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
    const seen: string[] = []
    for await (const key of store.queryKeys({ prefix: '/pkcs8/' })) seen.push(key.toString())

    expect(seen).toEqual(['/pkcs8/self'])
  })

  it('returns everything when no prefix is given', async () => {
    const seen: string[] = []
    for await (const key of store.queryKeys({})) seen.push(key.toString())

    expect(seen.sort()).toEqual(['/peers/aaa', '/peers/bbb', '/pkcs8/self'])
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
    for await (const _ of store.queryKeys({})) {
      // drain
    }

    expect(storage.listCalls).toEqual([undefined])
  })
})

describe('the record-shaped-key refusal — Phase 29 criterion 3', () => {
  // Literal keys, transcribed from the derivations in this file's header. `<base32>` bodies
  // are plausible rather than real: the guard reads the prefix and nothing else, and a real
  // multihash here would only make the spec look like it verified something it did not.
  const RECORD_SHAPED: string[] = [
    '/dht/record/ciqbed3k6ydc2b3nrqhdf4kvvrxvcgk3rlnhgcpzeqqbwqjbrqbwqbw',
    '/dht/provider/ciqbed3k6ydc2b3nrqhdf4kvvrxvcgk3rlnhgcpzeqq/12D3KooWGUfBFMn6L4mYf8SBrW7gMyc4e93xUJjsaGSRjqFe5scm',
    '/o2/8a9f0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e',
  ]

  const IDENTITY_SHAPED: string[] = [
    '/pkcs8/self',
    '/info/self',
    '/peers/bafzaajaiaejcbw6svgm2y4nxrqwqkfsqm4pv3vnhnvnyanhkzdmwyfsw3zvpn5ja',
  ]

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

  it('carries the key and the matched prefix on the error, not only a message', async () => {
    const failure = await store
      .put(new Key('/dht/record/ciqbed3k6ydc2b3'), new Uint8Array([1]))
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(failure).toBeInstanceOf(RecordShapedKeyRefusedError)
    expect(failure).toMatchObject({
      name: 'RecordShapedKeyRefusedError',
      code: 'ERR_O2_RECORD_SHAPED_KEY_REFUSED',
      key: '/dht/record/ciqbed3k6ydc2b3',
      matchedPrefix: '/dht/',
    })
  })

  it('refuses as a rejection and not as a synchronous throw', async () => {
    // `put(…).catch(…)` never enters its handler if the call throws before returning — the
    // finding `FsDatastore.get`'s docblock records from the other side. Calling it outside
    // a `try` is what proves nothing was thrown synchronously.
    const pending = store.put(new Key('/o2/deadbeef'), new Uint8Array([1]))

    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toBeInstanceOf(RecordShapedKeyRefusedError)
  })

  it('refuses through the batch path as well', async () => {
    // `BaseDatastore.batch()` funnels through `putMany` to `put`. The keychain writes this
    // way (`@libp2p/keychain/dist/src/keychain.js:206`), so a guard that only covered the
    // direct call would be bypassed by the very component whose keys this store exists to
    // hold.
    const batch = store.batch()
    batch.put(new Key('/pkcs8/self'), new Uint8Array([1]))
    batch.put(new Key('/dht/record/ciqbed3k6ydc2b3'), new Uint8Array([2]))

    await expect(batch.commit()).rejects.toBeInstanceOf(RecordShapedKeyRefusedError)
    expect(storage.inspect('/dht/record/ciqbed3k6ydc2b3')).toBeUndefined()
  })

  it('admits a key that merely contains a refused prefix later on', async () => {
    // The guard is `startsWith`, not `includes`. Stated as a spec so that widening it to
    // `includes` — which looks stricter and is wrong — fails here rather than silently
    // refusing legitimate peer records.
    await store.put(new Key('/peers/dht/record/whatever'), new Uint8Array([4]))

    expect([...(await store.get(new Key('/peers/dht/record/whatever')))]).toEqual([4])
  })

  it('does not refuse a get, a has or a delete of a record-shaped key', async () => {
    // The criterion refuses *accumulation*. A read of a key that cannot be there is a miss,
    // not an error, and a store that threw here would break any caller that probes before
    // writing.
    await expect(store.get(new Key('/dht/record/x'))).rejects.toMatchObject({
      name: 'NotFoundError',
    })
    expect(await store.has(new Key('/dht/record/x'))).toBe(false)
    await expect(store.delete(new Key('/dht/record/x'))).resolves.toBeUndefined()
  })

  it('classifies without writing', async () => {
    expect(DoDatastore.refusedPrefixFor(new Key('/dht/record/x'))).toBe('/dht/')
    expect(DoDatastore.refusedPrefixFor(new Key('/o2/abc'))).toBe('/o2/')
    expect(DoDatastore.refusedPrefixFor(new Key('/peers/abc'))).toBeUndefined()
    expect(storage.size).toBe(0)
  })
})

describe('the storage layer’s own semantics, which the datastore has to absorb', () => {
  it('stores only the bytes of a view, not its whole backing buffer', async () => {
    // Structured-cloning a typed array serialises the entire underlying `ArrayBuffer`, and
    // length-prefixed libp2p decoding hands out `subarray` views of large buffers. Without
    // the copy in `put`, three bytes would cost 4 096.
    const backing = new Uint8Array(4096).fill(0xff)
    const view = backing.subarray(10, 13)

    await store.put(new Key('/peers/view'), view)

    expect(asBytes(storage.inspect('/peers/view')).byteLength).toBe(3)
    expect(asBytes(storage.inspect('/peers/view')).buffer.byteLength).toBe(3)
  })

  it('is unaffected by a caller mutating the array it handed to put', async () => {
    const mine = new Uint8Array([1, 2, 3])
    await store.put(new Key('/peers/mine'), mine)
    mine[0] = 99

    expect([...(await store.get(new Key('/peers/mine')))]).toEqual([1, 2, 3])
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

  it('names a non-bytes value rather than returning it as bytes', async () => {
    // A Durable Object's storage is one namespace and the object may keep its own JSON
    // there. Reachable, so it has an outcome.
    storage.putRaw('/peers/foreign', { notBytes: true })

    await expect(store.get(new Key('/peers/foreign'))).rejects.toBeInstanceOf(
      StoredValueNotBytesError,
    )
  })

  it('skips a non-bytes value in a query instead of failing the whole query', async () => {
    // `FsDatastore._all`'s rule: a query is a read of what is here, and one foreign value
    // must not make the store unreadable.
    await store.put(new Key('/peers/real'), new Uint8Array([1]))
    storage.putRaw('/peers/foreign', 'a string')

    const seen: string[] = []
    for await (const key of store.queryKeys({ prefix: '/peers/' })) seen.push(key.toString())

    expect(seen).toEqual(['/peers/real'])
  })

  it('round-trips a key through the storage layer’s string names unchanged', async () => {
    // Keys are stored verbatim rather than base32-encoded — the divergence from
    // `FsDatastore` that makes `list({ prefix })` possible. If the name written and the
    // name read back ever disagreed, a query would yield keys no `get` could resolve.
    const name = '/peers/bafzaajaiaejcMiXeDcAsE'
    await store.put(new Key(name), new Uint8Array([1]))

    expect(storage.inspect(name)).toBeDefined()
    const seen: string[] = []
    for await (const key of store.queryKeys({ prefix: '/peers/' })) seen.push(key.toString())
    expect(seen).toEqual([name])
  })

  it('keeps two keys apart that differ only in case', async () => {
    // `FsDatastore` base32-encodes because APFS folds case. SQLite does not, so the keys
    // stay distinct here for a different reason — asserted so that anyone who later adds
    // encoding "for parity" has to face this case.
    await store.put(new Key('/peers/QmAbC'), new Uint8Array([1]))
    await store.put(new Key('/peers/QmaBc'), new Uint8Array([2]))

    expect([...(await store.get(new Key('/peers/QmAbC')))]).toEqual([1])
    expect([...(await store.get(new Key('/peers/QmaBc')))]).toEqual([2])
  })
})
