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

/**
 * AUTH-01 — an identity file is not a block.
 *
 * The suite above covered the `.tmp-` case only, which is why the collision this phase
 * introduces was invisible: `open`'s filter is not a safety net for leftover temporaries,
 * it **is** the block counter, and every entry it keeps becomes part of `size`. The moment
 * an identity key sat beside the blocks, that key counted as one.
 */
describe('AUTH-01 — FsBlockstore.size counts blocks and only blocks', () => {
  /**
   * The count is the instrument, so it is shown moving in the same test that shows it
   * holding. A `3` that never becomes a `4` would pass equally well against a counter
   * wired to a constant.
   *
   * Reddened by reverting `fs-blockstore.ts`'s filter to `!name.startsWith('.tmp-')`.
   */
  it('does not count the identity, provider or certificate files as blocks', async () => {
    const { writeFile, readdir } = await import('node:fs/promises')
    const { IDENTITY_FILE, PROVIDER_FILE, loadOrCreateSeed } = await import('./identity-store.ts')

    const dir = join(workdir, 'blocks')
    const store = await FsBlockstore.open(dir)
    for (const vector of BLOCK_VECTORS.slice(0, 3)) await store.put(vector.bytes)
    expect(store.size).toBe(3)

    // Everything this phase writes into a blockstore directory.
    await loadOrCreateSeed(dir, IDENTITY_FILE)
    await loadOrCreateSeed(dir, PROVIDER_FILE)
    await writeFile(join(dir, '.certificate.json'), '{}')

    // An assertion that the filter did NOT count something is only meaningful next to
    // proof the something is there — otherwise a test that deleted the file would pass.
    const entries = await readdir(dir)
    expect(entries).toContain(IDENTITY_FILE)
    expect(entries).toContain(PROVIDER_FILE)
    expect(entries).toContain('.certificate.json')

    const reopened = await FsBlockstore.open(dir)
    expect(reopened.size).toBe(3)

    // And the count is a count: put a fourth block and it moves.
    await reopened.put(BLOCK_VECTORS[3]!.bytes)
    expect((await FsBlockstore.open(dir)).size).toBe(4)
  })

  /**
   * The widening must not start excluding real blocks. A block file name is
   * `cid.toString()` — base32-lowercase, which never begins with a dot — so the widened
   * predicate excludes exactly the non-block entries. Asserted rather than reasoned about.
   */
  it('counts every real block, whose name never begins with a dot', async () => {
    const dir = join(workdir, 'blocks')
    const store = await FsBlockstore.open(dir)
    for (const vector of BLOCK_VECTORS) {
      const cid = await store.put(vector.bytes)
      expect(cid.toString().startsWith('.')).toBe(false)
    }
    expect((await FsBlockstore.open(dir)).size).toBe(BLOCK_VECTORS.length)
  })

  it('keeps a block retrievable across the reopen the count is read from', async () => {
    const { IDENTITY_FILE, loadOrCreateSeed } = await import('./identity-store.ts')

    const dir = join(workdir, 'blocks')
    const store = await FsBlockstore.open(dir)
    const cid = await store.put(BLOCK_VECTORS[0]!.bytes)
    await loadOrCreateSeed(dir, IDENTITY_FILE)

    const reopened = await FsBlockstore.open(dir)
    expect(await reopened.get(cid)).toEqual(BLOCK_VECTORS[0]!.bytes)
    expect(reopened.size).toBe(1)
  })
})
