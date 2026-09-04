import { describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import { DEFAULT_KDF_PARAMS, deriveSealKey, openSecret, parseSealedSecret } from '@o2/core'
import type { SealKdfParams } from '@o2/core'
import { SEED_BYTES, generateSeed } from '@o2/libp2p'
import {
  IDENTITY_STORE,
  IdbIdentityStore,
  PROVIDER_KEY,
  SALT_KEY,
  SEALED_PROVIDER_KEY,
  SEALED_SEED_KEY,
  SEED_KEY,
} from './idb-identity-store.ts'
import { forgetVisitorKey, visitorKeyPair } from './visitor-key.ts'

/**
 * **Task #49 — the cold-start mint race, read where it can be read deterministically.**
 *
 * ## The defect, and why an end-to-end reading is the wrong instrument for it
 *
 * `browser-node.ts` used to read `loadSeed()` and, on `null`, mint and write. Nothing
 * spanned the read and the write. IndexedDB is per-origin and tabs of one profile share it,
 * so N tabs opening a cold origin together each read `null`, each mint, and the last write
 * wins — leaving N−1 tabs running as nodes whose seed is not the stored one, each of which
 * comes back on its next start as a *different* node.
 *
 * The window between the `get` and the `put` is one IndexedDB round trip. An end-to-end
 * fixture has to align N real tabs inside that window, and three of any four tabs are
 * backgrounded — where Chromium clamps timers to roughly one-second boundaries, which
 * `demo/main.ts` records in its own words. So a green end-to-end run cannot distinguish
 * *"the race is rare"* from *"the tabs never overlapped"*, and a proof that cannot tell those
 * apart is not one.
 *
 * **Here the overlap is not a matter of timing.** Four calls are issued in one synchronous
 * pass, so all four `get`s are outstanding before any of them resolves. That is the race, by
 * construction rather than by luck, and it is run against **separate connections** — which is
 * what a tab is, from IndexedDB's point of view.
 *
 * ## What the first case is, and what it is not — AMENDED 2026-09-04 for AUTH-06
 *
 * The first case runs the *old composition* — read, mint, write — and reads four distinct
 * seeds. It is a reading of a hazard in the primitives, not a test of shipped code, and it
 * is written that way deliberately: it is the witness that the pair `browser-node.ts` used
 * really does race, and it stays true whatever the caller does next. **The claim about
 * shipped code is the second case**, and that one is guarded by a plant.
 *
 * **It now composes the pair out of raw `idb` calls rather than out of this store's own
 * methods, because those methods no longer exist.** AUTH-06 deleted every writer of a
 * plaintext secret, and keeping one alive so that this case could call it would have made
 * the phase's claim false in order to test it. Constructing the pre-change shape by hand is
 * the same move `idb-identity-at-rest.browser.test.ts`'s positive control makes, and for the
 * same reason: a pre-change *run* is not reproducible after the change.
 *
 * ## Why one transaction is the whole fix
 *
 * IndexedDB serialises `readwrite` transactions with overlapping scope across connections in
 * one origin. That is cross-tab mutual exclusion the browser already provides. The loser's
 * transaction sees the winner's write and returns it, so the loser **adopts** the winner's
 * identity instead of keeping its own — which is why a retry would have been the wrong shape.
 * The point is not that the write eventually lands; it is that exactly one seed can win and
 * everybody else must take it.
 *
 * ## Watched red — twice, because two different mechanisms are claimed here
 *
 * **Plant one**: the atomic function's body replaced with the non-atomic pair — read, then
 * mint, then write. The second and third cases failed in chromium, firefox and webkit alike
 * with, verbatim: *"expected 4 to be 1 // Object.is equality"*. The third case reddening is
 * correct rather than incidental — it asserts on both seeds and the node half is the one the
 * plant touched.
 *
 * **Plant two**: the visitor key's compare-and-set replaced with the bare `put` it used to
 * be. Only the fourth case reddened — *"expected 4 to be 1"* in chromium and webkit,
 * *"expected 2 to be 1"* in firefox — which is the reading that separates the two fixes:
 * they are different code and each case names its own.
 *
 * The firefox number is worth keeping rather than rounding to *"it failed"*. Two distinct
 * keys out of four concurrent callers is the same defect with a different interleaving, and
 * a fixture that had asserted *"exactly four"* would have called that a pass.
 *
 * Both restored by the inverse of their own edit and verified `cmp`-identical against
 * snapshots taken immediately before each plant.
 */

/**
 * A one-shot barrier: every caller waits until `count` of them have arrived.
 *
 * Small enough to write here rather than depend on: the whole point is that the window
 * under test is opened by construction, so the thing that opens it must be readable in the
 * same screen as the case that uses it.
 */
function readBarrier(count: number): () => Promise<void> {
  let arrived = 0
  let release = (): void => {}
  const open = new Promise<void>((resolve) => {
    release = resolve
  })
  return async () => {
    arrived += 1
    if (arrived >= count) release()
    return open
  }
}

/** Concurrent openers. Four gives a last-writer-wins race three losers. */
const RACERS = 4

/**
 * Cheap enough to run three times per engine; still a real Argon2id derivation.
 *
 * Deliberately not {@link DEFAULT_KDF_PARAMS}: this file runs once per engine and derives
 * several keys, and the defaults measured 436 ms each. No case here asserts a duration.
 */
const CHEAP_PARAMS: SealKdfParams = { t: 1, m: 8192, p: 1, dkLen: 32 }

const PASSPHRASE = 'a-store-level-passphrase-2026'

/** A fresh database name per case, so no case reads another's winner. */
function freshName(what: string): string {
  return `o2-race-${what}-${Math.trunc(performance.now() * 1000)}`
}

/** Separate connections, which is what N tabs are from IndexedDB's point of view. */
async function openAll(name: string): Promise<IdbIdentityStore[]> {
  return Promise.all(Array.from({ length: RACERS }, async () => IdbIdentityStore.open(name)))
}

/**
 * A raw connection to the identity database, opened the way this store opens one.
 *
 * Untyped on purpose: the first case's whole subject is a composition this module no longer
 * offers, so it is built out of the primitives rather than out of the module's contract.
 */
async function openRaw(name: string): Promise<IDBPDatabase> {
  return openDB(name, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        database.createObjectStore(IDENTITY_STORE)
      }
    },
  })
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** How many distinct byte strings are in `all`, compared as bytes and never as text. */
function distinctCount(all: readonly Uint8Array[]): number {
  const kept: Uint8Array[] = []
  for (const one of all) {
    if (!kept.some((seen) => sameBytes(seen, one))) kept.push(one)
  }
  return kept.length
}

