import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BLOCK_VECTORS, CONFORMANCE_BLOCK_COUNT, checkBlockstoreConformance } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * DATA-02, Node side.
 *
 * The same conformance checks `IdbBlockstore` runs in Chromium, against the same
 * hardcoded CID vectors. Both passing is the demonstration that one blockstore
 * interface spans both platforms with identical addressing.
 */

let workdir: string

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-fs-'))
})

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true })
})

describe('DATA-02 — FsBlockstore conformance', () => {
  it('satisfies the same blockstore contract as the browser adapter', async () => {
    const store = await FsBlockstore.open(join(workdir, 'blocks'))
    const report = await checkBlockstoreConformance(store)
    expect(report.failures).toEqual([])
    expect(report.finalSize).toBe(CONFORMANCE_BLOCK_COUNT)
  })
})

describe('DATA-02 — persistence across a reopen', () => {
  it('keeps blocks retrievable by CID, and the count correct, after reopening', async () => {
    const dir = join(workdir, 'blocks')
    const first = await FsBlockstore.open(dir)
    const written = []
    for (const vector of BLOCK_VECTORS) {
      written.push({ cid: await first.put(vector.bytes), vector })
    }
    expect(first.size).toBe(BLOCK_VECTORS.length)

    // A new store object over the same directory. The count must come from disk,
    // not start at zero — that is why `open` is async.
    const reopened = await FsBlockstore.open(dir)
    expect(reopened.size).toBe(BLOCK_VECTORS.length)
    for (const { cid, vector } of written) {
      expect(await reopened.has(cid)).toBe(true)
      expect(await reopened.get(cid)).toEqual(vector.bytes)
    }
  })

  it('does not count temporary files left by an interrupted write', async () => {
    const dir = join(workdir, 'blocks')
    const store = await FsBlockstore.open(dir)
    await store.put(BLOCK_VECTORS[0]!.bytes)

    // Simulate a process killed mid-write. `put` writes to a `.tmp-` name and then
    // renames, so a crash leaves a stray temp file and never a half-written block.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, '.tmp-99999-0'), new Uint8Array([1, 2, 3]))

    const reopened = await FsBlockstore.open(dir)
    expect(reopened.size).toBe(1)
  })
})
