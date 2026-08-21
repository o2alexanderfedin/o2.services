/**
 * A tab's own identity, held where a Node process holds its `blockstoreDir` files —
 * AUTH-01, the browser tier.
 *
 * `fabric-node.ts` keeps three things beside its blocks: the 32-byte seed
 * (`loadOrCreateSeed`), the provider signing key, and the certificate a provider signed
 * (`loadCertificate` / `saveCertificate`). This is the same three, in the one durable
 * store a tab has. It is a **separate database from the blockstore**, not a fourth object
 * store inside it, because the blockstore is budgeted and evicted as a cache — the demo
 * already deletes it by name — and a wipe of the cache must not silently take the node's
 * name with it.
 *
 * **The honest difference from a file, and the only one: IndexedDB is evicted silently
 * under storage pressure.** That is this repository's own recorded finding, and it is a
 * property of the browser's storage, not of the browser as a node — a Node process whose
 * `blockstoreDir` is deleted loses exactly the same three values. What differs is that
 * nobody asked. `BrowserNodeOptions.whenSeedIsGone` is where a caller says what that
 * costs; nothing here decides it, because a store that quietly minted a new identity
 * would be making that decision on the caller's behalf and never saying so.
 *
 * Same-target rules as the rest of `packages/browser/src`: no `node:` imports.
 * `purity.node.test.ts` lists `browser` under `DUAL_TARGET`.
 */

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { NodeCertificate } from '@o2/core'

const STORE = 'identity'

/** The seed's key. One record, because a node has one identity. */
const SEED_KEY = 'node-seed'
/** The provider signing key's key — present only on a node that issues certificates. */
const PROVIDER_KEY = 'provider-seed'
/** The certificate's key. */
const CERTIFICATE_KEY = 'certificate'

interface IdentityDb extends DBSchema {
  [STORE]: {
    key: string
    value: Uint8Array<ArrayBuffer> | NodeCertificate
  }
}

/**
 * The durable half of a tab's identity.
 *
 * Reads return `null` rather than `undefined` for an absent record, matching
 * `loadCertificate`'s signature in the Node tier so the two call sites read alike.
 */
export class IdbIdentityStore {
  readonly #db: IDBPDatabase<IdentityDb>
  readonly #name: string

  private constructor(db: IDBPDatabase<IdentityDb>, name: string) {
    this.#db = db
    this.#name = name
  }