describe('the cold-start mint race', () => {
  it('races when the read and the write are two operations — the shape that was shipped', async () => {
    const name = freshName('naive')
    const dbs = await Promise.all(Array.from({ length: RACERS }, async () => openRaw(name)))
    try {
      // **The interleaving is CONSTRUCTED, not hoped for — 2026-08-29.** This read *"issued in
      // one synchronous pass: every `loadSeed` is outstanding before any resolves"*, and that
      // was a statement about how the scheduler happened to behave rather than about the code.
      // It held on a quiet machine and lost 2 of 12 full-lane runs inside a Linux container,
      // always in firefox: under contention one racer can complete its save before another
      // reads, the later racer then finds a seed and returns it, and four distinct identities
      // become three. **A test that asserts a race OCCURRED is asserting an accident.**
      //
      // The barrier makes it a fact: nobody writes until everybody has read. That is precisely
      // the window the naive shape leaves open, so the case now demonstrates the defect instead
      // of waiting for the defect to demonstrate itself.
      const everyoneHasRead = readBarrier(RACERS)
      const minted = await Promise.all(
        dbs.map(async (db) => {
          const stored: unknown = await db.get(IDENTITY_STORE, SEED_KEY)
          await everyoneHasRead()
          if (stored instanceof Uint8Array) return stored
          const seed = generateSeed()
          await db.put(IDENTITY_STORE, seed, SEED_KEY)
          return seed
        }),
      )

      // Four openers, four identities — and only one of them is in storage.
      expect(distinctCount(minted)).toBe(RACERS)

      // The consequence that makes it a defect rather than waste: three of these four are
      // running as a node whose seed is not the stored one, and the next start proves it.
      const persisted: unknown = await dbs[0]?.get(IDENTITY_STORE, SEED_KEY)
      expect(persisted).toBeInstanceOf(Uint8Array)
      if (!(persisted instanceof Uint8Array)) throw new Error('unreachable — asserted above')
      const survivors = minted.filter((seed) => sameBytes(seed, persisted))
      expect(survivors.length).toBe(1)
    } finally {
      for (const db of dbs) db.close()
    }
  })

  it('mints exactly once when the read, the seal and the write are one transaction', async () => {
    const name = freshName('atomic')
    const stores = await openAll(name)
    try {
      const salt = await stores[0]!.loadOrCreateSalt()
      const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
      const sealed = await Promise.all(
        stores.map(async (store) =>
          store.loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, generateSeed),
        ),
      )
      const seeds = await Promise.all(
        sealed.map(async (envelope) => openSecret(envelope, PASSPHRASE)),
      )

      // One identity for four concurrent openers — and, the half a retry would not give,
      // every loser holds the WINNER's seed rather than the one it minted.
      expect(distinctCount(seeds)).toBe(1)
      const persisted = await stores[0]!.loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, generateSeed)
      const opened = await openSecret(persisted, PASSPHRASE)
      for (const seed of seeds) expect(sameBytes(seed, opened)).toBe(true)
    } finally {
      for (const store of stores) store.close()
    }
  }, 60_000)

  it('mints the provider signing key exactly once too, and does not confuse it with the node seed', async () => {
    const name = freshName('provider')
    const stores = await openAll(name)
    try {
      const salt = await stores[0]!.loadOrCreateSalt()
      const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
      const [node, provider] = await Promise.all([
        Promise.all(
          stores.map(async (store) =>
            store
              .loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, generateSeed)
              .then(async (envelope) => openSecret(envelope, PASSPHRASE)),
          ),
        ),
        Promise.all(
          stores.map(async (store) =>
            store
              .loadOrMintSealedProviderSeed(key, CHEAP_PARAMS, salt, generateSeed)
              .then(async (envelope) => openSecret(envelope, PASSPHRASE)),
          ),
        ),
      ])
      expect(distinctCount(node)).toBe(1)
      expect(distinctCount(provider)).toBe(1)
      // Two keys under two record keys in one store — a transaction scoped to the object
      // store serialises them, and must not merge them.
      expect(sameBytes(node[0]!, provider[0]!)).toBe(false)
    } finally {
      for (const store of stores) store.close()
    }
  }, 60_000)

  it('gives concurrent openers one salt, so one database has one key', async () => {
    // The salt is created in its own transaction ahead of the seed's, so it races on
    // exactly the same axis and needs the same reading. Two salts for one database would
    // be two keys for one database — and the loser's key would open nothing, presenting as
    // a wrong passphrase on a tab whose passphrase is right.
    const name = freshName('salt')
    const stores = await openAll(name)
    try {
      const salts = await Promise.all(stores.map(async (store) => store.loadOrCreateSalt()))
      expect(distinctCount(salts)).toBe(1)
    } finally {
      for (const store of stores) store.close()
    }
  })

  it('gives one visitor key to concurrent callers, which is one operatorId for one person', async () => {
    // The visitor key cannot use the transaction shape above — `generateSubtleKeyPair()` is
    // async, and awaiting a non-IndexedDB promise commits the transaction — so it mints
    // first and the transaction decides only whose wins. This reads that the decision holds.
    //
    // Why it matters more than a wasted key: `operatorId` is derived from this key and is the
    // unit `composeQuorum` spreads a quorum across. Two keys for one profile would let one
    // person's tabs count as independent operators.
    const name = freshName('visitor')
    try {
      const pairs = await Promise.all(
        Array.from({ length: RACERS }, async () => visitorKeyPair(name)),
      )
      const raw = await Promise.all(
        pairs.map(async (pair) => crypto.subtle.exportKey('raw', pair.publicKey)),
      )
      expect(distinctCount(raw.map((bytes) => new Uint8Array(bytes)))).toBe(1)
    } finally {
      await forgetVisitorKey(name).catch(() => {})
    }
  })
})

