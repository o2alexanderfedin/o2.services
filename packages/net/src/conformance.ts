/**
 * Blockstore conformance — DATA-02's actual content.
 *
 * The requirement is that a block written by a browser and a block written by a
 * Node process are *the same block, addressed the same way*. That claim is only
 * worth something if every implementation is held to one set of checks, so the
 * checks live here — portable, dependency-free, and run by the tests of all three
 * adapters (`MemoryBlockstore`, `FsBlockstore`, `IdbBlockstore`).
 *
 * The CID vectors are hardcoded rather than computed at test time on purpose. A
 * computed expectation only proves an implementation agrees with itself; a literal
 * one pins the wire format, so a codec or multihash change that silently alters
 * addressing fails instead of quietly re-deriving new "correct" answers on both
 * sides.
 *
 * Deliberately no vitest import: this returns a report and lets each package's own
 * test file do the asserting, so a test framework never becomes a runtime
 * dependency of a portable package.
 */

import type { Blockstore } from '@o2/core'
import { blockCid } from './block.ts'

export interface BlockVector {
  readonly label: string
  readonly bytes: Uint8Array<ArrayBuffer>
  /** The CID every conforming implementation must produce for these bytes. */
  readonly cid: string
}

function ramp(length: number, step: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = (i * step) & 0xff
  return bytes
}

/**
 * Cross-implementation addressing vectors.
 *
 * Includes an empty block (a real edge case — several storage backends treat
 * zero-length values as absent) and a 64 KiB one, which is past the point where a
 * browser backend starts behaving differently from an in-memory map.
 */
export const BLOCK_VECTORS: readonly BlockVector[] = [
  {
    label: 'empty',
    bytes: new Uint8Array(0),
    cid: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
  },
  {
    label: 'single-zero',
    bytes: new Uint8Array([0]),
    cid: 'bafyreidogqfzz75tpkmjzjke425xqcrmpcib2p5tg44hnbirumdbpl5adu',
  },
  {
    label: 'dag-cbor-empty-array',
    bytes: new Uint8Array([0x80]),
    cid: 'bafyreidwx2fvfdiaox32v2mnn6sxu3j4qoxeqcuenhtgrv5qv6litfnmoe',
  },
  {
    label: 'ascii-o2',
    bytes: new TextEncoder().encode('o2.services') as Uint8Array<ArrayBuffer>,
    cid: 'bafyreid5z6pvexeefnjwmln2ko2uhfajbojyt5zfujepbwd3oaqftqb354',
  },
  {
    label: 'ramp-256',
    bytes: ramp(256, 1),
    cid: 'bafyreicav7zotuwysixepl6umshgsz2jofmhqx55dwuhbzyrajtl7fciqa',
  },
  {
    label: 'large-64k',
    bytes: ramp(65_536, 31),
    cid: 'bafyreicy6qkmlb6vtg3puftybf5hiwoom2og4d7istmbx2oh5uuhtpllzm',
  },
]

/**
 * Blocks a conforming store holds after a full run: every vector, plus the one
 * extra block the aliasing probe writes.
 */
export const CONFORMANCE_BLOCK_COUNT: number = BLOCK_VECTORS.length + 1

export interface ConformanceReport {
  /** Human-readable description of each violation. Empty means conforming. */
  readonly failures: readonly string[]
  /** Blocks the store held when the run finished — `CONFORMANCE_BLOCK_COUNT`. */
  readonly finalSize: number
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Run every `Blockstore` contract check against one implementation.
 *
 * The store should be empty on entry; `finalSize` is reported rather than asserted
 * so a caller can distinguish "wrong count" from "did not store".
 */
export async function checkBlockstoreConformance(store: Blockstore): Promise<ConformanceReport> {
  const failures: string[] = []
  const note = (message: string): void => {
    failures.push(message)
  }

  if (store.size !== 0) note(`expected an empty store, found size ${store.size}`)

  // An absent block must be reported as absent, never thrown. FetchingBlockstore
  // depends on this to decide when to ask a peer.
  const absent = await blockCid(ramp(17, 7))
  if (await store.has(absent)) note('reported an unwritten block as present')
  if ((await store.get(absent)) !== undefined) note('returned bytes for an unwritten block')

  for (const vector of BLOCK_VECTORS) {
    const cid = await store.put(vector.bytes)

    if (cid.toString() !== vector.cid) {
      note(`${vector.label}: addressed as ${cid.toString()}, expected ${vector.cid}`)
    }
    if (!(await store.has(cid))) note(`${vector.label}: not present after put`)

    const read = await store.get(cid)
    if (read === undefined) {
      note(`${vector.label}: absent after put`)
    } else if (!equalBytes(read, vector.bytes)) {
      note(`${vector.label}: read back ${read.byteLength} bytes, wrote ${vector.bytes.byteLength}`)
    }

    // Content addressing means a re-put is a no-op returning the same CID.
    const sizeBefore = store.size
    const again = await store.put(vector.bytes)
    if (!again.equals(cid)) note(`${vector.label}: re-put produced a different CID`)
    if (store.size !== sizeBefore) {
      note(`${vector.label}: re-put changed size ${sizeBefore} -> ${store.size}, expected dedup`)
    }
  }

  if (store.size !== BLOCK_VECTORS.length) {
    note(`expected ${BLOCK_VECTORS.length} blocks, found ${store.size}`)
  }

  // A returned buffer must not alias the store's own copy: mutating what `get`
  // hands back must not corrupt what is stored, and must not corrupt what the
  // caller passed to `put`.
  //
  // Uses bytes owned by this function, never a shared vector — an aliasing store
  // would otherwise let this check corrupt module-level state and break unrelated
  // tests. The expectation is an independent snapshot taken before the mutation,
  // because comparing a store's output against its own aliased input compares an
  // object with itself and can never fail.
  const probe = ramp(32, 11)
  const expected = ramp(32, 11)
  const probeCid = await store.put(probe)

  const handedOut = await store.get(probeCid)
  if (handedOut === undefined) {
    note('aliasing probe: absent immediately after put')
  } else {
    handedOut[0] = (handedOut[0]! ^ 0xff) & 0xff
    const reread = await store.get(probeCid)
    if (reread === undefined || !equalBytes(reread, expected)) {
      note('mutating the buffer from get() corrupted the stored block — get must not alias storage')
    }
    if (!equalBytes(probe, expected)) {
      note('mutating the buffer from get() corrupted the caller’s input — put must not alias its argument')
    }
  }

  return { failures, finalSize: store.size }
}
