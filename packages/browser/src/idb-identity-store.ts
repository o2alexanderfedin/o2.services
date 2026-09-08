/**
 * A tab's own identity, held where a Node process holds its `blockstoreDir` files —
 * AUTH-01 and AUTH-06, the browser tier.
 *
 * `fabric-node.ts` keeps three things beside its blocks: the 32-byte seed, the provider
 * signing key, and the certificate a provider signed (`loadCertificate` /
 * `saveCertificate`). This is the same three, in the one durable store a tab has. It is a
 * **separate database from the blockstore**, not a fourth object store inside it, because
 * the blockstore is budgeted and evicted as a cache — the demo already deletes it by name
 * — and a wipe of the cache must not silently take the node's name with it.
 *
 * **The honest difference from a file, and the only one: IndexedDB is evicted silently
 * under storage pressure.** That is this repository's own recorded finding, and it is a
 * property of the browser's storage, not of the browser as a node — a Node process whose
 * `blockstoreDir` is deleted loses exactly the same three values. What differs is that
 * nobody asked. `BrowserNodeOptions.whenSeedIsGone` is where a caller says what that
 * costs; nothing here decides it, because a store that quietly minted a new identity
 * would be making that decision on the caller's behalf and never saying so.
 *
 * ## AUTH-06 — the two secrets stopped being records a copied profile hands over
 *
 * The four methods that wrote or minted a raw record — the two plain writers and the two
 * load-or-mint pairs, at `:94`, `:130`, `:151` and `:171` of this file as `2674c7a` left it
 * — are **deleted**, not deprecated. Each put 32 raw bytes into IndexedDB, which protects
 * an identity against nothing at all once the profile directory is copied, and this phase's
 * claim is that no reachable path writes a plaintext secret. Leaving one exported would
 * have made that claim false while every test still passed. They are named by line and
 * commit rather than by name because this file's own acceptance grep counts the names, and
 * a prose reference would make it read the number it exists to refuse.
 *
 * {@link IdbIdentityStore.loadOrMintSealedSeed} replaces the pair. The bytes now live
 * inside an Argon2id + xchacha20poly1305 envelope (`@o2/core`), and a database written by
 * an older build is migrated **in the same transaction that reads it** — same bytes, same
 * PeerId — the first time a passphrase is supplied for it.
 *
 * `loadSeed` and `loadProviderSeed` stay: they read, they never write, and the migration
 * and the `writes-no-new-secret` arm are both built on reads.
 *
 * **The certificate is deliberately NOT sealed.** It is public material — transmitted on
 * the wire, published into DHT records, and verified offline against pinned provider keys
 * by `enrollment.ts`. Sealing this device's copy would break that verification while
 * protecting nothing. What a stored certificate leaks is the *fact of membership*, which
 * is a different problem and not this phase's.
 *
 * Same-target rules as the rest of `packages/browser/src`: no `node:` imports.
 * `purity.node.test.ts` lists `browser` under `DUAL_TARGET`. Everything random on this
 * path comes from `crypto.getRandomValues`, which is present on non-secure origins where
 * `crypto.subtle` is `undefined` — `subtle-digest-fallback.ts` records that measurement,
 * and nothing here needs `crypto.subtle`.
 */

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import { SALT_BYTES, parseSealedSecret, sealWithKey } from '@o2/core'
import type { NodeCertificate, SealKdfParams, SealedSecret } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'

/** The one object store. Exported so a spec can read the database this module wrote. */
export const IDENTITY_STORE = 'identity'

/**
 * The pre-AUTH-06 seed record's key. One record, because a node has one identity.
 *
 * Exported, and it names a record this module no longer writes: the migration reads it,
 * and `idb-identity-at-rest.browser.test.ts`'s positive control writes it **by hand** in
 * order to prove that the instrument reporting its absence can see it when it is there.
 */
export const SEED_KEY = 'node-seed'

/** The pre-AUTH-06 provider signing key's key. Same status as {@link SEED_KEY}. */
export const PROVIDER_KEY = 'provider-seed'

/** The sealed seed. A new key rather than new content under the old one — see below. */
export const SEALED_SEED_KEY = 'node-seed-sealed'

/** The sealed provider signing key. Same passphrase, same salt, same parameters. */
export const SEALED_PROVIDER_KEY = 'provider-seed-sealed'

