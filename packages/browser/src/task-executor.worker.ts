/**
 * One task, executed off the main thread.
 *
 * This exists for BROW-04's hardest clause: *one click provably drops CPU to zero*.
 * A WASM `run()` is a synchronous call — once it starts, nothing on that thread can
 * interrupt it. If the executor lives on the main thread, "stop" means "stop
 * accepting new work and wait", which is a different promise from the one the
 * requirement makes. Moving execution into a Worker makes stopping a
 * `Worker.terminate()`: the thread is gone, so the cycles are gone, and the page
 * stays responsive while it happens.
 *
 * ## Why bytes cross the boundary rather than a blockstore
 *
 * The main thread already has IndexedDB and a network fallback wired up. Handing
 * the worker a second blockstore would duplicate that machinery and give a task two
 * possible views of the same CID. Instead the caller resolves both blocks and posts
 * the bytes; the worker puts them into a `MemoryBlockstore`, which is content-
 * addressed, so the CIDs it derives are the same ones the caller asked for. A
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

import { MemoryBlockstore, WasmExecutor, encodeCanonical } from '@o2/core'

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
 * Exported so it can be exercised without a Worker at all — the interesting
 * failures here are ABI-shaped, not thread-shaped, and a test that needs a real
 * Worker to check them is a slower test that proves less.
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

// Worker entry. Guarded so importing this module for its types outside a worker is
// harmless — the same guard `@o2/core`'s task worker uses.
if (typeof self !== 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  self.addEventListener('message', (event: MessageEvent<WorkerTaskRequest>) => {
    void runTask(event.data).then((response) => {
      self.postMessage(response)
    })
  })
}