describe('the migration, at the store level', () => {
  it('seals the bytes it found and deletes the plaintext in the same transaction', async () => {
    const name = freshName('migrate')
    const legacy = generateSeed()
    const raw = await openRaw(name)
    try {
      await raw.put(IDENTITY_STORE, legacy, SEED_KEY)
    } finally {
      raw.close()
    }

    const store = await IdbIdentityStore.open(name)
    try {
      const salt = await store.loadOrCreateSalt()
      const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
      const envelope = await store.loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, () => {
        throw new Error('the migration minted instead of adopting the record it found')
      })
      // The same bytes. A migration that minted would satisfy every other assertion here.
      expect(sameBytes(await openSecret(envelope, PASSPHRASE), legacy)).toBe(true)
      expect(await store.loadSeed()).toBeNull()
      expect(await store.legacyPlaintextSeed()).toBeNull()
    } finally {
      store.close()
    }
  }, 60_000)

  it('refuses a wrong-length record rather than sealing it and deleting the original', async () => {
    // The unlink is what makes this a refusal rather than a repair: a wrong-length record
    // sealed and then deleted is an identity destroyed, because the envelope opens to bytes
    // `identityFromSeed` will not accept and the original is gone.
    const name = freshName('malformed')
    const raw = await openRaw(name)
    try {
      await raw.put(IDENTITY_STORE, new Uint8Array(SEED_BYTES - 1), SEED_KEY)
    } finally {
      raw.close()
    }

    const store = await IdbIdentityStore.open(name)
    try {
      const salt = await store.loadOrCreateSalt()
      const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
      const thrown = await store
        .loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, generateSeed)
        .then(() => null, (cause: unknown) => cause)
      expect(thrown instanceof Error ? thrown.name : 'nothing was thrown').toBe(
        'MalformedSeedRecordError',
      )
      // And the record it refused is still there, which is the state a person can act on.
      const held = await store.loadSeed()
      expect(held?.length).toBe(SEED_BYTES - 1)
    } finally {
      store.close()
    }
  }, 60_000)

  it('lets a refusing mint decide the absent case without writing anything', async () => {
    // `whenSeedIsGone: 'refuses-to-start-without-its-seed'` is this caller. The refusal is
    // decided inside the transaction that would have written, so it cannot disagree with a
    // separate read taken a moment earlier.
    const name = freshName('refuses')
    const store = await IdbIdentityStore.open(name)
    try {
      const salt = await store.loadOrCreateSalt()
      const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
      const thrown = await store
        .loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, () => {
          throw new Error('there is no seed here and this caller will not create one')
        })
        .then(() => null, (cause: unknown) => cause)
      expect(thrown instanceof Error ? thrown.message : 'nothing was thrown').toContain(
        'will not create one',
      )
    } finally {
      store.close()
    }

    const raw = await openRaw(name)
    try {
      const keys = await raw.getAllKeys(IDENTITY_STORE)
      // The salt is there — it was created before the refusal and is not a secret. The
      // sealed record is not, which is the property this case is about.
      expect(keys).toContain(SALT_KEY)
      expect(keys).not.toContain(SEALED_SEED_KEY)
      expect(keys).not.toContain(SEED_KEY)
    } finally {
      raw.close()
    }
  }, 60_000)
})

