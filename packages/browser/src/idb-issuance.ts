/**
 * The browser tier's durable issuance record — AUTH-04, criterion 5.
 *
 * `FsIssuance`'s counterpart, and the same mechanism: a provider's aggregate budget is
 * spent against a history the *host* keeps, so a tab that reloads is the same provider
 * with the same window already spent rather than a fresh one. Read that module's header
 * for what the mechanism buys and — more importantly — for what it does not.
 *
 * **This is not a second kind of node.** Both tiers hold the same authority, the same two
 * budgets and the same refusals. Only the storage differs, exactly as it already does for
 * blocks (`IdbBlockstore`), for the identity seed (`idb-identity-store.ts`) and for the
 * sovereign-CID set (`idb-sovereign-cids.ts`). `enrollment.ts` states the rule at length:
 * all nodes have equal functionality and only *discovery* differs.
 *
 * ## The one asymmetry, written down as a bound rather than as a caveat
 *
 * `IssuanceLedger.record` is **synchronous**, because `EnrollmentAuthority.enrol` is and
 * `packages/net/src/agent.ts` records that this is *why* its `enrol` branch takes no
 * capacity slot. IndexedDB has no synchronous API. So where the Node tier's append has
 * already returned, this tier's write is durable **one turn later**.
 *
 * The exposure that buys is *at most the issuances made since the last turn of the event
 * loop*, because a write is scheduled on **every** `record` rather than batched. A tab
 * answering one enrolment frame at a time — which is what `serveAgent` does — risks
 * exactly one. `idb-issuance.browser.test.ts` asserts that count rather than describing
 * it, and {@link outstanding} is what it reads.
 *
 * That number is stated here because an unstated asymmetry is how a reader six months from
 * now invents a node class out of a storage API. It is a platform fact of the same kind as
 * a blockstore on IndexedDB, and it is bounded, and the bound is one.
 *
 * **The running budget does not lag at all.** The in-memory maps are updated inside
 * `record`, so the authority's own arithmetic is exact from the instant it signs. Only
 * what a *reload* would recover is a turn behind.
 *
 * ## The honest limit nobody can close from here
 *
 * IndexedDB is evicted silently under storage pressure, so a tab that loses this database
 * comes back not knowing what it signed. That is the same exposure `idb-sovereign-cids.ts`
 * records for itself, it is a property of the browser's storage rather than of the browser
 * as a node — a Node process whose `blockstoreDir` is deleted loses exactly as much — and
 * it is **unmeasured**.
 *
 * **A separate database from the blockstore**, for `idb-sovereign-cids.ts`'s reason: the
 * blockstore is budgeted and evicted as a cache and the demo page deletes it by name, so a
 * record living inside it could be wiped while the certificates it bounds stay signed.
 * The name is derived by suffix from the blockstore's, as the identity database and the
 * sovereign-CID set already are, so one origin can hold several independent nodes without
 * either one's refusals becoming a statement about the other.
 */
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { IssuanceLedger, PublicKeyHex } from '@o2/core'

const STORE = 'issuance'

interface IssuanceRecord {
  readonly at: number
  readonly userKey: string
}

interface IssuanceDb extends DBSchema {
  [STORE]: {
    key: number
    value: IssuanceRecord
  }
}

export interface IdbIssuanceOptions {
  /**
   * How far back entries are kept on load. Must be **at least** the authority's
   * `windowMs`; the factory passes `DEFAULT_ISSUANCE_WINDOW_MS`, which is what that
   * authority defaults to. See `FsIssuance`'s option of the same name.
   */
  readonly retainMs: number
  /** The instant compaction is measured from. A parameter, so tests are deterministic. */
  readonly now?: number
}

export class IdbIssuance implements IssuanceLedger {
  readonly #db: IDBPDatabase<IssuanceDb>
  readonly #byUser: Map<PublicKeyHex, number[]>
  readonly #anybody: number[]
  #outstanding = 0
  #tail: Promise<void> = Promise.resolve()

  private constructor(db: IDBPDatabase<IssuanceDb>, entries: readonly IssuanceRecord[]) {
    this.#db = db
    this.#byUser = new Map()
    this.#anybody = []
    for (const entry of entries) this.#remember(entry.userKey, entry.at)
  }

