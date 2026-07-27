/**
 * The default Worker factory for a Vite-bundled page.
 *
 * Kept out of `index.ts` on purpose. `?worker` is Vite syntax, so a module that
 * uses it can only be loaded by a bundler — importing `@o2/browser` from a Node
 * test would fail at resolution, and the failure would be a build error a long way
 * from its cause. Pages import this file directly; everything else injects its own
 * factory, which is why {@link WorkerExecutor} takes one at all.
 */

import TaskExecutorWorker from './task-executor.worker.ts?worker'

export function createTaskWorker(): Worker {
  return new TaskExecutorWorker()
}