describe('what IndexedDB does to a sealed record', () => {
  it('round-trips an envelope through the structured clone with every field intact', async () => {
    // Asserted rather than assumed. A `SealedSecret` is a plain object of numbers and
    // strings **because** a `Uint8Array` field would not survive being handed back as one
    // that `parseSealedSecret` accepts — which is why `@o2/core` writes the three byte
    // fields as base64url. If that ever stopped being true, every start would refuse with
    // a shape error and nothing would say why.
    const name = freshName('clone')
    const store = await IdbIdentityStore.open(name)
    let written: string
    try {
      const salt = await store.loadOrCreateSalt()
      const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
      written = (await store.loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, generateSeed)).ciphertext
    } finally {
      store.close()
    }

    const raw = await openRaw(name)
    try {
      const stored: unknown = await raw.get(IDENTITY_STORE, SEALED_SEED_KEY)
      const parsed = parseSealedSecret(stored)
      expect(parsed).not.toBeNull()
      expect(parsed?.ciphertext).toBe(written)
      expect(parsed?.kdf).toBe('argon2id')
      expect(parsed?.aead).toBe('xchacha20poly1305')
      // And the provider key's slot is untouched by the seed's write.
      expect(await raw.get(IDENTITY_STORE, SEALED_PROVIDER_KEY)).toBeUndefined()
      expect(await raw.get(IDENTITY_STORE, PROVIDER_KEY)).toBeUndefined()
    } finally {
      raw.close()
    }
  }, 60_000)
})
