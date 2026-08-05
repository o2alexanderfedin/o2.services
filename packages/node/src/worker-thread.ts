/**
 * A `node:worker_threads` Worker behind the kernel's `ComputeThread` port.
 *
 * The mirror of `dom-thread.ts`, and the pair is the whole reason the port exists:
 * `addEventListener` does not exist here, and `terminate()` returns a promise rather
 * than nothing. With those two differences isolated, the wall-clock deadline that
 * bounds an untrusted guest is written once in `@o2/core` and both tiers get the
 * identical bound — which is the standing rule that all nodes have equal
 * functionality, applied where two constants would otherwise drift apart.
 *
 * The thread is `unref()`d: a wedged guest must not be able to hold the process open
 * after everything else has finished.
 */

import { Worker } from 'node:worker_threads'
import type { ComputeThread, WorkerTaskRequest, WorkerTaskResponse } from '@o2/core'

/**
 * The task-executing entry, resolved relative to this module.
 *
 * A `.ts` URL, loaded with no `execArgv` flag: Node's type stripping is on by default
 * from 23.x and applies inside a worker, measured against a vitest-hosted parent
 * before this file was written.
 */
const ENTRY = new URL('./task-executor.worker-thread.ts', import.meta.url)

export function workerThread(): ComputeThread {
  const worker = new Worker(ENTRY)
  worker.unref()
  return {
    post: (request: WorkerTaskRequest) => {
      worker.postMessage(request)
    },
    onResponse: (handler: (response: WorkerTaskResponse) => void) => {
      worker.on('message', handler)
    },
    onError: (handler: (reason: string) => void) => {
      worker.on('error', (cause: Error) => {
        handler(cause.message)
      })
    },
    kill: () => {
      void worker.terminate()
    },
  }
}
