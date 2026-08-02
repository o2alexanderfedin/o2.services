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
import { publicNodes } from '../sovereignty.ts'
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
        shards: Array.from({ length: request.shardCount }, (_, i) => ({
          value: { a: i },
          label: 'public' as const,
        })),
        executors,
        nodes: publicNodes(executors),
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

/**
 * Run one job and hand the answer to `post`, reporting a failed post as a result.
 *
 * The same shape as `runTaskAndPost` in `task-run.ts`, over this module's own
 * response type, and for the same reason: `runJobInWorker` never rejects, so the
 * only rejection the entry below could produce was `post` itself throwing on a
 * response the structured-clone algorithm will not take. Unhandled, that turned a
 * `DataCloneError` into a worker the caller waits out and concludes is gone.
 *
 * The substitute is the `ok: false` arm, holding one string — so whatever the first
 * response carried that could not cross, this one does not.
 */
export async function runJobAndPost(
  request: WorkerRequest,
  post: (response: WorkerResponse) => void,
): Promise<void> {
  const response = await runJobInWorker(request)
  try {
    post(response)
  } catch (cause) {
    post({
      ok: false,
      error: `the result could not be posted back to the calling thread: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    })
  }
}

// Worker entry. Guarded so importing this module for its types in a non-worker
// context is harmless.
if (typeof self !== 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    // Rejects only if the substitute response cannot be posted either — a worker with
    // no channel back to the page. Left unhandled deliberately; see `runJobAndPost`.
    void runJobAndPost(event.data, (response) => {
      self.postMessage(response)
    })
  })
}
