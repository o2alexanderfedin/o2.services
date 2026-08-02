import { describe, expect, it } from 'vitest'
import { encodeCanonical } from '../canonical/encode.ts'
import { MODULE_WRITES_PARTITION } from './fixtures.ts'
import { runTaskAndPost } from './task-run.ts'
import type { WorkerTaskRequest, WorkerTaskResponse } from './task-run.ts'

/**
 * A post that threw is a reply, not a thread that never answered.
 *
 * Both live thread entries — `@o2/browser`'s `task-executor.worker.ts` and
 * `@o2/node`'s `task-executor.worker-thread.ts` — were
 * `void runTask(request).then((r) => post(r))`, with no `.catch`. `runTask` never
 * rejects: every path inside it is wrapped, and a task that fails comes back as the
 * `ok: false` arm. So the *only* rejection that `.then` could produce was `post`
 * itself throwing — `DataCloneError`, which both `postMessage` implementations raise
 * for a value the structured-clone algorithm will not take.
 *
 * Unhandled, that rejection went nowhere. The calling thread's pending entry sat
 * until its deadline and the task was recorded as a worker that never answered —
 * the same misattribution as a peer that answered being reported as a peer that is
 * gone, and equally hard to diagnose, because the one fact that would explain it was
 * discarded at the moment it occurred.
 *
 * This spec is where that is checked, because it is where it *can* be: the entries
 * themselves are a `postMessage` and a guard, and the failure is in what surrounds
 * the call, not in either platform's spelling of it. Testing this through a real
 * `Worker` would need an uncloneable value that survives being posted *to* the
 * worker, which is a harder fixture that proves less.
 *
 * **Two requests, and the second is not decoration.** `REQUEST` is one `runTask`
 * refuses — eight bytes that are not a WASM module — and its response is the
 * `ok: false` arm, three plain fields. `SUCCEEDS` runs a real guest, and its response
 * carries `outputBytes: Uint8Array` and `fuelUsed`. Only the second can tell whether
 * the substitute quietly inherited the fields of the response that would not cross,
 * because on the first the two shapes are identical and every assertion about the
 * substitute's contents passes vacuously.
 */

const REQUEST: WorkerTaskRequest = {
  id: 7,
  moduleBytes: new Uint8Array(8) as Uint8Array<ArrayBuffer>,
  inputBytes: new Uint8Array(8) as Uint8Array<ArrayBuffer>,
  partitionIndex: 0,
  partitionCount: 1,
}

function encodedInput(): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({ a: 1 })
  if (!encoded.ok) throw new Error('fixture input will not canonicalise')
  return encoded.bytes
}

/** A request that genuinely runs, so its response carries bytes and a fuel reading. */
const SUCCEEDS: WorkerTaskRequest = {
  id: 9,
  moduleBytes: MODULE_WRITES_PARTITION,
  inputBytes: encodedInput(),
  partitionIndex: 3,
  partitionCount: 8,
}

/** A `post` that throws on its first call and records every call it was given. */
function postThatRefusesOnce(message: string) {
  const seen: WorkerTaskResponse[] = []
  let calls = 0
  return {
    seen,
    get calls() {
      return calls
    },
    post(response: WorkerTaskResponse): void {
      calls += 1
      seen.push(response)
      if (calls === 1) throw new DOMException(message, 'DataCloneError')
    },
  }
}

describe('runTaskAndPost — a response that could not be posted comes back as a named result', () => {
  it('answers with the failure arm, naming what the post refused', async () => {
    const sink = postThatRefusesOnce('#<Object> could not be cloned.')

    await expect(runTaskAndPost(REQUEST, (r) => sink.post(r))).resolves.toBeUndefined()

    // Exactly two: the response that could not cross, then the one that could. The
    // count is what proves the recovery happened here and not by a retry somewhere
    // above — a reason string alone would read the same either way.
    expect(sink.calls).toBe(2)

    const substitute = sink.seen[1]
    expect(substitute).toBeDefined()
    if (substitute === undefined) return

    // Correlated, or the calling thread cannot match it to anything and it is no
    // better than the silence it replaced.
    expect(substitute.id).toBe(7)
    expect(substitute.ok).toBe(false)
    if (substitute.ok) return

    // The text, not merely the arm. Both halves are load-bearing: what failed, and
    // what the platform said about it.
    expect(substitute.reason).toContain('could not be posted back to the calling thread')
    expect(substitute.reason).toContain('could not be cloned')
  })

  it('carries nothing but the correlation id, the arm, and the reason', async () => {
    const sink = postThatRefusesOnce('#<Object> could not be cloned.')
    // The *successful* request, so the first response holds `outputBytes` and
    // `fuelUsed`. Against the failing one this case cannot see anything: both arms
    // would have the same three keys and the assertion would hold whatever the
    // substitute was built from.
    await runTaskAndPost(SUCCEEDS, (r) => sink.post(r))

    const first = sink.seen[0]
    if (first === undefined) throw new Error('nothing was posted')
    // The fixture is doing its job — this is the response that could not cross.
    expect(first.ok).toBe(true)
    expect(Object.keys(first).sort()).toEqual(['fuelUsed', 'id', 'ok', 'outputBytes'])

    const substitute = sink.seen[1]
    if (substitute === undefined) throw new Error('no substitute was posted')
    // The substitute must be cloneable by construction, or it fails for the same
    // reason the first one did and the thread goes quiet after all. Two numbers, a
    // boolean and a string — none of the guest's bytes come along.
    expect(Object.keys(substitute).sort()).toEqual(['id', 'ok', 'reason'])
    for (const value of Object.values(substitute)) {
      expect(['number', 'boolean', 'string']).toContain(typeof value)
    }
  })

  it('posts once, and does not reject, when the post is fine', async () => {
    const seen: WorkerTaskResponse[] = []

    await expect(
      runTaskAndPost(REQUEST, (response) => {
        seen.push(response)
      }),
    ).resolves.toBeUndefined()

    // One post, not two: the substitute is reserved for a post that failed, and a
    // second one on the happy path would be a duplicate reply the caller must dedupe.
    expect(seen.length).toBe(1)
    expect(seen[0]?.id).toBe(7)
  })

  it('rejects only when the substitute cannot be posted either', async () => {
    // A thread with no channel left to its parent. Nothing this side can do about it
    // but say so, and the entry points record why they leave that one unhandled.
    await expect(
      runTaskAndPost(REQUEST, () => {
        throw new DOMException('port is closed', 'DataCloneError')
      }),
    ).rejects.toThrow('port is closed')
  })
})
