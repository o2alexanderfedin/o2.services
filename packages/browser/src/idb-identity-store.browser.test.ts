import { describe, expect, it } from 'vitest'
import { generateSeed } from '@o2/libp2p'
import { IdbIdentityStore } from './idb-identity-store.ts'
import { forgetVisitorKey, visitorKeyPair } from './visitor-key.ts'

/**
 * **Task #49 — the cold-start mint race, read where it can be read deterministically.**
 *
 * ## The defect, and why an end-to-end reading is the wrong instrument for it
 *
 * `browser-node.ts` used to read `loadSeed()` and, on `null`, call `generateSeed()` and
 * `saveSeed()`. Nothing spanned the read and the write. IndexedDB is per-origin and tabs of
 * one profile share it, so N tabs opening a cold origin together each read `null`, each
 * mint, and the last write wins — leaving N−1 tabs running as nodes whose seed is not the
 * stored one, each of which comes back on its next start as a *different* node.
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
 * ## What the first case is, and what it is not
 *
 * The first case runs the *old composition* — `loadSeed`, mint, `saveSeed` — through the two
 * public methods the old code called, and reads four distinct seeds. It is a reading of a
 * hazard in the primitives, not a test of shipped code, and it is written that way
 * deliberately: it is the witness that the pair `browser-node.ts` used really does race, and
 * it stays true whatever the caller does next. **The claim about shipped code is the second
 * case**, and that one is guarded by a plant.
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
 * **Plant one**: `loadOrMintSeed`'s body replaced with the non-atomic pair — `loadSeed()`,
 * then `mint()`, then `saveSeed()`. The second and third cases failed in chromium, firefox
 * and webkit alike with, verbatim: *"expected 4 to be 1 // Object.is equality"*. The third
 * case reddening is correct rather than incidental — it asserts on both seeds and the node
 * half is the one the plant touched.
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

/** Concurrent openers. Four gives a last-writer-wins race three losers. */
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

const RACERS = 4

/** A fresh database name per case, so no case reads another's winner. */
function freshName(what: string): string {
  return `o2-race-${what}-${String(Math.trunc(performance.now() * 1000))}`
}

/** Separate connections, which is what N tabs are from IndexedDB's point of view. */
async function openAll(name: string): Promise<IdbIdentityStore[]> {
  return Promise.all(Array.from({ length: RACERS }, async () => IdbIdentityStore.open(name)))
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('the cold-start mint race', () => {
  it('races when the read and the write are two operations — the shape that was shipped', async () => {
    const name = freshName('naive')
    const stores = await openAll(name)
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
        stores.map(async (store) => {
          const stored = await store.loadSeed()
          await everyoneHasRead()
          if (stored !== null) return stored
          const seed = generateSeed()
          await store.saveSeed(seed)
          return seed
        }),
      )

      // Four openers, four identities — and only one of them is in storage.
      expect(new Set(minted.map(hex)).size).toBe(RACERS)

      // The consequence that makes it a defect rather than waste: three of these four are
      // running as a node whose seed is not the stored one, and the next start proves it.
      const persisted = await stores[0]!.loadSeed()
      expect(persisted).not.toBeNull()
      const survivors = minted.filter((seed) => hex(seed) === hex(persisted as Uint8Array))
      expect(survivors.length).toBe(1)
    } finally {
      for (const store of stores) store.close()
    }
  })

  it('mints exactly once when the read and the write are one transaction', async () => {
    const name = freshName('atomic')
    const stores = await openAll(name)
    try {
      const seeds = await Promise.all(
        stores.map(async (store) => store.loadOrMintSeed(generateSeed)),
      )

      // One identity for four concurrent openers — and, the half a retry would not give,
      // every loser holds the WINNER's seed rather than the one it minted.
      expect(new Set(seeds.map(hex)).size).toBe(1)
      const persisted = await stores[0]!.loadSeed()
      expect(persisted).not.toBeNull()
      for (const seed of seeds) expect(hex(seed)).toBe(hex(persisted as Uint8Array))
    } finally {
      for (const store of stores) store.close()
    }
  })

  it('mints the provider signing key exactly once too, and does not confuse it with the node seed', async () => {
    const name = freshName('provider')
    const stores = await openAll(name)
    try {
      const [node, provider] = await Promise.all([
        Promise.all(stores.map(async (store) => store.loadOrMintSeed(generateSeed))),
        Promise.all(stores.map(async (store) => store.loadOrMintProviderSeed(generateSeed))),
      ])
      expect(new Set(node.map(hex)).size).toBe(1)
      expect(new Set(provider.map(hex)).size).toBe(1)
      // Two keys under two record keys in one store — a transaction scoped to the object
      // store serialises them, and must not merge them.
      expect(hex(node[0] as Uint8Array)).not.toBe(hex(provider[0] as Uint8Array))
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
      expect(new Set(raw.map((bytes) => hex(new Uint8Array(bytes)))).size).toBe(1)
    } finally {
      await forgetVisitorKey(name).catch(() => {})
    }
  })
})