  /**
   * Open (creating if absent) an identity database.
   *
   * The name is derived from the blockstore's by suffix so one origin can hold several
   * independent nodes — the same property `blockstoreName` already carries, and the
   * reason `two-tabs` topologies work at all.
   */
  static async open(name: string): Promise<IdbIdentityStore> {
    const db = await openDB<IdentityDb>(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE)
        }
      },
    })
    return new IdbIdentityStore(db, name)
  }

  get name(): string {
    return this.#name
  }

  /**
   * The stored seed, or `null` — including the case where storage was evicted.
   *
   * A record of the wrong length is returned as stored rather than repaired: the caller
   * is `identityFromSeed`, which throws `SeedLengthError` by name. Padding it here would
   * turn a corrupted record into a *different working identity*, which is the failure
   * `parseKeyHex`'s doc describes for hex and is worse than a throw for the same reason.
   */
  async loadSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.#readBytes(SEED_KEY)) ?? null
  }

  async saveSeed(seed: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.#db.put(STORE, seed, SEED_KEY)
  }

  /**
   * The stored seed, or one minted **and** persisted in the same transaction — task #49.
   *
   * ## What this replaces, and why the pair it replaces was wrong
   *
   * `browser-node.ts` ran `loadSeed()`, and on `null` called `generateSeed()` and
   * `saveSeed()`. Nothing spanned the read and the write. IndexedDB is per-origin and tabs
   * of one profile share it, so **N tabs opening a cold origin at once each read `null`,
   * each mint, and the last write wins** — leaving N−1 tabs running as nodes whose seed is
   * not the one in storage. Each comes back on its next start as a *different* node, and any
   * certificate naming the old one is orphaned: silent arrival at exactly the state
   * `whenSeedIsGone` exists to make loud.
   *
   * ## Why one transaction is the whole fix, rather than a lock or a retry
   *
   * IndexedDB serialises `readwrite` transactions with overlapping scope, **across
   * connections in one origin** — which is to say across tabs. That is the cross-tab
   * mutual exclusion this needs, and the browser already provides it; nothing here has to
   * invent one. The second transaction sees the first's write and returns it, so the loser
   * *adopts the winner's identity* rather than keeping the one it minted. That is the
   * property, and it is why a retry would have been the wrong shape: the point is not that
   * the write eventually succeeds, it is that exactly one seed can win and everyone else
   * must take it.
   *
   * ## The one constraint on the caller, stated because breaking it is silent
   *
   * `mint` **must be synchronous.** Awaiting anything that is not part of an IndexedDB
   * transaction lets that transaction commit, and the `put` below would then land in a
   * second transaction with the check no longer covering it — the same race, one level
   * further in and harder to see. `generateSeed()` is synchronous, which is what makes this
   * shape available here; `visitor-key.ts` cannot use it and says what it does instead.
   */
  async loadOrMintSeed(mint: () => Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const tx = this.#db.transaction(STORE, 'readwrite')
    const existing = await tx.store.get(SEED_KEY)
    if (existing instanceof Uint8Array) {
      await tx.done
      return existing as Uint8Array<ArrayBuffer>
    }
    const seed = mint()
    await tx.store.put(seed, SEED_KEY)
    await tx.done
    return seed
  }

  /**
   * The provider signing key, or one minted and persisted in the same transaction.
   *
   * {@link loadOrMintSeed}'s reasoning applies unchanged — it is the same read-then-write
   * pair on the same store, reached from `browser-node.ts`'s provider branch. Included in
   * the same pass rather than left for later precisely because "the other one has the same
   * shape" is how a fixed defect comes back.
   */
  async loadOrMintProviderSeed(
    mint: () => Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const tx = this.#db.transaction(STORE, 'readwrite')
    const existing = await tx.store.get(PROVIDER_KEY)
    if (existing instanceof Uint8Array) {
      await tx.done
      return existing as Uint8Array<ArrayBuffer>
    }
    const seed = mint()
    await tx.store.put(seed, PROVIDER_KEY)
    await tx.done
    return seed
  }

  /** The provider signing key this node issues certificates with, or `null`. */
  async loadProviderSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.#readBytes(PROVIDER_KEY)) ?? null
  }

  async saveProviderSeed(seed: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.#db.put(STORE, seed, PROVIDER_KEY)
  }

  /**
   * The certificate a provider signed for this node, or `null`.
   *
   * Nothing is verified here. `resolveCertificate` re-derives the peer id from the
   * stored `nodeKey` and compares it with this node's own, and checks the expiry — the
   * store is not the place that decides whether a signed statement still applies.
   */
  async loadCertificate(): Promise<NodeCertificate | null> {
    const value = await this.#db.get(STORE, CERTIFICATE_KEY)
    return value === undefined || value instanceof Uint8Array ? null : value
  }

  async saveCertificate(certificate: NodeCertificate): Promise<void> {
    await this.#db.put(STORE, certificate, CERTIFICATE_KEY)
  }

  close(): void {
    this.#db.close()
  }

  /**
   * A stored record read as bytes, or `undefined` when it is absent or is not bytes.
   *
   * The type guard is not decoration. IndexedDB round-trips a `NodeCertificate` through
   * the structured clone algorithm, so a key collision would hand a plain object to
   * `identityFromSeed`, and `object.length` is `undefined` — which compares unequal to
   * `SEED_BYTES` and throws `SeedLengthError(undefined)`, a refusal naming the wrong
   * thing. Returning `undefined` makes it the absent case, which is a state the caller
   * already has a decision written down for.
   */
  async #readBytes(key: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const value = await this.#db.get(STORE, key)
    return value instanceof Uint8Array ? value : undefined
  }
}
