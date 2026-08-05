/**
 * The browser tier's durable sovereign-CID set — DATA-10, criterion 7's at-rest half.
 *
 * The same closure `FsSovereignCids` makes on the Node tier, in the one durable store a
 * tab has. See `SovereignCids` in `@o2/net` for why a CID lookup and `EgressGuard`'s byte
 * scan want different lifetimes, and therefore why this exists rather than a longer-lived
 * hold.
 *
 * **A separate database from the blockstore, not another object store inside it**, for the
 * reason `idb-identity-store.ts` gives about identity: the blockstore is budgeted and
 * evicted as a cache — the demo page deletes it by name — and eviction is per-record, so a
 * set living inside it could be evicted while the blocks it guards survive. That failure
 * is silent and it fails **open**: the tab would serve rows it had recorded as sovereign.
 * Kept apart, a cache wipe cannot take the guard with it.
 *
 * **The honest difference from a file, and it is the same one identity carries:**
 * IndexedDB is evicted silently under storage pressure. A tab that loses this database
 * comes back not knowing a row was sovereign. That is a property of the browser's storage
 * rather than of the browser as a node — a Node process whose `blockstoreDir` is deleted
 * loses exactly as much — but nobody asks the browser first, and the consequence here is
 * serving data rather than losing a name. **Unmeasured**, and stated so it is not
 * discovered later as a surprise.
 */
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { SovereignCids } from '@o2/net'

const STORE = 'sovereign-cids'

interface SovereignCidsDb extends DBSchema {
  [STORE]: {
    key: string
    value: true
  }
}

export class IdbSovereignCids implements SovereignCids {
  readonly #db: IDBPDatabase<SovereignCidsDb>
  readonly #known: Set<string>

  private constructor(db: IDBPDatabase<SovereignCidsDb>, known: Set<string>) {
    this.#db = db
    this.#known = known
  }

  /**
   * Open (creating if absent) and read the whole set into memory.
   *
   * Loaded eagerly because {@link SovereignCids.has} is synchronous — it sits on the
   * `block` branch's hot path, and an implementation awaiting IndexedDB per request would
   * put a storage round trip between a peer and every block it asks for. The set is CID
   * strings, so the memory is proportional to distinct sovereign blocks this tab has held.
   */
  static async open(name: string): Promise<IdbSovereignCids> {
    const db = await openDB<SovereignCidsDb>(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE)
        }
      },
    })
    const known = new Set(await db.getAllKeys(STORE))
    return new IdbSovereignCids(db, known)
  }

  async add(cid: string): Promise<void> {
    if (this.#known.has(cid)) return
    // Written before the in-memory set is updated, for the reason `FsSovereignCids` gives:
    // of the two ways to be wrong, reporting a CID as unknown when the write failed is
    // recoverable on the next start, and believing a row is guarded when nothing recorded
    // it is not.
    await this.#db.put(STORE, true, cid)
    this.#known.add(cid)
  }

  has(cid: string): boolean {
    return this.#known.has(cid)
  }

  get size(): number {
    return this.#known.size
  }

  close(): void {
    this.#db.close()
  }
}
