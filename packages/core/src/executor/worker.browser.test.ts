import { describe, expect, it } from 'vitest'
import { MODULE_WRITES_PARTITION } from './fixtures.ts'
import type { WorkerRequest, WorkerResponse } from './task-worker.ts'
// Vite's `?worker` import compiles the module and its imports into a real Worker
// bundle. Browser project only — see vitest.config.ts.
import TaskWorker from './task-worker.ts?worker'

/**
 * DET-07, webworker target.
 *
 * A complete job — shard, execute at R=2, verify, agree — running entirely inside
 * a Worker, with the main thread only posting the request and awaiting the reply.
 * This is the shape the browser tier needs: nothing executes on the main thread,
 * so a visitor's page stays responsive while their node contributes.
 *
 * It works only because `@o2/core` has no platform imports. If a `node:*` or DOM
 * dependency ever leaks into the kernel, the worker bundle fails to build and
 * this test is what catches it.
 */
describe('DET-07 — the kernel runs inside a Worker', () => {
  it('completes a 4-shard job at R=2 off the main thread', async () => {
    const worker = new TaskWorker()
    try {
      const response = await new Promise<WorkerResponse>((resolve, reject) => {
        // A diagnostic watchdog, not a property: it exists so a wedged worker says
        // "worker timed out" instead of dying as a bare vitest timeout that names
        // nothing. It must therefore stay comfortably *under* the framework budget
        // below — the same ordering `worker-executor.browser.test.ts` documents in
        // its header — and comfortably *over* the work, which is four shards at R=2
        // and measures a couple of seconds on an idle host.
        //
        // Was 20 s, and 20 s was not over the work by enough: on 2026-07-31 an
        // unrelated LLVM build held this host at a load average of 130 on 8 cores and
        // the job exceeded it in Chromium and WebKit. Nothing was wrong with the
        // kernel. 60 s inside 120 s keeps both margins wide.
        const timer = setTimeout(() => reject(new Error('worker timed out')), 60_000)
        worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
          clearTimeout(timer)
          resolve(event.data)
        })
        worker.addEventListener('error', (event: ErrorEvent) => {
          clearTimeout(timer)
          reject(new Error(`worker error: ${event.message}`))
        })
        const request: WorkerRequest = {
          moduleBytes: MODULE_WRITES_PARTITION,
          shardCount: 4,
          redundancy: 2,
        }
        worker.postMessage(request)
      })

      expect(response.ok).toBe(true)
      if (!response.ok) return
      expect(response.complete).toBe(true)
      // Each shard's guest saw its own partition index, proving the ABI works in
      // a Worker exactly as it does on the main thread.
      expect(response.partitions).toEqual([0, 1, 2, 3])
    } finally {
      worker.terminate()
    }
  }, 120_000)
})
