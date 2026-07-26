/**
 * In-memory blockstore — the loopback adapter for DATA-01.
 *
 * Phase 3 swaps a filesystem adapter and Phase 4 an IndexedDB one behind this
 * same interface, without the kernel changing. Keeping the port this narrow is
 * what makes that swap a one-file change.
 */

import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from '../hash.ts'
import type { Blockstore } from '../ports.ts'

function copyOf(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export class MemoryBlockstore implements Blockstore {
  readonly #blocks = new Map<string, Uint8Array<ArrayBuffer>>()

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    const digest = await sha256.digest(bytes)
    const cid = CID.create(1, dagCbor.code, digest)
    // Content-addressed: re-putting identical bytes is a no-op, which is what
    // makes intermediate dedup free.
    //
    // Stored as a copy, and handed back as a copy in `get`. A persistent adapter
    // cannot alias — the filesystem one snapshots on write and copies out of
    // Node's Buffer pool on read, and IndexedDB structured-clones both ways. An
    // in-memory Map would otherwise let a caller mutate a block after storing it,
    // or mutate a retrieved block and corrupt the store, so code that is correct
    // against a real backend would break here. Same reasoning as `MemoryNetwork`
    // copying per recipient: the loopback adapter must not be more permissive than
    // what it stands in for.
    this.#blocks.set(cid.toString(), copyOf(bytes))
    return cid
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const stored = this.#blocks.get(cid.toString())
    return stored === undefined ? undefined : copyOf(stored)
  }

  async has(cid: CID): Promise<boolean> {
    return this.#blocks.has(cid.toString())
  }

  get size(): number {
    return this.#blocks.size
  }
}
