/**
 * The kernel running inside a Worker — the third DET-07 target.
 *
 * This is the shape the browser tier actually needs: tasks execute off the main
 * thread so a visitor's page stays responsive while their node contributes. The
 * file imports the kernel and nothing else, which is only possible because
 * `@o2/core` has no platform imports — no DOM, no `node:*`, no libp2p.
 *
 * Message in:  { moduleBytes, shardCount, redundancy }
 * Message out: { ok, complete, partitions } | { ok: false, error }
 */

import { MemoryBlockstore } from '../blockstore/memory.ts'
import { submitJob } from '../job/submit.ts'
import { WasmExecutor } from './wasm.ts'

export interface WorkerRequest {
  readonly moduleBytes: Uint8Array<ArrayBuffer>
  readonly shardCount: number
  readonly redundancy: number
}

export type WorkerResponse =
  | { readonly ok: true; readonly complete: boolean; readonly partitions: readonly number[] }
  | { readonly ok: false; readonly error: string }

/** Read the 4-byte little-endian partition index the test fixture emits. */
function partitionOf(output: unknown): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

export async function runJobInWorker(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(request.moduleBytes)
    const executors = Array.from(
      { length: Math.max(request.redundancy, 2) },
      (_, i) => new WasmExecutor({ nodeId: `w${i}`, blockstore: store }),
    )
    const result = await submitJob(
      {
        moduleCid,
        shards: Array.from({ length: request.shardCount }, (_, i) => ({ a: i })),
        executors,
        redundancy: request.redundancy,
      },
      store,
    )
    if (!result.ok) return { ok: false, error: JSON.stringify(result.error) }
    return {
      ok: true,
      complete: result.job.complete,
      partitions: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1,
      ),
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

// Worker entry. Guarded so importing this module for its types in a non-worker
// context is harmless.
if (typeof self !== 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    void runJobInWorker(event.data).then((response) => {
      self.postMessage(response)
    })
  })
}
