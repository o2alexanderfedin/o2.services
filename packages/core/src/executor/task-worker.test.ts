import { describe, expect, it } from 'vitest'
import { runJobAndPost } from './task-worker.ts'
import type { WorkerRequest, WorkerResponse } from './task-worker.ts'

/**
 * The third worker entry, held to the same rule as the two live ones.
 *
 * This module's entry had the identical defect as `task-executor.worker.ts` and
 * `task-executor.worker-thread.ts` — `void runJobInWorker(...).then((r) => post(r))`
 * with no `.catch`, so a `postMessage` that threw became an unhandled rejection and
 * the caller waited out a worker that had in fact finished.
 *
 * It is fixed rather than left, and guarded rather than argued about, for one reason:
 * it is reachable. `worker.browser.test.ts` imports it, so "no production importer"
 * is a statement about today's wiring and not about what runs. If the module is
 * deleted — the audit's own recommendation, filed separately — this file goes with
 * it, and until then the three entries behave the same way, which is the property
 * worth having.
 *
 * The request is deliberately one that fails: eight bytes are not a WASM module, so
 * `runJobInWorker` returns its `ok: false` arm without compiling a guest. What is
 * under test is the post, not the job.
 */

const REQUEST: WorkerRequest = {
  moduleBytes: new Uint8Array(8) as Uint8Array<ArrayBuffer>,
  shardCount: 1,
  redundancy: 2,
}

describe('runJobAndPost — a response that could not be posted comes back as a named result', () => {
  it('answers with the failure arm, naming what the post refused', async () => {
    const seen: WorkerResponse[] = []
    let calls = 0

    await expect(
      runJobAndPost(REQUEST, (response) => {
        calls += 1
        seen.push(response)
        if (calls === 1) throw new DOMException('#<Object> could not be cloned.', 'DataCloneError')
      }),
    ).resolves.toBeUndefined()

    // Two posts: the one that could not cross, then the one that could. The count is
    // what separates a recovery here from a retry somewhere above.
    expect(calls).toBe(2)

    const substitute = seen[1]
    expect(substitute).toBeDefined()
    if (substitute === undefined || substitute.ok) return
    expect(substitute.error).toContain('could not be posted back to the calling thread')
    expect(substitute.error).toContain('could not be cloned')
  })

  it('posts once, and does not reject, when the post is fine', async () => {
    const seen: WorkerResponse[] = []
    await expect(
      runJobAndPost(REQUEST, (response) => {
        seen.push(response)
      }),
    ).resolves.toBeUndefined()
    expect(seen.length).toBe(1)
  })
})
