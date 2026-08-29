import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { encodeCanonical } from '../canonical/encode.ts'
import type { ComputeThread, Task } from '../ports.ts'
import { hostCoreCount } from './core-count.ts'
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
  /** Kill this thread from the outside, the way a real worker's `error` event does. */
  die(reason: string): void
} {
  const posted: WorkerTaskRequest[] = []
  let onResponse: ((response: WorkerTaskResponse) => void) | null = null
  let onError: ((reason: string) => void) | null = null
  return {
    posted,
    kills: 0,
    post: (request) => {
      posted.push(request)
    },
    onResponse: (handler) => {
      onResponse = handler
    },
    onError: (handler) => {
      onError = handler
    },
    die: (reason) => {
      onError?.(reason)
    },
    kill(): void {
      this.kills += 1
    },
    answer: (response) => {
      onResponse?.(response)
    },
  }
}

/**
 * Wait for a state this executor can be ASKED about, not for a number of milliseconds.
 *
 * **Replaces `await new Promise(r => setTimeout(r, 10))` throughout, 2026-08-29.** Those
 * sleeps were sequencing devices — "let the block reads settle so the next task is really
 * queued" — and a sequencing device written as an absolute span is exactly what this
 * repository's conventions warn against: it encodes the machine it was written on. It held on
 * a quiet laptop and lost twice in twelve full-lane runs inside a Linux container, in webkit
 * and in chromium, on a case whose subject is not timing at all.
 *
 * A predicate over `queued`/`threadCount` is the same intent stated as a condition, so a slow
 * host waits longer and a fast one waits less. The 2 s ceiling is a stuck-test guard rather
 * than a timing assertion: it fails saying what it was waiting for, instead of failing on an
 * assertion about a state the executor never reached.
 */
async function until(what: string, holds: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!holds()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 1))
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

  /**
   * **This case asserted the opposite until 2026-08-28, and the change is the point.**
   *
   * It read *"tells a co-resident task what happened to it, in its own words"*, and it
   * was right about the tree it was written against: every task went to one shared
   * thread, so a runaway aborted its thread-mates and the most that could be asked was
   * that each be told why. The class docblock stated that cost openly and named the
   * remedy it did not have — *"closing that means a thread pool or one thread per task,
   * and neither is built here."*
   *
   * Both are built now. A task holds a thread alone, so **there are no co-residents to
   * abort**: work behind a runaway waits in a queue this executor owns rather than in
   * the worker's message queue where it was invisible. The old assertion cannot be
   * kept — it describes a state the pool makes unreachable — so it is replaced by the
   * narrower claim, and the old one is quoted here rather than deleted so that a reader
   * who finds the docblock's warning in an older commit knows what happened to it.
   */
  it('takes nothing but itself down — the task queued behind a runaway still runs', async () => {
    const { blockstore, task } = await seeded()
    const threads = [fakeThread(), fakeThread()]
    let built = 0
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      // One thread, so the second task is genuinely behind the first rather than
      // beside it. At the default pool size this scenario cannot be constructed.
      maxThreads: 1,
      createThread: () => threads[built++] as ComputeThread,
      // Far out of the way. **The head's thread is killed as an EVENT below, not by this
      // deadline**, and that is the whole difference between this case and the one it
      // replaced on 2026-08-29. Driven by the deadline, both tasks armed timers within
      // microseconds of each other and the head's expiry raced the tail's — a coin flip
      // that the old version won only because an absolute 10 ms sleep separated the two
      // submissions. It lost that flip twice in twelve container runs. What this case is
      // about is a thread DYING under a queued task, and a worker `error` says so with no
      // clock in it at all.
      deadlineMs: 60_000,
    })

    const first = executor.execute(task)
    await until('the first task to hold the only thread', () => executor.threadCount === 1)
    const second = executor.execute(task)
    // Waited for as a STATE, not as a span: how long the block reads take is the host's
    // business, and the case only needs the tail to really be in the queue.
    await until('the second task to be queued behind it', () => executor.queued === 1)
    expect(built).toBe(1)

    threads[0]?.die('the worker crashed')

    const a = await first
    expect(a.ok).toBe(false)
    if (a.ok) return
    expect(a.reason).toMatch(/worker error: the worker crashed/)
    expect(threads[0]?.kills).toBe(1)

    // The queued task was not failed by its neighbour's death. It was dispatched to a
    // replacement thread and is waiting for an answer, which it now gets.
    await until('the queued task to reach a replacement thread', () => built === 2)
    expect(built).toBe(2)
    const request = threads[1]?.posted[0]
    expect(request).toBeDefined()
    if (request === undefined) return
    const output = encodeCanonical(7)
    expect(output.ok).toBe(true)
    if (!output.ok) return
    threads[1]?.answer({ id: request.id, ok: true, outputBytes: output.bytes, fuelUsed: 1 })

    const b = await second
    expect(b.ok, 'a queued task must survive the death of the thread it was waiting on').toBe(true)
    if (!b.ok) return
    expect(b.output).toBe(7)
    expect(threads[1]?.kills).toBe(0)
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
    await until('the task to reach a thread', () => executor.threadCount === 1)
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

