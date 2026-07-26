/**
 * Filesystem blockstore — the persistent `Blockstore` adapter.
 *
 * One file per block, named by its CID. Since a CID string is base32-lowercase it
 * needs no escaping, and since the content is addressed by its hash the file name
 * *is* the integrity check: a block cannot be silently replaced with different
 * content and keep its name.
 *
 * Writes go to a temporary name and are then renamed. `rename` within a directory
 * is atomic on POSIX, so a process killed mid-write leaves no half-written block —
 * which matters because the restart path reads whatever is on disk and trusts the
 * name.
 *
 * `size` is synchronous in the port, so it is a counter seeded by scanning the
 * directory in `open()`. That is also what makes the count correct across a
 * restart rather than starting at zero with a full directory.
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from '@o2/core'
import type { Blockstore } from '@o2/core'

export class FsBlockstore implements Blockstore {
  readonly #dir: string
  #count: number
  #tmpSeq = 0

  private constructor(dir: string, count: number) {
    this.#dir = dir
    this.#count = count
  }

  /**
   * Open (creating if absent) a blockstore directory.
   *
   * Async because the block count has to be established from what is already
   * there — that is precisely the restart case.
   */
  static async open(dir: string): Promise<FsBlockstore> {
    await mkdir(dir, { recursive: true })
    const entries = await readdir(dir)
    const blocks = entries.filter((name) => !name.startsWith('.tmp-'))
    return new FsBlockstore(dir, blocks.length)
  }

  /** Absolute path of the directory backing this store. */
  get directory(): string {
    return this.#dir
  }

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    // Same CID scheme as MemoryBlockstore, deliberately — a block written here
    // must be retrievable by the CID the kernel computed for it.
    const digest = await sha256.digest(bytes)
    const cid = CID.create(1, dagCbor.code, digest)
    const target = this.#pathFor(cid)

    // Content-addressed, so an existing block is byte-identical and re-writing it
    // would be pure cost.
    if (await this.has(cid)) return cid

    const tmp = join(this.#dir, `.tmp-${process.pid}-${this.#tmpSeq++}`)
    await writeFile(tmp, bytes)
    await rename(tmp, target)
    this.#count += 1
    return cid
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    try {
      const buffer = await readFile(this.#pathFor(cid))
      // Copy out of Node's Buffer pool: a Buffer is a view into a shared slab, so
      // handing it out would expose unrelated bytes and alias memory the caller
      // does not own.
      const bytes = new Uint8Array(buffer.byteLength)
      bytes.set(buffer)
      return bytes
    } catch (cause) {
      if (isNotFound(cause)) return undefined
      throw cause
    }
  }

  async has(cid: CID): Promise<boolean> {
    try {
      await readFile(this.#pathFor(cid), { flag: 'r' })
      return true
    } catch (cause) {
      if (isNotFound(cause)) return false
      throw cause
    }
  }

  get size(): number {
    return this.#count
  }

  #pathFor(cid: CID): string {
    return join(this.#dir, cid.toString())
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === 'ENOENT'
}
