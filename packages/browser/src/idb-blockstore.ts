/**
 * IndexedDB blockstore — DATA-02, the browser half of persistent storage.
 *
 * Deliberately implements the kernel's four-method `Blockstore` port directly
 * rather than wrapping `blockstore-idb`. That package implements
 * `interface-blockstore`, a different and much wider contract, so using it would
 * mean an adapter over an adapter plus six transitive dependencies to reach an
 * interface we already have. `idb` is used for the promise wrapping because
 * hand-rolling IndexedDB transaction plumbing is exactly the kind of
 * platform-reimplementation this project has already paid for once.
 *
 * The CID scheme is identical to `MemoryBlockstore` and `FsBlockstore`. That is
 * the whole point of DATA-02: a block written by a browser and a block written by
 * a Node process are the same block, addressed the same way, so either can serve
 * the other.
 *
 * `size` is synchronous in the port, so it is a counter seeded by counting rows in
 * `open()` — which is also what makes it correct when a tab reopens onto a
 * database that already has blocks in it.
 *
 * Browsers evict IndexedDB silently under storage pressure. A missing block is
 * therefore a normal condition, not corruption: `get` returning `undefined` is
 * exactly what `FetchingBlockstore` treats as "ask a peer".
 */

import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { Blockstore } from '@o2/core'

const STORE = 'blocks'

interface BlockDb extends DBSchema {
  [STORE]: {
    /** The CID string. Base32-lowercase, so it is a valid key with no escaping. */
    key: string
    value: Uint8Array<ArrayBuffer>
  }
}

export class IdbBlockstore implements Blockstore {
  readonly #db: IDBPDatabase<BlockDb>
  readonly #name: string
  #count: number

  private constructor(db: IDBPDatabase<BlockDb>, name: string, count: number) {
    this.#db = db
    this.#name = name
    this.#count = count
  }

  /**
   * Open (creating if absent) a block database.
   *
   * Async because the count has to come from what is already stored — the reopen
   * case, which is the one that matters for a returning visitor.
   */
  static async open(name = 'o2-blocks'): Promise<IdbBlockstore> {
    const db = await openDB<BlockDb>(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE)
        }
      },
    })
    const count = await db.count(STORE)
    return new IdbBlockstore(db, name, count)
  }

  /** Database name, so a caller can delete or inspect it. */
  get name(): string {
    return this.#name
  }

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    const digest = await sha256.digest(bytes)
    const cid = CID.create(1, dagCbor.code, digest)
    const key = cid.toString()

    // Content-addressed: an existing entry is byte-identical, so rewriting it
    // would spend the storage quota for nothing.
    const tx = this.#db.transaction(STORE, 'readwrite')
    const existing = await tx.store.getKey(key)
    if (existing === undefined) {
      await tx.store.put(bytes, key)
      this.#count += 1
    }
    await tx.done
    return cid
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return this.#db.get(STORE, cid.toString())
  }

  async has(cid: CID): Promise<boolean> {
    return (await this.#db.getKey(STORE, cid.toString())) !== undefined
  }

  get size(): number {
    return this.#count
  }

  /** Re-read the row count from storage, e.g. after the browser has evicted. */
  async refresh(): Promise<number> {
    this.#count = await this.#db.count(STORE)
    return this.#count
  }

  close(): void {
    this.#db.close()
  }
}