/**
 * The pool — the owner's ask of 2026-08-28, in his words: *"ограничивать число
 * одновременно исполняемых задач количеством ядер CPU. Ну и выполнять задачи в
 * WebWorkers."*
 *
 * **What was actually there before this, measured rather than assumed**, because the
 * first answer given to him was wrong in both directions. Execution was already off the
 * main thread — `WorkerExecutor` has posted to a real worker since BROW-04 — but it
 * posted to exactly **one**, so a node used one core no matter how many it had. And
 * there *was* a concurrency bound, `LocalCapacity`'s `DEFAULT_MAX_CONCURRENT_TASKS` of
 * 64, which is an **admission** bound on work peers send and deliberately not a core
 * count: `placement.ts` records that lowering it turns a slow job into a failed one,
 * since `submitJob` calls `executeVerified` once with no re-pick. So the two numbers
 * answer different questions and only this one is about cores.
 *
 * These cases drive a fake `ComputeThread`, at the level the *mechanism* lives: how
 * many threads exist, what queues, and what a death takes with it.
 */
describe('the pool runs as many tasks at once as the host has cores, and no more', () => {
  /** A factory handing out distinct fakes, so "which thread" is a question with an answer. */
  function pool(): {
    readonly threads: readonly ReturnType<typeof fakeThread>[]
    create: () => ComputeThread
  } {
    const threads: ReturnType<typeof fakeThread>[] = []
    return {
      threads,
      create: () => {
        const thread = fakeThread()
        threads.push(thread)
        return thread
      },
    }
  }

  /** Every task posted so far, paired with the thread it landed on. */
  function landings(threads: readonly { readonly posted: readonly WorkerTaskRequest[] }[]): number {
    return threads.reduce((total, thread) => total + thread.posted.length, 0)
  }

  it('builds no thread at all until it is asked to compute', async () => {
    const { blockstore } = await seeded()
    const built = pool()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      maxThreads: 4,
      createThread: built.create,
    })

    expect(built.threads.length).toBe(0)
    expect(executor.threadCount).toBe(0)
    expect(executor.threadAlive).toBe(false)
  })

  it('gives each concurrent task its own thread, up to the bound', async () => {
    const { blockstore, task } = await seeded()
    const built = pool()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      maxThreads: 3,
      createThread: built.create,
      deadlineMs: 5_000,
    })

    const running = [executor.execute(task), executor.execute(task), executor.execute(task)]
    await until('all three tasks to be dispatched', () => executor.threadCount === 3)

    // Three is a literal, not `running.length` — an assertion that reuses the value it
    // tests goes green when both sides move together.
    expect(executor.threadCount).toBe(3)
    expect(built.threads.length).toBe(3)
    expect(landings(built.threads)).toBe(3)
    // One task each, so a runaway has no thread-mates to take with it.
    for (const thread of built.threads) expect(thread.posted.length).toBe(1)
    expect(executor.queued).toBe(0)

    executor.terminate()
    await Promise.all(running)
  })

  it('queues the work above the bound instead of building a fourth thread', async () => {
    const { blockstore, task } = await seeded()
    const built = pool()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      maxThreads: 2,
      createThread: built.create,
      deadlineMs: 5_000,
    })

    const running = [executor.execute(task), executor.execute(task), executor.execute(task)]
    await until('the pool to fill and the third task to queue', () => executor.queued === 1)

    expect(executor.threadCount).toBe(2)
    expect(built.threads.length).toBe(2)
    expect(landings(built.threads)).toBe(2)
    expect(executor.queued).toBe(1)

    executor.terminate()
    await Promise.all(running)
  })

  it('hands a freed thread to the queue rather than letting it idle', async () => {
    const { blockstore, task } = await seeded()
    const built = pool()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      maxThreads: 1,
      createThread: built.create,
      deadlineMs: 5_000,
    })

    const first = executor.execute(task)
    const second = executor.execute(task)
    await until('the second task to be queued', () => executor.queued === 1)
    expect(executor.queued).toBe(1)

    const output = encodeCanonical(11)
    expect(output.ok).toBe(true)
    if (!output.ok) return
    const thread = built.threads[0]
    expect(thread).toBeDefined()
    if (thread === undefined) return
    const firstRequest = thread.posted[0]
    expect(firstRequest).toBeDefined()
    if (firstRequest === undefined) return
    thread.answer({ id: firstRequest.id, ok: true, outputBytes: output.bytes, fuelUsed: 1 })
    expect((await first).ok).toBe(true)

    // The SAME thread took the queued task — the pool reuses rather than rebuilding.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(built.threads.length).toBe(1)
    expect(thread.posted.length).toBe(2)
    expect(executor.queued).toBe(0)
    const secondRequest = thread.posted[1]
    expect(secondRequest).toBeDefined()
    if (secondRequest === undefined) return
    thread.answer({ id: secondRequest.id, ok: true, outputBytes: output.bytes, fuelUsed: 1 })
    expect((await second).ok).toBe(true)
  })

  /**
   * The deadline is armed at **submission** and covers the queue wait, deliberately: it
   * must stay strictly below `DEFAULT_RPC_TIMEOUT_MS` so the requestor is told a named
   * reason rather than sitting out its whole budget. A clock started at dispatch would
   * let a queued task blow that budget silently — NET-10's argument applied to time,
   * and the relation is asserted in `execution-deadline.node.test.ts`.
   *
   * ## The arm this case does NOT drive, named rather than left as a green
   *
   * `#expire` forks: a **running** task loses its thread, a **queued** one does not.
   * The queued fork is written and is **not reachable from outside this class**, and
   * saying so is worth more than a case that pretends otherwise. The reason is
   * arithmetic over the two properties above it: one deadline value for the whole
   * executor, and FIFO dispatch. A task queued at time *t* expires at *t + d*; the head
   * it is waiting behind was submitted earlier, so the head expires first, frees a
   * thread, and `#drain` dispatches the queued task **before** its own deadline can
   * fire. There is no submission order that inverts this.
   *
   * So the fork is defensive, and it is kept for the case a per-task deadline or a
   * priority queue would create — either of which makes it live the day it lands. What
   * is asserted here is the reachable consequence, which is the one that matters to a
   * requestor: **the head expiring releases the queue rather than failing it.**
   */
  it('spends a queued task’s budget on waiting, and releases it when the head dies', async () => {
    const { blockstore, task } = await seeded()
    const built = pool()
    const executor = new WorkerExecutor({
      nodeId: 'edge-2',
      blockstore,
      maxThreads: 1,
      createThread: built.create,
      deadlineMs: 50,
    })

    const running = executor.execute(task)
    await until('the head to take the only thread', () => executor.threadCount === 1)
    const waiting = executor.execute(task)
    await until('the tail to be queued behind it', () => executor.queued === 1)
    expect(executor.queued).toBe(1)
    expect(built.threads.length).toBe(1)

    const head = await running
    expect(head.ok).toBe(false)
    if (head.ok) return
    expect(head.reason).toMatch(/exceeded 50ms/)
    expect(head.reason).toContain('edge-2')
    expect(built.threads[0]?.kills).toBe(1)

    // The queued task was dispatched by the head's death rather than failed by it — a
    // replacement thread, and the queue empty.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(executor.queued).toBe(0)
    expect(built.threads.length).toBe(2)
    expect(built.threads[1]?.posted.length).toBe(1)

    // It then spends what is left of its own budget on that thread and expires there,
    // which is the running fork and is where its thread does get taken.
    const tail = await waiting
    expect(tail.ok).toBe(false)
    if (tail.ok) return
    expect(tail.reason).toMatch(/exceeded 50ms/)
    expect(built.threads[1]?.kills).toBe(1)
  })

  it('stops every thread and every queued task when the visitor stops the node', async () => {
    const { blockstore, task } = await seeded()
    const built = pool()
    const executor = new WorkerExecutor({
      nodeId: 'tab',
      blockstore,
      maxThreads: 2,
      createThread: built.create,
      deadlineMs: 5_000,
    })

    const outcomes = Promise.all([executor.execute(task), executor.execute(task), executor.execute(task)])
    await until('two running and one queued', () => executor.threadCount === 2 && executor.queued === 1)
    expect(executor.threadCount).toBe(2)
    expect(executor.queued).toBe(1)

    executor.terminate()

    // BROW-04: Stop drops CPU to zero, and a pool must not turn that into "zero on the
    // threads it happened to remember". Three tasks, three refusals, both threads killed.
    const settled = await outcomes
    expect(settled.length).toBe(3)
    for (const outcome of settled) {
      expect(outcome.ok).toBe(false)
      if (outcome.ok) continue
      expect(outcome.reason).toBe('executor stopped')
    }
    for (const thread of built.threads) expect(thread.kills).toBe(1)
    expect(executor.threadCount).toBe(0)
    expect(executor.queued).toBe(0)
  })

  it('refuses a bound that is not a number of threads', () => {
    // The same guard `LocalCapacity` applies to `maxConcurrent`, and for the same
    // reason: a pool of zero accepts no work at all, which is a node that has left the
    // fabric rather than one going slowly.
    for (const maxThreads of [0, -1, 2.5, Number.NaN]) {
      expect(
        () =>
          new WorkerExecutor({
            nodeId: 'tab',
            blockstore: new MemoryBlockstore(),
            maxThreads,
            createThread: fakeThread,
          }),
      ).toThrow(RangeError)
    }
  })

  it('sizes itself from the host when nobody says otherwise', async () => {
    const { blockstore } = await seeded()
    const executor = new WorkerExecutor({ nodeId: 'tab', blockstore, createThread: fakeThread })

    // Read against `hostCoreCount` rather than against a literal: the number is the
    // machine's and a literal would pin this suite to whatever ran it. What is asserted
    // is the WIRING — that the default comes from the host reading and not from a
    // constant somebody typed.
    expect(executor.maxThreads).toBe(hostCoreCount())
    expect(executor.maxThreads).toBeGreaterThanOrEqual(1)
  })
})
