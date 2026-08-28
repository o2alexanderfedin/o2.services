/**
 * The tab's task executor — BROW-04.
 *
 * The class itself is `@o2/core`'s {@link WorkerExecutor}, which owns the wall-clock
 * deadline and the kill switch. It moved there when the Node tier needed the same
 * bound: a browser node that killed a runaway at one number while a server node never
 * killed it at all is exactly the branch-on-node-kind this project deleted a class
 * over, and two independently-maintained deadline constants is how that comes back
 * under a new name.
 *
 * What is left here is this tier's spelling of a thread — see `dom-thread.ts` — and
 * a factory that keeps the page's existing `createWorker` shape.
 */

import { WorkerExecutor } from '@o2/core'
import type { Blockstore } from '@o2/core'
import { domThread } from './dom-thread.ts'
import type { WorkerFactory } from './dom-thread.ts'

export { WorkerExecutor }
export type { WorkerFactory }

export interface BrowserWorkerExecutorOptions {
  readonly nodeId: string
  /** Resolves module and input blocks on the main thread, where storage lives. */
  readonly blockstore: Blockstore
  readonly createWorker: WorkerFactory
  readonly maxOutputBytes?: number
  readonly deadlineMs?: number
  /**
   * Tasks the tab runs at once. Defaults to `navigator.hardwareConcurrency`.
   *
   * Forwarded rather than swallowed, for the same reason `deadlineMs` is: a value this
   * factory dropped would be a setting that exists on the class, is documented on the
   * class, and silently does nothing on the tier that has the most cores to spend.
   */
  readonly maxThreads?: number
}

/** A {@link WorkerExecutor} over a DOM `Worker`. */
export function browserWorkerExecutor(options: BrowserWorkerExecutorOptions): WorkerExecutor {
  return new WorkerExecutor({
    nodeId: options.nodeId,
    blockstore: options.blockstore,
    createThread: () => domThread(options.createWorker),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.maxThreads === undefined ? {} : { maxThreads: options.maxThreads }),
  })
}
