/**
 * The browser tier's task-executing thread entry.
 *
 * Everything interesting is `runTask` in `@o2/core`, which both tiers share — see
 * that module for why bytes cross the boundary rather than a blockstore, and why the
 * output travels as bytes. This file is the DOM spelling of "hand each message to it
 * and post the answer back", and it is deliberately nothing else.
 *
 * The types are re-exported because this module's path is what a bundler's `?worker`
 * import names, so it is where a page looks for them.
 */

import { runTask, runTaskAndPost } from '@o2/core'
import type { WorkerTaskRequest, WorkerTaskResponse } from '@o2/core'

export { runTask }
export type { WorkerTaskRequest, WorkerTaskResponse }

// Guarded so importing this module for its types outside a worker is harmless — the
// same guard `@o2/core`'s task worker uses.
if (typeof self !== 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  self.addEventListener('message', (event: MessageEvent<WorkerTaskRequest>) => {
    // `runTaskAndPost` reports a `postMessage` that threw — a `DataCloneError` on a
    // response the structured-clone algorithm will not take — by posting the failure
    // arm of the same response instead, so the page gets a named result rather than
    // waiting out the deadline for a worker it will conclude is gone.
    //
    // It rejects only when that substitute cannot be posted either, which is a worker
    // with no channel back to the page at all. Left unhandled deliberately: an
    // unhandled rejection is visible in the console and in an `error` event, and there
    // is by construction no channel left to report it on. Written down rather than
    // assumed, in the manner of `peer-verifier.ts`'s `void`.
    void runTaskAndPost(event.data, (response) => {
      self.postMessage(response)
    })
  })
}