  /**
   * Open (creating if absent) and read the whole record into memory, compacting what the
   * window can no longer reach.
   *
   * Eager and complete, for `FsIssuance`'s reason: both budgets must be whole before the
   * authority answers anything, and `issuedTo`/`issuedToAnybody` are synchronous because
   * `enrol` is — an implementation awaiting IndexedDB per question would put a storage
   * round trip inside a call that is required not to suspend.
   *
   * Compaction happens **on load and never on write**, and an issuance older than the
   * window can be forgotten because both budgets filter to the window before reading it.
   * That is deliberately unlike a *spend* record, which can never be forgotten — a reader
   * arriving from the invitation design this replaced will expect that rule and this is
   * not it.
   */
  static async open(name: string, options: IdbIssuanceOptions): Promise<IdbIssuance> {
    const db = await openDB<IssuanceDb>(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { autoIncrement: true })
        }
      },
    })
    const now = options.now ?? Date.now()
    const floor = now - options.retainMs

    const kept: IssuanceRecord[] = []
    const drop: number[] = []
    // Read with the keys, so compaction deletes exactly the records it decided about
    // rather than re-deriving which they were.
    for (const [key, value] of await entriesOf(db)) {
      if (value.at > floor) kept.push(value)
      else drop.push(key)
    }
    if (drop.length > 0) {
      const tx = db.transaction(STORE, 'readwrite')
      for (const key of drop) void tx.store.delete(key)
      await tx.done
    }
    return new IdbIssuance(db, kept)
  }

  /** Every issue timestamp recorded for one user key, **unpruned** — see `FsIssuance`. */
  issuedTo(userKey: PublicKeyHex): readonly number[] {
    return this.#byUser.get(userKey) ?? []
  }

  /** Every issue timestamp recorded for anybody, unpruned. */
  issuedToAnybody(): readonly number[] {
    return this.#anybody
  }

  /**
   * Record one issuance: in memory now, on disk one turn later.
   *
   * The write is scheduled on this call and not batched, which is what makes the gap in
   * this module's header exactly one issuance rather than an unbounded backlog. Writes are
   * chained rather than raced so their order in the database is their order here.
   *
   * A failed write leaves the entry counted for this process — a running tab is still
   * bound by what it signed — and is reported through {@link whenDurable} rather than
   * thrown out of a synchronous call `enrol` has no way to handle.
   */
  record(userKey: PublicKeyHex, at: number): void {
    this.#remember(userKey, at)
    this.#outstanding += 1
    this.#tail = this.#tail
      .then(async () => {
        await this.#db.add(STORE, { at, userKey })
      })
      .finally(() => {
        this.#outstanding -= 1
      })
  }

  /**
   * Issuances counted by this object whose write has not yet resolved.
   *
   * The measurable form of this module's stated bound. Zero on the Node tier by
   * construction; one here, for a tab answering one enrolment at a time.
   */
  get outstanding(): number {
    return this.#outstanding
  }

  /**
   * Settle when everything recorded so far is durable.
   *
   * Not on the enrolment path — `enrol` cannot await anything — but a tab that wants to
   * know its record is safe, and every test that asserts durability, has to be able to ask.
   */
  async whenDurable(): Promise<void> {
    await this.#tail
  }

  /** How many issuances are recorded. For tests and for anyone sizing the growth. */
  get size(): number {
    return this.#anybody.length
  }

  close(): void {
    this.#db.close()
  }

  #remember(userKey: PublicKeyHex, at: number): void {
    const existing = this.#byUser.get(userKey)
    if (existing === undefined) this.#byUser.set(userKey, [at])
    else existing.push(at)
    this.#anybody.push(at)
  }
}

/**
 * Every record with its key, in insertion order.
 *
 * `getAll` and `getAllKeys` are read inside one transaction, so the two arrays describe
 * the same snapshot — two separate reads could be interleaved by a write from another tab
 * on the same origin and would then pair a key with somebody else's record.
 */
async function entriesOf(db: IDBPDatabase<IssuanceDb>): Promise<readonly [number, IssuanceRecord][]> {
  const tx = db.transaction(STORE, 'readonly')
  const values = await tx.store.getAll()
  const keys = await tx.store.getAllKeys()
  await tx.done
  return keys.map((key, index) => [key, values[index] as IssuanceRecord])
}