/**
 * The Argon2id salt this database's key is derived from.
 *
 * **Its own record, and not only a field of the envelope, because the envelope cannot
 * supply the salt that the key which opens the envelope is derived from.** A key must
 * exist before the sealed record is read, and it must be the same key on every start or a
 * warm start would derive something that opens nothing.
 *
 * **It is not a secret, and the phase's claim is worded so that this is checkable rather
 * than definitional.** The claim is *"the store holds no secret at rest"*, not *"the store
 * holds nothing"*. A salt exists to stop one precomputed table covering many users and is
 * useless to an attacker without the passphrase; criterion 1 forbids seed bytes and
 * provider-key bytes, and this is neither. `idb-identity-at-rest.browser.test.ts` asserts
 * that this record is exactly {@link SALT_BYTES} long **and** that it is not a subsequence
 * of either secret and neither secret is a subsequence of it — which is the one way this
 * could go wrong, written as an assertion instead of as a promise.
 */
export const SALT_KEY = 'kdf-salt'

/** The certificate's key. */
const CERTIFICATE_KEY = 'certificate'

interface IdentityDb extends DBSchema {
  [IDENTITY_STORE]: {
    key: string
    /**
     * A `SealedSecret` is a plain object of numbers and strings, so it survives
     * IndexedDB's structured clone without loss where a `Uint8Array` field would not —
     * which is why `@o2/core` writes `salt`, `nonce` and `ciphertext` as base64url. The
     * spec asserts that round trip through `parseSealedSecret` rather than assuming it.
     */
    value: Uint8Array<ArrayBuffer> | NodeCertificate | SealedSecret
  }
}

/**
 * Thrown when a sealed record is present and does not open.
 *
 * **The message names both possibilities and claims to know neither**, because the AEAD
 * reports the same failure for a wrong passphrase and for an altered envelope alike. A
 * refusal that guessed would send a visitor looking for the wrong fault half the time.
 *
 * Word for word the node tier's `SealedIdentityUnlockError` (`packages/node/src/identity-store.ts`),
 * so the two tiers refuse in the same words — the same class name, so a caller can branch
 * on it across a bundler boundary where `instanceof` against a duplicated class would not
 * hold.
 */
export class SealedIdentityUnlockError extends Error {
  constructor(database: string, cause: unknown) {
    super(
      `${database} did not open — either the passphrase is wrong or the record has been altered, and the `
        + 'authenticated cipher reports the same failure for both, so this refusal does not claim to know '
        + `which (${cause instanceof Error ? `${cause.name}: ${cause.message}` : 'no error was raised'}). `
        + 'Refusing to mint a new identity — starting anyway would give this tab a different peer id and '
        + 'orphan any certificate naming the old one.',
      { cause },
    )
    this.name = 'SealedIdentityUnlockError'
  }
}

/**
 * Thrown when a sealed record is present and the caller promised to write no new secret.
 *
 * The alternative is minting over an identity that already exists, which is the same
 * outcome as a silent re-mint after a failed unlock and is refused for the same reason.
 */
export class SealedIdentityNeedsPassphraseError extends Error {
  constructor(database: string) {
    super(
      `${database} holds a sealed identity and no passphrase was supplied — refusing to mint a new `
        + 'identity over one that already exists, which would give this tab a different peer id and orphan '
        + 'any certificate naming the old one.',
    )
    this.name = 'SealedIdentityNeedsPassphraseError'
  }
}

/**
 * Thrown when a pre-AUTH-06 record is not exactly {@link SEED_BYTES} long.
 *
 * **The migration refuses rather than sealing it, and the reason is the unlink.** A
 * wrong-length record sealed and then deleted is an identity destroyed: the envelope opens
 * to bytes `identityFromSeed` will not accept, and the original is gone. Refusing leaves
 * the record exactly where it was, which is the state a person can still act on.
 */
