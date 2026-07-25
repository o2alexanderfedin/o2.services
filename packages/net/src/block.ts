/**
 * Block exchange — the "code moves to data" half of the fabric.
 *
 * A task is addressed entirely by CID, so a node that has never seen a module or
 * an input can execute one anyway: it asks a peer for the blocks. That is what
 * makes dispatch cheap and re-dispatch free, and it is why the executor never
 * receives a payload.
 *
 * Two properties this module is responsible for:
 *
 * 1. **A fetched block is verified against the CID that was asked for.** Content
 *    addressing is only a security property if it is actually checked; without
 *    this, any peer could answer a module request with arbitrary code and the
 *    node would run it.
 * 2. **Concurrent requests for the same CID collapse into one fetch.** Every
 *    shard of a job needs the same module block, and they run concurrently — so
 *    the naive version pulls the module once per shard per replica.
 *
 * Pure module.
 */

import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import type { Blockstore } from '@o2/core'

/**
 * The CID a block gets from its bytes.
 *
 * Matches `MemoryBlockstore` exactly, including its use of the dag-cbor codec for
 * every block regardless of content. Mirroring rather than "correcting" it is
 * deliberate: a fetched block must hash to the same CID the kernel computed, and
 * the kernel is not being modified in this phase. Distinguishing raw from
 * dag-cbor blocks belongs with artifact signing.
 */
export async function blockCid(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
  const digest = await sha256.digest(bytes)
  return CID.create(1, dagCbor.code, digest)
}

/** Somewhere blocks can be pulled from when they are not held locally. */
export interface BlockSource {
  /** Resolve to `undefined` when no peer has the block. */
  fetch(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined>
}

/**
 * A blockstore that falls back to the network on a local miss.
 *
 * Decorator over any `Blockstore`, so it composes with the in-memory one in tests
 * and the filesystem one in a real node.
 */
export class FetchingBlockstore implements Blockstore {
  readonly #local: Blockstore
  readonly #source: BlockSource
  readonly #inFlight = new Map<string, Promise<Uint8Array<ArrayBuffer> | undefined>>()
  #fetched = 0
  #rejected = 0

  constructor(local: Blockstore, source: BlockSource) {
    this.#local = local
    this.#source = source
  }

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    return this.#local.put(bytes)
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const local = await this.#local.get(cid)
    if (local !== undefined) return local

    const key = cid.toString()
    const existing = this.#inFlight.get(key)
    if (existing !== undefined) return existing

    const attempt = this.#fetchAndVerify(cid).finally(() => {
      this.#inFlight.delete(key)
    })
    this.#inFlight.set(key, attempt)
    return attempt
  }

  /**
   * Local presence only — deliberately does not go to the network.
   *
   * `has` exists so callers can make cheap decisions; a version that dialled
   * peers would turn an availability check into a network round trip.
   */
  async has(cid: CID): Promise<boolean> {
    return this.#local.has(cid)
  }

  get size(): number {
    return this.#local.size
  }

  /** Blocks successfully pulled over the wire. An assertion target for tests. */
  get fetched(): number {
    return this.#fetched
  }

  /** Fetched blocks whose bytes did not hash to the requested CID. */
  get rejected(): number {
    return this.#rejected
  }

  async #fetchAndVerify(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const bytes = await this.#source.fetch(cid)
    if (bytes === undefined) return undefined

    const actual = await blockCid(bytes)
    if (!actual.equals(cid)) {
      // The peer answered with something other than what was asked for. Treat the
      // block as absent — never store it, never return it.
      this.#rejected += 1
      return undefined
    }

    await this.#local.put(bytes)
    this.#fetched += 1
    return bytes
  }
}
