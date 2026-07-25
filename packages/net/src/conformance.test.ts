import { MemoryBlockstore } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { BLOCK_VECTORS, CONFORMANCE_BLOCK_COUNT, blockCid, checkBlockstoreConformance } from './index.ts'

/**
 * The in-memory adapter against the shared contract.
 *
 * Runs in Node *and* Chromium, so the reference implementation is confirmed
 * identical on both before either platform-specific adapter is trusted.
 */
describe('DATA-02 — MemoryBlockstore conformance', () => {
  it('satisfies the blockstore contract', async () => {
    const report = await checkBlockstoreConformance(new MemoryBlockstore())
    expect(report.failures).toEqual([])
    expect(report.finalSize).toBe(CONFORMANCE_BLOCK_COUNT)
  })
})

describe('DATA-02 — the addressing vectors themselves', () => {
  it('agrees with blockCid on this platform', async () => {
    // Guards against the vectors and the hashing helper drifting apart: if this
    // fails while the adapter tests pass, the vectors are stale rather than the
    // adapters being wrong.
    for (const vector of BLOCK_VECTORS) {
      expect((await blockCid(vector.bytes)).toString()).toBe(vector.cid)
    }
  })

  it('covers the edge cases that break storage backends', () => {
    const labels = BLOCK_VECTORS.map((v) => v.label)
    // Zero-length values are treated as absent by several backends, and large
    // values are where a browser backend stops behaving like a Map.
    expect(labels).toContain('empty')
    expect(labels).toContain('large-64k')
    expect(BLOCK_VECTORS.find((v) => v.label === 'empty')?.bytes.byteLength).toBe(0)
    expect(BLOCK_VECTORS.find((v) => v.label === 'large-64k')?.bytes.byteLength).toBe(65_536)
  })
})
