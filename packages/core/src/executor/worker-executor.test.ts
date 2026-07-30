import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { encodeCanonical } from '../canonical/encode.ts'
import type { ComputeThread, Task } from '../ports.ts'
import { DEFAULT_TASK_DEADLINE_MS, WorkerExecutor } from './worker-executor.ts'
import type { WorkerTaskRequest, WorkerTaskResponse } from './task-run.ts'

/**
 * SCHED-06 / BROW-04 — the wall-clock bound on an untrusted guest.
 *
 * The bound is one decision in one file because both tiers need it: a browser node
 * that killed a runaway at one number while a server node never killed it at all is
 * exactly the branch-on-node-kind this project deleted a class over. These cases
 * drive it through a fake `ComputeThread`, which is the level the *mechanism* lives
 * at — whether the timer is armed, whether a kill retires the executor, what a
 * co-resident is told. The claims that need a real thread, because only killing one
 * ends a real spin, are `worker-executor.browser.test.ts` and
 * `execution-deadline.node.test.ts`.
 */

/** A thread the test drives: it answers when told to, and never on its own. */
function fakeThread(): ComputeThread & {
  readonly posted: readonly WorkerTaskRequest[]
  kills: number
  answer(response: WorkerTaskResponse): void
} {
  const posted: WorkerTaskRequest[] = []
  let onResponse: ((response: WorkerTaskResponse) => void) | null = null
  return {
    posted,
    kills: 0,
    post: (request) => {
      posted.push(request)
    },
    onResponse: (handler) => {
      onResponse = handler
    },
    onError: () => {},
    kill(): void {
      this.kills += 1
    },
    answer: (response) => {
      onResponse?.(response)
    },
  }
}

const TASK: Omit<Task, 'moduleCid' | 'inputCid'> = { partitionIndex: 0, partitionCount: 1 }

async function seeded(): Promise<{
  readonly blockstore: MemoryBlockstore
  readonly task: Task
}> {
  const blockstore = new MemoryBlockstore()
  const moduleCid = await blockstore.put(new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>)
  const inputCid = await blockstore.put(new Uint8Array([4, 5, 6]) as Uint8Array<ArrayBuffer>)
  return { blockstore, task: { ...TASK, moduleCid, inputCid } }
}

describe('SCHED-06 — a task that will not come back is bounded by wall clock', () => {
  it('fails a task whose thread never answers, naming the node and the bound', async () => {
    const { blockstore, task } = await seeded()
    const thread = fakeThread()
    const executor = new WorkerExecutor({
      nodeId: 'server-7',
      blockstore,
      createThread: () => thread,
      deadlineMs: 40,
    })

    const outcome = await executor.execute(task)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toMatch(/exceeded 40ms/)
    // Attribution: `RemoteExecutor` passes an exec outcome through verbatim, so a
    // reason that does not name the node loses which machine refused.
    expect(outcome.reason).toContain('server-7')
    expect(thread.kills).toBe(1)
  })

  it('replaces the thread rather than retiring the executor', async () => {
    // The mistake this exists to catch: latching `terminated` on a deadline. That
    // flag means the visitor stopped the node, and setting it here would turn one
    // bounded incident into permanent refusal for the rest of the page's life — a
    // worse denial of service than the bug being fixed.
    const { blockstore, task } = await seeded()
    const threads = [fakeThread(), fakeThread()]
    let built = 0
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      createThread: () => threads[built++] as ComputeThread,
      deadlineMs: 40,
    })

    expect((await executor.execute(task)).ok).toBe(false)
    expect(executor.terminated).toBe(false)
    expect(executor.threadAlive).toBe(false)

    const second = executor.execute(task)
    // `execute` resolves both blocks before it touches a thread, so the thread does
    // not exist until those awaits have run.
    await new Promise((resolve) => setTimeout(resolve, 0))
    // A fresh thread was built, and the task really landed on it.
    expect(built).toBe(2)
    const request = threads[1]?.posted[0]
    expect(request).toBeDefined()
    if (request === undefined) return
    const output = encodeCanonical(42)
    expect(output.ok).toBe(true)
    if (!output.ok) return
    threads[1]?.answer({ id: request.id, ok: true, outputBytes: output.bytes, fuelUsed: 3 })

    const outcome = await second
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.output).toBe(42)
  })

  it('tells a co-resident task what happened to it, in its own words', async () => {
    // One runaway aborts its thread-mates. That is a real cost and it is stated in
    // the class docstring rather than hidden — but each one must be able to say why,
    // and specifically must not be told 'executor stopped', which means the visitor
    // pressed Stop and is a different event entirely.
    const { blockstore, task } = await seeded()
    const thread = fakeThread()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      createThread: () => thread,
      deadlineMs: 60,
    })

    const first = executor.execute(task)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = executor.execute(task)

    const [a, b] = await Promise.all([first, second])
    expect(a.ok).toBe(false)
    if (a.ok) return
    expect(a.reason).toMatch(/exceeded 60ms/)
    expect(b.ok).toBe(false)
    if (b.ok) return
    expect(b.reason).toContain('thread terminated after a task exceeded its deadline')
    expect(b.reason).not.toBe('executor stopped')
  })

  it('stops taking work once the visitor stops it, deadline or no deadline', async () => {
    const { blockstore, task } = await seeded()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      createThread: fakeThread,
      deadlineMs: 5_000,
    })
    const running = executor.execute(task)
    await new Promise((resolve) => setTimeout(resolve, 10))
    executor.terminate()

    const outcome = await running
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('executor stopped')
    expect(executor.terminated).toBe(true)
    expect((await executor.execute(task)).ok).toBe(false)
  })

  it('defaults to a bound a page can actually live with', () => {
    // Not an arbitrary number: it has to be long enough that a backgrounded tab's
    // duty cycle cannot trip it, and the upper bound is asserted where both
    // constants are in scope — see execution-deadline.node.test.ts.
    expect(DEFAULT_TASK_DEADLINE_MS).toBeGreaterThan(1_000)
  })
})