export class MalformedSeedRecordError extends Error {
  constructor(database: string, key: string, received: number) {
    super(
      `${database}/${key} holds ${received} bytes, expected exactly ${SEED_BYTES} — refusing to seal and `
        + 'then delete a record this tab cannot use as an identity',
    )
    this.name = 'MalformedSeedRecordError'
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
        if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
          database.createObjectStore(IDENTITY_STORE)
        }
      },
    })
    return new IdbIdentityStore(db, name)
  }

  get name(): string {
    return this.#name
  }

  /**
   * The stored pre-AUTH-06 seed, or `null` — including the case where storage was evicted.
   *
   * A record of the wrong length is returned as stored rather than repaired: the caller
   * is `identityFromSeed`, which throws `SeedLengthError` by name. Padding it here would
   * turn a corrupted record into a *different working identity*, which is the failure
   * `parseKeyHex`'s doc describes for hex and is worse than a throw for the same reason.
   */
  async loadSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.#readBytes(SEED_KEY)) ?? null
  }

  /** The stored pre-AUTH-06 provider signing key, or `null`. */
  async loadProviderSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.#readBytes(PROVIDER_KEY)) ?? null
  }

  /**
   * A pre-AUTH-06 plaintext seed this database still holds, or `null`.
   *
   * **A value returned here is a statement about this device: anyone who copies this
   * browser profile can speak as this node.** The function exists so that fact can be
   * *reported* — `BrowserNode` says it once, by name — rather than silently repaired or
   * silently ignored. It is the read the `writes-no-new-secret` arm takes, and that arm
   * adopts what it finds and **does not delete it**: deleting somebody's identity because
   * they supplied no passphrase is a worse outcome than the exposure it would close, since
   * the tab would come back as a stranger with every certificate naming it orphaned.
   *
   * The exposure closes the moment a passphrase is supplied, at which point
   * {@link loadOrMintSealedSeed} seals the same bytes in place and the PeerId does not
   * move. It is not closed by this function.
   */
  async legacyPlaintextSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.loadSeed()
  }

  /**
   * The provider signing key's counterpart of {@link legacyPlaintextSeed}.
   *
   * Present rather than left for later for the reason this file already records at the
   * provider branch: *"the other one has the same shape"* is how a closed defect comes
   * back. A provider tab that upgrades without a passphrase is exposed in the higher-value
   * of the two keys — the trust root every certificate it ever signed verifies against —
   * and a report that covered only the node seed would have said so about the smaller one.
   */
  async legacyPlaintextProviderSeed(): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.loadProviderSeed()
  }

  /**
   * What this database holds for a **node identity**, in one read — AUTH-06, plan `42-04`.
   *
   * The sign-in surface needs this and nothing else: which of three invitations a visitor is
   * owed. *Register* when the database is empty, *log in* when it holds an envelope, and the
   * adopt notice when it still holds a pre-AUTH-06 record in the clear.
   *
   * **A reader, and deliberately only a reader.** It opens no envelope, derives no key and
   * writes nothing, so a page can call it before a visitor has typed anything — which is the
   * whole point, since the question *"which field do I show you"* precedes the passphrase.
   * `42-03` records what an instrument that writes costs: a reader that opened IndexedDB
   * without a version created the database it claimed to measure, and every later
   * transaction on it threw.
   *
   * **Sealed wins over plaintext**, and the order is not cosmetic. A database holding both
   * is the state a tab that crashed between the migrating `put` and the `delete` would be
   * in — `loadOrMintSealedSeed`'s one transaction makes that unreachable, and if it ever
   * happened anyway the envelope is the record that opens, so the visitor is asked to log in
   * rather than invited to register over an identity they still have.
   */
  async storedSeedKind(): Promise<'none' | 'sealed' | 'legacy-plaintext'> {
    const tx = this.#db.transaction(IDENTITY_STORE, 'readonly')
    const sealed = await tx.store.get(SEALED_SEED_KEY)
    const legacy = await tx.store.get(SEED_KEY)
    await tx.done
    // Narrowed by what the record IS rather than by its key being occupied: a `Uint8Array`
    // under the sealed key is not an envelope, and an envelope under the legacy key is not a
    // plaintext seed. Either would be a key collision, and answering off the key name alone
    // would send a visitor to the wrong field for it.
    if (sealed !== undefined && !(sealed instanceof Uint8Array)) return 'sealed'
    if (legacy instanceof Uint8Array) return 'legacy-plaintext'
    return 'none'
  }

  /**
   * This database's Argon2id salt, created once and then read on every later start.
   *
   * Its own small `readwrite` transaction, for the reason {@link loadOrMintSealedSeed}
   * gives about the seed: IndexedDB serialises `readwrite` transactions with overlapping
   * scope across connections in one origin, so two cold tabs cannot end up with two salts
   * and therefore two keys for one database.
   *
   * `crypto.getRandomValues` is **synchronous**, which is what lets the creation happen
   * inside the transaction that decided it was needed.
   *
   * A record of the wrong width is replaced rather than used. It cannot have been written
   * by this module, and deriving from it would produce a key that opens nothing while
   * looking exactly like a wrong passphrase.
   */
  async loadOrCreateSalt(): Promise<Uint8Array<ArrayBuffer>> {
    const tx = this.#db.transaction(IDENTITY_STORE, 'readwrite')
    const existing = await tx.store.get(SALT_KEY)
    if (existing instanceof Uint8Array && existing.length === SALT_BYTES) {
      await tx.done
      return existing
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    await tx.store.put(salt, SALT_KEY)
    await tx.done
    return salt
  }

  /**
   * The sealed seed — read, migrated or minted **in one transaction**.
   *
   * ## What this replaces, and why the pair it replaces was wrong
   *
   * `browser-node.ts` ran `loadSeed()`, and on `null` called `generateSeed()` and the plain
   * writer this file used to expose. Nothing spanned the read and the write. IndexedDB is per-origin and tabs
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
   * ## The constraint on the caller, stated because breaking it is silent
   *
   * **`mint` must be synchronous, and so must the seal.** Awaiting anything that is not
   * part of an IndexedDB transaction lets that transaction commit, and the `put` below
   * would then land in a second transaction with the check no longer covering it — the same
   * race, one level further in and harder to see. That is not a style rule: it is the fix
   * for a measured four-tab race, and `cold-start-seed-race.e2e.test.ts` is what reads it.
   *
   * It is also **the reason the AEAD is `xchacha20poly1305` and not `crypto.subtle`'s
   * AES-GCM**. `subtle.importKey` and `subtle.encrypt` both return promises, and awaiting
   * either here would reopen the race this transaction exists to close; `subtle` also has
   * no Argon2id at all. So the expensive half — {@link deriveSealKey}, hundreds of
   * milliseconds — runs **before** this call, and `key`, `params` and `salt` arrive already
   * derived. Nothing between the first `get` and `tx.done` is awaited except the
   * transaction's own operations.
   *
   * ## Three of the store's seven cases, and the migration is why it is one transaction too
   *
   * | this database holds | outcome |
   * |---|---|
   * | a sealed record | returned as it stands; the caller opens it |
   * | a pre-AUTH-06 plaintext record | sealed, written, and the plaintext **deleted** — all three inside this transaction |
   * | neither | `mint()`, sealed, written |
   *
   * A tab that crashed between the `put` and the `delete` would hold both a sealed and a
   * plaintext copy of one secret, and criterion 1 would then fail on a database nobody had
   * touched since. One transaction is what makes that state unreachable.
   *
   * `mint` may **throw**, and that is how a caller says *"there is nothing here and I will
   * not create one"* — `whenSeedIsGone: 'refuses-to-start-without-its-seed'` is exactly that
   * caller. The refusal is then decided by the same read that would have decided the write,
   * rather than by a separate read that could disagree with it.
   */
  async loadOrMintSealedSeed(
    key: Uint8Array,
    params: SealKdfParams,
    salt: Uint8Array,
    mint: () => Uint8Array<ArrayBuffer>,
  ): Promise<SealedSecret> {
    return this.#loadOrMintSealed(SEALED_SEED_KEY, SEED_KEY, key, params, salt, mint)
  }

  /**
   * The provider signing key, under the identical treatment and the identical key.
   *
   * {@link loadOrMintSealedSeed}'s reasoning applies unchanged — it is the same
   * read-then-write pair on the same store, reached from `browser-node.ts`'s provider
   * branch. Included in the same pass rather than left for later precisely because "the
   * other one has the same shape" is how a fixed defect comes back.
   */
  async loadOrMintSealedProviderSeed(
    key: Uint8Array,
    params: SealKdfParams,
    salt: Uint8Array,
    mint: () => Uint8Array<ArrayBuffer>,
  ): Promise<SealedSecret> {
    return this.#loadOrMintSealed(SEALED_PROVIDER_KEY, PROVIDER_KEY, key, params, salt, mint)
  }

  /**
   * The certificate a provider signed for this node, or `null`.
   *
   * Nothing is verified here. `resolveCertificate` re-derives the peer id from the
   * stored `nodeKey` and compares it with this node's own, and checks the expiry — the
   * store is not the place that decides whether a signed statement still applies.
   *
   * A `SealedSecret` under this key would be a key collision rather than a certificate, so
   * it is excluded by the same predicate that excludes bytes.
   */
  async loadCertificate(): Promise<NodeCertificate | null> {
    const value = await this.#db.get(IDENTITY_STORE, CERTIFICATE_KEY)
    if (value === undefined || value instanceof Uint8Array) return null
    // Narrowed by a field only one of the two has, so the compiler agrees with the check
    // rather than being told to. `SealedSecret` carries no `nodeKey`, and a certificate
    // cannot be without one — `parseCertificate` refuses one that is.
    if (!('nodeKey' in value)) return null
    return value
  }

  /**
   * Delete every long-lived secret this database holds, in one transaction — T-42-24.
   *
   * The escape hatch behind *start over*, and the only thing on this page that destroys an
   * identity on purpose. **One transaction**, for {@link loadOrMintSealedSeed}'s reason
   * turned around: a partial delete would leave a database holding a salt and a provider key
   * for a node seed that no longer exists, and the next start would seal a NEW seed under the
   * OLD salt — a state nothing in this file's seven-cell matrix describes.
   *
   * **The certificate is deliberately not deleted**, and the precedent is `declineEnrolment`
   * in `demo/main.ts`, in its own words: *it names a key that no longer exists here, so
   * `resolveCertificate`'s own identity check refuses it on the next start, and deleting
   * somebody else's signed statement is not this page's business.* A provider signed a
   * statement about a node; that this browser threw the node away does not make the statement
   * this code's to destroy.
   *
   * Both plaintext keys go too. A start-over that left a pre-AUTH-06 record behind would hand
   * the next start the very identity the visitor just chose to abandon.
   */
  async forgetStoredIdentity(): Promise<void> {
    const tx = this.#db.transaction(IDENTITY_STORE, 'readwrite')
    for (const key of [SEALED_SEED_KEY, SEED_KEY, SEALED_PROVIDER_KEY, PROVIDER_KEY, SALT_KEY]) {
      await tx.store.delete(key)
    }
    await tx.done
  }

  async saveCertificate(certificate: NodeCertificate): Promise<void> {
    await this.#db.put(IDENTITY_STORE, certificate, CERTIFICATE_KEY)
  }

  close(): void {
    this.#db.close()
  }

  /**
   * The one transaction both sealed readers run in. See {@link loadOrMintSealedSeed}.
   *
   * **Nothing between the first `tx.store.get` and `tx.done` is awaited except the
   * transaction's own operations**, and that is the invariant an unrelated future edit will
   * break: `sealWithKey` and `mint` are both synchronous, which is what makes the shape
   * available at all.
   */
  async #loadOrMintSealed(
    sealedKey: string,
    legacyKey: string,
    key: Uint8Array,
    params: SealKdfParams,
    salt: Uint8Array,
    mint: () => Uint8Array<ArrayBuffer>,
  ): Promise<SealedSecret> {
    const tx = this.#db.transaction(IDENTITY_STORE, 'readwrite')
    try {
      const existing = parseSealedSecret(await tx.store.get(sealedKey))
      if (existing !== null) {
        await tx.done
        return existing
      }

      const legacy = await tx.store.get(legacyKey)
      if (legacy instanceof Uint8Array) {
        if (legacy.length !== SEED_BYTES) {
          throw new MalformedSeedRecordError(this.#name, legacyKey, legacy.length)
        }
        const migrated = sealWithKey(key, legacy, params, salt)
        await tx.store.put(migrated, sealedKey)
        // In the SAME transaction as the `put` above. A tab that crashed between the two
        // would leave both copies, and criterion 1 would fail on a database nobody touched.
        await tx.store.delete(legacyKey)
        await tx.done
        return migrated
      }

      const sealed = sealWithKey(key, mint(), params, salt)
      await tx.store.put(sealed, sealedKey)
      await tx.done
      return sealed
    } catch (cause: unknown) {
      // A `mint` that refuses throws from inside the transaction — deliberately, so the
      // refusal is decided by the read that would have decided the write. The transaction
      // must then be abandoned explicitly: a `readwrite` transaction whose `done` nobody
      // awaits rejects into an unhandled rejection, which reddens whichever spec the lane
      // happens to be running when it lands.
      try {
        tx.abort()
      } catch {
        // Already finished. There is nothing left to abandon.
      }
      void tx.done.catch(() => {})
      throw cause
    }
  }

  /**
   * A stored record read as bytes, or `undefined` when it is absent or is not bytes.
   *
   * The type guard is not decoration. IndexedDB round-trips a `NodeCertificate` — and now a
   * `SealedSecret` — through the structured clone algorithm, so a key collision would hand
   * a plain object to `identityFromSeed`, and `object.length` is `undefined` — which
   * compares unequal to `SEED_BYTES` and throws `SeedLengthError(undefined)`, a refusal
   * naming the wrong thing. Returning `undefined` makes it the absent case, which is a
   * state the caller already has a decision written down for.
   */
  async #readBytes(key: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const value = await this.#db.get(IDENTITY_STORE, key)
    return value instanceof Uint8Array ? value : undefined
  }
}
