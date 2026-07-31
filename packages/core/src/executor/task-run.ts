/**
 * One task, executed on whatever thread this module was loaded into.
 *
 * This is the cross-thread ABI, and it lives in the kernel because both tiers speak
 * it: a DOM `Worker` in a browser tab and a `node:worker_threads` `Worker` on a
 * server run the identical function over the identical message shapes. Writing it
 * twice would be writing the *sandbox boundary* twice, which is the one seam where
 * two implementations drifting apart is a correctness problem rather than an
 * inconvenience.
 *
 * Deliberately platform-free — no `self`, no `node:*`. The thread entry points that
 * wrap it are two files, one per tier, and each is a handful of lines.
 *
 * ## Why bytes cross the boundary rather than a blockstore
 *
 * The calling thread already has storage and a network fallback wired up. Handing
 * the executing thread a second blockstore would duplicate that machinery and give a
 * task two possible views of the same CID. Instead the caller resolves both blocks
 * and posts the bytes; this side puts them into a `MemoryBlockstore`, which is
 * content-addressed, so the CIDs it derives are the same ones the caller asked for. A
 * mismatch is impossible rather than merely unlikely.
 *
 * ## Why the output travels as bytes
 *
 * `structuredClone` turns class instances into plain objects. A `CID` inside a task
 * output would arrive stripped of its methods and stop comparing equal, which
 * verification would then report as a disagreement between two nodes that in fact
 * agreed. Re-encoding to canonical bytes and decoding on the other side is exact by
 * construction — and canonical encoding is what verification compares anyway.
 */

import { encodeCanonical } from '../canonical/encode.ts'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { WasmExecutor } from './wasm.ts'

export interface WorkerTaskRequest {
  readonly id: number
  readonly moduleBytes: Uint8Array<ArrayBuffer>
  readonly inputBytes: Uint8Array<ArrayBuffer>
  readonly partitionIndex: number
  readonly partitionCount: number
  readonly maxOutputBytes?: number
}

export type WorkerTaskResponse =
  | {
      readonly id: number
      readonly ok: true
      readonly outputBytes: Uint8Array<ArrayBuffer>
      readonly fuelUsed: number
    }
  | { readonly id: number; readonly ok: false; readonly reason: string }

/**
 * Run one task in this thread's own blockstore.
 *
 * Exported so it can be exercised without a thread at all — the interesting failures
 * here are ABI-shaped, not thread-shaped, and a test that needs a real thread to
 * check them is a slower test that proves less.
 */
export async function runTask(request: WorkerTaskRequest): Promise<WorkerTaskResponse> {
  try {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(request.moduleBytes)
    const inputCid = await store.put(request.inputBytes)
    const executor = new WasmExecutor({
      nodeId: 'worker',
      blockstore: store,
      ...(request.maxOutputBytes === undefined ? {} : { maxOutputBytes: request.maxOutputBytes }),
    })

    const outcome = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: request.partitionIndex,
      partitionCount: request.partitionCount,
    })
    if (!outcome.ok) return { id: request.id, ok: false, reason: outcome.reason }

    const encoded = encodeCanonical(outcome.output)
    if (!encoded.ok) {
      // The executor already decoded these bytes from the guest, so a failure here
      // means the canonical codec disagrees with itself — worth surfacing loudly
      // rather than papering over.
      return {
        id: request.id,
        ok: false,
        reason: `output could not be re-encoded: ${JSON.stringify(encoded.error)}`,
      }
    }
    return { id: request.id, ok: true, outputBytes: encoded.bytes, fuelUsed: outcome.fuelUsed }
  } catch (cause) {
    return {
      id: request.id,
      ok: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
