import { deleteDB } from 'idb'
import { BLOCK_VECTORS, CONFORMANCE_BLOCK_COUNT, checkBlockstoreConformance } from '@o2/net'
import { afterEach, describe, expect, it } from 'vitest'
import { IdbBlockstore } from './idb-blockstore.ts'

/**
 * DATA-02, browser side.
 *
 * The same conformance checks the filesystem and in-memory adapters run. Passing
 * both is what makes "the same CIDs on both sides" a demonstrated property rather
 * than a design intention — the CID vectors are literals shared by all three, so
 * agreement cannot be an artefact of each side computing its own expectation.
 */

let dbNames: string[] = []
let seq = 0

async function freshStore(): Promise<IdbBlockstore> {
  // A unique database per test: IndexedDB is origin-scoped and persists between
  // tests in the same page, so a shared name would leak state across cases.
  const name = `o2-test-${seq++}-${BLOCK_VECTORS.length}`
  dbNames.push(name)
  return IdbBlockstore.open(name)
}

afterEach(async () => {
  const names = dbNames
  dbNames = []
  for (const name of names) await deleteDB(name).catch(() => {})
})

describe('DATA-02 — IdbBlockstore conformance', () => {
  it('satisfies the same blockstore contract as the Node adapter', async () => {
    const store = await freshStore()
    try {
      const report = await checkBlockstoreConformance(store)
      expect(report.failures).toEqual([])
      expect(report.finalSize).toBe(CONFORMANCE_BLOCK_COUNT)
    } finally {
      store.close()
    }
  }, 30_000)
})

describe('DATA-02 — persistence across a reopen', () => {
  it('keeps blocks retrievable by CID after the store is closed and reopened', async () => {
    const name = `o2-reopen-${seq++}`
    dbNames.push(name)

    const first = await IdbBlockstore.open(name)
    const written = []
    for (const vector of BLOCK_VECTORS) {
      written.push({ cid: await first.put(vector.bytes), vector })
    }
    expect(first.size).toBe(BLOCK_VECTORS.length)
    first.close()

    // A genuinely new store object — the equivalent of the visitor closing the tab
    // and coming back.
    const reopened = await IdbBlockstore.open(name)
    try {
      expect(reopened.size).toBe(BLOCK_VECTORS.length)
      for (const { cid, vector } of written) {
        expect(await reopened.has(cid)).toBe(true)
        const bytes = await reopened.get(cid)
        expect(bytes).toBeDefined()
        expect([...(bytes ?? [])]).toEqual([...vector.bytes])
      }
    } finally {
      reopened.close()
    }
  }, 30_000)

  it('reports a size of zero for a database that has never been written', async () => {
    const store = await freshStore()
    try {
      expect(store.size).toBe(0)
      expect(await store.refresh()).toBe(0)
    } finally {
      store.close()
    }
  }, 30_000)
})
