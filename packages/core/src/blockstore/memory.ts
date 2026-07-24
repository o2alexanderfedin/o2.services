/**
 * In-memory blockstore — the loopback adapter for DATA-01.
 *
 * Phase 3 swaps a filesystem adapter and Phase 4 an IndexedDB one behind this
 * same interface, without the kernel changing. Keeping the port this narrow is
 * what makes that swap a one-file change.
 */

import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import type { Blockstore } from '../ports.ts'

export class MemoryBlockstore implements Blockstore {
  readonly #blocks = new Map<string, Uint8Array<ArrayBuffer>>()

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    const digest = await sha256.digest(bytes)
    const cid = CID.create(1, dagCbor.code, digest)
    // Content-addressed: re-putting identical bytes is a no-op, which is what
    // makes intermediate dedup free.
    this.#blocks.set(cid.toString(), bytes)
    return cid
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return this.#blocks.get(cid.toString())
  }

  async has(cid: CID): Promise<boolean> {
    return this.#blocks.has(cid.toString())
  }

  get size(): number {
    return this.#blocks.size
  }
}
