/**
 * A DOM `Worker` behind the kernel's `ComputeThread` port.
 *
 * Ten lines of spelling. The whole reason the port exists is that this tier says
 * `addEventListener` and `terminate()` where the Node tier says `.on()` and
 * `.terminate()`; with that difference isolated here, the deadline that bounds an
 * untrusted guest is one decision in `@o2/core` rather than two constants drifting.
 */

import type { ComputeThread, WorkerTaskRequest, WorkerTaskResponse } from '@o2/core'

/** Builds the Worker. Injected so this stays bundler-agnostic. */
export type WorkerFactory = () => Worker

export function domThread(createWorker: WorkerFactory): ComputeThread {
  const worker = createWorker()
  return {
    post: (request: WorkerTaskRequest) => {
      worker.postMessage(request)
    },
    onResponse: (handler: (response: WorkerTaskResponse) => void) => {
      worker.addEventListener('message', (event: MessageEvent<WorkerTaskResponse>) => {
        handler(event.data)
      })
    },
    onError: (handler: (reason: string) => void) => {
      worker.addEventListener('error', (event: ErrorEvent) => {
        handler(event.message)
      })
    },
    kill: () => {
      worker.terminate()
    },
  }
}
