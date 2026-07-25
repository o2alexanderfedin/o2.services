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
        const timer = setTimeout(() => reject(new Error('worker timed out')), 20_000)
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
  }, 30_000)
})
