/**
 * The Node tier's task-executing thread entry.
 *
 * Everything interesting is `runTask` in `@o2/core`, which both tiers share. This
 * file is the `node:worker_threads` spelling of "hand each message to it and post the
 * answer back", and it is deliberately nothing else — a thread entry that grew logic
 * would be logic the browser tier does not run.
 */

import { parentPort } from 'node:worker_threads'
import { runTask } from '@o2/core'
import type { WorkerTaskRequest } from '@o2/core'

const port = parentPort
if (port !== null) {
  port.on('message', (request: WorkerTaskRequest) => {
    void runTask(request).then((response) => {
      port.postMessage(response)
    })
  })
}
