/**
 * The Node tier's task-executing thread entry.
 *
 * Everything interesting is `runTask` in `@o2/core`, which both tiers share. This
 * file is the `node:worker_threads` spelling of "hand each message to it and post the
 * answer back", and it is deliberately nothing else — a thread entry that grew logic
 * would be logic the browser tier does not run.
 */

import { parentPort } from 'node:worker_threads'
import { runTaskAndPost } from '@o2/core'
import type { WorkerTaskRequest } from '@o2/core'

const port = parentPort
if (port !== null) {
  port.on('message', (request: WorkerTaskRequest) => {
    // `runTaskAndPost` reports a `postMessage` that threw — `DataCloneError`, which
    // `node:worker_threads` raises for the same uncloneable values the DOM does — by
    // posting the failure arm of the same response instead. Without it the rejection
    // was unhandled, the parent's pending entry expired, and a thread that answered
    // was recorded as a thread that never did.
    //
    // It rejects only when that substitute cannot be posted either, which is a thread
    // with no channel back to its parent at all. Left unhandled deliberately: an
    // unhandled rejection in a worker surfaces on the parent's `error` event, and
    // there is by construction no channel left to report it on.
    void runTaskAndPost(request, (response) => {
      port.postMessage(response)
    })
  })
}
